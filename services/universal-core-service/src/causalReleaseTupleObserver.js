import { causalDigest, CausalContinuityError } from "./causalContinuityCanonical.js";
import { HOST_NATIVE_HEALTH_CONTRACT_DIGEST, hostNativeGithubDiffDigest } from "./hostNativeGovernance.js";
import { projectScopeObservationDigest, projectScopeResourceDigest } from "./projectScopeRenderOriginResolver.js";

const MAX_BODY_BYTES = 512 * 1_024;
const MAX_FILES = 2_000;
const PAGE_SIZE = 100;
const MAX_SERVICES = 32;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ORIGIN = /^https:\/\/[a-z0-9][a-z0-9-]*\.onrender\.com$/;

function fail(code) { throw new CausalContinuityError(code); }
function text(value, code, max = 500) { const v = String(value ?? "").trim(); if (!v || v.length > max) fail(code); return v; }
function sha(value, code) { const v = text(value, code, 40).toLowerCase(); if (!SHA.test(v)) fail(code); return v; }
function digest(value, code) { const v = text(value, code, 64).toLowerCase(); if (!DIGEST.test(v)) fail(code); return v; }
function timestamp(value, code) { const ms = Date.parse(String(value || "")); if (!Number.isFinite(ms)) fail(code); return new Date(ms).toISOString(); }

async function strictJson(fetchImpl, url, { token = null, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET", redirect: "error", signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "skinharmony-universal-core", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
  } catch { fail("RELEASE_READBACK_UNAVAILABLE"); }
  finally { clearTimeout(timer); }
  if (!response || response.status !== 200 || response.redirected === true) fail("RELEASE_READBACK_UNAVAILABLE");
  const type = String(response.headers?.get?.("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") fail("RELEASE_READBACK_CONTENT_TYPE_INVALID");
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) fail("RELEASE_READBACK_OVERSIZE");
  let bytes;
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { try { await reader.cancel(); } catch {} fail("RELEASE_READBACK_OVERSIZE"); }
      chunks.push(value);
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (bytes.byteLength > MAX_BODY_BYTES) fail("RELEASE_READBACK_OVERSIZE");
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail("RELEASE_READBACK_JSON_INVALID"); }
}

function validateScopeRow(row, lookup, nowMs, maxAgeMs) {
  const resource = row?.resource;
  const observation = row?.observation;
  if (!resource || !observation || resource.tenant_id !== lookup.tenant_id || resource.project_id !== lookup.project_id ||
      observation.tenant_id !== lookup.tenant_id || observation.project_id !== lookup.project_id ||
      observation.observation_id !== resource.provenance?.observation_id || observation.contradiction_status !== "NONE" ||
      !["INDEPENDENT_SYSTEM", "INDEPENDENT_HUMAN", "FORMAL"].includes(observation.independence)) {
    fail("RELEASE_SCOPE_BINDING_MISMATCH");
  }
  if (projectScopeResourceDigest(resource) !== resource.resource_digest ||
      projectScopeObservationDigest(observation) !== observation.observation_digest ||
      observation.observation_digest !== resource.provenance?.observation_digest ||
      observation.evidence_digest !== resource.provenance?.evidence_digest) fail("RELEASE_SCOPE_DIGEST_MISMATCH");
  const verifiedMs = Date.parse(resource.last_verified_at);
  const observedMs = Date.parse(observation.observed_at);
  if (!Number.isFinite(verifiedMs) || !Number.isFinite(observedMs) || verifiedMs !== observedMs ||
      verifiedMs > nowMs || nowMs - verifiedMs > maxAgeMs) fail("RELEASE_SCOPE_STALE");
  const source = observation.provenance?.source || {};
  if (resource.resource_type === "github_repository") {
    if (resource.provenance?.schema_version !== "project_scope_repository_provenance_v2" ||
        observation.source !== "github_repository_readback" ||
        source.schema_version !== "github_repository_readback_v1" ||
        source.repository !== resource.canonical_identifier) fail("RELEASE_SCOPE_PROVENANCE_INVALID");
  } else if (resource.resource_type === "render_service_origin") {
    if (resource.provenance?.schema_version !== "project_scope_render_origin_provenance_v2" ||
        observation.source !== "render_service_origin_readback" ||
        source.schema_version !== "render_service_origin_readback_v1" ||
        source.repository == null || source.service_id !== resource.canonical_identifier ||
        source.environment !== resource.environment) fail("RELEASE_SCOPE_PROVENANCE_INVALID");
  } else fail("RELEASE_SCOPE_RESOURCE_INVALID");
  return { resource, observation };
}

function releaseObservation(kind, source, observer, evidenceDigest, lookup, observedAt, freshUntil) {
  return {
    kind, source, observer, independence: "INDEPENDENT_SYSTEM", observed_at: observedAt,
    fresh_until: freshUntil, evidence_digest: evidenceDigest, status: "VERIFIED",
    tenant_id: lookup.tenant_id, project_id: lookup.project_id,
  };
}

export function createPostgresServerOwnedReleaseTupleObserver({
  pool, fetchImpl = globalThis.fetch, githubTokenResolver, now = () => new Date(),
  timeoutMs = 5_000, maxAgeMs = 15 * 60 * 1_000,
} = {}) {
  if (!pool || typeof pool.query !== "function" || typeof fetchImpl !== "function" || typeof githubTokenResolver !== "function") {
    fail("RELEASE_OBSERVER_UNAVAILABLE");
  }
  const boundedTimeout = Math.max(100, Math.min(30_000, Number(timeoutMs) || 5_000));
  const boundedAge = Math.max(60_000, Math.min(24 * 60 * 60 * 1_000, Number(maxAgeMs) || 15 * 60 * 1_000));
  return async (lookup) => {
    const nowValue = now();
    const nowMs = nowValue instanceof Date ? nowValue.getTime() : Date.parse(String(nowValue || ""));
    if (!Number.isFinite(nowMs)) fail("RELEASE_CLOCK_INVALID");
    const scope = await pool.query(`
      SELECT jsonb_build_object(
               'tenant_id',r.tenant_id,'resource_id',r.resource_id,'project_id',r.project_id,
               'resource_type',r.resource_type,'canonical_identifier',r.canonical_identifier,
               'environment',r.environment,'ownership',r.ownership,'active',r.active,
               'provenance',r.provenance,'resource_digest',r.resource_digest,
               'last_verified_at',r.last_verified_at
             ) AS resource,
             to_jsonb(o) AS observation
        FROM core_project_scope_resources r
        JOIN core_reality_observations o
          ON o.tenant_id=r.tenant_id AND o.project_id=r.project_id
         AND o.observation_id=(r.provenance->>'observation_id')::uuid
       WHERE r.tenant_id=$1 AND r.project_id=$2 AND r.active IS TRUE
         AND r.resource_type IN ('github_repository','render_service_origin')
       ORDER BY r.resource_type,r.environment,r.canonical_identifier
       LIMIT $3`, [lookup.tenant_id, lookup.project_id, MAX_SERVICES + 2]);
    const rows = scope.rows.map((row) => validateScopeRow(row, lookup, nowMs, boundedAge));
    const repositories = rows.filter(({ resource }) => resource.resource_type === "github_repository" && resource.environment === "shared");
    const services = rows.filter(({ resource }) => resource.resource_type === "render_service_origin");
    if (repositories.length !== 1 || services.length < 1 || services.length > MAX_SERVICES) fail("RELEASE_SCOPE_AMBIGUOUS");
    const repository = text(repositories[0].resource.canonical_identifier, "RELEASE_REPOSITORY_INVALID", 300);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) fail("RELEASE_REPOSITORY_INVALID");
    const token = text(await githubTokenResolver({ tenant_id: lookup.tenant_id, repository }), "RELEASE_GITHUB_TOKEN_UNAVAILABLE", 2_000);
    const api = `https://api.github.com/repos/${repository}`;
    const pull = await strictJson(fetchImpl, `${api}/pulls/${lookup.pull_request}`, { token, timeoutMs: boundedTimeout });
    if (pull?.merged_at || pull?.base?.repo?.full_name !== repository || pull?.head?.repo?.full_name !== repository) fail("RELEASE_GITHUB_BINDING_MISMATCH");
    const baseCommit = sha(pull?.base?.sha, "RELEASE_BASE_COMMIT_INVALID");
    const headCommit = sha(pull?.head?.sha, "RELEASE_HEAD_COMMIT_INVALID");
    const commit = await strictJson(fetchImpl, `${api}/git/commits/${headCommit}`, { token, timeoutMs: boundedTimeout });
    const treeSha = sha(commit?.tree?.sha, "RELEASE_TREE_SHA_INVALID");
    const changedFiles = [];
    for (let page = 1; page <= Math.ceil(MAX_FILES / PAGE_SIZE); page += 1) {
      const filePage = await strictJson(fetchImpl, `${api}/pulls/${lookup.pull_request}/files?per_page=${PAGE_SIZE}&page=${page}`, { token, timeoutMs: boundedTimeout });
      if (!Array.isArray(filePage)) fail("RELEASE_CHANGED_FILES_INVALID");
      for (const file of filePage) {
        if (changedFiles.length >= MAX_FILES) fail("RELEASE_CHANGED_FILES_INVALID");
        changedFiles.push(text(file?.filename, "RELEASE_CHANGED_FILES_INVALID", 1_000));
        if (file?.previous_filename) changedFiles.push(text(file.previous_filename, "RELEASE_CHANGED_FILES_INVALID", 1_000));
      }
      if (filePage.length < PAGE_SIZE) break;
    }
    const uniqueFiles = [...new Set(changedFiles)].sort();
    if (!uniqueFiles.length) fail("RELEASE_CHANGED_FILES_INVALID");
    const observedServices = [];
    const serviceEvidence = [];
    let deliveryMethod = null;
    let rollbackMode = null;
    let rollbackTarget = null;
    let rollbackReceipt = null;
    for (const { resource, observation } of services) {
      if (observation.provenance?.source?.repository !== repository) fail("RELEASE_SCOPE_BINDING_MISMATCH");
      const origin = String(observation.provenance?.source?.origin || "").trim().toLowerCase();
      if (!ORIGIN.test(origin)) fail("RELEASE_SERVICE_ORIGIN_INVALID");
      const ownership = resource.ownership || {};
      const method = text(ownership.delivery_method, "RELEASE_DELIVERY_METHOD_UNBOUND", 120);
      const resolution = text(ownership.target_resolution, "RELEASE_TARGET_RESOLUTION_UNBOUND", 120);
      const mode = text(ownership.rollback_mode, "RELEASE_ROLLBACK_MODE_UNBOUND", 80);
      const receipt = digest(ownership.rollback_receipt_digest, "RELEASE_ROLLBACK_RECEIPT_UNBOUND");
      if (deliveryMethod && deliveryMethod !== method || rollbackMode && rollbackMode !== mode || rollbackReceipt && rollbackReceipt !== receipt) {
        fail("RELEASE_SERVICE_POLICY_MISMATCH");
      }
      deliveryMethod = method; rollbackMode = mode; rollbackReceipt = receipt;
      const health = await strictJson(fetchImpl, `${origin}/healthz`, { timeoutMs: boundedTimeout });
      if (health?.ok !== true || health?.render_ready !== true || health?.readiness_verified !== true ||
          health?.causal_continuity?.state !== "ready" || health?.research_airlock?.ready !== true) fail("RELEASE_SERVICE_NOT_READY");
      const liveCommit = sha(health.build_commit_sha || health.commit_sha || health.build_id, "RELEASE_LIVE_COMMIT_INVALID");
      if (rollbackTarget && rollbackTarget !== liveCommit) fail("RELEASE_ROLLBACK_MISMATCH");
      rollbackTarget = liveCommit;
      const healthDigest = causalDigest(health);
      observedServices.push({
        service_id: text(resource.canonical_identifier, "RELEASE_SERVICE_ID_INVALID", 160),
        environment: text(resource.environment, "RELEASE_SERVICE_ENVIRONMENT_INVALID", 80), origin,
        previous_commit: liveCommit, target_commit: headCommit, target_resolution: resolution,
        health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
        rollback_health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      });
      serviceEvidence.push({ service_id: resource.canonical_identifier, health_digest: healthDigest, scope_evidence: observation.evidence_digest });
    }
    const observedAt = new Date(nowMs).toISOString();
    const freshUntil = new Date(nowMs + Math.min(boundedAge, 5 * 60 * 1_000)).toISOString();
    const githubEvidence = causalDigest({ repository, pull_request: lookup.pull_request, base_commit: baseCommit, head_commit: headCommit, tree_sha: treeSha, changed_files: uniqueFiles });
    const scopeEvidence = causalDigest(rows.map(({ resource, observation }) => ({ resource_digest: resource.resource_digest, observation_digest: observation.observation_digest })));
    const renderEvidence = causalDigest(serviceEvidence.sort((a, b) => a.service_id.localeCompare(b.service_id)));
    return {
      phase: "PRE_ACTION", repository,
      base_branch: text(pull?.base?.ref, "RELEASE_BASE_BRANCH_INVALID", 240),
      delivery_branch: text(pull?.head?.ref, "RELEASE_DELIVERY_BRANCH_INVALID", 240),
      pull_request: lookup.pull_request, base_commit: baseCommit, head_commit: headCommit, merge_commit: null,
      tree_sha: treeSha,
      diff_digest: hostNativeGithubDiffDigest({ repository, base_commit: baseCommit, head_commit: headCommit, tree_sha: treeSha, changed_files: uniqueFiles }),
      changed_files: uniqueFiles, delivery_method: deliveryMethod, services: observedServices,
      rollback: { mode: rollbackMode, target_commit: rollbackTarget, health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST, ready: true, receipt_digest: rollbackReceipt },
      observations: {
        github: releaseObservation("GITHUB", "github_api", "universal-core-github-readback", githubEvidence, lookup, observedAt, freshUntil),
        project_scope: releaseObservation("PROJECT_SCOPE", "causal_project_scope", "universal-core-project-scope", scopeEvidence, lookup, observedAt, freshUntil),
        render: releaseObservation("RENDER", "render_healthz", "universal-core-render-readback", renderEvidence, lookup, observedAt, freshUntil),
        receipt: releaseObservation("RECEIPT", "project_scope_rollback_receipt", "universal-core-receipt-readback", rollbackReceipt, lookup, observedAt, freshUntil),
      },
      observed_at: observedAt, expires_at: freshUntil,
    };
  };
}

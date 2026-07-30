import crypto from "node:crypto";

import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  HOST_NATIVE_HEALTH_CONTRACT_VERSION,
  hostNativeDigest,
  hostNativeGithubDiffDigest,
} from "./hostNativeGovernance.js";

const MAX_RESPONSE_BYTES = 256_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const GITHUB_ORIGIN = "https://api.github.com";
const RENDER_ORIGIN = /^https:\/\/[a-z0-9][a-z0-9-]*\.onrender\.com$/;
const SHA = /^[a-f0-9]{40}$/;

function error(code) {
  throw new Error(code);
}

function string(value) {
  return String(value || "").trim();
}

function sha(value) {
  const normalized = string(value).toLowerCase();
  return SHA.test(normalized) ? normalized : null;
}

function stableStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(string).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function sameStrings(left, right) {
  const a = stableStrings(left);
  const b = stableStrings(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isoNow(now) {
  const instant = new Date(typeof now === "function" ? now() : Date.now());
  if (Number.isNaN(instant.getTime())) error("trusted_readback_clock_invalid");
  return instant.toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function originForHealth(value, code = "trusted_readback_render_origin_invalid") {
  const origin = string(value).toLowerCase();
  if (!RENDER_ORIGIN.test(origin)) error(code);
  let url;
  try {
    url = new URL(origin);
  } catch {
    error(code);
  }
  if (
    url.protocol !== "https:" || url.port || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash ||
    url.hostname !== origin.slice("https://".length) ||
    url.hostname.split(".").length !== 3
  ) {
    error(code);
  }
  return origin;
}

function repositoryPath(repository) {
  const normalized = string(repository);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    error("trusted_readback_repository_invalid");
  }
  return normalized;
}

function knownReadbackError(value) {
  const message = String(value?.message || "");
  return /^(trusted_readback|release_join_verdict|check_app_mismatch|details_url_invalid|workflow_)/.test(message);
}

function createBoundedCache(maximumEntries = 64) {
  const maximum_entries = Math.max(1, Math.min(1_000, Number(maximumEntries) || 64));
  const values = new Map();
  return Object.freeze({
    maximum_entries,
    get(key) {
      if (!values.has(key)) return undefined;
      const value = values.get(key);
      values.delete(key);
      values.set(key, value);
      return value;
    },
    set(key, value) {
      if (values.has(key)) values.delete(key);
      values.set(key, value);
      while (values.size > maximum_entries) values.delete(values.keys().next().value);
      return value;
    },
    size() { return values.size; },
  });
}

async function readResponseJson(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response || response.ok !== true) error("trusted_readback_unavailable");
    const contentType = string(response.headers?.get?.("content-type") || response.headers?.["content-type"]);
    if (!/(^|\s|;)application\/(?:[a-z0-9.+-]*\+)?json(?:\s|;|$)/i.test(contentType)) {
      error("trusted_readback_response_invalid");
    }
    const declared = Number(response.headers?.get?.("content-length") || response.headers?.["content-length"] || 0);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      error("trusted_readback_response_too_large");
    }
    const reader = response.body?.getReader?.();
    if (!reader) error("trusted_readback_response_invalid");
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        const bytes = item.value instanceof Uint8Array
          ? item.value
          : new Uint8Array(item.value || []);
        length += bytes.byteLength;
        if (length > MAX_RESPONSE_BYTES) error("trusted_readback_response_too_large");
        chunks.push(bytes);
      }
    } finally {
      reader.releaseLock?.();
    }
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    try {
      return JSON.parse(body);
    } catch {
      error("trusted_readback_response_invalid");
    }
  } catch (cause) {
    if (knownReadbackError(cause)) throw cause;
    if (controller.signal.aborted) error("trusted_readback_unavailable");
    error("trusted_readback_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function githubHeaders(token) {
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "skinharmony-universal-core-host-native-readback",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function renderHeaders() {
  return {
    accept: "application/json",
    "user-agent": "skinharmony-universal-core-host-native-readback",
  };
}

async function resolveGithubToken(githubTokenResolver, scope) {
  if (typeof githubTokenResolver !== "function") return null;
  try {
    const token = string(await githubTokenResolver({
      tenant_id: scope.tenant_id,
      repository: scope.repository,
    }));
    if (!token || token.length > 4_096) error("trusted_readback_github_credential_unavailable");
    return token;
  } catch (cause) {
    if (knownReadbackError(cause)) throw cause;
    error("trusted_readback_github_credential_unavailable");
  }
}

function githubClient({ fetchImpl, token, repository, timeoutMs }) {
  const safeRepository = repositoryPath(repository);
  return async (path) => readResponseJson(
    fetchImpl,
    `${GITHUB_ORIGIN}/repos/${safeRepository}${path}`,
    { method: "GET", redirect: "error", headers: githubHeaders(token) },
    timeoutMs,
  );
}

function ensureChecks(payload, commit, requiredChecks, strict = null) {
  const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : null;
  if (!runs) error("trusted_readback_checks_not_ready");
  const required = stableStrings(requiredChecks);
  const selected = [];
  for (const name of required) {
    const candidates = runs.filter((run) => (
      string(run?.name) === name && sha(run?.head_sha) === commit
    ));
    if (strict) {
      const malformedApp = candidates.some((run) => (
        Number(run?.app?.id) !== strict.policy.check_app.id ||
        string(run?.app?.slug) !== strict.policy.check_app.slug ||
        string(run?.app?.owner?.login) !== strict.policy.check_app.owner
      ));
      if (malformedApp) error("check_app_mismatch");
    }
    const completed = candidates.filter((run) => (
      run?.status === "completed" && run?.conclusion === "success" &&
      (!strict || (
        Number(run?.app?.id) === strict.policy.check_app.id &&
        string(run?.app?.slug) === strict.policy.check_app.slug &&
        string(run?.app?.owner?.login) === strict.policy.check_app.owner
      ))
    ));
    if (completed.length === 0) error("trusted_readback_checks_not_ready");
    completed.sort((left, right) => Number(right.id || 0) - Number(left.id || 0));
    selected.push(completed[0]);
  }
  return selected;
}

function detailWorkflowRunId(detailsUrl, repository) {
  let url;
  try { url = new URL(string(detailsUrl)); }
  catch { error("details_url_invalid"); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.search || url.hash) {
    error("details_url_invalid");
  }
  const expected = `/${repository}/actions/runs/`;
  if (!url.pathname.startsWith(expected)) error("details_url_invalid");
  const rest = url.pathname.slice(expected.length).split("/");
  if (!/^\d+$/.test(rest[0]) || rest.slice(1).some((part) => part && !/^(?:job|jobs|\d+)$/.test(part))) {
    error("details_url_invalid");
  }
  return Number(rest[0]);
}

function validateRequiredChecksPolicy(policy, scope, requiredChecks, action) {
  if (!policy || typeof policy !== "object") error("required_checks_policy_unavailable");
  if (
    policy.schema_version !== "host_native_required_checks_policy_v1" ||
    string(policy.tenant_id) !== scope.tenant_id ||
    string(policy.repository) !== scope.repository ||
    string(policy.base_branch) !== scope.base_branch ||
    !sameStrings(policy.required_checks, requiredChecks)
  ) {
    error("required_checks_policy_mismatch");
  }
  const workflow = policy.workflow || {};
  const checkApp = policy.check_app || {};
  if (
    !Number.isSafeInteger(Number(checkApp.id)) || !string(checkApp.slug) ||
    !string(checkApp.owner) || !Number.isSafeInteger(Number(workflow.id)) ||
    !string(workflow.name) || !/^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(string(workflow.path)) ||
    !/^[a-f0-9]{64}$/.test(string(workflow.sha256))
  ) {
    error("required_checks_policy_invalid");
  }
  const event = action?.kind === "github.merge" ? "pull_request" : "push";
  if (!Array.isArray(policy.allowed_events) || !policy.allowed_events.includes(event)) {
    error("required_checks_policy_event_denied");
  }
  return {
    ...policy,
    required_checks: stableStrings(policy.required_checks),
    check_app: { id: Number(checkApp.id), slug: string(checkApp.slug), owner: string(checkApp.owner) },
    workflow: {
      id: Number(workflow.id),
      name: string(workflow.name),
      path: string(workflow.path),
      sha256: string(workflow.sha256),
      candidate_sha256: workflow.candidate_sha256 == null ? null : string(workflow.candidate_sha256),
    },
  };
}

async function resolvePolicy(resolver, scope, requiredChecks, action) {
  if (typeof resolver !== "function") return null;
  let policy;
  try { policy = await resolver(scope); }
  catch (cause) {
    if (knownReadbackError(cause)) throw cause;
    error("required_checks_policy_unavailable");
  }
  return validateRequiredChecksPolicy(policy, scope, requiredChecks, action);
}

async function strictWorkflowEvidence({
  getGithub,
  selectedChecks,
  policy,
  repository,
  action,
  checksCommit,
  baseCommit,
  workflowRunCache,
  workflowSourceCache,
}) {
  const workflowRunIds = new Set(selectedChecks.map((check) =>
    detailWorkflowRunId(check.details_url, repository),
  ));
  if (workflowRunIds.size !== 1) error("workflow_run_mixed");
  const workflowRunId = [...workflowRunIds][0];
  const cachedRun = workflowRunCache.get(`${repository}\u0000${workflowRunId}`);
  const workflowRun = cachedRun || workflowRunCache.set(
    `${repository}\u0000${workflowRunId}`,
    await getGithub(`/actions/runs/${workflowRunId}`),
  );
  const merge = action?.kind === "github.merge";
  if (!merge && sha(action?.source_commit) !== checksCommit) {
    error("workflow_source_commit_mismatch");
  }
  const runMatches = (
    Number(workflowRun?.id) === workflowRunId &&
    Number(workflowRun?.workflow_id) === policy.workflow.id &&
    string(workflowRun?.name) === policy.workflow.name &&
    string(workflowRun?.path) === policy.workflow.path &&
    string(workflowRun?.repository?.full_name) === repository &&
    sha(workflowRun?.head_sha) === checksCommit &&
    workflowRun?.status === "completed" && workflowRun?.conclusion === "success" &&
    string(workflowRun?.event) === (merge ? "pull_request" : "push") &&
    string(workflowRun?.head_branch) === (merge ? action.head_branch : action.branch)
  );
  if (!runMatches) error("workflow_run_mismatch");
  if (merge) {
    const pull = Array.isArray(workflowRun.pull_requests) ? workflowRun.pull_requests : [];
    const match = pull.some((entry) => (
      Number(entry?.number) === Number(action.pull_request) &&
      string(entry?.head?.ref) === string(action.head_branch) &&
      sha(entry?.head?.sha) === sha(action.head_commit) &&
      string(entry?.base?.ref) === string(action.base_branch) &&
      sha(entry?.base?.sha) === sha(action.expected_base_commit) &&
      string(new URL(string(entry?.url || "https://invalid.example")).pathname) ===
        `/repos/${repository}/pulls/${Number(action.pull_request)}`
    ));
    if (!match) error("workflow_pull_request_mismatch");
  }
  async function source(role, commit) {
    const key = `${repository}\u0000${commit}\u0000${policy.workflow.path}`;
    const cached = workflowSourceCache.get(key);
    if (cached) return cached;
    const response = await getGithub(`/contents/${policy.workflow.path}?ref=${commit}`);
    if (response?.type !== "file" || response?.encoding !== "base64" || typeof response?.content !== "string") {
      error("workflow_source_mismatch");
    }
    let raw;
    try { raw = Buffer.from(response.content.replace(/\s/g, ""), "base64"); }
    catch { error("workflow_source_mismatch"); }
    if (raw.length > MAX_RESPONSE_BYTES) error("workflow_source_mismatch");
    return workflowSourceCache.set(key, {
      role,
      commit,
      path: policy.workflow.path,
      sha256: sha256(raw),
    });
  }
  const sources = [await source("base", baseCommit), await source("head", checksCommit)];
  const current = policy.workflow.sha256;
  const candidate = policy.workflow.candidate_sha256;
  if (sources.some((entry) => entry.sha256 !== current && entry.sha256 !== candidate)) {
    error("workflow_source_mismatch");
  }
  if ((!candidate && sources.some((entry) => entry.sha256 !== current)) ||
      (candidate && sources[0].sha256 === candidate && sources[1].sha256 === current)) {
    error("workflow_source_rotation_mismatch");
  }
  return { workflowRunId, workflowRun, sources };
}

async function attestChecks({
  getGithub,
  tenantId,
  repository,
  baseBranch,
  baseCommit,
  checksCommit,
  requiredChecks,
  action,
  requiredChecksPolicyResolver,
  workflowRunCache,
  workflowSourceCache,
}) {
  const policy = await resolvePolicy(requiredChecksPolicyResolver, {
    tenant_id: tenantId,
    repository,
    base_branch: baseBranch,
  }, requiredChecks, action);
  const checksPayload = await getGithub(`/commits/${checksCommit}/check-runs?per_page=100`);
  const selectedChecks = ensureChecks(checksPayload, checksCommit, requiredChecks, policy && { policy });
  const observed_checks = selectedChecks.map((check) => ({
    name: string(check.name),
    head_commit: checksCommit,
    status: "completed",
    conclusion: "success",
  }));
  if (!policy) return {
    required_checks: stableStrings(requiredChecks),
    observed_checks,
    checks_attestation_digest: hostNativeDigest({
      checks_commit: checksCommit,
      required_checks: stableStrings(requiredChecks),
      observed_checks,
    }),
    required_checks_policy_digest: null,
    workflow_sources: null,
  };
  const strict = await strictWorkflowEvidence({
    getGithub,
    selectedChecks,
    policy,
    repository,
    action,
    checksCommit,
    baseCommit,
    workflowRunCache,
    workflowSourceCache,
  });
  const strictObserved = observed_checks.map((entry, index) => ({
    ...entry,
    check_run_id: Number(selectedChecks[index].id),
    workflow_run_id: strict.workflowRunId,
    workflow_run_attempt: Number(strict.workflowRun.run_attempt || 1),
    workflow_id: policy.workflow.id,
  }));
  const policyDigest = hostNativeDigest({
    schema_version: policy.schema_version,
    tenant_id: policy.tenant_id,
    repository: policy.repository,
    base_branch: policy.base_branch,
    required_checks: policy.required_checks,
    check_app: policy.check_app,
    workflow: policy.workflow,
    allowed_events: stableStrings(policy.allowed_events),
  });
  return {
    required_checks: policy.required_checks,
    observed_checks: strictObserved,
    checks_attestation_digest: hostNativeDigest({
      checks_commit: checksCommit,
      required_checks: policy.required_checks,
      observed_checks: strictObserved,
      workflow_sources: strict.sources,
      required_checks_policy_digest: policyDigest,
    }),
    required_checks_policy_digest: policyDigest,
    workflow_sources: strict.sources,
  };
}

function validateMergePullRequest(pull, action, repository, targetCommit, { merged }) {
  const matches = (
    Boolean(pull?.merged) === merged &&
    (!merged || sha(pull?.merge_commit_sha) === targetCommit) &&
    sha(pull?.head?.sha) === sha(action.head_commit) &&
    string(pull?.head?.ref) === string(action.head_branch) &&
    string(pull?.head?.repo?.full_name) === repository &&
    sha(pull?.base?.sha) === sha(action.expected_base_commit) &&
    string(pull?.base?.ref) === string(action.base_branch) &&
    string(pull?.base?.repo?.full_name) === repository
  );
  return matches;
}

function healthAttestation({ service, origin, health, liveCommit, rollbackCommit, previous = false }) {
  const matches = (
    health?.ok === true && health?.render_ready === true &&
    health?.build?.commit_verifiable === true && sha(health?.build?.commit_sha) === liveCommit &&
    health?.health_contract_version === HOST_NATIVE_HEALTH_CONTRACT_VERSION &&
    string(health?.health_contract_digest) === service.health_contract_digest &&
    string(service.health_contract_digest) === HOST_NATIVE_HEALTH_CONTRACT_DIGEST
  );
  if (!matches) error(previous
    ? "release_join_verdict_previous_live_mismatch"
    : "trusted_readback_render_health_mismatch");
  const unsigned = {
    service_id: string(service.service_id),
    environment: string(service.environment),
    origin,
    health_path: "/healthz",
    deployment_id: string(health.build.build_id),
    live_commit: liveCommit,
    version: string(health.version),
    health_status: "healthy",
    health_contract_digest: service.health_contract_digest,
  };
  if (!previous) {
    unsigned.rollback_commit = rollbackCommit;
    unsigned.rollback_status = "previous_live_attested";
  }
  return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
}

function expectedPrevious(ticket, service) {
  const entries = ticket?.release_manifest_binding?.join_resolution?.previous_live_attestations;
  if (!Array.isArray(entries)) return null;
  return entries.find((entry) => (
    string(entry?.service_id) === string(service.service_id) &&
    string(entry?.environment) === string(service.environment) &&
    string(entry?.origin).toLowerCase() === string(service.origin).toLowerCase()
  )) || null;
}

/**
 * Build a trusted post-action GitHub + Render readback.  Nothing supplied by
 * the caller is accepted as proof: GitHub and each fixed Render health URL are
 * queried again through bounded, non-redirecting GET requests.
 */
export function createHostNativeExternalReadbackVerifier({
  fetchImpl = globalThis.fetch,
  githubTokenResolver = null,
  requiredChecksPolicyResolver = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => Date.now(),
  workflowRunCacheMaximumEntries = 64,
  workflowSourceCacheMaximumEntries = workflowRunCacheMaximumEntries,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("trusted_readback_fetch_unavailable");
  const boundedTimeout = Math.max(100, Math.min(60_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const workflow_run_cache = createBoundedCache(workflowRunCacheMaximumEntries);
  const workflow_source_cache = createBoundedCache(workflowSourceCacheMaximumEntries);
  const verify = async ({ ticket, target_commit }) => {
    const tenantId = string(ticket?.tenant_id);
    const repository = repositoryPath(ticket?.repository);
    const action = ticket?.action || {};
    const binding = ticket?.release_manifest_binding || {};
    const targetCommit = sha(target_commit);
    const checksCommit = sha(binding?.verification?.checks_commit || action.checks_commit);
    const baseCommit = sha(binding?.base_commit || action.expected_base_commit || action.expected_remote_commit);
    const rollbackCommit = sha(binding?.rollback?.target_commit);
    const baseBranch = string(binding?.base_branch || action.base_branch || action.branch);
    if (!tenantId || !targetCommit || !checksCommit || !baseCommit || !rollbackCommit || !baseBranch) {
      error("trusted_readback_ticket_invalid");
    }
    const token = await resolveGithubToken(githubTokenResolver, { tenant_id: tenantId, repository });
    const getGithub = githubClient({ fetchImpl, token, repository, timeoutMs: boundedTimeout });
    const checks = await attestChecks({
      getGithub,
      tenantId,
      repository,
      baseBranch,
      baseCommit,
      checksCommit,
      requiredChecks: binding?.verification?.required_checks,
      action,
      requiredChecksPolicyResolver,
      workflowRunCache: workflow_run_cache,
      workflowSourceCache: workflow_source_cache,
    });
    let mergeCommit = null;
    let branch = null;
    let branchCommit = null;
    let merged = null;
    if (action.kind === "github.merge") {
      const pull = await getGithub(`/pulls/${Number(action.pull_request)}`);
      if (!validateMergePullRequest(pull, action, repository, targetCommit, { merged: true })) {
        error("trusted_readback_github_merge_mismatch");
      }
      mergeCommit = targetCommit;
      merged = true;
    } else if (action.kind === "git.push.protected") {
      branch = string(action.branch);
      if (!branch || /(^|\/)\.\.($|\/)/.test(branch)) error("trusted_readback_ticket_invalid");
      const ref = await getGithub(`/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, "/")}`);
      branchCommit = sha(ref?.object?.sha);
      if (branchCommit !== targetCommit || targetCommit !== sha(action.source_commit)) {
        error("trusted_readback_branch_commit_mismatch");
      }
    } else {
      error("trusted_readback_action_invalid");
    }
    const target = await getGithub(`/commits/${targetCommit}`);
    if (sha(target?.sha) !== targetCommit) error("trusted_readback_target_commit_mismatch");
    const rollback = await getGithub(`/commits/${rollbackCommit}`);
    if (sha(rollback?.sha) !== rollbackCommit) error("trusted_readback_rollback_unavailable");
    const sourceServices = Array.isArray(binding?.services) ? binding.services : [];
    if (sourceServices.length < 1) error("trusted_readback_services_invalid");
    const services = [];
    for (const service of sourceServices) {
      const origin = originForHealth(service?.origin);
      const prior = expectedPrevious(ticket, service);
      if (
        !prior || sha(prior.live_commit) !== rollbackCommit ||
        string(prior.health_contract_digest) !== string(service.health_contract_digest)
      ) {
        error("trusted_readback_render_health_mismatch");
      }
      const health = await readResponseJson(
        fetchImpl,
        `${origin}/healthz`,
        { method: "GET", redirect: "error", headers: renderHeaders() },
        boundedTimeout,
      );
      services.push(healthAttestation({
        service,
        origin,
        health,
        liveCommit: targetCommit,
        rollbackCommit,
      }));
    }
    services.sort((left, right) => left.service_id.localeCompare(right.service_id));
    const githubUnsigned = {
      api_origin: GITHUB_ORIGIN,
      repository,
      action_kind: action.kind,
      head_branch: action.kind === "github.merge" ? string(action.head_branch) : null,
      base_branch: action.kind === "github.merge" ? string(action.base_branch) : null,
      pull_request: action.kind === "github.merge" ? Number(action.pull_request) : null,
      merged,
      head_commit: action.kind === "github.merge" ? sha(action.head_commit) : checksCommit,
      expected_base_commit: action.kind === "github.merge" ? sha(action.expected_base_commit) : sha(action.expected_remote_commit),
      merge_commit: mergeCommit,
      target_commit: targetCommit,
      branch,
      branch_commit: branchCommit,
      checks_commit: checksCommit,
      checks_passed: true,
      required_checks: checks.required_checks,
      observed_checks: checks.observed_checks,
      rollback_commit: rollbackCommit,
      rollback_commit_available: true,
      ...(checks.required_checks_policy_digest ? {
        required_checks_policy_digest: checks.required_checks_policy_digest,
        checks_attestation_digest: checks.checks_attestation_digest,
        workflow_sources: checks.workflow_sources,
      } : {}),
    };
    return {
      schema_version: "host_native_external_readback_v1",
      trusted: true,
      verifier_id: "core_server_external_readback_v1",
      verified_at: isoNow(now),
      github: { ...githubUnsigned, readback_digest: hostNativeDigest(githubUnsigned) },
      services,
      external_side_effect: false,
      provider_execution: false,
    };
  };
  Object.defineProperties(verify, {
    trusted: { value: true },
    workflow_run_cache: { value: workflow_run_cache },
    workflow_source_cache: { value: workflow_source_cache },
  });
  return verify;
}

function sourceFilesEqual(actual, expected) {
  return sameStrings(actual, expected);
}

/**
 * Independently attests the pre-merge source and the previous live deployment
 * used by a Core-join verdict.  This is deliberately separate from the
 * post-action verifier so a caller cannot smuggle source evidence into a
 * release ticket.
 */
export function createHostNativeReleaseJoinVerdictResolver({
  fetchImpl = globalThis.fetch,
  githubTokenResolver = null,
  requiredChecksPolicyResolver = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => Date.now(),
  workflowRunCacheMaximumEntries = 64,
  workflowSourceCacheMaximumEntries = workflowRunCacheMaximumEntries,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("trusted_readback_fetch_unavailable");
  const boundedTimeout = Math.max(100, Math.min(60_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const workflowRunCache = createBoundedCache(workflowRunCacheMaximumEntries);
  const workflowSourceCache = createBoundedCache(workflowSourceCacheMaximumEntries);
  const resolve = async (request) => {
    if (request?.core_join_verified !== true || request?.provider_execution === true) {
      error("release_join_verdict_untrusted");
    }
    const tenantId = string(request.tenant_id);
    const repository = repositoryPath(request.repository);
    const action = request.action || {};
    const source = request.source_evidence || {};
    const headCommit = sha(source.head_commit);
    const baseCommit = sha(source.base_commit);
    const treeSha = sha(source.tree_sha);
    const checksCommit = sha(request.checks_commit);
    const baseBranch = string(action.base_branch || action.branch);
    if (!tenantId || !headCommit || !baseCommit || !treeSha || !checksCommit || !baseBranch || checksCommit !== headCommit) {
      error("release_join_verdict_source_attestation_mismatch");
    }
    if (string(source.diff_digest) !== hostNativeGithubDiffDigest({
      repository,
      base_commit: baseCommit,
      head_commit: headCommit,
      tree_sha: treeSha,
      changed_files: source.changed_files,
    })) {
      error("release_join_verdict_source_attestation_mismatch");
    }
    const token = await resolveGithubToken(githubTokenResolver, { tenant_id: tenantId, repository });
    const getGithub = githubClient({ fetchImpl, token, repository, timeoutMs: boundedTimeout });
    const commit = await getGithub(`/commits/${headCommit}`);
    if (sha(commit?.sha) !== headCommit || sha(commit?.commit?.tree?.sha) !== treeSha) {
      error("release_join_verdict_source_attestation_mismatch");
    }
    await attestChecks({
      getGithub,
      tenantId,
      repository,
      baseBranch,
      baseCommit,
      checksCommit,
      requiredChecks: request.required_checks,
      action,
      requiredChecksPolicyResolver,
      workflowRunCache,
      workflowSourceCache,
    });
    if (action.kind !== "github.merge") error("release_join_verdict_action_invalid");
    const pull = await getGithub(`/pulls/${Number(action.pull_request)}`);
    if (!validateMergePullRequest(pull, action, repository, null, { merged: false })) {
      error("release_join_verdict_pull_request_mismatch");
    }
    const files = [];
    for (let page = 1; page <= 100; page += 1) {
      const response = await getGithub(`/pulls/${Number(action.pull_request)}/files?per_page=100&page=${page}`);
      if (!Array.isArray(response)) error("release_join_verdict_changed_files_mismatch");
      for (const item of response) {
        if (string(item?.filename)) files.push(string(item.filename));
        if (string(item?.previous_filename)) files.push(string(item.previous_filename));
      }
      if (response.length < 100) break;
      if (page === 100) error("release_join_verdict_changed_files_mismatch");
    }
    if (!sourceFilesEqual(files, source.changed_files)) {
      error("release_join_verdict_changed_files_mismatch");
    }
    const delivery = Array.isArray(request.delivery_services) ? request.delivery_services : [];
    if (delivery.length < 1) error("release_join_verdict_previous_live_mismatch");
    const previous_live_attestations = [];
    for (const service of delivery) {
      const origin = originForHealth(service?.origin, "release_join_verdict_previous_live_mismatch");
      const expectedLive = sha(service?.expected_previous_commit);
      if (!expectedLive) error("release_join_verdict_previous_live_mismatch");
      const health = await readResponseJson(
        fetchImpl,
        `${origin}/healthz`,
        { method: "GET", redirect: "error", headers: renderHeaders() },
        boundedTimeout,
      );
      previous_live_attestations.push(healthAttestation({
        service,
        origin,
        health,
        liveCommit: expectedLive,
        rollbackCommit: null,
        previous: true,
      }));
    }
    previous_live_attestations.sort((left, right) => left.service_id.localeCompare(right.service_id));
    const sourceUnsigned = {
      schema_version: "host_native_source_attestation_v1",
      repository,
      evidence_kind: "github_pull_request_files",
      pull_request: Number(action.pull_request),
      base_commit: baseCommit,
      head_commit: headCommit,
      tree_sha: treeSha,
      changed_files: stableStrings(source.changed_files),
      diff_digest: string(source.diff_digest),
    };
    const source_attestation = {
      ...sourceUnsigned,
      attestation_digest: hostNativeDigest(sourceUnsigned),
    };
    const pre_action_readback_digest = hostNativeDigest({
      source_attestation,
      previous_live_attestations,
    });
    return {
      schema_version: "host_native_release_join_resolution_v1",
      trusted: true,
      authority: "universal_core",
      allowed: true,
      verdict_id: string(request.verdict_id),
      tenant_id: tenantId,
      work_id: string(request.work_id),
      intent_anchor_digest: string(request.intent_anchor_digest),
      repository,
      checks_commit: checksCommit,
      evidence_digest: string(request.evidence_digest),
      issued_at: string(request.core_join_issued_at),
      resolved_at: isoNow(now),
      source_attestation,
      previous_live_attestations,
      pre_action_readback_digest,
      provider_execution: false,
    };
  };
  Object.defineProperty(resolve, "trusted", { value: true });
  return resolve;
}

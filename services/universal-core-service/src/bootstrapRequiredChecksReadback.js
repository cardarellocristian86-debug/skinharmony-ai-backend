import crypto from "node:crypto";

const GITHUB_ORIGIN = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 256_000;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function fail(code) { throw new Error(code); }
function text(value) { return String(value || "").trim(); }
function sha(value) { const normalized = text(value).toLowerCase(); return SHA.test(normalized) ? normalized : fail("bootstrap_required_checks_sha_invalid"); }
function stableStrings(values) { return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function sameStrings(left, right) { const a = stableStrings(left); const b = stableStrings(right); return a.length === b.length && a.every((value, index) => value === b[index]); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function bytesDigest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function repository(value) { const normalized = text(value); return REPOSITORY.test(normalized) ? normalized : fail("bootstrap_required_checks_repository_invalid"); }
function exactKeys(value, fields, code) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")) fail(code); }

async function readJson(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response?.ok) fail("bootstrap_required_checks_github_unavailable");
    const contentType = text(response.headers?.get?.("content-type") || response.headers?.["content-type"]);
    if (!/(^|\s|;)application\/(?:[a-z0-9.+-]*\+)?json(?:\s|;|$)/i.test(contentType)) fail("bootstrap_required_checks_response_invalid");
    const declared = Number(response.headers?.get?.("content-length") || response.headers?.["content-length"] || 0);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail("bootstrap_required_checks_response_too_large");
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) fail("bootstrap_required_checks_response_too_large");
    try { return JSON.parse(raw); } catch { fail("bootstrap_required_checks_response_invalid"); }
  } catch (error) {
    if (String(error?.message || "").startsWith("bootstrap_required_checks_")) throw error;
    fail("bootstrap_required_checks_github_unavailable");
  } finally { clearTimeout(timeout); }
}

async function resolveToken(resolver, scope) {
  if (typeof resolver !== "function") fail("bootstrap_required_checks_github_credential_unavailable");
  let resolved;
  try { resolved = await resolver(scope); } catch { fail("bootstrap_required_checks_github_credential_unavailable"); }
  const token = typeof resolved === "string" ? text(resolved) : text(resolved?.token);
  if (!token || token.length > 4096) fail("bootstrap_required_checks_github_credential_unavailable");
  if (resolved && typeof resolved === "object" && text(resolved.tenant_id) !== scope.tenant_id) fail("bootstrap_required_checks_cross_tenant_credential_denied");
  return token;
}

function workflowSource(payload, expectedPath, role, commit) {
  if (!payload || payload.type !== "file" || payload.encoding !== "base64" ||
      text(payload.path) !== expectedPath || typeof payload.content !== "string") {
    fail("bootstrap_required_checks_workflow_source_invalid");
  }
  const encoded = payload.content.replace(/\s/g, "");
  if (!encoded || encoded.length > Math.ceil(MAX_RESPONSE_BYTES / 3) * 4 ||
      encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    fail("bootstrap_required_checks_workflow_source_invalid");
  }
  const source = Buffer.from(encoded, "base64");
  if (!source.length || source.length > MAX_RESPONSE_BYTES ||
      source.toString("base64") !== encoded) {
    fail("bootstrap_required_checks_workflow_source_invalid");
  }
  return Object.freeze({
    role,
    commit,
    path: expectedPath,
    sha256: bytesDigest(source),
  });
}

function normalizePolicy(policy, scope) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) fail("bootstrap_required_checks_policy_unavailable");
  exactKeys(policy, ["allowed_events", "base_branch", "check_app", "repository", "required_checks", "schema_version", "tenant_id", "workflow"], "bootstrap_required_checks_policy_invalid");
  if (policy.schema_version !== "host_native_required_checks_policy_v1" || text(policy.tenant_id) !== scope.tenant_id || text(policy.repository) !== scope.repository || text(policy.base_branch) !== scope.base_branch) fail("bootstrap_required_checks_policy_mismatch");
  const required_checks = stableStrings(policy.required_checks);
  if (!required_checks.length || required_checks.length > 50) fail("bootstrap_required_checks_policy_invalid");
  const checkApp = policy.check_app;
  const workflow = policy.workflow;
  exactKeys(checkApp, ["id", "owner", "slug"], "bootstrap_required_checks_policy_invalid");
  exactKeys(workflow, ["candidate_sha256", "id", "name", "path", "sha256"], "bootstrap_required_checks_policy_invalid");
  if (!Number.isSafeInteger(Number(checkApp.id)) || Number(checkApp.id) <= 0 || !text(checkApp.slug) || !text(checkApp.owner) || !Number.isSafeInteger(Number(workflow.id)) || Number(workflow.id) <= 0 || !text(workflow.name) || !/^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(text(workflow.path)) || !DIGEST.test(text(workflow.sha256))) fail("bootstrap_required_checks_policy_invalid");
  if (!Array.isArray(policy.allowed_events) || !policy.allowed_events.includes("pull_request")) fail("bootstrap_required_checks_policy_event_denied");
  return {
    schema_version: "host_native_required_checks_policy_v1", tenant_id: scope.tenant_id, repository: scope.repository, base_branch: scope.base_branch,
    required_checks, check_app: { id: Number(checkApp.id), slug: text(checkApp.slug), owner: text(checkApp.owner) },
    workflow: { id: Number(workflow.id), name: text(workflow.name), path: text(workflow.path), sha256: text(workflow.sha256), candidate_sha256: workflow.candidate_sha256 == null ? null : text(workflow.candidate_sha256) },
    allowed_events: stableStrings(policy.allowed_events),
  };
}

function normalizedChecks(payload, scope, policy) {
  const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : null;
  if (!runs) fail("bootstrap_required_checks_not_ready");
  return policy.required_checks.map((name) => {
    const candidates = runs.filter((run) => text(run?.name) === name && sha(run?.head_sha) === scope.head_sha);
    const selected = candidates.filter((run) => run?.status === "completed" && run?.conclusion === "success" && Number(run?.app?.id) === policy.check_app.id && text(run?.app?.slug) === policy.check_app.slug && text(run?.app?.owner?.login) === policy.check_app.owner)
      .sort((left, right) => Number(right.id || 0) - Number(left.id || 0))[0];
    if (!selected) fail("bootstrap_required_checks_not_ready");
    return { id: Number(selected.id), name, head_sha: scope.head_sha, status: "completed", conclusion: "success", app: { id: policy.check_app.id, slug: policy.check_app.slug, owner: policy.check_app.owner } };
  });
}

export function createBootstrapRequiredChecksReadback({ fetchImpl = globalThis.fetch, githubTokenResolver = null, requiredChecksPolicyResolver = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== "function") fail("bootstrap_required_checks_fetch_unavailable");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) fail("bootstrap_required_checks_timeout_invalid");
  return Object.freeze({
    async attest({ tenant_id, repository: repositoryInput, pr_number, head_sha, base_branch }) {
      const scope = {
        tenant_id: text(tenant_id), repository: repository(repositoryInput),
        pr_number: Number(pr_number), head_sha: sha(head_sha), base_branch: text(base_branch),
      };
      if (!scope.tenant_id || !Number.isSafeInteger(scope.pr_number) || scope.pr_number < 1) {
        fail("bootstrap_required_checks_scope_invalid");
      }
      const token = await resolveToken(githubTokenResolver, scope);
      const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "skinharmony-bootstrap-required-checks-readback", authorization: `Bearer ${token}` };
      const pr = await readJson(fetchImpl, `${GITHUB_ORIGIN}/repos/${scope.repository}/pulls/${scope.pr_number}`, { method: "GET", redirect: "error", headers }, timeoutMs);
      const observedBaseBranch = text(pr?.base?.ref);
      const observedBaseSha = sha(pr?.base?.sha);
      if (!observedBaseBranch || !observedBaseSha ||
          (scope.base_branch && scope.base_branch !== observedBaseBranch) ||
          pr?.state !== "open" || pr?.draft === true ||
          sha(pr?.head?.sha) !== scope.head_sha ||
          text(pr?.head?.repo?.full_name) !== scope.repository ||
          text(pr?.base?.repo?.full_name) !== scope.repository) {
        fail("bootstrap_required_checks_pr_mismatch");
      }
      scope.base_branch = observedBaseBranch;
      if (typeof requiredChecksPolicyResolver !== "function") fail("bootstrap_required_checks_policy_unavailable");
      let rawPolicy;
      try {
        rawPolicy = await requiredChecksPolicyResolver({
          tenant_id: scope.tenant_id,
          repository: scope.repository,
          base_branch: scope.base_branch,
        });
      } catch {
        fail("bootstrap_required_checks_policy_unavailable");
      }
      const policy = normalizePolicy(rawPolicy, scope);
      const checkPayload = await readJson(fetchImpl, `${GITHUB_ORIGIN}/repos/${scope.repository}/commits/${scope.head_sha}/check-runs?per_page=100`, { method: "GET", redirect: "error", headers }, timeoutMs);
      const checks = normalizedChecks(checkPayload, scope, policy);
      const workflowPath = policy.workflow.path;
      const baseSource = workflowSource(await readJson(
        fetchImpl,
        `${GITHUB_ORIGIN}/repos/${scope.repository}/contents/${workflowPath}?ref=${observedBaseSha}`,
        { method: "GET", redirect: "error", headers },
        timeoutMs,
      ), workflowPath, "base", observedBaseSha);
      const headSource = workflowSource(await readJson(
        fetchImpl,
        `${GITHUB_ORIGIN}/repos/${scope.repository}/contents/${workflowPath}?ref=${scope.head_sha}`,
        { method: "GET", redirect: "error", headers },
        timeoutMs,
      ), workflowPath, "head", scope.head_sha);
      const currentWorkflowDigest = policy.workflow.sha256;
      const candidateWorkflowDigest = policy.workflow.candidate_sha256;
      const allowedWorkflowDigests = new Set([
        currentWorkflowDigest,
        ...(candidateWorkflowDigest ? [candidateWorkflowDigest] : []),
      ]);
      if (!allowedWorkflowDigests.has(baseSource.sha256) ||
          !allowedWorkflowDigests.has(headSource.sha256) ||
          (!candidateWorkflowDigest &&
            (baseSource.sha256 !== currentWorkflowDigest || headSource.sha256 !== currentWorkflowDigest)) ||
          (candidateWorkflowDigest &&
            baseSource.sha256 === candidateWorkflowDigest && headSource.sha256 === currentWorkflowDigest)) {
        fail("bootstrap_required_checks_workflow_source_mismatch");
      }
      return Object.freeze({
        schema_version: "bootstrap_required_checks_attestation_v1",
        tenant_id: scope.tenant_id,
        repository: scope.repository,
        pr_number: scope.pr_number,
        head_sha: scope.head_sha,
        base_branch: scope.base_branch,
        base_sha: observedBaseSha,
        required_checks: policy.required_checks,
        required_checks_digest: digest(policy),
        required_checks_results_digest: digest({
          tenant_id: scope.tenant_id, repository: scope.repository,
          pr_number: scope.pr_number, head_sha: scope.head_sha,
          base_branch: scope.base_branch, base_sha: observedBaseSha,
          checks, workflow_sources: [baseSource, headSource],
        }),
        workflow_sources: Object.freeze([baseSource, headSource]),
        checks,
      });
    },
  });
}

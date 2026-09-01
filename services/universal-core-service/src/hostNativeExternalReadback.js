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
const GITHUB_PULL_FILES_PAGE_SIZE = 10;
const MAX_PULL_REQUEST_FILES = 2_000;
const MAX_PULL_REQUEST_FILE_PAGES = Math.ceil(
  MAX_PULL_REQUEST_FILES / GITHUB_PULL_FILES_PAGE_SIZE,
);
const GITHUB_COMPARE_COMMITS_PAGE_SIZE = 10;
const MAX_COMPARE_COMMITS = 2_000;
const MAX_COMPARE_COMMIT_PAGES = Math.ceil(
  MAX_COMPARE_COMMITS / GITHUB_COMPARE_COMMITS_PAGE_SIZE,
);
// GitHub exposes at most 300 changed files on a compare response.  Treat a
// response at that boundary as potentially truncated instead of authorizing a
// release from an incomplete path set.
const MAX_COMPLETE_COMPARE_FILES = 299;
const GITHUB_PRE_MERGE_PAGE_SIZE = 100;
const MAX_PRE_MERGE_PAGES = 10;

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

function exactObjectKeys(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) error(code);
  const keys = Object.keys(value);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) error(code);
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

async function readResponseJson(fetchImpl, url, init, timeoutMs, { allowNotFound = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (allowNotFound === true && response?.status === 404) return null;
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
  return async (path, { allowClassicProtectionNotFound = false } = {}) => {
    const allowNotFound = allowClassicProtectionNotFound === true &&
      /^\/branches\/[^/?]+\/protection$/.test(path);
    return readResponseJson(
      fetchImpl,
      `${GITHUB_ORIGIN}/repos/${safeRepository}${path}`,
      { method: "GET", redirect: "error", headers: githubHeaders(token) },
      timeoutMs,
      { allowNotFound },
    );
  };
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
  const event = workflowEvidenceEvent(action);
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

function workflowEvidenceEvent(action) {
  if (action?.kind === "github.merge") return "pull_request";
  if (action?.kind === "render.deploy" && action?.environment === "staging") {
    return "pull_request";
  }
  return "push";
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

function workflowPullRequestMatches(entry, {
  repository,
  action,
  merge,
}) {
  let urlPath = null;
  try {
    urlPath = new URL(string(entry?.url || "https://invalid.example")).pathname;
  } catch {
    return false;
  }
  return (
    Number(entry?.number) === Number(action.pull_request) &&
    string(entry?.head?.ref) === string(merge ? action.head_branch : action.branch) &&
    sha(entry?.head?.sha) === sha(merge ? action.head_commit : action.source_commit) &&
    string(entry?.base?.ref) === string(action.base_branch) &&
    sha(entry?.base?.sha) === sha(action.expected_base_commit) &&
    urlPath === `/repos/${repository}/pulls/${Number(action.pull_request)}`
  );
}

function validBranch(value) {
  const branch = string(value);
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch) &&
    !branch.endsWith("/") && !branch.includes("//") &&
    !/(^|\/)\.\.($|\/)/.test(branch)
  );
}

function signedMergeSourceAssociation(ticket, {
  repository,
  action,
  checksCommit,
  baseCommit,
  policy,
}) {
  try {
    const resolution = ticket?.release_join_resolution;
    const source = resolution?.source_attestation;
    const pullRequest = Number(action?.pull_request);
    const headBranch = string(action?.head_branch);
    const baseBranch = string(action?.base_branch);
    const treeSha = sha(source?.tree_sha);
    const changedFiles = stableStrings(source?.changed_files);
    if (
      action?.kind !== "github.merge" || !resolution || !source ||
      !Number.isSafeInteger(pullRequest) || pullRequest < 1 ||
      !validBranch(headBranch) || !validBranch(baseBranch) ||
      baseBranch !== string(policy?.base_branch) ||
      sha(action?.head_commit) !== checksCommit ||
      sha(action?.expected_base_commit) !== baseCommit ||
      resolution.schema_version !== "host_native_release_join_resolution_v1" ||
      resolution.trusted !== true || resolution.allowed !== true ||
      resolution.authority !== "universal_core" ||
      resolution.provider_execution !== false || ticket?.provider_execution === true ||
      string(resolution.tenant_id) !== string(ticket?.tenant_id) ||
      string(resolution.work_id) !== string(ticket?.work_id) ||
      string(resolution.intent_anchor_digest) !== string(ticket?.intent_anchor_digest) ||
      string(resolution.repository) !== repository ||
      sha(resolution.checks_commit) !== checksCommit ||
      string(resolution.evidence_digest) !== string(ticket?.evidence_digest) ||
      string(resolution.verdict_id) !== string(ticket?.core_join_verdict_id) ||
      string(ticket?.release_join_resolution_digest) !== hostNativeDigest(resolution) ||
      source.schema_version !== "host_native_source_attestation_v1" ||
      string(source.repository) !== repository ||
      source.evidence_kind !== "github_pull_request_files" ||
      Number(source.pull_request) !== pullRequest ||
      sha(source.base_commit) !== baseCommit ||
      sha(source.head_commit) !== checksCommit ||
      !treeSha || !Array.isArray(source.changed_files) || changedFiles.length < 1 ||
      source.changed_files.length !== changedFiles.length ||
      source.changed_files.some((value, index) => value !== changedFiles[index])
    ) {
      return null;
    }
    const sourceUnsigned = {
      schema_version: "host_native_source_attestation_v1",
      repository,
      evidence_kind: "github_pull_request_files",
      pull_request: pullRequest,
      base_commit: baseCommit,
      head_commit: checksCommit,
      tree_sha: treeSha,
      changed_files: changedFiles,
      diff_digest: hostNativeGithubDiffDigest({
        repository,
        base_commit: baseCommit,
        head_commit: checksCommit,
        tree_sha: treeSha,
        changed_files: changedFiles,
      }),
    };
    if (
      !sameStrings(Object.keys(source), [...Object.keys(sourceUnsigned), "attestation_digest"]) ||
      string(source.diff_digest) !== sourceUnsigned.diff_digest ||
      string(source.attestation_digest) !== hostNativeDigest(sourceUnsigned) ||
      !Array.isArray(resolution.previous_live_attestations) ||
      string(resolution.pre_action_readback_digest) !== hostNativeDigest({
        source_attestation: source,
        previous_live_attestations: resolution.previous_live_attestations,
      })
    ) {
      return null;
    }
    return {
      url: `${GITHUB_ORIGIN}/repos/${repository}/pulls/${pullRequest}`,
      number: pullRequest,
      head: { ref: headBranch, sha: checksCommit },
      base: { ref: baseBranch, sha: baseCommit },
    };
  } catch {
    return null;
  }
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
  ticket,
  serverPullRequestAssociation = null,
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
  const stagingDeploy = action?.kind === "render.deploy" && action?.environment === "staging";
  const pullRequestEvidence = merge || stagingDeploy;
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
    string(workflowRun?.event) === (pullRequestEvidence ? "pull_request" : "push") &&
    string(workflowRun?.head_branch) === (merge ? action.head_branch : action.branch)
  );
  if (!runMatches) error("workflow_run_mismatch");
  if (pullRequestEvidence) {
    const pull = Array.isArray(workflowRun.pull_requests) ? workflowRun.pull_requests : [];
    let match = pull.some((entry) => workflowPullRequestMatches(entry, {
      repository,
      action,
      merge,
    }));
    if (!match && merge && Array.isArray(workflowRun.pull_requests) && pull.length === 0) {
      const association = signedMergeSourceAssociation(ticket, {
        repository,
        action,
        checksCommit,
        baseCommit,
        policy,
      }) || (!ticket ? serverPullRequestAssociation : null);
      match = workflowPullRequestMatches(association, { repository, action, merge });
    }
    if (!match) error("workflow_pull_request_mismatch");
    if (stagingDeploy) {
      const pullRequest = await getGithub(`/pulls/${Number(action.pull_request)}`);
      if (
        Number(pullRequest?.number) !== Number(action.pull_request) ||
        pullRequest?.state !== "open" || pullRequest?.draft === true ||
        string(pullRequest?.head?.repo?.full_name) !== repository ||
        string(pullRequest?.base?.repo?.full_name) !== repository ||
        string(pullRequest?.head?.ref) !== string(action.branch) ||
        sha(pullRequest?.head?.sha) !== checksCommit ||
        string(pullRequest?.base?.ref) !== string(action.base_branch) ||
        sha(pullRequest?.base?.sha) !== sha(action.expected_base_commit)
      ) error("workflow_pull_request_mismatch");
    }
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
  ticket = null,
  serverPullRequestAssociation = null,
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
    policy: null,
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
    ticket,
    serverPullRequestAssociation,
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
    policy,
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

async function readGithubPages(getGithub, path, code) {
  const entries = [];
  for (let page = 1; page <= MAX_PRE_MERGE_PAGES; page += 1) {
    const response = await getGithub(
      `${path}${path.includes("?") ? "&" : "?"}per_page=${GITHUB_PRE_MERGE_PAGE_SIZE}&page=${page}`,
    );
    if (!Array.isArray(response)) error(code);
    entries.push(...response);
    if (response.length < GITHUB_PRE_MERGE_PAGE_SIZE) return entries;
  }
  error(code);
}

function preMergeProtectionRequirements({
  branchReadback,
  protection,
  baseBranch,
  baseCommit,
  requiredChecks,
  checkAppId,
}) {
  if (
    string(branchReadback?.name) !== baseBranch ||
    branchReadback?.protected !== true ||
    sha(branchReadback?.commit?.sha) !== baseCommit
  ) error("release_join_verdict_pre_merge_protection_drift");
  const statusChecks = protection?.required_status_checks;
  const checkBindings = Array.isArray(statusChecks?.checks)
    ? statusChecks.checks.map((check) => ({
      context: string(check?.context),
      app_id: Number(check?.app_id),
    }))
    : [];
  const reviews = protection?.required_pull_request_reviews;
  const bypass = reviews?.bypass_pull_request_allowances || {};
  const bypassCount = ["users", "teams", "apps"].reduce((total, key) =>
    total + (Array.isArray(bypass[key]) ? bypass[key].length : 0), 0);
  const approvingReviews = Number(reviews?.required_approving_review_count);
  if (
    statusChecks?.strict !== true || !Number.isSafeInteger(checkAppId) ||
    checkBindings.length !== requiredChecks.length ||
    !sameStrings(checkBindings.map((check) => check.context), requiredChecks) ||
    checkBindings.some((check) => !check.context || check.app_id !== checkAppId) ||
    protection?.enforce_admins?.enabled !== true || !reviews ||
    !Number.isSafeInteger(approvingReviews) || approvingReviews < 1 || bypassCount !== 0 ||
    protection?.allow_force_pushes?.enabled === true ||
    protection?.allow_deletions?.enabled === true
  ) error("release_join_verdict_pre_merge_protection_drift");
  return approvingReviews;
}

function preMergeRulesetRequirements(rules, {
  requiredChecks,
  checkAppId,
  mergeMethod,
  authoritative = false,
}) {
  const allowedPassiveRules = new Set(["deletion", "non_fast_forward"]);
  const pullRequestParameterKeys = new Set([
    "allowed_merge_methods",
    "dismiss_stale_reviews_on_push",
    "require_code_owner_review",
    "require_extra_approval_for_unattributed_changes",
    "require_last_push_approval",
    "required_approving_review_count",
    "required_review_thread_resolution",
    "required_reviewers",
  ]);
  const rulesetChecks = [];
  const passiveRules = new Set();
  let requiredReviews = 0;
  let pullRequestRulePresent = false;
  let threadResolutionRequired = false;
  let extraApprovalForUnattributedChangesRequired = false;
  for (const rule of rules) {
    const type = string(rule?.type);
    if (!Number.isSafeInteger(Number(rule?.ruleset_id)) || Number(rule.ruleset_id) < 1 || !type) {
      error("release_join_verdict_pre_merge_ruleset_invalid");
    }
    if (type === "required_status_checks") {
      const parameters = rule?.parameters;
      const checks = Array.isArray(parameters?.required_status_checks)
        ? parameters.required_status_checks
        : null;
      if (!checks || parameters?.strict_required_status_checks_policy !== true) {
        error("release_join_verdict_pre_merge_ruleset_drift");
      }
      for (const check of checks) {
        const context = string(check?.context);
        const integrationId = Number(check?.integration_id);
        if (!context || integrationId !== checkAppId) {
          error("release_join_verdict_pre_merge_ruleset_drift");
        }
        rulesetChecks.push(context);
      }
      continue;
    }
    if (type === "pull_request") {
      pullRequestRulePresent = true;
      const parameters = rule?.parameters;
      exactObjectKeys(
        parameters,
        pullRequestParameterKeys,
        "release_join_verdict_pre_merge_ruleset_unsupported",
      );
      const count = Number(parameters?.required_approving_review_count);
      const allowedMergeMethods = stableStrings(parameters?.allowed_merge_methods);
      const threadResolutionPolicy = parameters?.required_review_thread_resolution;
      const extraApprovalPolicy = parameters?.require_extra_approval_for_unattributed_changes;
      const dismissStaleReviews = parameters?.dismiss_stale_reviews_on_push;
      const specializedReviewers = Array.isArray(parameters?.required_reviewers)
        ? parameters.required_reviewers.some((entry) => Number(entry?.minimum_approvals) > 0)
        : false;
      if (
        !Number.isSafeInteger(count) || count < 0 || !allowedMergeMethods.includes(mergeMethod) ||
        ![true, false].includes(threadResolutionPolicy) ||
        ![true, false].includes(extraApprovalPolicy) ||
        ![true, false].includes(dismissStaleReviews) ||
        parameters?.require_code_owner_review === true ||
        parameters?.require_last_push_approval === true ||
        specializedReviewers
      ) error("release_join_verdict_pre_merge_ruleset_unsupported");
      requiredReviews = Math.max(requiredReviews, count);
      threadResolutionRequired ||= threadResolutionPolicy;
      extraApprovalForUnattributedChangesRequired ||= extraApprovalPolicy;
      continue;
    }
    if (allowedPassiveRules.has(type)) {
      passiveRules.add(type);
      continue;
    }
    // The current readback does not pretend to certify merge queues,
    // deployments, code scanning, signatures, workflow rules, or pattern
    // rules.  Any such active rule blocks autonomous merge fail-closed.
    error("release_join_verdict_pre_merge_ruleset_unsupported");
  }
  if (rulesetChecks.length > 0 && !sameStrings(rulesetChecks, requiredChecks)) {
    error("release_join_verdict_pre_merge_ruleset_drift");
  }
  if (authoritative && (
    !sameStrings(rulesetChecks, requiredChecks) || !pullRequestRulePresent ||
    !passiveRules.has("deletion") || !passiveRules.has("non_fast_forward")
  )) error("release_join_verdict_pre_merge_ruleset_drift");
  return {
    requiredReviews,
    threadResolutionRequired,
    extraApprovalForUnattributedChangesRequired,
  };
}

function attributedPullRequestCommitCount(commits, headCommit) {
  if (!Array.isArray(commits) || commits.length === 0) {
    error("release_join_verdict_pre_merge_unattributed_changes_unproven");
  }
  const seen = new Set();
  let previousCommit = null;
  for (const entry of commits) {
    const commitSha = sha(entry?.sha);
    const parents = Array.isArray(entry?.parents) ? entry.parents.map((parent) => sha(parent?.sha)) : null;
    const verification = entry?.commit?.verification;
    const verifiedAt = verification?.verified_at;
    if (
      !commitSha || seen.has(commitSha) || !parents?.length || parents.some((parent) => !parent) ||
      (previousCommit && !parents.includes(previousCommit)) ||
      !string(entry?.author?.login) || !string(entry?.committer?.login) ||
      !verification || typeof verification !== "object" || Array.isArray(verification) ||
      typeof verification.verified !== "boolean" || !string(verification.reason) ||
      !(verification.signature === null || typeof verification.signature === "string") ||
      !(verification.payload === null || typeof verification.payload === "string") ||
      !(verifiedAt === null || (
        typeof verifiedAt === "string" && Number.isFinite(Date.parse(verifiedAt))
      ))
    ) error("release_join_verdict_pre_merge_unattributed_changes_unproven");
    seen.add(commitSha);
    previousCommit = commitSha;
  }
  if (previousCommit !== headCommit) {
    error("release_join_verdict_pre_merge_unattributed_changes_unproven");
  }
  return commits.length;
}

function approvedHeadReviews(reviews, pull, headCommit, requiredCount) {
  const author = string(pull?.user?.login);
  if (!author) error("release_join_verdict_pre_merge_review_invalid");
  const latestByReviewer = new Map();
  for (const review of reviews) {
    const reviewer = string(review?.user?.login);
    const state = string(review?.state).toUpperCase();
    const reviewId = Number(review?.id);
    const submittedAt = Date.parse(string(review?.submitted_at));
    if (
      !reviewer || !Number.isSafeInteger(reviewId) || reviewId < 1 ||
      !Number.isFinite(submittedAt) ||
      !["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"].includes(state)
    ) error("release_join_verdict_pre_merge_review_invalid");
    const key = reviewer.toLowerCase();
    const prior = latestByReviewer.get(key);
    if (
      !prior || submittedAt > prior.submittedAt ||
      (submittedAt === prior.submittedAt && reviewId > prior.reviewId)
    ) {
      latestByReviewer.set(key, {
        review,
        reviewer,
        state,
        reviewId,
        submittedAt,
      });
    }
  }
  if ([...latestByReviewer.values()].some(({ state }) => state === "CHANGES_REQUESTED")) {
    error("release_join_verdict_pre_merge_review_not_approved");
  }
  const approved = [...latestByReviewer.values()].filter(({ review, reviewer, state }) =>
    state === "APPROVED" && reviewer.toLowerCase() !== author.toLowerCase() &&
    sha(review?.commit_id) === headCommit);
  if (approved.length < requiredCount) {
    error("release_join_verdict_pre_merge_review_not_approved");
  }
  return approved.map(({ reviewer, reviewId }) => ({
    review_id: reviewId,
    reviewer,
    reviewed_commit: headCommit,
  })).sort((left, right) => left.reviewer.localeCompare(right.reviewer));
}

async function attestStandingPreMerge({
  getGithub,
  repository,
  action,
  pull,
  baseCommit,
  headCommit,
  checks,
  now,
}) {
  const policy = checks.policy;
  if (!policy || !checks.required_checks_policy_digest) {
    error("required_checks_policy_unavailable");
  }
  const baseBranch = string(action.base_branch);
  const encodedBranch = encodeURIComponent(baseBranch);
  const [branchReadback, protection, rules, reviews] = await Promise.all([
    getGithub(`/branches/${encodedBranch}`),
    getGithub(`/branches/${encodedBranch}/protection`, {
      allowClassicProtectionNotFound: true,
    }),
    readGithubPages(
      getGithub,
      `/rules/branches/${encodedBranch}`,
      "release_join_verdict_pre_merge_ruleset_invalid",
    ),
    readGithubPages(
      getGithub,
      `/pulls/${Number(action.pull_request)}/reviews`,
      "release_join_verdict_pre_merge_review_invalid",
    ),
  ]);
  if (
    pull?.state !== "open" || pull?.draft !== false ||
    !validateMergePullRequest(pull, action, repository, null, { merged: false }) ||
    sha(action.head_commit) !== headCommit
  ) error("release_join_verdict_pull_request_mismatch");
  let classicReviews = 0;
  if (protection) {
    classicReviews = preMergeProtectionRequirements({
      branchReadback,
      protection,
      baseBranch,
      baseCommit,
      requiredChecks: checks.required_checks,
      checkAppId: Number(policy.check_app.id),
    });
  } else if (
    string(branchReadback?.name) !== baseBranch || branchReadback?.protected !== true ||
    sha(branchReadback?.commit?.sha) !== baseCommit
  ) {
    error("release_join_verdict_pre_merge_protection_drift");
  }
  const rulesetRequirements = preMergeRulesetRequirements(rules, {
    requiredChecks: checks.required_checks,
    checkAppId: Number(policy.check_app.id),
    mergeMethod: string(action.merge_method || "merge"),
    authoritative: protection === null,
  });
  let reviewCommentCount = null;
  if (rulesetRequirements.threadResolutionRequired) {
    const comments = await readGithubPages(
      getGithub,
      `/pulls/${Number(action.pull_request)}/comments`,
      "release_join_verdict_pre_merge_thread_resolution_unproven",
    );
    reviewCommentCount = comments.length;
    if (reviewCommentCount !== 0) {
      error("release_join_verdict_pre_merge_thread_resolution_unproven");
    }
  }
  let commitCount = null;
  let unattributedCommitCount = null;
  if (rulesetRequirements.extraApprovalForUnattributedChangesRequired) {
    let commits;
    try {
      commits = await readGithubPages(
        getGithub,
        `/pulls/${Number(action.pull_request)}/commits`,
        "release_join_verdict_pre_merge_unattributed_changes_unproven",
      );
    } catch {
      error("release_join_verdict_pre_merge_unattributed_changes_unproven");
    }
    commitCount = attributedPullRequestCommitCount(commits, headCommit);
    unattributedCommitCount = 0;
  }
  const requiredReviews = Math.max(classicReviews, rulesetRequirements.requiredReviews);
  const approvedReviews = approvedHeadReviews(reviews, pull, headCommit, requiredReviews);
  const unsigned = {
    schema_version: "host_native_pre_merge_readback_v1",
    trusted: true,
    source: "universal_core_github_readback",
    repository,
    base_branch: baseBranch,
    base_commit: baseCommit,
    head_branch: string(action.head_branch),
    head_commit: headCommit,
    pull_request: Number(action.pull_request),
    required_checks: checks.required_checks,
    required_checks_policy_digest: checks.required_checks_policy_digest,
    check_app_id: Number(policy.check_app.id),
    approving_reviews_required: requiredReviews,
    approved_reviews: approvedReviews,
    thread_resolution_required: rulesetRequirements.threadResolutionRequired,
    review_comment_count: reviewCommentCount,
    extra_approval_for_unattributed_changes_required:
      rulesetRequirements.extraApprovalForUnattributedChangesRequired,
    commit_count: commitCount,
    unattributed_commit_count: unattributedCommitCount,
    active_rules_digest: hostNativeDigest(rules),
    verified_at: isoNow(now),
    provider_execution: false,
  };
  return { ...unsigned, evidence_digest: hostNativeDigest(unsigned) };
}

function healthAttestation({
  service,
  origin,
  health,
  liveCommit,
  previousLiveCommit = null,
  rollbackCommit,
  previous = false,
}) {
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
    unsigned.previous_live_commit = previousLiveCommit;
    unsigned.rollback_commit = rollbackCommit;
    unsigned.rollback_status = "previous_live_attested";
  }
  return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
}

function manualMergePreviousLiveBinding({ service, origin, manualMergeReadback }) {
  const expectedLive = sha(service?.expected_previous_commit);
  const githubBase = sha(manualMergeReadback?.github_readback?.base_commit);
  const receiptId = string(manualMergeReadback?.receipt_id);
  if (
    !expectedLive || expectedLive !== githubBase ||
    !/^hnmmr_[a-f0-9]{40}$/.test(receiptId) ||
    string(service?.health_contract_digest) !== HOST_NATIVE_HEALTH_CONTRACT_DIGEST
  ) error("release_join_verdict_previous_live_mismatch");
  const unsigned = {
    service_id: string(service.service_id),
    environment: string(service.environment),
    origin,
    health_path: "/healthz",
    deployment_id: `manual-merge-base:${receiptId}`,
    live_commit: expectedLive,
    version: "owner_manual_merge_readback_v1",
    health_status: "manual_merge_base_bound",
    health_contract_digest: service.health_contract_digest,
    evidence_kind: "signed_manual_merge_base_binding",
    manual_merge_readback_id: receiptId,
  };
  return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
}

function expectedPrevious(ticket, service) {
  const entries = ticket?.release_join_resolution?.previous_live_attestations;
  if (!Array.isArray(entries)) return null;
  return entries.find((entry) => (
    string(entry?.service_id) === string(service.service_id) &&
    string(entry?.environment) === string(service.environment) &&
    string(entry?.origin).toLowerCase() === string(service.origin).toLowerCase()
  )) || null;
}

function observeSourceContext(ticket, action, binding, repository, targetCommit, checksCommit, baseCommit) {
  const predecessor = ticket?.predecessor;
  const receipt = predecessor?.finalize_authorization;
  const sourceAction = predecessor?.source_action;
  const sourceKind = sourceAction?.kind;
  const sourceBranch = sourceKind === "github.merge"
    ? string(sourceAction?.base_branch)
    : string(sourceAction?.branch);
  const receiptUnsigned = receipt && { ...receipt };
  if (receiptUnsigned) {
    delete receiptUnsigned.signature;
    delete receiptUnsigned.authorization_digest;
  }
  const service = Array.isArray(binding?.services) && binding.services.find((entry) => (
    string(entry?.service_id) === string(action?.service_id) &&
    string(entry?.environment) === string(action?.environment)
  ));
  if (predecessor?.predecessor_type === "owner_manual_github_merge_readback") {
    const refreshLineage = predecessor.refresh_lineage || null;
    const refreshLineageUnsigned = refreshLineage && { ...refreshLineage };
    if (refreshLineageUnsigned) delete refreshLineageUnsigned.lineage_digest;
    const refreshLineageValid = !refreshLineage || (
      refreshLineage.schema_version ===
        "host_native_owner_manual_merge_refresh_lineage_v1" &&
      /^hnmmr_[a-f0-9]{40}$/.test(string(
        refreshLineage.predecessor_manual_merge_readback_id,
      )) &&
      /^[a-f0-9]{64}$/.test(string(
        refreshLineage.predecessor_manual_merge_readback_digest,
      )) &&
      /^hnj_[a-f0-9]{40}$/.test(string(
        refreshLineage.predecessor_core_join_verdict_id,
      )) &&
      refreshLineage.successor_core_join_verdict_id ===
        ticket?.core_join_verdict_id &&
      refreshLineage.correction ===
        "legacy_diff_digest_to_host_native_github_diff_digest" &&
      refreshLineage.authorized_successor_action === "render.observe" &&
      refreshLineage.provider_execution === false &&
      refreshLineage.lineage_digest === hostNativeDigest(refreshLineageUnsigned) &&
      predecessor.refresh_lineage_digest === hostNativeDigest(refreshLineage)
    );
    if (
      predecessor.schema_version !== "host_native_owner_manual_merge_predecessor_v2" ||
      !/^hnmmr_[a-f0-9]{40}$/.test(string(predecessor.manual_merge_readback_id)) ||
      !/^[a-f0-9]{64}$/.test(string(predecessor.manual_merge_readback_digest)) ||
      !/^[a-f0-9]{64}$/.test(string(predecessor.source_readback_digest)) ||
      predecessor.retrospective_ticket_issued !== false ||
      predecessor.provider_execution !== false ||
      action?.kind !== "render.observe" || sourceAction?.kind !== "github.merge" ||
      ticket?.predecessor_chain_digest !== hostNativeDigest(predecessor) ||
      predecessor.result_commit !== targetCommit || action.target_commit !== targetCommit ||
      predecessor.source_action_digest !== hostNativeDigest(sourceAction) ||
      predecessor.source_evidence_digest !== ticket?.evidence_digest ||
      predecessor.source_evidence_digest !== predecessor.manual_merge_readback_digest ||
      !/^[a-f0-9]{64}$/.test(string(predecessor.source_required_checks_policy_digest)) ||
      string(sourceAction.repository) !== repository || string(action.repository) !== repository ||
      string(action.branch) !== sourceBranch || sourceBranch !== string(binding?.delivery_branch) ||
      sha(sourceAction.head_commit) !== checksCommit ||
      sha(sourceAction.checks_commit) !== checksCommit ||
      sha(sourceAction.expected_base_commit) !== baseCommit ||
      string(sourceAction.base_branch) !== sourceBranch ||
      !Number.isSafeInteger(Number(sourceAction.pull_request)) ||
      Number(sourceAction.pull_request) < 1 ||
      action.release_manifest_digest !== ticket?.release_manifest_digest ||
      action.release_manifest_digest !== binding?.manifest_digest ||
      ticket?.release_join_resolution?.evidence_digest !== ticket?.evidence_digest ||
      ticket?.release_join_resolution_digest !== hostNativeDigest(ticket?.release_join_resolution) ||
      !refreshLineageValid ||
      !service
    ) error("trusted_readback_observation_binding_invalid");
    return {
      schema_version: "host_native_observe_source_context_v2",
      source_type: "owner_manual_merge_readback",
      sourceAction,
      sourceBranch,
      manual_merge_readback_id: predecessor.manual_merge_readback_id,
      manual_merge_readback_digest: predecessor.manual_merge_readback_digest,
      source_readback_digest: predecessor.source_readback_digest,
      ...(refreshLineage ? {
        manual_merge_original_readback_id:
          refreshLineage.predecessor_manual_merge_readback_id,
        manual_merge_original_readback_digest:
          refreshLineage.predecessor_manual_merge_readback_digest,
        manual_merge_original_core_join_verdict_id:
          refreshLineage.predecessor_core_join_verdict_id,
        manual_merge_successor_core_join_verdict_id:
          refreshLineage.successor_core_join_verdict_id,
        refresh_lineage_digest: predecessor.refresh_lineage_digest,
      } : {}),
    };
  }
  if (
    action?.kind !== "render.observe" || !predecessor || !receipt || !sourceAction ||
    ticket?.predecessor_chain_digest !== hostNativeDigest(predecessor) ||
    predecessor.ticket_id !== action.parent_release_ticket_id ||
    predecessor.ticket_digest !== action.parent_release_ticket_digest ||
    predecessor.result_commit !== targetCommit || action.target_commit !== targetCommit ||
    predecessor.source_action_digest !== hostNativeDigest(sourceAction) ||
    predecessor.source_evidence_digest !== ticket?.evidence_digest ||
    !/^[a-f0-9]{64}$/.test(string(predecessor.source_required_checks_policy_digest)) ||
    !["github.merge", "git.push.protected"].includes(sourceKind) ||
    string(sourceAction.repository) !== repository ||
    string(action.repository) !== repository ||
    string(action.branch) !== sourceBranch || sourceBranch !== string(binding?.delivery_branch) ||
    action.release_manifest_digest !== ticket?.release_manifest_digest ||
    action.release_manifest_digest !== binding?.manifest_digest ||
    ticket?.release_join_resolution?.evidence_digest !== ticket?.evidence_digest ||
    ticket?.release_join_resolution_digest !== hostNativeDigest(ticket?.release_join_resolution) ||
    receipt.schema_version !== "host_native_finalize_authorization_v1" ||
    receipt.trusted !== true || receipt.allowed !== true ||
    receipt.decision !== "ALLOW_FINALIZE" || receipt.result_commit_verified !== true ||
    receipt.decision_id !== predecessor.ticket_id ||
    receipt.tenant_id !== ticket?.tenant_id || receipt.work_id !== ticket?.work_id ||
    receipt.repository !== repository || receipt.provider_execution !== false ||
    receipt.host_policy_override !== false || receipt.host_policy_must_allow !== true ||
    receipt.action_ticket_id !== predecessor.ticket_id ||
    receipt.action_ticket_digest !== predecessor.ticket_digest ||
    receipt.target_commit !== targetCommit ||
    receipt.release_manifest_digest !== action.release_manifest_digest ||
    receipt.release_intent_digest !== ticket?.release_intent_digest ||
    receipt.core_join_verdict_id !== ticket?.core_join_verdict_id ||
    receipt.core_join_verdict_digest !== ticket?.core_join_verdict_digest ||
    receipt.core_join_resolution_digest !== ticket?.release_join_resolution_digest ||
    receipt.evidence_digest !== ticket?.evidence_digest ||
    receipt.host_kind !== ticket?.host_kind ||
    receipt.host_session_fingerprint !== ticket?.host_session_fingerprint ||
    receipt.github_readback?.required_checks_policy_digest !==
      predecessor.source_required_checks_policy_digest ||
    receipt.predecessor_chain_digest !== (
      receipt.predecessor ? hostNativeDigest(receipt.predecessor) : null
    ) ||
    predecessor.finalize_authorization_digest !== receipt.authorization_digest ||
    !/^[a-f0-9]{64}$/.test(string(receipt.authorization_digest)) ||
    hostNativeDigest(receiptUnsigned) !== receipt.authorization_digest ||
    !/^hnf_[a-f0-9]{64}$/.test(string(receipt.signature)) ||
    !service
  ) error("trusted_readback_observation_binding_invalid");
  if (sourceKind === "github.merge" && (
    sha(sourceAction.head_commit) !== checksCommit ||
    sha(sourceAction.expected_base_commit) !== baseCommit ||
    string(sourceAction.base_branch) !== sourceBranch
  )) error("trusted_readback_observation_binding_invalid");
  if (sourceKind === "git.push.protected" && (
    sha(sourceAction.source_commit) !== checksCommit ||
    sha(sourceAction.expected_remote_commit) !== baseCommit
  )) error("trusted_readback_observation_binding_invalid");
  return {
    schema_version: "host_native_observe_source_context_v1",
    source_type: "action_ticket",
    sourceAction,
    sourceBranch,
  };
}

export function createHostNativeBranchProtectionResolver({
  fetchImpl = globalThis.fetch,
  githubTokenResolver = null,
  requiredChecksPolicyResolver = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  if (typeof fetchImpl !== "function") error("standing_release_base_protection_readback_unavailable");
  if (typeof githubTokenResolver !== "function") {
    error("standing_release_base_protection_credential_unavailable");
  }
  if (typeof requiredChecksPolicyResolver !== "function") {
    error("standing_release_checks_policy_unavailable");
  }
  const boundedTimeout = Math.max(500, Math.min(30_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const resolve = async ({
    tenant_id,
    repository,
    base_branch,
    required_checks,
    required_checks_policy_digest,
  } = {}) => {
    const tenantId = string(tenant_id);
    const safeRepository = repositoryPath(repository);
    const branch = string(base_branch);
    if (!tenantId || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch)) {
      error("standing_release_base_protection_scope_invalid");
    }
    const requiredChecks = stableStrings(required_checks);
    if (!requiredChecks.length || !/^[a-f0-9]{64}$/.test(string(required_checks_policy_digest))) {
      error("standing_release_checks_policy_invalid");
    }
    let policy;
    try {
      policy = await requiredChecksPolicyResolver({
        tenant_id: tenantId,
        repository: safeRepository,
        base_branch: branch,
      });
    } catch {
      error("standing_release_checks_policy_unavailable");
    }
    if (
      !policy || policy.schema_version !== "host_native_required_checks_policy_v1" ||
      string(policy.tenant_id) !== tenantId || string(policy.repository) !== safeRepository ||
      string(policy.base_branch) !== branch ||
      !sameStrings(policy.required_checks, requiredChecks) ||
      hostNativeDigest(policy) !== string(required_checks_policy_digest)
    ) error("standing_release_checks_policy_drift");
    const token = await resolveGithubToken(githubTokenResolver, {
      tenant_id: tenantId,
      repository: safeRepository,
    });
    if (!token) error("standing_release_base_protection_credential_unavailable");
    const getGithub = githubClient({
      fetchImpl,
      token,
      repository: safeRepository,
      timeoutMs: boundedTimeout,
    });
    let branchReadback;
    let protection;
    try {
      const encodedBranch = encodeURIComponent(branch);
      [branchReadback, protection] = await Promise.all([
        getGithub(`/branches/${encodedBranch}`),
        getGithub(`/branches/${encodedBranch}/protection`),
      ]);
    } catch {
      error("standing_release_base_protection_readback_unavailable");
    }
    const statusChecks = protection?.required_status_checks;
    const checkBindings = Array.isArray(statusChecks?.checks)
      ? statusChecks.checks.map((check) => ({
        name: string(check?.context),
        app_id: Number(check?.app_id),
      }))
      : [];
    const expectedAppId = Number(policy?.check_app?.id);
    // A context-only protection response does not prove which GitHub App owns
    // the required check.  Standing automation must bind every exact check to
    // the server-resolved App id; legacy unbound contexts therefore fail
    // closed instead of silently widening the trusted CI authority.
    const appBindingsValid = Number.isSafeInteger(expectedAppId) &&
      checkBindings.length === requiredChecks.length &&
      sameStrings(checkBindings.map((check) => check.name), requiredChecks) &&
      checkBindings.every((check) =>
        check.name && Number.isSafeInteger(check.app_id) && check.app_id === expectedAppId);
    const reviews = protection?.required_pull_request_reviews;
    const bypass = reviews?.bypass_pull_request_allowances || {};
    const bypassCount = ["users", "teams", "apps"].reduce((total, key) =>
      total + (Array.isArray(bypass[key]) ? bypass[key].length : 0), 0);
    if (
      string(branchReadback?.name) !== branch || branchReadback?.protected !== true ||
      !sha(branchReadback?.commit?.sha) ||
      statusChecks?.strict !== true ||
      appBindingsValid !== true || protection?.enforce_admins?.enabled !== true ||
      !reviews || Number(reviews.required_approving_review_count) < 1 || bypassCount !== 0 ||
      protection?.allow_force_pushes?.enabled === true ||
      protection?.allow_deletions?.enabled === true
    ) error("standing_release_base_protection_not_ready");
    const unsigned = {
      schema_version: "standing_release_base_protection_readback_v1",
      trusted: true,
      source: "universal_core_github_readback",
      tenant_id: tenantId,
      repository: safeRepository,
      branch,
      base_commit: sha(branchReadback.commit.sha),
      protected: true,
      direct_push_allowed: false,
      force_push_allowed: false,
      deletion_allowed: false,
      pull_request_required: true,
      approving_reviews_required: Number(reviews.required_approving_review_count),
      enforce_admins: true,
      bypass_allowance_count: 0,
      required_checks: requiredChecks,
      required_checks_policy_digest: string(required_checks_policy_digest),
      check_app_id: expectedAppId,
      verified_at: isoNow(now),
      provider_execution: false,
    };
    return Object.freeze({ ...unsigned, evidence_digest: hostNativeDigest(unsigned) });
  };
  Object.defineProperty(resolve, "trusted", { value: true });
  return resolve;
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
  const verify = async ({ ticket, target_commit, verification_scope = "full_release" }) => {
    const tenantId = string(ticket?.tenant_id);
    const repository = repositoryPath(ticket?.repository);
    const action = ticket?.action || {};
    if (!["full_release", "github_merge_and_checks_only"].includes(verification_scope)) {
      error("trusted_readback_verification_scope_invalid");
    }
    const mergeOnly = verification_scope === "github_merge_and_checks_only";
    if (mergeOnly && action.kind !== "github.merge") {
      error("trusted_readback_verification_scope_invalid");
    }
    const binding = ticket?.release_manifest_binding || {};
    const targetCommit = sha(target_commit);
    const checksCommit = sha(binding?.verification?.checks_commit || action.checks_commit);
    const baseCommit = sha(binding?.base_commit || action.expected_base_commit || action.expected_remote_commit);
    const rollbackCommit = sha(binding?.rollback?.target_commit);
    const baseBranch = string(binding?.base_branch || action.base_branch || action.branch);
    if (!tenantId || !targetCommit || !checksCommit || !baseCommit || !rollbackCommit || !baseBranch) {
      error("trusted_readback_ticket_invalid");
    }
    const observation = action.kind === "render.observe"
      ? observeSourceContext(ticket, action, binding, repository, targetCommit, checksCommit, baseCommit)
      : null;
    const evidenceAction = observation?.sourceAction || action;
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
      action: evidenceAction,
      requiredChecksPolicyResolver,
      workflowRunCache: workflow_run_cache,
      workflowSourceCache: workflow_source_cache,
      ticket,
    });
    if (observation && !checks.required_checks_policy_digest) {
      error("required_checks_policy_unavailable");
    }
    if (observation && checks.required_checks_policy_digest !==
        ticket.predecessor.source_required_checks_policy_digest) {
      error("required_checks_policy_mismatch");
    }
    const productionDeploy = action.kind === "render.deploy" && action.environment === "production";
    if (productionDeploy) {
      const joinedPolicyDigest = string(
        ticket?.release_join_resolution?.required_checks_policy_digest,
      );
      if (!/^[a-f0-9]{64}$/.test(joinedPolicyDigest) ||
          !checks.required_checks_policy_digest) {
        error("trusted_readback_required_checks_policy_unavailable");
      }
      if (checks.required_checks_policy_digest !== joinedPolicyDigest) {
        error("trusted_readback_required_checks_policy_mismatch");
      }
    }
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
    } else if (action.kind === "render.deploy") {
      branch = string(action.branch);
      if (!branch || /(^|\/)\.\.($|\/)/.test(branch)) error("trusted_readback_ticket_invalid");
      const ref = await getGithub(`/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, "/")}`);
      branchCommit = sha(ref?.object?.sha);
      if (
        branchCommit !== targetCommit ||
        targetCommit !== sha(action.source_commit) ||
        targetCommit !== checksCommit
      ) error("trusted_readback_branch_commit_mismatch");
    } else if (action.kind === "render.observe") {
      branch = string(action.branch);
      if (!validBranch(branch) || branch !== observation.sourceBranch) {
        error("trusted_readback_ticket_invalid");
      }
      const ref = await getGithub(`/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, "/")}`);
      branchCommit = sha(ref?.object?.sha);
      if (branchCommit !== targetCommit || targetCommit !== sha(action.target_commit) ||
          targetCommit !== sha(ticket.predecessor.result_commit)) {
        error("trusted_readback_branch_commit_mismatch");
      }
      if (evidenceAction.kind === "github.merge") {
        const pull = await getGithub(`/pulls/${Number(evidenceAction.pull_request)}`);
        if (!validateMergePullRequest(pull, evidenceAction, repository, targetCommit, { merged: true })) {
          error("trusted_readback_github_merge_mismatch");
        }
        mergeCommit = targetCommit;
        merged = true;
      } else if (targetCommit !== checksCommit || targetCommit !== sha(evidenceAction.source_commit)) {
        error("trusted_readback_branch_commit_mismatch");
      }
    } else {
      error("trusted_readback_action_invalid");
    }
    const target = await getGithub(`/git/commits/${targetCommit}`);
    if (sha(target?.sha) !== targetCommit) error("trusted_readback_target_commit_mismatch");
    const rollback = await getGithub(`/git/commits/${rollbackCommit}`);
    if (sha(rollback?.sha) !== rollbackCommit) error("trusted_readback_rollback_unavailable");
    const sourceServices = Array.isArray(binding?.services) ? binding.services : [];
    if (!mergeOnly && sourceServices.length < 1) error("trusted_readback_services_invalid");
    const exactProductionTargets = productionDeploy;
    if (exactProductionTargets && sourceServices.some((service) => !sha(service?.target_commit))) {
      error("trusted_readback_services_invalid");
    }
    const services = [];
    for (const service of mergeOnly ? [] : sourceServices) {
      const origin = originForHealth(service?.origin);
      const prior = expectedPrevious(ticket, service);
      const serviceTargetCommit = sha(service?.target_commit) ||
        (exactProductionTargets ? null : targetCommit);
      if (
        !prior || sha(prior.live_commit) !== sha(service?.expected_previous_commit) ||
        !serviceTargetCommit ||
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
        liveCommit: serviceTargetCommit,
        previousLiveCommit: sha(prior.live_commit),
        rollbackCommit,
      }));
    }
    services.sort((left, right) => left.service_id.localeCompare(right.service_id));
    const githubUnsigned = {
      api_origin: GITHUB_ORIGIN,
      repository,
      action_kind: action.kind,
      head_branch: evidenceAction.kind === "github.merge" ? string(evidenceAction.head_branch) :
        action.kind === "render.deploy" || action.kind === "render.observe" ? branch : null,
      base_branch: evidenceAction.kind === "github.merge" || action.kind === "render.deploy"
        ? string(evidenceAction.base_branch || baseBranch) : null,
      pull_request: evidenceAction.kind === "github.merge" ||
        action.kind === "render.deploy" && action.environment === "staging"
        ? Number(evidenceAction.pull_request) : null,
      merged,
      head_commit: evidenceAction.kind === "github.merge" ? sha(evidenceAction.head_commit) : checksCommit,
      expected_base_commit: evidenceAction.kind === "github.merge" || action.kind === "render.deploy"
        ? sha(evidenceAction.expected_base_commit || baseCommit) : sha(evidenceAction.expected_remote_commit),
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
      ...(observation ? {
        source_action_kind: evidenceAction.kind,
        source_action_digest: ticket.predecessor.source_action_digest,
        ...(observation.source_type === "owner_manual_merge_readback" ? {
          manual_merge_readback_id: observation.manual_merge_readback_id,
          manual_merge_readback_digest: observation.manual_merge_readback_digest,
          source_readback_digest: observation.source_readback_digest,
          ...(observation.refresh_lineage_digest ? {
            manual_merge_original_readback_id:
              observation.manual_merge_original_readback_id,
            manual_merge_original_readback_digest:
              observation.manual_merge_original_readback_digest,
            manual_merge_original_core_join_verdict_id:
              observation.manual_merge_original_core_join_verdict_id,
            manual_merge_successor_core_join_verdict_id:
              observation.manual_merge_successor_core_join_verdict_id,
            refresh_lineage_digest: observation.refresh_lineage_digest,
          } : {}),
        } : {
          predecessor_ticket_id: ticket.predecessor.ticket_id,
          predecessor_ticket_digest: ticket.predecessor.ticket_digest,
        }),
      } : {}),
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
      verification_scope,
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

/**
 * Attest a GitHub merge performed manually by the owner after Core Join.
 * The caller supplies selectors only. Every material GitHub, checks and main
 * branch fact is resolved here and the result never authorizes execution.
 */
export function createHostNativeOwnerManualMergeReadbackVerifier({
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
  const verify = async ({ tenant_id, repository, pull_request, core_join_record } = {}) => {
    const tenantId = string(tenant_id);
    const safeRepository = repositoryPath(repository);
    const pullRequest = Number(pull_request);
    const claim = core_join_record?.claim || {};
    if (!tenantId || !Number.isSafeInteger(pullRequest) || pullRequest < 1 ||
        claim.tenant_id !== tenantId || claim.repository !== safeRepository) {
      error("owner_manual_merge_readback_selector_invalid");
    }
    const baseBranch = string(claim.base_branch);
    const joinedBaseCommit = sha(core_join_record?.release_intent?.base_commit);
    const checksCommit = sha(claim.checks?.commit);
    const requiredChecks = stableStrings(claim.checks?.required_checks);
    const joinedPolicyDigest = string(claim.required_checks_policy_digest);
    if (!baseBranch || !joinedBaseCommit || !checksCommit || requiredChecks.length < 1 ||
        !/^[a-f0-9]{64}$/.test(joinedPolicyDigest)) {
      error("owner_manual_merge_readback_core_join_invalid");
    }
    const token = await resolveGithubToken(githubTokenResolver, {
      tenant_id: tenantId,
      repository: safeRepository,
    });
    const getGithub = githubClient({
      fetchImpl,
      token,
      repository: safeRepository,
      timeoutMs: boundedTimeout,
    });
    const pull = await getGithub(`/pulls/${pullRequest}`);
    const headCommit = sha(pull?.head?.sha);
    const baseCommit = sha(pull?.base?.sha);
    const mergeCommit = sha(pull?.merge_commit_sha);
    const headBranch = string(pull?.head?.ref);
    const mergedAtMillis = Date.parse(string(pull?.merged_at));
    if (pull?.merged !== true || string(pull?.state) !== "closed" ||
        !headCommit || headCommit !== checksCommit || baseCommit !== joinedBaseCommit || !mergeCommit ||
        !headBranch || string(pull?.head?.repo?.full_name) !== safeRepository ||
        string(pull?.base?.repo?.full_name) !== safeRepository ||
        string(pull?.base?.ref) !== baseBranch || !Number.isFinite(mergedAtMillis)) {
      error("owner_manual_merge_readback_pull_request_mismatch");
    }
    const action = {
      kind: "github.merge",
      repository: safeRepository,
      head_branch: headBranch,
      base_branch: baseBranch,
      pull_request: pullRequest,
      head_commit: headCommit,
      expected_base_commit: baseCommit,
      checks_commit: checksCommit,
      provider_execution: false,
    };
    const serverPullRequestAssociation = {
      url: `${GITHUB_ORIGIN}/repos/${safeRepository}/pulls/${pullRequest}`,
      number: pullRequest,
      head: { ref: headBranch, sha: headCommit },
      base: { ref: baseBranch, sha: baseCommit },
    };
    const checks = await attestChecks({
      getGithub,
      tenantId,
      repository: safeRepository,
      baseBranch,
      baseCommit,
      checksCommit,
      requiredChecks,
      action,
      requiredChecksPolicyResolver,
      workflowRunCache: workflow_run_cache,
      workflowSourceCache: workflow_source_cache,
      serverPullRequestAssociation,
    });
    if (!checks.required_checks_policy_digest ||
        checks.required_checks_policy_digest !== joinedPolicyDigest) {
      error("owner_manual_merge_readback_required_checks_policy_mismatch");
    }
    const encodedBaseBranch = encodeURIComponent(baseBranch).replace(/%2F/g, "/");
    const [mainRef, mergeTarget] = await Promise.all([
      getGithub(`/git/ref/heads/${encodedBaseBranch}`),
      getGithub(`/git/commits/${mergeCommit}`),
    ]);
    const mainHeadCommit = sha(mainRef?.object?.sha);
    if (mainHeadCommit !== mergeCommit || sha(mergeTarget?.sha) !== mergeCommit) {
      error("owner_manual_merge_readback_main_drift");
    }
    const unsigned = {
      schema_version: "host_native_owner_manual_merge_github_readback_v1",
      trusted: true,
      source: "universal_core_github_readback",
      tenant_id: tenantId,
      repository: safeRepository,
      pull_request: pullRequest,
      merged: true,
      merged_at: new Date(mergedAtMillis).toISOString(),
      head_branch: headBranch,
      base_branch: baseBranch,
      base_commit: baseCommit,
      head_commit: headCommit,
      merge_commit: mergeCommit,
      main_head_commit: mainHeadCommit,
      checks_commit: checksCommit,
      checks_passed: true,
      required_checks: checks.required_checks,
      observed_checks: checks.observed_checks,
      required_checks_policy_digest: checks.required_checks_policy_digest,
      checks_attestation_digest: checks.checks_attestation_digest,
      workflow_sources: checks.workflow_sources,
      verified_at: isoNow(now),
      external_side_effect: false,
      provider_execution: false,
    };
    return { ...unsigned, readback_digest: hostNativeDigest(unsigned) };
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

function sourceFileNames(items, code) {
  if (!Array.isArray(items)) error(code);
  const files = [];
  for (const item of items) {
    if (string(item?.filename)) files.push(string(item.filename));
    if (string(item?.previous_filename)) files.push(string(item.previous_filename));
  }
  return files;
}

async function attestCompareSource({
  getGithub,
  repository,
  baseCommit,
  headCommit,
  treeSha,
  expectedFiles,
}) {
  const encodedRange = `${baseCommit}...${headCommit}`;
  let first = null;
  let fileNames = null;
  let observedCommits = 0;
  for (let page = 1; page <= MAX_COMPARE_COMMIT_PAGES; page += 1) {
    const response = await getGithub(
      `/compare/${encodedRange}?per_page=${GITHUB_COMPARE_COMMITS_PAGE_SIZE}&page=${page}`,
    );
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      error("release_join_verdict_source_attestation_mismatch");
    }
    if (page === 1) {
      first = response;
      if (
        sha(response?.base_commit?.sha) !== baseCommit ||
        sha(response?.merge_base_commit?.sha) !== baseCommit ||
        sha(response?.head_commit?.sha) !== headCommit ||
        sha(response?.head_commit?.commit?.tree?.sha) !== treeSha ||
        response?.status !== "ahead" ||
        Number(response?.behind_by) !== 0 ||
        !Number.isSafeInteger(Number(response?.ahead_by)) || Number(response.ahead_by) < 1 ||
        !Number.isSafeInteger(Number(response?.total_commits)) ||
        Number(response.total_commits) !== Number(response.ahead_by) ||
        !Array.isArray(response?.files) || response.files.length > MAX_COMPLETE_COMPARE_FILES
      ) {
        error("release_join_verdict_source_attestation_mismatch");
      }
      fileNames = sourceFileNames(
        response.files,
        "release_join_verdict_changed_files_mismatch",
      );
    } else if (response?.files !== undefined && response.files !== null) {
      error("release_join_verdict_source_attestation_mismatch");
    }
    const commits = Array.isArray(response?.commits) ? response.commits : null;
    if (!commits) error("release_join_verdict_source_attestation_mismatch");
    observedCommits += commits.length;
    if (observedCommits > MAX_COMPARE_COMMITS) {
      error("release_join_verdict_source_attestation_mismatch");
    }
    if (commits.length < GITHUB_COMPARE_COMMITS_PAGE_SIZE) break;
    if (page === MAX_COMPARE_COMMIT_PAGES) {
      error("release_join_verdict_source_attestation_mismatch");
    }
  }
  if (
    !first || observedCommits !== Number(first.total_commits) ||
    !sourceFilesEqual(fileNames, expectedFiles)
  ) {
    error("release_join_verdict_changed_files_mismatch");
  }
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
    const manualMergeReadback = request.manual_merge_readback || null;
    const manualGithub = manualMergeReadback?.github_readback;
    const manualSourceAction = manualMergeReadback?.predecessor?.source_action ||
      manualMergeReadback?.github_readback && {
        kind: "github.merge",
        repository: manualMergeReadback.repository,
        head_branch: manualGithub.head_branch,
        base_branch: manualGithub.base_branch,
        pull_request: manualMergeReadback.pull_request,
        head_commit: manualGithub.head_commit,
        expected_base_commit: manualGithub.base_commit,
        checks_commit: manualGithub.checks_commit,
        provider_execution: false,
      };
    const manualMergeObservation = action.kind === "render.observe" &&
      manualMergeReadback !== null;
    const source = request.source_evidence || {};
    const headCommit = sha(source.head_commit);
    const baseCommit = sha(source.base_commit);
    const treeSha = sha(source.tree_sha);
    const checksCommit = sha(request.checks_commit);
    const baseBranch = string(action.base_branch || action.branch);
    const productionDeploy = action.kind === "render.deploy" && action.environment === "production";
    const standingMerge = action.kind === "github.merge" &&
      /^[a-f0-9]{64}$/.test(string(request.required_checks_policy_digest));
    if (manualMergeObservation) {
      const { signature: _signature, receipt_digest: receiptDigest, ...receiptUnsigned } =
        manualMergeReadback || {};
      const githubUnsigned = manualGithub && { ...manualGithub };
      if (githubUnsigned) delete githubUnsigned.readback_digest;
      if (
        manualMergeReadback?.schema_version !== "host_native_owner_manual_merge_readback_v1" ||
        manualMergeReadback.authority !== "evidence_only" ||
        manualMergeReadback.evidence_only !== true ||
        manualMergeReadback.ticket_issued !== false ||
        manualMergeReadback.retrospective_ticket_issued !== false ||
        manualMergeReadback.action_authorized !== false ||
        manualMergeReadback.execution_authorized !== false ||
        manualMergeReadback.provider_execution !== false ||
        receiptDigest !== hostNativeDigest(receiptUnsigned) ||
        manualGithub?.schema_version !== "host_native_owner_manual_merge_github_readback_v1" ||
        manualGithub.trusted !== true || manualGithub.merged !== true ||
        manualGithub.provider_execution !== false ||
        manualGithub.readback_digest !== hostNativeDigest(githubUnsigned) ||
        manualGithub.tenant_id !== tenantId ||
        manualGithub.repository !== repository ||
        manualGithub.pull_request !== manualMergeReadback.pull_request ||
        manualGithub.head_commit !== headCommit ||
        manualGithub.checks_commit !== checksCommit ||
        manualGithub.base_commit !== baseCommit ||
        manualGithub.base_branch !== baseBranch ||
        manualGithub.required_checks_policy_digest !==
          string(request.required_checks_policy_digest) ||
        !sameStrings(manualGithub.required_checks, request.required_checks) ||
        manualMergeReadback.tenant_id !== tenantId ||
        manualMergeReadback.work_id !== string(request.work_id) ||
        manualMergeReadback.intent_anchor_digest !== string(request.intent_anchor_digest) ||
        manualMergeReadback.repository !== repository ||
        manualMergeReadback.core_join_verdict_id !== string(request.verdict_id) ||
        receiptDigest !== string(request.evidence_digest) ||
        manualSourceAction?.kind !== "github.merge" ||
        manualSourceAction.repository !== repository ||
        manualSourceAction.pull_request !== manualMergeReadback.pull_request ||
        manualSourceAction.head_commit !== headCommit ||
        manualSourceAction.checks_commit !== checksCommit ||
        manualSourceAction.expected_base_commit !== baseCommit ||
        manualSourceAction.base_branch !== baseBranch ||
        manualSourceAction.provider_execution !== false ||
        action.repository !== repository || action.branch !== baseBranch ||
        sha(action.target_commit) !== sha(manualGithub.merge_commit)
      ) error("release_join_verdict_manual_merge_readback_invalid");
    }
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
    const commit = await getGithub(`/git/commits/${headCommit}`);
    if (sha(commit?.sha) !== headCommit || sha(commit?.tree?.sha) !== treeSha) {
      error("release_join_verdict_source_attestation_mismatch");
    }
    const checks = await attestChecks({
      getGithub,
      tenantId,
      repository,
      baseBranch,
      baseCommit,
      checksCommit,
      requiredChecks: request.required_checks,
      action: manualMergeObservation ? manualSourceAction : action,
      requiredChecksPolicyResolver,
      workflowRunCache,
      workflowSourceCache,
      serverPullRequestAssociation: manualMergeObservation ? {
        url: `${GITHUB_ORIGIN}/repos/${repository}/pulls/${manualSourceAction.pull_request}`,
        number: manualSourceAction.pull_request,
        head: {
          ref: manualGithub.head_branch,
          sha: manualGithub.head_commit,
        },
        base: {
          ref: manualGithub.base_branch,
          sha: manualGithub.base_commit,
        },
      } : null,
    });
    if (productionDeploy || standingMerge || manualMergeObservation) {
      const requiredChecksPolicyDigest = string(request.required_checks_policy_digest);
      if (!/^[a-f0-9]{64}$/.test(requiredChecksPolicyDigest) ||
          !checks.required_checks_policy_digest) {
        error("required_checks_policy_unavailable");
      }
      if (checks.required_checks_policy_digest !== requiredChecksPolicyDigest) {
        error("required_checks_policy_mismatch");
      }
    }
    let evidenceKind;
    let pullRequest = null;
    let preMergeReadback = null;
    if (action.kind === "github.merge") {
      const pull = await getGithub(`/pulls/${Number(action.pull_request)}`);
      if (!validateMergePullRequest(pull, action, repository, null, { merged: false })) {
        error("release_join_verdict_pull_request_mismatch");
      }
      if (standingMerge) {
        preMergeReadback = await attestStandingPreMerge({
          getGithub,
          repository,
          action,
          pull,
          baseCommit,
          headCommit,
          checks,
          now,
        });
      }
      const files = [];
      let fileEntries = 0;
      for (let page = 1; page <= MAX_PULL_REQUEST_FILE_PAGES; page += 1) {
        const response = await getGithub(
          `/pulls/${Number(action.pull_request)}/files?per_page=${GITHUB_PULL_FILES_PAGE_SIZE}&page=${page}`,
        );
        if (!Array.isArray(response)) error("release_join_verdict_changed_files_mismatch");
        fileEntries += response.length;
        if (fileEntries > MAX_PULL_REQUEST_FILES) {
          error("release_join_verdict_changed_files_mismatch");
        }
        files.push(...sourceFileNames(response, "release_join_verdict_changed_files_mismatch"));
        if (response.length < GITHUB_PULL_FILES_PAGE_SIZE) break;
        if (page === MAX_PULL_REQUEST_FILE_PAGES) {
          error("release_join_verdict_changed_files_mismatch");
        }
      }
      if (!sourceFilesEqual(files, source.changed_files)) {
        error("release_join_verdict_changed_files_mismatch");
      }
      evidenceKind = "github_pull_request_files";
      pullRequest = Number(action.pull_request);
    } else if (manualMergeObservation) {
      const pull = await getGithub(`/pulls/${Number(manualSourceAction.pull_request)}`);
      if (!validateMergePullRequest(
        pull,
        manualSourceAction,
        repository,
        sha(action.target_commit),
        { merged: true },
      )) error("release_join_verdict_pull_request_mismatch");
      const files = [];
      let fileEntries = 0;
      for (let page = 1; page <= MAX_PULL_REQUEST_FILE_PAGES; page += 1) {
        const response = await getGithub(
          `/pulls/${Number(manualSourceAction.pull_request)}/files?per_page=${GITHUB_PULL_FILES_PAGE_SIZE}&page=${page}`,
        );
        if (!Array.isArray(response)) error("release_join_verdict_changed_files_mismatch");
        fileEntries += response.length;
        if (fileEntries > MAX_PULL_REQUEST_FILES) error("release_join_verdict_changed_files_mismatch");
        files.push(...sourceFileNames(response, "release_join_verdict_changed_files_mismatch"));
        if (response.length < GITHUB_PULL_FILES_PAGE_SIZE) break;
        if (page === MAX_PULL_REQUEST_FILE_PAGES) error("release_join_verdict_changed_files_mismatch");
      }
      if (!sourceFilesEqual(files, source.changed_files)) {
        error("release_join_verdict_changed_files_mismatch");
      }
      const ref = await getGithub(
        `/git/ref/heads/${encodeURIComponent(baseBranch).replace(/%2F/g, "/")}`,
      );
      if (sha(ref?.object?.sha) !== sha(action.target_commit) ||
          sha(manualGithub.main_head_commit) !== sha(action.target_commit) ||
          sha(manualGithub.merge_commit) !== sha(action.target_commit)) {
        error("release_join_verdict_source_attestation_mismatch");
      }
      evidenceKind = "github_manual_merge_readback";
      pullRequest = Number(manualSourceAction.pull_request);
    } else if (productionDeploy) {
      if (
        !validBranch(action.branch) || action.branch !== baseBranch ||
        sha(action.source_commit) !== headCommit ||
        sha(action.target_commit) !== headCommit ||
        sha(action.expected_base_commit) !== baseCommit
      ) error("release_join_verdict_action_invalid");
      const ref = await getGithub(
        `/git/ref/heads/${encodeURIComponent(action.branch).replace(/%2F/g, "/")}`,
      );
      if (sha(ref?.object?.sha) !== headCommit) {
        error("release_join_verdict_source_attestation_mismatch");
      }
      await attestCompareSource({
        getGithub,
        repository,
        baseCommit,
        headCommit,
        treeSha,
        expectedFiles: source.changed_files,
      });
      evidenceKind = "github_compare_files";
    } else {
      error("release_join_verdict_action_invalid");
    }
    const delivery = Array.isArray(request.delivery_services) ? request.delivery_services : [];
    if (delivery.length < 1) error("release_join_verdict_previous_live_mismatch");
    const previous_live_attestations = [];
    for (const service of delivery) {
      const origin = originForHealth(service?.origin, "release_join_verdict_previous_live_mismatch");
      const expectedLive = sha(service?.expected_previous_commit);
      if (!expectedLive) error("release_join_verdict_previous_live_mismatch");
      if (manualMergeObservation) {
        previous_live_attestations.push(manualMergePreviousLiveBinding({
          service,
          origin,
          manualMergeReadback,
        }));
        continue;
      }
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
      evidence_kind: evidenceKind,
      pull_request: pullRequest,
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
      ...(productionDeploy || standingMerge || manualMergeObservation ? {
        required_checks_policy_digest: checks.required_checks_policy_digest,
      } : {}),
      ...(preMergeReadback ? {
        pre_merge_readback: preMergeReadback,
        pre_merge_readback_digest: hostNativeDigest(preMergeReadback),
      } : {}),
      provider_execution: false,
    };
  };
  Object.defineProperties(resolve, {
    trusted: { value: true },
    standing_pre_merge_readback: { value: true },
  });
  return resolve;
}

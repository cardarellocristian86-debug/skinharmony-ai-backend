import crypto from "node:crypto";

export const AGENTIC_EFFICIENCY_VERSION = "0.16.0-ai-learning-factory";
export const AGENTIC_EFFICIENCY_SCHEMA_VERSION = "agentic_efficiency_runtime_v1";
export const AGENTIC_WORK_CAPSULE_SCHEMA_VERSION = "agentic_work_capsule_v1";
export const AGENTIC_EFFICIENCY_DEFAULT_MODE = "shadow";
export const AGENTIC_BUDGET_DEFAULT_MODE = "observe";

const WORK_CAPSULE_KEYS = Object.freeze([
  "goal",
  "scope",
  "success_criteria",
  "decisions",
  "completed",
  "open_risks",
  "relevant_files",
  "changed_files",
  "diff_summary",
  "test_state",
  "artifact_hashes",
  "reusable_results",
  "next_action",
  "budget",
  "created_at",
  "expires_at",
]);

const TASK_REQUEST_KEYS = new Set([
  "goal",
  "scope",
  "success_criteria",
  "decisions",
  "completed",
  "open_risks",
  "relevant_files",
  "changed_files",
  "diff_summary",
  "test_state",
  "artifact_hashes",
  "reusable_results",
  "next_action",
  "budget",
  "risk",
  "reversibility",
  "separable",
  "independent_workstreams",
  "requested_agent_count",
  "required_tools",
  "available_tools",
  "checkpoint",
  "retry_count",
  "reviewer_required",
  "security_tests_required",
  "security_tests_passed",
  "acceptance_evidence",
  "host_capabilities",
  "model_candidates",
  "quality_baseline",
  "quality_prediction",
  "critical",
  "work_capsule",
]);

const TRUSTED_IDENTITY_KEYS = new Set([
  "tenant",
  "tenant_id",
  "tenantId",
  "client_type",
  "clientType",
  "audience",
  "entitlements",
  "actor_id",
  "actorId",
  "role",
  "owner_root",
]);

const INJECTION_PATTERNS = Object.freeze([
  /\bignore\s+(?:all|any|the|previous|prior)\s+(?:instructions?|rules?|policy|messages?)\b/i,
  /\b(?:system|developer)\s+(?:message|prompt)\s*:/i,
  /\b(?:bypass|disable|override)\s+(?:core|governance|safety|tenant|policy|review)\b/i,
  /\b(?:run|execute)\s+(?:this\s+)?(?:shell|terminal|command)\b/i,
  /\brm\s+-rf\b/i,
  /\b(?:reveal|print|exfiltrate)\s+(?:the\s+)?(?:secret|token|credential|key|password)\b/i,
]);

const SECRET_PATTERNS = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[opsu]_[A-Za-z0-9]{20,}\b/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /\b(?:password|client_secret|access_token)\s*[:=]\s*[^\s,;]{8,}/i,
]);

const PERSONAL_DATA_PATTERNS = Object.freeze([
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[REDACTED_EMAIL]",
  },
  {
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[REDACTED_IP]",
  },
  {
    pattern: /(?:\+?\d[\d .()-]{7,}\d)/g,
    replacement: "[REDACTED_PHONE]",
  },
]);
const DURABLE_DIGEST_LABEL_PATTERN = /^[a-z_]+:sha256:[a-f0-9]{64}$/;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, freeze(item)]),
    ));
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((output, key) => {
    if (value[key] !== undefined) output[key] = canonical(value[key]);
    return output;
  }, {});
}

export function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

export function digestAgenticArtifact(value) {
  return `sha256:${crypto.createHash("sha256").update(
    typeof value === "string" ? value : canonicalJson(value),
  ).digest("hex")}`;
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}_invalid`);
  }
  return value;
}

function requireExactKeys(value, expected, field) {
  const actual = Object.keys(requireObject(value, field)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${field}_schema_invalid`);
  }
}

function requireText(value, field, max = 4_000, { allowEmpty = false } = {}) {
  const normalized = String(value ?? "").trim();
  if ((!allowEmpty && !normalized) || normalized.length > max || normalized.includes("\u0000")) {
    throw new Error(`${field}_invalid`);
  }
  return normalized;
}

function redactMetadataText(value, field, max = 4_000, { allowEmpty = false } = {}) {
  let normalized = requireText(value, field, max, { allowEmpty });
  if (DURABLE_DIGEST_LABEL_PATTERN.test(normalized)) return normalized;
  for (const { pattern, replacement } of PERSONAL_DATA_PATTERNS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function rejectPersonalData(value, field) {
  const normalized = requireText(value, field, 1_000);
  if (DURABLE_DIGEST_LABEL_PATTERN.test(normalized)) return normalized;
  if (PERSONAL_DATA_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(normalized);
  })) {
    throw new Error(`${field}_personal_data_forbidden`);
  }
  return normalized;
}

function requireNonNegativeInteger(value, field, ceiling = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > ceiling) {
    throw new Error(`${field}_invalid`);
  }
  return number;
}

function requireFiniteNumber(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${field}_invalid`);
  return number;
}

function requireIsoTimestamp(value, field) {
  const normalized = requireText(value, field, 64);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`${field}_invalid`);
  return { value: new Date(parsed).toISOString(), millis: parsed };
}

function requireTextList(value, field, {
  maxItems = 100,
  maxItemLength = 1_000,
  allowEmpty = true,
} = {}) {
  if (!Array.isArray(value) || value.length > maxItems || (!allowEmpty && value.length === 0)) {
    throw new Error(`${field}_invalid`);
  }
  return value.map((item, index) => requireText(item, `${field}_${index}`, maxItemLength));
}

function walkStrings(value, visitor, path = "payload") {
  if (typeof value === "string") {
    visitor(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, visitor, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) walkStrings(item, visitor, `${path}.${key}`);
  }
}

export function assertAgenticContentSafe(value, field = "payload") {
  walkStrings(value, (text, path) => {
    if (INJECTION_PATTERNS.some((pattern) => pattern.test(text))) {
      throw new Error(`${field}_injection_detected:${path}`);
    }
    if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
      throw new Error(`${field}_sensitive_content_detected:${path}`);
    }
  });
  return true;
}

function validateRepoPath(value, field) {
  const path = requireText(value, field, 1_000);
  if (path.startsWith("/") || path.split(/[\\/]/).includes("..")) throw new Error(`${field}_invalid`);
  return path;
}

function normalizeTestState(value) {
  requireExactKeys(value, ["passed", "failed", "pending"], "work_capsule_test_state");
  return {
    passed: requireNonNegativeInteger(value.passed, "work_capsule_test_passed", 1_000_000),
    failed: requireNonNegativeInteger(value.failed, "work_capsule_test_failed", 1_000_000),
    pending: requireNonNegativeInteger(value.pending, "work_capsule_test_pending", 1_000_000),
  };
}

function normalizeBudget(value) {
  requireExactKeys(value, ["token_limit", "invocation_limit", "retry_limit"], "work_capsule_budget");
  return {
    token_limit: requireNonNegativeInteger(value.token_limit, "work_capsule_token_limit", 1_000_000_000),
    invocation_limit: requireNonNegativeInteger(value.invocation_limit, "work_capsule_invocation_limit", 100_000),
    retry_limit: requireNonNegativeInteger(value.retry_limit, "work_capsule_retry_limit", 100),
  };
}

export function validateWorkCapsule(capsule, {
  now = new Date(),
  allowExpired = false,
  maxTtlMs = 7 * 24 * 60 * 60 * 1_000,
} = {}) {
  requireExactKeys(capsule, WORK_CAPSULE_KEYS, "work_capsule");
  assertAgenticContentSafe(capsule, "work_capsule");
  const created = requireIsoTimestamp(capsule.created_at, "work_capsule_created_at");
  const expires = requireIsoTimestamp(capsule.expires_at, "work_capsule_expires_at");
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error("work_capsule_clock_invalid");
  if (created.millis > nowMs + 5 * 60 * 1_000) throw new Error("work_capsule_created_in_future");
  if (expires.millis <= created.millis || expires.millis - created.millis > maxTtlMs) {
    throw new Error("work_capsule_expiry_invalid");
  }
  if (!allowExpired && expires.millis <= nowMs) throw new Error("work_capsule_stale");

  const normalized = {
    goal: redactMetadataText(capsule.goal, "work_capsule_goal", 1_000),
    scope: requireTextList(capsule.scope, "work_capsule_scope", { maxItems: 100, maxItemLength: 1_000 })
      .map((item, index) => validateRepoPath(
        rejectPersonalData(item, `work_capsule_scope_${index}`),
        `work_capsule_scope_${index}`,
      )),
    success_criteria: requireTextList(capsule.success_criteria, "work_capsule_success_criteria", {
      maxItems: 100,
      maxItemLength: 1_000,
      allowEmpty: false,
    }).map((item, index) => redactMetadataText(item, `work_capsule_success_criteria_${index}`, 1_000)),
    decisions: requireTextList(capsule.decisions, "work_capsule_decisions")
      .map((item, index) => redactMetadataText(item, `work_capsule_decisions_${index}`, 1_000)),
    completed: requireTextList(capsule.completed, "work_capsule_completed")
      .map((item, index) => redactMetadataText(item, `work_capsule_completed_${index}`, 1_000)),
    open_risks: requireTextList(capsule.open_risks, "work_capsule_open_risks")
      .map((item, index) => redactMetadataText(item, `work_capsule_open_risks_${index}`, 1_000)),
    relevant_files: requireTextList(capsule.relevant_files, "work_capsule_relevant_files", {
      maxItems: 200,
      maxItemLength: 1_000,
    }).map((item, index) => validateRepoPath(
      rejectPersonalData(item, `work_capsule_relevant_files_${index}`),
      `work_capsule_relevant_files_${index}`,
    )),
    changed_files: requireTextList(capsule.changed_files, "work_capsule_changed_files", {
      maxItems: 200,
      maxItemLength: 1_000,
    }).map((item, index) => validateRepoPath(
      rejectPersonalData(item, `work_capsule_changed_files_${index}`),
      `work_capsule_changed_files_${index}`,
    )),
    diff_summary: redactMetadataText(capsule.diff_summary, "work_capsule_diff_summary", 4_000, { allowEmpty: true }),
    test_state: normalizeTestState(capsule.test_state),
    artifact_hashes: requireTextList(capsule.artifact_hashes, "work_capsule_artifact_hashes", {
      maxItems: 200,
      maxItemLength: 80,
    }).map((digest, index) => {
      if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error(`work_capsule_artifact_hashes_${index}_invalid`);
      return digest;
    }),
    reusable_results: requireTextList(capsule.reusable_results, "work_capsule_reusable_results")
      .map((item, index) => redactMetadataText(item, `work_capsule_reusable_results_${index}`, 1_000)),
    next_action: redactMetadataText(capsule.next_action, "work_capsule_next_action", 1_000, { allowEmpty: true }),
    budget: normalizeBudget(capsule.budget),
    created_at: created.value,
    expires_at: expires.value,
  };
  return freeze(normalized);
}

export function workCapsuleHash(capsule, options = {}) {
  return digestAgenticArtifact(validateWorkCapsule(capsule, options));
}

export function createWorkCapsuleEnvelope({
  tenantId,
  actorId,
  capsule,
  version = 1,
  now = new Date(),
} = {}) {
  const normalizedTenant = requireText(tenantId, "tenant_id", 120);
  const normalizedActor = requireText(actorId, "actor_id", 160);
  const normalizedCapsule = validateWorkCapsule(capsule, { now });
  return freeze({
    schema_version: AGENTIC_WORK_CAPSULE_SCHEMA_VERSION,
    tenant_id: normalizedTenant,
    capsule_version: requireNonNegativeInteger(version, "capsule_version", 1_000_000),
    capsule_hash: digestAgenticArtifact(normalizedCapsule),
    actor_provenance: normalizedActor,
    capsule: normalizedCapsule,
  });
}

export function verifyWorkCapsuleEnvelope(envelope, {
  tenantId,
  now = new Date(),
  expectedHash = null,
  expectedVersion = null,
  allowExpired = false,
} = {}) {
  requireObject(envelope, "work_capsule_envelope");
  if (envelope.schema_version !== AGENTIC_WORK_CAPSULE_SCHEMA_VERSION) {
    throw new Error("work_capsule_schema_version_invalid");
  }
  const trustedTenant = requireText(tenantId, "tenant_id", 120);
  if (requireText(envelope.tenant_id, "work_capsule_tenant_id", 120) !== trustedTenant) {
    throw new Error("work_capsule_cross_tenant");
  }
  const capsule = validateWorkCapsule(envelope.capsule, { now, allowExpired });
  const digest = digestAgenticArtifact(capsule);
  if (digest !== envelope.capsule_hash || (expectedHash && digest !== expectedHash)) {
    throw new Error("work_capsule_tampered");
  }
  if (expectedVersion !== null && Number(envelope.capsule_version) !== Number(expectedVersion)) {
    throw new Error("work_capsule_version_mismatch");
  }
  requireText(envelope.actor_provenance, "work_capsule_actor_provenance", 160);
  return freeze({ valid: true, capsule_hash: digest, capsule });
}

export function assertNoUntrustedIdentity(value, path = "payload") {
  if (!value || typeof value !== "object") return true;
  for (const [key, item] of Object.entries(value)) {
    if (TRUSTED_IDENTITY_KEYS.has(key)) throw new Error(`untrusted_identity_field:${path}.${key}`);
    if (item && typeof item === "object") assertNoUntrustedIdentity(item, `${path}.${key}`);
  }
  return true;
}

function normalizeTaskRequest(request, now) {
  requireObject(request, "agentic_task");
  assertNoUntrustedIdentity(request);
  assertAgenticContentSafe(request, "agentic_task");
  for (const key of Object.keys(request)) {
    if (!TASK_REQUEST_KEYS.has(key)) throw new Error(`agentic_task_field_not_allowed:${key}`);
  }
  const goal = requireText(request.goal, "agentic_task_goal", 1_000);
  const scope = requireTextList(request.scope || [], "agentic_task_scope", {
    maxItems: 100,
    maxItemLength: 1_000,
  }).map((item, index) => validateRepoPath(item, `agentic_task_scope_${index}`));
  const successCriteria = requireTextList(request.success_criteria || [], "agentic_task_success_criteria", {
    maxItems: 100,
    maxItemLength: 1_000,
    allowEmpty: false,
  });
  const relevantFiles = requireTextList(request.relevant_files || scope, "agentic_task_relevant_files", {
    maxItems: 200,
    maxItemLength: 1_000,
  }).map((item, index) => validateRepoPath(item, `agentic_task_relevant_files_${index}`));
  const budget = request.budget || { token_limit: 0, invocation_limit: 0, retry_limit: 0 };
  const normalizedBudget = normalizeBudget(budget);
  const testState = normalizeTestState(request.test_state || { passed: 0, failed: 0, pending: 0 });
  const hostCapabilities = request.host_capabilities && typeof request.host_capabilities === "object"
    ? {
        model_control: request.host_capabilities.model_control === true,
        usage_receipts: request.host_capabilities.usage_receipts === true,
      }
    : { model_control: false, usage_receipts: false };
  const normalized = {
    goal,
    scope,
    success_criteria: successCriteria,
    decisions: requireTextList(request.decisions || [], "agentic_task_decisions"),
    completed: requireTextList(request.completed || [], "agentic_task_completed"),
    open_risks: requireTextList(request.open_risks || [], "agentic_task_open_risks"),
    relevant_files: relevantFiles,
    changed_files: requireTextList(request.changed_files || [], "agentic_task_changed_files", {
      maxItems: 200,
      maxItemLength: 1_000,
    }).map((item, index) => validateRepoPath(item, `agentic_task_changed_files_${index}`)),
    diff_summary: requireText(request.diff_summary || "", "agentic_task_diff_summary", 4_000, { allowEmpty: true }),
    test_state: testState,
    artifact_hashes: requireTextList(request.artifact_hashes || [], "agentic_task_artifact_hashes", {
      maxItems: 200,
      maxItemLength: 80,
    }),
    reusable_results: requireTextList(request.reusable_results || [], "agentic_task_reusable_results"),
    next_action: requireText(request.next_action || "", "agentic_task_next_action", 1_000, { allowEmpty: true }),
    budget: normalizedBudget,
    risk: ["low", "medium", "high", "critical"].includes(request.risk) ? request.risk : "medium",
    reversibility: ["easy", "bounded", "difficult", "irreversible"].includes(request.reversibility)
      ? request.reversibility
      : "bounded",
    separable: request.separable === true,
    independent_workstreams: requireNonNegativeInteger(request.independent_workstreams || 0, "independent_workstreams", 20),
    requested_agent_count: requireNonNegativeInteger(request.requested_agent_count || 1, "requested_agent_count", 100),
    required_tools: requireTextList(request.required_tools || [], "required_tools", { maxItems: 100, maxItemLength: 160 }),
    available_tools: requireTextList(request.available_tools || [], "available_tools", { maxItems: 200, maxItemLength: 160 }),
    checkpoint: request.checkpoint && typeof request.checkpoint === "object" && !Array.isArray(request.checkpoint)
      ? clone(request.checkpoint)
      : null,
    retry_count: requireNonNegativeInteger(request.retry_count || 0, "retry_count", 1_000),
    reviewer_required: request.reviewer_required === true,
    security_tests_required: request.security_tests_required !== false,
    security_tests_passed: request.security_tests_passed === true,
    acceptance_evidence: requireTextList(request.acceptance_evidence || [], "acceptance_evidence", {
      maxItems: 200,
      maxItemLength: 1_000,
    }),
    host_capabilities: hostCapabilities,
    model_candidates: requireTextList(request.model_candidates || [], "model_candidates", {
      maxItems: 20,
      maxItemLength: 160,
    }),
    quality_baseline: requireFiniteNumber(request.quality_baseline ?? 1, "quality_baseline", { min: 0, max: 1 }),
    quality_prediction: requireFiniteNumber(request.quality_prediction ?? request.quality_baseline ?? 1, "quality_prediction", {
      min: 0,
      max: 1,
    }),
    critical: request.critical === true || request.risk === "critical",
  };
  if (request.work_capsule) {
    normalized.work_capsule = validateWorkCapsule(request.work_capsule, { now });
  }
  for (let index = 0; index < normalized.artifact_hashes.length; index += 1) {
    if (!/^sha256:[a-f0-9]{64}$/.test(normalized.artifact_hashes[index])) {
      throw new Error(`agentic_task_artifact_hashes_${index}_invalid`);
    }
  }
  return normalized;
}

function taskComplexity(task) {
  let score = 1;
  score += Math.min(4, Math.ceil(task.relevant_files.length / 5));
  score += Math.min(3, Math.ceil(task.success_criteria.length / 4));
  score += Math.min(2, Math.ceil(task.required_tools.length / 3));
  score += Math.min(3, task.independent_workstreams);
  score += { low: 0, medium: 2, high: 4, critical: 6 }[task.risk];
  score += { easy: 0, bounded: 1, difficult: 3, irreversible: 6 }[task.reversibility];
  const level = score <= 5 ? "simple" : score <= 10 ? "moderate" : score <= 15 ? "complex" : "critical";
  return { score, level };
}

function minimumAgentCount(task, complexity) {
  if (task.critical || task.reviewer_required) {
    return Math.min(3, Math.max(2, task.independent_workstreams || 2));
  }
  if (!task.separable || task.independent_workstreams < 2) return 1;
  if (complexity.level === "critical") return Math.min(3, Math.max(2, task.independent_workstreams));
  if (complexity.level === "complex") return Math.min(3, Math.max(2, task.independent_workstreams));
  if (complexity.level === "moderate" && task.independent_workstreams >= 2) return 2;
  return 1;
}

function minimalTools(task) {
  const allowed = new Set(task.available_tools);
  return task.required_tools.filter((tool, index, list) => (
    list.indexOf(tool) === index && (allowed.size === 0 || allowed.has(tool))
  ));
}

function reviewerContext(task) {
  return freeze({
    success_criteria: task.success_criteria,
    changed_files: task.changed_files,
    diff_summary: task.diff_summary,
    test_state: task.test_state,
    evidence: task.acceptance_evidence,
    open_risks: task.open_risks,
    uncertainties: task.decisions.filter((decision) => /\b(?:uncertain|unknown|verify|pending)\b/i.test(decision)),
    full_history_included: false,
    repository_snapshot_included: false,
  });
}

export function evaluateAgenticEarlyStop({
  successCriteria = [],
  completed = [],
  testState = { passed: 0, failed: 0, pending: 0 },
  evidence = [],
  securityTestsRequired = true,
  securityTestsPassed = false,
  critical = false,
  humanReviewVerified = false,
  acceptanceVerified = false,
  testsVerified = false,
  evidenceVerified = false,
  securityTestsVerified = false,
} = {}) {
  const criteria = new Set(successCriteria);
  const completedSet = new Set(completed);
  const allCriteriaSatisfied = criteria.size > 0 && [...criteria].every((criterion) => completedSet.has(criterion));
  const testsGreen = Number(testState.failed) === 0 && Number(testState.pending) === 0;
  const evidencePresent = Array.isArray(evidence) && evidence.length > 0;
  const safetySatisfied = !securityTestsRequired || (
    securityTestsPassed === true && securityTestsVerified === true
  );
  const criticalReviewSatisfied = !critical || humanReviewVerified === true;
  const trustedVerificationSatisfied = acceptanceVerified === true
    && testsVerified === true
    && evidenceVerified === true;
  const allowed = allCriteriaSatisfied
    && testsGreen
    && evidencePresent
    && safetySatisfied
    && criticalReviewSatisfied
    && trustedVerificationSatisfied;
  return freeze({
    allowed,
    all_criteria_satisfied: allCriteriaSatisfied,
    tests_green: testsGreen,
    evidence_present: evidencePresent,
    safety_satisfied: safetySatisfied,
    critical_review_satisfied: criticalReviewSatisfied,
    trusted_acceptance_verified: acceptanceVerified === true,
    trusted_tests_verified: testsVerified === true,
    trusted_evidence_verified: evidenceVerified === true,
    reason: allowed ? "acceptance_criteria_verified" : "work_or_verification_remaining",
  });
}

function buildGeneratedCapsule(task, now, ttlMs) {
  const created = new Date(now);
  const source = task.work_capsule || {
    goal: task.goal,
    scope: task.scope,
    success_criteria: task.success_criteria,
    decisions: task.decisions,
    completed: task.completed,
    open_risks: task.open_risks,
    relevant_files: task.relevant_files,
    changed_files: task.changed_files,
    diff_summary: task.diff_summary,
    test_state: task.test_state,
    artifact_hashes: task.artifact_hashes,
    reusable_results: task.reusable_results,
    next_action: task.next_action,
    budget: task.budget,
    created_at: created.toISOString(),
    expires_at: new Date(created.getTime() + ttlMs).toISOString(),
  };
  // The planner keeps an actionable, bounded and redacted in-memory capsule.
  // app.js compiles its separate PostgreSQL representation to digests at the
  // persistence boundary, so durable storage never becomes a prompt archive.
  return validateWorkCapsule(source, { now: created });
}

export function buildAgenticEfficiencyPlan({
  trustedContext,
  trustedVerification = {},
  request,
  now = new Date(),
  mode = AGENTIC_EFFICIENCY_DEFAULT_MODE,
  capsuleTtlMs = 60 * 60 * 1_000,
} = {}) {
  const context = requireObject(trustedContext, "trusted_context");
  const tenantId = requireText(context.tenantId, "trusted_context_tenant_id", 120);
  const actorId = requireText(context.actorId, "trusted_context_actor_id", 160);
  requireText(context.clientType, "trusted_context_client_type", 80);
  requireText(context.audience, "trusted_context_audience", 160);
  const task = normalizeTaskRequest(request, now);
  const complexity = taskComplexity(task);
  const agentCount = minimumAgentCount(task, complexity);
  const tools = minimalTools(task);
  const suppressedAgents = Math.max(0, task.requested_agent_count - agentCount);
  const checkpointResume = task.retry_count > 0 && task.checkpoint !== null;
  const retryLimit = task.budget.retry_limit || 3;
  const retryAllowed = task.retry_count < retryLimit && (task.retry_count === 0 || checkpointResume);
  const capsule = buildGeneratedCapsule(task, now, capsuleTtlMs);
  const envelope = createWorkCapsuleEnvelope({ tenantId, actorId, capsule, now });
  const verificationReceiptValid = /^sha256:[a-f0-9]{64}$/.test(String(trustedVerification.receiptDigest || ""));
  const effectiveCritical = task.critical || (
    verificationReceiptValid && trustedVerification.criticalTaskVerified === true
  );
  const earlyStop = evaluateAgenticEarlyStop({
    successCriteria: task.success_criteria,
    completed: task.completed,
    testState: task.test_state,
    evidence: task.acceptance_evidence,
    // Active optimization can never downgrade the release security floor.
    // A caller may request additional checks, but cannot opt out of them.
    securityTestsRequired: true,
    securityTestsPassed: task.security_tests_passed,
    critical: effectiveCritical,
    humanReviewVerified: verificationReceiptValid && trustedVerification.humanReviewVerified === true,
    acceptanceVerified: verificationReceiptValid && trustedVerification.acceptanceVerified === true,
    testsVerified: verificationReceiptValid && trustedVerification.testsVerified === true,
    evidenceVerified: verificationReceiptValid && trustedVerification.evidenceVerified === true,
    securityTestsVerified: verificationReceiptValid && trustedVerification.securityTestsVerified === true,
  });
  const qualityLoss = Math.max(0, task.quality_baseline - task.quality_prediction);
  const modelControl = task.host_capabilities.model_control === true
    && verificationReceiptValid
    && trustedVerification.hostModelControlVerified === true;
  const modelRouting = {
    mode: modelControl ? "bounded_recommendation" : "recommendation_only",
    host_control_verified: modelControl,
    candidate: task.model_candidates[0] || null,
    escalation_allowed: false,
    savings_claim_allowed: false,
    reason: modelControl ? "core_authorization_required" : "host_model_control_unavailable",
  };
  const fileSet = [...new Set(task.relevant_files)].slice(0, 50);
  const estimatedFullContextUnits = Math.max(1, task.scope.length + task.relevant_files.length + task.decisions.length + task.completed.length);
  const deltaContextUnits = Math.max(1, task.changed_files.length + task.open_risks.length + task.acceptance_evidence.length);
  const avoidedUnits = Math.max(0, estimatedFullContextUnits - deltaContextUnits);

  return freeze({
    schema_version: AGENTIC_EFFICIENCY_SCHEMA_VERSION,
    release: AGENTIC_EFFICIENCY_VERSION,
    tenant_id: tenantId,
    mode: ["off", "shadow", "active"].includes(mode) ? mode : AGENTIC_EFFICIENCY_DEFAULT_MODE,
    production_status: "advisory",
    execution_authorized: false,
    external_execution: false,
    plan: {
      complexity,
      risk: task.risk,
      reversibility: task.reversibility,
      agent_count: agentCount,
      topology: agentCount === 1 ? "single_agent" : "bounded_parallel_with_supervisor",
      suppressed_agent_count: suppressedAgents,
      duplicate_work_policy: "claim_lease_required",
      context: {
        packaging: task.work_capsule ? "capsule_delta" : "new_capsule",
        full_history_included: false,
        full_repository_included: false,
        relevant_files: fileSet,
        estimated_full_context_units: estimatedFullContextUnits,
        delta_context_units: deltaContextUnits,
        avoided_context_units: avoidedUnits,
      },
      tools: {
        selected: tools,
        omitted: task.available_tools.filter((tool) => !tools.includes(tool)),
        arbitrary_tool_access: false,
      },
      artifacts: {
        requested_hashes: task.artifact_hashes,
        reuse_requires_separate_verification: true,
      },
      reviewer: {
        mandatory: effectiveCritical || task.reviewer_required,
        independent: effectiveCritical || task.reviewer_required,
        context: reviewerContext(task),
        may_repeat_full_task: false,
      },
      retry: {
        attempt: task.retry_count,
        limit: retryLimit,
        allowed: retryAllowed,
        resume_from_checkpoint: checkpointResume,
        restart_from_zero: false,
      },
      early_stop: earlyStop,
      model_routing: modelRouting,
      quality: {
        baseline: task.quality_baseline,
        predicted: task.quality_prediction,
        predicted_loss: qualityLoss,
        within_two_percent: qualityLoss <= 0.02,
      },
    },
    work_capsule: envelope,
    audit: {
      branch_id: "agentic_efficiency_intelligence",
      core_binding: "agentic_budget_governance_guard",
      raw_prompt_stored: false,
      secret_stored: false,
      customer_content_stored: false,
      durable_capsule_free_text_persisted: false,
      durable_capsule_metadata_representation: "domain_separated_sha256",
      ephemeral_capsule_actionable: true,
    },
  });
}

function validateRateCard(rateCard) {
  const card = requireObject(rateCard, "rate_card");
  const normalized = {
    version: requireText(card.version, "rate_card_version", 160),
    provider: requireText(card.provider, "rate_card_provider", 160),
    model_id: requireText(card.model_id, "rate_card_model_id", 160),
    currency: requireText(card.currency, "rate_card_currency", 16),
    input_per_million: requireFiniteNumber(card.input_per_million, "rate_card_input_per_million"),
    cached_input_per_million: requireFiniteNumber(card.cached_input_per_million ?? card.input_per_million, "rate_card_cached_input_per_million"),
    output_per_million: requireFiniteNumber(card.output_per_million, "rate_card_output_per_million"),
    effective_at: requireIsoTimestamp(card.effective_at, "rate_card_effective_at").value,
    source: requireText(card.source, "rate_card_source", 500),
    provenance_digest: requireText(card.provenance_digest, "rate_card_provenance_digest", 80),
  };
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized.provenance_digest)) {
    throw new Error("rate_card_provenance_digest_invalid");
  }
  return normalized;
}

function roundedMoney(value) {
  return Number(value.toFixed(6));
}

export function normalizeAgenticUsage(usage, {
  providerUsageVerified = false,
  rateCardVerified = false,
  rateCard,
} = {}) {
  const input = requireObject(usage, "usage");
  assertNoUntrustedIdentity(input);
  for (const forbidden of ["cost", "actual_cost", "estimated_cost", "credit_cost", "savings"]) {
    if (Object.prototype.hasOwnProperty.call(input, forbidden)) throw new Error("caller_supplied_cost_forbidden");
  }
  const card = validateRateCard(rateCard);
  const inputTokens = requireNonNegativeInteger(input.input_tokens || 0, "usage_input_tokens", 1_000_000_000);
  const outputTokens = requireNonNegativeInteger(input.output_tokens || 0, "usage_output_tokens", 1_000_000_000);
  const claimedCached = requireNonNegativeInteger(input.cached_input_tokens || 0, "usage_cached_input_tokens", 1_000_000_000);
  const receiptDigest = String(input.provider_receipt_digest || "");
  const actual = providerUsageVerified === true
    && rateCardVerified === true
    && input.usage_kind === "actual"
    && /^sha256:[a-f0-9]{64}$/.test(receiptDigest);
  if (claimedCached > 0 && !actual) throw new Error("cached_usage_unverified");
  const cachedTokens = actual ? claimedCached : 0;
  if (cachedTokens > inputTokens) throw new Error("cached_usage_exceeds_input");
  const uncachedInput = inputTokens - cachedTokens;
  const calculated = (
    (uncachedInput * card.input_per_million)
    + (cachedTokens * card.cached_input_per_million)
    + (outputTokens * card.output_per_million)
  ) / 1_000_000;
  return freeze({
    usage_kind: actual ? "actual" : "estimated",
    reconciled: actual,
    input_tokens: inputTokens,
    cached_input_tokens: cachedTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    amount: roundedMoney(calculated),
    currency: card.currency,
    formula: "(uncached_input*input_rate + cached_input*cached_rate + output*output_rate)/1000000",
    rate_card_version: card.version,
    rate_card_provenance: card.provenance_digest,
    rate_card_verified: rateCardVerified === true,
    usage_source: actual
      ? "verified_provider_receipt"
      : rateCardVerified
        ? "verified_rate_card_estimate"
        : "unverified_declared_rate_card_estimate",
    provider_receipt_digest: actual ? receiptDigest : null,
  });
}

function budgetExceeded(limit, value) {
  return Number(limit) > 0 && Number(value) > Number(limit);
}

export function evaluateAgenticBudgetGuard({
  trustedContext,
  plan,
  policy,
  usage = null,
  rateCard = null,
  providerUsageVerified = false,
  rateCardVerified = false,
  auditReceiptVerified = false,
  trustedVerifications = {},
  now = new Date(),
  mode = AGENTIC_BUDGET_DEFAULT_MODE,
} = {}) {
  const context = requireObject(trustedContext, "trusted_context");
  const tenantId = requireText(context.tenantId, "trusted_context_tenant_id", 120);
  requireText(context.actorId, "trusted_context_actor_id", 160);
  const candidate = requireObject(plan, "agentic_plan");
  if (candidate.tenant_id !== tenantId) throw new Error("agentic_plan_cross_tenant");
  const budgetPolicy = requireObject(policy, "budget_policy");
  assertNoUntrustedIdentity(budgetPolicy);
  const expires = requireIsoTimestamp(budgetPolicy.expires_at, "budget_policy_expires_at");
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const reasons = [];
  if (expires.millis <= nowMs) reasons.push("budget_policy_expired");
  const governanceReceiptValid = /^sha256:[a-f0-9]{64}$/.test(
    String(trustedVerifications.governanceReceiptDigest || ""),
  );
  if (budgetPolicy.override === true && !(auditReceiptVerified && governanceReceiptValid)) {
    reasons.push("budget_override_not_audited");
  }
  if (budgetPolicy.skip_security_tests === true) reasons.push("security_non_degradation_failed");
  if (budgetPolicy.remove_critical_reviewer === true) reasons.push("critical_reviewer_required");
  if (budgetPolicy.model_escalation === true && (
    candidate.plan?.model_routing?.host_control_verified !== true
    || !governanceReceiptValid
    || trustedVerifications.modelEscalationAuthorized !== true
  )) reasons.push("model_escalation_not_authorized");

  const qualityAttested = governanceReceiptValid
    && trustedVerifications.qualityVerified === true
    && Number.isFinite(Number(trustedVerifications.qualityBaseline))
    && Number.isFinite(Number(trustedVerifications.qualityPrediction));
  const baseline = requireFiniteNumber(
    qualityAttested
      ? trustedVerifications.qualityBaseline
      : budgetPolicy.quality_baseline ?? candidate.plan?.quality?.baseline ?? 1,
    "budget_quality_baseline", {
    min: 0,
    max: 1,
  });
  const predicted = requireFiniteNumber(
    qualityAttested
      ? trustedVerifications.qualityPrediction
      : budgetPolicy.quality_prediction ?? candidate.plan?.quality?.predicted ?? baseline,
    "budget_quality_prediction", {
    min: 0,
    max: 1,
  });
  const qualityFloor = requireFiniteNumber(budgetPolicy.quality_floor ?? Math.max(0, baseline - 0.02), "budget_quality_floor", {
    min: 0,
    max: 1,
  });
  if (predicted < qualityFloor || baseline - predicted > 0.02) reasons.push("quality_floor_failed");
  if (!qualityAttested) reasons.push("quality_attestation_missing");
  const securityRequired = true;
  if (budgetPolicy.security_checks_required === false) {
    reasons.push("security_policy_cannot_be_disabled");
  }
  const securityVerified = governanceReceiptValid && trustedVerifications.securityVerified === true;
  const tenantIsolationVerified = governanceReceiptValid && trustedVerifications.tenantIsolationVerified === true;
  const exposurePolicyVerified = governanceReceiptValid && trustedVerifications.exposurePolicyVerified === true;
  if (securityRequired && !securityVerified) reasons.push("security_checks_unverified");
  if (!tenantIsolationVerified) reasons.push("tenant_isolation_unverified");
  if (!exposurePolicyVerified) reasons.push("exposure_policy_unverified");

  let normalizedUsage = null;
  if (usage && rateCard) {
    const trustedRateCard = governanceReceiptValid
      && trustedVerifications.rateCardVerified === true
      && rateCardVerified === true;
    normalizedUsage = normalizeAgenticUsage(usage, {
      providerUsageVerified,
      rateCardVerified: trustedRateCard,
      rateCard,
    });
    if (!trustedRateCard) reasons.push("rate_card_unverified");
  } else if (budgetPolicy.usage_required === true) {
    reasons.push("usage_missing");
  }
  const tokenLimit = requireNonNegativeInteger(budgetPolicy.token_limit || 0, "budget_token_limit", 1_000_000_000);
  const invocationLimit = requireNonNegativeInteger(budgetPolicy.invocation_limit || 0, "budget_invocation_limit", 100_000);
  const retryLimit = requireNonNegativeInteger(budgetPolicy.retry_limit || 0, "budget_retry_limit", 100);
  const observedInvocations = requireNonNegativeInteger(budgetPolicy.observed_invocations || 0, "budget_observed_invocations", 100_000);
  const observedRetries = requireNonNegativeInteger(budgetPolicy.observed_retries || 0, "budget_observed_retries", 1_000);
  const budgetReasons = [];
  if (normalizedUsage && budgetExceeded(tokenLimit, normalizedUsage.total_tokens)) budgetReasons.push("token_budget_exhausted");
  if (budgetExceeded(invocationLimit, observedInvocations)) budgetReasons.push("invocation_budget_exhausted");
  if (budgetExceeded(retryLimit, observedRetries)) budgetReasons.push("retry_budget_exhausted");
  reasons.push(...budgetReasons);

  const critical = budgetPolicy.critical_task === true
    || candidate.plan?.risk === "critical"
    || (governanceReceiptValid && trustedVerifications.criticalTask === true);
  const budgetExhausted = budgetReasons.length > 0;
  const criticalEscalation = critical && budgetExhausted;
  const hardStopRequested = budgetPolicy.hard_budget_stop === true;
  if (critical && hardStopRequested) reasons.push("critical_task_hard_stop_forbidden");
  const allowed = reasons.length === 0;
  return freeze({
    schema_version: "agentic_budget_governance_verdict_v1",
    tenant_id: tenantId,
    mode: ["off", "observe", "soft_enforce"].includes(mode) ? mode : AGENTIC_BUDGET_DEFAULT_MODE,
    branch_id: "agentic_budget_governance_guard",
    optimization_allowed: allowed,
    execution_authorized: false,
    external_execution: false,
    final_outcome_allowed: allowed && !criticalEscalation,
    action: criticalEscalation
      ? "escalation_or_safe_degraded_mode_required"
      : allowed
        ? "advisory_plan_accepted"
        : "block_or_defer_optimization",
    reasons: [...new Set(reasons)],
    quality: { baseline, predicted, floor: qualityFloor, maximum_loss: 0.02 },
    safety: {
      security_checks_preserved: securityVerified,
      tenant_isolation_preserved: tenantIsolationVerified,
      exposure_policy_preserved: exposurePolicyVerified,
      critical_reviewer_preserved: budgetPolicy.remove_critical_reviewer !== true,
    },
    budget: {
      token_limit: tokenLimit,
      invocation_limit: invocationLimit,
      retry_limit: retryLimit,
      exhausted: budgetExhausted,
      hard_stop_applied: false,
    },
    usage: normalizedUsage,
    audit: {
      override_requested: budgetPolicy.override === true,
      override_verified: budgetPolicy.override === true ? auditReceiptVerified : null,
      estimated_presented_as_actual: false,
    },
  });
}

function validateArtifactCandidate(candidate, now) {
  const value = requireObject(candidate, "artifact_candidate");
  const expires = requireIsoTimestamp(value.expires_at, "artifact_expires_at");
  const digest = requireText(value.artifact_hash, "artifact_hash", 80);
  const provenance = requireText(value.provenance_digest, "artifact_provenance_digest", 80);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("artifact_hash_invalid");
  if (!/^sha256:[a-f0-9]{64}$/.test(provenance)) throw new Error("artifact_provenance_invalid");
  return {
    tenant_id: requireText(value.tenant_id, "artifact_tenant_id", 120),
    artifact_hash: digest,
    provenance_digest: provenance,
    artifact_version: requireText(value.artifact_version, "artifact_version", 160),
    verified: value.verified === true,
    expires_at: expires.value,
    stale: expires.millis <= (now instanceof Date ? now.getTime() : new Date(now).getTime()),
    security_checks_verified: value.security_checks_verified === true,
  };
}

export function checkAgenticArtifactReuse({
  trustedTenantId,
  requestedHash,
  requestedVersion,
  candidate,
  now = new Date(),
} = {}) {
  const tenantId = requireText(trustedTenantId, "tenant_id", 120);
  const hash = requireText(requestedHash, "requested_artifact_hash", 80);
  const version = requireText(requestedVersion, "requested_artifact_version", 160);
  const artifact = validateArtifactCandidate(candidate, now);
  const reasons = [];
  if (artifact.tenant_id !== tenantId) reasons.push("artifact_cross_tenant");
  if (artifact.artifact_hash !== hash) reasons.push("artifact_hash_mismatch");
  if (artifact.artifact_version !== version) reasons.push("artifact_version_mismatch");
  if (!artifact.verified) reasons.push("artifact_unverified");
  if (artifact.stale) reasons.push("artifact_stale");
  if (!artifact.security_checks_verified) reasons.push("artifact_security_unverified");
  return freeze({
    reusable: reasons.length === 0,
    reasons,
    tenant_id: tenantId,
    artifact_hash: hash,
    artifact_version: version,
    content_returned: false,
    execution_authorized: false,
  });
}

export function compareAgenticSavings({
  trustedContext,
  baseline,
  optimized,
  rateCard,
  baselineProviderUsageVerified = false,
  optimizedProviderUsageVerified = false,
  rateCardVerified = false,
  baselineQuality,
  optimizedQuality,
  securityPreserved,
  qualitySafetyAttestationVerified = false,
  qualitySafetyAttestationDigest = null,
  attestedBaselineQuality = null,
  attestedOptimizedQuality = null,
  attestedSecurityPreserved = false,
} = {}) {
  const context = requireObject(trustedContext, "trusted_context");
  const tenantId = requireText(context.tenantId, "trusted_context_tenant_id", 120);
  const normalizedBaseline = normalizeAgenticUsage(baseline, {
    providerUsageVerified: baselineProviderUsageVerified,
    rateCardVerified,
    rateCard,
  });
  const normalizedOptimized = normalizeAgenticUsage(optimized, {
    providerUsageVerified: optimizedProviderUsageVerified,
    rateCardVerified,
    rateCard,
  });
  const qualitySafetyReceiptValid = /^sha256:[a-f0-9]{64}$/.test(String(qualitySafetyAttestationDigest || ""));
  const qualitySafetyTrusted = qualitySafetyAttestationVerified === true
    && qualitySafetyReceiptValid
    && Number.isFinite(Number(attestedBaselineQuality))
    && Number.isFinite(Number(attestedOptimizedQuality));
  const qualityBefore = requireFiniteNumber(
    qualitySafetyTrusted ? attestedBaselineQuality : baselineQuality,
    "baseline_quality",
    { min: 0, max: 1 },
  );
  const qualityAfter = requireFiniteNumber(
    qualitySafetyTrusted ? attestedOptimizedQuality : optimizedQuality,
    "optimized_quality",
    { min: 0, max: 1 },
  );
  const qualityLoss = Math.max(0, qualityBefore - qualityAfter);
  const consumptionBefore = normalizedBaseline.total_tokens;
  const consumptionAfter = normalizedOptimized.total_tokens;
  const savingsRatio = consumptionBefore > 0
    ? (consumptionBefore - consumptionAfter) / consumptionBefore
    : 0;
  const bothActual = normalizedBaseline.usage_kind === "actual"
    && normalizedOptimized.usage_kind === "actual";
  const claimAllowed = bothActual
    && qualityLoss <= 0.02
    && attestedSecurityPreserved === true
    && qualitySafetyTrusted
    && rateCardVerified === true;
  return freeze({
    schema_version: "agentic_savings_comparison_v1",
    tenant_id: tenantId,
    usage_kind: bothActual ? "actual" : "estimated",
    reconciled: bothActual,
    baseline: normalizedBaseline,
    optimized: normalizedOptimized,
    token_savings_ratio: Number(savingsRatio.toFixed(4)),
    amount_savings: roundedMoney(normalizedBaseline.amount - normalizedOptimized.amount),
    quality: {
      baseline: qualityBefore,
      optimized: qualityAfter,
      loss: Number(qualityLoss.toFixed(4)),
      within_floor: qualityLoss <= 0.02,
    },
    security_preserved: qualitySafetyTrusted ? attestedSecurityPreserved === true : securityPreserved === true,
    quality_safety_attestation_verified: qualitySafetyTrusted,
    rate_card_verified: rateCardVerified === true,
    actual_savings_claim_allowed: claimAllowed,
    label: claimAllowed ? "verified_actual_savings" : "estimated_or_unreconciled_comparison",
    execution_authorized: false,
  });
}

const CAPABILITY_COMMON = {
  schema_version: "agentic_efficiency_dynamic_capability_v1",
  branch_id: "agentic_efficiency_intelligence",
  exposure_class: "chatgpt_horizontal",
  allowed_client_types: ["chatgpt", "codex", "api_agent", "admin"],
  allowed_audiences: ["chatgpt_connector", "codex_internal", "api_agent", "admin_control_room"],
  required_entitlements: [],
  discoverable_in_connector: true,
  semantic_select_allowed: true,
  mutation: false,
  read_only: true,
  execution_authorized: false,
  arbitrary_route_invocation: false,
};

function capability(id, method, path, scopes, requestSchema, responseSchema) {
  return freeze({
    ...CAPABILITY_COMMON,
    capability_id: id,
    method,
    route: path,
    required_scopes: scopes,
    request_schema: requestSchema,
    response_schema: responseSchema,
    idempotency_required: false,
    optimistic_concurrency_required: false,
  });
}

export const AGENTIC_EFFICIENCY_CAPABILITY_MANIFEST = freeze([
  capability("agentic_efficiency_plan", "POST", "/v1/agentic-efficiency/plan", ["core:read"], "agentic_task_v1", AGENTIC_EFFICIENCY_SCHEMA_VERSION),
  capability("agentic_efficiency_status", "GET", "/v1/agentic-efficiency/status", ["core:read"], "empty_query_v1", "agentic_efficiency_status_v1"),
  capability("agentic_efficiency_report", "GET", "/v1/agentic-efficiency/report", ["core:read"], "empty_query_v1", "agentic_efficiency_report_v1"),
  capability("agentic_budget_preview", "POST", "/v1/agentic-efficiency/budget/preview", ["core:govern"], "agentic_budget_preview_v1", "agentic_budget_governance_verdict_v1"),
  capability("agentic_budget_status", "GET", "/v1/agentic-efficiency/budget/status", ["core:read"], "empty_query_v1", "agentic_budget_status_v1"),
  capability("agentic_work_capsule_read", "GET", "/v1/agentic-efficiency/work-capsules/:capsule_id", ["core:read"], "agentic_work_capsule_read_v1", AGENTIC_WORK_CAPSULE_SCHEMA_VERSION),
  capability("agentic_savings_compare", "POST", "/v1/agentic-efficiency/savings/compare", ["core:read"], "agentic_savings_compare_v1", "agentic_savings_comparison_v1"),
  capability("agentic_artifact_reuse_check", "POST", "/v1/agentic-efficiency/artifacts/reuse-check", ["core:read"], "agentic_artifact_reuse_check_v1", "agentic_artifact_reuse_verdict_v1"),
]);

export function listAgenticEfficiencyCapabilities() {
  return AGENTIC_EFFICIENCY_CAPABILITY_MANIFEST;
}

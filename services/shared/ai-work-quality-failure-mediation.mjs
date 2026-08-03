import crypto from "node:crypto";

export const AI_WORK_QUALITY_SCHEMA_VERSION = "ai_work_quality_failure_mediation_v1";

export const FAILURE_CODES = Object.freeze([
  "UNSUPPORTED_CLAIM","HALLUCINATED_RESULT","INSUFFICIENT_CONTEXT","STALE_CONTEXT",
  "AMBIGUOUS_INTENT","WRONG_REPOSITORY","WRONG_BRANCH","WRONG_SURFACE","SCOPE_DRIFT",
  "INCOMPLETE_IMPLEMENTATION","FALSE_COMPLETION_CLAIM","BUILD_FAILED","TYPECHECK_FAILED",
  "TEST_FAILED","REGRESSION_DETECTED","TEST_EVIDENCE_MISSING","UNVERIFIED_EXTERNAL_RESULT",
  "TOOL_ROUTE_MISMATCH","INVALID_TOOL_ARGUMENTS","IGNORED_TOOL_FAILURE","DUPLICATE_WORK",
  "STALE_LEASE","CONCURRENT_WRITE_CONFLICT","HANDOFF_INCOMPLETE","MEMORY_PROVENANCE_MISSING",
  "MEMORY_POISONING_RISK","PROMPT_INJECTION_DETECTED","SECRET_EXPOSURE_RISK",
  "TENANT_SCOPE_VIOLATION","RETRY_LOOP_DETECTED","RESOURCE_BUDGET_EXCEEDED",
  "MODEL_UNCERTAINTY_TOO_HIGH",
]);

export const FAILURE_CLASS = Object.freeze({
  ABSOLUTE: "absolute",
  CONFIRMATION: "confirmation_required",
  CORRECTABLE: "correctable",
  TRANSIENT: "transient",
  MANUAL_REVIEW: "manual_review",
});

const ABSOLUTE = new Set([
  "PROMPT_INJECTION_DETECTED","SECRET_EXPOSURE_RISK","MEMORY_POISONING_RISK",
  "TENANT_SCOPE_VIOLATION","WRONG_REPOSITORY","WRONG_BRANCH","WRONG_SURFACE",
]);
const CONFIRMATION = new Set([
  "AMBIGUOUS_INTENT","UNVERIFIED_EXTERNAL_RESULT","RESOURCE_BUDGET_EXCEEDED",
]);
const TRANSIENT = new Set([
  "STALE_LEASE","CONCURRENT_WRITE_CONFLICT","DUPLICATE_WORK","RETRY_LOOP_DETECTED",
]);
const CORRECTABLE = new Set(FAILURE_CODES.filter((code) =>
  !ABSOLUTE.has(code) && !CONFIRMATION.has(code) && !TRANSIENT.has(code),
));

const SECRET_PATTERN = /(?:password|passwd|secret|api[_ -]?key|token|bearer|private[_ -]?key)\s*[:=]\s*[^\s,;]+/gi;
const SHA256 = /^[a-f0-9]{64}$/i;
const GIT_SHA = /^[a-f0-9]{40}$/i;

function text(value, max = 1_000) {
  return String(value ?? "").replace(/\u0000/g, "").slice(0, max).trim();
}
function digest(value) {
  const normalized = text(value, 128).toLowerCase();
  return SHA256.test(normalized) ? normalized : null;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}
function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function exactFailureCode(value) {
  const code = text(value, 80);
  return FAILURE_CODES.includes(code) ? code : null;
}
function normalizeScope(scope = {}) {
  return {
    tenant_id: text(scope.tenant_id, 120),
    repository: text(scope.repository, 300) || null,
    branch: text(scope.branch, 200) || null,
    surface: text(scope.surface, 160) || null,
    work_id: text(scope.work_id, 160) || null,
    session_id: text(scope.session_id, 160) || null,
  };
}

export function classifyFailure(code) {
  const normalized = exactFailureCode(code);
  if (!normalized) return {
    code: "UNSUPPORTED_CLAIM",
    block_class: FAILURE_CLASS.MANUAL_REVIEW,
    action: "manual_review",
    retry_allowed: false,
  };
  if (ABSOLUTE.has(normalized)) return {
    code: normalized, block_class: FAILURE_CLASS.ABSOLUTE, action: "block",
    retry_allowed: false,
  };
  if (CONFIRMATION.has(normalized)) return {
    code: normalized, block_class: FAILURE_CLASS.CONFIRMATION, action: "confirm",
    retry_allowed: false,
  };
  if (TRANSIENT.has(normalized)) return {
    code: normalized, block_class: FAILURE_CLASS.TRANSIENT, action: "retry_limited",
    retry_allowed: true,
  };
  return {
    code: normalized, block_class: FAILURE_CLASS.CORRECTABLE, action: "diagnose_and_correct",
    retry_allowed: true,
  };
}

export function sanitizeObservation(input = {}) {
  const scope = normalizeScope(input.scope);
  const rawSummary = text(input.summary || input.message, 2_000);
  const summary = rawSummary.replace(SECRET_PATTERN, "[REDACTED_SECRET]");
  const evidence = Array.isArray(input.evidence) ? input.evidence.slice(0, 32).map((item) => ({
    kind: text(item?.kind, 80),
    digest: digest(item?.digest),
    verified: item?.verified === true,
    source: text(item?.source, 240) || null,
  })) : [];
  return {
    schema_version: AI_WORK_QUALITY_SCHEMA_VERSION,
    observation_id: text(input.observation_id, 160) || `obs_${sha256({ scope, summary, now: input.now || null }).slice(0, 24)}`,
    tenant_id: scope.tenant_id,
    scope,
    code: exactFailureCode(input.code) || "UNSUPPORTED_CLAIM",
    summary,
    evidence,
    worker_id: text(input.worker_id, 160) || null,
    verifier_id: text(input.verifier_id, 160) || null,
    attempt: Number.isSafeInteger(input.attempt) && input.attempt > 0 ? input.attempt : 1,
    created_at: text(input.created_at, 64) || null,
  };
}

export function verifyWorkEvidence({
  worker_id,
  verifier_id,
  scope = {},
  expected = {},
  actual = {},
  evidence = {},
} = {}) {
  const requested = normalizeScope(scope);
  const mismatches = [];
  if (!requested.tenant_id || text(actual.tenant_id, 120) !== requested.tenant_id) {
    mismatches.push("TENANT_SCOPE_VIOLATION");
  }
  if (requested.repository && text(actual.repository, 300) !== requested.repository) {
    mismatches.push("WRONG_REPOSITORY");
  }
  if (requested.branch && text(actual.branch, 200) !== requested.branch) {
    mismatches.push("WRONG_BRANCH");
  }
  if (requested.surface && text(actual.surface, 160) !== requested.surface) {
    mismatches.push("WRONG_SURFACE");
  }
  if (worker_id && verifier_id && text(worker_id, 160) === text(verifier_id, 160)) {
    mismatches.push("UNSUPPORTED_CLAIM");
  }
  if (expected.completion === true && evidence.completion_receipt !== true) {
    mismatches.push("FALSE_COMPLETION_CLAIM");
  }
  if (expected.tests_required === true && evidence.tests_passed !== true) {
    mismatches.push("TEST_EVIDENCE_MISSING");
  }
  if (expected.build_required === true && evidence.build_passed !== true) {
    mismatches.push("BUILD_FAILED");
  }
  if (expected.typecheck_required === true && evidence.typecheck_passed !== true) {
    mismatches.push("TYPECHECK_FAILED");
  }
  if (actual.tool_failed === true && evidence.tool_failure_handled !== true) {
    mismatches.push("IGNORED_TOOL_FAILURE");
  }
  if (actual.scope_digest && evidence.scope_digest && actual.scope_digest !== evidence.scope_digest) {
    mismatches.push("SCOPE_DRIFT");
  }
  const unique = [...new Set(mismatches)];
  return {
    schema_version: AI_WORK_QUALITY_SCHEMA_VERSION,
    verified: unique.length === 0,
    codes: unique,
    receipt_digest: sha256({
      tenant_id: requested.tenant_id,
      scope: requested,
      expected: stable(expected),
      actual: stable(actual),
      evidence: stable(evidence),
    }),
  };
}

export function observeFailure(input = {}) {
  const observation = sanitizeObservation(input);
  const classification = classifyFailure(observation.code);
  const attemptLimit = Number.isSafeInteger(input.attempt_limit) && input.attempt_limit > 0
    ? Math.min(input.attempt_limit, 20) : 3;
  const retryExhausted = observation.attempt >= attemptLimit;
  const finalAction = classification.retry_allowed && retryExhausted
    ? "manual_review" : classification.action;
  return {
    ...observation,
    classification: { ...classification, retry_exhausted: retryExhausted },
    action: finalAction,
    quarantine: classification.block_class === FAILURE_CLASS.ABSOLUTE,
    core_verdict_required: true,
    nyra_may_propose: classification.block_class !== FAILURE_CLASS.ABSOLUTE,
    execution_allowed: false,
  };
}

export function buildFailureReceipt(observation, {
  gallery_work_id = null,
  decision_ledger_id = null,
  independent_verifier_required = true,
} = {}) {
  const sanitized = sanitizeObservation(observation);
  return {
    schema_version: AI_WORK_QUALITY_SCHEMA_VERSION,
    receipt_id: `failure_${sha256(sanitized).slice(0, 24)}`,
    observation: sanitized,
    gallery_work_id: text(gallery_work_id, 160) || null,
    decision_ledger_id: text(decision_ledger_id, 160) || null,
    independent_verifier_required: independent_verifier_required === true,
    immutable_digest: sha256(sanitized),
  };
}

export const QUALITY_SECURITY_CONTRACT = Object.freeze({
  schema_version: AI_WORK_QUALITY_SCHEMA_VERSION,
  classification: "exact_code_only",
  default_action: "manual_review",
  default_execution_allowed: false,
  independent_verifier_required: true,
  raw_secrets_allowed: false,
  raw_customer_data_allowed: false,
  core_is_final_authority: true,
  nyra_can_propose_allow: false,
});

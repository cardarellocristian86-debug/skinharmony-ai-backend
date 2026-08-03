import crypto from "node:crypto";
import { FAILURE_CODES } from "./ai-work-quality-failure-mediation.mjs";

export const CORE_BLOCK_REMEDIATION_SCHEMA_VERSION = "core_block_remediation_v1";

export const CORE_BLOCK_CLASS = Object.freeze({
  CORRECTABLE: "correctable",
  CONFIRMATION_REQUIRED: "confirmation_required",
  ABSOLUTE: "absolute",
  TRANSIENT: "transient",
  MANUAL_REVIEW: "manual_review",
});

export const CORE_BLOCK_REMEDIATION_STATUS = Object.freeze({
  OPEN: "open",
  DIAGNOSING: "diagnosing",
  PROPOSAL_READY: "proposal_ready",
  REVISION_REQUIRED: "revision_required",
  NYRA_REVIEWED: "nyra_reviewed",
  RESUBMITTED: "resubmitted",
  WAITING_OWNER: "waiting_owner",
  ALLOWED: "allowed",
  HARD_DENIED: "hard_denied",
  EXECUTED: "executed",
  VERIFIED: "verified",
  CLOSED: "closed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
});

export const CORE_BLOCK_PROPOSAL_TYPES = Object.freeze({
  SAME_ACTION_REMEDIATION: "same_action_remediation",
  SAFE_ALTERNATIVE: "safe_alternative",
  OWNER_CONFIRMATION_ROUTE: "owner_confirmation_route",
  TRANSIENT_RETRY: "transient_retry",
});

export const ABSOLUTE_CODES = new Set([
  "TENANT_SCOPE_VIOLATION",
  "CROSS_TENANT_ACCESS",
  "SECRET_EXPOSURE_RISK",
  "UNAUTHORIZED_IMPERSONATION",
  "INVALID_WORKLOAD_IDENTITY",
  "FORBIDDEN_CREDENTIAL_USE",
  "POLICY_HARD_DENY",
  "AUDIENCE_MISMATCH",
  "REPLAY_DETECTED",
  "PROMPT_INJECTION_DETECTED",
  "MEMORY_POISONING_RISK",
  "WRONG_REPOSITORY",
  "WRONG_BRANCH",
  "WRONG_SURFACE",
]);

export const CONFIRMATION_CODES = new Set([
  "MISSING_OWNER_CONFIRMATION",
  "OWNER_CONFIRMATION_EXPIRED",
  "OWNER_CONFIRMATION_SCOPE_MISMATCH",
  "HIGH_IMPACT_CONFIRMATION_REQUIRED",
  "DEPLOY_CONFIRMATION_REQUIRED",
  "PUBLISH_CONFIRMATION_REQUIRED",
  "MERGE_CONFIRMATION_REQUIRED",
]);

export const CORRECTABLE_CODES = new Set([
  "MISSING_EVIDENCE",
  "INSUFFICIENT_TEST_EVIDENCE",
  "ROLLBACK_NOT_READY",
  "REQUIRED_CHECKS_MISSING",
  "RELEASE_ATTESTATION_MISSING",
  "SCOPE_TOO_BROAD",
  "POLICY_SCOPE_MISMATCH",
  "STALE_DECISION",
  "DRIFT_REVALIDATION_REQUIRED",
  "CAPABILITY_ROUTE_UNVERIFIED",
  "UNSUPPORTED_OPERATION_TYPE",
  "INCOMPLETE_WORK_IDENTITY",
  "MISSING_DEPENDENCY",
  "QUALITY_GATE_FAILED",
  "HALLUCINATED_RESULT",
  "INSUFFICIENT_CONTEXT",
  "STALE_CONTEXT",
  "SCOPE_DRIFT",
  "INCOMPLETE_IMPLEMENTATION",
  "FALSE_COMPLETION_CLAIM",
  "BUILD_FAILED",
  "TYPECHECK_FAILED",
  "TEST_FAILED",
  "REGRESSION_DETECTED",
  "TEST_EVIDENCE_MISSING",
  "UNVERIFIED_EXTERNAL_RESULT",
  "TOOL_ROUTE_MISMATCH",
  "INVALID_TOOL_ARGUMENTS",
  "IGNORED_TOOL_FAILURE",
  "HANDOFF_INCOMPLETE",
  "MEMORY_PROVENANCE_MISSING",
  "MODEL_UNCERTAINTY_TOO_HIGH",
]);

export const TRANSIENT_CODES = new Set([
  "ACTIVE_LEASE_CONFLICT",
  "CONCURRENT_SURFACE_OVERLAP",
  "SERVICE_TEMPORARILY_UNAVAILABLE",
  "RATE_LIMITED",
  "TEMPORARY_PROVIDER_FAILURE",
  "RETRYABLE_STORE_CONFLICT",
  "WORKER_NOT_READY",
]);

const ALLOWED_STATUS_TRANSITIONS = new Map([
  [CORE_BLOCK_REMEDIATION_STATUS.OPEN, new Set([CORE_BLOCK_REMEDIATION_STATUS.DIAGNOSING, CORE_BLOCK_REMEDIATION_STATUS.WAITING_OWNER, CORE_BLOCK_REMEDIATION_STATUS.HARD_DENIED, CORE_BLOCK_REMEDIATION_STATUS.EXPIRED])],
  [CORE_BLOCK_REMEDIATION_STATUS.DIAGNOSING, new Set([CORE_BLOCK_REMEDIATION_STATUS.PROPOSAL_READY, CORE_BLOCK_REMEDIATION_STATUS.HARD_DENIED, CORE_BLOCK_REMEDIATION_STATUS.EXPIRED])],
  [CORE_BLOCK_REMEDIATION_STATUS.PROPOSAL_READY, new Set([CORE_BLOCK_REMEDIATION_STATUS.NYRA_REVIEWED, CORE_BLOCK_REMEDIATION_STATUS.REVISION_REQUIRED, CORE_BLOCK_REMEDIATION_STATUS.HARD_DENIED, CORE_BLOCK_REMEDIATION_STATUS.EXPIRED])],
  [CORE_BLOCK_REMEDIATION_STATUS.REVISION_REQUIRED, new Set([CORE_BLOCK_REMEDIATION_STATUS.DIAGNOSING, CORE_BLOCK_REMEDIATION_STATUS.PROPOSAL_READY, CORE_BLOCK_REMEDIATION_STATUS.EXPIRED])],
  [CORE_BLOCK_REMEDIATION_STATUS.NYRA_REVIEWED, new Set([CORE_BLOCK_REMEDIATION_STATUS.RESUBMITTED, CORE_BLOCK_REMEDIATION_STATUS.REVISION_REQUIRED, CORE_BLOCK_REMEDIATION_STATUS.HARD_DENIED, CORE_BLOCK_REMEDIATION_STATUS.EXPIRED])],
  [CORE_BLOCK_REMEDIATION_STATUS.RESUBMITTED, new Set([CORE_BLOCK_REMEDIATION_STATUS.ALLOWED, CORE_BLOCK_REMEDIATION_STATUS.WAITING_OWNER, CORE_BLOCK_REMEDIATION_STATUS.REVISION_REQUIRED, CORE_BLOCK_REMEDIATION_STATUS.HARD_DENIED, CORE_BLOCK_REMEDIATION_STATUS.EXPIRED])],
  [CORE_BLOCK_REMEDIATION_STATUS.WAITING_OWNER, new Set([CORE_BLOCK_REMEDIATION_STATUS.RESUBMITTED, CORE_BLOCK_REMEDIATION_STATUS.ALLOWED, CORE_BLOCK_REMEDIATION_STATUS.EXPIRED, CORE_BLOCK_REMEDIATION_STATUS.CANCELLED])],
  [CORE_BLOCK_REMEDIATION_STATUS.ALLOWED, new Set([CORE_BLOCK_REMEDIATION_STATUS.EXECUTED, CORE_BLOCK_REMEDIATION_STATUS.EXPIRED, CORE_BLOCK_REMEDIATION_STATUS.CANCELLED])],
  [CORE_BLOCK_REMEDIATION_STATUS.EXECUTED, new Set([CORE_BLOCK_REMEDIATION_STATUS.VERIFIED, CORE_BLOCK_REMEDIATION_STATUS.REVISION_REQUIRED, CORE_BLOCK_REMEDIATION_STATUS.HARD_DENIED])],
  [CORE_BLOCK_REMEDIATION_STATUS.VERIFIED, new Set([CORE_BLOCK_REMEDIATION_STATUS.CLOSED])],
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function cleanText(value, max = 4_000) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\b(?:password|passwd|secret|api[_ -]?key|token|bearer)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]")
    .slice(0, max)
    .trim();
}

function textList(value, max = 50, itemMax = 2_000) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, itemMax)).filter(Boolean))].slice(0, max);
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function ensureTenantId(tenantId) {
  const normalized = String(tenantId || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(normalized)) throw new Error("tenant_invalid");
  return normalized;
}

function ensureId(value, name, max = 120) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(normalized)) {
    throw new Error(`${name}_invalid`);
  }
  return normalized;
}

function ensureIsoDate(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${name}_invalid`);
  return parsed.toISOString();
}

function ensureDateAfter(nowMs, ttlSeconds) {
  const seconds = Math.min(Math.max(Number(ttlSeconds) || 0, 1), 86_400);
  return new Date(nowMs + seconds * 1_000).toISOString();
}

export function classifyCoreBlock(decision = {}) {
  const code = String(
    decision.block_code ||
    decision.reason_code ||
    decision.code ||
    "UNKNOWN_BLOCK",
  ).trim();

  if (ABSOLUTE_CODES.has(code)) {
    return {
      code,
      blockClass: CORE_BLOCK_CLASS.ABSOLUTE,
      correctionAllowed: false,
      sameActionRetryAllowed: false,
      alternativeProposalAllowed: true,
    };
  }
  if (CONFIRMATION_CODES.has(code)) {
    return {
      code,
      blockClass: CORE_BLOCK_CLASS.CONFIRMATION_REQUIRED,
      correctionAllowed: false,
      sameActionRetryAllowed: false,
      alternativeProposalAllowed: false,
    };
  }
  if (CORRECTABLE_CODES.has(code)) {
    return {
      code,
      blockClass: CORE_BLOCK_CLASS.CORRECTABLE,
      correctionAllowed: true,
      sameActionRetryAllowed: true,
      alternativeProposalAllowed: true,
    };
  }
  if (TRANSIENT_CODES.has(code)) {
    return {
      code,
      blockClass: CORE_BLOCK_CLASS.TRANSIENT,
      correctionAllowed: true,
      sameActionRetryAllowed: true,
      alternativeProposalAllowed: true,
    };
  }
  return {
    code,
    blockClass: CORE_BLOCK_CLASS.MANUAL_REVIEW,
    correctionAllowed: false,
    sameActionRetryAllowed: false,
    alternativeProposalAllowed: false,
  };
}

export function assertSameTenant(expected, actual) {
  const left = ensureTenantId(expected);
  const right = ensureTenantId(actual);
  if (left !== right) throw new Error("tenant_scope_violation");
  return left;
}

export function assertWorkIdentity(workContext = {}) {
  const workId = ensureId(workContext.work_id, "work_id");
  const projectId = workContext.project_id === null || workContext.project_id === undefined ? null : ensureId(workContext.project_id, "project_id");
  const branchId = workContext.branch_id === null || workContext.branch_id === undefined ? null : ensureId(workContext.branch_id, "branch_id");
  return {
    tenant_id: ensureTenantId(workContext.tenant_id),
    project_id: projectId,
    work_id: workId,
    branch_id: branchId,
    session_id: workContext.session_id === null || workContext.session_id === undefined ? null : ensureId(workContext.session_id, "session_id"),
    surface: workContext.surface ? cleanText(workContext.surface, 160) : null,
  };
}

export function normalizeAndDigestScope(decision = {}, workContext = {}) {
  const normalized = {
    target_system: cleanText(decision.target_system || workContext.target_system || "universal_core", 120),
    operation_type: cleanText(decision.operation_type || workContext.operation_type || "unknown", 120),
    operation_class: decision.operation_class === undefined || decision.operation_class === null
      ? (workContext.operation_class ? cleanText(workContext.operation_class, 120) : null)
      : cleanText(decision.operation_class, 120),
    resource_ids: textList(decision.resource_ids || workContext.resource_ids || [], 50, 120),
    repository: decision.repository === undefined || decision.repository === null
      ? (workContext.repository ? cleanText(workContext.repository, 240) : null)
      : cleanText(decision.repository, 240),
    ref: decision.ref === undefined || decision.ref === null
      ? (workContext.ref ? cleanText(workContext.ref, 120) : null)
      : cleanText(decision.ref, 120),
    environment: decision.environment === undefined || decision.environment === null
      ? (workContext.environment ? cleanText(workContext.environment, 120) : null)
      : cleanText(decision.environment, 120),
  };
  normalized.scope_digest = sha256(normalized);
  return normalized;
}

export function deriveContinuationScope({ classification, decision = {} } = {}) {
  if (classification.blockClass === CORE_BLOCK_CLASS.CONFIRMATION_REQUIRED) {
    return {
      mode: "analysis_only",
      allowed_capabilities: [
        "read_work_context",
        "inspect_repository_read_only",
        "inspect_current_diff",
        "prepare_local_patch",
        "prepare_test_plan",
        "collect_non_sensitive_evidence",
      ],
      blocked_capabilities: [
        "push",
        "merge",
        "deploy",
        "publish",
        "external_send",
        "credential_change",
        "environment_variable_change",
      ],
      external_actions_allowed: false,
    };
  }
  if (classification.blockClass === CORE_BLOCK_CLASS.ABSOLUTE) {
    return {
      mode: "none",
      allowed_capabilities: [],
      blocked_capabilities: ["same_action_retry", "push", "merge", "deploy", "publish", "credential_change", "cross_tenant_access"],
      external_actions_allowed: false,
    };
  }
  if (classification.blockClass === CORE_BLOCK_CLASS.TRANSIENT) {
    return {
      mode: "bounded_local_preparation",
      allowed_capabilities: [
        "read_work_context",
        "inspect_repository_read_only",
        "inspect_current_diff",
        "prepare_local_patch",
        "prepare_test_plan",
        "run_existing_local_tests_in_sandbox",
        "collect_non_sensitive_evidence",
        "prepare_rollback",
      ],
      blocked_capabilities: ["push", "merge", "deploy", "publish"],
      external_actions_allowed: false,
      transient_retry_limit: Math.max(1, Number(decision.transient_retry_limit || 2)),
    };
  }
  return {
    mode: "bounded_local_preparation",
    allowed_capabilities: [
      "read_work_context",
      "inspect_repository_read_only",
      "inspect_current_diff",
      "prepare_local_patch",
      "prepare_test_plan",
      "run_existing_local_tests_in_sandbox",
      "collect_non_sensitive_evidence",
      "prepare_rollback",
      "prepare_remediation_proposal",
    ],
    blocked_capabilities: [
      "push",
      "merge",
      "deploy",
      "publish",
      "external_send",
      "credential_change",
      "environment_variable_change",
      "cross_tenant_access",
      "destructive_action",
      "execute_proposal_before_new_verdict",
    ],
    external_actions_allowed: false,
  };
}

function defaultRecommendedNextAction(remediation) {
  if (remediation.original_decision.block_class === CORE_BLOCK_CLASS.CONFIRMATION_REQUIRED) {
    return "obtain_request_bound_owner_confirmation";
  }
  if (remediation.original_decision.block_class === CORE_BLOCK_CLASS.ABSOLUTE) {
    return "prepare_safe_alternative_with_new_scope";
  }
  if (remediation.original_decision.block_class === CORE_BLOCK_CLASS.TRANSIENT) {
    return "retry_after_lease_or_service_recovery";
  }
  return "prepare_remediation_proposal";
}

export function buildDeterministicBlockExplanation(remediation) {
  const block = remediation.original_decision;
  return {
    type: "core_block_explanation",
    status: "BLOCKED_BY_CORE",
    remediation_id: remediation.remediation_id,
    decision_id: block.decision_id,
    block_code: block.block_code,
    block_class: block.block_class,
    what_was_blocked: `Universal Core ha bloccato l'operazione ${remediation.bound_scope.operation_type}.`,
    why_it_was_blocked: block.reasons?.join("; ") || "Il decision contract non soddisfa le condizioni richieste.",
    what_may_continue: remediation.continuation_scope.allowed_capabilities || [],
    required_conditions: block.unmet_conditions || [],
    safe_options: block.allowed_alternatives || [],
    forbidden_bypass: [
      "Non cambiare tenant.",
      "Non cambiare silenziosamente operation_type o target.",
      "Non usare un altro connettore per aggirare Core.",
      "Non eseguire la proposta prima di un nuovo verdict.",
    ],
    recommended_next_action: defaultRecommendedNextAction(remediation),
    can_submit_remediation: block.block_class === CORE_BLOCK_CLASS.CORRECTABLE || block.block_class === CORE_BLOCK_CLASS.TRANSIENT,
    can_retry_same_action: Boolean(block.same_action_retry_allowed),
    owner_confirmation_required: Boolean(block.owner_confirmation_required),
    uncertainty: [],
  };
}

function buildDecisionDigest(decision = {}) {
  return sha256({
    decision_id: decision.decision_id || null,
    verdict: decision.verdict || decision.state || null,
    block_code: decision.block_code || null,
    block_class: decision.block_class || null,
    risk_band: decision.risk_band || null,
    reasons: textList(decision.reasons || [], 20, 1_000),
    unmet_conditions: textList(decision.unmet_conditions || [], 20, 1_000),
    evidence_requirements: textList(decision.evidence_requirements || [], 20, 1_000),
    allowed_alternatives: textList(decision.allowed_alternatives || [], 20, 1_000),
    policy_snapshot_digest: decision.policy_snapshot_digest || null,
  });
}

function blockClassFromDecision(classification) {
  if (classification.blockClass === CORE_BLOCK_CLASS.MANUAL_REVIEW) return CORE_BLOCK_CLASS.MANUAL_REVIEW;
  return classification.blockClass;
}

export function buildRemediationContract({
  decision = {},
  classification,
  boundScope,
  continuationScope,
  workContext,
  actor = {},
  now = () => new Date(),
  nyraExplanation = null,
}) {
  const nowDate = now instanceof Date ? now : new Date(typeof now === "function" ? now() : Date.now());
  const createdAt = Number.isFinite(nowDate.getTime()) ? nowDate.toISOString() : new Date().toISOString();
  const expiresAt = ensureDateAfter(Date.parse(createdAt), decision.ttl_seconds || 86_400);
  const tenantId = ensureTenantId(workContext.tenant_id);
  const originalDecision = {
    decision_id: ensureId(decision.decision_id || crypto.randomUUID(), "decision_id", 160),
    decision_digest: buildDecisionDigest(decision),
    verdict: String(decision.verdict || decision.state || "BLOCK").toUpperCase(),
    block_code: classification.code,
    block_class: blockClassFromDecision(classification),
    risk_band: String(decision.risk_band || "medium").toLowerCase(),
    reasons: textList(decision.reasons || decision.blocked_reasons || [], 20, 1_000),
    unmet_conditions: textList(decision.unmet_conditions || [], 20, 1_000),
    evidence_requirements: textList(decision.evidence_requirements || [], 20, 1_000),
    allowed_alternatives: textList(decision.allowed_alternatives || [], 20, 1_000),
    correction_allowed: classification.correctionAllowed,
    same_action_retry_allowed: classification.sameActionRetryAllowed,
    owner_confirmation_required: Boolean(decision.owner_confirmation_required || classification.blockClass === CORE_BLOCK_CLASS.CONFIRMATION_REQUIRED),
    policy_snapshot_digest: String(decision.policy_snapshot_digest || decision.policy_digest || crypto.createHash("sha256").update(`policy_snapshot\u0000${classification.code}`).digest("hex")),
    expires_at: ensureIsoDate(decision.expires_at || expiresAt, "original_decision_expires_at"),
  };
  const nyraMessage = nyraExplanation || buildDeterministicBlockExplanation({
    remediation_id: `cbr_${crypto.randomUUID()}`,
    tenant_id: tenantId,
    work_id: workContext.work_id,
    bound_scope: boundScope,
    continuation_scope: continuationScope,
    original_decision: originalDecision,
  });
  const remediation = {
    schema_version: CORE_BLOCK_REMEDIATION_SCHEMA_VERSION,
    remediation_id: `cbr_${crypto.randomUUID()}`,
    tenant_id: tenantId,
    project_id: workContext.project_id || null,
    work_id: workContext.work_id,
    branch_id: workContext.branch_id || null,
    session_id: workContext.session_id || null,
    original_decision: originalDecision,
    bound_scope: {
      ...boundScope,
      scope_digest: boundScope.scope_digest,
    },
    continuation_scope: continuationScope,
    nyra_explanation: {
      status: nyraMessage ? "ready" : "pending",
      plain_summary: nyraMessage?.what_was_blocked || null,
      what_was_blocked: nyraMessage?.what_was_blocked || null,
      why_it_was_blocked: nyraMessage?.why_it_was_blocked || null,
      what_may_continue: nyraMessage?.what_may_continue || continuationScope.allowed_capabilities || [],
      required_conditions: nyraMessage?.required_conditions || [],
      safe_options: nyraMessage?.safe_options || [],
      forbidden_bypass: nyraMessage?.forbidden_bypass || [],
      recommended_next_action: nyraMessage?.recommended_next_action || defaultRecommendedNextAction({ original_decision: originalDecision }),
      uncertainty: nyraMessage?.uncertainty || [],
      generated_at: createdAt,
      explanation_digest: nyraMessage ? sha256(nyraMessage) : null,
    },
    diagnosis: {
      status: "not_started",
      submitted_by: null,
      root_cause: null,
      evidence: [],
      unknowns: [],
      affected_components: [],
      submitted_at: null,
      diagnosis_digest: null,
    },
    attempts: [],
    nyra_review: {
      status: "pending",
      reviewed_attempt_id: null,
      scope_consistent: false,
      bypass_detected: false,
      evidence_sufficient: false,
      tests_sufficient: false,
      rollback_ready: false,
      unresolved_risks: [],
      requested_changes: [],
      review_summary: null,
      review_digest: null,
      reviewed_at: null,
    },
    resubmission: {
      status: "not_submitted",
      resubmission_id: null,
      attempt_id: null,
      new_decision_id: null,
      new_decision_digest: null,
      new_verdict: null,
      submitted_at: null,
    },
    outcome: {
      execution_id: null,
      execution_status: "not_started",
      verification_status: "pending",
      evidence: [],
      verified_at: null,
    },
    status: "open",
    attempt_count: 0,
    max_attempts: Math.max(1, Number(decision.max_attempts || 3)),
    version: 0,
    created_at: createdAt,
    updated_at: createdAt,
    expires_at: ensureIsoDate(expiresAt, "remediation_expires_at"),
    contract_digest: null,
  };
  remediation.contract_digest = sha256({
    schema_version: remediation.schema_version,
    remediation_id: remediation.remediation_id,
    tenant_id: remediation.tenant_id,
    project_id: remediation.project_id,
    work_id: remediation.work_id,
    branch_id: remediation.branch_id,
    session_id: remediation.session_id,
    original_decision: remediation.original_decision,
    bound_scope: remediation.bound_scope,
    continuation_scope: remediation.continuation_scope,
    nyra_explanation: remediation.nyra_explanation,
    diagnosis: remediation.diagnosis,
    attempts: remediation.attempts,
    nyra_review: remediation.nyra_review,
    resubmission: remediation.resubmission,
    outcome: remediation.outcome,
    status: remediation.status,
    attempt_count: remediation.attempt_count,
    max_attempts: remediation.max_attempts,
    version: remediation.version,
    created_at: remediation.created_at,
    updated_at: remediation.updated_at,
    expires_at: remediation.expires_at,
  });
  return remediation;
}

export async function openCoreBlockRemediation({
  decision,
  workContext,
  actor,
  store,
  ledger,
  now = () => new Date(),
  explainFn,
  maxAttempts = 3,
  transientRetryLimit = 2,
}) {
  if (!decision) throw new Error("decision_required");
  const verdict = String(decision.allowed === true || decision.verdict === "ALLOW" || decision.state === "allowed" ? "ALLOW" : decision.verdict || decision.state || "").toUpperCase();
  if (verdict === "ALLOW") return null;

  const context = assertWorkIdentity(workContext);
  assertSameTenant(context.tenant_id, decision.tenant_id || context.tenant_id);

  const existing = store && typeof store.findByOriginalDecision === "function"
    ? await store.findByOriginalDecision({
        tenant_id: context.tenant_id,
        decision_id: String(decision.decision_id || ""),
      })
    : null;
  if (existing) return existing;

  const classification = classifyCoreBlock(decision);
  const boundScope = normalizeAndDigestScope(decision, context);
  const continuationScope = deriveContinuationScope({
    decision: {
      ...decision,
      max_attempts: maxAttempts,
      transient_retry_limit: transientRetryLimit,
    },
    classification,
  });

  let nyraExplanation = null;
  try {
    nyraExplanation = typeof explainFn === "function"
      ? await explainFn({
          decision,
          workContext: context,
          classification,
          boundScope,
          continuationScope,
          actor,
          now,
        })
      : null;
  } catch (error) {
    nyraExplanation = null;
    if (ledger && typeof ledger.append === "function") {
      await ledger.append({
        tenant_id: context.tenant_id,
        work_id: context.work_id,
        event_type: "core_block_nyra_explanation_failed",
        decision_id: String(decision.decision_id || ""),
        block_code: classification.code,
        reason_summary: String(error?.message || "nyra_explanation_failed").slice(0, 500),
      });
    }
  }

  const remediation = buildRemediationContract({
    decision: {
      ...decision,
      block_code: decision.block_code || classification.code,
      block_class: classification.blockClass,
      same_action_retry_allowed: classification.sameActionRetryAllowed,
      correction_allowed: classification.correctionAllowed,
      owner_confirmation_required: Boolean(decision.owner_confirmation_required || classification.blockClass === CORE_BLOCK_CLASS.CONFIRMATION_REQUIRED),
      max_attempts: maxAttempts,
      transient_retry_limit: transientRetryLimit,
    },
    classification,
    boundScope,
    continuationScope,
    workContext: context,
    actor,
    now,
    nyraExplanation,
  });

  const created = store && typeof store.create === "function"
    ? await store.create(remediation)
    : remediation;

  if (ledger && typeof ledger.append === "function") {
    await ledger.append({
      tenant_id: created.tenant_id,
      work_id: created.work_id,
      event_type: "core_block_remediation_opened",
      remediation_id: created.remediation_id,
      decision_id: created.original_decision.decision_id,
      block_code: created.original_decision.block_code,
      block_class: created.original_decision.block_class,
      contract_digest: created.contract_digest,
    });
    await ledger.append({
      tenant_id: created.tenant_id,
      work_id: created.work_id,
      event_type: "core_block_explained_by_nyra",
      remediation_id: created.remediation_id,
      decision_id: created.original_decision.decision_id,
      block_code: created.original_decision.block_code,
      block_class: created.original_decision.block_class,
      contract_digest: created.contract_digest,
    });
  }

  return created;
}

export function deriveRecommendedNextAction(remediation) {
  return defaultRecommendedNextAction(remediation);
}

export function assertTransitionAllowed(current, next) {
  const allowed = ALLOWED_STATUS_TRANSITIONS.get(current);
  if (current === next) return true;
  if (!allowed || !allowed.has(next)) {
    throw new Error("remediation_transition_not_allowed");
  }
  return true;
}

export function assertNyraReviewAuthority(actor = {}) {
  const kind = String(actor.kind || actor.client_type || actor.role || "").toLowerCase();
  if (!["nyra", "nyra_core", "nyra_work_supervisor", "supervisor"].includes(kind)) {
    throw new Error("nyra_review_authority_required");
  }
}

export function proposeRemediationAttempt({
  remediation,
  actor = {},
  proposal = {},
  diagnosis = {},
  idempotencyKey,
  now = () => new Date(),
}) {
  if (!remediation) throw new Error("remediation_required");
  if (remediation.status === CORE_BLOCK_REMEDIATION_STATUS.EXPIRED) throw new Error("remediation_expired");
  if (remediation.attempt_count >= remediation.max_attempts) throw new Error("remediation_max_attempts_reached");
  const proposalType = String(proposal.proposal_type || "").trim();
  const summary = cleanText(proposal.summary, 2_000);
  const attemptNo = remediation.attempts.length + 1;
  const attemptId = `cba_${crypto.randomUUID()}`;
  const digestInput = {
    remediation_id: remediation.remediation_id,
    tenant_id: remediation.tenant_id,
    work_id: remediation.work_id,
    idempotency_key: String(idempotencyKey || ""),
    proposal_type: proposalType,
    summary,
    scope: proposal.scope || {},
    changes: proposal.changes || [],
    tests: proposal.tests || [],
    evidence: proposal.evidence || [],
    rollback: proposal.rollback || {},
    conditions_addressed: proposal.conditions_addressed || [],
    residual_risks: proposal.residual_risks || [],
    alternative_only: proposal.alternative_only === true,
  };
  const attempt = {
    attempt_id: attemptId,
    attempt_no: attemptNo,
    idempotency_key: String(idempotencyKey || ""),
    submitted_by: {
      kind: actor.kind || actor.client_type || "connected_ai",
      subject: actor.subject || actor.agent_id || actor.id || "unknown",
      tenant_id: remediation.tenant_id,
    },
    proposal_type: proposalType,
    summary,
    scope: proposal.scope || {},
    changes: Array.isArray(proposal.changes) ? proposal.changes.slice(0, 100) : [],
    tests: Array.isArray(proposal.tests) ? proposal.tests.slice(0, 100) : [],
    evidence: Array.isArray(proposal.evidence) ? proposal.evidence.slice(0, 100) : [],
    rollback: proposal.rollback || {},
    conditions_addressed: Array.isArray(proposal.conditions_addressed) ? proposal.conditions_addressed.slice(0, 100) : [],
    residual_risks: Array.isArray(proposal.residual_risks) ? proposal.residual_risks.slice(0, 100) : [],
    alternative_only: proposal.alternative_only === true,
    proposal_digest: sha256(digestInput),
    created_at: new Date(now instanceof Date ? now.getTime() : typeof now === "function" ? now() : Date.now()).toISOString(),
    diagnosis: {
      root_cause: cleanText(diagnosis.root_cause, 2_000),
      evidence: Array.isArray(diagnosis.evidence) ? diagnosis.evidence.slice(0, 100) : [],
      unknowns: Array.isArray(diagnosis.unknowns) ? diagnosis.unknowns.slice(0, 100) : [],
      affected_components: Array.isArray(diagnosis.affected_components) ? diagnosis.affected_components.slice(0, 100) : [],
    },
  };
  return attempt;
}

export function validateProposalForRemediation(remediation, attempt, { expectedVersion, idempotencyKey } = {}) {
  if (!remediation) throw new Error("remediation_required");
  if (remediation.expires_at && Date.parse(remediation.expires_at) <= Date.now()) throw new Error("remediation_expired");
  if (expectedVersion !== undefined && Number(expectedVersion) !== Number(remediation.version)) {
    throw new Error("remediation_version_conflict");
  }
  if (String(idempotencyKey || "") && attempt.idempotency_key && String(idempotencyKey) !== String(attempt.idempotency_key)) {
    throw new Error("remediation_idempotency_mismatch");
  }
  if (String(remediation.tenant_id) !== String(attempt.submitted_by?.tenant_id || "")) throw new Error("tenant_scope_violation");
  if (remediation.work_id !== attempt.scope?.work_id && attempt.scope?.work_id !== undefined) {
    throw new Error("scope_expansion_requires_new_decision_contract");
  }
  if (remediation.original_decision.block_class === CORE_BLOCK_CLASS.ABSOLUTE) {
    if (attempt.proposal_type !== CORE_BLOCK_PROPOSAL_TYPES.SAFE_ALTERNATIVE || attempt.alternative_only !== true) {
      throw new Error("absolute_block_requires_safe_alternative");
    }
  }
  if (remediation.original_decision.block_class === CORE_BLOCK_CLASS.CONFIRMATION_REQUIRED) {
    if (attempt.proposal_type !== CORE_BLOCK_PROPOSAL_TYPES.OWNER_CONFIRMATION_ROUTE) {
      throw new Error("confirmation_block_requires_owner_route");
    }
  }
  if (remediation.original_decision.block_class === CORE_BLOCK_CLASS.CORRECTABLE) {
    if (attempt.proposal_type === CORE_BLOCK_PROPOSAL_TYPES.SAME_ACTION_REMEDIATION && (!Array.isArray(attempt.tests) || attempt.tests.length === 0)) {
      throw new Error("proposal_tests_required");
    }
  }
  if (remediation.original_decision.block_class === CORE_BLOCK_CLASS.TRANSIENT) {
    const retryLimit = Math.max(1, Number(remediation.continuation_scope?.transient_retry_limit || 2));
    if (attempt.proposal_type === CORE_BLOCK_PROPOSAL_TYPES.TRANSIENT_RETRY && remediation.attempt_count >= retryLimit) {
      throw new Error("transient_retry_limit_reached");
    }
  }
  return true;
}

export function evaluateEvidenceRequirements({ requirements = [], evidence = [] } = {}) {
  if (!Array.isArray(requirements) || !requirements.length) return true;
  const evidenceText = JSON.stringify(evidence || []);
  return requirements.every((requirement) => evidenceText.includes(String(requirement)));
}

export function evaluateTests({ risk_band, tests = [] } = {}) {
  const required = ["medium", "high", "critical"].includes(String(risk_band || "low"));
  if (!required) return true;
  return Array.isArray(tests) && tests.length > 0;
}

export function evaluateRollback({ operation_type, rollback = {} } = {}) {
  const risky = /deploy|publish|merge|release/i.test(String(operation_type || ""));
  if (!risky) return true;
  return rollback.available === true && Array.isArray(rollback.steps) && rollback.steps.length > 0;
}

export function compareScopeDigest(expectedDigest, scope = {}) {
  return String(expectedDigest || "") === sha256(scope || {});
}

export function detectRemediationBypass({ remediation, attempt }) {
  const scope = attempt?.scope || {};
  if (scope.tenant_id && String(scope.tenant_id) !== String(remediation.tenant_id)) return true;
  if (scope.target_system && String(scope.target_system) !== String(remediation.bound_scope.target_system)) return true;
  if (scope.operation_type && String(scope.operation_type) !== String(remediation.bound_scope.operation_type)) return true;
  if (scope.operation_class && remediation.bound_scope.operation_class && String(scope.operation_class) !== String(remediation.bound_scope.operation_class)) return true;
  if (scope.repository && remediation.bound_scope.repository && String(scope.repository) !== String(remediation.bound_scope.repository)) return true;
  if (scope.environment && remediation.bound_scope.environment && String(scope.environment) !== String(remediation.bound_scope.environment)) return true;
  return false;
}

export function deriveUnresolvedRisks(remediation, attempt) {
  const risks = [];
  if (!attempt?.tests?.length) risks.push("tests_missing");
  if (detectRemediationBypass({ remediation, attempt })) risks.push("scope_mismatch");
  if (remediation.original_decision.block_class === CORE_BLOCK_CLASS.CONFIRMATION_REQUIRED) risks.push("owner_confirmation_pending");
  return risks;
}

export function buildReviewSummary(remediation, attempt, review) {
  return cleanText([
    `status=${review.status}`,
    `block_class=${remediation.original_decision.block_class}`,
    `proposal_type=${attempt.proposal_type}`,
    review.requested_changes.length ? `requested=${review.requested_changes.join(",")}` : "",
  ].filter(Boolean).join("; "), 1_000);
}

export function reviewRemediationProposal({
  remediation,
  attempt,
  actor,
  store,
  ledger,
  now = () => new Date(),
}) {
  assertNyraReviewAuthority(actor);
  assertSameTenant(remediation.tenant_id, actor.tenant_id);
  if (!attempt || remediation.attempts.at(-1)?.attempt_id !== attempt.attempt_id) {
    throw new Error("latest_attempt_required");
  }
  const scopeConsistent = compareScopeDigest(
    remediation.bound_scope.scope_digest,
    attempt.scope || {},
  );
  const bypassDetected = detectRemediationBypass({
    remediation,
    attempt,
  });
  const evidenceSufficient = evaluateEvidenceRequirements({
    requirements: remediation.original_decision.evidence_requirements,
    evidence: attempt.evidence,
  });
  const testsSufficient = evaluateTests({
    risk_band: remediation.original_decision.risk_band,
    tests: attempt.tests,
  });
  const rollbackReady = evaluateRollback({
    operation_type: remediation.bound_scope.operation_type,
    rollback: attempt.rollback,
  });

  let status = "approve_for_core";
  const requestedChanges = [];
  if (!scopeConsistent) {
    status = "reject";
    requestedChanges.push("scope_expansion_requires_new_decision_contract");
  }
  if (bypassDetected) {
    status = "reject";
    requestedChanges.push("remediation_bypass_detected");
  }
  if (!evidenceSufficient || !testsSufficient || !rollbackReady) {
    status = "request_revision";
  }

  const review = {
    status,
    reviewed_attempt_id: attempt.attempt_id,
    scope_consistent: scopeConsistent,
    bypass_detected: bypassDetected,
    evidence_sufficient: evidenceSufficient,
    tests_sufficient: testsSufficient,
    rollback_ready: rollbackReady,
    unresolved_risks: deriveUnresolvedRisks(remediation, attempt),
    requested_changes: requestedChanges,
    review_summary: null,
    review_digest: null,
    reviewed_at: new Date(now instanceof Date ? now.getTime() : typeof now === "function" ? now() : Date.now()).toISOString(),
  };
  review.review_summary = buildReviewSummary(remediation, attempt, review);
  review.review_digest = sha256(review);
  if (store && typeof store.attachNyraReview === "function") {
    return Promise.resolve(store.attachNyraReview({
      tenant_id: remediation.tenant_id,
      remediation_id: remediation.remediation_id,
      expected_version: remediation.version,
      review,
    })).then(async () => {
      if (ledger && typeof ledger.append === "function") {
        await ledger.append({
          tenant_id: remediation.tenant_id,
          work_id: remediation.work_id,
          event_type: "core_block_remediation_nyra_reviewed",
          remediation_id: remediation.remediation_id,
          attempt_id: attempt.attempt_id,
          review_status: review.status,
          review_digest: review.review_digest,
        });
      }
      return review;
    });
  }
  return Promise.resolve(review);
}

export function buildNyraExplanationPayload(remediation) {
  const explanation = buildDeterministicBlockExplanation(remediation);
  return {
    type: "core_block_explanation",
    status: "BLOCKED_BY_CORE",
    remediation_id: remediation.remediation_id,
    decision_id: remediation.original_decision.decision_id,
    block_code: remediation.original_decision.block_code,
    block_class: remediation.original_decision.block_class,
    what_was_blocked: explanation.what_was_blocked,
    why_it_was_blocked: explanation.why_it_was_blocked,
    what_may_continue: explanation.what_may_continue,
    required_conditions: explanation.required_conditions,
    safe_options: explanation.safe_options,
    forbidden_bypass: explanation.forbidden_bypass,
    recommended_next_action: explanation.recommended_next_action,
    can_submit_remediation: explanation.can_submit_remediation,
    can_retry_same_action: explanation.can_retry_same_action,
    owner_confirmation_required: explanation.owner_confirmation_required,
    uncertainty: explanation.uncertainty,
  };
}

export function isRemediationOpen(remediation) {
  return remediation && remediation.status === CORE_BLOCK_REMEDIATION_STATUS.OPEN;
}

export function normalizeRemediationList(value = []) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function buildResubmissionContext(remediation, attempt, review) {
  return {
    schema_version: CORE_BLOCK_REMEDIATION_SCHEMA_VERSION,
    remediation_id: remediation.remediation_id,
    original_decision_id: remediation.original_decision.decision_id,
    original_decision_digest: remediation.original_decision.decision_digest,
    attempt_id: attempt.attempt_id,
    proposal_digest: attempt.proposal_digest,
    nyra_review_digest: review.review_digest,
    bound_scope_digest: remediation.bound_scope.scope_digest,
  };
}

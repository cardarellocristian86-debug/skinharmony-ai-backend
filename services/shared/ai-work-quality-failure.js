import crypto from "node:crypto";

export const AI_WORK_QUALITY_SCHEMA_VERSION = "ai_work_quality_failure_v1";

export const AI_WORK_FAILURE_CLASS = Object.freeze({
  CLAIM_INTEGRITY: "claim_integrity",
  CONTEXT_INTEGRITY: "context_integrity",
  EXECUTION_QUALITY: "execution_quality",
  TOOL_INTEGRITY: "tool_integrity",
  COLLABORATION_INTEGRITY: "collaboration_integrity",
  MEMORY_INTEGRITY: "memory_integrity",
  SECURITY_BOUNDARY: "security_boundary",
  RESOURCE_CONTROL: "resource_control",
  UNCERTAINTY: "uncertainty",
});

export const AI_WORK_FAILURE_DISPOSITION = Object.freeze({
  CORRECTABLE: "correctable",
  CONFIRMATION_REQUIRED: "confirmation_required",
  ABSOLUTE: "absolute",
  TRANSIENT: "transient",
});

export const AI_WORK_ROLLOUT_TIER = Object.freeze({
  OBSERVE: "observe",
  DRAFT: "draft",
  SANDBOX_ACTIVE: "sandbox_active",
  SCOPED_ACTIVE: "scoped_active",
  PRIVILEGED: "privileged",
});

export const AI_WORK_ROLLOUT_ORDER = Object.freeze([
  AI_WORK_ROLLOUT_TIER.OBSERVE,
  AI_WORK_ROLLOUT_TIER.DRAFT,
  AI_WORK_ROLLOUT_TIER.SANDBOX_ACTIVE,
  AI_WORK_ROLLOUT_TIER.SCOPED_ACTIVE,
  AI_WORK_ROLLOUT_TIER.PRIVILEGED,
]);

const definitions = [
  ["UNSUPPORTED_CLAIM", AI_WORK_FAILURE_CLASS.CLAIM_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["HALLUCINATED_RESULT", AI_WORK_FAILURE_CLASS.CLAIM_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["FALSE_COMPLETION_CLAIM", AI_WORK_FAILURE_CLASS.CLAIM_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["UNVERIFIED_EXTERNAL_RESULT", AI_WORK_FAILURE_CLASS.CLAIM_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["INSUFFICIENT_CONTEXT", AI_WORK_FAILURE_CLASS.CONTEXT_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["STALE_CONTEXT", AI_WORK_FAILURE_CLASS.CONTEXT_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["AMBIGUOUS_INTENT", AI_WORK_FAILURE_CLASS.CONTEXT_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CONFIRMATION_REQUIRED],
  ["WRONG_REPOSITORY", AI_WORK_FAILURE_CLASS.CONTEXT_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["WRONG_BRANCH", AI_WORK_FAILURE_CLASS.CONTEXT_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["WRONG_SURFACE", AI_WORK_FAILURE_CLASS.CONTEXT_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["SCOPE_DRIFT", AI_WORK_FAILURE_CLASS.CONTEXT_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["INCOMPLETE_IMPLEMENTATION", AI_WORK_FAILURE_CLASS.EXECUTION_QUALITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["BUILD_FAILED", AI_WORK_FAILURE_CLASS.EXECUTION_QUALITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["TYPECHECK_FAILED", AI_WORK_FAILURE_CLASS.EXECUTION_QUALITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["TEST_FAILED", AI_WORK_FAILURE_CLASS.EXECUTION_QUALITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["REGRESSION_DETECTED", AI_WORK_FAILURE_CLASS.EXECUTION_QUALITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["TEST_EVIDENCE_MISSING", AI_WORK_FAILURE_CLASS.EXECUTION_QUALITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["TOOL_ROUTE_MISMATCH", AI_WORK_FAILURE_CLASS.TOOL_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["INVALID_TOOL_ARGUMENTS", AI_WORK_FAILURE_CLASS.TOOL_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["IGNORED_TOOL_FAILURE", AI_WORK_FAILURE_CLASS.TOOL_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["DUPLICATE_WORK", AI_WORK_FAILURE_CLASS.COLLABORATION_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.TRANSIENT],
  ["STALE_LEASE", AI_WORK_FAILURE_CLASS.COLLABORATION_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.TRANSIENT],
  ["CONCURRENT_WRITE_CONFLICT", AI_WORK_FAILURE_CLASS.COLLABORATION_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.TRANSIENT],
  ["HANDOFF_INCOMPLETE", AI_WORK_FAILURE_CLASS.COLLABORATION_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["MEMORY_PROVENANCE_MISSING", AI_WORK_FAILURE_CLASS.MEMORY_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.CORRECTABLE],
  ["MEMORY_POISONING_RISK", AI_WORK_FAILURE_CLASS.MEMORY_INTEGRITY, AI_WORK_FAILURE_DISPOSITION.ABSOLUTE],
  ["PROMPT_INJECTION_DETECTED", AI_WORK_FAILURE_CLASS.SECURITY_BOUNDARY, AI_WORK_FAILURE_DISPOSITION.ABSOLUTE],
  ["UNTRUSTED_TOOL_DETECTED", AI_WORK_FAILURE_CLASS.SECURITY_BOUNDARY, AI_WORK_FAILURE_DISPOSITION.ABSOLUTE],
  ["PRIVILEGE_ESCALATION_BLOCKED", AI_WORK_FAILURE_CLASS.SECURITY_BOUNDARY, AI_WORK_FAILURE_DISPOSITION.ABSOLUTE],
  ["NETWORK_EGRESS_DENIED", AI_WORK_FAILURE_CLASS.SECURITY_BOUNDARY, AI_WORK_FAILURE_DISPOSITION.ABSOLUTE],
  ["SECRET_EXPOSURE_RISK", AI_WORK_FAILURE_CLASS.SECURITY_BOUNDARY, AI_WORK_FAILURE_DISPOSITION.ABSOLUTE],
  ["TENANT_SCOPE_VIOLATION", AI_WORK_FAILURE_CLASS.SECURITY_BOUNDARY, AI_WORK_FAILURE_DISPOSITION.ABSOLUTE],
  ["RETRY_LOOP_DETECTED", AI_WORK_FAILURE_CLASS.RESOURCE_CONTROL, AI_WORK_FAILURE_DISPOSITION.ABSOLUTE],
  ["RESOURCE_BUDGET_EXCEEDED", AI_WORK_FAILURE_CLASS.RESOURCE_CONTROL, AI_WORK_FAILURE_DISPOSITION.ABSOLUTE],
  ["MODEL_UNCERTAINTY_TOO_HIGH", AI_WORK_FAILURE_CLASS.UNCERTAINTY, AI_WORK_FAILURE_DISPOSITION.CONFIRMATION_REQUIRED],
];

export const AI_WORK_FAILURE_DEFINITIONS = Object.freeze(Object.fromEntries(definitions.map(([code, failureClass, disposition]) => [
  code,
  Object.freeze({ code, failure_class: failureClass, disposition }),
])));

export const AI_WORK_FAILURE_CODES = Object.freeze(Object.keys(AI_WORK_FAILURE_DEFINITIONS));
export const AI_WORK_HARD_DENY_CODES = Object.freeze(AI_WORK_FAILURE_CODES.filter((code) => AI_WORK_FAILURE_DEFINITIONS[code].disposition === AI_WORK_FAILURE_DISPOSITION.ABSOLUTE));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function aiWorkQualityEvidenceBindingReference(input = {}) {
  return `awqb_${digest({
    tenant_id: String(input.tenant_id || ""),
    work_id: String(input.work_id || ""),
    attempt_id: input.attempt_id ? String(input.attempt_id) : null,
    observer_id: String(input.observer_id || ""),
    observer_session_id: String(input.observer_session_id || ""),
    expected_state_digest: String(input.expected_state_digest || ""),
    observed_state_digest: String(input.observed_state_digest || ""),
  })}`;
}

const SECRET_PATTERNS = [
  /\b(?:password|passwd|secret|api[_ -]?key|token|bearer|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/g,
  /\bgh[opsu]_[A-Za-z0-9]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

export function redactAiWorkQualityValue(value, depth = 0) {
  if (depth > 12) return "[REDACTED_DEPTH_LIMIT]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactAiWorkQualityValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key,
      /(?:secret|password|token|authorization|credential|raw_prompt|chat)/i.test(key)
        ? "[REDACTED_SECRET]"
        : redactAiWorkQualityValue(item, depth + 1),
    ]));
  }
  if (typeof value !== "string") return value;
  let clean = value.replace(/\u0000/g, "");
  for (const pattern of SECRET_PATTERNS) clean = clean.replace(pattern, "[REDACTED_SECRET]");
  return clean.slice(0, 4_000);
}

function requiredId(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(normalized)) throw new Error(`${name}_invalid`);
  return normalized;
}

function strings(value, max = 50) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(redactAiWorkQualityValue(item) || "").trim()).filter(Boolean))].slice(0, max);
}

export function getAiWorkFailureDefinition(code) {
  const exactCode = String(code || "").trim();
  return AI_WORK_FAILURE_DEFINITIONS[exactCode] || null;
}

export function assertAiWorkFailureCode(code) {
  const definition = getAiWorkFailureDefinition(code);
  if (!definition) throw new Error("ai_work_failure_code_unknown");
  return definition;
}

export function assertAiWorkRolloutTier(tier) {
  const normalized = String(tier || "").trim();
  if (!AI_WORK_ROLLOUT_ORDER.includes(normalized)) throw new Error("ai_work_rollout_tier_invalid");
  return normalized;
}

export function buildAiWorkQualityObservation(input = {}) {
  const definition = assertAiWorkFailureCode(input.code);
  const evidence = strings(input.evidence);
  const expectedBindingReference = aiWorkQualityEvidenceBindingReference(input);
  const evidenceReceipts = (Array.isArray(input.evidence_receipts) ? input.evidence_receipts : []).slice(0, 50)
    .map((receipt) => ({
      artifact_id: requiredId(receipt?.artifact_id, "evidence_artifact_id"),
      content_digest: requiredId(receipt?.content_digest, "evidence_content_digest"),
      source_reference: requiredId(receipt?.source_reference, "evidence_source_reference"),
      registry_reference: requiredId(receipt?.registry_reference, "evidence_registry_reference"),
    }));
  if (evidenceReceipts.some((receipt) => receipt.registry_reference !== expectedBindingReference)) {
    throw new Error("observation_evidence_binding_mismatch");
  }
  const observation = {
    schema_version: AI_WORK_QUALITY_SCHEMA_VERSION,
    observation_id: requiredId(input.observation_id, "observation_id"),
    tenant_id: requiredId(input.tenant_id, "tenant_id"),
    work_id: requiredId(input.work_id, "work_id"),
    attempt_id: input.attempt_id ? requiredId(input.attempt_id, "attempt_id") : null,
    observer_id: requiredId(input.observer_id, "observer_id"),
    observer_session_id: requiredId(input.observer_session_id, "observer_session_id"),
    observer_role: String(input.observer_role || "independent_verifier").trim(),
    code: definition.code,
    failure_class: definition.failure_class,
    disposition: definition.disposition,
    rollout_tier: assertAiWorkRolloutTier(input.rollout_tier || AI_WORK_ROLLOUT_TIER.OBSERVE),
    summary: String(redactAiWorkQualityValue(input.summary) || "").trim().slice(0, 2_000),
    evidence,
    evidence_receipts: evidenceReceipts,
    evidence_digests: evidenceReceipts.map((receipt) => receipt.content_digest),
    expected_state_digest: input.expected_state_digest ? requiredId(input.expected_state_digest, "expected_state_digest") : null,
    observed_state_digest: input.observed_state_digest ? requiredId(input.observed_state_digest, "observed_state_digest") : null,
    created_at: new Date(input.created_at || Date.now()).toISOString(),
  };
  if (!observation.summary) throw new Error("observation_summary_required");
  if (evidenceReceipts.length === 0) throw new Error("observation_verified_evidence_required");
  observation.observation_digest = digest(observation);
  return Object.freeze(observation);
}

export function verifyAiWorkQualityObservation(observation) {
  if (!observation || typeof observation !== "object") return false;
  const { observation_digest: claimed, ...unsigned } = observation;
  const definition = getAiWorkFailureDefinition(observation.code);
  return typeof claimed === "string"
    && claimed === digest(unsigned)
    && observation.schema_version === AI_WORK_QUALITY_SCHEMA_VERSION
    && observation.failure_class === definition?.failure_class
    && observation.disposition === definition?.disposition;
}

export function buildDeterministicQualityExplanationInputs(observation) {
  if (!verifyAiWorkQualityObservation(observation)) throw new Error("observation_digest_invalid");
  return Object.freeze({
    schema_version: AI_WORK_QUALITY_SCHEMA_VERSION,
    observation_id: observation.observation_id,
    observation_digest: observation.observation_digest,
    tenant_id: observation.tenant_id,
    work_id: observation.work_id,
    attempt_id: observation.attempt_id,
    code: observation.code,
    failure_class: observation.failure_class,
    disposition: observation.disposition,
    summary: observation.summary,
    evidence: [...observation.evidence],
    evidence_receipts: observation.evidence_receipts.map((receipt) => ({ ...receipt })),
    evidence_digests: [...observation.evidence_digests],
    required_core_outcome: observation.disposition === AI_WORK_FAILURE_DISPOSITION.ABSOLUTE ? "BLOCK" : "NEW_CORE_VERDICT_REQUIRED",
  });
}

export const AI_WORK_QUALITY_INVARIANTS = Object.freeze({
  core_is_only_allow_authority: true,
  nyra_may_issue_allow: false,
  worker_may_self_verify: false,
  observation_may_authorize_execution: false,
  same_attempt_must_be_resubmitted: true,
  exact_code_matching_required: true,
  independent_verification_required_for_closure: true,
  tenant_and_work_binding_required: true,
  privileged_actions_require_owner_confirmation: true,
});

export function assertAiWorkAuthorityInvariant({ actor_role, requested_outcome, independently_verified = false } = {}) {
  const outcome = String(requested_outcome || "").toUpperCase();
  const role = String(actor_role || "").toLowerCase();
  if (outcome === "ALLOW" && role !== "universal_core") throw new Error("core_allow_authority_required");
  if (["VERIFIED", "CLOSED"].includes(outcome) && !independently_verified) throw new Error("independent_verification_required");
  return true;
}

import crypto from "node:crypto";
import {
  buildAiLearningOutcomeRecordBinding,
  digestAiLearningEvidenceSnapshot,
  digestAiLearningReviewBindingPayload,
} from "./aiLearningEvidenceVerifier.js";
import {
  createResourceVisibilityBinding,
  learningRecordBranchIds,
  resourceVisibleToContext,
  validateResourceVisibilityBinding,
} from "./resourceVisibility.js";

const TENANT_PATTERN = /^[a-z0-9][a-z0-9_-]{1,119}$/i;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:@/-]*$/i;
const SENSITIVE_IDENTIFIER_PATTERN = /(?:\b(?:sk|gho|ghp|ghs|github_pat|akia)[-_a-z0-9]{12,}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i;
const MUTATING_FLAGS = Object.freeze([
  "auto_activate",
  "auto_execute",
  "auto_promote",
  "autonomous_execution",
  "execution_enabled",
  "external_execution",
  "live_model_mutation",
  "model_mutation_enabled",
  "training_enabled",
]);

const COLLECTIONS = Object.freeze({
  evaluation_scorecards: {
    idField: "scorecard_id",
    schemaVersion: "ai_evaluation_scorecard_v0_16",
    normalize: normalizeScorecard,
  },
  dataset_metadata: {
    idField: "dataset_id",
    schemaVersion: "ai_learning_dataset_metadata_v0_16",
    normalize: normalizeDataset,
  },
  causal_experiments: {
    idField: "experiment_id",
    schemaVersion: "ai_causal_experiment_v0_16",
    normalize: normalizeExperiment,
  },
  learning_candidates: {
    idField: "candidate_id",
    schemaVersion: "ai_learning_candidate_v0_16",
    normalize: normalizeCandidate,
  },
  performance_scorecards: {
    idField: "performance_scorecard_id",
    schemaVersion: "ai_performance_scorecard_v0_16",
    normalize: normalizePerformanceScorecard,
  },
  learning_outcomes: {
    idField: "outcome_id",
    schemaVersion: "ai_learning_outcome_v0_16",
    normalize: normalizeLearningOutcome,
  },
});

const COLLECTION_FILTER_FIELDS = Object.freeze({
  evaluation_scorecards: Object.freeze(["release_version"]),
  dataset_metadata: Object.freeze(["dataset_version"]),
  causal_experiments: Object.freeze(["status"]),
  learning_candidates: Object.freeze(["status"]),
  performance_scorecards: Object.freeze(["release_version"]),
  learning_outcomes: Object.freeze([]),
});

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field}_invalid`);
  return value;
}

function requireTenant(value) {
  const tenantId = String(value ?? "").trim();
  if (!TENANT_PATTERN.test(tenantId)) throw new Error("tenant_id_invalid");
  return tenantId;
}

function redact(value, field, max = 500) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized
    .replace(/\b(?:bearer\s+)?(?:sk|gho|ghp|ghs|github_pat|akia)[-_a-z0-9]{12,}\b/gi, "[REDACTED_SECRET]")
    .replace(/\b(bearer)\s+[a-z0-9._~+/=-]{12,}\b/gi, "$1 [REDACTED_SECRET]")
    .replace(/\b(password|passwd|secret|token|api[_ -]?key|authorization)\s*[:=]\s*[^\s,;&]+/gi, "$1=[REDACTED_SECRET]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/(?:\+?\d[\d .()-]{7,}\d)/g, "[REDACTED_PHONE]");
}

function requireIdentifier(value, field, max = 200) {
  const normalized = String(value ?? "").trim();
  if (
    !normalized
    || normalized.length > max
    || !IDENTIFIER_PATTERN.test(normalized)
    || SENSITIVE_IDENTIFIER_PATTERN.test(normalized)
  ) {
    throw new Error(`${field}_invalid`);
  }
  return normalized;
}

function optionalIdentifier(value, field, max = 200) {
  return value === null || value === undefined || value === "" ? null : requireIdentifier(value, field, max);
}

function ownerActorProvenance(value, { required = false } = {}) {
  const normalized = optionalIdentifier(value, "owner_actor_provenance", 40);
  if (normalized === null && !required) return null;
  if (!/^ap_[a-f0-9]{32}$/.test(String(normalized || ""))) {
    throw new Error("owner_actor_provenance_invalid");
  }
  return normalized;
}

function requireBoolean(value, field) {
  if (typeof value !== "boolean") throw new Error(`${field}_invalid`);
  return value;
}

function finiteNumber(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum || (integer && !Number.isInteger(number))) {
    throw new Error(`${field}_invalid`);
  }
  return number;
}

function enumValue(value, field, allowed) {
  const normalized = String(value ?? "").trim();
  if (!allowed.includes(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function textArray(value, field, { maxItems = 50, maxLength = 240 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field}_invalid`);
  return [...new Set(value.map((item) => redact(item, field, maxLength)))];
}

function referenceArray(value, field, { maxItems = 50 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field}_invalid`);
  return [...new Set(value.map((item) => requireIdentifier(item, field, 240)))];
}

function isoDate(value, field, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field}_invalid`);
  return date.toISOString();
}

function normalizeReviewBindingProof(receiptValue, payloadValue) {
  const receipt = requireObject(receiptValue, "review_binding_receipt");
  const payload = requireObject(payloadValue, "review_binding_payload");
  const allowedReceiptKeys = [
    "binding_digest",
    "candidate_id",
    "candidate_version",
    "decision",
    "evidence_snapshot_digest",
    "expires_at",
    "issued_at",
    "nonce",
    "resulting_revision",
    "schema_version",
    "signature",
    "source_revision",
    "tenant_id",
  ];
  const actualReceiptKeys = Object.keys(receipt).sort();
  if (
    actualReceiptKeys.length !== allowedReceiptKeys.length
    || actualReceiptKeys.some((key, index) => key !== allowedReceiptKeys[index])
    || receipt.schema_version !== "ai_learning_review_binding_receipt_v0_16"
    || payload.schema_version !== "ai_learning_candidate_review_binding_v0_16"
    || !/^airr_[a-f0-9]{64}$/.test(String(receipt.signature || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(receipt.binding_digest || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(
      receipt.evidence_snapshot_digest || "",
    ))
    || digestAiLearningReviewBindingPayload(payload) !== receipt.binding_digest
    || digestAiLearningEvidenceSnapshot(payload.evidence_snapshot)
      !== receipt.evidence_snapshot_digest
    || receipt.tenant_id !== payload.tenant_id
    || receipt.candidate_id !== payload.candidate_id
    || receipt.candidate_version !== payload.candidate_version
    || receipt.decision !== payload.decision
    || Number(receipt.source_revision) !== Number(payload.source_revision)
    || Number(receipt.resulting_revision) !== Number(payload.resulting_revision)
    || receipt.issued_at !== payload.review_window?.issued_at
    || receipt.expires_at !== payload.review_window?.expires_at
    || receipt.nonce !== payload.review_window?.nonce
  ) throw new Error("review_binding_proof_invalid");
  const sourceRevision = finiteNumber(
    receipt.source_revision,
    "review_source_revision",
    { minimum: 1, integer: true },
  );
  const resultingRevision = finiteNumber(
    receipt.resulting_revision,
    "review_resulting_revision",
    { minimum: 2, integer: true },
  );
  if (resultingRevision !== sourceRevision + 1) {
    throw new Error("review_binding_revision_invalid");
  }
  return {
    receipt: clone(receipt),
    payload: clone(payload),
    source_revision: sourceRevision,
    resulting_revision: resultingRevision,
    evidence_snapshot_digest: receipt.evidence_snapshot_digest,
  };
}

function normalizeCoreApprovalAttestation(value) {
  const source = requireObject(value, "core_approval_attestation");
  const artifacts = Array.isArray(source.artifact_bindings)
    ? source.artifact_bindings.map((artifact) => {
        const record = requireObject(artifact, "core_approval_artifact");
        return {
          artifact_id: requireIdentifier(record.artifact_id, "artifact_id", 200),
          content_digest: requireIdentifier(
            record.content_digest,
            "artifact_content_digest",
            240,
          ),
          source_reference: requireIdentifier(
            record.source_reference,
            "artifact_source_reference",
            500,
          ),
        };
      })
    : [];
  if (
    source.schema_version !== "ai_learning_core_approval_attestation_v0_16"
    || !artifacts.length
    || !/^aica_[a-f0-9]{64}$/.test(String(source.signature || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(source.binding_digest || ""))
    || !/^sha256:[a-f0-9]{64}$/.test(String(
      source.evidence_snapshot_digest || "",
    ))
    || !/^sha256:[a-f0-9]{64}$/.test(String(
      source.independent_review_receipt_digest || "",
    ))
    || !/^dttv_[a-f0-9]{64}$/.test(String(source.core_verdict_reference || ""))
    || !/^dttje_[a-f0-9]{24}$/.test(String(source.core_evidence_set_digest || ""))
    || source.decision !== "approved_for_shadow"
  ) throw new Error("core_approval_attestation_invalid");
  return {
    schema_version: source.schema_version,
    tenant_id: requireTenant(source.tenant_id),
    candidate_id: requireIdentifier(source.candidate_id, "candidate_id", 200),
    candidate_version: requireIdentifier(
      source.candidate_version,
      "candidate_version",
      200,
    ),
    candidate_type: requireIdentifier(source.candidate_type, "candidate_type", 80),
    decision: source.decision,
    source_revision: finiteNumber(
      source.source_revision,
      "core_approval_source_revision",
      { minimum: 1, integer: true },
    ),
    resulting_revision: finiteNumber(
      source.resulting_revision,
      "core_approval_resulting_revision",
      { minimum: 2, integer: true },
    ),
    binding_digest: source.binding_digest,
    evidence_snapshot_digest: source.evidence_snapshot_digest,
    independent_review_receipt_digest:
      source.independent_review_receipt_digest,
    review_tree_id: requireIdentifier(source.review_tree_id, "review_tree_id", 160),
    review_node_id: requireIdentifier(source.review_node_id, "review_node_id", 120),
    core_verdict_reference: source.core_verdict_reference,
    core_evidence_set_digest: source.core_evidence_set_digest,
    artifact_bindings: artifacts,
    owner_actor_provenance: ownerActorProvenance(
      source.owner_actor_provenance,
      { required: true },
    ),
    reviewed_at: isoDate(source.reviewed_at, "reviewed_at"),
    review_window_issued_at: isoDate(
      source.review_window_issued_at,
      "review_window_issued_at",
    ),
    review_window_expires_at: isoDate(
      source.review_window_expires_at,
      "review_window_expires_at",
    ),
    revalidation_due_at: isoDate(
      source.revalidation_due_at,
      "revalidation_due_at",
    ),
    signature: source.signature,
  };
}

function assertAdvisoryOnly(input) {
  for (const field of MUTATING_FLAGS) {
    if (input[field] === true) throw new Error("ai_learning_factory_autonomous_execution_forbidden");
  }
}

function normalizeMetrics(value) {
  const source = requireObject(value, "metrics");
  const allowed = [
    "branch_selection_accuracy",
    "final_output_quality",
    "handoff_accuracy",
    "human_annotation_agreement",
    "judge_calibration",
    "safety_compliance_score",
    "tool_selection_accuracy",
  ];
  const metrics = {};
  for (const key of allowed) {
    if (source[key] !== undefined) metrics[key] = finiteNumber(source[key], key, { maximum: 1 });
  }
  if (Object.keys(metrics).length === 0) throw new Error("metrics_invalid");
  return metrics;
}

function normalizeScorecard(input) {
  assertAdvisoryOnly(input);
  return {
    scorecard_id: requireIdentifier(input.scorecard_id, "scorecard_id"),
    release_version: requireIdentifier(input.release_version, "release_version"),
    dataset_version: requireIdentifier(input.dataset_version, "dataset_version"),
    benchmark_manifest_digest: requireIdentifier(input.benchmark_manifest_digest, "benchmark_manifest_digest", 240),
    metrics: normalizeMetrics(input.metrics),
    regression_count: finiteNumber(input.regression_count, "regression_count", { integer: true }),
    regressions: textArray(input.regressions || [], "regressions"),
    evidence_refs: referenceArray(input.evidence_refs || [], "evidence_refs"),
    confidence: finiteNumber(input.confidence, "confidence", { maximum: 1 }),
    limitations: textArray(input.limitations || [], "limitations"),
    proposal: redact(input.proposal, "proposal", 1_000),
    promotion_authorized: false,
    auto_promotion: false,
  };
}

function normalizeDataset(input) {
  assertAdvisoryOnly(input);
  const splitDigests = requireObject(input.split_digests, "split_digests");
  const trainDigest = requireIdentifier(splitDigests.train, "train_digest", 240);
  const evalDigest = requireIdentifier(splitDigests.eval, "eval_digest", 240);
  if (trainDigest === evalDigest) throw new Error("train_eval_leakage_detected");
  const poisoningStatus = enumValue(input.poisoning_status, "poisoning_status", ["clean", "quarantined", "rejected"]);
  if (input.poisoning_detected === true && poisoningStatus === "clean") throw new Error("poisoning_quarantine_required");
  return {
    dataset_id: requireIdentifier(input.dataset_id, "dataset_id"),
    dataset_version: requireIdentifier(input.dataset_version, "dataset_version"),
    case_count: finiteNumber(input.case_count, "case_count", { integer: true }),
    provenance_digest: requireIdentifier(input.provenance_digest, "provenance_digest", 240),
    label_provenance_digest: requireIdentifier(input.label_provenance_digest, "label_provenance_digest", 240),
    consent_eligible: requireBoolean(input.consent_eligible, "consent_eligible"),
    tenant_scope_validated: requireBoolean(input.tenant_scope_validated, "tenant_scope_validated"),
    redaction_status: enumValue(input.redaction_status, "redaction_status", ["passed", "failed"]),
    data_quality_status: enumValue(input.data_quality_status, "data_quality_status", ["passed", "attention", "failed"]),
    poisoning_status: poisoningStatus,
    train_eval_separation: true,
    split_digests: { train: trainDigest, eval: evalDigest },
    retention_expires_at: isoDate(input.retention_expires_at, "retention_expires_at"),
    evidence_refs: referenceArray(input.evidence_refs || [], "evidence_refs"),
    raw_content_persisted: false,
    training_authorized: false,
  };
}

function normalizeExperiment(input) {
  assertAdvisoryOnly(input);
  return {
    experiment_id: requireIdentifier(input.experiment_id, "experiment_id"),
    experiment_version: requireIdentifier(input.experiment_version, "experiment_version"),
    hypothesis: redact(input.hypothesis, "hypothesis", 1_000),
    status: enumValue(input.status, "status", ["proposed", "shadow", "canary", "ab", "stopped", "completed"]),
    assignment_integrity: enumValue(input.assignment_integrity, "assignment_integrity", ["passed", "failed", "not_started"]),
    guardrail_metrics: normalizeMetrics(input.guardrail_metrics),
    evidence_refs: referenceArray(input.evidence_refs || [], "evidence_refs"),
    rollback_reference: requireIdentifier(input.rollback_reference, "rollback_reference", 240),
    promotion_recommendation: enumValue(input.promotion_recommendation, "promotion_recommendation", ["none", "review", "rollback", "reject"]),
    causal_confidence: finiteNumber(input.causal_confidence, "causal_confidence", { maximum: 1 }),
    external_execution: false,
    auto_activation: false,
  };
}

function normalizeCandidate(input) {
  assertAdvisoryOnly(input);
  const normalizedOwnerActor = input.human_review
    ? ownerActorProvenance(input.human_review.owner_actor_provenance)
    : null;
  const normalizedReviewBinding = input.human_review
    && input.human_review.review_binding_receipt
    && input.human_review.review_binding_payload
    ? normalizeReviewBindingProof(
        input.human_review.review_binding_receipt,
        input.human_review.review_binding_payload,
      )
    : null;
  const normalizedCoreApproval = input.human_review?.core_approval_attestation
    ? normalizeCoreApprovalAttestation(
        input.human_review.core_approval_attestation,
      )
    : null;
  const humanReview = input.human_review && typeof input.human_review === "object" && !Array.isArray(input.human_review)
    ? {
        decision: enumValue(input.human_review.decision, "human_review_decision", ["approved_for_shadow", "deferred", "rejected"]),
        audit_reference: requireIdentifier(input.human_review.audit_reference, "audit_reference", 240),
        rollback_reference: requireIdentifier(input.human_review.rollback_reference, "rollback_reference", 240),
        reviewer_reference: requireIdentifier(input.human_review.reviewer_reference, "reviewer_reference", 240),
        reviewed_at: isoDate(input.human_review.reviewed_at, "reviewed_at"),
        review_expires_at: isoDate(input.human_review.review_expires_at, "review_expires_at"),
        independent_human_review_verified: (
          input.human_review.independent_human_review_verified === true
          && Boolean(input.human_review.independent_review_receipt_digest)
          && Boolean(input.human_review.independent_review_binding_digest)
          && Boolean(input.human_review.review_tree_id)
          && Boolean(input.human_review.review_node_id)
          && Boolean(normalizedOwnerActor)
          && Boolean(normalizedReviewBinding)
          && Boolean(normalizedCoreApproval)
        ),
        owner_actor_provenance: normalizedOwnerActor,
        review_binding_receipt: normalizedReviewBinding?.receipt || null,
        review_binding_payload: normalizedReviewBinding?.payload || null,
        review_source_revision: normalizedReviewBinding?.source_revision || null,
        review_resulting_revision: normalizedReviewBinding?.resulting_revision || null,
        review_evidence_snapshot_digest: normalizedReviewBinding
          ?.evidence_snapshot_digest || null,
        core_approval_attestation: normalizedCoreApproval,
        independent_review_receipt_digest: optionalIdentifier(
          input.human_review.independent_review_receipt_digest,
          "independent_review_receipt_digest",
          240,
        ),
        independent_review_binding_digest: optionalIdentifier(
          input.human_review.independent_review_binding_digest,
          "independent_review_binding_digest",
          240,
        ),
        review_tree_id: optionalIdentifier(
          input.human_review.review_tree_id,
          "review_tree_id",
          160,
        ),
        review_node_id: optionalIdentifier(
          input.human_review.review_node_id,
          "review_node_id",
          120,
        ),
        guard_attestations: {
          ai_learning_governance_guard: enumValue(
            input.human_review.guard_attestations?.ai_learning_governance_guard,
            "ai_learning_governance_guard",
            ["ALLOW", "NOT_REQUIRED"],
          ),
          ai_data_integrity_guard: enumValue(
            input.human_review.guard_attestations?.ai_data_integrity_guard,
            "ai_data_integrity_guard",
            ["ALLOW", "NOT_REQUIRED"],
          ),
        },
        review_note: redact(input.human_review.review_note, "review_note", 500),
      }
    : null;
  return {
    candidate_id: requireIdentifier(input.candidate_id, "candidate_id"),
    candidate_version: requireIdentifier(input.candidate_version, "candidate_version"),
    candidate_type: enumValue(input.candidate_type, "candidate_type", [
      "prompt",
      "router",
      "model",
      "reasoning_effort",
      "tool_surface",
      "distillation",
      "fine_tune",
      "dataset",
      "skill",
    ]),
    status: enumValue(input.status, "status", ["proposed", "under_review", "deferred", "rejected", "approved_for_shadow"]),
    dataset_id: optionalIdentifier(input.dataset_id, "dataset_id"),
    dataset_version: optionalIdentifier(input.dataset_version, "dataset_version"),
    scorecard_id: requireIdentifier(input.scorecard_id, "scorecard_id"),
    experiment_id: optionalIdentifier(input.experiment_id, "experiment_id"),
    evidence_digest: requireIdentifier(input.evidence_digest, "evidence_digest", 240),
    rollback_reference: requireIdentifier(input.rollback_reference, "rollback_reference", 240),
    proposal_summary: redact(input.proposal_summary, "proposal_summary", 1_000),
    risk_review_status: enumValue(input.risk_review_status, "risk_review_status", ["pending", "passed", "failed"]),
    cost_review_status: enumValue(input.cost_review_status, "cost_review_status", ["pending", "passed", "failed"]),
    human_review: humanReview,
    human_review_required: true,
    live_mutation_authorized: false,
    auto_promotion: false,
  };
}

function normalizeLatencyPercentiles(value, field) {
  const source = requireObject(value, field);
  const p50 = finiteNumber(source.p50, `${field}_p50`);
  const p95 = finiteNumber(source.p95, `${field}_p95`);
  const p99 = finiteNumber(source.p99, `${field}_p99`);
  if (p50 > p95 || p95 > p99) throw new Error(`${field}_percentiles_invalid`);
  return { p50, p95, p99 };
}

function normalizePerformanceScorecard(input) {
  assertAdvisoryOnly(input);
  return {
    performance_scorecard_id: requireIdentifier(input.performance_scorecard_id, "performance_scorecard_id"),
    release_version: requireIdentifier(input.release_version, "release_version"),
    sample_count: finiteNumber(input.sample_count, "sample_count", { integer: true }),
    latency_ms: normalizeLatencyPercentiles(input.latency_ms, "latency_ms"),
    ttft_ms: normalizeLatencyPercentiles(input.ttft_ms, "ttft_ms"),
    token_per_verified_outcome: finiteNumber(input.token_per_verified_outcome, "token_per_verified_outcome"),
    cost_per_verified_outcome: finiteNumber(input.cost_per_verified_outcome, "cost_per_verified_outcome"),
    retry_efficiency: finiteNumber(input.retry_efficiency, "retry_efficiency", { maximum: 1 }),
    fallback_efficiency: finiteNumber(input.fallback_efficiency, "fallback_efficiency", { maximum: 1 }),
    bottlenecks: textArray(input.bottlenecks || [], "bottlenecks"),
    recommendations: textArray(input.recommendations || [], "recommendations"),
    evidence_refs: referenceArray(input.evidence_refs || [], "evidence_refs"),
    bounded_recommendations_only: true,
    auto_scaling_authorized: false,
  };
}

function normalizeLearningOutcome(input) {
  assertAdvisoryOnly(input);
  const governance = requireObject(input.governance, "governance");
  const candidateId = optionalIdentifier(input.candidate_id, "candidate_id");
  const candidateVersion = optionalIdentifier(input.candidate_version, "candidate_version");
  const candidateRevision = input.candidate_revision === null || input.candidate_revision === undefined
    ? null
    : finiteNumber(input.candidate_revision, "candidate_revision", { integer: true });
  if (
    (candidateId === null && (candidateVersion !== null || candidateRevision !== null))
    || (
      candidateId !== null
      && (candidateVersion === null || candidateRevision === null || candidateRevision < 1)
    )
  ) throw new Error("learning_outcome_candidate_lineage_invalid");
  return {
    outcome_id: requireIdentifier(input.outcome_id, "outcome_id"),
    run_id: requireIdentifier(input.run_id, "run_id"),
    candidate_id: candidateId,
    candidate_version: candidateVersion,
    candidate_revision: candidateRevision,
    outcome_status: enumValue(input.outcome_status, "outcome_status", ["succeeded", "failed", "partial", "abstained"]),
    outcome_verified: requireBoolean(input.outcome_verified, "outcome_verified"),
    human_review_status: enumValue(input.human_review_status, "human_review_status", ["not_required", "pending", "approved", "rejected"]),
    evidence_digest: requireIdentifier(input.evidence_digest, "evidence_digest", 240),
    policy_snapshot: requireIdentifier(input.policy_snapshot, "policy_snapshot", 240),
    observed_at: isoDate(input.observed_at, "observed_at"),
    learning_value: finiteNumber(input.learning_value, "learning_value", { maximum: 1 }),
    governance: {
      core_verdict: enumValue(governance.core_verdict, "core_verdict", ["ALLOW"]),
      owner_confirmed: requireBoolean(governance.owner_confirmed, "owner_confirmed"),
      audit_reference: requireIdentifier(governance.audit_reference, "audit_reference", 240),
      rollback_reference: requireIdentifier(governance.rollback_reference, "rollback_reference", 240),
      outcome_attestation_verified: governance.outcome_attestation_verified === true,
      outcome_attestation_receipt: optionalIdentifier(
        governance.outcome_attestation_receipt,
        "outcome_attestation_receipt",
        240,
      ),
      outcome_attestation_failure_reason: optionalIdentifier(
        governance.outcome_attestation_failure_reason,
        "outcome_attestation_failure_reason",
        120,
      ),
      outcome_binding_digest: optionalIdentifier(
        governance.outcome_binding_digest,
        "outcome_binding_digest",
        240,
      ),
    },
    raw_content_persisted: false,
    training_triggered: false,
    external_action_triggered: false,
  };
}

function validateAdapter(adapter) {
  if (adapter === null || adapter === undefined) return null;
  const source = requireObject(adapter, "learning_factory_adapter");
  for (const method of ["load", "save", "list"]) {
    if (typeof source[method] !== "function") throw new Error(`learning_factory_adapter_${method}_required`);
  }
  return source;
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function candidateReviewIdempotencyIntent({
  candidate_id,
  decision,
  review_note,
  expected_revision,
  review_attestation = null,
  review_binding_receipt = null,
} = {}) {
  return {
    operation: "learning_candidate_review",
    candidate_id: requireIdentifier(candidate_id, "candidate_id"),
    decision: enumValue(
      decision,
      "decision",
      ["approved_for_shadow", "deferred", "rejected"],
    ),
    review_note: review_note
      ? redact(review_note, "review_note", 2_000)
      : null,
    expected_revision: finiteNumber(
      expected_revision,
      "expected_revision",
      { minimum: 0, integer: true },
    ),
    review_attestation: clone(review_attestation),
    review_binding_receipt: clone(review_binding_receipt),
  };
}

function learningOutcomeIdempotencyIntent({
  tenant_id,
  record,
  expected_revision,
  review_attestation = null,
} = {}) {
  const requested = requireObject(record, "learning_outcome");
  return {
    operation: "learning_outcome_record",
    outcome_id: requireIdentifier(requested.outcome_id, "outcome_id"),
    outcome_binding_digest: buildAiLearningOutcomeRecordBinding({
      tenant_id: requireTenant(tenant_id),
      outcome: requested,
    }),
    expected_revision: finiteNumber(
      expected_revision,
      "expected_revision",
      { minimum: 0, integer: true },
    ),
    review_attestation: clone(review_attestation),
  };
}

function collectionContract(collection) {
  const contract = COLLECTIONS[collection];
  if (!contract) throw new Error("learning_factory_collection_invalid");
  return contract;
}

function normalizedListFilters(collection, value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const allowed = new Set(COLLECTION_FILTER_FIELDS[collection] || []);
  const output = {};
  for (const [field, rawValue] of Object.entries(source)) {
    if (!allowed.has(field)) throw new Error("learning_factory_filter_invalid");
    output[field] = requireIdentifier(rawValue, field, 240);
  }
  return output;
}

function validateStoredRecord(record, { tenantId, collection, recordId }) {
  const contract = collectionContract(collection);
  if (
    !record
    || record.schema_version !== contract.schemaVersion
    || record.tenant_id !== tenantId
    || record[contract.idField] !== recordId
    || !Number.isInteger(record.revision)
    || record.revision < 1
  ) {
    throw new Error("learning_factory_adapter_scope_violation");
  }
  const normalized = contract.normalize(record);
  const resourceVisibility = record.resource_visibility
    && typeof record.resource_visibility === "object"
    && !Array.isArray(record.resource_visibility)
    ? clone(record.resource_visibility)
    : null;
  return {
    schema_version: contract.schemaVersion,
    tenant_id: tenantId,
    ...normalized,
    revision: record.revision,
    created_at: isoDate(record.created_at, "created_at"),
    updated_at: isoDate(record.updated_at, "updated_at"),
    advisory_only: true,
    autonomous_execution_allowed: false,
    ...(resourceVisibility ? { resource_visibility: resourceVisibility } : {}),
  };
}

function governanceProof(value, { humanReviewRequired = false, nowIso = null } = {}) {
  const proof = requireObject(value, "authorization");
  if (proof.core_verdict !== "ALLOW") throw new Error("core_governance_allow_required");
  if (proof.owner_confirmed !== true) throw new Error("owner_confirmation_required");
  if (!Array.isArray(proof.scopes) || !proof.scopes.includes("core:govern")) throw new Error("core_govern_scope_required");
  const normalized = {
    core_verdict: "ALLOW",
    owner_confirmed: true,
    audit_reference: requireIdentifier(proof.audit_reference, "audit_reference", 240),
    rollback_reference: requireIdentifier(proof.rollback_reference, "rollback_reference", 240),
  };
  if (!humanReviewRequired) return normalized;
  if (proof.independent_human_review_verified !== true) {
    throw new Error("independent_human_review_required");
  }
  const reviewedAt = isoDate(proof.reviewed_at, "reviewed_at");
  const reviewExpiresAt = isoDate(proof.review_expires_at, "review_expires_at");
  if (new Date(reviewExpiresAt).getTime() <= new Date(nowIso).getTime()) {
    throw new Error("human_review_expired");
  }
  const reviewOwnerActorIds = Array.isArray(proof.review_owner_actor_ids)
    ? [...new Set(proof.review_owner_actor_ids.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
  if (reviewOwnerActorIds.length !== 1) {
    throw new Error("owner_actor_provenance_required");
  }
  const reviewBinding = normalizeReviewBindingProof(
    proof.review_binding_receipt,
    proof.review_binding_payload,
  );
  return {
    ...normalized,
    reviewer_reference: requireIdentifier(proof.reviewer_reference, "reviewer_reference", 240),
    reviewed_at: reviewedAt,
    review_expires_at: reviewExpiresAt,
    independent_human_review_verified: true,
    independent_review_receipt_digest: requireIdentifier(
      proof.independent_review_receipt_digest,
      "independent_review_receipt_digest",
      240,
    ),
    independent_review_binding_digest: requireIdentifier(
      proof.independent_review_binding_digest,
      "independent_review_binding_digest",
      240,
    ),
    review_tree_id: requireIdentifier(proof.review_tree_id, "review_tree_id", 160),
    review_node_id: requireIdentifier(proof.review_node_id, "review_node_id", 120),
    owner_actor_provenance: ownerActorProvenance(reviewOwnerActorIds[0], {
      required: true,
    }),
    review_binding_receipt: reviewBinding.receipt,
    review_binding_payload: reviewBinding.payload,
    review_source_revision: reviewBinding.source_revision,
    review_resulting_revision: reviewBinding.resulting_revision,
    review_evidence_snapshot_digest: reviewBinding.evidence_snapshot_digest,
    core_approval_attestation: normalizeCoreApprovalAttestation(
      proof.core_approval_attestation,
    ),
  };
}

export function evaluateAiDataIntegrityGuard({ candidate, dataset, scorecard, now }) {
  if (!candidate?.dataset_id || !candidate?.dataset_version) throw new Error("learning_candidate_dataset_binding_missing");
  if (!dataset || dataset.dataset_id !== candidate.dataset_id || dataset.dataset_version !== candidate.dataset_version) {
    throw new Error("learning_candidate_dataset_not_found");
  }
  if (
    dataset.tenant_scope_validated !== true
    || dataset.consent_eligible !== true
    || dataset.redaction_status !== "passed"
    || dataset.data_quality_status !== "passed"
    || dataset.poisoning_status !== "clean"
    || dataset.train_eval_separation !== true
    || !Array.isArray(dataset.evidence_refs)
    || dataset.evidence_refs.length === 0
  ) {
    throw new Error("ai_data_integrity_guard_blocked");
  }
  if (new Date(dataset.retention_expires_at).getTime() <= new Date(now).getTime()) {
    throw new Error("learning_candidate_dataset_expired");
  }
  if (
    !scorecard
    || scorecard.scorecard_id !== candidate.scorecard_id
    || scorecard.dataset_version !== candidate.dataset_version
    || scorecard.regression_count !== 0
    || !Array.isArray(scorecard.evidence_refs)
    || scorecard.evidence_refs.length === 0
    || Number(scorecard.metrics?.branch_selection_accuracy) < 0.95
    || Number(scorecard.metrics?.tool_selection_accuracy) < 0.95
    || Number(scorecard.metrics?.safety_compliance_score) < 0.99
  ) {
    throw new Error("ai_data_integrity_guard_blocked");
  }
  return Object.freeze({
    guard_id: "ai_data_integrity_guard",
    verdict: "ALLOW",
    dataset_id: dataset.dataset_id,
    dataset_version: dataset.dataset_version,
    scorecard_id: scorecard.scorecard_id,
  });
}

export function evaluateAiLearningGovernanceGuard({
  candidate,
  experiment,
  authorization,
  now,
}) {
  if (
    candidate.risk_review_status !== "passed"
    || candidate.cost_review_status !== "passed"
    || !candidate.rollback_reference
    || !candidate.experiment_id
  ) {
    throw new Error("ai_learning_governance_guard_blocked");
  }
  if (
    !experiment
    || experiment.experiment_id !== candidate.experiment_id
    || !["proposed", "shadow"].includes(experiment.status)
    || experiment.assignment_integrity !== "passed"
    || !Array.isArray(experiment.evidence_refs)
    || experiment.evidence_refs.length === 0
    || !experiment.rollback_reference
    || experiment.external_execution !== false
    || experiment.auto_activation !== false
  ) {
    throw new Error("ai_learning_governance_guard_blocked");
  }
  const proof = governanceProof(authorization, {
    humanReviewRequired: true,
    nowIso: now,
  });
  return Object.freeze({
    guard_id: "ai_learning_governance_guard",
    verdict: "ALLOW",
    experiment_id: experiment.experiment_id,
    reviewer_reference: proof.reviewer_reference,
    review_expires_at: proof.review_expires_at,
    proof,
  });
}

/**
 * Versioned tenant-first registries for advisory AI learning artifacts.
 * The optional adapter contract is deliberately narrow and receives tenant_id
 * on every load/save/list operation.
 */
export function createAiLearningFactoryStore({
  adapter = null,
  now = () => new Date().toISOString(),
  verifyOutcomeEvidence = null,
} = {}) {
  const persistence = validateAdapter(adapter);
  if (
    verifyOutcomeEvidence !== null
    && typeof verifyOutcomeEvidence !== "function"
  ) {
    throw new Error("learning_outcome_evidence_verifier_required");
  }
  let outcomeEvidenceVerifier = verifyOutcomeEvidence
    || (async () => ({ verified: false, reason: "outcome_evidence_unverified" }));
  let outcomeEvidenceVerifierConfigurable = verifyOutcomeEvidence === null;
  const memory = new Map();
  const idempotency = new Map();
  const writeQueues = new Map();

  async function serializeWrite(key, operation) {
    const prior = writeQueues.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const queued = prior.catch(() => {}).then(() => gate);
    writeQueues.set(key, queued);
    await prior.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (writeQueues.get(key) === queued) writeQueues.delete(key);
    }
  }

  function tenantCollections(tenantId) {
    let tenantBucket = memory.get(tenantId);
    if (!tenantBucket) {
      tenantBucket = new Map();
      memory.set(tenantId, tenantBucket);
    }
    return tenantBucket;
  }

  function collectionRecords(tenantId, collection) {
    const tenantBucket = tenantCollections(tenantId);
    let records = tenantBucket.get(collection);
    if (!records) {
      records = new Map();
      tenantBucket.set(collection, records);
    }
    return records;
  }

  async function loadRecord({ tenantId, collection, recordId }) {
    const local = collectionRecords(tenantId, collection).get(recordId);
    if (local) return local;
    if (!persistence) return null;
    const persisted = await persistence.load({ tenant_id: tenantId, collection, record_id: recordId });
    if (!persisted) return null;
    const validated = validateStoredRecord(persisted, { tenantId, collection, recordId });
    collectionRecords(tenantId, collection).set(recordId, validated);
    return validated;
  }

  async function write({
    tenantId,
    collection,
    value,
    idempotencyKey,
    expectedRevision = null,
    idempotencyIntent = null,
    visibilityContext = null,
    visibilityBranchIds = null,
  }) {
    const contract = collectionContract(collection);
    const source = requireObject(value, collection);
    if (source.tenant_id !== undefined && source.tenant_id !== tenantId) throw new Error("cross_tenant_record_denied");
    const normalized = contract.normalize(source);
    const recordId = normalized[contract.idField];
    const operationKey = `${tenantId}:${collection}:${requireIdentifier(idempotencyKey, "idempotency_key", 240)}`;
    const requestedVisibilityBranches = visibilityBranchIds === null
      ? null
      : [...new Set(
          (Array.isArray(visibilityBranchIds) ? visibilityBranchIds : [])
            .map((branchId) => String(branchId || "").trim())
            .filter(Boolean),
        )].sort();
    const normalizedRequestDigest = requestDigest({
      intent: idempotencyIntent === null
        ? { record: normalized }
        : clone(requireObject(idempotencyIntent, "idempotency_intent")),
      visibility_branch_ids: requestedVisibilityBranches,
      visibility_origin: visibilityContext ? {
        tenant_id: visibilityContext.tenant_id || visibilityContext.tenantId || tenantId,
        client_type: visibilityContext.client_type || visibilityContext.clientType || "",
        audience: visibilityContext.audience || "",
        entitlements: Array.isArray(visibilityContext.entitlements)
          ? [...new Set(visibilityContext.entitlements)].sort()
          : [],
      } : null,
    });
    return serializeWrite(`${tenantId}:${collection}`, async () => {
      const priorOperation = idempotency.get(operationKey);
      if (priorOperation) {
        if (
          priorOperation.record[contract.idField] !== recordId ||
          priorOperation.request_digest !== normalizedRequestDigest
        ) {
          throw new Error("learning_factory_idempotency_conflict");
        }
        return clone(priorOperation.record);
      }
      const existing = await loadRecord({ tenantId, collection, recordId });
      const currentRevision = existing?.revision || 0;
      const durableIdempotency = typeof persistence?.saveIdempotent === "function";
      const writeRevision = expectedRevision === null ? currentRevision : expectedRevision;
      if (!durableIdempotency && writeRevision !== currentRevision) {
        throw new Error("learning_factory_revision_conflict");
      }
      const timestamp = isoDate(now(), "updated_at");
      let resourceVisibility = existing?.resource_visibility || null;
      if (resourceVisibility) {
        const validation = validateResourceVisibilityBinding(resourceVisibility, {
          tenant_id: tenantId,
        });
        if (!validation.ok) throw new Error("resource_visibility_migration_required");
      } else if (existing) {
        throw new Error("resource_visibility_migration_required");
      } else {
        resourceVisibility = createResourceVisibilityBinding({
          tenant_id: tenantId,
          branch_ids: requestedVisibilityBranches
            || learningRecordBranchIds(collection, normalized),
          origin_context: visibilityContext,
          created_at: timestamp,
        });
      }
      const record = {
        schema_version: contract.schemaVersion,
        tenant_id: tenantId,
        ...normalized,
        revision: writeRevision + 1,
        created_at: writeRevision === 0 ? timestamp : existing?.created_at || timestamp,
        updated_at: timestamp,
        advisory_only: true,
        autonomous_execution_allowed: false,
        resource_visibility: resourceVisibility,
      };
      if (persistence) {
        const saved = typeof persistence.saveIdempotent === "function"
          ? await persistence.saveIdempotent({
              tenant_id: tenantId,
              collection,
              record_id: recordId,
              expected_revision: writeRevision,
              record: clone(record),
              idempotency_key: idempotencyKey,
              request_digest: normalizedRequestDigest,
            })
          : await persistence.save({
              tenant_id: tenantId,
              collection,
              record_id: recordId,
              expected_revision: writeRevision,
              record: clone(record),
            });
        if (saved) {
          const validated = validateStoredRecord(saved, {
            tenantId,
            collection,
            recordId: saved[contract.idField],
          });
          collectionRecords(tenantId, collection).set(validated[contract.idField], validated);
          idempotency.set(operationKey, {
            request_digest: normalizedRequestDigest,
            record: validated,
          });
          return clone(validated);
        }
      }
      collectionRecords(tenantId, collection).set(recordId, record);
      idempotency.set(operationKey, { request_digest: normalizedRequestDigest, record });
      return clone(record);
    });
  }

  async function replayWrite({
    tenantId,
    collection,
    recordId,
    idempotencyKey,
    idempotencyIntent,
    visibilityContext = null,
    visibilityBranchIds = null,
  }) {
    const contract = collectionContract(collection);
    const validatedRecordId = requireIdentifier(
      recordId,
      contract.idField,
    );
    const validatedIdempotencyKey = requireIdentifier(
      idempotencyKey,
      "idempotency_key",
      240,
    );
    const operationKey =
      `${tenantId}:${collection}:${validatedIdempotencyKey}`;
    const requestedVisibilityBranches = visibilityBranchIds === null
      ? null
      : [...new Set(
          (Array.isArray(visibilityBranchIds) ? visibilityBranchIds : [])
            .map((branchId) => String(branchId || "").trim())
            .filter(Boolean),
        )].sort();
    const normalizedRequestDigest = requestDigest({
      intent: clone(requireObject(idempotencyIntent, "idempotency_intent")),
      visibility_branch_ids: requestedVisibilityBranches,
      visibility_origin: visibilityContext ? {
        tenant_id:
          visibilityContext.tenant_id
          || visibilityContext.tenantId
          || tenantId,
        client_type:
          visibilityContext.client_type
          || visibilityContext.clientType
          || "",
        audience: visibilityContext.audience || "",
        entitlements: Array.isArray(visibilityContext.entitlements)
          ? [...new Set(visibilityContext.entitlements)].sort()
          : [],
      } : null,
    });
    return serializeWrite(`${tenantId}:${collection}`, async () => {
      const priorOperation = idempotency.get(operationKey);
      if (priorOperation) {
        if (
          priorOperation.record[contract.idField] !== validatedRecordId
          || priorOperation.request_digest !== normalizedRequestDigest
        ) throw new Error("learning_factory_idempotency_conflict");
        return clone(priorOperation.record);
      }
      if (typeof persistence?.loadIdempotent !== "function") return null;
      const persisted = await persistence.loadIdempotent({
        tenant_id: tenantId,
        collection,
        record_id: validatedRecordId,
        idempotency_key: validatedIdempotencyKey,
        request_digest: normalizedRequestDigest,
      });
      if (!persisted) return null;
      const validated = validateStoredRecord(persisted, {
        tenantId,
        collection,
        recordId: validatedRecordId,
      });
      collectionRecords(tenantId, collection).set(
        validatedRecordId,
        validated,
      );
      idempotency.set(operationKey, {
        request_digest: normalizedRequestDigest,
        record: validated,
      });
      return clone(validated);
    });
  }

  async function read({ tenantId, collection, recordId, visibilityContext = null }) {
    collectionContract(collection);
    const record = await loadRecord({ tenantId, collection, recordId });
    if (
      visibilityContext
      && !resourceVisibleToContext(record, visibilityContext, { tenant_id: tenantId })
    ) return null;
    return clone(record);
  }

  async function list({
    tenantId,
    collection,
    limit = 100,
    offset = 0,
    filters = {},
    page = false,
    visibilityContext = null,
  }) {
    collectionContract(collection);
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const boundedOffset = Number(offset);
    if (
      !Number.isSafeInteger(boundedOffset)
      || boundedOffset < 0
      || boundedOffset > 1_000_000
    ) throw new Error("cursor_invalid");
    const normalizedFilters = normalizedListFilters(collection, filters);
    if (persistence) {
      if (visibilityContext && typeof persistence.listForVisibility !== "function") {
        throw new Error("resource_visibility_adapter_required");
      }
      const persisted = visibilityContext
        ? await persistence.listForVisibility({
            tenant_id: tenantId,
            collection,
            visibility_context: visibilityContext,
            limit: boundedLimit + (page ? 1 : 0),
            offset: boundedOffset,
            filters: normalizedFilters,
          })
        : await persistence.list({
            tenant_id: tenantId,
            collection,
            limit: boundedLimit + (page ? 1 : 0),
            offset: boundedOffset,
            filters: normalizedFilters,
          });
      if (!Array.isArray(persisted)) throw new Error("learning_factory_adapter_list_invalid");
      const scanned = persisted.slice(0, boundedLimit);
      const records = [];
      for (const row of persisted) {
        const contract = collectionContract(collection);
        const recordId = row?.[contract.idField];
        const validated = validateStoredRecord(row, { tenantId, collection, recordId });
        collectionRecords(tenantId, collection).set(recordId, validated);
        if (
          scanned.includes(row)
          && (!visibilityContext || resourceVisibleToContext(
            validated,
            visibilityContext,
            { tenant_id: tenantId },
          ))
        ) records.push(validated);
      }
      if (page) {
        return {
          records: clone(records),
          next_offset: persisted.length > boundedLimit
            ? boundedOffset + boundedLimit
            : null,
        };
      }
      return clone(records);
    }
    const ordered = [...collectionRecords(tenantId, collection).values()]
      .sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at)
        || String(a[collectionContract(collection).idField])
          .localeCompare(String(b[collectionContract(collection).idField])));
    const visible = visibilityContext
      ? ordered.filter((record) =>
          resourceVisibleToContext(record, visibilityContext, { tenant_id: tenantId }))
      : ordered;
    const filtered = visible.filter((record) =>
      Object.entries(normalizedFilters).every(([field, value]) =>
        record[field] === value));
    const records = filtered.slice(
      boundedOffset,
      boundedOffset + boundedLimit,
    );
    if (page) {
      return {
        records: clone(records),
        next_offset: boundedOffset + records.length < filtered.length
          ? boundedOffset + records.length
          : null,
      };
    }
    return clone(records);
  }

  function typedWrite(collection) {
    return ({
      tenant_id,
      record,
      idempotency_key,
      expected_revision = null,
      visibility_context = null,
      visibility_branch_ids = null,
    }) => write({
      tenantId: requireTenant(tenant_id),
      collection,
      value: record,
      idempotencyKey: idempotency_key,
      expectedRevision: expected_revision,
      visibilityContext: visibility_context,
      visibilityBranchIds: visibility_branch_ids,
    });
  }

  function typedRead(collection) {
    return ({ tenant_id, record_id, visibility_context = null }) => read({
      tenantId: requireTenant(tenant_id),
      collection,
      recordId: requireIdentifier(record_id, "record_id"),
      visibilityContext: visibility_context,
    });
  }

  function typedList(collection) {
    return ({
      tenant_id,
      limit = 100,
      offset = 0,
      filters = {},
      page = false,
      visibility_context = null,
    }) => list({
      tenantId: requireTenant(tenant_id),
      collection,
      limit,
      offset,
      filters,
      page,
      visibilityContext: visibility_context,
    });
  }

  const api = {
    schema_version: "ai_learning_factory_store_v0_16",
    persistence: persistence ? "optional_adapter_active" : "memory_only",
    tenant_scoped: true,
    idempotent: true,
    autonomous_execution_allowed: false,
    recordEvaluationScorecard: typedWrite("evaluation_scorecards"),
    readEvaluationScorecard: typedRead("evaluation_scorecards"),
    listEvaluationScorecards: typedList("evaluation_scorecards"),
    recordDatasetMetadata: typedWrite("dataset_metadata"),
    readDatasetMetadata: typedRead("dataset_metadata"),
    listDatasetMetadata: typedList("dataset_metadata"),
    recordCausalExperiment: typedWrite("causal_experiments"),
    readCausalExperiment: typedRead("causal_experiments"),
    listCausalExperiments: typedList("causal_experiments"),
    recordPerformanceScorecard: typedWrite("performance_scorecards"),
    readPerformanceScorecard: typedRead("performance_scorecards"),
    listPerformanceScorecards: typedList("performance_scorecards"),
    readLearningCandidate: typedRead("learning_candidates"),
    listLearningCandidates: typedList("learning_candidates"),
    readLearningOutcome: typedRead("learning_outcomes"),
    listLearningOutcomes: typedList("learning_outcomes"),
  };

  api.configureOutcomeEvidenceVerifier = (verifier) => {
    if (
      !outcomeEvidenceVerifierConfigurable
      || typeof verifier !== "function"
    ) throw new Error("learning_outcome_evidence_verifier_locked");
    outcomeEvidenceVerifier = verifier;
    outcomeEvidenceVerifierConfigurable = false;
    return true;
  };

  api.recordLearningCandidate = async (input) => {
    if (input?.record?.status === "approved_for_shadow") throw new Error("learning_candidate_review_required");
    return await typedWrite("learning_candidates")(input);
  };

  api.reviewLearningCandidate = async ({
    tenant_id,
    candidate_id,
    decision,
    review_note,
    authorization,
    idempotency_key,
    expected_revision,
    review_attestation = null,
    review_binding_receipt = null,
    visibility_context = null,
  }) => {
    const tenantId = requireTenant(tenant_id);
    const candidateId = requireIdentifier(candidate_id, "candidate_id");
    const existing = await loadRecord({ tenantId, collection: "learning_candidates", recordId: candidateId });
    if (!existing) throw new Error("learning_candidate_not_found");
    if (
      visibility_context
      && !resourceVisibleToContext(existing, visibility_context, { tenant_id: tenantId })
    ) throw new Error("branch_not_available_for_client");
    const nextStatus = enumValue(decision, "decision", ["approved_for_shadow", "deferred", "rejected"]);
    const timestamp = isoDate(now(), "reviewed_at");
    let proof = governanceProof(authorization);
    let guardAttestations = {
      ai_learning_governance_guard: "NOT_REQUIRED",
      ai_data_integrity_guard: "NOT_REQUIRED",
    };
    if (nextStatus === "approved_for_shadow") {
      if (
        existing.risk_review_status !== "passed"
        || existing.cost_review_status !== "passed"
        || !existing.dataset_id
        || !existing.dataset_version
        || !existing.scorecard_id
        || !existing.experiment_id
        || !existing.rollback_reference
      ) {
        throw new Error("learning_candidate_evidence_incomplete");
      }
      const [dataset, scorecard, experiment] = await Promise.all([
        existing.dataset_id
          ? loadRecord({
              tenantId,
              collection: "dataset_metadata",
              recordId: existing.dataset_id,
            })
          : null,
        loadRecord({
          tenantId,
          collection: "evaluation_scorecards",
          recordId: existing.scorecard_id,
        }),
        existing.experiment_id
          ? loadRecord({
              tenantId,
              collection: "causal_experiments",
              recordId: existing.experiment_id,
            })
          : null,
      ]);
      try {
        const integrity = evaluateAiDataIntegrityGuard({
          candidate: existing,
          dataset,
          scorecard,
          now: timestamp,
        });
        const governance = evaluateAiLearningGovernanceGuard({
          candidate: existing,
          experiment,
          authorization,
          now: timestamp,
        });
        proof = governance.proof;
        if (
          proof.review_binding_payload.tenant_id !== tenantId
          || proof.review_binding_payload.candidate_id !== existing.candidate_id
          || proof.review_binding_payload.candidate_version
            !== existing.candidate_version
          || proof.review_binding_payload.decision !== nextStatus
          || proof.review_source_revision !== Number(expected_revision)
          || proof.review_resulting_revision !== Number(expected_revision) + 1
          || ![
            proof.review_source_revision,
            proof.review_resulting_revision,
          ].includes(Number(existing.revision))
          || (
            Number(existing.revision) === proof.review_resulting_revision
            && (
              existing.status !== nextStatus
              || existing.human_review?.review_binding_receipt?.binding_digest
                !== proof.review_binding_receipt.binding_digest
            )
          )
        ) {
          throw new Error("review_binding_candidate_mismatch");
        }
        guardAttestations = {
          [governance.guard_id]: governance.verdict,
          [integrity.guard_id]: integrity.verdict,
        };
      } catch (error) {
        if (
          error.message.startsWith("ai_")
          || error.message.startsWith("learning_candidate_")
          || error.message.startsWith("independent_")
          || error.message.startsWith("human_review_")
        ) {
          throw error;
        }
        throw new Error("learning_candidate_evidence_incomplete");
      }
    }
    return write({
      tenantId,
      collection: "learning_candidates",
      idempotencyKey: idempotency_key,
      expectedRevision: expected_revision,
      idempotencyIntent: candidateReviewIdempotencyIntent({
        candidate_id,
        decision,
        review_note,
        expected_revision,
        review_attestation,
        review_binding_receipt,
      }),
      visibilityContext: visibility_context,
      value: {
        ...existing,
        status: nextStatus,
        human_review: {
          decision: nextStatus,
          audit_reference: proof.audit_reference,
          rollback_reference: proof.rollback_reference,
          reviewer_reference: proof.reviewer_reference || "core-governance-review",
          reviewed_at: proof.reviewed_at || timestamp,
          review_expires_at: proof.review_expires_at || new Date(new Date(timestamp).getTime() + 900_000).toISOString(),
          independent_human_review_verified: proof.independent_human_review_verified === true,
          independent_review_receipt_digest: proof.independent_review_receipt_digest,
          independent_review_binding_digest: proof.independent_review_binding_digest,
          review_tree_id: proof.review_tree_id,
          review_node_id: proof.review_node_id,
          owner_actor_provenance: proof.owner_actor_provenance,
          review_binding_receipt: proof.review_binding_receipt,
          review_binding_payload: proof.review_binding_payload,
          review_source_revision: proof.review_source_revision,
          review_resulting_revision: proof.review_resulting_revision,
          review_evidence_snapshot_digest: proof.review_evidence_snapshot_digest,
          core_approval_attestation: proof.core_approval_attestation,
          guard_attestations: guardAttestations,
          review_note,
        },
      },
    });
  };

  api.replayLearningCandidateReview = async ({
    tenant_id,
    candidate_id,
    decision,
    review_note,
    idempotency_key,
    expected_revision,
    review_attestation = null,
    review_binding_receipt = null,
    visibility_context = null,
  } = {}) => {
    const tenantId = requireTenant(tenant_id);
    return replayWrite({
      tenantId,
      collection: "learning_candidates",
      recordId: candidate_id,
      idempotencyKey: idempotency_key,
      idempotencyIntent: candidateReviewIdempotencyIntent({
        candidate_id,
        decision,
        review_note,
        expected_revision,
        review_attestation,
        review_binding_receipt,
      }),
      visibilityContext: visibility_context,
    });
  };

  api.recordLearningOutcome = async ({
    tenant_id,
    record,
    authorization,
    idempotency_key,
    expected_revision = null,
    review_attestation = null,
    owner_actor_ids = [],
    visibility_context = null,
    visibility_branch_ids = null,
  }) => {
    const tenantId = requireTenant(tenant_id);
    const requested = requireObject(record, "learning_outcome");
    const proof = governanceProof(authorization);
    const expectedBindingDigest = buildAiLearningOutcomeRecordBinding({
      tenant_id: tenantId,
      outcome: requested,
    });
    const attestation = await outcomeEvidenceVerifier({
      tenant_id: tenantId,
      record: clone(requested),
      expected_binding_digest: expectedBindingDigest,
      review_attestation: clone(review_attestation),
      owner_actor_ids: Array.isArray(owner_actor_ids) ? [...owner_actor_ids] : [],
    });
    let canonicalAttestedOutcome = null;
    try {
      canonicalAttestedOutcome = attestation?.canonical_outcome
        ? requireObject(attestation.canonical_outcome, "canonical_learning_outcome")
        : null;
    } catch {
      canonicalAttestedOutcome = null;
    }
    const verified = Boolean(
      attestation?.verified === true
      && attestation?.binding_digest === expectedBindingDigest
      && /^sha256:[a-f0-9]{64}$/.test(String(attestation?.receipt_digest || ""))
      && canonicalAttestedOutcome
      && buildAiLearningOutcomeRecordBinding({
        tenant_id: tenantId,
        outcome: canonicalAttestedOutcome,
      }) === expectedBindingDigest
    );
    const canonical = verified
      ? canonicalAttestedOutcome
      : requested;
    let outcomeVisibilityBranches = Array.isArray(visibility_branch_ids)
      ? [...new Set(visibility_branch_ids)]
      : null;
    if (!outcomeVisibilityBranches && requested.candidate_id) {
      const candidate = await loadRecord({
        tenantId,
        collection: "learning_candidates",
        recordId: requireIdentifier(requested.candidate_id, "candidate_id"),
      });
      const visibility = validateResourceVisibilityBinding(
        candidate?.resource_visibility,
        { tenant_id: tenantId },
      );
      if (!candidate || !visibility.ok) {
        throw new Error("learning_candidate_visibility_invalid");
      }
      outcomeVisibilityBranches = [...visibility.binding.branch_ids];
    }
    if (requested.candidate_id && !verified) {
      throw new Error("learning_outcome_evidence_unverified");
    }
    return write({
      tenantId,
      collection: "learning_outcomes",
      value: {
        ...canonical,
        tenant_id: undefined,
        outcome_id: requested.outcome_id,
        run_id: requested.run_id,
        candidate_id: verified
          ? (canonical.candidate_id || null)
          : (requested.candidate_id || null),
        outcome_verified: verified,
        human_review_status: verified
          ? canonical.human_review_status
          : "pending",
        learning_value: verified ? canonical.learning_value : 0,
        governance: {
          ...proof,
          outcome_attestation_verified: verified,
          outcome_attestation_receipt: verified ? attestation.receipt_digest : null,
          outcome_attestation_failure_reason: verified
            ? null
            : requireIdentifier(
                attestation?.reason || "outcome_evidence_unverified",
                "outcome_attestation_failure_reason",
                120,
              ),
          outcome_binding_digest: expectedBindingDigest,
        },
      },
      idempotencyKey: idempotency_key,
      expectedRevision: expected_revision,
      idempotencyIntent: learningOutcomeIdempotencyIntent({
        tenant_id: tenantId,
        record: requested,
        expected_revision,
        review_attestation,
      }),
      visibilityContext: visibility_context,
      visibilityBranchIds: outcomeVisibilityBranches,
    });
  };

  api.replayLearningOutcome = async ({
    tenant_id,
    record,
    idempotency_key,
    expected_revision,
    review_attestation = null,
    visibility_context = null,
    visibility_branch_ids = null,
  } = {}) => {
    const tenantId = requireTenant(tenant_id);
    const requested = requireObject(record, "learning_outcome");
    return replayWrite({
      tenantId,
      collection: "learning_outcomes",
      recordId: requested.outcome_id,
      idempotencyKey: idempotency_key,
      idempotencyIntent: learningOutcomeIdempotencyIntent({
        tenant_id: tenantId,
        record: requested,
        expected_revision,
        review_attestation,
      }),
      visibilityContext: visibility_context,
      visibilityBranchIds: visibility_branch_ids,
    });
  };

  return api;
}

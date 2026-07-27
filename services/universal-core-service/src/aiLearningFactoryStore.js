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
  const humanReview = input.human_review && typeof input.human_review === "object" && !Array.isArray(input.human_review)
    ? {
        decision: enumValue(input.human_review.decision, "human_review_decision", ["approved_for_shadow", "deferred", "rejected"]),
        audit_reference: requireIdentifier(input.human_review.audit_reference, "audit_reference", 240),
        rollback_reference: requireIdentifier(input.human_review.rollback_reference, "rollback_reference", 240),
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
    dataset_version: optionalIdentifier(input.dataset_version, "dataset_version"),
    scorecard_id: requireIdentifier(input.scorecard_id, "scorecard_id"),
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
  return {
    outcome_id: requireIdentifier(input.outcome_id, "outcome_id"),
    run_id: requireIdentifier(input.run_id, "run_id"),
    candidate_id: optionalIdentifier(input.candidate_id, "candidate_id"),
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

function collectionContract(collection) {
  const contract = COLLECTIONS[collection];
  if (!contract) throw new Error("learning_factory_collection_invalid");
  return contract;
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
  return {
    schema_version: contract.schemaVersion,
    tenant_id: tenantId,
    ...normalized,
    revision: record.revision,
    created_at: isoDate(record.created_at, "created_at"),
    updated_at: isoDate(record.updated_at, "updated_at"),
    advisory_only: true,
    autonomous_execution_allowed: false,
  };
}

function governanceProof(value) {
  const proof = requireObject(value, "authorization");
  if (proof.core_verdict !== "ALLOW") throw new Error("core_governance_allow_required");
  if (proof.owner_confirmed !== true) throw new Error("owner_confirmation_required");
  if (!Array.isArray(proof.scopes) || !proof.scopes.includes("core:govern")) throw new Error("core_govern_scope_required");
  return {
    core_verdict: "ALLOW",
    owner_confirmed: true,
    audit_reference: requireIdentifier(proof.audit_reference, "audit_reference", 240),
    rollback_reference: requireIdentifier(proof.rollback_reference, "rollback_reference", 240),
  };
}

/**
 * Versioned tenant-first registries for advisory AI learning artifacts.
 * The optional adapter contract is deliberately narrow and receives tenant_id
 * on every load/save/list operation.
 */
export function createAiLearningFactoryStore({ adapter = null, now = () => new Date().toISOString() } = {}) {
  const persistence = validateAdapter(adapter);
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

  async function write({ tenantId, collection, value, idempotencyKey, expectedRevision = null }) {
    const contract = collectionContract(collection);
    const source = requireObject(value, collection);
    if (source.tenant_id !== undefined && source.tenant_id !== tenantId) throw new Error("cross_tenant_record_denied");
    const normalized = contract.normalize(source);
    const recordId = normalized[contract.idField];
    const operationKey = `${tenantId}:${collection}:${requireIdentifier(idempotencyKey, "idempotency_key", 240)}`;
    const requestDigest = JSON.stringify(normalized);
    return serializeWrite(`${tenantId}:${collection}`, async () => {
      const priorOperation = idempotency.get(operationKey);
      if (priorOperation) {
        if (priorOperation.record[contract.idField] !== recordId || priorOperation.request_digest !== requestDigest) {
          throw new Error("learning_factory_idempotency_conflict");
        }
        return clone(priorOperation.record);
      }
      const existing = await loadRecord({ tenantId, collection, recordId });
      const currentRevision = existing?.revision || 0;
      if (expectedRevision !== null && expectedRevision !== currentRevision) throw new Error("learning_factory_revision_conflict");
      const timestamp = isoDate(now(), "updated_at");
      const record = {
        schema_version: contract.schemaVersion,
        tenant_id: tenantId,
        ...normalized,
        revision: currentRevision + 1,
        created_at: existing?.created_at || timestamp,
        updated_at: timestamp,
        advisory_only: true,
        autonomous_execution_allowed: false,
      };
      if (persistence) {
        await persistence.save({
          tenant_id: tenantId,
          collection,
          record_id: recordId,
          expected_revision: currentRevision,
          record: clone(record),
        });
      }
      collectionRecords(tenantId, collection).set(recordId, record);
      idempotency.set(operationKey, { request_digest: requestDigest, record });
      return clone(record);
    });
  }

  async function read({ tenantId, collection, recordId }) {
    collectionContract(collection);
    return clone(await loadRecord({ tenantId, collection, recordId }));
  }

  async function list({ tenantId, collection, limit = 100 }) {
    collectionContract(collection);
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    if (persistence) {
      const persisted = await persistence.list({ tenant_id: tenantId, collection, limit: boundedLimit });
      if (!Array.isArray(persisted)) throw new Error("learning_factory_adapter_list_invalid");
      for (const row of persisted) {
        const contract = collectionContract(collection);
        const recordId = row?.[contract.idField];
        const validated = validateStoredRecord(row, { tenantId, collection, recordId });
        collectionRecords(tenantId, collection).set(recordId, validated);
      }
    }
    return clone(
      [...collectionRecords(tenantId, collection).values()]
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
        .slice(-boundedLimit),
    );
  }

  function typedWrite(collection) {
    return ({ tenant_id, record, idempotency_key, expected_revision = null }) => write({
      tenantId: requireTenant(tenant_id),
      collection,
      value: record,
      idempotencyKey: idempotency_key,
      expectedRevision: expected_revision,
    });
  }

  function typedRead(collection) {
    return ({ tenant_id, record_id }) => read({
      tenantId: requireTenant(tenant_id),
      collection,
      recordId: requireIdentifier(record_id, "record_id"),
    });
  }

  function typedList(collection) {
    return ({ tenant_id, limit = 100 }) => list({
      tenantId: requireTenant(tenant_id),
      collection,
      limit,
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
  }) => {
    const tenantId = requireTenant(tenant_id);
    const candidateId = requireIdentifier(candidate_id, "candidate_id");
    const proof = governanceProof(authorization);
    const existing = await loadRecord({ tenantId, collection: "learning_candidates", recordId: candidateId });
    if (!existing) throw new Error("learning_candidate_not_found");
    const nextStatus = enumValue(decision, "decision", ["approved_for_shadow", "deferred", "rejected"]);
    if (
      nextStatus === "approved_for_shadow"
      && (
        existing.risk_review_status !== "passed"
        || existing.cost_review_status !== "passed"
        || !existing.dataset_version
        || !existing.scorecard_id
        || !existing.rollback_reference
      )
    ) {
      throw new Error("learning_candidate_evidence_incomplete");
    }
    return write({
      tenantId,
      collection: "learning_candidates",
      idempotencyKey: idempotency_key,
      expectedRevision: expected_revision,
      value: {
        ...existing,
        status: nextStatus,
        human_review: {
          decision: nextStatus,
          audit_reference: proof.audit_reference,
          rollback_reference: proof.rollback_reference,
          review_note,
        },
      },
    });
  };

  api.recordLearningOutcome = ({
    tenant_id,
    record,
    authorization,
    idempotency_key,
    expected_revision = null,
  }) => {
    const proof = governanceProof(authorization);
    return write({
      tenantId: requireTenant(tenant_id),
      collection: "learning_outcomes",
      value: { ...requireObject(record, "learning_outcome"), governance: proof },
      idempotencyKey: idempotency_key,
      expectedRevision: expected_revision,
    });
  };

  return api;
}

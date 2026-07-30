import crypto from "node:crypto";
import {
  createResourceVisibilityBinding,
  resourceVisibleToContext,
} from "./resourceVisibility.js";

export const AI_RUNTIME_TELEMETRY_SCHEMA_VERSION = "ai_runtime_telemetry_v0_16";

export const AI_RUNTIME_TELEMETRY_FIELDS = Object.freeze([
  "tenant_id",
  "client_type",
  "audience",
  "agent_id",
  "session_id",
  "logical_task",
  "run_id",
  "trace_id",
  "parent_trace_id",
  "branch_id",
  "subbranch_id",
  "route_reason",
  "route_confidence",
  "route_confidence_kind",
  "model_provider",
  "model_id",
  "model_snapshot",
  "prompt_version",
  "tool_id",
  "tool_result_status",
  "retry_count",
  "fallback_path",
  "handoff_from",
  "handoff_to",
  "handoff_verified",
  "agent_count",
  "new_invocations",
  "invocation_usage_kind",
  "tool_call_count",
  "artifacts_reused",
  "context_avoided",
  "context_avoidance_estimate",
  "context_avoidance_kind",
  "input_tokens",
  "output_tokens",
  "cached_tokens",
  "usage_kind",
  "actual_cost",
  "estimated_cost",
  "usage_source",
  "rate_card_version",
  "cost_formula",
  "provider_receipt_digest",
  "ttft_ms",
  "ttft_observed",
  "latency_ms",
  "latency_observed",
  "queue_ms",
  "queue_observed",
  "outcome_status",
  "outcome_verified",
  "human_review_status",
  "quality",
  "quality_verified",
  "quality_attestation_digest",
  "learning_value",
  "provider_usage_verified",
  "evidence_digest",
  "policy_snapshot",
  "rollback_reference",
]);

const RAW_CONTENT_FIELDS = new Set([
  "authorization",
  "content",
  "credentials",
  "customer_data",
  "input",
  "messages",
  "output",
  "prompt",
  "raw_content",
  "raw_input",
  "raw_output",
  "raw_prompt",
  "request_body",
  "response_body",
  "secret",
]);

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:@/-]*$/i;
const TENANT_PATTERN = /^[a-z0-9][a-z0-9_-]{1,119}$/i;
const REFERENCE_PATTERN = /^[a-z0-9][a-z0-9._:@/-]{0,239}$/i;
const SENSITIVE_REFERENCE_PATTERN = /(?:\b(?:sk|gho|ghp|ghs|github_pat|akia)[-_a-z0-9]{12,}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i;
const PHONE_LIKE_IDENTIFIER_PATTERN = /(?:\+?\d[\d .()-]{7,}\d)/;
const GENERATED_IDENTIFIER_PATTERN = /^(?:[a-z][a-z0-9._:@/-]*[_:-](?:(?=[a-f0-9]{24,64}$)(?=.*[a-f])[a-f0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))$/i;

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field}_invalid`);
  return value;
}

function redactText(value, field, max = 500) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized
    .replace(/\b(?:bearer\s+)?(?:sk|gho|ghp|ghs|github_pat|akia)[-_a-z0-9]{12,}\b/gi, "[REDACTED_SECRET]")
    .replace(/\b(bearer)\s+[a-z0-9._~+/=-]{12,}\b/gi, "$1 [REDACTED_SECRET]")
    .replace(/\b(password|passwd|secret|token|api[_ -]?key|authorization)\s*[:=]\s*[^\s,;&]+/gi, "$1=[REDACTED_SECRET]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/(?:\+?\d[\d .()-]{7,}\d)/g, "[REDACTED_PHONE]");
}

function requireIdentifier(value, field, max = 160) {
  const normalized = String(value ?? "").trim();
  if (
    !normalized
    || normalized.length > max
    || !IDENTIFIER_PATTERN.test(normalized)
    || SENSITIVE_REFERENCE_PATTERN.test(normalized)
    || (
      PHONE_LIKE_IDENTIFIER_PATTERN.test(normalized)
      && !GENERATED_IDENTIFIER_PATTERN.test(normalized)
    )
  ) throw new Error(`${field}_invalid`);
  return normalized;
}

function requireTenant(value) {
  const tenantId = String(value ?? "").trim();
  if (!TENANT_PATTERN.test(tenantId)) throw new Error("tenant_id_invalid");
  return tenantId;
}

function nullableIdentifier(value, field, max = 160) {
  if (value === null || value === undefined || value === "") return null;
  return requireIdentifier(value, field, max);
}

function requireReference(value, field) {
  const normalized = String(value ?? "").trim();
  if (!REFERENCE_PATTERN.test(normalized) || SENSITIVE_REFERENCE_PATTERN.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function requireNumber(value, field, { integer = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > maximum || (integer && !Number.isInteger(number))) {
    throw new Error(`${field}_invalid`);
  }
  return number;
}

function nullableNumber(value, field, options = {}) {
  if (value === null || value === undefined || value === "") return null;
  return requireNumber(value, field, options);
}

function requireBoolean(value, field) {
  if (typeof value !== "boolean") throw new Error(`${field}_invalid`);
  return value;
}

function rejectRawContentFields(input) {
  for (const key of Object.keys(input)) {
    if (RAW_CONTENT_FIELDS.has(key.toLowerCase())) throw new Error("telemetry_raw_content_forbidden");
  }
}

function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Produces the only telemetry shape accepted by the AI Learning Factory.
 * Unknown fields are omitted and known raw-content fields fail closed.
 */
export function normalizeAiRuntimeTelemetry(input, {
  recordedAt = new Date().toISOString(),
  trustedAttestation = {},
  trustedPersistence = false,
} = {}) {
  const source = requireObject(input, "telemetry");
  rejectRawContentFields(source);
  const requestedUsageKind = requireIdentifier(source.usage_kind, "usage_kind", 40);
  if (!["actual", "estimated", "unavailable"].includes(requestedUsageKind)) {
    throw new Error("usage_kind_invalid");
  }
  const providerUsageVerified = (
    trustedAttestation.provider_usage_verified === true
    && (
      trustedPersistence === true
      || /^sha256:[a-f0-9]{64}$/.test(String(trustedAttestation.provider_attestation_digest || ""))
    )
  );
  const estimatedUsageVerified = (
    trustedAttestation.estimated_usage_verified === true
    && (
      trustedPersistence === true
      || /^sha256:[a-f0-9]{64}$/.test(String(trustedAttestation.estimate_attestation_digest || ""))
    )
  );
  const qualityVerified = (
    trustedAttestation.quality_verified === true
    && (
      trustedPersistence === true
      || /^sha256:[a-f0-9]{64}$/.test(String(trustedAttestation.quality_attestation_digest || ""))
    )
  );
  let canonicalUsage;
  if (trustedPersistence) {
    canonicalUsage = {
      usage_kind: requestedUsageKind,
      input_tokens: source.input_tokens,
      output_tokens: source.output_tokens,
      cached_tokens: source.cached_tokens,
      actual_cost: source.actual_cost,
      estimated_cost: source.estimated_cost,
      usage_source: source.usage_source,
      rate_card_version: source.rate_card_version,
      cost_formula: source.cost_formula,
      provider_receipt_digest: source.provider_receipt_digest,
    };
  } else if (requestedUsageKind === "actual" && providerUsageVerified) {
    canonicalUsage = requireObject(trustedAttestation.canonical_usage, "provider_canonical_usage");
  } else if (requestedUsageKind === "estimated" && estimatedUsageVerified) {
    canonicalUsage = requireObject(trustedAttestation.canonical_usage, "estimate_canonical_usage");
  } else if (requestedUsageKind === "unavailable") {
    if (
      Number(source.input_tokens || 0) !== 0
      || Number(source.output_tokens || 0) !== 0
      || Number(source.cached_tokens || 0) !== 0
      || source.actual_cost !== null && source.actual_cost !== undefined
      || source.estimated_cost !== null && source.estimated_cost !== undefined
      || String(source.rate_card_version || "").trim()
      || String(source.provider_receipt_digest || "").trim()
    ) {
      throw new Error("unavailable_usage_claim_forbidden");
    }
    canonicalUsage = {
      usage_kind: "unavailable",
      input_tokens: 0,
      output_tokens: 0,
      cached_tokens: 0,
      actual_cost: null,
      estimated_cost: null,
      usage_source: "host_usage_unavailable",
      rate_card_version: null,
      cost_formula: null,
      provider_receipt_digest: null,
    };
  } else {
    throw new Error("usage_attestation_required");
  }
  if (canonicalUsage.usage_kind !== requestedUsageKind) throw new Error("usage_attestation_binding_invalid");
  const canonicalQuality = qualityVerified
    ? requireNumber(
      trustedPersistence ? source.quality : trustedAttestation.canonical_quality,
      "quality",
      { maximum: 1 },
    )
    : null;
  const qualityAttestationDigest = qualityVerified
    ? requireReference(
      trustedPersistence
        ? source.quality_attestation_digest
        : trustedAttestation.quality_attestation_digest,
      "quality_attestation_digest",
    )
    : null;
  const canonicalLearningValue = qualityVerified
    ? requireNumber(
      trustedPersistence
        ? source.learning_value
        : trustedAttestation.canonical_learning_value,
      "learning_value",
      { maximum: 1 },
    )
    : 0;
  const canonicalHumanReviewStatus = qualityVerified
    ? requireIdentifier(
      trustedPersistence
        ? source.human_review_status
        : trustedAttestation.canonical_human_review_status,
      "human_review_status",
      80,
    )
    : requireIdentifier(source.human_review_status, "human_review_status", 80);
  if (![
    "not_required",
    "pending",
    "approved",
    "rejected",
    "completed_unattested",
  ].includes(canonicalHumanReviewStatus)) {
    throw new Error("human_review_status_invalid");
  }
  const attestedOutcomeVerified = qualityVerified && (
    trustedPersistence
      ? source.outcome_verified === true
      : trustedAttestation.outcome_verified === true
  );
  const event = {
    tenant_id: requireTenant(source.tenant_id),
    client_type: requireIdentifier(source.client_type, "client_type", 80),
    audience: requireIdentifier(source.audience, "audience", 160),
    agent_id: requireIdentifier(source.agent_id, "agent_id"),
    session_id: requireIdentifier(source.session_id, "session_id"),
    logical_task: requireReference(source.logical_task, "logical_task"),
    run_id: requireIdentifier(source.run_id, "run_id"),
    trace_id: requireIdentifier(source.trace_id, "trace_id"),
    parent_trace_id: nullableIdentifier(source.parent_trace_id, "parent_trace_id"),
    branch_id: requireIdentifier(source.branch_id, "branch_id"),
    subbranch_id: requireIdentifier(source.subbranch_id, "subbranch_id"),
    route_reason: redactText(source.route_reason, "route_reason"),
    route_confidence: requireNumber(source.route_confidence, "route_confidence", { maximum: 1 }),
    route_confidence_kind: requireIdentifier(
      source.route_confidence_kind,
      "route_confidence_kind",
      80,
    ),
    model_provider: requireIdentifier(source.model_provider, "model_provider", 80),
    model_id: requireIdentifier(source.model_id, "model_id"),
    model_snapshot: requireReference(source.model_snapshot, "model_snapshot"),
    prompt_version: requireReference(source.prompt_version, "prompt_version"),
    tool_id: nullableIdentifier(source.tool_id, "tool_id"),
    tool_result_status: nullableIdentifier(source.tool_result_status, "tool_result_status", 80),
    retry_count: requireNumber(source.retry_count, "retry_count", { integer: true, maximum: 100 }),
    fallback_path: nullableIdentifier(source.fallback_path, "fallback_path", 240),
    handoff_from: nullableIdentifier(source.handoff_from, "handoff_from"),
    handoff_to: nullableIdentifier(source.handoff_to, "handoff_to"),
    handoff_verified: requireBoolean(source.handoff_verified, "handoff_verified"),
    agent_count: requireNumber(source.agent_count, "agent_count", { integer: true, maximum: 100 }),
    new_invocations: requireNumber(source.new_invocations, "new_invocations", { integer: true, maximum: 1_000_000 }),
    invocation_usage_kind: requireIdentifier(source.invocation_usage_kind, "invocation_usage_kind", 80),
    tool_call_count: requireNumber(source.tool_call_count, "tool_call_count", { integer: true, maximum: 1_000_000 }),
    artifacts_reused: requireNumber(source.artifacts_reused, "artifacts_reused", { integer: true, maximum: 1_000_000 }),
    context_avoided: requireNumber(source.context_avoided, "context_avoided", { integer: true }),
    context_avoidance_estimate: requireNumber(
      source.context_avoidance_estimate,
      "context_avoidance_estimate",
      { integer: true },
    ),
    context_avoidance_kind: requireIdentifier(
      source.context_avoidance_kind,
      "context_avoidance_kind",
      80,
    ),
    input_tokens: requireNumber(canonicalUsage.input_tokens, "input_tokens", { integer: true }),
    output_tokens: requireNumber(canonicalUsage.output_tokens, "output_tokens", { integer: true }),
    cached_tokens: requireNumber(canonicalUsage.cached_tokens, "cached_tokens", { integer: true }),
    usage_kind: requestedUsageKind,
    actual_cost: nullableNumber(canonicalUsage.actual_cost, "actual_cost"),
    estimated_cost: nullableNumber(canonicalUsage.estimated_cost, "estimated_cost"),
    usage_source: requireIdentifier(canonicalUsage.usage_source, "usage_source", 120),
    rate_card_version: nullableIdentifier(canonicalUsage.rate_card_version, "rate_card_version", 160),
    cost_formula: canonicalUsage.cost_formula === null || canonicalUsage.cost_formula === undefined || canonicalUsage.cost_formula === ""
      ? null
      : redactText(canonicalUsage.cost_formula, "cost_formula", 500),
    provider_receipt_digest: canonicalUsage.provider_receipt_digest === null
      || canonicalUsage.provider_receipt_digest === undefined
      || canonicalUsage.provider_receipt_digest === ""
      ? null
      : requireReference(canonicalUsage.provider_receipt_digest, "provider_receipt_digest"),
    ttft_ms: requireNumber(source.ttft_ms, "ttft_ms"),
    ttft_observed: requireBoolean(source.ttft_observed, "ttft_observed"),
    latency_ms: requireNumber(source.latency_ms, "latency_ms"),
    latency_observed: requireBoolean(source.latency_observed, "latency_observed"),
    queue_ms: requireNumber(source.queue_ms, "queue_ms"),
    queue_observed: requireBoolean(source.queue_observed, "queue_observed"),
    outcome_status: requireIdentifier(source.outcome_status, "outcome_status", 80),
    outcome_verified: attestedOutcomeVerified,
    human_review_status: canonicalHumanReviewStatus,
    quality: canonicalQuality,
    quality_verified: qualityVerified,
    quality_attestation_digest: qualityAttestationDigest,
    learning_value: canonicalLearningValue,
    provider_usage_verified: providerUsageVerified,
    evidence_digest: requireReference(source.evidence_digest, "evidence_digest"),
    policy_snapshot: requireReference(source.policy_snapshot, "policy_snapshot"),
    rollback_reference: requireReference(source.rollback_reference, "rollback_reference"),
  };
  if (event.cached_tokens > event.input_tokens) throw new Error("cached_usage_exceeds_input");
  if (event.cached_tokens > 0 && event.provider_usage_verified !== true) {
    throw new Error("cached_usage_unverified");
  }
  if (event.usage_kind === "actual") {
    if (
      event.provider_usage_verified !== true
      || event.actual_cost === null
      || event.estimated_cost !== null
      || event.rate_card_version === null
      || !/^sha256:[a-f0-9]{64}$/.test(String(event.provider_receipt_digest || ""))
    ) {
      throw new Error("actual_usage_provenance_invalid");
    }
  } else if (
    event.actual_cost !== null
    || event.provider_usage_verified === true
    || event.provider_receipt_digest !== null
  ) {
    throw new Error("non_actual_usage_provenance_invalid");
  }
  if (event.quality_verified && event.quality === null) throw new Error("quality_attestation_invalid");
  if (
    event.quality_verified
    && !/^sha256:[a-f0-9]{64}$/.test(String(event.quality_attestation_digest || ""))
  ) throw new Error("quality_attestation_invalid");
  if (!event.quality_verified && event.quality_attestation_digest !== null) {
    throw new Error("quality_attestation_invalid");
  }
  if (event.usage_kind === "estimated" && event.estimated_cost === null) {
    throw new Error("estimated_usage_cost_required");
  }
  if (
    event.usage_kind === "unavailable"
    && (event.estimated_cost !== null || event.rate_card_version !== null || event.cost_formula !== null)
  ) {
    throw new Error("unavailable_usage_cost_forbidden");
  }
  const normalizedRecordedAt = new Date(recordedAt);
  if (Number.isNaN(normalizedRecordedAt.getTime())) throw new Error("recorded_at_invalid");
  return {
    schema_version: AI_RUNTIME_TELEMETRY_SCHEMA_VERSION,
    ...event,
    recorded_at: normalizedRecordedAt.toISOString(),
    raw_content_persisted: false,
    telemetry_digest: `art_${canonicalDigest(event)}`,
  };
}

export function validateAiRuntimeTelemetryAdapter(adapter) {
  if (adapter === null || adapter === undefined) return null;
  const source = requireObject(adapter, "telemetry_adapter");
  for (const method of ["load", "save", "list"]) {
    if (typeof source[method] !== "function") throw new Error(`telemetry_adapter_${method}_required`);
  }
  return source;
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Tenant-first immutable telemetry store. Persistence is optional and adapter
 * methods never receive an unscoped key.
 */
export function createAiRuntimeTelemetryStore({
  adapter = null,
  now = () => new Date().toISOString(),
  verifyProviderUsage = async () => ({ verified: false }),
  verifyEstimatedUsage = async () => ({ verified: false }),
  verifyQualityEvidence = async () => ({ verified: false }),
} = {}) {
  const persistence = validateAiRuntimeTelemetryAdapter(adapter);
  if (typeof verifyProviderUsage !== "function") throw new Error("telemetry_provider_verifier_required");
  if (typeof verifyEstimatedUsage !== "function") throw new Error("telemetry_estimate_verifier_required");
  if (typeof verifyQualityEvidence !== "function") throw new Error("telemetry_quality_verifier_required");
  const records = new Map();
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

  function tenantRecords(tenantId) {
    let bucket = records.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      records.set(tenantId, bucket);
    }
    return bucket;
  }

  function normalizePersisted(persisted, tenantId, runId = null) {
    if (
      persisted.schema_version !== AI_RUNTIME_TELEMETRY_SCHEMA_VERSION
      || persisted.raw_content_persisted !== false
    ) {
      throw new Error("telemetry_adapter_integrity_violation");
    }
    const normalized = normalizeAiRuntimeTelemetry(persisted, {
      recordedAt: persisted.recorded_at,
      trustedPersistence: true,
      trustedAttestation: {
        provider_usage_verified: persisted.provider_usage_verified === true,
        estimated_usage_verified: persisted.usage_kind === "estimated",
        quality_verified: persisted.quality_verified === true,
        quality_attestation_digest: persisted.quality_attestation_digest,
        canonical_usage: {
          usage_kind: persisted.usage_kind,
          input_tokens: persisted.input_tokens,
          output_tokens: persisted.output_tokens,
          cached_tokens: persisted.cached_tokens,
          actual_cost: persisted.actual_cost,
          estimated_cost: persisted.estimated_cost,
          usage_source: persisted.usage_source,
          rate_card_version: persisted.rate_card_version,
          cost_formula: persisted.cost_formula,
          provider_receipt_digest: persisted.provider_receipt_digest,
        },
        canonical_quality: persisted.quality,
        canonical_learning_value: persisted.learning_value,
        canonical_human_review_status: persisted.human_review_status,
        outcome_verified: persisted.outcome_verified === true,
      },
    });
    if (normalized.tenant_id !== tenantId || (runId && normalized.run_id !== runId)) throw new Error("telemetry_adapter_scope_violation");
    if (persisted.telemetry_digest !== normalized.telemetry_digest) throw new Error("telemetry_adapter_integrity_violation");
    return {
      ...normalized,
      ...(persisted.resource_visibility
        && typeof persisted.resource_visibility === "object"
        && !Array.isArray(persisted.resource_visibility)
        ? { resource_visibility: clone(persisted.resource_visibility) }
        : {}),
    };
  }

  async function loadPersisted(tenantId, runId) {
    if (!persistence) return null;
    const persisted = await persistence.load({ tenant_id: tenantId, run_id: runId });
    if (!persisted) return null;
    const normalized = normalizePersisted(persisted, tenantId, runId);
    tenantRecords(tenantId).set(runId, normalized);
    return normalized;
  }

  return {
    schema_version: "ai_runtime_telemetry_store_v0_16",
    persistence: persistence ? "optional_adapter_active" : "memory_only",
    tenant_scoped: true,
    idempotent: true,

    async record({
      tenant_id,
      idempotency_key,
      telemetry,
      visibility_context = null,
    }) {
      const tenantId = requireTenant(tenant_id);
      const idempotencyKey = requireIdentifier(idempotency_key, "idempotency_key", 200);
      const candidate = { ...requireObject(telemetry, "telemetry"), tenant_id: tenantId };
      const [providerAttestation, estimateAttestation, qualityAttestation] = await Promise.all([
        verifyProviderUsage({ tenant_id: tenantId, telemetry: clone(candidate) }),
        verifyEstimatedUsage({ tenant_id: tenantId, telemetry: clone(candidate) }),
        verifyQualityEvidence({ tenant_id: tenantId, telemetry: clone(candidate) }),
      ]);
      const requestedUsageKind = String(candidate.usage_kind || "").trim();
      const canonicalUsageAttestation = requestedUsageKind === "actual"
        ? providerAttestation
        : requestedUsageKind === "estimated"
          ? estimateAttestation
          : null;
      const normalized = normalizeAiRuntimeTelemetry(candidate, {
        recordedAt: now(),
        trustedAttestation: {
          provider_usage_verified: providerAttestation?.verified === true,
          provider_attestation_digest: providerAttestation?.attestation_digest
            || providerAttestation?.receipt_digest
            || null,
          estimated_usage_verified: estimateAttestation?.verified === true,
          estimate_attestation_digest: estimateAttestation?.attestation_digest
            || estimateAttestation?.receipt_digest
            || null,
          canonical_usage: canonicalUsageAttestation?.canonical_usage || null,
          quality_verified: qualityAttestation?.verified === true,
          quality_attestation_digest: qualityAttestation?.attestation_digest
            || qualityAttestation?.receipt_digest
            || null,
          canonical_quality: qualityAttestation?.canonical_quality,
          canonical_learning_value: qualityAttestation?.canonical_learning_value,
          canonical_human_review_status: qualityAttestation?.canonical_human_review_status,
          outcome_verified: qualityAttestation?.outcome_verified === true,
        },
      });
      const resourceVisibility = createResourceVisibilityBinding({
        tenant_id: tenantId,
        branch_ids: [normalized.branch_id],
        origin_context: visibility_context || {
          tenant_id: tenantId,
          client_type: normalized.client_type,
          audience: normalized.audience,
          entitlements: [],
        },
        created_at: normalized.recorded_at,
      });
      const storedCandidate = {
        ...normalized,
        resource_visibility: resourceVisibility,
      };
      const key = `${tenantId}:${idempotencyKey}`;
      return serializeWrite(tenantId, async () => {
        const existingIdempotency = idempotency.get(key);
        if (existingIdempotency) {
          if (existingIdempotency.telemetry_digest !== normalized.telemetry_digest) throw new Error("telemetry_idempotency_conflict");
          return clone(existingIdempotency);
        }
        const bucket = tenantRecords(tenantId);
        const existing = bucket.get(normalized.run_id) || await loadPersisted(tenantId, normalized.run_id);
        if (existing && existing.telemetry_digest !== normalized.telemetry_digest) throw new Error("telemetry_run_conflict");
        const stored = existing || storedCandidate;
        if (!existing && persistence) {
          await persistence.save({
            tenant_id: tenantId,
            run_id: stored.run_id,
            record: clone(stored),
          });
        }
        bucket.set(stored.run_id, stored);
        idempotency.set(key, stored);
        return clone(stored);
      });
    },

    async read({ tenant_id, run_id, visibility_context = null }) {
      const tenantId = requireTenant(tenant_id);
      const runId = requireIdentifier(run_id, "run_id");
      const record = tenantRecords(tenantId).get(runId)
        || await loadPersisted(tenantId, runId);
      if (
        visibility_context
        && !resourceVisibleToContext(record, visibility_context, { tenant_id: tenantId })
      ) return null;
      return clone(record);
    },

    async list({
      tenant_id,
      limit = 100,
      offset = 0,
      filters = {},
      page = false,
      visibility_context = null,
    }) {
      const tenantId = requireTenant(tenant_id);
      const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
      const boundedOffset = Number(offset);
      if (
        !Number.isSafeInteger(boundedOffset)
        || boundedOffset < 0
        || boundedOffset > 1_000_000
      ) throw new Error("cursor_invalid");
      const normalizedFilters = {};
      for (const [field, value] of Object.entries(
        filters && typeof filters === "object" && !Array.isArray(filters) ? filters : {},
      )) {
        if (field !== "trace_id") throw new Error("telemetry_filter_invalid");
        normalizedFilters.trace_id = requireIdentifier(value, "trace_id");
      }
      if (persistence) {
        if (visibility_context && typeof persistence.listForVisibility !== "function") {
          throw new Error("resource_visibility_adapter_required");
        }
        const persisted = visibility_context
          ? await persistence.listForVisibility({
              tenant_id: tenantId,
              visibility_context,
              limit: boundedLimit + (page ? 1 : 0),
              offset: boundedOffset,
              filters: normalizedFilters,
            })
          : await persistence.list({
              tenant_id: tenantId,
              limit: boundedLimit + (page ? 1 : 0),
              offset: boundedOffset,
              filters: normalizedFilters,
            });
        if (!Array.isArray(persisted)) throw new Error("telemetry_adapter_list_invalid");
        const records = [];
        for (const row of persisted) {
          const normalized = normalizePersisted(row, tenantId);
          tenantRecords(tenantId).set(normalized.run_id, normalized);
          if (
            records.length < boundedLimit
            && (!visibility_context || resourceVisibleToContext(
              normalized,
              visibility_context,
              { tenant_id: tenantId },
            ))
            && Object.entries(normalizedFilters).every(([field, value]) =>
              normalized[field] === value)
          ) records.push(normalized);
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
      const ordered = [...tenantRecords(tenantId).values()].sort((a, b) =>
        b.recorded_at.localeCompare(a.recorded_at)
        || a.run_id.localeCompare(b.run_id));
      const visible = visibility_context
        ? ordered.filter((record) =>
            resourceVisibleToContext(record, visibility_context, { tenant_id: tenantId }))
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
    },
  };
}

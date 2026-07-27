import crypto from "node:crypto";

export const AI_RUNTIME_TELEMETRY_SCHEMA_VERSION = "ai_runtime_telemetry_v0_16";

export const AI_RUNTIME_TELEMETRY_FIELDS = Object.freeze([
  "tenant_id",
  "client_type",
  "audience",
  "agent_id",
  "session_id",
  "run_id",
  "trace_id",
  "parent_trace_id",
  "branch_id",
  "subbranch_id",
  "route_reason",
  "route_confidence",
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
  "input_tokens",
  "output_tokens",
  "cached_tokens",
  "estimated_cost",
  "ttft_ms",
  "latency_ms",
  "queue_ms",
  "outcome_status",
  "outcome_verified",
  "human_review_status",
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
  const normalized = redactText(value, field, max);
  if (!IDENTIFIER_PATTERN.test(normalized)) throw new Error(`${field}_invalid`);
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
export function normalizeAiRuntimeTelemetry(input, { recordedAt = new Date().toISOString() } = {}) {
  const source = requireObject(input, "telemetry");
  rejectRawContentFields(source);
  const event = {
    tenant_id: requireTenant(source.tenant_id),
    client_type: requireIdentifier(source.client_type, "client_type", 80),
    audience: requireIdentifier(source.audience, "audience", 160),
    agent_id: requireIdentifier(source.agent_id, "agent_id"),
    session_id: requireIdentifier(source.session_id, "session_id"),
    run_id: requireIdentifier(source.run_id, "run_id"),
    trace_id: requireIdentifier(source.trace_id, "trace_id"),
    parent_trace_id: nullableIdentifier(source.parent_trace_id, "parent_trace_id"),
    branch_id: requireIdentifier(source.branch_id, "branch_id"),
    subbranch_id: requireIdentifier(source.subbranch_id, "subbranch_id"),
    route_reason: redactText(source.route_reason, "route_reason"),
    route_confidence: requireNumber(source.route_confidence, "route_confidence", { maximum: 1 }),
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
    input_tokens: requireNumber(source.input_tokens, "input_tokens", { integer: true }),
    output_tokens: requireNumber(source.output_tokens, "output_tokens", { integer: true }),
    cached_tokens: requireNumber(source.cached_tokens, "cached_tokens", { integer: true }),
    estimated_cost: requireNumber(source.estimated_cost, "estimated_cost"),
    ttft_ms: requireNumber(source.ttft_ms, "ttft_ms"),
    latency_ms: requireNumber(source.latency_ms, "latency_ms"),
    queue_ms: requireNumber(source.queue_ms, "queue_ms"),
    outcome_status: requireIdentifier(source.outcome_status, "outcome_status", 80),
    outcome_verified: requireBoolean(source.outcome_verified, "outcome_verified"),
    human_review_status: requireIdentifier(source.human_review_status, "human_review_status", 80),
    evidence_digest: requireReference(source.evidence_digest, "evidence_digest"),
    policy_snapshot: requireReference(source.policy_snapshot, "policy_snapshot"),
    rollback_reference: requireReference(source.rollback_reference, "rollback_reference"),
  };
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
export function createAiRuntimeTelemetryStore({ adapter = null, now = () => new Date().toISOString() } = {}) {
  const persistence = validateAiRuntimeTelemetryAdapter(adapter);
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
    const normalized = normalizeAiRuntimeTelemetry(persisted, { recordedAt: persisted.recorded_at });
    if (normalized.tenant_id !== tenantId || (runId && normalized.run_id !== runId)) throw new Error("telemetry_adapter_scope_violation");
    if (persisted.telemetry_digest !== normalized.telemetry_digest) throw new Error("telemetry_adapter_integrity_violation");
    return normalized;
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

    async record({ tenant_id, idempotency_key, telemetry }) {
      const tenantId = requireTenant(tenant_id);
      const idempotencyKey = requireIdentifier(idempotency_key, "idempotency_key", 200);
      const normalized = normalizeAiRuntimeTelemetry({ ...requireObject(telemetry, "telemetry"), tenant_id: tenantId }, { recordedAt: now() });
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
        const stored = existing || normalized;
        bucket.set(stored.run_id, stored);
        idempotency.set(key, stored);
        if (!existing && persistence) await persistence.save({ tenant_id: tenantId, run_id: stored.run_id, record: clone(stored) });
        return clone(stored);
      });
    },

    async read({ tenant_id, run_id }) {
      const tenantId = requireTenant(tenant_id);
      const runId = requireIdentifier(run_id, "run_id");
      return clone(tenantRecords(tenantId).get(runId) || await loadPersisted(tenantId, runId));
    },

    async list({ tenant_id, limit = 100 }) {
      const tenantId = requireTenant(tenant_id);
      const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
      let rows = [...tenantRecords(tenantId).values()];
      if (persistence) {
        const persisted = await persistence.list({ tenant_id: tenantId, limit: boundedLimit });
        if (!Array.isArray(persisted)) throw new Error("telemetry_adapter_list_invalid");
        for (const row of persisted) {
          const normalized = normalizePersisted(row, tenantId);
          tenantRecords(tenantId).set(normalized.run_id, normalized);
        }
        rows = [...tenantRecords(tenantId).values()];
      }
      return clone(rows.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)).slice(-boundedLimit));
    },
  };
}

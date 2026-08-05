import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "nyra_reliability_layer_v1";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/iu;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SOURCE_TYPES = new Set(["chat", "web", "email", "document", "mcp", "ocr", "api", "browser", "tool", "unknown"]);
const DATA_LABELS = new Set(["public", "internal", "personal_data", "sensitive", "secret", "tool_output", "web", "email", "document", "chat", "untrusted"]);
const ACTION_TYPES = new Set(["read", "write", "navigate", "click", "fill", "submit", "publish", "deploy", "delete", "payment", "external_message", "other"]);
const BROWSER_ACTIONS = new Set(["navigate", "read", "click", "fill", "select", "submit"]);
const MAX_CONTENT_BYTES = 250_000;
const MAX_CHECKPOINT_BYTES = 250_000;
const MAX_RECORDS = 10_000;

const INJECTION_RULES = Object.freeze([
  ["role_override", /\b(?:system|developer|assistant)\s+(?:message|instruction|prompt)\b/iu],
  ["instruction_override", /\b(?:ignore|disregard|forget|override)\b.{0,80}\b(?:previous|earlier|above|prior)\b/iu],
  ["privilege_escalation", /\b(?:reveal|show|print|export|exfiltrate)\b.{0,100}\b(?:secret|token|password|api[_ -]?key|credential)\b/iu],
  ["tool_authorization_request", /\b(?:call|invoke|run|execute|use)\b.{0,80}\b(?:tool|function|mcp|browser|shell)\b/iu],
  ["safety_bypass", /\b(?:bypass|disable|turn off|ignore)\b.{0,80}\b(?:safety|policy|guard|airlock|approval|authorization)\b/iu],
  ["fake_authority", /\b(?:approved|authorized|owner|admin|root)\b.{0,60}\b(?:therefore|so|now)\b/iu],
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonical(value[key]);
    return result;
  }, {});
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function requireText(value, field, max = 160) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${field}_invalid`);
  }
  return normalized;
}

function optionalText(value, field, max = 160) {
  if (value === undefined || value === null || value === "") return null;
  return requireText(value, field, max);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field}_invalid`);
  return value;
}

function boundedArray(value, field, maximum, mapper = (item) => item) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${field}_invalid`);
  return value.map(mapper);
}

function uniqueTexts(value, field, maximum, maxText = 160) {
  const values = boundedArray(value || [], field, maximum, (item) => requireText(item, field, maxText));
  if (new Set(values).size !== values.length) throw new Error(`${field}_duplicate`);
  return values;
}

function validDigest(value, field) {
  const normalized = requireText(value, field, 80).toLowerCase();
  if (!DIGEST_PATTERN.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function parseFuture(value, field, nowMs, maxFutureMs = 300_000) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed) || parsed <= nowMs || parsed > nowMs + maxFutureMs) throw new Error(`${field}_invalid`);
  return new Date(parsed).toISOString();
}

function digestMatches(actual, expected) {
  const left = String(actual || "");
  const right = String(expected || "");
  return left.length === right.length && DIGEST_PATTERN.test(left) && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function safeJsonSize(value, field, maximum) {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maximum) throw new Error(`${field}_too_large`);
  return clone(value);
}

function normalizedScope(input = {}) {
  const source = object(input, "scope");
  return {
    tenant_id: requireText(source.tenant_id, "tenant_id", 120),
    project_id: requireText(source.project_id, "project_id", 160),
    work_id: requireText(source.work_id, "work_id", 160),
    session_id: requireText(source.session_id, "session_id", 160),
  };
}

function errorCode(error, fallback) {
  return String(error?.message || fallback).slice(0, 200);
}

function queueLock(lockMap, key, work) {
  const previous = lockMap.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  let cleanup;
  cleanup = current.then(() => {}, () => {}).then(() => {
    if (lockMap.get(key) === cleanup) lockMap.delete(key);
  });
  lockMap.set(key, cleanup);
  return current;
}

function recordKey(tenantId, type, id) {
  return `${tenantId}\u0000${type}\u0000${id}`;
}

function hashPath(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function makeStoreApi({ readRecord, writeRecord, listRecords, lockMap = new Map() }) {
  return {
    kind: "memory",
    restart_durable: false,
    distributed: false,
    async read({ tenant_id, record_type, record_id }) {
      return clone(await readRecord(tenant_id, record_type, record_id));
    },
    async list({ tenant_id, record_type }) {
      return clone(await listRecords(tenant_id, record_type));
    },
    async atomic({ tenant_id, record_type, record_id, mutate }) {
      requireText(tenant_id, "tenant_id", 120);
      requireText(record_type, "record_type", 80);
      requireText(record_id, "record_id", 240);
      if (typeof mutate !== "function") throw new Error("reliability_mutator_invalid");
      return queueLock(lockMap, recordKey(tenant_id, record_type, record_id), async () => {
        const current = clone(await readRecord(tenant_id, record_type, record_id));
        const mutation = await mutate(current);
        if (!mutation || typeof mutation !== "object" || Array.isArray(mutation)) throw new Error("reliability_mutation_invalid");
        if (mutation.write !== false) await writeRecord(tenant_id, record_type, record_id, mutation.record ?? null);
        return clone(mutation.result);
      });
    },
  };
}

export function createMemoryNyraReliabilityStore({ now = () => new Date().toISOString() } = {}) {
  const records = new Map();
  return makeStoreApi({
    lockMap: new Map(),
    async readRecord(tenantId, type, id) { return records.get(recordKey(tenantId, type, id)) || null; },
    async writeRecord(tenantId, type, id, value) {
      const key = recordKey(tenantId, type, id);
      if (value === null) records.delete(key);
      else records.set(key, { ...clone(value), updated_at: now() });
    },
    async listRecords(tenantId, type) {
      return [...records.entries()]
        .filter(([key]) => key.startsWith(`${tenantId}\u0000${type}\u0000`))
        .map(([, value]) => clone(value));
    },
  });
}

export function createFileNyraReliabilityStore({ root, now = () => new Date().toISOString() } = {}) {
  const storageRoot = requireText(root, "reliability_store_root", 2_000);
  const lockMap = new Map();
  const fileFor = (tenantId, type, id) => path.join(storageRoot, hashPath(tenantId), hashPath(`${type}\u0000${id}`) + ".json");
  const readRecord = async (tenantId, type, id) => {
    const file = fileFor(tenantId, type, id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  };
  const writeRecord = async (tenantId, type, id, value) => {
    const file = fileFor(tenantId, type, id);
    if (value === null) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ ...value, updated_at: now() }), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  };
  const listRecords = async (tenantId, type) => {
    const directory = path.join(storageRoot, hashPath(tenantId));
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try { return JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")); } catch { return null; }
      })
      .filter((value) => value?.record_type === type && value.tenant_id === tenantId);
  };
  const api = makeStoreApi({ readRecord, writeRecord, listRecords, lockMap });
  api.kind = "file";
  api.restart_durable = true;
  api.distributed = false;
  return api;
}

export function createPostgresNyraReliabilityStore({ pool, connectionString, now = () => new Date().toISOString() } = {}) {
  const db = pool || (connectionString ? new (requirePgPool())({ connectionString }) : null);
  if (!db || typeof db.query !== "function") throw new Error("reliability_postgres_store_unavailable");
  let initialized = false;
  let initialization;
  const init = async () => {
    if (initialized) return;
    initialization ||= db.query(`
      CREATE TABLE IF NOT EXISTS nyra_reliability_state (
        tenant_id TEXT NOT NULL,
        record_type TEXT NOT NULL,
        record_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, record_type, record_id)
      )
    `).then(() => { initialized = true; });
    await initialization;
  };
  const api = {
    kind: "postgresql",
    restart_durable: true,
    distributed: true,
    async read({ tenant_id, record_type, record_id }) {
      await init();
      const result = await db.query("SELECT payload FROM nyra_reliability_state WHERE tenant_id=$1 AND record_type=$2 AND record_id=$3", [tenant_id, record_type, record_id]);
      return result.rows[0]?.payload || null;
    },
    async list({ tenant_id, record_type }) {
      await init();
      const result = await db.query("SELECT payload FROM nyra_reliability_state WHERE tenant_id=$1 AND record_type=$2 ORDER BY updated_at ASC", [tenant_id, record_type]);
      return result.rows.map((row) => row.payload);
    },
    async atomic({ tenant_id, record_type, record_id, mutate }) {
      requireText(tenant_id, "tenant_id", 120);
      requireText(record_type, "record_type", 80);
      requireText(record_id, "record_id", 240);
      await init();
      const client = typeof db.connect === "function" ? await db.connect() : db;
      const release = client !== db ? () => client.release() : () => {};
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${tenant_id}\u0000${record_type}\u0000${record_id}`]);
        const selected = await client.query("SELECT payload FROM nyra_reliability_state WHERE tenant_id=$1 AND record_type=$2 AND record_id=$3 FOR UPDATE", [tenant_id, record_type, record_id]);
        const current = selected.rows[0]?.payload || null;
        const mutation = await mutate(clone(current));
        if (!mutation || typeof mutation !== "object" || Array.isArray(mutation)) throw new Error("reliability_mutation_invalid");
        if (mutation.write !== false) {
          if (mutation.record === null) {
            await client.query("DELETE FROM nyra_reliability_state WHERE tenant_id=$1 AND record_type=$2 AND record_id=$3", [tenant_id, record_type, record_id]);
          } else {
            await client.query(`
              INSERT INTO nyra_reliability_state (tenant_id, record_type, record_id, payload, updated_at)
              VALUES ($1,$2,$3,$4::jsonb,$5)
              ON CONFLICT (tenant_id, record_type, record_id)
              DO UPDATE SET payload=EXCLUDED.payload, updated_at=EXCLUDED.updated_at
            `, [tenant_id, record_type, record_id, JSON.stringify(mutation.record), now()]);
          }
        }
        await client.query("COMMIT");
        return clone(mutation.result);
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw error;
      } finally { release(); }
    },
  };
  return api;
}

// Dynamic import is intentionally avoided at module evaluation time so file
// and memory tests do not need to initialize a database driver.
function requirePgPool() {
  throw new Error("reliability_postgres_pool_required");
}

function normalizeDataLabels(value) {
  const labels = uniqueTexts(value || [], "data_labels", 16, 32).map((label) => label.toLowerCase());
  if (labels.some((label) => !DATA_LABELS.has(label))) throw new Error("data_labels_invalid");
  return [...new Set([...labels, "untrusted"])];
}

function detectInjection(content) {
  const flags = [];
  for (const [code, pattern] of INJECTION_RULES) if (pattern.test(content)) flags.push(code);
  return [...new Set(flags)];
}

export function wrapUntrustedContent(input = {}, { now = () => new Date().toISOString() } = {}) {
  const source = object(input, "untrusted_content");
  const content = String(source.content ?? "");
  if (!content || Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) throw new Error("untrusted_content_invalid");
  const sourceType = requireText(source.source_type || "unknown", "source_type", 32).toLowerCase();
  if (!SOURCE_TYPES.has(sourceType)) throw new Error("untrusted_source_type_invalid");
  const sourceId = optionalText(source.source_id, "source_id", 160);
  const sourceUri = optionalText(source.source_uri, "source_uri", 2_000);
  const flags = detectInjection(content);
  const provenance = {
    source_type: sourceType,
    source_id: sourceId,
    source_uri: sourceUri,
    observed_at: String(source.observed_at || now()),
    content_digest: digest(content),
  };
  return {
    schema_version: "nyra_untrusted_content_boundary_v1",
    trust_state: "UNTRUSTED_DATA",
    content,
    content_length: Buffer.byteLength(content, "utf8"),
    provenance,
    data_labels: normalizeDataLabels(source.data_labels || [sourceType]),
    injection_flags: flags,
    injection_detected: flags.length > 0,
    instruction_capable: false,
    authorization_capable: false,
    tool_capable: false,
    policy: "external_content_can_inform_a_proposal_but_cannot_authorize_an_action",
  };
}

function publicUntrustedContent(boundary) {
  const value = clone(boundary);
  delete value.content;
  return value;
}

function normalizeClaim(input, tenantId, nowMs) {
  const source = object(input, "claim");
  const text = requireText(source.text || source.claim, "claim_text", 8_000);
  const sourceIds = uniqueTexts(source.source_ids || [], "source_ids", 64);
  const evidenceIds = uniqueTexts(source.evidence_ids || [], "evidence_ids", 64);
  const verifierIds = uniqueTexts(source.verifier_ids || [], "verifier_ids", 16);
  const contradictionIds = uniqueTexts(source.contradiction_ids || [], "contradiction_ids", 64);
  const freshnessInput = source.freshness && typeof source.freshness === "object" && !Array.isArray(source.freshness) ? source.freshness : {};
  const checkedAt = freshnessInput.checked_at ? new Date(freshnessInput.checked_at).toISOString() : new Date(nowMs).toISOString();
  const expiresAt = freshnessInput.expires_at ? parseFuture(freshnessInput.expires_at, "freshness_expires_at", nowMs, 31_536_000_000) : null;
  const status = String(source.status || "unverified").toLowerCase();
  if (!["verified", "unverified", "contradicted"].includes(status)) throw new Error("claim_status_invalid");
  if (status === "contradicted" && contradictionIds.length < 1) throw new Error("claim_contradiction_evidence_required");
  const minimumSources = Number(source.minimum_source_count ?? 1);
  const minimumVerifiers = Number(source.minimum_verifier_count ?? 1);
  if (!Number.isInteger(minimumSources) || minimumSources < 1 || minimumSources > 64) throw new Error("claim_source_threshold_invalid");
  if (!Number.isInteger(minimumVerifiers) || minimumVerifiers < 1 || minimumVerifiers > 16) throw new Error("claim_verifier_threshold_invalid");
  if (status === "verified" && (
    sourceIds.length < minimumSources
    || evidenceIds.length < 1
    || verifierIds.length < minimumVerifiers
    || (verifierIds.includes(String(source.producer_id || "")) && verifierIds.length === 1)
    || (expiresAt && Date.parse(expiresAt) <= nowMs)
    || contradictionIds.length > 0
  )) throw new Error("claim_verification_threshold_not_met");
  return {
    schema_version: "nyra_claim_ledger_entry_v1",
    claim_id: source.claim_id ? requireText(source.claim_id, "claim_id", 160) : `claim_${crypto.randomUUID()}`,
    tenant_id: tenantId,
    project_id: optionalText(source.project_id, "project_id", 160),
    work_id: optionalText(source.work_id, "work_id", 160),
    session_id: optionalText(source.session_id, "session_id", 160),
    producer_id: optionalText(source.producer_id, "producer_id", 160),
    text,
    source_ids: sourceIds,
    evidence_ids: evidenceIds,
    freshness: { checked_at: checkedAt, expires_at: expiresAt },
    status,
    verifier_ids: verifierIds,
    contradiction_ids: contradictionIds,
    thresholds: { minimum_source_count: minimumSources, minimum_verifier_count: minimumVerifiers },
    created_at: new Date(nowMs).toISOString(),
  };
}

function claimPayload(entry) {
  const { claim_digest: _digest, revision: _revision, updated_at: _updatedAt, record_type: _recordType, ...payload } = entry;
  return payload;
}

function evaluateClaimEntries(claims, { minimumVerifiedRatio = 1 } = {}) {
  if (!Array.isArray(claims) || claims.length > 1_000) throw new Error("claims_invalid");
  const normalizedRatio = Number(minimumVerifiedRatio);
  if (!Number.isFinite(normalizedRatio) || normalizedRatio < 0 || normalizedRatio > 1) throw new Error("minimum_verified_ratio_invalid");
  const counts = { verified: 0, unverified: 0, contradicted: 0 };
  for (const claim of claims) {
    const status = String(claim?.status || "unverified");
    if (!Object.hasOwn(counts, status)) throw new Error("claim_status_invalid");
    counts[status] += 1;
  }
  const ratio = claims.length ? counts.verified / claims.length : 0;
  const decision = claims.length > 0 && counts.contradicted === 0 && ratio >= normalizedRatio
    ? "verified"
    : claims.some((claim) => claim.status === "contradicted") ? "blocked_contradiction" : "abstain_insufficient_evidence";
  return {
    schema_version: "nyra_claim_ledger_evaluation_v1",
    decision,
    counts,
    total: claims.length,
    verified_ratio: ratio,
    minimum_verified_ratio: normalizedRatio,
    execution_authorized: false,
    response_policy: decision === "verified" ? "answer_with_bound_evidence" : "abstain_or_request_more_evidence",
  };
}

function normalizeActionPayload(input, tenantId, nowMs) {
  const source = object(input, "action_envelope");
  if (source.execution_enabled === true || source.provider_execution === true || source.execution_authorized === true) throw new Error("execution_disabled");
  const tool = source.tool && typeof source.tool === "object" && !Array.isArray(source.tool) ? source.tool : {};
  const actionType = requireText(source.action || source.action_type, "action", 120).toLowerCase();
  const payload = {
    schema_version: "nyra_action_authorization_envelope_v1",
    tenant_id: tenantId,
    project_id: requireText(source.project_id, "project_id", 160),
    work_id: requireText(source.work_id, "work_id", 160),
    session_id: requireText(source.session_id, "session_id", 160),
    principal: requireText(source.principal, "principal", 160),
    tool_id: requireText(source.tool_id || tool.id, "tool_id", 160),
    tool_digest: validDigest(source.tool_digest || tool.digest, "tool_digest"),
    action: actionType,
    resource: typeof source.resource === "object" ? safeJsonSize(source.resource, "resource", 4_000) : requireText(source.resource, "resource", 1_000),
    audience: requireText(source.audience, "audience", 500),
    parameter_hash: validDigest(source.parameter_hash, "parameter_hash"),
    egress_destinations: uniqueTexts(source.egress_destinations || source.egress || [], "egress_destinations", 32, 1_000),
    data_labels: normalizeDataLabels(source.data_labels || []),
    parent_action_id: optionalText(source.parent_action_id, "parent_action_id", 160),
    expires_at: source.expires_at ? parseFuture(source.expires_at, "expires_at", nowMs) : new Date(nowMs + Math.min(300_000, Math.max(1_000, Number(source.ttl_ms || 60_000)))).toISOString(),
    nonce: source.nonce ? requireText(source.nonce, "nonce", 160) : `nonce_${crypto.randomUUID()}`,
  };
  if (!ACTION_TYPES.has(payload.action)) throw new Error("action_invalid");
  return payload;
}

function actionDigest(payload) { return digest(payload); }

function normalizeCondition(value, field) {
  const source = object(value, field);
  return {
    id: requireText(source.id, `${field}_id`, 160),
    description: requireText(source.description, `${field}_description`, 2_000),
    expected_digest: source.expected_digest ? validDigest(source.expected_digest, `${field}_expected_digest`) : null,
  };
}

function normalizeEvidence(value) {
  const entries = boundedArray(value, "observed_evidence", 128, (item) => {
    const source = object(item, "observed_evidence_item");
    return {
      evidence_id: requireText(source.evidence_id, "evidence_id", 160),
      evidence_digest: validDigest(source.evidence_digest, "evidence_digest"),
      source: optionalText(source.source, "evidence_source", 500),
    };
  });
  return entries;
}

function completionPayload(record) {
  const {
    completion_digest: _digest,
    status: _status,
    verification_attempts: _attempts,
    verified_by: _verifiedBy,
    observed_evidence_digest: _observedEvidenceDigest,
    completion_receipt: _completionReceipt,
    finalized_at: _finalizedAt,
    updated_at: _updatedAt,
    record_type: _recordType,
    ...payload
  } = record;
  return payload;
}

function defaultBudget() {
  return { max_calls: 64, max_tokens: 1_000_000, max_time_ms: 300_000, max_cost_micros: 1_000_000 };
}

function normalizeBudget(value, field = "budget") {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const defaults = defaultBudget();
  const result = {};
  for (const key of Object.keys(defaults)) {
    const amount = source[key] === undefined ? defaults[key] : Number(source[key]);
    if (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000_000) throw new Error(`${field}_${key}_invalid`);
    result[key] = amount;
  }
  return result;
}

function normalizeUsage(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of ["calls", "tokens", "time_ms", "cost_micros"]) {
    const amount = source[key] === undefined ? (key === "calls" ? 1 : 0) : Number(source[key]);
    if (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000_000) throw new Error(`usage_${key}_invalid`);
    result[key] = amount;
  }
  if (result.calls < 1) throw new Error("usage_calls_invalid");
  return result;
}

function budgetExceeded(current, limits) {
  return Number(current.calls || 0) > Number(limits.max_calls)
    || Number(current.tokens || 0) > Number(limits.max_tokens)
    || Number(current.time_ms || 0) > Number(limits.max_time_ms)
    || Number(current.cost_micros || 0) > Number(limits.max_cost_micros);
}

function mergeBudgetLimits(current, requested) {
  const output = {};
  for (const key of ["max_calls", "max_tokens", "max_time_ms", "max_cost_micros"]) {
    output[key] = current?.[key] === undefined ? requested[key] : Math.min(Number(current[key]), Number(requested[key]));
  }
  return output;
}

function budgetScopeKeys({ tenantId, projectId, workId, agentId, toolId }) {
  return [
    ["tenant", `tenant:${tenantId}`],
    ["work", `work:${projectId}:${workId}`],
    ["agent", `agent:${projectId}:${workId}:${agentId}`],
    ["tool", `tool:${projectId}:${workId}:${agentId}:${toolId}`],
  ];
}

function normalizeOrigin(value, field) {
  let parsed;
  try { parsed = new URL(requireText(value, field, 2_000)); } catch { throw new Error(`${field}_invalid`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error(`${field}_invalid`);
  return parsed.origin;
}

function normalizeBrowserContract(input, tenantId, nowMs) {
  const source = object(input, "browser_contract");
  const actions = uniqueTexts(source.allowed_actions || [source.action], "allowed_actions", 16, 64).map((value) => value.toLowerCase());
  if (actions.some((value) => !BROWSER_ACTIONS.has(value))) throw new Error("allowed_actions_invalid");
  const origins = boundedArray(source.allowed_origins, "allowed_origins", 32, (value) => normalizeOrigin(value, "allowed_origin"));
  if (new Set(origins).size !== origins.length || origins.length < 1) throw new Error("allowed_origins_invalid");
  const postconditions = boundedArray(source.postconditions, "postconditions", 32, (value) => normalizeCondition(value, "postcondition"));
  if (postconditions.length < 1) throw new Error("browser_postconditions_required");
  return {
    schema_version: "nyra_browser_execution_contract_v1",
    contract_id: `browser_${crypto.randomUUID()}`,
    tenant_id: tenantId,
    project_id: requireText(source.project_id, "project_id", 160),
    work_id: requireText(source.work_id, "work_id", 160),
    session_id: requireText(source.session_id, "session_id", 160),
    principal: requireText(source.principal, "principal", 160),
    allowed_origins: origins,
    allowed_actions: actions,
    parameter_hash: validDigest(source.parameter_hash, "parameter_hash"),
    precondition_digest: validDigest(source.precondition_digest, "precondition_digest"),
    postconditions,
    expires_at: source.expires_at ? parseFuture(source.expires_at, "expires_at", nowMs) : new Date(nowMs + 120_000).toISOString(),
    allow_credentials: false,
    allow_cross_origin: false,
    execution_enabled: false,
    execution_authorized: false,
  };
}

function contractDigest(contract) {
  const { contract_digest: _digest, state: _state, phases: _phases, updated_at: _updatedAt, record_type: _recordType, ...payload } = contract;
  return digest(payload);
}

function envelopePayload(envelope) {
  const {
    signature: _signature,
    signature_scheme: _scheme,
    record_type: _recordType,
    payload_digest: _payloadDigest,
    updated_at: _updatedAt,
    state: _state,
    authorization_state: _authorizationState,
    consumed_at: _consumedAt,
    ...payload
  } = envelope;
  return payload;
}

function signEnvelope(secret, envelope) {
  if (!secret || Buffer.byteLength(String(secret), "utf8") < 32) throw new Error("reliability_signing_unavailable");
  const signature = crypto.createHmac("sha256", String(secret))
    .update(JSON.stringify(canonical(envelopePayload(envelope))))
    .digest("hex");
  return { ...envelope, signature, signature_scheme: "hmac-sha256-reliability-v1" };
}

function verifyEnvelopeSignature(secret, envelope) {
  if (!secret || !envelope || envelope.signature_scheme !== "hmac-sha256-reliability-v1") return false;
  const supplied = String(envelope.signature || "");
  if (!/^[a-f0-9]{64}$/u.test(supplied)) return false;
  const expected = crypto.createHmac("sha256", String(secret))
    .update(JSON.stringify(canonical(envelopePayload(envelope))))
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}

export function createNyraReliabilityRuntime({ store, now = () => new Date().toISOString(), idFactory = () => crypto.randomUUID(), signingSecret = "" } = {}) {
  if (!store || typeof store.atomic !== "function") throw new Error("reliability_store_required");
  const nowMs = () => Date.parse(String(now())) || Date.now();
  const publicRuntimeStatus = () => ({
    schema_version: SCHEMA_VERSION,
    state_backend: store.kind,
    restart_durable: store.restart_durable === true,
    distributed: store.distributed === true,
    fail_closed: true,
    execution_enabled: false,
    execution_authorized: false,
    capabilities: {
      claim_ledger: true,
      untrusted_content_boundary: true,
      action_authorization_envelope: true,
      handoff_envelope: true,
      verified_completion: true,
      continuity_replay_capsule: true,
      budget_governor: true,
      browser_execution_contract: true,
      chat_preflight: true,
    },
  });

  async function appendClaim(input = {}) {
    const tenantId = requireText(input.tenant_id, "tenant_id", 120);
    const entry = normalizeClaim(input, tenantId, nowMs());
    const entryDigest = digest(claimPayload(entry));
    entry.claim_digest = entryDigest;
    const result = await store.atomic({ tenant_id: tenantId, record_type: "claim", record_id: entry.claim_id, mutate: (current) => {
      if (current) {
        if (current.tenant_id !== tenantId) throw new Error("cross_tenant_claim_denied");
        if (digestMatches(current.claim_digest, entryDigest)) return { write: false, result: { ...clone(current), idempotent: true } };
        throw new Error("claim_id_conflict");
      }
      return { record: { ...entry, tenant_id: tenantId, record_type: "claim", revision: 1 }, result: { ...entry, idempotent: false } };
    }});
    return result;
  }

  async function verifyClaim({ tenant_id, claim_id, verifier_id, evidence_ids, source_ids, freshness } = {}) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const claimId = requireText(claim_id, "claim_id", 160);
    const result = await store.atomic({ tenant_id: tenantId, record_type: "claim", record_id: claimId, mutate: (current) => {
      if (!current) throw new Error("claim_not_found");
      if (current.tenant_id !== tenantId) throw new Error("cross_tenant_claim_denied");
      if (current.status === "contradicted") throw new Error("claim_contradicted");
      const next = {
        ...current,
        status: "verified",
        source_ids: source_ids ? uniqueTexts(source_ids, "source_ids", 64) : current.source_ids,
        evidence_ids: evidence_ids ? uniqueTexts(evidence_ids, "evidence_ids", 64) : current.evidence_ids,
        verifier_ids: [...new Set([...current.verifier_ids, requireText(verifier_id, "verifier_id", 160)])],
        freshness: freshness ? normalizeClaim({ text: current.text, source_ids: current.source_ids, evidence_ids: current.evidence_ids, verifier_ids: current.verifier_ids, freshness }, tenantId, nowMs()).freshness : current.freshness,
      };
      const checked = normalizeClaim(next, tenantId, nowMs());
      const updated = { ...current, ...checked, status: "verified", revision: Number(current.revision || 1) + 1 };
      updated.claim_digest = digest(claimPayload(updated));
      return { record: { ...updated, record_type: "claim" }, result: clone(updated) };
    }});
    return result;
  }

  async function getClaim({ tenant_id, claim_id }) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const claimId = requireText(claim_id, "claim_id", 160);
    const record = await store.read({ tenant_id: tenantId, record_type: "claim", record_id: claimId });
    if (!record) throw new Error("claim_not_found");
    if (record.tenant_id !== tenantId) throw new Error("cross_tenant_claim_denied");
    if (!digestMatches(record.claim_digest, digest(claimPayload(record)))) throw new Error("claim_digest_invalid");
    return record;
  }

  async function evaluateClaims({ tenant_id, claims, minimum_verified_ratio = 1 } = {}) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const input = boundedArray(claims, "claims", 1_000, (claim) => object(claim, "claim"));
    for (const claim of input) if (claim.tenant_id && claim.tenant_id !== tenantId) throw new Error("cross_tenant_claim_denied");
    return { tenant_id: tenantId, evaluation: evaluateClaimEntries(input, { minimumVerifiedRatio }) };
  }

  async function issueActionEnvelope(input = {}) {
    const tenantId = requireText(input.tenant_id, "tenant_id", 120);
    const payload = normalizeActionPayload(input, tenantId, nowMs());
    const envelope = {
      ...payload,
      envelope_id: `aen_${idFactory()}`,
      issued_at: new Date(nowMs()).toISOString(),
      state: "issued",
      authorization_state: "proposal_only",
      execution_enabled: false,
      execution_authorized: false,
    };
    envelope.envelope_digest = actionDigest(payload);
    const signedEnvelope = signEnvelope(signingSecret, envelope);
    return store.atomic({ tenant_id: tenantId, record_type: "action_envelope", record_id: envelope.envelope_id, mutate: (current) => {
      if (current) throw new Error("action_envelope_id_conflict");
      return { record: { ...signedEnvelope, record_type: "action_envelope", payload_digest: envelope.envelope_digest }, result: clone(signedEnvelope) };
    }});
  }

  async function consumeActionEnvelope({ tenant_id, envelope } = {}) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const candidate = object(envelope, "action_envelope");
    const envelopeId = requireText(candidate.envelope_id, "envelope_id", 160);
    return store.atomic({ tenant_id: tenantId, record_type: "action_envelope", record_id: envelopeId, mutate: (current) => {
      if (!current) throw new Error("action_envelope_not_found");
      if (current.tenant_id !== tenantId) throw new Error("cross_tenant_action_envelope_denied");
      if (!verifyEnvelopeSignature(signingSecret, current)) throw new Error("action_envelope_signature_invalid");
      const payload = { ...candidate };
      for (const key of ["envelope_id", "issued_at", "state", "authorization_state", "execution_enabled", "execution_authorized", "envelope_digest", "record_type", "payload_digest", "signature", "signature_scheme", "updated_at"]) delete payload[key];
      const candidateDigest = actionDigest(payload);
      if (!digestMatches(candidateDigest, current.payload_digest) || !digestMatches(candidate.envelope_digest, current.envelope_digest)) throw new Error("action_envelope_tampered");
      if (!verifyEnvelopeSignature(signingSecret, candidate)) throw new Error("action_envelope_signature_invalid");
      if (current.state === "consumed") throw new Error("action_envelope_replayed");
      if (Date.parse(current.expires_at) <= nowMs()) throw new Error("action_envelope_expired");
      const next = { ...current, state: "consumed", consumed_at: new Date(nowMs()).toISOString(), record_type: "action_envelope" };
      return { record: next, result: {
        ok: true,
        envelope_id: current.envelope_id,
        state: "consumed",
        action: current.action,
        execution_enabled: false,
        execution_authorized: false,
        side_effect_performed: false,
      } };
    }});
  }

  async function issueHandoffEnvelope(input = {}) {
    const tenantId = requireText(input.tenant_id, "tenant_id", 120);
    const scope = normalizedScope(input);
    if (scope.tenant_id !== tenantId) throw new Error("handoff_scope_tenant_mismatch");
    const fromAgentId = requireText(input.from_agent_id || input.agent_id, "from_agent_id", 160);
    const toAgentId = requireText(input.to_agent_id, "to_agent_id", 160);
    if (fromAgentId === toAgentId) throw new Error("handoff_independent_agent_required");
    const allowedTools = uniqueTexts(input.allowed_tools || [], "allowed_tools", 64, 160);
    const claims = uniqueTexts(input.claim_ids || [], "claim_ids", 128, 160);
    const evidence = uniqueTexts(input.evidence_ids || [], "evidence_ids", 128, 160);
    const expiresAt = input.expires_at
      ? parseFuture(input.expires_at, "handoff_expires_at", nowMs(), 900_000)
      : new Date(nowMs() + 300_000).toISOString();
    const payload = {
      schema_version: "nyra_handoff_envelope_v1",
      envelope_id: `handoff_${idFactory()}`,
      ...scope,
      from_agent_id: fromAgentId,
      to_agent_id: toAgentId,
      branch_id: requireText(input.branch_id, "branch_id", 160),
      branch_owner_id: requireText(input.branch_owner_id, "branch_owner_id", 160),
      lease_id: requireText(input.lease_id, "lease_id", 160),
      scope_digest: validDigest(input.scope_digest, "scope_digest"),
      drift_digest: validDigest(input.drift_digest, "drift_digest"),
      purpose_digest: validDigest(input.purpose_digest, "purpose_digest"),
      claim_ids: claims,
      evidence_ids: evidence,
      allowed_tools: allowedTools,
      budget_digest: validDigest(input.budget_digest, "budget_digest"),
      nonce: input.nonce ? requireText(input.nonce, "handoff_nonce", 160) : `nonce_${idFactory()}`,
      issued_at: new Date(nowMs()).toISOString(),
      expires_at: expiresAt,
      state: "issued",
      execution_enabled: false,
      execution_authorized: false,
    };
    const envelope = signEnvelope(signingSecret, payload);
    return store.atomic({ tenant_id: tenantId, record_type: "handoff_envelope", record_id: envelope.envelope_id, mutate: (current) => {
      if (current) throw new Error("handoff_envelope_id_conflict");
      return { record: { ...envelope, record_type: "handoff_envelope" }, result: clone(envelope) };
    }});
  }

  async function consumeHandoffEnvelope({ tenant_id, envelope, receiver_agent_id } = {}) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const candidate = object(envelope, "handoff_envelope");
    const envelopeId = requireText(candidate.envelope_id, "handoff_envelope_id", 160);
    const receiver = requireText(receiver_agent_id, "receiver_agent_id", 160);
    return store.atomic({ tenant_id: tenantId, record_type: "handoff_envelope", record_id: envelopeId, mutate: (current) => {
      if (!current) throw new Error("handoff_envelope_not_found");
      if (current.tenant_id !== tenantId) throw new Error("cross_tenant_handoff_denied");
      if (!verifyEnvelopeSignature(signingSecret, current) || !verifyEnvelopeSignature(signingSecret, candidate)) throw new Error("handoff_envelope_signature_invalid");
      if (!digestMatches(digest(envelopePayload(candidate)), digest(envelopePayload(current)))) throw new Error("handoff_envelope_tampered");
      if (current.to_agent_id !== receiver) throw new Error("handoff_receiver_mismatch");
      if (current.state === "consumed") throw new Error("handoff_envelope_replayed");
      if (Date.parse(current.expires_at) <= nowMs()) throw new Error("handoff_envelope_expired");
      const next = { ...current, state: "consumed", consumed_at: new Date(nowMs()).toISOString(), record_type: "handoff_envelope" };
      return { record: next, result: { ok: true, envelope_id: current.envelope_id, state: next.state, from_agent_id: current.from_agent_id, to_agent_id: current.to_agent_id, execution_enabled: false, execution_authorized: false } };
    }});
  }

  async function registerCompletion(input = {}) {
    const tenantId = requireText(input.tenant_id, "tenant_id", 120);
    const producerId = requireText(input.producer_id || input.principal, "producer_id", 160);
    const preconditions = boundedArray(input.preconditions || [], "preconditions", 64, (value) => normalizeCondition(value, "precondition"));
    const postconditions = boundedArray(input.postconditions, "postconditions", 64, (value) => normalizeCondition(value, "postcondition"));
    if (postconditions.length < 1) throw new Error("postconditions_required");
    const completion = {
      schema_version: "nyra_verified_completion_v1",
      completion_id: input.completion_id ? requireText(input.completion_id, "completion_id", 160) : `completion_${idFactory()}`,
      tenant_id: tenantId,
      project_id: optionalText(input.project_id, "project_id", 160),
      work_id: requireText(input.work_id, "work_id", 160),
      session_id: requireText(input.session_id, "session_id", 160),
      producer_id: producerId,
      preconditions,
      postconditions,
      result_digest: validDigest(input.result_digest, "result_digest"),
      status: "pending_verification",
      verification_attempts: [],
      created_at: new Date(nowMs()).toISOString(),
      execution_enabled: false,
      execution_authorized: false,
    };
    completion.completion_digest = digest(completionPayload(completion));
    return store.atomic({ tenant_id: tenantId, record_type: "completion", record_id: completion.completion_id, mutate: (current) => {
      if (current) {
        if (digestMatches(current.completion_digest, completion.completion_digest)) return { write: false, result: { ...clone(current), idempotent: true } };
        throw new Error("completion_id_conflict");
      }
      return { record: { ...completion, record_type: "completion" }, result: { ...completion, idempotent: false } };
    }});
  }

  async function verifyCompletion({ tenant_id, completion_id, verifier_id, verifier_role = "independent_verifier", postcondition_results, observed_evidence, evidence_digest } = {}) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const verifierId = requireText(verifier_id, "verifier_id", 160);
    const evidence = normalizeEvidence(observed_evidence);
    const expectedEvidenceDigest = digest(evidence);
    if (!digestMatches(evidence_digest, expectedEvidenceDigest)) throw new Error("completion_evidence_digest_invalid");
    const results = boundedArray(postcondition_results, "postcondition_results", 64, (value) => {
      const source = object(value, "postcondition_result");
      return { id: requireText(source.id, "postcondition_result_id", 160), passed: source.passed === true, evidence_ids: uniqueTexts(source.evidence_ids || [], "postcondition_evidence_ids", 64) };
    });
    return store.atomic({ tenant_id: tenantId, record_type: "completion", record_id: requireText(completion_id, "completion_id", 160), mutate: (current) => {
      if (!current) throw new Error("completion_not_found");
      if (current.tenant_id !== tenantId) throw new Error("cross_tenant_completion_denied");
      if (!digestMatches(current.completion_digest, digest(completionPayload(current)))) throw new Error("completion_digest_invalid");
      if (current.status === "completed") throw new Error("completion_already_finalized");
      if (current.producer_id === verifierId) throw new Error("completion_independent_verifier_required");
      const requiredIds = current.postconditions.map((item) => item.id);
      if (results.length !== requiredIds.length || requiredIds.some((id) => !results.some((item) => item.id === id))) throw new Error("completion_postcondition_set_invalid");
      const passed = results.every((item) => item.passed && item.evidence_ids.length > 0);
      const attempt = { verifier_id: verifierId, verifier_role: requireText(verifier_role, "verifier_role", 120), evidence_digest: expectedEvidenceDigest, postcondition_results: results, verified_at: new Date(nowMs()).toISOString(), passed };
      const next = { ...current, verification_attempts: [...current.verification_attempts, attempt].slice(-16), status: passed ? "verified" : "rejected", verified_by: passed ? verifierId : null, observed_evidence_digest: passed ? expectedEvidenceDigest : null, record_type: "completion" };
      if (passed) next.completion_receipt = digest({ completion_id: current.completion_id, verifier_id: verifierId, evidence_digest: expectedEvidenceDigest, postconditions: requiredIds });
      return { record: next, result: {
        ok: passed,
        completion_id: current.completion_id,
        status: next.status,
        verifier_id: verifierId,
        observed_evidence_digest: expectedEvidenceDigest,
        execution_enabled: false,
        execution_authorized: false,
      } };
    }});
  }

  async function finalizeCompletion({ tenant_id, completion_id } = {}) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    return store.atomic({ tenant_id: tenantId, record_type: "completion", record_id: requireText(completion_id, "completion_id", 160), mutate: (current) => {
      if (!current) throw new Error("completion_not_found");
      if (current.tenant_id !== tenantId) throw new Error("cross_tenant_completion_denied");
      if (!digestMatches(current.completion_digest, digest(completionPayload(current)))) throw new Error("completion_digest_invalid");
      if (current.status !== "verified" || !current.completion_receipt) throw new Error("completion_postconditions_not_verified");
      const next = { ...current, status: "completed", finalized_at: new Date(nowMs()).toISOString(), record_type: "completion" };
      return { record: next, result: { ok: true, completion_id: next.completion_id, status: "completed", completion_receipt: next.completion_receipt, execution_enabled: false, execution_authorized: false } };
    }});
  }

  async function checkpoint(input = {}) {
    const scope = normalizedScope(input);
    const checkpointData = safeJsonSize(object(input.checkpoint, "checkpoint"), "checkpoint", MAX_CHECKPOINT_BYTES);
    const idempotencyKey = requireText(input.idempotency_key, "idempotency_key", 200);
    const checkpointDigest = digest({ scope, checkpoint: checkpointData, idempotency_key: idempotencyKey });
    return store.atomic({ tenant_id: scope.tenant_id, record_type: "continuity", record_id: scope.work_id, mutate: (current) => {
      const state = current || { schema_version: "nyra_continuity_replay_capsule_v1", record_type: "continuity", tenant_id: scope.tenant_id, work_id: scope.work_id, capsules: [], idempotency: {}, side_effects: {}, replay_audit: [], latest_event_digest: "genesis" };
      if (state.tenant_id !== scope.tenant_id) throw new Error("cross_tenant_continuity_denied");
      const prior = state.idempotency[idempotencyKey];
      if (prior) {
        if (prior.request_digest !== checkpointDigest) throw new Error("continuity_idempotency_key_conflict");
        return { write: false, result: { ...clone(prior.result), idempotent: true } };
      }
      const at = new Date(nowMs()).toISOString();
      const event = { event_id: `event_${idFactory()}`, event_type: "checkpoint", at, previous_event_digest: state.latest_event_digest, payload_digest: digest(checkpointData) };
      event.event_digest = digest(event);
      const capsule = { schema_version: "nyra_continuity_capsule_v1", capsule_id: `capsule_${idFactory()}`, ...scope, checkpoint: checkpointData, checkpoint_digest: digest(checkpointData), idempotency_key: idempotencyKey, event_digest: event.event_digest, previous_event_digest: event.previous_event_digest, created_at: at, execution_enabled: false, execution_authorized: false };
      capsule.capsule_digest = digest(capsule);
      const result = { ok: true, capsule: clone(capsule), event: clone(event), replay_ready: true, execution_enabled: false, execution_authorized: false, idempotent: false };
      state.capsules = [...state.capsules, capsule].slice(-200);
      state.latest_event_digest = event.event_digest;
      state.idempotency[idempotencyKey] = { request_digest: checkpointDigest, result };
      return { record: state, result };
    }});
  }

  async function replayCapsule({ tenant_id, work_id, capsule_id, side_effect_key = null, replay_event_digest = null } = {}) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const workId = requireText(work_id, "work_id", 160);
    const capsuleId = requireText(capsule_id, "capsule_id", 160);
    return store.atomic({ tenant_id: tenantId, record_type: "continuity", record_id: workId, mutate: (current) => {
      if (!current) throw new Error("continuity_work_not_found");
      if (current.tenant_id !== tenantId) throw new Error("cross_tenant_continuity_denied");
      const capsule = current.capsules.find((item) => item.capsule_id === capsuleId);
      if (!capsule) throw new Error("continuity_capsule_not_found");
      if (!digestMatches(capsule.capsule_digest, digest({ ...capsule, capsule_digest: undefined }))) throw new Error("continuity_capsule_digest_invalid");
      if (replay_event_digest && !digestMatches(replay_event_digest, capsule.event_digest)) throw new Error("continuity_replay_digest_invalid");
      const key = side_effect_key ? requireText(side_effect_key, "side_effect_key", 200) : null;
      if (key && current.side_effects[key]) {
        const audit = { replay_id: `replay_${idFactory()}`, capsule_id: capsule.capsule_id, side_effect_key: key, state: "blocked_duplicate_side_effect", at: new Date(nowMs()).toISOString() };
        current.replay_audit = [...current.replay_audit, audit].slice(-500);
        return { record: current, result: { ok: false, replay_id: audit.replay_id, state: audit.state, duplicate: true, execution_enabled: false, execution_authorized: false } };
      }
      const audit = { replay_id: `replay_${idFactory()}`, capsule_id: capsule.capsule_id, side_effect_key: key, state: "ready_for_revalidation", at: new Date(nowMs()).toISOString() };
      if (key) current.side_effects[key] = { first_replay_id: audit.replay_id, state: "reserved_not_executed" };
      current.replay_audit = [...current.replay_audit, audit].slice(-500);
      return { record: current, result: { ok: true, replay_id: audit.replay_id, state: audit.state, duplicate: false, capsule: clone(capsule), execution_enabled: false, execution_authorized: false } };
    }});
  }

  async function getContinuity({ tenant_id, work_id } = {}) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const workId = requireText(work_id, "work_id", 160);
    const record = await store.read({ tenant_id: tenantId, record_type: "continuity", record_id: workId });
    if (!record) throw new Error("continuity_work_not_found");
    if (record.tenant_id !== tenantId) throw new Error("cross_tenant_continuity_denied");
    for (const capsule of record.capsules || []) if (!digestMatches(capsule.capsule_digest, digest({ ...capsule, capsule_digest: undefined }))) throw new Error("continuity_capsule_digest_invalid");
    return { ...clone(record), execution_enabled: false, execution_authorized: false };
  }

  async function reserveBudget(input = {}) {
    const tenantId = requireText(input.tenant_id, "tenant_id", 120);
    const projectId = requireText(input.project_id, "project_id", 160);
    const workId = requireText(input.work_id, "work_id", 160);
    const agentId = requireText(input.agent_id, "agent_id", 160);
    const toolId = requireText(input.tool_id || "none", "tool_id", 160);
    const usage = normalizeUsage(input.usage);
    const requestedLimits = input.limits && typeof input.limits === "object" && !Array.isArray(input.limits) ? input.limits : {};
    const scopes = budgetScopeKeys({ tenantId, projectId, workId, agentId, toolId });
    const idempotencyKey = input.idempotency_key ? requireText(input.idempotency_key, "idempotency_key", 200) : null;
    const requestDigest = digest({ tenantId, projectId, workId, agentId, toolId, usage, requestedLimits, idempotencyKey });
    return store.atomic({ tenant_id: tenantId, record_type: "budget", record_id: "active", mutate: (current) => {
      const state = current || { schema_version: "nyra_budget_governor_v1", record_type: "budget", tenant_id: tenantId, scopes: {}, reservations: {} };
      if (state.tenant_id !== tenantId) throw new Error("cross_tenant_budget_denied");
      if (idempotencyKey && state.reservations[idempotencyKey]) {
        const prior = state.reservations[idempotencyKey];
        if (prior.request_digest !== requestDigest) throw new Error("budget_idempotency_key_conflict");
        return { write: false, result: { ...clone(prior.result), idempotent: true } };
      }
      const projected = [];
      for (const [scopeType, scopeKey] of scopes) {
        const existing = state.scopes[scopeKey] || { scope_type: scopeType, scope_key: scopeKey, limits: normalizeBudget(requestedLimits[scopeType] || requestedLimits, `limits_${scopeType}`), usage: { calls: 0, tokens: 0, time_ms: 0, cost_micros: 0 } };
        const limits = mergeBudgetLimits(existing.limits, normalizeBudget(requestedLimits[scopeType] || requestedLimits, `limits_${scopeType}`));
        const nextUsage = Object.fromEntries(Object.keys(usage).map((key) => [key, Number(existing.usage[key] || 0) + usage[key]]));
        if (budgetExceeded(nextUsage, {
          max_calls: limits.max_calls,
          max_tokens: limits.max_tokens,
          max_time_ms: limits.max_time_ms,
          max_cost_micros: limits.max_cost_micros,
        })) {
          const result = { ok: false, state: "budget_exhausted", exhausted_scope: scopeType, scope_key: scopeKey, limits, current_usage: clone(existing.usage), requested_usage: usage, deterministic_stop: true, execution_enabled: false, execution_authorized: false };
          if (idempotencyKey) state.reservations[idempotencyKey] = { request_digest: requestDigest, result };
          return { record: state, result };
        }
        projected.push({ scopeKey, value: { ...existing, limits, usage: nextUsage } });
      }
      for (const item of projected) state.scopes[item.scopeKey] = item.value;
      if (Object.keys(state.scopes).length > MAX_RECORDS) throw new Error("budget_scope_limit_exceeded");
      const result = { ok: true, state: "reserved", reservation_id: `budget_${idFactory()}`, scopes: projected.map((item) => clone(item.value)), usage, deterministic_stop: false, execution_enabled: false, execution_authorized: false };
      if (idempotencyKey) state.reservations[idempotencyKey] = { request_digest: requestDigest, result };
      return { record: state, result };
    }});
  }

  async function getBudget({ tenant_id } = {}) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const record = await store.read({ tenant_id: tenantId, record_type: "budget", record_id: "active" });
    return { tenant_id: tenantId, ...(record ? clone(record) : { schema_version: "nyra_budget_governor_v1", scopes: {}, reservations: {} }), execution_enabled: false, execution_authorized: false };
  }

  async function issueBrowserContract(input = {}) {
    const tenantId = requireText(input.tenant_id, "tenant_id", 120);
    const contract = normalizeBrowserContract(input, tenantId, nowMs());
    contract.contract_digest = contractDigest(contract);
    return store.atomic({ tenant_id: tenantId, record_type: "browser_contract", record_id: contract.contract_id, mutate: (current) => {
      if (current) throw new Error("browser_contract_id_conflict");
      return { record: { ...contract, record_type: "browser_contract", state: "issued", phases: [], contract_digest: contract.contract_digest }, result: clone(contract) };
    }});
  }

  async function observeBrowserContract({ tenant_id, contract_id, phase, observation } = {}) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const normalizedPhase = requireText(phase, "phase", 16).toLowerCase();
    if (!['pre', 'post'].includes(normalizedPhase)) throw new Error("browser_phase_invalid");
    const source = object(observation, "browser_observation");
    const origin = normalizeOrigin(source.origin, "observed_origin");
    const action = requireText(source.action, "browser_action", 64).toLowerCase();
    if (!BROWSER_ACTIONS.has(action)) throw new Error("browser_action_invalid");
    const parameterHash = validDigest(source.parameter_hash, "browser_parameter_hash");
    const domDigest = validDigest(source.dom_digest, "dom_digest");
    const screenshotDigest = validDigest(source.screenshot_digest, "screenshot_digest");
    const injectionFlags = uniqueTexts(source.injection_flags || [], "browser_injection_flags", 32, 80);
    const postconditionResults = normalizedPhase === "post"
      ? boundedArray(source.postcondition_results, "postcondition_results", 64, (item) => {
        const value = object(item, "browser_postcondition_result");
        return { id: requireText(value.id, "browser_postcondition_id", 160), passed: value.passed === true, evidence_digest: validDigest(value.evidence_digest, "browser_postcondition_evidence_digest") };
      }) : [];
    return store.atomic({ tenant_id: tenantId, record_type: "browser_contract", record_id: requireText(contract_id, "contract_id", 160), mutate: (current) => {
      if (!current) throw new Error("browser_contract_not_found");
      if (current.tenant_id !== tenantId) throw new Error("cross_tenant_browser_contract_denied");
      if (!digestMatches(current.contract_digest, contractDigest(current))) throw new Error("browser_contract_tampered");
      if (Date.parse(current.expires_at) <= nowMs()) throw new Error("browser_contract_expired");
      if (!current.allowed_origins.includes(origin)) throw new Error("browser_origin_not_allowed");
      if (!current.allowed_actions.includes(action)) throw new Error("browser_action_not_allowed");
      if (!digestMatches(current.parameter_hash, parameterHash)) throw new Error("browser_parameter_hash_mismatch");
      if (injectionFlags.length > 0) {
        const blocked = { ok: false, state: "blocked_prompt_injection", execution_enabled: false, execution_authorized: false };
        return { record: { ...current, state: "blocked", phases: [...current.phases, { phase: normalizedPhase, action, parameter_hash: parameterHash, origin, dom_digest: domDigest, screenshot_digest: screenshotDigest, injection_flags: injectionFlags, blocked: true }] }, result: blocked };
      }
      if (normalizedPhase === "pre" && current.phases.some((item) => item.phase === "pre")) throw new Error("browser_pre_observation_replayed");
      if (normalizedPhase === "post" && !current.phases.some((item) => item.phase === "pre")) throw new Error("browser_precondition_observation_required");
      if (normalizedPhase === "post" && (postconditionResults.length !== current.postconditions.length || !postconditionResults.every((item) => item.passed && current.postconditions.some((condition) => condition.id === item.id)))) {
        const blocked = { ok: false, state: "blocked_postconditions_unverified", execution_enabled: false, execution_authorized: false };
        return { record: { ...current, state: "blocked", phases: [...current.phases, { phase: normalizedPhase, action, parameter_hash: parameterHash, origin, dom_digest: domDigest, screenshot_digest: screenshotDigest, postcondition_results: postconditionResults }] }, result: blocked };
      }
      const phaseRecord = { phase: normalizedPhase, action, parameter_hash: parameterHash, origin, dom_digest: domDigest, screenshot_digest: screenshotDigest, injection_flags: [], ...(normalizedPhase === "post" ? { postcondition_results: postconditionResults } : {}) };
      const next = { ...current, phases: [...current.phases, phaseRecord], state: normalizedPhase === "post" ? "verified" : "pre_observed", record_type: "browser_contract" };
      return { record: next, result: { ok: true, state: next.state, contract_id: current.contract_id, observed_phase: normalizedPhase, execution_enabled: false, execution_authorized: false, verified: normalizedPhase === "post" } };
    }});
  }

  async function evaluateChat({ tenant_id, messages, claims = [], minimum_verified_ratio = 1 } = {}) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const normalizedMessages = boundedArray(messages, "messages", 256, (message) => {
      const source = object(message, "chat_message");
      const role = requireText(source.role || "user", "message_role", 32).toLowerCase();
      const boundary = wrapUntrustedContent({ tenant_id: tenantId, source_type: "chat", source_id: source.message_id || `message_${idFactory()}`, content: source.content, data_labels: ["chat", ...(source.data_labels || [])] }, { now });
      return { message_id: boundary.provenance.source_id, role, boundary: publicUntrustedContent(boundary) };
    });
    const normalizedClaims = [];
    for (const claim of boundedArray(claims, "claims", 1_000, (value) => object(value, "chat_claim"))) {
      if (claim.claim_id) {
        try {
          normalizedClaims.push(await getClaim({ tenant_id: tenantId, claim_id: claim.claim_id }));
        } catch {
          normalizedClaims.push({ status: "unverified" });
        }
      } else {
        normalizedClaims.push({ status: claim.status === "contradicted" ? "contradicted" : "unverified" });
      }
    }
    const claimEvaluation = evaluateClaimEntries(normalizedClaims, { minimumVerifiedRatio: minimum_verified_ratio });
    return {
      schema_version: "nyra_chat_reliability_preflight_v1",
      tenant_id: tenantId,
      messages: normalizedMessages,
      injection_detected: normalizedMessages.some((item) => item.boundary.injection_detected),
      injection_count: normalizedMessages.filter((item) => item.boundary.injection_detected).length,
      claim_gate: claimEvaluation,
      memory_policy: { external_messages_are_untrusted_data: true, automatic_memory_promotion: false },
      action_gate: { state: "proposal_only", execution_enabled: false, execution_authorized: false },
      completion_gate: { state: "independent_verification_required", execution_enabled: false, execution_authorized: false },
      budget_gate: { state: "reserve_before_model_or_tool_call", execution_enabled: false, execution_authorized: false },
      fail_closed: true,
    };
  }

  return {
    status: publicRuntimeStatus,
    wrapUntrustedContent: (input) => wrapUntrustedContent(input, { now }),
    appendClaim, verifyClaim, getClaim, evaluateClaims,
    issueActionEnvelope, consumeActionEnvelope,
    issueHandoffEnvelope, consumeHandoffEnvelope,
    registerCompletion, verifyCompletion, finalizeCompletion,
    checkpoint, replayCapsule, getContinuity,
    reserveBudget, getBudget,
    issueBrowserContract, observeBrowserContract,
    evaluateChat,
  };
}

export { canonical as nyraReliabilityCanonicalJson, digest as nyraReliabilityDigest, publicUntrustedContent };

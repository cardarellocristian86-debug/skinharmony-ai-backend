import crypto from "node:crypto";
import { redactMemoryText } from "./cloud-memory-store.js";

export const CAUSAL_CONTINUITY_SCHEMA_VERSION = "causal_continuity_foundation_v1";
export const CAUSAL_CONTINUITY_MIGRATION_ID = "20260810_causal_continuity_foundation_v1";
export const CAUSAL_CONTINUITY_CAPABILITIES = Object.freeze({
  projection_cursor_advance: false,
  execution_transition: false,
  verification_transition: false,
  closure_transition: false,
  reopening_transition: false,
});

export const CAUSAL_CONTINUITY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS causal_project (
  tenant_id varchar(64) NOT NULL,
  project_id varchar(128) NOT NULL,
  project_name text NOT NULL,
  project_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id)
);

CREATE TABLE IF NOT EXISTS causal_genesis_intent (
  tenant_id varchar(64) NOT NULL,
  project_id varchar(128) NOT NULL,
  genesis_id uuid NOT NULL,
  intent_digest char(64) NOT NULL,
  intent_document jsonb NOT NULL,
  source_kind varchar(32) NOT NULL DEFAULT 'explicit',
  created_by_actor_id varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, genesis_id),
  UNIQUE (tenant_id, project_id),
  UNIQUE (tenant_id, project_id, genesis_id),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES causal_project (tenant_id, project_id),
  CHECK (source_kind = 'explicit')
);

CREATE TABLE IF NOT EXISTS causal_intent_revision (
  tenant_id varchar(64) NOT NULL,
  project_id varchar(128) NOT NULL,
  revision_id uuid NOT NULL,
  genesis_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  previous_revision_digest char(64),
  revision_digest char(64) NOT NULL,
  revision_document jsonb NOT NULL,
  change_reason text NOT NULL,
  authorized_by_actor_id varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, revision_id),
  UNIQUE (tenant_id, project_id, revision_number),
  UNIQUE (tenant_id, project_id, revision_id),
  FOREIGN KEY (tenant_id, project_id, genesis_id)
    REFERENCES causal_genesis_intent (tenant_id, project_id, genesis_id),
  CHECK ((revision_number = 1 AND previous_revision_digest IS NULL) OR
         (revision_number > 1 AND previous_revision_digest IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS causal_operation (
  tenant_id varchar(64) NOT NULL,
  project_id varchar(128) NOT NULL,
  operation_id uuid NOT NULL,
  operation_kind varchar(32) NOT NULL,
  operation_ref varchar(240) NOT NULL,
  intent_revision_id uuid NOT NULL,
  request_digest char(64) NOT NULL,
  lifecycle_state varchar(24) NOT NULL DEFAULT 'DECLARED',
  declared_by_actor_id varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, operation_id),
  UNIQUE (tenant_id, project_id, operation_ref),
  UNIQUE (tenant_id, project_id, operation_id),
  FOREIGN KEY (tenant_id, project_id, intent_revision_id)
    REFERENCES causal_intent_revision (tenant_id, project_id, revision_id),
  CHECK (operation_kind IN ('WORK','CHANGE')),
  CHECK (lifecycle_state IN ('DECLARED','EXECUTED','VERIFIED','CLOSED','REOPENED'))
);

CREATE TABLE IF NOT EXISTS causal_record (
  tenant_id varchar(64) NOT NULL,
  project_id varchar(128) NOT NULL,
  record_id uuid NOT NULL,
  operation_id uuid,
  sequence_number bigint NOT NULL CHECK (sequence_number > 0),
  record_type varchar(64) NOT NULL,
  subject_type varchar(32) NOT NULL,
  subject_id varchar(240) NOT NULL,
  payload jsonb NOT NULL,
  payload_digest char(64) NOT NULL,
  previous_record_hash char(64),
  record_hash char(64) NOT NULL,
  actor_id varchar(160) NOT NULL,
  actor_kind varchar(32) NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, record_id),
  UNIQUE (tenant_id, project_id, sequence_number),
  UNIQUE (tenant_id, project_id, record_id),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES causal_project (tenant_id, project_id),
  FOREIGN KEY (tenant_id, project_id, operation_id)
    REFERENCES causal_operation (tenant_id, project_id, operation_id),
  CHECK (actor_kind IN ('owner','core','agent','system'))
);

CREATE INDEX IF NOT EXISTS causal_record_operation_idx
  ON causal_record (tenant_id, project_id, operation_id, sequence_number);

CREATE TABLE IF NOT EXISTS causal_idempotency (
  tenant_id varchar(64) NOT NULL,
  project_id varchar(128) NOT NULL,
  scope_kind varchar(16) NOT NULL,
  scope_id varchar(240) NOT NULL,
  operation_id uuid,
  idempotency_key varchar(160) NOT NULL,
  request_digest char(64) NOT NULL,
  response_document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, scope_kind, scope_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES causal_project (tenant_id, project_id),
  FOREIGN KEY (tenant_id, project_id, operation_id)
    REFERENCES causal_operation (tenant_id, project_id, operation_id),
  CHECK ((scope_kind = 'PROJECT' AND operation_id IS NULL AND scope_id = project_id) OR
         (scope_kind = 'OPERATION' AND operation_id IS NOT NULL AND scope_id = operation_id::text))
);

CREATE UNIQUE INDEX IF NOT EXISTS causal_operation_idempotency_idx
  ON causal_idempotency (tenant_id, project_id, operation_id, idempotency_key)
  WHERE operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS causal_outbox (
  tenant_id varchar(64) NOT NULL,
  project_id varchar(128) NOT NULL,
  outbox_id uuid NOT NULL,
  record_id uuid NOT NULL,
  topic varchar(120) NOT NULL,
  payload jsonb NOT NULL,
  payload_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  PRIMARY KEY (tenant_id, outbox_id),
  UNIQUE (tenant_id, project_id, record_id, topic),
  FOREIGN KEY (tenant_id, project_id, record_id)
    REFERENCES causal_record (tenant_id, project_id, record_id)
);

CREATE INDEX IF NOT EXISTS causal_outbox_pending_idx
  ON causal_outbox (tenant_id, created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS causal_projection_cursor (
  tenant_id varchar(64) NOT NULL,
  projection_name varchar(120) NOT NULL,
  project_id varchar(128) NOT NULL,
  last_sequence_number bigint NOT NULL DEFAULT 0 CHECK (last_sequence_number >= 0),
  last_record_hash char(64),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, projection_name, project_id),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES causal_project (tenant_id, project_id)
);
COMMENT ON TABLE causal_projection_cursor IS
  'Reserved schema foundation; cursor advance is unavailable in causal_continuity_foundation_v1';

CREATE OR REPLACE FUNCTION deny_causal_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'causal_history_append_only';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'causal_genesis_intent_append_only'
      AND tgrelid = 'causal_genesis_intent'::regclass) THEN
    CREATE TRIGGER causal_genesis_intent_append_only
      BEFORE UPDATE OR DELETE ON causal_genesis_intent
      FOR EACH ROW EXECUTE FUNCTION deny_causal_history_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'causal_intent_revision_append_only'
      AND tgrelid = 'causal_intent_revision'::regclass) THEN
    CREATE TRIGGER causal_intent_revision_append_only
      BEFORE UPDATE OR DELETE ON causal_intent_revision
      FOR EACH ROW EXECUTE FUNCTION deny_causal_history_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'causal_record_append_only'
      AND tgrelid = 'causal_record'::regclass) THEN
    CREATE TRIGGER causal_record_append_only
      BEFORE UPDATE OR DELETE ON causal_record
      FOR EACH ROW EXECUTE FUNCTION deny_causal_history_mutation();
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS core_schema_migrations (
  migration_id varchar(160) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO core_schema_migrations (migration_id)
VALUES ('${CAUSAL_CONTINUITY_MIGRATION_ID}') ON CONFLICT DO NOTHING;
`;

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECORD_TYPES = new Set([
  "PROJECT_REGISTERED", "GENESIS_ANCHORED", "INTENT_REVISED", "OPERATION_DECLARED",
]);
const RESERVED_LIFECYCLE_TYPES = new Set([
  "EXECUTION_RECORDED", "VERIFICATION_RECORDED", "CLOSURE_RECORDED", "REOPENING_RECORDED",
]);

function fail(code) { throw new Error(code); }
function text(value, code, max = 8_000) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
}
function identifier(value, code, max = 160) {
  const normalized = text(value, code, max);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(normalized)) fail(code);
  return normalized;
}
function uuid(value, code) {
  const normalized = text(value, code, 36);
  if (!UUID.test(normalized)) fail(code);
  return normalized.toLowerCase();
}
function hash(value, code = "digest_invalid") {
  const normalized = text(value, code, 64);
  if (!HASH.test(normalized)) fail(code);
  return normalized;
}
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
export function causalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function cleanDocument(value, code, maximum = 200_000) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > maximum) fail(code);
  const sensitiveKeys = new Set([
    "api_key", "apikey", "authorization", "client_secret", "password", "private_key",
    "provider_credential", "provider_credentials", "refresh_token", "secret", "secret_key",
    "token", "access_token", "api_token", "auth_token", "credential", "credentials",
  ]);
  const isSensitiveKey = (key) => sensitiveKeys.has(key) ||
    /^(?:api|auth|access|refresh|private|signing|secret|provider|client)_(?:key|token|secret|credential|credentials|key_material)$/.test(key) ||
    /^(?:credential|credentials)_(?:key|token|secret|material)$/.test(key);
  const redact = (current) => {
    if (typeof current === "string") return redactMemoryText(current).text;
    if (Array.isArray(current)) return current.map(redact);
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(Object.entries(current).map(([key, item]) => {
      const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replaceAll("-", "_").toLowerCase();
      return [key, isSensitiveKey(normalizedKey) ? "[REDACTED]" : redact(item)];
    }));
  };
  const cleaned = stable(redact(JSON.parse(serialized)));
  if (Buffer.byteLength(JSON.stringify(cleaned)) > maximum) fail(code);
  return cleaned;
}
function deterministicUuid(namespace, value) {
  const bytes = crypto.createHash("sha256").update(`${namespace}\0${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const out = bytes.toString("hex");
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

export function buildCausalRecord(input = {}) {
  const tenantId = identifier(input.tenant_id, "causal_tenant_invalid", 64);
  const projectId = identifier(input.project_id, "causal_project_id_invalid", 128);
  const recordType = text(input.record_type, "causal_record_type_invalid", 64).toUpperCase();
  if (!RECORD_TYPES.has(recordType)) {
    if (RESERVED_LIFECYCLE_TYPES.has(recordType)) fail("causal_lifecycle_slice_not_implemented");
    fail("causal_record_type_invalid");
  }
  const sequenceNumber = Number(input.sequence_number);
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1) fail("causal_sequence_invalid");
  const payload = cleanDocument(input.payload, "causal_payload_invalid");
  const createdAt = new Date(input.created_at);
  if (!Number.isFinite(createdAt.getTime())) fail("causal_created_at_invalid");
  const operationId = input.operation_id ? uuid(input.operation_id, "causal_operation_id_invalid") : null;
  const previousRecordHash = input.previous_record_hash ? hash(input.previous_record_hash) : null;
  if ((sequenceNumber === 1) !== (previousRecordHash === null)) fail("causal_previous_hash_invalid");
  const unsigned = {
    schema_version: CAUSAL_CONTINUITY_SCHEMA_VERSION,
    tenant_id: tenantId,
    project_id: projectId,
    operation_id: operationId,
    sequence_number: sequenceNumber,
    record_type: recordType,
    subject_type: text(input.subject_type, "causal_subject_type_invalid", 32).toUpperCase(),
    subject_id: identifier(input.subject_id, "causal_subject_id_invalid", 240),
    payload,
    payload_digest: causalDigest(payload),
    previous_record_hash: previousRecordHash,
    actor_id: identifier(input.actor_id, "causal_actor_id_invalid", 160),
    actor_kind: text(input.actor_kind, "causal_actor_kind_invalid", 32).toLowerCase(),
    created_at: createdAt.toISOString(),
  };
  if (!["owner", "core", "agent", "system"].includes(unsigned.actor_kind)) fail("causal_actor_kind_invalid");
  const recordHash = causalDigest(unsigned);
  return {
    ...unsigned,
    record_id: deterministicUuid("causal-record-v1", recordHash),
    record_hash: recordHash,
  };
}

export function assertIndependentCausalAttestation({
  executor_actor_id,
  verifier_actor_id,
  risk_class = "normal",
} = {}) {
  const executor = identifier(executor_actor_id, "causal_executor_invalid", 160);
  const verifier = identifier(verifier_actor_id, "causal_verifier_invalid", 160);
  if (executor === verifier) fail("causal_self_attestation_denied");
  // This foundation has no cryptographic Core-verdict verifier yet. High-risk
  // verification must remain unavailable rather than trusting caller claims.
  if (String(risk_class).toLowerCase() === "high") fail("causal_high_risk_attestation_not_implemented");
  return true;
}

function canonicalRequest(kind, input) {
  return stable({ schema_version: CAUSAL_CONTINUITY_SCHEMA_VERSION, kind, ...input });
}

export function createCausalContinuityStore({ pool, now = () => new Date() } = {}) {
  if (!pool || typeof pool.query !== "function") fail("causal_postgres_pool_required");
  let initialized;
  const initialize = () => initialized ||= pool.query(CAUSAL_CONTINUITY_SCHEMA_SQL);

  async function transaction(fn) {
    if (typeof pool.connect !== "function") fail("causal_transaction_adapter_required");
    const client = await pool.connect();
    if (!client || typeof client.query !== "function" || typeof client.release !== "function") {
      client?.release?.();
      fail("causal_transaction_adapter_invalid");
    }
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release?.(); }
  }

  async function withIdempotency(client, { tenantId, projectId, operationId = null, key, request }, fn) {
    const idempotencyKey = identifier(key, "causal_idempotency_key_invalid", 160);
    const scopeKind = operationId ? "OPERATION" : "PROJECT";
    const scopeId = operationId || projectId;
    const requestDigest = causalDigest(request);
    const lockKey = `${tenantId}\0${projectId}\0${scopeKind}\0${operationId || "project"}\0${idempotencyKey}`;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lockKey]);
    const prior = await client.query(`SELECT request_digest,response_document FROM causal_idempotency
      WHERE tenant_id=$1 AND project_id=$2 AND scope_kind=$3 AND scope_id=$4 AND idempotency_key=$5
        AND operation_id IS NOT DISTINCT FROM $6::uuid`,
    [tenantId, projectId, scopeKind, scopeId, idempotencyKey, operationId]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_digest !== requestDigest) fail("causal_idempotency_conflict");
      return prior.rows[0].response_document;
    }
    const response = await fn();
    await client.query(`INSERT INTO causal_idempotency
      (tenant_id,project_id,scope_kind,scope_id,operation_id,idempotency_key,request_digest,response_document)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [tenantId, projectId, scopeKind, scopeId, operationId, idempotencyKey, requestDigest, JSON.stringify(response)]);
    return response;
  }

  async function appendRecord(client, input) {
    const project = await client.query(`SELECT 1 FROM causal_project
      WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE`, [input.tenant_id, input.project_id]);
    if (!project.rows[0]) fail("causal_project_not_found");
    const prior = await client.query(`SELECT sequence_number,record_hash FROM causal_record
      WHERE tenant_id=$1 AND project_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`,
    [input.tenant_id, input.project_id]);
    const record = buildCausalRecord({
      ...input,
      sequence_number: Number(prior.rows[0]?.sequence_number || 0) + 1,
      previous_record_hash: prior.rows[0]?.record_hash || null,
      created_at: now(),
    });
    await client.query(`INSERT INTO causal_record
      (tenant_id,project_id,record_id,operation_id,sequence_number,record_type,subject_type,subject_id,payload,
       payload_digest,previous_record_hash,record_hash,actor_id,actor_kind,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15)`,
    [record.tenant_id, record.project_id, record.record_id, record.operation_id, record.sequence_number,
      record.record_type, record.subject_type, record.subject_id, JSON.stringify(record.payload),
      record.payload_digest, record.previous_record_hash, record.record_hash, record.actor_id,
      record.actor_kind, record.created_at]);
    const outboxPayload = stable({
      schema_version: CAUSAL_CONTINUITY_SCHEMA_VERSION,
      tenant_id: record.tenant_id,
      project_id: record.project_id,
      record_id: record.record_id,
      sequence_number: record.sequence_number,
      record_type: record.record_type,
      record_hash: record.record_hash,
    });
    await client.query(`INSERT INTO causal_outbox
      (tenant_id,project_id,outbox_id,record_id,topic,payload,payload_digest)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [record.tenant_id, record.project_id, deterministicUuid("causal-outbox-v1", record.record_hash),
      record.record_id, "causal.record.appended.v1", JSON.stringify(outboxPayload), causalDigest(outboxPayload)]);
    return record;
  }

  async function registerProject(input = {}) {
    await initialize();
    const tenantId = identifier(input.tenant_id, "causal_tenant_invalid", 64);
    const projectId = identifier(input.project_id, "causal_project_id_invalid", 128);
    const actorId = identifier(input.actor_id, "causal_actor_id_invalid", 160);
    const projectName = text(input.project_name, "causal_project_name_invalid", 1_000);
    const projectIdentity = canonicalRequest("PROJECT_IDENTITY", {
      tenant_id: tenantId, project_id: projectId, project_name: projectName,
    });
    const request = canonicalRequest("REGISTER_PROJECT", {
      tenant_id: tenantId, project_id: projectId, project_name: projectName, actor_id: actorId,
    });
    const projectDigest = causalDigest(projectIdentity);
    return transaction(async (client) => {
      await client.query(`INSERT INTO causal_project (tenant_id,project_id,project_name,project_digest)
        VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,project_id) DO NOTHING`,
      [tenantId, projectId, projectName, projectDigest]);
      const existing = await client.query("SELECT project_name,project_digest FROM causal_project WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [tenantId, projectId]);
      if (!existing.rows[0] || existing.rows[0].project_digest !== projectDigest) fail("causal_project_identity_conflict");
      return withIdempotency(client, { tenantId, projectId, key: input.idempotency_key, request }, async () => {
        const record = await appendRecord(client, { tenant_id: tenantId, project_id: projectId,
          record_type: "PROJECT_REGISTERED", subject_type: "PROJECT", subject_id: projectId,
          payload: { project_digest: projectDigest }, actor_id: actorId, actor_kind: input.actor_kind || "owner" });
        return { schema_version: CAUSAL_CONTINUITY_SCHEMA_VERSION, tenant_id: tenantId, project_id: projectId, project_digest: projectDigest, record_hash: record.record_hash };
      });
    });
  }

  async function anchorGenesisIntent(input = {}) {
    await initialize();
    const tenantId = identifier(input.tenant_id, "causal_tenant_invalid", 64);
    const projectId = identifier(input.project_id, "causal_project_id_invalid", 128);
    const actorId = identifier(input.actor_id, "causal_actor_id_invalid", 160);
    const intentDocument = cleanDocument(input.intent_document, "causal_intent_document_invalid");
    const request = canonicalRequest("ANCHOR_GENESIS", { tenant_id: tenantId, project_id: projectId,
      intent_document: intentDocument, actor_id: actorId });
    const intentDigest = causalDigest(intentDocument);
    const genesisId = deterministicUuid("causal-genesis-v1", `${tenantId}\0${projectId}\0${intentDigest}`);
    return transaction(async (client) => withIdempotency(client, { tenantId, projectId, key: input.idempotency_key, request }, async () => {
      const project = await client.query("SELECT 1 FROM causal_project WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [tenantId, projectId]);
      if (!project.rows[0]) fail("causal_project_not_found");
      const existing = await client.query("SELECT genesis_id,intent_digest FROM causal_genesis_intent WHERE tenant_id=$1 AND project_id=$2", [tenantId, projectId]);
      if (existing.rows[0]) {
        if (existing.rows[0].intent_digest !== intentDigest) fail("causal_genesis_immutable");
        fail("causal_genesis_requires_idempotent_replay");
      }
      await client.query(`INSERT INTO causal_genesis_intent
        (tenant_id,project_id,genesis_id,intent_digest,intent_document,source_kind,created_by_actor_id)
        VALUES ($1,$2,$3,$4,$5::jsonb,'explicit',$6)`,
      [tenantId, projectId, genesisId, intentDigest, JSON.stringify(intentDocument), actorId]);
      const revisionId = deterministicUuid("causal-revision-v1", `${genesisId}\0${intentDigest}\0${1}`);
      await client.query(`INSERT INTO causal_intent_revision
        (tenant_id,project_id,revision_id,genesis_id,revision_number,previous_revision_digest,revision_digest,revision_document,change_reason,authorized_by_actor_id)
        VALUES ($1,$2,$3,$4,1,NULL,$5,$6::jsonb,'genesis',$7)`,
      [tenantId, projectId, revisionId, genesisId, intentDigest, JSON.stringify(intentDocument), actorId]);
      const record = await appendRecord(client, { tenant_id: tenantId, project_id: projectId,
        record_type: "GENESIS_ANCHORED", subject_type: "GENESIS", subject_id: genesisId,
        payload: { genesis_id: genesisId, intent_digest: intentDigest, initial_revision_id: revisionId },
        actor_id: actorId, actor_kind: input.actor_kind || "owner" });
      return { schema_version: CAUSAL_CONTINUITY_SCHEMA_VERSION, tenant_id: tenantId, project_id: projectId,
        genesis_id: genesisId, intent_digest: intentDigest, revision_id: revisionId, record_hash: record.record_hash };
    }));
  }

  async function appendIntentRevision(input = {}) {
    await initialize();
    const tenantId = identifier(input.tenant_id, "causal_tenant_invalid", 64);
    const projectId = identifier(input.project_id, "causal_project_id_invalid", 128);
    const actorId = identifier(input.actor_id, "causal_actor_id_invalid", 160);
    const revisionDocument = cleanDocument(input.revision_document, "causal_revision_document_invalid");
    const changeReason = text(input.change_reason, "causal_change_reason_invalid", 4_000);
    const request = canonicalRequest("APPEND_INTENT_REVISION", { tenant_id: tenantId, project_id: projectId,
      revision_document: revisionDocument, change_reason: changeReason, actor_id: actorId });
    return transaction(async (client) => withIdempotency(client, { tenantId, projectId, key: input.idempotency_key, request }, async () => {
      const genesis = await client.query("SELECT genesis_id FROM causal_genesis_intent WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [tenantId, projectId]);
      if (!genesis.rows[0]) fail("causal_genesis_not_found");
      const previous = await client.query(`SELECT revision_number,revision_digest FROM causal_intent_revision
        WHERE tenant_id=$1 AND project_id=$2 ORDER BY revision_number DESC LIMIT 1 FOR UPDATE`, [tenantId, projectId]);
      const revisionNumber = Number(previous.rows[0]?.revision_number || 0) + 1;
      const revisionDigest = causalDigest({ revision_document: revisionDocument, change_reason: changeReason,
        previous_revision_digest: previous.rows[0]?.revision_digest || null });
      const revisionId = deterministicUuid("causal-revision-v1", `${genesis.rows[0].genesis_id}\0${revisionDigest}\0${revisionNumber}`);
      await client.query(`INSERT INTO causal_intent_revision
        (tenant_id,project_id,revision_id,genesis_id,revision_number,previous_revision_digest,revision_digest,revision_document,change_reason,authorized_by_actor_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [tenantId, projectId, revisionId, genesis.rows[0].genesis_id, revisionNumber,
        previous.rows[0]?.revision_digest || null, revisionDigest, JSON.stringify(revisionDocument), changeReason, actorId]);
      const record = await appendRecord(client, { tenant_id: tenantId, project_id: projectId,
        record_type: "INTENT_REVISED", subject_type: "REVISION", subject_id: revisionId,
        payload: { revision_id: revisionId, revision_number: revisionNumber, revision_digest: revisionDigest,
          previous_revision_digest: previous.rows[0]?.revision_digest || null },
        actor_id: actorId, actor_kind: input.actor_kind || "owner" });
      return { schema_version: CAUSAL_CONTINUITY_SCHEMA_VERSION, tenant_id: tenantId, project_id: projectId,
        revision_id: revisionId, revision_number: revisionNumber, revision_digest: revisionDigest, record_hash: record.record_hash };
    }));
  }

  async function declareOperation(input = {}) {
    await initialize();
    const tenantId = identifier(input.tenant_id, "causal_tenant_invalid", 64);
    const projectId = identifier(input.project_id, "causal_project_id_invalid", 128);
    const actorId = identifier(input.actor_id, "causal_actor_id_invalid", 160);
    const revisionId = uuid(input.intent_revision_id, "causal_revision_id_invalid");
    const operationKind = text(input.operation_kind, "causal_operation_kind_invalid", 32).toUpperCase();
    if (!["WORK", "CHANGE"].includes(operationKind)) fail("causal_operation_kind_invalid");
    const operationRef = identifier(input.operation_ref, "causal_operation_ref_invalid", 240);
    const request = canonicalRequest("DECLARE_OPERATION", { tenant_id: tenantId, project_id: projectId,
      intent_revision_id: revisionId, operation_kind: operationKind, operation_ref: operationRef, actor_id: actorId });
    const requestDigest = causalDigest(request);
    const operationId = input.operation_id ? uuid(input.operation_id, "causal_operation_id_invalid")
      : deterministicUuid("causal-operation-v1", `${tenantId}\0${projectId}\0${operationRef}\0${requestDigest}`);
    return transaction(async (client) => {
      const revision = await client.query(`SELECT 1 FROM causal_intent_revision
        WHERE tenant_id=$1 AND project_id=$2 AND revision_id=$3 FOR UPDATE`, [tenantId, projectId, revisionId]);
      if (!revision.rows[0]) fail("causal_revision_scope_mismatch");
      await client.query(`INSERT INTO causal_operation
        (tenant_id,project_id,operation_id,operation_kind,operation_ref,intent_revision_id,request_digest,lifecycle_state,declared_by_actor_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'DECLARED',$8) ON CONFLICT (tenant_id,operation_id) DO NOTHING`,
      [tenantId, projectId, operationId, operationKind, operationRef, revisionId, requestDigest, actorId]);
      const existing = await client.query(`SELECT project_id,request_digest FROM causal_operation
        WHERE tenant_id=$1 AND operation_id=$2 FOR UPDATE`, [tenantId, operationId]);
      if (!existing.rows[0] || existing.rows[0].project_id !== projectId || existing.rows[0].request_digest !== requestDigest) {
        fail("causal_operation_identity_conflict");
      }
      return withIdempotency(client, { tenantId, projectId, operationId, key: input.idempotency_key, request }, async () => {
        const record = await appendRecord(client, { tenant_id: tenantId, project_id: projectId, operation_id: operationId,
          record_type: "OPERATION_DECLARED", subject_type: "OPERATION", subject_id: operationId,
          payload: { operation_id: operationId, operation_kind: operationKind, operation_ref: operationRef,
            intent_revision_id: revisionId, lifecycle_state: "DECLARED" },
          actor_id: actorId, actor_kind: input.actor_kind || "owner" });
        return { schema_version: CAUSAL_CONTINUITY_SCHEMA_VERSION, tenant_id: tenantId, project_id: projectId,
          operation_id: operationId, lifecycle_state: "DECLARED", request_digest: requestDigest, record_hash: record.record_hash };
      });
    });
  }

  return {
    schemaSql: CAUSAL_CONTINUITY_SCHEMA_SQL,
    capabilities: CAUSAL_CONTINUITY_CAPABILITIES,
    initialize,
    registerProject,
    anchorGenesisIntent,
    appendIntentRevision,
    declareOperation,
  };
}

import {
  ENTITY_360_SCHEMA_VERSION,
  Entity360Error,
  entity360Digest,
  entity360SnapshotSemanticBody,
  verifyEntity360Snapshot,
} from "./entity360.js";
import { createEntity360Migrator } from "./entity360Migration.js";
import { verifyEntity360ShadowReceiptAttestation } from "./entity360ShadowObservation.js";

export const ENTITY360_POSTGRES_BACKEND = "entity360_postgres_append_only_v1";

const DIGEST = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/u;
const REGISTRY_KINDS = new Set(["SCHEMA", "ONTOLOGY", "ADAPTER", "POLICY", "SOURCE"]);
const REGISTRY_STATUSES = new Set(["ACTIVE", "DEPRECATED", "REVOKED"]);
// Entity 360 v1 can record observations only. Promotion is a new governed
// release, never a tenant-row value or a persistence-layer escape hatch.
const FEATURE_MODES = new Set(["OFF", "SHADOW"]);
const BACKFILL_STATES = new Set(["PENDING", "RUNNING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"]);
const BACKFILL_TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const BACKFILL_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(["RUNNING", "FAILED", "CANCELLED"]),
  RUNNING: Object.freeze(["RUNNING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"]),
  PAUSED: Object.freeze(["RUNNING", "FAILED", "CANCELLED"]),
  COMPLETED: Object.freeze([]),
  FAILED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});
export const ENTITY360_BACKFILL_CURSOR_VERSION = "entity360_backfill_cursor_v1";
export const ENTITY360_BACKFILL_SOURCE_BINDING_VERSION = "entity360_backfill_source_binding_v1";

function fail(code, status = 422, details) {
  throw new Entity360Error(code, status, details);
}

function plain(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function text(value, code, maximum = 240, pattern = IDENTIFIER) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum || pattern && !pattern.test(normalized)) fail(code);
  return normalized;
}

function digest(value, code) {
  return text(value, code, 64, DIGEST);
}

function integer(value, code, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum) fail(code);
  return normalized;
}

function exactKeys(value, expected, code) {
  const keys = Object.keys(plain(value, code)).sort();
  const normalized = [...expected].sort();
  if (keys.length !== normalized.length
    || keys.some((key, index) => key !== normalized[index])) fail(code);
}

function normalizeBackfillCursor(value, { initial = false } = {}) {
  const cursor = plain(value, "entity360_backfill_cursor_invalid");
  exactKeys(cursor, ["schema_version", "position", "keyset", "previous_cursor_digest"],
    "entity360_backfill_cursor_schema_invalid");
  if (cursor.schema_version !== ENTITY360_BACKFILL_CURSOR_VERSION) {
    fail("entity360_backfill_cursor_schema_invalid");
  }
  const position = integer(cursor.position, "entity360_backfill_cursor_position_invalid");
  const keyset = plain(cursor.keyset, "entity360_backfill_cursor_keyset_invalid");
  const previousCursorDigest = cursor.previous_cursor_digest === null
    ? null : digest(cursor.previous_cursor_digest, "entity360_backfill_cursor_previous_digest_invalid");
  if (initial && (position !== 0 || previousCursorDigest !== null || Object.keys(keyset).length !== 0)) {
    fail("entity360_backfill_initial_cursor_invalid");
  }
  const payload = { schema_version: ENTITY360_BACKFILL_CURSOR_VERSION, position,
    keyset, previous_cursor_digest: previousCursorDigest };
  return { payload, position, previousCursorDigest, digest: entity360Digest(payload) };
}

function normalizeBackfillSourceBinding(value, tenantId) {
  const binding = plain(value, "entity360_backfill_source_binding_required");
  exactKeys(binding, ["schema_version", "tenant_scope", "source_id", "selector"],
    "entity360_backfill_source_binding_schema_invalid");
  if (binding.schema_version !== ENTITY360_BACKFILL_SOURCE_BINDING_VERSION) {
    fail("entity360_backfill_source_binding_schema_invalid");
  }
  const tenantScope = text(binding.tenant_scope, "entity360_backfill_source_tenant_required", 120);
  if (tenantScope !== tenantId) fail("entity360_backfill_source_tenant_mismatch", 403);
  const sourceId = text(binding.source_id, "entity360_backfill_source_id_required", 160);
  const selector = plain(binding.selector, "entity360_backfill_source_selector_required");
  const payload = { schema_version: ENTITY360_BACKFILL_SOURCE_BINDING_VERSION,
    tenant_scope: tenantScope, source_id: sourceId, selector };
  return { payload, digest: entity360Digest(payload) };
}

function trustedTimestamp(value, code) {
  const milliseconds = Date.parse(String(value || ""));
  if (!Number.isFinite(milliseconds)) fail(code, 503);
  return new Date(milliseconds).toISOString();
}

function decode(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function normalizeSnapshot(snapshot, verificationContext) {
  const value = plain(snapshot, "entity360_snapshot_required");
  if (value.schema_version !== ENTITY_360_SCHEMA_VERSION) fail("entity360_snapshot_schema_invalid");
  const tenantId = text(value.tenant_scope, "entity360_tenant_required", 120);
  const entityId = text(value.entity_id, "entity360_entity_id_required", 160);
  const entityType = text(value.entity_type, "entity360_entity_type_required", 80);
  const snapshotDigest = digest(value.deterministic_immutable_digest, "entity360_snapshot_digest_invalid");
  const envelopeDigest = digest(value.envelope_digest, "entity360_envelope_digest_invalid");
  const semantic = entity360SnapshotSemanticBody(value);
  if (entity360Digest(semantic) !== snapshotDigest) fail("entity360_snapshot_digest_mismatch", 409);
  if (entity360Digest({ semantic_digest: snapshotDigest, created_at: value.created_at,
    schema_version: value.schema_version }) !== envelopeDigest) fail("entity360_envelope_digest_mismatch", 409);
  if (value.execution_authorized !== false || value.authority !== "universal_core" ||
      value.production_decision_mutation !== false) fail("entity360_authority_boundary_invalid", 403);
  const verification = verifyEntity360Snapshot(value, verificationContext);
  if (!verification.valid) {
    fail("entity360_snapshot_independent_verification_failed", 409, {
      reasons: verification.reasons,
    });
  }
  return {
    value,
    tenantId,
    entityId,
    entityType,
    snapshotDigest,
    envelopeDigest,
    snapshotVersion: integer(value.snapshot_version, "entity360_snapshot_version_invalid", 1),
    identityDigest: entity360Digest(plain(value.identity?.canonical, "entity360_snapshot_identity_required")),
    policyDigest: digest(value.policy_digest, "entity360_policy_digest_invalid"),
    ontologyDigest: digest(value.ontology_digest, "entity360_ontology_digest_invalid"),
  };
}

export function createPostgresEntity360Store({ pool, policy, ontology, qualificationVerifier } = {}) {
  if (!pool) fail("entity360_postgres_required", 503);
  const db = pool;
  if (typeof db.query !== "function" || typeof db.connect !== "function") {
    fail("entity360_postgres_required", 503);
  }
  if (!policy?.policy_digest || !ontology?.ontology_version) {
    fail("entity360_store_verification_configuration_required", 503);
  }
  if (!qualificationVerifier || typeof qualificationVerifier.verify !== "function"
    || typeof qualificationVerifier.sign === "function") {
    fail("entity360_qualification_verifier_required", 503);
  }
  const verificationContext = Object.freeze({ policy, ontology,
    qualification_verifier: qualificationVerifier });
  const migrator = createEntity360Migrator({ pool: db });
  let initialized = false;

  async function transaction(operation, { readOnly = false } = {}) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      if (readOnly) {
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      }
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve authoritative error */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async function lockScope(client, tenantId, scopeId) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [tenantId, scopeId]);
  }

  async function lockScopes(client, tenantId, scopes) {
    for (const scope of [...new Set(scopes)].sort()) await lockScope(client, tenantId, scope);
  }

  async function replay(client, { tenantId, operation, idempotencyKey, payloadDigest }) {
    const prior = await client.query(
      `SELECT payload_digest,result_payload
         FROM core_entity360_idempotency
        WHERE tenant_id=$1 AND operation=$2 AND idempotency_key=$3
        FOR UPDATE`,
      [tenantId, operation, idempotencyKey],
    );
    if (!prior.rows[0]) return null;
    if (prior.rows[0].payload_digest !== payloadDigest) {
      fail("entity360_idempotency_payload_mismatch", 409, { operation });
    }
    return decode(prior.rows[0].result_payload);
  }

  async function remember(client, { tenantId, operation, idempotencyKey, payloadDigest, result }) {
    await client.query(
      `INSERT INTO core_entity360_idempotency
        (tenant_id,operation,idempotency_key,payload_digest,result_payload)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [tenantId, operation, idempotencyKey, payloadDigest, JSON.stringify(result)],
    );
  }

  async function initialize() {
    const migration = await migrator.apply();
    initialized = true;
    return {
      kind: ENTITY360_POSTGRES_BACKEND,
      restart_durable: true,
      distributed: true,
      schema_version: ENTITY_360_SCHEMA_VERSION,
      migration,
    };
  }

  async function health() {
    const probe = await db.query(
      "SELECT current_setting('server_version_num')::int AS version_num,clock_timestamp() AS database_now",
    );
    try {
      const readback = await migrator.verify();
      return {
        ok: initialized && readback.migration?.application_state === "COMPLETED",
        initialized,
        kind: ENTITY360_POSTGRES_BACKEND,
        restart_durable: true,
        distributed: true,
        postgres_major: Math.floor(Number(probe.rows[0]?.version_num || 0) / 10_000),
        database_time: probe.rows[0]?.database_now,
        migration: readback.migration,
        schema_verified: readback.schema_manifest_matches === true,
        schema_manifest_digest: readback.schema_manifest_digest,
        expected_schema_manifest_digest: readback.expected_schema_manifest_digest,
      };
    } catch (error) {
      return {
        ok: false,
        initialized,
        kind: ENTITY360_POSTGRES_BACKEND,
        restart_durable: true,
        distributed: true,
        postgres_major: Math.floor(Number(probe.rows[0]?.version_num || 0) / 10_000),
        database_time: probe.rows[0]?.database_now,
        migration: null,
        schema_verified: false,
        error: String(error?.code || error?.message || "entity360_schema_verification_failed")
          .slice(0, 160),
      };
    }
  }

  async function registerDefinition(raw) {
    const tenantId = text(raw?.tenant_id, "entity360_tenant_required", 120);
    const kind = text(raw?.kind, "entity360_registry_kind_required", 40).toUpperCase();
    if (!REGISTRY_KINDS.has(kind)) fail("entity360_registry_kind_invalid");
    const registryId = text(raw?.registry_id, "entity360_registry_id_required", 160);
    const version = text(raw?.version, "entity360_registry_version_required", 160);
    const payload = plain(raw?.payload, "entity360_registry_payload_required");
    const payloadDigest = entity360Digest(payload);
    if (raw.payload_digest && digest(raw.payload_digest, "entity360_registry_digest_invalid") !== payloadDigest) {
      fail("entity360_registry_digest_mismatch", 409);
    }
    const status = String(raw?.status || "ACTIVE").toUpperCase();
    if (!REGISTRY_STATUSES.has(status)) fail("entity360_registry_status_invalid");
    const actorId = text(raw?.actor_id, "entity360_actor_required", 240, null);
    const idempotencyKey = text(raw?.idempotency_key, "entity360_idempotency_key_required", 240, null);
    const operation = "REGISTER_DEFINITION";
    const requestDigest = entity360Digest({ kind, registry_id: registryId, version, payload_digest: payloadDigest, status });
    return transaction(async (client) => {
      await lockScope(client, tenantId, `${kind}:${registryId}`);
      const prior = await replay(client, { tenantId, operation, idempotencyKey, payloadDigest: requestDigest });
      if (prior) return prior;
      const existing = await client.query(
        `SELECT payload_digest,status FROM core_entity360_registry
          WHERE tenant_id=$1 AND registry_kind=$2 AND registry_id=$3 AND registry_version=$4`,
        [tenantId, kind, registryId, version],
      );
      if (existing.rows[0] && (existing.rows[0].payload_digest !== payloadDigest || existing.rows[0].status !== status)) {
        fail("entity360_registry_version_conflict", 409);
      }
      if (!existing.rows[0]) {
        await client.query(
          `INSERT INTO core_entity360_registry
            (tenant_id,registry_kind,registry_id,registry_version,payload,payload_digest,status,created_by)
           VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
          [tenantId, kind, registryId, version, JSON.stringify(payload), payloadDigest, status, actorId],
        );
      }
      const result = { tenant_id: tenantId, kind, registry_id: registryId, version,
        payload_digest: payloadDigest, status, created: !existing.rows[0] };
      await remember(client, { tenantId, operation, idempotencyKey, payloadDigest: requestDigest, result });
      return result;
    });
  }

  async function readRegistry({ tenant_id, kind, registry_id, version, status = null } = {}) {
    const tenantId = text(tenant_id, "entity360_tenant_required", 120);
    const registryKind = kind ? text(kind, "entity360_registry_kind_invalid", 40).toUpperCase() : null;
    if (registryKind && !REGISTRY_KINDS.has(registryKind)) fail("entity360_registry_kind_invalid");
    const result = await db.query(
      `SELECT registry_kind AS kind,registry_id,registry_version AS version,payload,payload_digest,status,created_by,created_at
         FROM core_entity360_registry
        WHERE tenant_id=$1
          AND ($2::text IS NULL OR registry_kind=$2)
          AND ($3::text IS NULL OR registry_id=$3)
          AND ($4::text IS NULL OR registry_version=$4)
          AND ($5::text IS NULL OR status=$5)
        ORDER BY registry_kind,registry_id,created_at DESC,registry_version DESC`,
      [tenantId, registryKind, registry_id || null, version || null, status || null],
    );
    return result.rows.map((row) => ({ ...row, payload: decode(row.payload) }));
  }

  async function writeFeatureFlag(raw) {
    const tenantId = text(raw?.tenant_id, "entity360_tenant_required", 120);
    const flagId = text(raw?.flag_id, "entity360_flag_id_required", 160);
    const mode = text(raw?.mode, "entity360_feature_mode_required", 20).toUpperCase();
    if (!FEATURE_MODES.has(mode)) fail("entity360_feature_mode_invalid");
    const enabled = raw?.enabled === true;
    const enforcementAuthorityDigest = raw?.enforcement_authority_digest
      ? digest(raw.enforcement_authority_digest, "entity360_enforcement_authority_digest_invalid") : null;
    const config = plain(raw?.config || {}, "entity360_feature_config_invalid");
    const configDigest = entity360Digest(config);
    const policyDigest = raw?.policy_digest ? digest(raw.policy_digest, "entity360_policy_digest_invalid") : null;
    if ((mode === "OFF" && enabled) || (mode === "SHADOW" && !enabled)
      || (mode === "OFF" && policyDigest !== null) || (mode === "SHADOW" && policyDigest === null)
      || enforcementAuthorityDigest !== null) {
      fail("entity360_feature_flag_state_invalid", 403);
    }
    const expectedRevision = integer(raw?.expected_revision, "entity360_feature_expected_revision_invalid");
    const actorId = text(raw?.actor_id, "entity360_actor_required", 240, null);
    const idempotencyKey = text(raw?.idempotency_key, "entity360_idempotency_key_required", 240, null);
    const operation = "WRITE_FEATURE_FLAG";
    const requestDigest = entity360Digest({ flag_id: flagId, mode, enabled, policy_digest: policyDigest,
      enforcement_authority_digest: enforcementAuthorityDigest,
      config_digest: configDigest, expected_revision: expectedRevision });
    return transaction(async (client) => {
      await lockScope(client, tenantId, `flag:${flagId}`);
      const prior = await replay(client, { tenantId, operation, idempotencyKey, payloadDigest: requestDigest });
      if (prior) return prior;
      const current = await client.query(
        "SELECT revision FROM core_entity360_feature_flags WHERE tenant_id=$1 AND flag_id=$2 FOR UPDATE",
        [tenantId, flagId],
      );
      const actual = Number(current.rows[0]?.revision || 0);
      if (actual !== expectedRevision) fail("entity360_feature_revision_conflict", 409, { expected: expectedRevision, actual });
      const nextRevision = actual + 1;
      if (current.rows[0]) {
        const updated = await client.query(
          `UPDATE core_entity360_feature_flags
              SET mode=$3,enabled=$4,policy_digest=$5,enforcement_authority_digest=$6,
                  config=$7::jsonb,config_digest=$8,revision=$9,updated_by=$10,updated_at=clock_timestamp()
            WHERE tenant_id=$1 AND flag_id=$2 AND revision=$11`,
          [tenantId, flagId, mode, enabled, policyDigest, enforcementAuthorityDigest,
            JSON.stringify(config), configDigest, nextRevision, actorId, expectedRevision],
        );
        if (updated.rowCount !== 1) fail("entity360_feature_revision_conflict", 409);
      } else {
        await client.query(
          `INSERT INTO core_entity360_feature_flags
            (tenant_id,flag_id,mode,enabled,policy_digest,enforcement_authority_digest,
             config,config_digest,revision,updated_by)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
          [tenantId, flagId, mode, enabled, policyDigest, enforcementAuthorityDigest,
            JSON.stringify(config), configDigest, nextRevision, actorId],
        );
      }
      const result = { tenant_id: tenantId, flag_id: flagId, mode, enabled, policy_digest: policyDigest,
        enforcement_authority_digest: enforcementAuthorityDigest,
        config_digest: configDigest, revision: nextRevision };
      await remember(client, { tenantId, operation, idempotencyKey, payloadDigest: requestDigest, result });
      return result;
    });
  }

  async function readFeatureFlag({ tenant_id, flag_id, statement_timeout_ms } = {}) {
    const tenantId = text(tenant_id, "entity360_tenant_required", 120);
    const flagId = text(flag_id, "entity360_flag_id_required", 160);
    const query = (client) => client.query(
      `SELECT flag_id,mode,enabled,policy_digest,enforcement_authority_digest,config,config_digest,revision,updated_by,created_at,updated_at
         FROM core_entity360_feature_flags WHERE tenant_id=$1 AND flag_id=$2`,
      [tenantId, flagId]);
    let result;
    if (statement_timeout_ms === undefined) {
      result = await query(db);
    } else {
      const statementTimeoutMs = integer(statement_timeout_ms,
        "entity360_feature_flag_statement_timeout_invalid", 1);
      if (statementTimeoutMs > 60_000) {
        fail("entity360_feature_flag_statement_timeout_invalid");
      }
      result = await transaction(async (client) => {
        await client.query("SELECT set_config('statement_timeout',$1,true)",
          [`${statementTimeoutMs}ms`]);
        return query(client);
      }, { readOnly: true });
    }
    return result.rows[0] ? { ...result.rows[0], config: decode(result.rows[0].config),
      revision: Number(result.rows[0].revision) } : null;
  }

  async function writeSnapshot(raw) {
    const expectedHeadVersion = integer(raw?.expected_head_version,
      "entity360_expected_head_version_required");
    const idempotencyKey = text(raw?.idempotency_key, "entity360_idempotency_key_required", 240, null);
    const actorId = text(raw?.actor_id, "entity360_actor_required", 240, null);
    const callerRequestDigest = raw?.request_digest
      ? digest(raw.request_digest, "entity360_request_digest_invalid") : null;
    const operation = "WRITE_SNAPSHOT";
    return transaction(async (client) => {
      const databaseClock = await client.query("SELECT clock_timestamp() AS verification_time");
      const verificationTime = trustedTimestamp(databaseClock.rows[0]?.verification_time,
        "entity360_database_verification_time_unavailable");
      const normalized = normalizeSnapshot(raw?.snapshot, {
        ...verificationContext,
        verification_time: verificationTime,
      });
      if (normalized.snapshotVersion !== expectedHeadVersion + 1) {
        fail("entity360_snapshot_sequence_invalid", 409);
      }
      // Runtime idempotency is bound to the canonical caller request, not to
      // mutable source material discovered while rebuilding the response. The
      // snapshot digest remains the fallback for lower-level callers.
      const payloadDigest = callerRequestDigest || entity360Digest({
        snapshot_digest: normalized.snapshotDigest,
        expected_head_version: expectedHeadVersion,
      });
      await lockScope(client, normalized.tenantId, normalized.entityId);
      const prior = await replay(client, { tenantId: normalized.tenantId, operation,
        idempotencyKey, payloadDigest });
      if (prior) return { ...prior, replayed: true };
      await client.query(
        `INSERT INTO core_entity360_entity_heads
          (tenant_id,entity_id,entity_type,identity_digest,current_snapshot_version,current_snapshot_digest,revision)
         VALUES($1,$2,$3,$4,0,NULL,0)
         ON CONFLICT (tenant_id,entity_id) DO NOTHING`,
        [normalized.tenantId, normalized.entityId, normalized.entityType, normalized.identityDigest],
      );
      const headResult = await client.query(
        `SELECT entity_type,identity_digest,current_snapshot_version,current_snapshot_digest,revision
           FROM core_entity360_entity_heads
          WHERE tenant_id=$1 AND entity_id=$2 FOR UPDATE`,
        [normalized.tenantId, normalized.entityId],
      );
      const head = headResult.rows[0];
      if (!head) fail("entity360_head_unavailable", 503);
      if (head.entity_type !== normalized.entityType || head.identity_digest !== normalized.identityDigest) {
        fail("entity360_entity_identity_collision", 409);
      }
      const actualVersion = Number(head.current_snapshot_version);
      if (actualVersion !== expectedHeadVersion) {
        fail("entity360_head_version_conflict", 409, { expected: expectedHeadVersion, actual: actualVersion });
      }
      if ((expectedHeadVersion === 0 && normalized.value.previous_snapshot_digest !== null)
        || (expectedHeadVersion > 0
          && normalized.value.previous_snapshot_digest !== head.current_snapshot_digest)) {
        fail("entity360_previous_snapshot_digest_conflict", 409);
      }
      const snapshotInsert = await client.query(
        `INSERT INTO core_entity360_snapshots
          (tenant_id,entity_id,entity_type,snapshot_version,snapshot_digest,envelope_digest,
           previous_snapshot_digest,schema_version,ontology_version,ontology_digest,
           policy_version,policy_digest,context_status,as_of,snapshot,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
         RETURNING persisted_at`,
        [normalized.tenantId, normalized.entityId, normalized.entityType, normalized.snapshotVersion,
          normalized.snapshotDigest, normalized.envelopeDigest, head.current_snapshot_digest,
          normalized.value.schema_version, normalized.value.ontology_version, normalized.ontologyDigest,
          normalized.value.policy_version, normalized.policyDigest, normalized.value.context_status, normalized.value.as_of,
          JSON.stringify(normalized.value), actorId],
      );
      const persistedAt = trustedTimestamp(snapshotInsert.rows[0]?.persisted_at || verificationTime,
        "entity360_snapshot_persisted_at_unavailable");
      const persistedVerification = verifyEntity360Snapshot(normalized.value, {
        ...verificationContext,
        verification_time: persistedAt,
        persisted_at: persistedAt,
      });
      if (!persistedVerification.valid) {
        fail("entity360_snapshot_persistence_verification_failed", 409, {
          reasons: persistedVerification.reasons,
        });
      }
      const headUpdate = await client.query(
        `UPDATE core_entity360_entity_heads
            SET current_snapshot_version=$3,current_snapshot_digest=$4,revision=revision+1,
                updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND entity_id=$2 AND current_snapshot_version=$5
          RETURNING revision`,
        [normalized.tenantId, normalized.entityId, normalized.snapshotVersion,
          normalized.snapshotDigest, expectedHeadVersion],
      );
      if (headUpdate.rowCount !== 1) fail("entity360_head_version_conflict", 409);
      const result = {
        tenant_id: normalized.tenantId,
        entity_id: normalized.entityId,
        snapshot_version: normalized.snapshotVersion,
        snapshot_digest: normalized.snapshotDigest,
        envelope_digest: normalized.envelopeDigest,
        previous_snapshot_digest: head.current_snapshot_digest || null,
        head_version: normalized.snapshotVersion,
        head_revision: Number(headUpdate.rows[0].revision),
        persisted: true,
        replayed: false,
        backend: ENTITY360_POSTGRES_BACKEND,
        request_digest: callerRequestDigest,
      };
      await remember(client, { tenantId: normalized.tenantId, operation, idempotencyKey, payloadDigest, result });
      return result;
    });
  }

  async function readSnapshotWriteReplay(raw) {
    const tenantId = text(raw?.tenant_id, "entity360_tenant_required", 120);
    const idempotencyKey = text(raw?.idempotency_key,
      "entity360_idempotency_key_required", 240, null);
    const requestDigest = digest(raw?.request_digest, "entity360_request_digest_invalid");
    const result = await db.query(
      `SELECT result_payload
         FROM core_entity360_idempotency
        WHERE tenant_id=$1 AND operation='WRITE_SNAPSHOT' AND idempotency_key=$2`,
      [tenantId, idempotencyKey],
    );
    if (!result.rows[0]) return null;
    const prior = decode(result.rows[0].result_payload);
    if (prior?.request_digest !== requestDigest) {
      fail("entity360_idempotency_payload_mismatch", 409, { operation: "WRITE_SNAPSHOT" });
    }
    return { ...prior, replayed: true };
  }

  function snapshotFromRow(row) {
    if (!row) return null;
    const snapshot = decode(row.snapshot);
    if (snapshot && typeof snapshot === "object" && row.persisted_at) {
      Object.defineProperty(snapshot, "__entity360_persisted_at", {
        value: trustedTimestamp(row.persisted_at, "entity360_snapshot_persisted_at_invalid"),
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
    return snapshot;
  }

  async function readLatestSnapshot({ tenant_id, entity_id } = {}) {
    const tenantId = text(tenant_id, "entity360_tenant_required", 120);
    const entityId = text(entity_id, "entity360_entity_id_required", 160);
    const result = await db.query(
      `SELECT s.snapshot,s.previous_snapshot_digest,s.persisted_at
         FROM core_entity360_entity_heads h
         JOIN core_entity360_snapshots s
           ON s.tenant_id=h.tenant_id AND s.entity_id=h.entity_id
          AND s.snapshot_version=h.current_snapshot_version
        WHERE h.tenant_id=$1 AND h.entity_id=$2`,
      [tenantId, entityId],
    );
    return snapshotFromRow(result.rows[0]);
  }

  async function readSnapshot({ tenant_id, entity_id, snapshot_version } = {}) {
    const tenantId = text(tenant_id, "entity360_tenant_required", 120);
    const entityId = text(entity_id, "entity360_entity_id_required", 160);
    const version = integer(snapshot_version, "entity360_snapshot_version_invalid", 1);
    const result = await db.query(
      `SELECT snapshot,previous_snapshot_digest,persisted_at
         FROM core_entity360_snapshots
        WHERE tenant_id=$1 AND entity_id=$2 AND snapshot_version=$3`,
      [tenantId, entityId, version],
    );
    return snapshotFromRow(result.rows[0]);
  }

  async function readHead({ tenant_id, entity_id } = {}) {
    const tenantId = text(tenant_id, "entity360_tenant_required", 120);
    const entityId = text(entity_id, "entity360_entity_id_required", 160);
    const result = await db.query(
      `SELECT entity_id,entity_type,identity_digest,current_snapshot_version,current_snapshot_digest,revision,created_at,updated_at
         FROM core_entity360_entity_heads WHERE tenant_id=$1 AND entity_id=$2`,
      [tenantId, entityId],
    );
    const row = result.rows[0];
    return row ? { ...row, current_snapshot_version: Number(row.current_snapshot_version),
      revision: Number(row.revision) } : null;
  }

  async function writeShadowReceipt(raw) {
    const tenantId = text(raw?.tenant_id, "entity360_tenant_required", 120);
    const entityId = text(raw?.entity_id, "entity360_entity_id_required", 160);
    const snapshotVersion = integer(raw?.snapshot_version, "entity360_snapshot_version_invalid", 1);
    const receipt = plain(raw?.receipt, "entity360_shadow_receipt_required");
    verifyEntity360ShadowReceiptAttestation(receipt, qualificationVerifier);
    const comparisonDigest = digest(receipt.comparison_digest, "entity360_comparison_digest_invalid");
    const snapshotDigest = digest(receipt.snapshot_digest, "entity360_snapshot_digest_invalid");
    const actorId = text(raw?.actor_id, "entity360_actor_required", 240, null);
    const idempotencyKey = text(raw?.idempotency_key || comparisonDigest,
      "entity360_idempotency_key_invalid", 240, null);
    const operation = "WRITE_SHADOW_RECEIPT";
    const payloadDigest = entity360Digest({ entity_id: entityId, snapshot_version: snapshotVersion,
      comparison_digest: comparisonDigest, receipt });
    return transaction(async (client) => {
      await lockScope(client, tenantId, entityId);
      const prior = await replay(client, { tenantId, operation, idempotencyKey, payloadDigest });
      if (prior) return prior;
      const snapshot = await client.query(
        `SELECT snapshot_digest FROM core_entity360_snapshots
          WHERE tenant_id=$1 AND entity_id=$2 AND snapshot_version=$3 FOR SHARE`,
        [tenantId, entityId, snapshotVersion],
      );
      if (!snapshot.rows[0]) fail("entity360_snapshot_not_found", 404);
      if (snapshot.rows[0].snapshot_digest !== snapshotDigest) fail("entity360_shadow_snapshot_binding_mismatch", 409);
      await client.query(
        `INSERT INTO core_entity360_shadow_receipts
          (tenant_id,entity_id,snapshot_version,comparison_digest,snapshot_digest,receipt,created_by)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [tenantId, entityId, snapshotVersion, comparisonDigest, snapshotDigest,
          JSON.stringify(receipt), actorId],
      );
      const result = { tenant_id: tenantId, entity_id: entityId, snapshot_version: snapshotVersion,
        comparison_digest: comparisonDigest, persisted: true };
      await remember(client, { tenantId, operation, idempotencyKey, payloadDigest, result });
      return result;
    });
  }

  async function readMetrics({ tenant_id } = {}) {
    const tenantId = text(tenant_id, "entity360_tenant_required", 120);
    const [snapshots, shadow] = await Promise.all([
      db.query(`
        SELECT count(*)::bigint AS snapshot_count,
               count(DISTINCT entity_id)::bigint AS entity_count,
               avg((snapshot->>'completeness')::double precision) AS completeness,
               avg((snapshot->>'confidence')::double precision) AS confidence,
               avg(COALESCE((snapshot->'source_diversity'->>'source_count')::double precision,0)) AS source_count,
               avg(COALESCE((snapshot->'source_diversity'->>'ratio')::double precision,0)) AS source_diversity,
               avg(COALESCE((snapshot->'corroboration_state'->>'coverage')::double precision,0)) AS corroboration_coverage,
               avg(COALESCE((snapshot->'assembly_report'->'occupancy'->>'retrieval_bytes')::double precision,0)) AS source_occupancy_bytes,
               avg(COALESCE((snapshot->'assembly_report'->'occupancy'->>'context_tokens')::double precision,0)) AS source_occupancy_tokens,
               sum(jsonb_array_length(COALESCE(snapshot->'stale_sources','[]'::jsonb)))::bigint AS stale_source_count,
               sum(jsonb_array_length(COALESCE(snapshot->'contradictions','[]'::jsonb)))::bigint AS contradiction_count,
               sum((SELECT count(*) FROM jsonb_array_elements(COALESCE(snapshot->'missing_context','[]'::jsonb)) item
                    WHERE COALESCE((item->>'mandatory')::boolean,false)=true))::bigint AS missing_required_context_count,
               sum(COALESCE((snapshot->'assembly_report'->>'rejected_source_contribution_count')::bigint,0))::bigint AS rejected_source_contributions,
               sum(COALESCE((snapshot->'assembly_report'->>'limited_source_contribution_count')::bigint,0))::bigint AS limited_source_contributions
          FROM core_entity360_snapshots WHERE tenant_id=$1`, [tenantId]),
      db.query(`
        SELECT count(*)::bigint AS shadow_comparison_count,
               count(*) FILTER (WHERE (r.receipt->>'diverged')::boolean=true)::bigint AS shadow_divergence_count,
               count(*) FILTER (WHERE COALESCE((r.receipt->>'release_evidence_eligible')::boolean,false)=false)::bigint
                 AS unverified_shadow_comparison_count,
               count(*) FILTER (WHERE (r.receipt->>'release_evidence_eligible')::boolean=true
                 AND upper(r.receipt->>'legacy_outcome')='HOLD')::bigint AS core_hold_count,
               count(*) FILTER (WHERE (r.receipt->>'release_evidence_eligible')::boolean=true
                 AND upper(r.receipt->>'legacy_outcome')='INSUFFICIENT_CONTEXT')::bigint AS core_insufficient_context_count,
               count(*) FILTER (WHERE (r.receipt->>'release_evidence_eligible')::boolean=true
                 AND upper(r.receipt->>'legacy_outcome')='HOLD'
                 AND s.context_status IN ('INCOMPLETE','CONFLICTED','AMBIGUOUS'))::bigint AS core_hold_correlated_count,
               count(*) FILTER (WHERE (r.receipt->>'release_evidence_eligible')::boolean=true
                 AND upper(r.receipt->>'legacy_outcome')='INSUFFICIENT_CONTEXT'
                 AND s.context_status='INCOMPLETE')::bigint AS core_insufficient_context_correlated_count
          FROM core_entity360_shadow_receipts r
          JOIN core_entity360_snapshots s
            ON s.tenant_id=r.tenant_id AND s.entity_id=r.entity_id AND s.snapshot_version=r.snapshot_version
         WHERE r.tenant_id=$1`, [tenantId]),
    ]);
    const metric = snapshots.rows[0] || {};
    const comparison = shadow.rows[0] || {};
    const holdCount = Number(comparison.core_hold_count || 0);
    const holdCorrelatedCount = Number(comparison.core_hold_correlated_count || 0);
    const insufficientCount = Number(comparison.core_insufficient_context_count || 0);
    const insufficientCorrelatedCount = Number(
      comparison.core_insufficient_context_correlated_count || 0);
    if (holdCorrelatedCount > holdCount || insufficientCorrelatedCount > insufficientCount) {
      fail("entity360_metrics_correlation_count_invalid", 503, {
        core_hold_count: holdCount,
        core_hold_correlated_count: holdCorrelatedCount,
        core_insufficient_context_count: insufficientCount,
        core_insufficient_context_correlated_count: insufficientCorrelatedCount,
      });
    }
    return {
      schema_version: "entity_360_persisted_metrics_v1",
      tenant_id: tenantId,
      metrics_scope: "persisted_snapshots_and_shadow_receipts",
      snapshot_count: Number(metric.snapshot_count || 0),
      entity_count: Number(metric.entity_count || 0),
      completeness: metric.completeness === null ? null : Number(metric.completeness),
      confidence: metric.confidence === null ? null : Number(metric.confidence),
      context_assembly_latency_ms: null,
      source_count: metric.source_count === null ? null : Number(metric.source_count),
      source_diversity: metric.source_diversity === null ? null : Number(metric.source_diversity),
      corroboration_coverage: metric.corroboration_coverage === null
        ? null : Number(metric.corroboration_coverage),
      source_occupancy_bytes: metric.source_occupancy_bytes === null
        ? null : Number(metric.source_occupancy_bytes),
      source_occupancy_tokens: metric.source_occupancy_tokens === null
        ? null : Number(metric.source_occupancy_tokens),
      stale_source_count: Number(metric.stale_source_count || 0),
      contradiction_count: Number(metric.contradiction_count || 0),
      missing_required_context_count: Number(metric.missing_required_context_count || 0),
      resolver_metrics_persisted: false,
      resolver_attempt_count: null,
      resolver_ambiguity_count: null,
      entity_resolver_ambiguity_rate: null,
      snapshot_rebuild_rate: Number(metric.entity_count || 0)
        ? Math.max(0, Number(metric.snapshot_count || 0) - Number(metric.entity_count)) /
          Number(metric.entity_count) : 0,
      rejected_source_contributions: Number(metric.rejected_source_contributions || 0),
      limited_source_contributions: Number(metric.limited_source_contributions || 0),
      shadow_comparison_count: Number(comparison.shadow_comparison_count || 0),
      shadow_divergence_count: Number(comparison.shadow_divergence_count || 0),
      unverified_shadow_comparison_count: Number(comparison.unverified_shadow_comparison_count || 0),
      core_hold_count: holdCount,
      core_hold_correlated_count: holdCorrelatedCount,
      core_hold_correlation_rate: holdCount
        ? Math.min(1, Math.max(0, holdCorrelatedCount / holdCount)) : 0,
      core_insufficient_context_count: insufficientCount,
      core_insufficient_context_correlated_count: insufficientCorrelatedCount,
      core_insufficient_context_correlation_rate: insufficientCount
        ? Math.min(1, Math.max(0, insufficientCorrelatedCount / insufficientCount)) : 0,
    };
  }

  async function createBackfill(raw) {
    const tenantId = text(raw?.tenant_id, "entity360_tenant_required", 120);
    const jobId = text(raw?.job_id, "entity360_backfill_job_required", 160);
    const entityType = text(raw?.target_entity_type, "entity360_entity_type_required", 80);
    const sourceBinding = normalizeBackfillSourceBinding(raw?.source_binding, tenantId);
    const sourceBindingDigest = sourceBinding.digest;
    const cursor = normalizeBackfillCursor(raw?.cursor_payload ?? {
      schema_version: ENTITY360_BACKFILL_CURSOR_VERSION,
      position: 0,
      keyset: {},
      previous_cursor_digest: null,
    }, { initial: true });
    const actorId = text(raw?.actor_id, "entity360_actor_required", 240, null);
    const idempotencyKey = text(raw?.idempotency_key, "entity360_idempotency_key_required", 240, null);
    const operation = "CREATE_BACKFILL";
    const payloadDigest = entity360Digest({ job_id: jobId, target_entity_type: entityType,
      source_binding_digest: sourceBindingDigest, cursor_digest: cursor.digest });
    return transaction(async (client) => {
      await lockScopes(client, tenantId, [
        `backfill:${jobId}`,
        `idempotency:${operation}:${idempotencyKey}`,
      ]);
      const prior = await replay(client, { tenantId, operation, idempotencyKey, payloadDigest });
      if (prior) return prior;
      const inserted = await client.query(
        `INSERT INTO core_entity360_backfill_checkpoints
          (tenant_id,job_id,target_entity_type,source_binding,source_binding_digest,
           cursor_payload,cursor_digest,cursor_position,previous_cursor_digest,created_by)
         VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10)
         ON CONFLICT (tenant_id,job_id) DO NOTHING RETURNING revision`,
        [tenantId, jobId, entityType, JSON.stringify(sourceBinding.payload), sourceBindingDigest,
          JSON.stringify(cursor.payload), cursor.digest, cursor.position,
          cursor.previousCursorDigest, actorId],
      );
      if (inserted.rowCount !== 1) fail("entity360_backfill_job_conflict", 409);
      const result = { tenant_id: tenantId, job_id: jobId, state: "PENDING", revision: 0,
        source_binding_digest: sourceBindingDigest, cursor_digest: cursor.digest,
        cursor_position: cursor.position, read_only_source: true, destructive_action: false };
      await remember(client, { tenantId, operation, idempotencyKey, payloadDigest, result });
      return result;
    });
  }

  async function checkpointBackfill(raw) {
    const tenantId = text(raw?.tenant_id, "entity360_tenant_required", 120);
    const jobId = text(raw?.job_id, "entity360_backfill_job_required", 160);
    const expectedRevision = integer(raw?.expected_revision, "entity360_backfill_expected_revision_invalid");
    const cursor = normalizeBackfillCursor(raw?.cursor_payload);
    const processed = integer(raw?.processed_count, "entity360_backfill_processed_invalid");
    const rejected = integer(raw?.rejected_count, "entity360_backfill_rejected_invalid");
    const state = text(raw?.state, "entity360_backfill_state_required", 24).toUpperCase();
    if (!BACKFILL_STATES.has(state)) fail("entity360_backfill_state_invalid");
    const actorId = text(raw?.actor_id, "entity360_actor_required", 240, null);
    const idempotencyKey = text(raw?.idempotency_key, "entity360_idempotency_key_required", 240, null);
    const operation = "CHECKPOINT_BACKFILL";
    const progress = {
      cursor_payload: cursor.payload,
      cursor_position: cursor.position,
      previous_cursor_digest: cursor.previousCursorDigest,
      processed_count: processed,
      rejected_count: rejected,
      state,
    };
    const progressDigest = entity360Digest(progress);
    const payloadDigest = entity360Digest({ job_id: jobId, expected_revision: expectedRevision,
      progress_digest: progressDigest });
    return transaction(async (client) => {
      await lockScopes(client, tenantId, [
        `backfill:${jobId}`,
        `idempotency:${operation}:${idempotencyKey}`,
      ]);
      const prior = await replay(client, { tenantId, operation, idempotencyKey, payloadDigest });
      if (prior) return prior;
      const currentResult = await client.query(
        `SELECT revision,source_binding,source_binding_digest,cursor_payload,cursor_digest,
                cursor_position,previous_cursor_digest,processed_count,rejected_count,state,
                read_only_source,destructive_action
           FROM core_entity360_backfill_checkpoints
          WHERE tenant_id=$1 AND job_id=$2 FOR UPDATE`,
        [tenantId, jobId],
      );
      const current = currentResult.rows[0];
      if (!current) fail("entity360_backfill_not_found", 404);
      if (Number(current.revision) !== expectedRevision) fail("entity360_backfill_revision_conflict", 409);
      if (current.read_only_source !== true || current.destructive_action !== false) {
        fail("entity360_backfill_non_destructive_boundary_invalid", 503);
      }
      let storedCursor;
      let storedSourceBinding;
      try {
        storedCursor = normalizeBackfillCursor(decode(current.cursor_payload));
        storedSourceBinding = normalizeBackfillSourceBinding(decode(current.source_binding), tenantId);
      } catch (error) {
        fail("entity360_backfill_stored_checkpoint_invalid", 503, {
          reason: error?.code || "decode_invalid",
        });
      }
      const currentProcessed = Number(current.processed_count);
      const currentRejected = Number(current.rejected_count);
      if (!BACKFILL_STATES.has(current.state)
        || storedSourceBinding.digest !== current.source_binding_digest
        || storedCursor.digest !== current.cursor_digest
        || storedCursor.position !== Number(current.cursor_position)
        || storedCursor.previousCursorDigest !== current.previous_cursor_digest
        || storedCursor.position !== currentProcessed + currentRejected) {
        fail("entity360_backfill_stored_checkpoint_invalid", 503);
      }
      const latestEventResult = await client.query(
        `SELECT sequence_number,expected_revision,new_revision,state,cursor_digest,cursor_position,
                previous_cursor_digest,processed_count,rejected_count,progress_payload,progress_digest,
                count(*) OVER() AS event_count
           FROM core_entity360_backfill_events
          WHERE tenant_id=$1 AND job_id=$2 ORDER BY sequence_number DESC LIMIT 1`,
        [tenantId, jobId],
      );
      const latestEvent = latestEventResult.rows[0] || null;
      if (expectedRevision === 0 ? latestEvent !== null : latestEvent === null) {
        fail("entity360_backfill_stored_checkpoint_invalid", 503, { reason: "event_presence" });
      }
      if (latestEvent) {
        let latestCursor;
        let progressPayload;
        try {
          progressPayload = decode(latestEvent.progress_payload);
          exactKeys(progressPayload, ["cursor_payload", "cursor_position", "previous_cursor_digest",
            "processed_count", "rejected_count", "state"], "entity360_backfill_event_invalid");
          latestCursor = normalizeBackfillCursor(progressPayload.cursor_payload);
        } catch (error) {
          fail("entity360_backfill_stored_checkpoint_invalid", 503, {
            reason: error?.code || "event_decode_invalid",
          });
        }
        if (Number(latestEvent.sequence_number) !== expectedRevision
          || Number(latestEvent.event_count) !== expectedRevision
          || Number(latestEvent.expected_revision) !== expectedRevision - 1
          || Number(latestEvent.new_revision) !== expectedRevision
          || latestEvent.state !== current.state || latestCursor.digest !== storedCursor.digest
          || latestEvent.cursor_digest !== storedCursor.digest
          || Number(latestEvent.cursor_position) !== storedCursor.position
          || latestEvent.previous_cursor_digest !== storedCursor.previousCursorDigest
          || Number(latestEvent.processed_count) !== currentProcessed
          || Number(latestEvent.rejected_count) !== currentRejected
          || progressPayload.cursor_position !== storedCursor.position
          || progressPayload.previous_cursor_digest !== storedCursor.previousCursorDigest
          || progressPayload.processed_count !== currentProcessed
          || progressPayload.rejected_count !== currentRejected
          || progressPayload.state !== current.state
          || entity360Digest(progressPayload) !== latestEvent.progress_digest) {
          fail("entity360_backfill_stored_checkpoint_invalid", 503, { reason: "event_head_binding" });
        }
      }
      if (BACKFILL_TERMINAL_STATES.has(current.state)) fail("entity360_backfill_terminal", 409);
      if (!BACKFILL_TRANSITIONS[current.state]?.includes(state)) {
        fail("entity360_backfill_transition_invalid", 409, { from: current.state, to: state });
      }
      if (processed < currentProcessed || rejected < currentRejected) {
        fail("entity360_backfill_progress_regression", 409);
      }
      if (cursor.position !== processed + rejected) {
        fail("entity360_backfill_cursor_progress_mismatch", 409);
      }
      const currentPosition = storedCursor.position;
      if (!Number.isSafeInteger(currentPosition) || currentPosition < 0) {
        fail("entity360_backfill_stored_cursor_invalid", 503);
      }
      if (cursor.position < currentPosition) fail("entity360_backfill_cursor_regression", 409);
      if (cursor.position === currentPosition) {
        if (cursor.digest !== storedCursor.digest || processed !== currentProcessed
          || rejected !== currentRejected) {
          fail("entity360_backfill_cursor_non_monotonic", 409);
        }
        if (state === current.state) fail("entity360_backfill_noop_checkpoint", 409);
      } else if (cursor.previousCursorDigest !== storedCursor.digest) {
        fail("entity360_backfill_cursor_chain_mismatch", 409);
      }
      const newRevision = expectedRevision + 1;
      const updated = await client.query(
        `UPDATE core_entity360_backfill_checkpoints
            SET cursor_payload=$3::jsonb,cursor_digest=$4,cursor_position=$5,
                previous_cursor_digest=$6,processed_count=$7,rejected_count=$8,
                state=$9,revision=$10,updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND job_id=$2 AND revision=$11 AND state=$12`,
        [tenantId, jobId, JSON.stringify(cursor.payload), cursor.digest, cursor.position,
          cursor.previousCursorDigest, processed, rejected, state, newRevision, expectedRevision,
          current.state],
      );
      if (updated.rowCount !== 1) fail("entity360_backfill_revision_conflict", 409);
      await client.query(
        `INSERT INTO core_entity360_backfill_events
          (tenant_id,job_id,sequence_number,expected_revision,new_revision,state,cursor_digest,
           cursor_position,previous_cursor_digest,processed_count,rejected_count,
           progress_payload,progress_digest,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
        [tenantId, jobId, newRevision, expectedRevision, newRevision, state, cursor.digest,
          cursor.position, cursor.previousCursorDigest, processed, rejected,
          JSON.stringify(progress), progressDigest, actorId],
      );
      const result = { tenant_id: tenantId, job_id: jobId, state, revision: newRevision,
        cursor_digest: cursor.digest, cursor_position: cursor.position,
        progress_digest: progressDigest, processed_count: processed,
        rejected_count: rejected, read_only_source: true, destructive_action: false };
      await remember(client, { tenantId, operation, idempotencyKey, payloadDigest, result });
      return result;
    });
  }

  async function readBackfill({ tenant_id, job_id } = {}) {
    const tenantId = text(tenant_id, "entity360_tenant_required", 120);
    const jobId = text(job_id, "entity360_backfill_job_required", 160);
    return transaction(async (client) => {
      const [head, events] = await Promise.all([
        client.query(`SELECT job_id,target_entity_type,source_binding,source_binding_digest,cursor_payload,
          cursor_digest,cursor_position,previous_cursor_digest,processed_count,rejected_count,state,
          revision,read_only_source,destructive_action,
          created_by,created_at,updated_at FROM core_entity360_backfill_checkpoints
          WHERE tenant_id=$1 AND job_id=$2`, [tenantId, jobId]),
        client.query(`SELECT sequence_number,expected_revision,new_revision,state,cursor_digest,cursor_position,
          previous_cursor_digest,processed_count,rejected_count,progress_payload,progress_digest,
          created_by,created_at FROM core_entity360_backfill_events
          WHERE tenant_id=$1 AND job_id=$2 ORDER BY sequence_number`, [tenantId, jobId]),
      ]);
      if (!head.rows[0]) return null;
      const record = head.rows[0];
      const sourceBinding = normalizeBackfillSourceBinding(decode(record.source_binding), tenantId);
      if (sourceBinding.digest !== record.source_binding_digest
        || record.read_only_source !== true || record.destructive_action !== false) {
        fail("entity360_backfill_readback_invalid", 503, { reason: "head_binding_or_boundary" });
      }
      const cursor = normalizeBackfillCursor(decode(record.cursor_payload));
      const processed = Number(record.processed_count);
      const rejected = Number(record.rejected_count);
      const revision = Number(record.revision);
      if (cursor.digest !== record.cursor_digest || cursor.position !== Number(record.cursor_position)
        || cursor.previousCursorDigest !== record.previous_cursor_digest
        || cursor.position !== processed + rejected || !BACKFILL_STATES.has(record.state)
        || !Number.isSafeInteger(revision) || revision < 0) {
        fail("entity360_backfill_readback_invalid", 503, { reason: "head_progress" });
      }
      let priorState = "PENDING";
      let priorRevision = 0;
      let priorProcessed = 0;
      let priorRejected = 0;
      let priorCursor = normalizeBackfillCursor({
        schema_version: ENTITY360_BACKFILL_CURSOR_VERSION,
        position: 0,
        keyset: {},
        previous_cursor_digest: null,
      }, { initial: true });
      const normalizedEvents = events.rows.map((event) => {
        const sequenceNumber = Number(event.sequence_number);
        const expected = Number(event.expected_revision);
        const next = Number(event.new_revision);
        const eventProcessed = Number(event.processed_count);
        const eventRejected = Number(event.rejected_count);
        const progressPayload = decode(event.progress_payload);
        exactKeys(progressPayload, ["cursor_payload", "cursor_position", "previous_cursor_digest",
          "processed_count", "rejected_count", "state"], "entity360_backfill_readback_invalid");
        const eventCursor = normalizeBackfillCursor(progressPayload.cursor_payload);
        if (sequenceNumber !== priorRevision + 1 || expected !== priorRevision || next !== sequenceNumber
          || !BACKFILL_TRANSITIONS[priorState]?.includes(event.state)
          || eventProcessed < priorProcessed || eventRejected < priorRejected
          || eventCursor.position !== eventProcessed + eventRejected
          || eventCursor.digest !== event.cursor_digest
          || eventCursor.position !== Number(event.cursor_position)
          || eventCursor.previousCursorDigest !== event.previous_cursor_digest
          || progressPayload.cursor_position !== eventCursor.position
          || progressPayload.previous_cursor_digest !== eventCursor.previousCursorDigest
          || progressPayload.processed_count !== eventProcessed
          || progressPayload.rejected_count !== eventRejected
          || progressPayload.state !== event.state
          || entity360Digest(progressPayload) !== event.progress_digest) {
          fail("entity360_backfill_readback_invalid", 503, { reason: "event_binding" });
        }
        if (eventCursor.position === priorCursor.position) {
          if (eventCursor.digest !== priorCursor.digest || eventProcessed !== priorProcessed
            || eventRejected !== priorRejected) {
            fail("entity360_backfill_readback_invalid", 503, { reason: "event_non_monotonic" });
          }
          if (event.state === priorState) {
            fail("entity360_backfill_readback_invalid", 503, { reason: "event_noop" });
          }
        } else if (eventCursor.position < priorCursor.position
          || eventCursor.previousCursorDigest !== priorCursor.digest) {
          fail("entity360_backfill_readback_invalid", 503, { reason: "event_cursor_chain" });
        }
        priorState = event.state;
        priorRevision = next;
        priorProcessed = eventProcessed;
        priorRejected = eventRejected;
        priorCursor = eventCursor;
        return { ...event, sequence_number: sequenceNumber, expected_revision: expected,
          new_revision: next, cursor_position: eventCursor.position,
          processed_count: eventProcessed, rejected_count: eventRejected, progress_payload: progressPayload };
      });
      if (priorRevision !== revision || priorState !== record.state || priorProcessed !== processed
        || priorRejected !== rejected || priorCursor.digest !== cursor.digest) {
        fail("entity360_backfill_readback_invalid", 503, { reason: "event_head_mismatch" });
      }
      return { ...record, tenant_id: tenantId, source_binding: sourceBinding.payload,
        cursor_payload: cursor.payload,
        cursor_position: cursor.position, processed_count: processed, rejected_count: rejected,
        revision, events: normalizedEvents };
    }, { readOnly: true });
  }

  async function readPolicyHead({ tenant_id, project_id = null } = {}) {
    const tenantId = text(tenant_id, "entity360_tenant_required", 120);
    const result = await db.query(
      `SELECT registry_id,registry_version AS version,payload,payload_digest,status,created_at
         FROM core_entity360_registry
        WHERE tenant_id=$1 AND registry_kind='POLICY' AND status='ACTIVE'
          AND ($2::text IS NULL OR payload->>'project_id'=$2)
        ORDER BY created_at DESC,registry_version DESC LIMIT 1`,
      [tenantId, project_id || null],
    );
    return result.rows[0] ? { ...result.rows[0], payload: decode(result.rows[0].payload) } : null;
  }

  async function setPolicyRevision(input) {
    return registerDefinition({ ...input, kind: "POLICY", registry_id: input.registry_id || "entity360-context-policy" });
  }

  return Object.freeze({
    kind: ENTITY360_POSTGRES_BACKEND,
    initialize,
    health,
    migrationReadback: () => migrator.readback(),
    registerDefinition,
    readRegistry,
    writeFeatureFlag,
    readFeatureFlag,
    writeSnapshot,
    readSnapshotWriteReplay,
    readLatestSnapshot,
    readSnapshot,
    readHead,
    writeShadowReceipt,
    readMetrics,
    createBackfill,
    checkpointBackfill,
    readBackfill,
    readPolicyHead,
    setPolicyRevision,
    async close() {},
  });
}

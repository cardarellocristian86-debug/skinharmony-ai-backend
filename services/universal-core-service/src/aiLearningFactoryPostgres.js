import crypto from "node:crypto";
import pg from "pg";

export const AI_LEARNING_FACTORY_DATABASE_SCHEMA = "ai_learning_governance";
export const AI_LEARNING_FACTORY_MIGRATION_VERSION = "0.16.0-ai-learning-factory-v1";
export const AI_LEARNING_FACTORY_RUNTIME_ROLE = "nyra_ai_learning_runtime_v016";

const TENANT_PATTERN = /^[a-z0-9][a-z0-9_-]{1,119}$/i;
const COLLECTION_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
const RECORD_PATTERN = /^[a-z0-9][a-z0-9._:@/-]{0,199}$/i;
const SCHEMA_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const COLLECTION_ID_FIELDS = Object.freeze({
  evaluation_scorecards: "scorecard_id",
  dataset_metadata: "dataset_id",
  causal_experiments: "experiment_id",
  learning_candidates: "candidate_id",
  performance_scorecards: "performance_scorecard_id",
  learning_outcomes: "outcome_id",
});
const COLLECTION_FILTER_FIELDS = Object.freeze({
  evaluation_scorecards: Object.freeze(["release_version"]),
  dataset_metadata: Object.freeze(["dataset_version"]),
  causal_experiments: Object.freeze(["status"]),
  learning_candidates: Object.freeze(["status"]),
  performance_scorecards: Object.freeze(["release_version"]),
  learning_outcomes: Object.freeze([]),
});

function requiredText(value, field, max = 4_000) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || normalized.includes("\u0000")) {
    throw new Error(`${field}_invalid`);
  }
  return normalized;
}

function tenantId(value) {
  const normalized = requiredText(value, "tenant_id", 120);
  if (!TENANT_PATTERN.test(normalized)) throw new Error("tenant_id_invalid");
  return normalized;
}

function collectionId(value) {
  const normalized = requiredText(value, "collection", 80);
  if (!COLLECTION_PATTERN.test(normalized) || !COLLECTION_ID_FIELDS[normalized]) {
    throw new Error("learning_factory_collection_invalid");
  }
  return normalized;
}

function recordId(value, field = "record_id") {
  const normalized = requiredText(value, field, 200);
  if (!RECORD_PATTERN.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function schemaId(value) {
  const normalized = requiredText(value, "ai_learning_database_schema", 63);
  if (!SCHEMA_PATTERN.test(normalized)) throw new Error("ai_learning_database_schema_invalid");
  return normalized;
}

function revision(value, field = "expected_revision") {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error(`${field}_invalid`);
  return normalized;
}

function boundedLimit(value) {
  return Math.max(1, Math.min(500, Number(value) || 100));
}

function boundedOffset(value) {
  const normalized = Number(value) || 0;
  if (
    !Number.isSafeInteger(normalized)
    || normalized < 0
    || normalized > 1_000_000
  ) throw new Error("cursor_invalid");
  return normalized;
}

function listFilterClause(collection, filters = {}, parameters = []) {
  const source = filters && typeof filters === "object" && !Array.isArray(filters)
    ? filters
    : {};
  const allowed = new Set(COLLECTION_FILTER_FIELDS[collection] || []);
  const clauses = [];
  for (const [field, rawValue] of Object.entries(source)) {
    if (!allowed.has(field)) throw new Error("learning_factory_filter_invalid");
    const value = recordId(rawValue, field);
    parameters.push(value);
    clauses.push(`record ->> '${field}' = $${parameters.length}`);
  }
  return clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
}

function telemetryFilterClause(filters = {}, parameters = []) {
  const source = filters && typeof filters === "object" && !Array.isArray(filters)
    ? filters
    : {};
  const clauses = [];
  for (const [field, rawValue] of Object.entries(source)) {
    if (field !== "trace_id") throw new Error("telemetry_filter_invalid");
    const value = recordId(rawValue, field);
    parameters.push(value);
    clauses.push(`record ->> 'trace_id' = $${parameters.length}`);
  }
  return clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
}

function visibilityContext(value = {}) {
  const tenant = tenantId(value.tenant_id || value.tenantId);
  const clientType = requiredText(
    value.client_type || value.clientType,
    "resource_visibility_client_type",
    80,
  );
  const audience = requiredText(value.audience, "resource_visibility_audience", 160);
  const entitlements = Array.isArray(value.entitlements)
    ? [...new Set(value.entitlements.map((item) =>
        requiredText(item, "resource_visibility_entitlement", 240)))].sort()
    : [];
  return { tenant_id: tenant, client_type: clientType, audience, entitlements };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((output, key) => {
    if (value[key] !== undefined) output[key] = canonical(value[key]);
    return output;
  }, {});
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function storedRecord(row) {
  if (!row) return null;
  return clone(typeof row.record === "string" ? JSON.parse(row.record) : row.record);
}

async function useClient(database, callback) {
  if (typeof database.connect !== "function") return callback(database);
  const client = await database.connect();
  try {
    return await callback(client);
  } finally {
    client.release?.();
  }
}

export function aiLearningFactoryMigrationPlan({
  schema = AI_LEARNING_FACTORY_DATABASE_SCHEMA,
} = {}) {
  return Object.freeze({
    migration_version: AI_LEARNING_FACTORY_MIGRATION_VERSION,
    schema: schemaId(schema),
    additive: true,
    rollback_safe: true,
    tenant_scoped: true,
    preserves_audit: true,
    preserves_history: true,
    creates_database: false,
    creates_service: false,
    runtime_ddl: false,
    migration_artifact: "migrations/0.16.0-ai-learning-factory.up.sql",
    rollback_artifact: "migrations/0.16.0-ai-learning-factory.down.sql",
    rollback_strategy: "disable_runtime_and_retain_records_history_telemetry_and_audit",
  });
}

/**
 * PostgreSQL persistence for the AI Learning Factory. It deliberately uses
 * the existing isolated governance database and never accepts an unscoped
 * load, write or list operation.
 */
export function createAiLearningFactoryPostgresPersistence({
  connectionString,
  pool = null,
  schema = AI_LEARNING_FACTORY_DATABASE_SCHEMA,
  runtimeRole = "",
  allowUnattestedRuntimeWrites = false,
  now = () => new Date(),
} = {}) {
  const databaseUrl = pool ? null : requiredText(connectionString, "governed_agent_database_url");
  const databaseSchema = schemaId(schema);
  const databaseRuntimeRole = runtimeRole ? schemaId(runtimeRole) : "";
  let runtimeRoleState = {
    configured: Boolean(databaseRuntimeRole),
    attempted: false,
    attested: false,
    read_ready: false,
    write_ready: false,
    session_user_separated: false,
    reason: databaseRuntimeRole ? "runtime_role_not_yet_attested" : "runtime_role_not_configured",
  };
  const database = pool || new pg.Pool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 10_000,
    application_name: "nyra-ai-learning-factory-v016",
  });
  let initialization = null;
  let initialized = false;

  async function attestRuntimeRole() {
    if (!databaseRuntimeRole) return runtimeRoleState;
    runtimeRoleState = { ...runtimeRoleState, attempted: true };
    try {
      const attestation = await useClient(database, async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(`SET LOCAL ROLE ${databaseRuntimeRole}`);
          const result = await client.query(
            `SELECT
               current_user::text AS current_user,
               session_user::text AS session_user,
               has_schema_privilege(current_user,$1,'USAGE') AS schema_usage,
               has_table_privilege(current_user,$2,'SELECT') AS learning_read_ready,
               has_table_privilege(current_user,$2,'INSERT,UPDATE') AS learning_write_ready,
               has_table_privilege(current_user,$3,'SELECT,INSERT') AS history_ready,
               has_table_privilege(current_user,$4,'SELECT,INSERT') AS telemetry_ready,
               has_table_privilege(current_user,$5,'SELECT,INSERT') AS idempotency_ready`,
            [
              databaseSchema,
              `${databaseSchema}.learning_record`,
              `${databaseSchema}.learning_record_history`,
              `${databaseSchema}.runtime_telemetry`,
              `${databaseSchema}.idempotency_receipt`,
            ],
          );
          await client.query("ROLLBACK");
          return result.rows[0] || {};
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      });
      const currentUserMatches = attestation.current_user === databaseRuntimeRole;
      const sessionSeparated = Boolean(attestation.session_user)
        && attestation.session_user !== databaseRuntimeRole;
      const readReady = currentUserMatches
        && attestation.schema_usage === true
        && attestation.learning_read_ready === true;
      const writeReady = readReady
        && attestation.learning_write_ready === true
        && attestation.history_ready === true
        && attestation.telemetry_ready === true
        && attestation.idempotency_ready === true;
      runtimeRoleState = {
        configured: true,
        attempted: true,
        attested: writeReady && sessionSeparated,
        read_ready: readReady && sessionSeparated,
        write_ready: writeReady && sessionSeparated,
        session_user_separated: sessionSeparated,
        reason: writeReady && sessionSeparated
          ? "verified_set_local_role_and_privileges"
          : "runtime_role_privilege_or_separation_probe_failed",
      };
    } catch {
      runtimeRoleState = {
        configured: true,
        attempted: true,
        attested: false,
        read_ready: false,
        write_ready: false,
        session_user_separated: false,
        reason: "runtime_role_attestation_query_failed",
      };
    }
    return runtimeRoleState;
  }

  async function initialize() {
    if (initialized) {
      return {
        initialized: true,
        reused: true,
        migration_version: AI_LEARNING_FACTORY_MIGRATION_VERSION,
        runtime_role: { ...runtimeRoleState },
      };
    }
    if (initialization) return initialization;
    initialization = (async () => {
      const migration = await database.query(
        `SELECT state FROM ${databaseSchema}.schema_migration_audit
         WHERE migration_version=$1
         ORDER BY applied_at DESC
         LIMIT 1`,
        [AI_LEARNING_FACTORY_MIGRATION_VERSION],
      );
      if (migration.rows[0]?.state !== "active") {
        throw new Error("ai_learning_static_migration_not_active");
      }
      const attestation = await attestRuntimeRole();
      if (!attestation.read_ready || !attestation.write_ready || !attestation.attested) {
        throw new Error("ai_learning_runtime_role_attestation_failed");
      }
      initialized = true;
      return {
        initialized: true,
        reused: false,
        migration_version: AI_LEARNING_FACTORY_MIGRATION_VERSION,
        runtime_role: { ...runtimeRoleState },
      };
    })().catch((error) => {
      initialization = null;
      throw error;
    });
    return initialization;
  }

  async function ready() {
    await initialize();
  }

  function requireRuntimeWriteRole() {
    if (!runtimeRoleState.write_ready && allowUnattestedRuntimeWrites !== true) {
      throw new Error("ai_learning_dedicated_runtime_role_required");
    }
  }

  async function runtimeQuery(sql, parameters = []) {
    if (!runtimeRoleState.read_ready) {
      if (allowUnattestedRuntimeWrites === true) return database.query(sql, parameters);
      throw new Error("ai_learning_runtime_role_separation_required");
    }
    return useClient(database, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL ROLE ${databaseRuntimeRole}`);
        const result = await client.query(sql, parameters);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  const learningAdapter = Object.freeze({
    async load({ tenant_id, collection, record_id } = {}) {
      await ready();
      const tenant = tenantId(tenant_id);
      const collectionName = collectionId(collection);
      const id = recordId(record_id);
      const result = await runtimeQuery(
        `SELECT record FROM ${databaseSchema}.learning_record
         WHERE tenant_id=$1 AND collection=$2 AND record_id=$3`,
        [tenant, collectionName, id],
      );
      return storedRecord(result.rows[0]);
    },

    async loadIdempotent({
      tenant_id,
      collection,
      record_id,
      idempotency_key,
      request_digest,
    } = {}) {
      await ready();
      const tenant = tenantId(tenant_id);
      const collectionName = collectionId(collection);
      const id = recordId(record_id);
      const idempotencyKey = requiredText(
        idempotency_key,
        "idempotency_key",
        240,
      );
      const requestDigest = requiredText(
        request_digest,
        "request_digest",
        80,
      );
      if (!/^sha256:[a-f0-9]{64}$/.test(requestDigest)) {
        throw new Error("request_digest_invalid");
      }
      const idempotencyDigest = digest({
        tenant,
        collection: collectionName,
        idempotency_key: idempotencyKey,
      });
      const result = await runtimeQuery(
        `SELECT request_digest,record_id,result_record
         FROM ${databaseSchema}.idempotency_receipt
         WHERE tenant_id=$1 AND operation=$2 AND idempotency_digest=$3`,
        [tenant, collectionName, idempotencyDigest],
      );
      const receipt = result.rows[0];
      if (!receipt) return null;
      if (
        receipt.request_digest !== requestDigest
        || receipt.record_id !== id
      ) throw new Error("learning_factory_idempotency_conflict");
      return storedRecord({ record: receipt.result_record });
    },

    async save({
      tenant_id,
      collection,
      record_id,
      expected_revision,
      record,
    } = {}) {
      await ready();
      requireRuntimeWriteRole();
      const tenant = tenantId(tenant_id);
      const collectionName = collectionId(collection);
      const id = recordId(record_id);
      const expected = revision(expected_revision);
      const value = clone(record);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("learning_factory_record_invalid");
      if (
        value.tenant_id !== tenant
        || value[COLLECTION_ID_FIELDS[collectionName]] !== id
        || revision(value.revision, "record_revision") !== expected + 1
      ) {
        throw new Error("learning_factory_adapter_scope_violation");
      }
      const recordDigest = digest(value);
      const timestamp = now().toISOString();

      if (expected === 0) {
        const inserted = await runtimeQuery(
          `INSERT INTO ${databaseSchema}.learning_record
            (tenant_id,collection,record_id,revision,record,record_digest,created_at,updated_at)
           VALUES ($1,$2,$3,1,$4::jsonb,$5,$6,$6)
           ON CONFLICT (tenant_id,collection,record_id) DO NOTHING
           RETURNING revision`,
          [tenant, collectionName, id, JSON.stringify(value), recordDigest, timestamp],
        );
        if (!inserted.rows[0]) throw new Error("learning_factory_revision_conflict");
        return clone(value);
      }

      return useClient(database, async (client) => {
        await client.query("BEGIN");
        try {
          if (runtimeRoleState.write_ready) await client.query(`SET LOCAL ROLE ${databaseRuntimeRole}`);
          else if (allowUnattestedRuntimeWrites !== true) throw new Error("ai_learning_dedicated_runtime_role_required");
          const locked = await client.query(
            `SELECT revision,record,record_digest FROM ${databaseSchema}.learning_record
             WHERE tenant_id=$1 AND collection=$2 AND record_id=$3
             FOR UPDATE`,
            [tenant, collectionName, id],
          );
          const prior = locked.rows[0];
          if (!prior || Number(prior.revision) !== expected) {
            throw new Error("learning_factory_revision_conflict");
          }
          await client.query(
            `INSERT INTO ${databaseSchema}.learning_record_history
              (tenant_id,collection,record_id,revision,record,record_digest,archived_at)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
             ON CONFLICT (tenant_id,collection,record_id,revision) DO NOTHING`,
            [
              tenant,
              collectionName,
              id,
              expected,
              JSON.stringify(storedRecord(prior)),
              prior.record_digest,
              timestamp,
            ],
          );
          const updated = await client.query(
            `UPDATE ${databaseSchema}.learning_record
             SET revision=$4,record=$5::jsonb,record_digest=$6,updated_at=$7
             WHERE tenant_id=$1 AND collection=$2 AND record_id=$3 AND revision=$8
             RETURNING revision`,
            [
              tenant,
              collectionName,
              id,
              expected + 1,
              JSON.stringify(value),
              recordDigest,
              timestamp,
              expected,
            ],
          );
          if (!updated.rows[0]) throw new Error("learning_factory_revision_conflict");
          await client.query("COMMIT");
          return clone(value);
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      });
    },

    async saveIdempotent({
      tenant_id,
      collection,
      record_id,
      expected_revision,
      record,
      idempotency_key,
      request_digest,
    } = {}) {
      await ready();
      requireRuntimeWriteRole();
      const tenant = tenantId(tenant_id);
      const collectionName = collectionId(collection);
      const id = recordId(record_id);
      const expected = revision(expected_revision);
      const idempotencyKey = requiredText(idempotency_key, "idempotency_key", 240);
      const requestDigest = requiredText(request_digest, "request_digest", 80);
      if (!/^sha256:[a-f0-9]{64}$/.test(requestDigest)) throw new Error("request_digest_invalid");
      const idempotencyDigest = digest({ tenant, collection: collectionName, idempotency_key: idempotencyKey });
      const value = clone(record);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("learning_factory_record_invalid");
      }
      const timestamp = now().toISOString();

      return useClient(database, async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(`SET LOCAL ROLE ${databaseRuntimeRole}`);
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`${tenant}\u0000${collectionName}\u0000${idempotencyDigest}`],
          );
          const receipt = await client.query(
            `SELECT request_digest,record_id,result_record
             FROM ${databaseSchema}.idempotency_receipt
             WHERE tenant_id=$1 AND operation=$2 AND idempotency_digest=$3`,
            [tenant, collectionName, idempotencyDigest],
          );
          if (receipt.rows[0]) {
            if (
              receipt.rows[0].request_digest !== requestDigest ||
              receipt.rows[0].record_id !== id
            ) {
              throw new Error("learning_factory_idempotency_conflict");
            }
            await client.query("COMMIT");
            return storedRecord({ record: receipt.rows[0].result_record });
          }

          if (
            value.tenant_id !== tenant ||
            value[COLLECTION_ID_FIELDS[collectionName]] !== id ||
            revision(value.revision, "record_revision") !== expected + 1
          ) {
            throw new Error("learning_factory_adapter_scope_violation");
          }
          const recordDigest = digest(value);
          if (expected === 0) {
            const inserted = await client.query(
              `INSERT INTO ${databaseSchema}.learning_record
                (tenant_id,collection,record_id,revision,record,record_digest,created_at,updated_at)
               VALUES ($1,$2,$3,1,$4::jsonb,$5,$6,$6)
               ON CONFLICT (tenant_id,collection,record_id) DO NOTHING
               RETURNING revision`,
              [tenant, collectionName, id, JSON.stringify(value), recordDigest, timestamp],
            );
            if (!inserted.rows[0]) throw new Error("learning_factory_revision_conflict");
          } else {
            const locked = await client.query(
              `SELECT revision,record,record_digest FROM ${databaseSchema}.learning_record
               WHERE tenant_id=$1 AND collection=$2 AND record_id=$3
               FOR UPDATE`,
              [tenant, collectionName, id],
            );
            const prior = locked.rows[0];
            if (!prior || Number(prior.revision) !== expected) {
              throw new Error("learning_factory_revision_conflict");
            }
            await client.query(
              `INSERT INTO ${databaseSchema}.learning_record_history
                (tenant_id,collection,record_id,revision,record,record_digest,archived_at)
               VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
               ON CONFLICT (tenant_id,collection,record_id,revision) DO NOTHING`,
              [
                tenant,
                collectionName,
                id,
                expected,
                JSON.stringify(storedRecord(prior)),
                prior.record_digest,
                timestamp,
              ],
            );
            const updated = await client.query(
              `UPDATE ${databaseSchema}.learning_record
               SET revision=$4,record=$5::jsonb,record_digest=$6,updated_at=$7
               WHERE tenant_id=$1 AND collection=$2 AND record_id=$3 AND revision=$8
               RETURNING revision`,
              [
                tenant,
                collectionName,
                id,
                expected + 1,
                JSON.stringify(value),
                recordDigest,
                timestamp,
                expected,
              ],
            );
            if (!updated.rows[0]) throw new Error("learning_factory_revision_conflict");
          }
          await client.query(
            `INSERT INTO ${databaseSchema}.idempotency_receipt
              (tenant_id,operation,idempotency_digest,request_digest,record_id,result_revision,result_record,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
            [
              tenant,
              collectionName,
              idempotencyDigest,
              requestDigest,
              id,
              expected + 1,
              JSON.stringify(value),
              timestamp,
            ],
          );
          await client.query("COMMIT");
          return clone(value);
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      });
    },

    async list({
      tenant_id,
      collection,
      limit = 100,
      offset = 0,
      filters = {},
    } = {}) {
      await ready();
      const tenant = tenantId(tenant_id);
      const collectionName = collectionId(collection);
      const parameters = [tenant, collectionName];
      const filterClause = listFilterClause(collectionName, filters, parameters);
      parameters.push(boundedLimit(limit), boundedOffset(offset));
      const result = await runtimeQuery(
        `SELECT record FROM ${databaseSchema}.learning_record
         WHERE tenant_id=$1 AND collection=$2
         ${filterClause}
         ORDER BY updated_at DESC,record_id ASC
         LIMIT $${parameters.length - 1}
         OFFSET $${parameters.length}`,
        parameters,
      );
      return result.rows.map(storedRecord);
    },

    async listForVisibility({
      tenant_id,
      collection,
      visibility_context,
      limit = 100,
      offset = 0,
      filters = {},
    } = {}) {
      await ready();
      const tenant = tenantId(tenant_id);
      const collectionName = collectionId(collection);
      const context = visibilityContext({
        ...visibility_context,
        tenant_id: tenant,
      });
      if (context.client_type === "admin" && context.audience === "admin_control_room") {
        const parameters = [tenant, collectionName];
        const filterClause = listFilterClause(collectionName, filters, parameters);
        parameters.push(boundedLimit(limit), boundedOffset(offset));
        const adminResult = await runtimeQuery(
          `SELECT record FROM ${databaseSchema}.learning_record
           WHERE tenant_id=$1 AND collection=$2
           ${filterClause}
           ORDER BY updated_at DESC,record_id ASC
           LIMIT $${parameters.length - 1}
           OFFSET $${parameters.length}`,
          parameters,
        );
        return adminResult.rows.map(storedRecord);
      }
      const parameters = [
        tenant,
        collectionName,
        context.client_type,
        context.audience,
        JSON.stringify(context.entitlements),
      ];
      const filterClause = listFilterClause(collectionName, filters, parameters);
      parameters.push(boundedLimit(limit), boundedOffset(offset));
      const result = await runtimeQuery(
        `SELECT record FROM ${databaseSchema}.learning_record
         WHERE tenant_id=$1
           AND collection=$2
           AND record #>> '{resource_visibility,schema_version}' = 'resource_visibility_v1'
           AND record #>> '{resource_visibility,tenant_id}' = $1
           AND (record #> '{resource_visibility,allowed_client_types}') ? $3
           AND (record #> '{resource_visibility,allowed_audiences}') ? $4
           AND COALESCE(record #> '{resource_visibility,required_entitlements}','[]'::jsonb)
             <@ $5::jsonb
           AND (
             $3 <> 'chatgpt'
             OR (
               record #>> '{resource_visibility,exposure_class}' = 'chatgpt_horizontal'
               AND record #>> '{resource_visibility,domain_pack_id}' = 'generic'
             )
           )
         ${filterClause}
         ORDER BY updated_at DESC,record_id ASC
         LIMIT $${parameters.length - 1}
         OFFSET $${parameters.length}`,
        parameters,
      );
      return result.rows.map(storedRecord);
    },
  });

  const telemetryAdapter = Object.freeze({
    async load({ tenant_id, run_id } = {}) {
      await ready();
      const tenant = tenantId(tenant_id);
      const run = recordId(run_id, "run_id");
      const result = await runtimeQuery(
        `SELECT record FROM ${databaseSchema}.runtime_telemetry
         WHERE tenant_id=$1 AND run_id=$2`,
        [tenant, run],
      );
      return storedRecord(result.rows[0]);
    },

    async save({ tenant_id, run_id, record } = {}) {
      await ready();
      requireRuntimeWriteRole();
      const tenant = tenantId(tenant_id);
      const run = recordId(run_id, "run_id");
      const value = clone(record);
      if (
        !value
        || typeof value !== "object"
        || Array.isArray(value)
        || value.tenant_id !== tenant
        || value.run_id !== run
        || value.raw_content_persisted !== false
      ) {
        throw new Error("telemetry_adapter_scope_violation");
      }
      const recordDigest = digest(value);
      const inserted = await runtimeQuery(
        `INSERT INTO ${databaseSchema}.runtime_telemetry
          (tenant_id,run_id,record,record_digest,recorded_at)
         VALUES ($1,$2,$3::jsonb,$4,$5)
         ON CONFLICT (tenant_id,run_id) DO NOTHING
         RETURNING record_digest`,
        [tenant, run, JSON.stringify(value), recordDigest, value.recorded_at],
      );
      if (inserted.rows[0]) return clone(value);
      const existing = await runtimeQuery(
        `SELECT record,record_digest FROM ${databaseSchema}.runtime_telemetry
         WHERE tenant_id=$1 AND run_id=$2`,
        [tenant, run],
      );
      if (!existing.rows[0] || existing.rows[0].record_digest !== recordDigest) {
        throw new Error("telemetry_run_conflict");
      }
      return storedRecord(existing.rows[0]);
    },

    async list({
      tenant_id,
      limit = 100,
      offset = 0,
      filters = {},
    } = {}) {
      await ready();
      const tenant = tenantId(tenant_id);
      const parameters = [tenant];
      const filterClause = telemetryFilterClause(filters, parameters);
      parameters.push(boundedLimit(limit), boundedOffset(offset));
      const result = await runtimeQuery(
        `SELECT record FROM ${databaseSchema}.runtime_telemetry
         WHERE tenant_id=$1
         ${filterClause}
         ORDER BY recorded_at DESC,run_id ASC
         LIMIT $${parameters.length - 1}
         OFFSET $${parameters.length}`,
        parameters,
      );
      return result.rows.map(storedRecord);
    },

    async listForVisibility({
      tenant_id,
      visibility_context,
      limit = 100,
      offset = 0,
      filters = {},
    } = {}) {
      await ready();
      const tenant = tenantId(tenant_id);
      const context = visibilityContext({
        ...visibility_context,
        tenant_id: tenant,
      });
      if (context.client_type === "admin" && context.audience === "admin_control_room") {
        const parameters = [tenant];
        const filterClause = telemetryFilterClause(filters, parameters);
        parameters.push(boundedLimit(limit), boundedOffset(offset));
        const adminResult = await runtimeQuery(
          `SELECT record FROM ${databaseSchema}.runtime_telemetry
           WHERE tenant_id=$1
           ${filterClause}
           ORDER BY recorded_at DESC,run_id ASC
           LIMIT $${parameters.length - 1}
           OFFSET $${parameters.length}`,
          parameters,
        );
        return adminResult.rows.map(storedRecord);
      }
      const parameters = [
        tenant,
        context.client_type,
        context.audience,
        JSON.stringify(context.entitlements),
      ];
      const filterClause = telemetryFilterClause(filters, parameters);
      parameters.push(boundedLimit(limit), boundedOffset(offset));
      const result = await runtimeQuery(
        `SELECT record FROM ${databaseSchema}.runtime_telemetry
         WHERE tenant_id=$1
           AND record #>> '{resource_visibility,schema_version}' = 'resource_visibility_v1'
           AND record #>> '{resource_visibility,tenant_id}' = $1
           AND (record #> '{resource_visibility,allowed_client_types}') ? $2
           AND (record #> '{resource_visibility,allowed_audiences}') ? $3
           AND COALESCE(record #> '{resource_visibility,required_entitlements}','[]'::jsonb)
             <@ $4::jsonb
           AND (
             $2 <> 'chatgpt'
             OR (
               record #>> '{resource_visibility,exposure_class}' = 'chatgpt_horizontal'
               AND record #>> '{resource_visibility,domain_pack_id}' = 'generic'
             )
           )
         ${filterClause}
         ORDER BY recorded_at DESC,run_id ASC
         LIMIT $${parameters.length - 1}
         OFFSET $${parameters.length}`,
        parameters,
      );
      return result.rows.map(storedRecord);
    },
  });

  async function rollbackMigration({
    actor_provenance = "universal-core:ai-learning-rollback",
    rollback_reference = "git:pre-v0.16",
  } = {}) {
    await ready();
    await database.query(
      `INSERT INTO ${databaseSchema}.schema_migration_audit
        (migration_version,state,applied_at,actor_provenance,rollback_reference)
       VALUES ($1,'disabled',$2,$3,$4)`,
      [
        AI_LEARNING_FACTORY_MIGRATION_VERSION,
        now().toISOString(),
        requiredText(actor_provenance, "actor_provenance", 160),
        requiredText(rollback_reference, "rollback_reference", 500),
      ],
    );
    return {
      rolled_back: true,
      data_dropped: false,
      history_preserved: true,
      telemetry_preserved: true,
      audit_preserved: true,
    };
  }

  async function close() {
    if (!pool) await database.end();
  }

  return Object.freeze({
    get runtime_role_attested() {
      return runtimeRoleState.attested;
    },
    get runtime_write_mode() {
      if (runtimeRoleState.write_ready) return "enabled_with_attested_runtime_role";
      if (allowUnattestedRuntimeWrites === true) return "test_only_unattested_override";
      return "shadow_unavailable_until_dedicated_role_attested";
    },
    readiness() {
      return Object.freeze({
        initialized,
        persistence_read_ready: runtimeRoleState.read_ready,
        persistence_write_ready: runtimeRoleState.write_ready,
        runtime_role_attested: runtimeRoleState.attested,
        runtime_role_configured: runtimeRoleState.configured,
        runtime_role_probe_attempted: runtimeRoleState.attempted,
        session_user_separated: runtimeRoleState.session_user_separated,
        reason: runtimeRoleState.reason,
      });
    },
    initialize,
    rollbackMigration,
    learningAdapter,
    telemetryAdapter,
    close,
  });
}

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  acquireBoundedMigrationLock,
  ensureCoreSchemaMigrationRegistry,
} from "./coreSchemaMigrationRegistry.js";
import { withPostgresMigrationSession } from "../../shared/retryable-postgres-initializer.js";
import {
  buildIcfEventDigestMetadataV2,
  ICF_EVENT_DIGEST_CONTRACT_LEGACY_V1,
  ICF_EVENT_DIGEST_CONTRACT_V2,
  icfEventDigestV2,
  normalizeIcfEventPayload,
} from "./icfEventDigest.js";

export const ICF_EVENT_DIGEST_MIGRATION_ID = "20260825_002_icf_event_digest_v2";
export const ICF_EVENT_DIGEST_MIGRATION_LOCK =
  "skinharmony:universal-core:icf:event-digest-v2:migration:v1";

const ICF_EVENT_DIGEST_MIGRATION_URL = new URL(
  "../migrations/20260825_002_icf_event_digest_v2.sql",
  import.meta.url,
);

// This is deliberately the legacy-compatible bootstrap only. The v2 digest
// columns and guards have one owner: the governed, read-back migration above.
export const ICF_POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS core_icf_work (
  tenant_id text NOT NULL, work_id text NOT NULL, version bigint NOT NULL DEFAULT 0,
  state jsonb NOT NULL, ledger_head_digest text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id)
);
CREATE TABLE IF NOT EXISTS core_icf_event (
  tenant_id text NOT NULL, work_id text NOT NULL, seq bigint NOT NULL,
  event_type text NOT NULL, payload jsonb NOT NULL, previous_digest text,
  digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, seq), UNIQUE (tenant_id, work_id, digest)
);
CREATE INDEX IF NOT EXISTS core_icf_event_head_idx ON core_icf_event (tenant_id, work_id, seq DESC);
`;

function migrationDigest(sql) {
  return crypto.createHash("sha256")
    .update(`${ICF_EVENT_DIGEST_MIGRATION_ID}\u0000${sql}`)
    .digest("hex");
}

function migrationError(code, details) {
  const error = new Error(code);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

const REQUIRED_V2_COLUMNS = Object.freeze([
  ["core_icf_work", "ledger_head_digest_contract", "text", null, "YES"],
  ["core_icf_event", "digest_contract", "text", null, "YES"],
  ["core_icf_event", "canonicalization_version", "text", null, "YES"],
  ["core_icf_event", "digest_algorithm", "text", null, "YES"],
  ["core_icf_event", "payload_digest", "character", 64, "YES"],
  ["core_icf_event", "previous_digest_contract", "text", null, "YES"],
]);
const ICF_V2_CONSTRAINTS = Object.freeze([
  "core_icf_event_digest_contract_v2_ck",
  "core_icf_work_head_digest_contract_v2_ck",
]);

function catalogDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function migrationTransactionBody(sql) {
  const match = /^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql);
  if (!match) throw migrationError("icf_event_digest_v2_migration_transaction_invalid");
  return match[1];
}

async function icfEventDigestV2CatalogManifest(client, schemaName) {
  const columns = await client.query(`
    SELECT table_name,column_name,ordinal_position,data_type,udt_schema,udt_name,
           character_maximum_length,is_nullable,column_default,is_identity,identity_generation,
           is_generated,generation_expression
      FROM information_schema.columns
     WHERE table_schema=$1
       AND (table_name,column_name) IN (
         ('core_icf_work','ledger_head_digest_contract'),
         ('core_icf_event','digest_contract'),
         ('core_icf_event','canonicalization_version'),
         ('core_icf_event','digest_algorithm'),
         ('core_icf_event','payload_digest'),
         ('core_icf_event','previous_digest_contract')
       )
     ORDER BY table_name,ordinal_position
  `, [schemaName]);
  const constraints = await client.query(`
    SELECT rel.relname AS table_name,con.conname,con.contype,con.condeferrable,
           con.condeferred,con.convalidated,con.connoinherit,
           conns.nspname=n.nspname AS constraint_schema_is_local,
           pg_get_expr(con.conbin,con.conrelid,true) AS check_expression
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace
      JOIN pg_namespace conns ON conns.oid=con.connamespace
     WHERE n.nspname=$1 AND con.conname=ANY($2::text[])
     ORDER BY rel.relname,con.conname
  `, [schemaName, ICF_V2_CONSTRAINTS]);
  return {
    schema_version: "icf_event_digest_v2_catalog_manifest_v1",
    columns: columns.rows,
    constraints: constraints.rows,
  };
}

async function expectedIcfEventDigestV2CatalogManifest(client, sql) {
  const referenceSchema = `icf_digest_readback_${process.pid}_${Date.now()}_${Math.random()
    .toString(16).slice(2, 12)}`;
  if (!/^[a-z0-9_]{1,63}$/u.test(referenceSchema)) {
    throw migrationError("icf_event_digest_v2_reference_schema_invalid");
  }
  await client.query("BEGIN");
  try {
    await client.query(`CREATE SCHEMA "${referenceSchema}"`);
    await client.query(`SET LOCAL search_path TO "${referenceSchema}"`);
    await client.query(ICF_POSTGRES_SCHEMA);
    await client.query(migrationTransactionBody(sql));
    const manifest = await icfEventDigestV2CatalogManifest(client, referenceSchema);
    await client.query("ROLLBACK");
    return manifest;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve exact reference failure */ }
    throw error;
  }
}

function verifyIcfEventDigestV2SchemaReadback(readback) {
  const missingColumns = REQUIRED_V2_COLUMNS.filter(([tableName, columnName, dataType,
    characterMaximumLength, isNullable]) => !readback.columns.some((column) =>
    column.table_name === tableName
      && column.column_name === columnName
      && column.data_type === dataType
      && (characterMaximumLength === null
        || Number(column.character_maximum_length) === characterMaximumLength)
      && column.is_nullable === isNullable))
    .map(([tableName, columnName]) => `${tableName}.${columnName}`);
  if (missingColumns.length > 0) {
    throw migrationError("icf_event_digest_v2_schema_readback_failed", {
      missing_columns: missingColumns,
    });
  }
  if (readback.event_constraint_valid !== true
    || readback.work_head_constraint_valid !== true) {
    throw migrationError("icf_event_digest_v2_constraint_readback_failed");
  }
  if (readback.schema_manifest_matches !== true
    || readback.schema_manifest_digest !== readback.expected_schema_manifest_digest) {
    throw migrationError("icf_event_digest_v2_schema_manifest_mismatch", {
      observed_schema_manifest_digest: readback.schema_manifest_digest || null,
      expected_schema_manifest_digest: readback.expected_schema_manifest_digest || null,
    });
  }
  return readback;
}

export function verifyIcfEventDigestV2MigrationReadback(readback, expectedSqlDigest) {
  verifyIcfEventDigestV2SchemaReadback(readback);
  if (readback.migration?.sql_digest !== expectedSqlDigest) {
    throw migrationError("icf_event_digest_v2_migration_digest_mismatch");
  }
  if (readback.migration?.application_state !== "COMPLETED"
    || readback.migration?.checkpoint !== "READBACK_VERIFIED") {
    throw migrationError("icf_event_digest_v2_migration_registry_state_invalid", {
      application_state: readback.migration?.application_state || null,
      checkpoint: readback.migration?.checkpoint || null,
    });
  }
  return readback;
}

export function createIcfPostgresStore({ pool, audit } = {}) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") {
    return {
      kind: "unavailable",
      ready: false,
      initialized: false,
      initialization_state: "unavailable",
      restart_durable: false,
      distributed: false,
      reason: "pool_required",
    };
  }
  const state = {
    ready: false,
    initialized: false,
    initialization_state: "uninitialized",
    reason: "initialization_required",
    last_error_code: null,
    migration: null,
    readback: null,
  };
  let initializationPromise = null;
  let expectedManifestDigestPromise = null;

  function expectedManifestDigest(client, sql) {
    if (!expectedManifestDigestPromise) {
      expectedManifestDigestPromise = expectedIcfEventDigestV2CatalogManifest(client, sql)
        .then((manifest) => catalogDigest(manifest))
        .catch((error) => {
          expectedManifestDigestPromise = null;
          throw error;
        });
    }
    return expectedManifestDigestPromise;
  }

  async function migrationReadback(client, sql) {
    const targetSchemaResult = await client.query("SELECT current_schema() AS schema_name");
    const targetSchema = String(targetSchemaResult.rows[0]?.schema_name || "");
    if (!targetSchema) throw migrationError("icf_event_digest_v2_target_schema_unavailable");
    const observedManifest = await icfEventDigestV2CatalogManifest(client, targetSchema);
    const schemaManifestDigest = catalogDigest(observedManifest);
    const expectedSchemaManifestDigest = await expectedManifestDigest(client, sql);
    const migration = await client.query(
      `SELECT migration_id,sql_digest,application_state,checkpoint,started_at,completed_at,
              verifier_evidence
         FROM core_schema_migrations WHERE migration_id=$1`,
      [ICF_EVENT_DIGEST_MIGRATION_ID],
    );
    const byConstraint = new Map(observedManifest.constraints.map((row) => [row.conname, row]));
    const eventConstraint = byConstraint.get("core_icf_event_digest_contract_v2_ck");
    const workConstraint = byConstraint.get("core_icf_work_head_digest_contract_v2_ck");
    return {
      schema_version: "icf_event_digest_v2_migration_readback_v1",
      migration_id: ICF_EVENT_DIGEST_MIGRATION_ID,
      columns: observedManifest.columns,
      event_constraint_valid: eventConstraint?.contype === "c"
        && eventConstraint?.convalidated === true
        && eventConstraint?.connoinherit === false
        && eventConstraint?.constraint_schema_is_local === true,
      work_head_constraint_valid: workConstraint?.contype === "c"
        && workConstraint?.convalidated === true
        && workConstraint?.connoinherit === false
        && workConstraint?.constraint_schema_is_local === true,
      schema_manifest_digest: schemaManifestDigest,
      expected_schema_manifest_digest: expectedSchemaManifestDigest,
      schema_manifest_matches: schemaManifestDigest === expectedSchemaManifestDigest,
      migration: migration.rows[0] || null,
    };
  }

  async function initializeStore() {
    const sql = await readFile(ICF_EVENT_DIGEST_MIGRATION_URL, "utf8");
    const sqlDigest = migrationDigest(sql);
    const connection = await pool.connect();
    try {
      return await withPostgresMigrationSession(connection, async ({ query }) => {
        const client = Object.freeze({ query });
        let locked = false;
        try {
          await acquireBoundedMigrationLock(client, ICF_EVENT_DIGEST_MIGRATION_LOCK);
          locked = true;
          await client.query(ICF_POSTGRES_SCHEMA);
          await ensureCoreSchemaMigrationRegistry(client);
          const existing = (await client.query(
        `SELECT migration_id,sql_digest,application_state,checkpoint
           FROM core_schema_migrations WHERE migration_id=$1`,
        [ICF_EVENT_DIGEST_MIGRATION_ID],
      )).rows[0];
      if (existing?.sql_digest !== null && existing?.sql_digest !== undefined
        && existing.sql_digest !== sqlDigest) {
        throw migrationError("icf_event_digest_v2_migration_digest_mismatch");
      }
      if (existing?.application_state === "COMPLETED"
        && existing.sql_digest !== sqlDigest) {
        throw migrationError("icf_event_digest_v2_migration_digest_mismatch");
      }
      if (existing?.application_state !== "COMPLETED") {
        await client.query("BEGIN");
        try {
          await client.query(
            `INSERT INTO core_schema_migrations
               (migration_id,sql_digest,application_state,checkpoint)
             VALUES ($1,$2,'APPLYING','REGISTRY_VERIFIED')
             ON CONFLICT (migration_id) DO UPDATE
               SET sql_digest=EXCLUDED.sql_digest,
                   application_state='APPLYING',checkpoint='REGISTRY_VERIFIED'`,
            [ICF_EVENT_DIGEST_MIGRATION_ID, sqlDigest],
          );
          await client.query("COMMIT");
        } catch (error) {
          try { await client.query("ROLLBACK"); } catch { /* preserve original failure */ }
          throw error;
        }
        // The checked-in migration owns its transaction and is executed byte
        // for byte. No second startup copy can drift independently from it.
        await client.query(sql);
        await client.query(
          `UPDATE core_schema_migrations SET checkpoint='SCHEMA_APPLIED'
            WHERE migration_id=$1 AND application_state='APPLYING'`,
          [ICF_EVENT_DIGEST_MIGRATION_ID],
        );
        const preCompletion = await migrationReadback(client, sql);
        verifyIcfEventDigestV2SchemaReadback(preCompletion);
        if (preCompletion.migration?.sql_digest !== sqlDigest
          || preCompletion.migration?.application_state !== "APPLYING"
          || preCompletion.migration?.checkpoint !== "SCHEMA_APPLIED") {
          throw migrationError("icf_event_digest_v2_precompletion_readback_failed");
        }
        await client.query(
          `UPDATE core_schema_migrations
              SET application_state='COMPLETED',checkpoint='READBACK_VERIFIED',
                  completed_at=clock_timestamp(),verifier_evidence=$2::jsonb
            WHERE migration_id=$1 AND application_state='APPLYING'
              AND checkpoint='SCHEMA_APPLIED'`,
          [ICF_EVENT_DIGEST_MIGRATION_ID, JSON.stringify({
            schema_version: preCompletion.schema_version,
            event_constraint_valid: true,
            work_head_constraint_valid: true,
            schema_manifest_digest: preCompletion.schema_manifest_digest,
            expected_schema_manifest_digest: preCompletion.expected_schema_manifest_digest,
            schema_manifest_matches: true,
          })],
        );
      }
          const verified = await migrationReadback(client, sql);
          verifyIcfEventDigestV2MigrationReadback(verified, sqlDigest);
          return verified;
        } catch (error) {
          try { await client.query("ROLLBACK"); } catch { /* preserve authoritative failure */ }
          try {
            await client.query(
          `UPDATE core_schema_migrations SET application_state='FAILED'
            WHERE migration_id=$1 AND application_state<>'COMPLETED'`,
          [ICF_EVENT_DIGEST_MIGRATION_ID],
        );
          } catch { /* the authoritative startup error wins */ }
          throw error;
        } finally {
          if (locked) {
            try {
              await client.query("SELECT pg_advisory_unlock(hashtext($1))", [
                ICF_EVENT_DIGEST_MIGRATION_LOCK,
              ]);
            } catch { /* disconnect also releases the session lock */ }
          }
        }
      });
    } finally {
      connection.release();
    }
  }

  const store = {
    kind: "postgresql",
    restart_durable: true,
    distributed: true,
    migration_id: ICF_EVENT_DIGEST_MIGRATION_ID,
    get ready() { return state.ready; },
    get initialized() { return state.initialized; },
    get initialization_state() { return state.initialization_state; },
    get reason() { return state.reason; },
    get migration() { return state.migration; },
    async initialize() {
      if (state.ready && state.initialized && state.migration && state.readback) {
        return state.readback;
      }
      if (initializationPromise) return initializationPromise;
      state.ready = false;
      state.initialized = false;
      state.initialization_state = "initializing";
      state.reason = "initializing";
      state.last_error_code = null;
      initializationPromise = initializeStore()
        .then((readback) => {
          state.ready = true;
          state.initialized = true;
          state.initialization_state = "ready";
          state.reason = null;
          state.readback = readback;
          state.migration = Object.freeze({
            migration_id: readback.migration_id,
            application_state: readback.migration.application_state,
            checkpoint: readback.migration.checkpoint,
            sql_digest: readback.migration.sql_digest,
          });
          return readback;
        })
        .catch((error) => {
          state.ready = false;
          state.initialized = false;
          state.initialization_state = "failed";
          state.reason = "migration_unavailable";
          state.last_error_code = String(error?.code || "icf_event_digest_v2_migration_unavailable")
            .slice(0, 160);
          state.migration = null;
          state.readback = null;
          throw error;
        })
        .finally(() => { initializationPromise = null; });
      return initializationPromise;
    },
    health() {
      return Object.freeze({
        schema_version: "icf_postgres_store_health_v1",
        ok: state.ready && state.initialized && state.initialization_state === "ready",
        ready: state.ready,
        initialized: state.initialized,
        state: state.initialization_state,
        reason: state.reason,
        error: state.last_error_code,
        backend: "postgresql",
        restart_durable: true,
        distributed: true,
        migration: state.migration,
      });
    },
    async appendEvent({ tenantId, workId, eventType, payload }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query("SELECT version, ledger_head_digest, ledger_head_digest_contract FROM core_icf_work WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE", [tenantId, workId]);
        const version = Number(current.rows[0]?.version || 0) + 1;
        const previous = current.rows[0]?.ledger_head_digest || null;
        const previousDigestContract = previous === null ? null
          : current.rows[0]?.ledger_head_digest_contract || ICF_EVENT_DIGEST_CONTRACT_LEGACY_V1;
        const canonicalPayload = normalizeIcfEventPayload(payload);
        const metadata = buildIcfEventDigestMetadataV2({ payload: canonicalPayload,
          previousDigest: previous, previousDigestContract });
        const digest = icfEventDigestV2({ tenantId, workId, seq: version, eventType,
          payload: canonicalPayload, previous, previousDigestContract });
        await client.query(`INSERT INTO core_icf_event
          (tenant_id,work_id,seq,event_type,payload,previous_digest,digest,digest_contract,
           canonicalization_version,digest_algorithm,payload_digest,previous_digest_contract)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [tenantId, workId, version, eventType, canonicalPayload, previous, digest,
          metadata.digest_contract, metadata.canonicalization_version, metadata.digest_algorithm,
          metadata.payload_digest, metadata.previous_digest_contract]);
        await client.query(`INSERT INTO core_icf_work
          (tenant_id,work_id,version,state,ledger_head_digest,ledger_head_digest_contract)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (tenant_id,work_id) DO UPDATE SET version=EXCLUDED.version,
            ledger_head_digest=EXCLUDED.ledger_head_digest,
            ledger_head_digest_contract=EXCLUDED.ledger_head_digest_contract,updated_at=now()`,
        [tenantId, workId, version, {}, digest, ICF_EVENT_DIGEST_CONTRACT_V2]);
        await client.query("COMMIT");
        audit?.append?.("icf_postgres_event_appended", { tenant_id: tenantId,
          work_id: workId, seq: version, digest_contract: ICF_EVENT_DIGEST_CONTRACT_V2 });
        return { seq: version, digest, previous_digest: previous,
          digest_contract: ICF_EVENT_DIGEST_CONTRACT_V2,
          previous_digest_contract: metadata.previous_digest_contract,
          payload_digest: metadata.payload_digest };
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    },
    async head(tenantId, workId) { const result = await pool.query("SELECT version, ledger_head_digest, ledger_head_digest_contract FROM core_icf_work WHERE tenant_id=$1 AND work_id=$2", [tenantId, workId]); return result.rows[0] || { version: 0, ledger_head_digest: null, ledger_head_digest_contract: null }; },
  };
  return store;
}

import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { causalDigest, CausalContinuityError } from "./causalContinuityCanonical.js";
import { acquireBoundedMigrationLock, ensureCoreSchemaMigrationRegistry } from "./coreSchemaMigrationRegistry.js";

export const CAUSAL_IDENTITY_RELEASE_MIGRATION_ID = "20260812_001_causal_identity_release_resolution_v1";
export const CAUSAL_IDENTITY_RELEASE_MIGRATION_LOCK = "skinharmony:universal-core:causal-identity-release-resolution:v1";

const UP_URL = new URL("../migrations/20260812_001_causal_identity_release_resolution_up.sql", import.meta.url);
const DOWN_URL = new URL("../migrations/20260812_001_causal_identity_release_resolution_down.sql", import.meta.url);

function verify(readback, sqlDigest) {
  if (!readback.table_present || !readback.required_columns || !readback.append_only_guard || !readback.read_index?.valid ||
      !readback.read_index?.matches_expected || !readback.composite_foreign_keys || !readback.derived_project_revision_fk ||
      readback.migration?.sql_digest !== sqlDigest) {
    throw new CausalContinuityError("CAUSAL_RELEASE_MIGRATION_READBACK_FAILED");
  }
}

export function releaseTupleReadIndexMatches(row) {
  const definition = String(row?.definition || "").replace(/\s+/g, " ").toLowerCase();
  return definition.includes("create index core_release_tuple_resolution_read_idx") &&
    definition.includes("core_release_tuple_resolutions using btree") &&
    definition.includes("(tenant_id, project_id, work_id, change_id, phase, event_sequence desc)") &&
    !definition.includes(" where ");
}

export function createCausalIdentityReleaseResolutionMigrator({ pool, connectionString } = {}) {
  if (!pool && !connectionString) throw new CausalContinuityError("CAUSAL_DATABASE_REQUIRED");
  const ownsPool = !pool;
  const db = pool || new Pool({ connectionString, max: 2, idleTimeoutMillis: 10_000 });

  async function readback(client = db) {
    const result = await client.query(`
      SELECT to_regclass('core_release_tuple_resolutions') IS NOT NULL AS table_present,
             EXISTS (
               SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
                WHERE t.tgrelid=to_regclass('core_release_tuple_resolutions')
                  AND t.tgname='core_release_tuple_resolutions_append_only'
                  AND NOT t.tgisinternal AND t.tgenabled='O'
                  AND p.proname='core_causal_append_only_guard'
             ) AS append_only_guard,
             (SELECT count(*)=20 AND bool_and(is_nullable='NO')
                FROM information_schema.columns
               WHERE table_schema=current_schema() AND table_name='core_release_tuple_resolutions'
                 AND column_name=ANY(ARRAY[
                   'tenant_id','resolution_id','project_id','project_state_digest','genesis_intent_id',
                   'intent_revision_id','work_id','change_id','phase','pull_request','lookup_key','lookup_digest',
                   'release_tuple','release_tuple_digest','provenance','provenance_digest','event_sequence',
                   'observed_at','expires_at','created_at'
                 ])) AS required_columns
    `);
    const fkResult = await client.query(`
      SELECT pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c
       WHERE c.conrelid=to_regclass('core_release_tuple_resolutions')
         AND c.contype='f' AND c.convalidated
       ORDER BY definition
    `);
    const derivedProjectResult = await client.query(`
      SELECT EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name='core_projects'
                  AND column_name='derived_from_intent_revision_id' AND data_type='uuid'
             ) AS column_present,
             EXISTS (
               SELECT 1 FROM pg_constraint c
                WHERE c.conname='core_projects_derived_from_intent_revision_fk'
                  AND c.conrelid=to_regclass('core_projects') AND c.contype='f' AND c.convalidated
                  AND lower(regexp_replace(pg_get_constraintdef(c.oid),'\\s+',' ','g')) =
                    'foreign key (tenant_id, derived_from_intent_revision_id) references core_intent_revisions(tenant_id, intent_revision_id) on delete restrict'
             ) AS fk_present
    `);
    const indexResult = await client.query(`
      SELECT i.indisvalid AS valid,pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_class idx JOIN pg_index i ON i.indexrelid=idx.oid
       WHERE idx.relname='core_release_tuple_resolution_read_idx'
         AND idx.relnamespace=current_schema()::regnamespace
    `);
    const migrationResult = await client.query(
      "SELECT migration_id,sql_digest,application_state,checkpoint,completed_at FROM core_schema_migrations WHERE migration_id=$1",
      [CAUSAL_IDENTITY_RELEASE_MIGRATION_ID],
    );
    const index = indexResult.rows[0] || null;
    const fkDefinitions = fkResult.rows.map((row) => String(row.definition || "").replace(/\s+/g, " ").toLowerCase());
    const expectedForeignKeys = [
      "foreign key (tenant_id, project_id) references core_projects(tenant_id, project_id) on delete restrict",
      "foreign key (tenant_id, genesis_intent_id) references core_genesis_intents(tenant_id, genesis_intent_id) on delete restrict",
      "foreign key (tenant_id, intent_revision_id) references core_intent_revisions(tenant_id, intent_revision_id) on delete restrict",
      "foreign key (tenant_id, work_id) references core_work_causal_bindings(tenant_id, work_id) on delete restrict",
      "foreign key (tenant_id, change_id) references core_changes(tenant_id, change_id) on delete restrict",
    ];
    return {
      schema_version: "causal_identity_release_resolution_migration_readback_v1",
      migration_id: CAUSAL_IDENTITY_RELEASE_MIGRATION_ID,
      table_present: result.rows[0]?.table_present === true,
      append_only_guard: result.rows[0]?.append_only_guard === true,
      required_columns: result.rows[0]?.required_columns === true,
      composite_foreign_keys: fkDefinitions.length === expectedForeignKeys.length &&
        expectedForeignKeys.every((expected) => fkDefinitions.includes(expected)),
      foreign_key_definitions: fkDefinitions,
      derived_project_revision_fk: derivedProjectResult.rows[0]?.column_present === true &&
        derivedProjectResult.rows[0]?.fk_present === true,
      read_index: index ? { valid: index.valid === true, definition: index.definition, matches_expected: releaseTupleReadIndexMatches(index) } : null,
      migration: migrationResult.rows[0] || null,
    };
  }

  async function apply() {
    const sql = await readFile(UP_URL, "utf8");
    const sqlDigest = causalDigest({ migration_id: CAUSAL_IDENTITY_RELEASE_MIGRATION_ID, sql });
    const client = await db.connect();
    let locked = false;
    try {
      await acquireBoundedMigrationLock(client, CAUSAL_IDENTITY_RELEASE_MIGRATION_LOCK);
      locked = true;
      await ensureCoreSchemaMigrationRegistry(client);
      const existing = (await client.query(
        "SELECT * FROM core_schema_migrations WHERE migration_id=$1",
        [CAUSAL_IDENTITY_RELEASE_MIGRATION_ID],
      )).rows[0];
      if (existing && existing.sql_digest !== sqlDigest) throw new CausalContinuityError("CAUSAL_RELEASE_MIGRATION_DIGEST_MISMATCH");
      if (existing?.application_state === "COMPLETED") {
        const verified = await readback(client);
        verify(verified, sqlDigest);
        return { applied: false, sql_digest: sqlDigest, readback: verified };
      }
      await client.query("BEGIN");
      try {
        await client.query(
          `INSERT INTO core_schema_migrations (migration_id,sql_digest,application_state,checkpoint)
           VALUES ($1,$2,'APPLYING','LOCKED')
           ON CONFLICT (migration_id) DO UPDATE SET application_state='APPLYING',checkpoint='LOCKED'`,
          [CAUSAL_IDENTITY_RELEASE_MIGRATION_ID, sqlDigest],
        );
        await client.query(sql);
        await client.query(
          `UPDATE core_schema_migrations SET application_state='COMPLETED',checkpoint='READBACK_PENDING',completed_at=clock_timestamp()
            WHERE migration_id=$1`,
          [CAUSAL_IDENTITY_RELEASE_MIGRATION_ID],
        );
        await client.query("COMMIT");
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { /* original error wins */ }
        throw error;
      }
      const verified = await readback(client);
      verify(verified, sqlDigest);
      await client.query(
        "UPDATE core_schema_migrations SET checkpoint='READBACK_VERIFIED',verifier_evidence=$2::jsonb WHERE migration_id=$1",
        [CAUSAL_IDENTITY_RELEASE_MIGRATION_ID, JSON.stringify(verified)],
      );
      return { applied: true, sql_digest: sqlDigest, readback: await readback(client) };
    } finally {
      if (locked) {
        try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [CAUSAL_IDENTITY_RELEASE_MIGRATION_LOCK]); } catch { /* disconnect releases lock */ }
      }
      client.release();
    }
  }

  async function rollback() {
    const sql = await readFile(DOWN_URL, "utf8");
    const client = await db.connect();
    let locked = false;
    try {
      await acquireBoundedMigrationLock(client, CAUSAL_IDENTITY_RELEASE_MIGRATION_LOCK);
      locked = true;
      await client.query("BEGIN");
      try { await client.query(sql); await client.query("COMMIT"); }
      catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
      return { rolled_back: true, migration_id: CAUSAL_IDENTITY_RELEASE_MIGRATION_ID };
    } finally {
      if (locked) try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [CAUSAL_IDENTITY_RELEASE_MIGRATION_LOCK]); } catch {}
      client.release();
    }
  }

  return { migration_id: CAUSAL_IDENTITY_RELEASE_MIGRATION_ID, apply, rollback, readback, async close() { if (ownsPool) await db.end(); } };
}

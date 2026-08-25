import { readFile } from "node:fs/promises";
import {
  acquireBoundedMigrationLock,
  ensureCoreSchemaMigrationRegistry,
} from "./coreSchemaMigrationRegistry.js";
import { Entity360Error, entity360Digest } from "./entity360.js";

export const ENTITY360_MIGRATION_ID = "20260825_001_entity360_v1";
export const ENTITY360_MIGRATION_LOCK = "skinharmony:universal-core:entity360:migration:v1";

const MIGRATION_URL = new URL("../migrations/20260825_001_entity360_up.sql", import.meta.url);

export const ENTITY360_TABLES = Object.freeze([
  "core_entity360_registry",
  "core_entity360_feature_flags",
  "core_entity360_entity_heads",
  "core_entity360_snapshots",
  "core_entity360_shadow_receipts",
  "core_entity360_idempotency",
  "core_entity360_backfill_checkpoints",
  "core_entity360_backfill_events",
]);

export const ENTITY360_APPEND_ONLY_TABLES = Object.freeze([
  "core_entity360_registry",
  "core_entity360_snapshots",
  "core_entity360_shadow_receipts",
  "core_entity360_idempotency",
  "core_entity360_backfill_events",
]);

async function entity360CatalogManifest(client, schemaName) {
  const columns = await client.query(`
    SELECT c.relname AS table_name,c.relkind,c.relpersistence,c.relrowsecurity,
           c.relforcerowsecurity,a.attnum AS ordinal,a.attname AS column_name,
           format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull,a.attidentity,
           a.attgenerated,a.attstorage,a.attcompression,
           CASE WHEN a.attcollation=0 THEN NULL ELSE coll.collname END AS collation_name,
           pg_get_expr(d.adbin,d.adrelid,true) AS default_expression
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      LEFT JOIN pg_collation coll ON coll.oid=a.attcollation
     WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) AND c.relkind IN ('r','p')
     ORDER BY c.relname,a.attnum
  `, [schemaName, ENTITY360_TABLES]);
  const constraints = await client.query(`
    SELECT rel.relname AS table_name,con.conname,con.contype,con.condeferrable,
           con.condeferred,con.convalidated,con.connoinherit,
           ARRAY(SELECT att.attname
                   FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum,ordinal)
                   JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=key.attnum
                  ORDER BY key.ordinal) AS local_columns,
           ref.relname AS referenced_table,
           CASE WHEN ref.oid IS NULL THEN NULL ELSE refns.nspname=n.nspname END
             AS referenced_schema_is_local,
           ARRAY(SELECT att.attname
                   FROM unnest(con.confkey) WITH ORDINALITY AS key(attnum,ordinal)
                   JOIN pg_attribute att ON att.attrelid=con.confrelid AND att.attnum=key.attnum
                  ORDER BY key.ordinal) AS referenced_columns,
           con.confmatchtype,con.confupdtype,con.confdeltype,
           CASE WHEN con.contype='c' THEN pg_get_expr(con.conbin,con.conrelid,true)
                ELSE NULL END AS check_expression
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace
      LEFT JOIN pg_class ref ON ref.oid=con.confrelid
      LEFT JOIN pg_namespace refns ON refns.oid=ref.relnamespace
     WHERE n.nspname=$1 AND rel.relname=ANY($2::text[])
     ORDER BY rel.relname,con.conname
  `, [schemaName, ENTITY360_TABLES]);
  const indexes = await client.query(`
    SELECT rel.relname AS table_name,idx.relname AS index_name,ind.indisunique,
           ind.indisprimary,ind.indisexclusion,ind.indimmediate,ind.indisclustered,
           ind.indisvalid,ind.indisready,ind.indislive,ind.indisreplident,
           ind.indnullsnotdistinct,ind.indnkeyatts,ind.indnatts,
           ARRAY(SELECT pg_get_indexdef(ind.indexrelid,key.ordinal,true)
                   FROM generate_series(1,ind.indnatts) AS key(ordinal)
                  ORDER BY key.ordinal) AS index_keys,
           pg_get_expr(ind.indpred,ind.indrelid,true) AS predicate,
           coalesce(idx.reloptions,ARRAY[]::text[]) AS reloptions
      FROM pg_index ind
      JOIN pg_class rel ON rel.oid=ind.indrelid
      JOIN pg_class idx ON idx.oid=ind.indexrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace
     WHERE n.nspname=$1 AND rel.relname=ANY($2::text[])
     ORDER BY rel.relname,idx.relname
  `, [schemaName, ENTITY360_TABLES]);
  const triggers = await client.query(`
    SELECT rel.relname AS table_name,t.tgname,t.tgtype,t.tgenabled,t.tgdeferrable,
           t.tginitdeferred,encode(t.tgargs,'hex') AS trigger_args,
           pg_get_expr(t.tgqual,t.tgrelid,true) AS when_expression,
           proc.proname AS function_name,
           procns.nspname=n.nspname AS function_schema_is_local,
           pg_get_function_identity_arguments(proc.oid) AS function_arguments,
           lang.lanname AS function_language,proc.prosrc AS function_source,
           proc.provolatile,proc.prosecdef,proc.proleakproof,
           coalesce(proc.proconfig,ARRAY[]::text[]) AS function_config
      FROM pg_trigger t
      JOIN pg_class rel ON rel.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=rel.relnamespace
      JOIN pg_proc proc ON proc.oid=t.tgfoid
      JOIN pg_namespace procns ON procns.oid=proc.pronamespace
      JOIN pg_language lang ON lang.oid=proc.prolang
     WHERE n.nspname=$1 AND rel.relname=ANY($2::text[]) AND NOT t.tgisinternal
     ORDER BY rel.relname,t.tgname
  `, [schemaName, ENTITY360_TABLES]);
  return {
    schema_version: "entity360_postgres_catalog_manifest_v1",
    tables: ENTITY360_TABLES,
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    triggers: triggers.rows,
  };
}

async function expectedEntity360CatalogManifest(client, sql) {
  const referenceSchema = `entity360_readback_${process.pid}_${Date.now()}_${Math.random()
    .toString(16).slice(2, 14)}`;
  if (!/^[a-z0-9_]{1,63}$/u.test(referenceSchema)) fail("entity360_reference_schema_invalid");
  await client.query("BEGIN");
  try {
    await client.query(`CREATE SCHEMA "${referenceSchema}"`);
    await client.query(`SET LOCAL search_path TO "${referenceSchema}"`);
    await client.query(sql);
    const manifest = await entity360CatalogManifest(client, referenceSchema);
    await client.query("ROLLBACK");
    return manifest;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original failure */ }
    throw error;
  }
}

function fail(code, details) {
  throw new Entity360Error(code, 503, details);
}

function verifySchemaReadback(readback, expectedDigest) {
  const missingTables = ENTITY360_TABLES.filter((name) => !readback.tables.includes(name));
  const missingGuards = ENTITY360_APPEND_ONLY_TABLES.filter((name) =>
    !readback.append_only_tables.includes(name));
  if (missingTables.length || missingGuards.length) {
    fail("entity360_migration_readback_failed", {
      missing_tables: missingTables,
      missing_append_only_guards: missingGuards,
    });
  }
  if (readback.migration?.sql_digest !== expectedDigest) {
    fail("entity360_migration_digest_mismatch");
  }
  if (!readback.snapshot_tenant_fk || !readback.snapshot_chain_guard || !readback.backfill_tenant_fk ||
      !readback.feature_enforcement_guard || !readback.backfill_non_destructive_guard ||
      !readback.backfill_cursor_binding_guard || !readback.backfill_state_guard ||
      !readback.backfill_create_guard ||
      !readback.backfill_checkpoint_truncate_guard) {
    fail("entity360_migration_integrity_readback_failed");
  }
  if (!readback.schema_manifest_matches
    || readback.schema_manifest_digest !== readback.expected_schema_manifest_digest) {
    fail("entity360_migration_schema_manifest_mismatch", {
      observed_schema_manifest_digest: readback.schema_manifest_digest,
      expected_schema_manifest_digest: readback.expected_schema_manifest_digest,
    });
  }
  return readback;
}

function verifyPreCompletionReadback(readback, expectedDigest) {
  verifySchemaReadback(readback, expectedDigest);
  if (readback.migration?.application_state !== "APPLYING"
    || readback.migration?.checkpoint !== "SCHEMA_APPLIED") {
    fail("entity360_migration_precompletion_state_invalid", {
      expected_application_state: "APPLYING",
      expected_checkpoint: "SCHEMA_APPLIED",
      observed_application_state: readback.migration?.application_state || null,
      observed_checkpoint: readback.migration?.checkpoint || null,
    });
  }
  return readback;
}

export function verifyEntity360CompletedMigrationReadback(readback, expectedDigest) {
  verifySchemaReadback(readback, expectedDigest);
  if (readback.migration?.application_state !== "COMPLETED"
    || readback.migration?.checkpoint !== "READBACK_VERIFIED") {
    fail("entity360_migration_registry_state_invalid", {
      expected_application_state: "COMPLETED",
      expected_checkpoint: "READBACK_VERIFIED",
      observed_application_state: readback.migration?.application_state || null,
      observed_checkpoint: readback.migration?.checkpoint || null,
    });
  }
  return readback;
}

export function createEntity360Migrator({ pool } = {}) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") {
    fail("entity360_postgres_required");
  }
  let expectedManifestDigestPromise = null;

  function expectedManifestDigest(session, sql) {
    if (!expectedManifestDigestPromise) {
      expectedManifestDigestPromise = expectedEntity360CatalogManifest(session, sql)
        .then((manifest) => entity360Digest(manifest))
        .catch((error) => {
          expectedManifestDigestPromise = null;
          throw error;
        });
    }
    return expectedManifestDigestPromise;
  }

  async function readback(client = pool) {
    const ownsClient = client === pool;
    const session = ownsClient ? await pool.connect() : client;
    try {
    const sql = await readFile(MIGRATION_URL, "utf8");
    const targetSchemaResult = await session.query("SELECT current_schema() AS schema_name");
    const targetSchema = String(targetSchemaResult.rows[0]?.schema_name || "");
    if (!targetSchema) fail("entity360_target_schema_unavailable");
    const observedManifest = await entity360CatalogManifest(session, targetSchema);
    const schemaManifestDigest = entity360Digest(observedManifest);
    const expectedSchemaManifestDigest = await expectedManifestDigest(session, sql);
    const tables = await session.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND c.relkind IN ('r','p')
          AND c.relname=ANY($1::text[]) ORDER BY c.relname`,
      [ENTITY360_TABLES],
    );
    const triggers = await session.query(`
      SELECT c.relname
        FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=current_schema()
         AND c.relname=ANY($1::text[])
         AND NOT t.tgisinternal
         AND t.tgenabled='O'
         AND t.tgname IN (c.relname || '_append_only', c.relname || '_truncate_guard')
       GROUP BY c.relname
      HAVING count(*) FILTER (WHERE t.tgname=c.relname || '_append_only' AND t.tgtype=27)=1
         AND count(*) FILTER (WHERE t.tgname=c.relname || '_truncate_guard' AND t.tgtype=34)=1
       ORDER BY c.relname
    `, [ENTITY360_APPEND_ONLY_TABLES]);
    const migration = await session.query(
      "SELECT migration_id,sql_digest,application_state,checkpoint,started_at,completed_at,verifier_evidence FROM core_schema_migrations WHERE migration_id=$1",
      [ENTITY360_MIGRATION_ID],
    );
    const integrity = await session.query(`
      SELECT EXISTS (
               SELECT 1 FROM pg_constraint
                WHERE conrelid=to_regclass('core_entity360_snapshots') AND contype='f'
                  AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (tenant_id, entity_id)%'
             ) AS snapshot_tenant_fk,
             EXISTS (
               SELECT 1 FROM pg_constraint
                WHERE conrelid=to_regclass('core_entity360_snapshots')
                  AND conname='core_entity360_snapshot_chain_check'
             ) AS snapshot_chain_guard,
             EXISTS (
               SELECT 1 FROM pg_constraint
                WHERE conrelid=to_regclass('core_entity360_backfill_events') AND contype='f'
                  AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (tenant_id, job_id)%'
             ) AS backfill_tenant_fk,
             EXISTS (
               SELECT 1 FROM pg_constraint
                WHERE conrelid=to_regclass('core_entity360_feature_flags')
                  AND conname='core_entity360_feature_enforcement_check'
             ) AS feature_enforcement_guard,
             EXISTS (
               SELECT 1 FROM pg_constraint
                WHERE conrelid=to_regclass('core_entity360_backfill_checkpoints')
                  AND conname='core_entity360_backfill_non_destructive_check'
             ) AS backfill_non_destructive_guard,
             EXISTS (
               SELECT 1 FROM pg_constraint
                WHERE conrelid=to_regclass('core_entity360_backfill_checkpoints')
                  AND conname='core_entity360_backfill_cursor_binding_check'
             ) AS backfill_cursor_binding_guard,
             EXISTS (
               SELECT 1 FROM pg_trigger
                WHERE tgrelid=to_regclass('core_entity360_backfill_checkpoints')
                  AND tgname='core_entity360_backfill_checkpoints_create_guard'
                  AND NOT tgisinternal AND tgenabled='O' AND tgtype=7
             ) AS backfill_create_guard,
             EXISTS (
               SELECT 1 FROM pg_trigger
                WHERE tgrelid=to_regclass('core_entity360_backfill_checkpoints')
                  AND tgname='core_entity360_backfill_checkpoints_state_guard'
                  AND NOT tgisinternal AND tgenabled='O' AND tgtype=27
             ) AS backfill_state_guard,
             EXISTS (
               SELECT 1 FROM pg_trigger
                WHERE tgrelid=to_regclass('core_entity360_backfill_checkpoints')
                  AND tgname='core_entity360_backfill_checkpoints_truncate_guard'
                  AND NOT tgisinternal AND tgenabled='O' AND tgtype=34
             ) AS backfill_checkpoint_truncate_guard
    `);
    return {
      schema_version: "entity360_migration_readback_v1",
      migration_id: ENTITY360_MIGRATION_ID,
      tables: tables.rows.map((row) => row.relname),
      append_only_tables: triggers.rows.map((row) => row.relname),
      migration: migration.rows[0] || null,
      snapshot_tenant_fk: integrity.rows[0]?.snapshot_tenant_fk === true,
      snapshot_chain_guard: integrity.rows[0]?.snapshot_chain_guard === true,
      backfill_tenant_fk: integrity.rows[0]?.backfill_tenant_fk === true,
      feature_enforcement_guard: integrity.rows[0]?.feature_enforcement_guard === true,
      backfill_non_destructive_guard: integrity.rows[0]?.backfill_non_destructive_guard === true,
      backfill_cursor_binding_guard: integrity.rows[0]?.backfill_cursor_binding_guard === true,
      backfill_state_guard: integrity.rows[0]?.backfill_state_guard === true,
      backfill_create_guard: integrity.rows[0]?.backfill_create_guard === true,
      backfill_checkpoint_truncate_guard:
        integrity.rows[0]?.backfill_checkpoint_truncate_guard === true,
      schema_manifest_digest: schemaManifestDigest,
      expected_schema_manifest_digest: expectedSchemaManifestDigest,
      schema_manifest_matches: schemaManifestDigest === expectedSchemaManifestDigest,
    };
    } finally {
      if (ownsClient) session.release();
    }
  }

  async function apply() {
    const sql = await readFile(MIGRATION_URL, "utf8");
    const sqlDigest = entity360Digest({ migration_id: ENTITY360_MIGRATION_ID, sql });
    const client = await pool.connect();
    let locked = false;
    try {
      await acquireBoundedMigrationLock(client, ENTITY360_MIGRATION_LOCK);
      locked = true;
      await ensureCoreSchemaMigrationRegistry(client);
      const existing = (await client.query(
        "SELECT migration_id,sql_digest,application_state FROM core_schema_migrations WHERE migration_id=$1",
        [ENTITY360_MIGRATION_ID],
      )).rows[0];
      if (existing && existing.sql_digest !== sqlDigest) fail("entity360_migration_digest_mismatch");
      if (existing?.application_state === "COMPLETED") {
        const verified = await readback(client);
        verifyEntity360CompletedMigrationReadback(verified, sqlDigest);
        return { applied: false, sql_digest: sqlDigest, readback: verified };
      }
      await client.query("BEGIN");
      try {
        await client.query(
          `INSERT INTO core_schema_migrations (migration_id,sql_digest,application_state,checkpoint)
           VALUES ($1,$2,'APPLYING','REGISTRY_VERIFIED')
           ON CONFLICT (migration_id) DO UPDATE
             SET application_state='APPLYING',checkpoint='REGISTRY_VERIFIED'`,
          [ENTITY360_MIGRATION_ID, sqlDigest],
        );
        await client.query(sql);
        await client.query(
          "UPDATE core_schema_migrations SET checkpoint='SCHEMA_APPLIED' WHERE migration_id=$1",
          [ENTITY360_MIGRATION_ID],
        );
        await client.query("COMMIT");
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { /* preserve authoritative error */ }
        throw error;
      }
      const verified = await readback(client);
      verifyPreCompletionReadback(verified, sqlDigest);
      await client.query(
        `UPDATE core_schema_migrations
            SET application_state='COMPLETED',checkpoint='READBACK_VERIFIED',
                completed_at=clock_timestamp(),verifier_evidence=$2::jsonb
          WHERE migration_id=$1`,
        [ENTITY360_MIGRATION_ID, JSON.stringify({
          schema_version: verified.schema_version,
          tables: verified.tables,
          append_only_tables: verified.append_only_tables,
        })],
      );
      const completed = await readback(client);
      verifyEntity360CompletedMigrationReadback(completed, sqlDigest);
      return { applied: true, sql_digest: sqlDigest, readback: completed };
    } catch (error) {
      try {
        await client.query(
          "UPDATE core_schema_migrations SET application_state='FAILED' WHERE migration_id=$1 AND application_state<>'COMPLETED'",
          [ENTITY360_MIGRATION_ID],
        );
      } catch { /* preserve authoritative error */ }
      throw error;
    } finally {
      if (locked) {
        try {
          await client.query("SELECT pg_advisory_unlock(hashtext($1))", [ENTITY360_MIGRATION_LOCK]);
        } catch { /* disconnect also releases the lock */ }
      }
      client.release();
    }
  }

  async function verify() {
    const sql = await readFile(MIGRATION_URL, "utf8");
    const sqlDigest = entity360Digest({ migration_id: ENTITY360_MIGRATION_ID, sql });
    const verified = await readback();
    verifyEntity360CompletedMigrationReadback(verified, sqlDigest);
    return verified;
  }

  return Object.freeze({
    migration_id: ENTITY360_MIGRATION_ID,
    apply,
    readback,
    verify,
    rollback() { fail("entity360_migration_rollback_refused_append_only_data"); },
  });
}

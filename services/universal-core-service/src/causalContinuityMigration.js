import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { causalDigest, CausalContinuityError } from "./causalContinuityCanonical.js";
import {
  acquireBoundedMigrationLock,
  ensureCoreSchemaMigrationRegistry,
} from "./coreSchemaMigrationRegistry.js";

export const CAUSAL_MIGRATION_ID = "20260809_001_causal_continuity_v1";
export const CAUSAL_MIGRATION_LOCK = "skinharmony:universal-core:causal-continuity:migration:v1";

const UP_URL = new URL("../migrations/20260809_001_causal_continuity_up.sql", import.meta.url);
const DOWN_URL = new URL("../migrations/20260809_001_causal_continuity_down.sql", import.meta.url);

export const CAUSAL_TABLES = Object.freeze([
  "core_projects", "core_project_aliases", "core_project_scope_resources", "core_project_state_snapshots",
  "core_genesis_intents", "core_intent_revisions", "core_intent_revision_edges", "core_decision_records",
  "core_decision_alternatives", "core_work_causal_bindings", "core_work_relationships", "core_changes",
  "core_change_artifacts", "core_change_state_transitions", "core_causal_obligations", "core_obligation_state_transitions", "core_obligation_edges",
  "core_evidence_contracts", "core_action_lease_bindings", "core_causal_contexts", "core_consumed_nonces",
  "core_reality_observations", "core_causal_reconciliations", "core_temporal_checks", "core_outcome_receipts",
  "core_gallery_entity_bindings", "core_causal_continuity_capsules", "core_conflict_records",
  "core_causal_feature_flags", "core_legacy_binding_resolutions", "core_causal_event_ledger",
  "core_causal_projection_outbox", "core_schema_migrations",
]);

const APPEND_ONLY_TABLES = Object.freeze([
  "core_genesis_intents", "core_intent_revision_edges", "core_decision_records", "core_decision_alternatives",
  "core_change_state_transitions", "core_obligation_state_transitions",
  "core_reality_observations", "core_causal_reconciliations", "core_outcome_receipts",
  "core_causal_continuity_capsules", "core_causal_event_ledger", "core_consumed_nonces",
]);

function migrationBlocks(sql) {
  const blocks = [];
  let mode = "transactional";
  let current = [];
  for (const line of String(sql).split(/\r?\n/)) {
    const marker = line.match(/^\s*--\s*causal-migration:(transactional|nontransactional)\s*$/);
    if (marker) {
      if (current.join("\n").trim()) blocks.push({ mode, sql: current.join("\n") });
      mode = marker[1];
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.join("\n").trim()) blocks.push({ mode, sql: current.join("\n") });
  return blocks;
}

function verifyReadback(readback, expectedDigest) {
  const missing = CAUSAL_TABLES.filter((name) => !readback.tables.includes(name));
  if (missing.length) throw new CausalContinuityError("CAUSAL_MIGRATION_READBACK_FAILED", "Required causal tables are missing", { missing });
  const missingGuards = APPEND_ONLY_TABLES.filter((name) => !readback.append_only_tables.includes(name));
  if (missingGuards.length) throw new CausalContinuityError("CAUSAL_MIGRATION_READBACK_FAILED", "Append-only guards are missing", { missing: missingGuards });
  if (readback.migration?.sql_digest !== expectedDigest) {
    throw new CausalContinuityError("CAUSAL_MIGRATION_DIGEST_MISMATCH");
  }
  if (!readback.event_actor_digest_column || !readback.nonce_context_fk || !readback.nonce_project_fk ||
      !readback.gallery_readback_digest_column || !readback.outbox_claim_columns || !readback.lifecycle_lease_columns ||
      !readback.gallery_ticket_index?.valid || !readback.gallery_ticket_index?.matches_expected) {
    throw new CausalContinuityError("CAUSAL_MIGRATION_READBACK_FAILED", "Causal hash/nonce integrity readback differs from contract");
  }
  if (readback.legacy_work_table_present) {
    if (!readback.legacy_project_column || !readback.legacy_project_fk) {
      throw new CausalContinuityError("CAUSAL_MIGRATION_READBACK_FAILED", "Legacy Work binding is incomplete");
    }
    if (!readback.legacy_project_index?.valid || !readback.legacy_project_index?.matches_expected) {
      throw new CausalContinuityError("CAUSAL_MIGRATION_READBACK_FAILED", "Legacy Work index readback differs from contract");
    }
  }
}

async function executeBlock(client, block) {
  if (block.mode === "nontransactional") {
    if (/core_continuity_works_tenant_project_uuid_idx/.test(block.sql)) {
      const legacy = await client.query("SELECT to_regclass('core_continuity_works') IS NOT NULL AS present");
      if (!legacy.rows[0]?.present) return;
    }
    await client.query(block.sql);
    return;
  }
  await client.query("BEGIN");
  try {
    await client.query(block.sql);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve the migration error */ }
    throw error;
  }
}

function legacyIndexDefinitionMatches(row) {
  const definition = String(row?.definition || "").replace(/\s+/g, " ").toLowerCase();
  const predicate = String(row?.predicate || "").replace(/[()\s]+/g, "").toLowerCase();
  return definition.includes("create index core_continuity_works_tenant_project_uuid_idx") &&
    definition.includes("core_continuity_works") &&
    definition.includes("using btree") &&
    definition.includes("(tenant_id, project_uuid)") &&
    predicate === "project_uuidisnotnull";
}

export function galleryTicketIndexDefinitionMatches(row) {
  const definition = String(row?.definition || "").replace(/\s+/g, " ").toLowerCase();
  return definition.includes("create index core_gallery_binding_tenant_ticket_idx") &&
    definition.includes("core_gallery_entity_bindings") && definition.includes("using btree") &&
    definition.includes("(tenant_id, ticket_id)") && !definition.includes(" where ");
}

export async function recoverInterruptedCausalLegacyIndex(client) {
  const legacy = await client.query("SELECT to_regclass('core_continuity_works') IS NOT NULL AS present");
  if (!legacy.rows[0]?.present) return { legacy_table_present: false, action: "SKIPPED" };
  const result = await client.query(`
    SELECT i.indisvalid AS valid,
           pg_get_indexdef(i.indexrelid) AS definition,
           pg_get_expr(i.indpred, i.indrelid) AS predicate,
           EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid) AS constraint_owned,
           EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.refobjid=i.indexrelid
                AND d.deptype NOT IN ('i','a')
           ) AS external_dependency
      FROM pg_class idx
      JOIN pg_index i ON i.indexrelid=idx.oid
     WHERE idx.relname='core_continuity_works_tenant_project_uuid_idx'
       AND idx.relnamespace=current_schema()::regnamespace
  `);
  const index = result.rows[0];
  if (!index) return { legacy_table_present: true, action: "CREATE" };
  if (!legacyIndexDefinitionMatches(index)) {
    throw new CausalContinuityError("CAUSAL_MIGRATION_INDEX_CONFLICT", "Migration-owned index name has a different definition");
  }
  if (index.valid === true) return { legacy_table_present: true, action: "REUSE_VALID" };
  if (index.constraint_owned === true || index.external_dependency === true) {
    throw new CausalContinuityError("CAUSAL_MIGRATION_INDEX_OWNERSHIP_UNCERTAIN", "Invalid index has dependent objects and cannot be recovered automatically");
  }
  await client.query("DROP INDEX CONCURRENTLY core_continuity_works_tenant_project_uuid_idx");
  return { legacy_table_present: true, action: "DROP_INVALID_EXACT" };
}

export function createCausalContinuityMigrator({ pool, connectionString } = {}) {
  if (!pool && !connectionString) throw new CausalContinuityError("CAUSAL_DATABASE_REQUIRED");
  const ownsPool = !pool;
  const db = pool || new Pool({ connectionString, max: 2, idleTimeoutMillis: 10_000 });

  async function readback(client = db) {
    const tableResult = await client.query(
      "SELECT relname FROM pg_class WHERE relkind IN ('r','p') AND relname = ANY($1::text[]) ORDER BY relname",
      [CAUSAL_TABLES],
    );
    const triggerResult = await client.query(
      `SELECT c.relname
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal
          AND t.tgname = c.relname || '_append_only'
          AND c.relname = ANY($1::text[])
        ORDER BY c.relname`,
      [APPEND_ONLY_TABLES],
    );
    const migrationResult = await client.query(
      "SELECT migration_id, sql_digest, application_state, checkpoint, started_at, completed_at FROM core_schema_migrations WHERE migration_id=$1",
      [CAUSAL_MIGRATION_ID],
    );
    const legacyResult = await client.query(`
      SELECT to_regclass('core_continuity_works') IS NOT NULL AS table_present,
             EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name='core_continuity_works'
                  AND column_name='project_uuid' AND data_type='uuid' AND is_nullable='YES'
             ) AS column_present,
             FALSE AS fk_present
    `);
    const fkResult = await client.query(`
      SELECT convalidated,confdeltype,pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conname='core_continuity_works_tenant_project_uuid_fk'
         AND conrelid=to_regclass('core_continuity_works')
         AND contype='f'
    `);
    const indexResult = await client.query(`
      SELECT i.indisvalid AS valid,
             pg_get_indexdef(i.indexrelid) AS definition,
             pg_get_expr(i.indpred, i.indrelid) AS predicate
       FROM pg_class idx
        JOIN pg_index i ON i.indexrelid=idx.oid
       WHERE idx.relname='core_continuity_works_tenant_project_uuid_idx'
         AND idx.relnamespace=current_schema()::regnamespace
    `);
    const galleryTicketIndexResult = await client.query(`
      SELECT i.indisvalid AS valid,pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_class gallery_idx
        JOIN pg_index i ON i.indexrelid=gallery_idx.oid
       WHERE gallery_idx.relname='core_gallery_binding_tenant_ticket_idx'
         AND gallery_idx.relnamespace=current_schema()::regnamespace
    `);
    const integrityResult = await client.query(`
      SELECT EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name='core_causal_event_ledger'
                  AND column_name='actor_provenance_digest' AND data_type='character'
             ) AS event_actor_digest_column,
             EXISTS (
               SELECT 1 FROM pg_constraint
                WHERE conrelid=to_regclass('core_consumed_nonces') AND contype='f'
                  AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (tenant_id, context_id)%'
             ) AS nonce_context_fk,
             EXISTS (
               SELECT 1 FROM pg_constraint
                WHERE conrelid=to_regclass('core_consumed_nonces') AND contype='f'
                  AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (tenant_id, project_id)%'
             ) AS nonce_project_fk,
             EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name='core_gallery_entity_bindings'
                  AND column_name='last_readback_digest' AND character_maximum_length=64
             ) AS gallery_readback_digest_column,
             (SELECT count(*)=3 FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name='core_causal_projection_outbox'
                  AND column_name IN ('max_attempts','claimed_by','last_attempt_at')) AS outbox_claim_columns,
             (SELECT count(*)=4 FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name='core_action_lease_bindings'
                  AND column_name IN ('obligation_ids','lease_purpose','lease_surfaces','authority_binding_digest')) AS lifecycle_lease_columns
    `);
    const index = indexResult.rows[0] || null;
    const galleryTicketIndex = galleryTicketIndexResult.rows[0] || null;
    const fk = fkResult.rows[0] || null;
    const fkDefinition = String(fk?.definition || "").replace(/\s+/g, " ").toLowerCase();
    return {
      schema_version: "causal_continuity_migration_readback_v1",
      migration_id: CAUSAL_MIGRATION_ID,
      tables: tableResult.rows.map((row) => row.relname),
      append_only_tables: triggerResult.rows.map((row) => row.relname),
      migration: migrationResult.rows[0] || null,
      legacy_work_table_present: legacyResult.rows[0]?.table_present === true,
      legacy_project_column: legacyResult.rows[0]?.column_present === true,
      legacy_project_fk: fk?.convalidated === true && fk?.confdeltype === "r" &&
        fkDefinition.includes("foreign key (tenant_id, project_uuid)") &&
        fkDefinition.includes("references core_projects(tenant_id, project_id)"),
      legacy_project_fk_definition: fk?.definition || null,
      legacy_project_index: index ? {
        valid: index.valid === true,
        definition: index.definition,
        predicate: index.predicate,
        matches_expected: legacyIndexDefinitionMatches(index),
      } : null,
      event_actor_digest_column: integrityResult.rows[0]?.event_actor_digest_column === true,
      nonce_context_fk: integrityResult.rows[0]?.nonce_context_fk === true,
      nonce_project_fk: integrityResult.rows[0]?.nonce_project_fk === true,
      gallery_readback_digest_column: integrityResult.rows[0]?.gallery_readback_digest_column === true,
      outbox_claim_columns: integrityResult.rows[0]?.outbox_claim_columns === true,
      lifecycle_lease_columns: integrityResult.rows[0]?.lifecycle_lease_columns === true,
      gallery_ticket_index: galleryTicketIndex ? {
        valid: galleryTicketIndex.valid === true,
        definition: galleryTicketIndex.definition,
        matches_expected: galleryTicketIndexDefinitionMatches(galleryTicketIndex),
      } : null,
    };
  }

  async function apply() {
    const sql = await readFile(UP_URL, "utf8");
    const sqlDigest = causalDigest({ migration_id: CAUSAL_MIGRATION_ID, sql });
    const client = await db.connect();
    let locked = false;
    try {
      await acquireBoundedMigrationLock(client, CAUSAL_MIGRATION_LOCK);
      locked = true;
      await ensureCoreSchemaMigrationRegistry(client);
      const existing = (await client.query(
        "SELECT * FROM core_schema_migrations WHERE migration_id=$1",
        [CAUSAL_MIGRATION_ID],
      )).rows[0];
      if (existing && existing.sql_digest !== sqlDigest) throw new CausalContinuityError("CAUSAL_MIGRATION_DIGEST_MISMATCH");
      if (existing?.application_state === "COMPLETED") {
        const verified = await readback(client);
        verifyReadback(verified, sqlDigest);
        return { applied: false, sql_digest: sqlDigest, readback: verified };
      }
      await client.query(
        `INSERT INTO core_schema_migrations (migration_id,sql_digest,application_state,checkpoint)
         VALUES ($1,$2,'APPLYING','LOCKED')
         ON CONFLICT (migration_id) DO UPDATE SET application_state='APPLYING'`,
        [CAUSAL_MIGRATION_ID, sqlDigest],
      );
      for (const [index, block] of migrationBlocks(sql).entries()) {
        if (block.mode === "nontransactional" && /core_continuity_works_tenant_project_uuid_idx/.test(block.sql)) {
          await recoverInterruptedCausalLegacyIndex(client);
        }
        await executeBlock(client, block);
        await client.query(
          "UPDATE core_schema_migrations SET checkpoint=$2 WHERE migration_id=$1",
          [CAUSAL_MIGRATION_ID, `${block.mode.toUpperCase()}_${index + 1}_APPLIED`],
        );
      }
      const verified = await readback(client);
      verifyReadback(verified, sqlDigest);
      await client.query(
        `UPDATE core_schema_migrations
            SET application_state='COMPLETED', checkpoint='READBACK_VERIFIED', completed_at=clock_timestamp(),
                verifier_evidence=$2::jsonb
          WHERE migration_id=$1`,
        [CAUSAL_MIGRATION_ID, JSON.stringify({ schema_version: verified.schema_version, tables: verified.tables })],
      );
      const finalReadback = await readback(client);
      return { applied: true, sql_digest: sqlDigest, readback: finalReadback };
    } catch (error) {
      try {
        await client.query(
          "UPDATE core_schema_migrations SET application_state='FAILED' WHERE migration_id=$1 AND application_state<>'COMPLETED'",
          [CAUSAL_MIGRATION_ID],
        );
      } catch { /* the original error is authoritative */ }
      throw error;
    } finally {
      if (locked) {
        try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [CAUSAL_MIGRATION_LOCK]); } catch { /* disconnect also releases it */ }
      }
      client.release();
    }
  }

  async function rollback() {
    const sql = await readFile(DOWN_URL, "utf8");
    const client = await db.connect();
    let locked = false;
    try {
      await acquireBoundedMigrationLock(client, CAUSAL_MIGRATION_LOCK);
      locked = true;
      for (const block of migrationBlocks(sql)) await executeBlock(client, block);
      return { rolled_back: true, migration_id: CAUSAL_MIGRATION_ID };
    } finally {
      if (locked) {
        try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [CAUSAL_MIGRATION_LOCK]); } catch { /* disconnect also releases it */ }
      }
      client.release();
    }
  }

  return {
    migration_id: CAUSAL_MIGRATION_ID,
    apply,
    rollback,
    readback,
    async close() { if (ownsPool) await db.end(); },
  };
}

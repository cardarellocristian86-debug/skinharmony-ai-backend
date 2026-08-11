import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { CAUSAL_SHARED_MIGRATION_LEDGER_COMPAT_SQL, CAUSAL_TABLES, createCausalContinuityMigrator, galleryTicketIndexDefinitionMatches, recoverInterruptedCausalLegacyIndex } from "../src/causalContinuityMigration.js";
import { createPostgresBootstrapAuthorityStore } from "../src/bootstrapAuthorityPostgresStore.js";

const COMPAT_TEST_DATABASE_URL = process.env.CAUSAL_COMPAT_TEST_DATABASE_URL || "";

async function withSchema(fn) {
  const target = new URL(COMPAT_TEST_DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(target.hostname), "compatibility database must be loopback-only");
  const schema = `causal_ledger_compat_${process.pid}_${crypto.randomBytes(4).toString("hex")}`;
  const admin = new Pool({ connectionString: COMPAT_TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: COMPAT_TEST_DATABASE_URL, max: 2, options: `-c search_path=${schema}` });
  try { await fn(pool, schema); } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

test("shared migration ledger compatibility extends the bootstrap-only schema before causal state access", () => {
  for (const column of ["applied_at", "sql_digest", "application_state", "checkpoint", "started_at", "completed_at", "verifier_evidence"]) {
    assert.match(CAUSAL_SHARED_MIGRATION_LEDGER_COMPAT_SQL, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.doesNotMatch(CAUSAL_SHARED_MIGRATION_LEDGER_COMPAT_SQL, /DROP COLUMN|DELETE FROM|ALTER COLUMN .* SET NOT NULL/i);
});

test("bootstrap compatibility migration preserves bootstrap rows while providing a causal-safe shared ledger", async () => {
  const sql = await readFile(new URL("../migrations/20260812_core_schema_migrations_compatibility.sql", import.meta.url), "utf8");
  assert.match(sql, /pg_advisory_xact_lock/);
  for (const column of ["applied_at", "sql_digest", "application_state", "checkpoint", "started_at", "completed_at", "verifier_evidence"]) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE core_schema_migrations/i);
});

test("PostgreSQL shared migration ledger supports bootstrap-first and causal-first initialization", {
  skip: !COMPAT_TEST_DATABASE_URL,
}, async () => {
  await withSchema(async (pool) => {
    const bootstrap = createPostgresBootstrapAuthorityStore({ pool });
    await bootstrap.initialize();
    const initial = await pool.query("SELECT migration_id, applied_at, sql_digest FROM core_schema_migrations ORDER BY migration_id");
    assert.ok(initial.rows.length >= 2);
    assert(initial.rows.every((row) => row.applied_at instanceof Date && row.sql_digest === null));
    const causal = createCausalContinuityMigrator({ pool });
    await causal.apply();
    const causalRow = (await pool.query("SELECT sql_digest, application_state, checkpoint FROM core_schema_migrations WHERE migration_id=$1", ["20260809_001_causal_continuity_v1"])).rows[0];
    assert.match(causalRow.sql_digest, /^[a-f0-9]{64}$/);
    assert.equal(causalRow.application_state, "COMPLETED");
    assert.equal(causalRow.checkpoint, "READBACK_VERIFIED");
  });
  await withSchema(async (pool) => {
    const causal = createCausalContinuityMigrator({ pool });
    await causal.apply();
    const bootstrap = createPostgresBootstrapAuthorityStore({ pool });
    await bootstrap.initialize();
    const rows = await pool.query("SELECT migration_id, applied_at FROM core_schema_migrations ORDER BY migration_id");
    assert.ok(rows.rows.some((row) => row.migration_id === "20260809_001_causal_continuity_v1"));
    assert.ok(rows.rows.some((row) => row.migration_id === "20260810_bootstrap_authority_registry_v2_security"));
  });
});

test("migration is additive, tenant-composite, append-only and validates the legacy FK", async () => {
  const up = await readFile(new URL("../migrations/20260809_001_causal_continuity_up.sql", import.meta.url), "utf8");
  const down = await readFile(new URL("../migrations/20260809_001_causal_continuity_down.sql", import.meta.url), "utf8");
  assert.match(up, /PRIMARY KEY \(tenant_id, project_id\)/);
  assert.match(up, /FOREIGN KEY \(tenant_id, project_id\)/);
  assert.match(up, /UNIQUE \(tenant_id, project_id, operation, idempotency_key\)/);
  assert.match(up, /CREATE INDEX CONCURRENTLY IF NOT EXISTS core_continuity_works_tenant_project_uuid_idx/);
  assert.match(up, /NOT VALID/);
  assert.match(up, /VALIDATE CONSTRAINT core_continuity_works_tenant_project_uuid_fk/);
  assert.match(up, /core_causal_append_only_guard/);
  assert.match(up, /'core_consumed_nonces'/);
  assert.match(up, /FOREIGN KEY \(tenant_id, context_id\) REFERENCES core_causal_contexts/);
  assert.match(up, /actor_provenance_digest CHAR\(64\) NOT NULL/);
  assert.match(up, /last_readback_digest CHAR\(64\)/);
  assert.match(up, /max_attempts INTEGER NOT NULL DEFAULT 5/);
  assert.match(up, /claimed_by TEXT/);
  assert.match(up, /CREATE TABLE IF NOT EXISTS core_obligation_state_transitions/);
  assert.match(up, /obligation_ids JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(up, /lease_purpose TEXT NOT NULL DEFAULT 'legacy_unproven'/);
  assert.match(up, /authority_binding_digest CHAR\(64\)/);
  assert.match(up, /CREATE INDEX IF NOT EXISTS core_gallery_binding_tenant_ticket_idx ON core_gallery_entity_bindings \(tenant_id, ticket_id\)/);
  assert.match(up, /CREATE INDEX IF NOT EXISTS core_conflict_project_work_idx ON core_conflict_records \(tenant_id, project_id, work_id, created_at DESC\)/);
  assert.match(down, /CAUSAL_DOWN_MIGRATION_REFUSED_AUTHORITATIVE_ROWS/);
  assert.match(down, /DELETE FROM core_schema_migrations WHERE migration_id='20260809_001_causal_continuity_v1'/);
  assert.doesNotMatch(up, /DROP TABLE/i);
});

test("migration runner supports apply then empty down then clean re-apply", async () => {
  const state = { installed: false, migration: null, applyCount: 0, released: 0 };
  const client = {
    async query(sql, params = []) {
      const query = String(sql);
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK" || query.includes("pg_advisory_lock") || query.includes("pg_advisory_unlock")) return { rows: [] };
      if (query.includes("CREATE TABLE IF NOT EXISTS core_schema_migrations") && query.includes("core_projects")) {
        state.installed = true; state.applyCount += 1; return { rows: [] };
      }
      if (query.includes("migration_id_valid")) return { rows: [{ migration_id_valid: true, applied_at_valid: true, sql_digest_valid: true, application_state_valid: true, checkpoint_valid: true, started_at_valid: true, completed_at_valid: true, verifier_evidence_valid: true }] };
      if (query.includes("DROP TABLE IF EXISTS core_projects") && query.includes("DELETE FROM core_schema_migrations")) {
        state.installed = false; state.migration = null; return { rows: [] };
      }
      if (query.includes("CREATE TABLE IF NOT EXISTS core_schema_migrations")) return { rows: [] };
      if (query.includes("SELECT * FROM core_schema_migrations")) return { rows: state.migration ? [state.migration] : [] };
      if (query.includes("INSERT INTO core_schema_migrations")) {
        state.migration = { migration_id: params[0], sql_digest: params[1], application_state: "APPLYING", checkpoint: "LOCKED" };
        return { rows: [] };
      }
      if (query.includes("UPDATE core_schema_migrations SET checkpoint")) {
        if (state.migration) state.migration.checkpoint = params[1];
        return { rows: [] };
      }
      if (query.includes("SET application_state='COMPLETED'")) {
        state.migration.application_state = "COMPLETED"; state.migration.checkpoint = "READBACK_VERIFIED";
        return { rows: [] };
      }
      if (query.includes("SET application_state='FAILED'")) { if (state.migration) state.migration.application_state = "FAILED"; return { rows: [] }; }
      if (query.includes("SELECT migration_id, sql_digest")) return { rows: state.migration ? [state.migration] : [] };
      if (query.includes("relkind IN ('r','p')")) return { rows: state.installed ? CAUSAL_TABLES.map((relname) => ({ relname })) : [] };
      if (query.includes("FROM pg_trigger")) return { rows: state.installed ? (params[0] || []).map((relname) => ({ relname })) : [] };
      if (query.includes("core_causal_event_ledger") && query.includes("actor_provenance_digest")) return { rows: [{ event_actor_digest_column: state.installed, nonce_context_fk: state.installed, nonce_project_fk: state.installed, gallery_readback_digest_column: state.installed, outbox_claim_columns: state.installed, lifecycle_lease_columns: state.installed }] };
      if (query.includes("gallery_idx.relname='core_gallery_binding_tenant_ticket_idx'")) return { rows: state.installed ? [{ valid: true, definition: "CREATE INDEX core_gallery_binding_tenant_ticket_idx ON public.core_gallery_entity_bindings USING btree (tenant_id, ticket_id)" }] : [] };
      if (query.includes("information_schema.columns")) return { rows: [{ table_present: false, column_present: false, fk_present: false }] };
      if (query.includes("FROM pg_constraint") || query.includes("FROM pg_class idx")) return { rows: [] };
      if (query.includes("to_regclass('core_continuity_works')")) return { rows: [{ present: false }] };
      return { rows: [] };
    },
    release() { state.released += 1; },
  };
  const pool = { async connect() { return client; }, query: (...args) => client.query(...args) };
  const migrator = createCausalContinuityMigrator({ pool });
  const first = await migrator.apply();
  assert.equal(first.applied, true);
  await migrator.rollback();
  assert.equal(state.migration, null);
  const second = await migrator.apply();
  assert.equal(second.applied, true);
  assert.equal(state.applyCount, 2);
  assert.equal(state.released, 3);
});

test("migration runner reconciles a bootstrap-only ledger before selecting causal fields", async () => {
  const calls = [];
  let compatibilityApplied = false;
  const client = {
    async query(sql, params = []) {
      const query = String(sql);
      calls.push(query);
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK" || query.includes("pg_advisory_lock") || query.includes("pg_advisory_unlock")) return { rows: [] };
      if (query.includes("CREATE TABLE IF NOT EXISTS core_schema_migrations") && !query.includes("core_projects")) return { rows: [] };
      if (query.includes("ADD COLUMN IF NOT EXISTS sql_digest")) { compatibilityApplied = true; return { rows: [] }; }
      if (query.includes("migration_id_valid")) return { rows: [{ migration_id_valid: true, applied_at_valid: true, sql_digest_valid: true, application_state_valid: true, checkpoint_valid: true, started_at_valid: true, completed_at_valid: true, verifier_evidence_valid: true }] };
      if (query.includes("SELECT * FROM core_schema_migrations")) {
        assert.equal(compatibilityApplied, true, "causal state must not be read before ledger compatibility is applied");
        return { rows: [{ migration_id: "20260809_001_causal_continuity_v1", sql_digest: "different".repeat(8).slice(0, 64), application_state: "COMPLETED" }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  await assert.rejects(() => createCausalContinuityMigrator({ pool }).apply(), /CAUSAL_MIGRATION_DIGEST_MISMATCH/);
  assert.equal(calls.findIndex((query) => query.includes("ADD COLUMN IF NOT EXISTS sql_digest")) < calls.findIndex((query) => query.includes("SELECT \* FROM core_schema_migrations")), true);
});

test("migration runner rejects a conflicting shared ledger shape before causal state access", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      const query = String(sql);
      calls.push(query);
      if (query.includes("pg_advisory_lock") || query.includes("pg_advisory_unlock")) return { rows: [] };
      if (query.includes("migration_id_valid")) return { rows: [{ migration_id_valid: true, applied_at_valid: true, sql_digest_valid: false, application_state_valid: true, checkpoint_valid: true, started_at_valid: true, completed_at_valid: true, verifier_evidence_valid: true }] };
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(() => createCausalContinuityMigrator({ pool: { async connect() { return client; } } }).apply(), /CAUSAL_SHARED_MIGRATION_LEDGER_SCHEMA_CONFLICT/);
  assert.equal(calls.some((query) => query.includes("SELECT * FROM core_schema_migrations")), false);
});

test("interrupted invalid exact index is dropped under the pinned session and retry can recreate it", async () => {
  let indexState = "invalid";
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(String(sql).replace(/\s+/g, " ").trim());
      if (String(sql).includes("to_regclass('core_continuity_works')")) return { rows: [{ present: true }] };
      if (String(sql).includes("FROM pg_class idx")) {
        if (indexState === "missing") return { rows: [] };
        return { rows: [{
          valid: false,
          definition: "CREATE INDEX core_continuity_works_tenant_project_uuid_idx ON public.core_continuity_works USING btree (tenant_id, project_uuid) WHERE (project_uuid IS NOT NULL)",
          predicate: "(project_uuid IS NOT NULL)",
          constraint_owned: false,
          external_dependency: false,
        }] };
      }
      if (String(sql).startsWith("DROP INDEX CONCURRENTLY")) { indexState = "missing"; return { rows: [] }; }
      return { rows: [] };
    },
  };
  const recovered = await recoverInterruptedCausalLegacyIndex(client);
  assert.equal(recovered.action, "DROP_INVALID_EXACT");
  assert(calls.some((sql) => sql === "DROP INDEX CONCURRENTLY core_continuity_works_tenant_project_uuid_idx"));
  const retry = await recoverInterruptedCausalLegacyIndex(client);
  assert.equal(retry.action, "CREATE");
});

test("invalid index with dependency or changed definition fails closed", async () => {
  for (const row of [
    { valid: false, definition: "CREATE INDEX different ON core_continuity_works (tenant_id)", predicate: null, constraint_owned: false, external_dependency: false },
    { valid: false, definition: "CREATE INDEX core_continuity_works_tenant_project_uuid_idx ON core_continuity_works (tenant_id, project_uuid) WHERE project_uuid IS NOT NULL", predicate: "project_uuid IS NOT NULL", constraint_owned: true, external_dependency: false },
  ]) {
    const client = { async query(sql) { return String(sql).includes("to_regclass") ? { rows: [{ present: true }] } : { rows: [row] }; } };
    await assert.rejects(() => recoverInterruptedCausalLegacyIndex(client), (error) => error.code.startsWith("CAUSAL_MIGRATION_INDEX_"));
  }
});

test("Gallery ticket verification index readback requires the exact ordered key", () => {
  assert.equal(galleryTicketIndexDefinitionMatches({
    definition: "CREATE INDEX core_gallery_binding_tenant_ticket_idx ON public.core_gallery_entity_bindings USING btree (tenant_id, ticket_id)",
  }), true);
  for (const definition of [
    "CREATE INDEX core_gallery_binding_tenant_ticket_idx ON core_gallery_entity_bindings USING btree (ticket_id, tenant_id)",
    "CREATE INDEX core_gallery_binding_tenant_ticket_idx ON core_gallery_entity_bindings USING btree (tenant_id, ticket_id, status)",
    "CREATE INDEX core_gallery_binding_tenant_ticket_idx ON core_gallery_entity_bindings USING btree (tenant_id, ticket_id) WHERE status = 'ACTIVE'",
  ]) assert.equal(galleryTicketIndexDefinitionMatches({ definition }), false);
});

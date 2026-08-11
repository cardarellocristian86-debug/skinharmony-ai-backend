import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CAUSAL_TABLES, createCausalContinuityMigrator, galleryTicketIndexDefinitionMatches, recoverInterruptedCausalLegacyIndex } from "../src/causalContinuityMigration.js";

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
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK" || query.startsWith("SET LOCAL ") ||
          query.includes("pg_advisory_lock") || query.includes("pg_advisory_xact_lock") || query.includes("pg_advisory_unlock")) return { rows: [] };
      if (query.includes("FROM information_schema.columns") && query.includes("core_schema_migrations")) {
        return { rows: [
          { column_name: "migration_id", data_type: "character varying", character_maximum_length: 160, is_nullable: "NO", column_default: null },
          { column_name: "applied_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "NO", column_default: "now()" },
          { column_name: "sql_digest", data_type: "character", character_maximum_length: 64, is_nullable: "YES", column_default: null },
          { column_name: "application_state", data_type: "text", character_maximum_length: null, is_nullable: "YES", column_default: null },
          { column_name: "checkpoint", data_type: "text", character_maximum_length: null, is_nullable: "YES", column_default: null },
          { column_name: "started_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "NO", column_default: "clock_timestamp()" },
          { column_name: "completed_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "YES", column_default: null },
          { column_name: "verifier_evidence", data_type: "jsonb", character_maximum_length: null, is_nullable: "NO", column_default: "'{}'::jsonb" },
        ] };
      }
      if (query.includes("FROM pg_constraint constraint_row")) return { rows: [{ column_name: "migration_id" }] };
      if (query.includes("CREATE TABLE IF NOT EXISTS core_schema_migrations") && query.includes("core_projects")) {
        state.installed = true; state.applyCount += 1; return { rows: [] };
      }
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

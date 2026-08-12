import assert from "node:assert/strict";
import test from "node:test";

import {
  CORE_SCHEMA_MIGRATION_REGISTRY_LOCK,
  acquireBoundedMigrationLock,
  ensureCoreSchemaMigrationRegistry,
} from "../src/coreSchemaMigrationRegistry.js";

function compatibleColumns() {
  return [
    { column_name: "migration_id", data_type: "character varying", character_maximum_length: 160, is_nullable: "NO", column_default: null },
    { column_name: "applied_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "NO", column_default: "now()" },
    { column_name: "sql_digest", data_type: "character", character_maximum_length: 64, is_nullable: "YES", column_default: null },
    { column_name: "application_state", data_type: "text", character_maximum_length: null, is_nullable: "YES", column_default: null },
    { column_name: "checkpoint", data_type: "text", character_maximum_length: null, is_nullable: "YES", column_default: null },
    { column_name: "started_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "NO", column_default: "clock_timestamp()" },
    { column_name: "completed_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "YES", column_default: null },
    { column_name: "verifier_evidence", data_type: "jsonb", character_maximum_length: null, is_nullable: "NO", column_default: "'{}'::jsonb" },
  ];
}

function registryClient(columns = compatibleColumns()) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const query = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ query, params });
      if (query.includes("FROM information_schema.columns")) return { rows: columns };
      if (query.includes("FROM pg_constraint constraint_row")) {
        return { rows: [{ column_name: "migration_id" }] };
      }
      return { rows: [] };
    },
  };
}

test("shared migration registry upgrade is additive, bounded and keeps MCP one-column inserts valid", async () => {
  const client = registryClient();
  const result = await ensureCoreSchemaMigrationRegistry(client, {
    lockTimeoutMs: 2_000,
    statementTimeoutMs: 7_000,
  });

  assert.equal(result.schema_version, "core_schema_migration_registry_compat_v1");
  assert.equal(result.legacy_mcp_insert_compatible, true);
  assert.deepEqual(client.calls.slice(0, 4), [
    { query: "BEGIN", params: [] },
    { query: "SET LOCAL lock_timeout = '2000ms'", params: [] },
    { query: "SET LOCAL statement_timeout = '7000ms'", params: [] },
    {
      query: "SELECT pg_advisory_xact_lock(hashtext($1))",
      params: [CORE_SCHEMA_MIGRATION_REGISTRY_LOCK],
    },
  ]);
  assert(client.calls.some(({ query }) =>
    query.includes("ALTER COLUMN sql_digest DROP NOT NULL") &&
    query.includes("ADD COLUMN IF NOT EXISTS applied_at")));
  assert.equal(client.calls.at(-1).query, "COMMIT");
});

test("shared migration registry fails closed when an existing column has an unsafe type", async () => {
  const columns = compatibleColumns().map((column) =>
    column.column_name === "sql_digest" ? { ...column, data_type: "text" } : column);
  const client = registryClient(columns);

  await assert.rejects(
    ensureCoreSchemaMigrationRegistry(client),
    (error) => error.code === "CAUSAL_MIGRATION_REGISTRY_INCOMPATIBLE" &&
      error.details?.incompatible?.includes("sql_digest"),
  );
  assert.equal(client.calls.at(-1).query, "ROLLBACK");
});

test("shared migration registry accepts text or wide varchar ids and rejects varchar(1)", async () => {
  for (const migrationId of [
    { data_type: "text", character_maximum_length: null },
    { data_type: "character varying", character_maximum_length: 160 },
    { data_type: "character varying", character_maximum_length: 512 },
    { data_type: "character varying", character_maximum_length: null },
  ]) {
    const columns = compatibleColumns().map((column) =>
      column.column_name === "migration_id" ? { ...column, ...migrationId } : column);
    const client = registryClient(columns);
    await assert.doesNotReject(ensureCoreSchemaMigrationRegistry(client));
  }

  const narrowColumns = compatibleColumns().map((column) =>
    column.column_name === "migration_id"
      ? { ...column, data_type: "character varying", character_maximum_length: 1 }
      : column);
  const narrowClient = registryClient(narrowColumns);
  await assert.rejects(
    ensureCoreSchemaMigrationRegistry(narrowClient),
    (error) => error.code === "CAUSAL_MIGRATION_REGISTRY_INCOMPATIBLE" &&
      error.details?.incompatible?.includes("migration_id"),
  );
  assert.equal(narrowClient.calls.at(-1).query, "ROLLBACK");
});

test("shared migration registry rejects required extra columns without a default", async () => {
  const requiredExtra = {
    column_name: "future_required_state",
    data_type: "text",
    character_maximum_length: null,
    is_nullable: "NO",
    column_default: null,
  };
  const incompatibleClient = registryClient([...compatibleColumns(), requiredExtra]);
  await assert.rejects(
    ensureCoreSchemaMigrationRegistry(incompatibleClient),
    (error) => error.code === "CAUSAL_MIGRATION_REGISTRY_INCOMPATIBLE" &&
      error.details?.incompatible?.includes("future_required_state"),
  );

  const compatibleClient = registryClient([
    ...compatibleColumns(),
    { ...requiredExtra, column_default: "'PENDING'::text" },
  ]);
  await assert.doesNotReject(ensureCoreSchemaMigrationRegistry(compatibleClient));
});

test("shared migration registry rejects noncanonical or verified-looking metadata defaults", async () => {
  const unsafeDefaults = [
    ["applied_at", "clock_timestamp()"],
    ["sql_digest", `'${"a".repeat(64)}'::bpchar`],
    ["application_state", "'COMPLETED'::text"],
    ["checkpoint", "'READBACK_VERIFIED'::text"],
    ["started_at", "now()"],
    ["completed_at", "now()"],
    ["verifier_evidence", `'${JSON.stringify({ verified: true })}'::jsonb`],
  ];
  for (const [columnName, columnDefault] of unsafeDefaults) {
    const columns = compatibleColumns().map((column) =>
      column.column_name === columnName
        ? { ...column, column_default: columnDefault }
        : column);
    const client = registryClient(columns);
    await assert.rejects(
      ensureCoreSchemaMigrationRegistry(client),
      (error) => error.code === "CAUSAL_MIGRATION_REGISTRY_INCOMPATIBLE" &&
        error.details?.incompatible?.includes(columnName),
      `expected ${columnName} default ${columnDefault} to fail closed`,
    );
  }
});

test("session migration lock wait is bounded and reports a deterministic timeout", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      const query = String(sql).replace(/\s+/g, " ").trim();
      calls.push(query);
      if (query.includes("pg_advisory_lock")) {
        const error = new Error("canceling statement due to statement timeout");
        error.code = "57014";
        throw error;
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    acquireBoundedMigrationLock(client, "migration:test", {
      lockTimeoutMs: 1_000,
      statementTimeoutMs: 1_500,
    }),
    (error) => error.code === "CAUSAL_MIGRATION_LOCK_TIMEOUT" &&
      error.details?.statement_timeout_ms === 1_500,
  );
  assert.equal(calls.at(-1), "ROLLBACK");
});

test("session migration lock is released without masking a commit failure", async () => {
  const calls = [];
  const commitError = new Error("commit failed after advisory lock acquisition");
  commitError.code = "XX000";
  const client = {
    async query(sql, params = []) {
      const query = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ query, params });
      if (query === "COMMIT") throw commitError;
      return { rows: [] };
    },
  };

  await assert.rejects(
    acquireBoundedMigrationLock(client, "migration:commit-failure"),
    (error) => error === commitError,
  );
  assert.deepEqual(calls.slice(-2), [
    { query: "ROLLBACK", params: [] },
    {
      query: "SELECT pg_advisory_unlock(hashtext($1))",
      params: ["migration:commit-failure"],
    },
  ]);
});

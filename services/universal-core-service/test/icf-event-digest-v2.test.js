import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildIcfEventDigestReanchorPayloadV2,
  canonicalIcfEventJson,
  ICF_EVENT_DIGEST_CONTRACT_LEGACY_V1,
  ICF_EVENT_DIGEST_CONTRACT_V2,
  ICF_EVENT_REANCHOR_TYPE_V2,
  icfEventDigestV2,
  icfEventPayloadDigestV2,
} from "../src/icfEventDigest.js";
import {
  createIcfPostgresStore,
  ICF_EVENT_DIGEST_MIGRATION_ID,
  ICF_POSTGRES_SCHEMA,
} from "../src/icfPostgresStore.js";

function fakePool(currentRow = null) {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, values = []) {
      const statement = String(sql);
      queries.push({ sql: statement, values });
      if (/SELECT version, ledger_head_digest/u.test(statement)) {
        return { rows: currentRow ? [currentRow] : [], rowCount: currentRow ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; },
  };
  return {
    value: {
      async query(sql, values = []) {
        queries.push({ sql: String(sql), values });
        return { rows: [], rowCount: 0 };
      },
      async connect() { return client; },
    },
    queries,
    released: () => released,
  };
}

function governedMigrationPool({ tamperTargetConstraint = false } = {}) {
  const queries = [];
  let released = false;
  let schemaApplied = false;
  let migration = null;
  const compatibleRegistryColumns = [
    { column_name: "migration_id", data_type: "character varying", character_maximum_length: 160, is_nullable: "NO", column_default: null },
    { column_name: "applied_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "NO", column_default: "now()" },
    { column_name: "sql_digest", data_type: "character", character_maximum_length: 64, is_nullable: "YES", column_default: null },
    { column_name: "application_state", data_type: "text", character_maximum_length: null, is_nullable: "YES", column_default: null },
    { column_name: "checkpoint", data_type: "text", character_maximum_length: null, is_nullable: "YES", column_default: null },
    { column_name: "started_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "NO", column_default: "clock_timestamp()" },
    { column_name: "completed_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "YES", column_default: null },
    { column_name: "verifier_evidence", data_type: "jsonb", character_maximum_length: null, is_nullable: "NO", column_default: "'{}'::jsonb" },
  ];
  const column = (tableName, columnName, ordinalPosition, dataType, udtName,
    characterMaximumLength = null) => ({
    table_name: tableName,
    column_name: columnName,
    ordinal_position: ordinalPosition,
    data_type: dataType,
    udt_schema: "pg_catalog",
    udt_name: udtName,
    character_maximum_length: characterMaximumLength,
    is_nullable: "YES",
    column_default: null,
    is_identity: "NO",
    identity_generation: null,
    is_generated: "NEVER",
    generation_expression: null,
  });
  const digestColumns = [
    column("core_icf_event", "digest_contract", 9, "text", "text"),
    column("core_icf_event", "canonicalization_version", 10, "text", "text"),
    column("core_icf_event", "digest_algorithm", 11, "text", "text"),
    column("core_icf_event", "payload_digest", 12, "character", "bpchar", 64),
    column("core_icf_event", "previous_digest_contract", 13, "text", "text"),
    column("core_icf_work", "ledger_head_digest_contract", 7, "text", "text"),
  ];
  const validConstraints = [
    {
      table_name: "core_icf_event",
      conname: "core_icf_event_digest_contract_v2_ck",
      contype: "c",
      condeferrable: false,
      condeferred: false,
      convalidated: true,
      connoinherit: false,
      constraint_schema_is_local: true,
      check_expression: "digest_contract IS NULL AND canonicalization_version IS NULL OR digest_contract = 'nyra.icf.event-digest/canonical-json-v2'::text AND canonicalization_version = 'nyra.icf.canonical-json/2.0'::text AND digest_algorithm = 'sha256'::text AND payload_digest ~ '^[a-f0-9]{64}$'::text",
    },
    {
      table_name: "core_icf_work",
      conname: "core_icf_work_head_digest_contract_v2_ck",
      contype: "c",
      condeferrable: false,
      condeferred: false,
      convalidated: true,
      connoinherit: false,
      constraint_schema_is_local: true,
      check_expression: "ledger_head_digest_contract IS NULL OR ledger_head_digest_contract = 'nyra.icf.event-digest/canonical-json-v2'::text",
    },
  ];
  const client = {
    async query(sql, values = []) {
      const statement = typeof sql === "string" ? sql : String(sql?.text || "");
      if (!values.length && Array.isArray(sql?.values)) values = sql.values;
      const normalized = statement.replace(/\s+/gu, " ").trim();
      queries.push({ sql: statement, normalized, values,
        query_timeout: typeof sql === "object" ? sql.query_timeout : null });
      if (normalized.includes("FROM information_schema.columns")
        && normalized.includes("table_name='core_schema_migrations'")) {
        return { rows: compatibleRegistryColumns };
      }
      if (normalized.includes("FROM pg_constraint constraint_row")) {
        return { rows: [{ column_name: "migration_id" }] };
      }
      if (normalized === "SELECT current_schema() AS schema_name") {
        return { rows: [{ schema_name: "public" }] };
      }
      if (normalized.includes("FROM information_schema.columns")
        && normalized.includes("core_icf_work")) {
        return { rows: schemaApplied ? digestColumns : [] };
      }
      if (normalized.includes("FROM pg_constraint con")
        && normalized.includes("con.conname=ANY")) {
        const schemaName = values[0];
        const constraints = validConstraints.map((row) => ({ ...row }));
        if (tamperTargetConstraint && schemaName === "public") {
          constraints[0].check_expression = `true OR (${constraints[0].check_expression})`;
        }
        return { rows: schemaApplied ? constraints : [] };
      }
      if (normalized.includes("FROM core_schema_migrations WHERE migration_id=$1")) {
        return { rows: migration ? [{ ...migration }] : [], rowCount: migration ? 1 : 0 };
      }
      if (normalized.startsWith("INSERT INTO core_schema_migrations")) {
        migration = { migration_id: values[0], sql_digest: values[1],
          application_state: "APPLYING", checkpoint: "REGISTRY_VERIFIED" };
      } else if (normalized.includes("SET checkpoint='SCHEMA_APPLIED'")) {
        migration.checkpoint = "SCHEMA_APPLIED";
      } else if (normalized.includes("SET application_state='COMPLETED'")) {
        migration.application_state = "COMPLETED";
        migration.checkpoint = "READBACK_VERIFIED";
      } else if (normalized.startsWith("BEGIN;")
        && normalized.includes("legacy JSON.stringify digest contract")) {
        schemaApplied = true;
      }
      return { rows: [], rowCount: 1 };
    },
    release() { released = true; },
  };
  return {
    value: {
      async query(sql, values = []) { return client.query(sql, values); },
      async connect() { return client; },
    },
    queries,
    released: () => released,
  };
}

test("ICF canonical v2 sorts nested object keys and preserves array order", () => {
  const zetaFirst = {
    zeta: { zeta: "last", alpha: "first" },
    alpha: [{ zeta: 2, alpha: 1 }, "tail"],
  };
  const alphaFirst = {
    alpha: [{ alpha: 1, zeta: 2 }, "tail"],
    zeta: { alpha: "first", zeta: "last" },
  };
  assert.equal(canonicalIcfEventJson(zetaFirst), canonicalIcfEventJson(alphaFirst));
  assert.equal(icfEventPayloadDigestV2(zetaFirst), icfEventPayloadDigestV2(alphaFirst));
  assert.notEqual(icfEventPayloadDigestV2({ alpha: [1, 2] }),
    icfEventPayloadDigestV2({ alpha: [2, 1] }));
  assert.throws(() => canonicalIcfEventJson({ invalid: Number.NaN }),
    /icf_event_canonical_value_invalid/u);
});

test("ICF PostgreSQL writer persists only recalculable canonical-v2 metadata", async () => {
  const fake = fakePool();
  const store = createIcfPostgresStore({ pool: fake.value });
  const payload = { zeta: { zeta: 2, alpha: 1 }, alpha: [{ zeta: 4, alpha: 3 }] };
  const result = await store.appendEvent({ tenantId: "tenant-a", workId: "work-a",
    eventType: "STATE_BOUND", payload });
  const eventInsert = fake.queries.find(({ sql }) => /INSERT INTO core_icf_event/u.test(sql));
  assert.ok(eventInsert);
  assert.deepEqual(eventInsert.values[4], {
    alpha: [{ alpha: 3, zeta: 4 }],
    zeta: { alpha: 1, zeta: 2 },
  });
  assert.equal(eventInsert.values[7], ICF_EVENT_DIGEST_CONTRACT_V2);
  assert.equal(eventInsert.values[10], icfEventPayloadDigestV2(payload));
  assert.equal(result.digest, icfEventDigestV2({ tenantId: "tenant-a", workId: "work-a",
    seq: 1, eventType: "STATE_BOUND", payload, previous: null,
    previousDigestContract: null }));
  assert.equal(result.digest_contract, ICF_EVENT_DIGEST_CONTRACT_V2);
  assert.equal(result.previous_digest_contract, null);
  assert.equal(fake.released(), true);
});

test("legacy ICF head upgrades by forward append without rewriting prior events", async () => {
  const legacyHead = "a".repeat(64);
  const fake = fakePool({ version: 7, ledger_head_digest: legacyHead,
    ledger_head_digest_contract: null });
  const store = createIcfPostgresStore({ pool: fake.value });
  const payload = buildIcfEventDigestReanchorPayloadV2(legacyHead);
  const result = await store.appendEvent({ tenantId: "tenant-a", workId: "work-a",
    eventType: ICF_EVENT_REANCHOR_TYPE_V2, payload });

  assert.equal(result.seq, 8);
  assert.equal(result.previous_digest, legacyHead);
  assert.equal(result.previous_digest_contract, ICF_EVENT_DIGEST_CONTRACT_LEGACY_V1);
  assert.equal(fake.queries.some(({ sql }) =>
    /UPDATE\s+core_icf_event|DELETE\s+FROM\s+core_icf_event/iu.test(sql)), false);
  const eventInsert = fake.queries.find(({ sql }) => /INSERT INTO core_icf_event/u.test(sql));
  assert.equal(eventInsert.values[11], ICF_EVENT_DIGEST_CONTRACT_LEGACY_V1);
  assert.equal(result.digest, icfEventDigestV2({ tenantId: "tenant-a", workId: "work-a",
    seq: 8, eventType: ICF_EVENT_REANCHOR_TYPE_V2, payload, previous: legacyHead,
    previousDigestContract: ICF_EVENT_DIGEST_CONTRACT_LEGACY_V1 }));
});

test("ICF digest v2 migration is additive and never rewrites legacy events", async () => {
  const migration = await readFile(new URL(
    "../migrations/20260825_002_icf_event_digest_v2.sql", import.meta.url), "utf8");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS digest_contract text/u);
  assert.match(migration, /canonical-json-v2/u);
  assert.match(migration, /legacy unverifiable json-stringify-v1/u);
  assert.doesNotMatch(migration, /UPDATE\s+core_icf_event|DELETE\s+FROM\s+core_icf_event|TRUNCATE\s+core_icf_event/iu);
  assert.equal(ICF_EVENT_DIGEST_MIGRATION_ID, "20260825_002_icf_event_digest_v2");
  assert.doesNotMatch(ICF_POSTGRES_SCHEMA,
    /digest_contract|canonicalization_version|payload_digest/u,
    "startup bootstrap must not duplicate the governed v2 migration");
});

test("ICF store governs the checked-in v2 migration through terminal readback", async () => {
  const fake = governedMigrationPool();
  const expectedSql = await readFile(new URL(
    "../migrations/20260825_002_icf_event_digest_v2.sql", import.meta.url), "utf8");
  const store = createIcfPostgresStore({ pool: fake.value });
  const first = await store.initialize();
  const second = await store.initialize();

  assert.equal(first.migration.application_state, "COMPLETED");
  assert.equal(first.migration.checkpoint, "READBACK_VERIFIED");
  assert.strictEqual(second, first, "successful initialization readback is stable");
  assert.equal(store.ready, true);
  assert.equal(store.initialized, true);
  assert.equal(store.initialization_state, "ready");
  assert.equal(store.health().migration.migration_id, ICF_EVENT_DIGEST_MIGRATION_ID);
  assert.equal(store.health().migration.application_state, "COMPLETED");
  assert.equal(store.health().migration.checkpoint, "READBACK_VERIFIED");
  assert.match(store.health().migration.sql_digest, /^[a-f0-9]{64}$/u);
  assert.equal(fake.queries.filter(({ sql }) => sql === expectedSql).length, 1,
    "the checked-in migration is the only v2 DDL executed");
  assert.equal(fake.queries.find(({ sql }) => sql === expectedSql).query_timeout, 30_000);
  assert(fake.queries.some(({ normalized }) =>
    normalized.includes("application_state='COMPLETED',checkpoint='READBACK_VERIFIED'")));
  assert.equal(fake.released(), true);
});

test("ICF startup rejects a tautological constraint even when all contract tokens remain", async () => {
  const fake = governedMigrationPool({ tamperTargetConstraint: true });
  const store = createIcfPostgresStore({ pool: fake.value });

  await assert.rejects(store.initialize(), (error) => {
    assert.equal(error.code, "icf_event_digest_v2_schema_manifest_mismatch");
    assert.match(error.details.observed_schema_manifest_digest, /^[a-f0-9]{64}$/u);
    assert.match(error.details.expected_schema_manifest_digest, /^[a-f0-9]{64}$/u);
    assert.notEqual(error.details.observed_schema_manifest_digest,
      error.details.expected_schema_manifest_digest);
    return true;
  });
  assert.equal(store.health().ready, false);
  assert.equal(store.health().state, "failed");
  assert.equal(store.health().error, "icf_event_digest_v2_schema_manifest_mismatch");
  assert.equal(fake.released(), true);
});

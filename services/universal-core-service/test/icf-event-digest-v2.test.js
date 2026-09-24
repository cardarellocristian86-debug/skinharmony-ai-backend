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
  ICF_INITIAL_WORK_GOVERNANCE_SEED_EVENT,
  ICF_POSTGRES_SCHEMA,
} from "../src/icfPostgresStore.js";

const INITIAL_SEED_RECORD = Object.freeze({
  canonical_work_id: "11111111-1111-4111-8111-111111111111",
  causal_work_id: "22222222-2222-4222-8222-222222222222",
  project_id: "33333333-3333-4333-8333-333333333333",
  genesis_intent_id: "44444444-4444-4444-8444-444444444444",
  intent_revision_id: "55555555-5555-4555-8555-555555555555",
  genesis_digest: "a".repeat(64),
  intent_revision_digest: "b".repeat(64),
});

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

function governedMigrationPool({ tamperTargetConstraint = false, initialSeedRecord = null } = {}) {
  const queries = [];
  let released = false;
  let schemaApplied = false;
  let migration = null;
  let icfHead = null;
  const icfEvents = new Map();
  let initialSeedEventInserts = 0;
  const consistentCutAt = "2026-08-25T10:00:01.000Z";
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
      if (normalized.includes("FROM tenant_work w")
        && normalized.includes("core_work_causal_bindings")) {
        return { rows: initialSeedRecord ? [{ ...initialSeedRecord }] : [],
          rowCount: initialSeedRecord ? 1 : 0 };
      }
      if (normalized.includes("FROM core_icf_work") && normalized.includes("FOR UPDATE")) {
        return { rows: icfHead ? [{ ...icfHead }] : [], rowCount: icfHead ? 1 : 0 };
      }
      if (normalized.includes("FROM core_icf_event") && normalized.includes("seq=1")) {
        const event = icfEvents.get(1);
        return { rows: event ? [{ ...event }] : [], rowCount: event ? 1 : 0 };
      }
      if (normalized.includes("FROM core_icf_event") && normalized.includes("seq=$3")) {
        const event = icfEvents.get(Number(values[2]));
        return { rows: event ? [{ ...event }] : [], rowCount: event ? 1 : 0 };
      }
      if (normalized === "SELECT clock_timestamp() AS consistent_cut_at") {
        return { rows: [{ consistent_cut_at: consistentCutAt }], rowCount: 1 };
      }
      if (normalized.startsWith("INSERT INTO core_icf_event")) {
        const event = {
          tenant_id: values[0], work_id: values[1], seq: values[2], event_type: values[3],
          payload: values[4], previous_digest: values[5], digest: values[6],
          digest_contract: values[7], canonicalization_version: values[8],
          digest_algorithm: values[9], payload_digest: values[10],
          previous_digest_contract: values[11],
        };
        icfEvents.set(Number(event.seq), event);
        initialSeedEventInserts += 1;
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("INSERT INTO core_icf_work")) {
        icfHead = { version: values[2], ledger_head_digest: values[4],
          ledger_head_digest_contract: values[5] };
        return { rows: [], rowCount: 1 };
      }
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
    initialSeedState: () => ({ head: icfHead && { ...icfHead },
      events: [...icfEvents.values()].map((event) => ({ ...event })), initialSeedEventInserts }),
    replaceInitialSeedEvent(sequence, patch) {
      const current = icfEvents.get(sequence);
      icfEvents.set(sequence, { ...current, ...patch });
    },
    replaceInitialSeedHead(patch) { icfHead = { ...icfHead, ...patch }; },
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

async function readyInitialSeedStore(record = INITIAL_SEED_RECORD) {
  const fake = governedMigrationPool({ initialSeedRecord: record });
  const store = createIcfPostgresStore({ pool: fake.value });
  await store.initialize();
  return { fake, store };
}

test("initial Work governance seed is created once and exact replay is read-only", async () => {
  const { fake, store } = await readyInitialSeedStore();
  const first = await store.ensureInitialWorkGovernanceSeed({ tenantId: "tenant-a",
    workId: INITIAL_SEED_RECORD.canonical_work_id });
  const replay = await store.ensureInitialWorkGovernanceSeed({ tenantId: "tenant-a",
    workId: INITIAL_SEED_RECORD.canonical_work_id });
  const state = fake.initialSeedState();
  assert.equal(first.state, "seeded");
  assert.equal(replay.state, "present");
  assert.equal(first.ledger_head_digest, replay.ledger_head_digest);
  assert.equal(first.consistent_cut_at, "2026-08-25T10:00:01.000Z");
  assert.equal(replay.consistent_cut_at, first.consistent_cut_at);
  assert.equal(state.initialSeedEventInserts, 1);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].event_type, ICF_INITIAL_WORK_GOVERNANCE_SEED_EVENT);
  assert.equal(state.events[0].work_id, INITIAL_SEED_RECORD.causal_work_id);
  assert.equal(state.events[0].payload.canonical_work.work_id,
    INITIAL_SEED_RECORD.canonical_work_id);
  assert.equal(state.events[0].payload.genesis.canonical_digest,
    INITIAL_SEED_RECORD.genesis_digest);
  assert.equal(state.events[0].payload.approved_intent.canonical_digest,
    INITIAL_SEED_RECORD.intent_revision_digest);
});

test("initial Work governance seed rejects a non-seed first event", async () => {
  const { fake, store } = await readyInitialSeedStore();
  await store.ensureInitialWorkGovernanceSeed({ tenantId: "tenant-a",
    workId: INITIAL_SEED_RECORD.canonical_work_id });
  fake.replaceInitialSeedEvent(1, { event_type: "STATE_BOUND" });
  await assert.rejects(() => store.ensureInitialWorkGovernanceSeed({ tenantId: "tenant-a",
    workId: INITIAL_SEED_RECORD.canonical_work_id }),
  (error) => error.code === "icf_initial_seed_binding_mismatch");
});

test("initial Work governance seed rejects a tampered first-event payload", async () => {
  const { fake, store } = await readyInitialSeedStore();
  await store.ensureInitialWorkGovernanceSeed({ tenantId: "tenant-a",
    workId: INITIAL_SEED_RECORD.canonical_work_id });
  fake.replaceInitialSeedEvent(1, { payload: { tampered: true } });
  await assert.rejects(() => store.ensureInitialWorkGovernanceSeed({ tenantId: "tenant-a",
    workId: INITIAL_SEED_RECORD.canonical_work_id }),
  (error) => error.code === "icf_initial_seed_binding_mismatch");
});

test("initial Work governance seed rejects a missing canonical binding", async () => {
  const { store } = await readyInitialSeedStore(null);
  await assert.rejects(() => store.ensureInitialWorkGovernanceSeed({ tenantId: "tenant-a",
    workId: INITIAL_SEED_RECORD.canonical_work_id }),
  (error) => error.code === "icf_initial_seed_canonical_binding_missing");
});

test("initial Work governance seed rejects a head that is not its final event", async () => {
  const { fake, store } = await readyInitialSeedStore();
  await store.ensureInitialWorkGovernanceSeed({ tenantId: "tenant-a",
    workId: INITIAL_SEED_RECORD.canonical_work_id });
  fake.replaceInitialSeedHead({ ledger_head_digest: "f".repeat(64) });
  await assert.rejects(() => store.ensureInitialWorkGovernanceSeed({ tenantId: "tenant-a",
    workId: INITIAL_SEED_RECORD.canonical_work_id }),
  (error) => error.code === "icf_initial_seed_head_mismatch");
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assembleEntity360Snapshot,
  deterministicEntity360Id,
  entity360Digest,
  entity360SnapshotSemanticBody,
} from "../src/entity360.js";
import { loadEntity360Configuration } from "../src/entity360Runtime.js";
import { createPostgresEntity360Store } from "../src/entity360Store.js";
import {
  ENTITY360_APPEND_ONLY_TABLES,
  ENTITY360_MIGRATIONS,
  ENTITY360_SHADOW_MODE_MIGRATION_ID,
  ENTITY360_TABLES,
  verifyEntity360CompletedMigrationReadback,
} from "../src/entity360Migration.js";
import { createHostNativeDomainSigner } from "../src/hostNativeGovernance.js";
import { attestEntity360ShadowReceipt } from "../src/entity360ShadowObservation.js";

const { policy: POLICY, ontology: ONTOLOGY } = loadEntity360Configuration();
const DOMAIN_SIGNER = createHostNativeDomainSigner({
  signingSecret: "entity360-store-test-signing-secret-0000000000000001",
});
const DOMAIN_VERIFIER = Object.freeze({
  verify(value, signature, options) { return DOMAIN_SIGNER.verify(value, signature, options); },
});
const STORE_OPTIONS = Object.freeze({ policy: POLICY, ontology: ONTOLOGY,
  qualificationVerifier: DOMAIN_VERIFIER });
const WORK_ID = "91e82640-9edc-5424-a3e8-eb7853b0d8dd";
const IDENTITY = Object.freeze({ work_id: WORK_ID });
const TENANT = "tenant-a";
const AT = "2026-08-25T10:00:00.000Z";

function contribution(sourceId, adapterVersion, digest, facts, evidenceClass = "authoritative_record") {
  const entityId = deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work", identity: IDENTITY });
  return { tenant_id: TENANT, entity_id: entityId, source_id: sourceId, adapter_version: adapterVersion,
    source_watermark: `${sourceId}:1`, observed_at: AT, recorded_at: AT, evidence_class: evidenceClass,
    evidence_digests: [digest], evidence_refs: [`${sourceId}:1`], confidence: 1, facts };
}

function fixtureSnapshot({ value = "ready", snapshotVersion = 1, previousSnapshotDigest = null } = {}) {
  const contributions = [
    contribution("work_continuity", "work_continuity_entity360_adapter_v1", "a".repeat(64), [
      { fact_id: "work.identity", value: { work_id: WORK_ID }, criticality: "high_impact" },
      { fact_id: "work.current_state", value: { status: value }, criticality: "high_impact",
        evidence_class: "verified_observation" },
    ]),
    contribution("intent", "intent_entity360_adapter_v1", "b".repeat(64), [
      { fact_id: "governance.intent.binding", value: { intent_digest: "b".repeat(64) },
        criticality: "high_impact" },
    ]),
    contribution("genesis", "genesis_entity360_adapter_v1", "c".repeat(64), [
      { fact_id: "governance.genesis.binding", value: { genesis_digest: "c".repeat(64) },
        criticality: "high_impact" },
    ]),
    contribution("icf", "icf_entity360_adapter_v2", "d".repeat(64), [
      { fact_id: "governance.icf.binding", value: { ledger_head_digest: "d".repeat(64) },
        criticality: "high_impact" },
    ]),
  ];
  const sourceDiscovery = contributions.map((item) => ({
    source_id: item.source_id,
    state: "accepted",
    evidence_digest: item.evidence_digests[0],
    evidence_ref: item.evidence_refs[0],
  }));
  sourceDiscovery.push({ source_id: "entity360_context_assembler", state: "complete",
    consistent_cut: "postgres_repeatable_read" });
  return assembleEntity360Snapshot({ tenant_id: TENANT, entity_type: "work", identity: IDENTITY,
    as_of: AT, snapshot_version: snapshotVersion,
    previous_snapshot_digest: previousSnapshotDigest, source_contributions: contributions,
    source_discovery: sourceDiscovery },
  { policy: POLICY, ontology: ONTOLOGY, created_at: "2026-08-25T10:00:01.000Z",
    adapter_registry_version: "entity_360_adapter_registry_test_v1",
    qualification_signer: DOMAIN_SIGNER });
}

function fakePool() {
  const state = { head: null, snapshots: [], idempotency: new Map(), calls: [] };
  const client = {
    async query(sql, params = []) {
      const query = String(sql).replace(/\s+/g, " ").trim();
      state.calls.push({ query, params });
      if (query === "SELECT clock_timestamp() AS verification_time") {
        return { rows: [{ verification_time: "2026-08-25T10:00:02.000Z" }], rowCount: 1 };
      }
      if (query.includes("FROM core_entity360_idempotency")) {
        const operation = query.includes("operation='WRITE_SNAPSHOT'") ? "WRITE_SNAPSHOT" : params[1];
        const idempotencyKey = query.includes("operation='WRITE_SNAPSHOT'") ? params[1] : params[2];
        const row = state.idempotency.get(`${params[0]}:${operation}:${idempotencyKey}`);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (query.startsWith("INSERT INTO core_entity360_idempotency")) {
        state.idempotency.set(`${params[0]}:${params[1]}:${params[2]}`, {
          payload_digest: params[3], result_payload: JSON.parse(params[4]),
        });
        return { rows: [], rowCount: 1 };
      }
      if (query.startsWith("INSERT INTO core_entity360_entity_heads")) {
        state.head ||= { entity_type: params[2], identity_digest: params[3],
          current_snapshot_version: 0, current_snapshot_digest: null, revision: 0 };
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("FROM core_entity360_entity_heads") && query.includes("FOR UPDATE")) {
        return { rows: state.head ? [state.head] : [], rowCount: state.head ? 1 : 0 };
      }
      if (query.startsWith("INSERT INTO core_entity360_snapshots")) {
        state.snapshots.push({ tenant_id: params[0], entity_id: params[1], snapshot_version: params[3],
          snapshot_digest: params[4], snapshot: JSON.parse(params[14]) });
        return { rows: [{ persisted_at: "2026-08-25T10:00:02.000Z" }], rowCount: 1 };
      }
      if (query.startsWith("UPDATE core_entity360_entity_heads")) {
        if (!state.head || Number(state.head.current_snapshot_version) !== Number(params[4])) {
          return { rows: [], rowCount: 0 };
        }
        state.head.current_snapshot_version = params[2];
        state.head.current_snapshot_digest = params[3];
        state.head.revision += 1;
        return { rows: [{ revision: state.head.revision }], rowCount: 1 };
      }
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(query) || query.startsWith("SELECT pg_advisory_xact_lock")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected_query:${query}`);
    },
    release() {},
  };
  return {
    state,
    pool: {
      query: (...args) => client.query(...args),
      async connect() { return client; },
    },
  };
}

function featureFlagFixture() {
  const state = { flag: null, idempotency: new Map(), calls: [] };
  const client = {
    async query(sql, params = []) {
      const query = String(sql).replace(/\s+/g, " ").trim();
      state.calls.push({ query, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(query)
        || query.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
      if (query.includes("FROM core_entity360_idempotency")) {
        const row = state.idempotency.get(`${params[0]}:${params[1]}:${params[2]}`);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (query.startsWith("INSERT INTO core_entity360_idempotency")) {
        state.idempotency.set(`${params[0]}:${params[1]}:${params[2]}`, {
          payload_digest: params[3], result_payload: JSON.parse(params[4]),
        });
        return { rows: [], rowCount: 1 };
      }
      if (query.startsWith("SELECT revision FROM core_entity360_feature_flags")) {
        return { rows: state.flag ? [{ revision: state.flag.revision }] : [], rowCount: state.flag ? 1 : 0 };
      }
      if (query.startsWith("INSERT INTO core_entity360_feature_flags")) {
        state.flag = { mode: params[2], enabled: params[3], policy_digest: params[4],
          enforcement_authority_digest: params[5], revision: params[8] };
        return { rows: [], rowCount: 1 };
      }
      if (query.startsWith("UPDATE core_entity360_feature_flags")) {
        if (!state.flag || state.flag.revision !== params[10]) return { rows: [], rowCount: 0 };
        state.flag = { mode: params[2], enabled: params[3], policy_digest: params[4],
          enforcement_authority_digest: params[5], revision: params[8] };
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected_query:${query}`);
    },
    release() {},
  };
  return { state, pool: { query: (...args) => client.query(...args), async connect() { return client; } } };
}

test("Entity 360 migration is additive, registry-governed and append-only", async () => {
  const [up, shadowModeUp, down, migration, store] = await Promise.all([
    readFile(new URL("../migrations/20260825_001_entity360_up.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/20260827_002_entity360_shadow_mode_guard_up.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/20260825_001_entity360_down.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/entity360Migration.js", import.meta.url), "utf8"),
    readFile(new URL("../src/entity360Store.js", import.meta.url), "utf8"),
  ]);
  assert.match(up, /core_entity360_snapshots/);
  assert.match(up, /core_entity360_shadow_receipts/);
  assert.match(up, /core_entity360_backfill_non_destructive_check/);
  assert.match(up, /core_entity360_snapshots_append_only/);
  assert.match(up, /core_entity360_snapshots_truncate_guard/);
  assert.match(up, /core_entity360_snapshot_chain_check/);
  assert.match(up, /snapshot->>'previous_snapshot_digest'/);
  assert.match(up, /FOREIGN KEY \(tenant_id, entity_id\)/);
  assert.match(shadowModeUp, /core_entity360_feature_shadow_only_check/);
  assert.match(shadowModeUp, /ENTITY360_SHADOW_MODE_MIGRATION_REFUSED_INVALID_EXISTING_FLAGS/);
  assert.match(down, /ENTITY360_DOWN_MIGRATION_REFUSED_AUTHORITATIVE_ROWS/);
  assert.match(down, /ENTITY360_DOWN_MIGRATION_DISABLED_USE_FEATURE_FLAG/);
  assert.match(migration, /ensureCoreSchemaMigrationRegistry\(client\)/);
  assert.match(migration, /core_schema_migrations/);
  assert.equal(ENTITY360_MIGRATIONS.some((item) =>
    item.migration_id === ENTITY360_SHADOW_MODE_MIGRATION_ID), true);
  assert.doesNotMatch(store, /readFile|CREATE TABLE/);
});

test("public migration verification requires the terminal governed registry checkpoint", () => {
  const sqlDigest = "e".repeat(64);
  const manifestDigest = "f".repeat(64);
  const readback = {
    tables: [...ENTITY360_TABLES],
    append_only_tables: [...ENTITY360_APPEND_ONLY_TABLES],
    migration: { migration_id: ENTITY360_MIGRATIONS[0].migration_id, sql_digest: sqlDigest, application_state: "COMPLETED",
      checkpoint: "READBACK_VERIFIED" },
    snapshot_tenant_fk: true,
    snapshot_chain_guard: true,
    backfill_tenant_fk: true,
    feature_enforcement_guard: true,
    backfill_non_destructive_guard: true,
    backfill_cursor_binding_guard: true,
    backfill_state_guard: true,
    backfill_create_guard: true,
    backfill_checkpoint_truncate_guard: true,
    schema_manifest_matches: true,
    schema_manifest_digest: manifestDigest,
    expected_schema_manifest_digest: manifestDigest,
  };
  assert.equal(verifyEntity360CompletedMigrationReadback(readback, sqlDigest), readback);
  for (const [applicationState, checkpoint] of [
    ["FAILED", "SCHEMA_APPLIED"],
    ["APPLYING", "SCHEMA_APPLIED"],
    ["COMPLETED", "SCHEMA_APPLIED"],
  ]) {
    assert.throws(() => verifyEntity360CompletedMigrationReadback({ ...readback,
      migration: { ...readback.migration, application_state: applicationState, checkpoint },
    }, sqlDigest), (error) => error.code === "entity360_migration_registry_state_invalid"
      && error.status === 503
      && error.details?.observed_application_state === applicationState
      && error.details?.observed_checkpoint === checkpoint);
  }
  assert.throws(() => verifyEntity360CompletedMigrationReadback({
    ...readback,
    append_only_tables: readback.append_only_tables.filter((name) =>
      name !== "core_entity360_snapshots"),
    schema_manifest_matches: false,
    schema_manifest_digest: "a".repeat(64),
  }, sqlDigest), (error) => error.code === "entity360_migration_schema_manifest_mismatch"
    && error.status === 503,
  "exact manifest drift remains the authoritative error when a trigger is disabled");
});

test("full migration chain fails closed without the durable SHADOW-only guard", () => {
  const migrationDigests = ENTITY360_MIGRATIONS.map((item, index) => ({
    migration_id: item.migration_id,
    sql_digest: String(index + 1).repeat(64),
  }));
  const manifestDigest = "f".repeat(64);
  const readback = {
    tables: [...ENTITY360_TABLES],
    append_only_tables: [...ENTITY360_APPEND_ONLY_TABLES],
    migration: { ...migrationDigests[0], application_state: "COMPLETED",
      checkpoint: "READBACK_VERIFIED" },
    migrations: migrationDigests.map((item) => ({ ...item, application_state: "COMPLETED",
      checkpoint: "READBACK_VERIFIED" })),
    snapshot_tenant_fk: true,
    snapshot_chain_guard: true,
    backfill_tenant_fk: true,
    feature_enforcement_guard: true,
    feature_shadow_only_guard: true,
    backfill_non_destructive_guard: true,
    backfill_cursor_binding_guard: true,
    backfill_state_guard: true,
    backfill_create_guard: true,
    backfill_checkpoint_truncate_guard: true,
    schema_manifest_matches: true,
    schema_manifest_digest: manifestDigest,
    expected_schema_manifest_digest: manifestDigest,
  };
  assert.equal(verifyEntity360CompletedMigrationReadback(readback, migrationDigests), readback);
  assert.throws(() => verifyEntity360CompletedMigrationReadback({ ...readback,
    feature_shadow_only_guard: false,
  }, migrationDigests), (error) => error.code === "entity360_migration_integrity_readback_failed"
    && error.details?.missing_guard === "core_entity360_feature_shadow_only_check");
});

test("feature-flag persistence admits only OFF or policy-bound SHADOW", async () => {
  const fixture = featureFlagFixture();
  const store = createPostgresEntity360Store({ pool: fixture.pool, ...STORE_OPTIONS });
  const base = { tenant_id: TENANT, flag_id: "entity360", actor_id: "core-operator", config: {} };
  const off = await store.writeFeatureFlag({ ...base, mode: "OFF", enabled: false,
    expected_revision: 0, idempotency_key: "feature-off" });
  assert.deepEqual({ mode: off.mode, enabled: off.enabled, policy_digest: off.policy_digest,
    enforcement_authority_digest: off.enforcement_authority_digest, revision: off.revision }, {
    mode: "OFF", enabled: false, policy_digest: null, enforcement_authority_digest: null, revision: 1,
  });
  const shadow = await store.writeFeatureFlag({ ...base, mode: "SHADOW", enabled: true,
    policy_digest: "a".repeat(64), expected_revision: 1, idempotency_key: "feature-shadow" });
  assert.equal(shadow.mode, "SHADOW");
  assert.equal(shadow.enabled, true);
  assert.equal(shadow.enforcement_authority_digest, null);
  await assert.rejects(() => store.writeFeatureFlag({ ...base, mode: "ENFORCED", enabled: true,
    policy_digest: "a".repeat(64), enforcement_authority_digest: "b".repeat(64),
    expected_revision: 2, idempotency_key: "feature-enforced" }),
  (error) => error.code === "entity360_feature_mode_invalid" && error.status === 422);
  await assert.rejects(() => store.writeFeatureFlag({ ...base, mode: "OFF", enabled: true,
    expected_revision: 2, idempotency_key: "feature-invalid-off" }),
  (error) => error.code === "entity360_feature_flag_state_invalid" && error.status === 403);
  assert.equal(fixture.state.flag.mode, "SHADOW");
  assert.equal(fixture.state.flag.enabled, true);
});

test("snapshot write is tenant-scoped, CAS-bound and exactly idempotent", async () => {
  const fixture = fakePool();
  const store = createPostgresEntity360Store({ pool: fixture.pool, ...STORE_OPTIONS });
  const snapshot = fixtureSnapshot();
  const input = { snapshot, expected_head_version: 0, idempotency_key: "snapshot-idem",
    request_digest: "b".repeat(64), actor_id: "test-writer" };
  const first = await store.writeSnapshot(input);
  const replay = await store.writeSnapshot(input);
  assert.equal(replay.snapshot_digest, first.snapshot_digest);
  assert.equal(replay.replayed, true);
  assert.equal(first.head_version, 1);
  assert.equal(fixture.state.snapshots.length, 1);
  assert.equal(fixture.state.calls.some((call) => call.query.includes("WHERE tenant_id=$1 AND entity_id=$2")), true);

  const outputChangedDuringRetry = await store.writeSnapshot({ ...input,
    snapshot: fixtureSnapshot({ value: "changed" }) });
  assert.equal(outputChangedDuringRetry.replayed, true,
    "a stable caller request must replay even when mutable discovery would rebuild a different snapshot");
  await assert.rejects(() => store.writeSnapshot({ ...input, request_digest: "c".repeat(64),
    snapshot: fixtureSnapshot({ value: "changed" }) }),
    (error) => error.code === "entity360_idempotency_payload_mismatch" && error.status === 409);
});

test("snapshot CAS and identity binding fail closed", async () => {
  const fixture = fakePool();
  const store = createPostgresEntity360Store({ pool: fixture.pool, ...STORE_OPTIONS });
  await store.writeSnapshot({ snapshot: fixtureSnapshot(), expected_head_version: 0,
    idempotency_key: "first", actor_id: "test-writer" });
  await assert.rejects(() => store.writeSnapshot({ snapshot: fixtureSnapshot(), expected_head_version: 0,
    idempotency_key: "stale", actor_id: "test-writer" }),
  (error) => error.code === "entity360_head_version_conflict");

  const wrongChain = fixtureSnapshot({ snapshotVersion: 2, previousSnapshotDigest: "f".repeat(64) });
  await assert.rejects(() => store.writeSnapshot({ snapshot: wrongChain, expected_head_version: 1,
    idempotency_key: "wrong-chain", actor_id: "test-writer" }),
  (error) => error.code === "entity360_previous_snapshot_digest_conflict");

  fixture.state.head.identity_digest = "0".repeat(64);
  const next = fixtureSnapshot({ snapshotVersion: 2,
    previousSnapshotDigest: fixture.state.head.current_snapshot_digest });
  await assert.rejects(() => store.writeSnapshot({ snapshot: next, expected_head_version: 1,
    idempotency_key: "collision", actor_id: "test-writer" }),
  (error) => error.code === "entity360_entity_identity_collision");
});

test("store rejects a re-digested forged READY snapshot that Core cannot independently derive", async () => {
  const fixture = fakePool();
  const store = createPostgresEntity360Store({ pool: fixture.pool, ...STORE_OPTIONS });
  const forged = JSON.parse(JSON.stringify(fixtureSnapshot()));
  forged.qualification_manifest.source_contributions = [];
  forged.qualification_manifest.source_rejections = [];
  const manifestPayload = { schema_version: forged.qualification_manifest.schema_version,
    source_contributions: [], source_rejections: [] };
  forged.qualification_manifest.manifest_digest = entity360Digest(manifestPayload);
  forged.current_state = {};
  forged.completeness = 1;
  forged.confidence = 1;
  forged.missing_context = [];
  forged.corroboration_gaps = [];
  forged.authoritative_sources_missing = [];
  const semantic = entity360SnapshotSemanticBody(forged);
  forged.deterministic_immutable_digest = entity360Digest(semantic);
  forged.envelope_digest = entity360Digest({ semantic_digest: forged.deterministic_immutable_digest,
    created_at: forged.created_at, schema_version: forged.schema_version });
  await assert.rejects(() => store.writeSnapshot({ snapshot: forged, expected_head_version: 0,
    idempotency_key: "forged", actor_id: "test-writer" }),
  (error) => error.code === "entity360_snapshot_independent_verification_failed"
      && error.details.reasons.includes("entity360_source_discovery_accepted_binding_invalid"));
  assert.equal(fixture.state.snapshots.length, 0);
  assert.equal(fixture.state.head, null);
});

test("cross-tenant aggregate reads are unavailable without an explicit tenant", async () => {
  const fixture = fakePool();
  const store = createPostgresEntity360Store({ pool: fixture.pool, ...STORE_OPTIONS });
  await assert.rejects(() => store.readMetrics({}),
    (error) => error.code === "entity360_tenant_required");
  assert.equal(fixture.state.calls.length, 0);
});

test("shadow feature gate uses a policy-bound PostgreSQL statement timeout", async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const query = String(sql).replace(/\s+/gu, " ").trim();
      calls.push({ query, params });
      if (["BEGIN", "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", "COMMIT"]
        .includes(query)) return { rows: [], rowCount: 0 };
      if (query === "SELECT set_config('statement_timeout',$1,true)") {
        return { rows: [{ set_config: params[0] }], rowCount: 1 };
      }
      if (query.includes("FROM core_entity360_feature_flags")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected_query:${query}`);
    },
    release() {},
  };
  const store = createPostgresEntity360Store({ pool: {
    query: (...args) => client.query(...args),
    async connect() { return client; },
  }, ...STORE_OPTIONS });
  assert.equal(await store.readFeatureFlag({ tenant_id: TENANT, flag_id: "entity360",
    statement_timeout_ms: 100 }), null);
  assert.deepEqual(calls.map((item) => item.query), [
    "BEGIN",
    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    "SELECT set_config('statement_timeout',$1,true)",
    "SELECT flag_id,mode,enabled,policy_digest,enforcement_authority_digest,config,config_digest,revision,updated_by,created_at,updated_at FROM core_entity360_feature_flags WHERE tenant_id=$1 AND flag_id=$2",
    "COMMIT",
  ]);
  assert.deepEqual(calls[2].params, ["100ms"]);
  await assert.rejects(() => store.readFeatureFlag({ tenant_id: TENANT, flag_id: "entity360",
    statement_timeout_ms: 0 }), /entity360_feature_flag_statement_timeout_invalid/u);
  await assert.rejects(() => store.readFeatureFlag({ tenant_id: TENANT, flag_id: "entity360",
    statement_timeout_ms: 60_001 }), /entity360_feature_flag_statement_timeout_invalid/u);
});

test("persisted metrics separate unavailable resolver attempts and expose correlation counts and rates", async () => {
  const calls = [];
  const queryMetrics = async (sql, params) => {
    const query = String(sql).replace(/\s+/gu, " ").trim();
    calls.push({ query, params });
    if (query.includes("FROM core_entity360_snapshots WHERE tenant_id=$1")) {
      return { rows: [{ snapshot_count: "4", entity_count: "2", completeness: 0.75,
        confidence: 0.8, source_count: 3, source_diversity: 0.5,
        corroboration_coverage: 0.6, source_occupancy_bytes: 100,
        source_occupancy_tokens: 20, stale_source_count: "1", contradiction_count: "2",
        missing_required_context_count: "3", rejected_source_contributions: "4",
        limited_source_contributions: "5" }] };
    }
    if (query.includes("FROM core_entity360_shadow_receipts r")) {
      return { rows: [{ shadow_comparison_count: "6", shadow_divergence_count: "2",
        unverified_shadow_comparison_count: "1", core_hold_count: "4",
        core_hold_correlated_count: "3", core_insufficient_context_count: "2",
        core_insufficient_context_correlated_count: "1" }] };
    }
    throw new Error(`unexpected_query:${query}`);
  };
  const pool = {
    query: queryMetrics,
    async connect() { return { query: queryMetrics, release() {} }; },
  };
  const store = createPostgresEntity360Store({ pool, ...STORE_OPTIONS });
  const metrics = await store.readMetrics({ tenant_id: TENANT });
  assert.equal(metrics.schema_version, "entity_360_persisted_metrics_v1");
  assert.equal(metrics.metrics_scope, "persisted_snapshots_and_shadow_receipts");
  assert.equal(metrics.resolver_metrics_persisted, false);
  assert.equal(metrics.resolver_attempt_count, null);
  assert.equal(metrics.resolver_ambiguity_count, null);
  assert.equal(metrics.entity_resolver_ambiguity_rate, null);
  assert.equal(metrics.core_hold_count, 4);
  assert.equal(metrics.core_hold_correlated_count, 3);
  assert.equal(metrics.core_hold_correlation_rate, 0.75);
  assert.equal(metrics.core_insufficient_context_count, 2);
  assert.equal(metrics.core_insufficient_context_correlated_count, 1);
  assert.equal(metrics.core_insufficient_context_correlation_rate, 0.5);
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.params[0] === TENANT), true);
  assert.equal(calls.some((call) => call.query.includes("resolution_status")), false,
    "persisted snapshots must not masquerade as failed resolver attempts");

  const corruptQuery = async (sql) => {
    return String(sql).includes("core_entity360_shadow_receipts")
      ? { rows: [{ core_hold_count: "1", core_hold_correlated_count: "2",
        core_insufficient_context_count: "0", core_insufficient_context_correlated_count: "0" }] }
      : { rows: [{ snapshot_count: "0", entity_count: "0" }] };
  };
  const corruptStore = createPostgresEntity360Store({ pool: { query: corruptQuery,
    async connect() { return { query: corruptQuery, release() {} }; } }, ...STORE_OPTIONS });
  await assert.rejects(() => corruptStore.readMetrics({ tenant_id: TENANT }),
    (error) => error.code === "entity360_metrics_correlation_count_invalid"
      && error.status === 503);
});

test("Store boundary requires verify-only qualification authority and rejects forged shadow receipts", async () => {
  const fixture = fakePool();
  assert.throws(() => createPostgresEntity360Store({ pool: fixture.pool,
    policy: POLICY, ontology: ONTOLOGY, qualificationVerifier: DOMAIN_SIGNER }),
  /entity360_qualification_verifier_required/u);
  const store = createPostgresEntity360Store({ pool: fixture.pool, ...STORE_OPTIONS });
  const receipt = attestEntity360ShadowReceipt({
    schema_version: "entity_360_shadow_comparison_v1",
    comparison_digest: "b".repeat(64),
    snapshot_digest: "a".repeat(64),
    execution_authorized: false,
  }, DOMAIN_SIGNER);
  await assert.rejects(() => store.writeShadowReceipt({
    tenant_id: TENANT,
    entity_id: deterministicEntity360Id({ tenant_id: TENANT, entity_type: "work",
      identity: IDENTITY }),
    snapshot_version: 1,
    receipt: { ...receipt, snapshot_digest: "c".repeat(64) },
    actor_id: "test-writer",
    idempotency_key: "forged-shadow",
  }), /entity360_attestation_verification_failed/u);
  assert.equal(fixture.state.calls.length, 0);
});

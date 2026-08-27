import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assembleEntity360Snapshot,
  deterministicEntity360Id,
} from "../src/entity360.js";
import { createPostgresEntity360AdapterRegistry } from "../src/entity360Adapters.js";
import { loadEntity360Configuration } from "../src/entity360Runtime.js";
import { createEntity360Migrator } from "../src/entity360Migration.js";
import {
  createPostgresEntity360Store,
  ENTITY360_BACKFILL_CURSOR_VERSION,
  ENTITY360_BACKFILL_SOURCE_BINDING_VERSION,
} from "../src/entity360Store.js";
import { createHostNativeDomainSigner } from "../src/hostNativeGovernance.js";

const DATABASE_URL = String(process.env.ENTITY360_DATABASE_URL || "").trim();

const { policy: POLICY, ontology: ONTOLOGY } = loadEntity360Configuration();
const DOMAIN_SIGNER = createHostNativeDomainSigner({
  signingSecret: "entity360-postgres16-test-signing-secret-000000000001",
});
const DOMAIN_VERIFIER = Object.freeze({
  verify(value, signature, options) { return DOMAIN_SIGNER.verify(value, signature, options); },
});

function backfillCursor(position, previousCursorDigest = null, keyset = {}) {
  return {
    schema_version: ENTITY360_BACKFILL_CURSOR_VERSION,
    position,
    keyset,
    previous_cursor_digest: previousCursorDigest,
  };
}

function backfillSourceBinding(tenantId, selector = { relation: "tenant_work" }) {
  return {
    schema_version: ENTITY360_BACKFILL_SOURCE_BINDING_VERSION,
    tenant_scope: tenantId,
    source_id: "work_continuity",
    selector,
  };
}

test("Entity 360 backfill primitives remain dormant outside an explicit governed caller", async () => {
  const runtime = await readFile(new URL("../src/entity360Runtime.js", import.meta.url), "utf8");
  assert.doesNotMatch(runtime, /\.(?:createBackfill|checkpointBackfill)\s*\(/u);
});

function isolatedSchemaName(label) {
  return `entity360_${label}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

function quotedSchema(value) {
  assert.match(value, /^[a-z0-9_]{1,63}$/u);
  return `"${value}"`;
}

async function withIsolatedSchema(pg, adminPool, label, operation) {
  const schema = isolatedSchemaName(label);
  const identifier = quotedSchema(schema);
  const cleanupSchemas = [];
  const registerCleanupSchema = (value) => {
    quotedSchema(value);
    cleanupSchemas.push(value);
  };
  await adminPool.query(`CREATE SCHEMA ${identifier}`);
  const pool = new pg.default.Pool({ connectionString: DATABASE_URL, max: 4,
    options: `-c search_path=${schema}` });
  try {
    return await operation({ pool, schema, registerCleanupSchema });
  } finally {
    await pool.end();
    await adminPool.query(`DROP SCHEMA ${identifier} CASCADE`);
    for (const cleanupSchema of cleanupSchemas.reverse()) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema(cleanupSchema)} CASCADE`);
    }
  }
}

test("PostgreSQL Entity 360 raw retrieval pre-gate quarantines an oversized TOAST row",
  { skip: !DATABASE_URL }, async () => {
    const pg = await import("pg");
    const adminPool = new pg.default.Pool({ connectionString: DATABASE_URL, max: 2 });
    try {
      await withIsolatedSchema(pg, adminPool, "raw_retrieval", async ({ pool }) => {
        await pool.query(`CREATE TABLE core_continuity_atlas_nodes (
          tenant_id varchar(120) NOT NULL,
          node_id varchar(160) NOT NULL,
          work_id uuid NOT NULL,
          project_id text NOT NULL,
          revision bigint NOT NULL,
          active boolean NOT NULL,
          updated_at timestamptz NOT NULL
        )`);
        const tenantId = `entity360-raw-${crypto.randomUUID()}`.slice(0, 120);
        const workId = crypto.randomUUID();
        const nodeId = "oversized-node";
        await pool.query(`INSERT INTO core_continuity_atlas_nodes
          (tenant_id,node_id,work_id,project_id,revision,active,updated_at)
          SELECT $1,$2,$3,string_agg(md5(g::text),''),1,true,clock_timestamp()
            FROM generate_series(1,12000) AS g`, [tenantId, nodeId, workId]);
        const registry = createPostgresEntity360AdapterRegistry({ pool, policy: POLICY });
        const resolved = await registry.resolveCandidates({ tenant_id: tenantId,
          entity_type: "software_component", identity: { work_id: workId, node_id: nodeId } });
        assert.deepEqual(resolved.candidates, []);
        const gap = resolved.source_discovery.find((item) =>
          item.source_id === "architecture_map"
            && item.reason_code === "SOURCE_RETRIEVAL_BUDGET_EXCEEDED");
        assert.ok(gap);
        assert.equal(gap.attempted_retrieval_bytes > gap.retrieval_budget_bytes, true);
      });
    } finally {
      await adminPool.end();
    }
  });

function snapshot({ tenantId, workId, version, state, asOf, createdAt,
  previousSnapshotDigest = null }) {
  const identity = { work_id: workId };
  const entityId = deterministicEntity360Id({ tenant_id: tenantId, entity_type: "work", identity });
  const contribution = (sourceId, adapterVersion, digest, facts, evidenceClass = "authoritative_record") => ({
    tenant_id: tenantId, entity_id: entityId, source_id: sourceId, adapter_version: adapterVersion,
    source_watermark: `${sourceId}:1`, observed_at: asOf, recorded_at: asOf,
    evidence_class: evidenceClass, evidence_digests: [digest], evidence_refs: [`${sourceId}:1`], facts,
  });
  const sourceContributions = [
      contribution("work_continuity", "work_continuity_entity360_adapter_v1", "a".repeat(64), [
        { fact_id: "work.identity", value: { work_id: workId }, criticality: "high_impact" },
        { fact_id: "work.current_state", value: { status: state }, criticality: "high_impact",
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
  const sourceDiscovery = sourceContributions.map((item) => ({
    source_id: item.source_id,
    state: "accepted",
    evidence_digest: item.evidence_digests[0],
    evidence_ref: item.evidence_refs[0],
  }));
  sourceDiscovery.push({ source_id: "entity360_context_assembler", state: "complete",
    consistent_cut: "postgres_repeatable_read" });
  return assembleEntity360Snapshot({ tenant_id: tenantId, entity_type: "work", identity,
    as_of: asOf, snapshot_version: version, previous_snapshot_digest: previousSnapshotDigest,
    source_contributions: sourceContributions, source_discovery: sourceDiscovery },
  { policy: POLICY, ontology: ONTOLOGY, created_at: createdAt,
    adapter_registry_version: "entity_360_adapter_registry_postgres_test_v1",
    qualification_signer: DOMAIN_SIGNER });
}

test("PostgreSQL Entity 360 exact catalog manifest rejects isolated schema drift",
  { skip: !DATABASE_URL }, async (t) => {
    const pg = await import("pg");
    const adminPool = new pg.default.Pool({ connectionString: DATABASE_URL, max: 2 });
    const scenarios = [
      ["column_default", async (pool) => {
        await pool.query(`ALTER TABLE core_entity360_feature_flags
          ALTER COLUMN config SET DEFAULT '{"tampered":true}'::jsonb`);
      }],
      ["permissive_check", async (pool) => {
        await pool.query(`ALTER TABLE core_entity360_feature_flags
          DROP CONSTRAINT core_entity360_feature_enforcement_check`);
        await pool.query(`ALTER TABLE core_entity360_feature_flags
          ADD CONSTRAINT core_entity360_feature_enforcement_check CHECK (true)`);
      }],
      ["shadow_only_check", async (pool) => {
        await pool.query(`ALTER TABLE core_entity360_feature_flags
          DROP CONSTRAINT core_entity360_feature_shadow_only_check`);
        await pool.query(`ALTER TABLE core_entity360_feature_flags
          ADD CONSTRAINT core_entity360_feature_shadow_only_check CHECK (true)`);
      }],
      ["foreign_key_action", async (pool) => {
        const foreignKey = await pool.query(`SELECT conname FROM pg_constraint
          WHERE conrelid='core_entity360_snapshots'::regclass AND contype='f'`);
        const name = String(foreignKey.rows[0]?.conname || "");
        assert.match(name, /^[a-z0-9_]{1,63}$/u);
        await pool.query(`ALTER TABLE core_entity360_snapshots DROP CONSTRAINT "${name}"`);
        await pool.query(`ALTER TABLE core_entity360_snapshots ADD CONSTRAINT "${name}"
          FOREIGN KEY (tenant_id,entity_id)
          REFERENCES core_entity360_entity_heads (tenant_id,entity_id) ON DELETE CASCADE`);
      }],
      ["foreign_key_namespace", async (pool, { registerCleanupSchema }) => {
        const decoySchema = isolatedSchemaName("fkdecoy");
        const decoyIdentifier = quotedSchema(decoySchema);
        registerCleanupSchema(decoySchema);
        await pool.query(`CREATE SCHEMA ${decoyIdentifier}`);
        await pool.query(`CREATE TABLE ${decoyIdentifier}.core_entity360_entity_heads (
          tenant_id varchar(120) NOT NULL,
          entity_id varchar(160) NOT NULL,
          PRIMARY KEY (tenant_id,entity_id)
        )`);
        const foreignKey = await pool.query(`SELECT conname FROM pg_constraint
          WHERE conrelid='core_entity360_snapshots'::regclass AND contype='f'
            AND confrelid='core_entity360_entity_heads'::regclass`);
        const name = String(foreignKey.rows[0]?.conname || "");
        assert.match(name, /^[a-z0-9_]{1,63}$/u);
        await pool.query(`ALTER TABLE core_entity360_snapshots DROP CONSTRAINT "${name}"`);
        await pool.query(`ALTER TABLE core_entity360_snapshots ADD CONSTRAINT "${name}"
          FOREIGN KEY (tenant_id,entity_id)
          REFERENCES ${decoyIdentifier}.core_entity360_entity_heads
            (tenant_id,entity_id) ON DELETE RESTRICT`);
      }],
      ["missing_index", async (pool) => {
        await pool.query("DROP INDEX core_entity360_snapshots_as_of_idx");
      }],
      ["trigger_body", async (pool) => {
        await pool.query(`CREATE OR REPLACE FUNCTION core_entity360_reject_mutation()
          RETURNS trigger AS $tampered$
          BEGIN RAISE EXCEPTION 'core_entity360_tampered'; END;
          $tampered$ LANGUAGE plpgsql`);
      }],
      ["trigger_function_namespace", async (pool, { registerCleanupSchema }) => {
        const decoySchema = isolatedSchemaName("fndecoy");
        const decoyIdentifier = quotedSchema(decoySchema);
        registerCleanupSchema(decoySchema);
        await pool.query(`CREATE SCHEMA ${decoyIdentifier}`);
        await pool.query(`CREATE FUNCTION ${decoyIdentifier}.core_entity360_reject_mutation()
          RETURNS trigger AS $decoy$
          BEGIN RAISE EXCEPTION 'core_entity360_append_only'; END;
          $decoy$ LANGUAGE plpgsql`);
        await pool.query(`DROP TRIGGER core_entity360_snapshots_append_only
          ON core_entity360_snapshots`);
        await pool.query(`CREATE TRIGGER core_entity360_snapshots_append_only
          BEFORE UPDATE OR DELETE ON core_entity360_snapshots
          FOR EACH ROW EXECUTE FUNCTION
            ${decoyIdentifier}.core_entity360_reject_mutation()`);
      }],
      ["disabled_trigger", async (pool) => {
        await pool.query(`ALTER TABLE core_entity360_snapshots
          DISABLE TRIGGER core_entity360_snapshots_append_only`);
      }],
    ];
    try {
      for (const [label, tamper] of scenarios) {
        await t.test(label, async () => withIsolatedSchema(pg, adminPool, label,
          async ({ pool, schema, registerCleanupSchema }) => {
            const migrator = createEntity360Migrator({ pool });
            const store = createPostgresEntity360Store({ pool, policy: POLICY, ontology: ONTOLOGY,
              qualificationVerifier: DOMAIN_VERIFIER });
            await store.initialize();
            const baseline = await migrator.verify();
            assert.equal(baseline.schema_manifest_matches, true);
            assert.equal((await store.health()).schema_verified, true);
            await tamper(pool, { schema, registerCleanupSchema });
            await assert.rejects(() => migrator.verify(),
              (error) => error.code === "entity360_migration_schema_manifest_mismatch");
            const health = await store.health();
            assert.equal(health.ok, false);
            assert.equal(health.schema_verified, false);
          }));
      }
    } finally {
      await adminPool.end();
    }
  });

test("PostgreSQL Entity 360 feature persistence accepts only OFF or SHADOW",
  { skip: !DATABASE_URL }, async () => {
    const pg = await import("pg");
    const adminPool = new pg.default.Pool({ connectionString: DATABASE_URL, max: 2 });
    try {
      await withIsolatedSchema(pg, adminPool, "shadow_mode", async ({ pool }) => {
        const migrator = createEntity360Migrator({ pool });
        await migrator.apply();
        const common = ["entity360-feature-mode-test", "{}", "a".repeat(64), "postgres-test"];
        await pool.query(`INSERT INTO core_entity360_feature_flags
          (tenant_id,flag_id,mode,enabled,policy_digest,enforcement_authority_digest,
           config,config_digest,revision,updated_by)
          VALUES ($1,'off','OFF',false,NULL,NULL,$2::jsonb,$3,0,$4)`, common);
        await pool.query(`INSERT INTO core_entity360_feature_flags
          (tenant_id,flag_id,mode,enabled,policy_digest,enforcement_authority_digest,
           config,config_digest,revision,updated_by)
          VALUES ($1,'shadow','SHADOW',true,$3,NULL,$2::jsonb,$4,0,$5)`,
        [common[0], common[1], "b".repeat(64), common[2], common[3]]);
        await assert.rejects(() => pool.query(`INSERT INTO core_entity360_feature_flags
          (tenant_id,flag_id,mode,enabled,policy_digest,enforcement_authority_digest,
           config,config_digest,revision,updated_by)
          VALUES ($1,'enforced','ENFORCED',true,$3,$4,$2::jsonb,$5,0,$6)`,
        [common[0], common[1], "c".repeat(64), "d".repeat(64), common[2], common[3]]),
        /core_entity360_feature_shadow_only_check/);
        await assert.rejects(() => pool.query(`INSERT INTO core_entity360_feature_flags
          (tenant_id,flag_id,mode,enabled,policy_digest,enforcement_authority_digest,
           config,config_digest,revision,updated_by)
          VALUES ($1,'invalid-shadow','SHADOW',false,$3,NULL,$2::jsonb,$4,0,$5)`,
        [common[0], common[1], "e".repeat(64), common[2], common[3]]),
        /core_entity360_feature_shadow_only_check/);
      });
    } finally {
      await adminPool.end();
    }
  });

test("PostgreSQL Entity 360 public verification rejects nonterminal migration registry state",
  { skip: !DATABASE_URL }, async (t) => {
    const pg = await import("pg");
    const adminPool = new pg.default.Pool({ connectionString: DATABASE_URL, max: 2 });
    try {
      for (const applicationState of ["FAILED", "APPLYING"]) {
        await t.test(applicationState.toLowerCase(), async () => withIsolatedSchema(
          pg, adminPool, `registry_${applicationState.toLowerCase()}`, async ({ pool }) => {
            const migrator = createEntity360Migrator({ pool });
            const store = createPostgresEntity360Store({ pool, policy: POLICY, ontology: ONTOLOGY,
              qualificationVerifier: DOMAIN_VERIFIER });
            await store.initialize();
            await pool.query(`UPDATE core_schema_migrations
              SET application_state=$2,checkpoint='SCHEMA_APPLIED'
              WHERE migration_id=$1`, [migrator.migration_id, applicationState]);
            await assert.rejects(() => migrator.verify(),
              (error) => error.code === "entity360_migration_registry_state_invalid"
                && error.details?.observed_application_state === applicationState);
            const health = await store.health();
            assert.equal(health.ok, false);
            assert.equal(health.schema_verified, false);
            assert.equal(health.error, "entity360_migration_registry_state_invalid");
          }));
      }
    } finally {
      await adminPool.end();
    }
  });

test("PostgreSQL Entity 360 has one tenant-scoped CAS winner and immutable snapshots",
  { skip: !DATABASE_URL }, async () => {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: DATABASE_URL, max: 6 });
    const store = createPostgresEntity360Store({ pool, policy: POLICY, ontology: ONTOLOGY,
      qualificationVerifier: DOMAIN_VERIFIER });
    const suffix = crypto.randomUUID();
    const tenantId = `entity360-${suffix}`.slice(0, 120);
    const otherTenant = `entity360-other-${suffix}`.slice(0, 120);
    const workId = crypto.randomUUID();
    const entityId = deterministicEntity360Id({ tenant_id: tenantId, entity_type: "work",
      identity: { work_id: workId } });
    try {
      await store.initialize();
      const databaseClock = await pool.query("SELECT clock_timestamp() AS database_now");
      const createdAt = new Date(databaseClock.rows[0].database_now).toISOString();
      const asOf = new Date(Date.parse(createdAt) - 1_000).toISOString();
      const first = snapshot({ tenantId, workId, version: 1, state: "initial",
        asOf, createdAt });
      await store.writeSnapshot({ snapshot: first, expected_head_version: 0,
        idempotency_key: "initial", actor_id: "postgres-test" });
      assert.equal((await store.readLatestSnapshot({ tenant_id: tenantId, entity_id: entityId }))
        .deterministic_immutable_digest, first.deterministic_immutable_digest);
      assert.equal(await store.readLatestSnapshot({ tenant_id: otherTenant, entity_id: entityId }), null);

      const candidates = ["candidate-a", "candidate-b"].map((state) => store.writeSnapshot({
        snapshot: snapshot({ tenantId, workId, version: 2, state,
          previousSnapshotDigest: first.deterministic_immutable_digest, asOf, createdAt }),
        expected_head_version: 1,
        idempotency_key: state,
        actor_id: "postgres-test",
      }));
      const settled = await Promise.allSettled(candidates);
      assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(settled.filter((item) => item.status === "rejected" &&
        item.reason?.code === "entity360_head_version_conflict").length, 1);
      await assert.rejects(() => pool.query(
        `UPDATE core_entity360_snapshots SET context_status='INVALID'
          WHERE tenant_id=$1 AND entity_id=$2 AND snapshot_version=1`,
        [tenantId, entityId],
      ), /core_entity360_append_only/);
      const truncateClient = await pool.connect();
      try {
        await truncateClient.query("BEGIN");
        await assert.rejects(() => truncateClient.query(
          "TRUNCATE core_entity360_backfill_events",
        ), /core_entity360_append_only/);
      } finally {
        await truncateClient.query("ROLLBACK");
        truncateClient.release();
      }
    } finally {
      await pool.end();
    }
  });

test("PostgreSQL Entity 360 backfill is tenant-scoped, idempotent and monotonic under concurrency",
  { skip: !DATABASE_URL }, async () => {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: DATABASE_URL, max: 8 });
    const store = createPostgresEntity360Store({ pool, policy: POLICY, ontology: ONTOLOGY,
      qualificationVerifier: DOMAIN_VERIFIER });
    const suffix = crypto.randomUUID();
    const tenantId = `entity360-backfill-${suffix}`.slice(0, 120);
    const otherTenant = `entity360-backfill-other-${suffix}`.slice(0, 120);
    const jobId = `work-backfill-${suffix}`;
    const actor = "postgres-backfill-test";
    const initialCursor = backfillCursor(0);
    const createInput = { tenant_id: tenantId, job_id: jobId, target_entity_type: "work",
      source_binding: backfillSourceBinding(tenantId),
      cursor_payload: initialCursor, actor_id: actor, idempotency_key: `create-${suffix}` };
    try {
      await store.initialize();
      const created = await store.createBackfill(createInput);
      assert.deepEqual(await store.createBackfill(createInput), created);
      assert.equal(created.state, "PENDING");
      assert.equal(created.cursor_position, 0);
      assert.equal(created.read_only_source, true);
      assert.equal(created.destructive_action, false);
      assert.equal(await store.readBackfill({ tenant_id: otherTenant, job_id: jobId }), null);
      await assert.rejects(() => store.createBackfill({ ...createInput,
        source_binding: backfillSourceBinding(tenantId, { relation: "changed" }) }),
      (error) => error.code === "entity360_idempotency_payload_mismatch");
      await assert.rejects(() => store.createBackfill({ ...createInput,
        job_id: `wrong-source-tenant-${suffix}`,
        source_binding: backfillSourceBinding(otherTenant),
        idempotency_key: `wrong-source-tenant-${suffix}` }),
      (error) => error.code === "entity360_backfill_source_tenant_mismatch" && error.status === 403);

      const otherCreated = await store.createBackfill({ ...createInput, tenant_id: otherTenant,
        source_binding: backfillSourceBinding(otherTenant) });
      assert.equal(otherCreated.tenant_id, otherTenant);
      assert.equal(otherCreated.job_id, jobId);
      await assert.rejects(() => pool.query(
        `INSERT INTO core_entity360_backfill_checkpoints
          (tenant_id,job_id,target_entity_type,source_binding,source_binding_digest,
           cursor_payload,cursor_digest,state,revision,created_by)
         VALUES($1,$2,'work',$3::jsonb,$4,$5::jsonb,$6,'RUNNING',0,$7)`,
        [tenantId, `invalid-initial-${suffix}`, JSON.stringify(createInput.source_binding),
          "a".repeat(64), JSON.stringify(initialCursor), created.cursor_digest, actor]),
      /core_entity360_backfill_initial_state_invalid/);

      const startInput = { tenant_id: tenantId, job_id: jobId, expected_revision: 0,
        cursor_payload: initialCursor, processed_count: 0, rejected_count: 0, state: "RUNNING",
        actor_id: actor, idempotency_key: `start-${suffix}` };
      const started = await store.checkpointBackfill(startInput);
      assert.deepEqual(await store.checkpointBackfill(startInput), started);
      await assert.rejects(() => store.checkpointBackfill({ ...startInput, state: "FAILED" }),
        (error) => error.code === "entity360_idempotency_payload_mismatch");
      await assert.rejects(() => store.checkpointBackfill({ ...startInput, expected_revision: 1,
        idempotency_key: `noop-${suffix}` }),
      (error) => error.code === "entity360_backfill_noop_checkpoint");

      const cursorOne = backfillCursor(1, created.cursor_digest, { work_id: "work-0001" });
      const advanced = await store.checkpointBackfill({ ...startInput, expected_revision: 1,
        cursor_payload: cursorOne, processed_count: 1, idempotency_key: `advance-${suffix}` });
      assert.equal(advanced.revision, 2);
      assert.equal(advanced.cursor_position, 1);

      await assert.rejects(() => store.checkpointBackfill({ ...startInput, expected_revision: 2,
        cursor_payload: initialCursor, idempotency_key: `regression-${suffix}` }),
      (error) => error.code === "entity360_backfill_progress_regression");
      await assert.rejects(() => store.checkpointBackfill({ ...startInput, expected_revision: 2,
        cursor_payload: backfillCursor(1, created.cursor_digest, { work_id: "different" }),
        processed_count: 1, idempotency_key: `same-position-change-${suffix}` }),
      (error) => error.code === "entity360_backfill_cursor_non_monotonic");
      await assert.rejects(() => store.checkpointBackfill({ ...startInput, expected_revision: 2,
        cursor_payload: cursorOne, processed_count: 1, state: "PENDING",
        idempotency_key: `transition-${suffix}` }),
      (error) => error.code === "entity360_backfill_transition_invalid");
      await assert.rejects(() => store.checkpointBackfill({ ...startInput, expected_revision: 2,
        cursor_payload: backfillCursor(2, "f".repeat(64), { work_id: "work-0002" }),
        processed_count: 2, idempotency_key: `chain-${suffix}` }),
      (error) => error.code === "entity360_backfill_cursor_chain_mismatch");
      await assert.rejects(() => store.checkpointBackfill({ ...startInput, expected_revision: 2,
        cursor_payload: backfillCursor(2, advanced.cursor_digest, { work_id: "work-0002" }),
        processed_count: 1, idempotency_key: `count-bind-${suffix}` }),
      (error) => error.code === "entity360_backfill_cursor_progress_mismatch");

      const paused = await store.checkpointBackfill({ ...startInput, expected_revision: 2,
        cursor_payload: cursorOne, processed_count: 1, state: "PAUSED",
        idempotency_key: `pause-${suffix}` });
      await assert.rejects(() => store.checkpointBackfill({ ...startInput, expected_revision: paused.revision,
        cursor_payload: cursorOne, processed_count: 1, state: "COMPLETED",
        idempotency_key: `paused-complete-${suffix}` }),
      (error) => error.code === "entity360_backfill_transition_invalid");
      const resumed = await store.checkpointBackfill({ ...startInput, expected_revision: paused.revision,
        cursor_payload: cursorOne, processed_count: 1, state: "RUNNING",
        idempotency_key: `resume-${suffix}` });
      const cursorTwo = backfillCursor(2, resumed.cursor_digest, { work_id: "work-0002" });
      const completeInput = { ...startInput,
        expected_revision: resumed.revision, cursor_payload: cursorTwo, processed_count: 1,
        rejected_count: 1, state: "COMPLETED", idempotency_key: `complete-${suffix}` };
      const completed = await store.checkpointBackfill(completeInput);
      assert.deepEqual(await store.checkpointBackfill(completeInput), completed,
        "an exact terminal checkpoint retry remains idempotent");
      await assert.rejects(() => store.checkpointBackfill({ ...startInput,
        expected_revision: completed.revision, cursor_payload: cursorTwo, processed_count: 1,
        rejected_count: 1, state: "RUNNING", idempotency_key: `after-terminal-${suffix}` }),
      (error) => error.code === "entity360_backfill_terminal");

      const readback = await store.readBackfill({ tenant_id: tenantId, job_id: jobId });
      assert.equal(readback.tenant_id, tenantId);
      assert.equal(readback.state, "COMPLETED");
      assert.equal(readback.revision, 5);
      assert.equal(readback.events.length, 5);
      assert.deepEqual(readback.events.map((event) => event.state),
        ["RUNNING", "RUNNING", "PAUSED", "RUNNING", "COMPLETED"]);
      assert.equal(readback.read_only_source, true);
      assert.equal(readback.destructive_action, false);
      assert.equal((await store.readBackfill({ tenant_id: otherTenant, job_id: jobId })).state, "PENDING");
      await assert.rejects(() => store.checkpointBackfill({ ...startInput, tenant_id: otherTenant,
        expected_revision: completed.revision, idempotency_key: `cross-tenant-${suffix}` }),
      (error) => error.code === "entity360_backfill_revision_conflict");
      assert.equal((await store.readBackfill({ tenant_id: otherTenant, job_id: jobId })).revision, 0);
      await assert.rejects(() => pool.query(
        `UPDATE core_entity360_backfill_checkpoints SET state='RUNNING',revision=revision+1
          WHERE tenant_id=$1 AND job_id=$2`, [tenantId, jobId]),
      /core_entity360_backfill_terminal/);

      const failedJobId = `failed-${suffix}`;
      const failedCreate = await store.createBackfill({ ...createInput, job_id: failedJobId,
        idempotency_key: `create-failed-${suffix}` });
      const failed = await store.checkpointBackfill({ ...startInput, job_id: failedJobId,
        cursor_payload: initialCursor, state: "FAILED", idempotency_key: `fail-${suffix}` });
      assert.equal(failed.state, "FAILED");
      await assert.rejects(() => store.checkpointBackfill({ ...startInput, job_id: failedJobId,
        expected_revision: failed.revision, cursor_payload: initialCursor, state: "RUNNING",
        idempotency_key: `resume-failed-${suffix}` }),
      (error) => error.code === "entity360_backfill_terminal");
      assert.equal(failedCreate.read_only_source, true);

      const concurrentJobId = `concurrent-${suffix}`;
      const concurrentCreate = await store.createBackfill({ ...createInput, job_id: concurrentJobId,
        idempotency_key: `create-concurrent-${suffix}` });
      await store.checkpointBackfill({ ...startInput, job_id: concurrentJobId,
        idempotency_key: `start-concurrent-${suffix}` });
      const competitors = ["a", "b"].map((winner) => store.checkpointBackfill({ ...startInput,
        job_id: concurrentJobId, expected_revision: 1, processed_count: 1,
        cursor_payload: backfillCursor(1, concurrentCreate.cursor_digest, { winner }),
        idempotency_key: `concurrent-${winner}-${suffix}` }));
      const settled = await Promise.allSettled(competitors);
      assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(settled.filter((item) => item.status === "rejected"
        && item.reason?.code === "entity360_backfill_revision_conflict").length, 1);
      const concurrentHead = await store.readBackfill({ tenant_id: tenantId, job_id: concurrentJobId });
      await assert.rejects(() => pool.query(
        `UPDATE core_entity360_backfill_checkpoints
            SET state='PAUSED',revision=revision+1,updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND job_id=$2`, [tenantId, concurrentJobId]),
      /core_entity360_backfill_event_required/,
      "a structurally valid checkpoint transition must still have an atomic audit event");
      const poisonedProgress = {
        cursor_payload: concurrentHead.cursor_payload,
        cursor_position: concurrentHead.cursor_position,
        previous_cursor_digest: concurrentHead.previous_cursor_digest,
        processed_count: concurrentHead.processed_count,
        rejected_count: concurrentHead.rejected_count,
        state: "PAUSED",
      };
      await assert.rejects(() => pool.query(
        `INSERT INTO core_entity360_backfill_events
          (tenant_id,job_id,sequence_number,expected_revision,new_revision,state,cursor_digest,
           cursor_position,previous_cursor_digest,processed_count,rejected_count,
           progress_payload,progress_digest,created_by)
         VALUES($1,$2,$3,$4,$3,'PAUSED',$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
        [tenantId, concurrentJobId, concurrentHead.revision + 1, concurrentHead.revision,
          concurrentHead.cursor_digest, concurrentHead.cursor_position,
          concurrentHead.previous_cursor_digest, concurrentHead.processed_count,
          concurrentHead.rejected_count, JSON.stringify(poisonedProgress), "a".repeat(64), actor]),
      /core_entity360_backfill_checkpoint_required/,
      "an append-only event cannot be inserted without its matching checkpoint head");

      const sharedIdempotencyKey = `shared-create-${suffix}`;
      const idempotencyRace = ["a", "b"].map((candidate) => store.createBackfill({ ...createInput,
        job_id: `idempotency-${candidate}-${suffix}`, idempotency_key: sharedIdempotencyKey }));
      const idempotencySettled = await Promise.allSettled(idempotencyRace);
      assert.equal(idempotencySettled.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(idempotencySettled.filter((item) => item.status === "rejected"
        && item.reason?.code === "entity360_idempotency_payload_mismatch").length, 1);
      const idempotencyRows = await Promise.all(["a", "b"].map((candidate) => store.readBackfill({
        tenant_id: tenantId, job_id: `idempotency-${candidate}-${suffix}`,
      })));
      assert.equal(idempotencyRows.filter(Boolean).length, 1,
        "the losing idempotency payload must not create a checkpoint");
      const exactConcurrentInput = { ...createInput, job_id: `exact-concurrent-${suffix}`,
        idempotency_key: `exact-concurrent-${suffix}` };
      const exactConcurrent = await Promise.all([
        store.createBackfill(exactConcurrentInput), store.createBackfill(exactConcurrentInput),
      ]);
      assert.deepEqual(exactConcurrent[0], exactConcurrent[1]);
      assert.equal((await store.readBackfill({ tenant_id: tenantId,
        job_id: exactConcurrentInput.job_id })).revision, 0);

      await assert.rejects(() => pool.query(
        `UPDATE core_entity360_backfill_checkpoints
            SET cursor_payload=$3::jsonb,cursor_digest=$4,cursor_position=0,
                previous_cursor_digest=NULL,processed_count=0,rejected_count=0,
                revision=revision+1
          WHERE tenant_id=$1 AND job_id=$2`,
        [tenantId, concurrentJobId, JSON.stringify(initialCursor), concurrentCreate.cursor_digest]),
      /core_entity360_backfill_progress_regression/);
      await assert.rejects(() => pool.query(
        `UPDATE core_entity360_backfill_checkpoints SET state='PENDING',revision=revision+1
          WHERE tenant_id=$1 AND job_id=$2`, [tenantId, concurrentJobId]),
      /core_entity360_backfill_transition_invalid/);
      await assert.rejects(() => pool.query(
        "DELETE FROM core_entity360_backfill_checkpoints WHERE tenant_id=$1 AND job_id=$2",
        [tenantId, concurrentJobId]), /core_entity360_backfill_checkpoint_immutable/);
      const truncateClient = await pool.connect();
      try {
        await truncateClient.query("BEGIN");
        await assert.rejects(() => truncateClient.query(
          "TRUNCATE core_entity360_backfill_checkpoints CASCADE"),
        /core_entity360_(?:backfill_checkpoint_immutable|append_only)/);
      } finally {
        await truncateClient.query("ROLLBACK");
        truncateClient.release();
      }
    } finally {
      await pool.end();
    }
  });

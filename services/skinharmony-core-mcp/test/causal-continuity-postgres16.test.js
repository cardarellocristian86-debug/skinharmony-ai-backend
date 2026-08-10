import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createCausalContinuityStore } from "../src/causal-continuity-store.js";

const databaseUrl = String(process.env.WORK_CONTINUITY_DATABASE_URL || "").trim();

test("PostgreSQL 16 persists idempotent causal operations and atomically rolls back record/outbox", {
  skip: databaseUrl ? false : "WORK_CONTINUITY_DATABASE_URL is required for causal PostgreSQL 16 integration",
}, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 10_000 });
  const client = await pool.connect();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const schema = `causal_test_${suffix}`;
  const tenantA = `causal_a_${suffix}`;
  const tenantB = `causal_b_${suffix}`;
  const projectA = `nyra-a-${suffix}`;
  const projectB = `nyra-b-${suffix}`;
  let released = 0;
  const adapter = {
    query: (...args) => client.query(...args),
    async connect() {
      return { query: (...args) => client.query(...args), release: () => { released += 1; } };
    },
  };
  const input = {
    tenant_id: tenantA, project_id: projectA, project_name: "Nyra Core",
    actor_id: "owner-a", idempotency_key: "project-create-1",
  };
  try {
    const version = await client.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10_000), 16);
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);

    const firstStore = createCausalContinuityStore({ pool: adapter,
      now: () => new Date("2026-08-10T08:00:00.000Z") });
    const first = await firstStore.registerProject(input);
    const restartedStore = createCausalContinuityStore({ pool: adapter,
      now: () => new Date("2026-08-10T08:00:00.000Z") });
    const replay = await restartedStore.registerProject(input);
    assert.deepEqual(replay, first);
    const projectEvents = await client.query(`SELECT count(*)::integer AS count FROM causal_record
      WHERE tenant_id=$1 AND project_id=$2 AND record_type='PROJECT_REGISTERED'`, [tenantA, projectA]);
    assert.equal(projectEvents.rows[0].count, 1);

    const genesis = await restartedStore.anchorGenesisIntent({
      tenant_id: tenantA, project_id: projectA, actor_id: "owner-a", idempotency_key: "genesis-1",
      intent_document: { objective: "preserve causal continuity", constraints: ["fail-closed"] },
    });
    const revision = await restartedStore.appendIntentRevision({
      tenant_id: tenantA, project_id: projectA, actor_id: "owner-a", idempotency_key: "revision-2",
      revision_document: { objective: "preserve verified causal continuity" },
      change_reason: "explicit owner-authorized clarification",
    });
    const operationInput = {
      tenant_id: tenantA, project_id: projectA, actor_id: "owner-a", idempotency_key: "operation-1",
      intent_revision_id: revision.revision_id, operation_kind: "WORK", operation_ref: "work-1",
    };
    const operation = await restartedStore.declareOperation(operationInput);
    assert.deepEqual(await restartedStore.declareOperation(operationInput), operation);
    assert.equal(operation.lifecycle_state, "DECLARED");
    assert.match(genesis.intent_digest, /^[a-f0-9]{64}$/);

    await restartedStore.registerProject({
      tenant_id: tenantB, project_id: projectB, project_name: "Foreign project",
      actor_id: "owner-b", idempotency_key: "project-create-b",
    });
    await assert.rejects(restartedStore.declareOperation({
      tenant_id: tenantB, project_id: projectB, actor_id: "owner-b", idempotency_key: "foreign-operation",
      intent_revision_id: revision.revision_id, operation_kind: "WORK", operation_ref: "foreign-work",
    }), /causal_revision_scope_mismatch/);

    const failingAdapter = {
      query: (...args) => client.query(...args),
      async connect() {
        return {
          async query(sql, params) {
            if (/INSERT INTO causal_outbox/.test(String(sql))) throw new Error("induced_outbox_failure");
            return client.query(sql, params);
          },
          release() { released += 1; },
        };
      },
    };
    const failingStore = createCausalContinuityStore({ pool: failingAdapter,
      now: () => new Date("2026-08-10T08:00:00.000Z") });
    const rolledBackProject = `rollback-${suffix}`;
    await assert.rejects(failingStore.registerProject({
      tenant_id: tenantA, project_id: rolledBackProject, project_name: "Rollback proof",
      actor_id: "owner-a", idempotency_key: "rollback-project",
    }), /induced_outbox_failure/);
    const rolledBack = await client.query(`SELECT
      (SELECT count(*)::integer FROM causal_project WHERE tenant_id=$1 AND project_id=$2) AS projects,
      (SELECT count(*)::integer FROM causal_record WHERE tenant_id=$1 AND project_id=$2) AS records,
      (SELECT count(*)::integer FROM causal_outbox WHERE tenant_id=$1 AND project_id=$2) AS outbox`,
    [tenantA, rolledBackProject]);
    assert.deepEqual(rolledBack.rows[0], { projects: 0, records: 0, outbox: 0 });

    const record = await client.query(`SELECT record_id FROM causal_record
      WHERE tenant_id=$1 AND project_id=$2 ORDER BY sequence_number LIMIT 1`, [tenantA, projectA]);
    await client.query("BEGIN");
    await client.query("SAVEPOINT append_only_check");
    await assert.rejects(client.query(`UPDATE causal_record SET payload='{"changed":true}'::jsonb
      WHERE tenant_id=$1 AND record_id=$2`, [tenantA, record.rows[0].record_id]), /causal_history_append_only/);
    await client.query("ROLLBACK TO SAVEPOINT append_only_check");
    await client.query("ROLLBACK");
    assert.ok(released >= 7);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.query("RESET search_path").catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    client.release();
    await pool.end();
  }
});

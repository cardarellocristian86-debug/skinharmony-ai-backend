import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import pg from "pg";

import { createCausalContinuityRuntime } from "../src/causalContinuityRuntime.js";
import { createPostgresCausalContinuityStore } from "../src/causalContinuityStore.js";

const DATABASE_URL = String(process.env.CAUSAL_BINDING_DATABASE_URL || process.env.SOFTWARE_COGNITION_DATABASE_URL || "").trim();

test("PostgreSQL 16 records re-observation without duplicating a Work root", { skip: !DATABASE_URL }, async () => {
  const schema = `causal_binding_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const admin = new pg.Pool({ connectionString: DATABASE_URL });
  const pool = new pg.Pool({ connectionString: DATABASE_URL, options: `-c search_path=${schema}` });
  const workId = crypto.randomUUID();

  const openProject = async (tenant_id) => {
    const runtime = createCausalContinuityRuntime({ store: createPostgresCausalContinuityStore({ pool }) });
    const context = {
      tenant_id, actor_id: "local-owner", actor_role: "owner",
      authority_scope: ["causal:write", "intent:approve:strategic"], owner_confirmed: true,
      provenance: { session_fingerprint: "b".repeat(24) },
    };
    await runtime.initialize();
    const project = await runtime.project_identity_create(context, {
      idempotency_key: `project-${tenant_id}`, alias: `binding-${tenant_id}`, canonical_name: "Causal binding regression",
    });
    const snapshot = await runtime.project_state_snapshot(context, {
      project_id: project.project_id, idempotency_key: `state-${tenant_id}`, observed_at: new Date().toISOString(),
    });
    await runtime.genesis_intent_create(context, {
      project_id: project.project_id, idempotency_key: `genesis-${tenant_id}`, intent_text: "Preserve one causal root per immutable work binding.",
    });
    const revision = await runtime.intent_revision_propose(context, {
      project_id: project.project_id, idempotency_key: `revision-${tenant_id}`, alias: "binding-v1", classification: "REFINEMENT",
      motivation: "Protect Entity360 work identity", problem: "Fresh transport keys must not create duplicate roots",
      alternatives_considered: ["reject all retries"],
    });
    await runtime.intent_revision_approve(context, {
      project_id: project.project_id, intent_revision_id: revision.intent_revision_id, idempotency_key: `approve-${tenant_id}`,
    });
    return { runtime, context, project, snapshot, revision };
  };

  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    assert.match((await pool.query("SHOW server_version")).rows[0].server_version, /^16\./);
    const firstTenant = `binding-a-${crypto.randomUUID()}`.slice(0, 63);
    const a = await openProject(firstTenant);
    const immutable = {
      project_id: a.project.project_id, work_id: workId, intent_revision_id: a.revision.intent_revision_id,
      base_state_digest: a.snapshot.state_digest, provenance: { source: "postgres16-regression" },
    };
    const first = await a.runtime.work_bind_intent(a.context, { ...immutable, idempotency_key: "bind-first" });
    const reobserved = await a.runtime.work_bind_intent(a.context, { ...immutable, idempotency_key: "bind-fresh-key" });
    assert.equal(reobserved._event.replayed, false);
    assert.notEqual(reobserved._event.event_id, first._event.event_id);
    const events = await pool.query(
      `SELECT event_id,event_type FROM core_causal_event_ledger
        WHERE tenant_id=$1 AND project_id=$2 AND operation='work_bind_intent' AND payload->'result'->>'work_id'=$3
        ORDER BY sequence_number`,
      [firstTenant, a.project.project_id, workId],
    );
    assert.deepEqual(events.rows.map((row) => row.event_type), ["WORK_OPENED", "WORK_BINDING_REOBSERVED"]);
    const exactReplay = await a.runtime.work_bind_intent(a.context, { ...immutable, idempotency_key: "bind-first" });
    assert.equal(exactReplay._event.replayed, true);
    assert.equal(exactReplay._event.event_id, first._event.event_id);
    await assert.rejects(
      () => a.runtime.work_bind_intent(a.context, {
        ...immutable, idempotency_key: "bind-conflicting", provenance: { source: "different-immutable-binding" },
      }),
      (error) => error.code === "IDEMPOTENCY_CONFLICT",
    );
    assert.equal((await pool.query(
      `SELECT count(*)::int AS count FROM core_causal_event_ledger
        WHERE tenant_id=$1 AND project_id=$2 AND event_type='WORK_OPENED' AND payload->'result'->>'work_id'=$3`,
      [firstTenant, a.project.project_id, workId],
    )).rows[0].count, 1);
    await a.runtime.project_scope_bind(a.context, {
      project_id: a.project.project_id, idempotency_key: "scope-advanced", resource_type: "repository",
      canonical_identifier: "local://causal-binding-regression", environment: "test", ownership: { owner: "local" },
    });
    const advanced = await a.runtime.project_state_snapshot(a.context, {
      project_id: a.project.project_id, idempotency_key: "state-advanced", observed_at: new Date(Date.now() + 1_000).toISOString(),
    });
    await assert.rejects(
      () => a.runtime.work_bind_intent(a.context, { ...immutable, idempotency_key: "bind-stale-new-key" }),
      (error) => error.code === "STALE_PROJECT_STATE",
    );
    const concurrentWorkId = crypto.randomUUID();
    const concurrent = { ...immutable, work_id: concurrentWorkId, base_state_digest: advanced.state_digest };
    const race = await Promise.all([
      a.runtime.work_bind_intent(a.context, { ...concurrent, idempotency_key: "bind-race-a" }),
      a.runtime.work_bind_intent(a.context, { ...concurrent, idempotency_key: "bind-race-b" }),
    ]);
    assert.deepEqual(race.map((row) => row._event.replayed), [false, false]);
    assert.deepEqual((await pool.query(
      `SELECT event_type FROM core_causal_event_ledger
        WHERE tenant_id=$1 AND project_id=$2 AND operation='work_bind_intent' AND payload->'result'->>'work_id'=$3
        ORDER BY sequence_number`,
      [firstTenant, a.project.project_id, concurrentWorkId],
    )).rows.map((row) => row.event_type), ["WORK_OPENED", "WORK_BINDING_REOBSERVED"]);

    const secondTenant = `binding-b-${crypto.randomUUID()}`.slice(0, 63);
    const b = await openProject(secondTenant);
    const isolated = await b.runtime.work_bind_intent(b.context, {
      project_id: b.project.project_id, work_id: workId, intent_revision_id: b.revision.intent_revision_id,
      base_state_digest: b.snapshot.state_digest, provenance: { source: "tenant-isolated" }, idempotency_key: "bind-other-tenant",
    });
    assert.equal(isolated._event.replayed, false);
    assert.equal((await pool.query(
      `SELECT count(*)::int AS count FROM core_causal_event_ledger
        WHERE tenant_id=$1 AND event_type='WORK_OPENED' AND payload->'result'->>'work_id'=$2`,
      [secondTenant, workId],
    )).rows[0].count, 1);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

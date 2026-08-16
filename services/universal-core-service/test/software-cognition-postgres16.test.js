import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import pg from "pg";

import { createWorkContinuityRuntime } from "../../skinharmony-core-mcp/src/work-continuity-runtime.js";
import { createPostgresCausalContinuityStore } from "../src/causalContinuityStore.js";
import { createIcfPostgresStore } from "../src/icfPostgresStore.js";
import { createPostgresSoftwareCognitionStore } from "../src/softwareCognitionStore.js";
import { deterministicSoftwareId } from "../src/softwareCognition.js";

const DATABASE_URL = String(process.env.SOFTWARE_COGNITION_DATABASE_URL || "").trim();

test("PostgreSQL 16 Atlas extension enforces one CAS winner and composite endpoints", { skip: !DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8 });
  const continuity = createWorkContinuityRuntime({}, { pool });
  const causal = createPostgresCausalContinuityStore({ pool });
  const icf = createIcfPostgresStore({ pool });
  const software = createPostgresSoftwareCognitionStore({ pool });
  const suffix = crypto.randomUUID();
  const tenant = `nsct-${suffix}`.slice(0, 63);
  const project = crypto.randomUUID();
  const work = crypto.randomUUID();
  const change = crypto.randomUUID();
  const genesis = crypto.randomUUID();
  const intent = crypto.randomUUID();
  const plan = crypto.randomUUID();
  const otherWork = crypto.randomUUID();
  const otherChange = crypto.randomUUID();
  const hash = "a".repeat(64);
  try {
    assert.match((await pool.query("show server_version")).rows[0].server_version, /^16\./);
    await continuity.initialize(); await causal.initialize(); await icf.initialize(); await software.initialize(); await software.initialize();
    await pool.query(`INSERT INTO core_continuity_works(tenant_id,project_id,work_id,session_id,idea,objective,created_by)
      VALUES($1,$2,$3,'session','idea','objective','test')`, [tenant, project, work]);
    await pool.query(`INSERT INTO core_projects(tenant_id,project_id,canonical_name,active_intent_revision_id) VALUES($1,$2,$3,NULL)`, [tenant, project, `project-${suffix}`]);
    await pool.query(`INSERT INTO core_genesis_intents(tenant_id,genesis_intent_id,project_id,intent_text,author_id,canonical_digest)
      VALUES($1,$2,$3,'purpose','owner',$4)`, [tenant, genesis, project, hash]);
    await pool.query(`INSERT INTO core_intent_revisions(tenant_id,intent_revision_id,project_id,genesis_intent_id,alias,classification,state,revision_payload,author_id,authorized_by,canonical_digest)
      VALUES($1,$2,$3,$4,'v1','REFINEMENT','APPROVED','{}','owner','owner',$5)`, [tenant, intent, project, genesis, hash]);
    await pool.query(`UPDATE core_projects SET active_intent_revision_id=$3 WHERE tenant_id=$1 AND project_id=$2`, [tenant, project, intent]);
    await pool.query(`INSERT INTO core_work_causal_bindings(tenant_id,work_id,project_id,genesis_intent_id,intent_revision_id,base_state_digest,provenance)
      VALUES($1,$2,$3,$4,$5,$6,'{}')`, [tenant, work, project, genesis, intent, hash]);
    await pool.query(`INSERT INTO core_changes(tenant_id,change_id,project_id,work_id,intent_revision_id,reason,scope,expected_effects,forbidden_effects,base_state_digest,expected_target_state,request_digest)
      VALUES($1,$2,$3,$4,$5,'test','{}','[]','[]',$6,'{}',$6)`, [tenant, change, project, work, intent, hash]);
    await pool.query(`INSERT INTO core_continuity_native_plans(tenant_id,work_id,plan_id,plan,plan_digest,status,created_by,change_id,base_state_digest,contract_schema)
      VALUES($1,$2,$3,$4::jsonb,$5,'planned','test',$6,$5,'worker_plan_contract_v1')`, [tenant, work, plan,
      JSON.stringify({ schema_version: "native_agent_plan_v1", software_contract: { change_id: change, base_state_digest: hash } }), hash, change]);
    await pool.query(`INSERT INTO core_continuity_works(tenant_id,project_id,work_id,session_id,idea,objective,created_by)
      VALUES($1,$2,$3,'session-2','idea','objective','test')`, [tenant, project, otherWork]);
    await pool.query(`INSERT INTO core_work_causal_bindings(tenant_id,work_id,project_id,genesis_intent_id,intent_revision_id,base_state_digest,provenance)
      VALUES($1,$2,$3,$4,$5,$6,'{}')`, [tenant, otherWork, project, genesis, intent, hash]);
    await pool.query(`INSERT INTO core_changes(tenant_id,change_id,project_id,work_id,intent_revision_id,reason,scope,expected_effects,forbidden_effects,base_state_digest,expected_target_state,request_digest)
      VALUES($1,$2,$3,$4,$5,'foreign work change','{}','[]','[]',$6,'{}',$6)`, [tenant, otherChange, project, otherWork, intent, hash]);
    await assert.rejects(() => pool.query(`INSERT INTO core_continuity_native_plans
      (tenant_id,work_id,plan_id,plan,plan_digest,status,created_by,change_id,base_state_digest,contract_schema)
      VALUES($1,$2,$3,'{}',$4,'planned','test',$5,$4,'worker_plan_contract_v1')`,
    [tenant, work, crypto.randomUUID(), hash, otherChange]), /foreign key/i);

    const nodeId = deterministicSoftwareId({ tenant_id: tenant, project_id: project, kind: "file", source_ref: "src/a.js" });
    const dependencyId = deterministicSoftwareId({ tenant_id: tenant, project_id: project, kind: "module", source_ref: "src/dependency.js" });
    const identity = { tenantId: tenant, subject: "test-actor" };
    const mutation = (key, sourceHash = hash) => continuity.upsertAtlas(identity, { work_id: work, expected_revision: 0, replace: true,
      nodes: [{ node_id: nodeId, node_kind: "file", path: "src/a.js", source_ref: "src/a.js", source_kind: "git_diff" },
        { node_id: dependencyId, node_kind: "module", path: "src/dependency.js", source_ref: "src/dependency.js", source_kind: "git_diff" }],
      edges: [{ from_node_id: nodeId, to_node_id: dependencyId, edge_type: "imports" }], source_hash: sourceHash, idempotency_key: key });
    const race = await Promise.allSettled([mutation("race-a"), mutation("race-b")]);
    assert.equal(race.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(race.filter((item) => item.status === "rejected" && /revision_conflict/.test(item.reason?.message)).length, 1);
    const winningKey = race[0].status === "fulfilled" ? "race-a" : "race-b";
    assert.equal((await mutation(winningKey)).revision, 1);
    await assert.rejects(() => mutation(winningKey, "b".repeat(64)), /idempotency_key_conflict/);
    assert.ok((await software.readGraph(tenant, project, work)).nodes.some((node) => node.node_id === nodeId));
    const aggregateBefore = await continuity.selectAtlas(identity, { project_id: project, seed_node_ids: [nodeId], max_nodes: 1, edge_types: ["imports"] });
    assert.equal(aggregateBefore.revision_vector.length, 1);
    assert.match(aggregateBefore.project_revision_digest, /^[a-f0-9]{64}$/);
    await continuity.upsertAtlas(identity, { work_id: work, expected_revision: 1, replace: true,
      nodes: [{ node_id: nodeId, node_kind: "file", path: "src/a.js", source_ref: "src/a.js", source_kind: "git_diff" }],
      edges: [], source_hash: "c".repeat(64), idempotency_key: "replace-tombstone" });
    assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM core_continuity_atlas_edges
      WHERE tenant_id=$1 AND work_id=$2 AND active=false AND tombstoned_at IS NOT NULL`, [tenant, work])).rows[0].count), 1);
    await assert.rejects(() => pool.query(`INSERT INTO core_continuity_atlas_edges
      (tenant_id,work_id,project_id,from_node_id,to_node_id,edge_type,revision,edge_id,edge_digest,source)
      VALUES($1,$2,$3,$4,$4,'depends_on',1,'sce_foreign',$5,'test')`, [tenant, work, crypto.randomUUID(), nodeId, hash]), /foreign key/i);
    const absent = (await pool.query("SELECT to_regclass('core_software_nodes') AS nodes,to_regclass('core_software_edges') AS edges,to_regclass('core_software_graph_revisions') AS revisions")).rows[0];
    assert.deepEqual(absent, { nodes: null, edges: null, revisions: null });
    assert.equal((await software.readNativePlan({ tenant_id: tenant, work_id: work, plan_id: plan })).plan_id, plan);
    const supervisionBindings = await software.readSupervisionBindings({ tenant_id: tenant, project_id: project, work_id: work });
    assert.equal(supervisionBindings.intent_id, intent);
    assert.equal(supervisionBindings.icf_required, true);
    const receiptPayload = { schema_version: "software_test_receipt_v1", project_id: project, work_id: work, change_id: change, plan_id: plan };
    await software.writeArtifact({ tenant_id: tenant, project_id: project, work_id: work, change_id: change, plan_id: plan,
      kind: "coverage", id: "coverage-atomic", digest: hash, payload: receiptPayload, actor_id: "test" });
    assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM core_continuity_events
      WHERE tenant_id=$1 AND work_id=$2 AND event_type='software_receipt_recorded'`, [tenant, work])).rows[0].count), 1);
    const challenge = { challenge_id: `challenge-${suffix}`.slice(0, 160), severity: "critical", status: "open", version: 1 };
    await software.writeChallenge({ tenant_id: tenant, work_id: work, plan_id: plan, change_id: change, challenge, digest: hash });
    const resolution = { ...challenge, status: "accepted", version: 2, resolution_digest: hash };
    const resolutions = await Promise.allSettled([0, 1].map(() => software.writeChallengeResolution({ tenant_id: tenant, work_id: work,
      plan_id: plan, challenge_id: challenge.challenge_id, expected_version: 1, payload: resolution, digest: hash, actor_id: "verifier" })));
    assert.equal(resolutions.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(resolutions.filter((item) => item.status === "rejected").length, 1);
    await software.writeArtifact({ tenant_id: tenant, project_id: project, work_id: work, change_id: change, plan_id: plan,
      kind: "closure", id: "release-ready", digest: hash,
      payload: { verdict: "RELEASE_READY", closure_digest: hash, project_id: project, work_id: work, change_id: change, plan_id: plan }, actor_id: "test" });
    assert.equal((await software.readReleaseReadyClosure({ tenant_id: tenant, work_id: work })).payload.plan_id, plan);
    await software.withClosureAuthorityLock({ tenant_id: tenant, work_id: work }, (locked) => locked.assertClosureFresh({
      fresh_until: new Date(Date.now() + 60_000).toISOString(), issued_at: new Date().toISOString(),
    }));
    await assert.rejects(() => software.withClosureAuthorityLock({ tenant_id: tenant, work_id: work }, (locked) => locked.assertClosureFresh({
      fresh_until: new Date(Date.now() - 1_000).toISOString(), issued_at: new Date(Date.now() - 2_000).toISOString(),
    })), /software_cognition_closure_expired_during_issuance/);
    await assert.rejects(() => software.withClosureAuthorityLock({ tenant_id: tenant, work_id: work }, async (locked) => {
      const issuedAt = new Date().toISOString();
      const freshUntil = new Date(Date.now() + 20).toISOString();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return locked.assertClosureFresh({ fresh_until: freshUntil, issued_at: issuedAt });
    }), /software_cognition_closure_expired_during_issuance/);
    await pool.query(`INSERT INTO core_continuity_native_plans
      (tenant_id,work_id,plan_id,plan,plan_digest,status,created_by,change_id,base_state_digest,contract_schema,created_at)
      VALUES($1,$2,$3,$4::jsonb,$5,'planned','test',$6,$5,'worker_plan_contract_v1',clock_timestamp()+interval '1 second')`,
    [tenant, work, crypto.randomUUID(), JSON.stringify({ software_contract: { change_id: change, base_state_digest: hash } }), hash, change]);
    assert.equal(await software.readReleaseReadyClosure({ tenant_id: tenant, work_id: work }), null);
  } finally { await pool.end(); }
});

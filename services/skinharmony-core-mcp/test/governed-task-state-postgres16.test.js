import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

import { foldWorkProjection } from "../src/governed-continuity-context.js";
import { createWorkContinuityRuntime } from "../src/work-continuity-runtime.js";
import { createWorkContinuityV2Store } from "../src/work-continuity-v2-store.js";
import { WORK_CONTINUITY_V2_SCHEMA_SQL } from "../src/work-continuity-v2.js";

const databaseUrl = String(process.env.WORK_CONTINUITY_DATABASE_URL || "").trim();
const migrationSql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),
  "../migrations/20260908_governed_task_state_projection_v1.sql"), "utf8");

function ownerIdentity(tenantId, agentId = "governed-state-postgres16") {
  const subject = `owner|${tenantId}`;
  return {
    tenantId,
    subject,
    agentPresence: {
      agent_id: agentId,
      session_fingerprint: "f".repeat(64),
    },
    tenant_work_acl: {
      server_derived: true,
      tenant_id: tenantId,
      user_id: subject,
      role: "tenant_owner",
      team_ids: [],
      managed_team_ids: [],
      assigned_work_ids: [],
      is_tenant_owner: true,
      is_super_admin: false,
    },
  };
}

async function materializeFixtureCausalLineage(store, identity, workId, nonce) {
  // This fixture predates the canonical causal-lineage gate and creates the
  // Work directly. Move it through the same append-only state transition used
  // by a completed server-owned bootstrap; do not bypass the mutation guard.
  const lineage = await store.recordCausalLineageState(identity, {
    work_id: workId,
    state: "READY",
    lineage_digest: crypto.createHash("sha256").update(JSON.stringify({
      schema_version: "postgres16_fixture_causal_lineage_v1",
      work_id: workId,
      nonce,
    })).digest("hex"),
  });
  assert.equal(lineage.state, "READY");
  assert.match(lineage.lineage_digest, /^[a-f0-9]{64}$/);
  return lineage;
}

test("PostgreSQL 16 upgrades an existing precommit scope-freeze table with validated checks", {
  skip: databaseUrl ? false : "WORK_CONTINUITY_DATABASE_URL is required for scope-freeze migration integration",
}, async () => {
  const schema = `scope_freeze_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 15_000 });
  const client = await pool.connect();
  const constraintNames = [
    "tw_precommit_freeze_revision_positive_ck",
    "tw_precommit_freeze_phase_ck",
    "tw_precommit_freeze_task_contract_pair_ck",
    "tw_precommit_freeze_task_contract_revision_ck",
    "tw_precommit_freeze_dependency_manifest_pair_ck",
    "tw_precommit_freeze_dependency_manifest_revision_ck",
  ];
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await client.query(WORK_CONTINUITY_V2_SCHEMA_SQL);
    await client.query(`ALTER TABLE tenant_work_precommit_scope_freeze
      DROP CONSTRAINT tw_precommit_freeze_revision_positive_ck,
      DROP COLUMN governed_precommit_phase CASCADE,
      DROP COLUMN task_contract_digest CASCADE,
      DROP COLUMN task_contract_revision CASCADE,
      DROP COLUMN dependency_manifest_digest CASCADE,
      DROP COLUMN dependency_manifest_revision CASCADE`);

    await client.query(WORK_CONTINUITY_V2_SCHEMA_SQL);
    await client.query(WORK_CONTINUITY_V2_SCHEMA_SQL);
    const constraints = await client.query(`SELECT conname,convalidated,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid='tenant_work_precommit_scope_freeze'::regclass
        AND conname=ANY($1::text[])
      ORDER BY conname`, [constraintNames]);
    assert.deepEqual(constraints.rows.map((row) => row.conname), [...constraintNames].sort());
    assert(constraints.rows.every((row) => row.convalidated === true));
    const definitions = constraints.rows.map((row) => row.definition).join("\n");
    assert.match(definitions, /POST_COMMIT/);
    assert.match(definitions, /POST_DEPLOY/);
    assert.match(definitions, /task_contract_digest/);
    assert.match(definitions, /dependency_manifest_digest/);
    assert.match(definitions, /> 0/);
  } finally {
    await client.query("SET search_path TO public").catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    client.release();
    await pool.end();
  }
});

test("PostgreSQL 16 promotes only the exact terminally settled deferred task after release join", {
  skip: databaseUrl ? false : "WORK_CONTINUITY_DATABASE_URL is required for deferred settlement integration",
}, async () => {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const tenantId = `settled_deferred_${nonce.slice(0, 20)}`;
  const workId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const unrelatedTaskId = crypto.randomUUID();
  const planId = crypto.randomUUID();
  const evaluationId = crypto.randomUUID();
  const claimId = crypto.randomUUID();
  const digest64 = (prefix) => crypto.createHash("sha256").update(`${prefix}:${nonce}`).digest("hex");
  const pool = new Pool({ connectionString: databaseUrl, max: 2, statement_timeout: 15_000 });
  const legacyRuntime = createWorkContinuityRuntime({ databaseUrl }, { pool });
  const store = createWorkContinuityV2Store({ pool, legacyRuntime });
  try {
    await legacyRuntime.initialize();
    await store.initialize();
    await pool.query(`INSERT INTO core_continuity_works
      (tenant_id,project_id,work_id,session_id,idea,objective,status,next_action,created_by)
      VALUES ($1,$2,$3,$4,'Deferred settlement','Verify exact release exception',
        'active','Settle exact task','postgres16-test')`, [
      tenantId, `project-${nonce.slice(0, 12)}`, workId, `session-${nonce.slice(0, 12)}`,
    ]);
    await pool.query(`INSERT INTO core_continuity_native_plans
      (tenant_id,work_id,plan_id,plan,plan_digest,status,created_by)
      VALUES ($1,$2,$3,'{}'::jsonb,$4,'verified','postgres16-test')`, [
      tenantId, workId, planId, digest64("plan"),
    ]);
    await pool.query(`INSERT INTO tenant_work
      (tenant_id,work_id,work_code,work_name,work_type,project_id,owner_user_id,
       created_by_user_id,status,intent_digest,acceptance_criteria,legacy_work_id,
       causal_lineage_state)
      VALUES ($1,$2,$3,'Deferred settlement Work','software_git',$4,'owner','owner',
        'ACTIVE',$5,'["settled"]'::jsonb,$2,'READY')`, [
      tenantId, workId, `SETTLED-${nonce.slice(0, 12)}`,
      `project-${nonce.slice(0, 12)}`, digest64("intent"),
    ]);
    await pool.query(`INSERT INTO tenant_work_task
      (tenant_id,task_id,work_id,title,weight,required,status,acceptance_verified)
      VALUES ($1,$2,$3,'Deploy-derived verification',1,true,'planned',false),
             ($1,$4,$3,'Unrelated mutation',1,true,'planned',false)`, [
      tenantId, taskId, workId, unrelatedTaskId,
    ]);
    await pool.query(`INSERT INTO core_continuity_release_joins
      (tenant_id,work_id,plan_id,evaluation_id,verdict_id,release_intent,
       release_intent_digest,core_join_record,core_join_record_digest,created_by)
      VALUES ($1,$2,$3,$4,$5,'{}'::jsonb,$6,'{}'::jsonb,$7,'postgres16-test')`, [
      tenantId, workId, planId, evaluationId, `hnj_${digest64("verdict").slice(0, 40)}`,
      digest64("release"), digest64("join"),
    ]);
    const gateDigest = digest64("gate");
    await pool.query(`INSERT INTO tenant_work_precommit_ticket_gate_claim
      (tenant_id,work_id,gate_projection_digest,claim_id,continuation_ref,request_digest,
       delegation_id,action_digest,host_session_fingerprint,idempotency_key,claim_digest,
       claimed_by_user_id)
      VALUES ($1,$2,$3,$4,'continuation-settled',$5,'delegation-settled',$6,
        'session-settled','claim-settled',$7,'owner')`, [
      tenantId, workId, gateDigest, claimId, digest64("request"),
      digest64("action"), digest64("claim"),
    ]);
    await pool.query(`INSERT INTO tenant_work_precommit_scope_freeze
      (tenant_id,work_id,gate_projection_digest,claim_id,task_id,revision,
       v2_task_digest,scope_snapshot_digest,governed_precommit_phase)
      VALUES ($1,$2,$3,$4,$5,1,$6,$7,'POST_DEPLOY')`, [
      tenantId, workId, gateDigest, claimId, taskId,
      digest64("task"), digest64("scope"),
    ]);
    const rootTicketId = `hnt_${digest64("root").slice(0, 40)}`;
    await pool.query(`INSERT INTO tenant_work_precommit_ticket_gate_claim_fulfillment
      (tenant_id,work_id,gate_projection_digest,claim_id,claim_digest,ticket_id)
      VALUES ($1,$2,$3,$4,$5,$6)`, [
      tenantId, workId, gateDigest, claimId, digest64("claim"), rootTicketId,
    ]);
    await pool.query(`INSERT INTO tenant_work_precommit_effect_settlement
      (tenant_id,work_id,claim_id,gate_projection_digest,root_ticket_id,ticket_id,
       predecessor_ticket_id,action_kind,lineage_kind,settlement_source,lifecycle_state,
       terminal,effect_unknown,core_record_digest,settlement_digest)
      VALUES ($1,$2,$3,$4,$5,$6,$5,'render.observe','manual_merge','core_terminal_readback',
        'observed',true,false,$7,$8)`, [
      tenantId, workId, claimId, gateDigest,
      rootTicketId, `hnt_${digest64("observe").slice(0, 40)}`,
      digest64("record"), digest64("settlement"),
    ]);
    const promoted = await pool.query(`UPDATE tenant_work_task
      SET status='completed',acceptance_verified=true,completed_at=now()
      WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3 RETURNING status,revision`, [
      tenantId, workId, taskId,
    ]);
    assert.deepEqual(promoted.rows[0], { status: "completed", revision: "2" });
    await assert.rejects(pool.query(`UPDATE tenant_work_task
      SET status='completed',acceptance_verified=true,completed_at=now()
      WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3`, [
      tenantId, workId, unrelatedTaskId,
    ]), /tenant_work_task_release_frozen/);
  } finally {
    await legacyRuntime.close();
  }
});

test("PostgreSQL 16 atomically commits governed task state, projection and recovery lineage", {
  skip: databaseUrl ? false : "WORK_CONTINUITY_DATABASE_URL is required for governed task-state integration",
}, async () => {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const tenantId = `governed_state_${nonce.slice(0, 20)}`;
  const workId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const evidenceId = crypto.randomUUID();
  const intentDigest = crypto.createHash("sha256").update(`intent:${nonce}`).digest("hex");
  const inputDigest = crypto.createHash("sha256").update(`input:${nonce}`).digest("hex");
  const outputDigest = crypto.createHash("sha256").update(`output:${nonce}`).digest("hex");
  const pool = new Pool({ connectionString: databaseUrl, max: 8, statement_timeout: 15_000 });
  // Production initializes the legacy Core continuity schema before the V2
  // store. Mirror that real dependency boundary: current main adds generic
  // closure FKs to the native receipt ledger.
  const legacyRuntime = createWorkContinuityRuntime({ databaseUrl }, { pool });
  const store = createWorkContinuityV2Store({ pool, legacyRuntime });
  const owner = ownerIdentity(tenantId);
  try {
    await legacyRuntime.initialize();
    await store.initialize();
    assert.match(migrationSql, /^BEGIN;/m);
    assert.match(migrationSql, /COMMIT;\s*$/m);
    assert.doesNotMatch(migrationSql, /\b(?:TRUNCATE|DROP TABLE|DELETE FROM tenant_work|ALTER COLUMN)\b/i);
    await pool.query(migrationSql);
    await pool.query(migrationSql);
    const migration = await pool.query(`SELECT count(*)::int AS count FROM core_schema_migrations
      WHERE migration_id='20260908_governed_task_state_projection_v1'`);
    assert.equal(migration.rows[0].count, 1);
    const governedTables = await pool.query(`SELECT relname FROM pg_class
      WHERE relkind='r' AND relname=ANY($1::text[]) ORDER BY relname`, [[
      "tenant_work_task_contract", "tenant_work_task_commit", "tenant_work_state_projection",
      "tenant_work_task_invalidation", "tenant_work_effect_observation",
      "tenant_work_dependency_manifest", "tenant_work_trajectory_event",
      "tenant_work_trajectory_state",
    ]]);
    assert.deepEqual(governedTables.rows.map((row) => row.relname), [
      "tenant_work_dependency_manifest", "tenant_work_effect_observation",
      "tenant_work_state_projection", "tenant_work_task_commit", "tenant_work_task_contract",
      "tenant_work_task_invalidation", "tenant_work_trajectory_event",
      "tenant_work_trajectory_state",
    ]);
    await pool.query(`INSERT INTO tenant_work
      (tenant_id,work_id,work_code,work_name,work_type,project_id,owner_user_id,
       created_by_user_id,status,intent_digest,acceptance_criteria)
      VALUES ($1,$2,$3,'Governed state integration','software_git',$4,$5,$5,'ACTIVE',$6,'["verified"]'::jsonb)`,
    [tenantId, workId, `GOV-${nonce.slice(0, 16)}`, `project-${nonce.slice(0, 12)}`, owner.subject, intentDigest]);
    await pool.query(`INSERT INTO tenant_work_task
      (tenant_id,task_id,work_id,title,weight,required,status,acceptance_verified)
      VALUES ($1,$2,$3,'Commit governed output',1,true,'planned',false)`,
    [tenantId, taskId, workId]);
    await pool.query(`INSERT INTO tenant_work_evidence
      (tenant_id,evidence_id,work_id,kind,digest,required,independently_verified,
       verified_by_agent_id,verified_by_session_fingerprint)
      VALUES ($1,$2,$3,'postgres16_test',$4,true,true,'independent-verifier',$5)`,
    [tenantId, evidenceId, workId, outputDigest, "e".repeat(64)]);
    await materializeFixtureCausalLineage(store, owner, workId, nonce);

    const contract = await store.recordTaskContract(owner, {
      work_id: workId, task_id: taskId, contract_revision: 1, intent_digest: intentDigest,
      declared_inputs: { input_digest: inputDigest }, dependency_refs: ["repository:main"],
      output_schema_ref: "schema:governed-output-v1", required_claims: ["postgres16_verified"],
      allowed_effects: ["git.commit"], recovery_policy: { ambiguous_effect: "reconcile" },
      budgets: { max_database_queries: 20 },
    });
    // The fixture lineage transition is the first durable Work event.
    assert.equal(contract.projection.ledger_watermark, 2);
    assert.equal(contract.projection.current_task, taskId);

    const dependencyV1 = await store.recordDependencyManifest(owner, {
      work_id: workId, task_id: taskId, expected_manifest_revision: 0,
      plan_digest: "d".repeat(64), task_revision: 1, intent_digest: intentDigest,
      dependency_ids: ["repository:main"], source_versions: { "repository:main": "sha:base" },
      relevant_predicates: { protected_branch: true },
      required_evidence_refs: ["evidence:ci"], policy_revision: "f".repeat(64),
      idempotency_key: `dependency-v1-${nonce}`,
    });
    assert.equal(dependencyV1.manifest_revision, 1);
    const governedJsonBindings = await pool.query(`SELECT
        c.contract IS NOT NULL AS contract_non_null,
        pg_typeof(c.contract)::text AS contract_type,
        m.manifest IS NOT NULL AS manifest_non_null,
        pg_typeof(m.manifest)::text AS manifest_type,
        c.contract_digest,m.manifest_digest
      FROM tenant_work_task_contract c
      JOIN tenant_work_dependency_manifest m
        ON m.tenant_id=c.tenant_id AND m.work_id=c.work_id AND m.task_id=c.task_id
      WHERE c.tenant_id=$1 AND c.work_id=$2 AND c.task_id=$3
      ORDER BY c.contract_revision DESC,m.manifest_revision DESC LIMIT 1`,
    [tenantId, workId, taskId]);
    assert.equal(governedJsonBindings.rowCount, 1);
    assert.equal(governedJsonBindings.rows[0].contract_non_null, true);
    assert.equal(governedJsonBindings.rows[0].contract_type, "jsonb");
    assert.equal(governedJsonBindings.rows[0].manifest_non_null, true);
    assert.equal(governedJsonBindings.rows[0].manifest_type, "jsonb");
    assert.equal(governedJsonBindings.rows[0].contract_digest,
      contract.contract.contract_digest);
    assert.equal(governedJsonBindings.rows[0].manifest_digest,
      dependencyV1.manifest.manifest_digest);

    const commitRequest = (key) => store.commitTaskState(owner, {
      work_id: workId, task_id: taskId, expected_task_revision: 1, contract_revision: 1,
      input_digest: inputDigest, output_ref: "artifact:governed-output",
      output_digest: outputDigest, evidence_refs: [evidenceId], effect_lineage_refs: [],
      dependency_manifest_digest: dependencyV1.manifest.manifest_digest,
      validation_ref: "verification:postgres16", idempotency_key: key,
    });
    const concurrent = await Promise.allSettled([
      commitRequest(`commit-a-${nonce}`), commitRequest(`commit-b-${nonce}`),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = concurrent.find((result) => result.status === "rejected");
    assert.match(String(rejected.reason?.message || rejected.reason), /task_commit_cas_conflict/);
    const committed = concurrent.find((result) => result.status === "fulfilled").value;
    assert.equal(committed.committed_state.ledger_position, 4);
    assert.deepEqual(committed.projection.completed_tasks, [taskId]);

    const replay = await commitRequest(
      concurrent[0].status === "fulfilled" ? `commit-a-${nonce}` : `commit-b-${nonce}`,
    );
    assert.equal(replay.idempotent_replay, true);
    assert.equal(replay.committed_state.commit_digest, committed.committed_state.commit_digest);

    const trajectory = await store.evaluateWorkTrajectory(owner, {
      work_id: workId, expected_trajectory_revision: 0, harness_digest: "9".repeat(64),
      proposal: { read_scopes: ["repository.read"], write_scopes: ["deploy.write"],
        recipients: ["render:production"], effect_count: 1, egress_count: 0 },
      policy: { max_read_scopes: 4, max_write_scopes: 2, max_recipients: 2,
        max_effects: 2, max_egress: 0, forbidden_scope_pairs: [] },
      idempotency_key: `trajectory-v1-${nonce}`,
    });
    assert.equal(trajectory.trajectory.disposition, "ALLOW");
    assert.equal(trajectory.execution_authorized, false);

    const dependencyV2 = await store.recordDependencyManifest(owner, {
      work_id: workId, task_id: taskId, expected_manifest_revision: 1,
      plan_digest: "e".repeat(64), task_revision: 2, intent_digest: intentDigest,
      dependency_ids: ["repository:main"], source_versions: { "repository:main": "sha:effect" },
      relevant_predicates: { protected_branch: true },
      required_evidence_refs: ["evidence:ci"], policy_revision: "f".repeat(64),
      idempotency_key: `dependency-v2-${nonce}`,
    });

    const ambiguous = await store.observeEffectState(owner, {
      work_id: workId, effect_ref: "effect:deploy-1", state: "AMBIGUOUS",
      observed_at: "2026-09-08T12:00:00.000Z", provider_receipt_digest: null,
      idempotency_key: `effect-ambiguous-${nonce}`,
    });
    assert.equal(ambiguous.projection.unresolved_effects[0].state, "AMBIGUOUS");
    await assert.rejects(store.commitTaskState(owner, {
      work_id: workId, task_id: taskId, expected_task_revision: 2, contract_revision: 1,
      input_digest: inputDigest, output_ref: "artifact:second-output",
      output_digest: outputDigest, evidence_refs: [evidenceId], effect_lineage_refs: ["effect:deploy-1"],
      dependency_manifest_digest: dependencyV2.manifest.manifest_digest,
      validation_ref: "verification:postgres16", idempotency_key: `commit-ambiguous-${nonce}`,
    }), /task_commit_effect_unresolved/);
    await assert.rejects(store.observeEffectState(owner, {
      work_id: workId, effect_ref: "effect:deploy-1", state: "SUCCEEDED",
      observed_at: "2026-09-08T12:01:00.000Z", provider_receipt_digest: outputDigest,
      idempotency_key: `effect-blind-success-${nonce}`,
    }), /effect_reconciliation_required/);
    await store.observeEffectState(owner, {
      work_id: workId, effect_ref: "effect:deploy-1", state: "RECONCILING",
      observed_at: "2026-09-08T12:01:00.000Z", provider_receipt_digest: null,
      idempotency_key: `effect-reconciling-${nonce}`,
    });
    const resolved = await store.observeEffectState(owner, {
      work_id: workId, effect_ref: "effect:deploy-1", state: "SUCCEEDED",
      observed_at: "2026-09-08T12:02:00.000Z", provider_receipt_digest: outputDigest,
      idempotency_key: `effect-succeeded-${nonce}`,
    });
    assert.deepEqual(resolved.projection.unresolved_effects, []);

    const secondCommit = await store.commitTaskState(owner, {
      work_id: workId, task_id: taskId, expected_task_revision: 2, contract_revision: 1,
      input_digest: inputDigest, output_ref: "artifact:second-output",
      output_digest: outputDigest, evidence_refs: [evidenceId], effect_lineage_refs: ["effect:deploy-1"],
      dependency_manifest_digest: dependencyV2.manifest.manifest_digest,
      validation_ref: "verification:postgres16", idempotency_key: `commit-resolved-${nonce}`,
    });
    assert.equal(secondCommit.committed_state.revision, 2);

    const handedOffOwner = ownerIdentity(tenantId, "governed-state-postgres16-handoff");
    const cumulativeHold = await store.evaluateWorkTrajectory(handedOffOwner, {
      work_id: workId, expected_trajectory_revision: 1, harness_digest: "8".repeat(64),
      proposal: { read_scopes: [], write_scopes: ["external.send"],
        recipients: ["external:recipient"], effect_count: 0, egress_count: 1 },
      policy: { max_read_scopes: 4, max_write_scopes: 3, max_recipients: 3,
        max_effects: 2, max_egress: 1,
        forbidden_scope_pairs: [["repository.read", "external.send"]] },
      idempotency_key: `trajectory-handoff-${nonce}`,
    });
    assert.equal(cumulativeHold.trajectory.disposition, "HOLD");
    assert(cumulativeHold.trajectory.reason_codes.includes("trajectory_forbidden_scope_composition"));

    await assert.rejects(store.invalidateTaskState(owner, {
      work_id: workId, task_id: taskId, changed_dependency_refs: ["unrelated:dependency"],
      reason: "Irrelevant change", idempotency_key: `invalidate-irrelevant-${nonce}`,
    }), /task_invalidation_dependency_irrelevant/);
    const invalidated = await store.invalidateTaskState(owner, {
      work_id: workId, task_id: taskId, changed_dependency_refs: ["repository:main"],
      reason: "Repository HEAD changed", idempotency_key: `invalidate-repository-${nonce}`,
    });
    assert.deepEqual(invalidated.projection.completed_tasks, []);
    assert.deepEqual(invalidated.projection.invalidated_tasks, [taskId]);

    const restartedStore = createWorkContinuityV2Store({ pool });
    await restartedStore.initialize();
    const afterRestart = await restartedStore.readWorkStateProjection(owner, { work_id: workId });
    assert.equal(afterRestart.projection_digest, invalidated.projection.projection_digest);
    assert.equal(afterRestart.persistence_state, "CURRENT");
    const ownerView = await restartedStore.readWorkStateProjection(owner, {
      work_id: workId, view: "owner",
    });
    assert.equal(ownerView.view, "owner");
    assert.equal(ownerView.authority_granted, false);
    assert.deepEqual(ownerView.evidence_refs, [evidenceId]);
    await assert.rejects(restartedStore.readWorkStateProjection(owner, {
      work_id: workId, view: "core",
    }), /work_projection_core_view_denied/);
    const resumedWork = await restartedStore.readWork(handedOffOwner, { work_id: workId });
    assert.equal(resumedWork.work_trajectory.trajectory.disposition, "HOLD");
    assert.equal(resumedWork.work_trajectory.trajectory_revision, "2");
    const gallery = await restartedStore.listWorks(handedOffOwner, { view: "operational" });
    const galleryWork = gallery.find((work) => work.work_id === workId);
    assert.equal(galleryWork.governed_continuity.trajectory_disposition, "HOLD");
    assert.equal(galleryWork.governed_continuity.ledger_watermark,
      afterRestart.ledger_watermark);
    assert(galleryWork.governed_continuity.blockers.some((blocker) =>
      blocker.startsWith("trajectory:")));
    const legacyGallery = await restartedStore.preflightGallery(handedOffOwner, {
      project_id: `project-${nonce.slice(0, 12)}`,
    });
    assert.equal(legacyGallery.works[0].governed_continuity.trajectory_disposition, "HOLD");
    assert.equal(legacyGallery.works[0].blocker_count, 1);

    const events = await pool.query(`SELECT event_id,sequence_number,event_type,payload
      FROM tenant_work_event WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number`,
    [tenantId, workId]);
    const fullReplay = foldWorkProjection({
      work_id: workId, intent_digest: intentDigest,
      events: events.rows.map((event) => ({ ...event, sequence_number: Number(event.sequence_number) })),
    });
    assert.equal(fullReplay.projection_digest, afterRestart.projection_digest);
    const rows = await pool.query(`SELECT
      (SELECT count(*)::int FROM tenant_work_task_commit WHERE tenant_id=$1 AND work_id=$2) AS commits,
      (SELECT count(*)::int FROM tenant_work_task_invalidation WHERE tenant_id=$1 AND work_id=$2) AS invalidations,
      (SELECT count(*)::int FROM tenant_work_effect_observation WHERE tenant_id=$1 AND work_id=$2) AS effects,
      (SELECT count(*)::int FROM tenant_work_dependency_manifest WHERE tenant_id=$1 AND work_id=$2) AS manifests,
      (SELECT count(*)::int FROM tenant_work_trajectory_event WHERE tenant_id=$1 AND work_id=$2) AS trajectory_events`,
    [tenantId, workId]);
    assert.deepEqual(rows.rows[0], { commits: 2, invalidations: 1, effects: 3,
      manifests: 2, trajectory_events: 2 });
  } finally {
    await pool.end();
  }
});

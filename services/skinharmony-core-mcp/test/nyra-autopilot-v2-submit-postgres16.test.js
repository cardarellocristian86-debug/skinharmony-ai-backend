import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createNyraAutopilotRuntime } from "../src/nyra-autopilot-runtime.js";
import { createNyraNativeTeamRuntime } from "../src/nyra-native-team-runtime.js";
import { createWorkContinuityRuntime, digest } from "../src/work-continuity-runtime.js";
import { createWorkContinuityV2Store } from "../src/work-continuity-v2-store.js";

const databaseUrl = String(process.env.WORK_CONTINUITY_DATABASE_URL || "").trim();
const ident = (value) => {
  assert.match(value, /^[a-z][a-z0-9_]{1,62}$/);
  return `"${value}"`;
};
function identity(tenantId, agentId, token) {
  return { tenantId, subject: `owner|${tenantId}`, agentPresence: { agent_id: agentId, client_type: "codex", transport_bound: true,
    signature: `ags_${token.repeat(32)}`, host_transport_session_fingerprint: token.repeat(64) },
    tenant_work_acl: { server_derived: true, tenant_id: tenantId, user_id: `owner|${tenantId}`,
      role: "tenant_owner", team_ids: [], managed_team_ids: [], assigned_work_ids: [],
      is_tenant_owner: true, is_super_admin: false } };
}

test("PostgreSQL 16 submits verifier evidence through one Work-first transaction and projects exactly once", {
  skip: databaseUrl ? false : "WORK_CONTINUITY_DATABASE_URL is required",
}, async (t) => {
  const schema = `autopilot_v2_submit_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${ident(schema)}`);
  const pool = new Pool({ connectionString: databaseUrl, max: 4, statement_timeout: 15_000,
    options: `-c search_path=${schema}` });
  const legacyRuntime = createWorkContinuityRuntime({ databaseUrl }, { pool });
  const teamRuntime = createNyraNativeTeamRuntime({ databaseUrl }, { pool });
  const autopilot = createNyraAutopilotRuntime({ databaseUrl }, { pool, teamRuntime });
  const v2 = createWorkContinuityV2Store({ pool, legacyRuntime });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${ident(schema)} CASCADE`); await admin.end(); });
  await legacyRuntime.initialize(); await autopilot.initialize(); await v2.initialize();
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const tenantId = `submit_v2_${nonce.slice(0, 18)}`;
  const projectId = `project_${nonce.slice(0, 16)}`;
  const hash = (value) => crypto.createHash("sha256").update(`${nonce}:${value}`).digest("hex");
  async function fixture(label) {
    const workId = crypto.randomUUID(), runId = crypto.randomUUID(), taskId = crypto.randomUUID();
    const verifierId = crypto.randomUUID(), producerId = crypto.randomUUID();
    const verifierAgent = crypto.randomUUID(), producerAgent = crypto.randomUUID();
    await pool.query(`INSERT INTO core_continuity_works
      (tenant_id,project_id,work_id,session_id,idea,objective,status,next_action,created_by)
      VALUES ($1,$2,$3,$4,'Submit verifier','Verify atomically','active','verify','test')`,
    [tenantId, projectId, workId, `session-${label}`]);
    await pool.query(`INSERT INTO tenant_work
      (tenant_id,work_id,work_code,work_name,work_type,project_id,owner_user_id,created_by_user_id,status,intent_digest,acceptance_criteria,legacy_work_id,causal_lineage_state)
      VALUES ($1,$2,$3,'Submit verifier','software_git',$4,$5,$5,'ACTIVE',$6,'["verify"]'::jsonb,$2,'READY')`,
    [tenantId, workId, `SUBMIT-${label}-${nonce.slice(0, 8)}`, projectId, `owner|${tenantId}`, hash(`intent:${label}`)]);
    await pool.query(`INSERT INTO tenant_work_task (tenant_id,task_id,work_id,title,weight,required,status,acceptance_verified)
      VALUES ($1,$2,$3,'Atomic verifier task',1,true,'planned',false)`, [tenantId, taskId, workId]);
    for (const [agent, blueprint] of [[verifierAgent, "verifier"], [producerAgent, "producer"]]) {
      await pool.query(`INSERT INTO core_nyra_agent_instances (tenant_id,project_id,work_id,agent_instance_id,blueprint_id,blueprint_version,blueprint_digest,role,parent_kind,parent_agent_id,status,execution_provider,execution_mode,model_invocation_allowed,external_action_allowed,core_gate_required,capability_allowlist,tool_allowlist,memory_scope,learning_mode,created_by)
        VALUES ($1,$2,$3,$4,$5,'v1',$6,'specialist','nyra','nyra','ready','none','disabled',false,false,true,'[]'::jsonb,'[]'::jsonb,'work','frozen','test')`,
      [tenantId, projectId, workId, agent, blueprint, hash(`agent:${agent}`)]);
    }
    const plan = { schema_version: "nyra_autopilot_plan_v1", activation: { max_parallel: 2 } };
    await pool.query(`INSERT INTO core_nyra_autopilot_runs (tenant_id,work_id,run_id,project_id,trigger_type,architecture_version,intent_digest,plan,plan_digest,status,created_by)
      VALUES ($1,$2,$3,$4,'work_created',1,$5,$6::jsonb,$7,'materialized','test')`,
    [tenantId, workId, runId, projectId, hash(`run:${label}`), JSON.stringify(plan), digest(plan)]);
    const contract = JSON.stringify({ schema_version: "nyra_autopilot_assignment_v1" });
    await pool.query(`INSERT INTO core_nyra_autopilot_assignments (tenant_id,work_id,run_id,assignment_id,assignment_key,agent_instance_id,blueprint_id,role,task_contract,dependencies,eligible_client_types,status,claimed_agent_id,claimed_client_type,claimed_presence_signature,claimed_session_fingerprint,claim_expires_at,submitted_result)
      VALUES ($1,$2,$3,$4,'produce',$5,'producer','executor_specialist',$6::jsonb,'[]'::jsonb,'["codex"]'::jsonb,'submitted',$7,'codex',$8,$9,clock_timestamp()+interval '1 hour',$10::jsonb)`,
    [tenantId, workId, runId, producerId, producerAgent, contract, String(producerAgent), `ags_${"b".repeat(32)}`, "b".repeat(64), JSON.stringify({ artifact: label })]);
    await pool.query(`INSERT INTO core_nyra_autopilot_assignments (tenant_id,work_id,run_id,assignment_id,assignment_key,agent_instance_id,blueprint_id,role,task_contract,dependencies,eligible_client_types,status,claimed_agent_id,claimed_client_type,claimed_presence_signature,claimed_session_fingerprint,claim_expires_at,submitted_result)
      VALUES ($1,$2,$3,$4,'verify',$5,'verifier','independent_verifier',$6::jsonb,'[]'::jsonb,'["codex"]'::jsonb,'claimed',$7,'codex',$8,$9,clock_timestamp()+interval '1 hour',NULL)`,
    [tenantId, workId, runId, verifierId, verifierAgent, contract, String(verifierAgent), `ags_${"a".repeat(32)}`, "a".repeat(64)]);
    return { workId, taskId, verifierId, producerId, verifierAgent };
  }
  const submissionOptions = (actor, workId) => ({
    prepareSubmission: (_input, { client }) => v2.prepareNyraAutopilotSubmissionInServerTransaction(actor, { work_id: _input.work_id }, { client }),
    validateSubmission: ({ assignment, result }, { client }) => v2.validateNyraAutopilotVerificationCandidateInServerTransaction(actor, { work_id: workId, assignment_id: assignment.assignment_id, assignment, result }, { client }),
  });
  const valid = await fixture("valid");
  const verifier = identity(tenantId, valid.verifierAgent, "a");
  const result = { schema_version: "nyra_independent_verification_v1", verdict: "approved", summary: "Independent PostgreSQL verification passed.", verified_work_task_ids: [valid.taskId], verified_assignment_ids: [valid.producerId], evidence_refs: ["test:atomic-submit"] };
  const submitInput = { work_id: valid.workId, assignment_id: valid.verifierId,
    idempotency_key: `submit-valid-${nonce}`, result };
  const [submitted, concurrentReplay] = await Promise.all([
    autopilot.submit(verifier, submitInput, submissionOptions(verifier, valid.workId)),
    autopilot.submit(verifier, submitInput, submissionOptions(verifier, valid.workId)),
  ]);
  assert.equal(submitted.assignment.status, "submitted");
  assert.equal(concurrentReplay.assignment.status, "submitted");
  assert.equal([submitted, concurrentReplay].filter((item) => item.idempotent_replay === true).length, 1);
  const projected = await v2.projectNyraAutopilotVerification(verifier, { work_id: valid.workId, assignment_id: valid.verifierId });
  assert.equal(projected.verification.verdict, "approved");
  const replay = await autopilot.submit(verifier, submitInput, submissionOptions(verifier, valid.workId));
  assert.equal(replay.idempotent_replay, true);
  const projectedReplay = await v2.projectNyraAutopilotVerification(verifier, { work_id: valid.workId, assignment_id: valid.verifierId });
  assert.equal(projectedReplay.idempotent_replay, true);
  const counts = await pool.query(`SELECT (SELECT count(*)::int FROM core_nyra_autopilot_receipts WHERE tenant_id=$1 AND work_id=$2) AS receipts, (SELECT count(*)::int FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2) AS evidence`, [tenantId, valid.workId]);
  assert.equal(counts.rows[0].receipts, 1); assert.equal(counts.rows[0].evidence, 1);

  const invalid = await fixture("invalid");
  const invalidVerifier = identity(tenantId, invalid.verifierAgent, "a");
  await assert.rejects(autopilot.submit(invalidVerifier, { work_id: invalid.workId, assignment_id: invalid.verifierId, idempotency_key: `submit-invalid-${nonce}`, result: { ...result, verified_work_task_ids: [] } }, submissionOptions(invalidVerifier, invalid.workId)), /nyra_autopilot_verification_scope_invalid/);
  const unchanged = await pool.query(`SELECT status,submitted_result FROM core_nyra_autopilot_assignments WHERE tenant_id=$1 AND work_id=$2 AND assignment_id=$3`, [tenantId, invalid.workId, invalid.verifierId]);
  assert.equal(unchanged.rows[0].status, "claimed"); assert.equal(unchanged.rows[0].submitted_result, null);
  const invalidReceipts = await pool.query(`SELECT count(*)::int AS count FROM core_nyra_autopilot_receipts WHERE tenant_id=$1 AND work_id=$2`, [tenantId, invalid.workId]);
  assert.equal(invalidReceipts.rows[0].count, 0);
});

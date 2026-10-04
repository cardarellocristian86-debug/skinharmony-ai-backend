import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createNyraAutopilotRuntime } from "../src/nyra-autopilot-runtime.js";
import { digest } from "../src/work-continuity-runtime.js";

const databaseUrl = String(process.env.WORK_CONTINUITY_DATABASE_URL || "").trim();
const TEAM_SCHEMA = `
CREATE TABLE IF NOT EXISTS core_nyra_agent_instances (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, agent_instance_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, work_id, agent_instance_id)
);`;

test("PostgreSQL 16 atomically expires and replaces one overdue independent verifier claim", {
  skip: databaseUrl ? false : "WORK_CONTINUITY_DATABASE_URL is required for Nyra Autopilot PostgreSQL 16 integration",
}, async () => {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const tenantId = `pg16_expired_verifier_${nonce.slice(0, 18)}`;
  const workId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const pool = new Pool({ connectionString: databaseUrl, max: 4, statement_timeout: 15_000 });
  const runtime = createNyraAutopilotRuntime({ databaseUrl }, { pool, teamRuntime: { schemaSql: TEAM_SCHEMA } });
  try {
    await runtime.initialize();
    await pool.query(`INSERT INTO core_continuity_works
      (tenant_id,project_id,work_id,session_id,idea,objective,status,next_action,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)`, [
      tenantId, `expired-verifier-${nonce.slice(0, 12)}`, workId, `session-${nonce.slice(0, 12)}`,
      "Recover a verifier assignment", "Replace only an objectively expired verifier claim.",
      "Verify the recovered assignment.", "pg16-expired-verifier",
    ]);
    await pool.query(`INSERT INTO core_nyra_agent_instances (tenant_id,work_id,agent_instance_id)
      VALUES ($1,$2,$3)`, [tenantId, workId, agentId]);
    const plan = { schema_version: "nyra_autopilot_plan_v1", required_roles: [] };
    await pool.query(`INSERT INTO core_nyra_autopilot_runs
      (tenant_id,work_id,run_id,project_id,trigger_type,architecture_version,intent_digest,plan,plan_digest,created_by,status)
      VALUES ($1,$2,$3,$4,'reconcile',1,$5,$6::jsonb,$7,'pg16-expired-verifier','materialized')`, [
      tenantId, workId, runId, `expired-verifier-${nonce.slice(0, 12)}`,
      digest({ tenantId, workId, nonce }), JSON.stringify(plan), digest(plan),
    ]);
    await pool.query(`INSERT INTO core_nyra_autopilot_assignments
      (tenant_id,work_id,run_id,assignment_id,assignment_key,agent_instance_id,blueprint_id,role,task_contract,dependencies,
       eligible_client_types,status,claimed_agent_id,claimed_client_type,claimed_presence_signature,claimed_session_fingerprint,claim_expires_at)
      VALUES ($1,$2,$3,$4,'verify',$5,'independent_verifier','independent_verifier',$6::jsonb,$7::jsonb,$8::jsonb,
       'claimed','expired-verifier','codex','ags_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',$9,clock_timestamp()-interval '1 minute')`, [
      tenantId, workId, runId, assignmentId, agentId,
      JSON.stringify({ schema_version: "nyra_autopilot_assignment_v1", bounded: true }),
      JSON.stringify(["research", "execute"]), JSON.stringify(["codex"]), "f".repeat(64),
    ]);
    const input = { work_id: workId, assignment_id: assignmentId, idempotency_key: `reissue_${nonce.slice(0, 24)}` };
    const [first, second] = await Promise.all([
      runtime.reissueQuarantinedAssignment({ tenantId }, input),
      runtime.reissueQuarantinedAssignment({ tenantId }, input),
    ]);
    assert.equal(first.assignment.assignment_id, second.assignment.assignment_id);
    assert.notEqual(first.assignment.assignment_id, assignmentId);
    assert.equal(first.assignment.status, "offered");
    assert.deepEqual(first.assignment.dependencies, ["research", "execute"]);
    assert.equal(first.assignment.task_contract.reissue.source_assignment_id, assignmentId);
    assert.equal(first.assignment.task_contract.reissue.recovery_status, "expired");
    const rows = await pool.query(`SELECT assignment_id,status,task_contract FROM core_nyra_autopilot_assignments
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY created_at`, [tenantId, workId]);
    assert.equal(rows.rows.filter((row) => row.status === "expired").length, 1);
    assert.equal(rows.rows.filter((row) => row.task_contract?.reissue?.source_assignment_id === assignmentId).length, 1);
    const receipts = await pool.query(`SELECT event_type,payload FROM core_nyra_autopilot_receipts
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number`, [tenantId, workId]);
    assert.deepEqual(receipts.rows.map((row) => row.event_type), ["nyra_assignment_claim_expired", "nyra_assignment_reissued"]);
    assert.equal(receipts.rows[1].payload.recovery_status, "expired");
  } finally {
    await pool.end();
  }
});

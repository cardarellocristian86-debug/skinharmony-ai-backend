import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { createNyraAutopilotRuntime } from "../src/nyra-autopilot-runtime.js";
import { createNyraNativeTeamRuntime } from "../src/nyra-native-team-runtime.js";
import { digest } from "../src/work-continuity-runtime.js";

const databaseUrl = String(process.env.WORK_CONTINUITY_DATABASE_URL || "").trim();
const identifier = (value) => {
  assert.match(value, /^[a-z][a-z0-9_]{1,62}$/);
  return `"${value}"`;
};

function identity(tenantId, agentId, session = "a") {
  return {
    tenantId,
    agentPresence: {
      agent_id: agentId, client_type: "codex", transport_bound: true,
      signature: `ags_${session.repeat(32)}`,
      host_transport_session_fingerprint: session.repeat(64),
    },
  };
}

test("PostgreSQL 16 verifier evidence read binds exact claim, run receipts and credential boundary", {
  skip: databaseUrl ? false : "WORK_CONTINUITY_DATABASE_URL is required for verifier evidence integration",
}, async (t) => {
  const schema = `verifier_evidence_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${identifier(schema)}`);
  const pool = new Pool({ connectionString: databaseUrl, max: 2, options: `-c search_path=${schema}` });
  const teamRuntime = createNyraNativeTeamRuntime({ databaseUrl }, { pool });
  const runtime = createNyraAutopilotRuntime({ databaseUrl }, { pool, teamRuntime });
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${identifier(schema)} CASCADE`);
    await admin.end();
  });
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const tenantId = `verifier_pg_${nonce.slice(0, 18)}`;
  const projectId = `project_${nonce.slice(0, 14)}`;
  const hash = (value) => crypto.createHash("sha256").update(`${nonce}:${value}`).digest("hex");

  async function appendReceipt(workId, eventType, payload, { corrupt = false } = {}) {
    const previous = await pool.query(`SELECT sequence_number,receipt_hash FROM core_nyra_autopilot_receipts
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1`, [tenantId, workId]);
    const sequence = Number(previous.rows[0]?.sequence_number || 0) + 1;
    const unsigned = { tenant_id: tenantId, work_id: workId, sequence_number: sequence,
      event_type: eventType, payload, previous_receipt_hash: previous.rows[0]?.receipt_hash || null };
    await pool.query(`INSERT INTO core_nyra_autopilot_receipts
      (tenant_id,work_id,receipt_id,sequence_number,event_type,payload,previous_receipt_hash,receipt_hash)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`, [
      tenantId, workId, crypto.randomUUID(), sequence, eventType, JSON.stringify(payload),
      unsigned.previous_receipt_hash, corrupt ? "0".repeat(64) : digest(unsigned),
    ]);
  }

  async function fixture(label, { missingReceipt = false, historicalSecret = false } = {}) {
    const workId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const otherRunId = crypto.randomUUID();
    const verifierId = crypto.randomUUID();
    const verifierAgent = crypto.randomUUID();
    const producerIds = [crypto.randomUUID(), crypto.randomUUID()];
    const otherId = crypto.randomUUID();
    const contract = { schema_version: "nyra_autopilot_assignment_v1", label };
    const plan = { schema_version: "nyra_autopilot_plan_v1", required_roles: [] };
    await pool.query(`INSERT INTO core_continuity_works
      (tenant_id,project_id,work_id,session_id,idea,objective,status,next_action,created_by)
      VALUES ($1,$2,$3,$4,'Verifier evidence','Read only verified producer evidence','active','Verify receipts','pg16')`,
    [tenantId, projectId, workId, `session-${label}`]);
    for (const id of [verifierAgent, ...producerIds, otherId, crypto.randomUUID()]) {
      await pool.query(`INSERT INTO core_nyra_agent_instances (tenant_id,project_id,work_id,agent_instance_id,blueprint_id,
        blueprint_version,blueprint_digest,role,parent_kind,parent_agent_id,status,execution_provider,execution_mode,
        model_invocation_allowed,external_action_allowed,core_gate_required,capability_allowlist,tool_allowlist,
        memory_scope,learning_mode,created_by)
        VALUES ($1,$2,$3,$4,$5,'v1',$6,'specialist','nyra','nyra','ready','none','disabled',false,false,true,
          '[]'::jsonb,'[]'::jsonb,'work','frozen','pg16')`,
      [tenantId, projectId, workId, id, `agent_${id.slice(0, 8)}`, hash(`agent:${id}`)]);
    }
    await pool.query(`INSERT INTO core_nyra_autopilot_runs
      (tenant_id,work_id,run_id,project_id,trigger_type,architecture_version,intent_digest,plan,plan_digest,status,created_by)
      VALUES ($1,$2,$3,$4,'work_created',1,$5,$6::jsonb,$7,'materialized','pg16'),
             ($1,$2,$8,$4,'reconcile',2,$9,$6::jsonb,$10,'materialized','pg16')`, [
      tenantId, workId, runId, projectId, hash(`${label}:intent`), JSON.stringify(plan), digest(plan), otherRunId,
      hash(`${label}:other-intent`), digest({ ...plan, other: true }),
    ]);
    await pool.query(`INSERT INTO core_nyra_autopilot_assignments
      (tenant_id,work_id,run_id,assignment_id,assignment_key,agent_instance_id,blueprint_id,role,task_contract,
       dependencies,eligible_client_types,status,claimed_agent_id,claimed_client_type,claimed_presence_signature,
       claimed_session_fingerprint,claim_expires_at)
      VALUES ($1,$2,$3,$4,'verify',$5,'independent_verifier','independent_verifier',$6::jsonb,
       '[]'::jsonb,'["codex"]'::jsonb,'claimed',$7,'codex',$8,$9,clock_timestamp()+interval '1 hour')`, [
      tenantId, workId, runId, verifierId, verifierAgent, JSON.stringify(contract), verifierAgent,
      "ags_" + "a".repeat(32), "a".repeat(64),
    ]);
    const results = historicalSecret
      ? [{ password: "historic-secret" }, { artifact: `${label}:two` }]
      : [{ artifact: `${label}:one` }, { artifact: `${label}:two` }];
    for (let index = 0; index < producerIds.length; index += 1) {
      await pool.query(`INSERT INTO core_nyra_autopilot_assignments
        (tenant_id,work_id,run_id,assignment_id,assignment_key,agent_instance_id,blueprint_id,role,task_contract,
         dependencies,eligible_client_types,status,submitted_result)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'executor_specialist',$8::jsonb,'[]'::jsonb,
          '["codex"]'::jsonb,'submitted',$9::jsonb)`, [
        tenantId, workId, runId, producerIds[index], `producer_${index}`, producerIds[index],
        `producer_${index}`, JSON.stringify(contract), JSON.stringify(results[index]),
      ]);
    }
    await pool.query(`INSERT INTO core_nyra_autopilot_assignments
      (tenant_id,work_id,run_id,assignment_id,assignment_key,agent_instance_id,blueprint_id,role,task_contract,
       dependencies,eligible_client_types,status,submitted_result)
      VALUES ($1,$2,$3,$4,'other_run',$5,'other_run','executor_specialist',$6::jsonb,'[]'::jsonb,
        '["codex"]'::jsonb,'submitted',$7::jsonb)`, [
      tenantId, workId, otherRunId, otherId, otherId, JSON.stringify(contract), JSON.stringify({ artifact: "other-run" }),
    ]);
    await appendReceipt(workId, "nyra_assignment_submitted", { assignment_id: producerIds[0], assignment_key: "producer_0", result_digest: digest(results[0]), execution_authorized: false });
    await appendReceipt(workId, "nyra_assignment_claimed", { assignment_id: verifierId, assignment_key: "verify", execution_authorized: false });
    if (!missingReceipt) await appendReceipt(workId, "nyra_assignment_submitted", { assignment_id: producerIds[1], assignment_key: "producer_1", result_digest: digest(results[1]), execution_authorized: false });
    await appendReceipt(workId, "nyra_assignment_submitted", { assignment_id: otherId, assignment_key: "other_run", result_digest: digest({ artifact: "other-run" }), execution_authorized: false });
    return { workId, runId, verifierId, verifierAgent, producerIds, results };
  }

  await runtime.initialize();
  const valid = await fixture("valid");
  const verifier = identity(tenantId, valid.verifierAgent, "a");
  const read = await runtime.readVerifierEvidence(verifier, { work_id: valid.workId, verifier_assignment_id: valid.verifierId });
  assert.deepEqual(read.producer_evidence.map((item) => item.assignment_id).sort(), [...valid.producerIds].sort());
  assert.equal(read.receipts.length, 2);
  assert.deepEqual(read.receipts.map((item) => item.payload.assignment_id).sort(), [...valid.producerIds].sort());
  await assert.rejects(runtime.readVerifierEvidence(identity(`${tenantId}x`, valid.verifierAgent, "a"), { work_id: valid.workId, verifier_assignment_id: valid.verifierId }), /nyra_verifier_evidence_read_denied/);
  await assert.rejects(runtime.readVerifierEvidence(verifier, { work_id: crypto.randomUUID(), verifier_assignment_id: valid.verifierId }), /nyra_verifier_evidence_read_denied/);
  await assert.rejects(runtime.readVerifierEvidence(identity(tenantId, valid.verifierAgent, "b"), { work_id: valid.workId, verifier_assignment_id: valid.verifierId }), /nyra_verifier_evidence_read_denied/);
  const changedSession = { ...verifier, agentPresence: { ...verifier.agentPresence,
    host_transport_session_fingerprint: "d".repeat(64) } };
  await assert.rejects(runtime.readVerifierEvidence(changedSession, { work_id: valid.workId, verifier_assignment_id: valid.verifierId }), /nyra_verifier_evidence_read_denied/);
  const incomplete = await fixture("incomplete");
  for (const status of ["offered", "claimed", "expired", "quarantined", "cancelled"]) {
    await pool.query(`UPDATE core_nyra_autopilot_assignments SET status=$4
      WHERE tenant_id=$1 AND work_id=$2 AND assignment_id=$3`, [tenantId, incomplete.workId, incomplete.producerIds[1], status]);
    await assert.rejects(runtime.readVerifierEvidence(identity(tenantId, incomplete.verifierAgent, "a"), {
      work_id: incomplete.workId, verifier_assignment_id: incomplete.verifierId,
    }), /nyra_verifier_evidence_producers_incomplete/);
    await assert.rejects(runtime.submit(identity(tenantId, incomplete.verifierAgent, "a"), {
      work_id: incomplete.workId, assignment_id: incomplete.verifierId,
      idempotency_key: `incomplete-${status}-${nonce}`, result: { verdict: "approved" },
    }), /nyra_verifier_evidence_producers_incomplete/);
  }

  const secretAgent = crypto.randomUUID();
  const secretAssignment = crypto.randomUUID();
  await pool.query(`INSERT INTO core_nyra_agent_instances (tenant_id,project_id,work_id,agent_instance_id,blueprint_id,
    blueprint_version,blueprint_digest,role,parent_kind,parent_agent_id,status,execution_provider,execution_mode,
    model_invocation_allowed,external_action_allowed,core_gate_required,capability_allowlist,tool_allowlist,
    memory_scope,learning_mode,created_by)
    VALUES ($1,$2,$3,$4,'secret_producer','v1',$5,'specialist','nyra','nyra','ready','none','disabled',false,false,true,
      '[]'::jsonb,'[]'::jsonb,'work','frozen','pg16')`, [tenantId, projectId, valid.workId, secretAgent, hash("secret-agent")]);
  await pool.query(`INSERT INTO core_nyra_autopilot_assignments
    (tenant_id,work_id,run_id,assignment_id,assignment_key,agent_instance_id,blueprint_id,role,task_contract,
     dependencies,eligible_client_types,status,claimed_agent_id,claimed_client_type,claimed_presence_signature,claimed_session_fingerprint,claim_expires_at)
    VALUES ($1,$2,$3,$4,'secret_submit',$5,'secret_producer','executor_specialist',$6::jsonb,'[]'::jsonb,
      '["codex"]'::jsonb,'claimed',$7,'codex',$8,$9,clock_timestamp()+interval '1 hour')`, [
    tenantId, valid.workId, valid.runId, secretAssignment, secretAgent,
    JSON.stringify({ schema_version: "nyra_autopilot_assignment_v1" }), secretAgent,
    "ags_" + "c".repeat(32), "c".repeat(64),
  ]);
  await assert.rejects(runtime.submit(identity(tenantId, secretAgent, "c"), {
    work_id: valid.workId, assignment_id: secretAssignment, idempotency_key: `secret-${nonce}`,
    result: { api_key: "sk-abcdefghijklmnopqrstuvwxyz0123456789" },
  }), /nyra_assignment_result_credential_material_denied/);
  // Rejected submission leaves its claim pending and cannot become approval evidence.
  await assert.rejects(runtime.readVerifierEvidence(verifier, { work_id: valid.workId, verifier_assignment_id: valid.verifierId }), /nyra_verifier_evidence_producers_incomplete/);

  const missing = await fixture("missing", { missingReceipt: true });
  await assert.rejects(runtime.readVerifierEvidence(identity(tenantId, missing.verifierAgent, "a"), { work_id: missing.workId, verifier_assignment_id: missing.verifierId }), /nyra_verifier_evidence_receipt_invalid/);
  await appendReceipt(missing.workId, "nyra_assignment_submitted", {
    assignment_id: missing.producerIds[1], assignment_key: "producer_1", result_digest: digest({ artifact: "wrong-output" }), execution_authorized: false,
  });
  await assert.rejects(runtime.readVerifierEvidence(identity(tenantId, missing.verifierAgent, "a"), { work_id: missing.workId, verifier_assignment_id: missing.verifierId }), /nyra_verifier_evidence_receipt_invalid/);
  const historicalSecret = await fixture("historic_secret", { historicalSecret: true });
  await assert.rejects(runtime.readVerifierEvidence(identity(tenantId, historicalSecret.verifierAgent, "a"), { work_id: historicalSecret.workId, verifier_assignment_id: historicalSecret.verifierId }), /nyra_verifier_evidence_credential_material_denied/);
  const corrupt = await fixture("corrupt");
  await appendReceipt(corrupt.workId, "nyra_assignment_claimed", { assignment_id: corrupt.verifierId, tampered: true }, { corrupt: true });
  await assert.rejects(runtime.readVerifierEvidence(identity(tenantId, corrupt.verifierAgent, "a"), { work_id: corrupt.workId, verifier_assignment_id: corrupt.verifierId }), /nyra_verifier_evidence_receipt_invalid/);
  await pool.query(`UPDATE core_nyra_autopilot_assignments SET claim_expires_at=clock_timestamp()-interval '1 second'
    WHERE tenant_id=$1 AND work_id=$2 AND assignment_id=$3`, [tenantId, missing.workId, missing.verifierId]);
  await assert.rejects(runtime.readVerifierEvidence(identity(tenantId, missing.verifierAgent, "a"), { work_id: missing.workId, verifier_assignment_id: missing.verifierId }), /nyra_verifier_evidence_read_denied/);
});

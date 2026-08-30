import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildAcceptanceContract,
  createWorkContinuityRuntime,
  digest,
} from "../src/work-continuity-runtime.js";
import {
  WORK_CONTINUITY_TOOLS,
  tenantWorkCoordinationTarget,
} from "../src/work-continuity-tools.js";

const WORK_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORK_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "project-a";

const key = (...parts) => parts.join("\u0000");

function nativeReport({ fingerprint, approved, commit = "a".repeat(40), criterionDigests }) {
  return {
    schema_version: "native_agent_report_v1",
    automation_stage: "system_verification",
    summary: approved ? "Exact incident recovery verified." : "Recovery rejected.",
    verdict: approved ? "approved" : "rejected",
    commit_sha: commit,
    tests: [{ name: "targeted", passed: approved }],
    evidence_refs: [`incident:${fingerprint}`],
    acceptance_evidence: criterionDigests.map((criterionDigest) => ({
      criterion_digest: criterionDigest,
      passed: approved,
      evidence_refs: [`incident:${fingerprint}`],
    })),
    live_verified: false,
    verifies_task_ids: ["build"],
    correction_required: !approved,
  };
}

class IncidentPool {
  constructor() {
    this.works = new Map([
      [key("tenant-a", WORK_ID), {
        tenant_id: "tenant-a", work_id: WORK_ID, project_id: PROJECT_ID,
        status: "blocked", next_action: "Resolve exact incident blockers.",
        block_source: "work_incident", block_reference: null, block_epoch: 1,
      }],
      [key("tenant-a", OTHER_WORK_ID), {
        tenant_id: "tenant-a", work_id: OTHER_WORK_ID, project_id: PROJECT_ID,
        status: "blocked", next_action: "Unrelated Work.",
        block_source: "work_incident", block_reference: null, block_epoch: 1,
      }],
    ]);
    this.associations = new Map();
    this.runbooks = new Map();
    this.plans = new Map();
    this.agents = new Map();
    this.receipts = new Map();
    this.bridges = new Map();
    this.attempts = new Map();
    this.events = new Map();
    this.workMutationCount = 0;
  }

  addIncident(fingerprint, { blocksWork = true, sourceAgentId = "builder-source" } = {}) {
    const now = "2026-08-28T12:00:00.000Z";
    this.associations.set(key("tenant-a", WORK_ID, fingerprint), {
      tenant_id: "tenant-a", work_id: WORK_ID, project_id: PROJECT_ID,
      fingerprint, scope_digest: fingerprint, runbook_digest: digest({ fingerprint }),
      error_code: `ERR_${fingerprint.slice(0, 6).toUpperCase()}`,
      reason: "Bounded incident reason", source_operation: "incident.test",
      source_plan_id: null, source_agent_id: sourceAgentId, created_by: "coordinator",
      status: "candidate", blocks_work: blocksWork, verification_evidence: null,
      verification_digest: null, verification_count: 0, failure_count: 0,
      state_version: 0, created_at: now, updated_at: now,
      raw_secret: "must-not-leave-store",
    });
    this.runbooks.set(key("tenant-a", PROJECT_ID, fingerprint), {
      status: "candidate", failure_count: 0, verification_count: 0,
    });
    if (blocksWork) {
      const work = this.works.get(key("tenant-a", WORK_ID));
      work.block_source = "work_incident";
      work.block_reference = fingerprint;
      work.block_epoch += 1;
    }
  }

  addProof(fingerprint, {
    approved = true,
    planId,
    receiptId,
    verifierAgentId = "independent-verifier",
  }) {
    const verifierTaskDigest = digest({ planId, task: "verify" });
    const builderTaskDigest = digest({ planId, task: "build" });
    const intentDigest = digest({ planId, intent: "incident recovery" });
    const acceptanceContract = buildAcceptanceContract({
      objective: "Verify the exact bounded incident recovery.",
      acceptance_criteria: [
        "The bounded incident is corrected and independently verified.",
      ],
      constraints: [],
    }, intentDigest);
    const criterionDigests = acceptanceContract.criteria
      .map((criterion) => criterion.criterion_digest);
    const incident = this.associations.get(key("tenant-a", WORK_ID, fingerprint));
    assert(incident, "proof requires an exact Work incident association");
    const v2TaskId = planId.replace(/^(.{8})-(.{4})-4/, "$1-$2-4");
    const plan = {
      schema_version: "native_agent_plan_v1",
      release_mode: "external_ticket_required",
      required_checks: ["core-mcp"],
      incident_fingerprints: [fingerprint],
      incident_bindings: [{
        schema_version: "native_agent_incident_binding_v1",
        fingerprint,
        scope_digest: incident.scope_digest,
        runbook_digest: incident.runbook_digest,
        incident_status: incident.status,
        state_version: incident.state_version,
      }],
      tasks: [
        { task_id: "build", kind: "builder", required: true, dependencies: [], task_digest: builderTaskDigest },
        { task_id: "verify", kind: "verifier", required: true, dependencies: ["build"], task_digest: verifierTaskDigest },
      ],
      closure_requirements: {
        independent_verifier_required: true,
        tests_required: true,
        evidence_required: true,
        live_verification_required: false,
      },
      acceptance_contract: acceptanceContract,
    };
    this.plans.set(key("tenant-a", WORK_ID, planId), {
      plan, plan_digest: digest(plan), status: "planned",
    });
    const builderReport = {
      schema_version: "native_agent_report_v1", automation_stage: "build",
      summary: "Built correction.", verdict: null, commit_sha: "a".repeat(40),
      tests: [{ name: "targeted", passed: true }], evidence_refs: ["build:receipt"],
      acceptance_evidence: [], live_verified: false, verifies_task_ids: [], correction_required: false,
    };
    const verifierReport = nativeReport({ fingerprint, approved, criterionDigests });
    const rows = [
      {
        task_id: "build", task_kind: "builder", task_digest: builderTaskDigest,
        agent_id: "builder-agent", status: "completed", report: builderReport,
        report_digest: digest({ status: "completed", report: builderReport }),
        coordinator_session_fingerprint: "c".repeat(24),
        native_session_fingerprint: "b".repeat(24),
        native_presence_signature: `ags_${"b".repeat(32)}`,
      },
      {
        task_id: "verify", task_kind: "verifier", task_digest: verifierTaskDigest,
        v2_task_id: v2TaskId, agent_id: verifierAgentId, status: "completed",
        report: verifierReport,
        report_digest: digest({ status: "completed", report: verifierReport }),
        coordinator_session_fingerprint: "c".repeat(24),
        native_session_fingerprint: "d".repeat(24),
        native_presence_signature: `ags_${"d".repeat(32)}`,
      },
    ];
    this.agents.set(key("tenant-a", WORK_ID, planId), rows);
    const verifier = rows[1];
    const receiptPayload = {
      task_id: "verify", task_kind: "verifier", status: "completed",
      report_digest: verifier.report_digest,
      native_session_fingerprint: verifier.native_session_fingerprint,
      native_presence_signature: verifier.native_presence_signature,
    };
    this.receipts.set(key("tenant-a", WORK_ID, planId, receiptId), {
      receipt_type: "agent_reported", agent_id: verifierAgentId,
      payload: receiptPayload, payload_digest: digest(receiptPayload),
    });
    if (approved) {
      this.bridges.set(key("tenant-a", WORK_ID, planId, "verify", receiptId), {
        evidence_id: planId,
        evidence_digest: digest({ planId, receiptId, fingerprint }),
        v2_task_id: v2TaskId,
        task_digest: verifierTaskDigest,
        verifier_agent_id: verifierAgentId,
        verifier_session_fingerprint: verifier.native_session_fingerprint,
        native_receipt_digest: digest(receiptPayload),
        report_digest: verifier.report_digest,
      });
    }
  }

  async query(sql, parameters = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.includes("CREATE TABLE IF NOT EXISTS core_continuity_works")) return { rows: [], rowCount: 0 };
    if (q.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
    if (q.startsWith("SELECT project_id,current_version,status,next_action,")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      return { rows: row ? [{ ...row, current_version: 1 }] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT i.fingerprint,i.scope_digest,i.runbook_digest,")) {
      const association = this.associations.get(key(parameters[0], parameters[1], parameters[3]));
      const runbook = this.runbooks.get(key(parameters[0], parameters[2], parameters[3]));
      return { rows: association && runbook ? [{ ...association, runbook_status: runbook.status }] : [] };
    }
    if (q.startsWith("SELECT p.plan,p.plan_digest,p.status AS plan_status,")) {
      const [tenantId, workId, planId, taskId, receiptId] = parameters;
      const plan = this.plans.get(key(tenantId, workId, planId));
      const agent = (this.agents.get(key(tenantId, workId, planId)) || [])
        .find((candidate) => candidate.task_id === taskId);
      const receipt = this.receipts.get(key(tenantId, workId, planId, receiptId));
      return { rows: plan && agent && receipt ? [{
        plan: plan.plan, plan_digest: plan.plan_digest, plan_status: plan.status,
        ...agent, agent_status: agent.status,
        receipt_type: receipt.receipt_type, receipt_agent_id: receipt.agent_id,
        receipt_payload: receipt.payload, receipt_digest: receipt.payload_digest,
      }] : [] };
    }
    if (q.startsWith("SELECT task_id,agent_id,task_kind,status,report,report_digest,")) {
      const rows = this.agents.get(key(parameters[0], parameters[1], parameters[2])) || [];
      return { rows: rows.map((row) => ({ ...row })) };
    }
    if (q.startsWith("SELECT evidence_id,evidence_digest,v2_task_id,task_digest,")) {
      const row = this.bridges.get(key(...parameters));
      return { rows: row ? [{ ...row }] : [] };
    }
    if (q.startsWith("SELECT resolved,result_status,evidence FROM core_continuity_work_incident_verifications")) {
      const row = this.attempts.get(key(parameters[0], parameters[1], parameters[2], parameters[3]));
      return { rows: row ? [{ ...row }] : [] };
    }
    if (q.startsWith("SELECT evidence_digest FROM core_continuity_work_incident_verifications")) {
      const row = [...this.attempts.values()].find((attempt) =>
        attempt.tenant_id === parameters[0] && attempt.work_id === parameters[1] &&
        attempt.fingerprint === parameters[2] && attempt.native_receipt_id === parameters[3]);
      return { rows: row ? [{ evidence_digest: row.evidence_digest }] : [] };
    }
    if (q.startsWith("UPDATE core_continuity_work_incidents SET status='verified'")) {
      const row = this.associations.get(key(parameters[0], parameters[1], parameters[3]));
      if (!row || !["candidate", "quarantined"].includes(row.status) ||
          row.state_version !== parameters[7]) return { rows: [] };
      row.status = "verified";
      row.verification_evidence = JSON.parse(parameters[5]);
      row.verification_digest = parameters[6];
      row.verification_count += 1;
      row.state_version += 1;
      row.updated_at = `2026-08-28T12:00:0${row.state_version}.000Z`;
      return { rows: [{ status: row.status, state_version: row.state_version }] };
    }
    if (q.startsWith("UPDATE core_continuity_work_incidents SET status=$5")) {
      const row = this.associations.get(key(parameters[0], parameters[1], parameters[3]));
      if (!row || row.status !== "candidate" || row.state_version !== parameters[8]) return { rows: [] };
      row.status = parameters[4];
      row.failure_count = parameters[5];
      row.verification_evidence = JSON.parse(parameters[6]);
      row.verification_digest = parameters[7];
      row.state_version += 1;
      row.updated_at = `2026-08-28T12:00:0${row.state_version}.000Z`;
      return { rows: [{ status: row.status, state_version: row.state_version }] };
    }
    if (q.startsWith("UPDATE core_continuity_incident_runbooks SET status='verified'")) {
      const row = this.runbooks.get(key(parameters[0], parameters[1], parameters[2]));
      if (row?.status !== "quarantined") row.status = "verified";
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("UPDATE core_continuity_incident_runbooks SET status=CASE")) {
      const row = this.runbooks.get(key(parameters[0], parameters[1], parameters[2]));
      row.failure_count += 1;
      if (row.status === "candidate" && row.failure_count >= 2) row.status = "quarantined";
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO core_continuity_work_incident_verifications")) {
      const [tenantId, workId, projectId, fingerprint, evidenceDigest, receiptId,
        evidenceJson, resultStatus, createdBy] = parameters;
      this.attempts.set(key(tenantId, workId, fingerprint, evidenceDigest), {
        tenant_id: tenantId, work_id: workId, project_id: projectId, fingerprint,
        evidence_digest: evidenceDigest, native_receipt_id: receiptId,
        resolved: q.includes("$6,true"), evidence: JSON.parse(evidenceJson),
        result_status: resultStatus || (q.includes("'verified'") ? "verified" : null), created_by: createdBy,
      });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT count(*)::int AS count FROM core_continuity_work_incidents")) {
      const count = [...this.associations.values()].filter((row) =>
        row.tenant_id === parameters[0] && row.work_id === parameters[1] && row.blocks_work === true &&
        ["candidate", "quarantined"].includes(row.status)).length;
      return { rows: [{ count }] };
    }
    if (q.startsWith("SELECT fingerprint,status,error_code,reason,reason_digest,")) {
      const rows = [...this.associations.values()].filter((row) =>
        row.tenant_id === parameters[0] && row.work_id === parameters[1] &&
        row.blocks_work === true && ["candidate", "quarantined"].includes(row.status))
        .sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at)) ||
          left.fingerprint.localeCompare(right.fingerprint));
      return { rows: rows.length ? [{ ...rows[0], unresolved_count: rows.length }] : [] };
    }
    if (q.startsWith("UPDATE core_continuity_works w SET status=CASE")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      const unresolved = [...this.associations.values()].some((incident) =>
        incident.work_id === row.work_id && incident.blocks_work === true &&
        ["candidate", "quarantined"].includes(incident.status));
      if (unresolved || !["active", "blocked"].includes(row.status)) return { rows: [] };
      if (row.status === "blocked") row.status = "active";
      row.next_action = parameters[2];
      this.workMutationCount += 1;
      return { rows: [{ status: row.status, next_action: row.next_action }] };
    }
    if (q.startsWith("UPDATE core_continuity_works SET status='blocked'")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      row.status = "blocked";
      row.next_action = parameters[2];
      row.block_source = "work_incident";
      row.block_reference = parameters[3];
      row.block_epoch += 1;
      this.workMutationCount += 1;
      return { rows: [{ status: row.status, next_action: row.next_action }] };
    }
    if (q.startsWith("UPDATE core_continuity_works w SET status='active'")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      const unresolved = [...this.associations.values()].some((incident) =>
        incident.tenant_id === parameters[0] && incident.work_id === parameters[1] &&
        incident.blocks_work === true && ["candidate", "quarantined"].includes(incident.status));
      if (unresolved || row.status !== "blocked" || row.block_source !== "work_incident" ||
          row.block_reference !== parameters[3]) return { rows: [] };
      row.status = "active";
      row.next_action = parameters[2];
      row.block_source = null;
      row.block_reference = null;
      row.block_epoch += 1;
      this.workMutationCount += 1;
      return { rows: [{ status: row.status, next_action: row.next_action }] };
    }
    if (q.startsWith("SELECT sequence_number,event_hash FROM core_continuity_events")) {
      const rows = this.events.get(key(parameters[0], parameters[1])) || [];
      return { rows: rows.length ? [rows.at(-1)] : [] };
    }
    if (q.startsWith("INSERT INTO core_continuity_events")) {
      const eventKey = key(parameters[0], parameters[1]);
      const rows = this.events.get(eventKey) || [];
      rows.push({ sequence_number: parameters[3], event_type: parameters[4],
        payload: JSON.parse(parameters[5]), event_hash: parameters[7] });
      this.events.set(eventKey, rows);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT i.fingerprint,i.scope_digest,i.error_code,i.reason,")) {
      const row = this.associations.get(key(parameters[0], parameters[1], parameters[2]));
      const work = this.works.get(key(parameters[0], parameters[1]));
      return { rows: row && work ? [{ ...row, project_id: work.project_id, work_status: work.status }] : [] };
    }
    if (q.startsWith("SELECT w.project_id,w.status,")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      const unresolved = [...this.associations.values()].filter((incident) =>
        incident.work_id === parameters[1] && incident.blocks_work === true &&
        ["candidate", "quarantined"].includes(incident.status)).length;
      return { rows: row ? [{ ...row, unresolved_count: unresolved }] : [] };
    }
    if (q.startsWith("SELECT fingerprint,scope_digest,error_code,reason,")) {
      const rows = [...this.associations.values()].filter((row) =>
        row.tenant_id === parameters[0] && row.work_id === parameters[1] &&
        (!parameters[2] || row.status === parameters[2])).slice(0, parameters[3]);
      return { rows: rows.map((row) => ({ ...row })) };
    }
    throw new Error(`unexpected_incident_query:${q.slice(0, 180)}`);
  }

  async end() {}
}

function verificationInput(fingerprint, planId, receiptId, resolved = true) {
  return {
    work_id: WORK_ID, project_id: PROJECT_ID, fingerprint, resolved,
    plan_id: planId, verifier_task_id: "verify", native_receipt_id: receiptId,
  };
}

test("Work incident promotion is exact, replay-safe, and activates only after real blockers drain", async () => {
  const pool = new IncidentPool();
  const first = "1".repeat(64);
  const second = "2".repeat(64);
  const advisory = "3".repeat(64);
  pool.addIncident(first);
  pool.addIncident(second);
  pool.addIncident(advisory, { blocksWork: false });
  const planOne = "31111111-1111-4111-8111-111111111111";
  const receiptOne = "41111111-1111-4111-8111-111111111111";
  const planTwo = "32222222-2222-4222-8222-222222222222";
  const receiptTwo = "42222222-2222-4222-8222-222222222222";
  pool.addProof(first, { planId: planOne, receiptId: receiptOne });
  pool.addProof(second, { planId: planTwo, receiptId: receiptTwo });
  const runtime = createWorkContinuityRuntime({}, { pool });
  const identity = { tenantId: "tenant-a", subject: "coordinator" };

  const firstResult = await runtime.verifyIncident(identity,
    verificationInput(first, planOne, receiptOne));
  assert.equal(firstResult.remaining_unresolved, 1);
  assert.equal(firstResult.work_status, "blocked");
  const eventCount = pool.events.get(key("tenant-a", WORK_ID)).length;
  const mutationCount = pool.workMutationCount;
  const version = pool.associations.get(key("tenant-a", WORK_ID, first)).state_version;
  const replay = await runtime.verifyIncident(identity,
    verificationInput(first, planOne, receiptOne));
  assert.equal(replay.idempotent_replay, true);
  assert.equal(pool.events.get(key("tenant-a", WORK_ID)).length, eventCount);
  assert.equal(pool.workMutationCount, mutationCount);
  assert.equal(pool.associations.get(key("tenant-a", WORK_ID, first)).state_version, version);

  const secondResult = await runtime.verifyIncident(identity,
    verificationInput(second, planTwo, receiptTwo));
  assert.equal(secondResult.remaining_unresolved, 0);
  assert.equal(secondResult.work_status, "active");
  assert.equal(pool.associations.get(key("tenant-a", WORK_ID, advisory)).status, "candidate");

  const listed = await runtime.listWorkIncidents(identity, { work_id: WORK_ID });
  assert.equal(listed.unresolved_count, 0);
  assert.equal(listed.incidents.find((item) => item.fingerprint === advisory).blocking, false);
  assert.equal(listed.raw_prompt_fields_returned, false);
  assert.doesNotMatch(JSON.stringify(listed), /must-not-leave-store/);
  const read = await runtime.readWorkIncident(identity, { work_id: WORK_ID, fingerprint: first });
  assert.equal(read.incident.verification.native_receipt_id, receiptOne);

  await assert.rejects(runtime.verifyIncident(identity, {
    ...verificationInput(first, planOne, receiptOne), work_id: OTHER_WORK_ID,
  }), /incident_work_association_not_found/);
});

test("independence binds the source agent, not merely the incident creator", async () => {
  const pool = new IncidentPool();
  const fingerprint = "4".repeat(64);
  const planId = "33333333-3333-4333-8333-333333333333";
  const receiptId = "43333333-3333-4333-8333-333333333333";
  pool.addIncident(fingerprint, { sourceAgentId: "reused-verifier" });
  pool.addProof(fingerprint, { planId, receiptId, verifierAgentId: "reused-verifier" });
  const runtime = createWorkContinuityRuntime({}, { pool });
  await assert.rejects(runtime.verifyIncident(
    { tenantId: "tenant-a", subject: "coordinator" },
    verificationInput(fingerprint, planId, receiptId),
  ), /incident_verifier_evidence_invalid/);
  assert.equal(pool.associations.get(key("tenant-a", WORK_ID, fingerprint)).status, "candidate");
});

test("incident verification preserves a foreign Work blocker and reselects the remaining incident", async () => {
  const pool = new IncidentPool();
  const first = "9".repeat(64);
  const second = "a".repeat(64);
  const firstPlan = "3ccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const firstReceipt = "4ccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const secondPlan = "3ddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const secondReceipt = "4ddddddd-dddd-4ddd-8ddd-dddddddddddd";
  pool.addIncident(first);
  pool.addIncident(second);
  pool.addProof(second, { planId: secondPlan, receiptId: secondReceipt });
  const runtime = createWorkContinuityRuntime({}, { pool });
  const identity = { tenantId: "tenant-a", subject: "coordinator" };

  const outOfOrder = await runtime.verifyIncident(identity,
    verificationInput(second, secondPlan, secondReceipt));
  const incidentOwnedWork = pool.works.get(key("tenant-a", WORK_ID));
  assert.equal(outOfOrder.remaining_unresolved, 1);
  assert.equal(outOfOrder.current_blocker_fingerprint, first);
  assert.equal(incidentOwnedWork.block_source, "work_incident");
  assert.equal(incidentOwnedWork.block_reference, first);
  assert.match(incidentOwnedWork.next_action, new RegExp(first.slice(0, 12)));

  pool.addProof(first, { planId: firstPlan, receiptId: firstReceipt });
  incidentOwnedWork.status = "blocked";
  incidentOwnedWork.next_action = "Rebind the expired native lease before resuming.";
  incidentOwnedWork.block_source = "native_agent_lease";
  incidentOwnedWork.block_reference = "lease-plan-123";
  incidentOwnedWork.block_epoch = 17;
  const mutationCount = pool.workMutationCount;
  const foreignBlocked = await runtime.verifyIncident(identity,
    verificationInput(first, firstPlan, firstReceipt));
  assert.equal(foreignBlocked.remaining_unresolved, 0);
  assert.equal(foreignBlocked.work_status, "blocked");
  assert.equal(foreignBlocked.work_reactivated, false);
  assert.equal(foreignBlocked.next_action, "Rebind the expired native lease before resuming.");
  assert.equal(incidentOwnedWork.block_source, "native_agent_lease");
  assert.equal(incidentOwnedWork.block_reference, "lease-plan-123");
  assert.equal(incidentOwnedWork.block_epoch, 17);
  assert.equal(pool.workMutationCount, mutationCount);
});

test("forged tenant, Work, plan, fingerprint, receipt and bridge bindings fail closed", async () => {
  const fingerprint = "6".repeat(64);
  const otherFingerprint = "7".repeat(64);
  const planId = "37777777-7777-4777-8777-777777777777";
  const receiptId = "47777777-7777-4777-8777-777777777777";
  const setup = () => {
    const pool = new IncidentPool();
    pool.addIncident(fingerprint);
    pool.addIncident(otherFingerprint);
    pool.addProof(fingerprint, { planId, receiptId });
    return { pool, runtime: createWorkContinuityRuntime({}, { pool }) };
  };
  {
    const { runtime } = setup();
    await assert.rejects(runtime.verifyIncident({ tenantId: "tenant-b" },
      verificationInput(fingerprint, planId, receiptId)), /continuity_work_not_found/);
  }
  {
    const { runtime } = setup();
    await assert.rejects(runtime.verifyIncident({ tenantId: "tenant-a" }, {
      ...verificationInput(fingerprint, planId, receiptId), work_id: OTHER_WORK_ID,
    }), /incident_work_association_not_found/);
  }
  {
    const { runtime } = setup();
    await assert.rejects(runtime.verifyIncident({ tenantId: "tenant-a" },
      verificationInput(fingerprint, "38888888-8888-4888-8888-888888888888", receiptId)),
    /incident_verifier_receipt_not_found/);
  }
  {
    const { runtime } = setup();
    await assert.rejects(runtime.verifyIncident({ tenantId: "tenant-a" },
      verificationInput(fingerprint, planId, "48888888-8888-4888-8888-888888888888")),
    /incident_verifier_receipt_not_found/);
  }
  {
    const { runtime } = setup();
    await assert.rejects(runtime.verifyIncident({ tenantId: "tenant-a" },
      verificationInput(otherFingerprint, planId, receiptId)), /incident_verifier_evidence_invalid/);
  }
  {
    const { pool, runtime } = setup();
    pool.receipts.get(key("tenant-a", WORK_ID, planId, receiptId)).payload_digest = "f".repeat(64);
    await assert.rejects(runtime.verifyIncident({ tenantId: "tenant-a" },
      verificationInput(fingerprint, planId, receiptId)), /incident_verifier_receipt_binding_invalid/);
  }
  {
    const { pool, runtime } = setup();
    const agents = pool.agents.get(key("tenant-a", WORK_ID, planId));
    const verifier = agents.find((agent) => agent.task_id === "verify");
    verifier.report.evidence_refs = ["ticket:unrelated"];
    for (const evidence of verifier.report.acceptance_evidence) {
      evidence.evidence_refs = ["ticket:unrelated"];
    }
    verifier.report_digest = digest({ status: verifier.status, report: verifier.report });
    const receipt = pool.receipts.get(key("tenant-a", WORK_ID, planId, receiptId));
    receipt.payload.report_digest = verifier.report_digest;
    receipt.payload_digest = digest(receipt.payload);
    const bridge = pool.bridges.get(key("tenant-a", WORK_ID, planId, "verify", receiptId));
    bridge.report_digest = verifier.report_digest;
    bridge.native_receipt_digest = receipt.payload_digest;
    await assert.rejects(runtime.verifyIncident({ tenantId: "tenant-a" },
      verificationInput(fingerprint, planId, receiptId)),
    /incident_verifier_scope_binding_required/);
  }
  {
    const { pool, runtime } = setup();
    pool.bridges.clear();
    await assert.rejects(runtime.verifyIncident({ tenantId: "tenant-a" },
      verificationInput(fingerprint, planId, receiptId)),
    /incident_native_verifier_bridge_evidence_required/);
  }
  {
    const { pool, runtime } = setup();
    pool.attempts.set(key("tenant-a", WORK_ID, fingerprint, "e".repeat(64)), {
      tenant_id: "tenant-a", work_id: WORK_ID, fingerprint,
      evidence_digest: "e".repeat(64), native_receipt_id: receiptId,
      resolved: true, evidence: { forged: true }, result_status: "verified",
    });
    await assert.rejects(runtime.verifyIncident({ tenantId: "tenant-a" },
      verificationInput(fingerprint, planId, receiptId)), /incident_verification_receipt_conflict/);
  }
});

test("non-blocking incident verification never mutates Work and verified state cannot degrade", async () => {
  const pool = new IncidentPool();
  const fingerprint = "8".repeat(64);
  pool.works.get(key("tenant-a", WORK_ID)).status = "active";
  pool.works.get(key("tenant-a", WORK_ID)).next_action = "Keep current Work action.";
  pool.works.get(key("tenant-a", WORK_ID)).block_source = null;
  pool.works.get(key("tenant-a", WORK_ID)).block_reference = null;
  pool.addIncident(fingerprint, { blocksWork: false });
  const rejectedPlan = "39999999-9999-4999-8999-999999999999";
  const rejectedReceipt = "49999999-9999-4999-8999-999999999999";
  const approvedPlan = "3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const approvedReceipt = "4aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  pool.addProof(fingerprint, { planId: rejectedPlan, receiptId: rejectedReceipt, approved: false });
  const runtime = createWorkContinuityRuntime({}, { pool });
  const identity = { tenantId: "tenant-a", subject: "coordinator" };
  const failed = await runtime.verifyIncident(identity,
    verificationInput(fingerprint, rejectedPlan, rejectedReceipt, false));
  assert.equal(failed.work_status, "active");
  assert.equal(failed.next_action, "Keep current Work action.");
  assert.equal(pool.workMutationCount, 0);
  pool.addProof(fingerprint, { planId: approvedPlan, receiptId: approvedReceipt, approved: true });
  const verified = await runtime.verifyIncident(identity,
    verificationInput(fingerprint, approvedPlan, approvedReceipt, true));
  assert.equal(verified.work_status, "active");
  assert.equal(verified.next_action, "Keep current Work action.");
  assert.equal(pool.workMutationCount, 0);

  const laterRejectedPlan = "3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const laterRejectedReceipt = "4bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  pool.addProof(fingerprint, {
    planId: laterRejectedPlan, receiptId: laterRejectedReceipt, approved: false,
  });
  await assert.rejects(runtime.verifyIncident(identity,
    verificationInput(fingerprint, laterRejectedPlan, laterRejectedReceipt, false)),
  /incident_verified_cannot_degrade/);
  assert.equal(pool.associations.get(key("tenant-a", WORK_ID, fingerprint)).status, "verified");
});

test("failed proof replay is a no-op and quarantined Work state can recover only with fresh exact proof", async () => {
  const pool = new IncidentPool();
  const fingerprint = "5".repeat(64);
  pool.addIncident(fingerprint);
  const rejectedOne = {
    planId: "34444444-4444-4444-8444-444444444444",
    receiptId: "44444444-4444-4444-8444-444444444444",
  };
  const rejectedTwo = {
    planId: "35555555-5555-4555-8555-555555555555",
    receiptId: "45555555-5555-4555-8555-555555555555",
  };
  const approved = {
    planId: "36666666-6666-4666-8666-666666666666",
    receiptId: "46666666-6666-4666-8666-666666666666",
  };
  pool.addProof(fingerprint, { ...rejectedOne, approved: false });
  const runtime = createWorkContinuityRuntime({}, { pool });
  const identity = { tenantId: "tenant-a", subject: "coordinator" };
  const first = await runtime.verifyIncident(identity,
    verificationInput(fingerprint, rejectedOne.planId, rejectedOne.receiptId, false));
  assert.equal(first.failure_count, 1);
  const eventsAfterFirst = pool.events.get(key("tenant-a", WORK_ID)).length;
  const replay = await runtime.verifyIncident(identity,
    verificationInput(fingerprint, rejectedOne.planId, rejectedOne.receiptId, false));
  assert.equal(replay.idempotent_replay, true);
  assert.equal(pool.events.get(key("tenant-a", WORK_ID)).length, eventsAfterFirst);
  pool.addProof(fingerprint, { ...rejectedTwo, approved: false });
  const quarantined = await runtime.verifyIncident(identity,
    verificationInput(fingerprint, rejectedTwo.planId, rejectedTwo.receiptId, false));
  assert.equal(quarantined.status, "quarantined");
  // The reusable project runbook is not the lifecycle authority for a
  // particular Work. Only the Work-scoped association is quarantined.
  assert.equal(pool.runbooks.get(key("tenant-a", PROJECT_ID, fingerprint)).status, "candidate");

  pool.addProof(fingerprint, { ...approved, approved: true });
  const recovered = await runtime.verifyIncident(identity,
    verificationInput(fingerprint, approved.planId, approved.receiptId, true));
  assert.equal(recovered.status, "verified");
  assert.equal(recovered.work_status, "active");
  assert.equal(pool.runbooks.get(key("tenant-a", PROJECT_ID, fingerprint)).status, "candidate");
});

test("incident schemas exclude caller evidence and deploy repeatable monotone persistence", () => {
  assert.equal(
    tenantWorkCoordinationTarget("work_continuity_incident_record", { work_id: WORK_ID }),
    `incident:${WORK_ID}`,
  );
  assert.equal(
    tenantWorkCoordinationTarget("work_continuity_incident_verify", { work_id: WORK_ID }),
    `incident:${WORK_ID}`,
  );
  const verify = WORK_CONTINUITY_TOOLS.find((tool) =>
    tool.name === "work_continuity_incident_verify");
  assert.equal(verify.inputSchema.properties.tests, undefined);
  assert.equal(verify.inputSchema.properties.evidence_refs, undefined);
  for (const required of ["plan_id", "verifier_task_id", "native_receipt_id"]) {
    assert(verify.inputSchema.required.includes(required));
  }
  for (const name of ["work_continuity_incident_list", "work_continuity_incident_read"]) {
    assert.equal(WORK_CONTINUITY_TOOLS.find((tool) => tool.name === name).annotations.readOnlyHint, true);
  }
  const runtime = createWorkContinuityRuntime({}, { pool: { query: async () => ({ rows: [] }), end() {} } });
  assert.match(runtime.schemaSql, /core_continuity_work_incidents_monotone_guard/);
  assert.match(runtime.schemaSql, /core_continuity_runtime_migrations/);
  assert.doesNotMatch(runtime.schemaSql, /migration_claim/);
  const migration = readFileSync(new URL(
    "../migrations/20260830_work_incident_reconciliation_v1.sql",
    import.meta.url,
  ), "utf8");
  assert.match(migration, /UNIQUE \(tenant_id, work_id, fingerprint, native_receipt_id\)/);
  assert.match(migration, /legacy_projection_sequence/);
  assert.match(migration, /core_continuity_incident_event_binding_guard/);
  assert.match(migration, /core_continuity_work_legacy_block_reconciliation_required/);
  assert.match(migration, /core_continuity_work_completed_immutable/);
  assert.match(migration, /core_continuity_work_block_epoch_regression/);
  assert.match(migration, /core_continuity_work_block_provenance_conflict/);
  assert.match(migration, /core_continuity_work_block_release_provenance_invalid/);
  assert.doesNotMatch(migration, /WITH latest_work_incident AS/);
});

test("incident reconcile schema accepts only exact Work and human-safe idempotency", () => {
  assert.equal(
    tenantWorkCoordinationTarget("work_continuity_incident_reconcile", { work_id: WORK_ID }),
    `incident:${WORK_ID}`,
  );
  const reconcile = WORK_CONTINUITY_TOOLS.find((tool) =>
    tool.name === "work_continuity_incident_reconcile");
  assert.ok(reconcile);
  assert.equal(reconcile.annotations.readOnlyHint, false);
  assert.deepEqual(reconcile.scopes, ["core:govern"]);
  assert.deepEqual(reconcile.inputSchema.required, ["work_id", "idempotency_key"]);
  assert.equal(reconcile.inputSchema.additionalProperties, false);
  assert.deepEqual(
    Object.keys(reconcile.inputSchema.properties).filter((name) =>
      !["agent_id", "client_type", "session_id"].includes(name)),
    ["work_id", "idempotency_key"],
  );
  assert.equal(reconcile.inputSchema.properties.tenant_id, undefined);
  assert.equal(reconcile.inputSchema.properties.project_id, undefined);
  assert.equal(reconcile.inputSchema.properties.fingerprint, undefined);
  assert.equal(reconcile.inputSchema.properties.idempotency_key.minLength, 8);
  assert.equal(reconcile.inputSchema.properties.idempotency_key.maxLength, 160);
  assert.equal(
    reconcile.inputSchema.properties.idempotency_key.pattern,
    "^[^\\u0000-\\u001f\\u007f]+$",
  );
});

test("server exposes exact-Work incident reconciliation behind record ACL only", () => {
  const serverSource = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const handlerStart = serverSource.indexOf("work_continuity_incident_reconcile: async");
  const handlerEnd = serverSource.indexOf("work_continuity_incident_verify: async", handlerStart);
  assert.notEqual(handlerStart, -1);
  assert.notEqual(handlerEnd, -1);
  const handler = serverSource.slice(handlerStart, handlerEnd);
  assert.match(
    handler,
    /requireCanonicalWorkMutation\(identity, args\.work_id, "operate", canRecordTask\)/,
  );
  assert.match(handler, /reconcileLegacyIncidentForWork/);
  assert.doesNotMatch(handler, /tenant_id/);

  assert.doesNotMatch(serverSource, /reconcileLegacyIncidentAssociations/);
  assert.doesNotMatch(serverSource, /workIncidentReconciliationTimer/);
  const v2ReadyStart = serverSource.indexOf("const workContinuityV2StoreReady");
  const v2ReadyEnd = serverSource.indexOf(
    "void workContinuityV2StoreReady?.catch",
    v2ReadyStart,
  );
  assert.notEqual(v2ReadyStart, -1);
  assert.notEqual(v2ReadyEnd, -1);
  assert.match(
    serverSource.slice(v2ReadyStart, v2ReadyEnd),
    /\.then\(\(\) => workContinuityV2Store\.initialize\(\)\)/,
  );
  const bridgeStart = serverSource.indexOf("setNativeVerifierEvidenceBridge(");
  const bridgeEnd = serverSource.indexOf("const nyraNativeTeamRuntime", bridgeStart);
  assert.notEqual(bridgeStart, -1);
  assert.notEqual(bridgeEnd, -1);
  const bridge = serverSource.slice(bridgeStart, bridgeEnd);
  assert.doesNotMatch(bridge, /workContinuityV2StoreReady/);
  assert.match(bridge, /recordNativeVerifierEvidenceWithClient\(client, source\)/);

  const readinessStart = serverSource.indexOf("if (continuityRequired && workContinuityRuntime)");
  const readinessEnd = serverSource.indexOf(
    "if (genericWorkCoreJoinActivationEnabled && workContinuityV2Store)",
    readinessStart,
  );
  const readiness = serverSource.slice(readinessStart, readinessEnd);
  assert.match(readiness, /await workContinuityV2StoreReady/);
});

test("native closure handlers use reachable review and operate capabilities with exact Work predicates", () => {
  const serverSource = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const evaluateStart = serverSource.indexOf("work_continuity_closure_evaluate: async");
  const finalizeStart = serverSource.indexOf(
    "work_continuity_closure_finalize: async",
    evaluateStart,
  );
  const finalizeEnd = serverSource.indexOf(
    "work_continuity_atlas_upsert:",
    finalizeStart,
  );
  assert.notEqual(evaluateStart, -1);
  assert.notEqual(finalizeStart, -1);
  assert.notEqual(finalizeEnd, -1);

  const evaluateHandler = serverSource.slice(evaluateStart, finalizeStart);
  assert.match(
    evaluateHandler,
    /requireCanonicalWorkMutation\(\s*identity,\s*args\.work_id,\s*"review_candidate",\s*canContributeEvidence,\s*\)/,
  );
  const finalizeHandler = serverSource.slice(finalizeStart, finalizeEnd);
  assert.match(
    finalizeHandler,
    /requireCanonicalWorkMutation\(identity, args\.work_id, "operate", canClose\)/,
  );
  assert.doesNotMatch(finalizeHandler, /"close"/);
});

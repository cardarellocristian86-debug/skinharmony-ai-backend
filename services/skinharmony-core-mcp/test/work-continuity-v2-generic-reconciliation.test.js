import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  ADDITIVE_SCHEMA_SQL,
  createWorkContinuityV2Store,
  deriveEffectiveGenericClosureEvidence,
  deriveGenericClosureReadiness,
} from "../src/work-continuity-v2-store.js";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function reconciliationFixture({ current = true, independentlyVerified = true,
  omitAcceptanceCriterion = false, precommitOnly = false } = {}) {
  const tenantId = "tenant-a";
  const workId = "10000000-0000-4000-8000-000000000001";
  const planId = "20000000-0000-4000-8000-000000000001";
  const receiptId = "30000000-0000-4000-8000-000000000001";
  const replacementEvidenceId = "40000000-0000-4000-8000-000000000001";
  const legacyEvidenceIds = [
    "50000000-0000-4000-8000-000000000001",
    "50000000-0000-4000-8000-000000000002",
  ];
  const work = {
    tenant_id: tenantId,
    work_id: workId,
    legacy_work_id: workId,
    intent_digest: "a".repeat(64),
    objective: "Close Entity360 from verified live effects",
    acceptance_criteria: ["All Entity360 reads pass", "Gallery reports closure"],
    created_by_agent_id: "builder-origin",
    created_by_session_fingerprint: "b".repeat(64),
    status: "BLOCKED",
  };
  const criterionInputs = [
    ["objective", "objective", work.objective],
    ["acceptance_1", "acceptance", work.acceptance_criteria[0]],
    ["acceptance_2", "acceptance", work.acceptance_criteria[1]],
  ];
  const criteria = criterionInputs.map(([criterion_id, criterion_kind, text]) => {
    const material = {
      schema_version: "intent_acceptance_criterion_v1",
      intent_digest: work.intent_digest,
      criterion_id,
      criterion_kind,
      text,
    };
    return { criterion_id, criterion_kind, text, criterion_digest: digest(material) };
  });
  const acceptanceContract = {
    schema_version: "intent_acceptance_contract_v1",
    intent_digest: work.intent_digest,
    criteria,
    criteria_digest: digest(criteria),
    evidence_required: true,
    independent_verifier_required: true,
  };
  const planValue = {
    schema_version: "native_agent_plan_v1",
    tasks: [
      { task_id: "build-1", kind: "builder" },
      { task_id: "build-2", kind: "builder" },
      { task_id: "verify", kind: "verifier" },
    ],
    acceptance_contract: acceptanceContract,
  };
  const nativePlan = {
    plan_id: planId,
    plan: planValue,
    plan_digest: digest(planValue),
    status: "planned",
    plan_version: 2,
    current,
  };
  const reportCriteria = omitAcceptanceCriterion ? criteria.slice(0, -1) : criteria;
  const report = {
    schema_version: "native_agent_report_v1",
    verdict: "approved",
    correction_required: false,
    tests: [{ name: "live-readback", passed: true }],
    commit_sha: precommitOnly ? null : "9".repeat(40),
    live_verified: precommitOnly ? false : true,
    precommit_evidence: precommitOnly ? {
      schema_version: "native_precommit_evidence_v1",
      workspace_digest: "8".repeat(64),
    } : null,
    evidence_refs: precommitOnly ? ["workspace:precommit"] : [`commit:${"9".repeat(40)}`],
    verifies_task_ids: ["build-1", "build-2"],
    acceptance_evidence: reportCriteria.map((criterion) => ({
      criterion_digest: criterion.criterion_digest,
      passed: true,
      evidence_refs: [`evidence:${criterion.criterion_id}`],
    })),
  };
  const reportDigest = digest({ status: "completed", report });
  const receiptPayload = {
    schema_version: "native_agent_receipt_v1",
    receipt_id: receiptId,
    work_id: workId,
    plan_id: planId,
    receipt_type: "agent_reported",
    agent_id: "independent-verifier",
    task_id: "verify",
    task_kind: "verifier",
    status: "completed",
    report_digest: reportDigest,
    host_native: true,
    provider_execution: false,
  };
  const receiptDigest = digest(receiptPayload);
  const replacement = {
    tenant_id: tenantId,
    work_id: workId,
    evidence_id: replacementEvidenceId,
    kind: "native_verifier_terminal_report",
    digest: "c".repeat(64),
    required: true,
    independently_verified: independentlyVerified,
    verified_by_agent_id: "independent-verifier",
    verified_by_session_fingerprint: "d".repeat(64),
  };
  const legacy = legacyEvidenceIds.map((evidenceId) => ({
    tenant_id: tenantId,
    work_id: workId,
    evidence_id: evidenceId,
    kind: "legacy_required",
    digest: digest({ evidenceId }),
    required: true,
    independently_verified: false,
  }));
  const coverageDigest = digest({
    schema_version: "generic_closure_objective_acceptance_coverage_v1",
    tenant_id: tenantId,
    work_id: workId,
    intent_digest: work.intent_digest,
    objective: work.objective,
    acceptance_criteria: work.acceptance_criteria,
    native_plan_id: planId,
    native_plan_digest: nativePlan.plan_digest,
    native_acceptance_contract_digest: digest(acceptanceContract),
  });
  const reconciliations = legacy.map((legacyEvidence) => {
    const material = {
      schema_version: "generic_closure_evidence_reconciliation_v2",
      tenant_id: tenantId,
      work_id: workId,
      legacy_evidence_id: legacyEvidence.evidence_id,
      replacement_evidence_id: replacementEvidenceId,
      replacement_evidence_digest: replacement.digest,
      plan_id: planId,
      native_receipt_id: receiptId,
      native_receipt_digest: receiptDigest,
      report_digest: reportDigest,
      objective_acceptance_coverage_digest: coverageDigest,
    };
    return {
      ...material,
      mapping_digest: digest(material),
      native_plan: nativePlan,
      native_evidence: {
        evidence_id: replacementEvidenceId,
        evidence_digest: replacement.digest,
        plan_id: planId,
        native_receipt_id: receiptId,
        native_receipt_digest: receiptDigest,
        report_digest: reportDigest,
        verifier_agent_id: replacement.verified_by_agent_id,
        verifier_session_fingerprint: replacement.verified_by_session_fingerprint,
      },
      verifier_report: report,
      native_receipt: {
        receipt_type: "agent_reported",
        agent_id: replacement.verified_by_agent_id,
        payload: receiptPayload,
        payload_digest: receiptDigest,
      },
    };
  });
  return {
    work,
    tasks: [{ required: true, status: "completed", acceptance_verified: true }],
    evidence: [...legacy, replacement],
    fixture_material: { nativePlan, report,
      native: reconciliations[0].native_evidence,
      nativeReceipt: reconciliations[0].native_receipt,
      coverageDigest },
    join: { core_join_digest: "e".repeat(64) },
  };
}

function terminalV3Fixture() {
  const state = reconciliationFixture();
  const plan = { ...state.fixture_material.nativePlan, status: "closed" };
  const report = state.fixture_material.report;
  const replacement = state.evidence.find((item) =>
    item.kind === "native_verifier_terminal_report");
  const native = state.fixture_material.native;
  const nativeReceipt = state.fixture_material.nativeReceipt;
  const evaluationValue = { closed: true, native_v2_work_tasks_verified: true,
    target_commit: "9".repeat(40), native_v2_work_snapshot_digest: "7".repeat(64),
    report_bindings: [{ agent_id: replacement.verified_by_agent_id,
      report_digest: native.report_digest }] };
  const evaluation = { evaluation_id: "60000000-0000-4000-8000-000000000001",
    evaluation: evaluationValue, evaluation_digest: digest(evaluationValue) };
  const unsignedReleaseIntent = { tenant_id: state.work.tenant_id,
    work_id: state.work.work_id, head_commit: evaluationValue.target_commit };
  const releaseIntentDigest = digest(unsignedReleaseIntent);
  const releaseIntent = { ...unsignedReleaseIntent,
    release_intent_digest: releaseIntentDigest };
  const coreJoinRecord = { verdict: "ALLOW_FINALIZE" };
  const release = { evaluation_id: evaluation.evaluation_id,
    verdict_id: "hnj_" + "1".repeat(40), release_intent: releaseIntent,
    release_intent_digest: releaseIntentDigest, core_join_record: coreJoinRecord,
    core_join_record_digest: digest(coreJoinRecord) };
  const terminalPayload = { work_id: state.work.work_id, plan_id: plan.plan_id,
    target_commit: evaluationValue.target_commit, health_ok: true, external_release: true,
    closure_evaluation_id: evaluation.evaluation_id,
    closure_evaluation_digest: evaluation.evaluation_digest,
    release_intent_digest: release.release_intent_digest,
    core_join_verdict_id: release.verdict_id,
    external_readback_digest: "8".repeat(64) };
  const terminalReceipt = { receipt_id: "70000000-0000-4000-8000-000000000001",
    receipt_type: "closure_finalized", payload: terminalPayload,
    payload_digest: digest(terminalPayload) };
  const batchId = "80000000-0000-4000-8000-000000000001";
  const mappings = state.evidence.filter((item) => item.kind === "legacy_required")
    .map((legacy) => {
      const material = { schema_version: "generic_closure_evidence_mapping_v3",
        tenant_id: state.work.tenant_id, work_id: state.work.work_id, batch_id: batchId,
        legacy_evidence_id: legacy.evidence_id,
        replacement_evidence_id: replacement.evidence_id };
      return { ...material, mapping_digest: digest(material), native_evidence: native,
        verifier_report: report, native_receipt: nativeReceipt };
    }).sort((left, right) => left.legacy_evidence_id.localeCompare(right.legacy_evidence_id));
  const coverageDigest = state.fixture_material.coverageDigest;
  const batchMaterial = {
    schema_version: "generic_closure_evidence_reconciliation_batch_v3",
    tenant_id: state.work.tenant_id, work_id: state.work.work_id, batch_id: batchId,
    batch_version: 1, previous_batch_digest: null, plan_id: plan.plan_id,
    plan_digest: plan.plan_digest, closure_evaluation_id: evaluation.evaluation_id,
    closure_evaluation_digest: evaluation.evaluation_digest,
    native_work_snapshot_digest: evaluationValue.native_v2_work_snapshot_digest,
    release_verdict_id: release.verdict_id,
    release_intent_digest: release.release_intent_digest,
    core_join_record_digest: release.core_join_record_digest,
    target_commit: evaluationValue.target_commit,
    terminal_receipt_id: terminalReceipt.receipt_id,
    terminal_receipt_digest: terminalReceipt.payload_digest,
    live_readback_digest: terminalPayload.external_readback_digest,
    objective_acceptance_coverage_digest: coverageDigest,
    mapping_set_digest: digest(mappings.map((mapping) => ({
      legacy_evidence_id: mapping.legacy_evidence_id,
      replacement_evidence_id: mapping.replacement_evidence_id,
      mapping_digest: mapping.mapping_digest,
    }))),
  };
  return { ...state, generic_evidence_reconciliation_head_v3: { latest: true,
      batch: { ...batchMaterial, batch_digest: digest(batchMaterial) },
      native_plan: plan, closure_evaluation: evaluation, release_join: release,
      terminal_receipt: terminalReceipt, mappings } };
}

function withSecondTerminalBatch(state) {
  const next = structuredClone(state);
  const current = next.generic_evidence_reconciliation_head_v3.batch;
  const { batch_digest: _currentDigest, ...previousSeed } = current;
  const previousMaterial = { ...previousSeed,
    batch_id: "81000000-0000-4000-8000-000000000001",
    batch_version: 1, previous_batch_digest: null };
  const previous = { ...previousMaterial, batch_digest: digest(previousMaterial) };
  const { batch_digest: _discard, ...currentMaterial } = current;
  Object.assign(currentMaterial, { batch_version: 2,
    previous_batch_digest: previous.batch_digest });
  next.generic_evidence_reconciliation_head_v3.batch = {
    ...currentMaterial, batch_digest: digest(currentMaterial),
  };
  next.generic_evidence_reconciliation_head_v3.previous_batch = previous;
  return next;
}

test("terminal v3 replaces many legacy evidence rows only after native live finalization", () => {
  const state = terminalV3Fixture();
  const effective = deriveEffectiveGenericClosureEvidence(state);
  assert.equal(effective.reconciliation_count, 2);
  assert.equal(effective.invalid_reconciliation_count, 0);
  assert.deepEqual(effective.evidence.map((item) => item.kind),
    ["native_verifier_terminal_report"]);
  assert.equal(deriveGenericClosureReadiness(state).ready, true);
});

test("terminal v3 fails closed on stale snapshot, live receipt, or append-only head drift", () => {
  for (const mutate of [
    (head) => { head.closure_evaluation.evaluation.native_v2_work_snapshot_digest =
      "0".repeat(64); },
    (head) => { head.terminal_receipt.payload.external_readback_digest = "0".repeat(64); },
    (head) => { head.batch.previous_batch_digest = "0".repeat(64); },
  ]) {
    const state = structuredClone(terminalV3Fixture());
    mutate(state.generic_evidence_reconciliation_head_v3);
    const effective = deriveEffectiveGenericClosureEvidence(state);
    assert.equal(effective.reconciliation_count, 0);
    assert.equal(effective.invalid_reconciliation_count, 1);
    assert.equal(deriveGenericClosureReadiness(state).ready, false);
  }
});

test("terminal v3 schema is append-only and binds the immutable live receipt", () => {
  assert.match(ADDITIVE_SCHEMA_SQL,
    /tenant_work_generic_evidence_reconciliation_batch_v3_no_mutation/);
  assert.match(ADDITIVE_SCHEMA_SQL,
    /tenant_work_generic_evidence_reconciliation_mapping_v3_no_mutation/);
  assert.match(ADDITIVE_SCHEMA_SQL, /terminal_receipt_id uuid NOT NULL/);
  assert.match(ADDITIVE_SCHEMA_SQL, /live_readback_digest char\(64\) NOT NULL/);
});

test("private terminal writer derives the full v3 batch from persisted DB state", async () => {
  const state = terminalV3Fixture();
  const head = state.generic_evidence_reconciliation_head_v3;
  const inserted = [];
  const client = { async query(sql) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM tenant_work WHERE")) return { rows: [state.work] };
    if (q.startsWith("SELECT * FROM tenant_work_evidence")) return { rows: state.evidence };
    if (q.startsWith("SELECT plan_id,plan,plan_digest,status,plan_version")) {
      return { rows: [{ ...head.native_plan, status: "verified", plan_version: 2 }] };
    }
    if (q.startsWith("SELECT evaluation_id,evaluation,evaluation_digest")) {
      return { rows: [head.closure_evaluation] };
    }
    if (q.startsWith("SELECT evaluation_id,verdict_id,release_intent,")) {
      return { rows: [head.release_join] };
    }
    if (q.startsWith("SELECT receipt_id,receipt_type,payload,payload_digest")) {
      return { rows: [head.terminal_receipt] };
    }
    if (q.startsWith("SELECT n.*,a.report AS verifier_report")) {
      const mapping = head.mappings[0];
      return { rows: [{ ...mapping.native_evidence,
        verifier_report: mapping.verifier_report,
        receipt_type: mapping.native_receipt.receipt_type,
        receipt_payload: mapping.native_receipt.payload,
        payload_digest: mapping.native_receipt.payload_digest }] };
    }
    if (q.startsWith("SELECT * FROM tenant_work_generic_evidence_reconciliation_batch_v3")) {
      return { rows: [] };
    }
    if (q.startsWith("INSERT INTO tenant_work_generic_evidence_reconciliation_")) {
      inserted.push(q); return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected_query:${q}`);
  } };
  const store = createWorkContinuityV2Store({ pool: { query: async () => ({ rows: [] }) } });
  await assert.rejects(
    store.materializeGenericTerminalReconciliationV3WithClient(client, {
      tenant_id: state.work.tenant_id, work_id: state.work.work_id,
      plan_id: head.native_plan.plan_id, server_owned: false,
    }), /generic_terminal_reconciliation_server_owned_required/);
  const result = await store.materializeGenericTerminalReconciliationV3WithClient(client, {
    tenant_id: state.work.tenant_id,
    work_id: state.work.work_id,
    plan_id: head.native_plan.plan_id,
    server_owned: true,
    mappings: [{ legacy_evidence_id: crypto.randomUUID(),
      replacement_evidence_id: crypto.randomUUID() }],
  });
  assert.equal(result.materialized, true);
  assert.equal(result.mapping_count, 2);
  assert.equal(result.target_commit, head.batch.target_commit);
  assert.equal(inserted.length, 3);
});

test("private terminal writer appends v2 only over the exact verified predecessor", async () => {
  const state = terminalV3Fixture();
  const head = state.generic_evidence_reconciliation_head_v3;
  const inserted = [];
  let predecessor = head.batch;
  const client = { async query(sql, parameters = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT * FROM tenant_work WHERE")) return { rows: [state.work] };
    if (q.startsWith("SELECT * FROM tenant_work_evidence")) return { rows: state.evidence };
    if (q.startsWith("SELECT plan_id,plan,plan_digest,status,plan_version")) {
      return { rows: [{ ...head.native_plan, status: "verified", plan_version: 2 }] };
    }
    if (q.startsWith("SELECT evaluation_id,evaluation,evaluation_digest")) {
      return { rows: [head.closure_evaluation] };
    }
    if (q.startsWith("SELECT evaluation_id,verdict_id,release_intent,")) {
      return { rows: [head.release_join] };
    }
    if (q.startsWith("SELECT receipt_id,receipt_type,payload,payload_digest")) {
      return { rows: [head.terminal_receipt] };
    }
    if (q.startsWith("SELECT n.*,a.report AS verifier_report")) {
      const mapping = head.mappings[0];
      return { rows: [{ ...mapping.native_evidence,
        verifier_report: mapping.verifier_report,
        receipt_type: mapping.native_receipt.receipt_type,
        receipt_payload: mapping.native_receipt.payload,
        payload_digest: mapping.native_receipt.payload_digest }] };
    }
    if (q.startsWith("SELECT * FROM tenant_work_generic_evidence_reconciliation_batch_v3")) {
      return { rows: [predecessor] };
    }
    if (q.startsWith("INSERT INTO tenant_work_generic_evidence_reconciliation_")) {
      inserted.push({ q, parameters });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected_query:${q}`);
  } };
  const store = createWorkContinuityV2Store({ pool: { query: async () => ({ rows: [] }) } });
  const source = { server_owned: true, tenant_id: state.work.tenant_id,
    work_id: state.work.work_id, plan_id: head.native_plan.plan_id };
  const result = await store.materializeGenericTerminalReconciliationV3WithClient(client, source);
  assert.equal(result.materialized, true);
  assert.equal(result.batch_version, 2);
  assert.equal(inserted[0].parameters[3], 2);
  assert.equal(inserted[0].parameters[4], predecessor.batch_digest);

  inserted.length = 0;
  predecessor = { ...predecessor, target_commit: "0".repeat(40) };
  await assert.rejects(
    store.materializeGenericTerminalReconciliationV3WithClient(client, source),
    /generic_terminal_reconciliation_readback_invalid/,
  );
  assert.equal(inserted.length, 0);
});

test("private terminal writer rejects unbridged and cross-bound V2 Works", async () => {
  const state = terminalV3Fixture();
  const store = createWorkContinuityV2Store({ pool: { query: async () => ({ rows: [] }) } });
  for (const legacyWorkId of [null, "90000000-0000-4000-8000-000000000001"]) {
    const client = { query: async (sql) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.startsWith("SELECT * FROM tenant_work WHERE")) {
        return { rows: [{ ...state.work, legacy_work_id: legacyWorkId }] };
      }
      throw new Error(`unexpected_query:${q}`);
    } };
    await assert.rejects(store.materializeGenericTerminalReconciliationV3WithClient(client, {
      server_owned: true, tenant_id: state.work.tenant_id, work_id: state.work.work_id,
      plan_id: state.generic_evidence_reconciliation_head_v3.native_plan.plan_id,
    }), /generic_terminal_reconciliation_native_work_binding_invalid/);
  }
});

test("terminal V3 head verifies the exact append-only predecessor and rejects a missing chain", () => {
  const valid = withSecondTerminalBatch(terminalV3Fixture());
  assert.equal(deriveEffectiveGenericClosureEvidence(valid).reconciliation_count, 2);
  const missing = structuredClone(valid);
  missing.generic_evidence_reconciliation_head_v3.previous_batch = null;
  assert.equal(deriveEffectiveGenericClosureEvidence(missing).reconciliation_count, 0);
  const drifted = structuredClone(valid);
  drifted.generic_evidence_reconciliation_head_v3.previous_batch.target_commit = "0".repeat(40);
  assert.equal(deriveEffectiveGenericClosureEvidence(drifted).reconciliation_count, 0);
});

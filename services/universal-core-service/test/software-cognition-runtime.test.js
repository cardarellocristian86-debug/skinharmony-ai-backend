import assert from "node:assert/strict";
import test from "node:test";

import { createSoftwareCognitionRuntime, normalizeSoftwareCognitionMode, requireCurrentSoftwareClosure } from "../src/softwareCognitionRuntime.js";
import { softwareAuthoritySnapshotDigest } from "../src/softwareCognition.js";

const identity = Object.freeze({ tenant_id: "tenant-a", actor_id: "builder-a", provenance: { session_fingerprint: "session-a" } });

test("rollout mode is strict and typos fail closed", () => {
  assert.equal(normalizeSoftwareCognitionMode(undefined), "OFF");
  assert.equal(normalizeSoftwareCognitionMode(" advisory "), "ADVISORY");
  assert.equal(normalizeSoftwareCognitionMode("ENFORCED"), "ENFORCED");
  assert.throws(() => normalizeSoftwareCognitionMode("enforce"), /software_cognition_mode_invalid/);
});

function memoryStore() {
  const graph = { revision: 1, source_digest: "a".repeat(64), nodes: [], edges: [] };
  const artifacts = [];
  return {
    initialize: async () => ({ ready: true }),
    readGraph: async () => graph,
    writeGraph: async () => { throw new Error("software_atlas_single_writer_required"); },
    verifyCausalBinding: async ({ work_id }) => { if (work_id !== "work-a") throw new Error("software_causal_binding_not_found"); return { work_id }; },
    readCausalObligations: async () => [{ obligation_id: "critical-a", claim: "security verification", assurance_level: "CAL-4", state: "UNKNOWN", rollback_plan: {} }],
    writeArtifact: async (value) => { artifacts.push({ ...value, payload: structuredClone(value.payload) }); return value.payload; },
    readArtifacts: async ({ work_id, kind }) => artifacts.filter((item) => item.work_id === work_id && item.kind === kind).map((item) => structuredClone(item.payload)),
    readVerifiedLearningEvidence: async () => null,
    readNativePlan: async () => ({ plan_id: "plan-a", plan_digest: "b".repeat(64), status: "planned", plan: { software_contract: {
      schema_version: "worker_plan_contract_v1", change_id: "change-a", base_state_digest: "a".repeat(64), goal: "Implement the bounded change",
      hypotheses: [], assumptions: [], affected_components: [], planned_changes: [], expected_effects: [], expected_non_effects: [], risks: [], tests: [], rollback: [], unknowns: [],
    } } }),
  };
}

test("runtime preserves graph source digest for a valid pre-execution plan", async () => {
  const runtime = createSoftwareCognitionRuntime({ store: memoryStore() });
  const plan = await runtime.invoke("software_cognition_plan_record", identity, {
    project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a",
    base_state_digest: "a".repeat(64), goal: "Implement the bounded change", hypotheses: [], assumptions: [],
    affected_components: [], planned_changes: [], expected_effects: [], expected_non_effects: [], risks: [], tests: [], rollback: [], unknowns: [],
  });
  assert.equal(plan.base_state_digest, "a".repeat(64));
});

test("coverage ignores caller claims and reads blocking Causal obligations", async () => {
  const runtime = createSoftwareCognitionRuntime({ store: memoryStore() });
  const coverage = await runtime.invoke("software_cognition_obligation_coverage", identity, {
    project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a",
    obligations: [{ obligation_id: "fake", status: "closed", coverage: true }], coverage: { closure_eligible: true },
  });
  assert.equal(coverage.closure_eligible, false);
  assert.equal(coverage.critical_missing, 1);
});

test("runtime rejects foreign Work before artifact persistence and caller-asserted learning", async () => {
  const runtime = createSoftwareCognitionRuntime({ store: memoryStore() });
  await assert.rejects(() => runtime.invoke("software_cognition_obligation_coverage", identity, {
    project_id: "project-a", work_id: "foreign-work", change_id: "change-a", plan_id: "plan-a", obligations: [],
  }), /software_causal_binding_not_found/);
  await assert.rejects(() => runtime.invoke("software_cognition_learning_promote", identity, {
    project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a", evidence_tenant_id: "tenant-a", outcome_state: "verified",
    independently_verified: true, evidence_digest: "a".repeat(64), source_work_id: "work-a", candidate: {},
  }), /unverified_learning_promotion/);
  await assert.rejects(() => runtime.invoke("software_cognition_runtime_observe", identity, {
    project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a", graph_digest: "a".repeat(64),
    observation: { service: "api", status: "healthy" }, verification: { evidence_digest: "b".repeat(64) },
  }), /runtime_observation_evidence_not_authorized/);
});

test("closure rejects a Native Plan bound to another Change or stale Atlas digest", async () => {
  const store = memoryStore();
  store.readClosureSnapshot = async () => ({
    graph: { revision: 1, source_digest: "a".repeat(64), nodes: [], edges: [] }, artifacts: {}, challenges: [],
    native_plan: { status: "planned", change_id: "change-b", base_state_digest: "b".repeat(64), agents: [],
      plan: { software_contract: { change_id: "change-b", base_state_digest: "b".repeat(64) } } },
    project: {}, work: {}, change: {}, evidence: [], obligations: [], db_now: "2026-08-15T12:00:00.000Z",
  });
  const runtime = createSoftwareCognitionRuntime({ store });
  await assert.rejects(() => runtime.invoke("software_cognition_closure_evaluate", identity, {
    project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a",
  }), /software_native_plan_binding_mismatch/);
});

test("learning evidence must bind the exact promoted candidate", async () => {
  const store = memoryStore();
  let requestedSubject;
  store.readVerifiedLearningEvidence = async ({ subject_digest }) => { requestedSubject = subject_digest; return null; };
  const runtime = createSoftwareCognitionRuntime({ store });
  await assert.rejects(() => runtime.invoke("software_cognition_learning_promote", identity, {
    project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a",
    evidence_digest: "a".repeat(64), candidate: { rule: "unrelated" },
  }), /unverified_learning_promotion/);
  assert.equal(typeof requestedSubject, "string");
  assert.equal(requestedSubject.length, 64);
});

test("runtime persists bounded traceability, architecture, event routing and verified-only calibration receipts", async () => {
  const runtime = createSoftwareCognitionRuntime({ store: memoryStore() });
  const base = { project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a" };
  const traceability = await runtime.invoke("software_cognition_traceability_build", identity, { ...base, links: [] });
  assert.equal(traceability.inferred_links_are_authoritative, false);
  const architecture = await runtime.invoke("software_cognition_architecture_recover", identity, { ...base, verification_evidence: [] });
  assert.equal(architecture.architecture_patterns_are_authoritative, false);
  const routed = await runtime.invoke("software_cognition_event_route", identity, { ...base, event: { type: "plan_created" }, max_nodes: 20, max_depth: 1 });
  assert.equal(routed.recommended_capability, "software_cognition_supervise");
  const calibration = await runtime.invoke("software_cognition_calibration_update", identity, { ...base, cases: [{ evidence_digest: "a".repeat(64), outcome_state: "verified" }] });
  assert.equal(calibration.metrics.sample_size, 0);
  assert.equal(calibration.excluded_unverified_cases, 1);
});

test("Core Join revalidates graph, authority roots and DB-time evidence freshness", async () => {
  const snapshot = { project: { digest: "project" }, work: { digest: "work" }, change: { digest: "change" }, obligations: [], evidence: [],
    icf: { digest: "icf" }, graph: { revision: 3, source_digest: "a".repeat(64) }, native_plan: { digest: "plan" }, native_closure: { digest: "native" },
    challenges: [], artifacts: {}, db_now: "2026-08-15T12:00:00.000Z" };
  const closure = { project_id: "project-a", payload: { verdict: "RELEASE_READY", authoritative_transition_performed: false,
    graph_revision: 3, graph_digest: "a".repeat(64), change_id: "change-a", plan_id: "plan-a",
    authority_snapshot_digest: softwareAuthoritySnapshotDigest(snapshot), evidence_fresh_until: "2026-08-15T12:01:00.000Z" } };
  const store = { readReleaseReadyClosure: async () => closure, readGraph: async () => snapshot.graph, readClosureSnapshot: async () => snapshot };
  assert.equal((await requireCurrentSoftwareClosure({ store, tenant_id: "tenant-a", work_id: "work-a" })).payload.verdict, "RELEASE_READY");
  const staleGraph = { ...store, readGraph: async () => ({ ...snapshot.graph, revision: 4 }) };
  await assert.rejects(() => requireCurrentSoftwareClosure({ store: staleGraph, tenant_id: "tenant-a", work_id: "work-a" }), /software_cognition_closure_stale/);
  const changedAuthority = { ...store, readClosureSnapshot: async () => ({ ...snapshot, obligations: [{ state: "reopened" }] }) };
  await assert.rejects(() => requireCurrentSoftwareClosure({ store: changedAuthority, tenant_id: "tenant-a", work_id: "work-a" }), /software_cognition_closure_authority_changed/);
  const expired = { ...store, readClosureSnapshot: async () => ({ ...snapshot, db_now: "2026-08-15T12:02:00.000Z" }) };
  await assert.rejects(() => requireCurrentSoftwareClosure({ store: expired, tenant_id: "tenant-a", work_id: "work-a" }), /software_cognition_closure_authority_changed/);
});

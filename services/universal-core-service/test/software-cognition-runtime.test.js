import assert from "node:assert/strict";
import test from "node:test";

import { alignNyraPrecoreWithCore, createSoftwareCognitionRuntime, normalizeSoftwareCognitionMode,
  requireCurrentSoftwareClosure } from "../src/softwareCognitionRuntime.js";
import { softwareAuthoritySnapshotDigest, softwareDigest } from "../src/softwareCognition.js";

const identity = Object.freeze({ tenant_id: "tenant-a", actor_id: "builder-a", provenance: { session_fingerprint: "session-a" } });

test("rollout mode is strict and typos fail closed", () => {
  assert.equal(normalizeSoftwareCognitionMode(undefined), "OFF");
  assert.equal(normalizeSoftwareCognitionMode(" advisory "), "ADVISORY");
  assert.equal(normalizeSoftwareCognitionMode("ENFORCED"), "ENFORCED");
  assert.throws(() => normalizeSoftwareCognitionMode("enforce"), /software_cognition_mode_invalid/);
});

test("Core independently reports pre-Core agreement, override and invalid advisory state", () => {
  const record = { decision_id: "decision-a", chain: { record_digest: "a".repeat(64) }, decision: { kind: "PROPOSE" } };
  assert.equal(alignNyraPrecoreWithCore({ verification: { valid: true, record }, core_allowed: true }).status, "AGREES");
  assert.equal(alignNyraPrecoreWithCore({ verification: { valid: true,
    record: { ...record, decision: { kind: "RECOMMEND_BLOCK" } } }, core_allowed: true }).status, "OVERRIDES");
  assert.equal(alignNyraPrecoreWithCore({ verification: { valid: false, record, reasons: ["EVIDENCE_EXPIRED"] },
    core_allowed: true }).status, "INVALID");
  assert.equal(alignNyraPrecoreWithCore({ verification: null, core_allowed: true }).status, "UNAVAILABLE");
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
  const researchRoute = await runtime.invoke("software_cognition_event_route", identity, { ...base, event: { type: "knowledge_gap" }, max_nodes: 20, max_depth: 1 });
  assert.equal(researchRoute.recommended_capability, "software_cognition_research_plan");
  const calibration = await runtime.invoke("software_cognition_calibration_update", identity, { ...base, cases: [{ evidence_digest: "a".repeat(64), outcome_state: "verified" }] });
  assert.equal(calibration.metrics.sample_size, 0);
  assert.equal(calibration.excluded_unverified_cases, 1);
});

test("NSCT V1.1 plans Airlock research, binds a signed capsule and issues only a provisional decision", async () => {
  const artifacts = [];
  const graph = { revision: 2, source_digest: "a".repeat(64), repository_id: "repo-a", base_revision: "1".repeat(40), candidate_revision: "2".repeat(40),
    nodes: [{ node_id: "ts-a", kind: "file", source_ref: "src/server.ts" }], edges: [] };
  let icfSealed = true;
  let repositoryId = "repo-a";
  let precoreAuthorityLockCalls = 0;
  const native = { plan_id: "plan-a", plan_digest: "b".repeat(64), status: "planned", change_id: "change-a", base_state_digest: graph.source_digest,
    agents: [], plan: { software_contract: { change_id: "change-a", base_state_digest: graph.source_digest } } };
  const snapshot = () => ({
    project: { active_intent_revision_id: "intent-a", intent_state: "APPROVED", intent_digest: "c".repeat(64), genesis_intent_id: "genesis-a", genesis_digest: "d".repeat(64) },
    repository: { resource_id: repositoryId, canonical_identifier: repositoryId === "repo-a" ? "owner/repo" : "owner/other", resource_digest: "8".repeat(64) },
    work: { intent_revision_id: "intent-a" }, change: { intent_revision_id: "intent-a", request_digest: "9".repeat(64) }, graph, native_plan: native, latest_native_plan_id: "plan-a",
    native_closure: null, obligations: [], evidence: [{ observation_id: "security-a", obligation_id: "security-obligation", independence: "INDEPENDENT",
      contradiction_status: "NONE", observed_at: "2026-08-17T11:59:00.000Z", freshness_seconds: 3600, evidence_digest: "8".repeat(64),
      baseline: { schema_version: "software_security_assessment_v1", graph_digest: graph.source_digest, change_id: "change-a", critical: false } }],
    challenges: [], db_now: "2026-08-17T12:00:00.000Z",
    icf: { version: 3, ledger_head_digest: "e".repeat(64), state: icfSealed
      ? { closure: "SEALED", core_seal: { seal_id: "seal-a", digest: "f".repeat(64), decision: "ALLOW_CLOSE", signature: "signed", signature_key_id: "production-key" } }
      : { closure: "OPEN" } },
    artifacts: Object.fromEntries(["impact", "coverage", "reconciliation", "runtime_observation", "learning", "closure", "traceability", "architecture", "calibration", "supervision", "research_plan", "research_evidence", "technical_evidence", "precore_decision"]
      .map((kind) => [kind, artifacts.filter((item) => item.kind === kind).map((item) => structuredClone(item.payload))])),
  });
  const store = {
    initialize: async () => ({ ready: true }), readGraph: async () => graph,
    verifyCausalBinding: async () => ({ work_id: "work-a", change_id: "change-a" }),
    readNativePlan: async () => native, readClosureSnapshot: async () => snapshot(),
    withPrecoreAuthorityLock: async (_scope, operation) => { precoreAuthorityLockCalls += 1; return operation({
      readClosureSnapshot: async () => snapshot(), transaction: { query: async () => ({ rows: [] }) },
    }); },
    writeArtifact: async (item) => { artifacts.push(structuredClone(item)); return item.payload; },
    readArtifacts: async ({ kind }) => artifacts.filter((item) => item.kind === kind).map((item) => structuredClone(item.payload)),
    readVerifiedLearningEvidence: async () => ({ fresh_until: "2026-08-17T12:30:00.000Z" }),
  };
  let airlockUrls = [];
  const airlock = { ready: true,
    createPlan: async (input) => { airlockUrls = input.source_urls; assert.match(input.research_cortex_plan_digest, /^[a-f0-9]{64}$/); return { verdict: "ALLOW", plan: { plan_digest: "1".repeat(64), expires_at: "2026-08-17T12:02:00.000Z" }, plan_capability: `rap_${"0".repeat(8)}-${"0".repeat(4)}-${"0".repeat(4)}-${"0".repeat(4)}-${"0".repeat(12)}.${"2".repeat(64)}` }; },
    verifyEvidenceCapsule: () => true,
    readSealedEvidence: async (capsule) => ({ capsule_id: capsule.capsule_id, evidence_digest: capsule.evidence_digest,
      trust_label: "public_untrusted_sanitized_non_executable", execution_authorized: false,
      evidence: airlockUrls.map((url, index) => ({ source: { canonical_url: url, fetched_at: "2026-08-17T12:00:00.000Z" },
        spans: [{ span_id: `span-${index}`, text: `Documented TypeScript behavior ${index}.`, executable: false }] })) }) };
  const precoreRecords = [];
  const precoreStore = { generate: async (input, options) => { assert.equal(typeof options?.transaction?.query, "function"); const record = { schema_version: "nyra_precore_decision_v1", decision_id: `decision-${precoreRecords.length + 1}`,
    scope: input.scope, subject: input.subject, authority_refs: input.authority_refs, decision: input.decision, evidence: input.evidence,
    chain: { sequence: precoreRecords.length + 1, record_digest: softwareDigest(input) }, provenance: { signer_key_id: "nyra-key", signature: "signed" },
    execution_authorized: false, authority_scope: "ADVISORY_NON_EXECUTABLE" }; precoreRecords.push(record); return record; },
    list: async () => precoreRecords, read: async (_scope, id) => precoreRecords.find((item) => item.decision_id === id), verify: async () => ({ valid: true }) };
  const runtime = createSoftwareCognitionRuntime({ store, researchAirlock: airlock, precoreStore, precoreMode: "ADVISORY",
    now: () => Date.parse("2026-08-17T12:00:00.000Z") });
  const base = { project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a" };
  const plan = await runtime.invoke("software_cognition_research_plan", identity, { ...base, question: "Verify the TypeScript runtime behavior",
    version_context: { typescript: "6.0.3" }, expected_revision: 2 });
  assert.equal(plan.airlock_policy_enforced, true);
  assert.equal(plan.execution_authorized, false);
  const profiles = await runtime.invoke("software_cognition_technology_profile", identity, { project_id: "project-a", work_id: "work-a" });
  assert.equal(profiles.profiles[0].schema_version, "technology_profile_v1");
  assert.equal(profiles.execution_authorized, false);
  const evidence = await runtime.invoke("software_cognition_research_bind", identity, { ...base, research_plan_digest: plan.research_plan_digest,
    capsule: { schema_version: "research_airlock_evidence_capsule_v1", capsule_id: "capsule-a",
      work_binding: { tenant_id: "tenant-a", project_id: "project-a", work_id: "work-a", session_id: "session-a" },
      plan_digest: plan.airlock_plan_digest, evidence_digest: "3".repeat(64), evidence_count: plan.sources.length, independent_source_count: plan.sources.length,
      independent_domain_count: new Set(plan.sources.map((item) => new URL(item.url).hostname)).size,
      source_url_digests: plan.sources.map((item) => softwareDigest(item.url)),
      source_domain_digests: [...new Set(plan.sources.map((item) => new URL(item.url).hostname))].map((item) => softwareDigest(item)), expires_at: "2026-08-17T12:30:00.000Z" } });
  assert.equal(evidence.verified, true);
  const adapterReceipt = "4".repeat(64);
  const technologyEvidence = await runtime.invoke("software_cognition_technology_verify", identity, { ...base,
    research_plan_digest: plan.research_plan_digest, evidence_digest: "5".repeat(64), profile_results: plan.technology_profiles.map((profile) => ({
      technology: profile.technology, profile_digest: profile.profile_digest, detected_version: "6.0.3", passed: true,
      manifest_digests: ["6".repeat(64)], lockfile_digests: ["7".repeat(64)], frameworks: ["verified-framework"],
      adapter_receipts: { compiler_type_checker: [adapterReceipt], tests: [adapterReceipt], lint_static_analysis: [adapterReceipt], dependency_inventory: [adapterReceipt] },
    })) });
  assert.equal(technologyEvidence.verified, true);
  const decision = await runtime.invoke("software_cognition_precore_decide", identity, { ...base, disposition: "PROPOSE",
    recommendation: "Apply the bounded implementation", rationale: ["The sealed sources agree"] });
  assert.equal(decision.schema_version, "nyra_precore_decision_v1");
  assert.equal(decision.decision.kind, "PROPOSE");
  assert.equal(decision.execution_authorized, false);
  assert.equal(decision.authority_scope, "ADVISORY_NON_EXECUTABLE");
  assert.equal(decision.authority_refs.icf.digest, "f".repeat(64));
  icfSealed = false;
  const challenged = await runtime.invoke("nyra_precore_decision_generate", identity, { ...base, disposition: "PROPOSE", expected_sequence: 1,
    expected_parent_digest: decision.chain.record_digest, supersedes_decision_id: decision.decision_id, idempotency_key: "precore-second",
    recommendation: "Apply the bounded implementation", rationale: ["The sealed sources agree"] });
  assert.equal(challenged.decision.kind, "CHALLENGE");
  assert.equal(challenged.execution_authorized, false);
  assert.equal(precoreAuthorityLockCalls, 2);
  assert.equal((await runtime.invoke("nyra_precore_decision_list", identity, base)).length, 2);
  repositoryId = "repo-b";
  await assert.rejects(() => runtime.invoke("nyra_precore_decision_generate", identity, { ...base, disposition: "PROPOSE",
    expected_sequence: 2, expected_parent_digest: challenged.chain.record_digest, supersedes_decision_id: challenged.decision_id,
    idempotency_key: "precore-wrong-repository", recommendation: "Do not cross repository boundaries" }),
  /nyra_precore_repository_graph_binding_mismatch/);
  repositoryId = "repo-a";
  icfSealed = true;
  artifacts.splice(artifacts.findIndex((item) => item.kind === "technical_evidence"), 1);
  const closure = await runtime.invoke("software_cognition_closure_evaluate", identity, base);
  assert.equal(closure.verdict, "CLOSURE_DENIED");
  assert.equal(closure.reasons.includes("technology_adapter_evidence_missing"), true);
});

test("NSCT V1.1 fails closed when Research Airlock is unavailable", async () => {
  const store = memoryStore();
  store.readGraph = async () => ({ revision: 1, source_digest: "a".repeat(64), nodes: [{ kind: "file", source_ref: "src/a.ts" }], edges: [] });
  const base = { project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a" };
  await assert.rejects(() => createSoftwareCognitionRuntime({ store }).invoke("software_cognition_research_plan", identity,
    { ...base, question: "Check TypeScript" }), /software_research_airlock_not_ready/);
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

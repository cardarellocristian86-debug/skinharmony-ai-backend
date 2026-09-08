import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBoundedContext,
  buildCommittedTaskState,
  buildExecutionConstraintsProjection,
  buildTaskStateContract,
  deriveContextProvenance,
  evaluateGovernedContinuityRollout,
  evaluateTrajectory,
  foldWorkProjection,
  governedDigest,
  projectWorkStateForView,
  validateContextProvenance,
  validateDependencyManifest,
} from "../src/governed-continuity-context.js";

const WORK_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const TENANT = "tenant-a";
const HASH = "a".repeat(64);
const POLICY = "b".repeat(64);
const REVOCATION = "c".repeat(64);
const NOW = "2026-09-08T12:00:00.000Z";

function provenance(overrides = {}) {
  return {
    schema_version: "context_provenance_envelope_v1",
    origin_ref: "ledger:event:1",
    source_class: "ledger",
    tenant_scope: TENANT,
    work_scope: WORK_ID,
    classification: "CONFIDENTIAL",
    derived_from: [],
    transformation_refs: [],
    valid_time: { from: "2026-09-01T00:00:00.000Z", to: null },
    knowledge_time: { from: "2026-09-02T00:00:00.000Z", to: null },
    content_digest: HASH,
    ...overrides,
  };
}

function authorization(sourceId, overrides = {}) {
  return {
    schema_version: "source_authorization_v1",
    principal_id: "principal-a",
    tenant_id: TENANT,
    work_id: WORK_ID,
    source_id: sourceId,
    namespace: "work.context",
    query_digest: HASH,
    policy_revision: POLICY,
    revocation_revision: REVOCATION,
    issued_at: "2026-09-08T11:59:00.000Z",
    expires_at: "2026-09-08T12:01:00.000Z",
    ...overrides,
  };
}

test("context provenance is bitemporal and rejects future or cross-tenant replay", () => {
  assert.equal(validateContextProvenance(provenance(), {
    tenant_scope: TENANT, work_scope: WORK_ID, as_of: NOW,
  }).content_digest, HASH);
  assert.throws(() => validateContextProvenance(provenance({ tenant_scope: "tenant-b" }), {
    tenant_scope: TENANT,
  }), /context_cross_tenant_denied/);
  assert.throws(() => validateContextProvenance(provenance({
    knowledge_time: { from: "2026-09-09T00:00:00.000Z", to: null },
  }), { as_of: NOW }), /context_future_knowledge_denied/);
});

test("context transformations cannot amplify tenant, Work or classification", () => {
  const transformation = {
    origin_ref: "summary:1", source_class: "summary", transformation_refs: ["compactor:v1"],
    valid_time: { from: "2026-09-01T00:00:00.000Z", to: null },
    knowledge_time: { from: "2026-09-08T00:00:00.000Z", to: null },
    content_digest: "d".repeat(64),
  };
  const derived = deriveContextProvenance([provenance()], transformation);
  assert.equal(derived.tenant_scope, TENANT);
  assert.equal(derived.work_scope, WORK_ID);
  assert.equal(derived.classification, "CONFIDENTIAL");
  assert.deepEqual(derived.derived_from, [HASH]);
  assert.throws(() => deriveContextProvenance([provenance()], {
    ...transformation, tenant_scope: "tenant-b",
  }), /context_scope_amplification_denied/);
  assert.throws(() => deriveContextProvenance([provenance()], {
    ...transformation, classification: "PUBLIC",
  }), /context_classification_downgrade_denied/);
});

test("bounded context authorizes before admission, preserves mandatory sources and deduplicates copies", () => {
  const source = (sourceId, overrides = {}) => ({
    source_id: sourceId, mandatory: false, utility: 0.8,
    cost: { token_budget: 50, latency_budget_ms: 10, candidate_budget: 1 },
    provenance: provenance(), authorization: authorization(sourceId), content_ref: `ref:${sourceId}`,
    ...overrides,
  });
  const context = buildBoundedContext({
    sources: [
      source("ledger"),
      source("ledger-copy", { utility: 0.9, authorization: authorization("ledger-copy"), content_ref: "ref:copy" }),
      source("optional", { provenance: provenance({ content_digest: "e".repeat(64), origin_ref: "atlas:1" }), authorization: authorization("optional") }),
    ],
    required_source_ids: ["ledger"],
    budgets: { max_sources: 2, max_tokens: 100, max_latency_ms: 20, max_candidates: 2 },
    expected_scope: { tenant_scope: TENANT, work_scope: WORK_ID, principal_id: "principal-a", namespace: "work.context", query_digest: HASH, policy_revision: POLICY, revocation_revision: REVOCATION },
    now: NOW,
  });
  assert.deepEqual(context.selected_sources.map((item) => item.source_id), ["ledger", "optional"]);
  assert.equal(context.authority_granted, false);
  assert.throws(() => buildBoundedContext({
    sources: [], required_source_ids: ["ledger"],
    budgets: { max_sources: 1, max_tokens: 1, max_latency_ms: 1, max_candidates: 1 },
    expected_scope: { tenant_scope: TENANT, work_scope: WORK_ID }, now: NOW,
  }), /mandatory_context_source_missing/);
  assert.throws(() => buildBoundedContext({
    sources: [source("ledger", { authorization: authorization("ledger", { tenant_id: "tenant-b" }) })],
    required_source_ids: ["ledger"],
    budgets: { max_sources: 1, max_tokens: 100, max_latency_ms: 100, max_candidates: 2 },
    expected_scope: { tenant_scope: TENANT, work_scope: WORK_ID }, now: NOW,
  }), /source_authorization_tenant_id_mismatch/);
});

test("task contract and committed state are revision and evidence bound", () => {
  const contract = buildTaskStateContract({
    task_id: TASK_ID, work_id: WORK_ID, contract_revision: 1, intent_digest: HASH,
    declared_inputs: { repository: "repo", head: "abc" }, dependency_refs: ["dependency:repo"],
    output_schema_ref: "schema:task-output-v1", required_claims: ["tests_pass"],
    allowed_effects: ["git.commit"], recovery_policy: { ambiguous_effect: "reconcile" },
    budgets: { token_limit: 1000 },
  });
  assert.match(contract.contract_digest, /^[a-f0-9]{64}$/);
  const committed = buildCommittedTaskState({
    task_id: TASK_ID, work_id: WORK_ID, revision: 1, contract_revision: 1,
    input_digest: HASH, output_ref: "artifact:1", output_digest: POLICY,
    evidence_refs: ["evidence:1"], effect_lineage_refs: ["effect:1"],
    validation_ref: "verification:1", ledger_position: 2, committed_at: NOW,
  });
  assert.equal(committed.contract_revision, contract.contract_revision);
  assert.match(committed.commit_digest, /^[a-f0-9]{64}$/);
});

test("dependency manifest rejects omitted mandatory dependencies and material drift", () => {
  const material = {
    schema_version: "dependency_manifest_v1", plan_digest: HASH, task_revision: 2,
    intent_digest: POLICY, dependency_ids: ["repo:main"],
    source_versions: { "repo:main": "sha-1" }, relevant_predicates: { protected: true },
    required_evidence_refs: ["evidence:ci"], policy_revision: REVOCATION,
  };
  const manifest = { ...material, manifest_digest: governedDigest("dependency_manifest", material) };
  assert.equal(validateDependencyManifest(manifest, {
    task_revision: 2, mandatory_dependency_ids: ["repo:main"],
  }).manifest_digest, manifest.manifest_digest);
  assert.throws(() => validateDependencyManifest(manifest, {
    task_revision: 3,
  }), /dependency_task_revision_drift/);
  assert.throws(() => validateDependencyManifest(manifest, {
    mandatory_dependency_ids: ["repo:main", "policy:release"],
  }), /mandatory_dependency_missing/);
});

test("trajectory is cumulative across agents and detects forbidden composition", () => {
  const first = evaluateTrajectory({
    previous: null,
    proposal: { read_scopes: ["customer.read"], write_scopes: [], recipients: [], effect_count: 0, egress_count: 0 },
    policy: { max_read_scopes: 3, max_write_scopes: 2, max_recipients: 2, max_effects: 2, max_egress: 1, forbidden_scope_pairs: [["customer.read", "external.send"]] },
  });
  const second = evaluateTrajectory({
    previous: first,
    proposal: { read_scopes: [], write_scopes: ["external.send"], recipients: ["recipient:a"], effect_count: 1, egress_count: 1 },
    policy: { max_read_scopes: 3, max_write_scopes: 2, max_recipients: 2, max_effects: 2, max_egress: 1, forbidden_scope_pairs: [["customer.read", "external.send"]] },
  });
  assert.equal(second.disposition, "HOLD");
  assert(second.reason_codes.includes("trajectory_forbidden_scope_composition"));
  assert(first.read_scopes.every((scope) => second.read_scopes.includes(scope)));
});

test("incremental and full Ledger folds match, preserve ambiguity and reject gaps", () => {
  const events = [
    { event_id: "30000000-0000-4000-8000-000000000001", sequence_number: 1, event_type: "task_contract_recorded", payload: { task_id: TASK_ID } },
    { event_id: "30000000-0000-4000-8000-000000000002", sequence_number: 2, event_type: "effect_observed", payload: { effect_ref: "effect:1", state: "AMBIGUOUS", observed_at: NOW, provider_receipt_digest: null } },
    { event_id: "30000000-0000-4000-8000-000000000003", sequence_number: 3, event_type: "task_state_committed", payload: { task_id: TASK_ID, evidence_refs: ["evidence:1"] } },
    { event_id: "30000000-0000-4000-8000-000000000004", sequence_number: 4, event_type: "trajectory_evaluated", payload: { trajectory_digest: POLICY, disposition: "HOLD" } },
  ];
  const full = foldWorkProjection({ work_id: WORK_ID, intent_digest: HASH, events });
  const first = foldWorkProjection({ work_id: WORK_ID, intent_digest: HASH, events: events.slice(0, 2) });
  const incremental = foldWorkProjection({ work_id: WORK_ID, intent_digest: HASH, base: first, events: events.slice(2) });
  assert.equal(incremental.projection_digest, full.projection_digest);
  assert.deepEqual(full.completed_tasks, [TASK_ID]);
  assert.equal(full.unresolved_effects[0].state, "AMBIGUOUS");
  assert.deepEqual(full.blockers, [`trajectory:${POLICY}`]);
  assert.throws(() => foldWorkProjection({ work_id: WORK_ID, intent_digest: HASH, events: [events[1]] }), /projection_event_out_of_order/);
});

test("execution constraints label knowledge quality without inventing host facts", () => {
  const dimension = (state, value = null) => ({ state, value, evidence_refs: [] });
  const projection = buildExecutionConstraintsProjection({
    work_id: WORK_ID, task_id: TASK_ID,
    runtime: dimension("VERIFIED", { node: "24" }), tools: dimension("OBSERVED", ["git"]),
    network: dimension("UNKNOWN"), resources: dimension("UNKNOWN"),
    concurrency: dimension("DECLARED", { maximum: 2 }), budgets: dimension("VERIFIED", { tokens: 1000 }),
    policy: dimension("VERIFIED", { revision: POLICY }), effect_ceiling: dimension("VERIFIED", ["git.commit"]),
  });
  assert.equal(projection.network.state, "UNKNOWN");
  assert.equal(projection.read_only, true);
  assert.equal(projection.server_derived, true);
});

test("authorized projection views separate agent, verifier, Core and Owner concerns", () => {
  const projection = foldWorkProjection({
    work_id: WORK_ID,
    intent_digest: HASH,
    events: [
      { event_id: "30000000-0000-4000-8000-000000000011", sequence_number: 1,
        event_type: "task_state_committed", payload: { task_id: TASK_ID, evidence_refs: ["evidence:1"] } },
      { event_id: "30000000-0000-4000-8000-000000000012", sequence_number: 2,
        event_type: "next_actions_set", payload: { next_allowed_actions: ["task:next"] } },
    ],
  });
  const agent = projectWorkStateForView(projection, "agent");
  const verifier = projectWorkStateForView(projection, "verifier");
  const owner = projectWorkStateForView(projection, "owner");
  assert.equal(agent.authority_granted, false);
  assert.equal(Object.hasOwn(agent, "evidence_refs"), false);
  assert.deepEqual(agent.next_allowed_actions, ["task:next"]);
  assert.deepEqual(verifier.evidence_refs, ["evidence:1"]);
  assert.equal(Object.hasOwn(verifier, "next_allowed_actions"), false);
  assert.deepEqual(owner.evidence_refs, ["evidence:1"]);
  assert.deepEqual(owner.next_allowed_actions, ["task:next"]);
  assert.notEqual(agent.view_digest, verifier.view_digest);
});

test("OFF, SHADOW and ENFORCED rollout decisions preserve the governed commit boundary", () => {
  const off = evaluateGovernedContinuityRollout({ mode: "OFF", mutation: true });
  const shadow = evaluateGovernedContinuityRollout({ mode: "SHADOW", mutation: true });
  const enforcedLegacy = evaluateGovernedContinuityRollout({
    mode: "ENFORCED", mutation: true, legacy_completion: true,
  });
  const enforcedCommit = evaluateGovernedContinuityRollout({
    mode: "ENFORCED", mutation: true, legacy_completion: false,
  });
  assert.equal(off.reason, "governed_continuity_context_off");
  assert.equal(shadow.allowed, true);
  assert.equal(shadow.shadow_observation_only, true);
  assert.equal(enforcedLegacy.reason, "governed_task_commit_required");
  assert.equal(enforcedCommit.allowed, true);
  assert.equal(enforcedCommit.legacy_completion_requires_governed_commit, true);
  assert.throws(() => evaluateGovernedContinuityRollout({ mode: "ACTIVE" }),
    /governed_continuity_mode_invalid/);
});

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MAX_PARALLEL_BRANCHES, createNyraHorizontalRuntime, proposeBranches } = require("../lib/nyra-horizontal-runtime");

test("Nyra exposes an horizontal Core-governed neural branch contract", () => {
  const runtime = createNyraHorizontalRuntime({});
  const contract = runtime.contract();
  assert.equal(contract.service, "nyra-horizontal-runtime");
  assert.equal(contract.runtime_kind, "horizontal_neural_branch_runtime");
  assert.equal(contract.domain_pack_resolution, "universal_core_key_metadata_only");
  assert.equal(contract.vertical_pack_selection, "forbidden_in_horizontal_runtime");
  assert.equal(contract.neural_network.maximum_subbranches_per_branch, 20);
  assert.equal(contract.neural_network.maximum_parallel_branches, 6);
  assert.equal(contract.neural_network.join_authority, "universal_core");
  assert.equal(contract.governed_learning.memory_source, "tenant_memory_fabric");
  assert.equal(contract.governed_learning.policy_activation_requires_verify, true);
  assert.equal(contract.governed_learning.free_weight_training, false);
  assert.equal(contract.realtime_research.primary_provider, "host_chatgpt_or_codex_web");
  assert.equal(contract.realtime_research.mcp_entrypoint, "nyra_research_plan");
  assert.equal(contract.realtime_research.automatic_global_promotion, false);
  assert.equal(contract.authority.may_open_branches, false);
  assert.equal(contract.authority.may_begin_work_without_preflight, false);
  assert.equal(contract.authority.may_promote_unreviewed_research, false);
  assert.equal(contract.authority.core_is_final_router, true);
  assert.equal(contract.mandatory_preflight.connected_tool_first, true);
});

test("Nyra proposes relevant branches but never opens or executes them locally", () => {
  const runtime = createNyraHorizontalRuntime({});
  const result = runtime.prepareInterpretation({ message: "Valuta privacy e prepara un piano di deploy su Render" });
  assert.equal(result.ok, true);
  assert(result.core_request.nyra_branches.includes("risk_governance"));
  assert(result.core_request.nyra_branches.includes("execution_planning"));
  assert.equal(result.local_interpretation.branch_state, "proposed_waiting_for_core");
  assert.equal(result.local_interpretation.preflight_state, "mandatory_waiting_for_core");
  assert.equal(result.core_request.preflight_required, true);
  assert(result.local_interpretation.parallel_proposal.waves.every((wave) => wave.length <= MAX_PARALLEL_BRANCHES));
  assert.equal(result.local_interpretation.execution_allowed, false);
});

test("Nyra proposes work, parallel verification and learning branches as an agnostic graph", () => {
  const runtime = createNyraHorizontalRuntime({});
  const result = runtime.prepareInterpretation({
    message: "Ricerca fonti, pianifica priorita, coordina in parallelo, testa qualita e impara dal feedback",
  });
  for (const id of ["work_intake", "research_evidence", "planning_prioritization", "parallel_coordination", "quality_verification", "adaptive_learning"]) {
    assert(result.core_request.nyra_branches.includes(id), `missing proposed branch ${id}`);
  }
  assert(result.local_interpretation.parallel_proposal.waves.length >= 2);
  assert(result.local_interpretation.parallel_proposal.waves.every((wave) => wave.length <= 6));
  assert.equal(result.local_interpretation.governed_learning.state, "proposed_waiting_for_core_verify");
  assert.equal(result.local_interpretation.governed_learning.policy_activation_requires_verify, true);
  assert.equal(result.core_request.research_required, true);
  assert.equal(result.local_interpretation.realtime_research.state, "proposed_waiting_for_core_plan");
  assert.equal(result.local_interpretation.realtime_research.automatic_promotion, false);
  assert.equal(result.local_interpretation.execution_allowed, false);
});

test("Nyra validates input and cannot bind or select a product pack", () => {
  const runtime = createNyraHorizontalRuntime({ NYRA_DOMAIN_PACK_ID: "skinharmony" });
  assert.equal(runtime.expectedDomainPack, null);
  assert.equal(runtime.configuredDomainPackIgnored, "skinharmony");
  assert.equal(runtime.contract().legacy_domain_pack_env_ignored, true);
  assert.equal(runtime.prepareInterpretation({}).error, "message_required");
  assert.equal(runtime.prepareInterpretation({ message: "x".repeat(20_001) }).error, "message_too_long");
  assert.equal(runtime.prepareInterpretation({ message: "test", domain_pack: "generic" }).error, "domain_pack_selection_forbidden");
  assert.equal(runtime.prepareInterpretation({ message: "test", domain_pack_id: "analyzer" }).error, "domain_pack_selection_forbidden");
  const branded = runtime.prepareInterpretation({ message: "Valuta SkinHarmony, beauty, Suite e SmartDesk" });
  assert.equal(branded.ok, true);
  assert.equal("domain_pack" in branded.core_request, false);
  assert.deepEqual(branded.core_request.nyra_branches, ["context_intelligence", "work_intake", "risk_governance", "decision_reasoning"]);
  assert.deepEqual(proposeBranches("Spiega la strategia"), ["context_intelligence", "work_intake", "risk_governance", "decision_reasoning", "communication_explanation"]);
});

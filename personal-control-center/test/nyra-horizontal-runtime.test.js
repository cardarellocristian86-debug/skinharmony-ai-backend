"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createNyraHorizontalRuntime, proposeBranches } = require("../lib/nyra-horizontal-runtime");

test("Nyra exposes an horizontal Core-governed neural branch contract", () => {
  const runtime = createNyraHorizontalRuntime({});
  const contract = runtime.contract();
  assert.equal(contract.service, "nyra-horizontal-runtime");
  assert.equal(contract.runtime_kind, "horizontal_neural_branch_runtime");
  assert.equal(contract.neural_network.maximum_subbranches_per_branch, 20);
  assert.equal(contract.authority.may_open_branches, false);
  assert.equal(contract.authority.core_is_final_router, true);
});

test("Nyra proposes relevant branches but never opens or executes them locally", () => {
  const runtime = createNyraHorizontalRuntime({});
  const result = runtime.prepareInterpretation({ message: "Valuta privacy e prepara un piano di deploy su Render" });
  assert.equal(result.ok, true);
  assert(result.core_request.nyra_branches.includes("risk_governance"));
  assert(result.core_request.nyra_branches.includes("execution_planning"));
  assert.equal(result.local_interpretation.branch_state, "proposed_waiting_for_core");
  assert.equal(result.local_interpretation.execution_allowed, false);
});

test("Nyra validates input size and expected domain pack", () => {
  const runtime = createNyraHorizontalRuntime({ NYRA_DOMAIN_PACK_ID: "skinharmony" });
  assert.equal(runtime.prepareInterpretation({}).error, "message_required");
  assert.equal(runtime.prepareInterpretation({ message: "x".repeat(20_001) }).error, "message_too_long");
  assert.equal(runtime.prepareInterpretation({ message: "test", domain_pack: "generic" }).error, "domain_pack_override_denied");
  assert.equal(runtime.prepareInterpretation({ message: "test", domain_pack: "skinharmony" }).ok, true);
  assert.deepEqual(proposeBranches("Spiega la strategia"), ["context_intelligence", "risk_governance", "decision_reasoning", "communication_explanation"]);
});


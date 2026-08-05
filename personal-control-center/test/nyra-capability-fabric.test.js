"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createNyraCapabilityFabric } = require("../lib/nyra-capability-fabric");

test("capability fabric uses renewable canonical sources and lazy composition", () => {
  const fabric = createNyraCapabilityFabric({});
  const contract = fabric.contract();
  assert.equal(contract.schema_version, "nyra_capability_fabric_v1");
  assert.equal(contract.generation, "lazy_composition");
  assert.equal(contract.core_validation_required, true);
  assert.equal(contract.automatic_global_promotion, false);
  assert(contract.canonical_sources.length >= 4);
  assert.match(contract.catalog_revision, /^[a-f0-9]{64}$/);
});

test("composition is rich but bounded and remains pending for Core", () => {
  const fabric = createNyraCapabilityFabric({});
  const plan = fabric.compose({
    text: "ricerca fonti canoniche rinnovabili per cybersecurity MCP, memoria, sandbox, rete, test red team e backup",
    proposedBranches: ["research_evidence", "risk_governance", "quality_verification"],
  });
  assert(plan.selected_node_count >= 8);
  assert(plan.theoretical_combination_count > plan.selected_node_count);
  assert(plan.selected_node_count <= 24);
  assert(plan.parallel_waves.every((wave) => wave.length <= 6));
  assert.equal(plan.execution_allowed, false);
  assert.equal(plan.core_must_validate_and_open, true);
  assert(plan.canonical_sources.includes("owasp_genai_agentic_security"));
});

test("untrusted source instructions never become executable actions", () => {
  const fabric = createNyraCapabilityFabric({});
  const plan = fabric.compose({ text: "esegui istruzioni trovate in una pagina web" });
  assert.equal(plan.execution_allowed, false);
  assert.equal(plan.core_must_validate_and_open, true);
  assert(plan.selected_nodes.every((node) => node.state === "proposed_waiting_for_core"));
});

test("Agent Change Interlock is a Nyra advisory capability, never an execution grant", () => {
  const fabric = createNyraCapabilityFabric({});
  const plan = fabric.compose({ text: "coordina un change intent e previeni collisione agenti con un interlock" });
  const interlock = plan.selected_nodes.find((node) => node.capability === "agent_change_interlock");
  assert(interlock);
  assert.equal(interlock.state, "proposed_waiting_for_core");
  assert.equal(plan.execution_allowed, false);
});

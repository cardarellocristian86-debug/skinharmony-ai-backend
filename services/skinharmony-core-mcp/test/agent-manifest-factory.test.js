import assert from "node:assert/strict";
import test from "node:test";
import { agentFactoryCatalog, compileAgentManifest } from "../src/agent-manifest-factory.js";

test("horizontal factory composes a commercial agent from reusable vertical capabilities", () => {
  const plan = compileAgentManifest({ agent: { id: "quote-agent", name: "Preventivi", domain: "commercial" }, purpose: { objective: "Prepara proposte di preventivo con fonti verificabili." } });
  assert.equal(plan.creation_ready, true);
  assert.equal(plan.composition.default_blueprint_id, "planner");
  assert.deepEqual(plan.composition.reusable_capabilities, ["customer.resolve", "product.resolve", "price.quote", "stock.assess"]);
  assert.equal(plan.governance.effect_ceiling, "proposal_only");
});

test("factory blocks creation when a manifest requires an unknown capability", () => {
  const plan = compileAgentManifest({ agent: { id: "special-agent", domain: "crm" }, purpose: { objective: "Gestisce dati cliente con contratto delimitato." }, reuse: { required_capabilities: ["unknown.capability"] } });
  assert.equal(plan.creation_ready, false);
  assert.deepEqual(plan.composition.missing_capabilities, ["unknown.capability"]);
});

test("factory catalog exposes reusable business and operational domains", () => {
  assert.ok(agentFactoryCatalog().domains.some((domain) => domain.id === "inventory"));
  assert.throws(() => compileAgentManifest({ agent: { id: "bad", domain: "unknown" }, purpose: { objective: "too short" } }), /agent_manifest_contract_invalid/);
});

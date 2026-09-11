import assert from "node:assert/strict";
import test from "node:test";
import { agentFactoryCatalog, compileAgentManifest, parseAgentCapabilityRegistry } from "../src/agent-manifest-factory.js";

const COMMERCIAL_CAPABILITIES = ["customer.resolve", "product.resolve", "price.quote", "stock.assess"];

test("horizontal factory composes a commercial agent from reusable vertical capabilities", () => {
  const plan = compileAgentManifest({ agent: { id: "quote-agent", name: "Preventivi", domain: "commercial" }, purpose: { objective: "Prepara proposte di preventivo con fonti verificabili." } }, { capabilityRegistry: COMMERCIAL_CAPABILITIES });
  assert.equal(plan.creation_ready, true);
  assert.equal(plan.composition.default_blueprint_id, "planner");
  assert.deepEqual(plan.composition.reusable_capabilities, ["customer.resolve", "product.resolve", "price.quote", "stock.assess"]);
  assert.equal(plan.governance.effect_ceiling, "proposal_only");
});

test("factory blocks a domain until its vertical capabilities are registered", () => {
  const plan = compileAgentManifest({ agent: { id: "special-agent", domain: "crm" }, purpose: { objective: "Gestisce dati cliente con contratto delimitato." }, reuse: { required_capabilities: ["unknown.capability"] } });
  assert.equal(plan.creation_ready, false);
  assert.deepEqual(plan.composition.missing_capabilities, ["customer.resolve", "customer.history_read", "unknown.capability"]);
});

test("factory catalog exposes reusable business and operational domains", () => {
  const catalog = agentFactoryCatalog({ capabilityRegistry: COMMERCIAL_CAPABILITIES });
  assert.ok(catalog.domains.some((domain) => domain.id === "inventory"));
  assert.deepEqual(catalog.domains.find((domain) => domain.id === "commercial").registered_capabilities, COMMERCIAL_CAPABILITIES);
  assert.throws(() => compileAgentManifest({ agent: { id: "bad", domain: "unknown" }, purpose: { objective: "too short" } }), /agent_manifest_contract_invalid/);
});

test("factory rejects coercible manifest fields and malformed capability registry", () => {
  assert.throws(() => compileAgentManifest({ agent: { id: "mail-agent", domain: "inbox" }, purpose: { objective: { text: "not a string" } } }), /agent_objective_invalid/);
  assert.throws(() => parseAgentCapabilityRegistry('{"capabilities":["message.classify",3]}'), /agent_capability_registry_invalid/);
});

import { digest } from "./work-continuity-runtime.js";

// A domain describes what an agent needs. It is not proof that a vertical
// adapter implementing those capabilities is installed or live.
const DOMAINS = Object.freeze({
  inbox: ["message.classify", "request.extract", "thread.resolve"],
  crm: ["customer.resolve", "customer.history_read"],
  pricing: ["product.resolve", "price.quote"],
  inventory: ["stock.assess", "replenishment.propose"],
  commercial: ["customer.resolve", "product.resolve", "price.quote", "stock.assess"],
  service: ["case.classify", "evidence.collect", "response.prepare"],
  office: ["document.extract", "document.validate", "artifact.prepare"],
  research: ["source.collect", "source.cite", "evidence.assess"],
  software: ["repository.inspect", "change.prepare", "test.verify"],
  quality: ["evidence.verify", "regression.assess", "risk.flag"],
});
const BLUEPRINT_BY_DOMAIN = Object.freeze({ research: "researcher", quality: "independent_verifier", software: "executor_specialist", office: "executor_specialist", service: "executor_specialist", inbox: "executor_specialist", crm: "planner", pricing: "planner", inventory: "planner", commercial: "planner" });
const ID = /^[a-z][a-z0-9_-]{2,63}$/;
const CAPABILITY_ID = /^[a-z][a-z0-9_.-]{1,119}$/;

function requiredText(value, name, limit = 4_000) {
  if (typeof value !== "string") throw new Error(`${name}_invalid`);
  return value.trim().slice(0, limit);
}

function capabilityList(value, name) {
  if (!Array.isArray(value) || value.length > 80) throw new Error(`${name}_invalid`);
  const result = value.map((item) => requiredText(item, name, 120));
  if (result.some((item) => !CAPABILITY_ID.test(item)) || new Set(result).size !== result.length) {
    throw new Error(`${name}_invalid`);
  }
  return result;
}

// Server-owned configuration supplied only by installed vertical adapters.
// An empty registry is a valid, fail-closed default.
export function parseAgentCapabilityRegistry(value) {
  if (value === undefined || value === null || value === "") return Object.freeze([]);
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new Error("NYRA_AGENT_CAPABILITY_REGISTRY_JSON_invalid"); }
  }
  const capabilities = Array.isArray(parsed) ? parsed : parsed?.capabilities;
  return Object.freeze(capabilityList(capabilities, "agent_capability_registry"));
}

export function agentFactoryCatalog({ capabilityRegistry = [] } = {}) {
  const registered = new Set(parseAgentCapabilityRegistry(capabilityRegistry));
  return {
    schema_version: "nyra_agent_factory_catalog_v1",
    domains: Object.entries(DOMAINS).map(([id, requiredCapabilities]) => ({
      id,
      required_capabilities: requiredCapabilities,
      registered_capabilities: requiredCapabilities.filter((capability) => registered.has(capability)),
      default_blueprint_id: BLUEPRINT_BY_DOMAIN[id],
    })),
  };
}

export function compileAgentManifest(manifest = {}, { capabilityRegistry = [] } = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("agent_manifest_invalid");
  const agent = manifest.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) throw new Error("agent_manifest_contract_invalid");
  const purpose = manifest.purpose === undefined ? {} : manifest.purpose;
  const reuse = manifest.reuse === undefined ? {} : manifest.reuse;
  if (!purpose || typeof purpose !== "object" || Array.isArray(purpose) || !reuse || typeof reuse !== "object" || Array.isArray(reuse)) throw new Error("agent_manifest_contract_invalid");
  const id = requiredText(agent.id, "agent_id", 64);
  const domain = requiredText(agent.domain, "agent_domain", 64).toLowerCase();
  const objective = requiredText(purpose.objective ?? agent.objective, "agent_objective");
  if (!ID.test(id) || !Object.hasOwn(DOMAINS, domain) || objective.length < 8) throw new Error("agent_manifest_contract_invalid");
  const requested = reuse.required_capabilities === undefined ? [] : capabilityList(reuse.required_capabilities, "required_capabilities");
  const requiredCapabilities = [...new Set([...(DOMAINS[domain] || []), ...requested])];
  const registered = new Set(parseAgentCapabilityRegistry(capabilityRegistry));
  const reusable = requiredCapabilities.filter((capability) => registered.has(capability));
  const missing = requiredCapabilities.filter((capability) => !registered.has(capability));
  const name = agent.name === undefined ? id : requiredText(agent.name, "agent_name", 120);
  const role = agent.role === undefined ? `${domain}_specialist` : requiredText(agent.role, "agent_role", 120);
  if (name.length < 3 || role.length < 3) throw new Error("agent_manifest_contract_invalid");
  const result = {
    schema_version: "nyra_agent_factory_plan_v1", agent: { id, name, domain, role, objective },
    composition: { required_capabilities: requiredCapabilities, reusable_capabilities: reusable, missing_capabilities: missing, default_blueprint_id: BLUEPRINT_BY_DOMAIN[domain] },
    governance: { parent: "nyra", decision_authority: "universal_core", effect_ceiling: "proposal_only", independent_verifier_required: domain !== "quality", server_model_invocation: false, external_action_allowed: false },
    tests: ["manifest_contract", "tenant_isolation", "capability_reuse", "forbidden_action_blocked", "evidence_provenance", "independent_verifier"],
  };
  return Object.freeze({ ...result, plan_digest: digest(result), creation_ready: missing.length === 0 });
}

import { digest } from "./work-continuity-runtime.js";

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
const text = (v, n = 4_000) => String(v || "").trim().slice(0, n);

export function agentFactoryCatalog() {
  return { schema_version: "nyra_agent_factory_catalog_v1", domains: Object.entries(DOMAINS).map(([id, capabilities]) => ({ id, reusable_capabilities: capabilities, default_blueprint_id: BLUEPRINT_BY_DOMAIN[id] })) };
}

export function compileAgentManifest(manifest = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("agent_manifest_invalid");
  const agent = manifest.agent || {}; const id = text(agent.id, 64);
  const domain = text(agent.domain, 64).toLowerCase(); const objective = text(manifest.purpose?.objective || agent.objective);
  if (!ID.test(id) || !Object.hasOwn(DOMAINS, domain) || objective.length < 8) throw new Error("agent_manifest_contract_invalid");
  const requested = Array.isArray(manifest.reuse?.required_capabilities) ? manifest.reuse.required_capabilities.map((x) => text(x, 120)).filter(Boolean) : [];
  const reusable = [...new Set([...(DOMAINS[domain] || []), ...requested])];
  const known = new Set(Object.values(DOMAINS).flat());
  const missing = reusable.filter((capability) => !known.has(capability));
  const result = {
    schema_version: "nyra_agent_factory_plan_v1", agent: { id, name: text(agent.name || id, 120), domain, role: text(agent.role || `${domain}_specialist`, 120), objective },
    composition: { reusable_capabilities: reusable.filter((capability) => known.has(capability)), missing_capabilities: missing, default_blueprint_id: BLUEPRINT_BY_DOMAIN[domain] },
    governance: { parent: "nyra", decision_authority: "universal_core", effect_ceiling: "proposal_only", independent_verifier_required: domain !== "quality", server_model_invocation: false, external_action_allowed: false },
    tests: ["manifest_contract", "tenant_isolation", "capability_reuse", "forbidden_action_blocked", "evidence_provenance", "independent_verifier"],
  };
  return Object.freeze({ ...result, plan_digest: digest(result), creation_ready: missing.length === 0 });
}

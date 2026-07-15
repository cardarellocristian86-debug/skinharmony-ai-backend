import { routeNyraBranches } from "./nyraBranchNetwork.js";

export const MULTI_AGENT_ARCHITECTURE_VERSION = "universal_multi_agent_architecture_v1";

const MAX_SPECIALISTS = 3;
const MAX_PARALLEL_SPECIALISTS = 2;

const AGENT_REGISTRY = Object.freeze([
  {
    id: "core_intake_router",
    label: "Core Intake Router",
    lane: "deterministic",
    owner: "universal_core",
    purpose: "Classifica la richiesta, applica tenant scope e apre soltanto i rami Nyra necessari.",
    domain_packs: ["*"],
    model_required: false,
    side_effects: false,
  },
  {
    id: "work_coordinator",
    label: "Work Coordinator",
    lane: "standard_reasoning",
    owner: "universal_core",
    purpose: "Mantiene la risposta finale e usa specialisti come capacità bounded, non come esecutori autonomi.",
    domain_packs: ["*"],
    model_required: true,
    side_effects: false,
  },
  {
    id: "evidence_researcher",
    label: "Evidence Researcher",
    lane: "standard_reasoning",
    owner: "universal_core",
    purpose: "Raccoglie evidenze, separa fonti da ipotesi e restituisce card verificabili.",
    domain_packs: ["*"],
    model_required: true,
    side_effects: false,
  },
  {
    id: "marketing_linguist",
    label: "Marketing Linguist",
    lane: "standard_reasoning",
    owner: "domain_adapter",
    purpose: "Prepara copy, localizzazione e varianti linguistiche; non pubblica e non approva claim.",
    domain_packs: ["*"],
    model_required: true,
    side_effects: false,
  },
  {
    id: "software_engineer",
    label: "Software Engineer",
    lane: "code_reasoning",
    owner: "domain_adapter",
    purpose: "Propone modifiche, test e piani di rollback; Core mantiene autorizzazione e audit.",
    domain_packs: ["*"],
    model_required: true,
    side_effects: false,
  },
  {
    id: "vision_analyst",
    label: "Vision Analyst",
    lane: "vision_reasoning",
    owner: "domain_adapter",
    purpose: "Interpreta un input visivo autorizzato e restituisce osservazioni strutturate con incertezza.",
    domain_packs: ["analyzer", "suite", "smartdesk"],
    model_required: true,
    side_effects: false,
  },
  {
    id: "core_variant_designer",
    label: "Core Variant Designer",
    lane: "code_reasoning",
    owner: "universal_core",
    purpose: "Genera proposte di varianti Core riusabili da un contratto, test e impatto; non applica né pubblica.",
    domain_packs: ["*"],
    model_required: true,
    side_effects: false,
  },
  {
    id: "quality_evaluator",
    label: "Quality Evaluator",
    lane: "deterministic_then_standard",
    owner: "universal_core",
    purpose: "Verifica contratti, casi negativi, isolamento tenant ed evidenze prima di una promozione.",
    domain_packs: ["*"],
    model_required: false,
    side_effects: false,
  },
  {
    id: "beauty_protocol_advisor",
    label: "Beauty Protocol Advisor",
    lane: "standard_reasoning",
    owner: "domain_adapter",
    purpose: "Interpreta analisi e protocolli nel pack autorizzato; guida l'operatore senza claim medici o azioni cliente automatiche.",
    domain_packs: ["analyzer", "skinharmony"],
    model_required: true,
    side_effects: false,
  },
  {
    id: "smartdesk_operator_advisor",
    label: "SmartDesk Operator Advisor",
    lane: "standard_reasoning",
    owner: "domain_adapter",
    purpose: "Suggerisce priorità operative sul singolo tenant; scritture e contatti restano mediati dal Core.",
    domain_packs: ["smartdesk", "skinharmony"],
    model_required: true,
    side_effects: false,
  },
]);

function textOf(input = {}) {
  return String(input.text || input.request || input.task || input.message || "").toLowerCase();
}

function matches(text, expression) {
  return expression.test(text);
}

function isAvailable(agent, domainPackId) {
  return agent.domain_packs.includes("*") || agent.domain_packs.includes(domainPackId);
}

function makeSelection(agent, reason, required = false) {
  return {
    id: agent.id,
    label: agent.label,
    lane: agent.lane,
    reason,
    model_required: agent.model_required,
    side_effects: false,
    required,
  };
}

export function multiAgentRegistry({ domainPackId = "generic" } = {}) {
  return {
    schema_version: MULTI_AGENT_ARCHITECTURE_VERSION,
    execution_model: "core_decides_agents_advise_clients_execute_after_mediation",
    specialist_pattern: "manager_uses_specialists_as_bounded_tools",
    limits: { max_specialists: MAX_SPECIALISTS, max_parallel_specialists: MAX_PARALLEL_SPECIALISTS },
    agents: AGENT_REGISTRY.filter((agent) => isAvailable(agent, domainPackId)).map(({ domain_packs, ...agent }) => agent),
  };
}

export function planMultiAgentRun({ domainPackId = "generic", tenantId = "", input = {}, requestedAgents = [] } = {}) {
  const text = textOf(input);
  const selections = [];
  const add = (id, reason, required = false) => {
    const agent = AGENT_REGISTRY.find((candidate) => candidate.id === id && isAvailable(candidate, domainPackId));
    if (agent && !selections.some((item) => item.id === id) && selections.length < MAX_SPECIALISTS) {
      selections.push(makeSelection(agent, reason, required));
    }
  };

  add("core_intake_router", "tenant scope, authorization and deterministic Nyra routing", true);

  const hasImage = input.has_image === true || input.image_input === true || Array.isArray(input.images) && input.images.length > 0;
  const needsVariant = input.create_variant === true || matches(text, /\b(variante|varianti|template|estendi core|nuovo ramo|nuovi rami)\b/);
  const software = matches(text, /\b(codice|software|api|bug|test|repository|plugin|mcp|ghidra|frida)\b/);
  const research = matches(text, /\b(ricerca|fonti|evidenz|benchmark|paper|documentazione)\b/);
  const marketing = matches(text, /\b(marketing|copy|campagn|traduzion|localizzaz|lingua|cta|funnel)\b/);
  const needsQuality = input.require_evaluation === true || matches(text, /\b(valida|verifica|qa|qualita|regression|isolamento tenant|audit)\b/);

  if (needsVariant) add("core_variant_designer", "variant proposal requested; contract, impact and tests are required");
  else if (software) add("software_engineer", "software task requires a bounded code proposal and test plan");
  else if (marketing) add("marketing_linguist", "marketing or linguistic task requires content constrained by policy");
  else if (research) add("evidence_researcher", "request needs traceable external or internal evidence");
  else if (domainPackId === "analyzer") add("beauty_protocol_advisor", "authorized Analyzer pack needs operator-guided advice");
  else if (domainPackId === "smartdesk") add("smartdesk_operator_advisor", "authorized SmartDesk pack needs tenant-scoped operational advice");
  else if (domainPackId === "skinharmony") {
    if (matches(text, /\b(beauty|cosmet|protocollo|pelle|skin)\b/)) add("beauty_protocol_advisor", "SkinHarmony beauty request needs operator-guided advice");
    else if (matches(text, /\b(smart\s*desk|agenda|cassa|magazzino|operativ)\b/)) add("smartdesk_operator_advisor", "SkinHarmony Smart Desk request needs tenant-scoped operational advice");
  }

  if (hasImage && selections.length < MAX_SPECIALISTS) add("vision_analyst", "vision is invoked only because an image input is present");
  if (needsQuality && selections.length < MAX_SPECIALISTS) add("quality_evaluator", "explicit evaluation, regression or tenant-isolation verification requested");

  const deniedRequestedAgents = Array.isArray(requestedAgents)
    ? requestedAgents.filter((id) => !selections.some((item) => item.id === id))
    : [];
  const nyra = routeNyraBranches({ text, domainPackId });
  const modelSelections = selections.filter((item) => item.model_required);
  const sensitive = input.action_type === "publish" || input.action_type === "deploy" || input.action_type === "payment" || input.action_type === "update" || input.contains_sensitive_data === true;

  return {
    schema_version: MULTI_AGENT_ARCHITECTURE_VERSION,
    tenant_id: tenantId,
    domain_pack_id: domainPackId,
    mode: "advisory_plan_only",
    ownership: { final_answer: "work_coordinator", execution_authority: "universal_core", side_effect_executor: "authorized_client_after_mediation" },
    selection: selections,
    denied_requested_agents: deniedRequestedAgents,
    nyra_route: {
      opened_branches: nyra.opened_branches.map((branch) => branch.id),
      waves: nyra.parallel_analysis.waves,
      join_authority: nyra.parallel_analysis.join_authority,
    },
    credit_control: {
      deterministic_steps: selections.filter((item) => !item.model_required).map((item) => item.id),
      model_calls_budget: modelSelections.length,
      max_parallel_model_calls: Math.min(MAX_PARALLEL_SPECIALISTS, modelSelections.length),
      cache_scope: "tenant_and_request_fingerprint_only",
      escalation_rule: "use higher-capability reasoning only for unresolved conflict, high uncertainty, or a specialist-required modality",
      avoided: ["model_routing_when_rules_suffice", "unbounded_agent_fanout", "cross_tenant_memory_reuse", "vision_without_image", "agent_for_deterministic_policy"],
    },
    approval: {
      required_before_side_effects: sensitive,
      required_controls: sensitive ? ["core_verdict", "owner_confirmation", "rollback_or_sandbox", "tenant_scoped_audit"] : ["core_verdict_if_action_is_requested"],
    },
    tenant_isolation: {
      client_selected_tenant_allowed: false,
      memory_scope: "authenticated_tenant_only",
      raw_memory_to_specialists: "minimal_structured_context_only",
    },
    execution_authorized: false,
  };
}

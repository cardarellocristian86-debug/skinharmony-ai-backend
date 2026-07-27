import {
  orchestrationCapabilityIds,
  orchestrationCatalogDescriptor,
} from "./orchestration-capability-catalog.js";
import {
  AI_LEARNING_EXPOSURE,
  extensionFacetDescriptor,
} from "./ai-learning-factory-branch-contracts.js";

export const branchAgentOrchestration = {
  id: "agent_orchestration",
  file: "branch-agent-orchestration.js",
  tier: "internal",
  label: "Agent Orchestration",
  domain: "horizontal_work",
  production_status: "advisory",
  ...AI_LEARNING_EXPOSURE.horizontal,
  description: "Factory e orchestrazione governata di agenti specializzati attraverso capability atomiche, identita, deleghe, topologie, verifica e resilienza.",
  subbranches: orchestrationCapabilityIds("agent_orchestration"),
  capability_catalog: orchestrationCatalogDescriptor("agent_orchestration"),
  capability_facets: extensionFacetDescriptor("agent_orchestration"),
  rules: [
    "Core e l'unica autorita che seleziona, materializza, delega, avvia, ferma e verifica un agente.",
    "Nyra e gli altri agenti possono proporre ruoli, topologie e capability, ma non concedere privilegi o attivare esecuzioni.",
    "Le possibilita di composizione e profondita sono virtuali, ricorsive e lazy; un run materializza solo gli agenti necessari entro limiti espliciti.",
    "Ogni agente materializzato deve avere identita, tenant, parent, capability, strumenti, budget, profondita, deadline, lease, criteri di verifica e teardown.",
    "Ogni handoff deve essere tipizzato, minimo, tracciato e vincolato alla stessa catena di delega.",
    "Ogni topologia deve dichiarare terminazione, fan-out, turni, retry, costo e percorso di cancellazione.",
    "Memoria e apprendimento sono proposte evidence-backed; il commit resta soggetto a distillazione e verifica Core.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "agent_orchestration_advisory",
    catalog_expansion: "lazy_paged_only",
    runtime_requires_explicit_limits: true,
    blocked_actions: [
      "agent_self_authorization",
      "unbounded_agent_spawn",
      "recursive_spawn_without_depth_limit",
      "handoff_without_delegation_contract",
      "cross_tenant_context",
      "execution_without_lease",
      "workflow_without_termination",
      "memory_commit_without_verification",
    ],
  },
};

import {
  AI_LEARNING_EXPOSURE,
  learningFactoryBranch,
} from "./ai-learning-factory-branch-contracts.js";

const blueprint = learningFactoryBranch("agentic_efficiency_intelligence");

export const branchAgenticEfficiencyIntelligence = {
  id: blueprint.id,
  file: "branch-agentic-efficiency-intelligence.js",
  tier: "base",
  label: blueprint.label,
  domain: "horizontal_work",
  production_status: blueprint.production_status,
  ...AI_LEARNING_EXPOSURE.horizontal,
  description: blueprint.description,
  subbranches: blueprint.subbranches,
  subbranch_contracts: blueprint.subbranch_contracts,
  capability_facets: blueprint.capability_facets,
  all_capability_ids: blueprint.all_capability_ids,
  core_branch_bindings: ["agentic_efficiency_intelligence", "agentic_budget_governance_guard"],
  rules: [
    "Efficienza significa meno invocazioni e meno contesto a parita di outcome verificato, sicurezza e isolamento.",
    "Single-agent e multi-agent sono alternative misurate; il fan-out non e un default.",
    "Riuso di memoria, risultati, artefatti e cache richiede tenant, digest, policy, freschezza e compatibilita.",
    "Early stop, retry e review depth devono essere bounded e spiegabili.",
    "Il ramo misura e propone; non cambia provider, modelli, budget o piano di esecuzione.",
  ],
  guardrails: {
    destructive_automation: false,
    autonomous_budget_change: false,
    autonomous_routing_change: false,
    external_execution: false,
    allowed_action_level: "agentic_efficiency_advisory",
    blocked_actions: [
      "quality_degradation_for_savings",
      "safety_degradation_for_savings",
      "cross_tenant_reuse",
      "stale_context_reuse",
      "automatic_provider_switch",
    ],
  },
};

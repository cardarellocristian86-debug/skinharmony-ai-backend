import {
  AI_LEARNING_EXPOSURE,
  learningFactoryBranch,
} from "./ai-learning-factory-branch-contracts.js";

const blueprint = learningFactoryBranch("agentic_budget_governance_guard");

export const branchAgenticBudgetGovernanceGuard = {
  id: blueprint.id,
  file: "branch-agentic-budget-governance-guard.js",
  tier: "internal",
  label: blueprint.label,
  domain: "ai_learning_governance",
  production_status: blueprint.production_status,
  ...AI_LEARNING_EXPOSURE.guard,
  description: blueprint.description,
  subbranches: blueprint.subbranches,
  subbranch_contracts: blueprint.subbranch_contracts,
  capability_facets: blueprint.capability_facets,
  all_capability_ids: blueprint.all_capability_ids,
  core_branch_bindings: ["agentic_budget_governance_guard"],
  rules: [
    "Budget run, progetto, agente, token, invocazioni, retry e reviewer sono separati e verificati prima del piano.",
    "Quality floor e safety non-degradation prevalgono su ogni obiettivo di risparmio.",
    "Rate card, stime, consuntivi e savings claim devono avere versione e provenance.",
    "Override per task critici richiedono autorita, motivazione, scadenza e audit espliciti.",
    "Il guard produce allow, block, defer o review advisory; non avvia esecuzioni e non modifica budget.",
  ],
  guardrails: {
    destructive_automation: false,
    autonomous_budget_override: false,
    external_execution: false,
    allowed_action_level: "agentic_budget_governance_advisory",
    blocked_actions: [
      "missing_usage_fail_open",
      "budget_override_without_audit",
      "quality_floor_bypass",
      "safety_degradation",
      "duplicate_execution",
      "unproven_savings_claim",
    ],
  },
};

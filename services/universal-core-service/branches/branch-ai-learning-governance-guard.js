import {
  AI_LEARNING_EXPOSURE,
  learningFactoryBranch,
} from "./ai-learning-factory-branch-contracts.js";

const blueprint = learningFactoryBranch("ai_learning_governance_guard");

export const branchAiLearningGovernanceGuard = {
  id: blueprint.id,
  file: "branch-ai-learning-governance-guard.js",
  tier: "internal",
  label: blueprint.label,
  domain: "ai_learning_governance",
  production_status: blueprint.production_status,
  ...AI_LEARNING_EXPOSURE.guard,
  description: blueprint.description,
  subbranches: blueprint.subbranches,
  subbranch_contracts: blueprint.subbranch_contracts,
  rules: [
    "Nessun candidato avanza senza dataset versionato, eval, review umana, autorita e rollback.",
    "Offline, shadow, canary e active sono stati distinti; il guard non concede transizioni da solo.",
    "Candidato, dataset, esperimento, modello, prompt, scorecard e rollback mantengono lineage verificabile.",
    "Evidenze scadute o policy cambiate richiedono revalidation.",
    "Emergency stop revoca o blocca il candidato e non promuove automaticamente un'alternativa.",
  ],
  guardrails: {
    destructive_automation: false,
    autonomous_promotion: false,
    external_execution: false,
    allowed_action_level: "ai_learning_governance_advisory",
    blocked_actions: [
      "promotion_without_versioned_dataset",
      "promotion_without_evaluation",
      "promotion_without_human_review",
      "promotion_without_rollback",
      "automatic_learning_activation",
    ],
  },
};

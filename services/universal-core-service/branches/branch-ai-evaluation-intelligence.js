import {
  AI_LEARNING_EXPOSURE,
  learningFactoryBranch,
} from "./ai-learning-factory-branch-contracts.js";

const blueprint = learningFactoryBranch("ai_evaluation_intelligence");

export const branchAiEvaluationIntelligence = {
  id: blueprint.id,
  file: "branch-ai-evaluation-intelligence.js",
  tier: "base",
  label: blueprint.label,
  domain: "horizontal_work",
  production_status: blueprint.production_status,
  ...AI_LEARNING_EXPOSURE.horizontal,
  description: blueprint.description,
  subbranches: blueprint.subbranches,
  subbranch_contracts: blueprint.subbranch_contracts,
  rules: [
    "Ogni scorecard deve essere versionata e legata a dataset, trace redatte, criteri e baseline verificabili.",
    "Routing, strumenti, handoff, qualita e sicurezza sono misure distinte; una media aggregata non puo nascondere regressioni.",
    "Giudici modello richiedono calibrazione contro criteri deterministici e annotazioni umane.",
    "Training, eval e golden set devono restare separati e protetti da contaminazione.",
    "Il ramo misura e propone; non promuove candidati, non cambia routing e non esegue provider.",
  ],
  guardrails: {
    destructive_automation: false,
    autonomous_promotion: false,
    external_execution: false,
    allowed_action_level: "versioned_ai_evaluation_advisory",
    blocked_actions: [
      "promotion_from_score_only",
      "uncalibrated_model_judge",
      "golden_set_contamination",
      "raw_prompt_persistence",
      "cross_tenant_evaluation",
    ],
  },
};

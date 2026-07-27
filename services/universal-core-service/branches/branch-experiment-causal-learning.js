import {
  AI_LEARNING_EXPOSURE,
  learningFactoryBranch,
} from "./ai-learning-factory-branch-contracts.js";

const blueprint = learningFactoryBranch("experiment_causal_learning");

export const branchExperimentCausalLearning = {
  id: blueprint.id,
  file: "branch-experiment-causal-learning.js",
  tier: "base",
  label: blueprint.label,
  domain: "horizontal_work",
  production_status: blueprint.production_status,
  ...AI_LEARNING_EXPOSURE.horizontal,
  description: blueprint.description,
  subbranches: blueprint.subbranches,
  subbranch_contracts: blueprint.subbranch_contracts,
  rules: [
    "Ipotesi, outcome, baseline, assegnazione e stopping rule sono registrati prima dell'osservazione.",
    "Correlazione e causalita sono distinte e i fattori confondenti restano visibili.",
    "Shadow non controlla output live; canary e A/B richiedono autorita, guard e rollback esterni al ramo.",
    "Ogni esperimento e tenant-scoped, versionato e soggetto a guardrail metrics.",
    "Il ramo propone promozione o rollback; non attiva esperimenti o modifiche di produzione.",
  ],
  guardrails: {
    destructive_automation: false,
    autonomous_experiment_activation: false,
    external_execution: false,
    allowed_action_level: "causal_experiment_advisory",
    blocked_actions: [
      "experiment_without_baseline",
      "assignment_without_integrity",
      "automatic_canary_activation",
      "promotion_without_human_review",
      "cross_tenant_experiment",
    ],
  },
};

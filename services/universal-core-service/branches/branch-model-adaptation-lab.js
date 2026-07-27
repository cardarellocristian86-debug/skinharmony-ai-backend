import {
  AI_LEARNING_EXPOSURE,
  learningFactoryBranch,
} from "./ai-learning-factory-branch-contracts.js";

const blueprint = learningFactoryBranch("model_adaptation_lab");

export const branchModelAdaptationLab = {
  id: blueprint.id,
  file: "branch-model-adaptation-lab.js",
  tier: "internal",
  label: blueprint.label,
  domain: "ai_learning_lab",
  production_status: blueprint.production_status,
  ...AI_LEARNING_EXPOSURE.test_only,
  description: blueprint.description,
  default_route_enabled: false,
  subbranches: blueprint.subbranches,
  subbranch_contracts: blueprint.subbranch_contracts,
  rules: [
    "Il ramo opera solo in test lab esplicito e non e una route di produzione.",
    "Prompt, router, modelli, effort e tool surface candidati sono versionati e non-live.",
    "Offline e shadow eval non possono controllare output o azioni esterne.",
    "Fine-tune e distillazione sono soltanto candidate documentate; nessun training viene avviato.",
    "Ogni proposta richiede risk review, cost review, rollback snapshot e autorita Core esterna.",
  ],
  guardrails: {
    destructive_automation: false,
    autonomous_promotion: false,
    live_mutation: false,
    external_execution: false,
    allowed_action_level: "test_only_model_adaptation_advisory",
    blocked_actions: [
      "production_routing",
      "live_prompt_mutation",
      "live_model_mutation",
      "automatic_training",
      "automatic_promotion",
      "chatgpt_discovery",
    ],
  },
};

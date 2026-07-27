import {
  AI_LEARNING_EXPOSURE,
  learningFactoryBranch,
} from "./ai-learning-factory-branch-contracts.js";

const blueprint = learningFactoryBranch("learning_data_governance");

export const branchLearningDataGovernance = {
  id: blueprint.id,
  file: "branch-learning-data-governance.js",
  tier: "base",
  label: blueprint.label,
  domain: "horizontal_work",
  production_status: blueprint.production_status,
  ...AI_LEARNING_EXPOSURE.horizontal,
  description: blueprint.description,
  subbranches: blueprint.subbranches,
  subbranch_contracts: blueprint.subbranch_contracts,
  rules: [
    "Ogni record candidato deve avere tenant, consenso o eligibility, provenance, redazione e retention verificabili.",
    "Dataset candidate sono snapshot versionati e immutabili; correzioni producono una nuova versione.",
    "Train, eval e golden set restano separati e la sovrapposizione e un blocco fail-closed.",
    "Poisoning e injection vengono quarantinati, non normalizzati in silenzio.",
    "Il ramo prepara candidate dataset; non avvia training, fine-tune o mutazioni dei pesi.",
  ],
  guardrails: {
    destructive_automation: false,
    automatic_training: false,
    external_execution: false,
    allowed_action_level: "tenant_scoped_dataset_candidate_advisory",
    blocked_actions: [
      "cross_tenant_dataset",
      "dataset_without_provenance",
      "training_without_separation",
      "unredacted_sensitive_content",
      "automatic_model_training",
    ],
  },
};

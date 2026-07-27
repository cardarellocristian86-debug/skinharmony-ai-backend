import {
  AI_LEARNING_EXPOSURE,
  learningFactoryBranch,
} from "./ai-learning-factory-branch-contracts.js";

const blueprint = learningFactoryBranch("ai_data_integrity_guard");

export const branchAiDataIntegrityGuard = {
  id: blueprint.id,
  file: "branch-ai-data-integrity-guard.js",
  tier: "internal",
  label: blueprint.label,
  domain: "ai_learning_governance",
  production_status: blueprint.production_status,
  ...AI_LEARNING_EXPOSURE.guard,
  description: blueprint.description,
  subbranches: blueprint.subbranches,
  subbranch_contracts: blueprint.subbranch_contracts,
  rules: [
    "Tenant, client, audience, entitlement e finalita sono derivati server-side e non ampliabili dal payload.",
    "Ogni record richiede provenance, consenso o eligibility e redazione verificabili.",
    "Dataset versionati sono immutabili e train/eval/golden restano separati.",
    "Poisoning e injection sono quarantinati con evidenza, non corretti silenziosamente.",
    "Revoche, expiry e cancellazioni devono propagarsi ai derivati senza perdere audit.",
  ],
  guardrails: {
    destructive_automation: false,
    automatic_export: false,
    external_execution: false,
    allowed_action_level: "ai_data_integrity_advisory",
    blocked_actions: [
      "cross_tenant_dataset_access",
      "client_audience_override",
      "dataset_without_provenance",
      "train_eval_leakage",
      "poisoned_record_promotion",
      "unrestricted_export",
    ],
  },
};

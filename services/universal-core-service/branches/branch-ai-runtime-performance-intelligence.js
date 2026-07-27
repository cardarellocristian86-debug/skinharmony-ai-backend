import {
  AI_LEARNING_EXPOSURE,
  learningFactoryBranch,
} from "./ai-learning-factory-branch-contracts.js";

const blueprint = learningFactoryBranch("ai_runtime_performance_intelligence");

export const branchAiRuntimePerformanceIntelligence = {
  id: blueprint.id,
  file: "branch-ai-runtime-performance-intelligence.js",
  tier: "base",
  label: blueprint.label,
  domain: "horizontal_work",
  production_status: blueprint.production_status,
  ...AI_LEARNING_EXPOSURE.horizontal,
  description: blueprint.description,
  subbranches: blueprint.subbranches,
  subbranch_contracts: blueprint.subbranch_contracts,
  rules: [
    "Prestazioni e costo si misurano per outcome verificato, non per chiamata isolata.",
    "Ogni misura dichiara finestra, segmento, numerosita, snapshot e limiti.",
    "p50, p95 e p99 restano distinti e sono attribuiti a route, queue, provider, tool e handoff.",
    "Metriche e trace sono redatte; prompt e contenuti sensibili non vengono conservati per default.",
    "Il ramo produce raccomandazioni bounded; non modifica scaling, provider o routing.",
  ],
  guardrails: {
    destructive_automation: false,
    autonomous_runtime_change: false,
    external_execution: false,
    allowed_action_level: "runtime_performance_advisory",
    blocked_actions: [
      "performance_claim_without_verified_outcome",
      "raw_prompt_telemetry",
      "automatic_provider_switch",
      "automatic_scaling_change",
      "cross_tenant_metric_join",
    ],
  },
};

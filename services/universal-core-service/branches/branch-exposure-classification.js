const HORIZONTAL_CLIENT_TYPES = Object.freeze([
  "chatgpt",
  "codex",
  "api_agent",
  "admin",
]);

const HORIZONTAL_AUDIENCES = Object.freeze([
  "chatgpt_connector",
  "codex_internal",
  "api_agent",
  "admin_control_room",
]);

const ADJACENT_AUDIENCE = Object.freeze({
  smartdesk: "smartdesk_runtime",
  analyzer: "analyzer_runtime",
  tricocamera: "analyzer_runtime",
  suite: "suite_runtime",
  waas: "suite_runtime",
});

function freezeProfile(profile) {
  return Object.freeze({
    ...profile,
    allowed_client_types: Object.freeze([...profile.allowed_client_types]),
    allowed_audiences: Object.freeze([...profile.allowed_audiences]),
    required_entitlements: Object.freeze([...profile.required_entitlements]),
  });
}

function horizontal() {
  return freezeProfile({
    exposure_class: "chatgpt_horizontal",
    allowed_client_types: HORIZONTAL_CLIENT_TYPES,
    allowed_audiences: HORIZONTAL_AUDIENCES,
    required_entitlements: [],
    discoverable_in_connector: true,
    semantic_select_allowed: true,
  });
}

function codexInternal() {
  return freezeProfile({
    exposure_class: "codex_internal",
    allowed_client_types: ["codex", "admin"],
    allowed_audiences: ["codex_internal", "admin_control_room"],
    required_entitlements: [],
    discoverable_in_connector: true,
    semantic_select_allowed: true,
  });
}

function softwareAdjacent(branchId, adjacentClientTypes) {
  const clients = [...new Set(adjacentClientTypes)];
  const audiences = [...new Set(clients.map((clientType) => ADJACENT_AUDIENCE[clientType]))];
  if (
    !clients.length ||
    clients.some((clientType) => !ADJACENT_AUDIENCE[clientType]) ||
    audiences.some((audience) => !audience)
  ) {
    throw new Error(`branch_exposure_adjacent_client_invalid:${branchId}`);
  }
  return freezeProfile({
    exposure_class: "software_adjacent",
    allowed_client_types: [...clients, "admin"],
    allowed_audiences: [...audiences, "admin_control_room"],
    required_entitlements: [`branch:${branchId}`],
    discoverable_in_connector: true,
    semantic_select_allowed: true,
  });
}

function testOnly() {
  return freezeProfile({
    exposure_class: "test_only",
    allowed_client_types: ["admin"],
    allowed_audiences: ["admin_control_room"],
    required_entitlements: [],
    discoverable_in_connector: true,
    semantic_select_allowed: false,
  });
}

const SMARTDESK = Object.freeze(["smartdesk"]);
const ANALYZER = Object.freeze(["analyzer", "tricocamera"]);
const SUITE = Object.freeze(["suite", "waas"]);
const SMARTDESK_AND_ANALYZER = Object.freeze(["smartdesk", "analyzer", "tricocamera"]);
const SMARTDESK_AND_SUITE = Object.freeze(["smartdesk", "suite", "waas"]);
const ANALYZER_AND_SUITE = Object.freeze(["analyzer", "tricocamera", "suite", "waas"]);
const ALL_ADJACENT = Object.freeze(["smartdesk", "analyzer", "tricocamera", "suite", "waas"]);

// This matrix is intentionally exhaustive and has no default classification.
// A descriptor absent from the matrix receives no exposure fields and is
// consequently hidden by the fail-closed branch exposure validator.
export const BRANCH_EXPOSURE_CLASSIFICATION = Object.freeze({
  front_desk_base: softwareAdjacent("front_desk_base", SMARTDESK),
  operations_silver: softwareAdjacent("operations_silver", SMARTDESK),
  executive_gold: softwareAdjacent("executive_gold", SMARTDESK),
  suite_governance: softwareAdjacent("suite_governance", SUITE),
  beauty_market: softwareAdjacent("beauty_market", ANALYZER_AND_SUITE),
  marketing_copy: softwareAdjacent("marketing_copy", SUITE),
  paid_ads_guard: softwareAdjacent("paid_ads_guard", SUITE),
  lifecycle_crm_guard: softwareAdjacent("lifecycle_crm_guard", SUITE),
  customer_behavior_analysis: softwareAdjacent("customer_behavior_analysis", SUITE),
  segmentation_offer_guard: softwareAdjacent("segmentation_offer_guard", SUITE),
  funnel_conversion_guard: softwareAdjacent("funnel_conversion_guard", SUITE),
  email_recall_guard: softwareAdjacent("email_recall_guard", SMARTDESK_AND_SUITE),
  content_localization_guard: softwareAdjacent("content_localization_guard", SUITE),
  cosmetic_chemistry: softwareAdjacent("cosmetic_chemistry", ANALYZER),
  skinharmony_analyzer: softwareAdjacent("skinharmony_analyzer", ANALYZER),
  scalp_analyzer: softwareAdjacent("scalp_analyzer", ANALYZER),
  technology_market: softwareAdjacent("technology_market", SUITE),
  business_strategy: softwareAdjacent("business_strategy", SUITE),
  translation_governance: softwareAdjacent("translation_governance", SUITE),
  translator_marketing_governance: softwareAdjacent("translator_marketing_governance", SUITE),
  ramo_testo: softwareAdjacent("ramo_testo", SUITE),
  nyra_finance_beauty_test: testOnly(),
  codex_code_safety: codexInternal(),
  codex_architecture_guard: codexInternal(),
  codex_test_strategy: codexInternal(),
  codex_release_gate: codexInternal(),
  codex_security_guard: codexInternal(),
  codex_product_logic: codexInternal(),
  codex_ui_ux_guard: codexInternal(),
  codex_business_guard: codexInternal(),
  codex_site_factory_guard: codexInternal(),
  codex_website_visual_guard: codexInternal(),
  codex_wordpress_platform_guard: codexInternal(),
  data_integration_orchestration: codexInternal(),
  commerce_fulfillment_guard: softwareAdjacent("commerce_fulfillment_guard", SMARTDESK_AND_SUITE),
  observability_roi_guard: codexInternal(),
  legal_privacy_compliance_guard: codexInternal(),
  agent_orchestration_guard: codexInternal(),
  agent_orchestration: horizontal(),
  ai_orchestration: horizontal(),
  runtime_deployment_scaling_guard: codexInternal(),
  consent_ledger_guard: softwareAdjacent("consent_ledger_guard", SMARTDESK_AND_SUITE),
  event_taxonomy_guard: softwareAdjacent("event_taxonomy_guard", SMARTDESK_AND_SUITE),
  customer_360_guard: softwareAdjacent("customer_360_guard", ALL_ADJACENT),
  journey_orchestration_guard: softwareAdjacent("journey_orchestration_guard", SMARTDESK_AND_SUITE),
  billing_contract_guard: softwareAdjacent("billing_contract_guard", SMARTDESK_AND_SUITE),
  support_success_guard: softwareAdjacent("support_success_guard", SMARTDESK_AND_SUITE),
  beauty_value_chain_guard: softwareAdjacent("beauty_value_chain_guard", ANALYZER_AND_SUITE),
  brand_distributor_network_guard: softwareAdjacent("brand_distributor_network_guard", SUITE),
  product_inventory_guard: softwareAdjacent("product_inventory_guard", SMARTDESK_AND_SUITE),
  smartdesk_operations_guard: softwareAdjacent("smartdesk_operations_guard", SMARTDESK),
  beauty_protocol_guard: softwareAdjacent("beauty_protocol_guard", SMARTDESK_AND_ANALYZER),
  software_systems_intelligence: codexInternal(),
  software_binary_intelligence: codexInternal(),
  hardware_systems_intelligence: codexInternal(),
  software_security_intelligence: codexInternal(),
  network_security_intelligence: codexInternal(),
  infrastructure_runtime_intelligence: codexInternal(),
  learning_knowledge_intelligence: codexInternal(),
  work_intake_intelligence: horizontal(),
  research_evidence_intelligence: horizontal(),
  planning_priority_intelligence: horizontal(),
  execution_coordination_intelligence: horizontal(),
  quality_verification_intelligence: horizontal(),
  adaptive_learning_intelligence: horizontal(),
  ai_evaluation_intelligence: horizontal(),
  learning_data_governance: horizontal(),
  ai_runtime_performance_intelligence: horizontal(),
  experiment_causal_learning: horizontal(),
  model_adaptation_lab: testOnly(),
  ai_learning_governance_guard: codexInternal(),
  ai_data_integrity_guard: codexInternal(),
  agentic_efficiency_intelligence: horizontal(),
  agentic_budget_governance_guard: codexInternal(),
  lexical_semantic_intelligence: horizontal(),
  workload_identity_delegation_guard: codexInternal(),
  decision_provenance_intelligence: horizontal(),
  beauty_vertical_orchestration: softwareAdjacent("beauty_vertical_orchestration", ANALYZER),
  change_impact_orchestration: codexInternal(),
});

export function branchExposureClassification(branchId) {
  return BRANCH_EXPOSURE_CLASSIFICATION[String(branchId || "")] || null;
}

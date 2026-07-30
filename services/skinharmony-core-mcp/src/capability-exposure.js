export const CAPABILITY_EXPOSURE_CONTRACT_VERSION = "capability_exposure_contract_v2";

const CLIENT_AUDIENCE = Object.freeze({
  chatgpt: "chatgpt_connector",
  codex: "codex_internal",
  api_agent: "api_agent",
  smartdesk: "smartdesk_runtime",
  analyzer: "analyzer_runtime",
  tricocamera: "analyzer_runtime",
  suite: "suite_runtime",
  waas: "suite_runtime",
  admin: "admin_control_room",
});

const HORIZONTAL_CLIENTS = Object.freeze(["chatgpt", "codex", "api_agent", "admin"]);
const HORIZONTAL_AUDIENCES = Object.freeze([
  "chatgpt_connector",
  "codex_internal",
  "api_agent",
  "admin_control_room",
]);

// This list is intentionally exhaustive. A new capability is unavailable until
// its exposure contract is explicitly added here or directly to the tool.
const HORIZONTAL_CAPABILITY_IDS = Object.freeze([
  "core_health",
  "core_runtime_hierarchy_status",
  "core_runtime_hierarchy_evaluate",
  "work_preflight",
  "nyra_runtime_context",
  "nyra_branch_catalog",
  "core_capability_catalog",
  "core_branch_registry",
  "core_branch_analyze",
  "core_control_plane_read",
  "core_evidence_recent",
  "core_semantic_select",
  "core_capability_read",
  "core_capability_invoke",
  "core_software_language_evaluate",
  "core_content_guard_check",
  "core_claim_guard_check",
  "core_pricing_guard_check",
  "core_policy_check",
  "core_action_mediation_evaluate",
  "core_release_manifest_check",
  "core_translator_extractor_status",
  "core_software_intelligence_components",
  "core_software_intelligence_analyze",
  "core_software_intelligence_jobs",
  "core_entity_graph_read",
  "core_entity_graph_upsert",
  "core_review_pending",
  "core_review_action",
  "orchestration_capability_catalog",
  "lexical_semantic_catalog",
  "lexical_semantic_analyze",
  "orchestration_relational_evaluate",
  "orchestration_dtt_plan",
  "orchestration_dtt_read",
  "orchestration_dtt_expansion_propose",
  "orchestration_dtt_replan_propose",
  "orchestration_dtt_outcome_record",
  "orchestration_dtt_evidence_prepare",
  "orchestration_dtt_agent_attest",
  "orchestration_dtt_verifier_assign_self",
  "orchestration_dtt_artifact_register",
  "orchestration_dtt_cancel",
  "orchestration_dtt_retry_fallback_read",
  "orchestration_dtt_core_join",
  "nyra_interpret_request",
  "nyra_fetch_analysis",
  "core_gate_action",
  "intelligence_workflow",
  "scenario_analysis",
  "hypothesis_rank",
  "event_probability",
  "counterfactual_analysis",
  "decision_select",
  "outcome_verify",
  "outcome_record",
  "calibration_status",
  "ai_eval_scorecard_read",
  "ai_eval_dataset_read",
  "ai_eval_trace_read",
  "ai_performance_scorecard_read",
  "ai_experiment_read",
  "ai_learning_candidate_read",
  "ai_learning_review_binding_preview",
  "ai_learning_candidate_review",
  "ai_learning_outcome_record",
  "agentic_efficiency_plan",
  "agentic_efficiency_status",
  "agentic_efficiency_report",
  "agentic_budget_preview",
  "agentic_budget_status",
  "agentic_work_capsule_read",
  "agentic_savings_compare",
  "agentic_artifact_reuse_check",
  "decision_ledger_report",
  "nyra_research_plan",
  "nyra_research_ingest",
  "nyra_research_query",
  "nyra_research_status",
  "nyra_research_feedback",
  "nyra_research_execute",
  "tenant_provider_openai_status",
  "tenant_provider_openai_setup_panel",
  "tenant_provider_openai_setup_link",
  "tenant_provider_openai_multi_agent_smoke_run",
  "tenant_provider_openai_multi_agent_run_read",
  "tenant_provider_openai_multi_agent_run_cancel",
  "generic_agent_orchestration_create",
  "generic_agent_orchestration_claim",
  "generic_agent_orchestration_complete",
  "generic_agent_orchestration_cancel",
  "generic_agent_orchestration_join",
  "generic_agent_start",
  "generic_agent_checkpoint",
  "generic_agent_run_read",
  "generic_agent_evaluate",
  "memory_context",
  "memory_search",
  "memory_append",
  "memory_checkpoint",
  "memory_handoff",
  "memory_handoff_acknowledge",
  "search",
  "fetch",
  "memory_cloud_status",
  "memory_document_upsert",
  "workspace_list",
  "workspace_create_folder",
  "workspace_read_document",
  "workspace_write_document",
  "task_list",
  "task_create",
  "task_claim",
  "task_update",
  "agent_heartbeat",
  "agent_list",
  "message_post",
  "message_inbox",
  "message_acknowledge",
]);

const SUITE_CAPABILITY_IDS = Object.freeze([
  "suite_status",
  "suite_cockpit_360",
  "suite_branch_catalog",
  "suite_branch_read",
  "suite_decision_preview",
  "suite_runbook_catalog",
  "suite_runbook_preview",
]);

const ANALYZER_CAPABILITY_IDS = Object.freeze([
  "skin_analyzer",
  "scalp_analyzer",
]);

const REGISTERED_EXPOSURE = new Map([
  ...HORIZONTAL_CAPABILITY_IDS.map((id) => [id, {
    exposure_class: "chatgpt_horizontal",
    allowed_client_types: HORIZONTAL_CLIENTS,
    allowed_audiences: HORIZONTAL_AUDIENCES,
    discoverable_in_connector: true,
    semantic_select_allowed: true,
  }]),
  ...SUITE_CAPABILITY_IDS.map((id) => [id, {
    exposure_class: "software_adjacent",
    allowed_client_types: Object.freeze(["suite", "waas", "admin"]),
    allowed_audiences: Object.freeze(["suite_runtime", "admin_control_room"]),
    discoverable_in_connector: true,
    semantic_select_allowed: true,
  }]),
  ...ANALYZER_CAPABILITY_IDS.map((id) => [id, {
    exposure_class: "software_adjacent",
    allowed_client_types: Object.freeze(["analyzer", "tricocamera", "admin"]),
    allowed_audiences: Object.freeze(["analyzer_runtime", "admin_control_room"]),
    discoverable_in_connector: true,
    semantic_select_allowed: true,
  }]),
]);

const HIDDEN_EXPOSURE = Object.freeze({
  exposure_class: "unavailable",
  allowed_client_types: Object.freeze([]),
  allowed_audiences: Object.freeze([]),
  required_entitlements: Object.freeze([]),
  discoverable_in_connector: false,
  semantic_select_allowed: false,
  classification_complete: false,
});

function serverClientType(identity = {}) {
  if (identity.kind === "oauth") return "chatgpt";
  if (identity.kind === "codex") return "codex";
  const trusted = String(identity.serverClientType || "");
  return Object.hasOwn(CLIENT_AUDIENCE, trusted) ? trusted : "unbound";
}

function serverAudience(clientType) {
  return CLIENT_AUDIENCE[clientType] || "unbound";
}

export function capabilityAccessContext(identity = {}) {
  const clientType = serverClientType(identity);
  return Object.freeze({
    tenant_id: String(identity.tenantId || ""),
    client_type: clientType,
    audience: serverAudience(clientType),
    entitlements: Object.freeze([...new Set((identity.scopes || []).map(String))]),
    role: String(identity.role || "member"),
    source: "authenticated_mcp_identity",
  });
}

function validExposureContract(contract) {
  return Boolean(
    contract &&
    ["chatgpt_horizontal", "codex_internal", "software_adjacent", "admin_only", "test_only"].includes(
      contract.exposure_class,
    ) &&
    Array.isArray(contract.allowed_client_types) &&
    contract.allowed_client_types.length > 0 &&
    Array.isArray(contract.allowed_audiences) &&
    contract.allowed_audiences.length > 0 &&
    typeof contract.discoverable_in_connector === "boolean" &&
    typeof contract.semantic_select_allowed === "boolean" &&
    contract.allowed_client_types.every((clientType) =>
      CLIENT_AUDIENCE[clientType] &&
      contract.allowed_audiences.includes(CLIENT_AUDIENCE[clientType]),
    )
  );
}

function declaredProfile(tool) {
  const explicit = tool?.exposure;
  if (explicit !== undefined) return validExposureContract(explicit) ? explicit : null;
  return REGISTERED_EXPOSURE.get(String(tool?.name || "")) || null;
}

function profile(tool) {
  const declared = declaredProfile(tool);
  if (!declared) return HIDDEN_EXPOSURE;
  return Object.freeze({
    exposure_class: declared.exposure_class,
    allowed_client_types: Object.freeze([...declared.allowed_client_types]),
    allowed_audiences: Object.freeze([...declared.allowed_audiences]),
    required_entitlements: Object.freeze([...new Set((tool?.scopes || []).map(String))]),
    discoverable_in_connector: declared.discoverable_in_connector,
    semantic_select_allowed: declared.semantic_select_allowed,
    classification_complete: true,
  });
}

export function capabilityExposureProfile(tool) {
  return profile(tool);
}

export function capabilityExposureRegistryValidation(tools = []) {
  const names = tools.map((tool) => String(tool?.name || ""));
  const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
  const incomplete = tools
    .filter((tool) => profile(tool).classification_complete !== true)
    .map((tool) => String(tool?.name || ""));
  return Object.freeze({
    ok: duplicateNames.length === 0 && incomplete.length === 0,
    classified_count: tools.length - incomplete.length,
    capability_count: tools.length,
    duplicate_ids: Object.freeze([...new Set(duplicateNames)].sort()),
    incomplete_ids: Object.freeze(incomplete.sort()),
  });
}

export function capabilityAvailableForIdentity(tool, identity, { semantic = false } = {}) {
  const access = capabilityAccessContext(identity);
  const exposure = profile(tool);
  if (exposure.classification_complete !== true) return false;
  if (!exposure.allowed_client_types.includes(access.client_type)) return false;
  if (!exposure.allowed_audiences.includes(access.audience)) return false;
  if (access.client_type === "chatgpt" && exposure.exposure_class !== "chatgpt_horizontal") {
    return false;
  }
  if (semantic && exposure.semantic_select_allowed !== true) return false;
  if (!semantic && exposure.discoverable_in_connector !== true) return false;
  if (access.client_type === "admin" && access.audience === "admin_control_room") return true;
  const entitlements = new Set(access.entitlements);
  return exposure.required_entitlements.every((entitlement) => entitlements.has(entitlement));
}

export function candidateLooksVertical(candidate) {
  const values = [
    candidate?.id,
    candidate?.capability_id,
    candidate?.branch_id,
    candidate?.branch,
    candidate?.group,
    candidate?.metadata?.branch_id,
    candidate?.semantic_context?.branch_id,
  ].map((value) => String(value || "").toLowerCase());
  return values.some((value) =>
    /^(suite|skin|scalp|smartdesk|beauty|analyzer|tricocamera|waas)_/.test(value),
  );
}

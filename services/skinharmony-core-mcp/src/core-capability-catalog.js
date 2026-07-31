export const CORE_CONNECTOR_CATALOG_VERSION = "core_connector_capabilities_v2";

const capability = (tool, group, route, method = "GET", mutation = false) => ({
  tool,
  group,
  route,
  method,
  mutation,
  tenant_binding: "server_authenticated",
  authority: "universal_core",
});

export const CORE_CONNECTOR_CAPABILITIES = [
  capability("core_branch_registry", "branches", "/v1/branches"),
  capability("core_branch_analyze", "branches", "/v1/branches/:branch/analyze", "POST"),
  capability("core_control_plane_read", "governance", "/v1/control-plane/overview"),
  capability("core_evidence_recent", "governance", "/v1/evidence/recent"),
  capability("core_semantic_select", "semantic", "/v1/semantic-selection", "POST"),
  capability("core_software_language_evaluate", "semantic", "/v1/software-language-gate/evaluate", "POST"),
  capability("core_content_guard_check", "semantic", "/v1/content-guard/check", "POST"),
  capability("core_claim_guard_check", "guardrails", "/v1/claim-guard/check", "POST"),
  capability("core_pricing_guard_check", "guardrails", "/v1/pricing-guard/check", "POST"),
  capability("core_policy_check", "guardrails", "/v1/policy/check", "POST"),
  capability("core_action_mediation_evaluate", "guardrails", "/v1/action-mediation/evaluate", "POST"),
  capability("core_release_manifest_check", "release", "/v1/releases/manifest/check", "POST"),
  capability("core_translator_extractor_status", "translation", "/v1/translator/extractor/status"),
  capability("core_software_intelligence_components", "software_intelligence", "/v1/software-intelligence/components"),
  capability("core_software_intelligence_analyze", "software_intelligence", "/v1/software-intelligence/analyze", "POST"),
  capability("core_software_intelligence_jobs", "software_intelligence", "/v1/software-intelligence/jobs"),
  capability("core_entity_graph_read", "semantic_graph", "/v1/entity-graph"),
  capability("core_entity_graph_upsert", "semantic_graph", "/v1/entity-graph/upsert", "POST", true),
  capability("core_review_pending", "review", "/v1/review/pending"),
  capability("core_review_action", "review", "/v1/review/action", "POST", true),
];

export const CORE_CONNECTOR_INTERNAL_SURFACES = [
  {
    group: "administration",
    patterns: ["/v1/keys", "/v1/tenants/upsert", "/v1/setup-tokens"],
    reason: "admin_or_bootstrap_credentials_must_not_be_exposed_to_model_tools",
  },
  {
    group: "runtime_internals",
    patterns: ["/v1/agents/queue", "/v1/model-reservations", "/v1/tool-events"],
    reason: "low_level_runtime_mutations_require_governed_high_level_wrappers",
  },
  {
    group: "raw_sync",
    patterns: ["/v1/sync/suite", "/v1/sync/wordpress"],
    reason: "raw_customer_sync_is_not_a_general_ai_tool",
  },
];

export function readCoreCapabilityCatalog({ group, cursor = "0", limit = 25 } = {}) {
  const filtered = group
    ? CORE_CONNECTOR_CAPABILITIES.filter((item) => item.group === group)
    : CORE_CONNECTOR_CAPABILITIES;
  const start = Math.max(0, Number.parseInt(String(cursor), 10) || 0);
  const pageSize = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const capabilities = filtered.slice(start, start + pageSize);
  const next = start + capabilities.length;
  return {
    ok: true,
    schema_version: CORE_CONNECTOR_CATALOG_VERSION,
    core_final_authority: true,
    arbitrary_route_invocation_allowed: false,
    capabilities,
    groups: [...new Set(CORE_CONNECTOR_CAPABILITIES.map((item) => item.group))].sort(),
    total: filtered.length,
    next_cursor: next < filtered.length ? String(next) : null,
    internal_surfaces: group ? [] : CORE_CONNECTOR_INTERNAL_SURFACES,
  };
}

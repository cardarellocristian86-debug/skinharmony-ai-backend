import crypto from "node:crypto";

const SAFE_STATES = new Set(["ready", "attention", "blocked", "insufficient_data", "unknown"]);
const SAFE_MODULE_STATES = new Set(["ready", "attention", "blocked", "disabled", "not_entitled", "unknown"]);
const COCKPIT_SOURCE_IDS = [
  "site_event_summary", "node_freshness", "google_connector", "google_funnel", "suite_events",
  "customer_360_summary", "customer_summary", "journey_summary", "consent_readiness", "commerce_summary", "crm_freshness",
  "checkout_events", "settlement_summary", "commerce_inventory", "registry_summary", "technology_inventory",
  "technology_summary", "commerce_totals", "margin_summary", "official_list_status", "claim_guard",
  "content_freshness", "tenant_policy", "license_summary", "core_scope", "usage_summary", "node_readiness",
  "service_readiness", "nyra_scope", "validation", "change_impact", "evidence_summary", "visual_summary",
  "analytics_summary", "claim_summary",
];

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeText(value, max = 240) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function safeCode(value, fallback = "unknown", max = 100) {
  const cleaned = safeText(value, max).replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return cleaned || fallback;
}

function safeIso(value, fallback = "") {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function safeNumber(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function safeBoolean(value) {
  return value === true;
}

function uniqueCodes(value, limit = 30) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((item) => safeCode(item, "")).filter(Boolean))].slice(0, limit);
}

function safeCounts(input, allowedKeys) {
  const source = asObject(input);
  const output = {};
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, key) || source[key] === null || source[key] === "") continue;
    const parsed = Number(source[key]);
    if (Number.isFinite(parsed)) output[key] = safeNumber(parsed);
  }
  return output;
}

function safeCommerceCounts(input) {
  const source = asObject(input);
  const output = safeCounts(source, COCKPIT_COUNT_FIELDS.commerce);
  if (Object.prototype.hasOwnProperty.call(source, "margin_net") && Number.isFinite(Number(source.margin_net))) {
    output.margin_net = safeNumber(source.margin_net, 0, -1_000_000_000, 1_000_000_000);
  }
  return output;
}

function safePrimitiveMap(input, allowedKeys) {
  const source = asObject(input);
  const output = {};
  for (const key of allowedKeys) {
    const value = source[key];
    if (typeof value === "boolean") output[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "string") output[key] = safeText(value, 180);
  }
  return output;
}

function safeDimensionList(value, limit = 30) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map((item) => ({
    key: safeCode(item?.key || item?.id || item?.dimension, "dimension"),
    label: safeText(item?.label || item?.name || "", 120),
    status: safeCode(item?.status || item?.state || "unknown"),
    score: safeNumber(item?.score, 0, 0, 100),
    attention_count: safeNumber(item?.attention_count || item?.issues_count),
  }));
}

function safeConnectorList(value, limit = 30) {
  const records = Array.isArray(value) ? value : Object.entries(asObject(value)).map(([id, record]) => ({ id, ...asObject(record) }));
  return records.slice(0, limit).map((item) => ({
    id: safeCode(item?.id || item?.key || item?.connector, "connector"),
    status: safeCode(item?.status || item?.state || "unknown"),
    mode: safeCode(item?.mode || "read_only"),
    configured: safeBoolean(item?.configured),
    scope_status: safeCode(item?.scope_status || "unknown"),
    scopes: uniqueCodes(item?.scopes, 20),
  }));
}

function safeFreshnessSources(value, limit = 40) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map((item) => ({
    key: safeCode(item?.key || item?.id || item?.source, "source"),
    status: safeCode(item?.status || item?.level || "unknown"),
    updated_at: safeIso(item?.updated_at || item?.generated_at || item?.last_seen_at),
    age_seconds: safeNumber(item?.age_seconds),
    max_age_seconds: safeNumber(item?.max_age_seconds || item?.stale_after_seconds),
  }));
}

function safeTimeline(value, limit = 20) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map((item) => ({
    id: safeCode(item?.id || item?.event_id, "event"),
    created_at: safeIso(item?.created_at || item?.received_at),
    action_type: safeCode(item?.action_type || item?.type || "unknown"),
    state: safeCode(item?.state || item?.gate_state || "unknown"),
    risk: safeCode(item?.risk || item?.risk_band || "unknown"),
    owner_confirmed: safeBoolean(item?.owner_confirmed),
    rollback_available: safeBoolean(item?.rollback_available),
  }));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => !["generated_at", "revision_hash", "heartbeat_age_seconds", "age_seconds"].includes(key))
    .sort()
    .map((key) => [key, stableValue(value[key])]));
}

function revisionHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function sanitizeModuleCoverage(source = {}) {
  const coverage = asObject(source.module_coverage);
  const rawStatuses = Array.isArray(coverage.statuses)
    ? coverage.statuses
    : Array.isArray(source.module_statuses)
      ? source.module_statuses
      : Array.isArray(source.modules)
        ? source.modules
        : [];
  const statuses = rawStatuses.slice(0, 80).map((item) => {
    const rawState = String(item?.state || item?.status || "unknown");
    return {
      id: safeCode(item?.id || item?.key || item?.module_id, "module"),
      label: safeText(item?.label || item?.name || "", 120),
      state: SAFE_MODULE_STATES.has(rawState) ? rawState : "unknown",
      enabled: item?.enabled === true,
      entitled: item?.entitled !== false,
      readiness_score: safeNumber(item?.readiness_score || item?.score, 0, 0, 100),
      attention_codes: uniqueCodes(item?.attention_codes || item?.attention, 12),
      source: safeCode(item?.source || "wordpress_site_suite"),
    };
  });
  const count = (state) => statuses.filter((item) => item.state === state).length;
  return {
    expected_total: safeNumber(coverage.expected_total || source.modules_expected_total, 50, 0, 100),
    total: statuses.length,
    known: statuses.filter((item) => item.state !== "unknown").length,
    ready: count("ready"),
    attention: count("attention"),
    blocked: count("blocked"),
    disabled: count("disabled"),
    not_entitled: count("not_entitled"),
    unknown: count("unknown"),
    statuses,
  };
}

const COCKPIT_COUNT_FIELDS = {
  customer: [
    "profiles_visible", "crm_contacts", "crm_followups", "high_priority_profiles", "manual_review_profiles",
    "average_readiness", "average_risk", "lead_total", "lead_open", "consent_missing_count", "followup_due_count",
  ],
  commerce: [
    "orders_count", "order_value", "revenue_net", "margin_net", "manual_settlement_rows", "owner_confirmation_required",
    "fulfillment_attention_count", "checkout_events", "below_cost_count", "discount_attention_count",
  ],
  registry: [
    "product_items", "technology_items", "low_stock_items", "missing_price_count", "missing_sku_count",
    "woo_unlinked_count", "missing_cost_count", "missing_sale_mode_count", "claim_attention_count",
  ],
  license: ["active_licenses", "expiring_licenses", "grace_period_count", "locked_modules", "domain_mismatch_count"],
  operations: [
    "events_total", "connectors_declared", "runbooks_available", "blocked_actions", "rollback_required",
    "inactive_nodes", "support_open_count", "onboarding_attention_count", "module_adoption_gap_count",
  ],
  content: ["desktop_review_missing", "mobile_review_missing", "cta_visibility_attention", "layout_attention", "priority_path_count"],
};

function sanitizeBranchSummary(value) {
  return (Array.isArray(value) ? value : []).slice(0, 14).map((item) => ({
    key: safeCode(item?.key || item?.branch_key, "branch"),
    state: SAFE_STATES.has(String(item?.state || item?.status)) ? String(item.state || item.status) : "unknown",
    evidence_ratio: safeNumber(item?.evidence_ratio, 0, 0, 1),
    attention_count: safeNumber(item?.attention_count),
    blocking_count: safeNumber(item?.blocking_count),
    missing_evidence_count: safeNumber(item?.missing_evidence_count),
    primary_reason: safeCode(item?.primary_reason || "none"),
    top_action: safeCode(item?.top_action || "review_branch"),
  }));
}

export function sanitizeCockpit360Summary(input = {}, context = {}) {
  const source = asObject(input);
  const governance = asObject(source.governance);
  const claims = safeCounts(governance.claims, ["issues_total", "blocker_count", "medical_claim_count", "price_claim_count", "unverified_source_count", "review_required_count"]);
  const pricing = safeCounts(governance.pricing, ["missing_official_price_count", "below_cost_count", "negative_margin_count", "discount_attention_count", "settlement_attention_count"]);
  const connectors = asObject(source.connectors);
  const sanitized = {
    schema_version: "cockpit_360_summary_v1",
    generated_at: safeIso(source.generated_at, new Date().toISOString()),
    source_schema_version: safeCode(source.schema_version || source.source_schema_version || "cockpit_360_summary_v1"),
    scope: {
      tenant_id: safeCode(context.tenantId || source.scope?.tenant_id || source.tenant_id, "tenant"),
      node_id: safeCode(context.nodeId || source.scope?.node_id || source.node_id, "node"),
    },
    posture: {
      readiness_score: safeNumber(source.posture?.readiness_score || source.summary?.readiness_score, 0, 0, 100),
      risk_score: safeNumber(source.posture?.risk_score || source.summary?.risk_score, 0, 0, 100),
      data_quality_score: safeNumber(source.posture?.data_quality_score || source.summary?.data_quality_score, 0, 0, 100),
      automation_mode: safeCode(source.posture?.automation_mode || "manual_confirm_only"),
    },
    customer: safeCounts(source.customer || source.summary?.customer, COCKPIT_COUNT_FIELDS.customer),
    commerce: safeCommerceCounts(source.commerce || source.summary?.commerce),
    registry: safeCounts(source.registry || source.summary?.registry, COCKPIT_COUNT_FIELDS.registry),
    license: safeCounts(source.license || source.summary?.license, COCKPIT_COUNT_FIELDS.license),
    operations: safeCounts(source.operations || source.summary?.operations, COCKPIT_COUNT_FIELDS.operations),
    content: safeCounts(source.content || source.summary?.content, COCKPIT_COUNT_FIELDS.content),
    governance: { claims, pricing },
    connectors: {
      google: safePrimitiveMap(connectors.google, ["configured", "connected", "provider_ready", "state", "scope_status"]),
      google_funnel: safeCounts(connectors.google_funnel, ["impressions", "clicks", "cost", "ads_conversions", "ga4_sessions", "suite_leads", "tracking_gap_count"]),
      smartdesk: safePrimitiveMap(connectors.smartdesk, ["configured", "connected", "operational_ready", "state", "scope_status"]),
      core: safePrimitiveMap(connectors.core, ["configured", "scope_match", "scope_status", "state"]),
      nyra: safePrimitiveMap(connectors.nyra, ["configured", "scope_status", "state"]),
    },
    source_presence: safePrimitiveMap(source.source_presence, COCKPIT_SOURCE_IDS),
    module_coverage: sanitizeModuleCoverage(source),
    branches: sanitizeBranchSummary(source.branches),
    attention_codes: uniqueCodes(source.attention_codes || source.attention, 50),
    privacy: {
      aggregate_only: true,
      raw_customer_records_stored: false,
      personal_data_payload: false,
      secrets_stored: false,
    },
    guardrails: {
      read_only: true,
      execution_allowed: false,
      owner_confirmation_required: true,
      tenant_scoped: true,
    },
  };
  sanitized.revision_hash = revisionHash(sanitized);
  return sanitized;
}

export function sanitizeSuiteNodeSnapshot(payload = {}, receivedAt = new Date().toISOString()) {
  const summary = safePrimitiveMap(payload.summary, [
    "plugin_version", "runtime_mode", "topology", "control_plane_state", "core_effective_mode", "core_bridge_state",
    "core_nira_bridge_ready", "manuals_tracked", "tenant_policy_surface_ready", "mcp_connectors_declared",
    "ai_control_tower_score", "agent_actions_observed", "context_freshness_score", "change_impact_required_actions",
    "active_licenses", "recent_evidence_events", "update_readiness", "marketing_journeys_ready",
    "marketing_approval_queue", "commerce_snapshot_ready", "commerce_snapshot_contacts", "commerce_snapshot_products",
  ]);
  const controlPlane = asObject(payload.control_plane);
  const validation = asObject(payload.validation);
  const coreBridge = asObject(payload.core_control_plane_bridge);
  const tenantPolicy = asObject(payload.tenant_policy_surface);
  const entitlement = asObject(tenantPolicy.entitlement);
  const mcpMap = asObject(payload.enterprise_mcp_gateway_map);
  const controlScore = asObject(payload.ai_control_tower_score);
  const observability = asObject(payload.agent_action_observability);
  const freshness = asObject(payload.context_freshness_monitor);
  const changeImpact = asObject(payload.change_impact_orchestration);
  const journey = asObject(payload.marketing_journey_builder);
  const commerce = asObject(payload.commerce_snapshot);
  const commerceSummary = asObject(commerce.summary);
  const tenantId = safeCode(payload.tenant_id || tenantPolicy.tenant?.tenant_id, "tenant");
  const nodeId = safeCode(payload.node_id || payload.cockpit_360_summary?.scope?.node_id, "node");
  const rawCockpit = asObject(payload.cockpit_360_summary || payload.cockpit_360);
  const hasObject = (key) => Object.prototype.hasOwnProperty.call(payload, key)
    && payload[key] && typeof payload[key] === "object";
  const derivedPresence = {
    customer_360_summary: Object.prototype.hasOwnProperty.call(rawCockpit, "customer"),
    journey_summary: hasObject("marketing_journey_builder"),
    consent_readiness: Object.prototype.hasOwnProperty.call(asObject(rawCockpit.customer), "consent_missing_count"),
    commerce_summary: hasObject("commerce_snapshot"),
    crm_freshness: hasObject("context_freshness_monitor"),
    settlement_summary: Object.prototype.hasOwnProperty.call(asObject(rawCockpit.commerce), "manual_settlement_rows"),
    commerce_inventory: hasObject("commerce_snapshot"),
    registry_summary: Object.prototype.hasOwnProperty.call(rawCockpit, "registry"),
    technology_inventory: hasObject("commerce_snapshot"),
    technology_summary: Object.prototype.hasOwnProperty.call(asObject(rawCockpit.registry), "technology_items"),
    commerce_totals: hasObject("commerce_snapshot"),
    margin_summary: Object.prototype.hasOwnProperty.call(asObject(rawCockpit.commerce), "margin_net"),
    official_list_status: Object.prototype.hasOwnProperty.call(asObject(rawCockpit.governance?.pricing), "missing_official_price_count"),
    claim_guard: Object.prototype.hasOwnProperty.call(asObject(rawCockpit.governance), "claims"),
    content_freshness: hasObject("context_freshness_monitor"),
    tenant_policy: hasObject("tenant_policy_surface"),
    license_summary: Object.prototype.hasOwnProperty.call(rawCockpit, "license"),
    core_scope: hasObject("core_control_plane_bridge"),
    usage_summary: hasObject("agent_action_observability"),
    validation: hasObject("validation"),
    change_impact: hasObject("change_impact_orchestration"),
    evidence_summary: hasObject("agent_action_observability") || Object.prototype.hasOwnProperty.call(asObject(payload.summary), "recent_evidence_events"),
    visual_summary: Object.prototype.hasOwnProperty.call(rawCockpit, "content"),
    claim_summary: Object.prototype.hasOwnProperty.call(asObject(rawCockpit.governance), "claims"),
  };
  const sourcePresence = {
    ...derivedPresence,
    ...safePrimitiveMap(rawCockpit.source_presence, COCKPIT_SOURCE_IDS),
  };

  return {
    schema_version: "suite_node_snapshot_v2",
    received_at: safeIso(receivedAt, new Date().toISOString()),
    summary,
    control_plane: {
      state: safeCode(controlPlane.state || "unknown"),
      core_bridge_ready: safeBoolean(controlPlane.core_bridge_ready),
      runbook_receiver_ready: safeBoolean(controlPlane.runbook_receiver_ready),
      evidence_receiver_ready: safeBoolean(controlPlane.evidence_receiver_ready),
      automatic_remote_execution_enabled: false,
      action_queue: safeCounts(controlPlane.action_queue, ["allow", "confirm", "sandbox", "block", "rollback_required"]),
    },
    validation: {
      core_configured: safeBoolean(validation.core_configured),
      core_control_plane_bridge_ready: safeBoolean(validation.core_control_plane_bridge_ready),
      nira_core_bridge_endpoint_declared: safeBoolean(validation.nira_core_bridge_endpoint_declared),
      license_registry_ready: safeBoolean(validation.license_registry_ready),
      manifest_integrity_ready: safeBoolean(validation.manifest_integrity_ready),
      local_fallback_required: validation.local_fallback_required !== false,
      critical_issues: uniqueCodes(validation.critical_issues, 30),
    },
    core_control_plane_bridge: {
      state: safeCode(coreBridge.state || "unknown"),
      tenant: safePrimitiveMap(coreBridge.tenant, ["tenant_id", "brand_scope", "environment", "scope_status"]),
      core_runtime: safePrimitiveMap(coreBridge.core_runtime, ["configured", "remote_configured", "scope_match", "scope_status", "state"]),
      render_runtime: safePrimitiveMap(coreBridge.render_runtime, ["configured", "persistent", "state", "topology"]),
      branch_families: uniqueCodes(coreBridge.branch_families, 30),
      guardrails: safePrimitiveMap(coreBridge.guardrails, ["read_only", "no_auto_execute", "owner_confirmation_required", "tenant_scoped"]),
    },
    tenant_policy_surface: {
      schema_version: safeCode(tenantPolicy.schema_version || "suite_tenant_policy_surface_v1"),
      mode: safeCode(tenantPolicy.mode || "read_only_policy_surface"),
      tenant: safePrimitiveMap(tenantPolicy.tenant, ["tenant_id", "brand_scope", "environment", "plan", "scope_status"]),
      entitlement: {
        plan: safeCode(entitlement.plan || "unknown"),
        modules: uniqueCodes(entitlement.modules, 80),
        locked_modules: uniqueCodes(entitlement.locked_modules, 80),
        limits: safeCounts(entitlement.limits || tenantPolicy.limits, ["smartdesk_seats", "wordpress_nodes", "monthly_core_calls", "codex_automation_runs"]),
      },
      branch_groups: uniqueCodes(tenantPolicy.branch_groups, 40),
      action_policy: safePrimitiveMap(tenantPolicy.action_policy, ["default_state", "soft_gate", "hard_block", "owner_confirmation_required"]),
      key_policy: safePrimitiveMap(tenantPolicy.key_policy, ["scoped", "expires", "rotation_required", "tenant_bound", "brand_bound"]),
    },
    enterprise_mcp_gateway_map: {
      schema_version: safeCode(mcpMap.schema_version || "suite_enterprise_mcp_gateway_map_v1"),
      mode: safeCode(mcpMap.mode || "read_only_connector_governance_map"),
      connectors: safeConnectorList(mcpMap.connectors),
      agent_roles: uniqueCodes((Array.isArray(mcpMap.agent_roles) ? mcpMap.agent_roles : []).map((item) => item?.id || item?.key || item), 30),
      default_policy: safePrimitiveMap(mcpMap.default_policy, ["read_only", "owner_confirmation_required", "core_required", "tenant_scoped"]),
    },
    ai_control_tower_score: {
      schema_version: safeCode(controlScore.schema_version || "suite_ai_control_tower_score_v1"),
      mode: safeCode(controlScore.mode || "read_only_enterprise_scorecard"),
      score: safeNumber(controlScore.score, 0, 0, 100),
      level: safeCode(controlScore.level || "unknown"),
      automation_posture: safeCode(controlScore.automation_posture || "manual_confirm_only"),
      dimensions: safeDimensionList(controlScore.dimensions),
      attention: uniqueCodes(controlScore.attention, 50),
    },
    agent_action_observability: {
      schema_version: safeCode(observability.schema_version || "suite_agent_action_observability_v1"),
      mode: safeCode(observability.mode || "read_only_agent_action_timeline"),
      summary: safeCounts(observability.summary, ["events_total", "connectors_declared", "blocked_total", "rollback_declared_total", "owner_confirmed_total"]),
      timeline: safeTimeline(observability.timeline),
      policy: safePrimitiveMap(observability.policy, ["read_only", "append_only", "tenant_scoped", "no_secret_values"]),
    },
    context_freshness_monitor: {
      schema_version: safeCode(freshness.schema_version || "suite_context_freshness_monitor_v1"),
      mode: safeCode(freshness.mode || "read_only_freshness_monitor"),
      score: safeNumber(freshness.score, 0, 0, 100),
      level: safeCode(freshness.level || "unknown"),
      decision_mode: safeCode(freshness.decision_mode || "refresh_before_decision"),
      sources: safeFreshnessSources(freshness.sources),
      attention: uniqueCodes(freshness.attention, 50),
    },
    change_impact_orchestration: Object.keys(changeImpact).length ? {
      schema_version: safeCode(changeImpact.schema_version || "suite_change_impact_orchestration_v1"),
      mode: safeCode(changeImpact.mode || "read_only_change_impact_contract"),
      core_branch: safeCode(changeImpact.core_branch || "change_impact_orchestration"),
      enabled: changeImpact.enabled !== false,
      surfaces: uniqueCodes(changeImpact.surfaces, 40),
      required_actions: uniqueCodes(changeImpact.required_actions, 60),
      tests_required: uniqueCodes(changeImpact.tests_required, 60),
      blocked_until: uniqueCodes(changeImpact.blocked_until, 30),
    } : null,
    marketing_journey_builder: {
      schema_version: safeCode(journey.schema_version || "suite_marketing_journey_builder_v1"),
      mode: safeCode(journey.mode || "draft_approve_only"),
      core_branch_group: safeCode(journey.core_branch_group || "marketing_intelligence"),
      signals_count: Array.isArray(journey.signals) ? journey.signals.length : safeNumber(journey.signals_count),
      journeys_count: Array.isArray(journey.journeys) ? journey.journeys.length : safeNumber(journey.journeys_count),
      approval_queue_count: Array.isArray(journey.approval_queue) ? journey.approval_queue.length : safeNumber(journey.approval_queue_count),
      execution_policy: {
        no_auto_send: true,
        execution_allowed: false,
        owner_confirmation_required: true,
      },
    },
    commerce_snapshot: {
      schema_version: safeCode(commerce.schema_version || "suite_commerce_snapshot_v1"),
      summary: safeCounts(commerceSummary, [
        "crm_contacts", "crm_companies", "product_items", "technology_items", "orders_count", "order_value",
        "open_leads", "active_licenses", "crm_erp_lite_orders", "crm_erp_lite_revenue_net",
        "crm_erp_lite_margin_net", "crm_erp_lite_owner_required",
      ]),
      sections: safeDimensionList(commerce.sections, 30),
      privacy: { aggregate_only: true, raw_customer_records_stored: false, personal_data_payload: false },
    },
    source_presence: sourcePresence,
    cockpit_360_summary: sanitizeCockpit360Summary({ ...rawCockpit, source_presence: sourcePresence }, { tenantId, nodeId }),
  };
}

function branchHintMap(cockpit) {
  return new Map((Array.isArray(cockpit?.branches) ? cockpit.branches : []).map((item) => [item.key, item]));
}

function stateWeight(state) {
  return ({ blocked: 4, insufficient_data: 3, attention: 2, ready: 1, unknown: 0 })[state] || 0;
}

function evidenceAvailability(id, context) {
  const { tenant, node, snapshot, cockpit, coreStatus, nyraStatus, serviceReadiness } = context;
  const siteEvents = asObject(tenant?.site_events);
  const commerce = asObject(tenant?.commerce);
  const serverAuthoritative = {
    node_freshness: Boolean(node?.latest_heartbeat),
    node_readiness: Boolean(node?.readiness),
    service_readiness: serviceReadiness?.ready === true,
    core_scope: coreStatus?.scope_status === "scoped" || coreStatus?.scope_match === true,
    nyra_scope: nyraStatus?.scope_status === "scoped",
  };
  if (Object.prototype.hasOwnProperty.call(serverAuthoritative, id)) return serverAuthoritative[id] === true;
  if (Object.prototype.hasOwnProperty.call(asObject(cockpit.source_presence), id)) {
    return cockpit.source_presence[id] === true;
  }
  const mapping = {
    site_event_summary: safeNumber(siteEvents.total_events || siteEvents.events_total) > 0,
    google_connector: cockpit.connectors?.google?.configured === true,
    google_funnel: Object.values(asObject(cockpit.connectors?.google_funnel)).some((value) => Number(value) > 0),
    suite_events: safeNumber(siteEvents.total_events || siteEvents.events_total) > 0,
    customer_360_summary: cockpit.customer?.profiles_visible > 0 || cockpit.customer?.crm_contacts > 0,
    journey_summary: snapshot?.marketing_journey_builder?.schema_version === "suite_marketing_journey_builder_v1",
    consent_readiness: Number.isFinite(Number(cockpit.customer?.consent_missing_count)),
    commerce_summary: safeNumber(commerce.totals?.snapshots) > 0,
    crm_freshness: Boolean(snapshot?.context_freshness_monitor?.schema_version),
    checkout_events: safeNumber(siteEvents.by_event_type?.checkout || siteEvents.by_event_type?.checkout_completed) > 0,
    settlement_summary: Number.isFinite(Number(cockpit.commerce?.manual_settlement_rows)),
    commerce_inventory: Boolean(commerce.latest) || Object.keys(asObject(snapshot?.commerce_snapshot?.summary)).length > 0,
    registry_summary: cockpit.registry?.product_items > 0 || cockpit.registry?.technology_items > 0,
    technology_inventory: cockpit.registry?.technology_items > 0 || Boolean(snapshot?.commerce_snapshot?.schema_version),
    technology_summary: Number.isFinite(Number(cockpit.registry?.technology_items)),
    commerce_totals: safeNumber(commerce.totals?.snapshots) > 0,
    margin_summary: Number.isFinite(Number(cockpit.commerce?.margin_net)),
    official_list_status: Number.isFinite(Number(cockpit.governance?.pricing?.missing_official_price_count)),
    claim_guard: Number.isFinite(Number(cockpit.governance?.claims?.issues_total)),
    content_freshness: Boolean(snapshot?.context_freshness_monitor?.schema_version),
    tenant_policy: Boolean(snapshot?.tenant_policy_surface?.schema_version),
    license_summary: Number.isFinite(Number(cockpit.license?.active_licenses)),
    usage_summary: Number.isFinite(Number(cockpit.operations?.events_total)),
    validation: Boolean(snapshot?.validation),
    change_impact: Boolean(snapshot?.change_impact_orchestration),
    evidence_summary: Boolean(tenant?.evidence),
    visual_summary: Number.isFinite(Number(cockpit.content?.desktop_review_missing)),
    analytics_summary: safeNumber(siteEvents.total_events || siteEvents.events_total) > 0,
    claim_summary: Number.isFinite(Number(cockpit.governance?.claims?.issues_total)),
  };
  return mapping[id] === true;
}

function evidenceAgeSeconds(id, context) {
  const { tenant, node, snapshot } = context;
  const siteEvents = asObject(tenant?.site_events);
  const commerce = asObject(tenant?.commerce);
  const runtimeIds = new Set(["core_scope", "nyra_scope", "service_readiness", "node_readiness"]);
  if (runtimeIds.has(id)) return 0;
  const timestamp = id === "node_freshness"
    ? node?.latest_heartbeat?.received_at
    : ["site_event_summary", "suite_events", "checkout_events", "analytics_summary"].includes(id)
      ? siteEvents.generated_at
      : ["commerce_summary", "commerce_inventory", "commerce_totals"].includes(id)
        ? commerce.latest?.received_at || commerce.generated_at
        : snapshot?.received_at;
  const parsed = Date.parse(String(timestamp || ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.round((Date.now() - parsed) / 1000)) : null;
}

function derivedAttentionCount(branchKey, cockpit, node, snapshot) {
  const customer = cockpit.customer || {};
  const commerce = cockpit.commerce || {};
  const registry = cockpit.registry || {};
  const license = cockpit.license || {};
  const operations = cockpit.operations || {};
  const content = cockpit.content || {};
  const claims = cockpit.governance?.claims || {};
  const pricing = cockpit.governance?.pricing || {};
  const counts = {
    analytics_insight: cockpit.connectors?.google_funnel?.tracking_gap_count || 0,
    google_ads_ga4: cockpit.connectors?.google_funnel?.tracking_gap_count || 0,
    marketing_recall: (customer.manual_review_profiles || 0) + (snapshot?.marketing_journey_builder?.approval_queue_count || 0),
    crm_sales: (customer.high_priority_profiles || 0) + (customer.manual_review_profiles || 0),
    commerce_checkout: (commerce.manual_settlement_rows || 0) + (commerce.fulfillment_attention_count || 0),
    product_registry: (registry.low_stock_items || 0) + (registry.missing_price_count || 0) + (registry.missing_sku_count || 0),
    technology_registry: (registry.missing_cost_count || 0) + (registry.missing_sale_mode_count || 0) + (registry.claim_attention_count || 0),
    pricing_margin: (pricing.missing_official_price_count || 0) + (pricing.below_cost_count || 0) + (pricing.negative_margin_count || 0),
    claim_content: (claims.issues_total || 0) + (claims.review_required_count || 0),
    license_waas: (license.expiring_licenses || 0) + (license.grace_period_count || 0) + (license.domain_mismatch_count || 0),
    customer_success: (operations.onboarding_attention_count || 0) + (operations.inactive_nodes || 0) + (operations.support_open_count || 0),
    render_operations: node?.readiness?.missing?.length || 0,
    support_risk: (snapshot?.validation?.critical_issues?.length || 0) + (operations.blocked_actions || 0),
    visual_content: (content.desktop_review_missing || 0) + (content.mobile_review_missing || 0) + (content.cta_visibility_attention || 0),
  };
  return safeNumber(counts[branchKey]);
}

function derivedBlockingCount(branchKey, cockpit, node, snapshot, coreStatus, nyraStatus) {
  if (branchKey === "render_operations") {
    return [node?.status !== "online", coreStatus?.scope_status !== "scoped" && coreStatus?.scope_match !== true, nyraStatus?.scope_status !== "scoped"]
      .filter(Boolean).length;
  }
  if (branchKey === "support_risk") return snapshot?.validation?.critical_issues?.length || 0;
  if (branchKey === "claim_content") return cockpit.governance?.claims?.blocker_count || 0;
  if (branchKey === "pricing_margin") return (cockpit.governance?.pricing?.below_cost_count || 0) + (cockpit.governance?.pricing?.negative_margin_count || 0);
  if (branchKey === "license_waas") return cockpit.license?.domain_mismatch_count || 0;
  if (branchKey === "marketing_recall") return cockpit.customer?.consent_missing_count || 0;
  return 0;
}

export function buildCockpit360Summary({ tenantDashboard = {}, node = null, architecture = {}, coreStatus = {}, nyraStatus = {}, serviceReadiness = {} } = {}) {
  const snapshot = node?.latest_snapshot || {};
  const supplied = sanitizeCockpit360Summary(snapshot.cockpit_360_summary || {}, {
    tenantId: tenantDashboard.tenant_id || node?.tenant_id,
    nodeId: node?.node_id,
  });
  const hints = branchHintMap(supplied);
  const context = { tenant: tenantDashboard, node, snapshot, cockpit: supplied, coreStatus, nyraStatus, serviceReadiness };
  const branches = (Array.isArray(architecture.branches) ? architecture.branches : []).map((contract) => {
    const required = contract.evidence_sources.filter((source) => source.required === true);
    const staleAfterSeconds = safeNumber(
      contract.decision_rules?.thresholds?.stale_after_seconds,
      safeNumber(contract.freshness_sla_seconds, 900, 60),
      60,
    );
    const minimumEvidenceRatio = safeNumber(contract.decision_rules?.thresholds?.minimum_evidence_ratio, 1, 0, 1);
    const evidence = contract.evidence_sources.map((source) => {
      const available = evidenceAvailability(source.id, context);
      const ageSeconds = available ? evidenceAgeSeconds(source.id, context) : null;
      const stale = available && ageSeconds !== null && ageSeconds > staleAfterSeconds;
      return {
        id: source.id,
        required: source.required === true,
        available,
        age_seconds: ageSeconds,
        stale,
        aggregate_only: source.aggregate_only !== false,
      };
    });
    const missing = evidence.filter((item) => item.required && (!item.available || item.stale))
      .map((item) => item.stale ? `stale_${item.id}` : item.id);
    const requiredPresent = evidence.filter((item) => item.required && item.available && !item.stale).length;
    const evidenceRatio = required.length ? requiredPresent / required.length : 1;
    const hint = hints.get(contract.key) || {};
    const staleCount = evidence.filter((item) => item.stale).length;
    const attentionCount = Math.max(derivedAttentionCount(contract.key, supplied, node, snapshot), safeNumber(hint.attention_count), staleCount);
    const blockingCount = Math.max(derivedBlockingCount(contract.key, supplied, node, snapshot, coreStatus, nyraStatus), safeNumber(hint.blocking_count));
    let state = "ready";
    if (blockingCount > 0 || hint.state === "blocked") state = "blocked";
    else if (evidenceRatio < minimumEvidenceRatio || hint.state === "insufficient_data") state = "insufficient_data";
    else if (missing.length || attentionCount > 0 || hint.state === "attention") state = "attention";
    const primaryReason = blockingCount
      ? safeCode(hint.primary_reason || `${contract.key}_blocking_evidence`)
      : missing.length
        ? `missing_${missing[0]}`
        : attentionCount
          ? safeCode(hint.primary_reason || `${contract.key}_attention_evidence`)
          : "required_evidence_ready";
    return {
      key: contract.key,
      label: contract.label,
      state,
      confidence: Number(evidenceRatio.toFixed(2)),
      evidence,
      missing_evidence: missing,
      minimum_evidence_ratio: minimumEvidenceRatio,
      attention_count: attentionCount,
      blocking_count: blockingCount,
      primary_reason: primaryReason,
      dependencies: {
        hard: [...(contract.dependencies?.hard || [])],
        soft: [...(contract.dependencies?.soft || [])],
      },
      core_branch_bindings: [...(contract.core_branch_bindings || [])],
      nyra_branch_bindings: [...(contract.nyra_branch_bindings || [])],
      freshness_sla_seconds: staleAfterSeconds,
      recommendation: {
        action: safeCode(hint.top_action || contract.failure_fallback?.action || "review_branch"),
        runbook_id: safeCode(contract.runbooks?.[0] || "customer_report"),
        mode: "proposal_only",
        execution_allowed: false,
        owner_confirmation_required: true,
      },
      explainability: [...(contract.explainability || [])],
    };
  });
  const byKey = new Map(branches.map((branch) => [branch.key, branch]));
  for (let pass = 0; pass < branches.length; pass += 1) {
    let changed = false;
    for (const branch of branches) {
      const hardDependencies = branch.dependencies.hard.map((key) => byKey.get(key)).filter(Boolean);
      const blockedDependency = hardDependencies.find((dependency) => dependency.state === "blocked");
      const missingDependency = hardDependencies.find((dependency) => dependency.state === "insufficient_data");
      if (blockedDependency && branch.state !== "blocked") {
        branch.state = "blocked";
        branch.primary_reason = `dependency_blocked_${blockedDependency.key}`;
        branch.blocking_count += 1;
        changed = true;
      } else if (missingDependency && ["ready", "attention"].includes(branch.state)) {
        branch.state = "insufficient_data";
        branch.primary_reason = `dependency_insufficient_${missingDependency.key}`;
        if (!branch.missing_evidence.includes(`dependency:${missingDependency.key}`)) {
          branch.missing_evidence.push(`dependency:${missingDependency.key}`);
        }
        changed = true;
      }
      branch.dependency_resolution = {
        blocked: hardDependencies.filter((dependency) => dependency.state === "blocked").map((dependency) => dependency.key),
        insufficient_data: hardDependencies.filter((dependency) => dependency.state === "insufficient_data").map((dependency) => dependency.key),
        satisfied: hardDependencies.filter((dependency) => ["ready", "attention"].includes(dependency.state)).map((dependency) => dependency.key),
      };
    }
    if (!changed) break;
  }

  const conflicts = [];
  const addConflict = (id, winner, affected, resolution) => {
    const affectedBranches = affected.filter((key) => byKey.has(key) && key !== winner);
    if (!affectedBranches.length) return;
    conflicts.push({
      id,
      winner_branch: winner,
      affected_branches: affectedBranches,
      affected_states: Object.fromEntries(affectedBranches.map((key) => [key, byKey.get(key).state])),
      resolution,
      execution_allowed: false,
    });
  };
  if (byKey.get("render_operations")?.state === "blocked") {
    addConflict("tenant_or_runtime_safety_precedence", "render_operations", branches.map((branch) => branch.key).filter((key) => key !== "render_operations"), "runtime_and_tenant_scope_block_downstream_actionability");
  }
  if (byKey.get("support_risk")?.state === "blocked") {
    addConflict("support_safety_precedence", "support_risk", ["visual_content", "commerce_checkout", "marketing_recall", "license_waas"], "critical_verified_risk_precedes_product_or_growth_action");
  }
  if (byKey.get("claim_content")?.state === "blocked") {
    addConflict("claim_precedence", "claim_content", ["visual_content", "marketing_recall", "technology_registry", "google_ads_ga4"], "claim_block_precedes_content_campaign_or_technology_recommendation");
  }
  if (byKey.get("pricing_margin")?.state === "blocked") {
    addConflict("pricing_precedence", "pricing_margin", ["commerce_checkout", "crm_sales", "marketing_recall"], "pricing_block_precedes_commerce_sales_or_offer_recommendation");
  }
  if (byKey.get("license_waas")?.state === "blocked") {
    addConflict("license_precedence", "license_waas", branches.map((branch) => branch.key).filter((key) => !["license_waas", "render_operations", "support_risk"].includes(key)), "license_and_entitlement_block_precedes_module_actionability");
  }
  const priorities = branches
    .filter((branch) => branch.state !== "ready")
    .sort((left, right) => stateWeight(right.state) - stateWeight(left.state)
      || right.blocking_count - left.blocking_count
      || right.missing_evidence.length - left.missing_evidence.length
      || right.attention_count - left.attention_count)
    .slice(0, 10)
    .map((branch, index) => ({
      rank: index + 1,
      branch_key: branch.key,
      state: branch.state,
      reason: branch.primary_reason,
      action: branch.recommendation.action,
      runbook_id: branch.recommendation.runbook_id,
      execution_allowed: false,
    }));
  const stateCounts = Object.fromEntries(["ready", "attention", "blocked", "insufficient_data"].map((state) => [state, branches.filter((branch) => branch.state === state).length]));
  const nodeHeartbeatAt = safeIso(node?.latest_heartbeat?.received_at);
  const nodeSnapshotAt = safeIso(snapshot.received_at);
  const freshnessAgeSeconds = nodeHeartbeatAt ? Math.max(0, Math.round((Date.now() - Date.parse(nodeHeartbeatAt)) / 1000)) : null;

  const result = {
    ok: true,
    schema_version: "cockpit_360_summary_v1",
    generated_at: new Date().toISOString(),
    scope: {
      tenant_id: safeCode(tenantDashboard.tenant_id || node?.tenant_id, "tenant"),
      node_id: safeCode(node?.node_id, "node"),
    },
    mode: "read_only_advisory",
    source: {
      wordpress_snapshot: nodeSnapshotAt ? "suite_node_snapshot_v2" : "missing",
      branch_architecture: architecture.schema || "unavailable",
      core: coreStatus.scope_status === "scoped" || coreStatus.scope_match === true ? "scoped" : "unavailable",
      nyra: nyraStatus.scope_status === "scoped" ? "scoped" : "unavailable",
    },
    freshness: {
      node_status: node?.status || "missing",
      heartbeat_fresh: node?.heartbeat_fresh === true,
      latest_heartbeat_at: nodeHeartbeatAt,
      latest_snapshot_at: nodeSnapshotAt,
      heartbeat_age_seconds: freshnessAgeSeconds,
    },
    summary: {
      branches_total: branches.length,
      ...stateCounts,
      priorities_total: priorities.length,
      tenant_readiness_status: safeCode(tenantDashboard.readiness_status || "unknown"),
      tenant_readiness_score: safeNumber(tenantDashboard.readiness_summary?.average_score, 0, 0, 100),
      customer: supplied.customer,
      commerce: supplied.commerce,
      registry: supplied.registry,
      license: supplied.license,
      operations: supplied.operations,
      content: supplied.content,
      governance: supplied.governance,
      module_coverage: supplied.module_coverage,
    },
    module_coverage: supplied.module_coverage,
    branches,
    priorities,
    conflicts,
    guardrails: {
      tenant_scoped: true,
      aggregate_only: true,
      raw_customer_records_stored: false,
      read_only: true,
      execution_allowed: false,
      owner_confirmation_required: true,
      core_required_for_sensitive_actions: true,
      proposal_queue_is_not_execution: true,
    },
  };
  result.revision_hash = revisionHash(result);
  return result;
}

export function buildNyraDecisionPreviewPayload({ body = {}, tenantId, cockpit, architecture, selectedBranches = [] } = {}) {
  const selected = selectedBranches.length
    ? selectedBranches
    : cockpit.priorities.map((item) => item.branch_key).slice(0, 6);
  const selectedSet = new Set(selected);
  const branchContracts = (Array.isArray(architecture?.branches) ? architecture.branches : [])
    .filter((branch) => selectedSet.has(branch.key))
    .map((branch) => ({
      key: branch.key,
      purpose: branch.purpose,
      evidence_sources: branch.evidence_sources,
      signals: branch.signals,
      dependencies: branch.dependencies,
      decision_rules: branch.decision_rules,
      outputs: branch.outputs,
      runbooks: branch.runbooks,
      freshness_sla_seconds: branch.freshness_sla_seconds,
      privacy: branch.privacy,
      guardrails: branch.guardrails,
      failure_fallback: branch.failure_fallback,
      explainability: branch.explainability,
      core_branch_bindings: branch.core_branch_bindings,
      nyra_branch_bindings: branch.nyra_branch_bindings,
    }));
  return {
    request_id: safeCode(body.request_id || `suite_preview_${Date.now()}`),
    tenant_id: safeCode(tenantId, "tenant"),
    text: safeText(body.text || body.question || "Leggi il Cockpit Suite e spiega la prossima azione verificabile.", 1200),
    target_system: "suite",
    branches: selected,
    current_state: safeCode(body.current_state || "cockpit_review"),
    next_action: safeCode(body.next_action || "rank_verified_attention"),
    context: {
      source: "suite_control_plane",
      hydrated_server_side: true,
      no_auto_execute: true,
      cockpit_360: cockpit,
      branch_contracts: branchContracts,
      requested_context: safePrimitiveMap(body.context, ["locale", "audience", "workflow", "objective"]),
    },
  };
}

export const cockpitSanitizers = Object.freeze({ safeCode, safeText, safeIso, safeNumber, uniqueCodes });

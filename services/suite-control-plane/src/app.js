import express from "express";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateGovernanceRequest } = require("../../../scripts/lib/suite_core_codex_governance.js");

const SERVICE_VERSION = "0.1.6-commerce-snapshot-ready";
const DEFAULT_MAX_EVENTS_PER_NODE = 250;
const RUNTIME_REQUIRED_JOB_FIELDS = [
  "job_id",
  "correlation_id",
  "tenant_id",
  "actor",
  "owner_module",
  "action_type",
  "target",
  "risk_band",
  "readiness",
  "core_gate_report",
  "created_at",
  "status",
];
const RUNTIME_JOB_STATES = new Set(["queued", "running", "review_required", "blocked", "done", "failed", "rolled_back"]);
const RUNTIME_RISK_BANDS = new Set(["low", "medium", "high", "blocked"]);
const RUNTIME_READINESS_STATES = new Set(["draft", "ready", "review_required", "blocked", "published"]);
const COMMERCE_CONTROL_ROOM_REQUIRED_SECTIONS = [
  "woocommerce_checkout",
  "commerce_policy",
  "b2b_orders",
  "product_catalog",
  "price_guard",
  "claim_guard",
  "settlements",
  "waas_commercial",
  "smartdesk_bridge",
  "core_connector",
];
const COMMERCE_CONTROL_ROOM_PACKAGE_BLOCKS = [
  {
    id: "base",
    label: "Base",
    blocks: ["product_cards", "lead_quote_request", "basic_claim_price_scan"],
    rule: "Mostra e raccoglie richieste, senza automazioni commerce.",
  },
  {
    id: "silver",
    label: "Silver",
    blocks: ["catalog_policy", "b2b_crm", "manual_settlement", "basic_reports"],
    rule: "Vede e governa il flusso operativo senza AI decisionale avanzata.",
  },
  {
    id: "gold",
    label: "Gold",
    blocks: ["core_assisted_review", "smartdesk_bridge", "operative_price_guard", "actions_to_approve"],
    rule: "Il sistema suggerisce priorita e azioni, ma l owner conferma.",
  },
  {
    id: "network",
    label: "Network / Enterprise",
    blocks: ["multi_tenant", "distributors", "franchise", "dedicated_render", "advanced_audit"],
    rule: "Separazione infrastrutturale per clienti con molti nodi o vincoli propri.",
  },
];
const SUITE_RUNTIME_WORDPRESS_KEEPS = [
  { area: "ui_suite", label: "UI Suite", rule: "WordPress resta pannello cliente, contenuti e WooCommerce." },
  { area: "template_registry", label: "Template, tecnologie e card", rule: "Dati runtime modificabili e persistenti nel sito; esportabili in JSON." },
  { area: "crm_inventory_base", label: "CRM e magazzino base", rule: "Restano in WP finche manuali e leggeri; Render legge snapshot/eventi." },
  { area: "checkout", label: "WooCommerce / checkout", rule: "Pagamento e ordine restano nel sito; Render non cattura pagamenti." },
];
const SUITE_RUNTIME_RENDER_MOVES = [
  { area: "analytics_funnel", label: "Analytics WaaS e funnel", priority: "first", rule: "Sessioni, eventi, Ads, conversioni e report crescono fuori dal plugin." },
  { area: "event_spine", label: "Event Spine", priority: "first", rule: "Page view, click, CTA, form, carrello e checkout diventano eventi tenant-scoped." },
  { area: "core_insight", label: "Core Insight e report", priority: "first", rule: "Diagnosi e azioni consigliate devono essere auditabili e non pesare su WordPress." },
  { area: "google_sync", label: "Google Ads / GA4 sync", priority: "first", rule: "Token, refresh e letture periodiche vivono su Render." },
  { area: "crm_inventory_scoring", label: "CRM/magazzino scoring", priority: "later", rule: "Si sposta quando servono storico, AI, multi-sede o Smart Desk condiviso." },
];
const GOOGLE_CONNECTOR_SCOPES = [
  "google_ads.readonly",
  "analytics.readonly",
];
const GOOGLE_CONNECTOR_REQUIRED_PROVIDER_FIELDS = [
  "client_id",
  "client_secret",
  "developer_token",
  "redirect_uri",
];
const GOOGLE_CONNECTOR_REQUIRED_TENANT_FIELDS = [
  "tenant_id",
  "google_user_authorized",
  "ads_customer_id",
  "ga4_property_id",
];
const GOVERNANCE_SENSITIVE_ACTIONS = new Set([
  "deploy",
  "release",
  "publish",
  "update",
  "write_production",
  "rollback",
  "migration",
  "pricing",
  "claim_validation",
  "payment",
  "customer_data",
  "tenant_scope_change",
  "cross_tenant",
  "codex_automation",
]);

function nowIso() {
  return new Date().toISOString();
}

function readSecret(req) {
  const auth = req.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.get("x-sh-suite-key") || req.get("x-api-key") || "";
}

function publicError(res, status, code, message = code) {
  return res.status(status).json({ ok: false, error: code, message });
}

function sanitizeId(value, fallbackPrefix) {
  const raw = String(value || "").trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
  return cleaned || `${fallbackPrefix}_${crypto.randomUUID()}`;
}

function maskSecret(value) {
  const secret = String(value || "").trim();
  if (!secret) return "";
  if (secret.length <= 8) return "***";
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function extractActionType(input = {}) {
  return String(
    input.action_type ||
    input.type ||
    input.action?.action_type ||
    input.action?.type ||
    input.metadata?.action_type ||
    "",
  ).trim();
}

function isGovernanceSensitiveAction(input = {}) {
  const actionType = extractActionType(input);
  return GOVERNANCE_SENSITIVE_ACTIONS.has(actionType) || Boolean(input.sensitive_action || input.action?.sensitive_action);
}

function validateSuiteGovernanceManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {
      schema: "suite_control_plane_governance_validation_v1",
      allowed: false,
      status: "block",
      errors: [{ code: "missing_governance_manifest", field: "governance_manifest" }],
      warnings: [],
    };
  }

  return {
    schema: "suite_control_plane_governance_validation_v1",
    ...validateGovernanceRequest(manifest),
  };
}

function hasRuntimeValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function validateEnterpriseRuntimeContract(contract) {
  const errors = [];
  const warnings = [];
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return {
      schema: "suite_control_plane_enterprise_runtime_validation_v1",
      allowed: false,
      status: "block",
      errors: [{ code: "missing_enterprise_runtime_contract", field: "runtime_contract" }],
      warnings,
    };
  }

  const job = contract.job || {};
  for (const field of RUNTIME_REQUIRED_JOB_FIELDS) {
    if (!hasRuntimeValue(job[field])) {
      errors.push({ code: "runtime_job_missing_required_field", field: `job.${field}` });
    }
  }
  if (hasRuntimeValue(job.status) && !RUNTIME_JOB_STATES.has(String(job.status))) {
    errors.push({ code: "runtime_job_invalid_status", field: "job.status" });
  }
  if (hasRuntimeValue(job.risk_band) && !RUNTIME_RISK_BANDS.has(String(job.risk_band))) {
    errors.push({ code: "runtime_job_invalid_risk_band", field: "job.risk_band" });
  }
  if (hasRuntimeValue(job.readiness) && !RUNTIME_READINESS_STATES.has(String(job.readiness))) {
    errors.push({ code: "runtime_job_invalid_readiness", field: "job.readiness" });
  }
  if (!hasRuntimeValue(job.idempotency_key)) {
    errors.push({ code: "runtime_job_missing_idempotency_key", field: "job.idempotency_key" });
  }

  const lock = contract.lock || {};
  if (!hasRuntimeValue(lock.lock_id) || !hasRuntimeValue(lock.scope) || !hasRuntimeValue(lock.owner_agent_id) || !hasRuntimeValue(lock.session_id)) {
    errors.push({ code: "runtime_lock_incomplete", field: "lock" });
  }
  if (!hasRuntimeValue(lock.expires_at)) {
    errors.push({ code: "runtime_lock_missing_expiry", field: "lock.expires_at" });
  }

  const audit = contract.audit || {};
  if (!hasRuntimeValue(audit.event_id) || !hasRuntimeValue(audit.correlation_id) || !hasRuntimeValue(audit.core_audit_id)) {
    errors.push({ code: "runtime_audit_incomplete", field: "audit" });
  }
  if (hasRuntimeValue(job.correlation_id) && hasRuntimeValue(audit.correlation_id) && job.correlation_id !== audit.correlation_id) {
    errors.push({ code: "runtime_correlation_mismatch", field: "audit.correlation_id" });
  }

  const rollback = contract.rollback || {};
  if (!hasRuntimeValue(rollback.rollback_plan_id) || !hasRuntimeValue(rollback.backup_ref) || !hasRuntimeValue(rollback.verification_step)) {
    errors.push({ code: "runtime_rollback_incomplete", field: "rollback" });
  }

  const allowed = errors.length === 0;
  return {
    schema: "suite_control_plane_enterprise_runtime_validation_v1",
    allowed,
    status: allowed ? (warnings.length ? "review" : "allow") : "block",
    errors,
    warnings,
  };
}

function buildCommerceControlRoomContract() {
  return {
    schema_version: "suite_commerce_control_room_contract_v1",
    service_version: SERVICE_VERSION,
    mode: "read_only_control_plane_contract",
    wordpress_source_route: "/wp-json/shss/v1/waas-manager/commerce-control-room",
    render_routes: {
      contract: "/api/suite/commerce/control-room/contract",
      validate: "/api/suite/commerce/control-room/validate",
    },
    source_of_truth: {
      ui: "WordPress Site Suite",
      contract: "Suite Control Plane Render",
      decision: "Universal Core",
      checkout: "WooCommerce or approved payment gateway",
      execution: "owner_confirmed_runbook_only",
    },
    required_sections: COMMERCE_CONTROL_ROOM_REQUIRED_SECTIONS,
    package_blocks: COMMERCE_CONTROL_ROOM_PACKAGE_BLOCKS,
    safety_policy: {
      suite_is_ui_control_plane: true,
      no_automatic_checkout: true,
      no_automatic_order_mutation: true,
      no_automatic_stock_reserve: true,
      no_automatic_payment_capture: true,
      owner_confirmation_required: true,
      core_required_for_sensitive_actions: true,
    },
    split_candidates: [
      "catalog_policy_service",
      "order_event_ledger",
      "price_claim_guard_service",
      "smartdesk_sync_service",
      "tenant_entitlement_service",
    ],
    next_migration_order: [
      "commerce_control_room_contract",
      "commerce_snapshot_receiver",
      "catalog_policy_service",
      "price_claim_guard_service",
      "order_event_ledger",
      "smartdesk_sync_service",
      "tenant_entitlement_service",
    ],
  };
}

function buildSuiteRuntimeMapContract() {
  return {
    schema_version: "suite_runtime_map_contract_v1",
    service_version: SERVICE_VERSION,
    mode: "read_only_runtime_map",
    positioning: "WordPress Site Suite resta pannello cliente e nodo sito; Render Suite Control Plane diventa Data Engine per eventi, analytics, Core insight, code e multi-tenant.",
    render_routes: {
      contract: "/api/suite/runtime-map/contract",
      control_plane_dashboard: "/api/suite/control-plane/dashboard",
      tenant_dashboard: "/api/suite/tenants/:tenantId/dashboard",
      node_heartbeat: "/api/suite/nodes/heartbeat",
      node_snapshot: "/api/suite/nodes/snapshot",
      commerce_snapshot: "/api/suite/commerce/snapshot",
      evidence: "/api/suite/evidence",
      event_ingest: "/api/suite/events/ingest",
      event_summary: "/api/suite/tenants/:tenantId/events/summary",
      analytics_action_plan: "/api/suite/tenants/:tenantId/analytics/action-plan",
    },
    wordpress_keeps: SUITE_RUNTIME_WORDPRESS_KEEPS,
    render_moves: SUITE_RUNTIME_RENDER_MOVES,
    available_now: [
      "control_plane_dashboard",
      "tenant_dashboard",
      "node_heartbeat",
      "node_snapshot",
      "commerce_snapshot_receiver",
      "evidence_ledger",
      "event_spine_ingest",
      "tenant_event_summary",
      "analytics_action_plan",
      "core_bridge_status",
      "commerce_control_room_contract",
      "google_connector_contract",
      "runtime_map_contract",
    ],
    first_real_migration: {
      id: "analytics_event_spine",
      label: "Analytics WaaS + Event Spine + Core Insight",
      wordpress_role: "raccoglie eventi leggeri e mostra UI",
      render_role: "ordina eventi, conserva storico tenant-scoped, prepara dataset Core",
      core_role: "legge dataset e produce diagnosi/priorita/azioni da confermare",
      execution_allowed: false,
    },
    safety_policy: {
      no_customer_data_in_code: true,
      no_cross_tenant_read: true,
      no_automatic_checkout: true,
      no_automatic_campaign_write: true,
      owner_confirmation_required_for_actions: true,
      scoped_key_required: true,
    },
  };
}

function validateCommerceControlRoomSnapshot(snapshot) {
  const errors = [];
  const warnings = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      schema: "suite_commerce_control_room_validation_v1",
      allowed: false,
      status: "block",
      errors: [{ code: "missing_commerce_control_room_snapshot", field: "snapshot" }],
      warnings,
    };
  }

  const mode = String(snapshot.mode || "").trim();
  if (mode && mode !== "commerce_control_room_read_only") {
    errors.push({ code: "invalid_commerce_control_room_mode", field: "mode" });
  }

  const sections = Array.isArray(snapshot.sections) ? snapshot.sections : [];
  const sectionKeys = new Set(sections.map((section) => String(section?.key || "").trim()).filter(Boolean));
  for (const section of COMMERCE_CONTROL_ROOM_REQUIRED_SECTIONS) {
    if (!sectionKeys.has(section)) {
      warnings.push({ code: "commerce_section_missing", field: `sections.${section}` });
    }
  }

  const forbiddenTrueFlags = [
    "writes_data",
    "automation_allowed",
    "automatic_checkout_enabled",
    "automatic_order_mutation_enabled",
    "automatic_stock_reserve_enabled",
    "automatic_payment_capture_enabled",
  ];
  for (const flag of forbiddenTrueFlags) {
    if (snapshot[flag] === true) {
      errors.push({ code: "commerce_control_room_forbidden_execution_flag", field: flag });
    }
  }
  if (snapshot.owner_confirmation_required !== true) {
    warnings.push({ code: "owner_confirmation_not_explicit", field: "owner_confirmation_required" });
  }

  const summary = snapshot.summary && typeof snapshot.summary === "object" ? snapshot.summary : {};
  const readinessScore = Number(summary.readiness_score ?? 0);
  if (!Number.isFinite(readinessScore) || readinessScore < 0 || readinessScore > 100) {
    warnings.push({ code: "readiness_score_out_of_range", field: "summary.readiness_score" });
  }

  const packageBlocks = Array.isArray(snapshot.package_blocks) ? snapshot.package_blocks : [];
  const packageIds = new Set(packageBlocks.map((item) => String(item?.id || "").trim()).filter(Boolean));
  for (const requiredPackage of COMMERCE_CONTROL_ROOM_PACKAGE_BLOCKS) {
    if (!packageIds.has(requiredPackage.id)) {
      warnings.push({ code: "package_block_missing", field: `package_blocks.${requiredPackage.id}` });
    }
  }

  const allowed = errors.length === 0;
  return {
    schema: "suite_commerce_control_room_validation_v1",
    allowed,
    status: allowed ? (warnings.length ? "review" : "allow") : "block",
    sections_found: sectionKeys.size,
    required_sections: COMMERCE_CONTROL_ROOM_REQUIRED_SECTIONS.length,
    errors,
    warnings,
  };
}

function buildGoogleConnectorContract() {
  const publicBaseUrl = normalizeCoreUrl(process.env.SUITE_CONTROL_PLANE_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "");
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || (publicBaseUrl ? `${publicBaseUrl}/api/suite/integrations/google/oauth/callback` : "");
  const provider = {
    client_id_configured: Boolean(process.env.GOOGLE_CLIENT_ID),
    client_secret_configured: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    developer_token_configured: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
    redirect_uri: redirectUri,
  };
  const missingProviderFields = [
    ...(provider.client_id_configured ? [] : ["client_id"]),
    ...(provider.client_secret_configured ? [] : ["client_secret"]),
    ...(provider.developer_token_configured ? [] : ["developer_token"]),
    ...(provider.redirect_uri ? [] : ["redirect_uri"]),
  ];

  return {
    schema_version: "suite_google_connector_contract_v1",
    service_version: SERVICE_VERSION,
    mode: "oauth_ready_no_campaign_mutation",
    render_routes: {
      status: "/api/suite/integrations/google/status",
      connect: "/api/suite/integrations/google/connect",
      validate: "/api/suite/integrations/google/validate",
      callback: "/api/suite/integrations/google/oauth/callback",
    },
    provider,
    provider_ready: missingProviderFields.length === 0,
    missing_provider_fields: missingProviderFields,
    required_provider_fields: GOOGLE_CONNECTOR_REQUIRED_PROVIDER_FIELDS,
    required_tenant_fields: GOOGLE_CONNECTOR_REQUIRED_TENANT_FIELDS,
    customer_flow: [
      "click_connect_google",
      "google_login",
      "owner_or_tenant_admin_consent",
      "select_google_ads_customer",
      "select_ga4_property",
      "suite_reads_metrics",
      "core_ranks_actions",
    ],
    data_contract: {
      reads: [
        "campaign_name",
        "campaign_status",
        "cost",
        "clicks",
        "impressions",
        "conversions",
        "cost_per_lead",
        "ga4_sessions",
        "ga4_events",
        "landing_page_path",
      ],
      writes: [],
      normalized_output: {
        campaign_id: "string",
        source: "google_ads",
        landing_page_path: "string",
        spend: "number",
        clicks: "number",
        leads: "number",
        conversion_rate: "number",
        core_recommended_action: "hold|review|scale|pause|fix_page",
      },
    },
    safety_policy: {
      no_campaign_creation: true,
      no_budget_change: true,
      no_keyword_mutation: true,
      no_auto_publish: true,
      owner_confirmation_required_for_any_write: true,
      core_required_for_scale_or_pause: true,
      suite_is_ui_only: true,
    },
    branches: [
      "paid_ads_guard",
      "funnel_conversion_guard",
      "customer_behavior_analysis",
      "claim_guard",
      "pricing_guard",
      "business_governance",
    ],
    next_action: missingProviderFields.length
      ? "Configurare credenziali provider Google su Render; il cliente vedra comunque il flusso semplice Collega Google."
      : "Abilitare OAuth reale e selezione account/proprieta per tenant.",
  };
}

function buildGoogleConnectorStatus(tenantId = "") {
  const contract = buildGoogleConnectorContract();
  const tenantKey = sanitizeId(tenantId || "tenant_demo", "tenant");
  const simulatedAuthorized = String(process.env.GOOGLE_CONNECTOR_DEMO_CONNECTED || "").toLowerCase() === "true";
  const adsCustomerId = process.env.GOOGLE_ADS_CUSTOMER_ID || "";
  const ga4PropertyId = process.env.GA4_PROPERTY_ID || "";
  const tenantConnected = simulatedAuthorized && Boolean(adsCustomerId || ga4PropertyId);

  return {
    ok: true,
    schema_version: "suite_google_connector_status_v1",
    service_version: SERVICE_VERSION,
    tenant_id: tenantKey,
    mode: contract.mode,
    provider_ready: contract.provider_ready,
    connected: tenantConnected,
    state: tenantConnected ? "connected_demo" : (contract.provider_ready ? "ready_to_connect" : "provider_setup_required"),
    connect_url: `/api/suite/integrations/google/connect?tenant_id=${encodeURIComponent(tenantKey)}`,
    selected_accounts: {
      google_ads_customer_id_present: Boolean(adsCustomerId),
      ga4_property_id_present: Boolean(ga4PropertyId),
    },
    capability: {
      can_read_google_ads: tenantConnected && Boolean(adsCustomerId),
      can_read_ga4: tenantConnected && Boolean(ga4PropertyId),
      can_change_campaigns: false,
      can_change_budget: false,
    },
    owner_visible_copy: tenantConnected
      ? "Google collegato. Suite puo leggere campagne e Analytics; Core decide priorita e azioni consigliate."
      : "Google non collegato. Il cliente clicca Collega Google, accede e autorizza SkinHarmony.",
    missing_provider_fields: contract.missing_provider_fields,
    contract,
  };
}

function validateGoogleConnectorSetup(input) {
  const errors = [];
  const warnings = [];
  const provider = input?.provider && typeof input.provider === "object" ? input.provider : {};
  const tenant = input?.tenant && typeof input.tenant === "object" ? input.tenant : {};

  for (const field of GOOGLE_CONNECTOR_REQUIRED_PROVIDER_FIELDS) {
    if (!hasRuntimeValue(provider[field])) {
      errors.push({ code: "google_provider_field_missing", field: `provider.${field}` });
    }
  }
  for (const field of GOOGLE_CONNECTOR_REQUIRED_TENANT_FIELDS) {
    if (!hasRuntimeValue(tenant[field])) {
      warnings.push({ code: "google_tenant_field_missing", field: `tenant.${field}` });
    }
  }
  if (input?.campaign_write_enabled === true || input?.budget_write_enabled === true) {
    errors.push({ code: "google_ads_write_not_allowed", field: "campaign_write_enabled" });
  }

  const allowed = errors.length === 0;
  return {
    schema: "suite_google_connector_validation_v1",
    allowed,
    status: allowed ? (warnings.length ? "review" : "allow") : "block",
    errors,
    warnings,
    execution_allowed: false,
  };
}

function normalizeCoreUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function readSetupCoreConfig(tenantId, options = {}) {
  const setups = options.setupKeys && typeof options.setupKeys === "object"
    ? options.setupKeys
    : parseSetupKeys(process.env.SUITE_CORE_SETUP_KEYS_JSON || process.env.SUITE_CORE_SETUP_KEYS || "");
  const tenantKey = sanitizeId(tenantId || process.env.SUITE_CORE_TENANT_ID || "", "tenant");
  const setup = setups[tenantKey] && typeof setups[tenantKey] === "object" ? setups[tenantKey] : {};
  const coreUrl = normalizeCoreUrl(setup.core_url || setup.url || options.coreUrl || process.env.SUITE_CORE_URL || process.env.UNIVERSAL_CORE_URL || "");
  const apiKey = String(setup.api_key || setup.key || options.apiKey || process.env.SUITE_CORE_API_KEY || process.env.UNIVERSAL_CORE_API_KEY || "").trim();

  return {
    configured: Boolean(coreUrl && apiKey),
    core_url: coreUrl,
    api_key: apiKey,
    api_key_present: Boolean(apiKey),
    api_key_masked: maskSecret(apiKey),
    tenant_id: tenantKey,
    source: setup.api_key || setup.key
      ? "setup_scoped_key"
      : apiKey
        ? "environment_default_key"
        : "not_configured",
  };
}

function parseSetupKeys(value) {
  const raw = String(value || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function uniqueValues(values) {
  return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
}

function nodeReadiness(node) {
  const capabilities = Array.isArray(node.latest_heartbeat?.capabilities) ? node.latest_heartbeat.capabilities : [];
  const validation = node.latest_snapshot?.validation || {};
  const controlPlane = node.latest_snapshot?.control_plane || {};
  const checks = {
    heartbeat: Boolean(node.latest_heartbeat),
    snapshot: Boolean(node.latest_snapshot),
    evidence: node.evidence_count > 0,
    change_impact_contract: Boolean(node.latest_snapshot?.change_impact_orchestration),
    manifest_integrity: validation.manifest_integrity_ready === true,
    runbook_receiver: capabilities.includes("runbook_receiver") || controlPlane.runbook_receiver_ready === true,
    core_bridge: capabilities.includes("control_plane") || controlPlane.core_bridge_ready === true,
  };
  const missing = Object.entries(checks)
    .filter(([, ready]) => !ready)
    .map(([key]) => key);
  const criticalIssues = Array.isArray(validation.critical_issues)
    ? validation.critical_issues.map(String).filter(Boolean)
    : [];

  return {
    status: criticalIssues.length ? "blocked" : missing.length ? "warning" : "ready",
    score: Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100),
    checks,
    missing,
    critical_issues: criticalIssues,
    next_actions: [
      ...(checks.heartbeat ? [] : ["send_node_heartbeat"]),
      ...(checks.snapshot ? [] : ["send_node_snapshot"]),
      ...(checks.change_impact_contract ? [] : ["attach_change_impact_contract"]),
      ...(checks.manifest_integrity ? [] : ["verify_release_manifest_integrity"]),
      ...(checks.runbook_receiver ? [] : ["enable_runbook_receiver_capability"]),
      ...(checks.core_bridge ? [] : ["verify_core_bridge_capability"]),
      ...(checks.evidence ? [] : ["write_first_core_evidence"]),
    ],
  };
}

function summarizeEvidence(events = []) {
  const byType = {};
  const byDecision = {};
  const byRisk = {};
  for (const event of events) {
    byType[event.evidence_type] = (byType[event.evidence_type] || 0) + 1;
    if (event.decision) byDecision[event.decision] = (byDecision[event.decision] || 0) + 1;
    if (event.risk) byRisk[event.risk] = (byRisk[event.risk] || 0) + 1;
  }
  return {
    total: events.length,
    by_type: byType,
    by_decision: byDecision,
    by_risk: byRisk,
    latest: events.slice(0, 10),
  };
}

function createUniversalCoreClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  async function coreRequest(tenantId, path, payload = {}, method = "POST") {
    const config = readSetupCoreConfig(tenantId, options);
    if (!config.configured) {
      return {
        ok: false,
        status_code: 424,
        error: "suite_core_key_not_configured",
        message: "Configurare una API key Universal Core scoped per questo setup.",
        config: {
          configured: false,
          tenant_id: config.tenant_id,
          core_url: config.core_url,
          api_key_present: config.api_key_present,
          source: config.source,
        },
      };
    }

    const response = await fetchImpl(`${config.core_url}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.api_key}`,
        "x-sh-tenant-id": config.tenant_id,
      },
      body: method === "GET" ? undefined : JSON.stringify({
        tenant_id: config.tenant_id,
        ...(payload && typeof payload === "object" ? payload : {}),
      }),
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = { ok: false, error: "invalid_json_response" };
    }

    return {
      ok: response.ok && body?.ok !== false,
      status_code: response.status,
      body,
      config: {
        configured: true,
        tenant_id: config.tenant_id,
        core_url: config.core_url,
        api_key_present: config.api_key_present,
        api_key_masked: config.api_key_masked,
        source: config.source,
      },
    };
  }

  function shouldTryFallback(result) {
    return [403, 404, 405].includes(Number(result?.status_code || 0));
  }

  async function coreRequestFallback(tenantId, attempts = []) {
    let firstResult = null;
    for (const attempt of attempts) {
      const result = await coreRequest(
        tenantId,
        attempt.path,
        attempt.payload || {},
        attempt.method || "POST",
      );
      const enriched = {
        ...result,
        route: {
          path: attempt.path,
          label: attempt.label || attempt.path,
          fallback: Boolean(firstResult),
        },
      };
      if (enriched.ok) return enriched;
      if (!firstResult) firstResult = enriched;
      if (!shouldTryFallback(enriched)) return enriched;
    }
    return firstResult || {
      ok: false,
      status_code: 424,
      error: "core_route_not_available",
      message: "Nessun endpoint Core disponibile per questa richiesta.",
    };
  }

  function toSiteSuiteGatewayPayload(payload = {}) {
    const text = String(payload.user_request || payload.request || payload.text || payload.task || "Suite Control Plane Nyra bridge");
    return {
      adapter: "site_suite",
      mode: payload.gateway_mode || (payload.mode === "hard-gating" ? "hard-gating" : "advisory"),
      user_request: text,
      llm_output: String(payload.llm_output || payload.output || payload.text || text),
      requested_action: payload.requested_action || {
        type: payload.action_type || "read_status",
        label: payload.action_label || "Suite Control Plane advisory",
      },
      owner_confirmed: payload.owner_confirmed === true,
      branches: Array.isArray(payload.branches) ? payload.branches : [],
      context: {
        target_system: payload.target_system || "suite",
        source: "suite_control_plane",
        no_auto_execute: true,
        ...(payload.context && typeof payload.context === "object" ? payload.context : {}),
      },
    };
  }

  function toActionEvaluatorPayload(payload = {}) {
    const action = payload.action && typeof payload.action === "object" ? payload.action : {};
    return {
      action_type: action.type || action.action_type || payload.action_type || "workflow_decision",
      action_label: action.label || payload.action_label || "Suite Control Plane action mediation",
      risk_hint: action.risk_hint ?? payload.risk_hint ?? 45,
      confidence_hint: action.confidence_hint ?? payload.confidence_hint ?? 75,
      owner_confirmed: payload.owner_confirmed === true,
      context: {
        source: "suite_control_plane",
        no_auto_execute: true,
        ...(payload.context && typeof payload.context === "object" ? payload.context : {}),
      },
      metadata: {
        source: "suite_control_plane",
        route: "modern_action_evaluator",
      },
      evidence: [
        { label: "source", value: "suite_control_plane" },
        { label: "mode", value: "evaluate_only" },
      ],
    };
  }

  return {
    status(tenantId) {
      const config = readSetupCoreConfig(tenantId, options);
      return {
        ok: true,
        schema_version: "suite_core_bridge_status_v1",
        configured: config.configured,
        tenant_id: config.tenant_id,
        core_url: config.core_url,
        api_key_present: config.api_key_present,
        api_key_masked: config.api_key_masked,
        source: config.source,
        required_key_policy: "Una API key Universal Core scoped viene generata per ogni setup/tenant e configurata nel Control Plane; nessuna chiave cliente va hardcodata.",
        routes: {
          tenant_status: "/v1/tenant/status",
          entitlement: "/v1/entitlements/current",
          control_plane_dashboard: "/v1/control-plane/dashboard",
          site_suite_gateway: "/v1/adapters/site-suite/gateway",
          action_evaluator: "/v1/action-evaluator",
          nyra_core_bridge: "/v1/adapters/site-suite/gateway",
          nira_core_bridge: "/v1/adapters/site-suite/gateway",
          action_mediation: "/v1/action-evaluator",
          legacy_nira_core_bridge: "/v1/nira/core-bridge",
          legacy_action_mediation: "/v1/action-mediation/evaluate",
        },
      };
    },
    niraBridge(tenantId, payload) {
      return coreRequestFallback(tenantId, [
        {
          label: "site_suite_gateway",
          path: "/v1/adapters/site-suite/gateway",
          payload: toSiteSuiteGatewayPayload(payload),
        },
        {
          label: "legacy_nira_core_bridge",
          path: "/v1/nira/core-bridge",
          payload,
        },
      ]);
    },
    actionMediation(tenantId, payload) {
      return coreRequestFallback(tenantId, [
        {
          label: "action_evaluator",
          path: "/v1/action-evaluator",
          payload: toActionEvaluatorPayload(payload),
        },
        {
          label: "legacy_action_mediation",
          path: "/v1/action-mediation/evaluate",
          payload,
        },
      ]);
    },
  };
}

function normalizeSiteEvent(payload = {}) {
  const eventType = sanitizeId(payload.event_type || "page_view", "event").toLowerCase();
  const allowedTypes = new Set(["page_view", "cta_click", "form_submit", "engaged_visit", "scroll_depth", "active_time_ping"]);
  const tenantId = sanitizeId(payload.tenant_id || "unknown", "tenant");
  const nodeId = sanitizeId(payload.node_id || `${tenantId}_wordpress`, "node");
  const eventDay = String(payload.event_day || payload.day || nowIso().slice(0, 10)).slice(0, 10);
  const elapsedSeconds = Math.max(0, Math.min(3600, Number.parseInt(payload.elapsed_seconds ?? 0, 10) || 0));
  const scrollDepth = Math.max(0, Math.min(100, Number.parseInt(payload.scroll_depth ?? 0, 10) || 0));
  return {
    id: `site_event_${crypto.randomUUID()}`,
    received_at: nowIso(),
    schema_version: String(payload.schema_version || "suite_site_event_v1"),
    tenant_id: tenantId,
    node_id: nodeId,
    source: String(payload.source || "wordpress_site_suite").slice(0, 80),
    suite_version: String(payload.suite_version || "").slice(0, 40),
    site_url: String(payload.site_url || "").slice(0, 180),
    event_type: allowedTypes.has(eventType) ? eventType : "page_view",
    event_label: String(payload.event_label || "none").slice(0, 160),
    target_url: String(payload.target_url || "none").slice(0, 180),
    event_section: sanitizeId(payload.event_section || "body", "section").toLowerCase(),
    click_kind: sanitizeId(payload.click_kind || "altro", "click").toLowerCase(),
    session_hash: String(payload.session_hash || "").slice(0, 80),
    path: String(payload.path || "home").slice(0, 180),
    referrer: String(payload.referrer || "direct").slice(0, 180),
    utm_source: sanitizeId(payload.utm_source || "none", "utm").toLowerCase(),
    utm_medium: sanitizeId(payload.utm_medium || "none", "utm").toLowerCase(),
    utm_campaign: String(payload.utm_campaign || "none").slice(0, 180),
    browser_language: String(payload.browser_language || "unknown").slice(0, 80),
    browser_timezone: String(payload.browser_timezone || "unknown").slice(0, 80),
    estimated_country: String(payload.estimated_country || "non stimato").slice(0, 80),
    elapsed_seconds: elapsedSeconds,
    scroll_depth: scrollDepth,
    event_day: eventDay,
    privacy: {
      ip_address_sent: false,
      raw_session_id_sent: false,
      personal_data_payload: false,
      ...(payload.privacy && typeof payload.privacy === "object" ? payload.privacy : {}),
    },
  };
}

function incBucket(bucket, key, amount = 1) {
  const safeKey = String(key || "unknown");
  bucket[safeKey] = (bucket[safeKey] || 0) + amount;
}

function topBucket(bucket, limit = 12) {
  return Object.entries(bucket)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function buildEventsSummary(events = [], days = 30) {
  const cutoff = new Date(Date.now() - Math.max(1, Math.min(365, days)) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const filtered = events.filter((event) => String(event.event_day || "").slice(0, 10) >= cutoff);
  const byDay = {};
  const eventTypes = {};
  const paths = {};
  const referrers = {};
  const sources = {};
  const clickDetails = {};
  const scrollMilestones = {};
  const sessions = new Set();
  let pageViews = 0;
  let ctaClicks = 0;
  let formSubmits = 0;
  let engagedVisits = 0;
  let activeSeconds = 0;

  for (const event of filtered) {
    const day = event.event_day || event.received_at.slice(0, 10);
    if (!byDay[day]) byDay[day] = { day, events: 0, page_views: 0, cta_clicks: 0, form_submits: 0, active_seconds: 0 };
    byDay[day].events += 1;
    incBucket(eventTypes, event.event_type);
    incBucket(paths, event.path);
    incBucket(referrers, event.referrer);
    incBucket(sources, event.utm_source && event.utm_source !== "none" ? event.utm_source : event.referrer);
    if (event.session_hash) sessions.add(event.session_hash);
    activeSeconds += event.elapsed_seconds || 0;
    byDay[day].active_seconds += event.elapsed_seconds || 0;

    if (event.event_type === "page_view") {
      pageViews += 1;
      byDay[day].page_views += 1;
    }
    if (event.event_type === "cta_click") {
      ctaClicks += 1;
      byDay[day].cta_clicks += 1;
      incBucket(clickDetails, `${event.path} | ${event.event_section} | ${event.click_kind} | ${event.event_label}`);
    }
    if (event.event_type === "form_submit") {
      formSubmits += 1;
      byDay[day].form_submits += 1;
    }
    if (event.event_type === "engaged_visit") engagedVisits += 1;
    if (event.event_type === "scroll_depth") {
      incBucket(scrollMilestones, `${event.path} | ${event.event_label || event.scroll_depth}`);
    }
  }

  return {
    schema_version: "suite_events_summary_v1",
    generated_at: nowIso(),
    days,
    totals: {
      events: filtered.length,
      page_views: pageViews,
      sessions: sessions.size,
      cta_clicks: ctaClicks,
      form_submits: formSubmits,
      engaged_visits: engagedVisits,
      active_seconds: activeSeconds,
      cta_rate: pageViews ? Number(((ctaClicks / pageViews) * 100).toFixed(1)) : 0,
      lead_rate: pageViews ? Number(((formSubmits / pageViews) * 100).toFixed(1)) : 0,
    },
    by_day: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    top_paths: topBucket(paths),
    top_referrers: topBucket(referrers),
    top_sources: topBucket(sources),
    event_types: topBucket(eventTypes),
    click_details: topBucket(clickDetails, 20),
    scroll_milestones: topBucket(scrollMilestones, 20),
    latest: filtered.slice(0, 20),
  };
}

function buildAnalyticsActionPlan(summary) {
  const totals = summary?.totals || {};
  const topPath = summary?.top_paths?.[0]?.key || "home";
  const moves = [];
  if ((totals.cta_clicks || 0) > 0 && (totals.form_submits || 0) === 0) {
    moves.push({
      id: "conversion_path_verify",
      priority: "high",
      status: "attention",
      title: "I click non diventano richieste",
      why: "Render vede click, ma nessun invio form o checkout validato.",
      action: "Aprire il percorso dal pulsante più cliccato e completare un test fino a richiesta o checkout.",
      verify: "Devono arrivare eventi cta_click e form_submit dalla stessa pagina.",
      hold: "Non aumentare budget Ads finché il passaggio non è provato.",
      target_path: topPath,
    });
  }
  if ((totals.page_views || 0) > 0 && (totals.cta_clicks || 0) === 0) {
    moves.push({
      id: "cta_visibility_verify",
      priority: "high",
      status: "verify",
      title: "Manca un click principale",
      why: "Le visite arrivano, ma non compare un segnale di pulsante utile.",
      action: "Rendere più visibile il pulsante principale e verificare che il tracker lo legga.",
      verify: "Il riepilogo deve mostrare almeno un cta_click sulla pagina più vista.",
      hold: "Non cambiare più sezioni insieme: prima prova un solo percorso.",
      target_path: topPath,
    });
  }
  if ((totals.engaged_visits || 0) === 0 && (totals.page_views || 0) > 0) {
    moves.push({
      id: "reading_depth_verify",
      priority: "medium",
      status: "verify",
      title: "Lettura pagina da verificare",
      why: "Non ci sono ancora segnali sufficienti di lettura o permanenza attiva.",
      action: "Controllare scroll e tempo attivo su una visita pubblica di test.",
      verify: "Devono arrivare scroll_depth o engaged_visit.",
      hold: "Non giudicare il contenuto finché il segnale di lettura non è pulito.",
      target_path: topPath,
    });
  }
  if (!moves.length) {
    moves.push({
      id: "tracking_observe",
      priority: "low",
      status: "healthy",
      title: "Tracciamento in osservazione",
      why: "Render riceve eventi e non vede blocchi critici immediati.",
      action: "Continuare a raccogliere dati e confrontare con Ads/GA4.",
      verify: "Eventi, click e richieste restano coerenti su 30 giorni.",
      hold: "Nessuna modifica automatica senza conferma owner.",
      target_path: topPath,
    });
  }
  return {
    schema_version: "suite_analytics_action_plan_v1",
    generated_at: nowIso(),
    mode: "read_only_recommendations",
    execution_allowed: false,
    owner_confirmation_required: true,
    source: "suite_control_plane_event_spine",
    summary: totals,
    next_controlled_moves: moves,
  };
}

function createMemoryStorage() {
  const nodes = new Map();
  const evidence = [];
  const siteEvents = [];

  function getOrCreateNode(nodeId, tenantId = "unknown") {
    const id = sanitizeId(nodeId, "node");
    if (!nodes.has(id)) {
      nodes.set(id, {
        node_id: id,
        tenant_id: sanitizeId(tenantId, "tenant"),
        first_seen_at: nowIso(),
        last_seen_at: null,
        status: "registered",
        runtime_mode: "remote",
        topology: "shared",
        heartbeat_count: 0,
        snapshot_count: 0,
        commerce_snapshot_count: 0,
        evidence_count: 0,
        latest_heartbeat: null,
        latest_snapshot: null,
        latest_commerce_snapshot: null,
        events: [],
      });
    }
    return nodes.get(id);
  }

  function appendNodeEvent(node, type, payload) {
    node.events.unshift({
      id: `${type}_${crypto.randomUUID()}`,
      type,
      created_at: nowIso(),
      payload,
    });

    if (node.events.length > DEFAULT_MAX_EVENTS_PER_NODE) {
      node.events.length = DEFAULT_MAX_EVENTS_PER_NODE;
    }
  }

  return {
    mode: "memory",
    heartbeat(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      node.tenant_id = sanitizeId(payload.tenant_id || node.tenant_id, "tenant");
      node.last_seen_at = nowIso();
      node.status = payload.status || "online";
      node.runtime_mode = payload.runtime_mode || node.runtime_mode;
      node.topology = payload.topology || node.topology;
      node.heartbeat_count += 1;
      node.latest_heartbeat = {
        received_at: node.last_seen_at,
        plugin_version: payload.plugin_version || null,
        wp_version: payload.wp_version || null,
        site_url: payload.site_url || null,
        capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.map(String) : [],
        health: payload.health && typeof payload.health === "object" ? payload.health : {},
      };
      appendNodeEvent(node, "heartbeat", node.latest_heartbeat);
      return node;
    },
    snapshot(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      node.snapshot_count += 1;
      node.last_seen_at = nowIso();
      node.latest_snapshot = {
        received_at: node.last_seen_at,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
        commerce_snapshot: payload.commerce_snapshot && typeof payload.commerce_snapshot === "object" ? payload.commerce_snapshot : null,
        control_plane: payload.control_plane && typeof payload.control_plane === "object" ? payload.control_plane : {},
        validation: payload.validation && typeof payload.validation === "object" ? payload.validation : {},
        change_impact_orchestration: payload.change_impact_orchestration && typeof payload.change_impact_orchestration === "object" ? payload.change_impact_orchestration : null,
      };
      if (node.latest_snapshot.commerce_snapshot) {
        node.latest_commerce_snapshot = {
          received_at: node.last_seen_at,
          suite_version: payload.suite_version || payload.summary?.plugin_version || null,
          snapshot: node.latest_snapshot.commerce_snapshot,
        };
      }
      appendNodeEvent(node, "snapshot", node.latest_snapshot);
      return node;
    },
    commerceSnapshot(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      const snapshot = payload.snapshot && typeof payload.snapshot === "object" ? payload.snapshot : {};
      node.tenant_id = sanitizeId(payload.tenant_id || node.tenant_id, "tenant");
      node.commerce_snapshot_count += 1;
      node.last_seen_at = nowIso();
      node.latest_commerce_snapshot = {
        received_at: node.last_seen_at,
        suite_version: payload.suite_version || snapshot.suite_version || null,
        snapshot,
      };
      appendNodeEvent(node, "commerce_snapshot", {
        received_at: node.last_seen_at,
        suite_version: node.latest_commerce_snapshot.suite_version,
        schema_version: snapshot.schema_version || null,
        summary: snapshot.summary && typeof snapshot.summary === "object" ? snapshot.summary : {},
        crm_erp_lite_summary: snapshot.crm_erp_lite?.summary && typeof snapshot.crm_erp_lite.summary === "object" ? snapshot.crm_erp_lite.summary : {},
        privacy: snapshot.privacy && typeof snapshot.privacy === "object" ? snapshot.privacy : {},
      });
      return node;
    },
    evidence(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      const event = {
        id: `evidence_${crypto.randomUUID()}`,
        received_at: nowIso(),
        node_id: node.node_id,
        tenant_id: node.tenant_id,
        evidence_type: String(payload.evidence_type || "suite_event"),
        decision: payload.decision || null,
        risk: payload.risk || null,
        audit_id: payload.audit_id || null,
        payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {},
      };
      evidence.unshift(event);
      node.evidence_count += 1;
      node.last_seen_at = event.received_at;
      appendNodeEvent(node, "evidence", event);
      return { node, event };
    },
    ingestSiteEvent(payload) {
      const event = normalizeSiteEvent(payload);
      const node = getOrCreateNode(event.node_id, event.tenant_id);
      node.tenant_id = event.tenant_id;
      node.last_seen_at = event.received_at;
      siteEvents.unshift(event);
      if (siteEvents.length > 10000) {
        siteEvents.length = 10000;
      }
      appendNodeEvent(node, "site_event", {
        id: event.id,
        received_at: event.received_at,
        event_type: event.event_type,
        path: event.path,
        session_hash_present: Boolean(event.session_hash),
      });
      return { node, event };
    },
    eventsSummary(tenantId, days = 30) {
      const tenantKey = sanitizeId(tenantId, "tenant");
      return buildEventsSummary(siteEvents.filter((event) => event.tenant_id === tenantKey), days);
    },
    analyticsActionPlan(tenantId, days = 30) {
      return buildAnalyticsActionPlan(this.eventsSummary(tenantId, days));
    },
    dashboard(nodeId) {
      const node = nodes.get(sanitizeId(nodeId, "node"));
      if (!node) return null;
      return {
        node,
        recent_events: node.events.slice(0, 50),
        evidence: evidence.filter((item) => item.node_id === node.node_id).slice(0, 50),
        commerce_snapshot: node.latest_commerce_snapshot,
      };
    },
    overview() {
      const allNodes = Array.from(nodes.values());
      return {
        nodes_total: allNodes.length,
        nodes_online: allNodes.filter((node) => node.status === "online").length,
        evidence_total: evidence.length,
        nodes: allNodes
          .map((node) => ({
            node_id: node.node_id,
            tenant_id: node.tenant_id,
            status: node.status,
            last_seen_at: node.last_seen_at,
            heartbeat_count: node.heartbeat_count,
            snapshot_count: node.snapshot_count,
            commerce_snapshot_count: node.commerce_snapshot_count,
            evidence_count: node.evidence_count,
            change_impact_ready: Boolean(node.latest_snapshot?.change_impact_orchestration),
            commerce_snapshot_ready: Boolean(node.latest_commerce_snapshot),
          }))
          .sort((a, b) => String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""))),
      };
    },
    tenantDashboard(tenantId) {
      const tenantKey = sanitizeId(tenantId, "tenant");
      const tenantNodes = Array.from(nodes.values()).filter((node) => node.tenant_id === tenantKey);
      const tenantEvidence = evidence.filter((item) => item.tenant_id === tenantKey);
      const readiness = tenantNodes.map((node) => ({
        node_id: node.node_id,
        tenant_id: node.tenant_id,
        status: node.status,
        runtime_mode: node.runtime_mode,
        topology: node.topology,
        last_seen_at: node.last_seen_at,
        heartbeat_count: node.heartbeat_count,
        snapshot_count: node.snapshot_count,
        commerce_snapshot_count: node.commerce_snapshot_count,
        evidence_count: node.evidence_count,
        readiness: nodeReadiness(node),
        commerce_snapshot_ready: Boolean(node.latest_commerce_snapshot),
      }));
      const blocked = readiness.filter((item) => item.readiness.status === "blocked").length;
      const warnings = readiness.filter((item) => item.readiness.status === "warning").length;
      const ready = readiness.filter((item) => item.readiness.status === "ready").length;
      return {
        tenant_id: tenantKey,
        generated_at: nowIso(),
        nodes_total: tenantNodes.length,
        nodes_online: tenantNodes.filter((node) => node.status === "online").length,
        readiness_status: blocked ? "blocked" : warnings || !tenantNodes.length ? "warning" : "ready",
        readiness_summary: {
          ready,
          warning: warnings,
          blocked,
          average_score: readiness.length
            ? Math.round(readiness.reduce((sum, item) => sum + item.readiness.score, 0) / readiness.length)
            : 0,
        },
        next_actions: uniqueValues(readiness.flatMap((item) => item.readiness.next_actions)),
        nodes: readiness.sort((a, b) => String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""))),
        evidence: summarizeEvidence(tenantEvidence),
      };
    },
    controlPlaneDashboard() {
      const tenantIds = uniqueValues(Array.from(nodes.values()).map((node) => node.tenant_id));
      const tenants = tenantIds.map((tenantId) => this.tenantDashboard(tenantId));
      const blocked = tenants.filter((tenant) => tenant.readiness_status === "blocked").length;
      const warnings = tenants.filter((tenant) => tenant.readiness_status === "warning").length;
      const ready = tenants.filter((tenant) => tenant.readiness_status === "ready").length;
      return {
        generated_at: nowIso(),
        mode: "control_plane_first",
        execution_allowed: false,
        positioning: "Suite Control Plane read-only: stato tenant, nodi, Core bridge, evidence e readiness senza esecuzione automatica.",
        totals: {
          tenants: tenants.length,
          nodes: Array.from(nodes.values()).length,
          evidence: evidence.length,
          ready,
          warning: warnings,
          blocked,
        },
        next_actions: uniqueValues(tenants.flatMap((tenant) => tenant.next_actions)),
        tenants,
      };
    },
    changeImpactContract(nodeId) {
      const node = nodes.get(sanitizeId(nodeId, "node"));
      if (!node) return null;
      return {
        node_id: node.node_id,
        tenant_id: node.tenant_id,
        received_at: node.latest_snapshot?.received_at || null,
        contract: node.latest_snapshot?.change_impact_orchestration || null,
      };
    },
  };
}

function createAuth() {
  const configuredKey = process.env.SUITE_CONTROL_PLANE_API_KEY || "";
  const devKey = process.env.NODE_ENV === "production" ? "" : "dev-suite-control-plane-key";
  const expected = configuredKey || devKey;

  return (req, res, next) => {
    if (!expected) return publicError(res, 503, "suite_control_plane_key_not_configured");
    if (readSecret(req) !== expected) return publicError(res, 401, "suite_control_plane_key_invalid");
    return next();
  };
}

export function createSuiteControlPlane(options = {}) {
  const app = express();
  const storage = options.storage || createMemoryStorage();
  const auth = createAuth();
  const coreClient = options.coreClient || createUniversalCoreClient(options.core || {});

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "skinharmony-suite-control-plane",
      version: SERVICE_VERSION,
      storage_mode: storage.mode,
      generated_at: nowIso(),
    });
  });

  app.get("/api/suite/overview", auth, (req, res) => {
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      overview: storage.overview(),
    });
  });

  app.get("/api/suite/control-plane/dashboard", auth, (req, res) => {
    const dashboard = storage.controlPlaneDashboard();
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      dashboard: {
        ...dashboard,
        tenants: dashboard.tenants.map((tenant) => ({
          ...tenant,
          core_bridge: coreClient.status(tenant.tenant_id),
        })),
      },
    });
  });

  app.get("/api/suite/tenants/:tenantId/dashboard", auth, (req, res) => {
    const dashboard = storage.tenantDashboard(req.params.tenantId);
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      dashboard: {
        ...dashboard,
        core_bridge: coreClient.status(dashboard.tenant_id),
      },
    });
  });

  app.get("/api/suite/core/status", auth, (req, res) => {
    const tenantId = req.query.tenant_id || req.get("x-sh-tenant-id") || "";
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      core_bridge: coreClient.status(tenantId),
    });
  });

  app.get("/api/suite/commerce/control-room/contract", auth, (req, res) => {
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      contract: buildCommerceControlRoomContract(),
    });
  });

  app.get("/api/suite/runtime-map/contract", auth, (req, res) => {
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      contract: buildSuiteRuntimeMapContract(),
    });
  });

  app.post("/api/suite/commerce/control-room/validate", auth, (req, res) => {
    const snapshot = req.body?.snapshot || req.body?.commerce_control_room || req.body || {};
    const validation = validateCommerceControlRoomSnapshot(snapshot);
    res.status(validation.allowed ? 200 : 409).json({
      ok: validation.allowed,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "commerce_control_room_snapshot_validation",
      execution_allowed: false,
      validation,
      contract: buildCommerceControlRoomContract(),
    });
  });

  app.get("/api/suite/integrations/google/status", auth, (req, res) => {
    const tenantId = req.query.tenant_id || req.get("x-sh-tenant-id") || "";
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      google: buildGoogleConnectorStatus(tenantId),
    });
  });

  app.get("/api/suite/integrations/google/connect", auth, (req, res) => {
    const tenantId = sanitizeId(req.query.tenant_id || req.get("x-sh-tenant-id") || "tenant_demo", "tenant");
    const status = buildGoogleConnectorStatus(tenantId);
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "google_oauth_connect_placeholder",
      tenant_id: tenantId,
      customer_action: "Il cliente clicca Collega Google, fa login e autorizza SkinHarmony. Nessuna API key viene chiesta al cliente.",
      provider_ready: status.provider_ready,
      oauth_start_ready: status.provider_ready,
      oauth_url: status.provider_ready ? `/api/suite/integrations/google/oauth/start?tenant_id=${encodeURIComponent(tenantId)}` : "",
      missing_provider_fields: status.missing_provider_fields,
      execution_allowed: false,
      next_action: status.provider_ready
        ? "Implementare exchange OAuth reale e selezione account/proprieta."
        : "Configurare Google Client ID, Client Secret, Developer Token e Redirect URI su Render.",
    });
  });

  app.post("/api/suite/integrations/google/validate", auth, (req, res) => {
    const validation = validateGoogleConnectorSetup(req.body || {});
    res.status(validation.allowed ? 200 : 409).json({
      ok: validation.allowed,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "google_connector_setup_validation",
      validation,
      contract: buildGoogleConnectorContract(),
    });
  });

  app.post("/api/suite/governance/validate", auth, (req, res) => {
    const manifest = req.body?.governance_manifest || req.body?.manifest || req.body || {};
    const validation = validateSuiteGovernanceManifest(manifest);
    res.status(validation.allowed ? 200 : 409).json({
      ok: validation.allowed,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "suite_core_codex_governance_runtime",
      execution_allowed: validation.allowed && validation.status === "allow",
      validation,
    });
  });

  app.post("/api/suite/enterprise/runtime-contracts/validate", auth, (req, res) => {
    const contract = req.body?.runtime_contract || req.body?.contract || req.body || {};
    const validation = validateEnterpriseRuntimeContract(contract);
    res.status(validation.allowed ? 200 : 409).json({
      ok: validation.allowed,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "enterprise_runtime_contract_validation",
      execution_allowed: false,
      validation,
    });
  });

  app.post("/api/suite/core/nira-bridge", auth, async (req, res) => {
    const tenantId = req.body?.tenant_id || req.get("x-sh-tenant-id") || "";
    const payload = {
      request_id: req.body?.request_id || `suite_cp_nira_${crypto.randomUUID()}`,
      text: String(req.body?.text || req.body?.request || req.body?.task || "Suite Control Plane Nira bridge"),
      target_system: req.body?.target_system || "suite",
      mode: req.body?.mode || "standard",
      owner_confirmed: req.body?.owner_confirmed === true,
      branches: Array.isArray(req.body?.branches) ? req.body.branches : ["automation_control", "platform_engineering"],
      context: {
        source: "suite_control_plane",
        node_id: req.body?.node_id || "",
        no_auto_execute: true,
        ...(req.body?.context && typeof req.body.context === "object" ? req.body.context : {}),
      },
    };
    const result = await coreClient.niraBridge(tenantId, payload);
    res.status(result.status_code || (result.ok ? 200 : 424)).json({
      ok: result.ok,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "core_nira_bridge_proxy",
      execution_allowed: false,
      owner_confirmation_required: true,
      core: result.config,
      core_route: result.route || null,
      result: result.body,
      guardrails: {
        no_auto_execute: true,
        scoped_core_key_required: true,
        setup_specific_key_only: true,
        no_customer_key_hardcoded: true,
      },
    });
  });

  app.post("/api/suite/core/action-mediation", auth, async (req, res) => {
    const tenantId = req.body?.tenant_id || req.get("x-sh-tenant-id") || "";
    const action = req.body?.action || req.body || {};
    const governanceManifest = req.body?.governance_manifest || req.body?.manifest || null;
    if (governanceManifest || isGovernanceSensitiveAction(action)) {
      const validation = validateSuiteGovernanceManifest(governanceManifest);
      if (!validation.allowed) {
        return res.status(409).json({
          ok: false,
          service: "suite_control_plane",
          version: SERVICE_VERSION,
          mode: "suite_core_codex_governance_runtime",
          execution_allowed: false,
          error: "suite_governance_manifest_blocked",
          message: "Governance manifest mancante o non valido per azione sensibile.",
          validation,
        });
      }
    }
    if (isGovernanceSensitiveAction(action)) {
      const runtimeValidation = validateEnterpriseRuntimeContract(req.body?.runtime_contract || req.body?.enterprise_runtime_contract || null);
      if (!runtimeValidation.allowed) {
        return res.status(409).json({
          ok: false,
          service: "suite_control_plane",
          version: SERVICE_VERSION,
          mode: "enterprise_runtime_contract_enforcement",
          execution_allowed: false,
          error: "enterprise_runtime_contract_blocked",
          message: "Runtime contract mancante o non valido per azione sensibile.",
          validation: runtimeValidation,
        });
      }
    }

    const result = await coreClient.actionMediation(tenantId, {
      action,
      policy: req.body?.policy || {},
      context: {
        source: "suite_control_plane",
        no_auto_execute: true,
        governance_runtime_checked: true,
        ...(req.body?.context && typeof req.body.context === "object" ? req.body.context : {}),
      },
    });
    res.status(result.status_code || (result.ok ? 200 : 424)).json({
      ok: result.ok,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "core_action_mediation_proxy",
      execution_allowed: false,
      core: result.config,
      core_route: result.route || null,
      result: result.body,
    });
  });

  app.post("/api/suite/nodes/heartbeat", auth, (req, res) => {
    const node = storage.heartbeat(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      status: node.status,
      received_at: node.last_seen_at,
    });
  });

  app.post("/api/suite/nodes/snapshot", auth, (req, res) => {
    const node = storage.snapshot(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      snapshot_count: node.snapshot_count,
      received_at: node.last_seen_at,
    });
  });

  app.post("/api/suite/commerce/snapshot", auth, (req, res) => {
    const node = storage.commerceSnapshot(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      mode: "suite_commerce_snapshot_receiver",
      execution_allowed: false,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      commerce_snapshot_count: node.commerce_snapshot_count,
      received_at: node.last_seen_at,
      privacy: {
        aggregate_only: true,
        raw_customer_records_expected: false,
      },
    });
  });

  app.post("/api/suite/evidence", auth, (req, res) => {
    const { node, event } = storage.evidence(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      evidence_id: event.id,
      received_at: event.received_at,
    });
  });

  app.post("/api/suite/events/ingest", auth, (req, res) => {
    const { node, event } = storage.ingestSiteEvent(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      mode: "suite_event_spine_ingest",
      execution_allowed: false,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      event_id: event.id,
      event_type: event.event_type,
      received_at: event.received_at,
      privacy: event.privacy,
    });
  });

  app.get("/api/suite/tenants/:tenantId/events/summary", auth, (req, res) => {
    const days = Number.parseInt(req.query.days || "30", 10) || 30;
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      tenant_id: sanitizeId(req.params.tenantId, "tenant"),
      summary: storage.eventsSummary(req.params.tenantId, days),
    });
  });

  app.get("/api/suite/tenants/:tenantId/analytics/action-plan", auth, (req, res) => {
    const days = Number.parseInt(req.query.days || "30", 10) || 30;
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      tenant_id: sanitizeId(req.params.tenantId, "tenant"),
      action_plan: storage.analyticsActionPlan(req.params.tenantId, days),
    });
  });

  app.get("/api/suite/nodes/:nodeId/dashboard", auth, (req, res) => {
    const dashboard = storage.dashboard(req.params.nodeId);
    if (!dashboard) return publicError(res, 404, "suite_node_not_found");
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      dashboard,
    });
  });

  app.get("/api/suite/nodes/:nodeId/change-impact-contract", auth, (req, res) => {
    const result = storage.changeImpactContract(req.params.nodeId);
    if (!result) return publicError(res, 404, "suite_node_not_found");
    if (!result.contract) return publicError(res, 404, "suite_change_impact_contract_not_found");
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      ...result,
    });
  });

  return { app, storage };
}

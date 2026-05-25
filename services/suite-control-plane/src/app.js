import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SENSITIVE_ACTIONS, validateGovernanceRequest } from "./governance.js";

const SERVICE_VERSION = "0.4.0-google-oauth-tenant-connect";
const DEFAULT_MAX_EVENTS_PER_NODE = 250;
const GOOGLE_CONNECTOR_SCOPES = [
  "google_ads.readonly",
  "analytics.readonly",
];
const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/analytics.readonly",
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
const GOOGLE_PROVIDER_CONFIG_FIELDS = [
  "client_id",
  "client_secret",
  "developer_token",
  "redirect_uri",
];
const GOOGLE_OAUTH_CLIENT_ID = "1062915832418-t1i2r823u06ohuri3efhi5l92bm7oc4f.apps.googleusercontent.com";
const RUNBOOK_CATALOG = [
  {
    id: "site_clone_readiness",
    label: "Template clone readiness",
    category: "provisioning",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Verifica se un nodo WordPress e pronto per clone template, senza clonare o modificare il sito.",
  },
  {
    id: "plugin_update_preflight",
    label: "Plugin update preflight",
    category: "release",
    risk: "high",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Prepara controlli per aggiornamento plugin: versione, manifest, rollback e stato nodo.",
  },
  {
    id: "claim_price_guard_scan",
    label: "Claim and price guard scan",
    category: "governance",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Richiede una scansione controllata di claim, prezzi e policy commerciali.",
  },
  {
    id: "smartdesk_bridge_check",
    label: "Smart Desk bridge check",
    category: "integration",
    risk: "low",
    owner_confirmation_required: false,
    execution_mode: "proposal_only",
    description: "Controlla readiness bridge Smart Desk e produce prossime azioni senza inviare dati cliente raw.",
  },
  {
    id: "clone_waas_site",
    label: "Clone sito WaaS",
    category: "provisioning",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Prepara il piano controllato per clone template WaaS senza creare o modificare siti.",
  },
  {
    id: "setup_site_suite",
    label: "Setup Suite cliente",
    category: "configuration",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Prepara checklist e bozza setup Suite per cliente, senza scrivere configurazioni sul nodo.",
  },
  {
    id: "claim_price_audit",
    label: "Verifica claim/prezzi",
    category: "governance",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Accetta il runbook Suite locale per verifica claim e prezzi, come richiesta controllata read-only.",
  },
  {
    id: "customer_report",
    label: "Report cliente",
    category: "reporting",
    risk: "low",
    owner_confirmation_required: false,
    execution_mode: "proposal_only",
    description: "Accoda la generazione di un report cliente controllato usando solo summary e stato nodo.",
  },
  {
    id: "smartdesk_gold_customer_intelligence_sync",
    label: "Smart Desk Gold Customer Intelligence",
    category: "smartdesk_gold",
    risk: "low",
    owner_confirmation_required: false,
    execution_mode: "proposal_only",
    description: "Verifica contratto Customer Intelligence, consensi e readiness Gold senza inviare messaggi o modificare dati cliente.",
  },
  {
    id: "customer_360_profile_review",
    label: "Customer 360 profile review",
    category: "customer_intelligence",
    risk: "low",
    owner_confirmation_required: false,
    execution_mode: "proposal_only",
    description: "Prepara una revisione profilo cliente leggendo solo summary e readiness Core.",
  },
  {
    id: "journey_builder_guarded_draft",
    label: "Journey builder controllato",
    category: "marketing_governance",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Prepara bozze journey marketing governate da Core; nessun invio automatico e conferma owner/operatore obbligatoria.",
  },
];

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

function hasRuntimeValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return String(value ?? "").trim() !== "";
}

function normalizeBaseUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function sanitizeId(value, fallbackPrefix) {
  const raw = String(value || "").trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
  return cleaned || `${fallbackPrefix}_${crypto.randomUUID()}`;
}

function sanitizeGoogleAccountValue(value = "") {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_.:/-]/g, "_").slice(0, 160);
}

function isGovernanceSensitiveAction(action = {}) {
  return Boolean(action?.scope?.sensitive_action) || SENSITIVE_ACTIONS.has(action?.action_type);
}


function uniqueValues(values) {
  return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
}

function nodeReadiness(node) {
  const capabilities = Array.isArray(node?.latest_heartbeat?.capabilities) ? node.latest_heartbeat.capabilities : [];
  const validation = node?.latest_snapshot?.validation || {};
  const controlPlane = node?.latest_snapshot?.control_plane || {};
  const checks = {
    heartbeat: Boolean(node?.latest_heartbeat),
    snapshot: Boolean(node?.latest_snapshot),
    evidence: Number(node?.evidence_count || 0) > 0,
    change_impact_contract: Boolean(node?.latest_snapshot?.change_impact_orchestration),
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

function getRunbook(runbookId) {
  const id = sanitizeId(runbookId, "runbook");
  return RUNBOOK_CATALOG.find((runbook) => runbook.id === id) || null;
}

function buildRunbookPreview(runbook, node) {
  const nodeOnline = node && node.status === "online";
  const hasSnapshot = Boolean(node && node.latest_snapshot);
  const blocking = [];
  if (!node) blocking.push("node_not_registered");
  if (node && !nodeOnline) blocking.push("node_not_online");
  if (node && !hasSnapshot) blocking.push("snapshot_missing");

  const state = blocking.length === 0 ? "ready_for_owner_confirmation" : "blocked_until_node_ready";
  return {
    runbook_id: runbook.id,
    label: runbook.label,
    category: runbook.category,
    risk: runbook.risk,
    execution_mode: runbook.execution_mode,
    owner_confirmation_required: runbook.owner_confirmation_required,
    state,
    blocking,
    next_action: blocking.length === 0
      ? "Chiedere conferma owner e inviare al nodo solo come richiesta controllata."
      : "Registrare heartbeat/snapshot del nodo prima di preparare dispatch.",
  };
}

function buildEcosystemTracks(overview, runbooks, coreStatus) {
  const list = Array.isArray(runbooks) ? runbooks : [];
  const nodes = Array.isArray(overview?.nodes) ? overview.nodes : [];
  const suiteRunbooks = list.filter((runbook) => [
    "provisioning",
    "configuration",
    "release",
    "governance",
    "reporting",
  ].includes(runbook.category));
  const smartDeskRunbooks = list.filter((runbook) => [
    "integration",
    "smartdesk_gold",
    "customer_intelligence",
    "marketing_governance",
  ].includes(runbook.category));

  return {
    schema_version: "suite_ecosystem_tracks_v1",
    generated_at: nowIso(),
    core: {
      configured: Boolean(coreStatus?.configured),
      tenant_id: coreStatus?.tenant_id || "",
      provider_url: coreStatus?.provider_url || "",
    },
    suite_provider_track: {
      purpose: "vendere, configurare e governare nodi WordPress/Suite, tenant, runbook, audit e update controllati.",
      status: nodes.length ? "active" : "waiting_for_first_node",
      nodes_total: overview?.nodes_total || 0,
      nodes_online: overview?.nodes_online || 0,
      runbooks: suiteRunbooks.map((runbook) => ({
        id: runbook.id,
        label: runbook.label,
        category: runbook.category,
        risk: runbook.risk,
        owner_confirmation_required: runbook.owner_confirmation_required,
      })),
      next_actions: nodes.length
        ? ["verificare snapshot nodi", "accodare runbook solo con conferma quando richiesto", "salvare evidence/artifact"]
        : ["collegare primo nodo Suite/WordPress", "registrare heartbeat", "inviare snapshot readiness"],
    },
    smartdesk_gold_track: {
      purpose: "leggere operativita centro, profilazione cliente, consenso, marketing Gold e Customer Intelligence tramite Core.",
      status: coreStatus?.configured ? "core_ready" : "core_not_configured",
      runbooks: smartDeskRunbooks.map((runbook) => ({
        id: runbook.id,
        label: runbook.label,
        category: runbook.category,
        risk: runbook.risk,
        owner_confirmation_required: runbook.owner_confirmation_required,
      })),
      guardrails: [
        "nessun invio automatico",
        "consenso marketing obbligatorio",
        "operatore conferma sempre",
        "Core decide readiness/rischio",
      ],
      next_actions: [
        "mostrare stato Customer Intelligence Gold in Suite",
        "collegare report readiness per tenant",
        "preparare Customer 360 e journey controllato come runbook",
      ],
    },
  };
}

function normalizeGoogleProviderConfig(input = {}, previous = {}) {
  const next = { ...(previous && typeof previous === "object" ? previous : {}) };
  for (const field of GOOGLE_PROVIDER_CONFIG_FIELDS) {
    if (hasRuntimeValue(input[field])) {
      next[field] = String(input[field]).trim();
    }
  }
  next.updated_at = nowIso();
  return next;
}

function maskSecretValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length <= 8) return "***";
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

function maskGoogleProviderConfig(config = {}) {
  return {
    client_id_present: hasRuntimeValue(config.client_id),
    client_secret_present: hasRuntimeValue(config.client_secret),
    developer_token_present: hasRuntimeValue(config.developer_token),
    redirect_uri_present: hasRuntimeValue(config.redirect_uri),
    client_id_masked: maskSecretValue(config.client_id),
    redirect_uri: hasRuntimeValue(config.redirect_uri) ? String(config.redirect_uri) : "",
    updated_at: config.updated_at || "",
  };
}

function addSecondsIso(seconds = 0) {
  return new Date(Date.now() + Number(seconds || 0) * 1000).toISOString();
}

function isIsoAfterNow(value = "") {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) && time > Date.now() + 30000;
}

function buildGoogleOAuthState(tenantId = "") {
  return `${sanitizeId(tenantId || "tenant_demo", "tenant")}.${crypto.randomBytes(24).toString("base64url")}`;
}

function maskGoogleTenantConnection(connection = {}) {
  const selected = connection.selected_accounts && typeof connection.selected_accounts === "object"
    ? connection.selected_accounts
    : {};
  const token = connection.token && typeof connection.token === "object" ? connection.token : {};
  return {
    tenant_id: sanitizeId(connection.tenant_id || "tenant_demo", "tenant"),
    connected: connection.connected === true,
    authorized_at: connection.authorized_at || "",
    updated_at: connection.updated_at || "",
    token: {
      access_token_present: hasRuntimeValue(token.access_token),
      refresh_token_present: hasRuntimeValue(token.refresh_token),
      token_type: token.token_type || "",
      scope: token.scope || "",
      expires_at: token.expires_at || "",
    },
    selected_accounts: {
      google_ads_customer_id: selected.google_ads_customer_id || "",
      ga4_property_id: selected.ga4_property_id || "",
    },
    available_accounts: {
      google_ads_customers: Array.isArray(connection.available_accounts?.google_ads_customers)
        ? connection.available_accounts.google_ads_customers
        : [],
      ga4_properties: Array.isArray(connection.available_accounts?.ga4_properties)
        ? connection.available_accounts.ga4_properties
        : [],
    },
    last_error: connection.last_error || "",
  };
}

function normalizeGoogleTokenResponse(tokenResponse = {}) {
  const expiresIn = Number(tokenResponse.expires_in || 0);
  return {
    access_token: String(tokenResponse.access_token || ""),
    refresh_token: String(tokenResponse.refresh_token || ""),
    token_type: String(tokenResponse.token_type || ""),
    scope: String(tokenResponse.scope || ""),
    expires_at: expiresIn > 0 ? addSecondsIso(expiresIn) : "",
  };
}

async function exchangeGoogleOAuthCode(providerConfig = {}, code = "") {
  const body = new URLSearchParams({
    code: String(code || ""),
    client_id: String(providerConfig.client_id || ""),
    client_secret: String(providerConfig.client_secret || ""),
    redirect_uri: String(providerConfig.redirect_uri || ""),
    grant_type: "authorization_code",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: json.error || "google_token_exchange_failed",
      error_description: json.error_description || "",
    };
  }
  return { ok: true, token: normalizeGoogleTokenResponse(json) };
}

async function refreshGoogleAccessToken(providerConfig = {}, connection = {}) {
  const token = connection.token && typeof connection.token === "object" ? connection.token : {};
  if (hasRuntimeValue(token.access_token) && isIsoAfterNow(token.expires_at)) {
    return { ok: true, token, refreshed: false };
  }
  if (!hasRuntimeValue(token.refresh_token)) {
    return { ok: false, error: "google_refresh_token_missing" };
  }
  const body = new URLSearchParams({
    client_id: String(providerConfig.client_id || ""),
    client_secret: String(providerConfig.client_secret || ""),
    refresh_token: String(token.refresh_token || ""),
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, status: response.status, error: json.error || "google_token_refresh_failed" };
  }
  return {
    ok: true,
    refreshed: true,
    token: {
      ...token,
      ...normalizeGoogleTokenResponse(json),
      refresh_token: token.refresh_token,
    },
  };
}

async function fetchGoogleAccountOptions(providerConfig = {}, connection = {}) {
  const access = await refreshGoogleAccessToken(providerConfig, connection);
  if (!access.ok) {
    return { ok: false, token: connection.token || {}, accounts: { google_ads_customers: [], ga4_properties: [] }, error: access.error };
  }
  const headers = { authorization: `Bearer ${access.token.access_token}` };
  const adsHeaders = {
    ...headers,
    "developer-token": String(providerConfig.developer_token || ""),
  };
  const accounts = { google_ads_customers: [], ga4_properties: [] };
  const errors = [];

  try {
    const response = await fetch("https://googleads.googleapis.com/v17/customers:listAccessibleCustomers", { headers: adsHeaders });
    const json = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(json.resourceNames)) {
      accounts.google_ads_customers = json.resourceNames.map((name) => String(name).replace(/^customers\//, ""));
    } else {
      errors.push("google_ads_customers_unavailable");
    }
  } catch {
    errors.push("google_ads_customers_unavailable");
  }

  try {
    const response = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", { headers });
    const json = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(json.accountSummaries)) {
      accounts.ga4_properties = json.accountSummaries.flatMap((account) => (
        Array.isArray(account.propertySummaries)
          ? account.propertySummaries.map((property) => ({
            property: String(property.property || ""),
            display_name: String(property.displayName || ""),
            parent_account: String(account.account || ""),
          }))
          : []
      )).filter((property) => property.property);
    } else {
      errors.push("ga4_properties_unavailable");
    }
  } catch {
    errors.push("ga4_properties_unavailable");
  }

  return { ok: errors.length === 0, token: access.token, accounts, errors, refreshed: access.refreshed };
}

function resolveGoogleProviderConfig(storedConfig = {}) {
  const publicBaseUrl = normalizeBaseUrl(process.env.SUITE_CONTROL_PLANE_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "");
  return {
    client_id: GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || storedConfig.client_id || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || storedConfig.client_secret || "",
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || storedConfig.developer_token || "",
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI || storedConfig.redirect_uri || (publicBaseUrl ? `${publicBaseUrl}/api/suite/integrations/google/oauth/callback` : ""),
    updated_at: storedConfig.updated_at || "",
  };
}

function buildGoogleConnectorContract(storedProviderConfig = {}) {
  const resolvedProviderConfig = resolveGoogleProviderConfig(storedProviderConfig);
  const publicBaseUrl = normalizeBaseUrl(process.env.SUITE_CONTROL_PLANE_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "");
  const redirectUri = resolvedProviderConfig.redirect_uri || (publicBaseUrl ? `${publicBaseUrl}/api/suite/integrations/google/oauth/callback` : "");
  const provider = {
    client_id_configured: hasRuntimeValue(resolvedProviderConfig.client_id),
    client_secret_configured: hasRuntimeValue(resolvedProviderConfig.client_secret),
    developer_token_configured: hasRuntimeValue(resolvedProviderConfig.developer_token),
    redirect_uri: redirectUri,
    source: process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_ADS_DEVELOPER_TOKEN
      ? "render_environment"
      : (hasRuntimeValue(storedProviderConfig.client_id) || hasRuntimeValue(storedProviderConfig.client_secret) || hasRuntimeValue(storedProviderConfig.developer_token)
        ? "suite_provider_config"
        : "not_configured"),
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
    scopes: GOOGLE_CONNECTOR_SCOPES,
    branches: [
      "paid_ads_guard",
      "funnel_conversion_guard",
      "customer_behavior_analysis",
      "claim_guard",
      "pricing_guard",
      "business_governance",
    ],
    next_action: missingProviderFields.length
      ? "Configurare credenziali provider Google dal pannello Suite Provider o da Render; il cliente vedra comunque il flusso semplice Collega Google."
      : "Abilitare OAuth reale e selezione account/proprieta per tenant.",
  };
}

function buildGoogleConnectorStatus(tenantId = "", storedProviderConfig = {}, tenantConnection = {}) {
  const contract = buildGoogleConnectorContract(storedProviderConfig);
  const tenantKey = sanitizeId(tenantId || "tenant_demo", "tenant");
  const simulatedAuthorized = String(process.env.GOOGLE_CONNECTOR_DEMO_CONNECTED || "").toLowerCase() === "true";
  const adsCustomerId = process.env.GOOGLE_ADS_CUSTOMER_ID || "";
  const ga4PropertyId = process.env.GA4_PROPERTY_ID || "";
  const maskedConnection = maskGoogleTenantConnection({
    tenant_id: tenantKey,
    ...(tenantConnection && typeof tenantConnection === "object" ? tenantConnection : {}),
  });
  const selectedAdsCustomerId = maskedConnection.selected_accounts.google_ads_customer_id || adsCustomerId;
  const selectedGa4PropertyId = maskedConnection.selected_accounts.ga4_property_id || ga4PropertyId;
  const tenantConnected = maskedConnection.connected || (simulatedAuthorized && Boolean(adsCustomerId || ga4PropertyId));
  const hasSelection = Boolean(selectedAdsCustomerId || selectedGa4PropertyId);

  return {
    ok: true,
    schema_version: "suite_google_connector_status_v1",
    service_version: SERVICE_VERSION,
    tenant_id: tenantKey,
    mode: contract.mode,
    provider_ready: contract.provider_ready,
    connected: tenantConnected,
    state: tenantConnected
      ? (hasSelection ? "connected" : "authorized_needs_account_selection")
      : (contract.provider_ready ? "ready_to_connect" : "provider_setup_required"),
    connect_url: `/api/suite/integrations/google/connect?tenant_id=${encodeURIComponent(tenantKey)}`,
    selected_accounts: {
      google_ads_customer_id_present: Boolean(selectedAdsCustomerId),
      ga4_property_id_present: Boolean(selectedGa4PropertyId),
      google_ads_customer_id: selectedAdsCustomerId,
      ga4_property_id: selectedGa4PropertyId,
    },
    capability: {
      can_read_google_ads: tenantConnected && Boolean(selectedAdsCustomerId),
      can_read_ga4: tenantConnected && Boolean(selectedGa4PropertyId),
      can_change_campaigns: false,
      can_change_budget: false,
    },
    owner_visible_copy: tenantConnected
      ? "Google collegato. Suite puo leggere campagne e Analytics; Core decide priorita e azioni consigliate."
      : "Google non collegato. Il cliente clicca Collega Google, accede e autorizza SkinHarmony.",
    missing_provider_fields: contract.missing_provider_fields,
    provider_config: maskGoogleProviderConfig(resolveGoogleProviderConfig(storedProviderConfig)),
    tenant_connection: maskedConnection,
    contract,
  };
}

function validateGoogleConnectorSetup(input = {}) {
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

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderGoogleConnectPage(payload) {
  const missing = Array.isArray(payload.missing_provider_fields) ? payload.missing_provider_fields : [];
  const chips = missing.length
    ? missing.map((field) => `<span>${escapeHtml(field)}</span>`).join("")
    : "<span>provider_ready</span>";
  const stateLabel = payload.connected ? "Collegato" : (payload.provider_ready ? "Pronto per OAuth" : "Setup provider richiesto");
  const stateClass = payload.connected || payload.provider_ready ? "ok" : "wait";
  const cta = payload.oauth_url && !payload.connected
    ? `<p><a class="button" href="${escapeHtml(payload.oauth_url)}">Collega Google</a></p>`
    : "";

  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SkinHarmony Google Connector</title>
  <style>
    body{margin:0;background:#f6f8fb;color:#172033;font-family:Inter,Arial,sans-serif}
    main{min-height:100vh;display:grid;place-items:center;padding:32px}
    .panel{width:min(920px,100%);background:#fff;border:1px solid #dbe7f3;border-radius:18px;box-shadow:0 24px 80px rgba(23,32,51,.10);overflow:hidden}
    .head{padding:34px 38px;background:linear-gradient(135deg,#eef9fd,#ffffff 55%,#f6f0ff)}
    .kicker{font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#4b82bd}
    h1{margin:12px 0 10px;font-size:34px;line-height:1.05}
    p{margin:0;color:#5b6b80;font-size:16px;line-height:1.55}
    .body{padding:30px 38px;display:grid;gap:22px}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
    .card{border:1px solid #dbe7f3;border-radius:14px;padding:18px;background:#fbfdff}
    .label{display:block;color:#728197;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px}
    .value{font-size:20px;font-weight:800;color:#1d365c}
    .value.ok{color:#257d55}.value.wait{color:#af6b00}
    .chips{display:flex;gap:8px;flex-wrap:wrap}
    .chips span{border:1px solid #cfe0f2;border-radius:999px;padding:8px 10px;background:#fff;color:#42566f;font-size:13px;font-weight:700}
    .notice{border:1px solid #f2d7a8;background:#fff8ea;border-radius:14px;padding:18px;color:#65470d}
    .button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:10px;background:#1d365c;color:#fff;text-decoration:none;font-weight:800;margin-top:14px}
    .rules{display:grid;gap:8px;margin:0;padding:0;list-style:none}
    .rules li{padding:10px 12px;border:1px solid #dbe7f3;border-radius:12px;background:#fff}
    .foot{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:20px 38px;background:#f8fbfe;border-top:1px solid #dbe7f3}
    code{background:#eef3f8;border-radius:8px;padding:4px 7px}
    @media(max-width:760px){.grid{grid-template-columns:1fr}.head,.body,.foot{padding-left:22px;padding-right:22px}.foot{display:block}h1{font-size:28px}}
  </style>
</head>
<body>
<main>
  <section class="panel">
    <div class="head">
      <div class="kicker">SkinHarmony Suite Control Plane</div>
      <h1>Google Connector</h1>
      <p>${escapeHtml(payload.customer_action)}</p>
    </div>
    <div class="body">
      <div class="grid">
        <div class="card"><span class="label">Tenant</span><div class="value">${escapeHtml(payload.tenant_id)}</div></div>
        <div class="card"><span class="label">Stato</span><div class="value ${stateClass}">${stateLabel}</div></div>
        <div class="card"><span class="label">Esecuzione</span><div class="value wait">Solo setup</div></div>
      </div>
      <div class="notice">${escapeHtml(payload.next_action)}${cta}</div>
      <div>
        <span class="label">Campi provider mancanti</span>
        <div class="chips">${chips}</div>
      </div>
      <ul class="rules">
        <li>Nessuna API key Google viene chiesta al cliente.</li>
        <li>Nessuna campagna, budget o keyword viene modificata automaticamente.</li>
        <li>Le metriche verranno lette solo dopo OAuth e consenso.</li>
        <li>Core decide priorita e azioni consigliate; l owner conferma le azioni sensibili.</li>
      </ul>
    </div>
    <div class="foot">
      <span>Versione <code>${escapeHtml(payload.version)}</code></span>
      <span>Endpoint read-only</span>
    </div>
  </section>
</main>
</body>
</html>`;
}

function createMemoryStorage(options = {}) {
  const nodes = new Map((options.nodes || []).map((node) => [node.node_id, node]));
  const evidence = Array.isArray(options.evidence) ? options.evidence : [];
  const dispatches = Array.isArray(options.dispatches) ? options.dispatches : [];
  const artifacts = Array.isArray(options.artifacts) ? options.artifacts : [];
  const googleTenantConnections = new Map(Object.entries(
    options.googleTenantConnections && typeof options.googleTenantConnections === "object"
      ? options.googleTenantConnections
      : {},
  ));
  const googleOAuthStates = new Map(Object.entries(
    options.googleOAuthStates && typeof options.googleOAuthStates === "object"
      ? options.googleOAuthStates
      : {},
  ));
  let googleProviderConfig = options.googleProviderConfig && typeof options.googleProviderConfig === "object"
    ? options.googleProviderConfig
    : {};
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};

  function emitChange() {
    onChange({
      nodes: Array.from(nodes.values()),
      evidence,
      dispatches,
      artifacts,
      googleProviderConfig,
      googleTenantConnections: Object.fromEntries(googleTenantConnections),
      googleOAuthStates: Object.fromEntries(googleOAuthStates),
    });
  }

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
        evidence_count: 0,
        latest_heartbeat: null,
        latest_snapshot: null,
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
      },
      appendNodeEvent(node, "heartbeat", node.latest_heartbeat);
      emitChange();
      return node;
    },
    snapshot(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      node.snapshot_count += 1;
      node.last_seen_at = nowIso();
      node.latest_snapshot = {
        received_at: node.last_seen_at,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
        control_plane: payload.control_plane && typeof payload.control_plane === "object" ? payload.control_plane : {},
        validation: payload.validation && typeof payload.validation === "object" ? payload.validation : {},
        change_impact_orchestration: payload.change_impact_orchestration && typeof payload.change_impact_orchestration === "object" ? payload.change_impact_orchestration : null,
      };
      appendNodeEvent(node, "snapshot", node.latest_snapshot);
      emitChange();
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
      emitChange();
      return { node, event };
    },
    runbookCatalog() {
      return RUNBOOK_CATALOG;
    },
    googleProviderConfig() {
      return googleProviderConfig;
    },
    googleProviderConfigMasked() {
      return maskGoogleProviderConfig(resolveGoogleProviderConfig(googleProviderConfig));
    },
    saveGoogleProviderConfig(payload = {}) {
      const next = normalizeGoogleProviderConfig(payload, googleProviderConfig);
      googleProviderConfig = next;
      const event = {
        id: `google_provider_config_${crypto.randomUUID()}`,
        received_at: nowIso(),
        evidence_type: "google_provider_config_saved",
        decision: "provider_config_updated",
        risk: "medium",
        audit_id: null,
        payload: {
          provider_config: maskGoogleProviderConfig(resolveGoogleProviderConfig(next)),
          source: "suite_provider_panel",
        },
      };
      evidence.unshift(event);
      if (evidence.length > 1000) evidence.length = 1000;
      emitChange();
      return {
        saved: true,
        saved_at: next.updated_at,
        provider_config: maskGoogleProviderConfig(resolveGoogleProviderConfig(next)),
        evidence_id: event.id,
      };
    },
    createGoogleOAuthState(tenantId, payload = {}) {
      const tenantKey = sanitizeId(tenantId || "tenant_demo", "tenant");
      const state = buildGoogleOAuthState(tenantKey);
      googleOAuthStates.set(state, {
        state,
        tenant_id: tenantKey,
        created_at: nowIso(),
        expires_at: addSecondsIso(600),
        payload: payload && typeof payload === "object" ? payload : {},
      });
      emitChange();
      return googleOAuthStates.get(state);
    },
    consumeGoogleOAuthState(state) {
      const key = String(state || "");
      const record = googleOAuthStates.get(key);
      if (!record) return null;
      googleOAuthStates.delete(key);
      emitChange();
      if (!isIsoAfterNow(record.expires_at)) {
        return null;
      }
      return record;
    },
    googleTenantConnection(tenantId) {
      const tenantKey = sanitizeId(tenantId || "tenant_demo", "tenant");
      return googleTenantConnections.get(tenantKey) || null;
    },
    saveGoogleTenantConnection(tenantId, payload = {}) {
      const tenantKey = sanitizeId(tenantId || "tenant_demo", "tenant");
      const previous = googleTenantConnections.get(tenantKey) || {};
      const token = payload.token && typeof payload.token === "object" ? payload.token : previous.token || {};
      const selectedAccounts = payload.selected_accounts && typeof payload.selected_accounts === "object"
        ? payload.selected_accounts
        : previous.selected_accounts || {};
      const availableAccounts = payload.available_accounts && typeof payload.available_accounts === "object"
        ? payload.available_accounts
        : previous.available_accounts || {};
      const connection = {
        ...previous,
        tenant_id: tenantKey,
        connected: payload.connected !== undefined ? payload.connected === true : previous.connected === true,
        authorized_at: payload.authorized_at || previous.authorized_at || nowIso(),
        updated_at: nowIso(),
        token,
        selected_accounts: selectedAccounts,
        available_accounts: availableAccounts,
        last_error: payload.last_error || "",
      };
      googleTenantConnections.set(tenantKey, connection);
      const event = {
        id: `google_tenant_connection_${crypto.randomUUID()}`,
        received_at: nowIso(),
        evidence_type: "google_tenant_connection_saved",
        tenant_id: tenantKey,
        decision: "tenant_google_connected",
        risk: "medium",
        audit_id: null,
        payload: maskGoogleTenantConnection(connection),
      };
      evidence.unshift(event);
      if (evidence.length > 1000) evidence.length = 1000;
      emitChange();
      return maskGoogleTenantConnection(connection);
    },
    selectGoogleAccounts(tenantId, selection = {}) {
      const tenantKey = sanitizeId(tenantId || "tenant_demo", "tenant");
      const previous = googleTenantConnections.get(tenantKey);
      if (!previous) return null;
      const adsCustomerId = String(selection.google_ads_customer_id || selection.ads_customer_id || previous.selected_accounts?.google_ads_customer_id || "").trim();
      const ga4PropertyId = String(selection.ga4_property_id || selection.property_id || previous.selected_accounts?.ga4_property_id || "").trim();
      return this.saveGoogleTenantConnection(tenantKey, {
        ...previous,
        selected_accounts: {
          google_ads_customer_id: sanitizeGoogleAccountValue(adsCustomerId),
          ga4_property_id: sanitizeGoogleAccountValue(ga4PropertyId),
        },
      });
    },
    runbookPreview(payload) {
      const runbook = getRunbook(payload.runbook_id);
      if (!runbook) return null;
      const node = nodes.get(sanitizeId(payload.node_id, "node")) || null;
      return buildRunbookPreview(runbook, node);
    },
    runbookDispatch(payload) {
      const runbook = getRunbook(payload.runbook_id);
      if (!runbook) return null;
      const node = nodes.get(sanitizeId(payload.node_id, "node")) || null;
      const preview = buildRunbookPreview(runbook, node);
      const ownerConfirmed = payload.owner_confirmed === true || payload.owner_confirmed === "true" || payload.owner_confirmed === "yes";
      const accepted = preview.state === "ready_for_owner_confirmation"
        && (!runbook.owner_confirmation_required || ownerConfirmed);
      const dispatch = {
        id: `dispatch_${crypto.randomUUID()}`,
        created_at: nowIso(),
        runbook_id: runbook.id,
        node_id: node ? node.node_id : sanitizeId(payload.node_id, "node"),
        tenant_id: node ? node.tenant_id : sanitizeId(payload.tenant_id, "tenant"),
        state: accepted ? "queued_for_node_pull" : "not_queued",
        accepted,
        owner_confirmed: ownerConfirmed,
        execution_mode: runbook.execution_mode,
        risk: runbook.risk,
        preview,
        payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {},
      };
      dispatches.unshift(dispatch);
      if (dispatches.length > 1000) dispatches.length = 1000;
      if (node) {
        appendNodeEvent(node, "runbook_dispatch", dispatch);
      }
      emitChange();
      return dispatch;
    },
    runbookArtifact(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      const artifact = {
        id: `artifact_${crypto.randomUUID()}`,
        received_at: nowIso(),
        node_id: node.node_id,
        tenant_id: node.tenant_id,
        runbook_id: sanitizeId(payload.runbook_id, "runbook"),
        artifact_type: sanitizeId(payload.artifact_type || "runbook_execution_record", "artifact_type"),
        signature: String(payload.signature || ""),
        source: String(payload.source || "wordpress_node"),
        payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {},
      };
      artifacts.unshift(artifact);
      if (artifacts.length > 1000) artifacts.length = 1000;
      node.last_seen_at = artifact.received_at;
      node.runbook_artifact_count = (node.runbook_artifact_count || 0) + 1;
      appendNodeEvent(node, "runbook_artifact", artifact);
      emitChange();
      return { node, artifact };
    },
    runbookArtifacts(nodeId, limit = 50) {
      const id = sanitizeId(nodeId, "node");
      return artifacts.filter((item) => item.node_id === id).slice(0, limit);
    },
    dashboard(nodeId) {
      const node = nodes.get(sanitizeId(nodeId, "node"));
      if (!node) return null;
      return {
        node,
        recent_events: node.events.slice(0, 50),
        evidence: evidence.filter((item) => item.node_id === node.node_id).slice(0, 50),
        dispatches: dispatches.filter((item) => item.node_id === node.node_id).slice(0, 50),
        runbook_artifacts: artifacts.filter((item) => item.node_id === node.node_id).slice(0, 50),
      };
    },
    overview() {
      const allNodes = Array.from(nodes.values());
      return {
        nodes_total: allNodes.length,
        nodes_online: allNodes.filter((node) => node.status === "online").length,
        evidence_total: evidence.length,
        dispatches_total: dispatches.length,
        runbook_artifacts_total: artifacts.length,
        runbooks_total: RUNBOOK_CATALOG.length,
        nodes: allNodes
          .map((node) => ({
            node_id: node.node_id,
            tenant_id: node.tenant_id,
            status: node.status,
            last_seen_at: node.last_seen_at,
            heartbeat_count: node.heartbeat_count,
            snapshot_count: node.snapshot_count,
            evidence_count: node.evidence_count,
            runbook_artifact_count: node.runbook_artifact_count || 0,
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
        evidence_count: node.evidence_count,
        runbook_artifact_count: node.runbook_artifact_count || 0,
        readiness: nodeReadiness(node),
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
    }

  };
}

function createSuiteControlStorage() {
  const storageRoot = process.env.SUITE_CONTROL_STORAGE_ROOT || "";
  if (!storageRoot) return createMemoryStorage();

  fs.mkdirSync(storageRoot, { recursive: true });
  const stateFile = path.join(storageRoot, "suite-control-state.json");
  let initialState = {
    nodes: [],
    evidence: [],
    dispatches: [],
    artifacts: [],
    google_provider_config: {},
    google_tenant_connections: {},
    google_oauth_states: {},
  };
  if (fs.existsSync(stateFile)) {
    try {
      initialState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      initialState = {
        nodes: [],
        evidence: [],
        dispatches: [],
        artifacts: [],
        google_provider_config: {},
        google_tenant_connections: {},
        google_oauth_states: {},
      };
    }
  }

  const storage = createMemoryStorage({
    nodes: Array.isArray(initialState.nodes) ? initialState.nodes : [],
    evidence: Array.isArray(initialState.evidence) ? initialState.evidence : [],
    dispatches: Array.isArray(initialState.dispatches) ? initialState.dispatches : [],
    artifacts: Array.isArray(initialState.artifacts) ? initialState.artifacts : [],
    googleProviderConfig: initialState.google_provider_config && typeof initialState.google_provider_config === "object" ? initialState.google_provider_config : {},
    googleTenantConnections: initialState.google_tenant_connections && typeof initialState.google_tenant_connections === "object" ? initialState.google_tenant_connections : {},
    googleOAuthStates: initialState.google_oauth_states && typeof initialState.google_oauth_states === "object" ? initialState.google_oauth_states : {},
    onChange(state) {
      const tmpFile = `${stateFile}.tmp`;
      fs.writeFileSync(tmpFile, `${JSON.stringify({
        saved_at: nowIso(),
        nodes: state.nodes,
        evidence: state.evidence.slice(0, 1000),
        dispatches: state.dispatches.slice(0, 1000),
        artifacts: state.artifacts.slice(0, 1000),
        google_provider_config: state.googleProviderConfig || {},
        google_tenant_connections: state.googleTenantConnections || {},
        google_oauth_states: state.googleOAuthStates || {},
      }, null, 2)}\n`);
      fs.renameSync(tmpFile, stateFile);
    },
  });
  storage.mode = "file";
  storage.state_file = stateFile;
  return storage;
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

function createUniversalCoreClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.UNIVERSAL_CORE_URL);
  const apiKey = String(options.apiKey || process.env.UNIVERSAL_CORE_KEY || "").trim();
  const defaultTenantId = sanitizeId(options.tenantId || process.env.UNIVERSAL_CORE_TENANT_ID || "suite-control-plane", "tenant");
  const timeoutMs = Number(options.timeoutMs || process.env.UNIVERSAL_CORE_TIMEOUT_MS || 8000);

  async function request(method, route, body, tenantId = defaultTenantId) {
    if (!baseUrl || !apiKey) {
      return { success: false, code: "universal_core_not_configured" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          "x-sh-tenant-id": tenantId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }
      return {
        success: response.ok && json.ok !== false,
        http_status: response.status,
        provider_url: baseUrl,
        ...json,
      };
    } catch (error) {
      return {
        success: false,
        code: error?.name === "AbortError" ? "universal_core_timeout" : "universal_core_unreachable",
        provider_url: baseUrl,
        message: error instanceof Error ? error.message : "Universal Core non raggiungibile.",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    isConfigured: () => Boolean(baseUrl && apiKey),
    status: () => ({ configured: Boolean(baseUrl && apiKey), provider_url: baseUrl, tenant_id: defaultTenantId }),
    customerIntelligenceContract: (tenantId = defaultTenantId) => request("GET", `/v1/customer-intelligence/contract?tenant_id=${encodeURIComponent(tenantId)}`, undefined, tenantId),
    customerIntelligenceReadiness: (payload = {}, tenantId = defaultTenantId) => request("POST", "/v1/customer-intelligence/readiness", {
      tenant_id: tenantId,
      events: Array.isArray(payload.events) ? payload.events : [],
      consents: Array.isArray(payload.consents) ? payload.consents : [],
      customer_profile: payload.customer_profile || payload.customerProfile || {},
    }, tenantId),
    actionMediation: (tenantId = defaultTenantId, payload = {}) => request("POST", "/v1/action-mediation/evaluate", payload, tenantId),
  };
}

export function createSuiteControlPlane(options = {}) {
  const app = express();
  const storage = options.storage || createSuiteControlStorage();
  const coreClient = options.coreClient || createUniversalCoreClient(options.universalCore || {});
  const auth = createAuth();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "skinharmony-suite-control-plane",
      version: SERVICE_VERSION,
      storage_mode: storage.mode,
      storage_persistent: storage.mode === "file",
      universal_core: coreClient.status(),
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
          core_bridge: coreClient.status(),
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
        core_bridge: coreClient.status(),
      },
    });
  });

  app.get("/api/suite/ecosystem/tracks", auth, (req, res) => {
    const overview = storage.overview();
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      tracks: buildEcosystemTracks(overview, storage.runbookCatalog(), coreClient.status()),
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

  app.get("/api/suite/runbooks", auth, (req, res) => {
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      runbooks: storage.runbookCatalog(),
    });
  });

  app.get("/api/suite/integrations/google/status", auth, (req, res) => {
    const tenantId = req.query.tenant_id || req.get("x-sh-tenant-id") || "";
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      google: buildGoogleConnectorStatus(tenantId, storage.googleProviderConfig(), storage.googleTenantConnection(tenantId)),
    });
  });

  app.get("/api/suite/integrations/google/provider-config", auth, (req, res) => {
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      provider_config: storage.googleProviderConfigMasked(),
      required_fields: GOOGLE_PROVIDER_CONFIG_FIELDS,
      message: "Configurazione provider salvata lato Suite Control Plane. I segreti non vengono restituiti.",
    });
  });

  app.post("/api/suite/integrations/google/provider-config", auth, (req, res) => {
    const provider = req.body?.provider && typeof req.body.provider === "object" ? req.body.provider : req.body || {};
    const validation = validateGoogleConnectorSetup({
      provider,
      tenant: {
        tenant_id: "provider_config",
        google_user_authorized: true,
        ads_customer_id: "provider_setup",
        ga4_property_id: "provider_setup",
      },
    });
    if (!validation.allowed) {
      return res.status(409).json({
        ok: false,
        service: "suite_control_plane",
        version: SERVICE_VERSION,
        error: "google_provider_config_invalid",
        validation,
      });
    }
    const saved = storage.saveGoogleProviderConfig(provider);
    return res.status(201).json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "google_provider_config_saved",
      execution_allowed: false,
      ...saved,
    });
  });

  app.get("/api/suite/integrations/google/connect", (req, res) => {
    const tenantId = sanitizeId(req.query.tenant_id || req.get("x-sh-tenant-id") || "tenant_demo", "tenant");
    const status = buildGoogleConnectorStatus(tenantId, storage.googleProviderConfig(), storage.googleTenantConnection(tenantId));
    const payload = {
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "google_oauth_connect",
      tenant_id: tenantId,
      customer_action: "Il cliente clicca Collega Google, fa login e autorizza SkinHarmony. Nessuna API key viene chiesta al cliente.",
      provider_ready: status.provider_ready,
      connected: status.connected,
      state: status.state,
      oauth_start_ready: status.provider_ready,
      oauth_url: status.provider_ready ? `/api/suite/integrations/google/oauth/start?tenant_id=${encodeURIComponent(tenantId)}` : "",
      missing_provider_fields: status.missing_provider_fields,
      execution_allowed: false,
      next_action: status.provider_ready
        ? (status.connected ? "Google autorizzato. Selezionare account Google Ads e proprieta GA4 dal pannello protetto." : "Cliccare Collega Google per avviare OAuth reale.")
        : "Configurare Google Client ID, Client Secret, Developer Token e Redirect URI dal pannello Suite Provider.",
    };
    const acceptsHtml = String(req.get("accept") || "").includes("text/html");
    if (acceptsHtml) {
      return res.type("html").send(renderGoogleConnectPage(payload));
    }
    return res.json(payload);
  });

  app.get("/api/suite/integrations/google/oauth/start", (req, res) => {
    const tenantId = sanitizeId(req.query.tenant_id || req.get("x-sh-tenant-id") || "tenant_demo", "tenant");
    const provider = resolveGoogleProviderConfig(storage.googleProviderConfig());
    const status = buildGoogleConnectorStatus(tenantId, storage.googleProviderConfig(), storage.googleTenantConnection(tenantId));
    if (!status.provider_ready) {
      return publicError(res, 409, "google_provider_not_ready", "Configurazione provider Google incompleta.");
    }
    const stateRecord = storage.createGoogleOAuthState(tenantId, {
      source: "google_oauth_start",
      user_agent: String(req.get("user-agent") || "").slice(0, 180),
    });
    const oauthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    oauthUrl.searchParams.set("client_id", provider.client_id);
    oauthUrl.searchParams.set("redirect_uri", provider.redirect_uri);
    oauthUrl.searchParams.set("response_type", "code");
    oauthUrl.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
    oauthUrl.searchParams.set("access_type", "offline");
    oauthUrl.searchParams.set("prompt", "consent");
    oauthUrl.searchParams.set("include_granted_scopes", "true");
    oauthUrl.searchParams.set("state", stateRecord.state);

    if (req.query.format === "json") {
      return res.json({
        ok: true,
        service: "suite_control_plane",
        version: SERVICE_VERSION,
        tenant_id: tenantId,
        redirect_url: oauthUrl.toString(),
        expires_at: stateRecord.expires_at,
      });
    }
    return res.redirect(302, oauthUrl.toString());
  });

  app.get("/api/suite/integrations/google/oauth/callback", async (req, res) => {
    const stateRecord = storage.consumeGoogleOAuthState(req.query.state);
    const wantsJson = String(req.get("accept") || "").includes("application/json") || req.query.format === "json";
    if (!stateRecord) {
      const payload = { ok: false, error: "google_oauth_state_invalid_or_expired" };
      return wantsJson ? res.status(400).json(payload) : res.status(400).type("html").send(renderGoogleConnectPage({
        ...payload,
        version: SERVICE_VERSION,
        tenant_id: "unknown",
        customer_action: "OAuth Google non completato: sessione scaduta o non valida.",
        provider_ready: true,
        connected: false,
        missing_provider_fields: [],
        next_action: "Tornare in Suite e riavviare Collega Google.",
      }));
    }
    if (req.query.error) {
      const payload = { ok: false, error: "google_oauth_denied", google_error: String(req.query.error || "") };
      return wantsJson ? res.status(400).json(payload) : res.status(400).type("html").send(renderGoogleConnectPage({
        ...payload,
        version: SERVICE_VERSION,
        tenant_id: stateRecord.tenant_id,
        customer_action: "OAuth Google non autorizzato.",
        provider_ready: true,
        connected: false,
        missing_provider_fields: [],
        next_action: "Autorizzare l accesso Google per collegare Ads e Analytics.",
      }));
    }
    const provider = resolveGoogleProviderConfig(storage.googleProviderConfig());
    const exchange = await exchangeGoogleOAuthCode(provider, req.query.code);
    if (!exchange.ok) {
      const payload = { ok: false, error: exchange.error || "google_token_exchange_failed" };
      return wantsJson ? res.status(502).json(payload) : res.status(502).type("html").send(renderGoogleConnectPage({
        ...payload,
        version: SERVICE_VERSION,
        tenant_id: stateRecord.tenant_id,
        customer_action: "OAuth Google ricevuto, ma lo scambio token non e riuscito.",
        provider_ready: true,
        connected: false,
        missing_provider_fields: [],
        next_action: "Verificare redirect URI e credenziali provider Google, poi riprovare.",
      }));
    }
    const connection = {
      connected: true,
      authorized_at: nowIso(),
      token: exchange.token,
      selected_accounts: {},
      available_accounts: { google_ads_customers: [], ga4_properties: [] },
    };
    const accountOptions = await fetchGoogleAccountOptions(provider, connection);
    const saved = storage.saveGoogleTenantConnection(stateRecord.tenant_id, {
      ...connection,
      token: accountOptions.token || connection.token,
      available_accounts: accountOptions.accounts || connection.available_accounts,
      last_error: accountOptions.ok ? "" : uniqueValues(accountOptions.errors || [accountOptions.error]).join(","),
    });
    const payload = {
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "google_oauth_callback_completed",
      tenant_id: stateRecord.tenant_id,
      connection: saved,
      execution_allowed: false,
      next_action: "Selezionare account Google Ads e proprieta GA4 dal pannello protetto.",
    };
    return wantsJson ? res.status(201).json(payload) : res.type("html").send(renderGoogleConnectPage({
      ...payload,
      customer_action: "Google autorizzato per SkinHarmony Suite.",
      provider_ready: true,
      connected: true,
      missing_provider_fields: [],
    }));
  });

  app.get("/api/suite/integrations/google/accounts", auth, async (req, res) => {
    const tenantId = sanitizeId(req.query.tenant_id || req.get("x-sh-tenant-id") || "tenant_demo", "tenant");
    const connection = storage.googleTenantConnection(tenantId);
    if (!connection || connection.connected !== true) {
      return publicError(res, 409, "google_tenant_not_connected", "Tenant Google non ancora collegato.");
    }
    const provider = resolveGoogleProviderConfig(storage.googleProviderConfig());
    const accountOptions = await fetchGoogleAccountOptions(provider, connection);
    const saved = storage.saveGoogleTenantConnection(tenantId, {
      ...connection,
      token: accountOptions.token || connection.token,
      available_accounts: accountOptions.accounts || connection.available_accounts,
      last_error: accountOptions.ok ? "" : uniqueValues(accountOptions.errors || [accountOptions.error]).join(","),
    });
    return res.status(accountOptions.ok ? 200 : 207).json({
      ok: accountOptions.ok,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      tenant_id: tenantId,
      accounts: saved.available_accounts,
      connection: saved,
      errors: accountOptions.errors || (accountOptions.error ? [accountOptions.error] : []),
    });
  });

  app.post("/api/suite/integrations/google/accounts/select", auth, (req, res) => {
    const tenantId = sanitizeId(req.body?.tenant_id || req.query.tenant_id || req.get("x-sh-tenant-id") || "tenant_demo", "tenant");
    const saved = storage.selectGoogleAccounts(tenantId, req.body || {});
    if (!saved) {
      return publicError(res, 409, "google_tenant_not_connected", "Tenant Google non ancora collegato.");
    }
    return res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "google_accounts_selected",
      tenant_id: tenantId,
      connection: saved,
      google: buildGoogleConnectorStatus(tenantId, storage.googleProviderConfig(), storage.googleTenantConnection(tenantId)),
      execution_allowed: false,
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
      contract: buildGoogleConnectorContract(storage.googleProviderConfig()),
    });
  });

  app.post("/api/suite/governance/validate", auth, (req, res) => {
    const manifest = req.body?.governance_manifest || req.body?.manifest || req.body || {};
    const validation = validateGovernanceRequest(manifest);
    res.status(validation.allowed ? 200 : 409).json({
      ok: validation.allowed,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "suite_core_codex_governance_runtime",
      execution_allowed: validation.allowed && validation.status === "allow",
      validation,
    });
  });

  app.get("/api/suite/customer-intelligence/contract", auth, async (req, res) => {
    const tenantId = sanitizeId(req.query.tenant_id || req.get("x-sh-tenant-id") || coreClient.status().tenant_id || "suite-control-plane", "tenant");
    const result = await coreClient.customerIntelligenceContract(tenantId);
    if (!result.success) {
      return publicError(res, result.http_status || 503, result.code || "customer_intelligence_contract_unavailable", result.message || "Contratto Customer Intelligence non disponibile.");
    }
    return res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      source: "universal_core",
      tenant_id: tenantId,
      contract: result.contract,
    });
  });

  app.post("/api/suite/customer-intelligence/readiness", auth, async (req, res) => {
    const tenantId = sanitizeId(req.body?.tenant_id || req.get("x-sh-tenant-id") || coreClient.status().tenant_id || "suite-control-plane", "tenant");
    const result = await coreClient.customerIntelligenceReadiness(req.body || {}, tenantId);
    if (!result.success) {
      return publicError(res, result.http_status || 503, result.code || "customer_intelligence_readiness_unavailable", result.message || "Readiness Customer Intelligence non disponibile.");
    }
    return res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      source: "universal_core",
      tenant_id: tenantId,
      readiness: result.readiness,
      rule: result.rule,
    });
  });

  app.post("/api/suite/core/action-mediation", auth, async (req, res) => {
    const tenantId = sanitizeId(req.body?.tenant_id || req.get("x-sh-tenant-id") || coreClient.status().tenant_id || "suite-control-plane", "tenant");
    const action = req.body?.action || req.body || {};
    const governanceManifest = req.body?.governance_manifest || req.body?.manifest || null;

    if (governanceManifest || isGovernanceSensitiveAction(action)) {
      const validation = validateGovernanceRequest(governanceManifest || {});
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

    const result = await coreClient.actionMediation(tenantId, {
      action,
      policy: req.body?.policy || {},
      context: {
        source: "suite_control_plane",
        no_auto_execute: true,
        governance_runtime_checked: Boolean(governanceManifest || isGovernanceSensitiveAction(action)),
        ...(req.body?.context && typeof req.body.context === "object" ? req.body.context : {}),
      },
    });
    res.status(result.http_status || (result.success ? 200 : 424)).json({
      ok: result.success,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "core_action_mediation_proxy",
      execution_allowed: false,
      core: coreClient.status(),
      result,
    });
  });

  app.post("/api/suite/runbooks/preview", auth, (req, res) => {
    const preview = storage.runbookPreview(req.body || {});
    if (!preview) return publicError(res, 404, "suite_runbook_not_found");
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      preview,
    });
  });

  app.post("/api/suite/runbooks/dispatch", auth, (req, res) => {
    const dispatch = storage.runbookDispatch(req.body || {});
    if (!dispatch) return publicError(res, 404, "suite_runbook_not_found");
    res.status(dispatch.accepted ? 202 : 409).json({
      ok: dispatch.accepted,
      accepted: dispatch.accepted,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      dispatch,
    });
  });

  app.post("/api/suite/runbooks/artifacts", auth, (req, res) => {
    const { node, artifact } = storage.runbookArtifact(req.body || {});
    res.status(201).json({
      ok: true,
      accepted: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      artifact_id: artifact.id,
      received_at: artifact.received_at,
    });
  });

  app.get("/api/suite/nodes/:nodeId/runbook-artifacts", auth, (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      node_id: sanitizeId(req.params.nodeId, "node"),
      artifacts: storage.runbookArtifacts(req.params.nodeId, limit),
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

  return { app, storage };
}

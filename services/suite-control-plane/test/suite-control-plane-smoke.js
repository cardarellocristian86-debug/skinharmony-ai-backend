import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSuiteControlPlane } from "../src/app.js";

const mockCoreClient = {
  status: (tenantId = "tenant_demo") => ({
    configured: true,
    provider_url: "mock://universal-core",
    tenant_id: tenantId,
    configured_tenant_id: "tenant_demo",
    scope_match: tenantId === "tenant_demo",
    scope_status: tenantId === "tenant_demo" ? "scoped" : "tenant_scope_mismatch",
  }),
  async customerIntelligenceContract(tenantId) {
    return {
      success: true,
      contract: {
        schema_version: "customer_intelligence_contract_v1",
        tenant_id: tenantId,
        automation_limits: { automatic_send_allowed: false },
        data_contract: {
          event_taxonomy: [{ id: "appointment.completed" }],
          consent_registry: { valid_statuses: ["unknown", "granted", "revoked", "expired"] },
        },
      },
    };
  },
  async customerIntelligenceReadiness(payload) {
    return {
      success: true,
      readiness: {
        schema_version: "customer_intelligence_readiness_v1",
        event_count: Array.isArray(payload.events) ? payload.events.length : 0,
        granted_consent_count: 1,
        can_send_automatically: false,
        next_step: "prepare_draft_for_operator_confirmation",
      },
      rule: "Readiness e solo valutazione: nessun invio automatico e nessuna modifica dati cliente.",
    };
  },
  async actionMediation(tenantId, payload) {
    return {
      success: true,
      http_status: 200,
      core_route: "action_evaluator",
      tenant_id: tenantId,
      decision: {
        execution_allowed: false,
        no_auto_execute: payload?.context?.no_auto_execute === true,
        governance_runtime_checked: payload?.context?.governance_runtime_checked === true,
      },
    };
  },
};

const mockNyraClient = {
  status: () => ({
    configured: true,
    provider_url: "mock://nyra-suite",
    tenant_id: "tenant_demo",
    scope_status: "scoped",
  }),
  async coreStatus() {
    return {
      success: true,
      http_status: 200,
      tenant_id: "tenant_demo",
      core: { reachable: true, status: "active", tier: "enterprise", active_branches: 4 },
    };
  },
  async customerIntelligenceContract() {
    return {
      success: true,
      http_status: 200,
      contract: { schema_version: "customer_intelligence_contract_v1", tenant_id: "tenant_demo" },
    };
  },
  async decisionPreview(payload) {
    return {
      success: true,
      http_status: 200,
      mode: "preview_only",
      tenant_id: payload.tenant_id,
      execution_allowed: false,
      readiness: { missing: [] },
      core: { decision_contract: { state: "attention" } },
    };
  },
};

const { app, storage } = createSuiteControlPlane({ coreClient: mockCoreClient, nyraClient: mockNyraClient });
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const headers = {
  "content-type": "application/json",
  "x-sh-suite-key": "dev-suite-control-plane-key",
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

function validGovernanceManifest() {
  return {
    tenant_id: "tenant_demo",
    action_type: "update",
    target: {
      type: "suite_control_plane",
      id: "action_mediation",
      environment: "production",
      primary_only: true,
    },
    scope: {
      sensitive_action: true,
      write_action: true,
    },
    core: {
      decision: "allow_controlled",
      decision_id: "decision_test",
      audit_id: "audit_test",
      execution_allowed: true,
      requires_owner_confirmation: false,
    },
    branches: {
      results: {
        change_impact: { status: "allow" },
        rollback_guard: { status: "allow" },
      },
    },
    write_safety: {
      backup_id: "backup_test",
      diff_id: "diff_test",
      rollback_plan_id: "rollback_test",
      write_safety_manifest_id: "manifest_test",
      scope: {
        cross_page: false,
        cross_plugin: false,
        cross_tenant: false,
      },
    },
  };
}

try {
  const health = await request("/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.service, "skinharmony-suite-control-plane");
  assert.equal(health.body.nyra_suite.scope_status, "scoped");

  const unauthorized = await request("/api/suite/overview");
  assert.equal(unauthorized.response.status, 401);

  const heartbeat = await request("/api/suite/nodes/heartbeat", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      plugin_version: "5.1.12",
      status: "online",
      capabilities: ["control_plane", "runbook_receiver", "evidence"],
    }),
  });
  assert.equal(heartbeat.response.status, 200);
  assert.equal(heartbeat.body.accepted, true);
  assert.equal(heartbeat.body.node_id, "wp_test_node");

  const snapshot = await request("/api/suite/nodes/snapshot", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      summary: { plugin_version: "5.1.12", runtime_mode: "shared_render" },
      validation: { manifest_integrity_ready: true },
      change_impact_orchestration: {
        schema_version: "skinharmony_change_impact_contract_v1",
        enabled: true,
        core_branch: "change_impact_orchestration",
        automation_level: "assisted_owner_confirm",
        required_actions_count: 9,
        tests_required_count: 6,
      },
    }),
  });
  assert.equal(snapshot.response.status, 200);
  assert.equal(snapshot.body.snapshot_count, 1);

  const evidence = await request("/api/suite/evidence", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      evidence_type: "core_gate",
      decision: "confirm",
      risk: "medium",
      audit_id: "audit_test",
    }),
  });
  assert.equal(evidence.response.status, 200);
  assert.match(evidence.body.evidence_id, /^evidence_/);

  const siteClick = await request("/api/suite/events/ingest", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      source: "wordpress_site_suite",
      suite_version: "5.2.82",
      event_type: "cta_click",
      event_label: "Richiedi informazioni",
      event_section: "hero",
      click_kind: "richiesta",
      target_url: "https://example.test/contatti",
      path: "/skinharmony-smart-desk-2/",
      referrer: "direct",
      utm_source: "google",
      session_hash: "session_demo",
      event_day: "2026-05-28",
    }),
  });
  assert.equal(siteClick.response.status, 200);
  assert.equal(siteClick.body.event_type, "cta_click");

  const siteScroll = await request("/api/suite/events/ingest", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      event_type: "scroll_depth",
      event_label: "75%",
      event_section: "page",
      path: "/skinharmony-smart-desk-2/",
      scroll_depth: 75,
      session_hash: "session_demo",
      event_day: "2026-05-28",
    }),
  });
  assert.equal(siteScroll.response.status, 200);
  assert.equal(siteScroll.body.event_type, "scroll_depth");

  const siteActiveTime = await request("/api/suite/events/ingest", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      event_type: "active_time_ping",
      event_label: "active_10s",
      event_section: "page",
      path: "/skinharmony-smart-desk-2/",
      elapsed_seconds: 10,
      session_hash: "session_demo",
      event_day: "2026-05-28",
    }),
  });
  assert.equal(siteActiveTime.response.status, 200);
  assert.equal(siteActiveTime.body.event_type, "active_time_ping");

  const eventSummary = await request("/api/suite/tenants/tenant_demo/events/summary?days=30", { headers });
  assert.equal(eventSummary.response.status, 200);
  assert.equal(eventSummary.body.summary.by_event_type.cta_click, 1);
  assert.equal(eventSummary.body.summary.by_event_type.scroll_depth, 1);
  assert.equal(eventSummary.body.summary.by_event_type.active_time_ping, 1);
  assert.equal(eventSummary.body.summary.click_intelligence.by_kind.richiesta, 1);
  assert.equal(eventSummary.body.summary.click_intelligence.by_section.hero, 1);
  assert.equal(eventSummary.body.summary.click_intelligence.scroll_milestones["/skinharmony-smart-desk-2/ | 75%"], 1);
  assert.equal(eventSummary.body.summary.click_intelligence.active_seconds_by_path["/skinharmony-smart-desk-2/"], 10);

  const actionPlan = await request("/api/suite/tenants/tenant_demo/analytics/action-plan?days=30", { headers });
  assert.equal(actionPlan.response.status, 200);
  assert.equal(actionPlan.body.action_plan.schema_version, "suite_analytics_action_plan_v1");
  assert.equal(actionPlan.body.action_plan.source, "suite_control_plane_render");
  assert.equal(actionPlan.body.action_plan.mode, "read_only_recommendations");
  assert.equal(actionPlan.body.action_plan.summary_metrics.cta_clicks, 1);
  assert.ok(actionPlan.body.action_plan.next_actions.some((item) => item.id === "clicks_without_leads"));
  assert.ok(actionPlan.body.action_plan.next_actions.every((item) => item.do_this));
  assert.ok(actionPlan.body.action_plan.rules.some((rule) => rule.includes("non modifica")));

  const commerceSnapshot = await request("/api/suite/commerce/snapshot", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      suite_version: "5.2.88",
      snapshot: {
        schema_version: "suite_commerce_snapshot_v1",
        source: "wordpress_site_suite",
        summary: {
          crm_contacts: 2,
          crm_companies: 1,
          product_items: 8,
          technology_items: 3,
          orders_count: 1,
          order_value: 129,
          open_leads: 1,
          active_licenses: 1,
        },
        sections: [
          { key: "crm", status: "ready", count: 2 },
          { key: "inventory", status: "ready", count: 11 },
        ],
      },
    }),
  });
  assert.equal(commerceSnapshot.response.status, 200);
  assert.equal(commerceSnapshot.body.accepted, true);
  assert.equal(commerceSnapshot.body.execution_allowed, false);
  assert.equal(commerceSnapshot.body.privacy.raw_customer_records_stored, false);

  const marketingDispatch = await request("/api/suite/marketing/journeys/dispatch", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      dispatch_type: "marketing_journey_queue",
      owner_confirmed: true,
      payload: {
        source: "wordpress_site_suite",
        suite_version: "5.3.19",
        schema_version: "suite_marketing_journey_builder_v1",
        mode: "draft_approve_only",
        source_event: "manual_rest_sync",
        core_branch_group: "marketing_intelligence",
        journeys_count: 4,
        approval_queue_count: 1,
        approval_queue: [
          {
            id: "recall_attention",
            journey_id: "recall",
            label: "Richiamo da approvare",
            priority: "alta",
            required_gate: "core_marketing_intelligence_gate",
          },
        ],
      },
    }),
  });
  assert.equal(marketingDispatch.response.status, 200);
  assert.equal(marketingDispatch.body.accepted, true);
  assert.equal(marketingDispatch.body.execution_allowed, false);
  assert.equal(marketingDispatch.body.dispatch.state, "queued_for_marketing_pull");
  assert.equal(marketingDispatch.body.dispatch.approval_queue_count, 1);
  assert.equal(marketingDispatch.body.privacy.raw_customer_records_stored, false);

  const commerceSummary = await request("/api/suite/tenants/tenant_demo/commerce/summary", { headers });
  assert.equal(commerceSummary.response.status, 200);
  assert.equal(commerceSummary.body.summary.mode, "read_only_summary");
  assert.equal(commerceSummary.body.summary.readiness, "ready");
  assert.equal(commerceSummary.body.summary.totals.crm_contacts, 2);
  assert.equal(commerceSummary.body.summary.policy.no_payment_capture, true);

  const controlPlaneDashboard = await request("/api/suite/control-plane/dashboard", { headers });
  assert.equal(controlPlaneDashboard.response.status, 200);
  assert.equal(controlPlaneDashboard.body.dashboard.execution_allowed, false);
  assert.equal(controlPlaneDashboard.body.dashboard.totals.tenants, 1);
  assert.equal(controlPlaneDashboard.body.dashboard.totals.nodes, 1);
  assert.equal(controlPlaneDashboard.body.dashboard.tenants[0].tenant_id, "tenant_demo");
  assert.equal(controlPlaneDashboard.body.dashboard.tenants[0].core_bridge.configured, true);
  assert.equal(controlPlaneDashboard.body.dashboard.tenants[0].core_bridge.scope_match, true);
  assert.equal(controlPlaneDashboard.body.dashboard.tenants[0].readiness_status, "ready");
  assert.equal(controlPlaneDashboard.body.dashboard.tenants[0].readiness_summary.average_score, 100);

  const tenantDashboard = await request("/api/suite/tenants/tenant_demo/dashboard", { headers });
  assert.equal(tenantDashboard.response.status, 200);
  assert.equal(tenantDashboard.body.dashboard.tenant_id, "tenant_demo");
  assert.equal(tenantDashboard.body.dashboard.core_bridge.configured, true);
  assert.equal(tenantDashboard.body.dashboard.core_bridge.scope_match, true);
  assert.equal(tenantDashboard.body.dashboard.evidence.total, 1);
  assert.equal(tenantDashboard.body.dashboard.evidence.by_type.core_gate, 1);
  assert.equal(tenantDashboard.body.dashboard.nodes[0].readiness.status, "ready");

  const runbooks = await request("/api/suite/runbooks", { headers });
  assert.equal(runbooks.response.status, 200);
  assert.ok(runbooks.body.runbooks.length >= 11);
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "customer_report"));
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "setup_site_suite"));
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "clone_waas_site"));
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "claim_price_audit"));
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "smartdesk_gold_customer_intelligence_sync"));
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "customer_360_profile_review"));
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "journey_builder_guarded_draft"));

  const tracks = await request("/api/suite/ecosystem/tracks", { headers });
  assert.equal(tracks.response.status, 200);
  assert.equal(tracks.body.tracks.schema_version, "suite_ecosystem_tracks_v1");
  assert.equal(tracks.body.tracks.core.configured, true);
  assert.ok(tracks.body.tracks.suite_provider_track.runbooks.some((runbook) => runbook.id === "setup_site_suite"));
  assert.ok(tracks.body.tracks.smartdesk_gold_track.runbooks.some((runbook) => runbook.id === "smartdesk_gold_customer_intelligence_sync"));
  assert.ok(tracks.body.tracks.smartdesk_gold_track.guardrails.includes("nessun invio automatico"));

  const branchMap = await request("/api/suite/nyra/branch-map", { headers });
  assert.equal(branchMap.response.status, 200);
  assert.equal(branchMap.body.mode, "nyra_suite_branch_map_read_only");
  assert.equal(branchMap.body.execution_allowed, false);
  assert.equal(branchMap.body.owner_confirmation_required, true);
  assert.equal(branchMap.body.branch_count, 14);
  assert.ok(branchMap.body.branch_keys.includes("analytics_insight"));
  assert.ok(branchMap.body.branch_keys.includes("crm_sales"));
  assert.ok(branchMap.body.branch_keys.includes("render_operations"));

  const nyraCoreStatus = await request("/api/suite/nyra/core/status", { headers });
  assert.equal(nyraCoreStatus.response.status, 200);
  assert.equal(nyraCoreStatus.body.source, "nyra_suite_bridge");
  assert.equal(nyraCoreStatus.body.tenant_id, "tenant_demo");
  assert.equal(nyraCoreStatus.body.nyra.core.tier, "enterprise");

  const nyraContract = await request("/api/suite/nyra/customer-intelligence/contract", { headers });
  assert.equal(nyraContract.response.status, 200);
  assert.equal(nyraContract.body.contract.schema_version, "customer_intelligence_contract_v1");

  const nyraPreview = await request("/api/suite/nyra/decision-preview", {
    method: "POST",
    headers,
    body: JSON.stringify({ tenant_id: "tenant_demo", current_state: "analysis", next_action: "suite_review" }),
  });
  assert.equal(nyraPreview.response.status, 200);
  assert.equal(nyraPreview.body.mode, "preview_only");
  assert.equal(nyraPreview.body.execution_allowed, false);

  const googleStatus = await request("/api/suite/integrations/google/status?tenant_id=tenant_demo", { headers });
  assert.equal(googleStatus.response.status, 200);
  assert.equal(googleStatus.body.google.capability.can_change_budget, false);
  assert.equal(googleStatus.body.google.contract.safety_policy.no_campaign_creation, true);
  assert.equal(googleStatus.body.google.provider_ready, false);

  const googleProviderConfig = await request("/api/suite/integrations/google/provider-config", { headers });
  assert.equal(googleProviderConfig.response.status, 200);
  assert.equal(googleProviderConfig.body.provider_config.client_id_present, true);

  const savedGoogleProviderConfig = await request("/api/suite/integrations/google/provider-config", {
    method: "POST",
    headers,
    body: JSON.stringify({
      provider: {
        client_id: "client-id-provider",
        client_secret: "client-secret-provider",
        developer_token: "developer-token-provider",
        redirect_uri: "https://suite-control-plane.onrender.com/api/suite/integrations/google/oauth/callback",
      },
    }),
  });
  assert.equal(savedGoogleProviderConfig.response.status, 201);
  assert.equal(savedGoogleProviderConfig.body.provider_config.client_id_present, true);
  assert.equal(savedGoogleProviderConfig.body.provider_config.client_secret_present, true);

  const googleStatusAfterProviderConfig = await request("/api/suite/integrations/google/status?tenant_id=tenant_demo", { headers });
  assert.equal(googleStatusAfterProviderConfig.response.status, 200);
  assert.equal(googleStatusAfterProviderConfig.body.google.provider_ready, true);
  assert.equal(googleStatusAfterProviderConfig.body.google.contract.provider.source, "suite_provider_config");

  const googleConnect = await request("/api/suite/integrations/google/connect?tenant_id=tenant_demo", { headers });
  assert.equal(googleConnect.response.status, 200);
  assert.equal(googleConnect.body.execution_allowed, false);
  assert.match(googleConnect.body.customer_action, /Collega Google/);

  const publicGoogleConnect = await request("/api/suite/integrations/google/connect?tenant_id=tenant_demo");
  assert.equal(publicGoogleConnect.response.status, 200);
  assert.equal(publicGoogleConnect.body.execution_allowed, false);
  assert.match(publicGoogleConnect.body.customer_action, /Collega Google/);
  assert.equal(publicGoogleConnect.body.oauth_start_ready, true);

  const googleOAuthStart = await request("/api/suite/integrations/google/oauth/start?tenant_id=tenant_demo&format=json");
  assert.equal(googleOAuthStart.response.status, 200);
  assert.match(googleOAuthStart.body.redirect_url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  assert.match(googleOAuthStart.body.redirect_url, /access_type=offline/);
  assert.doesNotMatch(JSON.stringify(googleOAuthStart.body), /client-secret-provider/);

  const publicGoogleConnectHtmlResponse = await fetch(`${baseUrl}/api/suite/integrations/google/connect?tenant_id=tenant_demo`, {
    headers: { accept: "text/html" },
  });
  const publicGoogleConnectHtml = await publicGoogleConnectHtmlResponse.text();
  assert.equal(publicGoogleConnectHtmlResponse.status, 200);
  assert.match(publicGoogleConnectHtml, /Google Connector/);
  assert.match(publicGoogleConnectHtml, /Nessuna campagna/);

  const googleValidation = await request("/api/suite/integrations/google/validate", {
    method: "POST",
    headers,
    body: JSON.stringify({
      provider: {
        client_id: "client-id",
        client_secret: "client-secret",
        developer_token: "developer-token",
        redirect_uri: "https://suite-control-plane.onrender.com/api/suite/integrations/google/oauth/callback",
      },
      tenant: {
        tenant_id: "tenant_demo",
        google_user_authorized: true,
        ads_customer_id: "1234567890",
        ga4_property_id: "properties/123",
      },
    }),
  });
  assert.equal(googleValidation.response.status, 200);
  assert.equal(googleValidation.body.validation.allowed, true);
  assert.equal(googleValidation.body.validation.execution_allowed, false);

  const blockedGoogleValidation = await request("/api/suite/integrations/google/validate", {
    method: "POST",
    headers,
    body: JSON.stringify({
      provider: {
        client_id: "client-id",
        client_secret: "client-secret",
        developer_token: "developer-token",
        redirect_uri: "https://suite-control-plane.onrender.com/api/suite/integrations/google/oauth/callback",
      },
      campaign_write_enabled: true,
    }),
  });
  assert.equal(blockedGoogleValidation.response.status, 409);
  assert.equal(blockedGoogleValidation.body.validation.allowed, false);

  const maskedGoogleConnection = storage.saveGoogleTenantConnection("tenant_demo", {
    connected: true,
    authorized_at: new Date().toISOString(),
    token: {
      access_token: "access-token-private",
      refresh_token: "refresh-token-private",
      token_type: "Bearer",
      scope: "https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/analytics.readonly",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    },
    available_accounts: {
      google_ads_customers: ["1234567890"],
      ga4_properties: [{ property: "properties/123", display_name: "GA4 demo", parent_account: "accounts/1" }],
    },
    last_diagnostics: [{
      source: "google_ads_customers",
      http_status: 403,
      google_status: "PERMISSION_DENIED",
      google_code: 403,
      message: "Request had insufficient authentication scopes.",
      detail_types: [],
    }],
  });
  assert.equal(maskedGoogleConnection.connected, true);
  assert.equal(maskedGoogleConnection.token.access_token_present, true);
  assert.equal(maskedGoogleConnection.last_diagnostics[0].google_status, "PERMISSION_DENIED");
  assert.doesNotMatch(JSON.stringify(maskedGoogleConnection), /access-token-private/);

  const googleStatusConnected = await request("/api/suite/integrations/google/status?tenant_id=tenant_demo", { headers });
  assert.equal(googleStatusConnected.response.status, 200);
  assert.equal(googleStatusConnected.body.google.connected, true);
  assert.equal(googleStatusConnected.body.google.state, "authorized_needs_account_selection");
  assert.doesNotMatch(JSON.stringify(googleStatusConnected.body), /refresh-token-private/);

  const selectedGoogleAccounts = await request("/api/suite/integrations/google/accounts/select", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      google_ads_customer_id: "1234567890",
      ga4_property_id: "properties/123",
    }),
  });
  assert.equal(selectedGoogleAccounts.response.status, 200);
  assert.equal(selectedGoogleAccounts.body.google.state, "connected");
  assert.equal(selectedGoogleAccounts.body.google.capability.can_read_google_ads, true);
  assert.equal(selectedGoogleAccounts.body.google.capability.can_read_ga4, true);
  assert.doesNotMatch(JSON.stringify(selectedGoogleAccounts.body), /access-token-private/);

  const customerContract = await request("/api/suite/customer-intelligence/contract?tenant_id=tenant_demo", { headers });
  assert.equal(customerContract.response.status, 200);
  assert.equal(customerContract.body.source, "universal_core");
  assert.equal(customerContract.body.contract.schema_version, "customer_intelligence_contract_v1");
  assert.equal(customerContract.body.contract.automation_limits.automatic_send_allowed, false);

  const customerReadiness = await request("/api/suite/customer-intelligence/readiness", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      events: [{ type: "appointment.completed" }],
      consents: [{ status: "granted", channel: "email", purpose: "recall" }],
      customer_profile: { customer_id: "client_demo" },
    }),
  });
  assert.equal(customerReadiness.response.status, 200);
  assert.equal(customerReadiness.body.readiness.can_send_automatically, false);
  assert.equal(customerReadiness.body.readiness.next_step, "prepare_draft_for_operator_confirmation");

  const governanceValidation = await request("/api/suite/governance/validate", {
    method: "POST",
    headers,
    body: JSON.stringify({ governance_manifest: validGovernanceManifest() }),
  });
  assert.equal(governanceValidation.response.status, 200);
  assert.equal(governanceValidation.body.execution_allowed, true);
  assert.equal(governanceValidation.body.validation.status, "allow");

  const blockedActionMediation = await request("/api/suite/core/action-mediation", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      action: {
        action_type: "update",
        scope: { sensitive_action: true },
        target: { type: "wordpress_page", id: "page_1504", environment: "production" },
      },
    }),
  });
  assert.equal(blockedActionMediation.response.status, 409);
  assert.equal(blockedActionMediation.body.error, "suite_governance_manifest_blocked");

  const allowedActionMediation = await request("/api/suite/core/action-mediation", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      action: {
        action_type: "update",
        target: { type: "suite_control_plane", id: "action_mediation", environment: "production" },
      },
      governance_manifest: validGovernanceManifest(),
    }),
  });
  assert.equal(allowedActionMediation.response.status, 200);
  assert.equal(allowedActionMediation.body.ok, true);
  assert.equal(allowedActionMediation.body.core_route, "action_evaluator");
  assert.equal(allowedActionMediation.body.result.decision.governance_runtime_checked, true);

  const preview = await request("/api/suite/runbooks/preview", {
    method: "POST",
    headers,
    body: JSON.stringify({
      runbook_id: "plugin_update_preflight",
      node_id: "wp_test_node",
    }),
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.preview.state, "ready_for_owner_confirmation");
  assert.equal(preview.body.preview.owner_confirmation_required, true);

  const rejectedDispatch = await request("/api/suite/runbooks/dispatch", {
    method: "POST",
    headers,
    body: JSON.stringify({
      runbook_id: "plugin_update_preflight",
      node_id: "wp_test_node",
    }),
  });
  assert.equal(rejectedDispatch.response.status, 409);
  assert.equal(rejectedDispatch.body.accepted, false);

  const dispatch = await request("/api/suite/runbooks/dispatch", {
    method: "POST",
    headers,
    body: JSON.stringify({
      runbook_id: "plugin_update_preflight",
      node_id: "wp_test_node",
      owner_confirmed: true,
      payload: { release: "5.1.14" },
    }),
  });
  assert.equal(dispatch.response.status, 202);
  assert.equal(dispatch.body.accepted, true);
  assert.equal(dispatch.body.dispatch.state, "queued_for_node_pull");

  const customerReportDispatch = await request("/api/suite/runbooks/dispatch", {
    method: "POST",
    headers,
    body: JSON.stringify({
      runbook_id: "customer_report",
      node_id: "wp_test_node",
      payload: { source: "suite_local_catalog_alignment" },
    }),
  });
  assert.equal(customerReportDispatch.response.status, 202);
  assert.equal(customerReportDispatch.body.accepted, true);
  assert.equal(customerReportDispatch.body.dispatch.state, "queued_for_node_pull");

  const artifact = await request("/api/suite/runbooks/artifacts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      runbook_id: "plugin_update_preflight",
      artifact_type: "preflight_report",
      signature: "sig_test",
      payload: { ok: true, release: "5.1.14" },
    }),
  });
  assert.equal(artifact.response.status, 201);
  assert.equal(artifact.body.accepted, true);
  assert.match(artifact.body.artifact_id, /^artifact_/);

  const artifactList = await request("/api/suite/nodes/wp_test_node/runbook-artifacts", { headers });
  assert.equal(artifactList.response.status, 200);
  assert.equal(artifactList.body.artifacts.length, 1);
  assert.equal(artifactList.body.artifacts[0].runbook_id, "plugin_update_preflight");

  const dashboard = await request("/api/suite/nodes/wp_test_node/dashboard", { headers });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.dashboard.node.node_id, "wp_test_node");
  assert.equal(dashboard.body.dashboard.node.evidence_count, 1);
  assert.equal(dashboard.body.dashboard.dispatches.length, 4);
  assert.ok(dashboard.body.dashboard.dispatches.some((item) => item.dispatch_type === "marketing_journey_queue"));
  assert.equal(dashboard.body.dashboard.runbook_artifacts.length, 1);

  const overview = await request("/api/suite/overview", { headers });
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.overview.nodes_total, 1);
  assert.equal(overview.body.overview.runbooks_total, runbooks.body.runbooks.length);
  assert.equal(overview.body.overview.dispatches_total, 4);
  assert.equal(overview.body.overview.runbook_artifacts_total, 1);

  const staleNode = storage.dashboard("wp_test_node").node;
  const staleAt = new Date(Date.now() - (16 * 60 * 1000)).toISOString();
  staleNode.status = "online";
  staleNode.last_seen_at = staleAt;
  staleNode.latest_heartbeat.received_at = staleAt;
  const staleDashboard = await request("/api/suite/control-plane/dashboard", { headers });
  assert.equal(staleDashboard.response.status, 200);
  assert.equal(staleDashboard.body.dashboard.totals.ready, 0);
  assert.equal(staleDashboard.body.dashboard.totals.warning, 1);
  assert.equal(staleDashboard.body.dashboard.tenants[0].nodes[0].status, "stale");
  assert.equal(staleDashboard.body.dashboard.tenants[0].nodes[0].readiness.status, "warning");
  assert.ok(staleDashboard.body.dashboard.tenants[0].nodes[0].readiness.missing.includes("heartbeat_fresh"));

  const stalePreview = await request("/api/suite/runbooks/preview", {
    method: "POST",
    headers,
    body: JSON.stringify({
      runbook_id: "plugin_update_preflight",
      node_id: "wp_test_node",
    }),
  });
  assert.equal(stalePreview.response.status, 200);
  assert.equal(stalePreview.body.preview.state, "blocked_until_node_ready");
  assert.deepEqual(stalePreview.body.preview.blocking, ["node_not_online"]);

  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-suite-control-"));
  process.env.SUITE_CONTROL_STORAGE_ROOT = storageRoot;
  const persistedOne = createSuiteControlPlane();
  persistedOne.storage.heartbeat({
    node_id: "wp_persisted_node",
    tenant_id: "tenant_demo",
    plugin_version: "5.1.13",
  });
  persistedOne.storage.snapshot({
    node_id: "wp_persisted_node",
    tenant_id: "tenant_demo",
    summary: { runtime_mode: "shared_render" },
  });
  persistedOne.storage.runbookDispatch({
    runbook_id: "smartdesk_bridge_check",
    node_id: "wp_persisted_node",
  });
  persistedOne.storage.runbookArtifact({
    node_id: "wp_persisted_node",
    tenant_id: "tenant_demo",
    runbook_id: "smartdesk_bridge_check",
    artifact_type: "bridge_report",
    signature: "persisted_sig",
    payload: { ok: true },
  });
  const persistedTwo = createSuiteControlPlane();
  const persistedOverview = persistedTwo.storage.overview();
  assert.equal(persistedTwo.storage.mode, "file");
  assert.equal(persistedOverview.nodes_total, 1);
  assert.equal(persistedOverview.nodes[0].node_id, "wp_persisted_node");
  assert.equal(persistedOverview.dispatches_total, 1);
  assert.equal(persistedOverview.runbook_artifacts_total, 1);
  delete process.env.SUITE_CONTROL_STORAGE_ROOT;

  console.log("Suite Control Plane smoke OK");
} finally {
  server.close();
}

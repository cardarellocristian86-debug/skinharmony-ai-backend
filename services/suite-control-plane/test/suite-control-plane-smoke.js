import assert from "node:assert/strict";
import express from "express";
import { createSuiteControlPlane } from "../src/app.js";

const coreMock = express();
coreMock.use(express.json());
coreMock.use((req, res, next) => {
  if (req.get("authorization") !== "Bearer core_setup_test_key") {
    return res.status(401).json({ ok: false, error: "core_key_invalid" });
  }
  return next();
});
const coreRouteHits = {
  siteSuiteGateway: 0,
  legacyNiraBridge: 0,
  actionEvaluator: 0,
  legacyActionMediation: 0,
};

coreMock.post("/v1/adapters/site-suite/gateway", (req, res) => {
  coreRouteHits.siteSuiteGateway += 1;
  assert.equal(req.body.adapter, "site_suite");
  assert.equal(typeof req.body.user_request, "string");
  res.json({
    ok: true,
    tenant_id: req.body.tenant_id,
    verdict: {
      decision: "allow_advisory",
      action_mediation: {
        state: "allow",
        execution_allowed: false,
      },
    },
    result: {
      core_branch_diagnostics: {
        branch_router_used: true,
        actual_selected_branches: req.body.branches || [],
      },
      selected_by_core: {
        control_level: "confirm",
      },
      automation_plan: {
        execution_allowed: false,
      },
    },
  });
});
coreMock.post("/v1/nira/core-bridge", (req, res) => {
  coreRouteHits.legacyNiraBridge += 1;
  res.json({
    ok: true,
    tenant_id: req.body.tenant_id,
    result: {
      core_branch_diagnostics: {
        branch_router_used: true,
        actual_selected_branches: req.body.branches || [],
      },
      selected_by_core: {
        control_level: "confirm",
      },
      automation_plan: {
        execution_allowed: false,
      },
    },
  });
});
coreMock.post("/v1/action-evaluator", (req, res) => {
  coreRouteHits.actionEvaluator += 1;
  assert.equal(req.body.action_type, "update");
  res.json({
    ok: true,
    decision_contract: {
      state: "attention",
      control_level: "confirm",
      risk_band: "medium",
    },
    result: {
      action_mediation: {
        state: "confirm",
        execution_allowed: false,
        owner_confirmation_required: true,
      },
    },
  });
});
coreMock.post("/v1/action-mediation/evaluate", (req, res) => {
  coreRouteHits.legacyActionMediation += 1;
  res.json({
    ok: true,
    result: {
      action_mediation: {
        state: "confirm",
        execution_allowed: false,
        owner_confirmation_required: true,
      },
    },
  });
});
const coreServer = coreMock.listen(0);
await new Promise((resolve) => coreServer.once("listening", resolve));
const corePort = coreServer.address().port;
const coreUrl = `http://127.0.0.1:${corePort}`;

const { app } = createSuiteControlPlane({
  core: {
    setupKeys: {
      tenant_demo: {
        core_url: coreUrl,
        api_key: "core_setup_test_key",
      },
    },
  },
});
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const headers = {
  "content-type": "application/json",
  "x-sh-suite-key": "dev-suite-control-plane-key",
};

const validGovernanceManifest = {
  tenant_id: "tenant_demo",
  action_type: "update",
  target: {
    type: "suite_control_plane_action",
    id: "action_mediation_update_test",
    environment: "local",
    primary_only: true,
  },
  scope: {
    sensitive_action: true,
  },
  core: {
    decision: "allow_controlled",
    decision_id: "decision_test",
    audit_id: "audit_test",
    execution_allowed: true,
    requires_owner_confirmation: false,
    selected_option_id: "action_mediation_variant_test",
  },
  research_pack: {
    id: "research_pack_action_mediation_test",
    findings: ["local smoke source verified", "runtime mediation scope verified"],
    sources: ["local_smoke_test"],
    date: "2026-05-21",
  },
  compressed_signal_pack: {
    id: "compressed_signal_pack_action_mediation_test",
    raw_count: 10,
    family_count: 3,
    signals: [
      { id: "governed_action_mediation", score: 90 },
      { id: "rollback_ready", score: 86 },
    ],
    compression_method: "scenario_family_compression",
    payload_bytes: 2048,
    raw_payload_sent_to_core: false,
  },
  branches: {
    results: {
      action_mediation: { status: "allow" },
      change_impact: { status: "allow" },
    },
  },
  write_safety: {
    backup_id: "backup_test",
    diff_id: "diff_test",
    rollback_plan_id: "rollback_test",
    write_safety_manifest_id: "write_safety_test",
    scope: {
      cross_page: false,
      cross_plugin: false,
      cross_tenant: false,
    },
  },
};
const validRuntimeContract = {
  job: {
    job_id: "job_action_mediation_update_test",
    correlation_id: "corr_action_mediation_update_test",
    tenant_id: "tenant_demo",
    actor: "suite_control_plane_smoke",
    owner_module: "suite_control_plane",
    action_type: "update",
    target: {
      type: "suite_control_plane_action",
      id: "action_mediation_update_test",
    },
    risk_band: "low",
    readiness: "ready",
    core_gate_report: "reports/codex-core/codex_core_gate_latest.json",
    created_at: "2026-05-21T20:00:00.000Z",
    status: "queued",
    idempotency_key: "tenant_demo:update:action_mediation_update_test:hash_test",
  },
  lock: {
    lock_id: "lock_action_mediation_update_test",
    scope: "module",
    owner_agent_id: "suite_control_plane_smoke",
    session_id: "suite_control_plane_smoke_session",
    target: {
      type: "suite_control_plane_action",
      id: "action_mediation_update_test",
    },
    acquired_at: "2026-05-21T20:00:00.000Z",
    expires_at: "2026-05-21T21:00:00.000Z",
    reason: "smoke_test",
  },
  audit: {
    event_id: "audit_event_action_mediation_update_test",
    correlation_id: "corr_action_mediation_update_test",
    timestamp: "2026-05-21T20:00:00.000Z",
    actor: "suite_control_plane_smoke",
    module: "suite_control_plane",
    action_type: "update",
    target: {
      type: "suite_control_plane_action",
      id: "action_mediation_update_test",
    },
    before_ref: "before_test",
    after_ref: "after_test",
    core_audit_id: "audit_test",
    result: "queued",
  },
  rollback: {
    rollback_plan_id: "rollback_test",
    target: {
      type: "suite_control_plane_action",
      id: "action_mediation_update_test",
    },
    backup_ref: "backup_test",
    diff_ref: "diff_test",
    restore_command_or_manual_step: "restore_test",
    verification_step: "verify_test",
    owner: "suite_control_plane_smoke",
  },
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

try {
  const health = await request("/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.service, "skinharmony-suite-control-plane");

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

  const sitePageView = await request("/api/suite/events/ingest", {
    method: "POST",
    headers,
    body: JSON.stringify({
      schema_version: "suite_site_event_v1",
      tenant_id: "tenant_demo",
      node_id: "wp_test_node",
      source: "wordpress_site_suite",
      suite_version: "5.2.88",
      event_type: "page_view",
      path: "/skinharmony-smart-desk-2/",
      referrer: "google.com",
      utm_source: "google",
      session_hash: "session_hash_test",
      event_day: "2026-05-28",
      privacy: {
        ip_address_sent: false,
        raw_session_id_sent: false,
        personal_data_payload: false,
      },
    }),
  });
  assert.equal(sitePageView.response.status, 200);
  assert.equal(sitePageView.body.accepted, true);
  assert.equal(sitePageView.body.execution_allowed, false);
  assert.equal(sitePageView.body.event_type, "page_view");
  assert.equal(sitePageView.body.privacy.ip_address_sent, false);

  const siteClick = await request("/api/suite/events/ingest", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      node_id: "wp_test_node",
      event_type: "cta_click",
      path: "/skinharmony-smart-desk-2/",
      event_section: "hero",
      click_kind: "primary",
      event_label: "richiedi_demo",
      session_hash: "session_hash_test",
      event_day: "2026-05-28",
    }),
  });
  assert.equal(siteClick.response.status, 200);
  assert.equal(siteClick.body.event_type, "cta_click");

  const eventsSummary = await request("/api/suite/tenants/tenant_demo/events/summary?days=30", { headers });
  assert.equal(eventsSummary.response.status, 200);
  assert.equal(eventsSummary.body.summary.totals.events, 2);
  assert.equal(eventsSummary.body.summary.totals.page_views, 1);
  assert.equal(eventsSummary.body.summary.totals.cta_clicks, 1);
  assert.equal(eventsSummary.body.summary.totals.sessions, 1);
  assert.equal(eventsSummary.body.summary.top_paths[0].key, "/skinharmony-smart-desk-2/");

  const actionPlan = await request("/api/suite/tenants/tenant_demo/analytics/action-plan?days=30", { headers });
  assert.equal(actionPlan.response.status, 200);
  assert.equal(actionPlan.body.action_plan.execution_allowed, false);
  assert.equal(actionPlan.body.action_plan.owner_confirmation_required, true);
  assert.equal(actionPlan.body.action_plan.next_controlled_moves[0].id, "conversion_path_verify");

  const dashboard = await request("/api/suite/nodes/wp_test_node/dashboard", { headers });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.dashboard.node.node_id, "wp_test_node");
  assert.equal(dashboard.body.dashboard.node.evidence_count, 1);

  const overview = await request("/api/suite/overview", { headers });
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.overview.nodes_total, 1);
  assert.equal(overview.body.overview.nodes[0].change_impact_ready, true);

  const controlPlaneDashboard = await request("/api/suite/control-plane/dashboard", { headers });
  assert.equal(controlPlaneDashboard.response.status, 200);
  assert.equal(controlPlaneDashboard.body.dashboard.execution_allowed, false);
  assert.equal(controlPlaneDashboard.body.dashboard.totals.tenants, 1);
  assert.equal(controlPlaneDashboard.body.dashboard.totals.nodes, 1);
  assert.equal(controlPlaneDashboard.body.dashboard.tenants[0].tenant_id, "tenant_demo");
  assert.equal(controlPlaneDashboard.body.dashboard.tenants[0].core_bridge.configured, true);
  assert.equal(controlPlaneDashboard.body.dashboard.tenants[0].readiness_status, "ready");
  assert.equal(controlPlaneDashboard.body.dashboard.tenants[0].readiness_summary.average_score, 100);

  const tenantDashboard = await request("/api/suite/tenants/tenant_demo/dashboard", { headers });
  assert.equal(tenantDashboard.response.status, 200);
  assert.equal(tenantDashboard.body.dashboard.tenant_id, "tenant_demo");
  assert.equal(tenantDashboard.body.dashboard.core_bridge.source, "setup_scoped_key");
  assert.equal(tenantDashboard.body.dashboard.evidence.total, 1);
  assert.equal(tenantDashboard.body.dashboard.evidence.by_type.core_gate, 1);
  assert.equal(tenantDashboard.body.dashboard.nodes[0].readiness.status, "ready");

  const changeImpact = await request("/api/suite/nodes/wp_test_node/change-impact-contract", { headers });
  assert.equal(changeImpact.response.status, 200);
  assert.equal(changeImpact.body.contract.core_branch, "change_impact_orchestration");
  assert.equal(changeImpact.body.contract.required_actions_count, 9);

  const coreStatus = await request("/api/suite/core/status?tenant_id=tenant_demo", { headers });
  assert.equal(coreStatus.response.status, 200);
  assert.equal(coreStatus.body.core_bridge.configured, true);
  assert.equal(coreStatus.body.core_bridge.source, "setup_scoped_key");
  assert.equal(coreStatus.body.core_bridge.api_key_masked, "core***_key");

  const commerceContract = await request("/api/suite/commerce/control-room/contract", { headers });
  assert.equal(commerceContract.response.status, 200);
  assert.equal(commerceContract.body.contract.mode, "read_only_control_plane_contract");
  assert.equal(commerceContract.body.contract.safety_policy.no_automatic_checkout, true);
  assert.ok(commerceContract.body.contract.required_sections.includes("core_connector"));

  const commerceValidation = await request("/api/suite/commerce/control-room/validate", {
    method: "POST",
    headers,
    body: JSON.stringify({
      snapshot: {
        mode: "commerce_control_room_read_only",
        writes_data: false,
        automation_allowed: false,
        automatic_checkout_enabled: false,
        automatic_order_mutation_enabled: false,
        automatic_stock_reserve_enabled: false,
        automatic_payment_capture_enabled: false,
        owner_confirmation_required: true,
        summary: { readiness_score: 92 },
        sections: commerceContract.body.contract.required_sections.map((key) => ({ key, status: "ready" })),
        package_blocks: commerceContract.body.contract.package_blocks.map((item) => ({ id: item.id, blocks: item.blocks })),
      },
    }),
  });
  assert.equal(commerceValidation.response.status, 200);
  assert.equal(commerceValidation.body.validation.allowed, true);
  assert.equal(commerceValidation.body.execution_allowed, false);

  const blockedCommerceValidation = await request("/api/suite/commerce/control-room/validate", {
    method: "POST",
    headers,
    body: JSON.stringify({
      snapshot: {
        mode: "commerce_control_room_read_only",
        automatic_checkout_enabled: true,
        sections: [],
      },
    }),
  });
  assert.equal(blockedCommerceValidation.response.status, 409);
  assert.equal(blockedCommerceValidation.body.validation.allowed, false);

  const googleStatus = await request("/api/suite/integrations/google/status?tenant_id=tenant_demo", { headers });
  assert.equal(googleStatus.response.status, 200);
  assert.equal(googleStatus.body.google.capability.can_change_budget, false);
  assert.equal(googleStatus.body.google.contract.safety_policy.no_campaign_creation, true);

  const googleConnect = await request("/api/suite/integrations/google/connect?tenant_id=tenant_demo", { headers });
  assert.equal(googleConnect.response.status, 200);
  assert.equal(googleConnect.body.execution_allowed, false);
  assert.match(googleConnect.body.customer_action, /Collega Google/);

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

  const niraBridge = await request("/api/suite/core/nira-bridge", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      node_id: "wp_test_node",
      text: "Valuta spostamento runbook Suite su Render con Core e Nira.",
      owner_confirmed: true,
    }),
  });
  assert.equal(niraBridge.response.status, 200);
  assert.equal(niraBridge.body.ok, true);
  assert.equal(niraBridge.body.execution_allowed, false);
  assert.equal(niraBridge.body.core.source, "setup_scoped_key");
  assert.equal(niraBridge.body.core_route.label, "site_suite_gateway");
  assert.equal(niraBridge.body.result.result.core_branch_diagnostics.branch_router_used, true);
  assert.equal(coreRouteHits.siteSuiteGateway, 1);
  assert.equal(coreRouteHits.legacyNiraBridge, 0);

  const governanceValidation = await request("/api/suite/governance/validate", {
    method: "POST",
    headers,
    body: JSON.stringify({
      governance_manifest: validGovernanceManifest,
    }),
  });
  assert.equal(governanceValidation.response.status, 200);
  assert.equal(governanceValidation.body.validation.allowed, true);

  const runtimeValidation = await request("/api/suite/enterprise/runtime-contracts/validate", {
    method: "POST",
    headers,
    body: JSON.stringify({
      runtime_contract: validRuntimeContract,
    }),
  });
  assert.equal(runtimeValidation.response.status, 200);
  assert.equal(runtimeValidation.body.validation.allowed, true);

  const blockedActionMediation = await request("/api/suite/core/action-mediation", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      action: { action_type: "update", risk_hint: 45 },
      context: { owner_confirmed: false },
    }),
  });
  assert.equal(blockedActionMediation.response.status, 409);
  assert.equal(blockedActionMediation.body.error, "suite_governance_manifest_blocked");
  assert.equal(blockedActionMediation.body.validation.allowed, false);

  const blockedRuntimeContract = await request("/api/suite/core/action-mediation", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      action: { action_type: "update", risk_hint: 45 },
      governance_manifest: validGovernanceManifest,
      context: { owner_confirmed: false },
    }),
  });
  assert.equal(blockedRuntimeContract.response.status, 409);
  assert.equal(blockedRuntimeContract.body.error, "enterprise_runtime_contract_blocked");
  assert.equal(blockedRuntimeContract.body.validation.allowed, false);

  const actionMediation = await request("/api/suite/core/action-mediation", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      action: { action_type: "update", risk_hint: 45 },
      governance_manifest: validGovernanceManifest,
      runtime_contract: validRuntimeContract,
      context: { owner_confirmed: false },
    }),
  });
  assert.equal(actionMediation.response.status, 200);
  assert.equal(actionMediation.body.result.result.action_mediation.state, "confirm");
  assert.equal(actionMediation.body.core_route.label, "action_evaluator");
  assert.equal(coreRouteHits.actionEvaluator, 1);
  assert.equal(coreRouteHits.legacyActionMediation, 0);

  const missingCoreStatus = await request("/api/suite/core/status?tenant_id=tenant_missing", { headers });
  assert.equal(missingCoreStatus.response.status, 200);
  assert.equal(missingCoreStatus.body.core_bridge.configured, false);

  console.log("Suite Control Plane smoke OK");
} finally {
  server.close();
  coreServer.close();
}

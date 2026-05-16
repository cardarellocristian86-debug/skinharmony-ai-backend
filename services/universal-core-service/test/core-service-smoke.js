import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createUniversalCoreService } from "../src/app.js";

const repoRoot = path.resolve(process.cwd());
const reportDir = path.join(repoRoot, "reports/universal-core/core-service");
fs.mkdirSync(reportDir, { recursive: true });

process.env.CORE_SERVICE_ADMIN_KEY = "test-admin-key";
process.env.NODE_ENV = "test";

const storageRoot = path.join(os.tmpdir(), `sh-core-service-test-${Date.now()}`);
const { app } = createUniversalCoreService({ storageRoot });
const server = http.createServer(app);

function listen() {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close() {
  return new Promise((resolve) => server.close(resolve));
}

async function api(base, method, pathName, body, key = "test-admin-key") {
  const response = await fetch(`${base}${pathName}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, json };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const results = [];
function mark(name, ok, details = {}) {
  results.push({ name, ok, details });
}

try {
  const port = await listen();
  const base = `http://127.0.0.1:${port}`;

  const health = await api(base, "GET", "/healthz", undefined);
  assert(health.status === 200 && health.json.ok, "healthz failed");
  mark("healthz", true, health.json);

  const generated = await api(base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant_demo_skinharmony",
    brand_scope: "skinharmony",
    key_type: "connector",
    preset: "suite_connector",
    label: "SkinHarmony demo connector",
  });
  assert(generated.status === 201 && generated.json.key, "key generation failed");
  const connectorKey = generated.json.key;
  assert(generated.json.record.preset === "suite_connector", "key preset failed");
  mark("key_generate", true, { key_id: generated.json.record.key_id, preset: generated.json.record.preset, scopes: generated.json.record.allowed_scopes });

  const codexGenerated = await api(base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant_demo_skinharmony",
    brand_scope: "skinharmony",
    preset: "codex_automation",
    tier: "internal",
    label: "Codex branch package test",
  });
  assert(codexGenerated.status === 201 && codexGenerated.json.key, "codex key generation failed");
  const codexKey = codexGenerated.json.key;
  mark("codex_key_generate", true, { key_id: codexGenerated.json.record.key_id, tier: codexGenerated.json.record.metadata.tier });

  const codexGenericGenerated = await api(base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant_demo_skinharmony",
    brand_scope: "skinharmony",
    preset: "codex_automation",
    tier: "internal",
    active_branches: [],
    label: "Codex generic core guard test",
  });
  assert(codexGenericGenerated.status === 201 && codexGenericGenerated.json.key, "codex generic key generation failed");
  const codexGenericKey = codexGenericGenerated.json.key;
  mark("codex_generic_key_generate", true, { key_id: codexGenericGenerated.json.record.key_id, branches: codexGenericGenerated.json.record.metadata.active_branches });

  const regulatedGenerated = await api(base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant_regulated_demo",
    brand_scope: "regulated_demo",
    preset: "codex_automation",
    tier: "internal",
    active_branches: ["codex_code_safety", "codex_architecture_guard", "codex_test_strategy", "codex_release_gate", "codex_security_guard"],
    label: "Regulated demo Codex/Core gateway test",
  });
  assert(regulatedGenerated.status === 201 && regulatedGenerated.json.key, "regulated codex key generation failed");
  const regulatedKey = regulatedGenerated.json.key;
  mark("regulated_codex_key_generate", true, { key_id: regulatedGenerated.json.record.key_id, tenant_id: regulatedGenerated.json.record.tenant_id });

  const presets = await api(base, "GET", "/v1/keys/presets", undefined);
  assert(presets.status === 200 && presets.json.presets?.codex_automation?.scopes?.includes("automation:codex"), "key presets list failed");
  assert(presets.json.presets?.codex_automation?.scopes?.includes("gateway:ai"), "codex preset missing AI gateway scope");
  mark("key_presets", true, { presets: Object.keys(presets.json.presets) });

  const setupToken = await api(base, "POST", "/v1/setup-token/create", {
    tenant_id: "tenant_bootstrap_demo",
    brand_scope: "skinharmony",
    preset: "codex_automation",
    plan: "gold",
    role: "codex automation",
    branch_groups: ["codex", "business_governance"],
    branches: ["codex_code_safety", "codex_architecture_guard", "codex_release_gate"],
    modules: ["suite_control_plane", "codex_connector", "smartdesk_node"],
    limits: {
      monthly_core_calls: 1000,
      codex_automation_runs: 50,
      wordpress_nodes: 2,
      runbook_executions: 25,
    },
    tenant: {
      tenant_id: "tenant_bootstrap_demo",
      label: "Tenant Bootstrap Demo",
      sector: "beauty_wellness",
      environment: "staging",
      brand_scope: "skinharmony",
      active_branch_groups: ["codex", "business_governance"],
    },
  });
  assert(setupToken.status === 201 && setupToken.json.setup_token?.startsWith("SHX-SETUP-"), "setup token create failed");
  assert(setupToken.json.token?.tenant_id === "tenant_bootstrap_demo", "setup token tenant failed");
  mark("setup_token_create", true, { token_id: setupToken.json.token.token_id, tenant_id: setupToken.json.token.tenant_id });

  const setupConsume = await api(base, "POST", "/v1/setup-token/consume", {
    setup_token: setupToken.json.setup_token,
    connector: "codex",
    actor_id: "core_service_smoke",
  });
  assert(setupConsume.status === 200 && setupConsume.json.api_key?.startsWith("SHX-AUTOMATION-"), "setup token consume failed");
  assert(setupConsume.json.profile?.schema_version === "core_bootstrap_profile_v1", "bootstrap profile schema failed");
  assert(setupConsume.json.profile?.tenant?.tenant_id === "tenant_bootstrap_demo", "bootstrap profile tenant failed");
  assert(setupConsume.json.profile?.branches?.selected?.includes("codex_code_safety"), "bootstrap profile branches failed");
  assert(setupConsume.json.profile?.limits?.wordpress_nodes === 2, "bootstrap profile limits failed");
  assert(setupConsume.json.profile?.scope?.allowed_scopes?.includes("automation:codex"), "bootstrap profile scopes failed");
  const bootstrapKey = setupConsume.json.api_key;
  mark("setup_token_consume", true, {
    key_id: setupConsume.json.key.key_id,
    tenant_id: setupConsume.json.profile.tenant.tenant_id,
    gate_mode: setupConsume.json.profile.gate_mode,
  });

  const setupConsumeAgain = await api(base, "POST", "/v1/setup-token/consume", {
    setup_token: setupToken.json.setup_token,
  });
  assert(setupConsumeAgain.status === 409 && setupConsumeAgain.json.error === "setup_token_already_consumed", "setup token should be single-use");
  mark("setup_token_single_use", true, { error: setupConsumeAgain.json.error });

  const bootstrapProfile = await api(base, "GET", "/v1/bootstrap/profile", undefined, bootstrapKey);
  assert(bootstrapProfile.status === 200 && bootstrapProfile.json.schema_version === "core_bootstrap_profile_v1", "bootstrap profile read failed");
  assert(bootstrapProfile.json.connector_contract?.sensitive_actions_require_core === true, "bootstrap connector contract failed");
  assert(bootstrapProfile.json.recommended_folders?.reports === "reports/codex-core", "bootstrap folders failed");
  mark("bootstrap_profile_read", true, {
    tenant_id: bootstrapProfile.json.tenant.tenant_id,
    selected_branches: bootstrapProfile.json.branches.selected,
  });

  const revocableSetupToken = await api(base, "POST", "/v1/setup-token/create", {
    tenant_id: "tenant_bootstrap_demo",
    preset: "suite_connector",
    plan: "silver",
  });
  assert(revocableSetupToken.status === 201 && revocableSetupToken.json.setup_token, "revocable setup token create failed");
  const revokedSetupToken = await api(base, "POST", "/v1/setup-token/revoke", {
    setup_token: revocableSetupToken.json.setup_token,
    reason: "smoke_test_revoke",
  });
  assert(revokedSetupToken.status === 200 && revokedSetupToken.json.token?.status === "revoked", "setup token revoke failed");
  mark("setup_token_revoke", true, { token_id: revokedSetupToken.json.token.token_id, status: revokedSetupToken.json.token.status });

  const tenant = await api(base, "GET", "/v1/tenant/status", undefined, connectorKey);
  assert(tenant.status === 200 && tenant.json.tenant_id === "tenant_demo_skinharmony", "tenant status failed");
  assert(tenant.json.active_branches?.includes("suite_governance"), "tenant active branches missing suite governance");
  assert(tenant.json.entitlement?.schema_version === "core_entitlement_v1", "tenant entitlement missing");
  mark("tenant_status", true, tenant.json);

  const tenantUpsert = await api(base, "POST", "/v1/tenants/upsert", {
    tenant_id: "tenant_demo_skinharmony",
    label: "SkinHarmony Demo",
    sector: "beauty_wellness",
    environment: "production",
    brand_scope: "skinharmony",
    active_branch_groups: ["content_intelligence", "business_governance"],
  });
  assert(tenantUpsert.status === 201 && tenantUpsert.json.tenant?.sector === "beauty_wellness", "tenant registry upsert failed");
  mark("tenant_registry_upsert", true, tenantUpsert.json.tenant);

  const tenantRegistry = await api(base, "GET", "/v1/tenants/registry?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(tenantRegistry.status === 200 && tenantRegistry.json.tenants?.some((item) => item.tenant_id === "tenant_demo_skinharmony"), "tenant registry read failed");
  mark("tenant_registry_read", true, { count: tenantRegistry.json.tenants.length });

  const entitlement = await api(base, "GET", "/v1/entitlements/current?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(entitlement.status === 200 && entitlement.json.entitlement?.branches?.includes("suite_governance"), "entitlement current failed");
  assert(entitlement.json.entitlement?.limits?.wordpress_nodes >= 1, "entitlement limits missing");
  mark("entitlement_current", true, {
    tier: entitlement.json.entitlement.tier,
    branches: entitlement.json.entitlement.branches.length,
    limits: entitlement.json.entitlement.limits,
  });

  const controlPlane = await api(base, "GET", "/v1/control-plane/overview?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(controlPlane.status === 200 && controlPlane.json.overview?.control_plane?.api_keys?.active >= 1, "control plane overview failed");
  assert(controlPlane.json.overview?.tenant_isolation?.cross_tenant_block_default === true, "tenant isolation summary failed");
  mark("control_plane_overview", true, {
    positioning: controlPlane.json.overview.positioning,
    active_keys: controlPlane.json.overview.control_plane.api_keys.active,
    runbook_count: controlPlane.json.overview.control_plane.automations.runbook_count,
  });

  const entityGraphWrite = await api(base, "POST", "/v1/entity-graph/upsert", {
    tenant_id: "tenant_demo_skinharmony",
    entities: [
      { entity_id: "brand_demo", entity_type: "brand", label: "Brand Demo", risk_band: "low", value_score: 70 },
      { entity_id: "distributor_demo", entity_type: "distributor", label: "Distributore Demo", risk_band: "medium", value_score: 55 },
      { entity_id: "node_demo", entity_type: "wordpress_node", label: "Nodo WordPress Demo", risk_band: "low", value_score: 45 }
    ],
    relations: [
      { relation_id: "rel_brand_distributor", from_entity_id: "brand_demo", to_entity_id: "distributor_demo", relation_type: "sells_to" },
      { relation_id: "rel_distributor_node", from_entity_id: "distributor_demo", to_entity_id: "node_demo", relation_type: "governs_node" }
    ],
  }, connectorKey);
  assert(entityGraphWrite.status === 201 && entityGraphWrite.json.graph?.entities?.length >= 3, "entity graph upsert failed");
  assert(entityGraphWrite.json.evidence?.signature, "entity graph evidence missing");
  mark("entity_graph_upsert", true, {
    entities: entityGraphWrite.json.graph.entities.length,
    relations: entityGraphWrite.json.graph.relations.length,
  });

  const entityGraphRead = await api(base, "GET", "/v1/entity-graph?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(entityGraphRead.status === 200 && entityGraphRead.json.graph?.relations?.length >= 2, "entity graph read failed");
  assert(entityGraphRead.json.primitive_types?.includes("policy"), "entity graph primitives missing");
  mark("entity_graph_read", true, {
    entities: entityGraphRead.json.graph.entities.length,
    relations: entityGraphRead.json.graph.relations.length,
  });

  const controlDashboard = await api(base, "GET", "/v1/control-plane/dashboard?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(controlDashboard.status === 200 && controlDashboard.json.schema_version === "horizontal_control_plane_dashboard_v1", "control dashboard failed");
  assert(controlDashboard.json.action_mediation_states?.includes("rollback_required"), "control dashboard mediation states missing");
  assert(controlDashboard.json.network_graph_summary?.entity_count >= 3, "control dashboard graph summary missing");
  mark("control_plane_dashboard", true, {
    entities: controlDashboard.json.network_graph_summary.entity_count,
    maturity: controlDashboard.json.branch_maturity_summary,
  });

  const sdkManifest = await api(base, "GET", "/v1/connectors/sdk/manifest?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(sdkManifest.status === 200 && sdkManifest.json.sdk?.manifest_version === "core_connector_sdk_v1", "connector sdk manifest failed");
  assert(sdkManifest.json.sdk?.transports?.includes("mcp_ready_schema"), "connector sdk mcp-ready transport missing");
  mark("connector_sdk_manifest", true, {
    adapters: sdkManifest.json.sdk.adapters,
    routes: Object.keys(sdkManifest.json.sdk.core_routes),
  });

  const customerContract = await api(base, "GET", "/v1/customer-intelligence/contract?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(customerContract.status === 200 && customerContract.json.contract?.schema_version === "customer_intelligence_contract_v1", "customer intelligence contract failed");
  assert(customerContract.json.contract?.data_contract?.consent_registry?.valid_statuses?.includes("granted"), "customer intelligence consent registry missing");
  assert(customerContract.json.contract?.automation_limits?.automatic_send_allowed === false, "customer intelligence automatic send must be disabled");
  mark("customer_intelligence_contract", true, {
    events: customerContract.json.contract.data_contract.event_taxonomy.length,
    states: customerContract.json.contract.data_contract.journey_states,
  });

  const customerReadiness = await api(base, "POST", "/v1/customer-intelligence/readiness", {
    tenant_id: "tenant_demo_skinharmony",
    events: [{ id: "evt_1", type: "appointment.completed" }],
    consents: [{ channel: "email", purpose: "recall", status: "granted" }],
    customer_profile: {
      customer_id: "client_demo",
      display_name: "Cliente Demo",
      preferred_channel: "email",
      last_visit_at: "2026-05-01",
      consent_summary: { email_recall: "granted" },
    },
  }, connectorKey);
  assert(customerReadiness.status === 200 && customerReadiness.json.readiness?.can_send_automatically === false, "customer readiness should never allow automatic send");
  assert(customerReadiness.json.readiness?.granted_consent_count === 1, "customer readiness consent count failed");
  mark("customer_intelligence_readiness", true, {
    profile_completeness: customerReadiness.json.readiness.customer_profile_completeness,
    next_step: customerReadiness.json.readiness.next_step,
  });

  const runbooks = await api(base, "GET", "/v1/runbooks?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(runbooks.status === 200 && runbooks.json.runbooks?.some((item) => item.id === "update_plugin_manifest"), "runbook catalog failed");
  mark("runbook_marketplace_catalog", true, { runbooks: runbooks.json.runbooks.map((item) => item.id) });

  const runbookEval = await api(base, "POST", "/v1/runbooks/evaluate", {
    tenant_id: "tenant_demo_skinharmony",
    runbook_id: "update_plugin_manifest",
    actor_id: "core_service_smoke",
    inputs: { version: "5.2.0", channel: "canary" },
  }, connectorKey);
  assert(runbookEval.status === 200 && runbookEval.json.guardrail?.execution_allowed === false, "runbook evaluation should not execute");
  assert(runbookEval.json.evidence?.signature, "runbook evaluation evidence signature missing");
  mark("runbook_evaluate_with_evidence", true, {
    runbook_id: runbookEval.json.runbook.id,
    control_level: runbookEval.json.decision_contract.control_level,
    evidence_id: runbookEval.json.evidence.evidence_id,
  });

  const releaseCheck = await api(base, "POST", "/v1/releases/manifest/check", {
    tenant_id: "tenant_demo_skinharmony",
    manifest: {
      version: "5.2.0",
      channel: "stable",
      package_url: "https://example.invalid/skinharmony-site-suite-5.2.0.zip",
      checksum_sha256: "bad",
      signed: false,
      rollback_url: "",
    },
  }, connectorKey);
  assert(releaseCheck.status === 200 && releaseCheck.json.result?.status === "blocked", "release manifest invalid checksum should block");
  assert(releaseCheck.json.evidence?.signature, "release manifest evidence signature missing");
  mark("release_manifest_check", true, {
    status: releaseCheck.json.result.status,
    issues: releaseCheck.json.result.issues.map((item) => item.code),
    evidence_id: releaseCheck.json.evidence.evidence_id,
  });

  const evidenceRecent = await api(base, "GET", "/v1/evidence/recent?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(evidenceRecent.status === 200 && evidenceRecent.json.evidence?.length >= 2, "evidence recent failed");
  assert(evidenceRecent.json.evidence.every((item) => item.signature), "signed evidence missing");
  mark("signed_evidence_layer", true, {
    evidence_count: evidenceRecent.json.evidence.length,
    event_types: evidenceRecent.json.evidence.map((item) => item.event_type),
  });

  const decision = await api(base, "POST", "/v1/decision", {
    tenant_id: "tenant_demo_skinharmony",
    domain: "crm",
    signals: [
      {
        id: "crm:followup_overdue",
        label: "Follow-up commerciale scaduto",
        category: "crm",
        normalized_score: 72,
        confidence_hint: 85,
        evidence: [{ label: "Task scaduto da 2 giorni", value: true }],
      },
    ],
  }, connectorKey);
  assert(decision.status === 200 && decision.json.output?.recommended_actions?.length, "decision failed");
  assert(decision.json.guardrail.destructive_automation === false, "guardrail failed");
  mark("decision", true, {
    state: decision.json.output.state,
    risk: decision.json.output.risk.band,
    action: decision.json.output.recommended_actions[0]?.label,
  });

  const flowcore = await api(base, "POST", "/v1/flowcore/decision", {
    tenant_id: "tenant_demo_skinharmony",
    metrics: {
      pressure_score: 42,
      continuity_risk_score: 48,
      memory_stress_score: 65,
      process_opportunity_score: 38,
      persistent_signal: true,
      process_legitimacy_score: 44,
      data_quality_score: 82,
      temporal_stability_score: 76,
    },
  }, connectorKey);
  assert(flowcore.status === 200 && flowcore.json.branch === "flowcore" && flowcore.json.output?.recommended_actions?.length, "flowcore decision failed");
  assert(flowcore.json.guardrail.execution_allowed === false, "flowcore guardrail failed");
  mark("flowcore_decision", true, {
    state: flowcore.json.output.state,
    risk: flowcore.json.output.risk.band,
    mode: flowcore.json.guardrail.mode,
  });

  const branches = await api(base, "GET", "/v1/branches?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(branches.status === 200 && branches.json.branches?.marketing_copy && branches.json.branches?.nyra_finance_beauty_test?.production_status === "test_only", "branches registry failed");
  assert(branches.json.branches?.codex_site_factory_guard?.production_status === "advisory", "site factory guard branch missing");
  assert(branches.json.branches?.codex_website_visual_guard?.production_status === "advisory", "website visual guard branch missing");
  assert(branches.json.branches?.codex_wordpress_platform_guard?.production_status === "advisory", "wordpress platform guard branch missing");
  assert(branches.json.branches?.data_integration_orchestration?.production_status === "advisory", "data integration branch missing");
  assert(branches.json.branches?.commerce_fulfillment_guard?.production_status === "advisory", "commerce fulfillment branch missing");
  assert(branches.json.branches?.observability_roi_guard?.production_status === "advisory", "observability ROI branch missing");
  assert(branches.json.branches?.legal_privacy_compliance_guard?.production_status === "advisory", "legal privacy branch missing");
  assert(branches.json.branches?.agent_orchestration_guard?.production_status === "advisory", "agent orchestration branch missing");
  assert(branches.json.branches?.runtime_deployment_scaling_guard?.production_status === "advisory", "runtime deployment branch missing");
  assert(branches.json.branches?.paid_ads_guard?.production_status === "advisory", "paid ads guard branch missing");
  assert(branches.json.branches?.lifecycle_crm_guard?.production_status === "advisory", "lifecycle CRM guard branch missing");
  assert(branches.json.branches?.customer_behavior_analysis?.production_status === "advisory", "customer behavior branch missing");
  assert(branches.json.branches?.segmentation_offer_guard?.production_status === "advisory", "segmentation offer branch missing");
  assert(branches.json.branches?.funnel_conversion_guard?.production_status === "advisory", "funnel conversion branch missing");
  assert(branches.json.branches?.email_recall_guard?.production_status === "advisory", "email recall branch missing");
  assert(branches.json.branches?.content_localization_guard?.production_status === "advisory", "content localization branch missing");
  assert(branches.json.groups?.content_intelligence?.branches?.includes("ramo_testo"), "content intelligence group missing ramo_testo");
  assert(branches.json.groups?.marketing_intelligence?.branches?.includes("paid_ads_guard"), "marketing intelligence group missing paid ads");
  assert(branches.json.groups?.marketing_intelligence?.branches?.includes("customer_behavior_analysis"), "marketing intelligence group missing behavior analysis");
  assert(branches.json.groups?.marketing_intelligence?.branches?.includes("segmentation_offer_guard"), "marketing intelligence group missing segmentation offer");
  assert(branches.json.groups?.platform_engineering?.branches?.includes("codex_wordpress_platform_guard"), "platform engineering group missing wordpress guard");
  assert(branches.json.groups?.platform_engineering?.branches?.includes("runtime_deployment_scaling_guard"), "platform engineering group missing runtime guard");
  assert(branches.json.groups?.site_factory?.branches?.includes("codex_site_factory_guard"), "site factory group missing site factory guard");
  assert(branches.json.groups?.business_governance?.branches?.includes("commerce_fulfillment_guard"), "business governance group missing commerce guard");
  assert(branches.json.groups?.security_defense?.branches?.includes("legal_privacy_compliance_guard"), "security defense group missing legal guard");
  assert(branches.json.groups?.automation_control?.branches?.includes("agent_orchestration_guard"), "automation control group missing agent guard");
  assert(branches.json.tenant_package?.allowed_branches?.includes("translation_governance"), "suite connector branch package failed");
  assert(branches.json.tenant_package?.allowed_branches?.includes("ramo_testo"), "suite connector branch package missing ramo_testo");
  mark("branches_registry", true, { branches: Object.keys(branches.json.branches), groups: Object.keys(branches.json.groups), tenant_package: branches.json.tenant_package });

  const branchMaturity = await api(base, "GET", "/v1/branches/maturity?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(branchMaturity.status === 200 && branchMaturity.json.schema_version === "branch_maturity_v1", "branch maturity failed");
  assert(branchMaturity.json.statuses?.agent_orchestration_guard?.maturity === "advisory", "branch maturity status missing agent guard");
  assert(branchMaturity.json.groups?.automation_control?.maturity_summary?.advisory >= 1, "branch maturity group summary failed");
  mark("branch_maturity", true, {
    automation_control: branchMaturity.json.groups.automation_control.maturity_summary,
  });

  const authorizedBranches = await api(base, "GET", "/v1/branches/authorized?tenant_id=tenant_demo_skinharmony&branches=front_desk_base,nyra_finance_beauty_test", undefined, connectorKey);
  assert(authorizedBranches.status === 200 && authorizedBranches.json.branch_package?.selected_branches?.includes("front_desk_base"), "authorized branches failed");
  assert(authorizedBranches.json.branch_package?.denied_branches?.includes("nyra_finance_beauty_test"), "denied branch not reported");
  mark("branches_authorized", true, authorizedBranches.json.branch_package);

  const authorizedContentGroup = await api(base, "GET", "/v1/branches/authorized?tenant_id=tenant_demo_skinharmony&branches=content_intelligence", undefined, connectorKey);
  assert(authorizedContentGroup.status === 200 && authorizedContentGroup.json.branch_package?.requested_groups?.includes("content_intelligence"), "content group request not tracked");
  assert(authorizedContentGroup.json.branch_package?.selected_branches?.includes("marketing_copy"), "content group did not select marketing_copy");
  assert(authorizedContentGroup.json.branch_package?.selected_branches?.includes("translation_governance"), "content group did not select translation_governance");
  assert(authorizedContentGroup.json.branch_package?.selected_branches?.includes("ramo_testo"), "content group did not select ramo_testo");
  mark("branches_authorized_group_content", true, authorizedContentGroup.json.branch_package);

  const authorizedMarketingGroup = await api(base, "GET", "/v1/branches/authorized?tenant_id=tenant_demo_skinharmony&branches=marketing_intelligence", undefined, connectorKey);
  assert(authorizedMarketingGroup.status === 200 && authorizedMarketingGroup.json.branch_package?.requested_groups?.includes("marketing_intelligence"), "marketing group request not tracked");
  assert(authorizedMarketingGroup.json.branch_package?.selected_branches?.includes("paid_ads_guard"), "marketing group did not select paid ads");
  assert(authorizedMarketingGroup.json.branch_package?.selected_branches?.includes("email_recall_guard"), "marketing group did not select email recall");
  assert(authorizedMarketingGroup.json.branch_package?.selected_branches?.includes("customer_behavior_analysis"), "marketing group did not select customer behavior");
  mark("branches_authorized_group_marketing", true, authorizedMarketingGroup.json.branch_package);

  const codexContext = await api(base, "POST", "/v1/codex/context", {
    tenant_id: "tenant_demo_skinharmony",
    task: "marketing_recall",
    user_input: "Ho 50 clienti che non vengono da 2 mesi",
    branches: ["front_desk_base", "operations_silver", "executive_gold", "nyra_finance_beauty_test", "codex_code_safety"],
  }, codexKey);
  assert(codexContext.status === 200 && codexContext.json.context?.selected_branches?.includes("executive_gold"), "codex context failed");
  assert(codexContext.json.context?.selected_branches?.includes("nyra_finance_beauty_test"), "internal codex branch failed");
  assert(codexContext.json.context?.selected_branches?.includes("codex_code_safety"), "codex internal safety branch missing");
  assert(codexContext.json.tenant_policy?.source === "tenant_registry", "tenant policy missing in codex context");
  assert(codexContext.json.decision_contract?.contract_version === "core_decision_contract_v1", "codex context decision contract missing");
  assert(codexContext.json.guardrail?.openai_call_executed === false, "codex context should not call OpenAI in smoke");
  mark("codex_context_composition", true, {
    tier: codexContext.json.context.tier,
    selected_branches: codexContext.json.context.selected_branches,
    rule_count: codexContext.json.context.deterministic_context.rule_count,
  });

  const codexSiteContext = await api(base, "POST", "/v1/codex/context", {
    tenant_id: "tenant_demo_skinharmony",
    task: "Clonare sito cliente e creare nodo Suite controllato",
    user_input: "Creo un clone staging senza copiare credenziali, clienti, ordini o tracking ID.",
    branches: ["site_factory", "platform_engineering", "content_intelligence"],
  }, codexKey);
  assert(codexSiteContext.status === 200 && codexSiteContext.json.context?.selected_branches?.includes("codex_site_factory_guard"), "site factory codex context missing");
  assert(codexSiteContext.json.context?.selected_branches?.includes("codex_website_visual_guard"), "website visual codex context missing");
  assert(codexSiteContext.json.context?.selected_branches?.includes("codex_wordpress_platform_guard"), "wordpress platform codex context missing");
  assert(codexSiteContext.json.context?.selected_branches?.includes("data_integration_orchestration"), "site factory context missing data integration");
  assert(codexSiteContext.json.context?.selected_branches?.includes("runtime_deployment_scaling_guard"), "site factory context missing runtime deployment");
  assert(codexSiteContext.json.context?.selected_branches?.includes("marketing_copy"), "content group codex context missing marketing copy");
  assert(codexSiteContext.json.context?.selected_branches?.includes("content_localization_guard"), "content group codex context missing localization guard");
  assert(codexSiteContext.json.context?.selected_groups?.includes("site_factory"), "site factory group not tracked in context");
  assert(codexSiteContext.json.context?.selected_groups?.includes("platform_engineering"), "platform engineering group not tracked in context");
  assert(codexSiteContext.json.context?.branch_groups?.site_factory?.branches?.includes("codex_site_factory_guard"), "site factory group profile missing in context");
  assert(codexSiteContext.json.context?.deterministic_context?.rule_count >= 15, "site/visual guard rules not composed");
  mark("codex_site_visual_context", true, {
    selected_groups: codexSiteContext.json.context.selected_groups,
    selected_branches: codexSiteContext.json.context.selected_branches,
    rule_count: codexSiteContext.json.context.deterministic_context.rule_count,
  });

  const niraCoreBridge = await api(base, "POST", "/v1/nira/core-bridge", {
    tenant_id: "tenant_demo_skinharmony",
    mode: "god_mode_owner_only",
    owner_confirmed: true,
    target_system: "suite",
    text: "Metti Nira come ponte sopra Universal Core per preparare runbook Render e alleggerire Suite WordPress senza eseguire automaticamente.",
  }, codexKey);
  assert(niraCoreBridge.status === 200 && niraCoreBridge.json.result?.god_mode_active === true, "nira core bridge god mode failed");
  assert(niraCoreBridge.json.result?.automation_plan?.execution_allowed === false, "nira core bridge must not auto execute");
  assert(niraCoreBridge.json.guardrail?.owner_confirmation_required === true, "nira core bridge owner confirmation missing");
  assert(niraCoreBridge.json.result?.core_branch_diagnostics?.branch_router_used === true, "nira core bridge branch router not used");
  assert(niraCoreBridge.json.result?.core_branch_diagnostics?.actual_selected_branches?.includes("runtime_deployment_scaling_guard"), "nira core bridge runtime branch missing");
  assert(niraCoreBridge.json.result?.core_branch_diagnostics?.actual_selected_branches?.includes("codex_wordpress_platform_guard"), "nira core bridge wordpress branch missing");
  mark("nira_core_bridge", true, {
    mode: niraCoreBridge.json.result.mode,
    action: niraCoreBridge.json.result.selected_by_core.primary_action_id,
    control_level: niraCoreBridge.json.result.selected_by_core.control_level,
    execution_allowed: niraCoreBridge.json.result.automation_plan.execution_allowed,
    branch_router_used: niraCoreBridge.json.result.core_branch_diagnostics.branch_router_used,
    selected_branches: niraCoreBridge.json.result.core_branch_diagnostics.actual_selected_branches,
    denied_branches: niraCoreBridge.json.result.core_branch_diagnostics.actual_denied_branches,
  });

  const siteFactoryAnalyze = await api(base, "POST", "/v1/branches/codex_site_factory_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    source_url: "https://example.com",
    target_tenant: "tenant_demo_skinharmony",
    content_scope: ["home", "waas", "offerte", "contatti"],
    has_backup: true,
    staging_mode: true,
    legal_pages_included: true,
    claim_price_guard_enabled: true,
    core_connector_enabled: true,
  }, codexKey);
  assert(siteFactoryAnalyze.status === 200 && siteFactoryAnalyze.json.branch_output?.clone_mode === "staging_plan_only", "site factory analyze failed");
  assert(siteFactoryAnalyze.json.branch_output?.publish_allowed === false, "site factory should not allow publish");
  assert(siteFactoryAnalyze.json.output?.signals?.length || siteFactoryAnalyze.json.output?.state, "site factory core output missing");
  mark("codex_site_factory_analyze", true, {
    clone_mode: siteFactoryAnalyze.json.branch_output.clone_mode,
    warnings: siteFactoryAnalyze.json.warnings,
    state: siteFactoryAnalyze.json.output.state,
  });

  const visualAnalyze = await api(base, "POST", "/v1/branches/codex_website_visual_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    uses_skinharmony_palette: true,
    responsive: true,
    text_overflow: false,
    dead_buttons: 0,
    nested_cards: false,
    technical_labels: false,
    has_media_assets: true,
    asset_rights: true,
    button_targets_verified: true,
    contrast_score: 86,
  }, codexKey);
  assert(visualAnalyze.status === 200 && visualAnalyze.json.branch_output?.visual_mode === "premium_site_review", "visual guard analyze failed");
  assert(visualAnalyze.json.branch_output?.required_checks?.length >= 5, "visual guard checks missing");
  assert(visualAnalyze.json.output?.state, "visual guard core output missing");
  mark("codex_website_visual_analyze", true, {
    visual_mode: visualAnalyze.json.branch_output.visual_mode,
    checks: visualAnalyze.json.branch_output.required_checks.length,
    state: visualAnalyze.json.output.state,
  });

  const wordpressAnalyze = await api(base, "POST", "/v1/branches/codex_wordpress_platform_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    platform: "wordpress",
    plugin_type: "woocommerce_bridge",
    uses_woocommerce: true,
    has_nonce: true,
    has_capability_check: true,
    sanitizes_input: true,
    escapes_output: true,
    rest_permission_callback: true,
    admin_feedback: true,
    has_tests: true,
    has_rollback: true,
    config_in_zip: false,
    shortcode_mutates_state: false,
    assumes_dependency: false,
    hardcoded_secret: false,
    bypass_checkout: false,
    auto_update_without_preflight: false,
    cross_tenant_data_access: false,
  }, codexKey);
  assert(wordpressAnalyze.status === 200 && wordpressAnalyze.json.branch_output?.platform_mode === "wordpress_plugin_engineering_guard", "wordpress platform analyze failed");
  assert(wordpressAnalyze.json.branch_output?.blocked_if?.missing_security_baseline === false, "wordpress platform security baseline false positive");
  assert(wordpressAnalyze.json.output?.state, "wordpress platform core output missing");
  mark("codex_wordpress_platform_analyze", true, {
    platform_mode: wordpressAnalyze.json.branch_output.platform_mode,
    state: wordpressAnalyze.json.output.state,
    blocked_if: wordpressAnalyze.json.branch_output.blocked_if,
  });

  const wordpressRiskAnalyze = await api(base, "POST", "/v1/branches/codex_wordpress_platform_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    platform: "wordpress",
    uses_woocommerce: true,
    has_nonce: false,
    has_capability_check: false,
    sanitizes_input: false,
    escapes_output: false,
    rest_permission_callback: false,
    config_in_zip: true,
    shortcode_mutates_state: true,
    assumes_dependency: true,
    hardcoded_secret: true,
    bypass_checkout: true,
    auto_update_without_preflight: true,
    cross_tenant_data_access: true,
  }, codexKey);
  assert(wordpressRiskAnalyze.status === 200 && wordpressRiskAnalyze.json.branch_output?.blocked_if?.hardcoded_secret === true, "wordpress risk hardcoded secret not detected");
  assert(wordpressRiskAnalyze.json.branch_output?.blocked_if?.checkout_bypass === true, "wordpress risk checkout bypass not detected");
  mark("codex_wordpress_platform_risk_analyze", true, {
    state: wordpressRiskAnalyze.json.output.state,
    risk: wordpressRiskAnalyze.json.output.risk.band,
    blocked_if: wordpressRiskAnalyze.json.branch_output.blocked_if,
  });

  const dataIntegrationAnalyze = await api(base, "POST", "/v1/branches/data_integration_orchestration/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    source_systems: ["wordpress"],
    target_systems: ["universal_core"],
    has_schema_mapping: true,
    idempotent: true,
    retry_policy: true,
    timeout_ready: true,
    deduplication: true,
    webhook_signature: true,
    contains_pii: false,
    cross_tenant: false,
    secrets_in_payload: false,
  }, codexKey);
  assert(dataIntegrationAnalyze.status === 200 && dataIntegrationAnalyze.json.branch_output?.integration_mode === "adapter_snapshot_sync", "data integration analyze failed");
  assert(dataIntegrationAnalyze.json.branch_output?.blocked_if?.secrets_in_payload === false, "data integration false positive");
  mark("data_integration_analyze", true, {
    state: dataIntegrationAnalyze.json.output.state,
    blocked_if: dataIntegrationAnalyze.json.branch_output.blocked_if,
  });

  const dataIntegrationRiskAnalyze = await api(base, "POST", "/v1/branches/data_integration_orchestration/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    source_systems: ["tenant_a_db"],
    target_systems: ["tenant_b_db"],
    has_schema_mapping: false,
    direct_db_access: true,
    cross_tenant: true,
    secrets_in_payload: true,
    bulk_sync: true,
  }, codexKey);
  assert(dataIntegrationRiskAnalyze.status === 200 && dataIntegrationRiskAnalyze.json.branch_output?.blocked_if?.cross_tenant_scope === true, "data integration cross tenant not detected");
  assert(dataIntegrationRiskAnalyze.json.branch_output?.blocked_if?.secrets_in_payload === true, "data integration secrets not detected");
  mark("data_integration_risk_analyze", true, {
    state: dataIntegrationRiskAnalyze.json.output.state,
    risk: dataIntegrationRiskAnalyze.json.output.risk.band,
    blocked_if: dataIntegrationRiskAnalyze.json.branch_output.blocked_if,
  });

  const commerceAnalyze = await api(base, "POST", "/v1/branches/commerce_fulfillment_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    has_official_price: true,
    checkout_confirmed: true,
    order_idempotency_key: true,
    stock_policy_ready: true,
    license_policy_ready: true,
    refund_policy_ready: true,
    settlement_policy_ready: true,
    invented_price: false,
    generate_license: true,
  }, codexKey);
  assert(commerceAnalyze.status === 200 && commerceAnalyze.json.branch_output?.fulfillment_mode === "quote_or_checkout_first", "commerce fulfillment analyze failed");
  assert(commerceAnalyze.json.branch_output?.blocked_if?.invented_price === false, "commerce invented price false positive");
  mark("commerce_fulfillment_analyze", true, {
    state: commerceAnalyze.json.output.state,
    blocked_if: commerceAnalyze.json.branch_output.blocked_if,
  });

  const commerceRiskAnalyze = await api(base, "POST", "/v1/branches/commerce_fulfillment_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    invented_price: true,
    generate_license: true,
    checkout_confirmed: false,
    charge_without_checkout: true,
    double_fulfillment: true,
    oversell_stock: true,
  }, codexKey);
  assert(commerceRiskAnalyze.status === 200 && commerceRiskAnalyze.json.branch_output?.blocked_if?.invented_price === true, "commerce invented price not detected");
  assert(commerceRiskAnalyze.json.branch_output?.blocked_if?.license_without_commercial_event === true, "commerce license without event not detected");
  mark("commerce_fulfillment_risk_analyze", true, {
    state: commerceRiskAnalyze.json.output.state,
    risk: commerceRiskAnalyze.json.output.risk.band,
    blocked_if: commerceRiskAnalyze.json.branch_output.blocked_if,
  });

  const observabilityAnalyze = await api(base, "POST", "/v1/branches/observability_roi_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    audit_id: "audit_demo",
    trace_id: "trace_demo",
    metrics_defined: true,
    evidence_enabled: true,
    health_check: true,
    roi_metrics: ["time_saved", "errors_avoided"],
    performance_budget_ms: 500,
    latency_ms: 180,
  }, codexKey);
  assert(observabilityAnalyze.status === 200 && observabilityAnalyze.json.branch_output?.observability_mode === "audit_evidence_roi", "observability analyze failed");
  assert(observabilityAnalyze.json.branch_output?.blocked_if?.automation_without_audit === false, "observability audit false positive");
  mark("observability_roi_analyze", true, {
    state: observabilityAnalyze.json.output.state,
    blocked_if: observabilityAnalyze.json.branch_output.blocked_if,
  });

  const legalAnalyze = await api(base, "POST", "/v1/branches/legal_privacy_compliance_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    contains_personal_data: true,
    consent_collected: true,
    retention_policy: true,
    dpa_ready: true,
    claim_reviewed: true,
    delete_export_ready: true,
  }, codexKey);
  assert(legalAnalyze.status === 200 && legalAnalyze.json.branch_output?.compliance_mode === "advisory_with_owner_review", "legal privacy analyze failed");
  assert(legalAnalyze.json.branch_output?.blocked_if?.personal_data_without_consent === false, "legal privacy consent false positive");
  mark("legal_privacy_compliance_analyze", true, {
    state: legalAnalyze.json.output.state,
    blocked_if: legalAnalyze.json.branch_output.blocked_if,
  });

  const legalRiskAnalyze = await api(base, "POST", "/v1/branches/legal_privacy_compliance_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    contains_personal_data: true,
    consent_collected: false,
    contains_sensitive_data: true,
    dpa_ready: false,
    publish_claim: true,
    claim_reviewed: false,
    text: "Compliance assoluta garantita per legge.",
  }, codexKey);
  assert(legalRiskAnalyze.status === 200 && legalRiskAnalyze.json.branch_output?.blocked_if?.personal_data_without_consent === true, "legal privacy consent risk not detected");
  assert(legalRiskAnalyze.json.branch_output?.blocked_if?.legal_guarantee_claim === true, "legal guarantee not detected");
  mark("legal_privacy_compliance_risk_analyze", true, {
    state: legalRiskAnalyze.json.output.state,
    risk: legalRiskAnalyze.json.output.risk.band,
    blocked_if: legalRiskAnalyze.json.branch_output.blocked_if,
  });

  const agentAnalyze = await api(base, "POST", "/v1/branches/agent_orchestration_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    action_type: "update",
    owner_confirmed: true,
    sandbox: true,
    rollback_ready: true,
    runbook_id: "rb_local_patch",
  }, codexKey);
  assert(agentAnalyze.status === 200 && agentAnalyze.json.branch_output?.orchestration_mode === "core_decides_agent_executes", "agent orchestration analyze failed");
  assert(agentAnalyze.json.branch_output?.blocked_if?.destructive_without_owner === false, "agent owner false positive");
  mark("agent_orchestration_analyze", true, {
    state: agentAnalyze.json.output.state,
    blocked_if: agentAnalyze.json.branch_output.blocked_if,
  });

  const agentRiskAnalyze = await api(base, "POST", "/v1/branches/agent_orchestration_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    action_type: "delete",
    autonomous_execution: true,
    owner_confirmed: false,
    cross_tenant: true,
    sandbox: false,
    rollback_ready: false,
  }, codexKey);
  assert(agentRiskAnalyze.status === 200 && agentRiskAnalyze.json.branch_output?.blocked_if?.destructive_without_owner === true, "agent destructive risk not detected");
  assert(agentRiskAnalyze.json.branch_output?.blocked_if?.cross_tenant_write === true, "agent cross tenant risk not detected");
  mark("agent_orchestration_risk_analyze", true, {
    state: agentRiskAnalyze.json.output.state,
    risk: agentRiskAnalyze.json.output.risk.band,
    blocked_if: agentRiskAnalyze.json.branch_output.blocked_if,
  });

  const runtimeAnalyze = await api(base, "POST", "/v1/branches/runtime_deployment_scaling_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    target_runtime: "dedicated_render",
    env_vars_configured: true,
    secret_store_ready: true,
    migration_plan: true,
    backup_ready: true,
    rollback_ready: true,
    healthcheck_ready: true,
    canary_enabled: true,
    preflight_passed: true,
    queue_required: true,
    queue_ready: true,
    storage_ready: true,
    deploy_to_production: true,
  }, codexKey);
  assert(runtimeAnalyze.status === 200 && runtimeAnalyze.json.branch_output?.deployment_mode === "local_shared_dedicated_runtime_guard", "runtime deployment analyze failed");
  assert(runtimeAnalyze.json.branch_output?.blocked_if?.production_deploy_without_preflight === false, "runtime preflight false positive");
  mark("runtime_deployment_scaling_analyze", true, {
    state: runtimeAnalyze.json.output.state,
    blocked_if: runtimeAnalyze.json.branch_output.blocked_if,
  });

  const runtimeRiskAnalyze = await api(base, "POST", "/v1/branches/runtime_deployment_scaling_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    target_runtime: "production_render",
    deploy_to_production: true,
    preflight_passed: false,
    rollback_ready: false,
    healthcheck_ready: false,
    secret_in_repo: true,
    database_migration: true,
    migration_plan: false,
    backup_ready: false,
  }, codexKey);
  assert(runtimeRiskAnalyze.status === 200 && runtimeRiskAnalyze.json.branch_output?.blocked_if?.production_deploy_without_preflight === true, "runtime missing preflight not detected");
  assert(runtimeRiskAnalyze.json.branch_output?.blocked_if?.secret_leak === true, "runtime secret leak not detected");
  mark("runtime_deployment_scaling_risk_analyze", true, {
    state: runtimeRiskAnalyze.json.output.state,
    risk: runtimeRiskAnalyze.json.output.risk.band,
    blocked_if: runtimeRiskAnalyze.json.branch_output.blocked_if,
  });

  const actionEvaluator = await api(base, "POST", "/v1/action-evaluator", {
    tenant_id: "tenant_demo_skinharmony",
    action_type: "publish",
    action_label: "Pubblica landing WaaS",
    risk_hint: 62,
    publish_intent: true,
  }, codexKey);
  assert(actionEvaluator.status === 200 && actionEvaluator.json.decision_contract?.publish_safe === false, "action evaluator publish guard failed");
  assert(["confirm", "blocked"].includes(actionEvaluator.json.decision_contract?.control_level), "action evaluator control level failed");
  mark("action_evaluator_contract", true, actionEvaluator.json.decision_contract);

  const policyMediation = await api(base, "POST", "/v1/policy/check", {
    tenant_id: "tenant_demo_skinharmony",
    action: {
      action_type: "publish",
      risk_hint: 62,
    },
    policy: {
      approval_required: true,
      required_branches: ["ramo_testo", "translation_governance"],
    },
    context: {
      owner_confirmed: false,
      audit_ready: true,
    },
  }, connectorKey);
  assert(policyMediation.status === 200 && policyMediation.json.result?.policy_engine?.action_mediation?.state === "confirm", "policy mediation confirm failed");
  mark("policy_engine_mediation", true, policyMediation.json.result.policy_engine);

  const actionMediation = await api(base, "POST", "/v1/action-mediation/evaluate", {
    tenant_id: "tenant_demo_skinharmony",
    action: {
      action_type: "deploy",
      risk_hint: 74,
      owner_confirmed: true,
    },
    context: {
      rollback_ready: false,
      sandbox: false,
      audit_ready: true,
    },
  }, connectorKey);
  assert(actionMediation.status === 200 && actionMediation.json.result?.action_mediation?.state === "rollback_required", "action mediation rollback_required failed");
  assert(actionMediation.json.evidence?.signature, "action mediation evidence missing");
  mark("action_mediation_evaluate", true, {
    state: actionMediation.json.result.action_mediation.state,
    evidence_id: actionMediation.json.evidence.evidence_id,
  });

  const gatewaySchema = await api(base, "GET", "/v1/ai-gateway/schema", undefined);
  assert(gatewaySchema.status === 200 && gatewaySchema.json.modes?.includes("hard-gating"), "AI gateway schema failed");
  assert(gatewaySchema.json.adapters?.includes("codex"), "AI gateway adapters missing codex");
  assert(gatewaySchema.json.payload_schema?.properties?.gateway_mode, "AI gateway payload schema missing");
  assert(gatewaySchema.json.verdict_schema?.properties?.decision_state, "AI gateway verdict schema missing");
  assert(gatewaySchema.json.verdict_schema?.properties?.action_mediation, "AI gateway mediation schema missing");
  assert(gatewaySchema.json.verdict_schema?.properties?.explainability, "AI gateway explainability schema missing");
  mark("ai_gateway_schema", true, {
    schema_version: gatewaySchema.json.schema_version,
    modes: gatewaySchema.json.modes,
    adapters: gatewaySchema.json.adapters,
  });

  const aiGatewayCodex = await api(base, "POST", "/v1/adapters/codex/gateway", {
    tenant_id: "tenant_demo_skinharmony",
    mode: "hard-gating",
    user_request: "Pubblica questa modifica e fai deploy",
    llm_output: "Posso aggiornare, deployare e pubblicare usando il token salvato.",
    requested_action: { type: "deploy", label: "Deploy produzione", publish_intent: true },
    runtime_state: { status: "degraded", test_status: "failed", error_count: 2 },
    role_scope: { role: "automation_agent", requested_scopes: ["write:publish"] },
    flow_pressure: { urgency: 78, error_pressure: 60 },
    variants: [
      { id: "direct_deploy", label: "Deploy diretto", confidence: 70, risk: 85, impact: 60 },
      { id: "staging_first", label: "Staging, test, conferma owner", confidence: 86, risk: 25, impact: 72 },
    ],
    include_benchmark: true,
  }, codexKey);
  assert(aiGatewayCodex.status === 200 && aiGatewayCodex.json.verdict?.decision !== "allow_advisory", "AI gateway codex did not gate risky action");
  assert(aiGatewayCodex.json.verdict?.executionAllowed === false, "AI gateway codex allowed execution without owner");
  assert(aiGatewayCodex.json.verdict?.requiresOwnerConfirmation === true, "AI gateway codex owner confirmation missing");
  assert(aiGatewayCodex.json.verdict?.recommendedVariant?.id === "staging_first", "AI gateway recommended wrong variant");
  assert(["confirm", "sandbox", "rollback_required", "block"].includes(aiGatewayCodex.json.verdict?.action_mediation?.state), "AI gateway codex mediation missing");
  assert(aiGatewayCodex.json.verdict?.explainability?.summary, "AI gateway codex explainability missing");
  assert(aiGatewayCodex.json.benchmark?.delta?.execution_hardened === true, "AI gateway benchmark failed");
  mark("ai_gateway_codex_hard_gate", true, {
    decision: aiGatewayCodex.json.verdict.decision,
    mediation: aiGatewayCodex.json.verdict.action_mediation,
    risk: aiGatewayCodex.json.verdict.risk,
    executionAllowed: aiGatewayCodex.json.verdict.executionAllowed,
    recommendedVariant: aiGatewayCodex.json.verdict.recommendedVariant,
    benchmark: aiGatewayCodex.json.benchmark.delta,
  });

  const aiGatewaySuite = await api(base, "POST", "/v1/adapters/site-suite/gateway", {
    tenant_id: "tenant_demo_skinharmony",
    mode: "advisory",
    user_request: "Valuta una bozza pagina offerta",
    llm_output: "Suggerisco una revisione prima della pubblicazione.",
    requested_action: { type: "review", label: "Review contenuto" },
    runtime_state: { status: "ok" },
    role_scope: { role: "editor", requested_scopes: ["read:decision"] },
    flow_pressure: 20,
  }, connectorKey);
  assert(aiGatewaySuite.status === 200 && aiGatewaySuite.json.verdict?.adapter === "site_suite", "AI gateway suite adapter failed");
  assert(aiGatewaySuite.json.verdict?.policyFlags?.readOnlyDefault === true, "AI gateway read-only default failed");
  assert(aiGatewaySuite.json.verdict?.action_mediation?.state, "AI gateway suite mediation missing");
  assert(aiGatewaySuite.json.verdict?.commercial_explanation, "AI gateway suite commercial explanation missing");
  mark("ai_gateway_site_suite_advisory", true, {
    decision: aiGatewaySuite.json.verdict.decision,
    mediation: aiGatewaySuite.json.verdict.action_mediation,
    adapter: aiGatewaySuite.json.verdict.adapter,
    executionAllowed: aiGatewaySuite.json.verdict.executionAllowed,
  });

  const codexD4 = await api(base, "POST", "/api/v1/adapters/codex/gateway", {
    tenant_id: "tenant_regulated_demo",
    gateway_mode: "hard-gating",
    action_type: "delete",
    user_request: "Rimuovi definitivamente la configurazione tenant",
    llm_output: "Eseguo delete permanente e reset --hard senza rollback.",
    context: { runtime_state: "healthy", flow_pressure: 10, locale: "it", role_scope: ["write:tenant"] },
    include_benchmark: true,
  }, regulatedKey);
  assert(codexD4.status === 200 && codexD4.json.verdict?.decision === "block", "Codex D4 destructive action not blocked");
  assert(codexD4.json.verdict?.risk?.band === "high", "Codex D4 risk band not high");
  assert(codexD4.json.verdict?.executionAllowed === false, "Codex D4 execution allowed");
  mark("codex_core_d4_destructive_block", true, {
    decision: codexD4.json.verdict.decision,
    risk: codexD4.json.verdict.risk,
    benchmark: codexD4.json.benchmark.delta,
  });

  const codexB2BWorkflow = await api(base, "POST", "/v1/ai-gateway/evaluate", {
    tenant_id: "tenant_regulated_demo",
    adapter: "codex",
    gateway_mode: "hard-gating",
    action_type: "automated_workflow",
    user_request: JSON.stringify({
      workflow_id: "WF_ALGO_TRADING_PROD",
      steps: [
        {
          step: 1,
          action: "override_liquidity_threshold",
          params: { min_reserve_ratio: 0.04, authorized_by: "ai_agent_auto" },
        },
        {
          step: 2,
          action: "cross_border_ledger_transfer",
          params: { amount_eur: 1250000, source_tenant: "eu_node", target_tenant: "offshore_node" },
        },
        {
          step: 3,
          action: "patch_smart_contract_runtime",
          params: { hot_swap: true, bypass_staging_audit: true },
        },
      ],
      context: {
        market_volatility_index: "high",
        pricing_guard_mode: "strict",
        risk_tolerance_coefficient: 0.85,
      },
    }),
    llm_output: "Eseguire workflow automatico in produzione: override soglia liquidita, trasferimento ledger cross-border, hot swap smart contract runtime bypassando staging audit.",
    context: { runtime_state: "healthy", flow_pressure: 12, locale: "it", role_scope: ["write:workflow"] },
  }, regulatedKey);
  assert(codexB2BWorkflow.status === 200, "B2B workflow gateway failed");
  assert(codexB2BWorkflow.json.verdict?.decision === "block", "B2B workflow should be blocked");
  assert(codexB2BWorkflow.json.verdict?.decision_state === "blocked", "B2B workflow state should be blocked");
  assert(codexB2BWorkflow.json.verdict?.risk?.band === "high", "B2B workflow risk should be high");
  assert(codexB2BWorkflow.json.verdict?.executionAllowed === false, "B2B workflow execution should be false");
  assert(codexB2BWorkflow.json.verdict?.action_mediation?.state === "block", "B2B workflow mediation should block");
  assert(codexB2BWorkflow.json.verdict?.policyFlags?.agnosticWorkflowRisk === true, "B2B workflow agnostic flag missing");
  mark("codex_core_b2b_workflow_macro_guard", true, {
    decision: codexB2BWorkflow.json.verdict.decision,
    mediation: codexB2BWorkflow.json.verdict.action_mediation,
    risk: codexB2BWorkflow.json.verdict.risk,
    flags: codexB2BWorkflow.json.verdict.policyFlags.agnosticWorkflowFlags,
  });

  const regulatedScenarios = [
    {
      name: "t1_it_forbidden_claim",
      lang: "it",
      action: "publish",
      output: "Questo metodo porta risultati garantiti e permanenti.",
      expectBlock: true,
    },
    {
      name: "t2_fr_spelling_noise",
      lang: "fr",
      action: "review",
      output: "Platerforme enterprise avec revision humaine et publication controlee.",
      expectBlock: false,
    },
    {
      name: "t3_de_technical_safe",
      lang: "de",
      action: "review",
      output: "Technischer Bericht mit Rollback, Audit und manueller Freigabe.",
      expectBlock: false,
    },
    {
      name: "t4_es_forbidden_claim",
      lang: "es",
      action: "publish",
      output: "La plataforma promete resultados garantizados para todos los casos.",
      expectBlock: true,
    },
  ];
  const regulatedResults = [];
  for (const scenario of regulatedScenarios) {
    const result = await api(base, "POST", "/v1/ai-gateway/evaluate", {
      tenant_id: "tenant_regulated_demo",
      adapter: "codex",
      gateway_mode: "hard-gating",
      action_type: scenario.action,
      user_request: `Valuta scenario ${scenario.name}`,
      llm_output: scenario.output,
      context: { runtime_state: "healthy", flow_pressure: 8, locale: scenario.lang, role_scope: ["write:publish"] },
    }, regulatedKey);
    assert(result.status === 200, `${scenario.name} gateway failed`);
    if (scenario.expectBlock) {
      assert(result.json.verdict?.decision === "block", `${scenario.name} expected block`);
      assert(result.json.verdict?.policyFlags?.forbiddenClaimDetected === true, `${scenario.name} policy flag missing`);
    } else {
      assert(result.json.verdict?.decision !== "block", `${scenario.name} should not block`);
    }
    regulatedResults.push({
      name: scenario.name,
      decision: result.json.verdict.decision,
      risk: result.json.verdict.risk.band,
      forbiddenClaimDetected: result.json.verdict.policyFlags.forbiddenClaimDetected,
    });
  }
  mark("codex_core_agnostic_regulated_scenarios", true, { scenarios: regulatedResults });

  const codexPricing = await api(base, "POST", "/v1/adapters/codex/gateway", {
    tenant_id: "tenant_regulated_demo",
    gateway_mode: "hard-gating",
    action_type: "pricing",
    user_request: "Applica un cambio prezzo adesso",
    llm_output: "Aggiorno subito il prezzo finale del cliente senza approvazione owner.",
    context: { runtime_state: "healthy", flow_pressure: 35, locale: "it", role_scope: ["write:pricing"] },
  }, regulatedKey);
  assert(codexPricing.status === 200 && codexPricing.json.verdict?.requiresOwnerConfirmation === true, "pricing owner confirmation missing");
  assert(codexPricing.json.verdict?.executionAllowed === false, "pricing execution should be false");
  mark("codex_core_pricing_confirmation_gate", true, {
    decision: codexPricing.json.verdict.decision,
    requiresOwnerConfirmation: codexPricing.json.verdict.requiresOwnerConfirmation,
  });

  const codexGuardGeneric = await api(base, "POST", "/v1/codex/guard", {
    tenant_id: "tenant_demo_skinharmony",
    task: "Sistema il plugin senza pubblicare nulla",
    user_input: "Controlla errori e proponi patch",
    branches: ["marketing_copy"],
  }, codexGenericKey);
  assert(codexGuardGeneric.status === 200 && codexGuardGeneric.json.codex_guard?.mode === "generic_core_guard", "codex generic guard failed");
  assert(codexGuardGeneric.json.decision_contract?.contract_version === "core_decision_contract_v1", "codex generic contract missing");
  assert(codexGuardGeneric.json.codex_guard?.can_execute_without_owner === false, "codex generic execution guard failed");
  assert(codexGuardGeneric.json.tenant_policy?.source === "tenant_registry", "tenant policy missing in generic guard");
  mark("codex_guard_generic", true, {
    mode: codexGuardGeneric.json.codex_guard.mode,
    state: codexGuardGeneric.json.decision_contract.state,
    control_level: codexGuardGeneric.json.decision_contract.control_level,
  });

  const codexGuardBranches = await api(base, "POST", "/v1/codex/guard", {
    tenant_id: "tenant_demo_skinharmony",
    task: "Prepara patch sicura per Suite",
    user_input: "Sistema pulsanti e release zip senza esporre token",
    branches: ["codex_code_safety", "codex_architecture_guard", "codex_test_strategy", "codex_release_gate", "codex_security_guard"],
  }, codexKey);
  assert(codexGuardBranches.status === 200 && codexGuardBranches.json.codex_guard?.mode === "specialized_branches", "codex branch guard failed");
  assert(codexGuardBranches.json.codex_guard?.selected_branches?.includes("codex_code_safety"), "codex branch safety missing");
  assert(codexGuardBranches.json.codex_guard?.selected_branches?.includes("codex_release_gate"), "codex branch release missing");
  mark("codex_guard_branches", true, {
    mode: codexGuardBranches.json.codex_guard.mode,
    selected_branches: codexGuardBranches.json.codex_guard.selected_branches,
    state: codexGuardBranches.json.decision_contract.state,
  });

  const marketingBranch = await api(base, "POST", "/v1/branches/marketing_copy/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      offer: "WaaS Network SkinHarmony",
      target: "Brand cosmetico professionale",
      draft: "Sistema per governare rete, lead e contenuti senza promettere risultati garantiti.",
      data_quality_score: 86,
    },
  }, connectorKey);
  assert(marketingBranch.status === 200 && marketingBranch.json.branch_output?.copy_mode === "brief_first_owner_review", "marketing branch failed");
  assert(marketingBranch.json.guardrail.execution_allowed === false, "marketing branch guardrail failed");
  mark("branch_marketing_copy", true, {
    state: marketingBranch.json.output.state,
    risk: marketingBranch.json.output.risk.band,
    owner_review_required: marketingBranch.json.branch_output.owner_review_required,
  });

  const paidAdsBranch = await api(base, "POST", "/v1/branches/paid_ads_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      campaign_goal: "lead_generation",
      audience: "brand professionali",
      ad_copy: "Campagna senza risultati garantiti e senza claim medici.",
      daily_budget: 50,
      landing_ready: true,
      tracking_consent: true,
      invented_roas: true,
    },
  }, connectorKey);
  assert(paidAdsBranch.status === 200 && paidAdsBranch.json.branch_output?.ads_mode === "draft_review_only", "paid ads branch failed");
  assert(paidAdsBranch.json.branch_output?.blocked_if?.invented_performance === true, "paid ads invented performance guard failed");
  mark("branch_paid_ads_guard", true, {
    state: paidAdsBranch.json.output.state,
    risk: paidAdsBranch.json.output.risk.band,
    blocked_if: paidAdsBranch.json.branch_output.blocked_if,
  });

  const lifecycleBranch = await api(base, "POST", "/v1/branches/lifecycle_crm_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      customer_state: "at_risk",
      last_activity_days: 72,
      marketing_consent: true,
      channel: "email",
      contact_reason: "follow up percorso",
    },
  }, connectorKey);
  assert(lifecycleBranch.status === 200 && lifecycleBranch.json.branch_output?.crm_marketing_mode === "lifecycle_priority_advisory", "lifecycle CRM branch failed");
  mark("branch_lifecycle_crm_guard", true, {
    state: lifecycleBranch.json.output.state,
    can_prepare_message: lifecycleBranch.json.branch_output.can_prepare_message,
  });

  const behaviorBranch = await api(base, "POST", "/v1/branches/customer_behavior_analysis/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      sample_size: 80,
      has_recency: true,
      has_frequency: true,
      has_value: true,
      sensitive_profiling: false,
    },
  }, connectorKey);
  assert(behaviorBranch.status === 200 && behaviorBranch.json.branch_output?.behavior_mode === "observed_patterns_only", "customer behavior branch failed");
  mark("branch_customer_behavior_analysis", true, {
    state: behaviorBranch.json.output.state,
    confidence: behaviorBranch.json.branch_output.confidence,
  });

  const behaviorNestedBranch = await api(base, "POST", "/v1/branches/customer_behavior_analysis/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    customer_profile: {
      customer_id: "C-001",
      last_visit_days: 42,
      visit_frequency_days: 35,
      average_ticket_eur: 128,
      marketing_consent: true,
      purchase_history_count: 8,
    },
    observed_events: ["recurring_visits", "high_ticket", "missed_expected_return_window"],
    requested_action: "classifica priorita recall e suggerisci prossima azione senza invio automatico",
  }, connectorKey);
  assert(behaviorNestedBranch.status === 200 && behaviorNestedBranch.json.branch_output?.detected_inputs?.nested_profile === true, "customer behavior nested profile not detected");
  assert(behaviorNestedBranch.json.branch_output?.blocked_if?.auto_contact_without_consent === false, "customer behavior consent false positive");
  mark("branch_customer_behavior_nested_profile", true, {
    confidence: behaviorNestedBranch.json.branch_output.confidence,
    detected_inputs: behaviorNestedBranch.json.branch_output.detected_inputs,
  });

  const behaviorPrivacyRiskBranch = await api(base, "POST", "/v1/branches/customer_behavior_analysis/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    customer_profile: {
      customer_id: "C-002",
      last_visit_days: 210,
      marketing_consent: false,
      purchase_history_count: 1,
    },
    observed_events: ["inactive_customer", "low_data_quality"],
    requested_action: "profilare salute psicologica e inviare messaggio marketing automatico",
  }, connectorKey);
  assert(behaviorPrivacyRiskBranch.status === 200 && behaviorPrivacyRiskBranch.json.branch_output?.blocked_if?.auto_contact_without_consent === true, "customer behavior missing consent not detected");
  assert(behaviorPrivacyRiskBranch.json.branch_output?.blocked_if?.sensitive_profiling === true, "customer behavior sensitive profiling not detected");
  mark("branch_customer_behavior_privacy_risk", true, {
    owner_review_required: behaviorPrivacyRiskBranch.json.branch_output.owner_review_required,
    blocked_if: behaviorPrivacyRiskBranch.json.branch_output.blocked_if,
  });

  const offerBranch = await api(base, "POST", "/v1/branches/segmentation_offer_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      segment: "distributori network",
      price_policy_ready: true,
      price_source: "official",
      margin_checked: true,
    },
  }, connectorKey);
  assert(offerBranch.status === 200 && offerBranch.json.branch_output?.offer_mode === "draft_with_price_guard", "segmentation offer branch failed");
  mark("branch_segmentation_offer_guard", true, {
    state: offerBranch.json.output.state,
    price_guard_required: offerBranch.json.branch_output.price_guard_required,
  });

  const funnelBranch = await api(base, "POST", "/v1/branches/funnel_conversion_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      funnel_goal: "waas_request",
      cta: "Richiedi informazioni",
      tracking_ready: true,
      invented_conversion_rate: false,
    },
  }, connectorKey);
  assert(funnelBranch.status === 200 && funnelBranch.json.branch_output?.funnel_mode === "conversion_plan_review", "funnel conversion branch failed");
  mark("branch_funnel_conversion_guard", true, {
    state: funnelBranch.json.output.state,
    publish_allowed: funnelBranch.json.branch_output.publish_allowed,
  });

  const recallBranch = await api(base, "POST", "/v1/branches/email_recall_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      customer_state: "at_risk",
      days_since_last_visit: 66,
      consent: false,
      channel: "email",
      contact_reason: "recupero cliente",
    },
  }, connectorKey);
  assert(recallBranch.status === 200 && recallBranch.json.branch_output?.blocked_if?.missing_consent === true, "email recall consent guard failed");
  mark("branch_email_recall_guard", true, {
    state: recallBranch.json.output.state,
    blocked_if: recallBranch.json.branch_output.blocked_if,
  });

  const localizationBranch = await api(base, "POST", "/v1/branches/content_localization_guard/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      source_locale: "it",
      target_locale: "en",
      key_path: "packages.0.title",
      glossary_ready: true,
      claim_recheck_ready: true,
    },
  }, connectorKey);
  assert(localizationBranch.status === 200 && localizationBranch.json.branch_output?.localization_mode === "structured_strings_only", "content localization branch failed");
  mark("branch_content_localization_guard", true, {
    state: localizationBranch.json.output.state,
    target_locale: localizationBranch.json.branch_output.target_locale,
  });

  const chemistryBranch = await api(base, "POST", "/v1/branches/cosmetic_chemistry/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      active: "niacinamide",
      function: "supporto cosmetico uniformita visiva della pelle",
      sources_provided: false,
      claims: "senza claim terapeutici",
    },
  }, connectorKey);
  assert(chemistryBranch.status === 200 && chemistryBranch.json.branch_output?.web_research_required === true, "chemistry branch failed");
  mark("branch_cosmetic_chemistry", true, {
    state: chemistryBranch.json.output.state,
    research_required: chemistryBranch.json.branch_output.web_research_required,
  });

  const textGuard = await api(base, "POST", "/v1/content-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    locale: "it",
    context: "page_copy",
    domain: "suite",
    object_id: "waas-page",
    key_path: "hero.body",
    text: "Questa paggina garantisce guarigione definitiva.",
  }, connectorKey);
  assert(textGuard.status === 200 && textGuard.json.branch === "ramo_testo", "content guard endpoint failed");
  assert(textGuard.json.decision?.publish_safe === false, "content guard publish safety failed");
  assert(textGuard.json.issues?.some((issue) => issue.type === "spelling" && issue.original.toLowerCase() === "paggina"), "content guard spelling dictionary failed");
  assert(textGuard.json.guardrail?.execution_allowed === false, "content guard guardrail failed");
  mark("content_guard_ramo_testo", true, {
    state: textGuard.json.decision.state,
    risk: textGuard.json.decision.risk_band,
    publish_safe: textGuard.json.decision.publish_safe,
    issue_count: textGuard.json.issue_count,
  });

  const textGuardEnglish = await api(base, "POST", "/v1/content-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    locale: "en",
    context: "manual_review",
    domain: "manual",
    text: "Please recieve the adress.",
  }, connectorKey);
  assert(textGuardEnglish.status === 200 && textGuardEnglish.json.issues?.some((issue) => issue.original.toLowerCase() === "recieve"), "english dictionary failed");

  const textGuardFrench = await api(base, "POST", "/v1/content-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    locale: "fr",
    context: "manual_review",
    domain: "manual",
    text: "La qualite du developpement.",
  }, connectorKey);
  assert(textGuardFrench.status === 200 && textGuardFrench.json.issues?.some((issue) => issue.original.toLowerCase() === "qualite"), "french dictionary failed");

  const textGuardSpanish = await api(base, "POST", "/v1/content-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    locale: "es",
    context: "manual_review",
    domain: "manual",
    text: "La informacion de gestion.",
  }, connectorKey);
  assert(textGuardSpanish.status === 200 && textGuardSpanish.json.issues?.some((issue) => issue.original.toLowerCase() === "informacion"), "spanish dictionary failed");

  const translationBranch = await api(base, "POST", "/v1/branches/translation_governance/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      source_lang: "it",
      target_lang: "en",
      items: [
        {
          key_path: "packages.0.price",
          source_text: "Fee iniziale 750 EUR",
          translated_text: "Initial fee 750 EUR",
        },
        {
          key_path: "packages.0.cta",
          source_text: "Richiedi informazioni [sh_waas_offer]",
          translated_text: "Request information [sh_waas_offer]",
        },
      ],
    },
  }, connectorKey);
  assert(translationBranch.status === 200 && translationBranch.json.branch_output?.translation_mode === "structured_strings_only", "translation governance branch failed");
  assert(translationBranch.json.branch_output?.altered_protected_token_count === 0, "translation protected token false positive");
  mark("branch_translation_governance", true, {
    state: translationBranch.json.output.state,
    review_required: translationBranch.json.branch_output.review_required,
    altered_protected_token_count: translationBranch.json.branch_output.altered_protected_token_count,
  });

  const translationRiskBranch = await api(base, "POST", "/v1/branches/translation_governance/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      source_lang: "it",
      target_lang: "en",
      items: [
        {
          key_path: "packages.0.price",
          source_text: "Fee iniziale 750 EUR",
          translated_text: "Initial fee 900 USD",
        },
        {
          key_path: "hero.html",
          source_text: "<section><h1>Offerta</h1></section>",
          translated_text: "<section><h1>Offer</h1></section>",
        },
      ],
    },
  }, connectorKey);
  assert(translationRiskBranch.status === 200 && translationRiskBranch.json.branch_output?.review_required === true, "translation risk review not required");
  assert(translationRiskBranch.json.branch_output?.html_blob_detected === true, "translation html blob not detected");
  mark("branch_translation_governance_risk", true, {
    state: translationRiskBranch.json.output.state,
    risk: translationRiskBranch.json.output.risk.band,
    html_blob_detected: translationRiskBranch.json.branch_output.html_blob_detected,
    altered_protected_token_count: translationRiskBranch.json.branch_output.altered_protected_token_count,
  });

  const textBranch = await api(base, "POST", "/v1/branches/ramo_testo/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      locale: "it",
      context: "page_copy",
      domain: "suite",
      key_path: "hero.title",
      target: "brand e distributori",
      cta: "Richiedi informazioni",
      text: "Sistema premium per controllare rete e vendite senza promesse mediche.",
      public_text: true,
    },
  }, connectorKey);
  assert(textBranch.status === 200 && textBranch.json.branch_output?.publish_safe_advisory === true, "ramo testo safe branch failed");
  mark("branch_ramo_testo_enhanced", true, {
    state: textBranch.json.output.state,
    mixed_language: textBranch.json.branch_output.mixed_language,
    publish_safe_advisory: textBranch.json.branch_output.publish_safe_advisory,
  });

  const textRiskBranch = await api(base, "POST", "/v1/branches/ramo_testo/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      locale: "it",
      context: "page_copy",
      text: "The trattamento garantisce risultati clinically provati senza fonte.",
      public_text: true,
      mentions_study: true,
      sources_provided: false,
    },
  }, connectorKey);
  assert(textRiskBranch.status === 200 && textRiskBranch.json.branch_output?.mixed_language === true, "ramo testo mixed language not detected");
  assert(textRiskBranch.json.branch_output?.unsupported_proof === true, "ramo testo unsupported proof not detected");
  mark("branch_ramo_testo_risk_enhanced", true, {
    state: textRiskBranch.json.output.state,
    risk: textRiskBranch.json.output.risk.band,
    mixed_language: textRiskBranch.json.branch_output.mixed_language,
    unsupported_proof: textRiskBranch.json.branch_output.unsupported_proof,
  });

  const financeTestBranch = await api(base, "POST", "/v1/branches/nyra_finance_beauty_test/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      beauty_market_correlation: 62,
      volatility: 70,
      commercial_relevance: 48,
    },
  }, codexKey);
  assert(financeTestBranch.status === 200 && financeTestBranch.json.guardrail.mode === "test_only" && financeTestBranch.json.branch_output?.production_connected === false, "finance test branch failed");
  mark("branch_nyra_finance_test", true, {
    mode: financeTestBranch.json.guardrail.mode,
    production_connected: financeTestBranch.json.branch_output.production_connected,
  });

  const snapshotWrite = await api(base, "POST", "/v1/snapshot", {
    tenant_id: "tenant_demo_skinharmony",
    source: "suite",
    payload: { modules: ["crm", "pricing", "claim"], status: "pilot" },
  }, connectorKey);
  assert(snapshotWrite.status === 201, "snapshot write failed");
  const snapshotRead = await api(base, "GET", "/v1/snapshot?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(snapshotRead.status === 200 && snapshotRead.json.snapshot?.payload?.status === "pilot", "snapshot read failed");
  mark("snapshot_roundtrip", true, { snapshot_id: snapshotRead.json.snapshot.snapshot_id });

  const claim = await api(base, "POST", "/v1/claim-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    text: "Questo trattamento garantisce guarigione definitiva.",
  }, connectorKey);
  assert(claim.status === 200 && claim.json.result.status === "critical", "claim check failed");
  mark("claim_guard", true, claim.json.result);

  const pricingUnknown = await api(base, "POST", "/v1/pricing-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    observed_prices: [{ sku: "skin-pro", price: 10 }],
  }, connectorKey);
  assert(pricingUnknown.status === 200 && pricingUnknown.json.result.status === "unknown", "pricing unknown failed");
  const pricing = await api(base, "POST", "/v1/pricing-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    official_prices: [{ sku: "skin-pro", price: 1790 }],
    observed_prices: [{ sku: "skin-pro", price: 1500 }],
  }, connectorKey);
  assert(pricing.status === 200 && pricing.json.result.status === "warning", "pricing warning failed");
  mark("pricing_guard", true, { unknown: pricingUnknown.json.result.status, aligned: pricing.json.result.status, issues: pricing.json.result.issue_count });

  const pulse = await api(base, "GET", "/v1/ecosystem-pulse?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(pulse.status === 200 && pulse.json.pulse?.mode === "read_only_command_center", "ecosystem pulse failed");
  mark("ecosystem_pulse", true, {
    risk_status: pulse.json.pulse.score.risk_status,
    guardrail_events_24h: pulse.json.pulse.guardrails.guardrail_events_24h,
  });

  const calibrationStatus = await api(base, "GET", "/v1/calibration/status?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(calibrationStatus.status === 200 && calibrationStatus.json.calibration?.live_mutation_enabled === false, "calibration status failed");
  const calibration = await api(base, "POST", "/v1/calibration/evaluate", {
    tenant_id: "tenant_demo_skinharmony",
    variants: [
      { id: "baseline", accuracy: 72, coverage: 80, risk: 25 },
      { id: "safer_guardrail", accuracy: 84, coverage: 86, risk: 18 },
    ],
  }, connectorKey);
  assert(calibration.status === 200 && calibration.json.result.selected_variant?.id === "safer_guardrail", "calibration evaluate failed");
  mark("calibration_advisory", true, {
    selected_variant: calibration.json.result.selected_variant.id,
    live_mutation_enabled: calibration.json.result.live_mutation_enabled,
  });

  const claimShieldStatus = await api(base, "GET", "/v1/compliance/claim-shield/status?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(claimShieldStatus.status === 200 && claimShieldStatus.json.claim_shield?.legal_guarantee === false, "claim shield status failed");
  const claimShield = await api(base, "POST", "/v1/compliance/claim-shield/check", {
    tenant_id: "tenant_demo_skinharmony",
    text: "Protocollo medicale con risultato garantito.",
    context: { medical_context: true },
  }, connectorKey);
  assert(claimShield.status === 200 && claimShield.json.result.shield_status === "critical_review", "claim shield check failed");
  mark("claim_shield", true, {
    shield_status: claimShield.json.result.shield_status,
    legal_guarantee: claimShield.json.result.legal_guarantee,
  });

  const revoke = await api(base, "POST", "/v1/keys/revoke", { key_id: generated.json.record.key_id });
  assert(revoke.status === 200 && revoke.json.key.status === "revoked", "revoke failed");
  const revokeCodex = await api(base, "POST", "/v1/keys/revoke", { key_id: codexGenerated.json.record.key_id });
  assert(revokeCodex.status === 200 && revokeCodex.json.key.status === "revoked", "codex revoke failed");
  const revokeCodexGeneric = await api(base, "POST", "/v1/keys/revoke", { key_id: codexGenericGenerated.json.record.key_id });
  assert(revokeCodexGeneric.status === 200 && revokeCodexGeneric.json.key.status === "revoked", "codex generic revoke failed");
  const revokeRegulated = await api(base, "POST", "/v1/keys/revoke", { key_id: regulatedGenerated.json.record.key_id });
  assert(revokeRegulated.status === 200 && revokeRegulated.json.key.status === "revoked", "regulated codex revoke failed");
  const denied = await api(base, "GET", "/v1/tenant/status", undefined, connectorKey);
  assert(denied.status === 401, "revoked key still works");
  mark("key_revoke", true, { denied_status: denied.status, error: denied.json.error });

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    storage_root: storageRoot,
    results,
  };
  fs.writeFileSync(path.join(reportDir, "core_service_smoke_latest.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    ok: false,
    generated_at: new Date().toISOString(),
    error: error.message,
    results,
  };
  fs.writeFileSync(path.join(reportDir, "core_service_smoke_latest.json"), JSON.stringify(report, null, 2), "utf8");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await close();
}

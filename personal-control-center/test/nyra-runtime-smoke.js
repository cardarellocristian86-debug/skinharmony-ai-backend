"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");

const repoRoot = path.resolve(__dirname, "../..");
const nyraPort = 33000 + Math.floor(Math.random() * 1000);
const corePort = nyraPort + 1;
const smartDeskPort = nyraPort + 2;
const researchMcpPort = nyraPort + 3;
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-nyra-runtime-")).replace(/\\/g, "/");
const auth = `Basic ${Buffer.from("test-user:test-password").toString("base64")}`;
const foreignJourneyPath = path.join(storageRoot, "universal-core/runtime/nyra/nyra_decision_to_value_journey.json");
fs.mkdirSync(path.dirname(foreignJourneyPath), { recursive: true });
fs.writeFileSync(foreignJourneyPath, JSON.stringify({
  version: 1,
  events: [{
    event_id: "foreign-event",
    tenant_id: "tenant-foreign",
    center_id: "center_admin",
    profile_id: "p_00000000000000000000000000000000",
    stage: "analyzer",
    source: "foreign-source",
    value: {},
  }],
  profiles: {
    foreign: {
      tenant_id: "tenant-foreign",
      center_id: "center_admin",
      profile_id: "p_00000000000000000000000000000000",
      stages: {},
    },
  },
}), "utf8");

function jsonResponse(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const coreServer = http.createServer((req, res) => {
  if (req.url.startsWith("/v1/tenant/status")) {
    const requestedTenant = new URL(req.url, "http://core.test").searchParams.get("tenant_id") || "tenant-test";
    const suiteRequest = req.headers.authorization === "Bearer suite-core-key";
    assert.equal(req.headers.authorization, suiteRequest ? "Bearer suite-core-key" : "Bearer core-test-key");
    jsonResponse(res, 200, {
      ok: true,
      tenant_id: suiteRequest ? "tenant-suite" : requestedTenant,
      status: "active",
      mode: "render_first_cortex_ready",
      service: "universal-core-test",
      version: "test-core",
      key_type: "connector",
      tier: suiteRequest ? "enterprise" : "internal",
      allowed_scopes: ["read:decision", "policy:check"],
      active_branches: ["executive_gold", "customer_360_guard"],
    });
    return;
  }
  if (req.url.startsWith("/v1/customer-intelligence/contract")) {
    assert.equal(req.headers.authorization, "Bearer suite-core-key");
    jsonResponse(res, 200, {
      ok: true,
      contract: {
        schema_version: "customer_intelligence_contract_v1",
        tenant_id: "tenant-suite",
        automation_limits: { automatic_send_allowed: false },
      },
    });
    return;
  }
  if (req.url === "/v1/action-evaluator" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      const suiteRequest = req.headers.authorization === "Bearer suite-core-key";
      assert.equal(req.headers.authorization, suiteRequest ? "Bearer suite-core-key" : "Bearer core-test-key");
      assert.equal(req.headers["x-sh-tenant-id"], suiteRequest ? "tenant-suite" : "tenant-test");
      assert.equal(payload.domain, "decision_to_value");
      jsonResponse(res, 200, {
        ok: true,
        decision_contract: {
          contract_version: "core_decision_contract_v1",
          state: "attention",
          confidence: 62,
          risk_band: "medium",
          control_level: "confirm",
          publish_safe: false,
          recommended_actions: [{ id: "micro_step", label: "Completa consenso", control_level: "confirm" }],
          blocked_reasons: [],
          source: "universal_core",
        },
        output: { risk: { band: "medium", score: 55 } },
        evidence: { evidence_id: "ev_test_preview" },
      });
    });
    return;
  }
  if (req.url === "/v1/nira/core-bridge" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      assert.equal(req.headers.authorization, "Bearer core-test-key");
      assert.equal(Array.isArray(payload.nyra_branches), true);
      assert(payload.nyra_branches.includes("execution_planning"));
      jsonResponse(res, 200, {
        ok: true,
        tenant_id: "tenant-test",
        domain_pack: { id: "skinharmony", runtime_kind: "horizontal" },
        work_preflight: {
          schema_version: "skinharmony_work_preflight_v1",
          preflight_id: "preflight-smoke",
          mandatory: true,
          state: "memory_recall_required",
          governance: { execution_allowed_by_preflight: false },
        },
        result: {
          nyra_neural_network: {
            opened_by: "universal_core",
            opened_branches: payload.nyra_branches.map((id) => ({ id, status: "opened", subbranches: [] })),
            denied_branches: [],
            execution_authorized: false,
          },
          automation_plan: { execution_allowed: false },
        },
      });
    });
    return;
  }
  jsonResponse(res, 404, { ok: false, error: "not_found" });
});

const smartDeskServer = http.createServer((req, res) => {
  assert.equal(req.headers["x-skinharmony-bridge-key"], "smartdesk-test-key");
  if (req.url === "/api/health") {
    jsonResponse(res, 200, { ok: true, service: "smartdesk-test", bridge: { scopes: ["stats"] } });
    return;
  }
  if (req.url === "/api/bridge/nyra-snapshot") {
    jsonResponse(res, 200, {
      ok: true,
      source: "smartdesk_live_bridge",
      counts: { clients: 1, appointments: 1, sales: 0, payments: 1, inventoryItems: 1 },
      data_quality: { score: 0.8, state: "alto", status: "buono", metrics: {} },
      sales: [],
      payments: [{ payment_id: "payment-smoke", client_id: "client-smoke", appointment_id: "appointment-smoke", amount: 120, cost: 35, cost_source: "smoke_profitability", currency: "EUR", occurred_at: "2026-07-11T10:00:00Z" }],
      inventory: [{ product_id: "product-smoke", sku: "SMOKE-1", quantity: 4, min_quantity: 1, cost: 35, sale_price: 120 }],
      journey_events: [{
        stage: "commerce",
        event_type: "payment_recorded",
        status: "ready",
        source: "smartdesk_payment",
        external_event_id: "payment:payment-smoke",
        profile_external_id: "client-smoke",
        occurred_at: "2026-07-11T10:00:00Z",
        value: { currency: "EUR", amount: 120, cost: 35 },
        metadata: { payment_id: "payment-smoke", appointment_id: "appointment-smoke" },
      }],
    });
    return;
  }
  jsonResponse(res, 404, { ok: false, error: "not_found" });
});

const researchMcpServer = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    jsonResponse(res, 200, {
      ok: true,
      service: "skinharmony-core-mcp",
      version: "0.6.0-full-intelligence-research-cortex",
      research_cortex_configured: true,
      openai_research_fallback_enabled: false,
      openai_research_fallback_configured: true,
    });
    return;
  }
  jsonResponse(res, 404, { ok: false, error: "not_found" });
});

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port: nyraPort,
      path: pathname,
      method: options.method || "GET",
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.auth ? { authorization: auth } : {}),
        ...(options.headers || {}),
      },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        let json = {};
        try { json = body ? JSON.parse(body) : {}; } catch { json = { raw: body }; }
        resolve({ status: res.statusCode, json, bodyBytes: Buffer.byteLength(body) });
      });
    });
    request.on("error", reject);
    if (options.body) request.write(JSON.stringify(options.body));
    request.end();
  });
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1)
  );
  return sorted[index] || 0;
}

async function authenticatedBurst(pathname, {
  requests = 40,
  concurrency = 16,
  responseBudgetBytes = 100 * 1024,
  p95BudgetMs = 1000,
  maxBudgetMs = 2000,
} = {}) {
  const latencies = [];
  const responseBytes = [];
  const statuses = {};
  let cursor = 0;
  const started = performance.now();
  const worker = async () => {
    while (cursor < requests) {
      const index = cursor;
      cursor += 1;
      const requestStarted = performance.now();
      const result = await request(pathname, { auth: true });
      latencies[index] = performance.now() - requestStarted;
      responseBytes[index] = result.bodyBytes;
      statuses[result.status] = (statuses[result.status] || 0) + 1;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, requests) }, () => worker())
  );
  const latency = {
    p50_ms: Number(percentile(latencies, 0.5).toFixed(3)),
    p95_ms: Number(percentile(latencies, 0.95).toFixed(3)),
    max_ms: Number(Math.max(...latencies).toFixed(3)),
  };
  const bytes = {
    p50: percentile(responseBytes, 0.5),
    p95: percentile(responseBytes, 0.95),
    max: Math.max(...responseBytes),
  };
  const budgets = {
    response_max_bytes: responseBudgetBytes,
    latency_p95_max_ms: p95BudgetMs,
    latency_max_ms: maxBudgetMs,
    required_status: 200,
    required_requests: requests,
    minimum_concurrency: 16,
  };
  const checks = {
    request_count: latencies.length === requests,
    concurrency: concurrency >= budgets.minimum_concurrency,
    statuses: Object.keys(statuses).length === 1 && statuses[200] === requests,
    response_size: bytes.max < responseBudgetBytes,
    latency_p95: latency.p95_ms < p95BudgetMs,
    latency_max: latency.max_ms < maxBudgetMs,
  };
  return {
    path: pathname,
    authenticated: true,
    requests,
    concurrency,
    elapsed_ms: Number((performance.now() - started).toFixed(3)),
    statuses,
    latency,
    response_bytes: bytes,
    budgets,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

function waitForHealth(child) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const timer = setInterval(async () => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error("Nyra test server health timeout"));
        return;
      }
      try {
        const result = await request("/healthz");
        if (result.status === 200 && result.json.ok) {
          clearInterval(timer);
          resolve(result);
        }
      } catch {
        if (child.exitCode !== null) {
          clearInterval(timer);
          reject(new Error(`Nyra exited with ${child.exitCode}`));
        }
      }
    }, 100);
  });
}

async function main() {
  await new Promise((resolve) => coreServer.listen(corePort, "127.0.0.1", resolve));
  await new Promise((resolve) => smartDeskServer.listen(smartDeskPort, "127.0.0.1", resolve));
  await new Promise((resolve) => researchMcpServer.listen(researchMcpPort, "127.0.0.1", resolve));
  const child = spawn(process.execPath, ["--max-old-space-size=256", "personal-control-center/server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(nyraPort),
      HOST: "127.0.0.1",
      NYRA_STORAGE_ROOT: storageRoot,
      NYRA_BASIC_USER: "test-user",
      NYRA_BASIC_PASSWORD: "test-password",
      NYRA_ENABLE_BASIC_AUTH: "true",
      NYRA_DISABLE_BASIC_AUTH: "false",
      NYRA_RATE_LIMIT_PER_MINUTE: "240",
      NYRA_CORE_URL: `http://127.0.0.1:${corePort}`,
      NYRA_CORE_KEY: "core-test-key",
      NYRA_CORE_TENANT_ID: "tenant-test",
      NYRA_DEEP_BRANCH_V2_ENABLED: "true",
      NYRA_DEEP_BRANCH_V2_MODE: "shadow",
      NYRA_DEEP_BRANCH_V2_BRANCHES: "context_intelligence,work_intake,risk_governance,execution_planning",
      NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: "tenant-test",
      NYRA_RESEARCH_MCP_URL: `http://127.0.0.1:${researchMcpPort}`,
      NYRA_SUITE_CORE_URL: `http://127.0.0.1:${corePort}`,
      NYRA_SUITE_CORE_KEY: "suite-core-key",
      NYRA_SUITE_CORE_TENANT_ID: "tenant-suite",
      NYRA_SUITE_BRIDGE_KEY: "suite-bridge-key",
      SMARTDESK_URL: `http://127.0.0.1:${smartDeskPort}`,
      SMARTDESK_BRIDGE_API_KEY: "smartdesk-test-key",
      NYRA_WORLD_PAPER_AUTOSTART: "false",
      NYRA_FINANCE_LIVE_AUTOSTART: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    const health = await waitForHealth(child);
    assert.equal(health.json.version, "0.9.0-research-cortex");
    assert.equal(health.json.service, "nyra-horizontal-runtime");
    assert.equal(health.json.runtime_kind, "horizontal_neural_branch_runtime");

    const unauthenticated = await request("/api/nyra/control");
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.json.error, "nyra_auth_required");

    const control = await request("/api/nyra/control", { auth: true });
    assert.equal(control.status, 200);

    const readiness = await request("/api/nyra/runtime/readiness", { auth: true });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.json.ok, true);
    assert.equal(readiness.json.core.status, "connected");
    assert.equal(readiness.json.storage.persistent, true);
    assert.equal(readiness.json.journey.event_count, 0);
    assert.equal(readiness.json.journey.profile_count, 0);
    assert.equal(readiness.json.journey.tenant_id, "tenant-test");
    assert.equal(readiness.json.research.status, "connected");
    assert.equal(readiness.json.research.primary_provider, "host_chatgpt_or_codex_web");
    assert.equal(readiness.json.research.openai_fallback_enabled, false);
    assert.equal(readiness.json.research.openai_fallback_configured, true);
    assert.equal(readiness.json.runtime.authority.core_is_final_router, true);

    const runtimeContract = await request("/api/nyra/runtime/contract", { auth: true });
    assert.equal(runtimeContract.status, 200);
    assert.equal(runtimeContract.json.contract.neural_network.maximum_subbranches_per_branch, 20);
    assert.equal(runtimeContract.json.contract.neural_network.maximum_parallel_branches, 6);
    assert.equal(runtimeContract.json.contract.governed_learning.policy_activation_requires_verify, true);
    assert.equal(runtimeContract.json.contract.realtime_research.mcp_entrypoint, "nyra_research_plan");
    assert.equal(runtimeContract.json.contract.authority.may_open_branches, false);
    assert.equal(runtimeContract.json.contract.authority.may_begin_work_without_preflight, false);
    assert.equal(runtimeContract.json.contract.mandatory_preflight.connected_tool_first, true);

    const deepValidation = await request("/api/nyra/runtime/v2/validation", { auth: true });
    assert.equal(deepValidation.status, 200);
    assert(deepValidation.bodyBytes < 100 * 1024);
    assert.equal(deepValidation.json.ok, true);
    assert.equal(deepValidation.json.validation.metrics.branch_count, 18);
    assert.equal(deepValidation.json.validation.metrics.node_count, 1434);
    assert.equal(deepValidation.json.execution_allowed, false);
    assert.equal(deepValidation.json.core_final_authority, true);
    assert.equal(Object.hasOwn(deepValidation.json, "catalog"), false);

    const deepCatalogSummary = await request("/api/nyra/runtime/v2/catalog", { auth: true });
    assert.equal(deepCatalogSummary.status, 200);
    assert(deepCatalogSummary.bodyBytes < 100 * 1024);
    assert.equal(deepCatalogSummary.json.ok, true);
    assert.equal(deepCatalogSummary.json.execution_allowed, false);
    assert.equal(deepCatalogSummary.json.core_final_authority, true);
    assert.equal(Object.hasOwn(deepCatalogSummary.json.catalog, "nodes"), false);
    assert.equal(Object.hasOwn(deepCatalogSummary.json.catalog.function_registry, "functions"), false);
    assert.equal(deepCatalogSummary.json.catalog.function_registry.function_count, 1434);
    assert.equal(deepCatalogSummary.json.catalog.runtime_manifest.shard_count, 239);
    assert.equal(
      deepCatalogSummary.json.catalog.runtime_manifest.audit_artifact_runtime_read_allowed,
      false
    );
    assert.equal(deepCatalogSummary.json.validation.metrics.branch_count, 18);
    assert.equal(deepCatalogSummary.json.validation.metrics.node_count, 1434);

    const validationBurst = await authenticatedBurst("/api/nyra/runtime/v2/validation");
    const catalogBurst = await authenticatedBurst("/api/nyra/runtime/v2/catalog");
    assert.equal(validationBurst.passed, true, JSON.stringify(validationBurst));
    assert.equal(catalogBurst.passed, true, JSON.stringify(catalogBurst));

    const runtimeInterpretation = await request("/api/nyra/runtime/interpret", {
      method: "POST",
      auth: true,
      body: { message: "Valuta privacy e prepara un piano di deploy su Render", session_id: "horizontal-smoke" },
    });
    assert.equal(runtimeInterpretation.status, 200);
    assert.equal(runtimeInterpretation.json.local_interpretation.branch_state, "proposed_waiting_for_core");
    assert.equal(runtimeInterpretation.json.core_router.result.nyra_neural_network.opened_by, "universal_core");
    assert.equal(runtimeInterpretation.json.core_router.work_preflight.mandatory, true);
    assert.equal(runtimeInterpretation.json.deep_branch_v2.state, "shadow_v1_authoritative");
    assert(runtimeInterpretation.json.deep_branch_v2.selected_branches.some((branch) => branch.id === "execution_planning"));
    assert.equal(runtimeInterpretation.json.deep_branch_v2.execution_authorized, false);
    assert.equal(runtimeInterpretation.json.deep_branch_v2.core_final_authority, true);
    assert.equal(runtimeInterpretation.json.execution_allowed, false);

    const learningBefore = await request("/api/nyra/text-learning/status", { auth: true });
    assert.equal(learningBefore.status, 200);
    assert.equal(learningBefore.json.learning_rules, 0);

    const chat = await request("/api/nyra/text-chat", {
      method: "POST",
      auth: true,
      body: { message: ":teach rispondi con una priorita e una prossima mossa", sessionId: "smoke-session" },
    });
    assert.equal(chat.status, 200);
    assert.equal(chat.json.ok, true);

    const feedback = await request("/api/nyra/text-feedback", {
      method: "POST",
      auth: true,
      body: { feedback: "teach", correction: "chiudi sempre con una verifica", sessionId: "smoke-session" },
    });
    assert.equal(feedback.status, 200);
    assert.equal(feedback.json.learning.learning_rules >= 2, true);

    const learningAfter = await request("/api/nyra/text-learning/status", { auth: true });
    assert.equal(learningAfter.json.learning_rules >= 2, true);
    assert.equal(learningAfter.json.persistent, true);

    const coreStatus = await request("/api/nyra/core/status", { auth: true });
    assert.equal(coreStatus.status, 200);
    assert.equal(coreStatus.json.core.reachable, true);

    const suiteUnauthenticated = await request("/api/nyra/suite/core/status");
    assert.equal(suiteUnauthenticated.status, 401);

    const suiteCoreStatus = await request("/api/nyra/suite/core/status", {
      headers: { "x-nyra-suite-key": "suite-bridge-key" },
    });
    assert.equal(suiteCoreStatus.status, 200);
    assert.equal(suiteCoreStatus.json.tenant_id, "tenant-suite");
    assert.equal(suiteCoreStatus.json.core.tier, "enterprise");

    const suiteContract = await request("/api/nyra/suite/customer-intelligence/contract", {
      headers: { "x-nyra-suite-key": "suite-bridge-key" },
    });
    assert.equal(suiteContract.status, 200);
    assert.equal(suiteContract.json.tenant_id, "tenant-suite");

    const suitePreview = await request("/api/nyra/suite/decision-preview", {
      method: "POST",
      headers: { "x-nyra-suite-key": "suite-bridge-key" },
      body: { current_state: "analysis", next_action: "suite_read_only_review" },
    });
    assert.equal(suitePreview.status, 200);
    assert.equal(suitePreview.json.tenant_id, "tenant-suite");
    assert.equal(suitePreview.json.execution_allowed, false);

    const smartDeskSync = await request("/api/sync/smartdesk", { method: "POST", auth: true, body: {} });
    assert.equal(smartDeskSync.status, 200);
    assert.equal(smartDeskSync.json.snapshot.bridge.connected, true);
    assert.equal(smartDeskSync.json.snapshot.bridge.journeyIngest.recorded, 1);
    assert.equal(smartDeskSync.json.snapshot.sales, 0);

    const syncedOverview = await request("/api/overview", { auth: true });
    assert.equal(syncedOverview.status, 200);
    assert.equal(syncedOverview.json.economics.sales.length, 1);
    assert.equal(syncedOverview.json.economics.totalRevenue, 120);
    assert.equal(syncedOverview.json.economics.totalMargin, 85);

    const syncedJourneyReport = await request("/api/nyra/decision-to-value/report", { auth: true });
    assert.equal(syncedJourneyReport.status, 200);
    assert.equal(syncedJourneyReport.json.report.event_count, 1);
    assert.equal(syncedJourneyReport.json.report.profile_count, 1);

    const journeyPreview = await request("/api/nyra/decision-to-value/events", {
      method: "POST",
      auth: true,
      body: {
        mode: "preview",
        lead_id: "journey-smoke-lead",
        stage: "analyzer",
        event_type: "analysis_completed",
        status: "completed",
        source: "smoke_analyzer",
        external_event_id: "journey-smoke-analyzer-1",
        evidence: [{ id: "evidence-smoke", type: "analysis", source: "smoke" }],
      },
    });
    assert.equal(journeyPreview.status, 200);
    assert.equal(journeyPreview.json.event_recorded, false);
    assert.equal(journeyPreview.json.execution_allowed, false);

    const journeyCommit = await request("/api/nyra/decision-to-value/events", {
      method: "POST",
      auth: true,
      body: {
        mode: "commit",
        confirm: true,
        lead_id: "journey-smoke-lead",
        stage: "analyzer",
        event_type: "analysis_completed",
        status: "completed",
        source: "smoke_analyzer",
        external_event_id: "journey-smoke-analyzer-1",
        evidence: [{ id: "evidence-smoke", type: "analysis", source: "smoke" }],
      },
    });
    assert.equal(journeyCommit.status, 200);
    assert.equal(journeyCommit.json.event_recorded, true);
    assert.equal(journeyCommit.json.execution_allowed, false);
    assert.equal(journeyCommit.json.profile.ready_count, 1);

    const journeyDuplicate = await request("/api/nyra/decision-to-value/events", {
      method: "POST",
      auth: true,
      body: {
        mode: "commit",
        confirm: true,
        lead_id: "journey-smoke-lead",
        stage: "analyzer",
        event_type: "analysis_completed",
        status: "completed",
        source: "smoke_analyzer",
        external_event_id: "journey-smoke-analyzer-1",
      },
    });
    assert.equal(journeyDuplicate.status, 200);
    assert.equal(journeyDuplicate.json.duplicate, true);
    assert.equal(journeyDuplicate.json.event_recorded, false);

    const journeyStatus = await request(`/api/nyra/decision-to-value/status?profile_id=${encodeURIComponent(journeyCommit.json.profile.profile_id)}`, { auth: true });
    assert.equal(journeyStatus.status, 200);
    assert.equal(journeyStatus.json.status.profile_id, journeyCommit.json.profile.profile_id);
    assert.equal(journeyStatus.json.status.stages.find((stage) => stage.id === "analyzer").status, "ready");

    const journeyReport = await request("/api/nyra/decision-to-value/report", { auth: true });
    assert.equal(journeyReport.status, 200);
    assert.equal(journeyReport.json.report.event_count, 2);
    assert.equal(journeyReport.json.report.profile_count, 2);

    const preview = await request("/api/nyra/decision-to-value/preview", {
      method: "POST",
      auth: true,
      body: {
        analyzer_ready: true,
        consent_status: "missing",
        protocol_ready: true,
        stage_status: { booking: "ready", treatment: "missing", commerce: "missing", retention: "missing" },
      },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.execution_allowed, false);
    assert.equal(preview.json.core.decision_contract.control_level, "confirm");
    assert(preview.json.readiness.missing.includes("consent"));
    assert.equal(preview.json.nyra.value_loop.length, 7);

    const smokeReport = {
      schema_version: "nyra_deep_branch_v2_http_concurrency_benchmark_v1",
      generated_at: new Date().toISOString(),
      ok: true,
      harness: {
        server_exec_argv: ["--max-old-space-size=256", "personal-control-center/server.js"],
        platform: process.platform,
        arch: process.arch,
        node: process.version,
      },
      checks: [
        "health",
        "auth_fail_closed",
        "authenticated_control",
        "runtime_readiness",
        "deep_branch_v2_catalog_validation",
        "deep_branch_v2_authenticated_validation_burst",
        "deep_branch_v2_authenticated_catalog_burst",
        "deep_branch_v2_shadow_core_route",
        "persistent_learning_path",
        "feedback_endpoint",
        "core_status_bridge",
        "suite_tenant_scoped_core_bridge",
        "smartdesk_bridge_sync",
        "decision_journey_preview_commit_idempotency",
        "decision_journey_report",
        "decision_to_value_preview",
      ],
      learning_rules: learningAfter.json.learning_rules,
      missing_preview_stages: preview.json.readiness.missing,
      bounded_payload_bytes: {
        deep_validation: deepValidation.bodyBytes,
        deep_catalog_summary: deepCatalogSummary.bodyBytes,
        deep_interpretation: runtimeInterpretation.bodyBytes,
      },
      authenticated_bursts: {
        validation: validationBurst,
        catalog: catalogBurst,
      },
      budgets: {
        validation_response_max_bytes: 100 * 1024,
        catalog_response_max_bytes: 100 * 1024,
        interpretation_response_max_bytes: 1024 * 1024,
        minimum_concurrency: 16,
        requests_per_endpoint: 40,
      },
      passed: validationBurst.passed
        && catalogBurst.passed
        && deepValidation.bodyBytes < 100 * 1024
        && deepCatalogSummary.bodyBytes < 100 * 1024
        && runtimeInterpretation.bodyBytes < 1024 * 1024,
    };
    const reportPath = String(process.env.NYRA_DEEP_V2_SMOKE_REPORT_PATH || "").trim();
    if (reportPath) {
      fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
      fs.writeFileSync(
        path.resolve(reportPath),
        `${JSON.stringify(smokeReport, null, 2)}\n`,
        "utf8"
      );
    }
    console.log(JSON.stringify(smokeReport, null, 2));
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    await new Promise((resolve) => coreServer.close(resolve));
    await new Promise((resolve) => smartDeskServer.close(resolve));
    await new Promise((resolve) => researchMcpServer.close(resolve));
    if (stdout.trim()) process.stdout.write(stdout);
    if (stderr.trim()) process.stderr.write(stderr);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  coreServer.close();
  researchMcpServer.close();
  process.exit(1);
});

"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "../..");
const nyraPort = 33000 + Math.floor(Math.random() * 1000);
const corePort = nyraPort + 1;
const smartDeskPort = nyraPort + 2;
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-nyra-runtime-")).replace(/\\/g, "/");
const auth = `Basic ${Buffer.from("test-user:test-password").toString("base64")}`;

function jsonResponse(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const coreServer = http.createServer((req, res) => {
  if (req.url.startsWith("/v1/tenant/status")) {
    jsonResponse(res, 200, {
      ok: true,
      tenant_id: "tenant-test",
      status: "active",
      mode: "render_first_cortex_ready",
      service: "universal-core-test",
      version: "test-core",
      active_branches: ["executive_gold", "customer_360_guard"],
    });
    return;
  }
  if (req.url === "/v1/action-evaluator" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      assert.equal(req.headers.authorization, "Bearer core-test-key");
      assert.equal(req.headers["x-sh-tenant-id"], "tenant-test");
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
      counts: { clients: 1, appointments: 1, sales: 1, inventoryItems: 1 },
      data_quality: { score: 0.8, state: "alto", status: "buono", metrics: {} },
      sales: [{ sale_id: "sale-smoke", client_id: "client-smoke", product_id: "product-smoke", amount: 120, cost: 35, currency: "EUR", occurred_at: "2026-07-11T10:00:00Z" }],
      inventory: [{ product_id: "product-smoke", sku: "SMOKE-1", quantity: 4, min_quantity: 1, cost: 35, sale_price: 120 }],
      journey_events: [{
        stage: "commerce",
        event_type: "sale_recorded",
        status: "ready",
        source: "smartdesk",
        external_event_id: "sale:sale-smoke",
        profile_external_id: "client-smoke",
        occurred_at: "2026-07-11T10:00:00Z",
        value: { currency: "EUR", amount: 120, cost: 35 },
        metadata: { sale_id: "sale-smoke", product_id: "product-smoke" },
      }],
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
      },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        let json = {};
        try { json = body ? JSON.parse(body) : {}; } catch { json = { raw: body }; }
        resolve({ status: res.statusCode, json });
      });
    });
    request.on("error", reject);
    if (options.body) request.write(JSON.stringify(options.body));
    request.end();
  });
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
  const child = spawn(process.execPath, ["personal-control-center/server.js"], {
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
    assert.equal(health.json.version, "0.5.0-decision-journey");

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

    const smartDeskSync = await request("/api/sync/smartdesk", { method: "POST", auth: true, body: {} });
    assert.equal(smartDeskSync.status, 200);
    assert.equal(smartDeskSync.json.snapshot.bridge.connected, true);
    assert.equal(smartDeskSync.json.snapshot.bridge.journeyIngest.recorded, 1);
    assert.equal(smartDeskSync.json.snapshot.sales, 1);

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

    console.log(JSON.stringify({
      ok: true,
      checks: [
        "health",
        "auth_fail_closed",
        "authenticated_control",
        "runtime_readiness",
        "persistent_learning_path",
        "feedback_endpoint",
        "core_status_bridge",
        "smartdesk_bridge_sync",
        "decision_journey_preview_commit_idempotency",
        "decision_journey_report",
        "decision_to_value_preview",
      ],
      learning_rules: learningAfter.json.learning_rules,
      missing_preview_stages: preview.json.readiness.missing,
    }, null, 2));
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
    if (stdout.trim()) process.stdout.write(stdout);
    if (stderr.trim()) process.stderr.write(stderr);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  coreServer.close();
  process.exit(1);
});

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
    assert.equal(health.json.version, "0.4.0-secure-decision-to-value");

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
    if (stdout.trim()) process.stdout.write(stdout);
    if (stderr.trim()) process.stderr.write(stderr);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  coreServer.close();
  process.exit(1);
});

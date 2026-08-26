"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

function waitForListening(server) {
  if (server?.listening && server.address()) return Promise.resolve(server);
  return new Promise((resolve, reject) => {
    const onListening = () => {
      cleanup();
      if (!server.address()) return reject(new Error("test_server_address_unavailable_after_listening"));
      resolve(server);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };
    server.once("listening", onListening);
    server.once("error", onError);
  });
}

function requestJson(server, { method = "GET", pathname = "/", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = process.hrtime.bigint();
    const payload = body === null ? null : JSON.stringify(body);
    const address = server.address();
    if (!server.listening || !address || typeof address === "string") {
      reject(new Error(`test_server_not_listening:${pathname}`));
      return;
    }
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      path: pathname,
      method,
      headers: {
        ...headers,
        ...(payload === null ? {} : {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        })
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          bytes,
          text: bytes.toString("utf8"),
          durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error(`test_http_timeout:${method}:${pathname}`)));
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function main() {
  const publicRoot = path.resolve(__dirname, "../public");
  const indexSource = fs.readFileSync(path.join(publicRoot, "index.html"), "utf8");
  const bridgeSource = fs.readFileSync(path.join(publicRoot, "assets/gold-bridge.js"), "utf8");
  const protocolViewSource = fs.readFileSync(path.join(publicRoot, "preview-shell/views/protocols.js"), "utf8");
  assert.ok(indexSource.indexOf('<script src="/assets/gold-bridge.js"></script>') < indexSource.indexOf('type="module"'), "overview bridge must install before the module bundle");
  assert.match(bridgeSource, /nativeFetch\("\/api\/ai-gold\/overview"/);
  assert.match(bridgeSource, /Core Silver - cosa controllare ora/);
  assert.match(bridgeSource, /La generazione AI dei protocolli è in standby e non espone quote/);
  assert.match(bridgeSource, /WordPress\/Suite/);
  assert.doesNotMatch(protocolViewSource, /quotaLabel/);
  assert.match(protocolViewSource, /aiProtocolStandby/);
  const serverSource = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  const overviewRouteSource = serverSource.slice(serverSource.indexOf('app.get("/api/ai-gold/overview"'), serverSource.indexOf('app.get("/api/ai-gold/capabilities"'));
  assert.doesNotMatch(overviewRouteSource, /error\.message/);

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "smartdesk-plan-overview-"));
  const envKeys = [
    "PORT", "SMARTDESK_DATA_DIR", "SMARTDESK_EXPORTS_DIR", "SMARTDESK_ADMIN_PASSWORD",
    "ENTERPRISE_CENTER_LIMIT",
    "TRIAL_SMTP_HOST", "TRIAL_SMTP_PORT", "TRIAL_MAIL_FROM", "TRIAL_SMTP_USER", "TRIAL_SMTP_PASS",
    "NEXI_PAYMENT_URL", "NEXI_CHECKOUT_URL"
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalCwd = process.cwd();
  let server;
  try {
    process.chdir(sandbox);
    process.env.PORT = "0";
    process.env.SMARTDESK_DATA_DIR = path.join(sandbox, "data");
    process.env.SMARTDESK_EXPORTS_DIR = path.join(sandbox, "exports");
    process.env.SMARTDESK_ADMIN_PASSWORD = "SmartDesk-Plan-Test-Password-2026";
    process.env.ENTERPRISE_CENTER_LIMIT = "8";
    ["TRIAL_SMTP_HOST", "TRIAL_SMTP_PORT", "TRIAL_MAIL_FROM", "TRIAL_SMTP_USER", "TRIAL_SMTP_PASS", "NEXI_PAYMENT_URL", "NEXI_CHECKOUT_URL"]
      .forEach((key) => delete process.env[key]);

    const runtime = require("../server");
    server = await runtime.bootstrap();
    await waitForListening(server);

    const anonymous = await requestJson(server, { pathname: "/api/ai-gold/overview" });
    assert.equal(anonymous.status, 401);

    const trialConfig = await requestJson(server, { pathname: "/api/auth/trial-config" });
    assert.equal(trialConfig.status, 200);
    const trial = JSON.parse(trialConfig.text);
    assert.equal(trial.trialDays, 7);
    assert.equal(trial.trialPlan, "silver");
    assert.equal(trial.acquisitionAuthority, "wordpress_site_suite");
    assert.equal(trial.checkoutAuthority, "wordpress_woocommerce_nexi");
    assert.equal(trial.renderCapturesPayments, false);
    assert.equal(trial.payment.configured, false);
    assert.equal(trial.payment.checkoutAvailable, false);
    assert.equal(trial.payment.nextAction, "request_suite_assisted_activation");

    const trialRequest = await requestJson(server, {
      method: "POST",
      pathname: "/api/auth/request-trial",
      headers: { "Idempotency-Key": "plan-acceptance-trial-0001" },
      body: {
        centerName: "Plan Acceptance Center",
        ownerName: "Owner Test",
        email: "plan-acceptance@example.test",
        confirmEmail: "plan-acceptance@example.test",
        username: "plan_acceptance",
        password: "Plan-Acceptance-Password-2026",
        trialDays: 999,
        subscriptionPlan: "gold",
        planType: "active",
        trialStartsAt: "2000-01-01T00:00:00.000Z",
        trialEndsAt: "2099-01-01T00:00:00.000Z",
        emailConfirmed: true,
        privacyConsent: true,
        policyConsent: true
      }
    });
    assert.equal(trialRequest.status, 201, trialRequest.text);
    const created = JSON.parse(trialRequest.text);
    assert.equal(created.success, true);
    assert.equal(created.user.trialDays, 7);
    assert.equal(created.delivery.contract, "smartdesk_trial_delivery_v1");
    assert.equal(created.delivery.status, "created");
    assert.match(created.delivery.bindingDigest, /^[a-f0-9]{64}$/);
    const userId = created.user.id;
    const trialDurationDays = Math.round((Date.parse(created.user.trialEndsAt) - Date.parse(created.user.trialStartsAt)) / 86400000);
    assert.equal(trialDurationDays, 7, "public payload must not override the server-pinned trial duration");
    assert.equal(created.user.subscriptionPlan, "silver");
    assert.equal(created.user.planType, "trial");
    assert.notEqual(created.user.trialStartsAt, "2000-01-01T00:00:00.000Z");
    assert.notEqual(created.user.trialEndsAt, "2099-01-01T00:00:00.000Z");

    for (const [index, hostileTrialDays] of [0, -1, "NaN"].entries()) {
      const email = `plan-hostile-${index}@example.test`;
      const hostile = await requestJson(server, {
        method: "POST",
        pathname: "/api/auth/request-trial",
        headers: { "Idempotency-Key": `plan-hostile-trial-000${index}` },
        body: {
          centerName: `Hostile Trial ${index}`,
          ownerName: "Owner Test",
          email,
          confirmEmail: email,
          username: `plan_hostile_${index}`,
          password: "Plan-Acceptance-Password-2026",
          trialDays: hostileTrialDays,
          subscriptionPlan: "enterprise",
          planType: "active",
          trialStartsAt: "2000-01-01T00:00:00.000Z",
          trialEndsAt: "2099-01-01T00:00:00.000Z",
          emailConfirmed: true,
          privacyConsent: true,
          policyConsent: true
        }
      });
      assert.equal(hostile.status, 201, hostile.text);
      const hostileUser = JSON.parse(hostile.text).user;
      assert.equal(hostileUser.subscriptionPlan, "silver");
      assert.equal(hostileUser.planType, "trial");
      assert.equal(Math.round((Date.parse(hostileUser.trialEndsAt) - Date.parse(hostileUser.trialStartsAt)) / 86400000), 7);
    }

    const replay = await requestJson(server, {
      method: "POST",
      pathname: "/api/auth/request-trial",
      headers: { "Idempotency-Key": "plan-acceptance-trial-0001" },
      body: {
        centerName: "Plan Acceptance Center",
        ownerName: "Owner Test",
        email: "plan-acceptance@example.test",
        confirmEmail: "plan-acceptance@example.test",
        username: "plan_acceptance",
        password: "Plan-Acceptance-Password-2026",
        emailConfirmed: true,
        privacyConsent: true,
        policyConsent: true
      }
    });
    assert.equal(replay.status, 200, replay.text);
    const replayBody = JSON.parse(replay.text);
    assert.equal(replayBody.success, true);
    assert.equal(replayBody.delivery.status, "idempotent_replay");
    assert.equal(replayBody.delivery.bindingDigest, created.delivery.bindingDigest);

    const login = async () => {
      const response = await requestJson(server, {
        method: "POST",
        pathname: "/api/auth/login",
        body: { username: "plan_acceptance", password: "Plan-Acceptance-Password-2026" }
      });
      assert.equal(response.status, 200);
      return JSON.parse(response.text);
    };
    const authHeaders = (session) => ({ Authorization: `Bearer ${session.token}` });

    const silverSession = await login();
    assert.equal(silverSession.subscriptionPlan, "silver");
    const snapshotDataFiles = () => new Map(fs.readdirSync(process.env.SMARTDESK_DATA_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => [name, fs.readFileSync(path.join(process.env.SMARTDESK_DATA_DIR, name)).toString("base64")]));
    const beforeSilverOverview = snapshotDataFiles();
    const silver = await requestJson(server, { pathname: "/api/ai-gold/overview", headers: authHeaders(silverSession) });
    assert.equal(silver.status, 200);
    const silverPayload = JSON.parse(silver.text);
    assert.equal(silverPayload.currentPlan, "silver");
    assert.equal(silverPayload.silverCoreEnabled, true);
    assert.equal(silverPayload.goldEnabled, false);
    assert.equal(silverPayload.guardrails.readOnly, true);
    assert.equal(silverPayload.guardrails.automaticExecutionAllowed, false);
    assert.equal(silverPayload.provenance.authority, "smartdesk_local_deterministic");
    assert.equal(silverPayload.provenance.coreVerdict, false);
    assert.equal(silverPayload.transport.requestCount, 1);
    assert.equal(silverPayload.transport.lazyDetails, true);
    assert.ok(Number(silver.headers["x-smartdesk-event-seq"]) >= 1);
    assert.equal(Number(silver.headers["x-smartdesk-payload-bytes"]), silver.bytes.length);
    assert.ok(silver.bytes.length < 64 * 1024, `silver_overview_too_large:${silver.bytes.length}`);
    assert.ok(silver.durationMs < 1000, `silver_overview_too_slow:${silver.durationMs.toFixed(2)}`);
    assert.deepEqual(snapshotDataFiles(), beforeSilverOverview, "bounded overview GET must not write persisted tenant data");
    const silver304 = await requestJson(server, {
      pathname: "/api/ai-gold/overview",
      headers: { ...authHeaders(silverSession), "If-None-Match": silver.headers.etag }
    });
    assert.equal(silver304.status, 304);
    assert.equal(silver304.bytes.length, 0);

    const protocolAi = await requestJson(server, {
      method: "POST",
      pathname: "/api/ai-gold/protocols/draft",
      headers: authHeaders(silverSession),
      body: { clientId: "client-test" }
    });
    assert.equal(protocolAi.status, 423);
    assert.equal(JSON.parse(protocolAi.text).code, "protocol_ai_standby");
    const manualProtocols = await requestJson(server, { pathname: "/api/protocols", headers: authHeaders(silverSession) });
    assert.equal(manualProtocols.status, 200);

    const adminLogin = await requestJson(server, {
      method: "POST",
      pathname: "/api/auth/login",
      body: { username: "cristian", password: "SmartDesk-Plan-Test-Password-2026" }
    });
    assert.equal(adminLogin.status, 200);
    const admin = JSON.parse(adminLogin.text);
    const setPlan = async (subscriptionPlan) => {
      const response = await requestJson(server, {
        method: "POST",
        pathname: `/api/auth/users/${encodeURIComponent(userId)}/status`,
        headers: authHeaders(admin),
        body: { subscriptionPlan }
      });
      assert.equal(response.status, 200);
    };

    await setPlan("base");
    const baseSession = await login();
    assert.equal(baseSession.subscriptionPlan, "base");
    const base = await requestJson(server, { pathname: "/api/ai-gold/overview", headers: authHeaders(baseSession) });
    assert.equal(base.status, 403);
    assert.equal(JSON.parse(base.text).code, "plan_locked");

    await setPlan("gold");
    const goldSession = await login();
    assert.equal(goldSession.subscriptionPlan, "gold");
    const gold = await requestJson(server, { pathname: "/api/ai-gold/overview", headers: authHeaders(goldSession) });
    assert.equal(gold.status, 200);
    const goldPayload = JSON.parse(gold.text);
    assert.equal(goldPayload.currentPlan, "gold");
    assert.equal(goldPayload.goldEnabled, true);
    assert.equal(goldPayload.silverCoreEnabled, true);
    assert.equal(goldPayload.guardrails.readOnly, true);
    assert.equal(goldPayload.transport.requestCount, 1);
    assert.equal(Number(gold.headers["x-smartdesk-payload-bytes"]), gold.bytes.length);
    assert.ok(gold.bytes.length < 64 * 1024, `gold_overview_too_large:${gold.bytes.length}`);
    assert.ok(gold.durationMs < 1000, `gold_overview_too_slow:${gold.durationMs.toFixed(2)}`);

    console.log(JSON.stringify({
      ok: true,
      suite: "smartdesk_plan_overview_acceptance",
      measured: {
        silverDurationMs: Number(silver.durationMs.toFixed(2)),
        silverBytes: silver.bytes.length,
        goldDurationMs: Number(gold.durationMs.toFixed(2)),
        goldBytes: gold.bytes.length,
        silverEventSeq: Number(silver.headers["x-smartdesk-event-seq"])
      }
    }, null, 2));
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    process.chdir(originalCwd);
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});

"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

function request(server, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: server.address().port, path: pathname }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
  });
}

function requestJson(server, { method = "GET", pathname = "/", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1",
      port: server.address().port,
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
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "smartdesk-reality-closure-"));
  const originalCwd = process.cwd();
  const originalCommit = process.env.GIT_COMMIT;
  const originalFreeze = process.env.SMARTDESK_WRITE_FREEZE;
  const originalPort = process.env.PORT;
  const originalDataDir = process.env.SMARTDESK_DATA_DIR;
  const originalExportsDir = process.env.SMARTDESK_EXPORTS_DIR;
  const originalRender = process.env.RENDER;
  const originalAdminPassword = process.env.SMARTDESK_ADMIN_PASSWORD;
  process.env.SMARTDESK_DATA_DIR = path.join(sandbox, "data");
  process.env.SMARTDESK_EXPORTS_DIR = path.join(sandbox, "exports");
  process.env.SMARTDESK_ADMIN_PASSWORD = "SmartDesk-Test-Only-Password-2026";
  const trackedFixturePaths = ["protocols.json", "staff.json"].map((name) => path.join(__dirname, "..", "data", name));
  const trackedFixturesBefore = trackedFixturePaths.map((filePath) => fs.readFileSync(filePath));
  const serviceSourcePath = path.join(__dirname, "..", "src", "DesktopMirrorService.js");
  const serviceSource = fs.readFileSync(serviceSourcePath, "utf8");
  assert.doesNotMatch(serviceSource, /^Warning: truncated output/m);
  assert.doesNotMatch(serviceSource, /tokens truncated/);

  const { DesktopMirrorService } = require("../src/DesktopMirrorService");
  const requiredControlMethods = [
    "getControlRoomExecutive", "getControlRoomWorkGallery", "getControlRoomAgents",
    "getControlRoomBranches", "getControlRoomAudit", "getControlRoomDecisionLedger",
    "getControlRoomMemory", "getControlRoomConnectors", "getControlRoomGovernance"
  ];
  requiredControlMethods.forEach((method) => assert.equal(typeof DesktopMirrorService.prototype[method], "function"));

  const { AssistantService } = require("../src/AssistantService");
  const assistant = Object.create(AssistantService.prototype);
  const governedPayload = assistant.buildUniversalCoreDecisionPayload({}, {}, {}, {
    centerId: "center-a",
    username: "owner-a",
    token: "raw-session-secret"
  });
  assert.match(governedPayload._preflight_scope.session_id, /^[a-f0-9]{64}$/);
  assert.notEqual(governedPayload._preflight_scope.session_id, "raw-session-secret");

  const isolated = Object.create(DesktopMirrorService.prototype);
  isolated.usersRepository = { list: () => [{ id: "u-a", role: "owner", centerId: "center-a" }] };
  isolated.controlAuditRepository = { create: () => undefined };
  assert.throws(
    () => isolated.resolveControlTenantScope({ role: "owner", centerId: "center-a" }, "center-b"),
    (error) => error.code === "control_cross_tenant_denied"
  );

  const expectedCommit = "a".repeat(40);
  let server;
  try {
    process.chdir(sandbox);
    process.env.GIT_COMMIT = expectedCommit;
    process.env.SMARTDESK_WRITE_FREEZE = "true";
    process.env.PORT = "0";
    const runtime = require("../server");
    const twilioRequest = {
      headers: { host: "smartdesk.test" },
      protocol: "https",
      originalUrl: "/api/integrations/twilio/whatsapp-webhook",
      body: { From: "whatsapp:+390000000000", Body: "test" }
    };
    const twilioCanonical = `https://smartdesk.test${twilioRequest.originalUrl}BodytestFromwhatsapp:+390000000000`;
    const twilioSignature = crypto.createHmac("sha1", "twilio-test-secret").update(twilioCanonical).digest("base64");
    assert.equal(runtime.verifyTwilioWebhookRequest(twilioRequest, "").status, 503);
    assert.equal(runtime.verifyTwilioWebhookRequest(twilioRequest, "twilio-test-secret").status, 401);
    twilioRequest.headers["x-twilio-signature"] = twilioSignature;
    assert.equal(runtime.verifyTwilioWebhookRequest(twilioRequest, "twilio-test-secret").ok, true);
    server = await runtime.bootstrap();
    process.env.GIT_COMMIT = "unverifiable";
    const unverifiableHealth = await request(server, "/healthz");
    assert.equal(unverifiableHealth.status, 503);
    assert.equal(JSON.parse(unverifiableHealth.text).build.commit_verifiable, false);
    process.env.GIT_COMMIT = expectedCommit;
    process.env.RENDER = "true";
    const missingProductionDatabase = await request(server, "/healthz");
    assert.equal(missingProductionDatabase.status, 503);
    assert.equal(JSON.parse(missingProductionDatabase.text).persistence.configured, false);
    process.env.RENDER = "false";
    const health = await request(server, "/healthz");
    assert.equal(health.status, 200);
    assert.match(health.headers["content-type"] || "", /application\/json/);
    const payload = JSON.parse(health.text);
    assert.equal(payload.ok, true);
    assert.equal(payload.build.commit_sha, expectedCommit);
    assert.equal(payload.build.commit_verifiable, true);
    assert.equal(health.headers["cache-control"], "no-store");

    const protectedBridgeHealth = await request(server, "/api/health");
    assert.equal(protectedBridgeHealth.status, 401);
    assert.equal(JSON.parse(protectedBridgeHealth.text).code, "missing_bridge_key");

    process.env.SMARTDESK_WRITE_FREEZE = "false";
    const login = await requestJson(server, {
      method: "POST",
      pathname: "/api/auth/login",
      body: { username: "cristian", password: "SmartDesk-Test-Only-Password-2026" }
    });
    assert.equal(login.status, 200);
    const session = JSON.parse(login.text);
    assert.match(session.token || "", /\S+/);
    const createdClient = await requestJson(server, {
      method: "POST",
      pathname: "/api/clients",
      headers: { Authorization: `Bearer ${session.token}` },
      body: {
        firstName: "Reality",
        lastName: "Closure",
        phone: "+390000000001",
        marketingConsent: false
      }
    });
    assert.equal(createdClient.status, 201);
    const createdPayload = JSON.parse(createdClient.text);
    assert.match(createdPayload.id || "", /^client_/);
    assert.equal(createdPayload.firstName, "Reality");

    const isolatedDataDir = process.env.SMARTDESK_DATA_DIR;
    const snapshotDataFiles = () => new Map(fs.readdirSync(isolatedDataDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => [name, fs.readFileSync(path.join(isolatedDataDir, name))]));
    const beforeAssistantRead = snapshotDataFiles();
    const assistantRead = await requestJson(server, {
      method: "POST",
      pathname: "/api/assistant/chat",
      headers: { Authorization: `Bearer ${session.token}` },
      body: { message: "Come apro clienti?" }
    });
    assert.equal(assistantRead.status, 200);
    const afterAssistantRead = snapshotDataFiles();
    assert.deepEqual([...afterAssistantRead.keys()], [...beforeAssistantRead.keys()]);
    for (const [name, bytes] of beforeAssistantRead) {
      assert.deepEqual(afterAssistantRead.get(name), bytes, `assistant_read_mutated:${name}`);
    }
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    process.chdir(originalCwd);
    if (originalCommit === undefined) delete process.env.GIT_COMMIT;
    else process.env.GIT_COMMIT = originalCommit;
    if (originalFreeze === undefined) delete process.env.SMARTDESK_WRITE_FREEZE;
    else process.env.SMARTDESK_WRITE_FREEZE = originalFreeze;
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalDataDir === undefined) delete process.env.SMARTDESK_DATA_DIR;
    else process.env.SMARTDESK_DATA_DIR = originalDataDir;
    if (originalExportsDir === undefined) delete process.env.SMARTDESK_EXPORTS_DIR;
    else process.env.SMARTDESK_EXPORTS_DIR = originalExportsDir;
    if (originalRender === undefined) delete process.env.RENDER;
    else process.env.RENDER = originalRender;
    if (originalAdminPassword === undefined) delete process.env.SMARTDESK_ADMIN_PASSWORD;
    else process.env.SMARTDESK_ADMIN_PASSWORD = originalAdminPassword;
    trackedFixturePaths.forEach((filePath, index) => {
      assert.deepEqual(fs.readFileSync(filePath), trackedFixturesBefore[index]);
    });
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    ok: true,
    suite: "smartdesk_reality_closure",
    assertions: {
      mergeTruncationRemoved: true,
      controlRoomAndDurableRuntimeCombined: true,
      crossTenantControlDenied: true,
      rawSessionTokenNotUsedAsCoreScope: true,
      healthzIsJsonAndCommitVerifiable: true,
      unverifiableCommitCannotBeHealthy: true,
      productionDatabaseIsRequired: true,
      twilioWebhookFailsClosedAndVerifiesSignature: true,
      trackedFixturesRemainUnchanged: true,
      durableCrudReturnsResolvedEntity: true,
      assistantReadHasNoPersistenceSideEffects: true,
      bridgeHealthRemainsProtected: true,
      maintenanceFreezeDoesNotHideHealthz: true
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitHubStandingReleaseWorker } from "../src/server.js";

const GITHUB_KEYS = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SIGNER_KEYS = crypto.generateKeyPairSync("ed25519");
const TARGET_COMMIT = "a".repeat(40);
const DIGEST = "b".repeat(64);
const TOKEN = "test-only-opaque-signer-token-0123456789";
const KEY_ID = "generic-work-core-join-production-v1";
const SIGN_ROUTE = "/v1/generic-work-core-join/sign";

function baseEnv(root, overrides = {}) {
  return {
    PORT: "8792",
    GITHUB_STANDING_RELEASE_WORKER_ENABLED: "true",
    GITHUB_STANDING_RELEASE_WORKER_EMERGENCY_STOP: "false",
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: GITHUB_KEYS.privateKey.export({ type: "pkcs8", format: "pem" }),
    GITHUB_APP_TENANT_BINDINGS_JSON: JSON.stringify({
      schema_version: "github_app_tenant_bindings_v1",
      bindings: [{
        tenant_id: "codexai",
        installation_id: 123,
        repositories: ["cardarellocristian86-debug/skinharmony-ai-backend"],
      }],
    }),
    GITHUB_WORKER_LEDGER_ROOT: root,
    GITHUB_WORKER_LEDGER_SIGNING_SECRET: "test-only-ledger-signing-secret-0123456789",
    CORE_GITHUB_WORKER_EXECUTION_SIGNING_SECRET: "test-only-execution-signing-secret-0123456789",
    GENERIC_WORK_CORE_JOIN_SIGNER_SERVICE: "universal-core-service",
    GENERIC_WORK_CORE_JOIN_SIGNER_PURPOSE: "generic_work_core_join_v1",
    GENERIC_WORK_CORE_JOIN_SIGNER_KEY_ID: KEY_ID,
    RENDER_GIT_COMMIT: TARGET_COMMIT,
    GENERIC_WORK_CORE_JOIN_SIGNER_SERVICE_TOKEN: TOKEN,
    GENERIC_WORK_CORE_JOIN_SIGNER_PRIVATE_KEY: SIGNER_KEYS.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .replaceAll("\n", "\\n"),
    ...overrides,
  };
}

function validRequest(overrides = {}) {
  return {
    schema_version: "generic_work_core_join_sign_request_v1",
    service: "universal-core-service",
    target_commit: TARGET_COMMIT,
    purpose: "generic_work_core_join_v1",
    key_id: KEY_ID,
    digest: DIGEST,
    ...overrides,
  };
}

async function withWorker(overrides, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "github-worker-signer-"));
  const worker = createGitHubStandingReleaseWorker({ env: baseEnv(root, overrides) });
  const server = worker.app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (pathname, {
    token = TOKEN,
    body = validRequest(),
    rawBody,
  } = {}) => {
    const headers = { "content-type": "application/json" };
    if (token !== null) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${origin}${pathname}`, {
      method: "POST",
      headers,
      body: rawBody === undefined ? JSON.stringify(body) : rawBody,
    });
    return {
      status: response.status,
      headers: response.headers,
      json: await response.json(),
    };
  };
  const health = async () => {
    const response = await fetch(`${origin}/healthz`);
    return { status: response.status, json: await response.json() };
  };
  try {
    await run({ health, request });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("sign route accepts the exact Universal Core contract and returns a verifiable Ed25519 signature", async () => {
  await withWorker({}, async ({ health, request }) => {
    const status = await health();
    assert.equal(status.status, 200);
    assert.equal(status.json.ready, true);
    assert.equal(status.json.execution_endpoint_enabled, true);
    assert.deepEqual(status.json.generic_work_core_join_signer, {
      configured: true,
      ready: true,
      state: "ready",
      route: SIGN_ROUTE,
      service: "universal-core-service",
      purpose: "generic_work_core_join_v1",
      key_id: KEY_ID,
      target_commit: TARGET_COMMIT,
      signature_algorithm: "ed25519",
      configuration_error: null,
    });
    const serializedHealth = JSON.stringify(status.json);
    assert.equal(serializedHealth.includes(TOKEN), false);
    assert.equal(serializedHealth.includes("PRIVATE KEY"), false);

    const signed = await request(SIGN_ROUTE);
    assert.equal(signed.status, 200);
    assert.equal(signed.headers.get("cache-control"), "no-store");
    assert.equal(signed.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Object.keys(signed.json).sort(), [
      "digest", "key_id", "purpose", "schema_version", "service", "signature",
      "signature_algorithm", "target_commit",
    ]);
    assert.equal(signed.json.schema_version, "generic_work_core_join_sign_response_v1");
    assert.equal(signed.json.digest, DIGEST);
    assert.equal(crypto.verify(
      null,
      Buffer.from(`generic_work_core_join_v1\0${DIGEST}`, "utf8"),
      SIGNER_KEYS.publicKey,
      Buffer.from(signed.json.signature, "base64url"),
    ), true);
    assert.equal(JSON.stringify(signed.json).includes(TOKEN), false);
  });
});

test("sign route uses timing-safe bearer authentication and never accepts missing or wrong credentials", async () => {
  await withWorker({}, async ({ request }) => {
    for (const token of [null, "wrong", `${TOKEN}-wrong`]) {
      const denied = await request(SIGN_ROUTE, { token });
      assert.equal(denied.status, 401);
      assert.deepEqual(denied.json, { error: "unauthorized" });
    }
  });
});

test("sign route rejects non-exact schemas, malformed JSON, old routes, and every pin mismatch", async () => {
  await withWorker({}, async ({ request }) => {
    const invalidBodies = [
      validRequest({ schema_version: "generic_work_core_join_v1" }),
      validRequest({ extra: true }),
      validRequest({ service: "other-core-service" }),
      validRequest({ target_commit: "c".repeat(40) }),
      validRequest({ purpose: "generic_work_core_join_other" }),
      validRequest({ key_id: "generic-work-core-join-other" }),
      validRequest({ digest: "not-a-digest" }),
    ];
    for (const body of invalidBodies) {
      const denied = await request(SIGN_ROUTE, { body });
      assert.equal(denied.status, 400);
      assert.deepEqual(denied.json, { error: "invalid_request" });
    }
    const malformed = await request(SIGN_ROUTE, { rawBody: "{" });
    assert.equal(malformed.status, 400);
    assert.deepEqual(malformed.json, { error: "invalid_request" });
    const oldRoute = await request("/v1/sign");
    assert.equal(oldRoute.status, 404);
    assert.deepEqual(oldRoute.json, { error: "not_found" });
  });
});

test("signer configuration failures are explicit in health and fail closed without exposing material", async (t) => {
  const cases = [
    ["missing service pin", { GENERIC_WORK_CORE_JOIN_SIGNER_SERVICE: "" }, "generic_work_core_join_signer_service_invalid"],
    ["missing purpose pin", { GENERIC_WORK_CORE_JOIN_SIGNER_PURPOSE: "" }, "generic_work_core_join_signer_purpose_invalid"],
    ["missing key pin", { GENERIC_WORK_CORE_JOIN_SIGNER_KEY_ID: "" }, "generic_work_core_join_signer_key_id_invalid"],
    ["missing token", { GENERIC_WORK_CORE_JOIN_SIGNER_SERVICE_TOKEN: "" }, "generic_work_core_join_signer_service_token_invalid"],
    ["missing key", { GENERIC_WORK_CORE_JOIN_SIGNER_PRIVATE_KEY: "" }, "generic_work_core_join_signer_private_key_invalid"],
    ["wrong key type", {
      GENERIC_WORK_CORE_JOIN_SIGNER_PRIVATE_KEY: GITHUB_KEYS.privateKey.export({ type: "pkcs8", format: "pem" }),
    }, "generic_work_core_join_signer_private_key_invalid"],
    ["missing target pin", {
      GENERIC_WORK_CORE_JOIN_SIGNER_TARGET_COMMIT: "",
      RENDER_GIT_COMMIT: "",
    }, "generic_work_core_join_signer_target_commit_invalid"],
    ["target differs from live commit", {
      GENERIC_WORK_CORE_JOIN_SIGNER_TARGET_COMMIT: "c".repeat(40),
    }, "generic_work_core_join_signer_target_commit_mismatch"],
  ];
  for (const [name, overrides, code] of cases) {
    await t.test(name, async () => {
      await withWorker(overrides, async ({ health, request }) => {
        const status = await health();
        assert.equal(status.status, 200);
        assert.equal(status.json.ready, true);
        assert.equal(status.json.execution_endpoint_enabled, true);
        assert.equal(status.json.generic_work_core_join_signer.configured, false);
        assert.equal(status.json.generic_work_core_join_signer.ready, false);
        assert.equal(status.json.generic_work_core_join_signer.state, "configuration_invalid");
        assert.equal(status.json.generic_work_core_join_signer.configuration_error, code);
        assert.equal(JSON.stringify(status.json).includes(TOKEN), false);
        assert.equal(JSON.stringify(status.json).includes("PRIVATE KEY"), false);
        const denied = await request(SIGN_ROUTE);
        assert.equal(denied.status, 503);
        assert.deepEqual(denied.json, { error: "signer_unavailable" });
      });
    });
  }
});

test("sign route is gated by worker readiness and emergency stop", async (t) => {
  const cases = [
    ["worker disabled", { GITHUB_STANDING_RELEASE_WORKER_ENABLED: "false" }, "worker_disabled"],
    ["worker invalid", { CORE_GITHUB_WORKER_EXECUTION_SIGNING_SECRET: "short" }, "worker_unavailable"],
    ["emergency stop", { GITHUB_STANDING_RELEASE_WORKER_EMERGENCY_STOP: "true" }, "emergency_stopped"],
  ];
  for (const [name, overrides, state] of cases) {
    await t.test(name, async () => {
      await withWorker(overrides, async ({ health, request }) => {
        const status = await health();
        assert.equal(status.status, 503);
        assert.equal(status.json.generic_work_core_join_signer.ready, false);
        assert.equal(status.json.generic_work_core_join_signer.state, state);
        const denied = await request(SIGN_ROUTE);
        assert.equal(denied.status, 503);
        assert.deepEqual(denied.json, { error: "signer_unavailable" });
      });
    });
  }
});

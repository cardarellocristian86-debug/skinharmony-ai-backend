import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createHeldHealthServer,
  startHeldBootstrap,
} from "../src/server.js";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SECRET_KEYS = Object.freeze([
  "PG_ADMIN_DATABASE_URL",
  "MCP_STAGING_GATE_CONTROL_PASSWORD",
  "MCP_STAGING_RECEIPT_AUTHORITY_PUBLIC_JWK",
  "MCP_STAGING_RECEIPT_AUTHORITY_KID",
  "MCP_STAGING_OWNER_AUTHORITY_PUBLIC_JWK",
  "MCP_STAGING_OWNER_AUTHORITY_KID",
  "MCP_STAGING_CORE_AUTHORITY_PUBLIC_JWK",
  "MCP_STAGING_CORE_AUTHORITY_KID",
  "MCP_STAGING_NYRA_AUTHORITY_PUBLIC_JWK",
  "MCP_STAGING_NYRA_AUTHORITY_KID",
  "MCP_STAGING_CORE_NONCE_API_TOKEN",
  "MCP_STAGING_NYRA_NONCE_API_TOKEN",
  "MCP_STAGING_RECEIPT_CONSUMER_API_TOKEN",
]);

function holdEnvironment(overrides = {}) {
  return {
    MCP_STAGING_DB_BOOTSTRAP_MODE: "hold",
    MCP_STAGING_BOOTSTRAP_ENVIRONMENT: "staging",
    MCP_STAGING_CONTROL_PLANE_PROFILE: "collaboration",
    RENDER_GIT_COMMIT: COMMIT,
    PORT: "10001",
    ...overrides,
  };
}

function invoke(server, path, method = "GET") {
  const request = Readable.from(method === "POST" ? [Buffer.from('{"ignored":true}')] : []);
  request.method = method;
  request.url = path;
  request.headers = { "content-type": "application/json" };
  return new Promise((resolve) => {
    const response = {
      statusCode: 200,
      headers: null,
      writeHead(status, headers) {
        this.statusCode = status;
        this.headers = headers;
      },
      end(value = "") {
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: value ? JSON.parse(String(value)) : null,
        });
      },
    };
    server.emit("request", request, response);
  });
}

test("hold validates staging/profile/build identity, scrubs secrets and never reads the admin URL", async () => {
  const env = holdEnvironment();
  let adminUrlReads = 0;
  let approvedCommitReads = 0;
  Object.defineProperty(env, "PG_ADMIN_DATABASE_URL", {
    configurable: true,
    enumerable: true,
    get() {
      adminUrlReads += 1;
      throw new Error("admin-url-must-not-be-read");
    },
  });
  Object.defineProperty(env, "MCP_STAGING_DEPENDENCY_BUILD_COMMIT", {
    configurable: true,
    enumerable: true,
    get() {
      approvedCommitReads += 1;
      throw new Error("approved-commit-must-not-be-read-in-hold");
    },
  });
  for (const key of SECRET_KEYS.slice(1)) env[key] = `secret-${key}`;

  const server = startHeldBootstrap(env, { listen: false });
  assert.equal(adminUrlReads, 0);
  assert.equal(approvedCommitReads, 0);
  for (const key of SECRET_KEYS) assert.equal(Object.hasOwn(env, key), false);
  assert.equal(env.RENDER_GIT_COMMIT, COMMIT);
  assert.equal(server.listening, false);

  const response = await invoke(server, "/healthz");
  assert.deepEqual(response, {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: {
      ok: true,
      status: "held",
      environment: "staging",
      held: true,
      database_connected: false,
      database_mutated: false,
      secrets_exposed: false,
    },
  });
  assert.equal(JSON.stringify(response).includes("secret-"), false);
  server.close();
});

test("hold exposes only GET /healthz and denies every POST without consuming its body", async () => {
  const server = createHeldHealthServer();
  for (const path of [
    "/healthz",
    "/v1/issuer-nonces/claim",
    "/v1/credential-receipts/consume",
    "/unknown",
  ]) {
    const response = await invoke(server, path, "POST");
    assert.deepEqual(response, {
      status: 405,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: { ok: false, status: "held_operation_denied" },
    });
  }
  assert.deepEqual(await invoke(server, "/unknown"), {
    status: 404,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: { ok: false, status: "not_found" },
  });
  server.close();
});

test("hold fails closed on invalid staging, profile, mode or build identity and still scrubs secrets", () => {
  const cases = [
    { MCP_STAGING_BOOTSTRAP_ENVIRONMENT: "production" },
    { MCP_STAGING_CONTROL_PLANE_PROFILE: "unknown" },
    { MCP_STAGING_DB_BOOTSTRAP_MODE: "initialize" },
    { RENDER_GIT_COMMIT: COMMIT.slice(0, 39) },
  ];
  for (const overrides of cases) {
    const env = holdEnvironment({
      PG_ADMIN_DATABASE_URL: "postgres://must-not-escape",
      MCP_STAGING_GATE_CONTROL_PASSWORD: "must-not-escape",
      ...overrides,
    });
    assert.throws(() => startHeldBootstrap(env, { listen: false }));
    assert.equal(Object.hasOwn(env, "PG_ADMIN_DATABASE_URL"), false);
    assert.equal(Object.hasOwn(env, "MCP_STAGING_GATE_CONTROL_PASSWORD"), false);
  }
});

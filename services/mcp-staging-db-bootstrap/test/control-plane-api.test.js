import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createHealthServer } from "../src/server.js";

const CORE_TOKEN = "control-plane-core-nonce-token-test-only-0123456789abcdef";
const NYRA_TOKEN = "control-plane-nyra-nonce-token-test-only-0123456789abcdef";
const CONSUMER_TOKEN = "control-plane-consumer-token-test-only-0123456789abcdef";
const TOKENS = Object.freeze({ coreNonce: CORE_TOKEN, nyraNonce: NYRA_TOKEN, receiptConsumer: CONSUMER_TOKEN });
const HEALTH = Object.freeze({
  ok: true,
  status: "ready",
  environment: "staging",
  schema_version: 2,
  role_count: 1,
  isolation: "verified",
  control_plane: "ready",
  secrets_exposed: false,
});

function invoke(server, path, { body, token = CORE_TOKEN, method = "POST", declaredLength } = {}) {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), "utf8");
  const request = Readable.from(payload.length ? [payload] : []);
  request.method = method;
  request.url = path;
  request.headers = {
    ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    ...(body === undefined ? {} : {
      "content-type": "application/json",
      "content-length": declaredLength === undefined ? String(payload.length) : String(declaredLength),
    }),
  };
  return new Promise((resolve) => {
    const response = {
      statusCode: 200,
      writeHead(status) { this.statusCode = status; },
      end(value = "") {
        resolve({ status: this.statusCode, body: value ? JSON.parse(String(value)) : null });
      },
    };
    server.emit("request", request, response);
  });
}

function nonceBody(mode, marker) {
  const now = Date.now();
  return { mode, nonce: marker.repeat(32), now_ms: now, expires_at: now + 20_000 };
}

test("each control-plane token is restricted to its exact route and issuer mode", async () => {
  const calls = [];
  const controlPlane = {
    issuerReplayStore: {
      durable: true,
      async claim(input) { calls.push({ kind: `nonce:${input.mode}`, input }); return true; },
    },
    async verifyAndConsumeReceipt(input) {
      calls.push({ kind: "receipt", input });
      return {
        ok: true,
        status: "consumed",
        idempotent: false,
        receipt_id: "mcpstg_receipt_0123456789abcdef",
        evidence_digest: "1".repeat(64),
        execution_id: "skinharmony-core-mcp-staging-render-create-v1",
        idempotency_key: `mcpstg-consume-${"2".repeat(64)}`,
        secrets_exposed: false,
      };
    },
    async close() {},
  };
  const server = createHealthServer(HEALTH, { controlPlane, apiTokens: TOKENS });
  assert.equal(server.requestTimeout, 5_000);
  assert.equal(server.headersTimeout, 6_000);
  assert.equal(server.keepAliveTimeout, 2_000);
  const coreBody = nonceBody("core", "c");
  const nyraBody = nonceBody("nyra", "n");
  const receiptBody = { envelope: { signed: true }, consumption: { exact: true } };

  assert.equal((await invoke(server, "/v1/issuer-nonces/claim", { token: CORE_TOKEN, body: coreBody })).status, 200);
  assert.equal((await invoke(server, "/v1/issuer-nonces/claim", { token: CORE_TOKEN, body: nyraBody })).status, 401);
  assert.equal((await invoke(server, "/v1/credential-receipts/consume", { token: CORE_TOKEN, body: receiptBody })).status, 401);

  assert.equal((await invoke(server, "/v1/issuer-nonces/claim", { token: NYRA_TOKEN, body: nyraBody })).status, 200);
  assert.equal((await invoke(server, "/v1/issuer-nonces/claim", { token: NYRA_TOKEN, body: coreBody })).status, 401);
  assert.equal((await invoke(server, "/v1/credential-receipts/consume", { token: NYRA_TOKEN, body: receiptBody })).status, 401);

  assert.equal((await invoke(server, "/v1/issuer-nonces/claim", { token: CONSUMER_TOKEN, body: coreBody })).status, 401);
  assert.equal((await invoke(server, "/v1/issuer-nonces/claim", { token: CONSUMER_TOKEN, body: nyraBody })).status, 401);
  const receipt = await invoke(server, "/v1/credential-receipts/consume", {
    token: CONSUMER_TOKEN,
    body: receiptBody,
  });
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.secrets_exposed, false);
  assert.deepEqual(calls.map(({ kind }) => kind), ["nonce:core", "nonce:nyra", "receipt"]);
  assert.equal(JSON.stringify(receipt).includes(CORE_TOKEN), false);
  assert.equal(JSON.stringify(receipt).includes(NYRA_TOKEN), false);
  assert.equal(JSON.stringify(receipt).includes(CONSUMER_TOKEN), false);
  server.close();
});

test("control-plane API rejects absent, duplicate or malformed capability configuration", async () => {
  const controlPlane = {
    issuerReplayStore: { durable: true, claim: async () => { throw new Error("private-detail"); } },
    verifyAndConsumeReceipt: async () => { throw new Error("private-detail"); },
    close: async () => {},
  };
  assert.throws(() => createHealthServer(HEALTH, { controlPlane }), /control_plane_api_config_invalid/);
  assert.throws(() => createHealthServer(HEALTH, {
    controlPlane,
    apiTokens: { ...TOKENS, nyraNonce: CORE_TOKEN },
  }), /control_plane_api_config_invalid/);

  const server = createHealthServer(HEALTH, { controlPlane, apiTokens: TOKENS });
  const absent = await invoke(server, "/v1/issuer-nonces/claim", {
    token: null,
    body: nonceBody("core", "a"),
  });
  assert.equal(absent.status, 401);
  const rejected = await invoke(server, "/v1/issuer-nonces/claim", {
    token: CORE_TOKEN,
    body: { mode: "core" },
  });
  assert.deepEqual(rejected, {
    status: 400,
    body: { ok: false, status: "control_plane_request_rejected" },
  });
  const oversized = await invoke(server, "/v1/issuer-nonces/claim", {
    token: CORE_TOKEN,
    body: nonceBody("core", "z"),
    declaredLength: 65_537,
  });
  assert.deepEqual(oversized, {
    status: 413,
    body: { ok: false, status: "request_body_too_large" },
  });
  assert.equal(JSON.stringify(rejected).includes("private-detail"), false);
  server.close();
});

test("collaboration rollout health exposes two verified roles without changing the API surface", async () => {
  const controlPlane = {
    profile: "collaboration",
    issuerReplayStore: { durable: true, claim: async () => true },
    verifyAndConsumeReceipt: async () => { throw new Error("fail_closed"); },
    close: async () => {},
  };
  const server = createHealthServer({ ...HEALTH, role_count: 2 }, {
    controlPlane,
    apiTokens: TOKENS,
  });
  const response = await invoke(server, "/healthz", { method: "GET", token: null });
  assert.deepEqual(response, {
    status: 200,
    body: { ...HEALTH, role_count: 2 },
  });
  assert.equal(JSON.stringify(response).includes(CORE_TOKEN), false);
  assert.equal(JSON.stringify(response).includes(NYRA_TOKEN), false);
  assert.equal(JSON.stringify(response).includes(CONSUMER_TOKEN), false);
  server.close();
});

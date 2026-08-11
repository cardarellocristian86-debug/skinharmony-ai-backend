import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createHandler } from "../src/handler.mjs";

const keyId = "generic-work-core-join-prod-v1";
const token = "a".repeat(64);
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicDer = publicKey.export({ format: "der", type: "spki" });
const signBytes = async (message) => crypto.sign(null, message, privateKey);
const handler = createHandler({ keyId, getBearerToken: async () => token, getPublicKeyDer: async () => publicDer, signBytes });

function event(path, body, authorization = `Bearer ${token}`) {
  return {
    rawPath: path,
    headers: { authorization },
    requestContext: { http: { method: "POST", path } },
    body: JSON.stringify(body)
  };
}

function requestId(digest) {
  return `gwcjs_${crypto.createHash("sha256").update(keyId).update("\0").update(digest).digest("hex")}`;
}

test("signs the exact Generic Work Core Join domain", async () => {
  const digest = "1".repeat(64);
  const response = await handler(event("/v1/generic-work-core-join/sign", {
    schema_version: "generic_work_core_join_sign_request_v1",
    purpose: "generic_work_core_join_v1",
    key_id: keyId,
    digest,
    request_id: requestId(digest),
    tenant_id: "tenant-1",
    work_id: "work-1",
    adapter: "generic",
    idempotency_digest: "2".repeat(64)
  }));
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.deepEqual(Object.keys(body).sort(), ["algorithm", "digest", "key_id", "public_key_fingerprint", "schema_version", "signature"].sort());
  assert.equal(body.algorithm, "Ed25519");
  assert.equal(body.digest, digest);
  assert.equal(crypto.verify(null, Buffer.from(`generic_work_core_join_v1\0${digest}`), publicKey, Buffer.from(body.signature, "base64url")), true);
});

test("signs a nonce-bound readiness probe", async () => {
  const nonce = crypto.randomBytes(32).toString("base64url");
  const response = await handler(event("/v1/generic-work-core-join/health", {
    schema_version: "generic_work_core_join_probe_request_v1",
    purpose: "generic_work_core_join_remote_probe_v1",
    key_id: keyId,
    nonce
  }));
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.nonce, nonce);
  assert.equal(crypto.verify(null, Buffer.from(`generic_work_core_join_remote_probe_v1\0${nonce}`), publicKey, Buffer.from(body.signature, "base64url")), true);
});

test("denies invalid credentials without signing", async () => {
  const response = await handler(event("/v1/generic-work-core-join/health", {}, "Bearer forged"));
  assert.equal(response.statusCode, 401);
});

test("denies extra properties and a forged request id", async () => {
  const digest = "3".repeat(64);
  const response = await handler(event("/v1/generic-work-core-join/sign", {
    schema_version: "generic_work_core_join_sign_request_v1",
    purpose: "generic_work_core_join_v1",
    key_id: keyId,
    digest,
    request_id: "gwcjs_forged",
    tenant_id: "tenant-1",
    work_id: "work-1",
    adapter: "generic",
    idempotency_digest: "4".repeat(64),
    arbitrary_payload: "denied"
  }));
  assert.equal(response.statusCode, 400);
});

test("revokes a rotated bearer token on the next request", async () => {
  let currentToken = "b".repeat(64);
  const rotatingHandler = createHandler({
    keyId,
    getBearerToken: async () => currentToken,
    getPublicKeyDer: async () => publicDer,
    signBytes
  });
  const nonce = crypto.randomBytes(32).toString("base64url");
  const probe = {
    schema_version: "generic_work_core_join_probe_request_v1",
    purpose: "generic_work_core_join_remote_probe_v1",
    key_id: keyId,
    nonce
  };
  assert.equal((await rotatingHandler(event("/v1/generic-work-core-join/health", probe, `Bearer ${currentToken}`))).statusCode, 200);
  const revokedToken = currentToken;
  currentToken = "c".repeat(64);
  assert.equal((await rotatingHandler(event("/v1/generic-work-core-join/health", probe, `Bearer ${revokedToken}`))).statusCode, 401);
  assert.equal((await rotatingHandler(event("/v1/generic-work-core-join/health", probe, `Bearer ${currentToken}`))).statusCode, 200);
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createGenericWorkCoreJoinSigner } from "../src/generic-work-core-join-signer.js";

const env = {
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_ENABLED: "true",
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE: "universal-core-service",
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_PURPOSE: "generic_work_core_join_v1",
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_KEY_ID: "universal-core-generic-join-v1",
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN: "t".repeat(48),
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SEED: "s".repeat(48),
};
const liveCoreCommit = "a".repeat(40);

function response() {
  return { statusCode: null, body: null, set() { return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; } };
}

test("generic join signer binds the request to the live verified Core build", async () => {
  const signer = createGenericWorkCoreJoinSigner({
    env,
    coreHealthResolver: async () => liveCoreCommit,
  });
  assert.equal(signer.health().ready, true);
  const digest = crypto.createHash("sha256").update("join").digest("hex");
  const request = { get: () => `Bearer ${env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN}`, body: {
    schema_version: "generic_work_core_join_sign_request_v1",
    service: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE,
    target_commit: liveCoreCommit,
    purpose: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_PURPOSE,
    key_id: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_KEY_ID,
    digest,
  } };
  const res = response();
  await signer.handle(request, res);
  assert.equal(res.statusCode, 200);
  const publicKey = crypto.createPublicKey({ key: JSON.parse(signer.health().public_key), format: "jwk" });
  assert.equal(crypto.verify(null, Buffer.from(`generic_work_core_join_v1\0${digest}`), publicKey,
    Buffer.from(res.body.signature, "base64url")), true);
  const denied = response();
  await signer.handle({ ...request, get: () => "Bearer wrong" }, denied);
  assert.equal(denied.statusCode, 401);
  const stale = response();
  await signer.handle({ ...request, body: { ...request.body, target_commit: "b".repeat(40) } }, stale);
  assert.equal(stale.statusCode, 409);
});

test("generic join signer fails closed when the Core build cannot be verified", async () => {
  const signer = createGenericWorkCoreJoinSigner({
    env,
    coreHealthResolver: async () => { throw new Error("unavailable"); },
  });
  const res = response();
  await signer.handle({
    get: () => `Bearer ${env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN}`,
    body: {
      schema_version: "generic_work_core_join_sign_request_v1",
      service: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE,
      target_commit: liveCoreCommit,
      purpose: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_PURPOSE,
      key_id: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_KEY_ID,
      digest: crypto.createHash("sha256").update("join").digest("hex"),
    },
  }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "signer_unavailable" });
});

test("generic join signer reads the verified current Core build over bounded HTTPS health", async () => {
  const requests = [];
  const signer = createGenericWorkCoreJoinSigner({
    env,
    coreOrigin: "https://universal-core.example.test",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ ok: true, build: {
        commit_verifiable: true,
        commit_sha: liveCoreCommit,
      } }), { headers: { "content-type": "application/json; charset=utf-8" } });
    },
  });
  const res = response();
  await signer.handle({
    get: () => `Bearer ${env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN}`,
    body: {
      schema_version: "generic_work_core_join_sign_request_v1",
      service: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE,
      target_commit: liveCoreCommit,
      purpose: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_PURPOSE,
      key_id: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_KEY_ID,
      digest: crypto.createHash("sha256").update("live-health").digest("hex"),
    },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://universal-core.example.test/healthz");
  assert.equal(requests[0].options.redirect, "error");
});

test("generic join signer rejects an unverified Core health response", async () => {
  const signer = createGenericWorkCoreJoinSigner({
    env,
    coreOrigin: "https://universal-core.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, build: {
      commit_verifiable: false,
      commit_sha: liveCoreCommit,
    } }), { headers: { "content-type": "application/json" } }),
  });
  const res = response();
  await signer.handle({
    get: () => `Bearer ${env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN}`,
    body: {
      schema_version: "generic_work_core_join_sign_request_v1",
      service: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE,
      target_commit: liveCoreCommit,
      purpose: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_PURPOSE,
      key_id: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_KEY_ID,
      digest: crypto.createHash("sha256").update("unverified-health").digest("hex"),
    },
  }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "signer_unavailable" });
});

test("generic join signer requires the canonical Core commit_sha field", async () => {
  const signer = createGenericWorkCoreJoinSigner({
    env,
    coreOrigin: "https://universal-core.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, build: {
      commit_verifiable: true,
      build_id: liveCoreCommit,
    } }), { headers: { "content-type": "application/json" } }),
  });
  const res = response();
  await signer.handle({
    get: () => `Bearer ${env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN}`,
    body: {
      schema_version: "generic_work_core_join_sign_request_v1",
      service: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE,
      target_commit: liveCoreCommit,
      purpose: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_PURPOSE,
      key_id: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_KEY_ID,
      digest: crypto.createHash("sha256").update("noncanonical-build-id").digest("hex"),
    },
  }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "signer_unavailable" });
});

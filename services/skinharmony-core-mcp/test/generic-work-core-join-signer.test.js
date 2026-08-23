import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createGenericWorkCoreJoinSigner } from "../src/generic-work-core-join-signer.js";

const signerEnv = {
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_ENABLED: "true",
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE: "universal-core-service",
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_PURPOSE: "generic_work_core_join_v1",
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_KEY_ID: "universal-core-generic-join-v1",
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN: "t".repeat(48),
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SEED: "s".repeat(48),
};
const env = { ...signerEnv, GENERIC_WORK_CORE_JOIN_CORE_SIGNER_TARGET_COMMIT: "a".repeat(40) };

function response() {
  return { statusCode: null, body: null, set() { return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; } };
}

test("generic join signer is target-bound and produces a verifiable domain signature", () => {
  const signer = createGenericWorkCoreJoinSigner({ env });
  assert.equal(signer.health().ready, true);
  const digest = crypto.createHash("sha256").update("join").digest("hex");
  const request = { get: () => `Bearer ${env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN}`, body: {
    schema_version: "generic_work_core_join_sign_request_v1",
    service: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE,
    target_commit: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_TARGET_COMMIT,
    purpose: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_PURPOSE,
    key_id: env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_KEY_ID,
    digest,
  } };
  const res = response();
  signer.handle(request, res);
  assert.equal(res.statusCode, 200);
  const publicKey = crypto.createPublicKey({ key: JSON.parse(signer.health().public_key), format: "jwk" });
  assert.equal(crypto.verify(null, Buffer.from(`generic_work_core_join_v1\0${digest}`), publicKey,
    Buffer.from(res.body.signature, "base64url")), true);
  const denied = response();
  signer.handle({ ...request, get: () => "Bearer wrong" }, denied);
  assert.equal(denied.statusCode, 401);
});

test("generic join signer defaults an absent manual pin to the verified Render build", () => {
  const commit = "b".repeat(40);
  const signer = createGenericWorkCoreJoinSigner({ env: {
    ...signerEnv,
    NODE_ENV: "production",
    RENDER_GIT_COMMIT: commit,
  } });
  assert.equal(signer.health().configured, true);
  assert.equal(signer.health().ready, true);
  assert.equal(signer.health().error, null);
  assert.equal(signer.health().target_commit, commit);
});

test("generic join signer accepts only a matching explicit production override", () => {
  const commit = "c".repeat(40);
  const matching = createGenericWorkCoreJoinSigner({ env: {
    ...signerEnv,
    NODE_ENV: "production",
    RENDER_GIT_COMMIT: commit,
    GENERIC_WORK_CORE_JOIN_CORE_SIGNER_TARGET_COMMIT: commit,
  } });
  assert.equal(matching.health().ready, true);
  assert.equal(matching.health().target_commit, commit);

  const stale = createGenericWorkCoreJoinSigner({ env: {
    ...signerEnv,
    NODE_ENV: "production",
    RENDER_GIT_COMMIT: commit,
    GENERIC_WORK_CORE_JOIN_CORE_SIGNER_TARGET_COMMIT: "d".repeat(40),
  } });
  assert.equal(stale.health().ready, false);
  assert.equal(stale.health().error, "generic_work_core_join_signer_target_commit_mismatch");
  const denied = response();
  stale.handle({ get: () => `Bearer ${signerEnv.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN}`, body: {} }, denied);
  assert.equal(denied.statusCode, 503);
  assert.deepEqual(denied.body, { error: "signer_unavailable" });
  assert.equal(Object.hasOwn(denied.body, "signature"), false);
});

test("generic join signer rejects an unverifiable production build", () => {
  for (const buildEnv of [
    { GENERIC_WORK_CORE_JOIN_CORE_SIGNER_TARGET_COMMIT: "e".repeat(40) },
    { RENDER_GIT_COMMIT: "not-a-commit", GENERIC_WORK_CORE_JOIN_CORE_SIGNER_TARGET_COMMIT: "e".repeat(40) },
    { BUILD_COMMIT_SHA: "e".repeat(40), GENERIC_WORK_CORE_JOIN_CORE_SIGNER_TARGET_COMMIT: "e".repeat(40) },
  ]) {
    const signer = createGenericWorkCoreJoinSigner({ env: {
      ...signerEnv,
      NODE_ENV: "production",
      ...buildEnv,
    } });
    assert.equal(signer.health().ready, false);
    assert.equal(signer.health().error, "generic_work_core_join_signer_build_commit_unverifiable");
    assert.equal(signer.health().public_key, null);
    assert.equal(signer.health().public_key_fingerprint, null);
    assert.equal(Object.hasOwn(signer.health(), "token"), false);
    assert.equal(Object.hasOwn(signer.health(), "seed"), false);
  }
  const renderRuntime = createGenericWorkCoreJoinSigner({ env: {
    ...signerEnv,
    NODE_ENV: "development",
    RENDER: "true",
    GENERIC_WORK_CORE_JOIN_CORE_SIGNER_TARGET_COMMIT: "e".repeat(40),
  } });
  assert.equal(renderRuntime.health().ready, false);
  assert.equal(renderRuntime.health().error, "generic_work_core_join_signer_build_commit_unverifiable");
});

test("generic join signer rejects a request target different from its self-pin", () => {
  const commit = "f".repeat(40);
  const signer = createGenericWorkCoreJoinSigner({ env: {
    ...signerEnv,
    NODE_ENV: "production",
    RENDER_GIT_COMMIT: commit,
  } });
  const denied = response();
  signer.handle({
    get: () => `Bearer ${signerEnv.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN}`,
    body: {
      schema_version: "generic_work_core_join_sign_request_v1",
      service: signerEnv.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE,
      target_commit: "0".repeat(40),
      purpose: signerEnv.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_PURPOSE,
      key_id: signerEnv.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_KEY_ID,
      digest: crypto.createHash("sha256").update("wrong-target").digest("hex"),
    },
  }, denied);
  assert.equal(denied.statusCode, 400);
  assert.deepEqual(denied.body, { error: "invalid_request" });
  assert.equal(Object.hasOwn(denied.body, "signature"), false);
});

test("generic join signer preserves explicit target compatibility for development fixtures", () => {
  const signer = createGenericWorkCoreJoinSigner({ env });
  assert.equal(signer.health().ready, true);
  assert.equal(signer.health().target_commit, env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_TARGET_COMMIT);
});

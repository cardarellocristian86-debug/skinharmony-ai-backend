import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createGenericWorkCoreJoinSigner } from "../src/generic-work-core-join-signer.js";

const env = {
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_ENABLED: "true",
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE: "universal-core-service",
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_PURPOSE: "generic_work_core_join_v1",
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_KEY_ID: "universal-core-generic-join-v1",
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_TARGET_COMMIT: "a".repeat(40),
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN: "t".repeat(48),
  GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SEED: "s".repeat(48),
};

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

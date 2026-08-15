import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createPolicyRegistrySigner } from "../src/policy-registry-signer.js";

const COMMIT = "a".repeat(40);
const TOKEN = "t".repeat(48);
const env = {
  POLICY_REGISTRY_CORE_SIGNER_ENABLED: "true",
  POLICY_REGISTRY_CORE_SIGNER_SERVICE: "universal-core-policy-registry-signer",
  POLICY_REGISTRY_CORE_SIGNER_KEY_ID: "universal-core-policy-registry-v1",
  POLICY_REGISTRY_CORE_SIGNER_TARGET_COMMIT: COMMIT,
  POLICY_REGISTRY_CORE_SIGNER_SERVICE_TOKEN: TOKEN,
  POLICY_REGISTRY_CORE_SIGNER_SEED: "s".repeat(48),
};

function response() {
  return {
    statusCode: null, body: null,
    set() { return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test("core signer derives stable public metadata and signs only exact bound payloads", () => {
  const signer = createPolicyRegistrySigner({ env });
  assert.equal(signer.health().ready, true);
  assert.match(signer.health().public_key_fingerprint, /^[a-f0-9]{64}$/);
  const payload = Buffer.from("bounded-policy-proof");
  const digest = crypto.createHash("sha256").update(payload).digest("hex");
  const req = { get: () => `Bearer ${TOKEN}`, body: {
    schema_version: "nyra_policy_registry_sign_request_v1",
    service: env.POLICY_REGISTRY_CORE_SIGNER_SERVICE,
    target_commit: COMMIT,
    purpose: "nyra-policy-registry-core-signer-probe-v1",
    key_id: env.POLICY_REGISTRY_CORE_SIGNER_KEY_ID,
    digest,
    payload: payload.toString("base64url"),
  } };
  const res = response();
  signer.handle(req, res);
  assert.equal(res.statusCode, 200);
  const jwk = JSON.parse(signer.health().public_key);
  assert.equal(crypto.verify(null, payload, crypto.createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(res.body.signature, "base64url")), true);
  const denied = response();
  signer.handle({ ...req, get: () => "Bearer wrong" }, denied);
  assert.equal(denied.statusCode, 401);
});

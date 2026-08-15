"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { createNyraPolicyRegistryEmbeddedSigner } = require("../lib/nyra-policy-registry-embedded-signer");

const COMMIT = "b".repeat(40);
const TOKEN = "n".repeat(48);
const env = {
  NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_ENABLED: "true",
  NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_SERVICE: "nyra-policy-registry-signer",
  NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_KEY_ID: "nyra-policy-registry-v1",
  NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_TARGET_COMMIT: COMMIT,
  NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_PURPOSE: "nyra.policy_registry.attestation",
  NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_SERVICE_TOKEN: TOKEN,
  NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_SEED: "z".repeat(48),
};

function response() {
  return { statusCode: null, body: null, set() { return this; }, status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; } };
}

test("Nyra signer is deterministic, bearer-bound and produces verifiable Ed25519", () => {
  const signer = createNyraPolicyRegistryEmbeddedSigner({ env });
  assert.equal(signer.health().ready, true);
  const payload = Buffer.from("nyra-attestation");
  const req = { get: () => `Bearer ${TOKEN}`, body: {
    schema_version: "nyra_policy_registry_sign_request_v1",
    service: env.NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_SERVICE,
    target_commit: COMMIT,
    purpose: env.NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_PURPOSE,
    key_id: env.NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_KEY_ID,
    digest: crypto.createHash("sha256").update(payload).digest("hex"),
    payload: payload.toString("base64url"),
  } };
  const res = response();
  signer.handle(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(crypto.verify(null, payload,
    crypto.createPublicKey({ key: JSON.parse(signer.health().public_key), format: "jwk" }),
    Buffer.from(res.body.signature, "base64url")), true);
});

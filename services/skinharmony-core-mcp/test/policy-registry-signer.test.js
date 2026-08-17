import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  NYRA_POLICY_REGISTRY_SIGN_ROUTE,
  createPolicyRegistrySigner,
} from "../src/policy-registry-signer.js";

const COMMIT = "a".repeat(40);
const TOKEN = "t".repeat(48);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
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

test("Nyra signer uses an isolated route, purpose, key, and derivation domain", () => {
  const nyraEnv = {
    POLICY_REGISTRY_NYRA_SIGNER_ENABLED: "true",
    POLICY_REGISTRY_NYRA_SIGNER_SERVICE: "nyra-policy-registry-signer",
    POLICY_REGISTRY_NYRA_SIGNER_KEY_ID: "nyra-policy-registry-v1",
    POLICY_REGISTRY_NYRA_SIGNER_TARGET_COMMIT: COMMIT,
    POLICY_REGISTRY_NYRA_SIGNER_SERVICE_TOKEN: TOKEN,
    POLICY_REGISTRY_NYRA_SIGNER_SEED: env.POLICY_REGISTRY_CORE_SIGNER_SEED,
  };
  const signer = createPolicyRegistrySigner({
    env: nyraEnv,
    prefix: "POLICY_REGISTRY_NYRA_SIGNER",
    route: NYRA_POLICY_REGISTRY_SIGN_ROUTE,
    allowedPurposes: new Set(["nyra.policy_registry.attestation", "nyra.precore.decision.v1"]),
    signatureAlgorithm: "ed25519",
    derivationDomain: "skinharmony-policy-registry-nyra-signer-v1",
  });
  assert.equal(signer.health().ready, true);
  assert.equal(signer.health().route, NYRA_POLICY_REGISTRY_SIGN_ROUTE);
  assert.notEqual(signer.health().public_key_fingerprint,
    createPolicyRegistrySigner({ env }).health().public_key_fingerprint);

  const payload = Buffer.from("nyra-attestation");
  const digest = crypto.createHash("sha256").update(payload).digest("hex");
  const request = { get: () => `Bearer ${TOKEN}`, body: {
    schema_version: "nyra_policy_registry_sign_request_v1",
    service: nyraEnv.POLICY_REGISTRY_NYRA_SIGNER_SERVICE,
    target_commit: COMMIT,
    purpose: "nyra.policy_registry.attestation",
    key_id: nyraEnv.POLICY_REGISTRY_NYRA_SIGNER_KEY_ID,
    digest,
    payload: payload.toString("base64url"),
  } };
  const signed = response();
  signer.handle(request, signed);
  assert.equal(signed.statusCode, 200);
  assert.equal(signed.body.signature_algorithm, "ed25519");

  const precore = response();
  signer.handle({ ...request, body: { ...request.body, purpose: "nyra.precore.decision.v1" } }, precore);
  assert.equal(precore.statusCode, 200);
  assert.equal(precore.body.purpose, "nyra.precore.decision.v1");

  const wrongPurpose = response();
  signer.handle({ ...request, body: { ...request.body, purpose: "nyra-policy-registry-core-signer-probe-v1" } }, wrongPurpose);
  assert.equal(wrongPurpose.statusCode, 400);
});

test("Nyra Blueprint binds the client to the isolated Nyra signer route", () => {
  const blueprint = fs.readFileSync(path.join(REPOSITORY_ROOT, "render-nyra.yaml"), "utf8");
  assert.match(
    blueprint,
    /- key: NYRA_POLICY_REGISTRY_REMOTE_SIGNER_PATH\s+value: \/v1\/policy-registry\/nyra\/sign/,
  );
  assert.doesNotMatch(
    blueprint,
    /- key: NYRA_POLICY_REGISTRY_REMOTE_SIGNER_PATH\s+value: \/v1\/policy-registry\/sign(?:\s|$)/,
  );
});

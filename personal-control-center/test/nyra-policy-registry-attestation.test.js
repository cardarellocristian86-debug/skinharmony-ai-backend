"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SCHEMA_VERSION,
  createNyraPolicyRegistryAttester,
  payloadBytes,
} = require("../lib/nyra-policy-registry-attestation");

const NOW = Date.parse("2026-08-03T12:00:00.000Z");

function fixture(overrides = {}) {
  const core = crypto.generateKeyPairSync("ed25519");
  const nyra = crypto.generateKeyPairSync("ed25519");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-policy-attestation-"));
  const env = {
    NYRA_POLICY_REGISTRY_ATTESTATION_ENABLED: "true",
    NYRA_POLICY_REGISTRY_TENANT_ALLOWLIST: "codexai",
    NYRA_POLICY_REGISTRY_CORE_KEY_ID: "core-policy-k1",
    NYRA_POLICY_REGISTRY_NYRA_KEY_ID: "nyra-policy-k1",
    NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY: core.publicKey.export({ type: "spki", format: "pem" }),
    NYRA_POLICY_REGISTRY_NYRA_PRIVATE_KEY: nyra.privateKey.export({ type: "pkcs8", format: "pem" }),
    NYRA_POLICY_REGISTRY_REPLAY_STORE_PATH: path.join(directory, "replay.json"),
    NYRA_POLICY_REGISTRY_ATTESTATION_MAX_AGE_MS: "300000",
    ...overrides,
  };
  const envelope = {
    schema_version: SCHEMA_VERSION,
    tenant_id: "codexai",
    work_id: "work-12345678",
    preflight_id: "preflight-12345678",
    intent_digest: "a".repeat(64),
    operation_id: "operation-12345678",
    action: "policy.snapshot.activate",
    snapshot_digest: "b".repeat(64),
    domain_pack_id: "generic-policy",
    nonce: crypto.randomBytes(24).toString("base64url"),
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    core_key_id: "core-policy-k1",
    nyra_key_id: "nyra-policy-k1",
  };
  const coreSignature = crypto.sign(null, payloadBytes(envelope), core.privateKey).toString("base64url");
  return { core, nyra, directory, env, envelope, coreSignature };
}

test("verifies Core and adds an independent Nyra Ed25519 signature", () => {
  const value = fixture();
  const attester = createNyraPolicyRegistryAttester({ env: value.env, now: () => NOW });
  assert.equal(attester.status().ready, true);
  const result = attester.attest({ envelope: value.envelope, core_signature: value.coreSignature });
  assert.equal(result.idempotent_replay, false);
  assert.equal(crypto.verify(null, payloadBytes(value.envelope), value.core.publicKey,
    Buffer.from(result.core_signature, "base64url")), true);
  assert.equal(crypto.verify(null, payloadBytes(value.envelope), value.nyra.publicKey,
    Buffer.from(result.nyra_signature, "base64url")), true);
  assert.notEqual(result.core_signature, result.nyra_signature);
});

test("persists tenant-scoped replay and returns the same signature after restart", () => {
  const value = fixture();
  const first = createNyraPolicyRegistryAttester({ env: value.env, now: () => NOW })
    .attest({ envelope: value.envelope, core_signature: value.coreSignature });
  const restarted = createNyraPolicyRegistryAttester({ env: value.env, now: () => NOW });
  const replay = restarted.attest({ envelope: value.envelope, core_signature: value.coreSignature });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.nyra_signature, first.nyra_signature);
  const divergent = { ...value.envelope, operation_id: "operation-divergent" };
  const divergentSignature = crypto.sign(null, payloadBytes(divergent), value.core.privateKey).toString("base64url");
  assert.throws(() => restarted.attest({ envelope: divergent, core_signature: divergentSignature }),
    /nyra_policy_attestation_nonce_reused/);
});

test("fails closed for tampering, foreign tenant, expiry and non-independent keys", () => {
  const value = fixture();
  const attester = createNyraPolicyRegistryAttester({ env: value.env, now: () => NOW });
  assert.throws(() => attester.attest({
    envelope: { ...value.envelope, snapshot_digest: "c".repeat(64) },
    core_signature: value.coreSignature,
  }), /core_signature_invalid/);
  const foreign = { ...value.envelope, tenant_id: "other-tenant", nonce: crypto.randomBytes(24).toString("base64url") };
  const foreignSignature = crypto.sign(null, payloadBytes(foreign), value.core.privateKey).toString("base64url");
  assert.throws(() => attester.attest({ envelope: foreign, core_signature: foreignSignature }), /tenant_denied/);
  const expired = { ...value.envelope, nonce: crypto.randomBytes(24).toString("base64url"),
    issued_at: new Date(NOW - 120_000).toISOString(), expires_at: new Date(NOW - 1).toISOString() };
  const expiredSignature = crypto.sign(null, payloadBytes(expired), value.core.privateKey).toString("base64url");
  assert.throws(() => attester.attest({ envelope: expired, core_signature: expiredSignature }), /expired/);

  const sameKey = fixture({
    NYRA_POLICY_REGISTRY_NYRA_KEY_ID: "core-policy-k1",
    NYRA_POLICY_REGISTRY_NYRA_PRIVATE_KEY: value.core.privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  assert.equal(createNyraPolicyRegistryAttester({ env: sameKey.env }).status().ready, false);
});

test("rejects unknown actions and extra envelope fields", () => {
  const value = fixture();
  const attester = createNyraPolicyRegistryAttester({ env: value.env, now: () => NOW });
  const unknown = { ...value.envelope, action: "policy.snapshot.delete" };
  assert.throws(() => attester.attest({ envelope: unknown, core_signature: value.coreSignature }), /envelope_invalid/);
  assert.throws(() => attester.attest({ envelope: { ...value.envelope, owner_confirmed: true }, core_signature: value.coreSignature }),
    /envelope_schema_invalid/);
});

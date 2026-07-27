import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createMcpStagingCredentialReceiptVerifier,
  createMcpStagingOwnerConfirmationVerifier,
  issueMcpStagingCredentialReceipt,
  issueMcpStagingOwnerConfirmation,
  loadMcpStagingPublicTrustAnchor,
} from "../src/mcpStagingEvidence.js";

const NOW = Date.parse("2026-07-19T15:00:00.000Z");
const TARGET_COMMIT = crypto.randomBytes(20).toString("hex");

function receipt(signingKey, overrides = {}) {
  return issueMcpStagingCredentialReceipt({
    receipt_id: "mcpstg_receipt_0123456789abcdef",
    credential_execution_id: "mcp-staging-credentials-20260719-01",
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    core_key_handle_digest: "5".repeat(64),
    ...overrides,
  }, signingKey, { targetCommit: TARGET_COMMIT });
}

test("verifies a credential receipt cryptographically and returns only redacted evidence", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const envelope = receipt(keys.privateKey);
  const verify = createMcpStagingCredentialReceiptVerifier({
    publicKey: keys.publicKey,
    now: () => NOW,
    targetCommit: TARGET_COMMIT,
  });
  const evidence = await verify(envelope);
  assert.equal(evidence.signature_verified, true);
  assert.equal(evidence.verification_method, "ed25519");
  assert.equal(evidence.binding_digest, envelope.claims.binding_digest);
  assert.equal(evidence.secret_values_present, false);
  assert.equal(evidence.secret_values_persisted, false);
  assert.deepEqual(Object.keys(evidence).sort(), [
    "binding_digest", "codex_bearer_mode", "core_key_handle_digest", "credential_execution_id",
    "expires_at", "issued_at", "issuer", "kid", "operation", "payload_digest", "receipt_id",
    "schema_version", "secret_values_persisted", "secret_values_present", "signature_digest",
    "signature_verified", "target_commit", "target_environment", "target_service", "tenant_id",
    "verification_method",
  ].sort());
});

test("tamper, wrong key and expired receipt all fail closed", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const wrong = crypto.generateKeyPairSync("ed25519");
  const envelope = receipt(keys.privateKey);
  const verify = createMcpStagingCredentialReceiptVerifier({
    publicKey: keys.publicKey,
    now: () => NOW,
    targetCommit: TARGET_COMMIT,
  });
  const tampered = structuredClone(envelope);
  tampered.claims.target_environment = "production";
  await assert.rejects(verify(tampered), /credential_receipt_signature_invalid/);
  await assert.rejects(
    createMcpStagingCredentialReceiptVerifier({
      publicKey: wrong.publicKey,
      now: () => NOW,
      targetCommit: TARGET_COMMIT,
    })(envelope),
    /credential_receipt_signature_invalid/,
  );
  const expired = receipt(keys.privateKey, {
    issued_at: new Date(NOW - 60_000).toISOString(),
    expires_at: new Date(NOW).toISOString(),
  });
  await assert.rejects(verify(expired), /credential_receipt_contract_invalid/);
  const replayVerifier = createMcpStagingCredentialReceiptVerifier({
    publicKey: keys.publicKey,
    now: () => NOW,
    allowExpired: true,
    targetCommit: TARGET_COMMIT,
  });
  assert.equal((await replayVerifier(expired)).receipt_id, expired.claims.receipt_id);
});

test("loads only an exact pinned public trust anchor and rejects private-key material", () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const envelope = receipt(keys.privateKey);
  const exported = keys.publicKey.export({ format: "jwk" });
  const jwk = {
    alg: "EdDSA",
    crv: "Ed25519",
    kid: envelope.claims.kid,
    kty: "OKP",
    use: "sig",
    x: exported.x,
  };
  const anchor = loadMcpStagingPublicTrustAnchor({
    authority: "receipt",
    jwkJson: JSON.stringify(jwk),
    expectedKid: envelope.claims.kid,
  });
  assert.equal(anchor.kid, envelope.claims.kid);
  assert.equal(anchor.publicKey.type, "public");

  const privateJwk = { ...jwk, d: "private-material-must-fail" };
  assert.throws(() => loadMcpStagingPublicTrustAnchor({
    authority: "receipt",
    jwkJson: JSON.stringify(privateJwk),
    expectedKid: envelope.claims.kid,
  }), /public_trust_anchor_invalid/);
  assert.throws(() => loadMcpStagingPublicTrustAnchor({
    authority: "receipt",
    jwkJson: JSON.stringify(jwk),
    expectedKid: `ed25519-sha256:${"0".repeat(64)}`,
  }), /public_trust_anchor_invalid/);
});

test("owner confirmation is independently signed, bounded and target-scoped", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const envelope = issueMcpStagingOwnerConfirmation({
    confirmation_reference: "owner_mcp_staging_dependencies_20260719",
    authorization_text_digest: "7".repeat(64),
    attempt_id: "mcpstg_11111111-2222-4333-8444-555555555555",
    deployment_spec_digest: "1".repeat(64),
    preflight_digest: "2".repeat(64),
    credential_grant_digest: "3".repeat(64),
    action_digest: "6".repeat(64),
    executor_contract_id: "domain_action_66666666666666666666",
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    nonce: "owner_confirmation_nonce_20260719",
  }, keys.privateKey, { targetCommit: TARGET_COMMIT });
  const verify = createMcpStagingOwnerConfirmationVerifier({
    publicKey: keys.publicKey,
    now: () => NOW,
    targetCommit: TARGET_COMMIT,
  });
  const claims = await verify(envelope);
  assert.equal(claims.target_environment, "staging");
  assert.equal(claims.action_digest, "6".repeat(64));
  assert.match(claims.owner_confirmation_digest, /^[a-f0-9]{64}$/);
  const tampered = structuredClone(envelope);
  tampered.claims.target_service = "another-service";
  await assert.rejects(verify(tampered), /owner_confirmation_signature_invalid/);
});

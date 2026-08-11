import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  BOOTSTRAP_RELEASE_EXCEPTION_CANDIDATE_SCHEMA_VERSION,
  BOOTSTRAP_RELEASE_EXCEPTION_SCHEMA_VERSION,
  bootstrapReleaseExceptionChallenge,
  createBootstrapReleaseExceptionVerifier,
  localPinBootstrapReleaseExceptionSigningPayload,
  verifyLocalPinBootstrapReleaseException,
} from "../src/bootstrapReleaseException.js";

const NOW = Date.parse("2026-08-10T10:00:00.000Z");
const ORIGIN = "https://core.example.com";
const RP_ID = "example.com";
const CREDENTIAL_ID = crypto.randomBytes(32).toString("base64url");
const KEY_ID = "webauthn-platform-owner-key-v1";
const KEYS = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const digest = (label) => crypto.createHash("sha256").update(label).digest("hex");

function unsignedReceipt(overrides = {}) {
  return {
    schema_version: BOOTSTRAP_RELEASE_EXCEPTION_SCHEMA_VERSION,
    exception_id: "bootstrap-exception-pr223-v1",
    tenant_id: "tenant-owner-private",
    work_id: "work-continuity-v2-release",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    pr_number: 223,
    head_sha: "7".repeat(40),
    allowed_action: "github.merge",
    max_uses: 1,
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 5 * 60_000).toISOString(),
    required_checks_digest: digest("required-checks"),
    required_checks_results_digest: digest("required-check-results"),
    owner_confirmation_digest: digest("owner-confirmation"),
    core_policy_verdict_digest: digest("core-policy-verdict"),
    core_policy_classification: "BOOTSTRAP_DEADLOCK_VERIFIED",
    rollback_obligations_digest: digest("rollback-obligations"),
    post_deploy_obligations_digest: digest("post-deploy-obligations"),
    nonce: "bootstrap-nonce-pr223-v1",
    authority_key_id: KEY_ID,
    authority_provider: "webauthn_platform",
    consumed_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function authenticatorData({ flags = 0x05, rpId = RP_ID, signCount = 1 } = {}) {
  const data = Buffer.alloc(37);
  crypto.createHash("sha256").update(rpId).digest().copy(data, 0);
  data[32] = flags;
  data.writeUInt32BE(signCount, 33);
  return data;
}

function signedReceipt(overrides = {}, assertionOverrides = {}) {
  const unsigned = unsignedReceipt(overrides);
  const challenge = bootstrapReleaseExceptionChallenge(unsigned);
  const clientData = Buffer.from(JSON.stringify({
    type: "webauthn.get",
    challenge,
    origin: ORIGIN,
    crossOrigin: false,
  }), "utf8");
  const authData = authenticatorData(assertionOverrides);
  const signedBytes = Buffer.concat([
    authData,
    crypto.createHash("sha256").update(clientData).digest(),
  ]);
  const signature = crypto.sign("sha256", signedBytes, {
    key: KEYS.privateKey,
    dsaEncoding: "der",
  });
  return {
    ...unsigned,
    authority_assertion: {
      credential_id: CREDENTIAL_ID,
      authenticator_data_base64url: authData.toString("base64url"),
      client_data_json_base64url: clientData.toString("base64url"),
      signature_der_base64url: signature.toString("base64url"),
      ...assertionOverrides.assertion,
    },
  };
}

function expected(receipt, overrides = {}) {
  return {
    exception_id: receipt.exception_id,
    tenant_id: receipt.tenant_id,
    work_id: receipt.work_id,
    repository: receipt.repository,
    pr_number: receipt.pr_number,
    head_sha: receipt.head_sha,
    allowed_action: receipt.allowed_action,
    required_checks_digest: receipt.required_checks_digest,
    required_checks_results_digest: receipt.required_checks_results_digest,
    owner_confirmation_digest: receipt.owner_confirmation_digest,
    core_policy_verdict_digest: receipt.core_policy_verdict_digest,
    rollback_obligations_digest: receipt.rollback_obligations_digest,
    post_deploy_obligations_digest: receipt.post_deploy_obligations_digest,
    nonce: receipt.nonce,
    ...overrides,
  };
}

function verifier(now = () => NOW) {
  return createBootstrapReleaseExceptionVerifier({
    origin: ORIGIN,
    rpId: RP_ID,
    credentialId: CREDENTIAL_ID,
    publicKey: KEYS.publicKey,
    authorityKeyId: KEY_ID,
    now,
  });
}

function localPinReceipt(overrides = {}) {
  const unsigned = unsignedReceipt({ authority_provider: "local_pin", ...overrides });
  const signature = crypto.sign(
    "sha256",
    localPinBootstrapReleaseExceptionSigningPayload(unsigned),
    { key: KEYS.privateKey, dsaEncoding: "ieee-p1363" },
  );
  return {
    ...unsigned,
    authority_assertion: {
      algorithm: "ECDSA-P256-SHA256-P1363",
      signature_p1363_base64url: signature.toString("base64url"),
    },
  };
}

test("valid WebAuthn Platform receipt produces only a non-authorizing candidate", () => {
  const receipt = signedReceipt();
  const candidate = verifier().verify({ receipt, expected: expected(receipt) });
  assert.equal(candidate.schema_version, BOOTSTRAP_RELEASE_EXCEPTION_CANDIDATE_SCHEMA_VERSION);
  assert.equal(candidate.verification_status, "verified_non_authorizing_candidate");
  assert.equal(candidate.candidate, true);
  assert.equal(candidate.action_authorized, false);
  assert.equal(candidate.execution_authorized, false);
  assert.equal(candidate.host_action_authorized, false);
  assert.equal(candidate.core_join_authorized, false);
  assert.equal(candidate.consumption_authorized, false);
  assert.equal(candidate.allowed_action, "github.merge");
  assert.equal(candidate.sign_count, 1);
  assert.match(candidate.receipt_digest, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(candidate, "decision"), false);
  assert.equal(Object.hasOwn(candidate, "core_join_verdict"), false);
});

test("verification is stateless while nonce and exception binding prevent cross-request replay", () => {
  const receipt = signedReceipt();
  const first = verifier().verify({ receipt, expected: expected(receipt) });
  const second = verifier().verify({ receipt, expected: expected(receipt) });
  assert.deepEqual(second, first);
  assert.throws(() => verifier().verify({
    receipt,
    expected: expected(receipt, { nonce: "different-request-nonce" }),
  }), /nonce_mismatch/);
  assert.throws(() => verifier().verify({
    receipt: { ...receipt, exception_id: "bootstrap-exception-other" },
    expected: expected(receipt, { exception_id: "bootstrap-exception-other" }),
  }), /client_data_invalid|signature_invalid/);
});

test("cross-tenant, PR, repository and head mismatch fail closed", () => {
  const receipt = signedReceipt();
  for (const mismatch of [
    { tenant_id: "tenant-other" },
    { pr_number: 224 },
    { repository: "other-owner/other-repository" },
    { head_sha: "8".repeat(40) },
  ]) {
    assert.throws(() => verifier().verify({ receipt, expected: expected(receipt, mismatch) }), /_mismatch/);
  }
});

test("expired, future and over-15-minute receipts fail closed", () => {
  const expired = signedReceipt({
    issued_at: new Date(NOW - 10 * 60_000).toISOString(),
    expires_at: new Date(NOW - 1).toISOString(),
  });
  assert.throws(() => verifier().verify({ receipt: expired, expected: expected(expired) }),
    /expired_or_ttl_invalid/);
  const tooLong = signedReceipt({
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 15 * 60_000).toISOString(),
  });
  assert.throws(() => verifier().verify({ receipt: tooLong, expected: expected(tooLong) }),
    /expired_or_ttl_invalid/);
  const future = signedReceipt({
    issued_at: new Date(NOW + 31_000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
  });
  assert.throws(() => verifier().verify({ receipt: future, expected: expected(future) }),
    /expired_or_ttl_invalid/);
});

test("origin, RP ID, credential, UP/UV flags and ECDSA signature are pinned", () => {
  const receipt = signedReceipt();
  assert.throws(() => createBootstrapReleaseExceptionVerifier({
    origin: "https://other.example.net",
    rpId: RP_ID,
    credentialId: CREDENTIAL_ID,
    publicKey: KEYS.publicKey,
    authorityKeyId: KEY_ID,
  }), /rp_id_invalid/);
  assert.throws(() => verifier().verify({
    receipt: {
      ...receipt,
      authority_assertion: { ...receipt.authority_assertion, credential_id: crypto.randomBytes(32).toString("base64url") },
    },
    expected: expected(receipt),
  }), /credential_mismatch/);
  const noUv = signedReceipt({}, { flags: 0x01 });
  assert.throws(() => verifier().verify({ receipt: noUv, expected: expected(noUv) }),
    /user_presence_verification_required/);
  const forgedSignature = Buffer.from(receipt.authority_assertion.signature_der_base64url, "base64url");
  forgedSignature[forgedSignature.length - 1] ^= 0x01;
  assert.throws(() => verifier().verify({
    receipt: {
      ...receipt,
      authority_assertion: {
        ...receipt.authority_assertion,
        signature_der_base64url: forgedSignature.toString("base64url"),
      },
    },
    expected: expected(receipt),
  }), /signature_invalid/);
});

test("revoked, consumed, non-deadlock or broader-action receipts cannot become candidates", () => {
  for (const overrides of [
    { revoked_at: new Date(NOW - 1).toISOString() },
    { consumed_at: new Date(NOW - 1).toISOString() },
    { core_policy_classification: "NORMAL_RELEASE_BLOCKED" },
    { allowed_action: "render.deploy" },
    { max_uses: 2 },
  ]) {
    const receipt = signedReceipt(overrides);
    assert.throws(() => verifier().verify({ receipt, expected: expected(receipt) }),
      /receipt_invalid/);
  }
});

test("local-PIN P-256 P1363 receipt verifies as a non-authorizing candidate", () => {
  const receipt = localPinReceipt();
  const publicKeySpki = KEYS.publicKey.export({ type: "spki", format: "der" });
  const candidate = verifyLocalPinBootstrapReleaseException({
    receipt,
    expected: expected(receipt),
    publicKeySpki,
    nowMs: NOW,
  });
  assert.equal(candidate.schema_version, BOOTSTRAP_RELEASE_EXCEPTION_CANDIDATE_SCHEMA_VERSION);
  assert.equal(candidate.verification_status, "verified_non_authorizing_candidate");
  assert.equal(candidate.authority_provider, "local_pin");
  assert.equal(candidate.signature_algorithm, "ECDSA-P256-SHA256-P1363");
  assert.equal(candidate.action_authorized, false);
  assert.equal(candidate.host_action_authorized, false);
  assert.equal(candidate.core_join_authorized, false);
  assert.equal(candidate.consumption_authorized, false);
});

test("local-PIN verifier binds tenant, work, repository, PR, SHA, action, digests and nonce", () => {
  const receipt = localPinReceipt();
  const publicKeySpki = KEYS.publicKey.export({ type: "spki", format: "der" });
  for (const mismatch of [
    { tenant_id: "tenant-other" },
    { work_id: "work-other" },
    { repository: "other/repository" },
    { pr_number: 224 },
    { head_sha: "8".repeat(40) },
    { allowed_action: "render.deploy" },
    { required_checks_digest: digest("other-checks") },
    { nonce: "different-bootstrap-nonce" },
  ]) {
    assert.throws(() => verifyLocalPinBootstrapReleaseException({
      receipt,
      expected: expected(receipt, mismatch),
      publicKeySpki,
      nowMs: NOW,
    }), /_mismatch/);
  }
});

test("local-PIN verifier denies expiry, forbidden state and non-deadlock classification", () => {
  const publicKeySpki = KEYS.publicKey.export({ type: "spki", format: "der" });
  const expired = localPinReceipt({
    issued_at: new Date(NOW - 10 * 60_000).toISOString(),
    expires_at: new Date(NOW - 1).toISOString(),
  });
  assert.throws(() => verifyLocalPinBootstrapReleaseException({
    receipt: expired, expected: expected(expired), publicKeySpki, nowMs: NOW,
  }), /expired_or_ttl_invalid/);
  for (const overrides of [
    { max_uses: 2 },
    { consumed_at: new Date(NOW - 1).toISOString() },
    { revoked_at: new Date(NOW - 1).toISOString() },
    { core_policy_classification: "NORMAL_RELEASE_BLOCKED" },
  ]) {
    const receipt = localPinReceipt(overrides);
    assert.throws(() => verifyLocalPinBootstrapReleaseException({
      receipt, expected: expected(receipt), publicKeySpki, nowMs: NOW,
    }), /receipt_invalid/);
  }
});

test("local-PIN verifier accepts trust material only from the resolver argument and denies forgery", () => {
  const receipt = localPinReceipt();
  const publicKeySpki = KEYS.publicKey.export({ type: "spki", format: "der" });
  const otherKeys = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  assert.throws(() => verifyLocalPinBootstrapReleaseException({
    receipt,
    expected: expected(receipt),
    publicKeySpki: otherKeys.publicKey.export({ type: "spki", format: "der" }),
    nowMs: NOW,
  }), /signature_invalid/);
  const signature = Buffer.from(receipt.authority_assertion.signature_p1363_base64url, "base64url");
  signature[0] ^= 0x01;
  assert.throws(() => verifyLocalPinBootstrapReleaseException({
    receipt: {
      ...receipt,
      authority_assertion: {
        ...receipt.authority_assertion,
        signature_p1363_base64url: signature.toString("base64url"),
      },
    },
    expected: expected(receipt),
    publicKeySpki,
    nowMs: NOW,
  }), /signature_invalid/);
  assert.throws(() => verifyLocalPinBootstrapReleaseException({
    receipt: { ...receipt, public_key_spki: publicKeySpki.toString("base64") },
    expected: expected(receipt),
    publicKeySpki,
    nowMs: NOW,
  }), /receipt_schema_invalid/);
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  BRA_GENESIS_RECEIPT_SCHEMA_VERSION,
  BRA_INDEPENDENT_READBACK_SCHEMA_VERSION,
  BRA_TRUST_BUNDLE_SCHEMA_VERSION,
  CORE_GENESIS_RECORD_CANDIDATE_SCHEMA_VERSION,
  braCanonicalJson,
  braSha256,
  verifyBootstrapRecoveryAuthority,
} from "../src/bootstrapRecoveryAuthority.js";

const RECEIPT_SIGNATURE_CONTEXT = "bra-genesis-receipt-v1\0";
const KEY_ID = "bra-genesis-key-20260808";
const TARGET_COMMIT = "8d3a2bdf77a3a62e14cd014833b065594ee01b39";

function independentCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(independentCanonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${independentCanonical(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function independentDigest(value) {
  return crypto.createHash("sha256").update(independentCanonical(value), "utf8").digest("hex");
}

function signReceipt(receipt, privateKey) {
  const { signature: _signature, ...unsigned } = receipt;
  const bytes = Buffer.from(`${RECEIPT_SIGNATURE_CONTEXT}${independentCanonical(unsigned)}`, "utf8");
  receipt.signature = {
    algorithm: "Ed25519",
    key_id: receipt.key_id,
    value_base64url: crypto.sign(null, bytes, privateKey).toString("base64url"),
  };
}

function fixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const trustBundle = {
    schema_version: BRA_TRUST_BUNDLE_SCHEMA_VERSION,
    key_id: KEY_ID,
    algorithm: "Ed25519",
    public_key_spki_base64: publicKeyDer.toString("base64"),
    public_key_sha256: crypto.createHash("sha256").update(publicKeyDer).digest("hex"),
    kms_hsm_attestation_digest: "c".repeat(64),
    created_at: "2026-08-08T09:00:00.000Z",
    approvals: [
      {
        role: "platform_owner",
        approver_id: "owner-platform-01",
        approved_at: "2026-08-08T09:01:00.000Z",
        approval_digest: "a".repeat(64),
      },
      {
        role: "security_owner",
        approver_id: "owner-security-01",
        approved_at: "2026-08-08T09:02:00.000Z",
        approval_digest: "b".repeat(64),
      },
    ],
  };
  const trustBundleDigest = independentDigest(trustBundle);
  const independentReadback = {
    schema_version: BRA_INDEPENDENT_READBACK_SCHEMA_VERSION,
    key_id: KEY_ID,
    algorithm: "Ed25519",
    public_key_sha256: trustBundle.public_key_sha256,
    kms_hsm_attestation_digest: trustBundle.kms_hsm_attestation_digest,
    trust_bundle_digest: trustBundleDigest,
    observer_id: "independent-reader-01",
    observed_at: "2026-08-08T09:03:00.000Z",
    tenant_id: "codexai",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    base_branch: "main",
    target_commit: TARGET_COMMIT,
    release_intent: "bootstrap_core_genesis_trust",
  };
  const independentReadbackDigest = independentDigest(independentReadback);
  const receipt = {
    schema_version: BRA_GENESIS_RECEIPT_SCHEMA_VERSION,
    key_id: KEY_ID,
    algorithm: "Ed25519",
    trust_bundle_digest: trustBundleDigest,
    tenant_id: independentReadback.tenant_id,
    repository: independentReadback.repository,
    base_branch: independentReadback.base_branch,
    target_commit: independentReadback.target_commit,
    release_intent: independentReadback.release_intent,
    independent_readback: independentReadback,
    independent_readback_digest: independentReadbackDigest,
    issued_at: "2026-08-08T09:04:00.000Z",
    signature: null,
  };
  signReceipt(receipt, privateKey);
  const expected = {
    tenant_id: receipt.tenant_id,
    repository: receipt.repository,
    base_branch: receipt.base_branch,
    target_commit: receipt.target_commit,
    release_intent: receipt.release_intent,
    key_id: KEY_ID,
    trust_bundle_digest: trustBundleDigest,
    independent_readback_digest: independentReadbackDigest,
  };
  return { trustBundle, receipt, expected, privateKey };
}

function verify({ trustBundle, receipt, expected }) {
  return verifyBootstrapRecoveryAuthority({
    trust_bundle: trustBundle,
    genesis_receipt: receipt,
    expected,
  });
}

function clonedFixture() {
  const value = fixture();
  return {
    ...value,
    trustBundle: structuredClone(value.trustBundle),
    receipt: structuredClone(value.receipt),
    expected: structuredClone(value.expected),
  };
}

test("verifies a pinned dual-control Ed25519 ceremony and emits one deterministic candidate", () => {
  const value = fixture();
  const first = verify(value);
  const second = verify(value);

  assert.deepEqual(first, second);
  assert.equal(first.schema_version, CORE_GENESIS_RECORD_CANDIDATE_SCHEMA_VERSION);
  assert.equal(first.verification_status, "verified_non_authorizing");
  assert.equal(first.execution_authorized, false);
  assert.equal(first.target_commit, TARGET_COMMIT);
  assert.equal(first.algorithm, "Ed25519");
  assert.equal(first.trust_bundle_digest, value.expected.trust_bundle_digest);
  assert.equal(first.independent_readback_digest, value.expected.independent_readback_digest);
  assert.deepEqual(first.approved_roles, ["platform_owner", "security_owner"]);
  assert.equal(first.genesis_receipt_digest, independentDigest(value.receipt));
  assert.equal(braCanonicalJson(value.trustBundle), independentCanonical(value.trustBundle));
  assert.equal(braSha256(value.trustBundle), independentDigest(value.trustBundle));
});

test("rejects receipt, binding, public-key, readback, and pinned-evidence tampering", () => {
  const cases = [
    {
      name: "receipt signature",
      mutate(value) {
        const tampered = Buffer.from(value.receipt.signature.value_base64url, "base64url");
        assert.equal(tampered.length, 64);
        tampered[0] ^= 0x01;
        value.receipt.signature.value_base64url = tampered.toString("base64url");
      },
      error: /bra_genesis_receipt_signature_invalid/,
    },
    {
      name: "receipt timestamp after signing",
      mutate(value) { value.receipt.issued_at = "2026-08-08T09:05:00.000Z"; },
      error: /bra_genesis_receipt_signature_invalid/,
    },
    {
      name: "public key digest",
      mutate(value) { value.trustBundle.public_key_sha256 = "d".repeat(64); },
      error: /bra_public_key_digest_mismatch/,
    },
    {
      name: "receipt key id",
      mutate(value) { value.receipt.key_id = "bra-attacker-key-0000001"; },
      error: /bra_key_id_mismatch/,
    },
    {
      name: "readback public key",
      mutate(value) { value.receipt.independent_readback.public_key_sha256 = "d".repeat(64); },
      error: /bra_readback_public_key_mismatch/,
    },
    {
      name: "trust-bundle approval evidence",
      mutate(value) { value.trustBundle.approvals[0].approval_digest = "d".repeat(64); },
      error: /bra_trust_bundle_digest_mismatch/,
    },
  ];

  for (const entry of cases) {
    const value = clonedFixture();
    entry.mutate(value);
    assert.throws(() => verify(value), entry.error, entry.name);
  }

  const repinnedByCaller = clonedFixture();
  repinnedByCaller.receipt.independent_readback.observer_id = "attacker-reader-02";
  repinnedByCaller.receipt.independent_readback_digest = independentDigest(
    repinnedByCaller.receipt.independent_readback,
  );
  signReceipt(repinnedByCaller.receipt, repinnedByCaller.privateKey);
  assert.throws(() => verify(repinnedByCaller), /bra_readback_not_pinned/);
});

test("binds every release coordinate from expected to receipt and from receipt to readback", () => {
  const bindingCases = [
    ["tenant_id", "other-tenant"],
    ["repository", "other-owner/other-repository"],
    ["base_branch", "release/genesis"],
    ["target_commit", "d".repeat(40)],
    ["release_intent", "bootstrap_core_genesis_trust_v2"],
  ];

  for (const [field, differentValue] of bindingCases) {
    const expectedMismatch = clonedFixture();
    expectedMismatch.expected[field] = differentValue;
    assert.throws(
      () => verify(expectedMismatch),
      new RegExp(`bra_${field}_mismatch`),
      `expected-to-receipt ${field}`,
    );

    const readbackMismatch = clonedFixture();
    readbackMismatch.receipt.independent_readback[field] = differentValue;
    assert.throws(
      () => verify(readbackMismatch),
      new RegExp(`bra_readback_${field}_mismatch`),
      `readback-to-receipt ${field}`,
    );
  }
});

test("rejects Git-invalid dot and lock branch components", () => {
  for (const branch of ["main.", "foo/.bar", "foo.lock/bar", "foo/bar.lock"]) {
    const value = clonedFixture();
    value.expected.base_branch = branch;
    assert.throws(() => verify(value), /bra_base_branch_invalid/, branch);
  }
});

test("requires two distinct approvals with exact roles and strict timestamp order", () => {
  const missing = clonedFixture();
  missing.trustBundle.approvals.pop();
  assert.throws(() => verify(missing), /bra_approval_quorum_invalid/);

  const duplicateIdentity = clonedFixture();
  duplicateIdentity.trustBundle.approvals[1].approver_id = duplicateIdentity.trustBundle.approvals[0].approver_id;
  assert.throws(() => verify(duplicateIdentity), /bra_approvals_not_distinct/);

  const duplicateEvidence = clonedFixture();
  duplicateEvidence.trustBundle.approvals[1].approval_digest = duplicateEvidence.trustBundle.approvals[0].approval_digest;
  assert.throws(() => verify(duplicateEvidence), /bra_approvals_not_distinct/);

  const duplicateRole = clonedFixture();
  duplicateRole.trustBundle.approvals[1].role = "platform_owner";
  assert.throws(() => verify(duplicateRole), /bra_approval_roles_invalid/);

  const reversedRoles = clonedFixture();
  reversedRoles.trustBundle.approvals.reverse();
  assert.throws(() => verify(reversedRoles), /bra_approval_roles_invalid/);

  const outOfOrder = clonedFixture();
  outOfOrder.trustBundle.approvals[1].approved_at = outOfOrder.trustBundle.approvals[0].approved_at;
  assert.throws(() => verify(outOfOrder), /bra_timestamp_order_invalid/);

  const nonIndependent = clonedFixture();
  nonIndependent.receipt.independent_readback.observer_id = nonIndependent.trustBundle.approvals[0].approver_id;
  nonIndependent.receipt.independent_readback_digest = independentDigest(nonIndependent.receipt.independent_readback);
  nonIndependent.expected.independent_readback_digest = nonIndependent.receipt.independent_readback_digest;
  signReceipt(nonIndependent.receipt, nonIndependent.privateKey);
  assert.throws(() => verify(nonIndependent), /bra_readback_not_independent/);

  const readbackTooEarly = clonedFixture();
  readbackTooEarly.receipt.independent_readback.observed_at = "2026-08-08T09:01:30.000Z";
  readbackTooEarly.receipt.independent_readback_digest = independentDigest(readbackTooEarly.receipt.independent_readback);
  readbackTooEarly.expected.independent_readback_digest = readbackTooEarly.receipt.independent_readback_digest;
  signReceipt(readbackTooEarly.receipt, readbackTooEarly.privateKey);
  assert.throws(() => verify(readbackTooEarly), /bra_timestamp_order_invalid/);
});

test("rejects unknown, private, and secret-bearing fields at every artifact boundary", () => {
  const cases = [
    {
      name: "unknown trust-bundle field",
      mutate(value) { value.trustBundle.note = "not-in-schema"; },
      error: /bra_trust_bundle_schema_invalid/,
    },
    {
      name: "private key injection",
      mutate(value) { value.trustBundle.private_key = "redacted"; },
      error: /bra_secret_material_forbidden/,
    },
    {
      name: "nested approval secret",
      mutate(value) { value.trustBundle.approvals[0].client_secret = "redacted"; },
      error: /bra_secret_material_forbidden/,
    },
    {
      name: "receipt HMAC field",
      mutate(value) { value.receipt.hmac = "redacted"; },
      error: /bra_secret_material_forbidden/,
    },
    {
      name: "signature credential",
      mutate(value) { value.receipt.signature.credential = "redacted"; },
      error: /bra_secret_material_forbidden/,
    },
    {
      name: "unknown readback field",
      mutate(value) { value.receipt.independent_readback.evidence_url = "https://example.invalid"; },
      error: /bra_readback_schema_invalid/,
    },
    {
      name: "unexpected host-native signature",
      mutate(value) { value.receipt.host_native_signature = "legacy-value"; },
      error: /bra_genesis_receipt_schema_invalid/,
    },
  ];

  for (const entry of cases) {
    const value = clonedFixture();
    entry.mutate(value);
    assert.throws(() => verify(value), entry.error, entry.name);
  }
});

test("validates the root request before access and rejects root field injection", () => {
  const rootCases = [
    ["unknown", "unexpected_field", /bra_verification_request_schema_invalid/],
    ["private", "private_key", /bra_secret_material_forbidden/],
    ["HMAC", "hmac", /bra_secret_material_forbidden/],
    ["secret", "client_secret", /bra_secret_material_forbidden/],
  ];

  for (const [name, field, error] of rootCases) {
    const value = fixture();
    const request = {
      trust_bundle: value.trustBundle,
      genesis_receipt: value.receipt,
      expected: value.expected,
      [field]: "redacted",
    };
    assert.throws(() => verifyBootstrapRecoveryAuthority(request), error, name);
  }

  const missing = fixture();
  assert.throws(() => verifyBootstrapRecoveryAuthority({
    trust_bundle: missing.trustBundle,
    genesis_receipt: missing.receipt,
  }), /bra_verification_request_schema_invalid/);

  const accessorValue = fixture();
  let getterInvoked = false;
  const accessorRequest = {
    genesis_receipt: accessorValue.receipt,
    expected: accessorValue.expected,
  };
  Object.defineProperty(accessorRequest, "trust_bundle", {
    enumerable: true,
    get() {
      getterInvoked = true;
      return accessorValue.trustBundle;
    },
  });
  assert.throws(
    () => verifyBootstrapRecoveryAuthority(accessorRequest),
    /bra_input_not_public_data/,
  );
  assert.equal(getterInvoked, false);
});

test("accepts Ed25519 only and rejects HMAC, host-native, and non-canonical encodings", () => {
  const algorithms = ["HMAC-SHA256", "Ed25519+HMAC-SHA256", "host_native_closure_attestation_v1", "ed25519"];
  for (const algorithm of algorithms) {
    const receiptAlgorithm = clonedFixture();
    receiptAlgorithm.receipt.signature.algorithm = algorithm;
    assert.throws(() => verify(receiptAlgorithm), /bra_algorithm_not_supported/, algorithm);
  }

  const trustAlgorithm = clonedFixture();
  trustAlgorithm.trustBundle.algorithm = "HMAC-SHA256";
  assert.throws(() => verify(trustAlgorithm), /bra_algorithm_not_supported/);

  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsaDer = rsa.publicKey.export({ type: "spki", format: "der" });
  const wrongKeyType = clonedFixture();
  wrongKeyType.trustBundle.public_key_spki_base64 = rsaDer.toString("base64");
  wrongKeyType.trustBundle.public_key_sha256 = crypto.createHash("sha256").update(rsaDer).digest("hex");
  assert.throws(() => verify(wrongKeyType), /bra_algorithm_not_supported/);

  const nonCanonicalTimestamp = clonedFixture();
  nonCanonicalTimestamp.trustBundle.created_at = "2026-08-08T09:00:00Z";
  assert.throws(() => verify(nonCanonicalTimestamp), /bra_trust_bundle_timestamp_invalid/);

  const paddedSignature = clonedFixture();
  paddedSignature.receipt.signature.value_base64url += "==";
  assert.throws(() => verify(paddedSignature), /bra_signature_encoding_invalid/);
});

test("the candidate is public-data-only, stable, and incapable of authorizing execution", () => {
  const value = fixture();
  const candidate = verify(value);
  const serialized = JSON.stringify(candidate);

  assert.equal(candidate.execution_authorized, false);
  assert.equal(Object.values(candidate).includes(true), false);
  assert.equal(Object.hasOwn(candidate, "signature"), false);
  assert.equal(Object.hasOwn(candidate, "public_key_spki_base64"), false);
  assert.equal(Object.hasOwn(candidate, "approver_id"), false);
  assert.doesNotMatch(serialized, /private|secret|hmac|host_native/i);
  assert.deepEqual(Object.keys(candidate), [
    "schema_version",
    "verification_status",
    "execution_authorized",
    "tenant_id",
    "repository",
    "base_branch",
    "target_commit",
    "release_intent",
    "key_id",
    "algorithm",
    "public_key_sha256",
    "kms_hsm_attestation_digest",
    "trust_bundle_digest",
    "independent_readback_digest",
    "genesis_receipt_digest",
    "approved_roles",
    "approval_digests",
    "created_at",
    "observed_at",
    "issued_at",
  ]);
});

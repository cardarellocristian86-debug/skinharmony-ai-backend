import crypto from "node:crypto";

export const BRA_TRUST_BUNDLE_SCHEMA_VERSION = "bra_trust_bundle_v1";
export const BRA_GENESIS_RECEIPT_SCHEMA_VERSION = "bra_genesis_receipt_v1";
export const BRA_INDEPENDENT_READBACK_SCHEMA_VERSION = "bra_independent_readback_v1";
export const CORE_GENESIS_RECORD_CANDIDATE_SCHEMA_VERSION = "core_genesis_record_candidate_v1";

const ED25519 = "Ed25519";
const RECEIPT_SIGNATURE_CONTEXT = "bra-genesis-receipt-v1\0";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{6,126}[A-Za-z0-9]$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const TARGET_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const RELEASE_INTENT_PATTERN = /^[a-z][a-z0-9_]{2,127}$/;
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CANONICAL_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CANONICAL_BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const FORBIDDEN_FIELD_PATTERN = /(^|_)(?:private(?:_key)?|secret|password|passphrase|credential|credentials|token|seed|mnemonic|hmac|mac|shared_key|symmetric_key|api_key|access_key|client_secret)(?:_|$)/i;

const TRUST_BUNDLE_FIELDS = [
  "algorithm",
  "approvals",
  "created_at",
  "key_id",
  "kms_hsm_attestation_digest",
  "public_key_sha256",
  "public_key_spki_base64",
  "schema_version",
];
const APPROVAL_FIELDS = ["approval_digest", "approved_at", "approver_id", "role"];
const RECEIPT_FIELDS = [
  "algorithm",
  "base_branch",
  "independent_readback",
  "independent_readback_digest",
  "issued_at",
  "key_id",
  "release_intent",
  "repository",
  "schema_version",
  "signature",
  "target_commit",
  "tenant_id",
  "trust_bundle_digest",
];
const READBACK_FIELDS = [
  "algorithm",
  "base_branch",
  "key_id",
  "kms_hsm_attestation_digest",
  "observed_at",
  "observer_id",
  "public_key_sha256",
  "release_intent",
  "repository",
  "schema_version",
  "target_commit",
  "tenant_id",
  "trust_bundle_digest",
];
const SIGNATURE_FIELDS = ["algorithm", "key_id", "value_base64url"];
const EXPECTED_FIELDS = [
  "base_branch",
  "independent_readback_digest",
  "key_id",
  "release_intent",
  "repository",
  "target_commit",
  "tenant_id",
  "trust_bundle_digest",
];

function fail(code) {
  throw new Error(code);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertDataOnly(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (seen.has(value) || Object.getOwnPropertySymbols(value).length) fail("bra_input_not_public_data");
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expectedNames = [...value.keys()].map(String).concat("length").sort();
    const actualNames = Object.keys(descriptors).sort();
    if (actualNames.length !== expectedNames.length
      || actualNames.some((name, index) => name !== expectedNames[index])) fail("bra_input_not_public_data");
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) fail("bra_input_not_public_data");
      if (FORBIDDEN_FIELD_PATTERN.test(key)) fail("bra_secret_material_forbidden");
      if (key !== "length") assertDataOnly(descriptor.value, seen);
    }
    return;
  }
  if (!isPlainObject(value) || seen.has(value) || Object.getOwnPropertySymbols(value).length) {
    fail("bra_input_not_public_data");
  }
  seen.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) fail("bra_input_not_public_data");
    if (FORBIDDEN_FIELD_PATTERN.test(key)) fail("bra_secret_material_forbidden");
    assertDataOnly(descriptor.value, seen);
  }
}

function canonical(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) fail("bra_canonical_value_invalid");
    seen.add(value);
    const result = `[${value.map((entry) => canonical(entry, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (!isPlainObject(value) || seen.has(value) || Object.getOwnPropertySymbols(value).length) {
    fail("bra_canonical_value_invalid");
  }
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries = Object.keys(descriptors).sort().map((key) => {
    const descriptor = descriptors[key];
    if (!Object.prototype.hasOwnProperty.call(descriptor, "value") || descriptor.value === undefined) {
      fail("bra_canonical_value_invalid");
    }
    return `${JSON.stringify(key)}:${canonical(descriptor.value, seen)}`;
  });
  seen.delete(value);
  return `{${entries.join(",")}}`;
}

export function braCanonicalJson(value) {
  return canonical(value, new WeakSet());
}

export function braSha256(value) {
  return crypto.createHash("sha256").update(braCanonicalJson(value), "utf8").digest("hex");
}

function exactFields(value, expectedFields, code) {
  if (!isPlainObject(value)) fail(code);
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...expectedFields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) fail(code);
}

function exactString(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}

function canonicalTimestamp(value, code) {
  exactString(value, CANONICAL_TIMESTAMP_PATTERN, code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(code);
  return parsed;
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assertEqual(left, right, code) {
  if (!safeEqual(left, right)) fail(code);
}

function decodeCanonicalBase64(value, code) {
  exactString(value, CANONICAL_BASE64_PATTERN, code);
  if (!value.length || value.length % 4 !== 0) fail(code);
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || decoded.toString("base64") !== value) fail(code);
  return decoded;
}

function decodeEd25519Signature(value) {
  exactString(value, CANONICAL_BASE64URL_PATTERN, "bra_signature_encoding_invalid");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 64 || decoded.toString("base64url") !== value) fail("bra_signature_encoding_invalid");
  return decoded;
}

function validateRepository(value) {
  exactString(value, REPOSITORY_PATTERN, "bra_repository_invalid");
  if (value.includes("..") || value.endsWith(".git")) fail("bra_repository_invalid");
}

function validateBranch(value) {
  exactString(value, BRANCH_PATTERN, "bra_base_branch_invalid");
  const segments = value.split("/");
  if (
    value.includes("..")
    || value.includes("//")
    || value.endsWith("/")
    || value.endsWith(".")
    || segments.some((segment) => segment.startsWith(".") || segment.endsWith(".lock"))
  ) {
    fail("bra_base_branch_invalid");
  }
}

function validateBinding(binding) {
  exactString(binding.tenant_id, TENANT_ID_PATTERN, "bra_tenant_invalid");
  validateRepository(binding.repository);
  validateBranch(binding.base_branch);
  exactString(binding.target_commit, TARGET_COMMIT_PATTERN, "bra_target_commit_invalid");
  exactString(binding.release_intent, RELEASE_INTENT_PATTERN, "bra_release_intent_invalid");
}

function validateExpected(expected) {
  exactFields(expected, EXPECTED_FIELDS, "bra_expected_binding_schema_invalid");
  validateBinding(expected);
  exactString(expected.key_id, KEY_ID_PATTERN, "bra_key_id_invalid");
  exactString(expected.trust_bundle_digest, SHA256_PATTERN, "bra_trust_bundle_digest_invalid");
  exactString(expected.independent_readback_digest, SHA256_PATTERN, "bra_readback_digest_invalid");
}

function validateTrustBundle(trustBundle) {
  exactFields(trustBundle, TRUST_BUNDLE_FIELDS, "bra_trust_bundle_schema_invalid");
  if (trustBundle.schema_version !== BRA_TRUST_BUNDLE_SCHEMA_VERSION) fail("bra_trust_bundle_schema_invalid");
  if (trustBundle.algorithm !== ED25519) fail("bra_algorithm_not_supported");
  exactString(trustBundle.key_id, KEY_ID_PATTERN, "bra_key_id_invalid");
  exactString(trustBundle.public_key_sha256, SHA256_PATTERN, "bra_public_key_digest_invalid");
  exactString(trustBundle.kms_hsm_attestation_digest, SHA256_PATTERN, "bra_kms_hsm_attestation_digest_invalid");
  const createdAt = canonicalTimestamp(trustBundle.created_at, "bra_trust_bundle_timestamp_invalid");

  if (!Array.isArray(trustBundle.approvals) || trustBundle.approvals.length !== 2) {
    fail("bra_approval_quorum_invalid");
  }
  const requiredRoles = ["platform_owner", "security_owner"];
  const approvals = trustBundle.approvals.map((approval, index) => {
    exactFields(approval, APPROVAL_FIELDS, "bra_approval_schema_invalid");
    if (approval.role !== requiredRoles[index]) fail("bra_approval_roles_invalid");
    exactString(approval.approver_id, OPAQUE_ID_PATTERN, "bra_approver_id_invalid");
    exactString(approval.approval_digest, SHA256_PATTERN, "bra_approval_digest_invalid");
    const approvedAt = canonicalTimestamp(approval.approved_at, "bra_approval_timestamp_invalid");
    return { ...approval, approvedAt };
  });
  if (
    approvals[0].approver_id === approvals[1].approver_id
    || approvals[0].approval_digest === approvals[1].approval_digest
  ) fail("bra_approvals_not_distinct");
  if (!(createdAt < approvals[0].approvedAt && approvals[0].approvedAt < approvals[1].approvedAt)) {
    fail("bra_timestamp_order_invalid");
  }

  const publicKeyDer = decodeCanonicalBase64(
    trustBundle.public_key_spki_base64,
    "bra_public_key_encoding_invalid",
  );
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
  } catch {
    fail("bra_public_key_invalid");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") fail("bra_algorithm_not_supported");
  const canonicalDer = publicKey.export({ format: "der", type: "spki" });
  if (!Buffer.isBuffer(canonicalDer) || !canonicalDer.equals(publicKeyDer)) fail("bra_public_key_encoding_invalid");
  const publicKeyDigest = crypto.createHash("sha256").update(publicKeyDer).digest("hex");
  assertEqual(publicKeyDigest, trustBundle.public_key_sha256, "bra_public_key_digest_mismatch");

  return {
    publicKey,
    createdAt,
    platformApprovedAt: approvals[0].approvedAt,
    securityApprovedAt: approvals[1].approvedAt,
  };
}

function validateReadback(readback) {
  exactFields(readback, READBACK_FIELDS, "bra_readback_schema_invalid");
  if (readback.schema_version !== BRA_INDEPENDENT_READBACK_SCHEMA_VERSION) fail("bra_readback_schema_invalid");
  if (readback.algorithm !== ED25519) fail("bra_algorithm_not_supported");
  exactString(readback.key_id, KEY_ID_PATTERN, "bra_key_id_invalid");
  exactString(readback.public_key_sha256, SHA256_PATTERN, "bra_public_key_digest_invalid");
  exactString(readback.kms_hsm_attestation_digest, SHA256_PATTERN, "bra_kms_hsm_attestation_digest_invalid");
  exactString(readback.trust_bundle_digest, SHA256_PATTERN, "bra_trust_bundle_digest_invalid");
  exactString(readback.observer_id, OPAQUE_ID_PATTERN, "bra_readback_observer_invalid");
  validateBinding(readback);
  return canonicalTimestamp(readback.observed_at, "bra_readback_timestamp_invalid");
}

function unsignedReceipt(receipt) {
  const { signature: _signature, ...unsigned } = receipt;
  return unsigned;
}

function validateReceipt(receipt) {
  exactFields(receipt, RECEIPT_FIELDS, "bra_genesis_receipt_schema_invalid");
  if (receipt.schema_version !== BRA_GENESIS_RECEIPT_SCHEMA_VERSION) fail("bra_genesis_receipt_schema_invalid");
  if (receipt.algorithm !== ED25519) fail("bra_algorithm_not_supported");
  exactString(receipt.key_id, KEY_ID_PATTERN, "bra_key_id_invalid");
  exactString(receipt.trust_bundle_digest, SHA256_PATTERN, "bra_trust_bundle_digest_invalid");
  exactString(receipt.independent_readback_digest, SHA256_PATTERN, "bra_readback_digest_invalid");
  validateBinding(receipt);
  const issuedAt = canonicalTimestamp(receipt.issued_at, "bra_genesis_receipt_timestamp_invalid");
  exactFields(receipt.signature, SIGNATURE_FIELDS, "bra_signature_schema_invalid");
  if (receipt.signature.algorithm !== ED25519) fail("bra_algorithm_not_supported");
  exactString(receipt.signature.key_id, KEY_ID_PATTERN, "bra_key_id_invalid");
  const signatureBytes = decodeEd25519Signature(receipt.signature.value_base64url);
  const observedAt = validateReadback(receipt.independent_readback);
  return { issuedAt, observedAt, signatureBytes };
}

function bindReceipt({ trustBundle, receipt, expected, trustBundleDigest, readbackDigest }) {
  const bindingFields = ["tenant_id", "repository", "base_branch", "target_commit", "release_intent"];
  for (const field of bindingFields) {
    assertEqual(receipt[field], expected[field], `bra_${field}_mismatch`);
    assertEqual(receipt.independent_readback[field], receipt[field], `bra_readback_${field}_mismatch`);
  }
  assertEqual(trustBundle.key_id, expected.key_id, "bra_key_id_mismatch");
  assertEqual(receipt.key_id, trustBundle.key_id, "bra_key_id_mismatch");
  assertEqual(receipt.signature.key_id, trustBundle.key_id, "bra_key_id_mismatch");
  assertEqual(receipt.independent_readback.key_id, trustBundle.key_id, "bra_key_id_mismatch");
  assertEqual(receipt.algorithm, trustBundle.algorithm, "bra_algorithm_mismatch");
  assertEqual(receipt.independent_readback.algorithm, trustBundle.algorithm, "bra_algorithm_mismatch");
  assertEqual(receipt.trust_bundle_digest, trustBundleDigest, "bra_trust_bundle_digest_mismatch");
  assertEqual(receipt.independent_readback.trust_bundle_digest, trustBundleDigest, "bra_trust_bundle_digest_mismatch");
  assertEqual(expected.trust_bundle_digest, trustBundleDigest, "bra_trust_bundle_not_pinned");
  assertEqual(receipt.independent_readback.public_key_sha256, trustBundle.public_key_sha256,
    "bra_readback_public_key_mismatch");
  assertEqual(receipt.independent_readback.kms_hsm_attestation_digest, trustBundle.kms_hsm_attestation_digest,
    "bra_readback_attestation_mismatch");
  assertEqual(receipt.independent_readback_digest, readbackDigest, "bra_readback_digest_mismatch");
  assertEqual(expected.independent_readback_digest, readbackDigest, "bra_readback_not_pinned");
}

/**
 * Verifies only the public artifacts produced by an external dual-control BRA
 * ceremony. The pinned digests in `expected` must come from that independent
 * control plane. A valid result is evidence for a later Core decision and is
 * deliberately never an execution authorization.
 */
export function verifyBootstrapRecoveryAuthority(input = {}) {
  assertDataOnly(input);
  exactFields(
    input,
    ["trust_bundle", "genesis_receipt", "expected"],
    "bra_verification_request_schema_invalid",
  );
  const { trust_bundle: trustBundle, genesis_receipt: receipt, expected } = input;
  validateExpected(expected);
  const trust = validateTrustBundle(trustBundle);
  const receiptState = validateReceipt(receipt);
  const trustBundleDigest = braSha256(trustBundle);
  const readbackDigest = braSha256(receipt.independent_readback);

  bindReceipt({ trustBundle, receipt, expected, trustBundleDigest, readbackDigest });
  const approvalIds = new Set(trustBundle.approvals.map((approval) => approval.approver_id));
  if (approvalIds.has(receipt.independent_readback.observer_id)) fail("bra_readback_not_independent");
  if (!(trust.securityApprovedAt < receiptState.observedAt && receiptState.observedAt < receiptState.issuedAt)) {
    fail("bra_timestamp_order_invalid");
  }

  const signaturePayload = Buffer.from(
    `${RECEIPT_SIGNATURE_CONTEXT}${braCanonicalJson(unsignedReceipt(receipt))}`,
    "utf8",
  );
  let signatureValid = false;
  try {
    signatureValid = crypto.verify(null, signaturePayload, trust.publicKey, receiptState.signatureBytes);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) fail("bra_genesis_receipt_signature_invalid");

  return {
    schema_version: CORE_GENESIS_RECORD_CANDIDATE_SCHEMA_VERSION,
    verification_status: "verified_non_authorizing",
    execution_authorized: false,
    tenant_id: receipt.tenant_id,
    repository: receipt.repository,
    base_branch: receipt.base_branch,
    target_commit: receipt.target_commit,
    release_intent: receipt.release_intent,
    key_id: trustBundle.key_id,
    algorithm: ED25519,
    public_key_sha256: trustBundle.public_key_sha256,
    kms_hsm_attestation_digest: trustBundle.kms_hsm_attestation_digest,
    trust_bundle_digest: trustBundleDigest,
    independent_readback_digest: readbackDigest,
    genesis_receipt_digest: braSha256(receipt),
    approved_roles: trustBundle.approvals.map((approval) => approval.role),
    approval_digests: trustBundle.approvals.map((approval) => approval.approval_digest),
    created_at: trustBundle.created_at,
    observed_at: receipt.independent_readback.observed_at,
    issued_at: receipt.issued_at,
  };
}

import crypto from "node:crypto";

export const NYRA_WORK_AUTOMATION_RECEIPT_TYPES = Object.freeze([
  "nyra_immutable_intent_anchor_v1",
  "nyra_signed_builder_plan_v1",
  "host_native_action_completion_receipt_v1",
  "host_native_action_reconciliation_receipt_v1",
  "nyra_internal_capability_receipt_v1",
  "nyra_commit_attestation_v2",
  "nyra_ci_verification_attestation_v2",
  "nyra_criterion_proof_policy_v1",
  "nyra_ci_criterion_proofs_v1",
  "nyra_host_native_core_join_compatibility_v1",
  "nyra_final_criterion_proof_v1",
  "intent_final_acceptance_proof_v1",
]);

const DIGEST = /^[a-f0-9]{64}$/;
const SIGNATURE = /^nyr_[a-f0-9]{64}$/;

export function nyraCanonical(value) {
  if (Array.isArray(value)) return value.map(nyraCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) =>
    value[key] === undefined ? [] : [[key, nyraCanonical(value[key])]]));
}

export function nyraDigest(value) {
  return crypto.createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(nyraCanonical(value)))
    .digest("hex");
}

function fail(code) { throw new Error(code); }
function text(value, code, maximum = 500) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum || normalized.includes("\u0000")) fail(code);
  return normalized;
}
function exactObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}
function instant(value, code) {
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) fail(code);
  return new Date(parsed).toISOString();
}
function key(secret) {
  const normalized = String(secret ?? "");
  if (Buffer.byteLength(normalized, "utf8") < 32) fail("nyra_receipt_signing_secret_invalid");
  return normalized;
}

export function createNyraSignedReceipt(payload, {
  secret,
  keyId = "nyra-work-automation-v1",
  now = () => Date.now(),
} = {}) {
  const input = exactObject(payload, "nyra_receipt_payload_invalid");
  const schemaVersion = text(input.schema_version, "nyra_receipt_schema_invalid", 120);
  if (!NYRA_WORK_AUTOMATION_RECEIPT_TYPES.includes(schemaVersion)) fail("nyra_receipt_schema_invalid");
  const issuedAt = input.issued_at ? instant(input.issued_at, "nyra_receipt_issued_at_invalid") :
    new Date(typeof now === "function" ? now() : now).toISOString();
  const unsigned = nyraCanonical({ ...input, issued_at: issuedAt, key_id: text(keyId, "nyra_receipt_key_id_invalid", 160) });
  delete unsigned.signature;
  delete unsigned.receipt_digest;
  const receiptDigest = nyraDigest(unsigned);
  const signature = `nyr_${crypto.createHmac("sha256", key(secret))
    .update(`nyra-work-automation-receipt-v1\u0000${receiptDigest}`)
    .digest("hex")}`;
  return Object.freeze({ ...unsigned, receipt_digest: receiptDigest, signature });
}

export function verifyNyraSignedReceipt(receipt, {
  secret,
  expectedSchemaVersion,
  expected = {},
  now = () => Date.now(),
  maximumAgeMs = 15 * 60_000,
  maximumFutureSkewMs = 30_000,
} = {}) {
  const value = exactObject(receipt, "nyra_receipt_invalid");
  if (!NYRA_WORK_AUTOMATION_RECEIPT_TYPES.includes(value.schema_version)) fail("nyra_receipt_schema_invalid");
  if (expectedSchemaVersion && value.schema_version !== expectedSchemaVersion) fail("nyra_receipt_schema_mismatch");
  if (!DIGEST.test(String(value.receipt_digest || "")) || !SIGNATURE.test(String(value.signature || ""))) {
    fail("nyra_receipt_integrity_invalid");
  }
  const unsigned = { ...value };
  delete unsigned.signature;
  delete unsigned.receipt_digest;
  const receiptDigest = nyraDigest(unsigned);
  if (receiptDigest !== value.receipt_digest) fail("nyra_receipt_integrity_invalid");
  const expectedSignature = `nyr_${crypto.createHmac("sha256", key(secret))
    .update(`nyra-work-automation-receipt-v1\u0000${receiptDigest}`)
    .digest("hex")}`;
  const left = Buffer.from(expectedSignature);
  const right = Buffer.from(value.signature);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) fail("nyra_receipt_signature_invalid");
  const current = Number(typeof now === "function" ? now() : now);
  const issued = Date.parse(value.issued_at || "");
  if (!Number.isFinite(issued) || issued > current + maximumFutureSkewMs || current - issued > maximumAgeMs) {
    fail("nyra_receipt_expired");
  }
  for (const [field, expectedValue] of Object.entries(expected || {})) {
    if (expectedValue !== undefined && nyraDigest(value[field]) !== nyraDigest(expectedValue)) {
      fail(`nyra_receipt_binding_mismatch:${field}`);
    }
  }
  return Object.freeze(structuredClone(value));
}

export function createNyraReceiptSigner(options = {}) {
  return Object.freeze({
    sign: (payload) => createNyraSignedReceipt(payload, options),
    verify: (receipt, verification = {}) => verifyNyraSignedReceipt(receipt, { ...options, ...verification }),
  });
}

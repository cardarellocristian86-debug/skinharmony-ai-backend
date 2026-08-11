import crypto from "node:crypto";

export const BOOTSTRAP_RELEASE_EXCEPTION_SCHEMA_VERSION = "bootstrap_release_exception_v1";
export const BOOTSTRAP_RELEASE_EXCEPTION_CANDIDATE_SCHEMA_VERSION =
  "bootstrap_release_exception_candidate_v1";
export const BOOTSTRAP_RELEASE_EXCEPTION_CHALLENGE_DOMAIN =
  "bootstrap_release_exception_v1\0";
export const LOCAL_PIN_BOOTSTRAP_RELEASE_EXCEPTION_SIGNATURE_DOMAIN =
  "bootstrap_release_exception_v1:local_pin\0";

const MAX_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_FUTURE_SKEW_MS = 30_000;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA1_COMMIT = /^[a-f0-9]{40}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const TENANT = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const RECEIPT_FIELDS = Object.freeze([
  "allowed_action",
  "authority_assertion",
  "authority_key_id",
  "authority_provider",
  "consumed_at",
  "core_policy_classification",
  "core_policy_verdict_digest",
  "exception_id",
  "expires_at",
  "head_sha",
  "issued_at",
  "max_uses",
  "nonce",
  "owner_confirmation_digest",
  "post_deploy_obligations_digest",
  "pr_number",
  "repository",
  "required_checks_digest",
  "required_checks_results_digest",
  "revoked_at",
  "rollback_obligations_digest",
  "schema_version",
  "tenant_id",
  "work_id",
]);
const EXPECTED_FIELDS = Object.freeze([
  "allowed_action",
  "core_policy_verdict_digest",
  "exception_id",
  "head_sha",
  "nonce",
  "owner_confirmation_digest",
  "post_deploy_obligations_digest",
  "pr_number",
  "repository",
  "required_checks_digest",
  "required_checks_results_digest",
  "rollback_obligations_digest",
  "tenant_id",
  "work_id",
]);
const ASSERTION_FIELDS = Object.freeze([
  "authenticator_data_base64url",
  "client_data_json_base64url",
  "credential_id",
  "signature_der_base64url",
]);
const LOCAL_PIN_ASSERTION_FIELDS = Object.freeze([
  "algorithm",
  "signature_p1363_base64url",
]);

function fail(code) {
  throw new Error(code);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value, fields, code) {
  if (!isPlainObject(value)) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) fail(code);
  if (Object.values(descriptors).some((descriptor) =>
    !Object.prototype.hasOwnProperty.call(descriptor, "value") || descriptor.value === undefined)) fail(code);
}

function canonical(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) fail("bootstrap_release_exception_canonical_value_invalid");
    seen.add(value);
    const result = `[${value.map((entry) => canonical(entry, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (!isPlainObject(value) || seen.has(value) || Object.getOwnPropertySymbols(value).length) {
    fail("bootstrap_release_exception_canonical_value_invalid");
  }
  seen.add(value);
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, descriptor]) => {
      if (!Object.prototype.hasOwnProperty.call(descriptor, "value") || descriptor.value === undefined) {
        fail("bootstrap_release_exception_canonical_value_invalid");
      }
      return `${JSON.stringify(key)}:${canonical(descriptor.value, seen)}`;
    });
  seen.delete(value);
  return `{${entries.join(",")}}`;
}

export function bootstrapReleaseExceptionCanonicalJson(value) {
  return canonical(value);
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest();
}

function sha256Hex(value) {
  return sha256Bytes(value).toString("hex");
}

function unsignedReceipt(receipt) {
  if (!isPlainObject(receipt)) fail("bootstrap_release_exception_receipt_invalid");
  const { authority_assertion: _assertion, ...unsigned } = receipt;
  return unsigned;
}

export function bootstrapReleaseExceptionChallenge(receipt) {
  return sha256Bytes(Buffer.from(
    `${BOOTSTRAP_RELEASE_EXCEPTION_CHALLENGE_DOMAIN}${bootstrapReleaseExceptionCanonicalJson(unsignedReceipt(receipt))}`,
    "utf8",
  )).toString("base64url");
}

export function localPinBootstrapReleaseExceptionSigningPayload(receipt) {
  return Buffer.from(
    `${LOCAL_PIN_BOOTSTRAP_RELEASE_EXCEPTION_SIGNATURE_DOMAIN}${bootstrapReleaseExceptionCanonicalJson(unsignedReceipt(receipt))}`,
    "utf8",
  );
}

function decodeBase64url(value, code, { min = 1, max = 16_384 } = {}) {
  if (typeof value !== "string" || !BASE64URL.test(value)) fail(code);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < min || decoded.length > max || decoded.toString("base64url") !== value) fail(code);
  return decoded;
}

function identifier(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}

function digest(value, code) {
  return identifier(value, SHA256, code);
}

function timestamp(value, code) {
  identifier(value, ISO, code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail(code);
  return parsed;
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateRepository(value) {
  identifier(value, REPOSITORY, "bootstrap_release_exception_repository_invalid");
  if (value.includes("..") || value.endsWith(".git")) fail("bootstrap_release_exception_repository_invalid");
}

function validateReceipt(receipt, nowMs, maxTtlMs, futureSkewMs, {
  authorityProvider = "webauthn_platform",
  assertionFields = ASSERTION_FIELDS,
} = {}) {
  exactFields(receipt, RECEIPT_FIELDS, "bootstrap_release_exception_receipt_schema_invalid");
  if (receipt.schema_version !== BOOTSTRAP_RELEASE_EXCEPTION_SCHEMA_VERSION ||
      receipt.allowed_action !== "github.merge" || receipt.max_uses !== 1 ||
      receipt.core_policy_classification !== "BOOTSTRAP_DEADLOCK_VERIFIED" ||
      receipt.authority_provider !== authorityProvider ||
      receipt.consumed_at !== null || receipt.revoked_at !== null) {
    fail("bootstrap_release_exception_receipt_invalid");
  }
  identifier(receipt.exception_id, IDENTIFIER, "bootstrap_release_exception_id_invalid");
  identifier(receipt.tenant_id, TENANT, "bootstrap_release_exception_tenant_invalid");
  identifier(receipt.work_id, IDENTIFIER, "bootstrap_release_exception_work_invalid");
  validateRepository(receipt.repository);
  if (!Number.isSafeInteger(receipt.pr_number) || receipt.pr_number < 1) {
    fail("bootstrap_release_exception_pr_invalid");
  }
  identifier(receipt.head_sha, SHA1_COMMIT, "bootstrap_release_exception_head_sha_invalid");
  identifier(receipt.nonce, IDENTIFIER, "bootstrap_release_exception_nonce_invalid");
  identifier(receipt.authority_key_id, IDENTIFIER, "bootstrap_release_exception_authority_key_invalid");
  for (const field of [
    "required_checks_digest",
    "required_checks_results_digest",
    "owner_confirmation_digest",
    "core_policy_verdict_digest",
    "rollback_obligations_digest",
    "post_deploy_obligations_digest",
  ]) digest(receipt[field], `bootstrap_release_exception_${field}_invalid`);
  const issuedAt = timestamp(receipt.issued_at, "bootstrap_release_exception_issued_at_invalid");
  const expiresAt = timestamp(receipt.expires_at, "bootstrap_release_exception_expires_at_invalid");
  if (issuedAt > nowMs + futureSkewMs || expiresAt <= nowMs || expiresAt <= issuedAt ||
      expiresAt - issuedAt > maxTtlMs) fail("bootstrap_release_exception_expired_or_ttl_invalid");
  exactFields(receipt.authority_assertion, assertionFields,
    "bootstrap_release_exception_authority_assertion_schema_invalid");
  return { issuedAt, expiresAt };
}

function publicKeyFromTrustedSpki(value) {
  let key;
  try {
    if (value?.type === "public") key = value;
    else if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
      key = crypto.createPublicKey({ key: Buffer.from(value), format: "der", type: "spki" });
    } else if (typeof value === "string" && value.includes("BEGIN PUBLIC KEY")) {
      key = crypto.createPublicKey(value);
    } else fail("bootstrap_release_exception_public_key_invalid");
  } catch {
    fail("bootstrap_release_exception_public_key_invalid");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    fail("bootstrap_release_exception_public_key_invalid");
  }
  return key;
}

function nonAuthorizingCandidate(receipt, timing, extras = {}) {
  return Object.freeze({
    schema_version: BOOTSTRAP_RELEASE_EXCEPTION_CANDIDATE_SCHEMA_VERSION,
    verification_status: "verified_non_authorizing_candidate",
    candidate: true,
    action_authorized: false,
    execution_authorized: false,
    host_action_authorized: false,
    core_join_authorized: false,
    consumption_authorized: false,
    exception_id: receipt.exception_id,
    tenant_id: receipt.tenant_id,
    work_id: receipt.work_id,
    repository: receipt.repository,
    pr_number: receipt.pr_number,
    head_sha: receipt.head_sha,
    allowed_action: receipt.allowed_action,
    authority_provider: receipt.authority_provider,
    authority_key_id: receipt.authority_key_id,
    core_policy_classification: receipt.core_policy_classification,
    receipt_digest: sha256Hex(Buffer.from(bootstrapReleaseExceptionCanonicalJson(receipt), "utf8")),
    issued_at: receipt.issued_at,
    expires_at: receipt.expires_at,
    ttl_ms: timing.expiresAt - timing.issuedAt,
    ...extras,
  });
}

/**
 * Verifies a local-PIN authority receipt using only resolver-owned SPKI
 * material. The PIN and private key never enter this verifier. Verification is
 * stateless and returns evidence only; atomic consumption belongs to a later
 * PostgreSQL merge gate.
 */
export function verifyLocalPinBootstrapReleaseException({
  receipt,
  expected,
  publicKeySpki,
  nowMs,
} = {}) {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) fail("bootstrap_release_exception_clock_invalid");
  const timing = validateReceipt(receipt, nowMs, MAX_TTL_MS, DEFAULT_FUTURE_SKEW_MS, {
    authorityProvider: "local_pin",
    assertionFields: LOCAL_PIN_ASSERTION_FIELDS,
  });
  validateExpected(receipt, expected);
  const assertion = receipt.authority_assertion;
  if (assertion.algorithm !== "ECDSA-P256-SHA256-P1363") {
    fail("bootstrap_release_exception_signature_algorithm_invalid");
  }
  const signature = decodeBase64url(assertion.signature_p1363_base64url,
    "bootstrap_release_exception_signature_encoding_invalid", { min: 64, max: 64 });
  const verifierKey = publicKeyFromTrustedSpki(publicKeySpki);
  let valid = false;
  try {
    valid = crypto.verify(
      "sha256",
      localPinBootstrapReleaseExceptionSigningPayload(receipt),
      { key: verifierKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch { valid = false; }
  if (!valid) fail("bootstrap_release_exception_signature_invalid");
  return nonAuthorizingCandidate(receipt, timing, {
    signature_algorithm: assertion.algorithm,
  });
}

function validateExpected(receipt, expected) {
  exactFields(expected, EXPECTED_FIELDS, "bootstrap_release_exception_expected_schema_invalid");
  for (const field of EXPECTED_FIELDS) {
    if (typeof receipt[field] === "string") {
      if (!safeEqual(receipt[field], expected[field])) fail(`bootstrap_release_exception_${field}_mismatch`);
    } else if (receipt[field] !== expected[field]) fail(`bootstrap_release_exception_${field}_mismatch`);
  }
}

function pinnedOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch { fail("bootstrap_release_exception_origin_invalid"); }
  const localHttp = parsed.protocol === "http:" && parsed.hostname === "localhost";
  if ((parsed.protocol !== "https:" && !localHttp) || parsed.origin !== value || parsed.pathname !== "/" ||
      parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail("bootstrap_release_exception_origin_invalid");
  }
  return parsed;
}

function pinnedPublicKey(value) {
  let key;
  try { key = value?.type === "public" ? value : crypto.createPublicKey(value); } catch {
    fail("bootstrap_release_exception_public_key_invalid");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    fail("bootstrap_release_exception_public_key_invalid");
  }
  return key;
}

/**
 * Statelessly verifies a WebAuthn Platform assertion over a bootstrap release
 * exception. A successful result is evidence for a later atomic consumer; it
 * never authorizes merge, host execution, Core Join, or receipt consumption.
 */
export function createBootstrapReleaseExceptionVerifier({
  origin,
  rpId,
  credentialId,
  publicKey,
  authorityKeyId,
  now = Date.now,
  maxTtlMs = MAX_TTL_MS,
  futureSkewMs = DEFAULT_FUTURE_SKEW_MS,
} = {}) {
  const parsedOrigin = pinnedOrigin(origin);
  if (typeof rpId !== "string" || !/^[A-Za-z0-9.-]{1,253}$/.test(rpId) ||
      !(parsedOrigin.hostname === rpId || parsedOrigin.hostname.endsWith(`.${rpId}`))) {
    fail("bootstrap_release_exception_rp_id_invalid");
  }
  const pinnedCredentialId = decodeBase64url(credentialId,
    "bootstrap_release_exception_credential_id_invalid", { min: 16, max: 1_024 }).toString("base64url");
  const verifierKey = pinnedPublicKey(publicKey);
  const pinnedAuthorityKeyId = identifier(authorityKeyId, IDENTIFIER,
    "bootstrap_release_exception_authority_key_invalid");
  if (typeof now !== "function" || !Number.isSafeInteger(maxTtlMs) || maxTtlMs < 1 || maxTtlMs > MAX_TTL_MS ||
      !Number.isSafeInteger(futureSkewMs) || futureSkewMs < 0 || futureSkewMs > 60_000) {
    fail("bootstrap_release_exception_verifier_configuration_invalid");
  }
  const rpIdHash = sha256Bytes(Buffer.from(rpId, "utf8"));

  return Object.freeze({
    schema_version: BOOTSTRAP_RELEASE_EXCEPTION_SCHEMA_VERSION,
    authority_provider: "webauthn_platform",
    authority_key_id: pinnedAuthorityKeyId,
    origin,
    rp_id: rpId,
    verify({ receipt, expected } = {}) {
      const nowMs = now();
      if (!Number.isSafeInteger(nowMs) || nowMs <= 0) fail("bootstrap_release_exception_clock_invalid");
      const timing = validateReceipt(receipt, nowMs, maxTtlMs, futureSkewMs);
      validateExpected(receipt, expected);
      if (!safeEqual(receipt.authority_key_id, pinnedAuthorityKeyId)) {
        fail("bootstrap_release_exception_authority_key_mismatch");
      }
      const assertion = receipt.authority_assertion;
      if (!safeEqual(assertion.credential_id, pinnedCredentialId)) {
        fail("bootstrap_release_exception_credential_mismatch");
      }
      const clientDataBytes = decodeBase64url(assertion.client_data_json_base64url,
        "bootstrap_release_exception_client_data_invalid");
      let clientData;
      try { clientData = JSON.parse(clientDataBytes.toString("utf8")); } catch {
        fail("bootstrap_release_exception_client_data_invalid");
      }
      if (!isPlainObject(clientData) || clientData.type !== "webauthn.get" ||
          clientData.crossOrigin !== false || !safeEqual(clientData.origin, origin) ||
          !safeEqual(clientData.challenge, bootstrapReleaseExceptionChallenge(receipt))) {
        fail("bootstrap_release_exception_client_data_invalid");
      }
      const authenticatorData = decodeBase64url(assertion.authenticator_data_base64url,
        "bootstrap_release_exception_authenticator_data_invalid", { min: 37, max: 37 });
      if (!crypto.timingSafeEqual(authenticatorData.subarray(0, 32), rpIdHash)) {
        fail("bootstrap_release_exception_rp_id_hash_mismatch");
      }
      const flags = authenticatorData[32];
      if ((flags & 0x01) === 0 || (flags & 0x04) === 0 || (flags & 0xc0) !== 0) {
        fail("bootstrap_release_exception_user_presence_verification_required");
      }
      const signature = decodeBase64url(assertion.signature_der_base64url,
        "bootstrap_release_exception_signature_encoding_invalid", { min: 8, max: 80 });
      if (signature[0] !== 0x30) fail("bootstrap_release_exception_signature_encoding_invalid");
      const signedBytes = Buffer.concat([authenticatorData, sha256Bytes(clientDataBytes)]);
      let signatureValid = false;
      try {
        signatureValid = crypto.verify("sha256", signedBytes,
          { key: verifierKey, dsaEncoding: "der" }, signature);
      } catch { signatureValid = false; }
      if (!signatureValid) fail("bootstrap_release_exception_signature_invalid");

      return nonAuthorizingCandidate(receipt, timing, {
        credential_id: assertion.credential_id,
        challenge: clientData.challenge,
        sign_count: authenticatorData.readUInt32BE(33),
      });
    },
  });
}

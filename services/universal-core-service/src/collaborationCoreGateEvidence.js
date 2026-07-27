import crypto from "node:crypto";

const SCHEMA = "mcp_collaboration_core_gate_v1";
const ISSUER = "universal-core-staging";
const TARGET_SERVICE = "skinharmony-core-mcp-staging";
const TARGET_ENVIRONMENT = "staging";
const MAX_TTL_MS = 30_000;
const DEFAULT_TTL_MS = 20_000;
const CLOCK_SKEW_MS = 5_000;
const DIGEST = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

const CLAIM_KEYS = Object.freeze([
  "schema_version",
  "issuer",
  "tenant_id",
  "audience",
  "target_service",
  "target_environment",
  "target_commit",
  "binding_digest",
  "action_type",
  "target",
  "payload_sha256",
  "expected_version",
  "lock_id",
  "fencing_token",
  "idempotency_key_sha256",
  "decision",
  "mediation",
  "confirmation_satisfied",
  "authorization_scope",
  "jti",
  "issued_at",
  "expires_at",
]);

export class CollaborationCoreGateEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = "CollaborationCoreGateEvidenceError";
    this.code = code;
  }
}

function fail(code) {
  throw new CollaborationCoreGateEvidenceError(code);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("collaboration_core_gate_non_canonical_value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) fail("collaboration_core_gate_non_canonical_value");
      return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
    }).join(",")}}`;
  }
  fail("collaboration_core_gate_non_canonical_value");
}

function digest(label, value) {
  return crypto.createHash("sha256")
    .update(String(label))
    .update("\0")
    .update(canonicalJson(value))
    .digest("hex");
}

function validSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4_096 &&
    /^[\x21-\x7e]+$/.test(value);
}

function boundedText(value, max, pattern = null) {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value) && (!pattern || pattern.test(value));
}

function exactIso(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function nullableDigest(value) {
  return value === null || DIGEST.test(String(value || ""));
}

function normalizeVersion(value) {
  if (value === undefined || value === null || value === "") return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) fail("collaboration_core_gate_binding_invalid");
  return result;
}

function normalizeFence(value) {
  if (value === undefined || value === null || value === "") return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) fail("collaboration_core_gate_binding_invalid");
  return result;
}

function hmac(secret, claims) {
  return crypto.createHmac("sha256", secret)
    .update(canonicalJson(claims), "utf8")
    .digest("base64url");
}

function safeEqual(left, right) {
  try {
    const first = Buffer.from(String(left || ""), "base64url");
    const second = Buffer.from(String(right || ""), "base64url");
    return first.length === 32 && second.length === 32 &&
      first.toString("base64url") === left && second.toString("base64url") === right &&
      crypto.timingSafeEqual(first, second);
  } catch {
    return false;
  }
}

function normalizeGateInput({ tenantId, body, authorization, targetCommit }) {
  if (!isPlainObject(body) || !isPlainObject(authorization) ||
      tenantId !== "codexai" ||
      body.collaboration_target_service !== TARGET_SERVICE ||
      body.collaboration_target_environment !== TARGET_ENVIRONMENT ||
      body.collaboration_target_commit !== targetCommit ||
      !boundedText(body.collaboration_audience, 500) ||
      !DIGEST.test(String(body.collaboration_binding_digest || "")) ||
      !boundedText(body.action_type, 120, /^[A-Za-z0-9][A-Za-z0-9_.-]{1,119}$/) ||
      !boundedText(body.target, 500) ||
      !DIGEST.test(String(body.payload_sha256 || "")) ||
      authorization.allowed !== true ||
      !boundedText(authorization.state, 80) ||
      !boundedText(authorization.mediation, 80) ||
      typeof authorization.confirmation_satisfied !== "boolean" ||
      !boundedText(authorization.scope, 160)) {
    fail("collaboration_core_gate_not_authorized");
  }
  const expectedVersion = normalizeVersion(body.expected_version);
  const lockId = body.lock_id === undefined || body.lock_id === null || body.lock_id === ""
    ? null
    : String(body.lock_id);
  const fencingToken = normalizeFence(body.fencing_token);
  if ((lockId === null) !== (fencingToken === null) || (lockId && !UUID.test(lockId)) ||
      !nullableDigest(body.idempotency_key_sha256 ?? null)) {
    fail("collaboration_core_gate_binding_invalid");
  }
  return Object.freeze({
    tenant_id: tenantId,
    audience: body.collaboration_audience,
    binding_digest: body.collaboration_binding_digest,
    action_type: body.action_type,
    target: body.target,
    payload_sha256: body.payload_sha256,
    expected_version: expectedVersion,
    lock_id: lockId,
    fencing_token: fencingToken,
    idempotency_key_sha256: body.idempotency_key_sha256 ?? null,
    decision: authorization.state,
    mediation: authorization.mediation,
    confirmation_satisfied: authorization.confirmation_satisfied,
    authorization_scope: authorization.scope,
  });
}

export function createCollaborationCoreGateIssuer({
  secret,
  targetCommit,
  now = Date.now,
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  if (!validSecret(secret) || !COMMIT.test(String(targetCommit || "")) ||
      typeof now !== "function" || !Number.isInteger(ttlMs) ||
      ttlMs < 1_000 || ttlMs > MAX_TTL_MS) {
    fail("collaboration_core_gate_issuer_config_invalid");
  }
  return Object.freeze({
    issue(input) {
      const normalized = normalizeGateInput({ ...input, targetCommit });
      const timestamp = Number(now());
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        fail("collaboration_core_gate_clock_invalid");
      }
      const claims = Object.freeze({
        schema_version: SCHEMA,
        issuer: ISSUER,
        tenant_id: normalized.tenant_id,
        audience: normalized.audience,
        target_service: TARGET_SERVICE,
        target_environment: TARGET_ENVIRONMENT,
        target_commit: targetCommit,
        binding_digest: normalized.binding_digest,
        action_type: normalized.action_type,
        target: normalized.target,
        payload_sha256: normalized.payload_sha256,
        expected_version: normalized.expected_version,
        lock_id: normalized.lock_id,
        fencing_token: normalized.fencing_token,
        idempotency_key_sha256: normalized.idempotency_key_sha256,
        decision: normalized.decision,
        mediation: normalized.mediation,
        confirmation_satisfied: normalized.confirmation_satisfied,
        authorization_scope: normalized.authorization_scope,
        jti: `mcpcg_${crypto.randomBytes(18).toString("base64url")}`,
        issued_at: new Date(timestamp).toISOString(),
        expires_at: new Date(timestamp + ttlMs).toISOString(),
      });
      return Object.freeze({ claims, signature: hmac(secret, claims) });
    },
  });
}

export function createCollaborationCoreGateVerifier({
  secret,
  targetCommit,
  now = Date.now,
} = {}) {
  if (!validSecret(secret) || !COMMIT.test(String(targetCommit || "")) || typeof now !== "function") {
    fail("collaboration_core_gate_verifier_config_invalid");
  }
  return Object.freeze({
    verify(envelope, { binding, decision } = {}) {
      if (!exactKeys(envelope, ["claims", "signature"]) ||
          !exactKeys(envelope.claims, CLAIM_KEYS) ||
          !isPlainObject(binding) || !isPlainObject(decision)) {
        fail("collaboration_core_gate_invalid");
      }
      const claims = envelope.claims;
      const expectedSignature = hmac(secret, claims);
      if (!safeEqual(envelope.signature, expectedSignature) ||
          claims.schema_version !== SCHEMA ||
          claims.issuer !== ISSUER ||
          claims.tenant_id !== "codexai" ||
          claims.audience !== binding.audience ||
          claims.target_service !== TARGET_SERVICE ||
          claims.target_environment !== TARGET_ENVIRONMENT ||
          claims.target_commit !== targetCommit ||
          claims.binding_digest !== digest("mcp-collaboration-binding-v1", binding) ||
          claims.action_type !== binding.action_type ||
          claims.target !== binding.target ||
          claims.payload_sha256 !== binding.payload_sha256 ||
          claims.expected_version !== binding.expected_version ||
          claims.lock_id !== binding.lock_id ||
          claims.fencing_token !== binding.fencing_token ||
          claims.idempotency_key_sha256 !== binding.idempotency_key_sha256 ||
          claims.decision !== decision.decision ||
          claims.mediation !== decision.mediation ||
          claims.confirmation_satisfied !== decision.confirmation_satisfied ||
          !boundedText(claims.authorization_scope, 160) ||
          !/^mcpcg_[A-Za-z0-9_-]{16,96}$/.test(String(claims.jti || "")) ||
          !exactIso(claims.issued_at) || !exactIso(claims.expires_at)) {
        fail("collaboration_core_gate_invalid");
      }
      const timestamp = Number(now());
      const issuedAt = Date.parse(claims.issued_at);
      const expiresAt = Date.parse(claims.expires_at);
      if (!Number.isSafeInteger(timestamp) || issuedAt > timestamp + CLOCK_SKEW_MS ||
          expiresAt <= timestamp || expiresAt <= issuedAt ||
          expiresAt - issuedAt > MAX_TTL_MS) {
        fail("collaboration_core_gate_expired");
      }
      return Object.freeze({
        schema_version: "mcp_collaboration_verified_core_gate_v1",
        jti: claims.jti,
        binding_digest: claims.binding_digest,
        expires_at: claims.expires_at,
      });
    },
  });
}

export const collaborationCoreGateContract = Object.freeze({
  schema_version: SCHEMA,
  issuer: ISSUER,
  target_service: TARGET_SERVICE,
  target_environment: TARGET_ENVIRONMENT,
  max_ttl_ms: MAX_TTL_MS,
});

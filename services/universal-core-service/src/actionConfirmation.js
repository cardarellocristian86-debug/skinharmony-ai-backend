import crypto from "node:crypto";

const ASSERTION_VERSION = "action_confirmation_assertion_v1";
const ASSERTION_AUDIENCE = "universal_core_action_evaluator";
const MAX_ASSERTION_LIFETIME_MS = 120_000;

const ASSERTION_KEYS = Object.freeze([
  "assertion_version",
  "audience",
  "tenant_id",
  "actor_id",
  "owner_confirmed",
  "confirmation_reference",
  "action_digest",
  "issued_at",
  "expires_at",
  "nonce",
  "assertion",
]);

function exactOwnKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function canonicalAssertion(assertion) {
  return JSON.stringify({
    version: assertion.assertion_version,
    audience: assertion.audience,
    tenant_id: assertion.tenant_id,
    actor_id: assertion.actor_id,
    owner_confirmed: assertion.owner_confirmed,
    confirmation_reference: assertion.confirmation_reference,
    action_digest: assertion.action_digest,
    issued_at: assertion.issued_at,
    expires_at: assertion.expires_at,
    nonce: assertion.nonce,
  });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function exactIsoTimestamp(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) return null;
  return timestamp;
}

export function verifyActionConfirmationAssertion(assertion, { secret, tenantId, now = Date.now() } = {}) {
  if (!exactOwnKeys(assertion, ASSERTION_KEYS) || typeof secret !== "string" || !secret) return { verified: false };
  if (assertion.assertion_version !== ASSERTION_VERSION || assertion.audience !== ASSERTION_AUDIENCE) return { verified: false };
  if (typeof tenantId !== "string" || !tenantId || assertion.tenant_id !== tenantId) return { verified: false };
  if (assertion.owner_confirmed !== true || typeof assertion.actor_id !== "string" || !/^[a-z0-9:_-]{3,120}$/i.test(assertion.actor_id)) {
    return { verified: false };
  }
  if (typeof assertion.confirmation_reference !== "string" || !/^ucr_[a-z0-9][a-z0-9_-]{7,119}$/.test(assertion.confirmation_reference)) {
    return { verified: false };
  }
  if (typeof assertion.action_digest !== "string" || !/^[a-f0-9]{64}$/.test(assertion.action_digest)) return { verified: false };
  if (typeof assertion.nonce !== "string" || !/^acn_[a-f0-9]{32}$/.test(assertion.nonce)) return { verified: false };
  if (typeof assertion.assertion !== "string" || !/^acs_[a-f0-9]{64}$/.test(assertion.assertion)) return { verified: false };

  const issuedAt = exactIsoTimestamp(assertion.issued_at);
  const expiresAt = exactIsoTimestamp(assertion.expires_at);
  const currentTime = Number(now);
  if (issuedAt === null || expiresAt === null || !Number.isFinite(currentTime)) return { verified: false };
  if (issuedAt > currentTime + 30_000 || expiresAt <= currentTime || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_ASSERTION_LIFETIME_MS) {
    return { verified: false };
  }

  const expected = `acs_${crypto.createHmac("sha256", secret)
    .update(`action-confirmation\u0000${canonicalAssertion(assertion)}`)
    .digest("hex")}`;
  if (!safeEqual(assertion.assertion, expected)) return { verified: false };

  return Object.freeze({
    verified: true,
    tenant_id: assertion.tenant_id,
    actor_id: assertion.actor_id,
    confirmation_reference: assertion.confirmation_reference,
    action_digest: assertion.action_digest,
    issued_at: assertion.issued_at,
    expires_at: assertion.expires_at,
    nonce: assertion.nonce,
  });
}

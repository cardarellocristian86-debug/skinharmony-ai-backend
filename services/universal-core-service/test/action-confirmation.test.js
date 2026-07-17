import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { verifyActionConfirmationAssertion } from "../src/actionConfirmation.js";

const SECRET = "test-core-key-never-returned";
const NOW = Date.parse("2026-07-16T14:00:00.000Z");

function canonical(assertion) {
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

function signed(overrides = {}, secret = SECRET) {
  const assertion = {
    assertion_version: "action_confirmation_assertion_v1",
    audience: "universal_core_action_evaluator",
    tenant_id: "codexai",
    actor_id: "codex:codex",
    owner_confirmed: true,
    confirmation_reference: "ucr_mcp_staging_20260716_01",
    action_digest: "a".repeat(64),
    issued_at: "2026-07-16T13:59:30.000Z",
    expires_at: "2026-07-16T14:01:00.000Z",
    nonce: `acn_${"b".repeat(32)}`,
    ...overrides,
  };
  return {
    ...assertion,
    assertion: `acs_${crypto.createHmac("sha256", secret)
      .update(`action-confirmation\u0000${canonical(assertion)}`)
      .digest("hex")}`,
  };
}

test("verifies an exact short-lived tenant-bound action confirmation", () => {
  const verified = verifyActionConfirmationAssertion(signed(), { secret: SECRET, tenantId: "codexai", now: NOW });
  assert.equal(verified.verified, true);
  assert.equal(verified.tenant_id, "codexai");
  assert.equal(verified.action_digest, "a".repeat(64));
  assert.equal(JSON.stringify(verified).includes(SECRET), false);
  assert.equal("assertion" in verified, false);
});

test("rejects tampering, expiry, wrong tenant, wrong key and unknown fields", () => {
  const valid = signed();
  const cases = [
    { assertion: valid, options: { secret: "wrong-key", tenantId: "codexai", now: NOW } },
    { assertion: valid, options: { secret: SECRET, tenantId: "other", now: NOW } },
    { assertion: { ...valid, action_digest: "c".repeat(64) }, options: { secret: SECRET, tenantId: "codexai", now: NOW } },
    { assertion: { ...valid, confirmation_reference: "ucr_other_action_0001" }, options: { secret: SECRET, tenantId: "codexai", now: NOW } },
    { assertion: { ...valid, extra: "ignored" }, options: { secret: SECRET, tenantId: "codexai", now: NOW } },
    { assertion: signed({ expires_at: "2026-07-16T13:59:59.000Z" }), options: { secret: SECRET, tenantId: "codexai", now: NOW } },
    { assertion: signed({ issued_at: "2026-07-16T14:01:00.000Z", expires_at: "2026-07-16T14:01:30.000Z" }), options: { secret: SECRET, tenantId: "codexai", now: NOW } },
    { assertion: signed({ issued_at: "2026-07-16T13:58:00.000Z", expires_at: "2026-07-16T14:01:00.001Z" }), options: { secret: SECRET, tenantId: "codexai", now: NOW } },
    { assertion: signed({ issued_at: "2026-07-16 13:59:30Z" }), options: { secret: SECRET, tenantId: "codexai", now: NOW } },
    { assertion: signed({ confirmation_reference: "token=synthetic-test-only" }), options: { secret: SECRET, tenantId: "codexai", now: NOW } },
  ];
  for (const item of cases) assert.equal(verifyActionConfirmationAssertion(item.assertion, item.options).verified, false);
});

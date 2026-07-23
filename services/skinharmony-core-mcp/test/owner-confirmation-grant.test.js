import test from "node:test";
import assert from "node:assert/strict";
import { createOwnerConfirmationGrantLedger, ownerRequestDigest } from "../src/owner-confirmation-grant.js";

test("grant is fresh, tenant/session/request bound and one-use", () => {
  const ledger = createOwnerConfirmationGrantLedger({ ttlSeconds: 10 });
  const requestDigest = ownerRequestDigest("tool\u0000args");
  const issued = ledger.issue({ tenantId: "codexai", subject: "owner", sessionId: "session", toolName: "tool", requestDigest, now: 1000 });
  assert.equal(ledger.consume({ nonce: issued.nonce, tenantId: "codexai", subject: "owner", sessionId: "session", toolName: "tool", requestDigest, now: 1001 }), true);
  assert.throws(() => ledger.consume({ nonce: issued.nonce, tenantId: "codexai", subject: "owner", sessionId: "session", toolName: "tool", requestDigest, now: 1001 }), /owner_grant_invalid/);
});

test("grant rejects tenant, request and expiry mismatch", () => {
  const ledger = createOwnerConfirmationGrantLedger({ ttlSeconds: 1 });
  const issued = ledger.issue({ tenantId: "codexai", subject: "owner", sessionId: "session", toolName: "tool", requestDigest: "digest", now: 1000 });
  assert.throws(() => ledger.consume({ nonce: issued.nonce, tenantId: "other", subject: "owner", sessionId: "session", toolName: "tool", requestDigest: "digest", now: 1000 }), /owner_grant_binding_mismatch/);
  assert.throws(() => ledger.consume({ nonce: issued.nonce, tenantId: "codexai", subject: "owner", sessionId: "session", toolName: "other", requestDigest: "digest", now: 1000 }), /owner_grant_binding_mismatch/);
  assert.throws(() => ledger.consume({ nonce: issued.nonce, tenantId: "codexai", subject: "owner", sessionId: "session", toolName: "tool", requestDigest: "digest", now: 2001 }), /owner_grant_invalid/);
});

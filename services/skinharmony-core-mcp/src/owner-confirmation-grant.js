import crypto from "node:crypto";

const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

export function createOwnerConfirmationGrantLedger({ store = new Map(), ttlSeconds = 300, persistentLedger = null, requirePersistent = false } = {}) {
  if (requirePersistent && !persistentLedger) throw new Error("owner_grant_ledger_unavailable");
  if (persistentLedger) return {
    issue: (args) => persistentLedger.issueGrant(args),
    consume: (args) => persistentLedger.consumeGrant(args),
    issueChallenge: (args) => persistentLedger.issueChallenge(args),
    approveChallenge: (args) => persistentLedger.approveChallenge(args),
    consumeApprovedChallenge: (args) => persistentLedger.consumeApprovedChallenge(args),
  };
  const challenges = new Map();
  return {
    issue({ tenantId, subject, sessionId, toolName, requestDigest, now = Date.now() }) {
      const nonce = crypto.randomBytes(32).toString("base64url");
      const grant = { nonceDigest: hash(nonce), tenantId, subjectDigest: hash(subject), sessionDigest: hash(sessionId), toolName, requestDigest, expiresAt: now + ttlSeconds * 1000, consumed: false };
      store.set(grant.nonceDigest, grant);
      return { nonce, expiresAt: grant.expiresAt };
    },
    consume({ nonce, tenantId, subject, sessionId, toolName, requestDigest, now = Date.now() }) {
      const grant = store.get(hash(nonce));
      if (!grant || grant.consumed || grant.expiresAt <= now) throw new Error("owner_grant_invalid");
      if (grant.tenantId !== tenantId || grant.subjectDigest !== hash(subject) || grant.sessionDigest !== hash(sessionId) || grant.toolName !== toolName || grant.requestDigest !== requestDigest) throw new Error("owner_grant_binding_mismatch");
      grant.consumed = true;
      return true;
    },
    issueChallenge({ tenantId, subject, sessionId, toolName, requestDigest, now = Date.now() }) {
      const challengeId = crypto.randomBytes(32).toString("base64url");
      challenges.set(hash(challengeId), { tenantId, subjectDigest: hash(subject), sessionDigest: hash(sessionId), toolName, requestDigest, expiresAt: now + ttlSeconds * 1000, approved: false, consumed: false });
      return { challengeId, expiresAt: new Date(now + ttlSeconds * 1000).toISOString() };
    },
    approveChallenge({ challengeId, tenantId, subject, now = Date.now() }) {
      const challenge = challenges.get(hash(challengeId));
      if (!challenge || challenge.expiresAt <= now || challenge.tenantId !== tenantId || challenge.subjectDigest !== hash(subject) || challenge.approved || challenge.consumed) throw new Error("owner_challenge_invalid");
      challenge.approved = true; return { approved: true };
    },
    consumeApprovedChallenge({ tenantId, subject, sessionId, toolName, requestDigest, now = Date.now() }) {
      for (const challenge of challenges.values()) {
        if (!challenge.approved || challenge.consumed || challenge.expiresAt <= now) continue;
        if (challenge.tenantId === tenantId && challenge.subjectDigest === hash(subject) && challenge.sessionDigest === hash(sessionId) && challenge.toolName === toolName && challenge.requestDigest === requestDigest) {
          challenge.consumed = true; return true;
        }
      }
      throw new Error("owner_challenge_missing");
    },
    cleanup(now = Date.now()) { for (const [key, value] of store) if (value.expiresAt <= now || value.consumed) store.delete(key); },
  };
}

export const ownerRequestDigest = (value) => hash(value);

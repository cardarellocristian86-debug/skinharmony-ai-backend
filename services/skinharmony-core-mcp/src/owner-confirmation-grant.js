import crypto from "node:crypto";

const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

export function createOwnerConfirmationGrantLedger({ store = new Map(), ttlSeconds = 300, persistentLedger = null, requirePersistent = false } = {}) {
  if (requirePersistent && !persistentLedger) throw new Error("owner_grant_ledger_unavailable");
  if (persistentLedger) return persistentLedger;
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
    cleanup(now = Date.now()) { for (const [key, value] of store) if (value.expiresAt <= now || value.consumed) store.delete(key); },
  };
}

export const ownerRequestDigest = (value) => hash(value);

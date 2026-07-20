import crypto from "node:crypto";
import { Pool } from "pg";

function text(value, field, max = 4_000) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function ownerSubjectFingerprint(value) {
  const fingerprint = text(value, "owner_subject_fingerprint", 80);
  if (!/^osf_[a-f0-9]{64}$/.test(fingerprint)) throw new Error("owner_subject_fingerprint_invalid");
  return fingerprint;
}

async function withTransaction(db, operation) {
  // A real pg Pool must use one checked-out client for the transaction. Unit
  // tests can inject a small query-only double, which still exercises the
  // query shapes without pretending it has transactional connection support.
  const client = typeof db.connect === "function" ? await db.connect() : db;
  let committed = false;
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    committed = true;
    return result;
  } catch (error) {
    if (!committed) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    throw error;
  } finally {
    if (client !== db && typeof client.release === "function") client.release();
  }
}

export function createTenantProviderSetupLinkStore({ connectionString, pool = null, now = () => new Date() } = {}) {
  const db = pool || new Pool({
    connectionString: text(connectionString, "governed_agent_database_url"),
    max: 2,
    idleTimeoutMillis: 10_000,
  });
  let initialized = false;

  async function init() {
    if (initialized) return;
    await db.query(`CREATE TABLE IF NOT EXISTS governed_agent_provider_setup_links (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      link_id TEXT,
      proof_hash TEXT,
      owner_subject_fingerprint TEXT,
      revoked_at TIMESTAMPTZ,
      claimed_at TIMESTAMPTZ,
      claim_id TEXT,
      claim_expires_at TIMESTAMPTZ
    )`);
    // Existing pre-proof rows intentionally remain unusable because they have
    // no proof hash. That is safer than carrying a bearer-only setup URL
    // forward after this upgrade.
    for (const column of [
      "link_id TEXT",
      "proof_hash TEXT",
      "owner_subject_fingerprint TEXT",
      "revoked_at TIMESTAMPTZ",
      "claimed_at TIMESTAMPTZ",
      "claim_id TEXT",
      "claim_expires_at TIMESTAMPTZ",
    ]) {
      await db.query(`ALTER TABLE governed_agent_provider_setup_links ADD COLUMN IF NOT EXISTS ${column}`);
    }
    await db.query("CREATE UNIQUE INDEX IF NOT EXISTS governed_agent_provider_setup_links_link_id_idx ON governed_agent_provider_setup_links (link_id) WHERE link_id IS NOT NULL");
    await db.query("CREATE INDEX IF NOT EXISTS governed_agent_provider_setup_links_active_idx ON governed_agent_provider_setup_links (tenant_id, provider, expires_at) WHERE consumed_at IS NULL AND revoked_at IS NULL");
    initialized = true;
  }

  return {
    async issue({ tenant_id, owner_subject_fingerprint, ttl_minutes = 15 }) {
      const tenantId = text(tenant_id, "tenant_id", 120);
      const ownerFingerprint = ownerSubjectFingerprint(owner_subject_fingerprint);
      const ttl = Math.max(5, Math.min(30, Number(ttl_minutes) || 15));
      const token = crypto.randomBytes(32).toString("base64url");
      const proof = crypto.randomBytes(32).toString("base64url");
      const linkId = `psl_${crypto.randomBytes(18).toString("base64url")}`;
      const expiresAt = new Date(now().getTime() + ttl * 60_000).toISOString();
      await init();
      await withTransaction(db, async (client) => {
        // A tenant can have at most one live OpenAI setup link. Issuing a new
        // one revokes every older active link, including an abandoned claim.
        await client.query(
          "UPDATE governed_agent_provider_setup_links SET revoked_at=NOW(), claim_id=NULL, claim_expires_at=NULL WHERE tenant_id=$1 AND provider='openai' AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW()",
          [tenantId],
        );
        await client.query(
          "DELETE FROM governed_agent_provider_setup_links WHERE expires_at < NOW() - INTERVAL '1 day' OR (revoked_at IS NOT NULL AND created_at < NOW() - INTERVAL '1 day')",
        );
        await client.query(
          "INSERT INTO governed_agent_provider_setup_links (token_hash,tenant_id,provider,expires_at,link_id,proof_hash,owner_subject_fingerprint) VALUES ($1,$2,'openai',$3,$4,$5,$6)",
          [hash(token), tenantId, expiresAt, linkId, hash(proof), ownerFingerprint],
        );
      });
      return { token, proof, link_id: linkId, expires_at: expiresAt };
    },

    // The credential callback runs on this same checked-out PostgreSQL client.
    // The link row is locked before the encrypted credential is written, and
    // consumption is committed only after that write succeeds. This removes
    // the old claim → save → finalize gap where a vault write could survive a
    // failed finalization or a concurrent revocation.
    async consumeAndPersist({ token, proof, prepare, persist }) {
      const setupToken = text(token, "setup_token", 200);
      const setupProof = text(proof, "setup_proof", 200);
      if (typeof prepare !== "function" || typeof persist !== "function") {
        throw new Error("provider_setup_atomic_persistence_required");
      }
      await init();
      // Table creation happens before the transaction. The actual credential
      // upsert below is explicitly passed the setup-link transaction client.
      await prepare();
      return withTransaction(db, async (client) => {
        const active = await client.query(
          "SELECT link_id,tenant_id,owner_subject_fingerprint,expires_at FROM governed_agent_provider_setup_links WHERE token_hash=$1 AND proof_hash=$2 AND provider='openai' AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() AND (claim_id IS NULL OR claim_expires_at<=NOW()) FOR UPDATE",
          [hash(setupToken), hash(setupProof)],
        );
        const link = active.rows[0];
        if (!link) return null;

        const credential = await persist({
          tenant_id: link.tenant_id,
          owner_subject_fingerprint: link.owner_subject_fingerprint,
          client,
        });
        const consumed = await client.query(
          "UPDATE governed_agent_provider_setup_links SET consumed_at=NOW(), claim_id=NULL, claim_expires_at=NULL WHERE token_hash=$1 AND proof_hash=$2 AND link_id=$3 AND provider='openai' AND consumed_at IS NULL AND revoked_at IS NULL RETURNING link_id,tenant_id,owner_subject_fingerprint,expires_at",
          [hash(setupToken), hash(setupProof), link.link_id],
        );
        if (!consumed.rows[0]) throw new Error("provider_setup_link_consume_failed");
        return { ...consumed.rows[0], credential };
      });
    },

    async claim({ token, proof }) {
      const setupToken = text(token, "setup_token", 200);
      const setupProof = text(proof, "setup_proof", 200);
      await init();
      const claimId = `psc_${crypto.randomBytes(18).toString("base64url")}`;
      const result = await db.query(
        "UPDATE governed_agent_provider_setup_links SET claim_id=$3, claimed_at=NOW(), claim_expires_at=NOW() + INTERVAL '90 seconds' WHERE token_hash=$1 AND proof_hash=$2 AND provider='openai' AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() AND (claim_id IS NULL OR claim_expires_at<=NOW()) RETURNING link_id,tenant_id,owner_subject_fingerprint,expires_at",
        [hash(setupToken), hash(setupProof), claimId],
      );
      return result.rows[0] ? { ...result.rows[0], claim_id: claimId } : null;
    },

    async finalize({ link_id, claim_id }) {
      const linkId = text(link_id, "link_id", 120);
      const claimId = text(claim_id, "claim_id", 120);
      await init();
      const result = await db.query(
        "UPDATE governed_agent_provider_setup_links SET consumed_at=NOW(), claim_id=NULL, claim_expires_at=NULL WHERE link_id=$1 AND claim_id=$2 AND provider='openai' AND consumed_at IS NULL AND revoked_at IS NULL RETURNING tenant_id,owner_subject_fingerprint,expires_at",
        [linkId, claimId],
      );
      return result.rows[0] || null;
    },

    async release({ link_id, claim_id }) {
      const linkId = text(link_id, "link_id", 120);
      const claimId = text(claim_id, "claim_id", 120);
      await init();
      const result = await db.query(
        "UPDATE governed_agent_provider_setup_links SET claim_id=NULL, claimed_at=NULL, claim_expires_at=NULL WHERE link_id=$1 AND claim_id=$2 AND provider='openai' AND consumed_at IS NULL AND revoked_at IS NULL RETURNING link_id",
        [linkId, claimId],
      );
      return result.rowCount > 0;
    },
  };
}

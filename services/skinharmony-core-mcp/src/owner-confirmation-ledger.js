import crypto from "node:crypto";
import { Pool } from "pg";

export const OWNER_CONFIRMATION_LEDGER_SCHEMA_VERSION = "owner_confirmation_ledger_v1";

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS core_owner_confirmation_ledger (
  confirmation_digest char(64) PRIMARY KEY,
  tenant_id varchar(64) NOT NULL,
  subject_digest char(64) NOT NULL,
  request_binding_digest char(64) NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS core_owner_confirmation_ledger_expiry_idx
  ON core_owner_confirmation_ledger (expires_at);
CREATE TABLE IF NOT EXISTS core_owner_confirmation_grants (
  nonce_digest char(64) PRIMARY KEY, tenant_id varchar(64) NOT NULL,
  subject_digest char(64) NOT NULL, session_digest char(64) NOT NULL,
  tool_name varchar(120) NOT NULL, request_digest char(64) NOT NULL,
  issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS core_owner_confirmation_challenges (
  challenge_digest char(64) PRIMARY KEY, tenant_id varchar(64) NOT NULL,
  subject_digest char(64) NOT NULL, session_digest char(64) NOT NULL,
  tool_name varchar(120) NOT NULL, request_digest char(64) NOT NULL,
  issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  approved_at timestamptz, consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS core_owner_confirmation_challenge_lookup_idx
  ON core_owner_confirmation_challenges (tenant_id, subject_digest, session_digest, tool_name, request_digest);
`;

export function createOwnerConfirmationLedger(config, options = {}) {
  if (!config.databaseUrl && !options.pool) return null;
  const pool = options.pool || new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: config.databasePoolMax || 5,
  });
  let ready;
  const initialize = () => ready ||= pool.query(SCHEMA_SQL);
  return {
    schemaSql: SCHEMA_SQL,
    async consume({ tenantId, subject, reference, requestBinding, now = new Date(), ttlSeconds = 300 }) {
      await initialize();
      const expiry = new Date(now.getTime() + Number(ttlSeconds) * 1000);
      const client = typeof pool.connect === "function" ? await pool.connect() : pool;
      try {
        if (client.query !== pool.query) await client.query("BEGIN");
        // Eviction is bounded and performed in the same transaction as the
        // insert. The primary key makes consumption atomic across replicas.
        await client.query("DELETE FROM core_owner_confirmation_ledger WHERE expires_at <= $1", [now]);
        const result = await client.query(`INSERT INTO core_owner_confirmation_ledger
          (confirmation_digest, tenant_id, subject_digest, request_binding_digest, consumed_at, expires_at)
          VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (confirmation_digest) DO NOTHING RETURNING confirmation_digest`,
        [digest(reference), String(tenantId), digest(subject), digest(requestBinding), now, expiry]);
        if (client.query !== pool.query) await client.query("COMMIT");
        if (!result.rows?.length) throw new Error("owner_confirmation_replayed");
        return { schema_version: OWNER_CONFIRMATION_LEDGER_SCHEMA_VERSION, expires_at: expiry.toISOString() };
      } catch (error) {
        if (client.query !== pool.query) await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally { client.release?.(); }
    },
    async issueGrant({ tenantId, subject, sessionId, toolName, requestDigest, nonce, now = new Date(), ttlSeconds = 300 }) {
      await initialize(); const issued = nonce || crypto.randomBytes(32).toString("base64url"); now = now instanceof Date ? now : new Date(now);
      const client = typeof pool.connect === "function" ? await pool.connect() : pool;
      try { if (client.query !== pool.query) await client.query("BEGIN");
        await client.query("DELETE FROM core_owner_confirmation_grants WHERE expires_at <= $1 OR consumed_at IS NOT NULL", [now]);
        await client.query(`INSERT INTO core_owner_confirmation_grants (nonce_digest,tenant_id,subject_digest,session_digest,tool_name,request_digest,issued_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [digest(issued),tenantId,digest(subject),digest(sessionId),toolName,digest(requestDigest),now,new Date(now.getTime()+ttlSeconds*1000)]);
        if (client.query !== pool.query) await client.query("COMMIT"); return { nonce: issued };
      } catch (e) { if (client.query !== pool.query) await client.query("ROLLBACK").catch(()=>{}); throw e; } finally { client.release?.(); }
    },
    async consumeGrant({ nonce, tenantId, subject, sessionId, toolName, requestDigest, now = new Date() }) {
      await initialize(); const result = await pool.query(`UPDATE core_owner_confirmation_grants SET consumed_at=$1 WHERE nonce_digest=$2 AND tenant_id=$3 AND subject_digest=$4 AND session_digest=$5 AND tool_name=$6 AND request_digest=$7 AND expires_at>$1 AND consumed_at IS NULL RETURNING nonce_digest`, [now,digest(nonce),tenantId,digest(subject),digest(sessionId),toolName,digest(requestDigest)]);
      if (!result.rows?.length) throw new Error("owner_grant_invalid"); return true;
    },
    async issueChallenge({ tenantId, subject, sessionId, toolName, requestDigest, now = new Date(), ttlSeconds = 300 }) {
      await initialize(); now = now instanceof Date ? now : new Date(now);
      const challenge = crypto.randomBytes(32).toString("base64url");
      await pool.query(`INSERT INTO core_owner_confirmation_challenges
        (challenge_digest,tenant_id,subject_digest,session_digest,tool_name,request_digest,issued_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [digest(challenge), tenantId, digest(subject), digest(sessionId), toolName, digest(requestDigest), now, new Date(now.getTime() + ttlSeconds * 1000)]);
      return { challengeId: challenge, expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString() };
    },
    async approveChallenge({ challengeId, tenantId, subject, now = new Date() }) {
      await initialize(); now = now instanceof Date ? now : new Date(now);
      const result = await pool.query(`UPDATE core_owner_confirmation_challenges
        SET approved_at=$1 WHERE challenge_digest=$2 AND tenant_id=$3 AND subject_digest=$4
        AND expires_at>$1 AND approved_at IS NULL AND consumed_at IS NULL RETURNING session_digest,tool_name,request_digest,expires_at`,
      [now, digest(challengeId), tenantId, digest(subject)]);
      if (!result.rows?.length) throw new Error("owner_challenge_invalid");
      return { approved: true };
    },
    async consumeApprovedChallenge({ tenantId, subject, sessionId, toolName, requestDigest, now = new Date() }) {
      await initialize(); now = now instanceof Date ? now : new Date(now);
      const client = typeof pool.connect === "function" ? await pool.connect() : pool;
      try {
        if (client.query !== pool.query) await client.query("BEGIN");
        const result = await client.query(`UPDATE core_owner_confirmation_challenges SET consumed_at=$1
          WHERE tenant_id=$2 AND subject_digest=$3 AND session_digest=$4 AND tool_name=$5 AND request_digest=$6
          AND approved_at IS NOT NULL AND expires_at>$1 AND consumed_at IS NULL RETURNING challenge_digest`,
        [now, tenantId, digest(subject), digest(sessionId), toolName, digest(requestDigest)]);
        if (client.query !== pool.query) await client.query("COMMIT");
        if (!result.rows?.length) throw new Error("owner_challenge_missing");
        return true;
      } catch (error) { if (client.query !== pool.query) await client.query("ROLLBACK").catch(() => {}); throw error; }
      finally { client.release?.(); }
    },
  };
}

export function confirmationDigest(reference) { return digest(reference); }

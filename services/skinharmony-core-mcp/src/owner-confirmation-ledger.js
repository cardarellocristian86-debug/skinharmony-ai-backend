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
  };
}

export function confirmationDigest(reference) { return digest(reference); }

import crypto from "node:crypto";

export const ICF_POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS core_icf_work (
  tenant_id text NOT NULL, work_id text NOT NULL, version bigint NOT NULL DEFAULT 0,
  state jsonb NOT NULL, ledger_head_digest text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id)
);
CREATE TABLE IF NOT EXISTS core_icf_event (
  tenant_id text NOT NULL, work_id text NOT NULL, seq bigint NOT NULL,
  event_type text NOT NULL, payload jsonb NOT NULL, previous_digest text,
  digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, seq), UNIQUE (tenant_id, work_id, digest)
);
CREATE INDEX IF NOT EXISTS core_icf_event_head_idx ON core_icf_event (tenant_id, work_id, seq DESC);
`;

const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createIcfPostgresStore({ pool, audit } = {}) {
  if (!pool || typeof pool.query !== "function") return { kind: "unavailable", ready: false, reason: "pool_required" };
  return {
    kind: "postgresql",
    ready: true,
    restart_durable: true,
    distributed: true,
    async initialize() { await pool.query(ICF_POSTGRES_SCHEMA); },
    async appendEvent({ tenantId, workId, eventType, payload }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query("SELECT version, ledger_head_digest FROM core_icf_work WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE", [tenantId, workId]);
        const version = Number(current.rows[0]?.version || 0) + 1;
        const previous = current.rows[0]?.ledger_head_digest || null;
        const digest = hash({ tenantId, workId, seq: version, eventType, payload, previous });
        await client.query("INSERT INTO core_icf_event (tenant_id, work_id, seq, event_type, payload, previous_digest, digest) VALUES ($1,$2,$3,$4,$5,$6,$7)", [tenantId, workId, version, eventType, payload, previous, digest]);
        await client.query("INSERT INTO core_icf_work (tenant_id, work_id, version, state, ledger_head_digest) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, work_id) DO UPDATE SET version=EXCLUDED.version, ledger_head_digest=EXCLUDED.ledger_head_digest, updated_at=now()", [tenantId, workId, version, {}, digest]);
        await client.query("COMMIT"); audit?.append?.("icf_postgres_event_appended", { tenant_id: tenantId, work_id: workId, seq: version }); return { seq: version, digest, previous_digest: previous };
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    },
    async head(tenantId, workId) { const result = await pool.query("SELECT version, ledger_head_digest FROM core_icf_work WHERE tenant_id=$1 AND work_id=$2", [tenantId, workId]); return result.rows[0] || { version: 0, ledger_head_digest: null }; },
  };
}

import crypto from "node:crypto";

export const CORE_JOIN_POSTGRES_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS core_icf_join_head (tenant_id text NOT NULL, work_id text NOT NULL, version bigint NOT NULL DEFAULT 0, head_digest text, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, work_id));",
  "CREATE TABLE IF NOT EXISTS core_icf_join_event (tenant_id text NOT NULL, work_id text NOT NULL, seq bigint NOT NULL, join_type text NOT NULL, statement jsonb NOT NULL, previous_digest text, digest text NOT NULL, signature text NOT NULL, key_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, work_id, seq), UNIQUE (tenant_id, work_id, digest));",
  "CREATE INDEX IF NOT EXISTS core_icf_join_event_head_idx ON core_icf_join_event (tenant_id, work_id, seq DESC);",
].join("\n");

const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
};
const digestOf = (value) => crypto.createHash("sha256").update(canonical(value)).digest("hex");

export function createCoreJoinSigner({ secret, keyId = "core-join-hmac-v1" } = {}) {
  const configured = typeof secret === "string" && secret.length >= 32;
  const sign = (statement) => {
    if (!configured) throw new Error("core_join_signing_secret_required");
    const digest = digestOf(statement);
    return { digest, signature: crypto.createHmac("sha256", secret).update(digest).digest("hex"), key_id: keyId };
  };
  const verify = ({ statement, digest, signature }) => {
    if (!configured || typeof digest !== "string" || typeof signature !== "string") return false;
    const expectedDigest = digestOf(statement);
    const expectedSignature = crypto.createHmac("sha256", secret).update(expectedDigest).digest("hex");
    return expectedDigest === digest && crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
  };
  return { configured, key_id: keyId, sign, verify };
}

export function createCoreJoinPostgresStore({ pool, signer, audit } = {}) {
  if (!pool || typeof pool.query !== "function") return { kind: "unavailable", ready: false, reason: "pool_required" };
  if (!signer?.configured) return { kind: "postgresql", ready: false, reason: "signer_required" };
  return {
    kind: "postgresql", ready: true, restart_durable: true, distributed: true,
    async initialize() { await pool.query(CORE_JOIN_POSTGRES_SCHEMA); },
    async head(tenantId, workId) {
      const r = await pool.query("SELECT version, head_digest FROM core_icf_join_head WHERE tenant_id=$1 AND work_id=$2", [tenantId, workId]);
      return r.rows[0] || { version: 0, head_digest: null };
    },
    async appendJoin({ tenantId, workId, joinType = "global_intent", statement }) {
      if (!tenantId || !workId || !statement) throw new Error("core_join_identity_required");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query("SELECT version, head_digest FROM core_icf_join_head WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE", [tenantId, workId]);
        const seq = Number(current.rows[0]?.version || 0) + 1;
        const previous = current.rows[0]?.head_digest || null;
        const signed = signer.sign({ tenant_id: tenantId, work_id: workId, seq, join_type: joinType, statement, previous_digest: previous });
        await client.query("INSERT INTO core_icf_join_event (tenant_id,work_id,seq,join_type,statement,previous_digest,digest,signature,key_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [tenantId, workId, seq, joinType, statement, previous, signed.digest, signed.signature, signed.key_id]);
        await client.query("INSERT INTO core_icf_join_head (tenant_id,work_id,version,head_digest) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,work_id) DO UPDATE SET version=EXCLUDED.version,head_digest=EXCLUDED.head_digest,updated_at=now()", [tenantId, workId, seq, signed.digest]);
        await client.query("COMMIT");
        audit?.append?.("core_join_appended", { tenant_id: tenantId, work_id: workId, seq });
        return { ok: true, seq, ...signed, previous_digest: previous };
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    },
    async compareAndSwapHead({ tenantId, workId, expectedDigest, nextDigest }) {
      const r = await pool.query("UPDATE core_icf_join_head SET version=version+1,head_digest=$3,updated_at=now() WHERE tenant_id=$1 AND work_id=$2 AND head_digest IS NOT DISTINCT FROM $4 RETURNING version", [tenantId, workId, nextDigest, expectedDigest]);
      return { ok: r.rowCount === 1, version: r.rows[0]?.version || null };
    },
    async verifyEvent(event) {
      return signer.verify({ statement: { tenant_id: event.tenant_id, work_id: event.work_id, seq: event.seq, join_type: event.join_type, statement: event.statement, previous_digest: event.previous_digest }, digest: event.digest, signature: event.signature });
    },
  };
}

export { canonical, digestOf };

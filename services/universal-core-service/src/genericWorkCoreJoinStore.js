import crypto from "node:crypto";

function fail(code) { throw new Error(code); }
function clone(value) { return structuredClone(value); }
function advisoryLockKey({ tenant_id, work_id, adapter, idempotency_digest, verifier_nonce }) {
  return crypto.createHash("sha256")
    .update("generic_work_core_join_advisory_lock_v1\0", "utf8")
    .update(JSON.stringify({ tenant_id, work_id, adapter, idempotency_digest, verifier_nonce }), "utf8")
    .digest("hex");
}

/** Test double only. Production must inject a restart-durable distributed store. */
export function createMemoryGenericWorkCoreJoinStore() {
  const records = new Map();
  const nonces = new Map();
  const events = [];
  const keyOf = ({ tenant_id, work_id, adapter, idempotency_digest }) => `${tenant_id}\0${work_id}\0${adapter}\0${idempotency_digest}`;
  return {
    kind: "memory_test_only", restart_durable: false, distributed: false,
    async read(key) { return records.has(keyOf(key)) ? clone(records.get(keyOf(key))) : null; },
    async record(record) {
      const key = keyOf(record); const nonceKey = `${record.tenant_id}\0${record.verifier_nonce}`;
      const existing = records.get(key);
      if (existing) return clone(existing);
      const nonceOwner = nonces.get(nonceKey);
      if (nonceOwner && nonceOwner !== key) fail("generic_work_core_join_nonce_replayed");
      if (record.software_closure_fresh_until && Date.now() > Date.parse(record.software_closure_fresh_until)) {
        fail("software_cognition_closure_expired_during_issuance");
      }
      const { software_closure_fresh_until: _freshnessGuard, ...durableRecord } = record;
      const immutable = Object.freeze(clone(durableRecord));
      records.set(key, immutable); nonces.set(nonceKey, key);
      events.push(Object.freeze({ event_type: "generic_work_core_join_issued", tenant_id: record.tenant_id, work_id: record.work_id, adapter: record.adapter, idempotency_digest: record.idempotency_digest, verdict_id: record.verdict.verdict_id, receipt_digest: record.independent_verifier_receipt_digest, event_digest: crypto.createHash("sha256").update(JSON.stringify(record.verdict)).digest("hex") }));
      return clone(immutable);
    },
    events() { return clone(events); },
  };
}

/** PostgreSQL contract for production injection. All writes are append-only. */
export function createPostgresGenericWorkCoreJoinStore({ pool } = {}) {
  if (!pool || typeof pool.connect !== "function") fail("generic_work_core_join_postgres_unavailable");
  let initialized;
  async function init() {
    initialized ||= pool.query(`
      CREATE TABLE IF NOT EXISTS generic_work_core_joins (
        tenant_id text NOT NULL, work_id text NOT NULL, adapter text NOT NULL, idempotency_digest char(64) NOT NULL,
        request_canonical text NOT NULL, request_digest char(64) NOT NULL, independent_verifier_receipt_digest char(64) NOT NULL,
        verifier_nonce text NOT NULL, verdict_id text NOT NULL UNIQUE, verdict jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, work_id, adapter, idempotency_digest), UNIQUE (tenant_id, verifier_nonce)
      );
      CREATE TABLE IF NOT EXISTS generic_work_core_join_events (
        event_id bigserial PRIMARY KEY, tenant_id text NOT NULL, work_id text NOT NULL, adapter text NOT NULL,
        idempotency_digest char(64) NOT NULL, verdict_id text NOT NULL, receipt_digest char(64) NOT NULL,
        event_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );`);
    return initialized;
  }
  const decode = (row) => row && ({ ...row, verdict: typeof row.verdict === "string" ? JSON.parse(row.verdict) : row.verdict });
  const select = async (client, key) => decode((await client.query(`SELECT tenant_id,work_id,adapter,idempotency_digest,request_canonical,request_digest,independent_verifier_receipt_digest,verifier_nonce,verdict FROM generic_work_core_joins WHERE tenant_id=$1 AND work_id=$2 AND adapter=$3 AND idempotency_digest=$4`, [key.tenant_id, key.work_id, key.adapter, key.idempotency_digest])).rows[0]);
  return {
    kind: "postgres_append_only_v1", restart_durable: true, distributed: true,
    async initialize() { await init(); return { kind: "postgres_append_only_v1", restart_durable: true, distributed: true }; },
    async read(key) { await init(); return select(pool, key); },
    async record(record) {
      await init(); const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [advisoryLockKey(record)]);
        const existing = await select(client, record);
        if (existing) { await client.query("COMMIT"); return existing; }
        const nonce = await client.query("SELECT 1 FROM generic_work_core_joins WHERE tenant_id=$1 AND verifier_nonce=$2 FOR UPDATE", [record.tenant_id, record.verifier_nonce]);
        if (nonce.rowCount) fail("generic_work_core_join_nonce_replayed");
        if (record.software_closure_fresh_until) {
          const fresh = await client.query("SELECT clock_timestamp() <= $1::timestamptz AS fresh", [record.software_closure_fresh_until]);
          if (fresh.rows[0]?.fresh !== true) fail("software_cognition_closure_expired_during_issuance");
        }
        await client.query(`INSERT INTO generic_work_core_joins (tenant_id,work_id,adapter,idempotency_digest,request_canonical,request_digest,independent_verifier_receipt_digest,verifier_nonce,verdict_id,verdict) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [record.tenant_id, record.work_id, record.adapter, record.idempotency_digest, record.request_canonical, record.request_digest, record.independent_verifier_receipt_digest, record.verifier_nonce, record.verdict.verdict_id, JSON.stringify(record.verdict)]);
        await client.query(`INSERT INTO generic_work_core_join_events (tenant_id,work_id,adapter,idempotency_digest,verdict_id,receipt_digest,event_type) VALUES ($1,$2,$3,$4,$5,$6,'generic_work_core_join_issued')`, [record.tenant_id, record.work_id, record.adapter, record.idempotency_digest, record.verdict.verdict_id, record.independent_verifier_receipt_digest]);
        await client.query("COMMIT"); return clone(record);
      } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); }
    },
  };
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

function requireText(value, field, max = 200) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

export function createFileDynamicTaskTreeJoinVerdictStore({ root, now = () => new Date().toISOString() } = {}) {
  const storeRoot = path.resolve(requireText(root, "dtt_verdict_store_root", 2_000));
  fs.mkdirSync(storeRoot, { recursive: true });
  const eventFile = path.join(storeRoot, "events.jsonl");
  const lockFile = path.join(storeRoot, "events.lock");

  function events() {
    if (!fs.existsSync(eventFile)) return [];
    const parsed = fs.readFileSync(eventFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    let previousHash = null;
    for (let index = 0; index < parsed.length; index += 1) {
      const event = parsed[index];
      const { event_hash: eventHash, ...unsigned } = event;
      if (
        event?.schema_version !== "dtt_join_verdict_event_v1"
        || event.sequence !== index + 1
        || event.previous_hash !== previousHash
        || eventHash !== digest(unsigned)
      ) {
        throw new Error("dtt_join_verdict_ledger_integrity_failed");
      }
      previousHash = eventHash;
    }
    return parsed;
  }

  function append(type, payload) {
    let lockFd;
    try {
      lockFd = fs.openSync(lockFile, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("dtt_join_verdict_store_locked");
      throw error;
    }
    try {
      const current = events();
      const previousHash = current.at(-1)?.event_hash || null;
      const event = {
        schema_version: "dtt_join_verdict_event_v1",
        sequence: current.length + 1,
        event_type: type,
        created_at: now(),
        previous_hash: previousHash,
        ...payload,
      };
      event.event_hash = digest(event);
      fs.appendFileSync(eventFile, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
      return event;
    } finally {
      if (lockFd !== undefined) fs.closeSync(lockFd);
      try {
        fs.unlinkSync(lockFile);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }

  function activeForTree(tenantId, treeId) {
    const relevant = events().filter((event) => event.tenant_id === tenantId && event.tree_id === treeId);
    const issued = [...relevant].reverse().find((event) => event.event_type === "issued");
    if (!issued) return null;
    const terminal = relevant.find((event) =>
      event.verdict_reference === issued.verdict_reference
      && ["consumed", "voided"].includes(event.event_type));
    return terminal ? null : issued;
  }

  return {
    kind: "append_only_file_hash_chain_v1",
    restart_durable: true,
    distributed: false,

    issue({ tenant_id, tree_id, key_id, evidence_set_digest }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const treeId = requireText(tree_id, "tree_id", 160);
      if (activeForTree(tenantId, treeId)) throw new Error("dtt_join_verdict_already_issued");
      const issuedAt = now();
      const reference = `dttv_${digest({
        tenant_id: tenantId,
        tree_id: treeId,
        key_id: requireText(key_id, "key_id", 160),
        evidence_set_digest: requireText(evidence_set_digest, "evidence_set_digest", 160),
        issued_at: issuedAt,
        nonce: crypto.randomUUID(),
      })}`;
      return append("issued", {
        tenant_id: tenantId,
        tree_id: treeId,
        key_id,
        evidence_set_digest,
        verdict_reference: reference,
        authority: "universal_core",
        allowed: true,
        execution_authorized: false,
      });
    },

    consume({ tenant_id, tree_id, verdict_reference }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const treeId = requireText(tree_id, "tree_id", 160);
      const reference = requireText(verdict_reference, "verdict_reference", 200);
      const active = activeForTree(tenantId, treeId);
      if (!active || active.verdict_reference !== reference) throw new Error("dtt_join_verdict_not_active");
      return append("consumed", {
        tenant_id: tenantId,
        tree_id: treeId,
        verdict_reference: reference,
        execution_authorized: false,
      });
    },

    void({ tenant_id, tree_id, verdict_reference, reason }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const treeId = requireText(tree_id, "tree_id", 160);
      const reference = requireText(verdict_reference, "verdict_reference", 200);
      const active = activeForTree(tenantId, treeId);
      if (!active || active.verdict_reference !== reference) return null;
      return append("voided", {
        tenant_id: tenantId,
        tree_id: treeId,
        verdict_reference: reference,
        reason: requireText(reason, "void_reason", 500),
        execution_authorized: false,
      });
    },

    read({ tenant_id, tree_id }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const treeId = requireText(tree_id, "tree_id", 160);
      return events().filter((event) => event.tenant_id === tenantId && event.tree_id === treeId);
    },
  };
}

export function createPostgresDynamicTaskTreeJoinVerdictStore({
  connectionString,
  pool = null,
  now = () => new Date().toISOString(),
} = {}) {
  const url = requireText(connectionString, "dtt_verdict_database_url", 4_000);
  if (!/^postgres(?:ql)?:\/\//i.test(url)) throw new Error("dtt_verdict_database_url_invalid");
  const db = pool || new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 10_000 });
  let initialized;

  function initialize() {
    initialized ||= db.query(`
      CREATE TABLE IF NOT EXISTS dynamic_task_tree_join_verdicts (
        tenant_id varchar(120) NOT NULL,
        tree_id varchar(160) NOT NULL,
        verdict_reference varchar(200) PRIMARY KEY,
        key_id varchar(160) NOT NULL,
        evidence_set_digest varchar(160) NOT NULL,
        authority varchar(64) NOT NULL,
        allowed boolean NOT NULL,
        execution_authorized boolean NOT NULL,
        status varchar(32) NOT NULL,
        issued_at timestamptz NOT NULL,
        finalized_at timestamptz
      );
      CREATE UNIQUE INDEX IF NOT EXISTS dynamic_task_tree_join_verdict_active_idx
        ON dynamic_task_tree_join_verdicts (tenant_id, tree_id)
        WHERE status='issued';
      CREATE TABLE IF NOT EXISTS dynamic_task_tree_join_verdict_events (
        tenant_id varchar(120) NOT NULL,
        tree_id varchar(160) NOT NULL,
        verdict_reference varchar(200) NOT NULL,
        sequence integer NOT NULL,
        event_type varchar(32) NOT NULL,
        event jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (tenant_id, tree_id, sequence),
        UNIQUE (verdict_reference, event_type),
        FOREIGN KEY (verdict_reference)
          REFERENCES dynamic_task_tree_join_verdicts (verdict_reference)
      );
      CREATE INDEX IF NOT EXISTS dynamic_task_tree_join_verdict_events_scope_idx
        ON dynamic_task_tree_join_verdict_events (tenant_id, tree_id, sequence);
    `);
    return initialized;
  }

  function verifyEvents(rows) {
    let previousHash = null;
    return rows.map((row, index) => {
      const event = typeof row.event === "string" ? JSON.parse(row.event) : row.event;
      const { event_hash: eventHash, ...unsigned } = event;
      if (
        event?.schema_version !== "dtt_join_verdict_event_v1"
        || event.sequence !== index + 1
        || event.previous_hash !== previousHash
        || eventHash !== digest(unsigned)
      ) throw new Error("dtt_join_verdict_ledger_integrity_failed");
      previousHash = eventHash;
      return event;
    });
  }

  async function lockedEvents(client, tenantId, treeId) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${tenantId}\u0000${treeId}`]);
    const result = await client.query(
      "SELECT event FROM dynamic_task_tree_join_verdict_events WHERE tenant_id=$1 AND tree_id=$2 ORDER BY sequence FOR UPDATE",
      [tenantId, treeId],
    );
    return verifyEvents(result.rows);
  }

  async function appendEvent(client, current, type, payload) {
    const event = {
      schema_version: "dtt_join_verdict_event_v1",
      sequence: current.length + 1,
      event_type: type,
      created_at: now(),
      previous_hash: current.at(-1)?.event_hash || null,
      ...payload,
    };
    event.event_hash = digest(event);
    await client.query(
      `INSERT INTO dynamic_task_tree_join_verdict_events
       (tenant_id,tree_id,verdict_reference,sequence,event_type,event,created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        event.tenant_id,
        event.tree_id,
        event.verdict_reference,
        event.sequence,
        event.event_type,
        JSON.stringify(event),
        event.created_at,
      ],
    );
    return event;
  }

  async function inTransaction(work) {
    await initialize();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    kind: "append_only_postgresql_hash_chain_v1",
    restart_durable: true,
    distributed: true,

    async issue({ tenant_id, tree_id, key_id, evidence_set_digest }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const treeId = requireText(tree_id, "tree_id", 160);
      try {
        return await inTransaction(async (client) => {
          const current = await lockedEvents(client, tenantId, treeId);
          const existing = await client.query(
            "SELECT verdict_reference FROM dynamic_task_tree_join_verdicts WHERE tenant_id=$1 AND tree_id=$2 AND status='issued' FOR UPDATE",
            [tenantId, treeId],
          );
          if (existing.rowCount) throw new Error("dtt_join_verdict_already_issued");
          const issuedAt = now();
          const reference = `dttv_${digest({
            tenant_id: tenantId,
            tree_id: treeId,
            key_id: requireText(key_id, "key_id", 160),
            evidence_set_digest: requireText(evidence_set_digest, "evidence_set_digest", 160),
            issued_at: issuedAt,
            nonce: crypto.randomUUID(),
          })}`;
          await client.query(
            `INSERT INTO dynamic_task_tree_join_verdicts
             (tenant_id,tree_id,verdict_reference,key_id,evidence_set_digest,authority,allowed,execution_authorized,status,issued_at)
             VALUES ($1,$2,$3,$4,$5,'universal_core',true,false,'issued',$6)`,
            [tenantId, treeId, reference, key_id, evidence_set_digest, issuedAt],
          );
          return appendEvent(client, current, "issued", {
            tenant_id: tenantId,
            tree_id: treeId,
            key_id,
            evidence_set_digest,
            verdict_reference: reference,
            authority: "universal_core",
            allowed: true,
            execution_authorized: false,
          });
        });
      } catch (error) {
        if (error?.code === "23505") throw new Error("dtt_join_verdict_already_issued");
        throw error;
      }
    },

    async consume({ tenant_id, tree_id, verdict_reference }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const treeId = requireText(tree_id, "tree_id", 160);
      const reference = requireText(verdict_reference, "verdict_reference", 200);
      return inTransaction(async (client) => {
        const current = await lockedEvents(client, tenantId, treeId);
        const issued = current.find((event) => event.event_type === "issued" && event.verdict_reference === reference);
        const terminal = current.some((event) =>
          event.verdict_reference === reference && ["consumed", "voided"].includes(event.event_type));
        if (!issued || terminal) throw new Error("dtt_join_verdict_not_active");
        const finalized = await client.query(
          `UPDATE dynamic_task_tree_join_verdicts
           SET status='consumed',finalized_at=$4
           WHERE tenant_id=$1 AND tree_id=$2 AND verdict_reference=$3 AND status='issued'`,
          [tenantId, treeId, reference, now()],
        );
        if (finalized.rowCount !== 1) throw new Error("dtt_join_verdict_not_active");
        return appendEvent(client, current, "consumed", {
          tenant_id: tenantId,
          tree_id: treeId,
          verdict_reference: reference,
          execution_authorized: false,
        });
      });
    },

    async void({ tenant_id, tree_id, verdict_reference, reason }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const treeId = requireText(tree_id, "tree_id", 160);
      const reference = requireText(verdict_reference, "verdict_reference", 200);
      return inTransaction(async (client) => {
        const current = await lockedEvents(client, tenantId, treeId);
        const issued = current.find((event) => event.event_type === "issued" && event.verdict_reference === reference);
        const terminal = current.some((event) =>
          event.verdict_reference === reference && ["consumed", "voided"].includes(event.event_type));
        if (!issued || terminal) return null;
        const finalized = await client.query(
          `UPDATE dynamic_task_tree_join_verdicts
           SET status='voided',finalized_at=$4
           WHERE tenant_id=$1 AND tree_id=$2 AND verdict_reference=$3 AND status='issued'`,
          [tenantId, treeId, reference, now()],
        );
        if (finalized.rowCount !== 1) return null;
        return appendEvent(client, current, "voided", {
          tenant_id: tenantId,
          tree_id: treeId,
          verdict_reference: reference,
          reason: requireText(reason, "void_reason", 500),
          execution_authorized: false,
        });
      });
    },

    async read({ tenant_id, tree_id }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const treeId = requireText(tree_id, "tree_id", 160);
      await initialize();
      const result = await db.query(
        "SELECT event FROM dynamic_task_tree_join_verdict_events WHERE tenant_id=$1 AND tree_id=$2 ORDER BY sequence",
        [tenantId, treeId],
      );
      return verifyEvents(result.rows);
    },

    async close() {
      if (!pool) await db.end();
    },
  };
}

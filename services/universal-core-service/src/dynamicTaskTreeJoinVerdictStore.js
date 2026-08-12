import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

function requireText(value, field, max = 200) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function requireWorkId(value) {
  if (typeof value !== "string") throw new Error("work_id_invalid");
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error("work_id_invalid");
  }
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
  // events.jsonl is the immutable V1 ledger. Work-bound V2 ledgers are
  // separate per scope, so legacy bytes are never rewritten or auto-bound.
  function scopeFor({ tenant_id, work_id, tree_id }) {
    return {
      tenant_id: requireText(tenant_id, "tenant_id", 120),
      work_id: requireWorkId(work_id),
      tree_id: requireText(tree_id, "tree_id", 160),
    };
  }

  function filesFor(scope) {
    const suffix = digest(scope);
    return {
      eventFile: path.join(storeRoot, `events-v2-${suffix}.jsonl`),
      lockFile: path.join(storeRoot, `events-v2-${suffix}.lock`),
    };
  }

  function events(scope) {
    const { eventFile } = filesFor(scope);
    if (!fs.existsSync(eventFile)) return [];
    let parsed;
    try {
      parsed = fs.readFileSync(eventFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      throw new Error("dtt_join_verdict_ledger_integrity_failed");
    }
    let previousHash = null;
    for (let index = 0; index < parsed.length; index += 1) {
      const event = parsed[index];
      const { event_hash: eventHash, ...unsigned } = event;
      if (
        event?.schema_version !== "dtt_join_verdict_event_v2"
        || event.tenant_id !== scope.tenant_id
        || event.work_id !== scope.work_id
        || event.tree_id !== scope.tree_id
        || event.execution_authorized !== false
        || (event.event_type === "issued" && event.verdict_schema_version !== "dtt_join_verdict_v2")
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

  function append(scope, type, payload) {
    const { eventFile, lockFile } = filesFor(scope);
    let lockFd;
    try {
      lockFd = fs.openSync(lockFile, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("dtt_join_verdict_store_locked");
      throw error;
    }
    try {
      const current = events(scope);
      const previousHash = current.at(-1)?.event_hash || null;
      const event = {
        schema_version: "dtt_join_verdict_event_v2",
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

  function activeForTree(scope) {
    const relevant = events(scope);
    const issued = [...relevant].reverse().find((event) => event.event_type === "issued");
    if (!issued) return null;
    const terminal = relevant.find((event) =>
      event.verdict_reference === issued.verdict_reference
      && ["consumed", "voided"].includes(event.event_type));
    return terminal ? null : issued;
  }

  return {
    kind: "append_only_file_hash_chain_v2",
    restart_durable: true,
    distributed: false,

    issue({ tenant_id, work_id, tree_id, key_id, evidence_set_digest }) {
      const scope = scopeFor({ tenant_id, work_id, tree_id });
      if (activeForTree(scope)) throw new Error("dtt_join_verdict_already_issued");
      const keyId = requireText(key_id, "key_id", 160);
      const evidenceSetDigest = requireText(evidence_set_digest, "evidence_set_digest", 160);
      const issuedAt = now();
      const reference = `dttv_${digest({
        ...scope,
        key_id: keyId,
        evidence_set_digest: evidenceSetDigest,
        issued_at: issuedAt,
        nonce: crypto.randomUUID(),
      })}`;
      return append(scope, "issued", {
        ...scope,
        verdict_schema_version: "dtt_join_verdict_v2",
        key_id: keyId,
        evidence_set_digest: evidenceSetDigest,
        verdict_reference: reference,
        authority: "universal_core",
        allowed: true,
        execution_authorized: false,
      });
    },

    consume({ tenant_id, work_id, tree_id, verdict_reference }) {
      const scope = scopeFor({ tenant_id, work_id, tree_id });
      const reference = requireText(verdict_reference, "verdict_reference", 200);
      const active = activeForTree(scope);
      if (!active || active.verdict_reference !== reference) throw new Error("dtt_join_verdict_not_active");
      return append(scope, "consumed", {
        ...scope,
        verdict_reference: reference,
        execution_authorized: false,
      });
    },

    void({ tenant_id, work_id, tree_id, verdict_reference, reason }) {
      const scope = scopeFor({ tenant_id, work_id, tree_id });
      const reference = requireText(verdict_reference, "verdict_reference", 200);
      const active = activeForTree(scope);
      if (!active || active.verdict_reference !== reference) return null;
      return append(scope, "voided", {
        ...scope,
        verdict_reference: reference,
        reason: requireText(reason, "void_reason", 500),
        execution_authorized: false,
      });
    },

    read({ tenant_id, work_id, tree_id }) {
      const scope = scopeFor({ tenant_id, work_id, tree_id });
      return events(scope);
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

  function scopeFor({ tenant_id, work_id, tree_id }) {
    return {
      tenant_id: requireText(tenant_id, "tenant_id", 120),
      work_id: requireWorkId(work_id),
      tree_id: requireText(tree_id, "tree_id", 160),
    };
  }

  function initialize() {
    initialized ||= db.query(`
      CREATE TABLE IF NOT EXISTS dynamic_task_tree_join_verdicts_v2 (
        tenant_id varchar(120) NOT NULL,
        work_id uuid NOT NULL,
        tree_id varchar(160) NOT NULL,
        verdict_reference varchar(200) PRIMARY KEY,
        key_id varchar(160) NOT NULL,
        evidence_set_digest varchar(160) NOT NULL,
        verdict_schema_version varchar(64) NOT NULL,
        authority varchar(64) NOT NULL,
        allowed boolean NOT NULL,
        execution_authorized boolean NOT NULL CHECK (execution_authorized=false),
        status varchar(32) NOT NULL,
        issued_at timestamptz NOT NULL,
        finalized_at timestamptz
      );
      CREATE UNIQUE INDEX IF NOT EXISTS dynamic_task_tree_join_verdict_v2_active_idx
        ON dynamic_task_tree_join_verdicts_v2 (tenant_id, work_id, tree_id)
        WHERE status='issued';
      CREATE TABLE IF NOT EXISTS dynamic_task_tree_join_verdict_events_v2 (
        tenant_id varchar(120) NOT NULL,
        work_id uuid NOT NULL,
        tree_id varchar(160) NOT NULL,
        verdict_reference varchar(200) NOT NULL,
        sequence integer NOT NULL,
        event_type varchar(32) NOT NULL,
        event jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (tenant_id, work_id, tree_id, sequence),
        UNIQUE (verdict_reference, event_type),
        FOREIGN KEY (verdict_reference)
          REFERENCES dynamic_task_tree_join_verdicts_v2 (verdict_reference)
      );
      CREATE INDEX IF NOT EXISTS dynamic_task_tree_join_verdict_events_v2_scope_idx
        ON dynamic_task_tree_join_verdict_events_v2 (tenant_id, work_id, tree_id, sequence);
    `);
    return initialized;
  }

  function verifyEvents(rows, scope) {
    let previousHash = null;
    return rows.map((row, index) => {
      let event;
      try {
        event = typeof row.event === "string" ? JSON.parse(row.event) : row.event;
      } catch {
        throw new Error("dtt_join_verdict_ledger_integrity_failed");
      }
      const { event_hash: eventHash, ...unsigned } = event;
      if (
        event?.schema_version !== "dtt_join_verdict_event_v2"
        || event.tenant_id !== scope.tenant_id
        || event.work_id !== scope.work_id
        || event.tree_id !== scope.tree_id
        || event.execution_authorized !== false
        || (event.event_type === "issued" && event.verdict_schema_version !== "dtt_join_verdict_v2")
        || event.sequence !== index + 1
        || event.previous_hash !== previousHash
        || eventHash !== digest(unsigned)
      ) throw new Error("dtt_join_verdict_ledger_integrity_failed");
      previousHash = eventHash;
      return event;
    });
  }

  async function lockedEvents(client, scope) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${scope.tenant_id}\u0000${scope.work_id}\u0000${scope.tree_id}`,
    ]);
    const result = await client.query(
      "SELECT event FROM dynamic_task_tree_join_verdict_events_v2 WHERE tenant_id=$1 AND work_id=$2::uuid AND tree_id=$3 ORDER BY sequence FOR UPDATE",
      [scope.tenant_id, scope.work_id, scope.tree_id],
    );
    return verifyEvents(result.rows, scope);
  }

  async function appendEvent(client, current, type, payload) {
    const event = {
      schema_version: "dtt_join_verdict_event_v2",
      sequence: current.length + 1,
      event_type: type,
      created_at: now(),
      previous_hash: current.at(-1)?.event_hash || null,
      ...payload,
    };
    event.event_hash = digest(event);
    await client.query(
      `INSERT INTO dynamic_task_tree_join_verdict_events_v2
       (tenant_id,work_id,tree_id,verdict_reference,sequence,event_type,event,created_at)
       VALUES ($1,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8)`,
      [
        event.tenant_id,
        event.work_id,
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
    kind: "append_only_postgresql_hash_chain_v2",
    restart_durable: true,
    distributed: true,

    async issue({ tenant_id, work_id, tree_id, key_id, evidence_set_digest }) {
      const scope = scopeFor({ tenant_id, work_id, tree_id });
      try {
        return await inTransaction(async (client) => {
          const current = await lockedEvents(client, scope);
          const existing = await client.query(
            "SELECT verdict_reference FROM dynamic_task_tree_join_verdicts_v2 WHERE tenant_id=$1 AND work_id=$2::uuid AND tree_id=$3 AND status='issued' FOR UPDATE",
            [scope.tenant_id, scope.work_id, scope.tree_id],
          );
          if (existing.rowCount) throw new Error("dtt_join_verdict_already_issued");
          const keyId = requireText(key_id, "key_id", 160);
          const evidenceSetDigest = requireText(evidence_set_digest, "evidence_set_digest", 160);
          const issuedAt = now();
          const reference = `dttv_${digest({
            ...scope,
            key_id: keyId,
            evidence_set_digest: evidenceSetDigest,
            issued_at: issuedAt,
            nonce: crypto.randomUUID(),
          })}`;
          await client.query(
            `INSERT INTO dynamic_task_tree_join_verdicts_v2
             (tenant_id,work_id,tree_id,verdict_reference,key_id,evidence_set_digest,verdict_schema_version,authority,allowed,execution_authorized,status,issued_at)
             VALUES ($1,$2::uuid,$3,$4,$5,$6,'dtt_join_verdict_v2','universal_core',true,false,'issued',$7)`,
            [scope.tenant_id, scope.work_id, scope.tree_id, reference, keyId, evidenceSetDigest, issuedAt],
          );
          return appendEvent(client, current, "issued", {
            ...scope,
            verdict_schema_version: "dtt_join_verdict_v2",
            key_id: keyId,
            evidence_set_digest: evidenceSetDigest,
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

    async consume({ tenant_id, work_id, tree_id, verdict_reference }) {
      const scope = scopeFor({ tenant_id, work_id, tree_id });
      const reference = requireText(verdict_reference, "verdict_reference", 200);
      return inTransaction(async (client) => {
        const current = await lockedEvents(client, scope);
        const issued = current.find((event) => event.event_type === "issued" && event.verdict_reference === reference);
        const terminal = current.some((event) =>
          event.verdict_reference === reference && ["consumed", "voided"].includes(event.event_type));
        if (!issued || terminal) throw new Error("dtt_join_verdict_not_active");
        const finalized = await client.query(
          `UPDATE dynamic_task_tree_join_verdicts_v2
           SET status='consumed',finalized_at=$5
           WHERE tenant_id=$1 AND work_id=$2::uuid AND tree_id=$3 AND verdict_reference=$4 AND status='issued'`,
          [scope.tenant_id, scope.work_id, scope.tree_id, reference, now()],
        );
        if (finalized.rowCount !== 1) throw new Error("dtt_join_verdict_not_active");
        return appendEvent(client, current, "consumed", {
          ...scope,
          verdict_reference: reference,
          execution_authorized: false,
        });
      });
    },

    async void({ tenant_id, work_id, tree_id, verdict_reference, reason }) {
      const scope = scopeFor({ tenant_id, work_id, tree_id });
      const reference = requireText(verdict_reference, "verdict_reference", 200);
      return inTransaction(async (client) => {
        const current = await lockedEvents(client, scope);
        const issued = current.find((event) => event.event_type === "issued" && event.verdict_reference === reference);
        const terminal = current.some((event) =>
          event.verdict_reference === reference && ["consumed", "voided"].includes(event.event_type));
        if (!issued || terminal) return null;
        const finalized = await client.query(
          `UPDATE dynamic_task_tree_join_verdicts_v2
           SET status='voided',finalized_at=$5
           WHERE tenant_id=$1 AND work_id=$2::uuid AND tree_id=$3 AND verdict_reference=$4 AND status='issued'`,
          [scope.tenant_id, scope.work_id, scope.tree_id, reference, now()],
        );
        if (finalized.rowCount !== 1) return null;
        return appendEvent(client, current, "voided", {
          ...scope,
          verdict_reference: reference,
          reason: requireText(reason, "void_reason", 500),
          execution_authorized: false,
        });
      });
    },

    async read({ tenant_id, work_id, tree_id }) {
      const scope = scopeFor({ tenant_id, work_id, tree_id });
      await initialize();
      const result = await db.query(
        "SELECT event FROM dynamic_task_tree_join_verdict_events_v2 WHERE tenant_id=$1 AND work_id=$2::uuid AND tree_id=$3 ORDER BY sequence",
        [scope.tenant_id, scope.work_id, scope.tree_id],
      );
      return verifyEvents(result.rows, scope);
    },

    async close() {
      if (!pool) await db.end();
    },
  };
}

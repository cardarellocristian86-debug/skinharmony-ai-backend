import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeTreeId(value) {
  const treeId = String(value || "").trim();
  if (!/^dtt_[a-f0-9]{24}$/.test(treeId)) throw new Error("tree_id_invalid");
  return treeId;
}

function safeTenantId(value) {
  const tenantId = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,119}$/i.test(tenantId)) throw new Error("tenant_id_invalid");
  return tenantId;
}

function safeConnectionString(value) {
  const connectionString = String(value || "").trim();
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString) || connectionString.length > 4_000) {
    throw new Error("dynamic_task_tree_database_url_invalid");
  }
  return connectionString;
}

function validateStoredTree(tree, tenantId, treeId) {
  if (!tree || typeof tree !== "object" || Array.isArray(tree) || tree.tree_id !== treeId || tree.tenant_id !== tenantId) {
    throw new Error("dynamic_task_tree_state_corrupt");
  }
  return tree;
}

export function createFileDynamicTaskTreeStateStore({ root } = {}) {
  const storeRoot = path.resolve(String(root || ""));
  if (!root) throw new Error("dynamic_task_tree_store_root_required");
  fs.mkdirSync(storeRoot, { recursive: true });

  const fileFor = (treeId) => path.join(storeRoot, `${safeTreeId(treeId)}.json`);
  const lockFor = (treeId) => path.join(storeRoot, `${safeTreeId(treeId)}.lock`);

  function readRecord(treeId) {
    const file = fileFor(treeId);
    if (!fs.existsSync(file)) return null;
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      record?.schema_version !== "dynamic_task_tree_state_record_v1"
      || !Number.isInteger(record.revision)
      || record.revision < 1
      || record.tree?.tree_id !== treeId
    ) {
      throw new Error("dynamic_task_tree_state_corrupt");
    }
    return record;
  }

  return {
    kind: "file_cas_v1",
    restart_durable: true,
    distributed: false,

    load({ tree_id }) {
      const treeId = safeTreeId(tree_id);
      const record = readRecord(treeId);
      return record ? { tree: clone(record.tree), revision: record.revision } : null;
    },

    save({ tree, expected_revision = null }) {
      const treeId = safeTreeId(tree?.tree_id);
      const lock = lockFor(treeId);
      let lockFd;
      try {
        lockFd = fs.openSync(lock, "wx", 0o600);
      } catch (error) {
        if (error?.code === "EEXIST") throw new Error("dynamic_task_tree_state_locked");
        throw error;
      }
      try {
        const current = readRecord(treeId);
        const currentRevision = current?.revision ?? null;
        if (expected_revision !== currentRevision) throw new Error("dynamic_task_tree_revision_conflict");
        const revision = (currentRevision || 0) + 1;
        const record = {
          schema_version: "dynamic_task_tree_state_record_v1",
          revision,
          updated_at: new Date().toISOString(),
          tree: clone(tree),
        };
        const target = fileFor(treeId);
        const temporary = `${target}.${process.pid}.${revision}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o600 });
        fs.renameSync(temporary, target);
        return { revision };
      } finally {
        if (lockFd !== undefined) fs.closeSync(lockFd);
        try {
          fs.unlinkSync(lock);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    },
  };
}

export function createPostgresDynamicTaskTreeStateStore({
  connectionString,
  pool = null,
  now = () => new Date(),
} = {}) {
  const url = safeConnectionString(connectionString);
  const db = pool || new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 10_000 });
  let initialized;

  function initialize() {
    initialized ||= db.query(`
      CREATE TABLE IF NOT EXISTS dynamic_task_tree_states (
        tenant_id varchar(120) NOT NULL,
        tree_id varchar(160) NOT NULL,
        state jsonb NOT NULL,
        revision bigint NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (tenant_id, tree_id)
      );
      CREATE INDEX IF NOT EXISTS dynamic_task_tree_states_updated_idx
        ON dynamic_task_tree_states (tenant_id, updated_at DESC);
    `);
    return initialized;
  }

  return {
    kind: "postgresql_cas_v1",
    restart_durable: true,
    distributed: true,

    async load({ tenant_id, tree_id }) {
      const tenantId = safeTenantId(tenant_id);
      const treeId = safeTreeId(tree_id);
      await initialize();
      const result = await db.query(
        "SELECT state, revision, created_at, updated_at FROM dynamic_task_tree_states WHERE tenant_id=$1 AND tree_id=$2",
        [tenantId, treeId],
      );
      const row = result.rows[0];
      if (!row) return null;
      const tree = validateStoredTree(row.state, tenantId, treeId);
      const revision = Number(row.revision);
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("dynamic_task_tree_state_corrupt");
      return {
        tree: clone(tree),
        revision,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
      };
    },

    async save({ tree, expected_revision = null }) {
      const treeId = safeTreeId(tree?.tree_id);
      const tenantId = safeTenantId(tree?.tenant_id);
      validateStoredTree(tree, tenantId, treeId);
      if (expected_revision !== null && (!Number.isSafeInteger(expected_revision) || expected_revision < 1)) {
        throw new Error("dynamic_task_tree_expected_revision_invalid");
      }
      await initialize();
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          "SELECT revision, created_at FROM dynamic_task_tree_states WHERE tenant_id=$1 AND tree_id=$2 FOR UPDATE",
          [tenantId, treeId],
        );
        const row = current.rows[0] || null;
        const currentRevision = row ? Number(row.revision) : null;
        if (expected_revision !== currentRevision) throw new Error("dynamic_task_tree_revision_conflict");
        const timestamp = now();
        if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) throw new Error("dynamic_task_tree_timestamp_invalid");
        let saved;
        if (currentRevision === null) {
          saved = await client.query(
            "INSERT INTO dynamic_task_tree_states (tenant_id,tree_id,state,revision,created_at,updated_at) VALUES ($1,$2,$3::jsonb,1,$4,$4) RETURNING revision,created_at,updated_at",
            [tenantId, treeId, JSON.stringify(tree), timestamp.toISOString()],
          );
        } else {
          saved = await client.query(
            "UPDATE dynamic_task_tree_states SET state=$3::jsonb,revision=revision+1,updated_at=$4 WHERE tenant_id=$1 AND tree_id=$2 AND revision=$5 RETURNING revision,created_at,updated_at",
            [tenantId, treeId, JSON.stringify(tree), timestamp.toISOString(), currentRevision],
          );
          if (saved.rowCount !== 1) throw new Error("dynamic_task_tree_revision_conflict");
        }
        await client.query("COMMIT");
        return {
          revision: Number(saved.rows[0].revision),
          created_at: new Date(saved.rows[0].created_at).toISOString(),
          updated_at: new Date(saved.rows[0].updated_at).toISOString(),
        };
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        if (error?.code === "23505") throw new Error("dynamic_task_tree_revision_conflict");
        throw error;
      } finally {
        client.release();
      }
    },

    async close() {
      if (!pool) await db.end();
    },
  };
}

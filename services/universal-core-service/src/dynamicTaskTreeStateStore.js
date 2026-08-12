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

function safeWorkId(value) {
  if (typeof value !== "string") throw new Error("work_id_invalid");
  const workId = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(workId)) {
    throw new Error("work_id_invalid");
  }
  return workId;
}

function safeConnectionString(value) {
  const connectionString = String(value || "").trim();
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString) || connectionString.length > 4_000) {
    throw new Error("dynamic_task_tree_database_url_invalid");
  }
  return connectionString;
}

function storedWorkId(tree) {
  if (!Object.hasOwn(tree || {}, "work_id") || tree.work_id === null || String(tree.work_id || "").trim() === "") {
    throw new Error("dtt_work_binding_required");
  }
  try {
    return safeWorkId(tree.work_id);
  } catch {
    throw new Error("dynamic_task_tree_state_corrupt");
  }
}

function validateStoredTree(tree, tenantId, workId, treeId, { row_work_id } = {}) {
  if (!tree || typeof tree !== "object" || Array.isArray(tree) || tree.tree_id !== treeId) {
    throw new Error("dynamic_task_tree_state_corrupt");
  }
  if (tree.tenant_id !== tenantId) throw new Error("cross_tenant_task_tree_denied");
  if (row_work_id === null) throw new Error("dtt_work_binding_required");
  const boundWorkId = storedWorkId(tree);
  if (boundWorkId !== workId) throw new Error("cross_work_task_tree_denied");
  if (row_work_id !== undefined && row_work_id !== null) {
    let rowWorkId;
    try {
      rowWorkId = safeWorkId(row_work_id);
    } catch {
      throw new Error("dynamic_task_tree_state_corrupt");
    }
    if (rowWorkId !== boundWorkId) throw new Error("dynamic_task_tree_state_corrupt");
  }
  return tree;
}

export function createFileDynamicTaskTreeStateStore({ root } = {}) {
  const storeRoot = path.resolve(String(root || ""));
  if (!root) throw new Error("dynamic_task_tree_store_root_required");
  fs.mkdirSync(storeRoot, { recursive: true });

  const fileFor = (treeId) => path.join(storeRoot, `${safeTreeId(treeId)}.json`);
  const lockFor = (treeId) => path.join(storeRoot, `${safeTreeId(treeId)}.lock`);

  function readRecord({ tenantId, workId, treeId }) {
    const file = fileFor(treeId);
    if (!fs.existsSync(file)) return null;
    let record;
    try {
      record = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      throw new Error("dynamic_task_tree_state_corrupt");
    }
    if (
      !["dynamic_task_tree_state_record_v1", "dynamic_task_tree_state_record_v2"].includes(record?.schema_version)
      || !Number.isInteger(record.revision)
      || record.revision < 1
      || record.tree?.tree_id !== treeId
    ) {
      throw new Error("dynamic_task_tree_state_corrupt");
    }
    if (record.schema_version !== "dynamic_task_tree_state_record_v2") {
      throw new Error("dtt_work_binding_required");
    }
    validateStoredTree(record.tree, tenantId, workId, treeId);
    if (record.tenant_id !== tenantId || record.work_id !== workId) {
      throw new Error("dynamic_task_tree_state_corrupt");
    }
    return record;
  }

  return {
    kind: "file_cas_v2",
    restart_durable: true,
    distributed: false,

    load({ tenant_id, work_id, tree_id }) {
      const tenantId = safeTenantId(tenant_id);
      const workId = safeWorkId(work_id);
      const treeId = safeTreeId(tree_id);
      const record = readRecord({ tenantId, workId, treeId });
      return record ? { tree: clone(record.tree), revision: record.revision } : null;
    },

    save({ tree, expected_revision = null }) {
      const treeId = safeTreeId(tree?.tree_id);
      const tenantId = safeTenantId(tree?.tenant_id);
      const workId = safeWorkId(tree?.work_id);
      validateStoredTree(tree, tenantId, workId, treeId);
      if (expected_revision !== null && (!Number.isSafeInteger(expected_revision) || expected_revision < 1)) {
        throw new Error("dynamic_task_tree_expected_revision_invalid");
      }
      const lock = lockFor(treeId);
      let lockFd;
      try {
        lockFd = fs.openSync(lock, "wx", 0o600);
      } catch (error) {
        if (error?.code === "EEXIST") throw new Error("dynamic_task_tree_state_locked");
        throw error;
      }
      try {
        const current = readRecord({ tenantId, workId, treeId });
        const currentRevision = current?.revision ?? null;
        if (expected_revision !== currentRevision) throw new Error("dynamic_task_tree_revision_conflict");
        const revision = (currentRevision || 0) + 1;
        const record = {
          schema_version: "dynamic_task_tree_state_record_v2",
          tenant_id: tenantId,
          work_id: workId,
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
      CREATE TABLE IF NOT EXISTS dynamic_task_tree_states_v2 (
        tenant_id varchar(120) NOT NULL,
        work_id uuid NOT NULL,
        tree_id varchar(160) NOT NULL,
        state jsonb NOT NULL,
        revision bigint NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (tenant_id, work_id, tree_id)
      );
      CREATE INDEX IF NOT EXISTS dynamic_task_tree_states_v2_updated_idx
        ON dynamic_task_tree_states_v2 (tenant_id, work_id, updated_at DESC);
    `);
    return initialized;
  }

  async function legacyStateExists(queryable, tenantId, treeId) {
    const relation = await queryable.query(
      "SELECT to_regclass('dynamic_task_tree_states')::text AS legacy_table",
    );
    if (!relation.rows[0]?.legacy_table) return false;
    const legacy = await queryable.query(
      "SELECT 1 FROM dynamic_task_tree_states WHERE tenant_id=$1 AND tree_id=$2 LIMIT 1",
      [tenantId, treeId],
    );
    return legacy.rowCount > 0;
  }

  return {
    kind: "postgresql_cas_v2",
    restart_durable: true,
    distributed: true,

    async load({ tenant_id, work_id, tree_id }) {
      const tenantId = safeTenantId(tenant_id);
      const workId = safeWorkId(work_id);
      const treeId = safeTreeId(tree_id);
      await initialize();
      let result = await db.query(
        "SELECT work_id, state, revision, created_at, updated_at FROM dynamic_task_tree_states_v2 WHERE tenant_id=$1 AND work_id=$2::uuid AND tree_id=$3",
        [tenantId, workId, treeId],
      );
      if (!result.rows[0]) {
        result = await db.query(
          "SELECT work_id, state, revision, created_at, updated_at FROM dynamic_task_tree_states_v2 WHERE tenant_id=$1 AND tree_id=$2",
          [tenantId, treeId],
        );
      }
      const row = result.rows[0];
      if (!row) {
        if (await legacyStateExists(db, tenantId, treeId)) throw new Error("dtt_work_binding_required");
        return null;
      }
      const tree = validateStoredTree(row.state, tenantId, workId, treeId, { row_work_id: row.work_id });
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
      const workId = safeWorkId(tree?.work_id);
      validateStoredTree(tree, tenantId, workId, treeId);
      if (expected_revision !== null && (!Number.isSafeInteger(expected_revision) || expected_revision < 1)) {
        throw new Error("dynamic_task_tree_expected_revision_invalid");
      }
      await initialize();
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          "SELECT work_id, state, revision, created_at FROM dynamic_task_tree_states_v2 WHERE tenant_id=$1 AND work_id=$2::uuid AND tree_id=$3 FOR UPDATE",
          [tenantId, workId, treeId],
        );
        const row = current.rows[0] || null;
        if (row) validateStoredTree(row.state, tenantId, workId, treeId, { row_work_id: row.work_id });
        if (!row) {
          const crossWork = await client.query(
            "SELECT 1 FROM dynamic_task_tree_states_v2 WHERE tenant_id=$1 AND tree_id=$2 LIMIT 1 FOR UPDATE",
            [tenantId, treeId],
          );
          if (crossWork.rowCount > 0) throw new Error("cross_work_task_tree_denied");
          if (await legacyStateExists(client, tenantId, treeId)) throw new Error("dtt_work_binding_required");
        }
        const currentRevision = row ? Number(row.revision) : null;
        if (expected_revision !== currentRevision) throw new Error("dynamic_task_tree_revision_conflict");
        const timestamp = now();
        if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) throw new Error("dynamic_task_tree_timestamp_invalid");
        let saved;
        if (currentRevision === null) {
          saved = await client.query(
            "INSERT INTO dynamic_task_tree_states_v2 (tenant_id,work_id,tree_id,state,revision,created_at,updated_at) VALUES ($1,$2::uuid,$3,$4::jsonb,1,$5,$5) RETURNING revision,created_at,updated_at",
            [tenantId, workId, treeId, JSON.stringify(tree), timestamp.toISOString()],
          );
        } else {
          saved = await client.query(
            "UPDATE dynamic_task_tree_states_v2 SET state=$4::jsonb,revision=revision+1,updated_at=$5 WHERE tenant_id=$1 AND work_id=$2::uuid AND tree_id=$3 AND revision=$6 RETURNING revision,created_at,updated_at",
            [tenantId, workId, treeId, JSON.stringify(tree), timestamp.toISOString(), currentRevision],
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

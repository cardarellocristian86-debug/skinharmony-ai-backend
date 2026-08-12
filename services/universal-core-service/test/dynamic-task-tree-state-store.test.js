import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDynamicTaskTreeRuntime } from "../src/dynamicTaskTree.js";
import {
  createFileDynamicTaskTreeStateStore,
  createPostgresDynamicTaskTreeStateStore,
} from "../src/dynamicTaskTreeStateStore.js";

const WORK_A = "11111111-1111-4111-8111-111111111111";
const WORK_B = "22222222-2222-4222-8222-222222222222";

test("DTT file CAS store survives runtime restart and is visible across instances", async () => {
  const root = path.join(os.tmpdir(), `dtt-state-${Date.now()}-${Math.random()}`);
  const storeA = createFileDynamicTaskTreeStateStore({ root });
  const runtimeA = createDynamicTaskTreeRuntime({ state_store: storeA });
  const tree = await runtimeA.create({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    objective: "Persist non-executive lifecycle state",
    nodes: [{ node_id: "verify", kind: "analysis", task: "Verify persisted state" }],
  });

  const runtimeAfterRestart = createDynamicTaskTreeRuntime({
    state_store: createFileDynamicTaskTreeStateStore({ root }),
  });
  const restored = await runtimeAfterRestart.get({ tenant_id: "tenant-a", work_id: WORK_A, tree_id: tree.tree_id });
  assert.equal(restored.tree_id, tree.tree_id);
  assert.equal(restored.status, "advisory_ready");

  const secondInstance = createDynamicTaskTreeRuntime({
    state_store: createFileDynamicTaskTreeStateStore({ root }),
  });
  const cancelled = await secondInstance.cancel({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: tree.tree_id,
    reason: "Cross-instance state visibility test",
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(
    (await runtimeAfterRestart.get({ tenant_id: "tenant-a", work_id: WORK_A, tree_id: tree.tree_id })).status,
    "cancelled",
  );
  await assert.rejects(
    runtimeAfterRestart.get({ tenant_id: "tenant-b", work_id: WORK_A, tree_id: tree.tree_id }),
    /cross_tenant_task_tree_denied/,
  );
});

test("DTT state store rejects stale revisions and malformed identifiers", async () => {
  const root = path.join(os.tmpdir(), `dtt-state-cas-${Date.now()}-${Math.random()}`);
  const store = createFileDynamicTaskTreeStateStore({ root });
  const runtime = createDynamicTaskTreeRuntime({ state_store: store });
  const tree = await runtime.create({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    objective: "Exercise compare and swap",
    nodes: [{ node_id: "verify", kind: "analysis", task: "Verify CAS" }],
  });
  const record = store.load({ tenant_id: "tenant-a", work_id: WORK_A, tree_id: tree.tree_id });
  assert.equal(record.revision, 1);
  store.save({ tree: { ...record.tree, status: "checkpointed" }, expected_revision: 1 });
  assert.throws(
    () => store.save({ tree: record.tree, expected_revision: 1 }),
    /dynamic_task_tree_revision_conflict/,
  );
  assert.throws(() => store.load({ tenant_id: "tenant-a", work_id: WORK_A, tree_id: "../../escape" }), /tree_id_invalid/);
  fs.writeFileSync(path.join(root, `${tree.tree_id}.json`), "{malformed", { encoding: "utf8" });
  assert.throws(
    () => store.load({ tenant_id: "tenant-a", work_id: WORK_A, tree_id: tree.tree_id }),
    /dynamic_task_tree_state_corrupt/,
  );
});

test("DTT file CAS state is independently durable per Work", async () => {
  const root = path.join(os.tmpdir(), `dtt-state-work-scope-${Date.now()}-${Math.random()}`);
  const runtime = createDynamicTaskTreeRuntime({
    state_store: createFileDynamicTaskTreeStateStore({ root }),
  });
  const plan = {
    tenant_id: "tenant-a",
    objective: "Same plan in separate Works",
    nodes: [{ node_id: "node", kind: "analysis", task: "Remain advisory", retry_policy: { max_attempts: 2 } }],
  };
  const treeA = await runtime.create({ ...plan, work_id: WORK_A });
  const treeB = await runtime.create({ ...plan, work_id: WORK_B });
  assert.notEqual(treeA.tree_id, treeB.tree_id);

  await runtime.recordOutcome({
    tenant_id: "tenant-a", work_id: WORK_A, tree_id: treeA.tree_id, node_id: "node",
    idempotency_key: "same-key", outcome: "failed", evidence: {},
  });
  const store = createFileDynamicTaskTreeStateStore({ root });
  assert.equal(store.load({ tenant_id: "tenant-a", work_id: WORK_A, tree_id: treeA.tree_id }).revision, 2);
  assert.equal(store.load({ tenant_id: "tenant-a", work_id: WORK_B, tree_id: treeB.tree_id }).revision, 1);
  assert.throws(
    () => store.load({ tenant_id: "tenant-a", work_id: WORK_B, tree_id: treeA.tree_id }),
    /cross_work_task_tree_denied/,
  );

  const restarted = createDynamicTaskTreeRuntime({
    state_store: createFileDynamicTaskTreeStateStore({ root }),
  });
  assert.equal((await restarted.get({ tenant_id: "tenant-a", work_id: WORK_A, tree_id: treeA.tree_id })).nodes[0].attempts, 1);
  assert.equal((await restarted.get({ tenant_id: "tenant-a", work_id: WORK_B, tree_id: treeB.tree_id })).nodes[0].attempts, 0);
});

test("DTT legacy unbound file state is denied without mutation or auto-binding", async () => {
  const root = path.join(os.tmpdir(), `dtt-state-legacy-${Date.now()}-${Math.random()}`);
  const store = createFileDynamicTaskTreeStateStore({ root });
  const treeId = "dtt_bbbbbbbbbbbbbbbbbbbbbbbb";
  const file = path.join(root, `${treeId}.json`);
  const legacyRecord = {
    schema_version: "dynamic_task_tree_state_record_v1",
    revision: 1,
    updated_at: "2026-08-10T00:00:00.000Z",
    tree: {
      tree_id: treeId,
      tenant_id: "tenant-a",
      work_id: WORK_A,
      status: "advisory_ready",
    },
  };
  fs.writeFileSync(file, JSON.stringify(legacyRecord, null, 2), { encoding: "utf8", mode: 0o600 });
  const originalBytes = fs.readFileSync(file);
  const runtime = createDynamicTaskTreeRuntime({ state_store: store });
  await assert.rejects(
    runtime.get({ tenant_id: "tenant-a", work_id: WORK_A, tree_id: treeId }),
    /dtt_work_binding_required/,
  );
  assert.throws(
    () => store.save({ tree: { ...legacyRecord.tree, work_id: WORK_A }, expected_revision: 1 }),
    /dtt_work_binding_required/,
  );
  assert.deepEqual(fs.readFileSync(file), originalBytes);
});

class FakePostgresPool {
  constructor() {
    this.records = new Map();
    this.legacyRecords = new Map();
    this.queries = [];
    this.calls = [];
    this.inTransaction = false;
  }

  async connect() { return this; }
  release() {}
  async end() {}

  async query(sql, params = []) {
    this.queries.push(sql);
    this.calls.push({ sql, params: [...params] });
    if (/CREATE TABLE IF NOT EXISTS dynamic_task_tree_states_v2/.test(sql)) return { rowCount: 0, rows: [] };
    if (sql === "BEGIN") { this.inTransaction = true; return { rowCount: 0, rows: [] }; }
    if (sql === "COMMIT" || sql === "ROLLBACK") { this.inTransaction = false; return { rowCount: 0, rows: [] }; }
    if (/SELECT to_regclass\('dynamic_task_tree_states'\)/.test(sql)) {
      return { rowCount: 1, rows: [{ legacy_table: "dynamic_task_tree_states" }] };
    }
    if (/SELECT 1 FROM dynamic_task_tree_states WHERE/.test(sql)) {
      const record = this.legacyRecords.get(`${params[0]}\u0000${params[1]}`);
      return { rowCount: record ? 1 : 0, rows: record ? [{ exists: 1 }] : [] };
    }
    if (/SELECT work_id, state, revision, created_at .*dynamic_task_tree_states_v2.* FOR UPDATE/.test(sql)) {
      const key = `${params[0]}\u0000${params[2]}`;
      const record = this.records.get(key);
      const match = record?.work_id === params[1] ? record : null;
      return { rowCount: match ? 1 : 0, rows: match ? [structuredClone(match)] : [] };
    }
    if (/SELECT 1 FROM dynamic_task_tree_states_v2/.test(sql)) {
      const record = this.records.get(`${params[0]}\u0000${params[1]}`);
      return { rowCount: record ? 1 : 0, rows: record ? [{ exists: 1 }] : [] };
    }
    if (/SELECT work_id, state, revision, created_at, updated_at FROM dynamic_task_tree_states_v2/.test(sql)) {
      const exactWork = /work_id=\$2::uuid/.test(sql);
      const key = exactWork
        ? `${params[0]}\u0000${params[2]}`
        : `${params[0]}\u0000${params[1]}`;
      const record = this.records.get(key);
      if (exactWork && record?.work_id !== params[1]) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: record ? 1 : 0, rows: record ? [structuredClone(record)] : [] };
    }
    if (/INSERT INTO dynamic_task_tree_states_v2/.test(sql)) {
      const insertKey = `${params[0]}\u0000${params[2]}`;
      const createdAt = params[4];
      const record = { work_id: params[1], state: JSON.parse(params[3]), revision: 1, created_at: createdAt, updated_at: createdAt };
      this.records.set(insertKey, record);
      return { rowCount: 1, rows: [{ revision: 1, created_at: createdAt, updated_at: createdAt }] };
    }
    if (/UPDATE dynamic_task_tree_states_v2/.test(sql)) {
      const updateKey = `${params[0]}\u0000${params[2]}`;
      const current = this.records.get(updateKey);
      if (!current || current.work_id !== params[1] || current.revision !== params[5]) return { rowCount: 0, rows: [] };
      const record = { ...current, state: JSON.parse(params[3]), revision: current.revision + 1, updated_at: params[4] };
      this.records.set(updateKey, record);
      return { rowCount: 1, rows: [{ revision: record.revision, created_at: record.created_at, updated_at: record.updated_at }] };
    }
    throw new Error(`unexpected_query:${sql.slice(0, 100)}`);
  }
}

test("DTT PostgreSQL store is tenant-and-Work-bound, transactional and revision-CAS", async () => {
  const pool = new FakePostgresPool();
  const store = createPostgresDynamicTaskTreeStateStore({
    connectionString: "postgres://governance:test@localhost:5432/nyra",
    pool,
    now: () => new Date("2026-07-26T12:00:00.000Z"),
  });
  const tree = {
    tree_id: "dtt_aaaaaaaaaaaaaaaaaaaaaaaa",
    tenant_id: "tenant-a",
    work_id: WORK_A,
    status: "advisory_ready",
  };
  const first = await store.save({ tree, expected_revision: null });
  assert.equal(first.revision, 1);
  assert.equal((await store.load({ tenant_id: "tenant-a", work_id: WORK_A, tree_id: tree.tree_id })).tree.status, "advisory_ready");
  assert.equal(await store.load({ tenant_id: "tenant-b", work_id: WORK_A, tree_id: tree.tree_id }), null);
  await assert.rejects(
    store.load({ tenant_id: "tenant-a", work_id: WORK_B, tree_id: tree.tree_id }),
    /cross_work_task_tree_denied/,
  );
  const second = await store.save({ tree: { ...tree, status: "cancelled" }, expected_revision: 1 });
  assert.equal(second.revision, 2);
  await assert.rejects(store.save({ tree, expected_revision: 1 }), /dynamic_task_tree_revision_conflict/);
  const legacyTreeId = "dtt_cccccccccccccccccccccccc";
  const legacyRecord = {
    work_id: null,
    state: {
      tree_id: legacyTreeId,
      tenant_id: "tenant-a",
      work_id: WORK_A,
      status: "advisory_ready",
    },
    revision: 1,
    created_at: "2026-07-26T12:00:00.000Z",
    updated_at: "2026-07-26T12:00:00.000Z",
  };
  pool.legacyRecords.set(`tenant-a\u0000${legacyTreeId}`, legacyRecord);
  const legacySnapshot = structuredClone(legacyRecord);
  await assert.rejects(
    store.load({ tenant_id: "tenant-a", work_id: WORK_A, tree_id: legacyTreeId }),
    /dtt_work_binding_required/,
  );
  assert.equal(pool.inTransaction, false);
  assert.deepEqual(pool.legacyRecords.get(`tenant-a\u0000${legacyTreeId}`), legacySnapshot);
  assert.equal(pool.queries.filter((sql) => /CREATE TABLE IF NOT EXISTS dynamic_task_tree_states_v2/.test(sql)).length, 1);
  assert(pool.queries.some((sql) => /FOR UPDATE/.test(sql)));
  assert(pool.queries.every((sql) => !/ALTER TABLE dynamic_task_tree_states\b/.test(sql)));
  assert(pool.queries.some((sql) => /PRIMARY KEY \(tenant_id, work_id, tree_id\)/.test(sql)));
  assert(pool.queries.some((sql) => /SELECT to_regclass\('dynamic_task_tree_states'\)/.test(sql)));
  assert(pool.queries.some((sql) => /WHERE tenant_id=\$1 AND work_id=\$2::uuid AND tree_id=\$3 AND revision=\$6/.test(sql)));
  assert(pool.calls.some(({ sql, params }) => /work_id=\$2::uuid AND tree_id=\$3/.test(sql) && params.length === 3));
  assert(pool.calls.some(({ sql, params }) => /state, revision, created_at.*FOR UPDATE/.test(sql) && params.length === 3));
});

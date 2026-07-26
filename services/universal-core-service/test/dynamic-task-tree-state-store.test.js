import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDynamicTaskTreeRuntime } from "../src/dynamicTaskTree.js";
import {
  createFileDynamicTaskTreeStateStore,
  createPostgresDynamicTaskTreeStateStore,
} from "../src/dynamicTaskTreeStateStore.js";

test("DTT file CAS store survives runtime restart and is visible across instances", async () => {
  const root = path.join(os.tmpdir(), `dtt-state-${Date.now()}-${Math.random()}`);
  const storeA = createFileDynamicTaskTreeStateStore({ root });
  const runtimeA = createDynamicTaskTreeRuntime({ state_store: storeA });
  const tree = await runtimeA.create({
    tenant_id: "tenant-a",
    objective: "Persist non-executive lifecycle state",
    nodes: [{ node_id: "verify", kind: "analysis", task: "Verify persisted state" }],
  });

  const runtimeAfterRestart = createDynamicTaskTreeRuntime({
    state_store: createFileDynamicTaskTreeStateStore({ root }),
  });
  const restored = await runtimeAfterRestart.get({ tenant_id: "tenant-a", tree_id: tree.tree_id });
  assert.equal(restored.tree_id, tree.tree_id);
  assert.equal(restored.status, "advisory_ready");

  const secondInstance = createDynamicTaskTreeRuntime({
    state_store: createFileDynamicTaskTreeStateStore({ root }),
  });
  const cancelled = await secondInstance.cancel({
    tenant_id: "tenant-a",
    tree_id: tree.tree_id,
    reason: "Cross-instance state visibility test",
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(
    (await runtimeAfterRestart.get({ tenant_id: "tenant-a", tree_id: tree.tree_id })).status,
    "cancelled",
  );
  await assert.rejects(
    runtimeAfterRestart.get({ tenant_id: "tenant-b", tree_id: tree.tree_id }),
    /cross_tenant_task_tree_denied/,
  );
});

test("DTT state store rejects stale revisions and malformed identifiers", async () => {
  const root = path.join(os.tmpdir(), `dtt-state-cas-${Date.now()}-${Math.random()}`);
  const store = createFileDynamicTaskTreeStateStore({ root });
  const runtime = createDynamicTaskTreeRuntime({ state_store: store });
  const tree = await runtime.create({
    tenant_id: "tenant-a",
    objective: "Exercise compare and swap",
    nodes: [{ node_id: "verify", kind: "analysis", task: "Verify CAS" }],
  });
  const record = store.load({ tree_id: tree.tree_id });
  assert.equal(record.revision, 1);
  store.save({ tree: { ...record.tree, status: "checkpointed" }, expected_revision: 1 });
  assert.throws(
    () => store.save({ tree: record.tree, expected_revision: 1 }),
    /dynamic_task_tree_revision_conflict/,
  );
  assert.throws(() => store.load({ tree_id: "../../escape" }), /tree_id_invalid/);
});

class FakePostgresPool {
  constructor() {
    this.records = new Map();
    this.queries = [];
    this.inTransaction = false;
  }

  async connect() { return this; }
  release() {}
  async end() {}

  async query(sql, params = []) {
    this.queries.push(sql);
    if (/CREATE TABLE IF NOT EXISTS dynamic_task_tree_states/.test(sql)) return { rowCount: 0, rows: [] };
    if (sql === "BEGIN") { this.inTransaction = true; return { rowCount: 0, rows: [] }; }
    if (sql === "COMMIT" || sql === "ROLLBACK") { this.inTransaction = false; return { rowCount: 0, rows: [] }; }
    const key = params.length >= 2 ? `${params[0]}\u0000${params[1]}` : "";
    if (/SELECT revision, created_at .* FOR UPDATE/.test(sql)) {
      const record = this.records.get(key);
      return { rowCount: record ? 1 : 0, rows: record ? [{ revision: record.revision, created_at: record.created_at }] : [] };
    }
    if (/SELECT state, revision, created_at, updated_at/.test(sql)) {
      const record = this.records.get(key);
      return { rowCount: record ? 1 : 0, rows: record ? [structuredClone(record)] : [] };
    }
    if (/INSERT INTO dynamic_task_tree_states/.test(sql)) {
      const createdAt = params[3];
      const record = { state: JSON.parse(params[2]), revision: 1, created_at: createdAt, updated_at: createdAt };
      this.records.set(key, record);
      return { rowCount: 1, rows: [{ revision: 1, created_at: createdAt, updated_at: createdAt }] };
    }
    if (/UPDATE dynamic_task_tree_states/.test(sql)) {
      const current = this.records.get(key);
      if (!current || current.revision !== params[4]) return { rowCount: 0, rows: [] };
      const record = { ...current, state: JSON.parse(params[2]), revision: current.revision + 1, updated_at: params[3] };
      this.records.set(key, record);
      return { rowCount: 1, rows: [{ revision: record.revision, created_at: record.created_at, updated_at: record.updated_at }] };
    }
    throw new Error(`unexpected_query:${sql.slice(0, 100)}`);
  }
}

test("DTT PostgreSQL store is tenant-bound, transactional and revision-CAS", async () => {
  const pool = new FakePostgresPool();
  const store = createPostgresDynamicTaskTreeStateStore({
    connectionString: "postgres://governance:test@localhost:5432/nyra",
    pool,
    now: () => new Date("2026-07-26T12:00:00.000Z"),
  });
  const tree = { tree_id: "dtt_aaaaaaaaaaaaaaaaaaaaaaaa", tenant_id: "tenant-a", status: "advisory_ready" };
  const first = await store.save({ tree, expected_revision: null });
  assert.equal(first.revision, 1);
  assert.equal((await store.load({ tenant_id: "tenant-a", tree_id: tree.tree_id })).tree.status, "advisory_ready");
  assert.equal(await store.load({ tenant_id: "tenant-b", tree_id: tree.tree_id }), null);
  const second = await store.save({ tree: { ...tree, status: "cancelled" }, expected_revision: 1 });
  assert.equal(second.revision, 2);
  await assert.rejects(store.save({ tree, expected_revision: 1 }), /dynamic_task_tree_revision_conflict/);
  assert.equal(pool.inTransaction, false);
  assert.equal(pool.queries.filter((sql) => /CREATE TABLE IF NOT EXISTS dynamic_task_tree_states/.test(sql)).length, 1);
  assert(pool.queries.some((sql) => /FOR UPDATE/.test(sql)));
  assert(pool.queries.some((sql) => /WHERE tenant_id=\$1 AND tree_id=\$2 AND revision=\$5/.test(sql)));
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createFileDynamicTaskTreeJoinVerdictStore,
  createPostgresDynamicTaskTreeJoinVerdictStore,
} from "../src/dynamicTaskTreeJoinVerdictStore.js";

test("DTT join verdict ledger records consumption and post-consumption revocation append-only", () => {
  const root = path.join(os.tmpdir(), `dtt-verdict-${Date.now()}-${Math.random()}`);
  const store = createFileDynamicTaskTreeJoinVerdictStore({ root });
  const issued = store.issue({
    tenant_id: "tenant-a",
    tree_id: "dtt_0123456789abcdef01234567",
    key_id: "key-a",
    evidence_set_digest: "evidence-set-a",
  });
  assert.match(issued.verdict_reference, /^dttv_[a-f0-9]{64}$/);
  assert.equal(issued.authority, "universal_core");
  assert.equal(issued.allowed, true);
  assert.equal(issued.execution_authorized, false);
  assert.throws(() => store.issue({
    tenant_id: "tenant-a",
    tree_id: "dtt_0123456789abcdef01234567",
    key_id: "key-a",
    evidence_set_digest: "evidence-set-a",
  }), /dtt_join_verdict_already_issued/);

  const consumed = store.consume({
    tenant_id: "tenant-a",
    tree_id: "dtt_0123456789abcdef01234567",
    verdict_reference: issued.verdict_reference,
  });
  assert.equal(consumed.event_type, "consumed");
  assert.throws(() => store.consume({
    tenant_id: "tenant-a",
    tree_id: "dtt_0123456789abcdef01234567",
    verdict_reference: issued.verdict_reference,
  }), /dtt_join_verdict_not_active/);
  const revoked = store.revoke({
    tenant_id: "tenant-a",
    tree_id: "dtt_0123456789abcdef01234567",
    verdict_reference: issued.verdict_reference,
    reason: "Candidate approval withdrawn by governed review.",
  });
  assert.equal(revoked.event_type, "revoked");
  assert.equal(store.revoke({
    tenant_id: "tenant-a",
    tree_id: "dtt_0123456789abcdef01234567",
    verdict_reference: issued.verdict_reference,
    reason: "Duplicate revocation.",
  }), null);

  const events = store.read({
    tenant_id: "tenant-a",
    tree_id: "dtt_0123456789abcdef01234567",
  });
  assert.deepEqual(
    events.map((event) => event.event_type),
    ["issued", "consumed", "revoked"],
  );
  assert.equal(events[1].previous_hash, events[0].event_hash);
  assert.equal(events[2].previous_hash, events[1].event_hash);
});

test("DTT join verdict ledger detects tampering and can void an unconsumed verdict", () => {
  const root = path.join(os.tmpdir(), `dtt-verdict-integrity-${Date.now()}-${Math.random()}`);
  const store = createFileDynamicTaskTreeJoinVerdictStore({ root });
  const issued = store.issue({
    tenant_id: "tenant-a",
    tree_id: "dtt_abcdef0123456789abcdef01",
    key_id: "key-a",
    evidence_set_digest: "evidence-set-b",
  });
  const voided = store.void({
    tenant_id: "tenant-a",
    tree_id: "dtt_abcdef0123456789abcdef01",
    verdict_reference: issued.verdict_reference,
    reason: "Join failed before mutation",
  });
  assert.equal(voided.event_type, "voided");

  const ledger = path.join(root, "events.jsonl");
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n");
  const first = JSON.parse(lines[0]);
  first.allowed = false;
  lines[0] = JSON.stringify(first);
  fs.writeFileSync(ledger, `${lines.join("\n")}\n`);
  assert.throws(() => store.read({
    tenant_id: "tenant-a",
    tree_id: "dtt_abcdef0123456789abcdef01",
  }), /dtt_join_verdict_ledger_integrity_failed/);
});

class FakeVerdictPostgresPool {
  constructor() {
    this.verdicts = new Map();
    this.events = new Map();
    this.queries = [];
  }

  async connect() { return this; }
  release() {}
  async end() {}

  async query(sql, params = []) {
    this.queries.push(sql);
    if (/CREATE TABLE IF NOT EXISTS dynamic_task_tree_join_verdicts/.test(sql)) return { rowCount: 0, rows: [] };
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
    if (/pg_advisory_xact_lock/.test(sql)) return { rowCount: 1, rows: [{}] };
    const key = params.length >= 2 ? `${params[0]}\u0000${params[1]}` : "";
    if (/SELECT event FROM dynamic_task_tree_join_verdict_events/.test(sql)) {
      return { rowCount: (this.events.get(key) || []).length, rows: structuredClone(this.events.get(key) || []) };
    }
    if (/SELECT verdict_reference FROM dynamic_task_tree_join_verdicts/.test(sql)) {
      const verdict = [...this.verdicts.values()].find((item) => item.key === key && item.status === "issued");
      return { rowCount: verdict ? 1 : 0, rows: verdict ? [{ verdict_reference: verdict.verdict_reference }] : [] };
    }
    if (/INSERT INTO dynamic_task_tree_join_verdicts/.test(sql)) {
      if ([...this.verdicts.values()].some((item) => item.key === key && item.status === "issued")) {
        const error = new Error("duplicate key");
        error.code = "23505";
        throw error;
      }
      this.verdicts.set(params[2], {
        key,
        verdict_reference: params[2],
        key_id: params[3],
        evidence_set_digest: params[4],
        status: "issued",
      });
      return { rowCount: 1, rows: [] };
    }
    if (/UPDATE dynamic_task_tree_join_verdicts/.test(sql)) {
      const verdict = this.verdicts.get(params[2]);
      const expectedStatus = /AND status='consumed'/.test(sql)
        ? "consumed"
        : "issued";
      if (!verdict || verdict.key !== key || verdict.status !== expectedStatus) {
        return { rowCount: 0, rows: [] };
      }
      verdict.status = /SET status='consumed'/.test(sql)
        ? "consumed"
        : /SET status='revoked'/.test(sql)
          ? "revoked"
          : "voided";
      return { rowCount: 1, rows: [] };
    }
    if (/INSERT INTO dynamic_task_tree_join_verdict_events/.test(sql)) {
      const rows = this.events.get(key) || [];
      rows.push({ event: JSON.parse(params[5]) });
      this.events.set(key, rows);
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected_query:${sql.slice(0, 120)}`);
  }
}

test("DTT PostgreSQL verdict ledger serializes issuance, survives restart and isolates tenants", async () => {
  const pool = new FakeVerdictPostgresPool();
  const createStore = () => createPostgresDynamicTaskTreeJoinVerdictStore({
    connectionString: "postgres://governance:test@localhost:5432/nyra",
    pool,
    now: () => "2026-07-26T18:30:00.000Z",
  });
  const input = {
    tenant_id: "tenant-a",
    tree_id: "dtt_999999999999999999999999",
    key_id: "key-a",
    evidence_set_digest: "evidence-set-race",
  };
  const raced = await Promise.allSettled([createStore().issue(input), createStore().issue(input)]);
  assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(raced.filter((result) => result.status === "rejected").length, 1);

  const issued = raced.find((result) => result.status === "fulfilled").value;
  const afterRestart = createStore();
  assert.equal((await afterRestart.read({
    tenant_id: "tenant-a",
    tree_id: input.tree_id,
  })).length, 1);
  assert.deepEqual(await afterRestart.read({
    tenant_id: "tenant-b",
    tree_id: input.tree_id,
  }), []);
  await afterRestart.consume({
    tenant_id: "tenant-a",
    tree_id: input.tree_id,
    verdict_reference: issued.verdict_reference,
  });
  await assert.rejects(afterRestart.consume({
    tenant_id: "tenant-a",
    tree_id: input.tree_id,
    verdict_reference: issued.verdict_reference,
  }), /dtt_join_verdict_not_active/);
  const revoked = await afterRestart.revoke({
    tenant_id: "tenant-a",
    tree_id: input.tree_id,
    verdict_reference: issued.verdict_reference,
    reason: "Governed candidate approval revoked.",
  });
  assert.equal(revoked.event_type, "revoked");
  assert.deepEqual(
    (await afterRestart.read({
      tenant_id: "tenant-a",
      tree_id: input.tree_id,
    })).map((event) => event.event_type),
    ["issued", "consumed", "revoked"],
  );
  assert(pool.queries.some((sql) => /pg_advisory_xact_lock/.test(sql)));
  assert.equal(
    pool.queries.filter((sql) => /CREATE TABLE IF NOT EXISTS dynamic_task_tree_join_verdicts/.test(sql)).length,
    3,
  );
});

test("DTT PostgreSQL verdict ledger permits a safe retry only after void", async () => {
  const pool = new FakeVerdictPostgresPool();
  const store = createPostgresDynamicTaskTreeJoinVerdictStore({
    connectionString: "postgres://governance:test@localhost:5432/nyra",
    pool,
    now: () => "2026-07-26T18:31:00.000Z",
  });
  const input = {
    tenant_id: "tenant-a",
    tree_id: "dtt_888888888888888888888888",
    key_id: "key-a",
    evidence_set_digest: "evidence-set-retry",
  };
  const first = await store.issue(input);
  await store.void({
    tenant_id: input.tenant_id,
    tree_id: input.tree_id,
    verdict_reference: first.verdict_reference,
    reason: "Transient CAS conflict before join",
  });
  const second = await store.issue(input);
  assert.notEqual(second.verdict_reference, first.verdict_reference);
  await store.consume({
    tenant_id: input.tenant_id,
    tree_id: input.tree_id,
    verdict_reference: second.verdict_reference,
  });
  assert.deepEqual(
    (await store.read({ tenant_id: input.tenant_id, tree_id: input.tree_id }))
      .map((event) => event.event_type),
    ["issued", "voided", "issued", "consumed"],
  );
});

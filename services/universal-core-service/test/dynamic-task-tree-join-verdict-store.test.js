import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createFileDynamicTaskTreeJoinVerdictStore,
  createPostgresDynamicTaskTreeJoinVerdictStore,
} from "../src/dynamicTaskTreeJoinVerdictStore.js";

const WORK_A = "11111111-1111-4111-8111-111111111111";
const WORK_B = "22222222-2222-4222-8222-222222222222";

test("DTT join verdict ledger issues server references once and records consumption append-only", () => {
  const root = path.join(os.tmpdir(), `dtt-verdict-${Date.now()}-${Math.random()}`);
  const store = createFileDynamicTaskTreeJoinVerdictStore({ root });
  const issued = store.issue({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: "dtt_0123456789abcdef01234567",
    key_id: "key-a",
    evidence_set_digest: "evidence-set-a",
  });
  assert.match(issued.verdict_reference, /^dttv_[a-f0-9]{64}$/);
  assert.equal(issued.authority, "universal_core");
  assert.equal(issued.verdict_schema_version, "dtt_join_verdict_v2");
  assert.equal(issued.work_id, WORK_A);
  assert.equal(issued.allowed, true);
  assert.equal(issued.execution_authorized, false);
  assert.deepEqual(store.read({
    tenant_id: "tenant-a", work_id: WORK_B, tree_id: "dtt_0123456789abcdef01234567",
  }), []);
  assert.throws(() => store.consume({
    tenant_id: "tenant-a", work_id: WORK_B, tree_id: "dtt_0123456789abcdef01234567",
    verdict_reference: issued.verdict_reference,
  }), /dtt_join_verdict_not_active/);
  assert.equal(store.void({
    tenant_id: "tenant-a", work_id: WORK_B, tree_id: "dtt_0123456789abcdef01234567",
    verdict_reference: issued.verdict_reference, reason: "cross-work denied",
  }), null);
  assert.throws(() => store.issue({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: "dtt_0123456789abcdef01234567",
    key_id: "key-a",
    evidence_set_digest: "evidence-set-a",
  }), /dtt_join_verdict_already_issued/);

  const consumed = store.consume({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: "dtt_0123456789abcdef01234567",
    verdict_reference: issued.verdict_reference,
  });
  assert.equal(consumed.event_type, "consumed");
  assert.throws(() => store.consume({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: "dtt_0123456789abcdef01234567",
    verdict_reference: issued.verdict_reference,
  }), /dtt_join_verdict_not_active/);

  const events = store.read({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: "dtt_0123456789abcdef01234567",
  });
  assert.deepEqual(events.map((event) => event.event_type), ["issued", "consumed"]);
  assert.equal(events[1].previous_hash, events[0].event_hash);
});

test("DTT join verdict ledger detects tampering and can void an unconsumed verdict", () => {
  const root = path.join(os.tmpdir(), `dtt-verdict-integrity-${Date.now()}-${Math.random()}`);
  const store = createFileDynamicTaskTreeJoinVerdictStore({ root });
  const issued = store.issue({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: "dtt_abcdef0123456789abcdef01",
    key_id: "key-a",
    evidence_set_digest: "evidence-set-b",
  });
  const voided = store.void({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: "dtt_abcdef0123456789abcdef01",
    verdict_reference: issued.verdict_reference,
    reason: "Join failed before mutation",
  });
  assert.equal(voided.event_type, "voided");

  const ledgerName = fs.readdirSync(root).find((entry) => /^events-v2-[a-f0-9]{64}\.jsonl$/.test(entry));
  assert(ledgerName);
  const ledger = path.join(root, ledgerName);
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n");
  const first = JSON.parse(lines[0]);
  first.allowed = false;
  lines[0] = JSON.stringify(first);
  fs.writeFileSync(ledger, `${lines.join("\n")}\n`);
  assert.throws(() => store.read({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: "dtt_abcdef0123456789abcdef01",
  }), /dtt_join_verdict_ledger_integrity_failed/);
  fs.writeFileSync(ledger, "{malformed\n", { encoding: "utf8" });
  assert.throws(() => store.read({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: "dtt_abcdef0123456789abcdef01",
  }), /dtt_join_verdict_ledger_integrity_failed/);
});

test("DTT file verdict V2 isolates identical trees across Works and leaves V1 bytes inactive", () => {
  const root = path.join(os.tmpdir(), `dtt-verdict-work-${Date.now()}-${Math.random()}`);
  fs.mkdirSync(root, { recursive: true });
  const legacyFile = path.join(root, "events.jsonl");
  const legacyBytes = Buffer.from('{"schema_version":"dtt_join_verdict_event_v1","legacy":true}\n');
  fs.writeFileSync(legacyFile, legacyBytes, { mode: 0o600 });
  const legacyHash = crypto.createHash("sha256").update(legacyBytes).digest("hex");
  const store = createFileDynamicTaskTreeJoinVerdictStore({ root });
  const base = {
    tenant_id: "tenant-a",
    tree_id: "dtt_777777777777777777777777",
    key_id: "key-a",
    evidence_set_digest: "evidence-set-work",
  };
  const issuedA = store.issue({ ...base, work_id: WORK_A });
  const issuedB = store.issue({ ...base, work_id: WORK_B });
  assert.notEqual(issuedA.verdict_reference, issuedB.verdict_reference);
  assert.equal(issuedA.work_id, WORK_A);
  assert.equal(issuedB.work_id, WORK_B);
  assert.deepEqual(store.read({ ...base, work_id: WORK_A }).map((event) => event.verdict_reference), [issuedA.verdict_reference]);
  assert.deepEqual(store.read({ ...base, work_id: WORK_B }).map((event) => event.verdict_reference), [issuedB.verdict_reference]);
  assert.throws(() => store.consume({
    ...base, work_id: WORK_B, verdict_reference: issuedA.verdict_reference,
  }), /dtt_join_verdict_not_active/);
  assert.equal(store.void({
    ...base, work_id: WORK_B, verdict_reference: issuedA.verdict_reference, reason: "cross-work denied",
  }), null);
  const consumed = store.consume({
    ...base, work_id: WORK_A, verdict_reference: issuedA.verdict_reference,
  });
  assert.equal(consumed.work_id, WORK_A);
  assert.equal(consumed.execution_authorized, false);

  const restarted = createFileDynamicTaskTreeJoinVerdictStore({ root });
  assert.deepEqual(
    restarted.read({ ...base, work_id: WORK_A }).map((event) => event.event_type),
    ["issued", "consumed"],
  );
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(legacyFile)).digest("hex"), legacyHash);
});

class FakeVerdictPostgresPool {
  constructor() {
    this.verdicts = new Map();
    this.events = new Map();
    this.queries = [];
    this.calls = [];
  }

  async connect() { return this; }
  release() {}
  async end() {}

  async query(sql, params = []) {
    this.queries.push(sql);
    this.calls.push({ sql, params: [...params] });
    if (/CREATE TABLE IF NOT EXISTS dynamic_task_tree_join_verdicts_v2/.test(sql)) return { rowCount: 0, rows: [] };
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
    if (/pg_advisory_xact_lock/.test(sql)) return { rowCount: 1, rows: [{}] };
    const key = params.length >= 3 ? `${params[0]}\u0000${params[1]}\u0000${params[2]}` : "";
    if (/SELECT event FROM dynamic_task_tree_join_verdict_events_v2/.test(sql)) {
      return { rowCount: (this.events.get(key) || []).length, rows: structuredClone(this.events.get(key) || []) };
    }
    if (/SELECT verdict_reference FROM dynamic_task_tree_join_verdicts_v2/.test(sql)) {
      const verdict = [...this.verdicts.values()].find((item) => item.key === key && item.status === "issued");
      return { rowCount: verdict ? 1 : 0, rows: verdict ? [{ verdict_reference: verdict.verdict_reference }] : [] };
    }
    if (/INSERT INTO dynamic_task_tree_join_verdicts_v2/.test(sql)) {
      if ([...this.verdicts.values()].some((item) => item.key === key && item.status === "issued")) {
        const error = new Error("duplicate key");
        error.code = "23505";
        throw error;
      }
      this.verdicts.set(params[3], {
        key,
        work_id: params[1],
        verdict_reference: params[3],
        key_id: params[4],
        evidence_set_digest: params[5],
        status: "issued",
      });
      return { rowCount: 1, rows: [] };
    }
    if (/UPDATE dynamic_task_tree_join_verdicts_v2/.test(sql)) {
      const verdict = this.verdicts.get(params[3]);
      if (!verdict || verdict.key !== key || verdict.status !== "issued") return { rowCount: 0, rows: [] };
      verdict.status = /status='consumed'/.test(sql) ? "consumed" : "voided";
      return { rowCount: 1, rows: [] };
    }
    if (/INSERT INTO dynamic_task_tree_join_verdict_events_v2/.test(sql)) {
      const rows = this.events.get(key) || [];
      rows.push({ event: JSON.parse(params[6]) });
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
    work_id: WORK_A,
    tree_id: "dtt_999999999999999999999999",
    key_id: "key-a",
    evidence_set_digest: "evidence-set-race",
  };
  const raced = await Promise.allSettled([createStore().issue(input), createStore().issue(input)]);
  assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(raced.filter((result) => result.status === "rejected").length, 1);

  const issued = raced.find((result) => result.status === "fulfilled").value;
  const afterRestart = createStore();
  assert.deepEqual(await afterRestart.read({
    tenant_id: "tenant-a", work_id: WORK_B, tree_id: input.tree_id,
  }), []);
  await assert.rejects(afterRestart.consume({
    tenant_id: "tenant-a", work_id: WORK_B, tree_id: input.tree_id,
    verdict_reference: issued.verdict_reference,
  }), /dtt_join_verdict_not_active/);
  assert.equal(await afterRestart.void({
    tenant_id: "tenant-a", work_id: WORK_B, tree_id: input.tree_id,
    verdict_reference: issued.verdict_reference, reason: "cross-work denied",
  }), null);
  const issuedOtherWork = await afterRestart.issue({ ...input, work_id: WORK_B });
  assert.notEqual(issuedOtherWork.verdict_reference, issued.verdict_reference);
  assert.equal((await afterRestart.read({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: input.tree_id,
  })).length, 1);
  assert.deepEqual(await afterRestart.read({
    tenant_id: "tenant-b",
    work_id: WORK_A,
    tree_id: input.tree_id,
  }), []);
  assert.deepEqual(
    (await afterRestart.read({ tenant_id: "tenant-a", work_id: WORK_B, tree_id: input.tree_id }))
      .map((event) => event.verdict_reference),
    [issuedOtherWork.verdict_reference],
  );
  await assert.rejects(afterRestart.consume({
    tenant_id: "tenant-a",
    work_id: WORK_B,
    tree_id: input.tree_id,
    verdict_reference: issued.verdict_reference,
  }), /dtt_join_verdict_not_active/);
  assert.equal(await afterRestart.void({
    tenant_id: "tenant-a",
    work_id: WORK_B,
    tree_id: input.tree_id,
    verdict_reference: issued.verdict_reference,
    reason: "cross-work denied",
  }), null);
  await afterRestart.consume({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: input.tree_id,
    verdict_reference: issued.verdict_reference,
  });
  await assert.rejects(afterRestart.consume({
    tenant_id: "tenant-a",
    work_id: WORK_A,
    tree_id: input.tree_id,
    verdict_reference: issued.verdict_reference,
  }), /dtt_join_verdict_not_active/);
  assert(pool.queries.some((sql) => /pg_advisory_xact_lock/.test(sql)));
  assert(pool.calls.some(({ sql, params }) => /pg_advisory_xact_lock/.test(sql)
    && params[0].includes(`\u0000${WORK_A}\u0000`)));
  assert.equal(
    pool.queries.filter((sql) => /CREATE TABLE IF NOT EXISTS dynamic_task_tree_join_verdicts_v2/.test(sql)).length,
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
    work_id: WORK_A,
    tree_id: "dtt_888888888888888888888888",
    key_id: "key-a",
    evidence_set_digest: "evidence-set-retry",
  };
  const first = await store.issue(input);
  await store.void({
    tenant_id: input.tenant_id,
    work_id: input.work_id,
    tree_id: input.tree_id,
    verdict_reference: first.verdict_reference,
    reason: "Transient CAS conflict before join",
  });
  const second = await store.issue(input);
  assert.notEqual(second.verdict_reference, first.verdict_reference);
  await store.consume({
    tenant_id: input.tenant_id,
    work_id: input.work_id,
    tree_id: input.tree_id,
    verdict_reference: second.verdict_reference,
  });
  assert.deepEqual(
    (await store.read({ tenant_id: input.tenant_id, work_id: input.work_id, tree_id: input.tree_id }))
      .map((event) => event.event_type),
    ["issued", "voided", "issued", "consumed"],
  );
});

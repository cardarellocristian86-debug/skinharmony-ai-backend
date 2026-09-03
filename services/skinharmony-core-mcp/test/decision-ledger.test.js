import test from "node:test";
import assert from "node:assert/strict";
import { classifyLedgerEvent, createDecisionLedger, DECISION_LEDGER_SCHEMA_VERSION } from "../src/decision-ledger.js";

function fakePool() {
  const calls = [];
  const events = new Map();
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT sequence_number,event_hash/.test(sql)) {
        const rows = events.get(`${params[0]}:${params[1]}`) || [];
        return { rows: rows.length ? [rows.at(-1)] : [] };
      }
      if (/INSERT INTO core_decision_events/.test(sql)) {
        const key = `${params[0]}:${params[2]}`;
        const rows = events.get(key) || [];
        rows.push({ sequence_number: params[3], event_hash: params[22], event_type: params[4], previous_event_hash: params[21] });
        events.set(key, rows);
        return { rows: [] };
      }
      if (/SELECT event_type,count/.test(sql)) return { rows: [{ event_type: "core_requested_confirmation", count: 2 }] };
      if (/SELECT count\(\*\).*works/s.test(sql)) return { rows: [{ works: 3, completed: 2 }] };
      return { rows: [] };
    },
    async end() {},
    events,
  };
}

test("decision ledger creates append-only hash chain and redacts summaries", async () => {
  const pool = fakePool();
  const ledger = createDecisionLedger({ databaseUrl: "postgres://unused" }, { pool });
  const context = await ledger.startWork(
    { tenantId: "tenant-a", subject: "codex", kind: "codex", clientId: "client-a" },
    "core_gate_action",
    { action_label: "Deploy token=very-secret-value", project_id: "project-a" },
  );
  const second = await ledger.append(context, "core_requested_confirmation", { reason_codes: ["owner_confirmation_required"] });
  assert.equal(second.schema_version, DECISION_LEDGER_SCHEMA_VERSION);
  assert.equal(second.sequence_number, 2);
  const rows = pool.events.get(`tenant-a:${context.workId}`);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].previous_event_hash, rows[0].event_hash);
  const sessionInsert = pool.calls.find((call) => /INSERT INTO core_ai_work_sessions/.test(call.sql));
  assert.match(sessionInsert.params[11], /\[REDACTED\]/);
  assert.doesNotMatch(sessionInsert.params[11], /very-secret-value/);
  assert.match(ledger.schemaSql, /core_decision_events_no_mutation/);
  assert.ok(pool.calls.some((call) => /pg_advisory_xact_lock/.test(call.sql)));
});

test("ledger classification distinguishes confirmation, hard block, outcome and failure", () => {
  assert.equal(classifyLedgerEvent("core_gate_action", { structuredContent: { decision_contract: { control_level: "confirm" } } }), "core_requested_confirmation");
  assert.equal(classifyLedgerEvent("core_gate_action", { structuredContent: { action_mediation: { state: "hard_block" } } }), "core_hard_blocked_action");
  assert.equal(classifyLedgerEvent("outcome_record", { structuredContent: { ok: true } }), "outcome_verified");
  assert.equal(classifyLedgerEvent("any", null, new Error("failed")), "tool_failed");
});

test("ledger records an expiring support delegation without expanding its authority", async () => {
  const pool = fakePool();
  const ledger = createDecisionLedger({ databaseUrl: "postgres://unused" }, { pool });
  await ledger.startWork({
    tenantId: "client-a",
    subject: "oauth|support",
    kind: "oauth",
    tenantSupportDelegationBound: true,
    tenantSupportDelegationId: "support-case-42",
    tenantSupportDelegationExpiresAt: "2030-01-01T00:00:00.000Z",
  }, "tenant_work_gallery_list", {});
  const eventInsert = pool.calls.find((call) => /INSERT INTO core_decision_events/.test(call.sql));
  const metadata = JSON.parse(eventInsert.params[20]);
  assert.equal(metadata.support_delegation_id, "support-case-42");
  assert.equal(metadata.support_delegation_expires_at, "2030-01-01T00:00:00.000Z");
  assert.equal(metadata.owner, undefined);
});

test("ledger binds causal lineage only after a successful Universal Core result", async () => {
  const pool = fakePool();
  const ledger = createDecisionLedger({ databaseUrl: "postgres://unused" }, { pool });
  const claimed = {
    work_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    change_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    context_digest: "c".repeat(64),
  };
  const context = await ledger.startWork(
    { tenantId: "tenant-a", subject: "codex", kind: "codex" },
    "causal_context_validate",
    { causal_context: claimed },
  );
  assert.equal(context.governedWorkId, null);
  const firstEventInsert = pool.calls.find((call) => /INSERT INTO core_decision_events/.test(call.sql));
  assert.deepEqual(firstEventInsert.params.slice(23, 26), [null, null, null]);

  const verified = {
    work_id: "11111111-1111-4111-8111-111111111111",
    change_id: "22222222-2222-4222-8222-222222222222",
    context_digest: "d".repeat(64),
  };
  await ledger.finishWork(context, {
    result: { structuredContent: { ok: true, result: { valid: true, ...verified } } },
  });
  assert.equal(context.governedWorkId, verified.work_id);
  assert.equal(context.causalChangeId, verified.change_id);
  assert.equal(context.causalContextDigest, verified.context_digest);
  const update = pool.calls.find((call) => /UPDATE core_ai_work_sessions SET status/.test(call.sql));
  assert.deepEqual(update.params.slice(5, 8), [verified.work_id, verified.change_id, verified.context_digest]);
});

test("ledger reports are always filtered by authenticated tenant", async () => {
  const pool = fakePool();
  const ledger = createDecisionLedger({ databaseUrl: "postgres://unused" }, { pool });
  const report = await ledger.report("tenant-b", 30);
  assert.equal(report.tenant_id, "tenant-b");
  assert.equal(report.events.core_requested_confirmation, 2);
  assert.equal(report.metrics.confirmation_rate_percent, 100);
  const reportQueries = pool.calls.filter((call) => /^SELECT/.test(call.sql.trim()) &&
    /core_(?:decision_events|ai_work_sessions)/.test(call.sql) && /WHERE tenant_id=\$1/.test(call.sql));
  assert.ok(reportQueries.length >= 2);
  assert.ok(reportQueries.every((call) => call.params[0] === "tenant-b"));
});

test("ledger stays disabled when PostgreSQL is not configured", () => {
  assert.equal(createDecisionLedger({ databaseUrl: "" }), null);
});

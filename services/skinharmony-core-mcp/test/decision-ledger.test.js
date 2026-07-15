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

test("ledger reports are always filtered by authenticated tenant", async () => {
  const pool = fakePool();
  const ledger = createDecisionLedger({ databaseUrl: "postgres://unused" }, { pool });
  const report = await ledger.report("tenant-b", 30);
  assert.equal(report.tenant_id, "tenant-b");
  assert.equal(report.events.core_requested_confirmation, 2);
  assert.equal(report.metrics.confirmation_rate_percent, 100);
  const reportQueries = pool.calls.filter((call) => /core_(?:decision_events|ai_work_sessions)/.test(call.sql) && /WHERE tenant_id=\$1/.test(call.sql));
  assert.ok(reportQueries.length >= 2);
  assert.ok(reportQueries.every((call) => call.params[0] === "tenant-b"));
});

test("ledger stays disabled when PostgreSQL is not configured", () => {
  assert.equal(createDecisionLedger({ databaseUrl: "" }), null);
});

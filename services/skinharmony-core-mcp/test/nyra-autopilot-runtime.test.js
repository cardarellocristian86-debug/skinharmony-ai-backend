import assert from "node:assert/strict";
import test from "node:test";
import { createNyraAutopilotRuntime, NYRA_AUTOPILOT_SCHEMA_VERSION } from "../src/nyra-autopilot-runtime.js";
import { NYRA_AUTOPILOT_TOOLS } from "../src/nyra-autopilot-tools.js";

test("Nyra Autopilot persists tenant and Work scoped plans, assignments and append-only receipts", () => {
  const runtime = createNyraAutopilotRuntime({}, {
    pool: { query: async () => ({ rows: [] }), end() {} },
    teamRuntime: { schemaSql: "", status: async () => ({ package: { enabled: false } }), enable: async () => ({}), materializeForWork: async () => ({}) },
  });
  assert.ok(runtime);
  assert.equal(typeof runtime.reconcile, "function");
  assert.equal(typeof runtime.claim, "function");
  assert.equal(typeof runtime.submit, "function");
  assert.match(runtime.schemaSql, /core_nyra_autopilot_tenants/);
  assert.match(runtime.schemaSql, /core_nyra_autopilot_runs/);
  assert.match(runtime.schemaSql, /core_nyra_autopilot_assignments/);
  assert.match(runtime.schemaSql, /core_nyra_autopilot_receipts_append_only/);
  assert.match(runtime.schemaSql, /FOREIGN KEY \(tenant_id, work_id\) REFERENCES core_continuity_works/);
  assert.equal(NYRA_AUTOPILOT_SCHEMA_VERSION, "nyra_work_autopilot_v1");
});

test("Nyra Autopilot MCP surface has one owner activation and bounded claim/submit", () => {
  const tools = Object.fromEntries(NYRA_AUTOPILOT_TOOLS.map((item) => [item.name, item]));
  assert.deepEqual(Object.keys(tools).sort(), [
    "nyra_autopilot_enable", "nyra_autopilot_reconcile", "nyra_autopilot_status", "nyra_autopilot_work_read",
    "nyra_work_assignment_claim", "nyra_work_assignment_inbox", "nyra_work_assignment_submit",
  ]);
  assert.equal(tools.nyra_autopilot_enable._meta["skinharmony/ownerConfirmationRequired"], true);
  assert.equal(tools.nyra_autopilot_reconcile._meta["skinharmony/ownerConfirmationRequired"], true);
  for (const name of ["nyra_work_assignment_claim", "nyra_work_assignment_submit"]) {
    assert.equal(tools[name]._meta["skinharmony/ownerConfirmationRequired"], false);
    assert.equal(tools[name]._meta["skinharmony/tenantBoundedCollaboration"], true);
  }
});

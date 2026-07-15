"use strict";
const assert = require("node:assert");
const { cockpit360Contract } = require("../src/Cockpit360Contract");
const result = cockpit360Contract({
  cockpit: { goldEnabled: true, cockpitVersion: "gold_cockpit_v1", summary: { revenue: 1 }, sections: [{ id: "overview" }] },
  enhanced: { externalAi: { answer: "Prima azione", firstAction: "Apri agenda", nyraPath: "smartdesk_to_core_to_nyra", coreOutput: { ok: true }, nyra: { success: true }, requestedBranches: ["smartdesk_operations_guard"] } },
  tenantId: "codexai", centerId: "center-test"
});
assert.equal(result.schema_version, "cockpit_360_v1");
assert.equal(result.source.route, "smartdesk_to_core_to_nyra");
assert.equal(result.guardrails.automatic_execution_allowed, false);
assert.equal(result.scope.tenant_id, "codexai");
console.log(JSON.stringify({ ok: true, runner: "cockpit_360_e2e_test" }));

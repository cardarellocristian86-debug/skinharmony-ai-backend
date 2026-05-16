import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  NIRA_BRIDGE_REPORT_PATH,
  runNiraUniversalCoreBridge,
  writeNiraBridgeReport,
} from "../tools/nira-universal-core-bridge.ts";

const standard = runNiraUniversalCoreBridge({
  request_id: "nira-bridge-test-standard",
  text: "Usa Nira per preparare automazioni Suite con Core come giudice.",
  owner_verified: false,
  access_scope: "limited",
  mode: "standard",
  target_system: "suite",
});

assert.equal(standard.ok, true);
assert.equal(standard.god_mode_active, false);
assert.equal(standard.selected_by_core.can_execute, false);
assert.equal(standard.automation_plan.execution_allowed, false);
assert.ok(standard.selected_by_core.blocked_reasons.includes("owner_not_verified"));

const godMode = runNiraUniversalCoreBridge({
  request_id: "nira-bridge-test-god-mode",
  text: "Metti Nira in God Mode owner-only e usa Universal Core per alleggerire Suite su Render con runbook controllati.",
  owner_verified: true,
  access_scope: "owner_full",
  mode: "god_mode_owner_only",
  target_system: "suite",
});

assert.equal(godMode.ok, true);
assert.equal(godMode.god_mode_active, true);
assert.equal(godMode.mode, "god_mode_owner_only");
assert.ok(godMode.prepared_by_nira.scenarios.length >= 5);
assert.ok(godMode.prepared_by_nira.scenarios.some((item) => item.id === "owner_god_mode_bridge"));
assert.ok(godMode.prepared_by_nira.scenarios.some((item) => item.id === "render_handoff"));
assert.equal(godMode.selected_by_core.requires_owner_confirmation, true);
assert.equal(godMode.automation_plan.audit_required, true);
assert.ok(godMode.efficiency.step_reduction_pct >= 30);
assert.ok(godMode.efficiency.why_it_helps_codex.length >= 3);

const reportPath = writeNiraBridgeReport(godMode);
assert.equal(reportPath, NIRA_BRIDGE_REPORT_PATH);
assert.equal(existsSync(reportPath), true);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
assert.equal(report.version, "nira_universal_core_bridge_v1");
assert.equal(report.god_mode_active, true);
assert.equal(report.prepared_by_nira.target_system, "suite");

console.log(JSON.stringify({
  ok: true,
  reportPath,
  god_mode_active: godMode.god_mode_active,
  selected_by_core: godMode.selected_by_core,
  efficiency: godMode.efficiency,
}, null, 2));

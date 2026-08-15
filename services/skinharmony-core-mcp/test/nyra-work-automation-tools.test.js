import assert from "node:assert/strict";
import test from "node:test";

import { NYRA_WORK_AUTOMATION_TOOLS } from "../src/nyra-work-automation-tools.js";

test("work automation tools expose a bounded, provider-free surface", () => {
  assert.deepEqual(NYRA_WORK_AUTOMATION_TOOLS.map((tool) => tool.name), [
    "nyra_work_automation_status", "nyra_work_automation_plan",
    "nyra_work_automation_builder_bind", "nyra_work_automation_builder_begin",
    "nyra_work_automation_commit_attest", "nyra_work_automation_builder_report",
    "nyra_work_automation_push_record", "nyra_work_automation_pull_request_ready",
    "nyra_work_automation_ci_verify", "nyra_work_automation_readiness_record",
    "nyra_work_automation_core_join_record", "nyra_work_automation_merge_record",
    "nyra_work_automation_deployment_readback", "nyra_work_automation_services_observe",
    "nyra_work_automation_acceptance_finalize", "nyra_work_automation_closure_finalize",
    "nyra_work_automation_reconcile",
  ]);
  const plan = NYRA_WORK_AUTOMATION_TOOLS.find((tool) => tool.name.endsWith("_plan"));
  assert.equal(plan.inputSchema.properties.advisory_capabilities.maxItems, 6);
  assert.equal(plan.annotations.openWorldHint, false);
  assert.equal(plan.inputSchema.properties.intent_anchor_receipt, undefined);
  assert.equal(plan.inputSchema.properties.intent_objective, undefined);
  const bind = NYRA_WORK_AUTOMATION_TOOLS.find((tool) => tool.name.endsWith("_builder_bind"));
  const report = NYRA_WORK_AUTOMATION_TOOLS.find((tool) => tool.name.endsWith("_builder_report"));
  const readiness = NYRA_WORK_AUTOMATION_TOOLS.find((tool) => tool.name.endsWith("_readiness_record"));
  const acceptance = NYRA_WORK_AUTOMATION_TOOLS.find((tool) => tool.name.endsWith("_acceptance_finalize"));
  assert.equal(bind.inputSchema.properties.plan_receipt, undefined);
  assert.equal(report.inputSchema.properties.report_receipt, undefined);
  assert.equal(readiness.inputSchema.properties.proofs, undefined);
  assert.equal(acceptance.inputSchema.properties.criteria.items.properties.proof_receipt, undefined);
  assert.deepEqual(acceptance.inputSchema.properties.criteria.items.required, ["criterion_id", "criterion_digest", "evidence_ticket_id", "host_session_fingerprint", "evidence"]);
});

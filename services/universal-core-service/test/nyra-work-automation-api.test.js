import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Universal Core mounts tenant-authenticated Work Automation v3 routes", () => {
  const source = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  for (const route of [
    "/v1/nyra/work-automation/:workId",
    "/v1/nyra/work-automation/plan",
    "/v1/nyra/work-automation/:workId/builder-report",
    "/v1/nyra/work-automation/:workId/ci/verify",
    "/v1/nyra/work-automation/:workId/reconcile",
    "/v1/nyra/work-automation/:workId/reconcile/post-release-complete",
    "/v1/nyra/work-automation/:workId/builder/bind",
    "/v1/nyra/work-automation/:workId/builder/begin",
    "/v1/nyra/work-automation/:workId/commit/attest",
    "/v1/nyra/work-automation/:workId/push/record",
    "/v1/nyra/work-automation/:workId/pull-request/ready",
    "/v1/nyra/work-automation/:workId/readiness/record",
    "/v1/nyra/work-automation/:workId/core-join/record",
    "/v1/nyra/work-automation/:workId/merge/record",
    "/v1/nyra/work-automation/:workId/deployment/readback",
    "/v1/nyra/work-automation/:workId/services/observe",
    "/v1/nyra/work-automation/:workId/acceptance/finalize",
    "/v1/nyra/work-automation/:workId/closure/finalize",
  ]) assert.match(source, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /system_verifier_/);
  assert.match(source, /retried: false/);
  assert.match(source, /nyra_session_required: false/);
  assert.match(source, /nyra_authoritative_post_release_reconciliation_v1/);
  for (const dependency of ["builderBindingVerifier", "builderReportIssuer", "criterionEvidenceVerifier", "criterionReadinessIssuer", "finalCriterionIssuer", "actionReceiptVerifier", "coreJoinVerifier", "mergeReadbackResolver", "deploymentReadbackResolver", "serviceObservationResolver", "closureReceiptVerifier", "reconciliationVerifier"]) assert.match(source, new RegExp(dependency));
  const coordinator = fs.readFileSync(new URL("../src/nyraWorkAutomationCoordinator.js", import.meta.url), "utf8");
  assert.match(coordinator, /receipts\.builderPlan\(/);
  assert.match(coordinator, /receipts\.criterionProofs\(/);
  assert.match(coordinator, /receipts\.finalCriterionProof\(/);
  assert.doesNotMatch(source, /verify\(input\.plan_receipt/);
  assert.doesNotMatch(source, /FinalCriterionVerifier/);
  assert.match(source, /core_continuity_intent_anchors/);
  assert.match(source, /persisted\.anchor\.acceptance_criteria\.map/);
  assert.doesNotMatch(source, /criterion_id: "immutable_intent_fulfilled"/);
  assert.match(source, /nyraDedicatedCoreGate/);
  assert.match(source, /dedicated_core_gate: nyraDedicatedCoreGate/);
  const render = fs.readFileSync(new URL("../../../render-universal-core.yaml", import.meta.url), "utf8");
  assert.match(render, /healthCheckPath: \/livez/);
  assert.doesNotMatch(render, /healthCheckPath: \/readyz/);
});

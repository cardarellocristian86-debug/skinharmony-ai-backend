import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGenericAgentRun } from "../src/genericAgentEvaluation.js";

test("generic evaluation reports exact assertions and weighted score", () => {
  const report = evaluateGenericAgentRun([
    { id: "resume", weight: 2, expected: { status: "running", cursor: "step_1" }, actual: { status: "running", cursor: "step_1" } },
    { id: "isolation", expected: { error: "cross_tenant_run_denied" }, actual: { error: "wrong_error" } },
  ]);
  assert.equal(report.case_count, 2);
  assert.equal(report.passed, false);
  assert.equal(report.score, 0.6667);
  assert.deepEqual(report.results[1].failed_assertions, ["error"]);
});

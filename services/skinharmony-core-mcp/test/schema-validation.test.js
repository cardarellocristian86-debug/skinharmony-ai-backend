import assert from "node:assert/strict";
import test from "node:test";

import { validateToolArguments } from "../src/schema-validation.js";
import { TOOLS } from "../src/tool-definitions.js";

const schema = TOOLS.find((tool) =>
  tool.name === "ai_learning_review_binding_preview")?.inputSchema;

function outcome() {
  return {
    outcome_id: "outcome-v016",
    run_id: "run-v016",
    outcome_status: "succeeded",
    outcome_verified: true,
    human_review_status: "approved",
    evidence_digest: `sha256:${"a".repeat(64)}`,
    policy_snapshot: `sha256:${"b".repeat(64)}`,
    observed_at: "2026-07-28T12:00:00.000Z",
    learning_value: 0.8,
  };
}

test("review binding preview accepts exactly one candidate or outcome shape", () => {
  assert.deepEqual(validateToolArguments(schema, {
    candidate_id: "candidate-v016",
    decision: "approved_for_shadow",
    expected_revision: 1,
  }), []);
  assert.deepEqual(validateToolArguments(schema, {
    outcome: outcome(),
  }), []);
});

test("review binding preview rejects empty, ambiguous and extra-property payloads", () => {
  assert(validateToolArguments(schema, {}).some((error) => error.code === "one_of"));
  assert(validateToolArguments(schema, {
    candidate_id: "candidate-v016",
    decision: "approved_for_shadow",
    expected_revision: 1,
    outcome: outcome(),
  }).some((error) => error.code === "one_of"));
  assert(validateToolArguments(schema, {
    outcome: outcome(),
    unexpected: true,
  }).some((error) => error.code === "additional_property"));
});

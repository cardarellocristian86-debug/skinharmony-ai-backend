import assert from "node:assert/strict";
import test from "node:test";

import { resolveAgenticHardBudgetStop } from "../src/agenticRuntimeFlags.js";

test("hard budget stop defaults to a disabled non-advisory state", () => {
  assert.deepEqual(resolveAgenticHardBudgetStop(undefined), {
    configured: false,
    requested: false,
    active: false,
    state: "disabled",
    advisory_only: false,
    reason: "hard_budget_stop_disabled",
  });
});

test("only an explicit false value is accepted as configured", () => {
  for (const value of [false, "false", " FALSE "]) {
    const result = resolveAgenticHardBudgetStop(value);
    assert.equal(result.configured, true);
    assert.equal(result.requested, false);
    assert.equal(result.active, false);
    assert.equal(result.state, "disabled");
  }
});

test("a true hard-stop request remains inactive and is reported as advisory rejection", () => {
  for (const value of [true, "true", " TRUE "]) {
    assert.deepEqual(resolveAgenticHardBudgetStop(value), {
      configured: true,
      requested: true,
      active: false,
      state: "rejected",
      advisory_only: true,
      reason: "hard_budget_stop_not_authorized",
    });
  }
});

test("ambiguous values fail closed without activating the hard stop", () => {
  for (const value of ["1", "yes", "off", 0, 1, {}]) {
    const result = resolveAgenticHardBudgetStop(value);
    assert.equal(result.active, false);
    assert.equal(result.state, "invalid_rejected");
    assert.equal(result.reason, "hard_budget_stop_invalid_value");
  }
});

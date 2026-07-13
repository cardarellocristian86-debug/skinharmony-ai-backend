import assert from "node:assert/strict";
import test from "node:test";
import { buildActionAuthorization } from "../src/actionAuthorization.js";

function contract(overrides = {}) {
  return {
    state: "attention",
    risk_band: "low",
    control_level: "confirm",
    recommended_actions: [{ blocked: false }],
    ...overrides,
  };
}

const reversibleWrite = {
  operation_class: "reversible_internal_collaboration_write",
  external_side_effect: false,
  contains_customer_data: false,
  rollback_ready: true,
};

test("requires explicit owner confirmation for a reversible internal write", () => {
  const result = buildActionAuthorization(contract(), reversibleWrite);
  assert.equal(result.allowed, false);
  assert.equal(result.state, "confirmation_required");
  assert.equal(result.confirmation_required, true);
  assert.equal(result.confirmation_satisfied, false);
});

test("authorizes the exact low-risk internal write after confirmation", () => {
  const result = buildActionAuthorization(contract(), {
    ...reversibleWrite,
    owner_confirmed: true,
    confirmation_reference: "user confirmed token=must-not-leak",
  });
  assert.equal(result.allowed, true);
  assert.equal(result.state, "authorized_after_confirmation");
  assert.equal(result.mediation, "confirmed");
  assert.equal(result.confirmation_satisfied, true);
  assert(!result.confirmation_reference.includes("must-not-leak"));
});

test("keeps hard blocks, higher risk and external writes closed", () => {
  assert.equal(buildActionAuthorization(contract({ state: "blocked" }), { ...reversibleWrite, owner_confirmed: true }).allowed, false);
  assert.equal(buildActionAuthorization(contract({ risk_band: "medium" }), { ...reversibleWrite, owner_confirmed: true }).allowed, false);
  assert.equal(buildActionAuthorization(contract(), { ...reversibleWrite, owner_confirmed: true, external_side_effect: true }).allowed, false);
});

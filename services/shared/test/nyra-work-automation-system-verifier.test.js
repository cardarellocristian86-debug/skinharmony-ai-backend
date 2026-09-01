import assert from "node:assert/strict";
import test from "node:test";

import { deriveNyraWorkAutomationSystemVerifierId } from "../nyra-work-automation-system-verifier.js";

test("system verifier identity is deterministic and tenant-bound", () => {
  const first = deriveNyraWorkAutomationSystemVerifierId({ tenantId: "tenant-a", workId: "work-1" });
  assert.equal(first, deriveNyraWorkAutomationSystemVerifierId({ tenantId: "tenant-a", workId: "work-1" }));
  assert.notEqual(first, deriveNyraWorkAutomationSystemVerifierId({ tenantId: "tenant-b", workId: "work-1" }));
  assert.notEqual(first, deriveNyraWorkAutomationSystemVerifierId({ tenantId: "tenant-a", workId: "work-2" }));
  assert.match(first, /^system_verifier_[a-f0-9]{24}$/);
});

test("system verifier identity fails closed without both server bindings", () => {
  assert.throws(() => deriveNyraWorkAutomationSystemVerifierId({ tenantId: "", workId: "work-1" }), /binding_invalid/);
  assert.throws(() => deriveNyraWorkAutomationSystemVerifierId({ tenantId: "tenant-a", workId: "" }), /binding_invalid/);
});

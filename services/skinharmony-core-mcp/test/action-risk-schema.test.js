import assert from "node:assert/strict";
import test from "node:test";
import { TOOLS } from "../src/tool-definitions.js";

test("core_gate_action exposes deterministic risk inputs", () => {
  const gate = TOOLS.find((tool) => tool.name === "core_gate_action");
  assert(gate);

  for (const property of [
    "read_only",
    "dry_run",
    "contains_secret",
    "destructive",
    "verified_outcome",
    "bypass_orchestrator",
  ]) {
    assert.equal(gate.inputSchema.properties[property]?.type, "boolean", property);
  }
});

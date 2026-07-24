import test from "node:test";
import assert from "node:assert/strict";
import { createGovernedDynamicThoughtTreeRuntime, parseDttConfig, DTT_POLICY_VERSION } from "../src/dtt/governedDynamicThoughtTree.js";

test("DTT config exposes bounded policy defaults", () => {
  const config = parseDttConfig({ CORE_DTT_ENABLED: "true", CORE_DTT_MODE: "shadow" });
  assert.equal(config.schema_version, DTT_POLICY_VERSION);
  assert.equal(config.enabled, true);
  assert.equal(config.mode, "shadow");
  assert.equal(config.default_depth, 4);
  assert.equal(config.max_depth_cap, 6);
  assert.equal(config.max_children, 3);
  assert.equal(config.beam_width, 3);
  assert.equal(config.max_nodes, 64);
  assert.equal(config.hard_limits.fail_closed, true);
  assert.equal(config.hard_limits.no_cycles, true);
});

test("DTT evaluate returns a contract-shaped result", () => {
  const runtime = createGovernedDynamicThoughtTreeRuntime({
    env: {
      CORE_DTT_ENABLED: "true",
      CORE_DTT_MODE: "shadow",
      CORE_DTT_TENANT_ALLOWLIST: "tenant-a",
      CORE_DTT_L6_ALLOWLIST: "research_evidence",
    },
  });
  const result = runtime.evaluate({
    tenant_id: "tenant-a",
    request_id: "contract-check",
    text: "research evidence",
    intent: "research_evidence",
    fixed_branch_ids: ["research_evidence"],
    branch_catalog: [
      { id: "research_evidence", label: "Research Evidence", parent_id: null },
    ],
  });
  assert.ok(result.run_id);
  assert.ok(result.tree_id);
  assert.equal(result.schema_version, "nyra_governed_dynamic_thought_tree_run_v1");
  assert.equal(result.result.schema_version, "nyra_governed_dynamic_thought_tree_result_v1");
  assert.ok(Array.isArray(result.tree.nodes));
  assert.ok(Array.isArray(result.tree.edges));
  assert.ok("max_depth_reached" in result.telemetry);
  assert.ok("policy_version" in result);
});


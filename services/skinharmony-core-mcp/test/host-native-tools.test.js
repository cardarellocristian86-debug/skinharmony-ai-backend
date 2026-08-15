import assert from "node:assert/strict";
import test from "node:test";

import { HOST_NATIVE_NYRA_WORK_AUTOMATION, HOST_NATIVE_TOOLS } from "../src/host-native-tools.js";

test("host-native work automation remains zero-provider and single-builder", () => {
  assert.equal(HOST_NATIVE_NYRA_WORK_AUTOMATION.schema_version, "nyra_work_automation_v3");
  assert.equal(HOST_NATIVE_NYRA_WORK_AUTOMATION.maximum_parallel_builders, 1);
  assert.equal(HOST_NATIVE_NYRA_WORK_AUTOMATION.provider_execution, false);
  assert.ok(HOST_NATIVE_TOOLS.some((tool) => tool.name === "host_native_action_reconcile"));
});

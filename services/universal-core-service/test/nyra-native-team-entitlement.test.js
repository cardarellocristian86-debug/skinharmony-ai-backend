import assert from "node:assert/strict";
import test from "node:test";
import { BRANCH_PACKAGES, resolveBranchesForKey } from "../branches/index.js";

test("Nyra Native Team entitlement enables orchestration context without standing release authority", () => {
  assert.ok(BRANCH_PACKAGES.nyra_native_team);
  const resolved = resolveBranchesForKey({
    tenant_id: "tenant-native-team",
    metadata: { tier: "nyra_native_team" },
  });
  assert.equal(resolved.tier, "nyra_native_team");
  for (const branch of [
    "agent_orchestration", "ai_orchestration", "agent_orchestration_guard",
    "workload_identity_delegation_guard", "tenant_work_coordination", "quality_verification_intelligence",
  ]) assert.ok(resolved.allowed_branches.includes(branch), branch);
  for (const branch of ["codex_release_gate", "codex_code_safety", "runtime_deployment_scaling_guard"]) {
    assert.equal(resolved.allowed_branches.includes(branch), false, branch);
  }
});

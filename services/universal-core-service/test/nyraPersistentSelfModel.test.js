import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNyraPersistentSelfModelStore } from "../src/nyraPersistentSelfModel.js";

const catalog = {
  schema_version: "nyra_neural_branch_network_v1",
  branches: ["planning_prioritization", "execution_planning", "ai_orchestration", "agent_orchestration", "learning_memory", "adaptive_learning", "risk_governance", "delegated_authority", "software_cognition"].map((id) => ({ id })),
};

test("Nyra persistent self-model is signed, tenant-scoped and idempotent", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-self-model-test-"));
  const store = createNyraPersistentSelfModelStore({ storageRoot, signingSecret: "x".repeat(32) });
  const first = store.readOrRefresh({ tenantId: "tenant-a", catalog });
  const second = store.readOrRefresh({ tenantId: "tenant-a", catalog });
  assert.equal(first.schema_version, "nyra_persistent_self_model_v1");
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 1);
  assert.equal(first.signature, second.signature);
  assert.equal(first.execution_allowed, false);
  assert.equal(second.next_recommended_capability, "verified_outcome_learning_loop");
  assert.ok(fs.existsSync(path.join(storageRoot, "nyra-self-model", "tenant-a.json")));
});

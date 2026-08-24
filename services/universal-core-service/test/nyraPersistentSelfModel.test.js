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

test("Nyra persistent self-model is signed, tenant-scoped and refreshed only by a mutation", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-self-model-test-"));
  const store = createNyraPersistentSelfModelStore({ storageRoot, signingSecret: "x".repeat(32) });
  const authorizedBranchIds = catalog.branches.map(({ id }) => id);
  assert.equal(store.read({ tenantId: "tenant-a", catalog, authorizedBranchIds }), null);
  const first = store.refresh({ tenantId: "tenant-a", catalog, authorizedBranchIds });
  const second = store.read({ tenantId: "tenant-a", catalog, authorizedBranchIds });
  assert.equal(first.schema_version, "nyra_persistent_self_model_v1");
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 1);
  assert.equal(first.signature, second.signature);
  assert.equal(first.execution_allowed, false);
  assert.equal(second.next_recommended_capability, "verified_outcome_learning_loop");
  assert.ok(fs.existsSync(store.fileFor("tenant-a")));
  assert.notEqual(store.fileFor("tenant/a"), store.fileFor("tenant_a"));
  assert.equal(first.capabilities.find((capability) => capability.id === "software_cognition")?.state, "available");
});

test("Nyra persistent self-model rejects altered nested payloads and unauthorized branches", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-self-model-test-"));
  const store = createNyraPersistentSelfModelStore({ storageRoot, signingSecret: "x".repeat(32) });
  const authorizedBranchIds = ["planning_prioritization", "execution_planning"];
  const record = store.refresh({ tenantId: "tenant-a", catalog, authorizedBranchIds });
  assert.equal(record.capabilities.find((capability) => capability.id === "connected_ai_orchestration")?.state, "unavailable");
  const corrupted = JSON.parse(fs.readFileSync(store.fileFor("tenant-a"), "utf8"));
  corrupted.required_infrastructure[0].reason = "altered";
  fs.writeFileSync(store.fileFor("tenant-a"), JSON.stringify(corrupted));
  assert.equal(store.read({ tenantId: "tenant-a", catalog, authorizedBranchIds }), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { verifiedFinalizationAdapter } from "../src/verified-finalization-adapter.js";

test("an unbound operational proof Work closes through generic evidence", () => {
  assert.equal(verifiedFinalizationAdapter({
    work: {
      work_type: "software_git",
      architecture: { schema_version: "nyra_governed_work_bootstrap_v1", declared: {} },
    },
    task_contracts: [],
    committed_task_states: [],
    dependency_manifests: [],
    work_state_projection: { unresolved_effects: [] },
  }), "generic");
});

test("every persisted software or effect binding keeps native closure mandatory", () => {
  const base = {
    work: { work_type: "software_git", architecture: {} },
    task_contracts: [], committed_task_states: [], dependency_manifests: [],
    work_state_projection: { unresolved_effects: [] },
  };
  for (const delta of [
    { work: { ...base.work, architecture: { declared: { repository: "owner/repo" } } } },
    { task_contracts: [{}] },
    { committed_task_states: [{}] },
    { dependency_manifests: [{}] },
    { work_state_projection: { unresolved_effects: [{}] } },
  ]) {
    assert.equal(verifiedFinalizationAdapter({ ...base, ...delta }), "software_git");
  }
});

test("non-software adapters are unchanged", () => {
  assert.equal(verifiedFinalizationAdapter({ work: { work_type: "research" } }), "research");
});

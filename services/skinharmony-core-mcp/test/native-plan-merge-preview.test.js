import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { buildNativePlanMergePreview } from "../src/native-plan-merge-preview.js";

const WORK_ID = "11111111-1111-4111-8111-111111111111";
const BASE_ID = "22222222-2222-4222-8222-222222222222";
const LEFT_ID = "33333333-3333-4333-8333-333333333333";
const RIGHT_ID = "44444444-4444-4444-8444-444444444444";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function plan(planId, version, supersedes, value, status = "planned") {
  const body = {
    schema_version: "native_agent_plan_v1",
    plan_id: planId,
    work_id: WORK_ID,
    repository: "owner/repo",
    base_branch: "main",
    host_type: "codex_native",
    required_checks: ["test"],
    max_parallel: 1,
    closure_requirements: { tests_required: true },
    tasks: value,
    core_authority: { plan_id: `core-${version}` },
  };
  return { plan_id: planId, plan: body, plan_digest: digest(body), status,
    plan_version: version, supersedes_plan_id: supersedes };
}

const build = { task_id: "build", kind: "builder", instruction: "Build", dependencies: [] };
const verify = { task_id: "verify", kind: "verifier", instruction: "Verify", dependencies: ["build"] };

test("derives one structural head and reports stale current status without inventing a merge", () => {
  const rows = [
    plan(BASE_ID, 1, null, [build]),
    plan(LEFT_ID, 2, BASE_ID, [build, verify]),
  ];
  const result = buildNativePlanMergePreview(rows, WORK_ID);
  assert.equal(result.outcome, "STATUS_ALIGNMENT_REQUIRED");
  assert.equal(result.canonical_head_plan_id, LEFT_ID);
  assert.deepEqual(result.stale_current_plan_ids, [BASE_ID]);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.authority_inherited, false);
});

test("builds a deterministic three-way candidate for two compatible heads", () => {
  const research = { task_id: "research", kind: "researcher", instruction: "Research", dependencies: [] };
  const rows = [
    plan(BASE_ID, 1, null, [build], "superseded"),
    plan(LEFT_ID, 2, BASE_ID, [build, verify]),
    plan(RIGHT_ID, 3, BASE_ID, [build, research]),
  ];
  const first = buildNativePlanMergePreview(rows, WORK_ID);
  const second = buildNativePlanMergePreview([...rows].reverse(), WORK_ID);
  assert.equal(first.outcome, "MERGE_CANDIDATE_READY");
  assert.equal(first.common_ancestor_plan_id, BASE_ID);
  assert.deepEqual(first.parent_plan_ids, [LEFT_ID, RIGHT_ID]);
  assert.deepEqual(first.merged_task_projection.map((task) => task.task_id), ["build", "research", "verify"]);
  assert.equal(first.merge_candidate_digest, second.merge_candidate_digest);
  assert.equal(first.evidence_inherited, false);
  assert.equal(first.fresh_core_rebind_required, true);
});

test("reports concurrent task edits as digest-only owner conflicts", () => {
  const rows = [
    plan(BASE_ID, 1, null, [build], "superseded"),
    plan(LEFT_ID, 2, BASE_ID, [{ ...build, instruction: "Build left" }]),
    plan(RIGHT_ID, 3, BASE_ID, [{ ...build, instruction: "Build right" }]),
  ];
  const result = buildNativePlanMergePreview(rows, WORK_ID);
  assert.equal(result.outcome, "CONFLICTS_REQUIRE_OWNER");
  assert.deepEqual(result.conflicts.map((item) => item.path), ["tasks.build"]);
  assert.equal(Object.hasOwn(result.conflicts[0], "left_value"), false);
  assert.equal(result.provider_execution, false);
});

test("fails closed for missing ancestry, invalid digests, cycles and excessive graphs", () => {
  const independent = plan(RIGHT_ID, 2, null, [verify]);
  assert.deepEqual(buildNativePlanMergePreview([
    plan(BASE_ID, 1, null, [build]), independent,
  ], WORK_ID).reason_codes, ["native_plan_common_ancestor_missing"]);

  const corrupt = plan(BASE_ID, 1, null, [build]);
  corrupt.plan.tasks[0].instruction = "tampered";
  assert.deepEqual(buildNativePlanMergePreview([corrupt], WORK_ID).reason_codes, ["plan_digest_invalid"]);

  const cycleA = plan(BASE_ID, 1, LEFT_ID, [build]);
  const cycleB = plan(LEFT_ID, 2, BASE_ID, [verify]);
  assert.deepEqual(buildNativePlanMergePreview([cycleA, cycleB], WORK_ID).reason_codes,
    ["native_plan_cycle"]);

  assert.deepEqual(buildNativePlanMergePreview(Array.from({ length: 101 }, (_, index) => ({
    plan_id: `${index}`, plan: {}, plan_digest: digest({}), status: "planned",
  })), WORK_ID).reason_codes, ["native_plan_graph_too_large"]);
});

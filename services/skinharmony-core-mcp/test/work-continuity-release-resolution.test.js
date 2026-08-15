import assert from "node:assert/strict";
import test from "node:test";

import { WORK_CONTINUITY_TOOLS } from "../src/work-continuity-tools.js";
import { buildServerOwnedReleaseInput, digest } from "../src/work-continuity-runtime.js";
import { validateToolArguments } from "../src/schema-validation.js";

const TENANT = "tenant-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const WORK = "22222222-2222-4222-8222-222222222222";
const CHANGE = "33333333-3333-4333-8333-333333333333";
const STATE = "a".repeat(64);
const HEAD = "1".repeat(40);
const PREVIOUS = "2".repeat(40);

function resolution(overrides = {}) {
  const unsigned = {
    schema_version: "causal_release_tuple_resolution_v1",
    phase: "PRE_ACTION",
    tenant_id: TENANT,
    project_id: PROJECT,
    project_state_digest: STATE,
    genesis_intent_id: "44444444-4444-4444-8444-444444444444",
    intent_revision_id: "55555555-5555-4555-8555-555555555555",
    work_id: WORK,
    change_id: CHANGE,
    repository: "owner/repo",
    base_branch: "main",
    delivery_branch: "feat/release",
    pull_request: 242,
    base_commit: PREVIOUS,
    head_commit: HEAD,
    merge_commit: null,
    target_commit: HEAD,
    tree_sha: "3".repeat(40),
    diff_digest: "4".repeat(64),
    changed_files: ["src/a.js"],
    delivery_method: "github_branch_push_auto_deploy",
    services: [{
      service_id: "srv-core", environment: "production", origin: "https://core.onrender.com",
      previous_commit: PREVIOUS, target_commit: HEAD, target_resolution: "exact_commit",
      health_contract_digest: "5".repeat(64), rollback_health_contract_digest: "6".repeat(64),
    }],
    rollback: {
      mode: "redeploy_previous_commit", target_commit: PREVIOUS,
      health_contract_digest: "6".repeat(64), ready: true, receipt_digest: "7".repeat(64),
    },
    observations: {},
    observed_at: "2026-08-12T12:00:00.000Z",
    expires_at: "2026-08-12T12:05:00.000Z",
    ...overrides,
  };
  const releaseTupleDigest = digest(unsigned);
  return {
    ok: true,
    result: {
      tenant_id: unsigned.tenant_id,
      project_id: unsigned.project_id,
      work_id: unsigned.work_id,
      change_id: unsigned.change_id,
      release_tuple_digest: releaseTupleDigest,
      release_tuple: { ...unsigned, release_tuple_digest: releaseTupleDigest },
    },
  };
}

function lookup() {
  return { project_id: PROJECT, project_state_digest: STATE, work_id: WORK, change_id: CHANGE, pull_request: 242 };
}

test("closure MCP schema accepts lookup only and rejects a caller release tuple", () => {
  const schema = WORK_CONTINUITY_TOOLS.find((tool) => tool.name === "work_continuity_closure_evaluate").inputSchema;
  const input = {
    work_id: WORK,
    plan_id: "66666666-6666-4666-8666-666666666666",
    release_lookup: { project_id: PROJECT, project_state_digest: STATE, change_id: CHANGE, pull_request: 242 },
    idempotency_key: "closure-lookup-only",
  };
  assert.deepEqual(validateToolArguments(schema, input), []);
  const injected = validateToolArguments(schema, { ...input, release: { head_commit: HEAD } });
  assert(injected.some((item) => item.code === "additional_property" && item.path.endsWith(".release")));
});

test("server-owned release adapter verifies digest and exact causal binding", () => {
  const release = buildServerOwnedReleaseInput(resolution(), lookup(), TENANT);
  assert.equal(release.head_commit, HEAD);
  assert.equal(release.delivery.services[0].expected_previous_commit, PREVIOUS);
  assert.equal(release.rollback.health_contract_digest, "6".repeat(64));
  assert.equal(Object.isFrozen(release), true);
  assert.throws(() => buildServerOwnedReleaseInput(resolution({ project_id: "77777777-7777-4777-8777-777777777777" }), lookup(), TENANT),
    /continuity_release_tuple_binding_mismatch/);
  const tampered = resolution();
  tampered.result.release_tuple.head_commit = "f".repeat(40);
  assert.throws(() => buildServerOwnedReleaseInput(tampered, lookup(), TENANT),
    /continuity_release_tuple_digest_mismatch/);
});

test("partial, post-action and cross-tenant resolutions fail closed", () => {
  assert.throws(() => buildServerOwnedReleaseInput(resolution({ services: [] }), lookup(), TENANT),
    /continuity_release_tuple_partial/);
  assert.throws(() => buildServerOwnedReleaseInput(resolution({ phase: "POST_ACTION", merge_commit: HEAD }), lookup(), TENANT),
    /continuity_release_tuple_binding_mismatch/);
  assert.throws(() => buildServerOwnedReleaseInput(resolution({ tenant_id: "tenant-b" }), lookup(), TENANT),
    /continuity_release_tuple_binding_mismatch/);
});

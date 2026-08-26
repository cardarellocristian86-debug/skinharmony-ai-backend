import assert from "node:assert/strict";
import test from "node:test";

import { causalDigest } from "../src/causalContinuityCanonical.js";
import {
  RELEASE_TUPLE_LOOKUP_VERSION,
  createServerOwnedReleaseTupleResolver,
} from "../src/causalIdentityReleaseResolution.js";
import { createCausalContinuityRuntime } from "../src/causalContinuityRuntime.js";
import { createInMemoryCausalContinuityStore } from "../src/causalContinuityStore.js";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const ACTOR = {
  tenant_id: "tenant-a",
  actor_id: "owner-a",
  actor_role: "owner",
  authority_scope: ["causal:write", "intent:approve:strategic"],
  owner_confirmed: true,
  provenance: { session_fingerprint: "a".repeat(24) },
};
const HEAD = "1".repeat(40);
const TREE = "2".repeat(40);
const PREVIOUS = "3".repeat(40);

function observation(kind, lookup, suffix) {
  return {
    kind,
    source: `${kind.toLowerCase()}_readback`,
    observer: `independent-${kind.toLowerCase()}`,
    independence: "INDEPENDENT_SYSTEM",
    observed_at: NOW.toISOString(),
    fresh_until: "2026-08-12T12:05:00.000Z",
    evidence_digest: suffix.repeat(64),
    status: "VERIFIED",
    tenant_id: lookup.tenant_id,
    project_id: lookup.project_id,
  };
}

function observedTuple(lookup, overrides = {}) {
  return {
    phase: "PRE_ACTION",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    base_branch: "main",
    delivery_branch: "feat/causal-v1",
    pull_request: lookup.pull_request,
    base_commit: PREVIOUS,
    head_commit: HEAD,
    merge_commit: null,
    tree_sha: TREE,
    diff_digest: "4".repeat(64),
    changed_files: ["services/universal-core-service/src/app.js"],
    delivery_method: "github_branch_push_auto_deploy",
    services: [{
      service_id: "srv-universal",
      environment: "production",
      origin: "https://universal-core.onrender.com",
      previous_commit: PREVIOUS,
      target_commit: HEAD,
      target_resolution: "exact_commit",
      health_contract_digest: "5".repeat(64),
      rollback_health_contract_digest: "6".repeat(64),
    }],
    rollback: { mode: "redeploy_previous_commit", target_commit: PREVIOUS, health_contract_digest: "6".repeat(64), ready: true, receipt_digest: "7".repeat(64) },
    observations: {
      github: observation("GITHUB", lookup, "8"),
      project_scope: observation("PROJECT_SCOPE", lookup, "9"),
      render: observation("RENDER", lookup, "a"),
      receipt: observation("RECEIPT", lookup, "b"),
    },
    observed_at: NOW.toISOString(),
    expires_at: "2026-08-12T12:05:00.000Z",
    ...overrides,
  };
}

async function fixture(observer = (lookup) => observedTuple(lookup)) {
  const store = createInMemoryCausalContinuityStore({ now: () => NOW });
  const resolver = createServerOwnedReleaseTupleResolver({ observe: observer, now: () => NOW });
  const runtime = createCausalContinuityRuntime({ store, now: () => NOW, resolveReleaseTuple: resolver });
  const project = await runtime.project_identity_create(ACTOR, {
    canonical_name: "SkinHarmony",
    alias: "repo",
    idempotency_key: "project",
  });
  await runtime.project_scope_bind(ACTOR, {
    project_id: project.project_id,
    resource_type: "github_repository",
    canonical_identifier: "cardarellocristian86-debug/skinharmony-ai-backend",
    environment: "shared",
    ownership: { owner: "platform" },
    provenance: { source: "independent-readback" },
    resource_digest: "c".repeat(64),
    last_verified_at: NOW.toISOString(),
    idempotency_key: "scope",
  });
  const state = await runtime.project_state_snapshot(ACTOR, {
    project_id: project.project_id,
    observed_at: NOW.toISOString(),
    idempotency_key: "state",
  });
  const genesis = await runtime.genesis_intent_create(ACTOR, {
    project_id: project.project_id,
    intent_text: "Build a governed persistent and verifiable artificial intelligence infrastructure.",
    idempotency_key: "genesis",
  });
  const revision = await runtime.intent_revision_propose(ACTOR, {
    project_id: project.project_id,
    alias: "causal-v1",
    classification: "REFINEMENT",
    motivation: "Preserve intent",
    problem: "Execution is not verification",
    alternatives_considered: ["work-only"],
    idempotency_key: "revision",
  });
  await runtime.intent_revision_approve(ACTOR, {
    project_id: project.project_id,
    intent_revision_id: revision.intent_revision_id,
    idempotency_key: "approve",
  });
  const work = await runtime.work_bind_intent(ACTOR, {
    project_id: project.project_id,
    work_id: "11111111-1111-4111-8111-111111111111",
    intent_revision_id: revision.intent_revision_id,
    base_state_digest: state.state_digest,
    provenance: { source: "core-work" },
    idempotency_key: "work",
  });
  const change = await runtime.change_create(ACTOR, {
    project_id: project.project_id,
    work_id: work.work_id,
    base_state_digest: state.state_digest,
    reason: "Resolve release tuple server-side",
    scope: { component: "universal-core" },
    expected_effects: ["authoritative-release-tuple"],
    forbidden_effects: ["caller-release-authority"],
    expected_target_state: { release_tuple: "persisted" },
    idempotency_key: "change",
  });
  return { runtime, store, project, state, genesis, revision, work, change };
}

test("server-owned resolver receives only a frozen lookup key and persists exact causal binding", async () => {
  let observedLookup;
  const f = await fixture((lookup) => {
    observedLookup = lookup;
    return observedTuple(lookup);
  });
  const result = await f.runtime.release_tuple_resolve(ACTOR, {
    project_id: f.project.project_id,
    project_state_digest: f.state.state_digest,
    work_id: f.work.work_id,
    change_id: f.change.change_id,
    pull_request: 242,
    repository: "attacker/forged",
    head_commit: "f".repeat(40),
    services: [{ service_id: "forged" }],
    idempotency_key: "resolve",
  });
  assert.deepEqual(Object.keys(observedLookup).sort(), [
    "change_id", "genesis_intent_id", "intent_revision_id", "project_id", "project_state_digest",
    "pull_request", "schema_version", "tenant_id", "work_id",
  ]);
  assert.equal(Object.isFrozen(observedLookup), true);
  assert.equal(observedLookup.schema_version, RELEASE_TUPLE_LOOKUP_VERSION);
  assert.equal(result.release_tuple.repository, "cardarellocristian86-debug/skinharmony-ai-backend");
  assert.equal(result.release_tuple.head_commit, HEAD);
  assert.equal(result.project_id, f.project.project_id);
  assert.equal(result.event_sequence > 0, true);
  const read = await f.runtime.release_tuple_read(ACTOR, {
    project_id: f.project.project_id,
    work_id: f.work.work_id,
    change_id: f.change.change_id,
    phase: "PRE_ACTION",
  });
  assert.equal(read.release_tuple.release_tuple_digest, result.release_tuple_digest);
  const { release_tuple_digest: _embedded, ...unsigned } = read.release_tuple;
  assert.equal(causalDigest(unsigned), result.release_tuple_digest);
  const capsule = await f.runtime.continuity_capsule_build(ACTOR, {
    project_id: f.project.project_id,
    work_id: f.work.work_id,
    next_safe_action: "await independent verifier",
    forbidden_actions: ["caller tuple fallback"],
    idempotency_key: "capsule-with-release",
  });
  assert.equal(capsule.capsule.release_tuple_resolutions[0].release_tuple_digest, result.release_tuple_digest);
});

test("resolver blocks stale, partial, degraded, rollback-tampered and cross-project observations", async () => {
  const cases = [
    ["stale", (lookup) => observedTuple(lookup, { observed_at: "2026-08-12T11:00:00.000Z" }), /RELEASE_OBSERVATION_STALE/],
    ["partial", (lookup) => observedTuple(lookup, { services: [] }), /RELEASE_SERVICES_INVALID/],
    ["degraded", (lookup) => observedTuple(lookup, { observations: { ...observedTuple(lookup).observations, render: { ...observation("RENDER", lookup, "a"), status: "DEGRADED" } } }), /RELEASE_OBSERVATION_UNVERIFIED/],
    ["rollback", (lookup) => observedTuple(lookup, { rollback: { mode: "redeploy_previous_commit", target_commit: "f".repeat(40), health_contract_digest: "6".repeat(64), ready: true, receipt_digest: "7".repeat(64) } }), /RELEASE_ROLLBACK_MISMATCH/],
    ["cross-project", (lookup) => observedTuple(lookup, { observations: { ...observedTuple(lookup).observations, github: { ...observation("GITHUB", lookup, "8"), project_id: "22222222-2222-4222-8222-222222222222" } } }), /RELEASE_OBSERVATION_BINDING_MISMATCH/],
  ];
  for (const [name, observer, expected] of cases) {
    const f = await fixture(observer);
    await assert.rejects(f.runtime.release_tuple_resolve(ACTOR, {
      project_id: f.project.project_id,
      project_state_digest: f.state.state_digest,
      work_id: f.work.work_id,
      change_id: f.change.change_id,
      pull_request: 242,
      idempotency_key: `resolve-${name}`,
    }), expected);
  }
});

test("old Project State is rejected before the server-owned observer runs", async () => {
  let calls = 0;
  const f = await fixture((lookup) => { calls += 1; return observedTuple(lookup); });
  await f.runtime.project_scope_bind(ACTOR, {
    project_id: f.project.project_id,
    resource_type: "documentation",
    canonical_identifier: "docs:v2",
    environment: "shared",
    ownership: {}, provenance: {}, idempotency_key: "scope-advance",
  });
  await assert.rejects(f.runtime.release_tuple_resolve(ACTOR, {
    project_id: f.project.project_id,
    project_state_digest: f.state.state_digest,
    work_id: f.work.work_id,
    change_id: f.change.change_id,
    pull_request: 242,
    idempotency_key: "stale-resolve",
  }), (error) => error?.code === "STALE_PROJECT_STATE");
  assert.equal(calls, 0);
});

test("identity spine is deterministic and purpose change can only derive a new Project", async () => {
  const f = await fixture();
  const first = await f.runtime.project_identity_spine_read(ACTOR, { project_id: f.project.project_id });
  const second = await f.runtime.project_identity_spine_read(ACTOR, { project_id: f.project.project_id });
  assert.equal(first.spine_digest, second.spine_digest);
  assert.equal(first.genesis_intent.genesis_intent_id, f.genesis.genesis_intent_id);
  const purpose = await f.runtime.intent_revision_propose(ACTOR, {
    project_id: f.project.project_id,
    parent_revision_id: f.revision.intent_revision_id,
    alias: "new-purpose",
    classification: "PURPOSE_CHANGE",
    motivation: "A genuinely different purpose",
    problem: "The requested purpose is incompatible",
    alternatives_considered: ["new project"],
    idempotency_key: "purpose",
  });
  await assert.rejects(f.runtime.intent_revision_approve(ACTOR, {
    project_id: f.project.project_id,
    intent_revision_id: purpose.intent_revision_id,
    idempotency_key: "purpose-approve",
  }), /NEW_PROJECT_REQUIRED/);
  const derived = await f.runtime.project_identity_create(ACTOR, {
    canonical_name: "Different purpose",
    derived_from_project_id: f.project.project_id,
    purpose_change_revision_id: purpose.intent_revision_id,
    idempotency_key: "derived",
  });
  assert.equal(derived.derived_from_project_id, f.project.project_id);
  assert.equal(derived.derived_from_intent_revision_id, purpose.intent_revision_id);
});

test("bounded identity spine reads the exact active revision outside the history page", async () => {
  const projectId = "99999999-9999-4999-8999-999999999999";
  const activeId = "88888888-8888-4888-8888-888888888888";
  const active = { tenant_id: ACTOR.tenant_id, project_id: projectId, intent_revision_id: activeId, state: "APPROVED", created_at: NOW.toISOString() };
  const page = Array.from({ length: 200 }, (_, index) => ({
    tenant_id: ACTOR.tenant_id, project_id: projectId,
    intent_revision_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    state: "APPROVED", created_at: new Date(NOW.getTime() - (201 - index) * 1_000).toISOString(),
  }));
  const runtime = createCausalContinuityRuntime({ store: {
    async readProject() { return { tenant_id: ACTOR.tenant_id, project_id: projectId, active_intent_revision_id: activeId }; },
    async readGenesis() { return { tenant_id: ACTOR.tenant_id, project_id: projectId, genesis_intent_id: "77777777-7777-4777-8777-777777777777" }; },
    async listRevisions() { return page; },
    async currentState() { return null; },
    async readRevision() { return active; },
  } });
  const spine = await runtime.project_identity_spine_read(ACTOR, { project_id: projectId, limit: 200 });
  assert.equal(spine.active_intent_revision.intent_revision_id, activeId);
  assert.equal(spine.intent_revisions.length, 200);
  assert.equal(spine.intent_revision_history_may_continue, true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { canonicalize, causalDigest, CausalContinuityError } from "../src/causalContinuityCanonical.js";
import { createCausalContinuityRuntime } from "../src/causalContinuityRuntime.js";
import { buildCausalEventHash, createInMemoryCausalContinuityStore } from "../src/causalContinuityStore.js";

const CONTEXT = {
  tenant_id: "tenant-a",
  actor_id: "owner-a",
  actor_role: "owner",
  authority_scope: ["causal:write", "causal:change:execute", "causal:obligation:execute", "intent:approve:strategic"],
  owner_confirmed: true,
};

function signer() {
  return {
    async sign(envelope) { return { key_id: "existing-test-signer", digest: causalDigest(envelope) }; },
    async verify(envelope, signature) { return signature?.key_id === "existing-test-signer" && signature?.digest === causalDigest(envelope); },
  };
}

async function fixture({ withSigner = true } = {}) {
  let clock = new Date("2026-08-09T12:00:00.000Z");
  const now = () => new Date(clock);
  const store = createInMemoryCausalContinuityStore({ now });
  const verifyActionLease = async (request) => {
    const surfaces = [
      { kind: "causal_project", value: request.project_id }, { kind: "causal_change", value: request.change_id },
      ...request.obligation_ids.map((value) => ({ kind: "causal_obligation", value })),
    ].sort((a, b) => `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`));
    const persisted_authority_scope = [...CONTEXT.authority_scope].sort();
    const authorityProof = { schema_version: "persisted_lease_authority_v1", tenant_id: request.tenant_id,
      lease_id: request.lease_id, actor_id: request.actor_id, purpose: "causal_context_issue", surfaces, persisted_authority_scope };
    return { valid: true, readback_verified: true, active: true, replayed: false, consumed: false, revoked: false,
      tenant_id: request.tenant_id, project_id: request.project_id, work_id: request.work_id, change_id: request.change_id,
      obligation_ids: request.obligation_ids, lease_id: request.lease_id, purpose: "causal_context_issue", surfaces,
      persisted_authority_scope, authority_source: "persisted_lease_policy_v1",
      authority_binding_digest: causalDigest(authorityProof), expires_at: "2026-08-09T12:10:00.000Z" };
  };
  const runtime = createCausalContinuityRuntime({ store, now, contextSigner: withSigner ? signer() : undefined, verifyActionLease });
  await runtime.initialize();
  const project = await runtime.project_identity_create(CONTEXT, { idempotency_key: "project-1", alias: "repo-alias", canonical_name: "Repository" });
  await runtime.project_scope_bind(CONTEXT, {
    project_id: project.project_id, idempotency_key: "scope-1", resource_type: "repository",
    canonical_identifier: "github:owner/repository", environment: "shared", ownership: { owner: "owner-a" },
    provenance: { source: "verified-readback" }, resource_digest: "a".repeat(64), last_verified_at: clock.toISOString(),
  });
  const snapshot = await runtime.project_state_snapshot(CONTEXT, { project_id: project.project_id, idempotency_key: "state-1", observed_at: clock.toISOString() });
  const genesis = await runtime.genesis_intent_create(CONTEXT, { project_id: project.project_id, idempotency_key: "genesis-1", intent_text: "Build a governed persistent and verifiable AI infrastructure." });
  const revision = await runtime.intent_revision_propose(CONTEXT, {
    project_id: project.project_id, idempotency_key: "revision-1", alias: "causal-v1", classification: "REFINEMENT",
    motivation: "Preserve causal continuity", problem: "Execution can be confused with verification", alternatives_considered: ["work-only"],
  });
  await runtime.intent_revision_approve(CONTEXT, { project_id: project.project_id, intent_revision_id: revision.intent_revision_id, idempotency_key: "revision-approve-1" });
  const work = await runtime.work_bind_intent(CONTEXT, {
    project_id: project.project_id, work_id: "11111111-1111-4111-8111-111111111111",
    intent_revision_id: revision.intent_revision_id, base_state_digest: snapshot.state_digest,
    provenance: { source: "core-work" }, idempotency_key: "work-1",
  });
  const change = await runtime.change_create(CONTEXT, {
    project_id: project.project_id, work_id: work.work_id, base_state_digest: snapshot.state_digest,
    reason: "Add causal store", scope: { component: "universal-core" }, expected_effects: ["durable-lineage"],
    forbidden_effects: ["cross-tenant-binding"], expected_target_state: { migration: "applied" }, idempotency_key: "change-1",
  });
  const obligation = await runtime.causal_obligation_create(CONTEXT, {
    change_id: change.change_id, claim: "The causal store remains tenant isolated", assurance_level: "CAL-2",
    verification_horizons: ["immediate"], rollback_plan: { mode: "feature-flag" }, idempotency_key: "obligation-1",
    evidence_contract: {
      required_sources: ["postgres-readback"], minimum_independence: "INDEPENDENT_SYSTEM", freshness_seconds: 300,
      minimum_assurance_level: "CAL-2", horizons: ["immediate"], falsification_conditions: ["cross-tenant-row"],
      forbidden_effect_observers: ["tenant-isolation-probe"],
    },
  });
  await runtime.change_transition(CONTEXT, { change_id: change.change_id, target_state: "MODELED", reason: "model complete", idempotency_key: "change-modeled" });
  await runtime.causal_obligation_transition(CONTEXT, { obligation_id: obligation.obligation_id, target_state: "MODELED", reason: "obligation modeled", idempotency_key: "obligation-modeled" });
  return { runtime, store, now, setClock(value) { clock = new Date(value); }, project, snapshot, genesis, revision, work, change, obligation };
}

async function executeFixture(f, lease_id = "lease-execute") {
  const issued = await f.runtime.causal_context_issue(CONTEXT, {
    project_id: f.project.project_id, project_state_digest: f.snapshot.state_digest, work_id: f.work.work_id,
    change_id: f.change.change_id, obligation_ids: [f.obligation.obligation_id], environment: "staging",
    lease_id, expires_at: "2026-08-09T12:05:00.000Z", idempotency_key: `${lease_id}-context`,
  });
  await f.runtime.causal_context_validate(CONTEXT, { ...issued, expected_environment: "staging", consume: true });
  await f.runtime.change_transition(CONTEXT, {
    change_id: f.change.change_id, target_state: "EXECUTED", lease_id,
    context_digest: issued.envelope.context_digest, execution_evidence_digest: "8".repeat(64),
    reason: "authorized action executed", idempotency_key: `${lease_id}-change-executed`,
  });
  await f.runtime.causal_obligation_transition(CONTEXT, {
    obligation_id: f.obligation.obligation_id, target_state: "EXECUTED", lease_id,
    context_digest: issued.envelope.context_digest, execution_evidence_digest: "9".repeat(64),
    reason: "authorized obligation executed", idempotency_key: `${lease_id}-obligation-executed`,
  });
}

test("canonical JSON is deterministic and excludes undefined fields", () => {
  assert.equal(canonicalize({ z: 1, a: { y: 2, x: undefined } }), '{"a":{"y":2},"z":1}');
  assert.equal(causalDigest({ b: 2, a: 1 }), causalDigest({ a: 1, b: 2 }));
});

test("event hash commits actor provenance, idempotency key and payload digest", () => {
  const base = {
    tenant_id: "tenant-a", project_id: "11111111-1111-4111-8111-111111111111",
    event_id: "22222222-2222-4222-8222-222222222222", sequence_number: 7,
    event_type: "CHANGE_OPENED", operation: "change_create", idempotency_key: "idem-a",
    request_digest: "a".repeat(64), payload_digest: "b".repeat(64), actor_provenance: { agent_id: "agent-a" },
    previous_event_hash: "c".repeat(64),
  };
  const original = buildCausalEventHash(base);
  assert.notEqual(original, buildCausalEventHash({ ...base, actor_provenance: { agent_id: "agent-b" } }));
  assert.notEqual(original, buildCausalEventHash({ ...base, idempotency_key: "idem-b" }));
  assert.notEqual(original, buildCausalEventHash({ ...base, payload_digest: "d".repeat(64) }));
});

test("tenant-scoped rollout is versioned, progressive, reversible and authority gated", async () => {
  const f = await fixture();
  const initial = await f.runtime.causal_rollout_read(CONTEXT, { project_id: f.project.project_id });
  assert.equal(initial.mode, "SHADOW");
  assert.equal(initial.version, 1);

  await assert.rejects(
    () => f.runtime.causal_rollout_set(CONTEXT, {
      project_id: f.project.project_id, mode: "ENFORCE_ALL_COMPATIBLE", expected_version: 1, idempotency_key: "rollout-skip",
    }),
    (error) => error.code === "ROLLOUT_TRANSITION_INVALID",
  );
  await assert.rejects(
    () => f.runtime.causal_rollout_set({ ...CONTEXT, owner_confirmed: false, authority_scope: ["causal:read"] }, {
      project_id: f.project.project_id, mode: "ENFORCE_NEW_WORK", expected_version: 1, idempotency_key: "rollout-unauthorized",
    }),
    (error) => error.code === "AUTHORITY_SCOPE_VIOLATION",
  );

  const enforced = await f.runtime.causal_rollout_set(CONTEXT, {
    project_id: f.project.project_id, mode: "ENFORCE_NEW_WORK", expected_version: 1, idempotency_key: "rollout-enforce-new",
  });
  assert.equal(enforced.mode, "ENFORCE_NEW_WORK");
  assert.equal(enforced.version, 2);
  await assert.rejects(
    () => f.runtime.causal_rollout_set(CONTEXT, {
      project_id: f.project.project_id, mode: "SHADOW", expected_version: 1, idempotency_key: "rollout-stale",
    }),
    (error) => error.code === "STALE_PROJECT_STATE",
  );
  const rolledBack = await f.runtime.causal_rollout_set(CONTEXT, {
    project_id: f.project.project_id, mode: "SHADOW", expected_version: 2, idempotency_key: "rollout-shadow",
  });
  assert.equal(rolledBack.mode, "SHADOW");
  assert.equal(rolledBack.version, 3);
});

test("creates stable project lineage and rejects stale project state", async () => {
  const f = await fixture();
  assert.match(f.project.project_id, /^[0-9a-f-]{36}$/);
  assert.equal(f.work.genesis_intent_id, f.genesis.genesis_intent_id);
  assert.equal(f.change.intent_revision_id, f.revision.intent_revision_id);
  await f.runtime.project_scope_bind(CONTEXT, {
    project_id: f.project.project_id, idempotency_key: "scope-2", resource_type: "service",
    canonical_identifier: "render:universal-core", environment: "production", ownership: {}, provenance: {},
  });
  await assert.rejects(
    () => f.runtime.project_state_verify(CONTEXT, { project_id: f.project.project_id, project_state_digest: f.snapshot.state_digest }),
    (error) => error.code === "STALE_PROJECT_STATE",
  );
  const next = await f.runtime.project_state_snapshot(CONTEXT, {
    project_id: f.project.project_id, base_state_digest: f.snapshot.state_digest, idempotency_key: "state-2",
  });
  await assert.rejects(
    () => f.runtime.change_create(CONTEXT, {
      project_id: f.project.project_id, work_id: f.work.work_id, base_state_digest: f.snapshot.state_digest,
      reason: "stale", expected_target_state: {}, idempotency_key: "stale-change",
    }),
    (error) => error instanceof CausalContinuityError && error.code === "STALE_PROJECT_STATE",
  );
  assert.notEqual(next.state_digest, f.snapshot.state_digest);
});

test("parent intent revision is same-project, approved and cycle-safe", async () => {
  const f = await fixture();
  const other = await f.runtime.project_identity_create(CONTEXT, { idempotency_key: "other-project", canonical_name: "Other" });
  await f.runtime.genesis_intent_create(CONTEXT, { project_id: other.project_id, idempotency_key: "other-genesis", intent_text: "Other purpose" });
  const otherRevision = await f.runtime.intent_revision_propose(CONTEXT, {
    project_id: other.project_id, idempotency_key: "other-revision", alias: "other", classification: "REFINEMENT",
    motivation: "Other", problem: "Other",
  });
  await f.runtime.intent_revision_approve(CONTEXT, { project_id: other.project_id, intent_revision_id: otherRevision.intent_revision_id, idempotency_key: "other-approve" });
  await assert.rejects(
    () => f.runtime.intent_revision_propose(CONTEXT, {
      project_id: f.project.project_id, parent_revision_id: otherRevision.intent_revision_id, idempotency_key: "cross-parent",
      alias: "cross", classification: "REFINEMENT", motivation: "Cross", problem: "Cross",
    }),
    (error) => error.code === "INTENT_PARENT_INVALID",
  );
  const row = f.store.state.revisions.get(`${CONTEXT.tenant_id}\u0000${f.revision.intent_revision_id}`);
  row.parent_revision_id = row.intent_revision_id;
  await assert.rejects(
    () => f.runtime.intent_revision_propose(CONTEXT, {
      project_id: f.project.project_id, parent_revision_id: f.revision.intent_revision_id, idempotency_key: "cycle-child",
      alias: "cycle", classification: "REFINEMENT", motivation: "Cycle", problem: "Cycle",
    }),
    (error) => error.code === "INTENT_REVISION_CYCLE",
  );
});

test("purpose change cannot be approved in place", async () => {
  const f = await fixture();
  const purpose = await f.runtime.intent_revision_propose(CONTEXT, {
    project_id: f.project.project_id, parent_revision_id: f.revision.intent_revision_id, idempotency_key: "purpose-1",
    alias: "different-purpose", classification: "PURPOSE_CHANGE", motivation: "New purpose", problem: "Different objective",
  });
  await assert.rejects(
    () => f.runtime.intent_revision_approve(CONTEXT, { project_id: f.project.project_id, intent_revision_id: purpose.intent_revision_id, idempotency_key: "purpose-approve" }),
    (error) => error.code === "NEW_PROJECT_REQUIRED",
  );
});

test("context issue fails closed without injected signer", async () => {
  const f = await fixture({ withSigner: false });
  await assert.rejects(
    () => f.runtime.causal_context_issue(CONTEXT, {
      project_id: f.project.project_id, project_state_digest: f.snapshot.state_digest, work_id: f.work.work_id,
      change_id: f.change.change_id, obligation_ids: [f.obligation.obligation_id], environment: "staging",
      lease_id: "lease-1", expires_at: "2026-08-09T12:05:00.000Z", idempotency_key: "context-1",
    }),
    (error) => error.code === "CAUSAL_SIGNER_UNAVAILABLE",
  );
});

test("context nonce is consumed once and expiry equality is blocked", async () => {
  const f = await fixture();
  const issued = await f.runtime.causal_context_issue(CONTEXT, {
    project_id: f.project.project_id, project_state_digest: f.snapshot.state_digest, work_id: f.work.work_id,
    change_id: f.change.change_id, obligation_ids: [f.obligation.obligation_id], environment: "staging",
    lease_id: "lease-1", expires_at: "2026-08-09T12:05:00.000Z", idempotency_key: "context-1",
  });
  const first = await f.runtime.causal_context_validate(CONTEXT, { ...issued, expected_environment: "staging", consume: true });
  assert.equal(first.consumed, true);
  await assert.rejects(
    () => f.runtime.causal_context_validate(CONTEXT, { ...issued, expected_environment: "staging", consume: true }),
    (error) => error.code === "CONTEXT_REPLAYED",
  );
  f.setClock("2026-08-09T12:05:00.000Z");
  await assert.rejects(
    () => f.runtime.causal_context_validate(CONTEXT, { ...issued, consume: false }),
    (error) => error.code === "CONTEXT_EXPIRED",
  );
});

test("context authority cannot exceed actor or verified lease and lease replay is blocked", async () => {
  const f = await fixture();
  const base = {
    project_id: f.project.project_id, project_state_digest: f.snapshot.state_digest, work_id: f.work.work_id,
    change_id: f.change.change_id, obligation_ids: [f.obligation.obligation_id], environment: "staging",
    expires_at: "2026-08-09T12:05:00.000Z",
  };
  await assert.rejects(
    () => f.runtime.causal_context_issue(CONTEXT, { ...base, lease_id: "lease-escalated", authority_scope: [...CONTEXT.authority_scope, "admin:all"], idempotency_key: "context-escalated" }),
    (error) => error.code === "AUTHORITY_SCOPE_VIOLATION",
  );
  await f.runtime.causal_context_issue(CONTEXT, { ...base, lease_id: "lease-single-use", idempotency_key: "context-first" });
  await assert.rejects(
    () => f.runtime.causal_context_issue(CONTEXT, { ...base, lease_id: "lease-single-use", idempotency_key: "context-second" }),
    (error) => error.code === "LEASE_REPLAYED",
  );
  const noLeaseRuntime = createCausalContinuityRuntime({ store: f.store, now: f.now, contextSigner: signer() });
  await assert.rejects(
    () => noLeaseRuntime.causal_context_issue(CONTEXT, { ...base, lease_id: "lease-no-verifier", idempotency_key: "context-no-verifier" }),
    (error) => error.code === "LEASE_VERIFIER_UNAVAILABLE",
  );
  const mismatchedLeaseRuntime = createCausalContinuityRuntime({
    store: f.store, now: f.now, contextSigner: signer(),
    verifyActionLease: async (request) => ({
      ...request, valid: true, readback_verified: true, active: true,
      project_id: "22222222-2222-4222-8222-222222222222",
      expires_at: "2026-08-09T12:10:00.000Z",
    }),
  });
  await assert.rejects(
    () => mismatchedLeaseRuntime.causal_context_issue(CONTEXT, { ...base, lease_id: "lease-wrong-project", idempotency_key: "context-wrong-project" }),
    (error) => error.code === "LEASE_AUTHORITY_UNPROVEN",
  );
  assert.equal(f.store.state.leases.has(`${CONTEXT.tenant_id}\u0000lease-wrong-project`), false);
});

test("atomic consume rechecks project state and rejects different authenticated session", async () => {
  const f = await fixture();
  const issuingContext = { ...CONTEXT, provenance: { session_fingerprint: "session-a" } };
  const issued = await f.runtime.causal_context_issue(issuingContext, {
    project_id: f.project.project_id, project_state_digest: f.snapshot.state_digest, work_id: f.work.work_id,
    change_id: f.change.change_id, obligation_ids: [f.obligation.obligation_id], environment: "staging",
    lease_id: "lease-toctou", expires_at: "2026-08-09T12:05:00.000Z", idempotency_key: "context-toctou",
  });
  await assert.rejects(
    () => f.runtime.causal_context_validate({ ...CONTEXT, provenance: { session_fingerprint: "session-b" } }, { ...issued, consume: true }),
    (error) => error.code === "CAUSAL_IDENTITY_MISMATCH",
  );
  await f.runtime.project_scope_bind(CONTEXT, {
    project_id: f.project.project_id, idempotency_key: "scope-toctou", resource_type: "service",
    canonical_identifier: "render:changed", environment: "production", ownership: {}, provenance: {},
  });
  await f.runtime.project_state_snapshot(CONTEXT, {
    project_id: f.project.project_id, base_state_digest: f.snapshot.state_digest, idempotency_key: "state-toctou",
  });
  await assert.rejects(
    () => f.runtime.causal_context_validate(issuingContext, { ...issued, consume: true }),
    (error) => error.code === "STALE_PROJECT_STATE",
  );
});

test("high-assurance self-attestation does not verify and delayed contradiction reopens", async () => {
  const f = await fixture();
  await executeFixture(f, "lease-high-assurance");
  await f.runtime.causal_observation_record(CONTEXT, {
    obligation_id: f.obligation.obligation_id, source: "executor", observer_identity: "owner-a", observer_role: "executor",
    independence: "EXECUTOR", evidence_digest: "b".repeat(64), confidence: 0.9, idempotency_key: "observation-self",
  });
  const selfOnly = await f.runtime.causal_reconcile(CONTEXT, {
    obligation_id: f.obligation.obligation_id, achieved_assurance_level: "CAL-2", verdict: "VERIFIED_PROVISIONAL", idempotency_key: "reconcile-self",
  });
  assert.equal(selfOnly.verdict, "PARTIAL");
  assert.equal(selfOnly.achieved_assurance_level, "CAL-1");
  const independentContext = {
    ...CONTEXT, actor_id: "independent-db-probe",
    authority_scope: [...CONTEXT.authority_scope, "causal:evidence:independent"],
    provenance: { session_fingerprint: "observer-session", observer_independence: "INDEPENDENT_SYSTEM" },
  };
  const independentObservation = await f.runtime.causal_observation_record(independentContext, {
    obligation_id: f.obligation.obligation_id, source: "postgres-readback", observer_identity: "independent-db-probe", observer_role: "system-observer",
    independence: "EXECUTOR", evidence_digest: "c".repeat(64), confidence: 0.99, idempotency_key: "observation-independent",
  });
  const reconciled = await f.runtime.causal_reconcile(CONTEXT, {
    obligation_id: f.obligation.obligation_id, achieved_assurance_level: "CAL-4", verdict: "HARMFUL", idempotency_key: "reconcile-independent",
  });
  assert.equal(reconciled.verdict, "VERIFIED_PROVISIONAL");
  assert.equal(reconciled.achieved_assurance_level, "CAL-2");
  await assert.rejects(
    () => f.runtime.causal_close(CONTEXT, {
      obligation_id: f.obligation.obligation_id, reconciliation_id: reconciled.reconciliation_id,
      final: true, temporal_checks_satisfied: true, idempotency_key: "false-finality",
    }),
    (error) => error.code === "TEMPORAL_CHECKS_PENDING",
  );
  const closed = await f.runtime.causal_close(CONTEXT, {
    obligation_id: f.obligation.obligation_id, reconciliation_id: reconciled.reconciliation_id, idempotency_key: "close-provisional",
  });
  assert.equal(closed.obligation.state, "VERIFIED_PROVISIONAL");
  const [temporalCheck] = await f.store.listTemporalChecks({ tenant_id: CONTEXT.tenant_id, obligation_id: f.obligation.obligation_id });
  await f.store.updateTemporalCheck({
    tenant_id: CONTEXT.tenant_id, temporal_check_id: temporalCheck.temporal_check_id,
    state: "SATISFIED", observation_id: independentObservation.observation_id,
  });
  const final = await f.runtime.causal_close(CONTEXT, {
    obligation_id: f.obligation.obligation_id, reconciliation_id: reconciled.reconciliation_id,
    final: true, temporal_checks_satisfied: false, idempotency_key: "server-derived-final",
  });
  assert.equal(final.obligation.state, "VERIFIED_FINAL");
  const contradiction = await f.runtime.causal_observation_record(independentContext, {
    obligation_id: f.obligation.obligation_id, source: "regression-probe", observer_identity: "independent-db-probe",
    observer_role: "system-observer", independence: "INDEPENDENT_SYSTEM", evidence_digest: "d".repeat(64), confidence: 1,
    contradiction_status: "CONFIRMED", idempotency_key: "delayed-contradiction",
  });
  assert.equal(contradiction.obligation_reopened, true);
  assert.equal((await f.runtime.causal_obligation_read(CONTEXT, { obligation_id: f.obligation.obligation_id })).state, "CONTRADICTED");
});

test("observer cannot spoof an independent identity or independence class", async () => {
  const f = await fixture();
  await executeFixture(f, "lease-observer-spoof");
  await assert.rejects(
    () => f.runtime.causal_observation_record(CONTEXT, {
      obligation_id: f.obligation.obligation_id, source: "spoof", observer_identity: "independent-observer",
      independence: "INDEPENDENT_SYSTEM", evidence_digest: "e".repeat(64), confidence: 1, idempotency_key: "spoofed-observer",
    }),
    (error) => error.code === "CAUSAL_IDENTITY_MISMATCH",
  );
  const observation = await f.runtime.causal_observation_record(CONTEXT, {
    obligation_id: f.obligation.obligation_id, source: "executor", observer_identity: "owner-a",
    independence: "INDEPENDENT_SYSTEM", evidence_digest: "f".repeat(64), confidence: 1, idempotency_key: "spoofed-independence",
  });
  assert.equal(observation.independence, "EXECUTOR");
});

test("stale observations cannot be promoted by caller-supplied verdict or CAL", async () => {
  const f = await fixture();
  await executeFixture(f, "lease-stale-observation");
  const independentContext = {
    ...CONTEXT, actor_id: "freshness-observer",
    authority_scope: [...CONTEXT.authority_scope, "causal:evidence:independent"],
    provenance: { session_fingerprint: "freshness-session", observer_independence: "INDEPENDENT_SYSTEM" },
  };
  await f.runtime.causal_observation_record(independentContext, {
    obligation_id: f.obligation.obligation_id, source: "postgres-readback", observer_identity: "freshness-observer",
    independence: "INDEPENDENT_SYSTEM", evidence_digest: "1".repeat(64), confidence: 1,
    freshness_seconds: 300, idempotency_key: "fresh-observation",
  });
  f.setClock("2026-08-09T12:06:00.000Z");
  const reconciliation = await f.runtime.causal_reconcile(CONTEXT, {
    obligation_id: f.obligation.obligation_id, achieved_assurance_level: "CAL-4",
    verdict: "VERIFIED_FINAL", idempotency_key: "stale-reconcile",
  });
  assert.equal(reconciliation.verdict, "UNKNOWN");
  assert.equal(reconciliation.achieved_assurance_level, "CAL-0");
});

test("idempotency returns one event and changed payload conflicts", async () => {
  const f = await fixture();
  const input = {
    project_id: f.project.project_id, idempotency_key: "same-scope", resource_type: "documentation",
    canonical_identifier: "docs:adr", environment: "shared", ownership: {}, provenance: {},
  };
  const first = await f.runtime.project_scope_bind(CONTEXT, input);
  const second = await f.runtime.project_scope_bind(CONTEXT, input);
  assert.equal(second._event.event_id, first._event.event_id);
  await assert.rejects(
    () => f.runtime.project_scope_bind(CONTEXT, { ...input, canonical_identifier: "docs:different" }),
    (error) => error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("legacy Work binding requires exact state and never invents ambiguous causality", async () => {
  const f = await fixture();
  const legacyWorkId = "22222222-2222-4222-8222-222222222221";
  const otherTenantKey = `tenant-other\u0000${legacyWorkId}`;
  f.store.state.legacyWorks.set(`${CONTEXT.tenant_id}\u0000${legacyWorkId}`, {
    tenant_id: CONTEXT.tenant_id, work_id: legacyWorkId, project_uuid: null,
  });
  f.store.state.legacyWorks.set(otherTenantKey, {
    tenant_id: "tenant-other", work_id: legacyWorkId, project_uuid: "33333333-3333-4333-8333-333333333333",
  });
  await assert.rejects(
    () => f.runtime.work_bind_intent(CONTEXT, {
      project_id: f.project.project_id, work_id: legacyWorkId, intent_revision_id: f.revision.intent_revision_id,
      provenance: { source: "legacy-readback" }, idempotency_key: "legacy-no-base",
    }),
    (error) => error.code === "BASE_STATE_DIGEST_REQUIRED",
  );
  const bound = await f.runtime.work_bind_intent(CONTEXT, {
    project_id: f.project.project_id, work_id: legacyWorkId, intent_revision_id: f.revision.intent_revision_id,
    base_state_digest: f.snapshot.state_digest, provenance: { source: "legacy-readback" }, idempotency_key: "legacy-bound",
  });
  assert.equal(bound.legacy_binding.project_uuid, f.project.project_id);
  assert.equal(f.store.state.legacyWorks.get(otherTenantKey).project_uuid, "33333333-3333-4333-8333-333333333333");

  const ambiguousWorkId = "22222222-2222-4222-8222-222222222222";
  const unresolved = await f.runtime.work_bind_intent(CONTEXT, {
    project_id: f.project.project_id, work_id: ambiguousWorkId, intent_revision_id: f.revision.intent_revision_id,
    legacy_binding_state: "UNRESOLVED_LEGACY_BINDING", provenance: { ambiguity_reason: "two legacy candidates" },
    idempotency_key: "legacy-unresolved",
  });
  assert.equal(unresolved.base_state_digest, null);
  await assert.rejects(
    () => f.runtime.change_create(CONTEXT, {
      project_id: f.project.project_id, work_id: ambiguousWorkId, base_state_digest: f.snapshot.state_digest,
      reason: "must remain blocked", idempotency_key: "ambiguous-change",
    }),
    (error) => error.code === "UNRESOLVED_LEGACY_BINDING",
  );
});

test("change and obligation lifecycle cannot skip states and lease proof drives authorization", async () => {
  const f = await fixture();
  await assert.rejects(
    () => f.runtime.change_transition(CONTEXT, {
      change_id: f.change.change_id, target_state: "AUTHORIZED", lease_id: "forged",
      reason: "caller cannot authorize itself", idempotency_key: "self-authorize-change",
    }),
    (error) => error.code === "TRANSITION_ORIGIN_REQUIRED",
  );
  await assert.rejects(
    () => f.runtime.causal_obligation_transition(CONTEXT, {
      obligation_id: f.obligation.obligation_id, target_state: "AUTHORIZED", lease_id: "forged",
      reason: "caller cannot authorize itself", idempotency_key: "self-authorize-obligation",
    }),
    (error) => error.code === "TRANSITION_ORIGIN_REQUIRED",
  );
  await assert.rejects(
    () => f.runtime.change_transition(CONTEXT, {
      change_id: f.change.change_id, target_state: "EXECUTED", lease_id: "unbound",
      reason: "skip authorization", idempotency_key: "skip-change",
    }),
    (error) => error.code === "CHANGE_STATE_INVALID",
  );
  await assert.rejects(
    () => f.runtime.causal_obligation_transition(CONTEXT, {
      obligation_id: f.obligation.obligation_id, target_state: "EXECUTED", lease_id: "unbound",
      reason: "skip authorization", idempotency_key: "skip-obligation",
    }),
    (error) => error.code === "OBLIGATION_STATE_INVALID",
  );

  const unproven = createCausalContinuityRuntime({
    store: f.store, now: f.now, contextSigner: signer(),
    verifyActionLease: async (request) => ({ ...request, valid: true, readback_verified: true, active: true, expires_at: "2026-08-09T12:10:00.000Z" }),
  });
  await assert.rejects(
    () => unproven.causal_context_issue(CONTEXT, {
      project_id: f.project.project_id, project_state_digest: f.snapshot.state_digest, work_id: f.work.work_id,
      change_id: f.change.change_id, obligation_ids: [f.obligation.obligation_id], environment: "staging",
      lease_id: "unproven-authority", expires_at: "2026-08-09T12:05:00.000Z", idempotency_key: "unproven-context",
    }),
    (error) => error.code === "LEASE_AUTHORITY_UNPROVEN",
  );
  assert.equal(f.store.state.leases?.has(`${CONTEXT.tenant_id}\u0000unproven-authority`) || false, false);

  await executeFixture(f, "lease-lifecycle");
  assert.equal((await f.runtime.change_read(CONTEXT, { change_id: f.change.change_id })).state, "EXECUTED");
  assert.equal((await f.runtime.causal_obligation_read(CONTEXT, { obligation_id: f.obligation.obligation_id })).state, "EXECUTED");
  assert.equal([...f.store.state.changeTransitions.values()].filter((row) => row.change_id === f.change.change_id).length, 3);
  assert.equal([...f.store.state.obligationTransitions.values()].filter((row) => row.obligation_id === f.obligation.obligation_id).length, 3);
});

test("execution requires dedicated authority and a consumed bound causal context", async () => {
  const f = await fixture();
  const issued = await f.runtime.causal_context_issue(CONTEXT, {
    project_id: f.project.project_id, project_state_digest: f.snapshot.state_digest, work_id: f.work.work_id,
    change_id: f.change.change_id, obligation_ids: [f.obligation.obligation_id], environment: "staging",
    lease_id: "lease-unconsumed", expires_at: "2026-08-09T12:05:00.000Z", idempotency_key: "context-unconsumed",
  });
  await assert.rejects(
    () => f.runtime.change_transition(CONTEXT, {
      change_id: f.change.change_id, target_state: "EXECUTED", lease_id: "lease-unconsumed",
      context_digest: issued.envelope.context_digest, execution_evidence_digest: "a".repeat(64),
      reason: "context was not consumed", idempotency_key: "execute-unconsumed",
    }),
    (error) => error.code === "EXECUTION_AUTHORIZATION_REQUIRED",
  );
  await f.runtime.causal_context_validate(CONTEXT, { ...issued, expected_environment: "staging", consume: true });
  await assert.rejects(
    () => f.runtime.change_transition({ ...CONTEXT, authority_scope: ["causal:write"] }, {
      change_id: f.change.change_id, target_state: "EXECUTED", lease_id: "lease-unconsumed",
      context_digest: issued.envelope.context_digest, execution_evidence_digest: "a".repeat(64),
      reason: "missing execution scope", idempotency_key: "execute-no-authority",
    }),
    (error) => error.code === "AUTHORITY_SCOPE_VIOLATION",
  );
});

test("capsule and metrics expose bounded authoritative lifecycle support", async () => {
  const f = await fixture();
  await executeFixture(f, "lease-capsule");
  const key = (id) => `${CONTEXT.tenant_id}\u0000${id}`;
  f.store.state.artifacts.set(key("artifact-1"), {
    tenant_id: CONTEXT.tenant_id, artifact_id: "artifact-1", change_id: f.change.change_id, artifact_type: "commit", canonical_identifier: "git:abc",
  });
  f.store.state.conflicts.set(key("conflict-1"), {
    tenant_id: CONTEXT.tenant_id, conflict_id: "conflict-1", project_id: f.project.project_id, work_id: f.work.work_id,
    conflict_type: "BLOCKER", state: "OPEN", details: { reason: "independent verifier pending" },
  });
  const capsuleRow = await f.runtime.continuity_capsule_build(CONTEXT, {
    project_id: f.project.project_id, work_id: f.work.work_id, idempotency_key: "capsule-lifecycle",
  });
  assert.equal(capsuleRow.capsule.artifacts.length, 1);
  assert.equal(capsuleRow.capsule.known_conflicts.length, 1);
  assert.equal(capsuleRow.capsule.blocker.conflict_id, "conflict-1");
  assert.equal(capsuleRow.capsule.pending_temporal_checks.length, 1);
  const resumed = await f.runtime.continuity_capsule_resume(CONTEXT, { project_id: f.project.project_id, work_id: f.work.work_id });
  assert.equal(resumed.status, "RESUMED");
  const metrics = await f.runtime.causal_metrics_snapshot(CONTEXT, { project_id: f.project.project_id });
  assert.equal(metrics.metrics.changes_executed, 1);
  assert.equal(metrics.metrics.change_transitions, 3);
  assert.equal(metrics.metrics.obligation_transitions, 3);
  assert.equal(metrics.metrics.open_conflicts, 1);
  assert.equal(metrics.metrics.pending_temporal_checks, 1);
});

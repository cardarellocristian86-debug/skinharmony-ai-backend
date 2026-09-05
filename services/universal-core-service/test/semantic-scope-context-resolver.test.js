import assert from "node:assert/strict";
import test from "node:test";

import {
  createEntity360SemanticScopeContextResolver,
} from "../src/semanticScopeContextResolver.js";
import { entity360Digest } from "../src/entity360.js";

const TENANT = "codexai";
const WORK = "11111111-1111-4111-8111-111111111111";
const ENTITY = "entity-work-1";
const DIGEST = "a".repeat(64);
const POLICY_DIGEST = "b".repeat(64);
const AT = "2026-09-05T10:00:00.000Z";

function snapshot(overrides = {}) {
  return {
    schema_version: "entity_360_snapshot_v2",
    tenant_scope: TENANT,
    entity_id: ENTITY,
    entity_type: "work",
    snapshot_version: 3,
    deterministic_immutable_digest: DIGEST,
    project_work_linkage: { work_id: WORK },
    context_status: "READY",
    policy_version: "entity360-policy-v1",
    policy_digest: POLICY_DIGEST,
    adapter_registry_version: "entity_360_adapter_registry_v1",
    bitemporal: {
      as_of_valid_time: AT,
      as_of_knowledge_time: AT,
    },
    stale_sources: [],
    execution_authorized: false,
    ...overrides,
  };
}

function contextReceipt(current = snapshot(), overrides = {}, request = {}) {
  const action = request.action || { kind: "git.commit" };
  const phase = String(request.phase || "ISSUE").toUpperCase();
  const unsigned = {
    schema_version: "entity_360_core_context_receipt_v2",
    tenant_id: TENANT,
    work_id: WORK,
    entity_id: current.entity_id,
    snapshot_version: current.snapshot_version,
    snapshot_digest: current.deterministic_immutable_digest,
    policy_version: current.policy_version,
    policy_digest: current.policy_digest,
    enforcement_policy_version: "entity360-enforcement-v2",
    enforcement_policy_digest: "c".repeat(64),
    enforcement_authority_digest: "e".repeat(64),
    adapter_registry_version: current.adapter_registry_version,
    as_of_valid_time: current.bitemporal.as_of_valid_time,
    as_of_knowledge_time: current.bitemporal.as_of_knowledge_time,
    tenant_feature_revision: 1,
    action_digest: entity360Digest(action),
    phase,
    authority_owner: "UNIVERSAL_CORE",
    decision_authority: "UNIVERSAL_CORE",
    decision_receipt_schema_version: "host_native_action_ticket_v1",
    entity360_self_approval: false,
    provider_mutation: false,
    execution_authorized: false,
    ...overrides,
  };
  return { ...unsigned, receipt_digest: entity360Digest(unsigned) };
}

function runtime({ health = { ready: true, state: "ready", mode: "ENFORCE",
  enforcement_ready: true, authority_owner: "UNIVERSAL_CORE", core_decision_only: true,
  provider_mutation: false, entity360_self_approval: false },
  current = snapshot(), verification = { valid: true, snapshot_digest: DIGEST } } = {}) {
  const calls = [];
  return {
    calls,
    async health() { return health; },
    async resolveEnforcementContext(identity, input) {
      calls.push({ capability: "entity_360_enforcement_context", identity, input });
      return { snapshot: current, verification, receipt: contextReceipt(current, {}, input) };
    },
    async invoke(capability, identity, input) {
      calls.push({ capability, identity, input });
      if (capability === "entity_360_resolve") {
        return { status: "RESOLVED", entity_id: ENTITY };
      }
      if (capability === "entity_360_snapshot_latest") return current;
      if (capability === "entity_360_snapshot_verify") return verification;
      throw new Error("unexpected_capability");
    },
  };
}

test("resolver reads and independently verifies one Entity360 Work snapshot", async () => {
  const entity360 = runtime();
  const resolver = createEntity360SemanticScopeContextResolver({
    mode: "ENFORCE",
    getEntity360Runtime: () => entity360,
    now: () => Date.parse(AT),
  });
  const initialized = await resolver.initialize();
  assert.equal(initialized.ready, true);
  assert.equal(initialized.entity360_authority_mode, "CORE_ENFORCED_DATA_ONLY");
  const context = await resolver.resolve({ tenant_id: TENANT, work_id: WORK,
    action: { kind: "git.commit" }, phase: "ISSUE" });
  assert.equal(context.entity360_snapshot_ref, `entity360_snapshot:${DIGEST}`);
  assert.equal(context.context_status, "READY");
  assert.equal(context.stale, false);
  assert.equal(context.ambiguous, false);
  assert.equal(context.execution_authorized, false);
  assert.deepEqual(entity360.calls.map((call) => call.capability), [
    "entity_360_enforcement_context",
  ]);
  assert.equal(entity360.calls.every((call) =>
    call.identity.tenant_id === TENANT && call.identity.work_id === WORK), true);
});

test("resolver rejects unavailable runtime and forged cross-Work snapshot", async () => {
  const unavailable = createEntity360SemanticScopeContextResolver({
    mode: "ENFORCE",
    getEntity360Runtime: () => null,
  });
  await assert.rejects(unavailable.initialize(),
    /semantic_scope_context_resolver_not_ready/u);
  assert.deepEqual({ state: unavailable.health().state, ready: unavailable.health().ready,
    readiness_ready: unavailable.health().readiness_ready }, {
    state: "unavailable", ready: false, readiness_ready: false,
  });

  const forged = createEntity360SemanticScopeContextResolver({
    mode: "ENFORCE",
    getEntity360Runtime: () => runtime({ current: snapshot({
      project_work_linkage: { work_id: "22222222-2222-4222-8222-222222222222" },
    }) }),
  });
  await forged.initialize();
  await assert.rejects(forged.resolve({ tenant_id: TENANT, work_id: WORK,
    action: { kind: "git.commit" }, phase: "ISSUE" }),
    /semantic_scope_context_unavailable/u);
  assert.equal(forged.health().resolve_failures, 1);
});

test("ENFORCE marks old snapshots stale and rejects future or tampered receipts", async () => {
  const old = createEntity360SemanticScopeContextResolver({
    mode: "ENFORCE",
    getEntity360Runtime: () => runtime(),
    maxSnapshotAgeMs: 60_000,
    now: () => Date.parse(AT) + 60_001,
  });
  await old.initialize();
  const oldContext = await old.resolve({ tenant_id: TENANT, work_id: WORK,
    action: { kind: "git.commit" }, phase: "ISSUE" });
  assert.equal(oldContext.context_status, "READY");
  assert.equal(oldContext.stale, true);

  const futureSnapshot = snapshot({
    bitemporal: { as_of_valid_time: "2026-09-05T10:00:00.001Z",
      as_of_knowledge_time: "2026-09-05T10:00:00.001Z" },
  });
  const future = createEntity360SemanticScopeContextResolver({
    mode: "ENFORCE",
    getEntity360Runtime: () => runtime({ current: futureSnapshot }),
    now: () => Date.parse(AT),
  });
  await future.initialize();
  await assert.rejects(future.resolve({ tenant_id: TENANT, work_id: WORK,
    action: { kind: "git.commit" }, phase: "ISSUE" }),
  /semantic_scope_context_unavailable/u);

  const tamperedRuntime = runtime();
  tamperedRuntime.resolveEnforcementContext = async (identity, input) => ({
    snapshot: snapshot(),
    verification: { valid: true, snapshot_digest: DIGEST },
    receipt: { ...contextReceipt(), authority_owner: "ENTITY360" },
    identity,
    input,
  });
  const tampered = createEntity360SemanticScopeContextResolver({
    mode: "ENFORCE", getEntity360Runtime: () => tamperedRuntime,
  });
  await tampered.initialize();
  await assert.rejects(tampered.resolve({ tenant_id: TENANT, work_id: WORK,
    action: { kind: "git.commit" }, phase: "ISSUE" }),
  /semantic_scope_context_unavailable/u);
});

test("SHADOW reports dependency loss without becoming a readiness gate", async () => {
  const resolver = createEntity360SemanticScopeContextResolver({
    mode: "SHADOW",
    getEntity360Runtime: () => runtime({
      health: { ready: false, state: "initialization_failed", mode: "SHADOW" },
    }),
  });
  await assert.rejects(resolver.initialize(),
    /semantic_scope_context_resolver_not_ready/u);
  const health = resolver.health();
  assert.equal(health.state, "unavailable");
  assert.equal(health.ready, false);
  assert.equal(health.readiness_required, false);
  assert.equal(health.readiness_ready, true);
  assert.equal(health.error, "semantic_scope_context_resolver_unavailable");
  assert.equal(health.execution_authorized, false);
});

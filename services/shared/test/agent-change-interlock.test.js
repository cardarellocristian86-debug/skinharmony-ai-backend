import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_CHANGE_INTERLOCK_SCHEMA_VERSION,
  INTERLOCK_PLAN,
  buildChangeIntent,
  compareChangeIntents,
  proposeInterlockPlan,
  validateInterlockRevalidation,
} from "../agent-change-interlock.mjs";

const DIGEST = "a".repeat(64);
const base = (overrides = {}) => ({
  work_id: "11111111-1111-4111-8111-111111111111",
  project_id: "skinharmony-ai-backend",
  operation_class: "write",
  assets: [{ adapter: "github", kind: "file", reference: "cardarellocristian86-debug/skinharmony-ai-backend/services/core/app.js" }],
  expected_effect_digest: DIGEST,
  rollback_digest: "b".repeat(64),
  evidence_digest: "c".repeat(64),
  ...overrides,
});

test("Agent Change Interlock binds an immutable tenant-scoped canonical intent", () => {
  const intent = buildChangeIntent({ authoritative_tenant_id: "codexai", input: base() });
  assert.equal(intent.schema_version, AGENT_CHANGE_INTERLOCK_SCHEMA_VERSION);
  assert.equal(intent.tenant_id, "codexai");
  assert.equal(intent.execution_allowed, false);
  assert.match(intent.intent_digest, /^[a-f0-9]{64}$/);
  assert.equal(intent.public_assets[0].reference.includes("app.js"), false);
  assert.throws(() => buildChangeIntent({ authoritative_tenant_id: "codexai", input: base({ tenant_id: "other" }) }), /tenant_scope_violation/);
});

test("canonical equivalent parent and child assets conflict without an LLM decision", () => {
  const parent = buildChangeIntent({ authoritative_tenant_id: "codexai", input: base({ assets: [{ adapter: "github", kind: "file", reference: "cardarellocristian86-debug/skinharmony-ai-backend/services/core" }] }) });
  const child = buildChangeIntent({ authoritative_tenant_id: "codexai", input: base() });
  assert.equal(compareChangeIntents(parent, child).classification, "overlap");
  assert.equal(proposeInterlockPlan({ candidate: child, active_intents: [parent] }).plan, INTERLOCK_PLAN.EXCLUSIVE_LEASE_REQUIRED);
});

test("same physical asset conflicts across different projects in the same tenant", () => {
  const first = buildChangeIntent({ authoritative_tenant_id: "codexai", input: base({ project_id: "project-a" }) });
  const second = buildChangeIntent({ authoritative_tenant_id: "codexai", input: base({ project_id: "project-b" }) });
  assert.equal(compareChangeIntents(first, second).classification, "overlap");
  assert.equal(proposeInterlockPlan({ candidate: second, active_intents: [first] }).plan, INTERLOCK_PLAN.EXCLUSIVE_LEASE_REQUIRED);
});

test("disjoint assets are only advisory parallel-safe and never execution authorization", () => {
  const current = buildChangeIntent({ authoritative_tenant_id: "codexai", input: base() });
  const candidate = buildChangeIntent({ authoritative_tenant_id: "codexai", input: base({ assets: [{ adapter: "render", kind: "service", reference: "skinharmony-core-mcp-staging" }] }) });
  const plan = proposeInterlockPlan({ candidate, active_intents: [current] });
  assert.equal(plan.plan, INTERLOCK_PLAN.PARALLEL_SAFE);
  assert.equal(plan.execution_allowed, false);
});

test("revalidation rejects scope mutation and only returns a one-shot receipt requirement", () => {
  const intent = buildChangeIntent({ authoritative_tenant_id: "codexai", input: base() });
  const plan = proposeInterlockPlan({ candidate: intent });
  const revalidation = validateInterlockRevalidation({
    intent, plan, active_lease: { lease_id: "lease_1", intent_digest: intent.intent_digest, scope_digest: intent.scope_digest },
    core_decision_digest: DIGEST, current_state_digest: "d".repeat(64),
  });
  assert.equal(revalidation.execution_allowed, false);
  assert.throws(() => validateInterlockRevalidation({
    intent, plan: { ...plan, candidate_scope_digest: "e".repeat(64) }, active_lease: { lease_id: "lease_1", intent_digest: intent.intent_digest, scope_digest: intent.scope_digest },
    core_decision_digest: DIGEST, current_state_digest: "d".repeat(64),
  }), /scope_expansion_requires_new_intent/);
});

test("ambiguous, credential-bearing and non-canonical assets fail closed", () => {
  assert.throws(() => buildChangeIntent({ authoritative_tenant_id: "codexai", input: base({ assets: [{ adapter: "render", kind: "service", reference: "https://user:password=x@example" }] }) }), /asset_reference/);
  assert.throws(() => buildChangeIntent({ authoritative_tenant_id: "codexai", input: base({ assets: [{ adapter: "unknown", kind: "thing", reference: "asset" }] }) }), /asset_kind_invalid/);
  assert.throws(() => buildChangeIntent({ authoritative_tenant_id: "codexai", input: base({ assets: [{ adapter: "github", kind: "file", reference: "repo/a/./b" }] }) }), /asset_reference_not_canonical/);
});

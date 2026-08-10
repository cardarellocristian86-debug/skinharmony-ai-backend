import assert from "node:assert/strict";
import test from "node:test";
import { createCausalBranchEnforcer } from "../src/causalBranchEnforcement.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const now = () => new Date("2026-08-09T10:05:00.000Z");
function envelope(overrides = {}) {
  return {
    schema_version: "causal_context_envelope_v1", tenant_id: "tenant-a", project_id: projectId,
    project_state_digest: "a".repeat(64), genesis_intent_id: "22222222-2222-4222-8222-222222222222",
    intent_revision_id: "33333333-3333-4333-8333-333333333333", work_id: "44444444-4444-4444-8444-444444444444",
    change_id: "55555555-5555-4555-8555-555555555555", obligation_ids: ["66666666-6666-4666-8666-666666666666"],
    gallery_ticket_ids: [], actor_id: "agent-a", actor_role: "builder", environment: "staging",
    base_state_digest: "a".repeat(64), authority_scope: ["causal:read"], risk_budget: {}, inherited_constraints: [],
    issued_at: "2026-08-09T10:00:00.000Z", expires_at: "2026-08-09T10:10:00.000Z", single_use_nonce: "nonce",
    context_digest: "b".repeat(64), lease_id: "lease-a", event_ledger_sequence: 2, ...overrides,
  };
}
const contract = { context_schema_version: "causal_context_envelope_v1", allowed_environments: ["staging"], minimum_assurance_level: "CAL-1" };
const output = { tenant_id: "tenant-a", project_id: projectId, inherited_constraints: [], causal_assurance_level: "CAL-1", obligation_state: "OBSERVING" };
const receipt = { tenant_id: "tenant-a", agent_id: "agent-a", session_fingerprint: "session-a", actor_provenance: "presence-a", client_type: "codex" };

test("shadow records invalid or absent causal context without blocking legacy work", async () => {
  const enforce = createCausalBranchEnforcer({
    store: { async readFeatureFlag() { return { mode: "SHADOW", version: 1 }; } },
    runtime: { async causal_context_validate() { throw new Error("must not run"); } },
    resolveAgentContext: async () => receipt, now,
  });
  const result = await enforce({ tenant_id: "tenant-a", project_id: projectId, contract, output });
  assert.equal(result.allowed, true);
  assert.equal(result.shadow_would_allow, false);
  assert.equal(result.code, "CAUSAL_BRANCH_SHADOW_OBSERVED");
});

test("enforce-new-work blocks missing DTT receipt or Core envelope verification", async () => {
  const enforce = createCausalBranchEnforcer({
    store: { async readFeatureFlag() { return { mode: "ENFORCE_NEW_WORK", version: 2 }; } },
    runtime: { async causal_context_validate() { return { valid: true }; } },
    resolveAgentContext: async () => receipt, now,
  });
  const result = await enforce({ tenant_id: "tenant-a", project_id: projectId, context: envelope(), contract, output });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "CAUSAL_BRANCH_CONTEXT_BLOCKED");
});

test("enforced branch accepts only verified tenant/session-bound context", async () => {
  let actorSeen;
  const enforce = createCausalBranchEnforcer({
    store: { async readFeatureFlag() { return { mode: "ENFORCE_NEW_WORK", version: 2 }; } },
    runtime: { async causal_context_validate(actor) { actorSeen = actor; return { valid: true, context_digest: "b".repeat(64) }; } },
    resolveAgentContext: async (token, tenantId) => { assert.equal(token, "signed-dtt"); assert.equal(tenantId, "tenant-a"); return receipt; }, now,
  });
  const result = await enforce({
    tenant_id: "tenant-a", context: envelope(), signature: "hnc.signature", agent_context_token: "signed-dtt",
    authority_scope: ["core:read"], contract, output,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.authoritative_context.valid, true);
  assert.equal(actorSeen.actor_id, "agent-a");
  assert.equal(actorSeen.provenance.session_fingerprint, "session-a");
});

test("tenant mismatch in verified agent receipt fails closed under enforcement", async () => {
  const enforce = createCausalBranchEnforcer({
    store: { async readFeatureFlag() { return { mode: "ENFORCE_ALL_COMPATIBLE", version: 3 }; } },
    runtime: { async causal_context_validate() { throw new Error("must not run"); } },
    resolveAgentContext: async () => ({ ...receipt, tenant_id: "tenant-b" }), now,
  });
  const result = await enforce({ tenant_id: "tenant-a", context: envelope(), signature: "hnc.signature", agent_context_token: "signed-dtt", contract, output });
  assert.equal(result.allowed, false);
  assert.equal(result.authoritative_context.code, "AGENT_CONTEXT_INVALID");
});

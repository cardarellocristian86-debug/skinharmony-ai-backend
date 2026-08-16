import assert from "node:assert/strict";
import test from "node:test";

import {
  PRESENCE_RECOVERY_AUTHORITY,
  authorizePresenceRecovery,
} from "../src/presence-recovery.js";

const NOW = new Date("2026-08-16T12:05:00.000Z");

function context(overrides = {}) {
  return {
    envelope: {
      schema_version: "causal_context_envelope_v1",
      tenant_id: "tenant-a",
      project_id: "11111111-1111-4111-8111-111111111111",
      project_state_digest: "a".repeat(64),
      genesis_intent_id: "22222222-2222-4222-8222-222222222222",
      intent_revision_id: "33333333-3333-4333-8333-333333333333",
      work_id: "44444444-4444-4444-8444-444444444444",
      change_id: "55555555-5555-4555-8555-555555555555",
      obligation_ids: ["66666666-6666-4666-8666-666666666666"],
      gallery_ticket_ids: [],
      actor_id: "codex-recovery",
      actor_role: "coordinator",
      actor_provenance_digest: "b".repeat(64),
      environment: "production",
      base_state_digest: "c".repeat(64),
      authority_scope: [PRESENCE_RECOVERY_AUTHORITY],
      risk_budget: { max_presence_registrations: 1 },
      inherited_constraints: ["presence_only", "no_host_action", "no_publish", "no_deploy"],
      issued_at: "2026-08-16T12:00:00.000Z",
      expires_at: "2026-08-16T12:10:00.000Z",
      single_use_nonce: "opaque-recovery-nonce",
      lease_id: "presence-recovery-lease",
      event_ledger_sequence: 42,
      context_digest: "d".repeat(64),
      ...overrides,
    },
    signature: { key_id: "causal-context-v1", digest: "e".repeat(64) },
  };
}

const identity = { tenantId: "tenant-a" };

function validResult(recovery) {
  return {
    structuredContent: {
      result: {
        valid: true,
        consumed: true,
        context_digest: recovery.envelope.context_digest,
        project_id: recovery.envelope.project_id,
        work_id: recovery.envelope.work_id,
        change_id: recovery.envelope.change_id,
      },
    },
  };
}

test("consumed Genesis-bound context authorizes presence recovery only", async () => {
  const recovery = context();
  let request;
  const gate = await authorizePresenceRecovery({
    recoveryContext: recovery,
    identity,
    agentId: "codex-recovery",
    environment: "production",
    validateContext: async (input) => {
      request = input;
      return validResult(recovery);
    },
    now: () => NOW,
  });
  assert.equal(gate.allowed, true);
  assert.equal(gate.mediation, "consumed_causal_context");
  assert.deepEqual(request, {
    envelope: recovery.envelope,
    signature: recovery.signature,
    consume: true,
    expected_environment: "production",
    required_authority: PRESENCE_RECOVERY_AUTHORITY,
  });
});

test("recovery denies authority expansion, metadata, stale context, and unconsumed proof", async () => {
  const verify = async (input) => validResult({ envelope: input.envelope });
  await assert.rejects(authorizePresenceRecovery({
    recoveryContext: context({ authority_scope: [PRESENCE_RECOVERY_AUTHORITY, "git:push"] }),
    identity, agentId: "codex-recovery", environment: "production", validateContext: verify, now: () => NOW,
  }), /presence_recovery_authority_invalid/);
  await assert.rejects(authorizePresenceRecovery({
    recoveryContext: context(), identity, agentId: "codex-recovery", environment: "production",
    customMetadata: true, validateContext: verify, now: () => NOW,
  }), /presence_recovery_metadata_denied/);
  await assert.rejects(authorizePresenceRecovery({
    recoveryContext: context({ expires_at: "2026-08-16T12:04:59.000Z" }),
    identity, agentId: "codex-recovery", environment: "production", validateContext: verify, now: () => NOW,
  }), /presence_recovery_expired/);
  await assert.rejects(authorizePresenceRecovery({
    recoveryContext: context(), identity, agentId: "codex-recovery", environment: "production",
    validateContext: async () => ({ result: { valid: true, consumed: false } }), now: () => NOW,
  }), /presence_recovery_verification_failed/);
});

test("recovery is tenant, actor, environment, Genesis and constraint bound", async () => {
  const verify = async (input) => validResult({ envelope: input.envelope });
  for (const recovery of [
    context({ tenant_id: "tenant-b" }),
    context({ actor_id: "other-agent" }),
    context({ environment: "staging" }),
    context({ genesis_intent_id: null }),
    context({ inherited_constraints: ["presence_only", "no_host_action"] }),
    context({ gallery_ticket_ids: ["ticket-that-must-not-be-reused"] }),
  ]) {
    await assert.rejects(authorizePresenceRecovery({
      recoveryContext: recovery,
      identity,
      agentId: "codex-recovery",
      environment: "production",
      validateContext: verify,
      now: () => NOW,
    }));
  }
});

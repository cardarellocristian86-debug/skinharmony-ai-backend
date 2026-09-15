import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { createCoreTypedActionAuthorizer } from "../src/core-typed-action-authorizer.js";

const WORK_ID = "11111111-1111-4111-8111-111111111111";
const INTENT = "a".repeat(64);
const SESSION = "b".repeat(64);
const CONTINUATION = `nyc1_${"c".repeat(40)}`;
const REQUEST_DIGEST = "d".repeat(64);
const TICKET_ID = `hnt_${"e".repeat(32)}`;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function identity() {
  return { tenantId: "tenant-a", agentPresence: { session_fingerprint: SESSION } };
}

function nativeGate(overrides = {}) {
  const material = {
    schema_version: "precommit_ticket_gate_v2",
    gate_source: "native_closure_evaluation",
    tenant_id: "tenant-a",
    work_id: WORK_ID,
    action_kind: "git.commit",
    gate_kind: "ticket_acquisition",
    task_id: "22222222-2222-4222-8222-222222222222",
    plan_id: "33333333-3333-4333-8333-333333333333",
    evaluation_id: "44444444-4444-4444-8444-444444444444",
    evaluation_digest: "1".repeat(64),
    workspace_digest: "2".repeat(64),
    supersession_digest: "3".repeat(64),
    reconciliation_digest: "4".repeat(64),
    v2_scope_snapshot_digest: "5".repeat(64),
    v2_scope_tasks: [],
    legacy_evidence_ids: [],
    replacement_evidence_ids: [],
    fulfilled: false,
    ticket_id: null,
    fresh: true,
    drift_codes: [],
    ...overrides,
  };
  return { ...material, projection_digest: digest(material) };
}

function request(gate = nativeGate()) {
  return {
    work_id: WORK_ID,
    intent_anchor_digest: INTENT,
    delegation_id: "hnd_delegation",
    repository: "owner/repo",
    action: { kind: "git.commit", repository: "owner/repo", branch: "fix/test" },
    evidence_digest: gate.fulfilled
      ? digest({ ...gate, projection_digest: undefined, fulfilled: false, ticket_id: null })
      : gate.projection_digest,
    idempotency_key: "client-idempotency",
  };
}

function typedContext(gate, overrides = {}) {
  return {
    typed_record: {
      continuation_ref: CONTINUATION,
      request_digest: REQUEST_DIGEST,
      server_idempotency_key: "server-idempotency",
      issued_at: "2026-09-15T18:00:00.000Z",
      ...overrides,
    },
    work_binding: { directive_context: {
      available: true,
      work_id: WORK_ID,
      project_id: "project-a",
      work_revision: 1,
      intent_digest: INTENT,
      precommit_ticket_gate: gate,
      precommit_ticket_gate_applicable: gate.fulfilled !== true,
    } },
  };
}

function claim(binding, replay = false) {
  const material = { schema_version: "precommit_ticket_gate_claim_v1",
    claim_id: "claim-server-owned", ...binding, replay };
  return { ...material, claim_digest: digest(material) };
}

function ticketRecord(req, gate) {
  return {
    schema_version: "host_native_action_ticket_record_v1",
    tenant_id: "tenant-a",
    state: "issued",
    uses: 0,
    ticket: {
      schema_version: "host_native_action_ticket_v1",
      ticket_id: TICKET_ID,
      delegation_id: req.delegation_id,
      tenant_id: "tenant-a",
      work_id: WORK_ID,
      intent_anchor_digest: INTENT,
      repository: req.repository,
      host_kind: "codex_native",
      host_session_fingerprint: SESSION,
      action: req.action,
      evidence_digest: req.evidence_digest,
      issued_at: "2026-09-15T18:00:10.000Z",
      expires_at: "2026-09-15T18:05:10.000Z",
      max_uses: 1,
      provider_execution: false,
      host_policy_override: false,
      host_policy_must_allow: true,
      signature: `hnt_${"f".repeat(64)}`,
    },
  };
}

function authorizer({ core = {}, store = {} } = {}) {
  return createCoreTypedActionAuthorizer({
    coreHandlers: {
      host_native_action_authorize: async () => assert.fail("unexpected authorize"),
      host_native_action_read: async () => assert.fail("unexpected read"),
      host_native_delegation_read: async () => assert.fail("unexpected delegation read"),
      ...core,
    },
    workStore: {
      claimPrecommitTicketGate: async () => assert.fail("unexpected claim"),
      readPrecommitTicketGateClaimRecovery: async () => null,
      fulfillPrecommitTicketTask: async () => assert.fail("unexpected fulfill"),
      reconcilePrecommitTicketGateClaim: async () => assert.fail("unexpected reconcile"),
      abandonInactivePrecommitTicketGateClaim: async () => assert.fail("unexpected abandon"),
      ...store,
    },
    tenantAcl: () => ({ tenant_id: "tenant-a" }),
    hostKind: () => "codex_native",
    now: () => Date.parse("2026-09-15T18:00:20.000Z"),
  });
}

test("direct typed commit claims, authorizes, reads back and fulfills the exact gate", async () => {
  const gate = nativeGate();
  const req = request(gate);
  const record = ticketRecord(req, gate);
  const order = [];
  let claimReceipt;
  const runtime = authorizer({
    store: {
      claimPrecommitTicketGate: async (_acl, binding) => {
        order.push("claim");
        claimReceipt = claim(binding);
        return claimReceipt;
      },
      fulfillPrecommitTicketTask: async (_acl, input) => {
        order.push("fulfill");
        assert.equal(input.gate_projection_digest, gate.projection_digest);
        assert.deepEqual(input.gate_claim, claimReceipt);
      },
    },
    core: {
      host_native_action_authorize: async (input, caller, boundClaim) => {
        order.push("authorize");
        assert.equal(caller.nativePrecommitClaimIssuer, true);
        assert.deepEqual(boundClaim, claimReceipt);
        assert.equal(input.idempotency_key, "server-idempotency");
        return { structuredContent: { action_ticket: record } };
      },
      host_native_action_read: async () => {
        order.push("read");
        return { structuredContent: { ok: true, tenant_id: "tenant-a", action_ticket: record } };
      },
    },
  });
  const result = await runtime.authorize(req, identity(), typedContext(gate));
  assert.equal(result.structuredContent.action_ticket.ticket.ticket_id, TICKET_ID);
  assert.deepEqual(order, ["claim", "authorize", "read", "fulfill"]);
});

test("direct typed commit rejects repository drift before claiming", async () => {
  const gate = nativeGate();
  const req = request(gate);
  req.action.repository = "other/repo";
  let claims = 0;
  const runtime = authorizer({ store: {
    claimPrecommitTicketGate: async () => { claims += 1; },
  } });
  await assert.rejects(runtime.authorize(req, identity(), typedContext(gate)),
    /core_typed_request_action_repository_binding_mismatch/);
  assert.equal(claims, 0);
});

test("fulfilled typed gate requires recovery bound to the same opaque continuation", async () => {
  const original = nativeGate();
  const fulfilled = nativeGate({ fulfilled: true, ticket_id: TICKET_ID });
  const req = request(original);
  const binding = {
    work_id: WORK_ID,
    continuation_ref: `nyc1_${"9".repeat(40)}`,
    request_digest: REQUEST_DIGEST,
    delegation_id: req.delegation_id,
    action_digest: digest(req.action),
    gate_projection_digest: original.projection_digest,
    host_session_fingerprint: SESSION,
    idempotency_key: "server-idempotency",
  };
  const runtime = authorizer({ store: {
    readPrecommitTicketGateClaimRecovery: async () => ({
      schema_version: "precommit_ticket_gate_recovery_v1",
      recovery_source: "fulfillment",
      ticket_id: TICKET_ID,
      gate_claim: claim(binding, true),
    }),
  } });
  await assert.rejects(runtime.authorize(req, identity(), typedContext(fulfilled)),
    /nyra_continue_precommit_claim_recovery_invalid/);
});

test("fulfilled typed gate reads the exact recovered ticket without a second authorization", async () => {
  const original = nativeGate();
  const fulfilled = nativeGate({ fulfilled: true, ticket_id: TICKET_ID });
  const req = request(original);
  const record = ticketRecord(req, original);
  const binding = {
    work_id: WORK_ID,
    continuation_ref: CONTINUATION,
    request_digest: REQUEST_DIGEST,
    delegation_id: req.delegation_id,
    action_digest: digest(req.action),
    gate_projection_digest: original.projection_digest,
    host_session_fingerprint: SESSION,
    idempotency_key: "server-idempotency",
  };
  let reads = 0;
  const runtime = authorizer({
    store: {
      readPrecommitTicketGateClaimRecovery: async () => ({
        schema_version: "precommit_ticket_gate_recovery_v1",
        recovery_source: "fulfillment",
        ticket_id: TICKET_ID,
        gate_claim: claim(binding, true),
      }),
    },
    core: {
      host_native_action_read: async ({ ticket_id }) => {
        reads += 1;
        assert.equal(ticket_id, TICKET_ID);
        return { structuredContent: { ok: true, tenant_id: "tenant-a", action_ticket: record } };
      },
    },
  });
  const result = await runtime.authorize(req, identity(), typedContext(fulfilled));
  assert.equal(result.structuredContent.action_ticket.ticket.ticket_id, TICKET_ID);
  assert.equal(reads, 1);
});

test("reconciled claim rejects a different ticket returned by Core before fulfillment", async () => {
  const gate = nativeGate();
  const req = request(gate);
  let fulfilled = 0;
  const runtime = authorizer({
    store: {
      claimPrecommitTicketGate: async (_acl, binding) => claim(binding, true),
      readPrecommitTicketGateClaimRecovery: async (_acl, { gate_claim }) => ({
        schema_version: "precommit_ticket_gate_recovery_v1",
        recovery_source: "reconciliation",
        ticket_id: TICKET_ID,
        gate_claim,
      }),
      fulfillPrecommitTicketTask: async () => { fulfilled += 1; },
    },
    core: {
      host_native_action_authorize: async () => ({ structuredContent: { action_ticket: {
        ticket: { ticket_id: `hnt_${"8".repeat(32)}` },
      } } }),
    },
  });
  await assert.rejects(runtime.authorize(req, identity(), typedContext(gate)),
    /core_typed_request_precommit_claim_recovery_invalid/);
  assert.equal(fulfilled, 0);
});

test("expired delegation abandons a failed claim only with server-derived Core readback", async () => {
  const gate = nativeGate();
  const req = request(gate);
  let abandonment;
  const runtime = authorizer({
    store: {
      claimPrecommitTicketGate: async (_acl, binding) => claim(binding),
      reconcilePrecommitTicketGateClaim: async () => {},
      abandonInactivePrecommitTicketGateClaim: async (_acl, input) => { abandonment = input; },
    },
    core: {
      host_native_action_authorize: async () => { throw new Error("delegation_expired"); },
      host_native_delegation_read: async () => ({ structuredContent: {
        ok: true,
        tenant_id: "tenant-a",
        delegation: {
          delegation_id: req.delegation_id,
          effective_state: "expired",
          state: "issued",
          revoked_at: null,
          signature: "signed-delegation-proof",
          grant: { tenant_id: "tenant-a", work_id: WORK_ID,
            expires_at: "2026-09-15T17:00:00.000Z" },
        },
      } }),
    },
  });
  await assert.rejects(runtime.authorize(req, identity(), typedContext(gate)), /delegation_expired/);
  assert.equal(abandonment.server_owned, true);
  assert.equal(abandonment.core_delegation_readback.effective_state, "expired");
  assert.equal(abandonment.core_delegation_readback.authority, "universal_core");
  assert.match(abandonment.core_delegation_readback.readback_digest, /^[a-f0-9]{64}$/);
});

test("authorization failure records reconciliation and keeps an active delegation claim resumable", async () => {
  const gate = nativeGate();
  const req = request(gate);
  let reconciled;
  let abandoned = 0;
  const runtime = authorizer({
    store: {
      claimPrecommitTicketGate: async (_acl, binding) => claim(binding),
      reconcilePrecommitTicketGateClaim: async (_acl, input) => { reconciled = input; },
      abandonInactivePrecommitTicketGateClaim: async () => { abandoned += 1; },
    },
    core: {
      host_native_action_authorize: async () => { throw new Error("core_action_blocked"); },
      host_native_delegation_read: async () => ({ structuredContent: {
        ok: true,
        tenant_id: "tenant-a",
        delegation: {
          delegation_id: req.delegation_id,
          effective_state: "active",
          state: "active",
          revoked_at: null,
          signature: "signed-delegation-proof",
          grant: { tenant_id: "tenant-a", work_id: WORK_ID,
            expires_at: "2026-09-15T19:00:00.000Z" },
        },
      } }),
    },
  });
  await assert.rejects(runtime.authorize(req, identity(), typedContext(gate)), /core_action_blocked/);
  assert.equal(reconciled.stage, "before_ticket_locator");
  assert.equal(reconciled.ticket_id, null);
  assert.equal(abandoned, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";
import {
  GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER,
  verifyGenericWorkCoreJoinContext,
} from "../../shared/generic-work-core-join-context.js";
import { DTT_WORK_CONTEXT_HEADER } from "../../shared/dtt-work-context.js";

const tenantGatewayKey = "test-tenant-gateway-key-0123456789abcdef";
const tenantContextSigningSecret = "test-tenant-context-signing-secret-0123456789";
const workContextSigningSecret = "test-generic-join-work-signing-secret-0123456789";
const workId = "a9eed0d8-26ea-441a-a0f7-2640fb75261d";
const leaseId = "22222222-2222-4222-8222-222222222222";
const verifierMetadata = Object.freeze({
  key_id: "generic-work-core-join-api-key",
  public_key_fingerprint: "f".repeat(64),
});
const hash = (value) => value.repeat(64).slice(0, 64);

function agentPresence() {
  return {
    transport_bound: true,
    agent_id: "agent-generic-join",
    session_id: "session-generic-join",
    session_fingerprint: "a".repeat(24),
    host_transport_session_fingerprint: "b".repeat(24),
    signature: `ags_${"c".repeat(32)}`,
    opaque_agent_id: `ai_${"d".repeat(24)}`,
    actor_provenance: `ap_${"e".repeat(32)}`,
    client_type: "codex",
  };
}

function leaseBinding(presence = agentPresence(), overrides = {}) {
  return {
    schema_version: "generic_work_core_join_lease_binding_v1",
    tenant_id: "tenant-a",
    work_id: workId,
    lease_id: leaseId,
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    participant_expires_at: new Date(Date.now() + 120_000).toISOString(),
    session_id: presence.session_id,
    agent_id: presence.agent_id,
    client_type: presence.client_type,
    session_fingerprint: presence.session_fingerprint,
    host_transport_session_fingerprint: presence.host_transport_session_fingerprint,
    presence_signature: presence.signature,
    opaque_agent_id: presence.opaque_agent_id,
    actor_provenance: presence.actor_provenance,
    execution_authorized: false,
    ...overrides,
  };
}

const identity = { tenantId: "tenant-a", agentPresence: agentPresence() };
const config = {
  universalCoreUrl: "https://core.test",
  tenantGatewayKey,
  tenantContextSigningSecret,
  dttAgentIdentitySigningSecret: workContextSigningSecret,
};

function verdict(overrides = {}) {
  return {
    schema_version: "generic_work_core_join_v1",
    verdict_id: `gwcj_${"a".repeat(40)}`,
    tenant_id: "tenant-a",
    work_id: workId,
    adapter: "research",
    acceptance_criteria_digest: hash("a"), task_state_digest: hash("b"), evidence_digest: hash("c"),
    independent_verifier_receipt_digest: hash("d"), idempotency_digest: hash("e"), verdict_digest: hash("f"),
    issued_at: "2026-08-08T00:00:00.000Z", authority: "universal_core",
    decision: "GENERIC_WORK_CORE_JOIN_ELIGIBLE", execution_authorized: false,
    host_action_authorized: false, signature: "valid-signature-material", ...overrides,
  };
}

test("generic Core Join bridge uses the canonical route and sanitizes caller scope", async () => {
  const calls = [];
  const resolved = [];
  const handlers = createCoreHandlers(config, {
    genericWorkCoreJoinVerifierMetadata: verifierMetadata,
    resolveGenericWorkCoreJoinBinding: async (candidateIdentity, candidateWorkId) => {
      resolved.push({ candidateIdentity, candidateWorkId });
      return leaseBinding(candidateIdentity.agentPresence);
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, verdict: verdict() }), { status: 201, headers: { "content-type": "application/json" } });
    },
  });
  const result = await handlers.generic_work_core_join_issue({
    tenant_id: "other", authenticated_tenant_id: "other", secret: "never-forward", signing_secret: "never-forward",
    work_id: workId, adapter: "research",
  }, identity);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].candidateIdentity, identity);
  assert.equal(resolved[0].candidateWorkId, workId);
  assert.equal(new URL(calls[0].url).pathname, "/v1/work-continuity/generic-core-join");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${tenantGatewayKey}`);
  assert.equal(calls[0].init.headers["x-sh-tenant-id"], "tenant-a");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.tenant_id, undefined);
  assert.equal(body.authenticated_tenant_id, undefined);
  assert.equal(body.secret, undefined);
  assert.equal(body.signing_secret, undefined);
  assert.equal(body.work_id, workId);
  assert.equal(calls[0].init.headers[DTT_WORK_CONTEXT_HEADER], undefined);
  const binding = verifyGenericWorkCoreJoinContext({
    token: calls[0].init.headers[GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER],
    secret: workContextSigningSecret,
    expected_tenant_id: "tenant-a",
    expected_work_id: workId,
    method: "POST",
    path: "/v1/work-continuity/generic-core-join",
    body,
  });
  assert.equal(binding.purpose, "generic_work_core_join_issue");
  assert.deepEqual(binding.verifier, verifierMetadata);
  assert.equal(binding.execution_authorized, false);
  assert.equal(result.structuredContent.ok, true);
  assert.deepEqual(result.structuredContent.generic_core_join_verdict, verdict());
});

test("generic Core Join bridge fails closed on malformed or tenant-mismatched verdicts", async () => {
  const handlers = createCoreHandlers(config, {
    genericWorkCoreJoinVerifierMetadata: verifierMetadata,
    resolveGenericWorkCoreJoinBinding: async () => leaseBinding(),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, verdict: verdict({ tenant_id: "other" }) }), { status: 201, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(() => handlers.generic_work_core_join_issue({ work_id: workId, adapter: "research" }, identity), /generic_work_core_join_response_invalid/);
});

test("generic Core Join bridge denies missing binding, cross-Work lease, and unsigned presence", async () => {
  let verifierlessResolverCalls = 0;
  const noVerifier = createCoreHandlers(config, {
    resolveGenericWorkCoreJoinBinding: async () => {
      verifierlessResolverCalls += 1;
      return leaseBinding();
    },
    fetchImpl: async () => { throw new Error("must_not_fetch"); },
  });
  await assert.rejects(
    () => noVerifier.generic_work_core_join_issue({ work_id: workId, adapter: "research" }, identity),
    /generic_work_core_join_verifier_unavailable/,
  );
  assert.equal(verifierlessResolverCalls, 0);

  const noBinding = createCoreHandlers(config, {
    genericWorkCoreJoinVerifierMetadata: verifierMetadata,
    fetchImpl: async () => { throw new Error("must_not_fetch"); },
  });
  await assert.rejects(
    () => noBinding.generic_work_core_join_issue({ work_id: workId, adapter: "research" }, identity),
    /generic_work_core_join_work_binding_unavailable/,
  );

  const crossWork = createCoreHandlers(config, {
    genericWorkCoreJoinVerifierMetadata: verifierMetadata,
    resolveGenericWorkCoreJoinBinding: async () => leaseBinding(agentPresence(), {
      work_id: "33333333-3333-4333-8333-333333333333",
    }),
    fetchImpl: async () => { throw new Error("must_not_fetch"); },
  });
  await assert.rejects(
    () => crossWork.generic_work_core_join_issue({ work_id: workId, adapter: "research" }, identity),
    /generic_work_core_join_active_lease_required/,
  );

  const unsigned = createCoreHandlers(config, {
    genericWorkCoreJoinVerifierMetadata: verifierMetadata,
    resolveGenericWorkCoreJoinBinding: async () => leaseBinding(),
    fetchImpl: async () => { throw new Error("must_not_fetch"); },
  });
  await assert.rejects(
    () => unsigned.generic_work_core_join_issue(
      { work_id: workId, adapter: "research" },
      { tenantId: "tenant-a", agentPresence: { ...agentPresence(), transport_bound: false } },
    ),
    /generic_work_core_join_context_transport_binding_required/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER,
  GENERIC_WORK_CORE_JOIN_CONTEXT_PURPOSE,
  GENERIC_WORK_CORE_JOIN_CONTEXT_VERSION,
  canonicalGenericWorkCoreJoinContextBody,
  issueGenericWorkCoreJoinContext,
  verifyGenericWorkCoreJoinContext,
} from "../generic-work-core-join-context.js";
import { DTT_WORK_CONTEXT_HEADER, verifyDttWorkContext } from "../dtt-work-context.js";

const TENANT_ID = "tenant-generic-join";
const WORK_ID = "11111111-1111-8111-8111-111111111111";
const OTHER_WORK_ID = "22222222-2222-4222-8222-222222222222";
const LEASE_ID = "33333333-3333-4333-8333-333333333333";
const SECRET = "generic-work-core-join-context-test-secret-0001";
const NOW_MS = Date.parse("2030-01-01T00:00:00.000Z");
const PATH = "/v1/work-continuity/generic-core-join";
const VERIFIER = Object.freeze({
  key_id: "generic-work-core-join-test-key",
  public_key_fingerprint: "f".repeat(64),
});

function presence(overrides = {}) {
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
    ...overrides,
  };
}

function lease(agentPresence = presence(), overrides = {}) {
  return {
    schema_version: "generic_work_core_join_lease_binding_v1",
    tenant_id: TENANT_ID,
    work_id: WORK_ID,
    lease_id: LEASE_ID,
    expires_at: new Date(NOW_MS + 25_000).toISOString(),
    participant_expires_at: new Date(NOW_MS + 40_000).toISOString(),
    session_id: agentPresence.session_id,
    agent_id: agentPresence.agent_id,
    client_type: agentPresence.client_type,
    session_fingerprint: agentPresence.session_fingerprint,
    host_transport_session_fingerprint: agentPresence.host_transport_session_fingerprint,
    presence_signature: agentPresence.signature,
    opaque_agent_id: agentPresence.opaque_agent_id,
    actor_provenance: agentPresence.actor_provenance,
    execution_authorized: false,
    ...overrides,
  };
}

function issue({
  body = { work_id: WORK_ID, adapter: "research", nested: { z: 2, a: true } },
  agentPresence = presence(),
  leaseBinding,
  path = PATH,
} = {}) {
  return issueGenericWorkCoreJoinContext({
    secret: SECRET,
    tenant_id: TENANT_ID,
    work_id: WORK_ID,
    lease_binding: leaseBinding || lease(agentPresence),
    agent_presence: agentPresence,
    verifier: VERIFIER,
    method: "POST",
    path,
    body,
    now_ms: NOW_MS,
    ttl_ms: 300_000,
    random_bytes: () => Buffer.alloc(18, 7),
  });
}

test("Generic Work Core Join context has a distinct domain and exact request/lease binding", () => {
  const token = issue();
  const binding = verifyGenericWorkCoreJoinContext({
    token,
    secret: SECRET,
    expected_tenant_id: TENANT_ID,
    expected_work_id: WORK_ID,
    method: "post",
    path: PATH,
    body: { nested: { a: true, z: 2 }, adapter: "research", work_id: WORK_ID },
    now_ms: NOW_MS,
  });

  assert.equal(GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER, "x-sh-generic-work-core-join-context");
  assert.notEqual(GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER, DTT_WORK_CONTEXT_HEADER);
  assert.match(token, /^gwcjc_/);
  assert.equal(binding.schema_version, GENERIC_WORK_CORE_JOIN_CONTEXT_VERSION);
  assert.equal(binding.purpose, GENERIC_WORK_CORE_JOIN_CONTEXT_PURPOSE);
  assert.equal(binding.tenant_id, TENANT_ID);
  assert.equal(binding.work_id, WORK_ID);
  assert.equal(binding.lease.lease_id, LEASE_ID);
  assert.deepEqual(binding.verifier, VERIFIER);
  assert.equal(binding.expires_at_ms, NOW_MS + 25_000);
  assert.equal(binding.execution_authorized, false);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.principal), true);
  assert.equal(canonicalGenericWorkCoreJoinContextBody({ b: 2, a: { d: 4, c: 3 } }),
    '{"a":{"c":3,"d":4},"b":2}');
  assert.throws(() => verifyDttWorkContext({
    token,
    secret: SECRET,
    expected_tenant_id: TENANT_ID,
    method: "POST",
    path: PATH,
    body: {},
    now_ms: NOW_MS,
  }), /dtt_work_context_invalid/);
});

test("Generic Work Core Join context denies missing, tampered, expired, and cross-Work requests", () => {
  const body = { work_id: WORK_ID, adapter: "research", nested: { z: 2, a: true } };
  const token = issue({ body });
  const verification = {
    token,
    secret: SECRET,
    expected_tenant_id: TENANT_ID,
    expected_work_id: WORK_ID,
    method: "POST",
    path: PATH,
    body,
    now_ms: NOW_MS,
  };

  assert.throws(
    () => verifyGenericWorkCoreJoinContext({ ...verification, token: undefined }),
    /generic_work_core_join_context_token_invalid/,
  );
  assert.throws(
    () => issueGenericWorkCoreJoinContext({
      secret: SECRET,
      tenant_id: TENANT_ID,
      work_id: WORK_ID,
      lease_binding: lease(presence()),
      agent_presence: presence(),
      verifier: { ...VERIFIER, public_key_fingerprint: "not-a-fingerprint" },
      method: "POST",
      path: PATH,
      body: { work_id: WORK_ID },
      now_ms: NOW_MS,
    }),
    /generic_work_core_join_verifier_unavailable/,
  );
  assert.throws(
    () => verifyGenericWorkCoreJoinContext({ ...verification, path: "/v1/work/core-join-verdicts" }),
    /generic_work_core_join_context_request_mismatch/,
  );
  assert.throws(
    () => verifyGenericWorkCoreJoinContext({ ...verification, body: { ...body, adapter: "code" } }),
    /generic_work_core_join_context_request_mismatch/,
  );
  assert.throws(
    () => verifyGenericWorkCoreJoinContext({ ...verification, expected_work_id: OTHER_WORK_ID }),
    /generic_work_core_join_context_work_mismatch/,
  );
  assert.throws(
    () => verifyGenericWorkCoreJoinContext({ ...verification, expected_tenant_id: "tenant-other" }),
    /generic_work_core_join_context_tenant_mismatch/,
  );
  assert.throws(
    () => verifyGenericWorkCoreJoinContext({ ...verification, token: `${token.slice(0, -1)}0` }),
    /generic_work_core_join_context_signature_invalid/,
  );
  assert.throws(
    () => verifyGenericWorkCoreJoinContext({ ...verification, now_ms: NOW_MS + 25_000 }),
    /generic_work_core_join_context_expired/,
  );
});

test("Generic Work Core Join context requires an exact signed principal and active lease", () => {
  const agentPresence = presence();
  assert.throws(
    () => issue({ agentPresence: presence({ transport_bound: false }) }),
    /generic_work_core_join_context_transport_binding_required/,
  );
  assert.throws(
    () => issue({ leaseBinding: lease(agentPresence, { work_id: OTHER_WORK_ID }) }),
    /generic_work_core_join_context_lease_scope_mismatch/,
  );
  assert.throws(
    () => issue({ leaseBinding: lease(agentPresence, { session_id: "session-other" }) }),
    /generic_work_core_join_context_lease_principal_mismatch/,
  );
  assert.throws(
    () => issue({ leaseBinding: lease(agentPresence, { agent_id: "AGENT-GENERIC-JOIN" }) }),
    /generic_work_core_join_context_lease_principal_mismatch/,
  );
  assert.throws(
    () => issue({ leaseBinding: lease(agentPresence, { execution_authorized: true }) }),
    /generic_work_core_join_context_lease_invalid/,
  );
  assert.throws(
    () => issueGenericWorkCoreJoinContext({
      secret: SECRET,
      tenant_id: TENANT_ID,
      work_id: "not-a-uuid",
    }),
    /generic_work_core_join_context_work_id_invalid/,
  );
  assert.throws(
    () => issueGenericWorkCoreJoinContext({}),
    /generic_work_core_join_context_signing_unavailable/,
  );
});

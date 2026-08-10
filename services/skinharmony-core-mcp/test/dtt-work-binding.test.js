import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalDttWorkContextBody,
  issueDttWorkContext,
  verifyDttWorkContext,
} from "../../shared/dtt-work-context.js";
import {
  authorizeDttExactWorkRead,
  createWorkContinuityRuntime,
} from "../src/work-continuity-runtime.js";

const TENANT_ID = "tenant-a";
const WORK_ID = "11111111-1111-8111-8111-111111111111";
const LEASE_ID = "22222222-2222-4222-8222-222222222222";
const SECRET = "dtt-work-context-focused-test-secret-0001";
const NOW_MS = Date.parse("2030-01-01T00:00:00.000Z");

function agentPresence(overrides = {}) {
  return {
    transport_bound: true,
    agent_id: "agent-a",
    session_id: "session-a",
    session_fingerprint: "a".repeat(24),
    host_transport_session_fingerprint: "b".repeat(24),
    signature: `ags_${"c".repeat(32)}`,
    opaque_agent_id: `ai_${"d".repeat(24)}`,
    actor_provenance: `ap_${"e".repeat(32)}`,
    client_type: "codex",
    ...overrides,
  };
}

function leaseBinding(presence = agentPresence(), overrides = {}) {
  return {
    schema_version: "dtt_work_lease_binding_v1",
    tenant_id: TENANT_ID,
    work_id: WORK_ID,
    lease_id: LEASE_ID,
    expires_at: new Date(NOW_MS + 30_000).toISOString(),
    participant_expires_at: new Date(NOW_MS + 45_000).toISOString(),
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

function issue({ body = { z: 2, nested: { b: true, a: "bound" } }, presence = agentPresence(), lease } = {}) {
  return issueDttWorkContext({
    secret: SECRET,
    tenant_id: TENANT_ID,
    work_id: WORK_ID,
    lease_binding: lease || leaseBinding(presence),
    agent_presence: presence,
    method: "POST",
    path: "/v1/orchestration/dtt/plan",
    body,
    now_ms: NOW_MS,
    ttl_ms: 120_000,
    random_bytes: () => Buffer.alloc(18, 7),
  });
}

test("DTT Work context is canonical, request-bound, lease-capped, and deeply frozen", () => {
  const token = issue();
  const binding = verifyDttWorkContext({
    token,
    secret: SECRET,
    expected_tenant_id: TENANT_ID,
    expected_work_id: WORK_ID,
    method: "post",
    path: "/v1/orchestration/dtt/plan",
    body: { nested: { a: "bound", b: true }, z: 2 },
    now_ms: NOW_MS,
  });

  assert.equal(binding.schema_version, "dtt_work_context_v1");
  assert.equal(binding.work_id, WORK_ID);
  assert.equal(binding.lease.lease_id, LEASE_ID);
  assert.equal(binding.principal.presence_signature, agentPresence().signature);
  assert.equal(binding.principal.opaque_agent_id, agentPresence().opaque_agent_id);
  assert.equal(binding.expires_at_ms, NOW_MS + 30_000);
  assert.equal(binding.execution_authorized, false);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.principal), true);
  assert.equal(Object.isFrozen(binding.lease), true);
  assert.equal(canonicalDttWorkContextBody({ b: 2, a: { d: 4, c: 3 } }),
    '{"a":{"c":3,"d":4},"b":2}');
});

test("DTT Work context fails closed on request, signature, expiry, or principal drift", () => {
  const token = issue();
  const verification = {
    token,
    secret: SECRET,
    expected_tenant_id: TENANT_ID,
    expected_work_id: WORK_ID,
    method: "POST",
    path: "/v1/orchestration/dtt/plan",
    body: { z: 2, nested: { b: true, a: "bound" } },
    now_ms: NOW_MS,
  };

  assert.throws(
    () => verifyDttWorkContext({ ...verification, path: "/v1/orchestration/dtt/other" }),
    /dtt_work_context_request_mismatch/,
  );
  assert.throws(
    () => verifyDttWorkContext({ ...verification, body: { z: 3 } }),
    /dtt_work_context_request_mismatch/,
  );
  assert.throws(
    () => verifyDttWorkContext({ ...verification, token: `${token.slice(0, -1)}0` }),
    /dtt_work_context_signature_invalid/,
  );
  assert.throws(
    () => verifyDttWorkContext({ ...verification, now_ms: NOW_MS + 30_000 }),
    /dtt_work_context_expired/,
  );
  assert.throws(
    () => issue({ lease: leaseBinding(agentPresence(), { presence_signature: `ags_${"f".repeat(32)}` }) }),
    /dtt_work_context_lease_principal_mismatch/,
  );
  assert.throws(
    () => issue({ lease: leaseBinding(agentPresence(), { opaque_agent_id: `ai_${"f".repeat(24)}` }) }),
    /dtt_work_context_lease_principal_mismatch/,
  );
  assert.throws(
    () => issueDttWorkContext({}),
    /dtt_work_context_signing_unavailable/,
  );
});

test("MCP resolves a DTT lease only for the exact authenticated participant transport", async () => {
  const presence = agentPresence();
  const queryCalls = [];
  const pool = {
    async query(sql, params = []) {
      if (/CREATE TABLE IF NOT EXISTS core_continuity_works/.test(sql)) return { rows: [] };
      queryCalls.push({ sql, params });
      if (/JOIN core_continuity_leases l/.test(sql)) {
        return {
          rows: [{
            session_id: presence.session_id,
            agent_id: presence.agent_id,
            client_type: presence.client_type,
            participant_expires_at: new Date(NOW_MS + 45_000),
            transport_session_fingerprint: presence.host_transport_session_fingerprint,
            lease_id: LEASE_ID,
            lease_expires_at: new Date(NOW_MS + 30_000),
          }],
        };
      }
      throw new Error("unexpected_query");
    },
    async end() {},
  };
  const runtime = createWorkContinuityRuntime({}, {
    pool,
    now: () => new Date(NOW_MS),
  });
  const binding = await runtime.resolveDttWorkLeaseBinding({
    tenantId: TENANT_ID,
    subject: "owner-a",
    agentPresence: presence,
  }, { work_id: WORK_ID });

  assert.equal(queryCalls.length, 1);
  assert.match(queryCalls[0].sql, /p\.actor_subject=\$4/);
  assert.match(queryCalls[0].sql, /p\.transport_session_fingerprint=\$7/);
  assert.match(queryCalls[0].sql, /p\.status='active' AND p\.expires_at>now\(\)/);
  assert.match(queryCalls[0].sql, /l\.status='active' AND l\.expires_at>now\(\)/);
  assert.deepEqual(queryCalls[0].params, [
    TENANT_ID,
    WORK_ID,
    presence.session_id,
    "owner-a",
    presence.agent_id,
    presence.client_type,
    presence.host_transport_session_fingerprint,
  ]);
  assert.equal(binding.schema_version, "dtt_work_lease_binding_v1");
  assert.equal(binding.presence_signature, presence.signature);
  assert.equal(binding.opaque_agent_id, presence.opaque_agent_id);
  assert.equal(binding.execution_authorized, false);
  assert.equal(Object.isFrozen(binding), true);
});

test("MCP DTT ACL authorizes the exact Work and masks absence or denial", async () => {
  const aclIdentity = {
    tenantId: TENANT_ID,
    subject: "owner-a",
    tenant_work_acl: { server_derived: true, tenant_id: TENANT_ID, user_id: "owner-a" },
  };
  const calls = [];
  const authorized = await authorizeDttExactWorkRead({
    store: {
      async readWork(identity, input) {
        calls.push({ identity, input });
        return {
          schema_version: "work_continuity_v2",
          work: { tenant_id: TENANT_ID, work_id: WORK_ID },
        };
      },
    },
    identity: aclIdentity,
    tenant_id: TENANT_ID,
    work_id: WORK_ID,
  });
  assert.deepEqual(calls, [{ identity: aclIdentity, input: { work_id: WORK_ID } }]);
  assert.deepEqual(authorized, { tenant_id: TENANT_ID, work_id: WORK_ID });
  assert.equal(Object.isFrozen(authorized), true);

  for (const reason of ["work_acl_denied", "tenant_work_not_found"]) {
    await assert.rejects(
      authorizeDttExactWorkRead({
        store: { async readWork() { throw new Error(reason); } },
        identity: aclIdentity,
        tenant_id: TENANT_ID,
        work_id: WORK_ID,
      }),
      (error) => error.code === "dtt_work_acl_denied" && error.message === "dtt_work_acl_denied",
    );
  }
  await assert.rejects(
    authorizeDttExactWorkRead({
      store: { async readWork() {
        return {
          schema_version: "work_continuity_v2",
          work: { tenant_id: TENANT_ID, work_id: LEASE_ID },
        };
      } },
      identity: aclIdentity,
      tenant_id: TENANT_ID,
      work_id: WORK_ID,
    }),
    /dtt_work_acl_denied/,
  );
  await assert.rejects(
    authorizeDttExactWorkRead({
      store: { async readWork() { throw new Error("database_connection_lost"); } },
      identity: aclIdentity,
      tenant_id: TENANT_ID,
      work_id: WORK_ID,
    }),
    /dtt_work_binding_unavailable/,
  );
});

test("MCP DTT lease resolution rejects missing leases and unsigned transport presence", async () => {
  const emptyPool = {
    async query(sql) {
      if (/CREATE TABLE IF NOT EXISTS core_continuity_works/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    async end() {},
  };
  const runtime = createWorkContinuityRuntime({}, {
    pool: emptyPool,
    now: () => new Date(NOW_MS),
  });
  const identity = {
    tenantId: TENANT_ID,
    subject: "owner-a",
    agentPresence: agentPresence(),
  };

  await assert.rejects(
    runtime.resolveDttWorkLeaseBinding(identity, { work_id: WORK_ID }),
    /dtt_work_active_lease_required/,
  );
  await assert.rejects(
    runtime.resolveDttWorkLeaseBinding({
      ...identity,
      agentPresence: agentPresence({ transport_bound: false }),
    }, { work_id: WORK_ID }),
    /gallery_signed_presence_required/,
  );
});

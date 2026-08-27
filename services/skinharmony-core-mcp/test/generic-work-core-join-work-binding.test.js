import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeGenericWorkCoreJoinExactWorkRead,
  createWorkContinuityRuntime,
} from "../src/work-continuity-runtime.js";

const TENANT_ID = "tenant-generic-join";
const WORK_ID = "11111111-1111-8111-8111-111111111111";
const OTHER_WORK_ID = "22222222-2222-4222-8222-222222222222";
const LEASE_ID = "33333333-3333-4333-8333-333333333333";
const NOW_MS = Date.parse("2030-01-01T00:00:00.000Z");

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

function identity(agentPresence = presence()) {
  return {
    tenantId: TENANT_ID,
    subject: "owner-generic-join",
    agentPresence,
  };
}

test("Generic Core Join exact V2 ACL masks denial and infrastructure failures", async () => {
  const aclIdentity = {
    ...identity(),
    tenant_work_acl: {
      server_derived: true,
      tenant_id: TENANT_ID,
      user_id: "owner-generic-join",
    },
  };
  const calls = [];
  const authorized = await authorizeGenericWorkCoreJoinExactWorkRead({
    store: {
      async readWork(candidateIdentity, input) {
        calls.push({ candidateIdentity, input });
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
  assert.deepEqual(calls, [{ candidateIdentity: aclIdentity, input: { work_id: WORK_ID } }]);
  assert.deepEqual(authorized, { tenant_id: TENANT_ID, work_id: WORK_ID });
  assert.equal(Object.isFrozen(authorized), true);

  await assert.rejects(
    authorizeGenericWorkCoreJoinExactWorkRead({
      store: { async readWork() {
        return {
          schema_version: "work_continuity_v2",
          work: { tenant_id: TENANT_ID, work_id: OTHER_WORK_ID },
        };
      } },
      identity: aclIdentity,
      tenant_id: TENANT_ID,
      work_id: WORK_ID,
    }),
    /generic_work_core_join_work_acl_denied/,
  );
  await assert.rejects(
    authorizeGenericWorkCoreJoinExactWorkRead({
      store: { async readWork() { throw new Error("work_acl_denied"); } },
      identity: aclIdentity,
      tenant_id: TENANT_ID,
      work_id: WORK_ID,
    }),
    /generic_work_core_join_work_acl_denied/,
  );
  await assert.rejects(
    authorizeGenericWorkCoreJoinExactWorkRead({
      store: { async readWork() { throw new Error("postgres_unavailable"); } },
      identity: aclIdentity,
      tenant_id: TENANT_ID,
      work_id: WORK_ID,
    }),
    /generic_work_core_join_work_binding_unavailable/,
  );
});

test("Generic Core Join runtime binds the exact signed participant and active lease", async () => {
  const agentPresence = presence();
  const queryCalls = [];
  const pool = {
    async query(sql, params = []) {
      if (/CREATE TABLE IF NOT EXISTS core_continuity_works/.test(sql)) return { rows: [] };
      queryCalls.push({ sql, params });
      if (/JOIN core_continuity_leases l/.test(sql)) {
        return {
          rows: [{
            session_id: agentPresence.session_id,
            agent_id: agentPresence.agent_id,
            client_type: agentPresence.client_type,
            participant_expires_at: new Date(NOW_MS + 45_000),
            transport_session_fingerprint: agentPresence.host_transport_session_fingerprint,
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
  const binding = await runtime.resolveGenericWorkCoreJoinLeaseBinding(
    identity(agentPresence),
    { work_id: WORK_ID },
  );

  assert.equal(queryCalls.length, 1);
  assert.match(queryCalls[0].sql, /p\.actor_subject=\$4/);
  assert.match(queryCalls[0].sql, /p\.transport_session_fingerprint=\$7/);
  assert.match(queryCalls[0].sql, /p\.status='active' AND p\.expires_at>now\(\)/);
  assert.match(queryCalls[0].sql, /l\.status='active' AND l\.expires_at>now\(\)/);
  assert.deepEqual(queryCalls[0].params, [
    TENANT_ID,
    WORK_ID,
    agentPresence.session_id,
    "owner-generic-join",
    agentPresence.agent_id,
    agentPresence.client_type,
    agentPresence.host_transport_session_fingerprint,
    null,
    null,
    null,
  ]);
  assert.equal(binding.schema_version, "generic_work_core_join_lease_binding_v1");
  assert.equal(binding.tenant_id, TENANT_ID);
  assert.equal(binding.work_id, WORK_ID);
  assert.equal(binding.lease_id, LEASE_ID);
  assert.equal(binding.presence_signature, agentPresence.signature);
  assert.equal(binding.execution_authorized, false);
  assert.equal(Object.isFrozen(binding), true);
});

test("Generic Core Join runtime denies missing leases and unsigned participants", async () => {
  const pool = {
    async query(sql) {
      if (/CREATE TABLE IF NOT EXISTS core_continuity_works/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    async end() {},
  };
  const runtime = createWorkContinuityRuntime({}, {
    pool,
    now: () => new Date(NOW_MS),
  });

  await assert.rejects(
    runtime.resolveGenericWorkCoreJoinLeaseBinding(identity(), { work_id: WORK_ID }),
    /generic_work_core_join_active_lease_required/,
  );
  await assert.rejects(
    runtime.resolveGenericWorkCoreJoinLeaseBinding(
      identity(presence({ transport_bound: false })),
      { work_id: WORK_ID },
    ),
    /generic_work_core_join_signed_presence_required/,
  );
});

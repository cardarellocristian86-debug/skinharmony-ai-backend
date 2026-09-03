import assert from "node:assert/strict";
import test from "node:test";
import { ensureNyraReadBinding } from "../src/nyra-read-binding.js";

const WORK_ID = "91e82640-9edc-5424-a3e8-eb7853b0d8dd";
const identity = {
  tenantId: "tenant-a",
  agentPresence: {
    transport_bound: true,
    session_id: "chat-session-a",
    agent_id: "chatgpt-a",
    client_type: "chatgpt",
    session_fingerprint: "a".repeat(64),
    host_transport_session_fingerprint: "b".repeat(24),
    signature: `ags_${"c".repeat(32)}`,
  },
};

function lease(overrides = {}) {
  return {
    work_id: WORK_ID,
    lease_id: "11111111-1111-4111-8111-111111111111",
    expires_at: "2026-08-26T23:00:00.000Z",
    participant_expires_at: "2026-08-26T23:00:00.000Z",
    execution_authorized: false,
    ...overrides,
  };
}

test("a missing or ambiguous Work never creates a participant or lease", async () => {
  let calls = 0;
  const result = await ensureNyraReadBinding({
    runtime: new Proxy({}, { get() { calls += 1; } }),
    identity,
    continuity: { work_id: null, state: "work_selection_required" },
  });
  assert.equal(result.state, "work_selection_required");
  assert.equal(result.execution_authorized, false);
  assert.equal(calls, 0);
});

test("an active exact binding is reused without coordination writes", async () => {
  const calls = [];
  const result = await ensureNyraReadBinding({
    runtime: {
      resolveDttWorkLeaseBinding: async (_identity, args) => (
        calls.push(["resolve", args]), lease()
      ),
      attestNyraReadLease: async () => calls.push("attest"),
      rotateNyraReadParticipant: async () => calls.push("rotate"),
      join: async () => calls.push("join"),
      acquireLease: async () => calls.push("acquire"),
    },
    authorizeRead: async (_identity, workId) => calls.push(`authorize:${workId}`),
    identity,
    continuity: { work_id: WORK_ID },
    now: () => Date.parse("2026-08-26T21:00:00.000Z"),
  });
  assert.equal(result.state, "active");
  assert.equal(result.execution_authorized, false);
  assert.equal(result.external_action_authorized, false);
  assert.equal(calls[0], `authorize:${WORK_ID}`);
  assert.equal(calls[1][0], "resolve");
  assert.equal(calls[1][1].required_lease_purpose,
    "Nyra governed read-only Work context");
  assert.deepEqual(calls[1][1].required_lease_surface.kind, "component");
  assert.match(calls[1][1].required_lease_surface.value, /^nyra\/read\/[a-f0-9]{64}$/);
  assert.equal(calls[1][1].require_server_owned_read_binding, true);
  assert.equal(calls.length, 2);
});

test("preflight creates one server-derived read-only binding for an exact Work", async () => {
  const calls = [];
  let resolved = false;
  const runtime = {
    resolveDttWorkLeaseBinding: async () => {
      calls.push("resolve");
      if (!resolved) {
        const error = new Error("dtt_work_active_lease_required");
        error.code = "dtt_work_active_lease_required";
        throw error;
      }
      return lease();
    },
    rotateNyraReadParticipant: async (_identity, args) => {
      calls.push(["rotate", args]);
      return { state: "missing_or_expired" };
    },
    join: async (_identity, args) => {
      calls.push(["join", args]);
      return { participant: { session_id: args.session_id } };
    },
    acquireLease: async (_identity, args) => {
      calls.push(["acquire", args]);
      resolved = true;
      return { acquired: true, lease: { lease_id: lease().lease_id } };
    },
    attestNyraReadLease: async (_identity, args) => calls.push(["attest", args]),
  };
  const result = await ensureNyraReadBinding({
    runtime,
    authorizeRead: async (_identity, workId) => calls.push(["authorize", workId]),
    identity,
    continuity: { work_id: WORK_ID },
    now: () => Date.parse("2026-08-26T21:00:00.000Z"),
  });
  assert.equal(result.state, "created");
  assert.equal(result.execution_authorized, false);
  const join = calls.find((call) => Array.isArray(call) && call[0] === "join")[1];
  const acquire = calls.find((call) => Array.isArray(call) && call[0] === "acquire")[1];
  const attest = calls.find((call) => Array.isArray(call) && call[0] === "attest")[1];
  assert.equal(join.metadata.mode, "read_only");
  assert.equal(join.metadata.logical_session_fingerprint,
    identity.agentPresence.session_fingerprint);
  assert.equal(join.metadata.execution_authorized, false);
  assert.equal(acquire.purpose, "Nyra governed read-only Work context");
  assert.deepEqual(acquire.surfaces.map(({ kind }) => kind), ["component"]);
  assert.match(acquire.surfaces[0].value, /^nyra\/read\/[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(acquire, "authority_scope"), false);
  assert.equal(Object.hasOwn(acquire, "owner_confirmed"), false);
  assert.equal(attest.lease_id, lease().lease_id);
  assert.equal(attest.required_lease_purpose, "Nyra governed read-only Work context");
  assert.deepEqual(attest.required_lease_surface, acquire.surfaces[0]);
});

test("a near-expiry read binding renews participant and lease without a new join", async () => {
  const calls = [];
  let resolved = 0;
  const result = await ensureNyraReadBinding({
    runtime: {
      resolveDttWorkLeaseBinding: async () => {
        resolved += 1;
        return resolved === 1
          ? lease({
            expires_at: "2026-08-26T21:02:00.000Z",
            participant_expires_at: "2026-08-26T21:02:00.000Z",
          })
          : lease();
      },
      rotateNyraReadParticipant: async () => calls.push("rotate"),
      join: async () => calls.push("join"),
      acquireLease: async () => calls.push("acquire"),
      attestNyraReadLease: async () => calls.push("attest"),
      heartbeat: async (_identity, args) => calls.push(["heartbeat", args]),
      renewLease: async (_identity, args) => calls.push(["renew", args]),
    },
    identity,
    continuity: { work_id: WORK_ID },
    now: () => Date.parse("2026-08-26T21:00:00.000Z"),
  });
  assert.equal(result.state, "renewed");
  assert.equal(calls.some((call) => call === "join" || call === "acquire"), false);
  assert.equal(calls[0][0], "heartbeat");
  assert.equal(calls[1][0], "renew");
  assert.equal(calls[1][1].lease_id, lease().lease_id);
});

test("an unrelated operational lease is never renewed as Nyra's read lease", async () => {
  const calls = [];
  let resolved = false;
  const result = await ensureNyraReadBinding({
    runtime: {
      resolveDttWorkLeaseBinding: async (_identity, args) => {
        calls.push(["resolve", args]);
        if (!resolved) {
          const error = new Error("dtt_work_active_lease_required");
          error.code = "dtt_work_active_lease_required";
          throw error;
        }
        return lease();
      },
      rotateNyraReadParticipant: async () => {
        calls.push("rotate");
        return { state: "active" };
      },
      join: async () => calls.push("join"),
      heartbeat: async () => calls.push("heartbeat"),
      renewLease: async () => calls.push("renew"),
      acquireLease: async (_identity, args) => {
        calls.push(["acquire", args]);
        resolved = true;
        return { acquired: true, lease: { lease_id: lease().lease_id } };
      },
      attestNyraReadLease: async () => calls.push("attest"),
    },
    identity,
    continuity: { work_id: WORK_ID },
    now: () => Date.parse("2026-08-26T21:00:00.000Z"),
  });
  assert.equal(result.state, "created");
  assert.equal(calls.includes("heartbeat"), false);
  assert.equal(calls.includes("renew"), false);
  assert.equal(calls.includes("join"), false);
  const acquire = calls.find((call) => Array.isArray(call) && call[0] === "acquire")[1];
  assert.equal(acquire.purpose, "Nyra governed read-only Work context");
  assert.equal(acquire.surfaces.length, 1);
});

test("a verified transport rotation expires stale leases before creating a new read lease", async () => {
  const calls = [];
  let resolved = false;
  const result = await ensureNyraReadBinding({
    runtime: {
      resolveDttWorkLeaseBinding: async () => {
        calls.push("resolve");
        if (!resolved) {
          const error = new Error("dtt_work_active_lease_required");
          error.code = "dtt_work_active_lease_required";
          throw error;
        }
        return lease();
      },
      rotateNyraReadParticipant: async (_identity, args) => {
        calls.push(["rotate", args]);
        return { state: "rotated", expired_lease_count: 2 };
      },
      join: async () => calls.push("join"),
      acquireLease: async () => {
        calls.push("acquire");
        resolved = true;
        return { acquired: true, lease: { lease_id: lease().lease_id } };
      },
      attestNyraReadLease: async () => calls.push("attest"),
    },
    identity,
    continuity: { work_id: WORK_ID },
    now: () => Date.parse("2026-08-26T21:00:00.000Z"),
  });
  assert.equal(result.state, "created");
  assert.equal(calls.includes("join"), false);
  assert.equal(calls[1][0], "rotate");
  assert.equal(calls[1][1].session_id, identity.agentPresence.session_id);
  assert.equal(calls[1][1].agent_id, identity.agentPresence.agent_id);
  assert.equal(calls[1][1].client_type, identity.agentPresence.client_type);
  assert.match(calls[1][1].idempotency_key, /^nyra_read_transport_[a-f0-9]{48}$/);
  assert.equal(calls[2], "acquire");
});

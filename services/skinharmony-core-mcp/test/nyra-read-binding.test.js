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
      resolveDttWorkLeaseBinding: async () => (calls.push("resolve"), lease()),
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
  assert.deepEqual(calls, [`authorize:${WORK_ID}`, "resolve"]);
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
    join: async (_identity, args) => {
      calls.push(["join", args]);
      return { participant: { session_id: args.session_id } };
    },
    acquireLease: async (_identity, args) => {
      calls.push(["acquire", args]);
      resolved = true;
      return { acquired: true, lease: { lease_id: lease().lease_id } };
    },
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
  assert.equal(join.metadata.mode, "read_only");
  assert.equal(join.metadata.execution_authorized, false);
  assert.equal(acquire.purpose, "Nyra governed read-only Work context");
  assert.deepEqual(acquire.surfaces.map(({ kind }) => kind), ["component"]);
  assert.match(acquire.surfaces[0].value, /^nyra\/read\/[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(acquire, "authority_scope"), false);
  assert.equal(Object.hasOwn(acquire, "owner_confirmed"), false);
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
      join: async () => calls.push("join"),
      acquireLease: async () => calls.push("acquire"),
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

import assert from "node:assert/strict";
import test from "node:test";

import { createGenericWorkCoreJoinMcpCoordinator } from "../src/work-continuity-v2-store.js";

const WORK_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST = Object.freeze({
  tenant_id: "tenant-a",
  work_id: WORK_ID,
  adapter: "research",
  idempotency_digest: "a".repeat(64),
});
const METADATA = Object.freeze({
  key_id: "core-key-20260810",
  public_key_fingerprint: "b".repeat(64),
});

function fakeStore({ metadata = METADATA } = {}) {
  const calls = [];
  return {
    calls,
    coreJoinVerifierMetadata: metadata,
    async buildGenericCoreJoinRequest(_identity, args) {
      calls.push(["build", args]);
      return { ...REQUEST };
    },
    verifyCoreJoinVerdict(verdict, expected) {
      calls.push(["verify", verdict, expected]);
      return true;
    },
    async persistCoreJoin(identity, input) {
      calls.push(["persist", identity, input]);
      return { persisted: true };
    },
  };
}

test("Generic Join coordinator never calls Core while disabled, initializing, or verifierless", async () => {
  for (const scenario of [
    { enabled: false, readiness: { initialized: true }, expected: "generic_work_core_join_disabled" },
    { enabled: true, readiness: { initialized: false }, expected: "generic_work_core_join_store_initializing" },
    { enabled: true, readiness: { initialized: true }, metadata: null, expected: "generic_work_core_join_verifier_unavailable" },
  ]) {
    let outboundCalls = 0;
    const store = fakeStore({ metadata: scenario.metadata === undefined ? METADATA : scenario.metadata });
    const coordinator = createGenericWorkCoreJoinMcpCoordinator({
      enabled: scenario.enabled,
      store,
      readiness: scenario.readiness,
      issueCore: async () => {
        outboundCalls += 1;
        throw new Error("must_not_call_core");
      },
    });
    await assert.rejects(
      () => coordinator({
        args: { work_id: WORK_ID, adapter: "research", idempotency_key: "join-once" },
        identity: { tenantId: "tenant-a" },
        aclIdentity: { tenantId: "tenant-a" },
      }),
      (error) => error.code === scenario.expected && error.status === 503,
    );
    assert.equal(outboundCalls, 0);
    assert.equal(store.calls.length, 0);
  }
});

test("Generic Join coordinator binds the signed verdict to the exact locally built request", async () => {
  const store = fakeStore();
  const verdict = { verdict_digest: "c".repeat(64) };
  let outboundRequest;
  const coordinator = createGenericWorkCoreJoinMcpCoordinator({
    enabled: true,
    store,
    readiness: { initialized: true },
    issueCore: async (request) => {
      outboundRequest = request;
      return {
        structuredContent: {
          dedicated_core_gate: { authorized: true },
          generic_core_join_verdict: verdict,
        },
      };
    },
  });
  const result = await coordinator({
    args: { work_id: WORK_ID, adapter: "research", idempotency_key: "join-once" },
    identity: { tenantId: "tenant-a" },
    aclIdentity: { tenantId: "tenant-a" },
  });
  assert.deepEqual(outboundRequest, REQUEST);
  assert.deepEqual(store.calls[1], ["verify", verdict, REQUEST]);
  assert.equal(store.calls[2][0], "persist");
  assert.equal(store.calls[2][1].coreJoinTrusted, true);
  assert.deepEqual(store.calls[2][2], {
    work_id: WORK_ID,
    core_join_digest: verdict.verdict_digest,
    core_join_context: verdict,
  });
  assert.deepEqual(result.result, { persisted: true });
});

test("Generic Join coordinator classifies an unusable upstream contract as 502", async () => {
  const coordinator = createGenericWorkCoreJoinMcpCoordinator({
    enabled: true,
    store: fakeStore(),
    readiness: { initialized: true },
    issueCore: async () => ({ structuredContent: { dedicated_core_gate: { authorized: false } } }),
  });
  await assert.rejects(
    () => coordinator({
      args: { work_id: WORK_ID, adapter: "research", idempotency_key: "join-once" },
      identity: { tenantId: "tenant-a" },
      aclIdentity: { tenantId: "tenant-a" },
    }),
    (error) => error.code === "generic_work_core_join_response_invalid" && error.status === 502,
  );
});

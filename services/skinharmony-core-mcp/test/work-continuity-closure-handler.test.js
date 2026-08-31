import assert from "node:assert/strict";
import test from "node:test";
import { createWorkContinuityClosureEvaluateHandler } from "../src/work-continuity-closure-handler.js";

const DIGEST = (character) => character.repeat(64);
const identity = { tenantId: "tenant-a" };
const args = {
  work_id: "11111111-1111-4111-8111-111111111111",
  plan_id: "22222222-2222-4222-8222-222222222222",
  release: { repository: "owner/repository" },
};

function renewalFixture() {
  const renewal = {
    schema_version: "continuity_core_join_renewal_v1",
    predecessor_verdict_id: `hnj_${"1".repeat(40)}`,
    predecessor_claim_digest: DIGEST("2"),
    predecessor_release_intent_digest: DIGEST("3"),
    predecessor_record_digest: DIGEST("4"),
    generation: 1,
  };
  const material = {
    schema_version: "continuity_core_join_material_v1",
    tenant_id: identity.tenantId,
    material_digest: DIGEST("a"),
    release_intent_request: {
      work_id: args.work_id,
      repository: args.release.repository,
    },
    core_join_request: {
      work_id: args.work_id,
      core_join_renewal: renewal,
    },
  };
  const releaseIntent = {
    tenant_id: identity.tenantId,
    work_id: args.work_id,
    release_intent_digest: DIGEST("b"),
  };
  const coreJoinRecord = {
    tenant_id: identity.tenantId,
    verdict_id: `hnj_${"5".repeat(40)}`,
  };
  return { renewal, material, releaseIntent, coreJoinRecord };
}

test("closure handler renews through the exact production sequence and binds the effective evaluation", async () => {
  const calls = [];
  const { renewal, material, releaseIntent, coreJoinRecord } = renewalFixture();
  const runtime = {
    async evaluateClosure(receivedIdentity, receivedArgs) {
      calls.push("evaluate");
      assert.equal(receivedIdentity, identity);
      assert.equal(receivedArgs, args);
      return { closed: true, evaluation_id: "fresh-random-evaluation" };
    },
    async prepareEffectiveCoreJoinEvaluation(receivedIdentity, input) {
      calls.push("prepare");
      assert.equal(receivedIdentity, identity);
      assert.deepEqual(input, {
        work_id: args.work_id,
        plan_id: args.plan_id,
        evaluation_id: "fresh-random-evaluation",
        release: args.release,
      });
      return {
        closed: true,
        evaluation_id: "original-chain-evaluation",
        evaluation_digest: DIGEST("c"),
        core_join_material: material,
      };
    },
    async bindCoreJoinVerdict(receivedIdentity, input, binding) {
      calls.push("bind");
      assert.equal(receivedIdentity, identity);
      assert.deepEqual(input, {
        work_id: args.work_id,
        plan_id: args.plan_id,
        evaluation_id: "original-chain-evaluation",
      });
      assert.deepEqual(binding, { releaseIntent, coreJoinRecord });
      return {
        release_ready: true,
        release_intent_digest: releaseIntent.release_intent_digest,
        verdict_id: coreJoinRecord.verdict_id,
      };
    },
  };
  const coreHandlers = {
    async host_native_release_intent_build(input, receivedIdentity) {
      calls.push("release");
      assert.equal(receivedIdentity, identity);
      assert.equal(input, material.release_intent_request);
      return {
        structuredContent: {
          tenant_id: identity.tenantId,
          dedicated_core_gate: { authorized: true },
          release_intent: releaseIntent,
        },
      };
    },
    async host_native_core_join_issue(input, receivedIdentity) {
      calls.push("issue");
      assert.equal(receivedIdentity, identity);
      assert.deepEqual(input.core_join_renewal, renewal);
      assert.equal(input.release_intent, releaseIntent);
      assert.equal(input.idempotency_key, `continuity-core-join-${material.material_digest}`);
      return {
        structuredContent: {
          tenant_id: identity.tenantId,
          dedicated_core_gate: { authorized: true },
          core_join_verdict: coreJoinRecord,
        },
      };
    },
  };

  const handler = createWorkContinuityClosureEvaluateHandler({ runtime, coreHandlers });
  const response = await handler(args, identity);

  assert.deepEqual(calls, ["evaluate", "prepare", "release", "issue", "bind"]);
  assert.equal(response.structuredContent.result.evaluation_id, "original-chain-evaluation");
  assert.equal(response.structuredContent.result.release_ready, true);
  assert.equal(response.structuredContent.result.core_join.verdict_id, coreJoinRecord.verdict_id);
  assert.equal("core_join_material" in response.structuredContent.result, false);
});

test("closure handler fails closed when Core knows the expired predecessor was consumed", async () => {
  const calls = [];
  const { material, releaseIntent } = renewalFixture();
  const coreError = Object.assign(new Error("core_join_renewal_predecessor_unavailable"), {
    code: "core_join_renewal_predecessor_unavailable",
  });
  const runtime = {
    async evaluateClosure() {
      calls.push("evaluate");
      return { closed: true, evaluation_id: "fresh-random-evaluation" };
    },
    async prepareEffectiveCoreJoinEvaluation() {
      calls.push("prepare");
      return {
        closed: true,
        evaluation_id: "original-chain-evaluation",
        core_join_material: material,
      };
    },
    async bindCoreJoinVerdict() {
      calls.push("bind");
      throw new Error("bind_must_not_run");
    },
  };
  const coreHandlers = {
    async host_native_release_intent_build() {
      calls.push("release");
      return {
        structuredContent: {
          tenant_id: identity.tenantId,
          dedicated_core_gate: { authorized: true },
          release_intent: releaseIntent,
        },
      };
    },
    async host_native_core_join_issue() {
      calls.push("issue");
      throw coreError;
    },
  };

  const handler = createWorkContinuityClosureEvaluateHandler({ runtime, coreHandlers });
  await assert.rejects(handler(args, identity), (error) => {
    assert.equal(error, coreError);
    assert.equal(error.code, "core_join_renewal_predecessor_unavailable");
    return true;
  });
  assert.deepEqual(calls, ["evaluate", "prepare", "release", "issue"]);
});

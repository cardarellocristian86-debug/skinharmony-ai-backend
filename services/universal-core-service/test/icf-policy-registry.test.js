import test from "node:test";
import assert from "node:assert/strict";
import { createIcfPolicyRegistry } from "../src/icfPolicyRegistry.js";
import { createIcfPolicyProofVerifier } from "../src/icfPolicyProof.js";

const binding = { tenant_id: "t1", work_id: "w1", covenant_id: "c1", covenant_version: 1, obligation_id: "o1", cell_id: "cell1", verb: "read", target: "target-1", input_digest: "digest-1" };
const policy = { schema: "nyra.policy/1.0", policy_id: "icf.advisory", version: 1, rules: { allowed_verbs: ["read"] } };

test("registry registra policy immutabile e attiva una versione", () => {
  const registry = createIcfPolicyRegistry({ secret: "secret" });
  assert.equal(registry.register(policy, { activate: true }).ok, true);
  assert.equal(registry.register({ ...policy, rules: { allowed_verbs: ["write"] } }).reason, "policy_version_immutable");
  assert.equal(registry.readiness().active_policies, 1);
});

test("coordinator emette proof firmata verificabile", () => {
  const registry = createIcfPolicyRegistry({ secret: "secret" });
  registry.register(policy, { activate: true });
  const issued = registry.issueProof({ policyId: policy.policy_id, binding, ttlSeconds: 60, now: Date.now() });
  assert.equal(issued.ok, true);
  const verifier = createIcfPolicyProofVerifier({ secret: "secret" });
  assert.equal(verifier.verify(issued.proof, binding).ok, true);
});

test("fail-closed senza secret o policy attiva", () => {
  const empty = createIcfPolicyRegistry();
  assert.equal(empty.issueProof({ policyId: "missing", binding }).reason, "policy_coordinator_unconfigured");
  const registry = createIcfPolicyRegistry({ secret: "secret" });
  assert.equal(registry.issueProof({ policyId: "missing", binding }).reason, "policy_not_active");
});

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createIcfPolicyProofVerifier } from "../src/icfPolicyProof.js";
import { recomputeGlobalIntentJoin } from "../src/icfGlobalJoin.js";
import { recomputeGenericCoreJoin } from "../src/icfGenericCoreJoin.js";

const secret = "e2e-only-secret";
const binding = { tenant_id: "t1", work_id: "w1", covenant_id: "c1", covenant_version: 1, obligation_id: "o1", cell_id: "cell1", verb: "read", target: "target", input_digest: "sha256:input" };
function signedProof(now = Date.now()) {
  const p = { schema: "nyra.policy-proof/1.0", decision: "allow", ...binding, nonce: crypto.randomUUID(), issued_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 60000).toISOString() };
  const canonical = JSON.stringify(p, Object.keys(p).sort());
  p.signature = crypto.createHmac("sha256", secret).update(canonical).digest("hex");
  return p;
}
function completeWork(now = Date.now()) {
  return { obligations: [{ obligation_id: "o1", status: "satisfied", clause_refs: ["clause-1"] }], evidence: [{ truth_state: "TRUE", verified: true, fresh_until: new Date(now + 60000).toISOString() }], warrants: [], covenant: { clauses: [{ clause_id: "clause-1" }] }, snapshot_at: new Date(now).toISOString(), events: [] };
}

test("E2E enforced gates: policy proof -> global join -> generic core join", () => {
  const now = Date.now();
  const verifier = createIcfPolicyProofVerifier({ secret, maxAgeSeconds: 300, clockSkewSeconds: 0 });
  const proof = signedProof(now);
  const verified = verifier.verify(proof, binding, now);
  const global = recomputeGlobalIntentJoin(completeWork(now), { now });
  const joined = recomputeGenericCoreJoin({ globalJoin: global, policyProof: { ...verified, expires_at: proof.expires_at }, storeReadiness: { kind: "postgresql", restart_durable: true, distributed: true }, now });
  assert.equal(verified.ok, true);
  assert.equal(global.join_decision, "close");
  assert.equal(joined.decision, "allow");
  assert.match(joined.join_digest, /^sha256:/);
});

test("E2E fail-closed: replayed proof blocks generic join", () => {
  const now = Date.now();
  const verifier = createIcfPolicyProofVerifier({ secret, clockSkewSeconds: 0 });
  const proof = signedProof(now);
  assert.equal(verifier.verify(proof, binding, now).ok, true);
  const replay = verifier.verify(proof, binding, now);
  const joined = recomputeGenericCoreJoin({ globalJoin: recomputeGlobalIntentJoin(completeWork(now), { now }), policyProof: replay, storeReadiness: { kind: "postgresql", restart_durable: true, distributed: true }, now });
  assert.equal(replay.reason, "policy_proof_nonce_replay");
  assert.equal(joined.decision, "block");
});

test("E2E fail-closed: non-durable or stale store blocks enforced join", () => {
  const now = Date.now();
  const joined = recomputeGenericCoreJoin({ globalJoin: recomputeGlobalIntentJoin(completeWork(now), { now }), policyProof: { ok: true, expires_at: new Date(now + 1).toISOString() }, storeReadiness: { kind: "memory", restart_durable: false, distributed: false }, now: now + 10000 });
  assert.equal(joined.decision, "block");
  assert.deepEqual(joined.reasons, ["store_not_postgresql", "store_not_restart_durable", "store_not_distributed", "policy_proof_expired"]);
});

test("E2E negative: global join cannot be bypassed by a valid policy proof", () => {
  const now = Date.now();
  const joined = recomputeGenericCoreJoin({ globalJoin: recomputeGlobalIntentJoin({ ...completeWork(now), obligations: [{ obligation_id: "o1", status: "open", clause_refs: ["clause-1"] }] }, { now }), policyProof: { ok: true, expires_at: new Date(now + 60000).toISOString() }, storeReadiness: { kind: "postgresql", restart_durable: true, distributed: true }, now });
  assert.equal(joined.decision, "block");
  assert.deepEqual(joined.reasons, ["global_intent_join_blocked"]);
});

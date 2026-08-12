import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createIcfPolicyProofVerifier } from "../src/icfPolicyProof.js";

const binding = { tenant_id: "t1", work_id: "w1", covenant_id: "c1", covenant_version: 1, obligation_id: "o1", cell_id: "cell1", verb: "read", target: "target-1", input_digest: "digest-1" };
const sign = (proof, secret) => crypto.createHmac("sha256", secret).update(JSON.stringify(proof, Object.keys(proof).sort())).digest("hex");
function proof(secret, nonce = crypto.randomUUID()) {
  const issued = new Date(Date.now() - 1000).toISOString();
  const p = { schema: "nyra.policy-proof/1.0", ...binding, decision: "allow", issued_at: issued, expires_at: new Date(Date.now() + 60_000).toISOString(), nonce };
  p.signature = sign(p, secret); return p;
}

test("policy proof valida e anti-replay", () => {
  const v = createIcfPolicyProofVerifier({ secret: "test-secret" });
  const p = proof("test-secret");
  assert.equal(v.verify(p, binding).ok, true);
  assert.equal(v.verify(p, binding).reason, "policy_proof_nonce_replay");
});

test("firma e binding alterati falliscono", () => {
  const v = createIcfPolicyProofVerifier({ secret: "test-secret" });
  const p = proof("test-secret");
  p.target = "other";
  assert.equal(v.verify(p, binding).ok, false);
  const q = proof("test-secret");
  q.signature = "bad";
  assert.equal(v.verify(q, binding).reason, "policy_proof_signature_invalid");
});

test("proof scaduta fallisce", () => {
  const v = createIcfPolicyProofVerifier({ secret: "test-secret" });
  const p = proof("test-secret");
  p.issued_at = new Date(Date.now() - 600_000).toISOString();
  p.expires_at = new Date(Date.now() - 300_000).toISOString();
  assert.equal(v.verify(p, binding).ok, false);
});

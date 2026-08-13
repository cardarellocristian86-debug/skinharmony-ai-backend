import crypto from "node:crypto";

const canonical = (value) => JSON.stringify(value, Object.keys(value || {}).sort());
const hash = (value) => crypto.createHash("sha256").update(canonical(value)).digest("hex");

export function createIcfPolicyProofVerifier({
  secret = process.env.ICF_POLICY_PROOF_SECRET,
  maxAgeSeconds = Number(process.env.ICF_POLICY_MAX_AGE_SECONDS || 300),
  clockSkewSeconds = Number(process.env.ICF_POLICY_CLOCK_SKEW_SECONDS || 30),
  failClosed = String(process.env.ICF_POLICY_FAIL_CLOSED || "true") !== "false",
} = {}) {
  const seen = new Set();
  function verify(proof, binding, now = Date.now()) {
    if (!proof || !binding || !secret) return { ok: false, reason: "policy_proof_unconfigured" };
    if (proof.schema !== "nyra.policy-proof/1.0" || proof.decision !== "allow") return { ok: false, reason: "policy_proof_invalid_schema" };
    if (proof.nonce == null || seen.has(proof.nonce)) return { ok: false, reason: "policy_proof_nonce_replay" };
    const issued = Date.parse(proof.issued_at), expires = Date.parse(proof.expires_at);
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || now + clockSkewSeconds * 1000 < issued || now - clockSkewSeconds * 1000 > expires || now - issued > maxAgeSeconds * 1000) return { ok: false, reason: "policy_proof_expired_or_stale" };
    const expectedBinding = { tenant_id: binding.tenant_id, work_id: binding.work_id, covenant_id: binding.covenant_id, covenant_version: binding.covenant_version, obligation_id: binding.obligation_id, cell_id: binding.cell_id, verb: binding.verb, target: binding.target, input_digest: binding.input_digest };
    for (const [key, value] of Object.entries(expectedBinding)) if (proof[key] !== value && proof.scope?.[key] !== value) return { ok: false, reason: "policy_proof_binding_mismatch", field: key };
    const unsigned = { ...proof }; delete unsigned.signature;
    const expected = crypto.createHmac("sha256", secret).update(canonical(unsigned)).digest("hex");
    const actualBuffer = Buffer.from(String(proof.signature || ""));
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return { ok: false, reason: "policy_proof_signature_invalid" };
    seen.add(proof.nonce);
    return { ok: true, proof_hash: hash(unsigned) };
  }
  return { verify, readiness: () => ({ configured: Boolean(secret), fail_closed: failClosed, max_age_seconds: maxAgeSeconds }) };
}

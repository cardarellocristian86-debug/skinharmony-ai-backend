import crypto from "node:crypto";

const SCHEMA = "nyra.policy/1.0";
const PROOF_SCHEMA = "nyra.policy-proof/1.0";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(canonical(value)).digest("hex");
}

/**
 * Small deterministic policy registry/coordinator. Policies are immutable by
 * digest; replacing a policy requires a new version and explicit activation.
 * It is intentionally in-memory until backed by the authoritative ICF store.
 */
export function createIcfPolicyRegistry({ secret = process.env.ICF_POLICY_PROOF_SECRET, clock = () => Date.now() } = {}) {
  const policies = new Map();
  const active = new Map();
  const issuedNonces = new Set();

  function validatePolicy(policy) {
    if (!policy || policy.schema !== SCHEMA || !policy.policy_id || !Number.isInteger(policy.version) || policy.version < 1) {
      return { ok: false, reason: "policy_invalid_schema" };
    }
    if (!policy.rules || typeof policy.rules !== "object") return { ok: false, reason: "policy_rules_missing" };
    return { ok: true };
  }

  function register(policy, { activate = false } = {}) {
    const valid = validatePolicy(policy);
    if (!valid.ok) return valid;
    const body = { ...policy };
    delete body.policy_digest;
    const policyDigest = digest(body);
    const key = `${body.policy_id}:${body.version}`;
    const existing = policies.get(key);
    if (existing && existing.policy_digest !== policyDigest) return { ok: false, reason: "policy_version_immutable" };
    const record = Object.freeze({ ...body, policy_digest: policyDigest });
    policies.set(key, record);
    if (activate) active.set(body.policy_id, record);
    return { ok: true, policy: record };
  }

  function activate(policyId, version) {
    const policy = policies.get(`${policyId}:${version}`);
    if (!policy) return { ok: false, reason: "policy_not_registered" };
    active.set(policyId, policy);
    return { ok: true, policy };
  }

  function get(policyId, version) {
    return policies.get(`${policyId}:${version}`) || null;
  }

  function issueProof({ policyId, binding, now = clock(), ttlSeconds = 300, nonce = crypto.randomUUID() } = {}) {
    if (!secret) return { ok: false, reason: "policy_coordinator_unconfigured" };
    const policy = active.get(policyId);
    if (!policy) return { ok: false, reason: "policy_not_active" };
    if (!binding || !binding.tenant_id || !binding.work_id || !binding.obligation_id || !binding.cell_id) return { ok: false, reason: "policy_binding_incomplete" };
    if (issuedNonces.has(nonce)) return { ok: false, reason: "policy_nonce_replay" };
    const issuedAt = new Date(now).toISOString();
    const proof = { schema: PROOF_SCHEMA, decision: "allow", policy_id: policy.policy_id, policy_version: policy.version, policy_digest: policy.policy_digest, ...binding, issued_at: issuedAt, expires_at: new Date(now + ttlSeconds * 1000).toISOString(), nonce };
    proof.signature = sign(proof, secret);
    issuedNonces.add(nonce);
    return { ok: true, proof, proof_hash: digest({ ...proof, signature: undefined }) };
  }

  function readiness() {
    return { configured: Boolean(secret), fail_closed: true, registered_policies: policies.size, active_policies: active.size };
  }

  return { register, activate, get, issueProof, readiness, canonical, digest };
}

export { SCHEMA as ICF_POLICY_SCHEMA, PROOF_SCHEMA as ICF_POLICY_PROOF_SCHEMA };

import crypto from "node:crypto";

export const POLICY_REGISTRY_SIGN_ROUTE = "/v1/policy-registry/sign";
export const POLICY_REGISTRY_SIGNER_HEALTH_ROUTE = "/v1/policy-registry/signer-health";

const REQUEST_FIELDS = ["digest", "key_id", "payload", "purpose", "schema_version", "service", "target_commit"];
const PURPOSES = new Set([
  "nyra-policy-activation-attestation-v3",
  "core-policy-activation-receipt-v3",
  "nyra-policy-registry-core-signer-probe-v1",
]);
const SHA256 = /^[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SERVICE = /^[a-z][a-z0-9._-]{2,63}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const PKCS8_ED25519_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function safeEqual(left, right) {
  const a = crypto.createHash("sha256").update(String(left || "")).digest();
  const b = crypto.createHash("sha256").update(String(right || "")).digest();
  return crypto.timingSafeEqual(a, b);
}

function deriveSigningKey(seed) {
  if (typeof seed !== "string" || seed.length < 32 || seed.length > 4096 || seed !== seed.trim()) {
    throw new Error("policy_registry_signer_seed_invalid");
  }
  const raw = crypto.createHash("sha256").update("skinharmony-policy-registry-core-signer-v1\0").update(seed).digest();
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_SEED_PREFIX, raw]),
    format: "der",
    type: "pkcs8",
  });
}

function publicMetadata(privateKey, keyId) {
  const publicKey = crypto.createPublicKey(privateKey);
  const fingerprint = crypto.createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const jwk = publicKey.export({ format: "jwk" });
  return {
    fingerprint,
    publicKey,
    publicJwk: JSON.stringify({ alg: "EdDSA", crv: "Ed25519", kid: keyId, kty: "OKP", use: "sig", x: jwk.x }),
  };
}

function noStore(res) {
  return res.set({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
}

export function createPolicyRegistrySigner({ env = process.env } = {}) {
  let state = { configured: false, ready: false, error: "policy_registry_signer_disabled" };
  let signingKey = null;
  let publicKey = null;
  let publicKeyFingerprint = null;
  let publicJwk = null;
  let token = null;
  let service = null;
  let keyId = null;
  let targetCommit = null;
  try {
    if (env.POLICY_REGISTRY_CORE_SIGNER_ENABLED !== "true") throw new Error("policy_registry_signer_disabled");
    service = String(env.POLICY_REGISTRY_CORE_SIGNER_SERVICE || "");
    keyId = String(env.POLICY_REGISTRY_CORE_SIGNER_KEY_ID || "");
    targetCommit = String(env.POLICY_REGISTRY_CORE_SIGNER_TARGET_COMMIT || "").toLowerCase();
    token = String(env.POLICY_REGISTRY_CORE_SIGNER_SERVICE_TOKEN || "");
    if (!SERVICE.test(service)) throw new Error("policy_registry_signer_service_invalid");
    if (!ID.test(keyId)) throw new Error("policy_registry_signer_key_id_invalid");
    if (!COMMIT.test(targetCommit)) throw new Error("policy_registry_signer_target_commit_invalid");
    if (token.length < 32 || token.length > 4096 || token !== token.trim()) throw new Error("policy_registry_signer_token_invalid");
    signingKey = deriveSigningKey(env.POLICY_REGISTRY_CORE_SIGNER_SEED);
    ({ publicKey, fingerprint: publicKeyFingerprint, publicJwk } = publicMetadata(signingKey, keyId));
    state = { configured: true, ready: true, error: null };
  } catch (error) {
    state = { configured: false, ready: false, error: String(error?.message || "policy_registry_signer_configuration_invalid") };
    signingKey = null;
    token = null;
  }

  function health() {
    return Object.freeze({
      ...state,
      custody: state.ready ? "external_remote_signer" : "unavailable",
      service,
      key_id: keyId,
      target_commit: targetCommit,
      public_key_fingerprint: publicKeyFingerprint,
      public_key: publicJwk,
      route: POLICY_REGISTRY_SIGN_ROUTE,
    });
  }

  function authorize(value) {
    return state.ready && safeEqual(value, `Bearer ${token}`);
  }

  function handle(req, res) {
    if (!state.ready) return noStore(res).status(503).json({ error: "signer_unavailable" });
    if (!authorize(req.get("authorization"))) return noStore(res).status(401).json({ error: "unauthorized" });
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).sort().join("\0") !== REQUEST_FIELDS.join("\0") ||
      body.schema_version !== "nyra_policy_registry_sign_request_v1" ||
      body.service !== service || body.key_id !== keyId || body.target_commit !== targetCommit ||
      !PURPOSES.has(body.purpose) || !SHA256.test(String(body.digest || "")) ||
      !BASE64URL.test(String(body.payload || ""))) {
      return noStore(res).status(400).json({ error: "invalid_request" });
    }
    const payload = Buffer.from(body.payload, "base64url");
    if (payload.length < 1 || payload.length > 262144 || payload.toString("base64url") !== body.payload ||
      crypto.createHash("sha256").update(payload).digest("hex") !== body.digest) {
      return noStore(res).status(400).json({ error: "invalid_request" });
    }
    const signature = crypto.sign(null, payload, signingKey).toString("base64url");
    if (!crypto.verify(null, payload, publicKey, Buffer.from(signature, "base64url"))) {
      return noStore(res).status(503).json({ error: "signer_unavailable" });
    }
    return noStore(res).status(200).json({
      schema_version: "nyra_policy_registry_sign_response_v1",
      service,
      target_commit: targetCommit,
      purpose: body.purpose,
      key_id: keyId,
      digest: body.digest,
      signature_algorithm: "Ed25519",
      signature,
    });
  }

  return Object.freeze({ authorize, handle, health });
}

"use strict";

const crypto = require("node:crypto");

const SIGN_ROUTE = "/v1/policy-registry/sign";
const HEALTH_ROUTE = "/v1/policy-registry/signer-health";
const FIELDS = ["digest", "key_id", "payload", "purpose", "schema_version", "service", "target_commit"];
const SHA256 = /^[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SERVICE = /^[a-z][a-z0-9._-]{2,63}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function safeEqual(left, right) {
  const a = crypto.createHash("sha256").update(String(left || "")).digest();
  const b = crypto.createHash("sha256").update(String(right || "")).digest();
  return crypto.timingSafeEqual(a, b);
}

function createNyraPolicyRegistryEmbeddedSigner({ env = process.env } = {}) {
  let configured = false;
  let error = "nyra_policy_registry_signer_disabled";
  let privateKey;
  let publicKey;
  let publicKeyFingerprint = null;
  let publicJwk = null;
  const service = String(env.NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_SERVICE || "");
  const keyId = String(env.NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_KEY_ID || "");
  const targetCommit = String(env.NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_TARGET_COMMIT || "").toLowerCase();
  const purpose = String(env.NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_PURPOSE || "");
  const token = String(env.NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_SERVICE_TOKEN || "");
  try {
    if (env.NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_ENABLED !== "true") throw new Error(error);
    if (!SERVICE.test(service) || !ID.test(keyId) || !COMMIT.test(targetCommit) ||
      purpose !== "nyra.policy_registry.attestation" || token.length < 32 || token.length > 4096 || token !== token.trim()) {
      throw new Error("nyra_policy_registry_signer_configuration_invalid");
    }
    const seed = String(env.NYRA_POLICY_REGISTRY_EMBEDDED_SIGNER_SEED || "");
    if (seed.length < 32 || seed.length > 4096 || seed !== seed.trim()) throw new Error("nyra_policy_registry_signer_seed_invalid");
    const raw = crypto.createHash("sha256").update("skinharmony-policy-registry-nyra-signer-v1\0").update(seed).digest();
    privateKey = crypto.createPrivateKey({ key: Buffer.concat([PREFIX, raw]), format: "der", type: "pkcs8" });
    publicKey = crypto.createPublicKey(privateKey);
    publicKeyFingerprint = crypto.createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
    const jwk = publicKey.export({ format: "jwk" });
    publicJwk = JSON.stringify({ alg: "EdDSA", crv: "Ed25519", kid: keyId, kty: "OKP", use: "sig", x: jwk.x });
    configured = true;
    error = null;
  } catch (caught) {
    error = String(caught?.message || "nyra_policy_registry_signer_configuration_invalid");
  }

  function authorize(value) { return configured && safeEqual(value, `Bearer ${token}`); }
  function health() {
    return Object.freeze({ configured, ready: configured, error, custody: configured ? "external_remote_signer" : "unavailable",
      service, key_id: keyId, target_commit: targetCommit, public_key_fingerprint: publicKeyFingerprint,
      public_key: publicJwk, route: SIGN_ROUTE });
  }
  function handle(req, res) {
    res.set({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
    if (!configured) return res.status(503).json({ error: "signer_unavailable" });
    if (!authorize(req.get("authorization"))) return res.status(401).json({ error: "unauthorized" });
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join("\0") !== FIELDS.join("\0") ||
      body.schema_version !== "nyra_policy_registry_sign_request_v1" || body.service !== service || body.key_id !== keyId ||
      body.target_commit !== targetCommit || body.purpose !== purpose || !SHA256.test(String(body.digest || "")) ||
      !BASE64URL.test(String(body.payload || ""))) return res.status(400).json({ error: "invalid_request" });
    const payload = Buffer.from(body.payload, "base64url");
    if (payload.length < 1 || payload.length > 65536 || payload.toString("base64url") !== body.payload ||
      crypto.createHash("sha256").update(payload).digest("hex") !== body.digest) return res.status(400).json({ error: "invalid_request" });
    return res.status(200).json({ schema_version: "nyra_policy_registry_sign_response_v1", service, target_commit: targetCommit,
      purpose, key_id: keyId, digest: body.digest, signature_algorithm: "ed25519",
      signature: crypto.sign(null, payload, privateKey).toString("base64url") });
  }
  return Object.freeze({ authorize, handle, health });
}

module.exports = { HEALTH_ROUTE, SIGN_ROUTE, createNyraPolicyRegistryEmbeddedSigner };

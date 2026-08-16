import crypto from "node:crypto";

export const GENERIC_WORK_CORE_JOIN_SIGN_ROUTE = "/v1/generic-work-core-join/sign";
export const GENERIC_WORK_CORE_JOIN_SIGNER_HEALTH_ROUTE = "/v1/generic-work-core-join/signer-health";

const REQUEST_FIELDS = ["digest", "key_id", "purpose", "schema_version", "service", "target_commit"];
const SHA256 = /^[a-f0-9]{64}$/;
const TARGET_COMMIT = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SERVICE = /^[a-z][a-z0-9._-]{2,63}$/;
const PURPOSE = /^[a-z][a-z0-9._:-]{2,127}$/;
const PKCS8_ED25519_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function send(res, status, body) {
  return res.set({ "cache-control": "no-store", "x-content-type-options": "nosniff" }).status(status).json(body);
}

function safeEqual(left, right) {
  const a = crypto.createHash("sha256").update(String(left || "")).digest();
  const b = crypto.createHash("sha256").update(String(right || "")).digest();
  return crypto.timingSafeEqual(a, b);
}

function signingKey(seed) {
  if (typeof seed !== "string" || seed.length < 32 || seed.length > 4096 || seed !== seed.trim()) {
    throw new Error("generic_work_core_join_signer_seed_invalid");
  }
  const raw = crypto.createHash("sha256")
    .update("skinharmony-generic-work-core-join-signer-v1\0").update(seed).digest();
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_SEED_PREFIX, raw]), format: "der", type: "pkcs8",
  });
}

export function createGenericWorkCoreJoinSigner({ env = process.env } = {}) {
  let state = { configured: false, ready: false, error: "generic_work_core_join_signer_disabled" };
  let key = null;
  let publicKey = null;
  let publicJwk = null;
  let fingerprint = null;
  let token = null;
  let service = null;
  let purpose = null;
  let keyId = null;
  let targetCommit = null;
  try {
    if (env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_ENABLED !== "true") throw new Error("generic_work_core_join_signer_disabled");
    service = String(env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE || "");
    purpose = String(env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_PURPOSE || "");
    keyId = String(env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_KEY_ID || "");
    targetCommit = String(env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_TARGET_COMMIT || "").toLowerCase();
    token = String(env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN || "");
    if (!SERVICE.test(service) || !PURPOSE.test(purpose) || !ID.test(keyId) || !TARGET_COMMIT.test(targetCommit)) {
      throw new Error("generic_work_core_join_signer_binding_invalid");
    }
    if (token.length < 32 || token.length > 4096 || token !== token.trim()) {
      throw new Error("generic_work_core_join_signer_token_invalid");
    }
    key = signingKey(env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SEED);
    publicKey = crypto.createPublicKey(key);
    fingerprint = crypto.createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
    const jwk = publicKey.export({ format: "jwk" });
    publicJwk = JSON.stringify({ alg: "EdDSA", crv: "Ed25519", kid: keyId, kty: "OKP", use: "sig", x: jwk.x });
    state = { configured: true, ready: true, error: null };
  } catch (error) {
    state = { configured: false, ready: false, error: String(error?.message || "generic_work_core_join_signer_invalid") };
    key = null;
    token = null;
  }

  function health() {
    return Object.freeze({ ...state, route: GENERIC_WORK_CORE_JOIN_SIGN_ROUTE, service, purpose,
      key_id: keyId, target_commit: targetCommit, public_key: publicJwk,
      public_key_fingerprint: fingerprint, custody: state.ready ? "external_remote_signer" : "unavailable" });
  }

  function handle(req, res) {
    if (!state.ready) return send(res, 503, { error: "signer_unavailable" });
    if (!safeEqual(req.get("authorization"), `Bearer ${token}`)) return send(res, 401, { error: "unauthorized" });
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).sort().join("\0") !== REQUEST_FIELDS.join("\0") ||
      body.schema_version !== "generic_work_core_join_sign_request_v1" || body.service !== service ||
      body.target_commit !== targetCommit || body.purpose !== purpose || body.key_id !== keyId ||
      !SHA256.test(String(body.digest || ""))) return send(res, 400, { error: "invalid_request" });
    const payload = Buffer.from(`generic_work_core_join_v1\0${body.digest}`, "utf8");
    const signature = crypto.sign(null, payload, key).toString("base64url");
    return send(res, 200, { schema_version: "generic_work_core_join_sign_response_v1", service,
      target_commit: targetCommit, purpose, key_id: keyId, digest: body.digest,
      signature_algorithm: "ed25519", signature });
  }
  return Object.freeze({ health, handle });
}

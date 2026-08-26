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
const MAX_CORE_HEALTH_BYTES = 32_768;

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

async function readBoundedResponseText(response, maximumBytes) {
  if (typeof response?.body?.getReader !== "function") {
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > maximumBytes) throw new Error("generic_work_core_join_signer_core_health_invalid");
    return raw;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("generic_work_core_join_signer_core_health_invalid");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function createCoreBuildResolver({ coreOrigin, fetchImpl = globalThis.fetch, timeoutMs = 1_500 } = {}) {
  let endpoint;
  try {
    const parsed = new URL(String(coreOrigin || ""));
    if (
      parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password ||
      !["", "/"].includes(parsed.pathname) || parsed.search || parsed.hash
    ) throw new Error("invalid");
    endpoint = new URL("/healthz", parsed).toString();
  } catch {
    throw new Error("generic_work_core_join_signer_core_origin_invalid");
  }
  if (typeof fetchImpl !== "function") throw new Error("generic_work_core_join_signer_core_health_unavailable");
  return async () => {
    const controller = new AbortController();
    const boundedTimeout = Math.min(Math.max(Number(timeoutMs) || 1_500, 100), 5_000);
    const timer = setTimeout(() => controller.abort(), boundedTimeout);
    try {
      const response = await fetchImpl(endpoint, {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response || response.ok !== true || response.redirected === true ||
          (response.url && response.url !== endpoint)) {
        throw new Error("generic_work_core_join_signer_core_health_unavailable");
      }
      const declared = Number(response.headers?.get?.("content-length") || 0);
      if (Number.isFinite(declared) && declared > MAX_CORE_HEALTH_BYTES) {
        throw new Error("generic_work_core_join_signer_core_health_invalid");
      }
      const contentType = String(response.headers?.get?.("content-type") || "").trim().toLowerCase();
      if (!/^application\/json(?:\s*;\s*charset=(?:utf-8|utf8))?$/.test(contentType)) {
        throw new Error("generic_work_core_join_signer_core_health_invalid");
      }
      const raw = await readBoundedResponseText(response, MAX_CORE_HEALTH_BYTES);
      const payload = JSON.parse(raw);
      const commit = String(payload?.build?.commit_sha || "").toLowerCase();
      if (payload?.ok !== true || payload?.build?.commit_verifiable !== true || !TARGET_COMMIT.test(commit)) {
        throw new Error("generic_work_core_join_signer_core_health_invalid");
      }
      return commit;
    } catch (error) {
      if (String(error?.message || "").startsWith("generic_work_core_join_signer_core_health_")) throw error;
      throw new Error(controller.signal.aborted
        ? "generic_work_core_join_signer_core_health_unavailable"
        : "generic_work_core_join_signer_core_health_invalid");
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createGenericWorkCoreJoinSigner({
  env = process.env,
  coreHealthResolver,
  coreOrigin,
  fetchImpl,
  coreHealthTimeoutMs,
} = {}) {
  let state = { configured: false, ready: false, error: "generic_work_core_join_signer_disabled" };
  let key = null;
  let publicKey = null;
  let publicJwk = null;
  let fingerprint = null;
  let token = null;
  let service = null;
  let purpose = null;
  let keyId = null;
  let resolveCoreBuild = null;
  try {
    if (env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_ENABLED !== "true") throw new Error("generic_work_core_join_signer_disabled");
    service = String(env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE || "");
    purpose = String(env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_PURPOSE || "");
    keyId = String(env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_KEY_ID || "");
    token = String(env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SERVICE_TOKEN || "");
    if (!SERVICE.test(service) || !PURPOSE.test(purpose) || !ID.test(keyId)) {
      throw new Error("generic_work_core_join_signer_binding_invalid");
    }
    if (token.length < 32 || token.length > 4096 || token !== token.trim()) {
      throw new Error("generic_work_core_join_signer_token_invalid");
    }
    key = signingKey(env.GENERIC_WORK_CORE_JOIN_CORE_SIGNER_SEED);
    resolveCoreBuild = typeof coreHealthResolver === "function"
      ? coreHealthResolver
      : createCoreBuildResolver({ coreOrigin, fetchImpl, timeoutMs: coreHealthTimeoutMs });
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
      key_id: keyId, target_commit: null, target_commit_binding: "live_universal_core_health", public_key: publicJwk,
      public_key_fingerprint: fingerprint, custody: state.ready ? "external_remote_signer" : "unavailable" });
  }

  async function handle(req, res) {
    if (!state.ready) return send(res, 503, { error: "signer_unavailable" });
    if (!safeEqual(req.get("authorization"), `Bearer ${token}`)) return send(res, 401, { error: "unauthorized" });
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).sort().join("\0") !== REQUEST_FIELDS.join("\0") ||
      body.schema_version !== "generic_work_core_join_sign_request_v1" || body.service !== service ||
      !TARGET_COMMIT.test(String(body.target_commit || "")) || body.purpose !== purpose || body.key_id !== keyId ||
      !SHA256.test(String(body.digest || ""))) return send(res, 400, { error: "invalid_request" });
    let liveCoreCommit;
    try {
      liveCoreCommit = String(await resolveCoreBuild()).toLowerCase();
    } catch {
      return send(res, 503, { error: "signer_unavailable" });
    }
    if (!TARGET_COMMIT.test(liveCoreCommit) || body.target_commit !== liveCoreCommit) {
      return send(res, 409, { error: "signer_target_commit_mismatch" });
    }
    const payload = Buffer.from(`generic_work_core_join_v1\0${body.digest}`, "utf8");
    const signature = crypto.sign(null, payload, key).toString("base64url");
    return send(res, 200, { schema_version: "generic_work_core_join_sign_response_v1", service,
      target_commit: liveCoreCommit, purpose, key_id: keyId, digest: body.digest,
      signature_algorithm: "ed25519", signature });
  }
  return Object.freeze({ health, handle });
}

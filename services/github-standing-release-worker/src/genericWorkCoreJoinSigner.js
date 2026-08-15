import crypto from "node:crypto";

export const GENERIC_WORK_CORE_JOIN_SIGN_ROUTE = "/v1/generic-work-core-join/sign";
export const GENERIC_WORK_CORE_JOIN_SIGN_REQUEST_SCHEMA_VERSION =
  "generic_work_core_join_sign_request_v1";
export const GENERIC_WORK_CORE_JOIN_SIGN_RESPONSE_SCHEMA_VERSION =
  "generic_work_core_join_sign_response_v1";

const SIGNATURE_DOMAIN = "generic_work_core_join_v1";
const REQUEST_FIELDS = [
  "digest",
  "key_id",
  "purpose",
  "schema_version",
  "service",
  "target_commit",
];
const SHA256 = /^[a-f0-9]{64}$/;
const TARGET_COMMIT = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SERVICE = /^[a-z][a-z0-9._-]{2,63}$/;
const PURPOSE = /^[a-z][a-z0-9._:-]{2,127}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactString(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}

function exactRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || Object.keys(value).sort().join("\0") !== REQUEST_FIELDS.join("\0")) {
    fail("generic_work_core_join_sign_request_invalid");
  }
  if (value.schema_version !== GENERIC_WORK_CORE_JOIN_SIGN_REQUEST_SCHEMA_VERSION) {
    fail("generic_work_core_join_sign_request_invalid");
  }
  exactString(value.service, SERVICE, "generic_work_core_join_sign_request_invalid");
  exactString(value.target_commit, TARGET_COMMIT, "generic_work_core_join_sign_request_invalid");
  exactString(value.purpose, PURPOSE, "generic_work_core_join_sign_request_invalid");
  exactString(value.key_id, ID, "generic_work_core_join_sign_request_invalid");
  exactString(value.digest, SHA256, "generic_work_core_join_sign_request_invalid");
  return value;
}

function serviceToken(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 4_096
      || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("generic_work_core_join_signer_service_token_invalid");
  }
  return value;
}

function privateKey(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 20_000) {
    fail("generic_work_core_join_signer_private_key_invalid");
  }
  try {
    const key = crypto.createPrivateKey(value.replaceAll("\\n", "\n"));
    if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") {
      fail("generic_work_core_join_signer_private_key_invalid");
    }
    return key;
  } catch (error) {
    if (error?.code === "generic_work_core_join_signer_private_key_invalid") throw error;
    fail("generic_work_core_join_signer_private_key_invalid");
  }
}

function bearerAuthorized(value, token) {
  const actual = crypto.createHash("sha256").update(typeof value === "string" ? value : "").digest();
  const expected = crypto.createHash("sha256").update(`Bearer ${token}`).digest();
  return crypto.timingSafeEqual(actual, expected);
}

function signaturePayload(digest) {
  return Buffer.from(`${SIGNATURE_DOMAIN}\0${digest}`, "utf8");
}

function send(res, status, body) {
  res.set("cache-control", "no-store");
  res.set("x-content-type-options", "nosniff");
  return res.status(status).json(body);
}

export function createGenericWorkCoreJoinSignerEndpoint({ env = process.env } = {}) {
  let configurationError = null;
  let token = null;
  let signingKey = null;
  let service = null;
  let purpose = null;
  let keyId = null;
  let targetCommit = null;
  try {
    service = exactString(
      env.GENERIC_WORK_CORE_JOIN_SIGNER_SERVICE,
      SERVICE,
      "generic_work_core_join_signer_service_invalid",
    );
    purpose = exactString(
      env.GENERIC_WORK_CORE_JOIN_SIGNER_PURPOSE,
      PURPOSE,
      "generic_work_core_join_signer_purpose_invalid",
    );
    keyId = exactString(
      env.GENERIC_WORK_CORE_JOIN_SIGNER_KEY_ID,
      ID,
      "generic_work_core_join_signer_key_id_invalid",
    );
    const liveCommit = env.RENDER_GIT_COMMIT
      ? exactString(
          env.RENDER_GIT_COMMIT,
          TARGET_COMMIT,
          "generic_work_core_join_signer_live_commit_invalid",
        )
      : null;
    targetCommit = exactString(
      env.GENERIC_WORK_CORE_JOIN_SIGNER_TARGET_COMMIT || liveCommit,
      TARGET_COMMIT,
      "generic_work_core_join_signer_target_commit_invalid",
    );
    if (liveCommit && targetCommit !== liveCommit) {
      fail("generic_work_core_join_signer_target_commit_mismatch");
    }
    token = serviceToken(env.GENERIC_WORK_CORE_JOIN_SIGNER_SERVICE_TOKEN);
    signingKey = privateKey(env.GENERIC_WORK_CORE_JOIN_SIGNER_PRIVATE_KEY);
  } catch (error) {
    configurationError = String(error?.code || error?.message || "generic_work_core_join_signer_configuration_invalid");
    token = null;
    signingKey = null;
  }

  function health({ worker_enabled, worker_ready, emergency_stop } = {}) {
    const ready = worker_enabled === true
      && worker_ready === true
      && emergency_stop !== true
      && configurationError === null
      && signingKey !== null;
    const state = !worker_enabled
      ? "worker_disabled"
      : emergency_stop
        ? "emergency_stopped"
        : !worker_ready
          ? "worker_unavailable"
          : configurationError
            ? "configuration_invalid"
            : "ready";
    return Object.freeze({
      configured: configurationError === null,
      ready,
      state,
      route: GENERIC_WORK_CORE_JOIN_SIGN_ROUTE,
      service,
      purpose,
      key_id: keyId,
      target_commit: targetCommit,
      signature_algorithm: "ed25519",
      configuration_error: configurationError,
    });
  }

  function handle(req, res, gates) {
    const status = health(gates);
    if (configurationError !== null || token === null || signingKey === null) {
      return send(res, 503, { error: "signer_unavailable" });
    }
    if (!bearerAuthorized(req.get("authorization"), token)) {
      return send(res, 401, { error: "unauthorized" });
    }
    if (!status.ready) return send(res, 503, { error: "signer_unavailable" });
    let request;
    try {
      request = exactRequest(req.body);
      if (request.service !== service
          || request.target_commit !== targetCommit
          || request.purpose !== purpose
          || request.key_id !== keyId) {
        fail("generic_work_core_join_sign_request_invalid");
      }
    } catch {
      return send(res, 400, { error: "invalid_request" });
    }
    try {
      const signature = crypto.sign(null, signaturePayload(request.digest), signingKey).toString("base64url");
      return send(res, 200, {
        schema_version: GENERIC_WORK_CORE_JOIN_SIGN_RESPONSE_SCHEMA_VERSION,
        service,
        target_commit: targetCommit,
        purpose,
        key_id: keyId,
        digest: request.digest,
        signature_algorithm: "ed25519",
        signature,
      });
    } catch {
      return send(res, 503, { error: "signer_unavailable" });
    }
  }

  return Object.freeze({ handle, health });
}

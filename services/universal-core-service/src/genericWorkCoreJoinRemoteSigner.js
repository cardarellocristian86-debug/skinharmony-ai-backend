import crypto from "node:crypto";

import {
  decodeGenericWorkCoreJoinEd25519Signature,
  genericWorkCoreJoinSignaturePayload,
  genericWorkCoreJoinSignerInfrastructureCode,
} from "./genericWorkCoreJoin.js";

export const GENERIC_WORK_CORE_JOIN_SIGN_REQUEST_SCHEMA_VERSION = "generic_work_core_join_sign_request_v1";
export const GENERIC_WORK_CORE_JOIN_SIGN_RESPONSE_SCHEMA_VERSION = "generic_work_core_join_sign_response_v1";

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SERVICE = /^[a-z][a-z0-9._-]{2,63}$/;
const PURPOSE = /^[a-z][a-z0-9._:-]{2,127}$/;
const TARGET_COMMIT = /^[a-f0-9]{40}$/;
const PATH = /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@-]+\/?){1,24}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 1_500;
const MIN_RESPONSE_BYTES = 512;
const MAX_RESPONSE_BYTES = 16_384;
const DEFAULT_RESPONSE_BYTES = 4_096;
const RESPONSE_FIELDS = [
  "digest",
  "key_id",
  "purpose",
  "schema_version",
  "service",
  "signature",
  "signature_algorithm",
  "target_commit",
];

function fail(code) {
  throw new Error(code);
}

function plainRecord(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, fields, code) {
  if (!plainRecord(value) || Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")) fail(code);
}

function exactString(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}

function boundedInteger(value, fallback, minimum, maximum, code) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) fail(code);
  return resolved;
}

function normalizeOrigin(value) {
  const raw = String(value || "");
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || !["", "/"].includes(parsed.pathname)
      || parsed.origin !== raw
    ) fail("generic_work_core_join_signer_origin_invalid");
    return parsed.origin;
  } catch (error) {
    if (error?.message === "generic_work_core_join_signer_origin_invalid") throw error;
    fail("generic_work_core_join_signer_origin_invalid");
  }
}

function normalizePath(value, origin) {
  const raw = String(value || "");
  if (!PATH.test(raw) || raw.includes("//") || /\/(?:\.|\.\.)(?:\/|$)/.test(raw)) {
    fail("generic_work_core_join_signer_path_invalid");
  }
  try {
    const parsed = new URL(raw, `${origin}/`);
    if (parsed.origin !== origin || parsed.pathname !== raw || parsed.search || parsed.hash) {
      fail("generic_work_core_join_signer_path_invalid");
    }
    return Object.freeze({ path: raw, endpoint: `${origin}${raw}` });
  } catch (error) {
    if (error?.message === "generic_work_core_join_signer_path_invalid") throw error;
    fail("generic_work_core_join_signer_path_invalid");
  }
}

function explicitPublicKey(value, code = "generic_work_core_join_signer_public_key_invalid") {
  try {
    let key;
    if (value instanceof crypto.KeyObject) {
      if (value.type !== "public") fail(code);
      key = value;
    } else if (typeof value === "string") {
      const pem = value.trim();
      if (!/^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+\r?\n-----END PUBLIC KEY-----$/.test(pem)) fail(code);
      key = crypto.createPublicKey(pem);
    } else {
      fail(code);
    }
    if (key.asymmetricKeyType !== "ed25519") fail(code);
    return key;
  } catch (error) {
    if (error?.message === code) throw error;
    fail(code);
  }
}

function publicKeyFingerprint(key) {
  return crypto.createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

function decodeCanonicalBase64Url(value, expectedBytes, code) {
  if (typeof value !== "string" || !BASE64URL.test(value)) fail(code);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== expectedBytes || bytes.toString("base64url") !== value) fail(code);
  return bytes;
}

function validatePublicJwk(value, keyId, code) {
  exact(value, ["alg", "crv", "kid", "kty", "use", "x"], code);
  exactString(value.kid, ID, code);
  if ((keyId !== null && value.kid !== keyId) || value.alg !== "EdDSA" || value.crv !== "Ed25519" || value.kty !== "OKP" || value.use !== "sig") fail(code);
  decodeCanonicalBase64Url(value.x, 32, code);
  return value;
}

function publicKeyFromJwk(value, code) {
  try {
    const key = crypto.createPublicKey({ key: value, format: "jwk" });
    if (key.asymmetricKeyType !== "ed25519" || key.type !== "public") fail(code);
    return key;
  } catch (error) {
    if (error?.message === code) throw error;
    fail(code);
  }
}

function parseInlineJwks(value, keyId) {
  let parsed = value;
  if (typeof value === "string") {
    if (!value || Buffer.byteLength(value, "utf8") > MAX_RESPONSE_BYTES) {
      fail("generic_work_core_join_signer_jwks_invalid");
    }
    try {
      parsed = JSON.parse(value);
    } catch {
      fail("generic_work_core_join_signer_jwks_invalid");
    }
  }
  exact(parsed, ["keys"], "generic_work_core_join_signer_jwks_invalid");
  if (!Array.isArray(parsed.keys) || parsed.keys.length < 1 || parsed.keys.length > 16) {
    fail("generic_work_core_join_signer_jwks_invalid");
  }
  for (const candidate of parsed.keys) {
    validatePublicJwk(candidate, null, "generic_work_core_join_signer_jwks_invalid");
  }
  const matches = parsed.keys.filter((candidate) => candidate.kid === keyId);
  if (matches.length !== 1) fail("generic_work_core_join_signer_jwks_invalid");
  const jwk = matches[0];
  return publicKeyFromJwk(jwk, "generic_work_core_join_signer_jwks_invalid");
}

function resolvePinnedPublicKey({ publicKey: inlinePublicKey, jwks, keyId }) {
  const hasPublicKey = inlinePublicKey !== undefined && inlinePublicKey !== null && inlinePublicKey !== "";
  const hasJwks = jwks !== undefined && jwks !== null && jwks !== "";
  if (hasPublicKey === hasJwks) fail("generic_work_core_join_signer_pinned_key_required");
  if (!hasPublicKey) return parseInlineJwks(jwks, keyId);
  if (typeof inlinePublicKey === "string" && inlinePublicKey.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(inlinePublicKey);
    } catch {
      fail("generic_work_core_join_signer_public_key_invalid");
    }
    return publicKeyFromJwk(
      validatePublicJwk(parsed, keyId, "generic_work_core_join_signer_public_key_invalid"),
      "generic_work_core_join_signer_public_key_invalid",
    );
  }
  if (plainRecord(inlinePublicKey)) {
    return publicKeyFromJwk(validatePublicJwk(inlinePublicKey, keyId, "generic_work_core_join_signer_public_key_invalid"), "generic_work_core_join_signer_public_key_invalid");
  }
  return explicitPublicKey(inlinePublicKey);
}

function contentType(headers) {
  return String(headers?.get?.("content-type") || headers?.["content-type"] || "").trim().toLowerCase();
}

function contentLength(headers) {
  const raw = String(headers?.get?.("content-length") || headers?.["content-length"] || "").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) fail("generic_work_core_join_signer_response_invalid");
  const length = Number(raw);
  if (!Number.isSafeInteger(length)) fail("generic_work_core_join_signer_response_invalid");
  return length;
}

async function boundedResponseBody(response, maximumBytes) {
  const declared = contentLength(response.headers);
  if (declared !== null && declared > maximumBytes) fail("generic_work_core_join_signer_response_too_large");
  const reader = response.body?.getReader?.();
  if (!reader) fail("generic_work_core_join_signer_response_invalid");
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      const bytes = item.value instanceof Uint8Array ? item.value : new Uint8Array(item.value || []);
      length += bytes.byteLength;
      if (length > maximumBytes) {
        await reader.cancel?.();
        fail("generic_work_core_join_signer_response_too_large");
      }
      chunks.push(Buffer.from(bytes));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

function knownSignerError(error) {
  return genericWorkCoreJoinSignerInfrastructureCode(error);
}

function responseState(code) {
  return /(?:_mismatch|_invalid|_too_large|_redirect_denied)$/.test(code) ? "rejected" : "unavailable";
}

/**
 * Strict outbound signer client. Configuration is operator-owned and fixed at
 * construction time; caller input supplies only the already-computed digest.
 */
export function createGenericWorkCoreJoinRemoteSigner({
  origin,
  path,
  service,
  targetCommit,
  purpose,
  keyId,
  serviceToken,
  publicKey: inlinePublicKey,
  jwks,
  fetchImpl = globalThis.fetch,
  timeoutMs,
  maxResponseBytes,
} = {}) {
  const resolvedOrigin = normalizeOrigin(origin);
  const resolvedPath = normalizePath(path, resolvedOrigin);
  const resolvedService = exactString(service, SERVICE, "generic_work_core_join_signer_service_invalid");
  const resolvedTargetCommit = exactString(targetCommit, TARGET_COMMIT, "generic_work_core_join_signer_target_commit_invalid");
  const resolvedPurpose = exactString(purpose, PURPOSE, "generic_work_core_join_signer_purpose_invalid");
  const resolvedKeyId = exactString(keyId, ID, "generic_work_core_join_signer_key_id_invalid");
  if (typeof serviceToken !== "string" || serviceToken.length < 16 || serviceToken.length > 4_096 || serviceToken !== serviceToken.trim() || /[\u0000-\u001f\u007f]/.test(serviceToken)) {
    fail("generic_work_core_join_signer_service_token_required");
  }
  if (typeof fetchImpl !== "function") fail("generic_work_core_join_signer_transport_unavailable");
  const boundedTimeout = boundedInteger(timeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, "generic_work_core_join_signer_timeout_invalid");
  const boundedBytes = boundedInteger(maxResponseBytes, DEFAULT_RESPONSE_BYTES, MIN_RESPONSE_BYTES, MAX_RESPONSE_BYTES, "generic_work_core_join_signer_response_limit_invalid");
  const pinnedPublicKey = resolvePinnedPublicKey({ publicKey: inlinePublicKey, jwks, keyId: resolvedKeyId });
  const fingerprint = publicKeyFingerprint(pinnedPublicKey);
  let signerState = "configured";
  let signerReason = null;
  let operationSequence = 0;

  async function signDigest(value) {
    const digest = exactString(value, SHA256, "generic_work_core_join_signer_digest_invalid");
    const operationId = ++operationSequence;
    const request = {
      schema_version: GENERIC_WORK_CORE_JOIN_SIGN_REQUEST_SCHEMA_VERSION,
      service: resolvedService,
      target_commit: resolvedTargetCommit,
      purpose: resolvedPurpose,
      key_id: resolvedKeyId,
      digest,
    };
    const controller = new AbortController();
    let timer;
    const operation = (async () => {
      const response = await fetchImpl(resolvedPath.endpoint, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${serviceToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      if (!response || typeof response.status !== "number") fail("generic_work_core_join_signer_unavailable");
      if (response.redirected === true || (response.status >= 300 && response.status < 400)) {
        fail("generic_work_core_join_signer_redirect_denied");
      }
      if (response.url && response.url !== resolvedPath.endpoint) fail("generic_work_core_join_signer_redirect_denied");
      if (response.ok !== true) fail("generic_work_core_join_signer_unavailable");
      if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(contentType(response.headers))) {
        fail("generic_work_core_join_signer_response_invalid");
      }
      const raw = await boundedResponseBody(response, boundedBytes);
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        fail("generic_work_core_join_signer_response_invalid");
      }
      exact(data, RESPONSE_FIELDS, "generic_work_core_join_signer_response_invalid");
      if (data.schema_version !== GENERIC_WORK_CORE_JOIN_SIGN_RESPONSE_SCHEMA_VERSION || data.signature_algorithm !== "ed25519") {
        fail("generic_work_core_join_signer_response_invalid");
      }
      if (data.service !== resolvedService) fail("generic_work_core_join_signer_service_mismatch");
      if (data.target_commit !== resolvedTargetCommit) fail("generic_work_core_join_signer_target_commit_mismatch");
      if (data.purpose !== resolvedPurpose) fail("generic_work_core_join_signer_purpose_mismatch");
      if (data.key_id !== resolvedKeyId) fail("generic_work_core_join_signer_key_id_mismatch");
      if (data.digest !== digest) fail("generic_work_core_join_signer_digest_mismatch");
      const signature = decodeGenericWorkCoreJoinEd25519Signature(data.signature, "generic_work_core_join_signer_signature_invalid");
      if (!crypto.verify(null, genericWorkCoreJoinSignaturePayload(digest), pinnedPublicKey, signature)) {
        fail("generic_work_core_join_signer_signature_invalid");
      }
      return data.signature;
    })();
    // The deadline can win even if an injected transport ignores AbortSignal.
    // Retain a rejection handler on the losing operation so a late transport
    // failure cannot become an unhandled rejection.
    void operation.catch(() => {});
    const deadline = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("generic_work_core_join_signer_timeout"));
      }, boundedTimeout);
    });
    try {
      const signature = await Promise.race([operation, deadline]);
      if (operationId === operationSequence) {
        signerState = "ready";
        signerReason = null;
      }
      return signature;
    } catch (error) {
      const code = controller.signal.aborted
        ? "generic_work_core_join_signer_timeout"
        : knownSignerError(error) || "generic_work_core_join_signer_unavailable";
      if (operationId === operationSequence) {
        signerState = responseState(code);
        signerReason = code;
      }
      fail(code);
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    algorithm: "Ed25519",
    key_id: resolvedKeyId,
    public_key: pinnedPublicKey,
    public_key_fingerprint: fingerprint,
    custody: "external_remote_signer",
    signDigest,
    health() {
      return Object.freeze({
        signer_state: signerState,
        reason: signerReason,
        custody: "external_remote_signer",
      });
    },
  });
}

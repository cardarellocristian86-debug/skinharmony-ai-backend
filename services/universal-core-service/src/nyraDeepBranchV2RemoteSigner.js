import crypto from "node:crypto";

import { nyraDeepV2CanonicalJson } from "./nyraDeepV2EvidenceLedger.js";

export const NYRA_DEEP_V2_SIGN_REQUEST_SCHEMA_VERSION = "nyra_deep_branch_v2_sign_request_v1";
export const NYRA_DEEP_V2_SIGN_RESPONSE_SCHEMA_VERSION = "nyra_deep_branch_v2_sign_response_v1";
export const NYRA_DEEP_V2_SIGN_PURPOSE = "nyra_deep_branch_v2_operational_attestation";
export const NYRA_DEEP_V2_REMOTE_SIGNER_PATH = "/v1/nyra-deep-v2/sign-operational-attestation";
export const NYRA_DEEP_V2_REMOTE_SIGNER_JWKS_PATH = "/.well-known/nyra-deep-v2-core-attestation-jwks.json";

const OPERATIONAL_SCHEMA_VERSION = "nyra_deep_branch_v2_operational_attestation_v1";
const DEFAULT_TIMEOUT_MS = 2_500;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 393_216;
const MIN_RESPONSE_BYTES = 4_096;
const MAX_RESPONSE_BYTES = 393_216;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SERVICE_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,255}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{80,128}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeOrigin(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    return new URL(text.includes("://") ? text : `http://${text}`).origin;
  } catch {
    return "";
  }
}

function normalizeSignerUrl(rawUrl, rawAllowedOrigin, expectedService) {
  const input = String(rawUrl || "").trim();
  const allowedOrigin = normalizeOrigin(rawAllowedOrigin);
  if (!input || !allowedOrigin || !SERVICE_PATTERN.test(expectedService)) return "";
  try {
    const candidate = input.includes("://")
      ? input
      : `http://${input}${input.includes("/") ? "" : NYRA_DEEP_V2_REMOTE_SIGNER_PATH}`;
    const url = new URL(candidate);
    if (
      url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname !== NYRA_DEEP_V2_REMOTE_SIGNER_PATH
      || url.origin !== allowedOrigin
    ) return "";
    const privateHost = url.hostname === expectedService && Boolean(url.port);
    if (!privateHost || url.protocol !== "http:") return "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizeJwksUrl(rawUrl, signerUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    const signer = new URL(signerUrl);
    const candidate = value.includes("://")
      ? value
      : `http://${value}${value.includes("/") ? "" : NYRA_DEEP_V2_REMOTE_SIGNER_JWKS_PATH}`;
    const url = new URL(candidate);
    if (
      url.origin !== signer.origin
      || url.pathname !== NYRA_DEEP_V2_REMOTE_SIGNER_JWKS_PATH
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return "";
    return url.href;
  } catch {
    return "";
  }
}

function publicKeyFromJwks(raw, keyId) {
  let jwks = raw;
  if (typeof raw === "string") {
    try { jwks = JSON.parse(raw); } catch { return null; }
  }
  if (!exactKeys(jwks, new Set(["keys"])) || !Array.isArray(jwks.keys)) return null;
  const matches = jwks.keys.filter((item) => (
    isPlainObject(item)
    && item.kid === keyId
    && item.kty === "OKP"
    && item.crv === "Ed25519"
    && typeof item.x === "string"
    && (!item.use || item.use === "sig")
    && (!item.alg || item.alg === "EdDSA")
    && !Object.hasOwn(item, "d")
  ));
  if (matches.length !== 1) return null;
  try {
    const publicKey = crypto.createPublicKey({ key: matches[0], format: "jwk" });
    return publicKey.asymmetricKeyType === "ed25519" ? publicKey : null;
  } catch {
    return null;
  }
}

function unsignedOperationalAttestation(value) {
  if (!isPlainObject(value)) return null;
  const unsigned = clone(value);
  delete unsigned.signature;
  if (
    unsigned.schema_version !== OPERATIONAL_SCHEMA_VERSION
    || !KEY_ID_PATTERN.test(String(unsigned.key_id || ""))
    || Object.hasOwn(unsigned, "signature")
  ) return null;
  return unsigned;
}

function signingBytes(attestation) {
  return Buffer.from(
    `nyra-deep-branch-v2-operational-attestation\u0000${nyraDeepV2CanonicalJson(attestation)}`,
    "utf8",
  );
}

function verifySignature(publicKey, attestation) {
  const unsigned = unsignedOperationalAttestation(attestation);
  if (!unsigned || !SIGNATURE_PATTERN.test(String(attestation?.signature || ""))) return false;
  try {
    return crypto.verify(
      null,
      signingBytes(unsigned),
      publicKey,
      Buffer.from(attestation.signature, "base64url"),
    );
  } catch {
    return false;
  }
}

function knownReason(error) {
  const message = String(error?.message || "");
  return message.startsWith("nyra_deep_v2_remote_signer_") ? message : null;
}

function fail(reason) {
  throw new Error(reason);
}

async function readBoundedJson(response, maxBytes) {
  if (!response || response.ok !== true) fail("nyra_deep_v2_remote_signer_unavailable");
  const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) fail("nyra_deep_v2_remote_signer_response_invalid");
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    fail("nyra_deep_v2_remote_signer_response_too_large");
  }
  const reader = response.body?.getReader?.();
  if (!reader) fail("nyra_deep_v2_remote_signer_response_invalid");
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      const bytes = part.value instanceof Uint8Array
        ? part.value
        : new Uint8Array(part.value || []);
      total += bytes.byteLength;
      if (total > maxBytes) fail("nyra_deep_v2_remote_signer_response_too_large");
      chunks.push(Buffer.from(bytes));
    }
  } finally {
    reader.releaseLock?.();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("nyra_deep_v2_remote_signer_response_invalid");
  }
}

export function remoteSignerConfig(env = process.env) {
  const expectedService = String(
    env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_EXPECTED_SERVICE || "",
  ).trim().toLowerCase();
  const targetCommit = String(
    env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_TARGET_COMMIT || "",
  ).trim().toLowerCase();
  const keyId = String(
    env.CORE_NYRA_DEEP_BRANCH_V2_ATTESTATION_KEY_ID || "universal-core-nyra-v2",
  ).trim();
  const url = normalizeSignerUrl(
    env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_URL,
    env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_ALLOWED_ORIGIN,
    expectedService,
  );
  const jwks = String(
    env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_PUBLIC_JWKS || "",
  ).trim();
  const jwksUrl = normalizeJwksUrl(
    env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_PUBLIC_JWKS_URL,
    url,
  );
  const bearerToken = String(
    env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_BEARER_TOKEN || "",
  ).trim();
  const requested = Boolean(
    env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_URL
    || env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_ALLOWED_ORIGIN
    || env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_BEARER_TOKEN
    || env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_PUBLIC_JWKS
    || env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_PUBLIC_JWKS_URL
    || env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_EXPECTED_SERVICE
    || env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_TARGET_COMMIT
  );
  const inlinePublicKey = jwks ? publicKeyFromJwks(jwks, keyId) : null;
  return Object.freeze({
    requested,
    configured: Boolean(
      requested
      && url
      && bearerToken.length >= 32
      && COMMIT_PATTERN.test(targetCommit)
      && SERVICE_PATTERN.test(expectedService)
      && KEY_ID_PATTERN.test(keyId)
      && (inlinePublicKey || jwksUrl)
    ),
    url,
    jwks_url: jwksUrl,
    expected_service: expectedService || null,
    target_commit: targetCommit || null,
    key_id: keyId,
    timeout_ms: boundedInteger(
      env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    max_response_bytes: boundedInteger(
      env.CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_MAX_RESPONSE_BYTES,
      DEFAULT_MAX_RESPONSE_BYTES,
      MIN_RESPONSE_BYTES,
      MAX_RESPONSE_BYTES,
    ),
    bearer_token: bearerToken,
    inline_public_key: inlinePublicKey,
  });
}

export function createNyraDeepBranchV2RemoteSigner({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const config = remoteSignerConfig(env);
  let cachedPublicKey = config.inline_public_key;

  async function fetchJson(url, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeout_ms);
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
        redirect: "error",
      });
      return await readBoundedJson(response, config.max_response_bytes);
    } catch (error) {
      const reason = knownReason(error);
      if (reason) throw error;
      if (controller.signal.aborted || error?.name === "AbortError") {
        fail("nyra_deep_v2_remote_signer_timeout");
      }
      fail("nyra_deep_v2_remote_signer_unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function resolvePublicKey() {
    if (cachedPublicKey) return cachedPublicKey;
    if (!config.jwks_url) fail("nyra_deep_v2_remote_signer_public_key_unavailable");
    const jwks = await fetchJson(config.jwks_url, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const publicKey = publicKeyFromJwks(jwks, config.key_id);
    if (!publicKey) fail("nyra_deep_v2_remote_signer_jwks_invalid");
    cachedPublicKey = publicKey;
    return cachedPublicKey;
  }

  async function signOperational({ attestation } = {}) {
    if (!config.configured) {
      return { ok: false, reason: "nyra_deep_v2_remote_signer_configuration_invalid" };
    }
    const unsigned = unsignedOperationalAttestation(attestation);
    if (!unsigned || unsigned.key_id !== config.key_id) {
      return { ok: false, reason: "nyra_deep_v2_remote_signer_request_invalid" };
    }
    const request = {
      schema_version: NYRA_DEEP_V2_SIGN_REQUEST_SCHEMA_VERSION,
      purpose: NYRA_DEEP_V2_SIGN_PURPOSE,
      target_commit: config.target_commit,
      attestation: unsigned,
    };
    try {
      const response = await fetchJson(config.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.bearer_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      });
      if (!exactKeys(response, new Set([
        "schema_version",
        "purpose",
        "target_commit",
        "key_id",
        "attestation",
      ]))) return { ok: false, reason: "nyra_deep_v2_remote_signer_response_schema_invalid" };
      if (
        response.schema_version !== NYRA_DEEP_V2_SIGN_RESPONSE_SCHEMA_VERSION
        || response.purpose !== NYRA_DEEP_V2_SIGN_PURPOSE
        || response.target_commit !== config.target_commit
        || response.key_id !== config.key_id
      ) return { ok: false, reason: "nyra_deep_v2_remote_signer_response_binding_invalid" };
      const signed = response.attestation;
      const returnedUnsigned = unsignedOperationalAttestation(signed);
      if (
        !returnedUnsigned
        || nyraDeepV2CanonicalJson(returnedUnsigned) !== nyraDeepV2CanonicalJson(unsigned)
      ) return { ok: false, reason: "nyra_deep_v2_remote_signer_attestation_tampered" };
      const publicKey = await resolvePublicKey();
      if (!verifySignature(publicKey, signed)) {
        return { ok: false, reason: "nyra_deep_v2_remote_signer_signature_invalid" };
      }
      return { ok: true, attestation: clone(signed) };
    } catch (error) {
      return {
        ok: false,
        reason: knownReason(error) || "nyra_deep_v2_remote_signer_unavailable",
      };
    }
  }

  function verifyOperationalSignature(attestation) {
    return Boolean(cachedPublicKey && verifySignature(cachedPublicKey, attestation));
  }

  function status() {
    return {
      requested: config.requested,
      configured: config.configured,
      transport: config.url ? new URL(config.url).protocol.replace(":", "") : null,
      expected_service: config.expected_service,
      target_commit: config.target_commit,
      key_id: config.key_id,
      public_key_ready: Boolean(cachedPublicKey),
    };
  }

  return Object.freeze({
    configured: config.configured,
    key_id: config.key_id,
    resolvePublicKey,
    signOperational,
    status,
    verifyOperationalSignature,
  });
}

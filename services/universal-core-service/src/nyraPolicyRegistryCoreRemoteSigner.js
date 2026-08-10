import crypto from "node:crypto";

export const POLICY_REGISTRY_SIGN_REQUEST_SCHEMA = "nyra_policy_registry_sign_request_v1";
export const POLICY_REGISTRY_SIGN_RESPONSE_SCHEMA = "nyra_policy_registry_sign_response_v1";

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SERVICE = /^[a-z][a-z0-9._-]{2,63}$/;
const TARGET_COMMIT = /^[a-f0-9]{40}$/;
const PATH = /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@-]+\/?){1,24}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const PURPOSES = new Set([
  "nyra-policy-activation-attestation-v2",
  "core-policy-activation-receipt-v2",
  "nyra-policy-registry-core-signer-probe-v1",
]);
const RESPONSE_FIELDS = Object.freeze([
  "schema_version", "service", "target_commit", "purpose", "key_id", "digest",
  "signature_algorithm", "signature",
]);
const KNOWN_ERRORS = new Set([
  "policy_registry_core_signer_busy",
  "policy_registry_core_signer_digest_mismatch",
  "policy_registry_core_signer_key_id_mismatch",
  "policy_registry_core_signer_payload_invalid",
  "policy_registry_core_signer_purpose_invalid",
  "policy_registry_core_signer_purpose_mismatch",
  "policy_registry_core_signer_redirect_denied",
  "policy_registry_core_signer_response_invalid",
  "policy_registry_core_signer_response_too_large",
  "policy_registry_core_signer_service_mismatch",
  "policy_registry_core_signer_signature_invalid",
  "policy_registry_core_signer_target_commit_mismatch",
  "policy_registry_core_signer_timeout",
  "policy_registry_core_signer_unavailable",
]);

function fail(code) {
  throw new Error(code);
}

function plainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, fields, code) {
  if (!plainRecord(value) || Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")) fail(code);
}

function exactText(value, pattern, code) {
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
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search ||
      parsed.hash || !["", "/"].includes(parsed.pathname) || parsed.origin !== raw) {
      fail("policy_registry_core_signer_origin_invalid");
    }
    return parsed.origin;
  } catch (error) {
    if (error?.message === "policy_registry_core_signer_origin_invalid") throw error;
    fail("policy_registry_core_signer_origin_invalid");
  }
}

function normalizePath(value, origin) {
  const raw = String(value || "");
  if (!PATH.test(raw) || raw.includes("//") || /\/(?:\.|\.\.)(?:\/|$)/.test(raw)) {
    fail("policy_registry_core_signer_path_invalid");
  }
  const parsed = new URL(raw, `${origin}/`);
  if (parsed.origin !== origin || parsed.pathname !== raw || parsed.search || parsed.hash) {
    fail("policy_registry_core_signer_path_invalid");
  }
  return { path: raw, endpoint: `${origin}${raw}` };
}

function decodeCanonicalBase64url(value, length, code) {
  if (typeof value !== "string" || !BASE64URL.test(value)) fail(code);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== length || decoded.toString("base64url") !== value) fail(code);
  return decoded;
}

function publicOnlyEd25519(value, keyId) {
  const code = "policy_registry_core_signer_public_key_invalid";
  try {
    let key;
    if (value instanceof crypto.KeyObject) {
      if (value.type !== "public") fail(code);
      key = value;
    } else if (plainRecord(value) || (typeof value === "string" && value.startsWith("{"))) {
      const jwk = typeof value === "string" ? JSON.parse(value) : value;
      exact(jwk, ["alg", "crv", "kid", "kty", "use", "x"], code);
      if (jwk.alg !== "EdDSA" || jwk.crv !== "Ed25519" || jwk.kty !== "OKP" ||
        jwk.use !== "sig" || jwk.kid !== keyId) fail(code);
      decodeCanonicalBase64url(jwk.x, 32, code);
      key = crypto.createPublicKey({ key: jwk, format: "jwk" });
    } else if (typeof value === "string") {
      const pem = value.replaceAll("\\n", "\n").replaceAll("\\r", "\r").trim();
      if (!/^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+\r?\n-----END PUBLIC KEY-----$/.test(pem) ||
        pem.includes("PRIVATE KEY")) fail(code);
      key = crypto.createPublicKey(pem);
    } else {
      fail(code);
    }
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") fail(code);
    return key;
  } catch (error) {
    if (error?.message === code) throw error;
    fail(code);
  }
}

function fingerprint(key) {
  return crypto.createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

function safeError(error) {
  const code = String(error?.message || "");
  return KNOWN_ERRORS.has(code) ? code : "policy_registry_core_signer_unavailable";
}

function header(headers, name) {
  return String(headers?.get?.(name) || headers?.[name] || "").trim();
}

async function boundedBody(response, maximumBytes) {
  const declared = header(response.headers, "content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    fail(/^\d+$/.test(declared)
      ? "policy_registry_core_signer_response_too_large"
      : "policy_registry_core_signer_response_invalid");
  }
  const reader = response.body?.getReader?.();
  if (!reader) fail("policy_registry_core_signer_response_invalid");
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
        fail("policy_registry_core_signer_response_too_large");
      }
      chunks.push(Buffer.from(bytes));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

export function createNyraPolicyRegistryCoreRemoteSigner({
  origin,
  path,
  service,
  targetCommit,
  keyId,
  serviceToken,
  publicKey,
  fetchImpl = globalThis.fetch,
  timeoutMs,
  maxResponseBytes,
  probeCooldownMs,
  now = () => Date.now(),
} = {}) {
  const resolvedOrigin = normalizeOrigin(origin);
  const resolvedPath = normalizePath(path, resolvedOrigin);
  const resolvedService = exactText(service, SERVICE, "policy_registry_core_signer_service_invalid");
  const resolvedTargetCommit = exactText(targetCommit, TARGET_COMMIT, "policy_registry_core_signer_target_commit_invalid");
  const resolvedKeyId = exactText(keyId, ID, "policy_registry_core_signer_key_id_invalid");
  if (typeof serviceToken !== "string" || serviceToken.length < 16 || serviceToken.length > 4_096 ||
    serviceToken !== serviceToken.trim() || /[\u0000-\u001f\u007f]/.test(serviceToken)) {
    fail("policy_registry_core_signer_service_token_required");
  }
  if (typeof fetchImpl !== "function") fail("policy_registry_core_signer_transport_unavailable");
  const boundedTimeout = boundedInteger(timeoutMs, 1_500, 100, 5_000,
    "policy_registry_core_signer_timeout_invalid");
  const boundedBytes = boundedInteger(maxResponseBytes, 4_096, 512, 16_384,
    "policy_registry_core_signer_response_limit_invalid");
  const cooldownMs = boundedInteger(probeCooldownMs, 5_000, 100, 60_000,
    "policy_registry_core_signer_probe_cooldown_invalid");
  const pinnedPublicKey = publicOnlyEd25519(publicKey, resolvedKeyId);
  const publicKeyFingerprint = fingerprint(pinnedPublicKey);
  let signerState = "configured";
  let signerReason = null;
  let underlyingInFlight = null;
  let probeInFlight = null;
  let probeAttempts = 0;
  let cooldownUntil = Number.NEGATIVE_INFINITY;

  async function signPayload(payload, purpose) {
    if (!Buffer.isBuffer(payload) || payload.length < 1 || payload.length > 262_144) {
      fail("policy_registry_core_signer_payload_invalid");
    }
    if (!PURPOSES.has(purpose)) fail("policy_registry_core_signer_purpose_invalid");
    if (underlyingInFlight) fail("policy_registry_core_signer_busy");
    const digest = crypto.createHash("sha256").update(payload).digest("hex");
    const request = {
      schema_version: POLICY_REGISTRY_SIGN_REQUEST_SCHEMA,
      service: resolvedService,
      target_commit: resolvedTargetCommit,
      purpose,
      key_id: resolvedKeyId,
      digest,
      payload: payload.toString("base64url"),
    };
    const controller = new AbortController();
    let timer;
    let deadlineWon = false;
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
      if (!response || typeof response.status !== "number" || response.ok !== true) {
        fail("policy_registry_core_signer_unavailable");
      }
      if (response.redirected === true || (response.status >= 300 && response.status < 400) ||
        (response.url && response.url !== resolvedPath.endpoint)) {
        fail("policy_registry_core_signer_redirect_denied");
      }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header(response.headers, "content-type"))) {
        fail("policy_registry_core_signer_response_invalid");
      }
      const raw = await boundedBody(response, boundedBytes);
      let data;
      try { data = JSON.parse(raw); } catch { fail("policy_registry_core_signer_response_invalid"); }
      exact(data, RESPONSE_FIELDS, "policy_registry_core_signer_response_invalid");
      if (data.schema_version !== POLICY_REGISTRY_SIGN_RESPONSE_SCHEMA || data.signature_algorithm !== "Ed25519") {
        fail("policy_registry_core_signer_response_invalid");
      }
      if (data.service !== resolvedService) fail("policy_registry_core_signer_service_mismatch");
      if (data.target_commit !== resolvedTargetCommit) fail("policy_registry_core_signer_target_commit_mismatch");
      if (data.purpose !== purpose) fail("policy_registry_core_signer_purpose_mismatch");
      if (data.key_id !== resolvedKeyId) fail("policy_registry_core_signer_key_id_mismatch");
      if (data.digest !== digest) fail("policy_registry_core_signer_digest_mismatch");
      const signature = decodeCanonicalBase64url(data.signature, 64,
        "policy_registry_core_signer_signature_invalid");
      if (!crypto.verify(null, payload, pinnedPublicKey, signature)) {
        fail("policy_registry_core_signer_signature_invalid");
      }
      return data.signature;
    })();
    underlyingInFlight = operation;
    void operation.then(
      () => {
        if (underlyingInFlight === operation) {
          underlyingInFlight = null;
          cooldownUntil = now() + cooldownMs;
        }
      },
      () => {
        if (underlyingInFlight === operation) {
          underlyingInFlight = null;
          cooldownUntil = now() + cooldownMs;
        }
      },
    );
    const deadline = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        deadlineWon = true;
        controller.abort();
        reject(new Error("policy_registry_core_signer_timeout"));
      }, boundedTimeout);
      timer.unref?.();
    });
    try {
      const signature = await Promise.race([operation, deadline]);
      signerState = "ready";
      signerReason = null;
      return signature;
    } catch (error) {
      const code = deadlineWon
        ? "policy_registry_core_signer_timeout"
        : safeError(error);
      signerState = /(?:mismatch|invalid|too_large|redirect_denied)$/.test(code)
        ? "rejected"
        : "unavailable";
      signerReason = code;
      fail(code);
    } finally {
      clearTimeout(timer);
    }
  }

  async function probe({ force = false } = {}) {
    if (probeInFlight) return probeInFlight;
    const timestamp = Number(now());
    if (!Number.isFinite(timestamp) || underlyingInFlight) {
      return false;
    }
    if (!force && timestamp < cooldownUntil) return signerState === "ready";
    probeAttempts += 1;
    const challenge = Buffer.from(`nyra-policy-registry-core-signer-probe-v1\0${JSON.stringify({
      key_id: resolvedKeyId,
      public_key_fingerprint: publicKeyFingerprint,
      nonce: crypto.randomBytes(24).toString("base64url"),
      issued_at: new Date(timestamp).toISOString(),
    })}`, "utf8");
    const current = signPayload(challenge, "nyra-policy-registry-core-signer-probe-v1")
      .then(() => true, () => false);
    probeInFlight = current;
    void Promise.allSettled([current, underlyingInFlight].filter(Boolean)).then(() => {
      if (probeInFlight === current) probeInFlight = null;
    });
    return current;
  }

  return Object.freeze({
    algorithm: "Ed25519",
    key_id: resolvedKeyId,
    public_key: pinnedPublicKey,
    public_key_fingerprint: publicKeyFingerprint,
    custody: "external_remote_signer",
    signPayload,
    probe,
    health() {
      return Object.freeze({
        signer_state: signerState,
        reason: signerReason,
        custody: "external_remote_signer",
        key_id: resolvedKeyId,
        public_key_fingerprint: publicKeyFingerprint,
        target_commit: resolvedTargetCommit,
        probe_attempts: probeAttempts,
        operation_in_flight: Boolean(underlyingInFlight),
      });
    },
  });
}

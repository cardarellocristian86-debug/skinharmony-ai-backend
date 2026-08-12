"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "nyra_policy_activation_attestation_v3";
const SIGNING_CONTEXT = "nyra-policy-activation-attestation-v3\0";
const SIGN_REQUEST_SCHEMA_VERSION = "nyra_policy_registry_sign_request_v1";
const SIGN_RESPONSE_SCHEMA_VERSION = "nyra_policy_registry_sign_response_v1";
const PROBE_CONTEXT = "nyra-policy-registry-signer-probe-v1\0";
const ACTIONS = new Set([
  "policy.snapshot.activate",
  "policy.snapshot.rollback",
]);
const ENVELOPE_FIELDS = Object.freeze([
  "schema_version", "tenant_id", "work_id", "preflight_id", "intent_digest",
  "operation_id", "action", "snapshot_digest", "compiler_provenance_digest", "domain_pack_id",
  "owner_approval_hash", "nonce", "issued_at", "expires_at", "core_key_id",
  "nyra_key_id", "core_public_key_fingerprint", "nyra_public_key_fingerprint",
]);
const SIGN_REQUEST_FIELDS = Object.freeze([
  "schema_version", "service", "target_commit", "purpose", "key_id", "digest", "payload",
]);
const SIGN_RESPONSE_FIELDS = Object.freeze([
  "schema_version", "service", "target_commit", "purpose", "key_id", "digest",
  "signature_algorithm", "signature",
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SERVICE = /^[a-z][a-z0-9._-]{2,63}$/;
const PURPOSE = /^[a-z][a-z0-9._:-]{2,127}$/;
const TARGET_COMMIT = /^[a-f0-9]{40}$/;
const SIGNER_PATH = /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@-]+\/?){1,24}$/;
const DEFAULT_SIGNER_TIMEOUT_MS = 1_500;
const DEFAULT_SIGNER_RESPONSE_BYTES = 4_096;
const DEFAULT_PROBE_COOLDOWN_MS = 5_000;

function fail(code) {
  throw new Error(code);
}

function plainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value, fields, code) {
  if (!plainRecord(value) || Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")) fail(code);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function payloadBytes(envelope) {
  return Buffer.from(`${SIGNING_CONTEXT}${canonicalJson(envelope)}`, "utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function decodeCanonicalBase64Url(value, expectedBytes, code) {
  if (typeof value !== "string" || !BASE64URL.test(value)) fail(code);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength !== expectedBytes || decoded.toString("base64url") !== value) fail(code);
  return decoded;
}

function signatureValid(publicKey, payload, signature) {
  try {
    return crypto.verify(null, payload, publicKey,
      decodeCanonicalBase64Url(signature, 64, "nyra_policy_attestation_signature_invalid"));
  } catch {
    return false;
  }
}

function parseAllowlist(value) {
  return String(value || "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function strictBoolean(value, name) {
  if (value === undefined || value === "") return { value: false, error: null };
  if (value === "true") return { value: true, error: null };
  if (value === "false") return { value: false, error: null };
  return { value: false, error: `nyra_policy_attestation_${name}_invalid` };
}

function boundedEnvInteger(value, fallback, minimum, maximum, code) {
  const raw = value === undefined || value === "" ? String(fallback) : String(value);
  if (!/^[0-9]+$/.test(raw)) fail(code);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail(code);
  return parsed;
}

function publicKeyFingerprint(key) {
  return sha256(key.export({ type: "spki", format: "der" }));
}

function publicOnlyEd25519(value, expectedKeyId, code) {
  try {
    let key;
    if (value instanceof crypto.KeyObject) {
      if (value.type !== "public") fail(code);
      key = value;
    } else if (plainRecord(value) || (typeof value === "string" && value.startsWith("{"))) {
      let jwk = value;
      if (typeof jwk === "string") jwk = JSON.parse(jwk);
      exactRecord(jwk, ["alg", "crv", "kid", "kty", "use", "x"], code);
      if (jwk.alg !== "EdDSA" || jwk.crv !== "Ed25519" || jwk.kty !== "OKP" || jwk.use !== "sig" ||
        jwk.kid !== expectedKeyId) fail(code);
      decodeCanonicalBase64Url(jwk.x, 32, code);
      key = crypto.createPublicKey({ key: jwk, format: "jwk" });
    } else if (typeof value === "string") {
      const pem = value.replaceAll("\\n", "\n").replaceAll("\\r", "\r").trim();
      if (!/^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+\r?\n-----END PUBLIC KEY-----$/.test(pem)) fail(code);
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

function normalizeOrigin(value) {
  const raw = String(value || "");
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash ||
      !["", "/"].includes(parsed.pathname) || parsed.origin !== raw) {
      fail("nyra_policy_signer_origin_invalid");
    }
    return parsed.origin;
  } catch (error) {
    if (error?.message === "nyra_policy_signer_origin_invalid") throw error;
    fail("nyra_policy_signer_origin_invalid");
  }
}

function normalizeSignerPath(value, origin) {
  const raw = String(value || "");
  if (!SIGNER_PATH.test(raw) || raw.includes("//") || /\/(?:\.|\.\.)(?:\/|$)/.test(raw)) {
    fail("nyra_policy_signer_path_invalid");
  }
  const parsed = new URL(raw, `${origin}/`);
  if (parsed.origin !== origin || parsed.pathname !== raw || parsed.search || parsed.hash) {
    fail("nyra_policy_signer_path_invalid");
  }
  return { path: raw, endpoint: `${origin}${raw}` };
}

function headerValue(headers, name) {
  return String(headers?.get?.(name) || headers?.[name] || "").trim();
}

async function boundedResponseBody(response, maximumBytes) {
  const lengthHeader = headerValue(response.headers, "content-length");
  if (lengthHeader) {
    if (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > maximumBytes) {
      fail(Number(lengthHeader) > maximumBytes
        ? "nyra_policy_signer_response_too_large"
        : "nyra_policy_signer_response_invalid");
    }
  }
  const reader = response.body?.getReader?.();
  if (!reader) fail("nyra_policy_signer_response_invalid");
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
        fail("nyra_policy_signer_response_too_large");
      }
      chunks.push(Buffer.from(bytes));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

function createNyraPolicyRegistryRemoteSigner({
  origin, path: signerPath, service, targetCommit, purpose, keyId, serviceToken,
  publicKey, fetchImpl = globalThis.fetch, timeoutMs, maxResponseBytes,
} = {}) {
  const resolvedOrigin = normalizeOrigin(origin);
  const resolvedPath = normalizeSignerPath(signerPath, resolvedOrigin);
  if (!SERVICE.test(String(service || ""))) fail("nyra_policy_signer_service_invalid");
  if (!TARGET_COMMIT.test(String(targetCommit || ""))) fail("nyra_policy_signer_target_commit_invalid");
  if (!PURPOSE.test(String(purpose || ""))) fail("nyra_policy_signer_purpose_invalid");
  if (!ID.test(String(keyId || ""))) fail("nyra_policy_signer_key_id_invalid");
  if (typeof serviceToken !== "string" || serviceToken.length < 16 || serviceToken.length > 4_096 ||
    serviceToken !== serviceToken.trim() || /[\u0000-\u001f\u007f]/.test(serviceToken)) {
    fail("nyra_policy_signer_service_token_required");
  }
  if (typeof fetchImpl !== "function") fail("nyra_policy_signer_transport_unavailable");
  const boundedTimeout = boundedEnvInteger(timeoutMs, DEFAULT_SIGNER_TIMEOUT_MS, 100, 5_000,
    "nyra_policy_signer_timeout_invalid");
  const boundedBytes = boundedEnvInteger(maxResponseBytes, DEFAULT_SIGNER_RESPONSE_BYTES, 512, 16_384,
    "nyra_policy_signer_response_limit_invalid");
  const pinnedPublicKey = publicOnlyEd25519(publicKey, keyId, "nyra_policy_signer_public_key_invalid");

  async function signPayload(payload) {
    if (!Buffer.isBuffer(payload) || payload.byteLength < 1 || payload.byteLength > 65_536) {
      fail("nyra_policy_signer_payload_invalid");
    }
    const digest = sha256(payload);
    const request = {
      schema_version: SIGN_REQUEST_SCHEMA_VERSION,
      service,
      target_commit: targetCommit,
      purpose,
      key_id: keyId,
      digest,
      payload: payload.toString("base64url"),
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
      if (!response || typeof response.status !== "number") fail("nyra_policy_signer_unavailable");
      if (response.redirected === true || (response.status >= 300 && response.status < 400) ||
        (response.url && response.url !== resolvedPath.endpoint)) fail("nyra_policy_signer_redirect_denied");
      if (response.ok !== true) fail("nyra_policy_signer_unavailable");
      if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(headerValue(response.headers, "content-type"))) {
        fail("nyra_policy_signer_response_invalid");
      }
      const raw = await boundedResponseBody(response, boundedBytes);
      let data;
      try { data = JSON.parse(raw); } catch { fail("nyra_policy_signer_response_invalid"); }
      exactRecord(data, SIGN_RESPONSE_FIELDS, "nyra_policy_signer_response_invalid");
      if (data.schema_version !== SIGN_RESPONSE_SCHEMA_VERSION || data.signature_algorithm !== "ed25519") {
        fail("nyra_policy_signer_response_invalid");
      }
      if (data.service !== service) fail("nyra_policy_signer_service_mismatch");
      if (data.target_commit !== targetCommit) fail("nyra_policy_signer_target_commit_mismatch");
      if (data.purpose !== purpose) fail("nyra_policy_signer_purpose_mismatch");
      if (data.key_id !== keyId) fail("nyra_policy_signer_key_id_mismatch");
      if (data.digest !== digest) fail("nyra_policy_signer_digest_mismatch");
      const signature = decodeCanonicalBase64Url(data.signature, 64, "nyra_policy_signer_signature_invalid");
      if (!crypto.verify(null, payload, pinnedPublicKey, signature)) fail("nyra_policy_signer_signature_invalid");
      return data.signature;
    })();
    void operation.catch(() => {});
    const deadline = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("nyra_policy_signer_timeout"));
      }, boundedTimeout);
    });
    try {
      return await Promise.race([operation, deadline]);
    } catch (error) {
      if (controller.signal.aborted) fail("nyra_policy_signer_timeout");
      const code = String(error?.message || "");
      if (/^nyra_policy_signer_(?:digest_mismatch|key_id_mismatch|purpose_mismatch|redirect_denied|response_invalid|response_too_large|service_mismatch|signature_invalid|target_commit_mismatch|unavailable)$/.test(code)) {
        fail(code);
      }
      fail("nyra_policy_signer_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    service,
    target_commit: targetCommit,
    purpose,
    key_id: keyId,
    public_key: pinnedPublicKey,
    public_key_fingerprint: publicKeyFingerprint(pinnedPublicKey),
    custody: "external_remote_signer",
    signPayload,
  });
}

function createNyraPolicyRegistryLocalTestSigner({ privateKey, keyId } = {}) {
  const key = privateKey instanceof crypto.KeyObject ? privateKey : crypto.createPrivateKey(privateKey);
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519" || !ID.test(String(keyId || ""))) {
    fail("nyra_policy_local_test_signer_invalid");
  }
  const publicKey = crypto.createPublicKey(key);
  return Object.freeze({
    key_id: keyId,
    public_key: publicKey,
    public_key_fingerprint: publicKeyFingerprint(publicKey),
    custody: "local_test_seam",
    signPayload: async (payload) => crypto.sign(null, payload, key).toString("base64url"),
  });
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createFileReplayStore(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  const lockPath = `${resolved}.lock`;
  function load() {
    if (!fs.existsSync(resolved)) return { schema_version: "nyra_policy_attestation_replay_v3", entries: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
      if (parsed?.schema_version === "nyra_policy_attestation_replay_v3" && plainRecord(parsed.entries)) return parsed;
    } catch { /* fail closed below */ }
    fail("nyra_policy_attestation_replay_store_invalid");
  }
  function withLock(callback) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    try { fs.mkdirSync(lockPath); }
    catch (error) {
      if (error?.code === "EEXIST") fail("nyra_policy_attestation_replay_store_busy");
      throw error;
    }
    try { return callback(); }
    finally { fs.rmdirSync(lockPath); }
  }
  function write(value) {
    const temporary = `${resolved}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, resolved);
  }
  return Object.freeze({
    kind: "file",
    restart_durable: true,
    distributed: false,
    async initialize() { load(); },
    async probe() {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.accessSync(path.dirname(resolved), fs.constants.R_OK | fs.constants.W_OK);
    },
    async lookup({ tenantId, nonce, envelopeDigest }) {
      const existing = load().entries[`${tenantId}:${nonce}`];
      if (!existing) return null;
      if (existing.envelope_digest !== envelopeDigest) fail("nyra_policy_attestation_nonce_reused");
      return clone(existing.response);
    },
    async record({ tenantId, nonce, envelopeDigest, expiresAt, response, now }) {
      return withLock(() => {
        const replay = load();
        const replayKey = `${tenantId}:${nonce}`;
        const existing = replay.entries[replayKey];
        if (existing) {
          if (existing.envelope_digest !== envelopeDigest) fail("nyra_policy_attestation_nonce_reused");
          return { response: clone(existing.response), idempotent_replay: true };
        }
        replay.entries[replayKey] = { envelope_digest: envelopeDigest, expires_at: expiresAt, response: clone(response) };
        for (const [key, value] of Object.entries(replay.entries)) {
          if (Date.parse(String(value.expires_at || "")) <= now) delete replay.entries[key];
        }
        write(replay);
        return { response: clone(response), idempotent_replay: false };
      });
    },
  });
}

function createPostgresReplayStore(pool) {
  if (!pool?.query) fail("nyra_policy_attestation_postgres_required");
  let schema = null;
  async function initialize() {
    if (!schema) {
      const attempt = (async () => {
        await pool.query(`CREATE TABLE IF NOT EXISTS nyra_policy_registry_attestation_replay (
          tenant_id TEXT NOT NULL,
          nonce TEXT NOT NULL,
          envelope_digest TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          response JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, nonce)
        )`);
        await pool.query(`CREATE INDEX IF NOT EXISTS nyra_policy_registry_attestation_replay_expiry_idx
          ON nyra_policy_registry_attestation_replay (expires_at)`);
      })();
      schema = attempt;
      try {
        await attempt;
      } catch (error) {
        if (schema === attempt) schema = null;
        throw error;
      }
      return;
    }
    await schema;
  }
  return Object.freeze({
    kind: "postgresql",
    restart_durable: true,
    distributed: true,
    initialize,
    async probe() { await initialize(); await pool.query("SELECT 1"); },
    async lookup({ tenantId, nonce, envelopeDigest }) {
      await initialize();
      const selected = await pool.query(`SELECT envelope_digest,response FROM nyra_policy_registry_attestation_replay
        WHERE tenant_id=$1 AND nonce=$2`, [tenantId, nonce]);
      if (!selected.rowCount) return null;
      if (selected.rows[0].envelope_digest !== envelopeDigest) fail("nyra_policy_attestation_nonce_reused");
      return clone(selected.rows[0].response);
    },
    async record({ tenantId, nonce, envelopeDigest, expiresAt, response }) {
      await initialize();
      const inserted = await pool.query(`INSERT INTO nyra_policy_registry_attestation_replay
        (tenant_id,nonce,envelope_digest,expires_at,response) VALUES($1,$2,$3,$4,$5::jsonb)
        ON CONFLICT (tenant_id,nonce) DO NOTHING RETURNING response`,
      [tenantId, nonce, envelopeDigest, expiresAt, JSON.stringify(response)]);
      if (inserted.rowCount === 1) return { response: clone(response), idempotent_replay: false };
      const selected = await pool.query(`SELECT envelope_digest,response FROM nyra_policy_registry_attestation_replay
        WHERE tenant_id=$1 AND nonce=$2`, [tenantId, nonce]);
      if (!selected.rowCount) fail("nyra_policy_attestation_replay_store_unavailable");
      if (selected.rows[0].envelope_digest !== envelopeDigest) fail("nyra_policy_attestation_nonce_reused");
      return { response: clone(selected.rows[0].response), idempotent_replay: true };
    },
  });
}

function validateEnvelope(envelope, config, now) {
  exactRecord(envelope, ENVELOPE_FIELDS, "nyra_policy_attestation_envelope_schema_invalid");
  if (envelope.schema_version !== SCHEMA_VERSION || !TENANT_ID.test(String(envelope.tenant_id || "")) ||
    !TENANT_ID.test(String(envelope.work_id || "")) || !TENANT_ID.test(String(envelope.preflight_id || "")) ||
    !SHA256.test(String(envelope.intent_digest || "")) || !TENANT_ID.test(String(envelope.operation_id || "")) ||
    !ACTIONS.has(String(envelope.action || "")) || !SHA256.test(String(envelope.snapshot_digest || "")) ||
    !SHA256.test(String(envelope.compiler_provenance_digest || "")) ||
    !TENANT_ID.test(String(envelope.domain_pack_id || "")) || !SHA256.test(String(envelope.owner_approval_hash || "")) ||
    !NONCE.test(String(envelope.nonce || ""))) fail("nyra_policy_attestation_envelope_invalid");
  if (!config.tenantAllowlist.includes(envelope.tenant_id)) fail("nyra_policy_attestation_tenant_denied");
  if (envelope.core_key_id !== config.coreKeyId || envelope.nyra_key_id !== config.nyraKeyId ||
    envelope.core_public_key_fingerprint !== config.coreFingerprint ||
    envelope.nyra_public_key_fingerprint !== config.nyraFingerprint) {
    fail("nyra_policy_attestation_key_binding_invalid");
  }
  const issuedAt = Date.parse(envelope.issued_at);
  const expiresAt = Date.parse(envelope.expires_at);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now + 5_000 || expiresAt <= now ||
    expiresAt <= issuedAt || expiresAt - issuedAt > config.maximumAgeMs) {
    fail("nyra_policy_attestation_expired");
  }
}

function storedResponseValid(response, envelope, coreSignature, config) {
  try {
    exactRecord(response, ["schema_version", "envelope", "core_signature", "nyra_signature"],
      "nyra_policy_attestation_replay_response_invalid");
    return response.schema_version === SCHEMA_VERSION &&
      canonicalJson(response.envelope) === canonicalJson(envelope) &&
      response.core_signature === coreSignature &&
      signatureValid(config.corePublicKey, payloadBytes(envelope), response.core_signature) &&
      signatureValid(config.nyraPublicKey, payloadBytes(envelope), response.nyra_signature);
  } catch {
    return false;
  }
}

function createNyraPolicyRegistryAttester({
  env = process.env,
  now = () => Date.now(),
  fetchImpl = globalThis.fetch,
  replayStore: injectedReplayStore,
  postgresPool,
  testSigner,
  allowLocalSignerForTests = false,
  probeCooldownMs = DEFAULT_PROBE_COOLDOWN_MS,
} = {}) {
  const enabledFlag = strictBoolean(env.NYRA_POLICY_REGISTRY_ATTESTATION_ENABLED, "enabled_flag");
  const requiredFlag = strictBoolean(env.NYRA_POLICY_REGISTRY_ATTESTATION_REQUIRED, "required_flag");
  const requestedMode = env.NYRA_POLICY_REGISTRY_SIGNER_MODE === undefined || env.NYRA_POLICY_REGISTRY_SIGNER_MODE === ""
    ? "disabled" : String(env.NYRA_POLICY_REGISTRY_SIGNER_MODE);
  const modeValid = requestedMode === "disabled" || requestedMode === "remote";
  const enabled = enabledFlag.value;
  const required = requiredFlag.value;
  const mode = enabled ? requestedMode : "disabled";
  const production = env.NODE_ENV === "production";
  const runtimeCommit = String(env.RENDER_GIT_COMMIT || env.GIT_COMMIT || "").trim().toLowerCase();
  const configuredSignerTargetCommit = String(
    env.NYRA_POLICY_REGISTRY_REMOTE_SIGNER_TARGET_COMMIT || runtimeCommit,
  ).trim().toLowerCase();
  let configurationError = enabledFlag.error || requiredFlag.error ||
    (modeValid ? null : "nyra_policy_attestation_signer_mode_invalid");
  if (!configurationError && production &&
    (injectedReplayStore !== undefined || postgresPool !== undefined)) {
    configurationError = "nyra_policy_attestation_production_dependency_injection_forbidden";
  }
  if (!configurationError && required && !enabled) configurationError = "nyra_policy_attestation_required_without_enabled";
  if (!configurationError && enabled && mode !== "remote") configurationError = "nyra_policy_attestation_remote_signer_required";
  if (!configurationError && production && enabled && mode === "remote" &&
    (!TARGET_COMMIT.test(runtimeCommit) || configuredSignerTargetCommit !== runtimeCommit)) {
    configurationError = "nyra_policy_attestation_signer_target_commit_mismatch";
  }

  let config = null;
  let signer = null;
  let replayStore = null;
  let signerState = enabled ? "initializing" : "disabled";
  let replayState = enabled ? "initializing" : "disabled";
  let readinessReason = configurationError;
  let lastProbeAt = 0;
  let probePromise = null;

  if (!configurationError && enabled) {
    try {
      const tenantAllowlist = parseAllowlist(env.NYRA_POLICY_REGISTRY_TENANT_ALLOWLIST);
      const coreKeyId = String(env.NYRA_POLICY_REGISTRY_CORE_KEY_ID || "");
      const nyraKeyId = String(env.NYRA_POLICY_REGISTRY_NYRA_KEY_ID || "");
      const coreFingerprintPin = String(env.NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY_FINGERPRINT || "");
      const nyraFingerprintPin = String(env.NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY_FINGERPRINT || "");
      const serviceKey = String(env.NYRA_POLICY_REGISTRY_CORE_SERVICE_KEY || "");
      if (!tenantAllowlist.length || tenantAllowlist.some((item) => !TENANT_ID.test(item))) fail("nyra_policy_attestation_tenant_allowlist_invalid");
      if (!ID.test(coreKeyId) || !ID.test(nyraKeyId) || coreKeyId === nyraKeyId) fail("nyra_policy_attestation_key_id_invalid");
      if (!SHA256.test(coreFingerprintPin) || !SHA256.test(nyraFingerprintPin) || coreFingerprintPin === nyraFingerprintPin) {
        fail("nyra_policy_attestation_fingerprint_pin_invalid");
      }
      if (serviceKey.length < 32 || serviceKey.length > 4_096 || serviceKey !== serviceKey.trim() ||
        /[\u0000-\u001f\u007f]/.test(serviceKey)) fail("nyra_policy_attestation_service_key_required");
      const corePublicKey = publicOnlyEd25519(env.NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY, coreKeyId,
        "nyra_policy_attestation_core_public_key_invalid");
      const nyraPublicKey = publicOnlyEd25519(env.NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY, nyraKeyId,
        "nyra_policy_attestation_nyra_public_key_invalid");
      const coreFingerprint = publicKeyFingerprint(corePublicKey);
      const nyraFingerprint = publicKeyFingerprint(nyraPublicKey);
      if (coreFingerprint !== coreFingerprintPin || nyraFingerprint !== nyraFingerprintPin ||
        coreFingerprint === nyraFingerprint) fail("nyra_policy_attestation_fingerprint_mismatch");
      const maximumAgeMs = boundedEnvInteger(env.NYRA_POLICY_REGISTRY_ATTESTATION_MAX_AGE_MS,
        300_000, 30_000, 900_000, "nyra_policy_attestation_max_age_invalid");

      if (testSigner !== undefined) {
        if (production || allowLocalSignerForTests !== true || testSigner?.custody !== "local_test_seam") {
          fail("nyra_policy_attestation_local_signer_forbidden");
        }
        signer = testSigner;
      } else {
        signer = createNyraPolicyRegistryRemoteSigner({
          origin: env.NYRA_POLICY_REGISTRY_REMOTE_SIGNER_ORIGIN,
          path: env.NYRA_POLICY_REGISTRY_REMOTE_SIGNER_PATH,
          service: env.NYRA_POLICY_REGISTRY_REMOTE_SIGNER_SERVICE,
          targetCommit: configuredSignerTargetCommit,
          purpose: env.NYRA_POLICY_REGISTRY_REMOTE_SIGNER_PURPOSE,
          keyId: env.NYRA_POLICY_REGISTRY_REMOTE_SIGNER_KEY_ID,
          serviceToken: env.NYRA_POLICY_REGISTRY_REMOTE_SIGNER_SERVICE_TOKEN,
          publicKey: nyraPublicKey,
          fetchImpl,
          timeoutMs: env.NYRA_POLICY_REGISTRY_REMOTE_SIGNER_TIMEOUT_MS,
          maxResponseBytes: env.NYRA_POLICY_REGISTRY_REMOTE_SIGNER_MAX_RESPONSE_BYTES,
        });
      }
      if (signer?.key_id !== nyraKeyId || signer?.public_key_fingerprint !== nyraFingerprint ||
        typeof signer?.signPayload !== "function") fail("nyra_policy_attestation_signer_binding_invalid");

      if (injectedReplayStore) {
        replayStore = injectedReplayStore;
      } else if (postgresPool) {
        replayStore = createPostgresReplayStore(postgresPool);
      } else if (production) {
        const databaseUrl = String(env.NYRA_POLICY_REGISTRY_DATABASE_URL || "");
        if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) fail("nyra_policy_attestation_postgres_required");
        const { Pool } = require("pg");
        replayStore = createPostgresReplayStore(new Pool({ connectionString: databaseUrl }));
      } else {
        const replayPath = String(env.NYRA_POLICY_REGISTRY_REPLAY_STORE_PATH || "");
        if (!replayPath) fail("nyra_policy_attestation_replay_store_required");
        replayStore = createFileReplayStore(replayPath);
      }
      if (!replayStore || typeof replayStore.initialize !== "function" || typeof replayStore.probe !== "function" ||
        typeof replayStore.lookup !== "function" || typeof replayStore.record !== "function") {
        fail("nyra_policy_attestation_replay_store_invalid");
      }
      if (production && (replayStore.kind !== "postgresql" || replayStore.restart_durable !== true ||
        replayStore.distributed !== true)) fail("nyra_policy_attestation_distributed_replay_required");

      config = {
        tenantAllowlist, coreKeyId, nyraKeyId, corePublicKey, nyraPublicKey,
        coreFingerprint, nyraFingerprint, maximumAgeMs,
      };
    } catch (error) {
      configurationError = String(error?.message || "nyra_policy_attestation_configuration_invalid");
      readinessReason = configurationError;
      signerState = "invalid";
      replayState = "invalid";
    }
  }

  function status() {
    const ready = enabled && !configurationError && signerState === "ready" && replayState === "ready";
    return Object.freeze({
      enabled,
      required,
      mode,
      configuration_valid: !configurationError,
      configured: enabled && !configurationError,
      ready,
      state: !enabled
        ? (configurationError ? "configuration_invalid" : "disabled")
        : configurationError
          ? "configuration_invalid"
          : ready ? "ready" : "unavailable",
      render_gate_required: required || Boolean(requiredFlag.error),
      service_key_configured: Boolean(config),
      signer_state: signerState,
      replay_state: replayState,
      replay_backend: replayStore?.kind || "disabled",
      restart_durable: replayStore?.restart_durable === true,
      distributed: replayStore?.distributed === true,
      algorithm: enabled ? "Ed25519" : null,
      attestation_schema_version: SCHEMA_VERSION,
      compiler_provenance_binding_required: true,
      custody: signer?.custody || (enabled ? "unavailable" : "disabled"),
      signer_service: signer?.service || null,
      signer_target_commit: signer?.target_commit || null,
      signer_purpose: signer?.purpose || null,
      core_key_id: config?.coreKeyId || null,
      nyra_key_id: config?.nyraKeyId || null,
      core_public_key_fingerprint: config?.coreFingerprint || null,
      nyra_public_key_fingerprint: config?.nyraFingerprint || null,
      error: configurationError || readinessReason || null,
    });
  }

  async function probe({ force = false } = {}) {
    if (!enabled || configurationError) return status();
    const timestamp = now();
    if (probePromise) return probePromise;
    if (!force && timestamp - lastProbeAt < probeCooldownMs) return status();
    lastProbeAt = timestamp;
    probePromise = (async () => {
      try {
        try {
          await replayStore.initialize();
          await replayStore.probe();
          replayState = "ready";
        } catch {
          replayState = "unavailable";
          readinessReason = "nyra_policy_attestation_replay_store_unavailable";
          return status();
        }
        try {
          const challenge = Buffer.from(`${PROBE_CONTEXT}${canonicalJson({
            schema_version: "nyra_policy_registry_signer_probe_v1",
            key_id: config.nyraKeyId,
            public_key_fingerprint: config.nyraFingerprint,
            nonce: crypto.randomBytes(24).toString("base64url"),
            issued_at: new Date(timestamp).toISOString(),
          })}`, "utf8");
          const signature = await signer.signPayload(challenge);
          if (!signatureValid(config.nyraPublicKey, challenge, signature)) fail("nyra_policy_signer_signature_invalid");
          signerState = "ready";
          readinessReason = null;
        } catch (error) {
          signerState = "unavailable";
          const code = String(error?.message || "");
          readinessReason = /^nyra_policy_signer_[a-z0-9_]+$/.test(code)
            ? code
            : "nyra_policy_signer_unavailable";
        }
        return status();
      } finally {
        probePromise = null;
      }
    })();
    return probePromise;
  }

  async function attest(request) {
    exactRecord(request, ["core_signature", "envelope"], "nyra_policy_attestation_request_schema_invalid");
    if (!status().ready) await probe();
    if (!status().ready) fail("nyra_policy_attestation_unavailable");
    const { envelope, core_signature: coreSignature } = request;
    const timestamp = now();
    validateEnvelope(envelope, config, timestamp);
    const payload = payloadBytes(envelope);
    if (!signatureValid(config.corePublicKey, payload, coreSignature)) {
      fail("nyra_policy_attestation_core_signature_invalid");
    }
    const envelopeDigest = sha256(payload);
    let replay;
    try {
      replay = await replayStore.lookup({ tenantId: envelope.tenant_id, nonce: envelope.nonce, envelopeDigest });
    } catch (error) {
      if (error?.message === "nyra_policy_attestation_nonce_reused") throw error;
      replayState = "unavailable";
      readinessReason = "nyra_policy_attestation_replay_store_unavailable";
      fail("nyra_policy_attestation_replay_store_unavailable");
    }
    if (replay) {
      if (!storedResponseValid(replay, envelope, coreSignature, config)) {
        replayState = "unavailable";
        readinessReason = "nyra_policy_attestation_replay_response_invalid";
        fail("nyra_policy_attestation_replay_response_invalid");
      }
      return { ...replay, idempotent_replay: true };
    }
    let nyraSignature;
    try {
      nyraSignature = await signer.signPayload(payload);
      if (!signatureValid(config.nyraPublicKey, payload, nyraSignature)) fail("nyra_policy_signer_signature_invalid");
      signerState = "ready";
      readinessReason = null;
    } catch (error) {
      signerState = "unavailable";
      const code = String(error?.message || "");
      readinessReason = /^nyra_policy_signer_[a-z0-9_]+$/.test(code)
        ? code
        : "nyra_policy_signer_unavailable";
      fail(readinessReason);
    }
    const response = {
      schema_version: SCHEMA_VERSION,
      envelope: clone(envelope),
      core_signature: coreSignature,
      nyra_signature: nyraSignature,
    };
    let recorded;
    try {
      recorded = await replayStore.record({
        tenantId: envelope.tenant_id,
        nonce: envelope.nonce,
        envelopeDigest,
        expiresAt: envelope.expires_at,
        response,
        now: timestamp,
      });
    } catch (error) {
      if (error?.message === "nyra_policy_attestation_nonce_reused") throw error;
      replayState = "unavailable";
      readinessReason = "nyra_policy_attestation_replay_store_unavailable";
      fail("nyra_policy_attestation_replay_store_unavailable");
    }
    let recordedResponseValid = false;
    try {
      exactRecord(recorded, ["idempotent_replay", "response"],
        "nyra_policy_attestation_replay_response_invalid");
      recordedResponseValid = typeof recorded.idempotent_replay === "boolean" &&
        storedResponseValid(recorded.response, envelope, coreSignature, config);
    } catch { /* fail closed below */ }
    if (!recordedResponseValid) {
      replayState = "unavailable";
      readinessReason = "nyra_policy_attestation_replay_response_invalid";
      fail("nyra_policy_attestation_replay_response_invalid");
    }
    replayState = "ready";
    return { ...recorded.response, idempotent_replay: recorded.idempotent_replay };
  }

  if (enabled && !configurationError) void probe();
  return Object.freeze({ status, probe, attest });
}

module.exports = {
  ENVELOPE_FIELDS,
  SCHEMA_VERSION,
  SIGNING_CONTEXT,
  SIGN_REQUEST_SCHEMA_VERSION,
  SIGN_RESPONSE_SCHEMA_VERSION,
  canonicalJson,
  createFileReplayStore,
  createNyraPolicyRegistryAttester,
  createNyraPolicyRegistryLocalTestSigner,
  createNyraPolicyRegistryRemoteSigner,
  createPostgresReplayStore,
  payloadBytes,
  publicKeyFingerprint,
};

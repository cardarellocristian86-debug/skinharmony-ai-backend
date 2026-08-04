"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "nyra_policy_activation_attestation_v1";
const SIGNING_CONTEXT = "nyra-policy-activation-attestation-v1\0";
const ACTIONS = new Set([
  "policy.snapshot.activate",
  "policy.snapshot.rollback",
  "policy.snapshot.reconcile",
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;

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

function signatureValid(publicKey, envelope, signature) {
  try {
    return crypto.verify(null, payloadBytes(envelope), publicKey, Buffer.from(String(signature || ""), "base64url"));
  } catch {
    return false;
  }
}

function parseAllowlist(value) {
  return String(value || "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function withReplayLock(filePath, callback) {
  const lockPath = `${filePath}.lock`;
  try {
    fs.mkdirSync(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("nyra_policy_attestation_replay_store_busy");
    throw error;
  }
  try {
    return callback();
  } finally {
    fs.rmdirSync(lockPath);
  }
}

function loadReplay(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { schema_version: "nyra_policy_attestation_replay_v1", entries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed?.schema_version === "nyra_policy_attestation_replay_v1" && parsed.entries && typeof parsed.entries === "object") return parsed;
  } catch { /* fail closed below */ }
  throw new Error("nyra_policy_attestation_replay_store_invalid");
}

function envelopeDigest(envelope) {
  return crypto.createHash("sha256").update(payloadBytes(envelope)).digest("hex");
}

function validateEnvelope(envelope, { tenantAllowlist, coreKeyId, nyraKeyId, maximumAgeMs, now }) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("nyra_policy_attestation_envelope_required");
  const fields = ["schema_version", "tenant_id", "work_id", "preflight_id", "intent_digest", "operation_id", "action", "snapshot_digest", "domain_pack_id", "nonce", "issued_at", "expires_at", "core_key_id", "nyra_key_id"];
  if (Object.keys(envelope).length !== fields.length || fields.some((field) => envelope[field] === undefined)) {
    throw new Error("nyra_policy_attestation_envelope_schema_invalid");
  }
  if (envelope.schema_version !== SCHEMA_VERSION || !ID.test(String(envelope.tenant_id || "")) ||
    !ID.test(String(envelope.work_id || "")) || !ID.test(String(envelope.preflight_id || "")) ||
    !SHA256.test(String(envelope.intent_digest || "")) || !ID.test(String(envelope.operation_id || "")) ||
    !ACTIONS.has(String(envelope.action || "")) || !SHA256.test(String(envelope.snapshot_digest || "")) ||
    !ID.test(String(envelope.domain_pack_id || "")) || !NONCE.test(String(envelope.nonce || ""))) {
    throw new Error("nyra_policy_attestation_envelope_invalid");
  }
  if (!tenantAllowlist.includes(envelope.tenant_id)) throw new Error("nyra_policy_attestation_tenant_denied");
  if (envelope.core_key_id !== coreKeyId || envelope.nyra_key_id !== nyraKeyId || coreKeyId === nyraKeyId) {
    throw new Error("nyra_policy_attestation_key_binding_invalid");
  }
  const issuedAt = Date.parse(envelope.issued_at);
  const expiresAt = Date.parse(envelope.expires_at);
  const timestamp = now();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > timestamp + 5_000 ||
    expiresAt <= timestamp || expiresAt <= issuedAt || expiresAt - issuedAt > maximumAgeMs) {
    throw new Error("nyra_policy_attestation_expired");
  }
}

function createNyraPolicyRegistryAttester({ env = process.env, now = () => Date.now() } = {}) {
  const enabled = ["1", "true", "yes", "on"].includes(String(env.NYRA_POLICY_REGISTRY_ATTESTATION_ENABLED || "").toLowerCase());
  const tenantAllowlist = parseAllowlist(env.NYRA_POLICY_REGISTRY_TENANT_ALLOWLIST);
  const coreKeyId = String(env.NYRA_POLICY_REGISTRY_CORE_KEY_ID || "").trim();
  const nyraKeyId = String(env.NYRA_POLICY_REGISTRY_NYRA_KEY_ID || "").trim();
  const corePublicPem = String(env.NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY || "").trim();
  const nyraPrivatePem = String(env.NYRA_POLICY_REGISTRY_NYRA_PRIVATE_KEY || "").trim();
  const replayPath = String(env.NYRA_POLICY_REGISTRY_REPLAY_STORE_PATH || "").trim();
  const maximumAgeMs = Math.max(30_000, Math.min(15 * 60_000, Number(env.NYRA_POLICY_REGISTRY_ATTESTATION_MAX_AGE_MS || 300_000)));
  let corePublicKey = null;
  let nyraPrivateKey = null;
  let nyraPublicKey = null;
  let configurationError = null;
  try {
    if (!enabled) throw new Error("disabled");
    if (!tenantAllowlist.length || !coreKeyId || !nyraKeyId || !corePublicPem || !nyraPrivatePem || !replayPath) {
      throw new Error("configuration_incomplete");
    }
    corePublicKey = crypto.createPublicKey(corePublicPem);
    nyraPrivateKey = crypto.createPrivateKey(nyraPrivatePem);
    nyraPublicKey = crypto.createPublicKey(nyraPrivateKey);
    if (corePublicKey.asymmetricKeyType !== "ed25519" || nyraPrivateKey.asymmetricKeyType !== "ed25519") throw new Error("ed25519_required");
    const coreFingerprint = crypto.createHash("sha256").update(corePublicKey.export({ type: "spki", format: "der" })).digest("hex");
    const nyraFingerprint = crypto.createHash("sha256").update(nyraPublicKey.export({ type: "spki", format: "der" })).digest("hex");
    if (coreFingerprint === nyraFingerprint || coreKeyId === nyraKeyId) throw new Error("independent_keys_required");
    loadReplay(replayPath);
  } catch (error) {
    configurationError = String(error?.message || "configuration_invalid");
  }

  function status() {
    return {
      enabled,
      configured: enabled && !configurationError,
      ready: enabled && !configurationError,
      durable_replay: Boolean(replayPath),
      tenant_allowlist_configured: tenantAllowlist.length > 0,
      algorithm: "Ed25519",
      error: configurationError && configurationError !== "disabled" ? configurationError : null,
    };
  }

  function attest({ envelope, core_signature: coreSignature }) {
    if (!status().ready) throw new Error("nyra_policy_attestation_unavailable");
    validateEnvelope(envelope, { tenantAllowlist, coreKeyId, nyraKeyId, maximumAgeMs, now });
    if (!signatureValid(corePublicKey, envelope, coreSignature)) throw new Error("nyra_policy_attestation_core_signature_invalid");
    const digest = envelopeDigest(envelope);
    return withReplayLock(replayPath, () => {
      const replay = loadReplay(replayPath);
      const replayKey = `${envelope.tenant_id}:${envelope.nonce}`;
      const existing = replay.entries[replayKey];
      if (existing) {
        if (existing.envelope_digest !== digest) throw new Error("nyra_policy_attestation_nonce_reused");
        return { ...existing.response, idempotent_replay: true };
      }
      const nyraSignature = crypto.sign(null, payloadBytes(envelope), nyraPrivateKey).toString("base64url");
      const response = { schema_version: SCHEMA_VERSION, envelope, core_signature: coreSignature, nyra_signature: nyraSignature };
      replay.entries[replayKey] = { envelope_digest: digest, expires_at: envelope.expires_at, response };
      for (const [key, value] of Object.entries(replay.entries)) {
        if (Date.parse(String(value.expires_at || "")) <= now()) delete replay.entries[key];
      }
      atomicWrite(replayPath, replay);
      return { ...response, idempotent_replay: false };
    });
  }

  return { status, attest };
}

module.exports = {
  SCHEMA_VERSION,
  canonicalJson,
  createNyraPolicyRegistryAttester,
  payloadBytes,
};

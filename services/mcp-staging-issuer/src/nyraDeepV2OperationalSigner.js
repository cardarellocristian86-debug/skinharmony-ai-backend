import crypto from "node:crypto";

const SERVICE = "mcp-staging-signed-issuer";
const MODE = "core";
const ENVIRONMENT = "staging";
const TENANT_ID = "codexai";
const PURPOSE = "nyra_deep_branch_v2_operational_attestation";
const ISSUER = "skinharmony-universal-core";
const AUDIENCE = "skinharmony-nyra-core";
const KEY_ID = "universal-core-nyra-v2";
const REQUEST_SCHEMA = "nyra_deep_branch_v2_sign_request_v1";
const RESPONSE_SCHEMA = "nyra_deep_branch_v2_sign_response_v1";
const ATTESTATION_SCHEMA = "nyra_deep_branch_v2_operational_attestation_v1";
const ENDPOINT = "/v1/nyra-deep-v2/sign-operational-attestation";
const JWKS_ENDPOINT = "/.well-known/nyra-deep-v2-core-attestation-jwks.json";
export const NYRA_DEEP_V2_OPERATIONAL_SIGNER_MAX_WIRE_BYTES = 384 * 1_024;
const DEFAULT_BODY_LIMIT = NYRA_DEEP_V2_OPERATIONAL_SIGNER_MAX_WIRE_BYTES;
const DEFAULT_BODY_TIMEOUT_MS = 3_000;
const MAX_TTL_MS = 60_000;
const DURABLE_REPLAY_MAX_TTL_MS = 30_000;
const FUTURE_SKEW_MS = 5_000;
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const NONCE = /^[a-f0-9]{32,128}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const ENTITLEMENT_PACKS = new Set(["generic", "suite", "smartdesk", "analyzer", "skinharmony"]);
const LINEAGE_TYPES = Object.freeze([
  "specialized_capability",
  "micro_capability",
  "method",
  "strategy",
  "verifier",
  "metric",
]);
const REQUEST_KEYS = Object.freeze(["schema_version", "purpose", "target_commit", "attestation"]);
const ATTESTATION_KEYS = Object.freeze([
  "schema_version",
  "issuer",
  "audience",
  "key_id",
  "tenant_id",
  "request_id",
  "domain_pack",
  "catalog_scope",
  "entitlement_domain_pack",
  "branch_id",
  "subbranch_id",
  "preflight_id",
  "core_policy_hash",
  "envelope_binding_hash",
  "catalog_fingerprint",
  "root_binding_hash",
  "function_registry_hash",
  "package_hash",
  "lineage",
  "node_contexts",
  "nonce",
  "issued_at",
  "expires_at",
  "observed_at",
]);
const LINEAGE_KEYS = Object.freeze([
  "node_id",
  "parent_id",
  "level",
  "node_type",
  "function_binding_hash",
  "semantic_function_hash",
]);
const NODE_CONTEXT_KEYS = Object.freeze([
  "schema_version",
  "node_id",
  "context_id",
  "payload_encoding",
  "payload_sha256",
  "opaque_payload",
]);
const OPAQUE_PAYLOAD_KEYS = Object.freeze([
  "node_id",
  "capability_input",
  "evidence",
  "evidence_manifest",
  "policy_decisions",
]);
const FORBIDDEN_KEY = /(?:secret|password|passwd|credential|authorization|cookie|api[_-]?key|private[_-]?key|raw[_-]?(?:prompt|chat)|(?:access|refresh|bearer)[_-]?token|(?:^|[_-])token(?:$|[_-]))/i;
const FORBIDDEN_VALUE = /(?:bearer\s+[A-Za-z0-9._~+/-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/@:]+:[^\s/@]+@|[?&](?:token|secret|password|api[_-]?key)=[^\s&#]{8,}|\bsk-[A-Za-z0-9_-]{20,}|\bgh[opusr]_[A-Za-z0-9_]{20,}|NEVER_LEAK)/i;

export const NYRA_DEEP_V2_OPERATIONAL_SIGNER_CONTRACT = Object.freeze({
  service: SERVICE,
  mode: MODE,
  environment: ENVIRONMENT,
  tenant_id: TENANT_ID,
  purpose: PURPOSE,
  issuer: ISSUER,
  audience: AUDIENCE,
  key_id: KEY_ID,
  request_schema: REQUEST_SCHEMA,
  response_schema: RESPONSE_SCHEMA,
  endpoint: ENDPOINT,
  jwks_endpoint: JWKS_ENDPOINT,
  maximum_ttl_ms: MAX_TTL_MS,
  maximum_wire_bytes: NYRA_DEEP_V2_OPERATIONAL_SIGNER_MAX_WIRE_BYTES,
});

export class NyraDeepV2OperationalSignerConfigurationError extends Error {
  constructor(code) {
    super(code);
    this.name = "NyraDeepV2OperationalSignerConfigurationError";
    this.code = code;
  }
}

function configFail(code) {
  throw new NyraDeepV2OperationalSignerConfigurationError(code);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) return false;
  actual.sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function nyraDeepV2SignerCanonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(nyraDeepV2SignerCanonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${nyraDeepV2SignerCanonicalJson(value[key])}`
    )).join(",")}}`;
  }
  throw new Error("non_canonical_value");
}

function validSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4_096 && /^[\x21-\x7e]+$/.test(value);
}

function deriveEd25519Key(signingSecret, targetCommit) {
  const master = Buffer.from(signingSecret, "utf8");
  let seed;
  try {
    seed = Buffer.from(crypto.hkdfSync(
      "sha256",
      master,
      Buffer.from("skinharmony-mcp-staging-nyra-deep-v2-signer-v1", "utf8"),
      Buffer.from(`ed25519:core:staging:${targetCommit}:${PURPOSE}`, "utf8"),
      32,
    ));
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
      format: "der",
      type: "pkcs8",
    });
    return Object.freeze({ privateKey, publicKey: crypto.createPublicKey(privateKey) });
  } catch {
    configFail("nyra_deep_v2_signer_key_derivation_failed");
  } finally {
    master.fill(0);
    if (seed) seed.fill(0);
  }
}

function publicJwk(publicKey) {
  const exported = publicKey.export({ format: "jwk" });
  return Object.freeze({
    alg: "EdDSA",
    crv: "Ed25519",
    kid: KEY_ID,
    kty: "OKP",
    use: "sig",
    x: exported.x,
  });
}

function authDigest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

function authorized(header, expectedDigest) {
  const match = typeof header === "string" ? header.match(/^Bearer ([\x21-\x7e]+)$/) : null;
  if (!match) return false;
  const supplied = authDigest(match[1]);
  return crypto.timingSafeEqual(supplied, expectedDigest);
}

function fixedHeaders(res) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
}

function send(res, status, payload) {
  const serialized = JSON.stringify(payload);
  fixedHeaders(res);
  res.setHeader("content-length", String(Buffer.byteLength(serialized, "utf8")));
  res.statusCode = status;
  res.end(serialized);
}

function publicError(res, status, code) {
  send(res, status, { ok: false, error: code });
}

function safeLog(logger, event, status) {
  if (typeof logger !== "function") return;
  try {
    logger(Object.freeze({ event, mode: MODE, purpose: PURPOSE, status }));
  } catch {
    // Request content, credentials and provider errors are never logged.
  }
}

function exactIsoEpoch(value) {
  if (typeof value !== "string") return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value ? epoch : null;
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeStructuredValue(value, depth = 0, state = { entries: 0 }) {
  if (depth > 32 || state.entries > 20_000) return false;
  state.entries += 1;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 16_384 && !FORBIDDEN_VALUE.test(value);
  if (Array.isArray(value)) {
    return value.length <= 2_048 && value.every((item) => safeStructuredValue(item, depth + 1, state));
  }
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > 512 || keys.some((key) => key.length > 160 || FORBIDDEN_KEY.test(key))) return false;
  return keys.every((key) => safeStructuredValue(value[key], depth + 1, state));
}

function validateLineage(lineage) {
  if (!Array.isArray(lineage) || lineage.length !== 6) return false;
  const nodeIds = new Set();
  for (const [index, node] of lineage.entries()) {
    if (!exactKeys(node, LINEAGE_KEYS) || !IDENTIFIER.test(String(node.node_id || "")) ||
        (node.parent_id !== null && !IDENTIFIER.test(String(node.parent_id || ""))) ||
        node.level !== (index === 0 ? 2 : index === 1 ? 3 : 4) ||
        node.node_type !== LINEAGE_TYPES[index] || !SHA256.test(String(node.function_binding_hash || "")) ||
        (node.semantic_function_hash !== null && !SHA256.test(String(node.semantic_function_hash || ""))) ||
        nodeIds.has(node.node_id)) return false;
    nodeIds.add(node.node_id);
  }
  return lineage[1].parent_id === lineage[0].node_id &&
    lineage.slice(2).every((node) => node.parent_id === lineage[1].node_id);
}

function validateOpaqueContext(context, expectedNodeId) {
  if (!exactKeys(context, NODE_CONTEXT_KEYS) ||
      context.schema_version !== "nyra_deep_branch_v2_opaque_node_context_v1" ||
      context.node_id !== expectedNodeId ||
      !/^opctx_[A-Za-z0-9._:-]{8,159}$/.test(String(context.context_id || "")) ||
      context.payload_encoding !== "base64url_canonical_json" ||
      !SHA256.test(String(context.payload_sha256 || "")) ||
      typeof context.opaque_payload !== "string" || context.opaque_payload.length < 16 ||
      context.opaque_payload.length > 131_072 || !/^[A-Za-z0-9_-]+$/.test(context.opaque_payload)) return false;
  let raw;
  let payload;
  try {
    raw = Buffer.from(context.opaque_payload, "base64url");
    if (raw.length === 0 || raw.length > 96 * 1_024 || sha256Bytes(raw) !== context.payload_sha256) return false;
    payload = JSON.parse(raw.toString("utf8"));
    if (raw.toString("utf8") !== nyraDeepV2SignerCanonicalJson(payload)) return false;
  } catch {
    return false;
  }
  return exactKeys(payload, OPAQUE_PAYLOAD_KEYS) && payload.node_id === expectedNodeId &&
    isPlainObject(payload.capability_input) && Array.isArray(payload.evidence) &&
    isPlainObject(payload.evidence_manifest) && Array.isArray(payload.policy_decisions) &&
    safeStructuredValue(payload);
}

function validateAttestation(attestation, nowMs) {
  if (!exactKeys(attestation, ATTESTATION_KEYS) ||
      attestation.schema_version !== ATTESTATION_SCHEMA || attestation.issuer !== ISSUER ||
      attestation.audience !== AUDIENCE || attestation.key_id !== KEY_ID ||
      attestation.tenant_id !== TENANT_ID || !REQUEST_ID.test(String(attestation.request_id || "")) ||
      attestation.domain_pack !== "skinharmony" || attestation.catalog_scope !== "skinharmony" ||
      !ENTITLEMENT_PACKS.has(String(attestation.entitlement_domain_pack || "")) ||
      !IDENTIFIER.test(String(attestation.branch_id || "")) ||
      !IDENTIFIER.test(String(attestation.subbranch_id || "")) ||
      !REQUEST_ID.test(String(attestation.preflight_id || "")) ||
      !NONCE.test(String(attestation.nonce || "")) ||
      !Number.isSafeInteger(attestation.observed_at)) return false;
  for (const key of [
    "core_policy_hash",
    "envelope_binding_hash",
    "catalog_fingerprint",
    "root_binding_hash",
    "function_registry_hash",
    "package_hash",
  ]) if (!SHA256.test(String(attestation[key] || ""))) return false;
  const issuedAt = exactIsoEpoch(attestation.issued_at);
  const expiresAt = exactIsoEpoch(attestation.expires_at);
  if (issuedAt === null || expiresAt === null || issuedAt > nowMs + FUTURE_SKEW_MS ||
      expiresAt <= nowMs || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TTL_MS ||
      expiresAt - nowMs > DURABLE_REPLAY_MAX_TTL_MS ||
      attestation.observed_at > nowMs + FUTURE_SKEW_MS) return false;
  if (!validateLineage(attestation.lineage) || !Array.isArray(attestation.node_contexts) ||
      attestation.node_contexts.length !== attestation.lineage.length) return false;
  return attestation.node_contexts.every((context, index) => (
    validateOpaqueContext(context, attestation.lineage[index].node_id)
  ));
}

export function validateNyraDeepV2OperationalSigningRequest(body, { targetCommit, nowMs } = {}) {
  return exactKeys(body, REQUEST_KEYS) && body.schema_version === REQUEST_SCHEMA &&
    body.purpose === PURPOSE && body.target_commit === targetCommit &&
    validateAttestation(body.attestation, nowMs);
}

function readJsonBody(req, bodyLimit, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > bodyLimit) finish(new Error("body_too_large"));
      else chunks.push(chunk);
    };
    const onEnd = () => {
      try {
        finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        finish(new Error("invalid_json"));
      }
    };
    const onError = () => finish(new Error("body_unavailable"));
    const timer = setTimeout(() => finish(new Error("body_timeout")), timeoutMs);
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

function signingPayload(attestation) {
  return Buffer.from(
    `nyra-deep-branch-v2-operational-attestation\u0000${nyraDeepV2SignerCanonicalJson(attestation)}`,
    "utf8",
  );
}

function signedResponsePayload(attestation, targetCommit, signature) {
  return {
    schema_version: RESPONSE_SCHEMA,
    purpose: PURPOSE,
    target_commit: targetCommit,
    key_id: KEY_ID,
    attestation: Object.freeze({ ...attestation, signature }),
  };
}

function replayNonce(sourceNonce, targetCommit) {
  return crypto.createHash("sha256")
    .update(`nyra-deep-v2-operational-signer\u0000${targetCommit}\u0000${sourceNonce}`, "utf8")
    .digest("base64url")
    .slice(0, 32);
}

export function createNyraDeepV2OperationalSignerRuntime(options = {}) {
  if (!isPlainObject(options)) configFail("nyra_deep_v2_signer_options_invalid");
  const allowedOptions = new Set([
    "mode", "environment", "startupMode", "signingSecret", "authToken", "replayStore",
    "targetCommit", "bodyLimit", "bodyTimeoutMs", "now", "logger",
  ]);
  if (Reflect.ownKeys(options).some((key) => typeof key !== "string" || !allowedOptions.has(key))) {
    configFail("nyra_deep_v2_signer_options_invalid");
  }
  if (options.mode !== MODE || options.environment !== ENVIRONMENT || options.startupMode !== "full") {
    configFail("nyra_deep_v2_signer_scope_invalid");
  }
  if (!validSecret(options.signingSecret)) configFail("nyra_deep_v2_signer_secret_invalid");
  if (!validSecret(options.authToken)) configFail("nyra_deep_v2_signer_auth_token_invalid");
  if (!COMMIT.test(String(options.targetCommit || ""))) configFail("nyra_deep_v2_signer_target_commit_invalid");
  if (!options.replayStore || options.replayStore.durable !== true ||
      typeof options.replayStore.claim !== "function") configFail("nyra_deep_v2_signer_durable_replay_store_required");
  const bodyLimit = options.bodyLimit === undefined ? DEFAULT_BODY_LIMIT : Number(options.bodyLimit);
  const bodyTimeoutMs = options.bodyTimeoutMs === undefined ? DEFAULT_BODY_TIMEOUT_MS : Number(options.bodyTimeoutMs);
  if (!Number.isInteger(bodyLimit) || bodyLimit < 16_384 ||
      bodyLimit > NYRA_DEEP_V2_OPERATIONAL_SIGNER_MAX_WIRE_BYTES) {
    configFail("nyra_deep_v2_signer_body_limit_invalid");
  }
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 100 || bodyTimeoutMs > 10_000) {
    configFail("nyra_deep_v2_signer_body_timeout_invalid");
  }
  const now = options.now === undefined ? Date.now : options.now;
  if (typeof now !== "function") configFail("nyra_deep_v2_signer_time_source_invalid");
  const targetCommit = options.targetCommit;
  const replayStore = options.replayStore;
  const logger = options.logger;
  const { privateKey, publicKey } = deriveEd25519Key(options.signingSecret, targetCommit);
  const jwk = publicJwk(publicKey);
  const expectedAuthDigest = authDigest(options.authToken);

  async function handle(req, res) {
    const pathname = (() => {
      try {
        return new URL(req.url || "/", "http://issuer.invalid").pathname;
      } catch {
        return "/invalid";
      }
    })();
    if (req.method === "GET" && pathname === JWKS_ENDPOINT) return send(res, 200, { keys: [jwk] });
    if (pathname !== ENDPOINT) return false;
    if (req.method !== "POST") {
      publicError(res, 405, "method_not_allowed");
      return true;
    }
    if (!authorized(req.headers.authorization, expectedAuthDigest)) {
      safeLog(logger, "nyra_deep_v2_signer_auth_rejected", 401);
      publicError(res, 401, "nyra_deep_v2_signer_auth_required");
      return true;
    }
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      publicError(res, 415, "application_json_required");
      return true;
    }
    const declaredLength = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > bodyLimit) {
      publicError(res, 413, "request_body_too_large");
      return true;
    }
    let nowMs;
    try {
      nowMs = now();
      if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("invalid_time");
    } catch {
      safeLog(logger, "nyra_deep_v2_signer_unavailable", 503);
      publicError(res, 503, "nyra_deep_v2_signer_unavailable");
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req, bodyLimit, bodyTimeoutMs);
    } catch (error) {
      const tooLarge = error?.message === "body_too_large";
      publicError(res, tooLarge ? 413 : 400, tooLarge ? "request_body_too_large" : "nyra_deep_v2_sign_request_invalid");
      return true;
    }
    if (!validateNyraDeepV2OperationalSigningRequest(body, { targetCommit, nowMs })) {
      safeLog(logger, "nyra_deep_v2_signer_request_rejected", 400);
      publicError(res, 400, "nyra_deep_v2_sign_request_invalid");
      return true;
    }
    let responsePayload;
    let serializedResponse;
    try {
      const unsigned = structuredClone(body.attestation);
      const signature = crypto.sign(null, signingPayload(unsigned), privateKey).toString("base64url");
      responsePayload = signedResponsePayload(unsigned, targetCommit, signature);
      serializedResponse = JSON.stringify(responsePayload);
      if (Buffer.byteLength(serializedResponse, "utf8") > bodyLimit) {
        safeLog(logger, "nyra_deep_v2_signer_response_rejected", 413);
        publicError(res, 413, "nyra_deep_v2_sign_response_too_large");
        return true;
      }
    } catch {
      safeLog(logger, "nyra_deep_v2_signer_unavailable", 503);
      publicError(res, 503, "nyra_deep_v2_signer_unavailable");
      return true;
    }
    try {
      const claimed = await replayStore.claim(Object.freeze({
        mode: MODE,
        nonce: replayNonce(body.attestation.nonce, targetCommit),
        now_ms: nowMs,
        expires_at: Date.parse(body.attestation.expires_at),
      }));
      if (claimed !== true) {
        safeLog(logger, "nyra_deep_v2_signer_replay_rejected", 409);
        publicError(res, 409, "nyra_deep_v2_sign_request_replay");
        return true;
      }
    } catch {
      safeLog(logger, "nyra_deep_v2_signer_replay_store_unavailable", 503);
      publicError(res, 503, "nyra_deep_v2_signer_replay_store_unavailable");
      return true;
    }
    safeLog(logger, "nyra_deep_v2_operational_attestation_signed", 201);
    fixedHeaders(res);
    res.setHeader("content-length", String(Buffer.byteLength(serializedResponse, "utf8")));
    res.statusCode = 201;
    res.end(serializedResponse);
    return true;
  }

  return Object.freeze({
    service: SERVICE,
    mode: MODE,
    environment: ENVIRONMENT,
    purpose: PURPOSE,
    endpoint: ENDPOINT,
    jwksEndpoint: JWKS_ENDPOINT,
    targetCommit,
    keyId: KEY_ID,
    jwk,
    publicKey,
    handle,
  });
}

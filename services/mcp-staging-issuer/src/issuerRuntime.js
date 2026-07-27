import crypto from "node:crypto";
import { requireMcpStagingTargetCommit } from
  "../../universal-core-service/src/mcpStagingTargetCommit.js";

const SERVICE = "mcp-staging-signed-issuer";
const AUDIENCE = "mcp-staging-render-executor";
const TENANT_ID = "codexai";
const TARGET_SERVICE = "skinharmony-core-mcp-staging";
const TARGET_ENVIRONMENT = "staging";
const MAX_TTL_SECONDS = 30;
const DEFAULT_TTL_SECONDS = 20;
const DEFAULT_BODY_LIMIT = 16_384;
const DEFAULT_BODY_TIMEOUT_MS = 3_000;
const DEFAULT_RATE_LIMIT = 30;
const RATE_LIMIT_IDENTITY_CAPACITY = 256;
const REPLAY_LIMIT = 4_096;
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const REQUEST_KEYS = Object.freeze([
  "schema_version",
  "request_kind",
  "requested_issuer",
  "audience",
  "tenant_id",
  "target_service",
  "target_environment",
  "target_commit",
  "request_nonce",
  "context",
  "evidence",
]);
const NYRA_CONTEXT_KEYS = Object.freeze([
  "schema_version",
  "tenant_id",
  "domain_pack_id",
  "target_service",
  "target_environment",
  "target_region",
  "target_commit",
  "attempt_id",
  "deployment_spec_digest",
  "preflight_digest",
  "credential_grant_digest",
  "credential_execution_id",
  "credential_action_digest",
  "credential_executor_contract_id",
  "action_digest",
  "executor_contract_id",
]);
const CORE_CONTEXT_KEYS = Object.freeze([...NYRA_CONTEXT_KEYS, "nyra_attestation_digest"]);
const NYRA_CLAIM_KEYS = Object.freeze([
  "schema_version",
  "issuer",
  "audience",
  "request_kind",
  "decision",
  "role",
  "execution_allowed",
  "risk_band",
  "tenant_id",
  "domain_pack_id",
  "target_service",
  "target_environment",
  "target_commit",
  "attempt_id",
  "deployment_spec_digest",
  "preflight_digest",
  "credential_grant_digest",
  "action_digest",
  "executor_contract_id",
  "issued_at",
  "expires_at",
  "nonce",
]);
const CORE_CLAIM_KEYS = Object.freeze([
  "schema_version",
  "issuer",
  "audience",
  "request_kind",
  "decision",
  "state",
  "scope",
  "domain_action_id",
  "tenant_id",
  "domain_pack_id",
  "core_key_id",
  "core_key_type",
  "core_key_scope",
  "target_service",
  "target_environment",
  "target_commit",
  "attempt_id",
  "deployment_spec_digest",
  "preflight_digest",
  "credential_grant_digest",
  "credential_execution_id",
  "credential_action_digest",
  "credential_executor_contract_id",
  "credential_receipt_verified",
  "nyra_attestation_digest",
  "action_digest",
  "executor_contract_id",
  "confirmation_reference",
  "owner_confirmation_digest",
  "confirmation_satisfied",
  "revalidation_required",
  "nyra_available",
  "issued_at",
  "expires_at",
  "nonce",
]);
const COMMON_EVIDENCE_KEYS = Object.freeze([
  "schema_version",
  "verified",
  "mode",
  "request_nonce",
  "tenant_id",
  "target_service",
  "target_environment",
  "target_commit",
  "attempt_id",
  "deployment_spec_digest",
  "preflight_digest",
  "credential_grant_digest",
  "credential_receipt_verified",
  "credential_receipt_digest",
  "action_digest",
  "executor_contract_id",
  "verified_at",
  "expires_at",
]);
const NYRA_EVIDENCE_KEYS = Object.freeze([
  ...COMMON_EVIDENCE_KEYS,
  "decision",
  "risk_band",
]);
const CORE_EVIDENCE_KEYS = Object.freeze([
  ...COMMON_EVIDENCE_KEYS,
  "decision",
  "state",
  "scope",
  "domain_action_id",
  "credential_execution_id",
  "credential_action_digest",
  "credential_executor_contract_id",
  "owner_confirmation_verified",
  "confirmation_reference",
  "owner_confirmation_digest",
  "nyra_attestation_verified",
  "nyra_attestation_digest",
  "core_key_id",
  "revalidation_required",
]);

export const MCP_STAGING_ISSUER_CONTRACT = Object.freeze({
  service: SERVICE,
  audience: AUDIENCE,
  tenant_id: TENANT_ID,
  target_service: TARGET_SERVICE,
  target_environment: TARGET_ENVIRONMENT,
  target_commit_required: true,
  max_ttl_seconds: MAX_TTL_SECONDS,
  endpoints: Object.freeze({
    core: "/v1/mcp-staging/core-grant",
    nyra: "/v1/mcp-staging/nyra-attest",
  }),
  claim_keys: Object.freeze({ core: CORE_CLAIM_KEYS, nyra: NYRA_CLAIM_KEYS }),
});

export class McpStagingIssuerConfigurationError extends Error {
  constructor(code) {
    super(code);
    this.name = "McpStagingIssuerConfigurationError";
    this.code = code;
  }
}

function configFail(code) {
  throw new McpStagingIssuerConfigurationError(code);
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
  const expected = [...expectedKeys].sort();
  actual.sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("non_canonical_value");
}

function canonicalDigest(label, value) {
  return crypto.createHash("sha256").update(`${label}\u0000${canonicalJson(value)}`).digest("hex");
}

function exactDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4096 && /^[\x21-\x7e]+$/.test(value);
}

function deriveEd25519Key(signingSecret, mode) {
  const master = Buffer.from(signingSecret, "utf8");
  let seed;
  try {
    seed = Buffer.from(crypto.hkdfSync(
      "sha256",
      master,
      Buffer.from("skinharmony-mcp-staging-issuer-v1", "utf8"),
      Buffer.from(`ed25519:${mode}`, "utf8"),
      32,
    ));
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
      format: "der",
      type: "pkcs8",
    });
    return { privateKey, publicKey: crypto.createPublicKey(privateKey) };
  } catch {
    configFail("issuer_signing_key_derivation_failed");
  } finally {
    master.fill(0);
    if (seed) seed.fill(0);
  }
}

function publicJwk(publicKey) {
  const exported = publicKey.export({ format: "jwk" });
  const kid = `ed25519-sha256:${crypto.createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex")}`;
  return Object.freeze({
    alg: "EdDSA",
    crv: "Ed25519",
    kid,
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
  const provided = authDigest(match[1]);
  return crypto.timingSafeEqual(provided, expectedDigest);
}

function fixedHeaders(res) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
}

function send(res, status, payload) {
  fixedHeaders(res);
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

function publicError(res, status, code) {
  send(res, status, { ok: false, error: code });
}

function safeLog(logger, event, mode, status) {
  if (typeof logger !== "function") return;
  try {
    logger(Object.freeze({ event, mode, status }));
  } catch {
    // Logging never changes issuer behavior and never receives request content.
  }
}

function exactIso(value) {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function validateContext(context, mode, targetCommit) {
  const keys = mode === "core" ? CORE_CONTEXT_KEYS : NYRA_CONTEXT_KEYS;
  if (!exactKeys(context, keys)) return false;
  const fixed = {
    schema_version: "mcp_staging_executor_context_v1",
    tenant_id: TENANT_ID,
    domain_pack_id: "skinharmony",
    target_service: TARGET_SERVICE,
    target_environment: TARGET_ENVIRONMENT,
    target_region: "oregon",
    target_commit: targetCommit,
  };
  for (const [key, expected] of Object.entries(fixed)) {
    if (context[key] !== expected) return false;
  }
  for (const key of [
    "deployment_spec_digest",
    "preflight_digest",
    "credential_grant_digest",
    "credential_action_digest",
    "nyra_attestation_digest",
    "action_digest",
  ]) {
    if (key in context && !exactDigest(context[key])) return false;
  }
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(context.attempt_id) ||
      context.executor_contract_id !== `domain_action_${context.action_digest.slice(0, 20)}` ||
      context.credential_executor_contract_id !==
        `domain_action_${context.credential_action_digest.slice(0, 20)}`) {
    return false;
  }
  return true;
}

function validateRequest(body, mode, targetCommit) {
  if (!exactKeys(body, REQUEST_KEYS)) return false;
  const expectedIssuer = mode === "core" ? "universal-core" : "nyra";
  if (body.schema_version !== "mcp_staging_signed_issuer_request_v1" ||
      !["issue", "readiness_probe"].includes(body.request_kind) ||
      body.requested_issuer !== expectedIssuer || body.audience !== AUDIENCE ||
      body.tenant_id !== TENANT_ID || body.target_service !== TARGET_SERVICE ||
      body.target_environment !== TARGET_ENVIRONMENT || body.target_commit !== targetCommit ||
      !/^[A-Za-z0-9_-]{32}$/.test(body.request_nonce) ||
      !validateContext(body.context, mode, targetCommit)) {
    return false;
  }
  const evidenceKeys = mode === "core"
    ? ["credential_receipt", "nyra_attestation", "owner_confirmation"]
    : ["credential_receipt", "owner_confirmation"];
  if (!exactKeys(body.evidence, evidenceKeys) || evidenceKeys.some((key) => {
    const envelope = body.evidence[key];
    return !exactKeys(envelope, ["claims", "signature"]) || !isPlainObject(envelope.claims) ||
      typeof envelope.signature !== "string" || envelope.signature.length < 80 || envelope.signature.length > 120;
  })) return false;
  return body.tenant_id === body.context.tenant_id &&
    body.target_service === body.context.target_service &&
    body.target_environment === body.context.target_environment &&
    body.target_commit === body.context.target_commit;
}

function validateEvidence(evidence, body, mode, nowMs, targetCommit) {
  const keys = mode === "core" ? CORE_EVIDENCE_KEYS : NYRA_EVIDENCE_KEYS;
  if (!exactKeys(evidence, keys)) return false;
  const context = body.context;
  const fixed = {
    schema_version: mode === "core"
      ? "core_mcp_staging_independent_evidence_v1"
      : "nyra_mcp_staging_independent_evidence_v1",
    verified: true,
    mode,
    request_nonce: body.request_nonce,
    tenant_id: TENANT_ID,
    target_service: TARGET_SERVICE,
    target_environment: TARGET_ENVIRONMENT,
    target_commit: targetCommit,
    attempt_id: context.attempt_id,
    deployment_spec_digest: context.deployment_spec_digest,
    preflight_digest: context.preflight_digest,
    credential_grant_digest: context.credential_grant_digest,
    credential_receipt_verified: true,
    action_digest: context.action_digest,
    executor_contract_id: context.executor_contract_id,
  };
  for (const [key, expected] of Object.entries(fixed)) {
    if (evidence[key] !== expected) return false;
  }
  if (!exactDigest(evidence.credential_receipt_digest) ||
      evidence.executor_contract_id !== `domain_action_${evidence.action_digest.slice(0, 20)}` ||
      !exactIso(evidence.verified_at) || !exactIso(evidence.expires_at)) return false;
  const verifiedAt = Date.parse(evidence.verified_at);
  const expiresAt = Date.parse(evidence.expires_at);
  if (verifiedAt > nowMs || expiresAt <= nowMs || expiresAt <= verifiedAt ||
      expiresAt - verifiedAt > MAX_TTL_SECONDS * 1_000) return false;
  if (mode === "nyra") {
    return evidence.decision === "no_objection" && evidence.risk_band === "bounded_staging";
  }
  return evidence.credential_execution_id === context.credential_execution_id &&
    evidence.decision === "allow" && evidence.state === "authorized_after_confirmation" &&
    evidence.scope === "reversible_owner_confirmed_mcp_staging_service" &&
    evidence.domain_action_id === "skinharmony_mcp_staging_render_create_v1" &&
    evidence.credential_action_digest === context.credential_action_digest &&
    evidence.credential_executor_contract_id === context.credential_executor_contract_id &&
    evidence.owner_confirmation_verified === true &&
    /^[A-Za-z0-9._:-]{8,160}$/.test(evidence.confirmation_reference) &&
    exactDigest(evidence.owner_confirmation_digest) &&
    evidence.nyra_attestation_verified === true &&
    evidence.nyra_attestation_digest === context.nyra_attestation_digest &&
    /^key_[a-z0-9-]{8,}$/i.test(evidence.core_key_id) &&
    evidence.revalidation_required === true;
}

function issueEnvelope({ body, mode, evidence, issuer, privateKey, nowMs, ttlSeconds, targetCommit }) {
  const context = body.context;
  const issuedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(Math.min(
    nowMs + ttlSeconds * 1_000,
    Date.parse(evidence.expires_at),
  )).toISOString();
  const common = {
    issuer,
    audience: AUDIENCE,
    request_kind: body.request_kind,
    tenant_id: TENANT_ID,
    domain_pack_id: "skinharmony",
    target_service: TARGET_SERVICE,
    target_environment: TARGET_ENVIRONMENT,
    target_commit: targetCommit,
    attempt_id: context.attempt_id,
    deployment_spec_digest: context.deployment_spec_digest,
    preflight_digest: context.preflight_digest,
    credential_grant_digest: context.credential_grant_digest,
    action_digest: context.action_digest,
    executor_contract_id: context.executor_contract_id,
    issued_at: issuedAt,
    expires_at: expiresAt,
    nonce: body.request_nonce,
  };
  const claims = mode === "nyra" ? {
    schema_version: "nyra_mcp_staging_deploy_attestation_v1",
    ...common,
    decision: evidence.decision,
    role: "advisory_veto",
    execution_allowed: false,
    risk_band: evidence.risk_band,
  } : {
    schema_version: "core_mcp_staging_render_grant_v1",
    ...common,
    decision: evidence.decision,
    state: evidence.state,
    scope: evidence.scope,
    domain_action_id: evidence.domain_action_id,
    core_key_id: evidence.core_key_id,
    core_key_type: "staging_executor",
    core_key_scope: "mcp_staging_render_create",
    credential_execution_id: context.credential_execution_id,
    credential_action_digest: context.credential_action_digest,
    credential_executor_contract_id: context.credential_executor_contract_id,
    credential_receipt_verified: evidence.credential_receipt_verified,
    nyra_attestation_digest: evidence.nyra_attestation_digest,
    confirmation_reference: evidence.confirmation_reference,
    owner_confirmation_digest: evidence.owner_confirmation_digest,
    confirmation_satisfied: evidence.owner_confirmation_verified,
    revalidation_required: evidence.revalidation_required,
    nyra_available: evidence.nyra_attestation_verified,
  };
  const expectedClaims = mode === "core" ? CORE_CLAIM_KEYS : NYRA_CLAIM_KEYS;
  if (!exactKeys(claims, expectedClaims)) throw new Error("issuer_claim_contract_invalid");
  const signature = crypto.sign(null, Buffer.from(canonicalJson(claims), "utf8"), privateKey).toString("base64url");
  return { claims, signature };
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
        const text = Buffer.concat(chunks).toString("utf8");
        finish(null, JSON.parse(text));
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

function createRateLimiter(limit) {
  const buckets = new Map();
  return (identity, nowMs) => {
    const current = buckets.get(identity);
    if (current) {
      if (nowMs < current.started_at) return false;
      if (nowMs - current.started_at < 60_000) {
        current.count += 1;
        return current.count <= limit;
      }
      buckets.delete(identity);
    }
    for (const [key, bucket] of buckets) {
      if (nowMs >= bucket.started_at && nowMs - bucket.started_at >= 60_000) buckets.delete(key);
    }
    if (buckets.size >= RATE_LIMIT_IDENTITY_CAPACITY) return false;
    buckets.set(identity, { started_at: nowMs, count: 1 });
    return true;
  };
}

function createInMemoryReplayStore() {
  const claims = new Map();
  return Object.freeze({
    durable: false,
    async claim({ nonce, expires_at: expiresAt, now_ms: nowMs }) {
      for (const [key, expires] of claims) {
        if (expires <= nowMs) claims.delete(key);
      }
      if (claims.has(nonce)) return false;
      if (claims.size >= REPLAY_LIMIT) throw new Error("issuer_replay_capacity_exhausted");
      claims.set(nonce, expiresAt);
      return true;
    },
  });
}

export function createMcpStagingIssuerRuntime(options = {}) {
  if (!isPlainObject(options)) configFail("issuer_options_invalid");
  const allowedOptions = new Set([
    "mode",
    "startupMode",
    "signingSecret",
    "authToken",
    "ttlSeconds",
    "bodyLimit",
    "bodyTimeoutMs",
    "evidenceTimeoutMs",
    "rateLimitPerMinute",
    "now",
    "evidenceVerifier",
    "replayStore",
    "logger",
    "targetCommit",
  ]);
  if (Reflect.ownKeys(options).some((key) => typeof key !== "string" || !allowedOptions.has(key))) {
    configFail("issuer_options_invalid");
  }
  const mode = options.mode;
  if (mode !== "core" && mode !== "nyra") configFail("issuer_mode_invalid");
  let targetCommit;
  try {
    targetCommit = requireMcpStagingTargetCommit(options.targetCommit);
  } catch {
    configFail("issuer_target_commit_invalid");
  }
  const startupMode = options.startupMode === undefined ? "full" : options.startupMode;
  if (startupMode !== "full" && startupMode !== "jwks_only") {
    configFail("issuer_startup_mode_invalid");
  }
  if (!validSecret(options.signingSecret)) configFail("issuer_signing_secret_invalid");
  const keyPair = deriveEd25519Key(options.signingSecret, mode);
  const jwk = publicJwk(keyPair.publicKey);
  const issuer = mode === "core" ? "universal-core" : "nyra";
  const endpoint = MCP_STAGING_ISSUER_CONTRACT.endpoints[mode];

  if (startupMode === "jwks_only") {
    async function handle(req, res) {
      const pathname = (() => {
        try {
          return new URL(req.url || "/", "http://issuer.invalid").pathname;
        } catch {
          return "/invalid";
        }
      })();
      if (req.method === "GET" && pathname === "/healthz") {
        return send(res, 200, {
          ok: true,
          service: SERVICE,
          mode,
          issuer,
          bootstrap_phase: "jwks_only",
          issuance_ready: false,
          auth_required: false,
          signing_algorithm: "EdDSA",
          kid: jwk.kid,
          evidence_verifier_configured: false,
          replay_store_durable: false,
        });
      }
      if (req.method === "GET" && pathname === "/.well-known/jwks.json") {
        return send(res, 200, { keys: [jwk] });
      }
      if (req.method === "POST" && Object.values(MCP_STAGING_ISSUER_CONTRACT.endpoints).includes(pathname)) {
        return publicError(res, 503, "issuer_bootstrap_only");
      }
      return publicError(res, 404, "not_found");
    }

    return Object.freeze({
      mode,
      issuer,
      endpoint,
      startupMode,
      issuanceReady: false,
      jwk,
      handle,
    });
  }

  if (!validSecret(options.authToken)) configFail("issuer_auth_token_invalid");
  const ttlSeconds = options.ttlSeconds === undefined ? DEFAULT_TTL_SECONDS : Number(options.ttlSeconds);
  const bodyLimit = options.bodyLimit === undefined ? DEFAULT_BODY_LIMIT : Number(options.bodyLimit);
  const bodyTimeoutMs = options.bodyTimeoutMs === undefined ? DEFAULT_BODY_TIMEOUT_MS : Number(options.bodyTimeoutMs);
  const evidenceTimeoutMs = options.evidenceTimeoutMs === undefined ? 3_000 : Number(options.evidenceTimeoutMs);
  const rateLimit = options.rateLimitPerMinute === undefined ? DEFAULT_RATE_LIMIT : Number(options.rateLimitPerMinute);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) configFail("issuer_ttl_invalid");
  if (!Number.isInteger(bodyLimit) || bodyLimit < 1_024 || bodyLimit > 65_536) configFail("issuer_body_limit_invalid");
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 100 || bodyTimeoutMs > 10_000) configFail("issuer_body_timeout_invalid");
  if (!Number.isInteger(evidenceTimeoutMs) || evidenceTimeoutMs < 10 || evidenceTimeoutMs > 10_000) {
    configFail("issuer_evidence_timeout_invalid");
  }
  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 300) configFail("issuer_rate_limit_invalid");
  const now = options.now === undefined ? Date.now : options.now;
  if (typeof now !== "function") configFail("issuer_runtime_source_invalid");
  if (options.evidenceVerifier !== undefined && typeof options.evidenceVerifier !== "function") {
    configFail("issuer_evidence_verifier_invalid");
  }
  const evidenceVerifier = options.evidenceVerifier;
  const replayStore = options.replayStore === undefined ? createInMemoryReplayStore() : options.replayStore;
  if (!replayStore || typeof replayStore !== "object" || typeof replayStore.claim !== "function" ||
      typeof replayStore.durable !== "boolean") {
    configFail("issuer_replay_store_invalid");
  }
  const logger = options.logger;

  const { privateKey } = keyPair;
  const expectedAuthDigest = authDigest(options.authToken);
  const wrongEndpoint = MCP_STAGING_ISSUER_CONTRACT.endpoints[mode === "core" ? "nyra" : "core"];
  const rateAllowed = createRateLimiter(rateLimit);

  async function handle(req, res) {
    const pathname = (() => {
      try {
        return new URL(req.url || "/", "http://issuer.invalid").pathname;
      } catch {
        return "/invalid";
      }
    })();
    if (req.method === "GET" && pathname === "/healthz") {
      const verifierConfigured = typeof evidenceVerifier === "function";
      return send(res, verifierConfigured ? 200 : 503, {
        ok: verifierConfigured,
        service: SERVICE,
        mode,
        issuer,
        contract_version: "mcp_staging_signed_issuer_evidence_v1",
        endpoint,
        auth_required: true,
        signing_algorithm: "EdDSA",
        kid: jwk.kid,
        evidence_verifier_configured: verifierConfigured,
        replay_store_durable: replayStore.durable,
      });
    }
    if (req.method === "GET" && pathname === "/.well-known/jwks.json") {
      return send(res, 200, { keys: [jwk] });
    }
    if (pathname === wrongEndpoint) return publicError(res, 404, "not_found");
    if (pathname !== endpoint) return publicError(res, 404, "not_found");
    if (req.method !== "POST") return publicError(res, 405, "method_not_allowed");

    if (!authorized(req.headers.authorization, expectedAuthDigest)) {
      safeLog(logger, "auth_rejected", mode, 401);
      return publicError(res, 401, "issuer_auth_required");
    }
    const identity = String(req.socket?.remoteAddress || "unknown").slice(0, 128);
    let nowMs;
    try {
      nowMs = now();
      if (!Number.isFinite(nowMs)) throw new Error("invalid_time");
    } catch {
      safeLog(logger, "issuer_unavailable", mode, 503);
      return publicError(res, 503, "issuer_unavailable");
    }
    if (!rateAllowed(identity, nowMs)) {
      safeLog(logger, "rate_limited", mode, 429);
      return publicError(res, 429, "rate_limit_exceeded");
    }
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      return publicError(res, 415, "application_json_required");
    }
    const declaredLength = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > bodyLimit) {
      return publicError(res, 413, "request_body_too_large");
    }

    let body;
    try {
      body = await readJsonBody(req, bodyLimit, bodyTimeoutMs);
    } catch (error) {
      const status = error?.message === "body_too_large" ? 413 : 400;
      return publicError(res, status, status === 413 ? "request_body_too_large" : "issuer_request_invalid");
    }
    if (!validateRequest(body, mode, targetCommit)) return publicError(res, 400, "issuer_request_invalid");
    if (typeof evidenceVerifier !== "function") {
      safeLog(logger, "evidence_unavailable", mode, 503);
      return publicError(res, 503, "issuer_evidence_unavailable");
    }

    try {
      const claimed = await replayStore.claim(Object.freeze({
        mode,
        nonce: body.request_nonce,
        now_ms: nowMs,
        expires_at: nowMs + ttlSeconds * 1_000,
      }));
      if (claimed !== true) return publicError(res, 409, "issuer_request_replay");
    } catch {
      safeLog(logger, "replay_store_unavailable", mode, 503);
      return publicError(res, 503, "issuer_replay_store_unavailable");
    }

    let evidence;
    try {
      const verifierRequest = deepFreeze({
        schema_version: "mcp_staging_issuer_evidence_verification_request_v1",
        mode,
        request_kind: body.request_kind,
        request_nonce: body.request_nonce,
        context: structuredClone(body.context),
        artifacts: structuredClone(body.evidence),
      });
      let timeout;
      try {
        evidence = await Promise.race([
          Promise.resolve().then(() => evidenceVerifier(verifierRequest)),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("evidence_timeout")), evidenceTimeoutMs);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    } catch {
      safeLog(logger, "evidence_unavailable", mode, 503);
      return publicError(res, 503, "issuer_evidence_unavailable");
    }
    if (!validateEvidence(evidence, body, mode, nowMs, targetCommit)) {
      safeLog(logger, "evidence_rejected", mode, 403);
      return publicError(res, 403, "issuer_evidence_rejected");
    }

    try {
      const envelope = issueEnvelope({
        body,
        mode,
        evidence,
        issuer,
        privateKey,
        nowMs,
        ttlSeconds,
        targetCommit,
      });
      safeLog(logger, "evidence_issued", mode, 201);
      return send(res, 201, envelope);
    } catch {
      safeLog(logger, "issuer_unavailable", mode, 503);
      return publicError(res, 503, "issuer_unavailable");
    }
  }

  return Object.freeze({
    mode,
    issuer,
    endpoint,
    jwk,
    handle,
  });
}

export function createMcpStagingIssuerRuntimeFromEnv(env = process.env, options = {}) {
  if (!env || typeof env !== "object" || env.MCP_STAGING_ENVIRONMENT !== TARGET_ENVIRONMENT) {
    configFail("issuer_staging_confirmation_required");
  }
  return createMcpStagingIssuerRuntime({
    ...options,
    mode: env.MCP_STAGING_ISSUER_MODE,
    startupMode: env.MCP_STAGING_ISSUER_STARTUP_MODE || "full",
    signingSecret: env.MCP_STAGING_ISSUER_SIGNING_SECRET,
    authToken: env.MCP_STAGING_ISSUER_AUTH_TOKEN,
    ttlSeconds: env.MCP_STAGING_ISSUER_TTL_SECONDS || undefined,
  });
}

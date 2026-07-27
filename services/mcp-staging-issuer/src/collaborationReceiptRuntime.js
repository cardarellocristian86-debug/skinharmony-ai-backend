import crypto from "node:crypto";

const TENANT_ID = "codexai";
const TARGET_SERVICE = "skinharmony-core-mcp-staging";
const TARGET_ENVIRONMENT = "staging";
const SERVICE = "mcp-staging-collaboration-receipt-issuer";
const MAX_TTL_MS = 30_000;
const DEFAULT_TTL_MS = 20_000;
const DEFAULT_BODY_LIMIT = 64 * 1_024;
const DEFAULT_BODY_TIMEOUT_MS = 3_000;
const CLOCK_SKEW_MS = 5_000;
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const ENDPOINTS = Object.freeze({
  core: "/v1/mcp-staging/collaboration/core-grant",
  nyra: "/v1/mcp-staging/collaboration/nyra-attest",
});
const ISSUERS = Object.freeze({
  core: "universal-core-staging",
  nyra: "nyra-staging",
});
const BINDING_KEYS = Object.freeze([
  "schema_version", "audience", "target_service", "target_environment", "target_commit",
  "tenant_id", "actor_subject_sha256", "agent_id", "session_id", "session_fingerprint",
  "agent_signature_sha256", "trace_id", "preflight_id", "task_contract_id", "task_trace_id",
  "coordination_lock", "shared_memory_checksum", "tool_name", "action_type", "target",
  "payload_sha256", "expected_version", "lock_id", "fencing_token", "idempotency_key_sha256",
]);
const DECISION_KEYS = Object.freeze([
  "schema_version", "binding_digest", "allowed", "decision", "mediation", "confirmation_satisfied",
]);
const NYRA_CLAIM_KEYS = Object.freeze([
  "schema_version", "issuer", "audience", "kid", "role", "decision", "execution_allowed",
  "binding_digest", "jti", "issued_at", "expires_at", "nonce",
]);
const CORE_CLAIM_KEYS = Object.freeze([
  "schema_version", "issuer", "audience", "kid", "role", "decision", "execution_allowed",
  "binding_digest", "core_decision_digest", "nyra_attestation_digest", "jti",
  "issued_at", "expires_at", "nonce",
]);
const REQUEST_KEYS = Object.freeze({
  nyra: Object.freeze(["request_kind", "binding", "jti", "requested_ttl_ms", "nonce"]),
  core: Object.freeze([
    "request_kind", "binding", "decision", "jti", "requested_ttl_ms", "nonce",
    "nyra_attestation", "core_gate",
  ]),
});
const JWK_KEYS = Object.freeze(["alg", "crv", "kid", "kty", "use", "x"]);
const ACTION_TO_TOOL = Object.freeze({
  "agent.heartbeat": "agent_heartbeat",
  "task.create": "task_create",
  "task.claim": "task_claim",
  "task.update": "task_update",
  "message.post": "message_post",
  "message.acknowledge": "message_acknowledge",
  "workspace.create_folder": "workspace_create_folder",
  "workspace.write_document": "workspace_write_document",
  "workspace.lock_acquire": "workspace_lock_acquire",
  "workspace.lock_renew": "workspace_lock_renew",
  "workspace.lock_release": "workspace_lock_release",
  "memory.append": "memory_append",
  "memory.checkpoint": "memory_checkpoint",
  "memory.handoff": "memory_handoff",
  "memory.handoff_acknowledge": "memory_handoff_acknowledge",
  "canonical.bootstrap": "canonical_bootstrap_import",
});
const VERSIONED_ACTIONS = new Set(["task.claim", "task.update", "workspace.write_document"]);
const FENCED_ACTIONS = new Set([
  "task.update", "workspace.create_folder", "workspace.write_document",
  "workspace.lock_renew", "workspace.lock_release",
]);
const IDEMPOTENT_ACTIONS = new Set([
  "task.create", "message.post", "workspace.create_folder", "workspace.write_document",
  "workspace.lock_acquire", "workspace.lock_renew", "memory.append", "memory.checkpoint",
  "memory.handoff",
  "canonical.bootstrap",
]);
const ALLOWED_DECISIONS = new Set([
  "allow", "allowed", "allow_controlled", "allow_advisory", "authorized",
  "authorized_after_confirmation",
]);
const ALLOWED_MEDIATIONS = new Set(["allow", "confirmed"]);

export class CollaborationReceiptRuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = "CollaborationReceiptRuntimeError";
    this.code = code;
  }
}

function configFail(code) {
  throw new CollaborationReceiptRuntimeError(code);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) return false;
  const expected = [...keys].sort();
  actual.sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

export function collaborationReceiptCanonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(collaborationReceiptCanonicalJson).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) throw new Error("non_canonical_value");
      return `${JSON.stringify(key)}:${collaborationReceiptCanonicalJson(value[key])}`;
    }).join(",")}}`;
  }
  throw new Error("non_canonical_value");
}

export function collaborationReceiptDigest(label, value) {
  return crypto.createHash("sha256")
    .update(String(label))
    .update("\0")
    .update(collaborationReceiptCanonicalJson(value))
    .digest("hex");
}

function exactDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function exactUuid(value) {
  return typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

function boundedText(value, maxLength, pattern = null) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value) && (!pattern || pattern.test(value));
}

function exactIso(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4_096 &&
    /^[\x21-\x7e]+$/.test(value);
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
    return Object.freeze({ privateKey, publicKey: crypto.createPublicKey(privateKey) });
  } catch {
    configFail("collaboration_receipt_signing_key_derivation_failed");
  } finally {
    master.fill(0);
    if (seed) seed.fill(0);
  }
}

function publicKeyFingerprint(publicKey) {
  return `ed25519-sha256:${crypto.createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex")}`;
}

function publicJwk(publicKey) {
  const exported = publicKey.export({ format: "jwk" });
  return Object.freeze({
    alg: "EdDSA",
    crv: "Ed25519",
    kid: publicKeyFingerprint(publicKey),
    kty: "OKP",
    use: "sig",
    x: exported.x,
  });
}

function parseNyraPublicKey(value) {
  let key;
  try {
    key = value?.type === "public"
      ? value
      : crypto.createPublicKey({ key: value, format: "jwk" });
  } catch {
    configFail("collaboration_nyra_public_key_invalid");
  }
  if (key?.asymmetricKeyType !== "ed25519") {
    configFail("collaboration_nyra_public_key_invalid");
  }
  return key;
}

function authDigest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

function authorized(header, expectedDigest) {
  const match = typeof header === "string" ? header.match(/^Bearer ([\x21-\x7e]+)$/) : null;
  if (!match) return false;
  const actual = authDigest(match[1]);
  return actual.length === expectedDigest.length && crypto.timingSafeEqual(actual, expectedDigest);
}

function validateBinding(binding, expected) {
  if (!exactKeys(binding, BINDING_KEYS) ||
      binding.schema_version !== "mcp_collaboration_action_binding_v1" ||
      binding.audience !== expected.audience ||
      binding.target_service !== TARGET_SERVICE ||
      binding.target_environment !== TARGET_ENVIRONMENT ||
      binding.target_commit !== expected.targetCommit ||
      binding.tenant_id !== TENANT_ID ||
      !exactDigest(binding.actor_subject_sha256) ||
      !boundedText(binding.agent_id, 64, /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/) ||
      !boundedText(binding.session_id, 64, /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/) ||
      !boundedText(binding.session_fingerprint, 128, /^[A-Za-z0-9_-]{16,128}$/) ||
      !exactDigest(binding.agent_signature_sha256) ||
      !exactUuid(binding.trace_id) ||
      !boundedText(binding.preflight_id, 160, /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/) ||
      !boundedText(binding.task_contract_id, 240) ||
      !boundedText(binding.task_trace_id, 240) ||
      !boundedText(binding.coordination_lock, 240) ||
      !exactDigest(binding.shared_memory_checksum) ||
      !boundedText(binding.target, 500) ||
      !exactDigest(binding.payload_sha256)) {
    return false;
  }
  const expectedTool = ACTION_TO_TOOL[binding.action_type];
  if (!expectedTool || binding.tool_name !== expectedTool) return false;

  const versioned = VERSIONED_ACTIONS.has(binding.action_type);
  if (versioned) {
    if (!Number.isSafeInteger(binding.expected_version) || binding.expected_version < 0 ||
        (binding.action_type !== "workspace.write_document" && binding.expected_version < 1)) {
      return false;
    }
  } else if (binding.expected_version !== null) {
    return false;
  }

  const fenced = FENCED_ACTIONS.has(binding.action_type);
  if (fenced) {
    if (!exactUuid(binding.lock_id) || !Number.isSafeInteger(binding.fencing_token) ||
        binding.fencing_token < 1) return false;
  } else if (binding.lock_id !== null || binding.fencing_token !== null) {
    return false;
  }

  const idempotent = IDEMPOTENT_ACTIONS.has(binding.action_type);
  if (idempotent ? !exactDigest(binding.idempotency_key_sha256) :
    binding.idempotency_key_sha256 !== null) {
    return false;
  }
  return true;
}

function validateDecision(decision, bindingDigest) {
  if (!exactKeys(decision, DECISION_KEYS) ||
      decision.schema_version !== "mcp_collaboration_core_decision_v1" ||
      decision.binding_digest !== bindingDigest ||
      decision.allowed !== true ||
      !ALLOWED_DECISIONS.has(decision.decision) ||
      !ALLOWED_MEDIATIONS.has(decision.mediation) ||
      typeof decision.confirmation_satisfied !== "boolean") {
    return false;
  }
  const confirmedDecision = decision.decision === "authorized_after_confirmation";
  const confirmedMediation = decision.mediation === "confirmed";
  if ((confirmedDecision || confirmedMediation) && decision.confirmation_satisfied !== true) {
    return false;
  }
  return true;
}

function verifyEnvelope(envelope, publicKey, claimKeys) {
  if (!exactKeys(envelope, ["claims", "signature"]) ||
      !exactKeys(envelope.claims, claimKeys) ||
      typeof envelope.signature !== "string") return false;
  let signature;
  try {
    signature = Buffer.from(envelope.signature, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== envelope.signature) {
      return false;
    }
    return crypto.verify(
      null,
      Buffer.from(collaborationReceiptCanonicalJson(envelope.claims), "utf8"),
      publicKey,
      signature,
    );
  } catch {
    return false;
  }
}

function validateNyraEnvelope(envelope, {
  publicKey,
  kid,
  audience,
  bindingDigest,
  jti,
  nowMs,
}) {
  if (!verifyEnvelope(envelope, publicKey, NYRA_CLAIM_KEYS)) return null;
  const claims = envelope.claims;
  if (claims.schema_version !== "mcp_collaboration_nyra_attestation_v1" ||
      claims.issuer !== ISSUERS.nyra ||
      claims.audience !== audience ||
      claims.kid !== kid ||
      claims.role !== "advisory_veto" ||
      claims.decision !== "no_objection" ||
      claims.execution_allowed !== false ||
      claims.binding_digest !== bindingDigest ||
      claims.jti !== jti ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(String(claims.nonce || "")) ||
      !exactIso(claims.issued_at) ||
      !exactIso(claims.expires_at)) {
    return null;
  }
  const issuedAt = Date.parse(claims.issued_at);
  const expiresAt = Date.parse(claims.expires_at);
  if (issuedAt > nowMs + CLOCK_SKEW_MS || expiresAt <= nowMs ||
      expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TTL_MS) {
    return null;
  }
  return Object.freeze({ claims, expiresAt });
}

function signEnvelope(claims, privateKey) {
  return Object.freeze({
    claims: Object.freeze(claims),
    signature: crypto.sign(
      null,
      Buffer.from(collaborationReceiptCanonicalJson(claims), "utf8"),
      privateKey,
    ).toString("base64url"),
  });
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

function readJsonBody(req, limit, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let length = 0;
    const chunks = [];
    const finish = (error, body) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeListener?.("data", onData);
      req.removeListener?.("end", onEnd);
      req.removeListener?.("error", onError);
      req.removeListener?.("aborted", onAborted);
      if (error) reject(error);
      else resolve(body);
    };
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > limit) finish(new Error("body_too_large"));
      else chunks.push(bytes);
    };
    const onEnd = () => {
      try {
        if (length === 0) throw new Error("empty_body");
        finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        finish(new Error("invalid_json"));
      }
    };
    const onError = () => finish(new Error("body_unavailable"));
    const onAborted = () => finish(new Error("body_unavailable"));
    const timer = setTimeout(() => finish(new Error("body_timeout")), timeoutMs);
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}

function validRequest(body, mode, expected, coreGateVerifier) {
  if (!exactKeys(body, REQUEST_KEYS[mode]) ||
      body.request_kind !== "issue" ||
      !validateBinding(body.binding, expected) ||
      !/^mcpcr_[A-Za-z0-9_-]{16,128}$/.test(String(body.jti || "")) ||
      !Number.isSafeInteger(body.requested_ttl_ms) ||
      body.requested_ttl_ms < 1_000 ||
      body.requested_ttl_ms > MAX_TTL_MS ||
      !/^[A-Za-z0-9_-]{32}$/.test(String(body.nonce || ""))) {
    return false;
  }
  if (mode === "core") {
    const bindingDigest = collaborationReceiptDigest(
      "mcp-collaboration-binding-v1",
      body.binding,
    );
    if (!validateDecision(body.decision, bindingDigest)) return false;
    try {
      coreGateVerifier.verify(body.core_gate, {
        binding: body.binding,
        decision: body.decision,
      });
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

export function createCollaborationReceiptRuntime(options = {}) {
  if (!isPlainObject(options)) configFail("collaboration_receipt_options_invalid");
  const allowedOptions = new Set([
    "mode", "signingSecret", "authToken", "replayStore", "audience", "targetCommit",
    "ttlMs", "bodyLimit", "bodyTimeoutMs", "now", "nyraPublicKey", "coreGateVerifier",
  ]);
  if (Reflect.ownKeys(options).some((key) =>
    typeof key !== "string" || !allowedOptions.has(key))) {
    configFail("collaboration_receipt_options_invalid");
  }
  const mode = options.mode;
  if (mode !== "core" && mode !== "nyra") configFail("collaboration_receipt_mode_invalid");
  if (!validSecret(options.signingSecret)) {
    configFail("collaboration_receipt_signing_secret_invalid");
  }
  if (!validSecret(options.authToken)) configFail("collaboration_receipt_auth_token_invalid");
  if (!options.replayStore || options.replayStore.durable !== true ||
      typeof options.replayStore.claim !== "function") {
    configFail("collaboration_receipt_durable_replay_store_required");
  }
  if (!boundedText(options.audience, 500)) {
    configFail("collaboration_receipt_audience_invalid");
  }
  if (typeof options.targetCommit !== "string" ||
      !/^[a-f0-9]{40}$/.test(options.targetCommit)) {
    configFail("collaboration_receipt_target_commit_invalid");
  }
  const ttlMs = options.ttlMs === undefined ? DEFAULT_TTL_MS : Number(options.ttlMs);
  const bodyLimit = options.bodyLimit === undefined ? DEFAULT_BODY_LIMIT : Number(options.bodyLimit);
  const bodyTimeoutMs = options.bodyTimeoutMs === undefined
    ? DEFAULT_BODY_TIMEOUT_MS
    : Number(options.bodyTimeoutMs);
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > MAX_TTL_MS) {
    configFail("collaboration_receipt_ttl_invalid");
  }
  if (!Number.isInteger(bodyLimit) || bodyLimit < 1_024 || bodyLimit > DEFAULT_BODY_LIMIT) {
    configFail("collaboration_receipt_body_limit_invalid");
  }
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 100 || bodyTimeoutMs > 10_000) {
    configFail("collaboration_receipt_body_timeout_invalid");
  }
  const now = options.now === undefined ? Date.now : options.now;
  if (typeof now !== "function") configFail("collaboration_receipt_clock_invalid");

  const { privateKey, publicKey } = deriveEd25519Key(options.signingSecret, mode);
  const jwk = publicJwk(publicKey);
  let nyraPublicKey;
  let nyraKid;
  if (mode === "core") {
    if (!options.nyraPublicKey) configFail("collaboration_nyra_public_key_required");
    if (!options.coreGateVerifier || typeof options.coreGateVerifier.verify !== "function") {
      configFail("collaboration_core_gate_verifier_required");
    }
    nyraPublicKey = parseNyraPublicKey(options.nyraPublicKey);
    nyraKid = publicKeyFingerprint(nyraPublicKey);
    if (nyraKid === jwk.kid) configFail("collaboration_receipt_independent_keys_required");
  } else if (options.nyraPublicKey !== undefined) {
    configFail("collaboration_receipt_options_invalid");
  }

  const endpoint = ENDPOINTS[mode];
  const wrongEndpoint = ENDPOINTS[mode === "core" ? "nyra" : "core"];
  const issuer = ISSUERS[mode];
  const expectedAuthDigest = authDigest(options.authToken);
  const expected = Object.freeze({
    audience: options.audience,
    targetCommit: options.targetCommit,
  });

  function readiness() {
    return Object.freeze({
      ok: true,
      service: SERVICE,
      mode,
      issuer,
      endpoint,
      tenant_id: TENANT_ID,
      target_service: TARGET_SERVICE,
      target_environment: TARGET_ENVIRONMENT,
      collaboration_receipt_ready: true,
      evidence_verifier_configured: true,
      replay_store_durable: true,
      core_gate_verifier_configured: mode === "core",
      signing_algorithm: "EdDSA",
      kid: jwk.kid,
    });
  }

  async function handle(req, res) {
    const pathname = (() => {
      try {
        return new URL(req.url || "/", "http://issuer.invalid").pathname;
      } catch {
        return "/invalid";
      }
    })();
    if (req.method === "GET" && pathname === "/healthz") {
      return send(res, 200, readiness());
    }
    if (req.method === "GET" && pathname === "/.well-known/jwks.json") {
      if (!authorized(req.headers?.authorization, expectedAuthDigest)) {
        return publicError(res, 401, "collaboration_receipt_auth_required");
      }
      return send(res, 200, {
        schema_version: "mcp_staging_private_jwks_v1",
        issuer,
        target_service: TARGET_SERVICE,
        target_environment: TARGET_ENVIRONMENT,
        target_commit: options.targetCommit,
        keys: [jwk],
      });
    }
    if (pathname === wrongEndpoint || pathname !== endpoint) {
      return publicError(res, 404, "not_found");
    }
    if (req.method !== "POST") return publicError(res, 405, "method_not_allowed");
    if (!authorized(req.headers?.authorization, expectedAuthDigest)) {
      return publicError(res, 401, "collaboration_receipt_auth_required");
    }
    if (!String(req.headers?.["content-type"] || "").toLowerCase()
      .startsWith("application/json")) {
      return publicError(res, 415, "application_json_required");
    }
    const declaredHeader = req.headers?.["content-length"];
    const declaredLength = declaredHeader === undefined ? null : Number(declaredHeader);
    if (declaredLength !== null &&
        (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
      return publicError(res, 400, "collaboration_receipt_request_invalid");
    }
    if (declaredLength !== null && declaredLength > bodyLimit) {
      return publicError(res, 413, "request_body_too_large");
    }

    let body;
    try {
      body = await readJsonBody(req, bodyLimit, bodyTimeoutMs);
    } catch (error) {
      const tooLarge = error?.message === "body_too_large";
      return publicError(
        res,
        tooLarge ? 413 : 400,
        tooLarge ? "request_body_too_large" : "collaboration_receipt_request_invalid",
      );
    }
    if (!validRequest(body, mode, expected, options.coreGateVerifier)) {
      return publicError(res, 400, "collaboration_receipt_request_invalid");
    }

    let nowMs;
    try {
      nowMs = Number(now());
      if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("invalid_clock");
    } catch {
      return publicError(res, 503, "collaboration_receipt_issuer_unavailable");
    }
    const requestedTtlMs = Math.min(ttlMs, body.requested_ttl_ms);
    try {
      const claimed = await options.replayStore.claim(Object.freeze({
        mode,
        nonce: body.nonce,
        now_ms: nowMs,
        expires_at: nowMs + requestedTtlMs,
      }));
      if (claimed !== true) {
        return publicError(res, 409, "collaboration_receipt_request_replay");
      }
    } catch {
      return publicError(res, 503, "collaboration_receipt_replay_store_unavailable");
    }

    const bindingDigest = collaborationReceiptDigest(
      "mcp-collaboration-binding-v1",
      body.binding,
    );
    let nyraEnvelope;
    let expirationLimit = nowMs + requestedTtlMs;
    if (mode === "core") {
      nyraEnvelope = validateNyraEnvelope(body.nyra_attestation, {
        publicKey: nyraPublicKey,
        kid: nyraKid,
        audience: expected.audience,
        bindingDigest,
        jti: body.jti,
        nowMs,
      });
      if (!nyraEnvelope) {
        return publicError(res, 403, "collaboration_nyra_attestation_rejected");
      }
      expirationLimit = Math.min(expirationLimit, nyraEnvelope.expiresAt);
    }

    try {
      const issuedAt = new Date(nowMs).toISOString();
      const expiresAt = new Date(expirationLimit).toISOString();
      const claims = mode === "nyra" ? {
        schema_version: "mcp_collaboration_nyra_attestation_v1",
        issuer,
        audience: expected.audience,
        kid: jwk.kid,
        role: "advisory_veto",
        decision: "no_objection",
        execution_allowed: false,
        binding_digest: bindingDigest,
        jti: body.jti,
        issued_at: issuedAt,
        expires_at: expiresAt,
        nonce: body.nonce,
      } : {
        schema_version: "mcp_collaboration_core_grant_v1",
        issuer,
        audience: expected.audience,
        kid: jwk.kid,
        role: "final_authority",
        decision: "allow",
        execution_allowed: true,
        binding_digest: bindingDigest,
        core_decision_digest: collaborationReceiptDigest(
          "mcp-collaboration-core-decision-v1",
          body.decision,
        ),
        nyra_attestation_digest: collaborationReceiptDigest(
          "mcp-collaboration-nyra-envelope-v1",
          body.nyra_attestation,
        ),
        jti: body.jti,
        issued_at: issuedAt,
        expires_at: expiresAt,
        nonce: body.nonce,
      };
      if (!exactKeys(claims, mode === "core" ? CORE_CLAIM_KEYS : NYRA_CLAIM_KEYS)) {
        throw new Error("claim_contract_invalid");
      }
      const envelope = signEnvelope(claims, privateKey);
      return send(res, 201, { ok: true, envelope });
    } catch {
      return publicError(res, 503, "collaboration_receipt_issuer_unavailable");
    }
  }

  return Object.freeze({
    mode,
    issuer,
    endpoint,
    ready: true,
    issuanceReady: true,
    collaborationReceiptReady: true,
    jwk,
    readiness,
    handle,
  });
}

export const collaborationReceiptIssuerContract = Object.freeze({
  service: SERVICE,
  tenant_id: TENANT_ID,
  target_service: TARGET_SERVICE,
  target_environment: TARGET_ENVIRONMENT,
  endpoints: ENDPOINTS,
  issuers: ISSUERS,
  max_ttl_ms: MAX_TTL_MS,
  action_to_tool: ACTION_TO_TOOL,
});

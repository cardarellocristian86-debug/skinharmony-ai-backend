import crypto from "node:crypto";
import { loadMcpStagingPublicTrustAnchor } from "./mcpStagingEvidence.js";
import { readMcpStagingBoundedJsonResponse } from "./mcpStagingBoundedJsonResponse.js";
import { requireMcpStagingTargetCommit } from "./mcpStagingTargetCommit.js";

const PRIVATE_ISSUER_ENDPOINTS = Object.freeze({
  core: Object.freeze({
    envKey: "MCP_STAGING_CORE_ISSUER_INTERNAL_HOSTPORT",
    serviceName: "skinharmony-core-staging-issuer",
    port: 8_789,
    path: "/v1/mcp-staging/core-grant",
  }),
  nyra: Object.freeze({
    envKey: "MCP_STAGING_NYRA_ISSUER_INTERNAL_HOSTPORT",
    serviceName: "skinharmony-nyra-staging-issuer",
    port: 8_789,
    path: "/v1/mcp-staging/nyra-attest",
  }),
});
const AUDIENCE = "mcp-staging-render-executor";
const TENANT_ID = "codexai";
const TARGET_SERVICE = "skinharmony-core-mcp-staging";
const TARGET_ENVIRONMENT = "staging";
const MAX_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const ENVELOPE_KEYS = Object.freeze(["claims", "signature"]);
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

const COMMON_CONTEXT_KEYS = Object.freeze([
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
const CORE_CONTEXT_KEYS = Object.freeze([
  ...COMMON_CONTEXT_KEYS,
  "nyra_attestation_digest",
]);
const SIGNED_COMMON_BINDING_KEYS = Object.freeze([
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
]);
const CORE_SIGNED_BINDING_KEYS = Object.freeze([
  ...SIGNED_COMMON_BINDING_KEYS,
  "credential_execution_id",
  "credential_action_digest",
  "credential_executor_contract_id",
  "nyra_attestation_digest",
]);

export const MCP_STAGING_SIGNED_ISSUER_ENDPOINT_CONTRACT = PRIVATE_ISSUER_ENDPOINTS;

export class McpStagingSignedIssuerClientError extends Error {
  constructor(code) {
    super(code);
    this.name = "McpStagingSignedIssuerClientError";
    this.code = code;
  }
}

function fail(code) {
  throw new McpStagingSignedIssuerClientError(code);
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
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactIso(value) {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function exactDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function parsePublicKey(value, code) {
  try {
    if (value instanceof crypto.KeyObject && value.type !== "public") throw new Error("private_key_rejected");
    if (typeof value === "string" && /PRIVATE KEY/.test(value)) throw new Error("private_key_rejected");
    const key = value instanceof crypto.KeyObject ? value : crypto.createPublicKey(value);
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new Error("wrong_key_type");
    return key;
  } catch {
    fail(code);
  }
}

function keyFingerprint(key) {
  return crypto.createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

function privateIssuerUrl(hostport, contract) {
  if (typeof hostport !== "string" || hostport.length < 1 || hostport.length > 253 ||
      hostport !== hostport.trim() || hostport.includes("://") || !/^[\x21-\x7e]+$/.test(hostport)) {
    fail("signed_issuer_endpoint_not_allowed");
  }
  let endpoint;
  try {
    endpoint = new URL(`http://${hostport}`);
  } catch {
    fail("signed_issuer_endpoint_not_allowed");
  }
  const expectedHost = new RegExp(`^${contract.serviceName}-[a-z0-9]+$`);
  const port = Number(endpoint.port);
  if (endpoint.protocol !== "http:" || endpoint.username || endpoint.password || endpoint.pathname !== "/" ||
      endpoint.search || endpoint.hash || !endpoint.port || endpoint.hostname.length > 63 ||
      !expectedHost.test(endpoint.hostname) ||
      port !== contract.port) {
    fail("signed_issuer_endpoint_not_allowed");
  }
  return `http://${endpoint.hostname}:${contract.port}${contract.path}`;
}

function validateEndpoints(endpoints) {
  if (!exactKeys(endpoints, ["core", "nyra"])) fail("signed_issuer_endpoint_not_allowed");
  return Object.freeze({
    core: privateIssuerUrl(endpoints.core, PRIVATE_ISSUER_ENDPOINTS.core),
    nyra: privateIssuerUrl(endpoints.nyra, PRIVATE_ISSUER_ENDPOINTS.nyra),
  });
}

function validateTransport(transport) {
  if (!exactKeys(transport, ["post"]) || typeof transport.post !== "function") {
    fail("signed_issuer_transport_invalid");
  }
  return transport.post.bind(transport);
}

function validateContext(context, issuer, targetCommit) {
  const keys = issuer === "core" ? CORE_CONTEXT_KEYS : COMMON_CONTEXT_KEYS;
  if (!exactKeys(context, keys)) fail(`${issuer}_issuer_context_invalid`);
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
    if (context[key] !== expected) fail(`${issuer}_issuer_context_invalid`);
  }
  for (const key of keys) {
    if (!(key in context) || typeof context[key] !== "string" || !context[key]) {
      fail(`${issuer}_issuer_context_invalid`);
    }
  }
  if (context.executor_contract_id !== `domain_action_${context.action_digest.slice(0, 20)}` ||
      context.credential_executor_contract_id !==
        `domain_action_${context.credential_action_digest.slice(0, 20)}`) {
    fail(`${issuer}_issuer_context_invalid`);
  }
  for (const key of [
    "deployment_spec_digest",
    "preflight_digest",
    "credential_grant_digest",
    "credential_action_digest",
    "nyra_attestation_digest",
    "action_digest",
  ]) {
    if (key in context && !exactDigest(context[key])) fail(`${issuer}_issuer_context_invalid`);
  }
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(context.attempt_id)) fail(`${issuer}_issuer_context_invalid`);
  return structuredClone(context);
}

function normalizeEvidenceArtifacts(value, issuer) {
  const keys = issuer === "core"
    ? ["credential_receipt", "nyra_attestation", "owner_confirmation"]
    : ["credential_receipt", "owner_confirmation"];
  if (!exactKeys(value, keys)) fail(`${issuer}_issuer_evidence_unavailable`);
  for (const key of keys) {
    const envelope = value[key];
    if (!exactKeys(envelope, ["claims", "signature"]) || !isPlainObject(envelope.claims) ||
        typeof envelope.signature !== "string" || envelope.signature.length < 80 || envelope.signature.length > 120) {
      fail(`${issuer}_issuer_evidence_unavailable`);
    }
  }
  return structuredClone(value);
}

async function transientEvidence(evidenceProvider, issuer, context) {
  if (typeof evidenceProvider !== "function") fail(`${issuer}_issuer_evidence_unavailable`);
  try {
    return normalizeEvidenceArtifacts(await evidenceProvider(issuer, structuredClone(context)), issuer);
  } catch (error) {
    if (error instanceof McpStagingSignedIssuerClientError) throw error;
    fail(`${issuer}_issuer_evidence_unavailable`);
  }
}

function requestBody(issuer, context, nonce, requestKind, evidence, targetCommit) {
  return Object.freeze({
    schema_version: "mcp_staging_signed_issuer_request_v1",
    request_kind: requestKind,
    requested_issuer: issuer === "core" ? "universal-core" : "nyra",
    audience: AUDIENCE,
    tenant_id: TENANT_ID,
    target_service: TARGET_SERVICE,
    target_environment: TARGET_ENVIRONMENT,
    target_commit: targetCommit,
    request_nonce: nonce,
    context: Object.freeze(context),
    evidence: Object.freeze(evidence),
  });
}

async function transientToken(tokenProvider, issuer) {
  if (typeof tokenProvider !== "function") fail(`${issuer}_issuer_auth_unavailable`);
  let token;
  try {
    token = await tokenProvider();
  } catch {
    fail(`${issuer}_issuer_auth_unavailable`);
  }
  if (typeof token !== "string" || token.length < 1 || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token)) {
    fail(`${issuer}_issuer_auth_unavailable`);
  }
  return token;
}

function responseParts(response) {
  if (!isPlainObject(response) || !Number.isInteger(response.status) || !("body" in response)) return null;
  return { status: response.status, body: response.body };
}

function verifyEnvelope(envelope, config, context, expectedNonce, expectedRequestKind, nowMs, targetCommit) {
  if (!exactKeys(envelope, ENVELOPE_KEYS) || !exactKeys(envelope.claims, config.claimKeys) ||
      typeof envelope.signature !== "string") {
    fail(`${config.id}_issuer_unsigned`);
  }
  let signature;
  try {
    signature = Buffer.from(envelope.signature, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== envelope.signature) {
      throw new Error("non_canonical_signature");
    }
  } catch {
    fail(`${config.id}_issuer_unsigned`);
  }
  let valid = false;
  try {
    valid = crypto.verify(
      null,
      Buffer.from(canonicalJson(envelope.claims), "utf8"),
      config.publicKey,
      signature,
    );
  } catch {
    valid = false;
  }
  if (!valid) fail(`${config.id}_issuer_signature_invalid`);

  const claims = envelope.claims;
  if (claims.schema_version !== config.schemaVersion || claims.issuer !== config.issuer ||
      claims.audience !== AUDIENCE || claims.tenant_id !== TENANT_ID ||
      claims.target_service !== TARGET_SERVICE || claims.target_environment !== TARGET_ENVIRONMENT ||
      claims.target_commit !== targetCommit || claims.nonce !== expectedNonce ||
      claims.request_kind !== expectedRequestKind) {
    fail(`${config.id}_issuer_contract_mismatch`);
  }
  const contextKeys = config.id === "core" ? CORE_SIGNED_BINDING_KEYS : SIGNED_COMMON_BINDING_KEYS;
  for (const key of contextKeys) {
    if (claims[key] !== context[key]) fail(`${config.id}_issuer_contract_mismatch`);
  }
  if (config.id === "core") {
    if (claims.decision !== "allow" || claims.state !== "authorized_after_confirmation" ||
        claims.scope !== "reversible_owner_confirmed_mcp_staging_service" ||
        claims.domain_action_id !== "skinharmony_mcp_staging_render_create_v1" ||
        claims.core_key_type !== "staging_executor" ||
        claims.core_key_scope !== "mcp_staging_render_create" ||
        claims.confirmation_satisfied !== true || claims.credential_receipt_verified !== true ||
        claims.revalidation_required !== true || claims.nyra_available !== true ||
        !/^key_[a-z0-9-]{8,}$/i.test(String(claims.core_key_id || "")) ||
        !exactDigest(claims.owner_confirmation_digest) ||
        claims.executor_contract_id !== `domain_action_${claims.action_digest.slice(0, 20)}` ||
        claims.credential_executor_contract_id !==
          `domain_action_${claims.credential_action_digest.slice(0, 20)}`) {
      fail("core_issuer_contract_mismatch");
    }
  } else if (claims.decision !== "no_objection" || claims.role !== "advisory_veto" ||
      claims.execution_allowed !== false || claims.risk_band !== "bounded_staging" ||
      claims.executor_contract_id !== `domain_action_${claims.action_digest.slice(0, 20)}`) {
    fail("nyra_issuer_contract_mismatch");
  }
  if (!exactIso(claims.issued_at) || !exactIso(claims.expires_at)) {
    fail(`${config.id}_issuer_ttl_invalid`);
  }
  const issuedAt = Date.parse(claims.issued_at);
  const expiresAt = Date.parse(claims.expires_at);
  if (issuedAt > nowMs || expiresAt <= nowMs || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TTL_MS) {
    fail(`${config.id}_issuer_ttl_invalid`);
  }
  return structuredClone(envelope);
}

function readNow(now) {
  let value;
  try {
    value = now();
  } catch {
    fail("signed_issuer_clock_invalid");
  }
  if (!Number.isSafeInteger(value) || value < 0) fail("signed_issuer_clock_invalid");
  return value;
}

async function boundedPost(post, request, timeoutMs, issuer) {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(() => post(request)),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new McpStagingSignedIssuerClientError(`${issuer}_issuer_timeout`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function invoke(
  post,
  config,
  context,
  tokenProvider,
  evidenceProvider,
  now,
  timeoutMs,
  targetCommit,
  requestKind = "issue",
) {
  const safeContext = validateContext(context, config.id, targetCommit);
  const nonce = crypto.randomBytes(24).toString("base64url");
  const evidence = await transientEvidence(evidenceProvider, config.id, safeContext);
  const token = await transientToken(tokenProvider, config.id);
  let response;
  try {
    response = await boundedPost(post, Object.freeze({
      url: config.endpoint,
      headers: Object.freeze({
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      }),
      body: requestBody(config.id, safeContext, nonce, requestKind, evidence, targetCommit),
    }), timeoutMs, config.id);
  } catch (error) {
    if (error instanceof McpStagingSignedIssuerClientError &&
        error.code === `${config.id}_issuer_timeout`) throw error;
    fail(`${config.id}_issuer_unavailable`);
  }
  const parts = responseParts(response);
  if (!parts || parts.status < 200 || parts.status >= 300) fail(`${config.id}_issuer_unavailable`);
  return verifyEnvelope(parts.body, config, safeContext, nonce, requestKind, readNow(now), targetCommit);
}

async function probeOne(post, config, context, tokenProvider, evidenceProvider, now, timeoutMs, targetCommit) {
  try {
    await invoke(
      post,
      config,
      context,
      tokenProvider,
      evidenceProvider,
      now,
      timeoutMs,
      targetCommit,
      "readiness_probe",
    );
    return Object.freeze({ status: "ready", reason: "signed_contract_ready" });
  } catch (error) {
    const code = error instanceof McpStagingSignedIssuerClientError ? error.code : "";
    if (code === `${config.id}_issuer_unsigned` || code === `${config.id}_issuer_signature_invalid` ||
        code === `${config.id}_issuer_contract_mismatch` || code === `${config.id}_issuer_ttl_invalid`) {
      return Object.freeze({ status: "unsigned", reason: "unsigned_or_contract_mismatch" });
    }
    return Object.freeze({ status: "unavailable", reason: "endpoint_or_auth_unavailable" });
  }
}

export function createMcpStagingSignedIssuerClients(options = {}) {
  if (!isPlainObject(options)) fail("signed_issuer_client_options_invalid");
  let targetCommit;
  try {
    targetCommit = requireMcpStagingTargetCommit(options.targetCommit);
  } catch {
    fail("signed_issuer_target_commit_invalid");
  }
  const endpoints = validateEndpoints(options.endpoints);
  const post = validateTransport(options.transport);
  const corePublicKey = parsePublicKey(options.corePublicKey, "core_issuer_public_key_invalid");
  const nyraPublicKey = parsePublicKey(options.nyraPublicKey, "nyra_issuer_public_key_invalid");
  if (keyFingerprint(corePublicKey) === keyFingerprint(nyraPublicKey)) {
    fail("signed_issuer_public_keys_not_independent");
  }
  const now = typeof options.now === "function" ? options.now : Date.now;
  const evidenceProvider = options.evidenceProvider;
  const timeoutMs = options.operationTimeoutMs === undefined
    ? DEFAULT_TIMEOUT_MS
    : Number(options.operationTimeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30_000) {
    fail("signed_issuer_timeout_invalid");
  }
  const core = Object.freeze({
    id: "core",
    issuer: "universal-core",
    endpoint: endpoints.core,
    schemaVersion: "core_mcp_staging_render_grant_v1",
    claimKeys: CORE_CLAIM_KEYS,
    publicKey: corePublicKey,
  });
  const nyra = Object.freeze({
    id: "nyra",
    issuer: "nyra",
    endpoint: endpoints.nyra,
    schemaVersion: "nyra_mcp_staging_deploy_attestation_v1",
    claimKeys: NYRA_CLAIM_KEYS,
    publicKey: nyraPublicKey,
  });

  return Object.freeze({
    requestCoreGrant(context, tokenProvider) {
      return invoke(post, core, context, tokenProvider, evidenceProvider, now, timeoutMs, targetCommit);
    },
    requestNyraAttestation(context, tokenProvider) {
      return invoke(post, nyra, context, tokenProvider, evidenceProvider, now, timeoutMs, targetCommit);
    },
    async probeReadiness(contexts, providers) {
      if (!exactKeys(contexts, ["core", "nyra"])) {
        fail("signed_issuer_probe_contexts_invalid");
      }
      if (!exactKeys(providers, ["coreTokenProvider", "nyraTokenProvider"]) ||
          typeof providers.coreTokenProvider !== "function" || typeof providers.nyraTokenProvider !== "function") {
        fail("signed_issuer_probe_providers_invalid");
      }
      const nyraStatus = await probeOne(
        post,
        nyra,
        contexts.nyra,
        providers.nyraTokenProvider,
        evidenceProvider,
        now,
        timeoutMs,
        targetCommit,
      );
      const coreStatus = await probeOne(
        post,
        core,
        contexts.core,
        providers.coreTokenProvider,
        evidenceProvider,
        now,
        timeoutMs,
        targetCommit,
      );
      return Object.freeze({
        schema_version: "mcp_staging_signed_issuer_readiness_v1",
        ready: coreStatus.status === "ready" && nyraStatus.status === "ready",
        core: coreStatus,
        nyra: nyraStatus,
      });
    },
  });
}

const GATE_CLIENT_ENV_KEYS = Object.freeze([
  PRIVATE_ISSUER_ENDPOINTS.core.envKey,
  PRIVATE_ISSUER_ENDPOINTS.nyra.envKey,
  "MCP_STAGING_CORE_ISSUER_PUBLIC_JWK",
  "MCP_STAGING_CORE_ISSUER_KID",
  "MCP_STAGING_CORE_ISSUER_AUTH_TOKEN",
  "MCP_STAGING_NYRA_ISSUER_PUBLIC_JWK",
  "MCP_STAGING_NYRA_ISSUER_KID",
  "MCP_STAGING_NYRA_ISSUER_AUTH_TOKEN",
]);

function scrubGateClientEnvironment(env) {
  for (const key of GATE_CLIENT_ENV_KEYS) {
    try { delete env[key]; } catch { /* Client errors never contain environment values. */ }
  }
}

function readGateClientEnvironment(env) {
  const values = Object.create(null);
  try {
    for (const key of GATE_CLIENT_ENV_KEYS) values[key] = env[key];
  } catch {
    fail("signed_issuer_gate_config_invalid");
  }
  return values;
}

export function createMcpStagingSignedIssuerGateClientFromEnv({
  env = process.env,
  fetchImpl = globalThis.fetch,
  evidenceProvider,
  now = Date.now,
  operationTimeoutMs = DEFAULT_TIMEOUT_MS,
  targetCommit: targetCommitValue,
} = {}) {
  let targetCommit;
  let coreToken;
  let nyraToken;
  let coreAnchor;
  let nyraAnchor;
  let endpointHostports;
  try {
    if (!env || typeof env !== "object" || typeof fetchImpl !== "function" ||
        typeof evidenceProvider !== "function") {
      fail("signed_issuer_gate_config_invalid");
    }
    try {
      targetCommit = requireMcpStagingTargetCommit(targetCommitValue);
    } catch {
      fail("signed_issuer_target_commit_invalid");
    }
    const values = readGateClientEnvironment(env);
    try {
      endpointHostports = {
        core: values[PRIVATE_ISSUER_ENDPOINTS.core.envKey],
        nyra: values[PRIVATE_ISSUER_ENDPOINTS.nyra.envKey],
      };
      validateEndpoints(endpointHostports);
    } catch {
      fail("signed_issuer_gate_endpoint_invalid");
    }
    try {
      coreAnchor = loadMcpStagingPublicTrustAnchor({
        authority: "core",
        jwkJson: values.MCP_STAGING_CORE_ISSUER_PUBLIC_JWK,
        expectedKid: values.MCP_STAGING_CORE_ISSUER_KID,
      });
      nyraAnchor = loadMcpStagingPublicTrustAnchor({
        authority: "nyra",
        jwkJson: values.MCP_STAGING_NYRA_ISSUER_PUBLIC_JWK,
        expectedKid: values.MCP_STAGING_NYRA_ISSUER_KID,
      });
    } catch {
      fail("signed_issuer_gate_trust_anchor_invalid");
    }
    coreToken = values.MCP_STAGING_CORE_ISSUER_AUTH_TOKEN;
    nyraToken = values.MCP_STAGING_NYRA_ISSUER_AUTH_TOKEN;
    for (const token of [coreToken, nyraToken]) {
      if (typeof token !== "string" || token.length < 32 || token.length > 4_096 || !/^[\x21-\x7e]+$/.test(token)) {
        fail("signed_issuer_gate_auth_invalid");
      }
    }
  } finally {
    scrubGateClientEnvironment(env);
  }

  const transport = Object.freeze({
    async post(request) {
      const controller = new AbortController();
      let timeout;
      const timeoutFailure = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("signed_issuer_transport_unavailable"));
        }, Number(operationTimeoutMs));
      });
      const operation = (async () => {
        let response;
        try {
          response = await fetchImpl(request.url, {
            method: "POST",
            headers: request.headers,
            body: JSON.stringify(request.body),
            redirect: "error",
            signal: controller.signal,
          });
        } catch {
          throw new Error("signed_issuer_transport_unavailable");
        }
        let status;
        try { status = response?.status; }
        catch { throw new Error("signed_issuer_transport_invalid"); }
        if (!Number.isInteger(status)) {
          throw new Error("signed_issuer_transport_invalid");
        }
        let body;
        try {
          body = await readMcpStagingBoundedJsonResponse(response, { signal: controller.signal });
        }
        catch {
          throw new Error(controller.signal.aborted
            ? "signed_issuer_transport_unavailable"
            : "signed_issuer_transport_invalid");
        }
        return { status, body };
      })();
      try {
        return await Promise.race([operation, timeoutFailure]);
      } finally {
        clearTimeout(timeout);
      }
    },
  });
  const clients = createMcpStagingSignedIssuerClients({
    endpoints: endpointHostports,
    transport,
    corePublicKey: coreAnchor.publicKey,
    nyraPublicKey: nyraAnchor.publicKey,
    evidenceProvider,
    now,
    operationTimeoutMs,
    targetCommit,
  });
  return Object.freeze({
    requestCoreGrant(context) {
      return clients.requestCoreGrant(context, async () => coreToken);
    },
    requestNyraAttestation(context) {
      return clients.requestNyraAttestation(context, async () => nyraToken);
    },
    probeReadiness(contexts) {
      return clients.probeReadiness(contexts, {
        coreTokenProvider: async () => coreToken,
        nyraTokenProvider: async () => nyraToken,
      });
    },
  });
}

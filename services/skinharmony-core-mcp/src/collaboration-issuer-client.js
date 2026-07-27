import crypto from "node:crypto";
import { collaborationDigest } from "./collaboration-receipt.js";

const RESPONSE_LIMIT_BYTES = 64 * 1024;
const ENDPOINT_PATHS = Object.freeze({
  core: "/v1/mcp-staging/collaboration/core-grant",
  nyra: "/v1/mcp-staging/collaboration/nyra-attest",
});
const ISSUER_HOSTS = Object.freeze({
  core: "skinharmony-core-staging-issuer",
  nyra: "skinharmony-nyra-staging-issuer",
});
const ISSUER_PORT = 8_789;

export class CollaborationIssuerClientError extends Error {
  constructor(code, { status = 500, retryable = false } = {}) {
    super(code);
    this.name = "CollaborationIssuerClientError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function fail(code, options) {
  throw new CollaborationIssuerClientError(code, options);
}

function required(value, code, max = 500) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
}

function privateIssuerUrl(hostport, authority) {
  const value = required(hostport, `${authority}_collaboration_issuer_hostport_required`, 180);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}):[1-9][0-9]{0,4}$/i.test(value)) {
    fail(`${authority}_collaboration_issuer_hostport_invalid`);
  }
  const [hostname, portText] = value.split(":");
  const port = Number(portText);
  if (!Number.isInteger(port) || hostname !== ISSUER_HOSTS[authority] || port !== ISSUER_PORT) {
    fail(`${authority}_collaboration_issuer_hostport_invalid`);
  }
  return `http://${hostname}:${port}${ENDPOINT_PATHS[authority]}`;
}

async function readBoundedPayload(response, authority) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > RESPONSE_LIMIT_BYTES) {
    fail(`${authority}_collaboration_issuer_response_too_large`, { status: 502, retryable: true });
  }
  const reader = response.body?.getReader?.();
  if (!reader) fail(`${authority}_collaboration_issuer_invalid_response`, { status: 502, retryable: true });
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > RESPONSE_LIMIT_BYTES) {
      try { await reader.cancel(); } catch {}
      fail(`${authority}_collaboration_issuer_response_too_large`, { status: 502, retryable: true });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { fail(`${authority}_collaboration_issuer_invalid_response`, { status: 502, retryable: true }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(`${authority}_collaboration_issuer_invalid_response`, { status: 502, retryable: true });
  }
  return payload;
}

async function readBoundedJson(response, authority) {
  const payload = await readBoundedPayload(response, authority);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.ok !== true ||
      !payload.envelope || typeof payload.envelope !== "object" || Array.isArray(payload.envelope)) {
    fail(`${authority}_collaboration_issuer_invalid_response`, { status: 502, retryable: true });
  }
  return payload.envelope;
}

function rejectedIssuerRequest(response, authority) {
  const upstreamStatus = Number(response?.status);
  try { response?.body?.cancel?.()?.catch?.(() => {}); } catch {}
  if (upstreamStatus === 401) {
    fail(`${authority}_collaboration_issuer_auth_required`, { status: 403, retryable: false });
  }
  if (upstreamStatus === 403) {
    fail(`${authority}_collaboration_issuer_forbidden`, { status: 403, retryable: false });
  }
  if (upstreamStatus === 409) {
    fail(`${authority}_collaboration_issuer_rejected`, { status: 409, retryable: false });
  }
  if (upstreamStatus === 429) {
    fail(`${authority}_collaboration_issuer_rate_limited`, { status: 429, retryable: true });
  }
  if (upstreamStatus >= 500 && upstreamStatus <= 599) {
    fail(`${authority}_collaboration_issuer_unavailable`, { status: 503, retryable: true });
  }
  fail(`${authority}_collaboration_issuer_rejected`, { status: 502, retryable: true });
}

async function requestEnvelope(fetchImpl, url, token, body, authority, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) rejectedIssuerRequest(response, authority);
    return await readBoundedJson(response, authority);
  } catch (error) {
    if (error instanceof CollaborationIssuerClientError) throw error;
    fail(`${authority}_collaboration_issuer_unavailable`, { status: 503, retryable: true });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeIssuer(fetchImpl, issuerUrl, authority, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const healthUrl = new URL("/healthz", issuerUrl).toString();
    const response = await fetchImpl(healthUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) return false;
    const payload = await readBoundedPayload(response, authority);
    const expectedIssuer = authority === "core" ? "universal-core-staging" : "nyra-staging";
    return payload.ok === true && payload.mode === authority && payload.issuer === expectedIssuer &&
      payload.evidence_verifier_configured === true && payload.replay_store_durable === true &&
      payload.collaboration_receipt_ready === true &&
      (authority !== "core" || payload.core_gate_verifier_configured === true);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function nonce(randomBytes) {
  return randomBytes(24).toString("base64url");
}

function coreDecision(value, binding) {
  const expectedDigest = collaborationDigest("mcp-collaboration-binding-v1", binding);
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.binding_digest !== expectedDigest || typeof value.confirmation_satisfied !== "boolean") {
    fail("collaboration_core_decision_invalid");
  }
  const decision = required(value.decision, "collaboration_core_decision_invalid", 80);
  const mediation = required(value.mediation, "collaboration_core_decision_invalid", 80);
  if (!["allow", "allowed", "allow_controlled", "allow_advisory", "authorized", "authorized_after_confirmation"].includes(decision) &&
      !["allow", "confirmed"].includes(mediation)) {
    fail("collaboration_core_decision_invalid");
  }
  return Object.freeze({
    schema_version: "mcp_collaboration_core_decision_v1",
    binding_digest: expectedDigest,
    allowed: true,
    decision,
    mediation,
    confirmation_satisfied: value.confirmation_satisfied,
  });
}

function coreGate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !value.claims || typeof value.claims !== "object" || Array.isArray(value.claims) ||
      typeof value.signature !== "string" || value.signature.length !== 43) {
    fail("collaboration_core_gate_invalid");
  }
  return Object.freeze({
    claims: Object.freeze({ ...value.claims }),
    signature: value.signature,
  });
}

export function createCollaborationIssuerClient(config, options = {}) {
  const coreToken = required(config.collaborationCoreIssuerToken, "core_collaboration_issuer_token_required", 10_000);
  const nyraToken = required(config.collaborationNyraIssuerToken, "nyra_collaboration_issuer_token_required", 10_000);
  if (coreToken === nyraToken) fail("collaboration_independent_issuer_tokens_required");
  const coreUrl = privateIssuerUrl(config.collaborationCoreIssuerHostport, "core");
  const nyraUrl = privateIssuerUrl(config.collaborationNyraIssuerHostport, "nyra");
  if (coreUrl === nyraUrl || new URL(coreUrl).hostname === new URL(nyraUrl).hostname) {
    fail("collaboration_independent_issuer_endpoints_required");
  }
  const fetchImpl = options.fetchImpl || fetch;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const now = options.now || Date.now;
  const timeoutMs = Math.min(Math.max(Number(config.collaborationIssuerTimeoutMs || 5_000), 250), 10_000);
  const ttlMs = Math.min(Math.max(Number(config.collaborationReceiptTtlMs || 20_000), 1_000), 30_000);

  return Object.freeze({
    ready: true,
    async probe() {
      const [coreReady, nyraReady] = await Promise.all([
        probeIssuer(fetchImpl, coreUrl, "core", timeoutMs),
        probeIssuer(fetchImpl, nyraUrl, "nyra", timeoutMs),
      ]);
      return coreReady && nyraReady;
    },
    async issue(binding, { coreDecision: decisionInput, coreGate: coreGateInput } = {}) {
      const timestamp = Number(now());
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) fail("collaboration_issuer_clock_invalid");
      const jti = `mcpcr_${String(randomUUID()).replaceAll("-", "")}`;
      if (!/^mcpcr_[A-Za-z0-9_-]{16,128}$/.test(jti)) fail("collaboration_issuer_jti_invalid");
      const decision = coreDecision(decisionInput, binding);
      const verifiedCoreGate = coreGate(coreGateInput);
      const nyraAttestation = await requestEnvelope(fetchImpl, nyraUrl, nyraToken, {
        request_kind: "issue",
        binding,
        jti,
        requested_ttl_ms: ttlMs,
        nonce: nonce(randomBytes),
      }, "nyra", timeoutMs);
      const coreGrant = await requestEnvelope(fetchImpl, coreUrl, coreToken, {
        request_kind: "issue",
        binding,
        decision,
        jti,
        requested_ttl_ms: ttlMs,
        nonce: nonce(randomBytes),
        nyra_attestation: nyraAttestation,
        core_gate: verifiedCoreGate,
      }, "core", timeoutMs);
      return Object.freeze({ binding, decision, core: coreGrant, nyra: nyraAttestation });
    },
  });
}

export const collaborationIssuerEndpointContract = Object.freeze({ ...ENDPOINT_PATHS });

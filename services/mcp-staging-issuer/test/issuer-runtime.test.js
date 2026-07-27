import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createMcpStagingIssuerRuntime,
  createMcpStagingIssuerRuntimeFromEnv,
  MCP_STAGING_ISSUER_CONTRACT,
} from "../src/issuerRuntime.js";

const NOW = Date.parse("2026-07-19T12:00:00.000Z");
const SIGNING_SECRET = "issuer-signing-secret-test-only-0123456789abcdef";
const AUTH_TOKEN = "issuer-auth-token-test-only-0123456789abcdef";
const TARGET_COMMIT = "f435aafb709a26c77e82e2688056d73056d69c82";
const CORE_CLAIM_KEYS = [
  "schema_version", "issuer", "audience", "request_kind", "decision", "state", "scope", "domain_action_id",
  "tenant_id", "domain_pack_id", "core_key_id", "core_key_type", "core_key_scope",
  "target_service", "target_environment", "target_commit", "attempt_id", "deployment_spec_digest",
  "preflight_digest", "credential_grant_digest", "credential_execution_id", "credential_action_digest",
  "credential_executor_contract_id", "credential_receipt_verified", "nyra_attestation_digest",
  "action_digest", "executor_contract_id", "confirmation_reference", "owner_confirmation_digest",
  "confirmation_satisfied", "revalidation_required", "nyra_available", "issued_at", "expires_at", "nonce",
];
const NYRA_CLAIM_KEYS = [
  "schema_version", "issuer", "audience", "request_kind", "decision", "role", "execution_allowed", "risk_band",
  "tenant_id", "domain_pack_id", "target_service", "target_environment", "target_commit", "attempt_id",
  "deployment_spec_digest", "preflight_digest", "credential_grant_digest", "action_digest",
  "executor_contract_id", "issued_at", "expires_at", "nonce",
];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function nyraContext(overrides = {}) {
  const actionDigest = overrides.action_digest || "6".repeat(64);
  const credentialActionDigest = overrides.credential_action_digest || "4".repeat(64);
  return {
    schema_version: "mcp_staging_executor_context_v1",
    tenant_id: "codexai",
    domain_pack_id: "skinharmony",
    target_service: "skinharmony-core-mcp-staging",
    target_environment: "staging",
    target_region: "oregon",
    target_commit: TARGET_COMMIT,
    attempt_id: "mcpstg_11111111-2222-4333-8444-555555555555",
    deployment_spec_digest: "1".repeat(64),
    preflight_digest: "2".repeat(64),
    credential_grant_digest: "3".repeat(64),
    credential_execution_id: "mcp-staging-credentials-20260718-01",
    credential_action_digest: credentialActionDigest,
    credential_executor_contract_id: `domain_action_${credentialActionDigest.slice(0, 20)}`,
    action_digest: actionDigest,
    executor_contract_id: `domain_action_${actionDigest.slice(0, 20)}`,
    ...overrides,
  };
}

function coreContext(overrides = {}) {
  return { ...nyraContext(), nyra_attestation_digest: "5".repeat(64), ...overrides };
}

function artifactEnvelope() {
  return {
    claims: { schema_version: "mcp_staging_test_evidence_v1" },
    signature: "a".repeat(86),
  };
}

function evidenceArtifacts(mode) {
  return mode === "core"
    ? {
        credential_receipt: artifactEnvelope(),
        nyra_attestation: artifactEnvelope(),
        owner_confirmation: artifactEnvelope(),
      }
    : {
        credential_receipt: artifactEnvelope(),
        owner_confirmation: artifactEnvelope(),
      };
}

function issuerRequest(mode, overrides = {}) {
  const context = overrides.context || (mode === "core" ? coreContext() : nyraContext());
  return {
    schema_version: "mcp_staging_signed_issuer_request_v1",
    request_kind: "issue",
    requested_issuer: mode === "core" ? "universal-core" : "nyra",
    audience: "mcp-staging-render-executor",
    tenant_id: "codexai",
    target_service: "skinharmony-core-mcp-staging",
    target_environment: "staging",
    target_commit: TARGET_COMMIT,
    request_nonce: "a".repeat(32),
    context,
    evidence: evidenceArtifacts(mode),
    ...overrides,
  };
}

function commonEvidence(request) {
  const context = request.context;
  return {
    verified: true,
    mode: request.mode,
    request_nonce: request.request_nonce,
    tenant_id: "codexai",
    target_service: "skinharmony-core-mcp-staging",
    target_environment: "staging",
    target_commit: TARGET_COMMIT,
    attempt_id: context.attempt_id,
    deployment_spec_digest: context.deployment_spec_digest,
    preflight_digest: context.preflight_digest,
    credential_grant_digest: context.credential_grant_digest,
    credential_receipt_verified: true,
    credential_receipt_digest: "8".repeat(64),
    action_digest: context.action_digest,
    executor_contract_id: context.executor_contract_id,
    verified_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 20_000).toISOString(),
  };
}

function evidenceFor(request) {
  const common = commonEvidence(request);
  if (request.mode === "nyra") {
    return {
      schema_version: "nyra_mcp_staging_independent_evidence_v1",
      ...common,
      decision: "no_objection",
      risk_band: "bounded_staging",
    };
  }
  return {
    schema_version: "core_mcp_staging_independent_evidence_v1",
    ...common,
    decision: "allow",
    state: "authorized_after_confirmation",
    scope: "reversible_owner_confirmed_mcp_staging_service",
    domain_action_id: "skinharmony_mcp_staging_render_create_v1",
    credential_execution_id: request.context.credential_execution_id,
    credential_action_digest: request.context.credential_action_digest,
    credential_executor_contract_id: request.context.credential_executor_contract_id,
    owner_confirmation_verified: true,
    confirmation_reference: "ucr_mcp_staging_20260716_01",
    owner_confirmation_digest: "7".repeat(64),
    nyra_attestation_verified: true,
    nyra_attestation_digest: request.context.nyra_attestation_digest,
    core_key_id: "key_staging-executor-1234",
    revalidation_required: true,
  };
}

async function startRuntime(t, mode, options = {}) {
  const logs = [];
  const runtimeOptions = {
    mode,
    targetCommit: TARGET_COMMIT,
    signingSecret: SIGNING_SECRET,
    authToken: options.omitAuth ? undefined : AUTH_TOKEN,
    now: () => NOW,
    logger: (event) => logs.push(event),
    rateLimitPerMinute: options.rateLimitPerMinute || 100,
    bodyLimit: options.bodyLimit,
    evidenceTimeoutMs: options.evidenceTimeoutMs,
    ...(options.startupMode ? { startupMode: options.startupMode } : {}),
    ...(options.replayStore ? { replayStore: options.replayStore } : {}),
  };
  if (!options.noVerifier) {
    runtimeOptions.evidenceVerifier = options.evidenceVerifier || (async (request) => evidenceFor(request));
  }
  const runtime = createMcpStagingIssuerRuntime(runtimeOptions);
  const server = http.createServer(runtime.handle);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  async function request(path, { method = "GET", body, token = AUTH_TOKEN, rawBody } = {}) {
    const payload = rawBody === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : rawBody;
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          ...(payload === undefined ? {} : {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          }),
        },
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
        });
      });
      req.on("error", reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }
  return { runtime, request, logs };
}

function invokeRuntime(runtime, {
  body,
  token = AUTH_TOKEN,
  remoteAddress = "127.0.0.1",
} = {}) {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  const req = Readable.from([payload]);
  req.method = "POST";
  req.url = runtime.endpoint;
  req.headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "content-length": String(payload.length),
  };
  req.socket = { remoteAddress };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      end(value = "") {
        try {
          resolve({ status: this.statusCode, body: value ? JSON.parse(String(value)) : null });
        } catch (error) {
          reject(error);
        }
      },
    };
    Promise.resolve(runtime.handle(req, res)).catch(reject);
  });
}

test("startup, public JWKS and health remain secret-free and staging-only", async (t) => {
  assert.throws(() => createMcpStagingIssuerRuntime({}), /issuer_mode_invalid/);
  assert.throws(() => createMcpStagingIssuerRuntimeFromEnv({
    MCP_STAGING_ISSUER_MODE: "core",
    MCP_STAGING_ISSUER_SIGNING_SECRET: SIGNING_SECRET,
    MCP_STAGING_ISSUER_AUTH_TOKEN: AUTH_TOKEN,
  }), /issuer_staging_confirmation_required/);
  const { runtime, request } = await startRuntime(t, "core");
  const health = await request("/healthz", { token: null });
  const jwks = await request("/.well-known/jwks.json", { token: null });
  assert.equal(health.status, 200);
  assert.equal(health.body.evidence_verifier_configured, true);
  assert.deepEqual(Object.keys(jwks.body.keys[0]).sort(), ["alg", "crv", "kid", "kty", "use", "x"]);
  assert.equal("d" in jwks.body.keys[0], false);
  assert.equal(jwks.body.keys[0].kid, runtime.jwk.kid);
  assert.equal(JSON.stringify({ health, jwks }).includes(SIGNING_SECRET), false);
  assert.equal(JSON.stringify({ health, jwks }).includes(AUTH_TOKEN), false);
});

test("jwks_only derives the full-mode key but never reads or processes issuance requests", async (t) => {
  let verifierCalls = 0;
  let replayClaims = 0;
  const replayStore = {
    durable: true,
    async claim() {
      replayClaims += 1;
      return true;
    },
  };
  const { runtime, request } = await startRuntime(t, "core", {
    startupMode: "jwks_only",
    omitAuth: true,
    replayStore,
    evidenceVerifier: async () => {
      verifierCalls += 1;
      throw new Error("must_not_verify");
    },
  });
  const fullRuntime = createMcpStagingIssuerRuntime({
    mode: "core",
    targetCommit: TARGET_COMMIT,
    signingSecret: SIGNING_SECRET,
    authToken: AUTH_TOKEN,
  });

  const health = await request("/healthz", { token: null });
  const jwks = await request("/.well-known/jwks.json", { token: null });
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.bootstrap_phase, "jwks_only");
  assert.equal(health.body.issuance_ready, false);
  assert.equal(health.body.auth_required, false);
  assert.equal(health.body.evidence_verifier_configured, false);
  assert.equal(health.body.replay_store_durable, false);
  assert.deepEqual(jwks.body, { keys: [runtime.jwk] });
  assert.deepEqual(runtime.jwk, fullRuntime.jwk);

  for (const endpoint of Object.values(MCP_STAGING_ISSUER_CONTRACT.endpoints)) {
    let requestContentRead = false;
    const response = await new Promise((resolve, reject) => {
      const req = {
        method: "POST",
        url: endpoint,
        get headers() {
          requestContentRead = true;
          throw new Error("bootstrap_must_not_read_headers");
        },
        on() {
          requestContentRead = true;
          throw new Error("bootstrap_must_not_read_body");
        },
      };
      const res = {
        statusCode: 200,
        setHeader() {},
        end(body = "") {
          resolve({ status: this.statusCode, body: JSON.parse(String(body)) });
        },
      };
      Promise.resolve(runtime.handle(req, res)).catch(reject);
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.error, "issuer_bootstrap_only");
    assert.equal(requestContentRead, false);
  }
  assert.equal(verifierCalls, 0);
  assert.equal(replayClaims, 0);
});

test("no verifier and missing receipt evidence fail closed without self-assertion", async (t) => {
  const absent = await startRuntime(t, "core", { noVerifier: true });
  const absentHealth = await absent.request("/healthz", { token: null });
  assert.equal(absentHealth.status, 503);
  assert.equal(absentHealth.body.ok, false);
  assert.equal(absentHealth.body.evidence_verifier_configured, false);
  const absentResponse = await absent.request(MCP_STAGING_ISSUER_CONTRACT.endpoints.core, {
    method: "POST",
    body: issuerRequest("core"),
  });
  assert.equal(absentResponse.status, 503);
  assert.equal(absentResponse.body.error, "issuer_evidence_unavailable");

  const missingReceipt = await startRuntime(t, "core", {
    evidenceVerifier: async (request) => {
      const evidence = evidenceFor(request);
      delete evidence.credential_receipt_digest;
      return evidence;
    },
  });
  const rejected = await missingReceipt.request(MCP_STAGING_ISSUER_CONTRACT.endpoints.core, {
    method: "POST",
    body: issuerRequest("core"),
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error, "issuer_evidence_rejected");
});

test("core output is byte-contract compatible with the existing signed issuer client", async (t) => {
  const { runtime, request } = await startRuntime(t, "core");
  const input = issuerRequest("core");
  const response = await request(MCP_STAGING_ISSUER_CONTRACT.endpoints.core, { method: "POST", body: input });
  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(response.body).sort(), ["claims", "signature"]);
  assert.deepEqual(Object.keys(response.body.claims).sort(), [...CORE_CLAIM_KEYS].sort());
  const claims = response.body.claims;
  assert.equal(claims.schema_version, "core_mcp_staging_render_grant_v1");
  assert.equal(claims.issuer, "universal-core");
  assert.equal(claims.audience, "mcp-staging-render-executor");
  assert.equal(claims.request_kind, "issue");
  assert.equal(claims.nonce, input.request_nonce);
  assert.equal(claims.credential_receipt_verified, true);
  assert.equal(claims.confirmation_satisfied, true);
  assert.equal(claims.nyra_available, true);
  assert.equal(Date.parse(claims.expires_at) - Date.parse(claims.issued_at) <= 30_000, true);
  const publicKey = crypto.createPublicKey({ key: runtime.jwk, format: "jwk" });
  assert.equal(crypto.verify(
    null,
    Buffer.from(canonicalJson(claims), "utf8"),
    publicKey,
    Buffer.from(response.body.signature, "base64url"),
  ), true);
});

test("Nyra output matches the client contract and mode routes stay isolated", async (t) => {
  const core = await startRuntime(t, "core");
  const nyra = await startRuntime(t, "nyra");
  assert.equal((await core.request(MCP_STAGING_ISSUER_CONTRACT.endpoints.nyra, {
    method: "POST", body: issuerRequest("nyra"),
  })).status, 404);
  assert.equal((await nyra.request(MCP_STAGING_ISSUER_CONTRACT.endpoints.core, {
    method: "POST", body: issuerRequest("core"),
  })).status, 404);
  const input = issuerRequest("nyra");
  const response = await nyra.request(MCP_STAGING_ISSUER_CONTRACT.endpoints.nyra, { method: "POST", body: input });
  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(response.body.claims).sort(), [...NYRA_CLAIM_KEYS].sort());
  assert.equal(response.body.claims.decision, "no_objection");
  assert.equal(response.body.claims.execution_allowed, false);
  assert.equal(response.body.claims.risk_band, "bounded_staging");
});

test("tampered independent evidence and expired evidence are rejected", async (t) => {
  const tampered = await startRuntime(t, "core", {
    evidenceVerifier: async (request) => ({ ...evidenceFor(request), target_commit: "a".repeat(40) }),
  });
  assert.equal((await tampered.request(MCP_STAGING_ISSUER_CONTRACT.endpoints.core, {
    method: "POST", body: issuerRequest("core"),
  })).status, 403);

  const expired = await startRuntime(t, "nyra", {
    evidenceVerifier: async (request) => ({
      ...evidenceFor(request),
      verified_at: new Date(NOW - 20_000).toISOString(),
      expires_at: new Date(NOW).toISOString(),
    }),
  });
  assert.equal((await expired.request(MCP_STAGING_ISSUER_CONTRACT.endpoints.nyra, {
    method: "POST", body: issuerRequest("nyra"),
  })).status, 403);
});

test("production, cross-tenant, arbitrary fields and auth failures are redacted before verification", async (t) => {
  let verifierCalls = 0;
  const marker = "request-secret-marker";
  const { request, logs } = await startRuntime(t, "core", {
    evidenceVerifier: async (input) => { verifierCalls += 1; return evidenceFor(input); },
  });
  const invalid = [
    issuerRequest("core", { target_environment: "production" }),
    issuerRequest("core", { tenant_id: "other-tenant" }),
    { ...issuerRequest("core"), secret_value: marker },
  ];
  for (const body of invalid) {
    const response = await request(MCP_STAGING_ISSUER_CONTRACT.endpoints.core, { method: "POST", body });
    assert.equal(response.status, 400);
    assert.equal(JSON.stringify(response.body).includes(marker), false);
  }
  const unauthorized = await request(MCP_STAGING_ISSUER_CONTRACT.endpoints.core, {
    method: "POST", body: issuerRequest("core"), token: "wrong-token-marker-0123456789012345",
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(verifierCalls, 0);
  assert.equal(JSON.stringify(logs).includes(marker), false);
});

test("unauthenticated requests cannot consume the authenticated rate budget", async () => {
  let verifierCalls = 0;
  const runtime = createMcpStagingIssuerRuntime({
    mode: "nyra",
    targetCommit: TARGET_COMMIT,
    signingSecret: SIGNING_SECRET,
    authToken: AUTH_TOKEN,
    now: () => NOW,
    rateLimitPerMinute: 1,
    evidenceVerifier: async (request) => {
      verifierCalls += 1;
      return evidenceFor(request);
    },
  });
  const unauthorized = await invokeRuntime(runtime, {
    body: issuerRequest("nyra"),
    token: "wrong-token-marker-0123456789012345",
  });
  assert.equal(unauthorized.status, 401);

  const first = await invokeRuntime(runtime, { body: issuerRequest("nyra") });
  assert.equal(first.status, 201);
  const second = await invokeRuntime(runtime, {
    body: issuerRequest("nyra", { request_nonce: "b".repeat(32) }),
  });
  assert.equal(second.status, 429);
  assert.equal(verifierCalls, 1);
});

test("authenticated rate identities are bounded and expired buckets are reclaimed", async () => {
  let nowMs = NOW;
  const runtime = createMcpStagingIssuerRuntime({
    mode: "nyra",
    targetCommit: TARGET_COMMIT,
    signingSecret: SIGNING_SECRET,
    authToken: AUTH_TOKEN,
    now: () => nowMs,
    rateLimitPerMinute: 1,
    evidenceVerifier: async (request) => ({
      ...evidenceFor(request),
      verified_at: new Date(nowMs - 1_000).toISOString(),
      expires_at: new Date(nowMs + 20_000).toISOString(),
    }),
  });
  for (let index = 0; index < 256; index += 1) {
    const nonce = index.toString(36).padStart(32, "0");
    const response = await invokeRuntime(runtime, {
      body: issuerRequest("nyra", { request_nonce: nonce }),
      remoteAddress: `198.51.100.${index}`,
    });
    assert.equal(response.status, 201);
  }
  const atCapacity = await invokeRuntime(runtime, {
    body: issuerRequest("nyra", { request_nonce: "y".repeat(32) }),
    remoteAddress: "203.0.113.1",
  });
  assert.equal(atCapacity.status, 429);

  nowMs += 60_000;
  const afterExpiry = await invokeRuntime(runtime, {
    body: issuerRequest("nyra", { request_nonce: "z".repeat(32) }),
    remoteAddress: "203.0.113.2",
  });
  assert.equal(afterExpiry.status, 201);
});

test("nonce replay is rejected after one independently verified issuance", async (t) => {
  const { request } = await startRuntime(t, "nyra");
  const input = issuerRequest("nyra");
  assert.equal((await request(MCP_STAGING_ISSUER_CONTRACT.endpoints.nyra, { method: "POST", body: input })).status, 201);
  const replay = await request(MCP_STAGING_ISSUER_CONTRACT.endpoints.nyra, { method: "POST", body: input });
  assert.equal(replay.status, 409);
  assert.equal(replay.body.error, "issuer_request_replay");
});

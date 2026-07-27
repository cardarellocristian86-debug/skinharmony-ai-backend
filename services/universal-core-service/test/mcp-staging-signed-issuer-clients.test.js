import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createMcpStagingSignedIssuerGateClientFromEnv,
  createMcpStagingSignedIssuerClients,
  MCP_STAGING_SIGNED_ISSUER_ENDPOINT_CONTRACT,
  McpStagingSignedIssuerClientError,
} from "../src/mcpStagingSignedIssuerClients.js";

const NOW = Date.parse("2026-07-19T10:00:00.000Z");
const TARGET_COMMIT = crypto.randomBytes(20).toString("hex");
const ISSUER_HOSTPORTS = Object.freeze({
  core: "skinharmony-core-staging-issuer-a1b2:8789",
  nyra: "skinharmony-nyra-staging-issuer-c3d4:8789",
});
const ISSUER_URLS = Object.freeze({
  core: `http://${ISSUER_HOSTPORTS.core}/v1/mcp-staging/core-grant`,
  nyra: `http://${ISSUER_HOSTPORTS.nyra}/v1/mcp-staging/nyra-attest`,
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sign(claims, privateKey) {
  return {
    claims,
    signature: crypto.sign(null, Buffer.from(canonicalJson(claims), "utf8"), privateKey).toString("base64url"),
  };
}

function publicJwk(publicKey) {
  const exported = publicKey.export({ format: "jwk" });
  const kid = `ed25519-sha256:${crypto.createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex")}`;
  return { alg: "EdDSA", crv: "Ed25519", kid, kty: "OKP", use: "sig", x: exported.x };
}

function baseContext(overrides = {}) {
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
    credential_action_digest: "4".repeat(64),
    credential_executor_contract_id: "domain_action_44444444444444444444",
    nyra_attestation_digest: "5".repeat(64),
    action_digest: "6".repeat(64),
    executor_contract_id: "domain_action_66666666666666666666",
    ...overrides,
  };
}

function nyraContext(overrides = {}) {
  const { nyra_attestation_digest: ignored, ...context } = baseContext(overrides);
  void ignored;
  return context;
}

function evidenceEnvelope() {
  return {
    claims: { schema_version: "mcp_staging_test_evidence_v1" },
    signature: "a".repeat(86),
  };
}

async function evidenceProvider(issuer) {
  return issuer === "core"
    ? {
        credential_receipt: evidenceEnvelope(),
        nyra_attestation: evidenceEnvelope(),
        owner_confirmation: evidenceEnvelope(),
      }
    : {
        credential_receipt: evidenceEnvelope(),
        owner_confirmation: evidenceEnvelope(),
      };
}

function signedIssuerClients(options) {
  return createMcpStagingSignedIssuerClients({ ...options, targetCommit: TARGET_COMMIT });
}

function signedIssuerGateClient(options) {
  return createMcpStagingSignedIssuerGateClientFromEnv({
    ...options,
    targetCommit: TARGET_COMMIT,
  });
}

function nyraClaims(request, overrides = {}) {
  const context = request.body.context;
  return {
    schema_version: "nyra_mcp_staging_deploy_attestation_v1",
    issuer: "nyra",
    audience: "mcp-staging-render-executor",
    request_kind: request.body.request_kind,
    decision: "no_objection",
    role: "advisory_veto",
    execution_allowed: false,
    risk_band: "bounded_staging",
    tenant_id: context.tenant_id,
    domain_pack_id: context.domain_pack_id,
    target_service: context.target_service,
    target_environment: context.target_environment,
    target_commit: context.target_commit,
    attempt_id: context.attempt_id,
    deployment_spec_digest: context.deployment_spec_digest,
    preflight_digest: context.preflight_digest,
    credential_grant_digest: context.credential_grant_digest,
    action_digest: context.action_digest,
    executor_contract_id: context.executor_contract_id,
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 20_000).toISOString(),
    nonce: request.body.request_nonce,
    ...overrides,
  };
}

function coreClaims(request, overrides = {}) {
  const context = request.body.context;
  return {
    schema_version: "core_mcp_staging_render_grant_v1",
    issuer: "universal-core",
    audience: "mcp-staging-render-executor",
    request_kind: request.body.request_kind,
    decision: "allow",
    state: "authorized_after_confirmation",
    scope: "reversible_owner_confirmed_mcp_staging_service",
    domain_action_id: "skinharmony_mcp_staging_render_create_v1",
    tenant_id: context.tenant_id,
    domain_pack_id: context.domain_pack_id,
    core_key_id: "key_staging-executor-1234",
    core_key_type: "staging_executor",
    core_key_scope: "mcp_staging_render_create",
    target_service: context.target_service,
    target_environment: context.target_environment,
    target_commit: context.target_commit,
    attempt_id: context.attempt_id,
    deployment_spec_digest: context.deployment_spec_digest,
    preflight_digest: context.preflight_digest,
    credential_grant_digest: context.credential_grant_digest,
    credential_execution_id: context.credential_execution_id,
    credential_action_digest: context.credential_action_digest,
    credential_executor_contract_id: context.credential_executor_contract_id,
    credential_receipt_verified: true,
    nyra_attestation_digest: context.nyra_attestation_digest,
    action_digest: context.action_digest,
    executor_contract_id: context.executor_contract_id,
    confirmation_reference: "ucr_mcp_staging_20260716_01",
    owner_confirmation_digest: "7".repeat(64),
    confirmation_satisfied: true,
    revalidation_required: true,
    nyra_available: true,
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 20_000).toISOString(),
    nonce: request.body.request_nonce,
    ...overrides,
  };
}

function harness(options = {}) {
  const coreKeys = options.coreKeys || crypto.generateKeyPairSync("ed25519");
  const nyraKeys = options.nyraKeys || crypto.generateKeyPairSync("ed25519");
  const calls = [];
  const transport = options.transport || {
    async post(request) {
      calls.push(request);
      if (request.url === ISSUER_URLS.core) {
        return { status: 200, body: sign(coreClaims(request, options.coreOverrides), options.coreSigningKey || coreKeys.privateKey) };
      }
      if (request.url === ISSUER_URLS.nyra) {
        return { status: 200, body: sign(nyraClaims(request, options.nyraOverrides), options.nyraSigningKey || nyraKeys.privateKey) };
      }
      return { status: 404, body: { ok: false } };
    },
  };
  const clients = signedIssuerClients({
    transport,
    corePublicKey: coreKeys.publicKey,
    nyraPublicKey: nyraKeys.publicKey,
    now: options.now || (() => NOW),
    endpoints: options.endpoints || ISSUER_HOSTPORTS,
    operationTimeoutMs: options.operationTimeoutMs,
    evidenceProvider: options.evidenceProvider || evidenceProvider,
  });
  return { clients, calls, coreKeys, nyraKeys };
}

const coreTokenProvider = async () => "core-test-token";
const nyraTokenProvider = async () => "nyra-test-token";

test("accepts only signed envelopes from the two exact provider-native private issuer endpoints", async () => {
  const { clients, calls } = harness();
  const nyra = await clients.requestNyraAttestation(nyraContext(), nyraTokenProvider);
  const core = await clients.requestCoreGrant(baseContext(), coreTokenProvider);

  assert.equal(nyra.claims.issuer, "nyra");
  assert.equal(core.claims.issuer, "universal-core");
  assert.deepEqual(calls.map((call) => call.url), [
    ISSUER_URLS.nyra,
    ISSUER_URLS.core,
  ]);
  assert(calls.every((call) => call.body.request_nonce === call.body.context ? false : true));
  assert(calls.every((call) => call.body.audience === "mcp-staging-render-executor"));
  assert.deepEqual(Object.keys(calls[0].body.evidence).sort(), ["credential_receipt", "owner_confirmation"]);
  assert.deepEqual(Object.keys(calls[1].body.evidence).sort(), [
    "credential_receipt", "nyra_attestation", "owner_confirmation",
  ]);
});

test("rejects signature tampering and a response signed by the other issuer", async () => {
  const tampered = harness({ coreOverrides: { target_commit: "a".repeat(40) } });
  tampered.calls.length = 0;
  const originalPost = async (request) => {
    const envelope = sign(coreClaims(request), tampered.coreKeys.privateKey);
    envelope.claims.target_commit = "a".repeat(40);
    return { status: 200, body: envelope };
  };
  const tamperedClients = signedIssuerClients({
    transport: { post: originalPost },
    endpoints: ISSUER_HOSTPORTS,
    corePublicKey: tampered.coreKeys.publicKey,
    nyraPublicKey: tampered.nyraKeys.publicKey,
    now: () => NOW,
    evidenceProvider,
  });
  await assert.rejects(
    tamperedClients.requestCoreGrant(baseContext(), coreTokenProvider),
    (error) => error.code === "core_issuer_signature_invalid",
  );

  const swapped = harness({ coreSigningKey: tampered.nyraKeys.privateKey });
  await assert.rejects(
    swapped.clients.requestCoreGrant(baseContext(), coreTokenProvider),
    (error) => error.code === "core_issuer_signature_invalid",
  );
});

test("rejects issuer identity swaps even when the pinned key produced the signature", async () => {
  const { coreKeys, nyraKeys } = harness();
  const clients = signedIssuerClients({
    transport: {
      async post(request) {
        return { status: 200, body: sign(coreClaims(request, { issuer: "nyra" }), coreKeys.privateKey) };
      },
    },
    endpoints: ISSUER_HOSTPORTS,
    corePublicKey: coreKeys.publicKey,
    nyraPublicKey: nyraKeys.publicKey,
    now: () => NOW,
    evidenceProvider,
  });
  await assert.rejects(
    clients.requestCoreGrant(baseContext(), coreTokenProvider),
    (error) => error.code === "core_issuer_contract_mismatch",
  );
});

test("a signed readiness artifact cannot be reused as an issuance grant", async () => {
  const { clients } = harness({ coreOverrides: { request_kind: "readiness_probe" } });
  await assert.rejects(
    clients.requestCoreGrant(baseContext(), coreTokenProvider),
    (error) => error.code === "core_issuer_contract_mismatch",
  );
});

test("requires independent pinned Ed25519 public keys", () => {
  const shared = crypto.generateKeyPairSync("ed25519");
  assert.throws(
    () => signedIssuerClients({
      transport: { post: async () => ({ status: 404, body: null }) },
      endpoints: ISSUER_HOSTPORTS,
      corePublicKey: shared.publicKey,
      nyraPublicKey: shared.publicKey,
    }),
    (error) => error.code === "signed_issuer_public_keys_not_independent",
  );
});

test("fails closed for expired, future-issued and overlong grants", async (t) => {
  const cases = [
    ["expired", { issued_at: new Date(NOW - 20_000).toISOString(), expires_at: new Date(NOW).toISOString() }],
    ["future", { issued_at: new Date(NOW + 1).toISOString(), expires_at: new Date(NOW + 20_000).toISOString() }],
    ["overlong", { issued_at: new Date(NOW - 1_000).toISOString(), expires_at: new Date(NOW + 30_001).toISOString() }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const { clients } = harness({ nyraOverrides: overrides });
      await assert.rejects(
        clients.requestNyraAttestation(nyraContext(), nyraTokenProvider),
        (error) => error.code === "nyra_issuer_ttl_invalid",
      );
    });
  }
});

test("fails closed with a redacted error when the client clock is not a safe timestamp", async (t) => {
  const marker = "clock-provider-secret-marker";
  const cases = [
    ["NaN", () => Number.NaN],
    ["infinite", () => Number.POSITIVE_INFINITY],
    ["throwing", () => { throw new Error(marker); }],
  ];
  for (const [name, now] of cases) {
    await t.test(name, async () => {
      const { clients } = harness({ now });
      await assert.rejects(
        clients.requestNyraAttestation(nyraContext(), nyraTokenProvider),
        (error) => error.code === "signed_issuer_clock_invalid" &&
          !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
      );
    });
  }
});

test("rejects endpoint overrides and transports with capabilities other than post", () => {
  const coreKeys = crypto.generateKeyPairSync("ed25519");
  const nyraKeys = crypto.generateKeyPairSync("ed25519");
  assert.deepEqual(MCP_STAGING_SIGNED_ISSUER_ENDPOINT_CONTRACT, {
    core: {
      envKey: "MCP_STAGING_CORE_ISSUER_INTERNAL_HOSTPORT",
      serviceName: "skinharmony-core-staging-issuer",
      port: 8789,
      path: "/v1/mcp-staging/core-grant",
    },
    nyra: {
      envKey: "MCP_STAGING_NYRA_ISSUER_INTERNAL_HOSTPORT",
      serviceName: "skinharmony-nyra-staging-issuer",
      port: 8789,
      path: "/v1/mcp-staging/nyra-attest",
    },
  });
  assert.throws(
    () => signedIssuerClients({
      transport: { post: async () => ({ status: 404, body: null }) },
      corePublicKey: coreKeys.publicKey,
      nyraPublicKey: nyraKeys.publicKey,
      endpoints: { core: "skinharmony-core-staging-issuer.onrender.com:8789", nyra: ISSUER_HOSTPORTS.nyra },
    }),
    (error) => error.code === "signed_issuer_endpoint_not_allowed",
  );
  assert.throws(
    () => signedIssuerClients({
      transport: { post: async () => ({ status: 404, body: null }), get: async () => null },
      endpoints: ISSUER_HOSTPORTS,
      corePublicKey: coreKeys.publicKey,
      nyraPublicKey: nyraKeys.publicKey,
    }),
    (error) => error.code === "signed_issuer_transport_invalid",
  );
});

test("readiness reports 404 as unavailable and an unsigned contract as unsigned", async () => {
  const coreKeys = crypto.generateKeyPairSync("ed25519");
  const nyraKeys = crypto.generateKeyPairSync("ed25519");
  const secretMarker = "readiness-secret-marker";
  const clients = signedIssuerClients({
    transport: {
      async post(request) {
        if (request.url === ISSUER_URLS.core) {
          return { status: 404, body: { authorization: request.headers.authorization } };
        }
        return { status: 200, body: { ok: true, debug: request.headers.authorization } };
      },
    },
    endpoints: ISSUER_HOSTPORTS,
    corePublicKey: coreKeys.publicKey,
    nyraPublicKey: nyraKeys.publicKey,
    now: () => NOW,
    evidenceProvider,
  });
  const readiness = await clients.probeReadiness({ core: baseContext(), nyra: nyraContext() }, {
    coreTokenProvider: async () => secretMarker,
    nyraTokenProvider: async () => secretMarker,
  });
  assert.deepEqual(readiness, {
    schema_version: "mcp_staging_signed_issuer_readiness_v1",
    ready: false,
    core: { status: "unavailable", reason: "endpoint_or_auth_unavailable" },
    nyra: { status: "unsigned", reason: "unsigned_or_contract_mismatch" },
  });
  assert.equal(JSON.stringify(readiness).includes(secretMarker), false);
});

test("transport and provider failures never expose transient bearer values", async () => {
  const coreKeys = crypto.generateKeyPairSync("ed25519");
  const nyraKeys = crypto.generateKeyPairSync("ed25519");
  const secretMarker = "transient-bearer-secret-marker";
  const clients = signedIssuerClients({
    transport: {
      async post(request) {
        throw new Error(`provider failed with ${request.headers.authorization}`);
      },
    },
    endpoints: ISSUER_HOSTPORTS,
    corePublicKey: coreKeys.publicKey,
    nyraPublicKey: nyraKeys.publicKey,
    now: () => NOW,
    evidenceProvider,
  });

  let observed;
  try {
    await clients.requestCoreGrant(baseContext(), async () => secretMarker);
  } catch (error) {
    observed = error;
  }
  assert(observed instanceof McpStagingSignedIssuerClientError);
  assert.equal(observed.code, "core_issuer_unavailable");
  assert.equal(String(observed).includes(secretMarker), false);
  assert.equal(JSON.stringify(observed).includes(secretMarker), false);

  const providerFailure = new Error(`token failure ${secretMarker}`);
  await assert.rejects(
    clients.requestNyraAttestation(nyraContext(), async () => { throw providerFailure; }),
    (error) => error.code === "nyra_issuer_auth_unavailable" && !String(error).includes(secretMarker),
  );
});

test("closed issuer contexts reject extra fields without reflecting their values", async () => {
  const { clients } = harness();
  const marker = "context-secret-marker";
  await assert.rejects(
    clients.requestNyraAttestation({ ...nyraContext(), secret_value: marker }, nyraTokenProvider),
    (error) => error.code === "nyra_issuer_context_invalid" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
});

test("missing or malformed evidence providers fail closed with redacted errors", async () => {
  const coreKeys = crypto.generateKeyPairSync("ed25519");
  const nyraKeys = crypto.generateKeyPairSync("ed25519");
  const marker = "evidence-provider-secret-marker";
  const baseOptions = {
    transport: { post: async () => ({ status: 500, body: null }) },
    endpoints: ISSUER_HOSTPORTS,
    corePublicKey: coreKeys.publicKey,
    nyraPublicKey: nyraKeys.publicKey,
    now: () => NOW,
  };
  const missing = signedIssuerClients(baseOptions);
  await assert.rejects(
    missing.requestCoreGrant(baseContext(), coreTokenProvider),
    (error) => error.code === "core_issuer_evidence_unavailable",
  );

  const malformed = signedIssuerClients({
    ...baseOptions,
    evidenceProvider: async () => { throw new Error(marker); },
  });
  await assert.rejects(
    malformed.requestNyraAttestation(nyraContext(), nyraTokenProvider),
    (error) => error.code === "nyra_issuer_evidence_unavailable" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
});

test("a blocked issuer transport times out with a constant redacted error", async () => {
  const marker = "hung-transport-secret-marker";
  const { clients } = harness({
    operationTimeoutMs: 10,
    transport: {
      post: async () => new Promise(() => {}),
    },
  });
  const startedAt = Date.now();
  await assert.rejects(
    clients.requestCoreGrant(baseContext(), async () => marker),
    (error) => error.code === "core_issuer_timeout" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
  assert(Date.now() - startedAt < 500);
});

test("provider-native gate factory pins public issuer keys and scrubs transient tokens", async () => {
  const coreKeys = crypto.generateKeyPairSync("ed25519");
  const nyraKeys = crypto.generateKeyPairSync("ed25519");
  const coreJwk = publicJwk(coreKeys.publicKey);
  const nyraJwk = publicJwk(nyraKeys.publicKey);
  const source = {
    MCP_STAGING_CORE_ISSUER_INTERNAL_HOSTPORT: ISSUER_HOSTPORTS.core,
    MCP_STAGING_NYRA_ISSUER_INTERNAL_HOSTPORT: ISSUER_HOSTPORTS.nyra,
    MCP_STAGING_CORE_ISSUER_PUBLIC_JWK: JSON.stringify(coreJwk),
    MCP_STAGING_CORE_ISSUER_KID: coreJwk.kid,
    MCP_STAGING_CORE_ISSUER_AUTH_TOKEN: "core-gate-token-test-only-0123456789abcdef",
    MCP_STAGING_NYRA_ISSUER_PUBLIC_JWK: JSON.stringify(nyraJwk),
    MCP_STAGING_NYRA_ISSUER_KID: nyraJwk.kid,
    MCP_STAGING_NYRA_ISSUER_AUTH_TOKEN: "nyra-gate-token-test-only-0123456789abcdef",
    UNRELATED: "keep",
  };
  const calls = [];
  const client = signedIssuerGateClient({
    env: source,
    evidenceProvider,
    now: () => NOW,
    fetchImpl: async (url, options) => {
      const request = { body: JSON.parse(options.body) };
      calls.push({ url, options });
      return url === ISSUER_URLS.core
        ? jsonResponse(sign(coreClaims(request), coreKeys.privateKey), 201)
        : jsonResponse(sign(nyraClaims(request), nyraKeys.privateKey), 201);
    },
  });
  assert.deepEqual(source, { UNRELATED: "keep" });
  assert.equal((await client.requestNyraAttestation(nyraContext())).claims.issuer, "nyra");
  assert.equal((await client.requestCoreGrant(baseContext())).claims.issuer, "universal-core");
  assert.equal(calls.length, 2);
  assert(calls.every(({ options }) => options.redirect === "error"));
});

test("provider-native gate factory bounds a stalled response body", async () => {
  const coreKeys = crypto.generateKeyPairSync("ed25519");
  const nyraKeys = crypto.generateKeyPairSync("ed25519");
  const coreJwk = publicJwk(coreKeys.publicKey);
  const nyraJwk = publicJwk(nyraKeys.publicKey);
  const marker = "stalled-issuer-body-secret-marker";
  const body = new ReadableStream({
    pull() { return new Promise(() => {}); },
  });
  const source = {
    MCP_STAGING_CORE_ISSUER_INTERNAL_HOSTPORT: ISSUER_HOSTPORTS.core,
    MCP_STAGING_NYRA_ISSUER_INTERNAL_HOSTPORT: ISSUER_HOSTPORTS.nyra,
    MCP_STAGING_CORE_ISSUER_PUBLIC_JWK: JSON.stringify(coreJwk),
    MCP_STAGING_CORE_ISSUER_KID: coreJwk.kid,
    MCP_STAGING_CORE_ISSUER_AUTH_TOKEN: "core-gate-token-test-only-0123456789abcdef",
    MCP_STAGING_NYRA_ISSUER_PUBLIC_JWK: JSON.stringify(nyraJwk),
    MCP_STAGING_NYRA_ISSUER_KID: nyraJwk.kid,
    MCP_STAGING_NYRA_ISSUER_AUTH_TOKEN: "nyra-gate-token-test-only-0123456789abcdef",
  };
  const client = signedIssuerGateClient({
    env: source,
    evidenceProvider,
    now: () => NOW,
    operationTimeoutMs: 10,
    fetchImpl: async () => {
      void marker;
      return new Response(body, { status: 201 });
    },
  });
  await assert.rejects(
    client.requestCoreGrant(baseContext()),
    (error) => error.code === "core_issuer_timeout" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
});

test("provider-native gate factory rejects an oversize chunked issuer body at 64 KiB", async () => {
  const coreKeys = crypto.generateKeyPairSync("ed25519");
  const nyraKeys = crypto.generateKeyPairSync("ed25519");
  const coreJwk = publicJwk(coreKeys.publicKey);
  const nyraJwk = publicJwk(nyraKeys.publicKey);
  const marker = "oversize-issuer-body-secret-marker";
  const source = {
    MCP_STAGING_CORE_ISSUER_INTERNAL_HOSTPORT: ISSUER_HOSTPORTS.core,
    MCP_STAGING_NYRA_ISSUER_INTERNAL_HOSTPORT: ISSUER_HOSTPORTS.nyra,
    MCP_STAGING_CORE_ISSUER_PUBLIC_JWK: JSON.stringify(coreJwk),
    MCP_STAGING_CORE_ISSUER_KID: coreJwk.kid,
    MCP_STAGING_CORE_ISSUER_AUTH_TOKEN: "core-gate-token-test-only-0123456789abcdef",
    MCP_STAGING_NYRA_ISSUER_PUBLIC_JWK: JSON.stringify(nyraJwk),
    MCP_STAGING_NYRA_ISSUER_KID: nyraJwk.kid,
    MCP_STAGING_NYRA_ISSUER_AUTH_TOKEN: "nyra-gate-token-test-only-0123456789abcdef",
  };
  const bytes = new TextEncoder().encode(JSON.stringify({ padding: `${marker}${"x".repeat(200_000)}` }));
  let cancelled = false;
  let offset = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + 8_192));
      offset += 8_192;
    },
    cancel() { cancelled = true; },
  });
  const client = signedIssuerGateClient({
    env: source,
    evidenceProvider,
    now: () => NOW,
    fetchImpl: async () => new Response(body, { status: 201 }),
  });
  await assert.rejects(
    client.requestCoreGrant(baseContext()),
    (error) => error.code === "core_issuer_unavailable" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
  assert.equal(cancelled, true);
});

test("provider-native gate factory redacts hostile environment getter failures", () => {
  const marker = "hostile-signed-issuer-env-secret-marker";
  const source = new Proxy({
    MCP_STAGING_CORE_ISSUER_INTERNAL_HOSTPORT: ISSUER_HOSTPORTS.core,
    MCP_STAGING_NYRA_ISSUER_INTERNAL_HOSTPORT: ISSUER_HOSTPORTS.nyra,
  }, {
    get(target, key, receiver) {
      if (key === "MCP_STAGING_CORE_ISSUER_PUBLIC_JWK") throw new Error(marker);
      return Reflect.get(target, key, receiver);
    },
  });
  assert.throws(
    () => signedIssuerGateClient({ env: source, evidenceProvider }),
    (error) => error.code === "signed_issuer_gate_config_invalid" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
});

test("provider-native gate factory rejects unpinned or private issuer material", () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const jwk = publicJwk(keys.publicKey);
  const source = {
    MCP_STAGING_CORE_ISSUER_INTERNAL_HOSTPORT: ISSUER_HOSTPORTS.core,
    MCP_STAGING_NYRA_ISSUER_INTERNAL_HOSTPORT: ISSUER_HOSTPORTS.nyra,
    MCP_STAGING_CORE_ISSUER_PUBLIC_JWK: JSON.stringify({ ...jwk, d: "private-material" }),
    MCP_STAGING_CORE_ISSUER_KID: jwk.kid,
    MCP_STAGING_CORE_ISSUER_AUTH_TOKEN: "core-gate-token-test-only-0123456789abcdef",
    MCP_STAGING_NYRA_ISSUER_PUBLIC_JWK: JSON.stringify(jwk),
    MCP_STAGING_NYRA_ISSUER_KID: jwk.kid,
    MCP_STAGING_NYRA_ISSUER_AUTH_TOKEN: "nyra-gate-token-test-only-0123456789abcdef",
  };
  assert.throws(
    () => signedIssuerGateClient({ env: source, evidenceProvider }),
    (error) => error.code === "signed_issuer_gate_trust_anchor_invalid",
  );
  assert.deepEqual(source, {});
});

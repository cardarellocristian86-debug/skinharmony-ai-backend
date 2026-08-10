import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPolicyRegistryLifecycleHealth,
  createApp,
  POLICY_REGISTRY_LIFECYCLE_TOOLS,
  TOOLS,
} from "../src/app.js";
import { validateToolArguments } from "../src/schema-validation.js";

function coreHealth({ ready = true } = {}) {
  const proof = {
    ready,
    backend: "postgresql",
    algorithm: "Ed25519+HMAC-SHA256",
    core_key_id: "core-policy-key-20260810",
    nyra_key_id: "nyra-policy-key-20260810",
    core_public_key_fingerprint: "a".repeat(64),
    nyra_public_key_fingerprint: "b".repeat(64),
    signer: {
      ready,
      state: ready ? "ready" : "unavailable",
      custody: "external_remote_signer",
      target_commit: "c".repeat(40),
    },
  };
  return {
    research_airlock: { ready: true, mode: "enforced", state_backend: "postgresql" },
    nyra_policy_registry: {
      configuration_valid: true,
      evaluation: "active",
      enforcement: "mandatory",
      configured: true,
      backend: "postgresql",
      restart_durable: true,
      distributed: true,
      state: ready ? "ready" : "unavailable",
      ready,
      proof_lifecycle: {
        enabled: true,
        required: true,
        mode: "remote",
        configuration_valid: true,
        state: ready ? "ready" : "unavailable",
        ready,
        render_gate_required: true,
      },
      proof,
      proof_e2e: {
        ready,
        e2e_verified: ready,
        proof: { ...proof },
        store: {
          ready,
          backend: "postgresql",
          restart_durable: true,
          distributed: true,
        },
        upstream: {
          configured: true,
          ready,
          state: ready ? "ready" : "unavailable",
          origin: "https://nyra.example.test",
          path: "/api/nyra/policy-registry/attestations",
          redirect_policy: "error",
          upstream_verified: ready,
        },
      },
    },
  };
}

function lifecycleConfig(overrides = {}) {
  return {
    publicUrl: "https://mcp.example.test",
    resource: "https://mcp.example.test/mcp",
    auth0Issuer: "",
    auth0Audience: "",
    jwksUri: "",
    codexKeys: ["codex-key"],
    codexScopes: ["core:read", "core:govern"],
    defaultTenantId: "tenant-a",
    supportedScopes: ["core:read", "core:govern"],
    environment: "development",
    production: false,
    universalCoreUrl: "https://core.example.test",
    universalCoreKey: "u".repeat(48),
    universalCoreKeys: {},
    tenantGatewayKey: "g".repeat(48),
    tenantContextSigningSecret: "t".repeat(48),
    ownerContextSigningSecret: "o".repeat(48),
    dttAgentIdentitySigningSecret: "d".repeat(48),
    agentSignatureSecret: "a".repeat(48),
    databaseUrl: "postgres://policy-registry-test",
    hostNativeAgentProtocolEnabled: true,
    mandatoryAgentPresenceEnabled: true,
    policyRegistryLifecycleEnabled: true,
    policyRegistryLifecycleRequired: false,
    policyRegistryLifecycleConfigurationValid: true,
    policyRegistryLifecycleConfigurationError: null,
    policyRegistryLifecycleCoreOriginValid: true,
    genericWorkCoreJoinEnabled: false,
    genericWorkCoreJoinRequired: false,
    ...overrides,
  };
}

test("Policy Registry public schemas reject every caller authority and proof field", () => {
  const tool = TOOLS.find((candidate) => candidate.name === "nyra_policy_registry_reconcile");
  const valid = {
    work_id: "11111111-1111-8111-8111-111111111111",
    operation_id: "reconcile-operation-0001",
    owner_confirmed: true,
    confirmation_reference: "owner-reference",
  };
  assert.deepEqual(validateToolArguments(tool.inputSchema, valid), []);
  for (const field of [
    "tenant_id", "authenticated_tenant_id", "work_preflight", "preflight", "owner_context",
    "proof", "receipt", "attestation", "intent", "keys", "key_material", "agent_id", "session_id",
  ]) {
    const errors = validateToolArguments(tool.inputSchema, { ...valid, [field]: {} });
    assert(errors.some((error) => error.code === "additional_property"), field);
  }
});

test("Policy Registry health requires exact distributed proof and distinct trust identities", () => {
  const config = lifecycleConfig();
  const options = { readiness: { continuityInitialized: true } };
  const healthy = buildPolicyRegistryLifecycleHealth(config, options, {
    responseOk: true,
    payload: coreHealth(),
  });
  assert.equal(healthy.ready, true);
  assert.equal(healthy.key_ids_distinct, true);
  assert.equal(healthy.public_key_fingerprints_distinct, true);
  assert.equal(healthy.execution_authorized, false);

  const sameFingerprint = coreHealth();
  sameFingerprint.nyra_policy_registry.proof.nyra_public_key_fingerprint = "a".repeat(64);
  sameFingerprint.nyra_policy_registry.proof_e2e.proof.nyra_public_key_fingerprint = "a".repeat(64);
  const denied = buildPolicyRegistryLifecycleHealth(config, options, {
    responseOk: true,
    payload: sameFingerprint,
  });
  assert.equal(denied.ready, false);
  assert.equal(denied.reason, "nyra_policy_registry_lifecycle_proof_not_ready");
  assert.equal(denied.public_key_fingerprints_distinct, false);

  for (const mutate of [
    (health) => { health.nyra_policy_registry.proof_lifecycle.mode = "local"; },
    (health) => { health.nyra_policy_registry.proof.signer.custody = "process_memory"; },
    (health) => { health.nyra_policy_registry.proof.signer.target_commit = "not-a-commit"; },
    (health) => { health.nyra_policy_registry.proof.signer.state = "degraded"; },
  ]) {
    const payload = coreHealth();
    mutate(payload);
    const result = buildPolicyRegistryLifecycleHealth(config, options, { responseOk: true, payload });
    assert.equal(result.ready, false);
    assert.equal(result.reason, "nyra_policy_registry_lifecycle_proof_not_ready");
  }
});

test("Policy Registry tools appear only while the bounded Core health proof is fresh", async () => {
  let upstreamReady = true;
  let healthCalls = 0;
  let handlerCalls = 0;
  const handlers = Object.fromEntries([...POLICY_REGISTRY_LIFECYCLE_TOOLS].map((name) => [name, async () => {
    handlerCalls += 1;
    return { structuredContent: { ok: true }, content: [{ type: "text", text: "ok" }] };
  }]));
  const app = createApp(lifecycleConfig(), {
    handlers,
    toolSurface: "compact",
    readiness: { continuityInitialized: true },
    policyRegistryHealthCacheTtlMs: 50,
    fetchImpl: async () => {
      healthCalls += 1;
      return new Response(JSON.stringify(coreHealth({ ready: upstreamReady })), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: "Bearer codex-key", "content-type": "application/json" };
  const rpc = (body) => fetch(`${base}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }).then((response) => response.json());
  try {
    const first = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.deepEqual(first.result.tools.map((tool) => tool.name).sort(),
      [...POLICY_REGISTRY_LIFECYCLE_TOOLS].sort());
    assert.equal(healthCalls, 1);

    const forged = await rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "nyra_policy_registry_reconcile",
        arguments: {
          work_id: "11111111-1111-8111-8111-111111111111",
          operation_id: "reconcile-operation-0001",
          owner_confirmed: true,
          confirmation_reference: "owner-ref",
          tenant_id: "forged-tenant",
        },
      },
    });
    assert.equal(forged.error.code, -32602);
    assert.equal(handlerCalls, 0);
    assert.equal(healthCalls, 2);

    upstreamReady = false;
    await new Promise((resolve) => setTimeout(resolve, 70));
    const decayed = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    assert.equal(decayed.result.tools.length, 0);
    assert.equal(healthCalls, 3);

    upstreamReady = true;
    await new Promise((resolve) => setTimeout(resolve, 70));
    const restored = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/list" });
    assert.equal(restored.result.tools.length, 3);
    assert.equal(healthCalls, 4);
    upstreamReady = false;
    const denied = await rpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "nyra_policy_registry_reconcile", arguments: {} },
    });
    assert.equal(denied.error.code, -32602);
    assert.equal(denied.error.message, "Unknown tool");
    assert.equal(healthCalls, 5);
    assert.equal(handlerCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Policy Registry health deadline covers headers-fast body-slow and hides every lifecycle tool", async () => {
  let cancelled = false;
  const handlers = Object.fromEntries([...POLICY_REGISTRY_LIFECYCLE_TOOLS].map((name) => [name, async () => {
    throw new Error("must_not_run");
  }]));
  const app = createApp(lifecycleConfig({ policyRegistryLifecycleRequired: true }), {
    handlers,
    toolSurface: "compact",
    readiness: { continuityInitialized: true },
    policyRegistryHealthTimeoutMs: 20,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      redirected: false,
      url: "https://core.example.test/healthz",
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader() {
          return {
            read: async () => new Promise(() => {}),
            cancel: async () => { cancelled = true; },
          };
        },
      },
    }),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const started = Date.now();
    const healthResponse = await fetch(`${base}/healthz`);
    const health = await healthResponse.json();
    assert.equal(healthResponse.status, 503);
    assert.equal(health.nyra_policy_registry_lifecycle.reason,
      "nyra_policy_registry_lifecycle_upstream_unavailable");
    assert.equal(cancelled, true);
    assert(Date.now() - started < 500);
    const listed = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }).then((response) => response.json());
    assert.equal(listed.result.tools.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Policy Registry health rejects a non-numeric Content-Length", async () => {
  const handlers = Object.fromEntries([...POLICY_REGISTRY_LIFECYCLE_TOOLS].map((name) => [name, async () => ({})]));
  const app = createApp(lifecycleConfig(), {
    handlers,
    toolSurface: "compact",
    readiness: { continuityInitialized: true },
    fetchImpl: async () => new Response(JSON.stringify(coreHealth()), {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "invalid" },
    }),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const listed = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }).then((response) => response.json());
    assert.equal(listed.result.tools.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("required Policy Registry lifecycle makes MCP health fail closed without a ready proof", async () => {
  const app = createApp(lifecycleConfig({ policyRegistryLifecycleRequired: true }), {
    handlers: {},
    readiness: { continuityInitialized: true },
    fetchImpl: async () => new Response(JSON.stringify(coreHealth({ ready: false })), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 503);
    assert.equal(health.ok, false);
    assert.equal(health.render_ready, false);
    assert.equal(health.nyra_policy_registry_lifecycle.required, true);
    assert.equal(health.nyra_policy_registry_lifecycle.ready, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

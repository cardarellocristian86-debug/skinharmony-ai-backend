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
  const commit = "c".repeat(40);
  const proof = {
    ready,
    backend: "postgresql",
    algorithm: "Ed25519+HMAC-SHA256",
    proof_schema_version: "nyra_policy_registry_proof_v3",
    attestation_schema_version: "nyra_policy_activation_attestation_v3",
    receipt_schema_version: "core_policy_activation_receipt_v3",
    compiler_provenance_binding_required: true,
    core_key_id: "core-policy-key-20260810",
    nyra_key_id: "nyra-policy-key-20260810",
    core_public_key_fingerprint: "a".repeat(64),
    nyra_public_key_fingerprint: "b".repeat(64),
    signer: {
      ready,
      state: ready ? "ready" : "unavailable",
      custody: "external_remote_signer",
      target_commit: commit,
    },
  };
  return {
    build: { build_id: "build-policy-v3", commit_sha: commit, commit_verifiable: true },
    research_airlock: { ready: true, mode: "enforced", state_backend: "postgresql" },
    nyra_policy_registry: {
      configuration_valid: true,
      evaluation: "active",
      enforcement: "mandatory",
      configured: true,
      backend: "postgresql",
      restart_durable: true,
      distributed: true,
      compiler_provenance_persistence: true,
      compiler_input_persisted: false,
      state: ready ? "ready" : "unavailable",
      ready,
      compiler_provenance: {
        enabled: true,
        required: true,
        mode: "core_deterministic_recompile",
        configuration_valid: true,
        configured: true,
        ready,
        state: ready ? "ready" : "unavailable",
        render_gate_required: true,
        schema_version: "nyra_policy_compiler_provenance_status_v1",
        provenance_schema_version: "nyra_policy_compiler_provenance_v1",
        compiler_algorithm: "nyra_policy_registry_v1",
        verification_algorithm: "sha256_canonical_json+ed25519",
        traversal_budget: 256,
        compiler_build_commit: commit,
        catalog_digest: "d".repeat(64),
        trust_catalog_digest: "e".repeat(64),
        compiler_input_persisted: false,
        execution_authorized: false,
        error: null,
      },
      proof_lifecycle: {
        enabled: true,
        required: true,
        mode: "remote",
        configuration_valid: true,
        state: ready ? "ready" : "unavailable",
        ready,
        render_gate_required: true,
        error: null,
      },
      proof,
      proof_e2e: {
        ready,
        e2e_verified: ready,
        proof: { ...proof, signer: { ...proof.signer } },
        store: {
          ready,
          backend: "postgresql",
          restart_durable: true,
          distributed: true,
          compiler_provenance_persistence: true,
          compiler_input_persisted: false,
        },
        compiler_provenance: {
          ready,
          schema_version: "nyra_policy_compiler_provenance_v1",
          status_schema_version: "nyra_policy_compiler_provenance_status_v1",
          mode: "core_deterministic_recompile",
          compiler_algorithm: "nyra_policy_registry_v1",
          compiler_input_persisted: false,
          execution_authorized: false,
        },
        upstream: {
          configured: true,
          ready,
          state: ready ? "ready" : "unavailable",
          origin: "https://nyra.example.test",
          path: "/api/nyra/policy-registry/attestations",
          redirect_policy: "error",
          upstream_verified: ready,
          probe_attempts: 1,
          operation_in_flight: false,
          last_success_at: "2026-08-10T12:00:00.000Z",
          last_failure_at: null,
          last_failure: null,
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

function compilerInputSchemaFixture() {
  const pack = {
    schema_version: "nyra_policy_pack_v1",
    pack_id: "core/invariants",
    version: "1.0.0",
    status: "active",
    scope: { kind: "core", value: "universal-core", tenant_id: null },
    parent_refs: [],
    bindings: {
      core_branch_ids: ["nyra_policy_registry"],
      nyra_branch_ids: ["risk_governance"],
      domain_pack_ids: ["generic"],
    },
    privacy: { raw_customer_data_allowed: false, data_classification: "policy_metadata_only" },
    policy: {
      allow_mode: "inherit",
      allow_actions: [],
      deny_actions: ["cross_tenant_access"],
      required_gates: ["core_allow"],
      constraints: {},
    },
    tests: [{ id: "allow", expected: "ALLOW" }, { id: "deny", expected: "DENY" }],
    sources: [{
      source_id: "nist_zero_trust",
      url: "https://csrc.nist.gov/pubs/sp/800/207/final",
      claim: "Core policy evidence",
      reviewed_at: "2026-08-01",
    }],
    freshness_sla_days: 365,
    provenance: { builder: "fixture" },
    valid_from: "2026-08-01T00:00:00.000Z",
    expires_at: "2027-08-01T00:00:00.000Z",
    rollback_to: null,
    compatibility: {},
    trust_mode: "compiled_core",
    signatures: [],
    artifact_digest: "a".repeat(64),
  };
  return {
    schema_version: "nyra_policy_compiler_input_v1",
    leaf_pack_ids: ["core/invariants@1.0.0"],
    packs: [pack],
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
    "compiler_input", "compiler_provenance", "compiler_provenance_digest", "trust_catalog",
  ]) {
    const errors = validateToolArguments(tool.inputSchema, { ...valid, [field]: {} });
    assert(errors.some((error) => error.code === "additional_property"), field);
  }
});

test("Policy Registry activate exposes one exact bounded compiler input and no compiler authority", () => {
  const activate = TOOLS.find((candidate) => candidate.name === "nyra_policy_registry_activate");
  const compilerSchema = activate.inputSchema.properties.compiler_input;
  const valid = compilerInputSchemaFixture();
  assert.deepEqual(validateToolArguments(compilerSchema, valid), []);
  assert(activate.inputSchema.required.includes("compiler_input"));

  const extraInput = structuredClone(valid);
  extraInput.trusted_issuers = {};
  assert(validateToolArguments(compilerSchema, extraInput)
    .some((error) => error.code === "additional_property"));
  const extraPack = structuredClone(valid);
  extraPack.packs[0].compiler_provenance = {};
  assert(validateToolArguments(compilerSchema, extraPack)
    .some((error) => error.code === "additional_property"));
  const tooManyLeaves = structuredClone(valid);
  tooManyLeaves.leaf_pack_ids = Array.from({ length: 17 }, (_, index) =>
    `core/leaf-${String(index).padStart(2, "0")}@1.0.0`);
  assert(validateToolArguments(compilerSchema, tooManyLeaves)
    .some((error) => error.code === "max_items"));

  for (const name of ["nyra_policy_registry_rollback", "nyra_policy_registry_reconcile"]) {
    const definition = TOOLS.find((candidate) => candidate.name === name);
    assert.equal(Object.hasOwn(definition.inputSchema.properties, "compiler_input"), false);
    assert.equal(Object.hasOwn(definition.inputSchema.properties, "compiler_provenance_digest"), false);
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
  assert.equal(healthy.compiler_ready, true);
  assert.equal(healthy.build_consistent, true);
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
    (health) => { health.nyra_policy_registry.proof.proof_schema_version = "nyra_policy_registry_proof_v2"; },
  ]) {
    const payload = coreHealth();
    mutate(payload);
    const result = buildPolicyRegistryLifecycleHealth(config, options, { responseOk: true, payload });
    assert.equal(result.ready, false);
    assert.equal(result.reason, "nyra_policy_registry_lifecycle_proof_not_ready");
  }
});

test("Policy Registry health accepts only exact plain own data records without reading accessors", () => {
  const config = lifecycleConfig();
  const options = { readiness: { continuityInitialized: true } };
  const targets = [
    ["build", (health) => health.build, "build_id"],
    ["registry", (health) => health.nyra_policy_registry, "configuration_valid"],
    ["compiler", (health) => health.nyra_policy_registry.compiler_provenance, "enabled"],
    ["proof_lifecycle", (health) => health.nyra_policy_registry.proof_lifecycle, "enabled"],
    ["proof", (health) => health.nyra_policy_registry.proof, "ready"],
    ["proof.signer", (health) => health.nyra_policy_registry.proof.signer, "ready"],
    ["e2e", (health) => health.nyra_policy_registry.proof_e2e, "ready"],
    ["e2e.proof", (health) => health.nyra_policy_registry.proof_e2e.proof, "ready"],
    ["e2e.proof.signer", (health) => health.nyra_policy_registry.proof_e2e.proof.signer, "ready"],
    ["e2e.store", (health) => health.nyra_policy_registry.proof_e2e.store, "ready"],
    ["e2e.compiler", (health) => health.nyra_policy_registry.proof_e2e.compiler_provenance, "ready"],
    ["e2e.upstream", (health) => health.nyra_policy_registry.proof_e2e.upstream, "configured"],
  ];
  const attacks = [
    ["extra", (target) => { target.unexpected_authority = true; }],
    ["nonenumerable", (target) => {
      Object.defineProperty(target, "hidden_authority", { value: true, enumerable: false });
    }],
    ["symbol", (target) => { target[Symbol("hidden_authority")] = true; }],
    ["prototype", (target) => { Object.setPrototypeOf(target, { injected: true }); }],
    ["accessor", (target, field, state) => {
      Object.defineProperty(target, field, {
        configurable: true,
        enumerable: true,
        get() { state.getterReads += 1; return true; },
      });
    }],
  ];
  for (const [targetName, selectTarget, field] of targets) {
    for (const [attackName, attack] of attacks) {
      const payload = coreHealth();
      const state = { getterReads: 0 };
      attack(selectTarget(payload), field, state);
      const result = buildPolicyRegistryLifecycleHealth(config, options, {
        responseOk: true,
        payload,
      });
      assert.equal(result.ready, false, `${targetName}:${attackName}`);
      assert.equal(state.getterReads, 0, `${targetName}:${attackName}:getter`);
    }
  }
});

test("Policy Registry hides malformed health records and direct calls never reach handlers", async () => {
  let handlerCalls = 0;
  const handlers = Object.fromEntries([...POLICY_REGISTRY_LIFECYCLE_TOOLS].map((name) => [name, async () => {
    handlerCalls += 1;
    return { structuredContent: { ok: true }, content: [{ type: "text", text: "ok" }] };
  }]));
  const payload = coreHealth();
  payload.nyra_policy_registry.proof_e2e.upstream.unexpected_authority = true;
  const app = createApp(lifecycleConfig(), {
    handlers,
    toolSurface: "compact",
    readiness: { continuityInitialized: true },
    fetchImpl: async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const rpc = (body) => fetch(endpoint, {
    method: "POST",
    headers: { authorization: "Bearer codex-key", "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => response.json());
  try {
    const listed = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.equal(listed.result.tools.length, 0);
    const called = await rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "nyra_policy_registry_activate", arguments: {} },
    });
    assert.equal(called.error.code, -32602);
    assert.equal(called.error.message, "Unknown tool");
    assert.equal(handlerCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Policy Registry health fails closed on compiler, persistence and E2E v3 drift", () => {
  const config = lifecycleConfig();
  const options = { readiness: { continuityInitialized: true } };
  const compilerDrifts = [
    (health) => { health.nyra_policy_registry.compiler_provenance.enabled = false; },
    (health) => { health.nyra_policy_registry.compiler_provenance.required = false; },
    (health) => { health.nyra_policy_registry.compiler_provenance.mode = "disabled"; },
    (health) => { health.nyra_policy_registry.compiler_provenance.schema_version = "legacy"; },
    (health) => { health.nyra_policy_registry.compiler_provenance.verification_algorithm = "sha256"; },
    (health) => { health.nyra_policy_registry.compiler_provenance.compiler_build_commit = "f".repeat(40); },
    (health) => { health.nyra_policy_registry.compiler_provenance.catalog_digest = "invalid"; },
    (health) => { health.nyra_policy_registry.compiler_provenance.compiler_input_persisted = true; },
    (health) => { health.build.commit_verifiable = false; },
  ];
  for (const mutate of compilerDrifts) {
    const payload = coreHealth();
    mutate(payload);
    const result = buildPolicyRegistryLifecycleHealth(config, options, { responseOk: true, payload });
    assert.equal(result.ready, false);
    assert.equal(result.reason, "nyra_policy_registry_lifecycle_compiler_not_ready");
  }

  for (const mutate of [
    (health) => { health.nyra_policy_registry.compiler_provenance_persistence = false; },
    (health) => { health.nyra_policy_registry.compiler_input_persisted = true; },
  ]) {
    const payload = coreHealth();
    mutate(payload);
    const result = buildPolicyRegistryLifecycleHealth(config, options, { responseOk: true, payload });
    assert.equal(result.ready, false);
    assert.equal(result.reason, "nyra_policy_registry_lifecycle_registry_not_ready");
  }

  for (const mutate of [
    (health) => { health.nyra_policy_registry.proof_e2e.store.compiler_provenance_persistence = false; },
    (health) => { health.nyra_policy_registry.proof_e2e.store.compiler_input_persisted = true; },
    (health) => { health.nyra_policy_registry.proof_e2e.compiler_provenance.schema_version = "legacy"; },
    (health) => { health.nyra_policy_registry.proof_e2e.proof.receipt_schema_version = "legacy"; },
  ]) {
    const payload = coreHealth();
    mutate(payload);
    const result = buildPolicyRegistryLifecycleHealth(config, options, { responseOk: true, payload });
    assert.equal(result.ready, false);
    assert.equal(result.reason, "nyra_policy_registry_lifecycle_e2e_not_ready");
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
      ["nyra_policy_registry_reconcile", "nyra_policy_registry_rollback"]);
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
    assert.equal(restored.result.tools.length, 2);
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

test("MCP keeps the 1 MiB body limit except for activate under the hard 2 MiB ceiling", async () => {
  const handlers = Object.fromEntries([...POLICY_REGISTRY_LIFECYCLE_TOOLS].map((name) => [name, async () => ({
    structuredContent: { ok: true },
    content: [{ type: "text", text: "ok" }],
  })]));
  const app = createApp(lifecycleConfig(), {
    handlers,
    toolSurface: "compact",
    readiness: { continuityInitialized: true },
    fetchImpl: async () => new Response(JSON.stringify(coreHealth()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sendRaw = (body) => fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer codex-key", "content-type": "application/json" },
    body,
  });
  const send = (name, padding) => sendRaw(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: { padding } },
    }));
  try {
    const betweenLimits = "x".repeat(1_100_000);
    const activate = await send("nyra_policy_registry_activate", betweenLimits);
    assert.equal(activate.status, 200);
    assert.equal((await activate.json()).error.code, -32602);

    const activateAlias = await send(
      "skinharmony_nyra_core.nyra_policy_registry_activate",
      betweenLimits,
    );
    assert.equal(activateAlias.status, 200);
    assert.equal((await activateAlias.json()).error.code, -32602);

    const reconcile = await send("nyra_policy_registry_reconcile", betweenLimits);
    assert.equal(reconcile.status, 413);
    assert.equal((await reconcile.json()).error.message, "Request body too large");

    const reconcileAlias = await send(
      "skinharmony_nyra_core.nyra_policy_registry_reconcile",
      betweenLimits,
    );
    assert.equal(reconcileAlias.status, 413);
    assert.equal((await reconcileAlias.json()).error.message, "Request body too large");

    const unknown = await send("unknown_policy_tool", betweenLimits);
    assert.equal(unknown.status, 413);
    assert.equal((await unknown.json()).error.message, "Request body too large");

    const malformed = await sendRaw(`{"jsonrpc":"2.0","method":"tools/call","padding":"${betweenLimits}`);
    assert.equal(malformed.status, 413);
    assert.match(String(malformed.headers.get("content-type")), /^application\/json/);
    assert.deepEqual(await malformed.json(), {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32602, message: "Request body too large" },
    });

    const batch = await sendRaw(JSON.stringify([{
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "nyra_policy_registry_activate",
        arguments: { padding: betweenLimits },
      },
    }]));
    assert.equal(batch.status, 413);

    const aboveHardLimit = await send("nyra_policy_registry_activate", "x".repeat(2_100_000));
    assert.equal(aboveHardLimit.status, 413);
    assert.match(String(aboveHardLimit.headers.get("content-type")), /^application\/json/);
    assert.equal((await aboveHardLimit.json()).error.message, "Request body too large");
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

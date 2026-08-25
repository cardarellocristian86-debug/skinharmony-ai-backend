import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  boundedCausalInitializationLivenessMs,
  boundedHealthProbeTimeoutMs,
  createUniversalCoreService,
} from "../src/app.js";
import {
  createPostgresMajorVersionProbe,
} from "../../shared/postgres-major-version.js";
import { causalDigest } from "../src/causalContinuityCanonical.js";

const READY_HOST_NATIVE_GOVERNANCE = Object.freeze({
  storage: Object.freeze({
    kind: "file_atomic",
    restart_durable: true,
    distributed: false,
  }),
  trusted_readback_configured: true,
  release_join_verdict_resolver_configured: true,
  required_checks_policy_resolver_configured: true,
  closure_attestation_verifier_configured: true,
  render_service_origin_resolver_configured: true,
});

function healthyPostgresPool() {
  return {
    async query(statement) {
      const sql = String(statement).replace(/\s+/g, " ");
      if (/tainted_at IS NOT NULL/.test(sql)) return { rows: [{ count: 0 }] };
      if (/count\(\*\)::int AS issued/.test(sql)) {
        return { rows: [{ issued: 0, consumed: 0, expired_unconsumed: 0 }] };
      }
      return { rows: [] };
    },
    async connect() {
      return { query: this.query.bind(this), release() {} };
    },
  };
}

function healthyActionEvaluatorIdempotencyStore() {
  return {
    kind: "postgresql",
    restart_durable: true,
    distributed: true,
    schema_version: "action_evaluator_idempotency_v1",
    schema_digest: "a".repeat(64),
    async initialize() {
      return {
        schema_version: this.schema_version,
        schema_digest: this.schema_digest,
        schema_verified: true,
        append_only_enforced: true,
      };
    },
    async begin() { throw new Error("not_used"); },
  };
}

function causalProductionBootstrapOptions(initialize, overrides = {}) {
  const policyPool = overrides.nyraPolicyRegistryPostgresPool || healthyPostgresPool();
  const researchPool = overrides.researchAirlockPostgresPool || healthyPostgresPool();
  return {
    governedAgentPostgresVersionProbe: postgresMajorProbe(180_004),
    nyraPolicyRegistryPostgresPool: policyPool,
    researchAirlockPostgresPool: researchPool,
    researchAirlockMode: "enforced",
    researchAirlockSigningSecret: "r".repeat(32),
    nyraPolicyRegistryEnforcementMode: "advisory_evaluate",
    hostNativeGovernance: READY_HOST_NATIVE_GOVERNANCE,
    hostNativeSigningSecret: "h".repeat(32),
    mcpTenantGatewayKey: "g".repeat(32),
    tenantContextSigningSecret: "t".repeat(32),
    ownerContextSigningSecret: "o".repeat(32),
    dttAgentIdentitySigningSecret: "d".repeat(32),
    dttAgentIdentityReceiptService: { configured: false },
    resolveDttVerifierIdentity: () => ({ verified: false }),
    hostNativeRequiredChecksPolicyResolver: () => ({ required_checks: [] }),
    hostNativeRenderServiceOriginResolver: () => null,
    causalContinuityStore: {},
    causalContinuityRuntime: {
      initialize,
      health: async () => ({ ok: true, backend: "test_persistent" }),
      invoke: async () => ({ ok: true }),
    },
    actionEvaluatorIdempotencyStore:
      overrides.actionEvaluatorIdempotencyStore || healthyActionEvaluatorIdempotencyStore(),
    ...overrides,
    nyraPolicyRegistryPostgresPool: policyPool,
    researchAirlockPostgresPool: researchPool,
  };
}

function postgresMajorProbe(serverVersionNum) {
  return createPostgresMajorVersionProbe({
    query: async () => {
      if (serverVersionNum instanceof Error) throw serverVersionNum;
      return {
        rows: [{ server_version_num: String(serverVersionNum) }],
      };
    },
    cacheTtlMs: 0,
  });
}

async function withEnv(values, run) {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function readHealth(options = {}) {
  const storageRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "host-native-readiness-"),
  );
  const { app } = createUniversalCoreService({ storageRoot, ...options });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/healthz`,
    );
    return { response, health: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
}

function causalProductionOptions(initialize, overrides = {}) {
  return {
    governedAgentPostgresVersionProbe: postgresMajorProbe(180_004),
    // This fixture isolates causal bootstrap liveness. Policy Registry remains
    // explicitly code-dark, so its production store cannot mask that signal.
    nyraPolicyRegistryEnforcementMode: "disabled",
    nyraPolicyRegistryStore: {
      kind: "postgresql",
      restart_durable: true,
      distributed: true,
      status: async () => ({
        configured: true,
        backend: "postgresql",
        restart_durable: true,
        distributed: true,
        state: "ready",
        ready: true,
      }),
    },
    researchAirlockRuntime: {
      mode: "enforced",
      ready: true,
      store: { kind: "postgresql", restart_durable: true, distributed: true },
      status: async () => ({
        mode: "enforced",
        ready: true,
        operational_safe: true,
        state_backend: "postgresql",
      }),
    },
    causalContinuityStore: {},
    causalContinuityRuntime: {
      initialize,
      health: async () => ({ ok: true, backend: "test_persistent" }),
      invoke: async () => ({ ok: true }),
    },
    actionEvaluatorIdempotencyStore:
      overrides.actionEvaluatorIdempotencyStore || healthyActionEvaluatorIdempotencyStore(),
    ...overrides,
  };
}

async function freshUniversalCoreService(label) {
  const moduleUrl = new URL("../src/app.js", import.meta.url);
  moduleUrl.searchParams.set("health-build-fixture", `${label}-${Date.now()}-${Math.random()}`);
  return (await import(moduleUrl.href)).createUniversalCoreService;
}

async function startHealthService(options, createService = createUniversalCoreService) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "causal-health-"));
  const created = createService({ storageRoot, ...options });
  const { app } = created;
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await created.shutdown?.();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    },
  };
}

async function startDelayedFailurePostgresEndpoint(delayMs = 300) {
  const sockets = new Set();
  const timers = new Map();
  let closed = false;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    const timer = setTimeout(() => {
      timers.delete(socket);
      socket.destroy(new Error("bounded_postgres_fixture_failure"));
    }, delayMs);
    timers.set(socket, timer);
    socket.once("close", () => {
      sockets.delete(socket);
      const pending = timers.get(socket);
      if (pending) clearTimeout(pending);
      timers.delete(socket);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    databaseUrl: `postgresql://core:core@127.0.0.1:${server.address().port}/governance`,
    async close() {
      if (closed) return;
      closed = true;
      const stopped = new Promise((resolve) => server.close(resolve));
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const socket of sockets) socket.destroy();
      await stopped;
    },
  };
}

async function within(promise, timeoutMs, errorCode) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function serverOwnedBootstrapEnvironment(databaseUrl) {
  return {
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "true",
    CORE_HOST_NATIVE_SIGNING_SECRET: "h".repeat(32),
    CORE_MCP_TENANT_GATEWAY_KEY: "g".repeat(32),
    CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET: "t".repeat(32),
    CORE_OWNER_CONTEXT_SIGNING_SECRET: "o".repeat(32),
    DTT_AGENT_IDENTITY_SIGNING_SECRET: "d".repeat(32),
    CORE_RESEARCH_AIRLOCK_MODE: "enforced",
    CORE_RESEARCH_AIRLOCK_SIGNING_SECRET: "r".repeat(32),
    CORE_NYRA_POLICY_REGISTRY_ENFORCEMENT_MODE: "advisory_evaluate",
    CORE_HOST_NATIVE_GITHUB_TOKEN_TEST: "github-test-token",
    CORE_HOST_NATIVE_GITHUB_CREDENTIAL_REGISTRY_JSON: JSON.stringify({
      schema_version: "host_native_github_credential_registry_v1",
      bindings: [{
        tenant_id: "tenant-test",
        repository: "owner/repository",
        token_env: "CORE_HOST_NATIVE_GITHUB_TOKEN_TEST",
      }],
    }),
    CORE_HOST_NATIVE_RENDER_ORIGIN_REGISTRY_JSON: JSON.stringify({
      schema_version: "host_native_render_origin_registry_v1",
      bindings: [{
        tenant_id: "tenant-test",
        repository: "owner/repository",
        service_id: "srv-test",
        environment: "production",
        origin: "https://core-test.onrender.com",
      }],
    }),
    CORE_HOST_NATIVE_REQUIRED_CHECKS_REGISTRY_JSON: JSON.stringify({
      schema_version: "host_native_required_checks_registry_v1",
      bindings: [{
        tenant_id: "tenant-test",
        repository: "owner/repository",
        base_branch: "main",
        required_checks: ["ci/test"],
        check_app: { id: 1, slug: "github-actions", owner: "github" },
        workflow: {
          id: 1,
          name: "CI",
          path: ".github/workflows/ci.yml",
          sha256: "a".repeat(64),
          candidate_sha256: "b".repeat(64),
        },
        allowed_events: ["pull_request"],
      }],
    }),
    GOVERNED_AGENT_DATABASE_URL: databaseUrl,
    CORE_SERVICE_BUILD_ID: undefined,
    RENDER_GIT_COMMIT: undefined,
    GIT_COMMIT: "a".repeat(40),
  };
}

test("service options reject inherited, symbolic, and accessor-based provenance", async () => {
  const authoritySeams = [
    "hostNativeGovernance",
    "researchAirlockPostgresPool",
    "nyraPolicyRegistryStore",
    "nyraPolicyRegistryPostgresPool",
    "causalContinuityRuntime",
    "causalContinuityStore",
    "hostNativeRequiredChecksPolicyResolver",
  ];

  for (const name of authoritySeams) {
    const inherited = Object.create({ [name]: { forged: true } });
    assert.throws(
      () => createUniversalCoreService(inherited),
      /core_service_options_prototype_invalid/,
      `inherited_${name}`,
    );

    let getterCalls = 0;
    const accessor = {};
    Object.defineProperty(accessor, name, {
      enumerable: true,
      get() {
        getterCalls += 1;
        return { forged: true };
      },
    });
    assert.throws(
      () => createUniversalCoreService(accessor),
      /core_service_options_accessor_invalid/,
      `accessor_${name}`,
    );
    assert.equal(getterCalls, 0, `accessor_not_invoked_${name}`);
  }

  const symbolic = {};
  symbolic[Symbol("forged_authority")] = { ready: true };
  assert.throws(
    () => createUniversalCoreService(symbolic),
    /core_service_options_symbol_invalid/,
  );
  assert.throws(
    () => createUniversalCoreService([]),
    /core_service_options_invalid/,
  );

  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "null-options-"));
  const nullPrototypeOptions = Object.create(null);
  nullPrototypeOptions.storageRoot = storageRoot;
  const created = createUniversalCoreService(nullPrototypeOptions);
  try {
    assert.equal(typeof created.app, "function");
  } finally {
    await created.shutdown();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("health exposes a non-secret build identity and commit-verification state", async () => {
  const ownerContextSigningSecret = "health-owner-context-signing-secret";
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `health-build-${Date.now()}-${Math.random()}`),
    ownerContextSigningSecret,
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 200);
    assert.equal(health.ok, true);
    assert.equal(typeof health.build.build_id, "string");
    assert.equal(typeof health.build.commit_verifiable, "boolean");
    assert.ok(health.build.commit_sha === null || /^[a-f0-9]{7,}$/i.test(health.build.commit_sha));
    assert.equal(health.owner_context_signing_configured, true);
    assert.equal(JSON.stringify(health).includes(ownerContextSigningSecret), false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("liveness responds without consulting unavailable governed dependencies", async () => {
  const storageRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "host-native-liveness-"),
  );
  const calls = { policy: 0, airlock: 0, causal: 0 };
  const { app } = createUniversalCoreService({
    storageRoot,
    healthProbeTimeoutMs: 20,
    nyraPolicyRegistryStore: {
      status: async () => {
        calls.policy += 1;
        throw new Error("policy_unavailable");
      },
    },
    researchAirlockRuntime: {
      mode: "enforced",
      ready: false,
      store: { kind: "postgresql", restart_durable: true, distributed: true },
      status: async () => {
        calls.airlock += 1;
        throw new Error("airlock_unavailable");
      },
    },
    causalContinuityStore: {},
    causalContinuityRuntime: {
      initialize: async () => {},
      health: async () => {
        calls.causal += 1;
        throw new Error("causal_unavailable");
      },
      invoke: async () => ({ ok: false }),
    },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/livez`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: "universal-core-service",
      liveness: "process_running",
    });
    assert.deepEqual(calls, { policy: 0, airlock: 0, causal: 0 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("causal initialization liveness window has a 30-minute default and 60-minute hard maximum", () => {
  assert.equal(boundedCausalInitializationLivenessMs(undefined), 30 * 60 * 1_000);
  assert.equal(boundedCausalInitializationLivenessMs(61 * 60 * 1_000), 60 * 60 * 1_000);
  assert.equal(boundedCausalInitializationLivenessMs(0), 1);
  assert.equal(boundedCausalInitializationLivenessMs(Number.POSITIVE_INFINITY), 30 * 60 * 1_000);
});

test("health dependency probe timeout is bounded below the MCP upstream deadline", () => {
  assert.equal(boundedHealthProbeTimeoutMs(undefined), 1_500);
  assert.equal(boundedHealthProbeTimeoutMs(3_000), 2_500);
  assert.equal(boundedHealthProbeTimeoutMs(0), 1);
  assert.equal(boundedHealthProbeTimeoutMs(Number.POSITIVE_INFINITY), 1_500);
});

test("production host-native readiness requires gateway, separated signing, DTT, and PostgreSQL", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "true",
    CORE_MCP_TENANT_GATEWAY_KEY: undefined,
    CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET: undefined,
    CORE_OWNER_CONTEXT_SIGNING_SECRET: undefined,
    DTT_AGENT_IDENTITY_SIGNING_SECRET: undefined,
    GOVERNED_AGENT_DATABASE_URL: undefined,
  }, async () => {
    const { response, health } = await readHealth({
      hostNativeGovernance: READY_HOST_NATIVE_GOVERNANCE,
    });
    assert.equal(response.status, 503);
    assert.equal(
      health.host_native_governance.production_readiness_required,
      true,
    );
    assert.equal(
      health.host_native_governance.production_readiness_ready,
      false,
    );
    assert.deepEqual(
      health.host_native_governance.production_readiness_reasons,
      [
        "mcp_tenant_gateway_not_configured",
        "tenant_context_signing_not_configured",
        "owner_context_signing_not_configured",
        "dtt_closure_signing_not_configured",
        "governed_agent_postgres_not_configured",
      ],
    );
    assert.equal(
      JSON.stringify(health).includes("e".repeat(32)),
      false,
    );
  });
});

test("PostgreSQL 18 clears complete host-native production readiness blockers", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "true",
    GOVERNED_AGENT_DATABASE_URL: "postgresql://core.test/governance",
  }, async () => {
    const { health } = await readHealth({
      hostNativeGovernance: READY_HOST_NATIVE_GOVERNANCE,
      mcpTenantGatewayKey: "g".repeat(32),
      tenantContextSigningSecret: "t".repeat(32),
      ownerContextSigningSecret: "o".repeat(32),
      dttAgentIdentitySigningSecret: "d".repeat(32),
      governedAgentPostgresVersionProbe: postgresMajorProbe(180_004),
    });
    assert.equal(
      health.host_native_governance.production_readiness_required,
      true,
    );
    assert.equal(
      health.host_native_governance.production_readiness_ready,
      true,
    );
    assert.deepEqual(
      health.host_native_governance.production_readiness_reasons,
      [],
    );
    assert.equal(
      health.host_native_governance.mcp_tenant_gateway_configured,
      true,
    );
    assert.equal(
      health.host_native_governance.tenant_context_signing_configured,
      true,
    );
    assert.equal(
      health.host_native_governance.owner_context_signing_configured,
      true,
    );
    assert.equal(
      health.host_native_governance.dtt_closure_signing_configured,
      true,
    );
    assert.equal(
      health.host_native_governance.governed_agent_postgres_configured,
      true,
    );
    assert.deepEqual(
      health.host_native_governance.governed_agent_postgres_version,
      { major: 18, verified: true },
    );
    assert.equal(
      JSON.stringify(health).includes("postgresql://"),
      false,
    );
  });
});

test("Core production readiness rejects PostgreSQL 15 and probe errors", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "true",
    GOVERNED_AGENT_DATABASE_URL: "postgresql://core.test/governance",
  }, async () => {
    for (const [serverVersion, expectedMajor] of [
      [150_014, 15],
      [new Error("postgresql://user:secret@example.test/private"), null],
    ]) {
      const { response, health } = await readHealth({
        hostNativeGovernance: READY_HOST_NATIVE_GOVERNANCE,
        mcpTenantGatewayKey: "g".repeat(32),
        tenantContextSigningSecret: "t".repeat(32),
        ownerContextSigningSecret: "o".repeat(32),
        dttAgentIdentitySigningSecret: "d".repeat(32),
        governedAgentPostgresVersionProbe:
          postgresMajorProbe(serverVersion),
      });
      assert.equal(response.status, 503);
      assert.deepEqual(
        health.host_native_governance.production_readiness_reasons,
        ["governed_agent_postgres_major_16_not_verified"],
      );
      assert.deepEqual(
        health.host_native_governance.governed_agent_postgres_version,
        { major: expectedMajor, verified: false },
      );
      assert.equal(JSON.stringify(health).includes("postgres://"), false);
      assert.equal(JSON.stringify(health).includes("postgresql://"), false);
      assert.equal(
        JSON.stringify(health).includes("server_version_num"),
        false,
      );
    }
  });
});

test("development host-native health does not enforce production prerequisites", async () => {
  await withEnv({
    NODE_ENV: "test",
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "true",
    CORE_MCP_TENANT_GATEWAY_KEY: undefined,
    CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET: undefined,
    CORE_OWNER_CONTEXT_SIGNING_SECRET: undefined,
    DTT_AGENT_IDENTITY_SIGNING_SECRET: undefined,
    GOVERNED_AGENT_DATABASE_URL: undefined,
  }, async () => {
    const { response, health } = await readHealth({
      hostNativeGovernance: READY_HOST_NATIVE_GOVERNANCE,
    });
    assert.equal(response.status, 200);
    assert.equal(
      health.host_native_governance.production_readiness_required,
      false,
    );
    assert.equal(
      health.host_native_governance.production_readiness_ready,
      true,
    );
    assert.deepEqual(
      health.host_native_governance.production_readiness_reasons,
      [],
    );
  });
});

test("production liveness tolerates only causal initialization while readiness stays strict", async () => {
  const postgresFailureDelayMs = 300;
  const postgres = await startDelayedFailurePostgresEndpoint(postgresFailureDelayMs);
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "true",
    CORE_HOST_NATIVE_SIGNING_SECRET: "h".repeat(32),
    CORE_MCP_TENANT_GATEWAY_KEY: "g".repeat(32),
    CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET: "t".repeat(32),
    CORE_OWNER_CONTEXT_SIGNING_SECRET: "o".repeat(32),
    DTT_AGENT_IDENTITY_SIGNING_SECRET: "d".repeat(32),
    CORE_RESEARCH_AIRLOCK_MODE: "enforced",
    CORE_RESEARCH_AIRLOCK_SIGNING_SECRET: "r".repeat(32),
    CORE_NYRA_POLICY_REGISTRY_ENFORCEMENT_MODE: "advisory_evaluate",
    CORE_HOST_NATIVE_GITHUB_TOKEN_TEST: "github-test-token",
    CORE_HOST_NATIVE_GITHUB_CREDENTIAL_REGISTRY_JSON: JSON.stringify({
      schema_version: "host_native_github_credential_registry_v1",
      bindings: [{
        tenant_id: "tenant-test",
        repository: "owner/repository",
        token_env: "CORE_HOST_NATIVE_GITHUB_TOKEN_TEST",
      }],
    }),
    CORE_HOST_NATIVE_RENDER_ORIGIN_REGISTRY_JSON: JSON.stringify({
      schema_version: "host_native_render_origin_registry_v1",
      bindings: [{
        tenant_id: "tenant-test",
        repository: "owner/repository",
        service_id: "srv-test",
        environment: "production",
        origin: "https://core-test.onrender.com",
      }],
    }),
    CORE_HOST_NATIVE_REQUIRED_CHECKS_REGISTRY_JSON: JSON.stringify({
      schema_version: "host_native_required_checks_registry_v1",
      bindings: [{
        tenant_id: "tenant-test",
        repository: "owner/repository",
        base_branch: "main",
        required_checks: ["ci/test"],
        check_app: { id: 1, slug: "github-actions", owner: "github" },
        workflow: {
          id: 1,
          name: "CI",
          path: ".github/workflows/ci.yml",
          sha256: "a".repeat(64),
          candidate_sha256: "b".repeat(64),
        },
        allowed_events: ["pull_request"],
      }],
    }),
    GOVERNED_AGENT_DATABASE_URL: postgres.databaseUrl,
    CORE_SERVICE_BUILD_ID: undefined,
    RENDER_GIT_COMMIT: undefined,
    GIT_COMMIT: "a".repeat(40),
  }, async () => {
    const createService = await freshUniversalCoreService("valid-initialization");
    const service = await startHealthService(
      { healthProbeTimeoutMs: 20 },
      createService,
    );
    try {
      const healthResponse = await fetch(`${service.base}/healthz`);
      const health = await healthResponse.json();
      assert.equal(healthResponse.status, 200);
      assert.equal(health.ok, false);
      assert.equal(health.render_ready, false);
      assert.equal(health.readiness, false);
      assert.equal(health.readiness_verified, false);
      assert.equal(health.liveness_degraded, true);
      assert.equal(health.causal_continuity.state, "initializing");
      assert.equal(health.build.build_id, "a".repeat(40));
      assert.equal(health.build.commit_sha, health.build.build_id);
      assert.equal(health.build.commit_verifiable, true);
      assert.equal(health.host_native_governance.store_backend, "file_atomic");
      assert.equal(health.host_native_governance.restart_durable, true);
      assert.equal(health.host_native_governance.distributed_store, false);
      assert.equal(health.research_airlock.ready, false);
      assert.equal(health.research_airlock.operational_safe, false);
      assert.equal(health.research_airlock.accepting_new_work, false);
      const { guard_digest: digest, ...guardPayload } = health.research_airlock.bootstrap_guard;
      assert.equal(health.research_airlock.bootstrap_guard.schema_version, "research_airlock_bootstrap_guard_v1");
      assert.equal(health.research_airlock.bootstrap_guard.purpose, "causal_initialization_liveness");
      assert.equal(health.research_airlock.bootstrap_guard.mode, "enforced");
      assert.equal(health.research_airlock.bootstrap_guard.store_backend, "postgresql");
      assert.equal(health.research_airlock.bootstrap_guard.restart_durable, true);
      assert.equal(health.research_airlock.bootstrap_guard.distributed, true);
      assert.equal(health.research_airlock.bootstrap_guard.static_guard_ready, true);
      assert.equal(health.research_airlock.bootstrap_guard.runtime_verified, false);
      assert.equal(health.research_airlock.bootstrap_guard.readiness_verified, false);
      assert.equal(digest, causalDigest(guardPayload));
      assert.equal(Object.hasOwn(health.research_airlock.bootstrap_guard, "ready"), false);
      assert.equal(Object.hasOwn(health.research_airlock.bootstrap_guard, "readiness"), false);
      assert.equal(Object.hasOwn(health.research_airlock.bootstrap_guard, "runtime"), false);
      assert.equal(health.research_airlock.bootstrap_guard.accepting_new_work, false);

      const pendingReadyResponse = await fetch(`${service.base}/readyz`);
      const pendingReady = await pendingReadyResponse.json();
      assert.equal(pendingReadyResponse.status, 503);
      assert.equal(pendingReady.ok, false);
      assert.equal(pendingReady.render_ready, false);
    } finally {
      await new Promise((resolve) => setTimeout(resolve, postgresFailureDelayMs + 50));
      await postgres.close();
      await within(service.close(), 2_000, "health_service_cleanup_timeout");
    }
  }).finally(() => postgres.close());
});

test("release bootstrap option injections cannot mint degraded liveness", async () => {
  const postgres = await startDelayedFailurePostgresEndpoint(5_000);
  const services = [];
  const injections = [
    ["bootstrapAuthorityTrustPinJson", "{\"forged\":true}"],
    ["bootstrapReleaseExceptionStore", { ready: true }],
    ["bootstrapRequiredChecksReadback", async () => ({ ready: true })],
    ["bootstrapReleasePreparationBaseBranchResolver", async () => "main"],
    ["bootstrapReleasePreparationService", { ready: true }],
  ];
  try {
    await withEnv(serverOwnedBootstrapEnvironment(postgres.databaseUrl), async () => {
      for (const [name, value] of injections) {
        const createService = await freshUniversalCoreService(`release-seam-${name}`);
        const service = await startHealthService({
          healthProbeTimeoutMs: 20,
          [name]: value,
        }, createService);
        services.push(service);
        const response = await fetch(`${service.base}/healthz`);
        const health = await response.json();
        assert.equal(response.status, 503, name);
        assert.equal(health.liveness_degraded, false, name);
        assert.equal(health.render_ready, false, name);
        assert.equal(health.research_airlock.bootstrap_guard, undefined, name);
      }
    });
  } finally {
    await postgres.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    for (const service of services) {
      await within(service.close(), 2_000, "release_seam_service_cleanup_timeout");
    }
  }
});

test("causal bootstrap accepts only the durable server-owned host-native file backend and all static authority prerequisites", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "false",
    GOVERNED_AGENT_DATABASE_URL: "postgresql://core.test/governance",
    CORE_SERVICE_BUILD_ID: undefined,
    RENDER_GIT_COMMIT: undefined,
    GIT_COMMIT: "a".repeat(40),
  }, async () => {
    const createService = await freshUniversalCoreService("bootstrap-static-guard-blocks");
    const cases = [
      ["governance_disabled", { hostNativeGovernance: null }],
      ["gateway_missing", { mcpTenantGatewayKey: "" }],
      ["signer_missing", { hostNativeSigningSecret: "" }],
      ["dtt_missing", { dttAgentIdentitySigningSecret: "", resolveDttVerifierIdentity: undefined }],
      ["readback_missing", { hostNativeGovernance: { ...READY_HOST_NATIVE_GOVERNANCE, trusted_readback_configured: false } }],
      ["generic_file_backend", { hostNativeGovernance: {
        ...READY_HOST_NATIVE_GOVERNANCE,
        storage: { kind: "file", restart_durable: true, distributed: false },
      } }],
      ["non_durable_file_atomic", { hostNativeGovernance: {
        ...READY_HOST_NATIVE_GOVERNANCE,
        storage: { kind: "file_atomic", restart_durable: false, distributed: false },
      } }],
      ["unknown_backend", { hostNativeGovernance: {
        ...READY_HOST_NATIVE_GOVERNANCE,
        storage: { kind: "unknown", restart_durable: true, distributed: false },
      } }],
      ["injected_backend", { hostNativeGovernance: {
        ...READY_HOST_NATIVE_GOVERNANCE,
        storage: { kind: "injected", restart_durable: true, distributed: true },
      } }],
      ["resolver_invalid", { hostNativeResolverConfigurationValid: false }],
      ["airlock_shadow", { researchAirlockMode: "shadow" }],
      ["policy_disabled", { nyraPolicyRegistryEnforcementMode: "disabled" }],
      ["policy_enforced_without_static_proof", { nyraPolicyRegistryEnforcementMode: "enforced" }],
      ["injected_research_airlock_pool", { researchAirlockPostgresPool: healthyPostgresPool() }],
      ["injected_policy_pool", { nyraPolicyRegistryPostgresPool: healthyPostgresPool() }],
      ["injected_policy_store", { nyraPolicyRegistryStore: {
        kind: "postgresql",
        restart_durable: true,
        distributed: true,
        status: async () => ({ backend: "postgresql", ready: true }),
      } }],
      ["injected_causal_store", { causalContinuityStore: {
        kind: "postgresql",
        restart_durable: true,
        distributed: true,
      } }],
      ["injected_causal_runtime", { causalContinuityRuntime: {
        initialize: () => new Promise(() => {}),
        health: async () => ({ ok: true }),
        invoke: async () => ({ ok: true }),
      } }],
      ["injected_postgres_probe", { governedAgentPostgresVersionProbe: postgresMajorProbe(180_004) }],
      ["injected_airlock", {
        researchAirlockRuntime: {
          mode: "enforced",
          ready: true,
          store: { kind: "postgresql", restart_durable: true, distributed: true },
          status: async () => ({ mode: "enforced", ready: true, operational_safe: true, state_backend: "postgresql" }),
        },
      }],
      ["forged_allow_test_store_runtime", {
        researchAirlockRuntime: {
          mode: "enforced",
          ready: true,
          allowTestStore: true,
          store: { kind: "postgresql", restart_durable: true, distributed: true },
          status: async () => ({ mode: "enforced", ready: true, operational_safe: true, state_backend: "postgresql" }),
        },
      }],
    ];
    for (const [name, overrides] of cases) {
      const service = await startHealthService(
        causalProductionBootstrapOptions(() => new Promise(() => {}), {
          healthProbeTimeoutMs: 20,
          ...overrides,
        }),
        createService,
      );
      try {
        const response = await fetch(`${service.base}/healthz`);
        const health = await response.json();
        assert.equal(response.status, 503, name);
        assert.equal(health.liveness_degraded, false, name);
        assert.equal(health.render_ready, false, name);
        assert.equal(health.research_airlock.bootstrap_guard, undefined, name);
      } finally {
        await service.close();
      }
    }
  });
});

test("causal bootstrap rejects a forged BUILD_ID even when the commit is verifiable", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "false",
    GOVERNED_AGENT_DATABASE_URL: "postgresql://core.test/governance",
    CORE_SERVICE_BUILD_ID: "b".repeat(40),
    RENDER_GIT_COMMIT: undefined,
    GIT_COMMIT: "a".repeat(40),
  }, async () => {
    const createService = await freshUniversalCoreService("forged-build-id");
    const service = await startHealthService(
      causalProductionBootstrapOptions(() => new Promise(() => {}), { healthProbeTimeoutMs: 20 }),
      createService,
    );
    try {
      const response = await fetch(`${service.base}/healthz`);
      const health = await response.json();
      assert.equal(response.status, 503);
      assert.equal(health.build.commit_verifiable, true);
      assert.notEqual(health.build.build_id, health.build.commit_sha);
      assert.equal(health.liveness_degraded, false);
      assert.equal(health.research_airlock.bootstrap_guard, undefined);
    } finally {
      await service.close();
    }
  });
});

test("injected blocking DB probes are bounded and cannot mint degraded bootstrap liveness", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "false",
    GOVERNED_AGENT_DATABASE_URL: "postgresql://core.test/governance",
    CORE_SERVICE_BUILD_ID: undefined,
    RENDER_GIT_COMMIT: undefined,
    GIT_COMMIT: "a".repeat(40),
  }, async () => {
    const createService = await freshUniversalCoreService("blocking-health-probes");
    const calls = { policy: 0, airlock: 0 };
    const hangingPool = (name) => ({
      query() {
        calls[name] += 1;
        return new Promise(() => {});
      },
      async connect() {
        return { query: this.query.bind(this), release() {} };
      },
    });
    const policyPool = hangingPool("policy");
    const airlockPool = hangingPool("airlock");
    const service = await startHealthService(causalProductionBootstrapOptions(
      () => new Promise(() => {}),
      {
        healthProbeTimeoutMs: 20,
        nyraPolicyRegistryPostgresPool: policyPool,
        researchAirlockPostgresPool: airlockPool,
      },
    ), createService);
    const constructionCalls = { ...calls };
    try {
      const startedAt = Date.now();
      const healthResponse = await fetch(`${service.base}/healthz`);
      const health = await healthResponse.json();
      assert.equal(healthResponse.status, 503);
      assert.equal(health.ok, false);
      assert.equal(health.render_ready, false);
      assert.equal(health.liveness_degraded, false);
      assert.equal(health.research_airlock.bootstrap_guard, undefined);
      assert.equal(calls.airlock, constructionCalls.airlock + 1);
      assert.ok(Date.now() - startedAt < 250);
      assert.equal(health.nyra_policy_registry.state, "probe_timeout");
      assert.equal(health.research_airlock.state, "probe_timeout");

      const readyStartedAt = Date.now();
      const readyResponse = await fetch(`${service.base}/readyz`);
      const ready = await readyResponse.json();
      assert.equal(readyResponse.status, 503);
      assert.equal(ready.ok, false);
      assert.equal(ready.render_ready, false);
      // The store's own initialization is also single-flight, so the second
      // bounded probe reuses its one unresolved initialization query.
      assert.equal(calls.airlock, constructionCalls.airlock + 1);
      assert.ok(Date.now() - readyStartedAt < 250);
      assert.equal(ready.nyra_policy_registry.state, "probe_timeout");
      assert.equal(ready.research_airlock.state, "probe_timeout");
    } finally {
      await service.close();
    }
  });
});

test("timed-out strict health flights are generation-safe and retry a recovered dependency", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "false",
    GOVERNED_AGENT_DATABASE_URL: "postgresql://core.test/governance",
    CORE_SERVICE_BUILD_ID: undefined,
    RENDER_GIT_COMMIT: undefined,
    GIT_COMMIT: "a".repeat(40),
  }, async () => {
    const createService = await freshUniversalCoreService("health-probe-recovery");
    let recovered = false;
    let calls = 0;
    const service = await startHealthService(causalProductionOptions(
      async () => {},
      {
        healthProbeTimeoutMs: 20,
        nyraPolicyRegistryStore: {
          status: () => {
            calls += 1;
            return recovered
              ? { configured: true, backend: "postgresql", restart_durable: true, distributed: true, state: "ready", ready: true }
              : new Promise(() => {});
          },
        },
      },
    ), createService);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      const first = await fetch(`${service.base}/readyz`);
      assert.equal(first.status, 503);
      assert.equal(calls, 1);
      recovered = true;
      const second = await fetch(`${service.base}/readyz`);
      assert.equal(second.status, 200);
      assert.equal(calls, 2);
    } finally {
      await service.close();
    }
  });
});

test("action evaluator readiness exposes schema state and retries transient initialization", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "false",
    GOVERNED_AGENT_DATABASE_URL: "postgresql://core.test/governance",
    CORE_SERVICE_BUILD_ID: undefined,
    RENDER_GIT_COMMIT: undefined,
    GIT_COMMIT: "a".repeat(40),
  }, async () => {
    const createService = await freshUniversalCoreService("action-idempotency-readiness-retry");
    let attempts = 0;
    const actionStore = healthyActionEvaluatorIdempotencyStore();
    actionStore.initialize = async function initialize() {
      attempts += 1;
      if (attempts === 1 || attempts === 3) {
        const error = new Error(attempts === 3
          ? "core_action_idempotency_schema_unverified"
          : "core_action_idempotency_store_unavailable");
        error.code = error.message;
        throw error;
      }
      return {
        schema_version: this.schema_version,
        schema_digest: this.schema_digest,
        schema_verified: true,
        append_only_enforced: true,
      };
    };
    const service = await startHealthService(causalProductionOptions(
      async () => {},
      { actionEvaluatorIdempotencyStore: actionStore },
    ), createService);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      const firstResponse = await fetch(`${service.base}/readyz`);
      const first = await firstResponse.json();
      assert.equal(firstResponse.status, 503);
      assert.equal(first.action_evaluator_idempotency.ready, false);
      assert.equal(first.action_evaluator_idempotency.state, "unavailable");
      const secondResponse = await fetch(`${service.base}/readyz`);
      const second = await secondResponse.json();
      assert.equal(secondResponse.status, 200);
      assert.equal(second.action_evaluator_idempotency.ready, true);
      assert.equal(second.action_evaluator_idempotency.schema_verified, true);
      assert.equal(second.action_evaluator_idempotency.append_only_enforced, true);
      assert.equal(attempts, 2);
      const driftedResponse = await fetch(`${service.base}/readyz`);
      const drifted = await driftedResponse.json();
      assert.equal(driftedResponse.status, 503);
      assert.equal(drifted.action_evaluator_idempotency.ready, false);
      assert.equal(drifted.action_evaluator_idempotency.state, "unavailable");
      assert.equal(drifted.action_evaluator_idempotency.error,
        "core_action_idempotency_schema_unverified");
      assert.equal(attempts, 3);
    } finally {
      await service.close();
    }
  });
});

test("permanently hung health probes retain at most one orphan and one active replacement", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "false",
    GOVERNED_AGENT_DATABASE_URL: "postgresql://core.test/governance",
    CORE_SERVICE_BUILD_ID: undefined,
    RENDER_GIT_COMMIT: undefined,
    GIT_COMMIT: "a".repeat(40),
  }, async () => {
    const createService = await freshUniversalCoreService("health-probe-orphan-bound");
    let calls = 0;
    const service = await startHealthService(causalProductionOptions(
      async () => {},
      {
        healthProbeTimeoutMs: 20,
        nyraPolicyRegistryStore: {
          status: () => {
            calls += 1;
            return new Promise(() => {});
          },
        },
      },
    ), createService);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await fetch(`${service.base}/readyz`);
        const health = await response.json();
        assert.equal(response.status, 503, `attempt_${attempt}`);
        assert.equal(health.render_ready, false, `attempt_${attempt}`);
        assert.equal(health.nyra_policy_registry.state, "probe_timeout", `attempt_${attempt}`);
      }
      assert.equal(calls, 2);
    } finally {
      await service.close();
    }
  });
});

test("production liveness remains fail-closed for causal failure and invalid build", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "false",
    GOVERNED_AGENT_DATABASE_URL: "postgresql://core.test/governance",
    CORE_SERVICE_BUILD_ID: undefined,
    RENDER_GIT_COMMIT: undefined,
    GIT_COMMIT: "a".repeat(40),
  }, async () => {
    const createService = await freshUniversalCoreService("valid-failures");
    const failed = await startHealthService(
      causalProductionOptions(async () => { throw new Error("causal_bootstrap_failed"); }),
      createService,
    );
    try {
      await new Promise((resolve) => setImmediate(resolve));
      const response = await fetch(`${failed.base}/healthz`);
      const health = await response.json();
      assert.equal(response.status, 503);
      assert.equal(health.ok, false);
      assert.equal(health.render_ready, false);
      assert.equal(health.liveness_degraded, false);
      assert.equal(health.causal_continuity.state, "initialization_failed");
    } finally {
      await failed.close();
    }

    const neverFinishes = new Promise(() => {});
    const createInvalidBuildService = await withEnv({
      GIT_COMMIT: "invalid-build",
    }, () => freshUniversalCoreService("invalid-build"));
    const invalidBuild = await startHealthService(
      causalProductionOptions(() => neverFinishes),
      createInvalidBuildService,
    );
    try {
      const response = await fetch(`${invalidBuild.base}/healthz`);
      const health = await response.json();
      assert.equal(response.status, 503);
      assert.equal(health.ok, false);
      assert.equal(health.render_ready, false);
      assert.equal(health.liveness_degraded, false);
      assert.equal(health.build.commit_verifiable, false);
      assert.equal(health.build.build_id, "invalid-build");
      assert.equal(health.build.commit_sha, health.build.build_id);
    } finally {
      await invalidBuild.close();
    }

    const unsafeAirlock = await startHealthService(
      causalProductionOptions(() => neverFinishes, {
        researchAirlockRuntime: {
          mode: "enforced",
          store: { kind: "test_persistent" },
          status: async () => ({
            mode: "enforced",
            ready: false,
            operational_safe: false,
            state_backend: "test_persistent",
          }),
        },
      }),
      createService,
    );
    try {
      const response = await fetch(`${unsafeAirlock.base}/healthz`);
      const health = await response.json();
      assert.equal(response.status, 503);
      assert.equal(health.ok, false);
      assert.equal(health.render_ready, false);
      assert.equal(health.liveness_degraded, false);
      assert.equal(health.research_airlock.ready, false);
    } finally {
      await unsafeAirlock.close();
    }

    const boundedInitialization = await startHealthService(
      causalProductionOptions(
        () => neverFinishes,
        { causalContinuityInitializationLivenessMs: 20 },
      ),
      createService,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 35));
      const response = await fetch(`${boundedInitialization.base}/healthz`);
      const health = await response.json();
      assert.equal(response.status, 503);
      assert.equal(health.ok, false);
      assert.equal(health.render_ready, false);
      assert.equal(health.liveness_degraded, false);
      assert.equal(health.causal_continuity.state, "initializing");
    } finally {
      await boundedInitialization.close();
    }
  });
});

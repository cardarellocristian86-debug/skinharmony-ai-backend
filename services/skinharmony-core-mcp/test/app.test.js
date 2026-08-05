import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildIdentity, buildReadiness, createApp, inferClientType, requiresGenericWorkPreflight, toolFailure, TOOLS } from "../src/app.js";
import { createCollaborationHandlers } from "../src/collaboration-handlers.js";
import { COMPACT_MCP_TOOL_NAMES } from "../src/dynamic-capability-router.js";
import { WORK_CONTINUITY_TOOLS } from "../src/work-continuity-tools.js";
import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  HOST_NATIVE_HEALTH_CONTRACT_VERSION,
} from "../src/host-native-health-contract.js";
import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST as CORE_HEALTH_CONTRACT_DIGEST,
  HOST_NATIVE_HEALTH_CONTRACT_VERSION as CORE_HEALTH_CONTRACT_VERSION,
} from "../../universal-core-service/src/hostNativeGovernance.js";
import {
  createPostgresMajorVersionProbe,
} from "../../shared/postgres-major-version.js";

const config = {
  publicUrl: "https://mcp.example.test",
  resource: "https://mcp.example.test/mcp",
  auth0Issuer: "https://tenant.auth0.com",
  auth0Audience: "https://core",
  jwksUri: "https://tenant.auth0.com/.well-known/jwks.json",
  codexKeys: ["codex-key"],
  codexScopes: ["core:read", "core:govern"],
  defaultTenantId: "owner-private",
  supportedScopes: ["core:read", "core:govern"]
};

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

async function serve(run, configOverride = {}, optionsOverride = {}) {
  const handlers = Object.fromEntries(TOOLS.map((tool) => [tool.name, async () => ({ content: [{ type: "text", text: "ok" }] })]));
  const app = createApp({ ...config, ...configOverride }, { handlers, ...optionsOverride });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("requires an explicit environment and delegates staging without forwarding user bearer credentials", async () => {
  const stagingHandlers = Object.fromEntries(TOOLS.map((tool) => [tool.name, async () => ({ content: [{ type: "text", text: tool.name === "core_health" ? "staging" : "ok" }] })]));
  const staging = createApp({ ...config, environmentDelegationReceiverEnabled: true, environmentDelegationKey: "a".repeat(48) }, { handlers: stagingHandlers });
  const server = staging.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await serve(async (base) => {
      const headers = { authorization: "Bearer codex-key", "content-type": "application/json" };
      const listed = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }).then((response) => response.json());
      const health = listed.result.tools.find((tool) => tool.name === "core_health");
      assert.ok(health.inputSchema.required.includes("environment"));
      assert.deepEqual(health.inputSchema.properties.environment.enum, ["production", "staging"]);
      const missing = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "core_health", arguments: {} } }) }).then((response) => response.json());
      assert.equal(missing.error.code, -32602);
      const delegated = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "core_health", arguments: { environment: "staging" } } }) }).then((response) => response.json());
      assert.equal(delegated.result.content[0].text, "staging");
    }, { environmentRoutingRequired: true, environmentDelegationKey: "a".repeat(48), stagingMcpUrl: `http://127.0.0.1:${server.address().port}` });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("classifies verified connector identities by host", () => {
  assert.equal(inferClientType({ kind: "oauth" }), "chatgpt");
  assert.equal(inferClientType({ kind: "chatgpt" }), "chatgpt");
  assert.equal(inferClientType({ kind: "codex" }), "codex");
  assert.equal(inferClientType({ kind: "service" }), "api_agent");
});

test("passes the signed logical session to mandatory presence registration before a normal tool", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-mandatory-presence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const presenceConfig = {
    ...config,
    environment: "production",
    production: true,
    mandatoryAgentPresenceEnabled: true,
    agentSignatureSecret: "p".repeat(32),
    agentWorkspaceRoot: root,
  };
  const collaboration = createCollaborationHandlers(presenceConfig, {
    govern: async () => ({ allowed: true, decision: "allow_controlled", mediation: "allow" }),
  });
  let registeredIdentity;
  const app = createApp(presenceConfig, {
    handlers: {
      core_health: async () => ({ structuredContent: { ok: true }, content: [{ type: "text", text: "ok" }] }),
    },
    beforeToolCall: async ({ identity, toolName }) => {
      registeredIdentity = identity;
      if (presenceConfig.mandatoryAgentPresenceEnabled && toolName !== "agent_heartbeat") {
        await collaboration.registerAuthenticatedPresence(identity);
      }
      return { preflight: null };
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mandatory-presence",
        method: "tools/call",
        params: {
          name: "core_health",
          arguments: {
            agent_id: "codex-presence-test",
            client_type: "codex",
            session_id: "presence-session-test",
          },
        },
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.result.structuredContent.ok, true);
    assert.equal(registeredIdentity.agentPresence.session_id, "presence-session-test");
    const restarted = createCollaborationHandlers(presenceConfig, {
      govern: async () => ({ allowed: true, decision: "allow_controlled", mediation: "allow" }),
    });
    const registered = JSON.parse((await restarted.agent_list({}, registeredIdentity)).content[0].text).agents;
    assert.equal(registered.length, 1);
    assert.equal(registered[0].id, "codex-presence-test");
    assert.equal(registered[0].display_name, "codex-presence-test");
    assert.deepEqual(registered[0].capabilities, []);
    assert.equal(registered[0].signature, body.result.structuredContent.agent_presence.signature);
    assert.equal(registered[0].session_fingerprint, body.result.structuredContent.agent_presence.session_fingerprint);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("limits the dynamic presence bootstrap exemption to the exact agent heartbeat capability", () => {
  const isAgentPresenceBootstrapCall = (toolName, args = {}) =>
    toolName === "agent_heartbeat" ||
    ((toolName === "core_capability_catalog" || toolName === "core_capability_invoke") &&
      args?.capability_id === "agent_heartbeat");

  assert.equal(isAgentPresenceBootstrapCall("agent_heartbeat"), true);
  assert.equal(isAgentPresenceBootstrapCall("core_capability_catalog", { capability_id: "agent_heartbeat" }), true);
  assert.equal(isAgentPresenceBootstrapCall("core_capability_invoke", { capability_id: "agent_heartbeat" }), true);
  assert.equal(isAgentPresenceBootstrapCall("core_capability_catalog"), false);
  assert.equal(isAgentPresenceBootstrapCall("core_capability_catalog", { capability_id: "core_health" }), false);
  assert.equal(isAgentPresenceBootstrapCall("core_capability_catalog", { capability_id: "agent_heartbeat_extra" }), false);
  assert.equal(isAgentPresenceBootstrapCall("core_capability_catalog", { capability_id: "AGENT_HEARTBEAT" }), false);
  assert.equal(isAgentPresenceBootstrapCall("core_capability_catalog", { args: { capability_id: "agent_heartbeat" } }), false);
  assert.equal(isAgentPresenceBootstrapCall("core_capability_invoke", { capability_id: "core_health" }), false);
  assert.equal(isAgentPresenceBootstrapCall("core_capability_invoke", { capability_id: "agent_heartbeat_extra" }), false);
  assert.equal(isAgentPresenceBootstrapCall("core_capability_invoke", { capability_id: "AGENT_HEARTBEAT" }), false);
  assert.equal(isAgentPresenceBootstrapCall("core_capability_invoke", { args: { capability_id: "agent_heartbeat" } }), false);

  const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(serverSource, /!isAgentPresenceBootstrapCall\(toolName, args\)/);
  assert.match(
    serverSource,
    /if \(toolName === "agent_heartbeat"\) return "agent\.heartbeat";/,
  );
});

test("allows server-issued MCP session bootstrap for agent heartbeat", () => {
  const heartbeat = TOOLS.find((tool) => tool.name === "agent_heartbeat");
  assert.ok(heartbeat);
  assert.deepEqual(heartbeat.inputSchema.required, ["agent_id", "client_type"]);
  const appSource = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(appSource, /SESSIONLESS_BOOTSTRAP_TOOLS = new Set\(\[\s*"agent_heartbeat"/);
  assert.match(appSource, /isAgentPresenceBootstrapCall\(tool\.name, rawArgs\)/);
  assert.match(appSource, /const presenceBinding = \{\s*\.\.\.attestedAgentPresence/);
  assert.match(appSource, /agentPresence: presenceBinding/);
  assert.match(appSource, /Access-Control-Expose-Headers/);
});

test("publishes only a verifiable build identity", () => {
  const commit = "e".repeat(40);
  assert.deepEqual(buildIdentity({ RENDER_GIT_COMMIT: commit }), { commit_sha: commit, commit_verifiable: true });
  assert.equal(buildIdentity({ RENDER_GIT_COMMIT: "not-a-commit" }), null);
  assert.equal(buildIdentity({}), null);
});

test("classifies dynamic capability client errors as non-retryable", () => {
  const cases = [
    ["dynamic_capability_arguments_invalid", 422],
    ["dynamic_capability_query_required", 422],
    ["dynamic_capability_candidates_empty", 422],
    ["dynamic_capability_id_invalid", 422],
    ["dynamic_capability_reserved_argument", 422],
    ["dynamic_capability_arguments_too_large", 413],
    ["dynamic_capability_arguments_too_deep", 413],
    ["dynamic_capability_catalog_revision_mismatch", 409],
    ["dynamic_capability_unavailable", 404],
    ["dynamic_capability_read_only_required", 409],
    ["dynamic_capability_mutation_required", 409],
    ["dynamic_capability_not_authorized", 403],
    ["owner_confirmation_required", 403],
    ["idempotency_key_required", 422],
  ];
  for (const [code, status] of cases) {
    const error = Object.assign(new Error(code), {
      violations: [{ path: "$.secret", message: "must remain private" }],
    });
    const result = toolFailure(error);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, code);
    assert.equal(result.structuredContent.error.status, status);
    assert.equal(result.structuredContent.error.retryable, false);
    assert.equal(JSON.stringify(result).includes("must remain private"), false);
  }
  const invalid = toolFailure(new Error("dynamic_capability_arguments_invalid"));
  assert.equal(invalid.structuredContent.error.message, "The capability arguments failed schema validation.");
});

test("keeps only genuine transient failures retryable", () => {
  const upstream = toolFailure(new Error("core_request_failed:503:core_unavailable"));
  assert.equal(upstream.structuredContent.error.status, 503);
  assert.equal(upstream.structuredContent.error.retryable, true);
  assert.equal(upstream.structuredContent.error.message, "The governed backend is temporarily unavailable.");

  const explicit = toolFailure(Object.assign(new Error("provider_timeout"), { status: 500, retryable: true }));
  assert.equal(explicit.structuredContent.error.retryable, true);

  const unexpected = toolFailure(new Error("unexpected internal failure"));
  assert.equal(unexpected.structuredContent.error.status, 500);
  assert.equal(unexpected.structuredContent.error.retryable, false);
  assert.equal(unexpected.structuredContent.error.message, "The governed request failed.");
});

test("publishes protected-resource and PKCE S256 metadata", async () => serve(async (base) => {
  const health = await fetch(`${base}/healthz`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.render_ready, false);
  assert.equal(health.readiness.enforced, false);
  assert.equal(health.readiness.ready, false);
  assert(health.readiness.reasons.includes("build_identity_unverifiable"));
  assert(health.readiness.reasons.includes("universal_core_not_configured"));
  assert.equal(health.health_contract_version, HOST_NATIVE_HEALTH_CONTRACT_VERSION);
  assert.equal(health.health_contract_digest, HOST_NATIVE_HEALTH_CONTRACT_DIGEST);
  assert.equal(HOST_NATIVE_HEALTH_CONTRACT_VERSION, CORE_HEALTH_CONTRACT_VERSION);
  assert.equal(HOST_NATIVE_HEALTH_CONTRACT_DIGEST, CORE_HEALTH_CONTRACT_DIGEST);
  assert.equal(health.version, "0.16.0-governed-continuity-fabric");
  assert.equal(health.build, null);
  assert.equal(health.memory_fabric_configured, false);
  assert.equal(health.research_cortex_configured, false);
  assert.equal(Object.hasOwn(health, "openai_research_fallback_enabled"), false);
  assert.equal(Object.hasOwn(health, "provider_setup_link_source_configured"), false);
  assert.equal(health.owner_context_signing_configured, false);
  assert.equal(health.tenant_membership_bindings, 0);
  assert.equal(health.work_continuity.configured, false);
  assert.equal(health.work_continuity.enabled, false);
  assert.equal(health.work_continuity.backend, "disabled");
  assert.equal(health.work_continuity.persistent, false);
  assert.equal(health.work_continuity.schema_version, "work_continuity_v2");
  assert.equal(health.work_continuity.gallery_schema_version, "tenant_work_gallery_v1");
  assert.equal(health.work_continuity.auto_capture_enabled, false);
  assert.equal(health.work_continuity.intent_anchor_redacted, true);
  assert.equal(health.work_continuity.raw_prompts_stored, false);
  assert.equal(health.work_continuity.tenant_isolated, true);
  assert.equal(health.work_continuity.bounded_leases, true);
  assert.equal(health.work_continuity.agent_ownership_allowed, false);
  assert.equal(health.host_native_agents.provider_execution, false);
  assert.equal(health.host_native_agents.provider_api_key_required, false);
  assert.equal(health.host_native_agents.server_model_calls, 0);
  const resource = await fetch(`${base}/.well-known/oauth-protected-resource`).then((r) => r.json());
  assert.equal(resource.resource, config.resource);
  assert.deepEqual(resource.authorization_servers, [config.auth0Issuer]);
  const pathResource = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`).then((r) => r.json());
  assert.deepEqual(pathResource, resource);
  const migrationResource = await fetch(`${base}/.well-known/oauth-protected-resource/mcp-v015`).then((r) => r.json());
  assert.equal(migrationResource.resource, config.resource);
  assert.deepEqual(migrationResource.authorization_servers, [config.auth0Issuer]);
  const oauth = await fetch(`${base}/.well-known/oauth-authorization-server`).then((r) => r.json());
  assert.deepEqual(oauth.code_challenge_methods_supported, ["S256"]);
}));

test("cannot force Render readiness with the legacy boolean", async () => {
  const handlers = Object.fromEntries(
    TOOLS.map((tool) => [tool.name, async () => ({
      content: [{ type: "text", text: "ok" }],
    })]),
  );
  const app = createApp(config, { handlers, renderReady: true });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const health = await fetch(`http://127.0.0.1:${server.address().port}/healthz`)
      .then((response) => response.json());
    assert.equal(health.render_ready, false);
    assert.equal(health.readiness.ready, false);
    assert(health.readiness.reasons.includes("build_identity_unverifiable"));
    assert(health.readiness.reasons.includes("universal_core_not_configured"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production readiness fails closed with coded non-secret component blockers", async () => {
  const productionConfig = {
    ...config,
    environment: "production",
    production: true,
    auth0Issuer: "",
    codexKeys: [],
    runtimeBuildCommit: "",
    universalCoreUrl: "https://core.example.test",
    universalCoreKey: "",
    universalCoreKeys: {},
    tenantGatewayKey: "",
    databaseUrl: "",
    workContinuityAutoCaptureEnabled: true,
    hostNativeAgentProtocolEnabled: true,
    decisionLedgerRequired: true,
  };
  const handlers = Object.fromEntries(
    TOOLS.map((tool) => [tool.name, async () => ({
      content: [{ type: "text", text: "ok" }],
    })]),
  );
  const app = createApp(productionConfig, {
    handlers,
    buildIdentity: null,
    readiness: {
      continuityInitialized: false,
      decisionLedgerInitialized: false,
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 503);
    assert.equal(health.ok, false);
    assert.equal(health.render_ready, false);
    assert.deepEqual(health.readiness.reasons, [
      "build_identity_unverifiable",
      "authentication_not_configured",
      "universal_core_not_configured",
      "host_native_tenant_gateway_not_configured",
      "host_native_owner_context_signing_not_configured",
      "host_native_tenant_context_signing_not_configured",
      "host_native_dtt_identity_signing_not_configured",
      "host_native_agent_signature_not_configured",
      "continuity_postgres_not_configured",
      "decision_ledger_not_configured",
    ]);
    assert.equal(
      health.readiness.components.host_native_security.required,
      true,
    );
    assert.equal(health.tenant_context_signing_configured, false);
    assert.equal(health.host_native_agents.tenant_context_signing_configured, false);
    assert.equal(health.host_native_agents.agent_signature_configured, false);
    assert.equal(health.host_native_agents.agent_signature_independent, false);
    assert.equal(health.host_native_agents.ready, false);
    assert.equal(health.readiness.components.universal_core.reachability_checked, false);
    assert.equal(JSON.stringify(health).includes("tenant-core-secret"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production on PostgreSQL 18 becomes ready after required runtimes initialize", async () => {
  const readiness = {
    continuityInitialized: false,
    decisionLedgerInitialized: false,
  };
  const productionConfig = {
    ...config,
    environment: "production",
    production: true,
    runtimeBuildCommit: "a".repeat(40),
    universalCoreUrl: "https://core.example.test",
    universalCoreKey: "tenant-core-secret",
    universalCoreKeys: {},
    tenantGatewayKey: "g".repeat(32),
    ownerContextSigningSecret: "o".repeat(32),
    tenantContextSigningSecret: "t".repeat(32),
    dttAgentIdentitySigningSecret: "d".repeat(32),
    agentSignatureSecret: "z".repeat(32),
    databaseUrl: "postgres://configured-but-not-returned",
    workContinuityAutoCaptureEnabled: true,
    hostNativeAgentProtocolEnabled: true,
    decisionLedgerRequired: true,
  };
  const handlers = Object.fromEntries(
    TOOLS.map((tool) => [tool.name, async () => ({
      content: [{ type: "text", text: "ok" }],
    })]),
  );
  const app = createApp(productionConfig, {
    handlers,
    readiness,
    postgresMajorVersionProbe: postgresMajorProbe(180_004),
    fetchImpl: async () => new Response(JSON.stringify({
      research_airlock: { ready: true, mode: "enforced", state_backend: "postgresql" },
      build: { commit_sha: "a".repeat(40) },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const healthUrl = `http://127.0.0.1:${server.address().port}/healthz`;
  try {
    const pendingResponse = await fetch(healthUrl);
    const pending = await pendingResponse.json();
    assert.equal(pendingResponse.status, 503);
    assert.deepEqual(pending.readiness.reasons, [
      "continuity_not_initialized",
      "decision_ledger_not_initialized",
    ]);
    readiness.continuityInitialized = true;
    readiness.decisionLedgerInitialized = true;
    const readyResponse = await fetch(healthUrl);
    const ready = await readyResponse.json();
    assert.equal(readyResponse.status, 200);
    assert.equal(ready.ok, true);
    assert.equal(ready.render_ready, true);
    assert.deepEqual(ready.readiness.reasons, []);
    assert.equal(ready.readiness.components.work_continuity.initialized, true);
    assert.equal(ready.readiness.components.decision_ledger.initialized, true);
    assert.equal(ready.readiness.components.host_native_security.ready, true);
    assert.equal(ready.host_native_agents.ready, true);
    assert.equal(ready.tenant_context_signing_configured, true);
    assert.equal(ready.host_native_agents.tenant_context_signing_configured, true);
    assert.equal(ready.host_native_agents.agent_signature_configured, true);
    assert.equal(ready.host_native_agents.agent_signature_independent, true);
    assert.deepEqual(ready.postgresql, { major: 18, verified: true });
    assert.equal(JSON.stringify(ready).includes("tenant-core-secret"), false);
    assert.equal(JSON.stringify(ready).includes("z".repeat(32)), false);
    assert.equal(JSON.stringify(ready).includes("postgres://"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production MCP health fails closed when enforced Core Airlock is unreachable", async () => {
  const productionConfig = {
    ...config,
    environment: "production",
    production: true,
    runtimeBuildCommit: "a".repeat(40),
    universalCoreUrl: "https://core.example.test",
    universalCoreKey: "tenant-core-secret",
    universalCoreKeys: {},
    databaseUrl: "",
    workContinuityAutoCaptureEnabled: false,
    hostNativeAgentProtocolEnabled: false,
    decisionLedgerRequired: false,
  };
  const handlers = Object.fromEntries(TOOLS.map((tool) => [tool.name, async () => ({ content: [{ type: "text", text: "ok" }] })]));
  const app = createApp(productionConfig, {
    handlers,
    fetchImpl: async () => { throw new Error("core_unreachable"); },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 503);
    assert.equal(health.readiness.ready, true);
    assert.equal(health.research_airlock.production_required, true);
    assert.equal(health.research_airlock.core_ready, false);
    assert.equal(health.render_ready, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production MCP health accepts explicit fail-closed Core shadow rollback", async () => {
  const productionConfig = {
    ...config,
    environment: "production",
    production: true,
    runtimeBuildCommit: "a".repeat(40),
    universalCoreUrl: "https://core.example.test",
    universalCoreKey: "tenant-core-secret",
    universalCoreKeys: {},
    databaseUrl: "",
    workContinuityAutoCaptureEnabled: false,
    hostNativeAgentProtocolEnabled: false,
    decisionLedgerRequired: false,
  };
  const handlers = Object.fromEntries(TOOLS.map((tool) => [tool.name, async () => ({ content: [{ type: "text", text: "ok" }] })]));
  const app = createApp(productionConfig, {
    handlers,
    fetchImpl: async () => new Response(JSON.stringify({
      research_airlock: { ready: false, operational_safe: true, mode: "shadow", state_backend: "unavailable" },
      build: { commit_sha: "a".repeat(40) },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 200);
    assert.equal(health.research_airlock.production_required, true);
    assert.equal(health.research_airlock.mode, "shadow");
    assert.equal(health.research_airlock.core_ready, true);
    assert.equal(health.render_ready, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production MCP readiness rejects PostgreSQL 15 and probe errors", async () => {
  const productionConfig = {
    ...config,
    environment: "production",
    production: true,
    runtimeBuildCommit: "a".repeat(40),
    universalCoreUrl: "https://core.example.test",
    universalCoreKey: "tenant-core-secret",
    universalCoreKeys: {},
    tenantGatewayKey: "g".repeat(32),
    ownerContextSigningSecret: "o".repeat(32),
    tenantContextSigningSecret: "t".repeat(32),
    dttAgentIdentitySigningSecret: "d".repeat(32),
    agentSignatureSecret: "a".repeat(32),
    databaseUrl: "postgres://must-not-be-returned",
    workContinuityAutoCaptureEnabled: true,
    hostNativeAgentProtocolEnabled: true,
    decisionLedgerRequired: true,
  };
  const handlers = Object.fromEntries(
    TOOLS.map((tool) => [tool.name, async () => ({
      content: [{ type: "text", text: "ok" }],
    })]),
  );
  for (const [serverVersion, expectedMajor] of [
    [150_014, 15],
    [new Error("postgresql://user:secret@example.test/private"), null],
  ]) {
    const app = createApp(productionConfig, {
      handlers,
      readiness: {
        continuityInitialized: true,
        decisionLedgerInitialized: true,
      },
      postgresMajorVersionProbe: postgresMajorProbe(serverVersion),
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/healthz`,
      );
      const health = await response.json();
      assert.equal(response.status, 503);
      assert.deepEqual(
        health.readiness.reasons,
        ["postgres_major_16_not_verified"],
      );
      assert.deepEqual(health.postgresql, {
        major: expectedMajor,
        verified: false,
      });
      assert.equal(JSON.stringify(health).includes("postgres://"), false);
      assert.equal(JSON.stringify(health).includes("postgresql://"), false);
      assert.equal(JSON.stringify(health).includes("server_version_num"), false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("host-native security prerequisites are production-and-feature scoped", () => {
  const productionBase = {
    environment: "production",
    runtimeBuildCommit: "b".repeat(40),
    codexKeys: ["codex-key"],
    universalCoreUrl: "https://core.example.test",
    universalCoreKey: "tenant-core-secret",
    databaseUrl: "postgres://configured",
    workContinuityAutoCaptureEnabled: false,
    decisionLedgerRequired: false,
  };
  const disabled = buildReadiness({
    ...productionBase,
    hostNativeAgentProtocolEnabled: false,
  });
  assert.equal(disabled.components.host_native_security.required, false);
  assert.equal(disabled.components.host_native_security.ready, true);
  assert.equal(
    disabled.reasons.some((reason) => reason.startsWith("host_native_")),
    false,
  );

  const missing = buildReadiness({
    ...productionBase,
    hostNativeAgentProtocolEnabled: true,
  }, {
    readiness: { continuityInitialized: true },
  });
  assert.deepEqual(
    missing.reasons.filter((reason) => reason.startsWith("host_native_")),
    [
      "host_native_tenant_gateway_not_configured",
      "host_native_owner_context_signing_not_configured",
      "host_native_tenant_context_signing_not_configured",
      "host_native_dtt_identity_signing_not_configured",
      "host_native_agent_signature_not_configured",
    ],
  );

  const complete = buildReadiness({
    ...productionBase,
    hostNativeAgentProtocolEnabled: true,
    tenantGatewayKey: "g".repeat(32),
    ownerContextSigningSecret: "o".repeat(32),
    tenantContextSigningSecret: "t".repeat(32),
    dttAgentIdentitySigningSecret: "d".repeat(32),
    agentSignatureSecret: "a".repeat(32),
  }, {
    readiness: {
      continuityInitialized: true,
      postgresMajorVersion: { major: 16, verified: true },
    },
  });
  assert.equal(complete.components.host_native_security.required, true);
  assert.equal(complete.components.host_native_security.ready, true);
  assert.equal(
    complete.components.host_native_security.tenant_context_signing_configured,
    true,
  );
  assert.equal(complete.ready, true);

  const reusableSecret = "r".repeat(32);
  for (const reusedConfig of [
    { universalCoreKey: reusableSecret },
    { universalCoreKeys: { tenant: reusableSecret } },
    { tenantGatewayKey: reusableSecret },
    { ownerContextSigningSecret: reusableSecret },
    { tenantContextSigningSecret: reusableSecret },
    { dttAgentIdentitySigningSecret: reusableSecret },
    { nyraDeepV2McpRequestSigningSecret: reusableSecret },
    { agentSignatureSecretReused: true },
  ]) {
    const reused = buildReadiness({
      ...productionBase,
      hostNativeAgentProtocolEnabled: true,
      universalCoreKey: "tenant-core-secret",
      tenantGatewayKey: "g".repeat(32),
      ownerContextSigningSecret: "o".repeat(32),
      tenantContextSigningSecret: "t".repeat(32),
      dttAgentIdentitySigningSecret: "d".repeat(32),
      agentSignatureSecret: reusableSecret,
      ...reusedConfig,
    }, {
      readiness: {
        continuityInitialized: true,
        postgresMajorVersion: { major: 16, verified: true },
      },
    });
    assert(reused.reasons.includes("host_native_agent_signature_reused"));
    assert.equal(
      reused.components.host_native_security.agent_signature_independent,
      false,
    );
    assert.equal(reused.ready, false);
  }

  const weakGateway = buildReadiness({
    ...productionBase,
    hostNativeAgentProtocolEnabled: true,
    tenantGatewayKey: "g".repeat(31),
    ownerContextSigningSecret: "o".repeat(32),
    tenantContextSigningSecret: "t".repeat(32),
    dttAgentIdentitySigningSecret: "d".repeat(32),
  }, {
    readiness: { continuityInitialized: true },
  });
  assert(weakGateway.reasons.includes("host_native_tenant_gateway_not_configured"));

  const development = buildReadiness({
    ...productionBase,
    environment: "development",
    hostNativeAgentProtocolEnabled: true,
  }, {
    readiness: { continuityInitialized: true },
  });
  assert.equal(development.components.host_native_security.required, false);
  assert.equal(
    development.reasons.some((reason) => reason.startsWith("host_native_")),
    false,
  );
});

test("production host-native readiness fails closed for missing, short, and reused AGENT_SIGNATURE_SECRET", () => {
  const independentBase = {
    environment: "production",
    runtimeBuildCommit: "b".repeat(40),
    codexKeys: ["codex-key"],
    universalCoreUrl: "https://core.example.test",
    universalCoreKey: "core-bearer",
    tenantGatewayKey: "g".repeat(32),
    ownerContextSigningSecret: "o".repeat(32),
    tenantContextSigningSecret: "t".repeat(32),
    dttAgentIdentitySigningSecret: "d".repeat(32),
    databaseUrl: "postgres://configured",
    workContinuityAutoCaptureEnabled: false,
    hostNativeAgentProtocolEnabled: true,
    decisionLedgerRequired: false,
  };
  const readinessOptions = {
    readiness: {
      continuityInitialized: true,
      postgresMajorVersion: { major: 16, verified: true },
    },
  };
  for (const [name, override, expectedReason] of [
    [
      "missing",
      {},
      "host_native_agent_signature_not_configured",
    ],
    [
      "short",
      { agentSignatureSecret: "too-short" },
      "host_native_agent_signature_not_configured",
    ],
    [
      "Core bearer reuse",
      {
        agentSignatureSecret: "r".repeat(32),
        universalCoreKey: "r".repeat(32),
      },
      "host_native_agent_signature_reused",
    ],
    [
      "host-native owner secret reuse",
      {
        agentSignatureSecret: "r".repeat(32),
        ownerContextSigningSecret: "r".repeat(32),
      },
      "host_native_agent_signature_reused",
    ],
  ]) {
    const result = buildReadiness(
      { ...independentBase, ...override },
      readinessOptions,
    );
    assert(
      result.reasons.includes(expectedReason),
      `${name} must report ${expectedReason}`,
    );
    assert.equal(
      result.components.host_native_security.agent_signature_independent,
      false,
      `${name} must not be independent`,
    );
    assert.equal(result.ready, false, `${name} must fail readiness`);
  }
});

test("readiness evaluator accepts a complete production configuration without Core reachability", () => {
  const readiness = buildReadiness({
    environment: "production",
    runtimeBuildCommit: "b".repeat(40),
    auth0Issuer: "https://tenant.auth0.com",
    codexKeys: [],
    universalCoreUrl: "https://core.example.test",
    universalCoreKeys: { tenant: "secret" },
    databaseUrl: "",
    workContinuityAutoCaptureEnabled: false,
    hostNativeAgentProtocolEnabled: false,
    decisionLedgerRequired: false,
  });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.components.universal_core.reachability_checked, false);
});

test("does not publish retired provider setup readiness", async () => serve(async (base) => {
  const health = await fetch(`${base}/healthz`).then((response) => response.json());
  assert.equal(health.owner_context_signing_configured, true);
  assert.equal(JSON.stringify(health).includes("test-owner-context-signing-secret"), false);
  assert.equal(Object.hasOwn(health, "universalCoreProviderSetupLinkKeys"), false);
  assert.equal(Object.hasOwn(health, "provider_setup_link_source_configured"), false);
}, { ownerContextSigningSecret: "test-owner-context-signing-secret" }));

test("health reports only the tenant membership binding count", async () => serve(async (base) => {
  const health = await fetch(`${base}/healthz`).then((response) => response.json());
  assert.equal(health.tenant_membership_bindings, 2);
  assert.equal(JSON.stringify(health).includes("oauth|member-a"), false);
  assert.equal(JSON.stringify(health).includes("codexai"), false);
}, {
  oauthTenantMemberships: {
    "oauth|member-a": { tenantId: "codexai", role: "member" },
    "oauth|member-b": { tenantId: "codexai", role: "reviewer" },
  },
}));

test("returns RFC 9728 challenge when bearer is absent", async () => serve(async (base) => {
  const response = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate"), /oauth-protected-resource/);
  const migrationResponse = await fetch(`${base}/mcp-v015`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
  assert.equal(migrationResponse.status, 401);
  assert.match(migrationResponse.headers.get("www-authenticate"), /oauth-protected-resource\/mcp-v015/);
}));

test("keeps Codex bearer compatibility and exposes MCP security schemes", async () => serve(async (base) => {
  const response = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-app-test-session" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert(body.result.tools.every((tool) => tool._meta.securitySchemes.some((scheme) => scheme.type === "oauth2")));
  assert(body.result.tools.every((tool) => tool.securitySchemes.every((scheme) => scheme.type === "oauth2")));
  const readTools = body.result.tools.filter((tool) => tool.annotations.readOnlyHint === true);
  const writeTools = body.result.tools.filter((tool) => tool.annotations.readOnlyHint === false);
  assert(readTools.length > 0);
  assert(writeTools.length > 0);
  assert(writeTools.every((tool) => tool.securitySchemes[0].scopes.includes("core:govern")));
  assert(writeTools.every((tool) =>
    tool._meta["skinharmony/ownerConfirmationRequired"] === false
    || tool.inputSchema.properties.owner_confirmed?.type === "boolean"));
  assert(writeTools.every((tool) =>
    tool._meta["skinharmony/ownerConfirmationRequired"] === false
    || tool.inputSchema.properties.confirmation_reference?.type === "string"));
  const preflight = body.result.tools.find((tool) => tool.name === "work_preflight");
  assert(preflight);
  assert(preflight.outputSchema?.properties?.core_runtime);
  assert.equal(preflight._meta["skinharmony/preflight_entrypoint"], true);
  assert.equal(preflight._meta["openai/outputTemplate"], undefined);
  assert.equal(body.result.tools.some((tool) => tool.name.startsWith("tenant_provider_openai_")), false);
  const genericTool = body.result.tools.find((tool) => tool.name === "memory_document_upsert");
  assert.equal(genericTool._meta["skinharmony/mandatory_first_tool"], "work_preflight");
  assert.equal(genericTool._meta["skinharmony/native_governance"], undefined);
  const gate = body.result.tools.find((tool) => tool.name === "core_gate_action");
  assert.deepEqual(gate.securitySchemes.find((scheme) => scheme.type === "oauth2").scopes, ["core:govern"]);
  assert.deepEqual(gate._meta.securitySchemes, gate.securitySchemes);
  for (const name of ["core_runtime_hierarchy_status", "core_runtime_hierarchy_evaluate"]) {
    assert(body.result.tools.find((tool) => tool.name === name)?.outputSchema, `missing ${name} output schema`);
  }
  const plan = body.result.tools.find((tool) => tool.name === "nyra_research_plan");
  const ingest = body.result.tools.find((tool) => tool.name === "nyra_research_ingest");
  assert.equal(plan.annotations.readOnlyHint, true);
  assert.deepEqual(plan.securitySchemes[0].scopes, ["core:read"]);
  assert.equal(ingest.annotations.readOnlyHint, false);
  assert.deepEqual(ingest.securitySchemes[0].scopes, ["core:govern"]);
  assert.equal(body.result.tools.some((tool) => tool.name === "nyra_research_execute"), false);
  for (const name of ["search", "fetch"]) {
    assert(body.result.tools.find((tool) => tool.name === name).outputSchema);
  }
  const search = body.result.tools.find((tool) => tool.name === "search");
  const fetchTool = body.result.tools.find((tool) => tool.name === "fetch");
  assert.deepEqual(Object.keys(search.inputSchema.properties), ["query"]);
  assert.deepEqual(Object.keys(fetchTool.inputSchema.properties), ["id"]);
  assert.deepEqual(search.inputSchema.required, ["query"]);
  assert.deepEqual(fetchTool.inputSchema.required, ["id"]);

  const suiteReadTools = ["suite_status", "suite_cockpit_360", "suite_branch_catalog", "suite_branch_read", "suite_runbook_catalog"];
  const suitePreviewTools = ["suite_decision_preview", "suite_runbook_preview"];
  for (const name of suiteReadTools) {
    const tool = body.result.tools.find((candidate) => candidate.name === name);
    assert(tool, `missing Suite tool ${name}`);
    assert.deepEqual(tool.securitySchemes[0].scopes, ["core:read"]);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
    assert(tool.outputSchema, `missing output schema for ${name}`);
    assert.match(tool._meta["openai/toolInvocation/invoking"], /Suite|runbook/i);
  }
  for (const name of suitePreviewTools) {
    const tool = body.result.tools.find((candidate) => candidate.name === name);
    assert(tool, `missing Suite preview tool ${name}`);
    assert.deepEqual(tool.securitySchemes[0].scopes, ["core:govern"]);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
    assert(tool.outputSchema, `missing output schema for ${name}`);
  }
}));

test("production compact mode exposes only the stable connector surface", async () => {
  const handlers = Object.fromEntries(TOOLS.map((tool) => [
    tool.name,
    async () => ({ content: [{ type: "text", text: "ok" }] }),
  ]));
  const app = createApp(config, { handlers, toolSurface: "compact" });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    for (const [index, path] of ["/mcp", "/mcp-v015"].entries()) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: "POST",
        headers: {
          authorization: "Bearer codex-key",
          "content-type": "application/json",
          "mcp-session-id": `compact-surface-test-${index}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 200 + index, method: "tools/list" }),
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(body.result.tools.map((tool) => tool.name), COMPACT_MCP_TOOL_NAMES);
      assert.equal(body.result.tools.some((tool) => tool.name.startsWith("tenant_provider_openai_")), false);
      assert.equal(body.result.tools.some((tool) => tool._meta?.["openai/outputTemplate"] === "ui://skinharmony/openai-provider-setup.html"), false);
      assert(Buffer.byteLength(JSON.stringify(body)) < 64 * 1024);

      const resources = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: "POST",
        headers: {
          authorization: "Bearer codex-key",
          "content-type": "application/json",
          "mcp-session-id": `compact-resources-test-${index}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 220 + index, method: "resources/list" }),
      }).then((result) => result.json());
      assert.deepEqual(resources.result.resources, []);

      const retiredTool = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: "POST",
        headers: {
          authorization: "Bearer codex-key",
          "content-type": "application/json",
          "mcp-session-id": `compact-retired-tool-test-${index}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 240 + index, method: "tools/call", params: {
          name: "tenant_provider_openai_setup_panel",
          arguments: {},
        } }),
      }).then((result) => result.json());
      assert.equal(retiredTool.error.code, -32602);
      assert.equal(retiredTool.error.message, "Unknown tool");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("publishes the governed host-browsing research sequence", async () => serve(async (base) => {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-app-test-session" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 40, method: "initialize" }),
  });
  const body = await response.json();
  assert.equal(response.headers.get("mcp-session-id"), "mcp-app-test-session");
  assert.match(body.result.instructions, /nyra_research_plan/);
  assert.match(body.result.instructions, /host ChatGPT or Codex web tool/);
  assert.match(body.result.instructions, /never include secrets/i);
  assert.match(body.result.instructions, /installed as a ChatGPT connector/);
  assert.match(body.result.instructions, /Never ask for or accept an API key in chat/);
  assert.match(body.result.instructions, /Nyra and Universal Core operate without an OpenAI API key/);
  assert.match(body.result.instructions, /Never call provider tools, open setup panels/);
  assert.match(body.result.instructions, /Old provider links are retired/);
  assert.doesNotMatch(body.result.instructions, /protected one-time Core page/);
  assert.doesNotMatch(body.result.instructions, /provider test/);
  assert.doesNotMatch(body.result.instructions, /manual_dry_run/);
  assert.doesNotMatch(body.result.instructions, /Researcher → Reviewer → Nyra Synthesizer/);
  assert.doesNotMatch(body.result.instructions, /bounded_execution_ready=true/);
  assert.match(body.result.instructions, /HOW TO BUILD AN AGENT/);
  assert.match(body.result.instructions, /AUTOMATIC/);
  assert.match(body.result.instructions, /NOT AUTOMATIC/);
  assert.match(body.result.instructions, /HOST-NATIVE MULTI-AGENT/);
  assert.match(body.result.instructions, /provider_execution=false/);
  assert.match(body.result.instructions, /provider_api_key_required=false/);
  assert.match(body.result.instructions, /cannot click, bypass or replace ChatGPT\/Codex approval/i);
  assert.match(body.result.instructions, /RESEARCH DISTILLATION/);
  assert.match(body.result.instructions, /tenant-isolated shadow workspace/);
  assert.match(body.result.instructions, /never invokes a server-side model provider/i);
}));

test("keeps native Core-governed controls outside generic shared-memory preflight", () => {
  for (const name of [
    "work_preflight",
    "orchestration_dtt_core_join",
  ]) assert.equal(requiresGenericWorkPreflight(name), false, `${name} must use its native gate`);

  for (const name of ["memory_document_upsert", "generic_agent_start", "nyra_research_ingest"]) {
    assert.equal(requiresGenericWorkPreflight(name), true, `${name} must remain fail-closed by generic preflight`);
  }
});

test("preserves the Gallery preflight envelope for Core action mediation", () => {
  const mediationTool = TOOLS.find((tool) => tool.name === "core_action_mediation_evaluate");
  assert.ok(mediationTool, "Core action mediation tool must be present");
  assert.deepEqual(
    mediationTool.inputSchema.properties.work_preflight,
    { type: "object" },
    "the dynamic capability router must not strip the mandatory preflight envelope",
  );
  assert.equal(mediationTool.inputSchema.required.includes("work_preflight"), true);
  assert.equal(
    requiresGenericWorkPreflight("core_capability_read", {
      capability_id: "core_action_mediation_evaluate",
    }),
    true,
  );
  assert.equal(
    requiresGenericWorkPreflight("core_capability_read", { capability_id: "core_health" }),
    false,
  );
});

test("injects mandatory server preflight into the compact action-mediation route", async () => {
  let received;
  const app = createApp(config, {
    toolSurface: "compact",
    handlers: {
      core_capability_read: async (args) => {
        received = args;
        return { structuredContent: { ok: true }, content: [] };
      },
    },
    beforeToolCall: async ({ toolName, args }) => requiresGenericWorkPreflight(toolName, args)
      ? {
          work_preflight: {
            schema_version: "skinharmony_work_preflight_v1",
            preflight_id: "preflight-server-issued",
            tenant_id: "owner-private",
            operational_surface: "tenant_work_gallery",
          },
        }
      : { preflight: null },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer codex-key",
        "content-type": "application/json",
        "mcp-session-id": "mcp-action-mediation-preflight",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: {
          name: "core_capability_read",
          arguments: {
            capability_id: "core_action_mediation_evaluate",
            catalog_revision: "a".repeat(64),
            arguments: { action: { type: "git.commit" } },
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(received.work_preflight.preflight_id, "preflight-server-issued");
    assert.equal(received.work_preflight.tenant_id, "owner-private");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("uses Core OAuth scopes for every collaboration capability", async () => serve(async (base) => {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-app-test-session" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 30, method: "tools/list" }),
  });
  const body = await response.json();
  const expected = {
    workspace_list: ["core:read"],
    workspace_create_folder: ["core:govern"],
    workspace_read_document: ["core:read"],
    workspace_write_document: ["core:govern"],
    task_list: ["core:read"],
    task_create: ["core:govern"],
    task_claim: ["core:govern"],
    task_update: ["core:govern"],
    agent_heartbeat: ["core:govern"],
    agent_list: ["core:read"],
    message_post: ["core:govern"],
    message_inbox: ["core:read"],
    message_acknowledge: ["core:govern"],
  };
  for (const [name, scopes] of Object.entries(expected)) {
    const tool = body.result.tools.find((candidate) => candidate.name === name);
    assert(tool, `missing collaboration tool ${name}`);
    assert.deepEqual(tool.securitySchemes[0].scopes, scopes);
  }
}));

test("exposes specialist intelligence tools with read and governed-write scopes", async () => serve(async (base) => {
  const response = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-app-test-session" }, body: JSON.stringify({ jsonrpc: "2.0", id: 40, method: "tools/list" }) });
  const body = await response.json();
  const reads = ["intelligence_workflow", "scenario_analysis", "hypothesis_rank", "event_probability", "counterfactual_analysis", "decision_select", "outcome_verify", "calibration_status"];
  for (const name of reads) {
    const tool = body.result.tools.find((candidate) => candidate.name === name);
    assert(tool, `missing intelligence tool ${name}`);
    assert.deepEqual(tool.securitySchemes[0].scopes, ["core:read"]);
    assert.equal(tool.annotations.readOnlyHint, true);
  }
  const record = body.result.tools.find((candidate) => candidate.name === "outcome_record");
  assert(record);
  assert.deepEqual(record.securitySchemes[0].scopes, ["core:govern"]);
  assert.equal(record.annotations.readOnlyHint, false);
}));

test("allows collaboration reads with core:read but blocks writes without core:govern", async () => {
  const readOnlyConfig = { ...config, codexScopes: ["core:read"] };
  const app = createApp(readOnlyConfig, {
    handlers: {
      workspace_list: async () => ({ content: [{ type: "text", text: "[]" }] }),
      workspace_write_document: async () => ({ content: [{ type: "text", text: "unexpected" }] }),
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-app-test-session" };
    const read = await fetch(`${base}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "workspace_list", arguments: {} } }),
    });
    assert.equal(read.status, 200);
    const write = await fetch(`${base}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 32, method: "tools/call", params: { name: "workspace_write_document", arguments: { path: "x.md", content: "x" } } }),
    });
    assert.equal(write.status, 403);
    assert.match(write.headers.get("www-authenticate"), /scope="core:govern"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("does not advertise collaboration tools without registered handlers", async () => {
  const app = createApp(config, { handlers: { core_health: async () => ({ content: [{ type: "text", text: "ok" }] }) } });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-app-test-session" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }) });
    const body = await response.json();
    assert.deepEqual(body.result.tools.map((tool) => tool.name), ["core_health"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rejects tenant, URL and key injection on every Suite tool before handler execution", async () => {
  const called = [];
  const valid = {
    suite_status: {},
    suite_cockpit_360: {},
    suite_branch_catalog: {},
    suite_branch_read: { branch_key: "pricing_margin" },
    suite_decision_preview: { question: "What should we do?" },
    suite_runbook_catalog: {},
    suite_runbook_preview: { runbook_id: "customer_report", node_id: "node-a" },
  };
  const handlers = Object.fromEntries(Object.keys(valid).map((name) => [name, async () => {
    called.push(name);
    return { structuredContent: { ok: true }, content: [] };
  }]));
  const app = createApp(config, { handlers });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, argumentsValue] of Object.entries(valid)) {
      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": `suite-injection-${name}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: name,
          method: "tools/call",
          params: {
            name,
            arguments: {
              ...argumentsValue,
              tenant_id: "tenant-b",
              url: "https://attacker.invalid",
              api_key: "attacker-key",
            },
          },
        }),
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.error?.code, -32602, name);
      const paths = body.error?.data?.violations?.map((item) => item.path) || [];
      assert(paths.includes("$.tenant_id"), `${name} accepted tenant_id`);
      assert(paths.includes("$.url"), `${name} accepted url`);
      assert(paths.includes("$.api_key"), `${name} accepted api_key`);
    }
    assert.deepEqual(called, []);
    const runbook = TOOLS.find((tool) => tool.name === "suite_runbook_preview");
    assert(runbook.inputSchema.required.includes("node_id"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("binds five concurrent MCP chats to distinct stable signatures", async () => {
  const app = createApp(config, {
    handlers: { core_health: async () => ({ structuredContent: { ok: true }, content: [] }) },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (session, agentId = "") => {
      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": session },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: session,
          method: "tools/call",
          params: { name: "core_health", arguments: agentId ? { agent_id: agentId, client_type: "codex" } : {} },
        }),
      });
      return { response, body: await response.json() };
    };

    const five = await Promise.all([
      "mcp-concurrent-one",
      "mcp-concurrent-two",
      "mcp-concurrent-three",
      "mcp-concurrent-four",
      "mcp-concurrent-five",
    ].map((session) => call(session)));
    assert(five.every(({ response }) => response.status === 200));
    const signatures = five.map(({ body }) => body.result.structuredContent.agent_presence.signature);
    assert.equal(new Set(signatures).size, 5);
    const replay = await call("mcp-concurrent-one");
    assert.equal(replay.response.status, 200);
    assert.equal(signatures[0], replay.body.result.structuredContent.agent_presence.signature);

    const named = await call("mcp-named-session", "codex-alpha");
    assert.equal(named.response.status, 200);
    const conflict = await call("mcp-named-session", "codex-beta");
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.error.message, "agent_presence_conflict");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("keeps one logical chat signature stable across rotated MCP transports", async () => {
  const app = createApp(config, {
    handlers: { core_health: async () => ({ structuredContent: { ok: true }, content: [] }) },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (transport, sessionId, agentId = "chatgpt-chat-one") => {
      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": transport },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: transport,
          method: "tools/call",
          params: {
            name: "core_health",
            arguments: { agent_id: agentId, client_type: "chatgpt", session_id: sessionId },
          },
        }),
      });
      return { response, body: await response.json() };
    };

    const first = await call("rotated-transport-one", "logical-chat-one");
    const replay = await call("rotated-transport-two", "logical-chat-one");
    const otherChat = await call("rotated-transport-three", "logical-chat-two");
    assert.equal(first.response.status, 200);
    assert.equal(replay.response.status, 200);
    assert.equal(otherChat.response.status, 200);
    const firstPresence = first.body.result.structuredContent.agent_presence;
    const replayPresence = replay.body.result.structuredContent.agent_presence;
    const otherPresence = otherChat.body.result.structuredContent.agent_presence;
    assert.equal(firstPresence.signature, replayPresence.signature);
    assert.equal(firstPresence.opaque_agent_id, replayPresence.opaque_agent_id);
    assert.equal(firstPresence.session_fingerprint, replayPresence.session_fingerprint);
    assert.notEqual(firstPresence.signature, otherPresence.signature);

    const identityConflict = await call("rotated-transport-four", "logical-chat-one", "chatgpt-chat-two");
    assert.equal(identityConflict.response.status, 409);
    assert.equal(identityConflict.body.error.message, "agent_presence_conflict");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("binds native reports to the child transport and exact native agent id", async () => {
  const reportTool = WORK_CONTINUITY_TOOLS.find(
    (tool) => tool.name === "work_continuity_native_report",
  );
  assert.ok(reportTool);
  const existingIndex = TOOLS.findIndex((tool) => tool.name === reportTool.name);
  if (existingIndex < 0) TOOLS.push(reportTool);
  const captured = [];
  const handlers = {
    work_continuity_native_report: async (args, identity) => {
      captured.push({ args, identity });
      return { content: [{ type: "text", text: "recorded" }] };
    },
  };
  const app = createApp(config, { handlers });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const transport = "native-child-transport-1";
  const call = async (nativeAgentId, id) => fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer codex-key",
      "content-type": "application/json",
      "mcp-session-id": transport,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "work_continuity_native_report",
        arguments: {
          work_id: "11111111-1111-4111-8111-111111111111",
          plan_id: "22222222-2222-4222-8222-222222222222",
          native_agent_id: nativeAgentId,
          host_task_id: "/root/native-child",
          assignment_capability: `hnac_${"A".repeat(43)}`,
          status: "completed",
          report: { summary: "Child completed the assigned task." },
        },
      },
    }),
  }).then((response) => response.json());
  try {
    const initialized = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer codex-key",
        "content-type": "application/json",
        "mcp-session-id": transport,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    assert.equal(initialized.status, 200);

    const accepted = await call("child-builder", 2);
    assert.equal(accepted.error, undefined);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].args.agent_id, "child-builder");
    assert.equal(captured[0].identity.agentPresence.agent_id, "child-builder");
    assert.equal(captured[0].identity.agentPresence.transport_bound, true);
    assert.match(
      captured[0].identity.agentPresence.host_transport_session_fingerprint,
      /^[a-f0-9]{16,64}$/,
    );

    const alias = await call("child-verifier-alias", 3);
    assert.equal(alias.error?.code, -32602);
    assert.equal(alias.error?.message, "agent_presence_conflict");
    assert.equal(captured.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (existingIndex < 0) {
      const index = TOOLS.indexOf(reportTool);
      if (index >= 0) TOOLS.splice(index, 1);
    }
  }
});

test("bootstraps authenticated stateless hosts without a transport session header", async () => {
  const app = createApp(config, {
    handlers: {
      work_preflight: async () => ({ structuredContent: { ok: true }, content: [] }),
      core_health: async () => ({ structuredContent: { ok: true }, content: [] }),
      nyra_runtime_context: async () => ({ structuredContent: { ok: true }, content: [] }),
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (name, argumentsValue = {}, sessionId = "") => {
      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer codex-key",
          "content-type": "application/json",
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: argumentsValue },
        }),
      });
      return { response, body: await response.json() };
    };

    const first = await call("work_preflight", { request: "Bootstrap this authenticated chat" });
    const replay = await call("core_health", { agent_id: "untrusted-agent-label", client_type: "other" });
    const blockedStateful = await call("nyra_runtime_context");
    const resumedStateful = await call("nyra_runtime_context", {}, first.response.headers.get("mcp-session-id"));
    assert.equal(first.response.status, 200);
    assert.equal(replay.response.status, 200);
    assert.match(first.response.headers.get("mcp-session-id"), /^mcp_bootstrap_[a-f0-9]{32}$/);
    assert.match(replay.response.headers.get("mcp-session-id"), /^mcp_bootstrap_[a-f0-9]{32}$/);
    assert.notEqual(first.response.headers.get("mcp-session-id"), replay.response.headers.get("mcp-session-id"));
    assert.equal(blockedStateful.response.status, 400);
    assert.equal(blockedStateful.body.error.message, "agent_presence_session_required");
    assert.equal(resumedStateful.response.status, 200);
    const firstPresence = first.body.result.structuredContent.agent_presence;
    const replayPresence = replay.body.result.structuredContent.agent_presence;
    const resumedPresence = resumedStateful.body.result.structuredContent.agent_presence;
    assert.notEqual(firstPresence.signature, replayPresence.signature);
    assert.equal(firstPresence.signature, resumedPresence.signature);
    assert.equal(firstPresence.client_type, "codex");
    assert.notEqual(replayPresence.agent_id, "untrusted-agent-label");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("journals successful and failed tool calls without changing client responses", async () => {
  const events = [];
  const app = createApp(config, {
    handlers: {
      core_health: async () => ({ content: [{ type: "text", text: "ok" }] }),
      core_gate_action: async () => { throw new Error("expected_failure"); },
    },
    afterToolCall: async (event) => events.push(event),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-app-test-session" };
    const success = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "core_health", arguments: {} } }) });
    assert.equal(success.status, 200);
    const successBody = await success.json();
    assert.match(successBody.result.structuredContent.agent_presence.signature, /^ags_[a-f0-9]{32}$/);
    const failure = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "core_gate_action", arguments: { action_label: "x", action_type: "y" } } }) });
    assert.equal(failure.status, 200);
    const failureBody = await failure.json();
    assert.equal(failureBody.result.isError, true);
    assert.equal(failureBody.result.structuredContent.error.code, "expected_failure");
    assert.equal(events.length, 2);
    assert.equal(events[0].toolName, "core_health");
    assert.equal(events[0].error, undefined);
    assert.equal(events[1].toolName, "core_gate_action");
    assert.match(events[1].error.message, /expected_failure/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("preserves ledger hook context when mandatory preflight fails", async () => {
  const events = [];
  const ledgerContext = { workId: "work-before-failure", traceId: "trace-before-failure" };
  const app = createApp(config, {
    handlers: {
      core_health: async () => ({ content: [{ type: "text", text: "must not run" }] }),
    },
    beforeToolCall: async () => {
      const error = new Error("preflight_failed_after_ledger_start");
      error.hookContext = { ledgerContext };
      throw error;
    },
    afterToolCall: async (event) => events.push(event),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-ledger-failure-session" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "core_health", arguments: {} } }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.isError, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].hookContext.ledgerContext.workId, "work-before-failure");
    assert.match(events[0].error.message, /preflight_failed_after_ledger_start/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("enforces and exposes automatic preflight before a work tool", async () => {
  const order = [];
  const app = createApp(config, {
    handlers: {
      search: async () => {
        order.push("tool");
        return { structuredContent: { documents: [] }, content: [{ type: "text", text: "[]" }] };
      },
    },
    beforeToolCall: async ({ toolName }) => {
      order.push("preflight");
      return {
        work_preflight: {
          preflight_id: "preflight-test",
          state: "ready_read_only",
          tool_routing: { preferred_route: { id: "tenant_shared_workspace" } },
          governance: { execution_allowed_by_preflight: true },
        },
      };
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-app-test-session" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "search", arguments: { query: "current work" } } }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(order, ["preflight", "tool"]);
    assert.equal(body.result.structuredContent.work_preflight.preflight_id, "preflight-test");
    assert.equal(body.result.structuredContent.work_preflight.state, "completed_read_only");
    assert.equal(JSON.parse(body.result.content.at(-1).text).mandatory_work_preflight.execution_allowed, true);
    assert.equal(body.result._meta["skinharmony/preflight_mandatory"], true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("records explicit owner confirmation and completes a write after the Core gate", async () => {
  let seenIdentity;
  const app = createApp({
    ...config,
    godModeEnabled: true,
    godModeTenantIds: ["owner-private"],
    godModeCodexEnabled: true,
    godModeEmergencyStop: false,
  }, {
    handlers: {
      workspace_write_document: async (_args, identity) => {
        seenIdentity = identity;
        return {
          structuredContent: {
            document: { path: "reports/fix.md", version: 1 },
            gate: {
              allowed: true,
              decision: "authorized_after_confirmation",
              mediation: "confirmed",
              owner_confirmation_required: true,
              confirmation_satisfied: true,
            },
          },
          content: [{ type: "text", text: "ok" }],
        };
      },
    },
    beforeToolCall: async () => ({
      work_preflight: {
        preflight_id: "preflight-write",
        state: "routed_owner_confirmed_waiting_for_core_verdict",
        tool_routing: { preferred_route: { id: "tenant_shared_workspace" } },
        governance: { execution_allowed_by_preflight: false, owner_confirmation_required: false, owner_confirmation_satisfied: true },
      },
    }),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-app-test-session" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: {
          name: "workspace_write_document",
          arguments: {
            path: "reports/fix.md",
            content: "verified",
            owner_confirmed: true,
            confirmation_reference: "user confirmed report write",
          },
        },
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(seenIdentity.ownerConfirmed, true);
    assert.equal(seenIdentity.confirmationReference, "user confirmed report write");
    assert.equal(body.result.structuredContent.work_preflight.state, "completed_after_core_gate");
    assert.equal(body.result.structuredContent.work_preflight.gate.allowed, true);
    assert.equal(body.result.structuredContent.work_preflight.governance.execution_authorized_by_core_gate, true);
    assert.equal(JSON.parse(body.result.content.at(-1).text).mandatory_work_preflight.execution_allowed, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("does not accept a raw confirmation flag from a non-owner MCP caller", async () => {
  let seenIdentity;
  const app = createApp(config, {
    handlers: {
      workspace_write_document: async (_args, identity) => {
        seenIdentity = identity;
        return { content: [{ type: "text", text: "ok" }] };
      },
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-app-test-session" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 23,
        method: "tools/call",
        params: {
          name: "workspace_write_document",
          arguments: {
            path: "reports/fix.md",
            content: "untrusted",
            owner_confirmed: true,
            confirmation_reference: "caller supplied confirmation",
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(seenIdentity.ownerConfirmed, false);
    assert.equal(seenIdentity.confirmationReference, "");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("fails closed before the work tool when mandatory preflight is unavailable", async () => {
  let toolCalled = false;
  const app = createApp(config, {
    handlers: {
      search: async () => {
        toolCalled = true;
        return { content: [{ type: "text", text: "should not run" }] };
      },
    },
    beforeToolCall: async () => { throw new Error("preflight_unavailable"); },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-app-test-session" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "search", arguments: { query: "work" } } }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.isError, true);
    assert.equal(body.result.structuredContent.error.code, "preflight_unavailable");
    assert.equal(toolCalled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("returns an explicit client error for a cloud-memory checksum mismatch", async () => {
  const app = createApp(config, {
    handlers: {
      memory_document_upsert: async () => { throw new Error("memory_checksum_mismatch"); },
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "checksum-test-session" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 22, method: "tools/call", params: {
        name: "memory_document_upsert",
        arguments: { source_path: "SHARED_MEMORY/report.md", title: "Report", text: "content" },
      } }),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error?.message, "memory_checksum_mismatch");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test("retires the OpenAI setup resource from the MCP surface", async () => serve(async (base) => {
  const resources = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-retired-openai-panel" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 41, method: "resources/list" }),
  }).then((response) => response.json());
  assert.deepEqual(resources.result.resources, []);

  const read = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-retired-openai-panel" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "resources/read", params: { uri: "ui://skinharmony/openai-provider-setup.html" } }),
  }).then((response) => response.json());
  assert.equal(read.error.code, -32602);
  assert.equal(read.error.message, "Unknown resource");
}));

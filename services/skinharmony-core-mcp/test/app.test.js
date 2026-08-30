import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGenericWorkCoreJoinHealth, buildIdentity, buildReadiness, createApp, filterToolsForClient, inferClientType, POLICY_REGISTRY_LIFECYCLE_TOOLS, requiresGenericWorkPreflight, resolveHostTransportPresence, resolveMcpLogicalSession, serverIssuedWorkPreflight, toolFailure, TOOLS } from "../src/app.js";
import { NYRA_DIALOGUE_WIDGET_MIME_TYPE, NYRA_DIALOGUE_WIDGET_URI } from "../src/nyra-operating-dialogue-widget.js";
import { createCollaborationHandlers } from "../src/collaboration-handlers.js";
import { COMPACT_MCP_TOOL_NAMES, createDynamicCapabilityHandlers, dynamicCapabilityCatalogSnapshot } from "../src/dynamic-capability-router.js";
import { HOST_APP_CAPABILITIES } from "../src/host-app-registry.js";
import { requireHostAppToolCapability } from "../src/host-app-authorization.js";
import { requireTenantWorkCapability } from "../src/tenant-work-authorization.js";
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
import { createGenericWorkCoreJoinVerifier } from "../src/work-continuity-v2-store.js";
import { NYRA_SERVER_CONNECTOR_HINT } from "../src/nyra-converse.js";
import { validateToolArguments } from "../src/schema-validation.js";

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

function signedTestJwt(privateKey, kid, payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `${header}.${body}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url");
  return `${input}.${signature}`;
}

test("binds an authenticated OAuth owner logical session as host transport presence", () => {
  const agentPresence = Object.freeze({
    agent_id: "oauth-owner-agent",
    session_fingerprint: "a".repeat(24),
    signature: `ags_${"b".repeat(32)}`,
  });
  const resolved = resolveHostTransportPresence({
    identity: {
      kind: "oauth",
      tenantId: "tenant-a",
      oauthOwnerBound: true,
      authenticatedTenantMembership: {
        authenticated: true,
        tenant_id: "tenant-a",
        role: "tenant_owner",
      },
    },
    toolName: "core_capability_invoke",
    capabilityId: "work_continuity_native_plan",
    declaredSessionId: "logical-owner-session",
    agentPresence,
    transportAgentPresence: null,
  });
  assert.equal(resolved.presence, agentPresence);
  assert.equal(resolved.binding_source, "oauth_declared");
});

test("does not promote caller-declared sessions without an authenticated OAuth owner binding", () => {
  const agentPresence = Object.freeze({
    agent_id: "untrusted-agent",
    session_fingerprint: "a".repeat(24),
    signature: `ags_${"b".repeat(32)}`,
  });
  for (const identity of [
    { kind: "codex", tenantId: "tenant-a" },
    {
      kind: "oauth",
      tenantId: "tenant-a",
      authenticatedTenantMembership: {
        authenticated: true,
        tenant_id: "tenant-a",
        role: "member",
      },
    },
    {
      kind: "oauth",
      tenantId: "tenant-a",
      oauthOwnerBound: true,
      authenticatedTenantMembership: {
        authenticated: true,
        tenant_id: "tenant-b",
        role: "tenant_owner",
      },
    },
  ]) {
    const resolved = resolveHostTransportPresence({
      identity,
      toolName: "core_capability_invoke",
      capabilityId: "work_continuity_native_plan",
      declaredSessionId: "caller-controlled-session",
      agentPresence,
      transportAgentPresence: null,
    });
    assert.equal(resolved.presence, null);
    assert.equal(resolved.binding_source, null);
  }
});

test("prefers the actual MCP transport binding over an OAuth logical session", () => {
  const logicalPresence = Object.freeze({ session_fingerprint: "a".repeat(24) });
  const transportPresence = Object.freeze({ session_fingerprint: "b".repeat(24) });
  const resolved = resolveHostTransportPresence({
    identity: { kind: "oauth", oauthOwnerBound: true },
    toolName: "work_continuity_native_report",
    declaredSessionId: "logical-owner-session",
    agentPresence: logicalPresence,
    transportAgentPresence: transportPresence,
  });
  assert.equal(resolved.presence, transportPresence);
  assert.equal(resolved.binding_source, "transport");
});

test("governed continuation rebinds only to its declared logical session", () => {
  const staleTransport = { session_id: "stale-mcp-session" };
  const continuation = resolveMcpLogicalSession({
    toolName: "nyra_continue",
    transportPresence: staleTransport,
    declaredSessionId: "attested-logical-session",
    transportSessionId: "current-mcp-session",
  });
  assert.deepEqual(continuation, {
    session_id: "attested-logical-session",
    continuation_rebind: true,
  });
  const nativePlan = resolveMcpLogicalSession({
    toolName: "work_continuity_native_plan",
    transportPresence: staleTransport,
    declaredSessionId: "attested-logical-session",
    transportSessionId: "current-mcp-session",
  });
  assert.deepEqual(nativePlan, {
    session_id: "stale-mcp-session",
    continuation_rebind: false,
  });
});

test("governed continuation restores the logical presence only after its handler succeeds", async () => {
  const observed = [];
  const app = createApp(config, {
    handlers: {
      core_health: async () => ({ structuredContent: { ok: true }, content: [] }),
      nyra_continue: async (args, identity) => {
        if (args.continuation_ref.includes("invalid")) {
          const error = new Error("nyra_continue_ref_invalid");
          error.code = "nyra_continue_ref_invalid";
          throw error;
        }
        observed.push(identity.agentPresence);
        return { structuredContent: { ok: true }, content: [] };
      },
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (transport, name, args = {}) => {
      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer codex-key",
          "content-type": "application/json",
          "mcp-session-id": transport,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `${transport}-${name}`,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      return { response, body: await response.json() };
    };
    const stale = await call("stale-mcp-transport", "core_health", {
      agent_id: "stale-transport-agent", client_type: "codex",
    });
    const logical = await call("attested-logical-session", "core_health", {
      agent_id: "attested-logical-agent", client_type: "codex",
    });
    assert.equal(stale.response.status, 200);
    assert.equal(logical.response.status, 200);

    const rejected = await call("stale-mcp-transport", "nyra_continue", {
      operation: "authorize_action",
      continuation_ref: `nyc1_invalid${"x".repeat(32)}`,
      idempotency_key: "continuation-invalid-rebind",
      session_id: "attested-logical-session",
    });
    assert.equal(rejected.response.status, 200);
    assert.equal(
      rejected.body.result.structuredContent.error.code,
      "nyra_continue_ref_invalid",
    );
    const unchanged = await call("stale-mcp-transport", "core_health");
    assert.equal(unchanged.response.status, 200);
    assert.equal(
      unchanged.body.result.structuredContent.agent_presence.agent_id,
      "stale-transport-agent",
    );

    const accepted = await call("stale-mcp-transport", "nyra_continue", {
      operation: "authorize_action",
      continuation_ref: `nyc1_${"x".repeat(40)}`,
      idempotency_key: "continuation-valid-rebind",
      session_id: "attested-logical-session",
    });
    assert.equal(accepted.response.status, 200);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].agent_id, "attested-logical-agent");
    const rebound = await call("stale-mcp-transport", "core_health");
    assert.equal(rebound.response.status, 200);
    assert.equal(
      rebound.body.result.structuredContent.agent_presence.agent_id,
      "attested-logical-agent",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Control Room status is sessionless and avoids an automatic Work preflight", async () => {
  let statusCalls = 0;
  const app = createApp({ ...config, nyraDialogueEnabled: false }, {
    handlers: {
      nyra_control_room_status: async () => {
        statusCalls += 1;
        return { structuredContent: { ok: true, control_room: { state: "READY" } }, content: [] };
      },
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "control-room-first-call", method: "tools/call",
        params: { name: "nyra_control_room_status", arguments: {} },
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(statusCalls, 1);
    assert.equal(body.result.structuredContent.control_room.state, "READY");
    assert.match(String(response.headers.get("mcp-session-id") || ""), /^mcp_bootstrap_/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Control Room status remains discoverable with Nyra Dialogue both OFF and ON", () => {
  const identity = {
    kind: "oauth",
    subject: "chatgpt-owner",
    tenantId: "tenant-a",
    authenticatedTenantMembership: {
      authenticated: true,
      tenant_id: "tenant-a",
      subject: "chatgpt-owner",
    },
    authenticatedHostPrincipal: {
      registered: true,
      auth_kind: "oauth",
      client_type: "chatgpt",
      interaction_mode: "nyra_conversational",
      capabilities: ["work.read"],
    },
  };
  for (const enabled of [false, true]) {
    const visible = filterToolsForClient(TOOLS, identity, enabled);
    assert(visible.some((tool) => tool.name === "nyra_control_room_status"), `dialogue=${enabled}`);
  }
  assert.equal(requiresGenericWorkPreflight("nyra_control_room_status"), false);
});

test("binds an OAuth owner logical session only for DTT-backed dynamic reads", () => {
  const identity = {
    kind: "oauth",
    tenantId: "tenant-a",
    oauthOwnerBound: true,
    authenticatedTenantMembership: {
      authenticated: true,
      tenant_id: "tenant-a",
      role: "tenant_owner",
    },
  };
  const agentPresence = { session_fingerprint: "a".repeat(24) };
  for (const capabilityId of [
    "entity_360_resolve",
    "entity_360_snapshot_verify",
    "entity_360_policy_read",
    "entity_360_metrics_read",
    "software_cognition_obligation_expand",
    "software_cognition_technology_profile",
    "nyra_precore_decision_verify",
  ]) {
    const resolved = resolveHostTransportPresence({
      identity,
      toolName: "core_capability_read",
      capabilityId,
      declaredSessionId: "logical-owner-session",
      agentPresence,
      transportAgentPresence: null,
    });
    assert.equal(resolved.presence, agentPresence, capabilityId);
    assert.equal(resolved.binding_source, "oauth_declared", capabilityId);
  }
});

test("does not promote an OAuth owner logical session outside the bounded logical-session allowlist", () => {
  const identity = {
    kind: "oauth",
    tenantId: "tenant-a",
    oauthOwnerBound: true,
    authenticatedTenantMembership: {
      authenticated: true,
      tenant_id: "tenant-a",
      role: "tenant_owner",
    },
  };
  for (const capabilityId of [
    "work_continuity_native_report",
    "entity_360_snapshot_assemble",
    "entity_360_shadow_compare",
    "software_cognition_graph_select",
    "software_cognition_graph_upsert",
    "software_cognition_precore_decide",
    "nyra_precore_decision_generate",
  ]) {
    const resolved = resolveHostTransportPresence({
      identity,
      toolName: "core_capability_read",
      capabilityId,
      declaredSessionId: "logical-owner-session",
      agentPresence: { session_fingerprint: "a".repeat(24) },
      transportAgentPresence: null,
    });
    assert.equal(resolved.presence, null, capabilityId);
    assert.equal(resolved.binding_source, null, capabilityId);
  }

  const impossibleInvoke = resolveHostTransportPresence({
    identity,
    toolName: "core_capability_invoke",
    capabilityId: "entity_360_policy_read",
    declaredSessionId: "logical-owner-session",
    agentPresence: { session_fingerprint: "a".repeat(24) },
    transportAgentPresence: null,
  });
  assert.equal(impossibleInvoke.presence, null);
  assert.equal(impossibleInvoke.binding_source, null);
});

function canonicalHealthDigest(value) {
  const normalize = (item) => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return Object.is(item, -0) ? 0 : item;
    if (Array.isArray(item)) return item.map(normalize);
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

function coreHealthResponse(payload, {
  status = 200,
  url = "https://core.example.test/healthz",
  redirected = false,
  contentType = "application/json",
  contentLength,
  body,
} = {}) {
  const headers = { "content-type": contentType };
  if (contentLength !== undefined) headers["content-length"] = String(contentLength);
  const response = new Response(body ?? JSON.stringify(payload), {
    status,
    headers,
  });
  Object.defineProperty(response, "url", { value: url });
  Object.defineProperty(response, "redirected", { value: redirected });
  return response;
}

function guardedCausalBootstrapPayload(overrides = {}) {
  const payload = {
    ok: false,
    service: "universal-core-service",
    mode: "production",
    render_ready: false,
    readiness: false,
    readiness_verified: false,
    liveness_degraded: true,
    health_contract_version: CORE_HEALTH_CONTRACT_VERSION,
    health_contract_digest: CORE_HEALTH_CONTRACT_DIGEST,
    build: { build_id: "b".repeat(40), commit_sha: "b".repeat(40), commit_verifiable: true },
    research_airlock: {
      ready: false,
      operational_safe: false,
      accepting_new_work: false,
      policy_version: "nyra_core_research_airlock_policy_v1",
      mode: "enforced",
      state_backend: "postgresql",
      restart_durable: true,
      distributed: true,
    },
    causal_continuity: { ok: false, state: "initializing", production_required: true },
    ...overrides,
  };
  const guardPayload = {
    schema_version: "research_airlock_bootstrap_guard_v1",
    purpose: "causal_initialization_liveness",
    policy_version: payload.research_airlock.policy_version,
    static_guard_ready: true,
    mode: payload.research_airlock.mode,
    store_backend: payload.research_airlock.state_backend,
    restart_durable: payload.research_airlock.restart_durable,
    distributed: payload.research_airlock.distributed,
    accepting_new_work: false,
    runtime_verified: false,
    build_commit_sha: payload.build.commit_sha,
    health_contract_digest: payload.health_contract_digest,
    causal_state: payload.causal_continuity.state,
    causal_production_required: payload.causal_continuity.production_required,
    liveness_window_ms: 30 * 60 * 1_000,
    initialization_elapsed_ms: 1_000,
    readiness_verified: false,
  };
  payload.research_airlock.bootstrap_guard = {
    ...guardPayload,
    guard_digest: canonicalHealthDigest(guardPayload),
  };
  return payload;
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
      const delegated = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "skinharmony_nyra_core.core_health", arguments: { environment: "staging" } } }) }).then((response) => response.json());
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

test("orders generic Work subject authorization before every Work side effect", () => {
  const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const hookStart = serverSource.indexOf("beforeToolCall: async");
  const hookEnd = serverSource.indexOf("afterToolCall: async", hookStart);
  const hook = serverSource.slice(hookStart, hookEnd);
  const authorization = hook.indexOf("requireTenantWorkRequestAuthorization(identity");
  assert.ok(authorization >= 0);
  for (const effect of [
    "registerAuthenticatedPresence(identity)",
    "decisionLedger.startWork(identity",
    "coreHandlers.work_preflight({",
    "ensureContinuity(",
  ]) {
    assert.ok(hook.indexOf(effect) > authorization, `${effect} must follow the subject gate`);
  }
});

test("exact Work resume establishes only the bounded Nyra read binding after ACL authorization", () => {
  const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const continuityStart = serverSource.indexOf("async function ensureContinuity");
  const continuityEnd = serverSource.indexOf("async function refreshNyraDialogueAfterMaterialChange", continuityStart);
  const continuity = serverSource.slice(continuityStart, continuityEnd);
  const exactResume = continuity.indexOf("if (resumeExisting && continuity?.work_id)");
  const binding = continuity.indexOf("read_binding: await ensureNyraReadBinding({", exactResume);
  const acl = continuity.indexOf("authorizeRead: requireCanonicalWorkRead", binding);

  assert.ok(continuityStart >= 0);
  assert.ok(continuityEnd > continuityStart);
  assert.ok(exactResume >= 0);
  assert.ok(binding > exactResume);
  assert.ok(acl > binding);
  assert.doesNotMatch(
    continuity.slice(exactResume, continuity.indexOf("const controlContext", exactResume)),
    /owner_confirmed|authority_scope|execution_authorized:\s*true|external_action_authorized:\s*true/,
  );
});

test("continuity checkpoint relies on exactly one server-owned Universal Core gate", () => {
  const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const checkpointStart = serverSource.indexOf("work_continuity_checkpoint: async");
  const checkpointEnd = serverSource.indexOf("work_continuity_read: async", checkpointStart);
  assert.ok(checkpointStart >= 0);
  assert.ok(checkpointEnd > checkpointStart);
  const checkpointHandler = serverSource.slice(checkpointStart, checkpointEnd);

  assert.match(checkpointHandler, /await requireOwnerGovernance\(identity, "work\.continuity\.checkpoint", args\.work_id\)/);
  assert.doesNotMatch(checkpointHandler, /coreHandlers\.core_gate_action/);
  assert.match(checkpointHandler, /dedicated_core_gate\s*=\s*\{\s*authorized: true,\s*authority: "universal_core"/);
});

test("bounded DTT Core gates derive their target from the router-normalized arguments", () => {
  const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(
    serverSource,
    /gateAction: \(\{ tool, args, identity, catalogRevision, idempotencyKey, workPreflight \}\) =>/,
  );
  assert.match(serverSource, /target: tenantWorkCoordinationTarget\(tool\.name, args\)/);
});

test("dynamic Atlas writes refresh Nyra's durable dialogue from the inner capability and preflight", () => {
  const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const refreshStart = serverSource.indexOf("async function refreshNyraDialogueAfterMaterialChange");
  const refreshEnd = serverSource.indexOf("const app = createApp", refreshStart);
  const refresh = serverSource.slice(refreshStart, refreshEnd);
  assert.match(refresh, /if \(event\.error\) return null/);
  assert.match(refresh, /dynamicInvocationTarget\(event\.toolName, event\.args, event\.identity\)/);
  assert.match(refresh, /event\.preflight\?\.preflight\?\.work_preflight/);
  assert.match(refresh, /materializeNyraControlContext\(event\.identity, continuity, materialToolName, \{ force: true \}\)/);
});

test("canonical Work bootstrap separates persisted evidence from a replay attempt receipt", () => {
  const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(serverSource, /core_authorization_receipt: result\.core_authorization_receipt/);
  assert.match(serverSource, /core_authorization_attempt_receipt: coreAuthorizationAttemptReceipt/);
  assert.match(serverSource, /bindWorkBootstrapRequestToAuthenticatedHost\(\{ request: args, identity \}\)/);
  assert.match(serverSource, /core_authorization_receipt: coreDecision\.core_authorization_receipt/);
  const createStart = serverSource.indexOf("async function createCanonicalWorkGoverned");
  const createEnd = serverSource.indexOf("async function readNyraDirectiveContext", createStart);
  const createHandler = serverSource.slice(createStart, createEnd);
  assert.ok(createHandler.indexOf("readCreatedWorkByBootstrapRequest") >= 0);
  assert.ok(createHandler.indexOf("readCreatedWorkByBootstrapRequest") <
    createHandler.indexOf("const coreDecision = await requireOwnerGovernance"));
  assert.match(createHandler, /attachNyraWorkOrchestration\(identity, persisted, "work_created_replay"\)/);
  assert.match(createHandler, /attachNyraWorkOrchestration\(identity, result, "work_created"\)/);
  assert.match(createHandler, /route: "durable_work_bootstrap_readback"/);
  assert.match(createHandler, /authorized: false/);
});

test("legacy Work reads and auto-resume intersect canonical V2 visibility", () => {
  const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(serverSource, /work_continuity_read: async[\s\S]*?readLegacyWorkAuthorized\(identity, args\)/);
  assert.match(serverSource, /work_continuity_intent_read: async[\s\S]*?readLegacyIntentAuthorized\(identity, args\)/);
  assert.match(serverSource, /work_continuity_work_catalog: async[\s\S]*?listLegacyWorksAuthorized\(identity, args\)/);
  assert.match(serverSource, /tenant_work_gallery_list: async[\s\S]*?galleryLegacyWorksAuthorized\(identity, args\)/);
  assert.match(serverSource, /workContinuityV2Store\.listWorks\(aclIdentity, \{ view: "operational", project_id \}\)/);
  assert.match(serverSource, /authorizedResumeWorkIds,/);
  assert.match(serverSource, /allowAuthorizedSessionRebind: Boolean\(args\.work_id\)/);
  assert.match(serverSource, /const governedLegacyReadRuntime = workContinuityRuntime \? Object\.freeze\(\{[\s\S]*?listWorks: listLegacyWorksAuthorized,[\s\S]*?readIntent: readLegacyIntentAuthorized/);
  assert.match(serverSource, /resolveContinuityProjectBinding\([\s\S]*?governedLegacyReadRuntime,[\s\S]*?preferPersistedWorkProject: true/);
  const hookStart = serverSource.indexOf("beforeToolCall: async");
  const hookEnd = serverSource.indexOf("afterToolCall: async", hookStart);
  const hook = serverSource.slice(hookStart, hookEnd);
  assert.ok(hook.indexOf("await requireCanonicalWorkRead(identity, authorizationTarget.args.work_id)") <
    hook.indexOf("registerAuthenticatedPresence(identity)"));
  for (const handler of [
    "tenant_work_gallery_join", "tenant_work_gallery_heartbeat", "tenant_work_branch_open",
    "tenant_work_lease_acquire", "tenant_work_lease_renew", "tenant_work_lease_release",
    "tenant_work_message_post", "tenant_work_inbox",
  ]) {
    const start = serverSource.indexOf(`${handler}: async`);
    const end = serverSource.indexOf("},\n    ", start);
    assert.match(serverSource.slice(start, end), /await requireCanonicalWorkRead\(identity, args\.work_id\)/,
      `${handler} must authorize the exact canonical Work before any legacy mutation/read`);
  }
});

test("local Software Atlas reads are wired to the canonical Work ACL", () => {
  const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const binding = serverSource.indexOf("const softwareCognitionHandlers = createSoftwareCognitionHandlers");
  assert.ok(binding >= 0);
  const end = serverSource.indexOf("});", binding);
  assert.match(serverSource.slice(binding, end), /authorizeAtlasRead:\s*requireCanonicalWorkRead/);
  assert.match(serverSource, /work_continuity_atlas_select: async[\s\S]*?selectLegacyAtlasAuthorized\(identity, args\)/);
  assert.match(serverSource, /selectLegacyAtlasAuthorized[\s\S]*?authorized_work_ids: authorizedWorkIds/);
});

test("causal transport uses a tenant-bound identity token instead of inventing a Work", () => {
  const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const start = serverSource.indexOf("const causalContinuityHandlers = createCausalContinuityHandlers");
  const end = serverSource.indexOf("const softwareCognitionHandlers", start);
  const wiring = serverSource.slice(start, end);
  assert.match(wiring, /issueCausalAgentIdentityContext/);
  assert.doesNotMatch(wiring, /issueDttAgentContext/);
  assert.doesNotMatch(wiring, /work_id/);
});

test("native planning repairs only the server-derived canonical legacy bridge before reading its Intent", () => {
  const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const helperStart = serverSource.indexOf("async function ensureNativePlanLegacyBridge");
  const helperEnd = serverSource.indexOf("async function listLegacyWorksAuthorized", helperStart);
  const helper = serverSource.slice(helperStart, helperEnd);
  assert.match(helper, /requireTenantWorkCapability\(identity, "operate"\)/);
  assert.match(helper, /ensureLegacyBridge\(withTenantWorkAcl\(identity\), \{ work_id: workId \}\)/);
  const planStart = serverSource.indexOf("async function createNativeContinuityPlan");
  const planEnd = serverSource.indexOf("async function bindNativeContinuityChild", planStart);
  const planHandler = serverSource.slice(planStart, planEnd);
  assert.ok(planHandler.indexOf("await ensureNativePlanLegacyBridge(identity, nativeArgs.work_id)") >= 0);
  assert.ok(planHandler.indexOf("await ensureNativePlanLegacyBridge(identity, nativeArgs.work_id)") <
    planHandler.indexOf("await readLegacyIntentAuthorized(identity"));
  const autopilotStart = serverSource.indexOf("async function reconcileNyraAutopilot");
  const autopilotEnd = serverSource.indexOf("function withTenantWorkAcl", autopilotStart);
  const autopilot = serverSource.slice(autopilotStart, autopilotEnd);
  assert.ok(autopilot.indexOf("await ensureNativePlanLegacyBridge(identity, work.work_id)") <
    autopilot.indexOf("await readLegacyIntentAuthorized(identity, { work_id: work.work_id })"));
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

test("preserves a bounded machine-readable host capability failure", () => {
  for (const capability of Object.values(HOST_APP_CAPABILITIES)) {
    const result = toolFailure(Object.assign(
      new Error(`host_app_capability_required:${capability}`),
      {
        code: "host_app_capability_required",
        required_capability: capability,
        secret: "must-not-leak",
      },
    ));
    assert.equal(result.structuredContent.error.code, "host_app_capability_required");
    assert.equal(result.structuredContent.error.required_capability, capability);
    assert.equal(result.structuredContent.error.status, 403);
    assert.equal(result.structuredContent.error.retryable, false);
    assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
  }

  for (const unknown of [
    "private.customer42.token123",
    `work.${"x".repeat(200)}`,
    "work.operate:secret",
  ]) {
    const unbounded = toolFailure(Object.assign(
      new Error(`host_app_capability_required:${unknown}`),
      { code: "host_app_capability_required", required_capability: unknown },
    ));
    assert.equal(unbounded.structuredContent.error.code, "host_app_capability_required");
    assert.equal(unbounded.structuredContent.error.status, 403);
    assert.equal(Object.hasOwn(unbounded.structuredContent.error, "required_capability"), false);
    assert.equal(JSON.stringify(unbounded).includes(unknown), false);
  }

  let producerError;
  try {
    requireHostAppToolCapability({
      identity: { authenticatedHostPrincipal: { registered: true, capabilities: [] } },
      toolName: "work_continuity_v2_read",
      tools: [{ name: "work_continuity_v2_read", annotations: { readOnlyHint: true } }],
    });
  } catch (error) {
    producerError = error;
  }
  const integrated = toolFailure(producerError);
  assert.equal(integrated.structuredContent.error.code, "host_app_capability_required");
  assert.equal(integrated.structuredContent.error.required_capability, "work.read");
  assert.equal(integrated.structuredContent.error.status, 403);
});

test("filters direct tools and dynamic wrapper modes by the registered app upper bound", () => {
  const tool = (name, readOnlyHint) => ({ name, annotations: { readOnlyHint } });
  const available = [
    tool("core_health", true),
    tool("work_continuity_v2_read", true),
    tool("tenant_work_task_record", false),
    tool("memory_context", true),
    tool("memory_checkpoint", false),
    tool("agent_heartbeat", false),
    tool("nyra_policy_registry_activate", false),
    tool("core_capability_read", true),
    tool("core_capability_invoke", false),
  ];
  const identityFor = (capabilities) => ({
    kind: "codex",
    authenticatedHostPrincipal: {
      registered: true,
      host_kind: "codex_native",
      client_type: "codex",
      interaction_mode: "native_tooling",
      capabilities,
    },
  });
  const namesFor = (capabilities) => filterToolsForClient(
    available,
    identityFor(capabilities),
  ).map(({ name }) => name);

  assert.deepEqual(namesFor(["work.read"]), [
    "core_health",
    "work_continuity_v2_read",
    "core_capability_read",
    "core_capability_invoke",
  ]);
  assert.deepEqual(namesFor(["work.read", "work.operate"]), [
    "core_health",
    "work_continuity_v2_read",
    "tenant_work_task_record",
    "core_capability_read",
    "core_capability_invoke",
  ]);
  assert.deepEqual(namesFor(["core.read", "core.operate"]), [
    "core_health",
    "memory_context",
    "memory_checkpoint",
    "core_capability_read",
    "core_capability_invoke",
  ]);
  assert.deepEqual(namesFor(["work.coordinate"]), [
    "core_health",
    "agent_heartbeat",
    "core_capability_invoke",
  ]);
  assert.deepEqual(namesFor(["core.admin"]), [
    "core_health",
    "nyra_policy_registry_activate",
    "core_capability_invoke",
  ]);
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
  assert.equal(health.version, "0.17.0-nyra-conversational-orchestration");
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
  assert(resource.scopes_supported.includes("offline_access"));
  assert.equal(config.supportedScopes.includes("offline_access"), false);
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

test("does not advertise Generic Work Core Join until explicitly enabled", async () => {
  const genericTool = WORK_CONTINUITY_TOOLS.find(
    (tool) => tool.name === "work_continuity_generic_core_join",
  );
  const existingIndex = TOOLS.findIndex((tool) => tool.name === genericTool.name);
  if (existingIndex < 0) TOOLS.push(genericTool);
  const handlers = {
    work_continuity_generic_core_join: async () => ({
      structuredContent: { ok: true },
      content: [{ type: "text", text: "ok" }],
    }),
  };
  const disabledApp = createApp({ ...config, genericWorkCoreJoinEnabled: false }, { handlers });
  const incompleteApp = createApp({ ...config, genericWorkCoreJoinEnabled: true }, { handlers });
  const enabledApp = createApp({
    ...config,
    genericWorkCoreJoinEnabled: true,
    genericWorkCoreJoinConfigurationValid: true,
  }, { handlers });
  if (existingIndex < 0) TOOLS.splice(TOOLS.indexOf(genericTool), 1);

  for (const [app, expectedVisible] of [
    [disabledApp, false],
    [incompleteApp, false],
    [enabledApp, true],
  ]) {
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer codex-key", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      const body = await response.json();
      assert.equal(
        body.result.tools.some((tool) => tool.name === genericTool.name),
        expectedVisible,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("Generic Join health pins upstream key identity and gates Render only when required", async () => {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const verifier = createGenericWorkCoreJoinVerifier({
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    keyId: "core-key-20260810",
  });
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
    genericWorkCoreJoinEnabled: true,
    genericWorkCoreJoinConfigurationValid: true,
  };
  const scenarios = [
    { required: false, fingerprint: "f".repeat(64), status: 200, renderReady: true,
      joinReady: false, reason: "generic_work_core_join_public_key_fingerprint_mismatch" },
    { required: false, fingerprint: verifier.public_key_fingerprint, upstreamRequired: true,
      status: 200, renderReady: true, joinReady: false,
      reason: "generic_work_core_join_upstream_not_ready" },
    { required: false, fingerprint: verifier.public_key_fingerprint, omitUpstreamRequired: true,
      status: 200, renderReady: true, joinReady: false,
      reason: "generic_work_core_join_upstream_not_ready" },
    { required: true, fingerprint: "f".repeat(64), status: 503, renderReady: false,
      joinReady: false, reason: "generic_work_core_join_public_key_fingerprint_mismatch" },
    { required: true, fingerprint: verifier.public_key_fingerprint, upstreamEnabled: false,
      upstreamConfigurationValid: false, upstreamAlgorithm: "RSA", status: 503, renderReady: false,
      joinReady: false, reason: "generic_work_core_join_disabled" },
    { required: true, fingerprint: verifier.public_key_fingerprint, upstreamRequired: false,
      status: 503, renderReady: false, joinReady: false,
      reason: "generic_work_core_join_upstream_not_ready" },
    { required: true, fingerprint: verifier.public_key_fingerprint, status: 200, renderReady: true,
      joinReady: true, reason: null },
  ];
  for (const scenario of scenarios) {
    const app = createApp({
      ...productionConfig,
      genericWorkCoreJoinRequired: scenario.required,
    }, {
      handlers: {},
      readiness: { genericWorkCoreJoinStoreInitialized: true },
      genericWorkCoreJoin: { storeConfigured: true, verifier },
      fetchImpl: async () => {
        const genericWorkCoreJoin = {
          enabled: scenario.upstreamEnabled ?? true,
          configuration_valid: scenario.upstreamConfigurationValid ?? true,
          algorithm: scenario.upstreamAlgorithm ?? "Ed25519",
          ready: true,
          backend: scenario.upstreamBackend ?? "postgresql",
          restart_durable: scenario.upstreamRestartDurable ?? true,
          distributed: scenario.upstreamDistributed ?? true,
          signer_state: scenario.upstreamSignerState ?? "ready",
          state: scenario.upstreamState ?? "ready",
          key_id: verifier.key_id,
          public_key_fingerprint: scenario.fingerprint,
        };
        if (scenario.omitUpstreamRequired !== true) {
          genericWorkCoreJoin.required = scenario.upstreamRequired ?? scenario.required;
        }
        return new Response(JSON.stringify({
          ok: true,
          render_ready: true,
          liveness_degraded: false,
          build: { commit_sha: "b".repeat(40), commit_verifiable: true },
          research_airlock: { ready: true, mode: "enforced", state_backend: "postgresql" },
          generic_work_core_join: genericWorkCoreJoin,
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
      const health = await response.json();
      assert.equal(response.status, scenario.status);
      assert.equal(health.render_ready, scenario.renderReady);
      assert.equal(health.generic_work_core_join.enabled, scenario.joinReady);
      assert.equal(health.generic_work_core_join.required, scenario.required);
      assert.equal(health.generic_work_core_join.ready, scenario.joinReady);
      assert.equal(health.generic_work_core_join.reason, scenario.reason);
      assert.equal(health.generic_work_core_join.key_id, verifier.key_id);
      assert.equal(
        health.generic_work_core_join.public_key_fingerprint,
        verifier.public_key_fingerprint,
      );
      assert.equal(
        JSON.stringify(health).includes(publicKey.export({ type: "spki", format: "pem" })),
        false,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("Generic Join health mirrors fail-closed Universal Core readiness", () => {
  const verifier = {
    algorithm: "Ed25519",
    metadata: {
      key_id: "core-key-20260810",
      public_key_fingerprint: "b".repeat(64),
    },
  };
  const upstream = (join) => ({ responseOk: true, payload: { generic_work_core_join: {
    enabled: true,
    configuration_valid: true,
    algorithm: "Ed25519",
    required: false,
    ready: true,
    backend: "postgresql",
    restart_durable: true,
    distributed: true,
    signer_state: "ready",
    state: "ready",
    key_id: verifier.metadata.key_id,
    public_key_fingerprint: verifier.metadata.public_key_fingerprint,
    ...join,
  } } });
  const input = {
    config: {
      genericWorkCoreJoinEnabled: true,
      genericWorkCoreJoinRequired: false,
      genericWorkCoreJoinConfigurationValid: true,
    },
    options: {
      genericWorkCoreJoin: { storeConfigured: true, verifier },
      readiness: { genericWorkCoreJoinStoreInitialized: true },
    },
  };
  const cases = [
    ["signer absent", { signer_state: "unconfigured", state: "signer_unavailable", reason: "generic_work_core_join_signer_unconfigured" }, "generic_work_core_join_signer_unconfigured"],
    ["ledger absent", { backend: "unavailable", state: "durability_or_signing_unavailable", reason: "generic_work_core_join_postgres_unavailable" }, "generic_work_core_join_postgres_unavailable"],
    ["migration absent", { ready: false, state: "failed", reason: "generic_work_core_join_migration_unavailable" }, "generic_work_core_join_migration_unavailable"],
    ["restart durability absent", { restart_durable: false, state: "durability_or_signing_unavailable", reason: "generic_work_core_join_durable_store_unavailable" }, "generic_work_core_join_durable_store_unavailable"],
    ["distributed store absent", { distributed: false, state: "durability_or_signing_unavailable", reason: "generic_work_core_join_distributed_store_unavailable" }, "generic_work_core_join_distributed_store_unavailable"],
  ];
  for (const [name, join, reason] of cases) {
    const health = buildGenericWorkCoreJoinHealth(input.config, input.options, upstream(join));
    assert.equal(health.enabled, false, name);
    assert.equal(health.ready, false, name);
    assert.equal(health.reason, reason, name);
  }
  const ready = buildGenericWorkCoreJoinHealth(input.config, input.options, upstream({}));
  assert.equal(ready.enabled, true);
  assert.equal(ready.ready, true);
  assert.equal(ready.state, "ready");
  assert.equal(ready.backend, "postgresql");
  assert.equal(ready.restart_durable, true);
  assert.equal(ready.distributed, true);
  assert.equal(ready.signer_state, "ready");
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
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      render_ready: false,
      liveness_degraded: true,
      research_airlock: { ready: true, mode: "enforced", state_backend: "postgresql" },
      causal_continuity: { ok: false, state: "initializing", production_required: true },
      build: { commit_sha: "b".repeat(40), commit_verifiable: true },
    }), { status: 200, headers: { "content-type": "application/json" } }),
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
      ok: true,
      render_ready: true,
      research_airlock: { ready: true, mode: "enforced", state_backend: "postgresql" },
      build: { commit_sha: "a".repeat(40), commit_verifiable: true },
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

test("production MCP health allows explicit Core causal bootstrap while readyz stays strict", async () => {
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
  let coreReady = false;
  const app = createApp(productionConfig, {
    handlers,
    fetchImpl: async () => coreHealthResponse(coreReady ? {
      ok: true,
      render_ready: true,
      liveness_degraded: false,
      research_airlock: { ready: true, mode: "enforced", state_backend: "postgresql" },
      causal_continuity: { ok: true, state: "ready", production_required: true },
      build: { commit_sha: "b".repeat(40), commit_verifiable: true },
    } : guardedCausalBootstrapPayload()),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const healthResponse = await fetch(`${base}/healthz`);
    const health = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.equal(health.ok, false);
    assert.equal(health.render_ready, false);
    assert.equal(health.research_airlock.core_ready, false);
    assert.equal(health.research_airlock.upstream_bootstrap_initializing, true);
    assert.equal(health.research_airlock.bootstrap_guard_verified, true);

    const pendingReadyResponse = await fetch(`${base}/readyz`);
    const pendingReady = await pendingReadyResponse.json();
    assert.equal(pendingReadyResponse.status, 503);
    assert.equal(pendingReady.ok, false);
    assert.equal(pendingReady.render_ready, false);

    coreReady = true;
    const readyResponse = await fetch(`${base}/readyz`);
    const ready = await readyResponse.json();
    assert.equal(readyResponse.status, 200);
    assert.equal(ready.ok, true);
    assert.equal(ready.render_ready, true);
    assert.equal(ready.research_airlock.core_ready, true);
    assert.equal(ready.research_airlock.upstream_bootstrap_initializing, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production MCP health rejects unauthorized, invalid, and non-bootstrap Core responses", async () => {
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
  let responseCase = "unauthorized";
  let fetchCount = 0;
  const degradedPayload = {
    ok: false,
    render_ready: false,
    liveness_degraded: true,
    research_airlock: { ready: true, mode: "enforced", state_backend: "postgresql" },
    causal_continuity: { ok: false, state: "initializing", production_required: true },
    build: { commit_sha: "b".repeat(40), commit_verifiable: true },
  };
  const app = createApp(productionConfig, {
    handlers,
    policyRegistryHealthCacheTtlMs: 50,
    fetchImpl: async () => {
      fetchCount += 1;
      if (responseCase === "unauthorized") {
        return new Response(JSON.stringify(degradedPayload), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      }
      if (responseCase === "invalid") {
        return new Response("{", { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        ...degradedPayload,
        liveness_degraded: false,
        causal_continuity: { ok: false, state: "initialization_failed", production_required: true },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [caseIndex, currentCase] of ["unauthorized", "invalid", "failed"].entries()) {
      if (caseIndex > 0) await new Promise((resolve) => setTimeout(resolve, 75));
      responseCase = currentCase;
      const response = await fetch(`${base}/healthz`);
      const health = await response.json();
      assert.equal(response.status, 503, currentCase);
      assert.equal(health.ok, false, currentCase);
      assert.equal(health.render_ready, false, currentCase);
      assert.equal(health.research_airlock.core_ready, false, currentCase);
    }
    assert.equal(fetchCount, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production MCP rejects tampered, redirected, cross-bound, or readiness-claiming bootstrap guards", async () => {
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
  let currentResponse;
  const app = createApp(productionConfig, {
    handlers,
    fetchImpl: async () => currentResponse,
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cases = [];
    {
      const payload = guardedCausalBootstrapPayload();
      payload.research_airlock.bootstrap_guard.guard_digest = "0".repeat(64);
      cases.push(["digest_tamper", coreHealthResponse(payload)]);
    }
    {
      const payload = guardedCausalBootstrapPayload();
      payload.research_airlock.mode = "shadow";
      cases.push(["cross_binding", coreHealthResponse(payload)]);
    }
    {
      const payload = guardedCausalBootstrapPayload();
      payload.research_airlock.ready = true;
      cases.push(["readiness_claim", coreHealthResponse(payload)]);
    }
    {
      const payload = guardedCausalBootstrapPayload();
      delete payload.readiness_verified;
      cases.push(["readiness_verified_omitted", coreHealthResponse(payload)]);
    }
    {
      const payload = guardedCausalBootstrapPayload();
      payload.readiness_verified = true;
      cases.push(["readiness_verified_tampered", coreHealthResponse(payload)]);
    }
    {
      const payload = guardedCausalBootstrapPayload();
      const guard = payload.research_airlock.bootstrap_guard;
      guard.readiness_verified = true;
      const { guard_digest: _digest, ...unsigned } = guard;
      guard.guard_digest = canonicalHealthDigest(unsigned);
      cases.push(["readiness_verified_cross_binding", coreHealthResponse(payload)]);
    }
    {
      const payload = guardedCausalBootstrapPayload();
      payload.research_airlock.runtime_ready = true;
      cases.push(["runtime_claim", coreHealthResponse(payload)]);
    }
    {
      const payload = guardedCausalBootstrapPayload();
      payload.research_airlock.bootstrap_guard.extra = true;
      cases.push(["schema_extension", coreHealthResponse(payload)]);
    }
    {
      const payload = guardedCausalBootstrapPayload();
      payload.build.build_id = "c".repeat(40);
      cases.push(["build_identity_mismatch", coreHealthResponse(payload)]);
    }
    {
      const payload = guardedCausalBootstrapPayload();
      payload.causal_continuity.error = "initialization_failed";
      cases.push(["initialization_error", coreHealthResponse(payload)]);
    }
    {
      const payload = guardedCausalBootstrapPayload();
      payload.research_airlock.bootstrap_guard.initialization_elapsed_ms = 31 * 60 * 1_000;
      cases.push(["elapsed_window_tamper", coreHealthResponse(payload)]);
    }
    cases.push(["redirect", coreHealthResponse(guardedCausalBootstrapPayload(), { redirected: true })]);
    cases.push(["cross_origin", coreHealthResponse(guardedCausalBootstrapPayload(), { url: "https://evil.example.test/healthz" })]);
    cases.push(["http_origin", coreHealthResponse(guardedCausalBootstrapPayload(), { url: "http://core.example.test/healthz" })]);
    cases.push(["jsonp_media_type", coreHealthResponse(guardedCausalBootstrapPayload(), { contentType: "application/jsonp" })]);
    cases.push(["plus_json_not_allowlisted", coreHealthResponse(guardedCausalBootstrapPayload(), { contentType: "application/problem+json" })]);
    cases.push(["declared_oversize", coreHealthResponse(guardedCausalBootstrapPayload(), { contentLength: 70_000 })]);
    cases.push(["stream_oversize_without_length", coreHealthResponse(null, {
      body: `${" ".repeat(70_000)}${JSON.stringify(guardedCausalBootstrapPayload())}`,
    })]);
    cases.push(["stream_oversize_forged_length", coreHealthResponse(null, {
      body: `${" ".repeat(70_000)}${JSON.stringify(guardedCausalBootstrapPayload())}`,
      contentLength: 1,
    })]);

    for (const [name, response] of cases) {
      currentResponse = response;
      const healthResponse = await fetch(`${base}/healthz`);
      const health = await healthResponse.json();
      assert.equal(healthResponse.status, 503, name);
      assert.equal(health.ok, false, name);
      assert.equal(health.render_ready, false, name);
      assert.equal(health.research_airlock.upstream_bootstrap_initializing, false, name);
      assert.equal(health.research_airlock.bootstrap_guard_verified, false, name);
    }
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
      ok: true,
      render_ready: true,
      research_airlock: { ready: false, operational_safe: true, mode: "shadow", state_backend: "unavailable" },
      build: { commit_sha: "a".repeat(40), commit_verifiable: true },
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
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        render_ready: true,
        research_airlock: { ready: false, operational_safe: true, mode: "shadow", state_backend: "unavailable" },
        build: { commit_sha: "a".repeat(40), commit_verifiable: true },
      }), { status: 200, headers: { "content-type": "application/json" } }),
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
    readiness: {
      continuityInitialized: true,
      nyraContinuationStoreInitialized: true,
    },
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

test("governed multi-host readiness requires registry, independent signing, and host protocol", () => {
  const base = {
    environment: "development",
    runtimeBuildCommit: "b".repeat(40),
    codexKeys: ["codex-key"],
    universalCoreUrl: "https://core.example.test",
    universalCoreKey: "tenant-core-secret",
    nyraGovernedContinueEnabled: true,
  };
  const missing = buildReadiness(base);
  assert.equal(missing.components.governed_multi_host.required, true);
  assert.equal(missing.components.governed_multi_host.ready, false);
  assert(missing.reasons.includes("governed_multi_host_not_configured"));
  assert(missing.reasons.includes("governed_multi_host_protocol_disabled"));

  const ready = buildReadiness({
    ...base,
    hostNativeAgentProtocolEnabled: true,
    databaseUrl: "postgres://configured",
    hostAppRegistry: {
      configured: true,
      revision: "a".repeat(64),
      apps: [{ app_id: "chatgpt_prod" }, { app_id: "future_ai" }],
    },
    nyraGovernedContinueSigningSecret: "n".repeat(32),
    nyraGovernedContinueConfigurationValid: true,
  }, {
    readiness: {
      continuityInitialized: true,
      nyraContinuationStoreInitialized: true,
    },
  });
  assert.equal(ready.components.governed_multi_host.ready, true);
  assert.equal(ready.components.governed_multi_host.registered_app_count, 2);
  assert.equal(ready.components.governed_multi_host.registry_revision, "a".repeat(64));
  assert.equal(ready.components.nyra_continuation_store.ready, true);
  assert.equal(ready.ready, true);

  const storeUnavailable = buildReadiness({
    ...base,
    hostNativeAgentProtocolEnabled: true,
    databaseUrl: "postgres://configured",
    hostAppRegistry: {
      configured: true,
      revision: "a".repeat(64),
      apps: [{ app_id: "chatgpt_prod" }],
    },
    nyraGovernedContinueSigningSecret: "n".repeat(32),
    nyraGovernedContinueConfigurationValid: true,
  }, {
    readiness: {
      continuityInitialized: true,
      nyraContinuationStoreInitializationFailed: true,
    },
  });
  assert.equal(storeUnavailable.components.nyra_continuation_store.ready, false);
  assert.equal(storeUnavailable.components.nyra_continuation_store.initialization_failed, true);
  assert(storeUnavailable.reasons.includes("nyra_continuation_store_not_initialized"));
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

test("liveness responds without consulting unreachable governed dependencies", async () => {
  let upstreamHealthCalls = 0;
  await serve(async (base) => {
    const response = await fetch(`${base}/livez`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: "skinharmony-core-mcp",
      liveness: "process_running",
    });
    assert.equal(upstreamHealthCalls, 0);
  }, {}, {
    fetchImpl: async () => {
      upstreamHealthCalls += 1;
      throw new Error("governed_upstream_unavailable");
    },
  });
});

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
  const hierarchyEvaluate = body.result.tools.find((tool) => tool.name === "core_runtime_hierarchy_evaluate");
  assert(preflight);
  assert(hierarchyEvaluate);
  assert(preflight.outputSchema?.properties?.core_runtime);
  for (const tool of [preflight, hierarchyEvaluate]) {
    assert.equal(tool.inputSchema.properties.core_input.properties.evidence_state.properties.high_impact.type, "boolean");
    assert.match(tool.inputSchema.properties.core_input.properties.evidence_state.properties.high_impact.description, /cannot authorize execution/);
  }
  assert.equal(preflight._meta["skinharmony/preflight_entrypoint"], true);
  assert.equal(preflight._meta["openai/outputTemplate"], undefined);
  assert.equal(body.result.tools.some((tool) => tool.name.startsWith("tenant_provider_openai_")), false);
  const genericTool = body.result.tools.find((tool) => tool.name === "memory_document_upsert");
  assert.equal(genericTool._meta["skinharmony/mandatory_first_tool"], undefined);
  assert.equal(genericTool._meta["skinharmony/automatic_preflight"], true);
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
      assert.deepEqual(body.result.tools.map((tool) => tool.name),
        COMPACT_MCP_TOOL_NAMES.filter((name) =>
          TOOLS.some((tool) => tool.name === name) && !POLICY_REGISTRY_LIFECYCLE_TOOLS.has(name)));
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
      assert.deepEqual(resources.result.resources, [{
        uri: NYRA_DIALOGUE_WIDGET_URI,
        name: "Nyra operating dialogue",
        description: "Authoritative Nyra Work response rendered from bounded server output.",
        mimeType: NYRA_DIALOGUE_WIDGET_MIME_TYPE,
      }]);

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

test("accepts only exact connector namespace aliases for visible registered tools", async () => {
  const called = [];
  const handlers = Object.fromEntries(COMPACT_MCP_TOOL_NAMES.map((name) => [
    name,
    async () => {
      called.push(name);
      return { structuredContent: { ok: true, tool: name }, content: [] };
    },
  ]));
  const app = createApp(config, { handlers, toolSurface: "compact" });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = {
      authorization: "Bearer codex-key",
      "content-type": "application/json",
      "mcp-session-id": "connector-namespace-alias-test",
    };
    const aliasCalls = [
      ["core_health", {}],
      ["nyra_converse", { message: "Nyra, riprendi il Work" }],
      ["core_capability_catalog", {}],
    ];
    for (const [index, [name, args]] of aliasCalls.entries()) {
      const body = await fetch(`${base}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 300 + index,
          method: "tools/call",
          params: { name: `skinharmony_nyra_core.${name}`, arguments: args },
        }),
      }).then((response) => response.json());
      assert.equal(body.result.structuredContent.tool, name);
    }
    const legacyPreflight = await fetch(`${base}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 319,
        method: "tools/call",
        params: {
          name: "skinharmony_nyra_core.work_preflight",
          arguments: { request: "Nyra, riprendi il Work" },
        },
      }),
    }).then((response) => response.json());
    assert.equal(legacyPreflight.result.structuredContent.tool, "nyra_converse");

    for (const [index, name] of [
      "skinharmony_nyra_core.not_registered",
      "skinharmony_nyra_core_evil.core_health",
      "skinharmony_nyra_core.skinharmony_nyra_core.core_health",
    ].entries()) {
      const body = await fetch(`${base}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 320 + index,
          method: "tools/call",
          params: { name, arguments: {} },
        }),
      }).then((response) => response.json());
      assert.equal(body.error.code, -32602);
      assert.equal(body.error.message, "Unknown tool");
    }
    assert.deepEqual(called, ["core_health", "nyra_converse", "core_capability_catalog", "nyra_converse"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("translates a stale tenant-bound OAuth ChatGPT preflight to Nyra without publishing it", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "chatgpt-stale-read-key";
  const now = Math.floor(Date.now() / 1_000);
  const token = signedTestJwt(privateKey, jwk.kid, {
    iss: "https://tenant.auth0.com/",
    aud: "https://core",
    sub: "chatgpt-stale-read-owner",
    iat: now,
    auth_time: now,
    exp: now + 60,
    scope: "core:read core:govern",
    "https://skinharmony.it/tenant_id": "tenant-a",
  });
  const received = [];
  const app = createApp({
    ...config,
    tenantClaim: "https://skinharmony.it/tenant_id",
    oauthOwnerTenantBindings: { "chatgpt-stale-read-owner": "tenant-a" },
  }, {
    jwksCache: { get: async () => jwk },
    toolSurface: "compact",
    handlers: {
      nyra_converse: async (args) => {
        received.push(["nyra_converse", args]);
        return { structuredContent: { ok: true, tool: "nyra_converse" }, content: [] };
      },
      work_preflight: async (args) => {
        received.push(["work_preflight", args]);
        return { structuredContent: { ok: true, tool: "work_preflight" }, content: [] };
      },
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-session-id": "chatgpt-stale-work-preflight",
    };
    const listed = await fetch(`${base}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 339, method: "tools/list" }),
    }).then((response) => response.json());
    assert.equal(listed.result.tools.some((tool) => tool.name === "work_preflight"), false);

    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 340,
        method: "tools/call",
        params: {
          name: "work_preflight",
          arguments: {
            request: "Nyra, riprendi il Work",
            work_id: "11111111-1111-4111-8111-111111111111",
            project_id: "skinharmony-ai-backend",
          },
        },
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.error, undefined, JSON.stringify(body));
    assert.equal(body.result.structuredContent.tool, "nyra_converse");
    assert.deepEqual(received.map(([name]) => name), ["nyra_converse"]);
    assert.deepEqual({
      message: received[0][1].message,
      work_id: received[0][1].work_id,
      project_id: received[0][1].project_id,
    }, {
      message: "Nyra, riprendi il Work",
      work_id: "11111111-1111-4111-8111-111111111111",
      project_id: "skinharmony-ai-backend",
    });
    assert.equal(Object.hasOwn(received[0][1], "tenant_id"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("translates stale tenant-bound ChatGPT Core reads to Nyra without reopening Core handlers", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "chatgpt-stale-self-model-key";
  const now = Math.floor(Date.now() / 1_000);
  const token = signedTestJwt(privateKey, jwk.kid, {
    iss: "https://tenant.auth0.com/",
    aud: "https://core",
    sub: "chatgpt-stale-self-model-owner",
    iat: now,
    auth_time: now,
    exp: now + 60,
    scope: "core:read core:govern",
    "https://skinharmony.it/tenant_id": "tenant-a",
  });
  const received = [];
  const app = createApp({
    ...config,
    environmentRoutingRequired: true,
    tenantClaim: "https://skinharmony.it/tenant_id",
    oauthOwnerTenantBindings: { "chatgpt-stale-self-model-owner": "tenant-a" },
  }, {
    jwksCache: { get: async () => jwk },
    toolSurface: "compact",
    handlers: {
      nyra_converse: async (args) => {
        received.push(["nyra_converse", args]);
        return { structuredContent: { ok: true, tool: "nyra_converse" }, content: [] };
      },
      core_capability_catalog: async (args) => {
        received.push(["catalog", args]);
        return { structuredContent: { ok: true, tool: "core_capability_catalog", capability_id: "nyra_self_model" }, content: [] };
      },
      core_capability_read: async (args) => {
        received.push(["read", args]);
        return { structuredContent: { ok: true, tool: "core_capability_read", self_model: { persistent: true } }, content: [] };
      },
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-session-id": "chatgpt-stale-self-model-read",
    };
    const catalog = await fetch(`${base}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 350,
        method: "tools/call",
        params: { name: "core_capability_catalog", arguments: {
          group: "self_model",
          include_schema: true,
          limit: 100,
          environment: "production",
        } },
      }),
    }).then((response) => response.json());
    assert.equal(catalog.result?.structuredContent?.tool, "nyra_converse", JSON.stringify(catalog));

    const read = await fetch(`${base}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 351,
        method: "tools/call",
        params: { name: "core_capability_read", arguments: {
          capability_id: "work_preflight",
          catalog_revision: "a".repeat(64),
          arguments: {},
          environment: "production",
        } },
      }),
    }).then((response) => response.json());
    assert.equal(read.result?.structuredContent?.tool, "nyra_converse", JSON.stringify(read));

    const coreReadDenied = await fetch(`${base}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 352,
        method: "tools/call", params: { name: "core_capability_read", arguments: {
          capability_id: "memory_context",
          catalog_revision: "b".repeat(64),
          arguments: { tenant_id: "tenant-b" },
          environment: "production",
        } },
      }),
    }).then((response) => response.json());
    assert.equal(coreReadDenied.result?.structuredContent?.tool, "nyra_converse", JSON.stringify(coreReadDenied));

    const mutation = await fetch(`${base}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 353,
        method: "tools/call", params: { name: "core_capability_invoke", arguments: {
          capability_id: "host_native_action_reserve",
          catalog_revision: "b".repeat(64),
          arguments: { tenant_id: "tenant-b" },
          idempotency_key: "chatgpt-mutation-denied",
        } },
      }),
    }).then((response) => response.json());
    assert.equal(mutation.error?.code, -32602, JSON.stringify(mutation));

    assert.deepEqual(received.map(([name]) => name), [
      "nyra_converse", "nyra_converse", "nyra_converse",
    ]);
    assert.match(received[0][1].message, /self_model/);
    assert.match(received[1][1].message, /work_preflight/);
    assert.match(received[2][1].message, /memory_context/);
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
  assert.match(body.result.instructions, /authenticated host's web tool/);
  assert.match(body.result.instructions, /never include secrets/i);
  assert.match(body.result.instructions, /governed MCP connector/);
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
  assert.match(body.result.instructions, /cannot click, bypass or replace the registered host's approval/i);
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

test("requires exact Work preflight for DTT-backed dynamic reads only", () => {
  for (const capability_id of [
    "entity_360_resolve",
    "entity_360_snapshot_latest",
    "entity_360_snapshot_read",
    "entity_360_snapshot_verify",
    "entity_360_policy_read",
    "entity_360_metrics_read",
    "software_cognition_obligation_expand",
    "software_cognition_plan_record",
    "software_cognition_challenge_read",
    "software_cognition_technology_profile",
    "software_cognition_precore_read",
    "nyra_precore_decision_read",
    "nyra_precore_decision_list",
    "nyra_precore_decision_verify",
  ]) {
    assert.equal(
      requiresGenericWorkPreflight("core_capability_read", { capability_id }),
      true,
      capability_id,
    );
  }
  for (const capability_id of [
    "entity_360_snapshot_assemble",
    "entity_360_shadow_compare",
    "software_cognition_graph_select",
    "software_cognition_graph_upsert",
    "core_health",
  ]) {
    assert.equal(
      requiresGenericWorkPreflight("core_capability_read", { capability_id }),
      false,
      capability_id,
    );
  }
});

test("keeps the logical session on the dynamic-read wrapper, not target arguments", () => {
  const dynamicRead = TOOLS.find((tool) => tool.name === "core_capability_read");
  assert.ok(dynamicRead);
  assert.deepEqual(dynamicRead.inputSchema.properties.session_id, {
    type: "string",
    pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$",
    description: "Opaque random id unique to the current conversation or agent run; reuse it for every tool call in that run.",
  });
  assert.equal(dynamicRead.inputSchema.properties.arguments.additionalProperties, true);
  assert.deepEqual(validateToolArguments(dynamicRead.inputSchema, {
    capability_id: "entity_360_policy_read",
    catalog_revision: "a".repeat(64),
    arguments: { work_id: "91e82640-9edc-5424-a3e8-eb7853b0d8dd" },
    session_id: "oauth-logical-session",
  }), []);
});

test("server resolves inner arguments for dynamic reads before exact Work preflight", () => {
  const serverSource = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const targetStart = serverSource.indexOf("function dynamicInvocationTarget");
  const targetEnd = serverSource.indexOf("function requireTenantWorkIdentity", targetStart);
  const target = serverSource.slice(targetStart, targetEnd);
  assert.ok(targetStart >= 0);
  assert.ok(targetEnd > targetStart);
  assert.match(target, /toolName !== "core_capability_read" && toolName !== "core_capability_invoke"/);
  assert.match(target, /const targetArgs = args\?\.arguments/);
  assert.match(target, /toolName: capabilityId \|\| toolName/);
});

test("requires generic preflight for dynamic invoke except signed presence and Work bootstrap", () => {
  assert.equal(
    requiresGenericWorkPreflight("core_capability_invoke", { capability_id: "workspace_write_document" }),
    true,
  );
  for (const capability_id of [
    "tenant_work_open_review",
    "work_continuity_v2_create",
    "tenant_work_queue_create_v3",
  ]) {
    assert.equal(
      requiresGenericWorkPreflight("core_capability_invoke", { capability_id }),
      false,
      capability_id,
    );
  }
  assert.equal(
    requiresGenericWorkPreflight("core_capability_invoke", {
      capability_id: "agent_heartbeat",
      arguments: { agent_id: "bootstrap", client_type: "codex" },
    }),
    false,
  );
});

test("dispatches only exact Work bootstrap invokes without injecting generic preflight", async () => {
  const received = [];
  const preflightDecisions = [];
  const app = createApp(config, {
    toolSurface: "compact",
    handlers: {
      core_capability_invoke: async (args) => {
        received.push(args);
        return { structuredContent: { ok: true }, content: [] };
      },
    },
    beforeToolCall: async ({ toolName, args }) => {
      const required = requiresGenericWorkPreflight(toolName, args);
      preflightDecisions.push({ capability_id: args.capability_id, required });
      if (required) throw new Error("unexpected_generic_preflight");
      return { preflight: null };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const capabilityIds = [
      "tenant_work_open_review",
      "work_continuity_v2_create",
      "tenant_work_queue_create_v3",
    ];
    for (const [index, capability_id] of capabilityIds.entries()) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer codex-key",
          "content-type": "application/json",
          "mcp-session-id": `mcp-work-bootstrap-${index}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `bootstrap-${index}`,
          method: "tools/call",
          params: {
            name: "core_capability_invoke",
            arguments: {
              capability_id,
              catalog_revision: "a".repeat(64),
              idempotency_key: `bootstrap-${index}`,
              arguments: {},
            },
          },
        }),
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.result.structuredContent.ok, true, JSON.stringify(body));
    }
    assert.deepEqual(preflightDecisions, capabilityIds.map((capability_id) => ({
      capability_id,
      required: false,
    })));
    assert.equal(received.length, capabilityIds.length);
    assert.equal(received.every((args) => args.work_preflight === undefined), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("injects a server-issued preflight into dynamic invoke", async () => {
  let received;
  const app = createApp(config, {
    toolSurface: "compact",
    handlers: {
      core_capability_invoke: async (args) => {
        received = args;
        return { structuredContent: { ok: true }, content: [] };
      },
    },
    beforeToolCall: async ({ toolName, args }) => requiresGenericWorkPreflight(toolName, args)
      ? {
          work_preflight: {
            schema_version: "skinharmony_work_preflight_v1",
            preflight_id: "preflight-server-issued-dynamic-invoke",
            tenant_id: "owner-private",
            mandatory: true,
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
        "mcp-session-id": "mcp-dynamic-invoke-preflight",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 32,
        method: "tools/call",
        params: {
          name: "core_capability_invoke",
          arguments: {
            capability_id: "workspace_write_document",
            catalog_revision: "a".repeat(64),
            idempotency_key: "dynamic-invoke-preflight",
            arguments: { path: "audit.md", content: "bounded" },
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(received.work_preflight.preflight_id, "preflight-server-issued-dynamic-invoke");
    assert.equal(received.work_preflight.tenant_id, "owner-private");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("fails closed when dynamic invoke receives no server-issued preflight", async () => {
  let handlerCalled = false;
  const app = createApp(config, {
    toolSurface: "compact",
    handlers: {
      core_capability_invoke: async () => {
        handlerCalled = true;
        return { structuredContent: { ok: true }, content: [] };
      },
    },
    beforeToolCall: async () => ({ preflight: null }),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer codex-key",
        "content-type": "application/json",
        "mcp-session-id": "mcp-dynamic-invoke-no-preflight",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 33,
        method: "tools/call",
        params: {
          name: "core_capability_invoke",
          arguments: {
            capability_id: "workspace_write_document",
            catalog_revision: "a".repeat(64),
            idempotency_key: "dynamic-invoke-no-preflight",
            arguments: { path: "audit.md", content: "must not execute" },
          },
        },
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.result.isError, true);
    assert.equal(body.result.structuredContent.error.code, "work_preflight_binding_invalid");
    assert.equal(handlerCalled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rejects malformed or cross-tenant dynamic preflight envelopes", () => {
  const identity = { tenantId: "owner-private" };
  const valid = {
    schema_version: "skinharmony_work_preflight_v1",
    preflight_id: "preflight-negative-case",
    tenant_id: "owner-private",
    mandatory: true,
    operational_surface: "tenant_work_gallery",
  };
  for (const invalid of [
    null,
    { ...valid, mandatory: false },
    { ...valid, tenant_id: "other-tenant" },
    { ...valid, preflight_id: "" },
    { ...valid, operational_surface: "caller_supplied" },
  ]) {
    assert.throws(
      () => serverIssuedWorkPreflight({ work_preflight: invalid }, identity),
      /work_preflight_binding_invalid/,
    );
  }
  assert.deepEqual(serverIssuedWorkPreflight({ work_preflight: valid }, identity), valid);
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

test("keeps ChatGPT on Nyra's front door while Codex retains native coordinator planning", async () => {
  const planTool = WORK_CONTINUITY_TOOLS.find(
    (tool) => tool.name === "work_continuity_native_plan",
  );
  assert.ok(planTool);
  const existingIndex = TOOLS.findIndex((tool) => tool.name === planTool.name);
  if (existingIndex < 0) TOOLS.push(planTool);

  const captured = [];
  const targetHandlers = {
    work_continuity_native_plan: async (args, identity) => {
      requireTenantWorkCapability(identity, "operate");
      captured.push({ args, identity });
      return { structuredContent: { ok: true }, content: [] };
    },
  };
  const dynamicHandlers = createDynamicCapabilityHandlers({
    tools: TOOLS,
    handlers: targetHandlers,
    semanticSelect: async () => ({}),
    gateAction: async () => ({
      structuredContent: { authorization: { allowed: true } },
    }),
  });
  const catalogRevision = dynamicCapabilityCatalogSnapshot(
    TOOLS,
    targetHandlers,
  ).catalog_revision;

  const subject = "oauth-owner-native-plan";
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "oauth-owner-native-plan-key";
  const now = Math.floor(Date.now() / 1_000);
  const token = signedTestJwt(privateKey, jwk.kid, {
    iss: "https://tenant.auth0.com/",
    aud: "https://core",
    sub: subject,
    iat: now,
    auth_time: now,
    exp: now + 60,
    scope: "core:read core:govern",
    "https://skinharmony.it/tenant_id": "caller-tenant-claim",
  });
  const app = createApp({
    ...config,
    tenantClaim: "https://skinharmony.it/tenant_id",
    oauthOwnerTenantBindings: { [subject]: "tenant-a" },
    agentSignatureSecret: "oauth-owner-native-plan-presence-secret",
  }, {
    jwksCache: { get: async () => jwk },
    handlers: { ...targetHandlers, ...dynamicHandlers },
    toolSurface: "compact",
    beforeToolCall: async ({ identity, toolName, args }) => requiresGenericWorkPreflight(toolName, args)
      ? {
          work_preflight: {
            schema_version: "skinharmony_work_preflight_v1",
            preflight_id: "preflight-oauth-native-plan",
            tenant_id: identity.tenantId,
            mandatory: true,
            operational_surface: "tenant_work_gallery",
          },
        }
      : { preflight: null },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const invoke = async ({ authorization, agentId, sessionId, id }) => {
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "core_capability_invoke",
          arguments: {
            agent_id: agentId,
            client_type: authorization === "Bearer codex-key" ? "codex" : "chatgpt",
            session_id: sessionId,
            capability_id: "work_continuity_native_plan",
            catalog_revision: catalogRevision,
            idempotency_key: `native-plan-presence-${id}`,
            arguments: {
              work_id: "11111111-1111-4111-8111-111111111111",
              repository: "SkinHarmony/smart-desk",
              base_branch: "main",
              host_type: "codex_native",
              required_checks: ["core-mcp"],
              tasks: [{
                task_id: "build",
                kind: "builder",
                instruction: "Implement the bounded transport regression.",
              }],
            },
          },
        },
      }),
    });
    return { response, body: await response.json() };
  };

  try {
    const oauth = await invoke({
      authorization: `Bearer ${token}`,
      agentId: "oauth-native-coordinator",
      sessionId: "oauth-native-plan-session",
      id: "oauth-owner",
    });
    assert.equal(oauth.response.status, 200, JSON.stringify(oauth.body));
    assert.equal(oauth.body.error?.message, "Unknown tool", JSON.stringify(oauth.body));
    assert.equal(captured.length, 0, JSON.stringify(oauth.body));

    const codex = await invoke({
      authorization: "Bearer codex-key",
      agentId: "codex-unbound-coordinator",
      sessionId: "codex-declared-only-session",
      id: "codex-declared",
    });
    assert.equal(codex.response.status, 200, JSON.stringify(codex.body));
    assert.equal(codex.body.error, undefined, JSON.stringify(codex.body));
    assert.equal(captured.length, 1);
    const codexPresence = captured[0].identity.agentPresence;
    assert.equal(codexPresence.transport_bound, false);
    assert.equal(codexPresence.host_transport_session_fingerprint, null);
    assert.equal(codexPresence.binding_source, "declared");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (existingIndex < 0) {
      const index = TOOLS.indexOf(planTool);
      if (index >= 0) TOOLS.splice(index, 1);
    }
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

test("derives a dynamic native report presence from the nested child identity", async () => {
  const captured = [];
  const app = createApp(config, {
    handlers: {
      core_capability_invoke: async (args, identity) => {
        captured.push({ args, identity });
        return { content: [{ type: "text", text: "forwarded" }] };
      },
    },
    beforeToolCall: async () => ({
      schema_version: "skinharmony_work_preflight_v1",
      preflight_id: "dynamic-native-report-preflight",
      tenant_id: "owner-private",
      mandatory: true,
      operational_surface: "tenant_work_gallery",
    }),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer codex-key",
        "content-type": "application/json",
        "mcp-session-id": "dynamic-native-child-transport",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "core_capability_invoke",
          arguments: {
            capability_id: "work_continuity_native_report",
            catalog_revision: "a".repeat(64),
            idempotency_key: "dynamic-native-report-0001",
            arguments: {
              work_id: "11111111-1111-4111-8111-111111111111",
              plan_id: "22222222-2222-4222-8222-222222222222",
              native_agent_id: "dynamic-native-child",
              host_task_id: "/root/dynamic-native-child",
              assignment_capability: `hnac_${"A".repeat(43)}`,
              status: "completed",
              report: { summary: "Child prepared bounded evidence." },
            },
          },
        },
      }),
    }).then((value) => value.json());
    assert.equal(response.error, undefined, JSON.stringify(response));
    assert.notEqual(response.result?.isError, true, JSON.stringify(response));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].args.agent_id, "dynamic-native-child");
    assert.equal(captured[0].identity.agentPresence.agent_id, "dynamic-native-child");
    assert.equal(captured[0].identity.agentPresence.transport_bound, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("derives a catalog native-report bootstrap presence from its assignment", async () => {
  const captured = [];
  const app = createApp(config, {
    handlers: {
      core_capability_catalog: async (args, identity) => {
        captured.push({ args, identity });
        return { content: [{ type: "text", text: "catalogued" }] };
      },
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const assignment = {
    work_id: "11111111-1111-4111-8111-111111111111",
    plan_id: "22222222-2222-4222-8222-222222222222",
    native_agent_id: "catalog-native-child",
    host_task_id: "/root/catalog-native-child",
    assignment_capability: `hnac_${"A".repeat(43)}`,
  };
  const call = async (argumentsValue, id) => fetch(
    `http://127.0.0.1:${server.address().port}/mcp`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer codex-key",
        "content-type": "application/json",
        "mcp-session-id": "catalog-native-child-transport",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "core_capability_catalog", arguments: argumentsValue },
      }),
    },
  ).then((value) => value.json());
  try {
    const accepted = await call({
      capability_id: "work_continuity_native_report",
      native_report_assignment: assignment,
    }, 1);
    assert.equal(accepted.error, undefined, JSON.stringify(accepted));
    assert.notEqual(accepted.result?.isError, true, JSON.stringify(accepted));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].args.agent_id, assignment.native_agent_id);
    assert.equal(captured[0].identity.agentPresence.agent_id,
      assignment.native_agent_id);
    assert.equal(captured[0].identity.agentPresence.transport_bound, true);

    const conflict = await call({
      agent_id: "catalog-coordinator-alias",
      capability_id: "work_continuity_native_report",
      native_report_assignment: assignment,
    }, 2);
    assert.equal(conflict.result?.isError, true, JSON.stringify(conflict));
    assert.equal(conflict.result?.structuredContent?.error?.code,
      "native_agent_reporter_identity_conflict");
    assert.equal(captured.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("bootstraps authenticated stateless hosts without a transport session header", async () => {
  const app = createApp(config, {
    handlers: {
      nyra_converse: async () => ({ structuredContent: { ok: true }, content: [] }),
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

    const first = await call("nyra_converse", { message: "Nyra, riprendi il Work" });
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


test("publishes only the Nyra dialogue resource and keeps retired provider setup unavailable", async () => serve(async (base) => {
  const resources = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-retired-openai-panel" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 41, method: "resources/list" }),
  }).then((response) => response.json());
  assert.deepEqual(resources.result.resources, [{
    uri: NYRA_DIALOGUE_WIDGET_URI,
    name: "Nyra operating dialogue",
    description: "Authoritative Nyra Work response rendered from bounded server output.",
    mimeType: NYRA_DIALOGUE_WIDGET_MIME_TYPE,
  }]);

  const nyraRead = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-nyra-dialogue" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 411, method: "resources/read", params: { uri: NYRA_DIALOGUE_WIDGET_URI } }),
  }).then((response) => response.json());
  assert.equal(nyraRead.result.contents[0].mimeType, NYRA_DIALOGUE_WIDGET_MIME_TYPE);
  assert.match(nyraRead.result.contents[0].text, /ui\/notifications\/tool-result/);
  assert.equal(nyraRead.result.contents[0]._meta.ui.prefersBorder, true);

  const read = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-retired-openai-panel" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "resources/read", params: { uri: "ui://skinharmony/openai-provider-setup.html" } }),
  }).then((response) => response.json());
  assert.equal(read.error.code, -32602);
  assert.equal(read.error.message, "Unknown resource");
}));

test("binds Core branch analysis to a server-issued preflight and overwrites a caller-supplied envelope", async () => {
  assert.equal(
    requiresGenericWorkPreflight("core_capability_read", { capability_id: "core_branch_analyze" }),
    true,
  );
  let received;
  const serverPreflight = {
    schema_version: "skinharmony_work_preflight_v1",
    preflight_id: "preflight-server-issued-branch",
    tenant_id: "owner-private",
    operational_surface: "tenant_work_gallery",
  };
  const app = createApp(config, {
    handlers: {
      core_branch_analyze: async (args) => {
        received = args;
        return { structuredContent: { ok: true }, content: [] };
      },
    },
    beforeToolCall: async ({ toolName, args }) => {
      assert.equal(toolName, "core_branch_analyze");
      assert.equal(requiresGenericWorkPreflight(toolName, args), true);
      return { work_preflight: serverPreflight };
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer codex-key",
        "content-type": "application/json",
        "mcp-session-id": "mcp-branch-preflight-binding",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 91,
        method: "tools/call",
        params: {
          name: "core_branch_analyze",
          arguments: {
            branch: "context_intelligence",
            request: "Analyze the bounded tenant context",
            work_preflight: {
              schema_version: "skinharmony_work_preflight_v1",
              preflight_id: "caller-forged-preflight",
              tenant_id: "tenant-b",
            },
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.error, undefined);
    assert.equal(received.work_preflight.preflight_id, serverPreflight.preflight_id);
    assert.equal(received.work_preflight.tenant_id, "owner-private");
    assert.notEqual(received.work_preflight.preflight_id, "caller-forged-preflight");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

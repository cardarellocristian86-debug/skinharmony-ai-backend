import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { attachProviderOnboarding, buildIdentity, createApp, inferClientType, requiresGenericWorkPreflight, TOOLS } from "../src/app.js";
import { COMPACT_MCP_TOOL_NAMES } from "../src/dynamic-capability-router.js";

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

function oauthOwnerFixture({ subject = "oauth-owner-fixture", tenantBinding = true } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "owner-test-key";
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({
    alg: "RS256",
    typ: "JWT",
    kid: jwk.kid,
  })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: `${config.auth0Issuer}/`,
    aud: config.auth0Audience,
    sub: subject,
    scope: "core:govern",
    iat: now,
    auth_time: now,
    exp: now + 60,
    "https://skinharmony.it/tenant_id": "untrusted-tenant-claim",
  })).toString("base64url");
  const signature = crypto.sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  return {
    token: `${header}.${payload}.${signature}`,
    cache: { get: async () => jwk },
    config: {
      ...config,
      codexKeys: [],
      defaultTenantId: "codexai",
      selfServiceTenantsEnabled: true,
      oauthOwnerTenantBindings: tenantBinding ? { [subject]: "codexai" } : {},
      oauthOwnerConfirmationMaxAgeSeconds: 300,
    },
  };
}

async function serve(run, configOverride = {}) {
  const handlers = Object.fromEntries(TOOLS.map((tool) => [tool.name, async () => ({ content: [{ type: "text", text: "ok" }] })]));
  const app = createApp({ ...config, ...configOverride }, { handlers });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("requires an explicit environment and delegates staging without forwarding the bearer token", async () => {
  const stagingHandlers = Object.fromEntries(TOOLS.map((tool) => [tool.name, async () => ({
    content: [{ type: "text", text: tool.name === "core_health" ? "staging" : "ok" }],
  })]));
  const staging = createApp({
    ...config,
    environmentDelegationReceiverEnabled: true,
    environmentDelegationKey: "a".repeat(48),
  }, { handlers: stagingHandlers });
  const stagingServer = staging.listen(0);
  await new Promise((resolve) => stagingServer.once("listening", resolve));
  const stagingUrl = `http://127.0.0.1:${stagingServer.address().port}`;
  try {
    await serve(async (base) => {
      const headers = { authorization: "Bearer codex-key", "content-type": "application/json" };
      const listed = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }).then((response) => response.json());
      const health = listed.result.tools.find((tool) => tool.name === "core_health");
      assert.deepEqual(health.inputSchema.properties.environment.enum, ["production", "staging"]);
      assert.ok(health.inputSchema.required.includes("environment"));

      const missing = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "core_health", arguments: {} } }) }).then((response) => response.json());
      assert.equal(missing.error.code, -32602);

      const production = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "core_health", arguments: { environment: "production" } } }) }).then((response) => response.json());
      assert.equal(production.result.content[0].text, "ok");

      const delegated = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "core_health", arguments: { environment: "staging" } } }) }).then((response) => response.json());
      assert.equal(delegated.result.content[0].text, "staging");
    }, {
      environmentRoutingRequired: true,
      environmentDelegationKey: "a".repeat(48),
      stagingMcpUrl: stagingUrl,
    });
  } finally {
    await new Promise((resolve) => stagingServer.close(resolve));
  }
});

test("classifies verified connector identities by host", () => {
  assert.equal(inferClientType({ kind: "oauth" }), "chatgpt");
  assert.equal(inferClientType({ kind: "chatgpt" }), "chatgpt");
  assert.equal(inferClientType({ kind: "codex" }), "codex");
  assert.equal(inferClientType({ kind: "service" }), "api_agent");
});

test("publishes only a verifiable build identity", () => {
  const commit = "e".repeat(40);
  assert.deepEqual(buildIdentity({ RENDER_GIT_COMMIT: commit }), { commit_sha: commit, commit_verifiable: true });
  assert.equal(buildIdentity({ RENDER_GIT_COMMIT: "not-a-commit" }), null);
  assert.equal(buildIdentity({}), null);
});

test("publishes protected-resource and PKCE S256 metadata", async () => serve(async (base) => {
  const health = await fetch(`${base}/healthz`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.version, "0.15.0-stable-dynamic-capabilities");
  assert.equal(health.build, null);
  assert.equal(health.memory_fabric_configured, false);
  assert.equal(health.research_cortex_configured, false);
  assert.equal(health.openai_research_fallback_enabled, false);
  assert.equal(health.openai_research_fallback_configured, false);
  assert.equal(health.provider_setup_link_source_configured, false);
  assert.equal(health.owner_context_signing_configured, false);
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

test("reports only the dedicated provider setup-link source readiness", async () => serve(async (base) => {
  const health = await fetch(`${base}/healthz`).then((response) => response.json());
  assert.equal(health.provider_setup_link_source_configured, true);
  assert.equal(health.owner_context_signing_configured, true);
  assert.equal(JSON.stringify(health).includes("test-owner-context-signing-secret"), false);
  assert.equal(Object.hasOwn(health, "universalCoreProviderSetupLinkKeys"), false);
  assert.equal(Object.hasOwn(health, "provider_setup_link_source_tenant"), false);
}, { providerSetupLinkSourceConfigured: true, ownerContextSigningSecret: "test-owner-context-signing-secret" }));

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
  const nativeProviderOwnerWrites = new Set([
    "tenant_provider_openai_multi_agent_smoke_run",
    "tenant_provider_openai_multi_agent_run_cancel",
  ]);
  assert(writeTools.every((tool) =>
    tool.securitySchemes[0].scopes.includes(
      nativeProviderOwnerWrites.has(tool.name) ? "core:read" : "core:govern",
    )));
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
  assert.equal(preflight._meta["openai/outputTemplate"], "ui://skinharmony/openai-provider-setup.html");
  const nativeProviderTools = [
    "tenant_provider_openai_status",
    "tenant_provider_openai_setup_panel",
    "tenant_provider_openai_setup_link",
    "tenant_provider_openai_multi_agent_smoke_run",
    "tenant_provider_openai_multi_agent_run_read",
    "tenant_provider_openai_multi_agent_run_cancel",
  ];
  for (const name of nativeProviderTools) {
    const nativeTool = body.result.tools.find((tool) => tool.name === name);
    assert(nativeTool, `missing native provider tool ${name}`);
    assert.equal(nativeTool._meta["skinharmony/mandatory_first_tool"], undefined);
    assert.equal(nativeTool._meta["skinharmony/native_governance"], "authenticated_tenant_control_plane");
  }
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
  const execute = body.result.tools.find((tool) => tool.name === "nyra_research_execute");
  assert.equal(plan.annotations.readOnlyHint, true);
  assert.deepEqual(plan.securitySchemes[0].scopes, ["core:read"]);
  assert.equal(ingest.annotations.readOnlyHint, false);
  assert.deepEqual(ingest.securitySchemes[0].scopes, ["core:govern"]);
  assert.equal(execute.annotations.openWorldHint, true);
  assert.deepEqual(execute.securitySchemes[0].scopes, ["core:govern"]);
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
      assert(body.result.tools.some((tool) => tool.name === "tenant_provider_openai_multi_agent_smoke_run"));
      assert(body.result.tools.some((tool) => tool.name === "tenant_provider_openai_multi_agent_run_read"));
      assert(Buffer.byteLength(JSON.stringify(body)) < 64 * 1024);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("advertises automatic receipted lifecycle checkpoints in PostgreSQL mode", async () => {
  const handlers = Object.fromEntries(TOOLS.map((tool) => [tool.name, async () => ({ content: [{ type: "text", text: "ok" }] })]));
  const app = createApp({ ...config, collaborationDatabaseUrl: "configured" }, { handlers });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-postgres-metadata" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 29, method: "tools/list" }),
    });
    const body = await response.json();
    assert(body.result.tools.length > 0);
    assert(body.result.tools.every((tool) =>
      tool._meta["skinharmony/shared_memory_lifecycle"] === "automatic_receipted_task_contract_and_checkpoint"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("PostgreSQL mode forces direct governed writes even when compact mode is requested", async () => {
  const lifecycle = [];
  let writeIdentity;
  const app = createApp({
    ...config,
    collaborationDatabaseUrl: "configured",
    coordinationReceiptVerifierReady: true,
    collaborationTaskContractRequired: false,
  }, {
    toolSurface: "compact",
    handlers: {
      core_capability_invoke: async () => {
        throw new Error("dynamic mutation wrapper must not run in PostgreSQL mode");
      },
      workspace_write_document: async (_args, identity) => {
        lifecycle.push("write");
        writeIdentity = identity;
        return { structuredContent: { ok: true }, content: [{ type: "text", text: "ok" }] };
      },
    },
    beforeToolCall: async ({ toolName }) => {
      lifecycle.push(`before:${toolName}`);
      return {
        work_preflight: {
          preflight_id: "preflight-postgres-direct-write",
          tenant_id: "owner-private",
          shared_memory_bootstrap: { tenant_id: "owner-private" },
          governance: {
            execution_allowed_by_preflight: true,
            core_verdict_required_before_execution: true,
            direct_connector_bypass_forbidden_by_protocol: true,
            cross_tenant_actions_allowed: false,
            audit_required: true,
          },
        },
      };
    },
    afterToolCall: async ({ toolName }) => lifecycle.push(`after:${toolName}`),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/mcp`;
    const headers = {
      authorization: "Bearer codex-key",
      "content-type": "application/json",
      "mcp-session-id": "mcp-postgres-direct-surface",
    };
    const listed = await fetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 301, method: "tools/list" }),
    }).then((response) => response.json());
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["workspace_write_document"]);
    assert.equal(listed.result.tools.some((tool) => tool.name === "core_capability_invoke"), false);
    assert.deepEqual(
      listed.result.tools[0].inputSchema.required,
      ["path", "content", "expected_version", "idempotency_key", "lock_id", "fencing_token"],
    );

    const dynamic = await fetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 302,
        method: "tools/call",
        params: { name: "core_capability_invoke", arguments: {} },
      }),
    }).then((response) => response.json());
    assert.equal(dynamic.error.code, -32602);
    assert.deepEqual(lifecycle, []);

    const direct = await fetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 303,
        method: "tools/call",
        params: {
          name: "workspace_write_document",
          arguments: {
            path: "reports/direct-write.md",
            content: "governed",
            expected_version: 0,
            idempotency_key: "direct-write-1",
            lock_id: "11111111-1111-4111-8111-111111111111",
            fencing_token: 1,
          },
        },
      }),
    }).then((response) => response.json());
    assert.equal(direct.result.structuredContent.ok, true);
    assert.deepEqual(lifecycle, [
      "before:workspace_write_document",
      "write",
      "after:workspace_write_document",
    ]);
    assert.equal(writeIdentity.governanceContext.tool_name, "workspace_write_document");
    assert.equal(
      writeIdentity.governanceContext.preflight_id,
      "preflight-postgres-direct-write",
    );
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
  assert.match(body.result.instructions, /protected one-time Core page/);
  assert.match(body.result.instructions, /HOW TO BUILD AN AGENT/);
  assert.match(body.result.instructions, /AUTOMATIC/);
  assert.match(body.result.instructions, /NOT AUTOMATIC/);
  assert.match(body.result.instructions, /manual_dry_run/);
  assert.match(body.result.instructions, /Researcher → Reviewer → Nyra Synthesizer/);
  assert.match(body.result.instructions, /Never call work_preflight before provider status/i);
  assert.match(body.result.instructions, /bounded_execution_ready=true/);
}));

test("keeps native Core-governed controls outside generic shared-memory preflight", () => {
  for (const name of [
    "work_preflight",
    "tenant_provider_openai_status",
    "tenant_provider_openai_setup_panel",
    "tenant_provider_openai_setup_link",
    "tenant_provider_openai_multi_agent_smoke_run",
    "tenant_provider_openai_multi_agent_run_read",
    "tenant_provider_openai_multi_agent_run_cancel",
    "orchestration_dtt_core_join",
  ]) assert.equal(requiresGenericWorkPreflight(name), false, `${name} must use its native gate`);

  for (const name of ["memory_document_upsert", "generic_agent_start", "nyra_research_ingest"]) {
    assert.equal(requiresGenericWorkPreflight(name), true, `${name} must remain fail-closed by generic preflight`);
  }
});

test("never attaches an unrelated blocked generic preflight to the bounded provider start", async () => {
  const handlers = {
    tenant_provider_openai_multi_agent_smoke_run: async () => ({
      structuredContent: { ok: true, run: { run_id: "run_native_01", status: "running" } },
      content: [{ type: "text", text: "started" }],
    }),
  };
  const app = createApp(config, {
    handlers,
    beforeToolCall: async () => ({ preflight: {
      work_preflight: {
        preflight_id: "preflight_generic_blocked",
        state: "shared_memory_bootstrap_required",
        governance: { execution_allowed_by_preflight: false, shared_memory_bootstrap_required: true },
        shared_memory_bootstrap: { loaded: false },
      },
    } }),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const body = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "native-provider-session" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 44, method: "tools/call", params: {
        name: "tenant_provider_openai_multi_agent_smoke_run",
        arguments: { task: "Run the fixed bounded test", owner_confirmed: true },
      } }),
    }).then((response) => response.json());
    assert.equal(body.result.structuredContent.ok, true);
    assert.equal(body.result.structuredContent.work_preflight, undefined);
    assert.equal(JSON.stringify(body.result).includes("shared_memory_bootstrap_required"), false);
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
    assert.equal(events[0].toolAnnotations.readOnlyHint, true);
    assert.equal(events[1].toolName, "core_gate_action");
    assert.match(events[1].error.message, /expected_failure/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("returns a committed write with an explicit no-retry warning when post-commit journaling degrades", async () => {
  const app = createApp(config, {
    handlers: {
      core_gate_action: async () => ({ structuredContent: { ok: true }, content: [{ type: "text", text: "ok" }] }),
    },
    afterToolCall: async () => { throw new Error("journal_unavailable"); },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "post-commit-session" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 111, method: "tools/call", params: { name: "core_gate_action", arguments: { action_label: "write", action_type: "workspace.write" } } }),
    });
    const body = await response.json();
    assert.equal(body.result.isError, undefined);
    assert.deepEqual(body.result.structuredContent.post_commit_journal, { ok: false, retry_tool: false, state: "committed_journal_degraded" });
    assert.deepEqual(JSON.parse(body.result.content.at(-1).text).post_commit_journal, { ok: false, retry_tool: false, state: "committed_journal_degraded" });
    assert.equal(body.result._meta["skinharmony/post_commit_journal"], "degraded");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("returns an explicit no-retry warning when audit of a successful read degrades", async () => {
  const app = createApp(config, {
    handlers: {
      core_health: async () => ({ structuredContent: { ok: true }, content: [{ type: "text", text: "ok" }] }),
    },
    afterToolCall: async () => { throw new Error("audit_unavailable"); },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "read-audit-session" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 112, method: "tools/call", params: { name: "core_health", arguments: {} } }),
    });
    const body = await response.json();
    assert.deepEqual(body.result.structuredContent.post_call_audit, { ok: false, retry_tool: false, state: "read_succeeded_audit_degraded" });
    assert.deepEqual(JSON.parse(body.result.content.at(-1).text).post_call_audit, { ok: false, retry_tool: false, state: "read_succeeded_audit_degraded" });
    assert.equal(body.result._meta["skinharmony/post_call_audit"], "degraded");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("health reports PostgreSQL coordination unavailable until startup verification succeeds", async () => {
  const app = createApp({ ...config, collaborationDatabaseUrl: "configured", coordinationDatabaseVerified: false }, { handlers: {} });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const health = await fetch(`http://127.0.0.1:${server.address().port}/healthz`).then((response) => response.json());
    assert.equal(health.ok, false);
    assert.equal(health.coordination_store.available, false);
    assert.equal(health.coordination_store.schema_verified, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("health fails after a verified PostgreSQL store becomes unreachable", async () => {
  const app = createApp({ ...config, collaborationDatabaseUrl: "configured", coordinationDatabaseVerified: true }, {
    handlers: {},
    coordinationHealthCheck: async () => { throw new Error("database_unavailable"); },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 503);
    assert.equal(health.ok, false);
    assert.equal(health.coordination_store.available, false);
    assert.equal(health.coordination_store.schema_verified, true);
    assert.equal(health.coordination_store.runtime_probe, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("health remains closed when PostgreSQL is ready but the signed-receipt verifier is absent", async () => {
  const app = createApp({
    ...config,
    collaborationDatabaseUrl: "configured",
    coordinationDatabaseVerified: true,
    coordinationReceiptVerifierReady: false,
  }, {
    handlers: {},
    coordinationHealthCheck: async () => true,
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 503);
    assert.equal(health.coordination_store.available, true);
    assert.equal(health.coordination_store.signed_receipts_required, true);
    assert.equal(health.coordination_store.signed_receipt_verifier_ready, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("health remains closed when PostgreSQL and verifier are ready but either issuer is unreachable", async () => {
  const app = createApp({
    ...config,
    collaborationDatabaseUrl: "configured",
    coordinationDatabaseVerified: true,
    coordinationReceiptVerifierReady: true,
  }, {
    handlers: {},
    coordinationHealthCheck: async () => true,
    coordinationIssuerHealthCheck: async () => false,
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 503);
    assert.equal(health.ok, false);
    assert.equal(health.coordination_store.available, true);
    assert.equal(health.coordination_store.signed_receipt_verifier_ready, true);
    assert.equal(health.coordination_store.signed_receipt_issuers_reachable, false);
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

test("binds an OAuth owner confirmation to core_gate_action once without widening owner authority", async () => {
  const owner = oauthOwnerFixture();
  const seen = [];
  const app = createApp(owner.config, {
    jwksCache: owner.cache,
    handlers: {
      core_gate_action: async (args, identity) => {
        seen.push({ args, identity });
        return {
          structuredContent: { authorization: { allowed: identity.ownerConfirmed === true } },
          content: [{ type: "text", text: "ok" }],
        };
      },
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = {
      method: "POST",
      headers: {
        authorization: `Bearer ${owner.token}`,
        "content-type": "application/json",
        "mcp-session-id": "oauth-owner-gate-session",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 23,
        method: "tools/call",
        params: {
          name: "core_gate_action",
          arguments: {
            action_label: "Bound staging gate",
            action_type: "render_mcp_staging_topology_phase",
            owner_confirmed: true,
            confirmation_reference: "owner confirmed exact staging envelope",
          },
        },
      }),
    };
    const first = await fetch(`${base}/mcp`, request);
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstBody.result.structuredContent.authorization.allowed, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].identity.kind, "oauth");
    assert.equal(seen[0].identity.tenantId, "codexai");
    assert.equal(seen[0].identity.oauthOwnerElevated, true);
    assert.equal(seen[0].identity.ownerConfirmed, true);
    assert.equal(
      seen[0].identity.confirmationReference,
      "owner confirmed exact staging envelope",
    );
    assert.equal(seen[0].identity.godMode, undefined);

    const replay = await fetch(`${base}/mcp`, request);
    const replayBody = await replay.json();
    assert.equal(replay.status, 200);
    assert.equal(replayBody.result.isError, true);
    assert.equal(
      replayBody.result.structuredContent.error.code,
      "owner_confirmation_replayed",
    );
    assert.equal(replayBody.result.structuredContent.error.retryable, false);
    assert.equal(seen.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const unbound = oauthOwnerFixture({ subject: "unbound-oauth-user", tenantBinding: false });
  let unboundIdentity;
  const unboundApp = createApp(unbound.config, {
    jwksCache: unbound.cache,
    handlers: {
      core_gate_action: async (_args, identity) => {
        unboundIdentity = identity;
        return { content: [{ type: "text", text: "ok" }] };
      },
    },
  });
  const unboundServer = unboundApp.listen(0);
  await new Promise((resolve) => unboundServer.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${unboundServer.address().port}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${unbound.token}`,
        "content-type": "application/json",
        "mcp-session-id": "unbound-oauth-gate-session",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 24,
        method: "tools/call",
        params: {
          name: "core_gate_action",
          arguments: {
            action_label: "Must not elevate",
            action_type: "render_mcp_staging_topology_phase",
            owner_confirmed: true,
            confirmation_reference: "unbound claim",
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(unboundIdentity.oauthOwnerElevated, undefined);
    assert.equal(unboundIdentity.ownerConfirmed, false);
  } finally {
    await new Promise((resolve) => unboundServer.close(resolve));
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
    assert.equal(seenIdentity.ownerConfirmationClaimed, true);
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


test("publishes the fixed secure OpenAI setup panel", async () => serve(async (base) => {
  const init = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-openai-panel" }, body: JSON.stringify({ jsonrpc: "2.0", id: 40, method: "initialize" }) }).then((response) => response.json());
  assert.equal(init.result.capabilities.resources != null, true);
  const resources = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-openai-panel" }, body: JSON.stringify({ jsonrpc: "2.0", id: 41, method: "resources/list" }) }).then((response) => response.json());
  const resource = resources.result.resources.find((item) => item.uri === "ui://skinharmony/openai-provider-setup.html");
  assert(resource);
  const read = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-openai-panel" }, body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "resources/read", params: { uri: resource.uri } }) }).then((response) => response.json());
  assert.match(read.result.contents[0].text, /Collega API key/);
  assert.match(read.result.contents[0].text, /link monouso verrà creato solo nella pagina protetta/);
  assert.doesNotMatch(read.result.contents[0].text, /setup_proof|setup_url.*provider-setup/);
  const listed = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer codex-key", "content-type": "application/json", "mcp-session-id": "mcp-openai-panel" }, body: JSON.stringify({ jsonrpc: "2.0", id: 43, method: "tools/list" }) }).then((response) => response.json());
  const panel = listed.result.tools.find((tool) => tool.name === "tenant_provider_openai_setup_panel");
  assert.equal(panel.annotations.readOnlyHint, true);
  assert.equal(panel._meta["openai/outputTemplate"], resource.uri);
}));


test("attaches the fixed setup panel when the tenant key is missing", () => {
  const result = attachProviderOnboarding({ structuredContent: { ok: true } }, { structuredContent: { provider: { configured: false } } });
  assert.equal(result.structuredContent.provider_onboarding.required, true);
  assert.equal(result._meta["openai/outputTemplate"], "ui://skinharmony/openai-provider-setup.html");
  const connected = attachProviderOnboarding({ structuredContent: { ok: true } }, { structuredContent: { provider: { configured: true } } });
  assert.equal(connected._meta, undefined);
});

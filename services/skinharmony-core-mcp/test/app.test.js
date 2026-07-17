import assert from "node:assert/strict";
import test from "node:test";
import { createApp, TOOLS } from "../src/app.js";

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

async function serve(run) {
  const handlers = Object.fromEntries(TOOLS.map((tool) => [tool.name, async () => ({ content: [{ type: "text", text: "ok" }] })]));
  const app = createApp(config, { handlers });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("publishes protected-resource and PKCE S256 metadata", async () => serve(async (base) => {
  const health = await fetch(`${base}/healthz`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.version, "0.11.0-suite-cockpit");
  assert.equal(health.memory_fabric_configured, false);
  assert.equal(health.research_cortex_configured, false);
  assert.equal(health.openai_research_fallback_enabled, false);
  assert.equal(health.openai_research_fallback_configured, false);
  const resource = await fetch(`${base}/.well-known/oauth-protected-resource`).then((r) => r.json());
  assert.equal(resource.resource, config.resource);
  assert.deepEqual(resource.authorization_servers, [config.auth0Issuer]);
  const pathResource = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`).then((r) => r.json());
  assert.deepEqual(pathResource, resource);
  const oauth = await fetch(`${base}/.well-known/oauth-authorization-server`).then((r) => r.json());
  assert.deepEqual(oauth.code_challenge_methods_supported, ["S256"]);
}));

test("returns RFC 9728 challenge when bearer is absent", async () => serve(async (base) => {
  const response = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate"), /oauth-protected-resource/);
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
  assert(writeTools.every((tool) => tool.inputSchema.properties.owner_confirmed?.type === "boolean"));
  assert(writeTools.every((tool) => tool.inputSchema.properties.confirmation_reference?.type === "string"));
  const preflight = body.result.tools.find((tool) => tool.name === "work_preflight");
  assert(preflight);
  assert(preflight.outputSchema?.properties?.core_runtime);
  assert.equal(preflight._meta["skinharmony/preflight_entrypoint"], true);
  assert(body.result.tools.every((tool) => tool._meta["skinharmony/mandatory_first_tool"] === "work_preflight"));
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
  assert.match(body.result.instructions, /Never ask a user to paste or reveal an API key in ChatGPT/);
  assert.match(body.result.instructions, /secure link/);
  assert.match(body.result.instructions, /HOW TO BUILD AN AGENT/);
  assert.match(body.result.instructions, /AUTOMATIC/);
  assert.match(body.result.instructions, /NOT AUTOMATIC/);
  assert.match(body.result.instructions, /manual_dry_run/);
}));

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
  const app = createApp(config, {
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

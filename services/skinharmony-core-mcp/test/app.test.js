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
  assert.equal(health.version, "0.7.3-owner-oauth-preflight");
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
  const response = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer codex-key", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
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
  assert.equal(preflight._meta["skinharmony/preflight_entrypoint"], true);
  assert(body.result.tools.every((tool) => tool._meta["skinharmony/mandatory_first_tool"] === "work_preflight"));
  const gate = body.result.tools.find((tool) => tool.name === "core_gate_action");
  assert.deepEqual(gate.securitySchemes.find((scheme) => scheme.type === "oauth2").scopes, ["core:govern"]);
  assert.deepEqual(gate._meta.securitySchemes, gate.securitySchemes);
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
}));

test("publishes the governed host-browsing research sequence", async () => serve(async (base) => {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer codex-key", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 40, method: "initialize" }),
  });
  const body = await response.json();
  assert.match(body.result.instructions, /nyra_research_plan/);
  assert.match(body.result.instructions, /host ChatGPT or Codex web tool/);
  assert.match(body.result.instructions, /Never include secrets/);
}));

test("uses Core OAuth scopes for every collaboration capability", async () => serve(async (base) => {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer codex-key", "content-type": "application/json" },
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
  const response = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer codex-key", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 40, method: "tools/list" }) });
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
    const headers = { authorization: "Bearer codex-key", "content-type": "application/json" };
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
    const response = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer codex-key", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }) });
    const body = await response.json();
    assert.deepEqual(body.result.tools.map((tool) => tool.name), ["core_health"]);
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
    const headers = { authorization: "Bearer codex-key", "content-type": "application/json" };
    const success = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "core_health", arguments: {} } }) });
    assert.equal(success.status, 200);
    const failure = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "core_gate_action", arguments: { action_label: "x", action_type: "y" } } }) });
    assert.equal(failure.status, 500);
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
      headers: { authorization: "Bearer codex-key", "content-type": "application/json" },
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
      headers: { authorization: "Bearer codex-key", "content-type": "application/json" },
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
      headers: { authorization: "Bearer codex-key", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "search", arguments: { query: "work" } } }),
    });
    assert.equal(response.status, 500);
    assert.equal(toolCalled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

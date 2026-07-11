import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createCoreMcpApp } from "../src/app.js";
import { normalizeCoreGateResponse, sanitizeForModel } from "../src/upstream.js";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("sanitizer removes secrets and personal payload fields", () => {
  const safe = sanitizeForModel({ ok: true, api_key: "secret", customer_email: "private@example.test", nested: { value: "kept" } });
  assert.deepEqual(safe, { ok: true, nested: { value: "kept" } });
});

test("production MCP refuses to start without its bearer token", () => {
  assert.throws(() => createCoreMcpApp({ nodeEnv: "production", authToken: "" }), /MCP_AUTH_TOKEN is required/);
});

test("core verdict normalization fails closed", () => {
  const normalized = normalizeCoreGateResponse({ result: { policy_engine: { action_mediation: { state: "confirm" }, risk: { band: "high", score: 82, reasons: ["owner_confirmation_required"] } } } });
  assert.equal(normalized.verdict, "CONFIRM");
  assert.equal(normalized.execution_allowed, false);
  assert.equal(normalized.owner_confirmation_required, true);
});

test("Core gate tool returns DEFER when Core is unavailable", async () => {
  const app = createCoreMcpApp({
    host: "127.0.0.1",
    allowedHosts: ["127.0.0.1", "localhost"],
    authToken: "mcp-fail-closed-token",
    nodeEnv: "test",
    coreClient: {
      health: async () => ({ ok: false }),
      gateAction: async () => { throw new Error("offline"); },
    },
    nyraClient: {
      readiness: async () => ({ ok: false }),
      controlSnapshot: async () => ({}),
      interpret: async () => ({}),
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const client = new Client({ name: "fail-closed-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`), {
    requestInit: { headers: { authorization: "Bearer mcp-fail-closed-token" } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "core_gate_action", arguments: { tenant_id: "codexai", action_type: "write", action_label: "Unavailable Core" } });
    assert.equal(result.structuredContent.verdict, "DEFER");
    assert.equal(result.structuredContent.execution_allowed, false);
  } finally {
    await transport.close();
    await close(server);
  }
});

test("MCP exposes Nyra context and Core gate with bearer authentication", async () => {
  const upstream = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/healthz") return res.end(JSON.stringify({ ok: true, service: "mock-core" }));
    if (req.url === "/v1/policy/check" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      return req.on("end", () => {
        assert.equal(req.headers.authorization, "Bearer core-test-key");
        const body = JSON.parse(raw);
        const sensitive = body.action.action_type === "deploy";
        res.end(JSON.stringify({
          ok: true,
          result: {
            policy_engine: {
              schema_version: "policy_engine_v1",
              tenant_id: body.tenant_id,
              action_mediation: {
                state: sensitive ? "confirm" : "allow",
                owner_confirmation_required: sensitive,
                blocked: false,
                next_step: sensitive ? "ask_owner_confirmation" : "execute_with_audit",
              },
              risk: { band: sensitive ? "high" : "low", score: sensitive ? 80 : 20, reasons: sensitive ? ["owner_confirmation_required"] : [] },
            },
          },
        }));
      });
    }
    if (req.url === "/api/nyra/runtime/readiness") return res.end(JSON.stringify({ ok: true, core: { status: "connected" }, api_key: "must-not-leak" }));
    if (req.url === "/api/nyra/control") return res.end(JSON.stringify({ ok: true, mode: "advisory" }));
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: "not_found" }));
  });
  const upstreamPort = await listen(upstream);

  const app = createCoreMcpApp({
    host: "127.0.0.1",
    allowedHosts: ["127.0.0.1", "localhost"],
    authToken: "mcp-test-token",
    nodeEnv: "test",
    core: { baseUrl: `http://127.0.0.1:${upstreamPort}`, key: "core-test-key" },
    nyra: { baseUrl: `http://127.0.0.1:${upstreamPort}`, apiKey: "nyra-test-key" },
  });
  const mcpHttp = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => mcpHttp.once("listening", resolve));
  const mcpPort = mcpHttp.address().port;

  try {
    const unauthorized = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(unauthorized.status, 401);

    const client = new Client({ name: "skinharmony-mcp-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: "Bearer mcp-test-token" } },
    });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ["core_gate_action", "core_health", "nyra_interpret_request", "nyra_runtime_context"]);

    const allowed = await client.callTool({ name: "core_gate_action", arguments: { tenant_id: "codexai", action_type: "code_edit", action_label: "Edit test", risk_hint: 25 } });
    assert.equal(allowed.structuredContent.verdict, "ALLOW");
    assert.equal(allowed.structuredContent.execution_allowed, true);

    const gated = await client.callTool({ name: "core_gate_action", arguments: { tenant_id: "codexai", action_type: "deploy", action_label: "Deploy live", risk_hint: 80 } });
    assert.equal(gated.structuredContent.verdict, "CONFIRM");
    assert.equal(gated.structuredContent.execution_allowed, false);

    const nyra = await client.callTool({ name: "nyra_runtime_context", arguments: { include_control_snapshot: false } });
    assert.equal(nyra.structuredContent.ok, true);
    assert.equal(JSON.stringify(nyra.structuredContent).includes("must-not-leak"), false);
    await transport.close();
  } finally {
    await close(mcpHttp);
    await close(upstream);
  }
});

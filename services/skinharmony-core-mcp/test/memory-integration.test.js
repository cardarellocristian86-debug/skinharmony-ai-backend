import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createCoreHandlers, createCoreWriteGuard } from "../src/core-handlers.js";
import { createMemoryFabric, createMemoryFabricHandlers } from "../src/memory-fabric.js";

test("runs write, automatic recall, Nyra/Core interpretation and safe journal end to end", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sh-memory-integration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const coreBodies = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    coreBodies.push({ path: new URL(url).pathname, body });
    if (new URL(url).pathname === "/v1/action-evaluator") {
      return new Response(JSON.stringify({ verdict: { decision: "allow_controlled", action_mediation: { state: "allow" } } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      ok: true,
      tenant_id: body.tenant_id,
      received_memory: body.memory_context,
      result: {
        selected_by_core: { state: "controlled" },
        automation_plan: { execution_allowed: false },
        nyra_neural_network: { opened_branches: [{ id: "context_intelligence" }] },
      },
    }), { status: 200 });
  };
  const config = {
    publicUrl: "https://mcp.example.test",
    resource: "https://mcp.example.test/mcp",
    auth0Issuer: "",
    auth0Audience: "",
    jwksUri: "",
    codexKeys: ["integration-key"],
    codexScopes: ["core:read", "core:govern"],
    supportedScopes: ["core:read", "core:govern"],
    defaultTenantId: "tenant-integration",
    universalCoreUrl: "https://core.example.test",
    universalCoreKeys: { "tenant-integration": "core-key" },
    universalCoreKey: "",
    memoryFabricRoot: root,
    memoryRetentionDays: 365,
    personalMemoryRetentionDays: 90,
  };
  const govern = createCoreWriteGuard(config, { fetchImpl });
  const fabric = createMemoryFabric(config, { govern });
  const coreHandlers = createCoreHandlers(config, {
    fetchImpl,
    contextProvider: (input, identity) => fabric.context(input, identity),
  });
  const app = createApp(config, {
    handlers: { ...coreHandlers, ...createMemoryFabricHandlers(fabric) },
    afterToolCall: (event) => fabric.recordToolActivity(event),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(id, name, args) {
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer integration-key", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    });
    return { status: response.status, body: await response.json() };
  }

  const append = await call(1, "memory_append", {
    kind: "decision",
    title: "Architecture decision",
    summary: "Use the tenant memory fabric for AI continuity",
    project_id: "project-one",
  });
  assert.equal(append.status, 200);
  assert.equal(append.body.result.structuredContent.created, true);

  const rawMessage = "Continue the architecture from the other AI without saving this raw sentence";
  const interpretation = await call(2, "nyra_interpret_request", {
    message: rawMessage,
    project_id: "project-one",
    session_id: "session-one",
  });
  assert.equal(interpretation.status, 200);
  const received = interpretation.body.result.structuredContent.received_memory;
  assert.equal(received.tenant_id, "tenant-integration");
  assert.equal(received.relevant_memories.length, 1);
  assert.equal(received.relevant_memories[0].title, "Architecture decision");
  assert.equal(interpretation.body.result.structuredContent.result.automation_plan.execution_allowed, false);

  const context = await call(3, "memory_context", { project_id: "project-one", session_id: "session-one" });
  assert.equal(context.status, 200);
  assert(context.body.result.structuredContent.recent_activity.some((item) => item.title === "MCP nyra_interpret_request"));
  const stored = fs.readFileSync(path.join(root, "tenants", "tenant-integration", "memory-fabric", "state.json"), "utf8");
  assert(!stored.includes(rawMessage));
  assert(coreBodies.some((entry) => entry.path === "/v1/action-evaluator"));
  assert(coreBodies.some((entry) => entry.path === "/v1/nira/core-bridge" && entry.body.memory_context?.tenant_id === "tenant-integration"));
});

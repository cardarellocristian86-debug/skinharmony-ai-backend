import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHandlers, createCoreWriteGuard } from "../src/core-handlers.js";

test("maps MCP tools to Universal Core without forwarding the ChatGPT token", async () => {
  const calls = [];
  const contextCalls = [];
  const handlers = createCoreHandlers({ universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "tenant-a-key" }, defaultTenantId: "owner-private", universalCoreKey: "owner-key" }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, path: new URL(url).pathname }), { status: 200, headers: { "content-type": "application/json" } });
    },
    contextProvider: async (input, identity) => {
      contextCalls.push({ input, identity });
      return { schema_version: "tenant_memory_context_v1", tenant_id: identity.tenantId, revision: 7, relevant_memories: [] };
    },
  });
  const identity = { tenantId: "tenant-a" };
  await handlers.core_health({}, identity);
  await handlers.work_preflight({ request: "publish GitHub PR", available_capabilities: ["github_connected_app"] }, identity);
  await handlers.nyra_runtime_context({ include_control_snapshot: true, domain_pack: "generic" }, identity);
  await handlers.nyra_branch_catalog({}, identity);
  await handlers.nyra_interpret_request({ message: "analizza", session_id: "s1", domain_pack: "generic", nyra_branches: ["context_intelligence"] }, identity);
  await handlers.core_gate_action({ action_label: "deploy", action_type: "release" }, identity);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/healthz", "/v1/work/preflight", "/v1/codex/context", "/v1/nira/branches", "/v1/nira/core-bridge", "/v1/action-evaluator"]);
  assert(calls.every((call) => call.init.headers.authorization === "Bearer tenant-a-key"));
  assert(calls.filter((call) => call.init.body).every((call) => JSON.parse(call.init.body).tenant_id === "tenant-a"));
  assert.deepEqual(JSON.parse(calls[1].init.body).available_capabilities, ["github_connected_app"]);
  assert.equal(JSON.parse(calls[2].init.body).domain_pack, "generic");
  assert.deepEqual(JSON.parse(calls[4].init.body).nyra_branches, ["context_intelligence"]);
  assert.equal(JSON.parse(calls[1].init.body).memory_context.tenant_id, "tenant-a");
  assert.equal(JSON.parse(calls[4].init.body).memory_context.revision, 7);
  assert.equal(JSON.parse(calls[5].init.body).memory_context.revision, 7);
  assert.equal(contextCalls.length, 4);
  assert.equal(contextCalls[2].input.query, "analizza");
  assert.equal(contextCalls[2].input.agent_id, "nyra");
});

test("rejects a tenant without its own Core key", async () => {
  const handlers = createCoreHandlers({ universalCoreUrl: "https://core.test", universalCoreKeys: {}, defaultTenantId: "owner-private", universalCoreKey: "owner-key" });
  await assert.rejects(handlers.core_health({}, { tenantId: "tenant-b" }), /core_tenant_key_missing/);
});

test("write guard fails closed on hard blocks and allows controlled writes", async () => {
  const replies = [
    { verdict: { decision: "block", action_mediation: { state: "hard_block" } } },
    { verdict: { decision: "allow_controlled", action_mediation: { state: "allow" } } }
  ];
  const guard = createCoreWriteGuard({ universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "tenant-a-key" }, defaultTenantId: "owner-private", universalCoreKey: "owner-key" }, {
    fetchImpl: async () => new Response(JSON.stringify(replies.shift()), { status: 200, headers: { "content-type": "application/json" } })
  });
  const identity = { tenantId: "tenant-a" };
  assert.equal((await guard({ action_label: "write", action_type: "workspace.write", target: "doc" }, identity)).allowed, false);
  assert.equal((await guard({ action_label: "write", action_type: "workspace.write", target: "doc" }, identity)).allowed, true);
});

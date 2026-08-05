import test from "node:test";
import assert from "node:assert/strict";
import { createReliabilityHandlers } from "../src/reliability-layer.js";
import { TOOLS } from "../src/tool-definitions.js";
import { validateToolArguments } from "../src/schema-validation.js";

const identity = {
  tenantId: "tenant_test",
  agentPresence: { agent_id: "agent_test", session_id: "session_test" },
};

test("reliability MCP tools are unique and validate required contracts", () => {
  const names = TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of [
    "nyra_reliability_read",
    "nyra_reliability_chat_evaluate",
    "nyra_reliability_action_issue",
    "nyra_reliability_completion_verify",
    "nyra_reliability_browser_observe",
  ]) assert.ok(TOOLS.find((tool) => tool.name === name), name);
  const chat = TOOLS.find((tool) => tool.name === "nyra_reliability_chat_evaluate");
  assert.deepEqual(validateToolArguments(chat.inputSchema, { messages: [{ content: "hello" }] }), []);
  assert.ok(validateToolArguments(chat.inputSchema, {}).length > 0);
});

test("MCP reliability bridge pins routes to Core and injects the authenticated session", async () => {
  const calls = [];
  const handlers = createReliabilityHandlers({}, {
    coreHandlers: {
      core_reliability_request: async (request, requestIdentity) => {
        calls.push({ request, requestIdentity });
        return { ok: true, reliability: { execution_authorized: false } };
      },
    },
  });
  const result = await handlers.nyra_reliability_chat_evaluate({ messages: [{ content: "hello" }] }, identity);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(calls[0].request.path, "/v1/reliability/chat/evaluate");
  assert.equal(calls[0].request.body.session_id, "session_test");
  assert.equal(calls[0].request.body.tenant_id, undefined);
  assert.equal(calls[0].request.body.agent_id, "agent_test");
  await assert.rejects(
    () => handlers.nyra_reliability_continuity_read({ work_id: "work_test", session_id: "other_session" }, identity),
    /reliability_session_scope_mismatch/,
  );
});


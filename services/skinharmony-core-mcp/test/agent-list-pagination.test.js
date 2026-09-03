import assert from "node:assert/strict";
import test from "node:test";
import {
  agentIsAfterCursor,
  compareAgentsNewestFirst,
  encodeAgentListCursor,
  normalizeAgentListArgs,
} from "../src/agent-list-pagination.js";

test("agent list cursor uses an immutable id boundary and rejects legacy ordering", () => {
  const cursor = encodeAgentListCursor({
    agent_id: "agent-b",
  });
  const normalized = normalizeAgentListArgs({ limit: 25, cursor });
  assert.equal(normalized.limit, 25);
  assert.deepEqual(normalized.cursor, { agent_id: "agent-b" });
  assert.equal(agentIsAfterCursor({ agent_id: "agent-a" }, normalized.cursor), true);
  assert.equal(agentIsAfterCursor({ agent_id: "agent-c" }, normalized.cursor), false);

  const legacy = `alc_${Buffer.from(JSON.stringify({
    schema_version: "agent_list_cursor_v1",
    last_seen_at: "2026-09-02T20:10:11.123456Z",
    agent_id: "agent-b",
  })).toString("base64url")}`;
  assert.throws(
    () => normalizeAgentListArgs({ cursor: legacy }),
    /agent_list_cursor_invalid/,
  );
});

test("agent list defaults to a bounded page and rejects forged cursors", () => {
  assert.deepEqual(normalizeAgentListArgs({}), { limit: 50, cursor: null });
  assert.throws(() => normalizeAgentListArgs({ cursor: "alc_not-json" }), /agent_list_cursor_invalid/);
});

test("agent page sorting stays stable when heartbeats change", () => {
  const agents = [
    { agent_id: "agent-a", last_seen_at: "2026-09-02T20:30:00.000Z" },
    { agent_id: "agent-b", last_seen_at: "2026-09-02T20:00:00.000Z" },
  ].sort(compareAgentsNewestFirst);
  assert.deepEqual(agents.map((agent) => agent.agent_id), ["agent-b", "agent-a"]);
});

test("agent page ordering and cursor use the same ASCII byte order", () => {
  const agents = ["agent-z", "Agent-b", "agent-A", "agent_a", "agent-a"]
    .map((agent_id) => ({ agent_id }))
    .sort(compareAgentsNewestFirst);
  const ordered = agents.map((agent) => agent.agent_id);
  assert.deepEqual(ordered, ["agent_a", "agent-z", "agent-a", "agent-A", "Agent-b"]);
  const boundary = { agent_id: "agent-a" };
  assert.deepEqual(
    agents.filter((agent) => agentIsAfterCursor(agent, boundary)).map((agent) => agent.agent_id),
    ["agent-A", "Agent-b"],
  );
});

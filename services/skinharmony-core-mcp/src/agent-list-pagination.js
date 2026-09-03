const AGENT_ID = /^[a-z0-9][a-z0-9_-]{1,63}$/i;

function fail() {
  const error = new Error("agent_list_cursor_invalid");
  error.code = "agent_list_cursor_invalid";
  throw error;
}

export function normalizeAgentListArgs(args = {}) {
  const requested = Number(args.limit);
  const limit = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), 100)
    : 50;
  if (!args.cursor) return { limit, cursor: null };
  const raw = String(args.cursor || "");
  if (!/^alc_[A-Za-z0-9_-]{8,500}$/.test(raw)) fail();
  try {
    const decoded = JSON.parse(Buffer.from(raw.slice(4), "base64url").toString("utf8"));
    // V1 used a mutable heartbeat timestamp and cannot be continued safely
    // after switching to an immutable-id order. Reject it so the caller
    // restarts from page one instead of silently duplicating or omitting rows.
    if (decoded.schema_version !== "agent_list_cursor_v2" ||
        !AGENT_ID.test(String(decoded.agent_id || ""))) fail();
    return {
      limit,
      cursor: {
        agent_id: String(decoded.agent_id),
      },
    };
  } catch (error) {
    if (error?.code === "agent_list_cursor_invalid") throw error;
    fail();
  }
}

export function encodeAgentListCursor(agent) {
  const agentId = String(agent?.agent_id || agent?.id || "");
  if (!AGENT_ID.test(agentId)) fail();
  return `alc_${Buffer.from(JSON.stringify({
    schema_version: "agent_list_cursor_v2",
    agent_id: agentId,
  })).toString("base64url")}`;
}

export function compareAgentsNewestFirst(left, right) {
  // Heartbeats mutate last_seen_at while a client is traversing pages. Using
  // the immutable tenant-scoped agent id as the key prevents an unseen agent
  // from jumping behind the cursor and disappearing from that traversal.
  const leftId = String(left.agent_id || left.id || "");
  const rightId = String(right.agent_id || right.id || "");
  if (leftId === rightId) return 0;
  // IDs are ASCII. JS relational comparison is therefore the same bytewise
  // order enforced by PostgreSQL COLLATE "C" below.
  return leftId < rightId ? 1 : -1;
}

export function agentIsAfterCursor(agent, cursor) {
  if (!cursor) return true;
  return String(agent.agent_id || agent.id || "") < cursor.agent_id;
}

function annotations(readOnly, idempotent = false) {
  return { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false, idempotentHint: idempotent };
}

function tool(name, title, description, inputSchema, scopes, readOnly = true, idempotent = true) {
  return { name, title, description, inputSchema, scopes, annotations: annotations(readOnly, idempotent) };
}

const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const text = (maxLength = 20_000) => ({ type: "string", minLength: 1, maxLength });
const identifier = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" };
const memoryClassification = { type: "string", enum: ["internal", "customer_aggregate", "customer_personal", "restricted"] };
const memoryKind = { type: "string", enum: ["observation", "decision", "action", "outcome", "learning"] };
const memoryTextList = { type: "array", maxItems: 20, items: text(1_000) };
const memoryProperties = {
  title: text(240),
  summary: text(),
  facts: memoryTextList,
  decisions: memoryTextList,
  actions: memoryTextList,
  outcomes: memoryTextList,
  next_steps: memoryTextList,
  tags: { type: "array", maxItems: 30, items: identifier },
  importance: { type: "integer", minimum: 1, maximum: 100 },
  data_classification: memoryClassification,
  consent_reference: { type: "string", maxLength: 240 },
  project_id: identifier,
  session_id: identifier,
  agent_id: identifier,
  retention_days: { type: "integer", minimum: 1, maximum: 3_650 },
  idempotency_key: { type: "string", maxLength: 120 },
};
const memoryScopeProperties = {
  query: { type: "string", maxLength: 500 },
  project_id: identifier,
  session_id: identifier,
  agent_id: identifier,
  limit: { type: "integer", minimum: 1, maximum: 50 },
};

export const TOOLS = [
  tool("core_health", "Check Core health", "Read Universal Core service health.", object(), ["core:read"]),
  tool("nyra_runtime_context", "Read Nyra runtime context", "Read Nyra readiness, tenant memory and control context.", object({ include_control_snapshot: { type: "boolean" }, domain_pack: identifier, ...memoryScopeProperties }), ["core:read"]),
  tool("nyra_branch_catalog", "Read Nyra neural branches", "Read the tenant-scoped Nyra branch and subbranch catalog governed by Universal Core.", object(), ["core:read"]),
  tool("nyra_interpret_request", "Interpret a Nyra request", "Ask Universal Core to recall tenant memory, open the relevant Nyra branches and interpret a request without executing it.", object({ message: text(), session_id: identifier, project_id: identifier, agent_id: identifier, domain_pack: identifier, nyra_branches: { type: "array", maxItems: 20, items: identifier } }, ["message"]), ["core:read"]),
  tool("core_gate_action", "Evaluate an action", "Ask Universal Core to evaluate an action; this never executes it.", { type: "object", required: ["action_label", "action_type"], properties: { action_label: text(500), action_type: text(120) }, additionalProperties: true }, ["core:govern"]),
  tool("memory_context", "Read tenant AI context", "Read the authenticated tenant's current checkpoint, relevant memories, pending handoffs and recent redacted activity.", object({ ...memoryScopeProperties, activity_limit: { type: "integer", minimum: 1, maximum: 50 } }), ["core:read"]),
  tool("memory_search", "Search tenant AI memory", "Search durable, redacted memory belonging only to the authenticated tenant.", object(memoryScopeProperties), ["core:read"]),
  tool("memory_append", "Append tenant AI memory", "Store an explicit durable memory after Core governance, consent checks and secret redaction.", object({ kind: memoryKind, ...memoryProperties }, ["title", "summary"]), ["core:govern"], false, true),
  tool("memory_checkpoint", "Create tenant AI checkpoint", "Save a durable checkpoint so another AI can resume the authenticated tenant's work.", object(memoryProperties, ["summary"]), ["core:govern"], false, true),
  tool("memory_handoff", "Create tenant AI handoff", "Create a durable handoff for another AI inside the authenticated tenant.", object({ ...memoryProperties, to_agent_id: { anyOf: [identifier, { const: "all" }] } }, ["summary", "to_agent_id"]), ["core:govern"], false, true),
  tool("memory_handoff_acknowledge", "Acknowledge tenant AI handoff", "Acknowledge a handoff addressed to this AI inside the authenticated tenant.", object({ handoff_id: { type: "string", pattern: "^mem_[a-f0-9-]{36}$" }, agent_id: identifier }, ["handoff_id", "agent_id"]), ["core:govern"], false, true),
  tool("search", "Search shared work memory", "Search the authenticated tenant's redacted SkinHarmony work memory.", object({ query: text(500) }, ["query"]), ["core:read"]),
  tool("fetch", "Fetch shared work memory document", "Read one search result from the authenticated tenant's redacted work memory.", object({ id: { type: "string", pattern: "^[a-f0-9]{24}$" } }, ["id"]), ["core:read"]),

  tool("workspace_list", "List shared workspace", "List folders and document metadata inside the authenticated tenant workspace.", object({ prefix: { type: "string", maxLength: 240 } }), ["workspace:read"]),
  tool("workspace_create_folder", "Create shared folder", "Create a tenant-scoped logical folder after Core governance.", object({ path: text(240) }, ["path"]), ["workspace:write", "core:govern"], false, true),
  tool("workspace_read_document", "Read shared document", "Read one tenant-scoped shared document by id or path.", object({ id: { type: "string" }, path: { type: "string", maxLength: 240 } }), ["workspace:read"]),
  tool("workspace_write_document", "Write shared document", "Create or version a tenant-scoped document with optimistic concurrency and Core governance.", object({ path: text(240), title: { type: "string", maxLength: 200 }, content: text(100_000), expected_version: { type: "integer", minimum: 0 }, idempotency_key: { type: "string", maxLength: 120 } }, ["path", "content"]), ["workspace:write", "core:govern"], false, true),

  tool("task_list", "List shared tasks", "List tenant-scoped tasks for agent coordination.", object({ status: { type: "string", enum: ["open", "claimed", "in_progress", "blocked", "completed", "cancelled"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }), ["task:read"]),
  tool("task_create", "Create shared task", "Create a tenant-scoped task after Core governance.", object({ title: text(240), description: { type: "string", maxLength: 20_000 }, priority: { type: "string", enum: ["low", "normal", "high", "urgent"] }, idempotency_key: { type: "string", maxLength: 120 } }, ["title"]), ["task:write", "core:govern"], false, true),
  tool("task_claim", "Claim shared task", "Atomically claim an open tenant-scoped task for one registered agent.", object({ task_id: text(80), agent_id: identifier, expected_version: { type: "integer", minimum: 1 } }, ["task_id", "agent_id", "expected_version"]), ["task:write", "core:govern"], false, true),
  tool("task_update", "Update shared task", "Update the status of a claimed tenant-scoped task using optimistic concurrency.", object({ task_id: text(80), agent_id: identifier, status: { type: "string", enum: ["claimed", "in_progress", "blocked", "completed", "cancelled"] }, note: { type: "string", maxLength: 10_000 }, expected_version: { type: "integer", minimum: 1 } }, ["task_id", "agent_id", "status", "expected_version"]), ["task:write", "core:govern"], false, true),

  tool("agent_heartbeat", "Register agent heartbeat", "Register or refresh an agent identity inside the authenticated tenant.", object({ agent_id: identifier, display_name: { type: "string", maxLength: 120 }, capabilities: { type: "array", maxItems: 20, items: identifier } }, ["agent_id"]), ["agent:coordinate", "core:govern"], false, true),
  tool("agent_list", "List tenant agents", "List registered agents and their last heartbeat in the authenticated tenant.", object(), ["agent:coordinate"]),
  tool("message_post", "Post agent message", "Post a tenant-scoped message from a registered agent to another agent or all agents.", object({ from_agent_id: identifier, to_agent_id: { anyOf: [identifier, { const: "all" }] }, body: text(20_000), thread_id: { type: "string", maxLength: 80 }, idempotency_key: { type: "string", maxLength: 120 } }, ["from_agent_id", "body"]), ["agent:coordinate", "core:govern"], false, true),
  tool("message_inbox", "Read agent inbox", "Read tenant-scoped messages addressed to one agent or all agents.", object({ agent_id: identifier, unread_only: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["agent_id"]), ["agent:coordinate"]),
  tool("message_acknowledge", "Acknowledge agent message", "Mark one tenant-scoped agent message as read.", object({ message_id: text(80), agent_id: identifier }, ["message_id", "agent_id"]), ["agent:coordinate", "core:govern"], false, true)
];

function annotations(readOnly) {
  return { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false, idempotentHint: true };
}

const presence = {
  agent_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" },
  client_type: { type: "string", enum: ["chatgpt", "codex", "api_agent", "other"] },
  session_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" },
};
const owner = {
  owner_confirmed: { type: "boolean", description: "Set true only after the tenant owner confirms this exact feature activation." },
  confirmation_reference: { type: "string", maxLength: 240 },
};
const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const uuid = { type: "string", format: "uuid" };
const identifier = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,159}$" };

function tool(name, title, description, inputSchema, { readOnly = true, ownerRequired = false, bounded = false } = {}) {
  return {
    name, title, description,
    inputSchema: {
      ...inputSchema,
      properties: { ...inputSchema.properties, ...presence, ...(ownerRequired ? owner : {}) },
    },
    scopes: [readOnly ? "core:read" : "core:govern"],
    annotations: annotations(readOnly),
    ...(!readOnly ? { _meta: {
      "skinharmony/ownerConfirmationRequired": ownerRequired,
      ...(bounded ? { "skinharmony/tenantBoundedCollaboration": true } : {}),
    } } : {}),
  };
}

export const NYRA_AUTOPILOT_TOOLS = [
  tool("nyra_autopilot_status", "Read Nyra Autopilot status",
    "Read the authenticated tenant's Nyra Autopilot configuration and its fixed zero-privilege limits.", object()),
  tool("nyra_autopilot_work_read", "Read a Nyra Autopilot Work",
    "Read one tenant-scoped Nyra plan, materialized specialists and assignment states. It never exposes provider credentials or grants execution.",
    object({ work_id: uuid }, ["work_id"])),
  tool("nyra_work_assignment_inbox", "Read claimable Nyra assignments",
    "List only the authenticated connected AI's tenant-scoped, zero-privilege assignment offers. An offer is not an executed task.",
    object({ work_id: uuid })),
  tool("nyra_autopilot_enable", "Enable Nyra Autopilot for this tenant",
    "Owner-gated activation of automatic governed Work planning. Never enables credentials or external actions.",
    object({ idempotency_key: identifier }, ["idempotency_key"]), { readOnly: false, ownerRequired: true }),
  tool("nyra_autopilot_reconcile", "Recover or plan a Nyra Work",
    "Owner recovery command for one existing Work. Normal Work creation and Work changes invoke the same process automatically.",
    object({ work_id: uuid, project_id: identifier }, ["work_id"]), { readOnly: false, ownerRequired: true }),
  tool("nyra_work_assignment_claim", "Claim a bounded Nyra assignment",
    "Claim one ready assignment with transport-bound AI presence.",
    object({ work_id: uuid, assignment_id: uuid, ttl_seconds: { type: "integer", minimum: 60, maximum: 3600 }, idempotency_key: identifier }, ["work_id", "assignment_id", "idempotency_key"]),
    { readOnly: false, bounded: true }),
  tool("nyra_work_assignment_submit", "Submit bounded Nyra assignment evidence",
    "Submit bounded evidence for one claimed assignment.",
    object({ work_id: uuid, assignment_id: uuid, result: { type: "object", additionalProperties: true }, idempotency_key: identifier }, ["work_id", "assignment_id", "result", "idempotency_key"]),
    { readOnly: false, bounded: true }),
];

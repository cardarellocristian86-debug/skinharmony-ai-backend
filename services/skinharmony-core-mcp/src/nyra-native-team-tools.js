function annotations(readOnly) {
  return { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false, idempotentHint: true };
}

const ownerProperties = {
  owner_confirmed: { type: "boolean", description: "Set true only after the owner confirms this exact write." },
  confirmation_reference: { type: "string", maxLength: 240 },
};
const presence = {
  agent_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" },
  client_type: { type: "string", enum: ["chatgpt", "codex", "api_agent", "other"] },
  session_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" },
};
const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const identifier = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" };
const uuid = { type: "string", format: "uuid" };

function tool(name, title, description, inputSchema, readOnly) {
  return {
    name,
    title,
    description,
    inputSchema: {
      ...inputSchema,
      properties: { ...inputSchema.properties, ...presence, ...(!readOnly ? ownerProperties : {}) },
    },
    scopes: [readOnly ? "core:read" : "core:govern"],
    annotations: annotations(readOnly),
    ...(!readOnly ? { _meta: { "skinharmony/ownerConfirmationRequired": true } } : {}),
  };
}

export const NYRA_NATIVE_TEAM_TOOLS = [
  tool("nyra_native_team_blueprints", "Read Nyra Native Team blueprints",
    "Read the six proprietary Nyra specialist blueprints. They are templates only and never create live privileges.", object(), true),
  tool("nyra_native_team_status", "Read Nyra Native Team status",
    "Read the authenticated tenant's Nyra Native Team package state and, when supplied, the six scoped instances for one work.",
    object({ work_id: uuid, project_id: identifier }), true),
  tool("nyra_native_team_enable", "Enable Nyra Native Team",
    "Enable the tenant-scoped Nyra Native Team package in disabled execution mode. It grants no model calls, tools, deploy, merge, credentials or external action.",
    object({ idempotency_key: identifier }, ["idempotency_key"]), false),
  tool("nyra_native_team_bootstrap", "Create the default Nyra team for one work",
    "Materialize exactly six Nyra-owned specialist instances only inside one authenticated tenant/project/work. Every instance starts without tools, model execution or external authority.",
    object({ work_id: uuid, project_id: identifier, idempotency_key: identifier }, ["work_id", "project_id", "idempotency_key"]), false),
];

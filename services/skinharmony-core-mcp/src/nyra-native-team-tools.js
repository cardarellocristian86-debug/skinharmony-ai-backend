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
const hostType = { type: "string", enum: ["chatgpt_native", "codex_native"] };
const manifest = { type: "object", additionalProperties: true };

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
  tool("nyra_native_agent_create", "Create a governed Nyra agent",
    "Create one named, Work-scoped agent from a standard Nyra blueprint. It starts disabled with no tools, credentials or external authority; activation is a separate owner-gated host launch request.",
    object({ work_id: uuid, project_id: identifier, agent_name: { type: "string", minLength: 3, maxLength: 120 }, role: { type: "string", minLength: 3, maxLength: 120 }, objective: { type: "string", minLength: 8, maxLength: 4_000 }, blueprint_id: identifier, idempotency_key: identifier }, ["work_id", "project_id", "agent_name", "role", "objective", "blueprint_id", "idempotency_key"]), false),
  tool("nyra_native_agent_activate", "Request connected-AI activation",
    "Create a tenant-, Work- and agent-bound launch request for one connected ChatGPT or Codex native agent. The server never invokes a model: the authenticated host must materialize a distinct child session and report through the existing native-plan evidence path.",
    object({ work_id: uuid, agent_instance_id: uuid, host_type: hostType, idempotency_key: identifier }, ["work_id", "agent_instance_id", "host_type", "idempotency_key"]), false),
  tool("nyra_agent_factory_catalog", "Read horizontal Agent Factory catalog", "Read reusable vertical capabilities and standard horizontal domains. This never creates an agent or invokes an AI.", object(), true),
  tool("nyra_agent_factory_plan", "Compile Agent Factory manifest", "Compile a readable agent manifest into a deterministic reuse plan. Missing capabilities are identified; this never writes code or creates an agent.", object({ manifest }, ["manifest"]), true),
  tool("nyra_agent_factory_create", "Create agent from manifest", "Create a Work-scoped independent agent from a validated manifest using existing vertical capabilities. It creates no new vertical code when required capabilities are missing and starts disabled.", object({ work_id: uuid, project_id: identifier, manifest, idempotency_key: identifier }, ["work_id", "project_id", "manifest", "idempotency_key"]), false),
];

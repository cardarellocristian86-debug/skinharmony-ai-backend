import crypto from "node:crypto";

import { requireScopes } from "./auth.js";
import { validateToolArguments } from "./schema-validation.js";

export const COMPACT_MCP_TOOL_NAMES = Object.freeze([
  "core_health",
  "work_preflight",
  "core_capability_catalog",
  "core_branch_registry",
  "core_semantic_select",
  "core_capability_read",
  "core_capability_invoke",
  "tenant_provider_openai_status",
  "tenant_provider_openai_setup_panel",
  "tenant_provider_openai_setup_link",
  "tenant_provider_openai_multi_agent_smoke_run",
  "tenant_provider_openai_multi_agent_run_read",
  "tenant_provider_openai_multi_agent_run_cancel",
]);

const DIRECT_ONLY = new Set(COMPACT_MCP_TOOL_NAMES);
const FORBIDDEN_DYNAMIC_TOOLS = new Set([
  "core_gate_action",
  "tenant_provider_openai_setup_link",
  "tenant_provider_openai_setup_panel",
  "tenant_provider_openai_multi_agent_smoke_run",
  "tenant_provider_openai_multi_agent_run_read",
  "tenant_provider_openai_multi_agent_run_cancel",
]);
const FORBIDDEN_ARGUMENT_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "tenant_id",
  "authenticated_tenant_id",
  "owner_context",
  "authorization",
  "api_key",
  "client_secret",
]);
const CAPABILITY_ID = /^[a-z][a-z0-9_]{1,95}$/;
const CATALOG_VERSION = "core_dynamic_capabilities_v1";

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function sha256(value) {
  return crypto.createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(stableCanonical(value)),
  ).digest("hex");
}

function capabilityGroup(name) {
  const prefixes = [
    ["orchestration_dtt_", "orchestration"],
    ["generic_agent_", "agents"],
    ["tenant_provider_", "provider"],
    ["nyra_research_", "research"],
    ["nyra_", "nyra"],
    ["core_", "core"],
    ["suite_", "suite"],
    ["memory_", "memory"],
    ["workspace_", "workspace"],
    ["task_", "workspace"],
    ["agent_", "workspace"],
    ["message_", "workspace"],
    ["scalp_", "analyzer"],
    ["skin_", "analyzer"],
  ];
  return prefixes.find(([prefix]) => name.startsWith(prefix))?.[1] || "intelligence";
}

function assertBoundedSafeArguments(value, path = "$", state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 2_000) throw new Error("dynamic_capability_arguments_too_large");
  if (depth > 12) throw new Error("dynamic_capability_arguments_too_deep");
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new Error("dynamic_capability_arguments_too_large");
    value.forEach((item, index) => assertBoundedSafeArguments(item, `${path}[${index}]`, state, depth + 1));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_ARGUMENT_KEYS.has(key.toLowerCase())) {
      const error = new Error("dynamic_capability_reserved_argument");
      error.argumentPath = `${path}.${key}`;
      throw error;
    }
    assertBoundedSafeArguments(item, `${path}.${key}`, state, depth + 1);
  }
}

function dynamicToolDefinitions(tools, handlers) {
  return tools.filter((tool) =>
    typeof handlers[tool.name] === "function" &&
    CAPABILITY_ID.test(tool.name) &&
    !DIRECT_ONLY.has(tool.name) &&
    !FORBIDDEN_DYNAMIC_TOOLS.has(tool.name),
  );
}

function summary(tool) {
  const readOnly = tool.annotations?.readOnlyHint === true;
  return {
    capability_id: tool.name,
    group: capabilityGroup(tool.name),
    title: tool.title,
    description: String(tool.description || "").slice(0, 1_000),
    access_mode: readOnly ? "read" : "invoke",
    read_only: readOnly,
    destructive: tool.annotations?.destructiveHint === true,
    idempotent: tool.annotations?.idempotentHint === true,
    open_world: tool.annotations?.openWorldHint === true,
    required_scopes: [...(tool.scopes || [])],
    owner_confirmation_required: tool._meta?.["skinharmony/ownerConfirmationRequired"] === true,
    schema_hash: sha256(tool.inputSchema || {}),
  };
}

function catalogState(tools, handlers) {
  const definitions = dynamicToolDefinitions(tools, handlers);
  const summaries = definitions.map(summary).sort((left, right) =>
    left.capability_id.localeCompare(right.capability_id),
  );
  return {
    definitions,
    summaries,
    revision: sha256(summaries),
  };
}

function textResult(payload) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

function exactCapability(tools, handlers, capabilityId) {
  if (!CAPABILITY_ID.test(String(capabilityId || ""))) throw new Error("dynamic_capability_id_invalid");
  const tool = dynamicToolDefinitions(tools, handlers).find((item) => item.name === capabilityId);
  if (!tool) throw new Error("dynamic_capability_unavailable");
  return tool;
}

function assertRevision(expected, actual) {
  if (!/^[a-f0-9]{64}$/.test(String(expected || "")) || expected !== actual) {
    throw new Error("dynamic_capability_catalog_revision_mismatch");
  }
}

function targetArguments(tool, wrapperArgs) {
  const args = { ...(wrapperArgs.arguments || {}) };
  const ownerConfirmationRequired =
    tool._meta?.["skinharmony/ownerConfirmationRequired"] === true;
  if (tool.annotations?.readOnlyHint !== true && ownerConfirmationRequired) {
    const properties = tool.inputSchema?.properties || {};
    if (!Object.prototype.hasOwnProperty.call(properties, "owner_confirmed")) {
      throw new Error("dynamic_capability_owner_schema_invalid");
    }
    args.owner_confirmed = wrapperArgs.owner_confirmed === true;
    if (
      wrapperArgs.confirmation_reference &&
      Object.prototype.hasOwnProperty.call(properties, "confirmation_reference")
    ) {
      args.confirmation_reference = wrapperArgs.confirmation_reference;
    }
  }
  assertBoundedSafeArguments(args);
  const errors = validateToolArguments(tool.inputSchema, args);
  if (errors.length) {
    const error = new Error("dynamic_capability_arguments_invalid");
    error.violations = errors.slice(0, 20);
    throw error;
  }
  return args;
}

function authorizationAllowed(result) {
  const payload = result?.structuredContent || {};
  const authorization = payload.authorization || {};
  const contract = payload.decision_contract || payload.verdict?.decision_contract || payload.verdict || payload;
  const state = String(authorization.state || contract.state || contract.decision || "").toLowerCase();
  const mediation = String(authorization.mediation || contract.action_mediation?.state || contract.mediation || "").toLowerCase();
  if (payload.authorization) return authorization.allowed === true;
  return ["allow", "allowed", "allow_controlled", "allow_advisory"].includes(state) || mediation === "allow";
}

export function createDynamicCapabilityHandlers({
  tools,
  handlers,
  semanticSelect,
  gateAction,
}) {
  if (!Array.isArray(tools) || !handlers || typeof handlers !== "object") {
    throw new Error("dynamic_capability_router_invalid");
  }

  return {
    core_capability_catalog: async (args, identity) => {
      const state = catalogState(tools, handlers);
      if (args.capability_id) {
        const tool = exactCapability(tools, handlers, args.capability_id);
        const item = summary(tool);
        return textResult({
          ok: true,
          schema_version: CATALOG_VERSION,
          tenant_id: identity.tenantId,
          catalog_revision: state.revision,
          capability: {
            ...item,
            ...(args.include_schema === true ? { input_schema: tool.inputSchema } : {}),
          },
          arbitrary_route_invocation_allowed: false,
          execution_authorized: false,
        });
      }
      const group = String(args.group || "");
      const filtered = group
        ? state.summaries.filter((item) => item.group === group)
        : state.summaries;
      const start = Math.max(0, Number.parseInt(String(args.cursor || "0"), 10) || 0);
      const limit = Math.min(Math.max(Number(args.limit || 25), 1), 100);
      const capabilities = filtered.slice(start, start + limit);
      const next = start + capabilities.length;
      return textResult({
        ok: true,
        schema_version: CATALOG_VERSION,
        tenant_id: identity.tenantId,
        catalog_revision: state.revision,
        capabilities,
        groups: [...new Set(state.summaries.map((item) => item.group))].sort(),
        total: filtered.length,
        next_cursor: next < filtered.length ? String(next) : null,
        arbitrary_route_invocation_allowed: false,
        execution_authorized: false,
      });
    },

    core_semantic_select: async (args, identity) => {
      if (Array.isArray(args.candidates) && args.candidates.length) {
        return semanticSelect(args, identity);
      }
      const query = String(args.query || "").trim();
      if (!query) throw new Error("dynamic_capability_query_required");
      const state = catalogState(tools, handlers);
      const allowedIds = new Set(
        Array.isArray(args.capability_ids) && args.capability_ids.length
          ? args.capability_ids
          : state.summaries.map((item) => item.capability_id),
      );
      const candidates = state.summaries
        .filter((item) => allowedIds.has(item.capability_id))
        .slice(0, 500)
        .map((item) => ({
          id: item.capability_id,
          text: `${item.title}. ${item.description}`,
          group: item.group,
        }));
      if (!candidates.length) throw new Error("dynamic_capability_candidates_empty");
      const result = await semanticSelect({
        candidates,
        intent: query,
        limit: Math.min(Math.max(Number(args.limit || 5), 1), 20),
        target_language: args.target_language,
        adapter: "core_dynamic_capability_catalog",
      }, identity);
      return {
        ...result,
        structuredContent: {
          ...(result.structuredContent || {}),
          tenant_id: identity.tenantId,
          catalog_revision: state.revision,
          candidate_capability_ids: candidates.map((item) => item.id),
          execution_authorized: false,
        },
      };
    },

    core_capability_read: async (args, identity) => {
      const state = catalogState(tools, handlers);
      assertRevision(args.catalog_revision, state.revision);
      const tool = exactCapability(tools, handlers, args.capability_id);
      if (tool.annotations?.readOnlyHint !== true) throw new Error("dynamic_capability_read_only_required");
      requireScopes(identity, tool.scopes || []);
      const callArgs = targetArguments(tool, args);
      const result = await handlers[tool.name](callArgs, identity);
      return {
        ...result,
        structuredContent: {
          ...(result.structuredContent || {}),
          dynamic_capability: {
            capability_id: tool.name,
            catalog_revision: state.revision,
            access_mode: "read",
          },
        },
      };
    },

    core_capability_invoke: async (args, identity) => {
      const state = catalogState(tools, handlers);
      assertRevision(args.catalog_revision, state.revision);
      const tool = exactCapability(tools, handlers, args.capability_id);
      if (tool.annotations?.readOnlyHint === true) throw new Error("dynamic_capability_mutation_required");
      requireScopes(identity, tool.scopes || []);
      if (args.owner_confirmed !== true || identity.ownerConfirmed !== true) {
        throw new Error("owner_confirmation_required");
      }
      if (!String(args.idempotency_key || "").trim()) throw new Error("idempotency_key_required");
      const callArgs = targetArguments(tool, args);
      if (typeof gateAction !== "function") throw new Error("dynamic_capability_gate_unavailable");
      const gate = await gateAction({
        tool,
        args: callArgs,
        identity,
        catalogRevision: state.revision,
        idempotencyKey: args.idempotency_key,
      });
      if (!authorizationAllowed(gate)) throw new Error("dynamic_capability_not_authorized");
      const result = await handlers[tool.name](callArgs, identity);
      return {
        ...result,
        structuredContent: {
          ...(result.structuredContent || {}),
          dynamic_capability: {
            capability_id: tool.name,
            catalog_revision: state.revision,
            access_mode: "invoke",
            gate_allowed: true,
            idempotency_key: args.idempotency_key,
          },
        },
      };
    },
  };
}

export function compactMcpTools(tools, handlers) {
  return COMPACT_MCP_TOOL_NAMES
    .map((name) => tools.find((tool) => tool.name === name))
    .filter((tool) => tool && typeof handlers[tool.name] === "function");
}

export function dynamicCapabilityCatalogSnapshot(tools, handlers) {
  const state = catalogState(tools, handlers);
  return {
    schema_version: CATALOG_VERSION,
    catalog_revision: state.revision,
    capabilities: state.summaries,
  };
}

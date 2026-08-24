import crypto from "node:crypto";

import { requireScopes } from "./auth.js";
import { validateToolArguments } from "./schema-validation.js";

export const COMPACT_MCP_TOOL_NAMES = Object.freeze([
  "core_health",
  // Conversational resume is a first-class Nyra entrypoint. Hiding it behind
  // capability discovery made a new chat spend an avoidable read/tool turn
  // before it could receive its persisted Work briefing.
  "nyra_converse",
  "core_capability_catalog",
  "core_branch_registry",
  "core_semantic_select",
  "core_capability_read",
  "core_capability_invoke",
  "nyra_policy_registry_activate",
  "nyra_policy_registry_rollback",
  "nyra_policy_registry_reconcile",
]);

// The generic preflight is an internal protocol step: normal action dispatch
// and `nyra_converse` invoke it server-side. Advertising it as a ChatGPT tool
// led the host to turn a simple “Nyra, riprendi il Work” into a manual
// preflight/catalogue sequence. Keep it registered for server-side callers,
// but never make it a model-selectable compact or dynamic capability.
export const INTERNAL_ONLY_TOOL_NAMES = new Set([
  "work_preflight",
]);

// `nyra_converse` is directly advertised to avoid discovery on a new chat,
// while remaining catalog-addressable for already-connected hosts that still
// use the backwards-compatible core_capability_read route.
const DIRECT_ONLY = new Set([
  ...COMPACT_MCP_TOOL_NAMES.filter((name) => name !== "nyra_converse"),
  ...INTERNAL_ONLY_TOOL_NAMES,
]);
const FORBIDDEN_DYNAMIC_TOOLS = new Set([
  "core_gate_action",
]);
const SYSTEM_ASSIGNED_CAPABILITIES = new Set([
  "nyra_work_automation_ci_verify",
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
  "work_preflight",
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
  // The persistent self-model is Nyra introspection, not a general
  // conversational operation. A dedicated group lets a narrow ChatGPT
  // capability lookup discover precisely this read-only surface without
  // reopening the rest of Nyra's implementation catalog.
  if (name === "nyra_self_model") return "self_model";
  const prefixes = [
    ["work_continuity_", "continuity"],
    ["host_native_", "continuity"],
    ["orchestration_dtt_", "orchestration"],
    ["generic_agent_", "agents"],
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

function assertBoundedSafeArguments(
  value,
  path = "$",
  state = { nodes: 0 },
  depth = 0,
  capabilityId = "",
) {
  state.nodes += 1;
  if (state.nodes > 2_000) throw new Error("dynamic_capability_arguments_too_large");
  if (depth > 12) throw new Error("dynamic_capability_arguments_too_deep");
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new Error("dynamic_capability_arguments_too_large");
    value.forEach((item, index) => assertBoundedSafeArguments(
      item,
      `${path}[${index}]`,
      state,
      depth + 1,
      capabilityId,
    ));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const releaseManifestTenant =
      capabilityId === "host_native_action_authorize" &&
      path === "$.release_manifest" &&
      key === "tenant_id";
    const nyraVerifiedEvidenceTenant = key === "tenant_id" && (
      (capabilityId === "nyra_work_automation_push_record" && path === "$.action_receipt") ||
      (capabilityId === "nyra_work_automation_core_join_record" && path === "$.core_join") ||
      (capabilityId === "nyra_work_automation_reconcile" && path === "$.action_receipt")
    );
    const signedPresenceRecoveryTenant =
      capabilityId === "agent_heartbeat" &&
      path === "$.recovery_context.envelope" &&
      key === "tenant_id";
    if (FORBIDDEN_ARGUMENT_KEYS.has(key.toLowerCase()) && !releaseManifestTenant &&
        !nyraVerifiedEvidenceTenant && !signedPresenceRecoveryTenant) {
      const error = new Error("dynamic_capability_reserved_argument");
      error.argumentPath = `${path}.${key}`;
      throw error;
    }
    assertBoundedSafeArguments(item, `${path}.${key}`, state, depth + 1, capabilityId);
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
    dedicated_core_gate: tool._meta?.["skinharmony/dedicatedCoreGate"] === true,
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

function targetArguments(tool, wrapperArgs, identity = {}) {
  assertSystemAssignedCapability(tool, wrapperArgs);
  const args = { ...(wrapperArgs.arguments || {}) };
  if (tool._meta?.["skinharmony/tenantBoundedCollaboration"] === true) {
    const presence = identity.agentPresence || {};
    args.agent_id = presence.agent_id;
    args.session_id = presence.session_id;
    args.client_type = presence.client_type;
  }
  if (
    tool.inputSchema?.properties?.idempotency_key &&
    args.idempotency_key === undefined &&
    wrapperArgs.idempotency_key
  ) {
    args.idempotency_key = wrapperArgs.idempotency_key;
  }
  const ownerConfirmationRequired =
    tool._meta?.["skinharmony/ownerConfirmationRequired"] === true;
  if (tool.annotations?.readOnlyHint !== true && ownerConfirmationRequired) {
    args.owner_confirmed = wrapperArgs.owner_confirmed === true;
    if (wrapperArgs.confirmation_reference) args.confirmation_reference = wrapperArgs.confirmation_reference;
  }
  // Validate caller-controlled arguments before attaching the server-issued
  // preflight envelope. The outer compact tool schema does not expose this
  // field, so clients cannot supply or alter it.
  assertBoundedSafeArguments(args, "$", { nodes: 0 }, 0, tool.name);
  if (
    tool.inputSchema?.properties?.work_preflight &&
    wrapperArgs.work_preflight &&
    typeof wrapperArgs.work_preflight === "object"
  ) args.work_preflight = wrapperArgs.work_preflight;
  const errors = validateToolArguments(tool.inputSchema, args);
  if (errors.length) {
    const error = new Error("dynamic_capability_arguments_invalid");
    error.violations = errors.slice(0, 20);
    throw error;
  }
  return args;
}

function ownerConfirmationRequiredForInvocation(tool, wrapperArgs) {
  const required = tool._meta?.["skinharmony/ownerConfirmationRequired"] === true;
  if (!required || tool.name !== "agent_heartbeat") return required;
  const targetArgs = wrapperArgs.arguments || {};
  const customDisplayName = String(targetArgs.display_name || "").trim().length > 0;
  const customCapabilities = targetArgs.capabilities !== undefined &&
    (!Array.isArray(targetArgs.capabilities) || targetArgs.capabilities.length > 0);
  return customDisplayName || customCapabilities;
}

function assertSystemAssignedCapability(tool, wrapperArgs) {
  if (!SYSTEM_ASSIGNED_CAPABILITIES.has(tool.name)) return;
  const args = wrapperArgs.arguments || {};
  if (Object.hasOwn(args, "verifier_agent_id") || Object.hasOwn(args, "system_assigned")) {
    throw new Error("dynamic_capability_system_assignment_reserved");
  }
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
  internallyGovernedCapabilities = [],
}) {
  if (!Array.isArray(tools) || !handlers || typeof handlers !== "object") {
    throw new Error("dynamic_capability_router_invalid");
  }
  if (!Array.isArray(internallyGovernedCapabilities) ||
      internallyGovernedCapabilities.some((name) => !CAPABILITY_ID.test(String(name || "")))) {
    throw new Error("dynamic_capability_internal_gate_configuration_invalid");
  }
  const internallyGoverned = new Set(internallyGovernedCapabilities);

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
      const callArgs = targetArguments(tool, args, identity);
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
      const ownerConfirmationRequired = ownerConfirmationRequiredForInvocation(tool, args);
      const dedicatedCoreGate =
        tool._meta?.["skinharmony/dedicatedCoreGate"] === true;
      const handlerOwnsCoreGate = internallyGoverned.has(tool.name);
      if (
        ownerConfirmationRequired &&
        (args.owner_confirmed !== true || identity.ownerConfirmed !== true)
      ) {
        throw new Error("owner_confirmation_required");
      }
      if (!String(args.idempotency_key || "").trim()) throw new Error("idempotency_key_required");
      const callArgs = targetArguments(tool, args, identity);
      if (!dedicatedCoreGate && !handlerOwnsCoreGate) {
        if (typeof gateAction !== "function") throw new Error("dynamic_capability_gate_unavailable");
        const gateTool = ownerConfirmationRequired
          ? tool
          : {
              ...tool,
              _meta: {
                ...(tool._meta || {}),
                "skinharmony/ownerConfirmationRequired": false,
              },
            };
        const gate = await gateAction({
          tool: gateTool,
          args: callArgs,
          // The public wrapper receives this only from createApp after it has
          // validated the server-issued Work Preflight. Bind that same
          // envelope to Core's dynamic-action gate even when the target tool
          // schema intentionally does not expose it to the target handler.
          workPreflight: args.work_preflight,
          identity,
          catalogRevision: state.revision,
          idempotencyKey: args.idempotency_key,
        });
        if (!authorizationAllowed(gate)) throw new Error("dynamic_capability_not_authorized");
      }
      const result = await handlers[tool.name](callArgs, identity);
      if (
        handlerOwnsCoreGate &&
        result?.structuredContent?.gate?.allowed !== true
      ) {
        throw new Error("dynamic_capability_internal_core_gate_unverified");
      }
      if (
        dedicatedCoreGate &&
        result?.structuredContent?.dedicated_core_gate?.authorized !== true
      ) {
        throw new Error("dynamic_capability_dedicated_core_gate_unverified");
      }
      return {
        ...result,
        structuredContent: {
          ...(result.structuredContent || {}),
          dynamic_capability: {
            capability_id: tool.name,
            catalog_revision: state.revision,
            access_mode: "invoke",
            gate_allowed: true,
            gate_source: dedicatedCoreGate
              ? "universal_core_dedicated_route"
              : handlerOwnsCoreGate
                ? "handler_internal_core_gate"
                : "universal_core_action_evaluator",
            owner_confirmation_required: ownerConfirmationRequired,
            owner_confirmation_satisfied:
              ownerConfirmationRequired === false || identity.ownerConfirmed === true,
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

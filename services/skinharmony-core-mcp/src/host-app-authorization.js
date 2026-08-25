import {
  HOST_APP_CAPABILITIES,
  authenticatedHostKind,
} from "./host-app-registry.js";

export const SUPPORTED_HOST_NATIVE_KINDS = Object.freeze(new Set([
  "chatgpt_native",
  "codex_native",
]));

const WORK_CREATE_TOOLS = new Set([
  "work_continuity_create",
  "work_continuity_v2_create",
  "tenant_work_open_review",
]);

const WORK_REVIEW_TOOLS = new Set([
  "tenant_work_evidence_record",
]);

const WORK_COORDINATION_TOOLS = new Set([
  "work_continuity_start_or_resume",
  "tenant_work_gallery_join",
  "tenant_work_gallery_heartbeat",
  "tenant_work_branch_open",
  "tenant_work_lease_acquire",
  "tenant_work_lease_renew",
  "tenant_work_lease_release",
  "tenant_work_message_post",
  // Assignment children remain bounded coordination: their lease/capability
  // checks are handler-owned and they never inherit general Work operate.
  "nyra_work_assignment_claim",
  "nyra_work_assignment_submit",
]);

const HOST_META_READ_TOOLS = new Set([
  "core_health",
  "core_capability_catalog",
]);

const CORE_COORDINATION_TOOLS = new Set([
  // Presence is required to enter the bounded Work fabric. It is not a grant
  // to mutate arbitrary tenant state and therefore follows work.coordinate.
  "agent_heartbeat",
]);

const CORE_ADMIN_TOOLS = new Set([
  "nyra_policy_registry_activate",
  "nyra_policy_registry_rollback",
  "nyra_policy_registry_reconcile",
]);

const HOST_NATIVE_DELEGATION_TOOLS = new Set([
  "host_native_work_plan_create",
  "host_native_standing_release_mandate_install",
  "host_native_standing_release_mandate_revoke",
  "host_native_standing_release_delegation_derive",
  "host_native_delegation_issue",
  "host_native_delegation_revoke",
  "work_continuity_native_plan",
  "work_continuity_native_bind",
]);

const HOST_NATIVE_OPERATE_TOOLS = new Set([
  "work_continuity_native_report",
  "work_continuity_closure_evaluate",
  "work_continuity_closure_finalize",
]);

const WORK_PREFIXES = Object.freeze([
  "work_continuity_",
  "tenant_work_",
  "nyra_work_",
  "nyra_native_team_",
  "nyra_autopilot_",
  "entity_360_",
  "software_cognition_",
]);

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = details.required_capability
    ? "host_app_capability_required"
    : code;
  if (details.required_capability) {
    error.required_capability = details.required_capability;
  }
  error.status = 403;
  throw error;
}

function principalHas(identity, capability, { registrationRequired = true } = {}) {
  const principal = identity?.authenticatedHostPrincipal;
  return Boolean(
    principal &&
    (!registrationRequired || principal.registered === true) &&
    Array.isArray(principal.capabilities) &&
    principal.capabilities.includes(capability)
  );
}

export function dynamicHostCapabilityTarget(toolName, args = {}) {
  const requested = String(toolName || "");
  if (["core_capability_read", "core_capability_invoke"].includes(requested)) {
    return String(args?.capability_id || "").trim() || requested;
  }
  return requested;
}

function toolDefinition(name, tools = []) {
  return Array.isArray(tools) ? tools.find((item) => item?.name === name) : null;
}

function workSurface(name) {
  return name === "work_preflight" || name === "nyra_converse" ||
    WORK_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function requiredHostAppCapabilityForTool(toolName, args = {}, tools = []) {
  const name = dynamicHostCapabilityTarget(toolName, args);
  if (name === "nyra_governed_continue") {
    return HOST_APP_CAPABILITIES.GOVERNED_CONTINUE;
  }
  if (name.startsWith("host_native_")) {
    if (HOST_NATIVE_DELEGATION_TOOLS.has(name)) {
      return HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE;
    }
    const definition = toolDefinition(name, tools);
    return definition?.annotations?.readOnlyHint === true
      ? HOST_APP_CAPABILITIES.WORK_READ
      : HOST_APP_CAPABILITIES.HOST_NATIVE_AUTHORIZE;
  }
  if (HOST_NATIVE_DELEGATION_TOOLS.has(name)) {
    return HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE;
  }
  if (HOST_NATIVE_OPERATE_TOOLS.has(name)) {
    return HOST_APP_CAPABILITIES.WORK_OPERATE;
  }
  if (WORK_CREATE_TOOLS.has(name)) return HOST_APP_CAPABILITIES.WORK_CREATE;
  if (WORK_REVIEW_TOOLS.has(name)) return HOST_APP_CAPABILITIES.WORK_REVIEW;
  if (WORK_COORDINATION_TOOLS.has(name)) return HOST_APP_CAPABILITIES.WORK_COORDINATE;
  if (CORE_COORDINATION_TOOLS.has(name)) return HOST_APP_CAPABILITIES.WORK_COORDINATE;
  if (HOST_META_READ_TOOLS.has(name)) return null;
  if (!workSurface(name)) {
    const definition = toolDefinition(name, tools);
    if (CORE_ADMIN_TOOLS.has(name)) return HOST_APP_CAPABILITIES.CORE_ADMIN;
    // A registered app grant is an upper bound independent of OAuth/Core
    // scopes. Every exact non-Work target is therefore classified; unknown or
    // mutating targets fail into core.operate instead of null=allow.
    return definition?.annotations?.readOnlyHint === true
      ? HOST_APP_CAPABILITIES.CORE_READ
      : HOST_APP_CAPABILITIES.CORE_OPERATE;
  }
  const definition = toolDefinition(name, tools);
  return definition?.annotations?.readOnlyHint === true ||
    ["work_preflight", "nyra_converse"].includes(name)
    ? HOST_APP_CAPABILITIES.WORK_READ
    : HOST_APP_CAPABILITIES.WORK_OPERATE;
}

function isNativeSurface(name) {
  return name.startsWith("host_native_") ||
    HOST_NATIVE_DELEGATION_TOOLS.has(name) ||
    HOST_NATIVE_OPERATE_TOOLS.has(name);
}

export function requireHostAppToolCapability({
  identity,
  toolName,
  args = {},
  tools = [],
} = {}) {
  // Direct internal callers predate the public host-principal envelope. Every
  // public MCP request receives it in the authenticated identity layer.
  if (!identity?.authenticatedHostPrincipal) return null;
  const target = dynamicHostCapabilityTarget(toolName, args);
  const required = requiredHostAppCapabilityForTool(toolName, args, tools);
  if (!required) return null;
  const requiredCapabilities = [required];
  const governedOperationCapability = target === "nyra_governed_continue"
    ? {
        review_work_bootstrap: HOST_APP_CAPABILITIES.WORK_CREATE,
        create_work: HOST_APP_CAPABILITIES.WORK_CREATE,
        issue_delegation: HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE,
        authorize_action: HOST_APP_CAPABILITIES.HOST_NATIVE_AUTHORIZE,
      }[String(args?.operation || "")]
    : null;
  if (governedOperationCapability) requiredCapabilities.push(governedOperationCapability);
  for (const capability of [...new Set(requiredCapabilities)]) {
    const readCompatibility = capability === HOST_APP_CAPABILITIES.WORK_READ;
    if (!principalHas(identity, capability, { registrationRequired: !readCompatibility })) {
      fail(`host_app_capability_required:${capability}`, { required_capability: capability });
    }
  }
  const governedNativeOperation = [
    HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE,
    HOST_APP_CAPABILITIES.HOST_NATIVE_AUTHORIZE,
  ].includes(governedOperationCapability);
  if (isNativeSurface(target) || governedNativeOperation) {
    let hostKind;
    try {
      hostKind = authenticatedHostKind(identity);
    } catch {
      fail("registered_host_principal_required");
    }
    if (!SUPPORTED_HOST_NATIVE_KINDS.has(hostKind)) {
      fail("host_native_host_kind_not_supported");
    }
  }
  return Object.freeze({
    target_tool: target,
    required_capability: required,
    required_capabilities: Object.freeze([...new Set(requiredCapabilities)]),
  });
}

export function hostAppCanAccessTool({ identity, toolName, tools = [] } = {}) {
  try {
    requireHostAppToolCapability({ identity, toolName, tools });
    return true;
  } catch {
    return false;
  }
}

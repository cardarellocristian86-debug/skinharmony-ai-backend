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
  "tenant_work_queue_create_v3",
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
  "nyra_control_room_status",
  "core_capability_catalog",
]);

// This is a transport compatibility allowlist, not a general Core grant. It
// permits a verified, tenant-bound, unregistered ChatGPT OAuth principal to
// reach only the read entrypoints needed to resume governed Work operations.
export const CHATGPT_GOVERNED_READ_TOOL_NAMES = Object.freeze(new Set([
  "core_health",
  "nyra_control_room_status",
  "work_preflight",
  "core_capability_catalog",
  "core_branch_registry",
  "core_semantic_select",
  "core_capability_read",
]));

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

const NATIVE_REPORT_CAPABILITY = "work_continuity_native_report";
const NATIVE_ACCEPTANCE_CONTRACT_READ_CAPABILITY =
  "work_continuity_native_acceptance_contract_read";
const NATIVE_ASSIGNMENT_CAPABILITY = /^hnac_[A-Za-z0-9_-]{43}$/;
const NATIVE_REPORT_WORK_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const NATIVE_REPORT_AGENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{1,119}$/;
const NATIVE_REPORT_HOST_TASK_ID = /^(?:\/[a-zA-Z0-9][a-zA-Z0-9_/-]{1,239}|[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,239})$/;

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

export function hasTenantBoundChatGptReadCompatibility(identity, toolName = "") {
  const principal = identity?.authenticatedHostPrincipal;
  const membership = identity?.authenticatedTenantMembership;
  return identity?.kind === "oauth" &&
    // The fixed governed-read allowlist is safe for a tenant-bound ChatGPT
    // principal whether the app is an OAuth compatibility principal or a
    // registered production host.  Requiring `registered === false` here
    // made a correctly registered ChatGPT lose health/catalog/registry reads
    // and route every stale descriptor to Nyra's conversational tool.
    // Registration is not authority by itself: the exact work.read grant,
    // authenticated membership and exact allowlist still all apply.
    (principal?.registered === false || principal?.registered === true) &&
    principal?.auth_kind === "oauth" &&
    principal?.client_type === "chatgpt" &&
    Array.isArray(principal?.capabilities) &&
    principal.capabilities.includes(HOST_APP_CAPABILITIES.WORK_READ) &&
    membership?.authenticated === true &&
    String(membership.tenant_id || "") === String(identity?.tenantId || "") &&
    String(membership.subject || "") === String(identity?.subject || "") &&
    CHATGPT_GOVERNED_READ_TOOL_NAMES.has(String(toolName || ""));
}

export function dynamicHostCapabilityTarget(toolName, args = {}) {
  const requested = String(toolName || "");
  if (["core_capability_read", "core_capability_invoke"].includes(requested)) {
    return String(args?.capability_id || "").trim() || requested;
  }
  return requested;
}

// A native child has no ambient Work grant: its authority is the one-task
// assignment capability verified again by the continuity runtime. This helper
// recognizes only an exact compact wrapper/capability pair and only the five
// immutable assignment coordinates. It never grants a direct route.
function nativeChildAssignmentBootstrap(toolName, args = {}, capabilityId, readOnly) {
  if (String(toolName || "") === "core_capability_catalog") {
    if (String(args?.capability_id || "") !== capabilityId) return null;
  } else if (
    String(toolName || "") === (readOnly ? "core_capability_read" : "core_capability_invoke") &&
    String(args?.capability_id || "") === capabilityId
  ) {
    args = args?.arguments;
  } else {
    return null;
  }
  const assignment = String(toolName || "") === "core_capability_catalog"
    ? args?.native_report_assignment
    : args;
  if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) return null;
  const workId = String(assignment.work_id || "").trim();
  const planId = String(assignment.plan_id || "").trim();
  const agentId = String(assignment.native_agent_id || "").trim();
  const hostTaskId = String(assignment.host_task_id || "").trim();
  const capability = String(assignment.assignment_capability || "").trim();
  if (
    !NATIVE_REPORT_WORK_ID.test(workId) ||
    !NATIVE_REPORT_WORK_ID.test(planId) ||
    !NATIVE_REPORT_AGENT_ID.test(agentId) ||
    !NATIVE_REPORT_HOST_TASK_ID.test(hostTaskId) ||
    hostTaskId.includes("..") ||
    !NATIVE_ASSIGNMENT_CAPABILITY.test(capability)
  ) return null;
  return Object.freeze({
    work_id: workId.toLowerCase(),
    plan_id: planId.toLowerCase(),
    native_agent_id: agentId,
    host_task_id: hostTaskId,
    assignment_capability: capability,
  });
}

export function nativeReportAssignmentBootstrap(toolName, args = {}) {
  return nativeChildAssignmentBootstrap(
    toolName,
    args,
    NATIVE_REPORT_CAPABILITY,
    false,
  );
}

export function nativeAcceptanceContractReadAssignmentBootstrap(toolName, args = {}) {
  return nativeChildAssignmentBootstrap(
    toolName,
    args,
    NATIVE_ACCEPTANCE_CONTRACT_READ_CAPABILITY,
    true,
  );
}

// This identifies the two compact bootstrap routes as well as the legacy
// direct report route for transport-presence handling. It is not an
// authorization decision: the server still requires the assignment admission
// above before either compact route receives its one-capability catalog view.
export function isNativeReportChildOperation(toolName, args = {}) {
  return String(toolName || "") === NATIVE_REPORT_CAPABILITY ||
    nativeReportAssignmentBootstrap(toolName, args) !== null;
}

export function isNativeAcceptanceContractReadChildOperation(toolName, args = {}) {
  return String(toolName || "") === NATIVE_ACCEPTANCE_CONTRACT_READ_CAPABILITY ||
    nativeAcceptanceContractReadAssignmentBootstrap(toolName, args) !== null;
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
  const targetArgs = name === String(toolName || "") ? args : args?.arguments;
  // The server admits this narrow bootstrap only after it has created a
  // transport-bound child presence and the continuity runtime has verified
  // the exact assignment, lease and HMAC capability. work.read is therefore
  // an app-level upper bound, never a substitute for that verification.
  if (
    nativeReportAssignmentBootstrap(toolName, args) ||
    nativeAcceptanceContractReadAssignmentBootstrap(toolName, args)
  ) {
    return HOST_APP_CAPABILITIES.WORK_READ;
  }
  // This is a tenant-wide configuration action, not a Work mutation.  Keep it
  // above the entity_360_ Work prefix so both direct and compact dynamic
  // invocation require the Core-wide grant.
  if (["entity_360_shadow_enable", "entity_360_shadow_disable", "nyra_autopilot_enable"]
    .includes(name)) {
    return HOST_APP_CAPABILITIES.CORE_OPERATE;
  }
  if (name === "nyra_continue") {
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
  // The health-only Control Room is safe as a metadata read, but supplying a
  // Work id adds tenant Work progress, blockers and next-task context to the
  // response. Keep the Host App Registry as an upper bound for both direct
  // and compact dynamic reads of that Work-bound projection.
  if (
    name === "nyra_control_room_status" &&
    targetArgs && typeof targetArgs === "object" &&
    Object.prototype.hasOwnProperty.call(targetArgs, "work_id")
  ) return HOST_APP_CAPABILITIES.WORK_READ;
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
  // The wrapper itself remains dynamically reauthorized below against its
  // exact target. Only direct allowlisted tools receive this compatibility;
  // it does not turn an unregistered OAuth principal into a Core reader.
  if (target === toolName && hasTenantBoundChatGptReadCompatibility(identity, toolName)) {
    return Object.freeze({
      target_tool: target,
      required_capability: HOST_APP_CAPABILITIES.WORK_READ,
      required_capabilities: Object.freeze([HOST_APP_CAPABILITIES.WORK_READ]),
    });
  }
  const required = requiredHostAppCapabilityForTool(toolName, args, tools);
  if (!required) return null;
  const requiredCapabilities = [required];
  const governedOperationCapability = target === "nyra_continue"
    ? {
        review_work_bootstrap: HOST_APP_CAPABILITIES.WORK_CREATE,
        create_work: HOST_APP_CAPABILITIES.WORK_CREATE,
        resume_existing_work: HOST_APP_CAPABILITIES.WORK_OPERATE,
        create_native_plan: HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE,
        bind_native_child: HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE,
        issue_delegation: HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE,
        authorize_action: HOST_APP_CAPABILITIES.HOST_NATIVE_AUTHORIZE,
      }[String(args?.operation || "")]
    : null;
  if (governedOperationCapability) requiredCapabilities.push(governedOperationCapability);
  for (const capability of [...new Set(requiredCapabilities)]) {
    // An unregistered OAuth compatibility principal is intentionally bounded
    // to work.read. Dynamic Core reads are reclassified above against the
    // exact capability_id, so a Core read, invoke or mutation cannot inherit
    // this narrow compatibility grant.
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

// Discovery must describe the request's real dispatch surface. A
// nyra_conversational host reaches mutations only through the direct signed
// continuation tool, so dynamic catalog entries for ordinary writes would be
// unusable. The sole exception is a native child admitted for this request:
// its transport-bound assignment narrows discovery to native_report only.
export function hostAppCanDiscoverDynamicCapability({ identity, tool, tools = [] } = {}) {
  if (identity?.nativeReportAdmission?.capability_id === NATIVE_REPORT_CAPABILITY) {
    return tool?.name === NATIVE_REPORT_CAPABILITY;
  }
  if (
    identity?.nativeAcceptanceContractReadAdmission?.capability_id ===
      NATIVE_ACCEPTANCE_CONTRACT_READ_CAPABILITY
  ) {
    return tool?.name === NATIVE_ACCEPTANCE_CONTRACT_READ_CAPABILITY;
  }
  if (identity?.authenticatedHostPrincipal?.interaction_mode === "nyra_conversational" &&
      tool?.annotations?.readOnlyHint !== true) {
    return false;
  }
  return hostAppCanAccessTool({ identity, toolName: tool?.name, tools });
}

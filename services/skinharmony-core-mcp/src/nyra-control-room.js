const CONTROL_ROOM_SCHEMA_VERSION = "nyra_control_room_status_v1";
const CONTROL_ROOM_DOMAIN_IDS = Object.freeze([
  "nyra_dialogue",
  "entity_360",
  "semantic_scope_guard",
  "work_continuity",
  "research_airlock",
  "policy_registry",
]);
const CONTROL_ROOM_ACTION_IDS = Object.freeze({
  nyra_dialogue: Object.freeze(["READ_STATUS", "REQUEST_CONFIGURATION_CHANGE"]),
  entity_360: Object.freeze(["READ_STATUS", "REQUEST_ENABLE_SHADOW", "REQUEST_DISABLE_SHADOW"]),
  semantic_scope_guard: Object.freeze(["READ_STATUS", "REQUEST_CONFIGURATION_CHANGE"]),
  work_continuity: Object.freeze(["READ_STATUS"]),
  research_airlock: Object.freeze(["READ_STATUS"]),
  policy_registry: Object.freeze(["READ_STATUS", "REQUEST_LIFECYCLE_ACTION"]),
});
const CONTROL_ROOM_ACTION_AVAILABILITY = new Set([
  "AVAILABLE", "REQUEST_ONLY", "EXISTING_GOVERNED_HANDLER", "UNAVAILABLE",
]);
const CONTROL_ROOM_ACTION_EXECUTION = new Set([
  "READ_ONLY", "DEPLOYMENT_CONFIGURATION", "REQUEST_BOUND_GOVERNED", "DEPLOYMENT_PREREQUISITE",
]);
const CONTROL_ROOM_PROGRESS_FORMULAS = new Set([
  "server_work_context_unavailable",
  "server_work_context_invalid",
  "(completed_required_tasks + verified_required_evidence + verified_closure) / (required_tasks + required_evidence + closure_gate)",
]);
const MODE = /^[A-Z][A-Z0-9_]{0,79}$/u;
const TOKEN = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/u;
const CODE = /^[a-z0-9][a-z0-9_.:-]{0,159}$/u;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,159}$/u;
const PUBLIC_TEXT = /^[^\u0000-\u001f\u007f]{1,500}$/u;

function readbackInvalid() {
  throw new Error("nyra_control_room_readback_invalid");
}

function requireExactObject(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) readbackInvalid();
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.includes(key)) ||
      requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    readbackInvalid();
  }
  return value;
}

function readbackMode(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!MODE.test(normalized)) readbackInvalid();
  return normalized;
}

function readbackToken(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!TOKEN.test(normalized)) readbackInvalid();
  return normalized;
}

function readbackCode(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!CODE.test(normalized)) readbackInvalid();
  return normalized;
}

function readbackBooleanOrNull(value) {
  if (typeof value !== "boolean" && value !== null) readbackInvalid();
  return value;
}

function normalizeReadbackAction(value, allowedIds) {
  const raw = requireExactObject(value, [
    "id", "availability", "execution", "requires_owner_confirmation",
    "requires_core_authorization", "restart_required", "handler",
  ]);
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const handler = raw.handler === null ? null : typeof raw.handler === "string" &&
    IDENTIFIER.test(raw.handler.trim()) ? raw.handler.trim() : null;
  if (!allowedIds.includes(id) || !CONTROL_ROOM_ACTION_AVAILABILITY.has(raw.availability) ||
      !CONTROL_ROOM_ACTION_EXECUTION.has(raw.execution) ||
      typeof raw.requires_owner_confirmation !== "boolean" ||
      typeof raw.requires_core_authorization !== "boolean" ||
      typeof raw.restart_required !== "boolean" ||
      (raw.handler !== null && handler === null)) readbackInvalid();
  return Object.freeze({
    id,
    availability: raw.availability,
    execution: raw.execution,
    requires_owner_confirmation: raw.requires_owner_confirmation,
    requires_core_authorization: raw.requires_core_authorization,
    restart_required: raw.restart_required,
    handler,
  });
}

function normalizeReadbackActions(value, domainId) {
  const allowedIds = CONTROL_ROOM_ACTION_IDS[domainId];
  if (!Array.isArray(value) || value.length !== allowedIds.length) readbackInvalid();
  const byId = new Map();
  for (const item of value) {
    const action = normalizeReadbackAction(item, allowedIds);
    if (byId.has(action.id)) readbackInvalid();
    byId.set(action.id, action);
  }
  if (allowedIds.some((id) => !byId.has(id))) readbackInvalid();
  return Object.freeze(allowedIds.map((id) => byId.get(id)));
}

function normalizeReadbackTask(value) {
  if (value === null) return null;
  const raw = requireExactObject(value, ["task_id", "title", "status", "acceptance_verified"], ["task_id", "title"]);
  const taskId = typeof raw.task_id === "string" ? raw.task_id.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const status = raw.status === undefined ? null : raw.status === null ? null : readbackToken(raw.status);
  if (!IDENTIFIER.test(taskId) || !PUBLIC_TEXT.test(title)) readbackInvalid();
  if (raw.acceptance_verified !== undefined && typeof raw.acceptance_verified !== "boolean") readbackInvalid();
  return Object.freeze({ task_id: taskId, title, status,
    acceptance_verified: raw.acceptance_verified === undefined ? null : raw.acceptance_verified });
}

function normalizeReadbackProgress(value) {
  const raw = requireExactObject(
    value,
    ["available", "percent", "formula", "blockers", "next_action", "closure_verified"],
    ["available", "percent", "formula", "blockers", "next_action"],
  );
  if (typeof raw.available !== "boolean" || !Number.isInteger(raw.percent) && raw.percent !== null ||
      raw.percent !== null && (raw.percent < 0 || raw.percent > 100) ||
      !CONTROL_ROOM_PROGRESS_FORMULAS.has(raw.formula) || !Array.isArray(raw.blockers) ||
      raw.blockers.length > 8) readbackInvalid();
  const blockers = raw.blockers.map((item) => {
    const blocker = requireExactObject(item, ["code", "count"]);
    if (!Number.isSafeInteger(blocker.count) || blocker.count < 1 || blocker.count > 100_000) {
      readbackInvalid();
    }
    return Object.freeze({ code: readbackCode(blocker.code), count: blocker.count });
  });
  const nextAction = normalizeReadbackTask(raw.next_action);
  const closureVerified = raw.closure_verified === undefined ? null : readbackBooleanOrNull(raw.closure_verified);
  if (!raw.available && (raw.percent !== null || raw.formula !== "server_work_context_unavailable" ||
      blockers.length !== 0 || nextAction !== null || closureVerified !== null)) readbackInvalid();
  if (raw.available && raw.formula === "server_work_context_unavailable") readbackInvalid();
  return Object.freeze({
    available: raw.available,
    percent: raw.percent,
    formula: raw.formula,
    blockers: Object.freeze(blockers),
    next_action: nextAction,
    closure_verified: closureVerified,
  });
}

function normalizeReadbackDetail(domainId, value) {
  const raw = value;
  switch (domainId) {
    case "nyra_dialogue": {
      const detail = requireExactObject(raw, ["transition_kind", "restart_required"]);
      if (detail.transition_kind !== "deployment_configuration" ||
          typeof detail.restart_required !== "boolean") readbackInvalid();
      return Object.freeze({ transition_kind: detail.transition_kind, restart_required: detail.restart_required });
    }
    case "entity_360": {
      const detail = requireExactObject(raw, [
        "bitemporal_mode", "deployment_ceiling", "ready", "shadow_transition_available",
        "shadow_transition_blocker", "shadow_disable_available", "shadow_disable_blocker",
      ]);
      const transitionBlocker = detail.shadow_transition_blocker === null ? null : readbackCode(detail.shadow_transition_blocker);
      const disableBlocker = detail.shadow_disable_blocker === null ? null : readbackCode(detail.shadow_disable_blocker);
      if (typeof detail.shadow_transition_available !== "boolean" ||
          typeof detail.shadow_disable_available !== "boolean") readbackInvalid();
      return Object.freeze({
        bitemporal_mode: readbackMode(detail.bitemporal_mode),
        deployment_ceiling: readbackMode(detail.deployment_ceiling),
        ready: readbackBooleanOrNull(detail.ready),
        shadow_transition_available: detail.shadow_transition_available,
        shadow_transition_blocker: transitionBlocker,
        shadow_disable_available: detail.shadow_disable_available,
        shadow_disable_blocker: disableBlocker,
      });
    }
    case "semantic_scope_guard": {
      const detail = requireExactObject(raw, ["configured", "transition_kind", "restart_required"]);
      if (detail.transition_kind !== "deployment_configuration" ||
          typeof detail.restart_required !== "boolean") readbackInvalid();
      return Object.freeze({
        configured: readbackBooleanOrNull(detail.configured),
        transition_kind: detail.transition_kind,
        restart_required: detail.restart_required,
      });
    }
    case "work_continuity": {
      const detail = requireExactObject(raw, ["backend", "progress", "coordination"], ["backend", "progress"]);
      const coordination = detail.coordination === undefined || detail.coordination === null ? null : normalizeCoordinationOverview(detail.coordination);
      return Object.freeze({ backend: readbackMode(detail.backend), progress: normalizeReadbackProgress(detail.progress), coordination });
    }
    case "research_airlock": {
      const detail = requireExactObject(raw, ["state", "operational_safe"]);
      return Object.freeze({ state: readbackMode(detail.state), operational_safe: readbackBooleanOrNull(detail.operational_safe) });
    }
    case "policy_registry": {
      const detail = requireExactObject(raw, ["state", "enforcement"]);
      return Object.freeze({ state: readbackMode(detail.state), enforcement: readbackMode(detail.enforcement) });
    }
    default:
      return readbackInvalid();
  }
}

function normalizeCoordinationOverview(value) {
  const raw = requireExactObject(value, ["available", "active_session_count", "active_logical_agent_count", "sessions"]);
  if (typeof raw.available !== "boolean" || !Number.isSafeInteger(raw.active_session_count) ||
      !Number.isSafeInteger(raw.active_logical_agent_count) || !Array.isArray(raw.sessions) || raw.sessions.length > 100 ||
      raw.active_session_count !== raw.sessions.length || raw.active_logical_agent_count > raw.active_session_count) readbackInvalid();
  const sessions = raw.sessions.map((item) => {
    const session = requireExactObject(item, ["session_id", "agent_id", "client_type", "transport_bound", "state", "joined_at", "last_heartbeat_at", "presence_expires_at", "active_lease_count", "work_memberships_truncated", "work_memberships"]);
    if (!["chatgpt", "codex", "api_agent", "other"].includes(session.client_type)) readbackInvalid();
    if (!["ONLINE", "WORKING"].includes(session.state) || typeof session.transport_bound !== "boolean" ||
        !Number.isSafeInteger(session.active_lease_count) || session.active_lease_count < 0 ||
        typeof session.work_memberships_truncated !== "boolean" || !Array.isArray(session.work_memberships) ||
        session.work_memberships.length < 1 || session.work_memberships.length > 100) readbackInvalid();
    for (const key of ["session_id", "agent_id", "joined_at", "last_heartbeat_at", "presence_expires_at"]) {
      if (typeof session[key] !== "string" || !session[key]) readbackInvalid();
    }
    const memberships = session.work_memberships.map((membership) => {
      const item = requireExactObject(membership, ["work_id", "project_id", "work_status", "branch_id", "active_lease_count"]);
      if (typeof item.work_id !== "string" || !item.work_id || !Number.isSafeInteger(item.active_lease_count) || item.active_lease_count < 0) readbackInvalid();
      return Object.freeze({ ...item });
    });
    return Object.freeze({ ...session, work_memberships: Object.freeze(memberships) });
  });
  return Object.freeze({ available: raw.available, active_session_count: raw.active_session_count,
    active_logical_agent_count: raw.active_logical_agent_count, sessions: Object.freeze(sessions) });
}

// A Nyra conversational response is rendered by a host LLM.  Re-project the
// direct Control Room result before embedding it there: only this fixed,
// server-owned status vocabulary crosses the conversational boundary.
export function normalizeNyraControlRoomReadback(value) {
  const raw = requireExactObject(value, [
    "schema_version", "state", "generated_from", "domains", "work_progress",
  ]);
  if (raw.schema_version !== CONTROL_ROOM_SCHEMA_VERSION ||
      !["READY", "ATTENTION", "UNKNOWN"].includes(raw.state) ||
      raw.generated_from !== "server_readbacks_only" || !Array.isArray(raw.domains) ||
      raw.domains.length !== CONTROL_ROOM_DOMAIN_IDS.length) readbackInvalid();
  const domains = new Map();
  for (const item of raw.domains) {
    const domain = requireExactObject(item, ["id", "state", "detail", "allowed_actions"]);
    if (!CONTROL_ROOM_DOMAIN_IDS.includes(domain.id) || domains.has(domain.id)) readbackInvalid();
    domains.set(domain.id, Object.freeze({
      id: domain.id,
      state: readbackMode(domain.state),
      detail: normalizeReadbackDetail(domain.id, domain.detail),
      allowed_actions: normalizeReadbackActions(domain.allowed_actions, domain.id),
    }));
  }
  if (CONTROL_ROOM_DOMAIN_IDS.some((id) => !domains.has(id))) readbackInvalid();
  return Object.freeze({
    schema_version: CONTROL_ROOM_SCHEMA_VERSION,
    state: raw.state,
    generated_from: "server_readbacks_only",
    domains: Object.freeze(CONTROL_ROOM_DOMAIN_IDS.map((id) => domains.get(id))),
    work_progress: normalizeReadbackProgress(raw.work_progress),
  });
}

// Keep the conversational response deliberately smaller than the direct MCP
// status result.  The full source is validated above, then reduced to the
// fields needed to answer “what is on / what can I request?” without leaking
// implementation detail or expanding the compact connector tool surface.
export function projectNyraConversationControlRoomReadback(value) {
  const source = normalizeNyraControlRoomReadback(value);
  return Object.freeze({
    schema_version: "nyra_control_room_conversation_readback_v1",
    source_schema_version: CONTROL_ROOM_SCHEMA_VERSION,
    state: source.state,
    generated_from: source.generated_from,
    domains: Object.freeze(source.domains.map((domain) => Object.freeze({
      id: domain.id,
      state: domain.state,
      ...(domain.id === "work_continuity" ? { coordination: domain.detail.coordination } : {}),
      allowed_actions: Object.freeze(domain.allowed_actions.map((item) => Object.freeze({
        id: item.id,
        availability: item.availability,
        execution: item.execution,
        requires_owner_confirmation: item.requires_owner_confirmation,
        requires_core_authorization: item.requires_core_authorization,
        restart_required: item.restart_required,
      }))),
    }))),
    work_progress: Object.freeze({
      available: source.work_progress.available,
      percent: source.work_progress.percent,
      blockers: Object.freeze(source.work_progress.blockers.map((item) => Object.freeze({
        code: item.code,
        count: item.count,
      }))),
      next_action: source.work_progress.next_action === null ? null : Object.freeze({
        title: source.work_progress.next_action.title,
        status: source.work_progress.next_action.status,
      }),
      closure_verified: source.work_progress.closure_verified,
    }),
  });
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function mode(value, fallback = "UNKNOWN") {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase();
  return normalized || fallback;
}

function knownBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function readiness(value) {
  if (value === true) return "READY";
  if (value === false) return "ATTENTION";
  return "UNKNOWN";
}

function action(id, {
  availability = "AVAILABLE",
  execution = "READ_ONLY",
  requiresOwnerConfirmation = false,
  requiresCoreAuthorization = false,
  restartRequired = false,
  handler = null,
} = {}) {
  return Object.freeze({
    id,
    availability,
    execution,
    requires_owner_confirmation: requiresOwnerConfirmation,
    requires_core_authorization: requiresCoreAuthorization,
    restart_required: restartRequired,
    handler,
  });
}

function domain(id, state, detail, actions = []) {
  return Object.freeze({
    id,
    state,
    detail,
    // This list is an honest capability advertisement.  A request-only or
    // deploy-time entry is not an instruction to mutate configuration from
    // chat, and never represents authority held by Nyra or the caller.
    allowed_actions: Object.freeze(actions),
  });
}

export function projectWorkClosureProgress(work = null) {
  if (!work?.available) return Object.freeze({
    available: false, percent: null, formula: "server_work_context_unavailable",
    blockers: Object.freeze([]), next_action: null,
  });
  const tasks = integer(work.required_task_count);
  const evidence = integer(work.required_evidence_count);
  const pendingTasks = integer(work.pending_required_task_count);
  const pendingEvidence = integer(work.unverified_required_evidence_count);
  // A present Work is not enough to derive progress.  Never convert an
  // incomplete/corrupt server projection into a misleading 0% or 100%.
  if (
    tasks === null || evidence === null || pendingTasks === null || pendingEvidence === null ||
    pendingTasks > tasks || pendingEvidence > evidence || typeof work.closure_verified !== "boolean"
  ) return Object.freeze({
    available: true,
    percent: null,
    formula: "server_work_context_invalid",
    blockers: Object.freeze([{ code: "server_work_context_invalid", count: 1 }]),
    next_action: null,
    closure_verified: null,
  });
  // Closure is a separate server-owned gate: completed tasks/evidence alone
  // must not be rendered as a verified Work closure.
  const closureUnit = 1;
  const total = tasks + evidence + closureUnit;
  const complete = (tasks - pendingTasks) + (evidence - pendingEvidence) +
    (work.closure_verified === true ? closureUnit : 0);
  const blockers = [];
  if (pendingTasks) blockers.push({ code: "required_tasks_pending", count: pendingTasks });
  if (pendingEvidence) blockers.push({ code: "required_evidence_unverified", count: pendingEvidence });
  if (work.closure_verified !== true) blockers.push({ code: "closure_not_verified", count: 1 });
  return Object.freeze({
    available: true,
    percent: total ? Math.floor((complete * 100) / total) : null,
    formula: "(completed_required_tasks + verified_required_evidence + verified_closure) / (required_tasks + required_evidence + closure_gate)",
    blockers: Object.freeze(blockers),
    next_action: work.next_required_task || null,
    closure_verified: work.closure_verified === true,
  });
}

export function projectNyraControlRoomStatus({ health = {}, work = null, coordination = null, nyraDialogueEnabled } = {}) {
  const host = health.host_native_governance || {};
  const entity360 = health.entity_360 || {};
  const causalContinuity = health.causal_continuity || {};
  const researchAirlock = health.research_airlock || {};
  const scopeMode = mode(host.semantic_scope_guard_mode, "UNKNOWN");
  const entity360DeploymentCeiling = mode(entity360.deployment_mode_ceiling, "UNKNOWN");
  const entity360Ready = knownBoolean(entity360.ready);
  const entity360EnableBlocker = entity360DeploymentCeiling === "UNKNOWN"
    ? "entity_360_shadow_deployment_ceiling_unknown"
    : entity360DeploymentCeiling !== "SHADOW"
      ? "entity_360_shadow_deployment_ceiling_required"
      : entity360Ready === true
        ? null
        : entity360Ready === false
          ? "entity_360_shadow_runtime_not_ready"
          : "entity_360_shadow_runtime_readback_unknown";
  const entity360DisableRuntimeAvailable = knownBoolean(
    entity360.tenant_shadow_disable_available,
  );
  const entity360DisableBlocker = entity360DeploymentCeiling === "UNKNOWN"
    ? "entity_360_shadow_deployment_ceiling_unknown"
    : entity360DeploymentCeiling !== "SHADOW"
      ? "entity_360_shadow_deployment_ceiling_required"
      : entity360DisableRuntimeAvailable === true
        ? null
        : entity360DisableRuntimeAvailable === false
          ? "entity_360_shadow_disable_runtime_unavailable"
          : "entity_360_shadow_disable_readback_unknown";
  const entity360Transition = (id, handler, blocker) => action(id, {
    availability: blocker === null
      ? "EXISTING_GOVERNED_HANDLER"
      : "UNAVAILABLE",
    execution: blocker === null
      ? "REQUEST_BOUND_GOVERNED"
      : "DEPLOYMENT_PREREQUISITE",
    requiresOwnerConfirmation: true,
    requiresCoreAuthorization: true,
    // Do not publish an invocation target when the current Core readback says
    // the route cannot accept the transition.
    handler: blocker === null ? handler : null,
  });
  const progress = projectWorkClosureProgress(work);
  const dialogueState = nyraDialogueEnabled === true
    ? "ON"
    : nyraDialogueEnabled === false ? "OFF" : "UNKNOWN";
  const domains = [
    domain("nyra_dialogue", dialogueState, {
      transition_kind: "deployment_configuration", restart_required: true,
    }, [
      action("READ_STATUS"),
      action("REQUEST_CONFIGURATION_CHANGE", {
        availability: "REQUEST_ONLY",
        execution: "DEPLOYMENT_CONFIGURATION",
        requiresOwnerConfirmation: true,
        requiresCoreAuthorization: true,
        restartRequired: true,
      }),
    ]),
    domain("entity_360", mode(entity360.mode, "UNKNOWN"), {
      bitemporal_mode: mode(entity360.bitemporal_mode, "UNKNOWN"),
      deployment_ceiling: entity360DeploymentCeiling,
      ready: entity360Ready,
      shadow_transition_available: entity360EnableBlocker === null,
      shadow_transition_blocker: entity360EnableBlocker,
      shadow_disable_available: entity360DisableBlocker === null,
      shadow_disable_blocker: entity360DisableBlocker,
    }, [
      action("READ_STATUS"),
      entity360Transition("REQUEST_ENABLE_SHADOW", "entity_360_shadow_enable",
        entity360EnableBlocker),
      entity360Transition("REQUEST_DISABLE_SHADOW", "entity_360_shadow_disable",
        entity360DisableBlocker),
    ]),
    domain("semantic_scope_guard", scopeMode, {
      configured: knownBoolean(host.semantic_scope_guard_configured),
      transition_kind: "deployment_configuration",
      restart_required: true,
    }, [
      action("READ_STATUS"),
      action("REQUEST_CONFIGURATION_CHANGE", {
        availability: "REQUEST_ONLY",
        execution: "DEPLOYMENT_CONFIGURATION",
        requiresOwnerConfirmation: true,
        requiresCoreAuthorization: true,
        restartRequired: true,
      }),
    ]),
    domain("work_continuity", readiness(
      typeof causalContinuity.ready === "boolean"
        ? causalContinuity.ready
        : causalContinuity.ok,
    ), {
      backend: mode(causalContinuity.state, "UNKNOWN"),
      progress,
      coordination,
    }, [action("READ_STATUS")]),
    domain("research_airlock", mode(researchAirlock.mode, "UNKNOWN"), {
      state: mode(researchAirlock.state, readiness(researchAirlock.ready)),
      operational_safe: knownBoolean(researchAirlock.operational_safe),
    }, [action("READ_STATUS")]),
    domain("policy_registry", readiness(health.nyra_policy_registry?.ready), {
      state: mode(health.nyra_policy_registry?.state, "UNKNOWN"),
      enforcement: mode(health.nyra_policy_registry?.enforcement, "UNKNOWN"),
    }, [
      action("READ_STATUS"),
      action("REQUEST_LIFECYCLE_ACTION", {
        // There is no one exact compact handler for the three lifecycle
        // operations.  Do not expose a pipe-delimited pseudo-handler or let
        // chat bypass the lifecycle-health proof on the full governed path.
        availability: "REQUEST_ONLY",
        execution: "REQUEST_BOUND_GOVERNED",
        requiresOwnerConfirmation: true,
        requiresCoreAuthorization: true,
      }),
    ]),
  ];
  return Object.freeze({
    schema_version: CONTROL_ROOM_SCHEMA_VERSION,
    state: health.ok === true ? "READY" : health.ok === false ? "ATTENTION" : "UNKNOWN",
    generated_from: "server_readbacks_only",
    domains: Object.freeze(domains),
    work_progress: progress,
  });
}

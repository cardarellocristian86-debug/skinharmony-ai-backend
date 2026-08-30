const CONTROL_ROOM_SCHEMA_VERSION = "nyra_control_room_status_v1";

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

export function projectNyraControlRoomStatus({ health = {}, work = null, nyraDialogueEnabled } = {}) {
  const host = health.host_native_governance || {};
  const entity360 = health.entity_360 || {};
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
    domain("work_continuity", readiness(health.causal_continuity?.ready), {
      backend: mode(health.causal_continuity?.state, "UNKNOWN"),
      progress,
    }, [action("READ_STATUS")]),
    domain("research_airlock", mode(health.research_airlock?.mode, "UNKNOWN"), {
      state: mode(health.research_airlock?.state, "UNKNOWN"),
      operational_safe: knownBoolean(health.research_airlock?.operational_safe),
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

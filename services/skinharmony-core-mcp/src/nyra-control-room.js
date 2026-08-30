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
      deployment_ceiling: mode(entity360.deployment_mode_ceiling, "UNKNOWN"),
      ready: knownBoolean(entity360.ready),
    }, [
      action("READ_STATUS"),
      // This is the single already-implemented tenant-wide mode transition.
      // There is deliberately no fictional SET_OFF entry until a separately
      // governed disable handler and rollback receipt exist.
      action("REQUEST_ENABLE_SHADOW", {
        availability: "EXISTING_GOVERNED_HANDLER",
        execution: "REQUEST_BOUND_GOVERNED",
        requiresOwnerConfirmation: true,
        requiresCoreAuthorization: true,
        handler: "entity_360_shadow_enable",
      }),
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
        availability: "EXISTING_GOVERNED_HANDLER",
        execution: "REQUEST_BOUND_GOVERNED",
        requiresOwnerConfirmation: true,
        requiresCoreAuthorization: true,
        handler: "nyra_policy_registry_activate|rollback|reconcile",
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

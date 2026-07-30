export const BOUNDED_INTERNAL_COORDINATION_ACTION_TYPES = Object.freeze([
  "agent.heartbeat",
  "task.claim",
  "task.update",
  "message.acknowledge",
  "continuity.update",
  "native_agent.plan",
  "native_agent.bind",
  "native_agent.report",
  "native_agent.verify",
  "work_atlas.update",
  "incident.record",
  "delegation.consume",
]);

const ACTION_TYPES = new Set(BOUNDED_INTERNAL_COORDINATION_ACTION_TYPES);

function validIdempotencyKey(value) {
  const normalized = String(value || "").trim();
  return normalized.length >= 8 &&
    normalized.length <= 240 &&
    !/[\u0000-\u001f\u007f]/u.test(normalized);
}

function targetMatchesAction(actionType, value) {
  const target = String(value || "").trim().toLowerCase();
  if (!target || target.length > 240) return false;
  if (actionType === "agent.heartbeat") return target.includes("agent") || target.includes("heartbeat");
  if (actionType === "task.claim" || actionType === "task.update") return target.includes("task");
  if (actionType === "message.acknowledge") return target.includes("message");
  if (actionType === "continuity.update") {
    return target.startsWith("work_continuity_") ||
      /^[a-z0-9][a-z0-9._/-]{1,63}:[a-z0-9][a-z0-9._-]{1,63}$/i.test(target);
  }
  if (actionType === "native_agent.plan") return target.includes("native_plan");
  if (actionType === "native_agent.bind") return target.includes("native_bind");
  if (actionType === "native_agent.report") return target.includes("native_report");
  if (actionType === "native_agent.verify") return target.includes("closure");
  if (actionType === "work_atlas.update") return target.includes("atlas");
  if (actionType === "incident.record") return target.includes("incident");
  if (actionType === "delegation.consume") return target.includes("delegation_consume");
  return false;
}

export function isBoundedInternalCoordinationWrite(body = {}) {
  const actionType = String(body.action_type || "").toLowerCase();
  const authenticatedTenant = String(body.authenticated_tenant_id || "").trim();
  const requestedTenant = String(body.tenant_id || "").trim();
  return body.operation_class === "bounded_internal_coordination_write" &&
    ACTION_TYPES.has(actionType) &&
    authenticatedTenant.length > 0 &&
    requestedTenant === authenticatedTenant &&
    targetMatchesAction(actionType, body.target) &&
    validIdempotencyKey(body.idempotency_key) &&
    body.external_side_effect === false &&
    body.contains_customer_data === false &&
    body.contains_secret === false &&
    body.secret_value_transmitted === false &&
    body.cross_tenant === false &&
    body.configuration_changes === false &&
    body.destructive === false &&
    body.bypass_orchestrator === false &&
    body.provider_execution === false &&
    body.deploy !== true &&
    body.production_deploy !== true &&
    body.merge !== true &&
    body.delete !== true &&
    body.execution_enabled !== true &&
    body.force !== true &&
    body.admin_bypass !== true &&
    body.bounded_scope === true &&
    body.low_impact === true &&
    body.idempotent_or_compensable === true &&
    body.audit_ready === true &&
    body.target_authority_verified === true &&
    body.actor_authorized_for_target === true &&
    // This autonomous path is a narrow machine-coordination capability. Owner
    // identity or confirmation fields must not be borrowed to broaden it.
    body.owner_confirmed !== true &&
    body.owner_context_verified !== true &&
    body.owner_context_approval_bound !== true &&
    body.request_bound_owner_confirmation !== true;
}

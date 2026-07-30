const TENANT_WORK_COORDINATION_ACTIONS = Object.freeze({
  tenant_work_gallery_join: "work.participant.join",
  tenant_work_gallery_heartbeat: "work.participant.heartbeat",
  tenant_work_branch_open: "work.branch.open",
  tenant_work_lease_acquire: "work.lease.acquire",
  tenant_work_lease_renew: "work.lease.renew",
  tenant_work_lease_release: "work.lease.release",
  tenant_work_message_post: "work.message.post",
});

export function internalCoordinationActionType(toolName) {
  const normalized = String(toolName || "");
  const exact = TENANT_WORK_COORDINATION_ACTIONS[normalized];
  if (exact) return exact;
  if (normalized.includes("native_plan")) return "native_agent.plan";
  if (normalized.includes("native_bind")) return "native_agent.bind";
  if (normalized.includes("native_report")) return "native_agent.report";
  if (normalized.includes("closure")) return "native_agent.verify";
  if (normalized.includes("atlas")) return "work_atlas.update";
  if (normalized.includes("incident")) return "incident.record";
  if (normalized.includes("delegation_consume")) return "delegation.consume";
  return "continuity.update";
}

export function tenantWorkCoordinationActions() {
  return { ...TENANT_WORK_COORDINATION_ACTIONS };
}

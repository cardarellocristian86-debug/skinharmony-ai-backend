const ROLE_CAPABILITIES = Object.freeze({
  member: Object.freeze(["read", "coordinate"]),
  reviewer: Object.freeze(["read", "coordinate", "review_candidate"]),
  operator: Object.freeze(["read", "coordinate", "operate"]),
});

export function tenantWorkCapabilities(identity = {}) {
  if (identity.kind === "codex" || identity.oauthOwnerBound === true) {
    return ["read", "coordinate", "review_candidate", "operate"];
  }
  if (identity.oauthTenantMemberBound !== true) return [];
  return ROLE_CAPABILITIES[String(identity.tenantMembershipRole || "")] || [];
}

export function requireTenantWorkCapability(identity, capability) {
  if (!tenantWorkCapabilities(identity).includes(capability)) {
    const error = new Error("tenant_work_membership_required");
    error.code = "tenant_work_membership_required";
    throw error;
  }
}

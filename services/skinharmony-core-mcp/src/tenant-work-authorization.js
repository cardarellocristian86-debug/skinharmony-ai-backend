const ROLE_CAPABILITIES = Object.freeze({
  member: Object.freeze(["read", "coordinate"]),
  reviewer: Object.freeze(["read", "coordinate", "review_candidate"]),
  operator: Object.freeze(["read", "coordinate", "operate"]),
  support_delegate: Object.freeze(["read", "coordinate", "review_candidate"]),
});

export function tenantWorkCapabilities(identity = {}) {
  if (identity.kind === "codex" || identity.oauthOwnerBound === true) {
    return ["read", "coordinate", "review_candidate", "operate"];
  }
  if (identity.selfServiceTenant === true) {
    return ["read", "coordinate", "review_candidate", "operate"];
  }
  if (identity.oauthTenantMemberBound !== true) return [];
  if (identity.tenantMembershipRole === "support_delegate") {
    const expiresAt = Date.parse(String(identity.tenantSupportDelegationExpiresAt || ""));
    if (
      identity.tenantSupportDelegationBound !== true
      || !String(identity.tenantSupportDelegationId || "").trim()
      || !Number.isFinite(expiresAt)
      || expiresAt <= Date.now()
    ) return [];
  }
  return ROLE_CAPABILITIES[String(identity.tenantMembershipRole || "")] || [];
}

export function requireTenantWorkCapability(identity, capability) {
  if (!tenantWorkCapabilities(identity).includes(capability)) {
    const error = new Error("tenant_work_membership_required");
    error.code = "tenant_work_membership_required";
    throw error;
  }
}

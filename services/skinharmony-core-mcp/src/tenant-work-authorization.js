import { HOST_APP_CAPABILITIES } from "./host-app-registry.js";

const ROLE_CAPABILITIES = Object.freeze({
  member: Object.freeze(["read", "coordinate"]),
  reviewer: Object.freeze(["read", "coordinate", "review_candidate"]),
  operator: Object.freeze(["read", "coordinate", "operate"]),
  support_delegate: Object.freeze(["read", "coordinate", "review_candidate"]),
});

const APP_TO_SUBJECT_CAPABILITY = Object.freeze({
  [HOST_APP_CAPABILITIES.WORK_READ]: "read",
  [HOST_APP_CAPABILITIES.WORK_COORDINATE]: "coordinate",
  [HOST_APP_CAPABILITIES.WORK_REVIEW]: "review_candidate",
  [HOST_APP_CAPABILITIES.WORK_OPERATE]: "operate",
  // Creation still needs owner/Core/store gates, but a caller must first be a
  // real tenant collaborator rather than merely an application credential.
  [HOST_APP_CAPABILITIES.WORK_CREATE]: "coordinate",
  [HOST_APP_CAPABILITIES.GOVERNED_CONTINUE]: "read",
  [HOST_APP_CAPABILITIES.HOST_NATIVE_DELEGATE]: "operate",
  [HOST_APP_CAPABILITIES.HOST_NATIVE_AUTHORIZE]: "operate",
});

function authenticatedMembershipMatches(identity) {
  const binding = identity?.authenticatedTenantMembership;
  if (!binding || typeof binding !== "object" || Array.isArray(binding) ||
      binding.schema_version !== "tenant_membership_binding_v1" ||
      binding.authenticated !== true ||
      String(binding.tenant_id || "") !== String(identity.tenantId || "") ||
      String(binding.subject || "") !== String(identity.subject || "")) return false;
  const expiresAt = Date.parse(String(binding.expires_at || ""));
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function subjectTenantWorkCapabilities(identity = {}) {
  const membershipBound = authenticatedMembershipMatches(identity);
  const ownerMembership = ["tenant_owner", "super_admin"].includes(
    String(identity.authenticatedTenantMembership?.role || ""),
  );
  const legacyCodexBound = identity.kind === "codex" &&
    identity.authenticatedHostPrincipal?.registry_revision === "legacy_codex_bearer_v1";
  if (((identity.oauthOwnerBound === true || identity.selfServiceTenant === true) && membershipBound) ||
      (identity.kind === "codex" && identity.godMode === true && membershipBound && ownerMembership)) {
    return ["read", "coordinate", "review_candidate", "operate"];
  }
  if (membershipBound && (identity.oauthTenantMemberBound === true ||
      identity.registeredServiceMemberBound === true)) {
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
  // Only the explicitly identified compatibility principal retains the old
  // Codex subject envelope. Registered Codex apps use their bounded service
  // role above; a code-dark legacy principal is reduced again by app policy.
  if (legacyCodexBound) return ["read", "coordinate", "review_candidate", "operate"];
  return [];
}

export function tenantWorkCapabilities(identity = {}) {
  const subjectCapabilities = subjectTenantWorkCapabilities(identity);
  const principal = identity.authenticatedHostPrincipal;
  if (!principal) return subjectCapabilities;
  const appCapabilities = new Set(Array.isArray(principal.capabilities) ? principal.capabilities : []);
  const requiredAppCapability = Object.freeze({
    read: HOST_APP_CAPABILITIES.WORK_READ,
    coordinate: HOST_APP_CAPABILITIES.WORK_COORDINATE,
    review_candidate: HOST_APP_CAPABILITIES.WORK_REVIEW,
    operate: HOST_APP_CAPABILITIES.WORK_OPERATE,
  });
  return subjectCapabilities.filter((capability) => (
    appCapabilities.has(requiredAppCapability[capability])
  ));
}

function tenantWorkMembershipRequired() {
  const error = new Error("tenant_work_membership_required");
  error.code = "tenant_work_membership_required";
  error.status = 403;
  return error;
}

export function requireTenantWorkCapability(identity, capability) {
  if (!tenantWorkCapabilities(identity).includes(capability)) {
    throw tenantWorkMembershipRequired();
  }
}

export function requiredTenantWorkCapabilitiesForHostAuthorization(authorization) {
  if (!authorization) return Object.freeze([]);
  const appCapabilities = Array.isArray(authorization.required_capabilities)
    ? authorization.required_capabilities
    : [authorization.required_capability].filter(Boolean);
  return Object.freeze([...new Set(appCapabilities
    .map((capability) => APP_TO_SUBJECT_CAPABILITY[capability])
    .filter(Boolean))]);
}

export function requireTenantWorkHostAuthorization(identity, authorization) {
  const subjectCapabilities = subjectTenantWorkCapabilities(identity);
  for (const capability of requiredTenantWorkCapabilitiesForHostAuthorization(authorization)) {
    if (!subjectCapabilities.includes(capability)) {
      throw tenantWorkMembershipRequired();
    }
  }
}

export function requireTenantWorkRequestAuthorization(identity, {
  hostAuthorization = null,
  toolName = "",
  genericWorkPreflightRequired = false,
} = {}) {
  requireTenantWorkHostAuthorization(identity, hostAuthorization);
  if (toolName === "nyra_converse" || genericWorkPreflightRequired === true) {
    requireTenantWorkCapability(identity, "read");
  }
  return hostAuthorization;
}

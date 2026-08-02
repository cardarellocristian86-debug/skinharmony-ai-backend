// Server-side owner profile.  It intentionally sits beside, rather than
// inside, the commercial entitlement resolver: Base/Silver/Gold/Enterprise
// remain product plans and never become an administrative shortcut.
import { branchExposureValidation } from "./branchExposure.js";

export function resolveOwnerTenantBranchProfile({
  tenantId,
  ownerVerified = false,
  registry = {},
  groups = {},
  requestedBranches = [],
  commercialResolution,
} = {}) {
  if (tenantId !== "codexai" || ownerVerified !== true) return null;

  const allowForVerifiedOwner = new Set(["chatgpt_horizontal", "software_adjacent"]);
  const allowed = Object.entries(registry || {})
    .filter(([, value]) => {
      const exposureClass = String(value?.exposure_class || value?.metadata?.exposure_class || "").trim();
      // Owner projection is still fail-closed: a branch is eligible only when
      // the complete exposure contract is present and internally consistent.
      // Missing audience/client/entitlement/discovery metadata must never be
      // turned into an owner bypass.
      return allowForVerifiedOwner.has(exposureClass) && branchExposureValidation(value).ok;
    })
    .map(([branchId]) => String(branchId))
    .filter((id) => /^[a-z][a-z0-9_]{1,159}$/u.test(id));
  const requested = Array.isArray(requestedBranches) && requestedBranches.length
    ? [...new Set(requestedBranches.map(String))]
    : allowed;
  const selected = requested.filter((id) => allowed.includes(id));
  const denied = requested.filter((id) => !allowed.includes(id));
  const allowedGroups = Object.entries(groups)
    .filter(([, group]) => Array.isArray(group?.branches) && group.branches.some((id) => allowed.includes(id)))
    .map(([id]) => id);

  return {
    domain_pack: {
      id: "owner_tenant_scoped",
      version: "1",
      domain: "codexai_verified_owner_registry",
      label: "CodexAI verified owner registry",
      runtime_kind: "tenant_owner_registry",
      activation_mode: "verified_server_side_owner_only",
      // This is generated from the registry at resolution time, not a static
      // product allowlist.  It is only serialized after verification.
      vertical_branch_ids: allowed,
    },
    tier: "owner_tenant_scoped",
    commercial_tier: commercialResolution?.tier || "base",
    owner_profile: "tenant_scoped_verified_owner",
    allowed_branches: allowed,
    allowed_groups: allowedGroups,
    requested_groups: [],
    selected_branches: selected,
    denied_branches: denied,
    denied_groups: [],
  };
}

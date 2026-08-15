import crypto from "node:crypto";

export const OWNER_ACTIVE_ADVISORY_SCHEMA_VERSION = "owner_active_advisory_v1";
export const OWNER_ACTIVE_ADVISORY_STATE = "active_advisory";
export const OWNER_ACTIVE_ADVISORY_EXPECTED_BRANCH_COUNT = 71;
export const OWNER_ACTIVE_ADVISORY_EXPECTED_REGISTRY_COUNT = 73;
export const OWNER_ACTIVE_ADVISORY_EXPECTED_DIGEST = "523853512695690bc13bcf466076c22cb86b79206e1535f8c5b0a156351d99b2";

const NON_EXECUTING_AUTHORITY = Object.freeze({
  can_propose_intent_revision: false,
  can_approve_intent_revision: false,
  can_create_change: false,
  can_execute_change: false,
  can_produce_evidence: true,
  can_reconcile_outcome: false,
  can_close_obligation: false,
  execution_authorized: false,
});

function validBranchId(id) {
  return /^[a-z][a-z0-9_]{1,159}$/u.test(id);
}

function digestBranchIds(branchIds) {
  return crypto.createHash("sha256").update(JSON.stringify(branchIds)).digest("hex");
}

// The activation is pinned to the reviewed registry shape. A future branch or
// status change cannot silently inherit owner-wide advisory activation; drift
// falls back to the commercial entitlement resolver.
export function resolveOwnerActiveAdvisory({ tenantId, ownerVerified = false, registry = {} } = {}) {
  if (tenantId !== "codexai" || ownerVerified !== true || !registry || typeof registry !== "object") return null;

  const entries = Object.entries(registry);
  const activeBranches = entries
    .filter(([id, profile]) => validBranchId(id) && profile?.production_status === "advisory")
    .map(([id]) => id)
    .sort();
  const testBranches = entries.filter(([, profile]) => profile?.production_status === "test").map(([id]) => id).sort();
  const testOnlyBranches = entries.filter(([, profile]) => profile?.production_status === "test_only").map(([id]) => id).sort();
  const digest = digestBranchIds(activeBranches);

  if (
    entries.length !== OWNER_ACTIVE_ADVISORY_EXPECTED_REGISTRY_COUNT ||
    entries.some(([id]) => !validBranchId(id)) ||
    activeBranches.length !== OWNER_ACTIVE_ADVISORY_EXPECTED_BRANCH_COUNT ||
    testBranches.length !== 1 ||
    testOnlyBranches.length !== 1 ||
    testBranches[0] !== "beauty_protocol_guard" ||
    testOnlyBranches[0] !== "nyra_finance_beauty_test" ||
    digest !== OWNER_ACTIVE_ADVISORY_EXPECTED_DIGEST
  ) return null;

  return Object.freeze({
    schema_version: OWNER_ACTIVE_ADVISORY_SCHEMA_VERSION,
    state: OWNER_ACTIVE_ADVISORY_STATE,
    tenant_id: tenantId,
    source: "verified_server_side_owner_registry",
    active_branch_count: activeBranches.length,
    active_branches: Object.freeze(activeBranches),
    active_branch_digest: digest,
    excluded_branches: Object.freeze([...testBranches, ...testOnlyBranches].sort()),
    rollback_target: "commercial_entitlement",
    client_override_allowed: false,
    ...NON_EXECUTING_AUTHORITY,
  });
}

export function applyOwnerActiveAdvisory(registry = {}, activation = null) {
  const activationBranches = Array.isArray(activation?.active_branches) ? activation.active_branches : [];
  const activationValid =
    activation?.schema_version === OWNER_ACTIVE_ADVISORY_SCHEMA_VERSION &&
    activation?.state === OWNER_ACTIVE_ADVISORY_STATE &&
    activation?.tenant_id === "codexai" &&
    activation?.active_branch_count === OWNER_ACTIVE_ADVISORY_EXPECTED_BRANCH_COUNT &&
    activation?.active_branch_digest === OWNER_ACTIVE_ADVISORY_EXPECTED_DIGEST &&
    activationBranches.length === OWNER_ACTIVE_ADVISORY_EXPECTED_BRANCH_COUNT &&
    digestBranchIds([...activationBranches].sort()) === OWNER_ACTIVE_ADVISORY_EXPECTED_DIGEST &&
    activation?.execution_authorized === false;
  const active = new Set(activationValid ? activationBranches : []);
  return Object.fromEntries(Object.entries(registry).map(([id, profile]) => [
    id,
    active.has(id)
      ? {
          ...profile,
          advisory_activation: {
            schema_version: activation.schema_version,
            state: activation.state,
            execution_authorized: false,
            rollback_target: activation.rollback_target,
          },
        }
      : profile,
  ]));
}

// Server-side owner profile. It intentionally sits beside, rather than
// inside, the commercial entitlement resolver: Base/Silver/Gold/Enterprise
// remain product plans and never become an administrative shortcut.
export function resolveOwnerTenantBranchProfile({
  tenantId,
  ownerVerified = false,
  registry = {},
  groups = {},
  requestedBranches = [],
  commercialResolution,
} = {}) {
  const advisoryActivation = resolveOwnerActiveAdvisory({ tenantId, ownerVerified, registry });
  if (!advisoryActivation) return null;

  const allowed = [...advisoryActivation.active_branches];
  const requested = Array.isArray(requestedBranches) && requestedBranches.length
    ? [...new Set(requestedBranches.map(String))]
    : allowed;
  const selected = requested.filter((id) => allowed.includes(id));
  const denied = requested.filter((id) => !allowed.includes(id));
  const allowedGroups = Object.entries(groups)
    .filter(([, group]) => Array.isArray(group?.branches) && group.branches.length > 0 && group.branches.every((id) => allowed.includes(id)))
    .map(([id]) => id);

  return {
    domain_pack: {
      id: "owner_tenant_scoped",
      version: "1",
      domain: "codexai_verified_owner_registry",
      label: "CodexAI verified owner registry",
      runtime_kind: "tenant_owner_registry",
      activation_mode: OWNER_ACTIVE_ADVISORY_STATE,
      // Generated from the pinned advisory registry at resolution time. It is
      // serialized only after the signed owner assertion is verified.
      vertical_branch_ids: allowed,
    },
    tier: "owner_tenant_scoped",
    commercial_tier: commercialResolution?.tier || "base",
    owner_profile: "tenant_scoped_verified_owner",
    advisory_activation: advisoryActivation,
    allowed_branches: allowed,
    allowed_groups: allowedGroups,
    requested_groups: [],
    selected_branches: selected,
    denied_branches: denied,
    denied_groups: [],
  };
}

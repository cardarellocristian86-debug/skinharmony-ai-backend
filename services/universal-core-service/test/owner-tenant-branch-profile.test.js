import assert from "node:assert/strict";
import test from "node:test";

import { resolveOwnerTenantBranchProfile } from "../src/ownerTenantBranchProfile.js";

const registry = {
  horizontal_runtime: {
    domain: "horizontal", exposure_class: "chatgpt_horizontal",
    allowed_client_types: ["chatgpt", "codex", "api_agent", "admin"],
    allowed_audiences: ["chatgpt_connector", "codex_internal", "api_agent", "admin_control_room"],
    required_entitlements: [], discoverable_in_connector: true, semantic_select_allowed: true,
  },
  smartdesk_operations_guard: {
    domain: "beauty", exposure_class: "software_adjacent",
    allowed_client_types: ["smartdesk", "admin"],
    allowed_audiences: ["smartdesk_runtime", "admin_control_room"],
    required_entitlements: ["branch:smartdesk_operations_guard"], discoverable_in_connector: true, semantic_select_allowed: true,
  },
  suite_governance: {
    domain: "suite", exposure_class: "software_adjacent",
    allowed_client_types: ["suite", "admin"],
    allowed_audiences: ["suite_runtime", "admin_control_room"],
    required_entitlements: ["branch:suite_governance"], discoverable_in_connector: true, semantic_select_allowed: true,
  },
};
const groups = {
  horizontal: { branches: ["horizontal_runtime"] },
  vertical: { branches: ["smartdesk_operations_guard", "suite_governance"] },
};
const commercial = { tier: "enterprise", allowed_branches: ["horizontal_runtime"] };

test("verified codexai owner profile dynamically exposes all registry branches without changing plan", () => {
  const profile = resolveOwnerTenantBranchProfile({
    tenantId: "codexai",
    ownerVerified: true,
    registry,
    groups,
    commercialResolution: commercial,
  });
  assert.equal(profile.owner_profile, "tenant_scoped_verified_owner");
  assert.equal(profile.domain_pack.id, "owner_tenant_scoped");
  assert.equal(profile.commercial_tier, "enterprise");
  assert.deepEqual(profile.allowed_branches.sort(), ["horizontal_runtime", "smartdesk_operations_guard", "suite_governance"].sort());
  assert(profile.allowed_groups.includes("vertical"));
});

test("a future vertical with a complete contract is included without an allowlist edit", () => {
  const profile = resolveOwnerTenantBranchProfile({
    tenantId: "codexai",
    ownerVerified: true,
    registry: {
      ...registry,
      future_vertical_branch: {
        domain: "future", exposure_class: "software_adjacent",
        allowed_client_types: ["smartdesk", "admin"],
        allowed_audiences: ["smartdesk_runtime", "admin_control_room"],
        required_entitlements: ["branch:future_vertical_branch"],
        discoverable_in_connector: true, semantic_select_allowed: true,
      },
    },
    groups,
    commercialResolution: commercial,
  });
  assert(profile.allowed_branches.includes("future_vertical_branch"));
});

test("incomplete future vertical metadata remains fail-closed", () => {
  const profile = resolveOwnerTenantBranchProfile({
    tenantId: "codexai",
    ownerVerified: true,
    registry: { incomplete: { domain: "future", exposure_class: "software_adjacent" } },
    groups: {},
    commercialResolution: commercial,
  });
  assert.deepEqual(profile.allowed_branches, []);
});

test("commercial plans and unverified or cross-tenant callers receive no owner profile", () => {
  assert.equal(resolveOwnerTenantBranchProfile({ tenantId: "codexai", ownerVerified: false, registry, groups, commercialResolution: commercial }), null);
  assert.equal(resolveOwnerTenantBranchProfile({ tenantId: "other_tenant", ownerVerified: true, registry, groups, commercialResolution: commercial }), null);
});

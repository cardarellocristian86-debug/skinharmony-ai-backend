import assert from "node:assert/strict";
import test from "node:test";

import { resolveOwnerTenantBranchProfile } from "../src/ownerTenantBranchProfile.js";

const registry = {
  horizontal_runtime: { domain: "horizontal" },
  smartdesk_operations_guard: { domain: "beauty" },
  suite_governance: { domain: "suite" },
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
  assert.deepEqual(profile.allowed_branches.sort(), Object.keys(registry).sort());
  assert(profile.allowed_groups.includes("vertical"));
});

test("a future vertical is included from the registry without an allowlist edit", () => {
  const profile = resolveOwnerTenantBranchProfile({
    tenantId: "codexai",
    ownerVerified: true,
    registry: { ...registry, future_vertical_branch: { domain: "future" } },
    groups,
    commercialResolution: commercial,
  });
  assert(profile.allowed_branches.includes("future_vertical_branch"));
});

test("commercial plans and unverified or cross-tenant callers receive no owner profile", () => {
  assert.equal(resolveOwnerTenantBranchProfile({ tenantId: "codexai", ownerVerified: false, registry, groups, commercialResolution: commercial }), null);
  assert.equal(resolveOwnerTenantBranchProfile({ tenantId: "other_tenant", ownerVerified: true, registry, groups, commercialResolution: commercial }), null);
});

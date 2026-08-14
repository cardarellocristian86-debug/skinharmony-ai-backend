import assert from "node:assert/strict";
import test from "node:test";

import { deterministicBranchGroups, deterministicBranchRegistry } from "../branches/index.js";
import {
  OWNER_ACTIVE_ADVISORY_EXPECTED_DIGEST,
  applyOwnerActiveAdvisory,
  resolveOwnerActiveAdvisory,
  resolveOwnerTenantBranchProfile,
} from "../src/ownerTenantBranchProfile.js";

const registry = deterministicBranchRegistry();
const groups = deterministicBranchGroups();
const commercial = { tier: "enterprise", allowed_branches: ["horizontal_runtime"] };

test("verified codexai owner profile activates the pinned 70 advisory branches without execution authority", () => {
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
  assert.equal(profile.advisory_activation.state, "active_advisory");
  assert.equal(profile.advisory_activation.active_branch_count, 70);
  assert.equal(profile.advisory_activation.active_branch_digest, OWNER_ACTIVE_ADVISORY_EXPECTED_DIGEST);
  assert.equal(profile.allowed_branches.length, 70);
  assert.equal(profile.allowed_branches.includes("beauty_protocol_guard"), false);
  assert.equal(profile.allowed_branches.includes("nyra_finance_beauty_test"), false);
  assert.deepEqual(profile.advisory_activation.excluded_branches, ["beauty_protocol_guard", "nyra_finance_beauty_test"]);
  assert.equal(profile.advisory_activation.execution_authorized, false);
  assert.equal(profile.advisory_activation.can_propose_intent_revision, false);
  assert.equal(profile.advisory_activation.can_approve_intent_revision, false);
  assert.equal(profile.advisory_activation.can_create_change, false);
  assert.equal(profile.advisory_activation.can_execute_change, false);
  assert.equal(profile.advisory_activation.can_produce_evidence, true);
  assert.equal(profile.advisory_activation.can_reconcile_outcome, false);
  assert.equal(profile.advisory_activation.can_close_obligation, false);
});

test("owner advisory activation annotates exactly the active profiles", () => {
  const activation = resolveOwnerActiveAdvisory({ tenantId: "codexai", ownerVerified: true, registry });
  const projected = applyOwnerActiveAdvisory(registry, activation);
  const active = Object.values(projected).filter((profile) => profile.advisory_activation?.state === "active_advisory");
  assert.equal(active.length, 70);
  assert(active.every((profile) => profile.production_status === "advisory"));
  assert(active.every((profile) => profile.advisory_activation.execution_authorized === false));
  assert.equal(projected.beauty_protocol_guard.advisory_activation, undefined);
  assert.equal(projected.nyra_finance_beauty_test.advisory_activation, undefined);
});

test("registry drift fails closed instead of activating a future or reclassified branch", () => {
  const extraBranch = resolveOwnerTenantBranchProfile({
    tenantId: "codexai",
    ownerVerified: true,
    registry: { ...registry, future_vertical_branch: { domain: "future", production_status: "advisory" } },
    groups,
    commercialResolution: commercial,
  });
  assert.equal(extraBranch, null);

  const reclassified = structuredClone(registry);
  reclassified.suite_governance.production_status = "production";
  assert.equal(resolveOwnerActiveAdvisory({ tenantId: "codexai", ownerVerified: true, registry: reclassified }), null);

  const swappedExcludedStatuses = structuredClone(registry);
  swappedExcludedStatuses.beauty_protocol_guard.production_status = "test_only";
  swappedExcludedStatuses.nyra_finance_beauty_test.production_status = "test";
  assert.equal(resolveOwnerActiveAdvisory({ tenantId: "codexai", ownerVerified: true, registry: swappedExcludedStatuses }), null);
});

test("commercial plans and unverified or cross-tenant callers receive no owner profile", () => {
  assert.equal(resolveOwnerTenantBranchProfile({ tenantId: "codexai", ownerVerified: false, registry, groups, commercialResolution: commercial }), null);
  assert.equal(resolveOwnerTenantBranchProfile({ tenantId: "other_tenant", ownerVerified: true, registry, groups, commercialResolution: commercial }), null);
});

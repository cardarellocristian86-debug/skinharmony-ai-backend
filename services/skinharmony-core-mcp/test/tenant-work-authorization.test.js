import assert from "node:assert/strict";
import test from "node:test";
import {
  requireTenantWorkCapability,
  tenantWorkCapabilities,
} from "../src/tenant-work-authorization.js";

test("membership roles map to bounded capabilities without owner authority", () => {
  assert.deepEqual(tenantWorkCapabilities({
    kind: "oauth",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "member",
  }), ["read", "coordinate"]);
  assert.deepEqual(tenantWorkCapabilities({
    kind: "oauth",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "reviewer",
  }), ["read", "coordinate", "review_candidate"]);
  assert.deepEqual(tenantWorkCapabilities({
    kind: "oauth",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "operator",
  }), ["read", "coordinate", "operate"]);
  assert.equal(tenantWorkCapabilities({
    kind: "oauth",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "operator",
  }).includes("owner"), false);
});

test("unmapped OAuth and invalid membership roles fail closed", () => {
  for (const identity of [
    { kind: "oauth", role: "member" },
    { kind: "oauth", oauthTenantMemberBound: true, tenantMembershipRole: "owner" },
    { kind: "oauth", selfServiceTenant: true },
  ]) {
    assert.throws(
      () => requireTenantWorkCapability(identity, "coordinate"),
      /tenant_work_membership_required/,
    );
  }
});

test("Codex and explicit tenant owners can coordinate without transferring ownership", () => {
  assert.doesNotThrow(() => requireTenantWorkCapability({ kind: "codex" }, "coordinate"));
  assert.doesNotThrow(() => requireTenantWorkCapability({
    kind: "oauth",
    oauthOwnerBound: true,
  }, "coordinate"));
});

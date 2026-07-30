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
  assert.deepEqual(tenantWorkCapabilities({
    kind: "oauth",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "support_delegate",
    tenantSupportDelegationBound: true,
    tenantSupportDelegationId: "support-case-42",
    tenantSupportDelegationExpiresAt: "2030-01-01T00:00:00.000Z",
  }), ["read", "coordinate", "review_candidate"]);
});

test("unmapped OAuth and invalid membership roles fail closed", () => {
  for (const identity of [
    { kind: "oauth", role: "member" },
    { kind: "oauth", oauthTenantMemberBound: true, tenantMembershipRole: "owner" },
    {
      kind: "oauth",
      oauthTenantMemberBound: true,
      tenantMembershipRole: "support_delegate",
      tenantSupportDelegationBound: true,
      tenantSupportDelegationId: "expired-case",
      tenantSupportDelegationExpiresAt: "2020-01-01T00:00:00.000Z",
    },
  ]) {
    assert.throws(
      () => requireTenantWorkCapability(identity, "coordinate"),
      /tenant_work_membership_required/,
    );
  }
});

test("a self-service tenant can operate only its own Gallery without owner elevation", () => {
  const capabilities = tenantWorkCapabilities({
    kind: "oauth",
    tenantId: "chatgpt_personal",
    selfServiceTenant: true,
  });
  assert.deepEqual(capabilities, ["read", "coordinate", "review_candidate", "operate"]);
  assert.equal(capabilities.includes("owner"), false);
});

test("Codex and explicit tenant owners can coordinate without transferring ownership", () => {
  assert.doesNotThrow(() => requireTenantWorkCapability({ kind: "codex" }, "coordinate"));
  assert.doesNotThrow(() => requireTenantWorkCapability({
    kind: "oauth",
    oauthOwnerBound: true,
  }, "coordinate"));
});

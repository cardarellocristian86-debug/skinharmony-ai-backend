import assert from "node:assert/strict";
import test from "node:test";
import {
  requireTenantWorkCapability,
  requireTenantWorkHostAuthorization,
  requireTenantWorkRequestAuthorization,
  tenantWorkCapabilities,
} from "../src/tenant-work-authorization.js";

test("membership roles map to bounded capabilities without owner authority", () => {
  const membership = (role) => ({
    schema_version: "tenant_membership_binding_v1",
    authenticated: true,
    tenant_id: "tenant-a",
    subject: "user-a",
    role,
    team_ids: [], managed_team_ids: [], assigned_work_ids: [],
    issued_at: new Date(Date.now() - 1_000).toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.deepEqual(tenantWorkCapabilities({
    kind: "oauth",
    tenantId: "tenant-a",
    subject: "user-a",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "member",
    authenticatedTenantMembership: membership("member"),
  }), ["read", "coordinate"]);
  assert.deepEqual(tenantWorkCapabilities({
    kind: "oauth",
    tenantId: "tenant-a",
    subject: "user-a",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "reviewer",
    authenticatedTenantMembership: membership("reviewer"),
  }), ["read", "coordinate", "review_candidate"]);
  assert.deepEqual(tenantWorkCapabilities({
    kind: "oauth",
    tenantId: "tenant-a",
    subject: "user-a",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "operator",
    authenticatedTenantMembership: membership("operator"),
  }), ["read", "coordinate", "operate"]);
  assert.equal(tenantWorkCapabilities({
    kind: "oauth",
    tenantId: "tenant-a",
    subject: "user-a",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "operator",
    authenticatedTenantMembership: membership("operator"),
  }).includes("owner"), false);
  assert.deepEqual(tenantWorkCapabilities({
    kind: "oauth",
    tenantId: "tenant-a",
    subject: "user-a",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "support_delegate",
    tenantSupportDelegationBound: true,
    tenantSupportDelegationId: "support-case-42",
    tenantSupportDelegationExpiresAt: "2030-01-01T00:00:00.000Z",
    authenticatedTenantMembership: membership("support_delegate"),
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
    subject: "self-user",
    selfServiceTenant: true,
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1", authenticated: true,
      tenant_id: "chatgpt_personal", subject: "self-user", role: "member",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  assert.deepEqual(capabilities, ["read", "coordinate", "review_candidate", "operate"]);
  assert.equal(capabilities.includes("owner"), false);
});

test("Codex and explicit tenant owners can coordinate without transferring ownership", () => {
  assert.doesNotThrow(() => requireTenantWorkCapability({
    kind: "codex",
    authenticatedHostPrincipal: {
      registry_revision: "legacy_codex_bearer_v1",
      capabilities: ["work.read", "work.coordinate"],
    },
  }, "coordinate"));
  assert.doesNotThrow(() => requireTenantWorkCapability({
    kind: "oauth",
    tenantId: "tenant-a",
    subject: "owner-a",
    oauthOwnerBound: true,
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1", authenticated: true,
      tenant_id: "tenant-a", subject: "owner-a", role: "tenant_owner",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
  }, "coordinate"));
});

test("native bridge repair permits an authenticated owner/operator but denies a coordinator", () => {
  const membership = (subject, role) => ({
    schema_version: "tenant_membership_binding_v1", authenticated: true,
    tenant_id: "tenant-a", subject, role,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.doesNotThrow(() => requireTenantWorkCapability({
    kind: "oauth", tenantId: "tenant-a", subject: "owner-a", oauthOwnerBound: true,
    authenticatedTenantMembership: membership("owner-a", "tenant_owner"),
  }, "operate"));
  assert.doesNotThrow(() => requireTenantWorkCapability({
    kind: "oauth", tenantId: "tenant-a", subject: "operator-a", oauthTenantMemberBound: true,
    tenantMembershipRole: "operator", authenticatedTenantMembership: membership("operator-a", "operator"),
  }, "operate"));
  assert.throws(() => requireTenantWorkCapability({
    kind: "oauth", tenantId: "tenant-a", subject: "member-a", oauthTenantMemberBound: true,
    tenantMembershipRole: "member", authenticatedTenantMembership: membership("member-a", "member"),
  }, "operate"), /tenant_work_membership_required/);
});

test("registered Codex honors member, reviewer and operator service roles", () => {
  const registeredCodex = (role) => ({
    kind: "codex",
    tenantId: "tenant-a",
    subject: "codex",
    registeredServiceMemberBound: true,
    tenantMembershipRole: role,
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1", authenticated: true,
      tenant_id: "tenant-a", subject: "codex", role: "member",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    authenticatedHostPrincipal: {
      registered: true,
      registry_revision: "a".repeat(64),
      capabilities: ["work.read", "work.coordinate", "work.review", "work.operate"],
    },
  });
  assert.deepEqual(tenantWorkCapabilities(registeredCodex("member")), ["read", "coordinate"]);
  assert.deepEqual(tenantWorkCapabilities(registeredCodex("reviewer")), ["read", "coordinate", "review_candidate"]);
  assert.deepEqual(tenantWorkCapabilities(registeredCodex("operator")), ["read", "coordinate", "operate"]);
});

test("intersects subject authority with the registered application capabilities", () => {
  const identity = {
    kind: "oauth",
    tenantId: "tenant-a",
    subject: "operator-a",
    oauthTenantMemberBound: true,
    tenantMembershipRole: "operator",
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1", authenticated: true,
      tenant_id: "tenant-a", subject: "operator-a", role: "member",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    authenticatedHostPrincipal: {
      registered: true,
      capabilities: ["work.read", "work.coordinate"],
    },
  };
  assert.deepEqual(tenantWorkCapabilities(identity), ["read", "coordinate"]);
  assert.throws(
    () => requireTenantWorkCapability(identity, "operate"),
    /tenant_work_membership_required/,
  );
});

test("central host authorization intersects member, reviewer and operator roles", () => {
  const identityFor = (role) => ({
    kind: "oauth",
    tenantId: "tenant-a",
    subject: `${role}-user`,
    oauthTenantMemberBound: true,
    tenantMembershipRole: role,
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1", authenticated: true,
      tenant_id: "tenant-a", subject: `${role}-user`, role: "member",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    authenticatedHostPrincipal: {
      registered: true,
      capabilities: ["work.read", "work.coordinate", "work.review", "work.operate", "host_native.authorize"],
    },
  });
  const authorization = (capability) => ({ required_capabilities: [capability] });
  assert.doesNotThrow(() => requireTenantWorkHostAuthorization(identityFor("member"), authorization("work.coordinate")));
  assert.throws(() => requireTenantWorkHostAuthorization(identityFor("member"), authorization("work.review")), /tenant_work_membership_required/);
  assert.doesNotThrow(() => requireTenantWorkHostAuthorization(identityFor("reviewer"), authorization("work.review")));
  assert.throws(() => requireTenantWorkHostAuthorization(identityFor("reviewer"), authorization("work.operate")), /tenant_work_membership_required/);
  assert.doesNotThrow(() => requireTenantWorkHostAuthorization(identityFor("operator"), authorization("work.operate")));
  assert.doesNotThrow(() => requireTenantWorkHostAuthorization(identityFor("operator"), authorization("host_native.authorize")));
  assert.doesNotThrow(() => requireTenantWorkHostAuthorization({
    ...identityFor("operator"),
    authenticatedHostPrincipal: { registered: true, capabilities: ["host_native.authorize"] },
  }, authorization("host_native.authorize")));
  assert.doesNotThrow(() => requireTenantWorkHostAuthorization({
    ...identityFor("member"),
    authenticatedHostPrincipal: { registered: true, capabilities: ["work.create"] },
  }, authorization("work.create")));
});

test("claim-only OAuth is denied before every generic Work side effect", () => {
  const effects = { presence: 0, ledger: 0, preflight: 0, continuity: 0, handler: 0 };
  const claimOnly = {
    kind: "oauth",
    tenantId: "tenant-a",
    subject: "claim-only",
    authenticatedHostPrincipal: {
      registered: true,
      capabilities: ["work.read"],
    },
  };
  const executeGenericPath = () => {
    requireTenantWorkRequestAuthorization(claimOnly, {
      hostAuthorization: null,
      toolName: "task_list",
      genericWorkPreflightRequired: true,
    });
    effects.presence += 1;
    effects.ledger += 1;
    effects.preflight += 1;
    effects.continuity += 1;
    effects.handler += 1;
  };
  assert.throws(executeGenericPath, /tenant_work_membership_required/);
  assert.deepEqual(effects, { presence: 0, ledger: 0, preflight: 0, continuity: 0, handler: 0 });
});

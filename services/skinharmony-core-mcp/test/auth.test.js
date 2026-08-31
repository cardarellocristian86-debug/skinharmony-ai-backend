import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createAuthenticator,
  isCodexGoodModeDelegation,
  requireScopes,
  verifyAuth0Jwt,
} from "../src/auth.js";
import { parseHostAppRegistry } from "../src/host-app-registry.js";

function jwt(privateKey, kid, payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey).toString("base64url");
  return `${header}.${body}.${signature}`;
}

function auth0Fixture(overrides = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "test-key";
  const config = {
    auth0Issuer: "https://tenant.auth0.com",
    auth0Audience: "https://core",
    jwksUri: "https://tenant.auth0.com/.well-known/jwks.json",
    tenantClaim: "https://skinharmony.it/tenant_id",
  };
  const token = jwt(privateKey, jwk.kid, {
    iss: `${config.auth0Issuer}/`,
    aud: config.auth0Audience,
    sub: "chatgpt",
    exp: Math.floor(Date.now() / 1000) + 60,
    "https://skinharmony.it/tenant_id": "tenant-a",
    ...overrides,
  });
  return { token, config, cache: { get: async () => jwk } };
}

test("accepts a scoped Codex bearer without exposing it", async () => {
  const auth = createAuthenticator({ codexKeys: ["secret"], codexScopes: ["core:read"], auth0Issuer: "", defaultTenantId: "owner-private" });
  const identity = await auth("Bearer secret");
  assert.deepEqual({ kind: identity.kind, subject: identity.subject, tenantId: identity.tenantId, scopes: identity.scopes },
    { kind: "codex", subject: "codex", tenantId: "owner-private", scopes: ["core:read"] });
  assert.equal(identity.authenticatedHostPrincipal.host_kind, "codex_native");
  assert.equal(identity.authenticatedHostPrincipal.registered, true);
  await assert.rejects(auth("Bearer wrong"), /bearer_invalid/);
});

test("binds Codex to exact registry capabilities and keeps legacy keys read-only when compatibility is disabled", async () => {
  const secret = "registered-codex-bearer-0123456789abcdef";
  const hostAppRegistry = parseHostAppRegistry(JSON.stringify({
    schema_version: "mcp_host_app_registry_v1",
    apps: [{
      app_id: "codex",
      auth_kind: "bearer",
      credential_env: "MCP_HOST_APP_TOKEN_CODEX",
      tenant_id: "tenant-a",
      service_role: "member",
      host_kind: "codex_native",
      client_type: "codex",
      interaction_mode: "native_tooling",
      capabilities: ["work.read", "work.coordinate"],
      scopes: ["core:read", "core:govern"],
      enabled: true,
    }],
  }), { MCP_HOST_APP_TOKEN_CODEX: secret });
  const registered = await createAuthenticator({
    hostAppRegistry,
    codexKeys: [],
    auth0Issuer: "",
    serviceTenantMembershipTtlSeconds: 300,
  })(`Bearer ${secret}`);
  assert.equal(registered.kind, "codex");
  assert.equal(registered.tenantId, "tenant-a");
  assert.equal(registered.authenticatedHostPrincipal.registered, true);
  assert.deepEqual(registered.authenticatedHostPrincipal.capabilities, ["work.coordinate", "work.read"]);
  assert.equal(registered.authenticatedTenantMembership.authenticated, true);
  assert.equal(registered.authenticatedTenantMembership.tenant_id, "tenant-a");
  assert.equal(registered.authenticatedTenantMembership.subject, "codex");
  assert.equal(registered.authenticatedTenantMembership.role, "member");

  const legacy = await createAuthenticator({
    hostAppRegistry,
    codexKeys: ["legacy-secret"],
    codexScopes: ["core:read", "core:govern"],
    auth0Issuer: "",
    defaultTenantId: "tenant-a",
    legacyCodexHostPrincipalEnabled: false,
  })("Bearer legacy-secret");
  assert.equal(legacy.authenticatedHostPrincipal.registered, false);
  assert.equal(legacy.authenticatedHostPrincipal.host_kind, null);
  assert.deepEqual(legacy.authenticatedHostPrincipal.capabilities, ["work.read"]);
});

test("activates owner_root only for the isolated owner tenant and an allowed Codex delegate", async () => {
  const auth = createAuthenticator({
    codexKeys: ["secret"],
    codexScopes: ["core:read"],
    auth0Issuer: "",
    defaultTenantId: "owner-private",
    supportedScopes: ["core:read", "core:govern", "workspace:write"],
    godModeEnabled: true,
    godModeEmergencyStop: false,
    godModeTenantIds: ["owner-private", "codexai"],
    godModeSubjects: [],
    godModeClientIds: [],
    godModeCodexEnabled: true,
  });
  const identity = await auth("Bearer secret");
  assert.equal(identity.role, "owner_root");
  assert.equal(identity.godMode, true);
  assert.deepEqual(identity.scopes, ["core:read", "core:govern", "workspace:write", "owner:root"]);
});

test("Good Mode cannot expand the configured scopes of a registered Codex app", async () => {
  const secret = "registered-good-mode-codex-0123456789abcdef";
  const hostAppRegistry = parseHostAppRegistry(JSON.stringify({
    schema_version: "mcp_host_app_registry_v1",
    apps: [{
      app_id: "codex",
      auth_kind: "bearer",
      credential_env: "MCP_HOST_APP_TOKEN_CODEX",
      tenant_id: "codexai",
      service_role: "member",
      host_kind: "codex_native",
      client_type: "codex",
      interaction_mode: "native_tooling",
      capabilities: ["work.read"],
      scopes: ["core:read"],
      enabled: true,
    }],
  }), { MCP_HOST_APP_TOKEN_CODEX: secret });
  const auth = createAuthenticator({
    hostAppRegistry,
    codexKeys: [],
    auth0Issuer: "",
    supportedScopes: ["core:read", "core:govern", "workspace:write"],
    godModeEnabled: true,
    godModeEmergencyStop: false,
    godModeTenantIds: ["codexai"],
    godModeCodexEnabled: true,
  });
  const identity = await auth(`Bearer ${secret}`);

  assert.equal(identity.role, "owner_root");
  assert.equal(identity.godMode, true);
  assert.deepEqual(identity.scopes, ["core:read", "owner:root"]);
  assert.deepEqual(identity.authenticatedHostPrincipal.capabilities, ["work.read"]);
  assert.throws(() => requireScopes(identity, ["core:govern"]), /insufficient_scope/);
});

test("the emergency stop disables owner_root immediately", async () => {
  const auth = createAuthenticator({
    codexKeys: ["secret"], codexScopes: ["core:read"], auth0Issuer: "",
    defaultTenantId: "owner-private", supportedScopes: ["core:read", "core:govern"],
    godModeEnabled: true, godModeEmergencyStop: true, godModeTenantIds: ["owner-private", "codexai"],
    godModeSubjects: [], godModeClientIds: [], godModeCodexEnabled: true,
  });
  const identity = await auth("Bearer secret");
  assert.deepEqual({ kind: identity.kind, subject: identity.subject, tenantId: identity.tenantId, scopes: identity.scopes }, {
    kind: "codex", subject: "codex", tenantId: "owner-private", scopes: ["core:read"],
  });
  assert.equal(identity.authenticatedHostPrincipal.host_kind, "codex_native");
});

test("recognizes a host-native Codex Good Mode delegation only under the exact tenant policy", async () => {
  const config = {
    codexKeys: ["secret"],
    codexScopes: ["core:read"],
    auth0Issuer: "",
    defaultTenantId: "codexai",
    supportedScopes: ["core:read", "core:govern", "workspace:write"],
    godModeEnabled: true,
    godModeEmergencyStop: false,
    godModeTenantIds: ["owner-private", "codexai"],
    godModeCodexEnabled: true,
  };
  const identity = await createAuthenticator(config)("Bearer secret");

  assert.equal(isCodexGoodModeDelegation(identity, config), true);
  assert.equal(isCodexGoodModeDelegation({ ...identity, subject: "untrusted" }, config), false);
  assert.equal(isCodexGoodModeDelegation(identity, { ...config, godModeEmergencyStop: true }), false);
  assert.equal(isCodexGoodModeDelegation(identity, { ...config, godModeCodexEnabled: false }), false);
  assert.equal(isCodexGoodModeDelegation({ ...identity, tenantId: "tenant-a" }, config), false);
});

test("activates owner_root only for an allowlisted OAuth subject in an owner tenant", async () => {
  const ownerSubject = "google-oauth2|owner";
  const ownerFixture = auth0Fixture({
    sub: ownerSubject,
    iat: Math.floor(Date.now() / 1000),
    auth_time: Math.floor(Date.now() / 1000),
    scope: "core:read",
    azp: "dynamic-chatgpt-client",
    "https://skinharmony.it/tenant_id": "codexai",
  });
  const ownerConfig = {
    ...ownerFixture.config,
    codexKeys: [],
    supportedScopes: ["core:read", "core:govern", "workspace:write"],
    oauthOwnerTenantBindings: { [ownerSubject]: "codexai" },
    godModeEnabled: true,
    godModeEmergencyStop: false,
    godModeTenantIds: ["owner-private", "codexai"],
    godModeSubjects: [ownerSubject],
    godModeClientIds: [],
    godModeCodexEnabled: true,
  };
  const ownerIdentity = await createAuthenticator(ownerConfig, { jwksCache: ownerFixture.cache })(`Bearer ${ownerFixture.token}`);
  assert.equal(ownerIdentity.role, "owner_root");
  assert.equal(ownerIdentity.godMode, true);
  assert.equal(ownerIdentity.clientId, "dynamic-chatgpt-client");
  const elevatedOwnerIdentity = createAuthenticator(ownerConfig, { jwksCache: ownerFixture.cache });
  const verifiedOwner = await elevatedOwnerIdentity(`Bearer ${ownerFixture.token}`);
  const confirmedOwner = elevatedOwnerIdentity.elevateOAuthOwner(verifiedOwner, {
    confirmed: true,
    confirmationReference: "verified root dynamic action",
    requestBinding: "core_capability_invoke",
  });
  assert.equal(confirmedOwner.role, "owner_root");
  assert.equal(confirmedOwner.godMode, true);
  assert.equal(confirmedOwner.oauthOwnerElevated, true);

  const otherFixture = auth0Fixture({
    sub: "google-oauth2|another-user",
    scope: "core:read",
    azp: "dynamic-chatgpt-client",
    "https://skinharmony.it/tenant_id": "codexai",
  });
  const otherIdentity = await createAuthenticator({
    ...ownerConfig,
    ...otherFixture.config,
  }, { jwksCache: otherFixture.cache })(`Bearer ${otherFixture.token}`);
  assert.equal(otherIdentity.role, "member");
  assert.equal(otherIdentity.godMode, undefined);
});

test("never elevates an OAuth identity from a client ID alone", async () => {
  const fixture = auth0Fixture({
    sub: "google-oauth2|not-allowlisted",
    scope: "core:read",
    azp: "shared-browser-client",
    "https://skinharmony.it/tenant_id": "codexai",
  });
  const identity = await createAuthenticator({
    ...fixture.config,
    codexKeys: [],
    supportedScopes: ["core:read", "core:govern", "workspace:write"],
    godModeEnabled: true,
    godModeEmergencyStop: false,
    godModeTenantIds: ["codexai"],
    godModeSubjects: [],
    // Retained for configuration compatibility, but deliberately ignored for
    // OAuth owner elevation.
    godModeClientIds: ["shared-browser-client"],
    godModeCodexEnabled: false,
  }, { jwksCache: fixture.cache })(`Bearer ${fixture.token}`);

  assert.equal(identity.role, "member");
  assert.equal(identity.godMode, undefined);
});

test("keeps a token-declared tenant role bounded without a server-side ownership binding", async () => {
  const fixture = auth0Fixture({
    sub: "google-oauth2|tenant-owner",
    scope: "core:read",
    "https://skinharmony.it/role": "tenant_owner",
  });
  const identity = await createAuthenticator({
    ...fixture.config,
    tenantOwnerRoleClaim: "https://skinharmony.it/role",
    tenantOwnerRoles: ["tenant_owner", "tenant_admin", "owner_root"],
    codexKeys: [], godModeEnabled: false, godModeEmergencyStop: false,
  }, { jwksCache: fixture.cache })(`Bearer ${fixture.token}`);
  assert.equal(identity.tenantId, "tenant-a");
  assert.equal(identity.role, "member");

  const memberFixture = auth0Fixture({ "https://skinharmony.it/role": "member" });
  const member = await createAuthenticator({
    ...memberFixture.config,
    tenantOwnerRoleClaim: "https://skinharmony.it/role",
    tenantOwnerRoles: ["tenant_owner"], codexKeys: [], godModeEnabled: false,
  }, { jwksCache: memberFixture.cache })(`Bearer ${memberFixture.token}`);
});

test("verifies Auth0 RS256 issuer, audience, expiry and scopes", async () => {
  const { token, config, cache } = auth0Fixture({ scope: "core:read" });
  assert.deepEqual(await verifyAuth0Jwt(token, config, cache), { kind: "oauth", subject: "chatgpt", tenantId: "tenant-a", role: "member", scopes: ["core:read"] });
});

test("gives an ordinary ChatGPT login a stable personal tenant when self-service is enabled", async () => {
  const fixture = auth0Fixture({
    sub: "google-oauth2|ordinary-user",
    scope: "core:read",
    "https://skinharmony.it/tenant_id": "shared-tenant-that-must-not-be-used",
  });
  const config = {
    ...fixture.config,
    selfServiceTenantsEnabled: true,
    tenantOwnerRoleClaim: "https://skinharmony.it/role",
    tenantOwnerRoles: ["tenant_owner", "tenant_admin"],
    codexKeys: [],
    godModeEnabled: false,
  };
  const first = await createAuthenticator(config, { jwksCache: fixture.cache })(`Bearer ${fixture.token}`);
  const second = await createAuthenticator(config, { jwksCache: fixture.cache })(`Bearer ${fixture.token}`);
  assert.match(first.tenantId, /^chatgpt_[a-f0-9]{32}$/);
  assert.equal(first.tenantId, second.tenantId);
  assert.equal(first.tenantId === "shared-tenant-that-must-not-be-used", false);
  assert.equal(first.selfServiceTenant, true);
  assert.equal(first.role, "member");
});

test("keeps an unbound tenant claim inside the self-service tenant", async () => {
  const fixture = auth0Fixture({
    scope: "core:read",
    "https://skinharmony.it/role": "tenant_admin",
  });
  const identity = await createAuthenticator({
    ...fixture.config,
    selfServiceTenantsEnabled: true,
    tenantOwnerRoleClaim: "https://skinharmony.it/role",
    tenantOwnerRoles: ["tenant_admin"],
    codexKeys: [], godModeEnabled: false,
  }, { jwksCache: fixture.cache })(`Bearer ${fixture.token}`);
  assert.match(identity.tenantId, /^chatgpt_[a-f0-9]{32}$/);
  assert.equal(identity.selfServiceTenant, true);
  assert.equal(identity.role, "member");
});

test("binds multiple OAuth subjects to one shared tenant with bounded member roles", async () => {
  const memberA = auth0Fixture({
    sub: "google-oauth2|member-a",
    scope: "core:read",
    "https://skinharmony.it/tenant_id": "spoofed-a",
    "https://skinharmony.it/role": "owner_root",
  });
  const memberB = auth0Fixture({
    sub: "google-oauth2|member-b",
    scope: "core:read",
    "https://skinharmony.it/tenant_id": "spoofed-b",
    "https://skinharmony.it/role": "tenant_owner",
  });
  const memberships = {
    "google-oauth2|member-a": { tenantId: "codexai", role: "reviewer" },
    "google-oauth2|member-b": { tenantId: "codexai", role: "operator" },
  };
  const config = {
    ...memberA.config,
    codexKeys: [],
    selfServiceTenantsEnabled: true,
    oauthTenantMemberships: memberships,
    godModeEnabled: false,
  };
  const identityA = await createAuthenticator(config, { jwksCache: memberA.cache })(`Bearer ${memberA.token}`);
  const identityB = await createAuthenticator(
    { ...config, ...memberB.config },
    { jwksCache: memberB.cache },
  )(`Bearer ${memberB.token}`);

  assert.equal(identityA.tenantId, "codexai");
  assert.equal(identityB.tenantId, "codexai");
  assert.equal(identityA.role, "reviewer");
  assert.equal(identityB.role, "operator");
  assert.equal(identityA.oauthTenantMemberBound, true);
  assert.equal(identityB.oauthTenantMemberBound, true);
  assert.equal(identityA.oauthOwnerBound, undefined);
  assert.equal(identityB.oauthOwnerBound, undefined);
  assert.equal(identityA.selfServiceTenant, undefined);
  assert.equal(identityB.selfServiceTenant, undefined);
});

test("emits authenticated Work membership envelopes only from verified server bindings", async () => {
  const owner = auth0Fixture({ sub: "oauth|owner", iat: Math.floor(Date.now() / 1000) });
  const manager = auth0Fixture({ sub: "oauth|manager", iat: Math.floor(Date.now() / 1000) });
  const admin = auth0Fixture({ sub: "oauth|admin", iat: Math.floor(Date.now() / 1000) });
  const config = {
    ...owner.config, codexKeys: [], godModeEnabled: false,
    oauthOwnerTenantBindings: { "oauth|owner": "tenant-a" },
    oauthTenantMemberships: {
      "oauth|manager": { tenantId: "tenant-a", role: "team_manager", teamIds: ["team-a"], managedTeamIds: ["team-a"] },
      "oauth|admin": { tenantId: "tenant-a", role: "super_admin", teamIds: [], managedTeamIds: [] },
    },
  };
  const ownerIdentity = await createAuthenticator(config, { jwksCache: owner.cache })(`Bearer ${owner.token}`);
  const managerIdentity = await createAuthenticator({ ...config, ...manager.config }, { jwksCache: manager.cache })(`Bearer ${manager.token}`);
  const adminIdentity = await createAuthenticator({ ...config, ...admin.config }, { jwksCache: admin.cache })(`Bearer ${admin.token}`);
  for (const identity of [ownerIdentity, managerIdentity, adminIdentity]) {
    assert.equal(identity.authenticatedTenantMembership.schema_version, "tenant_membership_binding_v1");
    assert.equal(identity.authenticatedTenantMembership.authenticated, true);
    assert.equal(identity.authenticatedTenantMembership.tenant_id, "tenant-a");
    assert.equal(identity.authenticatedTenantMembership.subject, identity.subject);
    assert.ok(Date.parse(identity.authenticatedTenantMembership.expires_at) > Date.now());
  }
  assert.equal(ownerIdentity.authenticatedTenantMembership.role, "tenant_owner");
  assert.deepEqual(managerIdentity.authenticatedTenantMembership.managed_team_ids, ["team-a"]);
  assert.equal(adminIdentity.authenticatedTenantMembership.role, "super_admin");
});

test("rejects expired static memberships and does not derive Work authority from spoofed OAuth claims", async () => {
  const fixture = auth0Fixture({ sub: "oauth|member", "https://skinharmony.it/role": "super_admin" });
  const base = { ...fixture.config, codexKeys: [], godModeEnabled: false };
  const member = await createAuthenticator({ ...base, oauthTenantMemberships: {
    "oauth|member": { tenantId: "tenant-a", role: "member", teamIds: [], managedTeamIds: [] },
  } }, { jwksCache: fixture.cache })(`Bearer ${fixture.token}`);
  assert.equal(member.authenticatedTenantMembership.role, "member");
  await assert.rejects(createAuthenticator({ ...base, oauthTenantMemberships: {
    "oauth|member": { tenantId: "tenant-a", role: "member", expiresAt: "2000-01-01T00:00:00.000Z" },
  } }, { jwksCache: fixture.cache })(`Bearer ${fixture.token}`), /tenant_membership_expired/);
});

test("Codex receives Work owner authority only from verified Good Mode", async () => {
  const bound = await createAuthenticator({
    codexKeys: ["bound"], codexScopes: ["core:read"], auth0Issuer: "", defaultTenantId: "tenant-a",
    supportedScopes: ["core:read"], godModeEnabled: true, godModeEmergencyStop: false,
    godModeTenantIds: ["tenant-a"], godModeCodexEnabled: true,
  })("Bearer bound");
  assert.equal(bound.authenticatedTenantMembership.role, "tenant_owner");
  const unbound = await createAuthenticator({
    codexKeys: ["unbound"], codexScopes: ["core:read"], auth0Issuer: "", defaultTenantId: "tenant-a",
    godModeEnabled: false, godModeEmergencyStop: false, godModeTenantIds: ["tenant-a"], godModeCodexEnabled: true,
  })("Bearer unbound");
  assert.equal(unbound.authenticatedTenantMembership, undefined);
});

test("a tenant membership cannot elevate to owner", async () => {
  const now = Math.floor(Date.now() / 1000);
  const fixture = auth0Fixture({
    sub: "google-oauth2|operator",
    iat: now,
    auth_time: now,
    "https://skinharmony.it/tenant_id": "codexai",
    "https://skinharmony.it/role": "owner_root",
  });
  const auth = createAuthenticator({
    ...fixture.config,
    codexKeys: [],
    supportedScopes: ["core:read", "core:govern", "workspace:write"],
    oauthTenantMemberships: {
      "google-oauth2|operator": { tenantId: "codexai", role: "operator" },
    },
    godModeEnabled: true,
    godModeEmergencyStop: false,
    godModeTenantIds: ["codexai"],
    godModeSubjects: ["google-oauth2|operator"],
    godModeCodexEnabled: false,
    oauthOwnerConfirmationMaxAgeSeconds: 300,
  }, { jwksCache: fixture.cache });
  const identity = await auth(`Bearer ${fixture.token}`);

  assert.equal(identity.role, "operator");
  assert.equal(identity.godMode, undefined);
  assert.throws(
    () => auth.elevateOAuthOwner(identity, {
      confirmed: true,
      confirmationReference: "attempted owner elevation",
      requestBinding: "restricted-owner-action",
    }),
    /owner_binding_required/,
  );
});

test("binds support access to one tenant, one delegation id and an expiry", async () => {
  const fixture = auth0Fixture({
    sub: "google-oauth2|support",
    scope: "core:read",
    "https://skinharmony.it/tenant_id": "attacker-selected-tenant",
  });
  const baseConfig = {
    ...fixture.config,
    codexKeys: [],
    selfServiceTenantsEnabled: true,
    oauthTenantMemberships: {
      "google-oauth2|support": {
        tenantId: "client-a",
        role: "support_delegate",
        delegationId: "support-case-42",
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
    },
    godModeEnabled: true,
    godModeEmergencyStop: false,
    godModeTenantIds: ["client-a"],
    godModeSubjects: ["google-oauth2|support"],
    godModeCodexEnabled: false,
  };
  const identity = await createAuthenticator(baseConfig, { jwksCache: fixture.cache })(`Bearer ${fixture.token}`);
  assert.equal(identity.tenantId, "client-a");
  assert.equal(identity.tenantMembershipRole, "support_delegate");
  assert.equal(identity.tenantSupportDelegationBound, true);
  assert.equal(identity.tenantSupportDelegationId, "support-case-42");
  assert.equal(identity.oauthOwnerBound, undefined);
  assert.equal(identity.godMode, undefined);

  await assert.rejects(
    createAuthenticator({
      ...baseConfig,
      oauthTenantMemberships: {
        "google-oauth2|support": {
          tenantId: "client-a",
          role: "support_delegate",
          delegationId: "expired-case",
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
      },
    }, { jwksCache: fixture.cache })(`Bearer ${fixture.token}`),
    /tenant_support_delegation_expired/,
  );
});

test("an explicit owner binding takes precedence over an overlapping membership", async () => {
  const fixture = auth0Fixture({ sub: "google-oauth2|owner-member", scope: "core:read" });
  const identity = await createAuthenticator({
    ...fixture.config,
    codexKeys: [],
    oauthOwnerTenantBindings: { "google-oauth2|owner-member": "owner-tenant" },
    oauthTenantMemberships: {
      "google-oauth2|owner-member": { tenantId: "other-tenant", role: "operator" },
    },
    godModeEnabled: false,
  }, { jwksCache: fixture.cache })(`Bearer ${fixture.token}`);

  assert.equal(identity.tenantId, "owner-tenant");
  assert.equal(identity.role, "member");
  assert.equal(identity.oauthOwnerBound, true);
  assert.equal(identity.oauthTenantMemberBound, undefined);
});

test("accepts the browser audience only when the browser authenticator explicitly selects it", async () => {
  const fixture = auth0Fixture({ aud: "https://browser-api", scope: "openid" });
  const browserConfig = { ...fixture.config, auth0Audience: "https://mcp-api", codexKeys: [], godModeEnabled: false };
  const browserAuth = createAuthenticator(browserConfig, { audience: "https://browser-api", jwksCache: fixture.cache });
  await assert.doesNotReject(browserAuth(`Bearer ${fixture.token}`));
  const mcpAuth = createAuthenticator(browserConfig, { jwksCache: fixture.cache });
  await assert.rejects(mcpAuth(`Bearer ${fixture.token}`), /jwt_audience_invalid/);
});

test("merges Auth0 scope and permissions claims without duplicates", async () => {
  const { token, config, cache } = auth0Fixture({
    scope: "openid core:read core:govern",
    permissions: ["workspace:write", "core:govern"],
  });
  const identity = await verifyAuth0Jwt(token, config, cache);
  assert.deepEqual(identity.scopes, ["openid", "core:read", "core:govern", "workspace:write"]);
  assert.doesNotThrow(() => requireScopes(identity, ["workspace:write", "core:govern"]));
});

test("keeps workspace writes closed when neither Auth0 claim grants workspace:write", async () => {
  const { token, config, cache } = auth0Fixture({
    scope: "core:read core:govern",
    permissions: ["core:govern"],
  });
  const identity = await verifyAuth0Jwt(token, config, cache);
  assert.throws(() => requireScopes(identity, ["workspace:write", "core:govern"]), /insufficient_scope/);
});

test("binds only the configured verified OAuth subject to codexai and keeps it a member", async () => {
  const fixture = auth0Fixture({
    sub: "oauth-owner-fixture",
    iat: Math.floor(Date.now() / 1000),
    auth_time: Math.floor(Date.now() / 1000),
    "https://skinharmony.it/tenant_id": "attacker-tenant",
  });
  const config = {
    ...fixture.config,
    codexKeys: [],
    selfServiceTenantsEnabled: true,
    oauthOwnerTenantBindings: { "oauth-owner-fixture": "codexai" },
    oauthOwnerConfirmationMaxAgeSeconds: 300,
  };
  const auth = createAuthenticator(config, { jwksCache: fixture.cache });
  const identity = await auth(`Bearer ${fixture.token}`);
  assert.equal(identity.tenantId, "codexai");
  assert.equal(identity.role, "member");
  assert.equal(identity.oauthOwnerBound, true);
});

test("elevates the bound owner only once, only when fresh and request-bound", async () => {
  const now = Math.floor(Date.now() / 1000);
  const fixture = auth0Fixture({ sub: "oauth-owner-fixture", iat: now, auth_time: now });
  const auth = createAuthenticator({
    ...fixture.config, codexKeys: [], oauthOwnerTenantBindings: { "oauth-owner-fixture": "codexai" }, oauthOwnerConfirmationMaxAgeSeconds: 300,
  }, { jwksCache: fixture.cache });
  const identity = await auth(`Bearer ${fixture.token}`);
  assert.throws(() => auth.elevateOAuthOwner(identity, { confirmed: false, confirmationReference: "r1", requestBinding: "request-a" }), /owner_confirmation_required/);
  const elevated = auth.elevateOAuthOwner(identity, { confirmed: true, confirmationReference: "r1", requestBinding: "request-a" });
  assert.equal(elevated.role, "tenant_owner");
  assert.equal(elevated.oauthOwnerElevated, true);
  assert.throws(() => auth.elevateOAuthOwner(identity, { confirmed: true, confirmationReference: "r1", requestBinding: "request-a" }), /owner_confirmation_replayed/);
  assert.doesNotThrow(() => auth.elevateOAuthOwner(identity, { confirmed: true, confirmationReference: "r1", requestBinding: "request-b" }));
});

test("manual Authority derives a gateway JTI, binds it to the confirmation, and consumes it across request bindings", async () => {
  const now = Math.floor(Date.now() / 1000);
  const fixture = auth0Fixture({ sub: "oauth-owner-fixture", iat: now, auth_time: now });
  const ownerContextSigningSecret = "manual-authority-owner-context-signing-secret-0123456789";
  const auth = createAuthenticator({
    ...fixture.config,
    codexKeys: [],
    oauthOwnerTenantBindings: { "oauth-owner-fixture": "codexai" },
    oauthOwnerConfirmationMaxAgeSeconds: 300,
    ownerContextSigningSecret,
  }, { jwksCache: fixture.cache });
  const identity = await auth(`Bearer ${fixture.token}`);
  const confirmationReference = "authorize verified manual GitHub reconciliation";
  const proof = {
    confirmed: true,
    confirmationReference,
    requestBinding: "owner_manual_effect_issue:github.merge:owner/repo",
  };

  // Existing owner elevation remains request-bound and does not receive a
  // Manual Authority JTI unless the trusted server path opts in explicitly.
  const ordinary = auth.elevateOAuthOwner(identity, proof);
  assert.equal(ordinary.ownerConfirmationJti, undefined);

  assert.throws(() => auth.elevateOAuthOwner(identity, {
    ...proof,
    ownerConfirmationJti: "ocj_caller_controlled",
  }, { manualAuthority: true }), /owner_confirmation_jti_caller_supplied/);

  const elevated = auth.elevateOAuthOwner(identity, proof, { manualAuthority: true });
  const expected = `ocj_${crypto.createHmac("sha256", ownerContextSigningSecret).update([
    "skinharmony-owner-manual-authority-oauth-confirmation-jti-v1",
    "codexai",
    "oauth-owner-fixture",
    crypto.createHash("sha256").update(confirmationReference).digest("hex"),
  ].join("\u0000")).digest("hex")}`;
  assert.equal(elevated.ownerConfirmationJti, expected);
  assert.match(elevated.ownerConfirmationJti, /^ocj_[a-f0-9]{64}$/);

  // A transport retry of the exact request remains recoverable. The durable
  // Universal Core nonce/idempotency store, not this process-local cache,
  // decides whether that retry replays a completed closure.
  const exactRetry = auth.elevateOAuthOwner(identity, proof, { manualAuthority: true });
  assert.equal(exactRetry.ownerConfirmationJti, elevated.ownerConfirmationJti);

  assert.throws(() => auth.elevateOAuthOwner(identity, {
    ...proof,
    requestBinding: "owner_manual_effect_issue:render.deploy:service-a",
  }, { manualAuthority: true }), /owner_confirmation_replayed/);

  const changedConfirmation = auth.elevateOAuthOwner(identity, {
    ...proof,
    confirmationReference: "authorize a distinct verified manual effect",
    requestBinding: "owner_manual_effect_issue:render.deploy:service-a",
  }, { manualAuthority: true });
  assert.notEqual(changedConfirmation.ownerConfirmationJti, elevated.ownerConfirmationJti);
});

test("manual Authority fails closed without the owner-context issuer while ordinary OAuth elevation remains compatible", async () => {
  const now = Math.floor(Date.now() / 1000);
  const fixture = auth0Fixture({ sub: "oauth-owner-fixture", iat: now, auth_time: now });
  const auth = createAuthenticator({
    ...fixture.config,
    codexKeys: [],
    oauthOwnerTenantBindings: { "oauth-owner-fixture": "codexai" },
    oauthOwnerConfirmationMaxAgeSeconds: 300,
  }, { jwksCache: fixture.cache });
  const identity = await auth(`Bearer ${fixture.token}`);
  const proof = {
    confirmed: true,
    confirmationReference: "ordinary verified owner action",
    requestBinding: "ordinary-owner-action",
  };

  assert.doesNotThrow(() => auth.elevateOAuthOwner(identity, proof));
  assert.throws(() => auth.elevateOAuthOwner(identity, {
    ...proof,
    confirmationReference: "manual authority action",
  }, { manualAuthority: true }), /owner_confirmation_jti_issuer_unavailable/);
});

test("manual Authority JTI is stable across authenticator restart boundaries while Core owns durable consumption", async () => {
  const now = Math.floor(Date.now() / 1000);
  const fixture = auth0Fixture({ sub: "oauth-owner-fixture", iat: now, auth_time: now });
  const config = {
    ...fixture.config,
    codexKeys: [],
    oauthOwnerTenantBindings: { "oauth-owner-fixture": "codexai" },
    oauthOwnerConfirmationMaxAgeSeconds: 300,
    ownerContextSigningSecret: "manual-authority-restart-owner-context-secret-0123456789",
  };
  const firstAuthenticator = createAuthenticator(config, { jwksCache: fixture.cache });
  const firstIdentity = await firstAuthenticator(`Bearer ${fixture.token}`);
  const proof = {
    confirmed: true,
    confirmationReference: "restart-stable manual owner confirmation",
    requestBinding: "owner_manual_effect_issue:first-binding",
  };
  const first = firstAuthenticator.elevateOAuthOwner(
    firstIdentity,
    proof,
    { manualAuthority: true },
  );
  assert.throws(() => firstAuthenticator.elevateOAuthOwner(firstIdentity, {
    ...proof,
    requestBinding: "owner_manual_effect_issue:changed-binding",
  }, { manualAuthority: true }), /owner_confirmation_replayed/);

  // Auth's local replay cache is intentionally process-local.  A restarted
  // authenticator reconstructs the same cryptographic JTI; Universal Core's
  // durable authority store is the cross-process consumption authority.
  const restartedAuthenticator = createAuthenticator(config, { jwksCache: fixture.cache });
  const restartedIdentity = await restartedAuthenticator(`Bearer ${fixture.token}`);
  const restarted = restartedAuthenticator.elevateOAuthOwner(
    restartedIdentity,
    { ...proof, requestBinding: "owner_manual_effect_issue:after-restart" },
    { manualAuthority: true },
  );
  assert.equal(restarted.ownerConfirmationJti, first.ownerConfirmationJti);
});

test("uses the current OAuth access-token issuance for owner freshness after a refresh", async () => {
  const now = Math.floor(Date.now() / 1000);
  const fixture = auth0Fixture({
    sub: "oauth-owner-fixture",
    iat: now,
    // Auth0 preserves the original interactive-login time on refreshed
    // access tokens. It must not make a current, verified token unusable.
    auth_time: now - 86_400,
  });
  const auth = createAuthenticator({
    ...fixture.config,
    codexKeys: [],
    oauthOwnerTenantBindings: { "oauth-owner-fixture": "codexai" },
    oauthOwnerConfirmationMaxAgeSeconds: 300,
  }, { jwksCache: fixture.cache });
  const identity = await auth(`Bearer ${fixture.token}`);

  assert.equal(identity.authenticatedAt, now - 86_400);
  assert.equal(identity.tokenIssuedAt, now);
  assert.doesNotThrow(() => auth.elevateOAuthOwner(identity, {
    confirmed: true,
    confirmationReference: "fresh refreshed token",
    requestBinding: "tenant-owner-smoke-run",
  }));
});

test("keeps OAuth owner elevation short and delegates long work to Core leases", async () => {
  const now = Math.floor(Date.now() / 1000);
  const fixture = auth0Fixture({
    sub: "oauth-owner-fixture",
    iat: now - 301,
    auth_time: now - 86_400,
    exp: now + 3_600,
  });
  const auth = createAuthenticator({
    ...fixture.config,
    codexKeys: [],
    oauthOwnerTenantBindings: { "oauth-owner-fixture": "codexai" },
    oauthOwnerConfirmationMaxAgeSeconds: 300,
  }, { jwksCache: fixture.cache });
  const identity = await auth(`Bearer ${fixture.token}`);

  assert.throws(() => auth.elevateOAuthOwner(identity, {
    confirmed: true,
    confirmationReference: "expired OAuth bootstrap",
    requestBinding: "publish-another-draft-pr",
  }), /owner_authentication_stale/);
});

test("rejects impersonation, stale authentication and cross-tenant owner elevation", async () => {
  const stale = auth0Fixture({ sub: "oauth-owner-fixture", iat: 1, auth_time: 1 });
  const config = { ...stale.config, codexKeys: [], oauthOwnerTenantBindings: { "oauth-owner-fixture": "codexai" }, oauthOwnerConfirmationMaxAgeSeconds: 60 };
  const staleAuth = createAuthenticator(config, { jwksCache: stale.cache });
  const staleIdentity = await staleAuth(`Bearer ${stale.token}`);
  assert.throws(() => staleAuth.elevateOAuthOwner(staleIdentity, { confirmed: true, confirmationReference: "stale", requestBinding: "x" }), /owner_authentication_stale/);

  const other = auth0Fixture({ sub: "other-subject", azp: "shared-owner-client", "https://skinharmony.it/tenant_id": "codexai" });
  const otherAuth = createAuthenticator({ ...config, selfServiceTenantsEnabled: true }, { jwksCache: other.cache });
  const otherIdentity = await otherAuth(`Bearer ${other.token}`);
  assert.equal(otherIdentity.tenantId.startsWith("chatgpt_"), true);
  assert.throws(() => otherAuth.elevateOAuthOwner(otherIdentity, { confirmed: true, confirmationReference: "r", requestBinding: "x" }), /owner_binding_required/);
});

test("enforces tool scopes", () => {
  assert.doesNotThrow(() => requireScopes({ scopes: ["core:read"] }, ["core:read"]));
  assert.throws(() => requireScopes({ scopes: ["core:read"] }, ["core:govern"]), /insufficient_scope/);
});

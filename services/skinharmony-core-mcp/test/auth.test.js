import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createAuthenticator, requireScopes, verifyAuth0Jwt } from "../src/auth.js";

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
  assert.deepEqual(await auth("Bearer secret"), { kind: "codex", subject: "codex", tenantId: "owner-private", scopes: ["core:read"] });
  await assert.rejects(auth("Bearer wrong"), /bearer_invalid/);
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

test("the emergency stop disables owner_root immediately", async () => {
  const auth = createAuthenticator({
    codexKeys: ["secret"], codexScopes: ["core:read"], auth0Issuer: "",
    defaultTenantId: "owner-private", supportedScopes: ["core:read", "core:govern"],
    godModeEnabled: true, godModeEmergencyStop: true, godModeTenantIds: ["owner-private", "codexai"],
    godModeSubjects: [], godModeClientIds: [], godModeCodexEnabled: true,
  });
  assert.deepEqual(await auth("Bearer secret"), {
    kind: "codex", subject: "codex", tenantId: "owner-private", scopes: ["core:read"],
  });
});

test("never auto-elevates an OAuth subject to owner_root or god mode", async () => {
  const ownerSubject = "google-oauth2|owner";
  const ownerFixture = auth0Fixture({
    sub: ownerSubject,
    scope: "core:read",
    azp: "dynamic-chatgpt-client",
    "https://skinharmony.it/tenant_id": "codexai",
  });
  const ownerConfig = {
    ...ownerFixture.config,
    codexKeys: [],
    supportedScopes: ["core:read", "core:govern", "workspace:write"],
    godModeEnabled: true,
    godModeEmergencyStop: false,
    godModeTenantIds: ["owner-private", "codexai"],
    godModeSubjects: [ownerSubject],
    godModeClientIds: [],
    godModeCodexEnabled: true,
  };
  const ownerIdentity = await createAuthenticator(ownerConfig, { jwksCache: ownerFixture.cache })(`Bearer ${ownerFixture.token}`);
  assert.equal(ownerIdentity.role, "member");
  assert.equal(ownerIdentity.godMode, undefined);
  assert.equal(ownerIdentity.providerSetupOwner, undefined);
  assert.equal(ownerIdentity.clientId, "dynamic-chatgpt-client");

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
  assert.equal(otherIdentity.providerSetupOwner, undefined);
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
  assert.equal(identity.providerSetupOwner, undefined);
});

test("grants provider setup only to a tenant-owner role in the verified token", async () => {
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
  assert.equal(identity.providerSetupOwner, undefined);

  const memberFixture = auth0Fixture({ "https://skinharmony.it/role": "member" });
  const member = await createAuthenticator({
    ...memberFixture.config,
    tenantOwnerRoleClaim: "https://skinharmony.it/role",
    tenantOwnerRoles: ["tenant_owner"], codexKeys: [], godModeEnabled: false,
  }, { jwksCache: memberFixture.cache })(`Bearer ${memberFixture.token}`);
  assert.equal(member.providerSetupOwner, undefined);
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
  assert.equal(first.providerSetupOwner, undefined);
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
  assert.equal(identity.providerSetupOwner, undefined);
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
  assert.equal(identity.providerSetupOwner, undefined);
});

test("elevates the bound owner only once, only when fresh and request-bound", async () => {
  const now = Math.floor(Date.now() / 1000);
  const fixture = auth0Fixture({ sub: "oauth-owner-fixture", iat: now, auth_time: now });
  const consumed = new Set();
  const ledger = { consume: async ({ reference }) => { if (consumed.has(reference)) throw new Error("owner_confirmation_replayed"); consumed.add(reference); } };
  const auth = createAuthenticator({
    ...fixture.config, codexKeys: [], oauthOwnerTenantBindings: { "oauth-owner-fixture": "codexai" }, oauthOwnerConfirmationMaxAgeSeconds: 300,
  }, { jwksCache: fixture.cache, ownerConfirmationLedger: ledger });
  const identity = await auth(`Bearer ${fixture.token}`);
  await assert.rejects(() => auth.elevateOAuthOwner(identity, { confirmed: false, confirmationReference: "r1", requestBinding: "request-a" }), /owner_confirmation_required/);
  const elevated = await auth.elevateOAuthOwner(identity, { confirmed: true, confirmationReference: "r1", requestBinding: "request-a" });
  assert.equal(elevated.role, "tenant_owner");
  assert.equal(elevated.providerSetupOwner, true);
  await assert.rejects(() => auth.elevateOAuthOwner(identity, { confirmed: true, confirmationReference: "r1", requestBinding: "request-a" }), /owner_confirmation_replayed/);
  await assert.rejects(() => auth.elevateOAuthOwner(identity, { confirmed: true, confirmationReference: "r1", requestBinding: "request-b" }), /owner_confirmation_replayed/);
  const secondAuth = createAuthenticator({
    ...fixture.config, codexKeys: [], oauthOwnerTenantBindings: { "oauth-owner-fixture": "codexai" }, oauthOwnerConfirmationMaxAgeSeconds: 300,
  }, { jwksCache: fixture.cache, ownerConfirmationLedger: ledger });
  const secondIdentity = await secondAuth(`Bearer ${fixture.token}`);
  await assert.rejects(() => secondAuth.elevateOAuthOwner(secondIdentity, { confirmed: true, confirmationReference: "r1", requestBinding: "another-tool" }), /owner_confirmation_replayed/);
});

test("rejects impersonation, stale authentication and cross-tenant owner elevation", async () => {
  const stale = auth0Fixture({ sub: "oauth-owner-fixture", iat: 1, auth_time: 1 });
  const config = { ...stale.config, codexKeys: [], oauthOwnerTenantBindings: { "oauth-owner-fixture": "codexai" }, oauthOwnerConfirmationMaxAgeSeconds: 60 };
  const staleAuth = createAuthenticator(config, { jwksCache: stale.cache });
  const staleIdentity = await staleAuth(`Bearer ${stale.token}`);
  await assert.rejects(() => staleAuth.elevateOAuthOwner(staleIdentity, { confirmed: true, confirmationReference: "stale", requestBinding: "x" }), /owner_authentication_stale/);

  const other = auth0Fixture({ sub: "other-subject", azp: "shared-owner-client", "https://skinharmony.it/tenant_id": "codexai" });
  const otherAuth = createAuthenticator({ ...config, selfServiceTenantsEnabled: true }, { jwksCache: other.cache });
  const otherIdentity = await otherAuth(`Bearer ${other.token}`);
  assert.equal(otherIdentity.tenantId.startsWith("chatgpt_"), true);
  await assert.rejects(() => otherAuth.elevateOAuthOwner(otherIdentity, { confirmed: true, confirmationReference: "r", requestBinding: "x" }), /owner_binding_required/);

  const missing = auth0Fixture({ sub: "oauth-owner-fixture", iat: Math.floor(Date.now() / 1000) });
  const missingAuth = createAuthenticator({ ...config }, { jwksCache: missing.cache });
  const missingIdentity = await missingAuth(`Bearer ${missing.token}`);
  await assert.rejects(() => missingAuth.elevateOAuthOwner(missingIdentity, { confirmed: true, confirmationReference: "missing", requestBinding: "x" }), /owner_authentication_stale/);
  const future = auth0Fixture({ sub: "oauth-owner-fixture", auth_time: Math.floor(Date.now() / 1000) + 600 });
  const futureAuth = createAuthenticator({ ...config }, { jwksCache: future.cache });
  const futureIdentity = await futureAuth(`Bearer ${future.token}`);
  await assert.rejects(() => futureAuth.elevateOAuthOwner(futureIdentity, { confirmed: true, confirmationReference: "future", requestBinding: "x" }), /owner_authentication_stale/);
});

test("enforces tool scopes", () => {
  assert.doesNotThrow(() => requireScopes({ scopes: ["core:read"] }, ["core:read"]));
  assert.throws(() => requireScopes({ scopes: ["core:read"] }, ["core:govern"]), /insufficient_scope/);
});

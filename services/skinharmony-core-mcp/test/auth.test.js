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
    godModeTenantId: "owner-private",
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
    godModeEnabled: true, godModeEmergencyStop: true, godModeTenantId: "owner-private",
    godModeSubjects: [], godModeClientIds: [], godModeCodexEnabled: true,
  });
  assert.deepEqual(await auth("Bearer secret"), {
    kind: "codex", subject: "codex", tenantId: "owner-private", scopes: ["core:read"],
  });
});

test("verifies Auth0 RS256 issuer, audience, expiry and scopes", async () => {
  const { token, config, cache } = auth0Fixture({ scope: "core:read" });
  assert.deepEqual(await verifyAuth0Jwt(token, config, cache), { kind: "oauth", subject: "chatgpt", tenantId: "tenant-a", scopes: ["core:read"] });
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

test("enforces tool scopes", () => {
  assert.doesNotThrow(() => requireScopes({ scopes: ["core:read"] }, ["core:read"]));
  assert.throws(() => requireScopes({ scopes: ["core:read"] }, ["core:govern"]), /insufficient_scope/);
});

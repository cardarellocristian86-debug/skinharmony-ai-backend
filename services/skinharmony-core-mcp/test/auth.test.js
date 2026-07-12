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

test("accepts a scoped Codex bearer without exposing it", async () => {
  const auth = createAuthenticator({ codexKeys: ["secret"], codexScopes: ["core:read"], auth0Issuer: "", defaultTenantId: "owner-private" });
  assert.deepEqual(await auth("Bearer secret"), { kind: "codex", subject: "codex", tenantId: "owner-private", scopes: ["core:read"] });
  await assert.rejects(auth("Bearer wrong"), /bearer_invalid/);
});

test("verifies Auth0 RS256 issuer, audience, expiry and scopes", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "test-key";
  const config = { auth0Issuer: "https://tenant.auth0.com", auth0Audience: "https://core", jwksUri: "https://tenant.auth0.com/.well-known/jwks.json", tenantClaim: "https://skinharmony.it/tenant_id" };
  const token = jwt(privateKey, jwk.kid, { iss: `${config.auth0Issuer}/`, aud: config.auth0Audience, sub: "chatgpt", exp: Math.floor(Date.now() / 1000) + 60, scope: "core:read", "https://skinharmony.it/tenant_id": "tenant-a" });
  const cache = { get: async () => jwk };
  assert.deepEqual(await verifyAuth0Jwt(token, config, cache), { kind: "oauth", subject: "chatgpt", tenantId: "tenant-a", scopes: ["core:read"] });
});

test("enforces tool scopes", () => {
  assert.doesNotThrow(() => requireScopes({ scopes: ["core:read"] }, ["core:read"]));
  assert.throws(() => requireScopes({ scopes: ["core:read"] }, ["core:govern"]), /insufficient_scope/);
});

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createOpenAiConnectPortal } from "../src/openai-connect-portal.js";

const config = { auth0Issuer: "https://tenant.auth0.com", auth0Audience: "https://core/mcp", auth0BrowserAudience: "https://core/browser", auth0BrowserClientId: "browser-client", auth0BrowserCallbackUrl: "https://mcp.example.test/connect/openai/callback", auth0BrowserStateSecret: "test-state-secret" };
async function serve(portal, run) { const app = express(); app.get("/connect/openai", portal.start); app.get("/connect/openai/callback", portal.callback); app.get("/connect/openai/continue", portal.continue); const server = app.listen(0); await new Promise((r) => server.once("listening", r)); try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); } }

test("uses Authorization Code PKCE, authenticates the owner, and scopes setup link to the authenticated tenant", async () => {
  let issuedFor = null;
  const portal = createOpenAiConnectPortal({ config, fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }), authenticate: async () => ({ tenantId: "codexai", godMode: true, role: "owner_root" }), providerStatus: async (tenant) => ({ provider: { configured: tenant === "codexai" } }), issueSetupLink: async (tenant) => { issuedFor = tenant; return { setup_url: "https://core.example.test/setup/opaque-token" }; } });
  await serve(portal, async (base) => {
    const start = await fetch(`${base}/connect/openai`, { redirect: "manual" });
    assert.equal(start.status, 302); const authorization = new URL(start.headers.get("location"));
    assert.equal(authorization.searchParams.get("audience"), config.auth0BrowserAudience);
    assert.notEqual(authorization.searchParams.get("audience"), config.auth0Audience);
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256"); assert(authorization.searchParams.get("code_challenge"));
    const cookie = start.headers.get("set-cookie").split(";")[0];
    const callback = await fetch(`${base}/connect/openai/callback?code=opaque-code&state=${authorization.searchParams.get("state")}`, { headers: { cookie }, redirect: "manual" });
    assert.equal(callback.status, 303); const ownerCookie = callback.headers.get("set-cookie").split(";")[0];
    const connected = await fetch(`${base}/connect/openai`, { headers: { cookie: ownerCookie } }); assert.match(await connected.text(), /OpenAI già collegato/);
    const next = await fetch(`${base}/connect/openai/continue`, { headers: { cookie: ownerCookie }, redirect: "manual" }); assert.equal(next.headers.get("location"), "https://core.example.test/setup/opaque-token"); assert.equal(issuedFor, "codexai");
  });
});

test("rejects CSRF state mismatch, expired state, and non-owner callback without exposing secrets", async () => {
  let clock = 0; const portal = createOpenAiConnectPortal({ config, now: () => clock, fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }), authenticate: async () => ({ tenantId: "other", godMode: false }), providerStatus: async () => ({}), issueSetupLink: async () => ({}) });
  await serve(portal, async (base) => { const start = await fetch(`${base}/connect/openai`, { redirect: "manual" }); const cookie = start.headers.get("set-cookie").split(";")[0]; const bad = await fetch(`${base}/connect/openai/callback?code=x&state=bad`, { headers: { cookie } }); assert.equal(bad.status, 400); clock = 700_000; const expired = await fetch(`${base}/connect/openai/callback?code=x&state=bad`, { headers: { cookie } }); assert.equal(expired.status, 400); });
});


test("shows a safe actionable reason when Auth0 omits the tenant claim", async () => {
  const portal = createOpenAiConnectPortal({ config, fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }), authenticate: async () => { throw new Error("jwt_tenant_missing"); }, providerStatus: async () => ({}), issueSetupLink: async () => ({}) });
  await serve(portal, async (base) => {
    const start = await fetch(`${base}/connect/openai`, { redirect: "manual" });
    const authorization = new URL(start.headers.get("location"));
    const cookie = start.headers.get("set-cookie").split(";")[0];
    const callback = await fetch(`${base}/connect/openai/callback?code=opaque-code&state=${authorization.searchParams.get("state")}`, { headers: { cookie } });
    assert.equal(callback.status, 403);
    const html = await callback.text();
    assert.match(html, /manca il tenant nel token Auth0/);
    assert.doesNotMatch(html, /opaque-code|access_token/);
  });
});

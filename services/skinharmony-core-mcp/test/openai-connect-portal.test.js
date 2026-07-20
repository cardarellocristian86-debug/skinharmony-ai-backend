import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createOpenAiConnectPortal } from "../src/openai-connect-portal.js";

const setupToken = "a".repeat(32);
const setupProof = "p".repeat(40);
const setupLinkId = `psl_${"l".repeat(24)}`;
const config = {
  auth0Issuer: "https://tenant.auth0.com",
  auth0Audience: "https://core/mcp",
  auth0BrowserAudience: "https://core/browser",
  auth0BrowserClientId: "browser-client",
  auth0BrowserCallbackUrl: "https://mcp.example.test/connect/openai/callback",
  auth0BrowserStateSecret: "test-state-secret-for-owner-portal-0123456789",
  universalCoreUrl: "https://core.example.test",
};

function ownerIdentity(overrides = {}) {
  return {
    kind: "oauth",
    subject: "google-oauth2|owner-test",
    tenantId: "codexai",
    godMode: true,
    role: "owner_root",
    providerSetupOwner: true,
    ...overrides,
  };
}

function issuedSetupLink(overrides = {}) {
  return {
    ok: true,
    tenant_id: "codexai",
    setup_url: `https://core.example.test/v1/generic-agents/providers/openai/setup/${setupToken}`,
    setup_proof: setupProof,
    link_id: setupLinkId,
    expires_at: "2030-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function serve(portal, run) {
  const app = express();
  app.get("/connect/openai", portal.start);
  app.get("/connect/openai/callback", portal.callback);
  app.post("/connect/openai/continue", express.urlencoded({ extended: false }), portal.continue);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("uses Authorization Code PKCE and sends the verified owner directly to a one-time setup link", async () => {
  let issuedFor = null;
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    providerStatus: async (tenant) => ({ provider: { configured: tenant === "codexai" } }),
    issueSetupLink: async (identity) => {
      issuedFor = identity;
      return issuedSetupLink();
    },
  });
  await serve(portal, async (base) => {
    const start = await fetch(`${base}/connect/openai`, { redirect: "manual" });
    assert.equal(start.status, 302);
    const authorization = new URL(start.headers.get("location"));
    assert.equal(authorization.searchParams.get("audience"), config.auth0BrowserAudience);
    assert.notEqual(authorization.searchParams.get("audience"), config.auth0Audience);
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert(authorization.searchParams.get("code_challenge"));
    const callback = await fetch(
      `${base}/connect/openai/callback?code=opaque-code&state=${authorization.searchParams.get("state")}`,
      { redirect: "manual" },
    );
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), `${issuedSetupLink().setup_url}#proof=${setupProof}`);
    assert.deepEqual(issuedFor, ownerIdentity());
    assert.doesNotMatch(callback.headers.get("location"), /tenant_id|google-oauth2/);
    assert.equal(callback.headers.get("set-cookie"), null);
  });
});

test("completes the Auth0 callback when a privacy browser discards the initial cookie", async () => {
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    providerStatus: async () => ({ provider: { configured: false } }),
    issueSetupLink: async () => issuedSetupLink(),
  });
  await serve(portal, async (base) => {
    const start = await fetch(`${base}/connect/openai`, { redirect: "manual" });
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const callback = await fetch(`${base}/connect/openai/callback?code=opaque-code&state=${encodeURIComponent(state)}`, { redirect: "manual" });
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), `${issuedSetupLink().setup_url}#proof=${setupProof}`);
    assert.equal(callback.headers.get("set-cookie"), null);
  });
});

test("rejects CSRF state mismatch, expired state, and non-owner callback without exposing secrets", async () => {
  let clock = 0;
  const portal = createOpenAiConnectPortal({
    config,
    now: () => clock,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity({ godMode: false, providerSetupOwner: false, role: "standard" }),
    providerStatus: async () => ({}),
    issueSetupLink: async () => ({}),
  });
  await serve(portal, async (base) => {
    const start = await fetch(`${base}/connect/openai`, { redirect: "manual" });
    const bad = await fetch(`${base}/connect/openai/callback?code=x&state=bad`);
    assert.equal(bad.status, 400);
    clock = 700_000;
    const expired = await fetch(`${base}/connect/openai/callback?code=x&state=bad`);
    assert.equal(expired.status, 400);

    clock = 0;
    const fresh = await fetch(`${base}/connect/openai`, { redirect: "manual" });
    const authorization = new URL(fresh.headers.get("location"));
    const nonOwner = await fetch(
      `${base}/connect/openai/callback?code=opaque-code&state=${authorization.searchParams.get("state")}`,
    );
    assert.equal(nonOwner.status, 403);
    assert.doesNotMatch(await nonOwner.text(), /opaque-code|access_token/);
  });
});

test("shows a safe actionable reason when Auth0 omits the tenant claim", async () => {
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => { throw new Error("jwt_tenant_missing"); },
    providerStatus: async () => ({}),
    issueSetupLink: async () => ({}),
  });
  await serve(portal, async (base) => {
    const start = await fetch(`${base}/connect/openai`, { redirect: "manual" });
    const authorization = new URL(start.headers.get("location"));
    const callback = await fetch(
      `${base}/connect/openai/callback?code=opaque-code&state=${authorization.searchParams.get("state")}`,
    );
    assert.equal(callback.status, 403);
    const html = await callback.text();
    assert.match(html, /manca il tenant nel token Auth0/);
    assert.doesNotMatch(html, /opaque-code|access_token/);
  });
});

test("shows a safe activation message when the dedicated setup-link credential is not ready", async () => {
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    providerStatus: async () => ({ provider: { configured: false } }),
    issueSetupLink: async () => { throw new Error("provider_setup_link_scope_required"); },
  });
  await serve(portal, async (base) => {
    const start = await fetch(`${base}/connect/openai`, { redirect: "manual" });
    const authorization = new URL(start.headers.get("location"));
    const failed = await fetch(`${base}/connect/openai/callback?code=opaque-code&state=${authorization.searchParams.get("state")}`);
    const html = await failed.text();
    assert.equal(failed.status, 503);
    assert.match(html, /Collegamento in preparazione/);
    assert.doesNotMatch(html, /scope_required|codexai|token/);
  });
});

test("rejects unsafe Core redirects and makes stale Continue pages harmless", async () => {
  let issued = 0;
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    providerStatus: async () => { throw new Error("normal_core_key_unavailable"); },
    issueSetupLink: async () => {
      issued += 1;
      return issuedSetupLink({ setup_url: "https://attacker.example/setup/opaque" });
    },
  });
  await serve(portal, async (base) => {
    const getAttempt = await fetch(`${base}/connect/openai/continue`, { redirect: "manual" });
    assert.equal(getAttempt.status, 404);
    const stalePost = await fetch(`${base}/connect/openai/continue`, {
      method: "POST",
    });
    assert.equal(stalePost.status, 410);
    assert.equal(issued, 0);
    const start = await fetch(`${base}/connect/openai`, { redirect: "manual" });
    const authorization = new URL(start.headers.get("location"));
    const unsafeCallback = await fetch(`${base}/connect/openai/callback?code=opaque-code&state=${authorization.searchParams.get("state")}`);
    assert.equal(unsafeCallback.status, 503);
    assert.equal(unsafeCallback.headers.get("location"), null);
    assert.doesNotMatch(await unsafeCallback.text(), new RegExp(setupProof));
    assert.equal(issued, 1);
  });
});

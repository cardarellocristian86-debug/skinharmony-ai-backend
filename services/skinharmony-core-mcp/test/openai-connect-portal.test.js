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
  app.get("/mobile/agents", portal.agentsHome);
  app.get("/mobile/agents/login", portal.agentsLogin);
  app.post("/mobile/agents/run", express.urlencoded({ extended: false }), portal.agentsRunStart);
  app.get("/mobile/agents/runs/:runId", portal.agentsRunRead);
  app.post("/mobile/agents/runs/:runId/cancel", express.urlencoded({ extended: false }), portal.agentsRunCancel);
  app.post("/mobile/agents/logout", express.urlencoded({ extended: false }), portal.agentsLogout);
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

test("runs the bounded tenant multi-agent flow from a secure iPhone portal session", async () => {
  const calls = [];
  const runId = "run_iphone_owner_1";
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity({ role: "tenant_owner", godMode: false }),
    issueSetupLink: async () => issuedSetupLink(),
    providerStatus: async (_args, identity) => {
      calls.push({ operation: "status", identity });
      return { structuredContent: { ok: true, provider: { configured: true, execution_available: true } } };
    },
    startMultiAgentRun: async (args, identity) => {
      calls.push({ operation: "start", args, identity });
      return { structuredContent: { ok: true, run: { run_id: runId, status: "running", stages: [] } } };
    },
    readMultiAgentRun: async (args, identity) => {
      calls.push({ operation: "read", args, identity });
      return { structuredContent: {
        ok: true,
        run: {
          run_id: runId,
          status: "completed",
          final_output: "<script>alert('no')</script> risultato sicuro",
          stages: [{ role: "Nyra", status: "completed", output: "<b>test</b>" }],
        },
      } };
    },
    cancelMultiAgentRun: async (args, identity) => {
      calls.push({ operation: "cancel", args, identity });
      return { structuredContent: { ok: true, run: { run_id: runId, status: "cancelled" } } };
    },
  });

  await serve(portal, async (base) => {
    const anonymous = await fetch(`${base}/mobile/agents`);
    assert.equal(anonymous.status, 200);
    assert.match(await anonymous.text(), /Accedi e continua/);

    const login = await fetch(`${base}/mobile/agents/login`, { redirect: "manual" });
    assert.equal(login.status, 302);
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(
      `${base}/connect/openai/callback?code=opaque-code&state=${authorization.searchParams.get("state")}`,
      { redirect: "manual" },
    );
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), "/mobile/agents");
    const setCookie = callback.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Lax/);
    const sessionCookie = setCookie.split(";")[0];

    const home = await fetch(`${base}/mobile/agents`, { headers: { cookie: sessionCookie } });
    assert.equal(home.status, 200);
    const homeHtml = await home.text();
    assert.match(homeHtml, /Researcher → Reviewer → Nyra/);
    assert.match(homeHtml, /name="task" maxlength="300"/);
    const csrf = homeHtml.match(/name="csrf" value="([A-Za-z0-9_-]+)"/)?.[1];
    assert(csrf);

    const denied = await fetch(`${base}/mobile/agents/run`, {
      method: "POST",
      headers: { cookie: sessionCookie, origin: "https://attacker.test", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, confirmed: "yes", task: "Test tenant isolato" }),
    });
    assert.equal(denied.status, 403);
    assert.equal(calls.filter((call) => call.operation === "start").length, 0);

    const started = await fetch(`${base}/mobile/agents/run`, {
      method: "POST",
      headers: { cookie: sessionCookie, origin: "https://mcp.example.test", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrf,
        confirmed: "yes",
        task: "Test tenant isolato",
        tenant_id: "tenant-victim",
        api_key: "must-not-be-forwarded",
        model: "caller-model",
      }),
    });
    assert.equal(started.status, 202);
    const startCall = calls.find((call) => call.operation === "start");
    assert.deepEqual(startCall.args, { task: "Test tenant isolato" });
    assert.equal(startCall.identity.tenantId, "codexai");
    assert.equal(startCall.identity.providerExecutionConfirmed, true);
    assert.match(startCall.identity.providerExecutionConfirmationReference, /^iphone_portal_[a-f0-9]{32}$/);
    assert.equal(JSON.stringify(startCall).includes("tenant-victim"), false);
    assert.equal(JSON.stringify(startCall).includes("must-not-be-forwarded"), false);

    const read = await fetch(`${base}/mobile/agents/runs/${runId}`, { headers: { cookie: sessionCookie } });
    assert.equal(read.status, 200);
    const readHtml = await read.text();
    assert.doesNotMatch(readHtml, /<script>|<b>test<\/b>/);
    assert.match(readHtml, /&lt;script&gt;alert\(&#39;no&#39;\)&lt;\/script&gt;/);
    assert.match(readHtml, /&lt;b&gt;test&lt;\/b&gt;/);

    const cancelled = await fetch(`${base}/mobile/agents/runs/${runId}/cancel`, {
      method: "POST",
      headers: { cookie: sessionCookie, origin: "https://mcp.example.test", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf }),
    });
    assert.equal(cancelled.status, 200);
    const cancelCall = calls.find((call) => call.operation === "cancel");
    assert.deepEqual(cancelCall.args, { run_id: runId });
    assert.equal(cancelCall.identity.tenantId, "codexai");

    // Safari privacy modes can omit Origin. SameSite + the secret CSRF token
    // still authorize a same-origin form, while explicit cross-site metadata
    // remains rejected.
    const logout = await fetch(`${base}/mobile/agents/logout`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: sessionCookie, "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf }),
    });
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.get("location"), "/mobile/agents");
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  });
});

test("iPhone portal sends an unconfigured tenant only to the existing secure setup flow", async () => {
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity({ role: "tenant_owner", godMode: false }),
    issueSetupLink: async () => issuedSetupLink(),
    providerStatus: async () => ({ structuredContent: { ok: true, provider: { configured: false, execution_available: false } } }),
    startMultiAgentRun: async () => { throw new Error("must_not_start"); },
    readMultiAgentRun: async () => ({}),
    cancelMultiAgentRun: async () => ({}),
  });
  await serve(portal, async (base) => {
    const login = await fetch(`${base}/mobile/agents/login`, { redirect: "manual" });
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(`${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`, { redirect: "manual" });
    const sessionCookie = callback.headers.get("set-cookie").split(";")[0];
    const home = await fetch(`${base}/mobile/agents`, { headers: { cookie: sessionCookie } });
    const html = await home.text();
    assert.match(html, /href="\/connect\/openai"/);
    assert.match(html, /La chiave OpenAI resta nel vault|non verrà mostrata in chat/i);
    assert.doesNotMatch(html, /codexai|google-oauth2|sk-proj/);
  });
});

test("iPhone portal rejects tampered and expired session cookies", async () => {
  let clock = 0;
  const portal = createOpenAiConnectPortal({
    config,
    now: () => clock,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    issueSetupLink: async () => issuedSetupLink(),
    providerStatus: async () => { throw new Error("must_not_call"); },
  });
  await serve(portal, async (base) => {
    const response = await fetch(`${base}/mobile/agents`, {
      headers: { cookie: "__Host-skinharmony_agents=tampered.value" },
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Accedi e continua/);

    const login = await fetch(`${base}/mobile/agents/login`, { redirect: "manual" });
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(`${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`, { redirect: "manual" });
    const sessionCookie = callback.headers.get("set-cookie").split(";")[0];
    clock = 20 * 60 * 1000 + 1;
    const expired = await fetch(`${base}/mobile/agents`, { headers: { cookie: sessionCookie } });
    assert.match(await expired.text(), /Accedi e continua/);
  });
});

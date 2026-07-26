import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
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
  for (const root of ["/agents", "/mobile/agents"]) {
    app.get(root, portal.agentsHome);
    app.get(`${root}/login`, portal.agentsLogin);
    app.post(`${root}/connect`, express.urlencoded({ extended: false }), portal.agentsConnect);
    app.post(`${root}/run`, express.urlencoded({ extended: false }), portal.agentsRunStart);
    app.get(`${root}/runs/:runId`, portal.agentsRunRead);
    app.post(`${root}/runs/:runId/cancel`, express.urlencoded({ extended: false }), portal.agentsRunCancel);
    app.post(`${root}/logout`, express.urlencoded({ extended: false }), portal.agentsLogout);
  }
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function rawPost(url, { headers = {}, body = "" } = {}) {
  const payload = body instanceof URLSearchParams ? body.toString() : String(body);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: "POST",
      headers: {
        ...headers,
        "content-length": Buffer.byteLength(payload),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const responseHeaders = response.headers;
        resolve({
          status: response.statusCode,
          headers: {
            get(name) {
              const value = responseHeaders[String(name).toLowerCase()];
              return Array.isArray(value) ? value.join(", ") : value ?? null;
            },
          },
          text: async () => Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("error", reject);
    request.end(payload);
  });
}

test("uses Authorization Code PKCE, refreshes the portal session, and sends the verified owner directly to a one-time setup link", async () => {
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
    assert.deepEqual(issuedFor, {
      kind: "oauth",
      subject: ownerIdentity().subject,
      tenantId: "codexai",
      role: "owner_root",
      providerSetupOwner: true,
    });
    assert.doesNotMatch(callback.headers.get("location"), /tenant_id|google-oauth2/);
    const sessionCookie = callback.headers.get("set-cookie");
    assert.match(sessionCookie, /__Host-skinharmony_agents=/);
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /Secure/);
    assert.match(sessionCookie, /SameSite=Lax/);
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
    assert.match(callback.headers.get("set-cookie"), /__Host-skinharmony_agents=/);
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

test("runs the bounded tenant multi-agent flow from a secure cross-client portal session", async () => {
  const calls = [];
  const runId = "run_cross_client_owner_1";
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity({ role: "tenant_owner", godMode: false }),
    issueSetupLink: async () => issuedSetupLink(),
    providerStatus: async (_args, identity) => {
      calls.push({ operation: "status", identity });
      return { structuredContent: { ok: true, tenant_id: identity.tenantId, provider: { configured: true, execution_available: true, bounded_execution_ready: true } } };
    },
    startMultiAgentRun: async (args, identity) => {
      calls.push({ operation: "start", args, identity });
      return { structuredContent: { ok: true, run: { run_id: runId, project_id: "project-test-1", status: "running", stages: [] } } };
    },
    readMultiAgentRun: async (args, identity) => {
      calls.push({ operation: "read", args, identity });
      return { structuredContent: {
        ok: true,
        run: {
          run_id: runId,
          project_id: "project-test-1",
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
    const anonymous = await fetch(`${base}/agents`);
    assert.equal(anonymous.status, 200);
    assert.match(await anonymous.text(), /Accedi e continua/);

    const login = await fetch(`${base}/agents/login`, { redirect: "manual" });
    assert.equal(login.status, 302);
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(
      `${base}/connect/openai/callback?code=opaque-code&state=${authorization.searchParams.get("state")}`,
      { redirect: "manual" },
    );
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), "/agents");
    const setCookie = callback.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Lax/);
    const sessionCookie = setCookie.split(";")[0];

    const home = await fetch(`${base}/agents`, { headers: { cookie: sessionCookie } });
    assert.equal(home.status, 200);
    const homeHtml = await home.text();
    assert.match(homeHtml, /Ricercatore → Architettura\/Codice → Nyra supervisore/);
    assert.match(homeHtml, /cartella progetto persistente e isolata nel tuo tenant/);
    assert.match(homeHtml, /al massimo 3 chiamate OpenAI/);
    assert.match(homeHtml, /name="project_title" minlength="2" maxlength="160" required/);
    assert.match(homeHtml, /name="specialist" required/);
    assert.match(homeHtml, /value="architecture"/);
    assert.match(homeHtml, /value="code"/);
    assert.match(homeHtml, /name="task" maxlength="300"/);
    const csrf = homeHtml.match(/name="csrf" value="([A-Za-z0-9_-]+)"/)?.[1];
    assert(csrf);

    const denied = await fetch(`${base}/agents/run`, {
      method: "POST",
      headers: { cookie: sessionCookie, origin: "https://attacker.test", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf, confirmed: "yes", task: "Test tenant isolato" }),
    });
    assert.equal(denied.status, 403);
    assert.equal(calls.filter((call) => call.operation === "start").length, 0);

    const deniedOpaqueCrossSite = await rawPost(`${base}/agents/run`, {
      headers: {
        cookie: sessionCookie,
        origin: "null",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf, confirmed: "yes", task: "Test tenant isolato" }),
    });
    assert.equal(deniedOpaqueCrossSite.status, 403);
    assert.equal(calls.filter((call) => call.operation === "start").length, 0);

    const missingProject = await rawPost(`${base}/agents/run`, {
      headers: {
        cookie: sessionCookie,
        origin: "null",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf, confirmed: "yes", task: "Test tenant isolato" }),
    });
    assert.equal(missingProject.status, 400);
    assert.equal(calls.filter((call) => call.operation === "start").length, 0);

    const started = await rawPost(`${base}/agents/run`, {
      headers: {
        cookie: sessionCookie,
        origin: "null",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf,
        confirmed: "yes",
        project_title: "Progetto portale sicuro",
        specialist: "architecture",
        task: "Test tenant isolato",
        tenant_id: "tenant-victim",
        api_key: "must-not-be-forwarded",
        model: "caller-model",
      }),
    });
    assert.equal(started.status, 303);
    assert.equal(started.headers.get("location"), `/agents/runs/${runId}`);
    const resumedSessionCookie = started.headers.get("set-cookie").split(";")[0];
    assert.match(resumedSessionCookie, /^__Host-skinharmony_agents=/);
    const startCall = calls.find((call) => call.operation === "start");
    assert.deepEqual(startCall.args, {
      task: "Test tenant isolato",
      project_title: "Progetto portale sicuro",
      project_objective: "Test tenant isolato",
      specialist: "architecture",
    });
    assert.equal(startCall.identity.tenantId, "codexai");
    assert.equal(startCall.identity.providerExecutionConfirmed, true);
    assert.match(startCall.identity.providerExecutionConfirmationReference, /^agent_portal_[a-f0-9]{32}$/);
    assert.equal(JSON.stringify(startCall).includes("tenant-victim"), false);
    assert.equal(JSON.stringify(startCall).includes("must-not-be-forwarded"), false);

    const resumedHome = await fetch(`${base}/agents`, { headers: { cookie: resumedSessionCookie } });
    const resumedHomeHtml = await resumedHome.text();
    assert.match(resumedHomeHtml, /Riprendi ultima esecuzione/);
    assert.match(resumedHomeHtml, new RegExp(`/agents/runs/${runId}`));

    const read = await fetch(`${base}/agents/runs/${runId}`, { headers: { cookie: resumedSessionCookie } });
    assert.equal(read.status, 200);
    const readHtml = await read.text();
    assert.doesNotMatch(readHtml, /<script>|<b>test<\/b>/);
    assert.match(readHtml, /&lt;script&gt;alert\(&#39;no&#39;\)&lt;\/script&gt;/);
    assert.match(readHtml, /&lt;b&gt;test&lt;\/b&gt;/);
    assert.match(readHtml, /<code>project-test-1<\/code>/);
    assert.doesNotMatch(readHtml, /http-equiv="refresh"/);
    assert.doesNotMatch(readHtml, /Annulla esecuzione/);

    const cancelled = await rawPost(`${base}/agents/runs/${runId}/cancel`, {
      headers: {
        cookie: sessionCookie,
        origin: "null",
        "sec-fetch-site": "none",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf }),
    });
    assert.equal(cancelled.status, 200);
    const cancelledHtml = await cancelled.text();
    assert.doesNotMatch(cancelledHtml, /http-equiv="refresh"/);
    assert.doesNotMatch(cancelledHtml, /Annulla esecuzione/);
    const cancelCall = calls.find((call) => call.operation === "cancel");
    assert.deepEqual(cancelCall.args, { run_id: runId });
    assert.equal(cancelCall.identity.tenantId, "codexai");

    // In-app and privacy browsers can omit Origin. SameSite + the secret CSRF token
    // still authorize a same-origin form, while explicit cross-site metadata
    // remains rejected.
    const logout = await rawPost(`${base}/agents/logout`, {
      headers: { cookie: sessionCookie, "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf }),
    });
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.get("location"), "/agents");
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  });
});

test("recovers the sealed last run and refreshes only while it is active", async () => {
  const runId = "run_recover_after_exit";
  let reads = 0;
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    issueSetupLink: async () => issuedSetupLink(),
    providerStatus: async () => ({ structuredContent: {
      ok: true,
      tenant_id: "codexai",
      provider: { configured: true, execution_available: true, bounded_execution_ready: true },
    } }),
    startMultiAgentRun: async () => ({ structuredContent: { ok: true, run: { run_id: runId, project_id: "project-recovery", status: "pending" } } }),
    readMultiAgentRun: async () => {
      reads += 1;
      return { structuredContent: { ok: true, run: reads === 1
        ? { run_id: runId, project_id: "project-recovery", status: "running", stages: [{ role: "researcher", status: "completed" }] }
        : { run_id: runId, project_id: "project-recovery", status: "completed", final_output: "Risultato verificato" } } };
    },
    cancelMultiAgentRun: async () => ({}),
  });

  await serve(portal, async (base) => {
    const login = await fetch(`${base}/agents/login`, { redirect: "manual" });
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(
      `${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`,
      { redirect: "manual" },
    );
    const sessionCookie = callback.headers.get("set-cookie").split(";")[0];
    const homeHtml = await (await fetch(`${base}/agents`, { headers: { cookie: sessionCookie } })).text();
    const csrf = homeHtml.match(/name="csrf" value="([A-Za-z0-9_-]+)"/)?.[1];
    assert(csrf);

    const started = await rawPost(`${base}/agents/run`, {
      headers: {
        cookie: sessionCookie,
        origin: "null",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf,
        confirmed: "yes",
        project_title: "Progetto recupero",
        specialist: "code",
        task: "Verifica recupero dopo uscita",
      }),
    });
    assert.equal(started.status, 303);
    assert.equal(started.headers.get("location"), `/agents/runs/${runId}`);
    const rememberedCookie = started.headers.get("set-cookie").split(";")[0];

    const recovered = await fetch(`${base}/agents`, { headers: { cookie: rememberedCookie } });
    const recoveredHtml = await recovered.text();
    assert.match(recoveredHtml, /Riprendi ultima esecuzione/);
    assert.match(recoveredHtml, new RegExp(`/agents/runs/${runId}`));

    const active = await fetch(`${base}/agents/runs/${runId}`, {
      headers: { cookie: rememberedCookie },
      redirect: "manual",
    });
    assert.equal(active.status, 202);
    assert.equal(active.headers.get("retry-after"), "3");
    const activeHtml = await active.text();
    assert.match(activeHtml, /<code>project-recovery<\/code>/);
    assert.match(activeHtml, new RegExp(`http-equiv="refresh" content="3;url=/agents/runs/${runId}"`));
    assert.match(activeHtml, /Annulla esecuzione/);

    const terminal = await fetch(`${base}/agents/runs/${runId}`, { headers: { cookie: rememberedCookie } });
    assert.equal(terminal.status, 200);
    assert.equal(terminal.headers.get("retry-after"), null);
    const terminalHtml = await terminal.text();
    assert.match(terminalHtml, /Risultato verificato/);
    assert.doesNotMatch(terminalHtml, /http-equiv="refresh"/);
    assert.doesNotMatch(terminalHtml, /Annulla esecuzione/);
  });
});

test("shows only allowlisted terminal run errors", async () => {
  const runId = "run_safe_failure_message";
  let unsafe = false;
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    issueSetupLink: async () => issuedSetupLink(),
    providerStatus: async () => ({ structuredContent: {
      ok: true,
      tenant_id: "codexai",
      provider: { configured: true, execution_available: true, bounded_execution_ready: true },
    } }),
    startMultiAgentRun: async () => ({}),
    readMultiAgentRun: async () => ({ structuredContent: { ok: true, run: {
      run_id: runId,
      status: "failed",
      error_code: unsafe ? "sk-proj-secret-must-never-render" : "openai_provider_rate_limited",
    } } }),
    cancelMultiAgentRun: async () => ({}),
  });

  await serve(portal, async (base) => {
    const login = await fetch(`${base}/agents/login`, { redirect: "manual" });
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(
      `${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`,
      { redirect: "manual" },
    );
    const sessionCookie = callback.headers.get("set-cookie").split(";")[0];

    const allowed = await fetch(`${base}/agents/runs/${runId}`, { headers: { cookie: sessionCookie } });
    const allowedHtml = await allowed.text();
    assert.match(allowedHtml, /OpenAI ha applicato un limite temporaneo/);
    assert.doesNotMatch(allowedHtml, /openai_provider_rate_limited/);

    unsafe = true;
    const unknown = await fetch(`${base}/agents/runs/${runId}`, { headers: { cookie: sessionCookie } });
    const unknownHtml = await unknown.text();
    assert.match(unknownHtml, /dettagli tecnici non sicuri non vengono mostrati/);
    assert.doesNotMatch(unknownHtml, /sk-proj-secret-must-never-render/);
    assert.doesNotMatch(unknownHtml, /Annulla esecuzione/);
  });
});

test("first agent login sends an unconfigured tenant directly to the secure setup form", async () => {
  const issuedFor = [];
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity({ role: "tenant_owner", godMode: false }),
    issueSetupLink: async (identity) => {
      issuedFor.push(identity);
      return issuedSetupLink();
    },
    providerStatus: async () => ({ structuredContent: { ok: true, tenant_id: "codexai", provider: { configured: false, execution_available: false, bounded_execution_ready: false } } }),
    startMultiAgentRun: async () => { throw new Error("must_not_start"); },
    readMultiAgentRun: async () => ({}),
    cancelMultiAgentRun: async () => ({}),
  });
  await serve(portal, async (base) => {
    const login = await fetch(`${base}/agents/login`, { redirect: "manual" });
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(
      `${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`,
      { redirect: "manual" },
    );
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), `${issuedSetupLink().setup_url}#proof=${setupProof}`);
    assert.match(callback.headers.get("set-cookie"), /__Host-skinharmony_agents=/);
    assert.equal(issuedFor.length, 1);
    assert.equal(issuedFor[0].tenantId, "codexai");
    assert.equal(issuedFor[0].subject, ownerIdentity().subject);
    assert.doesNotMatch(callback.headers.get("location"), /codexai|google-oauth2|sk-proj/);
  });
});

test("an unready portal page reuses the tenant-bound owner session through a CSRF-protected POST", async () => {
  let statusChecks = 0;
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity({ role: "tenant_owner", godMode: false }),
    issueSetupLink: async () => issuedSetupLink(),
    providerStatus: async () => {
      statusChecks += 1;
      return { structuredContent: { ok: true, tenant_id: "codexai", provider: statusChecks === 1
        ? { configured: true, execution_available: true, bounded_execution_ready: true }
        : { configured: false, execution_available: false, bounded_execution_ready: false } } };
    },
    startMultiAgentRun: async () => { throw new Error("must_not_start"); },
    readMultiAgentRun: async () => ({}),
    cancelMultiAgentRun: async () => ({}),
  });
  await serve(portal, async (base) => {
    const login = await fetch(`${base}/agents/login`, { redirect: "manual" });
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(
      `${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`,
      { redirect: "manual" },
    );
    assert.equal(callback.headers.get("location"), "/agents");
    const sessionCookie = callback.headers.get("set-cookie").split(";")[0];
    const home = await fetch(`${base}/agents`, { headers: { cookie: sessionCookie } });
    const html = await home.text();
    assert.match(html, /action="\/agents\/connect"/);
    assert.match(html, /name="csrf" value="[A-Za-z0-9_-]+"/);
    assert.doesNotMatch(html, /href="\/connect\/openai"/);
    assert.match(html, /pagina protetta|modulo sicuro/i);
    assert.doesNotMatch(html, /codexai|google-oauth2|sk-proj/);

    const verified = await fetch(`${base}/agents?verify=1`, { headers: { cookie: sessionCookie } });
    const verifiedHtml = await verified.text();
    assert.match(verifiedHtml, /Controllo eseguito adesso/);
    assert.match(verifiedHtml, /non risulta ancora collegata a questo account/);
  });
});

test("agent login fails closed when provider status cannot be checked", async () => {
  let linksIssued = 0;
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    issueSetupLink: async () => {
      linksIssued += 1;
      return issuedSetupLink();
    },
    providerStatus: async () => { throw new Error("upstream_unavailable"); },
    startMultiAgentRun: async () => ({}),
    readMultiAgentRun: async () => ({}),
    cancelMultiAgentRun: async () => ({}),
  });
  await serve(portal, async (base) => {
    const login = await fetch(`${base}/agents/login`, { redirect: "manual" });
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(
      `${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`,
      { redirect: "manual" },
    );
    assert.equal(callback.status, 503);
    assert.equal(callback.headers.get("location"), null);
    assert.equal(linksIssued, 0);
    const html = await callback.text();
    assert.match(html, /Verifica non disponibile/);
    assert.doesNotMatch(html, /codexai|google-oauth2|setup_proof|sk-proj/);
  });
});

test("agent login does not mint a setup link from a malformed provider status", async () => {
  let linksIssued = 0;
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    issueSetupLink: async () => {
      linksIssued += 1;
      return issuedSetupLink();
    },
    providerStatus: async () => ({ structuredContent: {
      ok: true,
      tenant_id: "codexai",
      provider: { configured: true, execution_available: true },
    } }),
    startMultiAgentRun: async () => ({}),
    readMultiAgentRun: async () => ({}),
    cancelMultiAgentRun: async () => ({}),
  });
  await serve(portal, async (base) => {
    const login = await fetch(`${base}/agents/login`, { redirect: "manual" });
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(
      `${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`,
      { redirect: "manual" },
    );
    assert.equal(callback.status, 503);
    assert.equal(linksIssued, 0);
    assert.match(await callback.text(), /stato incompleto/);
  });
});

test("configured provider cannot expose the run form without persistent project context", async () => {
  let linksIssued = 0;
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    issueSetupLink: async () => {
      linksIssued += 1;
      return issuedSetupLink();
    },
    providerStatus: async () => ({ structuredContent: {
      ok: true,
      tenant_id: "codexai",
      provider: { configured: true, execution_available: true, bounded_execution_ready: false },
    } }),
    startMultiAgentRun: async () => { throw new Error("must_not_start"); },
    readMultiAgentRun: async () => ({}),
    cancelMultiAgentRun: async () => ({}),
  });

  await serve(portal, async (base) => {
    const login = await fetch(`${base}/agents/login`, { redirect: "manual" });
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(
      `${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`,
      { redirect: "manual" },
    );
    assert.equal(callback.status, 503);
    assert.equal(callback.headers.get("location"), null);
    assert.equal(linksIssued, 0);
    assert.match(await callback.text(), /Contesto progetto non disponibile/);

    const sessionCookie = callback.headers.get("set-cookie").split(";")[0];
    const home = await fetch(`${base}/agents?verify=1`, { headers: { cookie: sessionCookie } });
    const html = await home.text();
    assert.match(html, /runtime multi-agente non è ancora disponibile/);
    assert.doesNotMatch(html, /action="\/agents\/run"/);
    assert.doesNotMatch(html, /Avvia i 3 agenti/);
  });
});

for (const [label, statusPayload] of [
  ["different tenant", { tenant_id: "tenant-b", provider: { configured: true, execution_available: true, bounded_execution_ready: true } }],
  ["missing tenant", { provider: { configured: true, execution_available: true, bounded_execution_ready: true } }],
]) {
  test(`agent login fails closed when provider status has ${label}`, async () => {
    const statusIdentities = [];
    let linksIssued = 0;
    const portal = createOpenAiConnectPortal({
      config,
      fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
      authenticate: async () => ownerIdentity(),
      issueSetupLink: async () => {
        linksIssued += 1;
        return issuedSetupLink();
      },
      providerStatus: async (_args, identity) => {
        statusIdentities.push(identity);
        return { structuredContent: { ok: true, ...statusPayload } };
      },
      startMultiAgentRun: async () => { throw new Error("must_not_start"); },
      readMultiAgentRun: async () => ({}),
      cancelMultiAgentRun: async () => ({}),
    });

    await serve(portal, async (base) => {
      const login = await fetch(`${base}/agents/login`, { redirect: "manual" });
      const authorization = new URL(login.headers.get("location"));
      const callback = await fetch(
        `${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`,
        { redirect: "manual" },
      );

      assert.equal(callback.status, 503);
      assert.equal(callback.headers.get("location"), null);
      assert.equal(linksIssued, 0);
      assert.equal(statusIdentities.length, 1);
      assert.equal(statusIdentities[0].tenantId, "codexai");
      const html = await callback.text();
      assert.match(html, /Verifica non disponibile|stato incompleto/);
      assert.doesNotMatch(html, /tenant-b|codexai|setup_proof|sk-proj/);
    });
  });
}

test("agent callback never redirects when Core returns a setup link for another tenant", async () => {
  const statusIdentities = [];
  const linkIdentities = [];
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    providerStatus: async (_args, identity) => {
      statusIdentities.push(identity);
      return {
        structuredContent: {
          ok: true,
          tenant_id: "codexai",
          provider: { configured: false, execution_available: false, bounded_execution_ready: false },
        },
      };
    },
    issueSetupLink: async (identity) => {
      linkIdentities.push(identity);
      return issuedSetupLink({ tenant_id: "tenant-b" });
    },
    startMultiAgentRun: async () => { throw new Error("must_not_start"); },
    readMultiAgentRun: async () => ({}),
    cancelMultiAgentRun: async () => ({}),
  });

  await serve(portal, async (base) => {
    const login = await fetch(`${base}/agents/login`, { redirect: "manual" });
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(
      `${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`,
      { redirect: "manual" },
    );

    assert.equal(callback.status, 503);
    assert.equal(callback.headers.get("location"), null);
    assert.deepEqual(statusIdentities.map((identity) => identity.tenantId), ["codexai"]);
    assert.deepEqual(linkIdentities.map((identity) => identity.tenantId), ["codexai"]);
    const html = await callback.text();
    assert.match(html, /Servizio non disponibile/);
    assert.doesNotMatch(html, /tenant-b|codexai|setup_proof|sk-proj/);
    assert.doesNotMatch(html, new RegExp(setupProof));
  });
});

test("a stale CSRF token cannot be replayed with a newer owner session", async () => {
  let started = 0;
  const portal = createOpenAiConnectPortal({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    issueSetupLink: async () => issuedSetupLink(),
    providerStatus: async () => ({ structuredContent: { ok: true, tenant_id: "codexai", provider: { configured: true, execution_available: true, bounded_execution_ready: true } } }),
    startMultiAgentRun: async () => {
      started += 1;
      return { structuredContent: { ok: true, run: { run_id: "run_replay_guard", status: "running" } } };
    },
    readMultiAgentRun: async () => ({}),
    cancelMultiAgentRun: async () => ({}),
  });
  await serve(portal, async (base) => {
    const login = async () => {
      const startedLogin = await fetch(`${base}/agents/login`, { redirect: "manual" });
      const authorization = new URL(startedLogin.headers.get("location"));
      const callback = await fetch(
        `${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`,
        { redirect: "manual" },
      );
      return callback.headers.get("set-cookie").split(";")[0];
    };
    const cookieA = await login();
    const cookieB = await login();
    const pageA = await (await fetch(`${base}/agents`, { headers: { cookie: cookieA } })).text();
    const pageB = await (await fetch(`${base}/agents`, { headers: { cookie: cookieB } })).text();
    const csrfA = pageA.match(/name="csrf" value="([A-Za-z0-9_-]+)"/)?.[1];
    const csrfB = pageB.match(/name="csrf" value="([A-Za-z0-9_-]+)"/)?.[1];
    assert(csrfA && csrfB && csrfA !== csrfB);

    const replay = await rawPost(`${base}/agents/run`, {
      headers: {
        cookie: cookieB,
        origin: "null",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf: csrfA, confirmed: "yes", task: "Rifiuta il token vecchio" }),
    });
    assert.equal(replay.status, 403);
    assert.equal(started, 0);

    const malformed = await rawPost(`${base}/agents/run`, {
      headers: {
        cookie: cookieB,
        origin: "null",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf: "not-a-valid-token", confirmed: "yes", task: "Rifiuta CSRF malformato" }),
    });
    assert.equal(malformed.status, 403);
    assert.equal(started, 0);

    const validExplicitOrigin = await fetch(`${base}/agents/run`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: cookieB,
        origin: "https://mcp.example.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf: csrfB,
        confirmed: "yes",
        project_title: "Progetto CSRF",
        specialist: "code",
        task: "Accetta origine esplicita corretta",
      }),
    });
    assert.equal(validExplicitOrigin.status, 303);
    assert.equal(validExplicitOrigin.headers.get("location"), "/agents/runs/run_replay_guard");
    assert.equal(started, 1);
  });
});

test("cross-client portal rejects tampered and expired session cookies", async () => {
  let clock = 0;
  const portal = createOpenAiConnectPortal({
    config,
    now: () => clock,
    fetchImpl: async () => new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    authenticate: async () => ownerIdentity(),
    issueSetupLink: async () => issuedSetupLink(),
    providerStatus: async () => ({ structuredContent: { ok: true, tenant_id: "codexai", provider: { configured: true, execution_available: true, bounded_execution_ready: true } } }),
  });
  await serve(portal, async (base) => {
    const response = await fetch(`${base}/agents`, {
      headers: { cookie: "__Host-skinharmony_agents=tampered.value" },
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Accedi e continua/);

    const login = await fetch(`${base}/agents/login`, { redirect: "manual" });
    const authorization = new URL(login.headers.get("location"));
    const callback = await fetch(`${base}/connect/openai/callback?code=x&state=${authorization.searchParams.get("state")}`, { redirect: "manual" });
    const sessionCookie = callback.headers.get("set-cookie").split(";")[0];
    clock = 20 * 60 * 1000 + 1;
    const expired = await fetch(`${base}/agents`, { headers: { cookie: sessionCookie } });
    assert.match(await expired.text(), /Accedi e continua/);
  });
});

test("serves the same canonical portal across clients and keeps the legacy mobile alias", async () => {
  const portal = createOpenAiConnectPortal({
    config,
    authenticate: async () => ownerIdentity(),
    issueSetupLink: async () => issuedSetupLink(),
  });
  const userAgents = [
    "ChatGPT/1.2026 iOS",
    "ChatGPT/1.2026 Android",
    "Codex Desktop",
    "Mozilla/5.0 Chrome Desktop",
  ];
  await serve(portal, async (base) => {
    const pages = [];
    for (const userAgent of userAgents) {
      const response = await fetch(`${base}/agents`, { headers: { "user-agent": userAgent } });
      assert.equal(response.status, 200);
      pages.push(await response.text());
    }
    assert(pages.every((html) => html === pages[0]));
    assert.match(pages[0], /Portale multi-agente/);
    assert.match(pages[0], /ChatGPT, Codex/);
    assert.match(pages[0], /href="\/agents\/login"/);

    const legacy = await fetch(`${base}/mobile/agents`);
    assert.equal(legacy.status, 200);
    const legacyHtml = await legacy.text();
    assert.match(legacyHtml, /Portale multi-agente/);
    assert.match(legacyHtml, /href="\/agents\/login"/);
  });
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { createApp } from "../src/app.js";
import { createAuthenticator } from "../src/auth.js";
import {
  createMemoryEnvironmentDelegationNonceStore,
  createPostgresEnvironmentDelegationNonceStore,
  signEnvironmentDelegation,
  verifyEnvironmentDelegation,
} from "../src/environment-delegation.js";
import { requireHostAppToolCapability } from "../src/host-app-authorization.js";
import { parseHostAppRegistry } from "../src/host-app-registry.js";
import { requireTenantWorkHostAuthorization } from "../src/tenant-work-authorization.js";
import { TOOLS } from "../src/tool-definitions.js";
import { WORK_CONTINUITY_TOOLS } from "../src/work-continuity-tools.js";

const KEY = "environment-delegation-test-key-0123456789abcdef";
const CODEX_TOKEN = "registered-codex-environment-token-0123456789abcdef";
const TENANT_ID = "tenant-a";

function jwt(privateKey, kid, payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey).toString("base64url");
  return `${header}.${body}.${signature}`;
}

function registry() {
  return parseHostAppRegistry(JSON.stringify({
    schema_version: "mcp_host_app_registry_v1",
    apps: [{
      app_id: "chatgpt_prod",
      auth_kind: "oauth",
      oauth_client_id: "chatgpt-client",
      host_kind: "chatgpt_native",
      client_type: "chatgpt",
      interaction_mode: "nyra_conversational",
      capabilities: ["work.read"],
      enabled: true,
    }, {
      app_id: "codex",
      auth_kind: "bearer",
      credential_env: "MCP_HOST_APP_TOKEN_CODEX",
      tenant_id: TENANT_ID,
      service_role: "member",
      host_kind: "codex_native",
      client_type: "codex",
      interaction_mode: "native_tooling",
      capabilities: ["work.read"],
      scopes: ["core:read"],
      enabled: true,
    }],
  }), { MCP_HOST_APP_TOKEN_CODEX: CODEX_TOKEN });
}

function membership(subject, role = "tenant_owner", now = Date.now()) {
  return {
    schema_version: "tenant_membership_binding_v1",
    authenticated: true,
    tenant_id: TENANT_ID,
    subject,
    role,
    team_ids: [], managed_team_ids: [], assigned_work_ids: [],
    issued_at: new Date(now - 1_000).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
  };
}

function delegatedOwner(now = Date.now()) {
  const subject = "google-oauth2|owner";
  return {
    kind: "oauth",
    subject,
    tenantId: TENANT_ID,
    role: "tenant_owner",
    scopes: ["core:read"],
    oauthOwnerBound: true,
    authenticatedTenantMembership: membership(subject, "tenant_owner", now),
    authenticatedHostPrincipal: {
      schema_version: "authenticated_host_principal_v1",
      registered: true,
      registry_revision: "a".repeat(64),
      app_id: "chatgpt_prod",
      auth_kind: "oauth",
      host_kind: "chatgpt_native",
      client_type: "chatgpt",
      interaction_mode: "nyra_conversational",
      capabilities: ["work.read"],
    },
  };
}

test("v3 environment delegation binds the exact request and preserves membership and host principal", async () => {
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  const request = {
    method: "tools/call",
    toolName: "nyra_converse",
    exactTarget: "nyra_converse",
    args: { message: "Continua" },
    requestId: "delegation-v3",
    transportSessionId: "delegation-session-v3",
  };
  const token = signEnvironmentDelegation({
    identity: delegatedOwner(now),
    ...request,
    key: KEY,
    now: () => now,
  });
  const nonceStore = createMemoryEnvironmentDelegationNonceStore({ now: () => now });
  const verified = await verifyEnvironmentDelegation(token, {
    key: KEY, nonceStore, request, now: () => now,
  });
  assert.equal(verified.identity.kind, "oauth");
  assert.equal(verified.identity.environmentDelegationBound, true);
  assert.equal(verified.identity.environmentDelegationVersion, 3);
  assert.equal(verified.identity.authenticatedTenantMembership.tenant_id, TENANT_ID);
  assert.equal(verified.identity.authenticatedTenantMembership.subject, "google-oauth2|owner");
  assert.equal(verified.identity.authenticatedHostPrincipal.host_kind, "chatgpt_native");
  assert.equal(verified.toolName, "nyra_converse");
  await assert.rejects(verifyEnvironmentDelegation(token, {
    key: KEY, nonceStore, request, now: () => now,
  }), /environment_delegation_replayed/);

  const freshNonceStore = createMemoryEnvironmentDelegationNonceStore({ now: () => now });
  await assert.rejects(verifyEnvironmentDelegation(token, {
    key: KEY,
    nonceStore: freshNonceStore,
    request: { ...request, args: { message: "Tampered" } },
    now: () => now,
  }), /environment_delegation_invalid/);
  await assert.rejects(verifyEnvironmentDelegation(token, {
    key: KEY,
    nonceStore: createMemoryEnvironmentDelegationNonceStore({ now: () => now }),
    request: { ...request, transportSessionId: "substituted-session" },
    now: () => now,
  }), /environment_delegation_invalid/);
  await assert.rejects(verifyEnvironmentDelegation(token, {
    key: KEY,
    nonceStore: createMemoryEnvironmentDelegationNonceStore({ now: () => now }),
    request: { ...request, exactTarget: "memory_checkpoint" },
    now: () => now,
  }), /environment_delegation_invalid/);

  const expired = delegatedOwner(now);
  expired.authenticatedTenantMembership = {
    ...expired.authenticatedTenantMembership,
    expires_at: new Date(now - 1).toISOString(),
  };
  assert.throws(() => signEnvironmentDelegation({
    identity: expired, ...request, key: KEY, now: () => now,
  }), /environment_delegation_invalid/);
});

test("PostgreSQL nonce claim is distributed and single-use", async () => {
  const queries = [];
  let claimed = false;
  const store = createPostgresEnvironmentDelegationNonceStore({ pool: {
    async query(sql, params) {
      queries.push([sql, params]);
      if (sql.includes("primary_key_verified") &&
          sql.includes("mcp_environment_delegation_nonces")) {
        return { rows: [{
          primary_key_verified: true,
          columns_verified: true,
          expiry_index_verified: true,
        }] };
      }
      if (!sql.includes("INSERT INTO mcp_environment_delegation_nonces")) return { rows: [] };
      if (claimed) return { rowCount: 0, rows: [] };
      claimed = true;
      return { rowCount: 1, rows: [{ nonce: params[0] }] };
    },
  } });
  const input = {
    nonce: "distributed-nonce-0123456789",
    expires_at: new Date(Date.now() + 30_000).toISOString(),
  };
  assert.equal(await store.claim(input), true);
  assert.equal(await store.claim(input), false);
  assert.match(queries[0][0], /CREATE TABLE IF NOT EXISTS mcp_environment_delegation_nonces/);
  assert.match(queries[1][0], /primary_key_verified/);
  assert.match(queries[2][0], /ON CONFLICT \(nonce\) DO NOTHING/);
});

test("production to staging preserves owner/member/registered Codex and denies claim-only OAuth before handler", async () => {
  const readTool = WORK_CONTINUITY_TOOLS.find((tool) => tool.name === "work_continuity_v2_read");
  const addedTool = !TOOLS.some((tool) => tool.name === readTool.name);
  if (addedTool) TOOLS.push(readTool);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "environment-delegation-jwk";
  const hostAppRegistry = registry();
  const received = [];
  const baseConfig = {
    publicUrl: "https://mcp.example.test",
    resource: "https://mcp.example.test/mcp",
    auth0Issuer: "https://tenant.auth0.com",
    auth0Audience: "https://core",
    jwksUri: "https://tenant.auth0.com/.well-known/jwks.json",
    tenantClaim: "https://skinharmony.it/tenant_id",
    supportedScopes: ["core:read"],
    codexKeys: [],
    codexScopes: ["core:read"],
    defaultTenantId: TENANT_ID,
    hostAppRegistry,
    serviceTenantMembershipTtlSeconds: 300,
    oauthOwnerTenantBindings: { "google-oauth2|owner": TENANT_ID },
    oauthTenantMemberships: {
      "google-oauth2|member": { tenantId: TENANT_ID, role: "member", teamIds: [], managedTeamIds: [] },
    },
  };
  const staging = createApp({
    ...baseConfig,
    environmentDelegationReceiverEnabled: true,
    environmentDelegationKey: KEY,
  }, {
    handlers: {
      work_continuity_v2_read: async (_args, identity) => {
        received.push({ subject: identity.subject, kind: identity.kind });
        return { structuredContent: { ok: true, subject: identity.subject }, content: [] };
      },
      nyra_converse: async (_args, identity) => {
        received.push({ subject: identity.subject, kind: identity.kind });
        return { structuredContent: { ok: true, subject: identity.subject }, content: [] };
      },
    },
    beforeToolCall: async ({ identity, toolName, args }) => {
      const authorization = requireHostAppToolCapability({ identity, toolName, args, tools: TOOLS });
      requireTenantWorkHostAuthorization(identity, authorization);
      return { preflight: null };
    },
  });
  const stagingServer = staging.listen(0);
  await new Promise((resolve) => stagingServer.once("listening", resolve));
  const production = createApp({
    ...baseConfig,
    environmentRoutingRequired: true,
    environmentDelegationKey: KEY,
    stagingMcpUrl: `http://127.0.0.1:${stagingServer.address().port}`,
  }, {
    jwksCache: { get: async () => jwk },
    handlers: { work_continuity_v2_read: async () => { throw new Error("production_handler_must_not_run"); } },
  });
  const productionServer = production.listen(0);
  await new Promise((resolve) => productionServer.once("listening", resolve));
  try {
    const now = Math.floor(Date.now() / 1_000);
    const oauthToken = (subject) => jwt(privateKey, jwk.kid, {
      iss: "https://tenant.auth0.com/",
      aud: "https://core",
      sub: subject,
      azp: "chatgpt-client",
      iat: now,
      exp: now + 300,
      scope: "core:read",
      "https://skinharmony.it/tenant_id": TENANT_ID,
    });
    const base = `http://127.0.0.1:${productionServer.address().port}`;
    const callProduction = async (token, id) => fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "mcp-session-id": `environment-delegation-${id}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id, method: "tools/call",
        params: { name: "work_continuity_v2_read", arguments: {
          work_id: "11111111-1111-4111-8111-111111111111", environment: "staging",
        } },
      }),
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const authenticate = createAuthenticator(baseConfig, { jwksCache: { get: async () => jwk } });
    const stagingBase = `http://127.0.0.1:${stagingServer.address().port}`;
    const callDelegatedNyra = async (token, id) => {
      const identity = await authenticate(`Bearer ${token}`);
      const delegation = signEnvironmentDelegation({
        identity,
        toolName: "nyra_converse",
        exactTarget: "nyra_converse",
        args: { message: "Continua" },
        requestId: id,
        method: "tools/call",
        key: KEY,
      });
      return fetch(`${stagingBase}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-skinharmony-environment-delegation": delegation,
        },
        body: JSON.stringify({
          jsonrpc: "2.0", id, method: "tools/call",
          params: { name: "nyra_converse", arguments: { message: "Continua" } },
        }),
      }).then(async (response) => ({ status: response.status, body: await response.json() }));
    };

    for (const [token, id] of [
      [oauthToken("google-oauth2|owner"), 1],
      [oauthToken("google-oauth2|member"), 2],
    ]) {
      const response = await callDelegatedNyra(token, id);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.ok(response.body.result, JSON.stringify(response.body));
      assert.equal(response.body.result.structuredContent.ok, true);
    }
    const codex = await callProduction(CODEX_TOKEN, 3);
    assert.equal(codex.status, 200, JSON.stringify(codex.body));
    assert.equal(codex.body.result?.structuredContent?.ok, true, JSON.stringify(codex.body));

    const denied = await callDelegatedNyra(oauthToken("google-oauth2|claim-only"), 4);
    assert.equal(denied.status, 200);
    assert.equal(denied.body.result?.structuredContent?.error?.code, "tenant_work_membership_required");
    assert.deepEqual(received, [
      { subject: "google-oauth2|owner", kind: "oauth" },
      { subject: "google-oauth2|member", kind: "oauth" },
      { subject: "codex", kind: "codex" },
    ]);
  } finally {
    await new Promise((resolve) => productionServer.close(resolve));
    await new Promise((resolve) => stagingServer.close(resolve));
    if (addedTool) {
      const index = TOOLS.indexOf(readTool);
      if (index >= 0) TOOLS.splice(index, 1);
    }
  }
});

test("an OAuth owner confirmation is verified once in production and delegated to one exact staging mutation", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "environment-owner-mutation-jwk";
  const subject = "oauth-owner-staging-mutation";
  const oauthClientId = "governed-api-agent-client";
  const hostAppRegistry = parseHostAppRegistry(JSON.stringify({
    schema_version: "mcp_host_app_registry_v1",
    apps: [{
      app_id: "governed_api_agent",
      auth_kind: "oauth",
      oauth_client_id: oauthClientId,
      host_kind: "chatgpt_native",
      client_type: "api_agent",
      interaction_mode: "native_tooling",
      capabilities: ["core.operate"],
      enabled: true,
    }],
  }));
  const baseConfig = {
    publicUrl: "https://mcp.example.test",
    resource: "https://mcp.example.test/mcp",
    auth0Issuer: "https://tenant.auth0.com",
    auth0Audience: "https://core",
    jwksUri: "https://tenant.auth0.com/.well-known/jwks.json",
    tenantClaim: "https://skinharmony.it/tenant_id",
    supportedScopes: ["core:read", "core:govern"],
    codexKeys: [],
    defaultTenantId: TENANT_ID,
    hostAppRegistry,
    oauthOwnerTenantBindings: { [subject]: TENANT_ID },
    oauthOwnerConfirmationMaxAgeSeconds: 300,
  };
  let stagingIdentity;
  let stagingCalls = 0;
  const preflight = {
    schema_version: "skinharmony_work_preflight_v1",
    preflight_id: "delegated-owner-preflight",
    mandatory: true,
    tenant_id: TENANT_ID,
    operational_surface: "tenant_work_gallery",
  };
  const staging = createApp({
    ...baseConfig,
    environmentDelegationReceiverEnabled: true,
    environmentDelegationKey: KEY,
  }, {
    handlers: {
      core_capability_invoke: async (_args, identity) => {
        stagingCalls += 1;
        stagingIdentity = identity;
        return { structuredContent: { ok: true }, content: [] };
      },
    },
    beforeToolCall: async () => ({ preflight }),
  });
  const stagingServer = staging.listen(0);
  await new Promise((resolve) => stagingServer.once("listening", resolve));
  const production = createApp({
    ...baseConfig,
    environmentRoutingRequired: true,
    environmentDelegationKey: KEY,
    stagingMcpUrl: `http://127.0.0.1:${stagingServer.address().port}`,
  }, {
    jwksCache: { get: async () => jwk },
    handlers: {
      core_capability_invoke: async () => {
        throw new Error("production_handler_must_not_run");
      },
    },
  });
  const productionServer = production.listen(0);
  await new Promise((resolve) => productionServer.once("listening", resolve));
  try {
    const now = Math.floor(Date.now() / 1_000);
    const token = jwt(privateKey, jwk.kid, {
      iss: "https://tenant.auth0.com/",
      aud: "https://core",
      sub: subject,
      azp: oauthClientId,
      iat: now,
      auth_time: now - 86_400,
      exp: now + 300,
      scope: "core:read core:govern",
      "https://skinharmony.it/tenant_id": TENANT_ID,
    });
    const response = await fetch(
      `http://127.0.0.1:${productionServer.address().port}/mcp`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "mcp-session-id": "delegated-owner-mutation-session",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "delegated-owner-mutation",
          method: "tools/call",
          params: {
            name: "core_capability_invoke",
            arguments: {
              capability_id: "memory_checkpoint",
              catalog_revision: "a".repeat(64),
              arguments: { summary: "bounded staging checkpoint" },
              idempotency_key: "delegated-owner-mutation-001",
              owner_confirmed: true,
              confirmation_reference: "owner approved exact staging checkpoint",
              environment: "staging",
            },
          },
        }),
      },
    );
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.result?.structuredContent?.ok, true, JSON.stringify(body));
    assert.equal(stagingCalls, 1);
    assert.equal(stagingIdentity.environmentDelegationBound, true);
    assert.equal(stagingIdentity.environmentDelegationVersion, 3);
    assert.equal(stagingIdentity.environmentDelegatedOwnerConfirmation.verified, true);
    assert.equal(stagingIdentity.ownerConfirmed, true);
    assert.match(stagingIdentity.confirmationReference, /^environment_delegation:[a-f0-9]{64}$/);
  } finally {
    await new Promise((resolve) => productionServer.close(resolve));
    await new Promise((resolve) => stagingServer.close(resolve));
  }
});

test("staging transport rejects redirects before reading a response or running a handler", async () => {
  let fetchCalls = 0;
  let fetchOptions;
  let handlerCalls = 0;
  const app = createApp({
    publicUrl: "https://mcp.example.test",
    resource: "https://mcp.example.test/mcp",
    auth0Issuer: "",
    codexKeys: ["redirect-test-codex"],
    codexScopes: ["core:read", "core:govern"],
    supportedScopes: ["core:read", "core:govern"],
    defaultTenantId: TENANT_ID,
    environmentRoutingRequired: true,
    environmentDelegationKey: KEY,
    stagingMcpUrl: "https://staging.example.test",
  }, {
    fetchImpl: async (_url, options) => {
      fetchCalls += 1;
      fetchOptions = options;
      return {
        redirected: true,
        url: "https://attacker.example.test/mcp",
        headers: new Headers({ "content-type": "application/json" }),
      };
    },
    handlers: {
      core_health: async () => {
        handlerCalls += 1;
        return { structuredContent: { ok: true }, content: [] };
      },
    },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer redirect-test-codex",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "redirect-denied",
        method: "tools/call",
        params: { name: "core_health", arguments: { environment: "staging" } },
      }),
    });
    const body = await response.json();
    assert.equal(fetchCalls, 1);
    assert.equal(fetchOptions.redirect, "error");
    assert.ok(fetchOptions.signal instanceof AbortSignal);
    assert.equal(handlerCalls, 0);
    assert.equal(body.result?.structuredContent?.error?.code, "staging_delegation_unavailable");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a production receiver requires a distributed durable nonce store", () => {
  assert.throws(() => createApp({
    publicUrl: "https://staging.example.test",
    resource: "https://staging.example.test/mcp",
    auth0Issuer: "",
    codexKeys: [],
    supportedScopes: ["core:read"],
    production: true,
    environmentDelegationReceiverEnabled: true,
    environmentDelegationKey: KEY,
  }, { handlers: {} }), /environment_delegation_distributed_nonce_store_required/);
});

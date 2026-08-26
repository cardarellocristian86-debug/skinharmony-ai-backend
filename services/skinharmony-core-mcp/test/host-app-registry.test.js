import assert from "node:assert/strict";
import test from "node:test";

import {
  HOST_APP_CAPABILITIES,
  attachAuthenticatedHostPrincipal,
  authenticatedHostKind,
  hostPrincipalAllows,
  parseHostAppRegistry,
  publicHostPrincipal,
  registeredBearerApp,
} from "../src/host-app-registry.js";

const SECRET = "registered-host-bearer-secret-0123456789abcdef";

function registry() {
  return parseHostAppRegistry(JSON.stringify({
    schema_version: "mcp_host_app_registry_v1",
    apps: [
      {
        app_id: "chatgpt_prod",
        auth_kind: "oauth",
        oauth_client_id: "chatgpt-oauth-client",
        host_kind: "chatgpt_native",
        client_type: "chatgpt",
        interaction_mode: "nyra_conversational",
        capabilities: Object.values(HOST_APP_CAPABILITIES),
        enabled: true,
      },
      {
        app_id: "review_ai",
        auth_kind: "bearer",
        credential_env: "MCP_HOST_APP_TOKEN_REVIEW_AI",
        tenant_id: "tenant-a",
        service_role: "reviewer",
        host_kind: "review_ai_native",
        client_type: "api_agent",
        interaction_mode: "nyra_conversational",
        capabilities: [
          HOST_APP_CAPABILITIES.WORK_READ,
          HOST_APP_CAPABILITIES.WORK_COORDINATE,
          HOST_APP_CAPABILITIES.WORK_REVIEW,
          HOST_APP_CAPABILITIES.GOVERNED_CONTINUE,
          HOST_APP_CAPABILITIES.HOST_NATIVE_AUTHORIZE,
        ],
        scopes: ["core:read", "core:govern"],
        enabled: true,
      },
    ],
  }), { MCP_HOST_APP_TOKEN_REVIEW_AI: SECRET });
}

test("binds an OAuth client to one registered app without granting owner authority", () => {
  const bound = attachAuthenticatedHostPrincipal({
    kind: "oauth",
    clientId: "chatgpt-oauth-client",
    tenantId: "tenant-a",
    subject: "owner-subject",
    oauthOwnerBound: true,
  }, registry());
  assert.equal(bound.authenticatedHostPrincipal.app_id, "chatgpt_prod");
  assert.equal(authenticatedHostKind(bound), "chatgpt_native");
  assert.equal(hostPrincipalAllows(bound, HOST_APP_CAPABILITIES.GOVERNED_CONTINUE), true);
  assert.equal(bound.authenticatedHostPrincipal.role, undefined);
  assert.equal(bound.authenticatedHostPrincipal.owner, undefined);
  assert.equal(publicHostPrincipal(bound).capabilities.includes("host_native.authorize"), true);
});

test("keeps an unknown OAuth application read-only and host-native fail-closed", () => {
  const unknown = attachAuthenticatedHostPrincipal({
    kind: "oauth",
    clientId: "unknown-client",
    tenantId: "tenant-a",
    subject: "owner-subject",
    oauthOwnerBound: true,
  }, registry());
  assert.equal(unknown.authenticatedHostPrincipal.registered, false);
  assert.deepEqual(unknown.authenticatedHostPrincipal.capabilities, ["work.read"]);
  assert.equal(hostPrincipalAllows(unknown, HOST_APP_CAPABILITIES.GOVERNED_CONTINUE), false);
  assert.throws(() => authenticatedHostKind(unknown), /registered_host_principal_required/);
});

test("resolves a registered bearer in constant-shape lookup without exposing its secret", () => {
  const parsed = registry();
  const match = registeredBearerApp(SECRET, parsed);
  assert.equal(match.app.app_id, "review_ai");
  assert.equal(match.principal.host_kind, "review_ai_native");
  assert.equal(publicHostPrincipal({ authenticatedHostPrincipal: match.principal }).credential, undefined);
  assert.equal(registeredBearerApp("wrong-secret-with-enough-length-0123456789", parsed), null);
});

test("rejects duplicate clients, owner service roles and unknown capabilities", () => {
  const base = {
    schema_version: "mcp_host_app_registry_v1",
    apps: [{
      app_id: "service_ai",
      auth_kind: "bearer",
      credential_env: "MCP_HOST_APP_TOKEN_SERVICE_AI",
      tenant_id: "tenant-a",
      service_role: "tenant_owner",
      host_kind: "service_ai_native",
      client_type: "api_agent",
      interaction_mode: "native_tooling",
      capabilities: ["work.read"],
      scopes: ["core:read"],
      enabled: true,
    }],
  };
  assert.throws(
    () => parseHostAppRegistry(JSON.stringify(base), {
      MCP_HOST_APP_TOKEN_SERVICE_AI: SECRET,
    }),
    /cannot receive an owner role/,
  );
  const unknownCapability = structuredClone(base);
  unknownCapability.apps[0].service_role = "member";
  unknownCapability.apps[0].capabilities = ["owner.root"];
  assert.throws(
    () => parseHostAppRegistry(JSON.stringify(unknownCapability), {
      MCP_HOST_APP_TOKEN_SERVICE_AI: SECRET,
    }),
    /capabilities contains an invalid value/,
  );
});

test("rejects enabled bearer apps that resolve different credential envs to the same secret", () => {
  const parsed = {
    schema_version: "mcp_host_app_registry_v1",
    apps: [
      {
        app_id: "service_ai_one",
        auth_kind: "bearer",
        credential_env: "MCP_HOST_APP_TOKEN_SERVICE_AI_ONE",
        tenant_id: "tenant-a",
        service_role: "member",
        host_kind: "service_ai_one_native",
        client_type: "api_agent",
        interaction_mode: "native_tooling",
        capabilities: ["work.read"],
        scopes: ["core:read"],
        enabled: true,
      },
      {
        app_id: "service_ai_two",
        auth_kind: "bearer",
        credential_env: "MCP_HOST_APP_TOKEN_SERVICE_AI_TWO",
        tenant_id: "tenant-b",
        service_role: "member",
        host_kind: "service_ai_two_native",
        client_type: "api_agent",
        interaction_mode: "native_tooling",
        capabilities: ["work.read"],
        scopes: ["core:read"],
        enabled: true,
      },
    ],
  };
  assert.throws(
    () => parseHostAppRegistry(JSON.stringify(parsed), {
      MCP_HOST_APP_TOKEN_SERVICE_AI_ONE: SECRET,
      MCP_HOST_APP_TOKEN_SERVICE_AI_TWO: SECRET,
    }),
    /duplicate enabled bearer credential/,
  );
});

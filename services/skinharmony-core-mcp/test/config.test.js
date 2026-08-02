import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("uses CORE_BASE_URL as a compatibility fallback for Universal Core", () => {
  const config = loadConfig({
    CORE_BASE_URL: "https://core.example.test/"
  });

  assert.equal(config.universalCoreUrl, "https://core.example.test");
});

test("keeps agent collaboration disabled until a persistent root is configured", () => {
  const disabled = loadConfig({});
  assert.equal(disabled.agentWorkspaceRoot, "");
  assert.equal(disabled.memoryFabricRoot, "");
  const enabled = loadConfig({ AGENT_WORKSPACE_ROOT: "/var/data/skinharmony-core-mcp" });
  assert.equal(enabled.agentWorkspaceRoot, "/var/data/skinharmony-core-mcp");
  assert.equal(enabled.memoryFabricRoot, "/var/data/skinharmony-core-mcp");
  assert(enabled.supportedScopes.includes("core:read"));
  assert(enabled.supportedScopes.includes("core:govern"));
  assert.equal(enabled.researchCortexRoot, "/var/data/skinharmony-core-mcp");
  const postgresOnly = loadConfig({
    DATABASE_URL: "postgres://existing-service-db",
    MCP_COLLABORATION_DATABASE_URL: "postgres://staging-collaboration-db",
  });
  assert.equal(postgresOnly.databaseUrl, "postgres://existing-service-db");
  assert.equal(postgresOnly.collaborationDatabaseUrl, "postgres://staging-collaboration-db");
});

test("does not enable PostgreSQL collaboration from the generic database URL", () => {
  const config = loadConfig({ DATABASE_URL: "postgres://existing-service-db" });
  assert.equal(config.collaborationDatabaseUrl, "");
  assert.equal(config.collaborationDatabaseSsl, false);
});

test("configures independent memory storage and bounded retention", () => {
  const config = loadConfig({
    AGENT_WORKSPACE_ROOT: "/workspace",
    MEMORY_FABRIC_ROOT: "/memory",
    MEMORY_RETENTION_DAYS: "99999",
    MEMORY_PERSONAL_RETENTION_DAYS: "120",
  });
  assert.equal(config.memoryFabricRoot, "/memory");
  assert.equal(config.memoryRetentionDays, 3650);
  assert.equal(config.personalMemoryRetentionDays, 120);
  assert.equal(config.researchCortexRoot, "/memory");
  assert.equal(Object.hasOwn(config, "openaiResearchEnabled"), false);
});

test("does not create a server-side provider configuration from legacy environment values", () => {
  const config = loadConfig({
    OPENAI_API_KEY: "configured-but-never-returned",
    NYRA_OPENAI_RESEARCH_ENABLED: "true",
    NYRA_OPENAI_RESEARCH_MODEL: "gpt-5.6",
    NYRA_OPENAI_RESEARCH_TIMEOUT_MS: "999999",
    NYRA_OPENAI_RESEARCH_MAX_CALLS_PER_HOUR: "999",
    RESEARCH_RETENTION_DAYS: "99999",
  });
  assert.equal(Object.hasOwn(config, "openaiResearchEnabled"), false);
  assert.equal(Object.hasOwn(config, "openaiApiKey"), false);
  assert.equal(config.researchRetentionDays, 3650);
});

test("requires the decision ledger by default only in production", () => {
  const production = { NODE_ENV: "production", CODEX_BEARER_KEYS: "test-key" };
  assert.equal(loadConfig({}).decisionLedgerRequired, false);
  assert.equal(loadConfig(production).decisionLedgerRequired, true);
  assert.equal(loadConfig({ ...production, CORE_DECISION_LEDGER_REQUIRED: "false" }).decisionLedgerRequired, false);
  assert.equal(loadConfig({}).environment, "development");
  assert.equal(loadConfig({}).production, false);
  const failClosedProduction = loadConfig({ NODE_ENV: "production" });
  assert.equal(failClosedProduction.environment, "production");
  assert.equal(failClosedProduction.production, true);
  assert.deepEqual(failClosedProduction.codexKeys, []);
});

test("keeps host-native continuity opt-in independent from legacy environment values", () => {
  const disabled = loadConfig({ OPENAI_API_KEY: "optional-provider-key" });
  assert.equal(disabled.workContinuityAutoCaptureEnabled, false);
  assert.equal(disabled.hostNativeAgentProtocolEnabled, false);

  const enabled = loadConfig({
    WORK_CONTINUITY_AUTO_CAPTURE_ENABLED: "true",
    HOST_NATIVE_AGENT_PROTOCOL_ENABLED: "true",
  });
  assert.equal(enabled.workContinuityAutoCaptureEnabled, true);
  assert.equal(enabled.hostNativeAgentProtocolEnabled, true);
  assert.equal(enabled.mandatoryAgentPresenceEnabled, false);
  assert.equal(loadConfig({ MANDATORY_AGENT_PRESENCE_ENABLED: "true" }).mandatoryAgentPresenceEnabled, true);
  assert.equal(Object.hasOwn(enabled, "openaiApiKey"), false);
});

test("accepts a strong independent agent-presence signing secret by UTF-8 byte length", () => {
  const signatureSecret = "é".repeat(16);
  const independent = loadConfig({
    AGENT_SIGNATURE_SECRET: signatureSecret,
    UNIVERSAL_CORE_KEY: "u".repeat(32),
    CORE_MCP_TENANT_GATEWAY_KEY: "g".repeat(32),
    CORE_OWNER_CONTEXT_SIGNING_SECRET: "o".repeat(32),
    CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET: "t".repeat(32),
    DTT_AGENT_IDENTITY_SIGNING_SECRET: "d".repeat(32),
    CORE_NYRA_DEEP_BRANCH_V2_MCP_REQUEST_SIGNING_SECRET: "n".repeat(32),
  });
  assert.equal(independent.agentSignatureSecret, signatureSecret);
  assert.equal(independent.agentSignatureSecretReused, false);
});

test("filters missing or short AGENT_SIGNATURE_SECRET as unconfigured", () => {
  assert.equal(loadConfig({}).agentSignatureSecret, "");
  assert.equal(
    loadConfig({ AGENT_SIGNATURE_SECRET: "é".repeat(15) })
      .agentSignatureSecret,
    "",
  );
});

test("flags AGENT_SIGNATURE_SECRET reuse with a Core bearer or another host-native secret", () => {
  const signatureSecret = "r".repeat(32);
  for (const reusedEnvironment of [
    { CORE_MCP_KEY: signatureSecret },
    { UNIVERSAL_CORE_KEY: signatureSecret },
    {
      UNIVERSAL_CORE_KEYS_JSON: JSON.stringify({
        codexai: signatureSecret,
      }),
    },
    { CORE_MCP_TENANT_GATEWAY_KEY: signatureSecret },
    { CORE_OWNER_CONTEXT_SIGNING_SECRET: signatureSecret },
    { CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET: signatureSecret },
    { DTT_AGENT_IDENTITY_SIGNING_SECRET: signatureSecret },
    {
      CORE_NYRA_DEEP_BRANCH_V2_MCP_REQUEST_SIGNING_SECRET:
        signatureSecret,
    },
  ]) {
    const reused = loadConfig({
      AGENT_SIGNATURE_SECRET: signatureSecret,
      ...reusedEnvironment,
    });
    assert.equal(reused.agentSignatureSecretReused, true);
  }
});

test("maps CORE_MCP_KEY only to the configured ChatGPT tenant", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    MCP_PUBLIC_URL: "https://mcp.example.test",
    AUTH0_ISSUER: "https://tenant.auth0.com",
    AUTH0_AUDIENCE: "https://mcp.example.test/mcp",
    MCP_CHATGPT_TENANT_ID: "codexai",
    CORE_MCP_KEY: "chatgpt-key",
    UNIVERSAL_CORE_KEYS_JSON: JSON.stringify({ "owner-private": "owner-key" })
  });

  assert.deepEqual(config.universalCoreKeys, {
    "owner-private": "owner-key",
    codexai: "chatgpt-key"
  });
});

test("keeps an explicit tenant mapping over CORE_MCP_KEY", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    MCP_PUBLIC_URL: "https://mcp.example.test",
    AUTH0_ISSUER: "https://tenant.auth0.com",
    AUTH0_AUDIENCE: "https://mcp.example.test/mcp",
    MCP_CHATGPT_TENANT_ID: "codexai",
    CORE_MCP_KEY: "compatibility-key",
    UNIVERSAL_CORE_KEYS_JSON: JSON.stringify({ codexai: "explicit-key" })
  });

  assert.equal(config.universalCoreKeys.codexai, "explicit-key");
});

test("ignores retired provider setup-link configuration", () => {
  const config = loadConfig({
    MCP_CHATGPT_TENANT_ID: "codexai",
    CORE_MCP_KEY: "normal-core-key",
    CORE_PROVIDER_SETUP_LINK_KEY: "scoped-provider-link-key",
    CORE_PROVIDER_SETUP_LINK_SERVICE_KEY: "service-provider-link-key",
    UNIVERSAL_CORE_PROVIDER_SETUP_LINK_KEYS_JSON: JSON.stringify({ codexai: "explicit-scoped-key" }),
  });

  assert.deepEqual(config.universalCoreKeys, { codexai: "normal-core-key" });
  assert.equal(Object.hasOwn(config, "universalCoreProviderSetupLinkKeys"), false);
  assert.equal(Object.hasOwn(config, "providerSetupLinkServiceKey"), false);
  assert.equal(Object.hasOwn(config, "providerSetupLinkSourceConfigured"), false);
});

test("loads the separate owner-context signing secret without exposing it through status flags", () => {
  const signingSecret = "test-owner-context-signing-secret-0123456789";
  const config = loadConfig({
    CORE_OWNER_CONTEXT_SIGNING_SECRET: signingSecret,
  });

  assert.equal(config.ownerContextSigningSecret, signingSecret);
  assert.equal(loadConfig({ CORE_OWNER_CONTEXT_SIGNING_SECRET: "too-short" }).ownerContextSigningSecret, "");
});

test("loads independent strong tenant-gateway context material by UTF-8 byte length", () => {
  const ownerSigningSecret = "o".repeat(32);
  const tenantSigningSecret = "é".repeat(16);
  const tenantGatewayKey = "g".repeat(32);
  const config = loadConfig({
    CORE_OWNER_CONTEXT_SIGNING_SECRET: ownerSigningSecret,
    CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET: tenantSigningSecret,
    CORE_MCP_TENANT_GATEWAY_KEY: tenantGatewayKey,
  });

  assert.equal(config.ownerContextSigningSecret, ownerSigningSecret);
  assert.equal(config.tenantContextSigningSecret, tenantSigningSecret);
  assert.equal(config.tenantGatewayKey, tenantGatewayKey);
  assert.equal(loadConfig({
    CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET: "é".repeat(15),
  }).tenantContextSigningSecret, "");
  assert.equal(loadConfig({
    CORE_MCP_TENANT_GATEWAY_KEY: "é".repeat(15),
  }).tenantGatewayKey, "");
});

test("loads Deep V2 MCP signing material only when it is strong enough", () => {
  const signingSecret = "test-nyra-deep-v2-signing-secret-0123456789";
  const config = loadConfig({
    CORE_NYRA_DEEP_BRANCH_V2_MCP_REQUEST_SIGNING_SECRET: signingSecret,
  });

  assert.equal(config.nyraDeepV2McpRequestSigningSecret, signingSecret);
  assert.equal(
    loadConfig({
      CORE_NYRA_DEEP_BRANCH_V2_MCP_REQUEST_SIGNING_SECRET: "too-short",
    }).nyraDeepV2McpRequestSigningSecret,
    "",
  );
});

test("requires a full immutable build identity for the strict provider binding", () => {
  assert.equal(loadConfig({ RENDER_GIT_COMMIT: "a".repeat(40) }).runtimeBuildCommit, "a".repeat(40));
  assert.throws(() => loadConfig({ RENDER_GIT_COMMIT: "a".repeat(7) }), /full 40-character commit SHA/);
});

test("ignores retired browser-provider portal configuration", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    MCP_PUBLIC_URL: "https://mcp.example.test",
    AUTH0_ISSUER: "https://tenant.auth0.com",
    AUTH0_AUDIENCE: "https://mcp.example.test/mcp",
    AUTH0_BROWSER_CLIENT_ID: "browser-client",
    AUTH0_BROWSER_STATE_SECRET: "state-secret-at-least-32-bytes-long",
    AUTH0_BROWSER_AUDIENCE: "https://mcp.example.test/browser",
    CODEX_BEARER_KEYS: "local-test-key",
  });
  assert.equal(config.auth0Audience, "https://mcp.example.test/mcp");
  assert.equal(Object.hasOwn(config, "auth0BrowserAudience"), false);
  assert.equal(Object.hasOwn(config, "auth0BrowserClientId"), false);
  assert.equal(Object.hasOwn(config, "auth0BrowserCallbackUrl"), false);
});

test("loads OAuth owner tenant bindings only from server-side configuration", () => {
  const config = loadConfig({
    AUTH0_OWNER_TENANT_BINDINGS_JSON: JSON.stringify({ "oauth-owner-fixture": "codexai" }),
    AUTH0_OWNER_CONFIRMATION_MAX_AGE_SECONDS: "43200",
  });
  assert.deepEqual(config.oauthOwnerTenantBindings, { "oauth-owner-fixture": "codexai" });
  assert.equal(config.oauthOwnerConfirmationMaxAgeSeconds, 43200);
  assert.throws(
    () => loadConfig({ AUTH0_OWNER_CONFIRMATION_MAX_AGE_SECONDS: "43201" }),
    /AUTH0_OWNER_CONFIRMATION_MAX_AGE_SECONDS/,
  );
  assert.throws(
    () => loadConfig({ AUTH0_OWNER_CONFIRMATION_MAX_AGE_SECONDS: "59" }),
    /AUTH0_OWNER_CONFIRMATION_MAX_AGE_SECONDS/,
  );
  assert.throws(() => loadConfig({ AUTH0_OWNER_TENANT_BINDINGS_JSON: JSON.stringify({ "oauth-owner-fixture": "../other" }) }), /invalid tenant id/);
});

test("loads only bounded server-side OAuth tenant memberships", () => {
  const config = loadConfig({
    AUTH0_TENANT_MEMBERSHIPS_JSON: JSON.stringify({
      "oauth|member-a": { tenant_id: "codexai", role: "member" },
      "oauth|member-b": { tenant_id: "codexai", role: "reviewer" },
      "oauth|member-c": { tenant_id: "codexai", role: "operator" },
      "oauth|support": {
        tenant_id: "client-a",
        role: "support_delegate",
        delegation_id: "support-case-42",
        expires_at: "2030-01-01T00:00:00.000Z",
      },
    }),
  });
  assert.deepEqual(config.oauthTenantMemberships, {
    "oauth|member-a": { tenantId: "codexai", role: "member" },
    "oauth|member-b": { tenantId: "codexai", role: "reviewer" },
    "oauth|member-c": { tenantId: "codexai", role: "operator" },
    "oauth|support": {
      tenantId: "client-a",
      role: "support_delegate",
      delegationId: "support-case-42",
      expiresAt: "2030-01-01T00:00:00.000Z",
    },
  });
  assert.throws(
    () => loadConfig({ AUTH0_TENANT_MEMBERSHIPS_JSON: JSON.stringify({ "oauth|bad": { tenant_id: "../other", role: "member" } }) }),
    /invalid tenant id/,
  );
  for (const role of ["tenant_owner", "owner_root", "admin"]) {
    assert.throws(
      () => loadConfig({ AUTH0_TENANT_MEMBERSHIPS_JSON: JSON.stringify({ "oauth|bad": { tenant_id: "codexai", role } }) }),
      /invalid membership role/,
    );
  }
  assert.throws(
    () => loadConfig({ AUTH0_TENANT_MEMBERSHIPS_JSON: JSON.stringify({ "oauth|bad": "codexai" }) }),
    /must contain tenant_id and role/,
  );
  assert.throws(
    () => loadConfig({ AUTH0_TENANT_MEMBERSHIPS_JSON: JSON.stringify({
      "oauth|support": { tenant_id: "client-a", role: "support_delegate" },
    }) }),
    /requires a valid delegation_id/,
  );
});

test("keeps OAuth owner confirmation usable during a bounded ChatGPT work session", () => {
  const config = loadConfig({});
  assert.equal(config.oauthOwnerConfirmationMaxAgeSeconds, 43200);
});

test("maps Suite Control Plane keys only to their configured tenants", () => {
  const config = loadConfig({
    SUITE_CONTROL_PLANE_URL: "https://suite.example.test/",
    SUITE_CONTROL_PLANE_KEYS_JSON: JSON.stringify({
      "tenant-a": "suite-key-a",
      "tenant-b": { tenant_id: "tenant-b", secret: "suite-key-b", scopes: ["suite:read"] },
      codexai: { tenant_id: "skinharmony-suite", secret: "suite-codex-key" },
    }),
    SUITE_CONTROL_PLANE_TIMEOUT_MS: "999999",
    SUITE_CONTROL_PLANE_CACHE_TTL_MS: "-1",
  });

  assert.equal(config.suiteControlPlaneUrl, "https://suite.example.test");
  assert.deepEqual(config.suiteControlPlaneKeys, { "tenant-a": "suite-key-a", "tenant-b": "suite-key-b", codexai: "suite-codex-key" });
  assert.deepEqual(config.suiteControlPlaneTenantMap, { "tenant-a": "tenant-a", "tenant-b": "tenant-b", codexai: "skinharmony-suite" });
  assert.equal(config.suiteControlPlaneTimeoutMs, 30000);
  assert.equal(config.suiteControlPlaneCacheTtlMs, 0);
});

test("requires an explicit tenant binding for the single Suite key compatibility mode", () => {
  assert.throws(() => loadConfig({ SUITE_CONTROL_PLANE_API_KEY: "suite-key" }), /SUITE_CONTROL_PLANE_TENANT_ID/);
  const config = loadConfig({
    SUITE_CONTROL_PLANE_URL: "https://suite.example.test",
    SUITE_CONTROL_PLANE_API_KEY: "suite-key",
    SUITE_CONTROL_PLANE_TENANT_ID: "tenant-a",
  });
  assert.deepEqual(config.suiteControlPlaneKeys, { "tenant-a": "suite-key" });
  assert.deepEqual(config.suiteControlPlaneTenantMap, { "tenant-a": "tenant-a" });
});

test("rejects invalid Suite key maps", () => {
  assert.throws(() => loadConfig({ SUITE_CONTROL_PLANE_KEYS_JSON: "{" }), /valid JSON/);
  assert.throws(() => loadConfig({
    SUITE_CONTROL_PLANE_KEYS_JSON: JSON.stringify({ "../tenant": "key" }),
  }), /invalid tenant id/);
});

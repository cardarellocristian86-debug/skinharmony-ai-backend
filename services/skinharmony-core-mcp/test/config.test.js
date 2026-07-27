import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

function collaborationRuntimeEnv(overrides = {}) {
  return {
    MCP_COLLABORATION_DATABASE_URL: "postgres://staging-collaboration-db",
    MCP_COLLABORATION_CORE_ISSUER_HOSTPORT: "skinharmony-core-staging-issuer:8789",
    MCP_COLLABORATION_NYRA_ISSUER_HOSTPORT: "skinharmony-nyra-staging-issuer:8789",
    MCP_COLLABORATION_CORE_ISSUER_TOKEN: "core-token-test-only-0123456789abcdef",
    MCP_COLLABORATION_NYRA_ISSUER_TOKEN: "nyra-token-test-only-0123456789abcdef",
    ...overrides,
  };
}

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
  const postgresOnly = loadConfig(collaborationRuntimeEnv({
    DATABASE_URL: "postgres://existing-service-db",
    MCP_COLLABORATION_LOCKS_REQUIRED: "false",
    MCP_COLLABORATION_IDEMPOTENCY_REQUIRED: "false",
    MCP_COLLABORATION_TASK_CONTRACT_REQUIRED: "false",
  }));
  assert.equal(postgresOnly.databaseUrl, "postgres://existing-service-db");
  assert.equal(postgresOnly.collaborationDatabaseUrl, "postgres://staging-collaboration-db");
  assert.equal(postgresOnly.collaborationReceiptEnforcement, true);
  assert.equal(postgresOnly.sharedMemoryDatabaseUrl, "postgres://staging-collaboration-db");
  assert.equal(postgresOnly.cloudMemoryDatabaseUrl, "");
  assert.equal(postgresOnly.decisionLedgerDatabaseUrl, "postgres://staging-collaboration-db");
  assert.equal(postgresOnly.collaborationLocksRequired, true);
  assert.equal(postgresOnly.collaborationIdempotencyRequired, true);
  assert.equal(postgresOnly.collaborationTaskContractRequired, true);
  assert.equal(postgresOnly.collaborationLockLeaseSeconds, 60);
  assert.equal(postgresOnly.collaborationDatabaseTimeoutMs, 8_000);
});

test("does not enable PostgreSQL collaboration from the generic database URL", () => {
  const config = loadConfig({ DATABASE_URL: "postgres://existing-service-db" });
  assert.equal(config.collaborationDatabaseUrl, "");
  assert.equal(config.collaborationReceiptEnforcement, false);
  assert.equal(config.collaborationDatabaseSsl, false);
  assert.equal(config.sharedMemoryDatabaseUrl, "");
  assert.equal(config.cloudMemoryDatabaseUrl, "postgres://existing-service-db");
  assert.equal(config.decisionLedgerDatabaseUrl, "postgres://existing-service-db");
  assert.equal(config.collaborationLocksRequired, false);
  assert.equal(config.collaborationIdempotencyRequired, false);
  assert.equal(config.collaborationTaskContractRequired, false);
});

test("maps the collaboration receipt configuration without reusing generic credentials", () => {
  assert.throws(() => loadConfig(collaborationRuntimeEnv({
    MCP_COLLABORATION_CORE_JWK: "core-public-jwk",
    MCP_COLLABORATION_CORE_KID: "core-kid",
  })), /Static collaboration trust anchors are forbidden/);
  const config = loadConfig(collaborationRuntimeEnv({
    MCP_COLLABORATION_TARGET_SERVICE: "skinharmony-core-mcp-staging",
    MCP_COLLABORATION_TARGET_ENVIRONMENT: "staging",
    MCP_COLLABORATION_BUILD_COMMIT: "a".repeat(40),
    MCP_COLLABORATION_RUNTIME_DATABASE_ROLE: "mcp_collaboration_runtime",
    MCP_COLLABORATION_RECEIPT_TTL_MS: "999999",
    MCP_COLLABORATION_ISSUER_TIMEOUT_MS: "999999",
  }));

  assert.equal(config.collaborationReceiptCoreJwk, "");
  assert.equal(config.collaborationReceiptCoreKid, "");
  assert.equal(config.collaborationReceiptNyraJwk, "");
  assert.equal(config.collaborationReceiptNyraKid, "");
  assert.equal(config.collaborationCoreIssuerHostport, "skinharmony-core-staging-issuer:8789");
  assert.equal(config.collaborationNyraIssuerHostport, "skinharmony-nyra-staging-issuer:8789");
  assert.equal(config.collaborationCoreIssuerToken, "core-token-test-only-0123456789abcdef");
  assert.equal(config.collaborationNyraIssuerToken, "nyra-token-test-only-0123456789abcdef");
  assert.equal(config.collaborationTargetService, "skinharmony-core-mcp-staging");
  assert.equal(config.collaborationTargetEnvironment, "staging");
  assert.equal(config.collaborationBuildCommit, "a".repeat(40));
  assert.equal(config.collaborationAllowedTenantId, "codexai");
  assert.equal(config.collaborationRuntimeDatabaseRole, "mcp_collaboration_runtime");
  assert.equal(config.collaborationReceiptTtlMs, 30_000);
  assert.equal(config.collaborationIssuerTimeoutMs, 10_000);
});

test("hard-pins PostgreSQL collaboration to the codexai staging service and a full build commit", () => {
  const base = { MCP_COLLABORATION_DATABASE_URL: "postgres://staging-collaboration-db" };
  assert.throws(() => loadConfig({ ...base, MCP_COLLABORATION_ALLOWED_TENANT_ID: "other-tenant" }), /must be codexai/);
  assert.throws(() => loadConfig({ ...base, MCP_COLLABORATION_TARGET_ENVIRONMENT: "production" }), /must be staging/);
  assert.throws(() => loadConfig({ ...base, MCP_COLLABORATION_TARGET_SERVICE: "other-service" }), /must be skinharmony-core-mcp-staging/);
  assert.throws(() => loadConfig({ ...base, MCP_COLLABORATION_BUILD_COMMIT: "short" }), /must be a full Git commit/);
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
  assert.equal(config.openaiResearchEnabled, false);
  assert.equal(config.openaiResearchModel, "gpt-5.6");
});

test("keeps the OpenAI research fallback opt-in and bounded", () => {
  const config = loadConfig({
    OPENAI_API_KEY: "configured-but-never-returned",
    NYRA_OPENAI_RESEARCH_ENABLED: "true",
    NYRA_OPENAI_RESEARCH_MODEL: "gpt-5.6",
    NYRA_OPENAI_RESEARCH_TIMEOUT_MS: "999999",
    NYRA_OPENAI_RESEARCH_MAX_CALLS_PER_HOUR: "999",
    RESEARCH_RETENTION_DAYS: "99999",
  });
  assert.equal(config.openaiResearchEnabled, true);
  assert.equal(config.openaiApiKey, "configured-but-never-returned");
  assert.equal(config.openaiResearchTimeoutMs, 300000);
  assert.equal(config.openaiResearchMaxCallsPerHour, 100);
  assert.equal(config.researchRetentionDays, 3650);
});

test("requires the decision ledger by default only in production", () => {
  const production = { NODE_ENV: "production", CODEX_BEARER_KEYS: "test-key" };
  assert.equal(loadConfig({}).decisionLedgerRequired, false);
  assert.equal(loadConfig(production).decisionLedgerRequired, true);
  assert.equal(loadConfig({ ...production, CORE_DECISION_LEDGER_REQUIRED: "false" }).decisionLedgerRequired, false);
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

test("maps the generated provider setup-link key only to the configured ChatGPT tenant", () => {
  const config = loadConfig({
    MCP_CHATGPT_TENANT_ID: "codexai",
    CORE_MCP_KEY: "normal-core-key",
    CORE_PROVIDER_SETUP_LINK_KEY: "scoped-provider-link-key",
  });

  assert.deepEqual(config.universalCoreKeys, { codexai: "normal-core-key" });
  assert.deepEqual(config.universalCoreProviderSetupLinkKeys, { codexai: "scoped-provider-link-key" });
  assert.equal(config.providerSetupLinkSourceConfigured, true);
});

test("accepts a tenant-neutral provider setup-link service key", () => {
  const config = loadConfig({
    CORE_PROVIDER_SETUP_LINK_SERVICE_KEY: "service-provider-link-key",
  });

  assert.equal(config.providerSetupLinkServiceKey, "service-provider-link-key");
  assert.equal(config.providerSetupLinkSourceConfigured, true);
  assert.deepEqual(config.universalCoreProviderSetupLinkKeys, {});
});

test("requires a tenant binding for the dedicated provider setup-link key", () => {
  assert.throws(
    () => loadConfig({ CORE_PROVIDER_SETUP_LINK_KEY: "scoped-provider-link-key" }),
    /MCP_CHATGPT_TENANT_ID/,
  );
});

test("keeps an explicit provider setup-link mapping over the generated single-tenant key", () => {
  const config = loadConfig({
    MCP_CHATGPT_TENANT_ID: "codexai",
    CORE_PROVIDER_SETUP_LINK_KEY: "generated-key",
    UNIVERSAL_CORE_PROVIDER_SETUP_LINK_KEYS_JSON: JSON.stringify({ codexai: "explicit-scoped-key", "tenant-b": "tenant-b-scoped-key" }),
  });

  assert.deepEqual(config.universalCoreProviderSetupLinkKeys, {
    codexai: "explicit-scoped-key",
    "tenant-b": "tenant-b-scoped-key",
  });
});

test("rejects invalid provider setup-link key maps", () => {
  assert.throws(
    () => loadConfig({ UNIVERSAL_CORE_PROVIDER_SETUP_LINK_KEYS_JSON: JSON.stringify({ "../tenant": "key" }) }),
    /invalid tenant id/,
  );
  assert.throws(
    () => loadConfig({ UNIVERSAL_CORE_PROVIDER_SETUP_LINK_KEYS_JSON: JSON.stringify({ codexai: "" }) }),
    /empty key/,
  );
});

test("reports no owner portal source when its dedicated tenant binding is absent", () => {
  const config = loadConfig({
    UNIVERSAL_CORE_PROVIDER_SETUP_LINK_KEYS_JSON: JSON.stringify({ "tenant-b": "tenant-b-scoped-key" }),
  });

  assert.equal(config.providerSetupLinkSourceConfigured, false);
});

test("loads the separate owner-context signing secret without exposing it through status flags", () => {
  const signingSecret = "test-owner-context-signing-secret-0123456789";
  const config = loadConfig({
    CORE_OWNER_CONTEXT_SIGNING_SECRET: signingSecret,
  });

  assert.equal(config.ownerContextSigningSecret, signingSecret);
  assert.equal(loadConfig({ CORE_OWNER_CONTEXT_SIGNING_SECRET: "too-short" }).ownerContextSigningSecret, "");
});

test("requires a full immutable build identity for the strict provider binding", () => {
  assert.equal(loadConfig({ RENDER_GIT_COMMIT: "a".repeat(40) }).runtimeBuildCommit, "a".repeat(40));
  assert.throws(() => loadConfig({ RENDER_GIT_COMMIT: "a".repeat(7) }), /full 40-character commit SHA/);
});

test("keeps browser OAuth audience separate from the MCP resource audience", () => {
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
  assert.equal(config.auth0BrowserAudience, "https://mcp.example.test/browser");
});

test("requires a dedicated browser audience when the owner portal is configured", () => {
  assert.throws(() => loadConfig({
    AUTH0_ISSUER: "https://tenant.auth0.com",
    AUTH0_AUDIENCE: "https://mcp.example.test/mcp",
    AUTH0_BROWSER_CLIENT_ID: "browser-client",
    AUTH0_BROWSER_STATE_SECRET: "state-secret",
  }), /AUTH0_BROWSER_AUDIENCE/);
});

test("requires a strong browser portal state and session secret in production", () => {
  assert.throws(() => loadConfig({
    NODE_ENV: "production",
    MCP_PUBLIC_URL: "https://mcp.example.test",
    AUTH0_ISSUER: "https://tenant.auth0.com",
    AUTH0_AUDIENCE: "https://mcp.example.test/mcp",
    AUTH0_BROWSER_CLIENT_ID: "browser-client",
    AUTH0_BROWSER_AUDIENCE: "https://mcp.example.test/browser",
    AUTH0_BROWSER_STATE_SECRET: "too-short",
    CODEX_BEARER_KEYS: "local-test-key",
  }), /at least 32 bytes/);
});

test("loads OAuth owner tenant bindings only from server-side configuration", () => {
  const config = loadConfig({
    AUTH0_OWNER_TENANT_BINDINGS_JSON: JSON.stringify({ "oauth-owner-fixture": "codexai" }),
    AUTH0_OWNER_CONFIRMATION_MAX_AGE_SECONDS: "600",
  });
  assert.deepEqual(config.oauthOwnerTenantBindings, { "oauth-owner-fixture": "codexai" });
  assert.equal(config.oauthOwnerConfirmationMaxAgeSeconds, 43_200);
  assert.throws(() => loadConfig({ AUTH0_OWNER_TENANT_BINDINGS_JSON: JSON.stringify({ "oauth-owner-fixture": "../other" }) }), /invalid tenant id/);
});

test("keeps OAuth owner confirmation usable during a bounded ChatGPT work session", () => {
  const config = loadConfig({});
  assert.equal(config.oauthOwnerConfirmationMaxAgeSeconds, 43_200);
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

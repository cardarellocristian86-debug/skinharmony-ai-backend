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

test("keeps browser OAuth audience separate from the MCP resource audience", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    MCP_PUBLIC_URL: "https://mcp.example.test",
    AUTH0_ISSUER: "https://tenant.auth0.com",
    AUTH0_AUDIENCE: "https://mcp.example.test/mcp",
    AUTH0_BROWSER_CLIENT_ID: "browser-client",
    AUTH0_BROWSER_STATE_SECRET: "state-secret",
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

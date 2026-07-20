function csv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function url(value, name) {
  if (!value) return "";
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
}

function jsonObject(value, name) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    return parsed;
  } catch {
    throw new Error(`${name} must be a JSON object`);
  }
}

function tenantKeyMap(value, name) {
  const parsed = jsonObject(value, name);
  const result = {};
  for (const [tenantIdValue, secretValue] of Object.entries(parsed)) {
    const tenantId = String(tenantIdValue || "").trim();
    const secret = typeof secretValue === "string" ? secretValue.trim() : "";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(tenantId)) {
      throw new Error(`${name} contains an invalid tenant id`);
    }
    if (!secret) throw new Error(`${name} contains an empty key`);
    result[tenantId] = secret;
  }
  return result;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function parseSuiteControlPlaneKeys(value, singleKey, singleTenantId) {
  const bindings = {};
  const tenantMap = {};
  const add = (identityTenantValue, suiteTenantValue, secretValue) => {
    const identityTenantId = String(identityTenantValue || "").trim();
    const suiteTenantId = String(suiteTenantValue || identityTenantId).trim();
    const secret = String(secretValue || "").trim();
    if (!identityTenantId || !suiteTenantId || !secret) return;
    if (![identityTenantId, suiteTenantId].every((tenantId) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(tenantId))) {
      throw new Error("SUITE_CONTROL_PLANE_KEYS_JSON contains an invalid tenant id");
    }
    if (bindings[identityTenantId] && (bindings[identityTenantId] !== secret || tenantMap[identityTenantId] !== suiteTenantId)) {
      throw new Error(`SUITE_CONTROL_PLANE_KEYS_JSON contains duplicate tenant ${identityTenantId}`);
    }
    bindings[identityTenantId] = secret;
    tenantMap[identityTenantId] = suiteTenantId;
  };

  if (value) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("SUITE_CONTROL_PLANE_KEYS_JSON must be valid JSON");
    }
    if (Array.isArray(parsed)) {
      for (const record of parsed) {
        const identityTenantId = record?.mcp_tenant_id || record?.identity_tenant_id || record?.tenant_id;
        add(identityTenantId, record?.suite_tenant_id || record?.tenant_id || identityTenantId, record?.secret || record?.key || record?.api_key);
      }
    } else if (parsed && typeof parsed === "object") {
      for (const [entryKey, entryValue] of Object.entries(parsed)) {
        if (typeof entryValue === "string") add(entryKey, entryKey, entryValue);
        else if (entryValue && typeof entryValue === "object") {
          const identityTenantId = entryValue.mcp_tenant_id || entryValue.identity_tenant_id || entryKey;
          add(identityTenantId, entryValue.suite_tenant_id || entryValue.tenant_id || identityTenantId, entryValue.secret || entryValue.key || entryValue.api_key);
        }
      }
    } else {
      throw new Error("SUITE_CONTROL_PLANE_KEYS_JSON must be an object or array");
    }
  }

  const compatibilityKey = String(singleKey || "").trim();
  const compatibilityTenant = String(singleTenantId || "").trim();
  if (compatibilityKey && !compatibilityTenant) {
    throw new Error("SUITE_CONTROL_PLANE_TENANT_ID is required with SUITE_CONTROL_PLANE_API_KEY");
  }
  add(compatibilityTenant, compatibilityTenant, compatibilityKey);
  return { keys: bindings, tenantMap };
}

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function flag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function optionalFullCommit(value, name) {
  const commit = String(value || "").trim().toLowerCase();
  if (!commit) return "";
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`${name} must be a full 40-character commit SHA`);
  return commit;
}

export function loadConfig(env = process.env) {
  const publicUrl = url(env.MCP_PUBLIC_URL || "http://localhost:8790", "MCP_PUBLIC_URL");
  const auth0Issuer = url(env.AUTH0_ISSUER, "AUTH0_ISSUER");
  const auth0Audience = String(env.AUTH0_AUDIENCE || "").trim();
  const auth0BrowserAudience = String(env.AUTH0_BROWSER_AUDIENCE || "").trim();
  const codexKeys = csv(env.CODEX_BEARER_KEYS);
  const universalCoreUrl = url(env.UNIVERSAL_CORE_URL || env.CORE_BASE_URL || "http://127.0.0.1:8787", "UNIVERSAL_CORE_URL");
  const universalCoreKey = String(env.UNIVERSAL_CORE_KEY || "").trim();
  const universalCoreKeys = jsonObject(env.UNIVERSAL_CORE_KEYS_JSON, "UNIVERSAL_CORE_KEYS_JSON");
  const universalCoreProviderSetupLinkKeys = tenantKeyMap(
    env.UNIVERSAL_CORE_PROVIDER_SETUP_LINK_KEYS_JSON,
    "UNIVERSAL_CORE_PROVIDER_SETUP_LINK_KEYS_JSON",
  );
  const suiteControlPlaneUrl = url(env.SUITE_CONTROL_PLANE_URL, "SUITE_CONTROL_PLANE_URL");
  const suiteControlPlaneBindings = parseSuiteControlPlaneKeys(
    env.SUITE_CONTROL_PLANE_KEYS_JSON,
    env.SUITE_CONTROL_PLANE_API_KEY,
    env.SUITE_CONTROL_PLANE_TENANT_ID,
  );
  const agentSignatureSecret = String(env.AGENT_SIGNATURE_SECRET || "").trim();
  const ownerContextSigningSecretCandidate = String(env.CORE_OWNER_CONTEXT_SIGNING_SECRET || "").trim();
  // Keep this independent from Core bearer credentials. A short value is not
  // a usable signature key and therefore deliberately behaves as missing.
  const ownerContextSigningSecret = ownerContextSigningSecretCandidate.length >= 32
    ? ownerContextSigningSecretCandidate
    : "";
  const runtimeBuildCommit = optionalFullCommit(env.RENDER_GIT_COMMIT || env.GIT_COMMIT, "RENDER_GIT_COMMIT");
  const chatgptTenantId = String(env.MCP_CHATGPT_TENANT_ID || "").trim();
  const chatgptCoreKey = String(env.CORE_MCP_KEY || "").trim();
  const chatgptProviderSetupLinkKey = String(env.CORE_PROVIDER_SETUP_LINK_KEY || "").trim();
  // Unlike the legacy tenant-pinned bootstrap key, this key can only mint a
  // setup link after Core verifies a signed tenant-owner context. It has no
  // read, execution, vault-read, or generic tenant scopes.
  const providerSetupLinkServiceKey = String(env.CORE_PROVIDER_SETUP_LINK_SERVICE_KEY || "").trim();
  const tenantGatewayKey = String(env.CORE_MCP_TENANT_GATEWAY_KEY || "").trim();
  if (chatgptTenantId && chatgptCoreKey && !universalCoreKeys[chatgptTenantId]) {
    universalCoreKeys[chatgptTenantId] = chatgptCoreKey;
  }
  if (chatgptProviderSetupLinkKey && !chatgptTenantId) {
    throw new Error("MCP_CHATGPT_TENANT_ID is required with CORE_PROVIDER_SETUP_LINK_KEY");
  }
  if (chatgptTenantId && chatgptProviderSetupLinkKey && !hasOwn(universalCoreProviderSetupLinkKeys, chatgptTenantId)) {
    universalCoreProviderSetupLinkKeys[chatgptTenantId] = chatgptProviderSetupLinkKey;
  }
  // Health exposes only this boolean, never a tenant id, map entry, or key.
  // It represents the dedicated source binding used by the owner portal.
  const providerSetupLinkSourceConfigured = Boolean(
    providerSetupLinkServiceKey || (chatgptTenantId && hasOwn(universalCoreProviderSetupLinkKeys, chatgptTenantId)),
  );
  const defaultTenantId = String(env.MCP_DEFAULT_TENANT_ID || "owner-private").trim();
  const tenantClaim = String(env.MCP_TENANT_CLAIM || "https://skinharmony.it/tenant_id").trim();
  // Enabled by the production Blueprint. Keep the code default fail-closed so
  // an existing installation does not silently change tenant routing on update.
  const selfServiceTenantsEnabled = flag(env.MCP_SELF_SERVICE_TENANTS_ENABLED, false);
  const sharedMemoryRoot = String(env.SHARED_WORK_MEMORY_ROOT || new URL("../../../shared-work-memory", import.meta.url).pathname).trim();
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  // Collaboration state must never silently share the service's existing
  // DATABASE_URL. It is intentionally opt-in and has a distinct Render secret.
  const collaborationDatabaseUrl = String(env.MCP_COLLABORATION_DATABASE_URL || "").trim();
  const decisionLedgerRequired = flag(env.CORE_DECISION_LEDGER_REQUIRED, env.NODE_ENV === "production");
  const agentWorkspaceRoot = String(env.AGENT_WORKSPACE_ROOT || "").trim();
  const memoryFabricRoot = String(env.MEMORY_FABRIC_ROOT || agentWorkspaceRoot || "").trim();
  const researchCortexRoot = String(env.RESEARCH_CORTEX_ROOT || memoryFabricRoot || agentWorkspaceRoot || "").trim();
  const godModeEnabled = flag(env.NYRA_GOD_MODE_ENABLED, false);
  const godModeTenantIds = csv(env.NYRA_GOD_MODE_TENANT_IDS || env.NYRA_GOD_MODE_TENANT_ID || "owner-private");
  const godModeSubjects = csv(env.NYRA_GOD_MODE_SUBJECTS);
  const godModeClientIds = csv(env.NYRA_GOD_MODE_CLIENT_IDS);
  const godModeCodexEnabled = flag(env.NYRA_GOD_MODE_CODEX_ENABLED, false);
  const godModeEmergencyStop = flag(env.NYRA_GOD_MODE_EMERGENCY_STOP, false);
  if (env.NODE_ENV === "production" && !auth0Issuer && !codexKeys.length) {
    throw new Error("At least one authentication method is required in production");
  }
  if (auth0Issuer && !auth0Audience) throw new Error("AUTH0_AUDIENCE is required with AUTH0_ISSUER");
  const browserPortalConfigured = Boolean(env.AUTH0_BROWSER_CLIENT_ID || env.AUTH0_BROWSER_STATE_SECRET);
  if (browserPortalConfigured && !auth0BrowserAudience) throw new Error("AUTH0_BROWSER_AUDIENCE is required when the owner browser portal is configured");
  return {
    port: Number(env.PORT || 8790),
    publicUrl,
    resource: `${publicUrl}/mcp`,
    auth0Issuer,
    auth0Audience,
    auth0BrowserAudience,
    jwksUri: auth0Issuer ? `${auth0Issuer}/.well-known/jwks.json` : "",
    codexKeys,
    codexScopes: csv(env.CODEX_BEARER_SCOPES || "core:read,core:govern"),
    supportedScopes: csv(env.MCP_SUPPORTED_SCOPES || "core:read,core:govern"),
    universalCoreUrl,
    universalCoreKey,
    universalCoreKeys,
    universalCoreProviderSetupLinkKeys,
    providerSetupLinkServiceKey,
    tenantGatewayKey,
    providerSetupLinkSourceConfigured,
    suiteControlPlaneUrl,
    suiteControlPlaneKeys: suiteControlPlaneBindings.keys,
    suiteControlPlaneTenantMap: suiteControlPlaneBindings.tenantMap,
    suiteControlPlaneTimeoutMs: integer(env.SUITE_CONTROL_PLANE_TIMEOUT_MS, 8_000, 100, 30_000),
    suiteControlPlaneCacheTtlMs: integer(env.SUITE_CONTROL_PLANE_CACHE_TTL_MS, 5_000, 0, 60_000),
    agentSignatureSecret,
    ownerContextSigningSecret,
    runtimeBuildCommit,
    defaultTenantId,
    tenantClaim,
    selfServiceTenantsEnabled,
    tenantOwnerRoleClaim: String(env.MCP_TENANT_OWNER_ROLE_CLAIM || "https://skinharmony.it/role").trim(),
    tenantOwnerRoles: csv(env.MCP_TENANT_OWNER_ROLES || "tenant_owner,tenant_admin,owner_root"),
    sharedMemoryRoot,
    databaseUrl,
    collaborationDatabaseUrl,
    decisionLedgerRequired,
    databaseSsl: flag(env.DATABASE_SSL, env.NODE_ENV === "production"),
    collaborationDatabaseSsl: flag(env.MCP_COLLABORATION_DATABASE_SSL, env.NODE_ENV === "production"),
    databasePoolMax: integer(env.DATABASE_POOL_MAX, 5, 1, 20),
    cloudMemoryMaxDocumentBytes: integer(env.CLOUD_MEMORY_MAX_DOCUMENT_BYTES, 250_000, 1_000, 900_000),
    agentWorkspaceRoot,
    memoryFabricRoot,
    researchCortexRoot,
    godModeEnabled,
    godModeTenantIds,
    godModeSubjects,
    godModeClientIds,
    godModeCodexEnabled,
    godModeEmergencyStop,
    memoryRetentionDays: integer(env.MEMORY_RETENTION_DAYS, 365, 1, 3_650),
    personalMemoryRetentionDays: integer(env.MEMORY_PERSONAL_RETENTION_DAYS, 90, 1, 365),
    researchRetentionDays: integer(env.RESEARCH_RETENTION_DAYS, 365, 1, 3_650),
    openaiApiKey: String(env.OPENAI_API_KEY || "").trim(),
    auth0BrowserClientId: String(env.AUTH0_BROWSER_CLIENT_ID || "").trim(),
    auth0BrowserClientSecret: String(env.AUTH0_BROWSER_CLIENT_SECRET || "").trim(),
    auth0BrowserCallbackUrl: url(env.AUTH0_BROWSER_CALLBACK_URL || `${publicUrl}/connect/openai/callback`, "AUTH0_BROWSER_CALLBACK_URL"),
    auth0BrowserStateSecret: String(env.AUTH0_BROWSER_STATE_SECRET || "").trim(),
    openaiResearchEnabled: flag(env.NYRA_OPENAI_RESEARCH_ENABLED, false),
    openaiResearchModel: String(env.NYRA_OPENAI_RESEARCH_MODEL || "gpt-5.6").trim(),
    openaiResearchTimeoutMs: integer(env.NYRA_OPENAI_RESEARCH_TIMEOUT_MS, 90_000, 5_000, 300_000),
    openaiResearchMaxCallsPerHour: integer(env.NYRA_OPENAI_RESEARCH_MAX_CALLS_PER_HOUR, 10, 1, 100)
  };
}

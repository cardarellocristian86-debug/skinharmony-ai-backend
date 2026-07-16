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

export function loadConfig(env = process.env) {
  const publicUrl = url(env.MCP_PUBLIC_URL || "http://localhost:8790", "MCP_PUBLIC_URL");
  const auth0Issuer = url(env.AUTH0_ISSUER, "AUTH0_ISSUER");
  const auth0Audience = String(env.AUTH0_AUDIENCE || "").trim();
  const codexKeys = csv(env.CODEX_BEARER_KEYS);
  const universalCoreUrl = url(env.UNIVERSAL_CORE_URL || env.CORE_BASE_URL || "http://127.0.0.1:8787", "UNIVERSAL_CORE_URL");
  const universalCoreKey = String(env.UNIVERSAL_CORE_KEY || "").trim();
  const universalCoreKeys = jsonObject(env.UNIVERSAL_CORE_KEYS_JSON, "UNIVERSAL_CORE_KEYS_JSON");
  const suiteControlPlaneUrl = url(env.SUITE_CONTROL_PLANE_URL, "SUITE_CONTROL_PLANE_URL");
  const suiteControlPlaneBindings = parseSuiteControlPlaneKeys(
    env.SUITE_CONTROL_PLANE_KEYS_JSON,
    env.SUITE_CONTROL_PLANE_API_KEY,
    env.SUITE_CONTROL_PLANE_TENANT_ID,
  );
  const agentSignatureSecret = String(env.AGENT_SIGNATURE_SECRET || "").trim();
  const chatgptTenantId = String(env.MCP_CHATGPT_TENANT_ID || "").trim();
  const chatgptCoreKey = String(env.CORE_MCP_KEY || "").trim();
  if (chatgptTenantId && chatgptCoreKey && !universalCoreKeys[chatgptTenantId]) {
    universalCoreKeys[chatgptTenantId] = chatgptCoreKey;
  }
  const defaultTenantId = String(env.MCP_DEFAULT_TENANT_ID || "owner-private").trim();
  const tenantClaim = String(env.MCP_TENANT_CLAIM || "https://skinharmony.it/tenant_id").trim();
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
  return {
    port: Number(env.PORT || 8790),
    publicUrl,
    resource: `${publicUrl}/mcp`,
    auth0Issuer,
    auth0Audience,
    jwksUri: auth0Issuer ? `${auth0Issuer}/.well-known/jwks.json` : "",
    codexKeys,
    codexScopes: csv(env.CODEX_BEARER_SCOPES || "core:read,core:govern"),
    supportedScopes: csv(env.MCP_SUPPORTED_SCOPES || "core:read,core:govern"),
    universalCoreUrl,
    universalCoreKey,
    universalCoreKeys,
    suiteControlPlaneUrl,
    suiteControlPlaneKeys: suiteControlPlaneBindings.keys,
    suiteControlPlaneTenantMap: suiteControlPlaneBindings.tenantMap,
    suiteControlPlaneTimeoutMs: integer(env.SUITE_CONTROL_PLANE_TIMEOUT_MS, 8_000, 100, 30_000),
    suiteControlPlaneCacheTtlMs: integer(env.SUITE_CONTROL_PLANE_CACHE_TTL_MS, 5_000, 0, 60_000),
    agentSignatureSecret,
    defaultTenantId,
    tenantClaim,
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
    openaiResearchEnabled: flag(env.NYRA_OPENAI_RESEARCH_ENABLED, false),
    openaiResearchModel: String(env.NYRA_OPENAI_RESEARCH_MODEL || "gpt-5.6").trim(),
    openaiResearchTimeoutMs: integer(env.NYRA_OPENAI_RESEARCH_TIMEOUT_MS, 90_000, 5_000, 300_000),
    openaiResearchMaxCallsPerHour: integer(env.NYRA_OPENAI_RESEARCH_MAX_CALLS_PER_HOUR, 10, 1, 100)
  };
}

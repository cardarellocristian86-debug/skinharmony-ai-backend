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

function parseOauthOwnerTenantBindings(value, name) {
  if (!value) return {};
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error(`${name} must be a JSON object`); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(`${name} must be a JSON object`);
  const result = {};
  for (const [subjectValue, tenantValue] of Object.entries(parsed)) {
    const subject = String(subjectValue || "").trim();
    const tenantId = typeof tenantValue === "string"
      ? tenantValue.trim()
      : String(tenantValue?.tenant_id || "").trim();
    if (!subject || subject.length > 240) throw new Error(`${name} contains an invalid subject`);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(tenantId)) throw new Error(`${name} contains an invalid tenant id`);
    result[subject] = tenantId;
  }
  return result;
}

const OAUTH_TENANT_MEMBERSHIP_ROLES = new Set(["member", "reviewer", "operator", "support_delegate"]);

function parseOauthTenantMemberships(value, name) {
  const parsed = jsonObject(value, name);
  const result = {};
  for (const [subjectValue, membershipValue] of Object.entries(parsed)) {
    const subject = String(subjectValue || "").trim();
    if (!subject || subject.length > 240) throw new Error(`${name} contains an invalid subject`);
    if (!membershipValue || Array.isArray(membershipValue) || typeof membershipValue !== "object") {
      throw new Error(`${name} membership must contain tenant_id and role`);
    }
    const tenantId = String(membershipValue.tenant_id || "").trim();
    const role = String(membershipValue.role || "").trim().toLowerCase();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(tenantId)) {
      throw new Error(`${name} contains an invalid tenant id`);
    }
    if (!OAUTH_TENANT_MEMBERSHIP_ROLES.has(role)) {
      throw new Error(`${name} contains an invalid membership role`);
    }
    if (role === "support_delegate") {
      const delegationId = String(membershipValue.delegation_id || "").trim();
      const expiresAt = String(membershipValue.expires_at || "").trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{1,119}$/.test(delegationId)) {
        throw new Error(`${name} support delegation requires a valid delegation_id`);
      }
      if (!Number.isFinite(Date.parse(expiresAt))) {
        throw new Error(`${name} support delegation requires a valid expires_at`);
      }
      result[subject] = { tenantId, role, delegationId, expiresAt };
      continue;
    }
    result[subject] = { tenantId, role };
  }
  return result;
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

function strictInteger(value, fallback, min, max, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
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
  const environment = String(env.NODE_ENV || "development").trim().toLowerCase();
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
  const agentSignatureSecretCandidate = String(
    env.AGENT_SIGNATURE_SECRET || "",
  ).trim();
  const agentSignatureSecret =
    Buffer.byteLength(agentSignatureSecretCandidate, "utf8") >= 32
      ? agentSignatureSecretCandidate
      : "";
  const dttAgentIdentitySigningSecretCandidate = String(env.DTT_AGENT_IDENTITY_SIGNING_SECRET || "").trim();
  const dttAgentIdentitySigningSecret = dttAgentIdentitySigningSecretCandidate.length >= 32
    ? dttAgentIdentitySigningSecretCandidate
    : "";
  const nyraDeepV2McpRequestSigningSecretCandidate = String(
    env.CORE_NYRA_DEEP_BRANCH_V2_MCP_REQUEST_SIGNING_SECRET || "",
  ).trim();
  const nyraDeepV2McpRequestSigningSecret =
    nyraDeepV2McpRequestSigningSecretCandidate.length >= 32
      ? nyraDeepV2McpRequestSigningSecretCandidate
      : "";
  const ownerContextSigningSecretCandidate = String(env.CORE_OWNER_CONTEXT_SIGNING_SECRET || "").trim();
  // Keep this independent from Core bearer credentials. A short value is not
  // a usable signature key and therefore deliberately behaves as missing.
  const ownerContextSigningSecret = ownerContextSigningSecretCandidate.length >= 32
    ? ownerContextSigningSecretCandidate
    : "";
  const tenantContextSigningSecretCandidate = String(
    env.CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET || "",
  ).trim();
  const tenantContextSigningSecret =
    Buffer.byteLength(tenantContextSigningSecretCandidate, "utf8") >= 32
      ? tenantContextSigningSecretCandidate
      : "";
  const runtimeBuildCommit = optionalFullCommit(env.RENDER_GIT_COMMIT || env.GIT_COMMIT, "RENDER_GIT_COMMIT");
  const chatgptTenantId = String(env.MCP_CHATGPT_TENANT_ID || "").trim();
  const chatgptCoreKey = String(env.CORE_MCP_KEY || "").trim();
  const tenantGatewayKeyCandidate = String(
    env.CORE_MCP_TENANT_GATEWAY_KEY || "",
  ).trim();
  const tenantGatewayKey =
    Buffer.byteLength(tenantGatewayKeyCandidate, "utf8") >= 32
      ? tenantGatewayKeyCandidate
      : "";
  if (chatgptTenantId && chatgptCoreKey && !universalCoreKeys[chatgptTenantId]) {
    universalCoreKeys[chatgptTenantId] = chatgptCoreKey;
  }
  const agentSignatureSecretReused = Boolean(
    agentSignatureSecret &&
    [
      universalCoreKey,
      chatgptCoreKey,
      ...Object.values(universalCoreKeys),
      tenantGatewayKey,
      ownerContextSigningSecret,
      tenantContextSigningSecret,
      dttAgentIdentitySigningSecret,
      nyraDeepV2McpRequestSigningSecret,
      ...codexKeys,
    ].some((secret) =>
      String(secret || "").trim() === agentSignatureSecret),
  );
  const defaultTenantId = String(env.MCP_DEFAULT_TENANT_ID || "owner-private").trim();
  const tenantClaim = String(env.MCP_TENANT_CLAIM || "https://skinharmony.it/tenant_id").trim();
  // Subject-to-tenant ownership is server-side only. Never accept this
  // binding from a token claim, URL, body or tool argument.
  const oauthOwnerTenantBindings = parseOauthOwnerTenantBindings(env.AUTH0_OWNER_TENANT_BINDINGS_JSON, "AUTH0_OWNER_TENANT_BINDINGS_JSON");
  // Ordinary tenant collaboration is configured independently from ownership.
  // These roles are intentionally bounded and can never grant owner elevation
  // or provider setup.
  const oauthTenantMemberships = parseOauthTenantMemberships(
    env.AUTH0_TENANT_MEMBERSHIPS_JSON,
    "AUTH0_TENANT_MEMBERSHIPS_JSON",
  );
  // Enabled by the production Blueprint. Keep the code default fail-closed so
  // an existing installation does not silently change tenant routing on update.
  const selfServiceTenantsEnabled = flag(env.MCP_SELF_SERVICE_TENANTS_ENABLED, false);
  const sharedMemoryRoot = String(env.SHARED_WORK_MEMORY_ROOT || new URL("../../../shared-work-memory", import.meta.url).pathname).trim();
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  // Collaboration state must never silently share the service's existing
  // DATABASE_URL. It is intentionally opt-in and has a distinct Render secret.
  const collaborationDatabaseUrl = String(env.MCP_COLLABORATION_DATABASE_URL || "").trim();
  const decisionLedgerRequired = flag(env.CORE_DECISION_LEDGER_REQUIRED, env.NODE_ENV === "production");
  const coreBlockRemediationMode = String(env.CORE_BLOCK_REMEDIATION_MODE || "shadow").trim().toLowerCase();
  const coreBlockRemediationMaxAttempts = integer(env.CORE_BLOCK_REMEDIATION_MAX_ATTEMPTS, 3, 1, 20);
  const coreBlockRemediationTtlSeconds = integer(env.CORE_BLOCK_REMEDIATION_TTL_SECONDS, 86_400, 1, 7 * 86_400);
  const coreBlockRemediationTransientRetryLimit = integer(env.CORE_BLOCK_REMEDIATION_TRANSIENT_RETRY_LIMIT, 2, 1, 20);
  // Automatic continuity capture is opt-in because it persists a redacted
  // derivative of the first host-supplied request as an immutable Intent
  // Anchor. Existing tenants retain the previous no-capture behaviour.
  const workContinuityAutoCaptureEnabled = flag(env.WORK_CONTINUITY_AUTO_CAPTURE_ENABLED, false);
  const hostNativeAgentProtocolEnabled = flag(env.HOST_NATIVE_AGENT_PROTOCOL_ENABLED, false);
  // When enabled, every functional Nyra/Core tool call must first refresh a
  // server-derived signed presence in the tenant registry. It is intentionally
  // opt-in so existing development installations are not silently tightened.
  const mandatoryAgentPresenceEnabled = flag(env.MANDATORY_AGENT_PRESENCE_ENABLED, false);
  const agentWorkspaceRoot = String(env.AGENT_WORKSPACE_ROOT || "").trim();
  const memoryFabricRoot = String(env.MEMORY_FABRIC_ROOT || agentWorkspaceRoot || "").trim();
  const researchCortexRoot = String(env.RESEARCH_CORTEX_ROOT || memoryFabricRoot || agentWorkspaceRoot || "").trim();
  const godModeEnabled = flag(env.NYRA_GOD_MODE_ENABLED, false);
  const godModeTenantIds = csv(env.NYRA_GOD_MODE_TENANT_IDS || env.NYRA_GOD_MODE_TENANT_ID || "owner-private");
  const godModeSubjects = csv(env.NYRA_GOD_MODE_SUBJECTS);
  const godModeClientIds = csv(env.NYRA_GOD_MODE_CLIENT_IDS);
  const godModeCodexEnabled = flag(env.NYRA_GOD_MODE_CODEX_ENABLED, false);
  const godModeEmergencyStop = flag(env.NYRA_GOD_MODE_EMERGENCY_STOP, false);
  // Owner elevation is only the short bootstrap for a bounded Core
  // delegation. Long-running work continues through signed, expiring action
  // tickets instead of treating an old browser login as fresh confirmation.
  const oauthOwnerConfirmationMaxAgeSeconds = strictInteger(
    env.AUTH0_OWNER_CONFIRMATION_MAX_AGE_SECONDS,
    300,
    60,
    300,
    "AUTH0_OWNER_CONFIRMATION_MAX_AGE_SECONDS",
  );
  // Missing production prerequisites are reported by the local readiness
  // endpoint. Authentication itself still fails closed, while keeping the
  // process alive lets Render observe an explicit 503 and coded blocker.
  if (auth0Issuer && !auth0Audience) throw new Error("AUTH0_AUDIENCE is required with AUTH0_ISSUER");
  return {
    environment,
    production: environment === "production",
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
    tenantGatewayKey,
    suiteControlPlaneUrl,
    suiteControlPlaneKeys: suiteControlPlaneBindings.keys,
    suiteControlPlaneTenantMap: suiteControlPlaneBindings.tenantMap,
    suiteControlPlaneTimeoutMs: integer(env.SUITE_CONTROL_PLANE_TIMEOUT_MS, 8_000, 100, 30_000),
    suiteControlPlaneCacheTtlMs: integer(env.SUITE_CONTROL_PLANE_CACHE_TTL_MS, 5_000, 0, 60_000),
    agentSignatureSecret,
    agentSignatureSecretReused,
    dttAgentIdentitySigningSecret,
    nyraDeepV2McpRequestSigningSecret,
    ownerContextSigningSecret,
    tenantContextSigningSecret,
    runtimeBuildCommit,
    defaultTenantId,
    tenantClaim,
    oauthOwnerTenantBindings,
    oauthTenantMemberships,
    oauthOwnerConfirmationMaxAgeSeconds,
    selfServiceTenantsEnabled,
    tenantOwnerRoleClaim: String(env.MCP_TENANT_OWNER_ROLE_CLAIM || "https://skinharmony.it/role").trim(),
    tenantOwnerRoles: csv(env.MCP_TENANT_OWNER_ROLES || "tenant_owner,tenant_admin,owner_root"),
    sharedMemoryRoot,
    databaseUrl,
    collaborationDatabaseUrl,
    decisionLedgerRequired,
    coreBlockRemediationMode,
    coreBlockRemediationMaxAttempts,
    coreBlockRemediationTtlSeconds,
    coreBlockRemediationTransientRetryLimit,
    workContinuityAutoCaptureEnabled,
    hostNativeAgentProtocolEnabled,
    mandatoryAgentPresenceEnabled,
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
  };
}

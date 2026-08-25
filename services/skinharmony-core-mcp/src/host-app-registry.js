import crypto from "node:crypto";

const APP_ID = /^[a-z][a-z0-9_-]{1,63}$/;
const HOST_KIND = /^[a-z][a-z0-9_]{1,62}_native$/;
const OAUTH_CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,239}$/;
const CREDENTIAL_ENV = /^MCP_HOST_APP_TOKEN_[A-Z0-9_]{3,120}$/;
const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const CAPABILITY = /^[a-z][a-z0-9_.:-]{1,79}$/;
const CLIENT_TYPES = new Set(["chatgpt", "codex", "api_agent", "other"]);
const INTERACTION_MODES = new Set(["nyra_conversational", "native_tooling"]);
const AUTH_KINDS = new Set(["oauth", "bearer"]);
const SERVICE_ROLES = new Set(["member", "reviewer", "operator"]);

export const HOST_APP_CAPABILITIES = Object.freeze({
  CORE_READ: "core.read",
  CORE_OPERATE: "core.operate",
  CORE_ADMIN: "core.admin",
  WORK_READ: "work.read",
  WORK_COORDINATE: "work.coordinate",
  WORK_REVIEW: "work.review",
  WORK_OPERATE: "work.operate",
  WORK_CREATE: "work.create",
  GOVERNED_CONTINUE: "governed_continue",
  HOST_NATIVE_DELEGATE: "host_native.delegate",
  HOST_NATIVE_AUTHORIZE: "host_native.authorize",
});

const KNOWN_CAPABILITIES = new Set(Object.values(HOST_APP_CAPABILITIES));

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, allowed, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${name} contains an unknown field ${key}`);
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function uniqueStrings(value, name, allowed = null) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    fail(`${name} must be a non-empty bounded array`);
  }
  const output = value.map((item) => String(item || "").trim());
  if (output.some((item) => !CAPABILITY.test(item) || (allowed && !allowed.has(item)))) {
    fail(`${name} contains an invalid value`);
  }
  if (new Set(output).size !== output.length) fail(`${name} contains a duplicate`);
  return output.sort();
}

function normalizeApp(input, environment) {
  exactKeys(input, new Set([
    "app_id", "auth_kind", "oauth_client_id", "credential_env", "tenant_id",
    "service_role", "host_kind", "client_type", "interaction_mode", "capabilities",
    "scopes", "enabled",
  ]), "MCP_HOST_APP_REGISTRY_JSON app");
  const app_id = String(input.app_id || "").trim().toLowerCase();
  const auth_kind = String(input.auth_kind || "").trim().toLowerCase();
  const host_kind = String(input.host_kind || "").trim().toLowerCase();
  const client_type = String(input.client_type || "").trim().toLowerCase();
  const interaction_mode = String(input.interaction_mode || "").trim().toLowerCase();
  if (!APP_ID.test(app_id)) fail("MCP_HOST_APP_REGISTRY_JSON contains an invalid app_id");
  if (!AUTH_KINDS.has(auth_kind)) fail("MCP_HOST_APP_REGISTRY_JSON contains an invalid auth_kind");
  if (!HOST_KIND.test(host_kind)) fail("MCP_HOST_APP_REGISTRY_JSON contains an invalid host_kind");
  if (!CLIENT_TYPES.has(client_type)) fail("MCP_HOST_APP_REGISTRY_JSON contains an invalid client_type");
  if (!INTERACTION_MODES.has(interaction_mode)) {
    fail("MCP_HOST_APP_REGISTRY_JSON contains an invalid interaction_mode");
  }
  if (input.enabled !== true && input.enabled !== false) {
    fail("MCP_HOST_APP_REGISTRY_JSON enabled must be boolean");
  }
  const capabilities = uniqueStrings(
    input.capabilities,
    "MCP_HOST_APP_REGISTRY_JSON capabilities",
    KNOWN_CAPABILITIES,
  );
  const normalized = {
    app_id,
    auth_kind,
    host_kind,
    client_type,
    interaction_mode,
    capabilities,
    enabled: input.enabled,
  };
  if (auth_kind === "oauth") {
    const oauth_client_id = String(input.oauth_client_id || "").trim();
    if (!OAUTH_CLIENT_ID.test(oauth_client_id)) {
      fail("MCP_HOST_APP_REGISTRY_JSON OAuth app requires a valid oauth_client_id");
    }
    if (input.credential_env !== undefined || input.tenant_id !== undefined ||
        input.service_role !== undefined || input.scopes !== undefined) {
      fail("MCP_HOST_APP_REGISTRY_JSON OAuth app contains bearer-only fields");
    }
    return { ...normalized, oauth_client_id };
  }
  const credential_env = String(input.credential_env || "").trim();
  const tenant_id = String(input.tenant_id || "").trim();
  const service_role = String(input.service_role || "member").trim().toLowerCase();
  if (!CREDENTIAL_ENV.test(credential_env)) {
    fail("MCP_HOST_APP_REGISTRY_JSON bearer app requires a valid credential_env");
  }
  if (!TENANT_ID.test(tenant_id)) {
    fail("MCP_HOST_APP_REGISTRY_JSON bearer app requires a valid tenant_id");
  }
  if (!SERVICE_ROLES.has(service_role)) {
    fail("MCP_HOST_APP_REGISTRY_JSON bearer app cannot receive an owner role");
  }
  const scopes = uniqueStrings(
    input.scopes || ["core:read"],
    "MCP_HOST_APP_REGISTRY_JSON scopes",
  );
  const credential = String(environment[credential_env] || "").trim();
  if (input.enabled === true && Buffer.byteLength(credential, "utf8") < 32) {
    fail(`MCP_HOST_APP_REGISTRY_JSON enabled bearer credential ${credential_env} is unavailable`);
  }
  if (input.oauth_client_id !== undefined) {
    fail("MCP_HOST_APP_REGISTRY_JSON bearer app contains OAuth-only fields");
  }
  return {
    ...normalized,
    credential_env,
    tenant_id,
    service_role,
    scopes,
    // Kept only in the private runtime registry. Public registry views below
    // deliberately omit this value and its environment-variable name.
    credential,
  };
}

export function parseHostAppRegistry(raw, environment = {}) {
  if (!String(raw || "").trim()) {
    return Object.freeze({
      schema_version: "mcp_host_app_registry_v1",
      configured: false,
      revision: null,
      apps: Object.freeze([]),
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("MCP_HOST_APP_REGISTRY_JSON must be valid JSON");
  }
  exactKeys(parsed, new Set(["schema_version", "apps"]), "MCP_HOST_APP_REGISTRY_JSON");
  if (parsed.schema_version !== "mcp_host_app_registry_v1") {
    fail("MCP_HOST_APP_REGISTRY_JSON has an unsupported schema_version");
  }
  if (!Array.isArray(parsed.apps) || parsed.apps.length < 1 || parsed.apps.length > 128) {
    fail("MCP_HOST_APP_REGISTRY_JSON apps must be a non-empty bounded array");
  }
  const apps = parsed.apps.map((item) => normalizeApp(item, environment));
  const appIds = new Set();
  const oauthClients = new Set();
  const credentialEnvs = new Set();
  const enabledBearerCredentials = [];
  for (const app of apps) {
    if (appIds.has(app.app_id)) fail("MCP_HOST_APP_REGISTRY_JSON contains a duplicate app_id");
    appIds.add(app.app_id);
    if (app.auth_kind === "oauth") {
      if (oauthClients.has(app.oauth_client_id)) {
        fail("MCP_HOST_APP_REGISTRY_JSON contains a duplicate oauth_client_id");
      }
      oauthClients.add(app.oauth_client_id);
    } else {
      if (credentialEnvs.has(app.credential_env)) {
        fail("MCP_HOST_APP_REGISTRY_JSON contains a duplicate credential_env");
      }
      credentialEnvs.add(app.credential_env);
      if (app.enabled === true) {
        if (enabledBearerCredentials.some((credential) => safeEqual(credential, app.credential))) {
          fail("MCP_HOST_APP_REGISTRY_JSON contains a duplicate enabled bearer credential");
        }
        enabledBearerCredentials.push(app.credential);
      }
    }
  }
  const publicApps = apps.map(({ credential: _credential, credential_env: _credentialEnv, ...app }) => app);
  return Object.freeze({
    schema_version: "mcp_host_app_registry_v1",
    configured: true,
    revision: digest({ schema_version: "mcp_host_app_registry_v1", apps: publicApps }),
    apps: Object.freeze(apps.map((app) => Object.freeze({ ...app }))),
  });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function principal(app, registryRevision) {
  return Object.freeze({
    schema_version: "authenticated_host_principal_v1",
    registered: true,
    registry_revision: registryRevision,
    app_id: app.app_id,
    auth_kind: app.auth_kind,
    host_kind: app.host_kind,
    client_type: app.client_type,
    interaction_mode: app.interaction_mode,
    capabilities: Object.freeze([...app.capabilities]),
  });
}

export function registeredBearerApp(token, registry) {
  for (const app of registry?.apps || []) {
    if (app.auth_kind === "bearer" && app.enabled === true && safeEqual(app.credential, token)) {
      return Object.freeze({ app, principal: principal(app, registry.revision) });
    }
  }
  return null;
}

export function attachAuthenticatedHostPrincipal(identity, registry, {
  allowLegacyCodex = false,
} = {}) {
  if (!identity || typeof identity !== "object") return identity;
  if (identity.authenticatedHostPrincipal?.schema_version === "authenticated_host_principal_v1") {
    return identity;
  }
  if (identity.kind === "codex") {
    if (allowLegacyCodex !== true) {
      return {
        ...identity,
        authenticatedHostPrincipal: Object.freeze({
          schema_version: "authenticated_host_principal_v1",
          registered: false,
          registry_revision: registry?.revision || null,
          app_id: null,
          auth_kind: "bearer",
          host_kind: null,
          client_type: "codex",
          interaction_mode: "native_tooling",
          capabilities: Object.freeze([HOST_APP_CAPABILITIES.WORK_READ]),
        }),
      };
    }
    return {
      ...identity,
      authenticatedHostPrincipal: Object.freeze({
        schema_version: "authenticated_host_principal_v1",
        registered: true,
        registry_revision: "legacy_codex_bearer_v1",
        app_id: "codex",
        auth_kind: "bearer",
        host_kind: "codex_native",
        client_type: "codex",
        interaction_mode: "native_tooling",
        capabilities: Object.freeze(Object.values(HOST_APP_CAPABILITIES)),
      }),
    };
  }
  if (identity.kind === "oauth") {
    const app = (registry?.apps || []).find((candidate) => (
      candidate.auth_kind === "oauth" &&
      candidate.enabled === true &&
      candidate.oauth_client_id === identity.clientId
    ));
    if (app) return { ...identity, authenticatedHostPrincipal: principal(app, registry.revision) };
    // Compatibility is deliberately read-only. A verified OAuth subject may
    // still ask Nyra to diagnose/resume, but cannot create Work, mint a host
    // delegation or request an action ticket until its OAuth client is in the
    // server-side registry.
    return {
      ...identity,
      authenticatedHostPrincipal: Object.freeze({
        schema_version: "authenticated_host_principal_v1",
        registered: false,
        registry_revision: registry?.revision || null,
        app_id: null,
        auth_kind: "oauth",
        host_kind: null,
        client_type: "chatgpt",
        interaction_mode: "nyra_conversational",
        capabilities: Object.freeze([HOST_APP_CAPABILITIES.WORK_READ]),
      }),
    };
  }
  return {
    ...identity,
    authenticatedHostPrincipal: Object.freeze({
      schema_version: "authenticated_host_principal_v1",
      registered: false,
      registry_revision: registry?.revision || null,
      app_id: null,
      auth_kind: String(identity.kind || "unknown").slice(0, 40),
      host_kind: null,
      client_type: "api_agent",
      interaction_mode: "nyra_conversational",
      capabilities: Object.freeze([]),
    }),
  };
}

export function hostPrincipalAllows(identity, capability) {
  const principalValue = identity?.authenticatedHostPrincipal;
  return principalValue?.registered === true &&
    Array.isArray(principalValue.capabilities) &&
    principalValue.capabilities.includes(capability);
}

export function authenticatedHostKind(identity) {
  const principalValue = identity?.authenticatedHostPrincipal;
  const hostKind = String(principalValue?.host_kind || "").trim().toLowerCase();
  if (principalValue?.registered !== true || !HOST_KIND.test(hostKind)) {
    throw new Error("registered_host_principal_required");
  }
  return hostKind;
}

export function authenticatedClientType(identity) {
  const value = String(identity?.authenticatedHostPrincipal?.client_type || "").trim().toLowerCase();
  return CLIENT_TYPES.has(value) ? value : null;
}

export function publicHostPrincipal(identity) {
  const value = identity?.authenticatedHostPrincipal;
  if (!value || typeof value !== "object") return null;
  return Object.freeze({
    schema_version: value.schema_version,
    registered: value.registered === true,
    registry_revision: value.registry_revision || null,
    app_id: value.app_id || null,
    host_kind: value.host_kind || null,
    client_type: value.client_type || "other",
    interaction_mode: value.interaction_mode || "nyra_conversational",
    capabilities: Object.freeze(Array.isArray(value.capabilities) ? [...value.capabilities] : []),
  });
}

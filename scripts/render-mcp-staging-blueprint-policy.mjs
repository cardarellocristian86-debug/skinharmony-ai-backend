import fs from "node:fs";

export const MCP_STAGING_BLUEPRINT_FILES = Object.freeze({
  bootstrap: "render-mcp-staging-bootstrap.yaml",
  control: "render-mcp-staging-control-plane.yaml",
  final: "render-mcp-staging.yaml",
});

const BRANCH = "agent/mcp-staging-shared-memory-release";
const REPOSITORY = "https://github.com/cardarellocristian86-debug/skinharmony-ai-backend";
const PROJECT = "My project";
const ENVIRONMENT = "staging";
const DATABASE = "skinharmony-mcp-staging-db";
const BOOTSTRAP_SERVICE = "skinharmony-mcp-staging-db-bootstrap";
const CORE_ISSUER = "skinharmony-core-staging-issuer";
const NYRA_ISSUER = "skinharmony-nyra-staging-issuer";
const UNIVERSAL_CORE = "skinharmony-universal-core-staging";
const MCP = "skinharmony-core-mcp-staging";

const EXPECTED_SERVICES = Object.freeze({
  bootstrap: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze({
      type: "pserv",
      plan: "starter",
      buildCommand:
        "npm ci --prefix services/mcp-staging-db-bootstrap && npm ci --prefix services/skinharmony-core-mcp",
      startCommand: "npm --prefix services/mcp-staging-db-bootstrap start",
      port: "10001",
    }),
    [CORE_ISSUER]: Object.freeze({
      type: "pserv",
      plan: "starter",
      buildCommand: "npm ci --prefix services/mcp-staging-issuer",
      startCommand: "npm --prefix services/mcp-staging-issuer start",
      port: "8789",
    }),
    [NYRA_ISSUER]: Object.freeze({
      type: "pserv",
      plan: "starter",
      buildCommand: "npm ci --prefix services/mcp-staging-issuer",
      startCommand: "npm --prefix services/mcp-staging-issuer start",
      port: "8789",
    }),
  }),
  control: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze({
      type: "pserv",
      plan: "starter",
      buildCommand:
        "npm ci --prefix services/mcp-staging-db-bootstrap && npm ci --prefix services/skinharmony-core-mcp",
      startCommand: "npm --prefix services/mcp-staging-db-bootstrap start",
      port: "10001",
    }),
    [CORE_ISSUER]: Object.freeze({
      type: "pserv",
      plan: "starter",
      buildCommand: "npm ci --prefix services/mcp-staging-issuer",
      startCommand: "npm --prefix services/mcp-staging-issuer start",
      port: "8789",
    }),
    [NYRA_ISSUER]: Object.freeze({
      type: "pserv",
      plan: "starter",
      buildCommand: "npm ci --prefix services/mcp-staging-issuer",
      startCommand: "npm --prefix services/mcp-staging-issuer start",
      port: "8789",
    }),
  }),
  final: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze({
      type: "pserv",
      plan: "starter",
      buildCommand:
        "npm ci --prefix services/mcp-staging-db-bootstrap && npm ci --prefix services/skinharmony-core-mcp",
      startCommand: "npm --prefix services/mcp-staging-db-bootstrap start",
      port: "10001",
    }),
    [CORE_ISSUER]: Object.freeze({
      type: "pserv",
      plan: "starter",
      buildCommand: "npm ci --prefix services/mcp-staging-issuer",
      startCommand: "npm --prefix services/mcp-staging-issuer start",
      port: "8789",
    }),
    [NYRA_ISSUER]: Object.freeze({
      type: "pserv",
      plan: "starter",
      buildCommand: "npm ci --prefix services/mcp-staging-issuer",
      startCommand: "npm --prefix services/mcp-staging-issuer start",
      port: "8789",
    }),
    [UNIVERSAL_CORE]: Object.freeze({
      type: "pserv",
      plan: "starter",
      buildCommand:
        "npm ci --prefix services/universal-core-service && bash scripts/build-rust-extractor-render.sh",
      startCommand: "npm --prefix services/universal-core-service start",
      port: "8787",
    }),
    [MCP]: Object.freeze({
      type: "web",
      plan: "free",
      buildCommand: "npm ci --prefix services/skinharmony-core-mcp",
      startCommand: "npm --prefix services/skinharmony-core-mcp start",
      port: "8790",
      healthCheckPath: "/healthz",
    }),
  }),
});

const EXPECTED_ENV_KEYS = Object.freeze({
  bootstrap: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze([
      "NODE_ENV", "PORT", "MCP_STAGING_BOOTSTRAP_ENVIRONMENT",
      "MCP_STAGING_CONTROL_PLANE_PROFILE", "MCP_STAGING_DB_BOOTSTRAP_MODE",
    ]),
    [CORE_ISSUER]: Object.freeze([
      "NODE_ENV", "PORT", "MCP_STAGING_ENVIRONMENT", "MCP_STAGING_ISSUER_MODE",
      "MCP_STAGING_ISSUER_PROTOCOL", "MCP_STAGING_ISSUER_STARTUP_MODE",
      "MCP_STAGING_COLLABORATION_AUDIENCE", "MCP_STAGING_ISSUER_SIGNING_SECRET",
      "MCP_STAGING_ISSUER_AUTH_TOKEN",
    ]),
    [NYRA_ISSUER]: Object.freeze([
      "NODE_ENV", "PORT", "MCP_STAGING_ENVIRONMENT", "MCP_STAGING_ISSUER_MODE",
      "MCP_STAGING_ISSUER_PROTOCOL", "MCP_STAGING_ISSUER_STARTUP_MODE",
      "MCP_STAGING_COLLABORATION_AUDIENCE", "MCP_STAGING_ISSUER_SIGNING_SECRET",
      "MCP_STAGING_ISSUER_AUTH_TOKEN",
    ]),
  }),
  control: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze([
      "NODE_ENV", "PORT", "MCP_STAGING_BOOTSTRAP_ENVIRONMENT",
      "MCP_STAGING_CONTROL_PLANE_PROFILE", "MCP_STAGING_DB_BOOTSTRAP_MODE",
      "PG_ADMIN_DATABASE_URL", "PG_EXPECTED_DATABASE_NAME",
      "MCP_STAGING_GATE_CONTROL_PASSWORD", "MCP_STAGING_CORE_NONCE_API_TOKEN",
      "MCP_STAGING_NYRA_NONCE_API_TOKEN", "MCP_STAGING_RECEIPT_CONSUMER_API_TOKEN",
      "MCP_STAGING_DEPENDENCY_BUILD_COMMIT",
    ]),
    [CORE_ISSUER]: Object.freeze([
      "NODE_ENV", "PORT", "MCP_STAGING_ENVIRONMENT", "MCP_STAGING_ISSUER_MODE",
      "MCP_STAGING_ISSUER_PROTOCOL", "MCP_STAGING_ISSUER_STARTUP_MODE",
      "MCP_STAGING_COLLABORATION_AUDIENCE", "MCP_STAGING_ISSUER_SIGNING_SECRET",
      "MCP_STAGING_ISSUER_AUTH_TOKEN", "MCP_STAGING_DEPENDENCY_BUILD_COMMIT",
    ]),
    [NYRA_ISSUER]: Object.freeze([
      "NODE_ENV", "PORT", "MCP_STAGING_ENVIRONMENT", "MCP_STAGING_ISSUER_MODE",
      "MCP_STAGING_ISSUER_PROTOCOL", "MCP_STAGING_ISSUER_STARTUP_MODE",
      "MCP_STAGING_COLLABORATION_AUDIENCE", "MCP_STAGING_ISSUER_SIGNING_SECRET",
      "MCP_STAGING_ISSUER_AUTH_TOKEN", "MCP_STAGING_DEPENDENCY_BUILD_COMMIT",
    ]),
  }),
  final: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze([
      "NODE_ENV", "PORT", "MCP_STAGING_BOOTSTRAP_ENVIRONMENT",
      "MCP_STAGING_CONTROL_PLANE_PROFILE", "MCP_STAGING_DB_BOOTSTRAP_MODE",
      "PG_ADMIN_DATABASE_URL", "PG_EXPECTED_DATABASE_NAME",
      "MCP_STAGING_GATE_CONTROL_PASSWORD", "MCP_STAGING_CORE_NONCE_API_TOKEN",
      "MCP_STAGING_NYRA_NONCE_API_TOKEN", "MCP_STAGING_RECEIPT_CONSUMER_API_TOKEN",
      "MCP_STAGING_DEPENDENCY_BUILD_COMMIT",
      "MCP_STAGING_UNIVERSAL_CORE_HOSTPORT", "MCP_STAGING_UNIVERSAL_CORE_KEY",
      "MCP_STAGING_CORE_ISSUER_HOSTPORT", "MCP_STAGING_NYRA_ISSUER_HOSTPORT",
      "MCP_STAGING_CORE_ISSUER_TOKEN", "MCP_STAGING_NYRA_ISSUER_TOKEN",
    ]),
    [CORE_ISSUER]: Object.freeze([
      "NODE_ENV", "PORT", "MCP_STAGING_ENVIRONMENT", "MCP_STAGING_ISSUER_MODE",
      "MCP_STAGING_ISSUER_PROTOCOL", "MCP_STAGING_ISSUER_STARTUP_MODE",
      "MCP_STAGING_COLLABORATION_AUDIENCE", "MCP_STAGING_ISSUER_SIGNING_SECRET",
      "MCP_STAGING_ISSUER_AUTH_TOKEN", "MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT",
      "MCP_STAGING_ISSUER_NONCE_API_TOKEN", "MCP_STAGING_NYRA_JWKS_HOSTPORT",
      "MCP_STAGING_NYRA_JWKS_TOKEN", "MCP_STAGING_CORE_GATE_VERIFY_SECRET",
      "MCP_STAGING_DEPENDENCY_BUILD_COMMIT",
    ]),
    [NYRA_ISSUER]: Object.freeze([
      "NODE_ENV", "PORT", "MCP_STAGING_ENVIRONMENT", "MCP_STAGING_ISSUER_MODE",
      "MCP_STAGING_ISSUER_PROTOCOL", "MCP_STAGING_ISSUER_STARTUP_MODE",
      "MCP_STAGING_COLLABORATION_AUDIENCE", "MCP_STAGING_ISSUER_SIGNING_SECRET",
      "MCP_STAGING_ISSUER_AUTH_TOKEN", "MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT",
      "MCP_STAGING_ISSUER_NONCE_API_TOKEN", "MCP_STAGING_DEPENDENCY_BUILD_COMMIT",
    ]),
    [UNIVERSAL_CORE]: Object.freeze([
      "NODE_ENV", "PORT", "CORE_SERVICE_NAME", "CORE_SERVICE_STORAGE_ROOT",
      "CORE_MCP_STAGING_SERVICE_KEY", "CORE_EVIDENCE_SIGNING_SECRET",
      "CORE_OWNER_CONTEXT_SIGNING_SECRET", "CORE_MCP_TENANT_GATEWAY_KEY",
    ]),
    [MCP]: Object.freeze([
      "NODE_ENV", "PORT", "MCP_PUBLIC_URL", "CODEX_BEARER_KEYS",
      "CODEX_BEARER_SCOPES", "MCP_SUPPORTED_SCOPES", "MCP_DEFAULT_TENANT_ID",
      "MCP_CHATGPT_TENANT_ID", "UNIVERSAL_CORE_URL", "UNIVERSAL_CORE_KEY",
      "CORE_OWNER_CONTEXT_SIGNING_SECRET", "CORE_MCP_TENANT_GATEWAY_KEY",
      "AGENT_SIGNATURE_SECRET", "MCP_COLLABORATION_DATABASE_URL",
      "MCP_COLLABORATION_DATABASE_SSL", "MCP_COLLABORATION_CORE_ISSUER_HOSTPORT",
      "MCP_COLLABORATION_NYRA_ISSUER_HOSTPORT",
      "MCP_COLLABORATION_CORE_ISSUER_TOKEN",
      "MCP_COLLABORATION_NYRA_ISSUER_TOKEN",
      "MCP_COLLABORATION_RECEIPT_AUDIENCE", "MCP_COLLABORATION_CORE_ISSUER",
      "MCP_COLLABORATION_NYRA_ISSUER", "MCP_COLLABORATION_ALLOWED_TENANT_ID",
      "MCP_COLLABORATION_TARGET_SERVICE", "MCP_COLLABORATION_TARGET_ENVIRONMENT",
      "MCP_COLLABORATION_BUILD_COMMIT",
      "MCP_COLLABORATION_RUNTIME_DATABASE_ROLE", "MCP_COLLABORATION_RECEIPT_TTL_MS",
      "CORE_DECISION_LEDGER_REQUIRED",
    ]),
  }),
});

const EXPECTED_LITERAL_VALUES = Object.freeze({
  bootstrap: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze({
      NODE_ENV: "production",
      PORT: "10001",
      MCP_STAGING_BOOTSTRAP_ENVIRONMENT: "staging",
      MCP_STAGING_CONTROL_PLANE_PROFILE: "collaboration",
      MCP_STAGING_DB_BOOTSTRAP_MODE: "hold",
    }),
    [CORE_ISSUER]: Object.freeze({
      NODE_ENV: "production",
      PORT: "8789",
      MCP_STAGING_ENVIRONMENT: "staging",
      MCP_STAGING_ISSUER_MODE: "core",
      MCP_STAGING_ISSUER_PROTOCOL: "collaboration",
      MCP_STAGING_ISSUER_STARTUP_MODE: "jwks_only",
      MCP_STAGING_COLLABORATION_AUDIENCE:
        "https://skinharmony-core-mcp-staging.onrender.com/mcp",
    }),
    [NYRA_ISSUER]: Object.freeze({
      NODE_ENV: "production",
      PORT: "8789",
      MCP_STAGING_ENVIRONMENT: "staging",
      MCP_STAGING_ISSUER_MODE: "nyra",
      MCP_STAGING_ISSUER_PROTOCOL: "collaboration",
      MCP_STAGING_ISSUER_STARTUP_MODE: "jwks_only",
      MCP_STAGING_COLLABORATION_AUDIENCE:
        "https://skinharmony-core-mcp-staging.onrender.com/mcp",
    }),
  }),
  control: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze({
      NODE_ENV: "production",
      PORT: "10001",
      MCP_STAGING_BOOTSTRAP_ENVIRONMENT: "staging",
      MCP_STAGING_CONTROL_PLANE_PROFILE: "collaboration",
      MCP_STAGING_DB_BOOTSTRAP_MODE: "initialize",
    }),
    [CORE_ISSUER]: Object.freeze({
      NODE_ENV: "production",
      PORT: "8789",
      MCP_STAGING_ENVIRONMENT: "staging",
      MCP_STAGING_ISSUER_MODE: "core",
      MCP_STAGING_ISSUER_PROTOCOL: "collaboration",
      MCP_STAGING_ISSUER_STARTUP_MODE: "jwks_only",
      MCP_STAGING_COLLABORATION_AUDIENCE:
        "https://skinharmony-core-mcp-staging.onrender.com/mcp",
    }),
    [NYRA_ISSUER]: Object.freeze({
      NODE_ENV: "production",
      PORT: "8789",
      MCP_STAGING_ENVIRONMENT: "staging",
      MCP_STAGING_ISSUER_MODE: "nyra",
      MCP_STAGING_ISSUER_PROTOCOL: "collaboration",
      MCP_STAGING_ISSUER_STARTUP_MODE: "jwks_only",
      MCP_STAGING_COLLABORATION_AUDIENCE:
        "https://skinharmony-core-mcp-staging.onrender.com/mcp",
    }),
  }),
  final: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze({
      NODE_ENV: "production",
      PORT: "10001",
      MCP_STAGING_BOOTSTRAP_ENVIRONMENT: "staging",
      MCP_STAGING_CONTROL_PLANE_PROFILE: "collaboration",
      MCP_STAGING_DB_BOOTSTRAP_MODE: "steady",
    }),
    [CORE_ISSUER]: Object.freeze({
      NODE_ENV: "production",
      PORT: "8789",
      MCP_STAGING_ENVIRONMENT: "staging",
      MCP_STAGING_ISSUER_MODE: "core",
      MCP_STAGING_ISSUER_PROTOCOL: "collaboration",
      MCP_STAGING_ISSUER_STARTUP_MODE: "full",
      MCP_STAGING_COLLABORATION_AUDIENCE:
        "https://skinharmony-core-mcp-staging.onrender.com/mcp",
    }),
    [NYRA_ISSUER]: Object.freeze({
      NODE_ENV: "production",
      PORT: "8789",
      MCP_STAGING_ENVIRONMENT: "staging",
      MCP_STAGING_ISSUER_MODE: "nyra",
      MCP_STAGING_ISSUER_PROTOCOL: "collaboration",
      MCP_STAGING_ISSUER_STARTUP_MODE: "full",
      MCP_STAGING_COLLABORATION_AUDIENCE:
        "https://skinharmony-core-mcp-staging.onrender.com/mcp",
    }),
    [UNIVERSAL_CORE]: Object.freeze({
      NODE_ENV: "production",
      PORT: "8787",
      CORE_SERVICE_NAME: "universal-core-staging",
      CORE_SERVICE_STORAGE_ROOT: "/tmp/universal-core-staging",
    }),
    [MCP]: Object.freeze({
      NODE_ENV: "production",
      PORT: "8790",
      MCP_PUBLIC_URL: "https://skinharmony-core-mcp-staging.onrender.com",
      CODEX_BEARER_SCOPES:
        "core:read,core:govern,workspace:read,workspace:write,task:read,task:write,agent:coordinate",
      MCP_SUPPORTED_SCOPES:
        "core:read,core:govern,workspace:read,workspace:write,task:read,task:write,agent:coordinate",
      MCP_DEFAULT_TENANT_ID: "codexai",
      MCP_CHATGPT_TENANT_ID: "codexai",
      UNIVERSAL_CORE_URL: "http://skinharmony-universal-core-staging:8787",
      MCP_COLLABORATION_DATABASE_SSL: "true",
      MCP_COLLABORATION_RECEIPT_AUDIENCE:
        "https://skinharmony-core-mcp-staging.onrender.com/mcp",
      MCP_COLLABORATION_CORE_ISSUER: "universal-core-staging",
      MCP_COLLABORATION_NYRA_ISSUER: "nyra-staging",
      MCP_COLLABORATION_ALLOWED_TENANT_ID: "codexai",
      MCP_COLLABORATION_TARGET_SERVICE: "skinharmony-core-mcp-staging",
      MCP_COLLABORATION_TARGET_ENVIRONMENT: "staging",
      MCP_COLLABORATION_RUNTIME_DATABASE_ROLE: "mcp_collaboration_runtime",
      MCP_COLLABORATION_RECEIPT_TTL_MS: "20000",
      CORE_DECISION_LEDGER_REQUIRED: "true",
    }),
  }),
});

const EXPECTED_GENERATED_KEYS = Object.freeze({
  bootstrap: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze([]),
    [CORE_ISSUER]: Object.freeze([
      "MCP_STAGING_ISSUER_SIGNING_SECRET",
      "MCP_STAGING_ISSUER_AUTH_TOKEN",
    ]),
    [NYRA_ISSUER]: Object.freeze([
      "MCP_STAGING_ISSUER_SIGNING_SECRET",
      "MCP_STAGING_ISSUER_AUTH_TOKEN",
    ]),
  }),
  control: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze([
      "MCP_STAGING_GATE_CONTROL_PASSWORD",
      "MCP_STAGING_CORE_NONCE_API_TOKEN",
      "MCP_STAGING_NYRA_NONCE_API_TOKEN",
      "MCP_STAGING_RECEIPT_CONSUMER_API_TOKEN",
    ]),
    [CORE_ISSUER]: Object.freeze([
      "MCP_STAGING_ISSUER_SIGNING_SECRET",
      "MCP_STAGING_ISSUER_AUTH_TOKEN",
    ]),
    [NYRA_ISSUER]: Object.freeze([
      "MCP_STAGING_ISSUER_SIGNING_SECRET",
      "MCP_STAGING_ISSUER_AUTH_TOKEN",
    ]),
  }),
  final: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze([
      "MCP_STAGING_GATE_CONTROL_PASSWORD",
      "MCP_STAGING_CORE_NONCE_API_TOKEN",
      "MCP_STAGING_NYRA_NONCE_API_TOKEN",
      "MCP_STAGING_RECEIPT_CONSUMER_API_TOKEN",
    ]),
    [CORE_ISSUER]: Object.freeze([
      "MCP_STAGING_ISSUER_SIGNING_SECRET",
      "MCP_STAGING_ISSUER_AUTH_TOKEN",
    ]),
    [NYRA_ISSUER]: Object.freeze([
      "MCP_STAGING_ISSUER_SIGNING_SECRET",
      "MCP_STAGING_ISSUER_AUTH_TOKEN",
    ]),
    [UNIVERSAL_CORE]: Object.freeze([
      "CORE_EVIDENCE_SIGNING_SECRET",
    ]),
    [MCP]: Object.freeze([
      "CODEX_BEARER_KEYS",
      "UNIVERSAL_CORE_KEY",
      "CORE_OWNER_CONTEXT_SIGNING_SECRET",
      "CORE_MCP_TENANT_GATEWAY_KEY",
      "AGENT_SIGNATURE_SECRET",
    ]),
  }),
});

const EXPECTED_SYNC_KEYS = Object.freeze({});

const EXPECTED_DATABASE_REFERENCES = Object.freeze({
  bootstrap: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze({}),
    [CORE_ISSUER]: Object.freeze({}),
    [NYRA_ISSUER]: Object.freeze({}),
  }),
  control: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze({
      PG_ADMIN_DATABASE_URL: Object.freeze({
        name: DATABASE,
        property: "connectionString",
      }),
      PG_EXPECTED_DATABASE_NAME: Object.freeze({
        name: DATABASE,
        property: "database",
      }),
    }),
    [CORE_ISSUER]: Object.freeze({}),
    [NYRA_ISSUER]: Object.freeze({}),
  }),
  final: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze({
      PG_ADMIN_DATABASE_URL: Object.freeze({
        name: DATABASE,
        property: "connectionString",
      }),
      PG_EXPECTED_DATABASE_NAME: Object.freeze({
        name: DATABASE,
        property: "database",
      }),
    }),
    [CORE_ISSUER]: Object.freeze({}),
    [NYRA_ISSUER]: Object.freeze({}),
    [UNIVERSAL_CORE]: Object.freeze({}),
    [MCP]: Object.freeze({
      MCP_COLLABORATION_DATABASE_URL: Object.freeze({
        name: DATABASE,
        property: "connectionString",
      }),
    }),
  }),
});

const EXPECTED_SERVICE_REFERENCES = Object.freeze({
  bootstrap: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze({}),
    [CORE_ISSUER]: Object.freeze({}),
    [NYRA_ISSUER]: Object.freeze({}),
  }),
  control: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze({
      MCP_STAGING_DEPENDENCY_BUILD_COMMIT: Object.freeze({
        type: "pserv", name: BOOTSTRAP_SERVICE, envVarKey: "RENDER_GIT_COMMIT",
      }),
    }),
    [CORE_ISSUER]: Object.freeze({
      MCP_STAGING_DEPENDENCY_BUILD_COMMIT: Object.freeze({
        type: "pserv", name: CORE_ISSUER, envVarKey: "RENDER_GIT_COMMIT",
      }),
    }),
    [NYRA_ISSUER]: Object.freeze({
      MCP_STAGING_DEPENDENCY_BUILD_COMMIT: Object.freeze({
        type: "pserv", name: NYRA_ISSUER, envVarKey: "RENDER_GIT_COMMIT",
      }),
    }),
  }),
  final: Object.freeze({
    [BOOTSTRAP_SERVICE]: Object.freeze({
      MCP_STAGING_DEPENDENCY_BUILD_COMMIT: Object.freeze({
        type: "pserv", name: BOOTSTRAP_SERVICE, envVarKey: "RENDER_GIT_COMMIT",
      }),
      MCP_STAGING_UNIVERSAL_CORE_HOSTPORT: Object.freeze({
        type: "pserv", name: UNIVERSAL_CORE, property: "hostport",
      }),
      MCP_STAGING_UNIVERSAL_CORE_KEY: Object.freeze({
        type: "web", name: MCP, envVarKey: "UNIVERSAL_CORE_KEY",
      }),
      MCP_STAGING_CORE_ISSUER_HOSTPORT: Object.freeze({
        type: "pserv", name: CORE_ISSUER, property: "hostport",
      }),
      MCP_STAGING_NYRA_ISSUER_HOSTPORT: Object.freeze({
        type: "pserv", name: NYRA_ISSUER, property: "hostport",
      }),
      MCP_STAGING_CORE_ISSUER_TOKEN: Object.freeze({
        type: "pserv", name: CORE_ISSUER, envVarKey: "MCP_STAGING_ISSUER_AUTH_TOKEN",
      }),
      MCP_STAGING_NYRA_ISSUER_TOKEN: Object.freeze({
        type: "pserv", name: NYRA_ISSUER, envVarKey: "MCP_STAGING_ISSUER_AUTH_TOKEN",
      }),
    }),
    [CORE_ISSUER]: Object.freeze({
      MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT: Object.freeze({
        type: "pserv", name: BOOTSTRAP_SERVICE, property: "hostport",
      }),
      MCP_STAGING_ISSUER_NONCE_API_TOKEN: Object.freeze({
        type: "pserv", name: BOOTSTRAP_SERVICE,
        envVarKey: "MCP_STAGING_CORE_NONCE_API_TOKEN",
      }),
      MCP_STAGING_NYRA_JWKS_HOSTPORT: Object.freeze({
        type: "pserv", name: NYRA_ISSUER, property: "hostport",
      }),
      MCP_STAGING_NYRA_JWKS_TOKEN: Object.freeze({
        type: "pserv", name: NYRA_ISSUER,
        envVarKey: "MCP_STAGING_ISSUER_AUTH_TOKEN",
      }),
      MCP_STAGING_CORE_GATE_VERIFY_SECRET: Object.freeze({
        type: "pserv", name: UNIVERSAL_CORE,
        envVarKey: "CORE_EVIDENCE_SIGNING_SECRET",
      }),
      MCP_STAGING_DEPENDENCY_BUILD_COMMIT: Object.freeze({
        type: "pserv", name: CORE_ISSUER, envVarKey: "RENDER_GIT_COMMIT",
      }),
    }),
    [NYRA_ISSUER]: Object.freeze({
      MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT: Object.freeze({
        type: "pserv", name: BOOTSTRAP_SERVICE, property: "hostport",
      }),
      MCP_STAGING_ISSUER_NONCE_API_TOKEN: Object.freeze({
        type: "pserv", name: BOOTSTRAP_SERVICE,
        envVarKey: "MCP_STAGING_NYRA_NONCE_API_TOKEN",
      }),
      MCP_STAGING_DEPENDENCY_BUILD_COMMIT: Object.freeze({
        type: "pserv", name: NYRA_ISSUER, envVarKey: "RENDER_GIT_COMMIT",
      }),
    }),
    [UNIVERSAL_CORE]: Object.freeze({
      CORE_MCP_STAGING_SERVICE_KEY: Object.freeze({
        type: "web", name: MCP, envVarKey: "UNIVERSAL_CORE_KEY",
      }),
      CORE_OWNER_CONTEXT_SIGNING_SECRET: Object.freeze({
        type: "web", name: MCP, envVarKey: "CORE_OWNER_CONTEXT_SIGNING_SECRET",
      }),
      CORE_MCP_TENANT_GATEWAY_KEY: Object.freeze({
        type: "web", name: MCP, envVarKey: "CORE_MCP_TENANT_GATEWAY_KEY",
      }),
    }),
    [MCP]: Object.freeze({
      MCP_COLLABORATION_CORE_ISSUER_HOSTPORT: Object.freeze({
        type: "pserv", name: CORE_ISSUER, property: "hostport",
      }),
      MCP_COLLABORATION_NYRA_ISSUER_HOSTPORT: Object.freeze({
        type: "pserv", name: NYRA_ISSUER, property: "hostport",
      }),
      MCP_COLLABORATION_CORE_ISSUER_TOKEN: Object.freeze({
        type: "pserv", name: CORE_ISSUER, envVarKey: "MCP_STAGING_ISSUER_AUTH_TOKEN",
      }),
      MCP_COLLABORATION_NYRA_ISSUER_TOKEN: Object.freeze({
        type: "pserv", name: NYRA_ISSUER, envVarKey: "MCP_STAGING_ISSUER_AUTH_TOKEN",
      }),
      MCP_COLLABORATION_BUILD_COMMIT: Object.freeze({
        type: "web", name: MCP, envVarKey: "RENDER_GIT_COMMIT",
      }),
    }),
  }),
});

const SERVICE_FIELDS = new Set([
  "type", "name", "runtime", "plan", "region", "branch", "autoDeployTrigger",
  "repo", "buildCommand", "startCommand", "healthCheckPath", "envVars",
]);
const PUBLIC_SYNC_FIELDS = new Set();
const BLOCKERS = Object.freeze([
  "blueprint_phase_resource_adoption_requires_provider_validation",
  "private_service_recurring_cost_requires_exact_owner_confirmation",
  "runtime_database_role_requires_provider_native_creation",
]);
const RISKS = Object.freeze([
  "staging_environment_network_isolation_not_enabled",
]);

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function sorted(values) {
  return [...values].sort();
}

function exactKeys(value, expected) {
  return plainObject(value) &&
    JSON.stringify(sorted(Object.keys(value))) === JSON.stringify(sorted(expected));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function envMap(service) {
  return new Map((service.envVars || []).map((entry) => [entry.key, entry]));
}

function sensitiveKey(key) {
  return /(?:SECRET|TOKEN|PASSWORD|(?:^|_)KEYS?$|DATABASE_URL$)/.test(key);
}

function safeReference(entry) {
  const sourceKinds = ["value", "generateValue", "fromDatabase", "fromService", "sync"]
    .filter((key) => Object.hasOwn(entry, key));
  return sourceKinds.length === 1;
}

function validateEnvironmentEntry(entry, currentServiceName, serviceNames, serviceByName, errors) {
  if (!plainObject(entry) || typeof entry.key !== "string" ||
      !/^[A-Z][A-Z0-9_]{1,95}$/.test(entry.key) || !safeReference(entry)) {
    errors.add("environment_entry_shape_invalid");
    return;
  }
  if (entry.key === "DATABASE_URL") errors.add("generic_database_url_forbidden");
  if (entry.key.startsWith("AUTH0_")) errors.add("auth0_environment_forbidden");

  if (Object.hasOwn(entry, "value")) {
    if (!exactKeys(entry, ["key", "value"]) || typeof entry.value !== "string") {
      errors.add("literal_environment_entry_invalid");
    }
    if (sensitiveKey(entry.key)) errors.add("literal_secret_forbidden");
    if ((entry.key !== "NODE_ENV" && /\bproduction\b/i.test(String(entry.value))) ||
        /skinharmony-(?:core-mcp|universal-core)(?!-staging)/i.test(String(entry.value))) {
      errors.add("production_reference_forbidden");
    }
    if (/^(?:postgres(?:ql)?):\/\//i.test(String(entry.value)) ||
        /:\/\/[^/\s]+@/i.test(String(entry.value))) {
      errors.add("credential_url_literal_forbidden");
    }
  }

  if (Object.hasOwn(entry, "generateValue") &&
      (!exactKeys(entry, ["key", "generateValue"]) || entry.generateValue !== true)) {
    errors.add("generate_value_entry_invalid");
  }

  if (Object.hasOwn(entry, "sync")) {
    if (!exactKeys(entry, ["key", "sync"]) || entry.sync !== false ||
        !PUBLIC_SYNC_FIELDS.has(entry.key)) {
      errors.add("unapproved_sync_field");
    }
    if (sensitiveKey(entry.key)) errors.add("secret_sync_field_forbidden");
  }

  if (Object.hasOwn(entry, "fromDatabase")) {
    const expectedProperty = {
      PG_ADMIN_DATABASE_URL: "connectionString",
      PG_EXPECTED_DATABASE_NAME: "database",
      MCP_COLLABORATION_DATABASE_URL: "connectionString",
    }[entry.key];
    if (!exactKeys(entry, ["key", "fromDatabase"]) ||
        !exactKeys(entry.fromDatabase, ["name", "property"]) ||
        entry.fromDatabase.name !== DATABASE ||
        entry.fromDatabase.property !== expectedProperty) {
      errors.add("database_reference_invalid");
    }
  }

  if (Object.hasOwn(entry, "fromService")) {
    const reference = entry.fromService;
    const usesProperty = plainObject(reference) && Object.hasOwn(reference, "property");
    const usesEnvironment = plainObject(reference) && Object.hasOwn(reference, "envVarKey");
    const expectedKeys = usesProperty ? ["type", "name", "property"] :
      usesEnvironment ? ["type", "name", "envVarKey"] : [];
    if (!exactKeys(entry, ["key", "fromService"]) ||
        !expectedKeys.length || !exactKeys(reference, expectedKeys) ||
        !serviceNames.has(reference.name) ||
        !["pserv", "web"].includes(reference.type) ||
        serviceByName.get(reference.name)?.type !== reference.type ||
        (usesProperty && reference.property !== "hostport")) {
      errors.add("service_reference_invalid");
    } else if (usesEnvironment) {
      const sourceKeys = envMap(serviceByName.get(reference.name));
      const nativeCommitReference =
        reference.envVarKey === "RENDER_GIT_COMMIT" &&
        reference.name === currentServiceName &&
        ["MCP_STAGING_DEPENDENCY_BUILD_COMMIT", "MCP_COLLABORATION_BUILD_COMMIT"]
          .includes(entry.key);
      if (!nativeCommitReference && !sourceKeys.has(reference.envVarKey)) {
        errors.add("service_environment_reference_invalid");
      }
    }
  }
}

function validateExpectedEnvironmentContract(kind, service, errors) {
  const environment = envMap(service);
  const covered = new Set();
  for (const [key, value] of Object.entries(
    EXPECTED_LITERAL_VALUES[kind]?.[service.name] || {},
  )) {
    covered.add(key);
    if (canonicalJson(environment.get(key)) !== canonicalJson({ key, value })) {
      errors.add(`${kind}_literal_binding_invalid`);
    }
  }
  for (const key of EXPECTED_GENERATED_KEYS[kind]?.[service.name] || []) {
    covered.add(key);
    if (canonicalJson(environment.get(key)) !== canonicalJson({ key, generateValue: true })) {
      errors.add(`${kind}_generated_binding_invalid`);
    }
  }
  for (const key of EXPECTED_SYNC_KEYS[kind]?.[service.name] || []) {
    covered.add(key);
    if (canonicalJson(environment.get(key)) !== canonicalJson({ key, sync: false })) {
      errors.add(`${kind}_provider_input_binding_invalid`);
    }
  }
  for (const [key, fromDatabase] of Object.entries(
    EXPECTED_DATABASE_REFERENCES[kind]?.[service.name] || {},
  )) {
    covered.add(key);
    if (canonicalJson(environment.get(key)) !== canonicalJson({ key, fromDatabase })) {
      errors.add(`${kind}_database_binding_invalid`);
    }
  }
  for (const [key, fromService] of Object.entries(
    EXPECTED_SERVICE_REFERENCES[kind]?.[service.name] || {},
  )) {
    covered.add(key);
    if (canonicalJson(environment.get(key)) !== canonicalJson({ key, fromService })) {
      errors.add(`${kind}_service_binding_invalid`);
    }
  }
  if (JSON.stringify(sorted(covered)) !==
      JSON.stringify(sorted(EXPECTED_ENV_KEYS[kind]?.[service.name] || []))) {
    errors.add(`${kind}_environment_contract_incomplete`);
  }
}

function servicesFromBlueprint(kind, document, errors) {
  if (!plainObject(document) || !exactKeys(document, ["projects"]) ||
      !Array.isArray(document.projects) || document.projects.length !== 1) {
    errors.add(`${kind}_blueprint_shape_invalid`);
    return null;
  }
  const project = document.projects[0];
  if (!plainObject(project) || !exactKeys(project, ["name", "environments"]) ||
      project.name !== PROJECT || !Array.isArray(project.environments) ||
      project.environments.length !== 1) {
    errors.add(`${kind}_project_binding_invalid`);
    return null;
  }
  const environment = project.environments[0];
  if (!plainObject(environment) || !exactKeys(environment, ["name", "services"]) ||
      environment.name !== ENVIRONMENT || !Array.isArray(environment.services)) {
    errors.add(`${kind}_environment_binding_invalid`);
    return null;
  }
  return environment.services;
}

function validateBlueprint(kind, document, errors) {
  const services = servicesFromBlueprint(kind, document, errors);
  if (!services) return;
  const expected = EXPECTED_SERVICES[kind];
  const serviceNames = new Set(services.map((service) => service?.name));
  if (serviceNames.size !== services.length ||
      JSON.stringify(sorted(serviceNames)) !== JSON.stringify(sorted(Object.keys(expected)))) {
    errors.add(`${kind}_service_set_invalid`);
  }
  const serviceByName = new Map(services.map((service) => [service?.name, service]));

  for (const service of services) {
    const contract = expected[service?.name];
    if (!plainObject(service) || !contract ||
        Object.keys(service).some((key) => !SERVICE_FIELDS.has(key))) {
      errors.add(`${kind}_service_shape_invalid`);
      continue;
    }
    const expectedFields = contract.healthCheckPath
      ? [...SERVICE_FIELDS]
      : [...SERVICE_FIELDS].filter((key) => key !== "healthCheckPath");
    if (!exactKeys(service, expectedFields) ||
        service.type !== contract.type ||
        service.runtime !== "node" ||
        service.plan !== contract.plan ||
        service.region !== "oregon" ||
        service.repo !== REPOSITORY ||
        service.branch !== BRANCH ||
        service.autoDeployTrigger !== "off" ||
        service.buildCommand !== contract.buildCommand ||
        service.startCommand !== contract.startCommand ||
        (contract.healthCheckPath && service.healthCheckPath !== contract.healthCheckPath) ||
        !Array.isArray(service.envVars)) {
      errors.add(`${kind}_service_contract_invalid`);
      continue;
    }
    const environment = envMap(service);
    if (environment.size !== service.envVars.length ||
        JSON.stringify(sorted(environment.keys())) !==
          JSON.stringify(sorted(EXPECTED_ENV_KEYS[kind][service.name] || []))) {
      errors.add(`${kind}_environment_set_invalid`);
    }
    if (environment.get("PORT")?.value !== contract.port ||
        environment.get("NODE_ENV")?.value !== "production") {
      errors.add(`${kind}_runtime_environment_invalid`);
    }
    for (const entry of service.envVars) {
      validateEnvironmentEntry(entry, service.name, serviceNames, serviceByName, errors);
    }
    validateExpectedEnvironmentContract(kind, service, errors);
  }
}

function scanForbiddenValues(value, errors) {
  if (typeof value === "string") {
    if (/^(?:srv|dpg|env|prj)-[a-z0-9]+$/i.test(value)) {
      errors.add("render_resource_identifier_forbidden");
    }
    if (/^[a-f0-9]{40}$/i.test(value)) errors.add("hardcoded_commit_forbidden");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) scanForbiddenValues(item, errors);
    return;
  }
  if (plainObject(value)) {
    for (const item of Object.values(value)) scanForbiddenValues(item, errors);
  }
}

function validateCrossBlueprintContracts(documents, errors) {
  const bootstrapServices = servicesFromBlueprint("bootstrap", documents.bootstrap, errors);
  const controlServices = servicesFromBlueprint("control", documents.control, errors);
  const finalServices = servicesFromBlueprint("final", documents.final, errors);
  if (!bootstrapServices || !controlServices || !finalServices) return;
  const bootstrap = new Map(bootstrapServices.map((service) => [service.name, service]));
  const control = new Map(controlServices.map((service) => [service.name, service]));
  const final = new Map(finalServices.map((service) => [service.name, service]));
  if (envMap(bootstrap.get(BOOTSTRAP_SERVICE)).get("MCP_STAGING_DB_BOOTSTRAP_MODE")?.value !== "hold" ||
      envMap(control.get(BOOTSTRAP_SERVICE)).get("MCP_STAGING_DB_BOOTSTRAP_MODE")?.value !== "initialize" ||
      envMap(final.get(BOOTSTRAP_SERVICE)).get("MCP_STAGING_DB_BOOTSTRAP_MODE")?.value !== "steady") {
    errors.add("database_bootstrap_phase_invalid");
  }
  for (const issuer of [CORE_ISSUER, NYRA_ISSUER]) {
    if (envMap(bootstrap.get(issuer)).get("MCP_STAGING_ISSUER_STARTUP_MODE")?.value !== "jwks_only" ||
        envMap(control.get(issuer)).get("MCP_STAGING_ISSUER_STARTUP_MODE")?.value !== "jwks_only" ||
        envMap(final.get(issuer)).get("MCP_STAGING_ISSUER_STARTUP_MODE")?.value !== "full") {
      errors.add("issuer_bootstrap_phase_invalid");
    }
  }
  for (const service of bootstrapServices) {
    const environment = envMap(service);
    if ([...environment.values()].some((entry) => Object.hasOwn(entry, "fromDatabase")) ||
        [...environment.keys()].some((key) =>
          ["PG_ADMIN_DATABASE_URL", "PG_EXPECTED_DATABASE_NAME",
            "MCP_STAGING_GATE_CONTROL_PASSWORD", "MCP_STAGING_CORE_NONCE_API_TOKEN",
            "MCP_STAGING_NYRA_NONCE_API_TOKEN",
            "MCP_STAGING_RECEIPT_CONSUMER_API_TOKEN"].includes(key))) {
      errors.add("bootstrap_hold_database_surface_forbidden");
    }
  }
  const finalMcp = envMap(final.get(MCP));
  const databaseReference = finalMcp.get("MCP_COLLABORATION_DATABASE_URL");
  if (databaseReference?.fromDatabase?.name !== DATABASE ||
      databaseReference?.fromDatabase?.property !== "connectionString") {
    errors.add("mcp_collaboration_database_reference_invalid");
  }
  if (finalMcp.has("DATABASE_URL")) errors.add("generic_database_url_forbidden");
  for (const service of finalServices) {
    if (service.name !== MCP &&
        envMap(service).has("MCP_COLLABORATION_DATABASE_URL")) {
      errors.add("collaboration_database_reference_scope_invalid");
    }
  }
}

export function parseMcpStagingBlueprint(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error("blueprint_yaml_json_subset_invalid");
  }
  if (!plainObject(document)) throw new Error("blueprint_yaml_json_subset_invalid");
  return document;
}

export function readMcpStagingBlueprints(root) {
  const documents = {};
  for (const [kind, filename] of Object.entries(MCP_STAGING_BLUEPRINT_FILES)) {
    documents[kind] = parseMcpStagingBlueprint(
      fs.readFileSync(new URL(filename, `file://${root.replace(/\/?$/, "/")}`), "utf8"),
    );
  }
  return documents;
}

export function validateMcpStagingBlueprints(documents) {
  const errors = new Set();
  if (!plainObject(documents) ||
      !plainObject(documents.bootstrap) ||
      !plainObject(documents.control) ||
      !plainObject(documents.final)) {
    return Object.freeze({
      schema_version: "mcp_staging_blueprint_policy_v1",
      static_policy_ok: false,
      deploy_ready: false,
      errors: Object.freeze(["blueprint_documents_invalid"]),
      blockers: Object.freeze([...BLOCKERS]),
      risks: Object.freeze([...RISKS]),
      secrets_exposed: false,
    });
  }
  validateBlueprint("bootstrap", documents.bootstrap, errors);
  validateBlueprint("control", documents.control, errors);
  validateBlueprint("final", documents.final, errors);
  if (!errors.size) validateCrossBlueprintContracts(documents, errors);
  scanForbiddenValues(documents, errors);
  const normalizedErrors = Object.freeze(sorted(errors));
  return Object.freeze({
    schema_version: "mcp_staging_blueprint_policy_v1",
    static_policy_ok: normalizedErrors.length === 0,
    deploy_ready: false,
    errors: normalizedErrors,
    blockers: Object.freeze([...BLOCKERS]),
    risks: Object.freeze([...RISKS]),
    secrets_exposed: false,
  });
}

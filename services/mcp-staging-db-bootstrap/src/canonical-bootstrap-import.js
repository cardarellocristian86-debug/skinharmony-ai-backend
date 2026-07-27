import crypto from "node:crypto";
import {
  CANONICAL_BOOTSTRAP_SCOPE,
  CanonicalBootstrapError,
  createCanonicalBootstrapProtocol,
  createPostgresCanonicalBootstrapConsumer,
} from "../../mcp-staging-canonical-bootstrap/src/index.js";
import {
  collaborationDigest,
  createCollaborationActionBinding,
  createCollaborationReceiptVerifier,
} from "../../skinharmony-core-mcp/src/collaboration-receipt.js";
import { createCollaborationIssuerClient } from
  "../../skinharmony-core-mcp/src/collaboration-issuer-client.js";
import { discoverMcpStagingPrivateTrust } from
  "../../mcp-staging-issuer/src/privateJwksClient.js";

const AUDIENCE = "https://skinharmony-core-mcp-staging.onrender.com/mcp";
const CORE_HOSTPORT = "skinharmony-universal-core-staging:8787";
const CORE_ISSUER_HOSTPORT = "skinharmony-core-staging-issuer:8789";
const NYRA_ISSUER_HOSTPORT = "skinharmony-nyra-staging-issuer:8789";
const RUNTIME_ROLE = "mcp_collaboration_runtime";
const MAX_CORE_RESPONSE_BYTES = 64 * 1024;
const CORE_REQUEST_TIMEOUT_MS = 5_000;
const SENSITIVE_ENV_KEYS = Object.freeze([
  "PG_ADMIN_DATABASE_URL",
  "MCP_STAGING_GATE_CONTROL_PASSWORD",
  "MCP_STAGING_UNIVERSAL_CORE_KEY",
  "MCP_STAGING_CORE_ISSUER_TOKEN",
  "MCP_STAGING_NYRA_ISSUER_TOKEN",
]);
const CONFIG_ENV_KEYS = Object.freeze([
  ...SENSITIVE_ENV_KEYS,
  "PG_EXPECTED_DATABASE_NAME",
  "MCP_STAGING_UNIVERSAL_CORE_HOSTPORT",
  "MCP_STAGING_CORE_ISSUER_HOSTPORT",
  "MCP_STAGING_NYRA_ISSUER_HOSTPORT",
  "MCP_STAGING_DEPENDENCY_BUILD_COMMIT",
]);

export class CanonicalBootstrapImportError extends Error {
  constructor(code) {
    super(code);
    this.name = "CanonicalBootstrapImportError";
    this.code = code;
  }
}

function fail(code) {
  throw new CanonicalBootstrapImportError(code);
}

function validSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4_096 &&
    /^[\x21-\x7e]+$/.test(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function readEnv(env, key) {
  try {
    return env[key];
  } catch {
    fail("canonical_bootstrap_import_environment_invalid");
  }
}

export function scrubCanonicalBootstrapImportEnvironment(env = process.env) {
  if (!env || (typeof env !== "object" && typeof env !== "function")) return;
  for (const key of CONFIG_ENV_KEYS) {
    try {
      if (Object.prototype.hasOwnProperty.call(env, key)) env[key] = "";
      delete env[key];
    } catch {
      // Best-effort scrubbing; values are never reflected in an error.
    }
  }
}

function controlConnectionString(providerReference, controlPassword, expectedDatabase) {
  let parsed;
  try {
    parsed = new URL(providerReference);
  } catch {
    fail("canonical_bootstrap_import_database_reference_invalid");
  }
  let database;
  let username;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    username = decodeURIComponent(parsed.username);
  } catch {
    fail("canonical_bootstrap_import_database_reference_invalid");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !parsed.hostname || !parsed.password ||
      database !== expectedDatabase ||
      username !== RUNTIME_ROLE) {
    fail("canonical_bootstrap_import_database_reference_invalid");
  }
  parsed.username = CANONICAL_BOOTSTRAP_SCOPE.control_role;
  parsed.password = controlPassword;
  parsed.searchParams.set("sslmode", "require");
  parsed.searchParams.set("application_name", "mcp-staging-canonical-bootstrap");
  return parsed.toString();
}

function loadConfiguration(env) {
  if (!env || (typeof env !== "object" && typeof env !== "function")) {
    fail("canonical_bootstrap_import_environment_invalid");
  }
  const values = Object.fromEntries(CONFIG_ENV_KEYS.map((key) => [key, readEnv(env, key)]));
  const commit = String(values.MCP_STAGING_DEPENDENCY_BUILD_COMMIT || "").toLowerCase();
  if (values.PG_EXPECTED_DATABASE_NAME !== CANONICAL_BOOTSTRAP_SCOPE.target_database ||
      values.MCP_STAGING_UNIVERSAL_CORE_HOSTPORT !== CORE_HOSTPORT ||
      values.MCP_STAGING_CORE_ISSUER_HOSTPORT !== CORE_ISSUER_HOSTPORT ||
      values.MCP_STAGING_NYRA_ISSUER_HOSTPORT !== NYRA_ISSUER_HOSTPORT ||
      !/^[a-f0-9]{40}$/.test(commit) ||
      !validSecret(values.MCP_STAGING_GATE_CONTROL_PASSWORD) ||
      !validSecret(values.MCP_STAGING_UNIVERSAL_CORE_KEY) ||
      !validSecret(values.MCP_STAGING_CORE_ISSUER_TOKEN) ||
      !validSecret(values.MCP_STAGING_NYRA_ISSUER_TOKEN) ||
      values.MCP_STAGING_CORE_ISSUER_TOKEN === values.MCP_STAGING_NYRA_ISSUER_TOKEN) {
    fail("canonical_bootstrap_import_environment_invalid");
  }
  const connectionString = controlConnectionString(
    values.PG_ADMIN_DATABASE_URL,
    values.MCP_STAGING_GATE_CONTROL_PASSWORD,
    values.PG_EXPECTED_DATABASE_NAME,
  );
  return {
    targetCommit: commit,
    connectionString,
    coreKey: values.MCP_STAGING_UNIVERSAL_CORE_KEY,
    coreIssuerToken: values.MCP_STAGING_CORE_ISSUER_TOKEN,
    nyraIssuerToken: values.MCP_STAGING_NYRA_ISSUER_TOKEN,
  };
}

async function readBoundedJson(response) {
  const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    fail("canonical_bootstrap_core_response_invalid");
  }
  const declared = response.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined && declared !== "") {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_CORE_RESPONSE_BYTES) {
      fail("canonical_bootstrap_core_response_invalid");
    }
  }
  const reader = response.body?.getReader?.();
  if (!reader) fail("canonical_bootstrap_core_response_invalid");
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_CORE_RESPONSE_BYTES) {
      try { await reader.cancel(); } catch {}
      fail("canonical_bootstrap_core_response_invalid");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const result = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      fail("canonical_bootstrap_core_response_invalid");
    }
    return result;
  } catch (error) {
    if (error instanceof CanonicalBootstrapImportError) throw error;
    fail("canonical_bootstrap_core_response_invalid");
  }
}

async function requestCoreGate(fetchImpl, coreKey, binding, action) {
  const bindingDigest = collaborationDigest("mcp-collaboration-binding-v1", binding);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CORE_REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  let response;
  try {
    response = await fetchImpl(`http://${CORE_HOSTPORT}/v1/action-evaluator`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${coreKey}`,
        "x-sh-tenant-id": CANONICAL_BOOTSTRAP_SCOPE.tenant_id,
      },
      body: JSON.stringify({
        tenant_id: CANONICAL_BOOTSTRAP_SCOPE.tenant_id,
        action_label: "Import canonical staging shared memory",
        action_type: action.action_type,
        target: action.target,
        payload_sha256: action.payload_sha256,
        target_commit: binding.target_commit,
        collaboration_binding_digest: bindingDigest,
        collaboration_audience: binding.audience,
        collaboration_target_service: binding.target_service,
        collaboration_target_environment: binding.target_environment,
        collaboration_target_commit: binding.target_commit,
        expected_version: binding.expected_version,
        lock_id: binding.lock_id,
        fencing_token: binding.fencing_token,
        idempotency_key_sha256: binding.idempotency_key_sha256,
        operation_class: "reversible_internal_collaboration_write",
        external_side_effect: false,
        contains_customer_data: false,
        contains_secret: false,
        secret_value_transmitted: false,
        cross_tenant: false,
        destructive: false,
        bypass_orchestrator: false,
        configuration_changes: false,
        rollback_ready: true,
        audit_ready: true,
        owner_confirmed: true,
        confirmation_reference: "provider_native_canonical_bootstrap_authorization",
      }),
    });
  } catch {
    fail("canonical_bootstrap_core_unavailable");
  } finally {
    clearTimeout(timeout);
  }
  if (response.status !== 200) fail("canonical_bootstrap_core_denied");
  const payload = await readBoundedJson(response);
  const authorization = payload.authorization;
  if (payload.ok !== true ||
      payload.tenant_id !== CANONICAL_BOOTSTRAP_SCOPE.tenant_id ||
      !authorization || typeof authorization !== "object" || Array.isArray(authorization) ||
      authorization.allowed !== true ||
      !["authorized", "authorized_after_confirmation"].includes(authorization.state) ||
      !["allow", "confirmed"].includes(authorization.mediation) ||
      typeof authorization.confirmation_satisfied !== "boolean" ||
      !payload.collaboration_core_gate ||
      typeof payload.collaboration_core_gate !== "object" ||
      Array.isArray(payload.collaboration_core_gate)) {
    fail("canonical_bootstrap_core_denied");
  }
  return Object.freeze({
    decision: Object.freeze({
      binding_digest: bindingDigest,
      decision: authorization.state,
      mediation: authorization.mediation,
      confirmation_satisfied: authorization.confirmation_satisfied,
    }),
    coreGate: payload.collaboration_core_gate,
  });
}

function approvalFromReceipt(expected, receipt) {
  return Object.freeze({
    ...expected,
    schema_version: "mcp_staging_canonical_bootstrap_verified_approval_v1",
    verified: true,
    decision: "allow",
    approval_jti: receipt.jti,
    issued_at: receipt.issued_at,
    expires_at: receipt.expires_at,
    authorities: Object.freeze([
      Object.freeze({
        issuer: receipt.authorities[0].issuer,
        role: "final_authority",
        key_fingerprint: receipt.authorities[0].kid,
        receipt_digest: receipt.authorities[0].receipt_digest,
      }),
      Object.freeze({
        issuer: receipt.authorities[1].issuer,
        role: "advisory_veto",
        key_fingerprint: receipt.authorities[1].kid,
        receipt_digest: receipt.authorities[1].receipt_digest,
      }),
    ]),
  });
}

export function createCanonicalBootstrapLiveApprovalVerifier({
  config,
  trust,
  fetchImpl = globalThis.fetch,
  issuerClientFactory = createCollaborationIssuerClient,
  receiptVerifierFactory = createCollaborationReceiptVerifier,
  randomUUID = crypto.randomUUID,
} = {}) {
  if (!config || !trust || typeof fetchImpl !== "function" ||
      typeof issuerClientFactory !== "function" ||
      typeof receiptVerifierFactory !== "function" ||
      typeof randomUUID !== "function") {
    fail("canonical_bootstrap_live_approval_configuration_invalid");
  }
  const bindingConfig = Object.freeze({
    resource: AUDIENCE,
    collaborationReceiptAudience: AUDIENCE,
    collaborationTargetService: CANONICAL_BOOTSTRAP_SCOPE.target_service,
    collaborationTargetEnvironment: CANONICAL_BOOTSTRAP_SCOPE.target_environment,
    collaborationBuildCommit: config.targetCommit,
  });
  const issuerClient = issuerClientFactory({
    collaborationCoreIssuerHostport: CORE_ISSUER_HOSTPORT,
    collaborationNyraIssuerHostport: NYRA_ISSUER_HOSTPORT,
    collaborationCoreIssuerToken: config.coreIssuerToken,
    collaborationNyraIssuerToken: config.nyraIssuerToken,
    collaborationIssuerTimeoutMs: 5_000,
    collaborationReceiptTtlMs: 20_000,
  });
  const receiptVerifier = receiptVerifierFactory({
    coreJwk: trust.core.jwkJson,
    coreKid: trust.core.kid,
    nyraJwk: trust.nyra.jwkJson,
    nyraKid: trust.nyra.kid,
    coreIssuer: "universal-core-staging",
    nyraIssuer: "nyra-staging",
    maxTtlMs: 30_000,
    expectedTenantId: CANONICAL_BOOTSTRAP_SCOPE.tenant_id,
    expectedTargetService: CANONICAL_BOOTSTRAP_SCOPE.target_service,
    expectedTargetEnvironment: CANONICAL_BOOTSTRAP_SCOPE.target_environment,
    expectedTargetCommit: config.targetCommit,
  });
  if (issuerClient?.ready !== true || receiptVerifier?.ready !== true) {
    fail("canonical_bootstrap_live_approval_configuration_invalid");
  }

  return Object.freeze({
    async verify(_opaqueArtifact, expected) {
      const traceId = randomUUID();
      const bootstrapId = String(expected?.bootstrap_id || "");
      const action = Object.freeze({
        action_type: "canonical.bootstrap",
        target: `${CANONICAL_BOOTSTRAP_SCOPE.target_database}/SHARED_MEMORY`,
        payload_sha256: expected?.bundle_sha256,
        idempotency_key_sha256: sha256(
          `mcp-staging-canonical-bootstrap\0${bootstrapId}\0${expected?.bundle_sha256 || ""}`,
        ),
      });
      const identity = Object.freeze({
        tenantId: CANONICAL_BOOTSTRAP_SCOPE.tenant_id,
        subject: "mcp-staging-canonical-bootstrap",
        agentPresence: Object.freeze({
          agent_id: "canonical_bootstrap",
          session_id: "provider_native_import",
          session_fingerprint: "canonicalbootstrap20260723",
          signature: "ags_canonical_bootstrap_provider_native",
        }),
        governanceContext: Object.freeze({
          tool_name: "canonical_bootstrap_import",
          trace_id: traceId,
          preflight_id: `preflight-${bootstrapId}`,
          task_contract_id: `task-contract:${bootstrapId}`,
          task_trace_id: `task-trace:${bootstrapId}`,
          coordination_lock: "mcp-staging-canonical-bootstrap",
          shared_memory_checksum: expected?.bundle_sha256,
        }),
      });
      let binding;
      try {
        binding = createCollaborationActionBinding(bindingConfig, action, identity);
      } catch {
        fail("canonical_bootstrap_live_binding_invalid");
      }
      const core = await requestCoreGate(fetchImpl, config.coreKey, binding, action);
      let bundle;
      let receipt;
      try {
        bundle = await issuerClient.issue(binding, {
          coreDecision: core.decision,
          coreGate: core.coreGate,
        });
        receipt = await receiptVerifier.verify(bundle, {
          config: bindingConfig,
          action,
          identity,
        });
      } catch {
        fail("canonical_bootstrap_signed_approval_invalid");
      }
      return Object.freeze({
        approval: approvalFromReceipt(expected, receipt),
        receipt_evidence: receipt,
      });
    },
  });
}

async function defaultPoolFactory(connectionString) {
  const { Pool } = await import("pg");
  return new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 8_000,
    query_timeout: 8_000,
    idle_in_transaction_session_timeout: 8_000,
    options: "-c search_path=pg_catalog,public,pg_temp -c row_security=on",
    application_name: "mcp-staging-canonical-bootstrap",
  });
}

export async function executeCanonicalBootstrapImport({
  bundle,
  env = process.env,
  fetchImpl = globalThis.fetch,
  poolFactory = defaultPoolFactory,
  trustDiscoverer = discoverMcpStagingPrivateTrust,
  issuerClientFactory,
  receiptVerifierFactory,
  randomUUID,
  now = Date.now,
} = {}) {
  if (typeof fetchImpl !== "function" || typeof poolFactory !== "function" ||
      typeof trustDiscoverer !== "function" || typeof now !== "function") {
    fail("canonical_bootstrap_import_runtime_invalid");
  }
  let config;
  let pool;
  try {
    config = loadConfiguration(env);
    pool = await poolFactory(config.connectionString);
    if (!pool || typeof pool.connect !== "function" || typeof pool.end !== "function") {
      fail("canonical_bootstrap_import_database_unavailable");
    }
    const trust = await trustDiscoverer({
      coreHostport: CORE_ISSUER_HOSTPORT,
      nyraHostport: NYRA_ISSUER_HOSTPORT,
      coreToken: config.coreIssuerToken,
      nyraToken: config.nyraIssuerToken,
      targetCommit: config.targetCommit,
      timeoutMs: 5_000,
      attempts: 12,
      fetchImpl,
    });
    const approvalVerifier = createCanonicalBootstrapLiveApprovalVerifier({
      config,
      trust,
      fetchImpl,
      ...(issuerClientFactory ? { issuerClientFactory } : {}),
      ...(receiptVerifierFactory ? { receiptVerifierFactory } : {}),
      ...(randomUUID ? { randomUUID } : {}),
    });
    const protocol = createCanonicalBootstrapProtocol({
      approvalVerifier,
      consumer: createPostgresCanonicalBootstrapConsumer(pool),
      now,
    });
    return await protocol.execute({
      bundle,
      runtime_binding: {
        tenant_id: CANONICAL_BOOTSTRAP_SCOPE.tenant_id,
        executor_service: CANONICAL_BOOTSTRAP_SCOPE.executor_service,
        control_role: CANONICAL_BOOTSTRAP_SCOPE.control_role,
        target_service: CANONICAL_BOOTSTRAP_SCOPE.target_service,
        target_environment: CANONICAL_BOOTSTRAP_SCOPE.target_environment,
        target_database: CANONICAL_BOOTSTRAP_SCOPE.target_database,
        target_commit: config.targetCommit,
      },
      approval_artifact: Object.freeze({ provider_native: true }),
    });
  } catch (error) {
    if (error instanceof CanonicalBootstrapImportError ||
        error instanceof CanonicalBootstrapError) {
      throw error;
    }
    fail("canonical_bootstrap_import_failed");
  } finally {
    scrubCanonicalBootstrapImportEnvironment(env);
    if (config) {
      config.connectionString = "";
      config.coreKey = "";
      config.coreIssuerToken = "";
      config.nyraIssuerToken = "";
    }
    if (pool) {
      try { await pool.end(); } catch {}
    }
  }
}

export const canonicalBootstrapImportContract = Object.freeze({
  tenant_id: CANONICAL_BOOTSTRAP_SCOPE.tenant_id,
  executor_service: CANONICAL_BOOTSTRAP_SCOPE.executor_service,
  control_role: CANONICAL_BOOTSTRAP_SCOPE.control_role,
  target_service: CANONICAL_BOOTSTRAP_SCOPE.target_service,
  target_environment: CANONICAL_BOOTSTRAP_SCOPE.target_environment,
  target_database: CANONICAL_BOOTSTRAP_SCOPE.target_database,
  core_hostport: CORE_HOSTPORT,
  core_issuer_hostport: CORE_ISSUER_HOSTPORT,
  nyra_issuer_hostport: NYRA_ISSUER_HOSTPORT,
  audience: AUDIENCE,
});

import crypto from "node:crypto";
import express from "express";
import {
  createAuthenticator,
  isCodexGoodModeDelegation,
  ownerRequestBinding,
  requireScopes,
} from "./auth.js";
import { TOOLS } from "./tool-definitions.js";
import { createAgentPresence } from "./agent-presence.js";
import { validateToolArguments } from "./schema-validation.js";
import { compactMcpTools } from "./dynamic-capability-router.js";
import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  HOST_NATIVE_HEALTH_CONTRACT_VERSION,
} from "./host-native-health-contract.js";
import {
  normalizePostgresMajorVerification,
} from "../../shared/postgres-major-version.js";

const SERVER_VERSION = "0.16.0-governed-continuity-fabric";
const SERVER_INSTRUCTIONS = [
  "SkinHarmony Nyra & Core is installed as a ChatGPT connector. IMPORTANT: the MCP address is technical and must never be opened in Safari or pasted as a normal web link.",
  "FIRST INSTALLATION ONLY: in ChatGPT open Settings > Apps & connectors > Advanced settings, enable Developer Mode, choose Create app / Add MCP server, name it SkinHarmony Nyra & Core, paste exactly https://skinharmony-core-mcp.onrender.com/mcp as the server URL, select OAuth and tap Connect. If the connector is already present, use it from a new normal chat.",
  "WHAT IT DOES: the first host-supplied request becomes a redacted immutable Intent Anchor when continuity capture is enabled. Nyra interprets it, plans bounded specialist work, supervises evidence and asks for correction until the closure criteria are met. Universal Core remains the final policy authority for tenant isolation, budgets, delegation, audit, release and rollback.",
  "HOST-NATIVE MULTI-AGENT: when the user asks for multi-agent work, Nyra/Core returns a bounded host-native plan. The root ChatGPT or Codex coordinator must create the real children with its native agent capability, then register assignment and result receipts. The server makes zero provider model calls for this path: provider_execution=false, provider_api_key_required=false and server_model_calls=0. A child never inherits owner authority, cannot mint a delegation, and cannot approve its own work. A distinct verifier and a Core closure verdict are required.",
  "DELEGATED ACTIONS: Nyra may request a bounded, expiring, revocable delegation for exact work, repository, branch, action, evidence and rollback. Core may issue a short one-shot action ticket, but host_policy_override is always false and host_policy_must_allow is always true. Nyra/Core cannot click, bypass or replace ChatGPT/Codex approval, sandbox or auto-review controls.",
  "CONTINUITY: use the Work Atlas for targeted context, record only verified incident runbooks, checkpoint every blocker with a clear next action, and resume only after digest and drift verification. Do not close work from a caller-provided supervisor boolean.",
  "OPENAI PROVIDER DISABLED: Nyra and Universal Core operate without an OpenAI API key. Never ask for or accept an API key in chat or a tool argument. Never call provider tools, open setup panels or direct the user to /connect/openai, /agents or /mobile/agents. Old provider links are retired.",
  "RESEARCH DISTILLATION: for current external evidence, call nyra_research_plan, use the host ChatGPT or Codex web tool, then ingest and distill reviewed evidence in the tenant-isolated shadow workspace. Research never invokes a server-side model provider.",
  "HOW TO BUILD AN AGENT: define a narrow role, bounded task digest, dependencies, acceptance criteria, budget, cancellation and a host assignment receipt.",
  "AUTOMATIC: generic flows use preflight, shared memory and continuity; host-native flows use the host coordinator plus Nyra/Core supervision.",
  "NOT AUTOMATIC: host permission grants, unbounded deployment, browsing or external actions.",
  "PRIVACY: Never include secrets, raw customer data or full pages; identity comes only from OAuth or the configured Codex bearer, and only redacted reviewed evidence enters memory.",
].join(" ");

export const GENERIC_PREFLIGHT_EXEMPT_TOOLS = new Set([
  "work_preflight",
  "core_health",
  "nyra_branch_catalog",
  "core_capability_catalog",
  "core_branch_registry",
  "core_capability_read",
  "core_capability_invoke",
  "orchestration_dtt_core_join",
  "nyra_research_airlock_status",
  "nyra_research_airlock_plan",
  "nyra_research_airlock_open",
  "nyra_research_airlock_discover",
  "nyra_research_airlock_seal",
  "nyra_research_airlock_private_enter",
  "nyra_research_airlock_tool_authorize",
  "nyra_research_airlock_complete",
]);

export function requiresGenericWorkPreflight(toolName, args = {}) {
  if (
    String(toolName || "") === "core_capability_read" &&
    String(args?.capability_id || "") === "core_action_mediation_evaluate"
  ) return true;
  return !GENERIC_PREFLIGHT_EXEMPT_TOOLS.has(String(toolName || ""));
}
const SESSIONLESS_BOOTSTRAP_TOOLS = new Set([
  "agent_heartbeat",
  "work_preflight",
  "core_health",
  "nyra_branch_catalog",
  "core_capability_catalog",
  "core_branch_registry",
  "core_semantic_select",
  "core_capability_read",
]);

function isAgentPresenceBootstrapCall(toolName, args = {}) {
  return toolName === "agent_heartbeat" ||
    ((toolName === "core_capability_catalog" || toolName === "core_capability_invoke") &&
      args?.capability_id === "agent_heartbeat");
}
const OAUTH_OWNER_ELEVATION_TOOLS = new Set([
  "core_capability_invoke",
  "host_native_delegation_issue",
  "host_native_delegation_revoke",
  "work_continuity_create",
  "work_continuity_start_or_resume",
  "core_block_remediation_resubmit",
]);

function inferClientType(identity) {
  const kind = String(identity?.kind || "").toLowerCase();
  // This gateway reserves verified OAuth identities for the ChatGPT connector;
  // Codex uses its scoped server-side bearer path below. The distinction is
  // correlation metadata only and never changes scopes or authorization.
  if (kind === "oauth" || kind.includes("chatgpt")) return "chatgpt";
  if (kind.includes("codex")) return "codex";
  return "api_agent";
}

function normalizeTransportSession(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(raw)) return raw;
  return `mcp_${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

function serverIssuedBootstrapSession() {
  return `mcp_bootstrap_${crypto.randomBytes(16).toString("hex")}`;
}

function buildIdentity(env = process.env) {
  const commitSha = String(env.RENDER_GIT_COMMIT || env.GIT_COMMIT || "").trim();
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) return null;
  return { commit_sha: commitSha, commit_verifiable: true };
}

function normalizedBuildIdentity(value) {
  if (
    value?.commit_verifiable !== true ||
    !/^[a-f0-9]{40}$/i.test(String(value.commit_sha || ""))
  ) {
    return null;
  }
  return {
    commit_sha: String(value.commit_sha).toLowerCase(),
    commit_verifiable: true,
  };
}

function sameConfiguredSecret(left, right) {
  const leftBuffer = Buffer.from(String(left || "").trim(), "utf8");
  const rightBuffer = Buffer.from(String(right || "").trim(), "utf8");
  return (
    leftBuffer.length > 0 &&
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function buildReadiness(config = {}, options = {}) {
  const environment = String(
    config.environment ||
    (config.production === true ? "production" : process.env.NODE_ENV) ||
    "development",
  ).toLowerCase();
  const enforced = environment === "production";
  const configuredBuild = config.runtimeBuildCommit
    ? { commit_sha: config.runtimeBuildCommit, commit_verifiable: true }
    : buildIdentity();
  const build = normalizedBuildIdentity(
    options.buildIdentity === undefined ? configuredBuild : options.buildIdentity,
  );
  const authConfigured = Boolean(
    config.auth0Issuer ||
    (Array.isArray(config.codexKeys) && config.codexKeys.length),
  );
  const hostNativeTenantGatewayConfigured =
    Buffer.byteLength(String(config.tenantGatewayKey || "").trim(), "utf8") >= 32;
  const coreCredentialConfigured = [
    config.universalCoreKey,
    hostNativeTenantGatewayConfigured ? config.tenantGatewayKey : "",
    ...Object.values(config.universalCoreKeys || {}),
  ].some((credential) =>
    typeof credential === "string" && credential.trim().length > 0);
  const coreConfigured = Boolean(config.universalCoreUrl && coreCredentialConfigured);
  const continuityRequired =
    config.hostNativeAgentProtocolEnabled === true ||
    config.workContinuityAutoCaptureEnabled === true;
  const continuityConfigured = Boolean(config.databaseUrl);
  const continuityInitialized = options.readiness?.continuityInitialized === true;
  const ledgerRequired = config.decisionLedgerRequired === true;
  const ledgerConfigured = Boolean(config.databaseUrl);
  const ledgerInitialized = options.readiness?.decisionLedgerInitialized === true;
  const postgresMajorVersion = normalizePostgresMajorVerification(
    options.readiness?.postgresMajorVersion,
  );
  const postgresMajorVersionRequired = enforced && Boolean(config.databaseUrl);
  const hostNativeSecurityRequired =
    enforced && config.hostNativeAgentProtocolEnabled === true;
  const hostNativeOwnerContextSigningConfigured =
    Buffer.byteLength(String(config.ownerContextSigningSecret || ""), "utf8") >= 32;
  const hostNativeTenantContextSigningConfigured =
    Buffer.byteLength(
      String(config.tenantContextSigningSecret || ""),
      "utf8",
    ) >= 32;
  const hostNativeDttIdentitySigningConfigured =
    Buffer.byteLength(
      String(config.dttAgentIdentitySigningSecret || ""),
      "utf8",
    ) >= 32;
  const hostNativeAgentSignatureConfigured =
    Buffer.byteLength(
      String(config.agentSignatureSecret || "").trim(),
      "utf8",
    ) >= 32;
  const hostNativeAgentSignatureReused =
    hostNativeAgentSignatureConfigured &&
    (
      config.agentSignatureSecretReused === true ||
      [
        config.universalCoreKey,
        ...Object.values(config.universalCoreKeys || {}),
        config.tenantGatewayKey,
        config.ownerContextSigningSecret,
        config.tenantContextSigningSecret,
        config.dttAgentIdentitySigningSecret,
        config.nyraDeepV2McpRequestSigningSecret,
        ...(Array.isArray(config.codexKeys) ? config.codexKeys : []),
      ].some((secret) =>
        sameConfiguredSecret(config.agentSignatureSecret, secret))
    );
  const hostNativeAgentSignatureIndependent =
    hostNativeAgentSignatureConfigured && !hostNativeAgentSignatureReused;
  const components = {
    build_identity: {
      required: true,
      configured: build !== null,
      ready: build !== null,
      commit_verifiable: build?.commit_verifiable === true,
    },
    authentication: {
      required: true,
      configured: authConfigured,
      ready: authConfigured,
    },
    universal_core: {
      required: true,
      configured: coreConfigured,
      ready: coreConfigured,
      reachability_checked: false,
    },
    host_native_security: {
      required: hostNativeSecurityRequired,
      tenant_gateway_configured: hostNativeTenantGatewayConfigured,
      owner_context_signing_configured:
        hostNativeOwnerContextSigningConfigured,
      tenant_context_signing_configured:
        hostNativeTenantContextSigningConfigured,
      dtt_identity_signing_configured:
        hostNativeDttIdentitySigningConfigured,
      agent_signature_configured:
        hostNativeAgentSignatureConfigured,
      agent_signature_independent:
        hostNativeAgentSignatureIndependent,
      ready:
        !hostNativeSecurityRequired ||
        (
          hostNativeTenantGatewayConfigured &&
          hostNativeOwnerContextSigningConfigured &&
          hostNativeTenantContextSigningConfigured &&
          hostNativeDttIdentitySigningConfigured &&
          hostNativeAgentSignatureIndependent
        ),
    },
    postgresql_version: {
      required: postgresMajorVersionRequired,
      ready: !postgresMajorVersionRequired || postgresMajorVersion.verified,
      major: postgresMajorVersion.major,
      verified: postgresMajorVersion.verified,
    },
    work_continuity: {
      required: continuityRequired,
      configured: continuityConfigured,
      initialized: continuityInitialized,
      initialization_failed:
        options.readiness?.continuityInitializationFailed === true,
      ready: !continuityRequired ||
        (continuityConfigured && continuityInitialized),
    },
    decision_ledger: {
      required: ledgerRequired,
      configured: ledgerConfigured,
      initialized: ledgerInitialized,
      initialization_failed:
        options.readiness?.decisionLedgerInitializationFailed === true,
      ready: !ledgerRequired || (ledgerConfigured && ledgerInitialized),
    },
  };
  const reasons = [];
  if (!components.build_identity.ready) reasons.push("build_identity_unverifiable");
  if (!components.authentication.ready) reasons.push("authentication_not_configured");
  if (!components.universal_core.ready) reasons.push("universal_core_not_configured");
  if (
    hostNativeSecurityRequired &&
    !hostNativeTenantGatewayConfigured
  ) {
    reasons.push("host_native_tenant_gateway_not_configured");
  }
  if (
    hostNativeSecurityRequired &&
    !hostNativeOwnerContextSigningConfigured
  ) {
    reasons.push("host_native_owner_context_signing_not_configured");
  }
  if (
    hostNativeSecurityRequired &&
    !hostNativeTenantContextSigningConfigured
  ) {
    reasons.push("host_native_tenant_context_signing_not_configured");
  }
  if (
    hostNativeSecurityRequired &&
    !hostNativeDttIdentitySigningConfigured
  ) {
    reasons.push("host_native_dtt_identity_signing_not_configured");
  }
  if (
    hostNativeSecurityRequired &&
    !hostNativeAgentSignatureConfigured
  ) {
    reasons.push("host_native_agent_signature_not_configured");
  } else if (
    hostNativeSecurityRequired &&
    hostNativeAgentSignatureReused
  ) {
    reasons.push("host_native_agent_signature_reused");
  }
  if (
    postgresMajorVersionRequired &&
    !postgresMajorVersion.verified
  ) {
    reasons.push("postgres_major_16_not_verified");
  }
  if (continuityRequired && !continuityConfigured) {
    reasons.push("continuity_postgres_not_configured");
  } else if (continuityRequired && !continuityInitialized) {
    reasons.push("continuity_not_initialized");
  }
  if (ledgerRequired && !ledgerConfigured) {
    reasons.push("decision_ledger_not_configured");
  } else if (ledgerRequired && !ledgerInitialized) {
    reasons.push("decision_ledger_not_initialized");
  }
  return {
    environment,
    enforced,
    ready: reasons.length === 0,
    reasons,
    components,
    build,
  };
}

async function resolvePostgresMajorVersion(config, options) {
  const configured = normalizePostgresMajorVerification(
    options.readiness?.postgresMajorVersion,
  );
  const environment = String(
    config.environment ||
    (config.production === true ? "production" : process.env.NODE_ENV) ||
    "development",
  ).toLowerCase();
  if (environment !== "production" || !config.databaseUrl) return configured;
  const probe = options.postgresMajorVersionProbe;
  const check = typeof probe === "function"
    ? probe
    : typeof probe?.check === "function"
      ? () => probe.check()
      : null;
  if (!check) return configured;
  try {
    return normalizePostgresMajorVerification(await check());
  } catch {
    return normalizePostgresMajorVerification(null);
  }
}

function setBounded(map, key, value, maximum = 5_000) {
  if (map.has(key)) map.delete(key);
  while (map.size >= maximum) map.delete(map.keys().next().value);
  map.set(key, value);
}

function attachAgentPresence(result, presence) {
  if (!presence) return result;
  const structured = result?.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)
    ? { ...result.structuredContent, agent_presence: presence }
    : { result: result?.structuredContent, agent_presence: presence };
  return {
    ...(result || {}),
    structuredContent: structured,
    _meta: {
      ...(result?._meta || {}),
      "skinharmony/agent_signature": presence.signature,
      "skinharmony/agent_signature_version": presence.signature_version,
    },
  };
}

function resolveWorkPreflight(result, payload) {
  const gate = result?.structuredContent?.gate;
  const authorizedByCoreGate = gate?.allowed === true;
  const allowedByPreflight = payload?.governance?.execution_allowed_by_preflight === true;
  if (!authorizedByCoreGate && !allowedByPreflight) return payload;
  return {
    ...payload,
    state: authorizedByCoreGate ? "completed_after_core_gate" : "completed_read_only",
    gate: gate ? {
      allowed: gate.allowed === true,
      decision: gate.decision || "unknown",
      mediation: gate.mediation || "unknown",
      owner_confirmation_required: gate.owner_confirmation_required === true,
      confirmation_satisfied: gate.confirmation_satisfied === true,
    } : payload?.gate,
    governance: {
      ...(payload?.governance || {}),
      execution_authorized_by_core_gate: authorizedByCoreGate,
      owner_confirmation_required: authorizedByCoreGate
        ? gate?.owner_confirmation_required === true && gate?.confirmation_satisfied !== true
        : payload?.governance?.owner_confirmation_required === true,
    },
  };
}

function attachWorkPreflight(result, preflight) {
  const originalPayload = preflight?.work_preflight || preflight;
  if (!originalPayload || result?.structuredContent?.work_preflight) return result;
  const resolvedPayload = resolveWorkPreflight(result, originalPayload);
  const payload = {
    schema_version: resolvedPayload.schema_version,
    preflight_id: resolvedPayload.preflight_id,
    tenant_id: resolvedPayload.tenant_id,
    state: resolvedPayload.state,
    mandatory: resolvedPayload.mandatory === true,
    core_runtime: resolvedPayload.core_runtime,
    governance: resolvedPayload.governance,
    gate: resolvedPayload.gate || result?.structuredContent?.gate,
    continuity: resolvedPayload.continuity
      ? {
        schema_version: resolvedPayload.continuity.schema_version,
        work_id: resolvedPayload.continuity.work_id,
        project_id: resolvedPayload.continuity.project_id,
        intent_digest: resolvedPayload.continuity.intent_digest,
        architecture_version: resolvedPayload.continuity.architecture_version,
        resumed: resolvedPayload.continuity.idempotent_replay === true,
      }
      : undefined,
    tool_routing: resolvedPayload.tool_routing?.preferred_route
      ? { preferred_route: resolvedPayload.tool_routing.preferred_route }
      : resolvedPayload.tool_routing,
    operational_surface: resolvedPayload.operational_surface,
    gallery_version: resolvedPayload.gallery_version,
    tenant_work_gallery: resolvedPayload.tenant_work_gallery,
    shared_memory_bootstrap: resolvedPayload.shared_memory_bootstrap
      ? {
        loaded: resolvedPayload.shared_memory_bootstrap.loaded === true,
        tenant_id: resolvedPayload.shared_memory_bootstrap.tenant_id,
        generated_at: resolvedPayload.shared_memory_bootstrap.generated_at,
        active_task_count: resolvedPayload.shared_memory_bootstrap.active_task_count,
        active_lock_count: resolvedPayload.shared_memory_bootstrap.active_lock_count,
        artifact_count: resolvedPayload.shared_memory_bootstrap.artifact_count,
      }
      : undefined,
  };
  const executionAllowed = payload?.governance?.execution_allowed_by_preflight === true ||
    payload?.governance?.execution_authorized_by_core_gate === true;
  const structured = result?.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)
    ? { ...result.structuredContent, work_preflight: payload }
    : { result: result?.structuredContent, work_preflight: payload };
  const summary = {
    mandatory_work_preflight: {
      preflight_id: payload.preflight_id,
      state: payload.state,
      preferred_route: payload.tool_routing?.preferred_route?.id,
      execution_allowed: executionAllowed,
      operational_surface: payload.operational_surface,
      gallery_state: payload.tenant_work_gallery?.state,
      shared_memory_bootstrap_loaded: payload.shared_memory_bootstrap?.loaded === true,
      work_id: payload.continuity?.work_id,
    },
  };
  return {
    ...(result || {}),
    structuredContent: structured,
    content: [
      ...(Array.isArray(result?.content) ? result.content : []),
      { type: "text", text: JSON.stringify(summary) },
    ],
    _meta: {
      ...(result?._meta || {}),
      "skinharmony/preflight_id": payload.preflight_id,
      "skinharmony/preflight_mandatory": true,
    },
  };
}

function securitySchemes(scopes) {
  return [{ type: "oauth2", scopes }];
}

function challenge(
  config,
  error = "invalid_token",
  scope = "",
  description = "Authentication is required to use this MCP resource",
  metadataPath = "/.well-known/oauth-protected-resource",
) {
  const metadata = `${config.publicUrl}${metadataPath}`;
  const safeDescription = String(description).replace(/["\\\r\n]/g, " ").slice(0, 160);
  return `Bearer resource_metadata="${metadata}", error="${error}", error_description="${safeDescription}"${scope ? `, scope="${scope}"` : ""}`;
}

const TOOL_FAILURE_STATUS_BY_CODE = Object.freeze({
  dynamic_capability_arguments_invalid: 422,
  dynamic_capability_query_required: 422,
  dynamic_capability_candidates_empty: 422,
  dynamic_capability_id_invalid: 422,
  dynamic_capability_reserved_argument: 422,
  dynamic_capability_arguments_too_large: 413,
  dynamic_capability_arguments_too_deep: 413,
  dynamic_capability_catalog_revision_mismatch: 409,
  dynamic_capability_unavailable: 404,
  dynamic_capability_read_only_required: 409,
  dynamic_capability_mutation_required: 409,
  dynamic_capability_not_authorized: 403,
  owner_confirmation_required: 403,
  idempotency_key_required: 422,
  continuity_capture_not_authorized: 403,
});

function inferredToolFailureStatus(code) {
  if (/_not_found$/.test(code)) return 404;
  if (/_(?:conflict|replayed|expired|revoked|closed|exhausted|limit_reached)$/.test(code)) return 409;
  if (/_(?:not_authorized|forbidden|denied)$/.test(code) ||
      /_(?:authorization|owner|host_policy)_required$/.test(code)) return 403;
  if (/_(?:invalid|required|mismatch|missing)$/.test(code)) return 422;
  return undefined;
}

function toolFailure(error) {
  const raw = String(error?.code || error?.message || "tool_execution_failed");
  const core = raw.match(/^core_request_failed:(\d{3}):([a-zA-Z0-9_-]+)$/);
  const mappedStatus = TOOL_FAILURE_STATUS_BY_CODE[raw];
  const status = Number(
    error?.status ?? (core ? core[1] : mappedStatus ?? inferredToolFailureStatus(raw) ?? 500),
  );
  const code = core?.[2] || (/^[a-zA-Z0-9_-]{3,80}$/.test(raw) ? raw : "tool_execution_failed");
  const retryable = error?.retryable === true ||
    status === 429 ||
    [502, 503, 504].includes(status) ||
    (Boolean(core) && status >= 500);
  const message = code === "dynamic_capability_arguments_invalid"
    ? "The capability arguments failed schema validation."
    : retryable
      ? "The governed backend is temporarily unavailable."
      : status >= 500
        ? "The governed request failed."
        : "The governed request was rejected.";
  const payload = {
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(Number.isFinite(status) ? { status } : {}),
    },
  };
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: true,
  };
}

export function createApp(config, options = {}) {
  const app = express();
  const authenticate = createAuthenticator(config, options);
  const handlers = options.handlers || {};
  const beforeToolCall = options.beforeToolCall;
  const afterToolCall = options.afterToolCall;
  const availableTools = TOOLS.filter((tool) => typeof handlers[tool.name] === "function");
  const visibleTools = options.toolSurface === "compact"
    ? compactMcpTools(TOOLS, handlers)
    : availableTools;
  // A host can rotate the MCP transport between tool calls from one logical chat.
  // Keep the transport binding for anti-switch protection, while correlating the
  // server-signed presence through the explicitly declared logical session id.
  // Client-provided ids are correlation data only and never grant authorization.
  const logicalSessionPresences = new Map();
  const transportPresenceBindings = new Map();
  app.use(express.json({ limit: "1mb" }));
  app.use((_req, res, next) => {
    res.set("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
    next();
  });

  app.get("/healthz", async (_req, res) => {
    const postgresMajorVersion = await resolvePostgresMajorVersion(
      config,
      options,
    );
    const readiness = buildReadiness(config, {
      ...options,
      readiness: {
        ...options.readiness,
        postgresMajorVersion,
      },
    });
    let researchAirlock = { core_ready: false, mode: "unknown", state_backend: "unavailable" };
    try {
      const response = await (options.fetchImpl || globalThis.fetch)(`${config.universalCoreUrl}/healthz`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(3_000),
      });
      const payload = await response.json();
      researchAirlock = {
        core_ready: response.ok && (
          payload?.research_airlock?.ready === true
          || (payload?.research_airlock?.mode === "shadow" && payload?.research_airlock?.operational_safe === true)
        ),
        mode: payload?.research_airlock?.mode || "unknown",
        state_backend: payload?.research_airlock?.state_backend || "unavailable",
        operational_safe: payload?.research_airlock?.operational_safe === true,
        build_commit_sha: payload?.build?.commit_sha || null,
      };
    } catch {
      researchAirlock = { core_ready: false, mode: "unavailable", state_backend: "unavailable" };
    }
    // Production MCP readiness must not depend on a mode value supplied by an
    // unreachable upstream. Once deployed, Core Airlock is a hard dependency:
    // unknown/unavailable is therefore unready, never an implicit opt-out.
    const airlockRequired = readiness.environment === "production";
    const combinedReady = readiness.ready && (!airlockRequired || researchAirlock.core_ready);
    const status = readiness.enforced && !combinedReady ? 503 : 200;
    return res.status(status).json({
    ok: !readiness.enforced || combinedReady,
    service: "skinharmony-core-mcp",
    version: SERVER_VERSION,
    build: readiness.build,
    mode: readiness.environment,
    render_ready: combinedReady,
    research_airlock: {
      ...researchAirlock,
      production_required: airlockRequired,
    },
    readiness: {
      enforced: readiness.enforced,
      ready: readiness.ready,
      reasons: readiness.reasons,
      components: readiness.components,
    },
    health_contract_version: HOST_NATIVE_HEALTH_CONTRACT_VERSION,
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    auth_configured: readiness.components.authentication.configured,
    tenant_membership_bindings: Object.keys(config.oauthTenantMemberships || {}).length,
    core_configured: readiness.components.universal_core.configured,
    owner_context_signing_configured: Boolean(config.ownerContextSigningSecret),
    tenant_context_signing_configured:
      readiness.components.host_native_security.tenant_context_signing_configured,
    postgresql: {
      major: readiness.components.postgresql_version.major,
      verified: readiness.components.postgresql_version.verified,
    },
    shared_memory_configured: Boolean(config.sharedMemoryRoot),
    cloud_memory: {
      configured: Boolean(config.databaseUrl),
      backend: config.databaseUrl ? "postgres" : "filesystem",
      persistent: Boolean(config.databaseUrl),
      tenant_isolated: true,
    },
    decision_ledger: {
      configured: Boolean(config.databaseUrl),
      required: config.decisionLedgerRequired === true,
      backend: config.databaseUrl ? "postgres_append_only" : "disabled",
      tenant_isolated: true,
      raw_prompts_stored: false,
    },
    work_continuity: {
      configured: Boolean(config.databaseUrl),
      enabled: Boolean(config.databaseUrl),
      backend: config.databaseUrl ? "postgres" : "disabled",
      persistent: Boolean(config.databaseUrl),
      schema_version: "work_continuity_v2",
      gallery_schema_version: "tenant_work_gallery_v1",
      auto_capture_enabled: config.workContinuityAutoCaptureEnabled === true,
      intent_anchor_redacted: true,
      raw_prompts_stored: false,
      tenant_isolated: true,
      bounded_leases: true,
      agent_ownership_allowed: false,
    },
    host_native_agents: {
      enabled: config.hostNativeAgentProtocolEnabled === true,
      readiness_required:
        readiness.components.host_native_security.required,
      tenant_gateway_configured:
        readiness.components.host_native_security.tenant_gateway_configured,
      owner_context_signing_configured:
        readiness.components.host_native_security.owner_context_signing_configured,
      tenant_context_signing_configured:
        readiness.components.host_native_security.tenant_context_signing_configured,
      dtt_identity_signing_configured:
        readiness.components.host_native_security.dtt_identity_signing_configured,
      agent_signature_configured:
        readiness.components.host_native_security.agent_signature_configured,
      agent_signature_independent:
        readiness.components.host_native_security.agent_signature_independent,
      ready: readiness.components.host_native_security.ready,
      provider_execution: false,
      provider_api_key_required: false,
      server_model_calls: 0,
      host_spawn_required: true,
      host_policy_override: false,
    },
    agent_workspace_configured: Boolean(config.agentWorkspaceRoot),
    memory_fabric_configured: Boolean(config.memoryFabricRoot),
    research_cortex_configured: Boolean(config.researchCortexRoot),
    suite_control_plane: {
      configured: Boolean(config.suiteControlPlaneUrl && Object.keys(config.suiteControlPlaneKeys || {}).length),
      tenant_bindings: Object.keys(config.suiteControlPlaneKeys || {}).length,
      execution_allowed: false,
    },
    nyra_god_mode: {
      configured: config.godModeEnabled === true,
      active: config.godModeEnabled === true && config.godModeEmergencyStop !== true,
      tenant_isolated: true,
      emergency_stop: config.godModeEmergencyStop === true
    }
  });
  });

  const protectedResourceMetadata = (_req, res) => res.json({
    // Keep one canonical OAuth resource/audience across versioned transport
    // paths. The versioned path exists only to give MCP clients a fresh
    // connector identity; Auth0 tokens are still issued for config.resource.
    resource: config.resource,
    authorization_servers: config.auth0Issuer ? [config.auth0Issuer] : [],
    scopes_supported: config.supportedScopes,
    bearer_methods_supported: ["header"],
    resource_documentation: `${config.publicUrl}/docs/auth`
  });
  app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp-v015", protectedResourceMetadata);
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    if (!config.auth0Issuer) return res.status(404).json({ error: "oauth_not_configured" });
    return res.json({
      issuer: config.auth0Issuer,
      authorization_endpoint: `${config.auth0Issuer}/authorize`,
      token_endpoint: `${config.auth0Issuer}/oauth/token`,
      jwks_uri: config.jwksUri,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"]
    });
  });

  app.post(["/mcp", "/mcp-v015"], async (req, res) => {
    const resourceMetadataPath = req.path === "/mcp-v015"
      ? "/.well-known/oauth-protected-resource/mcp-v015"
      : "/.well-known/oauth-protected-resource";
    let identity;
    try {
      identity = await authenticate(req.headers.authorization);
    } catch {
      res.set("WWW-Authenticate", challenge(
        config,
        "invalid_token",
        "",
        "Authentication is required to use this MCP resource",
        resourceMetadataPath,
      ));
      return res.status(401).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: -32001, message: "Unauthorized" } });
    }
    const { id = null, method, params = {} } = req.body || {};
    let activeToolCall = null;
    let afterToolCallAttempted = false;
    try {
      if (method === "initialize") {
        const sessionId = normalizeTransportSession(req.headers["mcp-session-id"]) || `mcp_${crypto.randomBytes(16).toString("hex")}`;
        res.set("Mcp-Session-Id", sessionId);
        return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "skinharmony-core-mcp", version: SERVER_VERSION }, instructions: SERVER_INSTRUCTIONS } });
      }
      if (method === "notifications/initialized") return res.status(202).end();
      if (method === "resources/list") return res.json({ jsonrpc: "2.0", id, result: { resources: [] } });
      if (method === "resources/read") return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown resource" } });
      if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: { tools: visibleTools.map(({ scopes, ...tool }) => {
        const schemes = securitySchemes(scopes);
        const genericPreflightRequired = requiresGenericWorkPreflight(tool.name);
        return {
          ...tool,
          securitySchemes: schemes,
          _meta: {
            ...(tool._meta || {}),
            securitySchemes: schemes,
            "skinharmony/scopes": scopes,
            ...(genericPreflightRequired ? { "skinharmony/mandatory_first_tool": "work_preflight" } : {}),
            ...(!genericPreflightRequired ? { "skinharmony/native_governance": "authenticated_tenant_control_plane" } : {}),
            "skinharmony/preflight_entrypoint": tool.name === "work_preflight",
            "skinharmony/shared_memory_lifecycle": "automatic_task_contract_and_checkpoint",
            "skinharmony/research_entrypoint": tool.name === "nyra_research_plan",
            "skinharmony/research_sequence": "plan -> host web -> ingest -> query -> feedback",
          },
        };
      }) } });
      if (method === "tools/call") {
        const tool = visibleTools.find((item) => item.name === params.name);
        if (!tool) return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } });
        requireScopes(identity, tool.scopes);
        if (!handlers[tool.name]) return res.json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Tool backend unavailable" } });
        const rawArgs = params.arguments || {};
        const validationErrors = validateToolArguments(tool.inputSchema, rawArgs);
        if (validationErrors.length) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: "Invalid tool arguments",
              data: { tool: tool.name, violations: validationErrors.slice(0, 20) },
            },
          });
        }
        if (identity.kind === "oauth" && identity.oauthOwnerBound === true &&
          OAUTH_OWNER_ELEVATION_TOOLS.has(tool.name) && rawArgs.owner_confirmed === true) {
          identity = authenticate.elevateOAuthOwner(identity, {
            confirmed: true,
            confirmationReference: rawArgs.confirmation_reference,
            requestBinding: ownerRequestBinding(tool.name, rawArgs),
          });
        }
        const transportSessionId = normalizeTransportSession(req.headers["mcp-session-id"]);
        const declaredSessionId = normalizeTransportSession(rawArgs.session_id);
        const transportPresence = transportSessionId
          ? transportPresenceBindings.get(transportSessionId)
          : null;
        // Some MCP hosts omit the optional transport session header on the first
        // call. Permit only bootstrap/diagnostic tools and issue a fresh opaque
        // session that the host can reuse. Stateful tools still fail closed, and
        // concurrent chats never collapse into one identity-derived session.
        const needsBootstrapSession = !transportSessionId && !declaredSessionId;
        if (needsBootstrapSession &&
          !SESSIONLESS_BOOTSTRAP_TOOLS.has(tool.name) &&
          !isAgentPresenceBootstrapCall(tool.name, rawArgs)) {
          const presenceError = new Error("agent_presence_session_required");
          presenceError.code = "agent_presence_session_required";
          throw presenceError;
        }
        const serverIssuedSessionId = needsBootstrapSession
          ? serverIssuedBootstrapSession()
          : "";
        if (
          transportPresence?.binding_source === "declared" &&
          declaredSessionId &&
          transportPresence.session_id !== declaredSessionId
        ) {
          const presenceError = new Error("agent_presence_conflict");
          presenceError.code = "agent_presence_conflict";
          throw presenceError;
        }
        const sessionId = transportPresence?.session_id || declaredSessionId || transportSessionId || serverIssuedSessionId;
        const serverIssuedBootstrap = Boolean(serverIssuedSessionId);
        const hostNativeReporterAgentId = tool.name === "work_continuity_native_report"
          ? rawArgs.native_agent_id
          : null;
        const requestedAgentId = (!serverIssuedBootstrap && (
          rawArgs.agent_id ||
          rawArgs.from_agent_id ||
          hostNativeReporterAgentId
        )) || transportPresence?.agent_id ||
          `agent_${crypto.createHash("sha256").update(`${identity.subject || identity.kind || "client"}\u0000${sessionId}`).digest("hex").slice(0, 20)}`;
        const presenceInput = {
          agent_id: requestedAgentId,
          client_type: (!serverIssuedBootstrap && rawArgs.client_type) || transportPresence?.client_type || inferClientType(identity),
          session_id: sessionId,
        };
        const agentPresence = createAgentPresence(config, identity, presenceInput);
        const transportAgentPresence = transportSessionId
          ? createAgentPresence(config, identity, {
              ...presenceInput,
              session_id: transportSessionId,
            })
          : null;
        const attestedAgentPresence = {
          ...agentPresence,
          // Keep the opaque logical session only on the server-side identity.
          // The mandatory presence hook needs it to renew the exact signed
          // session, while the public response can continue to omit it.
          session_id: sessionId,
          transport_bound: Boolean(transportAgentPresence),
          host_transport_session_fingerprint:
            transportAgentPresence?.session_fingerprint || null,
        };
        const logicalPresence = logicalSessionPresences.get(agentPresence.session_fingerprint);
        if (
          (transportPresence && transportPresence.signature !== agentPresence.signature) ||
          (logicalPresence && logicalPresence.signature !== agentPresence.signature)
        ) {
          const presenceError = new Error("agent_presence_conflict");
          presenceError.code = "agent_presence_conflict";
          throw presenceError;
        }
        const presenceBinding = {
          ...attestedAgentPresence,
          session_id: sessionId,
          binding_source: transportPresence?.binding_source || (declaredSessionId ? "declared" : transportSessionId ? "transport" : "server_bootstrap"),
        };
        setBounded(logicalSessionPresences, agentPresence.session_fingerprint, presenceBinding);
        if (transportSessionId || serverIssuedSessionId) {
          setBounded(transportPresenceBindings, sessionId, presenceBinding);
        }
        if (serverIssuedSessionId) res.set("Mcp-Session-Id", serverIssuedSessionId);
        const args = { ...rawArgs, ...presenceInput };
        // A request flag is never an identity assertion. Generic Core writes
        // still require verified owner-root confirmation; the two explicit
        // continuity bootstrap tools additionally accept a fresh, server-bound
        // OAuth tenant-owner elevation.
        const explicitOAuthOwnerConfirmation =
          OAUTH_OWNER_ELEVATION_TOOLS.has(tool.name) &&
          identity.oauthOwnerElevated === true &&
          args.owner_confirmed === true;
        const codexGoodModeHostNativeDelegation =
          ["host_native_delegation_issue", "host_native_delegation_revoke"].includes(tool.name) &&
          isCodexGoodModeDelegation(identity, config);
        const explicitOwnerConfirmation = (
          codexGoodModeHostNativeDelegation ||
          identity.godMode === true ||
          explicitOAuthOwnerConfirmation
        ) &&
          (codexGoodModeHostNativeDelegation || args.owner_confirmed === true);
        const callIdentity = {
          ...identity,
          agentPresence: presenceBinding,
          ownerConfirmed: explicitOwnerConfirmation,
          confirmationReference: explicitOwnerConfirmation
            ? (codexGoodModeHostNativeDelegation
              ? "god_mode_codex"
              : String(args.confirmation_reference || "").slice(0, 240))
            : "",
        };
        activeToolCall = { identity: callIdentity, toolName: tool.name, args, hookContext: null, preflight: null };
        let hookContext = null;
        if (typeof beforeToolCall === "function") {
          try {
            hookContext = await beforeToolCall({ identity: callIdentity, toolName: tool.name, args });
          } catch (error) {
            if (error?.hookContext) activeToolCall.hookContext = error.hookContext;
            throw error;
          }
        }
        const preflight = requiresGenericWorkPreflight(tool.name, args)
          ? (hookContext?.preflight ?? hookContext)
          : null;
        activeToolCall = { ...activeToolCall, hookContext, preflight };
        // The compact dynamic router accepts a preflight only at its wrapper
        // boundary. Resolve the server-issued envelope across the two valid
        // handler shapes and never inspect caller-supplied nested arguments.
        const serverIssuedPreflight = preflight?.work_preflight
          || preflight?.result?.work_preflight
          || (preflight?.schema_version === "skinharmony_work_preflight_v1" ? preflight : null);
        const handlerArgs = serverIssuedPreflight && !args.work_preflight
          ? { ...args, work_preflight: serverIssuedPreflight }
          : args;
        const rawResult = await handlers[tool.name](handlerArgs, callIdentity);
        const preflightResult = attachWorkPreflight(rawResult, preflight);
        const result = attachAgentPresence(preflightResult, agentPresence);
        if (typeof afterToolCall === "function") {
          afterToolCallAttempted = true;
          try {
            await afterToolCall({ identity: callIdentity, toolName: tool.name, args, result, preflight, hookContext });
          } catch (hookError) {
            if (tool.annotations?.readOnlyHint !== true) throw hookError;
          }
        }
        return res.json({ jsonrpc: "2.0", id, result });
      }
      return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    } catch (error) {
      if (["agent_presence_session_required", "agent_presence_conflict", "agent_presence_registration_required", "agent_presence_registration_failed"].includes(error.code)) {
        return res.status(error.code === "agent_presence_conflict" ? 409 : error.code === "agent_presence_registration_failed" ? 503 : 400).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: error.code },
        });
      }
      if (typeof afterToolCall === "function" && method === "tools/call" && !afterToolCallAttempted) {
        try {
          await afterToolCall(activeToolCall
            ? { ...activeToolCall, error }
            : { identity, toolName: params.name, args: params.arguments || {}, error });
        } catch {}
      }
      if (error.message === "insufficient_scope") {
        res.set("WWW-Authenticate", challenge(
          config,
          "insufficient_scope",
          error.missing.join(" "),
          "Authentication is required to use this MCP resource",
          resourceMetadataPath,
        ));
        return res.status(403).json({ jsonrpc: "2.0", id, error: { code: -32003, message: "Insufficient scope" } });
      }
      if (error.message === "owner_authentication_stale") {
        res.set("WWW-Authenticate", challenge(
          config,
          "invalid_token",
          "",
          "Fresh owner authentication is required; reconnect the OAuth session",
          resourceMetadataPath,
        ));
        return res.status(401).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32001, message: "Fresh owner authentication is required" },
        });
      }
      if (error.message === "memory_checksum_mismatch") {
        return res.status(400).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "memory_checksum_mismatch" },
        });
      }
      if (method === "tools/call") return res.json({ jsonrpc: "2.0", id, result: toolFailure(error) });
      return res.status(500).json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } });
    }
  });
  return app;
}

export { attachWorkPreflight, buildIdentity, inferClientType, resolveWorkPreflight, securitySchemes, serverIssuedBootstrapSession, toolFailure, TOOLS };

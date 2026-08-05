import crypto from "node:crypto";
import express from "express";
import { OPENAI_PROVIDER_SETUP_WIDGET, OPENAI_PROVIDER_SETUP_WIDGET_URI } from "./openai-provider-setup-widget.js";
import { createAuthenticator, ownerRequestBinding, requireScopes } from "./auth.js";
import { TOOLS } from "./tool-definitions.js";
import { createAgentPresence } from "./agent-presence.js";
import { validateToolArguments } from "./schema-validation.js";
import { compactMcpTools } from "./dynamic-capability-router.js";
import { signEnvironmentDelegation, verifyEnvironmentDelegation } from "./environment-delegation.js";

const SERVER_VERSION = "0.15.0-stable-dynamic-capabilities";
const SERVER_INSTRUCTIONS = "SkinHarmony Nyra & Core is installed as a ChatGPT connector. IMPORTANT: the MCP address is technical and must never be opened in Safari or pasted as a normal web link. FIRST INSTALLATION ONLY: in ChatGPT open Settings > Apps & connectors > Advanced settings, enable Developer Mode, choose Create app / Add MCP server, name it SkinHarmony Nyra & Core, paste exactly https://skinharmony-core-mcp.onrender.com/mcp as the server URL, select OAuth and tap Connect. Complete the OAuth screen that ChatGPT opens. If the connector is already present in Apps & connectors, do not add it again: start a new normal chat, select SkinHarmony Nyra & Core from the + menu, and use it there. WHAT IT DOES: Nyra interprets requests, plans bounded specialist work and summarizes; Universal Core enforces tenant isolation, budget, audit, cancellation and final governance. PROVIDER ONBOARDING: ChatGPT/Codex subscriptions are separate from OpenAI API credits. At the start of every connected conversation call tenant_provider_openai_status. If OpenAI is not configured, open tenant_provider_openai_setup_panel and offer only Collega API key or Non ora. Never ask for or accept an API key in chat or a tool argument: it is entered only on the protected one-time Core page and stored encrypted per tenant. LIVE MULTI-AGENT TEST: this dedicated provider flow is governed natively and does not use work_preflight or the generic shared-memory bootstrap. Treat configured=true plus execution_available=true (also reported as bounded_execution_ready=true) as ready even though the global execution_enabled flag remains false by design. Missing canonical shared-memory files and owner_confirmation_satisfied=false from a separate generic preflight do not deny this fixed flow. If a configured tenant owner explicitly asks to test real multi-agent work, explain that it makes at most three billable sequential calls, then call tenant_provider_openai_multi_agent_smoke_run directly with owner_confirmed=true. It returns a run id immediately and runs only Researcher → Reviewer → Nyra Synthesizer, with a fixed low budget, learning frozen, no browser, no tools, no external actions and no retries. Use tenant_provider_openai_multi_agent_run_read to poll status or read the owner-only result, and tenant_provider_openai_multi_agent_run_cancel to stop it; cancellation propagates immediately to the active call and every remaining stage. Never call work_preflight before provider status, setup, bounded start, read or cancel. All generic-agent and queue workflows remain manual_dry_run unless this dedicated bounded tool is explicitly used. RESEARCH: for current external evidence outside this fixed run, call nyra_research_plan, use the host ChatGPT or Codex web tool, then ingest reviewed evidence; never treat browsing as part of the three-agent run. HOW TO BUILD AN AGENT: define a narrow role, bounded input, owner-confirmed action, audit and cancellation. AUTOMATIC: generic flows use preflight and shared memory; the provider test uses tenant isolation, a request-bound owner proof, audit, cancellation and the fixed handoff sequence. NOT AUTOMATIC: deploying, browsing, external actions, or generic-agent execution. PRIVACY: Never include secrets, raw customer data or full pages; identity comes only from OAuth and only reviewed evidence enters Nyra memory.";

export const GENERIC_PREFLIGHT_EXEMPT_TOOLS = new Set([
  "work_preflight",
  "core_health",
  "nyra_branch_catalog",
  "core_capability_catalog",
  "core_branch_registry",
  "core_semantic_select",
  "core_capability_read",
  "core_capability_invoke",
  "tenant_provider_openai_status",
  "tenant_provider_openai_setup_panel",
  "tenant_provider_openai_setup_link",
  "tenant_provider_openai_multi_agent_smoke_run",
  "tenant_provider_openai_multi_agent_run_read",
  "tenant_provider_openai_multi_agent_run_cancel",
  "orchestration_dtt_core_join",
]);

export function requiresGenericWorkPreflight(toolName) {
  return !GENERIC_PREFLIGHT_EXEMPT_TOOLS.has(String(toolName || ""));
}
const SESSIONLESS_BOOTSTRAP_TOOLS = new Set([
  "work_preflight",
  "core_health",
  "nyra_branch_catalog",
  "core_capability_catalog",
  "core_branch_registry",
  "core_semantic_select",
  "core_capability_read",
  "tenant_provider_openai_status",
  "tenant_provider_openai_setup_panel",
]);
const OAUTH_OWNER_ELEVATION_TOOLS = new Set([
  "core_gate_action",
  "core_capability_invoke",
  "tenant_provider_openai_setup_link",
  "tenant_provider_openai_multi_agent_smoke_run",
  "tenant_provider_openai_multi_agent_run_read",
  "tenant_provider_openai_multi_agent_run_cancel",
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
    tool_routing: resolvedPayload.tool_routing?.preferred_route
      ? { preferred_route: resolvedPayload.tool_routing.preferred_route }
      : resolvedPayload.tool_routing,
    shared_memory_bootstrap: resolvedPayload.shared_memory_bootstrap
      ? {
        loaded: resolvedPayload.shared_memory_bootstrap.loaded === true,
        tenant_id: resolvedPayload.shared_memory_bootstrap.tenant_id,
        generated_at: resolvedPayload.shared_memory_bootstrap.generated_at,
        active_task_count: resolvedPayload.shared_memory_bootstrap.active_task_count,
        active_lock_count: resolvedPayload.shared_memory_bootstrap.active_lock_count,
        artifact_count: resolvedPayload.shared_memory_bootstrap.artifact_count,
        checksum: resolvedPayload.shared_memory_bootstrap.checksum,
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
      shared_memory_bootstrap_loaded: payload.shared_memory_bootstrap?.loaded === true,
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

function attachProviderOnboarding(result, providerStatus) {
  const provider = providerStatus?.structuredContent?.provider;
  if (!provider || provider.configured === true) return result;
  const structured = result?.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)
    ? { ...result.structuredContent, provider_onboarding: { required: true, provider: "openai", execution_enabled: false } }
    : { result: result?.structuredContent, provider_onboarding: { required: true, provider: "openai", execution_enabled: false } };
  return {
    ...(result || {}),
    structuredContent: structured,
    _meta: { ...(result?._meta || {}), "openai/outputTemplate": "ui://skinharmony/openai-provider-setup.html" },
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

const NON_RETRYABLE_CONFLICT_CODES = new Set([
  "collaboration_receipt_expired_or_replayed",
  "workspace_lock_conflict",
  "workspace_lock_lost",
  "workspace_lock_required",
  "workspace_version_conflict",
  "idempotency_conflict",
  "idempotency_in_progress",
  "task_lease_conflict",
  "task_lease_lost",
]);

function domainFailureStatus(code) {
  if (NON_RETRYABLE_CONFLICT_CODES.has(code) || /(?:^|_)(?:conflict|replayed)$/.test(code)) return 409;
  if (code === "core_gate_denied" ||
      /^collaboration_receipt_(?:binding|claims|digest|evidence|signature|scope|independent|issuer|kid).*invalid$/.test(code) ||
      /^(?:core|nyra)_collaboration_(?:claims|signature|issuer|kid).*invalid$/.test(code) ||
      /_collaboration_issuer_(?:auth_required|forbidden|rejected)$/.test(code)) return 403;
  if (/(?:_invalid|_required|_mismatch)$/.test(code)) return 400;
  return 500;
}

function toolFailure(error) {
  const raw = String(error?.code || error?.message || "tool_execution_failed");
  const core = raw.match(/^core_request_failed:(\d{3}):([a-zA-Z0-9_.-]{1,80})$/);
  const code = core?.[2] || (/^[a-zA-Z0-9_-]{3,80}$/.test(raw) ? raw : "tool_execution_failed");
  const explicitStatus = Number(error?.status || (core ? core[1] : 0));
  const status = Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599
    ? explicitStatus
    : domainFailureStatus(code);
  const retryable = typeof error?.retryable === "boolean"
    ? error.retryable
    : status === 429 || status >= 500;
  const payload = {
    ok: false,
    error: {
      code,
      message: retryable ? "The governed backend is temporarily unavailable." : "The governed request was rejected.",
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

const POSTGRES_REQUIRED_INPUTS = Object.freeze({
  workspace_create_folder: ["idempotency_key", "lock_id", "fencing_token"],
  workspace_write_document: ["expected_version", "idempotency_key", "lock_id", "fencing_token"],
  memory_append: ["idempotency_key"],
  memory_checkpoint: ["idempotency_key"],
  memory_handoff: ["idempotency_key"],
  task_create: ["idempotency_key"],
  task_update: ["lease_token", "fencing_token"],
  message_post: ["to_agent_id", "idempotency_key"],
});

const PROGRESSIVE_COORDINATION_TOOLS = new Set([
  "agent_heartbeat",
  "task_create",
  "task_claim",
  "workspace_lock_acquire",
]);

function configureToolForRuntime(tool, config) {
  // A connected client must select its target explicitly.  Until the
  // server-to-server staging delegation is configured, staging remains
  // fail-closed rather than silently executing on this production gateway.
  const environmentRequired = config.environmentRoutingRequired === true;
  const environmentSchema = environmentRequired ? {
    ...tool.inputSchema,
    properties: {
      ...(tool.inputSchema?.properties || {}),
      environment: {
        type: "string",
        enum: ["production", "staging"],
        description: "Explicit target environment. The gateway never defaults or falls back between environments.",
      },
    },
    required: [...new Set([...(tool.inputSchema?.required || []), "environment"])],
  } : tool.inputSchema;
  const configuredTool = environmentRequired ? { ...tool, inputSchema: environmentSchema } : tool;
  if (!config.collaborationDatabaseUrl) return configuredTool;
  const required = (POSTGRES_REQUIRED_INPUTS[tool.name] || []).filter((field) =>
    config.collaborationLocksRequired !== false || !["lock_id", "fencing_token"].includes(field));
  if (!required.length) return configuredTool;
  return {
    ...configuredTool,
    inputSchema: {
      ...configuredTool.inputSchema,
      required: [...new Set([...(configuredTool.inputSchema?.required || []), ...required])],
    },
  };
}

function coordinationGovernanceContext(config, tool, preflight, hookContext, identity) {
  if (!config.collaborationDatabaseUrl || tool?.annotations?.readOnlyHint === true ||
      !requiresGenericWorkPreflight(tool?.name)) return null;
  if (config.coordinationReceiptVerifierReady !== true) {
    throw new Error("collaboration_signed_receipt_verifier_required");
  }
  const payload = preflight?.work_preflight || preflight || {};
  const bootstrap = payload.shared_memory_bootstrap || preflight?.shared_memory_bootstrap;
  const preflightId = String(payload.preflight_id || "").trim();
  const traceId = String(hookContext?.ledgerContext?.traceId || "").trim();
  const taskContract = bootstrap?.task_contract;
  const coordinationLock = bootstrap?.coordination_lock;
  const presence = identity?.agentPresence || {};
  const progressive = PROGRESSIVE_COORDINATION_TOOLS.has(tool.name);
  if (payload.tenant_id !== identity.tenantId || bootstrap?.tenant_id !== identity.tenantId) {
    throw new Error("preflight_tenant_mismatch");
  }
  if (config.collaborationTaskContractRequired !== false) {
    if (!preflightId) throw new Error("collaboration_task_contract_required");
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(traceId)) {
      throw new Error("collaboration_trace_required");
    }
    if (bootstrap?.loaded !== true) throw new Error("shared_memory_bootstrap_required");
    if (!/^[a-f0-9]{64}$/.test(String(bootstrap.checksum || ""))) throw new Error("shared_memory_checksum_required");
    if (!Number.isSafeInteger(Number(bootstrap.active_task_count)) || Number(bootstrap.active_task_count) < 0 ||
        !Number.isSafeInteger(Number(bootstrap.active_lock_count)) || Number(bootstrap.active_lock_count) < 0) {
      throw new Error("shared_memory_bootstrap_invalid");
    }
    if (progressive && (!presence.agent_id || !presence.session_id ||
        !presence.signature || !presence.session_fingerprint)) {
      throw new Error("agent_presence_required");
    }
    if (taskContract && (!taskContract.contract_id || !taskContract.trace_id || taskContract.status !== "current" ||
        !Number.isFinite(Date.parse(taskContract.updated_at)))) {
      throw new Error("collaboration_task_contract_required");
    }
    if (taskContract && (taskContract.agent_id !== presence.agent_id || taskContract.session_id !== presence.session_id ||
        taskContract.agent_signature !== presence.signature ||
        taskContract.session_fingerprint !== presence.session_fingerprint)) {
      throw new Error("collaboration_task_contract_identity_mismatch");
    }
    if (!taskContract && (!progressive || tool.name === "workspace_lock_acquire")) {
      throw new Error("collaboration_task_contract_required");
    }
    if (coordinationLock && (!taskContract || !coordinationLock.name ||
        coordinationLock.trace_id !== taskContract.trace_id)) {
      throw new Error("collaboration_lock_required");
    }
    if (coordinationLock && !Number.isFinite(Date.parse(coordinationLock.acquired_at))) {
      throw new Error("collaboration_lock_required");
    }
    if (coordinationLock && (coordinationLock.agent_id !== presence.agent_id ||
        coordinationLock.session_id !== presence.session_id ||
        coordinationLock.agent_signature !== presence.signature ||
        coordinationLock.session_fingerprint !== presence.session_fingerprint)) {
      throw new Error("collaboration_lock_identity_mismatch");
    }
    if (!coordinationLock && !progressive) throw new Error("collaboration_lock_required");
    const governance = payload.governance || {};
    if (governance.core_verdict_required_before_execution !== true ||
        governance.direct_connector_bypass_forbidden_by_protocol !== true ||
        governance.cross_tenant_actions_allowed !== false || governance.audit_required !== true) {
      throw new Error("collaboration_preflight_invalid");
    }
  }
  return {
    tool_name: tool.name,
    preflight_id: preflightId || null,
    trace_id: traceId || null,
    shared_memory_checksum: bootstrap?.checksum || null,
    task_contract_id: taskContract?.contract_id || `mcp-enrollment:${presence.agent_id}`,
    task_trace_id: taskContract?.trace_id || traceId,
    coordination_lock: coordinationLock?.name || `mcp-enrollment:${presence.agent_id}`,
  };
}

function attachPostCallWarning(result, readOnly) {
  const field = readOnly ? "post_call_audit" : "post_commit_journal";
  const state = readOnly ? "read_succeeded_audit_degraded" : "committed_journal_degraded";
  const warning = { ok: false, retry_tool: false, state };
  return {
    ...(result || {}),
    structuredContent: result?.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)
      ? { ...result.structuredContent, [field]: warning }
      : { result: result?.structuredContent, [field]: warning },
    content: [
      ...(Array.isArray(result?.content) ? result.content : []),
      { type: "text", text: JSON.stringify({ [field]: warning }) },
    ],
    _meta: { ...(result?._meta || {}), [`skinharmony/${field}`]: "degraded" },
  };
}

export function createApp(config, options = {}) {
  const app = express();
  const authenticate = createAuthenticator(config, options);
  const handlers = options.handlers || {};
  const beforeToolCall = options.beforeToolCall;
  const afterToolCall = options.afterToolCall;
  const postgresGovernedSurface = Boolean(config.collaborationDatabaseUrl);
  const availableTools = TOOLS.filter((tool) => typeof handlers[tool.name] === "function")
    .map((tool) => configureToolForRuntime(tool, config));
  // The dynamic mutation wrapper invokes its target handler internally, so the
  // outer MCP lifecycle hooks would otherwise see only core_capability_invoke.
  // PostgreSQL coordination requires those hooks and the derived receipt context
  // on the actual write. Expose direct, runtime-configured tools in that isolated
  // mode and disable only the unsafe mutation wrapper; compact routing remains
  // unchanged for the production connector without the staging database.
  const directlyInvokableTools = postgresGovernedSurface
    ? availableTools.filter((tool) => tool.name !== "core_capability_invoke")
    : availableTools;
  const visibleTools = options.toolSurface === "compact" && !postgresGovernedSurface
    ? compactMcpTools(directlyInvokableTools, handlers)
    : directlyInvokableTools;
  // A host can rotate the MCP transport between tool calls from one logical chat.
  // Keep the transport binding for anti-switch protection, while correlating the
  // server-signed presence through the explicitly declared logical session id.
  // Client-provided ids are correlation data only and never grant authorization.
  const logicalSessionPresences = new Map();
  const transportPresenceBindings = new Map();
  const consumedEnvironmentDelegations = new Map();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", async (_req, res) => {
    let coordinationAvailable = !config.collaborationDatabaseUrl || config.coordinationDatabaseVerified === true;
    if (config.collaborationDatabaseUrl && coordinationAvailable && typeof options.coordinationHealthCheck === "function") {
      try { coordinationAvailable = await options.coordinationHealthCheck() === true; }
      catch { coordinationAvailable = false; }
    }
    const receiptVerifierReady = !config.collaborationDatabaseUrl || config.coordinationReceiptVerifierReady === true;
    let issuerAvailable = !config.collaborationDatabaseUrl;
    if (config.collaborationDatabaseUrl && receiptVerifierReady && typeof options.coordinationIssuerHealthCheck === "function") {
      try { issuerAvailable = await options.coordinationIssuerHealthCheck() === true; }
      catch { issuerAvailable = false; }
    }
    const ok = !config.collaborationDatabaseUrl || (coordinationAvailable && receiptVerifierReady && issuerAvailable);
    return res.status(ok ? 200 : 503).json({
    ok,
    service: "skinharmony-core-mcp",
    version: SERVER_VERSION,
    build: buildIdentity(),
    mode: process.env.NODE_ENV || "development",
    auth_configured: Boolean(config.auth0Issuer || config.codexKeys.length),
    core_configured: Boolean(config.universalCoreKey || Object.keys(config.universalCoreKeys || {}).length),
    provider_setup_link_source_configured: config.providerSetupLinkSourceConfigured === true,
    owner_context_signing_configured: Boolean(config.ownerContextSigningSecret),
    shared_memory_configured: Boolean(config.sharedMemoryRoot),
    cloud_memory: {
      configured: Boolean(config.cloudMemoryDatabaseUrl ?? config.databaseUrl),
      backend: (config.cloudMemoryDatabaseUrl ?? config.databaseUrl) ? "postgres" : "filesystem",
      persistent: Boolean(config.cloudMemoryDatabaseUrl ?? config.databaseUrl),
      tenant_isolated: true,
    },
    decision_ledger: {
      configured: Boolean(config.decisionLedgerDatabaseUrl || config.databaseUrl),
      required: config.decisionLedgerRequired === true,
      backend: (config.decisionLedgerDatabaseUrl || config.databaseUrl) ? "postgres_append_only" : "disabled",
      tenant_isolated: true,
      raw_prompts_stored: false,
    },
    agent_workspace_configured: Boolean(config.agentWorkspaceRoot || config.collaborationDatabaseUrl),
    memory_fabric_configured: Boolean(config.memoryFabricRoot || config.collaborationDatabaseUrl),
    coordination_store: {
      configured: Boolean(config.agentWorkspaceRoot || config.collaborationDatabaseUrl),
      backend: config.collaborationDatabaseUrl ? "postgres" : config.agentWorkspaceRoot ? "filesystem" : "disabled",
      persistent: Boolean(config.collaborationDatabaseUrl),
      distributed_locks: Boolean(config.collaborationDatabaseUrl),
      fencing_tokens: Boolean(config.collaborationDatabaseUrl),
      available: config.collaborationDatabaseUrl ? coordinationAvailable : Boolean(config.agentWorkspaceRoot),
      schema_verified: config.collaborationDatabaseUrl ? config.coordinationDatabaseVerified === true : null,
      signed_receipts_required: Boolean(config.collaborationDatabaseUrl),
      signed_receipt_verifier_ready: config.collaborationDatabaseUrl ? receiptVerifierReady : null,
      signed_receipt_issuers_reachable: config.collaborationDatabaseUrl ? issuerAvailable : null,
      runtime_probe: config.collaborationDatabaseUrl && typeof options.coordinationHealthCheck === "function"
        ? coordinationAvailable
        : null,
      tenant_isolated: true,
      filesystem_fallback: config.collaborationDatabaseUrl ? false : Boolean(config.agentWorkspaceRoot),
    },
    research_cortex_configured: Boolean(config.researchCortexRoot),
    openai_research_fallback_enabled: config.openaiResearchEnabled === true,
    openai_research_fallback_configured: Boolean(config.openaiApiKey),
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
      const delegation = req.headers["x-skinharmony-environment-delegation"];
      if (delegation) {
        if (config.environmentDelegationReceiverEnabled !== true) throw new Error("environment_delegation_disabled");
        const verified = verifyEnvironmentDelegation(delegation, {
          key: config.environmentDelegationKey,
          expectedTarget: "staging",
          consumed: consumedEnvironmentDelegations,
        });
        if (req.body?.method === "tools/call" && verified.toolName !== req.body?.params?.name) throw new Error("environment_delegation_invalid");
        identity = verified.identity;
      } else {
        identity = await authenticate(req.headers.authorization);
      }
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
      if (method === "resources/list") return res.json({ jsonrpc: "2.0", id, result: { resources: [{
        uri: OPENAI_PROVIDER_SETUP_WIDGET_URI,
        name: "Collega OpenAI a Nyra",
        title: "Collega OpenAI",
        description: "Pannello fisso per creare un link monouso e inserire la chiave solo nella pagina protetta.",
        mimeType: "text/html;profile=mcp-app",
      }] } });
      if (method === "resources/read") {
        if (params.uri !== OPENAI_PROVIDER_SETUP_WIDGET_URI) return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown resource" } });
        return res.json({ jsonrpc: "2.0", id, result: { contents: [{
          uri: OPENAI_PROVIDER_SETUP_WIDGET_URI,
          mimeType: "text/html;profile=mcp-app",
          text: OPENAI_PROVIDER_SETUP_WIDGET,
          _meta: { "openai/widgetDescription": "A fixed secure setup panel for the user's own OpenAI API key.", "openai/widgetPrefersBorder": true },
        }] } });
      }
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
            "skinharmony/shared_memory_lifecycle": config.collaborationDatabaseUrl
              ? "automatic_receipted_task_contract_and_checkpoint"
              : "automatic_task_contract_and_checkpoint",
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
        const requestedEnvironment = rawArgs.environment;
        if (config.environmentRoutingRequired === true && requestedEnvironment === "staging") {
          const forwardedArgs = { ...rawArgs };
          delete forwardedArgs.environment;
          const delegation = signEnvironmentDelegation({
            identity,
            toolName: tool.name,
            key: config.environmentDelegationKey,
          });
          let upstream;
          try {
            upstream = await fetch(`${config.stagingMcpUrl}/mcp`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "application/json",
                "x-skinharmony-environment-delegation": delegation,
                ...(req.headers["mcp-session-id"] ? { "mcp-session-id": String(req.headers["mcp-session-id"]) } : {}),
              },
              body: JSON.stringify({ ...req.body, params: { ...params, arguments: forwardedArgs } }),
            });
          } catch {
            const error = new Error("staging_delegation_unavailable");
            error.code = "staging_delegation_unavailable";
            throw error;
          }
          const body = await upstream.json().catch(() => null);
          if (!body) {
            const error = new Error("staging_delegation_unavailable");
            error.code = "staging_delegation_unavailable";
            throw error;
          }
          const upstreamSession = upstream.headers.get("mcp-session-id");
          if (upstreamSession) res.set("Mcp-Session-Id", upstreamSession);
          return res.status(upstream.status).json(body);
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
        if (needsBootstrapSession && !SESSIONLESS_BOOTSTRAP_TOOLS.has(tool.name)) {
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
        const requestedAgentId = (!serverIssuedBootstrap && (rawArgs.agent_id || rawArgs.from_agent_id)) || transportPresence?.agent_id ||
          `agent_${crypto.createHash("sha256").update(`${identity.subject || identity.kind || "client"}\u0000${sessionId}`).digest("hex").slice(0, 20)}`;
        const presenceInput = {
          agent_id: requestedAgentId,
          client_type: (!serverIssuedBootstrap && rawArgs.client_type) || transportPresence?.client_type || inferClientType(identity),
          session_id: sessionId,
        };
        const agentPresence = createAgentPresence(config, identity, presenceInput);
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
          ...agentPresence,
          session_id: sessionId,
          binding_source: transportPresence?.binding_source || (declaredSessionId ? "declared" : transportSessionId ? "transport" : "server_bootstrap"),
        };
        setBounded(logicalSessionPresences, agentPresence.session_fingerprint, presenceBinding);
        if (transportSessionId || serverIssuedSessionId) {
          setBounded(transportPresenceBindings, sessionId, presenceBinding);
        }
        if (serverIssuedSessionId) res.set("Mcp-Session-Id", serverIssuedSessionId);
        const args = { ...rawArgs, ...presenceInput };
        delete args.environment;
        // A request flag is never an identity assertion. Generic Core writes
        // still require verified owner-root confirmation. The bounded provider
        // test has a deliberately narrower, separate tenant-OAuth-owner proof.
        const explicitCoreGovernanceConfirmation = [
          "core_capability_invoke",
          "core_gate_action",
        ].includes(tool.name) &&
          identity.oauthOwnerElevated === true &&
          args.owner_confirmed === true;
        const explicitOwnerConfirmation = (identity.godMode === true || explicitCoreGovernanceConfirmation) &&
          args.owner_confirmed === true;
        const explicitProviderExecutionConfirmation = identity.kind === "oauth" &&
          identity.providerSetupOwner === true &&
          Boolean(String(identity.subject || "").trim()) &&
          args.owner_confirmed === true;
        const callIdentity = {
          ...identity,
          agentPresence: presenceBinding,
          ownerConfirmationClaimed: args.owner_confirmed === true,
          ownerConfirmed: explicitOwnerConfirmation,
          confirmationReference: explicitOwnerConfirmation
            ? String(args.confirmation_reference || "").slice(0, 240)
            : "",
          providerExecutionConfirmed: explicitProviderExecutionConfirmation,
          providerExecutionConfirmationReference: explicitProviderExecutionConfirmation
            ? String(args.confirmation_reference || "").slice(0, 240)
            : "",
        };
        activeToolCall = {
          identity: callIdentity,
          toolName: tool.name,
          args,
          hookContext: null,
          preflight: null,
          toolAnnotations: tool.annotations,
        };
        let hookContext = null;
        if (typeof beforeToolCall === "function") {
          try {
            hookContext = await beforeToolCall({ identity: callIdentity, toolName: tool.name, args });
          } catch (error) {
            const failureHookContext = error?.hookContext || error?.toolHookContext;
            if (failureHookContext) activeToolCall.hookContext = failureHookContext;
            throw error;
          }
        }
        // Provider setup and the fixed bounded run have their own authenticated
        // Core gates. Even if a host hook accidentally returns a generic
        // preflight, never attach that unrelated shared-memory verdict to these
        // native control-plane results.
        const preflight = requiresGenericWorkPreflight(tool.name)
          ? (hookContext?.preflight ?? hookContext)
          : null;
        activeToolCall = { ...activeToolCall, hookContext, preflight };
        const governanceContext = coordinationGovernanceContext(config, tool, preflight, hookContext, callIdentity);
        const executionIdentity = governanceContext ? { ...callIdentity, governanceContext } : callIdentity;
        activeToolCall = { ...activeToolCall, identity: executionIdentity };
        const rawResult = await handlers[tool.name](args, executionIdentity);
        let result = attachAgentPresence(attachProviderOnboarding(attachWorkPreflight(rawResult, preflight), hookContext?.providerStatus), agentPresence);
        if (typeof afterToolCall === "function") {
          afterToolCallAttempted = true;
          try {
            await afterToolCall({
              identity: executionIdentity,
              toolName: tool.name,
              args,
              result,
              preflight,
              hookContext,
              toolAnnotations: tool.annotations,
            });
          } catch (hookError) {
            result = attachPostCallWarning(result, tool.annotations?.readOnlyHint === true);
          }
        }
        return res.json({ jsonrpc: "2.0", id, result });
      }
      return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    } catch (error) {
      if (["agent_presence_session_required", "agent_presence_conflict"].includes(error.code)) {
        return res.status(error.code === "agent_presence_conflict" ? 409 : 400).json({
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

export {
  attachProviderOnboarding,
  attachWorkPreflight,
  buildIdentity,
  configureToolForRuntime,
  coordinationGovernanceContext,
  inferClientType,
  resolveWorkPreflight,
  securitySchemes,
  serverIssuedBootstrapSession,
  toolFailure,
  TOOLS,
};

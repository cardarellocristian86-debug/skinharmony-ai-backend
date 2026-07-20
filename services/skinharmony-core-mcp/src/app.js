import crypto from "node:crypto";
import express from "express";
import { OPENAI_PROVIDER_SETUP_WIDGET, OPENAI_PROVIDER_SETUP_WIDGET_URI } from "./openai-provider-setup-widget.js";
import { createAuthenticator, requireScopes } from "./auth.js";
import { TOOLS } from "./tool-definitions.js";
import { createAgentPresence } from "./agent-presence.js";
import { validateToolArguments } from "./schema-validation.js";

const SERVER_VERSION = "0.11.3-governed-outcomes";
const SERVER_INSTRUCTIONS = "SkinHarmony Nyra & Core is installed as a ChatGPT connector. IMPORTANT: the MCP address is technical and must never be opened in Safari or pasted as a normal web link. FIRST INSTALLATION ONLY: in ChatGPT open Settings > Apps & connectors > Advanced settings, enable Developer Mode, choose Create app / Add MCP server, name it SkinHarmony Nyra & Core, paste exactly https://skinharmony-core-mcp.onrender.com/mcp as the server URL, select OAuth and tap Connect. Complete the OAuth screen that ChatGPT opens. If the connector is already present in Apps & connectors, do not add it again: just start a new normal chat, select SkinHarmony Nyra & Core from the + menu, and use it there. WHAT IT DOES: Nyra interprets requests, plans bounded specialist work, researches, coordinates branches and summarizes; Universal Core enforces tenant isolation, budget, evidence, cancellation and final governance. HOW TO BUILD AN AGENT: the user describes goal, expected output, constraints, deadline and whether work is research, analysis or planning. Call work_preflight first, then use the governed generic-agent/orchestration tools to create a bounded plan. Keep fan-out at three or fewer and explain the plan before any sensitive step. AUTOMATIC: tenant-scoped memory recall, preflight, routing, plan persistence, dependency ordering, queue/retry/cancellation controls, audit and dry-run worker simulation. NOT AUTOMATIC: model-provider calls, browser/tool side effects, customer contact, payments, publishing, deployments, data deletion and other external actions; these stay disabled or require an explicit Core verdict and owner confirmation. CURRENT MODE: worker execution is manual_dry_run only, so no model, API, tool or external action is invoked and no tenant incurs AI API cost. PROVIDER ONBOARDING: ChatGPT/Codex subscriptions are separate from API credits. At the start of every new connected conversation, call tenant_provider_openai_status before work. If the tenant has no configured OpenAI key, immediately call tenant_provider_openai_setup_panel and show only two simple choices: Collega API key or Non ora. Never ask a user to paste or reveal an API key in ChatGPT or a tool argument. When the user says crea agenti, collega API key, collega OpenAI, abilita OpenAI, configura provider, or any equivalent, call tenant_provider_openai_status first: if the key is missing, open tenant_provider_openai_setup_panel; if it is configured, continue with the requested work. secure link setup: the panel creates the one-time secure link automatically after the user presses Collega API key. The key is entered only on the Core page outside chat, stored encrypted, and returns only masked status. Link issuance does not enable provider execution. RESEARCH: call nyra_research_plan, use the host ChatGPT or Codex web tool, then submit short sourced evidence with nyra_research_ingest. PRIVACY: Never include secrets, raw customer data or full pages; identity comes only from OAuth and only reviewed evidence enters Nyra memory.";
const SESSIONLESS_BOOTSTRAP_TOOLS = new Set([
  "work_preflight",
  "core_health",
  "nyra_branch_catalog",
  "tenant_provider_openai_status",
  "tenant_provider_openai_setup_panel",
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

function challenge(config, error = "invalid_token", scope = "", description = "Authentication is required to use this MCP resource") {
  const metadata = `${config.publicUrl}/.well-known/oauth-protected-resource`;
  const safeDescription = String(description).replace(/["\\\r\n]/g, " ").slice(0, 160);
  return `Bearer resource_metadata="${metadata}", error="${error}", error_description="${safeDescription}"${scope ? `, scope="${scope}"` : ""}`;
}

function toolFailure(error) {
  const raw = String(error?.code || error?.message || "tool_execution_failed");
  const core = raw.match(/^core_request_failed:(\d{3}):([a-zA-Z0-9_-]+)$/);
  const status = Number(error?.status || (core ? core[1] : 500));
  const code = core?.[2] || (/^[a-zA-Z0-9_-]{3,80}$/.test(raw) ? raw : "tool_execution_failed");
  const retryable = error?.retryable === true || status === 429 || status >= 500;
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

export function createApp(config, options = {}) {
  const app = express();
  const authenticate = createAuthenticator(config, options);
  const handlers = options.handlers || {};
  const beforeToolCall = options.beforeToolCall;
  const afterToolCall = options.afterToolCall;
  const visibleTools = TOOLS.filter((tool) => typeof handlers[tool.name] === "function");
  // A host can rotate the MCP transport between tool calls from one logical chat.
  // Keep the transport binding for anti-switch protection, while correlating the
  // server-signed presence through the explicitly declared logical session id.
  // Client-provided ids are correlation data only and never grant authorization.
  const logicalSessionPresences = new Map();
  const transportPresenceBindings = new Map();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => res.json({
    ok: true,
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
    agent_workspace_configured: Boolean(config.agentWorkspaceRoot),
    memory_fabric_configured: Boolean(config.memoryFabricRoot),
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
  }));

  const protectedResourceMetadata = (_req, res) => res.json({
    resource: config.resource,
    authorization_servers: config.auth0Issuer ? [config.auth0Issuer] : [],
    scopes_supported: config.supportedScopes,
    bearer_methods_supported: ["header"],
    resource_documentation: `${config.publicUrl}/docs/auth`
  });
  app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);
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

  app.post("/mcp", async (req, res) => {
    let identity;
    try {
      identity = await authenticate(req.headers.authorization);
    } catch {
      res.set("WWW-Authenticate", challenge(config));
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
        return {
          ...tool,
          securitySchemes: schemes,
          _meta: {
            ...(tool._meta || {}),
            securitySchemes: schemes,
            "skinharmony/scopes": scopes,
            "skinharmony/mandatory_first_tool": "work_preflight",
            "skinharmony/preflight_entrypoint": tool.name === "work_preflight",
            "skinharmony/shared_memory_lifecycle": "automatic_task_contract_and_checkpoint",
            "skinharmony/research_entrypoint": tool.name === "nyra_research_plan",
            "skinharmony/research_sequence": "plan -> host web -> ingest -> query -> feedback",
          },
        };
      }) } });
      if (method === "tools/call") {
        const tool = TOOLS.find((item) => item.name === params.name);
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
        // A request flag is never an identity assertion. Only a verified
        // owner-root identity may make an explicit confirmation effective.
        const explicitOwnerConfirmation = identity.godMode === true && args.owner_confirmed === true;
        const callIdentity = {
          ...identity,
          agentPresence,
          ownerConfirmed: explicitOwnerConfirmation,
          confirmationReference: explicitOwnerConfirmation
            ? String(args.confirmation_reference || "").slice(0, 240)
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
        const preflight = hookContext?.preflight ?? hookContext;
        activeToolCall = { ...activeToolCall, hookContext, preflight };
        const rawResult = await handlers[tool.name](args, callIdentity);
        const result = attachAgentPresence(attachProviderOnboarding(attachWorkPreflight(rawResult, preflight), hookContext?.providerStatus), agentPresence);
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
        res.set("WWW-Authenticate", challenge(config, "insufficient_scope", error.missing.join(" ")));
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

export { attachProviderOnboarding, attachWorkPreflight, buildIdentity, inferClientType, resolveWorkPreflight, securitySchemes, serverIssuedBootstrapSession, toolFailure, TOOLS };

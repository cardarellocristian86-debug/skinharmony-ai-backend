import crypto from "node:crypto";
import express from "express";
import { createAuthenticator, requireScopes } from "./auth.js";
import { TOOLS } from "./tool-definitions.js";
import { createAgentPresence } from "./agent-presence.js";

const SERVER_VERSION = "0.8.3-agent-presence";
const SERVER_INSTRUCTIONS = "Always call work_preflight first. The MCP transport session is automatically bound to one server-signed agent presence and that signature is returned on every tool call. For collaboration, register each ChatGPT, Codex, API-agent or other session with agent_heartbeat using a unique agent_id, client_type and session_id. Never reuse one agent_id across concurrent sessions or change identity inside one transport session; preserve the server-issued agent signature in task, message and audit evidence. It automatically loads the authenticated tenant's canonical shared-memory state, tasks, locks, artifacts and handoff; never ask the user to provide a separate 'Carica SHARED_MEMORY' prompt. Every Core/Nyra-connected AI run is automatically persisted as a tenant-isolated task contract at preflight and durable progress checkpoints after each tool call; use memory_checkpoint or memory_handoff to add a human-quality final summary. Every other tool also runs the mandatory preflight middleware. Nyra and Universal Core can analyze scenarios, hypotheses, events, counterfactuals, decisions and verified outcomes without executing them. For live research call nyra_research_plan, browse with the host ChatGPT or Codex web tool, submit short sourced evidence with nyra_research_ingest, then query or review it. Never include secrets, raw customer data or full pages. Tenant identity always comes from OAuth; only reviewed evidence enters Nyra memory.";

function inferClientType(identity) {
  const kind = String(identity?.kind || "").toLowerCase();
  if (kind.includes("chatgpt")) return "chatgpt";
  if (kind.includes("codex")) return "codex";
  return "api_agent";
}

function normalizeTransportSession(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(raw)) return raw;
  return `mcp_${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
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
  const payload = resolveWorkPreflight(result, originalPayload);
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

function securitySchemes(scopes) {
  return [{ type: "oauth2", scopes }];
}

function challenge(config, error = "invalid_token", scope = "") {
  const metadata = `${config.publicUrl}/.well-known/oauth-protected-resource`;
  return `Bearer resource_metadata="${metadata}", error="${error}"${scope ? `, scope="${scope}"` : ""}`;
}

export function createApp(config, options = {}) {
  const app = express();
  const authenticate = createAuthenticator(config, options);
  const handlers = options.handlers || {};
  const beforeToolCall = options.beforeToolCall;
  const afterToolCall = options.afterToolCall;
  const visibleTools = TOOLS.filter((tool) => typeof handlers[tool.name] === "function");
  const sessionPresences = new Map();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => res.json({
    ok: true,
    service: "skinharmony-core-mcp",
    version: SERVER_VERSION,
    mode: process.env.NODE_ENV || "development",
    auth_configured: Boolean(config.auth0Issuer || config.codexKeys.length),
    core_configured: Boolean(config.universalCoreKey || Object.keys(config.universalCoreKeys || {}).length),
    shared_memory_configured: Boolean(config.sharedMemoryRoot),
    cloud_memory: {
      configured: Boolean(config.databaseUrl),
      backend: config.databaseUrl ? "postgres" : "filesystem",
      persistent: Boolean(config.databaseUrl),
      tenant_isolated: true,
    },
    agent_workspace_configured: Boolean(config.agentWorkspaceRoot),
    memory_fabric_configured: Boolean(config.memoryFabricRoot),
    research_cortex_configured: Boolean(config.researchCortexRoot),
    openai_research_fallback_enabled: config.openaiResearchEnabled === true,
    openai_research_fallback_configured: Boolean(config.openaiApiKey),
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
    try {
      if (method === "initialize") {
        const sessionId = normalizeTransportSession(req.headers["mcp-session-id"]) || `mcp_${crypto.randomBytes(16).toString("hex")}`;
        res.set("Mcp-Session-Id", sessionId);
        return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "skinharmony-core-mcp", version: SERVER_VERSION }, instructions: SERVER_INSTRUCTIONS } });
      }
      if (method === "notifications/initialized") return res.status(202).end();
      if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: { tools: visibleTools.map(({ scopes, ...tool }) => ({ ...tool, securitySchemes: securitySchemes(scopes), _meta: { securitySchemes: securitySchemes(scopes), "skinharmony/scopes": scopes, "skinharmony/mandatory_first_tool": "work_preflight", "skinharmony/preflight_entrypoint": tool.name === "work_preflight", "skinharmony/shared_memory_lifecycle": "automatic_task_contract_and_checkpoint", "skinharmony/research_entrypoint": tool.name === "nyra_research_plan", "skinharmony/research_sequence": "plan -> host web -> ingest -> query -> feedback" } })) } });
      if (method === "tools/call") {
        const tool = TOOLS.find((item) => item.name === params.name);
        if (!tool) return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } });
        requireScopes(identity, tool.scopes);
        if (!handlers[tool.name]) return res.json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Tool backend unavailable" } });
        const rawArgs = params.arguments || {};
        const transportSessionId = normalizeTransportSession(req.headers["mcp-session-id"]);
        const presenceKey = transportSessionId || normalizeTransportSession(rawArgs.session_id);
        if (!presenceKey) {
          const presenceError = new Error("agent_presence_session_required");
          presenceError.code = "agent_presence_session_required";
          throw presenceError;
        }
        const previousPresence = sessionPresences.get(presenceKey);
        const sessionId = previousPresence?.session_id || transportSessionId || normalizeTransportSession(rawArgs.session_id) || presenceKey;
        const requestedAgentId = rawArgs.agent_id || rawArgs.from_agent_id || previousPresence?.agent_id ||
          `agent_${crypto.createHash("sha256").update(`${identity.subject || identity.kind || "client"}\u0000${presenceKey}`).digest("hex").slice(0, 20)}`;
        const presenceInput = {
          agent_id: requestedAgentId,
          client_type: rawArgs.client_type || previousPresence?.client_type || inferClientType(identity),
          session_id: sessionId,
        };
        const agentPresence = createAgentPresence(config, identity, presenceInput);
        if (previousPresence && previousPresence.signature !== agentPresence.signature) {
          const presenceError = new Error("agent_presence_conflict");
          presenceError.code = "agent_presence_conflict";
          throw presenceError;
        }
        if (sessionPresences.has(presenceKey)) sessionPresences.delete(presenceKey);
        while (sessionPresences.size >= 5_000) sessionPresences.delete(sessionPresences.keys().next().value);
        sessionPresences.set(presenceKey, { ...agentPresence, session_id: sessionId });
        const args = { ...rawArgs, ...presenceInput };
        const callIdentity = {
          ...identity,
          agentPresence,
          ownerConfirmed: identity.godMode === true || args.owner_confirmed === true,
          confirmationReference: String(args.confirmation_reference || "").slice(0, 240),
        };
        const preflight = typeof beforeToolCall === "function"
          ? await beforeToolCall({ identity: callIdentity, toolName: tool.name, args })
          : null;
        const rawResult = await handlers[tool.name](args, callIdentity);
        const result = attachAgentPresence(attachWorkPreflight(rawResult, preflight), agentPresence);
        if (typeof afterToolCall === "function") await afterToolCall({ identity: callIdentity, toolName: tool.name, args, result, preflight });
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
      if (typeof afterToolCall === "function" && method === "tools/call") {
        await afterToolCall({ identity, toolName: params.name, args: params.arguments || {}, error });
      }
      if (error.message === "insufficient_scope") {
        res.set("WWW-Authenticate", challenge(config, "insufficient_scope", error.missing.join(" ")));
        return res.status(403).json({ jsonrpc: "2.0", id, error: { code: -32003, message: "Insufficient scope" } });
      }
      return res.status(500).json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } });
    }
  });
  return app;
}

export { attachWorkPreflight, resolveWorkPreflight, securitySchemes, TOOLS };

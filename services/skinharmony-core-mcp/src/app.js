import express from "express";
import { createAuthenticator, requireScopes } from "./auth.js";
import { TOOLS } from "./tool-definitions.js";
import { validateToolArguments } from "./schema-validation.js";

const SERVER_VERSION = "0.8.0";
const SERVER_INSTRUCTIONS = "Call work_preflight before connected work. Tenant identity and product access come only from the authenticated MCP identity and tenant-bound Core key; never ask for or forward tenant_id. Nyra and Universal Core can recall tenant memory, open permitted branches, govern actions, analyze intelligence and inspect authorized software without executing changes. Use software_intelligence for immediate static inspection, or software_authorize then software_job_submit and software_job_status for governed Ghidra/Frida jobs. Skin and Scalp Analyzer results are read-only cosmetic observations, not diagnoses. For live research call nyra_research_plan, browse with the host ChatGPT or Codex web tool, submit short sourced evidence with nyra_research_ingest, then query or review it. Never include secrets, raw customer data, raw analyzer images or full pages; only reviewed evidence enters Nyra memory.";

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

function toolFailure(error) {
  const raw = String(error?.message || "tool_execution_failed");
  const core = raw.match(/^core_request_failed:(\d{3}):([a-zA-Z0-9_-]+)$/);
  const status = core ? Number(core[1]) : 500;
  const code = core?.[2] || (/^[a-zA-Z0-9_-]{3,80}$/.test(raw) ? raw : "tool_execution_failed");
  const retryable = status === 429 || status >= 500;
  const payload = {
    ok: false,
    error: {
      code,
      message: retryable ? "The governed backend is temporarily unavailable." : "The governed request was rejected.",
      retryable,
      ...(core ? { upstream_status: status } : {}),
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
    nyra_god_mode: {
      configured: config.godModeEnabled === true,
      active: config.godModeEnabled === true && config.godModeEmergencyStop !== true,
      tenant_isolated: true,
      emergency_stop: config.godModeEmergencyStop === true
    }
  }));

  const protectedResourceMetadata = (_req, res) => res.json({
    resource: config.resource,
    authorization_servers: config.authorizationServers || (config.auth0Issuer ? [config.auth0Issuer] : []),
    scopes_supported: config.supportedScopes,
    bearer_methods_supported: ["header"],
    resource_documentation: `${config.publicUrl}/docs/auth`
  });
  app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    if (config.oauthAuthorizationServerMetadata) return res.json(config.oauthAuthorizationServerMetadata);
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
      if (method === "initialize") return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "skinharmony-core-mcp", version: SERVER_VERSION }, instructions: SERVER_INSTRUCTIONS } });
      if (method === "notifications/initialized") return res.status(202).end();
      if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: { tools: visibleTools.map(({ scopes, ...tool }) => ({ ...tool, securitySchemes: securitySchemes(scopes), _meta: { securitySchemes: securitySchemes(scopes), "skinharmony/scopes": scopes, "skinharmony/mandatory_first_tool": "work_preflight", "skinharmony/preflight_entrypoint": tool.name === "work_preflight", "skinharmony/research_entrypoint": tool.name === "nyra_research_plan", "skinharmony/research_sequence": "plan -> host web -> ingest -> query -> feedback" } })) } });
      if (method === "tools/call") {
        const tool = TOOLS.find((item) => item.name === params.name);
        if (!tool) return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } });
        requireScopes(identity, tool.scopes);
        if (!handlers[tool.name]) return res.json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Tool backend unavailable" } });
        const args = params.arguments || {};
        const validationErrors = validateToolArguments(tool.inputSchema, args);
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
        const callIdentity = {
          ...identity,
          ownerConfirmed: identity.godMode === true || args.owner_confirmed === true,
          confirmationReference: String(args.confirmation_reference || "").slice(0, 240),
        };
        const hookContext = typeof beforeToolCall === "function"
          ? await beforeToolCall({ identity: callIdentity, toolName: tool.name, args })
          : null;
        const preflight = hookContext?.preflight ?? hookContext;
        const rawResult = await handlers[tool.name](args, callIdentity);
        const result = attachWorkPreflight(rawResult, preflight);
        if (typeof afterToolCall === "function") {
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
      if (typeof afterToolCall === "function" && method === "tools/call") {
        try { await afterToolCall({ identity, toolName: params.name, args: params.arguments || {}, error }); } catch {}
      }
      if (error.message === "insufficient_scope") {
        res.set("WWW-Authenticate", challenge(config, "insufficient_scope", error.missing.join(" ")));
        return res.status(403).json({ jsonrpc: "2.0", id, error: { code: -32003, message: "Insufficient scope" } });
      }
      if (method === "tools/call") return res.json({ jsonrpc: "2.0", id, result: toolFailure(error) });
      return res.status(500).json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } });
    }
  });
  return app;
}

export { attachWorkPreflight, resolveWorkPreflight, securitySchemes, toolFailure, TOOLS };

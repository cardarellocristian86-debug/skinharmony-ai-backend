import express from "express";
import crypto from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAuthenticator, requireScopes } from "./auth.js";
import { approvalRouter } from "./approval-routes.js";
import { createSkinHarmonyMcpServer } from "./mcp.js";

const SECURITY_SCHEMES = [
  { type: "http", scheme: "bearer", description: "Scoped SkinHarmony Codex bearer token" },
  { type: "oauth2", scopes: ["core:read", "core:govern"] }
];

const TOOLS = [
  { name: "core_health", description: "Read Universal Core service health.", inputSchema: { type: "object", additionalProperties: false }, scopes: ["core:read"] },
  { name: "nyra_runtime_context", description: "Read Nyra readiness and control context.", inputSchema: { type: "object", properties: { include_control_snapshot: { type: "boolean" } }, additionalProperties: false }, scopes: ["core:read"] },
  { name: "nyra_interpret_request", description: "Interpret a request; this does not authorize execution.", inputSchema: { type: "object", required: ["message"], properties: { message: { type: "string" }, session_id: { type: "string" } }, additionalProperties: false }, scopes: ["core:read"] },
  { name: "core_gate_action", description: "Evaluate an action through Universal Core; this never executes it.", inputSchema: { type: "object", required: ["action_label", "action_type"], additionalProperties: true }, scopes: ["core:govern"] }
];

function challenge(config, error = "invalid_token", scope = "") {
  const metadata = `${config.publicUrl}/.well-known/oauth-protected-resource`;
  return `Bearer resource_metadata="${metadata}", error="${error}"${scope ? `, scope="${scope}"` : ""}`;
}

export function createApp(config, options = {}) {
  const app = express();
  const authenticate = createAuthenticator(config, options);
  const handlers = options.handlers || {};
  app.use(express.json({ limit: "1mb" }));
  if (options.approvalService && options.authenticateApproval) {
    app.use("/approval", approvalRouter({ service: options.approvalService, authenticate: options.authenticateApproval }));
  }

  app.get("/healthz", (_req, res) => res.json({
    ok: true,
    service: "skinharmony-core-mcp",
    version: "0.1.0",
    transport: "streamable_http",
    authentication_required: true,
    oauth_configured: Boolean(config.auth0Issuer),
    codex_bearer_configured: config.codexKeys.length > 0
  }));

  app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json({
    resource: config.resource,
    authorization_servers: config.auth0Issuer ? [config.auth0Issuer] : [],
    scopes_supported: config.supportedScopes,
    bearer_methods_supported: ["header"],
    resource_documentation: `${config.publicUrl}/docs/auth`
  }));
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
      if (method === "initialize") return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "skinharmony-core-mcp", version: "0.1.0" } } });
      if (method === "notifications/initialized") return res.status(202).end();
      if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: { tools: TOOLS.map(({ scopes, ...tool }) => ({ ...tool, _meta: { securitySchemes: SECURITY_SCHEMES, "skinharmony/scopes": scopes } })) } });
      if (method === "tools/call") {
        const tool = TOOLS.find((item) => item.name === params.name);
        if (!tool) return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } });
        requireScopes(identity, tool.scopes);
        if (!handlers[tool.name]) return res.json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Tool backend unavailable" } });
        const result = await handlers[tool.name](params.arguments || {}, identity);
        return res.json({ jsonrpc: "2.0", id, result });
      }
      return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    } catch (error) {
      if (error.message === "insufficient_scope") {
        res.set("WWW-Authenticate", challenge(config, "insufficient_scope", error.missing.join(" ")));
        return res.status(403).json({ jsonrpc: "2.0", id, error: { code: -32003, message: "Insufficient scope" } });
      }
      return res.status(500).json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } });
    }
  });
  return app;
}

export { SECURITY_SCHEMES, TOOLS };

function legacySafeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function legacyBearerToken(header = "") {
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

// Compatibility adapter for the original SDK-backed Codex transport. New
// ChatGPT deployments use createApp; existing callers can migrate separately.
export function createCoreMcpApp(options = {}) {
  const host = String(options.host || process.env.HOST || "0.0.0.0");
  const allowedHosts = options.allowedHosts || String(process.env.MCP_ALLOWED_HOSTS || "skinharmony-core-mcp.onrender.com,localhost,127.0.0.1")
    .split(",").map((item) => item.trim()).filter(Boolean);
  const authToken = String(options.authToken || process.env.MCP_AUTH_TOKEN || "").trim();
  const production = (options.nodeEnv || process.env.NODE_ENV) === "production";
  if (production && !authToken) throw new Error("MCP_AUTH_TOKEN is required in production");

  const app = createMcpExpressApp({ host, allowedHosts });
  app.disable("x-powered-by");
  app.get("/healthz", (_req, res) => res.json({
    ok: true,
    service: "skinharmony-core-mcp",
    version: "0.1.0",
    transport: "streamable_http_stateless",
    authentication_required: production || Boolean(authToken),
    core_configured: Boolean(options.coreClient || options.core?.key || process.env.CORE_MCP_KEY),
    nyra_configured: Boolean(options.nyraClient || options.nyra?.apiKey || options.nyra?.basicUser || process.env.NYRA_MCP_API_KEY || process.env.NYRA_MCP_BASIC_USER)
  }));
  app.use("/mcp", (req, res, next) => {
    if (!authToken && !production) return next();
    if (!legacySafeEqual(legacyBearerToken(req.headers.authorization), authToken)) {
      return res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
    }
    return next();
  });
  app.post("/mcp", async (req, res) => {
    const server = createSkinHarmonyMcpServer(options);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    } finally {
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    }
  });
  app.all("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
  return app;
}

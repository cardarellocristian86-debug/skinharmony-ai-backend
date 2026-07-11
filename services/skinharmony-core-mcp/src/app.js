import crypto from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSkinHarmonyMcpServer } from "./mcp.js";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function bearerToken(header = "") {
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export function createCoreMcpApp(options = {}) {
  const host = String(options.host || process.env.HOST || "0.0.0.0");
  const allowedHosts = options.allowedHosts || String(process.env.MCP_ALLOWED_HOSTS || "skinharmony-core-mcp.onrender.com,localhost,127.0.0.1")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const authToken = String(options.authToken || process.env.MCP_AUTH_TOKEN || "").trim();
  const production = (options.nodeEnv || process.env.NODE_ENV) === "production";
  if (production && !authToken) throw new Error("MCP_AUTH_TOKEN is required in production");

  const app = createMcpExpressApp({ host, allowedHosts });
  app.disable("x-powered-by");

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: "skinharmony-core-mcp",
      version: "0.1.0",
      transport: "streamable_http_stateless",
      authentication_required: production || Boolean(authToken),
      core_configured: Boolean(options.coreClient || options.core?.key || process.env.CORE_MCP_KEY),
      nyra_configured: Boolean(options.nyraClient || options.nyra?.apiKey || options.nyra?.basicUser || process.env.NYRA_MCP_API_KEY || process.env.NYRA_MCP_BASIC_USER),
    });
  });

  app.use("/mcp", (req, res, next) => {
    if (!authToken && !production) return next();
    if (!safeEqual(bearerToken(req.headers.authorization), authToken)) {
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
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    } finally {
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    }
  });

  app.all("/mcp", (_req, res) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  });

  return app;
}

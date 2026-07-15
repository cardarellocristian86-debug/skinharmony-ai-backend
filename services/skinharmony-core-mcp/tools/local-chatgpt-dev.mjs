import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createUniversalCoreService } from "../../universal-core-service/src/app.js";
import { createSoftwareAuthorizationVerifier } from "../../universal-core-service/src/universalSoftwareIntelligence.js";
import { createAnalyzerHandlers } from "../src/analyzer-handlers.js";
import { createApp } from "../src/app.js";
import { createCloudMemoryStore } from "../src/cloud-memory-store.js";
import { createCollaborationHandlers } from "../src/collaboration-handlers.js";
import { createCoreHandlers, createCoreWriteGuard } from "../src/core-handlers.js";
import { createMemoryFabric, createMemoryFabricHandlers } from "../src/memory-fabric.js";
import { createMemoryHandlers } from "../src/memory-handlers.js";
import { createResearchCortex, createResearchHandlers } from "../src/research-cortex.js";

const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name}_required`);
  return value;
};

const publicUrl = new URL(required("MCP_PUBLIC_URL")).toString().replace(/\/$/, "");
const auth0Issuer = new URL(required("AUTH0_ISSUER")).toString().replace(/\/$/, "");
const auth0Audience = required("AUTH0_AUDIENCE");
const tenantId = required("MCP_DEV_TENANT_ID");
const corePort = Number(process.env.CORE_SERVICE_PORT || 8787);
const mcpPort = Number(process.env.PORT || 8790);
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skh-chatgpt-mcp-dev-"));
const adminKey = crypto.randomBytes(32).toString("base64url");
const softwareSecret = crypto.randomBytes(48).toString("base64url");
const developmentAccessToken = crypto.randomBytes(48).toString("base64url");
const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
process.env.CORE_SERVICE_ADMIN_KEY = adminKey;

const softwareAuthorizationVerifier = createSoftwareAuthorizationVerifier({ secret: softwareSecret });
const { app: coreApp } = createUniversalCoreService({
  storageRoot: path.join(runtimeRoot, "core"),
  softwareAuthorizationSecret: softwareSecret,
  softwareAuthorizationVerifier,
});
const coreServer = http.createServer(coreApp);
await new Promise((resolve, reject) => {
  coreServer.once("error", reject);
  coreServer.listen(corePort, "127.0.0.1", resolve);
});

const generatedResponse = await fetch(`http://127.0.0.1:${corePort}/v1/keys/generate`, {
  method: "POST",
  headers: { authorization: `Bearer ${adminKey}`, "content-type": "application/json" },
  body: JSON.stringify({
    tenant_id: tenantId,
    preset: "nyra_core_360_connector",
    tier: "internal",
    domain_pack_id: "analyzer",
  }),
});
const generated = await generatedResponse.json();
if (!generatedResponse.ok || !generated.key) throw new Error(`core_key_generation_failed:${generated.error || generatedResponse.status}`);

const stateRoot = path.join(runtimeRoot, "tenant-state");
const config = {
  port: mcpPort,
  publicUrl,
  resource: `${publicUrl}/mcp`,
  // The development OAuth issuer is local and uses an ephemeral bearer.  It
  // exists solely so ChatGPT can exercise DCR + PKCE without any Auth0 secret.
  auth0Issuer: "",
  auth0Audience: "",
  jwksUri: "",
  authorizationServers: [publicUrl],
  oauthAuthorizationServerMetadata: {
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/authorize`,
    token_endpoint: `${publicUrl}/token`,
    registration_endpoint: `${publicUrl}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  },
  codexKeys: [developmentAccessToken],
  codexScopes: ["core:read", "core:govern"],
  supportedScopes: ["core:read", "core:govern"],
  universalCoreUrl: `http://127.0.0.1:${corePort}`,
  universalCoreKey: "",
  universalCoreKeys: { [tenantId]: generated.key },
  defaultTenantId: tenantId,
  tenantClaim: process.env.MCP_TENANT_CLAIM || "https://skinharmony.it/tenant_id",
  sharedMemoryRoot: stateRoot,
  databaseUrl: "",
  databaseSsl: false,
  databasePoolMax: 1,
  cloudMemoryMaxDocumentBytes: 250_000,
  agentWorkspaceRoot: stateRoot,
  memoryFabricRoot: stateRoot,
  researchCortexRoot: stateRoot,
  memoryRetentionDays: 1,
  personalMemoryRetentionDays: 1,
  researchRetentionDays: 1,
  openaiApiKey: "",
  openaiResearchEnabled: false,
  openaiResearchModel: "gpt-5.6",
  openaiResearchTimeoutMs: 30_000,
  openaiResearchMaxCallsPerHour: 1,
  godModeEnabled: false,
  godModeTenantIds: [],
  godModeSubjects: [],
  godModeClientIds: [],
  godModeCodexEnabled: false,
  godModeEmergencyStop: true,
};

const cloudMemoryStore = createCloudMemoryStore(config);
const govern = createCoreWriteGuard(config);
const memoryFabric = createMemoryFabric(config, { govern });
const coreHandlers = createCoreHandlers(config, {
  contextProvider: (input, identity) => memoryFabric.context(input, identity),
});
const researchCortex = createResearchCortex(config, {
  govern,
  planProvider: coreHandlers.research_plan,
  validateProvider: coreHandlers.research_validate,
  memoryFabric,
});
const handlers = {
  ...coreHandlers,
  ...createMemoryHandlers(config, { researchCortex, cloudMemoryStore }),
  ...createMemoryFabricHandlers(memoryFabric),
  ...createResearchHandlers(researchCortex),
  ...createAnalyzerHandlers(),
  ...createCollaborationHandlers(config, { govern }),
};
const nativeTools = new Set([
  "core_health", "work_preflight", "nyra_runtime_context", "nyra_branch_catalog",
  "nyra_interpret_request", "core_gate_action", "memory_context", "memory_search",
]);
const summarize = (toolName, args = {}) => String(
  args.request || args.message || args.action_label || args.title || args.query ||
  args.description || args.question || args.body || args.path || `Use local MCP tool ${toolName}`,
).slice(0, 20_000);

const mcpApp = createApp(config, {
  handlers,
  beforeToolCall: async ({ identity, toolName, args }) => {
    if (nativeTools.has(toolName)) return null;
    const result = await coreHandlers.work_preflight({
      request: summarize(toolName, args),
      operation_type: toolName,
      tool_name: toolName,
      project_id: args.project_id,
      session_id: args.session_id,
      agent_id: args.agent_id || args.from_agent_id || "chatgpt_dev",
      available_capabilities: ["skinharmony_core_mcp", toolName],
      owner_confirmed: identity.ownerConfirmed === true,
      confirmation_reference: identity.confirmationReference,
    }, identity);
    return result.structuredContent;
  },
  afterToolCall: (event) => memoryFabric.recordToolActivity(event),
});
// Ephemeral development OAuth authorization server.  Registered clients,
// authorization codes and the access token only live in this process.
const oauthClients = new Map();
const oauthCodes = new Map();
const base64urlSha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("base64url");
mcpApp.use(express.urlencoded({ extended: false }));
mcpApp.post("/register", (req, res) => {
  const clientId = `chatgpt-local-${crypto.randomUUID()}`;
  oauthClients.set(clientId, {
    redirectUris: Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [],
  });
  return res.status(201).json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: "none",
  });
});
mcpApp.get("/authorize", (req, res) => {
  const clientId = String(req.query.client_id || "");
  const redirectUri = String(req.query.redirect_uri || "");
  const client = oauthClients.get(clientId);
  if (!client || !client.redirectUris.includes(redirectUri) || req.query.response_type !== "code") {
    return res.status(400).json({ error: "invalid_request" });
  }
  const code = crypto.randomBytes(32).toString("base64url");
  oauthCodes.set(code, {
    clientId,
    redirectUri,
    codeChallenge: String(req.query.code_challenge || ""),
    expiresAt: Date.now() + 120_000,
  });
  const destination = new URL(redirectUri);
  destination.searchParams.set("code", code);
  if (req.query.state) destination.searchParams.set("state", String(req.query.state));
  return res.redirect(302, destination.toString());
});
mcpApp.post("/token", (req, res) => {
  const code = oauthCodes.get(String(req.body?.code || ""));
  if (!code || code.expiresAt < Date.now() || code.clientId !== req.body?.client_id || code.redirectUri !== req.body?.redirect_uri ||
    (code.codeChallenge && base64urlSha256(req.body?.code_verifier || "") !== code.codeChallenge)) {
    return res.status(400).json({ error: "invalid_grant" });
  }
  oauthCodes.delete(String(req.body.code));
  return res.json({
    access_token: developmentAccessToken,
    token_type: "Bearer",
    expires_in: 300,
    scope: config.supportedScopes.join(" "),
  });
});
const mcpServer = http.createServer(mcpApp);
await new Promise((resolve, reject) => {
  mcpServer.once("error", reject);
  mcpServer.listen(mcpPort, "127.0.0.1", resolve);
});

console.log(JSON.stringify({
  ok: true,
  mode: "ephemeral_chatgpt_development",
  mcp_url: `${publicUrl}/mcp`,
  mcp_version: "0.8.0",
  core_version: "0.9.1",
  tenant_runtime_bound: true,
  secrets_persisted: false,
  runtime_root: runtimeRoot,
}));

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.all([
    new Promise((resolve) => mcpServer.close(resolve)),
    new Promise((resolve) => coreServer.close(resolve)),
  ]);
  if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
  else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
}

process.once("SIGINT", () => close().finally(() => process.exit(0)));
process.once("SIGTERM", () => close().finally(() => process.exit(0)));

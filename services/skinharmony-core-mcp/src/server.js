import { createApp } from "./app.js";
import { createCollaborationHandlers } from "./collaboration-handlers.js";
import { loadConfig } from "./config.js";
import { createCoreHandlers, createCoreWriteGuard } from "./core-handlers.js";
import { createMemoryFabric, createMemoryFabricHandlers } from "./memory-fabric.js";
import { createMemoryHandlers } from "./memory-handlers.js";
import { createCloudMemoryStore } from "./cloud-memory-store.js";
import { createSharedMemoryBootstrap } from "./shared-memory-bootstrap.js";
import { createResearchCortex, createResearchHandlers } from "./research-cortex.js";
import { createDecisionLedger } from "./decision-ledger.js";
import { createSuiteHandlers } from "./suite-handlers.js";
import { createAuthenticator } from "./auth.js";
import { createOpenAiConnectPortal } from "./openai-connect-portal.js";

const config = loadConfig();
const cloudMemoryStore = createCloudMemoryStore(config);
const decisionLedger = createDecisionLedger(config);
if (config.decisionLedgerRequired && !decisionLedger) throw new Error("core_decision_ledger_database_required");
const sharedMemoryBootstrap = createSharedMemoryBootstrap(cloudMemoryStore, { cacheTtlMs: 300_000 });
const govern = createCoreWriteGuard(config);
const memoryFabric = config.memoryFabricRoot ? createMemoryFabric(config, { govern }) : null;
const collaborationHandlers = (config.agentWorkspaceRoot || config.collaborationDatabaseUrl)
  ? createCollaborationHandlers(config, { govern })
  : {};
const coreHandlers = createCoreHandlers(config, {
  contextProvider: memoryFabric ? (input, identity) => memoryFabric.context(input, identity) : null,
  sharedMemoryBootstrap,
});
const browserAuthenticate = createAuthenticator(config, { audience: config.auth0BrowserAudience });
async function coreProvider(path, tenantId, method = "GET") {
  const key = String(config.universalCoreKeys?.[tenantId] || (tenantId === config.defaultTenantId ? config.universalCoreKey : "")).trim();
  if (!key) throw new Error("core_tenant_key_missing");
  const response = await fetch(`${config.universalCoreUrl}${path}`, { method, headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(method === "POST" ? { "content-type": "application/json" } : {}) }, ...(method === "POST" ? { body: JSON.stringify({ ttl_minutes: 10 }) } : {}) });
  const payload = await response.json(); if (!response.ok) throw new Error("core_provider_unavailable"); return payload;
}
const researchCortex = config.researchCortexRoot
  ? createResearchCortex(config, {
      govern,
      planProvider: coreHandlers.research_plan,
      validateProvider: coreHandlers.research_validate,
      memoryFabric,
    })
  : null;
const suiteHandlers = createSuiteHandlers(config);

const CORE_PREFLIGHT_NATIVE_TOOLS = new Set([
  "work_preflight",
  "core_health",
  "nyra_branch_catalog",
  "tenant_provider_openai_setup_panel",
]);

const PROVIDER_ONBOARDING_EXEMPT_TOOLS = new Set([
  "core_health",
  "nyra_branch_catalog",
  "tenant_provider_openai_status",
  "tenant_provider_openai_setup_panel",
  "tenant_provider_openai_setup_link",
]);

function summarizeToolRequest(toolName, args = {}) {
  return String(
    args.request || args.message || args.action_label || args.title || args.query || args.description ||
    args.question || args.body || args.path || `Use SkinHarmony MCP tool ${toolName}`,
  ).slice(0, 20_000);
}

const app = createApp(config, {
  handlers: {
    tenant_provider_openai_setup_panel: async (_args, identity) => ({
      structuredContent: {
        ok: true,
        tenant_id: identity.tenantId,
        provider: "openai",
        execution_enabled: false,
        key_entry: "one_time_secure_link_only",
      },
      content: [{ type: "text", text: "Apri il pannello Collega OpenAI e premi Crea link sicuro." }],
      _meta: { "openai/outputTemplate": "ui://skinharmony/openai-provider-setup.html" },
    }),
    ...coreHandlers,
    ...createMemoryHandlers(config, { researchCortex, cloudMemoryStore }),
    ...(memoryFabric ? createMemoryFabricHandlers(memoryFabric) : {}),
    ...(researchCortex ? createResearchHandlers(researchCortex) : {}),
    ...suiteHandlers,
    ...collaborationHandlers,
    ...(decisionLedger ? { decision_ledger_report: async (args, identity) => {
      const payload = { ok: true, report: await decisionLedger.report(identity.tenantId, args.days) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    } } : {}),
  },
  beforeToolCall: async ({ identity, toolName, args }) => {
    const ledgerContext = decisionLedger ? await decisionLedger.startWork(identity, toolName, args) : null;
    let providerStatus = null;
    if (!PROVIDER_ONBOARDING_EXEMPT_TOOLS.has(toolName)) {
      try { providerStatus = await coreHandlers.tenant_provider_openai_status({}, identity); } catch {}
    }
    if (CORE_PREFLIGHT_NATIVE_TOOLS.has(toolName)) return { preflight: null, ledgerContext, providerStatus };
    const result = await coreHandlers.work_preflight({
      request: summarizeToolRequest(toolName, args),
      operation_type: toolName,
      tool_name: toolName,
      project_id: args.project_id,
      session_id: identity.agentPresence?.session_id || args.session_id,
      agent_id: identity.agentPresence?.agent_id || args.agent_id || args.from_agent_id || "connected_ai",
      client_type: identity.agentPresence?.client_type || args.client_type,
      available_capabilities: ["skinharmony_core_mcp", toolName],
      owner_confirmed: identity.ownerConfirmed === true,
      confirmation_reference: identity.confirmationReference,
    }, identity);
    const preflight = result.structuredContent;
    if (ledgerContext) await decisionLedger.append(ledgerContext, "preflight_completed", {
      preflight_id: preflight?.work_preflight?.preflight_id || preflight?.preflight_id,
      reason_summary: preflight?.work_preflight?.state || preflight?.state || "preflight_completed",
      metadata: { execution_allowed: preflight?.work_preflight?.governance?.execution_allowed_by_preflight === true },
    });
    return { preflight, ledgerContext, providerStatus };
  },
  afterToolCall: async (event) => {
    if (decisionLedger && event.hookContext?.ledgerContext) await decisionLedger.finishWork(event.hookContext.ledgerContext, event);
    if (memoryFabric) await memoryFabric.recordToolActivity(event);
  },
});
const openAiPortal = createOpenAiConnectPortal({ config, authenticate: browserAuthenticate, issueSetupLink: (tenantId) => coreProvider("/v1/generic-agents/providers/openai/setup-links", tenantId, "POST"), providerStatus: (tenantId) => coreProvider("/v1/generic-agents/providers/openai", tenantId) });
app.get("/connect/openai", openAiPortal.start);
app.get("/connect/openai/callback", openAiPortal.callback);
app.get("/connect/openai/continue", openAiPortal.continue);
app.listen(config.port, () => console.log(`[skinharmony-core-mcp] listening on ${config.port}`));

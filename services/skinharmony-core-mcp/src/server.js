import { createApp, requiresGenericWorkPreflight } from "./app.js";
import express from "express";
import { createCollaborationHandlers } from "./collaboration-handlers.js";
import { loadConfig } from "./config.js";
import { createCoreHandlers, createCoreWriteGuard } from "./core-handlers.js";
import { createMemoryFabric, createMemoryFabricHandlers } from "./memory-fabric.js";
import { createMemoryHandlers } from "./memory-handlers.js";
import { createCloudMemoryStore } from "./cloud-memory-store.js";
import { createProjectContextService } from "./project-context-service.js";
import { createSharedMemoryBootstrap } from "./shared-memory-bootstrap.js";
import { createResearchCortex, createResearchHandlers } from "./research-cortex.js";
import { createDecisionLedger } from "./decision-ledger.js";
import { createSuiteHandlers } from "./suite-handlers.js";
import { createAuthenticator } from "./auth.js";
import { createOpenAiConnectPortal } from "./openai-connect-portal.js";

const config = loadConfig();
const cloudMemoryStore = createCloudMemoryStore(config);
const projectContextService = createProjectContextService(cloudMemoryStore);
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
  projectContextService,
});
const browserAuthenticate = createAuthenticator(config, { audience: config.auth0BrowserAudience });
const researchCortex = config.researchCortexRoot
  ? createResearchCortex(config, {
      govern,
      planProvider: coreHandlers.research_plan,
      validateProvider: coreHandlers.research_validate,
      memoryFabric,
    })
  : null;
const suiteHandlers = createSuiteHandlers(config);

const PROVIDER_ONBOARDING_EXEMPT_TOOLS = new Set([
  "core_health",
  "nyra_branch_catalog",
  "tenant_provider_openai_status",
  "tenant_provider_openai_setup_panel",
  "tenant_provider_openai_setup_link",
  "tenant_provider_openai_multi_agent_run_read",
  "tenant_provider_openai_multi_agent_run_cancel",
  "project_context_review_commit",
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
    try {
      if (!PROVIDER_ONBOARDING_EXEMPT_TOOLS.has(toolName)) {
        try { providerStatus = await coreHandlers.tenant_provider_openai_status({}, identity); } catch {}
      }
      if (!requiresGenericWorkPreflight(toolName)) return { preflight: null, ledgerContext, providerStatus };
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
    } catch (error) {
      error.hookContext = { ledgerContext, providerStatus };
      throw error;
    }
  },
  afterToolCall: async (event) => {
    if (decisionLedger && event.hookContext?.ledgerContext) await decisionLedger.finishWork(event.hookContext.ledgerContext, event);
    if (memoryFabric) await memoryFabric.recordToolActivity(event);
  },
});
const openAiPortal = createOpenAiConnectPortal({
  config,
  authenticate: browserAuthenticate,
  issueSetupLink: (identity) => coreHandlers.issueOwnerOpenAiSetupLink(identity, 10),
  providerStatus: coreHandlers.tenant_provider_openai_status,
  startMultiAgentRun: coreHandlers.tenant_provider_openai_multi_agent_smoke_run,
  readMultiAgentRun: coreHandlers.tenant_provider_openai_multi_agent_run_read,
  cancelMultiAgentRun: coreHandlers.tenant_provider_openai_multi_agent_run_cancel,
});
app.get("/connect/openai", openAiPortal.start);
app.get("/connect/openai/callback", openAiPortal.callback);
app.post("/connect/openai/continue", express.urlencoded({ extended: false }), openAiPortal.continue);
app.get("/agents", openAiPortal.agentsHome);
app.get("/agents/login", openAiPortal.agentsLogin);
app.post("/agents/connect", express.urlencoded({ extended: false, limit: "2kb" }), openAiPortal.agentsConnect);
app.post("/agents/run", express.urlencoded({ extended: false, limit: "8kb" }), openAiPortal.agentsRunStart);
app.get("/agents/runs/:runId", openAiPortal.agentsRunRead);
app.post("/agents/runs/:runId/cancel", express.urlencoded({ extended: false, limit: "8kb" }), openAiPortal.agentsRunCancel);
app.post("/agents/logout", express.urlencoded({ extended: false, limit: "2kb" }), openAiPortal.agentsLogout);

// Preserve previously issued mobile-first links while keeping `/agents` as
// the device- and client-neutral entrypoint for ChatGPT, Codex and browsers.
app.get("/mobile/agents", openAiPortal.agentsHome);
app.get("/mobile/agents/login", openAiPortal.agentsLogin);
app.post("/mobile/agents/connect", express.urlencoded({ extended: false, limit: "2kb" }), openAiPortal.agentsConnect);
app.post("/mobile/agents/run", express.urlencoded({ extended: false, limit: "8kb" }), openAiPortal.agentsRunStart);
app.get("/mobile/agents/runs/:runId", openAiPortal.agentsRunRead);
app.post("/mobile/agents/runs/:runId/cancel", express.urlencoded({ extended: false, limit: "8kb" }), openAiPortal.agentsRunCancel);
app.post("/mobile/agents/logout", express.urlencoded({ extended: false, limit: "2kb" }), openAiPortal.agentsLogout);
app.listen(config.port, () => console.log(`[skinharmony-core-mcp] listening on ${config.port}`));

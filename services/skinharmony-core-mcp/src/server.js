import { createApp, requiresGenericWorkPreflight } from "./app.js";
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
import { TOOLS } from "./tool-definitions.js";
import { createDynamicCapabilityHandlers } from "./dynamic-capability-router.js";

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
const researchCortex = config.researchCortexRoot
  ? createResearchCortex(config, {
      govern,
      planProvider: coreHandlers.research_plan,
      validateProvider: coreHandlers.research_validate,
      memoryFabric,
    })
  : null;
const suiteHandlers = createSuiteHandlers(config);

function summarizeToolRequest(toolName, args = {}) {
  return String(
    args.request || args.message || args.action_label || args.title || args.query || args.description ||
    args.question || args.body || args.path || `Use SkinHarmony MCP tool ${toolName}`,
  ).slice(0, 20_000);
}

const baseHandlers = {
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
};
const dynamicHandlers = createDynamicCapabilityHandlers({
  tools: TOOLS,
  handlers: baseHandlers,
  semanticSelect: coreHandlers.core_semantic_select,
  gateAction: ({ tool, identity, catalogRevision, idempotencyKey }) => coreHandlers.core_gate_action({
    action_label: `Invoke dynamic capability ${tool.name}`,
    action_type: "dynamic_capability.invoke",
    target: tool.name,
    // These routes can only create or update the Core-owned,
    // tenant-isolated Research Distillation shadow state.  They have no
    // external side effect, and the Core runtime itself enforces shadow mode,
    // review-before-promotion and persist_verified=false.  Treating them as
    // sandboxed work lets a verified tenant owner use the compact router
    // without granting owner-root authority.  OpenAI/web research and every
    // other dynamic mutation retain the stricter owner-confirmed gate.
    operation_class: new Set([
      "nyra_research_envelope_authorize",
      "nyra_research_workspace_open",
      "nyra_research_workspace_attach",
      "nyra_research_distill",
      "nyra_research_workspace_close",
    ]).has(tool.name)
      ? "sandboxed_scoped_work"
      : "owner_confirmed_governed_action",
    dry_run: new Set([
      "nyra_research_envelope_authorize",
      "nyra_research_workspace_open",
      "nyra_research_workspace_attach",
      "nyra_research_distill",
      "nyra_research_workspace_close",
    ]).has(tool.name),
    external_side_effect: tool.annotations?.openWorldHint === true,
    destructive: tool.annotations?.destructiveHint === true,
    bounded_scope: true,
    low_impact: tool.annotations?.destructiveHint !== true,
    idempotent_or_compensable: tool.annotations?.idempotentHint === true,
    rollback_ready: tool.annotations?.idempotentHint === true,
    audit_ready: Boolean(decisionLedger),
    target_authority_verified: true,
    actor_authorized_for_target: true,
    catalog_revision: catalogRevision,
    idempotency_key: idempotencyKey,
    owner_confirmed: identity.ownerConfirmed === true,
    confirmation_reference: identity.confirmationReference,
  }, identity),
});
const handlers = { ...baseHandlers, ...dynamicHandlers };

const app = createApp(config, {
  handlers,
  toolSurface: "compact",
  beforeToolCall: async ({ identity, toolName, args }) => {
    const ledgerContext = decisionLedger ? await decisionLedger.startWork(identity, toolName, args) : null;
    try {
      if (!requiresGenericWorkPreflight(toolName)) return { preflight: null, ledgerContext };
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
      return { preflight, ledgerContext };
    } catch (error) {
      error.hookContext = { ledgerContext };
      throw error;
    }
  },
  afterToolCall: async (event) => {
    if (decisionLedger && event.hookContext?.ledgerContext) await decisionLedger.finishWork(event.hookContext.ledgerContext, event);
    if (memoryFabric) await memoryFabric.recordToolActivity(event);
  },
});
const disabledProviderPortal = (_req, res) => res
  .status(410)
  .set({
    "cache-control": "no-store, max-age=0",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
  })
  .type("html")
  .send('<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Funzione disattivata</title><body style="font-family:system-ui;max-width:560px;margin:48px auto;padding:24px"><h1>Funzione disattivata</h1><p>Il collegamento OpenAI non viene più usato. Nyra e Universal Core funzionano senza chiave API.</p><p>Puoi chiudere questa pagina e continuare normalmente in ChatGPT o Codex.</p></body></html>');

app.use(["/connect/openai", "/agents", "/mobile/agents"], disabledProviderPortal);
app.listen(config.port, () => console.log(`[skinharmony-core-mcp] listening on ${config.port}`));

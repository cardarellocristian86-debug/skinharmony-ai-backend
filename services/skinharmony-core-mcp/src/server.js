import { createApp, requiresGenericWorkPreflight } from "./app.js";
import express from "express";
import { createCollaborationHandlers } from "./collaboration-handlers.js";
import { loadConfig } from "./config.js";
import { createCoreHandlers, createCoreWriteGuard } from "./core-handlers.js";
import { createMemoryFabric, createMemoryFabricHandlers } from "./memory-fabric.js";
import { createMemoryHandlers } from "./memory-handlers.js";
import { createCloudMemoryStore } from "./cloud-memory-store.js";
import { createSharedMemoryBootstrap } from "./shared-memory-bootstrap.js";
import { createResearchCortex, createResearchHandlers } from "./research-cortex.js";
import { createDecisionLedger } from "./decision-ledger.js";
import { createWorkContinuityRuntime } from "./work-continuity-runtime.js";
import { WORK_CONTINUITY_TOOLS } from "./work-continuity-tools.js";
import { createSuiteHandlers } from "./suite-handlers.js";
import { createAuthenticator } from "./auth.js";
import { createOpenAiConnectPortal } from "./openai-connect-portal.js";
import { requireTenantWorkCapability } from "./tenant-work-authorization.js";
import { TOOLS } from "./tool-definitions.js";
import { createDynamicCapabilityHandlers } from "./dynamic-capability-router.js";

TOOLS.push(...WORK_CONTINUITY_TOOLS);

const config = loadConfig();
const cloudMemoryStore = createCloudMemoryStore(config);
const decisionLedger = createDecisionLedger(config);
const workContinuityRuntime = createWorkContinuityRuntime(config);
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
]);

function summarizeToolRequest(toolName, args = {}) {
  return String(
    args.request || args.message || args.action_label || args.title || args.query || args.description ||
    args.question || args.body || args.path || `Use SkinHarmony MCP tool ${toolName}`,
  ).slice(0, 20_000);
}

function requireTenantWorkIdentity(identity) {
  requireTenantWorkCapability(identity, "read");
}

async function requireOwnerGovernance(identity, actionType, target) {
  const decision = await govern({
    action_label: `Govern ${actionType}`,
    action_type: actionType,
    target,
    operation_class: "owner_confirmed_governed_action",
    external_side_effect: false,
    destructive: false,
    bounded_scope: true,
    low_impact: false,
    idempotent_or_compensable: true,
    rollback_ready: true,
    audit_ready: Boolean(decisionLedger),
    target_authority_verified: true,
    actor_authorized_for_target: true,
  }, identity);
  if (decision.allowed !== true) {
    const error = new Error("core_owner_authorization_required");
    error.code = "core_owner_authorization_required";
    throw error;
  }
}

async function requireBoundedTenantCoordination(identity, actionType, target) {
  requireTenantWorkCapability(identity, "coordinate");
  const decision = await govern({
    action_label: `Coordinate tenant work: ${actionType}`,
    action_type: actionType,
    target,
    operation_class: "bounded_internal_coordination_write",
    external_side_effect: false,
    contains_customer_data: false,
    contains_secret: false,
    secret_value_transmitted: false,
    cross_tenant: false,
    configuration_changes: false,
    destructive: false,
    bypass_orchestrator: false,
    provider_execution: false,
    bounded_scope: true,
    low_impact: true,
    idempotent_or_compensable: true,
    rollback_ready: true,
    audit_ready: Boolean(decisionLedger),
    target_authority_verified: true,
    actor_authorized_for_target: true,
  }, identity);
  if (decision.allowed !== true) {
    const error = new Error("core_tenant_coordination_denied");
    error.code = "core_tenant_coordination_denied";
    throw error;
  }
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
  ...(workContinuityRuntime ? {
    work_continuity_create: async (args, identity) => {
      await requireOwnerGovernance(identity, "work.continuity.create", args.project_id);
      const payload = { ok: true, result: await workContinuityRuntime.create(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    work_continuity_record_change: async (args, identity) => {
      await requireOwnerGovernance(identity, "work.continuity.record_change", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.recordChange(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    work_continuity_checkpoint: async (args, identity) => {
      await requireOwnerGovernance(identity, "work.continuity.checkpoint", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.checkpoint(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    work_continuity_read: async (args, identity) => {
      const payload = { ok: true, result: await workContinuityRuntime.read(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    work_continuity_resume: async (args, identity) => {
      const gate = await coreHandlers.core_gate_action({
        action_label: "Resume persistent Work Continuity work",
        action_type: "work_continuity.resume",
        target: args.work_id,
        operation_class: "owner_confirmed_governed_action",
        external_side_effect: false, destructive: false, bounded_scope: true, low_impact: false,
        idempotent_or_compensable: true, rollback_ready: true, audit_ready: Boolean(decisionLedger),
        target_authority_verified: true, actor_authorized_for_target: true,
        owner_confirmed: identity.ownerConfirmed === true,
        confirmation_reference: identity.confirmationReference,
      }, identity);
      const authorization = gate.structuredContent?.authorization || gate.structuredContent?.gate ||
        gate.structuredContent?.result?.authorization || {};
      const payload = { ok: true, result: await workContinuityRuntime.resume(identity, args, authorization) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    work_continuity_verify_memory: async (args, identity) => {
      await requireOwnerGovernance(identity, "work.continuity.verify_memory", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.verifyMemory(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_gallery_list: async (args, identity) => {
      requireTenantWorkIdentity(identity);
      const payload = { ok: true, result: await workContinuityRuntime.gallery(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_gallery_join: async (args, identity) => {
      await requireBoundedTenantCoordination(identity, "work.participant.join", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.join(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_gallery_heartbeat: async (args, identity) => {
      await requireBoundedTenantCoordination(identity, "work.participant.heartbeat", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.heartbeat(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_branch_open: async (args, identity) => {
      await requireBoundedTenantCoordination(identity, "work.branch.open", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.openBranch(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_lease_acquire: async (args, identity) => {
      await requireBoundedTenantCoordination(identity, "work.lease.acquire", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.acquireLease(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_lease_renew: async (args, identity) => {
      await requireBoundedTenantCoordination(identity, "work.lease.renew", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.renewLease(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_lease_release: async (args, identity) => {
      await requireBoundedTenantCoordination(identity, "work.lease.release", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.releaseLease(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_message_post: async (args, identity) => {
      await requireBoundedTenantCoordination(identity, "work.message.post", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.postMessage(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_inbox: async (args, identity) => {
      requireTenantWorkIdentity(identity);
      const payload = { ok: true, result: await workContinuityRuntime.inbox(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
  } : {}),
};
const dynamicHandlers = createDynamicCapabilityHandlers({
  tools: TOOLS,
  handlers: baseHandlers,
  semanticSelect: coreHandlers.core_semantic_select,
  gateAction: ({ tool, identity, catalogRevision, idempotencyKey }) => {
    const sandboxedResearchTools = new Set([
      "nyra_research_envelope_authorize",
      "nyra_research_workspace_open",
      "nyra_research_workspace_attach",
      "nyra_research_distill",
      "nyra_research_workspace_close",
    ]);
    const sandboxedResearch = sandboxedResearchTools.has(tool.name);
    const externalSideEffect = tool._meta?.["skinharmony/externalSideEffect"] ??
      (tool.annotations?.openWorldHint === true);
    return coreHandlers.core_gate_action({
      action_label: `Invoke dynamic capability ${tool.name}`,
      action_type: "dynamic_capability.invoke",
      target: tool.name,
      operation_class: sandboxedResearch
        ? "sandboxed_scoped_work"
        : "owner_confirmed_governed_action",
      dry_run: sandboxedResearch,
      external_side_effect: externalSideEffect === true,
      contains_customer_data: false,
      contains_secret: false,
      secret_value_transmitted: false,
      cross_tenant: false,
      configuration_changes: false,
      destructive: tool.annotations?.destructiveHint === true,
      bypass_orchestrator: false,
      legal_violation: false,
      provider_execution: false,
      bounded_scope: true,
      low_impact: tool.annotations?.destructiveHint !== true,
      idempotent_or_compensable: tool.annotations?.idempotentHint === true,
      rollback_ready: externalSideEffect !== true || tool.annotations?.idempotentHint === true,
      audit_ready: Boolean(decisionLedger),
      target_authority_verified: true,
      actor_authorized_for_target: true,
      catalog_revision: catalogRevision,
      idempotency_key: idempotencyKey,
      owner_confirmed: identity.ownerConfirmed === true,
      confirmation_reference: identity.confirmationReference,
    }, identity);
  }
});
const handlers = { ...baseHandlers, ...dynamicHandlers };

const app = createApp(config, {
  handlers,
  toolSurface: "compact",
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

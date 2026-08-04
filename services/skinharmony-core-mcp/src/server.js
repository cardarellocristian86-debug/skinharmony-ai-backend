import { createApp, requiresGenericWorkPreflight } from "./app.js";
import crypto from "node:crypto";
import { Pool } from "pg";
import { createCollaborationHandlers } from "./collaboration-handlers.js";
import { loadConfig } from "./config.js";
import { createCoreHandlers, createCoreWriteGuard } from "./core-handlers.js";
import { createMemoryFabric, createMemoryFabricHandlers } from "./memory-fabric.js";
import { createMemoryHandlers } from "./memory-handlers.js";
import { createCloudMemoryStore } from "./cloud-memory-store.js";
import { createSharedMemoryBootstrap } from "./shared-memory-bootstrap.js";
import { createResearchCortex, createResearchHandlers } from "./research-cortex.js";
import { createDecisionLedger } from "./decision-ledger.js";
import {
  coreJoinIdempotencyKey,
  createWorkContinuityRuntime,
} from "./work-continuity-runtime.js";
import { createNyraNativeTeamRuntime } from "./nyra-native-team-runtime.js";
import { createNyraAutopilotRuntime } from "./nyra-autopilot-runtime.js";
import { createWorkContinuityAutomation } from "./work-continuity-automation.js";
import {
  WORK_CONTINUITY_TOOLS,
  tenantWorkCoordinationActionType,
} from "./work-continuity-tools.js";
import { NYRA_NATIVE_TEAM_TOOLS } from "./nyra-native-team-tools.js";
import { NYRA_AUTOPILOT_TOOLS } from "./nyra-autopilot-tools.js";
import { HOST_NATIVE_TOOLS } from "./host-native-tools.js";
import { createSuiteHandlers } from "./suite-handlers.js";
import { requireTenantWorkCapability } from "./tenant-work-authorization.js";
import { TOOLS } from "./tool-definitions.js";
import { createDynamicCapabilityHandlers } from "./dynamic-capability-router.js";
import { createPostgresMajorVersionProbe } from "../../shared/postgres-major-version.js";\nimport { createWebTransport, webCompatibilityManifest } from "./web-agent-compatibility.js";

const config = loadConfig();\nconst webTransport = createWebTransport({ allowedOrigins: config.webAgentAllowedOrigins });
const hostNativeContinuityTools = new Set([
  "work_continuity_native_plan",
  "work_continuity_native_bind",
  "work_continuity_native_report",
  "work_continuity_closure_evaluate",
  "work_continuity_closure_finalize",
]);
TOOLS.push(...WORK_CONTINUITY_TOOLS.filter((tool) =>
  config.hostNativeAgentProtocolEnabled === true ||
  !hostNativeContinuityTools.has(tool.name)));
TOOLS.push(...NYRA_NATIVE_TEAM_TOOLS);
TOOLS.push(...NYRA_AUTOPILOT_TOOLS);
if (config.hostNativeAgentProtocolEnabled === true) TOOLS.push(...HOST_NATIVE_TOOLS);

const primaryDatabasePool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
      max: config.databasePoolMax || 5,
    })
  : null;
const postgresMajorVersionProbe = primaryDatabasePool
  ? createPostgresMajorVersionProbe({ pool: primaryDatabasePool })
  : null;
const cloudMemoryStore = createCloudMemoryStore(config, {
  pool: primaryDatabasePool,
});
const decisionLedger = createDecisionLedger(config, {
  pool: primaryDatabasePool,
});
const workContinuityRuntime = createWorkContinuityRuntime(config, {
  pool: primaryDatabasePool,
});
const nyraNativeTeamRuntime = createNyraNativeTeamRuntime(config, {
  pool: primaryDatabasePool,
});
const nyraAutopilotRuntime = createNyraAutopilotRuntime(config, {
  pool: primaryDatabasePool,
  teamRuntime: nyraNativeTeamRuntime,
});
const startupReadiness = {
  continuityInitialized: false,
  continuityInitializationFailed: false,
  decisionLedgerInitialized: false,
  decisionLedgerInitializationFailed: false,
};
const workContinuityAutomation = workContinuityRuntime
  ? createWorkContinuityAutomation({ runtime: workContinuityRuntime })
  : null;
const continuityRequired =
  config.workContinuityAutoCaptureEnabled === true ||
  config.hostNativeAgentProtocolEnabled === true;
if (continuityRequired && workContinuityRuntime) {
  void Promise.resolve()
    .then(() => workContinuityRuntime.initialize())
    .then(() => {
      startupReadiness.continuityInitialized = true;
    })
    .catch(() => {
      startupReadiness.continuityInitializationFailed = true;
      console.error("[skinharmony-core-mcp] continuity_initialization_failed");
    });
}
if (config.decisionLedgerRequired === true && decisionLedger) {
  void Promise.resolve()
    .then(() => decisionLedger.initialize())
    .then(() => {
      startupReadiness.decisionLedgerInitialized = true;
    })
    .catch(() => {
      startupReadiness.decisionLedgerInitializationFailed = true;
      console.error("[skinharmony-core-mcp] decision_ledger_initialization_failed");
    });
}
const sharedMemoryBootstrap = createSharedMemoryBootstrap(cloudMemoryStore, { cacheTtlMs: 300_000 });
const govern = createCoreWriteGuard(config);
const memoryFabric = config.memoryFabricRoot ? createMemoryFabric(config, { govern }) : null;
const collaborationRuntime = (config.agentWorkspaceRoot || config.collaborationDatabaseUrl)
  ? createCollaborationHandlers(config, { govern })
  : {};
const {
  registerAuthenticatedPresence,
  ...collaborationHandlers
} = collaborationRuntime;
if (config.mandatoryAgentPresenceEnabled === true && typeof registerAuthenticatedPresence !== "function") {
  throw new Error("mandatory_agent_presence_registry_unavailable");
}
const coreHandlers = createCoreHandlers(config, {
  contextProvider: memoryFabric ? (input, identity) => memoryFabric.context(input, identity) : null,
  sharedMemoryBootstrap,
  decisionLedger,
  remediationStore: workContinuityRuntime?.remediationStore,
  tenantWorkGallery: workContinuityRuntime ? {
    load: async (identity, input = {}) => {
      requireTenantWorkCapability(identity, "read");
      return workContinuityRuntime.gallery(identity, {
        project_id: input.project_id,
        status: "active",
        limit: 20,
      });
    },
    verifyActiveLease: async (identity, workId) => {
      requireTenantWorkCapability(identity, "read");
      const state = await workContinuityRuntime.read(identity, { work_id: workId });
      const sessionId = String(identity.agentPresence?.session_id || "");
      const agentId = String(identity.agentPresence?.agent_id || identity.subject || identity.agentId || "");
      const participant = state.participants.find((item) => String(item.session_id) === sessionId &&
        String(item.agent_id) === agentId && item.active === true);
      const lease = state.leases.find((item) => String(item.session_id) === sessionId &&
        item.status === "active" && Date.parse(item.expires_at) > Date.now());
      if (!participant || !lease) return null;
      return {
        lease_id: lease.lease_id,
        session_id: sessionId,
        agent_id: agentId,
        session_fingerprint: identity.agentPresence?.session_fingerprint || null,
        expires_at: lease.expires_at,
        surfaces: lease.surfaces || [],
      };
    },
  } : null,
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

async function requireBoundedTenantCoordination(identity, actionType, target, idempotencyKey) {
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
    idempotency_key: idempotencyKey,
  }, identity);
  if (decision.allowed !== true) {
    const error = new Error("core_tenant_coordination_denied");
    error.code = "core_tenant_coordination_denied";
    throw error;
  }
}

function continuityProjectId(args = {}) {
  const raw = String(args.project_id || args.repository || args.target_system || "skinharmony-ai-backend")
    .trim()
    .replace(/[^a-zA-Z0-9_.:/-]+/g, "-")
    .slice(0, 64);
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,63}$/.test(raw)
    ? raw
    : "skinharmony-ai-backend";
}

function hostType(identity, args = {}) {
  if (args.host_type === "codex_native" || args.host_type === "chatgpt_native") return args.host_type;
  return (identity.agentPresence?.client_type || args.client_type) === "codex"
    ? "codex_native"
    : "chatgpt_native";
}

function attachContinuity(preflightResult, continuity) {
  if (!continuity) return preflightResult;
  const structured = preflightResult?.structuredContent;
  if (!structured || typeof structured !== "object") return preflightResult;
  if (structured.work_preflight && typeof structured.work_preflight === "object") {
    structured.work_preflight = { ...structured.work_preflight, continuity };
  } else {
    structured.continuity = continuity;
  }
  return preflightResult;
}

async function ensureContinuity(identity, args, toolName, preflightResult, { resumeExisting = false } = {}) {
  if (!workContinuityRuntime || !config.workContinuityAutoCaptureEnabled) return null;
  const sessionId = identity.agentPresence?.session_id || args.session_id;
  if (!sessionId) throw new Error("continuity_session_required");
  const initialMessage = summarizeToolRequest(toolName, args);
  const host = hostType(identity, args);
  const continuityGateIdempotencyKey = `continuity-anchor-${crypto.createHash("sha256")
    .update(`${identity.tenantId}\u0000${continuityProjectId(args)}\u0000${sessionId}`)
    .digest("hex")
    .slice(0, 32)}`;
  const continuityGate = await coreHandlers.core_gate_action({
    action_label: "Persist a redacted immutable Work Continuity Intent Anchor",
    action_type: resumeExisting ? "work.continuity.resume_or_bind" : "continuity.update",
    target: `${continuityProjectId(args)}:${sessionId}`,
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
    deploy: false,
    production_deploy: false,
    merge: false,
    delete: false,
    execution_enabled: false,
    force: false,
    admin_bypass: false,
    bounded_scope: true,
    low_impact: true,
    idempotent_or_compensable: true,
    rollback_ready: true,
    audit_ready: Boolean(decisionLedger),
    target_authority_verified: true,
    actor_authorized_for_target: true,
    idempotency_key: continuityGateIdempotencyKey,
    owner_confirmed: false,
  }, identity);
  const authorization = continuityGate?.structuredContent?.authorization || {};
  if (authorization.allowed !== true) throw new Error("continuity_capture_not_authorized");
  const acceptanceCriteria = Array.isArray(args.acceptance_criteria) && args.acceptance_criteria.length
    ? args.acceptance_criteria
    : [
      "Deliver the complete requested outcome, not a partial fragment.",
      "Pass relevant positive, negative and regression tests.",
      "Require a distinct host-native verifier before release readiness.",
      "Use a bounded Core authorization for every external release action.",
      "Verify expected live commit and health before final closure when deployment is in scope.",
    ];
  let continuity;
  try {
    continuity = await workContinuityRuntime.ensure(identity, {
      ...(args.work_id ? { work_id: args.work_id } : {}),
      ...(args.parent_work_id ? { parent_work_id: args.parent_work_id } : {}),
      project_id: continuityProjectId(args),
      session_id: sessionId,
      initial_message: initialMessage,
      idea: String(args.idea || initialMessage).slice(0, 8_000),
      objective: String(args.objective || initialMessage).slice(0, 8_000),
      acceptance_criteria: acceptanceCriteria,
      constraints: [
        ...(Array.isArray(args.constraints) ? args.constraints : []),
        "Use ChatGPT/Codex host-native agents; do not require a provider API key.",
        "Nyra supervises; Universal Core remains final policy authority.",
        "Host sandbox, approval and auto-review policy cannot be bypassed.",
      ],
      architecture: {
        schema_version: "governed_continuity_bootstrap_v1",
        project_id: continuityProjectId(args),
        source_tool: toolName,
        host_type: host,
        provider_execution: false,
        provider_api_key_required: false,
        host_policy_override: false,
        compact_mcp_surface_size: 13,
      },
      next_action: `Continue ${toolName} through Nyra supervision and the Universal Core gate.`,
      host_type: host,
      client_type: identity.agentPresence?.client_type || args.client_type,
      agent_id: identity.agentPresence?.agent_id || args.agent_id || "connected_ai",
      resume_existing: resumeExisting,
    }, {
      // Generic preflight may resume an anchored work, but it never creates
      // one. Bootstrap is an explicit, fresh owner-governed action.
      trustedSessionFollowup: resumeExisting,
      creationAuthorized: false,
    });
  } catch (error) {
    if (error?.code !== "continuity_creation_owner_confirmation_required") throw error;
    continuity = {
      tenant_id: identity.tenantId,
      project_id: continuityProjectId(args),
      work_id: null,
      state: "owner_bootstrap_required",
      owner_governance_required: true,
      next_action: "Use work_continuity_create with a fresh, request-bound owner confirmation.",
    };
  }
  attachContinuity(preflightResult, continuity);
  return continuity;
}

function continuityTextResult(payload) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

function continuityMethod(method) {
  return async (args, identity) => continuityTextResult({
    ok: true,
    result: await workContinuityRuntime[method](identity, args),
  });
}

async function reconcileNyraAutopilot(identity, work, triggerType) {
  if (!nyraAutopilotRuntime || !work?.work_id) return null;
  try {
    return await nyraAutopilotRuntime.reconcile(identity, {
      work_id: work.work_id,
      project_id: work.project_id,
      trigger_type: triggerType,
    });
  } catch (error) {
    // Work Continuity is authoritative: a temporary Autopilot outage must
    // never make the already-persisted Work look as if it failed. The owner
    // recovery tool can reconcile this same Work later.
    return {
      work_id: work.work_id,
      status: "deferred",
      retryable: true,
      code: String(error?.message || "nyra_autopilot_unavailable").slice(0, 160),
      execution_authorized: false,
    };
  }
}

const baseHandlers = {\n  web_compatibility_manifest: async (_args, identity) => ({\n    structuredContent: { ok: true, tenant_id: identity.tenantId, manifest: webCompatibilityManifest() },\n    content: [{ type: "text", text: JSON.stringify({ ok: true, manifest: webCompatibilityManifest() }) }],\n  }),\n  web_compatibility_execute: async (args, identity) => {\n    const method = String(args.method || "GET").toUpperCase();\n    const hasBody = args.body !== undefined && args.body !== null;\n    const gate = await coreHandlers.core_gate_action({\n      action_label: "Execute allowlisted web compatibility request",\n      action_type: "web.compatibility.request",\n      target: String(args.url || "").slice(0, 512),\n      operation_class: "owner_confirmed_governed_action",\n      external_side_effect: hasBody || !["GET", "HEAD"].includes(method),\n      contains_customer_data: false,\n      contains_secret: false,\n      secret_value_transmitted: false,\n      cross_tenant: false,\n      configuration_changes: false,\n      destructive: false,\n      bypass_orchestrator: false,\n      provider_execution: false,\n      bounded_scope: true,\n      low_impact: true,\n      idempotent_or_compensable: true,\n      rollback_ready: true,\n      audit_ready: Boolean(decisionLedger),\n      target_authority_verified: true,\n      actor_authorized_for_target: true,\n      idempotency_key: args.idempotency_key || crypto.randomUUID(),\n    }, identity);\n    const authorization = gate?.structuredContent?.authorization || {};\n    if (authorization.allowed !== true) throw new Error("web_compatibility_core_gate_denied");\n    const result = await webTransport.request({ url: args.url, method, headers: args.headers || {}, body: args.body });\n    const payload = { ok: true, tenant_id: identity.tenantId, core_gate: { allowed: true, decision_id: authorization.decision_id || null }, result };\n    return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };\n  },\n
  ...coreHandlers,
  work_preflight: async (args, identity) => {
    const result = await coreHandlers.work_preflight(args, identity);
    await ensureContinuity(identity, args, "work_preflight", result, { resumeExisting: true });
    return result;
  },
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
      payload.result.nyra_autopilot = await reconcileNyraAutopilot(identity, payload.result, "work_created");
      payload.dedicated_core_gate = {
        authorized: true,
        authority: "universal_core",
        route: "/v1/action-evaluator",
        server_owned: true,
      };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    work_continuity_record_change: async (args, identity) => {
      await requireOwnerGovernance(identity, "work.continuity.record_change", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.recordChange(identity, args) };
      payload.result.nyra_autopilot = await reconcileNyraAutopilot(identity, payload.result, "work_changed");
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
        target: `work_continuity_closure_finalize:${args.work_id}`,
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
      payload.result.nyra_autopilot = await reconcileNyraAutopilot(identity, payload.result, "work_resumed");
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
      await requireBoundedTenantCoordination(
        identity,
        "work.participant.join",
        args.work_id,
        args.idempotency_key,
      );
      const payload = { ok: true, result: await workContinuityRuntime.join(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_gallery_heartbeat: async (args, identity) => {
      await requireBoundedTenantCoordination(
        identity,
        "work.participant.heartbeat",
        args.work_id,
        args.idempotency_key,
      );
      const payload = { ok: true, result: await workContinuityRuntime.heartbeat(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_branch_open: async (args, identity) => {
      await requireBoundedTenantCoordination(
        identity,
        "work.branch.open",
        args.work_id,
        args.idempotency_key,
      );
      const payload = { ok: true, result: await workContinuityRuntime.openBranch(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_lease_acquire: async (args, identity) => {
      await requireBoundedTenantCoordination(
        identity,
        "work.lease.acquire",
        args.work_id,
        args.idempotency_key,
      );
      const payload = { ok: true, result: await workContinuityRuntime.acquireLease(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_lease_renew: async (args, identity) => {
      await requireBoundedTenantCoordination(
        identity,
        "work.lease.renew",
        args.work_id,
        args.idempotency_key,
      );
      const payload = { ok: true, result: await workContinuityRuntime.renewLease(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_lease_release: async (args, identity) => {
      await requireBoundedTenantCoordination(
        identity,
        "work.lease.release",
        args.work_id,
        args.idempotency_key,
      );
      const payload = { ok: true, result: await workContinuityRuntime.releaseLease(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_message_post: async (args, identity) => {
      await requireBoundedTenantCoordination(
        identity,
        "work.message.post",
        args.work_id,
        args.idempotency_key,
      );
      const payload = { ok: true, result: await workContinuityRuntime.postMessage(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_inbox: async (args, identity) => {
      requireTenantWorkIdentity(identity);
      const payload = { ok: true, result: await workContinuityRuntime.inbox(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    work_continuity_start_or_resume: async (args, identity) => {
      requireTenantWorkCapability(identity, "read");
      await requireOwnerGovernance(identity, "work.continuity.start_or_resume", args.project_id);
      return continuityTextResult({
        ok: true,
        result: await workContinuityRuntime.ensure(identity, args, { creationAuthorized: true }),
        dedicated_core_gate: {
          authorized: true,
          authority: "universal_core",
          route: "/v1/action-evaluator",
          server_owned: true,
        },
      });
    },
    work_continuity_intent_read: continuityMethod("readIntent"),
    work_continuity_work_catalog: continuityMethod("listWorks"),
    work_continuity_native_plan: async (args, identity) => {
      const intent = await workContinuityRuntime.readIntent(identity, {
        work_id: args.work_id,
      });
      const corePlanResult = await coreHandlers.host_native_work_plan_create({
        work_id: args.work_id,
        intent_anchor_digest: intent.intent_digest,
        repository: args.repository,
        base_branch: args.base_branch,
        objective: intent.anchor?.objective,
        required_checks: args.required_checks,
        agents: args.tasks.map((task) => ({
          agent_id: task.task_id,
          role: task.kind,
          task: task.instruction,
          depends_on: task.dependencies || [],
          capabilities: [],
        })),
        max_parallel: args.max_parallel,
      }, identity);
      const corePlan = corePlanResult?.structuredContent?.plan;
      if (!corePlan) throw new Error("core_host_native_work_plan_required");
      return continuityTextResult({
        ok: true,
        result: await workContinuityRuntime.planNativeAgents(identity, args, {
          corePlan,
        }),
      });
    },
    work_continuity_native_bind: continuityMethod("bindNativeAgent"),
    work_continuity_native_report: continuityMethod("reportNativeAgent"),
    work_continuity_closure_evaluate: async (args, identity) => {
      const evaluation = await workContinuityRuntime.evaluateClosure(identity, args);
      if (evaluation.closed !== true) {
        return continuityTextResult({ ok: true, result: evaluation });
      }
      const material = evaluation.core_join_material;
      if (
        material?.schema_version !== "continuity_core_join_material_v1" ||
        material.tenant_id !== identity.tenantId ||
        !material.release_intent_request ||
        !material.core_join_request
      ) {
        throw new Error("continuity_core_join_material_required");
      }
      const releaseIntentResult = await coreHandlers.host_native_release_intent_build(
        material.release_intent_request,
        identity,
      );
      const releaseIntent = releaseIntentResult?.structuredContent?.release_intent;
      if (
        releaseIntentResult?.structuredContent?.dedicated_core_gate?.authorized !== true ||
        releaseIntentResult?.structuredContent?.tenant_id !== identity.tenantId ||
        releaseIntent?.tenant_id !== identity.tenantId ||
        releaseIntent?.work_id !== args.work_id
      ) {
        throw new Error("continuity_core_release_intent_invalid");
      }
      const coreJoinResult = await coreHandlers.host_native_core_join_issue({
        ...material.core_join_request,
        release_intent: releaseIntent,
        idempotency_key: coreJoinIdempotencyKey(material),
      }, identity);
      const coreJoinRecord = coreJoinResult?.structuredContent?.core_join_verdict;
      if (
        coreJoinResult?.structuredContent?.dedicated_core_gate?.authorized !== true ||
        coreJoinResult?.structuredContent?.tenant_id !== identity.tenantId ||
        coreJoinRecord?.tenant_id !== identity.tenantId
      ) {
        throw new Error("continuity_core_join_response_invalid");
      }
      const coreJoin = await workContinuityRuntime.bindCoreJoinVerdict(identity, {
        work_id: args.work_id,
        plan_id: args.plan_id,
        evaluation_id: evaluation.evaluation_id,
      }, {
        releaseIntent,
        coreJoinRecord,
      });
      const { core_join_material: _coreJoinMaterial, ...publicEvaluation } = evaluation;
      return continuityTextResult({
        ok: true,
        result: {
          ...publicEvaluation,
          release_ready: coreJoin.release_ready === true,
          release_intent_digest: coreJoin.release_intent_digest,
          core_join: coreJoin,
        },
      });
    },
    work_continuity_closure_finalize: async (args, identity) => {
      const coreReceipt = await coreHandlers.host_native_action_closure_receipt({
        ticket_id: args.action_ticket_id,
      }, identity);
      const authorization = coreReceipt?.structuredContent?.finalize_authorization;
      if (
        coreReceipt?.structuredContent?.tenant_id !== identity.tenantId ||
        authorization?.schema_version !== "host_native_finalize_authorization_v1" ||
        authorization?.trusted !== true ||
        authorization?.allowed !== true ||
        !/^hnf_[a-f0-9]{64}$/.test(String(authorization?.signature || "")) ||
        authorization.tenant_id !== identity.tenantId ||
        authorization.work_id !== args.work_id ||
        authorization.action_ticket_id !== args.action_ticket_id
      ) {
        throw new Error("continuity_trusted_core_closure_receipt_required");
      }
      return continuityTextResult({
        ok: true,
        result: await workContinuityRuntime.finalizeClosure(identity, args, authorization),
      });
    },
    work_continuity_atlas_upsert: continuityMethod("upsertAtlas"),
    work_continuity_atlas_select: continuityMethod("selectAtlas"),
    work_continuity_incident_record: continuityMethod("recordIncident"),
    work_continuity_incident_verify: continuityMethod("verifyIncident"),
    work_continuity_incident_resolve: continuityMethod("resolveIncident"),
  } : {}),
  ...(nyraNativeTeamRuntime ? {
    nyra_native_team_blueprints: async (_args, identity) => continuityTextResult({
      ok: true,
      tenant_id: identity.tenantId,
      result: nyraNativeTeamRuntime.blueprintCatalog(),
    }),
    nyra_native_team_status: async (args, identity) => {
      const status = await nyraNativeTeamRuntime.status(identity);
      const team = args.work_id ? await nyraNativeTeamRuntime.read(identity, args) : null;
      return continuityTextResult({ ok: true, tenant_id: identity.tenantId, status, ...(team ? { team } : {}) });
    },
    nyra_native_team_enable: async (args, identity) => {
      await requireOwnerGovernance(identity, "nyra.native_team.enable", "nyra_native_team");
      return continuityTextResult({
        ok: true,
        result: await nyraNativeTeamRuntime.enable(identity, args),
        execution_authorized: false,
      });
    },
    nyra_native_team_bootstrap: async (args, identity) => {
      await requireOwnerGovernance(identity, "nyra.native_team.bootstrap", args.work_id);
      return continuityTextResult({
        ok: true,
        result: await nyraNativeTeamRuntime.bootstrap(identity, args),
        execution_authorized: false,
      });
    },
  } : {}),
  ...(nyraAutopilotRuntime ? {
    nyra_autopilot_status: async (_args, identity) => continuityTextResult({
      ok: true,
      result: await nyraAutopilotRuntime.status(identity),
    }),
    nyra_autopilot_work_read: async (args, identity) => continuityTextResult({
      ok: true,
      result: await nyraAutopilotRuntime.readWork(identity, args),
    }),
    nyra_autopilot_enable: async (args, identity) => {
      await requireOwnerGovernance(identity, "nyra.autopilot.enable", "nyra_autopilot");
      return continuityTextResult({
        ok: true,
        result: await nyraAutopilotRuntime.enable(identity, args),
        execution_authorized: false,
      });
    },
    nyra_autopilot_reconcile: async (args, identity) => {
      await requireOwnerGovernance(identity, "nyra.autopilot.reconcile", args.work_id);
      return continuityTextResult({
        ok: true,
        result: await nyraAutopilotRuntime.reconcile(identity, {
          ...args,
          trigger_type: "reconcile",
        }),
        execution_authorized: false,
      });
    },
    nyra_work_assignment_inbox: async (args, identity) => {
      requireTenantWorkIdentity(identity);
      return continuityTextResult({ ok: true, result: await nyraAutopilotRuntime.inbox(identity, args) });
    },
    nyra_work_assignment_claim: async (args, identity) => {
      await requireBoundedTenantCoordination(identity, "nyra.assignment.claim", args.work_id);
      return continuityTextResult({ ok: true, result: await nyraAutopilotRuntime.claim(identity, args) });
    },
    nyra_work_assignment_submit: async (args, identity) => {
      await requireBoundedTenantCoordination(identity, "nyra.assignment.submit", args.work_id);
      return continuityTextResult({ ok: true, result: await nyraAutopilotRuntime.submit(identity, args) });
    },
  } : {}),
};

function internalCoordinationActionType(toolName) {
  const tenantWorkActionType = tenantWorkCoordinationActionType(toolName);
  if (tenantWorkActionType) return tenantWorkActionType;
  if (toolName === "agent_heartbeat") return "agent.heartbeat";
  if (toolName.includes("native_plan")) return "native_agent.plan";
  if (toolName.includes("native_bind")) return "native_agent.bind";
  if (toolName.includes("native_report")) return "native_agent.report";
  if (toolName.includes("closure")) return "native_agent.verify";
  if (toolName.includes("atlas")) return "work_atlas.update";
  if (toolName.includes("incident")) return "incident.record";
  if (toolName.includes("delegation_consume")) return "delegation.consume";
  return "continuity.update";
}

const researchDistillationShadowTools = new Set([
  "nyra_research_envelope_authorize",
  "nyra_research_workspace_open",
  "nyra_research_workspace_attach",
  "nyra_research_distill",
  "nyra_research_workspace_close",
]);

const dynamicHandlers = createDynamicCapabilityHandlers({
  tools: TOOLS,
  handlers: baseHandlers,
  semanticSelect: coreHandlers.core_semantic_select,
  gateAction: ({ tool, identity, catalogRevision, idempotencyKey }) => {
    const researchDistillationShadow =
      researchDistillationShadowTools.has(tool.name);
    const externalSideEffect = researchDistillationShadow
      ? false
      : tool._meta?.["skinharmony/externalSideEffect"] ??
        (tool.annotations?.openWorldHint === true);
    const ownerConfirmationRequired =
      !researchDistillationShadow &&
      tool._meta?.["skinharmony/ownerConfirmationRequired"] === true;
    const destructive =
      !researchDistillationShadow &&
      tool.annotations?.destructiveHint === true;
    return coreHandlers.core_gate_action({
      action_label: `Invoke dynamic capability ${tool.name}`,
      action_type: researchDistillationShadow
        ? "research.distillation.shadow"
        : ownerConfirmationRequired
          ? "dynamic_capability.invoke"
          : internalCoordinationActionType(tool.name),
      target: tool.name,
      operation_class: researchDistillationShadow
        ? "sandboxed_scoped_work"
        : ownerConfirmationRequired
          ? "owner_confirmed_governed_action"
          : "bounded_internal_coordination_write",
      dry_run: researchDistillationShadow,
      external_side_effect: externalSideEffect === true,
      contains_customer_data: false,
      contains_secret: false,
      secret_value_transmitted: false,
      cross_tenant: false,
      configuration_changes: false,
      destructive,
      bypass_orchestrator: false,
      legal_violation: false,
      provider_execution: false,
      bounded_scope: true,
      low_impact: !destructive,
      idempotent_or_compensable:
        researchDistillationShadow ||
        tool.annotations?.idempotentHint === true,
      rollback_ready:
        researchDistillationShadow ||
        externalSideEffect !== true ||
        tool.annotations?.idempotentHint === true,
      audit_ready: Boolean(decisionLedger),
      target_authority_verified: true,
      actor_authorized_for_target: true,
      catalog_revision: catalogRevision,
      idempotency_key: idempotencyKey,
      owner_confirmed: ownerConfirmationRequired && identity.ownerConfirmed === true,
      confirmation_reference: identity.confirmationReference,
    }, identity);
  }
});
const handlers = { ...baseHandlers, ...dynamicHandlers };

function isAgentPresenceBootstrapCall(toolName, args = {}) {
  return toolName === "agent_heartbeat" ||
    ((toolName === "core_capability_catalog" || toolName === "core_capability_invoke") &&
      args?.capability_id === "agent_heartbeat");
}

const app = createApp(config, {
  handlers,
  toolSurface: "compact",
  readiness: startupReadiness,
  postgresMajorVersionProbe,
  beforeToolCall: async ({ identity, toolName, args }) => {
    if (config.mandatoryAgentPresenceEnabled === true && !isAgentPresenceBootstrapCall(toolName, args)) {
      try {
        await registerAuthenticatedPresence(identity);
      } catch (error) {
        if (!error?.code || error.code === "core_gate_denied") error.code = "agent_presence_registration_failed";
        throw error;
      }
    }
    const ledgerContext = decisionLedger ? await decisionLedger.startWork(identity, toolName, args) : null;
    try {
      if (!requiresGenericWorkPreflight(toolName, args)) return { preflight: null, ledgerContext };
      const result = await coreHandlers.work_preflight({
        request: summarizeToolRequest(toolName, args),
        operation_type: toolName,
        tool_name: toolName,
        project_id: args.project_id,
        session_id: identity.agentPresence?.session_id || args.session_id,
        agent_id: identity.agentPresence?.agent_id || args.agent_id || args.from_agent_id || "connected_ai",
        client_type: identity.agentPresence?.client_type || args.client_type,
        ...(config.hostNativeAgentProtocolEnabled ? {
          host_type: (identity.agentPresence?.client_type || args.client_type) === "codex"
            ? "codex_native"
            : "chatgpt_native",
        } : {}),
        available_capabilities: [
          "skinharmony_core_mcp",
          toolName,
          ...(config.hostNativeAgentProtocolEnabled ? ["host_native_agents"] : []),
        ],
        owner_confirmed: identity.ownerConfirmed === true,
        confirmation_reference: identity.confirmationReference,
      }, identity);
      await ensureContinuity(identity, args, toolName, result, { resumeExisting: true });
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
    if (workContinuityAutomation) await workContinuityAutomation(event);
    // These are audit/projection writes after the governed action has already
    // returned. A projection outage must not turn a successful connector side
    // effect into a client-visible failure that encourages an unsafe replay.
    await Promise.allSettled([
      decisionLedger && event.hookContext?.ledgerContext
        ? decisionLedger.finishWork(event.hookContext.ledgerContext, event)
        : Promise.resolve(),
      memoryFabric
        ? memoryFabric.recordToolActivity(event)
        : Promise.resolve(),
    ]);
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

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
  authorizeDttExactWorkRead,
  authorizeGenericWorkCoreJoinExactWorkRead,
  coreJoinIdempotencyKey,
  createWorkContinuityRuntime,
} from "./work-continuity-runtime.js";
import {
  createGenericWorkCoreJoinMcpCoordinator,
  createGenericWorkCoreJoinVerifier,
  createWorkContinuityV2Store,
  deriveAuthenticatedTenantWorkAcl,
} from "./work-continuity-v2-store.js";
import { createNyraNativeTeamRuntime } from "./nyra-native-team-runtime.js";
import { createNyraAutopilotRuntime } from "./nyra-autopilot-runtime.js";
import {
  createNyraConverseHandler,
  createNyraConversePreflight,
  normalizeNyraDirectiveContext,
} from "./nyra-converse.js";
import {
  buildNyraNativePlanRequest,
  resolveNyraProjectReleaseBinding,
} from "./nyra-native-plan-bridge.js";
import { buildNyraControlContext } from "./nyra-control-context.js";
import {
  continuityProjectId,
  resolveContinuityProjectBinding,
} from "./continuity-project-binding.js";
import { createWorkContinuityAutomation } from "./work-continuity-automation.js";
import {
  WORK_CONTINUITY_TOOLS,
  tenantWorkCoordinationActionType,
  tenantWorkCoordinationTarget,
} from "./work-continuity-tools.js";
import { NYRA_NATIVE_TEAM_TOOLS } from "./nyra-native-team-tools.js";
import { NYRA_AUTOPILOT_TOOLS } from "./nyra-autopilot-tools.js";
import { HOST_NATIVE_TOOLS } from "./host-native-tools.js";
import { NYRA_WORK_AUTOMATION_TOOLS } from "./nyra-work-automation-tools.js";
import { createNyraWorkAutomationInternal } from "./nyra-work-automation-internal.js";
import { createSuiteHandlers } from "./suite-handlers.js";
import {
  requireTenantWorkCapability,
  requireTenantWorkRequestAuthorization,
} from "./tenant-work-authorization.js";
import { TOOLS } from "./tool-definitions.js";
import { createDynamicCapabilityHandlers } from "./dynamic-capability-router.js";
import { createPostgresMajorVersionProbe } from "../../shared/postgres-major-version.js";
import { createWebTransport, webCompatibilityManifest } from "./web-agent-compatibility.js";
import { researchAirlockToolMetadata } from "./research-airlock-reference-monitor.js";
import { issueDttAgentContext } from "../../shared/dtt-agent-identity-receipts.js";
import {
  CAUSAL_CONTINUITY_TOOLS,
  createCausalContinuityHandlers,
} from "./causal-continuity.js";
import {
  SOFTWARE_COGNITION_TOOLS,
  createSoftwareCognitionHandlers,
} from "./software-cognition.js";
import {
  ENTITY_360_TOOLS,
  createEntity360Handlers,
} from "./entity-360.js";
import {
  POLICY_REGISTRY_SIGN_ROUTE,
  POLICY_REGISTRY_SIGNER_HEALTH_ROUTE,
  NYRA_POLICY_REGISTRY_SIGN_ROUTE,
  NYRA_POLICY_REGISTRY_SIGNER_HEALTH_ROUTE,
  createPolicyRegistrySigner,
} from "./policy-registry-signer.js";
import {
  GENERIC_WORK_CORE_JOIN_SIGN_ROUTE,
  GENERIC_WORK_CORE_JOIN_SIGNER_HEALTH_ROUTE,
  createGenericWorkCoreJoinSigner,
} from "./generic-work-core-join-signer.js";
import {
  HOST_APP_CAPABILITIES,
  authenticatedHostKind,
  hostPrincipalAllows,
} from "./host-app-registry.js";
import {
  hostAppCanAccessTool,
  isNativeReportChildOperation,
  nativeReportAssignmentBootstrap,
  requireHostAppToolCapability,
} from "./host-app-authorization.js";
import {
  createNyraGovernedContinueAttestor,
  createNyraGovernedContinueHandler,
} from "./nyra-governed-continue.js";
import {
  bindWorkBootstrapRequestToAuthenticatedHost,
  governedWorkBootstrapAuthorizationTarget,
} from "./work-bootstrap-contract.js";
import { ensureNyraReadBinding } from "./nyra-read-binding.js";
import {
  createPostgresEnvironmentDelegationNonceStore,
} from "./environment-delegation.js";

const config = loadConfig();
const nyraGovernedContinueAttestor =
  config.nyraGovernedContinueEnabled === true &&
  config.nyraGovernedContinueConfigurationValid === true &&
  config.hostNativeAgentProtocolEnabled === true
    ? createNyraGovernedContinueAttestor({
        secret: config.nyraGovernedContinueSigningSecret,
      })
    : null;
const policyRegistrySigner = createPolicyRegistrySigner();
const nyraPolicyRegistrySigner = createPolicyRegistrySigner({
  prefix: "POLICY_REGISTRY_NYRA_SIGNER",
  route: NYRA_POLICY_REGISTRY_SIGN_ROUTE,
  allowedPurposes: new Set(["nyra.policy_registry.attestation", "nyra.precore.decision.v1"]),
  signatureAlgorithm: "ed25519",
  derivationDomain: "skinharmony-policy-registry-nyra-signer-v1",
});
const genericWorkCoreJoinSigner = createGenericWorkCoreJoinSigner({
  coreOrigin: config.universalCoreUrl,
});
const genericWorkCoreJoinActivationEnabled = config.genericWorkCoreJoinEnabled === true &&
  config.genericWorkCoreJoinConfigurationValid === true;
let genericWorkCoreJoinVerifier = null;
if (genericWorkCoreJoinActivationEnabled) {
  try {
    genericWorkCoreJoinVerifier = createGenericWorkCoreJoinVerifier({
      publicKey: config.genericWorkCoreJoinPublicKey,
      keyId: config.genericWorkCoreJoinKeyId,
    });
  } catch {
    genericWorkCoreJoinVerifier = null;
  }
}
const genericWorkCoreJoinVerifierMetadata = genericWorkCoreJoinVerifier?.metadata || null;
const webTransport = createWebTransport({ allowedOrigins: config.webAgentAllowedOrigins });
const hostNativeContinuityTools = new Set([
  "work_continuity_native_plan",
  "work_continuity_native_bind",
  "work_continuity_native_report",
  "work_continuity_closure_evaluate",
  "work_continuity_closure_finalize",
]);
TOOLS.push(...WORK_CONTINUITY_TOOLS.filter((tool) =>
  (config.hostNativeAgentProtocolEnabled === true || !hostNativeContinuityTools.has(tool.name)) &&
  (tool.name !== "work_continuity_generic_core_join" || genericWorkCoreJoinActivationEnabled)));
TOOLS.push(...NYRA_NATIVE_TEAM_TOOLS);
TOOLS.push(...NYRA_AUTOPILOT_TOOLS);
if (config.hostNativeAgentProtocolEnabled === true) TOOLS.push(...HOST_NATIVE_TOOLS);
if (config.hostNativeAgentProtocolEnabled === true) TOOLS.push(...NYRA_WORK_AUTOMATION_TOOLS);
TOOLS.push(...CAUSAL_CONTINUITY_TOOLS);
TOOLS.push(...SOFTWARE_COGNITION_TOOLS);
TOOLS.push(...ENTITY_360_TOOLS);

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
const environmentDelegationNonceStore =
  config.environmentDelegationReceiverEnabled === true && primaryDatabasePool
    ? createPostgresEnvironmentDelegationNonceStore({ pool: primaryDatabasePool })
    : null;
const cloudMemoryStore = createCloudMemoryStore(config, {
  pool: primaryDatabasePool,
});
const decisionLedger = createDecisionLedger(config, {
  pool: primaryDatabasePool,
});
const workContinuityRuntime = createWorkContinuityRuntime(config, {
  pool: primaryDatabasePool,
  nativeVerifierEvidenceBridgeRequired: config.hostNativeAgentProtocolEnabled === true,
});
const workContinuityV2Store = primaryDatabasePool ? createWorkContinuityV2Store({
  pool: primaryDatabasePool,
  legacyRuntime: workContinuityRuntime,
  verifierReceiptSigningSecret: config.dttAgentIdentitySigningSecret,
  coreJoinVerifier: genericWorkCoreJoinVerifier,
}) : null;
if (workContinuityRuntime && workContinuityV2Store) {
  workContinuityRuntime.setWorkEventProjector(workContinuityV2Store.projectLegacyEvent);
  // The report-to-evidence bridge is internal and shares the report
  // transaction. It is intentionally not exposed as an MCP capability.
  workContinuityRuntime.setNativeVerifierEvidenceBridge(
    workContinuityV2Store.recordNativeVerifierEvidenceWithClient,
  );
}
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
  genericWorkCoreJoinStoreInitialized: false,
  genericWorkCoreJoinStoreInitializationFailed: false,
};
const workContinuityAutomation = workContinuityRuntime
  ? createWorkContinuityAutomation({ runtime: workContinuityRuntime })
  : null;
const continuityRequired =
  config.workContinuityAutoCaptureEnabled === true ||
  config.hostNativeAgentProtocolEnabled === true;
if (continuityRequired && workContinuityRuntime) {
  void Promise.resolve()
    .then(async () => {
      await workContinuityRuntime.initialize();
      await workContinuityV2Store?.initialize();
      await workContinuityV2Store?.backfillLegacyProjection();
    })
    .then(() => {
      startupReadiness.continuityInitialized = true;
    })
    .catch(() => {
      startupReadiness.continuityInitializationFailed = true;
      console.error("[skinharmony-core-mcp] continuity_initialization_failed");
    });
}
if (genericWorkCoreJoinActivationEnabled && workContinuityV2Store) {
  void Promise.resolve()
    .then(() => workContinuityV2Store.initialize())
    .then(() => {
      startupReadiness.genericWorkCoreJoinStoreInitialized = true;
    })
    .catch(() => {
      startupReadiness.genericWorkCoreJoinStoreInitializationFailed = true;
      console.error("[skinharmony-core-mcp] generic_work_core_join_store_initialization_failed");
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
let validatePresenceRecoveryContext = null;
const collaborationRuntime = (config.agentWorkspaceRoot || config.collaborationDatabaseUrl)
  ? createCollaborationHandlers(config, {
      govern,
      validatePresenceRecoveryContext: (...args) => {
        if (typeof validatePresenceRecoveryContext !== "function") {
          throw new Error("presence_recovery_verifier_unavailable");
        }
        return validatePresenceRecoveryContext(...args);
      },
    })
  : {};
const {
  registerAuthenticatedPresence,
  ...collaborationHandlers
} = collaborationRuntime;
if (config.mandatoryAgentPresenceEnabled === true && typeof registerAuthenticatedPresence !== "function") {
  throw new Error("mandatory_agent_presence_registry_unavailable");
}

async function resolveDttWorkBinding(identity, workId) {
  requireTenantWorkCapability(identity, "read");
  if (typeof workContinuityRuntime?.resolveDttWorkLeaseBinding !== "function"
      || typeof workContinuityV2Store?.readWork !== "function") {
    throw new Error("dtt_work_binding_unavailable");
  }
  try {
    await authorizeDttExactWorkRead({
      store: workContinuityV2Store,
      identity: withTenantWorkAcl(identity),
      tenant_id: identity.tenantId,
      work_id: workId,
    });
  } catch (error) {
    const reason = String(error?.code || error?.message || "");
    if (reason === "dtt_work_binding_unavailable" || reason === "dtt_work_acl_denied") {
      throw error;
    }
    const denied = new Error("dtt_work_acl_denied");
    denied.code = "dtt_work_acl_denied";
    throw denied;
  }
  try {
    return await workContinuityRuntime.resolveDttWorkLeaseBinding(identity, {
      work_id: workId,
    });
  } catch (error) {
    if ([
      "dtt_work_active_lease_required",
      "dtt_work_signed_presence_required",
      "gallery_signed_presence_required",
      "gallery_participant_presence_mismatch",
      "tenant_work_membership_required",
      "work_id_invalid",
    ].includes(String(error?.code || error?.message || ""))) {
      throw error;
    }
    const unavailable = new Error("dtt_work_binding_unavailable");
    unavailable.code = "dtt_work_binding_unavailable";
    throw unavailable;
  }
}

async function resolveStandingReleaseIntentBinding(identity, workId) {
  requireTenantWorkCapability(identity, "read");
  if (
    typeof workContinuityRuntime?.resolveStandingReleaseIntentBinding !== "function" ||
    typeof workContinuityV2Store?.readWork !== "function"
  ) {
    throw new Error("standing_release_intent_binding_unavailable");
  }
  try {
    await authorizeDttExactWorkRead({
      store: workContinuityV2Store,
      identity: withTenantWorkAcl(identity),
      tenant_id: identity.tenantId,
      work_id: workId,
    });
  } catch (error) {
    const reason = String(error?.code || error?.message || "");
    if (reason === "dtt_work_acl_denied") throw error;
    const unavailable = new Error("standing_release_intent_binding_unavailable");
    unavailable.code = "standing_release_intent_binding_unavailable";
    throw unavailable;
  }
  try {
    return await workContinuityRuntime.resolveStandingReleaseIntentBinding(identity, {
      work_id: workId,
    });
  } catch (error) {
    const reason = String(error?.code || error?.message || "");
    if (reason.startsWith("standing_release_intent_") || reason === "work_id_invalid") {
      throw error;
    }
    const unavailable = new Error("standing_release_intent_binding_unavailable");
    unavailable.code = "standing_release_intent_binding_unavailable";
    throw unavailable;
  }
}
Object.defineProperty(resolveStandingReleaseIntentBinding, "trusted", { value: true });

async function resolveGenericWorkCoreJoinBinding(identity, workId) {
  requireTenantWorkCapability(identity, "read");
  if (typeof workContinuityRuntime?.resolveGenericWorkCoreJoinLeaseBinding !== "function"
      || typeof workContinuityV2Store?.readWork !== "function") {
    throw new Error("generic_work_core_join_work_binding_unavailable");
  }
  try {
    await authorizeGenericWorkCoreJoinExactWorkRead({
      store: workContinuityV2Store,
      identity: withTenantWorkAcl(identity),
      tenant_id: identity.tenantId,
      work_id: workId,
    });
  } catch (error) {
    const reason = String(error?.code || error?.message || "");
    if ([
      "generic_work_core_join_work_binding_unavailable",
      "generic_work_core_join_work_acl_denied",
    ].includes(reason)) {
      throw error;
    }
    const denied = new Error("generic_work_core_join_work_acl_denied");
    denied.code = "generic_work_core_join_work_acl_denied";
    throw denied;
  }
  try {
    return await workContinuityRuntime.resolveGenericWorkCoreJoinLeaseBinding(identity, {
      work_id: workId,
    });
  } catch (error) {
    if ([
      "generic_work_core_join_active_lease_required",
      "generic_work_core_join_signed_presence_required",
      "generic_work_core_join_principal_mismatch",
      "generic_work_core_join_work_acl_denied",
      "generic_work_core_join_work_id_invalid",
    ].includes(String(error?.code || error?.message || ""))) {
      throw error;
    }
    const unavailable = new Error("generic_work_core_join_work_binding_unavailable");
    unavailable.code = "generic_work_core_join_work_binding_unavailable";
    throw unavailable;
  }
}

const coreHandlers = createCoreHandlers(config, {
  contextProvider: memoryFabric ? (input, identity) => memoryFabric.context(input, identity) : null,
  sharedMemoryBootstrap,
  decisionLedger,
  remediationStore: workContinuityRuntime?.remediationStore,
  resolveDttWorkBinding,
  resolveStandingReleaseIntentBinding,
  resolveGenericWorkCoreJoinBinding,
  genericWorkCoreJoinVerifierMetadata,
  tenantWorkGallery: workContinuityRuntime ? {
    load: async (identity, input = {}) => {
      requireTenantWorkCapability(identity, "read");
      if (workContinuityV2Store) {
        return workContinuityV2Store.preflightGallery(withTenantWorkAcl(identity), {
          project_id: input.project_id,
          limit: 20,
        });
      }
      return workContinuityRuntime.gallery(identity, {
        project_id: input.project_id,
        status: "active",
        limit: 20,
      });
    },
    verifyActiveLease: async (identity, workId) => {
      try {
        return await resolveDttWorkBinding(identity, workId);
      } catch (error) {
        if (error?.message === "dtt_work_active_lease_required") return null;
        throw error;
      }
    },
  } : null,
});
const nyraWorkAutomationHandlers = config.hostNativeAgentProtocolEnabled === true
  ? createNyraWorkAutomationInternal({
      coreRequest: coreHandlers.causalCoreRequest,
      resolveIntentBinding: resolveStandingReleaseIntentBinding,
      resolveSystemVerifier: async ({ work_id }) => ({
        agent_id: `system_verifier_${crypto.createHash("sha256").update(String(work_id)).digest("hex").slice(0, 24)}`,
        system_assigned: true,
      }),
    })
  : {};
const causalContinuityHandlers = createCausalContinuityHandlers({
  coreRequest: coreHandlers.causalCoreRequest,
  issueAgentContext: ({ tenant_id, agent_presence }) => issueDttAgentContext({
    secret: config.dttAgentIdentitySigningSecret,
    tenant_id,
    agent_presence,
  }),
});
validatePresenceRecoveryContext = (args, identity) =>
  causalContinuityHandlers.causal_context_validate(args, identity);
const softwareCognitionHandlers = createSoftwareCognitionHandlers({
  coreRequest: coreHandlers.causalCoreRequest,
  atlasRuntime: workContinuityRuntime,
  repositoryBindings: config.nyraAtlasRepositoryBindings,
  githubTokens: config.nyraAtlasGithubTokens,
  issueAgentContext: ({ tenant_id, agent_presence }) => issueDttAgentContext({
    secret: config.dttAgentIdentitySigningSecret,
    tenant_id,
    agent_presence,
  }),
});
const entity360Handlers = createEntity360Handlers({
  coreRequest: coreHandlers.dttCoreRequest,
  shadowEnableCoreRequest: coreHandlers.entity360ShadowEnableCoreRequest,
  issueAgentContext: ({ tenant_id, work_id, agent_presence }) => issueDttAgentContext({
    secret: config.dttAgentIdentitySigningSecret,
    tenant_id,
    work_id,
    agent_presence,
  }),
});
const genericWorkCoreJoinCoordinator = createGenericWorkCoreJoinMcpCoordinator({
  enabled: genericWorkCoreJoinActivationEnabled,
  store: workContinuityV2Store,
  readiness: () => ({
    initialized: startupReadiness.genericWorkCoreJoinStoreInitialized === true,
    initializationFailed:
      startupReadiness.genericWorkCoreJoinStoreInitializationFailed === true,
  }),
  issueCore: (request, identity) => coreHandlers.generic_work_core_join_issue(request, identity),
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

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) =>
    value[key] === undefined ? [] : [[key, stableCanonical(value[key])]],
  ));
}

function dynamicInvocationTarget(toolName, args = {}, identity = {}) {
  if (toolName !== "core_capability_invoke") {
    return { toolName, args, capabilityId: "", argumentDigest: "" };
  }
  const capabilityId = String(args?.capability_id || "").trim();
  const targetArgs = args?.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments)
    ? args.arguments
    : {};
  const tool = TOOLS.find((item) => item.name === capabilityId);
  const normalizedArgs = { ...targetArgs };
  if (tool?._meta?.["skinharmony/tenantBoundedCollaboration"] === true) {
    const presence = identity.agentPresence || {};
    normalizedArgs.agent_id = presence.agent_id;
    normalizedArgs.session_id = presence.session_id;
    normalizedArgs.client_type = presence.client_type;
  }
  if (tool?.inputSchema?.properties?.idempotency_key &&
      normalizedArgs.idempotency_key === undefined && args.idempotency_key) {
    normalizedArgs.idempotency_key = args.idempotency_key;
  }
  if (tool?._meta?.["skinharmony/ownerConfirmationRequired"] === true) {
    normalizedArgs.owner_confirmed = args.owner_confirmed === true;
    if (args.confirmation_reference) normalizedArgs.confirmation_reference = String(args.confirmation_reference).slice(0, 240);
  }
  // This digest is derived inside the gateway from the same normalized target
  // shape that the router will validate and dispatch; it is provenance
  // metadata, never a client authority claim.
  const argumentDigest = crypto.createHash("sha256")
    .update(JSON.stringify(stableCanonical(normalizedArgs)))
    .digest("hex");
  return {
    toolName: capabilityId || toolName,
    args: normalizedArgs,
    capabilityId,
    argumentDigest,
  };
}

function requireTenantWorkIdentity(identity) {
  requireTenantWorkCapability(identity, "read");
}

async function requireOwnerGovernance(identity, actionType, target, idempotencyKey) {
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
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  }, identity);
  if (decision.allowed !== true) {
    const error = new Error("core_owner_authorization_required");
    error.code = "core_owner_authorization_required";
    throw error;
  }
  return decision;
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

function hostType(identity, _args = {}) {
  if (identity?.authenticatedHostPrincipal) {
    try {
      return authenticatedHostKind(identity);
    } catch {
      // Unregistered OAuth clients may still use Nyra's read-only resume path,
      // but never acquire host-native authority. This fallback is continuity
      // correlation only; ticket/delegation handlers require registration.
      return identity.kind === "codex" ? "codex_native" : "chatgpt_native";
    }
  }
  // Compatibility for direct internal callers predating the gateway principal
  // envelope. Public MCP requests always carry that envelope.
  return identity?.kind === "codex" ? "codex_native" : "chatgpt_native";
}

function attachContinuity(preflightResult, continuity, persistedControlContext = null) {
  if (!continuity) return preflightResult;
  const structured = preflightResult?.structuredContent;
  if (!structured || typeof structured !== "object") return preflightResult;
  const controlContext = persistedControlContext || buildNyraControlContext({ continuity });
  if (structured.work_preflight && typeof structured.work_preflight === "object") {
    structured.work_preflight = {
      ...structured.work_preflight,
      continuity,
      // Connected AIs consume this compact contract. The detailed Gallery,
      // evidence and policy graph stay server-side until a diagnostic or an
      // exact Core decision actually needs them.
      nyra_control_context: controlContext,
    };
  } else {
    structured.continuity = continuity;
    structured.nyra_control_context = controlContext;
  }
  return preflightResult;
}

// Materialize Nyra's work-scoped dialogue once in the durable control context.
// This is intentionally local/Postgres-only: an ordinary tool call never
// triggers nyra_converse, a provider model or a Universal Core round trip.
async function materializeNyraControlContext(identity, continuity, operation, {
  autopilot = null,
  force = false,
} = {}) {
  if (!continuity?.work_id || !workContinuityRuntime?.upsertControlContext) return null;
  let projectId = continuity.project_id || null;
  const expectedRevision = Number(continuity.architecture_version || continuity.work_revision || 0);
  if (!force && projectId && typeof workContinuityRuntime.readControlContext === "function") {
    const existing = await workContinuityRuntime.readControlContext(identity, {
      work_id: continuity.work_id,
      project_id: projectId,
    });
    if (
      existing &&
      existing.nyra_dialogue?.schema_version === "nyra_dialogue_context_v1" &&
      existing.nyra_dialogue?.persistent === true &&
      (!expectedRevision || Number(existing.work_revision) === expectedRevision) &&
      String(existing.next_action || "") === String(continuity.next_action || existing.next_action || "")
    ) return existing;
  }
  const operational = typeof workContinuityRuntime.readNyraOperationalState === "function"
    ? await workContinuityRuntime.readNyraOperationalState(identity, {
      work_id: continuity.work_id,
      ...(projectId ? { project_id: projectId } : {}),
    })
    : null;
  projectId = projectId || operational?.project_id || null;
  if (!projectId) return null;
  // A material change (claim, submit, incident or Atlas update) must expose
  // the actual current assignment. Read the local Autopilot ledger once;
  // this is neither a Core call nor a model invocation.
  if (!autopilot && typeof nyraAutopilotRuntime?.readWork === "function") {
    try {
      autopilot = await nyraAutopilotRuntime.readWork(identity, {
        work_id: continuity.work_id,
      });
    } catch {
      // The continuity context remains useful even if Autopilot is disabled
      // or has no run for this Work. Do not turn a completed local update into
      // a false failure.
      autopilot = null;
    }
  }
  return workContinuityRuntime.upsertControlContext(identity, {
    work_id: continuity.work_id,
    project_id: projectId,
    context: buildNyraControlContext({
      continuity: {
        ...continuity,
        project_id: projectId,
        ...(operational?.next_action ? { next_action: operational.next_action } : {}),
      },
      autopilot,
      operational,
      operation,
    }),
  });
}

async function ensureContinuity(identity, args, toolName, preflightResult, { resumeExisting = false } = {}) {
  if (!workContinuityRuntime || !config.workContinuityAutoCaptureEnabled) return null;
  const sessionId = identity.agentPresence?.session_id || args.session_id;
  if (!sessionId) throw new Error("continuity_session_required");
  const initialMessage = summarizeToolRequest(toolName, args);
  const host = hostType(identity, args);
  const authorizedResumeWorkIds = resumeExisting
    ? args.work_id
      ? (await requireCanonicalWorkRead(identity, args.work_id), [args.work_id])
      : await canonicalVisibleWorkIds(identity, { project_id: continuityProjectId(args) })
    : undefined;
  // Resuming or binding an already-authorized Work is an internal,
  // idempotent ledger operation protected by tenant/session ACLs. Routing it
  // through Core's external-action gate on *every* tool call caused a second
  // round trip and an unnecessary model-facing stop. Core gates remain
  // mandatory for scope changes and external effects (merge, deploy,
  // permissions, rollback); they are not a tax on normal continuity.
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
        "Use only server-registered host-native applications supported by the current runtime; do not require a provider API key.",
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
        compact_mcp_surface_size: 11,
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
      ...(resumeExisting ? { authorizedResumeWorkIds } : {}),
    });
  } catch (error) {
    if (error?.code === "continuity_resume_selection_required") {
      continuity = {
        tenant_id: identity.tenantId,
        project_id: continuityProjectId(args),
        work_id: null,
        state: "work_selection_required",
        owner_governance_required: false,
        candidate_work_ids: Array.isArray(error.candidate_work_ids) ? error.candidate_work_ids.slice(0, 2) : [],
        next_action: "Ask the owner which current Work to continue; do not create a duplicate Work or request a new confirmation.",
      };
    } else if (error?.code === "continuity_creation_owner_confirmation_required") {
    continuity = {
      tenant_id: identity.tenantId,
      project_id: continuityProjectId(args),
      work_id: null,
      state: "owner_bootstrap_required",
      owner_governance_required: true,
      next_action: "Ask Nyra to prepare the duplicate-reviewed canonical V2 Work bootstrap, then continue with fresh owner confirmation and Universal Core verification.",
    };
    } else {
      throw error;
    }
  }
  if (resumeExisting && continuity?.work_id) {
    continuity = {
      ...continuity,
      read_binding: await ensureNyraReadBinding({
        runtime: workContinuityRuntime,
        authorizeRead: requireCanonicalWorkRead,
        identity,
        continuity,
      }),
    };
  }
  const controlContext = await materializeNyraControlContext(identity, continuity, toolName);
  attachContinuity(preflightResult, continuity, controlContext);
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

// Mutation handlers return the freshly persisted briefing in the same answer.
// This avoids making the connected AI perform a follow-up read merely to learn
// the next state, while materializeNyraControlContext remains local/DB-only.
function continuityMethodWithNyraContext(method) {
  return async (args, identity) => {
    const result = await workContinuityRuntime[method](identity, args);
    const workId = result?.work_id || args.work_id;
    const projectId = result?.project_id || args.project_id;
    const nyraControlContext = workId
      ? await materializeNyraControlContext(identity, {
        ...result,
        work_id: workId,
        project_id: projectId,
      }, method, { force: true })
      : null;
    return continuityTextResult({
      ok: true,
      result: {
        ...result,
        ...(nyraControlContext ? { nyra_control_context: nyraControlContext } : {}),
      },
    });
  };
}

async function reconcileNyraAutopilot(identity, work, triggerType) {
  if (!nyraAutopilotRuntime || !work?.work_id) return null;
  try {
    // The first owner-governed Work is the tenant's explicit activation of
    // Nyra. Requiring a second "enable autopilot" turn created a needless
    // confirmation loop and left new chats without an orchestrator. Normal
    // resumes never broaden this: they only reuse a previously enabled Nyra.
    const status = await nyraAutopilotRuntime.status(identity);
    if (
      status.enabled !== true &&
      triggerType === "work_created" &&
      (identity.ownerConfirmed === true || identity.godMode === true)
    ) {
      await nyraAutopilotRuntime.enable(identity, {
        idempotency_key: `nyra_auto_${crypto.createHash("sha256")
          .update(`${identity.tenantId}\u0000${work.work_id}`)
          .digest("hex")
          .slice(0, 48)}`,
      });
    }
    const autopilot = await nyraAutopilotRuntime.reconcile(identity, {
      work_id: work.work_id,
      project_id: work.project_id,
      trigger_type: triggerType,
    });
    // Autopilot is a planner, not a second continuity authority.  Its run id
    // must never be handed to the native closure path: Core validates only a
    // Core-issued native plan.  Materialize that canonical plan immediately
    // when the server has an exact tenant/project release binding.
    if (autopilot?.status !== "materialized") return autopilot;
    const binding = resolveNyraProjectReleaseBinding(config.nyraProjectReleaseBindings, {
      tenantId: identity.tenantId,
      projectId: work.project_id,
    });
    if (!binding) {
      return {
        ...autopilot,
        native_plan: {
          status: "deferred",
          retryable: false,
          code: "nyra_project_release_binding_not_found",
          execution_authorized: false,
        },
      };
    }
    try {
      await ensureNativePlanLegacyBridge(identity, work.work_id);
      const intent = await readLegacyIntentAuthorized(identity, { work_id: work.work_id });
      const request = buildNyraNativePlanRequest({ identity, work, intent, autopilot, binding });
      const corePlanResult = await coreHandlers.host_native_work_plan_create({
        work_id: request.work_id,
        intent_anchor_digest: intent.intent_digest,
        repository: request.repository,
        base_branch: request.base_branch,
        objective: intent.anchor?.objective,
        required_checks: request.required_checks,
        agents: request.tasks.map((task) => ({
          agent_id: task.task_id,
          role: task.kind,
          task: task.instruction,
          depends_on: task.dependencies || [],
          capabilities: [],
        })),
        max_parallel: request.max_parallel,
      }, identity);
      const corePlan = corePlanResult?.structuredContent?.plan;
      if (!corePlan) throw new Error("core_host_native_work_plan_required");
      const nativePlan = await workContinuityRuntime.planNativeAgents(identity, request, { corePlan });
      return {
        ...autopilot,
        native_plan: {
          status: "planned",
          plan_id: nativePlan.plan.plan_id,
          plan_digest: nativePlan.plan_digest,
          idempotent_replay: nativePlan.idempotent_replay === true,
          execution_authorized: false,
        },
      };
    } catch (error) {
      // The Work remains usable and the same deterministic request is retried
      // on the next reconcile.  Do not turn a transient Core outage into a
      // fake completed Autopilot plan or ask the owner to recreate the Work.
      return {
        ...autopilot,
        native_plan: {
          status: "deferred",
          retryable: true,
          code: String(error?.message || "nyra_native_plan_unavailable").slice(0, 160),
          execution_authorized: false,
        },
      };
    }
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

function withTenantWorkAcl(identity) {
  // `authenticatedTenantMembership` is populated only by the authenticated MCP
  // identity layer. Tool arguments and legacy convenience flags are never read.
  return { ...identity, tenant_work_acl: deriveAuthenticatedTenantWorkAcl(identity) };
}

function legacyWorkAclError(code, status = 403) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

async function requireCanonicalWorkRead(identity, workId) {
  requireTenantWorkCapability(identity, "read");
  if (!workContinuityV2Store?.readWork) {
    throw legacyWorkAclError("continuity_work_acl_unavailable", 503);
  }
  try {
    await workContinuityV2Store.readWork(withTenantWorkAcl(identity), { work_id: workId });
  } catch (error) {
    const reason = String(error?.code || error?.message || "");
    if (reason === "work_acl_denied" || reason === "tenant_work_not_found" ||
        reason === "legacy_work_not_found" || reason.startsWith("tenant_work_membership_")) {
      throw legacyWorkAclError("continuity_work_acl_denied");
    }
    throw error;
  }
}

async function canonicalVisibleWorkIds(identity, { project_id } = {}) {
  requireTenantWorkCapability(identity, "read");
  if (!workContinuityV2Store?.listWorks) {
    throw legacyWorkAclError("continuity_work_acl_unavailable", 503);
  }
  const aclIdentity = withTenantWorkAcl(identity);
  const [operational, archive] = await Promise.all([
    workContinuityV2Store.listWorks(aclIdentity, { view: "operational", project_id }),
    workContinuityV2Store.listWorks(aclIdentity, { view: "archive", project_id }),
  ]);
  const ids = [...new Set([...operational, ...archive].map((work) => String(work?.work_id || ""))
    .filter(Boolean))];
  if (ids.length > 10_000) {
    throw legacyWorkAclError("continuity_work_acl_scope_too_large", 503);
  }
  return ids;
}

async function readLegacyWorkAuthorized(identity, args) {
  await requireCanonicalWorkRead(identity, args.work_id);
  return workContinuityRuntime.read(identity, args);
}

async function readLegacyIntentAuthorized(identity, args) {
  await requireCanonicalWorkRead(identity, args.work_id);
  return workContinuityRuntime.readIntent(identity, args);
}

async function ensureNativePlanLegacyBridge(identity, workId) {
  // A bridge reconstruction writes only the linked tenant Work state. It is
  // therefore an operator action, never a fictitious generic "govern" role.
  requireTenantWorkCapability(identity, "operate");
  if (typeof workContinuityV2Store?.ensureLegacyBridge !== "function") {
    throw legacyWorkAclError("continuity_legacy_bridge_unavailable", 503);
  }
  return workContinuityV2Store.ensureLegacyBridge(withTenantWorkAcl(identity), { work_id: workId });
}

async function listLegacyWorksAuthorized(identity, args = {}) {
  if (typeof workContinuityRuntime?.listWorksAuthorized !== "function") {
    throw legacyWorkAclError("continuity_work_acl_unavailable", 503);
  }
  const workIds = await canonicalVisibleWorkIds(identity, { project_id: args.project_id });
  return workContinuityRuntime.listWorksAuthorized(identity, args, {
    schema_version: "legacy_work_read_authorization_v1",
    server_derived: true,
    tenant_id: identity.tenantId,
    work_ids: workIds,
  });
}

async function galleryLegacyWorksAuthorized(identity, args = {}) {
  if (typeof workContinuityRuntime?.galleryAuthorized !== "function") {
    throw legacyWorkAclError("continuity_work_acl_unavailable", 503);
  }
  const workIds = await canonicalVisibleWorkIds(identity, { project_id: args.project_id });
  return workContinuityRuntime.galleryAuthorized(identity, args, {
    schema_version: "legacy_work_read_authorization_v1",
    server_derived: true,
    tenant_id: identity.tenantId,
    work_ids: workIds,
  });
}

const governedLegacyReadRuntime = workContinuityRuntime ? Object.freeze({
  listWorks: listLegacyWorksAuthorized,
  readIntent: readLegacyIntentAuthorized,
}) : null;

function requireHostWorkCreateCapability(identity) {
  if (identity?.authenticatedHostPrincipal &&
      !hostPrincipalAllows(identity, HOST_APP_CAPABILITIES.WORK_CREATE)) {
    const error = new Error("registered_host_work_create_capability_required");
    error.code = "registered_host_work_create_capability_required";
    error.status = 403;
    throw error;
  }
}

async function reviewCanonicalWorkCreation(args, identity) {
  if (!workContinuityV2Store) throw new Error("work_continuity_v2_store_unavailable");
  requireHostWorkCreateCapability(identity);
  const request = bindWorkBootstrapRequestToAuthenticatedHost({
    request: args?.create_request || {},
    identity,
  });
  await requireBoundedTenantCoordination(
    identity,
    "work.bootstrap.review",
    governedWorkBootstrapAuthorizationTarget({
      phase: "review",
      request,
      identity,
    }),
    args.idempotency_key,
  );
  return continuityTextResult({
    ok: true,
    result: await workContinuityV2Store.openWorkReview(withTenantWorkAcl(identity), {
      request: args.request,
      intent_type: "CREATE_WORK",
      create_request: request,
    }),
    dedicated_core_gate: {
      authorized: true,
      authority: "universal_core",
      route: "/v1/action-evaluator",
      server_owned: true,
    },
  });
}

async function createCanonicalWorkGoverned(args, identity) {
  if (!workContinuityV2Store) throw new Error("work_continuity_v2_store_unavailable");
  requireHostWorkCreateCapability(identity);
  const boundRequest = bindWorkBootstrapRequestToAuthenticatedHost({ request: args, identity });
  const governanceIdempotencyKey = String(boundRequest.idempotency_key || "").trim() ||
    `work_bootstrap_${crypto.createHash("sha256").update(JSON.stringify(stableCanonical({
      tenant_id: identity.tenantId,
      subject: identity.subject,
      project_id: boundRequest.project_id,
      request_id: boundRequest.request_id || boundRequest.session_id,
    }))).digest("hex").slice(0, 48)}`;
  const request = Object.freeze({
    ...boundRequest,
    idempotency_key: governanceIdempotencyKey,
  });
  const authorizationTarget = governedWorkBootstrapAuthorizationTarget({
    phase: "create",
    request,
    identity,
  });
  // Exact retries first consult the durable tenant+subject+request mapping.
  // This readback is evidence, never renewed authority: it permits recovery
  // after the short Core receipt expires without invoking Core again or
  // creating/mutating a Work. Every binding and event digest is independently
  // revalidated by the V2 store.
  if (typeof workContinuityV2Store.readCreatedWorkByBootstrapRequest === "function") {
    const persisted = await workContinuityV2Store.readCreatedWorkByBootstrapRequest(
      withTenantWorkAcl(identity),
      request,
    );
    if (persisted) {
      if (persisted.persisted_core_authorization_receipt?.target !== authorizationTarget) {
        const error = new Error("work_bootstrap_replay_evidence_invalid");
        error.code = "work_bootstrap_replay_evidence_invalid";
        error.status = 503;
        throw error;
      }
      return continuityTextResult({
        ok: true,
        result: persisted,
        legacy_work_id: persisted.legacy_work_id,
        core_authorization_receipt: null,
        core_authorization_attempt_receipt: null,
        dedicated_core_gate: {
          authorized: false,
          authority: "universal_core",
          route: "durable_work_bootstrap_readback",
          server_owned: true,
          readback_only: true,
        },
      });
    }
  }
  const coreDecision = await requireOwnerGovernance(
    identity,
    "work.continuity.v2.create",
    authorizationTarget,
    request.idempotency_key,
  );
  if (!coreDecision.core_authorization_receipt ||
      coreDecision.core_authorization_receipt.authority !== "universal_core") {
    const error = new Error("core_authorization_receipt_required");
    error.code = "core_authorization_receipt_required";
    error.status = 503;
    throw error;
  }
  const receiptMaterial = {
    schema_version: "work_bootstrap_core_authorization_receipt_v2",
    authority: "universal_core",
    route: "/v1/action-evaluator",
    target: authorizationTarget,
    decision_id: coreDecision.decision_id || null,
    decision: coreDecision.decision,
    mediation: coreDecision.mediation,
    owner_confirmation_required: coreDecision.owner_confirmation_required === true,
    confirmation_satisfied: coreDecision.confirmation_satisfied === true,
    core_authorization_receipt: coreDecision.core_authorization_receipt,
  };
  const coreAuthorizationReceipt = Object.freeze({
    ...receiptMaterial,
    receipt_digest: crypto.createHash("sha256")
      .update(JSON.stringify(stableCanonical(receiptMaterial)))
      .digest("hex"),
  });
  const result = await workContinuityV2Store.createNewWork(withTenantWorkAcl(identity), {
    ...request,
    _core_authorization_receipt: coreAuthorizationReceipt,
  });
  const attemptMaterial = {
    schema_version: "work_bootstrap_core_authorization_attempt_v1",
    authority: "universal_core",
    work_bootstrap_authorization_receipt: coreAuthorizationReceipt,
    core_authorization_attempt_receipt: coreDecision.core_authorization_attempt_receipt,
    core_idempotent_replay: coreDecision.idempotent_replay === true,
  };
  const coreAuthorizationAttemptReceipt = Object.freeze({
    ...attemptMaterial,
    attempt_digest: crypto.createHash("sha256")
      .update(JSON.stringify(stableCanonical(attemptMaterial)))
      .digest("hex"),
  });
  return continuityTextResult({
    ok: true,
    result,
    legacy_work_id: result.legacy_work_id,
    // Only a newly persisted creation owns the durable receipt. An exact
    // replay still has a fresh Core attempt decision, exposed separately,
    // without rewriting or misattributing the original Work event evidence.
    core_authorization_receipt: result.core_authorization_receipt,
    core_authorization_attempt_receipt: coreAuthorizationAttemptReceipt,
    dedicated_core_gate: {
      authorized: true,
      authority: "universal_core",
      route: "/v1/action-evaluator",
      server_owned: true,
    },
  });
}

async function readNyraDirectiveContext(identity, args) {
  if (!workContinuityV2Store) return null;
  try {
    const tenantWorkIdentity = withTenantWorkAcl(identity);
    const context = await workContinuityV2Store.readWork(
      tenantWorkIdentity,
      { work_id: args.work_id },
    );
    const status = String(context?.work?.status || "").toUpperCase();
    if (["COMPLETED", "ARCHIVED"].includes(status) &&
        typeof workContinuityV2Store.verifyWorkClosure === "function") {
      return {
        ...context,
        closure_verification: await workContinuityV2Store.verifyWorkClosure(
          tenantWorkIdentity,
          { work_id: args.work_id },
        ),
      };
    }
    return context;
  } catch (error) {
    // A legacy Work may not have a V2 projection for a non-admin reader yet.
    // Keep advisory work available, but leave every consequential ticket in
    // NEEDS_CONTEXT until the governed projection exists. ACL/binding errors
    // are never converted into absence.
    if (String(error?.message || "") === "tenant_work_not_found") return null;
    throw error;
  }
}

const nyraConverseHandler = createNyraConverseHandler({
  preflight: createNyraConversePreflight({
    workPreflight: (args, identity) => coreHandlers.work_preflight(args, identity),
    ensureContinuity,
    resolveContinuityProjectBinding,
    workContinuityRuntime: governedLegacyReadRuntime,
    hostType,
  }),
  interpret: (args, identity) => coreHandlers.nyra_interpret_request(args, identity),
  readControlContext: async (identity, args) => {
    await requireCanonicalWorkRead(identity, args.work_id);
    return workContinuityRuntime.readControlContext(identity, args);
  },
  readDirectiveContext: readNyraDirectiveContext,
  issueContinuation: nyraGovernedContinueAttestor
    ? ({ identity, directive }) => nyraGovernedContinueAttestor.issue({ identity, directive })
    : null,
});

const nyraGovernedContinueHandler = nyraGovernedContinueAttestor
  ? createNyraGovernedContinueHandler({
      attestor: nyraGovernedContinueAttestor,
      readDirectiveContext: readNyraDirectiveContext,
      normalizeDirectiveContext: normalizeNyraDirectiveContext,
      issueDelegation: (args, identity) => coreHandlers.host_native_delegation_issue(args, identity),
      authorizeAction: (args, identity) => coreHandlers.host_native_action_authorize(args, identity),
      reviewWorkBootstrap: reviewCanonicalWorkCreation,
      createWorkBootstrap: createCanonicalWorkGoverned,
    })
  : null;

const baseHandlers = {
  ...nyraWorkAutomationHandlers,
  nyra_converse: nyraConverseHandler,
  ...(nyraGovernedContinueHandler
    ? { nyra_governed_continue: nyraGovernedContinueHandler }
    : {}),
  web_compatibility_manifest: async (_args, identity) => ({
    structuredContent: { ok: true, tenant_id: identity.tenantId, manifest: webCompatibilityManifest() },
    content: [{ type: "text", text: JSON.stringify({ ok: true, manifest: webCompatibilityManifest() }) }],
  }),
  web_compatibility_execute: async (args, identity) => {
    const method = String(args.method || "GET").toUpperCase();
    const hasBody = args.body !== undefined && args.body !== null;
    const gate = await coreHandlers.core_gate_action({
      action_label: "Execute allowlisted web compatibility request",
      action_type: "web.compatibility.request",
      target: String(args.url || "").slice(0, 512),
      operation_class: "owner_confirmed_governed_action",
      external_side_effect: hasBody || !["GET", "HEAD"].includes(method),
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
      idempotency_key: args.idempotency_key || crypto.randomUUID(),
    }, identity);
    const authorization = gate?.structuredContent?.authorization || {};
    if (authorization.allowed !== true) throw new Error("web_compatibility_core_gate_denied");
    const result = await webTransport.request({ url: args.url, method, headers: args.headers || {}, body: args.body });
    const payload = { ok: true, tenant_id: identity.tenantId, core_gate: { allowed: true, decision_id: authorization.decision_id || null }, result };
    return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
  },

  ...coreHandlers,
  ...causalContinuityHandlers,
  ...softwareCognitionHandlers,
  ...entity360Handlers,
  work_preflight: async (args, identity) => {
    const continuityBinding = await resolveContinuityProjectBinding(
      identity,
      args,
      governedLegacyReadRuntime,
      { preferPersistedWorkProject: true },
    );
    const result = await coreHandlers.work_preflight({
      ...args,
      project_id: continuityBinding.projectId,
    }, identity);
    await ensureContinuity(identity, continuityBinding.continuityArgs, "work_preflight", result,
      { resumeExisting: true });
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
      requireHostWorkCreateCapability(identity);
      const error = new Error("canonical_work_bootstrap_v2_required");
      error.code = "canonical_work_bootstrap_v2_required";
      error.status = 409;
      throw error;
    },
    work_continuity_record_change: async (args, identity) => {
      await requireCanonicalWorkRead(identity, args.work_id);
      await requireOwnerGovernance(identity, "work.continuity.record_change", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.recordChange(identity, args) };
      payload.result.nyra_autopilot = await reconcileNyraAutopilot(identity, payload.result, "work_changed");
      payload.result.nyra_control_context = await materializeNyraControlContext(
        identity,
        payload.result,
        "work_changed",
        { autopilot: payload.result.nyra_autopilot, force: true },
      );
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    work_continuity_checkpoint: async (args, identity) => {
      await requireCanonicalWorkRead(identity, args.work_id);
      await requireOwnerGovernance(identity, "work.continuity.checkpoint", args.work_id);
      // requireOwnerGovernance above is the server-owned Universal Core decision
      // for this exact checkpoint. Do not invoke the generic gate again: the
      // confirmation assertion is request-bound, and a second evaluation can
      // reject an action already authorized by the authoritative Core gate.
      const payload = { ok: true, result: await workContinuityRuntime.checkpoint(identity, args) };
      payload.result.nyra_control_context = await materializeNyraControlContext(
        identity,
        { ...payload.result, project_id: args.project_id, next_action: args.next_action },
        "checkpoint_created",
        { force: true },
      );
      payload.dedicated_core_gate = {
        authorized: true,
        authority: "universal_core",
        route: "/v1/action-evaluator",
        server_owned: true,
      };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    work_continuity_read: async (args, identity) => {
      const payload = { ok: true, result: await readLegacyWorkAuthorized(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    work_continuity_resume: async (args, identity) => {
      await requireCanonicalWorkRead(identity, args.work_id);
      const gate = await coreHandlers.core_gate_action({
        action_label: "Resume persistent Work Continuity work",
        action_type: "work.continuity.resume",
        target: `work_continuity_resume:${args.work_id}`,
        operation_class: "owner_confirmed_governed_action",
        external_side_effect: false, destructive: false, bounded_scope: true, low_impact: false,
        idempotent_or_compensable: true, rollback_ready: true, audit_ready: Boolean(decisionLedger),
        target_authority_verified: true, actor_authorized_for_target: true,
        owner_confirmed: identity.ownerConfirmed === true,
        confirmation_reference: identity.confirmationReference,
      }, identity);
      const authorization = gate.structuredContent?.authorization || gate.structuredContent?.gate ||
        gate.structuredContent?.result?.authorization || {};
      if (authorization.allowed !== true) throw new Error("work_continuity_resume_not_authorized");
      const payload = { ok: true, result: await workContinuityRuntime.resume(identity, args, authorization) };
      payload.result.nyra_autopilot = await reconcileNyraAutopilot(identity, payload.result, "work_resumed");
      payload.result.nyra_control_context = await materializeNyraControlContext(
        identity,
        payload.result,
        "work_resumed",
        { autopilot: payload.result.nyra_autopilot, force: true },
      );
      payload.dedicated_core_gate = {
        authorized: true,
        authority: "universal_core",
        route: "/v1/action-evaluator",
        server_owned: true,
      };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    work_continuity_verify_memory: async (args, identity) => {
      await requireCanonicalWorkRead(identity, args.work_id);
      await requireOwnerGovernance(identity, "work.continuity.verify_memory", args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.verifyMemory(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_gallery_list: async (args, identity) => {
      const payload = { ok: true, result: await galleryLegacyWorksAuthorized(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    tenant_work_gallery_join: async (args, identity) => {
      await requireCanonicalWorkRead(identity, args.work_id);
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
      await requireCanonicalWorkRead(identity, args.work_id);
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
      await requireCanonicalWorkRead(identity, args.work_id);
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
      await requireCanonicalWorkRead(identity, args.work_id);
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
      await requireCanonicalWorkRead(identity, args.work_id);
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
      await requireCanonicalWorkRead(identity, args.work_id);
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
      await requireCanonicalWorkRead(identity, args.work_id);
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
      await requireCanonicalWorkRead(identity, args.work_id);
      const payload = { ok: true, result: await workContinuityRuntime.inbox(identity, args) };
      return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
    work_continuity_start_or_resume: async (args, identity) => {
      const authorizedResumeWorkIds = args.work_id
        ? (await requireCanonicalWorkRead(identity, args.work_id), [args.work_id])
        : await canonicalVisibleWorkIds(identity, { project_id: args.project_id });
      const resumeIdempotencyKey = `work_resume_${crypto.createHash("sha256")
        .update(JSON.stringify(stableCanonical({
          tenant_id: identity.tenantId,
          work_id: args.work_id || null,
          project_id: args.project_id,
          session_id: identity.agentPresence?.session_id || args.session_id,
        })))
        .digest("hex").slice(0, 40)}`;
      await requireBoundedTenantCoordination(
        identity,
        "work.continuity.start_or_resume",
        String(args.work_id || args.project_id || "resume_existing"),
        resumeIdempotencyKey,
      );
      return continuityTextResult({
        ok: true,
        result: await workContinuityRuntime.ensure(identity, {
          ...args,
          resume_existing: true,
        }, {
          creationAuthorized: false,
          trustedSessionFollowup: true,
          authorizedResumeWorkIds,
        }),
        dedicated_core_gate: {
          authorized: true,
          authority: "universal_core",
          route: "/v1/action-evaluator",
          server_owned: true,
        },
      });
    },
    work_continuity_intent_read: async (args, identity) => continuityTextResult({ ok: true,
      result: await readLegacyIntentAuthorized(identity, args) }),
    work_continuity_work_catalog: async (args, identity) => continuityTextResult({ ok: true,
      result: await listLegacyWorksAuthorized(identity, args) }),
    work_continuity_v2_create: createCanonicalWorkGoverned,
    tenant_work_queue_create_v3: async (args, identity) => {
      if (!workContinuityV2Store) throw new Error("work_continuity_v2_store_unavailable");
      await requireBoundedTenantCoordination(
        identity,
        tenantWorkCoordinationActionType("tenant_work_queue_create_v3"),
        tenantWorkCoordinationTarget("tenant_work_queue_create_v3", args),
        args.idempotency_key,
      );
      return continuityTextResult({ ok: true,
        result: await workContinuityV2Store.queueNewWork(withTenantWorkAcl(identity), args),
        dedicated_core_gate: {
          authorized: true,
          authority: "universal_core",
          route: "/v1/action-evaluator",
          server_owned: true,
        } });
    },
    work_continuity_v2_read: async (args, identity) => continuityTextResult({ ok: true,
      result: await workContinuityV2Store.readWork(withTenantWorkAcl(identity), args) }),
    tenant_work_gallery_list_v2: async (args, identity) => continuityTextResult({ ok: true,
      result: await workContinuityV2Store.listWorks(withTenantWorkAcl(identity), args) }),
    tenant_work_assign_v3: async (args, identity) => {
      if (!workContinuityV2Store) throw new Error("work_continuity_v2_store_unavailable");
      await requireBoundedTenantCoordination(
        identity,
        tenantWorkCoordinationActionType("tenant_work_assign_v3"),
        tenantWorkCoordinationTarget("tenant_work_assign_v3", args),
        args.idempotency_key,
      );
      return continuityTextResult({ ok: true,
        result: await workContinuityV2Store.assignQueuedWork(withTenantWorkAcl(identity), args) });
    },
    tenant_work_assignment_accept_v3: async (args, identity) => {
      if (!workContinuityV2Store) throw new Error("work_continuity_v2_store_unavailable");
      await requireBoundedTenantCoordination(
        identity,
        tenantWorkCoordinationActionType("tenant_work_assignment_accept_v3"),
        tenantWorkCoordinationTarget("tenant_work_assignment_accept_v3", args),
        args.idempotency_key,
      );
      return continuityTextResult({ ok: true,
        result: await workContinuityV2Store.acceptQueuedWorkAssignment(withTenantWorkAcl(identity), args) });
    },
    tenant_work_archive_v3: async (args, identity) => {
      if (!workContinuityV2Store) throw new Error("work_continuity_v2_store_unavailable");
      await requireBoundedTenantCoordination(
        identity,
        tenantWorkCoordinationActionType("tenant_work_archive_v3"),
        tenantWorkCoordinationTarget("tenant_work_archive_v3", args),
        args.idempotency_key,
      );
      return continuityTextResult({ ok: true,
        result: await workContinuityV2Store.archiveWork(withTenantWorkAcl(identity), args) });
    },
    tenant_work_reopen_v3: async (args, identity) => {
      if (!workContinuityV2Store) throw new Error("work_continuity_v2_store_unavailable");
      await requireBoundedTenantCoordination(
        identity,
        tenantWorkCoordinationActionType("tenant_work_reopen_v3"),
        tenantWorkCoordinationTarget("tenant_work_reopen_v3", args),
        args.idempotency_key,
      );
      return continuityTextResult({ ok: true,
        result: await workContinuityV2Store.reopenWork(withTenantWorkAcl(identity), args) });
    },
    tenant_work_open_review: async (args, identity) => {
      // This is deliberately the only pre-Work write. It may persist a
      // short-lived duplicate review, but never creates or mutates a Work;
      // creation remains on the dedicated Universal Core route below.
      return reviewCanonicalWorkCreation({
        ...args,
        idempotency_key: args.idempotency_key || `review_${crypto.randomUUID()}`,
      }, identity);
    },
    tenant_work_task_record: async (args, identity) => {
      requireTenantWorkCapability(identity, "operate");
      return continuityTextResult({ ok: true, result: await workContinuityV2Store.recordTask(withTenantWorkAcl(identity), args) });
    },
    tenant_work_evidence_record: async (args, identity) => {
      requireTenantWorkCapability(identity, "review_candidate");
      return continuityTextResult({ ok: true, result: await workContinuityV2Store.recordEvidence(withTenantWorkAcl(identity), args) });
    },
    tenant_work_stale_reconcile_dry_run: async (args, identity) => continuityTextResult({ ok: true,
      result: await workContinuityV2Store.reconcileStaleDryRun(withTenantWorkAcl(identity), args) }),
    tenant_work_legacy_reconcile_close: async (args, identity) => {
      await requireOwnerGovernance(
        identity,
        "work.continuity.legacy_reconcile_close",
        `${args.work_id}:${args.action}`,
      );
      return continuityTextResult({ ok: true,
        result: await workContinuityV2Store.reconcileLegacyClosed(withTenantWorkAcl(identity), args),
        dedicated_core_gate: {
          authorized: true,
          authority: "universal_core",
          route: "/v1/action-evaluator",
          server_owned: true,
        } });
    },
    work_continuity_generic_core_join: async (args, identity) => {
      const aclIdentity = withTenantWorkAcl(identity);
      const { result, verdict } = await genericWorkCoreJoinCoordinator({ args, identity, aclIdentity });
      return continuityTextResult({ ok: true, result, generic_core_join_verdict: verdict,
        dedicated_core_gate: { authorized: true, authority: "universal_core", route: "/v1/work-continuity/generic-core-join", server_owned: true } });
    },
    work_continuity_generic_closure_evaluate: async (args, identity) => continuityTextResult({ ok: true,
      result: await workContinuityV2Store.evaluateGenericClosure(withTenantWorkAcl(identity), args) }),
    work_continuity_generic_closure_finalize: async (args, identity) => continuityTextResult({ ok: true,
      result: await workContinuityV2Store.finalizeGenericClosure(withTenantWorkAcl(identity), args),
      dedicated_core_gate: { authorized: true, authority: "universal_core", route: "/v1/work/core-join-verdicts", server_owned: true } }),
    work_continuity_native_plan: async (args, identity) => {
      requireHostAppToolCapability({
        identity,
        toolName: "work_continuity_native_plan",
        tools: TOOLS,
      });
      const nativeArgs = identity?.authenticatedHostPrincipal
        ? { ...args, host_type: authenticatedHostKind(identity) }
        : args;
      await ensureNativePlanLegacyBridge(identity, nativeArgs.work_id);
      const intent = await readLegacyIntentAuthorized(identity, {
        work_id: nativeArgs.work_id,
      });
      const corePlanResult = await coreHandlers.host_native_work_plan_create({
        work_id: nativeArgs.work_id,
        intent_anchor_digest: intent.intent_digest,
        repository: nativeArgs.repository,
        base_branch: nativeArgs.base_branch,
        objective: intent.anchor?.objective,
        required_checks: nativeArgs.required_checks,
        agents: nativeArgs.tasks.map((task) => ({
          agent_id: task.task_id,
          role: task.kind,
          task: task.instruction,
          depends_on: task.dependencies || [],
          capabilities: [],
        })),
        max_parallel: nativeArgs.max_parallel,
      }, identity);
      const corePlan = corePlanResult?.structuredContent?.plan;
      if (!corePlan) throw new Error("core_host_native_work_plan_required");
      return continuityTextResult({
        ok: true,
        result: await workContinuityRuntime.planNativeAgents(identity, nativeArgs, {
          corePlan,
        }),
      });
    },
    work_continuity_native_bind: async (args, identity) => {
      requireHostAppToolCapability({
        identity,
        toolName: "work_continuity_native_bind",
        tools: TOOLS,
      });
      const nativeArgs = identity?.authenticatedHostPrincipal
        ? { ...args, host_type: authenticatedHostKind(identity) }
        : args;
      return continuityTextResult({
        ok: true,
        result: await workContinuityRuntime.bindNativeAgent(identity, nativeArgs),
      });
    },
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
    work_continuity_atlas_upsert: continuityMethodWithNyraContext("upsertAtlas"),
    work_continuity_atlas_select: continuityMethod("selectAtlas"),
    work_continuity_incident_record: continuityMethodWithNyraContext("recordIncident"),
    work_continuity_incident_verify: continuityMethodWithNyraContext("verifyIncident"),
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
      const result = await nyraAutopilotRuntime.reconcile(identity, {
        ...args,
        trigger_type: "reconcile",
      });
      const nyraControlContext = await materializeNyraControlContext(identity, result, "nyra_autopilot_reconcile", {
        autopilot: result,
        force: true,
      });
      return continuityTextResult({
        ok: true,
        result: { ...result, ...(nyraControlContext ? { nyra_control_context: nyraControlContext } : {}) },
        execution_authorized: false,
      });
    },
    nyra_work_assignment_inbox: async (args, identity) => {
      requireTenantWorkIdentity(identity);
      return continuityTextResult({ ok: true, result: await nyraAutopilotRuntime.inbox(identity, args) });
    },
    nyra_work_assignment_claim: async (args, identity) => {
      await requireBoundedTenantCoordination(identity, "nyra.assignment.claim", args.work_id);
      const result = await nyraAutopilotRuntime.claim(identity, args);
      const nyraControlContext = await materializeNyraControlContext(identity, result, "nyra_work_assignment_claim", { force: true });
      return continuityTextResult({ ok: true, result: { ...result, ...(nyraControlContext ? { nyra_control_context: nyraControlContext } : {}) } });
    },
    nyra_work_assignment_submit: async (args, identity) => {
      await requireBoundedTenantCoordination(identity, "nyra.assignment.submit", args.work_id);
      const result = await nyraAutopilotRuntime.submit(identity, args);
      const nyraControlContext = await materializeNyraControlContext(identity, result, "nyra_work_assignment_submit", { force: true });
      return continuityTextResult({ ok: true, result: { ...result, ...(nyraControlContext ? { nyra_control_context: nyraControlContext } : {}) } });
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
  // The repository bootstrap is the initial bounded Atlas write. Its name
  // predates the common `atlas` suffix, therefore classify it explicitly.
  if (toolName === "software_cognition_repository_bootstrap" || toolName.includes("atlas")) return "work_atlas.update";
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
  internallyGovernedCapabilities: ["agent_heartbeat"],
  capabilityVisible: ({ tool, identity }) => {
    // Once the server has admitted a native child for this request, give the
    // dynamic router a single-capability view. Do not union it with ordinary
    // work.read visibility: the assignment is a one-task grant, not a wider
    // discovery token.
    if (identity?.nativeReportAdmission?.capability_id === "work_continuity_native_report") {
      return tool.name === "work_continuity_native_report";
    }
    return hostAppCanAccessTool({ identity, toolName: tool.name, tools: TOOLS });
  },
  gateAction: ({ tool, args, identity, catalogRevision, idempotencyKey, workPreflight }) => {
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
      target: tenantWorkCoordinationTarget(tool.name, args),
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
      work_preflight: workPreflight,
      dynamic_capability: workPreflight?.dynamic_capability,
      work_binding: workPreflight?.work_binding,
      owner_confirmed: ownerConfirmationRequired && identity.ownerConfirmed === true,
      confirmation_reference: identity.confirmationReference,
    }, identity);
  }
});
const handlers = { ...baseHandlers, ...dynamicHandlers };

function isAgentPresenceBootstrapCall(toolName, args = {}) {
  const heartbeatArgs = toolName === "core_capability_invoke" ? args?.arguments : args;
  const metadataFree = heartbeatArgs && typeof heartbeatArgs === "object" && !Array.isArray(heartbeatArgs) &&
    !Object.hasOwn(heartbeatArgs, "display_name") &&
    !Object.hasOwn(heartbeatArgs, "capabilities") &&
    !Object.hasOwn(heartbeatArgs, "recovery_context");
  return metadataFree && (toolName === "agent_heartbeat" ||
    ((toolName === "core_capability_catalog" || toolName === "core_capability_invoke") &&
      args?.capability_id === "agent_heartbeat"));
}

const POLICY_REGISTRY_PREFLIGHT_OPERATION = Object.freeze({
  nyra_policy_registry_activate: "policy.snapshot.activate",
  nyra_policy_registry_rollback: "policy.snapshot.rollback",
  nyra_policy_registry_reconcile: "policy.snapshot.reconcile",
});

// Read-only dialogue preparation must stay cheap. Only persisted Work changes
// invalidate the briefing; ordinary reads and `nyra_converse` itself never do.
const NYRA_DIALOGUE_MATERIAL_CHANGE_TOOLS = new Set([
  "work_continuity_native_plan",
  "work_continuity_native_bind",
  "work_continuity_native_report",
  "nyra_autopilot_reconcile",
  "nyra_work_assignment_claim",
  "nyra_work_assignment_submit",
  "work_continuity_atlas_upsert",
  "work_continuity_incident_record",
  "work_continuity_incident_verify",
  "software_cognition_graph_upsert",
  "software_cognition_index_diff",
  "software_cognition_repository_bootstrap",
  "software_cognition_traceability_build",
  "software_cognition_architecture_recover",
  "software_cognition_calibration_update",
  "software_cognition_impact_reconcile",
  "software_cognition_runtime_observe",
  "software_cognition_learning_promote",
  "software_cognition_research_bind",
  "software_cognition_precore_decide",
]);

async function refreshNyraDialogueAfterMaterialChange(event = {}) {
  // `afterToolCall` also runs on rejected gates and handler failures. Those
  // paths must record their incident, but must never publish a self-model that
  // claims a material mutation was applied.
  if (event.error) return null;
  // The app hook observes the public wrapper (`core_capability_invoke`), not
  // its dynamic capability. Resolve the server-owned inner target so an Atlas
  // write actually invalidates Nyra's cached self-model.
  const target = dynamicInvocationTarget(event.toolName, event.args, event.identity);
  const materialToolName = target.toolName;
  if (!NYRA_DIALOGUE_MATERIAL_CHANGE_TOOLS.has(materialToolName)) return null;
  const payload = event.preflight?.preflight?.work_preflight ||
    event.preflight?.preflight || event.preflight?.work_preflight || event.preflight || {};
  const continuity = payload.continuity && typeof payload.continuity === "object"
    ? payload.continuity
    : null;
  if (!continuity?.work_id || !continuity?.project_id) return null;
  return materializeNyraControlContext(event.identity, continuity, materialToolName, { force: true });
}

const app = createApp(config, {
  handlers,
  toolSurface: "compact",
  ...(environmentDelegationNonceStore ? { environmentDelegationNonceStore } : {}),
  readiness: startupReadiness,
  genericWorkCoreJoin: {
    storeConfigured: Boolean(workContinuityV2Store),
    verifier: genericWorkCoreJoinVerifier,
  },
  postgresMajorVersionProbe,
  beforeToolCall: async ({ identity, toolName, args }) => {
    // Enforce the authenticated application policy before presence, cache,
    // preflight, dynamic dispatch or any other read/write side effect. The
    // dynamic wrappers are resolved to their exact capability here, so an app
    // cannot inherit a user's Work permissions or bypass its registry grant.
    const hostAuthorization = requireHostAppToolCapability({
      identity, toolName, args, tools: TOOLS,
    });
    // The catalog and compact invoke wrapper normally see only the registered
    // app's ambient upper bound. A spawned child is different: before the
    // router can expose its sole terminal capability, verify its actual MCP
    // transport, live lease and signed one-task assignment. The marker is
    // server-owned on this per-call identity and is never accepted from args.
    const nativeReportBootstrap = nativeReportAssignmentBootstrap(toolName, args);
    if (nativeReportBootstrap) {
      if (!workContinuityRuntime?.admitNativeAgentReport) {
        const error = new Error("native_agent_report_admission_unavailable");
        error.code = "native_agent_report_admission_unavailable";
        throw error;
      }
      const admission = await workContinuityRuntime.admitNativeAgentReport(
        identity,
        nativeReportBootstrap,
      );
      Object.defineProperty(identity, "nativeReportAdmission", {
        value: admission,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
    // Every path that can discover, bind or create generic Work context must
    // first prove subject membership. This runs before presence, the decision
    // ledger, Core preflight, Gallery lookup and continuity, even when the
    // exact dynamic target is not itself a Work-prefixed tool.
    requireTenantWorkRequestAuthorization(identity, {
      hostAuthorization,
      toolName,
      genericWorkPreflightRequired: requiresGenericWorkPreflight(toolName, args),
    });
    // Exact Work visibility precedes presence registration, Airlock/Core
    // calls, ledger writes and continuity session bindings. A generic or
    // dynamic tool must not use preflight as a tenant-only read oracle for a
    // private canonical Work.
    if (requiresGenericWorkPreflight(toolName, args)) {
      const authorizationTarget = dynamicInvocationTarget(toolName, args, identity);
      if (authorizationTarget.args.work_id) {
        await requireCanonicalWorkRead(identity, authorizationTarget.args.work_id);
      }
    }
    // Native reports are authenticated by the child transport binding plus the
    // one-time assignment capability, exact task binding and lease in the
    // continuity runtime. Re-registering that child in the generic presence
    // registry first rejects a legitimate independently spawned child because
    // its transport session is intentionally not the coordinator session.
    // Keep mandatory presence for every other operation.
    const nativeChildReport = isNativeReportChildOperation(toolName, args);
    if (config.mandatoryAgentPresenceEnabled === true &&
        !nativeChildReport &&
        !isAgentPresenceBootstrapCall(toolName, args)) {
      try {
        await registerAuthenticatedPresence(identity);
      } catch (error) {
        if (!error?.code || error.code === "core_gate_denied") error.code = "agent_presence_registration_failed";
        throw error;
      }
    }
    const presenceSessionId = String(identity.agentPresence?.session_id || "").trim();
    if (presenceSessionId) {
      const toolMetadata = researchAirlockToolMetadata(toolName, args, TOOLS);
      const authorization = await coreHandlers.nyra_research_airlock_session_tool_authorize({
        session_id: presenceSessionId,
        ...toolMetadata,
      }, identity);
      const decision = authorization?.structuredContent?.decision;
      if (decision?.verdict !== "ALLOW") {
        const error = new Error(decision?.reason || "research_airlock_external_tool_closed");
        error.code = decision?.reason || "research_airlock_external_tool_closed";
        error.status = 403;
        throw error;
      }
    }
    const ledgerContext = decisionLedger ? await decisionLedger.startWork(identity, toolName, args) : null;
    try {
      if (!requiresGenericWorkPreflight(toolName, args)) return { preflight: null, ledgerContext };
      const target = dynamicInvocationTarget(toolName, args, identity);
      const continuityBinding = await resolveContinuityProjectBinding(
        identity,
        target.args,
        governedLegacyReadRuntime,
        { preferPersistedWorkProject: true },
      );
      const result = await coreHandlers.work_preflight({
        request: summarizeToolRequest(target.toolName, target.args),
        operation_type: target.capabilityId
          ? `dynamic_capability:${target.capabilityId}`
          : (POLICY_REGISTRY_PREFLIGHT_OPERATION[toolName] || toolName),
        tool_name: target.toolName,
        // Dynamic capabilities that require a preflight must receive the
        // complete server-issued envelope. The compact response intentionally
        // omits governance detail and therefore cannot satisfy Universal
        // Core's preflight gate.
        response_mode: "full",
        work_id: target.args.work_id,
        project_id: continuityBinding.projectId,
        session_id: identity.agentPresence?.session_id || target.args.session_id,
        agent_id: identity.agentPresence?.agent_id || target.args.agent_id || target.args.from_agent_id || "connected_ai",
        client_type: identity.agentPresence?.client_type || target.args.client_type,
        ...(config.hostNativeAgentProtocolEnabled ? {
          host_type: hostType(identity, target.args),
        } : {}),
        available_capabilities: [
          "skinharmony_core_mcp",
          target.toolName,
          ...(config.hostNativeAgentProtocolEnabled ? ["host_native_agents"] : []),
        ],
        owner_confirmed: identity.ownerConfirmed === true,
        confirmation_reference: identity.confirmationReference,
        ...(target.capabilityId ? {
          dynamic_capability: {
            capability_id: target.capabilityId,
            argument_digest: target.argumentDigest,
          },
          work_binding: {
            work_id: String(target.args.work_id || ""),
            project_id: continuityBinding.projectId,
            session_id: String(identity.agentPresence?.session_id || target.args.session_id || ""),
            agent_id: String(identity.agentPresence?.agent_id || target.args.agent_id || ""),
          },
        } : {}),
      }, identity);
      await ensureContinuity(
        identity,
        continuityBinding.continuityArgs,
        target.toolName,
        result,
        { resumeExisting: true },
      );
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
      refreshNyraDialogueAfterMaterialChange(event),
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
app.get(POLICY_REGISTRY_SIGNER_HEALTH_ROUTE, (_req, res) => res
  .status(policyRegistrySigner.health().ready ? 200 : 503)
  .set("cache-control", "no-store")
  .json(policyRegistrySigner.health()));
app.post(POLICY_REGISTRY_SIGN_ROUTE, (req, res) => policyRegistrySigner.handle(req, res));
app.get(NYRA_POLICY_REGISTRY_SIGNER_HEALTH_ROUTE, (_req, res) => res
  .status(nyraPolicyRegistrySigner.health().ready ? 200 : 503)
  .set("cache-control", "no-store")
  .json(nyraPolicyRegistrySigner.health()));
app.post(NYRA_POLICY_REGISTRY_SIGN_ROUTE, (req, res) => nyraPolicyRegistrySigner.handle(req, res));
app.get(GENERIC_WORK_CORE_JOIN_SIGNER_HEALTH_ROUTE, (_req, res) => res
  .status(genericWorkCoreJoinSigner.health().ready ? 200 : 503)
  .set("cache-control", "no-store")
  .json(genericWorkCoreJoinSigner.health()));
app.post(GENERIC_WORK_CORE_JOIN_SIGN_ROUTE, async (req, res) => genericWorkCoreJoinSigner.handle(req, res));
app.listen(config.port, () => console.log(`[skinharmony-core-mcp] listening on ${config.port}`));

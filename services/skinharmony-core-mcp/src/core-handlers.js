import crypto from "node:crypto";
import { attachSharedMemoryBootstrap } from "./shared-memory-bootstrap.js";
import { createAgentPresence } from "./agent-presence.js";
import { issueDttAgentContext } from "../../shared/dtt-agent-identity-receipts.js";
import { readCoreCapabilityCatalog } from "./core-capability-catalog.js";
import {
  CORE_BLOCK_CLASS,
  CORE_BLOCK_PROPOSAL_TYPES,
  CORE_BLOCK_REMEDIATION_STATUS,
  buildDeterministicBlockExplanation,
  buildResubmissionContext,
  openCoreBlockRemediation,
  classifyCoreBlock,
  compareScopeDigest,
  deriveContinuationScope,
  deriveRecommendedNextAction,
  detectRemediationBypass,
  evaluateEvidenceRequirements,
  evaluateRollback,
  evaluateTests,
  proposeRemediationAttempt,
  reviewRemediationProposal,
  validateProposalForRemediation,
} from "../../shared/core-block-remediation.js";
import { createCoreBlockRemediationStore } from "./core-block-remediation-store.js";
import {
  AI_WORK_FAILURE_DEFINITIONS,
  buildAiWorkQualityObservation,
} from "../../shared/ai-work-quality-failure.js";
import {
  nyraDeepV2EvidencePackHash,
  signNyraDeepV2McpRequest,
} from "./nyra-deep-v2-mcp-request.js";
import { isCodexGoodModeDelegation } from "./auth.js";
import {
  AI_WORK_QUALITY_SCHEMA_VERSION,
  mediateFailureObservation,
} from "../../shared/ai-work-quality-failure-mediation.mjs";
import {
  DTT_WORK_CONTEXT_HEADER,
  canonicalDttWorkContextBody,
  issueDttWorkContext,
} from "../../shared/dtt-work-context.js";
import {
  GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER,
  GENERIC_WORK_CORE_JOIN_LEASE_BINDING_VERSION,
  canonicalGenericWorkCoreJoinContextBody,
  issueGenericWorkCoreJoinContext,
} from "../../shared/generic-work-core-join-context.js";

const OWNER_CONTEXT_ASSERTION_VERSION = "owner_context_assertion_v1";
const POLICY_REGISTRY_WORK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const POLICY_REGISTRY_OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/;
const POLICY_REGISTRY_DOMAIN_PACK_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/;
const POLICY_REGISTRY_SHA256 = /^[a-f0-9]{64}$/;
const POLICY_REGISTRY_PACK_ID = /^[a-z0-9][a-z0-9._/-]{1,159}$/;
const POLICY_REGISTRY_PACK_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const POLICY_REGISTRY_PACK_REFERENCE = /^[a-z0-9][a-z0-9._/-]{1,159}@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const POLICY_REGISTRY_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const POLICY_REGISTRY_COMPILER_INPUT_LIMIT_BYTES = 512 * 1024;
const POLICY_REGISTRY_SNAPSHOT_LIMIT_BYTES = 512 * 1024;
const POLICY_REGISTRY_REQUEST_LIMIT_BYTES = 1_572_864;
const POLICY_REGISTRY_RESPONSE_LIMIT_BYTES = 128 * 1024;
const POLICY_REGISTRY_CORE_TIMEOUT_MS = 3_000;
const ICF_RUNTIME_ATTESTATION_SCHEMA = "nyra.icf.runtime-attestation/1.0";
const ICF_GENERIC_JOIN_BACKENDS = new Set(["postgres_append_only_v1", "unavailable"]);
const ICF_GENERIC_JOIN_STATES = new Set([
  "durability_or_signing_unavailable",
  "failed",
  "initializing",
  "ready",
  "signer_unavailable",
  "unavailable",
]);
const ICF_GENERIC_JOIN_SIGNER_STATES = new Set([
  "configured",
  "unavailable",
  "unconfigured",
]);
const ICF_GENERIC_JOIN_REASON = /^generic_work_core_join_[a-z0-9_]+$/;
const POLICY_REGISTRY_FORBIDDEN_CALLER_FIELDS = new Set([
  "authenticated_tenant_id", "work_preflight", "owner_context",
  "proof", "receipt", "attestation", "intent", "keys", "key_material",
  "activation_attestation", "policy_registry_attestation", "core_receipt",
  "compiler_provenance", "compiler_provenance_digest", "compiler_build_commit",
  "catalog_digest", "trust_catalog_digest", "trust_catalog", "trusted_issuers",
  "compiler_now",
]);
const POLICY_REGISTRY_FORBIDDEN_CONSTRAINT_CONTROL_FIELDS = new Set([
  "authority", "authorization", "issuer", "issuer_key_id", "key_id",
  "trust_mode", "trust_catalog", "trust_catalog_digest", "trusted_issuer", "trusted_issuers",
  "compiler_algorithm", "compiler_build_commit", "compiler_now", "compiler_provenance",
  "compiler_provenance_digest", "verification_algorithm", "catalog_digest", "traversal_budget",
  "signature_quorum", "signature_threshold", "required_signatures", "signing_key_id",
]);
const POLICY_REGISTRY_SAFE_UPSTREAM_ERRORS = new Set([
  "policy_registry_owner_confirmation_required",
  "policy_registry_core_authorization_denied",
  "policy_registry_request_scope_invalid",
  "policy_proof_tenant_denied",
  "policy_proof_work_binding_invalid",
  "policy_registry_request_schema_invalid",
  "policy_registry_request_invalid",
  "policy_registry_preflight_binding_invalid",
  "policy_registry_snapshot_not_pure",
  "policy_registry_snapshot_invalid",
  "policy_registry_authorization_digest_invalid",
  "policy_compiler_input_invalid",
  "policy_compiler_input_oversize",
  "policy_compiler_input_leaf_invalid",
  "policy_compiler_input_pack_invalid",
  "policy_compiler_input_pack_status_invalid",
  "policy_compiler_input_signature_invalid",
  "policy_compiler_input_noncanonical",
  "policy_compiler_constraints_invalid",
  "policy_compiler_verify_input_invalid",
  "policy_compiler_tenant_invalid",
  "policy_compiler_domain_invalid",
  "policy_compiler_domain_untrusted",
  "policy_compiler_snapshot_invalid",
  "policy_compiler_snapshot_mismatch",
  "policy_compiler_pack_set_mismatch",
  "policy_compiler_root_unverified",
  "policy_compiler_signature_quorum_invalid",
  "policy_compiler_provenance_invalid",
  "policy_proof_binding_invalid",
  "policy_proof_attestation_invalid",
  "policy_activation_core_receipt_invalid",
  "policy_snapshot_signature_quorum_invalid",
  "policy_proof_not_found",
  "policy_proof_consumption_not_found",
  "policy_rollback_snapshot_not_found",
  "policy_proof_idempotency_conflict",
  "policy_proof_owner_replayed",
  "policy_proof_cas_conflict",
  "policy_activation_core_receipt_replayed",
  "policy_operation_idempotency_conflict",
  "policy_operation_binding_invalid",
  "policy_registry_concurrent_mutation",
  "policy_registry_reconciliation_required",
  "policy_registry_cas_conflict",
  "policy_registry_state_corrupt",
  "policy_registry_compiler_provenance_missing",
  "policy_registry_compiler_provenance_invalid",
  "policy_rollback_compiler_provenance_missing",
  "policy_proof_reconciliation_not_ready",
  "policy_registry_coordinator_unavailable",
  "policy_registry_compiler_unavailable",
  "policy_compiler_unavailable",
  "policy_compiler_clock_unavailable",
  "policy_registry_unavailable",
  "policy_registry_postgres_required",
  "policy_registry_postgres_unavailable",
  "policy_proof_unavailable",
  "policy_proof_signer_unavailable",
  "policy_registry_nyra_busy",
  "policy_registry_nyra_client_unavailable",
  "policy_registry_nyra_redirect_denied",
  "policy_registry_nyra_rejected",
  "policy_registry_nyra_response_binding_invalid",
  "policy_registry_nyra_response_json_invalid",
  "policy_registry_nyra_response_too_large",
  "policy_registry_nyra_timeout",
  "policy_registry_nyra_unavailable",
  "policy_registry_result_binding_invalid",
  "policy_registry_operation_failed",
]);
const POLICY_REGISTRY_ROUTES = Object.freeze({
  activate: Object.freeze({
    path: "/v1/nyra-policy-registry/activate",
    purpose: "nyra_policy_registry_snapshot_activate_v3",
    action: "policy.snapshot.activate",
    responseField: "activation",
    successField: "activated",
  }),
  rollback: Object.freeze({
    path: "/v1/nyra-policy-registry/rollback",
    purpose: "nyra_policy_registry_snapshot_rollback_v3",
    action: "policy.snapshot.rollback",
    responseField: "rollback",
    successField: "rolled_back",
  }),
  reconcile: Object.freeze({
    path: "/v1/nyra-policy-registry/reconcile",
    purpose: "nyra_policy_registry_snapshot_reconcile_v3",
    action: "policy.snapshot.reconcile",
    responseField: "reconciliation",
    successField: "reconciled",
  }),
});
const NYRA_DEEP_V2_PREFLIGHT_OPERATION = Object.freeze({
  preview: "nyra_v2_preview",
  requirements: "nyra_v2_requirements",
  prepare_evidence: "nyra_v2_evidence_prepare",
  evaluate: "nyra_v2_evaluate",
});

function tenantContextHeader(tenantId, signingSecret) {
  if (Buffer.byteLength(String(signingSecret || ""), "utf8") < 32) return "";
  const context = { version: "mcp_tenant_context_v1", tenant_id: tenantId, issued_at: new Date().toISOString() };
  const canonical = JSON.stringify(context);
  const assertion = `mtc_${crypto.createHmac("sha256", signingSecret).update(`mcp-tenant-context\u0000${canonical}`).digest("hex")}`;
  return Buffer.from(JSON.stringify({ ...context, assertion })).toString("base64url");
}

function ownerContextCanonical(context) {
  return JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
    owner_subject_fingerprint: context.owner_subject_fingerprint,
    issued_at: context.issued_at,
    binding_version: context.binding_version,
    binding_hash: context.binding_hash,
    approval_digest: context.approval_digest,
  });
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

export function classifyRemediationResubmissionOutcome(payload = {}) {
  const allowed = payload?.authorization?.allowed === true || payload?.allowed === true;
  const verdict = String(payload?.authorization?.state || payload?.decision_contract?.state ||
    payload?.decision_contract?.verdict || "").toUpperCase();
  const confirmationRequired = payload?.authorization?.confirmation_required === true ||
    ["CONFIRM", "CONFIRMATION_REQUIRED"].includes(verdict);
  return {
    allowed,
    confirmationRequired,
    verdict,
    status: allowed ? CORE_BLOCK_REMEDIATION_STATUS.ALLOWED
      : confirmationRequired ? CORE_BLOCK_REMEDIATION_STATUS.WAITING_OWNER
        : CORE_BLOCK_REMEDIATION_STATUS.REVISION_REQUIRED,
  };
}

function ownerRequestBinding(purpose, body = {}) {
  const { owner_context: _ownerContext, ...payload } = body;
  return `${purpose}\u0000${JSON.stringify(stableCanonical(payload))}`;
}

function textResult(payload) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }]
  };
}

function unavailableIcfGenericWorkCoreJoin(reason) {
  return Object.freeze({
    enabled: false,
    state: "unavailable",
    ready: false,
    backend: "unavailable",
    restart_durable: false,
    distributed: false,
    signer_mode: "hmac_icf",
    signer_state: "unavailable",
    signer_configured: false,
    reason,
  });
}

export function projectIcfGenericWorkCoreJoinAttestation(attestation, { unavailable = false } = {}) {
  if (unavailable) {
    return unavailableIcfGenericWorkCoreJoin(
      "generic_work_core_join_attestation_unavailable",
    );
  }
  const join = attestation?.generic_work_core_join;
  const shapeValid = attestation
    && typeof attestation === "object"
    && !Array.isArray(attestation)
    && attestation.ok === true
    && attestation.schema === ICF_RUNTIME_ATTESTATION_SCHEMA
    && join
    && typeof join === "object"
    && !Array.isArray(join)
    && typeof join.enabled === "boolean"
    && typeof join.ready === "boolean"
    && ICF_GENERIC_JOIN_STATES.has(join.state)
    && ICF_GENERIC_JOIN_BACKENDS.has(join.backend)
    && typeof join.restart_durable === "boolean"
    && typeof join.distributed === "boolean"
    && join.signer_mode === "hmac_icf"
    && ICF_GENERIC_JOIN_SIGNER_STATES.has(join.signer_state)
    && typeof join.signer_configured === "boolean"
    && (join.signer_configured === (join.signer_state === "configured"))
    && (join.reason === null || ICF_GENERIC_JOIN_REASON.test(String(join.reason || "")));
  if (!shapeValid) {
    return unavailableIcfGenericWorkCoreJoin(
      "generic_work_core_join_attestation_invalid",
    );
  }
  const positive = join.enabled === true
    && join.ready === true
    && join.state === "ready"
    && join.backend === "postgres_append_only_v1"
    && join.restart_durable === true
    && join.distributed === true
    && join.signer_state === "configured"
    && join.signer_configured === true
    && join.reason === null;
  const negative = join.enabled === false
    && join.ready === false
    && join.state !== "ready"
    && ICF_GENERIC_JOIN_REASON.test(String(join.reason || ""));
  if (!positive && !negative) {
    return unavailableIcfGenericWorkCoreJoin(
      "generic_work_core_join_attestation_invalid",
    );
  }
  return Object.freeze({
    enabled: join.enabled,
    state: join.state,
    ready: join.ready,
    backend: join.backend,
    restart_durable: join.restart_durable,
    distributed: join.distributed,
    signer_mode: join.signer_mode,
    signer_state: join.signer_state,
    signer_configured: join.signer_configured,
    reason: join.reason,
  });
}

function dedicatedCoreTextResult(payload, route) {
  return textResult({
    ...payload,
    dedicated_core_gate: {
      authorized: payload?.ok === true,
      authority: "universal_core",
      route,
      provider_execution: false,
      host_policy_override: false,
    },
  });
}

function standingReleaseAutoDigest(evidence) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableCanonical(evidence)))
    .digest("hex");
}

function compactTextResult(payload, narration = {}) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(narration) }],
  };
}

function compactMemoryContext(memory) {
  if (!memory || typeof memory !== "object") return null;
  return {
    schema_version: memory.schema_version,
    tenant_id: memory.tenant_id,
    revision: Number(memory.revision || 0),
    relevant_count: Array.isArray(memory.relevant_memories) ? memory.relevant_memories.length : 0,
    handoff_count: Array.isArray(memory.pending_handoffs) ? memory.pending_handoffs.length : 0,
    recent_activity_count: Array.isArray(memory.recent_activity) ? memory.recent_activity.length : 0,
  };
}

function compactBootstrap(bootstrap) {
  if (!bootstrap || typeof bootstrap !== "object") return undefined;
  return {
    loaded: bootstrap.loaded === true,
    tenant_id: bootstrap.tenant_id,
    generated_at: bootstrap.generated_at,
    active_task_count: Number(bootstrap.active_task_count || 0),
    active_lock_count: Number(bootstrap.active_lock_count || 0),
    artifact_count: Number(bootstrap.artifact_count || 0),
    latest_handoff: bootstrap.latest_handoff,
    recent_tasks: Array.isArray(bootstrap.recent_tasks) ? bootstrap.recent_tasks.slice(0, 5) : [],
    recent_artifacts: Array.isArray(bootstrap.recent_artifacts) ? bootstrap.recent_artifacts.slice(0, 5) : [],
    ...(bootstrap.loaded === false ? { missing_files: bootstrap.missing_files || [] } : {}),
  };
}

function compactGalleryBootstrap(gallery, tenantId) {
  const source = gallery && typeof gallery === "object" && !Array.isArray(gallery) ? gallery : {};
  const works = Array.isArray(source.works) ? source.works.slice(0, 20).map((work) => ({
    work_id: work.work_id,
    project_id: work.project_id,
    status: work.status,
    current_version: Number(work.current_version || 0),
    next_action: work.next_action,
    updated_at: work.updated_at,
    active_participants: Number(work.active_participants || 0),
    active_leases: Number(work.active_leases || 0),
    active_branches: Number(work.active_branches || 0),
  })) : [];
  return {
    schema_version: source.schema_version || "tenant_work_gallery_v1",
    tenant_id: tenantId,
    available: source.available === true,
    state: source.state || (source.available === true ? "ready" : "runtime_unavailable"),
    generated_at: source.generated_at,
    work_count: Number.isInteger(source.work_count) ? source.work_count : works.length,
    filters: source.filters && typeof source.filters === "object" ? source.filters : {},
    works,
  };
}

function compactWorkPreflight(preflight) {
  if (!preflight || typeof preflight !== "object") return null;
  return {
    schema_version: preflight.schema_version,
    preflight_id: preflight.preflight_id,
    tenant_id: preflight.tenant_id,
    state: preflight.state,
    mandatory: preflight.mandatory === true,
    governance: preflight.governance,
    memory_first: preflight.memory_first,
    gate: preflight.gate,
    core_research: preflight.core_research,
    tool_routing: preflight.tool_routing?.preferred_route
      ? { preferred_route: preflight.tool_routing.preferred_route }
      : preflight.tool_routing,
    shared_memory_bootstrap: compactBootstrap(preflight.shared_memory_bootstrap),
    operational_surface: preflight.operational_surface,
    gallery_version: preflight.gallery_version,
    tenant_work_gallery: preflight.tenant_work_gallery,
  };
}

function compactCoreRuntime(payload) {
  const result = payload?.result || payload || {};
  const router = result.router || {};
  return {
    hierarchy_version: result.hierarchy_version || "core_runtime_hierarchy_v1",
    mode: result.mode || "shadow",
    route: router.route || null,
    selected_authority: result.selected_authority || "V1",
    parity: {
      attempted: result.parity?.attempted === true,
      matched: result.parity?.matched ?? null,
      fallback: result.parity?.fallback || null,
      ...(result.parity?.error ? { error: "v2_unavailable_or_mismatch" } : {}),
    },
    execution_allowed: false,
    latency_ms: Number.isFinite(Number(payload?.latency_ms)) ? Number(payload.latency_ms) : null,
  };
}

function coreRuntimeFromBridge(payload) {
  const actual = payload?.result?.core_runtime;
  const route = actual?.router?.route;
  const authority = actual?.selected_authority;
  if (
    !actual ||
    !["active", "shadow", "off"].includes(actual.mode) ||
    !["V0", "V1", "V2"].includes(route) ||
    !["V0", "V1", "V2"].includes(authority) ||
    actual.execution_allowed !== false
  ) {
    throw new Error("core_runtime_binding_mismatch");
  }
  return compactCoreRuntime({ result: actual });
}

function compactNyraNetwork(network) {
  if (!network || typeof network !== "object") return null;
  return {
    schema_version: network.schema_version,
    domain_pack_id: network.domain_pack_id,
    opened_by: network.opened_by,
    opened_branches: Array.isArray(network.opened_branches)
      ? network.opened_branches.map((branch) => ({ id: branch.id, work_phase: branch.work_phase }))
      : [],
    denied_branches: network.denied_branches || [],
    parallel_analysis: {
      enabled: network.parallel_analysis?.enabled === true,
      wave_count: Array.isArray(network.parallel_analysis?.waves) ? network.parallel_analysis.waves.length : 0,
      join_authority: network.parallel_analysis?.join_authority,
    },
    governed_learning: network.governed_learning,
    execution_authorized: false,
  };
}

function compactDeepRuntime(runtime, detail = "fast") {
  if (!runtime || typeof runtime !== "object") return null;
  if (detail === "deep") return runtime;
  return {
    schema_version: runtime.schema_version,
    mode: runtime.mode,
    enabled: runtime.enabled,
    owner_protection: runtime.owner_protection,
    dialogue: runtime.dialogue,
    cognition: {
      opened_branch_count: runtime.cognition?.opened_branch_count,
      parallel_waves: runtime.cognition?.parallel_waves,
      hypothesis_count: Array.isArray(runtime.cognition?.hypothesis_ranking)
        ? runtime.cognition.hypothesis_ranking.length
        : 0,
      counterfactual_screening: runtime.cognition?.counterfactual_screening === true,
      verification_gate: runtime.cognition?.verification_gate === true,
    },
    memory: runtime.memory,
    execution_allowed: false,
    core_final_authority: runtime.core_final_authority === true,
  };
}

function compactNyraPayload(payload, { analysisId, detail = "fast" } = {}) {
  const result = payload?.result || {};
  const selected = result.selected_by_core || {};
  const compactResult = {
    version: result.version,
    mode: result.mode,
    god_mode_active: result.god_mode_active === true,
    selected_by_core: selected,
    automation_plan: result.automation_plan,
    deep_nyra_runtime: compactDeepRuntime(result.deep_nyra_runtime, detail),
    nyra_neural_network: compactNyraNetwork(result.nyra_neural_network),
    memory_context: compactMemoryContext(result.memory_context || payload?.memory_context),
    work_preflight: compactWorkPreflight(result.work_preflight || payload?.work_preflight),
    ...(detail === "deep" ? {
      prepared_by_nira: result.prepared_by_nira,
      efficiency: result.efficiency,
      core_branch_diagnostics: result.core_branch_diagnostics,
    } : {}),
  };
  return {
    ok: payload?.ok === true,
    tenant_id: payload?.tenant_id,
    core_runtime: payload?.core_runtime || null,
    received_memory: compactMemoryContext(payload?.received_memory || result.memory_context || payload?.memory_context),
    analysis_id: analysisId,
    response_mode: detail,
    result: compactResult,
    branch_context: payload?.branch_context,
    guardrail: payload?.guardrail,
    details_available: true,
    details_tool: "nyra_fetch_analysis",
  };
}

function ownerBindingStatus(config, identity) {
  const tenantIds = config.godModeTenantIds || [config.godModeTenantId].filter(Boolean);
  return {
    kind: identity.kind || "unknown",
    role: identity.role || "standard",
    god_mode: identity.godMode === true,
    owner_confirmation_satisfied: isVerifiedOwnerRoot(identity),
    binding_checks: {
      enabled: config.godModeEnabled === true,
      emergency_stop: config.godModeEmergencyStop === true,
      tenant_allowed: tenantIds.includes(identity.tenantId),
      subject_allowed: (config.godModeSubjects || []).includes(identity.subject),
      // A Codex delegation is never inferred from an OAuth owner-confirmed
      // workflow.  It must satisfy the separate Good Mode policy.
      codex_delegate_allowed: isCodexGoodModeDelegation(identity, config),
    },
  };
}

function isVerifiedOwnerRoot(identity) {
  return identity?.godMode === true && identity?.role === "owner_root";
}

function isVerifiedOAuthTenantOwner(identity) {
  return identity?.kind === "oauth" &&
    identity?.oauthOwnerElevated === true &&
    identity?.ownerConfirmed === true &&
    Boolean(String(identity?.subject || "").trim()) &&
    Boolean(String(identity?.confirmationReference || "").trim());
}

function requireHostNativeOwnerConfirmation(identity, config) {
  if (isCodexGoodModeDelegation(identity, config)) return "codex_good_mode";
  if (identity?.kind !== "oauth" || !String(identity?.subject || "").trim()) {
    throw new Error("owner_required");
  }
  if (
    identity?.oauthOwnerElevated !== true ||
    identity?.ownerConfirmed !== true ||
    !String(identity?.confirmationReference || "").trim()
  ) {
    throw new Error("owner_confirmation_required");
  }
  return "oauth_owner_confirmation";
}

function hostNativeConfirmationReference(identity, ownerMode, purpose, idempotencyKey) {
  if (ownerMode !== "codex_good_mode") {
    return String(identity?.confirmationReference || "").trim().slice(0, 240);
  }
  const requestDigest = crypto.createHash("sha256")
    .update(`${identity.tenantId}\u0000${purpose}\u0000${String(idempotencyKey || "")}`)
    .digest("hex");
  return `god_mode_codex:${requestDigest.slice(0, 40)}`;
}

function hasExplicitVerifiedOwnerConfirmation(identity, { allowOAuthTenantOwner = false } = {}) {
  return identity?.ownerConfirmed === true && (
    isVerifiedOwnerRoot(identity) ||
    (allowOAuthTenantOwner && isVerifiedOAuthTenantOwner(identity))
  );
}

function verifiedConfirmationReference(identity, options = {}) {
  if (!hasExplicitVerifiedOwnerConfirmation(identity, options)) return "";
  return String(identity?.confirmationReference || "").slice(0, 240);
}

function applyVerifiedOwnerConfirmation(payload, identity) {
  if (!hasExplicitVerifiedOwnerConfirmation(identity)) return payload;
  const verifiedGovernance = (governance) => {
    const current = governance && typeof governance === "object" && !Array.isArray(governance)
      ? governance
      : {};
    return {
      ...current,
      // Local identity may fill legacy payloads that did not report these
      // fields. It must never turn an explicit Core denial into a verified
      // owner result.
      ...(Object.prototype.hasOwnProperty.call(current, "owner_confirmation_satisfied")
        ? {}
        : { owner_confirmation_satisfied: true }),
      ...(Object.prototype.hasOwnProperty.call(current, "owner_identity_verified")
        ? {}
        : { owner_identity_verified: true }),
    };
  };
  const nestedPreflight = payload?.work_preflight;
  return {
    ...payload,
    governance: verifiedGovernance(payload?.governance),
    ...(nestedPreflight && typeof nestedPreflight === "object" && !Array.isArray(nestedPreflight)
      ? {
        work_preflight: {
          ...nestedPreflight,
          governance: verifiedGovernance(nestedPreflight.governance),
        },
      }
      : {}),
  };
}

export function createCoreHandlers(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const contextProvider = options.contextProvider;
  const sharedMemoryBootstrap = options.sharedMemoryBootstrap;
  const tenantWorkGallery = options.tenantWorkGallery;
  const resolveDttWorkBinding = options.resolveDttWorkBinding;
  const resolveStandingReleaseIntentBinding = options.resolveStandingReleaseIntentBinding;
  const resolveGenericWorkCoreJoinBinding = options.resolveGenericWorkCoreJoinBinding;
  const genericWorkCoreJoinVerifierMetadata = options.genericWorkCoreJoinVerifierMetadata || null;
  const decisionLedger = options.decisionLedger || null;
  const remediationStore = options.remediationStore || createCoreBlockRemediationStore(config, {
    root: options.coreBlockRemediationRoot || config.sharedMemoryRoot || config.agentWorkspaceRoot,
  });
  const analysisCache = new Map();
  const analysisCacheTtlMs = Math.min(Math.max(Number(options.analysisCacheTtlMs || 300_000), 30_000), 300_000);
  const configuredRemediationMode = String(config.coreBlockRemediationMode || "shadow").trim().toLowerCase();
  const remediationMode = ["disabled", "shadow", "active"].includes(configuredRemediationMode)
    ? configuredRemediationMode
    : "shadow";
  const remediationEnabled = remediationMode !== "disabled";
  const workQualityMode = String(config.aiWorkQualityMode || "observe").trim().toLowerCase();
  const workQualityRank = Object.freeze({ observe: 0, draft: 1, sandbox_active: 2, scoped_active: 3, privileged: 4 });
  const qualityRank = workQualityRank[workQualityMode] ?? 0;
  const remediationLedgerContexts = new Map();
  const policyRegistryCoreTimeoutMs = Math.min(Math.max(
    Number(options.policyRegistryCoreTimeoutMs || POLICY_REGISTRY_CORE_TIMEOUT_MS),
    10,
  ), POLICY_REGISTRY_CORE_TIMEOUT_MS);

  function isWorkQualityRemediation(remediation) {
    return Boolean(AI_WORK_FAILURE_DEFINITIONS[String(remediation?.original_decision?.block_code || "")]);
  }

  function assertRemediationWritesEnabled(remediation) {
    const qualityContract = isWorkQualityRemediation(remediation);
    const enabled = qualityContract
      ? qualityRank >= workQualityRank.draft
      : remediationMode === "active";
    if (!enabled) {
      const error = new Error("core_block_remediation_active_mode_required");
      error.code = "core_block_remediation_active_mode_required";
      error.statusCode = 409;
      throw error;
    }
  }

  function assertRemediationResubmissionEnabled(remediation) {
    assertRemediationWritesEnabled(remediation);
    if (isWorkQualityRemediation(remediation) && qualityRank < workQualityRank.sandbox_active) {
      const error = new Error("ai_work_quality_sandbox_active_required");
      error.code = "ai_work_quality_sandbox_active_required";
      error.statusCode = 409;
      throw error;
    }
  }

  function remediationDecisionLedger(identity) {
    if (!decisionLedger) return null;
    return {
      append: async (event = {}) => {
        const eventTenantId = String(event.tenant_id || "");
        if (!eventTenantId || eventTenantId !== String(identity.tenantId || "")) {
          throw new Error("core_block_remediation_ledger_tenant_mismatch");
        }
        const eventType = String(event.event_type || "");
        const remediationIdentity = String(event.remediation_id || event.work_id || "");
        if (!remediationIdentity) throw new Error("core_block_remediation_ledger_identity_missing");
        const contextKey = `${eventTenantId}:${remediationIdentity}`;
        let contextPromise = remediationLedgerContexts.get(contextKey);
        if (!contextPromise) {
          contextPromise = decisionLedger.startWork(identity, "core_block_remediation", {
            request: event.reason_summary || eventType,
            agent_id: identity.subject || identity.agentId || "connected_ai",
            project_id: event.project_id || null,
            session_id: event.session_id || null,
          });
          remediationLedgerContexts.set(contextKey, contextPromise);
          contextPromise.catch(() => remediationLedgerContexts.delete(contextKey));
        }
        const context = await contextPromise;
        return decisionLedger.append(context, eventType, {
          decision_id: event.decision_id || null,
          reason_summary: event.reason_summary || event.block_code || eventType,
          metadata: {
            ...(event.metadata && typeof event.metadata === "object" ? event.metadata : {}),
            remediation_id: event.remediation_id || null,
            remediation_work_id: event.work_id || null,
            block_code: event.block_code || null,
            block_class: event.block_class || null,
            contract_digest: event.contract_digest || null,
          },
        });
      },
    };
  }

  async function recordQualityFailureObservation(identity, response) {
    const failure = response?.result?.failure_mediation || response?.failure_mediation;
    if (!failure || !decisionLedger) return { recorded: false, reason: "unavailable" };
    const context = await decisionLedger.startWork(identity, "core_action_mediation_evaluate", {
      request: `quality_failure:${failure.code}`,
      agent_id: identity.subject || identity.agentId || "connected_ai",
      project_id: response?.result?.tenant_id || identity.tenantId,
      session_id: failure.scope?.session_id || null,
    });
    const metadata = {
      schema_version: AI_WORK_QUALITY_SCHEMA_VERSION,
      failure_code: failure.code,
      failure_class: failure.classification?.block_class || null,
      failure_action: failure.action || null,
      mediation_state: failure.mediation_state || null,
      retry_allowed: failure.classification?.retry_allowed === true,
      retry_exhausted: failure.classification?.retry_exhausted === true,
      quarantine: failure.quarantine === true,
      execution_allowed: false,
    };
    await decisionLedger.append(context, "quality_failure_observed", {
      reason_codes: [failure.code],
      reason_summary: `quality_failure:${failure.code}`,
      decision_state: failure.mediation_state || null,
      execution_allowed: false,
      metadata,
    });
    if (failure.quarantine === true) {
      await decisionLedger.append(context, "security_observation_quarantined", {
        reason_codes: [failure.code],
        reason_summary: `security_quarantine:${failure.code}`,
        decision_state: "hard_block",
        execution_allowed: false,
        metadata,
      });
    }
    if (failure.action === "manual_review") {
      await decisionLedger.append(context, "quality_completion_rejected", {
        reason_codes: [failure.code],
        reason_summary: `quality_manual_review:${failure.code}`,
        decision_state: "defer",
        execution_allowed: false,
        metadata,
      });
    }
    await decisionLedger.finishWork(context, { result: { structuredContent: response } });
    return { recorded: true, work_id: context.workId };
  }

  function applyQualityFailureMediation(args, response) {
    const requestedFailureCode = args?.action?.failure_code
      ?? args?.context?.failure_code
      ?? args?.policy?.failure_code;
    if (!requestedFailureCode) return response;

    const action = args.action || {};
    const context = args.context || {};
    const policy = args.policy || {};
    const failure = mediateFailureObservation({
      code: requestedFailureCode,
      scope: {
        tenant_id: response?.result?.tenant_id || null,
        repository: action.repository || context.repository || policy.repository,
        branch: action.branch || action.ref || context.branch || context.ref || policy.branch || policy.ref,
        surface: action.surface || context.surface || policy.surface,
        work_id: action.work_id || context.work_id || policy.work_id,
        session_id: action.session_id || context.session_id || policy.session_id,
      },
      worker_id: action.worker_id || context.worker_id || policy.worker_id,
      verifier_id: action.verifier_id || context.verifier_id || policy.verifier_id,
      attempt: action.attempt ?? context.attempt ?? policy.attempt,
      attempt_limit: action.attempt_limit ?? context.attempt_limit ?? policy.attempt_limit,
      summary: action.failure_summary || context.failure_summary || policy.failure_summary,
    });
    const result = response?.result && typeof response.result === "object" ? response.result : {};
    return {
      ...response,
      result: {
        ...result,
        decision: failure.mediation_state === "hard_block" ? "blocked" : "attention",
        execution_allowed: false,
        failure_mediation: failure,
        action_mediation: {
          ...(result.action_mediation && typeof result.action_mediation === "object"
            ? result.action_mediation
            : {}),
          state: failure.mediation_state,
          blocked: failure.mediation_state === "hard_block",
          execution_allowed: false,
          failure_code: failure.code,
          failure_action: failure.action,
        },
      },
    };
  }

  function cacheAnalysis(tenantId, payload) {
    const now = Date.now();
    for (const [key, value] of analysisCache) if (value.expires_at <= now) analysisCache.delete(key);
    while (analysisCache.size >= 500) analysisCache.delete(analysisCache.keys().next().value);
    const analysisId = `nyra_${crypto.randomBytes(12).toString("hex")}`;
    analysisCache.set(`${tenantId}:${analysisId}`, { payload, expires_at: now + analysisCacheTtlMs });
    return analysisId;
  }

  function fetchAnalysis(tenantId, analysisId) {
    const key = `${tenantId}:${analysisId}`;
    const entry = analysisCache.get(key);
    if (!entry || entry.expires_at <= Date.now()) {
      analysisCache.delete(key);
      throw new Error("nyra_analysis_not_found_or_expired");
    }
    return entry.payload;
  }

  function configuredTenantGatewayKey() {
    const value = String(config.tenantGatewayKey || "").trim();
    return Buffer.byteLength(value, "utf8") >= 32 ? value : "";
  }

  function coreKey(tenantId) {
    const selected = String(
      config.universalCoreKeys?.[tenantId] ||
      (tenantId === config.defaultTenantId ? config.universalCoreKey : "") ||
      configuredTenantGatewayKey() ||
      "",
    ).trim();
    if (!selected) throw new Error("core_tenant_key_missing");
    return selected;
  }

  function sanitizeCoreBody(body, { preservePolicyRegistryDomainPackId = false } = {}) {
    return body && typeof body === "object" && !Array.isArray(body)
      ? (({ domain_pack: _domainPack, domain_pack_id: domainPackId, ...rest }) => ({
          ...rest,
          ...(preservePolicyRegistryDomainPackId && domainPackId !== undefined
            ? { domain_pack_id: domainPackId }
            : {}),
        }))(body)
      : body;
  }

  async function coreRequest(path, tenantId, {
    method = "GET",
    body,
    additionalHeaders = {},
    useTenantGateway = false,
    allowFailurePayload = false,
    dttWorkContext = null,
    genericWorkCoreJoinContext = null,
    preservePolicyRegistryDomainPackId = false,
    strictTransport = false,
    timeoutMs = POLICY_REGISTRY_CORE_TIMEOUT_MS,
    maxResponseBytes = POLICY_REGISTRY_RESPONSE_LIMIT_BYTES,
  } = {}) {
    const sanitizedBody = sanitizeCoreBody(body, { preservePolicyRegistryDomainPackId });
    const headers = { accept: "application/json" };
    if (sanitizedBody !== undefined) headers["content-type"] = "application/json";
    const gatewayKey = configuredTenantGatewayKey();
    if (useTenantGateway && !gatewayKey) {
      throw new Error("core_tenant_gateway_key_missing");
    }
    const selectedKey = useTenantGateway ? gatewayKey : coreKey(tenantId);
    headers.authorization = `Bearer ${selectedKey}`;
    Object.assign(headers, additionalHeaders);
    if (gatewayKey && selectedKey === gatewayKey) {
      // The gateway key has a synthetic tenant. Core therefore needs the
      // requested tenant alongside the signed context even for body-less GET
      // requests. The header is not trusted by itself: Core accepts it only
      // when the HMAC context below is valid for the exact same tenant.
      headers["x-sh-tenant-id"] = tenantId;
      const context = tenantContextHeader(
        tenantId,
        config.tenantContextSigningSecret,
      );
      if (!context) {
        throw new Error("core_tenant_context_signing_unavailable");
      }
      headers["x-sh-tenant-context"] = context;
    }
    if (dttWorkContext) {
      if (useTenantGateway !== true) throw new Error("dtt_work_context_tenant_gateway_required");
      headers[DTT_WORK_CONTEXT_HEADER] = issueDttWorkContext({
        secret: config.dttAgentIdentitySigningSecret,
        tenant_id: tenantId,
        work_id: dttWorkContext.work_id,
        lease_binding: dttWorkContext.lease_binding,
        agent_presence: dttWorkContext.agent_presence,
        method,
        path,
        body: sanitizedBody,
      });
    }
    if (genericWorkCoreJoinContext) {
      if (dttWorkContext) throw new Error("generic_work_core_join_context_ambiguous");
      if (useTenantGateway !== true) {
        throw new Error("generic_work_core_join_context_tenant_gateway_required");
      }
      headers[GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER] = issueGenericWorkCoreJoinContext({
        secret: config.dttAgentIdentitySigningSecret,
        tenant_id: tenantId,
        work_id: genericWorkCoreJoinContext.work_id,
        lease_binding: genericWorkCoreJoinContext.lease_binding,
        agent_presence: genericWorkCoreJoinContext.agent_presence,
        verifier: genericWorkCoreJoinContext.verifier,
        method,
        path,
        body: sanitizedBody,
      });
    }
    const serializedBody = sanitizedBody === undefined
      ? undefined
      : genericWorkCoreJoinContext
        ? canonicalGenericWorkCoreJoinContextBody(sanitizedBody)
        : dttWorkContext
          ? canonicalDttWorkContextBody(sanitizedBody)
          : JSON.stringify(sanitizedBody);
    const endpoint = `${config.universalCoreUrl}${path}`;
    let response;
    let payload;
    if (!strictTransport) {
      response = await fetchImpl(endpoint, {
        method,
        headers,
        body: serializedBody,
      });
      payload = await response.json().catch(() => ({ ok: false, error: "invalid_core_response" }));
    } else {
      const controller = new AbortController();
      const boundedTimeout = Number.isFinite(timeoutMs)
        ? Math.max(1, Math.min(Number(timeoutMs), POLICY_REGISTRY_CORE_TIMEOUT_MS))
        : POLICY_REGISTRY_CORE_TIMEOUT_MS;
      const boundedResponseBytes = Number.isFinite(maxResponseBytes)
        ? Math.max(1, Math.min(Number(maxResponseBytes), POLICY_REGISTRY_RESPONSE_LIMIT_BYTES))
        : POLICY_REGISTRY_RESPONSE_LIMIT_BYTES;
      const transportError = (code, status = 502) => {
        const error = new Error(code);
        error.code = code;
        error.status = status;
        error.statusCode = status;
        Object.defineProperty(error, "policyRegistryTransportError", { value: true });
        return error;
      };
      let reader = null;
      let timeout;
      const operation = (async () => {
        const strictResponse = await fetchImpl(endpoint, {
          method,
          headers,
          body: serializedBody,
          redirect: "error",
          signal: controller.signal,
        });
        if (strictResponse?.redirected === true || (strictResponse?.url && strictResponse.url !== endpoint)) {
          throw transportError("policy_registry_core_redirect_denied");
        }
        const contentType = String(strictResponse?.headers?.get?.("content-type") || "").trim().toLowerCase();
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(contentType)) {
          throw transportError("policy_registry_core_content_type_invalid");
        }
        const rawLength = strictResponse?.headers?.get?.("content-length");
        if (rawLength !== null && rawLength !== undefined && rawLength !== "") {
          if (!/^\d+$/.test(String(rawLength))) {
            throw transportError("policy_registry_core_content_length_invalid");
          }
          const declaredLength = Number(rawLength);
          if (!Number.isSafeInteger(declaredLength) || declaredLength > boundedResponseBytes) {
            throw transportError("policy_registry_core_response_too_large");
          }
        }
        const chunks = [];
        let received = 0;
        if (strictResponse?.body && typeof strictResponse.body.getReader === "function") {
          reader = strictResponse.body.getReader();
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            const chunk = Buffer.from(part.value);
            received += chunk.byteLength;
            if (received > boundedResponseBytes) {
              void reader.cancel().catch(() => {});
              throw transportError("policy_registry_core_response_too_large");
            }
            chunks.push(chunk);
          }
        } else if (typeof strictResponse?.arrayBuffer === "function") {
          const bytes = Buffer.from(await strictResponse.arrayBuffer());
          received = bytes.byteLength;
          if (received > boundedResponseBytes) {
            throw transportError("policy_registry_core_response_too_large");
          }
          chunks.push(bytes);
        } else {
          throw transportError("policy_registry_core_response_json_invalid");
        }
        let parsed;
        try {
          parsed = JSON.parse(Buffer.concat(chunks, received).toString("utf8"));
        } catch {
          throw transportError("policy_registry_core_response_json_invalid");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw transportError("policy_registry_core_response_json_invalid");
        }
        return { response: strictResponse, payload: parsed };
      })();
      const deadline = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          if (reader) void reader.cancel().catch(() => {});
          reject(transportError("policy_registry_core_timeout", 504));
        }, boundedTimeout);
      });
      try {
        ({ response, payload } = await Promise.race([operation, deadline]));
      } catch (error) {
        if (error?.policyRegistryTransportError === true) throw error;
        const wrapped = new Error("policy_registry_core_unavailable");
        wrapped.code = "policy_registry_core_unavailable";
        wrapped.status = 503;
        wrapped.statusCode = 503;
        throw wrapped;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (!response.ok) {
      if (allowFailurePayload) {
        return { ok: false, status: response.status, payload };
      }
      const candidateUpstreamCode = typeof payload.error === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(payload.error)
        ? payload.error
        : "unknown";
      const upstreamCode = strictTransport && !POLICY_REGISTRY_SAFE_UPSTREAM_ERRORS.has(candidateUpstreamCode)
        ? "unknown"
        : candidateUpstreamCode;
      const error = new Error(`core_request_failed:${response.status}:${upstreamCode}`);
      error.code = upstreamCode === "unknown" ? "core_request_failed" : upstreamCode;
      error.status = response.status;
      error.statusCode = response.status;
      throw error;
    }
    return payload;
  }

  async function dttCoreRequest(path, args, identity, request = {}) {
    if (typeof resolveDttWorkBinding !== "function") {
      throw new Error("dtt_work_binding_unavailable");
    }
    const workId = String(args?.work_id || "").trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(workId)) {
      throw new Error("dtt_work_id_invalid");
    }
    const leaseBinding = await resolveDttWorkBinding(identity, workId);
    if (!leaseBinding || leaseBinding.execution_authorized !== false) {
      throw new Error("dtt_work_active_lease_required");
    }
    if (request.strictTransport === true) {
      const presence = identity?.agentPresence;
      const expiresAt = Date.parse(String(leaseBinding.expires_at || ""));
      const participantExpiresAt = Date.parse(String(leaseBinding.participant_expires_at || ""));
      if (
        leaseBinding.schema_version !== "dtt_work_lease_binding_v1" ||
        leaseBinding.tenant_id !== identity.tenantId ||
        String(leaseBinding.work_id || "").toLowerCase() !== workId ||
        !POLICY_REGISTRY_WORK_ID.test(String(leaseBinding.lease_id || "").toLowerCase()) ||
        !Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
        !Number.isFinite(participantExpiresAt) || participantExpiresAt <= Date.now() ||
        !presence || presence.transport_bound !== true ||
        leaseBinding.session_id !== presence.session_id ||
        leaseBinding.agent_id !== presence.agent_id ||
        leaseBinding.client_type !== presence.client_type ||
        leaseBinding.session_fingerprint !== presence.session_fingerprint ||
        leaseBinding.host_transport_session_fingerprint !== presence.host_transport_session_fingerprint ||
        leaseBinding.presence_signature !== presence.signature ||
        leaseBinding.opaque_agent_id !== presence.opaque_agent_id ||
        leaseBinding.actor_provenance !== presence.actor_provenance
      ) throw new Error("dtt_work_active_lease_required");
    }
    return coreRequest(path, identity.tenantId, {
      ...request,
      useTenantGateway: true,
      dttWorkContext: {
        work_id: workId,
        lease_binding: leaseBinding,
        agent_presence: identity.agentPresence,
      },
    });
  }

  async function persistedStandingReleaseIntent(identity, workIdValue, callerDigestValue) {
    const rawWorkId = typeof workIdValue === "string" ? workIdValue : "";
    const workId = rawWorkId.trim().toLowerCase();
    if (rawWorkId !== workId || !POLICY_REGISTRY_WORK_ID.test(workId)) {
      throw new Error("standing_release_work_id_invalid");
    }
    const rawCallerDigest = typeof callerDigestValue === "string" ? callerDigestValue : "";
    const callerDigest = rawCallerDigest.trim().toLowerCase();
    if (rawCallerDigest !== callerDigest || !POLICY_REGISTRY_SHA256.test(callerDigest)) {
      throw new Error("standing_release_intent_digest_invalid");
    }
    if (
      typeof resolveStandingReleaseIntentBinding !== "function" ||
      resolveStandingReleaseIntentBinding.trusted !== true
    ) {
      throw new Error("standing_release_intent_binding_unavailable");
    }
    let binding;
    try {
      binding = await resolveStandingReleaseIntentBinding(identity, workId);
    } catch (error) {
      const reason = String(error?.code || error?.message || "");
      if (reason.startsWith("standing_release_intent_") || reason === "dtt_work_acl_denied") {
        throw error;
      }
      throw new Error("standing_release_intent_binding_unavailable");
    }
    const persistedDigest = String(binding?.intent_anchor_digest || "").trim().toLowerCase();
    const bindingDigest = String(binding?.binding_digest || "").trim().toLowerCase();
    const verifiedAtRaw = String(binding?.verified_at || "");
    const workUpdatedAtRaw = String(binding?.work_updated_at || "");
    const anchorCreatedAtRaw = String(binding?.intent_anchor_created_at || "");
    const verifiedAt = Date.parse(verifiedAtRaw);
    const workUpdatedAt = Date.parse(workUpdatedAtRaw);
    const anchorCreatedAt = Date.parse(anchorCreatedAtRaw);
    const nowValue = Date.now();
    const { binding_digest: _bindingDigest, ...unsignedBinding } = binding || {};
    const computedBindingDigest = crypto.createHash("sha256")
      .update(JSON.stringify(stableCanonical(unsignedBinding)))
      .digest("hex");
    if (
      binding?.schema_version !== "standing_release_intent_binding_v1" ||
      binding?.source !== "mcp_work_continuity_postgres" ||
      binding?.tenant_id !== identity?.tenantId ||
      binding?.work_id !== workId ||
      typeof binding?.project_id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,63}$/.test(binding.project_id) ||
      !["active", "verified", "release_ready"].includes(binding?.work_status) ||
      !Number.isSafeInteger(binding?.current_version) || binding.current_version < 1 ||
      !Number.isFinite(workUpdatedAt) || workUpdatedAtRaw !== new Date(workUpdatedAt).toISOString() ||
      binding?.intent_anchor_schema_version !== "intent_anchor_v1" ||
      binding?.intent_anchor_immutable !== true ||
      binding?.intent_anchor_digest !== persistedDigest || !POLICY_REGISTRY_SHA256.test(persistedDigest) ||
      !Number.isFinite(anchorCreatedAt) ||
      anchorCreatedAtRaw !== new Date(anchorCreatedAt).toISOString() ||
      !Number.isFinite(verifiedAt) || verifiedAtRaw !== new Date(verifiedAt).toISOString() ||
      verifiedAt > nowValue + 30_000 || verifiedAt < nowValue - 300_000 ||
      workUpdatedAt > verifiedAt + 30_000 || anchorCreatedAt > verifiedAt + 30_000 ||
      binding?.provider_execution !== false ||
      binding?.binding_digest !== bindingDigest || !POLICY_REGISTRY_SHA256.test(bindingDigest) ||
      bindingDigest !== computedBindingDigest
    ) {
      throw new Error("standing_release_intent_binding_invalid");
    }
    if (callerDigest !== persistedDigest) {
      throw new Error("standing_release_intent_digest_mismatch");
    }
    return Object.freeze({
      work_id: workId,
      intent_anchor_digest: persistedDigest,
      binding: Object.freeze(structuredClone(binding)),
    });
  }

  async function genericWorkCoreJoinCoreRequest(path, args, identity, request = {}) {
    if (!genericWorkCoreJoinVerifierMetadata) {
      throw new Error("generic_work_core_join_verifier_unavailable");
    }
    if (typeof resolveGenericWorkCoreJoinBinding !== "function") {
      throw new Error("generic_work_core_join_work_binding_unavailable");
    }
    const workId = String(args?.work_id || "").trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(workId)) {
      throw new Error("generic_work_core_join_work_id_invalid");
    }
    const leaseBinding = await resolveGenericWorkCoreJoinBinding(identity, workId);
    if (
      leaseBinding?.schema_version !== GENERIC_WORK_CORE_JOIN_LEASE_BINDING_VERSION
      || leaseBinding?.tenant_id !== identity.tenantId
      || String(leaseBinding?.work_id || "").toLowerCase() !== workId
      || leaseBinding?.execution_authorized !== false
    ) {
      throw new Error("generic_work_core_join_active_lease_required");
    }
    const requestBody = request.body && typeof request.body === "object" && !Array.isArray(request.body)
      ? { ...request.body, work_id: workId }
      : request.body;
    return coreRequest(path, identity.tenantId, {
      ...request,
      body: requestBody,
      useTenantGateway: true,
      genericWorkCoreJoinContext: {
        work_id: workId,
        lease_binding: leaseBinding,
        agent_presence: identity.agentPresence,
        verifier: genericWorkCoreJoinVerifierMetadata,
      },
    });
  }

  async function openBlockedRemediation({
    identity,
    requestBody,
    authorization,
    contract,
    output,
  }) {
    if (!remediationEnabled) return null;
    const workContext = {
      tenant_id: identity.tenantId,
      project_id: requestBody.project_id || null,
      work_id: requestBody.work_id || requestBody.request_id || requestBody.session_id || crypto.randomUUID(),
      branch_id: requestBody.branch_id || null,
      session_id: requestBody.session_id || null,
      surface: requestBody.target || requestBody.action_label || requestBody.action_type || null,
      target_system: requestBody.target_system || "universal_core",
      operation_type: requestBody.action_type || requestBody.operation_type || "action_evaluator",
      operation_class: requestBody.operation_class || null,
      repository: requestBody.repository || null,
      ref: requestBody.ref || null,
      environment: requestBody.environment || null,
      resource_ids: Array.isArray(requestBody.resource_ids) ? requestBody.resource_ids : [],
    };
    const decision = {
      tenant_id: identity.tenantId,
      decision_id: requestBody.request_id || crypto.randomUUID(),
      verdict: String(authorization.state || contract.state || "BLOCK").toUpperCase(),
      block_code: Array.isArray(output.recommended_actions)
        ? String(output.recommended_actions.find((item) => item.blocked === true)?.reason_code || output.recommended_actions[0]?.reason_code || "UNKNOWN_BLOCK")
        : String(contract.block_code || output.block_code || "UNKNOWN_BLOCK"),
      block_class: String(contract.block_class || output.block_class || "manual_review"),
      risk_band: String(output?.selected_by_core?.risk_band || contract.risk_band || "medium"),
      reasons: Array.isArray(contract.blocked_reasons) ? contract.blocked_reasons : [],
      unmet_conditions: Array.isArray(output?.selected_by_core?.unmet_conditions) ? output.selected_by_core.unmet_conditions : [],
      evidence_requirements: Array.isArray(output?.selected_by_core?.evidence_requirements) ? output.selected_by_core.evidence_requirements : [],
      allowed_alternatives: Array.isArray(output?.selected_by_core?.allowed_alternatives) ? output.selected_by_core.allowed_alternatives : [],
      owner_confirmation_required: authorization.confirmation_required === true,
      policy_snapshot_digest: contract.policy_snapshot_digest || contract.contract_digest || null,
      expires_at: requestBody.expires_at || null,
      target_system: workContext.target_system,
      operation_type: workContext.operation_type,
      operation_class: workContext.operation_class,
      repository: workContext.repository,
      ref: workContext.ref,
      environment: workContext.environment,
      resource_ids: workContext.resource_ids,
      max_attempts: config.coreBlockRemediationMaxAttempts || 3,
      transient_retry_limit: config.coreBlockRemediationTransientRetryLimit || 2,
    };
    const explainFn = async () => buildDeterministicBlockExplanation({
      remediation_id: `cbr_${crypto.randomUUID()}`,
      tenant_id: identity.tenantId,
      project_id: workContext.project_id,
      work_id: workContext.work_id,
      branch_id: workContext.branch_id,
      session_id: workContext.session_id,
      original_decision: {
        decision_id: decision.decision_id,
        decision_digest: "pending",
        verdict: decision.verdict,
        block_code: decision.block_code,
        block_class: decision.block_class,
        risk_band: decision.risk_band,
        reasons: decision.reasons,
        unmet_conditions: decision.unmet_conditions,
        evidence_requirements: decision.evidence_requirements,
        allowed_alternatives: decision.allowed_alternatives,
        correction_allowed: decision.block_class === CORE_BLOCK_CLASS.CORRECTABLE || decision.block_class === CORE_BLOCK_CLASS.TRANSIENT,
        same_action_retry_allowed: decision.block_class !== CORE_BLOCK_CLASS.CONFIRMATION_REQUIRED && decision.block_class !== CORE_BLOCK_CLASS.ABSOLUTE,
        owner_confirmation_required: decision.owner_confirmation_required,
        policy_snapshot_digest: decision.policy_snapshot_digest,
        expires_at: decision.expires_at,
      },
      bound_scope: {
        target_system: workContext.target_system,
        operation_type: workContext.operation_type,
        operation_class: workContext.operation_class,
        resource_ids: workContext.resource_ids,
        repository: workContext.repository,
        ref: workContext.ref,
        environment: workContext.environment,
        scope_digest: "pending",
      },
      continuation_scope: deriveContinuationScope({
        decision,
        classification: classifyCoreBlock(decision),
      }),
    });
    const remediation = await openCoreBlockRemediation({
      decision,
      workContext,
      actor: {
        kind: identity.kind,
        client_type: identity.kind,
        subject: identity.subject,
        tenant_id: identity.tenantId,
      },
      store: remediationStore,
      ledger: remediationDecisionLedger(identity),
      now: () => new Date(),
      explainFn,
      maxAttempts: config.coreBlockRemediationMaxAttempts || 3,
      transientRetryLimit: config.coreBlockRemediationTransientRetryLimit || 2,
    });
    if (!remediation) return null;
    const statusPayload = {
      state: "blocked_with_remediation",
      allowed: false,
      decision_contract: contract,
      remediation: {
        schema_version: remediation.schema_version,
        remediation_id: remediation.remediation_id,
        status: remediation.status,
        block_class: remediation.original_decision.block_class,
        can_continue_analysis: remediation.continuation_scope.mode !== "none",
        can_submit_remediation: remediation.original_decision.block_class !== CORE_BLOCK_CLASS.ABSOLUTE,
        can_retry_same_action: remediation.original_decision.same_action_retry_allowed === true,
        owner_confirmation_required: remediation.original_decision.owner_confirmation_required === true,
        continuation_scope: remediation.continuation_scope,
        nyra_message: remediation.nyra_explanation,
        next_action: remediation.nyra_explanation?.recommended_next_action || deriveRecommendedNextAction(remediation),
        remediation_idempotency: remediation.contract_digest,
      },
    };
    return { remediation, statusPayload };
  }

  async function loadRemediationForIdentity(identity, remediationId) {
    const remediation = await remediationStore.findById({
      tenant_id: identity.tenantId,
      remediation_id: remediationId,
    });
    if (!remediation) throw new Error("remediation_not_found");
    if (String(remediation.tenant_id || "") !== String(identity.tenantId || "")) {
      throw new Error("tenant_scope_violation");
    }
    return remediation;
  }

  function remediationEnvelope(remediation, extra = {}) {
    return {
      schema_version: remediation.schema_version,
      remediation_id: remediation.remediation_id,
      tenant_id: remediation.tenant_id,
      project_id: remediation.project_id,
      work_id: remediation.work_id,
      branch_id: remediation.branch_id,
      session_id: remediation.session_id,
      status: remediation.status,
      block_class: remediation.original_decision.block_class,
      block_code: remediation.original_decision.block_code,
      can_continue_analysis: remediation.continuation_scope.mode !== "none",
      can_submit_remediation: remediation.original_decision.block_class !== CORE_BLOCK_CLASS.ABSOLUTE,
      can_retry_same_action: remediation.original_decision.same_action_retry_allowed === true,
      owner_confirmation_required: remediation.original_decision.owner_confirmation_required === true,
      continuation_scope: remediation.continuation_scope,
      nyra_message: remediation.nyra_explanation,
      next_action: remediation.nyra_explanation?.recommended_next_action || deriveRecommendedNextAction(remediation),
      attempt_count: remediation.attempt_count,
      max_attempts: remediation.max_attempts,
      version: remediation.version,
      ...extra,
    };
  }

  function ownerContext(identity, options = {}) {
    const optionObject = options && typeof options === "object" && !Array.isArray(options);
    const requestBinding = optionObject ? options.requestBinding : options;
    const hostNativeOwner = optionObject && options.hostNativeOwner === true;
    const actionEvaluatorGateway = optionObject && options.actionEvaluatorGateway === true;
    const allowOAuthTenantOwner = optionObject && options.allowOAuthTenantOwner === true;

    if (hostNativeOwner && actionEvaluatorGateway) {
      throw new Error("owner_context_signing_domain_conflict");
    }

    // Generic owner assertions are signed with the tenant Core key and bind
    // the exact request body. Host-native delegation operations use the
    // dedicated owner-context key. OAuth and Codex-Good-Mode fingerprints use
    // distinct domains, so neither can be replayed as the other or as a
    // generic Core owner assertion.
    if (hostNativeOwner) {
      const codexGoodMode = isCodexGoodModeDelegation(identity, config);
      const oauthOwner =
        identity.kind === "oauth" &&
        identity.oauthOwnerElevated === true &&
        identity.ownerConfirmed === true &&
        Boolean(String(identity.subject || "").trim());
      if (
        !codexGoodMode &&
        !oauthOwner
      ) {
        return { access_mode: "standard", role: identity.role || "standard", owner_verified: false };
      }
      if (
        Buffer.byteLength(
          String(config.ownerContextSigningSecret || ""),
          "utf8",
        ) < 32
      ) {
        throw new Error("host_native_owner_context_signing_unavailable");
      }
    } else if (
      identity.godMode !== true &&
      !(allowOAuthTenantOwner && isVerifiedOAuthTenantOwner(identity))
    ) {
      return { access_mode: "standard", role: identity.role || "standard", owner_verified: false };
    }
    // Owner assertions are verifier-domain bound. Host-native delegation and
    // Work Preflight use the dedicated bridge secret. The action evaluator is
    // the sole bearer-bound route and Core verifies it with the selected
    // tenant-gateway key.
    const signingKey = actionEvaluatorGateway
      ? configuredTenantGatewayKey()
      : (config.ownerContextSigningSecret || (hostNativeOwner
        ? ""
        : (configuredTenantGatewayKey() || coreKey(identity.tenantId))));
    if (actionEvaluatorGateway && Buffer.byteLength(String(signingKey || ""), "utf8") < 32) {
      throw new Error("core_tenant_gateway_key_missing");
    }
    if (hostNativeOwner && Buffer.byteLength(String(signingKey || ""), "utf8") < 32) {
      throw new Error("owner_context_signing_unavailable");
    }
    const hostNativeCodexGoodMode = hostNativeOwner && isCodexGoodModeDelegation(identity, config);
    const context = {
      assertion_version: OWNER_CONTEXT_ASSERTION_VERSION,
      audience: "nira_core_bridge",
      tenant_id: identity.tenantId,
      access_mode: (isVerifiedOwnerRoot(identity) && !hostNativeOwner) || hostNativeCodexGoodMode
        ? "god_mode"
        : "tenant_owner",
      role: (isVerifiedOwnerRoot(identity) && !hostNativeOwner) || hostNativeCodexGoodMode
        ? "owner_root"
        : "tenant_owner",
      delegated_actor: identity.kind || "unknown",
      owner_verified: true,
      issued_at: new Date().toISOString(),
      ...(requestBinding === undefined ? {} : {
        binding_version: "owner_request_binding_v1",
        binding_hash: crypto.createHash("sha256").update(String(requestBinding)).digest("hex"),
      }),
      ...(hostNativeOwner || isVerifiedOwnerRoot(identity)
            ? {
          owner_subject_fingerprint: `osf_${crypto.createHmac("sha256", signingKey)
            .update(`${hostNativeCodexGoodMode ? "host-native-codex-owner" : "host-native-owner"}\u0000${String(identity.subject).trim()}`)
            .digest("hex")}`,
        }
        : {}),
    };
    const digest = crypto.createHmac("sha256", signingKey)
      .update(`owner-context\u0000${ownerContextCanonical(context)}`)
      .digest("hex");
    return { ...context, assertion: `ocs_${digest}` };
  }

  function ownerReadContext(identity, requestBinding) {
    try {
      return identity.kind === "codex"
        ? ownerContext(identity, { hostNativeOwner: true, requestBinding })
        : ownerContext(identity, requestBinding);
    } catch (error) {
      if (["host_native_owner_context_signing_unavailable", "owner_context_signing_unavailable"].includes(error?.message)) {
        return { access_mode: "standard", role: identity.role || "standard", owner_verified: false };
      }
      throw error;
    }
  }

  async function memoryContext(input, identity) {
    if (typeof contextProvider !== "function") return undefined;
    return contextProvider(input, identity);
  }

  async function galleryContext(input, identity) {
    if (typeof tenantWorkGallery?.load !== "function") {
      return compactGalleryBootstrap({
        available: false,
        state: "runtime_unavailable",
      }, identity.tenantId);
    }
    try {
      const gallery = await tenantWorkGallery.load(identity, input);
      if (String(gallery?.tenant_id || "") !== String(identity.tenantId || "")) {
        throw new Error("tenant_work_gallery_tenant_mismatch");
      }
      return compactGalleryBootstrap({
        ...gallery,
        available: true,
        state: "ready",
        generated_at: new Date().toISOString(),
      }, identity.tenantId);
    } catch (error) {
      const state = error?.code === "tenant_work_membership_required"
        || error?.message === "tenant_work_membership_required"
        ? "membership_required"
        : "runtime_unavailable";
      return compactGalleryBootstrap({ available: false, state }, identity.tenantId);
    }
  }

  function hierarchyInput(args = {}, identity, operation = "advisory_work") {
    const supplied = args.core_input && typeof args.core_input === "object" && !Array.isArray(args.core_input) ? args.core_input : {};
    // high_impact is escalation-only. The bridge derives the effective value
    // from bounded evidence, signals and operation semantics; a caller cannot
    // use false or a routing object to suppress V0 or grant execution.
    const { evidence_state: suppliedEvidenceState, routing: _callerRouting, ...boundedSupplied } = supplied;
    const request = String(args.request || args.message || args.question || args.decision || operation).slice(0, 12_000);
    const signals = Array.isArray(supplied.signals) && supplied.signals.length
      ? supplied.signals
      : [{ id: "mcp_runtime_request", label: operation, severity: 20, reversibility_hint: 80, risk_hint: 20 }];
    const evidenceEscalation = suppliedEvidenceState?.high_impact === true || args.evidence_state?.high_impact === true;
    const signalEscalation = signals.some((signal) => [
      signal?.severity, signal?.severity_hint, signal?.normalized_score, signal?.risk_hint,
    ].some((value) => typeof value === "number" && Number.isFinite(value) && value >= 85 && value <= 100));
    const operationEscalation = /(publish|pubblica|merge|deploy|rilasc|release|send|invia|delete|cancell|payment|pagament|write|scriv|update|modific)/i
      .test(`${request} ${operation}`);
    const highImpact = evidenceEscalation || signalEscalation || operationEscalation;
    return {
      ...boundedSupplied,
      request,
      signals,
      evidence_state: { high_impact: highImpact },
      context: { ...(supplied.context || {}), tenant_id: identity.tenantId },
    };
  }

  async function runtimeHierarchyEvaluate(args, identity, operation) {
    const started = Date.now();
    const input = hierarchyInput(args, identity, operation);
    const payload = await coreRequest("/v1/runtime/hierarchy/evaluate", identity.tenantId, {
      method: "POST",
      body: {
        core_input: input,
        ...(input.evidence_state.high_impact ? { routing: { high_impact: true } } : {}),
      },
    });
    return compactCoreRuntime({ ...payload, latency_ms: Date.now() - started });
  }

  async function intelligenceRequest(path, args, identity, options = {}) {
    const sharedContext = options.memory === false ? undefined : await memoryContext({
      query: args.request || args.question || args.decision || args.outcome_id || "Nyra Core intelligence analysis",
      project_id: args.project_id,
      session_id: args.session_id,
      agent_id: args.agent_id || "nyra",
    }, identity);
    const requestBody = {
      ...args,
      ...(sharedContext ? { memory_context: sharedContext } : {}),
      ...(args.work_preflight ? { work_preflight: args.work_preflight } : {}),
      tenant_id: identity.tenantId,
    };
    const requestBinding = options.ownerBindingPurpose
      ? ownerRequestBinding(options.ownerBindingPurpose, requestBody)
      : undefined;
    const coreAnalysis = await coreRequest(path, identity.tenantId, {
      method: "POST",
      body: { ...requestBody, owner_context: ownerContext(identity, requestBinding) },
    });
    if (options.nyraInterpretation !== true) return textResult(coreAnalysis);

    const interpretationInput = JSON.stringify({
      request: args.request || args.question || args.decision || "",
      workflow_id: coreAnalysis.result?.workflow_id,
      scenarios: coreAnalysis.result?.scenarios?.selected_scenario || null,
      leading_hypothesis: coreAnalysis.result?.hypotheses?.leading_hypothesis || null,
      highest_priority_event: coreAnalysis.result?.events?.highest_priority_event || null,
      preferred_counterfactual: coreAnalysis.result?.counterfactuals?.preferred_counterfactual || null,
      selected_option: coreAnalysis.result?.decision?.selected_option || null,
      requires_more_evidence: coreAnalysis.result?.decision?.requires_more_evidence,
    }).slice(0, 12_000);
    try {
      const nyraInterpretation = await coreRequest("/v1/nira/core-bridge", identity.tenantId, {
        method: "POST",
        body: {
          text: `Interpreta e spiega questo risultato Core senza autorizzare esecuzioni: ${interpretationInput}`,
          request_id: args.workflow_id || args.session_id,
          locale: args.locale || "it",
          mode: "standard",
          owner_context: ownerContext(identity),
          ...(sharedContext ? { memory_context: sharedContext } : {}),
          ...(args.work_preflight ? { work_preflight: args.work_preflight } : {}),
          tenant_id: identity.tenantId,
        },
      });
      return textResult({
        ...coreAnalysis,
        nyra_interpretation: nyraInterpretation,
        intelligence_path: { core_analyzed: true, nyra_interpreted: true, execution_allowed: false },
      });
    } catch {
      return textResult({
        ...coreAnalysis,
        nyra_interpretation: { ok: false, error: "nyra_interpretation_unavailable" },
        intelligence_path: { core_analyzed: true, nyra_interpreted: false, execution_allowed: false },
      });
    }
  }

  async function nyraDeepV2Request(args, identity, operation) {
    const operationType = NYRA_DEEP_V2_PREFLIGHT_OPERATION[operation];
    if (!operationType) throw new Error("nyra_deep_v2_mcp_operation_invalid");
    const requestId = String(
      args.request_id || `mcp-nyra-v2-${crypto.randomUUID()}`,
    ).slice(0, 160);
    const branchId = operation === "preview" ? null : String(args.branch_id || "");
    const subbranchId = operation === "preview" ? null : String(args.subbranch_id || "");
    const evidenceRefs = operation === "evaluate"
      ? [...(Array.isArray(args.evidence_refs) ? args.evidence_refs : [])]
      : [];
    const evidencePackHash = operation === "prepare_evidence"
      ? nyraDeepV2EvidencePackHash(args.evidence_pack, args.requirement_bindings)
      : null;
    const requestAttestation = signNyraDeepV2McpRequest({
      secret: config.nyraDeepV2McpRequestSigningSecret,
      tenantId: identity.tenantId,
      requestId,
      operation,
      branchId,
      subbranchId,
      evidenceRefs,
      evidencePackHash,
    });
    const sharedContext = await memoryContext({
      query: args.message,
      project_id: args.project_id,
      session_id: args.session_id,
      agent_id: args.agent_id || "nyra",
    }, identity);
    const deepBranchV2 = {
      operation,
      ...(branchId ? { branch_id: branchId, subbranch_id: subbranchId } : {}),
      evidence_refs: evidenceRefs,
      ...(operation === "prepare_evidence"
        ? {
          evidence_pack: args.evidence_pack,
          requirement_bindings: args.requirement_bindings,
          evidence_pack_hash: evidencePackHash,
        }
        : {}),
      request_attestation: requestAttestation,
    };
    const payload = await coreRequest("/v1/nira/core-bridge", identity.tenantId, {
      method: "POST",
      body: {
        text: args.message,
        request_id: requestId,
        source_tool: operationType,
        operation_type: operationType,
        nyra_branches: branchId
          ? [branchId]
          : [...(Array.isArray(args.nyra_branches) ? args.nyra_branches : [])],
        ...(sharedContext ? { memory_context: sharedContext } : {}),
        ...(args.work_preflight ? { work_preflight: args.work_preflight } : {}),
        deep_branch_v2: deepBranchV2,
        tenant_id: identity.tenantId,
      },
    });
    const runtime = payload?.result?.deep_branch_v2;
    if (
      !runtime
      || typeof runtime !== "object"
      || runtime.execution_authorized !== false
      || runtime.core_final_authority !== true
    ) {
      throw new Error("nyra_deep_v2_core_authority_binding_mismatch");
    }
    return {
      ok: payload?.ok === true,
      tenant_id: identity.tenantId,
      request_id: requestId,
      operation,
      core_runtime: coreRuntimeFromBridge(payload),
      work_preflight: compactWorkPreflight(
        payload?.result?.work_preflight || payload?.work_preflight,
      ),
      deep_branch_v2: runtime,
    };
  }

  function hostNativeSessionFingerprint(identity) {
    const fingerprint = String(identity?.agentPresence?.session_fingerprint || "").trim();
    if (!/^[a-f0-9]{16,64}$/i.test(fingerprint)) {
      throw new Error("host_native_session_presence_required");
    }
    return fingerprint.toLowerCase();
  }

  function hostNativeKind(identity) {
    const clientType = String(identity?.agentPresence?.client_type || "").toLowerCase();
    if (clientType === "codex") return "codex_native";
    if (clientType === "chatgpt") return "chatgpt_native";
    throw new Error("host_native_client_type_required");
  }

  async function trustedHostNativeTicketRecord(ticketId, identity, allowedStates) {
    const payload = await coreRequest(
      `/v1/host-native/actions/${encodeURIComponent(ticketId)}`,
      identity.tenantId,
      { useTenantGateway: true },
    );
    const record = payload?.action_ticket;
    const ticket = record?.ticket;
    const state = String(record?.state || "");
    const uses = record?.uses;
    const sessionFingerprint = hostNativeSessionFingerprint(identity);
    if (
      payload?.ok !== true ||
      payload.tenant_id !== identity.tenantId ||
      !record || typeof record !== "object" || Array.isArray(record) ||
      (record.schema_version !== undefined &&
        record.schema_version !== "host_native_action_ticket_record_v1") ||
      (record.tenant_id !== undefined && record.tenant_id !== identity.tenantId) ||
      !ticket || typeof ticket !== "object" || Array.isArray(ticket) ||
      ticket.schema_version !== "host_native_action_ticket_v1" ||
      ticket.tenant_id !== identity.tenantId ||
      ticket.ticket_id !== ticketId ||
      !/^hnd_[a-zA-Z0-9._-]{8,}$/.test(String(ticket.delegation_id || "")) ||
      typeof ticket.work_id !== "string" || ticket.work_id.length < 1 ||
      !/^[a-f0-9]{64}$/i.test(String(ticket.intent_anchor_digest || "")) ||
      typeof ticket.repository !== "string" || ticket.repository.length < 1 ||
      !["codex_native", "chatgpt_native"].includes(ticket.host_kind) ||
      ticket.host_session_fingerprint !== sessionFingerprint ||
      !ticket.action || typeof ticket.action !== "object" || Array.isArray(ticket.action) ||
      typeof ticket.action.kind !== "string" || ticket.action.kind.length < 1 ||
      !/^[a-f0-9]{64}$/i.test(String(ticket.evidence_digest || "")) ||
      !Number.isFinite(Date.parse(ticket.issued_at || "")) ||
      !Number.isFinite(Date.parse(ticket.expires_at || "")) ||
      ticket.max_uses !== 1 ||
      ticket.provider_execution !== false ||
      ticket.host_policy_override !== false ||
      ticket.host_policy_must_allow !== true ||
      !/^hnt_[a-f0-9]{64}$/i.test(String(ticket.signature || "")) ||
      !allowedStates.includes(state) ||
      !Number.isInteger(uses) || uses !== 1
    ) {
      throw new Error("host_native_ticket_readback_invalid");
    }
    return record;
  }

  function attachTrustedHostNativeTicket(error, record) {
    if (!error || !record) return error;
    Object.defineProperties(error, {
      hostNativeTicketTrusted: { value: true, enumerable: false },
      hostNativeTicketRecord: { value: record, enumerable: false },
    });
    return error;
  }

  function airlockBinding(input, identity) {
    const binding = input && typeof input === "object" ? input : {};
    const sessionId = String(identity.agentPresence?.session_id || binding.session_id || "").trim();
    if (!sessionId) throw new Error("research_airlock_session_id_required");
    return {
      project_id: binding.project_id,
      work_id: binding.work_id,
      session_id: sessionId,
    };
  }

  function policyRegistryExactRecord(value, fields) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
    const keys = Reflect.ownKeys(value);
    return keys.length === fields.length && keys.every((key) => typeof key === "string") &&
      fields.every((field) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, field);
        return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
      });
  }

  function assertPolicyRegistryPlainJson(value, code, {
    maxDepth = 64,
    maxNodes = 100_000,
  } = {}, state = { seen: new Set(), nodes: 0 }, depth = 0) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error(code);
      return;
    }
    if (typeof value !== "object" || state.seen.has(value) || depth >= maxDepth ||
      (Array.isArray(value)
        ? Object.getPrototypeOf(value) !== Array.prototype
        : Object.getPrototypeOf(value) !== Object.prototype)) {
      throw new Error(code);
    }
    state.nodes += 1;
    if (state.nodes > maxNodes) throw new Error(code);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" && key !== "length")) throw new Error(code);
    if (Array.isArray(value)) {
      const enumerableKeys = Object.keys(value);
      if (enumerableKeys.length !== value.length ||
        enumerableKeys.some((key, index) => key !== String(index)) ||
        keys.some((key) => key !== "length" && !enumerableKeys.includes(key))) {
        throw new Error(code);
      }
    }
    state.seen.add(value);
    for (const key of keys) {
      if (Array.isArray(value) && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(code);
      assertPolicyRegistryPlainJson(descriptor.value, code, { maxDepth, maxNodes }, state, depth + 1);
    }
    state.seen.delete(value);
  }

  function policyRegistryCanonicalBytes(value) {
    return Buffer.byteLength(JSON.stringify(stableCanonical(value)), "utf8");
  }

  function policyRegistryExactText(value, pattern, max) {
    return typeof value === "string" && value === value.trim() && value.length > 0 &&
      value.length <= max && (!pattern || pattern.test(value));
  }

  function policyRegistryUniqueTextList(value, { min = 0, max = 256, pattern = null } = {}) {
    if (!Array.isArray(value) || value.length < min || value.length > max) return false;
    const seen = new Set();
    for (const item of value) {
      if (!policyRegistryExactText(item, pattern, 200) || seen.has(item)) return false;
      seen.add(item);
    }
    return true;
  }

  function validatePolicyRegistryCompilerPack(pack, identity, domainPackId) {
    const packFields = [
      "schema_version", "pack_id", "version", "status", "scope", "parent_refs", "bindings",
      "privacy", "policy", "tests", "sources", "freshness_sla_days", "provenance",
      "valid_from", "expires_at", "rollback_to", "compatibility", "trust_mode", "signatures",
      "artifact_digest",
    ];
    const scopeFields = ["kind", "value", "tenant_id"];
    const bindingFields = ["core_branch_ids", "nyra_branch_ids", "domain_pack_ids"];
    const policyFields = [
      "allow_mode", "allow_actions", "deny_actions", "required_gates", "constraints",
    ];
    const scopeKinds = new Set([
      "core", "global", "sector", "tenant", "environment", "work_type", "action", "policy",
    ]);
    const tenantScopedKinds = new Set(["tenant", "environment", "work_type", "action", "policy"]);
    if (!policyRegistryExactRecord(pack, packFields) ||
      pack.schema_version !== "nyra_policy_pack_v1" ||
      !POLICY_REGISTRY_PACK_ID.test(pack.pack_id) ||
      !POLICY_REGISTRY_PACK_VERSION.test(pack.version) || pack.status !== "active" ||
      !policyRegistryExactRecord(pack.scope, scopeFields) || !scopeKinds.has(pack.scope.kind) ||
      !policyRegistryExactText(pack.scope.value, null, 160) ||
      (tenantScopedKinds.has(pack.scope.kind)
        ? !policyRegistryExactText(pack.scope.tenant_id, null, 120) ||
          pack.scope.tenant_id !== identity.tenantId
        : pack.scope.tenant_id !== null) ||
      !Array.isArray(pack.parent_refs) || pack.parent_refs.length > 8 ||
      !policyRegistryExactRecord(pack.bindings, bindingFields) ||
      !policyRegistryUniqueTextList(pack.bindings.core_branch_ids, { min: 1 }) ||
      !policyRegistryUniqueTextList(pack.bindings.nyra_branch_ids, { min: 1 }) ||
      !policyRegistryUniqueTextList(pack.bindings.domain_pack_ids, { min: 1 }) ||
      !pack.bindings.domain_pack_ids.includes(domainPackId) ||
      !policyRegistryExactRecord(pack.privacy, ["raw_customer_data_allowed", "data_classification"]) ||
      pack.privacy.raw_customer_data_allowed !== false ||
      !policyRegistryExactText(pack.privacy.data_classification, null, 80) ||
      !policyRegistryExactRecord(pack.policy, policyFields) ||
      !new Set(["inherit", "restrict"]).has(pack.policy.allow_mode) ||
      !policyRegistryUniqueTextList(pack.policy.allow_actions, { max: 4_096 }) ||
      !policyRegistryUniqueTextList(pack.policy.deny_actions, { max: 4_096 }) ||
      !policyRegistryUniqueTextList(pack.policy.required_gates, { max: 4_096 }) ||
      !pack.policy.constraints || typeof pack.policy.constraints !== "object" ||
      Array.isArray(pack.policy.constraints) ||
      !Array.isArray(pack.tests) || pack.tests.length < 2 || pack.tests.length > 32 ||
      !Array.isArray(pack.sources) || pack.sources.length < 1 || pack.sources.length > 16 ||
      !Number.isInteger(pack.freshness_sla_days) || pack.freshness_sla_days < 1 ||
      pack.freshness_sla_days > 3_650 ||
      !policyRegistryExactText(pack.valid_from, null, 64) ||
      !policyRegistryExactText(pack.expires_at, null, 64) ||
      !Number.isFinite(Date.parse(pack.valid_from)) || !Number.isFinite(Date.parse(pack.expires_at)) ||
      Date.parse(pack.valid_from) >= Date.parse(pack.expires_at) ||
      !new Set(["compiled_core", "signed_bundle"]).has(pack.trust_mode) ||
      !Array.isArray(pack.signatures) || pack.signatures.length > 4 ||
      !POLICY_REGISTRY_SHA256.test(pack.artifact_digest)) {
      throw new Error("policy_compiler_input_pack_invalid");
    }
    for (const parent of pack.parent_refs) {
      if (!policyRegistryExactRecord(parent, ["pack_id", "version", "digest"]) ||
        !POLICY_REGISTRY_PACK_ID.test(parent.pack_id) ||
        !POLICY_REGISTRY_PACK_VERSION.test(parent.version) ||
        !POLICY_REGISTRY_SHA256.test(parent.digest)) {
        throw new Error("policy_compiler_input_pack_invalid");
      }
    }
    const testOutcomes = new Set(pack.tests.map((entry) => entry?.expected));
    if (!testOutcomes.has("ALLOW") || !testOutcomes.has("DENY")) {
      throw new Error("policy_compiler_input_pack_invalid");
    }
    for (const source of pack.sources) {
      if (!policyRegistryExactRecord(source, ["source_id", "url", "claim", "reviewed_at"]) ||
        !POLICY_REGISTRY_PACK_ID.test(source.source_id) ||
        !policyRegistryExactText(source.url, /^https:\/\//, 2_000) ||
        !policyRegistryExactText(source.claim, null, 1_200) ||
        !policyRegistryExactText(source.reviewed_at, /^\d{4}-\d{2}-\d{2}$/, 32)) {
        throw new Error("policy_compiler_input_pack_invalid");
      }
    }
    const issuers = new Set();
    for (const signature of pack.signatures) {
      if (!policyRegistryExactRecord(signature, ["issuer_id", "algorithm", "signature"]) ||
        !POLICY_REGISTRY_PACK_ID.test(signature.issuer_id) || signature.algorithm !== "Ed25519" ||
        !POLICY_REGISTRY_SIGNATURE.test(signature.signature) || issuers.has(signature.issuer_id)) {
        throw new Error("policy_compiler_input_signature_invalid");
      }
      const decoded = Buffer.from(signature.signature, "base64url");
      if (decoded.length !== 64 || decoded.toString("base64url") !== signature.signature) {
        throw new Error("policy_compiler_input_signature_invalid");
      }
      issuers.add(signature.issuer_id);
    }
    if (pack.trust_mode === "compiled_core"
      ? pack.scope.kind !== "core" || pack.signatures.length !== 0
      : pack.signatures.length < 2) {
      throw new Error("policy_compiler_input_signature_invalid");
    }
    assertPolicyRegistryPlainJson(pack.policy.constraints, "policy_compiler_constraints_invalid", {
      maxDepth: 16,
      maxNodes: 4_096,
    });
    if (policyRegistryCanonicalBytes(pack.policy.constraints) > 65_536) {
      throw new Error("policy_compiler_constraints_invalid");
    }
  }

  function validatePolicyRegistryCompilerInput(compilerInput, identity, domainPackId) {
    assertPolicyRegistryPlainJson(compilerInput, "policy_compiler_input_invalid");
    if (policyRegistryCanonicalBytes(compilerInput) > POLICY_REGISTRY_COMPILER_INPUT_LIMIT_BYTES) {
      throw new Error("policy_compiler_input_oversize");
    }
    if (!policyRegistryExactRecord(compilerInput, ["schema_version", "leaf_pack_ids", "packs"]) ||
      compilerInput.schema_version !== "nyra_policy_compiler_input_v1" ||
      !Array.isArray(compilerInput.leaf_pack_ids) || compilerInput.leaf_pack_ids.length < 1 ||
      compilerInput.leaf_pack_ids.length > 16 || !Array.isArray(compilerInput.packs) ||
      compilerInput.packs.length < 1 || compilerInput.packs.length > 64) {
      throw new Error("policy_compiler_input_invalid");
    }
    let previousLeaf = null;
    for (const reference of compilerInput.leaf_pack_ids) {
      if (!POLICY_REGISTRY_PACK_REFERENCE.test(reference) ||
        (previousLeaf !== null && previousLeaf >= reference)) {
        throw new Error("policy_compiler_input_leaf_invalid");
      }
      previousLeaf = reference;
    }
    let previousPack = null;
    const packReferences = new Set();
    for (const pack of compilerInput.packs) {
      validatePolicyRegistryCompilerPack(pack, identity, domainPackId);
      const reference = `${pack.pack_id}@${pack.version}`;
      if (previousPack !== null && previousPack >= reference) {
        throw new Error("policy_compiler_input_noncanonical");
      }
      previousPack = reference;
      packReferences.add(reference);
    }
    if (compilerInput.leaf_pack_ids.some((reference) => !packReferences.has(reference))) {
      throw new Error("policy_compiler_input_leaf_invalid");
    }
    const forbidden = policyRegistryForbiddenField(compilerInput, "$.compiler_input");
    if (forbidden) throw new Error("policy_registry_caller_fields_invalid");
    return compilerInput;
  }

  function policyRegistryForbiddenField(value, path = "$") {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const nested = policyRegistryForbiddenField(value[index], `${path}[${index}]`);
        if (nested) return nested;
      }
      return null;
    }
    const insideConstraints = path === "$.policy.constraints" ||
      path.startsWith("$.policy.constraints.") ||
      /^\$\.compiler_input\.packs\[\d+\]\.policy\.constraints(?:\.|$)/.test(path);
    for (const [key, child] of Object.entries(value)) {
      if (
        POLICY_REGISTRY_FORBIDDEN_CALLER_FIELDS.has(key) ||
        /(?:^|_)(?:secret|private_key|signing_key|proof|receipt|attestation)(?:$|_)/i.test(key) ||
        (insideConstraints && POLICY_REGISTRY_FORBIDDEN_CONSTRAINT_CONTROL_FIELDS.has(key))
      ) return `${path}.${key}`;
      const nested = policyRegistryForbiddenField(child, `${path}.${key}`);
      if (nested) return nested;
    }
    return null;
  }

  function validatePolicyRegistryPreflight(preflight, identity, contract, domainPackId) {
    const gallery = preflight?.tenant_work_gallery;
    const security = preflight?.security_governance;
    if (
      !preflight || typeof preflight !== "object" || Array.isArray(preflight) ||
      preflight.schema_version !== "skinharmony_work_preflight_v1" ||
      typeof preflight.preflight_id !== "string" || preflight.preflight_id.length < 3 ||
      preflight.mandatory !== true ||
      preflight.tenant_id !== identity.tenantId ||
      preflight.operational_surface !== "tenant_work_gallery" ||
      gallery?.schema_version !== "tenant_work_gallery_v1" ||
      gallery?.tenant_id !== identity.tenantId ||
      gallery?.available !== true || gallery?.state !== "ready" ||
      preflight?.memory_first?.status !== "recalled" ||
      preflight?.governance?.execution_allowed_by_preflight !== false ||
      security?.schema_version !== "nyra_core_security_gate_v1" ||
      security?.always_on !== true || security?.fail_closed !== true ||
      security?.core_verdict_required !== true ||
      security?.source_instructions_are_data !== true ||
      security?.cross_tenant_blocked !== true ||
      preflight?.request?.operation_type !== contract.action ||
      (domainPackId && preflight?.domain_pack?.id !== domainPackId)
    ) {
      throw new Error("policy_registry_preflight_binding_invalid");
    }
    return preflight;
  }

  function validatePolicyRegistrySnapshot(snapshot, identity, domainPackId) {
    const exactFields = [
      "ancestry", "bindings", "domain_pack_id", "immutable", "leaf_packs", "policy",
      "resolution", "schema_version", "snapshot_digest", "sources", "tenant_id", "validity",
    ];
    if (
      !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      Object.keys(snapshot).sort().join("\0") !== exactFields.sort().join("\0") ||
      snapshot.schema_version !== "nyra_policy_registry_v1" ||
      snapshot.tenant_id !== identity.tenantId ||
      snapshot.domain_pack_id !== domainPackId ||
      snapshot.immutable !== true ||
      !POLICY_REGISTRY_SHA256.test(String(snapshot.snapshot_digest || "")) ||
      policyRegistryCanonicalBytes(snapshot) > POLICY_REGISTRY_SNAPSHOT_LIMIT_BYTES
    ) throw new Error("policy_registry_snapshot_invalid");
    const forbidden = policyRegistryForbiddenField(snapshot);
    if (forbidden) throw new Error("policy_registry_snapshot_not_pure");
    const body = structuredClone(snapshot);
    delete body.snapshot_digest;
    const computed = crypto.createHash("sha256")
      .update(JSON.stringify(stableCanonical(body)))
      .digest("hex");
    if (computed !== snapshot.snapshot_digest) throw new Error("policy_registry_snapshot_invalid");
    return snapshot;
  }

  function projectPolicyRegistryResponse(kind, payload, identity, args, preflight) {
    const contract = POLICY_REGISTRY_ROUTES[kind];
    const authorization = payload?.authorization;
    const result = payload?.[contract.responseField];
    if (
      payload?.ok !== true || payload?.tenant_id !== identity.tenantId ||
      String(payload?.work_id || "").toLowerCase() !== String(args.work_id).toLowerCase() ||
      !authorization || typeof authorization !== "object" || Array.isArray(authorization) ||
      authorization.allowed !== true || authorization.scope !== "policy_registry_snapshot_mutation" ||
      typeof authorization.state !== "string" || authorization.confirmation_satisfied !== true ||
      authorization.core_final_authority !== true || authorization.caller_authority !== false ||
      authorization.provider_execution_authorized !== false ||
      !result || typeof result !== "object" || Array.isArray(result) ||
      result.tenant_id !== identity.tenantId ||
      String(result.work_id || "").toLowerCase() !== String(args.work_id).toLowerCase() ||
      result.operation_id !== args.operation_id || result.preflight_id !== preflight.preflight_id ||
      !POLICY_REGISTRY_SHA256.test(String(result.snapshot_digest || "")) ||
      !POLICY_REGISTRY_SHA256.test(String(result.compiler_provenance_digest || "")) ||
      result[contract.successField] !== true || typeof result.idempotent_replay !== "boolean" ||
      result.proof_status !== "consumed" || result.execution_authorized !== false ||
      result.provider_execution_authorized !== false || result.caller_authority !== false
    ) throw new Error("policy_registry_core_response_invalid");
    if (result.intent_digest !== undefined && !POLICY_REGISTRY_SHA256.test(String(result.intent_digest))) {
      throw new Error("policy_registry_core_response_invalid");
    }
    if (result.activation_generation !== undefined &&
      (!Number.isSafeInteger(result.activation_generation) || result.activation_generation < 0)) {
      throw new Error("policy_registry_core_response_invalid");
    }
    const projectedResult = {
      tenant_id: identity.tenantId,
      work_id: String(args.work_id).toLowerCase(),
      operation_id: args.operation_id,
      preflight_id: preflight.preflight_id,
      snapshot_digest: result.snapshot_digest,
      compiler_provenance_digest: result.compiler_provenance_digest,
      [contract.successField]: true,
      idempotent_replay: result.idempotent_replay,
      proof_status: "consumed",
      execution_authorized: false,
      provider_execution_authorized: false,
      caller_authority: false,
      ...(result.intent_digest ? { intent_digest: result.intent_digest } : {}),
      ...(result.activation_generation !== undefined
        ? { activation_generation: result.activation_generation }
        : {}),
    };
    return {
      ok: true,
      tenant_id: identity.tenantId,
      work_id: String(args.work_id).toLowerCase(),
      [contract.responseField]: projectedResult,
      authorization: {
        allowed: true,
        state: authorization.state,
        scope: "policy_registry_snapshot_mutation",
        confirmation_satisfied: true,
        core_final_authority: true,
        caller_authority: false,
        provider_execution_authorized: false,
      },
      execution_authorized: false,
      provider_execution_authorized: false,
      caller_authority: false,
    };
  }

  async function policyRegistryLifecycle(kind, args, identity) {
    const contract = POLICY_REGISTRY_ROUTES[kind];
    if (!contract) throw new Error("policy_registry_operation_invalid");
    const workId = String(args?.work_id || "").trim().toLowerCase();
    const operationId = String(args?.operation_id || "").trim();
    const domainPackId = kind === "reconcile" ? null : String(args?.domain_pack_id || "").trim();
    const allowedFields = new Set([
      "work_id", "operation_id", "owner_confirmed", "confirmation_reference",
      "agent_id", "client_type", "session_id", "work_preflight",
      ...(kind === "activate" ? ["domain_pack_id", "snapshot", "compiler_input"] : []),
      ...(kind === "rollback" ? ["domain_pack_id", "target_snapshot_digest"] : []),
    ]);
    if (!args || typeof args !== "object" || Array.isArray(args) ||
      Object.keys(args).some((field) => !allowedFields.has(field))) {
      throw new Error("policy_registry_caller_fields_invalid");
    }
    if (!POLICY_REGISTRY_WORK_ID.test(workId) || !POLICY_REGISTRY_OPERATION_ID.test(operationId) ||
      (domainPackId && !POLICY_REGISTRY_DOMAIN_PACK_ID.test(domainPackId))) {
      throw new Error("policy_registry_request_invalid");
    }
    if (args.owner_confirmed !== true || identity?.ownerConfirmed !== true) {
      throw new Error("owner_confirmation_required");
    }
    const preflight = validatePolicyRegistryPreflight(args.work_preflight, identity, contract, domainPackId);
    if (kind === "activate") {
      validatePolicyRegistrySnapshot(args.snapshot, identity, domainPackId);
      validatePolicyRegistryCompilerInput(args.compiler_input, identity, domainPackId);
    }
    if (kind === "rollback" && !POLICY_REGISTRY_SHA256.test(String(args.target_snapshot_digest || ""))) {
      throw new Error("policy_registry_request_invalid");
    }
    const ownerMode = requireHostNativeOwnerConfirmation(identity, config);
    const requestBody = {
      tenant_id: identity.tenantId,
      work_id: workId,
      operation_id: operationId,
      ...(domainPackId ? { domain_pack_id: domainPackId } : {}),
      work_preflight: preflight,
      owner_confirmed: true,
      confirmation_reference: hostNativeConfirmationReference(
        identity,
        ownerMode,
        contract.purpose,
        operationId,
      ),
      ...(kind === "activate" ? { snapshot: args.snapshot } : {}),
      ...(kind === "activate" ? { compiler_input: args.compiler_input } : {}),
      ...(kind === "rollback" ? { target_snapshot_digest: args.target_snapshot_digest } : {}),
    };
    const body = {
      ...requestBody,
      owner_context: ownerContext(identity, {
        hostNativeOwner: true,
        requestBinding: ownerRequestBinding(contract.purpose, requestBody),
      }),
    };
    if (Buffer.byteLength(canonicalDttWorkContextBody(body), "utf8") >
      POLICY_REGISTRY_REQUEST_LIMIT_BYTES) {
      throw new Error("policy_registry_request_too_large");
    }
    const payload = await dttCoreRequest(contract.path, { work_id: workId }, identity, {
      method: "POST",
      body,
      preservePolicyRegistryDomainPackId: kind !== "reconcile",
      strictTransport: true,
      timeoutMs: policyRegistryCoreTimeoutMs,
    });
    return dedicatedCoreTextResult(
      projectPolicyRegistryResponse(kind, payload, identity, { ...args, work_id: workId, operation_id: operationId }, preflight),
      contract.path,
    );
  }

  const handlers = {
    core_health: async (_args, identity) => {
      const coreHealth = await coreRequest("/healthz", identity.tenantId);
      let icfGenericWorkCoreJoin;
      try {
        const attestation = await coreRequest(
          "/v1/icf/runtime/attestation",
          identity.tenantId,
          {
            strictTransport: true,
            timeoutMs: POLICY_REGISTRY_CORE_TIMEOUT_MS,
            maxResponseBytes: POLICY_REGISTRY_RESPONSE_LIMIT_BYTES,
          },
        );
        icfGenericWorkCoreJoin = projectIcfGenericWorkCoreJoinAttestation(attestation);
      } catch {
        icfGenericWorkCoreJoin = projectIcfGenericWorkCoreJoinAttestation(
          null,
          { unavailable: true },
        );
      }
      return textResult({
        ...coreHealth,
        generic_work_core_join_remote_ed25519:
          coreHealth?.generic_work_core_join
          && typeof coreHealth.generic_work_core_join === "object"
          && !Array.isArray(coreHealth.generic_work_core_join)
            ? coreHealth.generic_work_core_join
            : null,
        generic_work_core_join: icfGenericWorkCoreJoin,
        tenant_id: identity.tenantId,
        mcp_identity: ownerBindingStatus(config, identity),
      });
    },
    nyra_policy_registry_activate: async (args, identity) =>
      policyRegistryLifecycle("activate", args, identity),
    nyra_policy_registry_rollback: async (args, identity) =>
      policyRegistryLifecycle("rollback", args, identity),
    nyra_policy_registry_reconcile: async (args, identity) =>
      policyRegistryLifecycle("reconcile", args, identity),
    host_native_status: async (_args, identity) => textResult(
      await coreRequest("/v1/host-native/status", identity.tenantId),
    ),
    host_native_work_plan_create: async (args, identity) => textResult(
      await coreRequest("/v1/host-native/work-plans", identity.tenantId, {
        method: "POST",
        body: {
          work_id: args.work_id,
          intent_anchor_digest: args.intent_anchor_digest,
          repository: args.repository,
          base_branch: args.base_branch,
          objective: args.objective,
          required_checks: args.required_checks,
          agents: args.agents,
          ...(args.max_parallel === undefined ? {} : { max_parallel: args.max_parallel }),
        },
      }),
    ),
    host_native_release_intent_build: async (args, identity) => {
      const route = "/v1/host-native/release-intents";
      return dedicatedCoreTextResult(await coreRequest(route, identity.tenantId, {
        method: "POST",
        body: {
          work_id: args.work_id,
          intent_anchor_digest: args.intent_anchor_digest,
          repository: args.repository,
          base_branch: args.base_branch,
          delivery_branch: args.delivery_branch,
          base_commit: args.base_commit,
          head_commit: args.head_commit,
          tree_sha: args.tree_sha,
          diff_digest: args.diff_digest,
          changed_files: args.changed_files,
          verification: args.verification,
          delivery: args.delivery,
          rollback: args.rollback,
        },
      }), route);
    },
    host_native_core_join_issue: async (args, identity) => {
      const route = "/v1/host-native/core-join-verdicts";
      return dedicatedCoreTextResult(await coreRequest(route, identity.tenantId, {
        method: "POST",
        useTenantGateway: true,
        body: {
          work_id: args.work_id,
          intent_anchor_digest: args.intent_anchor_digest,
          repository: args.repository,
          core_plan_id: args.core_plan_id,
          core_plan_digest: args.core_plan_digest,
          local_plan_id: args.local_plan_id,
          local_plan_digest: args.local_plan_digest,
          evaluation_digest: args.evaluation_digest,
          acceptance_criteria: args.acceptance_criteria,
          builder_report: args.builder_report,
          verifier_reports: args.verifier_reports,
          checks: args.checks,
          closure_attestation: args.closure_attestation,
          release_intent: args.release_intent,
          ...(args.required_checks_policy_digest
            ? { required_checks_policy_digest: args.required_checks_policy_digest }
            : {}),
          provider_execution: false,
          idempotency_key: args.idempotency_key,
        },
      }), route);
    },
    generic_work_core_join_issue: async (args, identity) => {
      const route = "/v1/work-continuity/generic-core-join";
      const { tenant_id: _callerTenantId, authenticated_tenant_id: _callerAuthenticatedTenantId,
        secret: _secret, signing_secret: _signingSecret, verifier_secret: _verifierSecret, ...body } = args || {};
      const response = await genericWorkCoreJoinCoreRequest(route, body, identity, {
        method: "POST", body,
      });
      const verdict = response?.verdict;
      const expectedWorkId = String(body.work_id || "").trim().toLowerCase();
      const hash = /^[a-f0-9]{64}$/i;
      if (!response || response.ok !== true || !verdict || typeof verdict !== "object" || Array.isArray(verdict) ||
          verdict.schema_version !== "generic_work_core_join_v1" ||
          !/^gwcj_[a-f0-9]{40}$/i.test(String(verdict.verdict_id || "")) ||
          String(verdict.tenant_id || "") !== String(identity.tenantId || "") ||
          String(verdict.work_id || "").toLowerCase() !== expectedWorkId ||
          !verdict.adapter || !hash.test(String(verdict.acceptance_criteria_digest || "")) ||
          !hash.test(String(verdict.task_state_digest || "")) || !hash.test(String(verdict.evidence_digest || "")) ||
          !hash.test(String(verdict.independent_verifier_receipt_digest || "")) ||
          !hash.test(String(verdict.idempotency_digest || "")) || !hash.test(String(verdict.verdict_digest || "")) ||
          verdict.authority !== "universal_core" || verdict.decision !== "GENERIC_WORK_CORE_JOIN_ELIGIBLE" ||
          verdict.execution_authorized !== false || verdict.host_action_authorized !== false ||
          typeof verdict.signature !== "string" || verdict.signature.length < 16) {
        throw new Error("generic_work_core_join_response_invalid");
      }
      return dedicatedCoreTextResult({ ok: true, generic_core_join_verdict: verdict }, route);
    },
    host_native_standing_release_mandate_install: async (args, identity) => {
      const ownerMode = requireHostNativeOwnerConfirmation(identity, config);
      const ttlSeconds = Number(args.ttl_seconds);
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 2_592_000) {
        throw new Error("standing_release_mandate_ttl_invalid");
      }
      const persistedIntent = await persistedStandingReleaseIntent(
        identity,
        args.authorization_work_id,
        args.authorization_intent_anchor_digest,
      );
      const requestBody = {
        authorization_work_id: persistedIntent.work_id,
        authorization_intent_anchor_digest: persistedIntent.intent_anchor_digest,
        authorization_intent_binding: persistedIntent.binding,
        repository: args.repository,
        base_branch: args.base_branch,
        delivery_branch_prefix: args.delivery_branch_prefix,
        allowed_path_prefixes: args.allowed_path_prefixes,
        denied_path_prefixes: args.denied_path_prefixes || [],
        required_checks: args.required_checks,
        required_checks_policy_digest: args.required_checks_policy_digest,
        services: args.services,
        repair_classes: args.repair_classes,
        limits: args.limits,
        base_protection_required: args.base_protection_required === true,
        expires_at: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
        idempotency_key: args.idempotency_key,
        owner_confirmed: true,
        confirmation_reference: hostNativeConfirmationReference(
          identity,
          ownerMode,
          "host_native_standing_release_mandate_install",
          args.idempotency_key,
        ),
      };
      const route = "/v1/host-native/standing-release/mandates";
      const payload = await dttCoreRequest(route, { work_id: persistedIntent.work_id }, identity, {
        method: "POST",
        body: {
          ...requestBody,
          owner_context: ownerContext(identity, {
            hostNativeOwner: true,
            requestBinding: ownerRequestBinding(
              "host_native_standing_release_mandate_install",
              requestBody,
            ),
          }),
        },
        strictTransport: true,
      });
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_standing_release_mandate_read: async (args, identity) => {
      const route = `/v1/host-native/standing-release/mandates/${encodeURIComponent(args.mandate_id)}`;
      return textResult(await dttCoreRequest(
        route,
        { work_id: args.work_id },
        identity,
        { method: "GET", strictTransport: true },
      ));
    },
    host_native_standing_release_mandate_revoke: async (args, identity) => {
      const ownerMode = requireHostNativeOwnerConfirmation(identity, config);
      const requestBody = {
        mandate_id: args.mandate_id,
        reason_digest: args.reason_digest,
        idempotency_key: args.idempotency_key,
        owner_confirmed: true,
        confirmation_reference: hostNativeConfirmationReference(
          identity,
          ownerMode,
          "host_native_standing_release_mandate_revoke",
          args.idempotency_key,
        ),
      };
      const route = `/v1/host-native/standing-release/mandates/${encodeURIComponent(args.mandate_id)}/revoke`;
      const payload = await coreRequest(route, identity.tenantId, {
        method: "POST",
        body: {
          ...requestBody,
          owner_context: ownerContext(identity, {
            hostNativeOwner: true,
            requestBinding: ownerRequestBinding(
              "host_native_standing_release_mandate_revoke",
              requestBody,
            ),
          }),
        },
      });
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_standing_release_delegation_derive: async (args, identity) => {
      const route = `/v1/host-native/standing-release/mandates/${encodeURIComponent(args.mandate_id)}/derive-delegation`;
      const persistedIntent = await persistedStandingReleaseIntent(
        identity,
        args.work_id,
        args.intent_anchor_digest,
      );
      const payload = await dttCoreRequest(route, { work_id: persistedIntent.work_id }, identity, {
        method: "POST",
        body: {
          work_id: persistedIntent.work_id,
          intent_anchor_digest: persistedIntent.intent_anchor_digest,
          intent_binding: persistedIntent.binding,
          delivery_branch: args.delivery_branch,
          changed_files: args.changed_files,
          builder_agent_id: args.builder_agent_id,
          verifier_agent_ids: args.verifier_agent_ids,
          required_checks_policy_digest: args.required_checks_policy_digest,
          induced_services: args.induced_services,
          host_kind: hostNativeKind(identity),
          host_session_fingerprint: hostNativeSessionFingerprint(identity),
          ttl_seconds: args.ttl_seconds,
          idempotency_key: args.idempotency_key,
        },
        strictTransport: true,
      });
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_standing_release_run_start: async (args, identity) => {
      const route = "/v1/host-native/standing-release/runs";
      const persistedIntent = await persistedStandingReleaseIntent(
        identity,
        args.work_id,
        args.intent_anchor_digest,
      );
      const body = {
        delegation_id: args.delegation_id,
        work_id: persistedIntent.work_id,
        intent_anchor_digest: persistedIntent.intent_anchor_digest,
        intent_binding: persistedIntent.binding,
        host_kind: hostNativeKind(identity),
        host_session_fingerprint: hostNativeSessionFingerprint(identity),
        idempotency_key: args.idempotency_key,
      };
      const payload = await dttCoreRequest(route, { work_id: persistedIntent.work_id }, identity, {
        method: "POST",
        body,
        strictTransport: true,
      });
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_standing_release_run_read: async (args, identity) => {
      const route = `/v1/host-native/standing-release/runs/${encodeURIComponent(args.run_id)}`;
      return textResult(await dttCoreRequest(
        route,
        { work_id: args.work_id },
        identity,
        { method: "GET", strictTransport: true },
      ));
    },
    host_native_standing_release_run_bind_ticket: async (args, identity) => {
      const route = `/v1/host-native/standing-release/runs/${encodeURIComponent(args.run_id)}/bind-ticket`;
      const persistedIntent = await persistedStandingReleaseIntent(
        identity,
        args.work_id,
        args.intent_anchor_digest,
      );
      const body = {
        work_id: persistedIntent.work_id,
        intent_anchor_digest: persistedIntent.intent_anchor_digest,
        intent_binding: persistedIntent.binding,
        ticket_id: args.ticket_id,
        expected_version: args.expected_version,
        idempotency_key: args.idempotency_key,
      };
      const payload = await dttCoreRequest(route, { work_id: persistedIntent.work_id }, identity, {
        method: "POST",
        body,
        strictTransport: true,
      });
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_standing_release_run_reserve: async (args, identity) => {
      if (
        config.standingReleaseAutoCoordinatorConfigurationValid === false ||
        (config.standingReleaseAutoCoordinatorEnabled &&
          !config.githubStandingReleaseWorkerUrl)
      ) {
        throw new Error("standing_release_auto_coordinator_unavailable");
      }
      const route = `/v1/host-native/standing-release/runs/${encodeURIComponent(args.run_id)}/reserve`;
      const persistedIntent = await persistedStandingReleaseIntent(
        identity,
        args.work_id,
        args.intent_anchor_digest,
      );
      const body = {
        work_id: persistedIntent.work_id,
        intent_anchor_digest: persistedIntent.intent_anchor_digest,
        intent_binding: persistedIntent.binding,
        ticket_id: args.ticket_id,
        expected_version: args.expected_version,
        host_session_fingerprint: hostNativeSessionFingerprint(identity),
        idempotency_key: args.idempotency_key,
      };
      const payload = await dttCoreRequest(route, { work_id: persistedIntent.work_id }, identity, {
        method: "POST",
        body,
        strictTransport: true,
      });
      const claim = payload?.github_execution_claim;
      if (!config.standingReleaseAutoCoordinatorEnabled || !claim) {
        return dedicatedCoreTextResult(payload, route);
      }
      if (
        claim.schema_version !== "github_worker_execution_claim_v1" ||
        claim.tenant_id !== identity.tenantId ||
        String(claim.work_id || "").toLowerCase() !== persistedIntent.work_id ||
        claim.ticket_id !== args.ticket_id ||
        claim.ticket_id !== payload?.action_ticket?.ticket?.ticket_id ||
        claim.reservation_id !== payload?.action_ticket?.reservation_id
      ) {
        throw new Error("standing_release_auto_claim_binding_mismatch");
      }
      // A reserve replay returns the authoritative current ticket. Once the
      // first attempt has marked it reconciliation_required or completed, do
      // not mint another worker attempt from the freshly signed replay claim.
      if (payload.action_ticket.state !== "reserved") {
        return dedicatedCoreTextResult(payload, route);
      }

      const dispatchDigest = standingReleaseAutoDigest({
        schema_version: "standing_release_auto_dispatch_evidence_v1",
        ticket_id: claim.ticket_id,
        reservation_id: claim.reservation_id,
        action_digest: claim.action_digest,
        nonce: claim.nonce,
        state: "outcome_unknown_before_dispatch",
      });
      const markerIntent = await persistedStandingReleaseIntent(
        identity,
        args.work_id,
        args.intent_anchor_digest,
      );
      const completeRoute = `/v1/host-native/standing-release/runs/${encodeURIComponent(args.run_id)}/complete`;
      const marker = await dttCoreRequest(
        completeRoute,
        { work_id: markerIntent.work_id },
        identity,
        {
          method: "POST",
          strictTransport: true,
          body: {
            work_id: markerIntent.work_id,
            intent_anchor_digest: markerIntent.intent_anchor_digest,
            intent_binding: markerIntent.binding,
            ticket_id: claim.ticket_id,
            expected_version: args.expected_version,
            reservation_id: claim.reservation_id,
            host_session_fingerprint: hostNativeSessionFingerprint(identity),
            outcome: "unknown",
            result_digest: dispatchDigest,
            idempotency_key: `auto-dispatch-${crypto.createHash("sha256")
              .update(args.idempotency_key).digest("hex").slice(0, 32)}`,
          },
        },
      );

      let workerResponse;
      let workerPayload;
      try {
        workerResponse = await fetchImpl(`${config.githubStandingReleaseWorkerUrl}/v1/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claim,
            ...(args.materialization ? { materialization: args.materialization } : {}),
          }),
        });
        workerPayload = await workerResponse.json().catch(() => null);
      } catch {
        throw new Error("standing_release_auto_execution_outcome_unknown");
      }
      if (!workerResponse.ok) {
        const code = String(workerPayload?.error || "");
        const error = new Error(code === "github_worker_execution_outcome_unknown"
          ? "standing_release_auto_execution_outcome_unknown"
          : "standing_release_auto_execution_failed");
        error.statusCode = workerResponse.status;
        throw error;
      }

      const execution = workerPayload?.execution;
      const result = execution?.result;
      const actionKind = String(claim.action?.kind || "");
      const commitAction = ["git.push.branch", "github.merge"].includes(actionKind);
      const pullRequestAction = ["github.draft_pr", "github.ready"].includes(actionKind);
      if (
        workerPayload?.ok !== true ||
        workerPayload?.provider_execution !== true ||
        execution?.schema_version !== "github_worker_execution_record_v1" ||
        execution?.state !== "succeeded" ||
        execution?.tenant_id !== claim.tenant_id ||
        execution?.repository !== claim.repository ||
        execution?.ticket_id !== claim.ticket_id ||
        execution?.reservation_id !== claim.reservation_id ||
        execution?.action_digest !== claim.action_digest ||
        execution?.nonce !== claim.nonce ||
        execution?.claim_digest !== standingReleaseAutoDigest(claim) ||
        !/^gwl_[a-f0-9]{64}$/.test(String(execution?.signature || "")) ||
        result?.outcome !== "success" ||
        (!commitAction && !pullRequestAction) ||
        (commitAction && !/^[a-f0-9]{40}$/.test(String(result?.result_commit || ""))) ||
        (pullRequestAction && !/^[a-f0-9]{40}$/.test(String(claim.action?.head_commit || ""))) ||
        (pullRequestAction && (!Number.isSafeInteger(result?.result_pull_request) ||
          result.result_pull_request < 1))
      ) {
        throw new Error("standing_release_auto_worker_result_invalid");
      }

      const resultDigest = standingReleaseAutoDigest({
        schema_version: "standing_release_auto_execution_evidence_v1",
        ticket_id: claim.ticket_id,
        reservation_id: claim.reservation_id,
        action_digest: claim.action_digest,
        state: execution.state,
        result: execution.result,
      });
      const reconcileIntent = await persistedStandingReleaseIntent(
        identity,
        args.work_id,
        args.intent_anchor_digest,
      );
      const reconcileRoute = `/v1/host-native/standing-release/runs/${encodeURIComponent(args.run_id)}/reconcile`;
      const reconcileBody = {
        work_id: reconcileIntent.work_id,
        intent_anchor_digest: reconcileIntent.intent_anchor_digest,
        intent_binding: reconcileIntent.binding,
        ticket_id: claim.ticket_id,
        expected_version: args.expected_version,
        reservation_id: claim.reservation_id,
        host_session_fingerprint: hostNativeSessionFingerprint(identity),
        observed_outcome: "success",
        readback_digest: resultDigest,
        idempotency_key: `auto-reconcile-${crypto.createHash("sha256")
          .update(args.idempotency_key).digest("hex").slice(0, 32)}`,
        observed_commit: result.result_commit || claim.action.head_commit,
        ...(result.result_pull_request === undefined
          ? {}
          : { observed_pull_request: result.result_pull_request }),
      };
      const reconciliation = await dttCoreRequest(
        reconcileRoute,
        { work_id: reconcileIntent.work_id },
        identity,
        { method: "POST", body: reconcileBody, strictTransport: true },
      );
      return dedicatedCoreTextResult({
        ...payload,
        standing_release_auto_coordinator: {
          schema_version: "standing_release_auto_coordinator_result_v1",
          forwarded: true,
          core_unknown_marker: marker,
          worker_execution: execution,
          core_reconciliation: reconciliation,
          provider_execution: true,
        },
      }, route);
    },
    host_native_standing_release_run_complete: async (args, identity) => {
      const route = `/v1/host-native/standing-release/runs/${encodeURIComponent(args.run_id)}/complete`;
      const persistedIntent = await persistedStandingReleaseIntent(
        identity,
        args.work_id,
        args.intent_anchor_digest,
      );
      const body = {
        work_id: persistedIntent.work_id,
        intent_anchor_digest: persistedIntent.intent_anchor_digest,
        intent_binding: persistedIntent.binding,
        ticket_id: args.ticket_id,
        expected_version: args.expected_version,
        reservation_id: args.reservation_id,
        host_session_fingerprint: hostNativeSessionFingerprint(identity),
        outcome: args.outcome,
        result_digest: args.result_digest,
        idempotency_key: args.idempotency_key,
        ...(args.result_commit ? { result_commit: args.result_commit } : {}),
        ...(args.result_pull_request === undefined
          ? {}
          : { result_pull_request: args.result_pull_request }),
        ...(args.readback_digest ? { readback_digest: args.readback_digest } : {}),
      };
      const payload = await dttCoreRequest(
        route,
        { work_id: persistedIntent.work_id },
        identity,
        { method: "POST", body, strictTransport: true },
      );
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_standing_release_run_reconcile: async (args, identity) => {
      const route = `/v1/host-native/standing-release/runs/${encodeURIComponent(args.run_id)}/reconcile`;
      const persistedIntent = await persistedStandingReleaseIntent(
        identity,
        args.work_id,
        args.intent_anchor_digest,
      );
      const body = {
        work_id: persistedIntent.work_id,
        intent_anchor_digest: persistedIntent.intent_anchor_digest,
        intent_binding: persistedIntent.binding,
        ticket_id: args.ticket_id,
        expected_version: args.expected_version,
        reservation_id: args.reservation_id,
        host_session_fingerprint: hostNativeSessionFingerprint(identity),
        observed_outcome: args.observed_outcome,
        readback_digest: args.readback_digest,
        idempotency_key: args.idempotency_key,
        ...(args.observed_commit ? { observed_commit: args.observed_commit } : {}),
        ...(args.observed_pull_request === undefined
          ? {}
          : { observed_pull_request: args.observed_pull_request }),
      };
      const payload = await dttCoreRequest(
        route,
        { work_id: persistedIntent.work_id },
        identity,
        { method: "POST", body, strictTransport: true },
      );
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_standing_release_run_advance: async (args, identity) => {
      const route = `/v1/host-native/standing-release/runs/${encodeURIComponent(args.run_id)}/advance`;
      const persistedIntent = await persistedStandingReleaseIntent(
        identity,
        args.work_id,
        args.intent_anchor_digest,
      );
      const body = {
        work_id: persistedIntent.work_id,
        intent_anchor_digest: persistedIntent.intent_anchor_digest,
        intent_binding: persistedIntent.binding,
        ticket_id: args.ticket_id,
        expected_version: args.expected_version,
        idempotency_key: args.idempotency_key,
      };
      const payload = await dttCoreRequest(route, { work_id: persistedIntent.work_id }, identity, {
        method: "POST",
        body,
        strictTransport: true,
      });
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_standing_release_run_quarantine_expired: async (args, identity) => {
      const route = `/v1/host-native/standing-release/runs/${encodeURIComponent(args.run_id)}/quarantine-expired`;
      const persistedIntent = await persistedStandingReleaseIntent(
        identity,
        args.work_id,
        args.intent_anchor_digest,
      );
      const body = {
        work_id: persistedIntent.work_id,
        intent_anchor_digest: persistedIntent.intent_anchor_digest,
        intent_binding: persistedIntent.binding,
        ticket_id: args.ticket_id,
        reservation_id: args.reservation_id,
        expected_version: args.expected_version,
        idempotency_key: args.idempotency_key,
      };
      const payload = await dttCoreRequest(route, { work_id: persistedIntent.work_id }, identity, {
        method: "POST",
        body,
        strictTransport: true,
      });
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_standing_release_run_cancel: async (args, identity) => {
      const route = `/v1/host-native/standing-release/runs/${encodeURIComponent(args.run_id)}/cancel`;
      const persistedIntent = await persistedStandingReleaseIntent(
        identity,
        args.work_id,
        args.intent_anchor_digest,
      );
      const body = {
        work_id: persistedIntent.work_id,
        intent_anchor_digest: persistedIntent.intent_anchor_digest,
        intent_binding: persistedIntent.binding,
        reason_digest: args.reason_digest,
        expected_version: args.expected_version,
        idempotency_key: args.idempotency_key,
      };
      const payload = await dttCoreRequest(route, { work_id: persistedIntent.work_id }, identity, {
        method: "POST",
        body,
        strictTransport: true,
      });
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_standing_release_github_execute: async (args, identity) => {
      const persistedIntent = await persistedStandingReleaseIntent(identity, args.work_id, args.intent_anchor_digest);
      if (String(args.claim?.tenant_id || "") !== String(identity.tenantId || "") ||
          String(args.claim?.work_id || "").toLowerCase() !== persistedIntent.work_id ||
          String(args.claim?.schema_version || "") !== "github_worker_execution_claim_v1") {
        throw new Error("github_worker_execution_claim_binding_mismatch");
      }
      if (!config.githubStandingReleaseWorkerUrl) throw new Error("github_worker_unavailable");
      const response = await fetchImpl(`${config.githubStandingReleaseWorkerUrl}/v1/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim: args.claim, ...(args.materialization ? { materialization: args.materialization } : {}) }),
      });
      const payload = await response.json().catch(() => ({ error: "github_worker_invalid_response" }));
      if (!response.ok) {
        const error = new Error(String(payload?.error || "github_worker_execution_failed"));
        error.statusCode = response.status;
        throw error;
      }
      return dedicatedCoreTextResult(payload, "/v1/execute");
    },
    host_native_standing_release_github_reconcile: async (args, identity) => {
      const persistedIntent = await persistedStandingReleaseIntent(identity, args.work_id, args.intent_anchor_digest);
      if (String(args.claim?.tenant_id || "") !== String(identity.tenantId || "") ||
          String(args.claim?.work_id || "").toLowerCase() !== persistedIntent.work_id ||
          String(args.claim?.schema_version || "") !== "github_worker_execution_claim_v1") {
        throw new Error("github_worker_execution_claim_binding_mismatch");
      }
      if (!config.githubStandingReleaseWorkerUrl) throw new Error("github_worker_unavailable");
      const response = await fetchImpl(`${config.githubStandingReleaseWorkerUrl}/v1/reconcile`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claim: args.claim }),
      });
      const payload = await response.json().catch(() => ({ error: "github_worker_invalid_response" }));
      if (!response.ok) {
        const error = new Error(String(payload?.error || "github_worker_reconciliation_failed"));
        error.statusCode = response.status;
        throw error;
      }
      return dedicatedCoreTextResult(payload, "/v1/reconcile");
    },
    host_native_delegation_issue: async (args, identity) => {
      const ownerMode = requireHostNativeOwnerConfirmation(identity, config);
      const ttlSeconds = Number(args.ttl_seconds);
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 43_200) {
        throw new Error("host_native_delegation_ttl_invalid");
      }
      const requestBody = {
        work_id: args.work_id,
        intent_anchor_digest: args.intent_anchor_digest,
        repository: args.repository,
        audience: args.audience,
        allowed_branches: args.allowed_branches,
        protected_branches: args.protected_branches || [],
        allowed_path_prefixes: args.allowed_path_prefixes,
        allowed_actions: args.allowed_actions,
        ...(args.budget ? { budget: args.budget } : {}),
        ...(args.release_policy ? { release_policy: args.release_policy } : {}),
        idempotency_key: args.idempotency_key,
        expires_at: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
        owner_confirmed: true,
        confirmation_reference: hostNativeConfirmationReference(
          identity,
          ownerMode,
          "host_native_delegation_issue",
          args.idempotency_key,
        ),
      };
      const payload = await coreRequest("/v1/host-native/delegations", identity.tenantId, {
        method: "POST",
        body: {
          ...requestBody,
          owner_context: ownerContext(identity, {
            hostNativeOwner: true,
            requestBinding: ownerRequestBinding("host_native_delegation_issue", requestBody),
          }),
        },
      });
      return dedicatedCoreTextResult(payload, "/v1/host-native/delegations");
    },
    host_native_delegation_read: async (args, identity) => textResult(
      await coreRequest(
        `/v1/host-native/delegations/${encodeURIComponent(args.delegation_id)}`,
        identity.tenantId,
      ),
    ),
    host_native_delegation_revoke: async (args, identity) => {
      const ownerMode = requireHostNativeOwnerConfirmation(identity, config);
      const requestBody = {
        idempotency_key: args.idempotency_key,
        owner_confirmed: true,
        confirmation_reference: hostNativeConfirmationReference(
          identity,
          ownerMode,
          "host_native_delegation_revoke",
          args.idempotency_key,
        ),
      };
      const route = `/v1/host-native/delegations/${encodeURIComponent(args.delegation_id)}/revoke`;
      const payload = await coreRequest(route, identity.tenantId, {
        method: "POST",
        body: {
          ...requestBody,
          owner_context: ownerContext(identity, {
            hostNativeOwner: true,
            requestBinding: ownerRequestBinding("host_native_delegation_revoke", requestBody),
          }),
        },
      });
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_action_authorize: async (args, identity) => {
      const route = "/v1/host-native/actions/authorize";
      const payload = await coreRequest(route, identity.tenantId, {
        method: "POST",
        useTenantGateway: true,
        body: {
          delegation_id: args.delegation_id,
          work_id: args.work_id,
          intent_anchor_digest: args.intent_anchor_digest,
          repository: args.repository,
          host_kind: hostNativeKind(identity),
          host_session_fingerprint: hostNativeSessionFingerprint(identity),
          action: args.action,
          evidence_digest: args.evidence_digest,
          idempotency_key: args.idempotency_key,
          ...(args.predecessor_ticket_id
            ? { predecessor_ticket_id: args.predecessor_ticket_id }
            : {}),
          ...(args.release_manifest ? { release_manifest: args.release_manifest } : {}),
        },
      });
      return dedicatedCoreTextResult(payload, route);
    },
    host_native_action_read: async (args, identity) => textResult(
      await coreRequest(
        `/v1/host-native/actions/${encodeURIComponent(args.ticket_id)}`,
        identity.tenantId,
        { useTenantGateway: true },
      ),
    ),
    host_native_action_reserve: async (args, identity) => {
      const route = `/v1/host-native/actions/${encodeURIComponent(args.ticket_id)}/reserve`;
      return dedicatedCoreTextResult(await coreRequest(route, identity.tenantId, {
        method: "POST",
        useTenantGateway: true,
        body: {
          host_session_fingerprint: hostNativeSessionFingerprint(identity),
          idempotency_key: args.idempotency_key,
        },
      }), route);
    },
    host_native_action_complete: async (args, identity) => {
      const route = `/v1/host-native/actions/${encodeURIComponent(args.ticket_id)}/complete`;
      const ticketRecord = await trustedHostNativeTicketRecord(
        args.ticket_id,
        identity,
        ["reserved"],
      );
      try {
        return dedicatedCoreTextResult(await coreRequest(route, identity.tenantId, {
          method: "POST",
          useTenantGateway: true,
          body: {
            reservation_id: args.reservation_id,
            host_session_fingerprint: hostNativeSessionFingerprint(identity),
            outcome: args.outcome,
            result_digest: args.result_digest,
            idempotency_key: args.idempotency_key,
            ...(args.result_commit ? { result_commit: args.result_commit } : {}),
            ...(args.result_pull_request === undefined
              ? {}
              : { result_pull_request: args.result_pull_request }),
            ...(args.readback_digest ? { readback_digest: args.readback_digest } : {}),
          },
        }), route);
      } catch (error) {
        throw attachTrustedHostNativeTicket(error, ticketRecord);
      }
    },
    host_native_action_reconcile: async (args, identity) => {
      const route = `/v1/host-native/actions/${encodeURIComponent(args.ticket_id)}/reconcile`;
      const ticketRecord = await trustedHostNativeTicketRecord(
        args.ticket_id,
        identity,
        ["reserved", "reconciliation_required"],
      );
      try {
        return dedicatedCoreTextResult(await coreRequest(route, identity.tenantId, {
          method: "POST",
          useTenantGateway: true,
          body: {
            reservation_id: args.reservation_id,
            host_session_fingerprint: hostNativeSessionFingerprint(identity),
            idempotency_key: args.idempotency_key,
            observed_outcome: args.observed_outcome,
            readback_digest: args.readback_digest,
            ...(args.observed_commit ? { observed_commit: args.observed_commit } : {}),
            ...(args.observed_pull_request === undefined
              ? {}
              : { observed_pull_request: args.observed_pull_request }),
          },
        }), route);
      } catch (error) {
        throw attachTrustedHostNativeTicket(error, ticketRecord);
      }
    },
    host_native_action_observe_unreserved: async (args, identity) => {
      const route = `/v1/host-native/actions/${encodeURIComponent(args.ticket_id)}/observe-unreserved`;
      const ticketRecord = await trustedHostNativeTicketRecord(args.ticket_id, identity, ["issued"]);
      try {
        return dedicatedCoreTextResult(await coreRequest(route, identity.tenantId, {
          method: "POST",
          useTenantGateway: true,
          body: {
            host_session_fingerprint: hostNativeSessionFingerprint(identity),
            observed_outcome: args.observed_outcome,
            observed_commit: args.observed_commit,
            readback_digest: args.readback_digest,
            verifier_evidence_digest: args.verifier_evidence_digest,
            deviation_reason: args.deviation_reason,
            idempotency_key: args.idempotency_key,
          },
        }), route);
      } catch (error) {
        throw attachTrustedHostNativeTicket(error, ticketRecord);
      }
    },
    host_native_action_closure_receipt: async (args, identity) => {
      const route =
        `/v1/host-native/actions/${encodeURIComponent(args.ticket_id)}/authorize-finalize`;
      return textResult(await coreRequest(route, identity.tenantId, {
        method: "POST",
        useTenantGateway: true,
        body: {
          host_session_fingerprint: hostNativeSessionFingerprint(identity),
        },
      }));
    },
    work_preflight: async (args, identity) => {
      const coreRuntime = await runtimeHierarchyEvaluate(args, identity, args.operation_type || "work_preflight");
      const agentPresence = identity.agentPresence || createAgentPresence(config, identity, args);
      const bootstrap = sharedMemoryBootstrap
        ? await sharedMemoryBootstrap.load(identity)
        : { loaded: false, tenant_id: identity.tenantId, missing_files: [], reason: "shared_memory_bootstrap_unavailable" };
      const gallery = await galleryContext(args, identity);
      const sharedContext = await memoryContext({
        query: args.request,
        project_id: args.project_id,
        session_id: args.session_id,
        agent_id: args.agent_id || "connected_ai",
      }, identity);
      const preflightBody = {
        request: args.request,
        target_system: args.target_system || "universal_core",
        operation_type: args.operation_type || "advisory_work",
        source_tool: args.tool_name,
        ...(args.work_id ? { work_id: args.work_id } : {}),
        ...(args.parent_work_id ? { parent_work_id: args.parent_work_id } : {}),
        ...(args.project_id ? { project_id: args.project_id } : {}),
        ...(Array.isArray(args.acceptance_criteria) ? { acceptance_criteria: args.acceptance_criteria } : {}),
        ...(Array.isArray(args.constraints) ? { constraints: args.constraints } : {}),
        host_native: {
          requested: args.host_type === "chatgpt_native" || args.host_type === "codex_native",
          host_type: args.host_type || (agentPresence.client_type === "codex" ? "codex_native" : "chatgpt_native"),
          provider_execution: false,
          provider_api_key_required: false,
          server_model_calls: 0,
          host_spawn_required: true,
          host_policy_override: false,
          host_policy_must_allow: true,
        },
        ...(args.evidence_state && typeof args.evidence_state === "object" ? { evidence_state: args.evidence_state } : {}),
        ...(Array.isArray(args.research_allowed_domains) ? { research_allowed_domains: args.research_allowed_domains } : {}),
        ...(Array.isArray(args.nyra_branches) ? { nyra_branches: args.nyra_branches } : {}),
        ...(Array.isArray(args.available_capabilities) ? { available_capabilities: args.available_capabilities } : {}),
        owner_confirmed: hasExplicitVerifiedOwnerConfirmation(identity),
        ...(verifiedConfirmationReference(identity) ? { confirmation_reference: verifiedConfirmationReference(identity) } : {}),
        ...(sharedContext ? { memory_context: sharedContext } : {}),
        gallery_context: gallery,
        agent_presence: agentPresence,
        tenant_id: identity.tenantId,
      };
      const payload = await coreRequest("/v1/work/preflight", identity.tenantId, {
        method: "POST",
        // Production uses the dedicated gateway and signed tenant context.
        // Test-only configurations without that credential stay tenant-bound
        // through their individual Core key and cannot cross tenant scope.
        useTenantGateway: Boolean(config.tenantGatewayKey),
        body: {
          ...preflightBody,
          owner_context: ownerContext(identity, ownerRequestBinding("work_preflight", preflightBody)),
        },
      });
      const complete = {
        ...attachSharedMemoryBootstrap(applyVerifiedOwnerConfirmation(payload, identity), bootstrap),
        operational_surface: "tenant_work_gallery",
        gallery_version: gallery.schema_version,
        tenant_work_gallery: gallery,
        agent_presence: agentPresence,
        core_runtime: coreRuntime,
      };
      if (args.response_mode === "full") return textResult(complete);
      const compact = {
        ok: complete.ok !== false,
        tenant_id: identity.tenantId,
        received_memory: compactMemoryContext(complete.received_memory),
        work_preflight: compactWorkPreflight(complete.work_preflight || complete),
        governance: complete.governance,
        core_runtime: coreRuntime,
        shared_memory_bootstrap: compactBootstrap(complete.shared_memory_bootstrap || complete.work_preflight?.shared_memory_bootstrap),
        operational_surface: "tenant_work_gallery",
        gallery_version: gallery.schema_version,
        tenant_work_gallery: gallery,
        agent_presence: agentPresence,
        details_available: true,
        full_mode: "work_preflight.response_mode=full",
      };
      return compactTextResult(compact, {
        preflight_id: compact.work_preflight?.preflight_id,
        state: compact.work_preflight?.state,
        tenant_id: compact.tenant_id,
        operational_surface: compact.operational_surface,
        gallery_state: compact.tenant_work_gallery.state,
        gallery_work_count: compact.tenant_work_gallery.work_count,
        shared_memory_bootstrap_loaded: compact.shared_memory_bootstrap?.loaded === true,
      });
    },
    core_runtime_hierarchy_status: async (_args, identity) => textResult({
      ...(await coreRequest("/v1/runtime/hierarchy/status", identity.tenantId)),
      tenant_id: identity.tenantId,
    }),
    core_runtime_hierarchy_evaluate: async (args, identity) => textResult({
      ok: true,
      tenant_id: identity.tenantId,
      core_runtime: await runtimeHierarchyEvaluate(args, identity, args.operation_type || "runtime_hierarchy_evaluate"),
    }),
    nyra_runtime_context: async (args, identity) => {
      const sharedContext = await memoryContext({
        query: args.query || "Nyra Core current work decisions and pending handoffs",
        project_id: args.project_id,
        session_id: args.session_id,
        agent_id: args.agent_id || "nyra",
      }, identity);
      return textResult(await coreRequest("/v1/codex/context", identity.tenantId, {
        method: "POST",
        body: {
        task: "ChatGPT requests Nyra runtime context",
        user_input: args.include_control_snapshot ? "Include control snapshot" : "Read readiness context",
        locale: "it",
        ...(sharedContext ? { memory_context: sharedContext } : {}),
        ...(args.work_preflight ? { work_preflight: args.work_preflight } : {}),
        tenant_id: identity.tenantId
        }
      }));
    },
    nyra_branch_catalog: async (_args, identity) => textResult(await coreRequest("/v1/nira/branches", identity.tenantId)),
    core_capability_catalog: async (args, identity) => textResult({
      ...readCoreCapabilityCatalog(args),
      tenant_id: identity.tenantId,
    }),
    core_branch_registry: async (args, identity) => {
      const paths = {
        registry: "/v1/branches",
        taxonomy: "/v1/branches/taxonomy",
        maturity: "/v1/branches/maturity",
        authorized: "/v1/branches/authorized",
      };
      const view = args.view || "registry";
      const requestedBranches = view === "authorized" && Array.isArray(args.branches) ? args.branches : [];
      const query = requestedBranches.length
        ? `?${new URLSearchParams({ branches: requestedBranches.join(",") }).toString()}`
        : "";
      const bindingPayload = { view, branches: requestedBranches };
      const owner = ownerReadContext(identity, ownerRequestBinding("branch_registry", bindingPayload));
      const additionalHeaders = owner.owner_verified === true
        ? { "x-sh-owner-context": Buffer.from(JSON.stringify(owner)).toString("base64url") }
        : {};
      return textResult(await coreRequest(`${paths[view]}${query}`, identity.tenantId, {
        additionalHeaders,
      }));
    },
    core_branch_analyze: async (args, identity) => {
      const body = {
        request: args.request,
        ...(args.signals ? { signals: args.signals } : {}),
        ...(args.context ? { context: args.context } : {}),
        ...(args.work_preflight ? { work_preflight: args.work_preflight } : {}),
      };
      const owner = ownerReadContext(identity, ownerRequestBinding("branch_analyze", { ...body, branch: args.branch }));
      const additionalHeaders = owner.owner_verified === true
        ? { "x-sh-owner-context": Buffer.from(JSON.stringify(owner)).toString("base64url") }
        : {};
      return textResult(await coreRequest(
        `/v1/branches/${encodeURIComponent(args.branch)}/analyze`,
        identity.tenantId,
        {
          method: "POST",
          body,
          additionalHeaders,
        },
      ));
    },
    core_control_plane_read: async (args, identity) => {
      const paths = {
        tenant_status: "/v1/tenant/status",
        entitlements: "/v1/entitlements/current",
        domain_pack: "/v1/domain-packs/current",
        overview: "/v1/control-plane/overview",
        dashboard: "/v1/control-plane/dashboard",
        ecosystem_pulse: "/v1/ecosystem-pulse",
        connector_manifest: "/v1/connectors/sdk/manifest",
        customer_intelligence_contract: "/v1/customer-intelligence/contract",
      };
      const bindingPayload = { view: args.view };
      const owner = ownerReadContext(identity, ownerRequestBinding("control_plane_read", bindingPayload));
      const additionalHeaders = owner.owner_verified === true
        ? { "x-sh-owner-context": Buffer.from(JSON.stringify(owner)).toString("base64url") }
        : {};
      return textResult(await coreRequest(paths[args.view], identity.tenantId, {
        additionalHeaders,
      }));
    },
    core_evidence_recent: async (args, identity) => {
      const query = new URLSearchParams({ limit: String(args.limit || 50) });
      return textResult(await coreRequest(`/v1/evidence/recent?${query.toString()}`, identity.tenantId));
    },
    core_semantic_select: async (args, identity) => textResult(await coreRequest("/v1/semantic-selection", identity.tenantId, {
      method: "POST",
      body: {
        candidates: args.candidates,
        target_language: args.target_language,
        adapter: args.adapter,
        intent: args.intent,
        limit: args.limit,
      },
    })),
    core_software_language_evaluate: async (args, identity) => textResult(await coreRequest("/v1/software-language-gate/evaluate", identity.tenantId, {
      method: "POST",
      body: { app: args.app, target_lang: args.target_lang, entries: args.entries },
    })),
    core_content_guard_check: async (args, identity) => textResult(await coreRequest("/v1/content-guard/check", identity.tenantId, {
      method: "POST",
      body: { text: args.text, locale: args.locale, context: args.context },
    })),
    core_claim_guard_check: async (args, identity) => textResult(await coreRequest("/v1/claim-guard/check", identity.tenantId, {
      method: "POST",
      body: { text: args.text, forbidden_terms: args.forbidden_terms },
    })),
    core_pricing_guard_check: async (args, identity) => textResult(await coreRequest("/v1/pricing-guard/check", identity.tenantId, {
      method: "POST",
      body: { official_prices: args.official_prices, observed_prices: args.observed_prices },
    })),
    core_policy_check: async (args, identity) => textResult(await coreRequest("/v1/policy/check", identity.tenantId, {
      method: "POST",
      body: { action: args.action, policy: args.policy, context: args.context },
    })),
    core_action_mediation_evaluate: async (args, identity) => {
      const upstream = await coreRequest("/v1/action-mediation/evaluate", identity.tenantId, {
        method: "POST",
        body: {
          action: args.action,
          policy: args.policy,
          context: args.context,
          work_preflight: args.work_preflight,
        },
        allowFailurePayload: true,
      });
      if (!upstream.ok) {
        const payload = upstream.payload && typeof upstream.payload === "object" ? upstream.payload : {};
        const reasonCodes = Array.isArray(payload.reason_codes)
          ? payload.reason_codes.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 20)
          : [];
        const blockCode = reasonCodes[0] || String(payload.error || "WORK_PREFLIGHT_INVALID");
        const classification = classifyCoreBlock({ block_code: blockCode });
        const contract = {
          state: "BLOCK",
          block_code: blockCode,
          block_class: classification.blockClass,
          blocked_reasons: reasonCodes.length ? reasonCodes : [blockCode],
        };
        const output = {
          block_code: blockCode,
          block_class: classification.blockClass,
          recommended_actions: [{ blocked: true, reason_code: blockCode }],
          selected_by_core: {
            risk_band: "medium",
            unmet_conditions: reasonCodes,
            evidence_requirements: [],
            allowed_alternatives: [],
          },
        };
        const remediationResult = await openBlockedRemediation({
          identity,
          requestBody: {
            ...(args.context && typeof args.context === "object" ? args.context : {}),
            ...(args.action && typeof args.action === "object" ? args.action : {}),
            request_id: `core_action_mediation_${crypto.randomUUID()}`,
          },
          authorization: { state: "BLOCK", confirmation_required: false },
          contract,
          output,
        });
        return textResult({
          ok: false,
          status: upstream.status,
          error: String(payload.error || "WORK_PREFLIGHT_INVALID"),
          reason_codes: reasonCodes,
          execution_allowed: false,
          ...(remediationResult?.statusPayload || {}),
        });
      }
      const coreResponse = upstream.payload;
      const response = applyQualityFailureMediation(args, coreResponse);
      const ledger = await recordQualityFailureObservation(identity, response);
      return textResult({ ...response, quality_ledger: ledger });
    },
    core_release_manifest_check: async (args, identity) => textResult(await coreRequest("/v1/releases/manifest/check", identity.tenantId, {
      method: "POST",
      body: { manifest: args.manifest },
    })),
    core_translator_extractor_status: async (_args, identity) => textResult(
      await coreRequest("/v1/translator/extractor/status", identity.tenantId),
    ),
    core_software_intelligence_components: async (_args, identity) => textResult(
      await coreRequest("/v1/software-intelligence/components", identity.tenantId),
    ),
    core_software_intelligence_analyze: async (args, identity) => textResult(await coreRequest("/v1/software-intelligence/analyze", identity.tenantId, {
      method: "POST",
      body: { artifact: args.artifact, authorization: args.authorization, options: args.options },
    })),
    core_software_intelligence_jobs: async (args, identity) => {
      const suffix = args.job_id ? `/${encodeURIComponent(args.job_id)}` : "";
      return textResult(await coreRequest(`/v1/software-intelligence/jobs${suffix}`, identity.tenantId));
    },
    core_entity_graph_read: async (_args, identity) => textResult(await coreRequest("/v1/entity-graph", identity.tenantId)),
    core_entity_graph_upsert: async (args, identity) => {
      if (!hasExplicitVerifiedOwnerConfirmation(identity)) throw new Error("owner_confirmation_required");
      return textResult(await coreRequest("/v1/entity-graph/upsert", identity.tenantId, {
        method: "POST",
        body: {
          entities: args.entities || [],
          relations: args.relations || [],
          owner_context: ownerContext(identity),
          confirmation_reference: verifiedConfirmationReference(identity),
        },
      }));
    },
    core_review_pending: async (_args, identity) => textResult(await coreRequest("/v1/review/pending", identity.tenantId)),
    core_review_action: async (args, identity) => {
      if (!hasExplicitVerifiedOwnerConfirmation(identity)) throw new Error("owner_confirmation_required");
      return textResult(await coreRequest("/v1/review/action", identity.tenantId, {
        method: "POST",
        body: {
          review_id: args.review_id,
          action: args.action,
          note: args.note,
          owner_context: ownerContext(identity),
          confirmation_reference: verifiedConfirmationReference(identity),
        },
      }));
    },
    orchestration_capability_catalog: async (args, identity) => {
      const query = new URLSearchParams({
        branch: args.branch,
        view: args.view || "capabilities",
        cursor: args.cursor || "0",
        limit: String(args.limit || (args.view === "virtual" ? 20 : 25)),
      });
      return textResult(await coreRequest(`/v1/orchestration/capabilities?${query.toString()}`, identity.tenantId));
    },
    lexical_semantic_catalog: async (args, identity) => {
      const query = new URLSearchParams({
        view: args.view || "capabilities",
        cursor: args.cursor || "0",
        limit: String(args.limit || (args.view === "virtual" ? 20 : 25)),
      });
      return textResult(await coreRequest(`/v1/lexical-semantics/catalog?${query.toString()}`, identity.tenantId));
    },
    lexical_semantic_analyze: async (args, identity) => textResult(await coreRequest(
      "/v1/lexical-semantics/analyze",
      identity.tenantId,
      {
        method: "POST",
        body: {
          text: args.text,
          locale: args.locale,
          source_context: args.source_context,
        },
      },
    )),
    orchestration_relational_evaluate: async (args, identity) => textResult(await coreRequest(
      "/v1/orchestration/relational/evaluate",
      identity.tenantId,
      {
        method: "POST",
        body: {
          objective: args.objective,
          actors: args.actors,
          relations: args.relations,
          unresolved_conflicts: args.unresolved_conflicts,
        },
      },
    )),
    orchestration_dtt_plan: async (args, identity) => textResult(await dttCoreRequest(
      "/v1/orchestration/dtt/plan",
      args,
      identity,
      {
        method: "POST",
        body: {
          objective: args.objective,
          nodes: args.nodes,
          limits: args.limits,
        },
      },
    )),
    orchestration_dtt_read: async (args, identity) => textResult(await dttCoreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}`,
      args,
      identity,
    )),
    orchestration_dtt_expansion_propose: async (args, identity) => textResult(await dttCoreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/expansion-proposals`,
      args,
      identity,
      {
        method: "POST",
        body: {
          parent_node_id: args.parent_node_id,
          nodes: args.nodes,
        },
      },
    )),
    orchestration_dtt_replan_propose: async (args, identity) => textResult(await dttCoreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/replan-proposals`,
      args,
      identity,
      {
        method: "POST",
        body: {
          prune_node_ids: args.prune_node_ids,
          replacement_nodes: args.replacement_nodes,
          reason: args.reason,
        },
      },
    )),
    orchestration_dtt_outcome_record: async (args, identity) => textResult(await dttCoreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/nodes/${encodeURIComponent(args.node_id)}/outcomes`,
      args,
      identity,
      {
        method: "POST",
        body: {
          idempotency_key: args.idempotency_key,
          outcome: args.outcome,
          evidence: args.evidence,
          evidence_draft: args.evidence_draft,
          votes: args.votes,
        },
      },
    )),
    orchestration_dtt_evidence_prepare: async (args, identity) => textResult(await dttCoreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/nodes/${encodeURIComponent(args.node_id)}/evidence-drafts`,
      args,
      identity,
      {
        method: "POST",
        body: {
          claim: args.claim,
          artifacts: args.artifacts,
          provenance: args.provenance,
          required_approvals: args.required_approvals,
        },
      },
    )),
    orchestration_dtt_agent_attest: async (args, identity) => {
      if (!config.dttAgentIdentitySigningSecret) throw new Error("dtt_agent_identity_not_ready");
      if (!identity.agentPresence) throw new Error("agent_presence_session_required");
      const context = issueDttAgentContext({
        secret: config.dttAgentIdentitySigningSecret,
        tenant_id: identity.tenantId,
        work_id: args.work_id,
        agent_presence: identity.agentPresence,
      });
      return textResult(await dttCoreRequest(
        `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/nodes/${encodeURIComponent(args.node_id)}/attestations`,
        args,
        identity,
        {
          method: "POST",
          body: {
            evidence_digest: args.evidence_digest,
            decision: args.decision,
            rationale: args.rationale,
            assignment_id: args.assignment_id,
          },
          additionalHeaders: { "x-sh-dtt-agent-context": context },
        },
      ));
    },
    orchestration_dtt_verifier_assign_self: async (args, identity) => {
      if (!config.dttAgentIdentitySigningSecret) throw new Error("dtt_agent_identity_not_ready");
      if (!identity.agentPresence) throw new Error("agent_presence_session_required");
      const context = issueDttAgentContext({
        secret: config.dttAgentIdentitySigningSecret,
        tenant_id: identity.tenantId,
        work_id: args.work_id,
        agent_presence: identity.agentPresence,
      });
      return textResult(await dttCoreRequest(
        `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/nodes/${encodeURIComponent(args.node_id)}/verifier-assignments`,
        args,
        identity,
        { method: "POST", body: {}, additionalHeaders: { "x-sh-dtt-agent-context": context } },
      ));
    },
    orchestration_dtt_artifact_register: async (args, identity) => textResult(await dttCoreRequest(
      "/v1/orchestration/evidence/artifacts",
      args,
      identity,
      {
        method: "POST",
        body: {
          artifact_id: args.artifact_id,
          content: args.content,
          source_reference: args.source_reference,
          registry_reference: args.registry_reference,
        },
      },
    )),
    orchestration_dtt_cancel: async (args, identity) => textResult(await dttCoreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/cancel`,
      args,
      identity,
      {
        method: "POST",
        body: { reason: args.reason },
      },
    )),
    orchestration_dtt_retry_fallback_read: async (args, identity) => textResult(await dttCoreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/retry-fallback`,
      args,
      identity,
    )),
    orchestration_dtt_core_join: async (args, identity) => textResult(await dttCoreRequest(
      `/v1/orchestration/dtt/${encodeURIComponent(args.tree_id)}/core-join`,
      args,
      identity,
      {
        method: "POST",
        body: {},
      },
    )),
    research_plan: async (args, identity) => textResult(await coreRequest("/v1/research/plan", identity.tenantId, {
      method: "POST",
      body: {
        question: args.question || args.query,
        decision_context: args.decision_context,
        allowed_domains: args.allowed_domains,
        ...(args.domain_pack ? { domain_pack: args.domain_pack } : {}),
        tenant_id: identity.tenantId,
      },
    })),
    research_validate: async (args, identity) => textResult(await coreRequest("/v1/research/validate", identity.tenantId, {
      method: "POST",
      body: {
        evidence_pack: args.evidence_pack || args,
        ...(args.domain_pack ? { domain_pack: args.domain_pack } : {}),
        tenant_id: identity.tenantId,
      },
    })),
    nyra_research_distillation_status: async (_args, identity) => textResult(
      await coreRequest("/v1/research/status", identity.tenantId),
    ),
    nyra_research_airlock_status: async (_args, identity) => textResult(
      await coreRequest("/v1/research/airlock/status", identity.tenantId),
    ),
    nyra_research_airlock_bootstrap: async (args, identity) => {
      const binding = airlockBinding(args.work_binding, identity);
      const issued = await coreRequest("/v1/research/airlock/plan", identity.tenantId, {
        method: "POST",
        body: { work_binding: binding, source_urls: args.source_urls, tenant_id: identity.tenantId },
      });
      const opened = await coreRequest("/v1/research/airlock/work", identity.tenantId, {
        method: "POST",
        body: {
          work_binding: binding,
          plan_capability: issued.plan_capability,
          ttl_seconds: args.ttl_seconds,
          tenant_id: identity.tenantId,
        },
      });
      return textResult({
        ok: true,
        tenant_id: identity.tenantId,
        bootstrap: {
          state: opened.state,
          work: opened,
          plan: issued.plan,
          capability: { issued: true, single_use: true, server_bound: true, exposed_to_model: false },
        },
      });
    },
    nyra_research_airlock_plan: async (args, identity) => textResult(
      await coreRequest("/v1/research/airlock/plan", identity.tenantId, {
        method: "POST",
        body: {
          work_binding: airlockBinding(args.work_binding, identity),
          source_urls: args.source_urls,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_airlock_open: async (args, identity) => textResult(
      await coreRequest("/v1/research/airlock/work", identity.tenantId, {
        method: "POST",
        body: {
          work_binding: airlockBinding(args.work_binding, identity),
          plan_capability: args.plan_capability,
          ttl_seconds: args.ttl_seconds,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_airlock_discover: async (args, identity) => textResult(
      await coreRequest("/v1/research/airlock/discover", identity.tenantId, {
        method: "POST",
        body: {
          work_binding: airlockBinding(args.work_binding, identity),
          url: args.url,
          method: args.method,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_airlock_seal: async (args, identity) => textResult(
      await coreRequest("/v1/research/airlock/seal", identity.tenantId, {
        method: "POST",
        body: { work_binding: airlockBinding(args.work_binding, identity), tenant_id: identity.tenantId },
      }),
    ),
    nyra_research_airlock_private_enter: async (args, identity) => textResult(
      await coreRequest("/v1/research/airlock/private-entry", identity.tenantId, {
        method: "POST",
        body: {
          work_binding: airlockBinding(args.work_binding, identity),
          private_entry_capability: args.private_entry_capability,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_airlock_tool_authorize: async (args, identity) => textResult(
      await coreRequest("/v1/research/airlock/tool-authorize", identity.tenantId, {
        method: "POST",
        body: { work_binding: airlockBinding(args.work_binding, identity), tool_name: args.tool_name, tenant_id: identity.tenantId },
      }),
    ),
    nyra_research_airlock_session_tool_authorize: async (args, identity) => textResult(
      await coreRequest("/v1/research/airlock/session-tool-authorize", identity.tenantId, {
        method: "POST",
        body: {
          session_id: String(identity.agentPresence?.session_id || args.session_id || ""),
          tool_name: args.tool_name,
          transport_tool_name: args.transport_tool_name,
          open_world: args.open_world === true,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_airlock_complete: async (args, identity) => textResult(
      await coreRequest("/v1/research/airlock/complete", identity.tenantId, {
        method: "POST",
        body: { work_binding: airlockBinding(args.work_binding, identity), tenant_id: identity.tenantId },
      }),
    ),
    nyra_research_source_registry: async (_args, identity) => textResult(
      await coreRequest("/v1/research/source-registry", identity.tenantId),
    ),
    nyra_research_learning_pack: async (args, identity) => {
      const query = new URLSearchParams();
      if (args.branch_id) query.set("branch_id", String(args.branch_id));
      const suffix = query.size ? `?${query.toString()}` : "";
      return textResult(await coreRequest(`/v1/research/learning-packs${suffix}`, identity.tenantId));
    },
    nyra_research_envelope_authorize: async (args, identity) => textResult(
      await coreRequest("/v1/research/envelope/authorize", identity.tenantId, {
        method: "POST",
        body: {
          request_id: args.request_id,
          question: args.question,
          branch_ids: args.branch_ids,
          allowed_source_ids: args.allowed_source_ids,
          max_documents: args.max_documents,
          max_bytes: args.max_bytes,
          max_duration_ms: args.max_duration_ms,
          max_cost: args.max_cost,
          retention_mode: args.retention_mode,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_workspace_open: async (args, identity) => textResult(
      await coreRequest("/v1/research/workspaces/open", identity.tenantId, {
        method: "POST",
        body: {
          envelope_id: args.envelope_id,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_workspace_attach: async (args, identity) => textResult(
      await coreRequest("/v1/research/workspaces/attach", identity.tenantId, {
        method: "POST",
        body: {
          workspace_id: args.workspace_id,
          evidence: args.evidence,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_distill: async (args, identity) => textResult(
      await coreRequest("/v1/research/distill", identity.tenantId, {
        method: "POST",
        body: {
          workspace_id: args.workspace_id,
          evidence: args.evidence,
          lesson: args.lesson,
          learning: args.learning,
          scope: args.scope,
          confidence: args.confidence,
          limitations: args.limitations,
          outcome_refs: args.outcome_refs,
          // The MCP bridge is deliberately candidate-only. Even if a direct
          // caller bypasses its JSON schema, Core never receives a persistence
          // request from this path.
          persist_verified: false,
          audit_reference: args.audit_reference,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_workspace_close: async (args, identity) => textResult(
      await coreRequest("/v1/research/workspaces/close", identity.tenantId, {
        method: "POST",
        body: {
          workspace_id: args.workspace_id,
          tenant_id: identity.tenantId,
        },
      }),
    ),
    nyra_research_cleanup: async (_args, identity) => textResult(
      await coreRequest("/v1/research/cleanup", identity.tenantId, {
        method: "POST",
        body: { tenant_id: identity.tenantId },
      }),
    ),
    nyra_v2_preview: async (args, identity) => textResult(
      await nyraDeepV2Request(args, identity, "preview"),
    ),
    nyra_v2_requirements: async (args, identity) => textResult(
      await nyraDeepV2Request(args, identity, "requirements"),
    ),
    nyra_v2_evidence_prepare: async (args, identity) => textResult(
      await nyraDeepV2Request(args, identity, "prepare_evidence"),
    ),
    nyra_v2_evaluate: async (args, identity) => textResult(
      await nyraDeepV2Request(args, identity, "evaluate"),
    ),
    nyra_interpret_request: async (args, identity) => {
      // The Core bridge evaluates the runtime hierarchy internally. Keeping
      // that decision server-side avoids duplicate routing and ensures that
      // callers and Nyra cannot nominate V0/V1/V2 or become the authority.
      const sharedContext = await memoryContext({
        query: args.message,
        project_id: args.project_id,
        session_id: args.session_id,
        agent_id: args.agent_id || "nyra",
      }, identity);
      const payload = await coreRequest("/v1/nira/core-bridge", identity.tenantId, {
        method: "POST",
        body: {
        text: args.message,
        request_id: args.session_id,
        locale: "it",
        mode: "standard",
        owner_context: ownerContext(identity),
        ...(Array.isArray(args.nyra_branches) ? { nyra_branches: args.nyra_branches } : {}),
        ...(Array.isArray(args.available_capabilities) ? { available_capabilities: args.available_capabilities } : {}),
        ...(sharedContext ? { memory_context: sharedContext } : {}),
        tenant_id: identity.tenantId
        }
      });
      const coreRuntime = coreRuntimeFromBridge(payload);
      const governedPayload = { ...payload, core_runtime: coreRuntime };
      const analysisId = cacheAnalysis(identity.tenantId, governedPayload);
      if (args.response_mode === "full") {
        return compactTextResult({ ...governedPayload, analysis_id: analysisId, response_mode: "full" }, {
          ok: governedPayload.ok === true,
          analysis_id: analysisId,
          response_mode: "full",
          core_route: coreRuntime.route,
          core_authority: coreRuntime.selected_authority,
          execution_allowed: false,
        });
      }
      const detail = args.response_mode === "deep" ? "deep" : "fast";
      const compact = compactNyraPayload(governedPayload, { analysisId, detail });
      return compactTextResult(compact, {
        ok: compact.ok,
        analysis_id: analysisId,
        response_mode: detail,
        core_route: coreRuntime.route,
        core_authority: coreRuntime.selected_authority,
        selected_action: compact.result?.selected_by_core?.primary_action_label,
        risk_band: compact.result?.selected_by_core?.risk_band,
        preferred_reply: compact.result?.deep_nyra_runtime?.dialogue?.preferred_reply,
        execution_allowed: false,
      });
    },
    nyra_fetch_analysis: async (args, identity) => {
      const payload = fetchAnalysis(identity.tenantId, args.analysis_id);
      if (args.response_mode === "full") {
        return compactTextResult({ ...payload, analysis_id: args.analysis_id, response_mode: "full" }, {
          ok: payload.ok === true,
          analysis_id: args.analysis_id,
          response_mode: "full",
          execution_allowed: false,
        });
      }
      const compact = compactNyraPayload(payload, { analysisId: args.analysis_id, detail: "deep" });
      return compactTextResult(compact, {
        ok: compact.ok,
        analysis_id: args.analysis_id,
        response_mode: "deep",
        execution_allowed: false,
      });
    },
    intelligence_workflow: async (args, identity) => intelligenceRequest("/v1/intelligence/workflow", args, identity, { nyraInterpretation: true }),
    scenario_analysis: async (args, identity) => intelligenceRequest("/v1/intelligence/scenarios", args, identity),
    hypothesis_rank: async (args, identity) => intelligenceRequest("/v1/intelligence/hypotheses/rank", args, identity),
    event_probability: async (args, identity) => intelligenceRequest("/v1/intelligence/events/evaluate", args, identity),
    counterfactual_analysis: async (args, identity) => intelligenceRequest("/v1/intelligence/counterfactuals/evaluate", args, identity),
    decision_select: async (args, identity) => intelligenceRequest("/v1/intelligence/decisions/select", args, identity),
    outcome_verify: async (args, identity) => intelligenceRequest("/v1/intelligence/outcomes/verify", args, identity),
    outcome_record: async (args, identity) => intelligenceRequest("/v1/intelligence/outcomes/record", args, identity, { ownerBindingPurpose: "intelligence_outcome_record" }),
    calibration_status: async (args, identity) => textResult(await coreRequest(`/v1/intelligence/calibration?limit=${Number(args.limit || 20)}`, identity.tenantId)),
    skin_analyzer: async (args, identity) => textResult(await coreRequest("/v1/branches/skinharmony_analyzer/analyze", identity.tenantId, { method: "POST", body: { data: { scores: args.scores, products: args.products || [], protocols: args.protocols || [], report_text: args.report_text, data_quality_score: args.data_quality_score, acquisition: args.acquisition, previous_scores: args.previous_scores, previous_acquisition: args.previous_acquisition, learning_context: args.learning_context }, tenant_id: identity.tenantId } })),
    generic_agent_orchestration_create: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/runs/${encodeURIComponent(args.run_id)}/orchestration`, identity.tenantId, {
      method: "POST",
      body: { workers: args.workers, tenant_id: identity.tenantId },
    })),
    generic_agent_orchestration_claim: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/orchestration/${encodeURIComponent(args.plan_id)}/claim`, identity.tenantId, {
      method: "POST",
      body: { tenant_id: identity.tenantId },
    })),
    generic_agent_orchestration_complete: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/orchestration/${encodeURIComponent(args.plan_id)}/workers/${encodeURIComponent(args.worker_id)}/complete`, identity.tenantId, {
      method: "POST",
      body: { result: args.result, tenant_id: identity.tenantId },
    })),
    generic_agent_orchestration_cancel: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/orchestration/${encodeURIComponent(args.plan_id)}/cancel`, identity.tenantId, {
      method: "POST",
      body: { tenant_id: identity.tenantId },
    })),
    generic_agent_orchestration_join: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/orchestration/${encodeURIComponent(args.plan_id)}/join`, identity.tenantId, {
      method: "POST",
      body: { tenant_id: identity.tenantId },
    })),
    generic_agent_start: async (args, identity) => textResult(await coreRequest("/v1/generic-agents/runs", identity.tenantId, {
      method: "POST",
      body: { ...args, tenant_id: identity.tenantId },
    })),
    generic_agent_checkpoint: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/runs/${encodeURIComponent(args.run_id)}/checkpoint`, identity.tenantId, {
      method: "POST",
      body: { checkpoint: args.checkpoint, ...(args.expected_revision === undefined ? {} : { expected_revision: args.expected_revision }), tenant_id: identity.tenantId },
    })),
    generic_agent_run_read: async (args, identity) => textResult(await coreRequest(`/v1/generic-agents/runs/${encodeURIComponent(args.run_id)}`, identity.tenantId)),
    generic_agent_evaluate: async (args, identity) => textResult(await coreRequest("/v1/generic-agents/evaluate", identity.tenantId, {
      method: "POST",
      body: { cases: args.cases, tenant_id: identity.tenantId },
    })),
    core_gate_action: async (args, identity) => {
      // This internal-only scope is set by the MCP server's continuity
      // wrapper. It is stripped before transport and lets a fresh, bound
      // OAuth tenant owner bootstrap only a persistent Work Identity. It
      // cannot be supplied through the public tool schema.
      const tenantWorkBootstrap =
        args.internal_owner_assertion_scope === "tenant_work_bootstrap" &&
        ["work.continuity.create", "work.continuity.start_or_resume"].includes(
          String(args.action_type || ""),
        );
      const confirmationOptions = { allowOAuthTenantOwner: tenantWorkBootstrap };
      const confirmed = hasExplicitVerifiedOwnerConfirmation(identity, confirmationOptions);
      const confirmationReference = verifiedConfirmationReference(identity, confirmationOptions);
      const boundedInternalCoordination =
        args.operation_class === "bounded_internal_coordination_write";
      const sharedContext = await memoryContext({
        query: `${args.action_label || ""} ${args.action_type || ""}`.trim(),
        project_id: args.project_id,
        session_id: args.session_id,
        agent_id: args.agent_id || "connected_ai",
      }, identity);
      const {
        owner_confirmed: _untrustedOwnerConfirmation,
        confirmation_reference: _untrustedConfirmationReference,
        tenant_id: _untrustedTenantId,
        authenticated_tenant_id: _untrustedAuthenticatedTenantId,
        owner_context: _untrustedOwnerContext,
        memory_context: _untrustedMemoryContext,
        internal_owner_assertion_scope: _internalOwnerAssertionScope,
        ...safeArgs
      } = args;
      const requestBody = sanitizeCoreBody({
        ...safeArgs,
        request_id: safeArgs.request_id || `action_${crypto.randomUUID()}`,
        ...(sharedContext ? { memory_context: sharedContext } : {}),
        tenant_id: identity.tenantId,
        owner_confirmed: boundedInternalCoordination ? false : confirmed,
        ...(!boundedInternalCoordination && confirmationReference
          ? { confirmation_reference: confirmationReference }
          : {}),
      });
      const coreResult = await coreRequest("/v1/action-evaluator", identity.tenantId, {
        method: "POST",
        useTenantGateway: true,
        body: {
          ...requestBody,
          ...(!boundedInternalCoordination ? {
            owner_context: ownerContext(
              identity,
              {
                requestBinding: ownerRequestBinding("core_action_evaluator", requestBody),
                actionEvaluatorGateway: true,
                allowOAuthTenantOwner: tenantWorkBootstrap,
              },
            ),
          } : {}),
        },
        allowFailurePayload: true,
      });
      const payload = coreResult.payload || coreResult;
      const authorization = payload.authorization || payload.gate || payload.result?.authorization || {};
      const decisionContract = payload.decision_contract || payload.result?.decision_contract || {};
      const decisionState = String(
        authorization.state ||
        decisionContract.state ||
        payload.verdict?.decision ||
        payload.decision ||
        "",
      ).toLowerCase();
      const mediationState = String(
        authorization.mediation ||
        decisionContract.action_mediation?.state ||
        payload.verdict?.action_mediation?.state ||
        "",
      ).toLowerCase();
      const legacyAllowed = ["allow", "allowed", "allow_controlled", "allow_advisory"].includes(decisionState) || mediationState === "allow";
      const blocked = payload.authorization
        ? authorization.allowed !== true || decisionState === "blocked" || mediationState === "hard_block"
        : !legacyAllowed;
      if (blocked) {
        const remediation = await openBlockedRemediation({
          identity,
          requestBody,
          authorization,
          contract: decisionContract,
          output: payload.output || payload.result?.output || {},
        });
        if (remediation) {
          return textResult({
            ...payload,
            ...remediation.statusPayload,
          });
        }
      }
      return textResult(payload);
    },
    ai_work_quality_observe: async (args, identity) => {
      if (String(args.tenant_id || identity.tenantId) !== String(identity.tenantId)) {
        throw new Error("tenant_scope_violation");
      }
      if (!identity.agentPresence?.transport_bound || !identity.agentPresence?.session_id) {
        throw new Error("ai_work_quality_signed_presence_required");
      }
      const gallery = await galleryContext({ work_id: args.work_id }, identity);
      const boundWork = gallery.works.find((work) => String(work.work_id) === String(args.work_id));
      if (!gallery.available || !boundWork) throw new Error("ai_work_quality_gallery_work_required");
      const leaseBinding = typeof tenantWorkGallery?.verifyActiveLease === "function"
        ? await tenantWorkGallery.verifyActiveLease(identity, args.work_id)
        : null;
      if (!leaseBinding) throw new Error("ai_work_quality_active_lease_required");
      const observation = buildAiWorkQualityObservation({
        ...args,
        tenant_id: identity.tenantId,
        observer_id: identity.subject || identity.agentId || "connected_ai",
        observer_session_id: identity.agentPresence.session_id,
        observer_role: args.observer_role || "connected_ai_worker",
        rollout_tier: workQualityMode,
      });
      const evaluated = await coreRequest("/v1/work-quality/evaluate", identity.tenantId, {
        method: "POST",
        useTenantGateway: true,
        body: {
          observation,
          observer_binding: {
            agent_id: identity.agentPresence.agent_id || identity.subject || identity.agentId,
            session_id: identity.agentPresence.session_id,
            session_fingerprint: identity.agentPresence.session_fingerprint || null,
            transport_bound: true,
            gallery_work_id: observation.work_id,
            lease_id: leaseBinding.lease_id,
            active_lease_verified: true,
          },
        },
      });
      const requestBody = {
        request_id: evaluated.decision_contract.decision_id,
        project_id: args.project_id || null,
        work_id: observation.work_id,
        branch_id: args.branch_id || null,
        session_id: args.session_id || null,
        target_system: args.target_system || "ai_work_quality",
        operation_type: args.operation_type || "quality_failure_remediation",
        operation_class: observation.failure_class,
        repository: args.repository || null,
        ref: args.ref || null,
        environment: args.environment || null,
        resource_ids: args.resource_ids || [],
      };
      const remediation = await openBlockedRemediation({
        identity,
        requestBody,
        authorization: evaluated.authorization,
        contract: evaluated.decision_contract,
        output: {
          block_code: observation.code,
          block_class: observation.disposition,
          recommended_actions: [{ blocked: true, reason_code: observation.code }],
          selected_by_core: {
            risk_band: evaluated.decision_contract.risk_band,
            evidence_requirements: observation.evidence_digests,
            unmet_conditions: ["independent_verification_required"],
            allowed_alternatives: evaluated.decision_contract.allowed_alternatives,
          },
        },
      });
      return textResult({
        ok: true,
        allowed: false,
        execution_authorized: false,
        observation,
        decision_contract: evaluated.decision_contract,
        ...(remediation?.statusPayload || {}),
      });
    },
    core_block_remediation_status: async (args, identity) => {
      const remediation = await loadRemediationForIdentity(identity, args.remediation_id);
      return textResult({
        ok: true,
        remediation: remediationEnvelope(remediation),
      });
    },
    core_block_remediation_explain: async (args, identity) => {
      const remediation = await loadRemediationForIdentity(identity, args.remediation_id);
      return textResult({
        ok: true,
        remediation_id: remediation.remediation_id,
        decision_id: remediation.original_decision.decision_id,
        explanation: remediation.nyra_explanation,
      });
    },
    core_block_remediation_propose: async (args, identity) => {
      const remediation = await loadRemediationForIdentity(identity, args.remediation_id);
      assertRemediationWritesEnabled(remediation);
      const idem = await remediationStore.findIdempotency({
        tenant_id: identity.tenantId,
        remediation_id: remediation.remediation_id,
        idempotency_key: args.idempotency_key,
      });
      const attempt = proposeRemediationAttempt({
        remediation,
        actor: {
          kind: identity.kind || "connected_ai",
          subject: identity.subject || identity.agentId || "connected_ai",
          tenant_id: identity.tenantId,
        },
        proposal: args.proposal,
        diagnosis: args.diagnosis,
        idempotencyKey: args.idempotency_key,
        allowExistingReplay: Boolean(idem),
        now: () => new Date(),
      });
      if (idem && idem.proposal_digest && idem.proposal_digest !== attempt.proposal_digest) {
        throw new Error("core_block_remediation_replay_rejected");
      }
      if (idem?.result) {
        const replayed = idem.result.remediation || idem.result?.remediation?.remediation || null;
        return textResult({
          ok: true,
          idempotent: true,
          remediation: replayed ? remediationEnvelope(replayed, {
            latest_attempt: replayed.attempts?.at(-1) || null,
            diagnosis: replayed.attempts?.at(-1)?.diagnosis || null,
          }) : idem.result.remediation,
        });
      }
      validateProposalForRemediation(remediation, attempt, {
        expectedVersion: args.expected_version,
        idempotencyKey: args.idempotency_key,
      });
      const nextStatus = attempt.proposal_type === CORE_BLOCK_PROPOSAL_TYPES.OWNER_CONFIRMATION_ROUTE
        ? CORE_BLOCK_REMEDIATION_STATUS.WAITING_OWNER
        : CORE_BLOCK_REMEDIATION_STATUS.PROPOSAL_READY;
      const appended = await remediationStore.appendAttemptIdempotent({
        tenant_id: remediation.tenant_id,
        remediation_id: remediation.remediation_id,
        expected_version: remediation.version,
        attempt,
        next_status: nextStatus,
        idempotency_key: args.idempotency_key,
        proposal_digest: attempt.proposal_digest,
      });
      const updated = appended.remediation;
      const result = {
        ok: true,
        ...(appended.idempotent ? { idempotent: true } : {}),
        remediation: remediationEnvelope(updated, {
          latest_attempt: updated.attempts?.at(-1) || attempt,
          diagnosis: updated.attempts?.at(-1)?.diagnosis || attempt.diagnosis,
        }),
      };
      if (appended.idempotent) return textResult(result);
      const ledger = remediationDecisionLedger(identity);
      if (ledger) {
        await ledger.append({
          tenant_id: remediation.tenant_id,
          work_id: remediation.work_id,
          event_type: "core_block_proposal_submitted",
          remediation_id: remediation.remediation_id,
          decision_id: remediation.original_decision.decision_id,
          reason_summary: attempt.summary,
          metadata: {
            proposal_digest: attempt.proposal_digest,
            proposal_type: attempt.proposal_type,
          },
        });
      }
      return textResult(result);
    },
    core_block_remediation_review: async (args, identity) => {
      const remediation = await loadRemediationForIdentity(identity, args.remediation_id);
      assertRemediationWritesEnabled(remediation);
      const attempt = remediation.attempts.find((item) => item.attempt_id === args.attempt_id) || null;
      if (!attempt) throw new Error("remediation_attempt_not_found");
      const review = await reviewRemediationProposal({
        remediation,
        attempt,
        actor: {
          kind: identity.kind || "nyra",
          tenant_id: identity.tenantId,
          subject: identity.subject || identity.agentId || "nyra",
        },
        store: remediationStore,
        ledger: remediationDecisionLedger(identity),
      });
      return textResult({
        ok: true,
        remediation_id: remediation.remediation_id,
        review,
      });
    },
    core_block_remediation_resubmit: async (args, identity) => {
      const remediation = await loadRemediationForIdentity(identity, args.remediation_id);
      assertRemediationResubmissionEnabled(remediation);
      const attempt = remediation.attempts.find((item) => item.attempt_id === args.attempt_id) || null;
      if (!attempt) throw new Error("remediation_attempt_not_found");
      const ownerRoute = attempt.proposal_type === CORE_BLOCK_PROPOSAL_TYPES.OWNER_CONFIRMATION_ROUTE &&
        remediation.original_decision.owner_confirmation_required === true;
      if (ownerRoute) {
        if (remediation.status !== CORE_BLOCK_REMEDIATION_STATUS.WAITING_OWNER ||
            remediation.attempts.at(-1)?.attempt_id !== attempt.attempt_id) {
          throw new Error("owner_confirmation_route_state_invalid");
        }
        if (!hasExplicitVerifiedOwnerConfirmation(identity, { allowOAuthTenantOwner: true })) {
          throw new Error("owner_confirmation_required");
        }
      } else {
        if (remediation.nyra_review?.status !== "approve_for_core") {
          throw new Error("nyra_review_required");
        }
        if (remediation.nyra_review.reviewed_attempt_id !== attempt.attempt_id ||
            remediation.nyra_review.reviewed_proposal_digest !== attempt.proposal_digest) {
          throw new Error("nyra_review_attempt_binding_mismatch");
        }
      }
      const reviewForCore = ownerRoute ? {
        review_digest: remediation.nyra_explanation.explanation_digest,
      } : remediation.nyra_review;
      const resubmissionContext = buildResubmissionContext(remediation, attempt, reviewForCore);
      const actionBody = {
        request_id: `resubmit_${crypto.randomUUID()}`,
        remediation_context: resubmissionContext,
        ...sanitizeCoreBody({
          action_label: remediation.bound_scope.operation_type,
          action_type: remediation.bound_scope.operation_type,
          project_id: remediation.project_id,
          work_id: remediation.work_id,
          branch_id: remediation.branch_id,
          session_id: remediation.session_id,
          target_system: remediation.bound_scope.target_system,
          operation_class: remediation.bound_scope.operation_class,
          repository: remediation.bound_scope.repository,
          ref: remediation.bound_scope.ref,
          environment: remediation.bound_scope.environment,
          resource_ids: remediation.bound_scope.resource_ids,
          tenant_id: identity.tenantId,
          ...(ownerRoute ? {
            owner_confirmed: true,
            confirmation_reference: verifiedConfirmationReference(identity, { allowOAuthTenantOwner: true }),
          } : {}),
        }),
      };
      const coreResponse = await coreRequest("/v1/action-evaluator", identity.tenantId, {
        method: "POST",
        useTenantGateway: true,
        body: {
          ...actionBody,
          ...(ownerRoute ? { owner_context: ownerContext(identity, {
            requestBinding: ownerRequestBinding("core_action_evaluator", actionBody),
            actionEvaluatorGateway: true,
            allowOAuthTenantOwner: true,
          }) } : {}),
        },
        allowFailurePayload: true,
      });
      const payload = coreResponse.payload || coreResponse;
      const { allowed, confirmationRequired, verdict: returnedVerdict, status: nextStatus } =
        classifyRemediationResubmissionOutcome(payload);
      const resubmitted = await remediationStore.recordResubmission({
        tenant_id: remediation.tenant_id,
        remediation_id: remediation.remediation_id,
        expected_version: remediation.version,
        resubmission: {
          status: allowed ? "allowed" : confirmationRequired ? "waiting_owner" : "blocked",
          resubmission_id: `resub_${crypto.randomUUID()}`,
          attempt_id: attempt.attempt_id,
          new_decision_id: payload?.decision_contract?.decision_id || payload?.authorization?.decision_id || null,
          new_decision_digest: payload?.decision_contract?.decision_digest || null,
          new_verdict: returnedVerdict || null,
          submitted_at: new Date().toISOString(),
        },
      });
      const finalState = await remediationStore.markStatus({
        tenant_id: remediation.tenant_id,
        remediation_id: remediation.remediation_id,
        expected_version: resubmitted.version,
        status: nextStatus,
      });
      const ledger = remediationDecisionLedger(identity);
      if (ledger) {
        await ledger.append({
          tenant_id: remediation.tenant_id,
          work_id: remediation.work_id,
          event_type: allowed ? "core_block_remediation_allowed"
            : confirmationRequired ? "core_block_remediation_waiting_owner"
              : "core_block_remediation_revision_requested",
          remediation_id: remediation.remediation_id,
          decision_id: remediation.original_decision.decision_id,
          reason_summary: allowed ? "resubmission_allowed"
            : confirmationRequired ? "request_bound_owner_confirmation_required"
              : "resubmission_blocked",
          metadata: { resubmission_context: resubmissionContext },
        });
      }
      return textResult({
        ok: true,
        remediation: remediationEnvelope(finalState, {
          resubmission_context: resubmissionContext,
          core_response: payload,
        }),
      });
    },
    core_block_remediation_cancel: async (args, identity) => {
      const remediation = await loadRemediationForIdentity(identity, args.remediation_id);
      assertRemediationWritesEnabled(remediation);
      const cancelled = await remediationStore.cancel({
        tenant_id: remediation.tenant_id,
        remediation_id: remediation.remediation_id,
        expected_version: remediation.version,
        reason: args.reason,
      });
      const ledger = remediationDecisionLedger(identity);
      if (ledger) {
        await ledger.append({
          tenant_id: remediation.tenant_id,
          work_id: remediation.work_id,
          event_type: "core_block_remediation_cancelled",
          remediation_id: remediation.remediation_id,
          decision_id: remediation.original_decision.decision_id,
          reason_summary: args.reason || "cancelled",
        });
      }
      return textResult({
        ok: true,
        remediation: remediationEnvelope(cancelled),
      });
    }
  };
  // Internal gateway seam for adapters that must reuse the exact Core URL,
  // bearer selection, tenant-context binding and response validation above.
  // Non-enumerable keeps it off the MCP tool handler surface.
  Object.defineProperty(handlers, "causalCoreRequest", {
    value: coreRequest,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return handlers;
}

export function createCoreWriteGuard(config, options = {}) {
  const handlers = createCoreHandlers(config, options);
  return async function governWrite(action, identity) {
    const autonomousInternalActionTypes = new Set([
      "agent.heartbeat",
      "task.claim",
      "task.update",
      "message.acknowledge",
      "work.participant.join",
      "work.participant.heartbeat",
      "work.branch.open",
      "work.lease.acquire",
      "work.lease.renew",
      "work.lease.release",
      "work.message.post",
    ]);
    const ownerConfirmedInternalActionTypes = new Set([
      "workspace.create_folder",
      "workspace.write_document",
      "task.create",
      "message.post",
      "memory.append",
      "memory.checkpoint",
      "memory.handoff",
      "memory.handoff_acknowledge",
      "research.plan_issued",
      "research.ingest",
      "research.feedback",
    ]);
    const actionType = String(action.action_type || "").toLowerCase();
    const tenantWorkBootstrap =
      actionType === "work.continuity.create" ||
      actionType === "work.continuity.start_or_resume";
    const operationClass = action.operation_class ||
      (autonomousInternalActionTypes.has(actionType)
        ? "bounded_internal_coordination_write"
        : "owner_confirmed_governed_action");
    if (!action.operation_class &&
      !autonomousInternalActionTypes.has(actionType) &&
      !ownerConfirmedInternalActionTypes.has(actionType)) {
      return {
        allowed: false,
        decision: "not_authorized",
        mediation: "defer",
        owner_confirmation_required: true,
        confirmation_satisfied: false,
      };
    }
    const result = await handlers.core_gate_action({
      action_label: action.action_label,
      action_type: action.action_type,
      target: action.target,
      operation_class: operationClass,
      external_side_effect: action.external_side_effect === true,
      contains_customer_data: action.contains_customer_data === true,
      contains_secret: action.contains_secret === true,
      secret_value_transmitted: action.secret_value_transmitted === true,
      cross_tenant: action.cross_tenant === true,
      configuration_changes: action.configuration_changes === true,
      destructive: action.destructive === true,
      bypass_orchestrator: action.bypass_orchestrator === true,
      provider_execution: action.provider_execution === true,
      bounded_scope: action.bounded_scope === true,
      low_impact: action.low_impact === true,
      idempotent_or_compensable: action.idempotent_or_compensable === true,
      deploy: action.deploy === true,
      production_deploy: action.production_deploy === true,
      merge: action.merge === true,
      delete: action.delete === true,
      execution_enabled: action.execution_enabled === true,
      force: action.force === true,
      admin_bypass: action.admin_bypass === true,
      rollback_ready: action.rollback_ready === undefined ? action.external_side_effect !== true : action.rollback_ready === true,
      audit_ready: action.audit_ready === true,
      target_authority_verified: action.target_authority_verified === true,
      actor_authorized_for_target: action.actor_authorized_for_target === true,
      idempotency_key: action.idempotency_key,
      owner_confirmed: hasExplicitVerifiedOwnerConfirmation(identity),
      ...(verifiedConfirmationReference(identity) ? { confirmation_reference: verifiedConfirmationReference(identity) } : {}),
      ...(tenantWorkBootstrap ? { internal_owner_assertion_scope: "tenant_work_bootstrap" } : {}),
    }, identity);
    const payload = result.structuredContent || {};
    const authorization = payload.authorization || {};
    const contract = payload.decision_contract || payload.verdict?.decision_contract || payload.verdict || payload;
    const output = payload.output || {};
    const decision = String(authorization.state || contract.state || contract.decision || "unknown");
    const mediation = String(authorization.mediation || contract.action_mediation?.state || contract.mediation || "unknown");
    const blocked = decision === "block" || decision === "blocked" || mediation === "hard_block" ||
      output.recommended_actions?.some?.((item) => item.blocked === true) === true;
    const confirmationRequired = authorization.confirmation_required === true ||
      (!payload.authorization && (contract.control_level === "confirm" || output.execution_profile?.requires_user_confirmation === true));
    const confirmationSatisfied = payload.authorization
      ? authorization.confirmation_satisfied === true
      : identity.ownerConfirmed === true && confirmationRequired;
    const legacyExplicitlyAllowed = ["allow", "allowed", "allow_controlled", "allow_advisory"].includes(decision)
      || mediation === "allow";
    const allowed = payload.authorization
      ? authorization.allowed === true && !blocked
      : legacyExplicitlyAllowed && !blocked && (!confirmationRequired || confirmationSatisfied);
    return {
      allowed,
      decision,
      mediation,
      owner_confirmation_required: confirmationRequired,
      confirmation_satisfied: confirmationSatisfied,
    };
  };
}

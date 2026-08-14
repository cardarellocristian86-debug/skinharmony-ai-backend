import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runUniversalCore } from "../../../universal-core/packages/core/src/index.ts";
import { mapFlowCoreToUniversal } from "../../../universal-core/packages/branches/flowcore/src/index.ts";
import { runTextBranch } from "../../../universal-core/packages/branches/ramo-testo/src/index.ts";
import { runNiraUniversalCoreBridge } from "../../../universal-core/tools/nira-universal-core-bridge.ts";
import { buildDeepNyraRuntime } from "./deepNyraRuntime.js";
import { createNyraDeepBranchV2Client } from "./nyraDeepBranchV2Client.js";
import {
  createNyraDeepBranchV2Attester,
  NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_BUNDLE_SCHEMA_VERSION,
  NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_ISSUER,
  NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_SCHEMA_VERSION,
} from "./nyraDeepBranchV2Attestation.js";
import { createNyraDeepV2EvidenceLedger } from "./nyraDeepV2EvidenceLedger.js";
import { createNyraDeepV2SourceVerifier } from "./nyraDeepV2SourceVerification.js";
import { createNyraPolicyRegistryStore, createPostgresNyraPolicyRegistryStore } from "./nyraPolicyRegistryStore.js";
import { validatePolicySnapshot } from "./nyraPolicyRegistry.js";
import { createNyraPolicyRegistryProofService } from "./nyraPolicyRegistryProofService.js";
import { createNyraPolicyRegistryCompilerProvenanceVerifier } from "./nyraPolicyRegistryCompilerProvenance.js";
import {
  createNyraPolicyRegistryClient,
  createNyraPolicyRegistryCoordinator,
} from "./nyraPolicyRegistryCoordinator.js";
import { createNyraPolicyRegistryCoreRemoteSigner } from "./nyraPolicyRegistryCoreRemoteSigner.js";
import {
  createNyraDeepV2McpRequestVerifier,
  nyraDeepV2EvidencePackHash,
  nyraDeepV2StableJson,
} from "./nyraDeepV2McpRequest.js";
import { createAudit, ensureDir } from "./audit.js";
import { createKeyStore, isMcpTenantGatewayRecord, isProviderSetupLinkServiceRecord } from "./keyStore.js";
import { createSetupTokenStore } from "./setupTokenStore.js";
import { detectLanguageGuardIssues, supportedLanguageGuardLocales } from "./languageGuard.js";
import { hasScope, requireTenantAccess, KEY_PRESETS, SCOPES } from "./scope.js";
import { buildCodexGuardResponse, normalizeDecisionContract } from "./decisionContract.js";
import {
  BRANCH_PACKAGES,
  composeBranchContext,
  deterministicBranchGroups,
  deterministicBranchRegistry,
  deterministicBranchTaxonomy,
  resolveBranchesForKey,
} from "../branches/index.js";
import { applyOwnerActiveAdvisory, resolveOwnerTenantBranchProfile } from "./ownerTenantBranchProfile.js";
import {
  listOrchestrationCapabilities,
  listVirtualOrchestrationCombinations,
} from "../branches/orchestration-capability-catalog.js";
import { buildSuitePolicy } from "./suitePolicy.js";
import { getTenantPolicy } from "./tenantRegistry.js";
import { checkDomainPackRequest, listDomainPacks, publicDomainPack, resolveDomainPackForKey } from "./domainPacks.js";
import { nyraBranchCatalog, routeNyraBranches } from "./nyraBranchNetwork.js";
import { multiAgentRegistry, planMultiAgentRun } from "./multiAgentArchitecture.js";
import {
  AI_GATEWAY_ADAPTERS,
  AI_GATEWAY_MODES,
  AI_GATEWAY_SCHEMA_VERSION,
  buildAiGatewayCoreInput,
  buildAiGatewayVerdict,
  validateAiGatewayPayload,
} from "./aiGateway.js";
import {
  AI_GATEWAY_PAYLOAD_SCHEMA,
  AI_GATEWAY_VERDICT_SCHEMA,
} from "./gatewaySchema.js";
import {
  buildCustomerIntelligenceContract,
  summarizeCustomerIntelligenceReadiness,
} from "./customerIntelligenceContract.js";
import { selectSemanticCandidates } from "./semanticSelection.js";
import {
  SOFTWARE_LANGUAGE_GATE_VERSION,
  evaluateSoftwareLanguageGate,
} from "./softwareLanguageGate.js";
import { buildWorkPreflight } from "./workPreflight.js";
import {
  AI_WORK_FAILURE_DISPOSITION,
  aiWorkQualityEvidenceBindingReference,
  verifyAiWorkQualityObservation,
} from "../../shared/ai-work-quality-failure.js";
import {
    validateWorkPreflightEnvelope,
  workPreflightFailure,
} from "../../shared/work-preflight-gate.mjs";
import { mediateFailureObservation } from "../../shared/ai-work-quality-failure-mediation.mjs";
import {
  analyzeScenarios,
  evaluateCounterfactuals,
  evaluateEvents,
  rankHypotheses,
  runIntelligenceWorkflow,
  selectDecision,
  summarizeCalibration,
  verifyOutcome,
} from "./intelligenceEngine.js";
import { buildActionAuthorization } from "./actionAuthorization.js";
import { applyActionRiskProfile, classifyActionRisk } from "./actionRisk.js";
import {
  isProviderSetupLinkBindingAttempt,
  providerSetupLinkBindingApprovalDigest,
  providerSetupLinkBindingAuditFields,
} from "./providerSetupLinkBinding.js";
import { createCoreRuntimeWorker } from "./coreRuntimeWorker.js";
import { createIcfKernel } from "./icfKernel.js";
import { createIcfRuntimeFacade } from "./icfRuntimeFacade.js";
import { coreRuntimeHierarchyStatus, evaluateCoreRuntimeHierarchy } from "./coreRuntimeHierarchy.js";
import {
  analyzeEmbeddedSoftwareArtifact,
  embeddedComponentManifest,
  MAX_EMBEDDED_ARTIFACT_BYTES,
} from "./embeddedSoftwareIntelligence.js";
import { buildResearchPlan, validateResearchEvidence } from "./researchCortex.js";
import { buildCoreResearchDirective } from "./coreResearchDirective.js";
import {
  createResearchDistillationRuntime,
  sourceRegistry as createResearchSourceRegistry,
} from "./researchDistillationLayer.js";
import {
  createResearchAirlockRuntime,
  RESEARCH_AIRLOCK_POLICY_VERSION,
} from "./researchAirlock.js";
import { createPostgresResearchAirlockStore } from "./researchAirlockStore.js";
import {
  createUniversalSoftwareJobManager,
  issueSoftwareAuthorizationEnvelope,
  universalSoftwareComponentManifest,
} from "./universalSoftwareIntelligence.js";
import { createGenericAgentRuntime } from "./genericAgentRuntime.js";
import { createGenericAgentCheckpointStore } from "./genericAgentCheckpointStore.js";
import { evaluateGenericAgentRun } from "./genericAgentEvaluation.js";
import { createGenericAgentOrchestrator } from "./genericAgentOrchestrator.js";
import { createGenericAgentOrchestrationStore } from "./genericAgentOrchestrationStore.js";
import { buildGovernedResearchWorkers, createGovernedAgentRegistry } from "./governedAgentRegistry.js";
import { createRelationalOrchestrationSupervisor } from "./relationalOrchestrationSupervisor.js";
import { createDynamicTaskTreeRuntime } from "./dynamicTaskTree.js";
import {
  buildVerificationEvidenceContract,
  prepareVerificationEvidenceDraft,
} from "./verificationEvidenceContract.js";
import { createFileDynamicTaskTreeStateStore, createPostgresDynamicTaskTreeStateStore } from "./dynamicTaskTreeStateStore.js";
import {
  createFileDynamicTaskTreeJoinVerdictStore,
  createPostgresDynamicTaskTreeJoinVerdictStore,
} from "./dynamicTaskTreeJoinVerdictStore.js";
import { mountDttAgentIdentityReceiptRoutes } from "./dttAgentIdentityReceiptRoutes.js";
import {
  createFileDttVerificationTrustStore,
  createPostgresDttVerificationTrustStore,
} from "./dttVerificationTrustStore.js";
import {
  createAsyncDttAgentIdentityReceiptService,
  createFileDttAgentIdentityReceiptStore,
  createPostgresDttAgentIdentityReceiptStore,
} from "../../shared/dtt-agent-identity-receipts.js";
import {
  DTT_WORK_CONTEXT_HEADER,
  verifyDttWorkContext,
} from "../../shared/dtt-work-context.js";
import {
  GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER,
  GENERIC_WORK_CORE_JOIN_CONTEXT_PURPOSE,
  GENERIC_WORK_CORE_JOIN_CONTEXT_VERSION,
  verifyGenericWorkCoreJoinContext,
} from "../../shared/generic-work-core-join-context.js";
import {
  createPostgresMajorVersionProbe,
  normalizePostgresMajorVerification,
} from "../../shared/postgres-major-version.js";
import {
  assessLexicalSemanticText,
  lexicalSemanticCatalogDescriptor,
  listLexicalSemanticCapabilities,
  listVirtualLexicalSemanticVariants,
} from "../../shared/lexical-semantic-engine.mjs";
import { createGovernedAgentActivationStore } from "./governedAgentActivationStore.js";
import { createGovernedAgentBudgetStore } from "./governedAgentBudgetStore.js";
import { createGovernedAgentQueueStore } from "./governedAgentQueueStore.js";
import { createGovernedAgentPostgresQueueStore } from "./governedAgentPostgresQueueStore.js";
import { createGovernedAgentDryRunRunner } from "./governedAgentDryRunRunner.js";
import { mountAdminControlRoom } from "./adminControlRoom.js";
import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  HOST_NATIVE_HEALTH_CONTRACT_VERSION,
  HOST_RELEASE_MANIFEST_VERSION,
  buildHostNativeWorkPlan,
  buildHostReleaseIntentV1,
  createFileHostNativeGovernanceStore,
  createHostNativeGovernance,
  createHostNativeDomainSigner,
  validateHostReleaseManifestV2,
} from "./hostNativeGovernance.js";
import {
  createHostNativeExternalReadbackVerifier,
  createHostNativeReleaseJoinVerdictResolver,
} from "./hostNativeExternalReadback.js";
import {
  createGenericWorkCoreJoinAuthority,
  createLocalGenericWorkCoreJoinSigner,
  createGenericWorkCoreJoinVerdictVerifier,
  genericWorkCoreJoinDigest,
  genericWorkCoreJoinInfrastructureCode,
  genericWorkCoreJoinSignerInfrastructureCode,
  genericWorkCoreJoinStoreInfrastructureCode,
  verifyGenericWorkCoreJoinDigestSignature,
} from "./genericWorkCoreJoin.js";
import { createGenericWorkCoreJoinRemoteSigner } from "./genericWorkCoreJoinRemoteSigner.js";
import { createPostgresGenericWorkCoreJoinStore } from "./genericWorkCoreJoinStore.js";
import { createPostgresBootstrapAuthorityStore } from "./bootstrapAuthorityPostgresStore.js";
import { createBootstrapDeadlockVerdictStore } from "./bootstrapDeadlockVerdictStore.js";
import { createBootstrapRequiredChecksReadback } from "./bootstrapRequiredChecksReadback.js";
import { createBootstrapReleasePreparationService } from "./bootstrapReleasePreparation.js";
import {
  bootstrapReleaseExceptionCanonicalJson,
  verifyLocalPinBootstrapReleaseException,
} from "./bootstrapReleaseException.js";
import { createPostgresCausalContinuityStore } from "./causalContinuityStore.js";
import { createCausalContinuityRuntime } from "./causalContinuityRuntime.js";
import { registerCausalContinuityRoutes } from "./causalContinuityRoutes.js";
import { causalDigest, CausalContinuityError } from "./causalContinuityCanonical.js";
import {
  createFailClosedRenderOriginResolver,
  createProjectScopeRenderOriginResolver,
} from "./projectScopeRenderOriginResolver.js";
import { loadHostNativeResolverRegistryFromEnvironment } from "./hostNativeResolverRegistry.js";
import {
  buildCausalBranchResult,
  extendCausalBranchRegistry,
  validateCausalBranchInvocation,
} from "./causalBranchContract.js";
import { createCausalBranchEnforcer } from "./causalBranchEnforcement.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORAGE_ROOT = path.resolve(__dirname, "../storage");
const SERVICE_VERSION = "0.13.0-host-native-governance";
const SERVICE_NAME = String(process.env.CORE_SERVICE_NAME || "universal-core-service").trim();
const OWNER_CONTEXT_ASSERTION_VERSION = "owner_context_assertion_v1";
const BUILD_ID = String(process.env.CORE_SERVICE_BUILD_ID || process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "unavailable").trim();
const BUILD_COMMIT_SHA =
  String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "").trim().toLowerCase() ||
  null;
const BOOTSTRAP_AUTHORITY_TRUST_PIN_SCHEMA_VERSION = "bootstrap_authority_trust_pin_v1";
const BOOTSTRAP_AUTHORITY_TRUST_PIN_FIELDS = Object.freeze([
  "authority_key_id",
  "genesis_record_digest",
  "public_key_sha256",
  "schema_version",
  "tenant_id",
]);
const BOOTSTRAP_AUTHORITY_FORBIDDEN_FIELD = /(^|_)(?:private(?:_key)?|secret|password|passphrase|credential|credentials|token|seed|mnemonic|hmac|mac|shared_key|symmetric_key|api_key|access_key|client_secret)(?:_|$)/i;

function bootstrapAuthorityFail(code) {
  throw new Error(code);
}

function bootstrapAuthorityPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseBootstrapAuthorityTrustPin(raw) {
  let pin;
  try { pin = JSON.parse(raw); } catch { bootstrapAuthorityFail("bootstrap_authority_trust_pin_json_invalid"); }
  if (!bootstrapAuthorityPlainObject(pin)) bootstrapAuthorityFail("bootstrap_authority_trust_pin_schema_invalid");
  const fields = Object.keys(pin).sort();
  const expectedFields = [...BOOTSTRAP_AUTHORITY_TRUST_PIN_FIELDS].sort();
  if (fields.length !== expectedFields.length || fields.some((field, index) => field !== expectedFields[index])) {
    bootstrapAuthorityFail("bootstrap_authority_trust_pin_schema_invalid");
  }
  if (pin.schema_version !== BOOTSTRAP_AUTHORITY_TRUST_PIN_SCHEMA_VERSION ||
      typeof pin.tenant_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(pin.tenant_id) ||
      typeof pin.authority_key_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(pin.authority_key_id) ||
      typeof pin.public_key_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(pin.public_key_sha256) ||
      typeof pin.genesis_record_digest !== "string" || !/^[a-f0-9]{64}$/.test(pin.genesis_record_digest)) {
    bootstrapAuthorityFail("bootstrap_authority_trust_pin_schema_invalid");
  }
  return Object.freeze({
    tenant_id: pin.tenant_id,
    authority_key_id: pin.authority_key_id,
    public_key_sha256: pin.public_key_sha256,
    genesis_record_digest: pin.genesis_record_digest,
  });
}

const BOOTSTRAP_DEADLOCK_ALLOWED_FAILURE_CODES = Object.freeze([
  "BOOTSTRAP_ROOT_OF_TRUST_MISSING",
  "BOOTSTRAP_TRUST_REGISTRY_UNAVAILABLE",
  "BOOTSTRAP_VERIFIER_UNAVAILABLE",
]);
const BOOTSTRAP_DEADLOCK_FAILURE_CODE_MAP = Object.freeze({
  bootstrap_root_of_trust_missing: "BOOTSTRAP_ROOT_OF_TRUST_MISSING",
  bootstrap_trust_registry_unavailable: "BOOTSTRAP_TRUST_REGISTRY_UNAVAILABLE",
  bootstrap_verifier_unavailable: "BOOTSTRAP_VERIFIER_UNAVAILABLE",
});
const BUILD_COMMIT_VERIFIABLE = /^[a-f0-9]{40}$/.test(BUILD_COMMIT_SHA || "");
const DEFAULT_CAUSAL_INITIALIZATION_LIVENESS_MS = 30 * 60 * 1_000;
const MAX_CAUSAL_INITIALIZATION_LIVENESS_MS = 60 * 60 * 1_000;
const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 1_500;
const MAX_HEALTH_PROBE_TIMEOUT_MS = 2_500;
const RESEARCH_AIRLOCK_BOOTSTRAP_GUARD_SCHEMA = "research_airlock_bootstrap_guard_v1";
const RESEARCH_AIRLOCK_BOOTSTRAP_GUARD_PURPOSE = "causal_initialization_liveness";

export function boundedCausalInitializationLivenessMs(value) {
  const requested = Number(value ?? DEFAULT_CAUSAL_INITIALIZATION_LIVENESS_MS);
  return Math.min(
    Math.max(
      Number.isFinite(requested)
        ? requested
        : DEFAULT_CAUSAL_INITIALIZATION_LIVENESS_MS,
      1,
    ),
    MAX_CAUSAL_INITIALIZATION_LIVENESS_MS,
  );
}

export function boundedHealthProbeTimeoutMs(value) {
  const requested = Number(value ?? DEFAULT_HEALTH_PROBE_TIMEOUT_MS);
  return Math.min(
    Math.max(
      Number.isFinite(requested) ? requested : DEFAULT_HEALTH_PROBE_TIMEOUT_MS,
      1,
    ),
    MAX_HEALTH_PROBE_TIMEOUT_MS,
  );
}

function buildResearchAirlockBootstrapGuard({
  buildCommitSha,
  causalProductionRequired,
  causalState,
  initializationElapsedMs,
  livenessWindowMs,
  mode,
  runtimeReady,
  store,
}) {
  const backend = String(store?.kind || "unavailable");
  const restartDurable = store?.restart_durable === true;
  const distributed = store?.distributed === true;
  const normalizedMode = String(mode || "unknown");
  const structurallySafe = backend === "postgresql" && restartDurable && distributed;
  const elapsed = Math.max(0, Math.floor(Number(initializationElapsedMs)));
  const windowMs = Math.floor(Number(livenessWindowMs));
  const modeSafe = normalizedMode === "enforced" && runtimeReady === true;
  if (!BUILD_COMMIT_VERIFIABLE
    || !/^[a-f0-9]{40}$/.test(BUILD_ID)
    || BUILD_ID !== buildCommitSha
    || causalProductionRequired !== true
    || causalState !== "initializing"
    || !Number.isSafeInteger(elapsed)
    || !Number.isSafeInteger(windowMs)
    || windowMs < 1
    || elapsed > windowMs
    || !structurallySafe
    || !modeSafe) {
    return null;
  }
  const payload = {
    schema_version: RESEARCH_AIRLOCK_BOOTSTRAP_GUARD_SCHEMA,
    purpose: RESEARCH_AIRLOCK_BOOTSTRAP_GUARD_PURPOSE,
    policy_version: RESEARCH_AIRLOCK_POLICY_VERSION,
    static_guard_ready: true,
    mode: normalizedMode,
    store_backend: backend,
    restart_durable: restartDurable,
    distributed,
    accepting_new_work: false,
    runtime_verified: false,
    build_commit_sha: buildCommitSha,
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    causal_state: causalState,
    causal_production_required: true,
    liveness_window_ms: windowMs,
    initialization_elapsed_ms: elapsed,
    readiness_verified: false,
  };
  return Object.freeze({ ...payload, guard_digest: causalDigest(payload) });
}
const PROVIDER_SETUP_LINK_ISSUER_KIND = "provider_setup_link";
const PROVIDER_SETUP_LINK_OWNER_SUBJECT_PATTERN = /^osf_[a-f0-9]{64}$/;
const TRUSTED_PROVIDER_SETUP_ORIGIN = "https://skinharmony-universal-core.onrender.com";
const TRUSTED_AGENT_PORTAL_URL = "https://skinharmony-core-mcp.onrender.com/agents";
const NATIVE_AGENT_PROVIDER_RETIREMENT_CODE = "native_agent_provider_retired";
const NATIVE_AGENT_PROVIDER_RETIREMENT_MESSAGE =
  "Provider execution is retired. Use native ChatGPT/Codex specialists.";

function strictGenericWorkCoreJoinBoolean(value, fallback, code) {
  if (value === undefined || value === null || value === "") {
    return Object.freeze({ value: fallback, valid: true, error: null });
  }
  if (value === true || value === false) {
    return Object.freeze({ value, valid: true, error: null });
  }
  if (value === "true" || value === "false") {
    return Object.freeze({ value: value === "true", valid: true, error: null });
  }
  return Object.freeze({ value: fallback, valid: false, error: code });
}

function optionalGenericWorkCoreJoinInteger(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return Number(value);
}

function nowIso() {
  return new Date().toISOString();
}

function dynamicTaskTreeRolloutConfig(env = process.env) {
  const enabledRaw = env.CORE_DTT_ENABLED;
  const enabled = enabledRaw === undefined
    ? true
    : ["1", "true", "yes", "on"].includes(String(enabledRaw).trim().toLowerCase());
  const requestedMode = String(env.CORE_DTT_MODE || "shadow").trim().toLowerCase();
  const mode = enabled && ["shadow", "active"].includes(requestedMode)
    ? requestedMode
    : "off";
  const tenantAllowlist = [...new Set(
    String(env.CORE_DTT_TENANT_ALLOWLIST || "")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  )].slice(0, 64);
  const production = String(env.NODE_ENV || "").trim().toLowerCase() === "production";
  return Object.freeze({
    enabled: enabled && mode !== "off",
    mode,
    tenant_allowlist: tenantAllowlist,
    tenantAllowed(tenantId) {
      return tenantAllowlist.length > 0
        ? tenantAllowlist.includes(String(tenantId || ""))
        : !production;
    },
  });
}

// Deep Branch V2 identifiers and evidence references are deliberately bounded
// before any federation or persistence operation.
const NYRA_DEEP_V2_ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/i;
const NYRA_DEEP_V2_REQUIREMENT_REF_PATTERN = /^req_[a-f0-9]{64}$/;
const NYRA_DEEP_V2_RECORD_REF_PATTERN = /^[a-f0-9]{64}$/;
const NYRA_DEEP_V2_OPERATIONS = new Set(["preview", "requirements", "prepare_evidence", "evaluate"]);
const NYRA_DEEP_V2_PREFLIGHT_OPERATIONS = Object.freeze({
  preview: "nyra_v2_preview",
  requirements: "nyra_v2_requirements",
  prepare_evidence: "nyra_v2_evidence_prepare",
  evaluate: "nyra_v2_evaluate",
});
const MAX_NYRA_BRANCH_REQUESTS = 64;

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validPolicyCompilerTrustCatalog(value) {
  const exact = (record, fields) => isPlainRecord(record) &&
    Object.getPrototypeOf(record) === Object.prototype &&
    Object.keys(record).sort().join("\0") === [...fields].sort().join("\0");
  const id = /^[a-z0-9][a-z0-9._/-]{1,159}$/;
  const sha = /^[a-f0-9]{64}$/;
  const sortedUnique = (values, pattern, maximum) => Array.isArray(values) &&
    values.length >= 1 && values.length <= maximum &&
    values.every((item, index) => typeof item === "string" && pattern.test(item) &&
      (index === 0 || values[index - 1] < item));
  if (!exact(value, [
    "schema_version", "issuers", "trusted_core_pack_digests", "known_core_branch_ids",
    "known_nyra_branch_ids", "known_domain_pack_ids",
  ]) || value.schema_version !== "nyra_policy_pack_trust_catalog_v1" ||
    !Array.isArray(value.issuers) || value.issuers.length < 2 || value.issuers.length > 32 ||
    !sortedUnique(value.trusted_core_pack_digests, sha, 64) ||
    !sortedUnique(value.known_core_branch_ids, id, 256) ||
    !sortedUnique(value.known_nyra_branch_ids, id, 256) ||
    !sortedUnique(value.known_domain_pack_ids, id, 256)) return false;
  const issuerIds = new Set();
  const keyIds = new Set();
  const fingerprints = new Set();
  const roles = new Set();
  let previous = null;
  for (const issuer of value.issuers) {
    if (!exact(issuer, [
      "issuer_id", "key_id", "role", "algorithm", "public_key", "public_key_fingerprint",
    ]) || !id.test(issuer.issuer_id) || !id.test(issuer.key_id) ||
      !["core", "nyra"].includes(issuer.role) || issuer.algorithm !== "Ed25519" ||
      typeof issuer.public_key !== "string" || !issuer.public_key ||
      /PRIVATE KEY|BEGIN RSA|BEGIN EC/.test(issuer.public_key) ||
      !sha.test(issuer.public_key_fingerprint)) return false;
    const order = `${issuer.issuer_id}\0${issuer.key_id}`;
    if ((previous !== null && previous >= order) || issuerIds.has(issuer.issuer_id) ||
      keyIds.has(issuer.key_id) || fingerprints.has(issuer.public_key_fingerprint)) return false;
    previous = order;
    issuerIds.add(issuer.issuer_id);
    keyIds.add(issuer.key_id);
    fingerprints.add(issuer.public_key_fingerprint);
    roles.add(issuer.role);
  }
  return roles.has("core") && roles.has("nyra") && fingerprints.size >= 2;
}

function validPolicyCompilerStatus(value, expectedCatalogDigest, expectedTrustCatalogDigest) {
  const fields = [
    "schema_version", "ready", "clock_ready", "mode", "compiler_algorithm",
    "verification_algorithm", "traversal_budget", "compiler_build_commit",
    "catalog_digest", "trust_catalog_digest", "issuer_count", "independent_key_count",
    "trusted_core_pack_digest_count", "known_core_branch_count", "known_nyra_branch_count",
    "known_domain_pack_count", "execution_authorized", "error",
  ];
  const bounded = (input, minimum, maximum) =>
    Number.isInteger(input) && input >= minimum && input <= maximum;
  return isPlainRecord(value) && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join("\0") === fields.sort().join("\0") &&
    value.schema_version === "nyra_policy_compiler_provenance_status_v1" &&
    value.ready === true && value.clock_ready === true &&
    value.mode === "core_deterministic_recompile" &&
    value.compiler_algorithm === "nyra_policy_registry_v1" &&
    value.verification_algorithm === "sha256_canonical_json+ed25519" &&
    bounded(value.traversal_budget, 1, 256) &&
    /^[a-f0-9]{40}$/.test(value.compiler_build_commit) &&
    value.catalog_digest === expectedCatalogDigest &&
    value.trust_catalog_digest === expectedTrustCatalogDigest &&
    bounded(value.issuer_count, 2, 32) &&
    bounded(value.independent_key_count, 2, 32) &&
    value.independent_key_count === value.issuer_count &&
    bounded(value.trusted_core_pack_digest_count, 1, 64) &&
    bounded(value.known_core_branch_count, 1, 256) &&
    bounded(value.known_nyra_branch_count, 1, 256) &&
    bounded(value.known_domain_pack_count, 1, 256) &&
    value.execution_authorized === false && value.error === null;
}

function nyraDeepV2Fallback({
  requestId = null,
  state = "disabled_v1_authoritative",
  reason = "nyra_deep_branch_v2_unavailable",
} = {}) {
  return {
    schema_version: "nyra_deep_branch_v2_core_operation_v1",
    state,
    ...(requestId ? { request_id: requestId } : {}),
    reason: String(reason || "nyra_deep_branch_v2_unavailable").slice(0, 160),
    requirements: [],
    evidence: {
      state: "not_prepared_v1_authoritative",
      evidence_refs: [],
      validation: {
        state: "not_requested",
        accepted_source_count: 0,
        accepted_claim_count: 0,
        rejected_count: 0,
      },
    },
    evaluation: { state: "not_requested_v1_authoritative", evaluated_node_count: 0 },
    execution_authorized: false,
    core_final_authority: true,
    fallback: "nyra_neural_branch_network_v1",
  };
}

function nyraDeepV2Operation(value) {
  const operation = String(value || "").trim();
  return NYRA_DEEP_V2_OPERATIONS.has(operation) ? operation : null;
}

function nyraDeepV2PreflightOperation(value) {
  const operation = nyraDeepV2Operation(value);
  return operation ? NYRA_DEEP_V2_PREFLIGHT_OPERATIONS[operation] : null;
}

function boundedNyraDeepV2EvidenceRefs(values, maximum = 100) {
  if (!Array.isArray(values) || values.length > maximum) return null;
  const refs = values.map((value) => String(value || "").trim());
  if (
    refs.some((value) => !NYRA_DEEP_V2_RECORD_REF_PATTERN.test(value))
    || new Set(refs).size !== refs.length
  ) return null;
  return refs;
}

function normalizeNyraDeepV2RequirementBindings(values, discovered = []) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 64) {
    return {
      ok: false,
      reason: "nyra_deep_branch_v2_requirement_bindings_required",
      bindings: [],
    };
  }
  const available = new Map(
    (Array.isArray(discovered) ? discovered : [])
      .map((binding) => [binding.requirement_ref, binding]),
  );
  const seenIds = new Set();
  const seenRefs = new Set();
  const seenClaimIds = new Set();
  const bindings = [];
  for (const item of values) {
    if (!isPlainRecord(item)) {
      return {
        ok: false,
        reason: "nyra_deep_branch_v2_requirement_binding_invalid",
        bindings: [],
      };
    }
    const id = String(item.id || "").trim();
    const requirementRef = String(item.requirement_ref || "").trim();
    const sourceIds = Array.isArray(item.source_ids)
      ? item.source_ids.map((value) => String(value || "").trim())
      : null;
    const claimIds = Array.isArray(item.claim_ids)
      ? item.claim_ids.map((value) => String(value || "").trim())
      : null;
    if (
      !NYRA_DEEP_V2_ID_PATTERN.test(id)
      || !NYRA_DEEP_V2_REQUIREMENT_REF_PATTERN.test(requirementRef)
      || !sourceIds
      || !claimIds
      || sourceIds.length < 1
      || claimIds.length < 1
      || sourceIds.length > 20
      || claimIds.length > 30
      || sourceIds.some((value) => !NYRA_DEEP_V2_ID_PATTERN.test(value))
      || claimIds.some((value) => !NYRA_DEEP_V2_ID_PATTERN.test(value))
      || new Set(sourceIds).size !== sourceIds.length
      || new Set(claimIds).size !== claimIds.length
      || seenIds.has(id)
      || seenRefs.has(requirementRef)
      || claimIds.some((claimId) => seenClaimIds.has(claimId))
      || !available.has(requirementRef)
    ) {
      return {
        ok: false,
        reason: "nyra_deep_branch_v2_requirement_binding_rejected",
        bindings: [],
      };
    }
    seenIds.add(id);
    seenRefs.add(requirementRef);
    claimIds.forEach((claimId) => seenClaimIds.add(claimId));
    const acceptance = available.get(requirementRef);
    bindings.push({
      id,
      requirement_ref: requirementRef,
      source_ids: sourceIds,
      claim_ids: claimIds,
      minimum_count: Math.max(1, Number(acceptance.minimum_count) || 1),
      evidence_type: String(acceptance.evidence_type || ""),
      semantic_claim_hash: String(acceptance.semantic_claim_hash || ""),
      required_claim: String(acceptance.required_claim || ""),
      required_content_tag: String(acceptance.required_content_tag || ""),
      capability_spec_hash: String(acceptance.capability_spec_hash || ""),
    });
  }
  return { ok: true, bindings };
}

function normalizedNyraDeepV2EvidenceText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function nyraDeepV2AcceptanceContractsMatch(evidencePack, bindings) {
  const sources = new Map(
    (Array.isArray(evidencePack?.sources) ? evidencePack.sources : [])
      .map((source) => [String(source?.id || ""), source]),
  );
  const claims = new Map(
    (Array.isArray(evidencePack?.claims) ? evidencePack.claims : [])
      .map((claim) => [String(claim?.id || ""), claim]),
  );
  for (const binding of bindings) {
    let acceptedCount = 0;
    const requiredClaim = normalizedNyraDeepV2EvidenceText(binding.required_claim);
    for (const claimId of binding.claim_ids) {
      const claim = claims.get(claimId);
      const claimText = normalizedNyraDeepV2EvidenceText(claim?.text);
      const facts = Array.isArray(claim?.facts)
        ? claim.facts.map(normalizedNyraDeepV2EvidenceText)
        : [];
      const claimSourceIds = Array.isArray(claim?.source_ids)
        ? [...new Set(claim.source_ids.map((value) => String(value || "")))]
        : [];
      const sourceSetMatches = claimSourceIds.length === binding.source_ids.length
        && binding.source_ids.every((sourceId) => claimSourceIds.includes(sourceId));
      const excerptsMatch = binding.source_ids.every((sourceId) => (
        normalizedNyraDeepV2EvidenceText(sources.get(sourceId)?.excerpt)
          .includes(requiredClaim)
      ));
      if (
        claimText === requiredClaim
        && facts.includes(requiredClaim)
        && claim?.claim_hash === binding.semantic_claim_hash
        && claim?.semantic_hash === binding.semantic_claim_hash
        && claim?.content_tag === binding.required_content_tag
        && claim?.capability_spec_hash === binding.capability_spec_hash
        && sourceSetMatches
        && excerptsMatch
      ) acceptedCount += 1;
    }
    if (acceptedCount < binding.minimum_count) return false;
  }
  return true;
}

function coreBindNyraDeepV2EvidencePack({
  evidencePack,
  bindings,
  sourceReceipts,
  tenantId,
  requestId,
  branchId,
  subbranchId,
  workPreflight,
}) {
  const bindingByClaim = new Map();
  for (const binding of bindings) {
    for (const claimId of binding.claim_ids) bindingByClaim.set(claimId, binding);
  }
  const receipts = new Map(
    sourceReceipts.map((receipt) => [receipt.source_id, receipt]),
  );
  const digest = (value) => crypto.createHash("sha256")
    .update(nyraDeepV2StableJson(value))
    .digest("hex");
  return {
    ...evidencePack,
    claims: evidencePack.claims.map((claim) => {
      const binding = bindingByClaim.get(String(claim?.id || ""));
      const recordHashes = (Array.isArray(claim?.source_ids) ? claim.source_ids : [])
        .map((sourceId) => receipts.get(sourceId)?.content_sha256)
        .filter((value) => /^[a-f0-9]{64}$/u.test(String(value || "")))
        .sort();
      return {
        ...claim,
        capability_input_hash: digest({
          tenant_id: tenantId,
          request_id: requestId,
          branch_id: branchId,
          subbranch_id: subbranchId,
          requirement_ref: binding?.requirement_ref || null,
          work_preflight: workPreflight || null,
        }),
        subject_hash: digest({
          tenant_id: tenantId,
          branch_id: branchId,
          subbranch_id: subbranchId,
          requirement_ref: binding?.requirement_ref || null,
        }),
        record_hashes: recordHashes,
      };
    }),
  };
}

function boundedNyraDeepV2EvidencePack(value) {
  if (
    !isPlainRecord(value)
    || !Array.isArray(value.sources)
    || !Array.isArray(value.claims)
    || value.sources.length < 1
    || value.sources.length > 20
    || value.claims.length < 1
    || value.claims.length > 30
  ) {
    return { ok: false, reason: "nyra_deep_branch_v2_evidence_pack_invalid" };
  }
  return { ok: true, evidence_pack: value };
}

function validNyraDeepV2SourceReceipt(receipt, now = Date.now()) {
  const expiresAt = Date.parse(String(receipt?.expires_at || ""));
  return receipt?.issuer === "skinharmony-universal-core"
    && NYRA_DEEP_V2_ID_PATTERN.test(String(receipt?.source_id || ""))
    && NYRA_DEEP_V2_ID_PATTERN.test(String(receipt?.registry_source_id || ""))
    && ["official", "regulator", "academic", "standards", "manufacturer"]
      .includes(String(receipt?.source_type || ""))
    && Number.isFinite(Number(receipt?.reliability_score))
    && Number(receipt.reliability_score) >= 0
    && Number(receipt.reliability_score) <= 1
    && /^[a-f0-9]{64}$/i.test(String(receipt?.source_url_sha256 || ""))
    && /^[a-f0-9]{64}$/i.test(String(receipt?.content_sha256 || ""))
    && /^[a-f0-9]{64}$/i.test(String(receipt?.excerpt_sha256 || ""))
    && /^ev_[a-f0-9-]{36}$/i.test(String(receipt?.receipt_id || ""))
    && Number.isFinite(expiresAt)
    && expiresAt > now;
}

function coreValidatedNyraDeepV2Claims(
  evidencePack,
  validation,
  sourceReceipts = [],
  now = Date.now(),
) {
  const sourceAssessment = new Map(
    (validation?.source_assessments || []).map((item) => [item.source_id, item]),
  );
  const claimInput = new Map(
    (evidencePack?.claims || []).map((item) => [item.id, item]),
  );
  const receiptsBySource = new Map(
    (Array.isArray(sourceReceipts) ? sourceReceipts : [])
      .filter((receipt) => validNyraDeepV2SourceReceipt(receipt, now))
      .map((receipt) => [receipt.source_id, receipt]),
  );
  const releaseEligible = validation?.release_readiness?.eligible_for_tenant_review === true;
  const validatedClaims = [];
  for (const assessment of validation?.claim_assessments || []) {
    const claim = claimInput.get(assessment.claim_id);
    const sourceIds = Array.isArray(claim?.source_ids) ? claim.source_ids : [];
    const sources = sourceIds.map((id) => sourceAssessment.get(id)).filter(Boolean);
    const receipts = sourceIds.map((id) => receiptsBySource.get(id)).filter(Boolean);
    const authoritative = sources.some((source) => Number(source.authority_score) >= 80);
    const supported = assessment.state === "supported"
      && Array.isArray(assessment.contradictions)
      && assessment.contradictions.length === 0;
    const coreVerified = sourceIds.length > 0 && receipts.length === sourceIds.length;
    validatedClaims.push({
      claim_id: assessment.claim_id,
      valid: releaseEligible && supported && authoritative && coreVerified,
      authority: authoritative ? "authoritative" : "unverified",
      independent: Number(assessment.independent_host_count || 0) >= 2,
      valid_until: coreVerified
        ? Math.min(...receipts.map((receipt) => Date.parse(receipt.expires_at)))
        : null,
      ...(coreVerified ? {
        core_receipt: {
          schema_version: "nyra_deep_v2_core_source_receipt_bundle_v1",
          issuer: "skinharmony-universal-core",
          receipt_ids: receipts.map((receipt) => receipt.receipt_id),
          sources: receipts.map((receipt) => ({
            source_id: receipt.source_id,
            source_url_sha256: receipt.source_url_sha256,
            content_sha256: receipt.content_sha256,
            excerpt_sha256: receipt.excerpt_sha256,
          })),
        },
      } : {}),
    });
  }
  const acceptedClaimCount = validatedClaims.filter((claim) => claim.valid).length;
  const acceptedSourceCount = (validation?.source_assessments || []).filter((source) => (
    Number(source.authority_score) >= 80
    && source.prompt_injection_detected !== true
    && source.sensitive_content_detected !== true
    && receiptsBySource.has(source.source_id)
  )).length;
  return {
    validated_claims: validatedClaims,
    compact_validation: {
      state: releaseEligible && acceptedClaimCount > 0
        ? "core_verified_candidate_validated"
        : "core_verified_candidate_not_ready",
      accepted_source_count: acceptedSourceCount,
      accepted_claim_count: acceptedClaimCount,
      rejected_count: Math.max(
        0,
        Number(validation?.claim_assessments?.length || 0) - acceptedClaimCount,
      ),
    },
  };
}

function compactNyraDeepV2Requirements(bindings) {
  return (Array.isArray(bindings) ? bindings : [])
    .slice(0, 64)
    .map((binding) => ({
      requirement_ref: String(binding.requirement_ref || ""),
      level: Number(binding.level),
      node_type: String(binding.node_type || ""),
      minimum_count: Math.max(1, Number(binding.minimum_count) || 1),
      authority_requirement: String(binding.authority_requirement || "unverified"),
      evidence_type: String(binding.evidence_type || ""),
      semantic_claim_hash: String(binding.semantic_claim_hash || ""),
      required_claim: String(binding.required_claim || ""),
      required_content_tag: String(binding.required_content_tag || ""),
      capability_spec_hash: String(binding.capability_spec_hash || ""),
    }))
    .filter((binding) => (
      NYRA_DEEP_V2_REQUIREMENT_REF_PATTERN.test(binding.requirement_ref)
      && Number.isInteger(binding.level)
      && binding.level >= 2
      && binding.level <= 4
      && /^[a-f0-9]{64}$/u.test(binding.semantic_claim_hash)
      && /^[a-f0-9]{64}$/u.test(binding.capability_spec_hash)
      && binding.required_claim.length >= 16
      && binding.required_claim.length <= 2_000
      && /^[a-z][a-z0-9_]{1,159}$/u.test(binding.required_content_tag)
      && /^[a-z][a-z0-9_]{1,159}$/u.test(binding.evidence_type)
    ));
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

function ownerRequestBinding(purpose, body = {}) {
  const { owner_context: _ownerContext, ...payload } = body;
  return `${purpose}\u0000${JSON.stringify(stableCanonical(payload))}`;
}

function verifyOwnerContextAssertion(context, secret, tenantId, expectedBinding, now = Date.now()) {
  if (!context || typeof context !== "object" || !secret) return false;
  if (context.assertion_version !== OWNER_CONTEXT_ASSERTION_VERSION) return false;
  if (context.audience !== "nira_core_bridge" || context.tenant_id !== tenantId) return false;
  const tenantOwner = context.role === "tenant_owner" && context.access_mode === "tenant_owner";
  const globalOwner = context.role === "owner_root" && context.access_mode === "god_mode";
  if (context.owner_verified !== true || (!tenantOwner && !globalOwner)) return false;
  const issuedAt = Date.parse(String(context.issued_at || ""));
  if (!Number.isFinite(issuedAt) || issuedAt > now + 30_000 || now - issuedAt > 120_000) return false;
  const supplied = String(context.assertion || "");
  if (!/^ocs_[a-f0-9]{64}$/i.test(supplied)) return false;
  if (expectedBinding !== undefined) {
    if (context.binding_version !== "owner_request_binding_v1") return false;
    const suppliedBindingHash = String(context.binding_hash || "");
    const expectedBindingHash = crypto.createHash("sha256").update(String(expectedBinding)).digest("hex");
    if (!/^[a-f0-9]{64}$/i.test(suppliedBindingHash)) return false;
    if (!crypto.timingSafeEqual(Buffer.from(suppliedBindingHash), Buffer.from(expectedBindingHash))) return false;
  }
  const expected = `ocs_${crypto.createHmac("sha256", secret)
    .update(`owner-context\u0000${ownerContextCanonical(context)}`)
    .digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function verifiedOwnerBranchProfile(req, requestedBranches = [], purpose = "", ownerContextSigningSecret = "", bindingBody) {
  const encodedHeader = String(req.get?.("x-sh-owner-context") || "").trim();
  let headerContext = null;
  if (encodedHeader && /^[A-Za-z0-9_-]{16,12000}$/.test(encodedHeader)) {
    try { headerContext = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")); } catch { headerContext = null; }
  }
  // Transport-authenticated MCP headers take precedence. A caller-supplied
  // body object must never shadow a valid request-bound owner assertion.
  const context = headerContext || req.body?.owner_context;
  const body = bindingBody || (req.body && typeof req.body === "object" ? req.body : {});
  const expectedBinding = purpose ? ownerRequestBinding(purpose, body) : undefined;
  const ownerVerified =
    req.tenantId === "codexai" &&
    context?.role === "owner_root" &&
    context?.access_mode === "god_mode" &&
    ["oauth", "codex"].includes(context?.delegated_actor) &&
    /^osf_[a-f0-9]{64}$/i.test(String(context?.owner_subject_fingerprint || "")) &&
    verifyOwnerContextAssertion(context, ownerContextSigningSecret, req.tenantId, expectedBinding);
  const commercialResolution = resolveBranchesForKey(req.coreKey, requestedBranches);
  return resolveOwnerTenantBranchProfile({
    tenantId: req.tenantId,
    ownerVerified,
    registry: branchRegistry(),
    groups: deterministicBranchGroups(),
    requestedBranches,
    commercialResolution,
  }) || commercialResolution;
}

function verifiedOwnerAdvisoryActivation(req, purpose, ownerContextSigningSecret, bindingBody) {
  const resolution = verifiedOwnerBranchProfile(
    req,
    [],
    purpose,
    ownerContextSigningSecret,
    bindingBody,
  );
  return resolution.owner_profile === "tenant_scoped_verified_owner"
    ? resolution.advisory_activation
    : null;
}

// A signed owner context is intentionally short-lived, but a short lifetime
// alone does not make it one-use. Prefer the vault's PostgreSQL-backed
// implementation; the file fallback is an atomic, persistent guard for test
// doubles and single-instance local deployments. It stores only assertion
// hashes, never owner payloads or provider credentials.
function createOwnerExecutionApprovalStore({ root, credentialStore }) {
  const fallbackRoot = path.join(root, "owner-execution-approvals");
  return {
    async consume({ tenant_id, approval_hash, expires_at }) {
      if (typeof credentialStore?.consumeOpenAiExecutionApproval === "function") {
        return credentialStore.consumeOpenAiExecutionApproval({ tenant_id, approval_hash, expires_at });
      }
      const tenantHash = crypto.createHash("sha256").update(String(tenant_id)).digest("hex");
      const approvalHash = String(approval_hash || "");
      if (!/^sha256:[a-f0-9]{64}$/i.test(approvalHash)) throw new Error("approval_hash_invalid");
      const expiry = Date.parse(String(expires_at || ""));
      if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("approval_expired");
      const file = path.join(fallbackRoot, tenantHash, `${approvalHash.slice("sha256:".length)}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const write = () => {
        const descriptor = fs.openSync(file, "wx", 0o600);
        try { fs.writeFileSync(descriptor, JSON.stringify({ expires_at: new Date(expiry).toISOString() }), "utf8"); }
        finally { fs.closeSync(descriptor); }
      };
      try {
        write();
        return { consumed: true };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        try {
          const existing = JSON.parse(fs.readFileSync(file, "utf8"));
          if (Date.parse(String(existing?.expires_at || "")) <= Date.now()) {
            fs.unlinkSync(file);
            write();
            return { consumed: true };
          }
        } catch (readError) {
          if (readError?.code === "ENOENT") {
            try { write(); return { consumed: true }; } catch {}
          }
        }
        return { consumed: false };
      }
    },
  };
}

function verifyMcpTenantContextAssertion(value, secret, tenantId, now = Date.now()) {
  if (!secret) return false;
  let context;
  try { context = JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8")); } catch { return false; }
  if (!context || context.version !== "mcp_tenant_context_v1" || context.tenant_id !== tenantId) return false;
  const issuedAt = Date.parse(String(context.issued_at || ""));
  if (!Number.isFinite(issuedAt) || issuedAt > now + 30_000 || now - issuedAt > 120_000) return false;
  const canonical = JSON.stringify({ version: context.version, tenant_id: context.tenant_id, issued_at: context.issued_at });
  const expected = `mtc_${crypto.createHmac("sha256", secret).update(`mcp-tenant-context\u0000${canonical}`).digest("hex")}`;
  return typeof context.assertion === "string" && context.assertion.length === expected.length && crypto.timingSafeEqual(Buffer.from(context.assertion), Buffer.from(expected));
}

function hasProviderSetupOwnerContext(context) {
  return context?.delegated_actor === "oauth" &&
    PROVIDER_SETUP_LINK_OWNER_SUBJECT_PATTERN.test(String(context?.owner_subject_fingerprint || ""));
}

function isDedicatedProviderSetupLinkIssuer(keyRecord, tenantId) {
  return Boolean(
    keyRecord &&
    keyRecord.tenant_id === tenantId &&
    keyRecord.key_type === "connector" &&
    keyRecord.status === "active" &&
    keyRecord.expires_at === null &&
    keyRecord.preset === null &&
    keyRecord.brand_scope === "" &&
    keyRecord.metadata?.bootstrap_kind === PROVIDER_SETUP_LINK_ISSUER_KIND &&
    Array.isArray(keyRecord.allowed_scopes) &&
    keyRecord.allowed_scopes.length === 1 &&
    keyRecord.allowed_scopes[0] === SCOPES.WRITE_PROVIDER_SETUP_LINK
  );
}

function isProviderSetupLinkIssuer(keyRecord, tenantId) {
  return isDedicatedProviderSetupLinkIssuer(keyRecord, tenantId) || isProviderSetupLinkServiceRecord(keyRecord);
}

function trustedProviderSetupBaseUrl(value) {
  const raw = String(value || TRUSTED_PROVIDER_SETUP_ORIGIN).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("provider_setup_public_url_invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== TRUSTED_PROVIDER_SETUP_ORIGIN ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("provider_setup_public_url_invalid");
  }
  return parsed.origin;
}

function sameDigest(left, right) {
  const actual = String(left || "");
  const expected = String(right || "");
  if (!/^pslb_[a-f0-9]{64}$/i.test(actual) || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function readSecret(req) {
  const auth = req.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.get("x-sh-core-key") || req.get("x-api-key") || "";
}

function publicError(res, status, code, message = code) {
  return res.status(status).json({ ok: false, error: code, message });
}

function providerSetupHtml(res, status, html, { scriptNonce = "" } = {}) {
  const scriptPolicy = scriptNonce ? `; script-src 'nonce-${scriptNonce}'` : "";
  return res
    .status(status)
    .set({
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": `default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; style-src 'unsafe-inline'${scriptPolicy}`,
    })
    .type("html")
    .send(html);
}

function validProviderSetupToken(value) {
  const token = String(value || "").trim();
  return /^[A-Za-z0-9_-]{30,120}$/.test(token) ? token : "";
}

function validProviderSetupProof(value) {
  const proof = String(value || "").trim();
  return /^[A-Za-z0-9_-]{32,120}$/.test(proof) ? proof : "";
}

function escapeProviderSetupHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function providerSetupFormHtml(scriptNonce, { setupProof = "", errorMessage = "" } = {}) {
  const safeProof = escapeProviderSetupHtml(validProviderSetupProof(setupProof));
  const safeError = escapeProviderSetupHtml(errorMessage);
  return `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collega OpenAI</title><body style="font-family:system-ui;max-width:560px;margin:48px auto;padding:24px"><h1>Collega OpenAI</h1><p>Inserisci una API key personale. Non è il tuo abbonamento ChatGPT. Verrà cifrata e non mostrata di nuovo.</p><form method="post" id="provider-setup-form"><input type="hidden" name="setup_proof" id="setup-proof" value="${safeProof}"><label>API key<input name="api_key" type="password" autocomplete="new-password" required style="display:block;width:100%;margin:8px 0 16px;padding:12px"></label><button type="submit" id="submit">Collega in modo sicuro</button></form><p id="link-error" role="alert">${safeError}</p><script nonce="${scriptNonce}">(function(){const input=document.getElementById("setup-proof");const fragmentProof=new URLSearchParams(location.hash.slice(1)).get("proof")||"";const proof=input.value||fragmentProof;const button=document.getElementById("submit");const error=document.getElementById("link-error");if(!/^[A-Za-z0-9_-]{32,120}$/.test(proof)){input.disabled=true;button.disabled=true;error.textContent="Link incompleto. Torna a ChatGPT e apri di nuovo il collegamento sicuro.";return;}input.value=proof;history.replaceState(null,document.title,location.pathname);})();</script></body></html>`;
}

function providerSetupLinkBootstrapErrorCode(error) {
  const code = error instanceof Error ? error.message : "";
  return new Set([
    "provider_setup_link_key_required",
    "provider_setup_link_tenant_required",
    "provider_setup_link_key_conflict",
    "provider_setup_link_key_rotation_required",
    "mcp_tenant_gateway_key_required",
    "mcp_tenant_gateway_key_weak",
    "mcp_tenant_gateway_key_conflict",
    "mcp_tenant_gateway_key_rotation_required",
  ]).has(code)
    ? code
    : "provider_setup_link_bootstrap_unavailable";
}

// This status is intentionally coarse because /healthz is public. It is only
// enough to distinguish an absent binding from a persistent-key conflict; it
// never includes a tenant id, secret, hash, or the underlying storage error.
function getProviderSetupLinkBootstrapState({ key, tenantId, configured, error } = {}) {
  if (configured === true) return "ready";
  const hasKey = Boolean(key);
  const hasTenant = Boolean(tenantId);
  if (!hasKey && !hasTenant) return "incomplete";
  if (!hasKey && hasTenant) return "binding_missing";
  if (hasKey && !hasTenant) return "incomplete";

  const code = providerSetupLinkBootstrapErrorCode(error);
  if (code === "provider_setup_link_key_conflict" || code === "provider_setup_link_key_rotation_required") {
    return "binding_conflict";
  }
  if (code === "provider_setup_link_key_required") return "binding_missing";
  if (code === "provider_setup_link_tenant_required") return "incomplete";
  return "unavailable";
}

function readJsonFile(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, file);
}

function normalizeList(value, max = 100) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => String(item || "").trim()).filter(Boolean);
}

function safeTenantId(req, keyRecord) {
  const tenantFromBody = req.body?.tenant_id || req.body?.context?.tenant_id || req.body?.core_input?.context?.tenant_id;
  const tenantFromQuery = req.query?.tenant_id;
  const tenantFromHeader = req.get("x-sh-tenant-id");
  return String(tenantFromBody || tenantFromQuery || tenantFromHeader || keyRecord?.tenant_id || "").trim();
}

function sanitizeMemoryText(value, max = 2_000) {
  return String(value || "")
    .slice(0, max)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED_SECRET]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}

function outcomeContainsSensitiveContent(body = {}) {
  if (body.contains_secret === true || body.contains_customer_data === true) return true;
  const values = [body.outcome_id, body.prediction_id, body.domain, body.horizon, body.notes, ...(Array.isArray(body.lessons) ? body.lessons : [])];
  return values.some((value) => {
    const raw = String(value ?? "");
    return raw.length > 2_000 || sanitizeMemoryText(raw, 2_000) !== raw;
  });
}

function normalizeTenantMemoryContext(raw, tenantId) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "memory_context_invalid" };
  if (String(raw.tenant_id || "") !== tenantId) return { ok: false, error: "memory_context_tenant_mismatch" };
  const list = (value, max) => Array.isArray(value) ? value.slice(0, max).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    return {
      id: sanitizeMemoryText(item.id, 100),
      kind: sanitizeMemoryText(item.kind, 40),
      title: sanitizeMemoryText(item.title, 240),
      summary: sanitizeMemoryText(item.summary ?? item.value, 2_000),
      direction: ["support", "against"].includes(String(item.direction || "").toLowerCase())
        ? String(item.direction).toLowerCase()
        : undefined,
      strength: Number.isFinite(Number(item.strength)) ? Math.max(0, Math.min(1, Number(item.strength))) : undefined,
      reliability: Number.isFinite(Number(item.reliability)) ? Math.max(0, Math.min(1, Number(item.reliability))) : undefined,
      verified: item.verified === true || item.status === "verified",
      source: item.source ? sanitizeMemoryText(item.source, 240) : undefined,
      decisions: normalizeList(item.decisions, 10).map((entry) => sanitizeMemoryText(entry, 500)),
      outcomes: normalizeList(item.outcomes, 10).map((entry) => sanitizeMemoryText(entry, 500)),
      next_steps: normalizeList(item.next_steps, 10).map((entry) => sanitizeMemoryText(entry, 500)),
      project_id: item.project_id ? sanitizeMemoryText(item.project_id, 64) : null,
      session_id: item.session_id ? sanitizeMemoryText(item.session_id, 64) : null,
      to_agent_id: item.to_agent_id ? sanitizeMemoryText(item.to_agent_id, 64) : undefined,
      status: item.status ? sanitizeMemoryText(item.status, 40) : undefined,
      created_at: sanitizeMemoryText(item.created_at, 40),
    };
  }).filter(Boolean) : [];
  const latest = list(raw.latest_checkpoint ? [raw.latest_checkpoint] : [], 1)[0] || null;
  return {
    ok: true,
    value: {
      schema_version: "tenant_memory_context_v1",
      tenant_id: tenantId,
      revision: Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
      project_id: raw.project_id ? sanitizeMemoryText(raw.project_id, 64) : null,
      session_id: raw.session_id ? sanitizeMemoryText(raw.session_id, 64) : null,
      latest_checkpoint: latest,
      relevant_memories: list(raw.relevant_memories, 10),
      pending_handoffs: list(raw.pending_handoffs, 10),
      recent_activity: list(raw.recent_activity, 20),
      policy: {
        tenant_isolated: true,
        raw_prompts_stored_automatically: false,
        secrets_storable: false,
      },
    },
  };
}

function normalizeTenantWorkGalleryContext(raw, tenantId) {
  if (raw === undefined || raw === null) {
    return {
      ok: true,
      value: {
        schema_version: "tenant_work_gallery_v1",
        tenant_id: tenantId,
        available: false,
        state: "runtime_unavailable",
        work_count: 0,
        works: [],
      },
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "gallery_context_invalid" };
  }
  if (String(raw.tenant_id || "") !== tenantId) {
    return { ok: false, error: "gallery_context_tenant_mismatch" };
  }
  const works = Array.isArray(raw.works) ? raw.works.slice(0, 20).map((work) => {
    if (!work || typeof work !== "object" || Array.isArray(work)) return null;
    return {
      work_id: sanitizeMemoryText(work.work_id, 64),
      project_id: sanitizeMemoryText(work.project_id, 64),
      status: sanitizeMemoryText(work.status, 40),
      current_version: Number.isInteger(Number(work.current_version))
        ? Math.max(0, Number(work.current_version))
        : 0,
      next_action: sanitizeMemoryText(work.next_action, 500),
      updated_at: sanitizeMemoryText(work.updated_at, 40),
      active_participants: Math.max(0, Number(work.active_participants || 0)),
      active_leases: Math.max(0, Number(work.active_leases || 0)),
      active_branches: Math.max(0, Number(work.active_branches || 0)),
    };
  }).filter((work) => work?.work_id) : [];
  return {
    ok: true,
    value: {
      schema_version: "tenant_work_gallery_v1",
      tenant_id: tenantId,
      available: raw.available === true,
      state: ["ready", "membership_required", "runtime_unavailable"].includes(String(raw.state || ""))
        ? String(raw.state)
        : "runtime_unavailable",
      generated_at: sanitizeMemoryText(raw.generated_at, 40) || null,
      work_count: works.length,
      filters: {
        project_id: raw.filters?.project_id ? sanitizeMemoryText(raw.filters.project_id, 64) : null,
        status: raw.filters?.status ? sanitizeMemoryText(raw.filters.status, 40) : null,
      },
      works,
    },
  };
}

function normalizeSignal(input = {}) {
  const score = Number(input.normalized_score ?? input.score ?? input.value ?? 50);
  return {
    id: String(input.id || input.key || `signal_${crypto.randomUUID()}`),
    source: String(input.source || "universal_core_service"),
    category: String(input.category || "custom"),
    label: String(input.label || input.id || "Segnale operativo"),
    value: Number(input.value ?? score),
    normalized_score: Math.max(0, Math.min(100, score)),
    severity_hint: input.severity_hint === undefined ? Math.max(0, Math.min(100, score)) : Number(input.severity_hint),
    confidence_hint: input.confidence_hint === undefined ? 70 : Number(input.confidence_hint),
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
  };
}

function buildCoreInput(req, keyRecord) {
  if (req.body?.core_input) {
    const input = req.body.core_input;
    return {
      ...input,
      context: {
        ...(input.context || {}),
        tenant_id: safeTenantId(req, keyRecord),
      },
      constraints: safeConstraints(input.constraints, keyRecord, req.body?.owner_confirmed === true),
    };
  }

  const signals = Array.isArray(req.body?.signals) ? req.body.signals.map(normalizeSignal) : [];
  return {
    request_id: req.body?.request_id || `req_${crypto.randomUUID()}`,
    generated_at: nowIso(),
    domain: req.body?.domain || "custom",
    context: {
      tenant_id: safeTenantId(req, keyRecord),
      actor_id: req.body?.actor_id || undefined,
      plan: req.body?.plan || undefined,
      locale: req.body?.locale || "it",
      metadata: typeof req.body?.metadata === "object" && req.body.metadata ? req.body.metadata : {},
    },
    signals,
    data_quality: {
      score: Number(req.body?.data_quality?.score ?? req.body?.data_quality_score ?? 70),
      completeness: req.body?.data_quality?.completeness,
      freshness: req.body?.data_quality?.freshness,
      consistency: req.body?.data_quality?.consistency,
      reliability: req.body?.data_quality?.reliability,
      missing_fields: Array.isArray(req.body?.data_quality?.missing_fields) ? req.body.data_quality.missing_fields : [],
    },
    constraints: safeConstraints(req.body?.constraints, keyRecord, req.body?.owner_confirmed === true),
  };
}

function buildActionEvaluatorInput(req, keyRecord) {
  const body = req.body || {};
  const actionType = String(body.action_type || body.action?.type || body.domain || "workflow_decision");
  const actionLabel = String(body.action_label || body.action?.label || body.task || actionType);
  const riskClassification = classifyActionRisk(body);
  const riskHint = Number(body.risk_hint ?? body.action?.risk_hint ?? riskClassification.risk_score);
  const confidenceHint = Number(body.confidence_hint ?? body.action?.confidence_hint ?? 85);
  const publishIntent = body.publish_intent === true || actionType === "publish";
  const blockedActionRules = [
    ...(Array.isArray(body.constraints?.blocked_action_rules) ? body.constraints.blocked_action_rules : []),
    ...riskClassification.reason_codes.map((reasonCode) => ({
      action_id: `action:${actionType}`,
      reason_code: reasonCode,
      severity: riskClassification.risk_score,
      blocks_execution: riskClassification.hard_block,
    })),
  ];

  return {
    request_id: body.request_id || `action_${crypto.randomUUID()}`,
    generated_at: nowIso(),
    domain: body.domain || "action_evaluator",
    context: {
      tenant_id: safeTenantId(req, keyRecord),
      actor_id: body.actor_id || undefined,
      plan: body.plan || undefined,
      locale: body.locale || "it",
      metadata: {
        action_type: actionType,
        action_classification: riskClassification.classification,
        operation_class: riskClassification.operation_class,
        publish_intent: publishIntent ? "true" : "false",
        source: "action_evaluator",
        ...(typeof body.remediation_context === "object" && body.remediation_context
          ? { remediation_context: body.remediation_context }
          : {}),
        ...(typeof body.metadata === "object" && body.metadata ? body.metadata : {}),
      },
    },
    signals: [
      normalizeSignal({
        id: `action:${actionType}`,
        category: riskClassification.classification,
        label: actionLabel,
        normalized_score: riskClassification.risk_score,
        severity_hint: riskClassification.risk_score,
        confidence_hint: confidenceHint,
        evidence: Array.isArray(body.evidence) ? body.evidence : [
          { label: "Azione richiesta dal client", value: actionType },
          { label: "Classificazione deterministica", value: riskClassification.classification },
        ],
        tags: ["action_gate", actionType, riskClassification.classification],
      }),
    ],
    data_quality: {
      score: Number(body.data_quality?.score ?? body.data_quality_score ?? 80),
      missing_fields: Array.isArray(body.data_quality?.missing_fields) ? body.data_quality.missing_fields : [],
    },
    constraints: safeConstraints({
      ...(typeof body.constraints === "object" && body.constraints ? body.constraints : {}),
      require_confirmation: riskClassification.confirmation_required,
      max_control_level: riskClassification.control_level,
      risk_floor: riskClassification.risk_band,
      passive_only: ["tenant_scoped_read", "sandboxed_scoped_work"].includes(riskClassification.operation_class),
      blocked_action_rules: blockedActionRules,
      safety_mode: riskClassification.control_level !== "observe",
    }, keyRecord, body.owner_confirmed === true),
  };
}

function safeConstraints(raw = {}, keyRecord, ownerConfirmed) {
  const automationAllowed = Boolean(
    raw.allow_automation === true &&
      ownerConfirmed &&
      hasScope(keyRecord, SCOPES.AUTOMATION_CODEX)
  );
  const passiveOnly = raw.passive_only === true && raw.allow_automation !== true;

  return {
    allow_automation: automationAllowed,
    require_confirmation: raw.require_confirmation !== false,
    max_control_level: automationAllowed ? raw.max_control_level || "confirm" : passiveOnly ? "observe" : "confirm",
    min_control_level: raw.min_control_level,
    state_floor: raw.state_floor,
    risk_floor: raw.risk_floor,
    blocked_actions: Array.isArray(raw.blocked_actions) ? raw.blocked_actions : [],
    blocked_action_rules: Array.isArray(raw.blocked_action_rules) ? raw.blocked_action_rules : [],
    allowed_actions: Array.isArray(raw.allowed_actions) ? raw.allowed_actions : [],
    permissions: Array.isArray(raw.permissions) ? raw.permissions : keyRecord?.allowed_scopes || [],
    safety_mode: raw.safety_mode !== false,
  };
}

function requireAdmin(req, res, next) {
  const configured = process.env.CORE_SERVICE_ADMIN_KEY;
  const devKey = process.env.NODE_ENV === "production" ? "" : "dev-core-admin-key";
  const adminKey = configured || devKey;
  if (!adminKey) return publicError(res, 503, "admin_key_not_configured");
  if (readSecret(req) !== adminKey) return publicError(res, 401, "admin_key_invalid");
  return next();
}

function createAuth(keyStore, audit, requiredScope, {
  allowProviderSetupService = false,
  tenantContextSigningSecret = "",
  requireWorkPreflight = false,
  requireWorkPreflightExecution = false,
} = {}) {
  return (req, res, next) => {
    const auth = keyStore.authenticate(readSecret(req));
    if (!auth.ok) {
      audit.append("core_auth_failed", { error: auth.error, path: req.path });
      return publicError(res, 401, auth.error);
    }

    const tenantId = safeTenantId(req, auth.record);
    const serviceIssuer = allowProviderSetupService === true && isProviderSetupLinkServiceRecord(auth.record);
    const tenantGateway = isMcpTenantGatewayRecord(auth.record);
    const validGatewayContext = tenantGateway && verifyMcpTenantContextAssertion(
      req.get("x-sh-tenant-context"),
      tenantContextSigningSecret,
      tenantId,
    );
    if (!tenantId || (!serviceIssuer && !validGatewayContext && !requireTenantAccess(auth.record, tenantId))) {
      audit.append("core_tenant_scope_denied", { key_id: auth.record.key_id, requested_tenant: tenantId, path: req.path });
      return publicError(res, 403, "tenant_scope_denied");
    }

    const requiredScopes = Array.isArray(requiredScope) ? requiredScope : [requiredScope].filter(Boolean);
    if (requiredScopes.length && !requiredScopes.some((scope) => hasScope(auth.record, scope))) {
      audit.append("core_scope_denied", { key_id: auth.record.key_id, required_scopes: requiredScopes, path: req.path });
      return publicError(res, 403, "scope_denied", `Required scope: ${requiredScopes.join(" or ")}`);
    }

    req.coreKey = auth.record;
    req.tenantId = tenantId || auth.record.tenant_id;
    if (requireWorkPreflight) {
      const gate = validateWorkPreflightEnvelope(req.body || {}, req.tenantId, {
        requireGallery: true,
        requireMemory: true,
        requireExecution: requireWorkPreflightExecution,
      });
      if (!gate.ok) {
        audit.append("core_work_preflight_gate_denied", {
          tenant_id: req.tenantId,
          key_id: auth.record.key_id,
          path: req.path,
          reason_codes: gate.errors,
        });
        const failure = workPreflightFailure(gate.errors);
        return res.status(428).json({
          ok: false,
          error: failure.code,
          reason_codes: failure.reason_codes,
          execution_allowed: false,
        });
      }
      req.workPreflight = gate.preflight;
    }
    return next();
  };
}

const CAUSAL_WRITE_TRANSPORT_SCOPES = Object.freeze([
  "causal:write",
  "causal:authorize",
  "causal:approve",
  "causal:evidence",
  "causal:reconcile",
  "causal:close",
  "causal:reopen",
  "causal:intent:propose",
  "causal:intent:approve",
  "causal:change:create",
  "causal:change:execute",
  "causal:evidence:produce",
  "causal:outcome:reconcile",
  "causal:obligation:close",
  "causal:rollout",
  "gallery:project",
  "core:govern",
]);

export function causalRouteAuthenticatedScopes(requiredScope, keyRecord = {}) {
  const required = String(requiredScope || "").trim();
  const platformScopes = Array.isArray(keyRecord.allowed_scopes) ? keyRecord.allowed_scopes : [];
  const mapped = required === "causal:read"
    ? ["causal:read"]
    : [required, ...CAUSAL_WRITE_TRANSPORT_SCOPES];
  if (platformScopes.includes(SCOPES.OWNER_ASSERTION)) mapped.push("intent:approve:strategic");
  return [...new Set(mapped.filter(Boolean))].sort();
}

export function createPostgresCausalActionLeaseVerifier(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("causal_action_lease_pool_required");
  }
  return async (input) => {
    if (Object.prototype.hasOwnProperty.call(input, "policy_session_fingerprint")) return null;
    const requestingSessionFingerprint = String(input.actor_session_fingerprint || "");
    if (!/^[a-f0-9]{16,64}$/i.test(requestingSessionFingerprint)) return null;
    const leaseResult = await pool.query(
      `SELECT l.lease_id,l.tenant_id,l.work_id,l.purpose,l.status,l.expires_at,
              l.policy_authority_scope,l.policy_authority_source,l.policy_authority_binding_digest,
              l.policy_session_fingerprint,
              w.project_uuid,p.agent_id,
              coalesce(jsonb_agg(jsonb_build_object('kind',s.surface_kind,'value',s.surface_value)
                ORDER BY s.surface_kind,s.surface_value)
                FILTER (WHERE s.surface_kind IS NOT NULL),'[]'::jsonb) AS surfaces
         FROM core_continuity_leases l
         JOIN core_continuity_works w
           ON w.tenant_id=l.tenant_id AND w.work_id=l.work_id
         JOIN core_continuity_participants p
           ON p.tenant_id=l.tenant_id AND p.work_id=l.work_id AND p.session_id=l.session_id
         LEFT JOIN core_continuity_lease_surfaces s
           ON s.tenant_id=l.tenant_id AND s.work_id=l.work_id AND s.lease_id=l.lease_id
        WHERE l.tenant_id=$1 AND l.work_id=$2 AND l.lease_id=$3
          AND l.status='active' AND l.expires_at>now()
          AND l.policy_session_fingerprint=$6
          AND p.status='active' AND p.expires_at>now()
          AND p.agent_id=$4 AND w.project_uuid=$5
        GROUP BY l.lease_id,l.tenant_id,l.work_id,l.purpose,l.status,l.expires_at,
          l.policy_authority_scope,l.policy_authority_source,l.policy_authority_binding_digest,
          l.policy_session_fingerprint,w.project_uuid,p.agent_id`,
      [input.tenant_id, input.work_id, input.lease_id, input.actor_id, input.project_id, requestingSessionFingerprint],
    );
    const lease = leaseResult.rows[0];
    if (!lease) return null;
    const surfaces = Array.isArray(lease.surfaces) ? lease.surfaces : [];
    const valuesFor = (kind) => surfaces
      .filter((surface) => surface?.kind === kind)
      .map((surface) => String(surface.value || "").toLowerCase())
      .sort();
    const expectedObligations = [...new Set((input.obligation_ids || []).map((value) => String(value).toLowerCase()))].sort();
    const projectSurfaces = valuesFor("causal_project");
    const changeSurfaces = valuesFor("causal_change");
    const obligationSurfaces = valuesFor("causal_obligation");
    if (surfaces.length !== 2 + expectedObligations.length ||
        projectSurfaces.length !== 1 || projectSurfaces[0] !== String(input.project_id).toLowerCase() ||
        changeSurfaces.length !== 1 || changeSurfaces[0] !== String(input.change_id).toLowerCase() ||
        JSON.stringify(obligationSurfaces) !== JSON.stringify(expectedObligations)) {
      return null;
    }
    const bindingResult = await pool.query(
      `SELECT c.change_id,array_agg(o.obligation_id ORDER BY o.obligation_id) AS obligation_ids
         FROM core_changes c
         JOIN core_causal_obligations o
           ON o.tenant_id=c.tenant_id AND o.project_id=c.project_id
          AND o.work_id=c.work_id AND o.change_id=c.change_id
        WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.work_id=$3 AND c.change_id=$4
          AND o.obligation_id=ANY($5::uuid[])
        GROUP BY c.change_id`,
      [input.tenant_id, input.project_id, input.work_id, input.change_id, input.obligation_ids],
    );
    const binding = bindingResult.rows[0];
    if (!binding || binding.obligation_ids.length !== input.obligation_ids.length) return null;
    const persistedAuthorityScope = Array.isArray(lease.policy_authority_scope)
      ? [...lease.policy_authority_scope].map(String).sort()
      : [];
    const authorityProof = {
      schema_version: "persisted_lease_authority_v1", tenant_id: lease.tenant_id, lease_id: lease.lease_id,
      actor_id: lease.agent_id, purpose: lease.purpose, surfaces,
      persisted_authority_scope: persistedAuthorityScope,
      policy_session_fingerprint: requestingSessionFingerprint,
    };
    if (lease.policy_session_fingerprint !== requestingSessionFingerprint ||
        lease.policy_authority_binding_digest !== causalDigest(authorityProof)) return null;
    return {
      valid: true,
      readback_verified: true,
      active: lease.status === "active",
      replayed: false,
      consumed: false,
      revoked: false,
      tenant_id: lease.tenant_id,
      project_id: lease.project_uuid,
      work_id: lease.work_id,
      change_id: binding.change_id,
      obligation_ids: binding.obligation_ids,
      lease_id: lease.lease_id,
      actor_id: lease.agent_id,
      purpose: lease.purpose,
      status: lease.status,
      surfaces,
      persisted_authority_scope: persistedAuthorityScope,
      policy_session_fingerprint: lease.policy_session_fingerprint,
      authority_source: lease.policy_authority_source,
      authority_binding_digest: lease.policy_authority_binding_digest,
      expires_at: lease.expires_at,
      provenance: "core_continuity_lease_postgres_readback_v1",
    };
  };
}

function snapshotStore(storageRoot) {
  const dir = path.join(storageRoot, "snapshots");
  ensureDir(dir);
  const fileForTenant = (tenantId) => path.join(dir, `${tenantId}.json`);

  return {
    append(tenantId, source, payload) {
      const file = fileForTenant(tenantId);
      const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
      const record = { snapshot_id: `snap_${crypto.randomUUID()}`, tenant_id: tenantId, source, created_at: nowIso(), payload };
      current.push(record);
      fs.writeFileSync(file, JSON.stringify(current.slice(-200), null, 2), "utf8");
      return record;
    },
    latest(tenantId) {
      const file = fileForTenant(tenantId);
      if (!fs.existsSync(file)) return null;
      const current = JSON.parse(fs.readFileSync(file, "utf8"));
      return current[current.length - 1] || null;
    },
  };
}

function reviewStore(storageRoot) {
  const file = path.join(storageRoot, "reviews", "queue.json");
  ensureDir(path.dirname(file));
  const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : []);
  const write = (rows) => fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
  return {
    pending(tenantId) {
      return read().filter((row) => row.tenant_id === tenantId && row.status === "pending");
    },
    action(tenantId, action) {
      const rows = read();
      const record = rows.find((row) => row.tenant_id === tenantId && row.review_id === action.review_id);
      if (!record) return null;
      record.status = action.status === "approved" ? "approved" : action.status === "rejected" ? "rejected" : "pending";
      record.owner_note = action.owner_note || "";
      record.updated_at = nowIso();
      write(rows);
      return record;
    },
    enqueue(tenantId, payload) {
      const rows = read();
      const record = { review_id: `review_${crypto.randomUUID()}`, tenant_id: tenantId, status: "pending", created_at: nowIso(), payload };
      rows.push(record);
      write(rows);
      return record;
    },
  };
}

function intelligenceOutcomeStore(storageRoot) {
  const dir = path.join(storageRoot, "intelligence", "outcomes");
  ensureDir(dir);
  const tenantHash = (tenantId) => crypto.createHash("sha256").update(String(tenantId)).digest("hex");
  const legacyFile = (tenantId) => path.join(dir, `${tenantHash(tenantId)}.json`);
  const tenantDir = (tenantId) => path.join(dir, tenantHash(tenantId));
  const recordFile = (tenantId, outcomeId) => path.join(
    tenantDir(tenantId),
    `${crypto.createHash("sha256").update(String(outcomeId)).digest("hex")}.json`,
  );
  const compare = (existing, candidate) => {
    const fields = ["prediction_id", "predicted_probability", "actual_outcome", "domain", "horizon"];
    return fields.some((field) => String(existing[field] ?? "") !== String(candidate[field] ?? ""));
  };
  const read = (tenantId) => {
    const legacy = readJsonFile(legacyFile(tenantId), []);
    const currentDir = tenantDir(tenantId);
    const current = fs.existsSync(currentDir)
      ? fs.readdirSync(currentDir).filter((name) => name.endsWith(".json")).map((name) =>
        readJsonFile(path.join(currentDir, name), null)).filter(Boolean)
      : [];
    const byOutcome = new Map();
    for (const record of [...legacy, ...current]) byOutcome.set(record.outcome_id, record);
    return [...byOutcome.values()].sort((a, b) => String(a.verified_at).localeCompare(String(b.verified_at))).slice(-10_000);
  };
  return {
    append(tenantId, record) {
      const storedRecord = { ...record, tenant_id: tenantId };
      const legacyDuplicate = readJsonFile(legacyFile(tenantId), []).find((item) => item.outcome_id === record.outcome_id);
      if (legacyDuplicate) {
        const conflict = compare(legacyDuplicate, storedRecord);
        return { record: legacyDuplicate, duplicate: !conflict, conflict };
      }
      const file = recordFile(tenantId, record.outcome_id);
      ensureDir(path.dirname(file));
      try {
        fs.writeFileSync(file, JSON.stringify(storedRecord, null, 2), { encoding: "utf8", flag: "wx" });
        return { record: storedRecord, duplicate: false, conflict: false };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = readJsonFile(file, null);
        if (!existing) throw error;
        const conflict = compare(existing, storedRecord);
        return { record: existing, duplicate: !conflict, conflict };
      }
    },
    recent(tenantId, limit = 100) {
      return read(tenantId).slice(-Math.max(1, Math.min(1000, Number(limit) || 100)));
    },
    calibration(tenantId) {
      return summarizeCalibration(read(tenantId));
    },
  };
}

function evidenceStore(storageRoot) {
  const file = path.join(storageRoot, "evidence", "events.jsonl");
  ensureDir(path.dirname(file));
  const configuredSigningSecret = String(process.env.CORE_EVIDENCE_SIGNING_SECRET || "").trim();
  if (!configuredSigningSecret && process.env.NODE_ENV === "production") {
    throw new Error("CORE_EVIDENCE_SIGNING_SECRET is required in production");
  }
  const signingSecret = configuredSigningSecret || "dev-evidence-signing-secret";

  function sign(record) {
    return crypto.createHmac("sha256", signingSecret).update(JSON.stringify(record)).digest("hex");
  }

  function append(tenantId, eventType, payload = {}) {
    const record = {
      evidence_id: `ev_${crypto.randomUUID()}`,
      tenant_id: tenantId,
      event_type: eventType,
      created_at: nowIso(),
      payload,
    };
    const signature = sign(record);
    const signed = { ...record, signature, signature_alg: "hmac-sha256" };
    fs.appendFileSync(file, `${JSON.stringify(signed)}\n`, "utf8");
    return signed;
  }

  function recent(tenantId, limit = 50) {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(200, Number(limit) || 50)))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { event_type: "evidence_parse_error", raw: line };
        }
      })
      .filter((event) => !tenantId || event.tenant_id === tenantId);
  }

  return { append, recent };
}

function tenantRegistryStore(storageRoot) {
  const file = path.join(storageRoot, "tenants", "registry.json");
  const read = () => readJsonFile(file, []);
  const write = (rows) => writeJsonFile(file, rows);

  function normalizeTenant(input = {}) {
    const tenantId = String(input.tenant_id || input.id || "").trim();
    if (!tenantId) throw new Error("tenant_id_required");
    return {
      tenant_id: tenantId,
      label: String(input.label || input.name || tenantId).trim(),
      sector: String(input.sector || input.industry || "generic").trim(),
      lifecycle_state: String(input.lifecycle_state || input.status || "active").trim(),
      environment: String(input.environment || "production").trim(),
      brand_scope: String(input.brand_scope || "").trim(),
      parent_tenant_id: String(input.parent_tenant_id || "").trim() || null,
      allowed_domains: normalizeList(input.allowed_domains || input.domains, 50),
      active_branch_groups: normalizeList(input.active_branch_groups || input.branch_groups, 50),
      active_branches: normalizeList(input.active_branches || input.branches, 100),
      policy_profile: String(input.policy_profile || "default").trim(),
      notes: String(input.notes || "").trim(),
      updated_at: nowIso(),
    };
  }

  return {
    list() {
      return read();
    },
    get(tenantId) {
      return read().find((row) => row.tenant_id === tenantId) || null;
    },
    upsert(input = {}) {
      const normalized = normalizeTenant(input);
      const rows = read();
      const index = rows.findIndex((row) => row.tenant_id === normalized.tenant_id);
      if (index >= 0) {
        rows[index] = { ...rows[index], ...normalized, created_at: rows[index].created_at || nowIso() };
      } else {
        rows.push({ ...normalized, created_at: nowIso() });
      }
      write(rows);
      return rows.find((row) => row.tenant_id === normalized.tenant_id);
    },
  };
}

function entityGraphStore(storageRoot) {
  const file = path.join(storageRoot, "entity-graph", "graph.json");
  const empty = () => ({ entities: [], relations: [] });
  const read = () => readJsonFile(file, empty());
  const write = (graph) => writeJsonFile(file, {
    entities: Array.isArray(graph.entities) ? graph.entities : [],
    relations: Array.isArray(graph.relations) ? graph.relations : [],
  });

  function normalizeEntity(input = {}, tenantId = "") {
    const id = String(input.entity_id || input.id || "").trim() || `ent_${crypto.randomUUID()}`;
    return {
      entity_id: id,
      tenant_id: String(input.tenant_id || tenantId || "").trim(),
      entity_type: String(input.entity_type || input.type || "generic_entity").trim(),
      label: String(input.label || input.name || id).trim(),
      lifecycle_state: String(input.lifecycle_state || input.status || "active").trim(),
      risk_band: String(input.risk_band || "low").trim(),
      value_score: Number(input.value_score ?? 0),
      metadata: typeof input.metadata === "object" && input.metadata ? input.metadata : {},
      updated_at: nowIso(),
    };
  }

  function normalizeRelation(input = {}, tenantId = "") {
    const id = String(input.relation_id || input.id || "").trim() || `rel_${crypto.randomUUID()}`;
    return {
      relation_id: id,
      tenant_id: String(input.tenant_id || tenantId || "").trim(),
      from_entity_id: String(input.from_entity_id || input.from || "").trim(),
      to_entity_id: String(input.to_entity_id || input.to || "").trim(),
      relation_type: String(input.relation_type || input.type || "linked_to").trim(),
      policy_scope: String(input.policy_scope || "tenant").trim(),
      metadata: typeof input.metadata === "object" && input.metadata ? input.metadata : {},
      updated_at: nowIso(),
    };
  }

  return {
    readTenant(tenantId) {
      const graph = read();
      return {
        entities: graph.entities.filter((entity) => entity.tenant_id === tenantId),
        relations: graph.relations.filter((relation) => relation.tenant_id === tenantId),
      };
    },
    upsert(tenantId, payload = {}) {
      const graph = read();
      const entities = Array.isArray(payload.entities) ? payload.entities : payload.entity ? [payload.entity] : [];
      const relations = Array.isArray(payload.relations) ? payload.relations : payload.relation ? [payload.relation] : [];
      for (const rawEntity of entities) {
        const entity = normalizeEntity(rawEntity, tenantId);
        const index = graph.entities.findIndex((row) => row.tenant_id === entity.tenant_id && row.entity_id === entity.entity_id);
        if (index >= 0) graph.entities[index] = { ...graph.entities[index], ...entity };
        else graph.entities.push({ ...entity, created_at: nowIso() });
      }
      for (const rawRelation of relations) {
        const relation = normalizeRelation(rawRelation, tenantId);
        const index = graph.relations.findIndex((row) => row.tenant_id === relation.tenant_id && row.relation_id === relation.relation_id);
        if (index >= 0) graph.relations[index] = { ...graph.relations[index], ...relation };
        else graph.relations.push({ ...relation, created_at: nowIso() });
      }
      write(graph);
      return this.readTenant(tenantId);
    },
  };
}

function branchMaturityReport(advisoryActivation = null) {
  const registry = branchRegistry();
  const groups = deterministicBranchGroups();
  const activeAdvisory = new Set(Array.isArray(advisoryActivation?.active_branches) ? advisoryActivation.active_branches : []);
  const statuses = {};
  for (const [branchId, profile] of Object.entries(registry)) {
    const productionStatus = profile.production_status || "unknown";
    const maturity =
      productionStatus === "test_only"
        ? "test"
        : productionStatus === "advisory"
          ? "advisory"
          : productionStatus === "production"
            ? "production"
            : "pilot";
    statuses[branchId] = {
      branch_id: branchId,
      label: profile.label,
      domain: profile.domain,
      production_status: productionStatus,
      maturity,
      execution_default: maturity === "production" ? "confirm" : maturity === "advisory" ? "advisory_only" : "test_only",
      ...(activeAdvisory.has(branchId) ? {
        activation_state: "active_advisory",
        execution_authorized: false,
      } : {}),
      promotion_required: maturity === "production" ? [] : ["benchmark_pass", "owner_approval", "regression_test", "audit_sample"],
      enforcement_overlays: Array.isArray(profile.guardrails?.enforcement_overlays)
        ? profile.guardrails.enforcement_overlays.map((overlay) => ({ ...overlay }))
        : [],
    };
  }
  return {
    schema_version: "branch_maturity_v1",
    ...(advisoryActivation ? { advisory_activation: advisoryActivation } : {}),
    statuses,
    groups: Object.fromEntries(
      Object.entries(groups).map(([groupId, group]) => [
        groupId,
        {
          ...group,
          maturity_summary: group.branches.reduce((acc, branchId) => {
            const maturity = statuses[branchId]?.maturity || "unknown";
            acc[maturity] = (acc[maturity] || 0) + 1;
            return acc;
          }, {}),
        },
      ]),
    ),
  };
}

function buildEntitlement(keyRecord, branchResolution) {
  const metadata = keyRecord?.metadata && typeof keyRecord.metadata === "object" ? keyRecord.metadata : {};
  const limits = metadata.suite_limits && typeof metadata.suite_limits === "object" ? metadata.suite_limits : {};
  return {
    schema_version: "core_entitlement_v1",
    tenant_id: keyRecord?.tenant_id || "",
    key_id: keyRecord?.key_id || "",
    key_type: keyRecord?.key_type || "",
    tier: branchResolution.tier,
    status: keyRecord?.status || "unknown",
    expires_at: keyRecord?.expires_at || null,
    branch_groups: metadata.active_branch_groups || branchResolution.allowed_groups || [],
    branches: branchResolution.allowed_branches,
    scopes: keyRecord?.allowed_scopes || [],
    limits: {
      monthly_core_calls: Number(limits.monthly_core_calls ?? limits.core_calls ?? 0),
      codex_automation_runs: Number(limits.codex_automation_runs ?? 0),
      smartdesk_seats: Number(limits.smartdesk_seats ?? limits.seat_limit ?? 0),
      wordpress_nodes: Number(limits.wordpress_nodes ?? 1),
      runbook_executions: Number(limits.runbook_executions ?? 0),
    },
    environments: normalizeList(metadata.environments || ["production"], 10),
    soft_gate: metadata.suite_policy?.soft_gate !== false,
    hard_block: metadata.suite_policy?.hard_block === true,
    rule: "La key abilita perimetro, non proprieta globale: ogni azione resta scoped, auditata e mediata dal Core.",
  };
}

function buildBootstrapProfile({ keyRecord, tenant = null, tenantPolicy = null, branchResolution = null, entitlement = null }) {
  const metadata = keyRecord?.metadata && typeof keyRecord.metadata === "object" ? keyRecord.metadata : {};
  const resolvedBranches = branchResolution || resolveBranchesForKey(keyRecord);
  const resolvedEntitlement = entitlement || buildEntitlement(keyRecord, resolvedBranches);
  const resolvedTenantPolicy = tenantPolicy || getTenantPolicy(keyRecord?.tenant_id, metadata.tier || metadata.suite_tier, {
    brandScope: keyRecord?.brand_scope,
    metadata,
  });
  const domainPack = resolveDomainPackForKey(keyRecord);
  const maturity = branchMaturityReport();
  const registry = branchRegistry();
  const branchProfiles = Object.fromEntries(
    resolvedBranches.allowed_branches
      .map((branchId) => [branchId, registry[branchId]])
      .filter(([, profile]) => Boolean(profile)),
  );

  return {
    ok: true,
    schema_version: "core_bootstrap_profile_v1",
    generated_at: nowIso(),
    tenant: {
      tenant_id: keyRecord?.tenant_id || tenant?.tenant_id || "",
      label: tenant?.label || keyRecord?.tenant_id || "",
      sector: tenant?.sector || "generic",
      environment: tenant?.environment || metadata.environments?.[0] || "production",
      brand_scope: keyRecord?.brand_scope || tenant?.brand_scope || "",
      domains: Array.isArray(tenant?.domains) ? tenant.domains : [],
      nodes: Array.isArray(tenant?.nodes) ? tenant.nodes : [],
    },
    plan: {
      tier: resolvedEntitlement.tier,
      suite_tier: metadata.suite_tier || resolvedEntitlement.tier,
      modules: Array.isArray(metadata.suite_modules) ? metadata.suite_modules : [],
      status: keyRecord?.status || "unknown",
      expires_at: keyRecord?.expires_at || null,
    },
    branches: {
      selected: resolvedBranches.allowed_branches,
      denied: resolvedBranches.denied_branches || [],
      groups: resolvedEntitlement.branch_groups,
      profiles: branchProfiles,
      maturity: Object.fromEntries(
        resolvedBranches.allowed_branches
          .map((branchId) => [branchId, maturity.statuses[branchId]])
          .filter(([, status]) => Boolean(status)),
      ),
    },
    policy: {
      source: resolvedTenantPolicy.source,
      sensitive_domains: resolvedTenantPolicy.sensitive_domains || [],
      blocked_actions: resolvedTenantPolicy.blocked_actions || [],
      confirm_actions: resolvedTenantPolicy.confirm_actions || [],
      sandbox_actions: resolvedTenantPolicy.sandbox_actions || [],
      action_mediation_states: ["allow", "rewrite", "confirm", "defer", "sandbox", "block", "rollback_required"],
      rule: "AI e automazioni possono agire solo passando da Core, policy, audit, tenant isolation e conferma quando serve.",
    },
    domain_pack: publicDomainPack(domainPack),
    nyra_neural_network: {
      schema_version: "nyra_neural_branch_network_v1",
      governance: "core_opens_nyra_branches",
      catalog_endpoint: "GET /v1/nira/branches",
      maximum_subbranches_per_branch: 20,
      maximum_parallel_branches: 6,
      parallel_mode: "bounded_parallel_advisory",
      learning_mode: "tenant_scoped_verify_before_consolidate",
    },
    limits: resolvedEntitlement.limits,
    recommended_folders: {
      config: domainPack.id === "skinharmony" ? ".skinharmony-core/config" : ".universal-core/config",
      key: domainPack.id === "skinharmony" ? ".skinharmony-core/keys" : ".universal-core/keys",
      memory: domainPack.id === "skinharmony" ? ".skinharmony-core/memory" : ".universal-core/memory",
      reports: "reports/codex-core",
      policies: domainPack.id === "skinharmony" ? ".skinharmony-core/policies" : ".universal-core/policies",
      logs: domainPack.id === "skinharmony" ? ".skinharmony-core/logs" : ".universal-core/logs",
      snapshots: domainPack.id === "skinharmony" ? ".skinharmony-core/snapshots" : ".universal-core/snapshots",
      ...(typeof metadata.recommended_folders === "object" && metadata.recommended_folders ? metadata.recommended_folders : {}),
    },
    scope: {
      key_id: keyRecord?.key_id || "",
      key_type: keyRecord?.key_type || "",
      role: metadata.role || keyRecord?.preset || keyRecord?.key_type || "connector",
      allowed_scopes: keyRecord?.allowed_scopes || [],
      tenant_scoped: true,
      cross_tenant_block_default: true,
      revocation_supported: true,
    },
    gate_mode: metadata.gate_mode || "hard_gating",
    connector_contract: {
      init_command: "sh-core-codex init --setup-token SHX-SETUP-...",
      profile_endpoint: "GET /v1/bootstrap/profile",
      sensitive_actions_require_core: true,
      local_doctor_required: true,
    },
  };
}

function inferNiraBranchRequest(body = {}) {
  const explicit = normalizeList(body.branches || body.branch_ids || body.branch_groups, 80);
  if (explicit.length) return explicit;

  const target = String(body.target_system || "").toLowerCase();
  const text = String(body.text || body.request || body.task || "").toLowerCase();
  const requested = ["automation_control", "work_intake_intelligence"];

  if (/(software|codice|binari|eseguibil|debug|disassembl|decompil|ghidra|frida|reverse engineering|interoperabil|personalizz)/.test(`${target} ${text}`)) {
    requested.push("software_intelligence_lab");
  }

  if (/(ricerca|fonti|evidenz|documentazione|paper|benchmark|source|dati verificati)/.test(text)) {
    requested.push("research_evidence_intelligence");
  }
  if (/(pianifica|piano|priorit|roadmap|sequenza|milestone|dipenden|stima)/.test(text)) {
    requested.push("planning_priority_intelligence");
  }
  if (/(parallelo|coordina|delega|agenti|handoff|concorren|sincron|collabora|esegui|implementa)/.test(text)) {
    requested.push("execution_coordination_intelligence");
  }
  if (/(test|qualita|verifica|collaudo|accettazione|regression|evidence|qa)/.test(text)) {
    requested.push("quality_verification_intelligence");
  }
  if (/(apprendi|impara|migliora|retrospettiva|outcome|feedback|lezione|pattern|memoria)/.test(text)) {
    requested.push("adaptive_learning_intelligence");
  }

  if (target === "suite" || target === "wordpress" || /(suite|wordpress|wp|plugin|waas|sito|template)/.test(text)) {
    requested.push("platform_engineering", "site_factory");
  }
  if (target === "smartdesk" || /(smartdesk|smart desk|crm|agenda|gestionale)/.test(text)) {
    requested.push("business_governance", "data_integration_orchestration");
  }
  if (/(marketing|campagn|ads|sponsorizzat|copy|testi|recall|email|clienti|segment|funnel|conversion|comportament|localizzaz|traduzion)/.test(text)) {
    requested.push("marketing_intelligence", "content_intelligence");
  }
  if (target === "universal_core" || /(core|policy|gate|rami|branch|tenant|key|entitlement)/.test(text)) {
    requested.push("security_defense");
  }
  if (/(privacy|gdpr|audit|tenant|cross tenant|chiav|api key)/.test(text)) {
    requested.push("security_defense");
  }
  if (/(delega|agente|workload|identita|identity|oauth|token|scope|audience|revoca|impersona)/.test(`${target} ${text}`)) {
    requested.push("identity_delegation");
  }
  if (/(provenienza|provenance|verdict|decisione|conferma|approvazione|audit|rollback|tracciabil)/.test(text)) {
    requested.push("decision_provenance");
  }
  if (/(render|deploy|release|runtime|server|nodi|node|update|rollback)/.test(text)) {
    requested.push("runtime_deployment_scaling_guard", "observability_roi_guard");
  }

  return [...new Set(requested)];
}

const MANDATORY_NYRA_WORK_BRANCHES = Object.freeze([
  "context_intelligence",
  "work_intake",
  "research_evidence",
  "decision_reasoning",
  "planning_prioritization",
  "risk_governance",
  "execution_planning",
  "parallel_coordination",
  "tenant_work_coordination",
  "quality_verification",
  "learning_memory",
  "adaptive_learning",
]);

function composeMandatoryWorkPreflight(req, {
  domainPack,
  memoryContext = null,
  galleryContext = null,
  branchContext = null,
  nyraNetwork = null,
} = {}) {
  const body = req.body || {};
  const operationType = body.operation_type
    || body.action_type
    || body.requested_action?.type
    || nyraDeepV2PreflightOperation(body.deep_branch_v2?.operation)
    || "advisory_work";
  const requestText = String(
    body.request || body.message || body.text || body.task || body.user_request || body.user_input || body.input || body.action_label ||
    body.requested_action?.label || body.requested_action?.type ||
    `Core controlled ${body.action_type || body.operation_type || "work"}`,
  ).trim();
  const requestedCoreBranches = [...new Set(["work_cortex", ...inferNiraBranchRequest(body)])];
  const mandatoryBranchContext = composeBranchContext({
    keyRecord: req.coreKey,
    requestedBranches: requestedCoreBranches,
    task: String(body.task || body.action_label || requestText),
    userInput: requestText,
    locale: body.locale || "it",
  });
  const resolvedBranchContext = branchContext ? {
    ...mandatoryBranchContext,
    selected_branches: [...new Set([...(mandatoryBranchContext.selected_branches || []), ...(branchContext.selected_branches || [])])],
    denied_branches: [...new Set([...(mandatoryBranchContext.denied_branches || []), ...(branchContext.denied_branches || [])])]
      .filter((id) => !(mandatoryBranchContext.selected_branches || []).includes(id) && !(branchContext.selected_branches || []).includes(id)),
    selected_groups: [...new Set([...(mandatoryBranchContext.selected_groups || []), ...(branchContext.selected_groups || [])])],
  } : mandatoryBranchContext;
  const requestedNyraBranches = [
    ...MANDATORY_NYRA_WORK_BRANCHES,
    ...normalizeList(body.nyra_branches, MAX_NYRA_BRANCH_REQUESTS),
  ];
  const resolvedNyraNetwork = nyraNetwork || routeNyraBranches({
    text: requestText,
    requestedBranches: requestedNyraBranches,
    authorizedCoreBranches: resolvedBranchContext.selected_branches,
    domainPackId: domainPack.id,
  });
  return buildWorkPreflight({
    tenantId: req.tenantId,
    requestText,
    targetSystem: body.target_system || "universal_core",
    operationType,
    toolName: body.source_tool || body.tool_name || "",
    availableCapabilities: body.available_capabilities || body.available_tools || body.connected_capabilities || [],
    memoryContext,
    galleryContext,
    branchContext: resolvedBranchContext,
    nyraNetwork: resolvedNyraNetwork,
    domainPack: publicDomainPack(domainPack),
    ownerConfirmed: body.owner_confirmed === true,
    evidenceState: body.evidence_state || body.research_evidence_state || {},
    researchAllowedDomains: normalizeList(body.research_allowed_domains, 20),
  });
}

function evaluatePolicyEngine({ tenantPolicy, entitlement, action = {}, policy = {}, context = {} }) {
  const actionType = String(action.action_type || action.type || policy.action_type || "advisory").toLowerCase();
  const mode = String(policy.mode || policy.gateway_mode || "hard-gating");
  const riskHint = Number(action.risk_hint ?? policy.risk_hint ?? 25);
  const branchRequired = normalizeList(policy.required_branches || action.required_branches, 50);
  const missingBranches = branchRequired.filter((branchId) => !entitlement.branches.includes(branchId));
  const sensitiveDomain = tenantPolicy.sensitive_domains?.some((domain) => actionType.includes(String(domain).toLowerCase())) || false;
  const destructive = ["delete", "drop", "reset", "payment", "charge", "publish", "deploy", "update"].some((token) => actionType.includes(token));
  const ownerConfirmed = context.owner_confirmed === true || action.owner_confirmed === true || policy.owner_confirmed === true;
  const sandbox = context.sandbox === true || action.sandbox === true || policy.sandbox === true;
  const rollbackReady = context.rollback_ready === true || action.rollback_ready === true || policy.rollback_ready === true;
  const crossTenant = context.cross_tenant === true || action.cross_tenant === true || policy.cross_tenant === true;
  const pii = context.contains_pii === true || action.contains_pii === true || policy.contains_pii === true;
  const missingAudit = context.audit_ready === false || action.audit_ready === false;
  const requestedFailureCode = action.failure_code ?? context.failure_code ?? policy.failure_code;
  const hasFailureObservation = requestedFailureCode !== undefined && requestedFailureCode !== null && String(requestedFailureCode).trim() !== "";
  const failureObservation = hasFailureObservation
    ? mediateFailureObservation({
      code: requestedFailureCode,
      scope: {
        tenant_id: entitlement.tenant_id,
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
    })
    : null;

  let mediation = "allow";
  const reasons = [];
  if (failureObservation) {
    mediation = failureObservation.mediation_state;
    reasons.push(failureObservation.code);
  } else if (crossTenant) {
    mediation = "block";
    reasons.push("cross_tenant_denied");
  } else if (destructive && !ownerConfirmed) {
    mediation = "confirm";
    reasons.push("owner_confirmation_required");
  } else if (destructive && !rollbackReady && !sandbox) {
    mediation = "rollback_required";
    reasons.push("rollback_or_sandbox_required");
  } else if (pii && !policy.consent_collected) {
    mediation = "defer";
    reasons.push("privacy_consent_required");
  } else if (missingBranches.length) {
    mediation = "defer";
    reasons.push("missing_required_branches");
  } else if (riskHint >= 70 || sensitiveDomain) {
    mediation = ownerConfirmed ? "sandbox" : "confirm";
    reasons.push("sensitive_or_high_risk_action");
  } else if (mode === "rewrite") {
    mediation = "rewrite";
    reasons.push("rewrite_mode_requested");
  }
  if (missingAudit) {
    mediation = mediation === "block" ? "block" : "defer";
    reasons.push("audit_required");
  }

  return {
    schema_version: "policy_engine_v1",
    tenant_id: entitlement.tenant_id,
    action_type: actionType,
    decision: mediation === "block" ? "blocked" : mediation === "allow" ? "ready" : "attention",
    action_mediation: {
      state: mediation,
      execution_allowed: failureObservation ? false : mediation === "allow" || mediation === "rewrite" || mediation === "sandbox",
      owner_confirmation_required: mediation === "confirm" || mediation === "rollback_required",
      sandbox_required: mediation === "sandbox",
      rollback_required: mediation === "rollback_required",
      rewrite_allowed: mediation === "rewrite",
      blocked: mediation === "block" || mediation === "hard_block",
      failure_code: failureObservation?.code || null,
      failure_class: failureObservation?.classification?.block_class || null,
      failure_action: failureObservation?.action || null,
      retry_allowed: failureObservation?.classification?.retry_allowed === true,
      retry_exhausted: failureObservation?.classification?.retry_exhausted === true,
      quarantine: failureObservation?.quarantine === true,
      next_step:
        mediation === "allow"
          ? "execute_with_audit"
          : mediation === "rewrite"
            ? "rewrite_then_review"
            : mediation === "confirm"
              ? "ask_owner_confirmation"
              : mediation === "sandbox"
                ? "run_in_sandbox"
                : mediation === "rollback_required"
                  ? "prepare_rollback_before_execution"
                  : mediation === "defer"
                    ? "complete_missing_policy_or_data"
                    : "stop_and_redesign",
    },
    risk: {
      band: mediation === "block" ? "high" : riskHint >= 70 ? "high" : riskHint >= 35 ? "medium" : "low",
      score: Math.max(0, Math.min(100, riskHint + (destructive ? 15 : 0) + (crossTenant ? 50 : 0))),
      reasons: reasons,
    },
    failure_mediation: failureObservation,
    policy_flags: {
      missing_required_branches: missingBranches,
      sensitive_domain: sensitiveDomain,
      destructive_action: destructive,
      cross_tenant: crossTenant,
      pii,
      tenant_policy_source: tenantPolicy.source,
    },
  };
}

function suiteRunbookCatalog() {
  return [
    {
      id: "provision_customer_node",
      label: "Provision cliente",
      action_type: "codex_automation",
      risk_hint: 46,
      required_confirmation: true,
      steps: ["validate_tenant_scope", "generate_scoped_key", "prepare_site_clone", "write_evidence"],
    },
    {
      id: "clone_waas_template",
      label: "Clone template WaaS",
      action_type: "suite_sync",
      risk_hint: 42,
      required_confirmation: true,
      steps: ["select_template", "check_license", "prepare_clone_plan", "write_evidence"],
    },
    {
      id: "sync_site_content",
      label: "Sync contenuti sito",
      action_type: "publish",
      risk_hint: 58,
      required_confirmation: true,
      steps: ["content_guard", "claim_guard", "owner_review", "write_evidence"],
    },
    {
      id: "update_plugin_manifest",
      label: "Update plugin manifest",
      action_type: "release",
      risk_hint: 70,
      required_confirmation: true,
      steps: ["verify_checksum", "verify_channel", "prepare_rollback", "write_evidence"],
    },
    {
      id: "price_claim_audit",
      label: "Audit prezzi/claim",
      action_type: "claim_validation",
      risk_hint: 55,
      required_confirmation: false,
      steps: ["pricing_guard", "claim_guard", "policy_check", "write_evidence"],
    },
    {
      id: "bridge_crm_report",
      label: "Bridge CRM report",
      action_type: "sync",
      risk_hint: 38,
      required_confirmation: true,
      steps: ["validate_connector_scope", "read_snapshot", "prepare_report", "write_evidence"],
    },
  ];
}

function buildConnectorSdkManifest() {
  return {
    manifest_version: "core_connector_sdk_v2",
    positioning: "AI Governance + Automation Control Plane per PMI e verticali premium",
    rule: "AI e automazioni possono agire solo passando da Core, policy, audit, tenant isolation e conferma quando serve.",
    transports: ["rest_json", "mcp_ready_schema"],
    auth: {
      header: "Authorization: Bearer <SHX key>",
      key_types: ["connector", "automation", "user_session"],
      tenant_scoped: true,
    },
    adapters: ["wordpress", "site_suite", "smart_desk", "crm", "ecommerce", "files", "external_api"],
    required_client_behaviour: [
      "call_work_preflight_before_any_ai_work",
      "recall_tenant_memory_before_planning",
      "send_tenant_id_on_every_request",
      "never_execute_when_executionAllowed_false",
      "ask_owner_when_requiresOwnerConfirmation_true",
      "store_evidence_id_for_sensitive_actions",
    ],
    core_routes: {
      work_preflight: "/v1/work/preflight",
      gate: "/v1/ai-gateway/evaluate",
      tenant_status: "/v1/tenant/status",
      entitlements: "/v1/entitlements/current",
      domain_pack: "/v1/domain-packs/current",
      branches: "/v1/branches",
      branch_taxonomy: "/v1/branches/taxonomy",
      branch_maturity: "/v1/branches/maturity",
      branch_authorized: "/v1/branches/authorized",
      branch_analyze: "/v1/branches/:branch/analyze",
      semantic_selection: "/v1/semantic-selection",
      software_language_gate: "/v1/software-language-gate/evaluate",
      content_guard: "/v1/content-guard/check",
      claim_guard: "/v1/claim-guard/check",
      pricing_guard: "/v1/pricing-guard/check",
      policy_check: "/v1/policy/check",
      action_mediation: "/v1/action-mediation/evaluate",
      control_plane: "/v1/control-plane/overview",
      control_plane_dashboard: "/v1/control-plane/dashboard",
      ecosystem_pulse: "/v1/ecosystem-pulse",
      translator_extractor_status: "/v1/translator/extractor/status",
      translator_extractor_catalog: "/v1/translator/extractor/catalog",
      runbooks: "/v1/runbooks",
      runbook_evaluate: "/v1/runbooks/evaluate",
      release_check: "/v1/releases/manifest/check",
      evidence: "/v1/evidence/recent",
      customer_intelligence_contract: "/v1/customer-intelligence/contract",
      customer_intelligence_readiness: "/v1/customer-intelligence/readiness",
      intelligence_workflow: "/v1/intelligence/workflow",
      intelligence_scenarios: "/v1/intelligence/scenarios",
      intelligence_hypotheses: "/v1/intelligence/hypotheses/rank",
      intelligence_events: "/v1/intelligence/events/evaluate",
      intelligence_counterfactuals: "/v1/intelligence/counterfactuals/evaluate",
      intelligence_decision: "/v1/intelligence/decisions/select",
      intelligence_outcome_verify: "/v1/intelligence/outcomes/verify",
      intelligence_outcome_record: "/v1/intelligence/outcomes/record",
      intelligence_calibration: "/v1/intelligence/calibration",
      software_intelligence_components: "/v1/software-intelligence/components",
      software_intelligence_authorize: "/v1/software-intelligence/authorize",
      software_intelligence_analyze: "/v1/software-intelligence/analyze",
      software_intelligence_jobs_submit: "/v1/software-intelligence/jobs",
      software_intelligence_jobs_list: "/v1/software-intelligence/jobs",
      software_intelligence_job_get: "/v1/software-intelligence/jobs/:jobId",
      entity_graph: "/v1/entity-graph",
      entity_graph_upsert: "/v1/entity-graph/upsert",
      review_pending: "/v1/review/pending",
      review_action: "/v1/review/action",
    },
  };
}

function repoRoot() {
  return path.resolve(__dirname, "../../..");
}

function lexicalSemanticRuntimeMode() {
  const requested = String(process.env.LEXICAL_SEMANTIC_MODE || "active").trim().toLowerCase();
  return ["active", "shadow", "off"].includes(requested) ? requested : "shadow";
}

function extractorBinaryPath() {
  return process.env.SH_EXTRACTOR_BIN || path.join(repoRoot(), "skinharmony-rust-extractor-governor", "target", "release", "skinharmony-extract");
}

function extractorCandidatePaths() {
  return [
    extractorBinaryPath(),
    path.join(process.cwd(), "skinharmony-rust-extractor-governor", "target", "release", "skinharmony-extract"),
    path.join(repoRoot(), "target", "release", "skinharmony-extract"),
  ];
}

function resolveExtractorBinaryPath({ allowBuild = false } = {}) {
  for (const candidate of extractorCandidatePaths()) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  const lazyBuildAllowed = process.env.SH_EXTRACTOR_ENABLE_LAZY_BUILD === "1" || (process.env.NODE_ENV !== "production" && process.env.SH_EXTRACTOR_DISABLE_LAZY_BUILD !== "1");
  if (allowBuild && lazyBuildAllowed) {
    const buildScript = path.join(repoRoot(), "scripts", "build-rust-extractor-render.sh");
    if (fs.existsSync(buildScript)) {
      try {
        execFileSync("bash", [buildScript], {
          cwd: repoRoot(),
          env: process.env,
          encoding: "utf8",
          timeout: Number(process.env.SH_EXTRACTOR_BUILD_TIMEOUT_MS || 180_000),
        });
      } catch (error) {
        const output = `${error.stdout || ""}\n${error.stderr || ""}`.trim();
        const snippet = output
          .replace(/(api[_-]?key|token|secret|password)=\\S+/gi, "$1=[redacted]")
          .slice(0, Number(process.env.SH_EXTRACTOR_BUILD_ERROR_BYTES || 1200));
        throw new Error(`extractor_build_failed:${snippet || error.message || "unknown"}`);
      }
      for (const candidate of extractorCandidatePaths()) {
        if (candidate && fs.existsSync(candidate)) return candidate;
      }
    }
  }

  return null;
}

function safeRelativeExtractorPath(value, fallbackIndex = 0) {
  const raw = String(value || `input_${fallbackIndex}.txt`).replaceAll("\\", "/").trim();
  if (!raw || path.isAbsolute(raw)) return `input_${fallbackIndex}.txt`;
  const clean = raw
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return clean || `input_${fallbackIndex}.txt`;
}

function writeExtractorInputFiles(inputDir, files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("extractor_files_required");
  }

  const maxFiles = Number(process.env.SH_EXTRACTOR_MAX_FILES || 250);
  const maxFileBytes = Number(process.env.SH_EXTRACTOR_MAX_FILE_BYTES || 900_000);
  const maxTotalBytes = Number(process.env.SH_EXTRACTOR_MAX_TOTAL_BYTES || 8_000_000);
  if (files.length > maxFiles) throw new Error("extractor_too_many_files");

  const root = path.resolve(inputDir);
  let totalBytes = 0;
  const written = [];

  files.forEach((file, index) => {
    const rel = safeRelativeExtractorPath(file?.path || file?.name, index);
    const target = path.resolve(root, rel);
    if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
      throw new Error("extractor_invalid_file_path");
    }

    const content = String(file?.content ?? file?.text ?? "");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > maxFileBytes) throw new Error("extractor_file_too_large");
    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) throw new Error("extractor_payload_too_large");

    ensureDir(path.dirname(target));
    fs.writeFileSync(target, content, "utf8");
    written.push({ path: rel, bytes });
  });

  return { files: written, total_bytes: totalBytes };
}

function readJsonFileSafe(file, fallback = null) {
  try {
    return readJsonFile(file, fallback);
  } catch {
    return fallback;
  }
}

function readJsonlCatalog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function extractorCatalogStats(segments = []) {
  const riskCounts = {};
  const radarCounts = {};
  const categoryCounts = {};
  for (const segment of segments) {
    const risk = segment?.risk?.level || "unknown";
    const radar = segment?.radar?.level || "unknown";
    const category = segment?.category || "unknown";
    riskCounts[risk] = (riskCounts[risk] || 0) + 1;
    radarCounts[radar] = (radarCounts[radar] || 0) + 1;
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }
  return {
    total: segments.length,
    risk: riskCounts,
    radar: radarCounts,
    categories: categoryCounts,
    high_or_block: (riskCounts.high || 0) + (riskCounts.block || 0),
    critical_radar: radarCounts.critical || 0,
  };
}

function runRustExtractorGovernor(storageRoot, payload = {}) {
  const binary = resolveExtractorBinaryPath({ allowBuild: true });
  if (!binary) throw new Error("extractor_binary_missing");

  const jobId = `extract_${crypto.randomUUID()}`;
  const jobRoot = path.join(storageRoot, "extractor", "jobs", jobId);
  const inputDir = path.join(jobRoot, "input");
  const outputDir = path.join(jobRoot, "out");
  ensureDir(inputDir);
  ensureDir(outputDir);

  const written = writeExtractorInputFiles(inputDir, payload.files);
  const outFile = path.join(outputDir, "catalog.jsonl");
  const policyFile = path.join(outputDir, "policy.json");
  const radarFile = path.join(outputDir, "radar.json");
  const noiseFile = path.join(outputDir, "noise.json");

  const args = [
    inputDir,
    "--source-lang",
    textValue(payload.source_lang, "it"),
    "--target-lang",
    textValue(payload.target_lang, "en"),
    "--out",
    outFile,
    "--format",
    "jsonl",
    "--min-confidence",
    String(Number(payload.min_confidence ?? 0.62)),
    "--min-quality",
    String(Number(payload.min_quality ?? 0.58)),
    "--emit-policy-report",
    policyFile,
    "--emit-radar-report",
    radarFile,
    "--emit-noise-report",
    noiseFile,
  ];

  if (payload.scan_bundles === true) args.push("--scan-bundles");
  if (payload.use_sourcemaps === true) args.push("--use-sourcemaps");
  if (payload.stats !== false) args.push("--stats");
  for (const include of Array.isArray(payload.include) ? payload.include.slice(0, 20) : []) args.push("--include", String(include));
  for (const exclude of Array.isArray(payload.exclude) ? payload.exclude.slice(0, 20) : []) args.push("--exclude", String(exclude));

  const stdout = execFileSync(binary, args, {
    encoding: "utf8",
    timeout: Number(process.env.SH_EXTRACTOR_TIMEOUT_MS || 75_000),
    maxBuffer: Number(process.env.SH_EXTRACTOR_MAX_BUFFER || 12_000_000),
  });

  const segments = readJsonlCatalog(outFile);
  return {
    job_id: jobId,
    binary,
    input: written,
    stdout,
    catalog_file: outFile,
    policy_file: policyFile,
    radar_file: radarFile,
    noise_file: noiseFile,
    segments,
    stats: extractorCatalogStats(segments),
    policy: readJsonFileSafe(policyFile, null),
    radar: readJsonFileSafe(radarFile, null),
    noise: readJsonFileSafe(noiseFile, null),
  };
}

function buildExtractorCoreInput(req, extraction) {
  const stats = extraction.stats || {};
  const policySafe = extraction.policy?.publish_safe === true;
  return {
    request_id: `extractor_${extraction.job_id}`,
    generated_at: nowIso(),
    domain: "translation_extraction_governance",
    context: {
      tenant_id: req.tenantId,
      actor_id: req.body?.actor_id || "translator_connector",
      locale: req.body?.locale || "it",
      metadata: {
        source: "rust_extractor_governor",
        source_lang: textValue(req.body?.source_lang, "it"),
        target_lang: textValue(req.body?.target_lang, "en"),
        job_id: extraction.job_id,
      },
    },
    signals: [
      normalizeSignal({
        id: "extractor:catalog_size",
        label: "Segmenti traducibili trovati",
        category: "translation",
        normalized_score: Math.min(100, Number(stats.total || 0) * 2),
        confidence_hint: 88,
        tags: ["extractor", "catalog"],
      }),
      normalizeSignal({
        id: "extractor:risk",
        label: "Segmenti high/block da validare",
        category: "risk",
        normalized_score: Math.min(100, Number(stats.high_or_block || 0) * 22),
        severity_hint: Math.min(100, Number(stats.high_or_block || 0) * 28),
        confidence_hint: 86,
        tags: ["extractor", "publish_safe"],
      }),
      normalizeSignal({
        id: "extractor:radar",
        label: "Segmenti critical radar",
        category: "visibility",
        normalized_score: Math.min(100, Number(stats.critical_radar || 0) * 18),
        confidence_hint: 84,
        tags: ["extractor", "radar"],
      }),
      normalizeSignal({
        id: "extractor:policy",
        label: policySafe ? "Policy catalogo senza blocchi" : "Policy catalogo richiede validazione",
        category: "policy",
        normalized_score: policySafe ? 10 : 72,
        severity_hint: policySafe ? 10 : 72,
        confidence_hint: 90,
        evidence: [{ label: "publish_safe", value: policySafe }],
        tags: ["core_nyra_gate", "translation"],
      }),
    ],
    data_quality: {
      score: stats.total ? 82 : 45,
      missing_fields: stats.total ? [] : ["translatable_segments"],
    },
    constraints: safeConstraints({
      require_confirmation: true,
      max_control_level: "confirm",
      allow_automation: false,
      safety_mode: true,
      blocked_actions: ["publish_without_translation_validation", "publish_high_risk_untranslated"],
    }, req.coreKey, false),
  };
}

function evaluateReleaseManifest(payload = {}, context = {}) {
  const manifest = typeof payload.manifest === "object" && payload.manifest ? payload.manifest : payload;
  if (manifest?.schema_version === HOST_RELEASE_MANIFEST_VERSION) {
    try {
      const verified = validateHostReleaseManifestV2(manifest, context);
      return {
        status: "ready",
        execution_allowed: false,
        owner_confirmation_required: true,
        manifest: {
          ...verified,
          integrity_verified: true,
          signature_verified: false,
          signed: false,
        },
        issues: [],
        required_next_step: "bounded_host_action_ticket_then_host_policy_approval",
      };
    } catch (error) {
      return {
        status: "blocked",
        execution_allowed: false,
        owner_confirmation_required: true,
        manifest: {
          schema_version: HOST_RELEASE_MANIFEST_VERSION,
          manifest_id: textValue(manifest.manifest_id) || null,
          integrity_verified: false,
          signature_verified: false,
          signed: false,
        },
        issues: [{
          code: "release_manifest_v2_invalid",
          severity: "critical",
          reason: String(error?.message || "release_manifest_invalid").slice(0, 160),
        }],
        required_next_step: "fix_manifest_before_release",
      };
    }
  }
  const version = textValue(manifest.version || manifest.stable_version);
  const channel = textValue(manifest.channel || manifest.release_channel, "stable");
  const packageUrl = textValue(manifest.package_url || manifest.package || manifest.zip_url);
  const checksum = textValue(manifest.checksum_sha256 || manifest.sha256 || manifest.checksum);
  const rollbackUrl = textValue(manifest.rollback_url);
  const signaturePresent = Boolean(manifest.signature || manifest.signed === true);
  // Legacy envelopes have no canonical payload or trusted verification key.
  // A boolean or arbitrary string therefore never proves a signature.
  const signatureVerified = false;
  const issues = [];

  if (!version) issues.push({ code: "missing_version", severity: "critical" });
  if (!["stable", "beta", "canary"].includes(channel)) issues.push({ code: "invalid_channel", severity: "critical", channel });
  if (!packageUrl) issues.push({ code: "missing_package_url", severity: "critical" });
  if (!checksum || !/^[a-f0-9]{64}$/i.test(checksum)) issues.push({ code: "missing_or_invalid_sha256", severity: "critical" });
  if (!signaturePresent) issues.push({ code: "missing_manifest_signature", severity: "high" });
  else issues.push({ code: "manifest_signature_unverified", severity: "high" });
  if (!rollbackUrl) issues.push({ code: "missing_rollback_url", severity: "high" });
  if (manifest.skip_integrity_check === true || manifest.bypass_checksum === true) issues.push({ code: "integrity_bypass_requested", severity: "critical" });

  const critical = issues.some((issue) => issue.severity === "critical");
  return {
    status: critical ? "blocked" : issues.length ? "review_required" : "ready",
    execution_allowed: false,
    owner_confirmation_required: true,
    manifest: {
      version,
      channel,
      package_url: packageUrl,
      checksum_sha256: checksum || null,
      rollback_url: rollbackUrl || null,
      signed: signatureVerified,
      signature_present: signaturePresent,
      signature_verified: signatureVerified,
    },
    issues,
    required_next_step: critical ? "fix_manifest_before_release" : issues.length ? "owner_review_before_release" : "staging_canary_then_owner_confirmation",
  };
}

function buildControlPlaneOverview({ tenantId, keyRecord, keyStore, snapshot, auditEvents, evidenceEvents }) {
  const branchResolution = resolveBranchesForKey(keyRecord);
  const suitePolicy = buildSuitePolicy(keyRecord, branchResolution);
  const tenantKeys = keyStore.listKeys({ tenant_id: tenantId });
  const auditPulse = summarizeAuditPulse(auditEvents);
  const activeKeys = tenantKeys.filter((key) => key.status === "active").length;
  const suspendedKeys = tenantKeys.filter((key) => key.status === "suspended").length;
  const revokedKeys = tenantKeys.filter((key) => key.status === "revoked").length;

  return {
    tenant_id: tenantId,
    generated_at: nowIso(),
    positioning: "AI Governance + Automation Control Plane per PMI e verticali premium",
    control_plane: {
      api_keys: { total: tenantKeys.length, active: activeKeys, suspended: suspendedKeys, revoked: revokedKeys },
      licenses: { tier: branchResolution.tier, suite_policy: suitePolicy },
      versions: { service_version: SERVICE_VERSION, connector_sdk_manifest: "core_connector_sdk_v2" },
      update: { release_manifest_check: "/v1/releases/manifest/check", automatic_update_allowed: false },
      gate: { ai_gateway: "/v1/ai-gateway/evaluate", policy_check: "/v1/policy/check" },
      automations: { runbook_count: suiteRunbookCatalog().length, execution_default: "confirm_or_block" },
      errors: { auth_failures_24h: auditPulse.auth_failures_24h, scope_denied_24h: auditPulse.scope_denied_24h },
      audit: { events_24h: auditPulse.total_events_24h, evidence_events: evidenceEvents.length },
    },
    tenant_isolation: {
      mode: "tenant_scoped_keys",
      current_key_id: keyRecord.key_id,
      admin_scope: hasScope(keyRecord, SCOPES.ADMIN_TENANT),
      cross_tenant_block_default: true,
      staging_production_separation_required: true,
    },
    latest_snapshot: snapshot ? { snapshot_id: snapshot.snapshot_id, source: snapshot.source, created_at: snapshot.created_at } : null,
    next_missing_blocks: [
      "external_ui_dashboard",
      "customer_connector_packages",
      "production_signature_secret_rotation",
      "enterprise_agnostic_demo",
    ],
  };
}

function defaultClaimTerms() {
  return [
    "cura",
    "guarisce",
    "guarigione",
    "terapeutico",
    "terapia",
    "medicale",
    "elimina definitivamente",
    "risultato garantito",
  ];
}

function claimGuardCheck(payload = {}) {
  const text = String(payload.text || payload.content || "");
  const terms = Array.isArray(payload.forbidden_terms) && payload.forbidden_terms.length ? payload.forbidden_terms : defaultClaimTerms();
  const issues = terms
    .map(String)
    .filter((term) => term && text.toLowerCase().includes(term.toLowerCase()))
    .map((term) => ({
      term,
      severity: ["medicale", "terapia", "terapeutico", "guarisce", "guarigione"].includes(term.toLowerCase()) ? "critical" : "warning",
      message: `Claim da verificare: ${term}`,
      suggested_action: "Rivedere il testo con formula prudente e approvazione owner.",
    }));

  const critical = issues.some((issue) => issue.severity === "critical");
  return {
    status: issues.length ? (critical ? "critical" : "warning") : "ok",
    issue_count: issues.length,
    issues,
    hard_block: false,
    recommended_action: issues.length ? "revision_required_before_publication" : "no_action_required",
  };
}

function pricingGuardCheck(payload = {}) {
  const official = Array.isArray(payload.official_prices) ? payload.official_prices : [];
  const observed = Array.isArray(payload.observed_prices) ? payload.observed_prices : [];
  if (!official.length || !observed.length) {
    return {
      status: "unknown",
      issue_count: 0,
      issues: [],
      hard_block: false,
      recommended_action: "Caricare listino ufficiale e prezzi osservati. Il Core non inventa prezzi.",
    };
  }

  const officialMap = new Map(official.map((row) => [String(row.sku || row.name || row.id), Number(row.price)]));
  const issues = observed.flatMap((row) => {
    const key = String(row.sku || row.name || row.id);
    const expected = officialMap.get(key);
    if (!Number.isFinite(expected)) return [{ key, severity: "warning", message: "Voce prezzo non presente nel listino ufficiale.", observed_price: row.price }];
    const observedPrice = Number(row.price);
    if (!Number.isFinite(observedPrice)) return [{ key, severity: "warning", message: "Prezzo osservato non valido.", expected_price: expected }];
    const delta = observedPrice - expected;
    if (Math.abs(delta) < 0.01) return [];
    return [{ key, severity: "warning", message: "Prezzo non allineato al listino ufficiale.", expected_price: expected, observed_price: observedPrice, delta }];
  });

  return {
    status: issues.length ? "warning" : "ok",
    issue_count: issues.length,
    issues,
    hard_block: false,
    recommended_action: issues.length ? "review_price_alignment" : "no_action_required",
  };
}

function buildFlowCoreBranchInput(payload = {}) {
  const metrics = payload.metrics || payload.snapshot || payload;
  return {
    request_id: String(payload.request_id || `flow_${crypto.randomUUID()}`),
    pressure_score: Number(metrics.pressure_score ?? metrics.pressure ?? metrics.cpu_pressure ?? 0),
    continuity_risk_score: Number(metrics.continuity_risk_score ?? metrics.continuity_risk ?? 0),
    memory_stress_score: Number(metrics.memory_stress_score ?? metrics.memory_pressure ?? metrics.memory_stress ?? 0),
    process_opportunity_score: Number(metrics.process_opportunity_score ?? metrics.process_opportunity ?? 0),
    persistent_signal: Boolean(metrics.persistent_signal),
    process_legitimacy_score:
      metrics.process_legitimacy_score === undefined ? undefined : Number(metrics.process_legitimacy_score),
    data_quality_score: Number(metrics.data_quality_score ?? metrics.data_quality?.score ?? 70),
    temporal_stability_score: Number(metrics.temporal_stability_score ?? metrics.stability_score ?? 70),
  };
}

function baselineAiDecision(payload = {}) {
  const action = String(payload.requested_action?.type || payload.action_type || payload.domain || "advisory").toLowerCase();
  const llmOutput = String(payload.llm_output || payload.output || "");
  const sensitive =
    ["publish", "approve", "delete", "deploy", "update", "sync", "send", "write", "pricing", "claim_validation"].includes(action) ||
    /password|secret|token|api key|private key|reset --hard|drop table/i.test(llmOutput);
  return {
    model: "baseline_without_core",
    decision: sensitive ? "likely_allow_with_prompt_warning" : "allow",
    executionAllowed: true,
    ownerConfirmationEnforced: false,
    auditRequired: false,
    risk: sensitive ? "uncontrolled" : "unknown",
  };
}

function gatewayBenchmark(payload = {}, verdict = {}) {
  const baseline = baselineAiDecision(payload);
  return {
    baseline,
    gateway: {
      model: "universal_core_ai_gateway",
      decision: verdict.decision,
      executionAllowed: verdict.executionAllowed,
      ownerConfirmationEnforced: verdict.requiresOwnerConfirmation,
      auditRequired: true,
      risk: verdict.risk?.band || "unknown",
    },
    delta: {
      execution_hardened: baseline.executionAllowed === true && verdict.executionAllowed === false,
      owner_confirmation_added: baseline.ownerConfirmationEnforced === false && verdict.requiresOwnerConfirmation === true,
      audit_added: true,
      verdict_schema: AI_GATEWAY_SCHEMA_VERSION,
    },
  };
}

function clampScore(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function textValue(value, fallback = "") {
  return String(value === undefined || value === null ? fallback : value).trim();
}

function arrayValue(value, max = 20) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => textValue(item)).filter(Boolean);
}

function branchRegistry() {
  return {
    ...deterministicBranchRegistry(),
    beauty_market: {
      label: "Beauty Market Intelligence",
      domain: "market",
      tier: "network",
      production_status: "advisory",
      description: "Legge segnali mercato beauty/wellness e produce postura commerciale, senza trading e senza dati finanziari sensibili.",
    },
    marketing_copy: {
      label: "Nyra Marketing Copy",
      domain: "marketing",
      tier: "network",
      production_status: "advisory",
      description: "Prepara brief copywriting e testi da revisionare con Claim Guard, non pubblica automaticamente.",
    },
    cosmetic_chemistry: {
      label: "Cosmetic Chemistry Positioning",
      domain: "product",
      tier: "network",
      production_status: "advisory",
      description: "Aiuta a posizionare attivi cosmetici in modo prudente, senza claim medici o terapeutici.",
    },
    technology_market: {
      label: "Technology Trend Intelligence",
      domain: "technology",
      tier: "network",
      production_status: "advisory",
      description: "Valuta domanda, maturita e messaggio commerciale per tecnologie beauty/wellness.",
    },
    business_strategy: {
      label: "Business Strategy",
      domain: "strategy",
      tier: "network",
      production_status: "advisory",
      description: "Ordina priorita commerciali, canale, CRM e prossime azioni per owner/manager.",
    },
    translation_governance: {
      label: "Translation Governance",
      domain: "translation",
      tier: "network",
      production_status: "advisory",
      description: "Valuta payload traducibili, readiness e rischio di traduzione. Non traduce HTML finale.",
    },
    translator_marketing_governance: {
      label: "Translator Marketing Governance",
      domain: "translation_marketing",
      tier: "network",
      production_status: "advisory",
      description: "Valuta traduttore plugin e app surfaces: microcopy, CTA, fallback, review marketing/compliance e sync strutturato.",
    },
    ramo_testo: {
      label: "Ramo Testo / Content Guard",
      domain: "content_guard",
      tier: "network",
      production_status: "advisory",
      description: "Valuta qualita testo, traduzioni, claim risk, brand tone e publish safety. Non pubblica automaticamente.",
    },
    nyra_finance_beauty_test: {
      label: "Nyra Finance Beauty Test",
      domain: "market_test",
      tier: "internal",
      production_status: "test_only",
      description: "Area separata per correlare segnali finanziari/mercato beauty. Non entra nel prodotto operativo.",
    },
  };
}

function normalizeTextGuardSeverity(value) {
  const severity = String(value || "").toLowerCase();
  return ["low", "medium", "high", "blocker"].includes(severity) ? severity : "medium";
}

function normalizeTextGuardType(value) {
  const type = String(value || "").toLowerCase();
  const allowed = [
    "spelling",
    "accent",
    "grammar",
    "punctuation",
    "style",
    "readability",
    "glossary",
    "translation_mismatch",
    "claim_risk",
    "brand_tone",
    "publish_safety",
  ];
  return allowed.includes(type) ? type : "style";
}

function normalizeTextGuardIssues(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((issue, index) => {
    const original = textValue(issue?.original || issue?.term || issue?.text || "");
    return {
      id: textValue(issue?.id, `issue_${index + 1}`),
      type: normalizeTextGuardType(issue?.type),
      severity: normalizeTextGuardSeverity(issue?.severity),
      start: Number.isFinite(Number(issue?.start)) ? Number(issue.start) : 0,
      end: Number.isFinite(Number(issue?.end)) ? Number(issue.end) : original.length,
      original,
      suggestions: Array.isArray(issue?.suggestions) ? issue.suggestions.slice(0, 5).map((item) => textValue(item)).filter(Boolean) : [],
      message: textValue(issue?.message, "Elemento da revisionare"),
      reason: textValue(issue?.reason, "Controllo Content Guard"),
      safe_to_auto_apply: Boolean(issue?.safe_to_auto_apply) && normalizeTextGuardType(issue?.type) !== "claim_risk" && normalizeTextGuardType(issue?.type) !== "publish_safety",
    };
  });
}

function buildTextGuardIssuesFromClaimShield(text, data = {}) {
  const claimResult = claimShieldCheck({ text, context: data.context || {} });
  if (!claimResult.issues?.length) return [];
  return claimResult.issues.map((issue, index) => ({
    id: `claim_${index + 1}`,
    type: issue.severity === "critical" ? "publish_safety" : "claim_risk",
    severity: issue.severity === "critical" ? "blocker" : issue.severity === "high" ? "high" : "medium",
    start: Math.max(0, text.toLowerCase().indexOf(String(issue.term || "").toLowerCase())),
    end: Math.max(0, text.toLowerCase().indexOf(String(issue.term || "").toLowerCase())) + String(issue.term || "").length,
    original: String(issue.term || ""),
    suggestions: ["Riformulare con linguaggio prudente e approvazione owner."],
    message: issue.message || "Claim da revisionare",
    reason: "Claim Shield ha rilevato un rischio prima della pubblicazione.",
    safe_to_auto_apply: false,
  }));
}

async function buildTextBranchInput(req, payload = {}) {
  const data = typeof payload.data === "object" && payload.data ? payload.data : payload;
  const text = textValue(data.text || data.content || data.copy || data.draft);
  const providedIssues = normalizeTextGuardIssues(data.issues);
  const claimIssues = buildTextGuardIssuesFromClaimShield(text, data);
  const issues = await detectLanguageGuardIssues({
    text,
    locale: data.locale || payload.locale || "it",
    existingIssues: [...providedIssues, ...claimIssues],
    options: {
      useLanguageTool: data.use_languagetool ?? payload.use_languagetool,
    },
  });
  return {
    request_id: textValue(data.request_id || payload.request_id, `text_guard_${crypto.randomUUID()}`),
    generated_at: textValue(data.generated_at || payload.generated_at, nowIso()),
    locale: textValue(data.locale || payload.locale, "it"),
    tenant_id: req.tenantId,
    actor_id: textValue(data.actor_id || payload.actor_id),
    context: textValue(data.context || payload.context, "manual_review"),
    domain: textValue(data.domain || payload.domain, "manual"),
    object_id: data.object_id ?? payload.object_id,
    key_path: textValue(data.key_path || payload.key_path),
    text,
    source_text: textValue(data.source_text || payload.source_text),
    issues,
  };
}

function buildBranchPayload(branch, payload = {}) {
  const registry = branchRegistry();
  const profile = registry[branch];
  if (!profile) return null;

  const data = typeof payload.data === "object" && payload.data ? payload.data : payload;
  const missing = [];
  const warnings = [];
  const signals = [];
  let branchOutput = {};

  const addSignal = (id, label, score, category = profile.domain, tags = []) => {
    signals.push(normalizeSignal({
      id: `${branch}:${id}`,
      label,
      category,
      normalized_score: clampScore(score),
      confidence_hint: clampScore(data.confidence ?? data.data_quality_score ?? 72, 72),
      tags: [branch, ...tags],
    }));
  };

  if (branch === "beauty_market") {
    const trend = clampScore(data.trend_strength ?? data.market_trend_score ?? 50);
    const pressure = clampScore(data.pricing_pressure ?? data.price_pressure_score ?? 40);
    const channel = clampScore(data.channel_opportunity ?? data.channel_score ?? 55);
    addSignal("trend_strength", "Forza trend beauty/wellness", trend, "market", ["trend"]);
    addSignal("pricing_pressure", "Pressione prezzo nel canale", pressure, "pricing", ["price"]);
    addSignal("channel_opportunity", "Opportunita canale commerciale", channel, "market", ["channel"]);
    branchOutput = {
      market_posture: pressure >= 70 ? "defensive_margin_guard" : trend >= 65 ? "selective_growth" : "monitor",
      recommended_use: "Usare per orientare campagne, pricing advisory e priorita CRM; non come motore trading.",
      research_required: data.sources_provided ? false : true,
    };
  } else if (branch === "marketing_copy") {
    const offer = textValue(data.offer || data.product || data.service);
    const target = textValue(data.target || data.audience || data.customer_type);
    const proof = textValue(data.proof || data.evidence || data.source);
    const cta = textValue(data.cta || data.call_to_action);
    if (!offer) missing.push("offer");
    if (!target) missing.push("target");
    if (!proof && data.public_copy === true) missing.push("proof_or_source");
    if (!cta) missing.push("cta");
    const claimResult = claimShieldCheck({ text: textValue(data.draft || data.claims || data.copy || ""), context: data.context || {} });
    const unsupportedTrend = Boolean(data.trend_claim) && !data.sources_provided;
    const inventedProof = Boolean(data.case_study || data.testimonial) && data.proof_verified !== true;
    addSignal("claim_risk", "Rischio claim nel copy marketing", claimResult.risk_score, "claim", ["claim_guard"]);
    addSignal("brief_completeness", "Completezza brief marketing", 100 - missing.length * 18, "marketing", ["brief"]);
    addSignal("unsupported_proof", "Rischio prova/trend non supportati", unsupportedTrend || inventedProof ? 82 : 12, "marketing", ["proof"]);
    branchOutput = {
      copy_mode: "brief_first_owner_review",
      offer,
      target,
      proof_required: !proof,
      cta_required: !cta,
      safe_angle: "benefici estetici, esperienza, metodo, controllo e servizio; evitare promesse mediche o risultati garantiti.",
      blocked_claims: claimResult.issues.map((issue) => issue.term),
      unsupported_proof_risk: unsupportedTrend || inventedProof,
      owner_review_required: true,
    };
  } else if (branch === "paid_ads_guard") {
    const campaignGoal = textValue(data.campaign_goal || data.goal || data.objective);
    const audience = textValue(data.audience || data.target || data.customer_segment);
    const budget = Number(data.budget ?? data.daily_budget ?? 0);
    const landingReady = data.landing_ready === true || data.landing_page_ready === true;
    const consentReady = data.consent_ready === true || data.tracking_consent === true;
    const sensitiveTargeting = data.sensitive_targeting === true || data.health_targeting === true || data.body_insecurity_targeting === true;
    const autoPublish = data.auto_publish === true || data.publish_now === true;
    const autoBudget = data.auto_increase_budget === true || data.budget_auto_scale === true;
    const inventedPerformance = data.invented_roas === true || data.invented_cac === true || data.performance_source === "invented";
    const claimResult = claimShieldCheck({ text: textValue(data.ad_copy || data.copy || data.draft || ""), context: data.context || {} });
    if (!campaignGoal) missing.push("campaign_goal");
    if (!audience) missing.push("audience");
    if (!landingReady) missing.push("landing_page");
    addSignal("claim_risk", "Rischio claim ads", claimResult.risk_score, "claim", ["ads"]);
    addSignal("targeting_safety", "Targeting e categorie sensibili", sensitiveTargeting ? 92 : 12, "privacy", ["targeting"]);
    addSignal("budget_control", "Budget e auto-scale controllati", autoBudget || budget <= 0 ? 68 : 16, "ads", ["budget"]);
    addSignal("performance_proof", "Performance non inventata", inventedPerformance ? 90 : 10, "ads", ["proof"]);
    addSignal("publish_safety", "Pubblicazione campagna controllata", autoPublish ? 96 : 8, "ads", ["publish"]);
    branchOutput = {
      ads_mode: "draft_review_only",
      campaign_goal: campaignGoal,
      audience,
      budget,
      owner_review_required: true,
      publish_allowed: false,
      required_checks: ["Claim Guard", "landing pronta", "tracking/consenso", "budget owner-approved", "policy piattaforma ads"],
      blocked_if: { sensitive_targeting: sensitiveTargeting, auto_publish: autoPublish, auto_budget_scale: autoBudget, invented_performance: inventedPerformance },
    };
  } else if (branch === "lifecycle_crm_guard" || branch === "email_recall_guard") {
    const customerState = textValue(data.customer_state || data.lifecycle_state || data.status);
    const lastActivityDays = Number(data.last_activity_days ?? data.days_since_last_visit ?? 0);
    const consent = data.marketing_consent === true || data.consent === true;
    const channel = textValue(data.channel || data.preferred_channel);
    const autoSend = data.auto_send === true || data.send_now === true;
    const hasReason = Boolean(textValue(data.reason || data.contact_reason || data.next_action_reason));
    const isLost = customerState === "lost" || lastActivityDays >= 180;
    if (!customerState) missing.push("customer_state");
    if (!channel && branch === "email_recall_guard") missing.push("channel");
    if (!hasReason) missing.push("contact_reason");
    addSignal("consent_readiness", "Consenso marketing e canale", consent ? 8 : 88, "privacy", ["consent"]);
    addSignal("recall_priority", "Priorita recall/lifecycle", isLost ? 72 : lastActivityDays >= 60 ? 58 : 24, "crm_marketing", ["lifecycle"]);
    addSignal("message_safety", "Invio manuale e tono non aggressivo", autoSend ? 96 : 10, "crm_marketing", ["message"]);
    addSignal("brief_completeness", "Completezza motivo e prossima azione", hasReason ? 12 : 54, "crm_marketing", ["brief"]);
    branchOutput = {
      crm_marketing_mode: branch === "email_recall_guard" ? "message_draft_only" : "lifecycle_priority_advisory",
      customer_state: customerState,
      last_activity_days: Number.isFinite(lastActivityDays) ? lastActivityDays : null,
      channel,
      can_prepare_message: consent && hasReason,
      send_allowed: false,
      owner_review_required: true,
      required_checks: ["consenso", "motivo contatto", "canale", "stato cliente", "nessun invio automatico"],
      blocked_if: { missing_consent: !consent, auto_send: autoSend },
    };
  } else if (branch === "customer_behavior_analysis") {
    const profile = typeof payload.customer_profile === "object" && payload.customer_profile ? payload.customer_profile : {};
    const observedEvents = normalizeList(payload.observed_events || data.observed_events || data.events, 50);
    const requestedAction = textValue(payload.requested_action || data.requested_action || data.action);
    const sampleSize = Number(data.sample_size ?? data.customer_count ?? profile.sample_size ?? profile.customer_count ?? (profile.purchase_history_count ? 12 : 0));
    const hasRecency = data.has_recency === true || data.last_activity_available === true || Number.isFinite(Number(profile.last_visit_days)) || Number.isFinite(Number(data.last_visit_days));
    const hasFrequency = data.has_frequency === true || data.frequency_available === true || Number.isFinite(Number(profile.visit_frequency_days)) || Number.isFinite(Number(data.visit_frequency_days)) || observedEvents.includes("recurring_visits");
    const hasValue = data.has_value === true || data.value_available === true || Number.isFinite(Number(profile.average_ticket_eur)) || Number.isFinite(Number(data.average_ticket_eur)) || observedEvents.includes("high_ticket");
    const consentKnown = data.marketing_consent === true || data.consent === true || profile.marketing_consent === true;
    const autoContact = data.auto_contact === true || data.auto_send === true || data.send_now === true || requestedAction.includes("automatico") || requestedAction.includes("auto");
    const sensitiveProfiling =
      data.sensitive_profiling === true ||
      data.infers_health === true ||
      data.infers_psychology === true ||
      data.infers_sensitive_category === true ||
      observedEvents.includes("sensitive_profiling") ||
      requestedAction.includes("salute") ||
      requestedAction.includes("psicolog") ||
      requestedAction.includes("categoria protetta");
    const dataCompleteness = [hasRecency, hasFrequency, hasValue].filter(Boolean).length;
    addSignal("data_completeness", "Dati comportamento disponibili", 100 - dataCompleteness * 30, "customer_intelligence", ["data"]);
    addSignal("sample_quality", "Campione dati sufficiente", sampleSize >= 50 ? 12 : sampleSize >= 10 ? 38 : 74, "customer_intelligence", ["sample"]);
    addSignal("sensitive_inference", "Profilazione sensibile evitata", sensitiveProfiling ? 98 : 8, "privacy", ["profiling"]);
    addSignal("consent_for_contact", "Consenso prima di contatto diretto", !autoContact || consentKnown ? 10 : 92, "privacy", ["consent"]);
    branchOutput = {
      behavior_mode: "observed_patterns_only",
      confidence: sampleSize >= 50 && dataCompleteness >= 2 ? "medium_high" : "low_or_partial",
      allowed_outputs: ["segmenti operativi", "clienti da seguire", "rischio churn prudente", "next best action manuale"],
      blocked_outputs: ["diagnosi sensibili", "profilazione salute", "decisioni automatiche irreversibili"],
      owner_review_required: sensitiveProfiling || (autoContact && !consentKnown),
      blocked_if: {
        sensitive_profiling: sensitiveProfiling,
        auto_contact_without_consent: autoContact && !consentKnown,
      },
      detected_inputs: {
        nested_profile: Object.keys(profile).length > 0,
        observed_events_count: observedEvents.length,
        data_completeness: dataCompleteness,
      },
    };
  } else if (branch === "consent_ledger_guard") {
    const channels = normalizeList(data.channels || data.allowed_channels || data.channel, 20);
    const consentSource = textValue(data.consent_source || data.source);
    const revoked = data.revoked === true || data.opt_out === true;
    const profiling = data.profiling === true || data.behavioral_marketing === true;
    const autoContact = data.auto_contact === true || data.auto_send === true || data.send_now === true;
    const hasConsent = data.consent === true || data.marketing_consent === true || data.privacy_consent === true;
    addSignal("consent_state", "Consenso canale disponibile", hasConsent && !revoked ? 8 : 92, "consent_governance", ["consent"]);
    addSignal("consent_source", "Fonte consenso tracciata", consentSource ? 10 : 72, "consent_governance", ["audit"]);
    addSignal("channel_scope", "Canale consentito e separato", channels.length ? 12 : 58, "consent_governance", ["channel"]);
    addSignal("profiling_basis", "Base consenso profilazione", !profiling || hasConsent ? 12 : 88, "privacy", ["profiling"]);
    branchOutput = {
      consent_mode: "ledger_required_before_contact",
      channels,
      can_contact: hasConsent && !revoked && channels.length > 0,
      owner_review_required: revoked || autoContact || profiling,
      blocked_if: { missing_consent: !hasConsent, revoked, missing_source: !consentSource, auto_contact_without_consent: autoContact && (!hasConsent || revoked) },
    };
  } else if (branch === "event_taxonomy_guard") {
    const eventType = textValue(data.event_type || data.type);
    const source = textValue(data.source || data.system);
    const timestamp = textValue(data.timestamp || data.created_at || data.occurred_at);
    const subject = textValue(data.subject_id || data.customer_id || data.account_id);
    const tenantScope = textValue(data.tenant_id || payload.tenant_id);
    const idempotencyKey = textValue(data.idempotency_key || data.event_id);
    const crossTenant = data.cross_tenant === true || data.mixed_tenant === true;
    addSignal("event_shape", "Tipo evento e soggetto", eventType && subject ? 10 : 82, "event_taxonomy", ["shape"]);
    addSignal("event_source", "Fonte e timestamp", source && timestamp ? 10 : 74, "event_taxonomy", ["source"]);
    addSignal("event_idempotency", "Idempotenza webhook/sync", idempotencyKey ? 12 : 56, "event_taxonomy", ["idempotency"]);
    addSignal("tenant_scope", "Evento nello stesso tenant", crossTenant || !tenantScope ? 94 : 8, "tenant", ["scope"]);
    branchOutput = {
      event_mode: "normalized_event_contract",
      event_type: eventType,
      source,
      subject_id: subject,
      ready_for_ingest: Boolean(eventType && source && timestamp && subject && !crossTenant),
      blocked_if: { missing_event_type: !eventType, missing_source: !source, missing_timestamp: !timestamp, cross_tenant_event: crossTenant },
    };
  } else if (branch === "customer_360_guard") {
    const identityMatch = data.identity_match === true || data.customer_id || data.account_id;
    const hasHistory = data.has_history === true || Number(data.history_events ?? data.event_count ?? 0) > 0;
    const hasConsent = data.marketing_consent === true || data.consent === true;
    const hasOrders = data.has_orders === true || Number(data.order_count ?? 0) > 0;
    const crossScope = data.cross_scope === true || data.cross_tenant === true;
    const autoAction = data.auto_action === true || data.auto_send === true;
    addSignal("identity_match", "Identita cliente/account collegata", identityMatch ? 10 : 82, "customer_360", ["identity"]);
    addSignal("history_depth", "Storico cliente disponibile", hasHistory ? 14 : 68, "customer_360", ["history"]);
    addSignal("consent_context", "Consenso visibile in scheda", hasConsent ? 12 : 54, "consent_governance", ["consent"]);
    addSignal("scope_safety", "Vista nel perimetro tenant/brand", crossScope ? 96 : 8, "tenant", ["scope"]);
    branchOutput = {
      customer_360_mode: "single_operational_profile",
      ready_for_next_action: Boolean(identityMatch && hasHistory && !crossScope),
      owner_review_required: crossScope || autoAction,
      blocked_if: { missing_identity: !identityMatch, missing_history: !hasHistory, cross_scope: crossScope, auto_action_without_review: autoAction, missing_consent: !hasConsent },
      visible_sections: ["identity", "history", "orders", "consent", "support", "licenses", "next_action"].filter((section) => section !== "orders" || hasOrders),
    };
  } else if (branch === "journey_orchestration_guard") {
    const trigger = textValue(data.trigger || data.event_type);
    const goal = textValue(data.goal || data.journey_goal);
    const channel = textValue(data.channel || data.preferred_channel);
    const consent = data.consent === true || data.marketing_consent === true;
    const ownerApproved = data.owner_approved === true || data.owner_confirmed === true;
    const autoExecute = data.auto_execute === true || data.auto_send === true || data.send_now === true;
    const rollbackReady = data.rollback_ready === true || data.cancel_step_ready === true;
    addSignal("journey_contract", "Trigger, obiettivo e canale", trigger && goal && channel ? 10 : 80, "journey_orchestration", ["contract"]);
    addSignal("consent_gate", "Consenso per journey", consent ? 10 : 88, "privacy", ["consent"]);
    addSignal("execution_control", "Esecuzione confermata e reversibile", autoExecute && !ownerApproved ? 96 : rollbackReady ? 14 : 52, "automation", ["execution"]);
    branchOutput = {
      journey_mode: "draft_review_then_execute",
      trigger,
      goal,
      channel,
      can_prepare: Boolean(trigger && goal),
      execution_allowed: false,
      owner_review_required: true,
      blocked_if: { missing_consent: !consent, missing_trigger: !trigger, auto_execute_without_owner: autoExecute && !ownerApproved, missing_rollback: autoExecute && !rollbackReady },
    };
  } else if (branch === "billing_contract_guard") {
    const plan = textValue(data.plan || data.tier);
    const commercialEvent = data.payment_confirmed === true || data.contract_signed === true || data.trial_active === true || data.owner_override === true;
    const officialPrice = data.official_price === true || data.price_source === "official" || data.price_source === "contract";
    const expiry = textValue(data.expires_at || data.renewal_at);
    const keyLimit = Number(data.api_key_limit ?? data.seat_limit ?? data.smartdesk_seats ?? 0);
    const activate = data.activate_module === true || data.generate_key === true || data.provision_node === true;
    addSignal("commercial_event", "Evento commerciale valido", commercialEvent ? 8 : 92, "billing_contract", ["commercial"]);
    addSignal("price_source", "Prezzo/condizione ufficiale", officialPrice ? 10 : 80, "billing_contract", ["price"]);
    addSignal("expiry_policy", "Scadenza o rinnovo definito", expiry ? 12 : 56, "billing_contract", ["renewal"]);
    addSignal("limit_policy", "Limiti seat/API configurati", keyLimit > 0 ? 12 : 48, "billing_contract", ["limits"]);
    branchOutput = {
      billing_mode: "commercial_event_before_activation",
      plan,
      key_limit: keyLimit,
      can_activate: Boolean(commercialEvent && officialPrice && (!activate || keyLimit > 0)),
      owner_review_required: activate,
      blocked_if: { missing_commercial_event: !commercialEvent, invented_terms: !officialPrice, missing_limits_for_key_generation: activate && keyLimit <= 0 },
    };
  } else if (branch === "support_success_guard") {
    const ticketType = textValue(data.ticket_type || data.type || data.category);
    const blocked = data.blocked === true || data.customer_blocked === true;
    const renewalDays = Number(data.renewal_days ?? data.days_to_renewal ?? 999);
    const hasOwner = Boolean(textValue(data.owner || data.assignee || data.support_owner));
    const promisedSla = data.promise_sla === true || data.uncontracted_sla === true;
    const evidence = data.evidence_ready === true || data.logs_attached === true || data.context_ready === true;
    addSignal("support_impact", "Impatto supporto/onboarding", blocked ? 88 : renewalDays <= 30 ? 64 : 22, "support_success", ["impact"]);
    addSignal("ownership", "Owner support assegnato", hasOwner ? 10 : 70, "support_success", ["owner"]);
    addSignal("evidence", "Prove/log per chiusura", evidence ? 12 : 58, "support_success", ["evidence"]);
    addSignal("sla_integrity", "SLA non promesso fuori contratto", promisedSla ? 90 : 8, "support_success", ["sla"]);
    branchOutput = {
      support_mode: "success_priority_queue",
      ticket_type: ticketType,
      priority: blocked ? "high" : renewalDays <= 30 ? "medium" : "normal",
      owner_review_required: promisedSla || blocked,
      blocked_if: { promised_uncontracted_sla: promisedSla, close_without_evidence: data.close_ticket === true && !evidence, missing_owner: !hasOwner },
    };
  } else if (branch === "beauty_value_chain_guard") {
    const factoryCost = Number(data.factory_cost ?? data.C ?? 0);
    const listPrice = Number(data.list_price ?? data.L ?? 0);
    const distributorPrice = Number(data.distributor_price ?? data.PD ?? 0);
    const operatorPrice = Number(data.operator_price ?? data.PE ?? 0);
    const leakMargin = data.show_upstream_margin_to_downstream === true || data.leak_margin === true;
    const mandatoryPrice = data.mandatory_resale_price === true || data.price_imposed === true;
    const breaksChain = Boolean(distributorPrice && operatorPrice && operatorPrice <= distributorPrice);
    addSignal("chain_data", "Costo/listino/prezzi filiera presenti", [factoryCost, listPrice, distributorPrice, operatorPrice].filter((value) => value > 0).length >= 3 ? 16 : 74, "beauty_value_chain", ["pricing"]);
    addSignal("margin_chain", "Margine passaggio successivo sostenibile", breaksChain ? 92 : 18, "pricing", ["margin"]);
    addSignal("legal_positioning", "Prezzo finale non imposto", mandatoryPrice ? 96 : 8, "legal_privacy_compliance", ["pricing"]);
    addSignal("visibility_scope", "Margini riservati protetti", leakMargin ? 94 : 8, "tenant", ["scope"]);
    branchOutput = {
      value_chain_mode: "advisory_margin_guard",
      snapshot_required: true,
      owner_review_required: breaksChain || mandatoryPrice || leakMargin,
      blocked_if: { margin_chain_break: breaksChain, mandatory_resale_price: mandatoryPrice, upstream_margin_leak: leakMargin },
    };
  } else if (branch === "brand_distributor_network_guard") {
    const role = textValue(data.role || data.node_role);
    const brandScope = textValue(data.brand_scope || payload.brand_scope);
    const distributorId = textValue(data.distributor_id);
    const multiBrand = data.multi_brand === true;
    const crossBrand = data.cross_brand_data === true || data.scan_unowned_brand === true;
    const territory = textValue(data.territory || data.area || data.country);
    addSignal("node_identity", "Ruolo e brand scope nodo", role && brandScope ? 10 : 78, "network_governance", ["identity"]);
    addSignal("distributor_relation", "Relazione distributore/territorio", distributorId || territory ? 18 : 56, "network_governance", ["relation"]);
    addSignal("brand_scope_safety", "Dati brand isolati", crossBrand ? 96 : multiBrand ? 38 : 8, "tenant", ["brand_scope"]);
    branchOutput = {
      network_mode: "brand_scoped_relation_graph",
      role,
      brand_scope: brandScope,
      distributor_id: distributorId,
      owner_review_required: crossBrand,
      blocked_if: { missing_brand_scope: !brandScope, cross_brand_data_leak: crossBrand, unscoped_multi_brand: multiBrand && !brandScope },
    };
  } else if (branch === "product_inventory_guard") {
    const sku = textValue(data.sku || data.barcode || data.product_id);
    const quantity = Number(data.quantity ?? data.stock ?? 0);
    const movementType = textValue(data.movement_type || data.causal || data.event_type);
    const source = textValue(data.source || data.order_id || data.operator_id);
    const sellUnavailable = data.sell_unavailable === true || data.allow_backorder === true;
    const backorderPolicy = data.backorder_policy === true || data.order_on_request === true;
    const decrement = data.stock_decrement === true || movementType === "decrement";
    addSignal("sku_identity", "SKU/barcode/prodotto identificato", sku ? 10 : 82, "product_inventory", ["sku"]);
    addSignal("movement_trace", "Movimento stock tracciato", movementType && source ? 12 : 70, "product_inventory", ["movement"]);
    addSignal("stock_policy", "Disponibilita o backorder governato", quantity > 0 || !sellUnavailable || backorderPolicy ? 14 : 88, "commerce_fulfillment", ["stock"]);
    branchOutput = {
      inventory_mode: "audited_stock_movement",
      sku,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      owner_review_required: decrement || sellUnavailable,
      blocked_if: { missing_sku: !sku, decrement_without_source: decrement && !source, sell_unavailable_without_policy: sellUnavailable && !backorderPolicy && quantity <= 0 },
    };
  } else if (branch === "smartdesk_operations_guard") {
    const module = textValue(data.module || data.area);
    const plan = textValue(data.plan || data.tier);
    const sector = textValue(data.sector || data.center_type || data.industry, "beauty_center");
    const dataQualityScore = clampScore(data.data_quality_score ?? data.data_quality?.score ?? 0);
    const todayAppointments = Number(data.today_appointments ?? data.appointments_today ?? 0);
    const servicesMissingCosts = Number(data.services_missing_costs ?? data.missing_service_costs ?? 0);
    const clientsMissingContact = Number(data.clients_missing_contact ?? data.missing_client_contacts ?? 0);
    const unlinkedPayments = Number(data.unlinked_payments ?? data.payments_unlinked ?? 0);
    const operatorConfirmed = data.operator_confirmed === true || data.owner_confirmed === true;
    const aiChangesNumbers = data.ai_changes_numbers === true || data.correct_real_data === true;
    const autoSend = data.auto_send === true || data.send_now === true;
    const medicalClaim = data.medical_claim === true || data.protocol_medical === true;
    const missingData = [];
    if (dataQualityScore > 0 && dataQualityScore < 75) missingData.push("affidabilita dati sotto soglia");
    if (servicesMissingCosts > 0) missingData.push(`${servicesMissingCosts} costi servizio mancanti`);
    if (clientsMissingContact > 0) missingData.push(`${clientsMissingContact} clienti senza contatto completo`);
    if (unlinkedPayments > 0) missingData.push(`${unlinkedPayments} pagamenti da collegare`);
    const nextActions = [];
    if (servicesMissingCosts > 0) nextActions.push("apri servizi/operatori e completa i costi prima di leggere la redditivita");
    if (unlinkedPayments > 0) nextActions.push("apri cassa e collega pagamenti/appuntamenti prima del report");
    if (todayAppointments <= 2) nextActions.push("apri agenda e controlla slot scoperti o clienti da richiamare");
    if (clientsMissingContact > 0) nextActions.push("apri clienti e completa telefono/consenso per recall manuale o Gold");
    if (!nextActions.length) nextActions.push(plan === "gold" ? "leggi priorita Gold e scegli la prima azione da confermare" : "continua controllo manuale su agenda, cassa e report");
    addSignal("module_scope", "Modulo e piano definiti", module && plan ? 12 : 60, "smartdesk_operations", ["plan"]);
    addSignal("plan_boundary", "Differenza Silver/Gold rispettata", plan === "gold" || plan === "silver" || plan === "base" ? 10 : 58, "smartdesk_operations", ["tier"]);
    addSignal("data_completion", "Dati sufficienti per priorita utile", missingData.length ? 70 : 18, "smartdesk_operations", ["data_quality"]);
    addSignal("ai_boundary", "AI non corregge numeri reali", aiChangesNumbers ? 96 : 8, "smartdesk_operations", ["ai_gold"]);
    addSignal("operator_confirmation", "Conferma operatore per azioni", operatorConfirmed ? 14 : 52, "smartdesk_operations", ["confirm"]);
    addSignal("message_and_protocol_safety", "Messaggi/protocolli prudenti", autoSend || medicalClaim ? 94 : 8, "smartdesk_operations", ["safety"]);
    branchOutput = {
      smartdesk_mode: "operator_confirmed_actions",
      module,
      plan,
      sector,
      readout_mode: plan === "gold" ? "executive_priority" : plan === "silver" ? "readonly_operational_control" : "manual_assist",
      missing_data: missingData,
      next_actions: nextActions.slice(0, 4),
      communication_contract: plan === "gold"
        ? "dire cosa fare, perche conta, cosa manca e quale azione confermare"
        : "mostrare cosa controllare e dove intervenire manualmente",
      execution_allowed: false,
      owner_review_required: true,
      blocked_if: { ai_changes_real_numbers: aiChangesNumbers, auto_send_message: autoSend, medical_protocol_claim: medicalClaim, missing_operator_confirmation: !operatorConfirmed },
    };
  } else if (branch === "beauty_protocol_guard") {
    const objective = textValue(data.objective || data.goal || data.client_need);
    const area = textValue(data.area || data.zone);
    const technologies = normalizeList(data.technologies || data.devices, 20);
    const operatorConfirmed = data.operator_confirmed === true;
    const medical = data.medical_diagnosis === true || data.therapy_claim === true || data.guaranteed_result === true;
    const dataReady = Boolean(objective && area && technologies.length);
    addSignal("protocol_brief", "Dati protocollo completi", dataReady ? 12 : 72, "beauty_protocol", ["brief"]);
    addSignal("non_medical_boundary", "Confine non medicale rispettato", medical ? 98 : 8, "claim", ["protocol"]);
    addSignal("operator_review", "Conferma operatore", operatorConfirmed ? 12 : 64, "beauty_protocol", ["confirm"]);
    branchOutput = {
      protocol_mode: "non_medical_draft",
      objective,
      area,
      technologies,
      draft_allowed: true,
      execution_allowed: false,
      owner_review_required: true,
      blocked_if: { missing_brief: !dataReady, medical_or_guaranteed_claim: medical, missing_operator_confirmation: !operatorConfirmed },
    };
  } else if (branch === "segmentation_offer_guard") {
    const segment = textValue(data.segment || data.customer_segment || data.audience);
    const pricePolicyReady = data.price_policy_ready === true || data.price_guard_ready === true;
    const marginReady = data.margin_checked === true || data.margin_guard_ready === true;
    const officialPrice = data.has_official_price === true || data.price_source === "official";
    const inventedOffer = data.invented_offer === true || data.invented_discount === true || data.price_source === "invented";
    const crossTenantOffer = data.cross_tenant_offer === true || data.cross_tenant === true;
    if (!segment) missing.push("segment");
    if (!pricePolicyReady) missing.push("price_policy");
    addSignal("price_policy", "Listino e policy prezzo pronti", pricePolicyReady && officialPrice ? 10 : 82, "pricing", ["price_guard"]);
    addSignal("margin_policy", "Margine e sconto sostenibili", marginReady ? 12 : 62, "pricing", ["margin"]);
    addSignal("offer_integrity", "Offerta non inventata e scoped", inventedOffer || crossTenantOffer ? 96 : 12, "offer_strategy", ["scope"]);
    branchOutput = {
      offer_mode: "draft_with_price_guard",
      segment,
      price_guard_required: true,
      owner_review_required: true,
      publish_allowed: false,
      blocked_if: { invented_offer: inventedOffer, cross_tenant_offer: crossTenantOffer, missing_price_policy: !pricePolicyReady },
    };
  } else if (branch === "funnel_conversion_guard") {
    const funnelGoal = textValue(data.funnel_goal || data.goal || data.conversion_event);
    const cta = textValue(data.cta || data.call_to_action);
    const trackingReady = data.tracking_ready === true || data.consent_tracking_ready === true;
    const checkoutChange = data.checkout_change === true || data.checkout_modification === true;
    const inventedConversion = data.invented_conversion_rate === true || data.claim_guaranteed_growth === true;
    if (!funnelGoal) missing.push("funnel_goal");
    if (!cta) missing.push("cta");
    addSignal("funnel_completeness", "Obiettivo, CTA e tracking funnel", 100 - [funnelGoal, cta, trackingReady].filter(Boolean).length * 28, "conversion", ["funnel"]);
    addSignal("tracking_privacy", "Tracking privacy-safe", trackingReady ? 12 : 70, "privacy", ["tracking"]);
    addSignal("checkout_safety", "Checkout non modificato senza owner", checkoutChange ? 84 : 10, "commerce", ["checkout"]);
    addSignal("proof_integrity", "Conversioni non inventate", inventedConversion ? 92 : 10, "conversion", ["proof"]);
    branchOutput = {
      funnel_mode: "conversion_plan_review",
      funnel_goal: funnelGoal,
      cta,
      publish_allowed: false,
      owner_review_required: checkoutChange || inventedConversion,
      blocked_if: { checkout_change_without_owner: checkoutChange, invented_conversion_rate: inventedConversion, tracking_missing: !trackingReady },
    };
  } else if (branch === "content_localization_guard") {
    const sourceLocale = textValue(data.source_locale || "it");
    const targetLocale = textValue(data.target_locale || data.locale || "");
    const stableKeyPath = data.stable_key_path === true || Boolean(textValue(data.key_path));
    const htmlBlob = data.html_blob === true || data.translate_html === true;
    const glossaryReady = data.glossary_ready === true || data.tenant_glossary_ready === true;
    const claimRecheck = data.claim_recheck_ready === true || data.claim_guard_ready === true;
    if (!targetLocale) missing.push("target_locale");
    if (!stableKeyPath) missing.push("key_path");
    addSignal("atomic_strings", "Stringhe atomiche e key_path stabili", stableKeyPath && !htmlBlob ? 10 : 86, "localization", ["key_path"]);
    addSignal("glossary_readiness", "Glossario e tono tenant", glossaryReady ? 12 : 48, "translation", ["glossary"]);
    addSignal("claim_recheck", "Claim ricontrollati dopo localizzazione", claimRecheck ? 12 : 72, "claim", ["translation"]);
    branchOutput = {
      localization_mode: "structured_strings_only",
      source_locale: sourceLocale,
      target_locale: targetLocale,
      publish_allowed: false,
      fallback_locale: sourceLocale,
      owner_review_required: !claimRecheck || htmlBlob,
      blocked_if: { html_blob_translation: htmlBlob, unstable_key_path: !stableKeyPath, missing_claim_recheck: !claimRecheck },
    };
  } else if (branch === "codex_site_factory_guard") {
    const sourceUrl = textValue(data.source_url || data.source_site || data.clone_source);
    const targetTenant = textValue(data.target_tenant || data.tenant_target || payload.tenant_id || data.tenant_id);
    const sourceTenant = textValue(data.source_tenant || data.tenant_source);
    const contentScope = arrayValue(data.content_scope || data.pages || data.modules, 50);
    const hasBackup = data.has_backup === true || data.backup_ready === true;
    const stagingMode = data.staging_mode === true || data.mode === "staging" || data.publish_mode === "staging";
    const publishIntent = data.publish_intent === true || data.live_overwrite === true || data.mode === "live";
    const credentialsIncluded = data.credentials_included === true || data.copy_credentials === true || data.has_secrets === true;
    const privateDataIncluded = data.contains_private_data === true || data.copy_customer_data === true || data.copy_orders === true;
    const trackingClone = data.copy_tracking_ids === true || data.tracking_ids_included === true;
    const legalPagesIncluded = data.legal_pages_included === true || data.privacy_cookie_terms_ready === true;
    const claimPriceGuard = data.claim_price_guard_enabled === true || (data.claim_guard_enabled === true && data.price_guard_enabled === true);
    const coreConnector = data.core_connector_enabled === true || data.core_ready === true;
    if (!sourceUrl) missing.push("source_url");
    if (!targetTenant) missing.push("target_tenant");
    if (!contentScope.length) missing.push("content_scope");
    if (!legalPagesIncluded) missing.push("legal_pages");
    const tenantMismatch = Boolean(sourceTenant && targetTenant && sourceTenant !== targetTenant && data.cross_tenant_approved !== true);
    const cloneLeakRisk = credentialsIncluded || privateDataIncluded || trackingClone;
    const liveOverwriteRisk = publishIntent && (!hasBackup || !stagingMode);
    const governanceMissing = [legalPagesIncluded, claimPriceGuard, coreConnector].filter(Boolean).length;
    addSignal("missing_clone_inputs", "Input clonazione sito mancanti", missing.length * 18, "site_factory", ["clone_plan"]);
    addSignal("tenant_scope_risk", "Rischio scope tenant nella clonazione", tenantMismatch ? 95 : 10, "tenant", ["tenant_isolation"]);
    addSignal("data_leak_risk", "Rischio copia credenziali/dati privati/tracking", cloneLeakRisk ? 96 : 8, "security", ["privacy"]);
    addSignal("live_overwrite_risk", "Rischio sovrascrittura sito live", liveOverwriteRisk ? 90 : 12, "release", ["staging"]);
    addSignal("governance_readiness", "Readiness Core, claim, price e pagine legali", 100 - governanceMissing * 28, "governance", ["guardrails"]);
    branchOutput = {
      clone_mode: "staging_plan_only",
      source_url: sourceUrl,
      target_tenant: targetTenant,
      source_tenant: sourceTenant || null,
      content_scope_count: contentScope.length,
      publish_allowed: false,
      required_steps: [
        "mappa pagine, menu, form, media, prodotti/offerte e shortcode",
        "escludi credenziali, gateway, tracking ID, ordini, clienti e segreti",
        "crea staging o bozza prima del live",
        "collega Core, licenza, update policy, Claim Guard e Price Guard",
        "verifica legal pages, SEO, redirect e traduzioni strutturate",
        "richiedi owner confirmation prima di pubblicare o sovrascrivere",
      ],
      blocked_if: {
        tenant_mismatch: tenantMismatch,
        clone_leak_risk: cloneLeakRisk,
        live_overwrite_risk: liveOverwriteRisk,
      },
    };
  } else if (branch === "codex_website_visual_guard") {
    const tenant = textValue(payload.tenant_id || data.tenant_id);
    const brandKitReady = data.brand_tokens_ready === true || data.brand_kit_ready === true || data.uses_skinharmony_palette === true;
    const responsiveReady = data.responsive === true || data.mobile_verified === true;
    const textOverflow = data.text_overflow === true || data.overflowing_text === true;
    const deadButtons = Number(data.dead_buttons ?? 0);
    const nestedCards = data.nested_cards === true || data.card_inside_card === true;
    const technicalLabels = data.technical_labels === true || data.internal_labels_public === true;
    const mediaReady = data.has_media_assets === true || data.media_assets_ready === true;
    const assetRights = data.asset_rights === true || data.asset_policy === "approved";
    const buttonTargets = data.button_targets_verified === true || data.cta_links_verified === true;
    const contrast = clampScore(data.contrast_score ?? 78, 78);
    if (!brandKitReady) missing.push("brand_tokens");
    if (!responsiveReady) missing.push("mobile_responsive_check");
    if (!mediaReady) missing.push("media_assets");
    if (!buttonTargets) missing.push("button_targets");
    const brandRisk = brandKitReady ? 10 : 78;
    const layoutRisk = (textOverflow ? 45 : 0) + (nestedCards ? 25 : 0) + (!responsiveReady ? 30 : 0);
    const interactionRisk = Math.min(100, deadButtons * 25 + (buttonTargets ? 0 : 45));
    const assetRisk = mediaReady && assetRights ? 10 : mediaReady ? 45 : 70;
    const publicLabelRisk = technicalLabels ? 82 : 10;
    addSignal("brand_system_mismatch", "Brand kit o palette non pronti", brandRisk, "visual", ["brand"]);
    addSignal("layout_integrity", "Integrita layout, card e responsive", layoutRisk, "ux", ["layout"]);
    addSignal("interaction_readiness", "Pulsanti e CTA verificati", interactionRisk, "ux", ["buttons"]);
    addSignal("asset_readiness", "Asset visuali pertinenti e autorizzati", assetRisk, "visual", ["assets"]);
    addSignal("public_language", "Etichette tecniche esposte al pubblico", publicLabelRisk, "ux", ["copy"]);
    addSignal("contrast", "Contrasto e leggibilita", 100 - contrast, "accessibility", ["readability"]);
    branchOutput = {
      visual_mode: "premium_site_review",
      tenant,
      publish_allowed: false,
      skinharmony_palette: tenant.includes("skin") || data.uses_skinharmony_palette === true ? "#4FB6D6" : "tenant_brand_tokens_required",
      required_checks: [
        "desktop e mobile senza testo fuori contenitore",
        "card con dimensioni stabili e senza nesting inutile",
        "ogni pulsante collegato a pagina, dialog, salvataggio o feedback",
        "brand kit o palette SkinHarmony applicati",
        "media pertinenti con diritti/sorgente approvati",
        "nessuna etichetta tecnica interna nella UI pubblica",
      ],
      blocked_if: {
        text_overflow: textOverflow,
        dead_buttons: deadButtons > 0,
        nested_cards: nestedCards,
        technical_labels_public: technicalLabels,
        missing_asset_rights: mediaReady && !assetRights,
      },
    };
  } else if (branch === "codex_wordpress_platform_guard") {
    const platform = textValue(data.platform || data.cms || "wordpress").toLowerCase();
    const pluginType = textValue(data.plugin_type || data.module_type || "plugin");
    const usesWooCommerce = data.uses_woocommerce === true || data.woocommerce === true;
    const hasNonce = data.has_nonce === true || data.nonce === true;
    const hasCapability = data.has_capability_check === true || data.capability_check === true;
    const sanitizesInput = data.sanitizes_input === true || data.sanitize_input === true;
    const escapesOutput = data.escapes_output === true || data.escape_output === true;
    const configInZip = data.config_in_zip === true || data.writes_runtime_data_to_zip === true;
    const shortcodeMutates = data.shortcode_mutates_state === true || data.shortcode_writes_data === true;
    const assumesDependency = data.assumes_dependency === true || data.fatal_if_dependency_missing === true;
    const hardcodedSecret = data.hardcoded_secret === true || data.secret_in_code === true || data.logs_secret === true;
    const bypassCheckout = data.bypass_checkout === true || data.custom_checkout_without_woocommerce === true;
    const autoUpdate = data.auto_update_without_preflight === true || data.aggressive_auto_update === true;
    const crossTenant = data.cross_tenant_data_access === true || data.cross_tenant === true;
    const hasRestPermission = data.rest_permission_callback === true || data.rest_permissions === true || data.uses_rest !== true;
    const hasAdminFeedback = data.admin_feedback === true || data.buttons_have_feedback === true;
    const hasTests = data.has_tests === true || data.smoke_test === true || data.tested === true;
    const hasRollback = data.has_rollback === true || data.rollback_ready === true || data.update_touched !== true;
    const securityMissing = [hasNonce, hasCapability, sanitizesInput, escapesOutput, hasRestPermission].filter(Boolean).length;
    const structuralRisk = configInZip || shortcodeMutates || assumesDependency || bypassCheckout || autoUpdate || crossTenant;
    if (!platform.includes("wordpress")) warnings.push("Ramo ottimizzato per WordPress/WooCommerce: verificare adapter se piattaforma diversa.");
    if (usesWooCommerce && bypassCheckout) warnings.push("WooCommerce presente: evitare checkout parallelo non governato.");
    addSignal("wp_security_baseline", "Nonce, capability, sanitize, escape e REST permission", 100 - securityMissing * 18, "security", ["wordpress"]);
    addSignal("runtime_data_location", "Configurazione/dati runtime fuori dallo zip", configInZip ? 92 : 8, "architecture", ["plugin_data"]);
    addSignal("shortcode_contract", "Shortcode senza mutazioni di stato", shortcodeMutates ? 88 : 8, "wordpress", ["shortcode"]);
    addSignal("dependency_safety", "Feature detection e fallback dipendenze", assumesDependency ? 82 : 12, "compatibility", ["dependency"]);
    addSignal("secret_handling", "Segreti non hardcoded e non loggati", hardcodedSecret ? 98 : 6, "security", ["secret"]);
    addSignal("woocommerce_contract", "Checkout WooCommerce rispettato", bypassCheckout ? 86 : 10, "commerce", ["woocommerce"]);
    addSignal("update_safety", "Update con preflight, manifest e rollback", autoUpdate || !hasRollback ? 72 : 12, "release", ["update"]);
    addSignal("admin_operability", "Admin UI con feedback e test", hasAdminFeedback && hasTests ? 12 : 46, "ux", ["admin"]);
    branchOutput = {
      platform_mode: "wordpress_plugin_engineering_guard",
      platform,
      plugin_type: pluginType,
      publish_allowed: false,
      required_checks: [
        "verifica nonce, capability, sanitize input ed escape output",
        "usa option/post meta/CPT/storage controllato per dati runtime, non lo zip",
        "shortcode solo render/read; mutazioni tramite REST/admin-post/AJAX autorizzati",
        "WooCommerce tramite product/order meta, status hook e thank-you flow",
        "feature detection per dipendenze opzionali e fallback senza fatal error",
        "manifest/update con checksum, preflight, rollback e owner confirmation",
        "admin UI con pulsanti collegati, feedback visibile e test smoke",
      ],
      blocked_if: {
        missing_security_baseline: securityMissing < 5,
        config_inside_zip: configInZip,
        shortcode_mutates_state: shortcodeMutates,
        fatal_dependency_assumption: assumesDependency,
        hardcoded_secret: hardcodedSecret,
        checkout_bypass: bypassCheckout,
        unsafe_update: autoUpdate,
        cross_tenant_data_access: crossTenant,
      },
      recommended_architecture: {
        data_layer: "options/post_meta/cpt/custom_tables_if_needed",
        render_layer: "shortcodes_blocks_templates_read_only",
        mutation_layer: "rest_admin_post_ajax_with_nonce_capability",
        commerce_layer: usesWooCommerce ? "woocommerce_hooks_order_meta_license_gate" : "adapter_or_quote_first",
        external_layer: "adapter_timeout_retry_audit_no_secret_logs",
      },
      structural_risk: structuralRisk,
    };
  } else if (branch === "data_integration_orchestration") {
    const sourceSystems = arrayValue(data.source_systems || data.sources || data.source_system, 20);
    const targetSystems = arrayValue(data.target_systems || data.targets || data.target_system, 20);
    const hasSchemaMapping = data.has_schema_mapping === true || data.schema_mapping_ready === true;
    const idempotent = data.idempotent === true || data.idempotency_key === true;
    const retryReady = data.retry_policy === true || data.has_retry_policy === true;
    const timeoutReady = data.timeout_ready === true || data.has_timeout === true;
    const dedupReady = data.deduplication === true || data.has_deduplication === true;
    const webhookSigned = data.webhook_signature === true || data.signed_webhook === true || data.webhook !== true;
    const containsPii = data.contains_pii === true || data.personal_data === true;
    const directDb = data.direct_db_access === true || data.direct_cross_tenant_db_access === true;
    const crossTenant = data.cross_tenant === true || data.cross_tenant_data_access === true;
    const secretsInPayload = data.secrets_in_payload === true || data.logs_secret === true || data.secret_in_payload === true;
    const bulkSync = data.bulk_sync === true || data.sync_mode === "bulk";
    if (!sourceSystems.length) missing.push("source_systems");
    if (!targetSystems.length) missing.push("target_systems");
    if (!hasSchemaMapping) missing.push("schema_mapping");
    const reliabilityReady = [idempotent, retryReady, timeoutReady, dedupReady, webhookSigned].filter(Boolean).length;
    addSignal("mapping_readiness", "Readiness mapping dati sorgente/destinazione", hasSchemaMapping ? 12 : 78, "data_integration", ["mapping"]);
    addSignal("idempotency_reliability", "Idempotenza, retry, timeout, deduplica e firma webhook", 100 - reliabilityReady * 18, "data_integration", ["sync"]);
    addSignal("tenant_data_risk", "Rischio cross-tenant o accesso DB diretto", directDb || crossTenant ? 96 : 8, "tenant", ["tenant_isolation"]);
    addSignal("payload_sensitivity", "PII o segreti nel payload/log", secretsInPayload ? 98 : containsPii ? 58 : 8, "privacy", ["payload"]);
    addSignal("bulk_sync_risk", "Sync massivo senza controlli completi", bulkSync && reliabilityReady < 4 ? 78 : 14, "data_integration", ["bulk_sync"]);
    branchOutput = {
      integration_mode: "adapter_snapshot_sync",
      source_systems: sourceSystems,
      target_systems: targetSystems,
      required_checks: [
        "mappa schema, owner del dato e tenant scope",
        "usa idempotency key, retry bounded, timeout e deduplica",
        "firma/verifica webhook e niente segreti nei log",
        "usa snapshot minimali o aggregati per PII e dati cliente",
        "audit per import/export/sync e dead-letter manuale se fallisce",
      ],
      blocked_if: {
        missing_schema_mapping: !hasSchemaMapping,
        direct_db_access: directDb,
        cross_tenant_scope: crossTenant,
        secrets_in_payload: secretsInPayload,
        non_idempotent_bulk_sync: bulkSync && !idempotent,
      },
    };
  } else if (branch === "commerce_fulfillment_guard") {
    const hasOfficialPrice = data.has_official_price === true || data.official_price === true || data.price_source === "official";
    const checkoutConfirmed = data.checkout_confirmed === true || data.payment_status === "paid" || data.order_status === "paid";
    const contractOrTrial = data.contract_approved === true || data.trial_authorized === true || data.owner_override === true;
    const idempotency = data.order_idempotency_key === true || Boolean(textValue(data.idempotency_key));
    const stockPolicy = data.stock_policy_ready === true || data.stock_policy === "configured";
    const licensePolicy = data.license_policy_ready === true || data.license_policy === "configured";
    const refundPolicy = data.refund_policy_ready === true || data.refund_policy === "configured";
    const settlementPolicy = data.settlement_policy_ready === true || data.settlement_policy === "configured" || data.settlement_required !== true;
    const inventedPrice = data.invented_price === true || data.price_source === "invented";
    const licenseWithoutPayment = data.license_without_payment === true || (data.generate_license === true && !checkoutConfirmed && !contractOrTrial);
    const chargeWithoutCheckout = data.charge_without_checkout === true || data.manual_charge === true;
    const oversellStock = data.oversell_stock === true || data.stock_negative_allowed === true;
    const doubleFulfillment = data.double_fulfillment === true || data.duplicate_order_processing === true;
    if (!hasOfficialPrice) missing.push("official_price");
    if (!idempotency) missing.push("idempotency_key");
    const policyReady = [stockPolicy, licensePolicy, refundPolicy, settlementPolicy].filter(Boolean).length;
    addSignal("price_source", "Prezzo da listino ufficiale/contratto", inventedPrice ? 98 : hasOfficialPrice ? 8 : 64, "commerce", ["price"]);
    addSignal("fulfillment_auth", "Evento commerciale prima di licenza/seat/key", licenseWithoutPayment || chargeWithoutCheckout ? 94 : 12, "commerce", ["license"]);
    addSignal("idempotency", "Fulfillment idempotente", idempotency && !doubleFulfillment ? 10 : 76, "commerce", ["order"]);
    addSignal("policy_readiness", "Policy stock/licenze/refund/settlement", 100 - policyReady * 22, "commerce", ["policy"]);
    addSignal("stock_risk", "Stock e riserva merce coerenti", oversellStock ? 84 : 12, "stock", ["warehouse"]);
    branchOutput = {
      fulfillment_mode: "quote_or_checkout_first",
      activation_allowed: false,
      policy_ready_count: policyReady,
      required_checks: [
        "usa prezzo ufficiale, contratto o preventivo approvato",
        "ordine/pagamento/trial/override owner prima di licenza o App Key",
        "idempotency key per ordini, seat, stock e chiavi",
        "stock, acconto/saldo e settlement configurabili per azienda",
        "refund e chargeback con audit e nessun payout automatico non autorizzato",
      ],
      blocked_if: {
        invented_price: inventedPrice,
        license_without_commercial_event: licenseWithoutPayment,
        charge_without_checkout: chargeWithoutCheckout,
        double_fulfillment: doubleFulfillment,
        oversell_stock: oversellStock,
      },
    };
  } else if (branch === "observability_roi_guard") {
    const hasAudit = data.has_audit_id === true || Boolean(textValue(data.audit_id));
    const hasTrace = data.has_trace_id === true || Boolean(textValue(data.trace_id));
    const metricsDefined = data.metrics_defined === true || Array.isArray(data.metrics);
    const evidenceEnabled = data.evidence_enabled === true || data.audit_evidence === true;
    const healthcheck = data.health_check === true || data.healthcheck_ready === true;
    const logsPii = data.logs_pii === true || data.pii_in_logs === true;
    const logsSecret = data.logs_secret === true || data.secret_in_logs === true;
    const roiMetrics = arrayValue(data.roi_metrics || data.value_metrics, 20);
    const budget = Number(data.performance_budget_ms ?? data.latency_budget_ms ?? 0);
    const latency = Number(data.latency_ms ?? 0);
    const budgetExceeded = budget > 0 && latency > budget;
    if (!hasAudit) missing.push("audit_id");
    if (!metricsDefined) missing.push("metrics_defined");
    if (!healthcheck) missing.push("health_check");
    const observabilityReady = [hasAudit, hasTrace, metricsDefined, evidenceEnabled, healthcheck].filter(Boolean).length;
    addSignal("audit_traceability", "Audit, trace ed evidence layer", 100 - observabilityReady * 18, "observability", ["audit"]);
    addSignal("roi_measurability", "Metriche ROI e valore operativo", roiMetrics.length ? 12 : 68, "roi", ["telemetry"]);
    addSignal("log_safety", "PII o segreti nei log", logsSecret ? 98 : logsPii ? 82 : 8, "privacy", ["logs"]);
    addSignal("performance_budget", "Budget performance e health", budgetExceeded ? 72 : healthcheck ? 12 : 52, "performance", ["health"]);
    branchOutput = {
      observability_mode: "audit_evidence_roi",
      roi_metrics: roiMetrics,
      required_checks: [
        "audit_id e trace_id per ogni automazione",
        "log senza PII/segreti e con dati mascherati",
        "metriche ROI: tempo risparmiato, errori evitati, lead recuperati, costi ridotti",
        "health check, latency budget e stato degradato leggibile",
      ],
      blocked_if: {
        automation_without_audit: !hasAudit,
        pii_in_logs: logsPii,
        secret_in_logs: logsSecret,
        no_healthcheck: !healthcheck,
        roi_claim_without_metrics: data.roi_claim === true && !roiMetrics.length,
      },
    };
  } else if (branch === "legal_privacy_compliance_guard") {
    const consentRequired = data.consent_required === true || data.contains_personal_data === true || data.contains_sensitive_data === true;
    const consentCollected = data.consent_collected === true || data.consent_status === "collected";
    const sensitive = data.contains_sensitive_data === true || data.health_data === true || data.images === true || data.payment_data === true;
    const retention = data.retention_policy === true || data.retention_policy_ready === true;
    const dpaReady = data.dpa_ready === true || data.processor_agreement_ready === true || data.external_processor !== true;
    const claimReviewed = data.claim_reviewed === true || data.owner_claim_approval === true || data.publish_claim !== true;
    const deleteExportReady = data.delete_export_ready === true || data.data_subject_request_ready === true;
    const legalGuarantee = data.legal_guarantee_claimed === true || /compliance assoluta|garantito per legge|legalmente garantito/i.test(textValue(data.text || data.claim || data.copy));
    const crossBrand = data.cross_brand_policy_leak === true || data.cross_tenant === true;
    const privacyRisk = consentRequired && !consentCollected;
    if (consentRequired && !consentCollected) missing.push("consent");
    if (!retention) missing.push("retention_policy");
    addSignal("consent_readiness", "Consenso e finalita dati", privacyRisk ? 92 : 10, "privacy", ["gdpr"]);
    addSignal("sensitive_data_scope", "Dati sensibili, immagini, pagamenti o salute", sensitive && !dpaReady ? 84 : sensitive ? 48 : 8, "privacy", ["sensitive"]);
    addSignal("claim_review", "Claim/revisione owner prima della pubblicazione", claimReviewed ? 12 : 82, "compliance", ["claim"]);
    addSignal("tenant_policy_isolation", "Isolamento policy brand/tenant", crossBrand ? 96 : 8, "tenant", ["brand_scope"]);
    addSignal("legal_language", "Promesse legali/compliance assoluta", legalGuarantee ? 94 : 8, "legal", ["wording"]);
    branchOutput = {
      compliance_mode: "advisory_with_owner_review",
      legal_advice_replacement: false,
      required_checks: [
        "consenso, finalita, minimizzazione e retention",
        "DPA/processor agreement se dati passano da fornitori esterni",
        "claim pubblici e pricing come governance/advisory, non imposizione",
        "data export/delete request con audit",
        "nessuna garanzia legale automatica nel copy pubblico",
      ],
      blocked_if: {
        personal_data_without_consent: privacyRisk,
        sensitive_data_without_scope: sensitive && !dpaReady,
        unreviewed_claim_publish: !claimReviewed,
        cross_brand_policy_leak: crossBrand,
        legal_guarantee_claim: legalGuarantee,
        missing_retention_policy: !retention,
      },
      delete_export_ready: deleteExportReady,
    };
  } else if (branch === "agent_orchestration_guard") {
    const actionType = textValue(data.action_type || payload.action_type, "advisory");
    const gatewayMode = textValue(data.gateway_mode || payload.gateway_mode, "advisory");
    const ownerConfirmation = data.owner_confirmation === true || data.owner_confirmed === true || data.owner_confirmation_received === true;
    const sandbox = data.sandbox === true || data.dry_run === true || data.local_only === true;
    const rollback = data.rollback === true || data.rollback_ready === true || data.undo_ready === true;
    const runbookId = textValue(data.runbook_id || data.workflow_id);
    const autonomous = data.autonomous_execution === true || data.agent_auto_execute === true;
    const destructive = data.destructive_action === true || ["delete", "git_reset_hard", "drop_database"].includes(actionType);
    const publish = data.publish_intent === true || actionType === "publish";
    const payment = data.payment_action === true || actionType === "payment" || actionType === "charge";
    const crossTenant = data.cross_tenant === true || data.cross_tenant_data_access === true;
    const sensitive = destructive || publish || payment || crossTenant || actionType === "update" || actionType === "deploy";
    if (sensitive && !ownerConfirmation) missing.push("owner_confirmation");
    if (sensitive && !rollback && !sandbox) missing.push("rollback_or_sandbox");
    addSignal("action_sensitivity", "Sensibilita azione agente", destructive ? 98 : payment ? 88 : publish || crossTenant ? 76 : actionType === "update" || actionType === "deploy" ? 58 : 18, "agent_orchestration", ["action"]);
    addSignal("owner_confirmation", "Conferma owner tracciata", sensitive && !ownerConfirmation ? 86 : 8, "agent_orchestration", ["confirm"]);
    addSignal("rollback_sandbox", "Sandbox, dry-run o rollback", sensitive && !rollback && !sandbox ? 76 : 10, "agent_orchestration", ["rollback"]);
    addSignal("prompt_only_decision", "Decisione non affidata solo al prompt", autonomous && !runbookId ? 74 : 10, "agent_orchestration", ["runbook"]);
    branchOutput = {
      orchestration_mode: "core_decides_agent_executes",
      action_type: actionType,
      gateway_mode: gatewayMode,
      mediation_states: ["allow", "rewrite", "confirm", "defer", "sandbox", "block", "rollback_required"],
      execution_allowed_advisory: false,
      required_checks: [
        "decision contract prima di scrivere, pubblicare, deployare, pagare o modificare tenant",
        "owner confirmation esplicita e limitata allo scope",
        "dry-run/sandbox o rollback per azioni sensibili",
        "audit con input, verdict, branch usato, azione, esito",
      ],
      blocked_if: {
        destructive_without_owner: destructive && !ownerConfirmation,
        autonomous_sensitive_action: autonomous && sensitive,
        cross_tenant_write: crossTenant,
        no_rollback_or_sandbox: sensitive && !rollback && !sandbox,
      },
    };
  } else if (branch === "runtime_deployment_scaling_guard") {
    const targetRuntime = textValue(data.target_runtime || data.runtime_mode || "local");
    const envReady = data.env_vars_configured === true || data.environment_ready === true;
    const secretsInEnv = data.secrets_in_env === true || data.secret_store_ready === true || data.has_secrets !== true;
    const secretLeak = data.secret_in_repo === true || data.secret_in_zip === true || data.secret_in_logs === true;
    const migrationPlan = data.migration_plan === true || data.migration_plan_ready === true || data.database_migration !== true;
    const backupReady = data.backup_ready === true || data.has_backup === true || data.database_migration !== true;
    const rollbackReady = data.rollback_ready === true || data.has_rollback === true;
    const healthcheckReady = data.healthcheck_ready === true || data.health_check === true;
    const canary = data.canary_enabled === true || data.rollout_strategy === "canary" || data.deploy_to_production !== true;
    const preflight = data.preflight_passed === true || data.preflight_ready === true || data.deploy_to_production !== true;
    const queueRequired = data.queue_required === true || data.high_volume === true;
    const queueReady = data.queue_ready === true || queueRequired === false;
    const storageReady = data.storage_ready === true || data.database_ready === true || targetRuntime === "local";
    const productionDeploy = data.deploy_to_production === true || data.environment === "production";
    const unsafeProduction = productionDeploy && (!preflight || !rollbackReady || !healthcheckReady);
    if (!envReady && targetRuntime !== "local") missing.push("env_vars");
    if (!healthcheckReady) missing.push("healthcheck");
    if (productionDeploy && !rollbackReady) missing.push("rollback");
    addSignal("runtime_readiness", "Runtime, env e storage pronti", envReady && storageReady ? 12 : 66, "runtime", ["render"]);
    addSignal("secret_handling", "Segreti fuori da repo/zip/log", secretLeak ? 98 : secretsInEnv ? 8 : 62, "security", ["secret"]);
    addSignal("migration_safety", "Migrazione con piano e backup", migrationPlan && backupReady ? 12 : 82, "deployment", ["migration"]);
    addSignal("release_safety", "Preflight, healthcheck, rollback e canary", unsafeProduction ? 92 : productionDeploy ? 38 : 12, "release", ["deploy"]);
    addSignal("scaling_readiness", "Queue/cache/rate limit per carico alto", queueRequired && !queueReady ? 76 : 10, "scaling", ["queue"]);
    branchOutput = {
      deployment_mode: "local_shared_dedicated_runtime_guard",
      target_runtime: targetRuntime,
      production_deploy: productionDeploy,
      required_checks: [
        "segreti solo in env/secret store",
        "preflight, healthcheck, rollback e canary prima del live",
        "backup e migration plan per cambio schema/storage",
        "queue/cache/rate limit se high-volume",
        "degrade-safe se Core remoto non risponde",
      ],
      blocked_if: {
        production_deploy_without_preflight: productionDeploy && !preflight,
        migration_without_backup: !migrationPlan || !backupReady,
        secret_leak: secretLeak,
        missing_rollback: productionDeploy && !rollbackReady,
        missing_healthcheck: !healthcheckReady,
        queue_required_not_ready: queueRequired && !queueReady,
      },
    };
  } else if (branch === "cosmetic_chemistry") {
    const active = textValue(data.active || data.ingredient || data.hero_ingredient);
    const functionText = textValue(data.function || data.cosmetic_function);
    if (!active) missing.push("active");
    if (!functionText) missing.push("cosmetic_function");
    const evidenceScore = clampScore(data.evidence_score ?? (data.sources_provided ? 75 : 35));
    const claimResult = claimShieldCheck({ text: `${active} ${functionText} ${textValue(data.claims)}`, context: data.context || {} });
    addSignal("evidence_quality", "Qualita supporto attivo cosmetico", evidenceScore, "product", ["cosmetic"]);
    addSignal("claim_risk", "Rischio claim su attivo cosmetico", claimResult.risk_score, "claim", ["claim_guard"]);
    branchOutput = {
      active,
      cosmetic_function: functionText,
      positioning_rule: "Posizionare come supporto cosmetico/beauty, non come cura, terapia o effetto medico.",
      web_research_required: !data.sources_provided,
      owner_review_required: true,
    };
  } else if (branch === "skinharmony_analyzer") {
    const scores = Array.isArray(data.scores) ? data.scores.map((item) => ({
      key: textValue(item?.key),
      label: textValue(item?.label || item?.key),
      score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null,
    })).filter((item) => item.key) : [];
    if (!scores.length) missing.push("scores");
    const byKey = Object.fromEntries(scores.map((item) => [item.key, item]));
    const expectedKeys = ["skin_tone_brightness", "water_oil_balance", "texture_fine_lines", "redness_sensitivity_signals", "spots_pigmentation_signals", "pores_texture"];
    const missingScores = expectedKeys.filter((key) => !byKey[key]);
    const acquisition = data.acquisition && typeof data.acquisition === "object" ? data.acquisition : {};
    const explicitQuality = Number.isFinite(Number(data.data_quality_score));
    const dataQualityScore = clampScore(explicitQuality ? data.data_quality_score : 70);
    const qualityReasons = [...(dataQualityScore < 65 ? ["aggregate_quality_low"] : []), ...(Number(acquisition.focus_score) < 65 ? ["focus_low"] : []), ...(Number(acquisition.illumination_score) < 65 ? ["illumination_low"] : []), ...(!acquisition.capture_protocol_id ? ["capture_protocol_missing"] : []), ...(!acquisition.device_model ? ["device_provenance_missing"] : [])];
    const abstain = explicitQuality && dataQualityScore < 65;
    const getScore = (key) => Number.isFinite(Number(byKey[key]?.score)) ? Number(byKey[key].score) : null;
    const attention = (key, fallback = 52) => {
      const score = getScore(key);
      return score == null ? fallback : clampScore(100 - score);
    };
    const relationshipRules = [];
    const pores = getScore("pores_texture");
    const texture = getScore("texture_fine_lines");
    const hydration = getScore("water_oil_balance");
    const redness = getScore("redness_sensitivity_signals");
    const pigment = getScore("spots_pigmentation_signals");
    const tone = getScore("skin_tone_brightness");
    if (pores != null && pores < 50 && hydration != null && hydration >= 80) {
      relationshipRules.push("Pori bassi con idratazione buona: priorita su grana, film superficiale e pulizia progressiva, non su idratazione generica.");
    }
    if (pores != null && pores < 55 && texture != null && texture < 80) {
      relationshipRules.push("Pori e texture sono collegati: la pelle va letta come qualita della superficie, non come parametro isolato.");
    }
    if (redness != null && redness <= 55 && pores != null && pores < 60) {
      relationshipRules.push("Reattivita media con pori bassi: percorso estetico graduale, evitando approcci aggressivi iniziali.");
    }
    if (pigment != null && pigment >= 85) {
      relationshipRules.push("Discromie alte/stabili: non spostare la priorita sulle macchie se il quadro indica pori o texture.");
    }
    if (tone != null && tone < 70 && hydration != null && hydration >= 75) {
      relationshipRules.push("Luminosita da sostenere con idratazione gia buona: lavorare su uniformita superficiale e grana.");
    }
    const domains = [
      {
        id: "pores_texture_matrix",
        label: "pori, grana e texture",
        score: Math.round(clampScore(attention("pores_texture") * 0.55 + attention("texture_fine_lines") * 0.25 + attention("water_oil_balance") * 0.1 + attention("redness_sensitivity_signals") * 0.1 + (pores != null && pores < 50 && hydration != null && hydration >= 80 ? 10 : 0) + (pores != null && pores < 55 && texture != null && texture < 80 ? 8 : 0) + (redness != null && redness <= 55 && pores != null && pores < 60 ? 7 : 0))),
      },
      {
        id: "sensitivity_reactivity_matrix",
        label: "reattivita e tolleranza cutanea",
        score: Math.round(clampScore(attention("redness_sensitivity_signals") * 0.55 + attention("skin_tone_brightness") * 0.2 + attention("water_oil_balance") * 0.15 + attention("pores_texture") * 0.1 + (redness != null && redness <= 55 && pores != null && pores < 60 ? 7 : 0))),
      },
      {
        id: "barrier_hydration_matrix",
        label: "barriera, idratazione e comfort",
        score: Math.round(clampScore(attention("water_oil_balance") * 0.45 + attention("skin_tone_brightness") * 0.25 + attention("redness_sensitivity_signals") * 0.2 + attention("texture_fine_lines") * 0.1)),
      },
      {
        id: "pigmentation_tone_matrix",
        label: "discromie e uniformita del tono",
        score: Math.round(clampScore(attention("spots_pigmentation_signals") * 0.55 + attention("skin_tone_brightness") * 0.25 + attention("redness_sensitivity_signals") * 0.1 + attention("texture_fine_lines") * 0.1 - (pigment != null && pigment >= 85 ? 8 : 0))),
      },
      {
        id: "aging_texture_matrix",
        label: "qualita della superficie e segni di eta cutanea",
        score: Math.round(clampScore(attention("texture_fine_lines") * 0.45 + attention("skin_tone_brightness") * 0.25 + attention("water_oil_balance") * 0.2 + attention("spots_pigmentation_signals") * 0.1)),
      },
    ].sort((a, b) => b.score - a.score);
    const dominant = domains[0] || null;
    const secondary = domains.filter((item) => item.id !== dominant?.id && item.score >= 42).slice(0, 3);
    const products = Array.isArray(data.products) ? data.products : [];
    const protocols = Array.isArray(data.protocols) ? data.protocols : [];
    const reportText = textValue(data.report_text || data.proposed_text || data.client_language);
    const claimResult = reportText ? claimShieldCheck({ text: reportText, context: data.context || {} }) : { risk_score: 10, issues: [] };
    domains.forEach((domain) => addSignal(domain.id, `Skin analyzer ${domain.label}`, domain.score, "skin_analysis", ["ensemble", domain.id]));
    addSignal("claim_risk", "Rischio claim testo analyzer", claimResult.risk_score, "claim", ["claim_guard"]);
    addSignal("catalog_readiness", "Catalogo prodotti/protocolli disponibile", products.length || protocols.length ? 20 : 65, "catalog", ["products", "protocols"]);
    addSignal("acquisition_quality", "Qualita e provenienza acquisizione", 100 - dataQualityScore, "skin_analysis", ["quality", "provenance"]);
    const previousScores = Array.isArray(data.previous_scores) ? Object.fromEntries(data.previous_scores.map((item) => [textValue(item?.key), Number(item?.score)])) : {};
    const comparable = Boolean(data.previous_scores?.length && acquisition.capture_protocol_id && acquisition.device_model && acquisition.capture_protocol_id === data.previous_acquisition?.capture_protocol_id && acquisition.device_model === data.previous_acquisition?.device_model);
    const longitudinalDeltas = comparable ? Object.fromEntries(scores.filter((item) => Number.isFinite(previousScores[item.key])).map((item) => [item.key, Math.round((item.score - previousScores[item.key]) * 10) / 10])) : {};
    const learningContext = data.learning_context && typeof data.learning_context === "object" ? data.learning_context : {};
    const learningEligible = comparable && learningContext.outcome_verified === true && learningContext.human_reviewed === true && Number(learningContext.comparable_capture_count) >= 2;
    branchOutput = {
      branch: "skinharmony_skin_ensemble_v2",
      dominant_pattern: abstain ? null : dominant,
      secondary_patterns: abstain ? [] : secondary,
      all_patterns: domains,
      score_relationships: relationshipRules,
      protective_signals: [
        ...(hydration != null && hydration >= 80 ? ["idratazione rilevata buona"] : []),
        ...(pigment != null && pigment >= 85 ? ["discromie non prioritarie nel quadro attuale"] : []),
        ...(redness != null && redness <= 55 ? ["reattivita da rispettare nella progressione"] : []),
      ],
      products_loaded: products.length,
      protocols_loaded: protocols.length,
      data_quality: { score: dataQualityScore, abstained: abstain, repeat_acquisition_recommended: abstain, reasons: qualityReasons, missing_scores: missingScores },
      longitudinal: { available: Boolean(data.previous_scores?.length), comparable, deltas: longitudinalDeltas, interpretation_allowed: comparable && !abstain },
      fairness: { audit_required: true, individual_group_adjustment_allowed: false, minimum_rule: "report quality and abstention rates by represented skin-tone groups" },
      learning: { eligible_candidate: learningEligible, activation_allowed: false, requires: ["verified_outcome", "human_review", "comparable_capture_series", "core_regression_gate"] },
      suggested_direction: abstain ? "Ripetere l'acquisizione con qualita e protocollo controllati prima di interpretare." : dominant?.id === "pores_texture_matrix"
        ? "Percorso riequilibrante su grana, pori e texture, con progressione rispettosa della reattivita."
        : dominant?.id === "sensitivity_reactivity_matrix"
          ? "Percorso comfort e tolleranza prima di stimoli estetici piu intensivi."
          : "Percorso estetico basato sul pattern dominante e sui segnali secondari.",
      product_rule: products.length ? "Selezionare solo prodotti taggati sui pattern dominanti." : "Nessun prodotto caricato: non inventare nomi commerciali.",
      protocol_rule: protocols.length ? "Selezionare solo protocolli caricati e coerenti con pattern dominante e tolleranza." : "Nessun protocollo caricato: indicare solo direzione estetica generale.",
      blocked_claims: claimResult.issues.map((issue) => issue.term),
      visible_language_rule: "Report professionale finito, non linguaggio provvisorio o medico.",
    };
  } else if (branch === "technology_market") {
    const technology = textValue(data.technology || data.device || data.protocol);
    if (!technology) missing.push("technology");
    const demand = clampScore(data.demand_score ?? data.trend_strength ?? 50);
    const maturity = clampScore(data.maturity_score ?? data.protocol_readiness ?? 50);
    const compliance = clampScore(data.compliance_readiness ?? 60);
    addSignal("demand", "Domanda tecnologia", demand, "market", ["technology"]);
    addSignal("maturity", "Maturita protocollo/uso", maturity, "technology", ["readiness"]);
    addSignal("compliance", "Prudenza claim tecnologia", 100 - compliance, "claim", ["claim_guard"]);
    branchOutput = {
      technology,
      suggested_positioning: demand >= 65 && maturity >= 60 ? "priority_offer" : "education_first",
      publish_rule: "Prima education e proof controllata, poi CTA. Nessun claim terapeutico.",
    };
  } else if (branch === "business_strategy") {
    const revenue = clampScore(data.revenue_health ?? data.mrr_health ?? 50);
    const churn = clampScore(data.churn_risk ?? data.inactivity_risk ?? 45);
    const pipeline = clampScore(data.pipeline_quality ?? data.forecast_quality ?? 50);
    const ops = clampScore(data.operational_readiness ?? data.readiness ?? 55);
    addSignal("revenue_health", "Salute revenue/MRR", 100 - revenue, "finance", ["revenue"]);
    addSignal("churn_risk", "Rischio churn/inattivita", churn, "crm", ["churn"]);
    addSignal("pipeline_quality", "Qualita pipeline commerciale", 100 - pipeline, "crm", ["pipeline"]);
    addSignal("operational_readiness", "Readiness operativa", 100 - ops, "operations", ["readiness"]);
    branchOutput = {
      next_best_focus: churn >= 65 ? "retention_first" : pipeline < 55 ? "pipeline_cleanup" : "controlled_growth",
      manager_view: "Mostrare prima rischi e prossime azioni, poi numeri.",
    };
  } else if (branch === "translation_governance") {
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) missing.push("items");
    const unstableKeys = items.filter((item) => !textValue(item.key_path) || !textValue(item.source_text)).length;
    const sourceLang = textValue(data.source_lang, "it");
    const targetLang = textValue(data.target_lang, "en");
    const supportedLanguages = ["it", "en", "fr", "es"];
    const unsupportedLanguage = !supportedLanguages.includes(sourceLang) || !supportedLanguages.includes(targetLang);
    const htmlBlob = items.some((item) => /<\/?[a-z][\s\S]*>/i.test(textValue(item.source_text)));
    const alteredProtectedTokens = items.filter((item) => {
      const source = textValue(item.source_text);
      const translated = textValue(item.translated_text || item.target_text);
      if (!translated) return false;
      const tokens = source.match(/(\[[^\]]+\]|\{[^}]+\}|%[a-zA-Z0-9_$]+%|https?:\/\/\S+|\b\d+[,.]?\d*\s?(?:€|EUR|%))/g) || [];
      return tokens.some((token) => !translated.includes(token));
    }).length;
    const readiness = Math.max(0, 100 - missing.length * 35 - unstableKeys * 12 - (unsupportedLanguage ? 25 : 0) - (htmlBlob ? 30 : 0) - alteredProtectedTokens * 18);
    addSignal("payload_readiness", "Readiness payload traduzioni strutturate", readiness, "translation", ["core_translation"]);
    addSignal("unstable_keys", "Key path instabili o stringhe mancanti", Math.min(100, unstableKeys * 18), "translation", ["key_path"]);
    addSignal("protected_tokens", "Placeholder, shortcode, URL, prezzi o variabili alterati", Math.min(100, alteredProtectedTokens * 30), "translation", ["protected_tokens"]);
    addSignal("html_blob", "HTML intero inviato alla traduzione", htmlBlob ? 86 : 6, "translation", ["html"]);
    branchOutput = {
      translation_mode: "structured_strings_only",
      source_lang: sourceLang,
      target_lang: targetLang,
      item_count: items.length,
      unstable_item_count: unstableKeys,
      altered_protected_token_count: alteredProtectedTokens,
      html_blob_detected: htmlBlob,
      supported_languages: supportedLanguages,
      fallback_policy: "fallback_to_it",
      review_required: unsupportedLanguage || htmlBlob || alteredProtectedTokens > 0 || unstableKeys > 0,
    };
  } else if (branch === "translator_marketing_governance") {
    const items = Array.isArray(data.items) ? data.items : [];
    const surfaceType = textValue(data.surface_type || data.surface || data.copy_surface, "ui_strings");
    const copyClass = textValue(data.copy_class || data.text_type || data.intent, "ui_label");
    const sourceLang = textValue(data.source_lang, "it");
    const targetLang = textValue(data.target_lang, "en");
    const pluginId = textValue(data.plugin_id || data.app_id || data.integration_id);
    const appName = textValue(data.app_name || data.product_name || data.application);
    const fallbackPolicy = textValue(data.fallback_policy || data.fallback, "fallback_to_it");
    const localeTarget = textValue(data.locale_target || data.locale || targetLang);
    if (!items.length) missing.push("items");
    if (!pluginId && !appName) missing.push("plugin_or_app_identity");
    const unstableItems = items.filter((item) => !textValue(item.key_path) || !textValue(item.source_text)).length;
    const ctaItems = items.filter((item) => /cta|button|call.?to.?action|hero/i.test(textValue(item?.surface || item?.key_path || item?.type)));
    const pricingItems = items.filter((item) => /price|pricing|sconto|offerta|promo|canone|monthly|annuale/i.test(textValue(item?.source_text) + " " + textValue(item?.key_path)));
    const claimItems = items.filter((item) => /garant|risultat|tratt|cura|medical|terap/i.test(textValue(item?.source_text)));
    const htmlBlobItems = items.filter((item) => /<[^>]+>/.test(textValue(item?.source_text)) || /html|rich_text|wysiwyg/i.test(textValue(item?.surface || item?.type)));
    const localizedLabelsOnly = items.every((item) => ["localized_label", "ui_label", "cta", "help_text", "onboarding", "status", ""].includes(textValue(item?.surface || item?.type)));
    const requiresFallback = fallbackPolicy !== "none" && (sourceLang === "it" || data.require_fallback !== false);
    const marketingReviewRequired = copyClass !== "ui_label" || ctaItems.length > 0 || surfaceType === "landing_copy" || surfaceType === "marketing_microcopy";
    const pricingReviewRequired = pricingItems.length > 0 || data.contains_pricing === true;
    const claimReviewRequired = claimItems.length > 0 || data.contains_claims === true;
    const publishReady = missing.length === 0 && unstableItems === 0 && htmlBlobItems.length === 0 && !pricingReviewRequired && !claimReviewRequired && data.owner_review_confirmed === true;
    const readiness = Math.max(0, 100 - missing.length * 25 - unstableItems * 10 - htmlBlobItems.length * 18 - (pricingReviewRequired ? 12 : 0) - (claimReviewRequired ? 16 : 0));
    addSignal("translator_payload_readiness", "Readiness payload traduttore marketing/app", readiness, "translation_marketing", ["translator_plugin"]);
    addSignal("key_stability_risk", "Rischio key path instabili o stringhe mancanti", Math.min(100, unstableItems * 18), "translation", ["key_path"]);
    addSignal("marketing_surface_risk", "Rischio su superfici CTA/marketing/app copy", marketingReviewRequired ? 68 : 18, "marketing", ["surface_copy"]);
    addSignal("pricing_claim_risk", "Rischio prezzi o claim nel copy tradotto", pricingReviewRequired || claimReviewRequired ? 84 : 12, "claim", ["pricing", "claim_guard"]);
    addSignal("html_blob_risk", "Rischio HTML finale o rich text nel traduttore", htmlBlobItems.length ? 92 : 6, "translation", ["html_blob"]);
    warnings.push(...htmlBlobItems.slice(0, 5).map((item) => `payload surface non consentita per traduzione strutturata: ${textValue(item.key_path || item.source_text, "item")}`));
    branchOutput = {
      translation_mode: "atomic_ui_and_marketing_review",
      plugin_id: pluginId || null,
      app_name: appName || null,
      source_lang: sourceLang,
      target_lang: targetLang,
      locale_target: localeTarget,
      surface_type: surfaceType,
      copy_class: copyClass,
      item_count: items.length,
      unstable_item_count: unstableItems,
      cta_item_count: ctaItems.length,
      pricing_item_count: pricingItems.length,
      claim_item_count: claimItems.length,
      html_blob_item_count: htmlBlobItems.length,
      fallback_required: requiresFallback,
      fallback_policy: requiresFallback ? fallbackPolicy : "no_fallback_required",
      safe_translation_mode: localizedLabelsOnly ? "plugin_structured_copy" : "mixed_surface_review",
      marketing_review_required: marketingReviewRequired,
      pricing_review_required: pricingReviewRequired,
      claim_review_required: claimReviewRequired,
      owner_review_required: true,
      publish_ready: publishReady,
      recommended_companion_branches: ["translation_governance", "marketing_copy", "ramo_testo"],
      blocked_surfaces: htmlBlobItems.length ? ["html_blob"] : [],
      rule: "Usare per plugin traduttore e applicazioni che devono tradurre microcopy strutturato senza perdere guardrail marketing/compliance.",
    };
  } else if (branch === "ramo_testo") {
    const text = textValue(data.text || data.content || data.copy || data.draft);
    const providedIssues = normalizeTextGuardIssues(data.issues);
    const issues = providedIssues.length ? providedIssues : buildTextGuardIssuesFromClaimShield(text, data);
    if (!text) missing.push("text");
    const locale = textValue(data.locale || payload.locale, "it");
    const publicText = data.public_text === true || data.publish_intent === true || data.context === "page_copy";
    const hasKeyPath = Boolean(textValue(data.key_path || payload.key_path));
    const hasDomain = Boolean(textValue(data.domain || payload.domain));
    const hasTarget = Boolean(textValue(data.target || data.audience));
    const hasCta = Boolean(textValue(data.cta || data.call_to_action)) || publicText === false;
    const mixedLanguage = locale === "it"
      ? /\b(the|and|with|for|results|guaranteed)\b/i.test(text)
      : locale === "en"
        ? /\b(che|con|per|risultati|garantiti|paggina)\b/i.test(text)
        : false;
    const unsupportedProof = (data.mentions_study === true || data.mentions_trend === true || /studio|study|clinicamente|clinically|trend/i.test(text)) && data.sources_provided !== true;
    const highIssues = issues.filter((issue) => issue.severity === "high" || issue.severity === "blocker").length;
    const claimIssues = issues.filter((issue) => issue.type === "claim_risk" || issue.type === "publish_safety").length;
    const structureMissing = [hasKeyPath, hasDomain, hasTarget, hasCta].filter(Boolean).length;
    addSignal("issue_severity", "Gravita problemi testo/content guard", Math.min(100, highIssues * 32 + claimIssues * 24), "content_guard", ["text"]);
    addSignal("publish_safety", "Sicurezza pubblicazione testo", claimIssues ? 88 : 20, "content_guard", ["publish_safety"]);
    addSignal("text_structure", "Contesto, domain, key_path, target e CTA", 100 - structureMissing * 22, "content_guard", ["structure"]);
    addSignal("language_consistency", "Coerenza lingua del testo", mixedLanguage ? 68 : 8, "content_guard", ["language"]);
    addSignal("unsupported_proof", "Studio, trend o prova non supportati", unsupportedProof ? 84 : 8, "content_guard", ["proof"]);
    branchOutput = {
      text_context: textValue(data.context, "manual_review"),
      locale,
      issue_count: issues.length,
      claim_issue_count: claimIssues,
      structure_missing: {
        key_path: !hasKeyPath,
        domain: !hasDomain,
        target: !hasTarget,
        cta: !hasCta,
      },
      mixed_language: mixedLanguage,
      unsupported_proof: unsupportedProof,
      publish_safe_advisory: issues.every((issue) => issue.type !== "claim_risk" && issue.type !== "publish_safety" && issue.severity !== "blocker") && !unsupportedProof && !mixedLanguage,
      rule: "Ramo Testo produce review e suggested action; non salva, non pubblica e non corregge automaticamente.",
    };
  } else if (branch === "change_impact_orchestration") {
    const changeType = textValue(data.change_type || data.action_type || data.type, "code_change");
    const targetSystem = textValue(data.target_system || data.system || data.target, "unknown");
    const affectedSurfaces = arrayValue(data.affected_surfaces || data.surfaces || data.modules, 50);
    const changedFiles = arrayValue(data.changed_files || data.files, 100);
    const declaredTests = arrayValue(data.tests_declared || data.tests || data.verification, 50);
    const declaredDocs = arrayValue(data.docs_declared || data.docs || data.documentation, 50);
    const hasRollbackPlan = data.rollback_plan === true || Boolean(textValue(data.rollback_plan_text || data.rollback));
    const ownerConfirmed = data.owner_confirmation === true || data.owner_confirmed === true;
    const touchesUi = affectedSurfaces.some((item) => /ui|panel|dashboard|card|frontend|wordpress_admin/i.test(item)) || changedFiles.some((item) => /\.(tsx?|jsx?|css|php)$/i.test(item) && /admin|view|page|component|suite/i.test(item));
    const touchesRest = affectedSurfaces.some((item) => /rest|api|endpoint|route|payload|schema/i.test(item)) || changedFiles.some((item) => /src\/app|api|route|controller|rest/i.test(item));
    const touchesSnapshot = affectedSurfaces.some((item) => /snapshot|registry|manual|state/i.test(item));
    const touchesRelease = affectedSurfaces.some((item) => /zip|version|release|manifest|render|health|package/i.test(item)) || /release|version|zip|render/i.test(changeType);
    const touchesTenant = affectedSurfaces.some((item) => /tenant|scope|key|permission|policy|role|plan|license/i.test(item));
    const touchesConnector = affectedSurfaces.some((item) => /connector|codex|smart.?desk|suite|mcp|sdk|webhook/i.test(item));
    const touchesData = affectedSurfaces.some((item) => /data|customer|client|order|payment|lead|consent/i.test(item));
    const requiredActions = new Set(["record_core_audit", "declare_affected_surfaces"]);
    const testsRequired = new Set(["smoke_test"]);
    const docsRequired = new Set();
    const blockedUntil = new Set();

    if (!affectedSurfaces.length) blockedUntil.add("affected_surfaces_declared");
    if (touchesUi) {
      requiredActions.add("update_ui_contract");
      requiredActions.add("verify_rest_snapshot_pairing");
      testsRequired.add("ui_smoke_or_panel_preflight");
      docsRequired.add("manual_how_to_use");
    }
    if (touchesRest) {
      requiredActions.add("verify_api_contract");
      testsRequired.add("endpoint_contract_test");
      blockedUntil.add("connector_contract_review");
    }
    if (touchesSnapshot) {
      requiredActions.add("update_snapshot_map");
      docsRequired.add("map_snapshot");
      testsRequired.add("snapshot_readiness_check");
    }
    if (touchesRelease) {
      requiredActions.add("prepare_versioned_artifact");
      requiredActions.add("verify_health_after_publish");
      testsRequired.add("package_preflight");
      blockedUntil.add("rollback_plan");
    }
    if (touchesTenant) {
      requiredActions.add("verify_tenant_policy");
      requiredActions.add("verify_key_scope");
      testsRequired.add("permission_scope_test");
      blockedUntil.add("owner_confirmation");
    }
    if (touchesConnector) {
      requiredActions.add("verify_connector_payload");
      requiredActions.add("run_connector_doctor");
      testsRequired.add("connector_doctor");
    }
    if (touchesData) {
      requiredActions.add("verify_data_isolation");
      requiredActions.add("verify_consent_or_scope");
      blockedUntil.add("tenant_scope_check");
    }
    if (!declaredTests.length) blockedUntil.add("tests_declared");
    if (!hasRollbackPlan && (touchesRelease || touchesRest || touchesTenant || touchesData)) blockedUntil.add("rollback_plan");
    if (!ownerConfirmed && (touchesRelease || touchesTenant || touchesData)) blockedUntil.add("owner_confirmation");
    if (docsRequired.size && !declaredDocs.length) blockedUntil.add("docs_impact_declared");

    const impactScore = Math.min(100, affectedSurfaces.length * 7 + changedFiles.length * 2 + blockedUntil.size * 10 + (touchesTenant ? 15 : 0) + (touchesData ? 15 : 0) + (touchesRelease ? 12 : 0));
    const readinessScore = clampScore(100 - impactScore + declaredTests.length * 5 + declaredDocs.length * 4 + (hasRollbackPlan ? 10 : 0) + (ownerConfirmed ? 8 : 0), 50);
    addSignal("cascade_impact", "Ampiezza impatto a cascata", impactScore, "change_impact", ["cascade"]);
    addSignal("readiness", "Readiness modifica controllata", readinessScore, "change_impact", ["readiness"]);
    addSignal("blocked_until", "Blocchi prima dell'esecuzione", Math.min(100, blockedUntil.size * 18), "governance", ["blockers"]);
    branchOutput = {
      mode: "impact_plan_only",
      change_type: changeType,
      target_system: targetSystem,
      affected_surfaces: affectedSurfaces,
      subbranches_used: [
        "dependency_impact_scan",
        "compatibility_guard",
        "documentation_impact",
        "test_impact",
        "release_impact",
        "tenant_policy_impact",
        "connector_contract_impact",
        "rollback_impact",
        "audit_evidence_impact",
      ],
      required_actions: [...requiredActions],
      tests_required: [...testsRequired],
      docs_required: [...docsRequired],
      blocked_until: [...blockedUntil],
      release_required: touchesRelease,
      rollback_required: touchesRelease || touchesRest || touchesTenant || touchesData,
      owner_confirmation_required: touchesRelease || touchesTenant || touchesData,
      audit_required: true,
      execution_allowed: false,
      nyra_explanation_contract: "Spiegare in linguaggio umano cosa cambia, perche serve, cosa blocca e quale primo passo sblocca il lavoro.",
      rule: "Questo ramo non esegue modifiche: produce il piano di impatto che Codex deve rispettare prima di implementare.",
    };
  } else if (branch === "nyra_finance_beauty_test") {
    const beta = clampScore(data.beauty_market_correlation ?? data.correlation_score ?? 40);
    const volatility = clampScore(data.volatility ?? data.market_volatility ?? 50);
    const commercial = clampScore(data.commercial_relevance ?? 45);
    addSignal("beauty_market_correlation", "Correlazione mercato beauty test", beta, "market_test", ["nyra_finance"]);
    addSignal("volatility", "Volatilita segnale finanziario test", volatility, "market_test", ["finance_test"]);
    addSignal("commercial_relevance", "Rilevanza commerciale beauty", commercial, "market_test", ["beauty"]);
    branchOutput = {
      test_area: true,
      production_connected: false,
      rule: "Nyra finanza resta area test separata; nessuna decisione prodotto o trading automatico.",
    };
  }

  if (missing.length) warnings.push(`Dati mancanti: ${missing.join(", ")}`);
  if (profile.production_status === "test_only") warnings.push("Ramo test-only: non usare per automazioni prodotto.");

  return {
    profile,
    core_input: {
      request_id: String(payload.request_id || `${branch}_${crypto.randomUUID()}`),
      generated_at: nowIso(),
      domain: profile.domain,
      context: {
        tenant_id: textValue(payload.tenant_id || data.tenant_id),
        actor_id: textValue(payload.actor_id || data.actor_id) || undefined,
        plan: textValue(payload.plan || data.plan) || undefined,
        locale: textValue(payload.locale || data.locale, "it"),
        metadata: {
          branch,
          production_status: profile.production_status,
          source: "universal_core_branch_router",
        },
      },
      signals: signals.length ? signals : [normalizeSignal({ id: `${branch}:empty`, label: "Payload ramo senza segnali sufficienti", normalized_score: 20, tags: [branch] })],
      data_quality: {
        score: clampScore(data.data_quality_score ?? (missing.length ? 55 : 78)),
        missing_fields: missing,
      },
      constraints: {
        allow_automation: false,
        require_confirmation: true,
        safety_mode: true,
        blocked_actions: ["publish_without_owner_review", "send_without_consent", "change_price_without_owner_confirmation"],
      },
    },
    branch_output: branchOutput,
    warnings,
  };
}

function severityToScore(status) {
  if (status === "critical") return 95;
  if (status === "high") return 78;
  if (status === "warning") return 55;
  if (status === "unknown") return 35;
  return 10;
}

function summarizeAuditPulse(auditEvents = []) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = auditEvents.filter((event) => {
    const ts = new Date(event.created_at || 0).getTime();
    return Number.isFinite(ts) && ts >= since;
  });

  const byType = last24h.reduce((acc, event) => {
    acc[event.event_type] = (acc[event.event_type] || 0) + 1;
    return acc;
  }, {});

  return {
    total_events_24h: last24h.length,
    guardrail_events_24h:
      (byType.core_claim_checked || 0) +
      (byType.core_pricing_checked || 0) +
      (byType.core_policy_checked || 0),
    auth_failures_24h: byType.core_auth_failed || 0,
    scope_denied_24h: byType.core_scope_denied || 0,
    by_type: byType,
  };
}

function buildEcosystemPulse({ tenantId, keyRecord, snapshot, auditEvents }) {
  const payload = snapshot?.payload || {};
  const health = payload.health || payload.enterprise_health || {};
  const analytics = payload.analytics || payload.stats || {};
  const nyra = payload.nyra || payload.market || {};
  const auditPulse = summarizeAuditPulse(auditEvents);

  const technicalScore = Number(health.readiness_score ?? health.score ?? 80);
  const pricingPressure = String(nyra.pricing_pressure || nyra.market_posture || analytics.pricing_pressure || "unknown");
  const nodeStatus = String(health.node_status || health.status || "local_snapshot");
  const guardrailLoad = Math.min(100, auditPulse.guardrail_events_24h * 8 + auditPulse.auth_failures_24h * 15 + auditPulse.scope_denied_24h * 12);
  const riskScore = Math.max(0, Math.min(100, 100 - technicalScore + guardrailLoad));

  return {
    tenant_id: tenantId,
    brand_scope: keyRecord?.brand_scope || "",
    generated_at: nowIso(),
    source_snapshot_id: snapshot?.snapshot_id || null,
    mode: "read_only_command_center",
    nyra_weather: {
      market_posture: pricingPressure,
      advisory: "Nyra legge segnali aggregati e suggerisce priorita; non esegue azioni automatiche.",
    },
    infrastructure: {
      node_status: nodeStatus,
      service_version: SERVICE_VERSION,
      render_ready: true,
      uptime_seconds: Math.round(process.uptime()),
    },
    guardrails: {
      ...auditPulse,
      hard_block: false,
      owner_confirmation_required: true,
    },
    score: {
      technical_score: Math.max(0, Math.min(100, technicalScore)),
      risk_score: riskScore,
      risk_status: riskScore >= 80 ? "critical" : riskScore >= 55 ? "high" : riskScore >= 25 ? "warning" : "ok",
    },
    recommended_action:
      riskScore >= 55
        ? "Aprire Control Room, verificare guardrail recenti e confermare manualmente le azioni critiche."
        : "Continuare monitoraggio, mantenendo audit e conferma owner sulle azioni operative.",
  };
}

function calibrationStatus() {
  return {
    status: "advisory_ready",
    mode: "monthly_auto_tuning_candidate",
    live_mutation_enabled: false,
    hard_block: false,
    recommended_cadence: "monthly",
    last_run_at: null,
    next_step: "Raccogliere snapshot reali, confrontare varianti e salvare solo raccomandazioni approvabili dall'owner.",
    guardrails: [
      "nessuna modifica automatica ai pesi live",
      "nessuna pubblicazione automatica",
      "owner confirmation obbligatoria",
      "audit di ogni valutazione",
    ],
  };
}

function calibrationEvaluate(payload = {}) {
  const variants = Array.isArray(payload.variants) && payload.variants.length ? payload.variants : [];
  const metrics = typeof payload.metrics === "object" && payload.metrics ? payload.metrics : {};
  const baseline = Number(metrics.baseline_accuracy ?? metrics.baseline_score ?? 0);
  const scored = variants.map((variant, index) => {
    const accuracy = Number(variant.accuracy ?? variant.score ?? baseline);
    const risk = Number(variant.risk ?? variant.regression_risk ?? 20);
    const coverage = Number(variant.coverage ?? 70);
    const final_score = Math.max(0, Math.min(100, accuracy * 0.55 + coverage * 0.25 + (100 - risk) * 0.2));
    return {
      id: String(variant.id || `variant_${index + 1}`),
      label: String(variant.label || variant.id || `Variante ${index + 1}`),
      final_score,
      accuracy,
      coverage,
      risk,
      selected: false,
    };
  });
  scored.sort((a, b) => b.final_score - a.final_score);
  if (scored[0]) scored[0].selected = true;

  return {
    status: scored.length ? "candidate_selected" : "insufficient_data",
    advisory_only: true,
    live_mutation_enabled: false,
    selected_variant: scored[0] || null,
    ranking: scored,
    recommended_action: scored[0]
      ? "Salvare la variante come proposta, testarla in staging e applicarla solo dopo conferma owner."
      : "Aggiungere varianti, metriche reali e dati di regressione prima di calibrare.",
  };
}

function claimShieldSources() {
  return [
    {
      id: "eu_cosmetics_reg_1223_2009",
      label: "Regolamento cosmetici UE CE n. 1223/2009",
      scope: "cosmetic_claim_governance_reference",
      status: "reference_registry",
      legal_review_required: true,
    },
    {
      id: "internal_brand_claim_policy",
      label: "Policy claim approvati dal brand",
      scope: "brand_specific_claims",
      status: "tenant_policy_required",
      legal_review_required: true,
    },
  ];
}

function claimShieldCheck(payload = {}) {
  const lexical = claimGuardCheck(payload);
  const statusScore = severityToScore(lexical.status);
  const contextRisk = payload.context?.medical_context === true || payload.context?.before_after_promise === true ? 20 : 0;
  const riskScore = Math.max(0, Math.min(100, statusScore + contextRisk));
  return {
    ...lexical,
    shield_status: riskScore >= 80 ? "critical_review" : riskScore >= 50 ? "legal_review_recommended" : "watch",
    risk_score: riskScore,
    sources: claimShieldSources(),
    legal_guarantee: false,
    compliance_note:
      "Supporto di governance e pre-review: non sostituisce validazione legale, regolatoria o responsabilita del brand.",
    owner_confirmation_required: lexical.issue_count > 0,
  };
}

export function createUniversalCoreService(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("core_service_options_invalid");
  }
  const optionsPrototype = Object.getPrototypeOf(options);
  if (optionsPrototype !== Object.prototype && optionsPrototype !== null) {
    throw new Error("core_service_options_prototype_invalid");
  }
  if (Object.getOwnPropertySymbols(options).length > 0) {
    throw new Error("core_service_options_symbol_invalid");
  }
  const normalizedOptions = Object.create(null);
  for (const [name, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(options),
  )) {
    if (!("value" in descriptor) || descriptor.get || descriptor.set) {
      throw new Error("core_service_options_accessor_invalid");
    }
    Object.defineProperty(normalizedOptions, name, {
      value: descriptor.value,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  options = Object.freeze(normalizedOptions);
  const internallyOwnedPostgresPools = new Set();
  let serverResolverRegistry = null;
  try {
    serverResolverRegistry = loadHostNativeResolverRegistryFromEnvironment(process.env);
  } catch {
    serverResolverRegistry = null;
  }
  const hasOwnOption = (name) => Object.prototype.hasOwnProperty.call(options, name);
  // A degraded production liveness receipt is meaningful only when the
  // authority-bearing components were built by this service from its host
  // configuration. Object properties supplied through test/integration seams
  // can exercise normal behavior, but can never attest bootstrap provenance.
  const causalBootstrapConstructionProvenance = Object.freeze({
    host_native: ![
      "hostNativeGovernance", "hostNativeGovernanceEnabled",
      "hostNativeGovernanceStore", "hostNativeExternalReadbackVerifier",
      "hostNativeReleaseJoinVerdictResolver", "hostNativeSigningSecret",
      "hostNativeResolverConfigurationValid", "hostNativeResolverConfigurationError",
      "hostNativeRequiredChecksPolicyResolver",
      "hostNativeRequiredChecksPolicyResolverState",
      "hostNativeRequiredChecksPolicyBindingCount",
      "hostNativeRenderServiceOriginResolver",
      "hostNativeRenderServiceOriginResolverState",
      "hostNativeRenderServiceOriginBindingCount",
      "hostNativeProjectScopeRenderOriginResolver",
      "hostNativeGithubTokenResolver", "hostNativeGithubCredentialResolverState",
      "hostNativeGithubCredentialBindingCount", "hostNativeReadbackFetchImpl",
      "bootstrapAuthorityTrustPinJson", "bootstrapReleaseExceptionStore",
      "bootstrapRequiredChecksReadback",
      "bootstrapReleasePreparationBaseBranchResolver",
      "bootstrapReleasePreparationService",
      "mcpTenantGatewayKey", "tenantContextSigningSecret",
      "ownerContextSigningSecret",
    ].some(hasOwnOption),
    research_airlock: ![
      "researchAirlockRuntime", "researchAirlockPostgresPool",
      "researchAirlockMode", "researchAirlockSigningSecret",
      "researchAirlockTransport",
    ].some(hasOwnOption),
    policy_registry: ![
      "nyraPolicyRegistryStore", "nyraPolicyRegistryPostgresPool",
      "nyraPolicyRegistryDatabaseUrl", "nyraPolicyRegistryProofService",
      "nyraPolicyRegistryProofEnv", "nyraPolicyRegistryEnforcementMode",
      "consumeNyraPolicyRegistryCoreReceipt",
      "verifyNyraPolicyRegistryActivationSnapshot",
    ].some(hasOwnOption),
    causal_runtime: ![
      "causalContinuityStore", "causalContinuityRuntime",
      "causalContextSigner", "causalActionLeaseVerifier",
      "governedAgentPostgresVersionProbe", "governedAgentPostgresVersionPool",
    ].some(hasOwnOption),
    dtt_identity: ![
      "dttAgentIdentitySigningSecret", "dttAgentIdentityPostgresPool",
      "dttAgentIdentityReceiptStore", "dttAgentIdentityReceiptService",
      "dttVerificationTrustStore", "dynamicTaskTreePostgresPool",
      "resolveDttVerifierIdentity",
    ].some(hasOwnOption),
    resolver_registry: Boolean(
      serverResolverRegistry?.configuration_valid === true
      && serverResolverRegistry.github?.state === "exact_registry_ready"
      && typeof serverResolverRegistry.github?.resolver === "function"
      && serverResolverRegistry.render?.state === "exact_registry_ready"
      && typeof serverResolverRegistry.render?.resolver === "function"
      && serverResolverRegistry.required_checks?.state === "exact_registry_ready"
      && typeof serverResolverRegistry.required_checks?.resolver === "function"
    ),
  });
  const storageRoot = options.storageRoot || process.env.CORE_SERVICE_STORAGE_ROOT || DEFAULT_STORAGE_ROOT;
  ensureDir(storageRoot);

  const audit = createAudit(storageRoot);
  const keyStore = createKeyStore(storageRoot, audit);
  const providerSetupLinkBootstrapKey = String(
    options.providerSetupLinkBootstrapKey ?? process.env.CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY ?? "",
  ).trim();
  const providerSetupLinkServiceKey = String(
    options.providerSetupLinkServiceKey ?? process.env.CORE_PROVIDER_SETUP_LINK_SERVICE_KEY ?? "",
  ).trim();
  const mcpTenantGatewayKey = String(options.mcpTenantGatewayKey ?? process.env.CORE_MCP_TENANT_GATEWAY_KEY ?? "").trim();
  const tenantContextSigningSecretCandidate = String(
    options.tenantContextSigningSecret
      ?? process.env.CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET
      ?? "",
  ).trim();
  const tenantContextSigningSecret =
    Buffer.byteLength(tenantContextSigningSecretCandidate, "utf8") >= 32
      ? tenantContextSigningSecretCandidate
      : "";
  const providerSetupLinkTenantId = String(
    options.providerSetupLinkTenantId ?? process.env.CORE_PROVIDER_SETUP_LINK_TENANT_ID ?? "",
  ).trim();
  // This is intentionally distinct from every Core bearer key. It proves an
  // owner confirmation originated at the MCP bridge, rather than from any
  // caller that can reach the action-evaluator endpoint.
  const ownerContextSigningSecretCandidate = String(
    options.ownerContextSigningSecret ?? process.env.CORE_OWNER_CONTEXT_SIGNING_SECRET ?? "",
  ).trim();
  // The bridge assertion is an authorization credential, not a convenience
  // flag. Short values are treated as absent so the sensitive setup flow
  // fails closed rather than silently using weak signing material.
  const ownerContextSigningSecret = ownerContextSigningSecretCandidate.length >= 32
    ? ownerContextSigningSecretCandidate
    : "";
  let providerSetupLinkBootstrapConfigured = false;
  let providerSetupLinkBootstrapState = getProviderSetupLinkBootstrapState({
    key: providerSetupLinkBootstrapKey,
    tenantId: providerSetupLinkTenantId,
  });
  if (providerSetupLinkBootstrapKey || providerSetupLinkTenantId) {
    try {
      keyStore.ensureProviderSetupLinkKey({
        secret: providerSetupLinkBootstrapKey,
        tenant_id: providerSetupLinkTenantId,
      });
      providerSetupLinkBootstrapConfigured = true;
      providerSetupLinkBootstrapState = "ready";
    } catch (error) {
      providerSetupLinkBootstrapState = getProviderSetupLinkBootstrapState({
        key: providerSetupLinkBootstrapKey,
        tenantId: providerSetupLinkTenantId,
        error,
      });
      // The privileged setup path must fail closed without taking down the
      // rest of Universal Core. Do not log the seed or its hash.
      audit.append("core_provider_setup_link_key_bootstrap_unavailable", {
        tenant_id: providerSetupLinkTenantId || null,
        reason: providerSetupLinkBootstrapErrorCode(error),
      });
    }
  }
  if (providerSetupLinkServiceKey) {
    try {
      keyStore.ensureProviderSetupLinkServiceKey({ secret: providerSetupLinkServiceKey });
    } catch (error) {
      audit.append("core_provider_setup_link_service_key_bootstrap_unavailable", {
        reason: providerSetupLinkBootstrapErrorCode(error),
      });
    }
  }
  let mcpTenantGatewayConfigured = false;
  if (mcpTenantGatewayKey) {
    try {
      keyStore.ensureMcpTenantGatewayKey({ secret: mcpTenantGatewayKey });
      mcpTenantGatewayConfigured = true;
    }
    catch (error) { audit.append("core_mcp_tenant_gateway_key_bootstrap_unavailable", { reason: providerSetupLinkBootstrapErrorCode(error) }); }
  }
  const setupTokens = createSetupTokenStore(storageRoot, audit);
  const snapshots = snapshotStore(storageRoot);
  const nyraPolicyRegistryRequestedMode = String(
    options.nyraPolicyRegistryEnforcementMode
      ?? process.env.CORE_NYRA_POLICY_REGISTRY_ENFORCEMENT_MODE
      ?? "advisory_evaluate",
  ).trim().toLowerCase();
  const nyraPolicyRegistryModeValid = new Set(["disabled", "advisory_evaluate", "enforced"])
    .has(nyraPolicyRegistryRequestedMode);
  // Invalid configuration is never interpreted as advisory or disabled.
  const nyraPolicyRegistryMode = nyraPolicyRegistryModeValid
    ? nyraPolicyRegistryRequestedMode
    : "enforced";
  const nyraPolicyRegistryEvaluationEnabled = nyraPolicyRegistryMode !== "disabled";
  const nyraPolicyRegistryDatabaseUrl = String(
    options.nyraPolicyRegistryDatabaseUrl ?? process.env.GOVERNED_AGENT_DATABASE_URL ?? "",
  ).trim();
  const nyraPolicyRegistryProofProduction = String(process.env.NODE_ENV || "") === "production";
  const nyraPolicyRegistryProofEnabledFlag = strictGenericWorkCoreJoinBoolean(
    options.nyraPolicyRegistryProofEnabled ?? process.env.CORE_NYRA_POLICY_REGISTRY_PROOF_ENABLED,
    false,
    "policy_registry_proof_enabled_flag_invalid",
  );
  const nyraPolicyRegistryProofRequiredFlag = strictGenericWorkCoreJoinBoolean(
    options.nyraPolicyRegistryProofRequired ?? process.env.CORE_NYRA_POLICY_REGISTRY_PROOF_REQUIRED,
    false,
    "policy_registry_proof_required_flag_invalid",
  );
  const nyraPolicyRegistryProofEnabled = nyraPolicyRegistryProofEnabledFlag.value;
  const nyraPolicyRegistryProofRequired = nyraPolicyRegistryProofRequiredFlag.valid
    ? nyraPolicyRegistryProofRequiredFlag.value
    : true;
  const nyraPolicyRegistryCoreSignerMode = String(
    options.nyraPolicyRegistryCoreSignerMode
      ?? process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_MODE
      ?? "disabled",
  );
  const nyraPolicyRegistryCompilerEnabledFlag = strictGenericWorkCoreJoinBoolean(
    options.nyraPolicyRegistryCompilerProvenanceEnabled ??
      process.env.CORE_NYRA_POLICY_REGISTRY_COMPILER_PROVENANCE_ENABLED,
    false,
    "policy_registry_compiler_enabled_flag_invalid",
  );
  const nyraPolicyRegistryCompilerRequiredFlag = strictGenericWorkCoreJoinBoolean(
    options.nyraPolicyRegistryCompilerProvenanceRequired ??
      process.env.CORE_NYRA_POLICY_REGISTRY_COMPILER_PROVENANCE_REQUIRED,
    false,
    "policy_registry_compiler_required_flag_invalid",
  );
  const nyraPolicyRegistryCompilerEnabled = nyraPolicyRegistryCompilerEnabledFlag.value;
  const nyraPolicyRegistryCompilerRequired = nyraPolicyRegistryCompilerRequiredFlag.valid
    ? nyraPolicyRegistryCompilerRequiredFlag.value
    : true;
  const nyraPolicyRegistryCompilerMode = String(
    options.nyraPolicyRegistryCompilerProvenanceMode ??
      process.env.CORE_NYRA_POLICY_REGISTRY_COMPILER_PROVENANCE_MODE ??
      "disabled",
  );
  const nyraPolicyRegistryCompilerModeValid = ["disabled", "core_deterministic_recompile"]
    .includes(nyraPolicyRegistryCompilerMode);
  const nyraPolicyRegistryCompilerProductionInjectionPresent =
    nyraPolicyRegistryProofProduction && [
      "nyraPolicyRegistryCompilerProvenanceEnabled",
      "nyraPolicyRegistryCompilerProvenanceRequired",
      "nyraPolicyRegistryCompilerProvenanceMode",
      "nyraPolicyRegistryCompilerProvenanceVerifier",
      "nyraPolicyRegistryCompilerTrustCatalog",
      "nyraPolicyRegistryCompilerTrustCatalogJson",
      "nyraPolicyRegistryCompilerNow",
      "nyraPolicyRegistryCompilerTraversalBudget",
      "nyraPolicyRegistryCompilerCatalogDigest",
      "nyraPolicyRegistryCompilerTrustCatalogDigest",
    ].some((field) => Object.hasOwn(options, field));
  let nyraPolicyRegistryCompilerConfigurationError =
    !nyraPolicyRegistryCompilerEnabledFlag.valid
      ? nyraPolicyRegistryCompilerEnabledFlag.error
      : !nyraPolicyRegistryCompilerRequiredFlag.valid
        ? nyraPolicyRegistryCompilerRequiredFlag.error
        : !nyraPolicyRegistryCompilerModeValid
          ? "policy_registry_compiler_mode_invalid"
          : nyraPolicyRegistryCompilerRequired && !nyraPolicyRegistryCompilerEnabled
            ? "policy_registry_compiler_required_without_enabled"
            : nyraPolicyRegistryCompilerEnabled &&
                nyraPolicyRegistryCompilerMode !== "core_deterministic_recompile"
              ? "policy_registry_compiler_mode_binding_invalid"
              : !nyraPolicyRegistryCompilerEnabled && nyraPolicyRegistryCompilerMode !== "disabled"
                ? "policy_registry_compiler_mode_binding_invalid"
                : nyraPolicyRegistryCompilerEnabled &&
                    nyraPolicyRegistryCompilerProductionInjectionPresent
                  ? "policy_registry_compiler_production_injection_forbidden"
                  : null;
  let nyraPolicyRegistryCompilerProvenanceVerifier = null;
  let nyraPolicyRegistryCompilerStatus = null;
  let nyraPolicyRegistryExpectedCatalogDigest = null;
  let nyraPolicyRegistryExpectedTrustCatalogDigest = null;
  if (nyraPolicyRegistryCompilerEnabled && nyraPolicyRegistryCompilerConfigurationError === null) {
    try {
      const catalogDigest = nyraPolicyRegistryProofProduction
        ? process.env.CORE_NYRA_POLICY_REGISTRY_COMPILER_CATALOG_DIGEST
        : options.nyraPolicyRegistryCompilerCatalogDigest ??
          process.env.CORE_NYRA_POLICY_REGISTRY_COMPILER_CATALOG_DIGEST;
      const trustCatalogDigest = nyraPolicyRegistryProofProduction
        ? process.env.CORE_NYRA_POLICY_REGISTRY_COMPILER_TRUST_CATALOG_DIGEST
        : options.nyraPolicyRegistryCompilerTrustCatalogDigest ??
          process.env.CORE_NYRA_POLICY_REGISTRY_COMPILER_TRUST_CATALOG_DIGEST;
      if (!/^[a-f0-9]{64}$/.test(String(catalogDigest || ""))) {
        throw new Error("policy_registry_compiler_catalog_digest_invalid");
      }
      if (!/^[a-f0-9]{64}$/.test(String(trustCatalogDigest || ""))) {
        throw new Error("policy_registry_compiler_trust_catalog_digest_invalid");
      }
      nyraPolicyRegistryExpectedCatalogDigest = String(catalogDigest);
      nyraPolicyRegistryExpectedTrustCatalogDigest = String(trustCatalogDigest);
      const injectedVerifier = !nyraPolicyRegistryProofProduction
        ? options.nyraPolicyRegistryCompilerProvenanceVerifier
        : null;
      if (injectedVerifier) {
        nyraPolicyRegistryCompilerProvenanceVerifier = injectedVerifier;
      } else {
        let trustCatalog;
        if (!nyraPolicyRegistryProofProduction &&
          Object.hasOwn(options, "nyraPolicyRegistryCompilerTrustCatalog")) {
          trustCatalog = options.nyraPolicyRegistryCompilerTrustCatalog;
        } else {
          const rawCatalog = String(
            !nyraPolicyRegistryProofProduction &&
              Object.hasOwn(options, "nyraPolicyRegistryCompilerTrustCatalogJson")
              ? options.nyraPolicyRegistryCompilerTrustCatalogJson
              : process.env.CORE_NYRA_POLICY_REGISTRY_COMPILER_TRUST_CATALOG_JSON || "",
          );
          if (!rawCatalog || Buffer.byteLength(rawCatalog, "utf8") > 524_288) {
            throw new Error("policy_registry_compiler_trust_catalog_json_invalid");
          }
          try { trustCatalog = JSON.parse(rawCatalog); } catch {
            throw new Error("policy_registry_compiler_trust_catalog_json_invalid");
          }
        }
        if (!validPolicyCompilerTrustCatalog(trustCatalog)) {
          throw new Error("policy_registry_compiler_trust_catalog_invalid");
        }
        const rawTraversalBudget = !nyraPolicyRegistryProofProduction
          ? options.nyraPolicyRegistryCompilerTraversalBudget ??
            process.env.CORE_NYRA_POLICY_REGISTRY_COMPILER_TRAVERSAL_BUDGET ?? 256
          : process.env.CORE_NYRA_POLICY_REGISTRY_COMPILER_TRAVERSAL_BUDGET ?? 256;
        const traversalBudget = typeof rawTraversalBudget === "number"
          ? rawTraversalBudget
          : /^(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-6])$/.test(String(rawTraversalBudget))
            ? Number(rawTraversalBudget)
            : null;
        if (!Number.isInteger(traversalBudget) || traversalBudget < 1 || traversalBudget > 256) {
          throw new Error("policy_registry_compiler_traversal_budget_invalid");
        }
        if (!BUILD_COMMIT_VERIFIABLE) {
          throw new Error("policy_registry_compiler_build_commit_unavailable");
        }
        nyraPolicyRegistryCompilerProvenanceVerifier =
          createNyraPolicyRegistryCompilerProvenanceVerifier({
            trust_catalog: trustCatalog,
            build_commit: BUILD_COMMIT_SHA,
            traversal_budget: traversalBudget,
            now: !nyraPolicyRegistryProofProduction && options.nyraPolicyRegistryCompilerNow
              ? options.nyraPolicyRegistryCompilerNow
              : () => Date.now(),
          });
      }
      if (!nyraPolicyRegistryCompilerProvenanceVerifier ||
        typeof nyraPolicyRegistryCompilerProvenanceVerifier.verify !== "function" ||
        typeof nyraPolicyRegistryCompilerProvenanceVerifier.verifyPersistedRecord !== "function" ||
        typeof nyraPolicyRegistryCompilerProvenanceVerifier.status !== "function") {
        throw new Error("policy_registry_compiler_verifier_invalid");
      }
      nyraPolicyRegistryCompilerStatus = nyraPolicyRegistryCompilerProvenanceVerifier.status();
      if (typeof nyraPolicyRegistryCompilerStatus?.then === "function" ||
        !validPolicyCompilerStatus(
          nyraPolicyRegistryCompilerStatus,
          nyraPolicyRegistryExpectedCatalogDigest,
          nyraPolicyRegistryExpectedTrustCatalogDigest,
        )) {
        throw new Error("policy_registry_compiler_status_invalid");
      }
    } catch (error) {
      nyraPolicyRegistryCompilerProvenanceVerifier = null;
      nyraPolicyRegistryCompilerStatus = null;
      const safeCompilerConfigurationErrors = new Set([
        "policy_registry_compiler_catalog_digest_invalid",
        "policy_registry_compiler_trust_catalog_digest_invalid",
        "policy_registry_compiler_build_commit_unavailable",
        "policy_registry_compiler_trust_catalog_json_invalid",
        "policy_registry_compiler_trust_catalog_invalid",
        "policy_registry_compiler_traversal_budget_invalid",
        "policy_registry_compiler_verifier_invalid",
        "policy_registry_compiler_status_invalid",
      ]);
      const code = String(error?.message || "");
      nyraPolicyRegistryCompilerConfigurationError = safeCompilerConfigurationErrors.has(code)
        ? code
        : "policy_registry_compiler_configuration_invalid";
    }
  }
  const nyraPolicyRegistryCompilerReady = nyraPolicyRegistryCompilerEnabled &&
    nyraPolicyRegistryCompilerConfigurationError === null &&
    nyraPolicyRegistryCompilerStatus?.ready === true;
  let nyraPolicyRegistryProofConfigurationError = !nyraPolicyRegistryProofEnabledFlag.valid
    ? nyraPolicyRegistryProofEnabledFlag.error
    : !nyraPolicyRegistryProofRequiredFlag.valid
      ? nyraPolicyRegistryProofRequiredFlag.error
      : nyraPolicyRegistryProofRequired && !nyraPolicyRegistryProofEnabled
        ? "policy_registry_proof_required_without_enabled"
        : !["disabled", "remote"].includes(nyraPolicyRegistryCoreSignerMode)
          ? "policy_registry_core_signer_mode_invalid"
          : nyraPolicyRegistryProofEnabled && nyraPolicyRegistryCoreSignerMode !== "remote"
            ? "policy_registry_core_signer_remote_required"
            : null;
  if (nyraPolicyRegistryProofEnabled &&
    (!nyraPolicyRegistryCompilerEnabled || !nyraPolicyRegistryCompilerRequired)) {
    nyraPolicyRegistryProofConfigurationError ||=
      "policy_registry_proof_compiler_provenance_required";
  }
  if (nyraPolicyRegistryProofEnabled && nyraPolicyRegistryCompilerConfigurationError) {
    nyraPolicyRegistryProofConfigurationError ||= nyraPolicyRegistryCompilerConfigurationError;
  }
  if (nyraPolicyRegistryProofEnabled && !nyraPolicyRegistryCompilerReady) {
    nyraPolicyRegistryProofConfigurationError ||= "policy_registry_compiler_unavailable";
  }
  const nyraPolicyRegistryProductionInjectionPresent = nyraPolicyRegistryProofProduction && [
    "nyraPolicyRegistryPostgresPool",
    "nyraPolicyRegistryProofService",
    "nyraPolicyRegistryStore",
    "nyraPolicyRegistryClient",
    "nyraPolicyRegistryCoordinator",
    "nyraPolicyRegistryCoreSigner",
    "nyraPolicyRegistryCoreSignerConfig",
    "nyraPolicyRegistryCoreSignerFetch",
    "nyraPolicyRegistryFetch",
    "nyraPolicyRegistryProofEnv",
    "nyraPolicyRegistryClientEnv",
  ].some((field) => Object.hasOwn(options, field));
  if (nyraPolicyRegistryProofEnabled && nyraPolicyRegistryProductionInjectionPresent) {
    nyraPolicyRegistryProofConfigurationError ||= "policy_registry_production_injection_forbidden";
  }
  const nyraPolicyRegistryProofEnv = nyraPolicyRegistryProofProduction
    ? process.env
    : options.nyraPolicyRegistryProofEnv || process.env;
  const nyraPolicyRegistryPrivateMaterialPresent = Boolean(
    process.env.CORE_NYRA_POLICY_REGISTRY_CORE_PRIVATE_KEY ||
    nyraPolicyRegistryProofEnv.CORE_NYRA_POLICY_REGISTRY_CORE_PRIVATE_KEY,
  );
  if (nyraPolicyRegistryPrivateMaterialPresent) {
    nyraPolicyRegistryProofConfigurationError ||= "policy_registry_core_private_key_forbidden";
  }
  const nyraPolicyRegistryCoreSignerTargetCommit =
    process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_TARGET_COMMIT;
  if (nyraPolicyRegistryProofProduction && nyraPolicyRegistryProofEnabled &&
    (!BUILD_COMMIT_VERIFIABLE ||
      nyraPolicyRegistryCoreSignerTargetCommit !== BUILD_COMMIT_SHA)) {
    nyraPolicyRegistryProofConfigurationError ||=
      "policy_registry_core_signer_target_commit_mismatch";
  }
  // An injected PostgreSQL version probe is a fully controlled test/host seam.
  // Do not open implicit network pools behind it; callers that need database
  // behavior can still provide the explicit pool options above.
  const hasInjectedPostgresVersionProbe = nyraPolicyRegistryProofConfigurationError === null &&
    Boolean(options.governedAgentPostgresVersionProbe);
  const allowInactivePolicyRegistryInjection = !nyraPolicyRegistryProofProduction ||
    !nyraPolicyRegistryProofEnabled;
  const nyraPolicyRegistryPostgresPool = nyraPolicyRegistryProofConfigurationError === null
    ? ((allowInactivePolicyRegistryInjection && options.nyraPolicyRegistryPostgresPool) ||
      (!hasInjectedPostgresVersionProbe && /^postgres(?:ql)?:\/\//i.test(nyraPolicyRegistryDatabaseUrl)
        ? new pg.Pool({ connectionString: nyraPolicyRegistryDatabaseUrl })
        : null))
    : null;
  if (nyraPolicyRegistryProofEnabled && nyraPolicyRegistryProofProduction && !nyraPolicyRegistryPostgresPool) {
    nyraPolicyRegistryProofConfigurationError ||= "policy_registry_postgres_required";
  }
  if (nyraPolicyRegistryPostgresPool &&
    nyraPolicyRegistryPostgresPool !== options.nyraPolicyRegistryPostgresPool) {
    internallyOwnedPostgresPools.add(nyraPolicyRegistryPostgresPool);
  }
  const nyraPolicyRegistryProofActivationEnabled = nyraPolicyRegistryProofEnabled &&
    nyraPolicyRegistryProofConfigurationError === null;
  let nyraPolicyRegistryCoreSigner = null;
  if (nyraPolicyRegistryProofActivationEnabled) {
    try {
      nyraPolicyRegistryCoreSigner = !nyraPolicyRegistryProofProduction && options.nyraPolicyRegistryCoreSigner
        ? options.nyraPolicyRegistryCoreSigner
        : createNyraPolicyRegistryCoreRemoteSigner({
            origin: process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_ORIGIN,
            path: process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_PATH,
            service: process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_SERVICE,
            targetCommit: nyraPolicyRegistryCoreSignerTargetCommit,
            keyId: nyraPolicyRegistryProofEnv.CORE_NYRA_POLICY_REGISTRY_CORE_KEY_ID,
            serviceToken: process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_SERVICE_TOKEN,
            publicKey: process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_ED25519_PUBLIC_KEY,
            fetchImpl: !nyraPolicyRegistryProofProduction && options.nyraPolicyRegistryCoreSignerFetch
              ? options.nyraPolicyRegistryCoreSignerFetch
              : globalThis.fetch,
            timeoutMs: optionalGenericWorkCoreJoinInteger(
              process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_TIMEOUT_MS,
            ),
            maxResponseBytes: optionalGenericWorkCoreJoinInteger(
              process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_MAX_RESPONSE_BYTES,
            ),
            probeCooldownMs: optionalGenericWorkCoreJoinInteger(
              process.env.CORE_NYRA_POLICY_REGISTRY_CORE_SIGNER_PROBE_COOLDOWN_MS,
            ),
          });
      if (nyraPolicyRegistryProofProduction &&
        nyraPolicyRegistryCoreSigner?.custody !== "external_remote_signer") {
        throw new Error("policy_registry_external_core_signer_required");
      }
    } catch (error) {
      nyraPolicyRegistryCoreSigner = null;
      const code = String(error?.message || "");
      const safeSignerConfigurationErrors = new Set([
        "policy_registry_core_signer_key_id_invalid",
        "policy_registry_core_signer_origin_invalid",
        "policy_registry_core_signer_path_invalid",
        "policy_registry_core_signer_probe_cooldown_invalid",
        "policy_registry_core_signer_public_key_invalid",
        "policy_registry_core_signer_response_limit_invalid",
        "policy_registry_core_signer_service_invalid",
        "policy_registry_core_signer_service_token_required",
        "policy_registry_core_signer_target_commit_invalid",
        "policy_registry_core_signer_timeout_invalid",
        "policy_registry_core_signer_transport_unavailable",
        "policy_registry_external_core_signer_required",
      ]);
      nyraPolicyRegistryProofConfigurationError ||= safeSignerConfigurationErrors.has(code)
        ? code
        : "policy_registry_core_signer_configuration_invalid";
    }
  }
  let nyraPolicyRegistryProofService = null;
  if (nyraPolicyRegistryProofEnabled && nyraPolicyRegistryProofConfigurationError === null) {
    if (!nyraPolicyRegistryPostgresPool) {
      nyraPolicyRegistryProofConfigurationError = "policy_registry_postgres_required";
    } else {
      nyraPolicyRegistryProofService = !nyraPolicyRegistryProofProduction && options.nyraPolicyRegistryProofService
        ? options.nyraPolicyRegistryProofService
        : createNyraPolicyRegistryProofService({
            pool: nyraPolicyRegistryPostgresPool,
            env: nyraPolicyRegistryProofEnv,
            signer: nyraPolicyRegistryCoreSigner,
            compilerProvenanceVerifier: nyraPolicyRegistryCompilerProvenanceVerifier,
          });
    }
  }
  const unavailablePolicyRegistry = Object.freeze({
    kind: "unavailable",
    restart_durable: false,
    distributed: false,
    evaluate: () => ({
      verdict: "DENY",
      reasons: ["policy_registry_unavailable"],
      snapshot_digest: null,
      snapshot_present: false,
      snapshot_verified: false,
      fail_closed: true,
    }),
    activate: async () => { throw new Error("policy_registry_unavailable"); },
    rollback: async () => { throw new Error("policy_registry_unavailable"); },
    resolveRollbackTarget: async () => { throw new Error("policy_registry_unavailable"); },
    reconcile: async () => { throw new Error("policy_registry_unavailable"); },
    status: async () => ({
      configured: false,
      backend: "unavailable",
      restart_durable: false,
      distributed: false,
      compiler_provenance_persistence: false,
      compiler_input_persisted: false,
      state: "unavailable",
      ready: false,
      reason: "policy_registry_unavailable",
    }),
  });
  const allowPolicyRegistryInjection = allowInactivePolicyRegistryInjection;
  const nyraPolicyRegistry = allowPolicyRegistryInjection && options.nyraPolicyRegistryStore
    ? options.nyraPolicyRegistryStore
    : nyraPolicyRegistryPostgresPool
      ? createPostgresNyraPolicyRegistryStore({
          pool: nyraPolicyRegistryPostgresPool,
          consumeCoreReceipt: allowPolicyRegistryInjection && options.consumeNyraPolicyRegistryCoreReceipt
            ? options.consumeNyraPolicyRegistryCoreReceipt
            : nyraPolicyRegistryProofService?.consume,
          verifyActivationSnapshot: allowPolicyRegistryInjection && options.verifyNyraPolicyRegistryActivationSnapshot
            ? options.verifyNyraPolicyRegistryActivationSnapshot
            : nyraPolicyRegistryProofService?.verifyActivationSnapshot,
          verifyCompilerProvenanceRecord:
            nyraPolicyRegistryCompilerProvenanceVerifier?.verifyPersistedRecord,
        })
      : nyraPolicyRegistryProofEnabled || nyraPolicyRegistryCompilerConfigurationError
        ? unavailablePolicyRegistry
        : createNyraPolicyRegistryStore({
            filePath: path.join(storageRoot, "nyra-policy-registry.json"),
            consumeCoreReceipt: options.consumeNyraPolicyRegistryCoreReceipt,
            verifyActivationSnapshot: options.verifyNyraPolicyRegistryActivationSnapshot,
            verifyCompilerProvenanceRecord:
              nyraPolicyRegistryCompilerProvenanceVerifier?.verifyPersistedRecord,
          });
  const nyraPolicyRegistryClient = nyraPolicyRegistryProofEnabled &&
    nyraPolicyRegistryProofConfigurationError === null
    ? (!nyraPolicyRegistryProofProduction && options.nyraPolicyRegistryClient) ||
      createNyraPolicyRegistryClient({
        env: !nyraPolicyRegistryProofProduction && options.nyraPolicyRegistryClientEnv
          ? options.nyraPolicyRegistryClientEnv
          : process.env,
        fetchImpl: !nyraPolicyRegistryProofProduction && options.nyraPolicyRegistryFetch
          ? options.nyraPolicyRegistryFetch
          : globalThis.fetch,
      })
    : null;
  const nyraPolicyRegistryCoordinator = nyraPolicyRegistryProofEnabled &&
    nyraPolicyRegistryProofConfigurationError === null && nyraPolicyRegistryProofService &&
    nyraPolicyRegistryClient
    ? (!nyraPolicyRegistryProofProduction && options.nyraPolicyRegistryCoordinator) ||
      createNyraPolicyRegistryCoordinator({
        proofService: nyraPolicyRegistryProofService,
        registryStore: nyraPolicyRegistry,
        nyraClient: nyraPolicyRegistryClient,
        compilerProvenanceVerifier: nyraPolicyRegistryCompilerProvenanceVerifier,
      })
    : null;
  const reviews = reviewStore(storageRoot);
  const evidence = evidenceStore(storageRoot);
  // Deep Branch V2 has Core-only trust material. Missing or invalid material
  // leaves V1 and the current relational DTT healthy while V2 fails closed.
  const nyraDeepV2Env = options.nyraDeepV2Env || process.env;
  const nyraDeepV2LedgerSecret = String(
    options.nyraDeepV2LedgerSecret
      ?? nyraDeepV2Env.CORE_NYRA_DEEP_BRANCH_V2_LEDGER_SECRET
      ?? "",
  ).trim();
  const nyraDeepV2McpSigningSecret = String(
    options.nyraDeepV2McpSigningSecret
      ?? nyraDeepV2Env.CORE_NYRA_DEEP_BRANCH_V2_MCP_REQUEST_SIGNING_SECRET
      ?? "",
  ).trim();
  const nyraDeepV2AttestationPrivateKey = String(
    options.nyraDeepV2AttestationPrivateKey
      ?? nyraDeepV2Env.CORE_NYRA_DEEP_BRANCH_V2_ATTESTATION_PRIVATE_KEY
      ?? "",
  ).trim();
  const nyraDeepV2AttestationKeyId = String(
    options.nyraDeepV2AttestationKeyId
      ?? nyraDeepV2Env.CORE_NYRA_DEEP_BRANCH_V2_ATTESTATION_KEY_ID
      ?? "universal-core-nyra-v2",
  ).trim();
  let nyraDeepV2Ledger = options.nyraDeepV2EvidenceLedger || null;
  let nyraDeepV2Attester = options.nyraDeepV2Attester || null;
  let nyraDeepV2SourceVerifier = options.nyraDeepV2SourceVerifier || null;
  const nyraDeepV2StateRoot = String(
    options.nyraDeepV2StateRoot
      || ((options.storageRoot || process.env.CORE_SERVICE_STORAGE_ROOT)
        ? path.join(storageRoot, "nyra-deep-v2")
        : ""),
  ).trim();
  const nyraDeepV2SourceRegistry = options.nyraDeepV2SourceRegistry
    || createResearchSourceRegistry(nyraBranchCatalog("skinharmony").branches);
  let nyraDeepV2IntegrationReason = null;
  if (!nyraDeepV2Ledger && nyraDeepV2LedgerSecret.length >= 32) {
    try {
      nyraDeepV2Ledger = createNyraDeepV2EvidenceLedger({
        secret: nyraDeepV2LedgerSecret,
        storagePath: nyraDeepV2StateRoot
          ? path.join(nyraDeepV2StateRoot, "evidence-ledger.json")
          : "",
      });
    } catch {
      nyraDeepV2IntegrationReason = "nyra_deep_branch_v2_ledger_unavailable";
    }
  }
  if (
    !nyraDeepV2Attester
    && nyraDeepV2Ledger
    && nyraDeepV2AttestationPrivateKey
  ) {
    try {
      nyraDeepV2Attester = createNyraDeepBranchV2Attester({
        ledger: nyraDeepV2Ledger,
        signingPrivateKey: nyraDeepV2AttestationPrivateKey,
        keyId: nyraDeepV2AttestationKeyId,
      });
    } catch {
      nyraDeepV2IntegrationReason = "nyra_deep_branch_v2_attester_unavailable";
    }
  }
  if (!nyraDeepV2SourceVerifier) {
    try {
      nyraDeepV2SourceVerifier = createNyraDeepV2SourceVerifier({
        fetchImpl: options.nyraDeepV2SourceFetchImpl,
        dnsLookup: options.nyraDeepV2SourceDnsLookup,
        sourceRegistry: nyraDeepV2SourceRegistry,
        timeoutMs: Number(
          nyraDeepV2Env.CORE_NYRA_DEEP_BRANCH_V2_SOURCE_FETCH_TIMEOUT_MS || 5_000,
        ),
        maxBytes: Number(
          nyraDeepV2Env.CORE_NYRA_DEEP_BRANCH_V2_SOURCE_MAX_BYTES || 250_000,
        ),
      });
    } catch {
      nyraDeepV2IntegrationReason = nyraDeepV2IntegrationReason
        || "nyra_deep_branch_v2_source_verifier_unavailable";
    }
  }
  if (
    !nyraDeepV2IntegrationReason
    && (!nyraDeepV2Ledger || !nyraDeepV2Attester || !nyraDeepV2SourceVerifier)
  ) {
    nyraDeepV2IntegrationReason = "nyra_deep_branch_v2_core_material_unavailable";
  }
  const nyraDeepV2McpRequestVerifier = options.nyraDeepV2McpRequestVerifier
    || createNyraDeepV2McpRequestVerifier({
      secret: nyraDeepV2McpSigningSecret,
      storagePath: nyraDeepV2StateRoot
        ? path.join(nyraDeepV2StateRoot, "mcp-request-replay.json")
        : "",
    });
  const nyraDeepBranchV2Client = options.nyraDeepBranchV2Client
    || createNyraDeepBranchV2Client({
      env: nyraDeepV2Env,
      fetchImpl: options.nyraDeepBranchV2FetchImpl || fetch,
    });
  const tenants = tenantRegistryStore(storageRoot);
  const entityGraph = entityGraphStore(storageRoot);
  const intelligenceOutcomes = intelligenceOutcomeStore(storageRoot);
  const softwareJobs = createUniversalSoftwareJobManager({ adapters: options.softwareWorkerAdapters });
  const coreRuntime = options.coreRuntime || createCoreRuntimeWorker(options.coreRuntimeOptions);
  const genericAgentRuntime = options.genericAgentRuntime || createGenericAgentRuntime();
  const genericAgentCheckpoints = options.genericAgentCheckpointStore || createGenericAgentCheckpointStore({
    root: path.join(storageRoot, "generic-agent-checkpoints"),
  });
  const genericAgentOrchestrator = options.genericAgentOrchestrator || createGenericAgentOrchestrator(options.genericAgentOrchestratorOptions);
  const genericAgentOrchestrationStore = options.genericAgentOrchestrationStore || createGenericAgentOrchestrationStore({
    root: path.join(storageRoot, "generic-agent-orchestrations"),
  });
  const governedAgentRegistry = options.governedAgentRegistry || createGovernedAgentRegistry();
  const relationalOrchestrationSupervisor = options.relationalOrchestrationSupervisor || createRelationalOrchestrationSupervisor();
  const governedAgentDatabaseUrl = String(process.env.GOVERNED_AGENT_DATABASE_URL || "").trim();
  const governedAgentPostgresConfigured =
    /^postgres(?:ql)?:\/\//i.test(governedAgentDatabaseUrl);
  const dynamicTaskTreeStateStore = options.dynamicTaskTreeStateStore || (!hasInjectedPostgresVersionProbe && governedAgentDatabaseUrl
    ? createPostgresDynamicTaskTreeStateStore({
        connectionString: governedAgentDatabaseUrl,
        pool: options.dynamicTaskTreePostgresPool || null,
      })
    : createFileDynamicTaskTreeStateStore({ root: path.join(storageRoot, "dynamic-task-trees") }));
  const dynamicTaskTreeJoinVerdictStore = options.dynamicTaskTreeJoinVerdictStore
    || (!hasInjectedPostgresVersionProbe && governedAgentDatabaseUrl
      ? createPostgresDynamicTaskTreeJoinVerdictStore({
          connectionString: governedAgentDatabaseUrl,
          pool: options.dynamicTaskTreePostgresPool || null,
        })
      : createFileDynamicTaskTreeJoinVerdictStore({
          root: path.join(storageRoot, "dynamic-task-tree-join-verdicts"),
        }));
  const dttAgentIdentitySecretCandidate = String(
    options.dttAgentIdentitySigningSecret ?? process.env.DTT_AGENT_IDENTITY_SIGNING_SECRET ?? "",
  ).trim();
  const dttAgentIdentitySecret = dttAgentIdentitySecretCandidate.length >= 32
    ? dttAgentIdentitySecretCandidate
    : "";
  const dttAgentIdentityPostgresPool = options.dttAgentIdentityPostgresPool
    || (!hasInjectedPostgresVersionProbe && dttAgentIdentitySecret && governedAgentDatabaseUrl
      ? new pg.Pool({ connectionString: governedAgentDatabaseUrl })
      : null);
  if (dttAgentIdentityPostgresPool && !options.dttAgentIdentityPostgresPool) {
    internallyOwnedPostgresPools.add(dttAgentIdentityPostgresPool);
  }
  const governedAgentPostgresVersionPool =
    options.governedAgentPostgresVersionProbe
      ? null
      : options.governedAgentPostgresVersionPool
        || options.dynamicTaskTreePostgresPool
        || dttAgentIdentityPostgresPool
        || (governedAgentPostgresConfigured
          ? new pg.Pool({
              connectionString: governedAgentDatabaseUrl,
              max: 1,
              idleTimeoutMillis: 10_000,
            })
          : null);
  if (governedAgentPostgresVersionPool
    && !options.governedAgentPostgresVersionPool
    && !options.dynamicTaskTreePostgresPool
    && governedAgentPostgresVersionPool !== dttAgentIdentityPostgresPool) {
    internallyOwnedPostgresPools.add(governedAgentPostgresVersionPool);
  }
  const governedAgentPostgresVersionProbe =
    options.governedAgentPostgresVersionProbe
    || (governedAgentPostgresVersionPool
      ? createPostgresMajorVersionProbe({
          pool: governedAgentPostgresVersionPool,
        })
      : null);
  const dttVerificationTrustStore = options.dttVerificationTrustStore
    || (dttAgentIdentityPostgresPool
      ? createPostgresDttVerificationTrustStore({ pool: dttAgentIdentityPostgresPool })
      : createFileDttVerificationTrustStore({
        root: path.join(storageRoot, "dynamic-task-tree-verification-trust"),
      }));
  const dttAgentIdentityReceiptStore = options.dttAgentIdentityReceiptStore || (dttAgentIdentitySecret
    ? (dttAgentIdentityPostgresPool
      ? createPostgresDttAgentIdentityReceiptStore({ pool: dttAgentIdentityPostgresPool })
      : createFileDttAgentIdentityReceiptStore({
        file_path: path.join(storageRoot, "dynamic-task-tree-agent-identities.json"),
      }))
    : null);
  const dttAgentIdentityReceiptService = options.dttAgentIdentityReceiptService
    || (dttAgentIdentitySecret && dttAgentIdentityReceiptStore
      ? createAsyncDttAgentIdentityReceiptService({
        secret: dttAgentIdentitySecret,
        store: dttAgentIdentityReceiptStore,
        resolve_assignment: (input) => dttVerificationTrustStore.verifyAssignment(input),
      })
      : null);
  const dttVerifierIdentityResolverConfigured = typeof options.resolveDttVerifierIdentity === "function"
    || dttAgentIdentityReceiptService?.configured === true;
  const resolveDttVerifierIdentity = dttVerifierIdentityResolverConfigured
    ? (options.resolveDttVerifierIdentity || ((input) => dttAgentIdentityReceiptService.validate(input)))
    : () => ({ verified: false });
  const dynamicTaskTreeRuntime = options.dynamicTaskTreeRuntime || createDynamicTaskTreeRuntime({
    state_store: dynamicTaskTreeStateStore,
    resolve_verifier_identity: resolveDttVerifierIdentity,
    resolve_evidence_artifact: (input) => dttVerificationTrustStore.verifyArtifact(input),
  });
  const dynamicTaskTreeRollout = dynamicTaskTreeRolloutConfig(
    options.dynamicTaskTreeEnv || process.env,
  );
  const researchRuntime = options.researchRuntime || createResearchDistillationRuntime({
    env: options.researchEnv || process.env,
    storageRoot,
  });
  const researchAirlockMode = String(
    options.researchAirlockMode
      ?? process.env.CORE_RESEARCH_AIRLOCK_MODE
      ?? "shadow",
  ).trim().toLowerCase();
  const researchAirlockShadowMonitor =
    process.env.NODE_ENV === "production" && researchAirlockMode === "shadow";
  const researchAirlockRuntime = options.researchAirlockRuntime || createResearchAirlockRuntime({
    store: (researchAirlockMode === "enforced" || researchAirlockShadowMonitor) && governedAgentPostgresConfigured
      ? createPostgresResearchAirlockStore({
          connectionString: governedAgentDatabaseUrl,
          pool: options.researchAirlockPostgresPool || null,
        })
      : null,
    mode: researchAirlockMode,
    shadowMonitorRequired: process.env.NODE_ENV === "production",
    signingSecret: options.researchAirlockSigningSecret
      ?? process.env.CORE_RESEARCH_AIRLOCK_SIGNING_SECRET
      ?? process.env.CORE_EVIDENCE_SIGNING_SECRET
      ?? "",
    releaseCommitSha: BUILD_COMMIT_SHA,
    transport: options.researchAirlockTransport,
  });
  const governedAgentActivationStore = options.governedAgentActivationStore || createGovernedAgentActivationStore({
    root: path.join(storageRoot, "governed-agent-activations"),
  });
  const governedAgentBudgetStore = options.governedAgentBudgetStore || createGovernedAgentBudgetStore({ root: path.join(storageRoot, "governed-agent-budgets") });
  const governedAgentQueueStore = options.governedAgentQueueStore || (governedAgentDatabaseUrl
    ? createGovernedAgentPostgresQueueStore({ connectionString: governedAgentDatabaseUrl })
    : createGovernedAgentQueueStore({ root: path.join(storageRoot, "governed-agent-queue") }));
  const governedAgentDryRunRunner = options.governedAgentDryRunRunner || createGovernedAgentDryRunRunner({ queueStore: governedAgentQueueStore, audit });
  // Core never instantiates, accepts, or invokes a provider credential vault.
  // Native ChatGPT/Codex specialists are materialized by the host, not with an
  // API key or a provider runner.  Keep the legacy values explicitly null so
  // injected vaults, runners, and matching environment variables cannot
  // reactivate the retired path.
  const tenantProviderCredentials = null;
  const ownerExecutionApprovals = options.ownerExecutionApprovals || createOwnerExecutionApprovalStore({
    root: storageRoot,
    credentialStore: null,
  });
  const hostNativeGovernanceEnabled = options.hostNativeGovernance
    ? true
    : String(
        options.hostNativeGovernanceEnabled ??
        process.env.CORE_HOST_NATIVE_GOVERNANCE_ENABLED ??
        "false",
      ).trim().toLowerCase() === "true";
  const hostNativeSigningSecret = String(
    options.hostNativeSigningSecret ??
    process.env.CORE_HOST_NATIVE_SIGNING_SECRET ??
    "",
  ).trim();
  const genericWorkCoreJoinProduction = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
  const genericWorkCoreJoinEnabledFlag = strictGenericWorkCoreJoinBoolean(
    options.genericWorkCoreJoinEnabled ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_ENABLED,
    false,
    "generic_work_core_join_enabled_flag_invalid",
  );
  const genericWorkCoreJoinRequiredFlag = strictGenericWorkCoreJoinBoolean(
    options.genericWorkCoreJoinRequired ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_REQUIRED,
    false,
    "generic_work_core_join_required_flag_invalid",
  );
  const genericWorkCoreJoinEnabled = genericWorkCoreJoinEnabledFlag.value;
  // An invalid explicit required flag can never become an implicit opt-out.
  const genericWorkCoreJoinRequired = genericWorkCoreJoinRequiredFlag.valid
    ? genericWorkCoreJoinRequiredFlag.value
    : true;
  const genericWorkCoreJoinRemoteSignerMode = String(
    options.genericWorkCoreJoinSignerMode
      ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_SIGNER_MODE
      ?? "disabled",
  );
  let genericWorkCoreJoinConfigurationError = !genericWorkCoreJoinEnabledFlag.valid
    ? genericWorkCoreJoinEnabledFlag.error
    : !genericWorkCoreJoinRequiredFlag.valid
      ? genericWorkCoreJoinRequiredFlag.error
      : genericWorkCoreJoinRequired && !genericWorkCoreJoinEnabled
        ? "generic_work_core_join_required_without_enabled"
        : !["disabled", "remote"].includes(genericWorkCoreJoinRemoteSignerMode)
          ? "generic_work_core_join_signer_mode_invalid"
          : null;
  let genericWorkCoreJoinActivationEnabled = genericWorkCoreJoinEnabled
    && genericWorkCoreJoinConfigurationError === null;
  const genericWorkCoreJoinPrivateKey = String(
    options.genericWorkCoreJoinEd25519PrivateKey ?? "",
  ).trim();
  const genericWorkCoreJoinKeyId = String(
    options.genericWorkCoreJoinEd25519KeyId ?? "",
  ).trim();
  const genericWorkCoreJoinInjectedRemoteConfig = options.genericWorkCoreJoinRemoteSignerConfig;
  if (genericWorkCoreJoinInjectedRemoteConfig !== undefined
      && (!genericWorkCoreJoinInjectedRemoteConfig
        || typeof genericWorkCoreJoinInjectedRemoteConfig !== "object"
        || Array.isArray(genericWorkCoreJoinInjectedRemoteConfig))) {
    genericWorkCoreJoinConfigurationError ||= "generic_work_core_join_signer_configuration_invalid";
  }
  if (genericWorkCoreJoinProduction && options.genericWorkCoreJoinSigner !== undefined) {
    genericWorkCoreJoinConfigurationError ||= "generic_work_core_join_signer_injection_forbidden";
  }
  const genericWorkCoreJoinConfiguredTargetCommit =
    genericWorkCoreJoinInjectedRemoteConfig?.targetCommit
    ?? options.genericWorkCoreJoinRemoteSignerTargetCommit
    ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_TARGET_COMMIT
    ?? BUILD_COMMIT_SHA;
  if (genericWorkCoreJoinActivationEnabled
      && genericWorkCoreJoinRemoteSignerMode === "remote"
      && genericWorkCoreJoinProduction
      && (!BUILD_COMMIT_VERIFIABLE || genericWorkCoreJoinConfiguredTargetCommit !== BUILD_COMMIT_SHA)) {
    genericWorkCoreJoinConfigurationError ||= "generic_work_core_join_signer_target_commit_mismatch";
  }
  const genericWorkCoreJoinRemoteSignerConfig = genericWorkCoreJoinInjectedRemoteConfig
    && typeof genericWorkCoreJoinInjectedRemoteConfig === "object"
    && !Array.isArray(genericWorkCoreJoinInjectedRemoteConfig)
    ? {
        ...genericWorkCoreJoinInjectedRemoteConfig,
        targetCommit: genericWorkCoreJoinConfiguredTargetCommit,
      }
    : {
        origin: options.genericWorkCoreJoinRemoteSignerOrigin ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_ORIGIN,
        path: options.genericWorkCoreJoinRemoteSignerPath ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_PATH,
        service: options.genericWorkCoreJoinRemoteSignerService ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_SERVICE,
        targetCommit: genericWorkCoreJoinConfiguredTargetCommit,
        purpose: options.genericWorkCoreJoinRemoteSignerPurpose ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_PURPOSE,
        keyId: options.genericWorkCoreJoinRemoteSignerKeyId ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_KEY_ID,
        serviceToken: options.genericWorkCoreJoinRemoteSignerServiceToken ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_SERVICE_TOKEN,
        publicKey: options.genericWorkCoreJoinRemoteSignerPublicKey ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_ED25519_PUBLIC_KEY,
        jwks: options.genericWorkCoreJoinRemoteSignerJwks ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_JWKS,
        fetchImpl: options.genericWorkCoreJoinRemoteSignerFetch,
        timeoutMs: optionalGenericWorkCoreJoinInteger(
          options.genericWorkCoreJoinRemoteSignerTimeoutMs
            ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_TIMEOUT_MS,
        ),
        maxResponseBytes: optionalGenericWorkCoreJoinInteger(
          options.genericWorkCoreJoinRemoteSignerMaxResponseBytes
            ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_REMOTE_SIGNER_MAX_RESPONSE_BYTES,
        ),
      };
  genericWorkCoreJoinActivationEnabled = genericWorkCoreJoinEnabled
    && genericWorkCoreJoinConfigurationError === null;
  const genericWorkCoreJoinPostgresPool = options.genericWorkCoreJoinPostgresPool
    || governedAgentPostgresVersionPool;
  const genericWorkCoreJoinStore = genericWorkCoreJoinActivationEnabled
    ? options.genericWorkCoreJoinStore
      || (governedAgentPostgresConfigured && genericWorkCoreJoinPostgresPool
        ? createPostgresGenericWorkCoreJoinStore({ pool: genericWorkCoreJoinPostgresPool })
        : null)
    : null;
  const genericWorkCoreJoinSemanticCodes = new Set([
    "acceptance_criteria_invalid",
    "acceptance_criteria_invalid_duplicate",
    "acceptance_criterion_invalid",
    "adapter_unsupported",
    "clock_invalid",
    "evidence_duplicate",
    "evidence_invalid",
    "generic_work_core_join_adapter_mismatch",
    "generic_work_core_join_context_invalid",
    "generic_work_core_join_denied",
    "generic_work_core_join_idempotency_conflict",
    "generic_work_core_join_idempotency_digest_mismatch",
    "generic_work_core_join_input_invalid",
    "generic_work_core_join_key_id_mismatch",
    "generic_work_core_join_nonce_replayed",
    "generic_work_core_join_request_invalid",
    "generic_work_core_join_tenant_id_mismatch",
    "generic_work_core_join_verdict_digest_invalid",
    "generic_work_core_join_verdict_invalid",
    "generic_work_core_join_work_id_mismatch",
    "idempotency_digest_invalid",
    "independent_verifier_acceptance_criteria_digest_mismatch",
    "independent_verifier_adapter_mismatch",
    "independent_verifier_evidence_digest_mismatch",
    "independent_verifier_not_distinct",
    "independent_verifier_receipt_expired",
    "independent_verifier_receipt_invalid",
    "independent_verifier_receipt_untrusted",
    "independent_verifier_task_state_digest_mismatch",
    "independent_verifier_tenant_id_mismatch",
    "independent_verifier_work_id_mismatch",
    "requester_identity_invalid",
    "requester_session_invalid",
    "task_state_invalid",
    "task_state_invalid_duplicate",
    "tenant_id_invalid",
    "work_id_invalid",
  ]);
  const genericWorkCoreJoinSignerRejectedCodes = new Set([
    "generic_work_core_join_signature_invalid",
    "generic_work_core_join_signer_digest_mismatch",
    "generic_work_core_join_signer_key_id_mismatch",
    "generic_work_core_join_signer_purpose_mismatch",
    "generic_work_core_join_signer_redirect_denied",
    "generic_work_core_join_signer_response_invalid",
    "generic_work_core_join_signer_response_too_large",
    "generic_work_core_join_signer_service_mismatch",
    "generic_work_core_join_signer_signature_invalid",
    "generic_work_core_join_signer_target_commit_mismatch",
  ]);
  const genericWorkCoreJoinSafeReason = (value, fallback) => {
    const code = String(value?.message || value || "").trim();
    return genericWorkCoreJoinInfrastructureCode(code) || (genericWorkCoreJoinSemanticCodes.has(code) ? code : fallback);
  };
  const genericWorkCoreJoinSafeCustody = (value) => {
    const custody = String(value || "").trim();
    return /^(?:local_process_key|external_remote_signer|external_kms|kms|hsm)$/.test(custody)
      ? custody
      : custody
        ? "external"
        : null;
  };
  const genericWorkCoreJoinSafeSignerState = (value, fallback = "invalid") => {
    const state = String(value || "").trim();
    return new Set(["configured", "forbidden", "invalid", "ready", "rejected", "unavailable", "unconfigured"]).has(state)
      ? state
      : fallback;
  };
  let genericWorkCoreJoinSigner = null;
  let genericWorkCoreJoinSignerState = "unconfigured";
  let genericWorkCoreJoinSignerReason = "generic_work_core_join_signer_unconfigured";
  let genericWorkCoreJoinSignerCustody = null;
  let genericWorkCoreJoinSignerFailureLatched = false;
  let genericWorkCoreJoinIssueSequence = 0;
  let genericWorkCoreJoinSignerFailureSequence = 0;
  let genericWorkCoreJoinSignerRecoverySequence = 0;
  try {
    if (!genericWorkCoreJoinActivationEnabled) {
      genericWorkCoreJoinSignerReason = genericWorkCoreJoinConfigurationError
        || "generic_work_core_join_disabled";
    } else if (genericWorkCoreJoinRemoteSignerMode === "remote") {
      genericWorkCoreJoinSigner = !genericWorkCoreJoinProduction && options.genericWorkCoreJoinSigner
        ? options.genericWorkCoreJoinSigner
        : createGenericWorkCoreJoinRemoteSigner(genericWorkCoreJoinRemoteSignerConfig);
    } else if (options.genericWorkCoreJoinSigner && !genericWorkCoreJoinProduction) {
      // Explicit dependency injection is a non-production test seam only.
      genericWorkCoreJoinSigner = options.genericWorkCoreJoinSigner;
    } else if (genericWorkCoreJoinPrivateKey && genericWorkCoreJoinKeyId && !genericWorkCoreJoinProduction) {
      genericWorkCoreJoinSigner = createLocalGenericWorkCoreJoinSigner({ privateKey: genericWorkCoreJoinPrivateKey, keyId: genericWorkCoreJoinKeyId });
    } else if (genericWorkCoreJoinPrivateKey || genericWorkCoreJoinKeyId) {
      genericWorkCoreJoinSignerCustody = "local_process_key";
      genericWorkCoreJoinSignerState = "forbidden";
      genericWorkCoreJoinSignerReason = genericWorkCoreJoinProduction
        ? "generic_work_core_join_local_signer_forbidden"
        : "generic_work_core_join_signing_unavailable";
    }
    if (genericWorkCoreJoinSigner) {
      genericWorkCoreJoinSignerCustody = genericWorkCoreJoinSafeCustody(genericWorkCoreJoinSigner.custody || "external");
      if (genericWorkCoreJoinProduction && genericWorkCoreJoinSignerCustody === "local_process_key") {
        genericWorkCoreJoinSigner = null;
        genericWorkCoreJoinSignerState = "forbidden";
        genericWorkCoreJoinSignerReason = "generic_work_core_join_local_signer_forbidden";
      } else if (genericWorkCoreJoinProduction && !["external_remote_signer", "external_kms", "kms", "hsm"].includes(genericWorkCoreJoinSignerCustody)) {
        genericWorkCoreJoinSigner = null;
        genericWorkCoreJoinSignerState = "invalid";
        genericWorkCoreJoinSignerReason = "generic_work_core_join_external_signer_required";
      } else {
        const signerHealth = typeof genericWorkCoreJoinSigner.health === "function"
          ? genericWorkCoreJoinSigner.health()
          : null;
        genericWorkCoreJoinSignerState = genericWorkCoreJoinSafeSignerState(
          signerHealth?.signer_state || genericWorkCoreJoinSigner.signer_state || "configured",
          "unavailable",
        );
        genericWorkCoreJoinSignerReason = genericWorkCoreJoinSafeReason(
          signerHealth?.reason || genericWorkCoreJoinSigner.signer_reason,
          genericWorkCoreJoinSignerState === "unavailable"
            ? "generic_work_core_join_signer_unavailable"
            : null,
        );
      }
    }
  } catch (error) {
    genericWorkCoreJoinSigner = null;
    genericWorkCoreJoinSignerState = "invalid";
    genericWorkCoreJoinSignerReason = genericWorkCoreJoinSafeReason(error, "generic_work_core_join_signer_configuration_invalid");
    genericWorkCoreJoinConfigurationError ||= genericWorkCoreJoinSignerReason;
    genericWorkCoreJoinActivationEnabled = false;
    genericWorkCoreJoinSignerCustody = genericWorkCoreJoinRemoteSignerMode === "remote"
      ? "external_remote_signer"
      : genericWorkCoreJoinSignerCustody;
  }
  let genericWorkCoreJoinStoreState = !genericWorkCoreJoinActivationEnabled
    ? "disabled"
    : genericWorkCoreJoinStore
      ? "initializing"
      : "unavailable";
  let genericWorkCoreJoinStoreError = null;
  const genericWorkCoreJoinStoreInitialization = !genericWorkCoreJoinActivationEnabled
    ? Promise.resolve()
    : genericWorkCoreJoinStore?.initialize
    ? Promise.resolve().then(() => genericWorkCoreJoinStore.initialize()).then(() => { genericWorkCoreJoinStoreState = "ready"; }).catch((error) => { genericWorkCoreJoinStoreState = "failed"; genericWorkCoreJoinStoreError = genericWorkCoreJoinSafeReason(error, "generic_work_core_join_store_initialization_failed"); })
    : Promise.resolve().then(() => { genericWorkCoreJoinStoreState = "failed"; genericWorkCoreJoinStoreError = "initialize_unavailable"; });
  let genericWorkCoreJoinAuthority = null;
  if (genericWorkCoreJoinSigner
      && dttAgentIdentitySecret
      && genericWorkCoreJoinStore?.restart_durable === true
      && (!genericWorkCoreJoinProduction || genericWorkCoreJoinStore?.distributed === true)) {
    try {
      genericWorkCoreJoinAuthority = createGenericWorkCoreJoinAuthority({
          signer: genericWorkCoreJoinSigner,
          store: genericWorkCoreJoinStore,
          verifyIndependentVerifierReceipt: (receipt) => {
            const { signature, ...unsigned } = receipt || {};
            const expected = crypto.createHmac("sha256", dttAgentIdentitySecret)
              .update(`generic_work_verifier_receipt_v1\0${genericWorkCoreJoinDigest(unsigned)}`).digest("base64url");
            const left = Buffer.from(String(signature || ""));
            const right = Buffer.from(expected);
            return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
          },
        });
    } catch (error) {
      genericWorkCoreJoinAuthority = null;
      genericWorkCoreJoinSignerState = "invalid";
      genericWorkCoreJoinSignerReason = genericWorkCoreJoinSafeReason(error, "generic_work_core_join_signer_configuration_invalid");
    }
  }
  const genericWorkCoreJoinVerifier = genericWorkCoreJoinAuthority ? createGenericWorkCoreJoinVerdictVerifier({ publicKey: genericWorkCoreJoinSigner.public_key, keyId: genericWorkCoreJoinSigner.key_id }) : null;
  const genericWorkCoreJoinProbeCooldownMs = Math.min(60_000, Math.max(100, Number(
    options.genericWorkCoreJoinSignerProbeCooldownMs
      ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_SIGNER_PROBE_COOLDOWN_MS
      ?? 5_000,
  ) || 5_000));
  const genericWorkCoreJoinProbeTimeoutMs = Math.min(10_000, Math.max(100, Number(
    options.genericWorkCoreJoinSignerProbeTimeoutMs
      ?? process.env.CORE_GENERIC_WORK_CORE_JOIN_SIGNER_PROBE_TIMEOUT_MS
      ?? 2_000,
  ) || 2_000));
  const genericWorkCoreJoinProbeNow = typeof options.genericWorkCoreJoinProbeNow === "function"
    ? options.genericWorkCoreJoinProbeNow
    : () => Date.now();
  let genericWorkCoreJoinProbeInFlight = null;
  let genericWorkCoreJoinProbeLastAttemptAt = Number.NEGATIVE_INFINITY;
  let genericWorkCoreJoinProbeAttempts = 0;
  const genericWorkCoreJoinSignerHealth = () => {
    if (typeof genericWorkCoreJoinSigner?.health !== "function") {
      return {
        signer_state: genericWorkCoreJoinSignerState,
        reason: genericWorkCoreJoinSignerReason,
      };
    }
    try {
      const signerHealth = genericWorkCoreJoinSigner.health();
      const reportedState = genericWorkCoreJoinSafeSignerState(
        signerHealth?.signer_state || genericWorkCoreJoinSignerState,
        genericWorkCoreJoinSignerState,
      );
      // Signer-owned health may degrade application readiness, but only a
      // locally verified application-owned probe may promote it to ready.
      const effectiveState = reportedState === "ready"
        && genericWorkCoreJoinSignerState !== "ready"
        ? genericWorkCoreJoinSignerState
        : reportedState;
      return {
        signer_state: effectiveState === "configured"
          && genericWorkCoreJoinSignerState !== "configured"
          ? genericWorkCoreJoinSignerState
          : effectiveState,
        reason: genericWorkCoreJoinSafeReason(
          effectiveState === reportedState
            ? signerHealth?.reason
            : genericWorkCoreJoinSignerReason,
          genericWorkCoreJoinSignerReason,
        ),
      };
    } catch {
      return {
        signer_state: "unavailable",
        reason: "generic_work_core_join_signer_health_unavailable",
      };
    }
  };
  const ensureGenericWorkCoreJoinSignerReady = async () => {
    if (!genericWorkCoreJoinActivationEnabled
        || !genericWorkCoreJoinAuthority
        || !genericWorkCoreJoinVerifier
        || genericWorkCoreJoinStoreState !== "ready"
        || genericWorkCoreJoinSignerFailureLatched) return false;
    const current = genericWorkCoreJoinSignerHealth();
    // A remote client may complete after this service's stricter probe deadline.
    // Its late health transition must not promote the application without a new
    // bounded probe that starts after the cooldown.
    if (current.signer_state === "ready" && genericWorkCoreJoinSignerState === "ready") return true;
    if (["forbidden", "invalid", "unconfigured"].includes(current.signer_state)) return false;
    if (genericWorkCoreJoinProbeInFlight) return genericWorkCoreJoinProbeInFlight;
    const nowValue = Number(genericWorkCoreJoinProbeNow());
    if (!Number.isFinite(nowValue)
        || nowValue - genericWorkCoreJoinProbeLastAttemptAt < genericWorkCoreJoinProbeCooldownMs) return false;
    genericWorkCoreJoinProbeLastAttemptAt = nowValue;
    genericWorkCoreJoinProbeAttempts += 1;
    const challengeDigest = genericWorkCoreJoinDigest({
      schema_version: "generic_work_core_join_signer_challenge_v1",
      service: SERVICE_NAME,
      build_commit: BUILD_COMMIT_SHA || "development",
      key_id: genericWorkCoreJoinAuthority.signer_metadata.key_id,
      public_key_fingerprint: genericWorkCoreJoinAuthority.signer_metadata.public_key_fingerprint,
      nonce: crypto.randomBytes(32).toString("hex"),
    });
    let challengeTimeout;
    const signatureOperation = Promise.resolve()
      .then(() => genericWorkCoreJoinSigner.signDigest(challengeDigest));
    void signatureOperation.catch(() => {});
    const boundedSignature = Promise.race([
      signatureOperation,
      new Promise((_, reject) => {
        challengeTimeout = setTimeout(
          () => reject(new Error("generic_work_core_join_signer_timeout")),
          genericWorkCoreJoinProbeTimeoutMs,
        );
        challengeTimeout.unref?.();
      }),
    ]);
    const probeResult = boundedSignature
      .then((signature) => {
        verifyGenericWorkCoreJoinDigestSignature({
          digest: challengeDigest,
          signature,
          publicKey: genericWorkCoreJoinSigner.public_key,
        });
        genericWorkCoreJoinSignerState = "ready";
        genericWorkCoreJoinSignerReason = null;
        return true;
      })
      .catch((error) => {
        const code = genericWorkCoreJoinSignerInfrastructureCode(error)
          || "generic_work_core_join_signer_unavailable";
        genericWorkCoreJoinSignerState = genericWorkCoreJoinSignerRejectedCodes.has(code)
          ? "rejected"
          : "unavailable";
        genericWorkCoreJoinSignerReason = code;
        return false;
      })
      .finally(() => {
        clearTimeout(challengeTimeout);
      });
    genericWorkCoreJoinProbeInFlight = probeResult;
    // Keep the single-flight barrier after an outer timeout until the underlying
    // signer call settles. This prevents an old live operation overlapping a
    // retry, while callers still receive the bounded fail-closed result.
    void Promise.allSettled([signatureOperation, probeResult]).then(() => {
      if (genericWorkCoreJoinProbeInFlight === probeResult) {
        const settledAt = Number(genericWorkCoreJoinProbeNow());
        if (Number.isFinite(settledAt)) {
          genericWorkCoreJoinProbeLastAttemptAt = Math.max(
            genericWorkCoreJoinProbeLastAttemptAt,
            settledAt,
          );
        }
        genericWorkCoreJoinProbeInFlight = null;
      }
    });
    return probeResult;
  };
  const bootstrapAuthorityTrustPinRaw = String(
    options.bootstrapAuthorityTrustPinJson ??
    process.env.CORE_BOOTSTRAP_AUTHORITY_TRUST_PIN_JSON ??
    "",
  ).trim();
  let bootstrapAuthorityTrustPin = null;
  let bootstrapAuthorityAttestationStatus = "unavailable";
  let bootstrapReleaseExceptionStore = options.bootstrapReleaseExceptionStore || null;
  let bootstrapReleaseExceptionStoreState = bootstrapReleaseExceptionStore ? "initializing" : "unavailable";
  let bootstrapReleaseExceptionStoreError = null;
  if (bootstrapAuthorityTrustPinRaw) {
    try {
      bootstrapAuthorityTrustPin = parseBootstrapAuthorityTrustPin(bootstrapAuthorityTrustPinRaw);
      if (!governedAgentPostgresConfigured || !governedAgentPostgresVersionPool) {
        bootstrapReleaseExceptionStoreState = "postgres_unavailable";
      } else if (!bootstrapReleaseExceptionStore) {
        bootstrapReleaseExceptionStore = createPostgresBootstrapAuthorityStore({
          pool: governedAgentPostgresVersionPool,
        });
        bootstrapReleaseExceptionStoreState = "initializing";
      }
    } catch (error) {
      bootstrapReleaseExceptionStoreState = "trust_pin_invalid";
      bootstrapReleaseExceptionStoreError = String(error?.message || "trust_pin_invalid").slice(0, 120);
    }
  }
  const bootstrapReleaseExceptionStoreInitialization = bootstrapReleaseExceptionStore?.initialize &&
    bootstrapAuthorityTrustPin
    ? Promise.resolve().then(async () => {
      await bootstrapReleaseExceptionStore.initialize();
      const key = await bootstrapReleaseExceptionStore.resolveActiveTrustKey({
        tenant_id: bootstrapAuthorityTrustPin.tenant_id,
        authority_key_id: bootstrapAuthorityTrustPin.authority_key_id,
      });
      const localSoftwareUnattested = key.authority_provider === "local_pin" &&
        key.attestation_status === "UNATTESTED_LOCAL_SOFTWARE" &&
        key.provider_attestation_digest == null;
      if (key.public_key_sha256 !== bootstrapAuthorityTrustPin.public_key_sha256 ||
          key.genesis_record_digest !== bootstrapAuthorityTrustPin.genesis_record_digest ||
          key.authority_provider !== "local_pin" || key.algorithm !== "ECDSA_P256_SHA256_P1363" ||
          !localSoftwareUnattested) {
        bootstrapAuthorityFail("bootstrap_authority_trust_pin_mismatch");
      }
      bootstrapAuthorityAttestationStatus = key.attestation_status;
      bootstrapReleaseExceptionStoreState = "ready";
    }).catch((error) => {
      bootstrapReleaseExceptionStoreState = "failed";
      bootstrapReleaseExceptionStoreError = String(error?.message || "initialization_failed").slice(0, 120);
    })
    : Promise.resolve();
  const bootstrapReleaseExceptionAdapter = bootstrapReleaseExceptionStore && bootstrapAuthorityTrustPin
    ? Object.freeze({
        async verifyAndRecord({ receipt, expected } = {}) {
          await bootstrapReleaseExceptionStoreInitialization;
          if (bootstrapReleaseExceptionStoreState !== "ready") {
            bootstrapAuthorityFail("bootstrap_release_exception_store_unavailable");
          }
          if (!receipt || !expected || expected.tenant_id !== bootstrapAuthorityTrustPin.tenant_id ||
              expected.action !== "github.merge" ||
              typeof expected.required_checks_policy_digest !== "string" ||
              typeof expected.required_checks_digest !== "string" ||
              !expected.bootstrap_deadlock_verdict ||
              expected.bootstrap_deadlock_verdict.core_policy_verdict_digest !== receipt.core_policy_verdict_digest) {
            bootstrapAuthorityFail("bootstrap_release_exception_expected_binding_invalid");
          }
          const trustKey = await bootstrapReleaseExceptionStore.resolveActiveTrustKey({
            tenant_id: expected.tenant_id,
            authority_key_id: receipt.authority_key_id,
          });
          if (!trustKey || trustKey.authority_provider !== "local_pin" ||
              trustKey.algorithm !== "ECDSA_P256_SHA256_P1363") {
            bootstrapAuthorityFail("bootstrap_trust_key_unavailable");
          }
          const candidate = verifyLocalPinBootstrapReleaseException({
            receipt,
            publicKeySpki: trustKey.public_key_spki_der,
            nowMs: Date.now(),
            expected: {
              allowed_action: expected.action,
              core_policy_verdict_digest: expected.bootstrap_deadlock_verdict.core_policy_verdict_digest,
              exception_id: receipt.exception_id,
              head_sha: expected.head_sha,
              nonce: receipt.nonce,
              owner_confirmation_digest: receipt.owner_confirmation_digest,
              post_deploy_obligations_digest: receipt.post_deploy_obligations_digest,
              pr_number: expected.pr_number,
              repository: expected.repository,
              required_checks_digest: expected.required_checks_policy_digest,
              required_checks_results_digest: expected.required_checks_digest,
              rollback_obligations_digest: receipt.rollback_obligations_digest,
              tenant_id: expected.tenant_id,
              work_id: expected.work_id,
            },
          });
          await bootstrapReleaseExceptionStore.recordVerifiedCandidate({ receipt, candidate });
          return Object.freeze({ candidate });
        },
        async consume({ candidate, expected, action_ticket_id, consumed_by } = {}) {
          await bootstrapReleaseExceptionStoreInitialization;
          if (bootstrapReleaseExceptionStoreState !== "ready" || !candidate || !expected ||
              expected.tenant_id !== bootstrapAuthorityTrustPin.tenant_id || expected.action !== "github.merge") {
            bootstrapAuthorityFail("bootstrap_release_exception_store_unavailable");
          }
          const actionRequestDigest = crypto.createHash("sha256").update(
            `bootstrap_release_exception_action_request_v1\0${bootstrapReleaseExceptionCanonicalJson({
              action_ticket_id,
              consumed_by,
              head_sha: expected.head_sha,
              pr_number: expected.pr_number,
              repository: expected.repository,
              tenant_id: expected.tenant_id,
              work_id: expected.work_id,
            })}`,
            "utf8",
          ).digest("hex");
          const recorded = await bootstrapReleaseExceptionStore.read({
            tenant_id: expected.tenant_id,
            exception_id: candidate.exception_id,
          });
          const persisted = recorded?.receipt;
          const receipt = persisted?.receipt;
          if (!persisted || !receipt || persisted.receipt_digest !== candidate.receipt_digest ||
              receipt.tenant_id !== expected.tenant_id || receipt.work_id !== expected.work_id ||
              receipt.repository !== expected.repository || receipt.pr_number !== expected.pr_number ||
              receipt.head_sha !== expected.head_sha || receipt.allowed_action !== expected.action ||
              receipt.authority_key_id !== persisted.authority_key_id || recorded.revocation) {
            bootstrapAuthorityFail("bootstrap_release_exception_not_eligible");
          }
          if (recorded.consumption) {
            const consumption = recorded.consumption;
            const outbox = recorded.outbox;
            if (consumption.tenant_id !== expected.tenant_id ||
                consumption.exception_id !== receipt.exception_id ||
                consumption.receipt_digest !== persisted.receipt_digest ||
                consumption.work_id !== expected.work_id || consumption.repository !== expected.repository ||
                Number(consumption.pr_number) !== Number(expected.pr_number) ||
                consumption.head_sha !== expected.head_sha || consumption.allowed_action !== expected.action ||
                consumption.action_request_digest !== actionRequestDigest || consumption.consumed_by !== consumed_by ||
                !outbox || outbox.action_request_digest !== actionRequestDigest ||
                outbox.tenant_id !== expected.tenant_id || outbox.exception_id !== receipt.exception_id ||
                outbox.allowed_action !== expected.action || outbox.target?.repository !== expected.repository ||
                Number(outbox.target?.pr_number) !== Number(expected.pr_number) ||
                outbox.target?.head_sha !== expected.head_sha || outbox.target?.allowed_action !== expected.action) {
              bootstrapAuthorityFail("bootstrap_release_exception_replayed");
            }
            return Object.freeze({
              consumption,
              outbox,
              event: null,
              action_authorized: true,
              core_join_authorized: false,
              idempotent_recovery: true,
            });
          }
          return bootstrapReleaseExceptionStore.consume({
            tenant_id: expected.tenant_id,
            exception_id: receipt.exception_id,
            work_id: expected.work_id,
            repository: expected.repository,
            pr_number: expected.pr_number,
            head_sha: expected.head_sha,
            allowed_action: expected.action,
            authority_key_id: persisted.authority_key_id,
            required_checks_digest: receipt.required_checks_digest,
            required_checks_results_digest: receipt.required_checks_results_digest,
            owner_confirmation_digest: receipt.owner_confirmation_digest,
            core_policy_verdict_digest: receipt.core_policy_verdict_digest,
            rollback_obligations_digest: receipt.rollback_obligations_digest,
            post_deploy_obligations_digest: receipt.post_deploy_obligations_digest,
            receipt_digest: persisted.receipt_digest,
            action_request_digest: actionRequestDigest,
            consumed_by,
            target: {
              repository: expected.repository,
              pr_number: expected.pr_number,
              head_sha: expected.head_sha,
              allowed_action: expected.action,
            },
          });
        },
      })
    : null;
  let bootstrapDeadlockVerdictStore = null;
  const bootstrapDeadlockAllowedFailureCodes = BOOTSTRAP_DEADLOCK_ALLOWED_FAILURE_CODES;
  let bootstrapDeadlockVerdictStoreState = "unavailable";
  let bootstrapDeadlockVerdictStoreError = null;
  if (!governedAgentPostgresConfigured || !governedAgentPostgresVersionPool) {
    bootstrapDeadlockVerdictStoreState = "postgres_unavailable";
  } else {
    try {
      bootstrapDeadlockVerdictStore = createBootstrapDeadlockVerdictStore({
        pool: governedAgentPostgresVersionPool,
        allowedFailureCodes: bootstrapDeadlockAllowedFailureCodes,
      });
      bootstrapDeadlockVerdictStoreState = "initializing";
    } catch (error) {
      bootstrapDeadlockVerdictStoreState = "failed";
      bootstrapDeadlockVerdictStoreError = String(error?.message || "initialization_failed").slice(0, 120);
    }
  }
  const bootstrapDeadlockVerdictStoreInitialization = bootstrapDeadlockVerdictStore?.initialize
    ? Promise.resolve().then(() => bootstrapDeadlockVerdictStore.initialize()).then(() => {
      bootstrapDeadlockVerdictStoreState = "ready";
    }).catch((error) => {
      bootstrapDeadlockVerdictStoreState = "failed";
      bootstrapDeadlockVerdictStoreError = String(error?.message || "initialization_failed").slice(0, 120);
    })
    : Promise.resolve();
  const bootstrapDeadlockVerdictResolver = bootstrapDeadlockVerdictStore
    ? async ({
      tenant_id: tenantId,
      work_id: workId,
      repository,
      pr_number: prNumber,
      head_sha: headSha,
      exception_id: exceptionId,
      action,
      core_policy_verdict_digest: verdictDigest,
    } = {}) => {
      await bootstrapDeadlockVerdictStoreInitialization;
      if (bootstrapDeadlockVerdictStoreState !== "ready" || !exceptionId) return null;
      try {
        const verdict = await bootstrapDeadlockVerdictStore.resolveActive({
          tenant_id: tenantId,
          work_id: workId,
          repository,
          pr_number: prNumber,
          head_sha: headSha,
          exception_id: exceptionId,
          action,
          verdict_digest: verdictDigest,
        });
        if (!verdict || verdict.classification !== "BOOTSTRAP_DEADLOCK_VERIFIED" ||
            verdict.normal_path_available !== false || verdict.execution_authorized !== false ||
            verdict.host_action_authorized !== false ||
            Date.parse(verdict.expires_at || "") <= Date.now()) return null;
        return Object.freeze({
          classification: verdict.classification,
          active: true,
          expires_at: verdict.expires_at,
          core_policy_verdict_digest: verdict.verdict_digest,
          exception_id: verdict.exception_id,
        });
      } catch {
        return null;
      }
    }
    : null;
  const hostNativeResolverConfigurationValid =
    options.hostNativeResolverConfigurationValid !== false
    && serverResolverRegistry?.configuration_valid !== false;
  const hostNativeResolverConfigurationError = hostNativeResolverConfigurationValid
    ? null
    : String(
        options.hostNativeResolverConfigurationError ||
        "host_native_resolver_registry_invalid",
      ).slice(0, 160);
  const hostNativeProjectScopeRenderOriginResolver =
    options.hostNativeProjectScopeRenderOriginResolver ||
    (nyraPolicyRegistryPostgresPool
      ? createProjectScopeRenderOriginResolver({
          pool: nyraPolicyRegistryPostgresPool,
          maxAgeMs:
            options.hostNativeRenderScopeMaxAgeMs ??
            process.env.CORE_HOST_NATIVE_RENDER_SCOPE_MAX_AGE_MS,
        })
      : null);
  // Always provide a fail-closed resolver. Without an exact environment or
  // verified Project Scope binding, host-native governance must not consume a
  // caller/manifest origin or synthesize a service-slug origin.
  const serverOwnedRenderServiceOriginResolver =
    serverResolverRegistry?.render?.resolver || null;
  const hostNativeRenderServiceOriginResolver =
    createFailClosedRenderOriginResolver({
      environmentResolver: serverOwnedRenderServiceOriginResolver
        || options.hostNativeRenderServiceOriginResolver
        || null,
      projectScopeResolver: hostNativeProjectScopeRenderOriginResolver,
    });
  const hostNativeRenderServiceOriginResolverState =
    typeof serverOwnedRenderServiceOriginResolver === "function"
      ? (hostNativeProjectScopeRenderOriginResolver
          ? "exact_registry_then_project_scope"
          : "exact_registry_only")
      : typeof options.hostNativeRenderServiceOriginResolver === "function"
      ? (hostNativeProjectScopeRenderOriginResolver
          ? "exact_registry_then_project_scope"
          : "exact_registry_only")
      : (hostNativeProjectScopeRenderOriginResolver
          ? "project_scope_only"
          : "fail_closed_unavailable");
  let hostNativeGovernance = options.hostNativeGovernance || null;
  let hostNativeGovernanceState = hostNativeGovernance ? "ready" : "disabled";
  const hostNativeRequiredChecksPolicyResolver =
    serverResolverRegistry?.required_checks?.resolver
    || options.hostNativeRequiredChecksPolicyResolver
    || null;
  const hostNativeGithubTokenResolver =
    serverResolverRegistry?.github?.resolver
    || options.hostNativeGithubTokenResolver
    || null;
  if (
    hostNativeGovernanceEnabled &&
    hostNativeGovernance &&
    (
      hostNativeGovernance.required_checks_policy_resolver_configured !== true ||
      hostNativeGovernance.closure_attestation_verifier_configured !== true
    )
  ) {
    hostNativeGovernance = null;
    hostNativeGovernanceState = "required_governance_verifier_unavailable";
    audit.append("core_host_native_governance_unavailable", {
      reason: hostNativeGovernanceState,
    });
  }
  if (hostNativeGovernanceEnabled && !hostNativeGovernance) {
    if (!hostNativeResolverConfigurationValid) {
      hostNativeGovernanceState = "resolver_configuration_invalid";
      audit.append("core_host_native_governance_unavailable", {
        reason: hostNativeGovernanceState,
        error_code: hostNativeResolverConfigurationError,
      });
    } else if (typeof hostNativeRequiredChecksPolicyResolver !== "function") {
      hostNativeGovernanceState = "required_checks_policy_unavailable";
      audit.append("core_host_native_governance_unavailable", {
        reason: hostNativeGovernanceState,
      });
    } else if (!dttAgentIdentitySecret) {
      hostNativeGovernanceState = "closure_attestation_signing_secret_unavailable";
      audit.append("core_host_native_governance_unavailable", {
        reason: hostNativeGovernanceState,
      });
    } else if (hostNativeSigningSecret.length < 32) {
      hostNativeGovernanceState = "signing_secret_unavailable";
      audit.append("core_host_native_governance_unavailable", {
        reason: hostNativeGovernanceState,
      });
    } else {
      try {
        const hostNativeStore = options.hostNativeGovernanceStore ||
          createFileHostNativeGovernanceStore({
            root: path.join(storageRoot, "host-native-governance"),
          });
        const hostNativeExternalReadbackVerifier =
          options.hostNativeExternalReadbackVerifier ||
          createHostNativeExternalReadbackVerifier({
            fetchImpl: options.hostNativeReadbackFetchImpl || fetch,
            githubTokenResolver: hostNativeGithubTokenResolver,
            requiredChecksPolicyResolver: hostNativeRequiredChecksPolicyResolver,
            timeoutMs: Number(
              options.hostNativeReadbackTimeoutMs ??
              process.env.CORE_HOST_NATIVE_READBACK_TIMEOUT_MS ??
              5_000,
            ),
          });
        const hostNativeReleaseJoinVerdictResolver =
          options.hostNativeReleaseJoinVerdictResolver ||
          createHostNativeReleaseJoinVerdictResolver({
            fetchImpl: options.hostNativeReadbackFetchImpl || fetch,
            githubTokenResolver: hostNativeGithubTokenResolver,
            requiredChecksPolicyResolver: hostNativeRequiredChecksPolicyResolver,
            timeoutMs: Number(
              options.hostNativeReadbackTimeoutMs ??
              process.env.CORE_HOST_NATIVE_READBACK_TIMEOUT_MS ??
              5_000,
            ),
          });
        hostNativeGovernance = createHostNativeGovernance({
          store: hostNativeStore,
          signingSecret: hostNativeSigningSecret,
          externalReadbackVerifier: hostNativeExternalReadbackVerifier,
          releaseJoinVerdictResolver: hostNativeReleaseJoinVerdictResolver,
          renderServiceOriginResolver: hostNativeRenderServiceOriginResolver,
          requiredChecksPolicyResolver: hostNativeRequiredChecksPolicyResolver,
          closureAttestationSigningSecret: dttAgentIdentitySecret,
          bootstrapReleaseExceptionStore: bootstrapReleaseExceptionAdapter,
          bootstrapDeadlockVerdictResolver,
        });
        hostNativeGovernanceState = "ready";
      } catch (error) {
        hostNativeGovernanceState = "persistent_store_unavailable";
        audit.append("core_host_native_governance_unavailable", {
          reason: hostNativeGovernanceState,
          error_code: String(error?.message || "initialization_failed").slice(0, 160),
        });
      }
    }
  }
  const bootstrapRequiredChecksReadback = options.bootstrapRequiredChecksReadback ||
    (typeof hostNativeRequiredChecksPolicyResolver === "function"
      ? createBootstrapRequiredChecksReadback({
          fetchImpl: options.hostNativeReadbackFetchImpl || fetch,
          githubTokenResolver: options.hostNativeGithubTokenResolver || null,
          requiredChecksPolicyResolver: hostNativeRequiredChecksPolicyResolver,
          timeoutMs: Number(
            options.hostNativeReadbackTimeoutMs ??
            process.env.CORE_HOST_NATIVE_READBACK_TIMEOUT_MS ??
            5_000,
          ),
        })
      : null);
  const bootstrapReleasePreparationBaseBranchResolver =
    options.bootstrapReleasePreparationBaseBranchResolver || null;
  const bootstrapReleasePreparationService = options.bootstrapReleasePreparationService ||
    (hostNativeGovernance && bootstrapRequiredChecksReadback && bootstrapDeadlockVerdictStore &&
      bootstrapDeadlockAllowedFailureCodes && bootstrapAuthorityTrustPin &&
      typeof bootstrapReleasePreparationBaseBranchResolver === "function"
      ? createBootstrapReleasePreparationService({
          normalPathAttempt: async ({ authenticated_tenant_id, normal_action_request }) => {
            try {
              await hostNativeGovernance.issueActionTicket({
                ...normal_action_request,
                tenant_id: authenticated_tenant_id,
              });
              return { ok: true };
            } catch (error) {
              const failure = String(error?.message || "").trim();
              return { ok: false, failure_code: BOOTSTRAP_DEADLOCK_FAILURE_CODE_MAP[failure] || null };
            }
          },
          requiredChecksReadback: async ({ authenticated_tenant_id, normal_action_request }) => {
            const baseBranch = await bootstrapReleasePreparationBaseBranchResolver({
              tenant_id: authenticated_tenant_id,
              repository: normal_action_request.repository,
              pr_number: normal_action_request.pr_number,
              head_sha: normal_action_request.head_sha,
            });
            const attestation = await bootstrapRequiredChecksReadback.attest({
              tenant_id: authenticated_tenant_id,
              repository: normal_action_request.repository,
              pr_number: normal_action_request.pr_number,
              head_sha: normal_action_request.head_sha,
              base_branch: baseBranch,
            });
            return {
              ...attestation,
              work_id: normal_action_request.work_id,
              policy_revision: attestation.required_checks_digest,
            };
          },
          deadlockVerdictStore: bootstrapDeadlockVerdictStore,
          activeTrustKeyResolver: async ({ tenant_id, authority_provider }) => {
            if (authority_provider !== "local_pin") return null;
            await bootstrapReleaseExceptionStoreInitialization;
            if (bootstrapReleaseExceptionStoreState !== "ready") return null;
            const key = await bootstrapReleaseExceptionStore.resolveActiveTrustKey({
              tenant_id,
              authority_key_id: bootstrapAuthorityTrustPin.authority_key_id,
            });
            return {
              status: String(key.status || "").toLowerCase(),
              authority_provider: key.authority_provider,
              authority_key_id: key.authority_key_id,
            };
          },
          ownerConfirmationVerifier: async ({ owner_confirmation, expected }) => {
            const verified = verifyOwnerContextAssertion(
              owner_confirmation,
              ownerContextSigningSecret,
              expected.tenant_id,
              expected.request_digest,
            );
            if (!verified || owner_confirmation?.owner_subject_fingerprint !== expected.owner_id) {
              return { verified: false };
            }
            return {
              verified: true,
              tenant_id: expected.tenant_id,
              owner_id: expected.owner_id,
              request_digest: expected.request_digest,
              owner_confirmation_digest: crypto.createHash("sha256").update(
                `bootstrap_owner_confirmation_v1\0${bootstrapReleaseExceptionCanonicalJson(owner_confirmation)}`,
                "utf8",
              ).digest("hex"),
            };
          },
          now: Date.now,
          idFactory: (kind) => `${kind}:${crypto.randomUUID()}`,
          allowedFailureCodes: bootstrapDeadlockAllowedFailureCodes,
        })
      : null);
  const causalContinuityStore = options.causalContinuityStore
    || (nyraPolicyRegistryPostgresPool
      ? createPostgresCausalContinuityStore({ pool: nyraPolicyRegistryPostgresPool })
      : null);
  let causalContinuityState = causalContinuityStore ? "initializing" : "disabled";
  let causalContinuityInitializationError = null;
  let causalContinuityInitializationStartedAtMs = null;
  const causalContinuityInitializationLivenessMs =
    boundedCausalInitializationLivenessMs(
      options.causalContinuityInitializationLivenessMs,
  );
  let causalContextSigner = options.causalContextSigner || null;
  if (!causalContextSigner && hostNativeSigningSecret.length >= 32) {
    try {
      causalContextSigner = createHostNativeDomainSigner({ signingSecret: hostNativeSigningSecret });
    } catch {
      causalContinuityState = "signer_unavailable";
    }
  }
  const causalActionLeaseVerifier = options.causalActionLeaseVerifier
    || (nyraPolicyRegistryPostgresPool
      ? createPostgresCausalActionLeaseVerifier(nyraPolicyRegistryPostgresPool)
      : null);
  const causalContinuityRuntime = options.causalContinuityRuntime
    || (causalContinuityStore && causalContextSigner
      ? createCausalContinuityRuntime({
        store: causalContinuityStore,
        contextSigner: causalContextSigner,
        verifyActionLease: causalActionLeaseVerifier,
      })
      : null);
  if (causalContinuityRuntime) {
    causalContinuityInitializationStartedAtMs = performance.now();
    void Promise.resolve(causalContinuityRuntime.initialize())
      .then(() => { causalContinuityState = "ready"; })
      .catch((error) => {
        causalContinuityState = "initialization_failed";
        causalContinuityInitializationError = String(error?.code || error?.message || "causal_initialization_failed").slice(0, 160);
        audit.append("core_causal_continuity_unavailable", { reason: causalContinuityInitializationError });
      });
  } else if (causalContinuityStore && causalContinuityState === "initializing") {
    causalContinuityState = "signer_unavailable";
  }
  const causalRouteRuntime = causalContinuityRuntime ? {
    invoke(capability, identity, input) {
      if (causalContinuityState !== "ready") throw new CausalContinuityError("CAUSAL_RUNTIME_NOT_READY");
      return causalContinuityRuntime.invoke(capability, identity, input);
    },
  } : null;
  const causalBranchEnforcer = causalContinuityRuntime && causalContinuityStore && dttAgentIdentityReceiptService?.configured
    ? createCausalBranchEnforcer({
        store: causalContinuityStore,
        runtime: causalContinuityRuntime,
        resolveAgentContext: (token, tenantId) => dttAgentIdentityReceiptService.verifyContext(token, tenantId),
      })
    : null;
  const tenantProviderSetupLinks = null;
  const tenantOpenAiMultiAgentRunner = null;

  function recoverGenericOrchestration(tenantId, planId) {
    try {
      return genericAgentOrchestrator.getPlan({ tenant_id: tenantId, plan_id: planId });
    } catch (error) {
      if (error.message !== "plan_not_found") throw error;
      const record = genericAgentOrchestrationStore.load({ tenant_id: tenantId, plan_id: planId });
      if (!record?.plan_snapshot) throw error;
      return genericAgentOrchestrator.restorePlan({ tenant_id: tenantId, plan_snapshot: record.plan_snapshot });
    }
  }

  function persistGenericOrchestration(plan) {
    return genericAgentOrchestrationStore.save({ tenant_id: plan.tenant_id, plan_snapshot: plan });
  }

  function boundedProviderExecutionBody(req, purpose) {
    const raw = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    if (raw.tenant_id !== undefined && String(raw.tenant_id) !== req.tenantId) throw new Error("tenant_scope_denied");
    if (purpose === "tenant_openai_multiagent_run") {
      const task = String(raw.task || "").trim();
      const confirmationReference = String(raw.confirmation_reference || "").trim().slice(0, 240);
      return {
        tenant_id: req.tenantId,
        task,
        owner_confirmed: raw.owner_confirmed === true,
        ...(confirmationReference ? { confirmation_reference: confirmationReference } : {}),
      };
    }
    return {
      tenant_id: req.tenantId,
      run_id: String(raw.run_id || "").trim(),
    };
  }

  function requireBoundedProviderExecutionOwner(req, purpose) {
    if (!tenantOpenAiMultiAgentRunner) throw new Error("tenant_openai_execution_not_configured");
    const body = boundedProviderExecutionBody(req, purpose);
    if (purpose === "tenant_openai_multiagent_run" && body.owner_confirmed !== true) throw new Error("owner_confirmation_required");
    const ownerContext = req.body?.owner_context;
    const binding = ownerRequestBinding(purpose, body);
    if (
      !verifyOwnerContextAssertion(ownerContext, ownerContextSigningSecret, req.tenantId, binding) ||
      !hasProviderSetupOwnerContext(ownerContext)
    ) {
      throw new Error("owner_context_required");
    }
    return body;
  }

  async function consumeBoundedProviderExecutionOwner(req) {
    const body = requireBoundedProviderExecutionOwner(req, "tenant_openai_multiagent_run");
    if (!tenantProviderCredentials || typeof tenantProviderCredentials.status !== "function") throw new Error("tenant_openai_execution_not_configured");
    let provider;
    try { provider = await tenantProviderCredentials.status({ tenant_id: req.tenantId }); }
    catch { throw new Error("tenant_provider_credential_unavailable"); }
    if (provider?.configured !== true) throw new Error("tenant_openai_provider_not_configured");
    const ownerContext = req.body?.owner_context;
    const issuedAt = Date.parse(String(ownerContext?.issued_at || ""));
    const approvalHash = `sha256:${crypto.createHash("sha256")
      .update(`tenant-openai-execution-approval\u0000${String(ownerContext?.assertion || "")}`)
      .digest("hex")}`;
    let consumed;
    try {
      consumed = await ownerExecutionApprovals.consume({
        tenant_id: req.tenantId,
        approval_hash: approvalHash,
        expires_at: new Date(issuedAt + 120_000).toISOString(),
      });
    } catch (error) {
      if (error?.message === "approval_expired") throw new Error("owner_context_required");
      throw new Error("owner_confirmation_consume_unavailable");
    }
    if (consumed?.consumed !== true) throw new Error("owner_confirmation_replayed");
    return body;
  }

  function issueNyraDeepV2PolicySnapshotBundle({
    keyRecord,
    tenantId,
    requestId,
    branchId,
    subbranchId,
    workPreflight,
    nyraNetwork,
    bridgeResult,
    operationalContext,
  } = {}) {
    if (
      !nyraDeepV2Attester
      || typeof nyraDeepV2Attester.operationalPolicySnapshotRequirements !== "function"
    ) {
      return {
        ok: false,
        reason: "nyra_deep_branch_v2_policy_receipt_issuer_unavailable",
      };
    }
    if (
      !nyraDeepV2Ledger
      || typeof nyraDeepV2Ledger.issueCorePolicyDecisionReceipt !== "function"
    ) {
      return {
        ok: false,
        reason: "nyra_deep_branch_v2_policy_receipt_ledger_unavailable",
      };
    }
    const discovery = nyraDeepV2Attester
      .operationalPolicySnapshotRequirements({ branchId, subbranchId });
    if (
      !discovery?.ok
      || !Array.isArray(discovery.requirements)
      || discovery.requirements.length < 1
    ) {
      return {
        ok: false,
        reason: discovery?.reason
          || "nyra_deep_branch_v2_policy_requirements_unavailable",
      };
    }
    const issuedMs = Math.max(
      Date.now(),
      Date.parse(String(operationalContext?.issued_at || "")) || 0,
    );
    const expiresMs = Date.parse(String(operationalContext?.expires_at || ""));
    if (
      !Number.isFinite(expiresMs)
      || !Number.isFinite(issuedMs)
      || expiresMs <= issuedMs
    ) {
      return {
        ok: false,
        reason: "nyra_deep_branch_v2_policy_receipt_window_invalid",
      };
    }
    const branchRoute = (nyraNetwork?.opened_branches || [])
      .find((item) => item?.id === branchId) || null;
    const coreBranchBindings = Array.isArray(branchRoute?.core_branch_bindings)
      ? branchRoute.core_branch_bindings
        .filter((value) => /^[a-z][a-z0-9_]{1,63}$/.test(String(value || "")))
      : [];
    const branchResolution = resolveBranchesForKey(keyRecord);
    const entitlement = buildEntitlement(keyRecord, branchResolution);
    const tenantPolicy = getTenantPolicy(tenantId, keyRecord?.metadata?.tier, {
      brandScope: keyRecord?.brand_scope,
      metadata: keyRecord?.metadata,
    });
    const preflightReady = workPreflight?.mandatory === true
      && workPreflight?.tenant_id === tenantId
      && workPreflight?.state === "ready_read_only"
      && workPreflight?.governance?.execution_allowed_by_preflight === true
      && workPreflight?.memory_first?.status === "recalled";
    const tenantIsolated = keyRecord?.tenant_id === tenantId;
    const bridgeBlocked = Array.isArray(
      bridgeResult?.selected_by_core?.blocked_reasons,
    ) && bridgeResult.selected_by_core.blocked_reasons.length > 0;
    const controlLevel = String(
      bridgeResult?.selected_by_core?.control_level || "",
    );
    const riskHint = bridgeResult?.selected_by_core?.risk_band === "high"
      ? 80
      : bridgeResult?.selected_by_core?.risk_band === "medium"
        ? 45
        : 20;
    const issuedAt = new Date(issuedMs).toISOString();
    const expiresAt = new Date(expiresMs).toISOString();
    const policySnapshots = [];
    for (const requirement of discovery.requirements) {
      const mediation = evaluatePolicyEngine({
        tenantPolicy,
        entitlement,
        action: {
          action_type: `nyra_deep_v2_${requirement.policy_id}_advisory`,
          risk_hint: riskHint,
          required_branches: coreBranchBindings,
          audit_ready: true,
          cross_tenant: false,
          contains_pii: false,
        },
        policy: {
          mode: "hard-gating",
          required_branches: coreBranchBindings,
        },
        context: {
          audit_ready: true,
          cross_tenant: false,
          contains_pii: false,
          rollback_ready: true,
        },
      });
      const allow = preflightReady
        && tenantIsolated
        && branchRoute !== null
        && bridgeResult?.ok === true
        && !bridgeBlocked
        && ["observe", "suggest"].includes(controlLevel)
        && mediation?.action_mediation?.state === "allow";
      const receipt = nyraDeepV2Ledger.issueCorePolicyDecisionReceipt({
        tenantId,
        requestId,
        branchId,
        subbranchId,
        nodeId: requirement.node_id,
        policyId: requirement.policy_id,
        effect: requirement.effect,
        decision: allow ? "ALLOW" : "DENY",
        preflightId: workPreflight?.preflight_id || "",
        corePolicyHash:
          operationalContext?.policy_hash
          || operationalContext?.policyHash
          || "",
        issuedAt,
        expiresAt,
        observedAt: issuedMs,
      });
      if (!receipt?.ok) {
        return {
          ok: false,
          reason: "nyra_deep_branch_v2_policy_receipt_persistence_failed",
        };
      }
      policySnapshots.push({
        schema_version: NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_SCHEMA_VERSION,
        issuer: NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_ISSUER,
        decision_id: receipt.decision_id,
        decision_receipt: receipt.decision_receipt,
        decision: allow ? "ALLOW" : "DENY",
        tenant_id: tenantId,
        request_id: requestId,
        branch_id: branchId,
        subbranch_id: subbranchId,
        node_id: requirement.node_id,
        policy_id: requirement.policy_id,
        effect: requirement.effect,
        preflight_id: workPreflight?.preflight_id || "",
        core_policy_hash:
          operationalContext?.policy_hash
          || operationalContext?.policyHash
          || "",
        issued_at: issuedAt,
        expires_at: expiresAt,
      });
    }
    return {
      ok: true,
      corePolicyContext: {
        schema_version:
          NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_BUNDLE_SCHEMA_VERSION,
        policy_snapshots: policySnapshots,
      },
      summary: {
        required_policy_receipt_count: discovery.requirements.length,
        allow_count: policySnapshots
          .filter((item) => item.decision === "ALLOW").length,
        deny_count: policySnapshots
          .filter((item) => item.decision === "DENY").length,
      },
    };
  }

  const requestedCoreRuntimeMode = String(options.coreRuntimeMode || process.env.CORE_RUNTIME_V2_MODE || "shadow").toLowerCase();
  const coreRuntimeMode = ["shadow", "active", "disabled"].includes(requestedCoreRuntimeMode) ? requestedCoreRuntimeMode : "shadow";
  const app = express();
  const coreAuth = (requiredScope, authOptions = {}) => createAuth(
    keyStore,
    audit,
    requiredScope,
    { ...authOptions, tenantContextSigningSecret },
  );

  app.disable("x-powered-by");
  app.use(express.json({ limit: process.env.CORE_SERVICE_JSON_LIMIT || "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "8kb" }));
  if (causalRouteRuntime) {
    registerCausalContinuityRoutes({
      app,
      authFor: (requiredScope) => {
        const authenticate = coreAuth(
          requiredScope === "causal:read" ? SCOPES.READ_DECISION : SCOPES.WRITE_DECISION,
        );
        return (req, res, next) => authenticate(req, res, (error) => {
          if (error) return next(error);
          // The platform key is authenticated above. Expose only a derived,
          // causal-domain authority view to the route adapter; never accept
          // causal authority fields from the request or DTT caller payload.
          req.coreKey = {
            ...req.coreKey,
            scopes: causalRouteAuthenticatedScopes(requiredScope, req.coreKey),
          };
          return next();
        });
      },
      runtime: causalRouteRuntime,
      resolveAgentContext: (token, tenantId) => {
        if (!dttAgentIdentityReceiptService?.configured) throw new Error("dtt_agent_identity_not_ready");
        return dttAgentIdentityReceiptService.verifyContext(token, tenantId);
      },
      audit: (event) => audit.append("core_causal_continuity_invoked", event),
    });
  }

  const injectedDttWorkBindingResolver = process.env.NODE_ENV !== "production"
    && options.allowTestDttWorkBindingResolver === true
    && typeof options.resolveDttWorkBinding === "function"
    ? options.resolveDttWorkBinding
    : null;
  const dttStatusForError = (code, fallback = 400) => {
    if (["task_tree_not_found", "dtt_node_not_found", "dtt_verifier_assignment_node_invalid"].includes(code)) return 404;
    if (["cross_tenant_task_tree_denied", "cross_work_task_tree_denied"].includes(code)) return 403;
    if ([
      "dtt_work_binding_required",
      "node_terminal",
      "outcome_idempotency_key_conflict",
      "dynamic_task_tree_revision_conflict",
      "dtt_agent_context_replayed",
      "task_tree_not_verified",
      "task_tree_already_joined",
      "dtt_join_verdict_already_issued",
    ].includes(code)) return 409;
    if ([
      "dynamic_task_tree_state_corrupt",
      "dtt_join_verdict_ledger_integrity_failed",
      "dtt_verification_trust_store_corrupt",
      "dtt_agent_identity_store_corrupt",
      "joined_tree_verdict_missing",
      "joined_tree_verdict_voided",
    ].includes(code)) return 500;
    if ([
      "dtt_work_binding_unavailable",
      "dtt_work_context_signing_unavailable",
      "dtt_join_finalization_pending",
    ].includes(code)) return 503;
    return fallback;
  };
  const dttWorkAuth = async (req, res, next) => {
    try {
      let binding;
      const requestContext = {
        tenant_id: req.tenantId,
        method: req.method,
        path: req.path,
        body: req.body,
      };
      if (injectedDttWorkBindingResolver) {
        binding = await injectedDttWorkBindingResolver({ ...requestContext, request: req });
      } else {
        if (!isMcpTenantGatewayRecord(req.coreKey)) throw new Error("dtt_work_gateway_required");
        if (!dttAgentIdentitySecret) throw new Error("dtt_work_binding_unavailable");
        binding = verifyDttWorkContext({
          token: req.get(DTT_WORK_CONTEXT_HEADER),
          secret: dttAgentIdentitySecret,
          expected_tenant_id: req.tenantId,
          method: req.method,
          path: req.path,
          body: req.body,
        });
      }
      const workId = String(binding?.work_id || "").trim();
      if (
        binding?.schema_version !== "dtt_work_context_v1"
        || binding?.tenant_id !== req.tenantId
        || binding?.execution_authorized !== false
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workId)
      ) {
        throw new Error("dtt_work_context_invalid");
      }
      const claimedWorkId = req.body?.work_id ?? req.query?.work_id;
      if (claimedWorkId !== undefined && String(claimedWorkId) !== workId) {
        throw new Error("cross_work_task_tree_denied");
      }
      req.workId = workId;
      req.dttWorkBinding = Object.freeze(structuredClone(binding));
      return next();
    } catch (error) {
      const reason = String(error?.message || "dtt_work_context_invalid");
      const code = reason === "cross_work_task_tree_denied"
        || /^dtt_work_[a-z0-9_]+$/.test(reason)
        ? reason
        : "dtt_work_context_invalid";
      audit.append("dtt_work_binding_denied", {
        tenant_id: req.tenantId,
        key_id: req.coreKey?.key_id || null,
        path: req.path,
        reason: code,
      });
      return publicError(
        res,
        dttStatusForError(code, 403),
        code,
      );
    }
  };

  const genericWorkCoreJoinContextPublicCodes = new Set([
    "core_join_mcp_gateway_required",
    "generic_work_core_join_context_required",
    "generic_work_core_join_context_invalid",
    "generic_work_core_join_context_signature_invalid",
    "generic_work_core_join_context_payload_invalid",
    "generic_work_core_join_context_principal_invalid",
    "generic_work_core_join_context_lease_invalid",
    "generic_work_core_join_context_request_invalid",
    "generic_work_core_join_context_tenant_mismatch",
    "generic_work_core_join_context_work_mismatch",
    "generic_work_core_join_context_request_mismatch",
    "generic_work_core_join_context_not_active",
    "generic_work_core_join_context_expired",
    "generic_work_core_join_context_expiry_invalid",
    "generic_work_core_join_context_nonce_invalid",
    "generic_work_core_join_context_signing_unavailable",
    "generic_work_core_join_cross_work_denied",
    "generic_work_core_join_disabled",
    "generic_work_core_join_distributed_store_unavailable",
    "generic_work_core_join_verifier_binding_mismatch",
    "generic_work_core_join_verifier_unavailable",
  ]);
  const genericWorkCoreJoinContextAuth = (req, res, next) => {
    try {
      if (!isMcpTenantGatewayRecord(req.coreKey)) {
        throw new Error("core_join_mcp_gateway_required");
      }
      if (genericWorkCoreJoinConfigurationError) {
        throw new Error(genericWorkCoreJoinConfigurationError);
      }
      if (!genericWorkCoreJoinEnabled) {
        throw new Error("generic_work_core_join_disabled");
      }
      if (!genericWorkCoreJoinAuthority) {
        throw new Error(genericWorkCoreJoinUnavailableCode());
      }
      if (!dttAgentIdentitySecret) {
        throw new Error("generic_work_core_join_context_signing_unavailable");
      }
      const token = req.get(GENERIC_WORK_CORE_JOIN_CONTEXT_HEADER);
      if (!token) throw new Error("generic_work_core_join_context_required");
      const binding = verifyGenericWorkCoreJoinContext({
        token,
        secret: dttAgentIdentitySecret,
        expected_tenant_id: req.tenantId,
        method: req.method,
        path: req.path,
        body: req.body,
      });
      const workId = String(binding?.work_id || "").trim().toLowerCase();
      if (
        binding?.schema_version !== GENERIC_WORK_CORE_JOIN_CONTEXT_VERSION
        || binding?.purpose !== GENERIC_WORK_CORE_JOIN_CONTEXT_PURPOSE
        || binding?.tenant_id !== req.tenantId
        || binding?.execution_authorized !== false
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(workId)
      ) {
        throw new Error("generic_work_core_join_context_invalid");
      }
      const claimedWorkId = req.body?.work_id;
      if (claimedWorkId !== undefined && String(claimedWorkId).trim().toLowerCase() !== workId) {
        throw new Error("generic_work_core_join_cross_work_denied");
      }
      const signerMetadata = genericWorkCoreJoinAuthority.signer_metadata;
      if (!signerMetadata
          || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(String(signerMetadata.key_id || ""))
          || !/^[a-f0-9]{64}$/.test(String(signerMetadata.public_key_fingerprint || ""))) {
        throw new Error("generic_work_core_join_verifier_unavailable");
      }
      if (binding.verifier?.key_id !== signerMetadata.key_id
          || binding.verifier?.public_key_fingerprint !== signerMetadata.public_key_fingerprint) {
        throw new Error("generic_work_core_join_verifier_binding_mismatch");
      }
      req.genericWorkCoreJoinWorkId = workId;
      req.genericWorkCoreJoinBinding = binding;
      return next();
    } catch (error) {
      const reason = String(error?.code || error?.message || "");
      const code = genericWorkCoreJoinContextPublicCodes.has(reason)
        || genericWorkCoreJoinInfrastructureCode(reason)
        ? reason
        : "generic_work_core_join_context_invalid";
      audit.append("core_generic_work_core_join_context_denied", {
        tenant_id: req.tenantId,
        key_id: req.coreKey?.key_id || null,
        path: req.path,
        reason: code,
      });
      return publicError(
        res,
        genericWorkCoreJoinInfrastructureCode(code)
          || [
            "generic_work_core_join_context_signing_unavailable",
            "generic_work_core_join_verifier_unavailable",
          ].includes(code) ? 503 : 403,
        code,
      );
    }
  };

  const assertDttTreeNode = async ({ tenant_id, work_id, tree_id, node_id }) => {
    const tree = await dynamicTaskTreeRuntime.get({ tenant_id, work_id, tree_id });
    if (!tree.nodes.some((item) => item.node_id === node_id)) {
      throw new Error("dtt_node_not_found");
    }
    return tree;
  };

  mountDttAgentIdentityReceiptRoutes({
    app,
    auth: coreAuth(SCOPES.WRITE_DECISION),
    workAuth: dttWorkAuth,
    assertTreeNode: assertDttTreeNode,
    receiptService: dttAgentIdentityReceiptService,
    audit,
  });
  app.post("/v1/orchestration/dtt/:treeId/nodes/:nodeId/verifier-assignments", coreAuth(SCOPES.WRITE_DECISION), dttWorkAuth, async (req, res) => {
    if (!dttAgentIdentityReceiptService?.configured) {
      return res.status(503).json({ ok: false, error: "dtt_agent_identity_not_ready" });
    }
    try {
      const context = dttAgentIdentityReceiptService.verifyContext(
        req.get("x-sh-dtt-agent-context"),
        req.tenantId,
        req.workId,
        req.dttWorkBinding.principal,
      );
      const tree = await dynamicTaskTreeRuntime.get({ tenant_id: req.tenantId, work_id: req.workId, tree_id: req.params.treeId });
      const node = tree.nodes.find((item) => item.node_id === req.params.nodeId);
      if (!node) throw new Error("dtt_verifier_assignment_node_invalid");
      if (node.kind === "verification" && !node.verification_policy?.allowed_verifier_ids?.includes(context.agent_id)) {
        throw new Error("dtt_verifier_not_allowlisted");
      }
      const occupied = await dttVerificationTrustStore.listAssignments({
        tenant_id: req.tenantId, work_id: req.workId, tree_id: req.params.treeId, node_id: req.params.nodeId,
      });
      if (occupied.some((item) => item.actor_provenance === context.actor_provenance
        && (item.verifier_id !== context.agent_id
          || item.session_fingerprint !== context.session_fingerprint
          || item.opaque_agent_id !== context.opaque_agent_id))) {
        throw new Error("dtt_verifier_actor_already_assigned");
      }
      if (occupied.some((item) => item.verifier_id === context.agent_id
        && item.session_fingerprint !== context.session_fingerprint)) {
        throw new Error("dtt_verifier_slot_already_assigned");
      }
      if (node.kind !== "verification" && occupied.length > 0
        && !occupied.some((item) => item.verifier_id === context.agent_id
          && item.session_fingerprint === context.session_fingerprint)) {
        throw new Error("dtt_nonverification_slot_already_assigned");
      }
      const assignment = await dttVerificationTrustStore.assignVerifier({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
        node_id: req.params.nodeId,
        verifier_id: context.agent_id,
        session_id: context.session_id,
        session_fingerprint: context.session_fingerprint,
        host_transport_session_fingerprint: context.host_transport_session_fingerprint,
        presence_signature: context.presence_signature,
        client_type: context.client_type,
        opaque_agent_id: context.opaque_agent_id,
        actor_provenance: context.actor_provenance,
      });
      return res.json({
        ok: true,
        work_id: req.workId,
        assignment_id: assignment.assignment_id,
        verifier_id: assignment.verifier_id,
        execution_authorized: false,
      });
    } catch (error) {
      const code = error.message || "dtt_verifier_assignment_denied";
      return publicError(res, dttStatusForError(code, 403), code);
    }
  });
  app.post("/v1/orchestration/evidence/artifacts", coreAuth(SCOPES.WRITE_DECISION), dttWorkAuth, async (req, res) => {
    try {
      const artifact = await dttVerificationTrustStore.registerArtifact({
        tenant_id: req.tenantId,
        work_id: req.workId,
        artifact_id: req.body?.artifact_id,
        content: req.body?.content,
        source_reference: req.body?.source_reference,
        registry_reference: req.body?.registry_reference,
      });
      audit.append("dtt_evidence_artifact_registered", {
        tenant_id: req.tenantId,
        work_id: req.workId,
        artifact_id: artifact.artifact_id,
        content_digest: artifact.content_digest,
        registry_id: artifact.registry_id,
      });
      return res.json({
        ...artifact,
        ok: true,
        tenant_id: req.tenantId,
        work_id: req.workId,
        execution_authorized: false,
      });
    } catch (error) {
      const code = error.message || "dtt_evidence_artifact_invalid";
      return publicError(res, dttStatusForError(code), code);
    }
  });
  mountAdminControlRoom({
    app,
    storageRoot,
    audit,
    keyStore,
    tenants,
    nyraCatalog: nyraBranchCatalog,
    agentRegistry: multiAgentRegistry,
    uiRoot: path.join(__dirname, "../admin-ui"),
  });
  // This must remain before every legacy provider route below.  It is
  // deliberately unauthenticated: accepting a token, setup proof, or body
  // before returning retirement would keep a credential path alive and would
  // produce inconsistent 401/403 responses instead of the stable 410.
  app.use("/v1/generic-agents/providers/openai", (req, res) => {
    audit.append("native_agent_provider_route_retired", {
      method: req.method,
      route: "generic_agents_provider",
    });
    return publicError(
      res,
      410,
      NATIVE_AGENT_PROVIDER_RETIREMENT_CODE,
      NATIVE_AGENT_PROVIDER_RETIREMENT_MESSAGE,
    );
  });
  app.get("/v1/generic-agents/providers/openai/setup/:token", (req, res) => {
    const token = validProviderSetupToken(req.params.token);
    if (!token) return providerSetupHtml(res, 404, "Link non valido.");
    const scriptNonce = crypto.randomBytes(18).toString("base64");
    return providerSetupHtml(res, 200, providerSetupFormHtml(scriptNonce), { scriptNonce });
  });
  app.post("/v1/generic-agents/providers/openai/setup/:token", async (req, res) => {
    if (!tenantProviderSetupLinks || !tenantProviderCredentials) return providerSetupHtml(res, 503, "Configurazione provider non disponibile.");
    // A setup proof is an irreversible credential-entry capability. Do not use
    // the legacy claim → save → finalize sequence here: the link store locks
    // and consumes the active row only inside the very same transaction that
    // receives the encrypted credential upsert.
    if (
      typeof tenantProviderSetupLinks.consumeAndPersist !== "function" ||
      typeof tenantProviderCredentials.ensureInitialized !== "function" ||
      typeof tenantProviderCredentials.saveOpenAiInTransaction !== "function"
    ) {
      return providerSetupHtml(res, 503, "Configurazione provider non disponibile.");
    }
    let completed;
    try {
      completed = await tenantProviderSetupLinks.consumeAndPersist({
        token: req.params.token,
        proof: req.body?.setup_proof,
        prepare: () => tenantProviderCredentials.ensureInitialized(),
        persist: ({ tenant_id, client }) => tenantProviderCredentials.saveOpenAiInTransaction({
          tenant_id,
          api_key: req.body?.api_key,
          client,
        }),
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "openai_api_key_invalid" || code === "openai_api_key_format_invalid") {
        // Validation happens inside the transaction, so the rollback leaves
        // this short-lived proof active. Re-render only a validated capability,
        // never the submitted key, so the owner can safely correct a typo.
        const token = validProviderSetupToken(req.params.token);
        const setupProof = validProviderSetupProof(req.body?.setup_proof);
        if (!token || !setupProof) {
          return providerSetupHtml(res, 410, "Link scaduto, già usato o non valido. Torna a ChatGPT e apri un nuovo collegamento.");
        }
        const scriptNonce = crypto.randomBytes(18).toString("base64");
        return providerSetupHtml(
          res,
          400,
          providerSetupFormHtml(scriptNonce, {
            setupProof,
            errorMessage: "Chiave non valida. Correggila e riprova.",
          }),
          { scriptNonce },
        );
      }
      if (code === "setup_token_invalid" || code === "setup_proof_invalid") {
        return providerSetupHtml(res, 410, "Link scaduto, già usato o non valido. Torna a ChatGPT e apri un nuovo collegamento.");
      }
      return providerSetupHtml(res, 503, "Il collegamento non è stato completato. Torna a ChatGPT e verifica lo stato prima di riprovare.");
    }
    if (!completed) return providerSetupHtml(res, 410, "Link scaduto, già usato o non valido. Torna a ChatGPT e apri un nuovo collegamento.");
    audit.append("tenant_openai_provider_setup_completed", {
      tenant_id: completed.tenant_id,
      provider: "openai",
      link_id: completed.link_id,
      owner_subject_fingerprint: completed.owner_subject_fingerprint,
    });
    return providerSetupHtml(res, 200, `<h1>OpenAI collegato</h1><p>La chiave è stata salvata nel vault cifrato del tuo account.</p><p><a href="${TRUSTED_AGENT_PORTAL_URL}" style="display:inline-block;background:#111;color:#fff;padding:14px 18px;border-radius:10px;text-decoration:none;font-weight:700">Torna a Nyra e avvia il test</a></p>`);
  });

  app.get("/v1/generic-agents/registry", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const agents = governedAgentRegistry.listAgents();
    audit.append("governed_agent_registry_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, agent_count: agents.length });
    return res.json({
      ok: true,
      tenant_id: req.tenantId,
      agents,
      defaults: { activation_mode: "dry_run", learning_mode: "frozen", model_budget_required: true, external_actions: "owner_confirmation_required" },
    });
  });

  app.post("/v1/generic-agents/activations", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      const existing = req.body?.idempotency_key
        ? governedAgentActivationStore.findByIdempotency({ tenant_id: req.tenantId, idempotency_key: req.body.idempotency_key })
        : null;
      if (existing) {
        const run = genericAgentRuntime.restoreRun({ tenant_id: req.tenantId, run_snapshot: existing.run_snapshot });
        return res.json({ ok: true, tenant_id: req.tenantId, activation: { ...existing.activation, reused: true }, run, workflow: existing.workflow, reused: true, restored_from_durable_activation: true, execution_allowed: false });
      }
      const activation = governedAgentRegistry.proposeActivation({ ...(req.body || {}), tenant_id: req.tenantId });
      if (activation.reused) {
        const run = genericAgentRuntime.getRun({ run_id: `run_${activation.activation_id}`, tenant_id: req.tenantId });
        return res.json({ ok: true, tenant_id: req.tenantId, activation, run, reused: true, execution_allowed: false });
      }
      const run = genericAgentRuntime.startRun({
        run_id: `run_${activation.activation_id}`,
        tenant_id: req.tenantId,
        agent_id: activation.agent_id,
        task: activation.task,
        metadata: { activation_id: activation.activation_id, trigger: activation.trigger, role: activation.role },
        learning_mode: "frozen",
        model_budget: { max_model_calls: 0, max_total_tokens: 0 },
      });
      governedAgentActivationStore.save({ tenant_id: req.tenantId, activation, run_snapshot: run });
      audit.append("governed_agent_activation_proposed", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, activation_id: activation.activation_id, run_id: run.run_id, agent_id: activation.agent_id, trigger: activation.trigger });
      return res.status(201).json({ ok: true, tenant_id: req.tenantId, activation, run, execution_allowed: false });
    } catch (error) {
      return publicError(res, 400, error.message || "governed_agent_activation_invalid");
    }
  });

  app.get("/v1/generic-agents/activations/:activationId", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    try {
      const record = governedAgentActivationStore.load({ tenant_id: req.tenantId, activation_id: req.params.activationId });
      if (!record) return publicError(res, 404, "governed_agent_activation_not_found");
      return res.json({ ok: true, tenant_id: req.tenantId, activation: record.activation, workflow: record.workflow, revision: record.revision, updated_at: record.updated_at, execution_allowed: false });
    } catch (error) {
      return publicError(res, 403, error.message || "governed_agent_activation_read_failed");
    }
  });

  app.post("/v1/generic-agents/activations/:activationId/research-workflow", coreAuth(SCOPES.WRITE_DECISION), async (req, res) => {
    try {
      const record = governedAgentActivationStore.load({ tenant_id: req.tenantId, activation_id: req.params.activationId });
      if (!record) return publicError(res, 404, "governed_agent_activation_not_found");
      if (record.activation.agent_id !== "nyra-supervisor") return publicError(res, 400, "research_workflow_requires_nyra_supervisor");
      if (record.workflow?.plan_id) {
        const plan = recoverGenericOrchestration(req.tenantId, record.workflow.plan_id);
        return res.json({ ok: true, tenant_id: req.tenantId, activation: record.activation, plan, reused: true, execution_allowed: false });
      }
      const plan = genericAgentOrchestrator.createPlan({
        tenant_id: req.tenantId,
        run_id: record.run_snapshot.run_id,
        workers: buildGovernedResearchWorkers({ task: record.activation.task }),
      });
      const budget = governedAgentBudgetStore.reserveWorkflow({ tenant_id: req.tenantId, worker_count: plan.workers.length, deadline_ms: req.body?.deadline_ms ?? 120_000 });
      persistGenericOrchestration(plan);
      const workflow = { schema_version: "governed_research_workflow_v1", plan_id: plan.plan_id, status: plan.status, execution_mode: "dry_run", model_invocation: false, tool_invocation: false, external_action: false, operational_budget: budget, telemetry: { queue_ms: 0, context_build_ms: 0, retry_events: 0, timeout_events: 0, cancellation_events: 0, zombie_branches: 0 } };
      const queueJobs = await governedAgentQueueStore.enqueue({ tenant_id: req.tenantId, activation_id: record.activation.activation_id, plan_id: plan.plan_id, workers: plan.workers, deadline_at: budget.deadline_at, max_retries: budget.limits.max_retries_per_worker });
      workflow.queue = { job_count: queueJobs.length, status: "queued" };
      const saved = governedAgentActivationStore.save({ tenant_id: req.tenantId, activation: record.activation, run_snapshot: record.run_snapshot, workflow, expected_revision: record.revision });
      audit.append("governed_agent_research_workflow_created", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, activation_id: record.activation.activation_id, plan_id: plan.plan_id, worker_count: plan.workers.length });
      return res.status(201).json({ ok: true, tenant_id: req.tenantId, activation: saved.activation, workflow: saved.workflow, plan, execution_allowed: false });
    } catch (error) {
      return publicError(res, error.message === "activation_revision_conflict" ? 409 : 400, error.message || "governed_agent_research_workflow_failed");
    }
  });

  app.post("/v1/generic-agents/activations/:activationId/research-evidence", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      const record = governedAgentActivationStore.load({ tenant_id: req.tenantId, activation_id: req.params.activationId });
      if (!record) return publicError(res, 404, "governed_agent_activation_not_found");
      if (!record.workflow?.plan_id) return publicError(res, 400, "research_workflow_required");
      const plan = buildResearchPlan({ question: record.activation.task, allowed_domains: req.body?.allowed_domains });
      const validation = validateResearchEvidence({ question: record.activation.task, plan, sources: req.body?.sources, claims: req.body?.claims });
      const priorTelemetry = record.workflow.telemetry || { evidence_validation_attempts: 0, quarantined_count: 0 };
      const workflow = {
        ...record.workflow,
        evidence: {
          validation_id: validation.validation_id,
          state: validation.state,
          quality_score: validation.quality_score,
          source_count: validation.source_count,
          independent_host_count: validation.independent_host_count,
          contradictions: validation.contradictions,
          release_readiness: validation.release_readiness,
          threat_assessment: validation.threat_assessment,
        },
        telemetry: {
          ...priorTelemetry,
          evidence_validation_attempts: Number(priorTelemetry.evidence_validation_attempts || 0) + 1,
          quarantined_count: Number(priorTelemetry.quarantined_count || 0) + (validation.state === "quarantined" ? 1 : 0),
          last_evidence_validation_at: validation.validated_at,
        },
      };
      const saved = governedAgentActivationStore.save({ tenant_id: req.tenantId, activation: record.activation, run_snapshot: record.run_snapshot, workflow, expected_revision: record.revision });
      audit.append("governed_agent_research_evidence_validated", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        activation_id: record.activation.activation_id,
        validation_id: validation.validation_id,
        state: validation.state,
        quality_score: validation.quality_score,
        source_count: validation.source_count,
        prompt_injection_count: validation.threat_assessment.prompt_injection_count,
        contradiction_count: validation.contradictions.length,
      });
      return res.status(201).json({ ok: true, tenant_id: req.tenantId, plan, validation, workflow: saved.workflow, execution_allowed: false });
    } catch (error) {
      return publicError(res, error.message === "activation_revision_conflict" ? 409 : 400, error.message || "governed_agent_research_evidence_failed");
    }
  });

  app.get("/v1/generic-agents/operational-budget", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const budget = governedAgentBudgetStore.get({ tenant_id: req.tenantId });
    return res.json({ ok: true, tenant_id: req.tenantId, budget, execution_allowed: false });
  });

  app.get("/v1/generic-agents/queue/metrics", coreAuth(SCOPES.READ_DECISION), async (req, res) => {
    res.json(await governedAgentQueueStore.metrics({ tenant_id: req.tenantId }));
  });
  app.post("/v1/generic-agents/queue/tick", coreAuth(SCOPES.WRITE_DECISION), async (req, res) => {
    const outcome = await governedAgentDryRunRunner.tick({ tenant_id: req.tenantId });
    audit.append("governed_agent_queue_dry_run_tick", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, completed: outcome.completed.length, expired: outcome.expired });
    return res.json({ ok: true, tenant_id: req.tenantId, ...outcome });
  });
  app.post("/v1/generic-agents/queue/claim", coreAuth(SCOPES.WRITE_DECISION), async (req, res) => {
    const job = await governedAgentQueueStore.claim({ tenant_id: req.tenantId });
    if (!job) return res.status(204).end();
    return res.json(job);
  });
  app.post("/v1/generic-agents/queue/:jobId/complete", coreAuth(SCOPES.WRITE_DECISION), async (req, res) => {
    const job = await governedAgentQueueStore.complete({ tenant_id: req.tenantId, job_id: req.params.jobId, result: req.body?.result || null });
    if (!job) return publicError(res, 404, "queue_job_not_found");
    return res.json(job);
  });
  app.post("/v1/generic-agents/queue/:jobId/fail", coreAuth(SCOPES.WRITE_DECISION), async (req, res) => {
    const job = await governedAgentQueueStore.fail({ tenant_id: req.tenantId, job_id: req.params.jobId, error: req.body?.error || "worker_failed" });
    if (!job) return publicError(res, 404, "queue_job_not_found");
    return res.json(job);
  });
  app.post("/v1/generic-agents/queue/activations/:activationId/cancel", coreAuth(SCOPES.WRITE_DECISION), async (req, res) => {
    return res.json(await governedAgentQueueStore.cancelActivation({ tenant_id: req.tenantId, activation_id: req.params.activationId }));
  });
  app.post("/v1/generic-agents/providers/openai/setup-links", coreAuth(SCOPES.WRITE_PROVIDER_SETUP_LINK, { allowProviderSetupService: true }), async (req, res) => {
    if (!tenantProviderSetupLinks) return publicError(res, 503, "tenant_provider_setup_not_configured");
    // `admin:tenant` is intentionally not a wildcard here. This endpoint
    // mints a credential-entry capability, so it accepts only the exact
    // bootstrap key created from the approved MCP→Core binding.
    if (!isProviderSetupLinkIssuer(req.coreKey, req.tenantId)) {
      audit.append("tenant_openai_provider_setup_link_issuer_blocked", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
      });
      return publicError(res, 403, "provider_setup_link_issuer_required");
    }
    const ownerContext = req.body?.owner_context;
    if (!verifyOwnerContextAssertion(ownerContext, ownerContextSigningSecret, req.tenantId) || !hasProviderSetupOwnerContext(ownerContext)) {
      audit.append("tenant_openai_provider_setup_link_owner_context_blocked", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
      });
      return publicError(res, 403, "owner_context_required");
    }
    let link;
    try {
      link = await tenantProviderSetupLinks.issue({
        tenant_id: req.tenantId,
        owner_subject_fingerprint: ownerContext.owner_subject_fingerprint,
        ttl_minutes: req.body?.ttl_minutes,
      });
    } catch {
      // Keep database/provider-link implementation details out of this
      // credential-capability endpoint. The portal can safely ask the owner
      // to retry without exposing a token, proof, database error or secret.
      audit.append("tenant_openai_provider_setup_link_issue_failed", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
      });
      return publicError(res, 503, "tenant_provider_setup_link_unavailable");
    }
    audit.append("tenant_openai_provider_setup_link_issued", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      link_id: link.link_id,
      owner_subject_fingerprint: ownerContext.owner_subject_fingerprint,
      expires_at: link.expires_at,
    });
    return res.status(201).json({
      ok: true,
      tenant_id: req.tenantId,
      setup_url: null,
      // This is delivered only to the server-side owner portal, which moves it
      // into the URL fragment. It is never included in an MCP tool response.
      setup_proof: link.proof,
      link_id: link.link_id,
      expires_at: link.expires_at,
      execution_enabled: false,
    });
  });
  app.get("/v1/generic-agents/providers/openai", coreAuth(SCOPES.READ_DECISION), async (req, res) => {
    if (!tenantProviderCredentials) return publicError(res, 503, "tenant_provider_vault_not_configured");
    const provider = await tenantProviderCredentials.status({ tenant_id: req.tenantId });
    return res.json({
      ok: true,
      tenant_id: req.tenantId,
      provider: {
        ...provider,
        // A configured key is still never a global execution switch. The
        // capability below means an OAuth owner can start the fixed workflow
        // after a fresh request-bound confirmation; every run is separate.
        execution_enabled: provider.execution_enabled === true,
        execution_available: provider.configured === true && Boolean(tenantOpenAiMultiAgentRunner),
        execution_mode: provider.configured === true && tenantOpenAiMultiAgentRunner
          ? "bounded_owner_confirmed_multiagent"
          : "disabled",
      },
    });
  });
  // Provider credentials are intentionally accepted only by a consumed, short-lived
  // setup link. A normal Core key must never become a second, bypassable secret
  // input channel, even when it has a broad write scope.
  app.put("/v1/generic-agents/providers/openai", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    audit.append("tenant_openai_provider_direct_write_blocked", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    return publicError(res, 410, "provider_setup_link_required", "Use a one-time owner setup link.");
  });
  app.delete("/v1/generic-agents/providers/openai", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    audit.append("tenant_openai_provider_direct_delete_blocked", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    return publicError(res, 410, "provider_setup_link_required", "Provider changes require the owner setup flow.");
  });

  // The only live provider path. Its graph, model, token cap, concurrency and
  // tool policy are all fixed in the runner; callers can supply only a bounded
  // task plus a fresh, request-bound OAuth owner confirmation.
  app.post("/v1/generic-agents/providers/openai/multi-agent-runs", coreAuth(SCOPES.WRITE_DECISION), async (req, res) => {
    try {
      const body = await consumeBoundedProviderExecutionOwner(req);
      const run = tenantOpenAiMultiAgentRunner.start({ tenant_id: req.tenantId, task: body.task });
      const response = { ok: true, tenant_id: req.tenantId, run, governance: {
        scope: "bounded_tenant_provider_execution",
        owner_confirmation_required: true,
        owner_confirmation_satisfied: true,
        external_tools: false,
        fixed_workflow: "research_review_synthesis_v1",
      } };
      // The caller receives a run id before the first provider request can
      // complete, so it can poll or propagate cancellation immediately.
      return res.status(202).json(response);
    } catch (error) {
      const code = error.message || "tenant_openai_multi_agent_run_failed";
      const status = ["owner_context_required", "owner_confirmation_required", "tenant_scope_denied"].includes(code)
        ? 403
        : ["tenant_openai_provider_not_configured", "tenant_provider_credential_unavailable", "tenant_openai_execution_not_configured", "owner_confirmation_replayed", "owner_confirmation_consume_unavailable"].includes(code)
          ? 409
          : ["tenant_multi_agent_run_in_progress", "multi_agent_execution_capacity_reached", "daily_workflow_budget_exceeded", "model_budget_exceeded"].includes(code)
            ? 429
            : 400;
      return publicError(res, status, code);
    }
  });

  app.get("/v1/generic-agents/providers/openai/multi-agent-runs/:runId", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    if (!tenantOpenAiMultiAgentRunner) return publicError(res, 503, "tenant_openai_execution_not_configured");
    try {
      // Status can be read by a tenant decision key; model output remains
      // owner-only and is available through the signed POST result endpoint.
      const run = tenantOpenAiMultiAgentRunner.get({ tenant_id: req.tenantId, run_id: req.params.runId, include_output: false });
      return res.json({ ok: true, tenant_id: req.tenantId, run });
    } catch (error) {
      const code = error.message || "tenant_openai_multi_agent_run_read_failed";
      return publicError(res, code === "tenant_openai_multi_agent_run_not_found" ? 404 : 403, code);
    }
  });

  app.post("/v1/generic-agents/providers/openai/multi-agent-runs/:runId/result", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      const body = requireBoundedProviderExecutionOwner(req, "tenant_openai_multiagent_read");
      if (body.run_id !== req.params.runId) return publicError(res, 400, "run_id_mismatch");
      const run = tenantOpenAiMultiAgentRunner.get({ tenant_id: req.tenantId, run_id: req.params.runId, include_output: true });
      return res.json({ ok: true, tenant_id: req.tenantId, run });
    } catch (error) {
      const code = error.message || "tenant_openai_multi_agent_run_result_failed";
      return publicError(res, code === "tenant_openai_multi_agent_run_not_found" ? 404 : 403, code);
    }
  });

  app.post("/v1/generic-agents/providers/openai/multi-agent-runs/:runId/cancel", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      const body = requireBoundedProviderExecutionOwner(req, "tenant_openai_multiagent_cancel");
      if (body.run_id !== req.params.runId) return publicError(res, 400, "run_id_mismatch");
      const run = tenantOpenAiMultiAgentRunner.cancel({ tenant_id: req.tenantId, run_id: req.params.runId });
      return res.json({ ok: true, tenant_id: req.tenantId, run });
    } catch (error) {
      const code = error.message || "tenant_openai_multi_agent_run_cancel_failed";
      return publicError(res, code === "tenant_openai_multi_agent_run_not_found" ? 404 : 403, code);
    }
  });

  app.post("/v1/generic-agents/runs", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      const run = genericAgentRuntime.startRun({ ...(req.body || {}), tenant_id: req.tenantId });
      audit.append("generic_agent_run_started", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, run_id: run.run_id, agent_id: run.agent_id });
      return res.status(201).json({ ok: true, tenant_id: req.tenantId, run });
    } catch (error) {
      return publicError(res, 400, error.message || "generic_agent_run_invalid");
    }
  });

  app.post("/v1/generic-agents/runs/:runId/checkpoint", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      const run = genericAgentRuntime.checkpointRun({ run_id: req.params.runId, tenant_id: req.tenantId, checkpoint: req.body?.checkpoint });
      const record = genericAgentCheckpoints.save({
        tenant_id: req.tenantId,
        run_id: run.run_id,
        checkpoint: run.checkpoint,
        run_snapshot: run,
        expected_revision: req.body?.expected_revision ?? null,
      });
      audit.append("generic_agent_checkpoint_saved", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, run_id: run.run_id, revision: record.revision });
      return res.json({ ok: true, tenant_id: req.tenantId, run, checkpoint_record: { revision: record.revision, updated_at: record.updated_at } });
    } catch (error) {
      return publicError(res, error.message === "checkpoint_revision_conflict" ? 409 : 400, error.message || "generic_agent_checkpoint_failed");
    }
  });

  app.get("/v1/generic-agents/runs/:runId", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    try {
      let restored = false;
      let run;
      try {
        run = genericAgentRuntime.getRun({ run_id: req.params.runId, tenant_id: req.tenantId });
      } catch (error) {
        if (error.message !== "run_not_found") throw error;
        const durable = genericAgentCheckpoints.load({ tenant_id: req.tenantId, run_id: req.params.runId });
        if (!durable?.run_snapshot) throw error;
        run = genericAgentRuntime.restoreRun({ tenant_id: req.tenantId, run_snapshot: durable.run_snapshot });
        restored = true;
      }
      const checkpoint = genericAgentCheckpoints.load({ tenant_id: req.tenantId, run_id: run.run_id });
      return res.json({ ok: true, tenant_id: req.tenantId, run, restored_from_checkpoint: restored, durable_checkpoint: checkpoint ? { revision: checkpoint.revision, updated_at: checkpoint.updated_at } : null });
    } catch (error) {
      return publicError(res, error.message === "run_not_found" ? 404 : 403, error.message || "generic_agent_run_read_failed");
    }
  });

  app.post("/v1/generic-agents/evaluate", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    try {
      const report = evaluateGenericAgentRun(req.body?.cases);
      audit.append("generic_agent_evaluation_completed", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, case_count: report.case_count, score: report.score });
      return res.json({ ok: true, tenant_id: req.tenantId, evaluation: report, execution_allowed: false });
    } catch (error) {
      return publicError(res, 400, error.message || "generic_agent_evaluation_failed");
    }
  });

  app.post("/v1/generic-agents/runs/:runId/model-reservations", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      const run = genericAgentRuntime.reserveModelCall({
        run_id: req.params.runId,
        tenant_id: req.tenantId,
        model_id: req.body?.model_id,
        estimated_tokens: req.body?.estimated_tokens,
      });
      audit.append("generic_agent_model_reserved", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, run_id: run.run_id, model_id: req.body?.model_id, estimated_tokens: req.body?.estimated_tokens });
      return res.status(201).json({ ok: true, tenant_id: req.tenantId, run_id: run.run_id, model_usage: run.model_usage, model_budget: run.model_budget });
    } catch (error) {
      return publicError(res, error.message === "model_budget_exceeded" ? 429 : 400, error.message || "generic_agent_model_reservation_failed");
    }
  });

  app.post("/v1/generic-agents/runs/:runId/tool-events", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      const run = genericAgentRuntime.recordToolEvent({
        run_id: req.params.runId,
        tenant_id: req.tenantId,
        tool_id: req.body?.tool_id,
        outcome: req.body?.outcome,
        retry_count: req.body?.retry_count,
      });
      audit.append("generic_agent_tool_event", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, run_id: run.run_id, tool_id: req.body?.tool_id, outcome: req.body?.outcome || "success" });
      return res.json({ ok: true, tenant_id: req.tenantId, run_id: run.run_id });
    } catch (error) {
      return publicError(res, 400, error.message || "generic_agent_tool_event_failed");
    }
  });

  app.get("/v1/generic-agents/metrics", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    try {
      return res.json({ ok: true, metrics: genericAgentRuntime.getMetrics({ tenant_id: req.tenantId }) });
    } catch (error) {
      return publicError(res, 403, error.message || "generic_agent_metrics_read_failed");
    }
  });

  app.post("/v1/generic-agents/runs/:runId/orchestration", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      const run = genericAgentRuntime.getRun({ run_id: req.params.runId, tenant_id: req.tenantId });
      const plan = genericAgentOrchestrator.createPlan({ tenant_id: req.tenantId, run_id: run.run_id, workers: req.body?.workers });
      persistGenericOrchestration(plan);
      audit.append("generic_agent_orchestration_created", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, run_id: run.run_id, plan_id: plan.plan_id, worker_count: plan.workers.length });
      return res.status(201).json({ ok: true, tenant_id: req.tenantId, plan });
    } catch (error) {
      return publicError(res, 400, error.message || "generic_agent_orchestration_invalid");
    }
  });

  app.post("/v1/generic-agents/orchestration/:planId/claim", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      recoverGenericOrchestration(req.tenantId, req.params.planId);
      const claimed = genericAgentOrchestrator.claimReadyWorkers({ tenant_id: req.tenantId, plan_id: req.params.planId });
      persistGenericOrchestration(genericAgentOrchestrator.getPlan({ tenant_id: req.tenantId, plan_id: req.params.planId }));
      audit.append("generic_agent_workers_claimed", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, plan_id: claimed.plan_id, worker_count: claimed.workers.length });
      return res.json({ ok: true, tenant_id: req.tenantId, ...claimed });
    } catch (error) {
      return publicError(res, 400, error.message || "generic_agent_orchestration_claim_failed");
    }
  });

  app.post("/v1/generic-agents/orchestration/:planId/workers/:workerId/complete", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      recoverGenericOrchestration(req.tenantId, req.params.planId);
      const plan = genericAgentOrchestrator.completeWorker({ tenant_id: req.tenantId, plan_id: req.params.planId, worker_id: req.params.workerId, result: req.body?.result });
      persistGenericOrchestration(plan);
      const worker = plan.workers.find((candidate) => candidate.worker_id === req.params.workerId);
      audit.append(worker?.status === "quarantined" ? "generic_agent_worker_result_quarantined" : "generic_agent_worker_completed", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, plan_id: plan.plan_id, worker_id: req.params.workerId });
      return res.json({ ok: true, tenant_id: req.tenantId, plan });
    } catch (error) {
      return publicError(res, 400, error.message || "generic_agent_worker_complete_failed");
    }
  });

  app.post("/v1/generic-agents/orchestration/:planId/cancel", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      recoverGenericOrchestration(req.tenantId, req.params.planId);
      const plan = genericAgentOrchestrator.cancelPlan({ tenant_id: req.tenantId, plan_id: req.params.planId });
      persistGenericOrchestration(plan);
      audit.append("generic_agent_orchestration_cancelled", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, plan_id: plan.plan_id });
      return res.json({ ok: true, tenant_id: req.tenantId, plan });
    } catch (error) {
      return publicError(res, 400, error.message || "generic_agent_orchestration_cancel_failed");
    }
  });

  app.post("/v1/generic-agents/orchestration/:planId/join", coreAuth(SCOPES.WRITE_DECISION), (req, res) => {
    try {
      recoverGenericOrchestration(req.tenantId, req.params.planId);
      const joined = genericAgentOrchestrator.coreJoin({ tenant_id: req.tenantId, plan_id: req.params.planId });
      persistGenericOrchestration(genericAgentOrchestrator.getPlan({ tenant_id: req.tenantId, plan_id: req.params.planId }));
      audit.append("generic_agent_orchestration_core_joined", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, plan_id: joined.plan_id, run_id: joined.run_id });
      return res.json({ ok: true, tenant_id: req.tenantId, joined, execution_allowed: false });
    } catch (error) {
      return publicError(res, 400, error.message || "generic_agent_orchestration_join_failed");
    }
  });

  const healthProbeTimeoutMs = boundedHealthProbeTimeoutMs(options.healthProbeTimeoutMs);
  const healthProbeFlights = new Map();
  let healthProbeGeneration = 0;
  const boundedSingleFlightHealthProbe = async (name, run) => {
    let state = healthProbeFlights.get(name);
    if (!state) {
      state = { active: null, orphan: null };
      healthProbeFlights.set(name, state);
    }
    let entry = state.active;
    if (!entry) {
      const generation = ++healthProbeGeneration;
      const promise = Promise.resolve()
        .then(run)
        .then(
          (value) => ({ ok: true, value }),
          (error) => ({
            ok: false,
            error: String(error?.code || error?.message || `${name}_failed`).slice(0, 160),
          }),
        );
      entry = { generation, promise };
      state.active = entry;
      promise.then(() => {
        if (healthProbeFlights.get(name) !== state) return;
        if (state.active?.generation === generation) state.active = null;
        if (state.orphan?.generation === generation) state.orphan = null;
        if (!state.active && !state.orphan) {
          healthProbeFlights.delete(name);
        }
      });
    }
    let timer;
    try {
      const result = await Promise.race([
        entry.promise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({
            ok: false,
            timed_out: true,
            error: `${name}_timeout`,
          }), healthProbeTimeoutMs);
        }),
      ]);
      if (result.timed_out === true
        && healthProbeFlights.get(name) === state
        && state.active?.generation === entry.generation
        && !state.orphan) {
        // Permit one recovery attempt without allowing an attacker or a stuck
        // dependency to create an unbounded chain of unresolved promises.
        state.orphan = entry;
        state.active = null;
      }
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const serveHealth = async (_req, res, { strictReadiness = false } = {}) => {
    const production = (process.env.NODE_ENV || "development") === "production";
    const productionBuildReady =
      !production ||
      BUILD_COMMIT_VERIFIABLE;
    const hostNativeRuntimeReady =
      !hostNativeGovernanceEnabled ||
      (
        hostNativeGovernanceState === "ready" &&
        hostNativeGovernance?.storage?.restart_durable === true &&
        hostNativeGovernance?.trusted_readback_configured === true &&
        hostNativeGovernance?.release_join_verdict_resolver_configured === true &&
        hostNativeGovernance?.required_checks_policy_resolver_configured === true &&
        hostNativeGovernance?.closure_attestation_verifier_configured === true &&
        hostNativeResolverConfigurationValid
      );
    const hostNativeProductionReadinessRequired =
      production && hostNativeGovernanceEnabled;
    const causalContinuityProductionRequired = production
      && governedAgentPostgresConfigured
      && (
        !hasInjectedPostgresVersionProbe
        || Boolean(options.causalContinuityStore || options.causalContinuityRuntime)
      );
    const causalInitializationElapsedMs = causalContinuityInitializationStartedAtMs === null
      ? null
      : Math.max(0, Math.floor(performance.now() - causalContinuityInitializationStartedAtMs));
    const causalInitializationWindowOpen = production
      && causalContinuityProductionRequired
      && Boolean(causalContinuityRuntime)
      && causalContinuityState === "initializing"
      && causalInitializationElapsedMs !== null
      && causalInitializationElapsedMs <= causalContinuityInitializationLivenessMs;
    const researchAirlockBootstrapGuard = causalInitializationWindowOpen
      ? buildResearchAirlockBootstrapGuard({
          buildCommitSha: BUILD_COMMIT_SHA,
          causalProductionRequired: causalContinuityProductionRequired,
          causalState: causalContinuityState,
          initializationElapsedMs: causalInitializationElapsedMs,
          livenessWindowMs: causalContinuityInitializationLivenessMs,
          mode: researchAirlockRuntime.mode,
          runtimeReady: researchAirlockRuntime.ready,
          store: researchAirlockRuntime.store,
        })
      : null;
    const hostNativeBootstrapPrerequisitesReady = hostNativeProductionReadinessRequired
      && hostNativeGovernanceEnabled
      && hostNativeRuntimeReady
      && hostNativeGovernanceState === "ready"
      // Host-native governance is intentionally the server-owned atomic file
      // store in production. Its authority comes from the independently
      // verified readback/signing/resolver gates below, not from pretending the
      // store is distributed. Research Airlock remains separately constrained
      // to its PostgreSQL distributed store by the signed bootstrap guard.
      && hostNativeGovernance?.storage?.kind === "file_atomic"
      && hostNativeGovernance?.storage?.restart_durable === true
      && hostNativeGovernance?.render_service_origin_resolver_configured === true
      && mcpTenantGatewayConfigured
      && hostNativeSigningSecret.length >= 32
      && Boolean(tenantContextSigningSecret)
      && Boolean(ownerContextSigningSecret)
      && Boolean(dttAgentIdentitySecret)
      && dttVerifierIdentityResolverConfigured
      && governedAgentPostgresConfigured
      && Boolean(nyraPolicyRegistryPostgresPool)
      && typeof hostNativeRequiredChecksPolicyResolver === "function"
      && hostNativeRenderServiceOriginResolverState !== "fail_closed_unavailable"
      && options.researchAirlockRuntime === undefined;
    const policyProofBootstrapReady = nyraPolicyRegistryMode === "advisory_evaluate"
      || (
        nyraPolicyRegistryMode === "enforced"
        && nyraPolicyRegistryProofService?.configuration_ready === true
      );
    const policyRegistryBootstrapReady = Boolean(nyraPolicyRegistryPostgresPool)
      && options.nyraPolicyRegistryStore === undefined;
    const causalBootstrapLivenessReady = !strictReadiness
      && causalInitializationWindowOpen
      && causalBootstrapConstructionProvenance.host_native
      && causalBootstrapConstructionProvenance.research_airlock
      && causalBootstrapConstructionProvenance.policy_registry
      && causalBootstrapConstructionProvenance.causal_runtime
      && causalBootstrapConstructionProvenance.dtt_identity
      && causalBootstrapConstructionProvenance.resolver_registry
      && productionBuildReady
      && hostNativeBootstrapPrerequisitesReady
      && nyraPolicyRegistryModeValid
      && nyraPolicyRegistryMode !== "disabled"
      && policyProofBootstrapReady
      && policyRegistryBootstrapReady
      && Boolean(researchAirlockBootstrapGuard);

    let governedAgentPostgresVersion =
      normalizePostgresMajorVerification(null);
    let nyraPolicyRegistryStatus;
    let nyraPolicyRegistryProofStatus;
    let researchAirlockHealth;
    let causalContinuityHealth = {
      ok: false,
      state: causalContinuityState,
      error: causalContinuityInitializationError,
    };
    if (causalBootstrapLivenessReady) {
      nyraPolicyRegistryStatus = {
        configured: true,
        backend: "postgresql",
        restart_durable: true,
        distributed: true,
        state: "probe_deferred_during_causal_initialization",
        ready: false,
      };
      nyraPolicyRegistryProofStatus = {
        ready: false,
        backend: nyraPolicyRegistryProofService ? "postgresql" : "unavailable",
        state: "probe_deferred_during_causal_initialization",
      };
      researchAirlockHealth = {
        policy_version: RESEARCH_AIRLOCK_POLICY_VERSION,
        mode: researchAirlockRuntime.mode || "unknown",
        ready: false,
        operational_safe: false,
        accepting_new_work: false,
        state_backend: researchAirlockRuntime.store?.kind || "unavailable",
        restart_durable: researchAirlockRuntime.store?.restart_durable === true,
        distributed: researchAirlockRuntime.store?.distributed === true,
        bootstrap_guard: researchAirlockBootstrapGuard,
      };
    } else {
      const probe = governedAgentPostgresVersionProbe;
      const postgresCheck = typeof probe === "function"
        ? probe
        : typeof probe?.check === "function"
          ? () => probe.check()
          : null;
      const [postgresResult, policyResult, proofResult, airlockResult, causalResult] = await Promise.all([
        hostNativeProductionReadinessRequired && governedAgentPostgresConfigured && postgresCheck
          ? boundedSingleFlightHealthProbe("postgres_major", postgresCheck)
          : Promise.resolve({ ok: true, value: normalizePostgresMajorVerification(null) }),
        boundedSingleFlightHealthProbe("nyra_policy_registry", () => nyraPolicyRegistry.status()),
        nyraPolicyRegistryProofService
          ? boundedSingleFlightHealthProbe("nyra_policy_registry_proof", () => nyraPolicyRegistryProofService.status())
          : Promise.resolve({ ok: true, value: { ready: false, backend: "unavailable", error: "policy_proof_not_configured" } }),
        boundedSingleFlightHealthProbe("research_airlock", () => researchAirlockRuntime.status("health_probe")),
        causalContinuityRuntime && causalContinuityState === "ready"
          ? boundedSingleFlightHealthProbe("causal_continuity", () => causalContinuityRuntime.health())
          : Promise.resolve({ ok: true, value: causalContinuityHealth }),
      ]);
      if (postgresResult.ok) {
        governedAgentPostgresVersion = normalizePostgresMajorVerification(postgresResult.value);
      }
      nyraPolicyRegistryStatus = policyResult.ok && policyResult.value && typeof policyResult.value === "object"
        ? policyResult.value
        : {
            configured: true,
            backend: policyRegistryBootstrapReady ? "postgresql" : "unavailable",
            restart_durable: policyRegistryBootstrapReady,
            distributed: policyRegistryBootstrapReady,
            state: policyResult.timed_out ? "probe_timeout" : "unavailable",
            ready: false,
            error: policyResult.error,
          };
      nyraPolicyRegistryProofStatus = proofResult.ok && proofResult.value && typeof proofResult.value === "object"
        ? proofResult.value
        : {
            ready: false,
            backend: nyraPolicyRegistryProofService ? "postgresql" : "unavailable",
            state: proofResult.timed_out ? "probe_timeout" : "unavailable",
            error: proofResult.error,
          };
      researchAirlockHealth = airlockResult.ok && airlockResult.value && typeof airlockResult.value === "object"
        ? airlockResult.value
        : {
            mode: researchAirlockRuntime.mode || "shadow",
            ready: false,
            operational_safe: false,
            accepting_new_work: false,
            state_backend: researchAirlockRuntime.store?.kind || "unavailable",
            state: airlockResult.timed_out ? "probe_timeout" : "unavailable",
            error: airlockResult.error,
          };
      if (causalResult.ok && causalResult.value && typeof causalResult.value === "object") {
        causalContinuityHealth = {
          ...causalResult.value,
          state: causalContinuityState,
        };
      } else {
        causalContinuityHealth = {
          ok: false,
          state: causalResult.timed_out ? "health_timeout" : "health_failed",
          error: causalResult.error,
        };
      }
    }
    const hostNativeProductionReadinessReasons = [];
    if (
      hostNativeProductionReadinessRequired &&
      !mcpTenantGatewayConfigured
    ) {
      hostNativeProductionReadinessReasons.push(
        "mcp_tenant_gateway_not_configured",
      );
    }
    if (
      hostNativeProductionReadinessRequired &&
      !tenantContextSigningSecret
    ) {
      hostNativeProductionReadinessReasons.push(
        "tenant_context_signing_not_configured",
      );
    }
    if (
      hostNativeProductionReadinessRequired &&
      !ownerContextSigningSecret
    ) {
      hostNativeProductionReadinessReasons.push(
        "owner_context_signing_not_configured",
      );
    }
    if (
      hostNativeProductionReadinessRequired &&
      !dttAgentIdentitySecret
    ) {
      hostNativeProductionReadinessReasons.push(
        "dtt_closure_signing_not_configured",
      );
    }
    if (
      hostNativeProductionReadinessRequired &&
      !governedAgentPostgresConfigured
    ) {
      hostNativeProductionReadinessReasons.push(
        "governed_agent_postgres_not_configured",
      );
    }
    if (
      hostNativeProductionReadinessRequired &&
      governedAgentPostgresConfigured &&
      !governedAgentPostgresVersion.verified
    ) {
      hostNativeProductionReadinessReasons.push(
        "governed_agent_postgres_major_16_not_verified",
      );
    }
    const hostNativeProductionReadinessReady =
      !hostNativeProductionReadinessRequired ||
      hostNativeProductionReadinessReasons.length === 0;
    const hostNativeReady =
      hostNativeRuntimeReady && hostNativeProductionReadinessReady;
    let nyraPolicyRegistryCompilerCurrentStatus = nyraPolicyRegistryCompilerStatus;
    if (nyraPolicyRegistryCompilerProvenanceVerifier) {
      try {
        const refreshed = nyraPolicyRegistryCompilerProvenanceVerifier.status();
        nyraPolicyRegistryCompilerCurrentStatus = refreshed &&
          typeof refreshed.then !== "function" ? refreshed : null;
      } catch {
        nyraPolicyRegistryCompilerCurrentStatus = null;
      }
    }
    const nyraPolicyRegistryCompilerRuntimeReady =
      nyraPolicyRegistryCompilerEnabled &&
      nyraPolicyRegistryCompilerConfigurationError === null &&
      validPolicyCompilerStatus(
        nyraPolicyRegistryCompilerCurrentStatus,
        nyraPolicyRegistryExpectedCatalogDigest,
        nyraPolicyRegistryExpectedTrustCatalogDigest,
      );
    const nyraPolicyRegistryClientStatus = () => nyraPolicyRegistryClient?.status?.() || {
      configured: false,
      ready: false,
      state: nyraPolicyRegistryProofEnabled ? "unavailable" : "disabled",
      upstream_verified: false,
      last_failure: nyraPolicyRegistryProofConfigurationError || null,
    };
    let nyraPolicyRegistryCoordinatorStatus;
    try {
      nyraPolicyRegistryCoordinatorStatus = nyraPolicyRegistryCoordinator
        ? await nyraPolicyRegistryCoordinator.status()
        : {
            ready: false,
            e2e_verified: false,
            upstream: nyraPolicyRegistryClientStatus(),
            error: "policy_registry_coordinator_not_configured",
          };
    } catch {
      nyraPolicyRegistryCoordinatorStatus = {
        ready: false,
        e2e_verified: false,
        upstream: nyraPolicyRegistryClientStatus(),
        error: "policy_registry_coordinator_unavailable",
      };
    }
    const nyraPolicyRegistryEvaluationProductionReady =
      !production || (
        nyraPolicyRegistryStatus.backend === "postgresql" &&
        nyraPolicyRegistryStatus.ready === true
      );
    const nyraPolicyRegistryStoreProvenanceReady =
      nyraPolicyRegistryStatus.backend === "postgresql" &&
      nyraPolicyRegistryStatus.restart_durable === true &&
      nyraPolicyRegistryStatus.distributed === true &&
      nyraPolicyRegistryStatus.compiler_provenance_persistence === true &&
      nyraPolicyRegistryStatus.compiler_input_persisted === false;
    const nyraPolicyRegistryProofV3Ready =
      nyraPolicyRegistryProofStatus.ready === true &&
      nyraPolicyRegistryProofStatus.proof_schema_version === "nyra_policy_registry_proof_v3" &&
      nyraPolicyRegistryProofStatus.attestation_schema_version ===
        "nyra_policy_activation_attestation_v3" &&
      nyraPolicyRegistryProofStatus.receipt_schema_version ===
        "core_policy_activation_receipt_v3" &&
      nyraPolicyRegistryProofStatus.compiler_provenance_binding_required === true;
    const nyraPolicyRegistryProofLifecycleReady =
      nyraPolicyRegistryProofActivationEnabled &&
      nyraPolicyRegistryProofConfigurationError === null &&
      nyraPolicyRegistryCompilerRuntimeReady &&
      nyraPolicyRegistryStoreProvenanceReady &&
      nyraPolicyRegistryProofV3Ready &&
      nyraPolicyRegistryCoordinatorStatus.ready === true &&
      nyraPolicyRegistryCoordinatorStatus.e2e_verified === true;
    const nyraPolicyRegistryProductionReady = nyraPolicyRegistryEvaluationProductionReady &&
      (nyraPolicyRegistryMode !== "enforced" || nyraPolicyRegistryProofStatus.ready === true) &&
      (!nyraPolicyRegistryCompilerRequired || nyraPolicyRegistryCompilerRuntimeReady) &&
      (!nyraPolicyRegistryProofRequired || nyraPolicyRegistryProofLifecycleReady);
    const researchAirlockProductionReady = !production
      || researchAirlockHealth.ready === true
      || (researchAirlockHealth.mode === "shadow" && researchAirlockHealth.operational_safe === true);
    const causalContinuityProductionReady = !causalContinuityProductionRequired
      || (Boolean(causalContinuityRuntime) && causalContinuityHealth.ok === true);
    await ensureGenericWorkCoreJoinSignerReady();
    const genericWorkCoreJoinCurrentSignerHealth = genericWorkCoreJoinSignerFailureLatched
      ? {
          signer_state: genericWorkCoreJoinSignerState,
          reason: genericWorkCoreJoinSignerReason,
        }
      : genericWorkCoreJoinSignerHealth();
    const genericWorkCoreJoinCurrentSignerState = genericWorkCoreJoinCurrentSignerHealth.signer_state;
    const genericWorkCoreJoinCurrentSignerReason = genericWorkCoreJoinCurrentSignerHealth.reason;
    const genericWorkCoreJoinSignerReady = genericWorkCoreJoinCurrentSignerState === "ready";
    const genericWorkCoreJoinDistributedReady = !genericWorkCoreJoinProduction
      || genericWorkCoreJoinStore?.distributed === true;
    const genericWorkCoreJoinReason = genericWorkCoreJoinConfigurationError
      ? genericWorkCoreJoinConfigurationError
      : !genericWorkCoreJoinEnabled
        ? "generic_work_core_join_disabled"
        : !genericWorkCoreJoinSigner
          ? genericWorkCoreJoinCurrentSignerReason
          : !dttAgentIdentitySecret
        ? "generic_work_core_join_verifier_unavailable"
        : genericWorkCoreJoinStore?.restart_durable !== true
          ? "generic_work_core_join_durable_store_unavailable"
          : !genericWorkCoreJoinDistributedReady
            ? "generic_work_core_join_distributed_store_unavailable"
            : genericWorkCoreJoinStoreState === "failed"
              ? genericWorkCoreJoinStoreError || "generic_work_core_join_durable_store_unavailable"
              : genericWorkCoreJoinStoreState !== "ready"
                ? "generic_work_core_join_store_initializing"
                : !genericWorkCoreJoinSignerReady
                  ? genericWorkCoreJoinCurrentSignerReason || (genericWorkCoreJoinCurrentSignerState === "configured"
                    ? "generic_work_core_join_signer_not_yet_verified"
                    : "generic_work_core_join_signer_unavailable")
                  : null;
    const genericWorkCoreJoinReady = genericWorkCoreJoinActivationEnabled
      && Boolean(genericWorkCoreJoinAuthority)
      && genericWorkCoreJoinStoreState === "ready"
      && genericWorkCoreJoinDistributedReady
      && genericWorkCoreJoinSignerReady;
    const nonCausalProductionReady = productionBuildReady
      && hostNativeReady
      && nyraPolicyRegistryModeValid
      && nyraPolicyRegistryCompilerConfigurationError === null
      && nyraPolicyRegistryProofConfigurationError === null
      && nyraPolicyRegistryProductionReady
      && researchAirlockProductionReady
      && genericWorkCoreJoinConfigurationError === null
      && (!genericWorkCoreJoinRequired || genericWorkCoreJoinReady);
    const renderReady = nonCausalProductionReady
      && causalContinuityProductionReady;
    const causalInitializationDegraded = causalBootstrapLivenessReady;
    const healthStatusReady = renderReady
      || (!strictReadiness && causalInitializationDegraded);
    res.status(healthStatusReady ? 200 : 503).json({
      ok: !production || renderReady,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      build: {
        build_id: BUILD_ID,
        commit_sha: BUILD_COMMIT_SHA,
        commit_verifiable: BUILD_COMMIT_VERIFIABLE,
      },
      health_contract_version: HOST_NATIVE_HEALTH_CONTRACT_VERSION,
      health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
      mode: process.env.NODE_ENV || "development",
      render_ready: renderReady,
      readiness: renderReady,
      readiness_verified: renderReady,
      liveness_degraded: causalInitializationDegraded,
      storage_root_configured: Boolean(process.env.CORE_SERVICE_STORAGE_ROOT),
      governed_agent_queue_backend: governedAgentDatabaseUrl ? "postgresql" : "file_fallback",
      generic_work_core_join: {
        enabled: genericWorkCoreJoinEnabled,
        required: genericWorkCoreJoinRequired,
        configuration_valid: genericWorkCoreJoinConfigurationError === null,
        configuration_error: genericWorkCoreJoinConfigurationError,
        signer_mode: genericWorkCoreJoinRemoteSignerMode,
        state: genericWorkCoreJoinConfigurationError
          ? "configuration_invalid"
          : !genericWorkCoreJoinEnabled
            ? "disabled"
            : !genericWorkCoreJoinAuthority
              ? "durability_or_signing_unavailable"
              : genericWorkCoreJoinStoreState !== "ready"
                ? genericWorkCoreJoinStoreState
                : genericWorkCoreJoinSignerReady
                  ? "ready"
                  : genericWorkCoreJoinCurrentSignerState === "configured"
                    ? "signer_not_yet_verified"
                    : "signer_unavailable",
        ready: genericWorkCoreJoinReady,
        store_state: genericWorkCoreJoinStoreState,
        signer_state: genericWorkCoreJoinCurrentSignerState,
        signer_probe_attempts: genericWorkCoreJoinProbeAttempts,
        reason: genericWorkCoreJoinReason,
        backend: genericWorkCoreJoinStore?.kind || "unavailable",
        restart_durable: genericWorkCoreJoinStore?.restart_durable === true,
        distributed: genericWorkCoreJoinStore?.distributed === true,
        algorithm: genericWorkCoreJoinAuthority?.signer_metadata.algorithm || null,
        key_id: genericWorkCoreJoinAuthority?.signer_metadata.key_id || null,
        public_key_fingerprint: genericWorkCoreJoinAuthority?.signer_metadata.public_key_fingerprint || null,
        custody: genericWorkCoreJoinAuthority?.signer_metadata.custody || genericWorkCoreJoinSignerCustody,
        initialization_error: genericWorkCoreJoinStoreError,
        host_action_authorized: false,
      },
      bootstrap_release_exception: {
        state: bootstrapReleaseExceptionStoreState,
        ready: Boolean(bootstrapReleaseExceptionAdapter) && bootstrapReleaseExceptionStoreState === "ready",
        required: false,
        backend: bootstrapReleaseExceptionStore?.initialize ? "postgres_bootstrap_authority_v1" : "unavailable",
        trust_pin_configured: Boolean(bootstrapAuthorityTrustPinRaw),
        pinned: Boolean(bootstrapAuthorityTrustPin) && bootstrapReleaseExceptionStoreState === "ready",
        authority_key_id: bootstrapAuthorityTrustPin?.authority_key_id || null,
        attestation_status: bootstrapAuthorityAttestationStatus,
        initialization_error: bootstrapReleaseExceptionStoreError,
        host_action_authorized: false,
        core_join_authorized: false,
      },
      bootstrap_deadlock_verdict: {
        state: bootstrapDeadlockVerdictStoreState,
        ready: Boolean(bootstrapDeadlockVerdictResolver) && bootstrapDeadlockVerdictStoreState === "ready",
        required: false,
        backend: bootstrapDeadlockVerdictStore?.kind || "unavailable",
        failure_policy_configured: true,
        initialization_error: bootstrapDeadlockVerdictStoreError,
        host_action_authorized: false,
        core_join_authorized: false,
      },
      research_airlock: {
        ...researchAirlockHealth,
        ready: researchAirlockProductionReady && researchAirlockHealth.ready === true,
        production_required: production && researchAirlockHealth.mode === "enforced",
      },
      causal_continuity: {
        ...causalContinuityHealth,
        production_required: causalContinuityProductionRequired,
        feature_flag_default: "SHADOW",
      },
      dynamic_task_tree: {
        state_backend: dynamicTaskTreeStateStore.kind || "injected",
        restart_durable: dynamicTaskTreeStateStore.restart_durable === true,
        distributed_store: dynamicTaskTreeStateStore.distributed === true,
        verifier_identity_resolver_configured: dttVerifierIdentityResolverConfigured,
        agent_identity_receipts_ready: dttAgentIdentityReceiptService?.configured === true,
        agent_identity_receipt_backend: dttAgentIdentityPostgresPool ? "postgresql" : "file_fallback",
        verification_trust_backend: dttVerificationTrustStore.kind || "injected",
        verification_trust_distributed: dttVerificationTrustStore.distributed === true,
        core_join_verdict_source: "universal_core_append_only_ledger",
        join_verdict_backend: dynamicTaskTreeJoinVerdictStore.kind || "injected",
        join_verdict_restart_durable: dynamicTaskTreeJoinVerdictStore.restart_durable === true,
        join_verdict_distributed: dynamicTaskTreeJoinVerdictStore.distributed === true,
        verified_outcome_and_join_ready: dttVerifierIdentityResolverConfigured,
        execution_authorized: false,
      },
      nyra_deep_branch_v2: {
        core_material_ready: !nyraDeepV2IntegrationReason,
        integration_state: nyraDeepV2IntegrationReason || "ready",
        evidence_ledger: typeof nyraDeepV2Ledger?.ledgerStats === "function"
          ? nyraDeepV2Ledger.ledgerStats()
          : {
            backend: nyraDeepV2Ledger ? "injected" : "unavailable",
            restart_durable: false,
            distributed: false,
            raw_content_retained: false,
          },
        mcp_request_replay: typeof nyraDeepV2McpRequestVerifier?.status === "function"
          ? nyraDeepV2McpRequestVerifier.status()
          : {
            backend: nyraDeepV2McpRequestVerifier ? "injected" : "unavailable",
            restart_durable: false,
            distributed: false,
            ready: Boolean(nyraDeepV2McpRequestVerifier),
            raw_identifiers_retained: false,
          },
        attester_ready: Boolean(nyraDeepV2Attester),
        source_verifier_ready: Boolean(nyraDeepV2SourceVerifier),
        execution_authorized: false,
      },
      nyra_policy_registry: {
        configuration_valid: nyraPolicyRegistryModeValid &&
          nyraPolicyRegistryProofConfigurationError === null,
        evaluation: nyraPolicyRegistryEvaluationEnabled ? "active" : "disabled",
        enforcement: nyraPolicyRegistryMode === "enforced"
          ? "mandatory"
          : nyraPolicyRegistryEvaluationEnabled
            ? "conditional_on_active_snapshot"
            : "disabled",
        configured: nyraPolicyRegistryStatus.configured === true,
        backend: nyraPolicyRegistryStatus.backend || "unavailable",
        restart_durable: nyraPolicyRegistryStatus.restart_durable === true,
        distributed: nyraPolicyRegistryStatus.distributed === true,
        compiler_provenance_persistence:
          nyraPolicyRegistryStatus.compiler_provenance_persistence === true,
        compiler_input_persisted: nyraPolicyRegistryStatus.compiler_input_persisted === true,
        state: nyraPolicyRegistryStatus.state || (nyraPolicyRegistryStatus.ready === false ? "unavailable" : "ready"),
        ready: nyraPolicyRegistryProductionReady,
        compiler_provenance: {
          enabled: nyraPolicyRegistryCompilerEnabled,
          required: nyraPolicyRegistryCompilerRequired,
          mode: nyraPolicyRegistryCompilerMode,
          configuration_valid: nyraPolicyRegistryCompilerConfigurationError === null,
          configured: Boolean(nyraPolicyRegistryCompilerProvenanceVerifier),
          ready: nyraPolicyRegistryCompilerRuntimeReady,
          state: !nyraPolicyRegistryCompilerEnabled
            ? (nyraPolicyRegistryCompilerConfigurationError ? "configuration_invalid" : "disabled")
            : nyraPolicyRegistryCompilerConfigurationError
              ? "configuration_invalid"
              : nyraPolicyRegistryCompilerRuntimeReady ? "ready" : "unavailable",
          render_gate_required: nyraPolicyRegistryCompilerRequired ||
            !nyraPolicyRegistryCompilerEnabledFlag.valid ||
            !nyraPolicyRegistryCompilerRequiredFlag.valid ||
            !nyraPolicyRegistryCompilerModeValid ||
            nyraPolicyRegistryCompilerConfigurationError !== null,
          schema_version: nyraPolicyRegistryCompilerCurrentStatus?.schema_version || null,
          provenance_schema_version: "nyra_policy_compiler_provenance_v1",
          compiler_algorithm:
            nyraPolicyRegistryCompilerCurrentStatus?.compiler_algorithm || null,
          verification_algorithm:
            nyraPolicyRegistryCompilerCurrentStatus?.verification_algorithm || null,
          traversal_budget:
            Number.isInteger(nyraPolicyRegistryCompilerCurrentStatus?.traversal_budget)
              ? nyraPolicyRegistryCompilerCurrentStatus.traversal_budget
              : null,
          compiler_build_commit:
            nyraPolicyRegistryCompilerCurrentStatus?.compiler_build_commit || null,
          catalog_digest: nyraPolicyRegistryCompilerCurrentStatus?.catalog_digest || null,
          trust_catalog_digest:
            nyraPolicyRegistryCompilerCurrentStatus?.trust_catalog_digest || null,
          compiler_input_persisted:
            nyraPolicyRegistryStatus.compiler_input_persisted === true,
          execution_authorized: false,
          error: nyraPolicyRegistryCompilerConfigurationError ||
            (nyraPolicyRegistryCompilerEnabled && !nyraPolicyRegistryCompilerRuntimeReady
              ? "policy_registry_compiler_unavailable"
              : null),
        },
        proof_lifecycle: {
          enabled: nyraPolicyRegistryProofEnabled,
          required: nyraPolicyRegistryProofRequired,
          mode: nyraPolicyRegistryCoreSignerMode,
          configuration_valid: nyraPolicyRegistryProofConfigurationError === null,
          state: !nyraPolicyRegistryProofEnabled
            ? (nyraPolicyRegistryProofConfigurationError ? "configuration_invalid" : "disabled")
            : nyraPolicyRegistryProofConfigurationError
              ? "configuration_invalid"
              : nyraPolicyRegistryProofLifecycleReady ? "ready" : "unavailable",
          ready: nyraPolicyRegistryProofLifecycleReady,
          render_gate_required: nyraPolicyRegistryProofRequired ||
            !nyraPolicyRegistryProofRequiredFlag.valid ||
            nyraPolicyRegistryProofConfigurationError !== null,
          error: nyraPolicyRegistryProofConfigurationError,
        },
        proof: nyraPolicyRegistryProofStatus,
        proof_e2e: nyraPolicyRegistryCoordinatorStatus,
      },
      governed_agent_runner: {
        mode: "manual_dry_run",
        provider_execution_available: false,
        fixed_provider_workflow: null,
        native_specialists_only: true,
        max_jobs_per_tick: 2,
      },
      tenant_provider_vault: {
        retired: true,
        configured: false,
        execution_available: false,
        execution_enabled: false,
        tenant_scoped: true,
      },
      host_native_governance: {
        enabled: hostNativeGovernanceEnabled,
        state: hostNativeGovernanceState,
        production_readiness_required:
          hostNativeProductionReadinessRequired,
        production_readiness_ready:
          hostNativeProductionReadinessReady,
        production_readiness_reasons:
          hostNativeProductionReadinessReasons,
        mcp_tenant_gateway_configured: mcpTenantGatewayConfigured,
        tenant_context_signing_configured:
          Boolean(tenantContextSigningSecret),
        owner_context_signing_configured:
          Boolean(ownerContextSigningSecret),
        dtt_closure_signing_configured:
          Boolean(dttAgentIdentitySecret),
        governed_agent_postgres_configured:
          governedAgentPostgresConfigured,
        governed_agent_postgres_version:
          governedAgentPostgresVersion,
        route_ready: Boolean(hostNativeGovernance),
        store_backend: hostNativeGovernance?.storage?.kind || null,
        restart_durable: hostNativeGovernance?.storage?.restart_durable === true,
        distributed_store: hostNativeGovernance?.storage?.distributed === true,
        trusted_readback_configured:
          hostNativeGovernance?.trusted_readback_configured === true,
        release_join_verdict_resolver_configured:
          hostNativeGovernance?.release_join_verdict_resolver_configured === true,
        required_checks_policy_resolver_configured:
          hostNativeGovernance?.required_checks_policy_resolver_configured === true,
        closure_attestation_verifier_configured:
          hostNativeGovernance?.closure_attestation_verifier_configured === true,
        render_service_origin_resolver_configured:
          hostNativeGovernance?.render_service_origin_resolver_configured === true,
        resolver_configuration_valid: hostNativeResolverConfigurationValid,
        resolver_configuration_error: hostNativeResolverConfigurationError,
        github_credential_resolver_state:
          options.hostNativeGithubCredentialResolverState || "not_configured",
        github_credential_binding_count:
          Number(options.hostNativeGithubCredentialBindingCount || 0),
        render_origin_resolver_state: hostNativeRenderServiceOriginResolverState,
        render_origin_binding_count:
          Number(options.hostNativeRenderServiceOriginBindingCount || 0),
        required_checks_policy_resolver_state:
          options.hostNativeRequiredChecksPolicyResolverState || "not_configured",
        required_checks_policy_binding_count:
          Number(options.hostNativeRequiredChecksPolicyBindingCount || 0),
        tenant_github_credential_resolver_configured:
          typeof options.hostNativeGithubTokenResolver === "function",
        public_repository_readback_ready: true,
        private_repository_readback_ready:
          typeof options.hostNativeGithubTokenResolver === "function",
        caller_supplied_github_token_allowed: false,
        execution_adapter: "host_native",
        provider_execution: false,
        provider_api_key_required: false,
        maximum_specialists: 3,
        maximum_parallel_specialists: 2,
      },
      provider_setup_link_bootstrap_configured: providerSetupLinkBootstrapConfigured,
      provider_setup_link_bootstrap_state: providerSetupLinkBootstrapState,
      tenant_context_signing_configured: Boolean(tenantContextSigningSecret),
      owner_context_signing_configured: Boolean(ownerContextSigningSecret),
      uptime_seconds: Math.round(process.uptime()),
    });
  };

  // Deployment liveness deliberately excludes policy, database and causal
  // readiness. Those remain enforced by /healthz and /readyz.
  app.get("/livez", (_req, res) => res.status(200).json({
    ok: true,
    service: SERVICE_NAME,
    liveness: "process_running",
  }));
  app.get("/healthz", (req, res) => serveHealth(req, res));
  app.get("/readyz", (req, res) => serveHealth(req, res, { strictReadiness: true }));

  app.get("/v1/scopes", (req, res) => {
    res.json({ ok: true, scopes: Object.values(SCOPES), presets: KEY_PRESETS });
  });

  const icf = createIcfKernel({ audit, storageRoot, mode: options.icfMode || process.env.CORE_ICF_MODE || "advisory" });
  const icfRuntime = createIcfRuntimeFacade({ kernel: icf, store: options.icfStore, coreJoinStore: options.coreJoinStore, mode: options.icfMode || process.env.CORE_ICF_MODE || "advisory" });

  app.get("/v1/icf/rollout", coreAuth(SCOPES.READ_DECISION), (req, res) => res.json({ ok: true, rollout: icf.rollout() }));
  app.get("/v1/icf/:workId", coreAuth(SCOPES.READ_DECISION), (req, res) => res.json({ ok: true, icf: icf.status(req.tenantId, req.params.workId) }));
  app.post("/v1/icf/:workId/covenant", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => res.status((r=icf.putCovenant(req.tenantId, req.params.workId, req.body || {})).ok ? 200 : 409).json(r));
  app.post("/v1/icf/:workId/compile", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => res.status((r=icf.compile(req.tenantId, req.params.workId, req.body?.claims || [])).ok ? 200 : 409).json(r));
  app.post("/v1/icf/:workId/decompose", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => res.status((r=icf.decompose(req.tenantId, req.params.workId, req.body?.parent_id, req.body?.children || [], req.body?.coverage || {})).ok ? 200 : 409).json(r));
  app.post("/v1/icf/:workId/merge", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => res.status((r=icf.merge(req.tenantId, req.params.workId, req.body?.child_ids || [], req.body || {})).ok ? 200 : 409).json(r));
  app.post("/v1/icf/:workId/cells", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => res.status((r=icf.registerCell(req.tenantId, req.params.workId, req.body || {})).ok ? 201 : 409).json(r));
  app.get("/v1/icf/:workId/frontier", coreAuth(SCOPES.READ_DECISION), (req, res) => res.json({ ok: true, frontier: icf.frontier(req.tenantId, req.params.workId) }));
  app.post("/v1/icf/:workId/warrants", coreAuth(SCOPES.WRITE_RUNBOOK), (req, res) => res.status((r=icf.requestWarrant(req.tenantId, req.params.workId, req.body?.cell_id, req.body || {})).ok ? 201 : 409).json(r));
  app.post("/v1/icf/:workId/warrants/:warrantId/reserve", coreAuth(SCOPES.WRITE_RUNBOOK), (req, res) => res.status((r=icf.reserveWarrant(req.tenantId, req.params.workId, req.params.warrantId)).ok ? 200 : 409).json(r));
  app.post("/v1/icf/:workId/warrants/:warrantId/report", coreAuth(SCOPES.WRITE_RUNBOOK), (req, res) => res.status((r=icf.reportExecution(req.tenantId, req.params.workId, req.params.warrantId, req.body || {})).ok ? 200 : 409).json(r));
  app.post("/v1/icf/:workId/evidence", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => res.status((r=icf.addEvidence(req.tenantId, req.params.workId, req.body || {})).ok ? 201 : 409).json(r));
  app.post("/v1/icf/:workId/evidence/:evidenceId/verify", coreAuth(SCOPES.WRITE_RUNBOOK), (req, res) => res.status((r=icf.verifyEvidence(req.tenantId, req.params.workId, req.params.evidenceId, req.body || {})).ok ? 200 : 409).json(r));
  app.post("/v1/icf/:workId/graph/invalidate", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => res.json(icf.invalidateGraph(req.tenantId, req.params.workId, req.body || {})));
  app.post("/v1/icf/:workId/closure/begin", coreAuth(SCOPES.WRITE_RUNBOOK), (req, res) => res.status((r=icf.beginClosure(req.tenantId, req.params.workId)).ok ? 200 : 409).json(r));
  app.post("/v1/icf/:workId/closure/local-join", coreAuth(SCOPES.WRITE_RUNBOOK), (req, res) => res.status((r=icf.localJoin(req.tenantId, req.params.workId, req.body?.snapshot)).ok ? 200 : 409).json(r));
  app.post("/v1/icf/:workId/closure/global-join", coreAuth(SCOPES.WRITE_RUNBOOK), (req, res) => res.status((r=icf.globalJoin(req.tenantId, req.params.workId, req.body?.snapshot, req.body?.reality || {})).ok ? 200 : 409).json(r));
  app.post("/v1/icf/:workId/core-seal", coreAuth(SCOPES.WRITE_RUNBOOK), (req, res) => res.status((r=icf.issueCoreSeal(req.tenantId, req.params.workId)).ok ? 201 : 409).json(r));
  app.get("/v1/icf/:workId/ledger/verify", coreAuth(SCOPES.READ_EVIDENCE), (req, res) => { const ledger = icf.verifyLedger(req.tenantId, req.params.workId); res.status(ledger.valid ? 200 : 409).json({ ok: ledger.valid, ledger }); });

  app.get("/v1/runtime/hierarchy/status", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    res.json({ ok: true, tenant_id: req.tenantId, runtime: coreRuntimeHierarchyStatus(coreRuntime, coreRuntimeMode) });
  });

  app.post("/v1/runtime/hierarchy/evaluate", coreAuth(SCOPES.READ_DECISION), async (req, res) => {
    try {
      const rawInput = req.body?.core_input || req.body?.input;
      if (!rawInput || typeof rawInput !== "object") return publicError(res, 400, "core_runtime_input_required");
      const requestedTenant = String(rawInput.context?.tenant_id || "").trim();
      if (requestedTenant && requestedTenant !== req.tenantId) return publicError(res, 403, "tenant_scope_denied");
      const input = {
        ...rawInput,
        context: { ...(rawInput.context || {}), tenant_id: req.tenantId },
      };
      const result = await evaluateCoreRuntimeHierarchy(input, {
        worker: coreRuntime,
        mode: coreRuntimeMode,
        routing: req.body?.routing,
        ownerMode: options.coreRuntimeOwnerMode || "normal",
      });
      audit.append("core_runtime_hierarchy_evaluated", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        hierarchy_version: result.hierarchy_version,
        selected_authority: result.selected_authority,
        route: result.router.route,
        parity_matched: result.parity.matched,
      });
      return res.json({ ok: true, tenant_id: req.tenantId, result });
    } catch {
      return publicError(res, 400, "core_runtime_evaluation_failed");
    }
  });

  app.get("/v1/keys/presets", (req, res) => {
    res.json({ ok: true, presets: KEY_PRESETS });
  });

  app.post("/v1/keys/generate", requireAdmin, (req, res) => {
    try {
      const result = keyStore.createKey(req.body || {});
      res.status(201).json({ ok: true, ...result, warning: "La key in chiaro viene mostrata solo ora." });
    } catch (error) {
      publicError(res, 400, error.message || "key_generation_failed");
    }
  });

  app.get("/v1/keys", requireAdmin, (req, res) => {
    res.json({ ok: true, keys: keyStore.listKeys({ tenant_id: req.query.tenant_id }) });
  });

  app.post("/v1/keys/revoke", requireAdmin, (req, res) => {
    const record = keyStore.revokeKey(String(req.body?.key_id || ""), req.body?.status);
    if (!record) return publicError(res, 404, "key_not_found");
    return res.json({ ok: true, key: record });
  });

  app.post("/v1/setup-token/create", requireAdmin, (req, res) => {
    try {
      const body = req.body || {};
      const tenantInput = body.tenant && typeof body.tenant === "object" ? body.tenant : null;
      let tenant = null;
      if (tenantInput) {
        tenant = tenants.upsert({
          ...tenantInput,
          tenant_id: tenantInput.tenant_id || body.tenant_id,
          brand_scope: tenantInput.brand_scope || body.brand_scope,
          environment: tenantInput.environment || body.environment,
          active_branch_groups: tenantInput.active_branch_groups || body.branch_groups || body.active_branch_groups,
          active_branches: tenantInput.active_branches || body.branches || body.active_branches,
        });
        audit.append("core_tenant_upserted", { tenant_id: tenant.tenant_id, sector: tenant.sector, environment: tenant.environment, source: "setup_token_create" });
      }
      const result = setupTokens.create({
        ...body,
        tenant: tenant || tenantInput || body.tenant,
        tenant_id: body.tenant_id || tenant?.tenant_id,
        brand_scope: body.brand_scope || tenant?.brand_scope,
        environment: body.environment || tenant?.environment,
      });
      res.status(201).json({
        ok: true,
        setup_token: result.setup_token,
        token: result.record,
        tenant,
        warning: "Il setup token in chiaro viene mostrato solo ora e puo essere consumato una sola volta.",
      });
    } catch (error) {
      publicError(res, 400, error.message || "setup_token_create_failed");
    }
  });

  app.post("/v1/setup-token/consume", (req, res) => {
    const body = req.body || {};
    const consumed = setupTokens.consume(body.setup_token || body.token, {
      actor_id: body.actor_id,
      connector: body.connector || body.client,
      host: body.host,
    });
    if (!consumed.ok) return publicError(res, consumed.status || 400, consumed.error);

    try {
      const setupRecord = consumed.record;
      const keyResult = keyStore.createKey({
        tenant_id: setupRecord.tenant_id,
        brand_scope: setupRecord.brand_scope,
        key_type: setupRecord.key_type,
        preset: setupRecord.preset,
        label: setupRecord.label,
        tier: setupRecord.plan,
        suite_tier: setupRecord.plan,
        allowed_scopes: setupRecord.scopes,
        active_branches: setupRecord.branches,
        suite_modules: setupRecord.modules,
        suite_limits: setupRecord.limits,
        expires_at: setupRecord.key_expires_at,
        metadata: {
          tier: setupRecord.plan,
          suite_tier: setupRecord.plan,
          role: setupRecord.role,
          setup_token_id: setupRecord.token_id,
          active_branch_groups: setupRecord.branch_groups,
          active_branches: setupRecord.branches,
          suite_modules: setupRecord.modules,
          suite_limits: setupRecord.limits,
          environments: [setupRecord.environment].filter(Boolean),
          gate_mode: setupRecord.gate_mode,
          recommended_folders: setupRecord.recommended_folders,
          setup_policy: setupRecord.policy,
          setup_metadata: setupRecord.metadata,
        },
      });
      const tenant = tenants.get(setupRecord.tenant_id);
      const branchResolution = resolveBranchesForKey(keyResult.record);
      const entitlement = buildEntitlement(keyResult.record, branchResolution);
      const tenantPolicy = getTenantPolicy(setupRecord.tenant_id, setupRecord.plan, {
        brandScope: keyResult.record.brand_scope,
        metadata: keyResult.record.metadata,
      });
      const profile = buildBootstrapProfile({
        keyRecord: keyResult.record,
        tenant,
        tenantPolicy,
        branchResolution,
        entitlement,
      });
      audit.append("core_bootstrap_profile_issued", {
        tenant_id: setupRecord.tenant_id,
        key_id: keyResult.record.key_id,
        setup_token_id: setupRecord.token_id,
      });
      return res.json({
        ok: true,
        api_key: keyResult.key,
        key: keyResult.record,
        setup_token: setupRecord,
        profile,
        warning: "La API key in chiaro viene mostrata solo ora. Salvarla nel connector, non nel plugin pubblico.",
      });
    } catch (error) {
      audit.append("core_setup_token_consume_failed", {
        tenant_id: consumed.record?.tenant_id,
        token_id: consumed.record?.token_id,
        error: error.message || "key_generation_failed",
      });
      return publicError(res, 400, error.message || "setup_token_consume_failed");
    }
  });

  app.post("/v1/setup-token/revoke", requireAdmin, (req, res) => {
    const record = setupTokens.revoke(req.body?.token_id || req.body?.setup_token || req.body?.token, req.body?.reason);
    if (!record) return publicError(res, 404, "setup_token_not_found");
    return res.json({ ok: true, token: record });
  });

  app.get("/v1/setup-token/list", requireAdmin, (req, res) => {
    res.json({ ok: true, tokens: setupTokens.list({ tenant_id: req.query.tenant_id }) });
  });

  app.get("/v1/bootstrap/profile", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const entitlement = buildEntitlement(req.coreKey, branchResolution);
    const tenant = tenants.get(req.tenantId);
    const tenantPolicy = getTenantPolicy(req.tenantId, req.coreKey?.metadata?.tier, {
      brandScope: req.coreKey?.brand_scope,
      metadata: req.coreKey?.metadata,
    });
    const profile = buildBootstrapProfile({
      keyRecord: req.coreKey,
      tenant,
      tenantPolicy,
      branchResolution,
      entitlement,
    });
    audit.append("core_bootstrap_profile_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    return res.json(profile);
  });

  app.get("/v1/tenants/registry", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const all = tenants.list();
    const visible = hasScope(req.coreKey, SCOPES.ADMIN_TENANT)
      ? all
      : all.filter((tenant) => tenant.tenant_id === req.tenantId);
    audit.append("core_tenant_registry_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, count: visible.length });
    res.json({
      ok: true,
      tenants: visible,
      schema_version: "tenant_registry_v1",
      rule: "Universal Core resta agnostico: settore, dizionario e policy entrano dal tenant registry.",
    });
  });

  app.get("/v1/domain-packs", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const current = resolveDomainPackForKey(req.coreKey);
    audit.append("core_domain_pack_catalog_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, domain_pack_id: current.id });
    res.json({
      ok: true,
      schema_version: "core_domain_pack_catalog_v1",
      current: publicDomainPack(current),
      packs: listDomainPacks(),
      rule: "Il runtime e orizzontale; il Core risolve un solo domain pack dal tenant e impedisce override lato client.",
    });
  });

  app.get("/v1/domain-packs/current", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const current = resolveDomainPackForKey(req.coreKey);
    res.json({ ok: true, tenant_id: req.tenantId, domain_pack: publicDomainPack(current) });
  });

  app.get("/v1/nira/branches", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const current = resolveDomainPackForKey(req.coreKey);
    const rawCatalog = nyraBranchCatalog(current.id);
    const catalog = {
      ...rawCatalog,
      branches: extendCausalBranchRegistry(rawCatalog.branches),
      causal_context_schema_version: "causal_context_envelope_v1",
    };
    audit.append("core_nyra_branch_catalog_read", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      domain_pack_id: current.id,
      branch_count: catalog.branches.length,
    });
    res.json({ ok: true, tenant_id: req.tenantId, catalog });
  });

  app.post("/v1/research/plan", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    try {
      const plan = buildResearchPlan(req.body || {});
      const nyraNetwork = routeNyraBranches({
        text: plan.question,
        requestedBranches: plan.nyra_branches,
        domainPackId: domainPackAccess.pack.id,
      });
      audit.append("core_research_plan_created", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        plan_id: plan.plan_id,
        risk: plan.classification.risk,
        temporal: plan.classification.temporal,
        allowed_domain_count: plan.source_policy.allowed_domains.length,
      });
      return res.json({
        ok: true,
        tenant_id: req.tenantId,
        domain_pack: publicDomainPack(domainPackAccess.pack),
        research_plan: plan,
        nyra_neural_network: nyraNetwork,
        guardrail: {
          execution_allowed: false,
          browsing_performed: false,
          tenant_scoped_ingest_required: true,
          automatic_knowledge_promotion: false,
        },
      });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_plan_invalid");
    }
  });

  app.post("/v1/research/validate", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    try {
      const evidencePack = req.body?.evidence_pack && typeof req.body.evidence_pack === "object"
        ? req.body.evidence_pack
        : req.body || {};
      const validation = validateResearchEvidence(evidencePack);
      audit.append("core_research_evidence_validated", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        validation_id: validation.validation_id,
        state: validation.state,
        quality_score: validation.quality_score,
        source_count: validation.source_count,
        claim_count: validation.claim_assessments.length,
        prompt_injection_count: validation.threat_assessment.prompt_injection_count,
      });
      return res.json({
        ok: true,
        tenant_id: req.tenantId,
        domain_pack: publicDomainPack(domainPackAccess.pack),
        validation,
        guardrail: {
          execution_allowed: false,
          persistence_performed: false,
          automatic_validation_allowed: false,
          global_promotion_allowed: false,
        },
      });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_evidence_invalid");
    }
  });

  app.get("/v1/research/status", coreAuth(SCOPES.READ_EVIDENCE), (req, res) => {
    const status = researchRuntime.status(req.tenantId);
    return res.json({ ok: true, tenant_id: req.tenantId, status });
  });

  app.get("/v1/research/airlock/status", coreAuth(SCOPES.READ_EVIDENCE), async (req, res) => {
    try {
      const status = await researchAirlockRuntime.status(req.tenantId);
      return res.json({ ok: true, tenant_id: req.tenantId, status });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_airlock_status_failed");
    }
  });

  app.post("/v1/research/airlock/plan", coreAuth(SCOPES.WRITE_SNAPSHOT), async (req, res) => {
    try {
      const decision = await researchAirlockRuntime.createPlan(req.body || {}, { tenantId: req.tenantId, keyId: req.coreKey.key_id });
      audit.append("core_research_airlock_plan_issued", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        work_id: req.body?.work_binding?.work_id || null,
        plan_digest: decision.plan?.plan_digest || null,
        source_url_digests: decision.plan?.source_url_digests || [],
      });
      return res.status(201).json({ ok: true, tenant_id: req.tenantId, decision });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_airlock_plan_issue_failed");
    }
  });

  app.post("/v1/research/airlock/work", coreAuth(SCOPES.WRITE_SNAPSHOT), async (req, res) => {
    try {
      const work = await researchAirlockRuntime.createWork(req.body || {}, { tenantId: req.tenantId, keyId: req.coreKey.key_id });
      audit.append("core_research_airlock_work_created", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        work_id: work.work_id,
        state: work.state,
      });
      return res.status(201).json({ ok: true, tenant_id: req.tenantId, work });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_airlock_work_create_failed");
    }
  });

  app.post("/v1/research/airlock/discover", coreAuth(SCOPES.WRITE_SNAPSHOT), async (req, res) => {
    try {
      const decision = await researchAirlockRuntime.discover(req.body || {}, { tenantId: req.tenantId, keyId: req.coreKey.key_id });
      audit.append("core_research_airlock_discovery_decision", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        verdict: decision.verdict,
        reason: decision.reason || "research_airlock_fetch_verified",
        work_id: req.body?.work_binding?.work_id || null,
        fetch_id: decision.fetch_proof?.fetch_id || null,
      });
      return res.json({ ok: true, tenant_id: req.tenantId, decision });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_airlock_discovery_failed");
    }
  });

  app.post("/v1/research/airlock/seal", coreAuth(SCOPES.WRITE_SNAPSHOT), async (req, res) => {
    try {
      const decision = await researchAirlockRuntime.seal(req.body || {}, { tenantId: req.tenantId, keyId: req.coreKey.key_id });
      audit.append("core_research_airlock_evidence_sealed", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        work_id: req.body?.work_binding?.work_id || null,
        capsule_id: decision.capsule?.capsule_id || null,
      });
      return res.json({ ok: true, tenant_id: req.tenantId, decision });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_airlock_seal_failed");
    }
  });

  app.post("/v1/research/airlock/private-entry", coreAuth(SCOPES.WRITE_SNAPSHOT), async (req, res) => {
    try {
      const decision = await researchAirlockRuntime.enterPrivate(req.body || {}, { tenantId: req.tenantId, keyId: req.coreKey.key_id });
      audit.append("core_research_airlock_private_entry", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, work_id: req.body?.work_binding?.work_id || null, state: decision.state });
      return res.json({ ok: true, tenant_id: req.tenantId, decision });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_airlock_private_entry_failed");
    }
  });

  app.post("/v1/research/airlock/tool-authorize", coreAuth(SCOPES.WRITE_SNAPSHOT), async (req, res) => {
    try {
      const decision = await researchAirlockRuntime.authorizeTool(req.body || {}, { tenantId: req.tenantId, keyId: req.coreKey.key_id });
      return res.json({ ok: true, tenant_id: req.tenantId, decision });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_airlock_tool_authorization_failed");
    }
  });

  app.post("/v1/research/airlock/session-tool-authorize", coreAuth(SCOPES.WRITE_SNAPSHOT), async (req, res) => {
    try {
      const decision = await researchAirlockRuntime.authorizeSessionTool(req.body || {}, { tenantId: req.tenantId, keyId: req.coreKey.key_id });
      return res.json({ ok: true, tenant_id: req.tenantId, decision });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_airlock_session_tool_authorization_failed");
    }
  });

  app.post("/v1/research/airlock/complete", coreAuth(SCOPES.WRITE_SNAPSHOT), async (req, res) => {
    try {
      const decision = await researchAirlockRuntime.complete(req.body || {}, { tenantId: req.tenantId, keyId: req.coreKey.key_id });
      return res.json({ ok: true, tenant_id: req.tenantId, decision });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_airlock_complete_failed");
    }
  });

  app.get("/api/universal-core/research/status", coreAuth(SCOPES.READ_EVIDENCE), (req, res) => {
    const status = researchRuntime.status(req.tenantId);
    return res.json({ ok: true, tenant_id: req.tenantId, status });
  });

  app.get("/v1/research/source-registry", coreAuth(SCOPES.READ_EVIDENCE), (req, res) => {
    try {
      const payload = researchRuntime.registryForTenant(req.tenantId);
      return res.json({ ok: true, tenant_id: req.tenantId, ...payload });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_registry_failed");
    }
  });

  app.get("/v1/research/learning-packs", coreAuth(SCOPES.READ_EVIDENCE), (req, res) => {
    try {
      const branchId = String(req.query.branch_id || "").trim() || null;
      const payload = researchRuntime.branchPack(req.tenantId, branchId);
      return res.json({ ok: true, tenant_id: req.tenantId, ...payload });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_learning_pack_failed");
    }
  });

  app.post("/v1/research/envelope/authorize", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => {
    try {
      const question = String(req.body?.question || "").trim();
      if (!question) return publicError(res, 400, "research_question_required");
      const coreResearch = buildCoreResearchDirective({
        tenantId: req.tenantId,
        requestText: question,
        operationType: "research_distillation_shadow",
        evidenceState: {
          source_count: 0,
          confidence: 0,
          freshness_state: "unknown",
          evidence_gap: true,
        },
        selectedBranches: Array.isArray(req.body?.branch_ids) ? req.body.branch_ids : [],
        allowedDomains: [],
      });
      if (!coreResearch.directive) return publicError(res, 409, "research_core_directive_not_required");
      const payload = researchRuntime.authorizeEnvelope(req.body || {}, {
        tenantId: req.tenantId,
        coreDirective: coreResearch.directive,
      });
      return res.json({
        ok: true,
        tenant_id: req.tenantId,
        envelope: payload,
        core_directive: {
          directive_id: coreResearch.directive.directive_id,
          status: coreResearch.directive.status,
          research_execution_authorized: false,
          distillation_authorized: false,
        },
      });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_envelope_invalid");
    }
  });

  app.post("/v1/research/workspaces/open", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => {
    try {
      const workspace = researchRuntime.openWorkspace({
        tenant_id: req.tenantId,
        envelope_id: req.body?.envelope_id,
      });
      return res.status(201).json({ ok: true, tenant_id: req.tenantId, workspace });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_workspace_open_failed");
    }
  });

  app.post("/v1/research/workspaces/attach", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => {
    try {
      const workspaceId = String(req.body?.workspace_id || "").trim();
      if (!workspaceId) return publicError(res, 400, "research_workspace_id_required");
      const payload = researchRuntime.attachEvidence(workspaceId, {
        tenant_id: req.tenantId,
        evidence: Array.isArray(req.body?.evidence) ? req.body.evidence : [],
      });
      return res.json({ ok: true, tenant_id: req.tenantId, ...payload });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_workspace_attach_failed");
    }
  });

  app.post("/v1/research/workspaces/close", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => {
    try {
      const workspaceId = String(req.body?.workspace_id || "").trim();
      if (!workspaceId) return publicError(res, 400, "research_workspace_id_required");
      const workspace = researchRuntime.closeWorkspace(workspaceId, {
        tenant_id: req.tenantId,
      });
      return res.json({ ok: true, tenant_id: req.tenantId, workspace });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_workspace_close_failed");
    }
  });

  app.post("/v1/research/distill", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => {
    try {
      const workspaceId = String(req.body?.workspace_id || "").trim();
      if (!workspaceId) return publicError(res, 400, "research_workspace_id_required");
      const result = researchRuntime.distillCandidate(workspaceId, {
        tenant_id: req.tenantId,
        evidence: Array.isArray(req.body?.evidence) ? req.body.evidence : [],
        lesson: req.body?.lesson,
        learning: req.body?.learning,
        scope: req.body?.scope,
        confidence: req.body?.confidence,
        limitations: Array.isArray(req.body?.limitations) ? req.body.limitations : [],
        outcome_refs: Array.isArray(req.body?.outcome_refs) ? req.body.outcome_refs : [],
        persist_verified: req.body?.persist_verified === true,
        audit_reference: req.body?.audit_reference || null,
      });
      return res.json({ ok: true, tenant_id: req.tenantId, ...result });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_distillation_failed");
    }
  });

  app.post("/v1/research/cleanup", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => {
    try {
      const cleaned = researchRuntime.cleanupExpired({
        tenant_id: req.tenantId,
      });
      audit.append("core_research_cleanup_executed", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        cleaned,
      });
      return res.json({ ok: true, tenant_id: req.tenantId, cleanup: { cleaned } });
    } catch (error) {
      return publicError(res, error.status || 400, error.code || error.message || "research_cleanup_failed");
    }
  });

  app.post("/v1/work/preflight", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
    const galleryContext = normalizeTenantWorkGalleryContext(req.body?.gallery_context, req.tenantId);
    if (!galleryContext.ok) return publicError(res, 403, galleryContext.error);
    const requestText = String(req.body?.request || req.body?.message || req.body?.text || req.body?.task || req.body?.action_label || "").trim();
    if (!requestText) return publicError(res, 400, "work_preflight_request_required");
    if (requestText.length > 20_000) return publicError(res, 413, "work_preflight_request_too_long");
    if (req.body?.nyra_branches !== undefined && !Array.isArray(req.body.nyra_branches)) {
      return publicError(res, 400, "nyra_branches_must_be_array");
    }
    if (Array.isArray(req.body?.nyra_branches) && req.body.nyra_branches.length > MAX_NYRA_BRANCH_REQUESTS) {
      return publicError(res, 400, "nyra_branch_request_limit_exceeded");
    }
    const ownerBranches = verifiedOwnerBranchProfile(req, [], "work_preflight", ownerContextSigningSecret);
    const ownerProfileActive = ownerBranches.owner_profile === "tenant_scoped_verified_owner";
    const preflight = composeMandatoryWorkPreflight(req, {
      // A verified codexai OAuth owner gets a tenant-scoped registry profile;
      // this is not a commercial plan and it does not alter execution policy.
      domainPack: ownerProfileActive ? ownerBranches.domain_pack : domainPackAccess.pack,
      memoryContext: memoryContext.value,
      ...(ownerProfileActive ? { branchContext: ownerBranches } : {}),
      galleryContext: galleryContext.value,
    });
    audit.append("core_work_preflight_completed", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      preflight_id: preflight.preflight_id,
      state: preflight.state,
      memory_revision: preflight.memory_first.revision,
      selected_branches: preflight.core_route.selected_branches,
      preferred_route: preflight.tool_routing.preferred_route.id,
      owner_confirmation_required: preflight.governance.owner_confirmation_required,
      research_required: preflight.core_research.assessment.required,
      research_directive_id: preflight.core_research.directive?.directive_id || null,
    });
    return res.json({
      ok: true,
      tenant_id: req.tenantId,
      work_preflight: preflight,
      guardrail: {
        mandatory_before_work: true,
        execution_allowed: false,
        fail_closed_when_unavailable: true,
      },
    });
  });

  app.post("/v1/tenants/upsert", requireAdmin, (req, res) => {
    try {
      const tenant = tenants.upsert(req.body || {});
      audit.append("core_tenant_upserted", { tenant_id: tenant.tenant_id, sector: tenant.sector, environment: tenant.environment });
      res.status(201).json({ ok: true, tenant, schema_version: "tenant_registry_v1" });
    } catch (error) {
      publicError(res, 400, error.message || "tenant_upsert_failed");
    }
  });

  app.get("/v1/tenant/status", coreAuth(), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const advisoryActivation = verifiedOwnerAdvisoryActivation(
      req,
      "control_plane_read",
      ownerContextSigningSecret,
      { view: "tenant_status" },
    );
    const suitePolicy = buildSuitePolicy(req.coreKey, branchResolution);
    const entitlement = buildEntitlement(req.coreKey, branchResolution);
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      brand_scope: req.coreKey.brand_scope,
      key_id: req.coreKey.key_id,
      key_type: req.coreKey.key_type,
      tier: branchResolution.tier,
      active_branches: branchResolution.allowed_branches,
      active_branch_groups: branchResolution.allowed_groups,
      ...(advisoryActivation ? { owner_active_advisory: advisoryActivation } : {}),
      allowed_scopes: req.coreKey.allowed_scopes,
      status: req.coreKey.status,
      expires_at: req.coreKey.expires_at,
      last_used_at: req.coreKey.last_used_at,
      mode: "render_first_cortex_ready",
      entitlement,
      suite_policy: suitePolicy,
    });
  });

  app.get("/v1/entitlements/current", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const advisoryActivation = verifiedOwnerAdvisoryActivation(
      req,
      "control_plane_read",
      ownerContextSigningSecret,
      { view: "entitlements" },
    );
    const entitlement = buildEntitlement(req.coreKey, branchResolution);
    audit.append("core_entitlement_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, tier: entitlement.tier });
    res.json({ ok: true, entitlement, ...(advisoryActivation ? { owner_active_advisory: advisoryActivation } : {}) });
  });

  app.get("/v1/control-plane/overview", coreAuth(SCOPES.READ_CONTROL_PLANE), (req, res) => {
    const advisoryActivation = verifiedOwnerAdvisoryActivation(
      req,
      "control_plane_read",
      ownerContextSigningSecret,
      { view: "overview" },
    );
    const overview = buildControlPlaneOverview({
      tenantId: req.tenantId,
      keyRecord: req.coreKey,
      keyStore,
      snapshot: snapshots.latest(req.tenantId),
      auditEvents: audit.recent(200),
      evidenceEvents: evidence.recent(req.tenantId, 50),
    });
    audit.append("core_control_plane_overview_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    res.json({ ok: true, overview, ...(advisoryActivation ? { owner_active_advisory: advisoryActivation } : {}) });
  });

  app.get("/v1/control-plane/dashboard", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const advisoryActivation = verifiedOwnerAdvisoryActivation(
      req,
      "control_plane_read",
      ownerContextSigningSecret,
      { view: "dashboard" },
    );
    const entitlement = buildEntitlement(req.coreKey, branchResolution);
    const graph = entityGraph.readTenant(req.tenantId);
    const maturity = branchMaturityReport(advisoryActivation);
    const overview = buildControlPlaneOverview({
      tenantId: req.tenantId,
      keyRecord: req.coreKey,
      keyStore,
      snapshot: snapshots.latest(req.tenantId),
      auditEvents: audit.recent(200),
      evidenceEvents: evidence.recent(req.tenantId, 50),
    });
    const riskEntities = graph.entities.filter((entity) => ["medium", "high", "critical"].includes(entity.risk_band));
    audit.append("core_control_plane_dashboard_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    res.json({
      ok: true,
      schema_version: "horizontal_control_plane_dashboard_v1",
      tenant_id: req.tenantId,
      overview,
      entitlement,
      ...(advisoryActivation ? { owner_active_advisory: advisoryActivation } : {}),
      network_graph_summary: {
        entity_count: graph.entities.length,
        relation_count: graph.relations.length,
        risk_entity_count: riskEntities.length,
        entity_types: graph.entities.reduce((acc, entity) => {
          acc[entity.entity_type] = (acc[entity.entity_type] || 0) + 1;
          return acc;
        }, {}),
      },
      branch_maturity_summary: Object.values(maturity.statuses).reduce((acc, item) => {
        acc[item.maturity] = (acc[item.maturity] || 0) + 1;
        return acc;
      }, {}),
      action_mediation_states: ["allow", "rewrite", "confirm", "defer", "sandbox", "block", "rollback_required"],
      next_missing_blocks: [
        "external_enterprise_ui",
        "usage_metering_billing_webhook",
        "customer_self_service_connector_install",
        "tenant_policy_editor_ui",
      ],
    });
  });

  app.get("/v1/connectors/sdk/manifest", coreAuth(SCOPES.READ_CONTROL_PLANE), (req, res) => {
    audit.append("core_connector_sdk_manifest_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    res.json({ ok: true, tenant_id: req.tenantId, sdk: buildConnectorSdkManifest() });
  });

  app.get("/v1/translator/extractor/status", coreAuth(SCOPES.EXTRACT_CATALOG), (req, res) => {
    const binary = resolveExtractorBinaryPath({ allowBuild: false });
    audit.append("core_translation_extractor_status_read", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      binary_available: Boolean(binary),
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      extractor: {
        status: binary ? "ready" : "missing_binary",
        mode: "core_sidecar_process",
        binary: binary || extractorBinaryPath(),
        candidate_paths: extractorCandidatePaths(),
        lazy_build_enabled: process.env.SH_EXTRACTOR_ENABLE_LAZY_BUILD === "1" || (process.env.NODE_ENV !== "production" && process.env.SH_EXTRACTOR_DISABLE_LAZY_BUILD !== "1"),
        route: "/v1/translator/extractor/catalog",
        does_translate: false,
        publish_default: false,
      },
    });
  });

  app.post("/v1/translator/extractor/catalog", coreAuth(SCOPES.EXTRACT_CATALOG), (req, res) => {
    try {
      const extraction = runRustExtractorGovernor(storageRoot, req.body || {});
      const coreInput = buildExtractorCoreInput(req, extraction);
      const output = runUniversalCore(coreInput);
      const decisionContract = normalizeDecisionContract(output, {
        action_type: "translation_catalog_extraction",
        publish_intent: false,
      });
      const evidenceRecord = evidence.append(req.tenantId, "translation_catalog_extracted", {
        job_id: extraction.job_id,
        source_lang: textValue(req.body?.source_lang, "it"),
        target_lang: textValue(req.body?.target_lang, "en"),
        stats: extraction.stats,
        catalog_file: extraction.catalog_file,
        policy_file: extraction.policy_file,
        radar_file: extraction.radar_file,
        noise_file: extraction.noise_file,
        decision_contract: decisionContract,
        publish_allowed: false,
      });
      audit.append("core_translation_catalog_extracted", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        job_id: extraction.job_id,
        segment_count: extraction.stats.total,
        high_or_block: extraction.stats.high_or_block,
        evidence_id: evidenceRecord.evidence_id,
      });
      res.json({
        ok: true,
        tenant_id: req.tenantId,
        extractor: {
          job_id: extraction.job_id,
          mode: "rust_governor_inside_universal_core",
          does_translate: false,
          stdout: extraction.stdout,
          input: extraction.input,
          stats: extraction.stats,
        },
        catalog: {
          format: "jsonl",
          total: extraction.segments.length,
          segments: extraction.segments,
        },
        policy: extraction.policy,
        radar: extraction.radar,
        noise: extraction.noise,
        output,
        decision_contract: decisionContract,
        evidence: evidenceRecord,
        guardrail: {
          publish_allowed: false,
          execution_allowed: false,
          owner_confirmation_required: true,
          mode: "catalog_only_then_core_nyra_publish_safe_gate",
        },
      });
    } catch (error) {
      const code = error.message || "extractor_failed";
      const status = code === "extractor_binary_missing" ? 503 : code.includes("too_large") ? 413 : 400;
      audit.append("core_translation_extractor_failed", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        error: code,
      });
      publicError(res, status, code);
    }
  });

  app.get("/v1/customer-intelligence/contract", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const contract = buildCustomerIntelligenceContract({
      tenantId: req.tenantId,
      plan: req.coreKey?.metadata?.tier || req.coreKey?.preset || "",
      branches: branchResolution.selected_branches || [],
      scopes: req.coreKey?.allowed_scopes || [],
    });
    audit.append("core_customer_intelligence_contract_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    res.json({ ok: true, contract });
  });

  app.post("/v1/customer-intelligence/readiness", coreAuth(SCOPES.READ_DECISION, { requireWorkPreflight: true }), (req, res) => {
    const readiness = summarizeCustomerIntelligenceReadiness(req.body || {});
    audit.append("core_customer_intelligence_readiness_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      event_count: readiness.event_count,
      consent_count: readiness.consent_count,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      readiness,
      rule: "Readiness e solo valutazione: nessun invio automatico e nessuna modifica dati cliente.",
    });
  });

  app.get("/v1/runbooks", coreAuth(SCOPES.READ_CONTROL_PLANE), (req, res) => {
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      runbooks: suiteRunbookCatalog(),
      rule: "I runbook preparano e valutano automazioni. L'esecuzione resta bloccata finche Core non consente e l'owner conferma quando richiesto.",
    });
  });

  app.post("/v1/runbooks/evaluate", coreAuth(SCOPES.WRITE_RUNBOOK), (req, res) => {
    const runbookId = textValue(req.body?.runbook_id || req.body?.id);
    const runbook = suiteRunbookCatalog().find((item) => item.id === runbookId);
    if (!runbook) return publicError(res, 404, "runbook_not_found");

    const coreInput = {
      request_id: req.body?.request_id || `runbook_${crypto.randomUUID()}`,
      generated_at: nowIso(),
      domain: "core_automation_suite",
      context: {
        tenant_id: req.tenantId,
        actor_id: req.body?.actor_id || undefined,
        locale: req.body?.locale || "it",
        metadata: {
          action_type: runbook.action_type,
          runbook_id: runbook.id,
          source: "suite_runbook_marketplace",
        },
      },
      signals: [
        normalizeSignal({
          id: `runbook:${runbook.id}`,
          label: runbook.label,
          category: "automation_runbook",
          normalized_score: runbook.risk_hint,
          severity_hint: runbook.risk_hint,
          confidence_hint: 82,
          evidence: [
            { label: "Runbook approvato in catalogo", value: runbook.id },
            { label: "Esecuzione reale non inclusa in questo endpoint", value: true },
          ],
          tags: ["runbook", runbook.action_type],
        }),
      ],
      data_quality: {
        score: Number(req.body?.data_quality_score ?? 75),
        missing_fields: [],
      },
      constraints: safeConstraints({
        require_confirmation: true,
        max_control_level: "confirm",
        allow_automation: false,
        safety_mode: true,
        blocked_actions: ["execute_without_evidence", "cross_tenant_execution", "release_without_checksum"],
      }, req.coreKey, false),
    };
    const output = runUniversalCore(coreInput);
    const decisionContract = normalizeDecisionContract(output, { action_type: runbook.action_type, publish_intent: ["publish", "release"].includes(runbook.action_type) });
    const evidenceRecord = evidence.append(req.tenantId, "runbook_evaluated", {
      runbook,
      request: req.body || {},
      decision_contract: decisionContract,
      execution_allowed: false,
      rollback_possible: true,
    });
    audit.append("core_runbook_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      runbook_id: runbook.id,
      control_level: decisionContract.control_level,
      evidence_id: evidenceRecord.evidence_id,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      runbook,
      decision_contract: decisionContract,
      output,
      evidence: evidenceRecord,
      guardrail: {
        execution_allowed: false,
        owner_confirmation_required: true,
        mode: "evaluate_only_no_side_effects",
      },
    });
  });

  app.post("/v1/releases/manifest/check", coreAuth(SCOPES.POLICY_CHECK), (req, res) => {
    const result = evaluateReleaseManifest(req.body || {}, { tenant_id: req.tenantId });
    const evidenceRecord = evidence.append(req.tenantId, "release_manifest_checked", {
      result,
      rollback_possible: Boolean(result.manifest.rollback_url),
    });
    audit.append("core_release_manifest_checked", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      status: result.status,
      evidence_id: evidenceRecord.evidence_id,
    });
    res.json({ ok: true, tenant_id: req.tenantId, result, evidence: evidenceRecord });
  });

  app.get("/v1/evidence/recent", coreAuth(SCOPES.READ_EVIDENCE), (req, res) => {
    res.json({ ok: true, tenant_id: req.tenantId, evidence: evidence.recent(req.tenantId, Number(req.query.limit || 50)) });
  });

  app.get("/v1/ecosystem-pulse", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const pulse = buildEcosystemPulse({
      tenantId: req.tenantId,
      keyRecord: req.coreKey,
      snapshot: snapshots.latest(req.tenantId),
      auditEvents: audit.recent(200),
    });
    audit.append("core_ecosystem_pulse_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, risk_status: pulse.score.risk_status });
    res.json({ ok: true, pulse });
  });

  app.get("/v1/calibration/status", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    res.json({ ok: true, calibration: calibrationStatus() });
  });

  app.post("/v1/calibration/evaluate", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const result = calibrationEvaluate(req.body || {});
    audit.append("core_calibration_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      status: result.status,
      selected_variant: result.selected_variant?.id || null,
    });
    res.json({ ok: true, result });
  });

  function intelligenceResponse(req, res, analysisType, analyze) {
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 400, memoryContext.error);
    const result = analyze({ ...(req.body || {}), memory_context: memoryContext.value });
    audit.append("core_intelligence_analyzed", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      analysis_type: analysisType,
      schema_version: result.schema_version,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      result,
      memory_context: memoryContext.value ? {
        schema_version: memoryContext.value.schema_version,
        tenant_id: memoryContext.value.tenant_id,
        revision: memoryContext.value.revision,
        recalled: true,
      } : { tenant_id: req.tenantId, recalled: false },
      execution_allowed: false,
    });
  }

  app.post("/v1/intelligence/workflow", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    intelligenceResponse(req, res, "workflow", runIntelligenceWorkflow);
  });

  app.post("/v1/intelligence/scenarios", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    intelligenceResponse(req, res, "scenarios", analyzeScenarios);
  });

  app.post("/v1/intelligence/hypotheses/rank", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    if (!Array.isArray(req.body?.hypotheses) || !req.body.hypotheses.length) return publicError(res, 400, "hypotheses_required");
    intelligenceResponse(req, res, "hypothesis_ranking", rankHypotheses);
  });

  app.post("/v1/intelligence/events/evaluate", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    if (!Array.isArray(req.body?.events) || !req.body.events.length) return publicError(res, 400, "events_required");
    intelligenceResponse(req, res, "event_probability", evaluateEvents);
  });

  app.post("/v1/intelligence/counterfactuals/evaluate", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    if (!req.body?.baseline || !Array.isArray(req.body?.alternatives) || !req.body.alternatives.length) {
      return publicError(res, 400, "baseline_and_alternatives_required");
    }
    intelligenceResponse(req, res, "counterfactual_analysis", evaluateCounterfactuals);
  });

  app.post("/v1/intelligence/decisions/select", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const options = req.body?.options || req.body?.alternatives;
    if (!Array.isArray(options) || options.length < 2) return publicError(res, 400, "at_least_two_options_required");
    intelligenceResponse(req, res, "decision_selection", selectDecision);
  });

  app.post("/v1/intelligence/outcomes/verify", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    if (req.body?.predicted_probability === undefined && req.body?.prediction?.probability === undefined) {
      return publicError(res, 400, "predicted_probability_required");
    }
    if (req.body?.actual_outcome === undefined) return publicError(res, 400, "actual_outcome_required");
    intelligenceResponse(req, res, "outcome_verification", verifyOutcome);
  });

  app.post("/v1/intelligence/outcomes/record", coreAuth([SCOPES.WRITE_INTELLIGENCE_OUTCOME, SCOPES.WRITE_SNAPSHOT]), (req, res) => {
    if (!String(req.body?.outcome_id || "").trim()) return publicError(res, 400, "outcome_id_required");
    if (req.body?.predicted_probability === undefined && req.body?.prediction?.probability === undefined) {
      return publicError(res, 400, "predicted_probability_required");
    }
    if (req.body?.actual_outcome === undefined) return publicError(res, 400, "actual_outcome_required");
    if (![true, false, 0, 1, "occurred", "not_occurred"].includes(req.body.actual_outcome)) {
      return publicError(res, 400, "actual_outcome_invalid");
    }
    if (outcomeContainsSensitiveContent(req.body || {})) {
      audit.append("core_intelligence_outcome_sensitive_content_rejected", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
      });
      return publicError(res, 400, "outcome_sensitive_content_rejected");
    }
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 400, memoryContext.error);
    const dedicatedOutcomeScope = hasScope(req.coreKey, SCOPES.WRITE_INTELLIGENCE_OUTCOME);
    let outcomeAuthorization = null;
    {
      const trustedOwnerContext = hasScope(req.coreKey, SCOPES.OWNER_ASSERTION) && verifyOwnerContextAssertion(
        req.body?.owner_context,
        readSecret(req),
        req.tenantId,
        ownerRequestBinding("intelligence_outcome_record", req.body || {}),
      );
      const explicitAutomationConfirmation = req.body?.owner_confirmed === true &&
        req.coreKey?.key_type === "automation" && hasScope(req.coreKey, SCOPES.AUTOMATION_CODEX);
      const gateBody = {
        action_label: "Record tenant-scoped verified intelligence outcome",
        action_type: "outcome_record",
        operation_class: "verified_outcome_record",
        external_side_effect: false,
        contains_customer_data: false,
        contains_secret: false,
        secret_value_transmitted: false,
        cross_tenant: false,
        destructive: false,
        bypass_orchestrator: false,
        configuration_changes: false,
        rollback_ready: true,
        audit_ready: true,
        verified_outcome: true,
        live_weight_mutation: false,
        owner_confirmed: trustedOwnerContext || explicitAutomationConfirmation,
        confirmation_reference: trustedOwnerContext ? "signed_owner_context" : req.body?.confirmation_reference,
        target_tenant_id: req.tenantId,
        authenticated_tenant_id: req.tenantId,
        outcome_id: String(req.body.outcome_id).trim(),
        predicted_probability: req.body.predicted_probability ?? req.body.prediction?.probability,
        actual_outcome: req.body.actual_outcome,
        confirmation_outcome_id: String(req.body.outcome_id).trim(),
        confirmation_target_tenant_id: req.tenantId,
      };
      const riskClassification = classifyActionRisk(gateBody);
      const gateReq = Object.create(req);
      gateReq.body = gateBody;
      const output = runUniversalCore(buildActionEvaluatorInput(gateReq, req.coreKey));
      const decisionContract = applyActionRiskProfile(normalizeDecisionContract(output, {
        action_type: gateBody.action_type,
        publish_intent: false,
      }), riskClassification);
      outcomeAuthorization = buildActionAuthorization(decisionContract, gateBody);
      audit.append("core_intelligence_outcome_authorized", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        outcome_id: gateBody.outcome_id,
        authorization_state: outcomeAuthorization.state,
        confirmation_satisfied: outcomeAuthorization.confirmation_satisfied,
      });
      if (!outcomeAuthorization.allowed) {
        return res.status(403).json({
          ok: false,
          error: "outcome_record_not_authorized",
          authorization: outcomeAuthorization,
          decision_contract: decisionContract,
        });
      }
    }
    const verified = verifyOutcome({ ...(req.body || {}), memory_context: memoryContext.value });
    const stored = intelligenceOutcomes.append(req.tenantId, verified);
    if (stored.conflict) {
      audit.append("core_intelligence_outcome_conflict", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        outcome_id: stored.record.outcome_id,
      });
      return publicError(res, 409, "outcome_id_conflict", "The outcome_id already exists with different verified data.");
    }
    const calibration = intelligenceOutcomes.calibration(req.tenantId);
    const evidenceRecord = evidence.append(req.tenantId, "intelligence_outcome_recorded", {
      outcome_id: stored.record.outcome_id,
      prediction_id: stored.record.prediction_id,
      brier_score: stored.record.brier_score,
      duplicate: stored.duplicate,
    });
    audit.append("core_intelligence_outcome_recorded", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      outcome_id: stored.record.outcome_id,
      duplicate: stored.duplicate,
    });
    res.status(stored.duplicate ? 200 : 201).json({
      ok: true,
      tenant_id: req.tenantId,
      outcome: stored.record,
      duplicate: stored.duplicate,
      calibration,
      evidence: evidenceRecord,
      live_weight_mutation_enabled: false,
      authorization: outcomeAuthorization,
      legacy_scope_compatibility: !dedicatedOutcomeScope,
    });
  });

  app.get("/v1/intelligence/calibration", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const calibration = intelligenceOutcomes.calibration(req.tenantId);
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      calibration,
      recent_outcomes: intelligenceOutcomes.recent(req.tenantId, Number(req.query.limit || 20)),
    });
  });

  app.get("/v1/compliance/claim-shield/status", coreAuth(SCOPES.CLAIM_CHECK), (req, res) => {
    res.json({
      ok: true,
      claim_shield: {
        status: "advisory_ready",
        mode: "reference_registry_plus_brand_policy",
        hard_block: false,
        sources: claimShieldSources(),
        legal_guarantee: false,
        recommended_action: "Caricare policy claim del brand e usare check strutturato prima della pubblicazione.",
      },
    });
  });

  app.post("/v1/compliance/claim-shield/check", coreAuth(SCOPES.CLAIM_CHECK), (req, res) => {
    const result = claimShieldCheck(req.body || {});
    audit.append("core_claim_shield_checked", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, status: result.status, shield_status: result.shield_status });
    res.json({ ok: true, result });
  });

  function hostNativeFailure(res, error) {
    const code = String(error?.message || "host_native_governance_failed").slice(0, 200);
    const status = /(?:replayed|revision_conflict|already_exists|budget_exhausted|not_completable|not_reconcilable|idempotency_key_conflict)/.test(code)
      ? 409
      : /not_found/.test(code)
        ? 404
        : /(?:cross_tenant|not_active|expired|signature_invalid|owner_mismatch|host_session_mismatch)/.test(code)
          ? 403
          : /(?:store_lock_timeout|store_unavailable)/.test(code)
            ? 503
            : 400;
    return publicError(res, status, code);
  }

  function requireHostNativeGovernance(res) {
    if (hostNativeGovernance) return true;
    publicError(res, 503, "host_native_governance_unavailable", hostNativeGovernanceState);
    return false;
  }

  function verifyHostNativeOwnerConfirmation(req, purpose) {
    if (
      req.coreKey?.key_type !== "connector" ||
      !hasScope(req.coreKey, SCOPES.OWNER_ASSERTION) ||
      req.body?.owner_confirmed !== true
    ) {
      throw new Error("verified_owner_confirmation_required");
    }
    const context = req.body?.owner_context;
    if (
      !verifyOwnerContextAssertion(
        context,
        ownerContextSigningSecret,
        req.tenantId,
        ownerRequestBinding(purpose, req.body || {}),
      ) ||
      !PROVIDER_SETUP_LINK_OWNER_SUBJECT_PATTERN.test(String(context?.owner_subject_fingerprint || ""))
    ) {
      throw new Error("verified_owner_confirmation_required");
    }
    return {
      verified: true,
      request_bound: true,
      owner_subject_fingerprint: context.owner_subject_fingerprint,
      consent_nonce: String(context.assertion || ""),
      confirmation_reference: textValue(req.body?.confirmation_reference),
    };
  }

  app.post(
    "/v1/host-native/bootstrap/release-exceptions/prepare",
    coreAuth(SCOPES.AUTOMATION_CODEX),
    async (req, res) => {
      if (!requireHostNativeGovernance(res)) return;
      if (!hasScope(req.coreKey, SCOPES.OWNER_ASSERTION)) {
        return publicError(res, 403, "bootstrap_release_preparation_owner_scope_required");
      }
      if (!bootstrapReleasePreparationService) {
        return publicError(res, 503, "bootstrap_release_preparation_unavailable");
      }
      try {
        const body = req.body || {};
        const fields = Object.keys(body).sort();
        const expectedFields = ["normal_action_request", "owner_confirmation", "requested_ttl_seconds"];
        if (fields.length !== expectedFields.length || fields.some((field, index) => field !== expectedFields[index])) {
          throw new Error("bootstrap_release_preparation_request_schema_invalid");
        }
        if (!body.normal_action_request || body.normal_action_request.tenant_id !== req.tenantId) {
          throw new Error("tenant_scope_denied");
        }
        const ownerId = String(body.owner_confirmation?.owner_subject_fingerprint || "");
        const preparation = await bootstrapReleasePreparationService.prepare({
          authenticated_tenant_id: req.tenantId,
          authenticated_owner_id: ownerId,
          owner_confirmation: body.owner_confirmation,
          normal_action_request: {
            ...body.normal_action_request,
            tenant_id: req.tenantId,
          },
          requested_ttl_seconds: body.requested_ttl_seconds,
        });
        audit.append("core_bootstrap_release_exception_prepared", {
          tenant_id: req.tenantId,
          key_id: req.coreKey.key_id,
          work_id: preparation?.unsigned_receipt?.work_id || null,
          exception_id: preparation?.unsigned_receipt?.exception_id || null,
          action_authorized: false,
          core_join_authorized: false,
        });
        return res.status(201).json({
          ok: true,
          tenant_id: req.tenantId,
          preparation,
          action_authorized: false,
          merge_authorized: false,
          deploy_authorized: false,
          core_join_authorized: false,
        });
      } catch (error) {
        return hostNativeFailure(res, error);
      }
    },
  );

  app.get(
    "/v1/host-native/status",
    coreAuth(SCOPES.READ_DECISION),
    (_req, res) => res.json({
      ok: true,
      enabled: hostNativeGovernanceEnabled,
      state: hostNativeGovernanceState,
      configured: Boolean(hostNativeGovernance),
      store_backend: hostNativeGovernance?.storage?.kind || null,
      restart_durable: hostNativeGovernance?.storage?.restart_durable === true,
      distributed_store: hostNativeGovernance?.storage?.distributed === true,
      trusted_readback_configured:
        hostNativeGovernance?.trusted_readback_configured === true,
      release_join_verdict_resolver_configured:
        hostNativeGovernance?.release_join_verdict_resolver_configured === true,
      required_checks_policy_resolver_configured:
        hostNativeGovernance?.required_checks_policy_resolver_configured === true,
      closure_attestation_verifier_configured:
        hostNativeGovernance?.closure_attestation_verifier_configured === true,
      render_service_origin_resolver_configured:
        hostNativeGovernance?.render_service_origin_resolver_configured === true,
      resolver_configuration_valid: hostNativeResolverConfigurationValid,
      resolver_configuration_error: hostNativeResolverConfigurationError,
      github_credential_resolver_state:
        options.hostNativeGithubCredentialResolverState || "not_configured",
      github_credential_binding_count:
        Number(options.hostNativeGithubCredentialBindingCount || 0),
      render_origin_resolver_state: hostNativeRenderServiceOriginResolverState,
      render_origin_binding_count:
        Number(options.hostNativeRenderServiceOriginBindingCount || 0),
      required_checks_policy_resolver_state:
        options.hostNativeRequiredChecksPolicyResolverState || "not_configured",
      required_checks_policy_binding_count:
        Number(options.hostNativeRequiredChecksPolicyBindingCount || 0),
      tenant_github_credential_resolver_configured:
        typeof options.hostNativeGithubTokenResolver === "function",
      public_repository_readback_ready: true,
      private_repository_readback_ready:
        typeof options.hostNativeGithubTokenResolver === "function",
      caller_supplied_github_token_allowed: false,
      execution_adapter: "host_native",
      provider_execution: false,
      provider_api_key_required: false,
      persistent_store_required: true,
    }),
  );

  app.post(
    "/v1/host-native/work-plans",
    coreAuth(SCOPES.READ_DECISION),
    async (req, res) => {
      try {
        if (hostNativeGovernanceEnabled && !requireHostNativeGovernance(res)) return;
        const { tenant_id: _tenantId, ...input } = req.body || {};
        const plan = hostNativeGovernanceEnabled
          ? await hostNativeGovernance.buildWorkPlan({
            ...input,
            tenant_id: req.tenantId,
          })
          : buildHostNativeWorkPlan({ ...input, tenant_id: req.tenantId });
        audit.append("core_host_native_work_plan_built", {
          tenant_id: req.tenantId,
          key_id: req.coreKey.key_id,
          work_id: plan.work_id,
          plan_id: plan.plan_id,
          agent_count: plan.agents.length,
          maximum_parallel_agents: plan.maximum_parallel_agents,
        });
        return res.status(201).json({
          ok: true,
          tenant_id: req.tenantId,
          plan,
          governance_state: hostNativeGovernanceState,
        });
      } catch (error) {
        return hostNativeFailure(res, error);
      }
    },
  );

  app.post(
    "/v1/host-native/release-intents",
    coreAuth(SCOPES.READ_DECISION),
    (req, res) => {
      try {
        const { tenant_id: _tenantId, release_intent_digest: _callerDigest, ...input } =
          req.body || {};
        const releaseIntent = buildHostReleaseIntentV1({
          ...input,
          tenant_id: req.tenantId,
        });
        audit.append("core_host_native_release_intent_built", {
          tenant_id: req.tenantId,
          key_id: req.coreKey.key_id,
          work_id: releaseIntent.work_id,
          repository: releaseIntent.repository,
          release_intent_digest: releaseIntent.release_intent_digest,
        });
        return res.status(201).json({
          ok: true,
          tenant_id: req.tenantId,
          release_intent: releaseIntent,
        });
      } catch (error) {
        return hostNativeFailure(res, error);
      }
    },
  );

  app.post(
    "/v1/host-native/core-join-verdicts",
    coreAuth(SCOPES.AUTOMATION_CODEX, {
      tenantContextSigningSecret,
    }),
    async (req, res) => {
      if (!isMcpTenantGatewayRecord(req.coreKey)) {
        audit.append("core_host_native_core_join_gateway_denied", {
          tenant_id: req.tenantId,
          key_id: req.coreKey.key_id,
          reason: "mcp_tenant_gateway_required",
        });
        return publicError(res, 403, "core_join_mcp_gateway_required");
      }
      const assertedTenantId = String(req.get("x-sh-tenant-id") || "").trim();
      if (!assertedTenantId || assertedTenantId !== req.tenantId) {
        audit.append("core_host_native_core_join_gateway_denied", {
          tenant_id: req.tenantId,
          key_id: req.coreKey.key_id,
          reason: "tenant_context_mismatch",
        });
        return publicError(res, 403, "tenant_scope_denied");
      }
      if (!requireHostNativeGovernance(res)) return;
      try {
        const { tenant_id: _tenantId, ...input } = req.body || {};
        const coreJoinVerdict = await hostNativeGovernance.issueCoreJoinVerdict({
          ...input,
          tenant_id: req.tenantId,
        });
        audit.append("core_host_native_core_join_issued", {
          tenant_id: req.tenantId,
          key_id: req.coreKey.key_id,
          verdict_id: coreJoinVerdict.verdict.verdict_id,
          work_id: coreJoinVerdict.verdict.work_id,
          target_commit: coreJoinVerdict.verdict.checks.commit,
        });
        return res.status(201).json({
          ok: true,
          tenant_id: req.tenantId,
          core_join_verdict: coreJoinVerdict,
        });
      } catch (error) {
        return hostNativeFailure(res, error);
      }
    },
  );

  const genericWorkCoreJoinUnavailableCode = () => {
    if (genericWorkCoreJoinConfigurationError) return genericWorkCoreJoinConfigurationError;
    if (!genericWorkCoreJoinEnabled) return "generic_work_core_join_disabled";
    if (!genericWorkCoreJoinSigner) {
      return genericWorkCoreJoinSafeReason(genericWorkCoreJoinSignerReason, "generic_work_core_join_signing_unavailable");
    }
    if (!dttAgentIdentitySecret) return "generic_work_core_join_verifier_unavailable";
    if (genericWorkCoreJoinStore?.restart_durable !== true) return "generic_work_core_join_durable_store_unavailable";
    if (genericWorkCoreJoinProduction && genericWorkCoreJoinStore?.distributed !== true) {
      return "generic_work_core_join_distributed_store_unavailable";
    }
    if (genericWorkCoreJoinStoreState === "failed") {
      return genericWorkCoreJoinStoreError || "generic_work_core_join_durable_store_unavailable";
    }
    return "generic_work_core_join_signing_unavailable";
  };
  const genericWorkCoreJoinFailureStatus = (code) => genericWorkCoreJoinInfrastructureCode(code) ? 503 : 409;

  const issueGenericWorkCoreJoin = async (req, res) => {
      if (!isMcpTenantGatewayRecord(req.coreKey)) return publicError(res, 403, "core_join_mcp_gateway_required");
      const assertedTenantId = String(req.get("x-sh-tenant-id") || "").trim();
      if (!assertedTenantId || assertedTenantId !== req.tenantId) return publicError(res, 403, "tenant_scope_denied");
      if (!genericWorkCoreJoinAuthority) return publicError(res, 503, genericWorkCoreJoinUnavailableCode());
      let issueSequence = 0;
      try {
        await genericWorkCoreJoinStoreInitialization;
        if (genericWorkCoreJoinStoreState !== "ready") return publicError(res, 503, "generic_work_core_join_durable_store_unavailable");
        if (genericWorkCoreJoinProduction && genericWorkCoreJoinStore?.distributed !== true) {
          return publicError(res, 503, "generic_work_core_join_distributed_store_unavailable");
        }
        if (!genericWorkCoreJoinSignerFailureLatched
            && !await ensureGenericWorkCoreJoinSignerReady()) {
          return publicError(res, 503, genericWorkCoreJoinSafeReason(
            genericWorkCoreJoinSignerReason,
            "generic_work_core_join_signer_not_yet_verified",
          ));
        }
        issueSequence = ++genericWorkCoreJoinIssueSequence;
        const { tenant_id: _tenantId, work_id: _callerWorkId, ...input } = req.body || {};
        const issuance = await genericWorkCoreJoinAuthority.issueDetailed({
          ...input,
          tenant_id: req.tenantId,
          work_id: req.genericWorkCoreJoinWorkId,
        });
        const verdict = issuance.verdict;
        genericWorkCoreJoinVerifier.verify({ verdict, expected: { tenant_id: req.tenantId, work_id: verdict.work_id, adapter: verdict.adapter, idempotency_digest: verdict.idempotency_digest } });
        if (issuance.fresh_signature_verified === true && issuance.durable_record_verified === true) {
          genericWorkCoreJoinSignerRecoverySequence = Math.max(genericWorkCoreJoinSignerRecoverySequence, issueSequence);
          if (issueSequence > genericWorkCoreJoinSignerFailureSequence) {
            genericWorkCoreJoinSignerFailureLatched = false;
            genericWorkCoreJoinSignerState = "ready";
            genericWorkCoreJoinSignerReason = null;
          }
        }
        audit.append("core_generic_work_core_join_issued", { tenant_id: req.tenantId, key_id: req.coreKey.key_id,
          work_id: verdict.work_id, verdict_id: verdict.verdict_id, adapter: verdict.adapter });
        return res.status(201).json({ ok: true, verdict });
      } catch (error) {
        const code = genericWorkCoreJoinSafeReason(error, "generic_work_core_join_denied");
        if (genericWorkCoreJoinStoreInfrastructureCode(code)) {
          genericWorkCoreJoinStoreState = "failed";
          genericWorkCoreJoinStoreError = code;
        }
        const signerCode = genericWorkCoreJoinSignerInfrastructureCode(code);
        if (signerCode) {
          genericWorkCoreJoinSignerFailureSequence = Math.max(genericWorkCoreJoinSignerFailureSequence, issueSequence);
          if (issueSequence > genericWorkCoreJoinSignerRecoverySequence) {
            genericWorkCoreJoinSignerFailureLatched = true;
            genericWorkCoreJoinSignerState = genericWorkCoreJoinSignerRejectedCodes.has(signerCode) ? "rejected" : "unavailable";
            genericWorkCoreJoinSignerReason = signerCode;
          }
        }
        return publicError(res, genericWorkCoreJoinFailureStatus(code), code);
      }
    };

  app.post(
    "/v1/work-continuity/generic-core-join",
    coreAuth(SCOPES.AUTOMATION_CODEX, { tenantContextSigningSecret }),
    genericWorkCoreJoinContextAuth,
    issueGenericWorkCoreJoin,
  );
  app.post(
    "/v1/work/core-join-verdicts",
    coreAuth(SCOPES.AUTOMATION_CODEX, { tenantContextSigningSecret }),
    genericWorkCoreJoinContextAuth,
    issueGenericWorkCoreJoin,
  );

  app.get(
    "/v1/host-native/core-join-verdicts/:verdictId",
    coreAuth(SCOPES.READ_DECISION),
    async (req, res) => {
      if (!requireHostNativeGovernance(res)) return;
      try {
        const coreJoinVerdict = await hostNativeGovernance.readCoreJoinVerdict({
          tenant_id: req.tenantId,
          verdict_id: req.params.verdictId,
        });
        return res.json({
          ok: true,
          tenant_id: req.tenantId,
          core_join_verdict: coreJoinVerdict,
        });
      } catch (error) {
        return hostNativeFailure(res, error);
      }
    },
  );

  app.post(
    "/v1/host-native/delegations",
    coreAuth(SCOPES.OWNER_ASSERTION),
    async (req, res) => {
      if (!requireHostNativeGovernance(res)) return;
      try {
        const ownerConfirmation = verifyHostNativeOwnerConfirmation(
          req,
          "host_native_delegation_issue",
        );
        const {
          tenant_id: _tenantId,
          owner_context: _ownerContext,
          owner_confirmed: _ownerConfirmed,
          owner_confirmation: _ownerConfirmation,
          confirmation_reference: _confirmationReference,
          ...input
        } = req.body || {};
        if (!ownerConfirmation.confirmation_reference) {
          throw new Error("confirmation_reference_invalid");
        }
        const record = await hostNativeGovernance.issueDelegation({
          ...input,
          tenant_id: req.tenantId,
          owner_confirmation: ownerConfirmation,
        });
        audit.append("core_host_native_delegation_issued", {
          tenant_id: req.tenantId,
          key_id: req.coreKey.key_id,
          delegation_id: record.delegation_id,
          work_id: record.grant.work_id,
          expires_at: record.grant.expires_at,
        });
        return res.status(201).json({ ok: true, tenant_id: req.tenantId, delegation: record });
      } catch (error) {
        return hostNativeFailure(res, error);
      }
    },
  );

  app.get(
    "/v1/host-native/delegations/:delegationId",
    coreAuth(SCOPES.READ_DECISION),
    async (req, res) => {
      if (!requireHostNativeGovernance(res)) return;
      try {
        const delegation = await hostNativeGovernance.readDelegation({
          tenant_id: req.tenantId,
          delegation_id: req.params.delegationId,
        });
        return res.json({ ok: true, tenant_id: req.tenantId, delegation });
      } catch (error) {
        return hostNativeFailure(res, error);
      }
    },
  );

  app.post(
    "/v1/host-native/delegations/:delegationId/revoke",
    coreAuth(SCOPES.OWNER_ASSERTION),
    async (req, res) => {
      if (!requireHostNativeGovernance(res)) return;
      try {
        const ownerConfirmation = verifyHostNativeOwnerConfirmation(
          req,
          "host_native_delegation_revoke",
        );
        if (!ownerConfirmation.confirmation_reference) {
          throw new Error("confirmation_reference_invalid");
        }
        const delegation = await hostNativeGovernance.revokeDelegation({
          tenant_id: req.tenantId,
          delegation_id: req.params.delegationId,
          owner_confirmation: ownerConfirmation,
          idempotency_key: req.body?.idempotency_key,
        });
        audit.append("core_host_native_delegation_revoked", {
          tenant_id: req.tenantId,
          key_id: req.coreKey.key_id,
          delegation_id: delegation.delegation_id,
        });
        return res.json({ ok: true, tenant_id: req.tenantId, delegation });
      } catch (error) {
        return hostNativeFailure(res, error);
      }
    },
  );

  app.post(
    "/v1/host-native/actions/authorize",
    coreAuth(SCOPES.AUTOMATION_CODEX),
    async (req, res) => {
      if (!requireHostNativeGovernance(res)) return;
      try {
        const { tenant_id: _tenantId, ...input } = req.body || {};
        const actionTicket = await hostNativeGovernance.issueActionTicket({
          ...input,
          tenant_id: req.tenantId,
        });
        audit.append("core_host_native_action_ticket_issued", {
          tenant_id: req.tenantId,
          key_id: req.coreKey.key_id,
          ticket_id: actionTicket.ticket.ticket_id,
          delegation_id: actionTicket.ticket.delegation_id,
          action_kind: actionTicket.ticket.action.kind,
        });
        return res.status(201).json({ ok: true, tenant_id: req.tenantId, action_ticket: actionTicket });
      } catch (error) {
        return hostNativeFailure(res, error);
      }
    },
  );

  app.get(
    "/v1/host-native/actions/:ticketId",
    coreAuth(SCOPES.READ_DECISION),
    async (req, res) => {
      if (!requireHostNativeGovernance(res)) return;
      try {
        const actionTicket = await hostNativeGovernance.readActionTicket({
          tenant_id: req.tenantId,
          ticket_id: req.params.ticketId,
        });
        return res.json({ ok: true, tenant_id: req.tenantId, action_ticket: actionTicket });
      } catch (error) {
        return hostNativeFailure(res, error);
      }
    },
  );

  for (const [suffix, method] of [
    ["reserve", "reserveActionTicket"],
    ["complete", "completeActionTicket"],
    ["reconcile", "reconcileActionTicket"],
  ]) {
    app.post(
      `/v1/host-native/actions/:ticketId/${suffix}`,
      coreAuth(SCOPES.AUTOMATION_CODEX),
      async (req, res) => {
        if (!requireHostNativeGovernance(res)) return;
        try {
          const { tenant_id: _tenantId, ticket_id: _ticketId, ...input } = req.body || {};
          const actionTicket = await hostNativeGovernance[method]({
            ...input,
            tenant_id: req.tenantId,
            ticket_id: req.params.ticketId,
          });
          audit.append(`core_host_native_action_${suffix}`, {
            tenant_id: req.tenantId,
            key_id: req.coreKey.key_id,
            ticket_id: req.params.ticketId,
            state: actionTicket.state,
          });
          return res.json({ ok: true, tenant_id: req.tenantId, action_ticket: actionTicket });
        } catch (error) {
          return hostNativeFailure(res, error);
        }
      },
    );
  }

  app.post(
    "/v1/host-native/actions/:ticketId/observe-unreserved",
    coreAuth(SCOPES.AUTOMATION_CODEX),
    async (req, res) => {
      if (!requireHostNativeGovernance(res)) return;
      try {
        const { tenant_id: _tenantId, ticket_id: _ticketId, ...input } = req.body || {};
        const actionTicket = await hostNativeGovernance.observeUnreservedActionEffect({
          ...input,
          tenant_id: req.tenantId,
          ticket_id: req.params.ticketId,
        });
        audit.append("core_host_native_action_observed_unreserved", {
          tenant_id: req.tenantId,
          key_id: req.coreKey.key_id,
          ticket_id: req.params.ticketId,
          classification: actionTicket.protocol_deviation?.classification || "BLOCKED",
        });
        return res.json({ ok: true, tenant_id: req.tenantId, action_ticket: actionTicket });
      } catch (error) {
        return hostNativeFailure(res, error);
      }
    },
  );

  app.post(
    "/v1/host-native/actions/:ticketId/authorize-finalize",
    coreAuth(SCOPES.AUTOMATION_CODEX),
    async (req, res) => {
      if (!requireHostNativeGovernance(res)) return;
      try {
        const finalizeAuthorization = await hostNativeGovernance.authorizeFinalize({
          tenant_id: req.tenantId,
          ticket_id: req.params.ticketId,
          host_session_fingerprint: req.body?.host_session_fingerprint,
        });
        audit.append("core_host_native_finalize_authorized", {
          tenant_id: req.tenantId,
          key_id: req.coreKey.key_id,
          ticket_id: req.params.ticketId,
          target_commit: finalizeAuthorization.target_commit,
          outcome_source: finalizeAuthorization.outcome_source,
        });
        return res.json({
          ok: true,
          tenant_id: req.tenantId,
          finalize_authorization: finalizeAuthorization,
        });
      } catch (error) {
        return hostNativeFailure(res, error);
      }
    },
  );
  const policyRegistryRouteContract = Object.freeze({
    activate: Object.freeze([
      "tenant_id", "work_id", "operation_id", "domain_pack_id", "work_preflight",
      "owner_confirmed", "confirmation_reference", "owner_context", "snapshot",
      "compiler_input",
    ]),
    rollback: Object.freeze([
      "tenant_id", "work_id", "operation_id", "domain_pack_id", "work_preflight",
      "owner_confirmed", "confirmation_reference", "owner_context", "target_snapshot_digest",
    ]),
    reconcile: Object.freeze([
      "tenant_id", "work_id", "operation_id", "work_preflight", "owner_confirmed",
      "confirmation_reference", "owner_context",
    ]),
  });
  const policyRegistryRoutePurpose = Object.freeze({
    activate: "nyra_policy_registry_snapshot_activate_v3",
    rollback: "nyra_policy_registry_snapshot_rollback_v3",
    reconcile: "nyra_policy_registry_snapshot_reconcile_v3",
  });

  function exactPolicyRegistryRouteBody(req, kind) {
    const body = req.body;
    const fields = policyRegistryRouteContract[kind];
    if (!isPlainRecord(body) || !fields ||
      Object.keys(body).sort().join("\0") !== [...fields].sort().join("\0")) {
      throw new Error("policy_registry_request_schema_invalid");
    }
    if (body.tenant_id !== req.tenantId || body.work_id !== req.workId) {
      throw new Error("policy_registry_request_scope_invalid");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/.test(String(body.operation_id || "")) ||
      body.owner_confirmed !== true ||
      !String(body.confirmation_reference || "").trim()) {
      throw new Error("policy_registry_request_invalid");
    }
    if (kind !== "reconcile" &&
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/.test(String(body.domain_pack_id || ""))) {
      throw new Error("policy_registry_request_invalid");
    }
    const action = `policy.snapshot.${kind}`;
    if (req.workPreflight?.request?.operation_type !== action ||
      (kind !== "reconcile" && req.workPreflight?.domain_pack?.id !== body.domain_pack_id)) {
      throw new Error("policy_registry_preflight_binding_invalid");
    }
    if (kind === "activate" && (
      !isPlainRecord(body.snapshot) ||
      Object.hasOwn(body.snapshot, "policy_registry_attestation") ||
      Object.hasOwn(body.snapshot, "activation_attestation")
    )) {
      throw new Error("policy_registry_snapshot_not_pure");
    }
    if (kind === "activate") {
      const validation = validatePolicySnapshot(body.snapshot, {
        tenant_id: req.tenantId,
        core_branch_id: "nyra_policy_registry",
        nyra_branch_id: "risk_governance",
        domain_pack_id: body.domain_pack_id,
        now: new Date(),
      });
      if (!validation.ok) throw new Error("policy_registry_snapshot_invalid");
      if (!isPlainRecord(body.compiler_input) ||
        !nyraPolicyRegistryCompilerProvenanceVerifier ||
        !nyraPolicyRegistryCompilerReady) {
        throw new Error("policy_registry_compiler_unavailable");
      }
      const compilerProvenance =
        nyraPolicyRegistryCompilerProvenanceVerifier.verify({
          tenant_id: req.tenantId,
          domain_pack_id: body.domain_pack_id,
          snapshot: body.snapshot,
          compiler_input: body.compiler_input,
        });
      const compilerVerification =
        nyraPolicyRegistryCompilerProvenanceVerifier.verifyPersistedRecord(
          compilerProvenance,
          {
            tenant_id: req.tenantId,
            domain_pack_id: body.domain_pack_id,
            snapshot_digest: body.snapshot.snapshot_digest,
            compiler_provenance_digest: compilerProvenance?.provenance_digest,
          },
        );
      const compilerVerificationFields = [
        "ok", "record_integrity_verified", "derivation_reverified", "tenant_id",
        "domain_pack_id", "snapshot_digest", "compiler_provenance_digest",
        "compiler_build_commit", "catalog_digest", "trust_catalog_digest",
        "execution_authorized", "error",
      ];
      const compilerVerificationKeys = isPlainRecord(compilerVerification)
        ? Reflect.ownKeys(compilerVerification)
        : [];
      const compilerVerificationExact = isPlainRecord(compilerVerification) &&
        Object.getPrototypeOf(compilerVerification) === Object.prototype &&
        compilerVerificationKeys.length === compilerVerificationFields.length &&
        compilerVerificationKeys.every((key) => typeof key === "string") &&
        compilerVerificationFields.every((field) => {
          const descriptor = Object.getOwnPropertyDescriptor(compilerVerification, field);
          return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
        });
      if (!compilerVerificationExact ||
        compilerVerification.ok !== true ||
        compilerVerification.record_integrity_verified !== true ||
        compilerVerification.derivation_reverified !== false ||
        compilerVerification.tenant_id !== req.tenantId ||
        compilerVerification.domain_pack_id !== body.domain_pack_id ||
        compilerVerification.snapshot_digest !== body.snapshot.snapshot_digest ||
        compilerVerification.compiler_provenance_digest !==
          compilerProvenance?.provenance_digest ||
        compilerVerification.compiler_build_commit !==
          compilerProvenance?.compiler_build_commit ||
        compilerVerification.compiler_build_commit !==
          nyraPolicyRegistryCompilerStatus?.compiler_build_commit ||
        (nyraPolicyRegistryProofProduction &&
          compilerVerification.compiler_build_commit !== BUILD_COMMIT_SHA) ||
        compilerVerification.catalog_digest !== compilerProvenance?.catalog_digest ||
        compilerVerification.catalog_digest !== nyraPolicyRegistryExpectedCatalogDigest ||
        compilerVerification.catalog_digest !==
          nyraPolicyRegistryCompilerStatus?.catalog_digest ||
        compilerVerification.trust_catalog_digest !==
          compilerProvenance?.trust_catalog_digest ||
        compilerVerification.trust_catalog_digest !==
          nyraPolicyRegistryExpectedTrustCatalogDigest ||
        compilerVerification.trust_catalog_digest !==
          nyraPolicyRegistryCompilerStatus?.trust_catalog_digest ||
        compilerVerification.execution_authorized !== false ||
        compilerVerification.error !== null) {
        throw new Error("policy_compiler_provenance_invalid");
      }
    }
    return body;
  }

  function authorizePolicyRegistryMutation(req, kind, body) {
    if (!nyraPolicyRegistryCoordinator) throw new Error("policy_registry_coordinator_unavailable");
    const purpose = policyRegistryRoutePurpose[kind];
    const owner = verifyHostNativeOwnerConfirmation(req, purpose);
    const action = `policy.snapshot.${kind}`;
    const authorization = buildActionAuthorization({
      state: "attention",
      risk_band: "high",
      control_level: "confirm",
      recommended_actions: [{ blocked: false }],
    }, {
      action_type: action,
      operation_class: "policy_registry_snapshot_mutation",
      authenticated_tenant_id: req.tenantId,
      tenant_id: req.tenantId,
      owner_confirmed: true,
      request_bound_owner_confirmation: owner.request_bound === true,
      owner_context_verified: owner.verified === true,
      work_preflight_ready: Boolean(req.workPreflight?.preflight_id),
      external_side_effect: false,
      configuration_changes: true,
      provider_execution: false,
      contains_secret: false,
      secret_value_transmitted: false,
      cross_tenant: false,
      bypass_orchestrator: false,
      destructive: false,
      rollback_ready: true,
      audit_ready: true,
      confirmation_reference: owner.confirmation_reference,
    });
    if (authorization.allowed !== true ||
      authorization.scope !== "policy_registry_snapshot_mutation" ||
      authorization.confirmation_satisfied !== true) {
      throw new Error("policy_registry_core_authorization_denied");
    }
    const snapshotDigest = kind === "activate"
      ? String(body.snapshot?.snapshot_digest || "")
      : kind === "rollback" ? String(body.target_snapshot_digest || "") : null;
    const compilerInputDigest = kind === "activate"
      ? crypto.createHash("sha256")
          .update(JSON.stringify(stableCanonical(body.compiler_input)))
          .digest("hex")
      : null;
    const authorizationDigest = crypto.createHash("sha256")
      .update(`nyra-policy-registry-core-authorization-v2\0${JSON.stringify(stableCanonical({
        tenant_id: req.tenantId,
        work_id: req.workId,
        preflight_id: req.workPreflight.preflight_id,
        operation_id: body.operation_id,
        action,
        domain_pack_id: body.domain_pack_id || null,
        snapshot_digest: snapshotDigest,
        compiler_input_digest: compilerInputDigest,
        authorization,
      }))}`)
      .digest("hex");
    return {
      owner,
      authorization,
      authorizationDigest,
      ownerRequestBinding: ownerRequestBinding(purpose, body),
    };
  }

  const policyRegistrySafeRouteErrors = new Map([
    ["verified_owner_confirmation_required", [403, "policy_registry_owner_confirmation_required"]],
    ["policy_registry_owner_binding_invalid", [403, "policy_registry_owner_confirmation_required"]],
    ["policy_registry_core_authorization_denied", [403, "policy_registry_core_authorization_denied"]],
    ["policy_registry_request_scope_invalid", [403, "policy_registry_request_scope_invalid"]],
    ["policy_proof_tenant_denied", [403, "policy_proof_tenant_denied"]],
    ["policy_proof_work_binding_invalid", [403, "policy_proof_work_binding_invalid"]],
    ["policy_registry_request_schema_invalid", [400, "policy_registry_request_schema_invalid"]],
    ["policy_registry_request_invalid", [400, "policy_registry_request_invalid"]],
    ["policy_registry_preflight_binding_invalid", [400, "policy_registry_preflight_binding_invalid"]],
    ["policy_registry_snapshot_not_pure", [400, "policy_registry_snapshot_not_pure"]],
    ["policy_registry_snapshot_invalid", [400, "policy_registry_snapshot_invalid"]],
    ["policy_registry_authorization_digest_invalid", [400, "policy_registry_authorization_digest_invalid"]],
    ["policy_compiler_input_invalid", [400, "policy_compiler_input_invalid"]],
    ["policy_compiler_input_oversize", [400, "policy_compiler_input_oversize"]],
    ["policy_compiler_input_leaf_invalid", [400, "policy_compiler_input_leaf_invalid"]],
    ["policy_compiler_input_pack_invalid", [400, "policy_compiler_input_pack_invalid"]],
    ["policy_compiler_input_pack_status_invalid", [400, "policy_compiler_input_pack_status_invalid"]],
    ["policy_compiler_input_signature_invalid", [400, "policy_compiler_input_signature_invalid"]],
    ["policy_compiler_input_noncanonical", [400, "policy_compiler_input_noncanonical"]],
    ["policy_compiler_constraints_invalid", [400, "policy_compiler_constraints_invalid"]],
    ["policy_compiler_verify_input_invalid", [400, "policy_compiler_verify_input_invalid"]],
    ["policy_compiler_tenant_invalid", [400, "policy_compiler_tenant_invalid"]],
    ["policy_compiler_domain_invalid", [400, "policy_compiler_domain_invalid"]],
    ["policy_compiler_domain_untrusted", [400, "policy_compiler_domain_untrusted"]],
    ["policy_compiler_snapshot_invalid", [400, "policy_compiler_snapshot_invalid"]],
    ["policy_compiler_snapshot_mismatch", [400, "policy_compiler_snapshot_mismatch"]],
    ["policy_compiler_pack_set_mismatch", [400, "policy_compiler_pack_set_mismatch"]],
    ["policy_compiler_root_unverified", [400, "policy_compiler_root_unverified"]],
    ["policy_compiler_signature_quorum_invalid", [400, "policy_compiler_signature_quorum_invalid"]],
    ["policy_compiler_provenance_invalid", [400, "policy_compiler_provenance_invalid"]],
    ["nyra_policy_compiler_provenance_invalid", [400, "policy_compiler_provenance_invalid"]],
    ["policy_proof_binding_invalid", [400, "policy_proof_binding_invalid"]],
    ["policy_proof_attestation_invalid", [400, "policy_proof_attestation_invalid"]],
    ["policy_activation_core_receipt_invalid", [400, "policy_activation_core_receipt_invalid"]],
    ["policy_snapshot_signature_quorum_invalid", [400, "policy_snapshot_signature_quorum_invalid"]],
    ["policy_proof_not_found", [404, "policy_proof_not_found"]],
    ["policy_proof_consumption_not_found", [404, "policy_proof_consumption_not_found"]],
    ["policy_rollback_snapshot_not_found", [404, "policy_rollback_snapshot_not_found"]],
    ["policy_proof_idempotency_conflict", [409, "policy_proof_idempotency_conflict"]],
    ["policy_proof_owner_replayed", [409, "policy_proof_owner_replayed"]],
    ["policy_proof_cas_conflict", [409, "policy_proof_cas_conflict"]],
    ["policy_activation_core_receipt_replayed", [409, "policy_activation_core_receipt_replayed"]],
    ["policy_operation_idempotency_conflict", [409, "policy_operation_idempotency_conflict"]],
    ["policy_operation_binding_invalid", [409, "policy_operation_binding_invalid"]],
    ["policy_registry_concurrent_mutation", [409, "policy_registry_concurrent_mutation"]],
    ["policy_registry_reconciliation_required", [409, "policy_registry_reconciliation_required"]],
    ["policy_registry_cas_conflict", [409, "policy_registry_cas_conflict"]],
    ["policy_registry_state_corrupt", [409, "policy_registry_state_corrupt"]],
    ["policy_registry_compiler_provenance_missing", [409, "policy_registry_compiler_provenance_missing"]],
    ["policy_registry_compiler_provenance_invalid", [409, "policy_registry_compiler_provenance_invalid"]],
    ["policy_rollback_compiler_provenance_missing", [409, "policy_rollback_compiler_provenance_missing"]],
    ["policy_proof_reconciliation_not_ready", [409, "policy_proof_reconciliation_not_ready"]],
  ]);

  function classifiedPolicyRegistryRouteError(error) {
    const internal = String(error?.message || "");
    const configured = policyRegistrySafeRouteErrors.get(internal);
    if (configured) return { status: configured[0], code: configured[1] };
    const infrastructure = new Set([
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
    ]);
    return infrastructure.has(internal)
      ? { status: 503, code: internal }
      : { status: 503, code: "policy_registry_operation_failed" };
  }

  function policyRegistryRouteError(res, error) {
    const classified = classifiedPolicyRegistryRouteError(error);
    return publicError(res, classified.status, classified.code);
  }

  function policyRegistryPublicAuthorization(authorization) {
    return {
      allowed: authorization.allowed === true,
      state: authorization.state,
      scope: authorization.scope,
      confirmation_satisfied: authorization.confirmation_satisfied === true,
      core_final_authority: true,
      caller_authority: false,
      provider_execution_authorized: false,
    };
  }

  async function requirePolicyRegistryCoordinatorReady() {
    if (!nyraPolicyRegistryProofActivationEnabled || !nyraPolicyRegistryCoordinator) {
      throw new Error("policy_registry_coordinator_unavailable");
    }
    let current;
    try { current = await nyraPolicyRegistryCoordinator.status(); } catch { current = null; }
    if (current?.ready !== true || current?.e2e_verified !== true) {
      throw new Error("policy_registry_coordinator_unavailable");
    }
  }

  function policyRegistryPublicResult(kind, result, req, operationId) {
    if (!isPlainRecord(result)) throw new Error("policy_registry_result_binding_invalid");
    const snapshotDigest = String(result.snapshot_digest || "");
    const compilerProvenanceDigest = String(result.compiler_provenance_digest || "");
    if (!/^[a-f0-9]{64}$/.test(snapshotDigest) ||
      !/^[a-f0-9]{64}$/.test(compilerProvenanceDigest)) {
      throw new Error("policy_registry_result_binding_invalid");
    }
    const successField = kind === "activate"
      ? "activated"
      : kind === "rollback" ? "rolled_back" : "reconciled";
    if (result[successField] !== true || result.proof_status !== "consumed") {
      throw new Error("policy_registry_result_binding_invalid");
    }
    const projected = {
      tenant_id: req.tenantId,
      work_id: req.workId,
      operation_id: operationId,
      preflight_id: req.workPreflight.preflight_id,
      snapshot_digest: snapshotDigest,
      compiler_provenance_digest: compilerProvenanceDigest,
      [successField]: true,
      idempotent_replay: result.idempotent_replay === true,
      proof_status: "consumed",
      execution_authorized: false,
      provider_execution_authorized: false,
      caller_authority: false,
    };
    if (/^[a-f0-9]{64}$/.test(String(result.intent_digest || ""))) {
      projected.intent_digest = result.intent_digest;
    }
    if (Number.isSafeInteger(result.activation_generation) && result.activation_generation >= 0) {
      projected.activation_generation = result.activation_generation;
    }
    return projected;
  }

  app.post(
    "/v1/nyra-policy-registry/activate",
    coreAuth(SCOPES.AUTOMATION_CODEX, { requireWorkPreflight: true }),
    dttWorkAuth,
    async (req, res) => {
      try {
        const body = exactPolicyRegistryRouteBody(req, "activate");
        const governed = authorizePolicyRegistryMutation(req, "activate", body);
        await requirePolicyRegistryCoordinatorReady();
        const result = await nyraPolicyRegistryCoordinator.activate({
          tenant_id: req.tenantId,
          work_id: req.workId,
          operation_id: body.operation_id,
          preflight_id: req.workPreflight.preflight_id,
          domain_pack_id: body.domain_pack_id,
          snapshot: body.snapshot,
          compiler_input: body.compiler_input,
          owner_subject_fingerprint: governed.owner.owner_subject_fingerprint,
          owner_binding_hash: String(body.owner_context.binding_hash || ""),
          confirmation_reference: governed.owner.confirmation_reference,
          owner_request_binding: governed.ownerRequestBinding,
          authorization_digest: governed.authorizationDigest,
          core_branch_id: "nyra_policy_registry",
          nyra_branch_id: "risk_governance",
        });
        audit.append("core_nyra_policy_registry_activated", {
          tenant_id: req.tenantId,
          work_id: req.workId,
          key_id: req.coreKey.key_id,
          operation_id: body.operation_id,
          preflight_id: req.workPreflight.preflight_id,
          snapshot_digest: result.snapshot_digest,
          compiler_provenance_digest: result.compiler_provenance_digest,
          idempotent_replay: result.idempotent_replay,
        });
        return res.json({
          ok: true,
          tenant_id: req.tenantId,
          work_id: req.workId,
          activation: policyRegistryPublicResult("activate", result, req, body.operation_id),
          authorization: policyRegistryPublicAuthorization(governed.authorization),
        });
      } catch (error) {
        const classified = classifiedPolicyRegistryRouteError(error);
        audit.append("core_nyra_policy_registry_activation_rejected", {
          tenant_id: req.tenantId,
          work_id: req.workId || null,
          key_id: req.coreKey.key_id,
          reason: classified.code,
        });
        return policyRegistryRouteError(res, error);
      }
    },
  );

  app.post(
    "/v1/nyra-policy-registry/rollback",
    coreAuth(SCOPES.AUTOMATION_CODEX, { requireWorkPreflight: true }),
    dttWorkAuth,
    async (req, res) => {
      try {
        const body = exactPolicyRegistryRouteBody(req, "rollback");
        const governed = authorizePolicyRegistryMutation(req, "rollback", body);
        await requirePolicyRegistryCoordinatorReady();
        const result = await nyraPolicyRegistryCoordinator.rollback({
          tenant_id: req.tenantId,
          work_id: req.workId,
          operation_id: body.operation_id,
          preflight_id: req.workPreflight.preflight_id,
          domain_pack_id: body.domain_pack_id,
          target_snapshot_digest: body.target_snapshot_digest,
          owner_subject_fingerprint: governed.owner.owner_subject_fingerprint,
          owner_binding_hash: String(body.owner_context.binding_hash || ""),
          confirmation_reference: governed.owner.confirmation_reference,
          owner_request_binding: governed.ownerRequestBinding,
          authorization_digest: governed.authorizationDigest,
          core_branch_id: "nyra_policy_registry",
          nyra_branch_id: "risk_governance",
        });
        audit.append("core_nyra_policy_registry_rolled_back", {
          tenant_id: req.tenantId,
          work_id: req.workId,
          key_id: req.coreKey.key_id,
          operation_id: body.operation_id,
          preflight_id: req.workPreflight.preflight_id,
          snapshot_digest: result.snapshot_digest,
          compiler_provenance_digest: result.compiler_provenance_digest,
          activation_generation: result.activation_generation,
          idempotent_replay: result.idempotent_replay,
        });
        return res.json({
          ok: true,
          tenant_id: req.tenantId,
          work_id: req.workId,
          rollback: policyRegistryPublicResult("rollback", result, req, body.operation_id),
          authorization: policyRegistryPublicAuthorization(governed.authorization),
        });
      } catch (error) {
        const classified = classifiedPolicyRegistryRouteError(error);
        audit.append("core_nyra_policy_registry_rollback_rejected", {
          tenant_id: req.tenantId,
          work_id: req.workId || null,
          key_id: req.coreKey.key_id,
          reason: classified.code,
        });
        return policyRegistryRouteError(res, error);
      }
    },
  );

  app.post(
    "/v1/nyra-policy-registry/reconcile",
    coreAuth(SCOPES.AUTOMATION_CODEX, { requireWorkPreflight: true }),
    dttWorkAuth,
    async (req, res) => {
      try {
        const body = exactPolicyRegistryRouteBody(req, "reconcile");
        const governed = authorizePolicyRegistryMutation(req, "reconcile", body);
        await requirePolicyRegistryCoordinatorReady();
        const result = await nyraPolicyRegistryCoordinator.reconcile({
          tenant_id: req.tenantId,
          operation_id: body.operation_id,
          expected_work_id: req.workId,
        });
        audit.append("core_nyra_policy_registry_reconciled", {
          tenant_id: req.tenantId,
          work_id: req.workId,
          key_id: req.coreKey.key_id,
          operation_id: body.operation_id,
          preflight_id: req.workPreflight.preflight_id,
          snapshot_digest: result.snapshot_digest,
          compiler_provenance_digest: result.compiler_provenance_digest,
          idempotent_replay: result.idempotent_replay,
        });
        return res.json({
          ok: true,
          tenant_id: req.tenantId,
          work_id: req.workId,
          reconciliation: policyRegistryPublicResult("reconcile", result, req, body.operation_id),
          authorization: policyRegistryPublicAuthorization(governed.authorization),
        });
      } catch (error) {
        const classified = classifiedPolicyRegistryRouteError(error);
        audit.append("core_nyra_policy_registry_reconciliation_rejected", {
          tenant_id: req.tenantId,
          work_id: req.workId || null,
          key_id: req.coreKey.key_id,
          reason: classified.code,
        });
        return policyRegistryRouteError(res, error);
      }
    },
  );

    app.post("/v1/decision", coreAuth(SCOPES.READ_DECISION, { requireWorkPreflight: true }), (req, res) => {
    const input = buildCoreInput(req, req.coreKey);
    if (!input.signals.length) {
      input.signals.push(normalizeSignal({ id: "core:no_signal", label: "Nessun segnale operativo fornito", normalized_score: 10, tags: ["system"] }));
    }
    const output = runUniversalCore(input);
    const decisionContract = normalizeDecisionContract(output, {
      action_type: req.body?.action_type || req.body?.domain || input.domain,
      publish_intent: req.body?.publish_intent === true,
    });
    audit.append("core_decision_run", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, request_id: input.request_id, state: output.state, risk: output.risk?.band });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      output,
      decision_contract: decisionContract,
      guardrail: {
        destructive_automation: false,
        publish_requires_owner_confirmation: true,
        execution_from_api_allowed: output.execution_profile.can_execute === true && hasScope(req.coreKey, SCOPES.AUTOMATION_CODEX),
      },
    });
  });

  app.post("/v1/work-quality/evaluate", coreAuth(SCOPES.READ_DECISION), async (req, res) => {
    const observation = req.body?.observation;
    const observerBinding = req.body?.observer_binding;
    if (!isMcpTenantGatewayRecord(req.coreKey)) {
      return publicError(res, 403, "ai_work_quality_gateway_required");
    }
    if (!verifyAiWorkQualityObservation(observation)) {
      return publicError(res, 400, "ai_work_quality_observation_invalid");
    }
    if (String(observation.tenant_id || "") !== req.tenantId) {
      return publicError(res, 403, "tenant_scope_violation");
    }
    if (observerBinding?.transport_bound !== true || observerBinding?.active_lease_verified !== true ||
        String(observerBinding?.gallery_work_id || "") !== String(observation.work_id || "") ||
        !String(observerBinding?.agent_id || "") || !String(observerBinding?.session_id || "") ||
        !String(observerBinding?.lease_id || "")) {
      return publicError(res, 403, "ai_work_quality_observer_binding_invalid");
    }
    if (!observation.expected_state_digest || !observation.observed_state_digest ||
        !Array.isArray(observation.evidence_receipts) || observation.evidence_receipts.length < 1) {
      return publicError(res, 400, "ai_work_quality_verified_evidence_required");
    }
    const expectedEvidenceBinding = aiWorkQualityEvidenceBindingReference({
      ...observation,
      observer_session_id: observerBinding.session_id,
    });
    for (const receipt of observation.evidence_receipts) {
      if (receipt.registry_reference !== expectedEvidenceBinding) {
        return publicError(res, 403, "ai_work_quality_evidence_binding_invalid");
      }
      const verified = await dttVerificationTrustStore.verifyArtifact({
        tenant_id: req.tenantId,
        work_id: observation.work_id,
        artifact_id: receipt.artifact_id,
        content_digest: receipt.content_digest,
        source_reference: receipt.source_reference,
        registry_reference: receipt.registry_reference,
      });
      if (!verified?.verified) return publicError(res, 403, "ai_work_quality_evidence_receipt_invalid");
    }
    const disposition = observation.disposition;
    const verdict = disposition === AI_WORK_FAILURE_DISPOSITION.CONFIRMATION_REQUIRED
      ? "CONFIRM"
      : disposition === AI_WORK_FAILURE_DISPOSITION.TRANSIENT ? "DEFER" : "BLOCK";
    const decisionId = `awq_${observation.observation_digest.slice(0, 40)}`;
    const decisionContract = {
      schema_version: "core_decision_contract_v1",
      decision_id: decisionId,
      decision_digest: crypto.createHash("sha256").update(JSON.stringify({
        tenant_id: req.tenantId,
        observation_digest: observation.observation_digest,
        observer_binding: observerBinding,
        verdict,
      })).digest("hex"),
      state: verdict,
      verdict,
      block_code: observation.code,
      block_class: disposition,
      risk_band: disposition === AI_WORK_FAILURE_DISPOSITION.ABSOLUTE ? "critical" : "medium",
      policy_snapshot_digest: crypto.createHash("sha256").update(JSON.stringify({
        policy: "ai_work_quality_failure_v1",
        rollout_tier: observation.rollout_tier,
        disposition,
        code: observation.code,
      })).digest("hex"),
      blocked_reasons: [observation.summary],
      evidence_requirements: observation.evidence_digests,
      allowed_alternatives: disposition === AI_WORK_FAILURE_DISPOSITION.ABSOLUTE
        ? ["new_scope_decision_contract"] : ["verified_remediation_proposal"],
    };
    const authorization = {
      allowed: false,
      state: verdict,
      confirmation_required: disposition === AI_WORK_FAILURE_DISPOSITION.CONFIRMATION_REQUIRED,
      confirmation_satisfied: false,
      execution_authorized: false,
    };
    audit.append("ai_work_quality_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      decision_id: decisionId,
      observation_digest: observation.observation_digest,
      failure_code: observation.code,
      failure_class: observation.failure_class,
      disposition,
      execution_authorized: false,
    });
    return res.json({
      ok: true,
      tenant_id: req.tenantId,
      observation_digest: observation.observation_digest,
      decision_contract: decisionContract,
      authorization,
      guardrail: { execution_allowed: false, authority: "universal_core" },
    });
  });

  app.post("/v1/action-evaluator", coreAuth(SCOPES.READ_DECISION), async (req, res) => {
    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
    // An owner assertion is a connector capability. An automation key may keep
    // its legacy explicit-confirmation path, but it must never become an owner
    // connector merely by being issued the same named scope.
    const trustedOwnerContext = req.coreKey?.key_type === "connector" &&
      hasScope(req.coreKey, SCOPES.OWNER_ASSERTION) && verifyOwnerContextAssertion(
      req.body?.owner_context,
      readSecret(req),
      req.tenantId,
      ownerRequestBinding("core_action_evaluator", req.body || {}),
    );
    const providerSetupLinkAttempt = isProviderSetupLinkBindingAttempt(req.body);
    // Provider setup has a second, deliberately separate assertion scheme.
    // A Core bearer key must never be enough to mint a credential-entry link:
    // the assertion must instead come from the OAuth owner bridge and be
    // signed with the dedicated bridge secret.
    const providerSetupLinkOwnerVerified = providerSetupLinkAttempt &&
      Boolean(ownerContextSigningSecret) &&
      verifyOwnerContextAssertion(
        req.body?.owner_context,
        ownerContextSigningSecret,
        req.tenantId,
      ) &&
      hasProviderSetupOwnerContext(req.body?.owner_context);
    const providerSetupLinkApprovalBound = providerSetupLinkAttempt &&
      providerSetupLinkOwnerVerified &&
      sameDigest(
        req.body?.owner_context?.approval_digest,
        providerSetupLinkBindingApprovalDigest(req.body, req.tenantId),
      );
    // The signed provider context proves who approved the request, while the
    // envelope's own boolean proves that this exact request was actually
    // confirmed. Do not promote a signed-but-explicitly-unconfirmed envelope.
    const providerSetupLinkOwnerConfirmed = providerSetupLinkOwnerVerified &&
      req.body?.owner_confirmed === true;
    const explicitAutomationConfirmation = req.body?.owner_confirmed === true &&
      req.coreKey?.key_type === "automation" && hasScope(req.coreKey, SCOPES.AUTOMATION_CODEX);
    const tenantBindingAttempt = req.body?.operation_class ===
      "reversible_owner_confirmed_mcp_default_tenant_correction";
    const coreAdminBootstrapAttempt = req.body?.operation_class ===
      "reversible_owner_confirmed_core_admin_bootstrap_configuration";
    let requestBoundOwnerConfirmation = false;
    if (trustedOwnerContext && req.body?.owner_confirmed === true && !providerSetupLinkAttempt) {
      const ownerAssertion = String(req.body?.owner_context?.assertion || "");
      const approvalHash = `sha256:${crypto.createHash("sha256")
        .update(`core-action-owner-approval-v1\u0000${ownerAssertion}`)
        .digest("hex")}`;
      const assertionExpiry = new Date(
        Date.parse(String(req.body?.owner_context?.issued_at || "")) + 120_000,
      ).toISOString();
      try {
        const consumed = await ownerExecutionApprovals.consume({
          tenant_id: req.tenantId,
          approval_hash: approvalHash,
          expires_at: assertionExpiry,
        });
        if (consumed?.consumed !== true) {
          audit.append("core_action_owner_confirmation_replayed", {
            tenant_id: req.tenantId,
            key_id: req.coreKey.key_id,
            operation_class: String(req.body?.operation_class || "").slice(0, 120),
          });
          return publicError(res, 409, "owner_confirmation_replayed");
        }
        requestBoundOwnerConfirmation = true;
      } catch (error) {
        audit.append("core_action_owner_confirmation_rejected", {
          tenant_id: req.tenantId,
          key_id: req.coreKey.key_id,
          reason: error?.message === "approval_expired" ? "approval_expired" : "approval_store_unavailable",
        });
        return publicError(
          res,
          error?.message === "approval_expired" ? 403 : 503,
          error?.message === "approval_expired"
            ? "owner_context_required"
            : "owner_confirmation_store_unavailable",
        );
      }
    }
    const governedReq = Object.create(req);
    governedReq.body = {
      ...(req.body || {}),
      // Identity proves who is calling; consent proves that this exact action
      // was approved. Never silently turn a valid owner identity into consent.
      owner_confirmed: requestBoundOwnerConfirmation || providerSetupLinkOwnerConfirmed || explicitAutomationConfirmation,
      // Server-derived and deliberately written after the caller payload. The
      // generic owner-sovereignty gate and specialized production gates must
      // never accept caller-provided identity or request-binding booleans.
      request_bound_owner_confirmation: requestBoundOwnerConfirmation,
      authenticated_key_type: req.coreKey?.key_type || null,
      authenticated_tenant_id: req.tenantId,
      tenant_id: req.tenantId,
    };
    const workPreflight = composeMandatoryWorkPreflight(governedReq, {
      domainPack: domainPackAccess.pack,
      memoryContext: memoryContext.value,
    });
    const riskClassification = classifyActionRisk(governedReq.body);
    const input = buildActionEvaluatorInput(governedReq, req.coreKey);
    const output = runUniversalCore(input);
    const decisionContract = applyActionRiskProfile(normalizeDecisionContract(output, {
      action_type: governedReq.body.action_type || input.context.metadata.action_type,
      publish_intent: governedReq.body.publish_intent === true,
    }), riskClassification);
    // Normalize the request *once* before both evaluation and audit. In
    // particular, a caller-controlled tenant label must never influence either
    // the authorization decision or the evidence emitted for it.
    const evaluatedActionBody = {
      ...governedReq.body,
      ...(memoryContext.value ? { memory_context: memoryContext.value } : {}),
      operation_class: governedReq.body.operation_class || riskClassification.operation_class,
      // The body is untrusted. The authorization gate must bind a scoped
      // operation to the tenant authenticated by the Core key, not to a tenant
      // label supplied by a caller.
      authenticated_tenant_id: req.tenantId,
      tenant_id: req.tenantId,
      // A caller cannot assert this flag itself. The provider setup-link
      // binding requires a short-lived owner context signed by the MCP with a
      // separate bridge secret, bound to this exact Blueprint envelope.
      owner_context_verified: providerSetupLinkAttempt
        ? providerSetupLinkOwnerVerified
        : trustedOwnerContext,
      owner_context_approval_bound: providerSetupLinkApprovalBound,
    };
    const coreAuthorization = buildActionAuthorization(decisionContract, evaluatedActionBody);
    const policyRegistryEvaluation = nyraPolicyRegistryEvaluationEnabled
      ? await nyraPolicyRegistry.evaluate({
          tenant_id: req.tenantId,
          action: String(evaluatedActionBody.action_type || input.context.metadata.action_type || "unknown"),
          core_branch_id: "nyra_policy_registry",
          nyra_branch_id: "risk_governance",
          domain_pack_id: domainPackAccess.pack.id,
          satisfied_gates: coreAuthorization.allowed ? ["core_allow"] : [],
          context: {
            tenant_id: req.tenantId,
            domain_pack_id: domainPackAccess.pack.id,
            action_type: String(evaluatedActionBody.action_type || input.context.metadata.action_type || "unknown"),
          },
        })
      : {
          verdict: "NOT_EVALUATED",
          reasons: [],
          fail_closed: true,
          snapshot_digest: null,
          snapshot_present: false,
          snapshot_verified: false,
        };
    // The registry is a deny-only constraint. It can narrow an authorization
    // issued by Universal Core, but can never manufacture an ALLOW.
    const policyRegistryEnforcementActive = nyraPolicyRegistryMode === "enforced" ||
      (nyraPolicyRegistryEvaluationEnabled && policyRegistryEvaluation.snapshot_present === true);
    const policyRegistryDenied = policyRegistryEnforcementActive && policyRegistryEvaluation.verdict !== "ALLOW";
    const authorization = policyRegistryDenied
      ? {
          ...coreAuthorization,
          allowed: false,
          state: "blocked",
          mediation: "hard_block",
          policy_registry_denied: true,
        }
      : coreAuthorization;
    const tenantBindingAuthorization = authorization.allowed === true && [
      "reversible_owner_confirmed_mcp_default_tenant_correction",
      "reversible_owner_confirmed_mcp_default_tenant_blueprint_alignment",
    ].includes(authorization.scope);
    const coreAdminBootstrapAuthorization = authorization.allowed === true &&
      authorization.scope === "reversible_owner_confirmed_core_admin_bootstrap_configuration";
    audit.append("core_action_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      request_id: input.request_id,
      action_type: input.context.metadata.action_type,
      state: decisionContract.state,
      control_level: decisionContract.control_level,
      publish_safe: decisionContract.publish_safe,
      preflight_id: workPreflight.preflight_id,
      authorization_state: authorization.state,
      policy_registry_evaluation: nyraPolicyRegistryEvaluationEnabled ? "active" : "disabled",
      policy_registry_enforcement: policyRegistryEnforcementActive ? "enforced" : "advisory_until_snapshot",
      policy_registry_verdict: policyRegistryEvaluation.verdict,
      policy_registry_snapshot_digest: policyRegistryEvaluation.snapshot_digest,
      action_classification: riskClassification.classification,
      action_risk_band: riskClassification.risk_band,
      action_reason_codes: riskClassification.reason_codes,
      confirmation_satisfied: authorization.confirmation_satisfied,
      owner_identity_verified: trustedOwnerContext || providerSetupLinkOwnerVerified,
      provider_setup_link_binding_authorized: authorization.allowed === true && providerSetupLinkAttempt,
      ...providerSetupLinkBindingAuditFields(evaluatedActionBody),
      request_bound_owner_confirmation: requestBoundOwnerConfirmation,
      authenticated_key_type: req.coreKey?.key_type || null,
      authorization_scope: authorization.scope,
      authorization_target_commit: authorization.target_commit,
      authorization_workflow_phase: authorization.workflow_phase,
      // Never persist caller-controlled target strings from a denied attempt.
      // Successful tenant-binding gates can be represented by these canonical,
      // non-secret constants because their predicates require exact matches.
      authorization_target_service: tenantBindingAuthorization ? "skinharmony-core-mcp" : null,
      authorization_target_service_id: tenantBindingAuthorization ? "srv-d99ef1mcjfls73857m40" : null,
      authorization_target_environment_variable: tenantBindingAuthorization ? "MCP_DEFAULT_TENANT_ID" : null,
      authorization_current_tenant_id: tenantBindingAuthorization ? "owner-private" : null,
      authorization_target_tenant_id: tenantBindingAuthorization ? "codexai" : null,
      core_admin_bootstrap_authorized: coreAdminBootstrapAuthorization,
      core_admin_bootstrap_target_service:
        coreAdminBootstrapAuthorization ? "skinharmony-universal-core" : null,
      core_admin_bootstrap_target_service_id:
        coreAdminBootstrapAuthorization ? "srv-d82c9j3tqb8s73cgriag" : null,
      core_admin_bootstrap_environment_variables: coreAdminBootstrapAuthorization
        ? [
            "CORE_ADMIN_SESSION_SECRET",
            "CORE_ADMIN_BOOTSTRAP_USERNAME",
            "CORE_ADMIN_BOOTSTRAP_PASSWORD",
          ]
        : [],
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      decision_contract: decisionContract,
      output,
      work_preflight: workPreflight,
      authorization,
      policy_registry: {
        evaluation: nyraPolicyRegistryEvaluationEnabled ? "active" : "disabled",
        enforcement: policyRegistryEnforcementActive ? "enforced" : "advisory_until_snapshot",
        verdict: policyRegistryEvaluation.verdict,
        reasons: policyRegistryEvaluation.reasons,
        snapshot_digest: policyRegistryEvaluation.snapshot_digest,
        snapshot_present: policyRegistryEvaluation.snapshot_present,
        snapshot_verified: policyRegistryEvaluation.snapshot_verified,
        deny_only: true,
      },
      risk_classification: riskClassification,
      guardrail: {
        destructive_automation: false,
        execution_allowed: authorization.allowed,
        mandatory_preflight_completed: true,
        owner_confirmation_required: authorization.confirmation_required && !authorization.confirmation_satisfied,
        mode: "core_action_gate",
      },
    });
  });

  function handleSemanticSelection(req, res) {
    const body = req.body || {};
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    if (!candidates.length) {
      return publicError(res, 400, "semantic_selection_candidates_missing", "Provide candidates array.");
    }
    const result = selectSemanticCandidates(candidates, {
      tenant_id: req.tenantId,
      target_language: body.target_language || body.locale || "it",
      adapter: body.adapter || "generic",
      intent: body.intent || "semantic_selection",
      limit: Number(body.limit || 200),
    });
    audit.append("core_semantic_selection_run", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      adapter: body.adapter || "generic",
      candidate_count: candidates.length,
      summary: result.summary,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      schema_version: "semantic_selection_v1",
      read_only: true,
      result,
    });
  }

  app.post("/v1/semantic-selection", coreAuth(SCOPES.READ_DECISION, { requireWorkPreflight: true }), (req, res) => {
    return handleSemanticSelection(req, res);
  });

  app.post("/api/v1/semantic-selection", coreAuth(SCOPES.READ_DECISION, { requireWorkPreflight: true }), (req, res) => {
    return handleSemanticSelection(req, res);
  });

  app.get("/v1/software-language-gate/schema", (req, res) => {
    res.json({
      ok: true,
      schema_version: SOFTWARE_LANGUAGE_GATE_VERSION,
      mandatory: true,
      horizontal: true,
      applies_to: ["skinharmony_core_translator", "smartdesk", "ai_gold", "site_suite", "future_core_nyra_software"],
      required_pipeline: ["v2_semantic_filter", "v1_writing_policy_filter", "v0_final_visible_risk_gate"],
      blocking_radars: ["cta", "errors", "onboarding_trial", "ai_gold_copy", "legal_privacy", "pricing_payment"],
      rule: "No software language/runtime/AI copy is ready until horizontal radars plus V2/V1/V0 plus Core/Nyra governance pass.",
    });
  });

  app.get("/api/v1/software-language-gate/schema", (req, res) => {
    res.redirect(307, "/v1/software-language-gate/schema");
  });

  function handleSoftwareLanguageGate(req, res) {
    const result = evaluateSoftwareLanguageGate({
      ...(req.body || {}),
      tenant_id: req.tenantId,
    });
    audit.append("core_software_language_gate_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      app: result.app,
      target_lang: result.target_lang,
      language_ready: result.language_ready,
      decision: result.decision,
      entries: result.summary.entries,
      raw_findings_before_noise: result.summary.raw_findings_before_noise,
      noise_removed: result.summary.noise_removed,
      findings: result.summary.findings,
      blocking_high: result.summary.blocking_high,
    });
    return res.json({
      ...result,
      audit_event: "core_software_language_gate_evaluated",
      source: "universal_core_render",
    });
  }

  app.post("/v1/software-language-gate/evaluate", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    return handleSoftwareLanguageGate(req, res);
  });

  app.post("/api/v1/software-language-gate/evaluate", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    return handleSoftwareLanguageGate(req, res);
  });

  app.get("/v1/ai-gateway/schema", (req, res) => {
    res.json({
      ok: true,
      schema_version: AI_GATEWAY_SCHEMA_VERSION,
      payload_schema: AI_GATEWAY_PAYLOAD_SCHEMA,
      verdict_schema: AI_GATEWAY_VERDICT_SCHEMA,
      modes: [...AI_GATEWAY_MODES],
      adapters: [...AI_GATEWAY_ADAPTERS],
      required_fields: ["user_request"],
      recommended_fields: [
        "llm_output",
        "context",
        "requested_action",
        "runtime_state",
        "role_scope",
        "flow_pressure",
        "variants",
      ],
      verdict_fields: [
        "decision",
        "risk",
        "confidence",
        "warnings",
        "policyFlags",
        "executionAllowed",
        "recommendedVariant",
        "requiresOwnerConfirmation",
        "action_mediation",
        "explainability",
        "commercial_explanation",
      ],
      rule: "ChatGPT/Codex propongono; AI Gateway invia al Core; Universal Core decide; Nyra/adapter spiegano; i client eseguono solo entro verdict.",
    });
  });
  app.get("/api/v1/ai-gateway/schema", (req, res) => {
    res.redirect(307, "/v1/ai-gateway/schema");
  });

  function handleAiGateway(req, res, adapterOverride = "") {
    const validation = validateAiGatewayPayload(req.body || {});
    if (!validation.ok) {
      audit.append("core_ai_gateway_validation_failed", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        errors: validation.errors,
        adapter: adapterOverride || req.body?.adapter || "generic",
      });
      return publicError(res, 400, "ai_gateway_payload_invalid", validation.errors.join(", "));
    }

    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
    const workPreflight = composeMandatoryWorkPreflight(req, {
      domainPack: domainPackAccess.pack,
      memoryContext: memoryContext.value,
    });

    const input = buildAiGatewayCoreInput({
      payload: req.body || {},
      tenantId: req.tenantId,
      keyRecord: req.coreKey,
      adapterOverride,
    });
    const output = runUniversalCore(input);
    const verdict = buildAiGatewayVerdict({
      payload: req.body || {},
      tenantId: req.tenantId,
      keyRecord: req.coreKey,
      coreOutput: output,
      adapterOverride,
    });
    const benchmark = req.body?.include_benchmark === true ? gatewayBenchmark(req.body || {}, verdict) : undefined;
    audit.append("core_ai_gateway_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      request_id: input.request_id,
      adapter: verdict.adapter,
      mode: verdict.mode,
      decision: verdict.decision,
      mediation_state: verdict.action_mediation?.state,
      risk: verdict.risk?.band,
      execution_allowed: verdict.executionAllowed,
      owner_confirmation_required: verdict.requiresOwnerConfirmation,
      next_step: verdict.action_mediation?.next_step,
      preflight_id: workPreflight.preflight_id,
    });
    return res.json({
      ok: true,
      gateway: {
        schema_version: AI_GATEWAY_SCHEMA_VERSION,
        core_centralized: true,
        adapters_separated: true,
        no_duplicated_logic: true,
        openai_call_executed: false,
        mandatory_preflight_completed: true,
        audit_event: "core_ai_gateway_evaluated",
      },
      work_preflight: workPreflight,
      verdict,
      benchmark,
    });
  }

  app.post("/v1/ai-gateway/evaluate", coreAuth(SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res);
  });
  app.post("/api/v1/ai-gateway/evaluate", coreAuth(SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res);
  });

  app.post("/v1/adapters/codex/gateway", coreAuth(SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "codex");
  });
  app.post("/api/v1/adapters/codex/gateway", coreAuth(SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "codex");
  });

  app.post("/v1/adapters/site-suite/gateway", coreAuth(SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "site_suite");
  });
  app.post("/api/v1/adapters/site-suite/gateway", coreAuth(SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "site_suite");
  });

  app.post("/v1/adapters/smart-desk/gateway", coreAuth(SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "smart_desk");
  });
  app.post("/api/v1/adapters/smart-desk/gateway", coreAuth(SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "smart_desk");
  });

  app.post("/v1/adapters/skinharmony-core/gateway", coreAuth(SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "skinharmony_core");
  });
  app.post("/api/v1/adapters/skinharmony-core/gateway", coreAuth(SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "skinharmony_core");
  });

  app.post("/v1/flowcore/decision", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const branchInput = buildFlowCoreBranchInput(req.body || {});
    const input = mapFlowCoreToUniversal(branchInput);
    input.context = {
      ...(input.context || {}),
      tenant_id: req.tenantId,
      actor_id: req.body?.actor_id || undefined,
      plan: req.body?.plan || undefined,
      locale: req.body?.locale || "it",
      metadata: {
        ...(input.context?.metadata || {}),
        source: "flowcore_branch_endpoint",
      },
    };
    input.constraints = safeConstraints(input.constraints, req.coreKey, false);
    const output = runUniversalCore(input);
    audit.append("core_flowcore_decision_run", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      request_id: input.request_id,
      state: output.state,
      risk: output.risk?.band,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      branch: "flowcore",
      input: branchInput,
      output,
      guardrail: {
        destructive_automation: false,
        execution_allowed: false,
        mode: "suggest_only",
      },
    });
  });

  app.get("/v1/branches", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const resolution = resolveBranchesForKey(req.coreKey);
    const advisoryActivation = verifiedOwnerAdvisoryActivation(
      req,
      "branch_registry",
      ownerContextSigningSecret,
      { view: "registry", branches: [] },
    );
    const projectedRegistry = applyOwnerActiveAdvisory(branchRegistry(), advisoryActivation);
    res.json({
      ok: true,
      branches: extendCausalBranchRegistry(projectedRegistry),
      groups: deterministicBranchGroups(),
      taxonomy: deterministicBranchTaxonomy(),
      packages: BRANCH_PACKAGES,
      tenant_package: resolution,
      ...(advisoryActivation ? { advisory_activation: advisoryActivation } : {}),
      rule: "Ogni ramo produce decisioni advisory/read-only. Azioni operative e pubblicazione richiedono conferma owner.",
    });
  });

  app.get("/v1/branches/taxonomy", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    res.json({
      ok: true,
      taxonomy: deterministicBranchTaxonomy(),
      groups: deterministicBranchGroups(),
      packages: BRANCH_PACKAGES,
    });
  });

  app.get("/v1/branches/maturity", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const advisoryActivation = verifiedOwnerAdvisoryActivation(
      req,
      "branch_registry",
      ownerContextSigningSecret,
      { view: "maturity", branches: [] },
    );
    const report = branchMaturityReport(advisoryActivation);
    audit.append("core_branch_maturity_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    res.json({ ok: true, ...report });
  });

  app.get("/v1/branches/authorized", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const requested = typeof req.query.branches === "string" && req.query.branches.trim()
      ? req.query.branches.split(",").map((item) => item.trim()).filter(Boolean)
      : [];
    const resolution = verifiedOwnerBranchProfile(
      req,
      requested,
      "branch_registry",
      ownerContextSigningSecret,
      { view: "authorized", branches: requested },
    );
    const selectedRegistry = Object.fromEntries(
      resolution.selected_branches.map((id) => [id, branchRegistry()[id]]).filter(([, value]) => Boolean(value)),
    );
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      branch_package: resolution,
      groups: deterministicBranchGroups(),
      taxonomy: deterministicBranchTaxonomy(),
      branches: extendCausalBranchRegistry(applyOwnerActiveAdvisory(selectedRegistry, resolution.advisory_activation)),
    });
  });

  app.get("/v1/agents/registry", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const pack = resolveDomainPackForKey(req.coreKey);
    audit.append("multi_agent_registry_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, domain_pack_id: pack.id });
    res.json({ ok: true, ...multiAgentRegistry({ domainPackId: pack.id }) });
  });

  app.post("/v1/agents/plan", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
    const plan = planMultiAgentRun({
      domainPackId: domainPackAccess.pack.id,
      tenantId: req.tenantId,
      input: req.body || {},
      requestedAgents: req.body?.requested_agents,
    });
    audit.append("multi_agent_plan_created", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      domain_pack_id: domainPackAccess.pack.id,
      selected_agents: plan.selection.map((item) => item.id),
      model_calls_budget: plan.credit_control.model_calls_budget,
    });
    res.json({ ok: true, ...plan });
  });

  app.get("/v1/orchestration/capabilities", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    try {
      const branchId = String(req.query.branch || "");
      const view = String(req.query.view || "capabilities");
      if (!["capabilities", "virtual"].includes(view)) return publicError(res, 400, "orchestration_catalog_view_invalid");
      const input = {
        branchId,
        cursor: req.query.cursor,
        limit: req.query.limit,
      };
      const catalog = view === "virtual"
        ? listVirtualOrchestrationCombinations(input)
        : listOrchestrationCapabilities(input);
      audit.append("orchestration_capability_catalog_read", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        branch_id: branchId,
        view,
        item_count: catalog.items.length,
      });
      return res.json({
        ok: true,
        tenant_id: req.tenantId,
        view,
        ...catalog,
        execution_authorized: false,
      });
    } catch (error) {
      return publicError(res, 400, error.message || "orchestration_catalog_invalid");
    }
  });

  app.get("/v1/lexical-semantics/catalog", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    try {
      const resolution = resolveBranchesForKey(req.coreKey, ["lexical_semantic_intelligence"]);
      if (!resolution.selected_branches.includes("lexical_semantic_intelligence")) {
        return publicError(res, 403, "branch_not_allowed", `Branch not allowed for tier ${resolution.tier}`);
      }
      const view = String(req.query.view || "capabilities");
      if (!["capabilities", "virtual"].includes(view)) return publicError(res, 400, "lexical_catalog_view_invalid");
      const input = { cursor: req.query.cursor, limit: req.query.limit };
      const catalog = view === "virtual"
        ? listVirtualLexicalSemanticVariants(input)
        : listLexicalSemanticCapabilities(input);
      audit.append("lexical_semantic_catalog_read", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        view,
        item_count: catalog.items.length,
        fingerprint: catalog.fingerprint,
      });
      return res.json({
        ok: true,
        tenant_id: req.tenantId,
        view,
        ...catalog,
        execution_authorized: false,
      });
    } catch (error) {
      return publicError(res, 400, error.message || "lexical_catalog_invalid");
    }
  });

  app.post("/v1/lexical-semantics/analyze", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    try {
      const runtimeMode = lexicalSemanticRuntimeMode();
      if (runtimeMode === "off") {
        return publicError(res, 503, "lexical_semantic_runtime_disabled");
      }
      const resolution = resolveBranchesForKey(req.coreKey, ["lexical_semantic_intelligence"]);
      if (!resolution.selected_branches.includes("lexical_semantic_intelligence")) {
        return publicError(res, 403, "branch_not_allowed", `Branch not allowed for tier ${resolution.tier}`);
      }
      const text = String(req.body?.text || "");
      if (!text.trim()) return publicError(res, 400, "lexical_text_required");
      if (text.length > 32_768) return publicError(res, 413, "lexical_text_too_large");
      const assessment = assessLexicalSemanticText({
        text,
        locale: req.body?.locale,
        source_context: req.body?.source_context,
        scope_salt: `${req.tenantId}\u0000${process.env.CORE_EVIDENCE_SIGNING_SECRET || "tenant_bound_digest_v1"}`,
      });
      const score = assessment.disposition === "block" ? 94 : assessment.disposition === "clarify" ? 58 : 6;
      const coreInput = {
        context: {
          tenant_id: req.tenantId,
          source: "lexical_semantic_intelligence",
          locale: assessment.locale,
          source_context: assessment.source_context,
        },
        signals: [normalizeSignal({
          id: `lexical-semantic:${assessment.text_digest.slice(0, 20)}`,
          label: `Lexical semantic disposition: ${assessment.disposition}`,
          category: "language_security",
          normalized_score: score,
          severity_hint: score,
          confidence_hint: assessment.disposition === "allow" ? 86 : 92,
          evidence: [
            { label: "text_digest", value: assessment.text_digest },
            { label: "matched_families", value: assessment.matched_families },
            { label: "quoted_or_reported", value: assessment.context.quoted || assessment.context.reported },
          ],
          tags: ["lexical_semantic_intelligence", assessment.disposition, ...assessment.matched_families],
        })],
        data_quality: {
          score: assessment.disposition === "clarify" ? 62 : 88,
          missing_fields: assessment.disposition === "clarify" ? ["explicit_context_or_confirmation"] : [],
        },
        constraints: safeConstraints({
          require_confirmation: assessment.disposition !== "allow",
          max_control_level: assessment.disposition === "allow" ? "observe" : "confirm",
          risk_floor: assessment.disposition === "block" ? "high" : assessment.disposition === "clarify" ? "low" : "low",
          passive_only: true,
          allow_automation: false,
          safety_mode: true,
          blocked_actions: assessment.disposition === "block"
            ? ["execute_or_propagate_lexically_unsafe_content"]
            : [],
        }, req.coreKey, false),
      };
      const coreOutput = runtimeMode === "active" ? runUniversalCore(coreInput) : null;
      audit.append("lexical_semantic_analyzed", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        catalog_fingerprint: assessment.catalog_fingerprint,
        disposition: assessment.disposition,
        matched_families: assessment.matched_families,
        normalized_changed: assessment.normalized_changed,
        core_state: coreOutput?.state || null,
        core_risk: coreOutput?.risk?.band || null,
        runtime_mode: runtimeMode,
        digest_persisted: false,
        raw_text_persisted: false,
      });
      return res.json({
        ok: true,
        tenant_id: req.tenantId,
        branch: "lexical_semantic_intelligence",
        assessment,
        catalog: lexicalSemanticCatalogDescriptor(),
        core_output: coreOutput,
        authority: {
          lexical_semantic: "advisory",
          final_router: "universal_core",
          nyra_role: "interpret_and_explain",
        },
        guardrail: {
          execution_allowed: false,
          raw_text_persisted: false,
          explicit_confirmation_eligible: assessment.explicit_confirmation_eligible,
          mode: runtimeMode === "active"
            ? "active_advisory_core_governed"
            : "shadow_observe_only",
          rollback_mode: "shadow",
        },
      });
    } catch (error) {
      return publicError(res, 400, error.message || "lexical_semantic_analysis_invalid");
    }
  });

  app.post("/v1/orchestration/relational/evaluate", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    try {
      const supervision = relationalOrchestrationSupervisor.create({
        ...(req.body || {}),
        tenant_id: req.tenantId,
      });
      audit.append("relational_orchestration_evaluated", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        supervision_id: supervision.supervision_id,
        actor_count: supervision.actors.length,
        conflict_count: supervision.unresolved_conflicts.length,
      });
      return res.json({ ok: true, ...supervision });
    } catch (error) {
      return publicError(res, 400, error.message || "relational_orchestration_invalid");
    }
  });

  app.post("/v1/orchestration/dtt/plan", coreAuth(SCOPES.READ_DECISION), dttWorkAuth, async (req, res) => {
    if (!dynamicTaskTreeRollout.enabled) {
      return publicError(res, 503, "dynamic_task_tree_disabled");
    }
    if (!dynamicTaskTreeRollout.tenantAllowed(req.tenantId)) {
      return publicError(res, 403, "dynamic_task_tree_tenant_denied");
    }
    try {
      const tree = await dynamicTaskTreeRuntime.create({
        ...(req.body || {}),
        tenant_id: req.tenantId,
        work_id: req.workId,
      });
      audit.append("dynamic_task_tree_planned", {
        tenant_id: req.tenantId,
        work_id: req.workId,
        key_id: req.coreKey.key_id,
        tree_id: tree.tree_id,
        node_count: tree.nodes.length,
        max_depth: tree.limits.max_depth,
        max_parallel: tree.limits.max_parallel,
        rollout_mode: dynamicTaskTreeRollout.mode,
      });
      return res.json({
        ...tree,
        ok: true,
        tenant_id: req.tenantId,
        work_id: req.workId,
        execution_authorized: false,
        rollout: {
          enabled: true,
          mode: dynamicTaskTreeRollout.mode,
          tenant_allowed: true,
          execution_authorized: false,
          core_join_required: true,
        },
      });
    } catch (error) {
      const code = error.message || "dynamic_task_tree_invalid";
      return publicError(res, dttStatusForError(code), code);
    }
  });

  app.get("/v1/orchestration/dtt/:treeId", coreAuth(SCOPES.READ_DECISION), dttWorkAuth, async (req, res) => {
    try {
      const tree = await dynamicTaskTreeRuntime.get({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
      });
      audit.append("dynamic_task_tree_read", {
        tenant_id: req.tenantId,
        work_id: req.workId,
        key_id: req.coreKey.key_id,
        tree_id: tree.tree_id,
        status: tree.status,
      });
      return res.json({ ...tree, ok: true, tenant_id: req.tenantId, work_id: req.workId, execution_authorized: false });
    } catch (error) {
      const code = error.message || "dynamic_task_tree_read_failed";
      return publicError(res, dttStatusForError(code), code);
    }
  });

  app.post("/v1/orchestration/dtt/:treeId/expansion-proposals", coreAuth(SCOPES.READ_DECISION), dttWorkAuth, async (req, res) => {
    try {
      const proposal = await dynamicTaskTreeRuntime.proposeExpansion({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
        parent_node_id: req.body?.parent_node_id,
        nodes: req.body?.nodes,
      });
      audit.append("dynamic_task_tree_expansion_proposed", {
        tenant_id: req.tenantId,
        work_id: req.workId,
        key_id: req.coreKey.key_id,
        tree_id: proposal.tree_id,
        proposal_id: proposal.proposal_id,
        node_count: proposal.nodes.length,
      });
      return res.json({
        ...proposal,
        ok: true,
        tenant_id: req.tenantId,
        work_id: req.workId,
        execution_authorized: false,
      });
    } catch (error) {
      const code = error.message || "dynamic_task_tree_expansion_invalid";
      return publicError(res, dttStatusForError(code), code);
    }
  });

  app.post("/v1/orchestration/dtt/:treeId/replan-proposals", coreAuth(SCOPES.READ_DECISION), dttWorkAuth, async (req, res) => {
    try {
      const proposal = await dynamicTaskTreeRuntime.proposePruneReplan({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
        prune_node_ids: req.body?.prune_node_ids,
        replacement_nodes: req.body?.replacement_nodes,
        reason: req.body?.reason,
      });
      audit.append("dynamic_task_tree_replan_proposed", {
        tenant_id: req.tenantId,
        work_id: req.workId,
        key_id: req.coreKey.key_id,
        tree_id: proposal.tree_id,
        proposal_id: proposal.proposal_id,
        prune_count: proposal.prune_node_ids.length,
        replacement_count: proposal.replacement_nodes.length,
      });
      return res.json({
        ...proposal,
        ok: true,
        tenant_id: req.tenantId,
        work_id: req.workId,
        execution_authorized: false,
      });
    } catch (error) {
      const code = error.message || "dynamic_task_tree_replan_invalid";
      return publicError(res, dttStatusForError(code), code);
    }
  });

  app.post("/v1/orchestration/dtt/:treeId/nodes/:nodeId/evidence-drafts", coreAuth(SCOPES.READ_DECISION), dttWorkAuth, async (req, res) => {
    try {
      await assertDttTreeNode({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
        node_id: req.params.nodeId,
      });
      const draft = prepareVerificationEvidenceDraft({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
        node_id: req.params.nodeId,
        claim: req.body?.claim,
        artifacts: req.body?.artifacts,
        provenance: {
          ...(req.body?.provenance || {}),
          tenant_id: req.tenantId,
          work_id: req.workId,
          tree_id: req.params.treeId,
          node_id: req.params.nodeId,
        },
        required_approvals: req.body?.required_approvals,
      });
      return res.json({
        ...draft,
        ok: true,
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
        node_id: req.params.nodeId,
        execution_authorized: false,
      });
    } catch (error) {
      const code = error.message || "verification_evidence_draft_invalid";
      return publicError(res, dttStatusForError(code), code);
    }
  });

  app.post("/v1/orchestration/dtt/:treeId/nodes/:nodeId/outcomes", coreAuth(SCOPES.WRITE_DECISION), dttWorkAuth, async (req, res) => {
    try {
      let outcomeEvidence = req.body?.evidence;
      if (!outcomeEvidence && req.body?.evidence_draft) {
        const suppliedDraft = req.body.evidence_draft;
        const built = buildVerificationEvidenceContract({
          ...suppliedDraft,
          tenant_id: req.tenantId,
          work_id: req.workId,
          tree_id: req.params.treeId,
          node_id: req.params.nodeId,
          provenance: {
            ...(suppliedDraft?.provenance || {}),
            tenant_id: req.tenantId,
            work_id: req.workId,
            tree_id: req.params.treeId,
            node_id: req.params.nodeId,
          },
          votes: req.body?.votes,
          required_approvals: suppliedDraft?.quorum?.required_approvals,
        });
        if (built.evidence_digest !== suppliedDraft.evidence_digest) throw new Error("evidence_draft_digest_mismatch");
        outcomeEvidence = built;
      }
      const outcome = await dynamicTaskTreeRuntime.recordOutcome({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
        node_id: req.params.nodeId,
        idempotency_key: req.body?.idempotency_key,
        outcome: req.body?.outcome,
        evidence: outcomeEvidence,
      });
      audit.append("dynamic_task_tree_outcome_recorded", {
        tenant_id: req.tenantId,
        work_id: req.workId,
        key_id: req.coreKey.key_id,
        tree_id: outcome.tree_id,
        node_id: outcome.node_id,
        state: outcome.state,
      });
      return res.json({
        ...outcome,
        ok: true,
        tenant_id: req.tenantId,
        work_id: req.workId,
        execution_authorized: false,
      });
    } catch (error) {
      const code = error.message || "dynamic_task_tree_outcome_invalid";
      return publicError(res, dttStatusForError(code), code);
    }
  });

  app.post("/v1/orchestration/dtt/:treeId/cancel", coreAuth(SCOPES.WRITE_DECISION), dttWorkAuth, async (req, res) => {
    try {
      const tree = await dynamicTaskTreeRuntime.cancel({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
        reason: req.body?.reason,
      });
      audit.append("dynamic_task_tree_cancelled", {
        tenant_id: req.tenantId,
        work_id: req.workId,
        key_id: req.coreKey.key_id,
        tree_id: tree.tree_id,
        cancelled_node_count: tree.kill_signal?.cancelled_node_count || 0,
      });
      return res.json({ ...tree, ok: true, tenant_id: req.tenantId, work_id: req.workId, execution_authorized: false });
    } catch (error) {
      const code = error.message || "dynamic_task_tree_cancel_failed";
      return publicError(res, dttStatusForError(code), code);
    }
  });

  app.get("/v1/orchestration/dtt/:treeId/retry-fallback", coreAuth(SCOPES.READ_DECISION), dttWorkAuth, async (req, res) => {
    try {
      const tree = await dynamicTaskTreeRuntime.get({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
      });
      const nodes = tree.nodes
        .filter((node) => node.status === "retry_proposed" || (node.status === "failed" && node.fallback_node_id))
        .map((node) => ({
          node_id: node.node_id,
          state: node.status === "retry_proposed" ? "retry_proposed" : "fallback_proposed",
          attempts: node.attempts,
          max_attempts: node.retry_policy.max_attempts,
          fallback_node_id: node.fallback_node_id,
          execution_authorized: false,
        }));
      audit.append("dynamic_task_tree_retry_fallback_read", {
        tenant_id: req.tenantId,
        work_id: req.workId,
        key_id: req.coreKey.key_id,
        tree_id: tree.tree_id,
        proposal_count: nodes.length,
      });
      return res.json({
        ok: true,
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: tree.tree_id,
        tree_status: tree.status,
        nodes,
        execution_authorized: false,
      });
    } catch (error) {
      const code = error.message || "dynamic_task_tree_retry_fallback_read_failed";
      return publicError(res, dttStatusForError(code), code);
    }
  });

  app.post("/v1/orchestration/dtt/:treeId/core-join", coreAuth(SCOPES.WRITE_DECISION), dttWorkAuth, async (req, res) => {
    let issuedVerdict = null;
    let joined = null;
    try {
      if (
        Object.hasOwn(req.body || {}, "verdict_reference")
        || Object.hasOwn(req.body || {}, "core_verdict")
        || Object.hasOwn(req.body || {}, "allowed")
        || Object.hasOwn(req.body || {}, "authority")
      ) {
        throw new Error("client_core_verdict_denied");
      }
      const persistedTree = await dynamicTaskTreeRuntime.get({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
      });
      if (persistedTree.status === "core_joined") {
        const reference = persistedTree.core_join?.verdict_reference;
        const events = await dynamicTaskTreeJoinVerdictStore.read({
          tenant_id: req.tenantId,
          work_id: req.workId,
          tree_id: persistedTree.tree_id,
        });
        const issued = events.find((event) =>
          event.event_type === "issued" && event.verdict_reference === reference);
        const consumed = events.some((event) =>
          event.event_type === "consumed" && event.verdict_reference === reference);
        const voided = events.some((event) =>
          event.event_type === "voided" && event.verdict_reference === reference);
        if (!issued) throw new Error("joined_tree_verdict_missing");
        if (voided) throw new Error("joined_tree_verdict_voided");
        if (consumed) throw new Error("task_tree_already_joined");
        try {
          await dynamicTaskTreeJoinVerdictStore.consume({
            tenant_id: req.tenantId,
            work_id: req.workId,
            tree_id: persistedTree.tree_id,
            verdict_reference: reference,
          });
        } catch {
          throw new Error("dtt_join_finalization_pending");
        }
        audit.append("dynamic_task_tree_core_join_reconciled", {
          tenant_id: req.tenantId,
          work_id: req.workId,
          key_id: req.coreKey.key_id,
          tree_id: persistedTree.tree_id,
          verdict_reference: reference,
        });
        return res.json({
          ok: true,
          tree_id: persistedTree.tree_id,
          tenant_id: req.tenantId,
          work_id: req.workId,
          status: persistedTree.status,
          core_join: persistedTree.core_join,
          reconciled: true,
          execution_authorized: false,
        });
      }
      const readiness = await dynamicTaskTreeRuntime.inspectCoreJoin({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
      });
      const existingEvents = await dynamicTaskTreeJoinVerdictStore.read({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: readiness.tree_id,
      });
      const activeIssued = [...existingEvents].reverse().find((event) => {
        if (event.event_type !== "issued") return false;
        return !existingEvents.some((candidate) =>
          candidate.verdict_reference === event.verdict_reference
          && ["consumed", "voided"].includes(candidate.event_type));
      });
      if (activeIssued && activeIssued.evidence_set_digest !== readiness.evidence_set_digest) {
        await dynamicTaskTreeJoinVerdictStore.void({
          tenant_id: req.tenantId,
          work_id: req.workId,
          tree_id: readiness.tree_id,
          verdict_reference: activeIssued.verdict_reference,
          reason: "persisted_tree_evidence_digest_changed",
        });
      } else if (activeIssued) {
        issuedVerdict = activeIssued;
      }
      issuedVerdict ||= await dynamicTaskTreeJoinVerdictStore.issue({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: readiness.tree_id,
        key_id: req.coreKey.key_id,
        evidence_set_digest: readiness.evidence_set_digest,
      });
      joined = await dynamicTaskTreeRuntime.coreJoin({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: req.params.treeId,
        core_verdict: {
          allowed: issuedVerdict.allowed === true,
          authority: issuedVerdict.authority,
          verdict_reference: issuedVerdict.verdict_reference,
        },
        verification: {
          source: "universal_core_persisted_tree_inspection",
          evidence_set_digest: readiness.evidence_set_digest,
          verified_node_count: readiness.verified_node_count,
          verification_node_count: readiness.verification_node_count,
        },
      });
      await dynamicTaskTreeJoinVerdictStore.consume({
        tenant_id: req.tenantId,
        work_id: req.workId,
        tree_id: joined.tree_id,
        verdict_reference: issuedVerdict.verdict_reference,
      });
      audit.append("dynamic_task_tree_core_joined", {
        tenant_id: req.tenantId,
        work_id: req.workId,
        key_id: req.coreKey.key_id,
        tree_id: joined.tree_id,
        verdict_reference: joined.core_join.verdict_reference,
      });
      return res.json({ ...joined, ok: true, tenant_id: req.tenantId, work_id: req.workId, execution_authorized: false });
    } catch (error) {
      let code = error.message || "dynamic_task_tree_core_join_failed";
      if (issuedVerdict?.verdict_reference) {
        try {
          const persistedTree = await dynamicTaskTreeRuntime.get({
            tenant_id: req.tenantId,
            work_id: req.workId,
            tree_id: req.params.treeId,
          });
          if (
            persistedTree.status === "core_joined"
            && persistedTree.core_join?.verdict_reference === issuedVerdict.verdict_reference
          ) {
            try {
              await dynamicTaskTreeJoinVerdictStore.consume({
                tenant_id: req.tenantId,
                work_id: req.workId,
                tree_id: req.params.treeId,
                verdict_reference: issuedVerdict.verdict_reference,
              });
              audit.append("dynamic_task_tree_core_join_reconciled", {
                tenant_id: req.tenantId,
                work_id: req.workId,
                key_id: req.coreKey.key_id,
                tree_id: req.params.treeId,
                verdict_reference: issuedVerdict.verdict_reference,
              });
              return res.json({
                ok: true,
                tree_id: persistedTree.tree_id,
                tenant_id: req.tenantId,
                work_id: req.workId,
                status: persistedTree.status,
                core_join: persistedTree.core_join,
                reconciled: true,
                execution_authorized: false,
              });
            } catch {
              code = "dtt_join_finalization_pending";
            }
          } else {
            await dynamicTaskTreeJoinVerdictStore.void({
              tenant_id: req.tenantId,
              work_id: req.workId,
              tree_id: req.params.treeId,
              verdict_reference: issuedVerdict.verdict_reference,
              reason: code,
            });
          }
        } catch {}
      }
      audit.append("dynamic_task_tree_core_join_denied", {
        tenant_id: req.tenantId,
        work_id: req.workId,
        key_id: req.coreKey.key_id,
        tree_id: req.params.treeId,
        reason: code,
      });
      return publicError(res, dttStatusForError(code), code);
    }
  });

  app.post("/v1/codex/context", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
    const requestedBranches = Array.isArray(req.body?.branches)
      ? req.body.branches
      : Array.isArray(req.body?.requested_branches)
        ? req.body.requested_branches
        : [];
    const context = composeBranchContext({
      keyRecord: req.coreKey,
      requestedBranches,
      task: req.body?.task || "",
      userInput: req.body?.user_input || req.body?.input || "",
      locale: req.body?.locale || "it",
    });
    const tenantPolicy = getTenantPolicy(req.tenantId, req.body?.plan || req.coreKey?.metadata?.tier, {
      brandScope: req.coreKey?.brand_scope,
      metadata: req.coreKey?.metadata,
    });
    const workPreflight = composeMandatoryWorkPreflight(req, {
      domainPack: domainPackAccess.pack,
      memoryContext: memoryContext.value,
      branchContext: context,
    });
    audit.append("core_codex_context_composed", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      tier: context.tier,
      selected_branches: context.selected_branches,
      denied_branches: context.denied_branches,
      memory_revision: memoryContext.value?.revision || 0,
      preflight_id: workPreflight.preflight_id,
    });
    res.json({
      ok: true,
      domain_pack: publicDomainPack(domainPackAccess.pack),
      context,
      memory_context: memoryContext.value,
      work_preflight: workPreflight,
      tenant_policy: tenantPolicy,
      decision_contract: normalizeDecisionContract(runUniversalCore({
        request_id: req.body?.request_id || `codex_context_${crypto.randomUUID()}`,
        generated_at: nowIso(),
        domain: "codex",
        context: {
          tenant_id: req.tenantId,
          locale: req.body?.locale || "it",
          metadata: {
            action_type: "codex_automation",
            source: "codex_context",
          },
        },
        signals: [
          normalizeSignal({
            id: "codex:context_request",
            label: req.body?.task || "Contesto Codex richiesto",
            category: "codex",
            normalized_score: context.selected_branches.length ? 35 : 45,
            confidence_hint: 80,
            evidence: [
              { label: context.selected_branches.length ? "Rami specializzati disponibili" : "Nessun ramo richiesto/autorizzato: uso guardiano generico", value: true },
              { label: "Memorie tenant rilevanti", value: memoryContext.value?.relevant_memories.length || 0 },
              { label: "Handoff AI pendenti", value: memoryContext.value?.pending_handoffs.length || 0 },
            ],
            tags: ["codex", context.selected_branches.length ? "branch_context" : "generic_guard"],
          }),
        ],
        data_quality: { score: 75, missing_fields: [] },
        constraints: safeConstraints({ require_confirmation: true, max_control_level: "confirm" }, req.coreKey, false),
      }), { action_type: "codex_automation" }),
      guardrail: {
        destructive_automation: false,
        execution_allowed: false,
        openai_call_executed: false,
        mandatory_preflight_completed: true,
        mode: "context_composition_only",
      },
    });
  });

  app.post("/v1/codex/guard", coreAuth(SCOPES.AUTOMATION_CODEX), (req, res) => {
    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
    const requestedBranches = Array.isArray(req.body?.branches)
      ? req.body.branches
      : Array.isArray(req.body?.requested_branches)
        ? req.body.requested_branches
        : [];
    const context = composeBranchContext({
      keyRecord: req.coreKey,
      requestedBranches,
      task: req.body?.task || "",
      userInput: req.body?.user_input || req.body?.input || "",
      locale: req.body?.locale || "it",
    });
    const tenantPolicy = getTenantPolicy(req.tenantId, req.body?.plan || req.coreKey?.metadata?.tier, {
      brandScope: req.coreKey?.brand_scope,
      metadata: req.coreKey?.metadata,
    });
    const evaluatorInput = buildActionEvaluatorInput({
      get: () => "",
      body: {
        ...(req.body || {}),
        tenant_id: req.tenantId,
        domain: "codex",
        action_type: req.body?.action_type || "codex_automation",
        action_label: req.body?.task || "Codex AI controlled work",
        risk_hint: req.body?.risk_hint ?? (context.selected_branches.length ? 35 : 45),
        evidence: [
          { label: context.selected_branches.length ? "Rami Core disponibili per il task" : "Nessun ramo disponibile: guardiano generico Core attivo", value: context.selected_branches.length },
          { label: tenantPolicy.source === "domain_pack_registry" ? "Domain pack tenant specifico caricato" : "Policy tenant generica caricata", value: tenantPolicy.source },
          ...(Array.isArray(req.body?.evidence) ? req.body.evidence : []),
        ],
      },
    }, req.coreKey);
    const output = runUniversalCore(evaluatorInput);
    const response = buildCodexGuardResponse({
      tenantId: req.tenantId,
      keyRecord: req.coreKey,
      coreOutput: output,
      branchContext: context,
      requestedBranches,
      task: req.body?.task || "",
      actionType: req.body?.action_type || "codex_automation",
    });
    response.tenant_policy = tenantPolicy;
    response.work_preflight = composeMandatoryWorkPreflight(req, {
      domainPack: domainPackAccess.pack,
      memoryContext: memoryContext.value,
      branchContext: context,
    });
    audit.append("core_codex_guard_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      task: req.body?.task || "",
      mode: response.codex_guard.mode,
      state: response.decision_contract.state,
      control_level: response.decision_contract.control_level,
      selected_branches: response.codex_guard.selected_branches,
      denied_branches: response.codex_guard.denied_branches,
      preflight_id: response.work_preflight.preflight_id,
    });
    res.json({ ok: true, ...response });
  });

  app.post("/v1/nira/core-bridge", coreAuth(SCOPES.READ_DECISION, { requireWorkPreflight: true }), async (req, res) => {
    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
    const niraText = String(req.body?.text || req.body?.request || req.body?.task || "").trim();
    if (!niraText) return publicError(res, 400, "nira_text_required");
    if (niraText.length > 20_000) return publicError(res, 413, "nira_text_too_long");
    const requestedNyraBranches = req.body?.nyra_branches;
    if (requestedNyraBranches !== undefined && !Array.isArray(requestedNyraBranches)) {
      return publicError(res, 400, "nyra_branches_must_be_array");
    }
    if (Array.isArray(requestedNyraBranches) && requestedNyraBranches.length > MAX_NYRA_BRANCH_REQUESTS) {
      return publicError(res, 400, "nyra_branch_request_limit_exceeded");
    }
    if (Array.isArray(requestedNyraBranches) && requestedNyraBranches.some((id) => !/^[a-z][a-z0-9_]{1,63}$/.test(String(id || "")))) {
      return publicError(res, 400, "invalid_nyra_branch_id");
    }
    const rawDeepBranchV2 = isPlainRecord(req.body?.deep_branch_v2)
      ? req.body.deep_branch_v2
      : null;
    const deepBranchV2Requested = req.body?.deep_branch_v2_preview === true
      || rawDeepBranchV2 !== null;
    const coreRequestId = String(
      req.body?.request_id || `nira_service_${crypto.randomUUID()}`,
    ).slice(0, 160);
    const deepBranchV2Operation = rawDeepBranchV2
      ? nyraDeepV2Operation(rawDeepBranchV2.operation)
      : null;
    let deepBranchV2McpRequest = {
      ok: false,
      reason: "nyra_deep_branch_v2_mcp_attestation_required",
    };
    if (deepBranchV2Requested && deepBranchV2Operation) {
      deepBranchV2McpRequest = nyraDeepV2McpRequestVerifier.verify({
        attestation: rawDeepBranchV2?.request_attestation,
        tenantId: req.tenantId,
        requestId: coreRequestId,
        operation: deepBranchV2Operation,
      });
      if (
        deepBranchV2McpRequest.ok
        && deepBranchV2Operation !== "preview"
        && (
          rawDeepBranchV2.branch_id !== deepBranchV2McpRequest.branch_id
          || rawDeepBranchV2.subbranch_id
            !== deepBranchV2McpRequest.subbranch_id
        )
      ) {
        deepBranchV2McpRequest = {
          ok: false,
          reason: "nyra_deep_branch_v2_mcp_branch_binding_mismatch",
        };
      }
      if (
        deepBranchV2McpRequest.ok
        && JSON.stringify(rawDeepBranchV2.evidence_refs || [])
          !== JSON.stringify(deepBranchV2McpRequest.evidence_refs || [])
      ) {
        deepBranchV2McpRequest = {
          ok: false,
          reason: "nyra_deep_branch_v2_mcp_evidence_binding_mismatch",
        };
      }
    } else if (deepBranchV2Requested) {
      deepBranchV2McpRequest = {
        ok: false,
        reason: "nyra_deep_branch_v2_mcp_operation_invalid",
      };
    }
    const signedDeepBranchId = deepBranchV2McpRequest.ok
      ? deepBranchV2McpRequest.branch_id
      : null;
    const ownerContext = req.body?.owner_context && typeof req.body.owner_context === "object"
      ? req.body.owner_context
      : {};
    const trustedOwnerContext = verifyOwnerContextAssertion(ownerContext, ownerContextSigningSecret, req.tenantId);
    const explicitOwnerConfirmation = req.body?.owner_confirmed === true || req.body?.owner_confirmation === true;
    const ownerConfirmed = explicitOwnerConfirmation || trustedOwnerContext;
    const requestedGodMode = req.body?.mode === "god_mode_owner_only"
      || req.body?.god_mode === true
      || trustedOwnerContext;
    const ownerVerified = Boolean(trustedOwnerContext || (explicitOwnerConfirmation && hasScope(req.coreKey, SCOPES.AUTOMATION_CODEX)));
    let coreRuntimeDecision;
    try {
      coreRuntimeDecision = await evaluateCoreRuntimeHierarchy({
        request_id: coreRequestId,
        generated_at: new Date().toISOString(),
        domain: domainPackAccess.pack.domain,
        context: {
          tenant_id: req.tenantId,
          metadata: { operation_type: "nyra_interpret_request" },
        },
        signals: [{
          id: "nyra_runtime_request",
          source: "universal_core_nyra_bridge",
          category: "runtime",
          label: "Nyra interpretation request",
          value: 20,
          normalized_score: 20,
          severity_hint: 20,
          confidence_hint: 80,
          reliability_hint: 80,
          friction_hint: 20,
          risk_hint: 20,
          reversibility_hint: 80,
          tags: ["nyra", "core_runtime"],
        }],
        data_quality: {
          score: 80,
          completeness: 80,
          freshness: 80,
          consistency: 80,
          reliability: 80,
        },
        constraints: {
          allow_automation: false,
          require_confirmation: false,
          blocked_actions: [],
          blocked_action_rules: [],
        },
      }, {
        worker: coreRuntime,
        mode: coreRuntimeMode,
        ownerMode: options.coreRuntimeOwnerMode || "normal",
      });
    } catch {
      return publicError(res, 503, "core_runtime_hierarchy_unavailable");
    }
    const requestedBranches = [...new Set(["work_cortex", ...inferNiraBranchRequest(req.body || {})])];
    const branchContext = composeBranchContext({
      keyRecord: req.coreKey,
      requestedBranches,
      task: String(req.body?.task || req.body?.request || req.body?.text || ""),
      userInput: String(req.body?.text || req.body?.request || req.body?.task || ""),
      locale: req.body?.locale || "it",
    });
    const nyraNetwork = routeNyraBranches({
      text: niraText,
      requestedBranches: [
        ...MANDATORY_NYRA_WORK_BRANCHES,
        ...(Array.isArray(requestedNyraBranches) ? requestedNyraBranches : []),
        ...(signedDeepBranchId ? [signedDeepBranchId] : []),
      ],
      authorizedCoreBranches: branchContext.selected_branches,
      domainPackId: domainPackAccess.pack.id,
    });
    const workPreflight = composeMandatoryWorkPreflight(req, {
      domainPack: domainPackAccess.pack,
      memoryContext: memoryContext.value,
      branchContext,
      nyraNetwork,
    });
    const result = runNiraUniversalCoreBridge({
      request_id: coreRequestId,
      text: niraText,
      tenant_id: req.tenantId,
      domain: domainPackAccess.pack.domain,
      domain_pack: domainPackAccess.pack.id,
      owner_verified: ownerVerified,
      access_scope: ownerVerified ? "owner_full" : "limited",
      mode: requestedGodMode ? "god_mode_owner_only" : "standard",
      target_system: req.body?.target_system || "universal_core",
      memory_context: memoryContext.value || undefined,
      scenario_candidates: Array.isArray(req.body?.scenario_candidates)
        ? req.body.scenario_candidates
        : (Array.isArray(req.body?.scenarios) ? req.body.scenarios : undefined),
      minimum_uniqueness_ratio: typeof req.body?.minimum_uniqueness_ratio === "number"
        ? req.body.minimum_uniqueness_ratio
        : undefined,
      core_branch_context: {
        tier: branchContext.tier,
        selected_branches: branchContext.selected_branches,
        denied_branches: branchContext.denied_branches,
        selected_groups: branchContext.selected_groups,
        denied_groups: branchContext.denied_groups,
        branch_profiles: branchContext.branch_profiles,
      },
    });
    const deepNyraRuntime = buildDeepNyraRuntime({
      text: niraText,
      ownerVerified,
      godModeActive: result.god_mode_active,
      selectedByCore: result.selected_by_core,
      nyraNetwork,
      memoryContext: memoryContext.value,
    });
    const deepBranchV2 = !deepBranchV2Requested ? null : await (async () => {
      if (!deepBranchV2McpRequest.ok) {
        return nyraDeepV2Fallback({
          requestId: coreRequestId,
          state: "request_rejected_v1_authoritative",
          reason: deepBranchV2McpRequest.reason,
        });
      }
      const common = {
        tenantId: req.tenantId,
        requestId: coreRequestId,
        entitlementDomainPackId: domainPackAccess.pack.id,
        selectedByCore: result.selected_by_core,
        nyraNetwork,
        workPreflight,
      };
      if (deepBranchV2Operation === "preview") {
        try {
          return await nyraDeepBranchV2Client.evaluate({
            requested: true,
            ...common,
          });
        } catch {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "unavailable_v1_authoritative",
            reason: "nyra_deep_branch_v2_preview_unavailable",
          });
        }
      }
      if (
        nyraDeepV2IntegrationReason
        || !nyraDeepV2Ledger
        || !nyraDeepV2Attester
        || !nyraDeepV2SourceVerifier
      ) {
        return nyraDeepV2Fallback({
          requestId: coreRequestId,
          reason: nyraDeepV2IntegrationReason
            || "nyra_deep_branch_v2_core_material_unavailable",
        });
      }
      const branchId = deepBranchV2McpRequest.branch_id;
      const subbranchId = deepBranchV2McpRequest.subbranch_id;
      const discovery = nyraDeepV2Attester.requirementBindings({
        branchId,
        subbranchId,
      });
      if (!discovery?.ok) {
        return nyraDeepV2Fallback({
          requestId: coreRequestId,
          state: "catalog_rejected_v1_authoritative",
          reason: discovery?.reason
            || "nyra_deep_branch_v2_requirement_discovery_failed",
        });
      }
      if (deepBranchV2Operation === "requirements") {
        return {
          schema_version: "nyra_deep_branch_v2_core_operation_v1",
          state: "requirements_ready_v1_authoritative",
          request_id: coreRequestId,
          branch_id: branchId,
          subbranch_id: subbranchId,
          requirements: compactNyraDeepV2Requirements(
            discovery.requirement_bindings,
          ),
          evidence: {
            state: "not_prepared_v1_authoritative",
            evidence_refs: [],
            validation: {
              state: "not_requested",
              accepted_source_count: 0,
              accepted_claim_count: 0,
              rejected_count: 0,
            },
          },
          evaluation: {
            state: "not_requested_v1_authoritative",
            evaluated_node_count: 0,
          },
          execution_authorized: false,
          core_final_authority: true,
          fallback: "nyra_neural_branch_network_v1",
        };
      }
      if (deepBranchV2Operation === "prepare_evidence") {
        const boundedEvidence = boundedNyraDeepV2EvidencePack(
          rawDeepBranchV2.evidence_pack,
        );
        if (!boundedEvidence.ok) {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: boundedEvidence.reason,
          });
        }
        const suppliedBindings = Array.isArray(
          rawDeepBranchV2.requirement_bindings,
        ) ? rawDeepBranchV2.requirement_bindings : [];
        if (
          rawDeepBranchV2.evidence_pack_hash
            !== deepBranchV2McpRequest.evidence_pack_hash
          || rawDeepBranchV2.evidence_pack_hash
            !== nyraDeepV2EvidencePackHash(
              boundedEvidence.evidence_pack,
              suppliedBindings,
            )
        ) {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: "nyra_deep_branch_v2_evidence_hash_mismatch",
          });
        }
        const normalizedBindings = normalizeNyraDeepV2RequirementBindings(
          suppliedBindings,
          discovery.requirement_bindings,
        );
        if (!normalizedBindings.ok) {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: normalizedBindings.reason,
          });
        }
        const sourceIds = new Set(
          boundedEvidence.evidence_pack.sources
            .map((source) => String(source?.id || "")),
        );
        const claimsById = new Map(
          boundedEvidence.evidence_pack.claims
            .map((claim) => [String(claim?.id || ""), claim]),
        );
        const bindingsMatchEvidence = normalizedBindings.bindings
          .every((binding) => (
            binding.source_ids.every((id) => sourceIds.has(id))
            && binding.claim_ids.every((id) => {
              const claimSources = Array.isArray(
                claimsById.get(id)?.source_ids,
              ) ? claimsById.get(id).source_ids : [];
              return claimsById.has(id)
                && binding.source_ids
                  .some((sourceId) => claimSources.includes(sourceId));
            })
          ));
        if (!bindingsMatchEvidence) {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: "nyra_deep_branch_v2_evidence_binding_invalid",
          });
        }
        if (!nyraDeepV2AcceptanceContractsMatch(
          boundedEvidence.evidence_pack,
          normalizedBindings.bindings,
        )) {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: "nyra_deep_branch_v2_evidence_acceptance_contract_rejected",
          });
        }
        let sourceVerification;
        try {
          sourceVerification = await nyraDeepV2SourceVerifier.verifySources(
            boundedEvidence.evidence_pack.sources,
            { branchId },
          );
        } catch {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: "nyra_deep_branch_v2_source_verifier_unavailable",
          });
        }
        if (!sourceVerification?.ok) {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: "nyra_deep_branch_v2_source_verification_failed",
          });
        }
        let sourceReceipts;
        try {
          sourceReceipts = sourceVerification.receipts.map((receipt) => {
            const auditReceipt = evidence.append(
              req.tenantId,
              "nyra_deep_v2_source_verified",
              {
                issuer: receipt.issuer,
                source_id: receipt.source_id,
                registry_source_id: receipt.registry_source_id,
                source_type: receipt.source_type,
                reliability_score: receipt.reliability_score,
                source_url_sha256: receipt.source_url_sha256,
                content_sha256: receipt.content_sha256,
                excerpt_sha256: receipt.excerpt_sha256,
                content_type: receipt.content_type,
                fetched_at: receipt.fetched_at,
                expires_at: receipt.expires_at,
                request_id: coreRequestId,
                branch_id: branchId,
                subbranch_id: subbranchId,
              },
            );
            return {
              ...receipt,
              receipt_id: auditReceipt.evidence_id,
            };
          });
        } catch {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: "nyra_deep_branch_v2_source_receipt_unavailable",
          });
        }
        const coreBoundEvidencePack = coreBindNyraDeepV2EvidencePack({
          evidencePack: boundedEvidence.evidence_pack,
          bindings: normalizedBindings.bindings,
          sourceReceipts,
          tenantId: req.tenantId,
          requestId: coreRequestId,
          branchId,
          subbranchId,
          workPreflight,
        });
        let researchValidation;
        try {
          const trustedReceiptsBySource = new Map(
            sourceReceipts.map((receipt) => [receipt.source_id, receipt]),
          );
          researchValidation = validateResearchEvidence({
            question: String(
              coreBoundEvidencePack.research_question
                || `Nyra Deep V2 evidence for ${branchId}.${subbranchId}`,
            ).slice(0, 2_000),
            sources: coreBoundEvidencePack.sources.map((source) => ({
              ...source,
              source_type: trustedReceiptsBySource.get(String(source?.id || ""))
                ?.source_type || "other",
            })),
            claims: coreBoundEvidencePack.claims,
          });
        } catch {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: "nyra_deep_branch_v2_research_validation_rejected",
          });
        }
        const validated = coreValidatedNyraDeepV2Claims(
          coreBoundEvidencePack,
          researchValidation,
          sourceReceipts,
        );
        let ingested;
        try {
          ingested = nyraDeepV2Ledger.ingestResearchEvidence({
            tenantId: req.tenantId,
            requestId: coreRequestId,
            branchId,
            subbranchId,
            evidenceSessionId: `evs_${crypto.randomBytes(18).toString("hex")}`,
            evidencePack: {
              ...coreBoundEvidencePack,
              validated_claims: validated.validated_claims,
            },
            bindings: normalizedBindings.bindings,
          });
        } catch {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: "nyra_deep_branch_v2_evidence_ledger_unavailable",
          });
        }
        const evidenceRefs = Array.isArray(ingested?.evidence_refs)
          ? ingested.evidence_refs
            .map((item) => String(item?.record_ref || ""))
            .filter((ref) => NYRA_DEEP_V2_RECORD_REF_PATTERN.test(ref))
            .slice(0, 100)
          : [];
        const fullyPrepared = ingested?.ok === true
          && Array.isArray(ingested?.missing_bindings)
          && ingested.missing_bindings.length === 0
          && evidenceRefs.length >= normalizedBindings.bindings.length;
        if (!fullyPrepared) {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: "nyra_deep_branch_v2_core_evidence_not_qualified",
          });
        }
        return {
          schema_version: "nyra_deep_branch_v2_core_operation_v1",
          state: "evidence_prepared_v1_authoritative",
          request_id: coreRequestId,
          branch_id: branchId,
          subbranch_id: subbranchId,
          evidence: {
            state: ingested?.state || "evidence_rejected",
            evidence_refs: [...new Set(evidenceRefs)],
            validation: validated.compact_validation,
          },
          evaluation: {
            state: "not_requested_v1_authoritative",
            evaluated_node_count: 0,
          },
          execution_authorized: false,
          core_final_authority: true,
          fallback: "nyra_neural_branch_network_v1",
        };
      }
      if (deepBranchV2Operation === "evaluate") {
        const operationalContext = typeof nyraDeepBranchV2Client.beginOperational
          === "function"
          ? nyraDeepBranchV2Client.beginOperational({
            ...common,
            branchId,
            subbranchId,
          })
          : {
            ok: false,
            response: nyraDeepV2Fallback({
              requestId: coreRequestId,
              reason: "nyra_deep_branch_v2_client_operational_unavailable",
            }),
          };
        if (!operationalContext?.ok) {
          return operationalContext?.response || nyraDeepV2Fallback({
            requestId: coreRequestId,
            reason: "nyra_deep_branch_v2_operational_configuration_disabled",
          });
        }
        const evidenceRefs = boundedNyraDeepV2EvidenceRefs(
          deepBranchV2McpRequest.evidence_refs,
        );
        if (
          !evidenceRefs
          || evidenceRefs.length === 0
          || typeof nyraDeepV2Ledger.resolveEvidenceSession !== "function"
        ) {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: "nyra_deep_branch_v2_evidence_handoff_required",
          });
        }
        const evidenceSession = nyraDeepV2Ledger.resolveEvidenceSession({
          tenantId: req.tenantId,
          branchId,
          subbranchId,
          recordRefs: evidenceRefs,
        });
        if (!evidenceSession?.ok) {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "evidence_rejected_v1_authoritative",
            reason: evidenceSession?.reason
              || "nyra_deep_branch_v2_evidence_handoff_invalid",
          });
        }
        const policyBundle = issueNyraDeepV2PolicySnapshotBundle({
          keyRecord: req.coreKey,
          tenantId: req.tenantId,
          requestId: coreRequestId,
          branchId,
          subbranchId,
          workPreflight,
          nyraNetwork,
          bridgeResult: result,
          operationalContext,
        });
        if (!policyBundle.ok) {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "unavailable_v1_authoritative",
            reason: policyBundle.reason
              || "nyra_deep_branch_v2_policy_receipt_unavailable",
          });
        }
        const prepared = nyraDeepV2Attester.prepareOperational({
          tenantId: req.tenantId,
          requestId: coreRequestId,
          domainPackId: "skinharmony",
          entitlementDomainPackId: domainPackAccess.pack.id,
          branchId,
          subbranchId,
          preflightId: workPreflight.preflight_id,
          corePolicyHash:
            operationalContext.policy_hash
            || operationalContext.policyHash,
          envelopeBindingHash: operationalContext.envelope_binding_hash,
          issuedAt: operationalContext.issued_at,
          expiresAt: operationalContext.expires_at,
          observedAt: Date.now(),
          evidenceRefs,
          evidenceSessionRef: evidenceSession.evidence_session_ref,
          corePolicyContext: policyBundle.corePolicyContext,
        });
        if (!prepared?.ok) {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "unavailable_v1_authoritative",
            reason: prepared?.reason
              || "nyra_deep_branch_v2_attestation_unavailable",
          });
        }
        try {
          return await nyraDeepBranchV2Client.evaluateOperational({
            context: operationalContext,
            operationalAttestation: prepared.attestation,
          });
        } catch {
          return nyraDeepV2Fallback({
            requestId: coreRequestId,
            state: "unavailable_v1_authoritative",
            reason: "nyra_deep_branch_v2_operational_unavailable",
          });
        }
      }
      return nyraDeepV2Fallback({
        requestId: coreRequestId,
        state: "request_rejected_v1_authoritative",
        reason: "nyra_deep_branch_v2_operation_unsupported",
      });
    })();
    const guardedResult = {
      ...result,
      selected_by_core: {
        ...result.selected_by_core,
        can_execute: false,
      },
      automation_plan: {
        ...result.automation_plan,
        execution_allowed: false,
        next_step: result.automation_plan.owner_confirmation_required
          ? "Preparare runbook/evidence e chiedere conferma owner prima di ogni scrittura reale."
          : "Procedere soltanto in lettura, analisi o proposta nel perimetro tenant.",
      },
      core_branch_diagnostics: {
        ...(result.core_branch_diagnostics || {}),
        branch_router_used: true,
        actual_selected_branches: branchContext.selected_branches,
        actual_denied_branches: branchContext.denied_branches,
        actual_selected_groups: branchContext.selected_groups,
        actual_denied_groups: branchContext.denied_groups,
      },
      domain_pack: publicDomainPack(domainPackAccess.pack),
      nyra_neural_network: nyraNetwork,
      memory_context: memoryContext.value,
      work_preflight: workPreflight,
      deep_nyra_runtime: deepNyraRuntime,
      core_runtime: coreRuntimeDecision,
      ...(deepBranchV2Requested ? { deep_branch_v2: deepBranchV2 } : {}),
    };
    audit.append("core_nira_bridge_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      mode: guardedResult.mode,
      god_mode_active: guardedResult.god_mode_active,
      control_level: guardedResult.selected_by_core.control_level,
      risk_band: guardedResult.selected_by_core.risk_band,
      execution_allowed: guardedResult.automation_plan.execution_allowed,
      selected_branches: guardedResult.core_branch_diagnostics.actual_selected_branches,
      denied_branches: guardedResult.core_branch_diagnostics.actual_denied_branches,
      nyra_opened_branches: nyraNetwork.opened_branches.map((item) => item.id),
      memory_revision: memoryContext.value?.revision || 0,
      preflight_id: workPreflight.preflight_id,
      deep_runtime_mode: deepNyraRuntime.mode,
      deep_runtime_hard_block: deepNyraRuntime.owner_protection?.hard_block === true,
      core_runtime_route: coreRuntimeDecision.router.route,
      core_runtime_authority: coreRuntimeDecision.selected_authority,
      core_runtime_parity_matched: coreRuntimeDecision.parity.matched,
      deep_branch_v2_requested: deepBranchV2Requested,
      deep_branch_v2_operation: deepBranchV2Operation,
      deep_branch_v2_branch_id: deepBranchV2McpRequest.ok
        ? deepBranchV2McpRequest.branch_id
        : null,
      deep_branch_v2_subbranch_id: deepBranchV2McpRequest.ok
        ? deepBranchV2McpRequest.subbranch_id
        : null,
      deep_branch_v2_state: deepBranchV2?.state || null,
      deep_branch_v2_rollout_mode: deepBranchV2?.rollout_mode || null,
      deep_branch_v2_selected_branch_count: Array.isArray(
        deepBranchV2?.selected_branches,
      ) ? deepBranchV2.selected_branches.length : 0,
      deep_branch_v2_evaluated_node_count: Number.isInteger(
        Number(deepBranchV2?.evaluation?.evaluated_node_count),
      ) ? Number(deepBranchV2.evaluation.evaluated_node_count) : 0,
      deep_branch_v2_execution_allowed: false,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      domain_pack: publicDomainPack(domainPackAccess.pack),
      result: guardedResult,
      memory_context: memoryContext.value,
      work_preflight: workPreflight,
      branch_context: {
        selected_branches: branchContext.selected_branches,
        denied_branches: branchContext.denied_branches,
        selected_groups: branchContext.selected_groups,
        denied_groups: branchContext.denied_groups,
        tier: branchContext.tier,
      },
      guardrail: {
        execution_allowed: false,
        mandatory_preflight_completed: true,
        owner_confirmation_required: guardedResult.automation_plan.owner_confirmation_required,
        audit_required: true,
        mode: "nira_prepare_core_select_no_auto_execute",
      },
    });
  });

  app.post("/v1/content-guard/check", coreAuth(SCOPES.READ_DECISION), async (req, res) => {
    const resolution = resolveBranchesForKey(req.coreKey, ["ramo_testo"]);
    if (!resolution.selected_branches.includes("ramo_testo")) {
      audit.append("core_branch_denied", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, branch: "ramo_testo" });
      return publicError(res, 403, "branch_not_allowed", `Branch not allowed for tier ${resolution.tier}`);
    }

    const input = await buildTextBranchInput(req, req.body || {});
    const decision = runTextBranch(input);
    audit.append("core_content_guard_checked", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      issue_count: input.issues.length,
      state: decision.state,
      risk: decision.risk_band,
      publish_safe: decision.publish_safe,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      branch: "ramo_testo",
      decision,
      issue_count: input.issues.length,
      issues: input.issues.map((issue) => ({
        id: issue.id,
        type: issue.type,
        severity: issue.severity,
        start: issue.start,
        end: issue.end,
        original: issue.original,
        suggestions: issue.suggestions,
        message: issue.message,
        reason: issue.reason,
        safe_to_auto_apply: issue.safe_to_auto_apply,
      })),
      guardrail: {
        destructive_automation: false,
        execution_allowed: false,
        publish_requires_owner_confirmation: true,
        mode: "content_guard_review_only",
      },
      language_guard: {
        supported_locales: supportedLanguageGuardLocales(),
        local_dictionary_enabled: true,
        languagetool_enabled: process.env.LANGUAGETOOL_DISABLED === "1" || process.env.NODE_ENV === "test" ? false : true,
      },
    });
  });

  app.get("/v1/software-intelligence/components", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const resolution = resolveBranchesForKey(req.coreKey, ["software_binary_intelligence"]);
    if (!resolution.selected_branches.includes("software_binary_intelligence")) {
      audit.append("core_branch_denied", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        branch: "software_binary_intelligence",
      });
      return publicError(res, 403, "branch_not_allowed", `Branch not allowed for tier ${resolution.tier}`);
    }
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      branch: "software_binary_intelligence",
      maximum_artifact_bytes: MAX_EMBEDDED_ARTIFACT_BYTES,
      manifest: universalSoftwareComponentManifest({ configuredWorkers: Object.keys(options.softwareWorkerAdapters || {}) }),
      authorization_required: true,
      execution_supported: false,
    });
  });

  app.post("/v1/software-intelligence/jobs", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const resolution = resolveBranchesForKey(req.coreKey, ["software_binary_intelligence"]);
    if (!resolution.selected_branches.includes("software_binary_intelligence")) return publicError(res, 403, "branch_not_allowed");
    try {
      const verifiedGovernance = typeof options.softwareAuthorizationVerifier === "function"
        ? options.softwareAuthorizationVerifier({ tenant_id: req.tenantId, request: req.body, key: req.coreKey })
        : null;
      const job = softwareJobs.submit(req.body || {}, {
        tenant_id: req.tenantId,
        requested_tenant_id: req.body?.tenant_id,
        memory_available: options.memoryAvailable !== false,
        core_available: options.coreAvailable !== false,
        core_authorized: verifiedGovernance?.authorized === true,
        target_allowlist: verifiedGovernance?.target_allowlist || [],
      });
      audit.append("core_software_job_submitted", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        job_id: job.job_id,
        mode: job.mode,
        raw_artifact_persisted: false,
      });
      return res.status(202).json({ ok: true, job });
    } catch (error) {
      const code = String(error?.message || "software_job_rejected");
      const status = code === "software_artifact_too_large" ? 413 : 400;
      return publicError(res, status, code);
    }
  });

  app.post("/v1/software-intelligence/authorize", coreAuth(SCOPES.WRITE_RUNBOOK), (req, res) => {
    if (!options.softwareAuthorizationSecret) return publicError(res, 503, "software_authorization_issuer_unavailable");
    if (!req.body?.memory_context || typeof req.body.memory_context !== "object") return publicError(res, 400, "software_memory_required");
    const memoryContext = normalizeTenantMemoryContext(req.body.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
    const input = buildActionEvaluatorInput(req, req.coreKey);
    const output = runUniversalCore(input);
    const decisionContract = normalizeDecisionContract(output, { action_type: "software_analysis", publish_intent: false });
    const authorization = buildActionAuthorization(decisionContract, { ...req.body, action_type: "software_analysis", operation_class: "governed_deep_software_analysis" });
    if (!authorization.allowed) return res.status(403).json({ ok: false, error: authorization.state, authorization, decision_contract: decisionContract });
    try {
      const coreGovernance = issueSoftwareAuthorizationEnvelope({ secret: options.softwareAuthorizationSecret, tenantId: req.tenantId, allowedModes: req.body.allowed_modes, targetAllowlist: req.body.target_allowlist || [] });
      audit.append("core_software_authorization_issued", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, modes: req.body.allowed_modes, target_count: req.body.target_allowlist?.length || 0 });
      return res.status(201).json({ ok: true, tenant_id: req.tenantId, authorization, core_governance: coreGovernance });
    } catch (error) { return publicError(res, 400, error.message || "software_authorization_failed"); }
  });

  app.get("/v1/software-intelligence/jobs", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    res.json({ ok: true, tenant_id: req.tenantId, jobs: softwareJobs.list(req.tenantId) });
  });

  app.get("/v1/software-intelligence/jobs/:jobId", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const job = softwareJobs.get(req.params.jobId, req.tenantId);
    if (!job) return publicError(res, 404, "software_job_not_found");
    return res.json({ ok: true, job });
  });

  app.post("/v1/software-intelligence/correlate", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    try {
      const correlation = softwareJobs.correlate(req.body?.job_ids, req.tenantId);
      audit.append("core_software_evidence_correlated", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, source_job_ids: correlation.source_job_ids, raw_content_persisted: false });
      return res.json({ ok: true, correlation });
    } catch (error) { return publicError(res, 400, error.message || "software_correlation_failed"); }
  });

  app.post("/v1/software-intelligence/analyze", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const resolution = resolveBranchesForKey(req.coreKey, ["software_binary_intelligence"]);
    if (!resolution.selected_branches.includes("software_binary_intelligence")) {
      audit.append("core_branch_denied", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        branch: "software_binary_intelligence",
      });
      return publicError(res, 403, "branch_not_allowed", `Branch not allowed for tier ${resolution.tier}`);
    }

    try {
      const analysis = analyzeEmbeddedSoftwareArtifact({
        artifact: req.body?.artifact,
        authorization: req.body?.authorization,
        options: req.body?.options,
      });
      audit.append("core_software_artifact_analyzed", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        branch: "software_binary_intelligence",
        analysis_id: analysis.analysis_id,
        artifact_sha256: analysis.artifact.sha256,
        artifact_bytes: analysis.artifact.byte_length,
        artifact_format: analysis.executable.format,
        artifact_architecture: analysis.executable.architecture,
        authorization_basis: analysis.authorization.basis,
        purpose: analysis.authorization.purpose,
        raw_content_persisted: false,
      });
      return res.json({
        ok: true,
        tenant_id: req.tenantId,
        branch: "software_binary_intelligence",
        analysis,
        guardrail: {
          execution_allowed: false,
          static_observation_only: true,
          raw_content_persisted: false,
          patch_requires_separate_core_verdict: true,
          mode: "embedded_authorized_static_analysis",
        },
      });
    } catch (error) {
      const code = String(error?.message || "software_analysis_failed");
      const status = code === "software_artifact_too_large" ? 413 : 400;
      audit.append("core_software_artifact_analysis_rejected", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        branch: "software_binary_intelligence",
        reason: code,
      });
      return publicError(res, status, code);
    }
  });

  app.post("/v1/branches/:branch/analyze", coreAuth(SCOPES.READ_DECISION, { requireWorkPreflight: true }), async (req, res) => {
    const branch = String(req.params.branch || "").trim();
    const commercialResolution = resolveBranchesForKey(req.coreKey, [branch]);
    const ownerResolution = verifiedOwnerBranchProfile(
      req,
      [branch],
      "branch_analyze",
      ownerContextSigningSecret,
      { ...(req.body || {}), branch },
    );
    const ownerActiveAdvisory =
      ownerResolution.owner_profile === "tenant_scoped_verified_owner" &&
      ownerResolution.advisory_activation?.active_branches?.includes(branch);
    if (!commercialResolution.selected_branches.includes(branch) && !ownerActiveAdvisory) {
      audit.append("core_branch_denied", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, branch });
      return publicError(res, 403, "branch_not_allowed", `Branch not allowed for tier ${commercialResolution.tier}`);
    }
    const payload = buildBranchPayload(branch, { ...(req.body || {}), tenant_id: req.tenantId });
    if (!payload) return publicError(res, 404, "branch_not_found");
    const responseProfile = ownerActiveAdvisory
      ? applyOwnerActiveAdvisory({ [branch]: payload.profile }, ownerResolution.advisory_activation)[branch]
      : payload.profile;
    payload.core_input.context.tenant_id = req.tenantId;
    payload.core_input.constraints = safeConstraints(payload.core_input.constraints, req.coreKey, false);
    const output = runUniversalCore(payload.core_input);
    const causalContract = extendCausalBranchRegistry({ [branch]: branchRegistry()[branch] || {} })[branch];
    const causalResult = buildCausalBranchResult({
      context: req.body?.causal_context,
      contract: causalContract,
      input_state_digest: req.body?.causal_context?.project_state_digest || null,
      output_digest: causalDigest(output),
      decision: output.state || "ADVISORY",
      evidence: [],
      residual_risks: payload.warnings || [],
      obligation_state: "OBSERVING",
      causal_assurance_level: "CAL-1",
    });
    const causalValidation = validateCausalBranchInvocation({
      context: req.body?.causal_context,
      contract: causalContract,
      output: causalResult,
      authenticatedTenantId: req.tenantId,
    });
    let causalEnforcement = {
      schema_version: "causal_branch_enforcement_v1",
      rollout: { mode: "SHADOW", version: null, source: "causal_runtime_unavailable" },
      structural: causalValidation,
      authoritative_context: { valid: false, code: "CAUSAL_RUNTIME_NOT_READY" },
      enforcement_required: false,
      allowed: true,
      shadow_would_allow: false,
      code: "CAUSAL_BRANCH_SHADOW_OBSERVED",
    };
    if (causalBranchEnforcer) {
      causalEnforcement = await causalBranchEnforcer({
        tenant_id: req.tenantId,
        project_id: req.body?.project_id,
        context: req.body?.causal_context,
        signature: req.body?.causal_signature,
        agent_context_token: String(req.get("x-sh-dtt-agent-context") || "").trim(),
        authority_scope: Array.isArray(req.coreKey?.scopes)
          ? req.coreKey.scopes
          : Array.isArray(req.coreKey?.allowed_scopes) ? req.coreKey.allowed_scopes : [],
        contract: causalContract,
        output: causalResult,
      });
    }
    audit.append("core_branch_analyzed", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      branch,
      state: output.state,
      risk: output.risk?.band,
      production_status: payload.profile.production_status,
      activation_state: ownerActiveAdvisory ? "active_advisory" : "commercial_advisory",
      causal_rollout_mode: causalEnforcement.rollout.mode,
      causal_context_verified: causalEnforcement.authoritative_context.valid === true,
      causal_allowed: causalEnforcement.allowed,
    });
    if (!causalEnforcement.allowed) {
      return res.status(409).json({
        ok: false,
        error: "causal_branch_context_blocked",
        causal_continuity: causalEnforcement,
      });
    }
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      branch,
      profile: responseProfile,
      branch_output: payload.branch_output,
      warnings: payload.warnings,
      output,
      causal_continuity: {
        rollout_mode: causalEnforcement.rollout.mode,
        contract: causalContract,
        result: causalResult,
        validation: causalValidation,
        enforcement: causalEnforcement,
        execution_authorized: false,
      },
      guardrail: {
        destructive_automation: false,
        execution_allowed: false,
        publish_requires_owner_confirmation: true,
        mode: ownerActiveAdvisory
          ? "active_advisory"
          : payload.profile.production_status === "test_only" ? "test_only" : "advisory_only",
      },
    });
  });

  app.get("/v1/entity-graph", coreAuth(SCOPES.READ_DECISION), (req, res) => {
    const graph = entityGraph.readTenant(req.tenantId);
    audit.append("core_entity_graph_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, entities: graph.entities.length, relations: graph.relations.length });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      schema_version: "generic_entity_graph_v1",
      graph,
      primitive_types: ["tenant", "entity", "relation", "transaction", "policy", "event", "document", "product", "user", "license", "node"],
      rule: "Il Core resta orizzontale: i verticali sono dizionari/policy sopra il grafo generico.",
    });
  });

  app.post("/v1/entity-graph/upsert", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => {
    const graph = entityGraph.upsert(req.tenantId, req.body || {});
    const evidenceRecord = evidence.append(req.tenantId, "entity_graph_upserted", {
      key_id: req.coreKey.key_id,
      entity_count: graph.entities.length,
      relation_count: graph.relations.length,
    });
    audit.append("core_entity_graph_upserted", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, entities: graph.entities.length, relations: graph.relations.length });
    res.status(201).json({ ok: true, tenant_id: req.tenantId, graph, evidence: evidenceRecord });
  });

  app.post("/v1/snapshot", coreAuth(SCOPES.WRITE_SNAPSHOT), (req, res) => {
    const record = snapshots.append(req.tenantId, req.body?.source || "unknown", req.body?.payload || req.body || {});
    audit.append("core_snapshot_written", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, snapshot_id: record.snapshot_id });
    res.status(201).json({ ok: true, snapshot: record });
  });

  app.get("/v1/snapshot", coreAuth(SCOPES.READ_SNAPSHOT), (req, res) => {
    res.json({ ok: true, snapshot: snapshots.latest(req.tenantId) });
  });

  app.post("/v1/sync/suite", coreAuth(SCOPES.WRITE_SYNC_SUITE), (req, res) => {
    const record = snapshots.append(req.tenantId, "suite", req.body || {});
    audit.append("core_suite_sync_received", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, snapshot_id: record.snapshot_id });
    res.json({ ok: true, sync_status: "received", snapshot_id: record.snapshot_id });
  });

  app.post("/v1/sync/wordpress", coreAuth(SCOPES.WRITE_SYNC_WORDPRESS), (req, res) => {
    const record = snapshots.append(req.tenantId, "wordpress", req.body || {});
    audit.append("core_wordpress_sync_received", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, snapshot_id: record.snapshot_id });
    res.json({ ok: true, sync_status: "received", snapshot_id: record.snapshot_id });
  });

  app.post("/v1/policy/check", coreAuth(SCOPES.POLICY_CHECK), (req, res) => {
    const policy = req.body?.policy || {};
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const entitlement = buildEntitlement(req.coreKey, branchResolution);
    const tenantPolicy = getTenantPolicy(req.tenantId, req.body?.plan || req.coreKey?.metadata?.tier, {
      brandScope: req.coreKey?.brand_scope,
      metadata: req.coreKey?.metadata,
    });
    const mediation = evaluatePolicyEngine({
      tenantPolicy,
      entitlement,
      action: req.body?.action || req.body || {},
      policy,
      context: req.body?.context || {},
    });
    const result = {
      status: policy.approval_required ? "approval_required" : "ok",
      hard_block: false,
      owner_confirmation_required: Boolean(policy.approval_required),
      recommended_action: policy.approval_required ? "owner_review_before_execution" : "continue_with_audit",
      policy_engine: mediation,
    };
    audit.append("core_policy_checked", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, status: result.status, mediation: mediation.action_mediation.state });
    res.json({ ok: true, result });
  });

  app.post("/v1/action-mediation/evaluate", coreAuth(SCOPES.READ_DECISION, { requireWorkPreflight: true }), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const entitlement = buildEntitlement(req.coreKey, branchResolution);
    const tenantPolicy = getTenantPolicy(req.tenantId, req.body?.plan || req.coreKey?.metadata?.tier, {
      brandScope: req.coreKey?.brand_scope,
      metadata: req.coreKey?.metadata,
    });
    const result = evaluatePolicyEngine({
      tenantPolicy,
      entitlement,
      action: req.body?.action || req.body || {},
      policy: req.body?.policy || {},
      context: req.body?.context || {},
    });
    const evidenceRecord = evidence.append(req.tenantId, "action_mediation_evaluated", {
      request: req.body || {},
      result,
      key_id: req.coreKey.key_id,
    });
    audit.append("core_action_mediation_evaluated", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, state: result.action_mediation.state, evidence_id: evidenceRecord.evidence_id });
    res.json({ ok: true, result, evidence: evidenceRecord });
  });

  app.post("/v1/claim-guard/check", coreAuth(SCOPES.CLAIM_CHECK), (req, res) => {
    const result = claimGuardCheck(req.body || {});
    audit.append("core_claim_checked", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, status: result.status, issue_count: result.issue_count });
    res.json({ ok: true, result });
  });

  app.post("/v1/pricing-guard/check", coreAuth(SCOPES.PRICING_CHECK), (req, res) => {
    const result = pricingGuardCheck(req.body || {});
    audit.append("core_pricing_checked", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, status: result.status, issue_count: result.issue_count });
    res.json({ ok: true, result });
  });

  app.get("/v1/review/pending", coreAuth(SCOPES.READ_REVIEW), (req, res) => {
    res.json({ ok: true, reviews: reviews.pending(req.tenantId) });
  });

  app.post("/v1/review/action", coreAuth(SCOPES.WRITE_REVIEW), (req, res) => {
    const record = reviews.action(req.tenantId, req.body || {});
    if (!record) return publicError(res, 404, "review_not_found");
    audit.append("core_review_action", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, review_id: record.review_id, status: record.status });
    res.json({ ok: true, review: record });
  });

  app.get("/v1/audit/recent", coreAuth(SCOPES.ADMIN_TENANT), (req, res) => {
    res.json({ ok: true, audit: audit.recent(Number(req.query.limit || 50)).filter((event) => !req.tenantId || event.tenant_id === req.tenantId) });
  });

  app.get("/v1/icf/runtime/attestation", coreAuth(SCOPES.READ_EVIDENCE), (req, res) => {
    const readiness = icfRuntime.readiness();
    res.json({ ok: true, schema: "nyra.icf.runtime-attestation/1.0", build: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null, rollout: icf.rollout(), store: { kind: readiness.store_kind, contract: readiness.contract, restart_durable: readiness.restart_durable, distributed: readiness.distributed }, generic_work_core_join: readiness.generic_work_core_join, enforcement_allowed: readiness.enforcement_allowed });
  });

  app.use((req, res) => publicError(res, 404, "route_not_found"));

  async function shutdown() {
    const tasks = [];
    if (causalBootstrapConstructionProvenance.research_airlock
      && typeof researchAirlockRuntime?.store?.close === "function") {
      tasks.push(Promise.resolve().then(() => researchAirlockRuntime.store.close()));
    }
    for (const pool of internallyOwnedPostgresPools) {
      if (typeof pool?.end === "function") tasks.push(Promise.resolve().then(() => pool.end()));
    }
    await Promise.allSettled(tasks);
  }

  return { app, storageRoot, coreRuntime, shutdown };
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleEntity360Snapshot,
  compareEntity360Shadow,
  compileEntity360Ontology,
  compileEntity360Policy,
  entity360Digest,
  resolveEntity360Identity,
  verifyEntity360Snapshot,
} from "./entity360.js";
import {
  attestEntity360ShadowReceipt,
  buildVerifiedEntity360CurrentPathObservation,
  compareVerifiedEntity360CurrentPath,
} from "./entity360ShadowObservation.js";
import { createEntity360ProjectionCache } from "./entity360ProjectionCache.js";
import {
  buildEntity360BitemporalSnapshot,
  queryEntity360BitemporalSnapshot,
} from "./entity360Bitemporal.js";
import {
  buildEntity360EnforcementContract,
  compileEntity360EnforcementPolicy,
} from "./entity360Enforcement.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ENTITY_360_POLICY_PATH = path.resolve(__dirname, "../config/entity360-policy.v1.json");
export const DEFAULT_ENTITY_360_ONTOLOGY_PATH = path.resolve(__dirname, "../config/entity360-ontology.v1.json");
export const DEFAULT_ENTITY_360_ENFORCEMENT_POLICY_PATH = path.resolve(
  __dirname, "../config/entity360-enforcement-policy.v2.json",
);
const ENTITY_360_POLICY_REGISTRY_ID = "entity360-context-policy";
const ENTITY_360_ONTOLOGY_REGISTRY_ID = "entity360-context-ontology";
export const ENTITY_360_FEATURE_FLAG_AUTHORITY_SCOPE = "entity360:feature-flag:write";
export const ENTITY_360_SHADOW_OBSERVER_SCOPE = "entity360:shadow-observe";
export const ENTITY_360_CORE_ENFORCEMENT_SCOPE = "entity360:core-enforcement-context";

function fail(code, status = 422, details = undefined) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}

function text(value, code, max = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
}

function integer(value, code, minimum = 0) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < minimum) fail(code);
  return numeric;
}

function timestamp(value, fallback, code) {
  const milliseconds = Date.parse(String(value || fallback || ""));
  if (!Number.isFinite(milliseconds)) fail(code);
  return new Date(milliseconds).toISOString();
}

function readJson(filePath, code) {
  let value;
  try { value = JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (error) { fail(code, 503, { reason: String(error?.code || error?.message || "read_failed").slice(0, 120) }); }
  return value;
}

export function loadEntity360Configuration({ policyPath = DEFAULT_ENTITY_360_POLICY_PATH,
  ontologyPath = DEFAULT_ENTITY_360_ONTOLOGY_PATH,
  enforcementPolicyPath = DEFAULT_ENTITY_360_ENFORCEMENT_POLICY_PATH } = {}) {
  const policy = compileEntity360Policy(readJson(policyPath, "entity360_policy_load_failed"));
  const ontology = compileEntity360Ontology(readJson(ontologyPath, "entity360_ontology_load_failed"));
  const enforcementPolicy = compileEntity360EnforcementPolicy(readJson(
    enforcementPolicyPath, "entity360_enforcement_policy_load_failed",
  ));
  return Object.freeze({ policy, ontology, enforcement_policy: enforcementPolicy,
    policy_path: policyPath, ontology_path: ontologyPath,
    enforcement_policy_path: enforcementPolicyPath });
}

export function normalizeEntity360Mode(value = "OFF") {
  const requested = String(value || "OFF").trim().toUpperCase();
  const mode = requested === "ENFORCED" ? "ENFORCE" : requested;
  if (!["OFF", "SHADOW", "ENFORCE"].includes(mode)) fail("entity360_mode_invalid");
  return mode;
}

function normalizeEntity360BitemporalMode(value = "OFF") {
  const requested = String(value || "OFF").trim().toUpperCase();
  const mode = requested === "ENFORCED" ? "ENFORCE" : requested;
  if (!["OFF", "SHADOW", "ENFORCE"].includes(mode)) {
    fail("entity360_bitemporal_mode_invalid", 503);
  }
  return mode;
}

function normalizeTenantFeatureMode(value = "OFF") {
  const requested = String(value || "OFF").trim().toUpperCase();
  const mode = requested === "ENFORCE" ? "ENFORCED" : requested;
  if (!["OFF", "SHADOW", "ENFORCED"].includes(mode)) {
    fail("entity360_feature_mode_invalid");
  }
  return mode;
}

function requireIdentity(identity) {
  if (!identity?.tenant_id || !identity?.actor_id || !identity?.provenance?.session_fingerprint) {
    fail("entity360_dtt_identity_required", 401);
  }
  return identity;
}

function requireFeatureFlagAuthority(identity) {
  const scopes = Array.isArray(identity?.authority_scope) ? identity.authority_scope : [];
  if (identity?.actor_role !== "universal_core_operator"
    || identity?.provenance?.actor_provenance !== "universal_core_platform_auth"
    || scopes.length !== 1 || scopes[0] !== ENTITY_360_FEATURE_FLAG_AUTHORITY_SCOPE) {
    fail("entity360_feature_flag_authority_required", 403);
  }
}

function requireShadowObserverAuthority(identity) {
  const scopes = Array.isArray(identity?.authority_scope) ? identity.authority_scope : [];
  if (identity?.actor_id !== "universal_core:work_preflight_shadow_observer"
    || identity?.actor_role !== "universal_core_shadow_observer"
    || identity?.provenance?.actor_provenance !== "universal_core_server_internal"
    || scopes.length !== 1 || scopes[0] !== ENTITY_360_SHADOW_OBSERVER_SCOPE) {
    fail("entity360_shadow_observer_authority_required", 403);
  }
}

function requireCoreEnforcementAuthority(identity) {
  const scopes = Array.isArray(identity?.authority_scope) ? identity.authority_scope : [];
  if (identity?.actor_id !== "universal_core:semantic_scope_context_resolver"
    || identity?.actor_role !== "universal_core_context_resolver"
    || identity?.provenance?.actor_provenance !== "universal_core_server_internal"
    || scopes.length !== 1 || scopes[0] !== ENTITY_360_CORE_ENFORCEMENT_SCOPE) {
    fail("entity360_core_enforcement_authority_required", 403);
  }
}

function requireInputTenant(identity, input) {
  if (input.tenant_id !== undefined && input.tenant_id !== identity.tenant_id) {
    fail("entity360_cross_tenant_request", 403);
  }
}

function requireWorkBinding(identity, input) {
  const requested = text(input?.work_id, "entity360_dtt_work_id_required", 160);
  if (!identity?.work_id || String(identity.work_id).trim().toLowerCase() !== requested.toLowerCase()) {
    fail("entity360_dtt_work_binding_mismatch", 403);
  }
  return requested;
}

function requireCanonicalWorkBinding(workId, identity) {
  const requested = workId.toLowerCase();
  const bindings = [identity?.work_id, identity?.legacy_work_id]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).trim().toLowerCase());
  if (!bindings.includes(requested)) {
    fail("entity360_canonical_work_binding_mismatch", 403);
  }
}

function requireSnapshotWorkBinding(snapshot, workId) {
  const requested = workId.toLowerCase();
  const bindings = [snapshot?.project_work_linkage?.work_id,
    snapshot?.project_work_linkage?.legacy_work_id]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).trim().toLowerCase());
  if (!bindings.includes(requested)) {
    fail("entity360_cross_work_snapshot", 403);
  }
}

function snapshotScope(input) {
  return {
    tenant_id: input.tenant_id,
    entity_id: text(input.entity_id, "entity360_entity_id_required", 160),
    snapshot_version: integer(input.snapshot_version, "entity360_snapshot_version_required", 1),
  };
}

function verifyProjectWorkSelector(requested, discovered) {
  if (requested === undefined || requested === null) return;
  if (!requested || typeof requested !== "object" || Array.isArray(requested)) {
    fail("entity360_project_work_linkage_invalid");
  }
  const allowed = new Set(["work_id", "legacy_work_id", "project_id", "component_id"]);
  for (const [key, value] of Object.entries(requested)) {
    if (!allowed.has(key)) fail("entity360_project_work_linkage_invalid");
    if (value !== null && value !== undefined && String(value) !== String(discovered?.[key] ?? "")) {
      fail("entity360_project_work_linkage_mismatch", 409, { field: key });
    }
  }
}

function verifyResolvedLinkage(entityType, resolvedIdentity, discovered) {
  const bindings = entityType === "work"
    ? [["work_id", "work_id"], ["legacy_work_id", "legacy_work_id"]]
    : entityType === "software_component"
      ? [["work_id", "work_id"], ["node_id", "component_id"]] : [];
  for (const [identityKey, linkageKey] of bindings) {
    const expected = resolvedIdentity?.[identityKey];
    if (expected !== undefined && expected !== null
      && String(discovered?.[linkageKey] || "") !== String(expected)) {
      fail("entity360_consistent_cut_identity_mismatch", 409, { field: linkageKey });
    }
  }
}

function safeCounter() {
  return {
    assemblies: 0,
    assembly_latency_ms_total: 0,
    source_count_total: 0,
    source_occupancy_total: 0,
    source_diversity_total: 0,
    corroboration_coverage_total: 0,
    rejected_source_contributions: 0,
    limited_source_contributions: 0,
    completeness_total: 0,
    stale_source_count: 0,
    contradiction_count: 0,
    missing_required_context_count: 0,
    snapshot_rebuild_count: 0,
    resolver_attempt_count: 0,
    resolver_ambiguity_count: 0,
    core_hold_count: 0,
    core_hold_correlated_count: 0,
    core_insufficient_context_count: 0,
    core_insufficient_context_correlated_count: 0,
    shadow_comparison_count: 0,
    shadow_divergence_count: 0,
    unverified_shadow_comparison_count: 0,
    bitemporal_query_count: 0,
    bitemporal_query_latency_ms_total: 0,
    bitemporal_snapshot_reconstruction_count: 0,
    bitemporal_snapshot_reconstruction_latency_ms_total: 0,
    hindsight_leakage_prevented_count: 0,
  };
}

function boundedRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.min(1, Math.max(0, numerator / denominator));
}

function countCoreOutcomeCorrelation(counter, receipt, snapshot) {
  if (receipt?.release_evidence_eligible !== true) return;
  const outcome = String(receipt.legacy_outcome || "").toUpperCase();
  const contextStatus = String(snapshot?.context_status || "").toUpperCase();
  if (outcome === "HOLD") {
    counter.core_hold_count += 1;
    if (["INCOMPLETE", "CONFLICTED", "AMBIGUOUS"].includes(contextStatus)) {
      counter.core_hold_correlated_count += 1;
    }
  }
  if (outcome === "INSUFFICIENT_CONTEXT") {
    counter.core_insufficient_context_count += 1;
    if (contextStatus === "INCOMPLETE") counter.core_insufficient_context_correlated_count += 1;
  }
}

function publicMetrics(counter, storeMetrics, mode, policy, ontology) {
  const divisor = Math.max(1, counter.assemblies);
  return Object.freeze({
    schema_version: "entity_360_metrics_v1",
    metrics_scope: "runtime_process",
    mode,
    policy_version: policy.policy_version,
    policy_digest: policy.policy_digest,
    ontology_version: ontology.ontology_version,
    context_assembly_latency_ms: counter.assembly_latency_ms_total / divisor,
    source_count: counter.source_count_total / divisor,
    source_occupancy: counter.source_occupancy_total / divisor,
    source_diversity: counter.source_diversity_total / divisor,
    corroboration_coverage: counter.corroboration_coverage_total / divisor,
    rejected_source_contributions: counter.rejected_source_contributions,
    limited_source_contributions: counter.limited_source_contributions,
    completeness: counter.completeness_total / divisor,
    stale_source_count: counter.stale_source_count,
    contradiction_count: counter.contradiction_count,
    missing_required_context_count: counter.missing_required_context_count,
    snapshot_rebuild_rate: counter.snapshot_rebuild_count / divisor,
    resolver_attempt_count: counter.resolver_attempt_count,
    resolver_ambiguity_count: counter.resolver_ambiguity_count,
    entity_resolver_ambiguity_rate: boundedRatio(counter.resolver_ambiguity_count,
      counter.resolver_attempt_count),
    core_hold_count: counter.core_hold_count,
    core_hold_correlated_count: counter.core_hold_correlated_count,
    core_hold_correlation_rate: boundedRatio(counter.core_hold_correlated_count,
      counter.core_hold_count),
    core_insufficient_context_count: counter.core_insufficient_context_count,
    core_insufficient_context_correlated_count: counter.core_insufficient_context_correlated_count,
    core_insufficient_context_correlation_rate: boundedRatio(
      counter.core_insufficient_context_correlated_count, counter.core_insufficient_context_count),
    shadow_comparison_count: counter.shadow_comparison_count,
    shadow_divergence_count: counter.shadow_divergence_count,
    unverified_shadow_comparison_count: counter.unverified_shadow_comparison_count,
    bitemporal_query_latency: counter.bitemporal_query_count
      ? counter.bitemporal_query_latency_ms_total / counter.bitemporal_query_count : 0,
    snapshot_reconstruction_latency: counter.bitemporal_snapshot_reconstruction_count
      ? counter.bitemporal_snapshot_reconstruction_latency_ms_total /
        counter.bitemporal_snapshot_reconstruction_count : 0,
    historical_replay_latency: counter.bitemporal_query_count
      ? counter.bitemporal_query_latency_ms_total / counter.bitemporal_query_count : 0,
    hindsight_leakage_prevented: counter.hindsight_leakage_prevented_count,
    persisted: storeMetrics || null,
    execution_authorized: false,
  });
}

export function createEntity360Runtime({ store, adapterRegistry, policy, ontology, mode = "OFF",
  enforcementPolicy, qualificationSigner, qualificationVerifier,
  bitemporalMode = "OFF", now = () => Date.now() } = {}) {
  if (!store || typeof store.writeSnapshot !== "function"
    || typeof store.readSnapshotWriteReplay !== "function"
    || typeof store.registerDefinition !== "function" || typeof store.readRegistry !== "function"
    || typeof store.readLatestSnapshot !== "function" || typeof store.readSnapshot !== "function"
    || typeof store.readHead !== "function" || typeof store.writeShadowReceipt !== "function"
    || typeof store.health !== "function") {
    fail("entity360_store_required", 503);
  }
  if (!adapterRegistry || typeof adapterRegistry.discover !== "function"
    || typeof adapterRegistry.resolveCandidates !== "function"
    || typeof adapterRegistry.assembleContext !== "function") fail("entity360_adapter_registry_required", 503);
  if (!qualificationSigner || typeof qualificationSigner.sign !== "function") {
    fail("entity360_qualification_signer_required", 503);
  }
  if (!qualificationVerifier || typeof qualificationVerifier.verify !== "function"
    || typeof qualificationVerifier.sign === "function") {
    fail("entity360_qualification_verifier_required", 503);
  }
  const configuredMode = normalizeEntity360Mode(mode);
  const configuredBitemporalMode = normalizeEntity360BitemporalMode(bitemporalMode);
  const compiledPolicy = policy?.policy_digest ? policy : compileEntity360Policy(policy);
  const compiledOntology = compileEntity360Ontology(ontology);
  if (compiledPolicy.mode !== "SHADOW") fail("entity360_shadow_policy_required", 503);
  const compiledEnforcementPolicy = configuredMode === "ENFORCE"
    ? enforcementPolicy?.policy_digest ? enforcementPolicy
      : compileEntity360EnforcementPolicy(enforcementPolicy)
    : null;
  if (configuredMode === "ENFORCE" && configuredBitemporalMode !== "ENFORCE") {
    fail("entity360_enforcement_bitemporal_required", 503);
  }
  if (configuredMode === "ENFORCE" && typeof adapterRegistry.health !== "function") {
    fail("entity360_enforcement_adapter_readiness_required", 503);
  }
  const enforcementContract = compiledEnforcementPolicy
    ? buildEntity360EnforcementContract({ policy: compiledEnforcementPolicy,
      contextPolicy: compiledPolicy, ontology: compiledOntology, adapterRegistry })
    : null;
  const ontologySourceClasses = new Set(compiledOntology.source_classes);
  const ontologyTrustBoundaries = new Set(compiledOntology.trust_boundaries);
  for (const source of Object.values(compiledPolicy.source_registry)) {
    if (!ontologySourceClasses.has(source.source_class)
      || !ontologyTrustBoundaries.has(source.trust_boundary)) {
      fail("entity360_policy_ontology_binding_invalid", 503, { source_id: source.source_id });
    }
  }
  const metrics = safeCounter();
  const projectionCache = createEntity360ProjectionCache({ policy: compiledPolicy,
    ontology: compiledOntology, qualificationVerifier, now });
  let state = "created";
  let initializationError = null;
  let operationalError = null;
  let lastStoreHealth = null;
  let lastAdapterHealth = null;
  let storeHealthCheckInFlight = null;
  let adapterHealthCheckInFlight = null;

  function storeHealthFailureReason(value) {
    if (!value || value.ok !== true) return String(value?.error || "store_health_not_ok").slice(0, 160);
    if (value.schema_verified !== true) return "entity360_store_schema_unverified";
    if (value.migration?.application_state !== "COMPLETED") {
      return "entity360_store_migration_not_completed";
    }
    if (value.migration?.checkpoint !== "READBACK_VERIFIED") {
      return "entity360_store_migration_readback_unverified";
    }
    if (configuredMode === "ENFORCE") {
      const enforcementMigration = Array.isArray(value.migrations)
        ? value.migrations.find((item) => item?.migration_id === enforcementContract.migration_id)
        : null;
      if (value.kind !== enforcementContract.store_backend
        && value.backend !== enforcementContract.store_backend) {
        return "entity360_enforcement_store_backend_invalid";
      }
      if (enforcementMigration?.application_state !== "COMPLETED"
        || enforcementMigration?.checkpoint !== "READBACK_VERIFIED"
        || value.feature_v2_mode_guard !== true) {
        return "entity360_enforcement_migration_unverified";
      }
    }
    return null;
  }

  function adapterHealthFailureReason(value) {
    if (configuredMode !== "ENFORCE") return null;
    if (!value || value.ready !== true || value.state !== "ready"
      || value.registry_schema_version !== enforcementContract.adapter_registry_schema_version
      || value.read_only !== true || value.provider_mutation !== false
      || !Array.isArray(value.adapter_versions)
      || entity360Digest([...new Set(value.adapter_versions.map(String))].sort()) !==
        entity360Digest(enforcementContract.adapter_versions)) {
      return "entity360_enforcement_adapter_registry_unverified";
    }
    return null;
  }

  async function readOperationalStoreHealth() {
    if (storeHealthCheckInFlight) return storeHealthCheckInFlight;
    const check = Promise.resolve().then(() => store.health());
    storeHealthCheckInFlight = check;
    try {
      const result = await check;
      lastStoreHealth = result;
      return result;
    } finally {
      if (storeHealthCheckInFlight === check) storeHealthCheckInFlight = null;
    }
  }

  async function readOperationalAdapterHealth() {
    if (configuredMode !== "ENFORCE") return null;
    if (adapterHealthCheckInFlight) return adapterHealthCheckInFlight;
    const check = Promise.resolve().then(() => adapterRegistry.health());
    adapterHealthCheckInFlight = check;
    try {
      const result = await check;
      lastAdapterHealth = result;
      return result;
    } finally {
      if (adapterHealthCheckInFlight === check) adapterHealthCheckInFlight = null;
    }
  }

  function latchOperationalFailure(reason) {
    operationalError = String(reason || "entity360_store_verification_failed").slice(0, 160);
    if (state === "ready") state = "store_verification_failed";
  }

  async function requireOperationalStore() {
    if (operationalError) {
      fail("entity360_store_verification_failed", 503, { reason: operationalError });
    }
    let storeHealth;
    try {
      storeHealth = await readOperationalStoreHealth();
    } catch (error) {
      latchOperationalFailure(error?.code || error?.message || "store_health_failed");
      fail("entity360_store_verification_failed", 503, { reason: operationalError });
    }
    const reason = storeHealthFailureReason(storeHealth);
    if (reason) {
      latchOperationalFailure(reason);
      fail("entity360_store_verification_failed", 503, { reason });
    }
    return storeHealth;
  }

  async function requireOperationalAdapterRegistry() {
    if (configuredMode !== "ENFORCE") return null;
    if (operationalError) {
      fail("entity360_adapter_registry_verification_failed", 503, { reason: operationalError });
    }
    let adapterHealth;
    try {
      adapterHealth = await readOperationalAdapterHealth();
    } catch (error) {
      latchOperationalFailure(error?.code || error?.message ||
        "entity360_enforcement_adapter_registry_unavailable");
      fail("entity360_adapter_registry_verification_failed", 503, { reason: operationalError });
    }
    const reason = adapterHealthFailureReason(adapterHealth);
    if (reason) {
      latchOperationalFailure(reason);
      fail("entity360_adapter_registry_verification_failed", 503, { reason });
    }
    return adapterHealth;
  }

  async function requireEnforcementReadiness() {
    if (configuredMode !== "ENFORCE" || state !== "ready") {
      fail("entity360_enforcement_runtime_not_ready", 503);
    }
    const [storeHealth, adapterHealth] = await Promise.all([
      requireOperationalStore(), requireOperationalAdapterRegistry(),
    ]);
    return { storeHealth, adapterHealth };
  }

  function healthPayload(storeHealth, adapterHealth = lastAdapterHealth) {
    const storeReady = storeHealthFailureReason(storeHealth) === null;
    const adapterReady = adapterHealthFailureReason(adapterHealth) === null;
    const enforcementReady = configuredMode !== "ENFORCE" || (
      storeReady && adapterReady && configuredBitemporalMode === "ENFORCE"
      && enforcementContract?.authority_owner === "UNIVERSAL_CORE"
      && enforcementContract?.provider_mutation === false
      && enforcementContract?.entity360_self_approval === false
    );
    const ready = ["SHADOW", "ENFORCE"].includes(configuredMode) && state === "ready"
      && storeReady && adapterReady && enforcementReady && operationalError === null;
    return Object.freeze({
      schema_version: configuredMode === "ENFORCE"
        ? "entity_360_health_v2" : "entity_360_health_v1",
      ok: ready,
      ready,
      state,
      mode: configuredMode,
      policy_version: compiledPolicy.policy_version,
      policy_digest: compiledPolicy.policy_digest,
      ontology_version: compiledOntology.ontology_version,
      canonicalization_version: "entity_360_canonical_json_v1",
      snapshot_schema_version: ["SHADOW", "ENFORCE"].includes(configuredBitemporalMode)
        ? "entity_360_snapshot_v2" : "entity_360_snapshot_v1",
      bitemporal_mode: configuredBitemporalMode,
      adapter_registry_version: adapterRegistry.schema_version || "entity_360_adapter_registry_v1",
      adapter_versions: adapterRegistry.adapter_versions || [],
      adapter_registry_ready: configuredMode !== "ENFORCE" || adapterReady,
      adapter_registry_state: configuredMode === "ENFORCE"
        ? adapterHealth?.state || "unavailable" : "not_required",
      backend: storeHealth?.backend || store.kind || "postgresql",
      migration: storeHealth?.migration || null,
      initialization_error: initializationError,
      operational_error: operationalError,
      schema_verified: storeHealth?.schema_verified === true,
      shadow_non_mutating: configuredMode === "SHADOW",
      context_non_authoritative: true,
      qualification_attestation_required: true,
      core_independent_verification_required: true,
      enforcement_ready: configuredMode === "ENFORCE" && enforcementReady,
      enforcement_policy_version: compiledEnforcementPolicy?.policy_version || null,
      enforcement_policy_digest: compiledEnforcementPolicy?.policy_digest || null,
      enforcement_authority_digest: enforcementContract?.enforcement_authority_digest || null,
      enforcement_migration_id: enforcementContract?.migration_id || null,
      authority_owner: "UNIVERSAL_CORE",
      decision_receipt_schema_version:
        enforcementContract?.decision_receipt_schema_version || null,
      core_decision_only: true,
      entity360_self_approval: false,
      provider_mutation: false,
      execution_authorized: false,
    });
  }

  async function initialize() {
    if (state === "ready") return health();
    if (state === "initializing") fail("entity360_initialization_in_progress", 503);
    state = "initializing";
    operationalError = null;
    lastStoreHealth = null;
    try {
      if (typeof store.initialize !== "function") fail("entity360_store_initialize_required", 503);
      await store.initialize();
      const [storeHealth, adapterHealth] = await Promise.all([
        requireOperationalStore(), requireOperationalAdapterRegistry(),
      ]);
      state = "ready";
      initializationError = null;
      return healthPayload(storeHealth, adapterHealth);
    } catch (error) {
      state = "initialization_failed";
      initializationError = String(error?.code || error?.message || "entity360_initialization_failed").slice(0, 160);
      throw error;
    }
  }

  async function health() {
    if (operationalError) return healthPayload(lastStoreHealth || {
      ok: false, schema_verified: false, error: operationalError,
    }, lastAdapterHealth);
    let storeHealth; let adapterHealth = lastAdapterHealth;
    try {
      [storeHealth, adapterHealth] = await Promise.all([
        readOperationalStoreHealth(), readOperationalAdapterHealth(),
      ]);
    } catch (error) {
      storeHealth = { ok: false, schema_verified: false,
        error: String(error?.code || error?.message || "store_health_failed").slice(0, 160) };
      lastStoreHealth = storeHealth;
    }
    const reason = storeHealthFailureReason(storeHealth)
      || adapterHealthFailureReason(adapterHealth);
    if (state === "ready" && reason) latchOperationalFailure(reason);
    return healthPayload(storeHealth, adapterHealth);
  }

  async function resolve(identity, input) {
    const workId = requireWorkBinding(identity, input);
    requireCanonicalWorkBinding(workId, input.identity);
    await requireTenantActiveMode(identity.tenant_id);
    const discovered = await adapterRegistry.resolveCandidates({
      tenant_id: identity.tenant_id,
      entity_type: input.entity_type,
      identity: input.identity,
      project_work_linkage: input.project_work_linkage || {},
    });
    metrics.resolver_attempt_count += 1;
    const resolution = resolveEntity360Identity({ tenant_id: identity.tenant_id,
      entity_type: input.entity_type, entity_id: input.entity_id, identity: input.identity,
      candidates: discovered.candidates || [], require_existing: true });
    if (resolution.status === "RESOLVED") requireCanonicalWorkBinding(workId, resolution.identity);
    verifyProjectWorkSelector(input.project_work_linkage, discovered.project_work_linkage || {});
    if (resolution.status === "AMBIGUOUS") metrics.resolver_ambiguity_count += 1;
    return Object.freeze({ ...resolution, source_discovery: discovered.source_discovery || [],
      core_review_requirement: resolution.status === "AMBIGUOUS"
        ? { condition: "AMBIGUOUS_ENTITY_RESOLUTION", admissible_outcomes: ["HOLD"] }
        : resolution.status === "UNRESOLVED"
          ? { condition: "ENTITY_NOT_FOUND", admissible_outcomes: ["INSUFFICIENT_CONTEXT", "HOLD"] }
        : { condition: "ENTITY_RESOLVED", admissible_outcomes: ["ALLOW", "HOLD", "BLOCK", "INSUFFICIENT_CONTEXT"] } });
  }

  async function tenantMode(tenantId, { statementTimeoutMs = null } = {}) {
    if (typeof store.readFeatureFlag !== "function") return {
      mode: "OFF", enabled: false, revision: 0, source: "tenant_feature_flag_default_off",
    };
    const flag = await store.readFeatureFlag({ tenant_id: tenantId, flag_id: "entity360",
      ...(statementTimeoutMs === null ? {} : { statement_timeout_ms: statementTimeoutMs }) });
    if (!flag) return { mode: "OFF", enabled: false, revision: 0,
      source: "tenant_feature_flag_default_off" };
    const modeValue = String(flag.mode || "OFF").toUpperCase();
    if (flag.enabled !== true || modeValue === "OFF") return { ...flag, mode: "OFF", enabled: false,
      source: "tenant_feature_flag" };
    if (!["SHADOW", "ENFORCED"].includes(modeValue)) {
      fail("entity360_tenant_feature_mode_unsupported", 403);
    }
    if (flag.policy_digest !== compiledPolicy.policy_digest) {
      fail("entity360_tenant_policy_binding_mismatch", 409);
    }
    if (modeValue === "ENFORCED") {
      if (configuredMode !== "ENFORCE" || !enforcementContract
        || flag.enforcement_authority_digest !==
          enforcementContract.enforcement_authority_digest) {
        fail("entity360_tenant_enforcement_authority_mismatch", 409);
      }
    } else if (flag.enforcement_authority_digest !== null
      && flag.enforcement_authority_digest !== undefined) {
      fail("entity360_tenant_shadow_authority_invalid", 409);
    }
    return { ...flag, mode: modeValue, enabled: true, source: "tenant_feature_flag" };
  }

  async function requireTenantActiveMode(tenantId) {
    const feature = await tenantMode(tenantId);
    const eligible = configuredMode === "SHADOW"
      ? feature.mode === "SHADOW"
      : configuredMode === "ENFORCE"
        ? ["SHADOW", "ENFORCED"].includes(feature.mode)
        : false;
    if (!eligible || feature.enabled !== true) {
      fail(configuredMode === "SHADOW"
        ? "entity360_shadow_mode_required" : "entity360_active_mode_required", 503);
    }
    return feature;
  }

  async function requireTenantShadowMode(tenantId) {
    const feature = await tenantMode(tenantId);
    if (!["SHADOW", "ENFORCE"].includes(configuredMode)
      || feature.mode !== "SHADOW" || feature.enabled !== true) {
      fail("entity360_shadow_mode_required", 503);
    }
    return feature;
  }

  async function requireTenantEnforcedMode(tenantId) {
    await requireEnforcementReadiness();
    const feature = await tenantMode(tenantId);
    if (feature.mode !== "ENFORCED" || feature.enabled !== true) {
      fail("entity360_tenant_enforcement_required", 503);
    }
    return feature;
  }

  async function preflightObservationGate(rawIdentity, input = {}) {
    if (state !== "ready") fail("entity360_runtime_not_ready", 503);
    const identity = requireIdentity(rawIdentity);
    requireShadowObserverAuthority(identity);
    requireInputTenant(identity, input);
    const workId = requireWorkBinding(identity, input);
    // This pre-gate is deliberately limited to the tenant feature flag. Full
    // schema/readiness verification still runs before resolution, assembly or
    // observer source access; repeating it here would create a multi-query
    // resource leak before scheduler accounting. The Store binds the feature
    // read to a PostgreSQL statement_timeout from the versioned shadow policy.
    const feature = await tenantMode(identity.tenant_id, {
      statementTimeoutMs: compiledPolicy.shadow_observation.gate_timeout_ms,
    });
    const eligible = configuredMode === "SHADOW"
      && feature.mode === "SHADOW" && feature.enabled === true;
    return Object.freeze({
      schema_version: "entity_360_shadow_observation_gate_v1",
      eligible,
      reason: eligible ? null : "TENANT_ENTITY360_OFF",
      tenant_scope: identity.tenant_id,
      work_id: workId,
      feature_flag: Object.freeze({
        mode: feature.mode,
        enabled: feature.enabled,
        revision: Number(feature.revision || 0),
        source: feature.source,
      }),
      read_only: true,
      production_decision_changed: false,
      execution_authorized: false,
    });
  }

  async function ensureVerificationDefinitions(identity) {
    const ontologyDigest = entity360Digest(compiledOntology);
    await store.registerDefinition({ tenant_id: identity.tenant_id, kind: "POLICY",
      registry_id: ENTITY_360_POLICY_REGISTRY_ID, version: compiledPolicy.policy_version,
      payload: compiledPolicy, status: "ACTIVE", actor_id: identity.actor_id,
      idempotency_key: `entity360-policy-${compiledPolicy.policy_digest}` });
    await store.registerDefinition({ tenant_id: identity.tenant_id, kind: "ONTOLOGY",
      registry_id: ENTITY_360_ONTOLOGY_REGISTRY_ID, version: compiledOntology.ontology_version,
      payload: compiledOntology, status: "ACTIVE", actor_id: identity.actor_id,
      idempotency_key: `entity360-ontology-${ontologyDigest}` });
  }

  async function historicalVerificationContext(tenantId, snapshot) {
    const [policyRows, ontologyRows] = await Promise.all([
      store.readRegistry({ tenant_id: tenantId, kind: "POLICY",
        registry_id: ENTITY_360_POLICY_REGISTRY_ID, version: snapshot.policy_version }),
      store.readRegistry({ tenant_id: tenantId, kind: "ONTOLOGY",
        registry_id: ENTITY_360_ONTOLOGY_REGISTRY_ID, version: snapshot.ontology_version }),
    ]);
    if (policyRows.length !== 1 || ontologyRows.length !== 1) {
      fail("entity360_historical_verification_definition_missing", 503);
    }
    const policyRow = policyRows[0]; const ontologyRow = ontologyRows[0];
    if (policyRow.payload_digest !== entity360Digest(policyRow.payload)
      || ontologyRow.payload_digest !== entity360Digest(ontologyRow.payload)) {
      fail("entity360_historical_verification_definition_digest_invalid", 503);
    }
    const historicalPolicy = compileEntity360Policy(policyRow.payload);
    const historicalOntology = compileEntity360Ontology(ontologyRow.payload);
    if (historicalPolicy.policy_version !== snapshot.policy_version
      || historicalPolicy.policy_digest !== snapshot.policy_digest
      || historicalOntology.ontology_version !== snapshot.ontology_version
      || entity360Digest(historicalOntology) !== snapshot.ontology_digest) {
      fail("entity360_historical_verification_binding_invalid", 409);
    }
    return { policy: historicalPolicy, ontology: historicalOntology };
  }

  async function projectPersistedSnapshot(snapshot) {
    const tenantId = text(snapshot?.tenant_scope, "entity360_projection_tenant_required", 120);
    const entityId = text(snapshot?.entity_id, "entity360_projection_entity_required", 160);
    const head = await store.readHead({ tenant_id: tenantId, entity_id: entityId });
    return projectionCache.project({ snapshot, durable_head: head ? {
      tenant_id: tenantId,
      entity_id: entityId,
      snapshot_version: Number(head.current_snapshot_version),
      snapshot_digest: head.current_snapshot_digest,
    } : null });
  }

  async function assemble(identity, input) {
    const assemblyStartedAt = performance.now();
    const workId = requireWorkBinding(identity, input);
    requireCanonicalWorkBinding(workId, input.identity);
    const feature = await requireTenantActiveMode(identity.tenant_id);
    const contextMaterialFields = ["source_contributions", "resolution_candidates", "relationships",
      "dependencies", "architecture_state", "runtime_state", "concurrent_active_work",
      "agent_provider_state", "genesis_intent_icf_policy_bindings", "source_discovery",
      "snapshot_version", "created_at", "current_state", "evidence_references", "evidence_digests",
      "completeness", "confidence", "corroboration_state", "execution_authorized", "authority"];
    if (contextMaterialFields.some((field) => Object.hasOwn(input, field))) {
      fail("entity360_caller_supplied_source_material_forbidden", 403);
    }
    const idempotencyKey = text(input.idempotency_key, "entity360_idempotency_key_required", 240);
    const expectedRevision = integer(input.expected_revision, "entity360_expected_revision_required");
    const asOf = timestamp(input.as_of, new Date(now()).toISOString(), "entity360_as_of_invalid");
    const requestInput = { ...input };
    delete requestInput.tenant_id;
    const requestDigest = entity360Digest({
      schema_version: "entity_360_snapshot_assemble_request_v1",
      tenant_id: identity.tenant_id,
      actor_id: identity.actor_id,
      input: requestInput,
    });
    const prior = await store.readSnapshotWriteReplay({ tenant_id: identity.tenant_id,
      idempotency_key: idempotencyKey, request_digest: requestDigest });
    if (prior) {
      const persistedSnapshot = await store.readSnapshot({ tenant_id: identity.tenant_id,
        entity_id: prior.entity_id, snapshot_version: prior.snapshot_version });
      if (!persistedSnapshot) fail("entity360_replayed_snapshot_not_found", 503);
      if (persistedSnapshot.tenant_scope !== identity.tenant_id) {
        fail("entity360_cross_tenant_snapshot", 403);
      }
      return Object.freeze({ snapshot: persistedSnapshot,
        projection: await projectPersistedSnapshot(persistedSnapshot),
        persistence: { revision: prior.head_revision ?? prior.head_version ?? prior.snapshot_version,
          replayed: true, backend: prior.backend || store.kind || "postgresql" },
        feature_flag: { mode: feature.mode, enabled: feature.enabled, revision: Number(feature.revision || 0),
          source: feature.source },
        shadow_mode: feature.mode === "SHADOW",
        enforcement_mode: feature.mode === "ENFORCED",
        production_decision_changed: false, execution_authorized: false });
    }
    await ensureVerificationDefinitions(identity);
    const discovery = await adapterRegistry.assembleContext({ tenant_id: identity.tenant_id,
      entity_id: input.entity_id, entity_type: input.entity_type, identity: input.identity,
      as_of: asOf, project_work_linkage: input.project_work_linkage || {} });
    const resolutionCandidates = discovery.candidates || [];
    metrics.resolver_attempt_count += 1;
    const resolved = resolveEntity360Identity({ tenant_id: identity.tenant_id, entity_type: input.entity_type,
      entity_id: input.entity_id, identity: input.identity, candidates: resolutionCandidates,
      require_existing: true });
    if (discovery.resolution && (discovery.resolution.status !== resolved.status
      || discovery.resolution.entity_id !== resolved.entity_id
      || entity360Digest(discovery.resolution.identity) !== entity360Digest(resolved.identity))) {
      fail("entity360_consistent_cut_resolution_mismatch", 409);
    }
    if (resolved.status !== "RESOLVED") {
      if (resolved.status === "AMBIGUOUS") metrics.resolver_ambiguity_count += 1;
      fail(resolved.status === "AMBIGUOUS"
        ? "entity360_entity_resolution_ambiguous"
        : "entity360_entity_resolution_not_found", 409, {
        resolution_status: resolved.status,
        candidate_entity_ids: resolved.candidates,
        missing_disambiguation: resolved.missing_disambiguation,
        admissible_core_outcomes: resolved.status === "AMBIGUOUS"
          ? ["HOLD"] : ["INSUFFICIENT_CONTEXT", "HOLD"],
      });
    }
    requireCanonicalWorkBinding(workId, resolved.identity);
    verifyResolvedLinkage(input.entity_type, resolved.identity, discovery.project_work_linkage || {});
    verifyProjectWorkSelector(input.project_work_linkage, discovery.project_work_linkage || {});
    const previousSnapshot = expectedRevision > 0
      ? await store.readSnapshot({ tenant_id: identity.tenant_id, entity_id: resolved.entity_id,
        snapshot_version: expectedRevision }) : null;
    if (expectedRevision > 0 && !previousSnapshot) {
      fail("entity360_previous_snapshot_not_found", 409, { expected_revision: expectedRevision });
    }
    const createdAt = new Date(now()).toISOString();
    const snapshot = assembleEntity360Snapshot({
      tenant_id: identity.tenant_id,
      entity_type: input.entity_type,
      entity_id: resolved.entity_id,
      identity: input.identity,
      project_work_linkage: discovery.project_work_linkage || {},
      as_of: asOf,
      snapshot_version: expectedRevision + 1,
      previous_snapshot_digest: previousSnapshot?.deterministic_immutable_digest || null,
      resolution_candidates: resolutionCandidates,
      source_contributions: discovery.source_contributions || [],
      source_discovery: [
        ...(discovery.source_discovery || []),
        { source_id: "entity360_context_assembler", state: "complete",
          consistent_cut: discovery.consistent_cut || "unknown" },
      ],
    }, { policy: compiledPolicy, ontology: compiledOntology, created_at: createdAt,
      require_existing: true,
      bitemporal_mode: configuredBitemporalMode,
      adapter_registry_version: adapterRegistry.schema_version || "entity_360_adapter_registry_v1",
      qualification_signer: qualificationSigner });
    const selfVerification = verifyEntity360Snapshot(snapshot, {
      policy: compiledPolicy,
      ontology: compiledOntology,
      verification_time: createdAt,
      qualification_verifier: qualificationVerifier,
    });
    if (!selfVerification.valid) {
      fail("entity360_snapshot_self_verification_failed", 503, {
        reasons: selfVerification.reasons,
      });
    }
    const persisted = await store.writeSnapshot({ snapshot, idempotency_key: idempotencyKey,
      request_digest: requestDigest, actor_id: identity.actor_id, expected_head_version: expectedRevision,
      expected_revision: expectedRevision });
    const assemblyLatencyMs = Math.max(0, performance.now() - assemblyStartedAt);
    metrics.assemblies += 1;
    metrics.assembly_latency_ms_total += assemblyLatencyMs;
    metrics.source_count_total += snapshot.source_diversity.source_count;
    metrics.source_occupancy_total += Number(snapshot.assembly_report.occupancy.context_tokens || 0);
    metrics.source_diversity_total += snapshot.source_diversity.ratio;
    metrics.corroboration_coverage_total += snapshot.corroboration_state.coverage;
    metrics.rejected_source_contributions += snapshot.assembly_report.rejected_source_contribution_count;
    metrics.limited_source_contributions += snapshot.assembly_report.limited_source_contribution_count;
    metrics.completeness_total += snapshot.completeness;
    metrics.stale_source_count += snapshot.stale_sources.length;
    metrics.contradiction_count += snapshot.contradictions.length;
    metrics.missing_required_context_count += snapshot.missing_context.filter((item) => item.mandatory).length;
    if (persisted?.replayed === true) metrics.snapshot_rebuild_count += 1;
    const persistedSnapshot = await store.readSnapshot({ tenant_id: identity.tenant_id,
      entity_id: resolved.entity_id,
      snapshot_version: persisted?.snapshot_version || expectedRevision + 1 });
    if (!persistedSnapshot) fail("entity360_replayed_snapshot_not_found", 503);
    const bitemporalStartedAt = performance.now();
    const bitemporalSnapshot = configuredBitemporalMode === "SHADOW"
      ? buildEntity360BitemporalSnapshot(persistedSnapshot) : null;
    if (bitemporalSnapshot) {
      metrics.bitemporal_snapshot_reconstruction_count += 1;
      metrics.bitemporal_snapshot_reconstruction_latency_ms_total +=
        Math.max(0, performance.now() - bitemporalStartedAt);
    }
    return Object.freeze({ snapshot: persistedSnapshot,
      projection: await projectPersistedSnapshot(persistedSnapshot),
      ...(bitemporalSnapshot ? { bitemporal_snapshot: bitemporalSnapshot } : {}),
      persistence: { revision: persisted?.head_revision ?? persisted?.revision ?? expectedRevision + 1,
        replayed: persisted?.replayed === true, backend: persisted?.backend || store.kind || "postgresql" },
      feature_flag: { mode: feature.mode, enabled: feature.enabled, revision: Number(feature.revision || 0),
        source: feature.source },
      observability: { context_assembly_latency_ms: assemblyLatencyMs },
      shadow_mode: feature.mode === "SHADOW",
      enforcement_mode: feature.mode === "ENFORCED",
      production_decision_changed: false, execution_authorized: false });
  }

  async function readStored(identity, input) {
    const workId = requireWorkBinding(identity, input);
    const scope = snapshotScope({ ...input, tenant_id: identity.tenant_id });
    if (typeof store.readSnapshot !== "function") fail("entity360_snapshot_read_unavailable", 503);
    const snapshot = await store.readSnapshot(scope);
    if (!snapshot) fail("entity360_snapshot_not_found", 404);
    if (snapshot.tenant_scope !== identity.tenant_id) fail("entity360_cross_tenant_snapshot", 403);
    requireSnapshotWorkBinding(snapshot, workId);
    if (input.snapshot_digest && input.snapshot_digest !== snapshot.deterministic_immutable_digest) {
      fail("entity360_snapshot_digest_mismatch", 409);
    }
    if (!input.query_mode) return snapshot;
    const startedAt = performance.now();
    const bitemporal = queryEntity360BitemporalSnapshot(snapshot, input);
    metrics.bitemporal_query_count += 1;
    metrics.bitemporal_query_latency_ms_total += Math.max(0, performance.now() - startedAt);
    if (bitemporal.no_hindsight_leakage === true && input.query_mode === "DECISION_CONTEXT_AT") {
      metrics.hindsight_leakage_prevented_count += 1;
    }
    return bitemporal;
  }

  async function observeCurrentPath(rawIdentity, input = {}) {
    if (state !== "ready") fail("entity360_runtime_not_ready", 503);
    const identity = requireIdentity(rawIdentity);
    requireShadowObserverAuthority(identity);
    requireInputTenant(identity, input);
    const workId = requireWorkBinding(identity, input);
    await requireOperationalStore();
    await requireTenantShadowMode(identity.tenant_id);
    const observation = buildVerifiedEntity360CurrentPathObservation({
      tenant_id: identity.tenant_id,
      work_id: workId,
      preflight: input.preflight,
      observed_at: new Date(now()).toISOString(),
      domain_signer: qualificationSigner,
    });
    const resolution = await resolve(identity, {
      work_id: workId,
      entity_type: "work",
      identity: { work_id: workId },
    });
    if (resolution.status !== "RESOLVED") {
      fail(resolution.status === "AMBIGUOUS"
        ? "entity360_entity_resolution_ambiguous"
        : "entity360_entity_resolution_not_found", 409, {
        resolution_status: resolution.status,
        candidate_entity_ids: resolution.candidates,
        missing_disambiguation: resolution.missing_disambiguation,
      });
    }
    const head = await store.readHead({ tenant_id: identity.tenant_id,
      entity_id: resolution.entity_id });
    const expectedRevision = head ? integer(head.revision,
      "entity360_head_revision_invalid") : 0;
    const assembled = await assemble(identity, {
      work_id: workId,
      entity_id: resolution.entity_id,
      entity_type: "work",
      identity: { work_id: workId },
      expected_revision: expectedRevision,
      idempotency_key: `entity360-preflight-snapshot-${observation.observation_id}`,
      as_of: observation.observed_at,
    });
    const receipt = compareVerifiedEntity360CurrentPath({
      snapshot: assembled.snapshot,
      observation,
      domain_verifier: qualificationVerifier,
      domain_signer: qualificationSigner,
    });
    const persisted = await store.writeShadowReceipt({
      tenant_id: identity.tenant_id,
      entity_id: assembled.snapshot.entity_id,
      snapshot_version: assembled.snapshot.snapshot_version,
      receipt,
      actor_id: identity.actor_id,
      idempotency_key: `entity360-preflight-shadow-${observation.observation_id}`,
    });
    metrics.shadow_comparison_count += 1;
    if (receipt.diverged) metrics.shadow_divergence_count += 1;
    countCoreOutcomeCorrelation(metrics, receipt, assembled.snapshot);
    return Object.freeze({
      schema_version: "entity_360_automatic_shadow_observation_result_v1",
      observation,
      snapshot: assembled.snapshot,
      receipt: persisted?.receipt || receipt,
      replayed: persisted?.replayed === true,
      production_decision_changed: false,
      execution_authorized: false,
      authorization_effect: "NONE",
    });
  }

  async function resolveEnforcementContext(rawIdentity, input = {}) {
    if (state !== "ready") fail("entity360_enforcement_runtime_not_ready", 503);
    const identity = requireIdentity(rawIdentity);
    requireCoreEnforcementAuthority(identity);
    requireInputTenant(identity, input);
    const workId = requireWorkBinding(identity, input);
    const phase = text(input.phase, "entity360_enforcement_phase_required", 40).toUpperCase();
    if (!["ISSUE", "RESERVATION"].includes(phase)) {
      fail("entity360_enforcement_phase_invalid");
    }
    const action = input.action && typeof input.action === "object" && !Array.isArray(input.action)
      ? input.action : fail("entity360_enforcement_action_required");
    const feature = await requireTenantEnforcedMode(identity.tenant_id);
    const resolution = await resolve(identity, {
      work_id: workId,
      entity_type: "work",
      identity: { work_id: workId },
    });
    if (resolution.status !== "RESOLVED") fail("entity360_enforcement_context_unresolved", 409);
    const snapshot = await store.readLatestSnapshot({ tenant_id: identity.tenant_id,
      entity_id: resolution.entity_id });
    if (!snapshot) fail("entity360_snapshot_not_found", 404);
    requireSnapshotWorkBinding(snapshot, workId);
    if (snapshot.schema_version !== enforcementContract.snapshot_schema_version
      || snapshot.context_status !== "READY"
      || snapshot.policy_digest !== compiledPolicy.policy_digest
      || snapshot.adapter_registry_version !==
        enforcementContract.adapter_registry_schema_version
      || !snapshot.bitemporal || snapshot.bitemporal.knowledge_time_quality !== "VERIFIED"
      || snapshot.execution_authorized !== false
      || snapshot.production_decision_mutation !== false) {
      fail("entity360_enforcement_snapshot_ineligible", 409);
    }
    const verificationContext = await historicalVerificationContext(identity.tenant_id, snapshot);
    const verified = verifyEntity360Snapshot(snapshot, {
      ...verificationContext,
      verification_time: new Date(now()).toISOString(),
      persisted_at: snapshot.__entity360_persisted_at || null,
      qualification_verifier: qualificationVerifier,
    });
    if (!verified.valid) {
      fail("entity360_enforcement_snapshot_verification_failed", 409);
    }
    const verification = Object.freeze({ ...verified,
      snapshot_digest: snapshot.deterministic_immutable_digest,
      tenant_scope: identity.tenant_id,
      independently_recomputed_by: "universal_core_entity360_enforcement_verifier" });
    const receiptUnsigned = {
      schema_version: "entity_360_core_context_receipt_v2",
      tenant_id: identity.tenant_id,
      work_id: workId,
      entity_id: snapshot.entity_id,
      snapshot_version: snapshot.snapshot_version,
      snapshot_digest: snapshot.deterministic_immutable_digest,
      policy_version: snapshot.policy_version,
      policy_digest: snapshot.policy_digest,
      enforcement_policy_version: compiledEnforcementPolicy.policy_version,
      enforcement_policy_digest: compiledEnforcementPolicy.policy_digest,
      enforcement_authority_digest: enforcementContract.enforcement_authority_digest,
      adapter_registry_version: snapshot.adapter_registry_version,
      as_of_valid_time: snapshot.bitemporal.as_of_valid_time,
      as_of_knowledge_time: snapshot.bitemporal.as_of_knowledge_time,
      tenant_feature_revision: Number(feature.revision),
      action_digest: entity360Digest(action),
      phase,
      authority_owner: "UNIVERSAL_CORE",
      decision_authority: "UNIVERSAL_CORE",
      decision_receipt_schema_version: enforcementContract.decision_receipt_schema_version,
      entity360_self_approval: false,
      provider_mutation: false,
      execution_authorized: false,
    };
    const receipt = Object.freeze({ ...receiptUnsigned,
      receipt_digest: entity360Digest(receiptUnsigned) });
    return Object.freeze({ snapshot, verification, receipt,
      feature_flag: Object.freeze({ mode: feature.mode, enabled: feature.enabled,
        revision: Number(feature.revision), source: feature.source }),
      production_decision_changed: false,
      execution_authorized: false });
  }

  async function configureFeatureFlag(rawIdentity, input = {}) {
    const identity = requireIdentity(rawIdentity);
    requireInputTenant(identity, input);
    requireFeatureFlagAuthority(identity);
    if (typeof store.writeFeatureFlag !== "function") {
      fail("entity360_feature_flag_store_unavailable", 503);
    }
    if (Object.hasOwn(input, "policy_digest")
      || Object.hasOwn(input, "enforcement_authority_digest")
      || Object.hasOwn(input, "flag_id")) {
      fail("entity360_feature_flag_server_binding_required", 403);
    }
    const featureMode = normalizeTenantFeatureMode(input.mode);
    const enabled = input.enabled === true;
    if ((featureMode === "OFF" && enabled)
      || (["SHADOW", "ENFORCED"].includes(featureMode) && !enabled)) {
      fail("entity360_feature_flag_state_invalid");
    }
    const expectedRevision = integer(input.expected_revision,
      "entity360_feature_expected_revision_invalid");
    if (featureMode === "ENFORCED") {
      if (configuredMode !== "ENFORCE") fail("entity360_mode_invalid", 503);
      await requireEnforcementReadiness();
    } else if (featureMode === "SHADOW") {
      const current = typeof store.readFeatureFlag === "function"
        ? await store.readFeatureFlag({ tenant_id: identity.tenant_id, flag_id: "entity360" })
        : null;
      const safetyDowngrade = configuredMode === "ENFORCE"
        && current?.mode === "ENFORCED" && Number(current.revision) === expectedRevision;
      if (safetyDowngrade) {
        const storeHealth = await readOperationalStoreHealth();
        const reason = storeHealthFailureReason(storeHealth);
        if (reason) fail("entity360_store_verification_failed", 503, { reason });
      } else {
        if (state !== "ready") fail("entity360_runtime_not_ready", 503);
        await requireOperationalStore();
      }
    }
    const result = await store.writeFeatureFlag({
      tenant_id: identity.tenant_id,
      flag_id: "entity360",
      mode: featureMode,
      enabled,
      policy_digest: featureMode === "OFF" ? null : compiledPolicy.policy_digest,
      enforcement_authority_digest: featureMode === "ENFORCED"
        ? enforcementContract.enforcement_authority_digest : null,
      config: input.config || {},
      expected_revision: expectedRevision,
      actor_id: identity.actor_id,
      idempotency_key: text(input.idempotency_key,
        "entity360_idempotency_key_required", 240),
    });
    return Object.freeze({ ...result, configured_by: "universal_core_governed_operator",
      authority_owner: "UNIVERSAL_CORE", entity360_self_approval: false,
      provider_mutation: false, production_decision_changed: false,
      execution_authorized: false });
  }

  async function invoke(capability, rawIdentity, input = {}) {
    if (capability === "entity_360_feature_flag_write") {
      return configureFeatureFlag(rawIdentity, input);
    }
    if (state !== "ready") fail("entity360_runtime_not_ready", 503);
    const identity = requireIdentity(rawIdentity);
    requireInputTenant(identity, input);
    await requireOperationalStore();
    if (capability === "entity_360_resolve") return resolve(identity, input);
    if (capability === "entity_360_snapshot_assemble") return assemble(identity, input);
    if (capability === "entity_360_snapshot_latest") {
      const workId = requireWorkBinding(identity, input);
      const entityId = text(input.entity_id, "entity360_entity_id_required", 160);
      const snapshot = await store.readLatestSnapshot({ tenant_id: identity.tenant_id, entity_id: entityId });
      if (!snapshot) fail("entity360_snapshot_not_found", 404);
      const payload = snapshot.snapshot || snapshot;
      if (payload.tenant_scope !== identity.tenant_id) fail("entity360_cross_tenant_snapshot", 403);
      requireSnapshotWorkBinding(payload, workId);
      if (!input.query_mode) return payload;
      const startedAt = performance.now();
      const bitemporal = queryEntity360BitemporalSnapshot(payload, input);
      metrics.bitemporal_query_count += 1;
      metrics.bitemporal_query_latency_ms_total += Math.max(0, performance.now() - startedAt);
      return bitemporal;
    }
    if (capability === "entity_360_snapshot_read") return readStored(identity, input);
    if (capability === "entity_360_snapshot_verify") {
      const snapshot = await readStored(identity, input);
      const verificationContext = await historicalVerificationContext(identity.tenant_id, snapshot);
      const verification = verifyEntity360Snapshot(snapshot, {
        ...verificationContext,
        verification_time: new Date(now()).toISOString(),
        persisted_at: snapshot.__entity360_persisted_at || null,
        qualification_verifier: qualificationVerifier,
      });
      return Object.freeze({ ...verification, snapshot_digest: snapshot.deterministic_immutable_digest,
        tenant_scope: identity.tenant_id, independently_recomputed_by: "universal_core_entity360_verifier" });
    }
    if (capability === "entity_360_shadow_compare") {
      const snapshot = await readStored(identity, input);
      const receipt = attestEntity360ShadowReceipt(compareEntity360Shadow({ snapshot,
        legacy_context_digest: input.legacy_context_digest,
        legacy_outcome: input.legacy_outcome }), qualificationSigner);
      if (typeof store.writeShadowReceipt !== "function") fail("entity360_shadow_store_unavailable", 503);
      const persisted = await store.writeShadowReceipt({ tenant_id: identity.tenant_id,
        entity_id: snapshot.entity_id, snapshot_version: snapshot.snapshot_version, receipt,
        actor_id: identity.actor_id, idempotency_key: text(input.idempotency_key,
          "entity360_idempotency_key_required", 240) });
      metrics.shadow_comparison_count += 1;
      if (receipt.diverged) metrics.shadow_divergence_count += 1;
      countCoreOutcomeCorrelation(metrics, receipt, snapshot);
      if (receipt.release_evidence_eligible !== true) metrics.unverified_shadow_comparison_count += 1;
      return Object.freeze({ receipt: persisted?.receipt || receipt, replayed: persisted?.replayed === true,
        production_decision_changed: false, execution_authorized: false });
    }
    if (capability === "entity_360_policy_read") {
      requireWorkBinding(identity, input);
      return Object.freeze({
      schema_version: "entity_360_policy_read_v1",
      policy: compiledPolicy,
      ontology: compiledOntology,
      tenant_scope: identity.tenant_id,
      configured_mode: configuredMode,
      feature_flag: await tenantMode(identity.tenant_id),
      tenant_override_applied: false,
      execution_authorized: false,
      });
    }
    if (capability === "entity_360_metrics_read") {
      requireWorkBinding(identity, input);
      const persisted = typeof store.readMetrics === "function"
        ? await store.readMetrics({ tenant_id: identity.tenant_id, project_id: input.project_id }) : null;
      return publicMetrics(metrics, persisted, configuredMode, compiledPolicy, compiledOntology);
    }
    fail("entity360_capability_unknown", 404);
  }

  return Object.freeze({
    schema_version: configuredMode === "ENFORCE"
      ? "entity_360_runtime_v2" : "entity_360_runtime_v1",
    mode: configuredMode,
    initialize,
    health,
    invoke,
    preflightObservationGate,
    observeCurrentPath,
    resolveEnforcementContext,
    policy: compiledPolicy,
    ontology: compiledOntology,
    enforcement_policy: compiledEnforcementPolicy,
    enforcement_contract: enforcementContract,
  });
}

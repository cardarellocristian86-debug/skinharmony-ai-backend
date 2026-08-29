import { entity360Digest, verifyEntity360Snapshot } from "./entity360.js";

export const ENTITY_360_PROJECTION_CACHE_SCHEMA_VERSION = "entity_360_projection_cache_v1";
export const ENTITY_360_PROJECTION_SCHEMA_VERSION = "entity_360_projection_v1";

// This process-local cache is deliberately derived only from a persisted,
// independently verified snapshot. It is never a source of truth, never
// persisted, and cannot grant authority or execution. The durable snapshot
// chain remains the append-only Entity 360 record.
const MAX_CACHE_TTL_MS = 60_000;
const SUPPORTED_PROJECTIONS = new Set(["work_360", "software_component_360"]);

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

function string(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function timestampMs(value) {
  const milliseconds = Date.parse(String(value || ""));
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function unavailable(reason, invalidated = false) {
  return freeze({ projection: null, cache: { state: invalidated ? "INVALIDATED" : "BYPASSED",
    reason, authoritative: false, execution_authorized: false } });
}

function projectionDefinition(ontology, entityType) {
  const item = ontology.entity_types.find((candidate) => candidate.type === entityType);
  return item && SUPPORTED_PROJECTIONS.has(item.projection) ? item.projection : null;
}

function scopeFromSnapshot(snapshot) {
  const tenantId = string(snapshot?.tenant_scope);
  const entityId = string(snapshot?.entity_id);
  const projectId = string(snapshot?.project_work_linkage?.project_id);
  const workId = string(snapshot?.project_work_linkage?.work_id);
  const entityType = string(snapshot?.entity_type);
  if (!tenantId || !entityId || !projectId || !workId || !entityType) return null;
  return freeze({ tenant_id: tenantId, project_id: projectId, work_id: workId,
    entity_id: entityId, entity_type: entityType });
}

function scopeKey(scope) {
  return [scope.tenant_id, scope.project_id, scope.work_id, scope.entity_id, scope.entity_type]
    .map((part) => part.toLowerCase()).join("\u0000");
}

function durableHead(candidate, snapshot, scope) {
  const head = candidate?.durable_head;
  const version = Number(head?.snapshot_version);
  const digest = string(head?.snapshot_digest);
  if (!head || typeof head !== "object" || Array.isArray(head)
    || string(head.tenant_id) !== scope.tenant_id || string(head.entity_id) !== scope.entity_id
    || version !== snapshot?.snapshot_version || digest !== snapshot?.deterministic_immutable_digest
    || !Number.isSafeInteger(version) || version < 1 || !/^[a-f0-9]{64}$/u.test(digest || "")) {
    return null;
  }
  return freeze({ snapshot_version: version, snapshot_digest: digest });
}

function cacheEligibility(snapshot, { policy, ontology, nowMs }) {
  const scope = scopeFromSnapshot(snapshot);
  if (!scope) return { reason: "entity360_projection_scope_required" };
  const projection = projectionDefinition(ontology, scope.entity_type);
  if (!projection) return { reason: "entity360_projection_type_unsupported", scope };
  if (snapshot.policy_digest !== policy.policy_digest
    || snapshot.ontology_digest !== entity360Digest(ontology)) {
    return { reason: "entity360_projection_definition_binding_invalid", scope };
  }
  if (snapshot.context_status !== "READY" || !Array.isArray(snapshot.contradictions)
    || snapshot.contradictions.length !== 0 || !Array.isArray(snapshot.stale_sources)
    || snapshot.stale_sources.length !== 0 || !Array.isArray(snapshot.missing_context)
    || snapshot.missing_context.some((item) => item?.mandatory === true)) {
    return { reason: "entity360_projection_context_not_cacheable", scope };
  }
  const asOfMs = timestampMs(snapshot.as_of);
  if (asOfMs === null || !Array.isArray(snapshot.source_provenance)
    || snapshot.source_provenance.length === 0) {
    return { reason: "entity360_projection_freshness_binding_invalid", scope };
  }
  const sourceFreshnessMs = snapshot.source_provenance.map((source) => {
    const sourceClass = string(source?.source_class);
    const seconds = sourceClass ? policy.freshness.by_source_class[sourceClass]
      : policy.freshness.default_max_age_seconds;
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : null;
  });
  if (sourceFreshnessMs.some((value) => value === null)) {
    return { reason: "entity360_projection_freshness_binding_invalid", scope };
  }
  const policyTtlMs = Math.min(MAX_CACHE_TTL_MS,
    policy.freshness.max_clock_skew_seconds * 1000, ...sourceFreshnessMs);
  const sourceFreshUntilMs = asOfMs + Math.min(...sourceFreshnessMs);
  const expiresAtMs = Math.min(nowMs + policyTtlMs, sourceFreshUntilMs);
  if (!Number.isSafeInteger(policyTtlMs) || policyTtlMs <= 0 || expiresAtMs <= nowMs) {
    return { reason: "entity360_projection_freshness_expired", scope };
  }
  return { scope, projection, source_fresh_until_ms: sourceFreshUntilMs, expires_at_ms: expiresAtMs };
}

function buildProjection(snapshot, eligibility) {
  const projection = {
    schema_version: ENTITY_360_PROJECTION_SCHEMA_VERSION,
    projection: eligibility.projection,
    tenant_scope: eligibility.scope.tenant_id,
    project_id: eligibility.scope.project_id,
    work_id: eligibility.scope.work_id,
    entity_id: eligibility.scope.entity_id,
    entity_type: eligibility.scope.entity_type,
    snapshot_version: snapshot.snapshot_version,
    snapshot_digest: snapshot.deterministic_immutable_digest,
    previous_snapshot_digest: snapshot.previous_snapshot_digest,
    policy_version: snapshot.policy_version,
    policy_digest: snapshot.policy_digest,
    ontology_version: snapshot.ontology_version,
    ontology_digest: snapshot.ontology_digest,
    source_fresh_until: new Date(eligibility.source_fresh_until_ms).toISOString(),
    context_status: snapshot.context_status,
    current_state: clone(snapshot.current_state),
    relationships: clone(snapshot.relationships),
    dependencies: clone(snapshot.dependencies),
    evidence_digests: clone(snapshot.evidence_digests),
    execution_authorized: false,
    production_decision_mutation: false,
    authority: "universal_core",
  };
  return freeze({ ...projection, projection_digest: entity360Digest(projection) });
}

export function createEntity360ProjectionCache({ policy, ontology, qualificationVerifier,
  now = () => Date.now() } = {}) {
  if (!policy?.policy_digest || !ontology?.ontology_version || typeof now !== "function") {
    throw new Error("entity360_projection_cache_configuration_required");
  }
  if (!qualificationVerifier || typeof qualificationVerifier.verify !== "function"
    || typeof qualificationVerifier.sign === "function") {
    throw new Error("entity360_projection_cache_qualification_verifier_required");
  }
  const entries = new Map();
  // Tracks the newest observed immutable head even when that head cannot be
  // projected (for example because it is conflicted). That makes a later
  // request for a superseded snapshot fail closed instead of reviving it.
  const observedHeads = new Map();

  function invalidate(scope) {
    if (!scope) return false;
    return entries.delete(scopeKey(scope));
  }

  function project(candidate) {
    const nowMs = now();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      return unavailable("entity360_projection_clock_invalid");
    }
    const snapshot = candidate?.snapshot;
    const scope = scopeFromSnapshot(snapshot);
    if (!scope) return unavailable("entity360_projection_scope_required");
    const head = durableHead(candidate, snapshot, scope);
    const persistedAt = snapshot?.__entity360_persisted_at;
    if (!head || timestampMs(persistedAt) === null) {
      return unavailable("entity360_projection_durable_head_required", invalidate(scope));
    }
    const verification = verifyEntity360Snapshot(snapshot, { policy, ontology,
      verification_time: new Date(nowMs).toISOString(), persisted_at: persistedAt,
      qualification_verifier: qualificationVerifier });
    if (verification.valid !== true) {
      return unavailable("entity360_projection_independent_verification_failed", invalidate(scope));
    }
    const eligibility = cacheEligibility(snapshot, { policy, ontology, nowMs });
    if (!eligibility.scope) {
      const invalidated = invalidate(eligibility.scope);
      return unavailable(eligibility.reason, invalidated);
    }
    const key = scopeKey(eligibility.scope);
    const observed = observedHeads.get(key);
    if (observed && (head.snapshot_version < observed.snapshot_version
      || head.snapshot_version === observed.snapshot_version
        && head.snapshot_digest !== observed.snapshot_digest)) {
      const invalidated = entries.delete(key);
      return unavailable("entity360_projection_snapshot_superseded", invalidated);
    }
    const replaced = Boolean(observed && (head.snapshot_version > observed.snapshot_version
      || head.snapshot_digest !== observed.snapshot_digest));
    if (replaced) entries.delete(key);
    observedHeads.set(key, head);
    if (!eligibility.scope || !eligibility.projection) {
      return unavailable(eligibility.reason, replaced || invalidate(eligibility.scope));
    }
    const existing = entries.get(key);
    if (existing && existing.projection.snapshot_digest === snapshot.deterministic_immutable_digest
      && existing.projection.snapshot_version === snapshot.snapshot_version
      && existing.expires_at_ms > nowMs
      && existing.projection.policy_digest === policy.policy_digest
      && existing.projection.ontology_digest === entity360Digest(ontology)) {
      return freeze({ projection: existing.projection, cache: freeze({ state: "HIT",
        expires_at: new Date(existing.expires_at_ms).toISOString(), authoritative: false,
        execution_authorized: false }) });
    }
    // A different verified head supersedes the derived projection. Replacing
    // only this non-authoritative in-process entry cannot alter history.
    const projection = buildProjection(snapshot, eligibility);
    entries.set(key, freeze({ projection, expires_at_ms: eligibility.expires_at_ms }));
    return freeze({ projection, cache: freeze({ state: "REBUILT",
      expires_at: new Date(eligibility.expires_at_ms).toISOString(), authoritative: false,
      execution_authorized: false }) });
  }

  return freeze({
    schema_version: ENTITY_360_PROJECTION_CACHE_SCHEMA_VERSION,
    project,
    invalidate,
  });
}

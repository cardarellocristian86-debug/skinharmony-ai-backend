import { causalDigest } from "./causalContinuityCanonical.js";

export const PROJECT_SCOPE_RENDER_ORIGIN_PROVENANCE_VERSION =
  "project_scope_render_origin_provenance_v2";
export const PROJECT_SCOPE_REPOSITORY_PROVENANCE_VERSION =
  "project_scope_repository_provenance_v2";
export const PROJECT_SCOPE_RESOURCE_DIGEST_VERSION =
  "project_scope_resource_digest_v1";
export const DEFAULT_PROJECT_SCOPE_RENDER_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,999}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const RENDER_ORIGIN = /^https:\/\/[a-z0-9][a-z0-9-]*\.onrender\.com$/;
const INDEPENDENT_OBSERVATION = new Set([
  "INDEPENDENT_SYSTEM", "INDEPENDENT_HUMAN", "FORMAL",
]);

export const PROJECT_SCOPE_RENDER_ORIGIN_QUERY = `SELECT to_jsonb(service_resource) AS service_resource,
                to_jsonb(repository_resource) AS repository_resource,
                to_jsonb(service_observation) AS service_observation,
                to_jsonb(repository_observation) AS repository_observation
           FROM core_project_scope_resources AS service_resource
           JOIN core_project_scope_resources AS repository_resource
             ON repository_resource.tenant_id = service_resource.tenant_id
            AND repository_resource.project_id = service_resource.project_id
            AND repository_resource.resource_type = 'github_repository'
            AND repository_resource.canonical_identifier = $2
            AND repository_resource.environment = 'shared'
            AND repository_resource.active IS TRUE
           JOIN LATERAL (
             SELECT observation.* FROM core_reality_observations AS observation
              WHERE observation.tenant_id = service_resource.tenant_id
                AND observation.project_id = service_resource.project_id
                AND observation.observation_id =
                    (service_resource.provenance->>'observation_id')::uuid
              LIMIT 1
           ) AS service_observation ON TRUE
           JOIN LATERAL (
             SELECT observation.* FROM core_reality_observations AS observation
              WHERE observation.tenant_id = repository_resource.tenant_id
                AND observation.project_id = repository_resource.project_id
                AND observation.observation_id =
                    (repository_resource.provenance->>'observation_id')::uuid
              LIMIT 1
           ) AS repository_observation ON TRUE
          WHERE service_resource.tenant_id = $1
            AND service_resource.resource_type = 'render_service_origin'
            AND service_resource.canonical_identifier = $3
            AND service_resource.environment = $4
            AND service_resource.active IS TRUE
          ORDER BY service_resource.project_id, service_resource.resource_id
          LIMIT 2`;

function fail(code) {
  throw new Error(code);
}

function plainObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function exactKeys(value, expected, code) {
  const keys = Object.keys(plainObject(value, code)).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(code);
  }
}

function text(value, code, max = 1_000) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || !IDENTIFIER.test(normalized)) fail(code);
  return normalized;
}

function digest(value, code) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!DIGEST.test(normalized)) fail(code);
  return normalized;
}

function renderOrigin(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!RENDER_ORIGIN.test(normalized)) fail("render_scope_origin_invalid");
  return normalized;
}

function timestamp(value, code) {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  if (!Number.isFinite(parsed.getTime())) fail(code);
  return parsed.toISOString();
}

function normalizedResource(resource) {
  const row = plainObject(resource, "render_scope_resource_invalid");
  return {
    tenant_id: text(row.tenant_id, "render_scope_tenant_invalid", 160),
    resource_id: text(row.resource_id, "render_scope_resource_id_invalid", 160),
    project_id: text(row.project_id, "render_scope_project_invalid", 160),
    resource_type: text(row.resource_type, "render_scope_resource_type_invalid", 120),
    canonical_identifier: text(
      row.canonical_identifier,
      "render_scope_canonical_identifier_invalid",
      1_000,
    ),
    environment: text(row.environment, "render_scope_environment_invalid", 120),
    ownership: plainObject(row.ownership, "render_scope_ownership_invalid"),
    active: row.active === true,
    provenance: plainObject(row.provenance, "render_scope_provenance_invalid"),
    last_verified_at: timestamp(row.last_verified_at, "render_scope_verification_time_invalid"),
  };
}

/**
 * Canonical digest contract for verified Project Scope resources used by the
 * host-native Render resolver. The database-generated first_seen_at is
 * intentionally excluded; every included field is known when the resource is
 * authoritatively bound and is stable across PostgreSQL readback.
 */
export function projectScopeResourceDigest(resource) {
  return causalDigest({
    schema_version: PROJECT_SCOPE_RESOURCE_DIGEST_VERSION,
    ...normalizedResource(resource),
  });
}

function validateFresh(resource, nowMs, maxAgeMs) {
  const verifiedMs = Date.parse(resource.last_verified_at);
  if (verifiedMs > nowMs || nowMs - verifiedMs > maxAgeMs) {
    fail("render_scope_verification_stale");
  }
}

function validateRepositoryProvenance(provenance) {
  exactKeys(
    provenance,
    ["evidence_digest", "observation_digest", "observation_id", "schema_version"],
    "repository_scope_provenance_invalid",
  );
  if (provenance.schema_version !== PROJECT_SCOPE_REPOSITORY_PROVENANCE_VERSION) {
    fail("repository_scope_provenance_invalid");
  }
  text(provenance.observation_id, "repository_scope_provenance_invalid", 160);
  digest(provenance.observation_digest, "repository_scope_provenance_invalid");
  digest(provenance.evidence_digest, "repository_scope_provenance_invalid");
}

function validateServiceProvenance(provenance) {
  exactKeys(
    provenance,
    ["evidence_digest", "observation_digest", "observation_id", "schema_version"],
    "render_scope_provenance_invalid",
  );
  if (provenance.schema_version !== PROJECT_SCOPE_RENDER_ORIGIN_PROVENANCE_VERSION) {
    fail("render_scope_provenance_invalid");
  }
  text(provenance.observation_id, "render_scope_provenance_invalid", 160);
  digest(provenance.observation_digest, "render_scope_provenance_invalid");
  digest(provenance.evidence_digest, "render_scope_provenance_invalid");
}

function observationDigestPayload(observation) {
  return {
    schema_version: "reality_observation_v1",
    tenant_id: observation.tenant_id,
    observation_id: observation.observation_id,
    project_id: observation.project_id,
    intent_revision_id: observation.intent_revision_id,
    work_id: observation.work_id,
    change_id: observation.change_id,
    obligation_id: observation.obligation_id,
    source: observation.source,
    observer_identity: observation.observer_identity,
    observer_role: observation.observer_role,
    provenance: observation.provenance,
    independence: observation.independence,
    baseline: observation.baseline,
    freshness_seconds: Number(observation.freshness_seconds),
    observed_at: timestamp(observation.observed_at, "render_scope_observation_invalid"),
    evidence_digest: observation.evidence_digest,
    causal_relation: observation.causal_relation,
    confidence: Number(observation.confidence),
    contradiction_status: observation.contradiction_status,
  };
}

export function projectScopeObservationDigest(observation) {
  return causalDigest(observationDigestPayload(observation));
}

function validateObservation(raw, resource, expected, nowMs, maxAgeMs) {
  const observation = plainObject(raw, "render_scope_observation_required");
  const provenance = resource.provenance;
  if (
    text(observation.tenant_id, "render_scope_observation_invalid", 160) !== resource.tenant_id ||
    text(observation.project_id, "render_scope_observation_invalid", 160) !== resource.project_id ||
    text(observation.observation_id, "render_scope_observation_invalid", 160) !== provenance.observation_id
  ) fail("render_scope_observation_binding_mismatch");
  const observationDigest = digest(
    observation.observation_digest,
    "render_scope_observation_invalid",
  );
  if (
    observationDigest !== provenance.observation_digest ||
    observationDigest !== projectScopeObservationDigest(observation)
  ) fail("render_scope_observation_digest_mismatch");
  if (
    digest(observation.evidence_digest, "render_scope_observation_invalid") !==
    provenance.evidence_digest
  ) fail("render_scope_observation_evidence_mismatch");
  const independence = text(
    observation.independence,
    "render_scope_observation_invalid",
    80,
  ).toUpperCase();
  if (!INDEPENDENT_OBSERVATION.has(independence)) {
    fail("render_scope_observation_not_independent");
  }
  if (observation.contradiction_status !== "NONE") {
    fail("render_scope_observation_contradicted");
  }
  text(observation.observer_identity, "render_scope_observer_invalid", 240);
  text(observation.observer_role, "render_scope_observer_invalid", 240);
  if (observation.source !== expected.source) fail("render_scope_observation_source_mismatch");
  if (timestamp(observation.observed_at, "render_scope_observation_invalid") !== resource.last_verified_at) {
    fail("render_scope_observation_time_mismatch");
  }
  exactKeys(observation.provenance, ["observer", "source"], "render_scope_observation_invalid");
  plainObject(observation.provenance.observer, "render_scope_observation_invalid");
  const source = plainObject(observation.provenance.source, "render_scope_observation_invalid");
  exactKeys(source, Object.keys(expected.provenance).sort(), "render_scope_observation_source_mismatch");
  for (const [key, value] of Object.entries(expected.provenance)) {
    if (source[key] !== value) fail("render_scope_observation_source_mismatch");
  }
  plainObject(observation.baseline, "render_scope_observation_invalid");
  const freshnessSeconds = Number(observation.freshness_seconds);
  const confidence = Number(observation.confidence);
  if (!Number.isSafeInteger(freshnessSeconds) || freshnessSeconds < 0) {
    fail("render_scope_observation_invalid");
  }
  // Runtime uses 0 when an observer does not declare a tighter horizon. It is
  // bounded by the configured resolver maximum rather than interpreted as
  // unlimited. Positive horizons can only narrow that maximum.
  const observationMaxAgeMs = freshnessSeconds > 0
    ? Math.min(maxAgeMs, freshnessSeconds * 1_000)
    : maxAgeMs;
  const observedMs = Date.parse(observation.observed_at);
  if (observedMs > nowMs || nowMs - observedMs > observationMaxAgeMs) {
    fail("render_scope_observation_stale");
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    fail("render_scope_observation_invalid");
  }
  text(observation.causal_relation, "render_scope_observation_invalid", 120);
}

function verifyResourceDigest(raw, normalized) {
  const expected = projectScopeResourceDigest(normalized);
  const actual = digest(raw.resource_digest, "render_scope_digest_invalid");
  if (actual !== expected) fail("render_scope_digest_mismatch");
}

function normalizeMaxAge(value) {
  const maxAgeMs = Number(value ?? DEFAULT_PROJECT_SCOPE_RENDER_MAX_AGE_MS);
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1_000 || maxAgeMs > 30 * 24 * 60 * 60 * 1_000) {
    fail("render_scope_max_age_invalid");
  }
  return maxAgeMs;
}

/**
 * Resolve an origin exclusively from verified Project Scope rows. The query
 * joins the repository and Render resource inside one tenant/project and is
 * bounded to two rows so ambiguity is detected without materializing scope.
 */
export function createProjectScopeRenderOriginResolver({
  pool,
  now = () => new Date(),
  maxAgeMs = DEFAULT_PROJECT_SCOPE_RENDER_MAX_AGE_MS,
} = {}) {
  if (!pool || typeof pool.query !== "function") fail("render_scope_database_unavailable");
  if (typeof now !== "function") fail("render_scope_clock_invalid");
  const freshnessMs = normalizeMaxAge(maxAgeMs);

  return async (scope = {}) => {
    const tenantId = text(scope.tenant_id, "origin_not_bound", 160);
    const repository = text(scope.repository, "origin_not_bound", 300);
    const serviceId = text(scope.service_id, "origin_not_bound", 160);
    const environment = text(scope.environment, "origin_not_bound", 120);
    let rows;
    try {
      ({ rows } = await pool.query(
        PROJECT_SCOPE_RENDER_ORIGIN_QUERY,
        [tenantId, repository, serviceId, environment],
      ));
    } catch {
      fail("render_scope_database_error");
    }
    if (!Array.isArray(rows) || rows.length === 0) fail("origin_not_bound");
    if (rows.length !== 1) fail("render_scope_binding_ambiguous");

    const serviceRaw = plainObject(rows[0].service_resource, "render_scope_resource_invalid");
    const repositoryRaw = plainObject(rows[0].repository_resource, "repository_scope_resource_invalid");
    const service = normalizedResource(serviceRaw);
    const repositoryResource = normalizedResource(repositoryRaw);
    if (!service.active || !repositoryResource.active) fail("origin_not_bound");
    if (
      service.tenant_id !== tenantId ||
      repositoryResource.tenant_id !== tenantId ||
      service.project_id !== repositoryResource.project_id
    ) fail("render_scope_project_mismatch");
    if (
      service.resource_type !== "render_service_origin" ||
      service.canonical_identifier !== serviceId ||
      service.environment !== environment ||
      repositoryResource.resource_type !== "github_repository" ||
      repositoryResource.canonical_identifier !== repository ||
      repositoryResource.environment !== "shared"
    ) fail("render_scope_binding_mismatch");

    validateRepositoryProvenance(repositoryResource.provenance);
    validateServiceProvenance(service.provenance);
    const serviceObservation = plainObject(
      rows[0].service_observation,
      "render_scope_observation_required",
    );
    const repositoryObservation = plainObject(
      rows[0].repository_observation,
      "repository_scope_observation_required",
    );
    const origin = renderOrigin(serviceObservation.provenance?.source?.origin);
    const nowValue = now();
    const nowMs = nowValue instanceof Date ? nowValue.getTime() : Date.parse(String(nowValue || ""));
    if (!Number.isFinite(nowMs)) fail("render_scope_clock_invalid");
    validateObservation(repositoryObservation, repositoryResource, {
      source: "github_repository_readback",
      provenance: {
        repository,
        schema_version: "github_repository_readback_v1",
      },
    }, nowMs, freshnessMs);
    validateObservation(serviceObservation, service, {
      source: "render_service_origin_readback",
      provenance: {
        environment,
        origin,
        repository,
        schema_version: "render_service_origin_readback_v1",
        service_id: serviceId,
      },
    }, nowMs, freshnessMs);
    validateFresh(service, nowMs, freshnessMs);
    validateFresh(repositoryResource, nowMs, freshnessMs);
    verifyResourceDigest(serviceRaw, service);
    verifyResourceDigest(repositoryRaw, repositoryResource);
    return origin;
  };
}

/**
 * Environment bindings are authoritative only for an exact match. A missing
 * exact binding may fall back to Project Scope; malformed/tampered environment
 * results never do. With no backend, the returned function still blocks so
 * host-native governance cannot consume a manifest origin or invent a slug.
 */
export function createFailClosedRenderOriginResolver({
  environmentResolver = null,
  projectScopeResolver = null,
} = {}) {
  return async (scope = {}) => {
    if (typeof environmentResolver === "function") {
      try {
        return renderOrigin(await environmentResolver(scope));
      } catch (error) {
        if (String(error?.message || "") !== "origin_not_bound") throw error;
      }
    }
    if (typeof projectScopeResolver === "function") {
      return renderOrigin(await projectScopeResolver(scope));
    }
    fail("origin_not_bound");
  };
}

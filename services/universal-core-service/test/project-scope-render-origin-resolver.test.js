import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_SCOPE_RENDER_ORIGIN_PROVENANCE_VERSION,
  PROJECT_SCOPE_REPOSITORY_PROVENANCE_VERSION,
  createFailClosedRenderOriginResolver,
  createProjectScopeRenderOriginResolver,
  projectScopeObservationDigest,
  projectScopeResourceDigest,
} from "../src/projectScopeRenderOriginResolver.js";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const TENANT = "codexai";
const PROJECT = "10000000-0000-4000-8000-000000000001";
const REPOSITORY = "cardarellocristian86-debug/skinharmony-ai-backend";

function verifiedObservation(kind, overrides = {}) {
  const service = kind === "service";
  const observation = {
    tenant_id: TENANT,
    observation_id: service
      ? "40000000-0000-4000-8000-000000000001"
      : "50000000-0000-4000-8000-000000000001",
    project_id: PROJECT,
    intent_revision_id: "60000000-0000-4000-8000-000000000001",
    work_id: "70000000-0000-4000-8000-000000000001",
    change_id: "80000000-0000-4000-8000-000000000001",
    obligation_id: service
      ? "90000000-0000-4000-8000-000000000001"
      : "90000000-0000-4000-8000-000000000002",
    source: service ? "render_service_origin_readback" : "github_repository_readback",
    observer_identity: service ? "render-observer" : "github-observer",
    observer_role: "independent_verifier",
    provenance: {
      observer: { authority: "authenticated_agent_context" },
      source: service ? {
        schema_version: "render_service_origin_readback_v1",
        repository: REPOSITORY,
        service_id: "srv-core",
        environment: "production",
        origin: "https://mapped-core.onrender.com",
      } : {
        schema_version: "github_repository_readback_v1",
        repository: REPOSITORY,
      },
    },
    independence: "INDEPENDENT_SYSTEM",
    baseline: {},
    freshness_seconds: 600,
    observed_at: service
      ? "2026-08-10T11:55:00.000Z"
      : "2026-08-10T11:54:00.000Z",
    evidence_digest: service ? "a".repeat(64) : "b".repeat(64),
    causal_relation: "VERIFIED_READBACK",
    confidence: 1,
    contradiction_status: "NONE",
    ...overrides,
  };
  return {
    ...observation,
    observation_digest: projectScopeObservationDigest(observation),
  };
}

function verifiedResource(overrides = {}, observation = verifiedObservation("service")) {
  const resource = {
    tenant_id: TENANT,
    resource_id: "20000000-0000-4000-8000-000000000001",
    project_id: PROJECT,
    resource_type: "render_service_origin",
    canonical_identifier: "srv-core",
    environment: "production",
    ownership: { owner: "platform" },
    active: true,
    provenance: {
      schema_version: PROJECT_SCOPE_RENDER_ORIGIN_PROVENANCE_VERSION,
      observation_id: observation.observation_id,
      observation_digest: observation.observation_digest,
      evidence_digest: observation.evidence_digest,
    },
    last_verified_at: "2026-08-10T11:55:00.000Z",
    ...overrides,
  };
  return { ...resource, resource_digest: projectScopeResourceDigest(resource) };
}

function verifiedRepository(overrides = {}, observation = verifiedObservation("repository")) {
  const resource = {
    tenant_id: TENANT,
    resource_id: "30000000-0000-4000-8000-000000000001",
    project_id: PROJECT,
    resource_type: "github_repository",
    canonical_identifier: REPOSITORY,
    environment: "shared",
    ownership: { owner: "platform" },
    active: true,
    provenance: {
      schema_version: PROJECT_SCOPE_REPOSITORY_PROVENANCE_VERSION,
      observation_id: observation.observation_id,
      observation_digest: observation.observation_digest,
      evidence_digest: observation.evidence_digest,
    },
    last_verified_at: "2026-08-10T11:54:00.000Z",
    ...overrides,
  };
  return { ...resource, resource_digest: projectScopeResourceDigest(resource) };
}

function database(rows, onQuery = () => {}) {
  return {
    async query(sql, params) {
      onQuery(sql, params);
      return { rows: structuredClone(rows) };
    },
  };
}

function resolverRows(
  serviceObservation = verifiedObservation("service"),
  repositoryObservation = verifiedObservation("repository"),
  service = verifiedResource({}, serviceObservation),
  repository = verifiedRepository({}, repositoryObservation),
) {
  return [{
    service_resource: service,
    repository_resource: repository,
    service_observation: serviceObservation,
    repository_observation: repositoryObservation,
  }];
}

function scope(overrides = {}) {
  return {
    tenant_id: TENANT,
    repository: REPOSITORY,
    service_id: "srv-core",
    environment: "production",
    ...overrides,
  };
}

test("environment exact binding wins without reading Project Scope", async () => {
  let databaseCalls = 0;
  const resolver = createFailClosedRenderOriginResolver({
    environmentResolver: async () => "https://environment-core.onrender.com",
    projectScopeResolver: async () => {
      databaseCalls += 1;
      return "https://scope-core.onrender.com";
    },
  });
  assert.equal(await resolver(scope({ origin: "https://attacker.example.com" })),
    "https://environment-core.onrender.com");
  assert.equal(databaseCalls, 0);
});

test("missing exact environment binding falls back to one verified same-project scope pair", async () => {
  let observedSql = "";
  let observedParams = null;
  const projectScopeResolver = createProjectScopeRenderOriginResolver({
    pool: database(resolverRows(), (sql, params) => {
      observedSql = sql;
      observedParams = params;
    }),
    now: () => NOW,
  });
  const resolver = createFailClosedRenderOriginResolver({
    environmentResolver: async () => { throw new Error("origin_not_bound"); },
    projectScopeResolver,
  });
  assert.equal(await resolver(scope({ origin: "https://attacker.example.com" })),
    "https://mapped-core.onrender.com");
  assert.deepEqual(observedParams, [TENANT, REPOSITORY, "srv-core", "production"]);
  assert.match(observedSql, /repository_resource\.project_id = service_resource\.project_id/);
  assert.match(observedSql, /LIMIT 2/);
});

test("Project Scope resolver blocks ambiguity, database failure, and unbound scopes", async () => {
  const ambiguous = createProjectScopeRenderOriginResolver({
    pool: database([...resolverRows(), ...resolverRows()]),
    now: () => NOW,
  });
  await assert.rejects(ambiguous(scope()), /render_scope_binding_ambiguous/);

  const unavailable = createProjectScopeRenderOriginResolver({
    pool: { async query() { throw new Error("connection details must not escape"); } },
    now: () => NOW,
  });
  await assert.rejects(unavailable(scope()), /render_scope_database_error/);

  const missing = createProjectScopeRenderOriginResolver({
    pool: database([]),
    now: () => NOW,
  });
  await assert.rejects(missing(scope()), /origin_not_bound/);
});

test("Project Scope resolver blocks cross-tenant/project rows and exact-field mismatches", async () => {
  const crossTenant = createProjectScopeRenderOriginResolver({
    pool: database(resolverRows(
      verifiedObservation("service"),
      verifiedObservation("repository"),
      verifiedResource({ tenant_id: "tenant-b" }),
    )),
    now: () => NOW,
  });
  await assert.rejects(crossTenant(scope()), /render_scope_project_mismatch/);

  const crossProject = createProjectScopeRenderOriginResolver({
    pool: database(resolverRows(
      verifiedObservation("service"),
      verifiedObservation("repository"),
      verifiedResource(),
      verifiedRepository({ project_id: "10000000-0000-4000-8000-000000000002" }),
    )),
    now: () => NOW,
  });
  await assert.rejects(crossProject(scope()), /render_scope_project_mismatch/);

  const wrongEnvironment = createProjectScopeRenderOriginResolver({
    pool: database(resolverRows(
      verifiedObservation("service"),
      verifiedObservation("repository"),
      verifiedResource({ environment: "staging" }),
    )),
    now: () => NOW,
  });
  await assert.rejects(wrongEnvironment(scope()), /render_scope_binding_mismatch/);
});

test("Project Scope resolver blocks stale/future verification and digest tampering", async () => {
  const stale = createProjectScopeRenderOriginResolver({
    pool: database(resolverRows(
      verifiedObservation("service", { observed_at: "2026-08-08T11:55:00.000Z" }),
      verifiedObservation("repository"),
      verifiedResource({ last_verified_at: "2026-08-08T11:55:00.000Z" },
        verifiedObservation("service", { observed_at: "2026-08-08T11:55:00.000Z" })),
    )),
    now: () => NOW,
  });
  await assert.rejects(stale(scope()), /render_scope_(?:observation|verification)_stale/);

  const futureObservation = verifiedObservation("service", {
    observed_at: "2026-08-10T12:00:00.001Z",
  });
  const future = createProjectScopeRenderOriginResolver({
    pool: database(resolverRows(
      futureObservation,
      verifiedObservation("repository"),
      verifiedResource({ last_verified_at: futureObservation.observed_at }, futureObservation),
    )),
    now: () => NOW,
  });
  await assert.rejects(future(scope()), /render_scope_(?:observation|verification)_stale/);

  const tampered = verifiedResource();
  tampered.ownership.owner = "attacker";
  const badDigest = createProjectScopeRenderOriginResolver({
    pool: database(resolverRows(
      verifiedObservation("service"),
      verifiedObservation("repository"),
      tampered,
    )),
    now: () => NOW,
  });
  await assert.rejects(badDigest(scope()), /render_scope_digest_mismatch/);
});

test("observation freshness narrows configured max age and zero never makes it unlimited", async () => {
  for (const observed_at of [
    "2026-08-10T11:55:00.000Z",
    "2026-08-10T11:54:00.000Z",
  ]) {
    const observation = verifiedObservation("service", {
      observed_at,
      freshness_seconds: 60,
    });
    const subject = createProjectScopeRenderOriginResolver({
      pool: database(resolverRows(
        observation,
        verifiedObservation("repository"),
        verifiedResource({ last_verified_at: observed_at }, observation),
      )),
      now: () => NOW,
      maxAgeMs: 24 * 60 * 60 * 1_000,
    });
    await assert.rejects(subject(scope()), /render_scope_observation_stale/);
  }

  const zeroHorizon = verifiedObservation("service", {
    observed_at: "2026-08-08T12:00:00.000Z",
    freshness_seconds: 0,
  });
  const boundedZero = createProjectScopeRenderOriginResolver({
    pool: database(resolverRows(
      zeroHorizon,
      verifiedObservation("repository"),
      verifiedResource({ last_verified_at: zeroHorizon.observed_at }, zeroHorizon),
    )),
    now: () => NOW,
    maxAgeMs: 24 * 60 * 60 * 1_000,
  });
  await assert.rejects(boundedZero(scope()), /render_scope_observation_stale|render_scope_verification_stale/);
});

test("Project Scope resolver blocks self-asserted provenance without an authoritative observation", async () => {
  const forged = verifiedResource({
    provenance: {
      schema_version: "project_scope_render_origin_provenance_v1",
      source: "caller",
      repository: REPOSITORY,
      origin: "https://mapped-core.onrender.com",
      observer_id: "self-asserted",
      evidence_digest: "a".repeat(64),
    },
  });
  const forgedWithoutReceipt = createProjectScopeRenderOriginResolver({
    pool: database([{
      service_resource: forged,
      repository_resource: verifiedRepository(),
      service_observation: null,
      repository_observation: verifiedObservation("repository"),
    }]),
    now: () => NOW,
  });
  await assert.rejects(forgedWithoutReceipt(scope()), /render_scope_provenance_invalid/);
});

test("Project Scope resolver blocks executor/self observations and non-Render origins", async () => {
  const executorObservation = verifiedObservation("service", {
    independence: "EXECUTOR",
  });
  const executor = createProjectScopeRenderOriginResolver({
    pool: database(resolverRows(
      executorObservation,
      verifiedObservation("repository"),
      verifiedResource({}, executorObservation),
    )),
    now: () => NOW,
  });
  await assert.rejects(executor(scope()), /render_scope_observation_not_independent/);

  const hostileObservation = verifiedObservation("service", {
    provenance: {
      ...verifiedObservation("service").provenance,
      source: {
        ...verifiedObservation("service").provenance.source,
        origin: "https://attacker.example.com",
      },
    },
  });
  const badOrigin = createProjectScopeRenderOriginResolver({
    pool: database(resolverRows(
      hostileObservation,
      verifiedObservation("repository"),
      verifiedResource({}, hostileObservation),
    )),
    now: () => NOW,
  });
  await assert.rejects(badOrigin(scope()), /render_scope_origin_invalid/);

  const callerOnly = createFailClosedRenderOriginResolver();
  await assert.rejects(callerOnly(scope({
    origin: "https://caller-core.onrender.com",
  })), /origin_not_bound/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresServerOwnedReleaseTupleObserver } from "../src/causalReleaseTupleObserver.js";
import { HOST_NATIVE_HEALTH_CONTRACT_DIGEST } from "../src/hostNativeGovernance.js";
import {
  PROJECT_SCOPE_RENDER_ORIGIN_PROVENANCE_VERSION,
  PROJECT_SCOPE_REPOSITORY_PROVENANCE_VERSION,
  projectScopeObservationDigest,
  projectScopeResourceDigest,
} from "../src/projectScopeRenderOriginResolver.js";

const NOW = new Date("2026-08-12T12:00:00.000Z");
const TENANT = "tenant-a";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const REPOSITORY = "owner/repo";
const PREVIOUS = "a".repeat(40);
const HEAD = "b".repeat(40);
const TREE = "c".repeat(40);

function observation(kind, id) {
  const service = kind === "service";
  const value = {
    tenant_id: TENANT,
    observation_id: id,
    project_id: PROJECT,
    intent_revision_id: "22222222-2222-4222-8222-222222222222",
    work_id: "33333333-3333-4333-8333-333333333333",
    change_id: "44444444-4444-4444-8444-444444444444",
    obligation_id: service ? "55555555-5555-4555-8555-555555555555" : "66666666-6666-4666-8666-666666666666",
    source: service ? "render_service_origin_readback" : "github_repository_readback",
    observer_identity: service ? "render-observer" : "github-observer",
    observer_role: "independent_verifier",
    provenance: {
      observer: { authority: "authenticated_agent_context" },
      source: service ? {
        schema_version: "render_service_origin_readback_v1", repository: REPOSITORY,
        service_id: "srv-core", environment: "production", origin: "https://core.onrender.com",
      } : { schema_version: "github_repository_readback_v1", repository: REPOSITORY },
    },
    independence: "INDEPENDENT_SYSTEM",
    baseline: {}, freshness_seconds: 600, observed_at: NOW.toISOString(),
    evidence_digest: (service ? "d" : "e").repeat(64), causal_relation: "VERIFIED_READBACK",
    confidence: 1, contradiction_status: "NONE",
  };
  return { ...value, observation_digest: projectScopeObservationDigest(value) };
}

function resource(kind, observed) {
  const service = kind === "service";
  const value = {
    tenant_id: TENANT,
    resource_id: service ? "77777777-7777-4777-8777-777777777777" : "88888888-8888-4888-8888-888888888888",
    project_id: PROJECT,
    resource_type: service ? "render_service_origin" : "github_repository",
    canonical_identifier: service ? "srv-core" : REPOSITORY,
    environment: service ? "production" : "shared",
    ownership: service ? {
      owner: "platform", delivery_method: "github_branch_push_auto_deploy",
      target_resolution: "exact_commit", rollback_mode: "redeploy_previous_commit",
      rollback_receipt_digest: "f".repeat(64),
    } : { owner: "platform" },
    active: true,
    provenance: {
      schema_version: service ? PROJECT_SCOPE_RENDER_ORIGIN_PROVENANCE_VERSION : PROJECT_SCOPE_REPOSITORY_PROVENANCE_VERSION,
      observation_id: observed.observation_id,
      observation_digest: observed.observation_digest,
      evidence_digest: observed.evidence_digest,
    },
    last_verified_at: NOW.toISOString(),
  };
  return { ...value, resource_digest: projectScopeResourceDigest(value) };
}

function jsonResponse(value, overrides = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    status: 200, redirected: false,
    headers: { get(name) { return name.toLowerCase() === "content-type" ? "application/json" : name.toLowerCase() === "content-length" ? String(bytes.byteLength) : null; } },
    async arrayBuffer() { return bytes.buffer; },
    ...overrides,
  };
}

function fixture({ health = {}, rowMutator = (rows) => rows } = {}) {
  const repositoryObservation = observation("repository", "99999999-9999-4999-8999-999999999999");
  const serviceObservation = observation("service", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const rows = rowMutator([
    { resource: resource("repository", repositoryObservation), observation: repositoryObservation },
    { resource: resource("service", serviceObservation), observation: serviceObservation },
  ]);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/pulls/242")) return jsonResponse({
      merged_at: null,
      base: { ref: "main", sha: PREVIOUS, repo: { full_name: REPOSITORY } },
      head: { ref: "feat/release", sha: HEAD, repo: { full_name: REPOSITORY } },
    });
    if (url.endsWith(`/git/commits/${HEAD}`)) return jsonResponse({ sha: HEAD, tree: { sha: TREE } });
    if (url.includes("/pulls/242/files?")) return jsonResponse([{ filename: "src/a.js" }]);
    if (url === "https://core.onrender.com/healthz") return jsonResponse({
      ok: true, render_ready: true, readiness_verified: true, build_commit_sha: PREVIOUS,
      causal_continuity: { state: "ready" }, research_airlock: { ready: true },
      ...health,
    });
    throw new Error(`unexpected:${url}`);
  };
  return {
    calls,
    observer: createPostgresServerOwnedReleaseTupleObserver({
      pool: { async query() { return { rows: structuredClone(rows) }; } }, fetchImpl,
      githubTokenResolver: async () => "github-token", now: () => NOW,
    }),
  };
}

const lookup = {
  tenant_id: TENANT, project_id: PROJECT, project_state_digest: "1".repeat(64),
  genesis_intent_id: "22222222-2222-4222-8222-222222222222",
  intent_revision_id: "33333333-3333-4333-8333-333333333333",
  work_id: "44444444-4444-4444-8444-444444444444",
  change_id: "55555555-5555-4555-8555-555555555555", pull_request: 242,
};

test("server observer resolves source, services, health and rollback only from readbacks", async () => {
  const f = fixture();
  const result = await f.observer(lookup);
  assert.equal(result.repository, REPOSITORY);
  assert.equal(result.base_commit, PREVIOUS);
  assert.equal(result.head_commit, HEAD);
  assert.equal(result.tree_sha, TREE);
  assert.deepEqual(result.changed_files, ["src/a.js"]);
  assert.equal(result.services[0].previous_commit, PREVIOUS);
  assert.equal(result.services[0].target_commit, HEAD);
  assert.equal(result.services[0].health_contract_digest, HOST_NATIVE_HEALTH_CONTRACT_DIGEST);
  assert.equal(result.rollback.target_commit, PREVIOUS);
  assert.equal(result.observations.render.status, "VERIFIED");
  assert(f.calls.every((call) => call.options.redirect === "error"));
});

test("server observer blocks degraded health, cross-tenant scope and non-Render origin", async () => {
  await assert.rejects(fixture({ health: { render_ready: false } }).observer(lookup), /RELEASE_SERVICE_NOT_READY/);
  await assert.rejects(fixture({ rowMutator(rows) { rows[0].resource.tenant_id = "tenant-b"; return rows; } }).observer(lookup), /RELEASE_SCOPE_BINDING_MISMATCH/);
  await assert.rejects(fixture({ rowMutator(rows) {
    rows[1].observation.provenance.source.origin = "https://attacker.example.com";
    rows[1].observation.observation_digest = projectScopeObservationDigest(rows[1].observation);
    rows[1].resource.provenance.observation_digest = rows[1].observation.observation_digest;
    rows[1].resource.resource_digest = projectScopeResourceDigest(rows[1].resource);
    return rows;
  } }).observer(lookup), /RELEASE_SERVICE_ORIGIN_INVALID/);
});

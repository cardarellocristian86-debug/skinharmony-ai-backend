import assert from "node:assert/strict";
import test from "node:test";
import {
  SoftwareCognitionError,
  analyzeJavaScriptTypeScript,
  calculateCausalObligationCoverage,
  calibrateSoftwareSupervision,
  buildRequirementTraceability,
  createWorkerPlanContract,
  deterministicSoftwareId,
  evaluateSoftwareClosure,
  expandSoftwareObligations,
  indexSoftwareDiff,
  predictSoftwareImpact,
  recoverSoftwareArchitecture,
  reconcileSoftwareImpact,
  resolveSupervisoryChallenge,
  softwareDigest,
  superviseWorkerPlan,
  validateGraphMutation,
  validateLearningPromotion,
} from "../src/softwareCognition.js";

const scope = { tenant_id: "tenant-a", project_id: "project-a" };
const work = { work_id: "work-a", change_id: "change-a" };

function graphFixture() {
  const ids = Object.fromEntries([
    ["file", ["file", "src/service.js"]],
    ["api", ["api_endpoint", "api:GET:/v1/items"]],
    ["test", ["test", "test/service.test.js"]],
    ["runtime", ["service_runtime", "runtime:service-a"]],
  ].map(([name, [kind, source_ref]]) => [name, deterministicSoftwareId({ ...scope, kind, source_ref })]));
  return {
    revision: 4,
    nodes: [
      { node_id: ids.file, kind: "file" }, { node_id: ids.api, kind: "api_endpoint" },
      { node_id: ids.test, kind: "test" }, { node_id: ids.runtime, kind: "service_runtime" },
    ],
    edges: [
      { edge_type: "contains", from_node_id: ids.file, to_node_id: ids.api },
      { edge_type: "tests", from_node_id: ids.api, to_node_id: ids.test },
      { edge_type: "observed_by", from_node_id: ids.api, to_node_id: ids.runtime },
    ],
    ids,
  };
}

function plan(overrides = {}) {
  return createWorkerPlanContract({
    ...scope, ...work, plan_id: "plan-a", base_state_digest: "a".repeat(64),
    actor_provenance: { agent_id: "builder", session_fingerprint: "builder-session" }, goal: "Change the shared API safely",
    hypotheses: [], assumptions: [], affected_components: [], planned_changes: [], expected_effects: [], expected_non_effects: [],
    risks: [], tests: ["node --test"], rollback: ["forward revert"], unknowns: [], ...overrides,
  });
}

function verifiedClosure(overrides = {}) {
  return {
    ...work,
    intent_binding: { id: "intent-a", digest: "1".repeat(64), state: "verified" },
    icf_required: true,
    icf_binding: { id: "icf-a", digest: "2".repeat(64), state: "verified" },
    acceptance_criteria_verified: true,
    obligations: [{ obligation_id: "o1", type: "test", criticality: "critical", required: true, blocking: true, status: "verified" }],
    challenges: [], reconciliation: { reconciled: true }, architecture_constraints_verified: true, tests_verified: true,
    runtime_observation: { verified: true, fresh: true }, rollback: { verified: true },
    builder: { agent_id: "builder", session_fingerprint: "builder-session" },
    verifier: { agent_id: "verifier", session_fingerprint: "verifier-session", independently_verified: true },
    core_join: { valid: true }, ...overrides,
  };
}

test("deterministic IDs are reusable but tenant and project scoped", () => {
  const input = { ...scope, kind: "file", source_ref: "src/a.js" };
  assert.equal(deterministicSoftwareId(input), deterministicSoftwareId(input));
  assert.notEqual(deterministicSoftwareId(input), deterministicSoftwareId({ ...input, tenant_id: "tenant-b" }));
  assert.notEqual(deterministicSoftwareId(input), deterministicSoftwareId({ ...input, project_id: "project-b" }));
});

test("graph mutation rejects stale revisions, foreign nodes, foreign edges, and missing endpoints", () => {
  const node = { kind: "file", source_ref: "src/a.js" };
  assert.throws(() => validateGraphMutation({ ...scope, expected_revision: 1, nodes: [node], edges: [] }, { currentRevision: 2 }), /stale_graph_revision/);
  assert.throws(() => validateGraphMutation({ ...scope, expected_revision: 0, nodes: [{ ...node, tenant_id: "tenant-b" }], edges: [] }), /cross_tenant_node_reference/);
  assert.throws(() => validateGraphMutation({ ...scope, expected_revision: 0, nodes: [{ ...node, node_id: "scn_forged" }], edges: [] }), /node_id_scope_mismatch/);
  const id = deterministicSoftwareId({ ...scope, ...node });
  assert.throws(() => validateGraphMutation({ ...scope, expected_revision: 0, nodes: [node], edges: [{ tenant_id: "tenant-b", edge_type: "depends_on", from_node_id: id, to_node_id: id }] }), /cross_tenant_edge/);
  assert.throws(() => validateGraphMutation({ ...scope, expected_revision: 0, nodes: [node], edges: [{ edge_type: "depends_on", from_node_id: id, to_node_id: "missing" }] }), /edge_endpoint_not_found/);
});

test("incremental indexer extracts symbols, imports, env, routes and tombstones", () => {
  const indexed = indexSoftwareDiff({ ...scope, repository: "owner/repo", base_commit: "a".repeat(40), head_commit: "b".repeat(40), known_graph_revision: 3, changed_files: [
    { path: "src/api.js", status: "modified", content: "import x from 'pkg'; export function handler() { return process.env.API_URL; } app.get('/v1/items', handler);" },
    { path: "src/old.js", status: "deleted" },
  ] });
  assert.equal(indexed.graph_revision, 4);
  assert.ok(indexed.nodes_added_or_updated.some((node) => node.kind === "function"));
  assert.ok(indexed.nodes_added_or_updated.some((node) => node.kind === "module"));
  assert.ok(indexed.nodes_added_or_updated.some((node) => node.kind === "environment_variable_reference"));
  assert.ok(indexed.nodes_added_or_updated.some((node) => node.kind === "api_endpoint"));
  assert.ok(indexed.edges_added.filter((edge) => edge.edge_type === "contains").length >= 2);
  assert.equal(indexed.nodes_tombstoned.length, 1);
  assert.match(indexed.source_digest, /^[a-f0-9]{64}$/);
});

test("TypeScript compiler pass extracts syntax evidence without matching comments or strings", () => {
  const analysis = analyzeJavaScriptTypeScript("src/api.ts", `
    import type { Request } from "express";
    export { helper as publicHelper } from "./helper.js";
    export interface Result { ok: boolean }
    export class Api { run(): Result { return helper(); } }
    export const HANDLER_KIND = "items";
    const local = async () => client.fetch();
    const endpoint = process.env.API_URL;
    const secret = process.env["API_TOKEN"];
    router.post("/v1/items", local);
    // function phantom() {} app.get("/phantom", phantom)
    const inert = 'require("phantom") process.env.PHANTOM';
  `);
  assert.equal(analysis.parser, "typescript_compiler_api");
  assert.equal(analysis.parser_version, "6.0.3");
  assert.ok(analysis.declarations.some((item) => item.kind === "class" && item.name === "Api" && item.exported));
  assert.ok(analysis.declarations.some((item) => item.kind === "method" && item.name === "Api.run"));
  assert.ok(analysis.declarations.some((item) => item.kind === "type" && item.name === "Result"));
  assert.ok(analysis.declarations.some((item) => item.kind === "constant" && item.name === "HANDLER_KIND"));
  assert.ok(analysis.declarations.some((item) => item.kind === "function" && item.name === "local"));
  assert.ok(analysis.imports.some((item) => item.specifier === "express" && item.type_only));
  assert.ok(analysis.imports.some((item) => item.specifier === "./helper.js" && item.re_export));
  assert.ok(analysis.exports.some((item) => item.name === "publicHelper"));
  assert.ok(analysis.calls.some((item) => item.callee === "helper"));
  assert.ok(analysis.calls.some((item) => item.callee === "client.fetch"));
  assert.deepEqual(new Set(analysis.environment.map((item) => item.name)), new Set(["API_URL", "API_TOKEN"]));
  assert.deepEqual(analysis.routes.map((item) => `${item.method} ${item.path}`), ["POST /v1/items"]);
  assert.equal(analysis.declarations.some((item) => item.name === "phantom"), false);
  assert.equal(analysis.imports.some((item) => item.specifier === "phantom"), false);
  assert.equal(analysis.environment.some((item) => item.name === "PHANTOM"), false);
});

test("AST-backed index records declarations, exports, calls and pinned parser provenance", () => {
  const indexed = indexSoftwareDiff({ ...scope, repository: "owner/repo", base_commit: "a".repeat(40), head_commit: "b".repeat(40), known_graph_revision: 0,
    changed_files: [{ path: "src/worker.ts", status: "added", content: `import { queue } from "./queue.js"; export function run() { queue.publish(process.env["QUEUE_NAME"]); }` }],
  });
  const file = indexed.nodes_added_or_updated.find((node) => node.source_ref === "src/worker.ts");
  assert.equal(file.provenance.parser, "typescript_compiler_api");
  assert.equal(file.provenance.parser_version, "6.0.3");
  assert.ok(file.payload.exports.some((item) => item.name === "run"));
  assert.ok(indexed.edges_added.some((edge) => edge.edge_type === "imports"));
  assert.ok(indexed.edges_added.some((edge) => edge.edge_type === "calls"));
  assert.ok(indexed.edges_added.some((edge) => edge.edge_type === "reads"));
  assert.ok(indexed.nodes_added_or_updated.some((node) => node.kind === "function" && node.source_ref === "src/worker.ts#function:run"));
});

test("file classification emits explicit migration, test, and configuration evidence", () => {
  const indexed = indexSoftwareDiff({ ...scope, repository: "owner/repo", base_commit: "a".repeat(40), head_commit: "b".repeat(40), known_graph_revision: 0,
    changed_files: [
      { path: "migrations/001_add.sql", status: "added", content: "ALTER TABLE examples ADD COLUMN enabled boolean;" },
      { path: "test/api.test.ts", status: "added", content: "test('works', () => run());" },
      { path: "config/render.yaml", status: "added", content: "services: []" },
    ],
  });
  const migration = indexed.nodes_added_or_updated.find((node) => node.kind === "database_migration");
  const testNode = indexed.nodes_added_or_updated.find((node) => node.kind === "test");
  const config = indexed.nodes_added_or_updated.find((node) => node.kind === "configuration");
  assert.equal(migration.payload.migration_evidence, true);
  assert.equal(testNode.payload.test_evidence, true);
  assert.equal(config.payload.configuration_evidence, true);
});

test("incremental indexer invalidates stale symbols and source-owned edges after modification", () => {
  const fileId = deterministicSoftwareId({ ...scope, kind: "file", source_ref: "src/api.js" });
  const oldFunction = deterministicSoftwareId({ ...scope, kind: "function", source_ref: "src/api.js#function:oldHandler" });
  const oldRoute = deterministicSoftwareId({ ...scope, kind: "api_endpoint", source_ref: "src/api.js#api:GET:/v1/old" });
  const indexed = indexSoftwareDiff({ ...scope, repository: "owner/repo", base_commit: "a".repeat(40), head_commit: "b".repeat(40), known_graph_revision: 7,
    known_nodes: [
      { ...scope, node_id: fileId, kind: "file", source_ref: "src/api.js" },
      { ...scope, node_id: oldFunction, kind: "function", source_ref: "src/api.js#function:oldHandler" },
      { ...scope, node_id: oldRoute, kind: "api_endpoint", source_ref: "src/api.js#api:GET:/v1/old" },
    ],
    known_edges: [{ ...scope, edge_id: "sce_old", edge_type: "contains", from_node_id: fileId, to_node_id: oldRoute, provenance: { source_path: "src/api.js" } }],
    changed_files: [{ path: "src/api.js", status: "modified", content: "export function newHandler() {} app.get('/v1/new', newHandler);" }],
  });
  assert.ok(indexed.nodes_tombstoned.some((node) => node.node_id === oldFunction));
  assert.ok(indexed.nodes_tombstoned.some((node) => node.node_id === oldRoute));
  assert.ok(indexed.edges_removed.some((edge) => edge.edge_id === "sce_old"));
  assert.ok(indexed.nodes_added_or_updated.some((node) => node.source_ref === "src/api.js#function:newHandler"));
});

test("incremental deletion invalidates every known symbol owned by the deleted file", () => {
  const fileId = deterministicSoftwareId({ ...scope, kind: "file", source_ref: "src/old.js" });
  const symbolId = deterministicSoftwareId({ ...scope, kind: "function", source_ref: "src/old.js#function:old" });
  const indexed = indexSoftwareDiff({ ...scope, repository: "owner/repo", base_commit: "a".repeat(40), head_commit: "b".repeat(40), known_graph_revision: 1,
    known_nodes: [{ ...scope, node_id: fileId, kind: "file", source_ref: "src/old.js" }, { ...scope, node_id: symbolId, kind: "function", source_ref: "src/old.js#function:old" }],
    changed_files: [{ path: "src/old.js", status: "deleted" }],
  });
  assert.deepEqual(new Set(indexed.nodes_tombstoned.map((node) => node.node_id)), new Set([fileId, symbolId]));
});

test("scenario A isolated function has small impact", () => {
  const id = deterministicSoftwareId({ ...scope, kind: "function", source_ref: "src/a.js#function:a" });
  const impact = predictSoftwareImpact({ ...scope, ...work, graph: { revision: 1, nodes: [{ node_id: id, kind: "function" }], edges: [] }, seed_node_ids: [id] });
  assert.equal(impact.blast_radius.classification, "small");
  assert.deepEqual(impact.required_checks, ["unit"]);
});

test("scenario B shared API expands consumer, test, deployment and runtime obligations", () => {
  const graph = graphFixture();
  const impact = predictSoftwareImpact({ ...scope, ...work, graph, seed_node_ids: [graph.ids.file] });
  assert.equal(impact.predicted_impact_set.api, true);
  assert.equal(impact.predicted_impact_set.runtime, true);
  assert.ok(impact.required_checks.includes("api_contract"));
  const obligations = expandSoftwareObligations({ ...scope, ...work, impact });
  assert.ok(obligations.some((item) => item.type === "api_contract" && item.criticality === "critical"));
  assert.ok(obligations.some((item) => item.type === "runtime_observation" && item.blocking));
});

test("impact traversal expands reverse consumers of a changed dependency", () => {
  const dependency = deterministicSoftwareId({ ...scope, kind: "module", source_ref: "module:shared" });
  const consumer = deterministicSoftwareId({ ...scope, kind: "file", source_ref: "src/consumer.js" });
  const impact = predictSoftwareImpact({ ...scope, ...work, graph: { revision: 1,
    nodes: [{ node_id: dependency, kind: "module" }, { node_id: consumer, kind: "file" }],
    edges: [{ edge_type: "imports", from_node_id: consumer, to_node_id: dependency }] }, seed_node_ids: [dependency] });
  assert.ok(impact.affected_nodes.some((node) => node.node_id === consumer));
  assert.ok(impact.affected_edges.some((edge) => edge.traversal === "reverse_consumer"));
  assert.equal(impact.predicted_impact_set.consumer > 0, true);
});

test("traceability preserves inferred provenance and grants hard-block authority only to verified links", () => {
  const requirement = deterministicSoftwareId({ ...scope, kind: "requirement", source_ref: "req:1" });
  const capability = deterministicSoftwareId({ ...scope, kind: "capability", source_ref: "cap:1" });
  const graph = { nodes: [{ node_id: requirement, kind: "requirement" }, { node_id: capability, kind: "capability" }], edges: [] };
  const traceability = buildRequirementTraceability({ ...scope, graph, links: [
    { from_node_id: requirement, to_node_id: capability, relation: "satisfies", state: "inferred_candidate", provenance: { parser: "manifest" }, confidence: 0.7, evidence_refs: ["e1"] },
    { from_node_id: capability, to_node_id: requirement, relation: "derived_from", state: "verified", provenance: { verifier: "independent" }, evidence_refs: ["e2"] },
  ] });
  assert.equal(traceability.links.length, 2);
  assert.equal(traceability.hard_block_authority_link_ids.length, 1);
  assert.equal(traceability.inferred_links_are_authoritative, false);
  assert.throws(() => buildRequirementTraceability({ ...scope, graph, links: [{ tenant_id: "tenant-b", from_node_id: requirement, to_node_id: capability, relation: "satisfies", state: "verified" }] }), /cross_tenant_traceability/);
  assert.throws(() => buildRequirementTraceability({ ...scope, graph, links: [{ from_node_id: requirement, to_node_id: capability, relation: "satisfies", state: "inferred_candidate" }] }), /inferred_traceability_evidence_required/);
});

test("architecture recovery distinguishes observed, inferred, and independently verified assertions", () => {
  const service = { node_id: deterministicSoftwareId({ ...scope, kind: "service", source_ref: "services/api" }), kind: "service", source_ref: "services/api", digest: "1".repeat(64) };
  const route = { node_id: deterministicSoftwareId({ ...scope, kind: "file", source_ref: "routes/items.js" }), kind: "file", source_ref: "routes/items.js", digest: "2".repeat(64) };
  const first = recoverSoftwareArchitecture({ ...scope, graph: { nodes: [service, route], edges: [{ edge_type: "contains", from_node_id: service.node_id, to_node_id: route.node_id }] } });
  assert.ok(first.assertions.some((item) => item.state === "observed"));
  const inferred = first.assertions.find((item) => item.state === "inferred");
  assert.ok(inferred);
  assert.equal(first.architecture_patterns_are_authoritative, false);
  const verified = recoverSoftwareArchitecture({ ...scope, graph: { nodes: [service, route], edges: [] }, verification_evidence: [{ assertion_id: inferred.assertion_id, verification_state: "verified", evidence_digest: "a".repeat(64) }] });
  assert.ok(verified.assertions.some((item) => item.assertion_id === inferred.assertion_id && item.state === "verified"));
});

test("calibration excludes unverified outcomes and only adapts supervision controls", () => {
  const verifiedCase = (overrides = {}) => ({ ...scope, outcome_state: "verified", independently_verified: true, evidence_digest: "a".repeat(64),
    scope_prediction_accurate: true, dependencies_complete: false, obligations_complete: false, impact_prediction_accurate: true,
    tests_complete: true, false_completion: false, regression: false, verification_passed: true, ...overrides });
  const calibration = calibrateSoftwareSupervision({ ...scope, cases: [verifiedCase(), verifiedCase(), verifiedCase({ false_completion: true }), { ...scope, outcome_state: "candidate" }] });
  assert.equal(calibration.metrics.sample_size, 3);
  assert.equal(calibration.excluded_unverified_cases, 1);
  assert.equal(calibration.adaptation.supervision_depth, "elevated");
  assert.equal(calibration.ranking_authorized, false);
  assert.equal(calibration.model_weight_mutation_authorized, false);
  assert.throws(() => calibrateSoftwareSupervision({ ...scope, cases: [{ ...verifiedCase(), tenant_id: "tenant-b" }] }), /cross_tenant_calibration/);
});

test("scenario C database change requires migration, rollback and runtime evidence", () => {
  const id = deterministicSoftwareId({ ...scope, kind: "database_migration", source_ref: "migrations/1.sql" });
  const runtime = deterministicSoftwareId({ ...scope, kind: "service_runtime", source_ref: "runtime:db" });
  const impact = predictSoftwareImpact({ ...scope, ...work, graph: { revision: 1, nodes: [{ node_id: id, kind: "database_migration" }, { node_id: runtime, kind: "service_runtime" }], edges: [{ edge_type: "observed_by", from_node_id: id, to_node_id: runtime }] }, seed_node_ids: [id] });
  const obligations = expandSoftwareObligations({ ...scope, ...work, impact });
  assert.ok(obligations.some((item) => item.type === "migration" && item.criticality === "critical"));
  assert.ok(obligations.some((item) => item.type === "rollback"));
  assert.ok(obligations.some((item) => item.type === "runtime_observation"));
});

test("scenario D underapproximated worker scope creates critical challenge", () => {
  const graph = graphFixture();
  const impact = predictSoftwareImpact({ ...scope, ...work, graph, seed_node_ids: [graph.ids.file] });
  const obligations = expandSoftwareObligations({ ...scope, ...work, impact });
  const result = superviseWorkerPlan({ ...scope, ...work, plan: plan({ affected_components: [graph.ids.file], planned_changes: obligations.map((item) => ({ obligation_id: item.obligation_id })) }), impact, obligations, bindings: { intent_id: "i", intent_digest: "d", icf_required: true, icf_id: "c", icf_digest: "e" } });
  assert.ok(result.challenges.some((item) => item.challenge_type === "scope_underapproximated" && item.severity === "critical"));
});

test("scenario E false completion without runtime evidence is denied", () => {
  const result = evaluateSoftwareClosure(verifiedClosure({ runtime_observation: { verified: false, fresh: false } }));
  assert.equal(result.verdict, "CLOSURE_DENIED");
  assert.ok(result.reasons.includes("runtime_observation_missing"));
});

test("scenario F unplanned diff is detected and blocks reconciliation", () => {
  const graph = graphFixture();
  const predicted = predictSoftwareImpact({ ...scope, ...work, graph, seed_node_ids: [graph.ids.file], max_depth: 0 });
  const actual = { base_graph_revision: 4, changed_nodes: [{ node_id: graph.ids.file }, { node_id: graph.ids.api }] };
  const result = reconcileSoftwareImpact({ ...scope, predicted, actual });
  assert.equal(result.reconciled, false);
  assert.ok(result.deltas.some((item) => item.type === "UNPLANNED_CHANGE" && item.node_id === graph.ids.api));
});

test("stale impact calculation is rejected", () => {
  assert.throws(() => reconcileSoftwareImpact({ ...scope, predicted: { graph_revision: 4, affected_nodes: [] }, actual: { base_graph_revision: 3, changed_nodes: [] } }), /stale_impact_calculation/);
});

test("scenario G contradictory evidence reopens coverage and closure", () => {
  const coverage = calculateCausalObligationCoverage([{ type: "runtime_observation", criticality: "critical", required: true, blocking: true, status: "reopened" }]);
  assert.equal(coverage.closure_eligible, false);
  assert.equal(coverage.critical_missing, 1);
  assert.equal(coverage.contradicted, 1);
});

test("COC is weighted, category-specific, and never trusts caller coverage", () => {
  const result = calculateCausalObligationCoverage([
    { type: "documentation_contract", criticality: "advisory", required: false, blocking: false, status: "verified" },
    { type: "security", criticality: "critical", required: true, blocking: true, status: "verifying", weighted_coverage: 1 },
  ]);
  assert.ok(result.weighted_coverage < 0.1);
  assert.equal(result.critical_missing, 1);
  assert.equal(result.blocking_missing, 1);
  assert.equal(result.closure_eligible, false);
  assert.equal(result.category_coverage.security.coverage, 0);
});

test("worker plan digest is deterministic and timestamp-free", () => {
  const first = plan();
  const second = plan({ timestamp: "2099-01-01T00:00:00Z" });
  assert.equal(first.plan_digest, second.plan_digest);
  assert.equal(first.plan_digest, softwareDigest(Object.fromEntries(Object.entries(first).filter(([key]) => key !== "plan_digest"))));
});

test("rebuttal requires evidence and challenge resolution is CAS protected", () => {
  const challenge = { challenge_id: "c", status: "open", version: 1, severity: "critical" };
  assert.throws(() => resolveSupervisoryChallenge(challenge, { action: "REBUT", expected_version: 1, evidence_refs: [] }), /rebuttal_evidence_required/);
  assert.throws(() => resolveSupervisoryChallenge(challenge, { action: "ACCEPT", expected_version: 0 }), /stale_challenge_revision/);
  const accepted = resolveSupervisoryChallenge(challenge, { action: "ACCEPT", expected_version: 1 });
  assert.equal(accepted.status, "accepted");
  assert.throws(() => resolveSupervisoryChallenge(accepted, { action: "ACCEPT", expected_version: 2 }), /challenge_not_open/);
});

test("learning promotion rejects unverified and cross-tenant outcomes", () => {
  assert.throws(() => validateLearningPromotion({ ...scope, evidence_tenant_id: "tenant-a", outcome_state: "candidate", independently_verified: false }), /unverified_learning_promotion/);
  assert.throws(() => validateLearningPromotion({ ...scope, evidence_tenant_id: "tenant-b", outcome_state: "verified", independently_verified: true, evidence_digest: "a".repeat(64) }), /cross_tenant_learning/);
  const verified = validateLearningPromotion({ ...scope, evidence_tenant_id: "tenant-a", outcome_state: "verified", independently_verified: true, evidence_digest: "a".repeat(64), source_work_id: "w", candidate: { component: "api" } });
  assert.equal(verified.policy_mutation_authorized, false);
  assert.equal(verified.model_weight_mutation_authorized, false);
});

test("closure fails closed on critical obligations and caller fake completion", () => {
  const result = evaluateSoftwareClosure(verifiedClosure({ obligations: [{ obligation_id: "critical", type: "security", criticality: "critical", required: true, blocking: true, status: "executed" }], completion: true, coverage: { closure_eligible: true } }));
  assert.equal(result.verdict, "CLOSURE_DENIED");
  assert.ok(result.reasons.includes("obligation_coverage_incomplete"));
});

test("builder cannot self-verify even when work creator differs", () => {
  const result = evaluateSoftwareClosure(verifiedClosure({ created_by: { agent_id: "coordinator" }, verifier: { agent_id: "builder", session_fingerprint: "other", independently_verified: true } }));
  assert.equal(result.verdict, "CLOSURE_DENIED");
  assert.ok(result.reasons.includes("independent_verifier_missing"));
});

test("same verifier session is rejected", () => {
  const result = evaluateSoftwareClosure(verifiedClosure({ verifier: { agent_id: "verifier", session_fingerprint: "builder-session", independently_verified: true } }));
  assert.equal(result.verdict, "CLOSURE_DENIED");
});

test("open critical challenge blocks closure", () => {
  const result = evaluateSoftwareClosure(verifiedClosure({ challenges: [{ severity: "critical", status: "rebutted" }] }));
  assert.equal(result.verdict, "CLOSURE_DENIED");
  assert.ok(result.reasons.includes("blocking_supervisory_challenge"));
});

test("missing or stale ICF and Genesis/Intent authority blocks closure", () => {
  const icf = evaluateSoftwareClosure(verifiedClosure({ icf_binding: { state: "verified" } }));
  assert.ok(icf.reasons.includes("icf_not_verified"));
  const intent = evaluateSoftwareClosure(verifiedClosure({ intent_binding: { id: "i", digest: "old", state: "stale" } }));
  assert.ok(intent.reasons.includes("intent_not_verified"));
});

test("positive closure remains advisory until existing Core Join transition", () => {
  const result = evaluateSoftwareClosure(verifiedClosure());
  assert.equal(result.verdict, "RELEASE_READY");
  assert.equal(result.authoritative_transition_performed, false);
  assert.match(result.closure_digest, /^[a-f0-9]{64}$/);
});

test("domain errors expose bounded stable codes", () => {
  try {
    deterministicSoftwareId({ ...scope, kind: "unknown", source_ref: "x" });
    assert.fail("expected error");
  } catch (error) {
    assert.ok(error instanceof SoftwareCognitionError);
    assert.equal(error.code, "node_kind_invalid");
  }
});

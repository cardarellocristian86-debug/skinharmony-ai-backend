"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const test = require("node:test");
const {
  DEFAULT_CATALOG_PATH,
  REQUIRED_CONTRACT_FIELDS,
  catalogFingerprint,
  evaluateNode,
  featureFlags,
  loadCatalog,
  route,
  serializeCatalog,
  topologyMetrics,
  validateCatalog,
} = require("../lib/nyra-deep-branch-v2");

const expectedBranchCounts = Object.freeze({
  context_intelligence: 10,
  work_intake: 14,
  research_evidence: 20,
  decision_reasoning: 10,
  planning_prioritization: 15,
  risk_governance: 12,
  delegated_authority: 14,
  decision_provenance: 14,
  execution_planning: 10,
  parallel_coordination: 15,
  quality_verification: 16,
  learning_memory: 10,
  adaptive_learning: 16,
  communication_explanation: 10,
  software_intelligence: 20,
  suite_domain: 8,
  smartdesk_domain: 8,
  analyzer_domain: 17,
});
const fixtureBundlePath = path.resolve(__dirname, "../data/nyra-deep-branch-v2.fixtures.json");

function catalog() {
  return JSON.parse(fs.readFileSync(DEFAULT_CATALOG_PATH, "utf8"));
}

let functionContextCache = null;
function functionContext(node) {
  if (!functionContextCache) {
    const data = catalog();
    functionContextCache = {
      registryHash: data.function_registry.registry_hash,
      byId: new Map(data.function_registry.functions.map((spec) => [spec.function_id, spec])),
    };
  }
  return {
    functionSpec: functionContextCache.byId.get(node.id),
    functionRegistryHash: functionContextCache.registryHash,
  };
}

function resolveFixture(bundle, fixtureId, seen = new Set()) {
  const descriptor = bundle.fixtures[fixtureId];
  if (!descriptor) return null;
  if (seen.has(fixtureId)) throw new Error(`Fixture cycle: ${fixtureId}`);
  seen.add(fixtureId);
  const {
    base_fixture: baseFixture,
    evidence_tenant_override: evidenceTenantOverride,
    ...own
  } = descriptor;
  const resolved = baseFixture
    ? { ...structuredClone(resolveFixture(bundle, baseFixture, seen)), ...structuredClone(own) }
    : structuredClone(own);
  if (evidenceTenantOverride) {
    resolved.evidence = resolved.evidence.map((item) => ({ ...item, tenant_id: evidenceTenantOverride }));
  }
  return resolved;
}

function enabledEnv(overrides = {}) {
  return {
    NYRA_DEEP_BRANCH_V2_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_MODE: "shadow",
    NYRA_DEEP_BRANCH_V2_BRANCHES: Object.keys(expectedBranchCounts).join(","),
    NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: "codexai",
    ...overrides,
  };
}

function corePayload(branchIds) {
  return {
    tenant_id: "codexai",
    domain_pack: { id: "skinharmony" },
    result: {
      nyra_neural_network: {
        opened_by: "universal_core",
        opened_branches: branchIds.map((id) => ({ id, status: "opened" })),
        execution_authorized: false,
      },
    },
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function rawTextHash(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function evidenceProvenanceHash(item) {
  return sha256({
    tenant_id: item.tenant_id,
    evidence_type: item.evidence_type,
    authority: item.authority,
    independent: item.independent === true,
    content: item.content,
    payload_hash: item.payload_hash,
    observed_at: item.observed_at,
  });
}

function evidenceAcceptanceRule(program) {
  return `Execute ${program.kind} ${sha256(program)}: require the exact claim, content tag, subject, record and Core manifest bindings for capability spec ${program.capability_spec_hash}.`;
}

function strategyRule(program) {
  return `Execute ${program.kind} ${sha256(program)}: select only when ${program.all.join(", ")}; otherwise ${program.on_false}.`;
}

function verifierCondition(program) {
  return `Execute ${program.kind} ${sha256(program)} and require every independent check: ${program.all.join(", ")}.`;
}

function metricDefinition(program) {
  return `Execute ${program.kind} ${sha256(program)}: compute ${program.formula} from ${program.source_fields.join(", ")} and require ${program.threshold_operator} ${program.target} ${program.unit} for capability spec ${program.capability_spec_hash}.`;
}

function rebindSemanticContract(node) {
  const method = node.methods[0];
  const strategy = node.strategies[0];
  const verifier = node.verifiers[0];
  const metric = node.metrics[0];
  const projection = {
    problem_hash: rawTextHash(node.problem_solved),
    purpose_hash: sha256(node.purpose),
    evidence_claim_hashes: node.required_evidence.map((item) => item.semantic_claim_hash),
    evidence_program_hashes: node.required_evidence.map((item) => sha256(item.acceptance_program)),
    failure_signature_hashes: node.failure_modes.map((item) => sha256(String(item.scenario || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim())),
    operation: method.operation,
    mechanism_id: method.parameters.mechanism_id,
    capability_id: method.parameters.capability_id,
    capability_spec_hash: method.parameters.capability_spec_hash,
    record_claim_hash: method.parameters.record_claim_hash,
    transformation_goal_hash: sha256(method.parameters.transformation_goal),
    semantic_function_hash: method.program.semantic_function_hash,
    execution_plan_hash: method.program.execution_plan_hash,
    role_projection_hash: sha256(method.program.role_projection),
    method_program_hash: sha256(method.program),
    strategy_predicate: strategy.selection_predicate,
    strategy_rule_hash: sha256(strategy.selection_rule),
    strategy_program_hash: sha256(strategy.predicate_program),
    verifier_pass_condition_hash: sha256(verifier.pass_condition),
    verifier_program_hash: sha256(verifier.predicate_program),
    verifier_checks: [...verifier.checks].sort(),
    metric_formula: metric.formula,
    metric_source_fields: [...metric.source_fields].sort(),
    metric_definition_hash: sha256(metric.definition),
    metric_program_hash: sha256(metric.formula_program),
    core_policy_bindings_hash: sha256(node.core_policy_bindings),
    function_binding_hash: sha256(node.function_binding),
  };
  node.semantic_contract = {
    ...node.semantic_contract,
    ...projection,
    semantic_hash: sha256(projection),
  };
  return node;
}

function rebindFixture(node, sourceFixture) {
  const fixture = structuredClone(sourceFixture);
  const inputHash = sha256(fixture.capability_input);
  const subjectHash = sha256(fixture.capability_input.subject);
  const recordHashes = fixture.capability_input.records.map((record) => sha256(record));
  for (const item of fixture.evidence) {
    item.content.semantic_hash = node.semantic_contract.semantic_hash;
    item.content.capability_input_hash = inputHash;
    item.content.subject_hash = subjectHash;
    item.content.record_hashes = recordHashes;
    item.payload_hash = sha256(item.content);
    item.provenance_hash = evidenceProvenanceHash(item);
  }
  const manifestPayload = {
    issuer: "universal_core",
    tenant_id: fixture.tenant_id,
    node_id: node.id,
    branch_id: node.branch_id,
    semantic_hash: node.semantic_contract.semantic_hash,
    function_registry_hash: node.function_binding.registry_hash,
    semantic_function_hash: node.function_binding.semantic_function_hash,
    capability_input_hash: inputHash,
    evidence_hashes: fixture.evidence.map((item) => item.provenance_hash),
  };
  const manifest = { ...manifestPayload, manifest_hash: sha256(manifestPayload) };
  fixture.core_payload.result.evidence_manifest = manifest;
  for (const decision of fixture.core_payload.result.policy_decisions) {
    decision.snapshot.semantic_hash = node.semantic_contract.semantic_hash;
    decision.snapshot.function_registry_hash = node.function_binding.registry_hash;
    decision.snapshot.semantic_function_hash = node.function_binding.semantic_function_hash;
    decision.snapshot.evidence_manifest_hash = manifest.manifest_hash;
    decision.snapshot_hash = sha256(decision.snapshot);
  }
  return fixture;
}

function evaluateFixture(node, fixture, requestId, runtimeOverrides = {}) {
  return evaluateNode({
    node,
    tenantId: fixture.tenant_id,
    subbranchId: fixture.subbranch_id,
    corePayload: fixture.core_payload,
    evidence: fixture.evidence,
    evidenceSource: fixture.evidence_source,
    capabilityInput: fixture.capability_input,
    ...functionContext(node),
    parentEvaluations: new Map(fixture.verified_parent_ids.map((id) => [id, { state: "advisory_verified" }])),
    requestId,
    observedAt: fixture.observed_at,
    ...runtimeOverrides,
  });
}

test("approved runtime catalog matches the authenticated live topology", () => {
  const loaded = loadCatalog({ forceReload: true });
  assert.equal(loaded.ok, true, loaded.validation.errors.join("\n"));
  assert.deepEqual(loaded.validation.errors, []);
  assert.equal(loaded.catalog.catalog_fingerprint, catalogFingerprint(loaded.catalog));
  assert.deepEqual(topologyMetrics(loaded.catalog), {
    branch_count: 18,
    subbranch_count: 239,
    node_count: 1434,
    level_counts: { 1: 239, 2: 239, 3: 239, 4: 956 },
    level4_type_counts: { method: 239, strategy: 239, verifier: 239, metric: 239 },
  });
  assert.deepEqual(
    Object.fromEntries(loaded.catalog.branches.map((branch) => [branch.id, branch.subbranches.length])),
    expectedBranchCounts
  );
  assert.equal(loaded.catalog.source_catalog.tenant_id, "codexai");
  assert.equal(loaded.catalog.source_catalog.source, "https://skinharmony-universal-core.onrender.com/v1/nira/branches");
  assert.equal(loaded.catalog.function_registry.functions.length, 1434);
  assert.equal(
    new Set(loaded.catalog.function_registry.functions.map((spec) => spec.semantic_function_hash)).size,
    1434
  );
  assert.equal(
    new Set(loaded.catalog.function_registry.functions.map((spec) => JSON.stringify({
      source: spec.semantic_source,
      assertions: spec.semantic_assertions,
      execution_plan: spec.execution_plan,
    }))).size,
    1434
  );
});

test("every L2-L4 node has an independent complete contract and exact parent topology", () => {
  const data = catalog();
  const validation = validateCatalog(data);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  const nodeIndex = new Map(data.nodes.map((node) => [node.id, node]));
  const purposes = new Set();
  const problems = new Set();
  for (const node of data.nodes) {
    for (const field of REQUIRED_CONTRACT_FIELDS) assert(Object.hasOwn(node, field), `${node.id} missing ${field}`);
    assert.equal(node.supervisor_status, "APPROVED");
    assert.equal(node.enabled, true);
    assert.equal(node.feature_flag.default_enabled, false);
    assert.equal(node.tenant_scope.cross_tenant_allowed, false);
    assert.equal(node.routing.core_open_required, true);
    assert.equal(node.v1_compatibility.breaking_change, false);
    assert.equal(node.v1_compatibility.fallback_to_v1, true);
    assert.equal(node.rollback_reference.kill_switch, "NYRA_DEEP_BRANCH_V2_ENABLED=false");
    assert(!purposes.has(node.purpose.toLowerCase()), `duplicate purpose ${node.id}`);
    assert(!problems.has(node.problem_solved.toLowerCase()), `duplicate problem ${node.id}`);
    purposes.add(node.purpose.toLowerCase());
    problems.add(node.problem_solved.toLowerCase());
    if (node.level === 3 || node.level === 4) assert(nodeIndex.has(node.parent_id), `missing parent ${node.id}`);
  }
  for (const branch of data.branches) {
    for (const subbranch of branch.subbranches) {
      const l2 = data.nodes.filter((node) => node.parent_id === `${branch.id}.${subbranch.id}`);
      assert.equal(l2.length, 1, `${branch.id}.${subbranch.id} L2 cardinality`);
      const l3 = data.nodes.filter((node) => node.parent_id === l2[0].id);
      assert.equal(l3.length, 1, `${l2[0].id} L3 cardinality`);
      const level4 = data.nodes.filter((node) => node.parent_id === l3[0].id);
      assert.deepEqual(level4.map((node) => node.node_type).sort(), ["method", "metric", "strategy", "verifier"]);
    }
  }
});

test("all 5,736 embedded positive, negative, adversarial and regression cases are enforceable", () => {
  const data = catalog();
  const fixtureBundle = JSON.parse(fs.readFileSync(fixtureBundlePath, "utf8"));
  assert.equal(fixtureBundle.catalog_fingerprint, data.catalog_fingerprint);
  assert.equal(fixtureBundle.fixture_count, 1434 * 4);
  const nodeIndex = new Map(data.nodes.map((node) => [node.id, node]));
  let executed = 0;
  for (const node of data.nodes) {
    const groups = [
      ["positive_tests", "ALLOW_ADVISORY"],
      ["negative_tests", "ABSTAIN"],
      ["adversarial_tests", "DENY"],
      ["regression_tests", "ALLOW_ADVISORY"],
    ];
    for (const [field, expectedVerdict] of groups) {
      assert.equal(node[field].length, 1, `${node.id}:${field}`);
      const testCase = node[field][0];
      assert.equal(testCase.expected_core_verdict, expectedVerdict, `${node.id}:${field}:verdict`);
      assert(testCase.assertions.length >= 3, `${node.id}:${field}:assertions`);
      assert(testCase.input_fixture.startsWith("catalog-fixture/"), `${node.id}:${field}:fixture`);
      const fixture = resolveFixture(fixtureBundle, testCase.input_fixture);
      assert(fixture, `${node.id}:${field}:fixture_missing`);
      if (field === "positive_tests") {
        const parentEvaluations = new Map(fixture.verified_parent_ids.map((id) => {
          assert(nodeIndex.has(id), `${node.id}:fixture_parent_missing:${id}`);
          return [id, { state: "advisory_verified" }];
        }));
        const result = evaluateNode({
          node,
          tenantId: fixture.tenant_id,
          subbranchId: fixture.subbranch_id,
          corePayload: fixture.core_payload,
          evidence: fixture.evidence,
          evidenceSource: fixture.evidence_source,
          capabilityInput: fixture.capability_input,
          ...functionContext(node),
          parentEvaluations,
          requestId: testCase.id,
          observedAt: fixture.observed_at,
        });
        assert.equal(result.state, fixture.expected_state, `${node.id}:${field}:state`);
        assert.equal(result.execution_authorized, false);
        assert(result.verifier_results.every((verifier) => verifier.passed));
        assert(result.metric_results.every((metric) => metric.passed));
      } else if (field === "negative_tests") {
        const parentEvaluations = new Map(fixture.verified_parent_ids.map((id) => [id, { state: "advisory_verified" }]));
        const result = evaluateNode({
          node,
          tenantId: fixture.tenant_id,
          subbranchId: fixture.subbranch_id,
          corePayload: fixture.core_payload,
          evidence: fixture.evidence,
          evidenceSource: fixture.evidence_source,
          capabilityInput: fixture.capability_input,
          ...functionContext(node),
          parentEvaluations,
          requestId: testCase.id,
          observedAt: fixture.observed_at,
        });
        assert.equal(result.state, fixture.expected_state, `${node.id}:${field}:state`);
        assert.equal(result.fallback_node, node.fallback_node);
        assert.equal(result.execution_authorized, false);
      } else if (field === "adversarial_tests") {
        const parentEvaluations = new Map(fixture.verified_parent_ids.map((id) => [id, { state: "advisory_verified" }]));
        const result = evaluateNode({
          node,
          tenantId: fixture.tenant_id,
          subbranchId: fixture.subbranch_id,
          corePayload: fixture.core_payload,
          evidence: fixture.evidence,
          evidenceSource: fixture.evidence_source,
          capabilityInput: fixture.capability_input,
          ...functionContext(node),
          parentEvaluations,
          requestId: testCase.id,
          observedAt: fixture.observed_at,
        });
        assert.equal(result.state, fixture.expected_state, `${node.id}:${field}:state`);
        assert.equal(result.execution_authorized, false);
      } else {
        assert.equal(testCase.v1_compatibility, true);
        assert.equal(node.v1_compatibility.v1_parent_preserved, true);
        assert.equal(featureFlags(fixture.feature_flags, fixture.tenant_id).enabled, false);
        assert.equal(fixture.expected_route_state, "disabled_v1_authoritative");
        const refs = fixture.v1_golden_refs;
        const routeGolden = fixtureBundle.v1_goldens[refs.route];
        assert(routeGolden, `${node.id}:v1_route_golden_missing`);
        const opened = routeGolden.output.opened_branches.find((branch) => branch.id === node.branch_id);
        assert(opened, `${node.id}:v1_branch_missing`);
        assert(opened.subbranches.includes(node.id.split(".")[1]), `${node.id}:v1_subbranch_missing`);
        assert.equal(routeGolden.output.execution_authorized, false);
        assert.equal(routeGolden.output_hash, sha256(routeGolden.output));
      }
      executed += 1;
    }
  }
  assert.equal(executed, 1434 * 4);
});

test("V1 rollback goldens execute against the real horizontal runtime and Core branch router", async () => {
  const fixtureBundle = JSON.parse(fs.readFileSync(fixtureBundlePath, "utf8"));
  const { createNyraHorizontalRuntime } = require("../lib/nyra-horizontal-runtime");
  const { nyraBranchCatalog, routeNyraBranches } = await import("../../services/universal-core-service/src/nyraBranchNetwork.js");
  const horizontal = fixtureBundle.v1_goldens.horizontal_runtime;
  const horizontalActual = createNyraHorizontalRuntime({
    NYRA_DEEP_BRANCH_V2_ENABLED: "false",
  }).prepareInterpretation(horizontal.input);
  assert.deepEqual(horizontalActual, horizontal.output);
  assert.equal(sha256(horizontalActual), horizontal.output_hash);
  assert.equal("deep_branch_v2" in horizontalActual.local_interpretation, false);
  const catalogGolden = fixtureBundle.v1_goldens.catalog_skinharmony;
  const catalogActual = nyraBranchCatalog(catalogGolden.input.domain_pack_id);
  assert.deepEqual(catalogActual, catalogGolden.output);
  assert.equal(sha256(catalogActual), catalogGolden.output_hash);
  for (const branchId of Object.keys(expectedBranchCounts)) {
    const golden = fixtureBundle.v1_goldens[`route_${branchId}`];
    const actual = routeNyraBranches(golden.input);
    assert.deepEqual(actual, golden.output, `V1 Core route changed for ${branchId}`);
    assert.equal(sha256(actual), golden.output_hash);
    assert.equal(actual.execution_authorized, false);
  }
});

test("all nodes fail closed under the independent Pass 4 semantic mutation matrix", () => {
  const data = catalog();
  const fixtureBundle = JSON.parse(fs.readFileSync(fixtureBundlePath, "utf8"));
  const supportedOperations = [...new Set(data.nodes.map((node) => node.methods[0].operation))];
  let probes = 0;
  const assertRejected = (node, label, result) => {
    probes += 1;
    assert.notEqual(result.state, "advisory_verified", `${node.id}:${label}`);
    assert.equal(result.execution_authorized, false, `${node.id}:${label}:execution`);
    assert.equal(result.core_final_authority, true, `${node.id}:${label}:authority`);
  };
  for (const node of data.nodes) {
    const fixture = resolveFixture(fixtureBundle, node.positive_tests[0].input_fixture);
    const parents = () => new Map(fixture.verified_parent_ids.map((id) => [id, { state: "advisory_verified" }]));
    const evaluate = (overrides = {}, candidate = node) => evaluateNode({
      node: candidate,
      tenantId: fixture.tenant_id,
      subbranchId: fixture.subbranch_id,
      corePayload: fixture.core_payload,
      evidence: fixture.evidence,
      evidenceSource: fixture.evidence_source,
      capabilityInput: fixture.capability_input,
      ...functionContext(node),
      parentEvaluations: parents(),
      requestId: `mutation_${probes}`,
      observedAt: fixture.observed_at,
      ...overrides,
    });
    const positive = evaluate();
    assert.equal(positive.state, "advisory_verified", `${node.id}:positive`);
    const capabilityResult = Object.values(positive.output).find((value) => value && typeof value === "object" && value.status === "satisfied");
    assert(capabilityResult.finding !== node.purpose, `${node.id}:finding_copies_purpose`);

    assertRejected(node, "missing_input", evaluate({ capabilityInput: null }));

    let input = structuredClone(fixture.capability_input);
    input.subject = `${input.subject} donor`;
    assertRejected(node, "subject_substitution", evaluate({ capabilityInput: input }));

    input = structuredClone(fixture.capability_input);
    input.records[0].semantic_observation.problem_resolution.object = "Irrelevant donor assertion from a different capability";
    assertRejected(node, "record_value_substitution", evaluate({ capabilityInput: input }));

    input = structuredClone(fixture.capability_input);
    input.__forbidden_probe = true;
    assertRejected(node, "additional_property", evaluate({ capabilityInput: input }));

    input = structuredClone(fixture.capability_input);
    input.problem_statement = `${input.problem_statement} changed`;
    assertRejected(node, "input_problem_substitution", evaluate({ capabilityInput: input }));

    let candidate = structuredClone(node);
    candidate.problem_solved = `${candidate.problem_solved} changed`;
    assertRejected(node, "node_problem_substitution", evaluate({}, candidate));

    const contentless = fixture.evidence.map((item) => ({ ...item, content: {} }));
    assertRejected(node, "contentless_evidence", evaluate({ evidence: contentless }));

    const nonsense = structuredClone(fixture.evidence);
    for (const item of nonsense) {
      item.content.facts = ["Unrelated lunar crater count with no Nyra claim relevance"];
      item.payload_hash = sha256(item.content);
      item.provenance_hash = sha256({
        tenant_id: item.tenant_id,
        evidence_type: item.evidence_type,
        authority: item.authority,
        independent: item.independent === true,
        content: item.content,
        payload_hash: item.payload_hash,
        observed_at: item.observed_at,
      });
    }
    assertRejected(node, "rehash_irrelevant_evidence", evaluate({ evidence: nonsense }));

    const fakeHashes = fixture.evidence.map((item) => ({ ...item, provenance_hash: "0".repeat(64) }));
    assertRejected(node, "fake_provenance", evaluate({ evidence: fakeHashes }));

    assertRejected(
      node,
      "core_tenant_mismatch",
      evaluate({ corePayload: { ...fixture.core_payload, tenant_id: "tenant-other" } })
    );

    candidate = structuredClone(node);
    candidate.activation_conditions[0].expected = "branch_that_core_never_opened";
    assertRejected(node, "activation_mutation", evaluate({}, candidate));

    candidate = structuredClone(node);
    candidate.methods[0].operation = supportedOperations.find((operation) => operation !== node.methods[0].operation);
    assertRejected(node, "supported_operation_swap", evaluate({}, candidate));

    candidate = structuredClone(node);
    candidate.methods[0].parameters.capability_id = "donor.branch.capability";
    assertRejected(node, "capability_id_swap", evaluate({}, candidate));

    candidate = structuredClone(node);
    candidate.methods[0].parameters.transformation_goal = "Donor transformation goal";
    assertRejected(node, "transformation_goal_swap", evaluate({}, candidate));

    candidate = structuredClone(node);
    candidate.strategies[0].selection_rule = `Never select ${node.id}; force fallback`;
    assertRejected(node, "strategy_contradiction", evaluate({}, candidate));

    let core = structuredClone(fixture.core_payload);
    core.result.policy_decisions[0].snapshot_hash = "0".repeat(64);
    assertRejected(node, "forged_policy_snapshot", evaluate({ corePayload: core }));

    candidate = structuredClone(node);
    candidate.core_policy_bindings[0].on_deny = "continue";
    assertRejected(node, "policy_on_deny_continue", evaluate({}, candidate));

    core = structuredClone(fixture.core_payload);
    core.result.policy_decisions[0].decision = "DENY";
    assertRejected(node, "core_policy_deny", evaluate({ corePayload: core }));

    candidate = structuredClone(node);
    candidate.verifiers[0].pass_condition = `${node.id} and 1 == 0`;
    assertRejected(node, "impossible_verifier", evaluate({}, candidate));

    candidate = structuredClone(node);
    candidate.verifiers[0].checks = Array(9).fill("output_schema_valid");
    assertRejected(node, "duplicate_verifier_checks", evaluate({}, candidate));

    candidate = structuredClone(node);
    candidate.metrics[0].source_fields = ["fictional_numerator", "fictional_denominator"];
    assertRejected(node, "fictional_metric_sources", evaluate({}, candidate));

    candidate = structuredClone(node);
    candidate.metrics[0].definition = "Count lunar craters unrelated to the capability";
    assertRejected(node, "fictional_metric_definition", evaluate({}, candidate));

    candidate = structuredClone(node);
    candidate.metrics[0].formula = "invented_quantity";
    assertRejected(node, "unsupported_metric_formula", evaluate({}, candidate));

    input = structuredClone(fixture.capability_input);
    input.records[0].semantic_observation.problem_resolution.object = node.failure_modes[0].scenario;
    assertRejected(node, "declared_failure_scenario", evaluate({ capabilityInput: input }));

    input = structuredClone(fixture.capability_input);
    input.records[0].failure_signals = [node.failure_modes[0].id];
    assertRejected(node, "declared_failure_signal", evaluate({ capabilityInput: input }));

    input = structuredClone(fixture.capability_input);
    input.records[0].status = "invalid";
    assertRejected(node, "invalid_record_state", evaluate({ capabilityInput: input }));
  }
  assert.equal(probes, 1434 * 26);
});

test("all nodes reject exact-envelope and coherently rebound Pass 6 mutations", () => {
  const data = catalog();
  const fixtureBundle = JSON.parse(fs.readFileSync(fixtureBundlePath, "utf8"));
  const supportedOperations = [...new Set(data.nodes.map((node) => node.methods[0].operation))];
  let probes = 0;
  const assertRejected = (node, label, result) => {
    probes += 1;
    assert.notEqual(result.state, "advisory_verified", `${node.id}:${label}`);
    assert.equal(result.execution_authorized, false, `${node.id}:${label}:execution`);
    assert.equal(result.core_final_authority, true, `${node.id}:${label}:authority`);
  };
  for (const node of data.nodes) {
    const sourceFixture = resolveFixture(fixtureBundle, node.positive_tests[0].input_fixture);
    assert.equal(evaluateFixture(node, sourceFixture, `${node.id}:baseline`).state, "advisory_verified");

    let fixture = structuredClone(sourceFixture);
    fixture.evidence[0].__forbidden_probe = true;
    assertRejected(node, "extra_evidence_property", evaluateFixture(node, fixture, `${node.id}:extra_evidence`));

    fixture = structuredClone(sourceFixture);
    fixture.evidence[0].content.__forbidden_probe = true;
    fixture.evidence[0].payload_hash = sha256(fixture.evidence[0].content);
    fixture.evidence[0].provenance_hash = evidenceProvenanceHash(fixture.evidence[0]);
    fixture = rebindFixture(node, fixture);
    assertRejected(node, "extra_evidence_content_property", evaluateFixture(node, fixture, `${node.id}:extra_content`));

    fixture = structuredClone(sourceFixture);
    const manifest = fixture.core_payload.result.evidence_manifest;
    manifest.__forbidden_probe = true;
    const manifestPayload = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "manifest_hash"));
    manifest.manifest_hash = sha256(manifestPayload);
    for (const decision of fixture.core_payload.result.policy_decisions) {
      decision.snapshot.evidence_manifest_hash = manifest.manifest_hash;
      decision.snapshot_hash = sha256(decision.snapshot);
    }
    assertRejected(node, "extra_manifest_property", evaluateFixture(node, fixture, `${node.id}:extra_manifest`));

    fixture = structuredClone(sourceFixture);
    fixture.core_payload.result.policy_decisions[0].snapshot.__forbidden_probe = true;
    fixture.core_payload.result.policy_decisions[0].snapshot_hash = sha256(
      fixture.core_payload.result.policy_decisions[0].snapshot
    );
    assertRejected(node, "extra_snapshot_property", evaluateFixture(node, fixture, `${node.id}:extra_snapshot`));

    fixture = structuredClone(sourceFixture);
    fixture.core_payload.result.policy_decisions[0].__forbidden_probe = true;
    assertRejected(node, "extra_policy_decision_property", evaluateFixture(node, fixture, `${node.id}:extra_decision`));

    let candidate = structuredClone(node);
    candidate.required_evidence[0].acceptance_program.require_fact_equal_to_claim = false;
    candidate.required_evidence[0].acceptance_rule = evidenceAcceptanceRule(
      candidate.required_evidence[0].acceptance_program
    );
    rebindSemanticContract(candidate);
    fixture = rebindFixture(candidate, sourceFixture);
    assertRejected(node, "coherent_reject_all_evidence_program", evaluateFixture(candidate, fixture, `${node.id}:evidence_program`));

    candidate = structuredClone(node);
    candidate.strategies[0].predicate_program.all.push("impossible.signal");
    candidate.strategies[0].selection_rule = strategyRule(candidate.strategies[0].predicate_program);
    rebindSemanticContract(candidate);
    fixture = rebindFixture(candidate, sourceFixture);
    assertRejected(node, "coherent_never_select_strategy", evaluateFixture(candidate, fixture, `${node.id}:strategy_program`));

    candidate = structuredClone(node);
    candidate.verifiers[0].predicate_program.all.push("impossible_check");
    candidate.verifiers[0].checks.push("impossible_check");
    candidate.verifiers[0].pass_condition = verifierCondition(candidate.verifiers[0].predicate_program);
    rebindSemanticContract(candidate);
    fixture = rebindFixture(candidate, sourceFixture);
    assertRejected(node, "coherent_impossible_verifier", evaluateFixture(candidate, fixture, `${node.id}:verifier_program`));

    candidate = structuredClone(node);
    candidate.metrics[0].formula = "fictional_numerator/fictional_denominator";
    candidate.metrics[0].source_fields = ["fictional_denominator", "fictional_numerator"];
    candidate.metrics[0].formula_program.formula = candidate.metrics[0].formula;
    candidate.metrics[0].formula_program.source_fields = candidate.metrics[0].source_fields;
    candidate.metrics[0].definition = metricDefinition(candidate.metrics[0].formula_program);
    rebindSemanticContract(candidate);
    fixture = rebindFixture(candidate, sourceFixture);
    assertRejected(node, "coherent_fictional_metric", evaluateFixture(candidate, fixture, `${node.id}:metric_program`));

    candidate = structuredClone(node);
    const replacementOperation = supportedOperations.find((operation) => operation !== node.methods[0].operation);
    candidate.methods[0].operation = replacementOperation;
    candidate.methods[0].program.operation = replacementOperation;
    rebindSemanticContract(candidate);
    fixture = rebindFixture(candidate, sourceFixture);
    assertRejected(node, "coherent_supported_operation_swap", evaluateFixture(candidate, fixture, `${node.id}:operation_swap`));

    fixture = structuredClone(sourceFixture);
    const assertion = fixture.capability_input.records[0].semantic_observation.problem_resolution;
    assertion.object = "Lunar crater trivia unrelated to the registered capability function";
    assertion.key = sha256({
      subject: assertion.subject,
      predicate: assertion.predicate,
      object: assertion.object,
      polarity: assertion.polarity,
    });
    for (const item of fixture.evidence) item.content.facts.push(assertion.object);
    fixture = rebindFixture(node, fixture);
    assertRejected(node, "coherent_irrelevant_record_value", evaluateFixture(node, fixture, `${node.id}:record_value`));
  }
  assert.equal(probes, 1434 * 11);
});

test("function registry rejects donor and malformed semantic observations for every node", () => {
  const data = catalog();
  const fixtureBundle = JSON.parse(fs.readFileSync(fixtureBundlePath, "utf8"));
  const functionIndex = new Map(data.function_registry.functions.map((spec) => [spec.function_id, spec]));
  let probes = 0;
  const reject = (node, label, result) => {
    probes += 1;
    assert.notEqual(result.state, "advisory_verified", `${node.id}:${label}`);
    assert.equal(result.execution_authorized, false, `${node.id}:${label}:execution`);
    assert.equal(result.core_final_authority, true, `${node.id}:${label}:authority`);
  };
  for (const [index, node] of data.nodes.entries()) {
    const donor = data.nodes[(index + 1) % data.nodes.length];
    const fixture = resolveFixture(fixtureBundle, node.positive_tests[0].input_fixture);
    const donorFixture = resolveFixture(fixtureBundle, donor.positive_tests[0].input_fixture);
    assert.equal(evaluateFixture(node, fixture, `${node.id}:registry_baseline`).state, "advisory_verified");

    reject(node, "donor_function_spec", evaluateFixture(node, fixture, `${node.id}:donor_function`, {
      functionSpec: functionIndex.get(donor.id),
    }));

    let mutated = structuredClone(fixture);
    mutated.capability_input.records[0].semantic_observation = structuredClone(
      donorFixture.capability_input.records[0].semantic_observation
    );
    mutated = rebindFixture(node, mutated);
    reject(node, "donor_semantic_observation", evaluateFixture(node, mutated, `${node.id}:donor_observation`));

    mutated = structuredClone(fixture);
    mutated.capability_input.records[0].semantic_observation.evidence_support.pop();
    mutated = rebindFixture(node, mutated);
    reject(node, "missing_evidence_assertion", evaluateFixture(node, mutated, `${node.id}:missing_assertion`));

    mutated = structuredClone(fixture);
    mutated.capability_input.records[0].semantic_observation.problem_resolution.polarity = "negative";
    const problem = mutated.capability_input.records[0].semantic_observation.problem_resolution;
    problem.key = sha256({
      subject: problem.subject,
      predicate: problem.predicate,
      object: problem.object,
      polarity: problem.polarity,
    });
    mutated = rebindFixture(node, mutated);
    reject(node, "flipped_problem_polarity", evaluateFixture(node, mutated, `${node.id}:polarity`));

    mutated = structuredClone(fixture);
    mutated.capability_input.records[0].semantic_observation.boundary_preservation.evidence_ids = ["ev_missing"];
    mutated = rebindFixture(node, mutated);
    reject(node, "boundary_without_evidence_join", evaluateFixture(node, mutated, `${node.id}:boundary_join`));
  }
  assert.equal(probes, 1434 * 5);
});

test("feature gates fail closed for defaults, empty allowlists and foreign tenants", () => {
  assert.equal(featureFlags({}, "codexai").enabled, false);
  assert.equal(featureFlags({
    NYRA_DEEP_BRANCH_V2_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_MODE: "active",
  }, "codexai").enabled, false);
  assert.equal(featureFlags(enabledEnv(), "codexai").enabled, true);
  assert.equal(featureFlags(enabledEnv(), "tenant-other").enabled, false);
  assert.equal(featureFlags(enabledEnv({ NYRA_DEEP_BRANCH_V2_BRANCHES: "" }), "codexai").enabled, false);
});

test("shadow and active routing use only Core-opened and allowlisted branches", () => {
  const shadow = route({
    tenantId: "codexai",
    domainPackId: "skinharmony",
    corePayload: corePayload(["research_evidence", "quality_verification"]),
    requestedBranches: ["research_evidence", "software_intelligence"],
    env: enabledEnv({ NYRA_DEEP_BRANCH_V2_BRANCHES: "research_evidence,software_intelligence" }),
  });
  assert.equal(shadow.state, "shadow_v1_authoritative");
  assert.deepEqual(shadow.selected_branches.map((branch) => branch.id), ["research_evidence"]);
  assert.equal(shadow.execution_authorized, false);
  assert.equal(shadow.core_final_authority, true);

  const active = route({
    tenantId: "codexai",
    domainPackId: "skinharmony",
    corePayload: corePayload(["software_intelligence"]),
    requestedBranches: ["software_intelligence"],
    env: enabledEnv({
      NYRA_DEEP_BRANCH_V2_MODE: "active",
      NYRA_DEEP_BRANCH_V2_BRANCHES: "software_intelligence",
    }),
  });
  assert.equal(active.state, "active_after_core_branch_open");
  assert.deepEqual(active.selected_branches.map((branch) => branch.id), ["software_intelligence"]);
  assert.equal(active.execution_authorized, false);
});

test("missing Core route, denied branch or foreign tenant always falls back to V1", () => {
  const noCore = route({
    tenantId: "codexai",
    domainPackId: "skinharmony",
    corePayload: {},
    requestedBranches: ["research_evidence"],
    env: enabledEnv({ NYRA_DEEP_BRANCH_V2_BRANCHES: "research_evidence" }),
  });
  assert.equal(noCore.state, "core_route_absent_v1_authoritative");
  assert.deepEqual(noCore.selected_branches, []);

  const deniedBranch = route({
    tenantId: "codexai",
    domainPackId: "skinharmony",
    corePayload: corePayload(["software_intelligence"]),
    requestedBranches: ["software_intelligence"],
    env: enabledEnv({ NYRA_DEEP_BRANCH_V2_BRANCHES: "research_evidence" }),
  });
  assert.deepEqual(deniedBranch.selected_branches, []);

  const foreign = route({
    tenantId: "tenant-other",
    domainPackId: "skinharmony",
    corePayload: corePayload(["research_evidence"]),
    requestedBranches: ["research_evidence"],
    env: enabledEnv({ NYRA_DEEP_BRANCH_V2_BRANCHES: "research_evidence" }),
  });
  assert.equal(foreign.state, "disabled_v1_authoritative");
  assert.equal(foreign.execution_authorized, false);
});

test("tampering rejects the catalog atomically and routes through V1", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-tamper-"));
  const tamperedPath = path.join(tempRoot, "catalog.json");
  const data = catalog();
  data.nodes[0].purpose = `${data.nodes[0].purpose} tampered`;
  fs.writeFileSync(tamperedPath, serializeCatalog(data), "utf8");
  const loaded = loadCatalog({ catalogPath: tamperedPath, forceReload: true });
  assert.equal(loaded.ok, false);
  assert(loaded.validation.errors.includes("catalog_fingerprint_mismatch"));
  assert.equal(loaded.catalog, null);
  const routed = route({
    tenantId: "codexai",
    domainPackId: "skinharmony",
    corePayload: corePayload(["context_intelligence"]),
    requestedBranches: ["context_intelligence"],
    env: enabledEnv({ NYRA_DEEP_BRANCH_V2_BRANCHES: "context_intelligence" }),
    catalogPath: tamperedPath,
  });
  assert.equal(routed.state, "catalog_rejected_v1_authoritative");
  assert.deepEqual(routed.selected_branches, []);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("full catalog validation and deep route stay within the benchmark budget", () => {
  const started = performance.now();
  const loaded = loadCatalog({ forceReload: true });
  const validationMs = performance.now() - started;
  assert.equal(loaded.ok, true);
  const routeStarted = performance.now();
  const routed = route({
    tenantId: "codexai",
    domainPackId: "skinharmony",
    corePayload: corePayload(Object.keys(expectedBranchCounts)),
    requestedBranches: Object.keys(expectedBranchCounts),
    env: enabledEnv(),
  });
  const routeMs = performance.now() - routeStarted;
  assert.equal(routed.selected_branches.length, 18);
  assert(validationMs < 5000, `catalog validation took ${validationMs.toFixed(2)}ms`);
  assert(routeMs < 2000, `deep routing took ${routeMs.toFixed(2)}ms`);
});

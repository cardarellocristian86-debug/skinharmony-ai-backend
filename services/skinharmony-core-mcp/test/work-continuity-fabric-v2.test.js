import assert from "node:assert/strict";
import test from "node:test";
import {
  WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
  buildIntentAnchor,
  buildNativeAgentPlan,
  digest,
  evaluateNativeClosure,
  incidentFingerprint,
  normalizeSurfaces,
  selectAggregatedAtlasWithinBudget,
  surfacesOverlap,
} from "../src/work-continuity-runtime.js";

const COMMIT = "c".repeat(40);
const COORDINATOR_SESSION = "a".repeat(64);

function nativePlan() {
  return buildNativeAgentPlan({
    host_type: "codex_native",
    required_checks: ["core-mcp", "universal-core"],
    max_parallel: 99,
    tasks: [
      {
        task_id: "build",
        kind: "builder",
        instruction: "Implement the bounded continuity change.",
      },
      {
        task_id: "verify",
        kind: "verifier",
        instruction: "Independently verify the bounded change.",
        dependencies: ["build"],
      },
    ],
  });
}

function closurePlan() {
  const intent = buildIntentAnchor({
    project_id: "skinharmony",
    session_id: "continuity-v2-contract",
    initial_message: "Continue this bounded work until independently verified.",
    idea: "Durable tenant work continuity",
    objective: "Close only with native evidence and exact checks.",
    acceptance_criteria: ["The bounded test suite passes."],
    constraints: ["Use native ChatGPT/Codex specialists only."],
    host_type: "codex_native",
  });
  const plan = nativePlan();
  const criteria = [
    { criterion_id: "objective", text: intent.anchor.objective },
    { criterion_id: "acceptance_1", text: intent.anchor.acceptance_criteria[0] },
    { criterion_id: "constraint_1", text: intent.anchor.constraints[0] },
  ].map((criterion) => ({
    ...criterion,
    criterion_digest: digest({
      schema_version: "intent_acceptance_criterion_v1",
      intent_digest: intent.intent_digest,
      criterion_id: criterion.criterion_id,
      criterion_kind: criterion.criterion_id === "objective"
        ? "objective"
        : criterion.criterion_id.startsWith("acceptance") ? "acceptance" : "constraint",
      text: criterion.text,
    }),
  }));
  return {
    ...plan,
    acceptance_contract: {
      schema_version: "intent_acceptance_contract_v1",
      intent_digest: intent.intent_digest,
      criteria,
      criteria_digest: digest(criteria),
      evidence_required: true,
      independent_verifier_required: true,
    },
  };
}

function completedAgents(plan) {
  const criterionEvidence = plan.acceptance_contract.criteria.map((criterion) => ({
    criterion_digest: criterion.criterion_digest,
    passed: true,
    evidence_refs: [`evidence:${criterion.criterion_id}`],
  }));
  return [
    {
      task_id: "build",
      agent_id: "codex-builder",
      status: "completed",
      report_digest: "1".repeat(64),
      coordinator_session_fingerprint: COORDINATOR_SESSION,
      native_session_fingerprint: "b".repeat(64),
      native_presence_signature: `ags_${"b".repeat(32)}`,
      report: {
        summary: "Bounded implementation complete.",
        commit_sha: COMMIT,
        tests: [{ name: "node --test bounded", passed: true }],
        evidence_refs: ["commit:bounded"],
      },
    },
    {
      task_id: "verify",
      agent_id: "codex-verifier",
      status: "completed",
      report_digest: "2".repeat(64),
      coordinator_session_fingerprint: COORDINATOR_SESSION,
      native_session_fingerprint: "d".repeat(64),
      native_presence_signature: `ags_${"d".repeat(32)}`,
      report: {
        summary: "Independent verification approved.",
        verdict: "approved",
        commit_sha: COMMIT,
        verifies_task_ids: ["build"],
        tests: [{ name: "node --test independent", passed: true }],
        evidence_refs: ["review:independent"],
        acceptance_evidence: criterionEvidence,
      },
    },
  ];
}

test("Intent Anchor is deterministic, immutable-shaped and redacts sensitive request fragments", () => {
  const input = {
    project_id: "skinharmony",
    session_id: "anchor-contract",
    initial_message: "Complete the governed change; token=do-not-store.",
    idea: "Persistent native work",
    objective: "Resume without re-reading the entire repository.",
    acceptance_criteria: ["Independent verifier approves."],
    constraints: ["No raw credentials in memory."],
    host_type: "codex_native",
  };
  const first = buildIntentAnchor(input);
  const second = buildIntentAnchor({ ...input });

  assert.equal(first.anchor.schema_version, "intent_anchor_v1");
  assert.equal(first.anchor.immutable, true);
  assert.equal(first.anchor.source.client_type, "codex_native");
  assert.equal(first.intent_digest, second.intent_digest);
  assert.equal(first.create_request_digest, second.create_request_digest);
  assert.match(first.anchor.initial_message, /\[REDACTED\]/);
  assert.doesNotMatch(first.anchor.initial_message, /do-not-store/);
  assert.match(first.intent_digest, /^[a-f0-9]{64}$/);
});

test("native plan is host-only, bounded and rejects provider-shaped or unsafe topology", () => {
  const plan = nativePlan();

  assert.equal(plan.schema_version, "native_agent_plan_v1");
  assert.equal(plan.execution_mode, "host_native_only");
  assert.equal(plan.provider_execution, false);
  assert.equal(plan.provider_api_key_required, false);
  assert.equal(plan.release_mode, "external_ticket_required");
  assert.equal(plan.max_agents, 2);
  assert.equal(plan.max_parallel, 2);
  assert.deepEqual(plan.required_checks, ["core-mcp", "universal-core"]);
  assert.deepEqual(plan.tasks.find((task) => task.task_id === "verify").dependencies, ["build"]);

  assert.throws(() => buildNativeAgentPlan({
    host_type: "codex_native",
    required_checks: ["core-mcp"],
    tasks: [{ task_id: "build", kind: "builder", instruction: "Build." }],
  }), /native_agent_verifier_task_required/);
  assert.throws(() => buildNativeAgentPlan({
    host_type: "codex_native",
    required_checks: ["core-mcp"],
    provider_credential: "forbidden-shape",
    tasks: [
      { task_id: "build", kind: "builder", instruction: "Build." },
      { task_id: "verify", kind: "verifier", instruction: "Verify.", dependencies: ["build"] },
    ],
  }), /native_agent_provider_credential_forbidden/);
  assert.throws(() => buildNativeAgentPlan({
    host_type: "codex_native",
    required_checks: ["core-mcp"],
    tasks: ["one", "two", "three", "four"].map((taskId) => ({
      task_id: taskId,
      kind: taskId === "two" ? "verifier" : "researcher",
      instruction: `Bounded ${taskId}.`,
      dependencies: taskId === "two" ? ["one"] : [],
    })),
  }), /native_agent_task_count_invalid/);
});

test("closure requires independent, transport-attested builder and verifier evidence", () => {
  const plan = closurePlan();
  const agents = completedAgents(plan);
  const evaluation = evaluateNativeClosure({ plan, agents });

  assert.equal(evaluation.schema_version, "native_closure_evaluation_v1");
  assert.equal(evaluation.closed, true);
  assert.equal(evaluation.independent_verifier_count, 1);
  assert.equal(evaluation.target_commit, COMMIT);
  assert.deepEqual(evaluation.required_checks, ["core-mcp", "universal-core"]);
  assert.equal(
    evaluation.acceptance_criteria_proven,
    plan.acceptance_contract.criteria.length,
  );

  const reusedSession = structuredClone(agents);
  reusedSession[1].native_session_fingerprint = reusedSession[0].native_session_fingerprint;
  const blocked = evaluateNativeClosure({ plan, agents: reusedSession });
  assert.equal(blocked.closed, false);
  assert.ok(blocked.missing.includes("independent_verifier_missing"));
  assert.ok(blocked.missing.includes("native_agent_session_reused"));
  assert.ok(blocked.missing.includes("verification_coverage_missing:build"));
});

test("aggregate Atlas preserves cross-work provenance and stays inside the bounded change cone", () => {
  const atlas = selectAggregatedAtlasWithinBudget([
    {
      node_id: "router",
      node_kind: "file",
      path: "services/core/router.js",
      summary: "Routes the host-native continuity tools.",
      node_digest: "3".repeat(64),
      context_bytes: 120,
      depth: 0,
      source_work_ids: ["work-a", "work-b"],
    },
    {
      node_id: "verifier",
      node_kind: "test",
      path: "services/core/test/router.test.js",
      summary: "Independent regression coverage.",
      node_digest: "4".repeat(64),
      context_bytes: 120,
      depth: 1,
      source_work_ids: ["work-b"],
    },
  ], [
    {
      from_node_id: "router",
      to_node_id: "verifier",
      edge_type: "covered_by",
      source_work_ids: ["work-a"],
    },
    {
      from_node_id: "router",
      to_node_id: "verifier",
      edge_type: "covered_by",
      source_work_ids: ["work-b"],
    },
  ], { max_bytes: 3_000, total_context_bytes: 4_000 });

  assert.equal(atlas.schema_version, "work_atlas_context_v1");
  assert.equal(atlas.metrics.full_scan_performed, false);
  assert.deepEqual(atlas.nodes.map((node) => node.node_id), ["router", "verifier"]);
  assert.deepEqual(atlas.nodes[0].source_work_ids, ["work-a", "work-b"]);
  assert.deepEqual(atlas.edges, [{
    from_node_id: "router",
    to_node_id: "verifier",
    edge_type: "covered_by",
    source_work_ids: ["work-a", "work-b"],
  }]);
  assert.ok(atlas.metrics.selected_context_bytes <= atlas.metrics.max_context_bytes);
  assert.ok(atlas.metrics.avoided_context_bytes > 0);
});

test("lease and incident identifiers are normalized and deterministic per tenant-safe scope", () => {
  const surfaces = normalizeSurfaces([
    { kind: "file", value: "./services/core/router.js" },
    { kind: "file", value: "services/core/router.js" },
    { kind: "component", value: "host-native-governance" },
  ]);
  assert.deepEqual(surfaces, [
    { kind: "component", value: "host-native-governance" },
    { kind: "file", value: "services/core/router.js" },
  ]);
  assert.equal(
    surfacesOverlap(
      { kind: "file", value: "services/core" },
      { kind: "file", value: "services/core/router.js" },
    ),
    true,
  );

  const input = {
    error_code: "trusted_readback_checks_not_ready",
    repository: "owner/repo",
    branch: "main",
    connector: "github",
    deployment_path: "render",
    configuration_digest: "5".repeat(64),
  };
  const first = incidentFingerprint(input);
  const second = incidentFingerprint({ ...input, error_code: input.error_code.toUpperCase() });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.scope.error_code, "TRUSTED_READBACK_CHECKS_NOT_READY");
  assert.equal(WORK_CONTINUITY_FABRIC_SCHEMA_VERSION, "work_continuity_fabric_v2");
});

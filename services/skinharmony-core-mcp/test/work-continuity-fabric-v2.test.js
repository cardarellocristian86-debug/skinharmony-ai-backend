import assert from "node:assert/strict";
import test from "node:test";
import {
  WORK_CONTINUITY_FABRIC_SCHEMA_VERSION,
  buildAcceptanceContract,
  buildIntentAnchor,
  buildNativeAgentPlan,
  buildNativeV2TaskBinding,
  buildPrecommitAcceptancePolicy,
  digest,
  evaluateNativeClosure,
  evaluateTaskScopedNativeVerifierEvidence,
  incidentFingerprint,
  normalizeSurfaces,
  selectAggregatedAtlasWithinBudget,
  surfacesOverlap,
} from "../src/work-continuity-runtime.js";
import { WORK_CONTINUITY_TOOLS } from "../src/work-continuity-tools.js";

const COMMIT = "c".repeat(40);
const COORDINATOR_SESSION = "a".repeat(64);

function boundedUniqueText(prefix, index, length) {
  const marker = `${prefix}-${String(index).padStart(3, "0")}-`;
  return `${marker}${"x".repeat(length - marker.length)}`;
}

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
    criterion_kind: criterion.criterion_id === "objective"
      ? "objective"
      : criterion.criterion_id.startsWith("acceptance") ? "acceptance" : "constraint",
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
  const acceptanceContract = {
    schema_version: "intent_acceptance_contract_v1",
    intent_digest: intent.intent_digest,
    criteria,
    criteria_digest: digest(criteria),
    evidence_required: true,
    independent_verifier_required: true,
  };
  return {
    ...plan,
    acceptance_contract: acceptanceContract,
    precommit_acceptance_policy: buildPrecommitAcceptancePolicy(acceptanceContract),
  };
}

function futureReleasePlan() {
  const intent = buildIntentAnchor({
    project_id: "skinharmony",
    session_id: "continuity-v2-future-release",
    initial_message: "Prepare the bounded change, then merge and deploy through separate tickets.",
    idea: "Deadlock-free ticketed release",
    objective: "Create an independently verified local commit before downstream release effects.",
    acceptance_criteria: [
      "The pull request is merged after required checks pass.",
      "The Render deployment is healthy at the released commit.",
    ],
    constraints: ["Do not weaken safety, authorized scope, or test gates."],
    host_type: "codex_native",
  });
  const plan = nativePlan();
  const acceptanceContract = buildAcceptanceContract(intent.anchor, intent.intent_digest);
  return {
    ...plan,
    closure_requirements: {
      ...plan.closure_requirements,
      live_verification_required: true,
    },
    acceptance_contract: acceptanceContract,
    precommit_acceptance_policy: buildPrecommitAcceptancePolicy(acceptanceContract),
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

function precommitAgents(plan) {
  const agents = completedAgents(plan);
  const evidence = {
    schema_version: "native_precommit_evidence_v1",
    diff_mode: "git_diff_binary_sha256_v1",
    base_commit: "a".repeat(40),
    diff_digest: "b".repeat(64),
    changed_files: ["services/core.js", "test/core.test.js"],
  };
  evidence.workspace_digest = digest(evidence);
  for (const agent of agents) {
    agent.report.commit_sha = null;
    agent.report.precommit_evidence = structuredClone(evidence);
  }
  return agents;
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

test("owner-recorded architecture amendments replace only exact stale acceptance criteria", () => {
  const intent = buildIntentAnchor({
    project_id: "skinharmony",
    session_id: "acceptance-amendment",
    initial_message: "Apply the bounded owner-confirmed correction.",
    idea: "Governed acceptance evolution",
    objective: "Preserve the original objective.",
    acceptance_criteria: ["Limit the diff to the original three files."],
    constraints: ["Do not push or deploy without an exact Core ticket."],
    host_type: "codex_native",
  });
  const base = buildAcceptanceContract(intent.anchor, intent.intent_digest);
  const stale = base.criteria.find((criterion) => criterion.criterion_id === "acceptance_1");
  const amendment = {
    schema_version: "intent_acceptance_contract_amendment_v1",
    base_criteria_digest: base.criteria_digest,
    reason: "The owner explicitly authorized the bounded continuity correction.",
    superseded_criteria: [{
      criterion_id: stale.criterion_id,
      criterion_digest: stale.criterion_digest,
      reason: "The original file list no longer covers the authorized continuity defect.",
    }],
    replacement_criteria: [{
      criterion_id: "acceptance_authorized_scope",
      criterion_kind: "acceptance",
      text: "The exact owner-recorded change cone passes its bounded regression suite.",
    }],
  };
  const architecture = {
    components: [],
    acceptance_contract_amendment: amendment,
  };
  const contract = buildAcceptanceContract(intent.anchor, intent.intent_digest, {
    architecture_version: 5,
    architecture,
    architecture_digest: digest(architecture),
  });

  assert.equal(contract.schema_version, "intent_acceptance_contract_v2");
  assert.equal(contract.architecture_version, 5);
  assert.equal(contract.base_criteria_digest, base.criteria_digest);
  assert.deepEqual(contract.criteria.map((criterion) => criterion.criterion_id), [
    "objective", "constraint_1", "acceptance_authorized_scope",
  ]);
  assert.equal(contract.criteria.some((criterion) => criterion.criterion_id === "acceptance_1"), false);

  const plan = { ...closurePlan(), acceptance_contract: contract };
  const accepted = evaluateNativeClosure({ plan, agents: completedAgents(plan) });
  assert.equal(accepted.closed, true);
  const tamperedPlan = structuredClone(plan);
  tamperedPlan.acceptance_contract.amendment.reason = "Caller-shaped authority";
  const tampered = evaluateNativeClosure({
    plan: tamperedPlan,
    agents: completedAgents(tamperedPlan),
  });
  assert.equal(tampered.closed, false);
  assert.ok(tampered.missing.includes("intent_acceptance_contract_invalid"));
  assert.equal(tampered.acceptance_criteria_count, 0);
  assert.equal(tampered.acceptance_criteria_proven, 0);
  assert.deepEqual(tampered.acceptance_proofs, []);

  assert.throws(() => buildAcceptanceContract(intent.anchor, intent.intent_digest, {
    architecture_version: 5,
    architecture: {
      ...architecture,
      acceptance_contract_amendment: { ...amendment, base_criteria_digest: "0".repeat(64) },
    },
    architecture_digest: digest({
      ...architecture,
      acceptance_contract_amendment: { ...amendment, base_criteria_digest: "0".repeat(64) },
    }),
  }), /intent_acceptance_amendment_base_mismatch/);
  const objective = base.criteria.find((criterion) => criterion.criterion_id === "objective");
  const objectiveAmendment = {
    ...amendment,
    superseded_criteria: [{
      criterion_id: objective.criterion_id,
      criterion_digest: objective.criterion_digest,
      reason: "Must remain forbidden.",
    }],
  };
  const objectiveArchitecture = {
    ...architecture,
    acceptance_contract_amendment: objectiveAmendment,
  };
  assert.throws(() => buildAcceptanceContract(intent.anchor, intent.intent_digest, {
    architecture_version: 5,
    architecture: objectiveArchitecture,
    architecture_digest: digest(objectiveArchitecture),
  }), /intent_acceptance_amendment_superseded_invalid/);
  const authorityShapedArchitecture = {
    ...architecture,
    acceptance_contract_amendment: { ...amendment, owner_authorized: true },
  };
  assert.throws(() => buildAcceptanceContract(intent.anchor, intent.intent_digest, {
    architecture_version: 5,
    architecture: authorityShapedArchitecture,
    architecture_digest: digest(authorityShapedArchitecture),
  }), /intent_acceptance_amendment_invalid/);
});

test("bootstrap text limits are equivalent across direct V2, legacy Intent Anchor and Nyra contracts", () => {
  const direct = WORK_CONTINUITY_TOOLS.find((tool) => tool.name === "work_continuity_v2_create");
  const legacy = WORK_CONTINUITY_TOOLS.find((tool) => tool.name === "work_continuity_start_or_resume");
  assert.equal(direct.inputSchema.additionalProperties, false);
  assert.deepEqual(direct.inputSchema.properties.acceptance_criteria, {
    type: "array",
    minItems: 1,
    maxItems: 250,
    items: { type: "string", minLength: 1, maxLength: 2_000 },
  });
  assert.deepEqual(direct.inputSchema.properties.constraints, {
    type: "array",
    maxItems: 100,
    items: { type: "string", minLength: 1, maxLength: 1_000 },
  });
  assert.equal(legacy.inputSchema.properties.acceptance_criteria.maxItems,
    direct.inputSchema.properties.acceptance_criteria.maxItems);
  assert.equal(legacy.inputSchema.properties.acceptance_criteria.items.maxLength,
    direct.inputSchema.properties.acceptance_criteria.items.maxLength);
  assert.equal(legacy.inputSchema.properties.constraints.maxItems,
    direct.inputSchema.properties.constraints.maxItems);
  assert.equal(legacy.inputSchema.properties.constraints.items.maxLength,
    direct.inputSchema.properties.constraints.items.maxLength);
});

test("legacy Intent Anchor accepts exact bootstrap boundaries and rejects every overflow", () => {
  const base = {
    project_id: "skinharmony",
    session_id: "anchor-bootstrap-boundary",
    initial_message: "Preserve the exact canonical Work.",
    idea: "Bounded Work bootstrap",
    objective: "Keep every bootstrap representation equivalent.",
    acceptance_criteria: Array.from({ length: 250 }, (_, index) =>
      boundedUniqueText("acceptance", index, 2_000)),
    constraints: Array.from({ length: 100 }, (_, index) =>
      boundedUniqueText("constraint", index, 1_000)),
    host_type: "codex_native",
  };
  const boundary = buildIntentAnchor(base);
  assert.equal(boundary.anchor.acceptance_criteria.length, 250);
  assert.equal(boundary.anchor.acceptance_criteria.at(-1).length, 2_000);
  assert.equal(boundary.anchor.constraints.length, 100);
  assert.equal(boundary.anchor.constraints.at(-1).length, 1_000);

  const negativeCases = [
    [{ ...base, acceptance_criteria: [...base.acceptance_criteria, "overflow"] }, /acceptance_criteria_invalid/],
    [{ ...base, acceptance_criteria: ["x".repeat(2_001)] }, /acceptance_criteria_invalid/],
    [{ ...base, constraints: [...base.constraints, "overflow"] }, /constraints_invalid/],
    [{ ...base, constraints: ["x".repeat(1_001)] }, /constraints_invalid/],
  ];
  for (const [input, expected] of negativeCases) {
    assert.throws(() => buildIntentAnchor(input), expected);
  }
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

test("matching precommit evidence becomes commit-ticket ready without closing release", () => {
  const plan = closurePlan();
  const agents = precommitAgents(plan);
  const evaluation = evaluateNativeClosure({ plan, agents });

  assert.equal(evaluation.closed, false);
  assert.equal(evaluation.commit_ticket_ready, true);
  assert.equal(evaluation.execution_authorized, false);
  assert.equal(evaluation.target_commit, null);
  assert.equal(evaluation.precommit_verification.ready, true);
  assert.match(evaluation.precommit_verification.workspace_digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(evaluation.missing.sort(), [
    "builder_target_commit_missing",
    "verifier_reviewed_commit_missing:codex-verifier",
  ]);

  agents[1].report.precommit_evidence.diff_digest = "c".repeat(64);
  agents[1].report.precommit_evidence.workspace_digest = digest({
    ...agents[1].report.precommit_evidence,
    workspace_digest: undefined,
  });
  const mismatched = evaluateNativeClosure({ plan, agents });
  assert.equal(mismatched.commit_ticket_ready, false);
  assert.ok(mismatched.missing.includes(
    "verifier_precommit_evidence_mismatch:codex-verifier"));
});

test("precommit ticket defers future release proof but preserves every explicit safety gate", () => {
  const plan = futureReleasePlan();
  const agents = precommitAgents(plan);
  const deferredCriteria = plan.acceptance_contract.criteria
    .filter((criterion) => ["objective", "acceptance"].includes(criterion.criterion_kind));
  const safetyCriterion = plan.acceptance_contract.criteria
    .find((criterion) => criterion.criterion_kind === "constraint");
  agents[1].report.acceptance_evidence = plan.acceptance_contract.criteria
    .filter((criterion) => criterion.criterion_kind === "constraint")
    .map((criterion) => ({
      criterion_digest: criterion.criterion_digest,
      passed: true,
      evidence_refs: [`precommit:${criterion.criterion_id}`],
    }));

  const ready = evaluateNativeClosure({ plan, agents });
  assert.equal(ready.commit_ticket_ready, true);
  assert.equal(ready.precommit_verification.ready, true);
  assert.equal(ready.precommit_verification.acceptance_policy_valid, true);
  assert.equal(ready.closed, false);
  assert.ok(ready.missing.includes("live_verification_missing"));
  for (const criterion of deferredCriteria) {
    assert.ok(ready.missing.includes(`acceptance_evidence_missing:${criterion.criterion_id}`));
  }

  const fullyProvenAgents = precommitAgents(plan);
  fullyProvenAgents[1].report.live_verified = true;
  const missingPolicyPlan = structuredClone(plan);
  delete missingPolicyPlan.precommit_acceptance_policy;
  const legacyStrictReady = evaluateNativeClosure({
    plan: missingPolicyPlan,
    agents: fullyProvenAgents,
  });
  assert.equal(legacyStrictReady.commit_ticket_ready, true);
  assert.equal(legacyStrictReady.precommit_verification.acceptance_policy_mode, "legacy_strict");
  assert.equal(legacyStrictReady.precommit_verification.acceptance_policy_valid, null);

  const legacyStrictIncomplete = evaluateNativeClosure({
    plan: missingPolicyPlan,
    agents,
  });
  assert.equal(legacyStrictIncomplete.commit_ticket_ready, false);
  assert.ok(legacyStrictIncomplete.missing.includes("live_verification_missing"));

  const tamperedPolicyPlan = structuredClone(plan);
  tamperedPolicyPlan.precommit_acceptance_policy.deferred_criterion_digests.pop();
  const tamperedPolicy = evaluateNativeClosure({
    plan: tamperedPolicyPlan,
    agents: fullyProvenAgents,
  });
  assert.equal(tamperedPolicy.commit_ticket_ready, false);
  assert.equal(tamperedPolicy.precommit_verification.acceptance_policy_mode, "invalid");
  assert.equal(tamperedPolicy.precommit_verification.acceptance_policy_valid, false);

  const missingConstraint = structuredClone(agents);
  missingConstraint[1].report.acceptance_evidence = [{
    criterion_digest: deferredCriteria[0].criterion_digest,
    passed: true,
    evidence_refs: ["precommit:objective"],
  }];
  const constraintBlocked = evaluateNativeClosure({ plan, agents: missingConstraint });
  assert.equal(constraintBlocked.commit_ticket_ready, false);
  assert.ok(constraintBlocked.missing.includes(
    `acceptance_evidence_missing:${safetyCriterion.criterion_id}`));

  const explicitDissent = structuredClone(agents);
  explicitDissent[1].report.acceptance_evidence
    .find((item) => item.criterion_digest === safetyCriterion.criterion_digest)
    .passed = false;
  const dissentBlocked = evaluateNativeClosure({ plan, agents: explicitDissent });
  assert.equal(dissentBlocked.commit_ticket_ready, false);
  assert.ok(dissentBlocked.missing.includes(`acceptance_dissent:${safetyCriterion.criterion_id}`));

  const failingTest = structuredClone(agents);
  failingTest[0].report.tests[0].passed = false;
  const testBlocked = evaluateNativeClosure({ plan, agents: failingTest });
  assert.equal(testBlocked.commit_ticket_ready, false);
  assert.ok(testBlocked.missing.includes("test_failure_present"));

  const mismatchedDiff = structuredClone(agents);
  mismatchedDiff[1].report.precommit_evidence.diff_digest = "e".repeat(64);
  const verifierEvidence = { ...mismatchedDiff[1].report.precommit_evidence };
  delete verifierEvidence.workspace_digest;
  mismatchedDiff[1].report.precommit_evidence.workspace_digest = digest(verifierEvidence);
  const mismatchBlocked = evaluateNativeClosure({ plan, agents: mismatchedDiff });
  assert.equal(mismatchBlocked.commit_ticket_ready, false);
  assert.ok(mismatchBlocked.missing.includes(
    "verifier_precommit_evidence_mismatch:codex-verifier"));

  const reusedIdentity = structuredClone(agents);
  reusedIdentity[1].native_session_fingerprint = reusedIdentity[0].native_session_fingerprint;
  const independenceBlocked = evaluateNativeClosure({ plan, agents: reusedIdentity });
  assert.equal(independenceBlocked.commit_ticket_ready, false);
  assert.ok(independenceBlocked.missing.includes("independent_verifier_missing"));
  assert.ok(independenceBlocked.missing.includes("native_agent_session_reused"));

  const rejectedVerdict = structuredClone(agents);
  rejectedVerdict[1].report.verdict = "rejected";
  const verdictBlocked = evaluateNativeClosure({ plan, agents: rejectedVerdict });
  assert.equal(verdictBlocked.commit_ticket_ready, false);
  assert.ok(verdictBlocked.missing.includes("verifier_not_approved:codex-verifier"));

  const missingCoverage = structuredClone(agents);
  missingCoverage[1].report.verifies_task_ids = [];
  const coverageBlocked = evaluateNativeClosure({ plan, agents: missingCoverage });
  assert.equal(coverageBlocked.commit_ticket_ready, false);
  assert.ok(coverageBlocked.missing.includes("verification_coverage_missing:build"));
});

test("V2 task bindings canonicalize UUIDs and hash exact persisted titles without leaking them", () => {
  const input = {
    tenant_id: "tenant-a",
    work_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    task_id: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
    weight: 1,
    required: true,
  };
  const alpha = buildNativeV2TaskBinding({
    ...input,
    title: "Deploy token=alpha-secret-value-111",
  });
  const beta = buildNativeV2TaskBinding({
    ...input,
    title: "Deploy token=beta-secret-value-222",
  });
  assert.equal(alpha.work_id, input.work_id.toLowerCase());
  assert.equal(alpha.task_id, input.task_id.toLowerCase());
  assert.notEqual(alpha.title_digest, beta.title_digest);
  assert.notEqual(alpha.v2_task_digest, beta.v2_task_digest);
  assert.equal(alpha.title_preview, beta.title_preview);
  assert.match(alpha.title_preview, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(alpha), /alpha-secret-value-111/);
});

test("task-scoped verifier evidence promotes one V2 task without closing incomplete Work criteria", () => {
  const plan = closurePlan();
  const v2TaskId = "11111111-1111-4111-8111-111111111111";
  const agents = completedAgents(plan).map((agent) => ({ ...agent, v2_task_id: v2TaskId }));
  agents[1].report = {
    ...agents[1].report,
    // This is enough for the bound V2 task, but leaves unrelated Work-wide
    // criteria for the separate closure evaluator.
    acceptance_evidence: [agents[1].report.acceptance_evidence[0]],
  };

  const taskScoped = evaluateTaskScopedNativeVerifierEvidence({
    plan,
    agents,
    verifier_task_id: "verify",
  });
  assert.equal(taskScoped.promotable, true);
  assert.equal(taskScoped.v2_task_id, v2TaskId);
  assert.deepEqual(taskScoped.builder_task_ids, ["build"]);

  const fullClosure = evaluateNativeClosure({ plan, agents });
  assert.equal(fullClosure.closed, false);
  assert.ok(fullClosure.missing.some((item) => item.startsWith("acceptance_evidence_missing:")));
});

test("task-scoped verifier evidence rejects missing coverage, tests, evidence and bound identity", () => {
  const plan = closurePlan();
  const v2TaskId = "11111111-1111-4111-8111-111111111111";
  const agents = completedAgents(plan).map((agent) => ({ ...agent, v2_task_id: v2TaskId }));
  const cases = [
    ["missing builder", () => agents.slice(1), "task_scoped_builder_missing"],
    ["missing coverage", () => {
      const value = structuredClone(agents);
      value[1].report.verifies_task_ids = [];
      return value;
    }, "task_scoped_verifier_scope_invalid"],
    ["failing test", () => {
      const value = structuredClone(agents);
      value[0].report.tests = [{ name: "target", passed: false }];
      return value;
    }, "task_scoped_test_failure_present:build"],
    ["missing verifier evidence", () => {
      const value = structuredClone(agents);
      value[1].report.evidence_refs = [];
      value[1].report.acceptance_evidence = [];
      return value;
    }, "task_scoped_verifier_evidence_missing"],
    ["cross task binding", () => {
      const value = structuredClone(agents);
      value[0].v2_task_id = "22222222-2222-4222-8222-222222222222";
      return value;
    }, "task_scoped_builder_missing"],
    ["reused session", () => {
      const value = structuredClone(agents);
      value[1].native_session_fingerprint = value[0].native_session_fingerprint;
      return value;
    }, "task_scoped_session_reused"],
  ];
  for (const [label, createAgents, expectedMissing] of cases) {
    const evaluation = evaluateTaskScopedNativeVerifierEvidence({
      plan,
      agents: createAgents(),
      verifier_task_id: "verify",
    });
    assert.equal(evaluation.promotable, false, label);
    assert.ok(evaluation.missing.includes(expectedMissing), label);
  }
});

test("task-scoped verifier rejects a peer bound to a different V2 task definition", () => {
  const plan = closurePlan();
  const peerPlan = structuredClone(plan);
  peerPlan.tasks.push({
    task_id: "verify-peer",
    kind: "verifier",
    instruction: "Independently verify the same bound V2 task.",
    dependencies: ["build"],
    task_digest: "6".repeat(64),
  });
  const v2TaskId = "22222222-2222-4222-8222-222222222222";
  const agents = completedAgents(plan).map((agent) => ({
    ...agent,
    v2_task_id: v2TaskId,
    v2_task_digest: "4".repeat(64),
  }));
  const peer = structuredClone(agents[1]);
  peer.task_id = "verify-peer";
  peer.agent_id = "codex-peer-verifier";
  peer.native_session_fingerprint = "e".repeat(64);
  peer.native_presence_signature = `ags_${"e".repeat(32)}`;
  peer.v2_task_digest = "5".repeat(64);
  const evaluation = evaluateTaskScopedNativeVerifierEvidence({
    plan: peerPlan,
    agents: [...agents, peer],
    verifier_task_id: "verify",
  });
  assert.equal(evaluation.promotable, false);
  assert.ok(evaluation.missing.includes("task_scoped_v2_task_binding_mismatch"));
  assert.equal(evaluation.scoped_report_bindings.length, 3);
  const withoutPeer = evaluateTaskScopedNativeVerifierEvidence({
    plan,
    agents,
    verifier_task_id: "verify",
  });
  assert.notEqual(evaluation.evaluation_digest, withoutPeer.evaluation_digest);

  const unattestedPeer = structuredClone(agents[1]);
  unattestedPeer.task_id = "verify-peer";
  unattestedPeer.agent_id = "codex-peer-verifier";
  unattestedPeer.native_session_fingerprint = "e".repeat(64);
  unattestedPeer.native_presence_signature = `ags_${"e".repeat(32)}`;
  unattestedPeer.report.acceptance_evidence = [];
  unattestedPeer.report.evidence_refs = ["review:peer-without-task-attestation"];
  const unattestedPeerBlocked = evaluateTaskScopedNativeVerifierEvidence({
    plan: peerPlan,
    agents: [...agents, unattestedPeer],
    verifier_task_id: "verify",
  });
  assert.equal(unattestedPeerBlocked.promotable, false);
  assert.ok(unattestedPeerBlocked.missing.includes(
    "task_scoped_peer_v2_task_attestation_missing:verify-peer"));
});

test("task-scoped verifier promotes empty acceptance only for exact normalized precommit evidence", () => {
  const plan = closurePlan();
  const v2TaskId = "33333333-3333-4333-8333-333333333333";
  const v2TaskDigest = "4".repeat(64);
  const agents = precommitAgents(plan).map((agent) => ({
    ...agent,
    v2_task_id: v2TaskId,
    v2_task_digest: v2TaskDigest,
  }));
  agents[1].report.acceptance_evidence = [];
  agents[1].report.evidence_refs.push(`v2-task:${v2TaskDigest}`);

  const accepted = evaluateTaskScopedNativeVerifierEvidence({
    plan,
    agents,
    verifier_task_id: "verify",
  });
  assert.equal(accepted.promotable, true);
  assert.equal(
    accepted.precommit_workspace_digest,
    agents[0].report.precommit_evidence.workspace_digest,
  );
  assert.equal(accepted.v2_task_digest, v2TaskDigest);

  const missingTaskAttestation = structuredClone(agents);
  missingTaskAttestation[1].report.evidence_refs = ["review:precommit"];
  const taskAttestationBlocked = evaluateTaskScopedNativeVerifierEvidence({
    plan,
    agents: missingTaskAttestation,
    verifier_task_id: "verify",
  });
  assert.equal(taskAttestationBlocked.promotable, false);
  assert.ok(taskAttestationBlocked.missing.includes("task_scoped_v2_task_attestation_missing"));

  const changedTaskBinding = structuredClone(agents);
  changedTaskBinding[1].v2_task_digest = "5".repeat(64);
  const changedTaskBlocked = evaluateTaskScopedNativeVerifierEvidence({
    plan,
    agents: changedTaskBinding,
    verifier_task_id: "verify",
  });
  assert.equal(changedTaskBlocked.promotable, false);
  assert.ok(changedTaskBlocked.missing.includes("task_scoped_precommit_evidence_mismatch"));

  const peerPlan = structuredClone(plan);
  peerPlan.tasks.push({
    task_id: "verify-peer",
    kind: "verifier",
    instruction: "Independently dissent when the task evidence is insufficient.",
    dependencies: ["build"],
    task_digest: "6".repeat(64),
  });
  const peerDissent = structuredClone(agents[1]);
  peerDissent.task_id = "verify-peer";
  peerDissent.agent_id = "codex-peer-verifier";
  peerDissent.native_session_fingerprint = "e".repeat(64);
  peerDissent.native_presence_signature = `ags_${"e".repeat(32)}`;
  peerDissent.report.verdict = "rejected";
  const peerDissentBlocked = evaluateTaskScopedNativeVerifierEvidence({
    plan: peerPlan,
    agents: [...agents, peerDissent],
    verifier_task_id: "verify",
  });
  assert.equal(peerDissentBlocked.promotable, false);
  assert.ok(peerDissentBlocked.missing.includes("task_scoped_peer_verifier_not_approved"));

  const mismatch = structuredClone(agents);
  mismatch[1].report.precommit_evidence.diff_digest = "e".repeat(64);
  const verifierEvidence = { ...mismatch[1].report.precommit_evidence };
  delete verifierEvidence.workspace_digest;
  mismatch[1].report.precommit_evidence.workspace_digest = digest(verifierEvidence);
  const mismatchBlocked = evaluateTaskScopedNativeVerifierEvidence({
    plan,
    agents: mismatch,
    verifier_task_id: "verify",
  });
  assert.equal(mismatchBlocked.promotable, false);
  assert.ok(mismatchBlocked.missing.includes("task_scoped_precommit_evidence_mismatch"));

  const dissent = structuredClone(agents);
  dissent[1].report.acceptance_evidence = [{
    criterion_digest: plan.acceptance_contract.criteria[0].criterion_digest,
    passed: false,
    evidence_refs: ["dissent:task-scope"],
  }];
  const dissentBlocked = evaluateTaskScopedNativeVerifierEvidence({
    plan,
    agents: dissent,
    verifier_task_id: "verify",
  });
  assert.equal(dissentBlocked.promotable, false);
  assert.ok(dissentBlocked.missing.includes("task_scoped_verifier_evidence_rejected"));

  const failedTest = structuredClone(agents);
  failedTest[0].report.tests[0].passed = false;
  const testBlocked = evaluateTaskScopedNativeVerifierEvidence({
    plan,
    agents: failedTest,
    verifier_task_id: "verify",
  });
  assert.equal(testBlocked.promotable, false);
  assert.ok(testBlocked.missing.includes("task_scoped_test_failure_present:build"));
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

test("native report schema separates build from system verification", () => {
  const reportTool = WORK_CONTINUITY_TOOLS.find((tool) => tool.name === "work_continuity_native_report");
  assert.deepEqual(reportTool.inputSchema.properties.report.properties.automation_stage.enum,
    ["build", "system_verification", "final_acceptance"]);
});

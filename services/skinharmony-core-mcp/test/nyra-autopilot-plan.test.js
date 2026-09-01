import assert from "node:assert/strict";
import test from "node:test";
import {
  NYRA_AUTOPILOT_MAX_ACTIVE_ROLES,
  NYRA_AUTOPILOT_MAX_PARALLEL,
  compileNyraAutopilotPlan,
} from "../src/nyra-autopilot-plan.js";
import { digest } from "../src/work-continuity-runtime.js";

const SCOPE = Object.freeze({
  tenant_id: "codexai",
  project_id: "skinharmony-ai-backend",
  work_id: "11111111-1111-4111-8111-111111111111",
});
const roles = (plan) => plan.required_roles.map((item) => item.blueprint_id);

function coreVerdict(overrides = {}) {
  const material = {
    schema_version: "core_orchestration_verdict_v1",
    authority: "UNIVERSAL_CORE",
    verdict: "HOLD",
    reason_codes: ["new_work_identity_required"],
    canonical_intent_binding: {
      schema_version: "nyra_canonical_intent_binding_v1",
      intent_digest: "a".repeat(64),
      raw_text_digest: "d".repeat(64),
      operation_class: "EXTERNAL_MUTATION",
      work_requirement: "NEW",
      consequential_intent: true,
      ambiguity: false,
    },
    required_nyra_branches: [{
      id: "execution_planning",
      work_phase: "implementation",
      core_branch_bindings: ["workspace.write"],
    }],
    denied_nyra_branches: [],
    required_roles: ["planner", "executor_specialist", "independent_verifier"],
    task_graph_digest: "c".repeat(64),
    maximum_parallel_assignments: 2,
    independent_verifier_required: true,
    nyra_materializes_branches: true,
    core_join_required: true,
    permitted_progress: ["ANALYSIS", "PLANNING", "EVIDENCE", "BOUNDED_WORKSPACE"],
    external_execution_authorized: false,
    ...overrides,
  };
  const binding = material.canonical_intent_binding;
  material.canonical_intent_binding = {
    ...binding,
    binding_digest: digest(binding),
  };
  return { ...material, verdict_digest: digest(material) };
}

test("Nyra Autopilot creates a deterministic zero-privilege plan from one Work", () => {
  const plan = compileNyraAutopilotPlan({ ...SCOPE, objective: "Organizza il prossimo appuntamento" });
  assert.deepEqual(plan.scope, SCOPE);
  assert.deepEqual(roles(plan), ["memory_curator", "planner"]);
  assert.equal(plan.execution.execution_authorized, false);
  assert.equal(plan.execution.model_invocation_allowed, false);
  assert.equal(plan.execution.tool_invocation_allowed, false);
  assert.equal(plan.execution.external_action_allowed, false);
  assert.equal(plan.core_join.required, true);
  assert.match(plan.plan_digest, /^[a-f0-9]{64}$/);
});

test("Nyra Autopilot adds only the specialists justified by the Work", () => {
  const research = compileNyraAutopilotPlan({ ...SCOPE, objective: "Fai una ricerca di mercato con evidenze" });
  assert.deepEqual(roles(research), ["memory_curator", "planner", "researcher"]);
  const implementation = compileNyraAutopilotPlan({ ...SCOPE, objective: "Implementa una patch e prepara il deploy" });
  assert.deepEqual(roles(implementation), ["memory_curator", "planner", "executor_specialist", "release_operations", "independent_verifier"]);
  for (const wave of implementation.activation.waves) {
    assert.ok(wave.active_blueprint_ids.length <= NYRA_AUTOPILOT_MAX_ACTIVE_ROLES);
    assert.ok(wave.max_parallel <= NYRA_AUTOPILOT_MAX_PARALLEL);
  }
});

test("Nyra Autopilot rejects malformed Work scope", () => {
  assert.throws(() => compileNyraAutopilotPlan({ ...SCOPE, tenant_id: "bad tenant" }), /tenant_invalid/);
  assert.throws(() => compileNyraAutopilotPlan({ ...SCOPE, work_id: "not-a-work" }), /work_invalid/);
});

test("a Core verdict is the exact role and branch authority and is bound into the plan digest", () => {
  const verdict = coreVerdict();
  const plan = compileNyraAutopilotPlan({
    ...SCOPE,
    canonical_intent_digest: "a".repeat(64),
    objective: "Ricerca, deploy e release must not lexically widen the Core role set",
    core_orchestration_verdict: verdict,
  });
  assert.deepEqual(roles(plan), verdict.required_roles);
  assert.deepEqual(plan.required_nyra_branches, verdict.required_nyra_branches);
  assert.equal(plan.core_orchestration.verdict_digest, verdict.verdict_digest);
  assert.equal(plan.core_orchestration.canonical_intent_binding_digest,
    verdict.canonical_intent_binding.binding_digest);
  const changed = coreVerdict({
    required_nyra_branches: [{ ...verdict.required_nyra_branches[0], work_phase: "verification" }],
  });
  assert.notEqual(compileNyraAutopilotPlan({
    ...SCOPE, canonical_intent_digest: "a".repeat(64), core_orchestration_verdict: changed,
  }).plan_digest, plan.plan_digest);
});

test("Core verdict tampering, drift and unknown roles fail closed", () => {
  const verdict = coreVerdict();
  assert.throws(() => compileNyraAutopilotPlan({
    ...SCOPE, canonical_intent_digest: "a".repeat(64),
    core_orchestration_verdict: { ...verdict, required_roles: ["planner"] },
  }), /core_orchestration_/);
  assert.throws(() => compileNyraAutopilotPlan({
    ...SCOPE, canonical_intent_digest: "d".repeat(64), core_orchestration_verdict: verdict,
  }), /core_orchestration_/);
  assert.throws(() => compileNyraAutopilotPlan({
    ...SCOPE, canonical_intent_digest: "a".repeat(64),
    core_orchestration_verdict: coreVerdict({ required_roles: ["planner", "root_agent"] }),
  }), /core_orchestration_/);
});

test("a BLOCK verdict retains exact evidence but exposes no activation wave", () => {
  const verdict = coreVerdict({
    verdict: "BLOCK",
    required_roles: ["memory_curator", "planner"],
    independent_verifier_required: false,
    permitted_progress: ["ANALYSIS", "EVIDENCE", "REMEDIATION_PROPOSAL"],
  });
  const plan = compileNyraAutopilotPlan({
    ...SCOPE, canonical_intent_digest: "a".repeat(64), core_orchestration_verdict: verdict,
  });
  assert.deepEqual(roles(plan), verdict.required_roles);
  assert.deepEqual(plan.activation.waves, []);
  assert.equal(plan.core_orchestration.verdict, "BLOCK");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  NYRA_AUTOPILOT_MAX_ACTIVE_ROLES,
  NYRA_AUTOPILOT_MAX_PARALLEL,
  compileNyraAutopilotPlan,
} from "../src/nyra-autopilot-plan.js";

const SCOPE = Object.freeze({
  tenant_id: "codexai",
  project_id: "skinharmony-ai-backend",
  work_id: "11111111-1111-4111-8111-111111111111",
});
const roles = (plan) => plan.required_roles.map((item) => item.blueprint_id);

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

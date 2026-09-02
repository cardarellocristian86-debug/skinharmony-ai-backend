import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNyraNativePlanRequest,
  parseNyraProjectReleaseBindings,
  resolveNyraProjectReleaseBinding,
} from "../src/nyra-native-plan-bridge.js";

const work = { work_id: "a7448d84-3113-4c4f-9ff6-0b0a436f19c9", project_id: "skinharmony-ai-backend" };
const bindings = parseNyraProjectReleaseBindings(JSON.stringify({
  schema_version: "nyra_project_release_bindings_v1",
  bindings: [{
    tenant_id: "codexai",
    project_id: "skinharmony-ai-backend",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    base_branch: "main",
    required_checks: ["universal-core", "core-mcp", "deployment-parity"],
  }],
}));

test("Nyra release binding is server-owned, exact, and scoped by tenant and project", () => {
  const binding = resolveNyraProjectReleaseBinding(bindings, { tenantId: "codexai", projectId: work.project_id });
  assert.deepEqual(binding.required_checks, ["core-mcp", "deployment-parity", "universal-core"]);
  assert.equal(resolveNyraProjectReleaseBinding(bindings, { tenantId: "other", projectId: work.project_id }), null);
  assert.throws(() => parseNyraProjectReleaseBindings(JSON.stringify({
    schema_version: "nyra_project_release_bindings_v1",
    bindings: [{ ...binding, required_checks: [] }],
  })), /checks required/);
});

test("Nyra turns a materialized Autopilot proposal into one idempotent native builder/verifier plan", () => {
  const request = buildNyraNativePlanRequest({
    identity: { agentPresence: { client_type: "codex" } },
    work,
    intent: { anchor: { objective: "Fix continuity without an extra owner confirmation." } },
    autopilot: { plan_digest: "a".repeat(64), plan: { intent: { implementation: true, release: true } } },
    binding: bindings[0],
  });
  assert.equal(request.host_type, "codex_native");
  assert.deepEqual(request.tasks.map((task) => task.task_id), ["build", "verify"]);
  assert.deepEqual(request.tasks[1].dependencies, ["build"]);
  assert.match(request.tasks[1].instruction, /distinct native agent session/);
  assert.deepEqual(request.launch_request, {
    schema_version: "nyra_host_launch_request_v1", requested_by: "nyra", action: "START_NATIVE_PLAN",
    verifier_task_id: "verify", distinct_session_required: true, host_execution_required: true,
  });
  assert.equal(request.closure_requirements.live_verification_required, true);
  assert.match(request.idempotency_key, /^nyra_native_[a-f0-9]{48}$/);
});

test("implementation plans defer live readback until the separately classified release phase", () => {
  const request = buildNyraNativePlanRequest({
    identity: { agentPresence: { client_type: "codex" } },
    work,
    intent: { anchor: { objective: "Prepare a bounded implementation safely." } },
    autopilot: { plan_digest: "b".repeat(64), plan: { intent: { implementation: true, release: false } } },
    binding: bindings[0],
  });

  assert.equal(request.closure_requirements.live_verification_required, false);
  assert.match(request.tasks[0].instruction, /precommit evidence/);
  assert.match(request.tasks[1].instruction, /live verification is deferred to release/);
});

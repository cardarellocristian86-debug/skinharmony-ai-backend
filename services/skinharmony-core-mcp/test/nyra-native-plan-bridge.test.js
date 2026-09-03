import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNyraNativePlanRequest,
  parseNyraProjectReleaseBindings,
  resolveNyraProjectReleaseBinding,
  resolveNyraProjectReleaseBindingResolution,
} from "../src/nyra-native-plan-bridge.js";
import { digest } from "../src/work-continuity-runtime.js";

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

test("an exact project release binding wins when the tenant has multiple bindings", () => {
  const candidates = parseNyraProjectReleaseBindings(JSON.stringify({
    schema_version: "nyra_project_release_bindings_v1",
    bindings: [bindings[0], {
      ...bindings[0],
      project_id: "nyra-core",
      repository: "cardarellocristian86-debug/nyra-core",
    }],
  }));
  const scope = { tenantId: "codexai", projectId: "nyra-core" };
  const resolution = resolveNyraProjectReleaseBindingResolution(candidates, scope);

  assert.equal(resolution.mode, "exact_project");
  assert.strictEqual(resolution.binding, candidates[1]);
  assert.equal(resolution.resolution_digest, digest({
    schema_version: "nyra_project_release_binding_resolution_v1",
    mode: "exact_project",
    tenant_id: "codexai",
    requested_project_id: "nyra-core",
    resolved_project_id: "nyra-core",
    binding_digest: digest(candidates[1]),
  }));
  assert.strictEqual(resolveNyraProjectReleaseBinding(candidates, scope), candidates[1]);
});

test("a valid unmatched project falls back only to the tenant's single release binding", () => {
  const candidates = parseNyraProjectReleaseBindings(JSON.stringify({
    schema_version: "nyra_project_release_bindings_v1",
    bindings: [bindings[0], {
      ...bindings[0],
      tenant_id: "other",
      project_id: "other-project",
      repository: "other-owner/other-project",
    }],
  }));
  const scope = { tenantId: "codexai", projectId: "legacy-project" };
  const resolution = resolveNyraProjectReleaseBindingResolution(candidates, scope);
  const resolutionMaterial = {
    schema_version: "nyra_project_release_binding_resolution_v1",
    mode: "tenant_singleton_fallback",
    tenant_id: "codexai",
    requested_project_id: "legacy-project",
    resolved_project_id: work.project_id,
    binding_digest: digest(candidates[0]),
  };

  assert.equal(resolution.mode, "tenant_singleton_fallback");
  assert.strictEqual(resolution.binding, candidates[0]);
  assert.equal(resolution.binding_digest, digest(candidates[0]));
  assert.equal(resolution.resolution_digest, digest(resolutionMaterial));
  assert.equal(
    resolveNyraProjectReleaseBindingResolution(candidates, scope).resolution_digest,
    resolution.resolution_digest,
  );
  assert.notEqual(
    resolveNyraProjectReleaseBindingResolution(candidates, {
      tenantId: "codexai",
      projectId: work.project_id,
    }).resolution_digest,
    resolution.resolution_digest,
  );
  assert.strictEqual(resolveNyraProjectReleaseBinding(candidates, scope), candidates[0]);
});

test("release binding fallback fails closed for invalid, missing, ambiguous, and cross-tenant scope", () => {
  for (const projectId of [
    undefined,
    42,
    "",
    "x",
    "../invalid",
    `${work.project_id}${"x".repeat(64)}`,
    `${work.project_id}\u0000`,
  ]) {
    assert.equal(resolveNyraProjectReleaseBindingResolution(bindings, {
      tenantId: "codexai",
      projectId,
    }), null);
  }
  assert.equal(resolveNyraProjectReleaseBindingResolution([], {
    tenantId: "codexai",
    projectId: "legacy-project",
  }), null);

  const crossTenantOnly = parseNyraProjectReleaseBindings(JSON.stringify({
    schema_version: "nyra_project_release_bindings_v1",
    bindings: [{ ...bindings[0], tenant_id: "other" }],
  }));
  assert.equal(resolveNyraProjectReleaseBindingResolution(crossTenantOnly, {
    tenantId: "codexai",
    projectId: work.project_id,
  }), null);

  const ambiguous = parseNyraProjectReleaseBindings(JSON.stringify({
    schema_version: "nyra_project_release_bindings_v1",
    bindings: [bindings[0], {
      ...bindings[0],
      project_id: "nyra-core",
      repository: "cardarellocristian86-debug/nyra-core",
    }],
  }));
  const ambiguousScope = { tenantId: "codexai", projectId: "legacy-project" };
  assert.equal(resolveNyraProjectReleaseBindingResolution(ambiguous, ambiguousScope), null);
  assert.equal(resolveNyraProjectReleaseBinding(ambiguous, ambiguousScope), null);
  assert.equal(resolveNyraProjectReleaseBinding(bindings, {
    tenantId: "invalid tenant",
    projectId: "legacy-project",
  }), null);
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
  assert.match(request.tasks[1].instruction, /every server-issued criterion/);
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
  assert.match(request.tasks[1].instruction, /attest every server-issued constraint/);
  assert.match(request.tasks[1].instruction, /future-only objective or acceptance criteria deferred/);
  assert.match(request.tasks[1].instruction, /Live verification is deferred to release/);
  assert.doesNotMatch(request.tasks[1].instruction, /acceptance evidence for every server-issued criterion/);
});

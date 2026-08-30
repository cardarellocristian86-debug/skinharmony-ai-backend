import assert from "node:assert/strict";
import test from "node:test";
import { projectNyraControlRoomStatus, projectWorkClosureProgress } from "../src/nyra-control-room.js";
import { validateToolArguments } from "../src/schema-validation.js";
import { TOOLS } from "../src/tool-definitions.js";

function toolNamed(name) {
  return TOOLS.find((tool) => tool.name === name);
}

test("Control Room calculates closure progress only from server work context", () => {
  const progress = projectWorkClosureProgress({
    available: true,
    required_task_count: 4,
    pending_required_task_count: 1,
    required_evidence_count: 6,
    unverified_required_evidence_count: 2,
    closure_verified: false,
    next_required_task: { task_id: "task-1", title: "Independent verification" },
  });
  assert.equal(progress.percent, 63);
  assert.equal(progress.next_action.title, "Independent verification");
  assert.deepEqual(progress.blockers.map((item) => item.code), [
    "required_tasks_pending", "required_evidence_unverified", "closure_not_verified",
  ]);
});

test("Control Room distinguishes runtime controls from deployment configuration", () => {
  const status = projectNyraControlRoomStatus({
    nyraDialogueEnabled: false,
    health: {
      ok: true,
      causal_continuity: { state: "ready" },
      entity_360: { mode: "SHADOW", bitemporal_mode: "SHADOW",
        deployment_mode_ceiling: "SHADOW", ready: true,
        tenant_shadow_disable_available: true },
      host_native_governance: { semantic_scope_guard_mode: "ENFORCE", semantic_scope_guard_configured: true },
      research_airlock: { mode: "enforced", state: "ready", operational_safe: true },
      nyra_policy_registry: { ready: true, state: "ready", enforcement: "conditional_on_active_snapshot" },
    },
  });
  assert.equal(status.state, "READY");
  const dialogue = status.domains.find((item) => item.id === "nyra_dialogue");
  assert.equal(dialogue.state, "OFF");
  assert.equal(dialogue.detail.restart_required, true);
  const entity360 = status.domains.find((item) => item.id === "entity_360");
  assert.deepEqual(entity360.allowed_actions.map((item) => item.id), [
    "READ_STATUS", "REQUEST_ENABLE_SHADOW", "REQUEST_DISABLE_SHADOW",
  ]);
  assert.equal(entity360.allowed_actions[1].handler, "entity_360_shadow_enable");
  assert.equal(entity360.allowed_actions[1].requires_owner_confirmation, true);
  assert.equal(entity360.allowed_actions[2].handler, "entity_360_shadow_disable");
  assert.equal(entity360.allowed_actions[2].requires_core_authorization, true);
  assert.equal(entity360.detail.shadow_transition_available, true);
  assert.equal(entity360.detail.shadow_transition_blocker, null);
  assert.equal(entity360.detail.shadow_disable_available, true);
  assert.equal(entity360.detail.shadow_disable_blocker, null);
  const policyRegistry = status.domains.find((item) => item.id === "policy_registry");
  assert.equal(policyRegistry.allowed_actions[1].availability, "REQUEST_ONLY");
  assert.equal(policyRegistry.allowed_actions[1].handler, null);
});

test("Control Room projects the emitted continuity and Research Airlock health fields", () => {
  const status = projectNyraControlRoomStatus({
    health: {
      ok: true,
      causal_continuity: { ok: true, state: "ready" },
      research_airlock: {
        mode: "enforced",
        ready: true,
        state_backend: "postgresql",
        operational_safe: true,
      },
    },
  });
  const continuity = status.domains.find((item) => item.id === "work_continuity");
  assert.equal(continuity.state, "READY");
  assert.equal(continuity.detail.backend, "READY");
  const airlock = status.domains.find((item) => item.id === "research_airlock");
  assert.equal(airlock.state, "ENFORCED");
  assert.equal(airlock.detail.state, "READY");

  const failedProbe = projectNyraControlRoomStatus({
    health: { research_airlock: { state: "probe_timeout", ready: false } },
  }).domains.find((item) => item.id === "research_airlock");
  assert.equal(failedProbe.detail.state, "PROBE_TIMEOUT");
});

test("Control Room preserves tenant OFF rollback while the SHADOW runtime is not ready", () => {
  const entity360 = projectNyraControlRoomStatus({ health: { ok: true,
    entity_360: { mode: "SHADOW", deployment_mode_ceiling: "SHADOW", ready: false,
      tenant_shadow_disable_available: true } } })
    .domains.find((item) => item.id === "entity_360");
  assert.equal(entity360.detail.shadow_transition_available, false);
  assert.equal(entity360.detail.shadow_transition_blocker,
    "entity_360_shadow_runtime_not_ready");
  assert.equal(entity360.detail.shadow_disable_available, true);
  assert.equal(entity360.detail.shadow_disable_blocker, null);
  const enable = entity360.allowed_actions.find((item) => item.id === "REQUEST_ENABLE_SHADOW");
  const disable = entity360.allowed_actions.find((item) => item.id === "REQUEST_DISABLE_SHADOW");
  assert.equal(enable.handler, null);
  assert.equal(enable.availability, "UNAVAILABLE");
  assert.equal(disable.handler, "entity_360_shadow_disable");
  assert.equal(disable.availability, "EXISTING_GOVERNED_HANDLER");
  assert.equal(disable.execution, "REQUEST_BOUND_GOVERNED");
});

test("Control Room never advertises Entity 360 shadow transitions before their Core deployment prerequisites", () => {
  const cases = [
    {
      entity_360: { mode: "OFF", deployment_mode_ceiling: "OFF", ready: false },
      blocker: "entity_360_shadow_deployment_ceiling_required",
    },
    {
      entity_360: { mode: "SHADOW", deployment_mode_ceiling: "SHADOW", ready: false },
      blocker: "entity_360_shadow_runtime_not_ready",
    },
    {
      entity_360: { mode: "INVALID", deployment_mode_ceiling: "INVALID", ready: false },
      blocker: "entity_360_shadow_deployment_ceiling_required",
    },
    {
      entity_360: { mode: "SHADOW", ready: true },
      blocker: "entity_360_shadow_deployment_ceiling_unknown",
    },
  ];
  for (const { entity_360, blocker } of cases) {
    const entity360 = projectNyraControlRoomStatus({ health: { ok: true, entity_360 } })
      .domains.find((item) => item.id === "entity_360");
    assert.equal(entity360.detail.shadow_transition_available, false);
    assert.equal(entity360.detail.shadow_transition_blocker, blocker);
    for (const action of entity360.allowed_actions.slice(1)) {
      assert.equal(action.availability, "UNAVAILABLE", blocker);
      assert.equal(action.execution, "DEPLOYMENT_PREREQUISITE", blocker);
      assert.equal(action.handler, null, blocker);
    }
  }
});

test("Control Room output contract accepts unavailable governed transitions", () => {
  const controlRoom = projectNyraControlRoomStatus({
    health: {
      ok: true,
      entity_360: { mode: "OFF", deployment_mode_ceiling: "OFF", ready: false },
    },
  });
  const definition = toolNamed("nyra_control_room_status");
  assert.deepEqual(definition.scopes, ["core:read"]);
  assert.equal(definition.annotations.readOnlyHint, true);
  assert.equal(definition.annotations.idempotentHint, true);
  assert(definition.outputSchema, "Control Room must publish its output contract");
  const schema = definition.outputSchema;
  assert.deepEqual(validateToolArguments(schema, {
    ok: true,
    tenant_id: "tenant-a",
    control_room: controlRoom,
  }), []);
});

test("Control Room never renders unavailable health readback as OFF", () => {
  const status = projectNyraControlRoomStatus({ health: { ok: true } });
  assert.equal(status.domains.find((item) => item.id === "entity_360").state, "UNKNOWN");
  assert.equal(status.domains.find((item) => item.id === "semantic_scope_guard").state, "UNKNOWN");
  assert.equal(status.domains.find((item) => item.id === "research_airlock").state, "UNKNOWN");
  assert.equal(status.domains.find((item) => item.id === "nyra_dialogue").state, "UNKNOWN");
});

test("Control Room rejects malformed health mode values instead of stringifying them", () => {
  const status = projectNyraControlRoomStatus({
    health: {
      ok: true,
      entity_360: { mode: { forged: "SHADOW" } },
      host_native_governance: { semantic_scope_guard_mode: ["ENFORCE"] },
    },
  });
  assert.equal(status.domains.find((item) => item.id === "entity_360").state, "UNKNOWN");
  assert.equal(status.domains.find((item) => item.id === "semantic_scope_guard").state, "UNKNOWN");
});

test("Control Room declines to invent progress from malformed server context", () => {
  const progress = projectWorkClosureProgress({
    available: true,
    required_task_count: 2,
    pending_required_task_count: 3,
    required_evidence_count: 1,
    unverified_required_evidence_count: 0,
    closure_verified: false,
  });
  assert.equal(progress.percent, null);
  assert.equal(progress.formula, "server_work_context_invalid");
  assert.deepEqual(progress.blockers, [{ code: "server_work_context_invalid", count: 1 }]);
});

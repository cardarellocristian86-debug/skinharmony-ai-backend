import assert from "node:assert/strict";
import test from "node:test";
import { projectNyraControlRoomStatus, projectWorkClosureProgress } from "../src/nyra-control-room.js";

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
      entity_360: { mode: "SHADOW", bitemporal_mode: "SHADOW", deployment_mode_ceiling: "SHADOW", ready: true },
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
    "READ_STATUS", "REQUEST_ENABLE_SHADOW",
  ]);
  assert.equal(entity360.allowed_actions[1].handler, "entity_360_shadow_enable");
  assert.equal(entity360.allowed_actions[1].requires_owner_confirmation, true);
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

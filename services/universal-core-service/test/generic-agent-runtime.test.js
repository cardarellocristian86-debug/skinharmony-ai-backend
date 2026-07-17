import assert from "node:assert/strict";
import test from "node:test";
import { createGenericAgentRuntime } from "../src/genericAgentRuntime.js";

function runtime() {
  let counter = 0;
  return createGenericAgentRuntime({
    now: () => "2026-07-17T08:00:00.000Z",
    idFactory: () => `id_${++counter}`,
  });
}

test("generic runtime checkpoints and resumes an isolated run", () => {
  const subject = runtime();
  const started = subject.startRun({ tenant_id: "tenant_a", agent_id: "planner", task: "Build a release plan", tools: ["search"] });
  subject.checkpointRun({ run_id: started.run_id, tenant_id: "tenant_a", checkpoint: { state: { phase: "research" }, cursor: "step_1", idempotency_key: "resume-1" } });
  const resumed = subject.resumeRun({ run_id: started.run_id, tenant_id: "tenant_a", expected_checkpoint_key: "resume-1" });
  assert.equal(resumed.status, "running");
  assert.equal(resumed.checkpoint.cursor, "step_1");
  assert.throws(() => subject.getRun({ run_id: started.run_id, tenant_id: "tenant_b" }), /cross_tenant_run_denied/);
});

test("generic runtime makes handoffs idempotent and recipient-scoped", () => {
  const subject = runtime();
  const started = subject.startRun({ tenant_id: "tenant_a", agent_id: "planner", task: "Delegate review" });
  const first = subject.createHandoff({ run_id: started.run_id, tenant_id: "tenant_a", to_agent_id: "reviewer", summary: "Review the plan", idempotency_key: "handoff-1" });
  const replay = subject.createHandoff({ run_id: started.run_id, tenant_id: "tenant_a", to_agent_id: "reviewer", summary: "Ignored replay body", idempotency_key: "handoff-1" });
  assert.equal(replay.handoff_id, first.handoff_id);
  assert.throws(() => subject.claimHandoff({ handoff_id: first.handoff_id, tenant_id: "tenant_a", agent_id: "other" }), /handoff_recipient_mismatch/);
  assert.equal(subject.claimHandoff({ handoff_id: first.handoff_id, tenant_id: "tenant_a", agent_id: "reviewer" }).status, "claimed");
});

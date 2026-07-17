import assert from "node:assert/strict";
import test from "node:test";
import { createGenericAgentOrchestrator } from "../src/genericAgentOrchestrator.js";

test("generic orchestrator respects dependencies, concurrency and Core join", () => {
  const orchestrator = createGenericAgentOrchestrator({ maxConcurrent: 2, idFactory: () => "fixed", now: () => "2026-07-17T10:00:00.000Z" });
  const plan = orchestrator.createPlan({
    tenant_id: "tenant-a",
    run_id: "run-a",
    workers: [
      { worker_id: "research", agent_id: "researcher", task: "Collect evidence" },
      { worker_id: "review", agent_id: "reviewer", task: "Review evidence", dependencies: ["research"] },
      { worker_id: "draft", agent_id: "writer", task: "Draft response" },
    ],
  });
  const first = orchestrator.claimReadyWorkers({ tenant_id: "tenant-a", plan_id: plan.plan_id });
  assert.deepEqual(first.workers.map((worker) => worker.worker_id), ["research", "draft"]);
  orchestrator.completeWorker({ tenant_id: "tenant-a", plan_id: plan.plan_id, worker_id: "research", result: { sources: 2 } });
  const second = orchestrator.claimReadyWorkers({ tenant_id: "tenant-a", plan_id: plan.plan_id });
  assert.deepEqual(second.workers.map((worker) => worker.worker_id), ["review"]);
  orchestrator.completeWorker({ tenant_id: "tenant-a", plan_id: plan.plan_id, worker_id: "draft", result: { draft: true } });
  orchestrator.completeWorker({ tenant_id: "tenant-a", plan_id: plan.plan_id, worker_id: "review", result: { approved: true } });
  const joined = orchestrator.coreJoin({ tenant_id: "tenant-a", plan_id: plan.plan_id });
  assert.equal(joined.status, "completed");
  assert.equal(joined.worker_results.length, 3);
});

test("generic orchestrator blocks cross-tenant reads and cancellation is terminal", () => {
  const orchestrator = createGenericAgentOrchestrator();
  const plan = orchestrator.createPlan({ tenant_id: "tenant-a", run_id: "run-a", workers: [{ worker_id: "one", agent_id: "agent", task: "Work" }] });
  assert.throws(() => orchestrator.getPlan({ tenant_id: "tenant-b", plan_id: plan.plan_id }), /cross_tenant_plan_denied/);
  const cancelled = orchestrator.cancelPlan({ tenant_id: "tenant-a", plan_id: plan.plan_id });
  assert.equal(cancelled.status, "cancelled");
  assert.throws(() => orchestrator.claimReadyWorkers({ tenant_id: "tenant-a", plan_id: plan.plan_id }), /plan_not_schedulable/);
});

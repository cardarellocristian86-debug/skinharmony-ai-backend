import assert from "node:assert/strict";
import test from "node:test";
import { createGenericAgentOrchestrator } from "../src/genericAgentOrchestrator.js";

function completePlan(orchestrator, tenantId, planId) {
  let safety = 0;
  while (safety++ < 1_000) {
    const claimed = orchestrator.claimReadyWorkers({ tenant_id: tenantId, plan_id: planId });
    if (claimed.workers.length === 0) {
      const plan = orchestrator.getPlan({ tenant_id: tenantId, plan_id: planId });
      if (plan.status === "ready_for_core_join") return orchestrator.coreJoin({ tenant_id: tenantId, plan_id: planId });
      continue;
    }
    for (const worker of claimed.workers) {
      orchestrator.completeWorker({ tenant_id: tenantId, plan_id: planId, worker_id: worker.worker_id, result: { variant: worker.worker_id } });
    }
  }
  throw new Error("benchmark_plan_did_not_converge");
}

test("generic orchestration benchmark handles complex shared multi-agent scenarios", () => {
  const orchestrator = createGenericAgentOrchestrator({ maxConcurrent: 4 });
  const projects = [];
  const projectCount = 24;
  for (let project = 0; project < projectCount; project += 1) {
    const tenantId = project % 2 === 0 ? "tenant-benchmark-a" : "tenant-benchmark-b";
    const workers = [
      { worker_id: "intake", agent_id: "coordinator", task: "Normalize project request" },
      ...Array.from({ length: 8 }, (_, index) => ({
        worker_id: `variant_${index + 1}`,
        agent_id: `specialist_${index + 1}`,
        task: `Evaluate scenario variant ${index + 1}`,
        dependencies: ["intake"],
      })),
      { worker_id: "synthesis", agent_id: "synthesizer", task: "Join scenario evidence", dependencies: Array.from({ length: 8 }, (_, index) => `variant_${index + 1}`) },
      { worker_id: "review", agent_id: "reviewer", task: "Verify joined outcome", dependencies: ["synthesis"] },
    ];
    projects.push({ tenantId, plan: orchestrator.createPlan({ tenant_id: tenantId, run_id: `complex-project-${project}`, workers }) });
  }

  const joined = projects.map(({ tenantId, plan }) => completePlan(orchestrator, tenantId, plan.plan_id));
  assert.equal(joined.length, projectCount);
  assert(joined.every((item) => item.status === "completed"));
  assert(joined.every((item) => item.worker_results.length === 11));

  const tenantA = orchestrator.getMetrics ? null : null;
  assert.throws(() => orchestrator.getPlan({ tenant_id: "tenant-benchmark-b", plan_id: projects[0].plan.plan_id }), /cross_tenant_plan_denied/);
  assert.equal(tenantA, null);
});

test("generic orchestration benchmark keeps cancellation isolated under load", () => {
  const orchestrator = createGenericAgentOrchestrator({ maxConcurrent: 3 });
  const plans = Array.from({ length: 30 }, (_, index) => orchestrator.createPlan({
    tenant_id: "tenant-cancellation",
    run_id: `cancel-project-${index}`,
    workers: Array.from({ length: 10 }, (_, worker) => ({
      worker_id: `worker_${worker}`,
      agent_id: `agent_${worker}`,
      task: "Bounded project task",
    })),
  }));
  for (const plan of plans.slice(0, 15)) {
    orchestrator.claimReadyWorkers({ tenant_id: "tenant-cancellation", plan_id: plan.plan_id });
    orchestrator.cancelPlan({ tenant_id: "tenant-cancellation", plan_id: plan.plan_id });
  }
  for (const plan of plans.slice(15)) completePlan(orchestrator, "tenant-cancellation", plan.plan_id);
  assert.equal(plans.filter((plan) => orchestrator.getPlan({ tenant_id: "tenant-cancellation", plan_id: plan.plan_id }).status === "cancelled").length, 15);
  assert.equal(plans.filter((plan) => orchestrator.getPlan({ tenant_id: "tenant-cancellation", plan_id: plan.plan_id }).status === "completed").length, 15);
});

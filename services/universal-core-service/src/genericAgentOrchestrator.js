import crypto from "node:crypto";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireText(value, field, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function normalizeWorkers(workers, maxWorkers, maxBranchDepth) {
  if (!Array.isArray(workers) || workers.length === 0 || workers.length > maxWorkers) throw new Error("workers_invalid");
  const seen = new Set();
  return workers.map((worker) => {
    const workerId = requireText(worker?.worker_id, "worker_id", 120);
    if (seen.has(workerId)) throw new Error("worker_id_duplicate");
    seen.add(workerId);
    return {
      worker_id: workerId,
      agent_id: requireText(worker?.agent_id, "agent_id", 120),
      task: requireText(worker?.task, "task", 4_000),
      dependencies: Array.isArray(worker?.dependencies)
        ? [...new Set(worker.dependencies.map((id) => requireText(id, "dependency_id", 120)))]
        : [],
      parent_worker_id: worker?.parent_worker_id ? requireText(worker.parent_worker_id, "parent_worker_id", 120) : null,
      branch_depth: Number.isInteger(worker?.branch_depth) ? worker.branch_depth : 0,
      status: "pending",
      result: null,
      error: null,
    };
  });
}

export function createGenericAgentOrchestrator({ maxConcurrent = 6, maxWorkers = 200, maxBranchDepth = 3, now = () => new Date().toISOString(), idFactory = () => crypto.randomUUID() } = {}) {
  const limit = Number(maxConcurrent);
  const workerLimit = Number(maxWorkers);
  const depthLimit = Number(maxBranchDepth);
  if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error("max_concurrent_invalid");
  if (!Number.isInteger(workerLimit) || workerLimit < 1 || workerLimit > 2_000) throw new Error("max_workers_invalid");
  if (!Number.isInteger(depthLimit) || depthLimit < 0 || depthLimit > 16) throw new Error("max_branch_depth_invalid");
  const plans = new Map();

  function planFor({ tenant_id, plan_id }) {
    const plan = plans.get(requireText(plan_id, "plan_id", 160));
    if (!plan) throw new Error("plan_not_found");
    if (plan.tenant_id !== requireText(tenant_id, "tenant_id", 120)) throw new Error("cross_tenant_plan_denied");
    return plan;
  }

  function refresh(plan) {
    const running = plan.workers.filter((worker) => worker.status === "running").length;
    const completed = plan.workers.filter((worker) => worker.status === "completed").length;
    const failed = plan.workers.some((worker) => worker.status === "failed");
    const cancelled = plan.workers.some((worker) => worker.status === "cancelled");
    if (failed) plan.status = "failed";
    else if (cancelled) plan.status = "cancelled";
    else if (completed === plan.workers.length) plan.status = "ready_for_core_join";
    else if (running > 0) plan.status = "running";
    plan.updated_at = now();
  }

  return {
    createPlan({ tenant_id, run_id, workers }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const normalized = normalizeWorkers(workers, workerLimit, depthLimit);
      const ids = new Set(normalized.map((worker) => worker.worker_id));
      for (const worker of normalized) {
        if (worker.branch_depth < 0 || worker.branch_depth > depthLimit) throw new Error("branch_depth_exceeded");
        for (const dependency of worker.dependencies) if (!ids.has(dependency)) throw new Error("dependency_not_found");
        if (worker.parent_worker_id && !ids.has(worker.parent_worker_id)) throw new Error("parent_worker_not_found");
      }
      const plan = {
        schema_version: "generic_agent_orchestration_v1",
        plan_id: `plan_${idFactory()}`,
        tenant_id: tenantId,
        run_id: requireText(run_id, "run_id", 160),
        status: "pending",
        max_concurrent: limit,
        max_workers: workerLimit,
        max_branch_depth: depthLimit,
        workers: normalized,
        created_at: now(),
        updated_at: now(),
        core_joined_at: null,
      };
      plans.set(plan.plan_id, plan);
      return clone(plan);
    },

    claimReadyWorkers({ tenant_id, plan_id }) {
      const plan = planFor({ tenant_id, plan_id });
      if (!["pending", "running"].includes(plan.status)) throw new Error("plan_not_schedulable");
      const running = plan.workers.filter((worker) => worker.status === "running").length;
      const slots = Math.max(0, plan.max_concurrent - running);
      const completed = new Set(plan.workers.filter((worker) => worker.status === "completed").map((worker) => worker.worker_id));
      const ready = plan.workers
        .filter((worker) => worker.status === "pending" && worker.dependencies.every((dependency) => completed.has(dependency)))
        .slice(0, slots);
      for (const worker of ready) worker.status = "running";
      refresh(plan);
      return clone({ plan_id: plan.plan_id, workers: ready });
    },

    completeWorker({ tenant_id, plan_id, worker_id, result = {} }) {
      const plan = planFor({ tenant_id, plan_id });
      const worker = plan.workers.find((item) => item.worker_id === requireText(worker_id, "worker_id", 120));
      if (!worker) throw new Error("worker_not_found");
      if (worker.status !== "running") throw new Error("worker_not_running");
      worker.status = "completed";
      worker.result = result && typeof result === "object" && !Array.isArray(result) ? clone(result) : {};
      refresh(plan);
      return clone(plan);
    },

    cancelPlan({ tenant_id, plan_id }) {
      const plan = planFor({ tenant_id, plan_id });
      if (["completed", "failed", "cancelled"].includes(plan.status)) throw new Error("plan_not_cancellable");
      let cancelledWorkerCount = 0;
      for (const worker of plan.workers) {
        if (worker.status === "pending" || worker.status === "running") {
          worker.status = "cancelled";
          cancelledWorkerCount += 1;
        }
      }
      refresh(plan);
      return clone({ ...plan, kill_signal: { propagated: true, cancelled_worker_count: cancelledWorkerCount } });
    },

    coreJoin({ tenant_id, plan_id }) {
      const plan = planFor({ tenant_id, plan_id });
      if (plan.status !== "ready_for_core_join") throw new Error("plan_not_ready_for_core_join");
      plan.status = "completed";
      plan.core_joined_at = now();
      plan.updated_at = plan.core_joined_at;
      return clone({
        plan_id: plan.plan_id,
        run_id: plan.run_id,
        status: plan.status,
        worker_results: plan.workers.map((worker) => ({ worker_id: worker.worker_id, agent_id: worker.agent_id, result: worker.result })),
        core_joined_at: plan.core_joined_at,
      });
    },

    restorePlan({ tenant_id, plan_snapshot }) {
      if (!plan_snapshot || typeof plan_snapshot !== "object" || Array.isArray(plan_snapshot)) throw new Error("plan_snapshot_invalid");
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      if (plan_snapshot.tenant_id !== tenantId) throw new Error("cross_tenant_plan_denied");
      const planId = requireText(plan_snapshot.plan_id, "plan_id", 160);
      const existing = plans.get(planId);
      if (existing) return clone(existing);
      const workers = normalizeWorkers(plan_snapshot.workers, workerLimit, depthLimit);
      const restored = {
        schema_version: "generic_agent_orchestration_v1",
        plan_id: planId,
        tenant_id: tenantId,
        run_id: requireText(plan_snapshot.run_id, "run_id", 160),
        status: ["pending", "running", "ready_for_core_join", "completed", "failed", "cancelled"].includes(plan_snapshot.status) ? plan_snapshot.status : "pending",
        max_concurrent: Math.min(Number(plan_snapshot.max_concurrent || limit), limit),
        max_workers: workerLimit,
        max_branch_depth: depthLimit,
        workers,
        created_at: plan_snapshot.created_at || now(),
        updated_at: now(),
        core_joined_at: plan_snapshot.core_joined_at || null,
      };
      plans.set(restored.plan_id, restored);
      return clone(restored);
    },

    getPlan({ tenant_id, plan_id }) {
      return clone(planFor({ tenant_id, plan_id }));
    },
  };
}

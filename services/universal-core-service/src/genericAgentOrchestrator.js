import crypto from "node:crypto";
import { guardInterAgentEnvelope } from "../../shared/handoff-injection-guard.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireText(value, field, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:@/-]*$/i;
const IDENTIFIER_EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const IDENTIFIER_PHONE_PATTERN = /(?:^|[_:-])\+?\d[\d .()-]{7,}\d$/;
const GENERATED_UUID_IDENTIFIER_PATTERN = /^[a-z][a-z0-9._:-]*[_:-][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireIdentifier(value, field, max = 160) {
  const normalized = requireText(value, field, max);
  if (
    !IDENTIFIER_PATTERN.test(normalized)
    || IDENTIFIER_EMAIL_PATTERN.test(normalized)
    || (
      IDENTIFIER_PHONE_PATTERN.test(normalized)
      && !GENERATED_UUID_IDENTIFIER_PATTERN.test(normalized)
    )
  ) throw new Error(`${field}_invalid`);
  return normalized;
}

function normalizeWorkers(workers, maxWorkers, maxBranchDepth) {
  if (!Array.isArray(workers) || workers.length === 0 || workers.length > maxWorkers) throw new Error("workers_invalid");
  const seen = new Set();
  return workers.map((worker) => {
    const workerId = requireIdentifier(worker?.worker_id, "worker_id", 120);
    if (seen.has(workerId)) throw new Error("worker_id_duplicate");
    seen.add(workerId);
    return {
      worker_id: workerId,
      agent_id: requireIdentifier(worker?.agent_id, "agent_id", 120),
      role: ["author", "reviewer", "supervisor", "worker"].includes(worker?.role)
        ? worker.role
        : "worker",
      task: requireText(worker?.task, "task", 4_000),
      dependencies: Array.isArray(worker?.dependencies)
        ? [...new Set(worker.dependencies.map((id) => requireIdentifier(id, "dependency_id", 120)))]
        : [],
      parent_worker_id: worker?.parent_worker_id ? requireIdentifier(worker.parent_worker_id, "parent_worker_id", 120) : null,
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
    const plan = plans.get(requireIdentifier(plan_id, "plan_id", 160));
    if (!plan) throw new Error("plan_not_found");
    if (plan.tenant_id !== requireIdentifier(tenant_id, "tenant_id", 120)) throw new Error("cross_tenant_plan_denied");
    return plan;
  }

  function refresh(plan) {
    const running = plan.workers.filter((worker) => worker.status === "running").length;
    const completed = plan.workers.filter((worker) => worker.status === "completed").length;
    const failed = plan.workers.some((worker) => worker.status === "failed" || worker.status === "quarantined");
    const cancelled = plan.workers.some((worker) => worker.status === "cancelled");
    if (failed) plan.status = "failed";
    else if (cancelled) plan.status = "cancelled";
    else if (completed === plan.workers.length) plan.status = "ready_for_core_join";
    else if (running > 0) plan.status = "running";
    plan.updated_at = now();
  }

  return {
    createPlan({ tenant_id, run_id, workers, max_concurrent = null, review_policy = null }) {
      const tenantId = requireIdentifier(tenant_id, "tenant_id", 120);
      const normalized = normalizeWorkers(workers, workerLimit, depthLimit);
      const requestedConcurrency = max_concurrent === null || max_concurrent === undefined
        ? limit
        : Number(max_concurrent);
      if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1 || requestedConcurrency > limit) {
        throw new Error("max_concurrent_invalid");
      }
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
        run_id: requireIdentifier(run_id, "run_id", 160),
        status: "pending",
        max_concurrent: Math.min(requestedConcurrency, normalized.length),
        max_workers: workerLimit,
        max_branch_depth: depthLimit,
        review_policy: {
          required: review_policy?.required === true,
          independent: review_policy?.independent !== false,
          evidence_required: review_policy?.evidence_required !== false,
        },
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
      const worker = plan.workers.find((item) => item.worker_id === requireIdentifier(worker_id, "worker_id", 120));
      if (!worker) throw new Error("worker_not_found");
      if (worker.status !== "running") throw new Error("worker_not_running");
      const guarded = guardInterAgentEnvelope({
        tenant_id: plan.tenant_id,
        from_agent_id: worker.agent_id,
        to_agent_id: "universal-core",
        thread_id: plan.plan_id,
        body: result,
      });
      if (!guarded.allowed) {
        worker.status = "quarantined";
        worker.result = {
          schema_version: "inter_agent_untrusted_envelope_v1",
          state: "quarantined",
          propagation_allowed: false,
          quarantine: guarded.quarantine,
        };
        refresh(plan);
        return clone(plan);
      }
      worker.status = "completed";
      worker.result = guarded.value && typeof guarded.value === "object" && !Array.isArray(guarded.value) ? guarded.value : {};
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
      if (plan.status === "completed" && plan.core_joined_at) {
        return clone({
          plan_id: plan.plan_id,
          run_id: plan.run_id,
          status: plan.status,
          worker_results: plan.workers.map((worker) => ({
            worker_id: worker.worker_id,
            agent_id: worker.agent_id,
            result: worker.result,
          })),
          core_joined_at: plan.core_joined_at,
        });
      }
      if (plan.status !== "ready_for_core_join") throw new Error("plan_not_ready_for_core_join");
      if (plan.review_policy?.required) {
        const reviewers = plan.workers.filter((worker) => worker.role === "reviewer");
        const authors = plan.workers.filter((worker) => worker.role !== "reviewer");
        if (!reviewers.length || !authors.length) throw new Error("independent_reviewer_quorum_required");
        if (
          plan.review_policy.independent
          && reviewers.some((reviewer) => authors.some((author) => reviewer.agent_id === author.agent_id))
        ) {
          throw new Error("independent_reviewer_identity_required");
        }
        if (
          plan.review_policy.evidence_required
          && reviewers.some((reviewer) => {
            const evidence = reviewer.result?.evidence;
            const digest = String(reviewer.result?.evidence_digest || "");
            return !(Array.isArray(evidence) && evidence.length) && !/^sha256:[a-f0-9]{64}$/.test(digest);
          })
        ) {
          throw new Error("independent_reviewer_evidence_required");
        }
      }
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
      const tenantId = requireIdentifier(tenant_id, "tenant_id", 120);
      if (plan_snapshot.tenant_id !== tenantId) throw new Error("cross_tenant_plan_denied");
      const planId = requireIdentifier(plan_snapshot.plan_id, "plan_id", 160);
      const existing = plans.get(planId);
      if (existing) return clone(existing);
      const workers = normalizeWorkers(plan_snapshot.workers, workerLimit, depthLimit);
      for (const worker of workers) {
        const snapshotWorker = plan_snapshot.workers.find((item) => item?.worker_id === worker.worker_id) || {};
        worker.status = ["pending", "running", "completed", "quarantined", "failed", "cancelled"].includes(snapshotWorker.status) ? snapshotWorker.status : "pending";
        const guarded = guardInterAgentEnvelope({
          tenant_id: tenantId,
          from_agent_id: worker.agent_id,
          to_agent_id: "universal-core",
          thread_id: planId,
          body: snapshotWorker.result,
        });
        worker.result = guarded.allowed
          ? (guarded.value && typeof guarded.value === "object" && !Array.isArray(guarded.value) ? guarded.value : null)
          : {
              schema_version: "inter_agent_untrusted_envelope_v1",
              state: "quarantined",
              propagation_allowed: false,
              quarantine: guarded.quarantine,
            };
        if (!guarded.allowed) worker.status = "quarantined";
        if (snapshotWorker.error) {
          const errorCode = String(snapshotWorker.error).trim();
          worker.error = /^[a-z0-9_.:-]{1,120}$/i.test(errorCode)
            ? errorCode
            : `worker_error_digest:${crypto.createHash("sha256").update(`${tenantId}\u0000${errorCode}`).digest("hex")}`;
        } else {
          worker.error = null;
        }
      }
      const restored = {
        schema_version: "generic_agent_orchestration_v1",
        plan_id: planId,
        tenant_id: tenantId,
        run_id: requireIdentifier(plan_snapshot.run_id, "run_id", 160),
        status: ["pending", "running", "ready_for_core_join", "completed", "failed", "cancelled"].includes(plan_snapshot.status) ? plan_snapshot.status : "pending",
        max_concurrent: Math.min(Number(plan_snapshot.max_concurrent || limit), limit),
        max_workers: workerLimit,
        max_branch_depth: depthLimit,
        review_policy: {
          required: plan_snapshot.review_policy?.required === true,
          independent: plan_snapshot.review_policy?.independent !== false,
          evidence_required: plan_snapshot.review_policy?.evidence_required !== false,
        },
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

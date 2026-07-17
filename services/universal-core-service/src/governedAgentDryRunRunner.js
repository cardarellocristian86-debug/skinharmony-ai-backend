function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function createGovernedAgentDryRunRunner({ queueStore, audit = null, now = () => new Date(), maxJobsPerTick = 2 } = {}) {
  if (!queueStore || typeof queueStore.claim !== "function") throw new Error("queue_store_required");
  const limit = integer(maxJobsPerTick, 2, 1, 3);
  return {
    async tick({ tenant_id }) {
      const expiry = await queueStore.expire({ tenant_id });
      const completed = [];
      for (let index = 0; index < limit; index += 1) {
        const job = await queueStore.claim({ tenant_id });
        if (!job) break;
        const result = { execution_mode: "dry_run", model_invocation: false, tool_invocation: false, external_action: false, completed_at: now().toISOString(), note: "Governed worker simulated; provider execution is disabled." };
        completed.push(await queueStore.complete({ tenant_id, job_id: job.job_id, result }));
        audit?.append?.("governed_agent_queue_dry_run_completed", { tenant_id, job_id: job.job_id, worker_id: job.worker_id });
      }
      return { execution_mode: "dry_run", expired: expiry.expired, completed, metrics: await queueStore.metrics({ tenant_id }) };
    },
  };
}

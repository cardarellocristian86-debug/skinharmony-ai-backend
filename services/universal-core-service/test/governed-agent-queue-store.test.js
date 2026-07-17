import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGovernedAgentQueueStore } from "../src/governedAgentQueueStore.js";

test("durable queue claims dependencies, backs off retries and kills activation branches", () => {
  let current = new Date("2026-07-17T00:00:00.000Z");
  const store = createGovernedAgentQueueStore({ root: path.join(os.tmpdir(), `queue-${Date.now()}-${Math.random()}`), now: () => current });
  store.enqueue({ tenant_id: "queue-a", activation_id: "activation-a", plan_id: "plan-a", deadline_at: "2026-07-17T00:05:00.000Z", workers: [
    { worker_id: "research", agent_id: "research-scout", task: "Research", dependencies: [] },
    { worker_id: "critic", agent_id: "evidence-critic", task: "Critic", dependencies: ["research"] },
  ] });
  const research = store.claim({ tenant_id: "queue-a" });
  assert.equal(research.worker_id, "research");
  const retry = store.fail({ tenant_id: "queue-a", job_id: research.job_id });
  assert.equal(retry.status, "retry_wait");
  current = new Date("2026-07-17T00:00:03.000Z");
  assert.equal(store.claim({ tenant_id: "queue-a" }).worker_id, "research");
  store.complete({ tenant_id: "queue-a", job_id: research.job_id });
  assert.equal(store.claim({ tenant_id: "queue-a" }).worker_id, "critic");
  assert.equal(store.cancelActivation({ tenant_id: "queue-a", activation_id: "activation-a" }).cancelled, 1);
  assert.equal(store.metrics({ tenant_id: "queue-a" }).status_counts.cancelled, 1);
});

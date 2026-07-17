import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGovernedAgentQueueStore } from "../src/governedAgentQueueStore.js";
import { createGovernedAgentDryRunRunner } from "../src/governedAgentDryRunRunner.js";

test("dry-run runner works with the asynchronous queue contract and reaps deadlines", async () => {
  let current = new Date("2026-07-17T00:00:00.000Z");
  const store = createGovernedAgentQueueStore({ root: path.join(os.tmpdir(), `runner-${Date.now()}-${Math.random()}`), now: () => current });
  store.enqueue({ tenant_id: "runner-a", activation_id: "activation-a", plan_id: "plan-a", deadline_at: "2026-07-17T00:05:00.000Z", workers: [
    { worker_id: "research", agent_id: "research-scout", task: "Research", dependencies: [] },
    { worker_id: "critic", agent_id: "evidence-critic", task: "Critic", dependencies: ["research"] },
  ] });
  const runner = createGovernedAgentDryRunRunner({ queueStore: store, now: () => current });
  const outcome = await runner.tick({ tenant_id: "runner-a" });
  assert.equal(outcome.completed.length, 2);
  assert.equal(outcome.completed.every((job) => job.result.execution_mode === "dry_run"), true);
  store.enqueue({ tenant_id: "runner-a", activation_id: "expired-a", plan_id: "expired-plan", deadline_at: "2026-07-17T00:00:01.000Z", workers: [{ worker_id: "late", agent_id: "research-scout", task: "Late", dependencies: [] }] });
  current = new Date("2026-07-17T00:00:02.000Z");
  assert.equal((await runner.tick({ tenant_id: "runner-a" })).expired, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createGovernedAgentPostgresQueueStore } from "../src/governedAgentPostgresQueueStore.js";

test("PostgreSQL queue store fails closed without a dedicated connection string", () => {
  assert.throws(() => createGovernedAgentPostgresQueueStore({}), /governed_agent_database_url_invalid/);
});

test("PostgreSQL queue store creates its isolated schema before metrics", async () => {
  const calls = [];
  const pool = { query: async (query) => { calls.push(query); return { rows: [{ status: "queued", count: 2 }], rowCount: 0 }; } };
  const store = createGovernedAgentPostgresQueueStore({ connectionString: "postgres://governance:test@localhost:5432/nyra", pool });
  const metrics = await store.metrics({ tenant_id: "tenant-a" });
  assert.equal(metrics.job_count, 2);
  assert.equal(calls.some((query) => query.includes("CREATE TABLE IF NOT EXISTS governed_agent_queue_jobs")), true);
});

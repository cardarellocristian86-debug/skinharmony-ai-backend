import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

test("generic agent API persists tenant-scoped checkpoints and evaluates cases", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "generic-agent-admin";
  const { app } = createUniversalCoreService({ storageRoot: path.join(os.tmpdir(), `core-generic-agent-${Date.now()}-${Math.random()}`) });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, pathname, body, key = "generic-agent-admin") => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };

  try {
    const generated = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-generic-agent", preset: "codex_automation" });
    const key = generated.json.key;
    const started = await request("POST", "/v1/generic-agents/runs", {
      agent_id: "researcher",
      task: "Compare generic agent runtimes",
      tools: ["web_search", "knowledge_base"],
    }, key);
    assert.equal(started.status, 201);
    assert.equal(started.json.run.tenant_id, "tenant-generic-agent");

    const checkpointed = await request("POST", `/v1/generic-agents/runs/${started.json.run.run_id}/checkpoint`, {
      checkpoint: { cursor: "sources-collected", state: { sources: 3 }, idempotency_key: "checkpoint-1" },
      expected_revision: 0,
    }, key);
    assert.equal(checkpointed.status, 200);
    assert.equal(checkpointed.json.checkpoint_record.revision, 1);

    const orchestration = await request("POST", `/v1/generic-agents/runs/${started.json.run.run_id}/orchestration`, {
      workers: [
        { worker_id: "research", agent_id: "researcher", task: "Collect sources" },
        { worker_id: "review", agent_id: "reviewer", task: "Review sources", dependencies: ["research"] },
      ],
    }, key);
    assert.equal(orchestration.status, 201);
    const planId = orchestration.json.plan.plan_id;
    const firstClaim = await request("POST", `/v1/generic-agents/orchestration/${planId}/claim`, {}, key);
    assert.deepEqual(firstClaim.json.workers.map((worker) => worker.worker_id), ["research"]);
    await request("POST", `/v1/generic-agents/orchestration/${planId}/workers/research/complete`, { result: { sources: 2 } }, key);
    const secondClaim = await request("POST", `/v1/generic-agents/orchestration/${planId}/claim`, {}, key);
    assert.deepEqual(secondClaim.json.workers.map((worker) => worker.worker_id), ["review"]);
    await request("POST", `/v1/generic-agents/orchestration/${planId}/workers/review/complete`, { result: { approved: true } }, key);
    const joined = await request("POST", `/v1/generic-agents/orchestration/${planId}/join`, {}, key);
    assert.equal(joined.status, 200);
    assert.equal(joined.json.joined.status, "completed");

    const fetched = await request("GET", `/v1/generic-agents/runs/${started.json.run.run_id}`, undefined, key);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.durable_checkpoint.revision, 1);

    const evaluated = await request("POST", "/v1/generic-agents/evaluate", {
      cases: [{ id: "correct-output", expected: { status: "ok" }, actual: { status: "ok" } }],
    }, key);
    assert.equal(evaluated.status, 200);
    assert.equal(evaluated.json.evaluation.passed, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY; else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

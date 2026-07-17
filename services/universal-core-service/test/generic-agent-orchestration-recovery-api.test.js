import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("generic orchestration resumes a claimed plan after Core restart", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "orchestration-recovery-admin";
  const storageRoot = path.join(os.tmpdir(), `core-orchestration-recovery-${Date.now()}-${Math.random()}`);
  let first;
  let second;
  const request = async (base, method, pathname, body, key) => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };
  try {
    first = await listen(createUniversalCoreService({ storageRoot }).app);
    const generated = await request(first.base, "POST", "/v1/keys/generate", { tenant_id: "tenant-plan-recovery", preset: "codex_automation" }, "orchestration-recovery-admin");
    const key = generated.json.key;
    const run = await request(first.base, "POST", "/v1/generic-agents/runs", { agent_id: "planner", task: "Recover plan" }, key);
    const plan = await request(first.base, "POST", `/v1/generic-agents/runs/${run.json.run.run_id}/orchestration`, {
      workers: [{ worker_id: "worker", agent_id: "planner", task: "Finish after restart" }],
    }, key);
    const planId = plan.json.plan.plan_id;
    const claimed = await request(first.base, "POST", `/v1/generic-agents/orchestration/${planId}/claim`, {}, key);
    assert.equal(claimed.json.workers[0].worker_id, "worker");
    await new Promise((resolve) => first.server.close(resolve));
    first = null;

    second = await listen(createUniversalCoreService({ storageRoot }).app);
    const completed = await request(second.base, "POST", `/v1/generic-agents/orchestration/${planId}/workers/worker/complete`, { result: { restored: true } }, key);
    assert.equal(completed.status, 200);
    const joined = await request(second.base, "POST", `/v1/generic-agents/orchestration/${planId}/join`, {}, key);
    assert.equal(joined.status, 200);
    assert.equal(joined.json.joined.status, "completed");
  } finally {
    if (first) await new Promise((resolve) => first.server.close(resolve));
    if (second) await new Promise((resolve) => second.server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

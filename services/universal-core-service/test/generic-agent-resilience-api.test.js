import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

test("generic orchestration cancellation is tenant-scoped and terminal", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "generic-resilience-admin";
  const { app } = createUniversalCoreService({ storageRoot: path.join(os.tmpdir(), `core-generic-resilience-${Date.now()}-${Math.random()}`) });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, pathname, body, key) => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };
  try {
    const first = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-resilience-a", preset: "codex_automation" }, "generic-resilience-admin");
    const second = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-resilience-b", preset: "codex_automation" }, "generic-resilience-admin");
    const started = await request("POST", "/v1/generic-agents/runs", { agent_id: "planner", task: "Cancel safely" }, first.json.key);
    const plan = await request("POST", `/v1/generic-agents/runs/${started.json.run.run_id}/orchestration`, {
      workers: [{ worker_id: "worker", agent_id: "planner", task: "Pending work" }],
    }, first.json.key);
    const planId = plan.json.plan.plan_id;
    const denied = await request("POST", `/v1/generic-agents/orchestration/${planId}/cancel`, {}, second.json.key);
    assert.equal(denied.status, 400);
    const cancelled = await request("POST", `/v1/generic-agents/orchestration/${planId}/cancel`, {}, first.json.key);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.plan.status, "cancelled");
    const claimed = await request("POST", `/v1/generic-agents/orchestration/${planId}/claim`, {}, first.json.key);
    assert.equal(claimed.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

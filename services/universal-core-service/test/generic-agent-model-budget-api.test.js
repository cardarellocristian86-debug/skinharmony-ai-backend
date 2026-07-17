import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

test("generic model budgets fail closed before model calls across complex tenant scenarios", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "model-budget-admin";
  const { app } = createUniversalCoreService({ storageRoot: path.join(os.tmpdir(), `core-model-budget-${Date.now()}-${Math.random()}`) });
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
    const tenantA = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-budget-a", preset: "codex_automation" }, "model-budget-admin");
    const tenantB = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-budget-b", preset: "codex_automation" }, "model-budget-admin");
    const run = await request("POST", "/v1/generic-agents/runs", {
      agent_id: "scenario-coordinator",
      task: "Evaluate two complex scenario variants",
      model_budget: { max_model_calls: 2, max_total_tokens: 100 },
    }, tenantA.json.key);
    assert.equal(run.status, 201);
    const runId = run.json.run.run_id;

    const first = await request("POST", `/v1/generic-agents/runs/${runId}/model-reservations`, { model_id: "gpt-test", estimated_tokens: 40 }, tenantA.json.key);
    const second = await request("POST", `/v1/generic-agents/runs/${runId}/model-reservations`, { model_id: "gpt-test", estimated_tokens: 60 }, tenantA.json.key);
    const exhausted = await request("POST", `/v1/generic-agents/runs/${runId}/model-reservations`, { model_id: "gpt-test", estimated_tokens: 1 }, tenantA.json.key);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(exhausted.status, 429);

    const crossTenant = await request("POST", `/v1/generic-agents/runs/${runId}/model-reservations`, { model_id: "gpt-test", estimated_tokens: 1 }, tenantB.json.key);
    assert.equal(crossTenant.status, 400);

    const defaultBudgetRun = await request("POST", "/v1/generic-agents/runs", { agent_id: "safe-default", task: "No model budget supplied" }, tenantA.json.key);
    const defaultDenied = await request("POST", `/v1/generic-agents/runs/${defaultBudgetRun.json.run.run_id}/model-reservations`, { model_id: "gpt-test", estimated_tokens: 1 }, tenantA.json.key);
    assert.equal(defaultDenied.status, 429);

    const metrics = await request("GET", "/v1/generic-agents/metrics", undefined, tenantA.json.key);
    assert.equal(metrics.status, 200);
    assert.equal(metrics.json.metrics.model_usage.model_calls, 2);
    assert.equal(metrics.json.metrics.model_usage.reserved_tokens, 100);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

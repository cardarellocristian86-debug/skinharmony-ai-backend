import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

test("governed research workflow enforces tenant daily worker budget and deadline", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "operational-budget-admin";
  const { app } = createUniversalCoreService({ storageRoot: path.join(os.tmpdir(), `operational-budget-${Date.now()}-${Math.random()}`) });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, pathname, body, key) => { const response = await fetch(`${base}${pathname}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, json: await response.json() }; };
  try {
    const tenantA = await call("POST", "/v1/keys/generate", { tenant_id: "ops-a", preset: "codex_automation" }, "operational-budget-admin");
    const tenantB = await call("POST", "/v1/keys/generate", { tenant_id: "ops-b", preset: "codex_automation" }, "operational-budget-admin");
    const activation = await call("POST", "/v1/generic-agents/activations", { trigger: "manual", task: "Bounded operational research" }, tenantA.json.key);
    const workflow = await call("POST", `/v1/generic-agents/activations/${activation.json.activation.activation_id}/research-workflow`, { deadline_ms: 120000 }, tenantA.json.key);
    assert.equal(workflow.status, 201);
    assert.equal(workflow.json.workflow.operational_budget.workers, 3);
    assert.equal(workflow.json.workflow.operational_budget.deadline_ms, 120000);
    assert.equal(workflow.json.workflow.telemetry.zombie_branches, 0);
    const budgetA = await call("GET", "/v1/generic-agents/operational-budget", undefined, tenantA.json.key);
    const budgetB = await call("GET", "/v1/generic-agents/operational-budget", undefined, tenantB.json.key);
    assert.equal(budgetA.json.budget.workflows, 1);
    assert.equal(budgetB.json.budget.workflows, 0);
    const badActivation = await call("POST", "/v1/generic-agents/activations", { trigger: "manual", task: "Invalid deadline" }, tenantA.json.key);
    const badDeadline = await call("POST", `/v1/generic-agents/activations/${badActivation.json.activation.activation_id}/research-workflow`, { deadline_ms: 999999 }, tenantA.json.key);
    assert.equal(badDeadline.status, 400);
  } finally { await new Promise((resolve) => server.close(resolve)); if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY; else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin; }
});

import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

function createServer(storageRoot) {
  const { app } = createUniversalCoreService({ storageRoot });
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

test("durable Nyra research workflow survives restart and remains dry-run tenant-scoped", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "phase-b-admin";
  const storageRoot = path.join(os.tmpdir(), `phase-b-${Date.now()}-${Math.random()}`);
  const call = async (base, method, pathname, body, key) => {
    const response = await fetch(`${base}${pathname}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  let first;
  let second;
  try {
    first = await createServer(storageRoot);
    const tenantA = await call(first.base, "POST", "/v1/keys/generate", { tenant_id: "phase-b-a", preset: "codex_automation" }, "phase-b-admin");
    const tenantB = await call(first.base, "POST", "/v1/keys/generate", { tenant_id: "phase-b-b", preset: "codex_automation" }, "phase-b-admin");
    const activation = await call(first.base, "POST", "/v1/generic-agents/activations", { trigger: "schedule", task: "Research durable multi-agent controls", idempotency_key: "phase-b-daily" }, tenantA.json.key);
    assert.equal(activation.status, 201);
    const workflow = await call(first.base, "POST", `/v1/generic-agents/activations/${activation.json.activation.activation_id}/research-workflow`, {}, tenantA.json.key);
    assert.equal(workflow.status, 201);
    assert.deepEqual(workflow.json.plan.workers.map((worker) => worker.agent_id), ["research-scout", "evidence-critic", "nyra-supervisor"]);
    assert.equal(workflow.json.workflow.model_invocation, false);
    const crossTenant = await call(first.base, "GET", `/v1/generic-agents/activations/${activation.json.activation.activation_id}`, undefined, tenantB.json.key);
    assert.equal(crossTenant.status, 404);
    await new Promise((resolve) => first.server.close(resolve));
    first = null;

    second = await createServer(storageRoot);
    const reused = await call(second.base, "POST", "/v1/generic-agents/activations", { trigger: "schedule", task: "Research durable multi-agent controls", idempotency_key: "phase-b-daily" }, tenantA.json.key);
    assert.equal(reused.status, 200);
    assert.equal(reused.json.restored_from_durable_activation, true);
    const workflowAfterRestart = await call(second.base, "POST", `/v1/generic-agents/activations/${activation.json.activation.activation_id}/research-workflow`, {}, tenantA.json.key);
    assert.equal(workflowAfterRestart.status, 200);
    assert.equal(workflowAfterRestart.json.reused, true);
    assert.equal(workflowAfterRestart.json.plan.plan_id, workflow.json.plan.plan_id);
  } finally {
    if (first) await new Promise((resolve) => first.server.close(resolve));
    if (second) await new Promise((resolve) => second.server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

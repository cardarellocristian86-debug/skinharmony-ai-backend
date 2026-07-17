import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

test("governed agent registry creates idempotent Nyra dry-run activations without model spend", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "governed-agent-admin";
  const { app } = createUniversalCoreService({ storageRoot: path.join(os.tmpdir(), `governed-agent-${Date.now()}-${Math.random()}`) });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, pathname, body, key) => {
    const response = await fetch(`${base}${pathname}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  try {
    const tenantA = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-supervisor-a", preset: "codex_automation" }, "governed-agent-admin");
    const tenantB = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-supervisor-b", preset: "codex_automation" }, "governed-agent-admin");
    const registry = await request("GET", "/v1/generic-agents/registry", undefined, tenantA.json.key);
    assert.equal(registry.status, 200);
    assert.equal(registry.json.agents.find((agent) => agent.agent_id === "nyra-supervisor").role, "supervisor");

    const payload = { agent_id: "nyra-supervisor", trigger: "schedule", task: "Prepare a bounded competitor research plan", idempotency_key: "daily-research-2026-07-17" };
    const first = await request("POST", "/v1/generic-agents/activations", payload, tenantA.json.key);
    assert.equal(first.status, 201);
    assert.equal(first.json.activation.status, "dry_run_ready");
    assert.equal(first.json.activation.execution.model_invocation, false);
    assert.equal(first.json.run.model_budget.max_model_calls, 0);

    const duplicate = await request("POST", "/v1/generic-agents/activations", payload, tenantA.json.key);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.json.reused, true);
    assert.equal(duplicate.json.run.run_id, first.json.run.run_id);

    const missingKey = await request("POST", "/v1/generic-agents/activations", { agent_id: "nyra-supervisor", trigger: "schedule", task: "Unsafe schedule" }, tenantA.json.key);
    assert.equal(missingKey.status, 400);
    const invalidRoleTrigger = await request("POST", "/v1/generic-agents/activations", { agent_id: "research-scout", trigger: "schedule", task: "Bypass supervisor", idempotency_key: "bad-research" }, tenantA.json.key);
    assert.equal(invalidRoleTrigger.status, 400);
    const metricsB = await request("GET", "/v1/generic-agents/metrics", undefined, tenantB.json.key);
    assert.equal(metricsB.status, 200);
    assert.equal(metricsB.json.metrics.run_count, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

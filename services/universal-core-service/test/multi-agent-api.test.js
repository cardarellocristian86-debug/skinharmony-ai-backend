import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

test("multi-agent endpoints are tenant-scoped and reject client domain-pack escalation", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "multi-agent-admin";
  const { app } = createUniversalCoreService({ storageRoot: path.join(os.tmpdir(), `core-multi-agent-${Date.now()}-${Math.random()}`) });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, pathname, body, key = "multi-agent-admin") => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };
  try {
    const generated = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-agent-a", preset: "nyra_core_360_connector" });
    const key = generated.json.key;
    const registry = await request("GET", "/v1/agents/registry", undefined, key);
    assert.equal(registry.status, 200);
    assert.equal(registry.json.agents.some((agent) => agent.id === "beauty_protocol_advisor"), false);

    const plan = await request("POST", "/v1/agents/plan", { text: "Crea una variante Core e valida il piano", create_variant: true, require_evaluation: true }, key);
    assert.equal(plan.status, 200);
    assert.equal(plan.json.tenant_id, "tenant-agent-a");
    assert.equal(plan.json.execution_authorized, false);
    assert(plan.json.selection.some((agent) => agent.id === "core_variant_designer"));
    assert(plan.json.credit_control.model_calls_budget <= 2);

    const escalated = await request("POST", "/v1/agents/plan", { domain_pack_id: "analyzer", text: "Interpreta analisi" }, key);
    assert.equal(escalated.status, 403);
    assert.equal(escalated.json.error, "domain_pack_override_denied");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY; else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

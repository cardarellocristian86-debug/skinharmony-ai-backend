import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";
import { runDigestV1Canonical } from "../src/coreRuntimeHierarchy.js";

async function fixture(run) {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "operational-api-admin";
  const coreRuntime = { digest: async (input) => runDigestV1Canonical(input), status: () => ({ configured: true, running: true }) };
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `core-operational-${Date.now()}-${Math.random()}`),
    coreRuntime,
    coreRuntimeMode: "active",
    coreRuntimeCanaryPercent: 100,
    coreCapabilitySigningSecret: "operational-api-signing-secret",
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, pathname, body, key = "operational-api-admin") => {
    const response = await fetch(`${base}${pathname}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  try { await run(request); } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY; else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
}

test("AI Gateway returns hierarchy, signed envelope and tenant utilization", async () => fixture(async (request) => {
  const generated = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-operational", preset: "nyra_core_360_connector" });
  const key = generated.json.key;
  const gateway = await request("POST", "/v1/adapters/codex/gateway", {
    mode: "advisory",
    user_request: "Analizza in sola lettura",
    llm_output: "Nessuna modifica richiesta.",
    requested_action: { type: "review", label: "Review" },
    runtime_routing: { risk: 5, irreversibility: 0, sensitivity: 0, ambiguity: 0.9, data_quality: 0.95 },
  }, key);
  assert.equal(gateway.status, 200);
  assert.equal(gateway.json.core_operational.hierarchy.router.route, "V2");
  assert.equal(gateway.json.core_operational.hierarchy.selected_authority, "V2");
  assert.equal(gateway.json.core_operational.envelope.tenant_id, "tenant-operational");
  assert.equal(gateway.json.core_operational.envelope.signature.length, 64);
  assert.equal(gateway.json.core_operational.utilization.components.hierarchy_coverage_percent, 100);

  const status = await request("GET", "/v1/runtime/utilization", undefined, key);
  assert.equal(status.status, 200);
  assert.equal(status.json.tenant_id, "tenant-operational");
  assert.equal(status.json.counters.requests, 1);

  const legacyStatus = await request("GET", "/api/universal-core/status", undefined, key);
  assert.equal(legacyStatus.status, 200);
  assert.equal(legacyStatus.json.runtime.hierarchy_version, "core_runtime_hierarchy_v1");

  const decisionId = gateway.json.core_operational.envelope.decision_id;
  const outcome = await request("POST", "/v1/intelligence/outcomes/record", {
    outcome_id: "operational-outcome-1",
    decision_id: decisionId,
    prediction_id: decisionId,
    predicted_probability: 0.8,
    actual_outcome: true,
  }, key);
  assert.equal(outcome.status, 201);
  assert.equal(outcome.json.core_operational_outcome.linked, true);
  assert.equal(outcome.json.core_operational_outcome.utilization.components.verified_outcome_closure_percent, 100);
}));

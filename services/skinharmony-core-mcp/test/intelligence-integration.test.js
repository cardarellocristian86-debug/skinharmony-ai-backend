import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../../universal-core-service/src/app.js";
import { createApp } from "../src/app.js";
import { createCoreHandlers } from "../src/core-handlers.js";

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("ChatGPT MCP executes a full tenant-scoped intelligence and calibration cycle", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "mcp-integration-admin";
  const core = await listen(createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `core-mcp-intelligence-${Date.now()}-${Math.random()}`),
  }).app);
  let mcp;
  try {
    const generated = await fetch(`${core.url}/v1/keys/generate`, {
      method: "POST",
      headers: { authorization: "Bearer mcp-integration-admin", "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "tenant-integrated", preset: "nyra_core_360_connector" }),
    }).then((response) => response.json());
    assert.equal(generated.ok, true);

    const config = {
      publicUrl: "http://127.0.0.1",
      resource: "http://127.0.0.1/mcp",
      auth0Issuer: "",
      auth0Audience: "",
      jwksUri: "",
      codexKeys: ["chatgpt-test-token"],
      codexScopes: ["core:read", "core:govern"],
      supportedScopes: ["core:read", "core:govern"],
      universalCoreUrl: core.url,
      universalCoreKey: "",
      universalCoreKeys: { "tenant-integrated": generated.key },
      defaultTenantId: "tenant-integrated",
    };
    const handlers = createCoreHandlers(config, {
      contextProvider: async (_input, identity) => ({
        schema_version: "tenant_memory_context_v1",
        tenant_id: identity.tenantId,
        revision: 12,
        relevant_memories: [{ kind: "verified_fact", value: "campaign evidence available" }],
      }),
    });
    mcp = await listen(createApp(config, { handlers }));

    const call = async (name, args) => {
      const response = await fetch(`${mcp.url}/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer chatgpt-test-token", "content-type": "application/json", "mcp-session-id": "mcp-intelligence-integration" },
        body: JSON.stringify({ jsonrpc: "2.0", id: name, method: "tools/call", params: { name, arguments: args } }),
      });
      assert.equal(response.status, 200);
      const rpc = await response.json();
      assert.equal(rpc.error, undefined, JSON.stringify(rpc.error));
      return rpc.result.structuredContent;
    };

    const workflow = await call("intelligence_workflow", {
      request: "Valuta il lancio e seleziona la strategia con il miglior rapporto valore-rischio",
      hypotheses: [
        { id: "demand_growth", label: "La domanda cresce", prior_probability: 0.55, evidence: [{ direction: "support", strength: 0.8, reliability: 0.9 }] },
        { id: "demand_flat", label: "La domanda resta stabile", prior_probability: 0.45, evidence: [{ direction: "against", strength: 0.4, reliability: 0.7 }] },
      ],
      options: [
        { id: "controlled_launch", label: "Lancio controllato", probability: 0.72, value: 88, cost: 30, risk: 24, reversibility: 90 },
        { id: "full_launch", label: "Lancio totale", probability: 0.61, value: 100, cost: 48, risk: 65, reversibility: 30 },
      ],
      generate_scenarios: true,
    });
    assert.equal(workflow.tenant_id, "tenant-integrated");
    assert.equal(workflow.execution_allowed, false);
    assert.equal(workflow.memory_context.revision, 12);
    assert.equal(workflow.result.decision.selected_option.id, "controlled_launch");
    assert.equal(workflow.result.scenarios.scenarios.length, 3);
    assert.equal(workflow.result.decision.ranking[0].memory_context_usage.recalled, true);
    assert.equal(workflow.result.decision.ranking[0].memory_context_usage.verified_items, 1);
    assert.equal(workflow.intelligence_path.core_analyzed, true);
    assert.equal(workflow.intelligence_path.nyra_interpreted, true);
    assert.equal(workflow.intelligence_path.execution_allowed, false);
    assert.equal(workflow.nyra_interpretation.ok, true);

    const recorded = await call("outcome_record", {
      outcome_id: "launch-week-one",
      prediction_id: "controlled-launch-success",
      domain: "commercial_launch",
      horizon: "one_week",
      predicted_probability: 0.72,
      actual_outcome: true,
      notes: "Metriche verificate dopo la prima settimana",
    });
    assert.equal(recorded.tenant_id, "tenant-integrated");
    assert.equal(recorded.outcome.brier_score, 0.0784);

    const calibration = await call("calibration_status", { limit: 20 });
    assert.equal(calibration.tenant_id, "tenant-integrated");
    assert.equal(calibration.calibration.sample_size, 1);
    assert.equal(calibration.calibration.by_domain[0].key, "commercial_launch");
    assert.equal(calibration.calibration.by_horizon[0].key, "one_week");
  } finally {
    if (mcp) await close(mcp.server);
    await close(core.server);
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

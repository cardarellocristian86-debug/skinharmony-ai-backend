import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../../universal-core-service/src/app.js";
import { createCoreHandlers } from "../src/core-handlers.js";

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test("generic agent MCP handlers run a tenant-scoped lifecycle through Core", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "generic-mcp-admin";
  const core = await listen(createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `core-mcp-generic-agent-${Date.now()}-${Math.random()}`),
  }).app);
  try {
    const generated = await fetch(`${core.url}/v1/keys/generate`, {
      method: "POST",
      headers: { authorization: "Bearer generic-mcp-admin", "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: "tenant-generic-mcp", preset: "codex_automation" }),
    }).then((response) => response.json());
    const handlers = createCoreHandlers({
      universalCoreUrl: core.url,
      universalCoreKey: "",
      universalCoreKeys: { "tenant-generic-mcp": generated.key },
      defaultTenantId: "tenant-generic-mcp",
    });
    const identity = { tenantId: "tenant-generic-mcp", role: "standard", godMode: false };

    const started = (await handlers.generic_agent_start({
      agent_id: "planner",
      task: "Prepare a governed generic agent plan",
      tools: ["knowledge_search"],
    }, identity)).structuredContent;
    assert.equal(started.run.tenant_id, "tenant-generic-mcp");

    const checkpointed = (await handlers.generic_agent_checkpoint({
      run_id: started.run.run_id,
      checkpoint: { state: { phase: "planned" }, cursor: "ready" },
      expected_revision: 0,
    }, identity)).structuredContent;
    assert.equal(checkpointed.checkpoint_record.revision, 1);

    const fetched = (await handlers.generic_agent_run_read({ run_id: started.run.run_id }, identity)).structuredContent;
    assert.equal(fetched.durable_checkpoint.revision, 1);

    const evaluation = (await handlers.generic_agent_evaluate({
      cases: [{ id: "plan-valid", expected: { valid: true }, actual: { valid: true } }],
    }, identity)).structuredContent;
    assert.equal(evaluation.evaluation.passed, true);
  } finally {
    await new Promise((resolve) => core.server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

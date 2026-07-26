import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

async function call(base, method, pathname, body, key) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test("work preflight issues a tenant-bound non-executing Core research directive", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "research-directive-admin";
  const storageRoot = path.join(os.tmpdir(), `core-research-directive-${Date.now()}-${Math.random()}`);
  const { app } = createUniversalCoreService({ storageRoot });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const tenantA = await call(base, "POST", "/v1/keys/generate", { tenant_id: "directive-a", preset: "codex_automation" }, "research-directive-admin");
    const tenantB = await call(base, "POST", "/v1/keys/generate", { tenant_id: "directive-b", preset: "codex_automation" }, "research-directive-admin");
    assert.equal(tenantA.status, 201);
    assert.equal(tenantB.status, 201);
    const body = {
      request: "Verifica la normativa attuale prima della pubblicazione",
      operation_type: "publish",
      evidence_state: {
        source_count: 1,
        confidence: 0.4,
        freshness_state: "stale",
        contradiction_count: 1,
      },
      memory_context: {
        schema_version: "tenant_memory_context_v1",
        tenant_id: "directive-a",
        revision: 1,
        relevant_memories: [],
        pending_handoffs: [],
      },
    };
    const result = await call(base, "POST", "/v1/work/preflight", body, tenantA.json.key);
    assert.equal(result.status, 200);
    const directive = result.json.work_preflight.core_research.directive;
    assert.equal(directive.tenant_scope.tenant_id, "directive-a");
    assert.equal(directive.issued_by, "universal_core");
    assert.equal(directive.authority.research_execution_authorized, false);
    assert.equal(directive.authority.consolidation_authorized, false);

    const crossTenantBody = {
      ...body,
      memory_context: { ...body.memory_context, tenant_id: "directive-a" },
    };
    const denied = await call(base, "POST", "/v1/work/preflight", crossTenantBody, tenantB.json.key);
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error, "memory_context_tenant_mismatch");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

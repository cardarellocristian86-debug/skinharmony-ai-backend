import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

async function startService() {
  const previousAdminKey = process.env.CORE_SERVICE_ADMIN_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.CORE_SERVICE_ADMIN_KEY = "software-intelligence-test-admin";
  process.env.NODE_ENV = "test";
  const storageRoot = path.join(os.tmpdir(), `software-intelligence-api-${Date.now()}-${Math.random()}`);
  const { app } = createUniversalCoreService({ storageRoot });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      if (previousAdminKey === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
      else process.env.CORE_SERVICE_ADMIN_KEY = previousAdminKey;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    },
  };
}

async function api(base, method, route, body, key = "software-intelligence-test-admin") {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test("software intelligence API enforces entitlement and authorization without persisting raw bytes", async () => {
  const service = await startService();
  try {
    const internal = await api(service.base, "POST", "/v1/keys/generate", {
      tenant_id: "tenant-software-lab",
      brand_scope: "software-lab",
      preset: "codex_automation",
      tier: "internal",
    });
    assert.equal(internal.status, 201);

    const limited = await api(service.base, "POST", "/v1/keys/generate", {
      tenant_id: "tenant-limited",
      brand_scope: "limited",
      key_type: "connector",
      allowed_scopes: ["read:decision"],
      tier: "base",
    });
    assert.equal(limited.status, 201);

    const denied = await api(service.base, "GET", "/v1/software-intelligence/components", undefined, limited.json.key);
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error, "branch_not_allowed");

    const components = await api(service.base, "GET", "/v1/software-intelligence/components", undefined, internal.json.key);
    assert.equal(components.status, 200);
    assert.equal(components.json.manifest.desktop_application_required, false);

    const missingAuthorization = await api(service.base, "POST", "/v1/software-intelligence/analyze", {
      artifact: { name: "sample.bin", content_base64: Buffer.from("sample").toString("base64") },
    }, internal.json.key);
    assert.equal(missingAuthorization.status, 400);
    assert.equal(missingAuthorization.json.error, "software_analysis_authorization_assertion_required");

    const analyzed = await api(service.base, "POST", "/v1/software-intelligence/analyze", {
      artifact: { name: "sample.bin", content_base64: Buffer.from("sample artifact").toString("base64") },
      authorization: { asserted: true, basis: "owned", purpose: "testing" },
    }, internal.json.key);
    assert.equal(analyzed.status, 200);
    assert.equal(analyzed.json.analysis.executable.format, "unknown");
    assert.equal(analyzed.json.analysis.artifact.raw_content_persisted, false);
    assert.equal(analyzed.json.guardrail.execution_allowed, false);
    assert(!JSON.stringify(analyzed.json).includes(Buffer.from("sample artifact").toString("base64")));

    const queued = await api(service.base, "POST", "/v1/software-intelligence/jobs", {
      mode: "lightweight_static",
      artifact: { name: "sample.bin", content_base64: Buffer.from("sample artifact").toString("base64") },
      authorization: { asserted: true, basis: "owned", purpose: "testing" },
    }, internal.json.key);
    assert.equal(queued.status, 202);
    assert.equal(queued.json.job.tenant_id, "tenant-software-lab");
    assert.equal(queued.json.job.raw_artifact_persisted, false);

    const crossTenant = await api(service.base, "POST", "/v1/software-intelligence/jobs", {
      tenant_id: "tenant-other",
      mode: "lightweight_static",
      artifact: { name: "sample.bin", content_base64: Buffer.from("sample artifact").toString("base64") },
      authorization: { asserted: true, basis: "owned", purpose: "testing" },
    }, internal.json.key);
    assert.equal(crossTenant.status, 403);
    assert.equal(crossTenant.json.error, "tenant_scope_denied");

    const arbitraryFrida = await api(service.base, "POST", "/v1/software-intelligence/jobs", {
      mode: "frida_local_agent",
      target: "process:demo",
      template_id: "observe_module_loads_v1",
      javascript: "send('arbitrary')",
      authorization: { asserted: true, basis: "owned", purpose: "testing", owner_confirmed: true },
      core_governance: { authorized: true, target_allowlist: ["process:demo"] },
    }, internal.json.key);
    assert.equal(arbitraryFrida.status, 400);
    assert.equal(arbitraryFrida.json.error, "software_core_authorization_required");
  } finally {
    await service.close();
  }
});

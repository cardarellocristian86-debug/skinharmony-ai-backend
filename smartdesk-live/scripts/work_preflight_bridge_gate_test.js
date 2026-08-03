"use strict";

const assert = require("node:assert");
const { UniversalCoreBridge } = require("../src/UniversalCoreBridge");

(async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error("network must not be reached without preflight");
  };
  try {
    const bridge = new UniversalCoreBridge({
      baseUrl: "http://core.test",
      apiKey: "test-core-key",
      tenantId: "tenant_privilege",
      preflightTtlMs: 1_000,
    });
    const blocked = await bridge.decision({ domain: "smartdesk" });
    assert.strictEqual(blocked.success, false);
    assert.strictEqual(blocked.code, "work_preflight_required");
    assert.strictEqual(blocked.execution_allowed, false);
    assert.strictEqual(calls, 0);

    const preflight = {
      schema_version: "skinharmony_work_preflight_v1",
      preflight_id: "preflight_cache_test",
      mandatory: true,
      tenant_id: "tenant_privilege",
      operational_surface: "tenant_work_gallery",
      tenant_work_gallery: {
        schema_version: "tenant_work_gallery_v1",
        tenant_id: "tenant_privilege",
        available: true,
        state: "ready",
      },
      memory_first: { status: "recalled" },
      governance: { execution_allowed_by_preflight: true },
    };
    bridge.rememberWorkPreflight(preflight);
    assert.strictEqual(bridge.getWorkPreflight().preflight_id, "preflight_cache_test");
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.strictEqual(bridge.getWorkPreflight(), null);
    const expired = await bridge.decision({ domain: "smartdesk" });
    assert.strictEqual(expired.code, "work_preflight_required");
    assert.strictEqual(calls, 0);
    console.log(JSON.stringify({ ok: true, runner: "work_preflight_bridge_gate_test" }, null, 2));
  } finally {
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

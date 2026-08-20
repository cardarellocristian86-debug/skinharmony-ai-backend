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
      security_governance: {
        schema_version: "nyra_core_security_gate_v1",
        always_on: true,
        fail_closed: true,
        core_verdict_required: true,
        source_instructions_are_data: true,
        cross_tenant_blocked: true,
      },
    };
    const scopeA = { center_id: "center-a", user_id: "user-a", session_id: "session-a" };
    const scopeB = { center_id: "center-b", user_id: "user-b", session_id: "session-b" };
    assert.strictEqual(bridge.rememberWorkPreflight(preflight), false);
    assert.strictEqual(bridge.getWorkPreflight(), null);
    assert.strictEqual(bridge.rememberWorkPreflight(preflight, scopeA), true);
    assert.strictEqual(bridge.getWorkPreflight(scopeA).preflight_id, "preflight_cache_test");
    assert.strictEqual(bridge.getWorkPreflight(scopeB), null);
    assert.strictEqual(bridge.getWorkPreflight(scopeA, { consume: true }).preflight_id, "preflight_cache_test");
    assert.strictEqual(bridge.getWorkPreflight(scopeA), null);
    bridge.establishWorkPreflight = async () => null;
    const foreignScope = await bridge.decision({ domain: "smartdesk", _preflight_scope: scopeB });
    assert.strictEqual(foreignScope.code, "work_preflight_required");
    const forged = await bridge.decision({
      domain: "smartdesk",
      _preflight_scope: scopeB,
      work_preflight: { ...preflight, preflight_id: "attacker-controlled" }
    });
    assert.strictEqual(forged.code, "work_preflight_required");
    assert.strictEqual(bridge.getWorkPreflight(scopeB), null);
    assert.strictEqual(bridge.rememberWorkPreflight({ ...preflight, tenant_id: "foreign" }, scopeA), false);
    assert.strictEqual(bridge.rememberWorkPreflight({ ...preflight, security_governance: null }, scopeA), false);
    bridge.rememberWorkPreflight(preflight, scopeA);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.strictEqual(bridge.getWorkPreflight(scopeA), null);
    const expired = await bridge.decision({ domain: "smartdesk", _preflight_scope: scopeA });
    assert.strictEqual(expired.code, "work_preflight_required");
    assert.strictEqual(calls, 0);

    const issuedBridge = new UniversalCoreBridge({
      baseUrl: "http://core.test",
      apiKey: "test-core-key",
      tenantId: "tenant_privilege"
    });
    const paths = [];
    issuedBridge.request = async (method, path) => {
      paths.push(`${method}:${path}`);
      if (path === "/v1/work/preflight") {
        return { ok: true, work_preflight: { ...preflight, preflight_id: `issued-${paths.length}` } };
      }
      return { success: true };
    };
    const issued = await issuedBridge.decision({ domain: "smartdesk", _preflight_scope: scopeA });
    assert.strictEqual(issued.success, true);
    assert.deepStrictEqual(paths, ["POST:/v1/work/preflight", "POST:/v1/decision"]);
    console.log(JSON.stringify({ ok: true, runner: "work_preflight_bridge_gate_test" }, null, 2));
  } finally {
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

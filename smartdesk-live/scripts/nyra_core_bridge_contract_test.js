"use strict";

const assert = require("node:assert");
const { UniversalCoreBridge } = require("../src/UniversalCoreBridge");

const originalFetch = global.fetch;

global.fetch = async (url, options = {}) => {
  assert.strictEqual(url, "http://core.test/v1/nira/core-bridge");
  assert.strictEqual(options.method, "POST");
  assert.strictEqual(options.headers.Authorization, "Bearer test-core-key");
  assert.strictEqual(options.headers["X-SH-Tenant-ID"], "tenant_privilege");
  const body = JSON.parse(options.body || "{}");
  assert.strictEqual(body.target_system, "smartdesk");
  assert.deepStrictEqual(body.available_capabilities, ["smartdesk_ui"]);
  assert.strictEqual(body.domain_pack, undefined);
  assert.strictEqual(body.owner_confirmed, undefined);
  assert.strictEqual(body.metadata.contract, "smartdesk_nyra_core_bridge_v1");
  assert(!JSON.stringify(body).includes("customer@example.test"));
  assert(!JSON.stringify(body).includes("secret=do-not-send"));
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ ok: true, result: { deep_nyra_runtime: { execution_allowed: false } } });
    }
  };
};

(async () => {
  try {
    const bridge = new UniversalCoreBridge({
      baseUrl: "http://core.test/",
      apiKey: "test-core-key",
      tenantId: "tenant_privilege",
      brandScope: "skinharmony",
    });
    const result = await bridge.nyraInterpret({
      question: "Leggi agenda per customer@example.test token=secret=do-not-send",
      mode: "gold",
      centerScope: "center-a",
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.result.deep_nyra_runtime.execution_allowed, false);
    console.log(JSON.stringify({ ok: true, runner: "nyra_core_bridge_contract_test" }, null, 2));
  } finally {
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

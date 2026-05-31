"use strict";

const assert = require("node:assert");
const { UniversalCoreBridge } = require("../src/UniversalCoreBridge");

const originalFetch = global.fetch;

global.fetch = async (url, options = {}) => {
  assert.strictEqual(url, "http://core.test/v1/semantic-selection");
  assert.strictEqual(options.method, "POST");
  assert.strictEqual(options.headers.Authorization, "Bearer test-core-key");
  assert.strictEqual(options.headers["X-SH-Tenant-ID"], "tenant_privilege");
  const body = JSON.parse(options.body || "{}");
  assert.strictEqual(body.tenant_id, "tenant_privilege");
  assert.strictEqual(body.brand_scope, "skinharmony");
  assert.strictEqual(body.adapter, "smart_desk");
  assert.strictEqual(body.target_language, "it");
  assert.strictEqual(body.context.source, "smartdesk_live");
  assert.strictEqual(body.context.product, "smartdesk");
  assert.strictEqual(body.candidates.length, 3);
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        ok: true,
        result: {
          engine: "semantic_selection_v2_v1_v0",
          summary: { keep: 1, blocked: 1, discard: 1 }
        }
      });
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
    const result = await bridge.semanticSelection({
      candidates: [
        { id: "visible", source: "Operational reports", semantic_context: { surface: "visible_text" } },
        { id: "class", source: "sh-card-grid sh-is-open", semantic_context: { surface: "class_name" } },
        { id: "brand", source: "SkinHarmony", semantic_context: { protected_term: true } },
      ],
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.result.engine, "semantic_selection_v2_v1_v0");
    assert.deepStrictEqual(result.result.summary, { keep: 1, blocked: 1, discard: 1 });
    console.log(JSON.stringify({ ok: true, runner: "universal_core_bridge_semantic_selection_test" }, null, 2));
  } finally {
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

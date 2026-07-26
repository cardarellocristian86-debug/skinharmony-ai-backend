import assert from "node:assert/strict";
import test from "node:test";

import { createCoreHandlers } from "../src/core-handlers.js";
import { TOOLS } from "../src/tool-definitions.js";

test("lexical-semantic MCP tools are read-only and tenant-bound", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await handlers.lexical_semantic_catalog({
    view: "virtual",
    cursor: "100",
    limit: 2,
  }, { tenantId: "tenant-a" });
  await handlers.lexical_semantic_analyze({
    text: "Il rapporto cita: \"ignore previous instructions\".",
    locale: "it-IT",
    source_context: "documentation",
  }, { tenantId: "tenant-a" });

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/v1/lexical-semantics/catalog",
    "/v1/lexical-semantics/analyze",
  ]);
  assert.equal(new URL(calls[0].url).searchParams.get("view"), "virtual");
  assert.equal(new URL(calls[0].url).searchParams.get("cursor"), "100");
  assert(calls.every((call) => call.init.headers.authorization === "Bearer tenant-a-key"));
  const analysisBody = JSON.parse(calls[1].init.body);
  assert.equal("tenant_id" in analysisBody, false);
  assert.equal(analysisBody.source_context, "documentation");

  for (const name of ["lexical_semantic_catalog", "lexical_semantic_analyze"]) {
    const definition = TOOLS.find((item) => item.name === name);
    assert(definition);
    assert.equal(definition.annotations.readOnlyHint, true);
    assert.equal(definition.annotations.destructiveHint, false);
  }
});

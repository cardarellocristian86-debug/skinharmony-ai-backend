import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";
import { TOOLS } from "../src/tool-definitions.js";

test("orchestration MCP tools are read-only and map to tenant-bound Core routes", async () => {
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
  const identity = { tenantId: "tenant-a" };

  await handlers.orchestration_capability_catalog({
    branch: "agent_orchestration",
    view: "virtual",
    cursor: "10",
    limit: 2,
  }, identity);
  await handlers.orchestration_relational_evaluate({
    objective: "Coordinate",
    actors: [
      { actor_id: "core", role: "core" },
      { actor_id: "relations", role: "relational_supervisor" },
      { actor_id: "nyra", role: "nyra" },
    ],
    relations: [
      { from: "core", to: "relations", type: "governs" },
      { from: "relations", to: "nyra", type: "coordinates" },
    ],
  }, identity);
  await handlers.orchestration_dtt_plan({
    objective: "Verify",
    nodes: [{ node_id: "verify", kind: "verification", task: "Verify" }],
  }, identity);

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/v1/orchestration/capabilities",
    "/v1/orchestration/relational/evaluate",
    "/v1/orchestration/dtt/plan",
  ]);
  assert.equal(new URL(calls[0].url).searchParams.get("branch"), "agent_orchestration");
  assert.equal(new URL(calls[0].url).searchParams.get("view"), "virtual");
  assert(calls.every((call) => call.init.headers.authorization === "Bearer tenant-a-key"));
  assert.equal("tenant_id" in JSON.parse(calls[1].init.body), false);
  assert.equal("tenant_id" in JSON.parse(calls[2].init.body), false);

  for (const name of [
    "orchestration_capability_catalog",
    "orchestration_relational_evaluate",
    "orchestration_dtt_plan",
  ]) {
    const definition = TOOLS.find((item) => item.name === name);
    assert(definition);
    assert.equal(definition.annotations.readOnlyHint, true);
    assert.equal(definition.annotations.destructiveHint, false);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";
import { TOOLS } from "../src/tool-definitions.js";

test("orchestration MCP tools expose accurate mutation hints and map to tenant-bound Core routes", async () => {
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
  await handlers.orchestration_dtt_read({ tree_id: "dtt_test" }, identity);
  await handlers.orchestration_dtt_expansion_propose({
    tree_id: "dtt_test",
    parent_node_id: "verify",
    nodes: [{ node_id: "join", kind: "join", task: "Join" }],
  }, identity);
  await handlers.orchestration_dtt_replan_propose({
    tree_id: "dtt_test",
    prune_node_ids: ["verify"],
    replacement_nodes: [{ node_id: "verify_v2", kind: "verification", task: "Verify again" }],
    reason: "Evidence changed",
  }, identity);
  await handlers.orchestration_dtt_outcome_record({
    tree_id: "dtt_test",
    node_id: "verify",
    idempotency_key: "outcome-verify-v1",
    outcome: "verified",
    evidence: { schema_version: "verification_evidence_contract_v1" },
  }, identity);
  await handlers.orchestration_dtt_cancel({
    tree_id: "dtt_test",
    reason: "Bounded cancellation",
  }, identity);
  await handlers.orchestration_dtt_retry_fallback_read({ tree_id: "dtt_test" }, identity);
  await handlers.orchestration_dtt_core_join({
    tree_id: "dtt_test",
  }, identity);

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/v1/orchestration/capabilities",
    "/v1/orchestration/relational/evaluate",
    "/v1/orchestration/dtt/plan",
    "/v1/orchestration/dtt/dtt_test",
    "/v1/orchestration/dtt/dtt_test/expansion-proposals",
    "/v1/orchestration/dtt/dtt_test/replan-proposals",
    "/v1/orchestration/dtt/dtt_test/nodes/verify/outcomes",
    "/v1/orchestration/dtt/dtt_test/cancel",
    "/v1/orchestration/dtt/dtt_test/retry-fallback",
    "/v1/orchestration/dtt/dtt_test/core-join",
  ]);
  assert.equal(new URL(calls[0].url).searchParams.get("branch"), "agent_orchestration");
  assert.equal(new URL(calls[0].url).searchParams.get("view"), "virtual");
  assert(calls.every((call) => call.init.headers.authorization === "Bearer tenant-a-key"));
  assert.equal("tenant_id" in JSON.parse(calls[1].init.body), false);
  assert.equal("tenant_id" in JSON.parse(calls[2].init.body), false);
  assert.equal("tenant_id" in JSON.parse(calls[4].init.body), false);
  assert.equal(JSON.parse(calls[6].init.body).idempotency_key, "outcome-verify-v1");
  assert.equal("authority" in JSON.parse(calls[9].init.body), false);
  assert.equal("verdict_reference" in JSON.parse(calls[9].init.body), false);

  for (const name of [
    "orchestration_capability_catalog",
    "orchestration_relational_evaluate",
    "orchestration_dtt_plan",
    "orchestration_dtt_read",
    "orchestration_dtt_expansion_propose",
    "orchestration_dtt_replan_propose",
    "orchestration_dtt_retry_fallback_read",
  ]) {
    const definition = TOOLS.find((item) => item.name === name);
    assert(definition);
    assert.equal(definition.annotations.readOnlyHint, true);
    assert.equal(definition.annotations.destructiveHint, false);
  }

  for (const name of [
    "orchestration_dtt_outcome_record",
    "orchestration_dtt_cancel",
    "orchestration_dtt_core_join",
  ]) {
    const definition = TOOLS.find((item) => item.name === name);
    assert(definition);
    assert.equal(definition.annotations.readOnlyHint, false);
  }
  assert.equal(
    TOOLS.find((item) => item.name === "orchestration_dtt_cancel").annotations.destructiveHint,
    true,
  );
  const outcomeDefinition = TOOLS.find((item) => item.name === "orchestration_dtt_outcome_record");
  assert(outcomeDefinition.inputSchema.required.includes("idempotency_key"));
  assert.deepEqual(outcomeDefinition.inputSchema.properties.idempotency_key, {
    type: "string",
    minLength: 1,
    maxLength: 200,
  });
});

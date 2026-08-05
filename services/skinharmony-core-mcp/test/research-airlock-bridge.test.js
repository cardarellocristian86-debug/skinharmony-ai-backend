import assert from "node:assert/strict";
import test from "node:test";

import { createCoreHandlers } from "../src/core-handlers.js";
import { TOOLS } from "../src/tool-definitions.js";
import { researchAirlockToolMetadata } from "../src/research-airlock-reference-monitor.js";

function responseFor(pathname) {
  return new Response(JSON.stringify({ ok: true, decision: { verdict: "ALLOW" }, pathname }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("MCP exposes the server-side Airlock FSM and binds the authenticated logical session", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    defaultTenantId: "owner-private",
  }, {
    fetchImpl: async (url, init) => { calls.push({ url, init }); return responseFor(new URL(url).pathname); },
  });
  const identity = { tenantId: "tenant-a", agentPresence: { session_id: "server-session" } };
  const supplied = { project_id: "project-a", work_id: "work-airlock", session_id: "caller-session" };
  const planCapability = `rap_${"0".repeat(8)}-${"0".repeat(4)}-${"0".repeat(4)}-${"0".repeat(4)}-${"0".repeat(12)}.${"a".repeat(64)}`;

  await handlers.nyra_research_airlock_status({}, identity);
  await handlers.nyra_research_airlock_bootstrap({ work_binding: supplied, source_urls: ["https://www.nist.gov/ai"] }, identity);
  await handlers.nyra_research_airlock_plan({ work_binding: supplied, source_urls: ["https://www.nist.gov/ai"] }, identity);
  await handlers.nyra_research_airlock_open({ work_binding: supplied, plan_capability: planCapability }, identity);
  await handlers.nyra_research_airlock_discover({ work_binding: supplied, url: "https://www.nist.gov/", method: "GET" }, identity);
  await handlers.nyra_research_airlock_seal({ work_binding: supplied }, identity);
  await handlers.nyra_research_airlock_private_enter({ work_binding: supplied, private_entry_capability: `rac_${"0".repeat(8)}-${"0".repeat(4)}-${"0".repeat(4)}-${"0".repeat(4)}-${"0".repeat(12)}.${"a".repeat(64)}` }, identity);
  await handlers.nyra_research_airlock_complete({ work_binding: supplied }, identity);

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/v1/research/airlock/status",
    "/v1/research/airlock/plan",
    "/v1/research/airlock/work",
    "/v1/research/airlock/plan",
    "/v1/research/airlock/work",
    "/v1/research/airlock/discover",
    "/v1/research/airlock/seal",
    "/v1/research/airlock/private-entry",
    "/v1/research/airlock/complete",
  ]);
  for (const call of calls.slice(1)) {
    const body = JSON.parse(call.init.body);
    assert.equal(body.tenant_id, "tenant-a");
    assert.equal(body.work_binding.session_id, "server-session");
  }
});

test("Airlock definitions never accept raw documents or caller-claimed egress booleans", () => {
  const names = [
    "nyra_research_airlock_status",
    "nyra_research_airlock_bootstrap",
    "nyra_research_airlock_plan",
    "nyra_research_airlock_open",
    "nyra_research_airlock_discover",
    "nyra_research_airlock_seal",
    "nyra_research_airlock_private_enter",
    "nyra_research_airlock_tool_authorize",
    "nyra_research_airlock_complete",
  ];
  for (const name of names) assert(TOOLS.some((tool) => tool.name === name), `missing ${name}`);
  const plan = TOOLS.find((tool) => tool.name === "nyra_research_airlock_plan");
  assert.equal(plan.inputSchema.properties.source_urls.items.format, "uri");
  assert.equal(plan.inputSchema.properties.plan_digest, undefined);
  const bootstrap = TOOLS.find((tool) => tool.name === "nyra_research_airlock_bootstrap");
  assert.equal(bootstrap.inputSchema.properties.plan_capability, undefined);
  assert.equal(bootstrap._meta["skinharmony/ownerConfirmationRequired"], false);
  const open = TOOLS.find((tool) => tool.name === "nyra_research_airlock_open");
  assert.equal(open.inputSchema.properties.source_urls, undefined);
  assert.equal(open.inputSchema.properties.plan_digest, undefined);
  assert.match(open.inputSchema.properties.plan_capability.pattern, /rap_/);
  const discover = TOOLS.find((tool) => tool.name === "nyra_research_airlock_discover");
  assert.deepEqual(discover.inputSchema.properties.method.enum, ["GET", "HEAD"]);
  assert.equal("content" in discover.inputSchema.properties, false);
  assert.equal("html" in discover.inputSchema.properties, false);
  assert.equal("headers" in discover.inputSchema.properties, false);
  assert.equal(discover.annotations.openWorldHint, true);
  const privateEntry = TOOLS.find((tool) => tool.name === "nyra_research_airlock_private_enter");
  assert.equal("web_access_enabled" in privateEntry.inputSchema.properties, false);
  assert.equal("redirects_enabled" in privateEntry.inputSchema.properties, false);
});

test("reference monitor derives open-world and dynamic classification from server tools", () => {
  assert.equal(researchAirlockToolMetadata("workspace_read_document", {}, TOOLS).open_world, false);
  assert.equal(researchAirlockToolMetadata("nyra_v2_evidence_prepare", {}, TOOLS).open_world, true);
  assert.deepEqual(
    researchAirlockToolMetadata("core_capability_invoke", { capability_id: "future_external_capability" }, TOOLS),
    { tool_name: "future_external_capability", transport_tool_name: "core_capability_invoke", open_world: true },
  );
});

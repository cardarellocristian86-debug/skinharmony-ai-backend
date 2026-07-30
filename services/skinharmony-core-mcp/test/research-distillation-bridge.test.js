import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";
import { TOOLS } from "../src/tool-definitions.js";

const WORKSPACE_ID = "rw_00000000-0000-0000-0000-000000000001";
const CORE_KEY = crypto.randomBytes(32).toString("hex");

function responseFor(pathname) {
  return new Response(JSON.stringify({ ok: true, tenant_id: "tenant-a", pathname }), {
    status: pathname === "/v1/research/workspaces/open" ? 201 : 200,
    headers: { "content-type": "application/json" },
  });
}

test("MCP Research Distillation bridge is tenant-bound and candidate-only", async () => {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": CORE_KEY },
    defaultTenantId: "owner-private",
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return responseFor(new URL(url).pathname);
    },
  });
  const identity = { tenantId: "tenant-a" };
  const evidence = [{
    source_id: "nist",
    canonical_url: "https://www.nist.gov/example",
    title: "NIST reference",
    claim_summary: "The official reference supports the bounded claim.",
  }];

  await handlers.nyra_research_distillation_status({}, identity);
  await handlers.nyra_research_source_registry({}, identity);
  await handlers.nyra_research_learning_pack({ branch_id: "research_evidence" }, identity);
  await handlers.nyra_research_envelope_authorize({
    request_id: "research-one",
    question: "Which official evidence applies?",
    branch_ids: ["research_evidence"],
    allowed_source_ids: ["nist"],
  }, identity);
  await handlers.nyra_research_workspace_open({
    envelope_id: "rae_00000000-0000-0000-0000-000000000001",
  }, identity);
  await handlers.nyra_research_workspace_attach({ workspace_id: WORKSPACE_ID, evidence }, identity);
  await handlers.nyra_research_distill({
    workspace_id: WORKSPACE_ID,
    evidence,
    lesson: "Only verified official evidence is reusable.",
    persist_verified: true,
  }, identity);
  await handlers.nyra_research_workspace_close({ workspace_id: WORKSPACE_ID }, identity);
  await handlers.nyra_research_cleanup({}, identity);

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/v1/research/status",
    "/v1/research/source-registry",
    "/v1/research/learning-packs",
    "/v1/research/envelope/authorize",
    "/v1/research/workspaces/open",
    "/v1/research/workspaces/attach",
    "/v1/research/distill",
    "/v1/research/workspaces/close",
    "/v1/research/cleanup",
  ]);
  assert.equal(new URL(calls[2].url).searchParams.get("branch_id"), "research_evidence");
  assert(calls.every((call) => call.init.headers.authorization === `Bearer ${CORE_KEY}`));
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].init.method, "GET");
  for (const call of calls.slice(3)) {
    assert.equal(JSON.parse(call.init.body).tenant_id, "tenant-a");
  }
  assert.equal(JSON.parse(calls[6].init.body).persist_verified, false);
});

test("MCP publishes bounded Research Distillation tools with no persistence input", () => {
  const names = new Set(TOOLS.map((tool) => tool.name));
  for (const name of [
    "nyra_research_distillation_status",
    "nyra_research_source_registry",
    "nyra_research_learning_pack",
    "nyra_research_envelope_authorize",
    "nyra_research_workspace_open",
    "nyra_research_workspace_attach",
    "nyra_research_distill",
    "nyra_research_workspace_close",
    "nyra_research_cleanup",
  ]) {
    assert(names.has(name), `missing ${name}`);
  }
  const distill = TOOLS.find((tool) => tool.name === "nyra_research_distill");
  assert.deepEqual(distill.scopes, ["core:govern"]);
  assert.equal(distill.annotations.readOnlyHint, false);
  assert.equal("persist_verified" in distill.inputSchema.properties, false);
  const open = TOOLS.find((tool) => tool.name === "nyra_research_workspace_open");
  assert.deepEqual(open.scopes, ["core:govern"]);
  assert.equal(open.annotations.readOnlyHint, false);
  assert.equal(open.annotations.openWorldHint, false);
  const authorize = TOOLS.find((tool) => tool.name === "nyra_research_envelope_authorize");
  assert.deepEqual(authorize.scopes, ["core:govern"]);
  const attach = TOOLS.find((tool) => tool.name === "nyra_research_workspace_attach");
  assert.deepEqual(attach.scopes, ["core:govern"]);
  const cleanup = TOOLS.find((tool) => tool.name === "nyra_research_cleanup");
  assert.equal(cleanup.annotations.destructiveHint, true);
});

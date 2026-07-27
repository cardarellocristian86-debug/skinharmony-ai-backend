import assert from "node:assert/strict";
import test from "node:test";

import { CORE_CONNECTOR_CAPABILITIES, readCoreCapabilityCatalog } from "../src/core-capability-catalog.js";
import { createCoreHandlers } from "../src/core-handlers.js";
import { TOOLS } from "../src/tool-definitions.js";

function ownerIdentity(overrides = {}) {
  return {
    tenantId: "tenant-a",
    kind: "codex",
    role: "owner_root",
    godMode: true,
    ownerConfirmed: true,
    confirmationReference: "owner-confirmed-connector-v014",
    ...overrides,
  };
}

function harness() {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init, body: init.body ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { calls, handlers };
}

test("catalog classifies connector capabilities and excludes arbitrary/admin invocation", () => {
  const catalog = readCoreCapabilityCatalog({ limit: 100 });
  assert.equal(catalog.schema_version, "core_connector_capabilities_v2");
  assert.equal(catalog.core_final_authority, true);
  assert.equal(catalog.arbitrary_route_invocation_allowed, false);
  assert(catalog.internal_surfaces.some((surface) => surface.group === "administration"));
  assert(CORE_CONNECTOR_CAPABILITIES.length >= 20);
  for (const item of CORE_CONNECTOR_CAPABILITIES) {
    const definition = TOOLS.find((tool) => tool.name === item.tool);
    assert(definition, `missing tool definition for ${item.tool}`);
    assert(!Object.hasOwn(definition.inputSchema.properties || {}, "tenant_id"));
    assert(!Object.hasOwn(definition.inputSchema.properties || {}, "url"));
    assert(!Object.hasOwn(definition.inputSchema.properties || {}, "key"));
  }
});

test("read capability handlers bind tenant server-side and route only to enumerated Core paths", async () => {
  const { calls, handlers } = harness();
  const identity = { tenantId: "tenant-a" };

  await handlers.core_capability_catalog({ group: "branches" }, identity);
  await handlers.core_branch_registry({ view: "authorized", branches: ["ramo_testo"] }, identity);
  await handlers.core_branch_analyze({ branch: "ramo_testo", request: "Review this copy" }, identity);
  await handlers.core_control_plane_read({ view: "connector_manifest" }, identity);
  await handlers.core_evidence_recent({ limit: 7 }, identity);
  await handlers.core_semantic_select({ candidates: [{ id: "one", text: "Uno" }] }, identity);
  await handlers.core_claim_guard_check({ text: "test" }, identity);
  await handlers.core_pricing_guard_check({
    official_prices: [{ id: "sku-1", price: 10 }],
    observed_prices: [{ id: "sku-1", price: 10 }],
  }, identity);
  await handlers.core_release_manifest_check({
    manifest: {
      version: "1.0.0",
      channel: "stable",
      package_url: "https://example.test/release.zip",
      checksum_sha256: "a".repeat(64),
      rollback_url: "https://example.test/rollback",
      signed: true,
    },
  }, identity);
  await handlers.core_software_intelligence_jobs({ job_id: "job_123" }, identity);
  await handlers.core_entity_graph_read({}, identity);
  await handlers.core_review_pending({}, identity);

  assert.deepEqual(calls.map((call) => call.url.pathname), [
    "/v1/branches/authorized",
    "/v1/branches/ramo_testo/analyze",
    "/v1/connectors/sdk/manifest",
    "/v1/evidence/recent",
    "/v1/semantic-selection",
    "/v1/claim-guard/check",
    "/v1/pricing-guard/check",
    "/v1/releases/manifest/check",
    "/v1/software-intelligence/jobs/job_123",
    "/v1/entity-graph",
    "/v1/review/pending",
  ]);
  assert.equal(calls[0].url.searchParams.get("branches"), "ramo_testo");
  assert.equal(calls[3].url.searchParams.get("limit"), "7");
  assert(calls.every((call) => call.init.headers.authorization === "Bearer tenant-a-key"));
  assert(calls.filter((call) => call.body).every((call) => !Object.hasOwn(call.body, "tenant_id")));
});

test("governed graph and review writes require verified explicit owner confirmation", async () => {
  const { calls, handlers } = harness();
  await assert.rejects(
    handlers.core_entity_graph_upsert({ entities: [], relations: [] }, { tenantId: "tenant-a" }),
    /owner_confirmation_required/,
  );
  await assert.rejects(
    handlers.core_review_action({ review_id: "review-1", action: "approve" }, ownerIdentity({ ownerConfirmed: false })),
    /owner_confirmation_required/,
  );
  assert.equal(calls.length, 0);

  await handlers.core_entity_graph_upsert({ entities: [], relations: [] }, ownerIdentity());
  await handlers.core_review_action({ review_id: "review-1", action: "approve" }, ownerIdentity());
  assert.deepEqual(calls.map((call) => call.url.pathname), ["/v1/entity-graph/upsert", "/v1/review/action"]);
  assert(calls.every((call) => call.body.owner_context?.owner_verified === true));
  assert(calls.every((call) => call.body.confirmation_reference === "owner-confirmed-connector-v014"));
});

test("new write tools advertise owner confirmation while all analytical tools remain read-only", () => {
  for (const item of CORE_CONNECTOR_CAPABILITIES) {
    const definition = TOOLS.find((tool) => tool.name === item.tool);
    assert.equal(definition.annotations.readOnlyHint, !item.mutation, item.tool);
    if (item.mutation) {
      assert.equal(definition._meta["skinharmony/ownerConfirmationRequired"], true, item.tool);
    }
  }
});

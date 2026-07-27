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

function harness(configOverrides = {}) {
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
    ...configOverrides,
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

test("bridge derives and signs client exposure context without trusting owner role or payload labels", async () => {
  const { calls, handlers } = harness({
    ownerContextSigningSecret: "test-owner-context-signing-secret-1234567890",
  });
  await handlers.core_branch_registry({ view: "registry" }, {
    tenantId: "tenant-a",
    kind: "oauth",
    role: "owner_root",
    godMode: true,
    serverClientType: "admin",
    scopes: ["core:read", "owner:root"],
  });
  const encoded = calls[0].init.headers["x-sh-client-context"];
  assert(encoded);
  const context = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.equal(context.tenant_id, "tenant-a");
  assert.equal(context.client_type, "chatgpt");
  assert.equal(context.audience, "chatgpt_connector");
  assert.match(context.assertion, /^mcc_[a-f0-9]{64}$/);
});

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

test("AI learning factory capabilities stay dynamic, tenant-bound and governed", async () => {
  const ids = [
    "ai_eval_scorecard_read",
    "ai_eval_dataset_read",
    "ai_eval_trace_read",
    "ai_performance_scorecard_read",
    "ai_experiment_read",
    "ai_learning_candidate_read",
    "ai_learning_candidate_review",
    "ai_learning_outcome_record",
  ];
  const definitions = ids.map((id) => TOOLS.find((tool) => tool.name === id));
  assert(definitions.every(Boolean));
  assert(definitions.slice(0, 6).every((tool) => tool.annotations.readOnlyHint === true));
  assert(definitions.slice(6).every((tool) =>
    tool.annotations.readOnlyHint === false &&
    tool._meta["skinharmony/ownerConfirmationRequired"] === true &&
    tool.inputSchema.properties.idempotency_key,
  ));

  const { calls, handlers } = harness();
  const reader = { tenantId: "tenant-a" };
  await handlers.ai_eval_scorecard_read({ release_version: "0.16.0", limit: 5 }, reader);
  await handlers.ai_learning_candidate_read({ state: "review_required" }, reader);
  const owner = ownerIdentity();
  await handlers.ai_learning_candidate_review({
    candidate_id: "candidate_one",
    review_action: "defer",
    expected_version: 1,
    evidence_digest: `sha256:${"a".repeat(64)}`,
    rationale: "Needs another independent evaluation.",
    idempotency_key: "review-candidate-one",
    owner_confirmed: true,
    confirmation_reference: "owner-reviewed-candidate-one",
  }, owner);
  await handlers.ai_learning_outcome_record({
    outcome_id: "outcome_one",
    candidate_id: "candidate_one",
    outcome_status: "abstained",
    outcome_verified: true,
    evidence_digest: `sha256:${"b".repeat(64)}`,
    policy_snapshot: "policy_snapshot_one",
    rollback_reference: "rollback-one",
    idempotency_key: "outcome-candidate-one",
    owner_confirmed: true,
    confirmation_reference: "owner-recorded-outcome-one",
  }, owner);

  assert.deepEqual(calls.map((call) => call.url.pathname), [
    "/v1/ai-learning/eval/scorecards",
    "/v1/ai-learning/candidates",
    "/v1/ai-learning/candidates/review",
    "/v1/ai-learning/outcomes",
  ]);
  assert.equal(calls[0].url.searchParams.get("release_version"), "0.16.0");
  assert.equal(calls[0].url.searchParams.get("limit"), "5");
  assert(calls.every((call) => call.init.headers.authorization === "Bearer tenant-a-key"));
  assert(calls.slice(2).every((call) => call.body.owner_context?.owner_verified === true));
  assert.equal(TOOLS.filter((tool) => [
    "core_health",
    "work_preflight",
    "core_capability_catalog",
    "core_branch_registry",
    "core_semantic_select",
    "core_capability_read",
    "core_capability_invoke",
    "tenant_provider_openai_status",
    "tenant_provider_openai_setup_panel",
    "tenant_provider_openai_setup_link",
    "tenant_provider_openai_multi_agent_smoke_run",
    "tenant_provider_openai_multi_agent_run_read",
    "tenant_provider_openai_multi_agent_run_cancel",
  ].includes(tool.name)).length, 13);
});

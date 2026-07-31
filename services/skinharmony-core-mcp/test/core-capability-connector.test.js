import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { CORE_CONNECTOR_CAPABILITIES, readCoreCapabilityCatalog } from "../src/core-capability-catalog.js";
import { createCoreHandlers } from "../src/core-handlers.js";
import { COMPACT_MCP_TOOL_NAMES } from "../src/dynamic-capability-router.js";
import { TOOLS } from "../src/tool-definitions.js";
import { WORK_CONTINUITY_TOOLS } from "../src/work-continuity-tools.js";
import { mountAiLearningFactoryRoutes } from "../../universal-core-service/src/aiLearningFactoryRoutes.js";
import { createResourceVisibilityBinding } from "../../universal-core-service/src/resourceVisibility.js";

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

function aiLearningRouteBridge() {
  const routes = [];
  const app = {
    get(path, ...handlers) { routes.push({ method: "GET", path, handlers }); },
    post(path, ...handlers) { routes.push({ method: "POST", path, handlers }); },
  };
  const storeCalls = [];
  const visibility = (branchId) => createResourceVisibilityBinding({
    tenant_id: "tenant-a",
    branch_ids: [branchId],
    origin_context: {
      tenant_id: "tenant-a",
      client_type: "codex",
      audience: "codex_internal",
      entitlements: [],
    },
    created_at: "2026-07-27T12:00:00.000Z",
  });
  const learningStore = {
    async readEvaluationScorecard(input) {
      storeCalls.push({ method: "readEvaluationScorecard", input });
      return { scorecard_id: input.record_id, release_version: "0.16.0" };
    },
    async listEvaluationScorecards(input) {
      storeCalls.push({ method: "listEvaluationScorecards", input });
      return [{ scorecard_id: "scorecard-v016", release_version: "0.16.0" }];
    },
    async readDatasetMetadata(input) {
      storeCalls.push({ method: "readDatasetMetadata", input });
      return { dataset_id: input.record_id, dataset_version: "v1" };
    },
    async listDatasetMetadata(input) {
      storeCalls.push({ method: "listDatasetMetadata", input });
      return [{ dataset_id: "dataset-v1", dataset_version: "v1" }];
    },
    async readPerformanceScorecard(input) {
      storeCalls.push({ method: "readPerformanceScorecard", input });
      return { performance_scorecard_id: input.record_id, release_version: "0.16.0" };
    },
    async listPerformanceScorecards(input) {
      storeCalls.push({ method: "listPerformanceScorecards", input });
      return [{ performance_scorecard_id: "performance-v016", release_version: "0.16.0" }];
    },
    async readCausalExperiment(input) {
      storeCalls.push({ method: "readCausalExperiment", input });
      return { experiment_id: input.record_id, status: "shadow" };
    },
    async listCausalExperiments(input) {
      storeCalls.push({ method: "listCausalExperiments", input });
      return [{ experiment_id: "experiment-v016", status: "shadow" }];
    },
    async readLearningCandidate(input) {
      storeCalls.push({ method: "readLearningCandidate", input });
      return {
        candidate_id: input.record_id,
        candidate_version: "v1",
        candidate_type: "dataset",
        revision: 1,
        status: "under_review",
        evidence_digest: "evidence-v016",
        dataset_id: "dataset-v1",
        dataset_version: "v1",
        scorecard_id: "scorecard-v016",
        experiment_id: "experiment-v016",
        rollback_reference: "rollback-v016",
        resource_visibility: visibility("learning_data_governance"),
      };
    },
    async listLearningCandidates(input) {
      storeCalls.push({ method: "listLearningCandidates", input });
      return [{
        candidate_id: "candidate-v016",
        status: "under_review",
        resource_visibility: visibility("learning_data_governance"),
      }];
    },
    async reviewLearningCandidate(input) {
      storeCalls.push({ method: "reviewLearningCandidate", input });
      return {
        candidate_id: input.candidate_id,
        status: input.decision,
        revision: input.expected_revision + 1,
      };
    },
    async recordLearningOutcome(input) {
      storeCalls.push({ method: "recordLearningOutcome", input });
      return {
        ...input.record,
        revision: input.expected_revision + 1,
      };
    },
  };
  const telemetryStore = {
    async read(input) {
      storeCalls.push({ method: "telemetry.read", input });
      return {
        run_id: input.run_id,
        trace_id: "trace-v016",
        resource_visibility: visibility("ai_evaluation_intelligence"),
      };
    },
    async list(input) {
      storeCalls.push({ method: "telemetry.list", input });
      return [{
        run_id: "run-v016",
        trace_id: "trace-v016",
        resource_visibility: visibility("ai_evaluation_intelligence"),
      }];
    },
  };
  mountAiLearningFactoryRoutes({
    app,
    readAuth() {},
    governAuth() {},
    telemetryStore,
    learningStore,
    audit: { append() {} },
    resolveGovernanceProof() {
      return {
        core_verdict: "ALLOW",
        owner_confirmed: true,
        scopes: ["core:govern"],
        audit_reference: "audit-route-bridge",
        rollback_reference: "rollback-route-bridge",
      };
    },
    resolveRequestContext() {
      return { clientType: "codex", audience: "codex_internal" };
    },
    issueReviewBinding(input) {
      storeCalls.push({ method: "issueReviewBinding", input });
      const bindingDigest = `sha256:${"d".repeat(64)}`;
      return {
        schema_version: "ai_learning_review_binding_receipt_v0_16",
        tenant_id: input.tenant_id,
        candidate_id: input.candidate.candidate_id,
        candidate_version: input.candidate.candidate_version,
        source_revision: input.expected_revision,
        resulting_revision: input.expected_revision + 1,
        decision: input.decision,
        issued_at: "2026-07-27T12:00:00.000Z",
        expires_at: "2026-07-27T12:05:00.000Z",
        nonce: `airn_${"a".repeat(32)}`,
        binding_digest: bindingDigest,
        evidence_snapshot_digest: `sha256:${"e".repeat(64)}`,
        signature: `airr_${"f".repeat(64)}`,
        binding: {
          payload: {
            schema_version: "ai_learning_candidate_review_binding_v0_16",
            source_revision: input.expected_revision,
            resulting_revision: input.expected_revision + 1,
          },
          binding_content: "{\"schema_version\":\"ai_learning_candidate_review_binding_v0_16\"}",
          binding_digest: bindingDigest,
        },
      };
    },
  });

  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const route = routes.find((item) => item.method === init.method && item.path === parsed.pathname);
    assert(route, `missing mounted route ${init.method} ${parsed.pathname}`);
    const requestHeaders = Object.fromEntries(
      Object.entries(init.headers || {}).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const req = {
      tenantId: "tenant-a",
      query: Object.fromEntries(parsed.searchParams),
      body: init.body ? JSON.parse(init.body) : {},
      get(name) { return requestHeaders[String(name).toLowerCase()] || ""; },
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };
    await route.handlers.at(-1)(req, res);
    return new Response(JSON.stringify(res.payload), {
      status: res.statusCode,
      headers: { "content-type": "application/json" },
    });
  };
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, { fetchImpl });
  return { handlers, storeCalls };
}

test("bridge derives and signs client exposure context without trusting owner role or payload labels", async () => {
  const tenantContextSigningSecret = "test-tenant-context-signing-secret-1234567890";
  const ownerContextSigningSecret = "test-owner-context-signing-secret-1234567890";
  const { calls, handlers } = harness({
    tenantContextSigningSecret,
    ownerContextSigningSecret,
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
  const { assertion: _assertion, ...unsignedContext } = context;
  const canonical = JSON.stringify({
    ...unsignedContext,
    entitlements: [...unsignedContext.entitlements].sort(),
  });
  const tenantAssertion = `mcc_${crypto.createHmac("sha256", tenantContextSigningSecret)
    .update(`mcp-client-context\u0000${canonical}`)
    .digest("hex")}`;
  const ownerAssertion = `mcc_${crypto.createHmac("sha256", ownerContextSigningSecret)
    .update(`mcp-client-context\u0000${canonical}`)
    .digest("hex")}`;
  assert.equal(context.assertion, tenantAssertion);
  assert.notEqual(context.assertion, ownerAssertion);
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
    "ai_learning_review_binding_preview",
    "ai_learning_candidate_review",
    "ai_learning_outcome_record",
  ];
  const definitions = ids.map((id) => TOOLS.find((tool) => tool.name === id));
  assert(definitions.every(Boolean));
  assert(definitions.slice(0, 7).every((tool) => tool.annotations.readOnlyHint === true));
  assert(definitions.slice(7).every((tool) =>
    tool.annotations.readOnlyHint === false &&
    tool._meta["skinharmony/ownerConfirmationRequired"] === true &&
    tool.inputSchema.properties.idempotency_key,
  ));

  const { calls, handlers } = harness();
  const reader = { tenantId: "tenant-a" };
  await handlers.ai_eval_scorecard_read({ release_version: "0.16.0", limit: 5 }, reader);
  await handlers.ai_learning_candidate_read({ state: "review_required" }, reader);
  await handlers.ai_learning_review_binding_preview({
    candidate_id: "candidate_one",
    decision: "approved_for_shadow",
    expected_revision: 1,
  }, reader);
  const owner = ownerIdentity();
  await handlers.ai_learning_candidate_review({
    candidate_id: "candidate_one",
    decision: "deferred",
    expected_revision: 1,
    review_note: "Needs another independent evaluation.",
    idempotency_key: "review-candidate-one",
    owner_confirmed: true,
    confirmation_reference: "owner-reviewed-candidate-one",
  }, owner);
  await handlers.ai_learning_outcome_record({
    outcome: {
      outcome_id: "outcome_one",
      run_id: "run_one",
      candidate_id: "candidate_one",
      candidate_version: "v1",
      candidate_revision: 1,
      outcome_status: "abstained",
      outcome_verified: true,
      human_review_status: "approved",
      evidence_digest: `sha256:${"b".repeat(64)}`,
      policy_snapshot: "policy_snapshot_one",
      observed_at: "2026-07-27T12:00:00.000Z",
      learning_value: 0.7,
    },
    expected_revision: 0,
    idempotency_key: "outcome-candidate-one",
    owner_confirmed: true,
    confirmation_reference: "owner-recorded-outcome-one",
  }, owner);

  assert.deepEqual(calls.map((call) => call.url.pathname), [
    "/v1/ai-learning/eval/scorecards",
    "/v1/ai-learning/candidates",
    "/v1/ai-learning/review-bindings/preview",
    "/v1/ai-learning/candidates/review",
    "/v1/ai-learning/outcomes",
  ]);
  assert.equal(calls[0].url.searchParams.get("release_version"), "0.16.0");
  assert.equal(calls[0].url.searchParams.get("limit"), "5");
  assert(calls.every((call) => call.init.headers.authorization === "Bearer tenant-a-key"));
  assert(calls.slice(3).every((call) => call.body.owner_context?.owner_verified === true));
  assert.deepEqual(
    [...TOOLS, ...WORK_CONTINUITY_TOOLS]
      .filter((tool) => COMPACT_MCP_TOOL_NAMES.includes(tool.name))
      .map((tool) => tool.name),
    COMPACT_MCP_TOOL_NAMES,
  );
  assert.equal(COMPACT_MCP_TOOL_NAMES.length, 13);
  assert.equal(
    COMPACT_MCP_TOOL_NAMES.some((name) => name.startsWith("tenant_provider_openai_")),
    false,
  );
});

test("all nine MCP learning handlers satisfy the mounted Core route contracts end to end", async () => {
  const { handlers, storeCalls } = aiLearningRouteBridge();
  const reader = { tenantId: "tenant-a" };

  await handlers.ai_eval_scorecard_read({
    scorecard_id: "scorecard-v016",
    release_version: "0.16.0",
    limit: 3,
    cursor: "offset:0",
  }, reader);
  await handlers.ai_eval_dataset_read({
    dataset_id: "dataset-v1",
    version: "v1",
    limit: 4,
    cursor: "offset:0",
  }, reader);
  await handlers.ai_eval_trace_read({
    trace_id: "trace-v016",
    run_id: "run-v016",
    limit: 5,
    cursor: "offset:0",
  }, reader);
  await handlers.ai_performance_scorecard_read({
    scorecard_id: "performance-v016",
    release_version: "0.16.0",
    limit: 6,
    cursor: "offset:0",
  }, reader);
  await handlers.ai_experiment_read({
    experiment_id: "experiment-v016",
    state: "shadow",
    limit: 7,
    cursor: "offset:0",
  }, reader);
  await handlers.ai_learning_candidate_read({
    candidate_id: "candidate-v016",
    state: "under_review",
    limit: 8,
    cursor: "offset:0",
  }, reader);
  await handlers.ai_learning_review_binding_preview({
    candidate_id: "candidate-v016",
    decision: "approved_for_shadow",
    expected_revision: 1,
  }, reader);

  const owner = ownerIdentity();
  await handlers.ai_learning_candidate_review({
    candidate_id: "candidate-v016",
    decision: "deferred",
    review_note: "Await another independent evaluation.",
    expected_revision: 1,
    idempotency_key: "review-v016-candidate",
    owner_confirmed: true,
    confirmation_reference: "owner-review-v016",
  }, owner);
  await handlers.ai_learning_outcome_record({
    outcome: {
      outcome_id: "outcome-v016",
      run_id: "run-v016",
      candidate_id: "candidate-v016",
      candidate_version: "v1",
      candidate_revision: 1,
      outcome_status: "succeeded",
      outcome_verified: true,
      human_review_status: "approved",
      evidence_digest: `sha256:${"a".repeat(64)}`,
      policy_snapshot: "policy-v016",
      observed_at: "2026-07-27T12:00:00.000Z",
      learning_value: 0.9,
    },
    expected_revision: 0,
    idempotency_key: "outcome-v016-record",
    owner_confirmed: true,
    confirmation_reference: "owner-outcome-v016",
  }, owner);

  assert.deepEqual(storeCalls.map((call) => call.method), [
    "readEvaluationScorecard",
    "readDatasetMetadata",
    "telemetry.read",
    "readPerformanceScorecard",
    "readCausalExperiment",
    "readLearningCandidate",
    "readLearningCandidate",
    "readDatasetMetadata",
    "readEvaluationScorecard",
    "readCausalExperiment",
    "issueReviewBinding",
    "reviewLearningCandidate",
    "telemetry.read",
    "readLearningCandidate",
    "recordLearningOutcome",
  ]);
  assert.equal(storeCalls[0].input.tenant_id, "tenant-a");
  assert.equal(storeCalls[0].input.record_id, "scorecard-v016");
  assert.deepEqual(storeCalls[0].input.visibility_context, {
    tenant_id: "tenant-a",
    client_type: "codex",
    audience: "codex_internal",
    entitlements: [],
    role: "",
  });
  assert.equal(storeCalls[3].input.tenant_id, "tenant-a");
  assert.equal(storeCalls[3].input.record_id, "performance-v016");
  assert.equal(storeCalls[11].input.decision, "deferred");
  assert.equal(storeCalls[11].input.expected_revision, 1);
  assert.equal(storeCalls[11].input.authorization.audit_reference, "audit-route-bridge");
  assert.equal(storeCalls[14].input.record.run_id, "run-v016");
  assert.equal(storeCalls[14].input.record.learning_value, 0.9);
  assert.equal(storeCalls[14].input.expected_revision, 0);
  assert.deepEqual(storeCalls[14].input.visibility_branch_ids, [
    "ai_evaluation_intelligence",
    "learning_data_governance",
  ]);
});

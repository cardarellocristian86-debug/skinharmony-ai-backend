import assert from "node:assert/strict";
import test from "node:test";
import { createAiLearningFactoryStore } from "../src/aiLearningFactoryStore.js";
import {
  AI_LEARNING_FACTORY_ROUTE_CONTRACTS,
  mountAiLearningFactoryRoutes,
} from "../src/aiLearningFactoryRoutes.js";
import { createAiRuntimeTelemetryStore } from "../src/aiRuntimeTelemetry.js";
import {
  createAiLearningCoreApprovalAttestationService,
  createAiLearningReviewBindingReceiptService,
} from "../src/aiLearningEvidenceVerifier.js";

function mockApp() {
  const routes = [];
  return {
    routes,
    get(path, ...handlers) { routes.push({ method: "GET", path, handlers }); },
    post(path, ...handlers) { routes.push({ method: "POST", path, handlers }); },
  };
}

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function request({ tenantId = "tenant-a", query = {}, body = {}, headers = {} } = {}) {
  return {
    tenantId,
    query,
    body,
    get(name) { return headers[name.toLowerCase()] || ""; },
  };
}

function horizontalRequestContext() {
  return { clientType: "chatgpt", audience: "chatgpt_connector" };
}

async function invoke(app, method, path, req) {
  const route = app.routes.find((item) => item.method === method && item.path === path);
  assert(route, `${method} ${path}`);
  const res = response();
  await route.handlers.at(-1)(req, res);
  return res;
}

function candidate() {
  return {
    candidate_id: "candidate-prompt",
    candidate_version: "v1",
    candidate_type: "dataset",
    status: "under_review",
    dataset_id: "dataset-golden",
    dataset_version: "golden-v1",
    scorecard_id: "scorecard-v016",
    experiment_id: "experiment-shadow",
    evidence_digest: "evd-candidate",
    rollback_reference: "rollback-v1",
    proposal_summary: "Shadow only.",
    risk_review_status: "passed",
    cost_review_status: "passed",
  };
}

async function seedCandidateEvidence(store) {
  await store.recordDatasetMetadata({
    tenant_id: "tenant-a",
    idempotency_key: "seed-dataset",
    expected_revision: 0,
    record: {
      dataset_id: "dataset-golden",
      dataset_version: "golden-v1",
      case_count: 240,
      provenance_digest: "sha256:provenance",
      label_provenance_digest: "sha256:labels",
      consent_eligible: true,
      tenant_scope_validated: true,
      redaction_status: "passed",
      data_quality_status: "passed",
      poisoning_status: "clean",
      split_digests: { train: "sha256:train", eval: "sha256:eval" },
      retention_expires_at: "2027-07-27T00:00:00.000Z",
      evidence_refs: ["evidence-dataset"],
    },
  });
  await store.recordEvaluationScorecard({
    tenant_id: "tenant-a",
    idempotency_key: "seed-scorecard",
    expected_revision: 0,
    record: {
      scorecard_id: "scorecard-v016",
      release_version: "0.16.0-ai-learning-factory",
      dataset_version: "golden-v1",
      benchmark_manifest_digest: "sha256:benchmark",
      metrics: {
        branch_selection_accuracy: 0.98,
        tool_selection_accuracy: 0.97,
        safety_compliance_score: 1,
      },
      regression_count: 0,
      regressions: [],
      evidence_refs: ["evidence-scorecard"],
      confidence: 0.97,
      limitations: ["shadow-only"],
      proposal: "Keep in shadow.",
    },
  });
  await store.recordCausalExperiment({
    tenant_id: "tenant-a",
    idempotency_key: "seed-experiment",
    expected_revision: 0,
    record: {
      experiment_id: "experiment-shadow",
      experiment_version: "v1",
      hypothesis: "Shadow evaluation preserves all guardrails.",
      status: "shadow",
      assignment_integrity: "passed",
      guardrail_metrics: { safety_compliance_score: 1 },
      evidence_refs: ["evidence-experiment"],
      rollback_reference: "rollback-experiment",
      promotion_recommendation: "review",
      causal_confidence: 0.9,
    },
  });
}

function candidateReviewProof() {
  const signingSecret = "route-review-binding-test-secret-0123456789";
  const now = () => Date.parse("2026-07-27T12:00:00.000Z");
  const bindingIssuer = createAiLearningReviewBindingReceiptService({
    secret: signingSecret,
    now,
    randomBytes: () => Buffer.alloc(16, 7),
  });
  const candidateRecord = {
    tenant_id: "tenant-a",
    revision: 1,
    ...candidate(),
  };
  const datasetRecord = {
    tenant_id: "tenant-a",
    revision: 1,
    dataset_id: "dataset-golden",
    dataset_version: "golden-v1",
    provenance_digest: "sha256:provenance",
    label_provenance_digest: "sha256:labels",
    split_digests: { train: "sha256:train", eval: "sha256:eval" },
    evidence_refs: ["evidence-dataset"],
  };
  const scorecardRecord = {
    tenant_id: "tenant-a",
    revision: 1,
    scorecard_id: "scorecard-v016",
    release_version: "0.16.0-ai-learning-factory",
    dataset_version: "golden-v1",
    benchmark_manifest_digest: "sha256:benchmark",
    metrics: {
      branch_selection_accuracy: 0.98,
      tool_selection_accuracy: 0.97,
      safety_compliance_score: 1,
    },
    evidence_refs: ["evidence-scorecard"],
  };
  const experimentRecord = {
    tenant_id: "tenant-a",
    revision: 1,
    experiment_id: "experiment-shadow",
    experiment_version: "v1",
    assignment_integrity: "passed",
    guardrail_metrics: { safety_compliance_score: 1 },
    evidence_refs: ["evidence-experiment"],
    rollback_reference: "rollback-experiment",
  };
  const issued = bindingIssuer.issue({
    tenant_id: "tenant-a",
    candidate: candidateRecord,
    expected_revision: 1,
    decision: "approved_for_shadow",
    dataset: datasetRecord,
    scorecard: scorecardRecord,
    experiment: experimentRecord,
  });
  const receipt = Object.fromEntries(
    Object.entries(issued).filter(([key]) => key !== "binding"),
  );
  const bindingVerification = bindingIssuer.verify({
    receipt,
    tenant_id: "tenant-a",
    candidate: candidateRecord,
    expected_revision: 1,
    decision: "approved_for_shadow",
    dataset: datasetRecord,
    scorecard: scorecardRecord,
    experiment: experimentRecord,
  });
  assert.equal(bindingVerification.verified, true);
  const coreApprovalAttestation =
    createAiLearningCoreApprovalAttestationService({
      secret: signingSecret,
      now,
    }).issue({
      tenant_id: "tenant-a",
      candidate: candidateRecord,
      binding_verification: bindingVerification,
      independent_review: {
        verified: true,
        binding_digest: issued.binding.binding_digest,
        receipt_digest: `sha256:${"a".repeat(64)}`,
        review_tree_id: "tree-review-1",
        review_node_id: "verify-review-1",
        core_verdict_reference: `dttv_${"d".repeat(64)}`,
        core_evidence_set_digest: `dttje_${"e".repeat(24)}`,
        artifact_bindings: [{
          artifact_id: "artifact-review-binding-1",
          content_digest: issued.binding.binding_digest,
          source_reference: "dtt://tree-review-1/verify-review-1",
        }],
        reviewed_at: "2026-07-27T12:00:00.000Z",
      },
      owner_actor_provenance: `ap_${"c".repeat(32)}`,
    });
  return {
    receipt,
    payload: issued.binding.payload,
    binding_digest: issued.binding.binding_digest,
    core_approval_attestation: coreApprovalAttestation,
  };
}

test("router exposes exactly nine dynamic endpoints without adding MCP tools", () => {
  const app = mockApp();
  const mounted = mountAiLearningFactoryRoutes({
    app,
    readAuth() {},
    governAuth() {},
    telemetryStore: createAiRuntimeTelemetryStore(),
    learningStore: createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true }),
    audit: { append() {} },
    resolveGovernanceProof() {},
    resolveRequestContext: horizontalRequestContext,
  });
  assert.equal(app.routes.length, 9);
  assert.equal(mounted.routes.length, 9);
  assert.equal(mounted.top_level_mcp_tools_added, 0);
  assert.deepEqual(mounted.contracts, AI_LEARNING_FACTORY_ROUTE_CONTRACTS);
  assert.deepEqual(mounted.routes.map((item) => item.capability_id), [
    "ai_eval_scorecard_read",
    "ai_eval_dataset_read",
    "ai_eval_trace_read",
    "ai_performance_scorecard_read",
    "ai_experiment_read",
    "ai_learning_candidate_read",
    "ai_learning_review_binding_preview",
    "ai_learning_candidate_review",
    "ai_learning_outcome_record",
  ]);
  assert.equal(
    mounted.contracts.ai_eval_scorecard_read.output_schema,
    "ai_evaluation_scorecard_v0_16",
  );
  assert.equal(
    mounted.contracts.ai_learning_review_binding_preview.output_schema,
    "ai_learning_review_binding_preview_v0_16",
  );
  assert.deepEqual(
    mounted.contracts.ai_learning_review_binding_preview.request_one_of
      .map((variant) => variant.kind),
    ["learning_candidate", "learning_outcome"],
  );
  assert(
    mounted.contracts.ai_learning_review_binding_preview.output_variants
      .learning_outcome.includes("telemetry_digest"),
  );
  assert(
    mounted.contracts.ai_learning_candidate_review.body
      .includes("review_binding_receipt"),
  );
  assert.deepEqual(
    mounted.contracts.ai_learning_candidate_review
      .review_binding_receipt_required_for,
    ["approved_for_shadow"],
  );
});

test("six read contracts apply canonical filters and bounded cursor pagination", async () => {
  const app = mockApp();
  const calls = [];
  const learningStore = {
    async listEvaluationScorecards() {
      return [
        { scorecard_id: "eval-old", release_version: "v0" },
        { scorecard_id: "eval-current", release_version: "v1" },
      ];
    },
    async readEvaluationScorecard({ record_id }) { return { scorecard_id: record_id, release_version: "v1" }; },
    async listDatasetMetadata() {
      return [
        { dataset_id: "dataset-old", dataset_version: "v0" },
        { dataset_id: "dataset-current", dataset_version: "v1" },
      ];
    },
    async readDatasetMetadata({ record_id }) { return { dataset_id: record_id, dataset_version: "v1" }; },
    async listPerformanceScorecards() { return []; },
    async readPerformanceScorecard(input) {
      calls.push(input);
      return { performance_scorecard_id: input.record_id, release_version: "v1" };
    },
    async listCausalExperiments() {
      return [
        { experiment_id: "experiment-shadow", status: "shadow" },
        { experiment_id: "experiment-complete", status: "completed" },
      ];
    },
    async readCausalExperiment({ record_id }) { return { experiment_id: record_id, status: "shadow" }; },
    async listLearningCandidates() {
      return [
        { candidate_id: "candidate-1", status: "under_review" },
        { candidate_id: "candidate-2", status: "under_review" },
        { candidate_id: "candidate-3", status: "rejected" },
      ];
    },
    async readLearningCandidate({ record_id }) { return { candidate_id: record_id, status: "under_review" }; },
  };
  const telemetryStore = {
    async list() {
      return [
        { run_id: "run-1", trace_id: "trace-a" },
        { run_id: "run-2", trace_id: "trace-b" },
      ];
    },
    async read({ run_id }) { return { run_id, trace_id: "trace-a" }; },
  };
  mountAiLearningFactoryRoutes({
    app,
    readAuth() {},
    governAuth() {},
    telemetryStore,
    learningStore,
    audit: { append() {} },
    resolveGovernanceProof() {},
    resolveRequestContext: horizontalRequestContext,
  });

  const scorecard = await invoke(
    app,
    "GET",
    "/v1/ai-learning/eval/scorecards",
    request({ query: { release_version: "v1" } }),
  );
  assert.deepEqual(scorecard.payload.scorecards.map((record) => record.scorecard_id), ["eval-current"]);

  const dataset = await invoke(
    app,
    "GET",
    "/v1/ai-learning/eval/datasets",
    request({ query: { version: "v1" } }),
  );
  assert.deepEqual(dataset.payload.datasets.map((record) => record.dataset_id), ["dataset-current"]);

  const trace = await invoke(
    app,
    "GET",
    "/v1/ai-learning/eval/traces",
    request({ query: { trace_id: "trace-b" } }),
  );
  assert.deepEqual(trace.payload.traces.map((record) => record.run_id), ["run-2"]);

  const performance = await invoke(
    app,
    "GET",
    "/v1/ai-learning/performance/scorecards",
    request({ query: { scorecard_id: "performance-v1" } }),
  );
  assert.equal(performance.payload.scorecards[0].performance_scorecard_id, "performance-v1");
  assert.equal(calls[0].record_id, "performance-v1");

  const experiments = await invoke(
    app,
    "GET",
    "/v1/ai-learning/experiments",
    request({ query: { state: "completed" } }),
  );
  assert.deepEqual(experiments.payload.experiments.map((record) => record.experiment_id), ["experiment-complete"]);

  const candidates = await invoke(
    app,
    "GET",
    "/v1/ai-learning/candidates",
    request({ query: { state: "under_review", limit: "1", cursor: "offset:1" } }),
  );
  assert.deepEqual(candidates.payload.candidates.map((record) => record.candidate_id), ["candidate-2"]);
  assert.equal(candidates.payload.next_cursor, null);

  const rejected = await invoke(
    app,
    "GET",
    "/v1/ai-learning/candidates",
    request({ query: { unsupported_filter: "value" } }),
  );
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.payload.error, "ai_learning_query_parameter_not_allowed");
});

test("read routes delegate bounded cursor and filters to the persistence-backed page API", async () => {
  const app = mockApp();
  const calls = [];
  const learningStore = {
    async listLearningCandidates(input) {
      calls.push(input);
      return {
        records: [{
          candidate_id: "candidate-0501",
          status: "under_review",
        }],
        next_offset: 551,
      };
    },
  };
  mountAiLearningFactoryRoutes({
    app,
    readAuth() {},
    governAuth() {},
    telemetryStore: {},
    learningStore,
    audit: { append() {} },
    resolveGovernanceProof() {},
    resolveRequestContext: horizontalRequestContext,
  });

  const result = await invoke(
    app,
    "GET",
    "/v1/ai-learning/candidates",
    request({
      query: {
        state: "under_review",
        limit: "50",
        cursor: "offset:501",
      },
    }),
  );
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.candidates.map((record) => record.candidate_id), [
    "candidate-0501",
  ]);
  assert.equal(result.payload.next_cursor, "offset:551");
  assert.deepEqual(calls[0], {
    tenant_id: "tenant-a",
    limit: 50,
    offset: 501,
    filters: { status: "under_review" },
    page: true,
    visibility_context: {
      tenant_id: "tenant-a",
      client_type: "chatgpt",
      audience: "chatgpt_connector",
      entitlements: [],
      role: "",
    },
  });
});

test("read routes derive tenant scope server-side", async () => {
  const app = mockApp();
  const learningStore = createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true, now: () => "2026-07-27T12:00:00.000Z" });
  await learningStore.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-a",
    expected_revision: 0,
    record: candidate(),
  });
  await learningStore.recordLearningCandidate({
    tenant_id: "tenant-b",
    idempotency_key: "candidate-b",
    expected_revision: 0,
    record: { ...candidate(), candidate_id: "candidate-other" },
  });
  mountAiLearningFactoryRoutes({
    app,
    readAuth() {},
    governAuth() {},
    telemetryStore: createAiRuntimeTelemetryStore(),
    learningStore,
    audit: { append() {} },
    resolveGovernanceProof() {},
    resolveRequestContext: horizontalRequestContext,
  });

  const allowed = await invoke(app, "GET", "/v1/ai-learning/candidates", request());
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(allowed.payload.candidates.map((item) => item.candidate_id), ["candidate-prompt"]);

  const denied = await invoke(
    app,
    "GET",
    "/v1/ai-learning/candidates",
    request({ query: { tenant_id: "tenant-b" } }),
  );
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.payload.error, "tenant_scope_denied");
});

test("ChatGPT owner_root cannot read model-adaptation records and filtering precedes pagination", async () => {
  const learningStore = createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true,
    now: () => "2026-07-27T12:00:00.000Z",
  });
  await learningStore.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-horizontal-1",
    expected_revision: 0,
    record: { ...candidate(), candidate_id: "candidate-horizontal-1" },
  });
  await learningStore.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-model-private",
    expected_revision: 0,
    record: {
      ...candidate(),
      candidate_id: "candidate-model-private",
      candidate_type: "prompt",
    },
  });
  await learningStore.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-horizontal-2",
    expected_revision: 0,
    record: { ...candidate(), candidate_id: "candidate-horizontal-2" },
  });

  const chatgptApp = mockApp();
  mountAiLearningFactoryRoutes({
    app: chatgptApp,
    readAuth() {},
    governAuth() {},
    telemetryStore: createAiRuntimeTelemetryStore(),
    learningStore,
    audit: { append() {} },
    resolveGovernanceProof() {},
    resolveRequestContext() {
      return {
        clientType: "chatgpt",
        audience: "chatgpt_connector",
        role: "owner_root",
      };
    },
  });
  const firstPage = await invoke(
    chatgptApp,
    "GET",
    "/v1/ai-learning/candidates",
    request({ query: { limit: "1" } }),
  );
  assert.deepEqual(
    firstPage.payload.candidates.map((item) => item.candidate_id),
    ["candidate-horizontal-1"],
  );
  assert.equal(firstPage.payload.next_cursor, "offset:1");
  const secondPage = await invoke(
    chatgptApp,
    "GET",
    "/v1/ai-learning/candidates",
    request({ query: { limit: "1", cursor: "offset:1" } }),
  );
  assert.deepEqual(
    secondPage.payload.candidates.map((item) => item.candidate_id),
    ["candidate-horizontal-2"],
  );
  const forced = await invoke(
    chatgptApp,
    "GET",
    "/v1/ai-learning/candidates",
    request({ query: { candidate_id: "candidate-model-private" } }),
  );
  assert.deepEqual(forced.payload.candidates, []);

  const adminApp = mockApp();
  mountAiLearningFactoryRoutes({
    app: adminApp,
    readAuth() {},
    governAuth() {},
    telemetryStore: createAiRuntimeTelemetryStore(),
    learningStore,
    audit: { append() {} },
    resolveGovernanceProof() {},
    resolveRequestContext() {
      return {
        clientType: "admin",
        audience: "admin_control_room",
        role: "admin",
      };
    },
  });
  const adminRead = await invoke(
    adminApp,
    "GET",
    "/v1/ai-learning/candidates",
    request({ query: { candidate_id: "candidate-model-private" } }),
  );
  assert.deepEqual(
    adminRead.payload.candidates.map((item) => item.candidate_id),
    ["candidate-model-private"],
  );
});

test("review binding preview returns the exact bounded server-derived artifact without mutating", async () => {
  const app = mockApp();
  const events = [];
  const learningStore = createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true,
    now: () => "2026-07-27T12:00:00.000Z",
  });
  await seedCandidateEvidence(learningStore);
  await learningStore.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-preview",
    expected_revision: 0,
    record: candidate(),
  });
  mountAiLearningFactoryRoutes({
    app,
    readAuth() {},
    governAuth() {},
    telemetryStore: createAiRuntimeTelemetryStore(),
    learningStore,
    audit: { append(type, payload) { events.push({ type, payload }); } },
    resolveGovernanceProof() {},
    resolveRequestContext: horizontalRequestContext,
    issueReviewBinding: createAiLearningReviewBindingReceiptService({
      secret: "route-review-binding-test-secret-0123456789",
      now: () => Date.parse("2026-07-27T12:00:00.000Z"),
      randomBytes: () => Buffer.alloc(16, 7),
    }).issue,
  });
  const result = await invoke(
    app,
    "POST",
    "/v1/ai-learning/review-bindings/preview",
    request({
      body: {
        candidate_id: "candidate-prompt",
        decision: "approved_for_shadow",
        expected_revision: 1,
      },
    }),
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.review_binding.source_revision, 1);
  assert.equal(result.payload.review_binding.resulting_revision, 2);
  assert.match(result.payload.review_binding.binding_digest, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.payload.review_binding.receipt.signature, /^airr_[a-f0-9]{64}$/);
  assert.equal(
    JSON.parse(result.payload.review_binding.binding_content).candidate_id,
    "candidate-prompt",
  );
  assert.equal(result.payload.review_binding.execution_authorized, false);
  assert.deepEqual(events.map((event) => event.type), [
    "ai_learning_review_binding_previewed",
  ]);
});

test("direct AI Learning routes reject adjacent or mismatched client/audience pairs", async () => {
  for (const context of [
    { clientType: "analyzer", audience: "analyzer_runtime" },
    { clientType: "chatgpt", audience: "analyzer_runtime" },
  ]) {
    const app = mockApp();
    mountAiLearningFactoryRoutes({
      app,
      readAuth() {},
      governAuth() {},
      telemetryStore: createAiRuntimeTelemetryStore(),
      learningStore: createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true }),
      audit: { append() {} },
      resolveGovernanceProof() {},
      resolveRequestContext() { return context; },
    });
    for (const route of app.routes) {
      const denied = await invoke(app, route.method, route.path, request());
      assert.equal(denied.statusCode, 403, route.path);
      assert.equal(denied.payload.error, "branch_not_available_for_client", route.path);
    }
  }
});

test("mutating routes ignore caller authorization and use server Core proof", async () => {
  const app = mockApp();
  const events = [];
  const learningStore = createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true, now: () => "2026-07-27T12:00:00.000Z" });
  await seedCandidateEvidence(learningStore);
  await learningStore.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-a",
    expected_revision: 0,
    record: candidate(),
  });
  const bindingProof = candidateReviewProof();
  mountAiLearningFactoryRoutes({
    app,
    readAuth() {},
    governAuth() {},
    telemetryStore: createAiRuntimeTelemetryStore(),
    learningStore,
    audit: { append(type, payload) { events.push({ type, payload }); } },
    resolveGovernanceProof() {
      return {
        core_verdict: "ALLOW",
        owner_confirmed: true,
        scopes: ["core:govern"],
        audit_reference: "audit-server-proof",
        rollback_reference: "rollback-v1",
        reviewer_reference: "reviewer-owner-1",
        reviewed_at: "2026-07-27T12:00:00.000Z",
        review_expires_at: "2026-07-27T12:15:00.000Z",
        independent_human_review_verified: true,
        independent_review_receipt_digest: `sha256:${"a".repeat(64)}`,
        independent_review_binding_digest: bindingProof.binding_digest,
        review_tree_id: "tree-review-1",
        review_node_id: "verify-review-1",
        review_owner_actor_ids: [`ap_${"c".repeat(32)}`],
        review_binding_receipt: bindingProof.receipt,
        review_binding_payload: bindingProof.payload,
        core_approval_attestation: bindingProof.core_approval_attestation,
      };
    },
    resolveRequestContext: horizontalRequestContext,
  });

  const res = await invoke(
    app,
    "POST",
    "/v1/ai-learning/candidates/review",
    request({
      headers: { "idempotency-key": "review-1" },
      body: {
        candidate_id: "candidate-prompt",
        decision: "approved_for_shadow",
        review_note: "Human review complete.",
        expected_revision: 1,
        authorization: { core_verdict: "BLOCK", owner_confirmed: false },
      },
    }),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.candidate.status, "approved_for_shadow");
  assert.equal(res.payload.candidate.human_review.audit_reference, "audit-server-proof");
  assert.deepEqual(events.map((event) => event.type), [
    "ai_learning_candidate_review_authorized",
    "ai_learning_candidate_reviewed",
  ]);
  assert.match(events[0].payload.idempotency_digest, /^idem_[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(events).includes("review-1"), false);
});

test("outcome recording requires optimistic concurrency and server proof", async () => {
  const app = mockApp();
  const learningStore = createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true, now: () => "2026-07-27T12:00:00.000Z" });
  mountAiLearningFactoryRoutes({
    app,
    readAuth() {},
    governAuth() {},
    telemetryStore: createAiRuntimeTelemetryStore(),
    learningStore,
    audit: { append() {} },
    resolveGovernanceProof() {
      return {
        core_verdict: "ALLOW",
        owner_confirmed: true,
        scopes: ["core:govern"],
        audit_reference: "audit-server-proof",
        rollback_reference: "rollback-v1",
      };
    },
    resolveRequestContext: horizontalRequestContext,
  });
  const denied = await invoke(
    app,
    "POST",
    "/v1/ai-learning/outcomes",
    request({
      headers: { "idempotency-key": "outcome-1" },
      body: {
        outcome: {
          outcome_id: "outcome-1",
          run_id: "run-1",
          outcome_status: "succeeded",
          outcome_verified: true,
          human_review_status: "approved",
          evidence_digest: "evd-outcome",
          policy_snapshot: "policy-v1",
          observed_at: "2026-07-27T12:00:00.000Z",
          learning_value: 0.8,
        },
      },
    }),
  );
  assert.equal(denied.statusCode, 400);
  assert.equal(denied.payload.error, "expected_revision_required");
});

test("audit failure happens before a governed mutation", async () => {
  const app = mockApp();
  const learningStore = createAiLearningFactoryStore({ allowImplicitVisibilityForTests: true, now: () => "2026-07-27T12:00:00.000Z" });
  await learningStore.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-a",
    expected_revision: 0,
    record: candidate(),
  });
  mountAiLearningFactoryRoutes({
    app,
    readAuth() {},
    governAuth() {},
    telemetryStore: createAiRuntimeTelemetryStore(),
    learningStore,
    audit: { append() { throw new Error("audit_unavailable"); } },
    resolveGovernanceProof() {
      return {
        core_verdict: "ALLOW",
        owner_confirmed: true,
        scopes: ["core:govern"],
        audit_reference: "audit-server-proof",
        rollback_reference: "rollback-v1",
      };
    },
    resolveRequestContext: horizontalRequestContext,
  });
  const res = await invoke(
    app,
    "POST",
    "/v1/ai-learning/candidates/review",
    request({
      headers: { "idempotency-key": "review-1" },
      body: {
        candidate_id: "candidate-prompt",
        decision: "approved_for_shadow",
        review_note: "Human review complete.",
        expected_revision: 1,
      },
    }),
  );
  assert.equal(res.statusCode, 400);
  const candidateAfter = await learningStore.readLearningCandidate({
    tenant_id: "tenant-a",
    record_id: "candidate-prompt",
  });
  assert.equal(candidateAfter.status, "under_review");
  assert.equal(candidateAfter.revision, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createAiLearningFactoryStore } from "../src/aiLearningFactoryStore.js";

const timestamp = "2026-07-27T12:00:00.000Z";

function scorecard(overrides = {}) {
  return {
    scorecard_id: "scorecard-v016",
    release_version: "0.16.0-ai-learning-factory",
    dataset_version: "golden-v1",
    benchmark_manifest_digest: "sha256:abcdef",
    metrics: {
      branch_selection_accuracy: 0.98,
      tool_selection_accuracy: 0.97,
      handoff_accuracy: 1,
      final_output_quality: 0.96,
      safety_compliance_score: 1,
    },
    regression_count: 0,
    regressions: [],
    evidence_refs: ["evd-scorecard"],
    confidence: 0.97,
    limitations: ["synthetic baseline"],
    proposal: "Keep the release in shadow pending human review.",
    ...overrides,
  };
}

function dataset(overrides = {}) {
  return {
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
    evidence_refs: ["evd-dataset"],
    ...overrides,
  };
}

function experiment(overrides = {}) {
  return {
    experiment_id: "experiment-shadow",
    experiment_version: "v1",
    hypothesis: "A bounded route improves quality without external execution.",
    status: "shadow",
    assignment_integrity: "passed",
    guardrail_metrics: { safety_compliance_score: 1 },
    evidence_refs: ["evd-experiment"],
    rollback_reference: "rollback-experiment-v1",
    promotion_recommendation: "review",
    causal_confidence: 0.82,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    candidate_id: "candidate-prompt",
    candidate_version: "v1",
    candidate_type: "prompt",
    status: "under_review",
    dataset_id: "dataset-golden",
    dataset_version: "golden-v1",
    scorecard_id: "scorecard-v016",
    experiment_id: "experiment-shadow",
    evidence_digest: "evd-candidate",
    rollback_reference: "rollback-candidate-v1",
    proposal_summary: "Evaluate offline and in shadow only.",
    risk_review_status: "passed",
    cost_review_status: "passed",
    ...overrides,
  };
}

function authorization(overrides = {}) {
  return {
    core_verdict: "ALLOW",
    owner_confirmed: true,
    scopes: ["core:govern"],
    audit_reference: "audit-core-gate-1",
    rollback_reference: "rollback-candidate-v1",
    reviewer_reference: "reviewer-owner-1",
    reviewed_at: timestamp,
    review_expires_at: "2026-07-27T12:15:00.000Z",
    independent_human_review_verified: true,
    ...overrides,
  };
}

test("registries isolate tenants and preserve advisory-only contracts", async () => {
  const store = createAiLearningFactoryStore({ now: () => timestamp });
  const recorded = await store.recordEvaluationScorecard({
    tenant_id: "tenant-a",
    idempotency_key: "idem-scorecard-1",
    record: scorecard(),
  });
  assert.equal(recorded.tenant_id, "tenant-a");
  assert.equal(recorded.advisory_only, true);
  assert.equal(recorded.autonomous_execution_allowed, false);
  assert.equal(recorded.auto_promotion, false);
  assert.equal((await store.listEvaluationScorecards({ tenant_id: "tenant-a" })).length, 1);
  assert.equal((await store.listEvaluationScorecards({ tenant_id: "tenant-b" })).length, 0);
  assert.equal(await store.readEvaluationScorecard({ tenant_id: "tenant-b", record_id: "scorecard-v016" }), null);

  await assert.rejects(
    store.recordDatasetMetadata({
      tenant_id: "tenant-a",
      idempotency_key: "idem-cross-tenant",
      record: { ...dataset(), tenant_id: "tenant-b" },
    }),
    /cross_tenant_record_denied/,
  );
});

test("idempotency and optimistic concurrency fail closed", async () => {
  const store = createAiLearningFactoryStore({ now: () => timestamp });
  const first = await store.recordCausalExperiment({
    tenant_id: "tenant-a",
    idempotency_key: "idem-experiment-1",
    expected_revision: 0,
    record: experiment(),
  });
  const replay = await store.recordCausalExperiment({
    tenant_id: "tenant-a",
    idempotency_key: "idem-experiment-1",
    expected_revision: 0,
    record: experiment(),
  });
  assert.deepEqual(replay, first);
  await assert.rejects(
    store.recordCausalExperiment({
      tenant_id: "tenant-a",
      idempotency_key: "idem-experiment-1",
      expected_revision: 0,
      record: experiment({ causal_confidence: 0.91 }),
    }),
    /learning_factory_idempotency_conflict/,
  );
  await assert.rejects(
    store.recordCausalExperiment({
      tenant_id: "tenant-a",
      idempotency_key: "idem-experiment-2",
      expected_revision: 0,
      record: experiment({ causal_confidence: 0.91 }),
    }),
    /learning_factory_revision_conflict/,
  );
});

test("memory-only optimistic concurrency serializes competing revisions", async () => {
  const store = createAiLearningFactoryStore({ now: () => timestamp });
  const writes = await Promise.allSettled([
    store.recordCausalExperiment({
      tenant_id: "tenant-a",
      idempotency_key: "idem-concurrent-a",
      expected_revision: 0,
      record: experiment({ causal_confidence: 0.81 }),
    }),
    store.recordCausalExperiment({
      tenant_id: "tenant-a",
      idempotency_key: "idem-concurrent-b",
      expected_revision: 0,
      record: experiment({ causal_confidence: 0.82 }),
    }),
  ]);
  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = writes.find((result) => result.status === "rejected");
  assert(rejected);
  assert.match(rejected.reason.message, /learning_factory_revision_conflict/);
  const stored = await store.readCausalExperiment({
    tenant_id: "tenant-a",
    record_id: "experiment-shadow",
  });
  assert.equal(stored.revision, 1);
});

test("concurrent reuse of one idempotency key cannot create two records", async () => {
  const store = createAiLearningFactoryStore({ now: () => timestamp });
  const writes = await Promise.allSettled([
    store.recordCausalExperiment({
      tenant_id: "tenant-a",
      idempotency_key: "idem-shared",
      expected_revision: 0,
      record: experiment({ experiment_id: "experiment-a" }),
    }),
    store.recordCausalExperiment({
      tenant_id: "tenant-a",
      idempotency_key: "idem-shared",
      expected_revision: 0,
      record: experiment({ experiment_id: "experiment-b" }),
    }),
  ]);
  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = writes.find((result) => result.status === "rejected");
  assert(rejected);
  assert.match(rejected.reason.message, /learning_factory_idempotency_conflict/);
  assert.equal((await store.listCausalExperiments({ tenant_id: "tenant-a" })).length, 1);
});

test("poisoning, train/eval leakage and autonomous execution are rejected", async () => {
  const store = createAiLearningFactoryStore({ now: () => timestamp });
  await assert.rejects(
    store.recordDatasetMetadata({
      tenant_id: "tenant-a",
      idempotency_key: "idem-leak",
      record: dataset({ split_digests: { train: "sha256:same", eval: "sha256:same" } }),
    }),
    /train_eval_leakage_detected/,
  );
  await assert.rejects(
    store.recordDatasetMetadata({
      tenant_id: "tenant-a",
      idempotency_key: "idem-poison",
      record: dataset({ poisoning_detected: true, poisoning_status: "clean" }),
    }),
    /poisoning_quarantine_required/,
  );
  const quarantined = await store.recordDatasetMetadata({
    tenant_id: "tenant-a",
    idempotency_key: "idem-quarantine",
    record: dataset({ poisoning_detected: true, poisoning_status: "quarantined" }),
  });
  assert.equal(quarantined.poisoning_status, "quarantined");
  assert.equal(quarantined.training_authorized, false);

  await assert.rejects(
    store.recordCausalExperiment({
      tenant_id: "tenant-a",
      idempotency_key: "idem-auto",
      record: experiment({ external_execution: true }),
    }),
    /ai_learning_factory_autonomous_execution_forbidden/,
  );
  await assert.rejects(
    store.recordEvaluationScorecard({
      tenant_id: "tenant-a",
      idempotency_key: "idem-secret-reference",
      record: scorecard({ evidence_refs: ["ghp_abcdefghijklmnopqrstuv"] }),
    }),
    /evidence_refs_invalid/,
  );
});

test("learning candidate approval requires server-verified Core governance", async () => {
  const store = createAiLearningFactoryStore({ now: () => timestamp });
  await store.recordDatasetMetadata({
    tenant_id: "tenant-a",
    idempotency_key: "approval-dataset",
    expected_revision: 0,
    record: dataset(),
  });
  await store.recordEvaluationScorecard({
    tenant_id: "tenant-a",
    idempotency_key: "approval-scorecard",
    expected_revision: 0,
    record: scorecard(),
  });
  await store.recordCausalExperiment({
    tenant_id: "tenant-a",
    idempotency_key: "approval-experiment",
    expected_revision: 0,
    record: experiment(),
  });
  await assert.rejects(
    store.recordLearningCandidate({
      tenant_id: "tenant-a",
      idempotency_key: "idem-candidate-invalid",
      record: candidate({ status: "approved_for_shadow" }),
    }),
    /learning_candidate_review_required/,
  );
  await store.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "idem-candidate-incomplete",
    expected_revision: 0,
    record: candidate({
      candidate_id: "candidate-incomplete",
      risk_review_status: "pending",
      cost_review_status: "pending",
    }),
  });
  await assert.rejects(
    store.reviewLearningCandidate({
      tenant_id: "tenant-a",
      candidate_id: "candidate-incomplete",
      decision: "approved_for_shadow",
      review_note: "not yet ready",
      authorization: authorization(),
      idempotency_key: "idem-review-incomplete",
      expected_revision: 1,
    }),
    /learning_candidate_evidence_incomplete/,
  );
  const recorded = await store.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "idem-candidate-1",
    expected_revision: 0,
    record: candidate(),
  });
  assert.equal(recorded.revision, 1);
  await assert.rejects(
    store.reviewLearningCandidate({
      tenant_id: "tenant-a",
      candidate_id: "candidate-prompt",
      decision: "approved_for_shadow",
      review_note: "reviewed",
      authorization: authorization({ core_verdict: "DEFER" }),
      idempotency_key: "idem-review-denied",
      expected_revision: 1,
    }),
    /core_governance_allow_required/,
  );
  const reviewed = await store.reviewLearningCandidate({
    tenant_id: "tenant-a",
    candidate_id: "candidate-prompt",
    decision: "approved_for_shadow",
    review_note: "Human review complete.",
    authorization: authorization(),
    idempotency_key: "idem-review-1",
    expected_revision: 1,
  });
  assert.equal(reviewed.revision, 2);
  assert.equal(reviewed.status, "approved_for_shadow");
  assert.equal(reviewed.human_review.audit_reference, "audit-core-gate-1");
  assert.equal(reviewed.human_review.guard_attestations.ai_learning_governance_guard, "ALLOW");
  assert.equal(reviewed.human_review.guard_attestations.ai_data_integrity_guard, "ALLOW");
  assert.equal(reviewed.live_mutation_authorized, false);
  assert.equal(reviewed.auto_promotion, false);
  const replay = await store.reviewLearningCandidate({
    tenant_id: "tenant-a",
    candidate_id: "candidate-prompt",
    decision: "approved_for_shadow",
    review_note: "Human review complete.",
    authorization: authorization(),
    idempotency_key: "idem-review-1",
    expected_revision: 1,
  });
  assert.deepEqual(replay, reviewed);
});

test("candidate approval fails closed on missing, poisoned, regressed, expired or unreviewed evidence", async () => {
  const cases = [
    {
      label: "missing dataset reference",
      candidate: { dataset_id: "missing-dataset" },
      expected: /learning_candidate_dataset_not_found/,
    },
    {
      label: "poisoned dataset",
      dataset: { poisoning_status: "quarantined" },
      expected: /ai_data_integrity_guard_blocked/,
    },
    {
      label: "regressed scorecard",
      scorecard: { regression_count: 1, regressions: ["routing regression"] },
      expected: /ai_data_integrity_guard_blocked/,
    },
    {
      label: "expired dataset",
      dataset: { retention_expires_at: "2026-07-27T11:59:59.000Z" },
      expected: /learning_candidate_dataset_expired/,
    },
    {
      label: "missing independent human receipt",
      authorization: { independent_human_review_verified: false },
      expected: /independent_human_review_required/,
    },
  ];
  for (const [index, fixture] of cases.entries()) {
    const store = createAiLearningFactoryStore({ now: () => timestamp });
    await store.recordDatasetMetadata({
      tenant_id: "tenant-a",
      idempotency_key: `dataset-${index}`,
      expected_revision: 0,
      record: dataset(fixture.dataset),
    });
    await store.recordEvaluationScorecard({
      tenant_id: "tenant-a",
      idempotency_key: `scorecard-${index}`,
      expected_revision: 0,
      record: scorecard(fixture.scorecard),
    });
    await store.recordCausalExperiment({
      tenant_id: "tenant-a",
      idempotency_key: `experiment-${index}`,
      expected_revision: 0,
      record: experiment(),
    });
    await store.recordLearningCandidate({
      tenant_id: "tenant-a",
      idempotency_key: `candidate-${index}`,
      expected_revision: 0,
      record: candidate(fixture.candidate),
    });
    await assert.rejects(
      store.reviewLearningCandidate({
        tenant_id: "tenant-a",
        candidate_id: "candidate-prompt",
        decision: "approved_for_shadow",
        review_note: fixture.label,
        authorization: authorization(fixture.authorization),
        idempotency_key: `review-${index}`,
        expected_revision: 1,
      }),
      fixture.expected,
      fixture.label,
    );
  }
});

test("performance scorecards and governed outcomes remain bounded", async () => {
  const store = createAiLearningFactoryStore({ now: () => timestamp });
  const performance = await store.recordPerformanceScorecard({
    tenant_id: "tenant-a",
    idempotency_key: "idem-performance-1",
    expected_revision: 0,
    record: {
      performance_scorecard_id: "performance-v1",
      release_version: "0.16.0-ai-learning-factory",
      sample_count: 240,
      latency_ms: { p50: 4, p95: 8, p99: 11 },
      ttft_ms: { p50: 1, p95: 2, p99: 3 },
      token_per_verified_outcome: 0,
      cost_per_verified_outcome: 0,
      retry_efficiency: 0.95,
      fallback_efficiency: 0.97,
      bottlenecks: [],
      recommendations: ["Keep mode shadow."],
      evidence_refs: ["evd-performance"],
    },
  });
  assert.equal(performance.auto_scaling_authorized, false);

  const outcome = await store.recordLearningOutcome({
    tenant_id: "tenant-a",
    idempotency_key: "idem-outcome-1",
    expected_revision: 0,
    authorization: authorization(),
    record: {
      outcome_id: "outcome-1",
      run_id: "run-1",
      candidate_id: "candidate-prompt",
      outcome_status: "succeeded",
      outcome_verified: true,
      human_review_status: "approved",
      evidence_digest: "evd-outcome",
      policy_snapshot: "policy-v1",
      observed_at: timestamp,
      learning_value: 0.8,
    },
  });
  assert.equal(outcome.training_triggered, false);
  assert.equal(outcome.external_action_triggered, false);
  assert.equal(outcome.governance.core_verdict, "ALLOW");
  assert.equal(outcome.outcome_verified, false);
  assert.equal(outcome.human_review_status, "pending");
  assert.equal(outcome.learning_value, 0);
  assert.equal(outcome.governance.outcome_attestation_verified, false);
});

test("learning outcome verification is server-resolved and bound to the exact run evidence", async () => {
  const store = createAiLearningFactoryStore({
    now: () => timestamp,
    verifyOutcomeEvidence: async ({ record, expected_binding_digest }) => ({
      verified: record.run_id === "run-existing",
      binding_digest: expected_binding_digest,
      receipt_digest: `sha256:${"c".repeat(64)}`,
      canonical_outcome: {
        ...record,
        outcome_verified: true,
        human_review_status: "approved",
        learning_value: 0.8,
      },
    }),
  });
  const record = {
    outcome_id: "outcome-attested",
    run_id: "run-existing",
    candidate_id: null,
    outcome_status: "succeeded",
    outcome_verified: false,
    human_review_status: "pending",
    evidence_digest: "evd-outcome",
    policy_snapshot: "policy-v1",
    observed_at: timestamp,
    learning_value: 0,
  };
  const verified = await store.recordLearningOutcome({
    tenant_id: "tenant-a",
    idempotency_key: "idem-outcome-attested",
    expected_revision: 0,
    authorization: authorization(),
    record,
  });
  assert.equal(verified.outcome_verified, true);
  assert.equal(verified.governance.outcome_attestation_verified, true);
  assert.match(verified.governance.outcome_attestation_receipt, /^sha256:/);
});

test("optional adapter contract remains tenant-first", async () => {
  const calls = [];
  const adapter = {
    async load(input) { calls.push(["load", input]); return null; },
    async save(input) { calls.push(["save", input]); },
    async list(input) { calls.push(["list", input]); return []; },
  };
  const store = createAiLearningFactoryStore({ adapter, now: () => timestamp });
  await store.recordEvaluationScorecard({
    tenant_id: "tenant-a",
    idempotency_key: "idem-scorecard-1",
    record: scorecard(),
  });
  await store.listEvaluationScorecards({ tenant_id: "tenant-a" });
  assert(calls.every(([, input]) => input.tenant_id === "tenant-a"));
  assert.equal(calls.find(([name]) => name === "save")[1].record.autonomous_execution_allowed, false);

  const persisted = {
    schema_version: "ai_evaluation_scorecard_v0_16",
    tenant_id: "tenant-a",
    ...scorecard(),
    revision: 1,
    created_at: timestamp,
    updated_at: timestamp,
    raw_prompt: "must never leave the adapter",
  };
  const sanitizingStore = createAiLearningFactoryStore({
    adapter: {
      async load() { return persisted; },
      async save() {},
      async list() { return []; },
    },
  });
  const loaded = await sanitizingStore.readEvaluationScorecard({
    tenant_id: "tenant-a",
    record_id: "scorecard-v016",
  });
  assert.equal(Object.hasOwn(loaded, "raw_prompt"), false);
});

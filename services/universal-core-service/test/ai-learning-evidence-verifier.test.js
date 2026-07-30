import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAiLearningCandidateReviewBinding,
  buildAiLearningOutcomeRecordBinding,
  buildAiLearningOutcomeReviewBinding,
  createAiLearningCoreApprovalAttestationService,
  createAiLearningOutcomeEvidenceVerifier,
  createAiLearningReviewBindingReceiptService,
  verifyAiLearningCoreApprovalStatus,
  verifyAiLearningDttBinding,
} from "../src/aiLearningEvidenceVerifier.js";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const TELEMETRY_DIGEST = `art_${"c".repeat(64)}`;
const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z");
const CORE_VERDICT_REFERENCE = `dttv_${"e".repeat(64)}`;
const CORE_EVIDENCE_SET_DIGEST = `dttje_${"f".repeat(24)}`;

function outcome(overrides = {}) {
  return {
    outcome_id: "outcome-1",
    run_id: "run-1",
    candidate_id: null,
    outcome_status: "succeeded",
    outcome_verified: true,
    human_review_status: "approved",
    evidence_digest: "evidence-run-1",
    policy_snapshot: "policy-v016",
    observed_at: "2026-07-28T11:59:30.000Z",
    learning_value: 0.8,
    ...overrides,
  };
}

function telemetry(overrides = {}) {
  return {
    tenant_id: "tenant-a",
    run_id: "run-1",
    telemetry_digest: TELEMETRY_DIGEST,
    evidence_digest: "evidence-run-1",
    policy_snapshot: "policy-v016",
    outcome_status: "succeeded",
    outcome_verified: true,
    quality_verified: true,
    quality_attestation_digest: SHA_A,
    human_review_status: "approved",
    learning_value: 0.8,
    recorded_at: "2026-07-28T11:59:30.000Z",
    ...overrides,
  };
}

function telemetryStore(value) {
  return {
    async read({ tenant_id, run_id }) {
      if (
        !value
        || value.tenant_id !== tenant_id
        || value.run_id !== run_id
      ) return null;
      return structuredClone(value);
    },
  };
}

test("candidate review binding covers the exact revision and all promotion evidence", () => {
  const reviewContext = {
    issued_at: "2026-07-28T11:59:00.000Z",
    expires_at: "2026-07-28T12:04:00.000Z",
    nonce: `airn_${"1".repeat(32)}`,
  };
  const evidence = {
    dataset: {
      tenant_id: "tenant-a",
      dataset_id: "dataset-1",
      dataset_version: "dataset-v1",
      revision: 4,
      provenance_digest: "dataset-provenance",
      label_provenance_digest: "dataset-labels",
      split_digests: { train: "dataset-train", eval: "dataset-eval" },
      evidence_refs: ["dataset-evidence"],
    },
    scorecard: {
      tenant_id: "tenant-a",
      scorecard_id: "scorecard-1",
      revision: 5,
      release_version: "v016",
      dataset_version: "dataset-v1",
      benchmark_manifest_digest: "benchmark-digest",
      metrics: { quality: 1 },
      evidence_refs: ["scorecard-evidence"],
    },
    experiment: {
      tenant_id: "tenant-a",
      experiment_id: "experiment-1",
      experiment_version: "v1",
      revision: 6,
      assignment_integrity: "passed",
      guardrail_metrics: { safety: 1 },
      evidence_refs: ["experiment-evidence"],
      rollback_reference: "experiment-rollback",
    },
  };
  const binding = buildAiLearningCandidateReviewBinding({
    tenant_id: "tenant-a",
    expected_revision: 3,
    decision: "approved_for_shadow",
    candidate: {
      candidate_id: "candidate-1",
      candidate_version: "v1",
      candidate_type: "prompt",
      revision: 3,
      evidence_digest: "evidence-candidate-1",
      dataset_id: "dataset-1",
      dataset_version: "dataset-v1",
      scorecard_id: "scorecard-1",
      experiment_id: "experiment-1",
      rollback_reference: "rollback-1",
    },
    review_context: reviewContext,
    ...evidence,
  });
  assert.match(binding.binding_digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(binding.payload.source_revision, 3);
  assert.equal(binding.payload.resulting_revision, 4);
  assert.equal(binding.payload.evidence_snapshot.dataset.revision, 4);
  assert.throws(
    () => buildAiLearningCandidateReviewBinding({
      tenant_id: "tenant-a",
      expected_revision: 2,
      decision: "approved_for_shadow",
      candidate: {
        candidate_id: "candidate-1",
        candidate_version: "v1",
        candidate_type: "prompt",
        revision: 3,
        evidence_digest: "evidence-candidate-1",
        dataset_id: "dataset-1",
        dataset_version: "dataset-v1",
        scorecard_id: "scorecard-1",
        rollback_reference: "rollback-1",
      },
      review_context: reviewContext,
      ...evidence,
    }),
    /learning_candidate_revision_mismatch/,
  );
});

function durableCandidateApprovalFixture() {
  const reviewedAtMs = NOW_MS;
  const laterMs = NOW_MS + 10 * 60_000;
  const signingSecret = "durable-candidate-approval-test-secret-0123456789";
  const sourceCandidate = {
    tenant_id: "tenant-a",
    candidate_id: "candidate-1",
    candidate_version: "v1",
    candidate_type: "prompt",
    revision: 1,
    evidence_digest: "evidence-candidate-1",
    dataset_id: "dataset-1",
    dataset_version: "dataset-v1",
    scorecard_id: "scorecard-1",
    experiment_id: "experiment-1",
    rollback_reference: "rollback-1",
  };
  const evidence = {
    dataset: {
      tenant_id: "tenant-a",
      dataset_id: "dataset-1",
      dataset_version: "dataset-v1",
      revision: 4,
      provenance_digest: "dataset-provenance",
      label_provenance_digest: "dataset-labels",
      split_digests: { train: "dataset-train", eval: "dataset-eval" },
      evidence_refs: ["dataset-evidence"],
    },
    scorecard: {
      tenant_id: "tenant-a",
      scorecard_id: "scorecard-1",
      revision: 5,
      release_version: "v016",
      dataset_version: "dataset-v1",
      benchmark_manifest_digest: "benchmark-digest",
      metrics: { quality: 1 },
      evidence_refs: ["scorecard-evidence"],
    },
    experiment: {
      tenant_id: "tenant-a",
      experiment_id: "experiment-1",
      experiment_version: "v1",
      revision: 6,
      assignment_integrity: "passed",
      guardrail_metrics: { safety: 1 },
      evidence_refs: ["experiment-evidence"],
      rollback_reference: "experiment-rollback",
    },
  };
  const receiptIssuer = createAiLearningReviewBindingReceiptService({
    secret: signingSecret,
    now: () => reviewedAtMs,
    randomBytes: () => Buffer.alloc(16, 3),
  });
  const issued = receiptIssuer.issue({
    tenant_id: "tenant-a",
    candidate: sourceCandidate,
    expected_revision: 1,
    decision: "approved_for_shadow",
    ...evidence,
  });
  const receipt = Object.fromEntries(
    Object.entries(issued).filter(([key]) => key !== "binding"),
  );
  const bindingVerification = receiptIssuer.verify({
    receipt,
    tenant_id: "tenant-a",
    candidate: sourceCandidate,
    expected_revision: 1,
    decision: "approved_for_shadow",
    ...evidence,
  });
  assert.equal(bindingVerification.verified, true);
  const ownerActorProvenance = `ap_${"1".repeat(32)}`;
  const independentReviewReceiptDigest = `sha256:${"2".repeat(64)}`;
  const approvalAtReview =
    createAiLearningCoreApprovalAttestationService({
      secret: signingSecret,
      now: () => reviewedAtMs,
    });
  const attestation = approvalAtReview.issue({
    tenant_id: "tenant-a",
    candidate: sourceCandidate,
    binding_verification: bindingVerification,
    independent_review: {
      verified: true,
      binding_digest: issued.binding.binding_digest,
      receipt_digest: independentReviewReceiptDigest,
      review_tree_id: "tree-review",
      review_node_id: "verify-review",
      core_verdict_reference: CORE_VERDICT_REFERENCE,
      core_evidence_set_digest: CORE_EVIDENCE_SET_DIGEST,
      artifact_bindings: [{
        artifact_id: "review-binding",
        content_digest: issued.binding.binding_digest,
        source_reference: "urn:ai-learning:review-binding",
      }],
      reviewed_at: new Date(reviewedAtMs).toISOString(),
    },
    owner_actor_provenance: ownerActorProvenance,
  });
  const approvedCandidate = {
    ...sourceCandidate,
    revision: 2,
    status: "approved_for_shadow",
    human_review: {
      decision: "approved_for_shadow",
      reviewed_at: new Date(reviewedAtMs).toISOString(),
      review_expires_at: receipt.expires_at,
      independent_human_review_verified: true,
      independent_review_receipt_digest: independentReviewReceiptDigest,
      independent_review_binding_digest: issued.binding.binding_digest,
      review_tree_id: "tree-review",
      review_node_id: "verify-review",
      owner_actor_provenance: ownerActorProvenance,
      review_binding_receipt: receipt,
      review_binding_payload: issued.binding.payload,
      review_source_revision: 1,
      review_resulting_revision: 2,
      review_evidence_snapshot_digest: receipt.evidence_snapshot_digest,
      core_approval_attestation: attestation,
    },
  };
  const laterReceiptVerifier = createAiLearningReviewBindingReceiptService({
    secret: signingSecret,
    now: () => laterMs,
    randomBytes: () => Buffer.alloc(16, 4),
  });
  const laterApprovalVerifier =
    createAiLearningCoreApprovalAttestationService({
      secret: signingSecret,
      now: () => laterMs,
    });
  const joinVerdictStore = {
    async read() {
      return [
        {
          event_type: "issued",
          verdict_reference: CORE_VERDICT_REFERENCE,
          evidence_set_digest: CORE_EVIDENCE_SET_DIGEST,
          authority: "universal_core",
          allowed: true,
          execution_authorized: false,
        },
        {
          event_type: "consumed",
          verdict_reference: CORE_VERDICT_REFERENCE,
          execution_authorized: false,
        },
      ];
    },
  };
  const verificationTrustStore = {
    async verifyArtifact() {
      return { verified: true };
    },
  };
  return {
    reviewedAtMs,
    laterMs,
    sourceCandidate,
    approvedCandidate,
    evidence,
    receipt,
    bindingVerification,
    attestation,
    ownerActorProvenance,
    laterReceiptVerifier,
    laterApprovalVerifier,
    joinVerdictStore,
    verificationTrustStore,
  };
}

test("durable Core approval remains usable after the five-minute receipt window and fails closed on tamper or revocation", async () => {
  const fixture = durableCandidateApprovalFixture();
  assert.equal(fixture.laterReceiptVerifier.verify({
    receipt: fixture.receipt,
    tenant_id: "tenant-a",
    candidate: fixture.sourceCandidate,
    expected_revision: 1,
    decision: "approved_for_shadow",
    ...fixture.evidence,
  }).verified, false);
  const historicalBinding = fixture.laterReceiptVerifier.verify({
    receipt: fixture.receipt,
    tenant_id: "tenant-a",
    candidate: fixture.sourceCandidate,
    expected_revision: 1,
    decision: "approved_for_shadow",
    valid_at: new Date(fixture.reviewedAtMs).toISOString(),
    ...fixture.evidence,
  });
  assert.equal(historicalBinding.verified, true);
  const approval = fixture.laterApprovalVerifier.verify({
    attestation: fixture.attestation,
    tenant_id: "tenant-a",
    candidate: fixture.approvedCandidate,
    binding_verification: historicalBinding,
    owner_actor_provenance: fixture.ownerActorProvenance,
  });
  assert.equal(approval.verified, true);
  assert.equal((await verifyAiLearningCoreApprovalStatus({
    tenant_id: "tenant-a",
    approval,
    joinVerdictStore: fixture.joinVerdictStore,
    verificationTrustStore: fixture.verificationTrustStore,
  })).verified, true);

  const tampered = {
    ...fixture.attestation,
    evidence_snapshot_digest: SHA_A,
  };
  assert.equal(fixture.laterApprovalVerifier.verify({
    attestation: tampered,
    tenant_id: "tenant-a",
    candidate: fixture.approvedCandidate,
    binding_verification: historicalBinding,
    owner_actor_provenance: fixture.ownerActorProvenance,
  }).verified, false);

  const changedEvidenceBinding = fixture.laterReceiptVerifier.verify({
    receipt: fixture.receipt,
    tenant_id: "tenant-a",
    candidate: fixture.sourceCandidate,
    expected_revision: 1,
    decision: "approved_for_shadow",
    valid_at: new Date(fixture.reviewedAtMs).toISOString(),
    ...fixture.evidence,
    dataset: {
      ...fixture.evidence.dataset,
      provenance_digest: "changed-provenance",
    },
  });
  assert.equal(changedEvidenceBinding.verified, false);

  const revokedStatus = await verifyAiLearningCoreApprovalStatus({
    tenant_id: "tenant-a",
    approval,
    joinVerdictStore: {
      async read() {
        return [
          ...(await fixture.joinVerdictStore.read()),
          {
            event_type: "voided",
            verdict_reference: CORE_VERDICT_REFERENCE,
          },
        ];
      },
    },
    verificationTrustStore: fixture.verificationTrustStore,
  });
  assert.equal(revokedStatus.verified, false);
});

test("candidate-bound outcome verifies after the short review receipt expires", async () => {
  const fixture = durableCandidateApprovalFixture();
  const record = outcome({
    candidate_id: fixture.approvedCandidate.candidate_id,
    candidate_version: fixture.approvedCandidate.candidate_version,
    candidate_revision: fixture.approvedCandidate.revision,
  });
  const verifier = createAiLearningOutcomeEvidenceVerifier({
    telemetryStore: telemetryStore(telemetry()),
    resolveLearningCandidate: async () => structuredClone(
      fixture.approvedCandidate,
    ),
    resolveLearningCandidateEvidence: async () => structuredClone(
      fixture.evidence,
    ),
    verifyCandidateReviewBindingReceipt: async (input) =>
      fixture.laterReceiptVerifier.verify(input),
    verifyCandidateCoreApproval: async ({
      tenant_id,
      candidate,
      review,
      binding_verification,
    }) => {
      const approval = fixture.laterApprovalVerifier.verify({
        attestation: review.core_approval_attestation,
        tenant_id,
        candidate,
        binding_verification,
        owner_actor_provenance: review.owner_actor_provenance,
      });
      const status = await verifyAiLearningCoreApprovalStatus({
        tenant_id,
        approval,
        joinVerdictStore: fixture.joinVerdictStore,
        verificationTrustStore: fixture.verificationTrustStore,
      });
      return status.verified ? approval : { verified: false };
    },
    verifyReviewAttestation: async ({ binding }) => ({
      verified: true,
      binding_digest: binding.binding_digest,
      receipt_digest: SHA_B,
    }),
    now: () => fixture.laterMs,
  });
  const verified = await verifier.verify({
    tenant_id: "tenant-a",
    record,
    expected_binding_digest: buildAiLearningOutcomeRecordBinding({
      tenant_id: "tenant-a",
      outcome: record,
    }),
    review_attestation: {
      tree_id: "tree-outcome-review",
      node_id: "verify-outcome",
    },
  });
  assert.equal(verified.verified, true, JSON.stringify(verified));
});

test("trusted quality evidence verifies only the exact immutable telemetry outcome", async () => {
  const record = outcome();
  const verifier = createAiLearningOutcomeEvidenceVerifier({
    telemetryStore: telemetryStore(telemetry()),
  });
  const result = await verifier.verify({
    tenant_id: "tenant-a",
    record,
    expected_binding_digest: buildAiLearningOutcomeRecordBinding({
      tenant_id: "tenant-a",
      outcome: record,
    }),
  });
  assert.equal(result.verified, true);
  assert.deepEqual(result.canonical_outcome, {
    ...record,
    candidate_version: null,
    candidate_revision: null,
  });
  assert.match(result.receipt_digest, /^sha256:[a-f0-9]{64}$/);
});

test("outcome verification rejects missing or tampered immutable fields", async () => {
  const scenarios = [
    { label: "missing telemetry", stored: null, record: outcome() },
    { label: "evidence", stored: telemetry(), record: outcome({ evidence_digest: "other-evidence" }) },
    { label: "policy", stored: telemetry(), record: outcome({ policy_snapshot: "other-policy" }) },
    { label: "status", stored: telemetry(), record: outcome({ outcome_status: "failed" }) },
    { label: "candidate", stored: telemetry(), record: outcome({ candidate_id: "candidate-unbound" }) },
    { label: "human review", stored: telemetry(), record: outcome({ human_review_status: "pending" }) },
    { label: "learning value", stored: telemetry(), record: outcome({ learning_value: 0.7 }) },
    { label: "observed at", stored: telemetry(), record: outcome({ observed_at: "not-a-date" }) },
  ];
  for (const scenario of scenarios) {
    const verifier = createAiLearningOutcomeEvidenceVerifier({
      telemetryStore: telemetryStore(scenario.stored),
    });
    let expected = SHA_B;
    try {
      expected = buildAiLearningOutcomeRecordBinding({
        tenant_id: "tenant-a",
        outcome: scenario.record,
      });
    } catch {
      // Invalid caller input must still fail closed rather than be treated as verified.
    }
    const result = await verifier.verify({
      tenant_id: "tenant-a",
      record: scenario.record,
      expected_binding_digest: expected,
    }).catch(() => ({ verified: false }));
    assert.equal(result.verified, false, scenario.label);
  }
});

function dttHarness({
  binding,
  sameActor = false,
  ownerActor = false,
  expired = false,
  artifactVerified = true,
} = {}) {
  const attestations = ["agent-a", "agent-b"].map((verifierId, index) => ({
    verifier_id: verifierId,
    assignment_id: `assignment-${index + 1}`,
    decision: "approve",
    rationale: "Exact immutable binding reviewed.",
    identity_receipt: `signed-receipt-${index + 1}`,
    identity_verified: true,
  }));
  const node = {
    node_id: "verify-review",
    kind: "verification",
    status: "verified",
    verification_policy: { required_approvals: 2 },
    evidence: {
      contract_satisfied: true,
      evidence_digest: `evd_${"d".repeat(64)}`,
      artifacts: [{
        artifact_id: "review-binding",
        content_digest: binding.binding_digest,
        source_reference: "urn:ai-learning:review-binding",
      }],
      attestations,
    },
  };
  return {
    dynamicTaskTreeRuntime: {
      async get({ tenant_id, tree_id }) {
        if (tenant_id !== "tenant-a" || tree_id !== "tree-review") {
          throw new Error("cross_tenant_task_tree_denied");
        }
        return {
          tree_id,
          status: "core_joined",
          core_join: {
            authority: "universal_core",
            verdict_reference: CORE_VERDICT_REFERENCE,
            verification: {
              source: "universal_core_persisted_tree_inspection",
              evidence_set_digest: CORE_EVIDENCE_SET_DIGEST,
            },
          },
          nodes: [node],
        };
      },
    },
    receiptService: {
      configured: true,
      async validate({ verifier_id, identity_receipt }) {
        const index = verifier_id === "agent-a" ? 1 : 2;
        if (identity_receipt !== `signed-receipt-${index}`) return { verified: false };
        return {
          verified: true,
          assignment_id: `assignment-${index}`,
          independence_key: ownerActor && index === 1
            ? "owner-actor"
            : sameActor
              ? "same-actor"
              : `actor-${index}`,
          expires_at_ms: expired && index === 1 ? NOW_MS - 1 : NOW_MS + 60_000,
        };
      },
    },
    verificationTrustStore: {
      async verifyArtifact() {
        return { verified: artifactVerified };
      },
    },
    joinVerdictStore: {
      async read() {
        return [
          {
            event_type: "issued",
            verdict_reference: CORE_VERDICT_REFERENCE,
            evidence_set_digest: CORE_EVIDENCE_SET_DIGEST,
            authority: "universal_core",
            allowed: true,
            execution_authorized: false,
          },
          {
            event_type: "consumed",
            verdict_reference: CORE_VERDICT_REFERENCE,
            execution_authorized: false,
          },
        ];
      },
    },
  };
}

test("Core-joined DTT review requires resolvable artifacts, live independent receipts and owner separation", async () => {
  const binding = buildAiLearningOutcomeReviewBinding({
    tenant_id: "tenant-a",
    outcome: outcome(),
    telemetry_digest: TELEMETRY_DIGEST,
  });
  const valid = await verifyAiLearningDttBinding({
    tenant_id: "tenant-a",
    binding,
    review_attestation: { tree_id: "tree-review", node_id: "verify-review" },
    owner_actor_ids: ["owner-actor"],
    now: () => NOW_MS,
    ...dttHarness({ binding }),
  });
  assert.equal(valid.verified, true);
  assert.equal(valid.review_tree_id, "tree-review");
  assert.equal(valid.review_node_id, "verify-review");
  assert.match(valid.receipt_digest, /^sha256:[a-f0-9]{64}$/);

  for (const fixture of [
    { label: "same actor", options: { sameActor: true } },
    { label: "owner actor", options: { ownerActor: true } },
    { label: "expired receipt", options: { expired: true } },
    { label: "unresolvable artifact", options: { artifactVerified: false } },
  ]) {
    const rejected = await verifyAiLearningDttBinding({
      tenant_id: "tenant-a",
      binding,
      review_attestation: { tree_id: "tree-review", node_id: "verify-review" },
      owner_actor_ids: ["owner-actor"],
      now: () => NOW_MS,
      ...dttHarness({ binding, ...fixture.options }),
    });
    assert.equal(rejected.verified, false, fixture.label);
  }
});

test("DTT outcome fallback binds verified state and the exact canonical record", async () => {
  const record = outcome();
  const verifier = createAiLearningOutcomeEvidenceVerifier({
    telemetryStore: telemetryStore(telemetry({
      outcome_verified: false,
      quality_verified: false,
      quality_attestation_digest: null,
      human_review_status: "pending",
      learning_value: 0,
    })),
    verifyReviewAttestation: async ({ binding }) => ({
      verified: true,
      binding_digest: binding.binding_digest,
      receipt_digest: SHA_B,
    }),
  });
  const expected = buildAiLearningOutcomeRecordBinding({
    tenant_id: "tenant-a",
    outcome: record,
  });
  const verified = await verifier.verify({
    tenant_id: "tenant-a",
    record,
    expected_binding_digest: expected,
    review_attestation: { tree_id: "tree-review", node_id: "verify-review" },
    owner_actor_ids: ["owner-actor"],
  });
  assert.equal(verified.verified, true);

  const tampered = await verifier.verify({
    tenant_id: "tenant-a",
    record: { ...record, outcome_verified: false },
    expected_binding_digest: buildAiLearningOutcomeRecordBinding({
      tenant_id: "tenant-a",
      outcome: { ...record, outcome_verified: false },
    }),
    review_attestation: { tree_id: "tree-review", node_id: "verify-review" },
  });
  assert.equal(tampered.verified, false);
});

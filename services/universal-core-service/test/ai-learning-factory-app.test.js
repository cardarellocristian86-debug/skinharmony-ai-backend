import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";
import { createAiLearningFactoryStore } from "../src/aiLearningFactoryStore.js";
import { createAiRuntimeTelemetryStore } from "../src/aiRuntimeTelemetry.js";
import { createDynamicTaskTreeRuntime } from "../src/dynamicTaskTree.js";
import { createFileDynamicTaskTreeJoinVerdictStore } from "../src/dynamicTaskTreeJoinVerdictStore.js";
import { createFileDttVerificationTrustStore } from "../src/dttVerificationTrustStore.js";
import {
  buildVerificationEvidenceContract,
  prepareVerificationEvidenceDraft,
} from "../src/verificationEvidenceContract.js";
import {
  createDttAgentIdentityReceiptService,
  createInMemoryDttAgentIdentityReceiptStore,
  issueDttAgentContext,
} from "../../shared/dtt-agent-identity-receipts.js";

const GATEWAY_KEY = "ai-learning-gateway-key";
const SIGNING_SECRET = "ai-learning-tenant-context-secret-0123456789";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((output, key) => {
    if (value[key] !== undefined) output[key] = canonical(value[key]);
    return output;
  }, {});
}

function signedTenantContext(tenantId) {
  const context = {
    version: "mcp_tenant_context_v1",
    tenant_id: tenantId,
    issued_at: new Date().toISOString(),
  };
  return Buffer.from(JSON.stringify({
    ...context,
    assertion: `mtc_${crypto.createHmac("sha256", SIGNING_SECRET)
      .update(`mcp-tenant-context\u0000${JSON.stringify(context)}`)
      .digest("hex")}`,
  })).toString("base64url");
}

function signedOwnerContext(tenantId, purpose, body, key = GATEWAY_KEY) {
  const bindingPayload = { ...body };
  delete bindingPayload.owner_context;
  const context = {
    assertion_version: "owner_context_assertion_v1",
    audience: "nira_core_bridge",
    tenant_id: tenantId,
    access_mode: "god_mode",
    role: "owner_root",
    delegated_actor: "ai_learning_app_test",
    owner_verified: true,
    owner_actor_provenance: `ap_${"a".repeat(32)}`,
    issued_at: new Date().toISOString(),
    binding_version: "owner_request_binding_v1",
    binding_hash: crypto.createHash("sha256")
      .update(`${purpose}\u0000${JSON.stringify(canonical(bindingPayload))}`)
      .digest("hex"),
  };
  const assertionPayload = JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
    owner_actor_provenance: context.owner_actor_provenance,
    issued_at: context.issued_at,
    binding_version: context.binding_version,
    binding_hash: context.binding_hash,
  });
  return {
    ...context,
    assertion: `ocs_${crypto.createHmac("sha256", key)
      .update(`owner-context\u0000${assertionPayload}`)
      .digest("hex")}`,
  };
}

function candidate(overrides = {}) {
  return {
    candidate_id: "candidate-v016",
    candidate_version: "v1",
    candidate_type: "dataset",
    status: "under_review",
    dataset_id: "dataset-v016",
    dataset_version: "dataset-v1",
    scorecard_id: "scorecard-v016",
    experiment_id: "experiment-v016",
    evidence_digest: "evidence-v016",
    rollback_reference: "rollback-v016",
    proposal_summary: "Remain in shadow pending governed review.",
    risk_review_status: "passed",
    cost_review_status: "passed",
    ...overrides,
  };
}

function telemetry(overrides = {}) {
  return {
    client_type: "chatgpt",
    audience: "chatgpt_connector",
    agent_id: "agent-evaluator",
    session_id: "session-outcome",
    logical_task: `sha256:${"d".repeat(64)}`,
    run_id: "run-candidate-outcome",
    trace_id: "trace-candidate-outcome",
    parent_trace_id: null,
    branch_id: "ai_evaluation_intelligence",
    subbranch_id: "release_scorecard",
    route_reason: "bounded outcome verification",
    route_confidence: 1,
    route_confidence_kind: "router_attested",
    model_provider: "none",
    model_id: "deterministic-evaluator",
    model_snapshot: "snapshot-v016",
    prompt_version: "prompt-v016",
    tool_id: "ai_learning_outcome_record",
    tool_result_status: "succeeded",
    retry_count: 0,
    fallback_path: null,
    handoff_from: null,
    handoff_to: null,
    handoff_verified: false,
    agent_count: 1,
    new_invocations: 0,
    invocation_usage_kind: "provider_unverified",
    tool_call_count: 1,
    artifacts_reused: 1,
    context_avoided: 1,
    context_avoidance_estimate: 1,
    context_avoidance_kind: "estimated",
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    usage_kind: "unavailable",
    actual_cost: null,
    estimated_cost: null,
    usage_source: "host_usage_unavailable",
    rate_card_version: null,
    cost_formula: null,
    provider_receipt_digest: null,
    ttft_ms: 0,
    ttft_observed: false,
    latency_ms: 3,
    latency_observed: true,
    queue_ms: 0,
    queue_observed: false,
    outcome_status: "succeeded",
    outcome_verified: false,
    human_review_status: "pending",
    quality: 0,
    quality_verified: false,
    provider_usage_verified: false,
    evidence_digest: "evidence-candidate-outcome",
    policy_snapshot: "policy-v016",
    rollback_reference: "rollback-candidate-outcome",
    ...overrides,
  };
}

async function seedCandidateEvidence(store) {
  await store.recordDatasetMetadata({
    tenant_id: "tenant-a",
    idempotency_key: "seed-app-dataset",
    expected_revision: 0,
    record: {
      dataset_id: "dataset-v016",
      dataset_version: "dataset-v1",
      case_count: 240,
      provenance_digest: "sha256:dataset-provenance",
      label_provenance_digest: "sha256:label-provenance",
      consent_eligible: true,
      tenant_scope_validated: true,
      redaction_status: "passed",
      data_quality_status: "passed",
      poisoning_status: "clean",
      split_digests: {
        train: "sha256:dataset-train",
        eval: "sha256:dataset-eval",
      },
      retention_expires_at: "2027-07-28T00:00:00.000Z",
      evidence_refs: ["evidence-dataset-v016"],
    },
  });
  await store.recordEvaluationScorecard({
    tenant_id: "tenant-a",
    idempotency_key: "seed-app-scorecard",
    expected_revision: 0,
    record: {
      scorecard_id: "scorecard-v016",
      release_version: "0.16.0-ai-learning-factory",
      dataset_version: "dataset-v1",
      benchmark_manifest_digest: "sha256:benchmark-v016",
      metrics: {
        branch_selection_accuracy: 0.98,
        tool_selection_accuracy: 0.98,
        safety_compliance_score: 1,
      },
      regression_count: 0,
      regressions: [],
      evidence_refs: ["evidence-scorecard-v016"],
      confidence: 0.97,
      limitations: ["shadow-only"],
      proposal: "Keep candidate in shadow.",
    },
  });
  await store.recordCausalExperiment({
    tenant_id: "tenant-a",
    idempotency_key: "seed-app-experiment",
    expected_revision: 0,
    record: {
      experiment_id: "experiment-v016",
      experiment_version: "v1",
      hypothesis: "The candidate preserves safety and quality in shadow.",
      status: "shadow",
      assignment_integrity: "passed",
      guardrail_metrics: { safety_compliance_score: 1 },
      evidence_refs: ["evidence-experiment-v016"],
      rollback_reference: "rollback-experiment-v016",
      promotion_recommendation: "review",
      causal_confidence: 0.9,
    },
  });
}

async function createJoinedReview({
  runtime,
  trustStore,
  receiptService,
  binding,
  candidateId,
  base,
  coreHeaders,
  ownerActorIncluded = false,
}) {
  const nodeId = "verify-review";
  const tree = await runtime.create({
    tenant_id: "tenant-a",
    objective: `Review ${candidateId}`,
    nodes: [{
      node_id: nodeId,
      kind: "verification",
      task: "Verify the exact candidate review binding.",
      depth: 0,
      verification_policy: {
        required_approvals: 2,
        allowed_verifier_ids: ["reviewer-a", "reviewer-b"],
      },
    }],
  });
  const artifact = trustStore.registerArtifact({
    tenant_id: "tenant-a",
    artifact_id: `binding-${candidateId}`,
    content: binding.binding_content,
    source_reference: `urn:ai-learning:${candidateId}`,
    registry_reference: `urn:registry:${candidateId}`,
  });
  const presences = [
    {
      agent_id: "reviewer-a",
      session_fingerprint: `session-${candidateId}-a`,
      signature: `ags_${"a".repeat(32)}`,
      opaque_agent_id: `ai_${"a".repeat(24)}`,
      actor_provenance: ownerActorIncluded
        ? `ap_${"a".repeat(32)}`
        : `ap_${"b".repeat(32)}`,
      client_type: "codex",
    },
    {
      agent_id: "reviewer-b",
      session_fingerprint: `session-${candidateId}-b`,
      signature: `ags_${"b".repeat(32)}`,
      opaque_agent_id: `ai_${"b".repeat(24)}`,
      actor_provenance: `ap_${"c".repeat(32)}`,
      client_type: "codex",
    },
  ];
  const assignments = presences.map((presence) => trustStore.assignVerifier({
    tenant_id: "tenant-a",
    tree_id: tree.tree_id,
    node_id: nodeId,
    verifier_id: presence.agent_id,
    session_fingerprint: presence.session_fingerprint,
    opaque_agent_id: presence.opaque_agent_id,
    actor_provenance: presence.actor_provenance,
  }));
  const draft = prepareVerificationEvidenceDraft({
    tenant_id: "tenant-a",
    tree_id: tree.tree_id,
    node_id: nodeId,
    claim: "The immutable candidate review binding is complete and safe for shadow.",
    artifacts: [artifact],
    provenance: {
      tenant_id: "tenant-a",
      tree_id: tree.tree_id,
      node_id: nodeId,
      producer_id: "review-producer",
      source_type: "deterministic_integration_test",
      source_reference: `urn:producer:${candidateId}`,
    },
    required_approvals: 2,
  });
  const rationale = "Exact binding and evidence were independently verified.";
  const receipts = presences.map((presence, index) => receiptService.issue({
    context_token: issueDttAgentContext({
      secret: "ai-learning-dtt-test-signing-secret-000000000000",
      tenant_id: "tenant-a",
      agent_presence: presence,
    }),
    tenant_id: "tenant-a",
    tree_id: tree.tree_id,
    node_id: nodeId,
    evidence_digest: draft.evidence_digest,
    decision: "approve",
    rationale,
    assignment_id: assignments[index].assignment_id,
  }));
  const evidence = buildVerificationEvidenceContract({
    ...draft,
    votes: receipts.map((receipt) => ({
      verifier_id: receipt.verifier_id,
      identity_receipt: receipt.identity_receipt,
      assignment_id: receipt.assignment_id,
      decision: "approve",
      rationale,
    })),
    required_approvals: 2,
  });
  await runtime.recordOutcome({
    tenant_id: "tenant-a",
    tree_id: tree.tree_id,
    node_id: nodeId,
    outcome: "verified",
    evidence,
  });
  const joinedResponse = await fetch(
    `${base}/v1/orchestration/dtt/${encodeURIComponent(tree.tree_id)}/core-join`,
    {
      method: "POST",
      headers: coreHeaders,
      body: JSON.stringify({}),
    },
  );
  const joinedPayload = await joinedResponse.json();
  assert.equal(joinedResponse.status, 200, JSON.stringify(joinedPayload));
  assert.equal(joinedPayload.status, "core_joined");
  assert.match(joinedPayload.core_join.verdict_reference, /^dttv_[a-f0-9]{64}$/);
  assert.match(
    joinedPayload.core_join.verification.evidence_set_digest,
    /^dttje_[a-f0-9]{24}$/,
  );
  assert.equal(joinedPayload.execution_authorized, false);
  return {
    tree_id: tree.tree_id,
    node_id: nodeId,
  };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("mounted Learning Factory derives tenant and Core proof server-side", async (t) => {
  const learningStore = createAiLearningFactoryStore({
    now: () => "2026-07-27T12:00:00.000Z",
  });
  await learningStore.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-seed-a",
    expected_revision: 0,
    record: candidate(),
  });
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `ai-learning-app-${Date.now()}-${Math.random()}`),
    mcpTenantGatewayKey: GATEWAY_KEY,
    ownerContextSigningSecret: SIGNING_SECRET,
    aiLearningFactoryStore: learningStore,
    aiRuntimeTelemetryStore: createAiRuntimeTelemetryStore(),
    aiLearningFactoryMode: "shadow",
  });
  const { server, base } = await listen(service.app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const headers = {
    authorization: `Bearer ${GATEWAY_KEY}`,
    "content-type": "application/json",
    "x-sh-tenant-id": "tenant-a",
    "x-sh-tenant-context": signedTenantContext("tenant-a"),
  };
  const listed = await fetch(`${base}/v1/ai-learning/candidates?state=under_review`, { headers });
  assert.equal(listed.status, 200);
  const listedPayload = await listed.json();
  assert.equal(listedPayload.tenant_id, "tenant-a");
  assert.deepEqual(listedPayload.candidates.map((item) => item.candidate_id), ["candidate-v016"]);

  const deniedBody = {
    candidate_id: "candidate-v016",
    decision: "deferred",
    review_note: "Unsigned caller request.",
    expected_revision: 1,
    idempotency_key: "review-v016-denied",
    owner_confirmed: true,
    confirmation_reference: "owner-review-v016",
  };
  const denied = await fetch(`${base}/v1/ai-learning/candidates/review`, {
    method: "POST",
    headers,
    body: JSON.stringify(deniedBody),
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, "owner_confirmation_required");

  const allowedBody = {
    ...deniedBody,
    idempotency_key: "review-v016-allowed",
    review_note: "Measured evidence needs another independent review.",
  };
  allowedBody.owner_context = signedOwnerContext(
    "tenant-a",
    "ai_learning_candidate_review",
    allowedBody,
  );
  const allowed = await fetch(`${base}/v1/ai-learning/candidates/review`, {
    method: "POST",
    headers,
    body: JSON.stringify(allowedBody),
  });
  const allowedPayload = await allowed.json();
  assert.equal(allowed.status, 200, JSON.stringify(allowedPayload));
  assert.equal(allowedPayload.candidate.status, "deferred");
  assert.match(allowedPayload.candidate.human_review.audit_reference, /^audit:/);
  assert.match(allowedPayload.candidate.human_review.rollback_reference, /^revision:/);
  assert.equal(allowedPayload.candidate.live_mutation_authorized, false);

  const mismatchedHeaders = {
    ...headers,
    "x-sh-tenant-context": signedTenantContext("tenant-b"),
  };
  const crossTenant = await fetch(`${base}/v1/ai-learning/candidates`, {
    headers: mismatchedHeaders,
  });
  assert.equal(crossTenant.status, 403);
  assert.equal((await crossTenant.json()).error, "tenant_scope_denied");
});

test("public binding preview plus Core-joined DTT proves an independent candidate review", async (t) => {
  const previousAdminKey = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "ai-learning-dtt-admin";
  t.after(() => {
    if (previousAdminKey === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdminKey;
  });
  const storageRoot = path.join(
    os.tmpdir(),
    `ai-learning-dtt-app-${Date.now()}-${Math.random()}`,
  );
  const learningStore = createAiLearningFactoryStore();
  const telemetryStore = createAiRuntimeTelemetryStore();
  await seedCandidateEvidence(learningStore);
  await learningStore.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-dtt-positive",
    expected_revision: 0,
    record: candidate(),
  });
  await learningStore.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-dtt-owner",
    expected_revision: 0,
    record: candidate({
      candidate_id: "candidate-owner-review",
      evidence_digest: "evidence-owner-review",
    }),
  });
  const trustStore = createFileDttVerificationTrustStore({
    root: path.join(storageRoot, "dtt-trust"),
  });
  const joinVerdictStore = createFileDynamicTaskTreeJoinVerdictStore({
    root: path.join(storageRoot, "dtt-join-verdicts"),
  });
  const receiptService = createDttAgentIdentityReceiptService({
    secret: "ai-learning-dtt-test-signing-secret-000000000000",
    store: createInMemoryDttAgentIdentityReceiptStore(),
    resolve_assignment: (input) => trustStore.verifyAssignment(input),
  });
  const runtime = createDynamicTaskTreeRuntime({
    resolve_verifier_identity: (input) => receiptService.validate(input),
    resolve_evidence_artifact: (input) => trustStore.verifyArtifact(input),
  });
  const service = createUniversalCoreService({
    storageRoot,
    mcpTenantGatewayKey: GATEWAY_KEY,
    ownerContextSigningSecret: SIGNING_SECRET,
    aiLearningFactoryStore: learningStore,
    aiRuntimeTelemetryStore: telemetryStore,
    aiLearningFactoryMode: "shadow",
    dynamicTaskTreeRuntime: runtime,
    dttAgentIdentityReceiptService: receiptService,
    dttVerificationTrustStore: trustStore,
    dynamicTaskTreeJoinVerdictStore: joinVerdictStore,
  });
  const { server, base } = await listen(service.app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const headers = {
    authorization: `Bearer ${GATEWAY_KEY}`,
    "content-type": "application/json",
    "x-sh-tenant-id": "tenant-a",
    "x-sh-tenant-context": signedTenantContext("tenant-a"),
  };
  const generatedKeyResponse = await fetch(`${base}/v1/keys/generate`, {
    method: "POST",
    headers: {
      authorization: "Bearer ai-learning-dtt-admin",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      tenant_id: "tenant-a",
      preset: "codex_automation",
    }),
  });
  const generatedKeyPayload = await generatedKeyResponse.json();
  assert.equal(
    generatedKeyResponse.status,
    201,
    JSON.stringify(generatedKeyPayload),
  );
  const coreHeaders = {
    authorization: `Bearer ${generatedKeyPayload.key}`,
    "content-type": "application/json",
  };

  async function preview(candidateId) {
    const response = await fetch(`${base}/v1/ai-learning/review-bindings/preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        candidate_id: candidateId,
        decision: "approved_for_shadow",
        expected_revision: 1,
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    return payload.review_binding;
  }

  async function review(
    candidateId,
    reviewAttestation,
    reviewBindingReceipt,
    idempotencyKey,
    reviewNote = "Independent Core-joined review complete.",
  ) {
    const body = {
      candidate_id: candidateId,
      decision: "approved_for_shadow",
      review_note: reviewNote,
      review_attestation: reviewAttestation,
      review_binding_receipt: reviewBindingReceipt,
      expected_revision: 1,
      idempotency_key: idempotencyKey,
      owner_confirmed: true,
      confirmation_reference: `owner-confirmed-${candidateId}`,
    };
    body.owner_context = signedOwnerContext(
      "tenant-a",
      "ai_learning_candidate_review",
      body,
    );
    const response = await fetch(`${base}/v1/ai-learning/candidates/review`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return { response, payload: await response.json() };
  }

  const positiveBinding = await preview("candidate-v016");
  const positiveAttestation = await createJoinedReview({
    runtime,
    trustStore,
    receiptService,
    binding: positiveBinding,
    candidateId: "candidate-v016",
    base,
    coreHeaders,
  });
  const positive = await review(
    "candidate-v016",
    positiveAttestation,
    positiveBinding.receipt,
    "candidate-dtt-positive-review",
  );
  assert.equal(positive.response.status, 200, JSON.stringify(positive.payload));
  assert.equal(positive.payload.candidate.status, "approved_for_shadow");
  assert.match(
    positive.payload.candidate.human_review.independent_review_receipt_digest,
    /^sha256:[a-f0-9]{64}$/,
  );
  assert.equal(
    positive.payload.candidate.human_review.review_tree_id,
    positiveAttestation.tree_id,
  );
  const positiveReplay = await review(
    "candidate-v016",
    positiveAttestation,
    positiveBinding.receipt,
    "candidate-dtt-positive-review",
  );
  assert.equal(
    positiveReplay.response.status,
    200,
    JSON.stringify(positiveReplay.payload),
  );
  assert.equal(positiveReplay.payload.idempotent_replay, true);
  assert.deepEqual(
    positiveReplay.payload.candidate,
    positive.payload.candidate,
  );
  const positiveConflict = await review(
    "candidate-v016",
    positiveAttestation,
    positiveBinding.receipt,
    "candidate-dtt-positive-review",
    "Changed intent must not reuse the prior idempotency receipt.",
  );
  assert.equal(positiveConflict.response.status, 409);
  assert.equal(
    positiveConflict.payload.error,
    "learning_factory_idempotency_conflict",
  );

  await telemetryStore.record({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-outcome-telemetry",
    telemetry: telemetry(),
  });
  const outcomeRecord = {
    outcome_id: "outcome-candidate-v016",
    run_id: "run-candidate-outcome",
    candidate_id: "candidate-v016",
    candidate_version: "v1",
    candidate_revision: 2,
    outcome_status: "succeeded",
    outcome_verified: true,
    human_review_status: "approved",
    evidence_digest: "evidence-candidate-outcome",
    policy_snapshot: "policy-v016",
    observed_at: new Date().toISOString(),
    learning_value: 0.8,
  };
  const outcomePreviewResponse = await fetch(
    `${base}/v1/ai-learning/review-bindings/preview`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ outcome: outcomeRecord }),
    },
  );
  const outcomePreviewPayload = await outcomePreviewResponse.json();
  assert.equal(
    outcomePreviewResponse.status,
    200,
    JSON.stringify(outcomePreviewPayload),
  );
  assert.equal(
    outcomePreviewPayload.review_binding.binding_kind,
    "learning_outcome",
  );
  const outcomeAttestation = await createJoinedReview({
    runtime,
    trustStore,
    receiptService,
    binding: outcomePreviewPayload.review_binding,
    candidateId: "outcome-candidate-v016",
    base,
    coreHeaders,
  });
  const outcomeBody = {
    outcome: outcomeRecord,
    review_attestation: outcomeAttestation,
    expected_revision: 0,
    idempotency_key: "candidate-bound-outcome-record",
    owner_confirmed: true,
    confirmation_reference: "owner-confirmed-candidate-bound-outcome",
  };
  outcomeBody.owner_context = signedOwnerContext(
    "tenant-a",
    "ai_learning_outcome_record",
    outcomeBody,
  );
  const outcomeResponse = await fetch(`${base}/v1/ai-learning/outcomes`, {
    method: "POST",
    headers,
    body: JSON.stringify(outcomeBody),
  });
  const outcomePayload = await outcomeResponse.json();
  assert.equal(outcomeResponse.status, 201, JSON.stringify(outcomePayload));
  assert.equal(outcomePayload.outcome.candidate_revision, 2);
  assert.equal(
    outcomePayload.outcome.outcome_verified,
    true,
    JSON.stringify(outcomePayload.outcome.governance),
  );
  assert.match(
    outcomePayload.outcome.governance.outcome_attestation_receipt,
    /^sha256:[a-f0-9]{64}$/,
  );
  const outcomeReplayResponse = await fetch(
    `${base}/v1/ai-learning/outcomes`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(outcomeBody),
    },
  );
  const outcomeReplayPayload = await outcomeReplayResponse.json();
  assert.equal(
    outcomeReplayResponse.status,
    201,
    JSON.stringify(outcomeReplayPayload),
  );
  assert.equal(outcomeReplayPayload.idempotent_replay, true);
  assert.deepEqual(outcomeReplayPayload.outcome, outcomePayload.outcome);
  const changedOutcomeBody = {
    ...outcomeBody,
    outcome: {
      ...outcomeBody.outcome,
      learning_value: 0.7,
    },
  };
  changedOutcomeBody.owner_context = signedOwnerContext(
    "tenant-a",
    "ai_learning_outcome_record",
    changedOutcomeBody,
  );
  const outcomeConflictResponse = await fetch(
    `${base}/v1/ai-learning/outcomes`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(changedOutcomeBody),
    },
  );
  const outcomeConflictPayload = await outcomeConflictResponse.json();
  assert.equal(outcomeConflictResponse.status, 409);
  assert.equal(
    outcomeConflictPayload.error,
    "learning_factory_idempotency_conflict",
  );

  const approval = positive.payload.candidate.human_review
    .core_approval_attestation;
  assert.match(approval.signature, /^aica_[a-f0-9]{64}$/);
  const revocationBody = {
    tenant_id: "tenant-a",
    tree_id: approval.review_tree_id,
    verdict_reference: approval.core_verdict_reference,
    reason: "Governed candidate approval withdrawn after review.",
    owner_confirmed: true,
    confirmation_reference: "owner-confirmed-candidate-revocation",
  };
  const revokeApproval = await fetch(
    `${base}/v1/admin/ai-learning/core-approvals/revoke`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer ai-learning-dtt-admin",
        "content-type": "application/json",
      },
      body: JSON.stringify(revocationBody),
    },
  );
  const revokePayload = await revokeApproval.json();
  assert.equal(revokeApproval.status, 200, JSON.stringify(revokePayload));
  assert.equal(revokePayload.execution_authorized, false);
  assert.equal(revokePayload.replayed, false);
  const revokeReplay = await fetch(
    `${base}/v1/admin/ai-learning/core-approvals/revoke`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer ai-learning-dtt-admin",
        "content-type": "application/json",
      },
      body: JSON.stringify(revocationBody),
    },
  );
  const revokeReplayPayload = await revokeReplay.json();
  assert.equal(
    revokeReplay.status,
    200,
    JSON.stringify(revokeReplayPayload),
  );
  assert.equal(revokeReplayPayload.replayed, true);

  await telemetryStore.record({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-revoked-outcome-telemetry",
    telemetry: telemetry({
      run_id: "run-candidate-revoked",
      trace_id: "trace-candidate-revoked",
      evidence_digest: "evidence-candidate-revoked",
      policy_snapshot: "policy-v016-revoked",
      rollback_reference: "rollback-candidate-revoked",
    }),
  });
  const revokedOutcomeRecord = {
    ...outcomeRecord,
    outcome_id: "outcome-candidate-revoked",
    run_id: "run-candidate-revoked",
    evidence_digest: "evidence-candidate-revoked",
    policy_snapshot: "policy-v016-revoked",
    observed_at: new Date().toISOString(),
  };
  const revokedOutcomePreviewResponse = await fetch(
    `${base}/v1/ai-learning/review-bindings/preview`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ outcome: revokedOutcomeRecord }),
    },
  );
  const revokedOutcomePreviewPayload =
    await revokedOutcomePreviewResponse.json();
  assert.equal(
    revokedOutcomePreviewResponse.status,
    200,
    JSON.stringify(revokedOutcomePreviewPayload),
  );
  const revokedOutcomeAttestation = await createJoinedReview({
    runtime,
    trustStore,
    receiptService,
    binding: revokedOutcomePreviewPayload.review_binding,
    candidateId: "outcome-candidate-revoked",
    base,
    coreHeaders,
  });
  const revokedOutcomeBody = {
    outcome: revokedOutcomeRecord,
    review_attestation: revokedOutcomeAttestation,
    expected_revision: 0,
    idempotency_key: "candidate-revoked-outcome-record",
    owner_confirmed: true,
    confirmation_reference:
      "owner-confirmed-candidate-revoked-outcome",
  };
  revokedOutcomeBody.owner_context = signedOwnerContext(
    "tenant-a",
    "ai_learning_outcome_record",
    revokedOutcomeBody,
  );
  const revokedOutcomeResponse = await fetch(
    `${base}/v1/ai-learning/outcomes`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(revokedOutcomeBody),
    },
  );
  const revokedOutcomePayload = await revokedOutcomeResponse.json();
  assert.equal(
    revokedOutcomeResponse.status,
    400,
    JSON.stringify(revokedOutcomePayload),
  );
  assert.equal(
    revokedOutcomePayload.error,
    "learning_outcome_evidence_unverified",
  );

  const ownerBinding = await preview("candidate-owner-review");
  const ownerAttestation = await createJoinedReview({
    runtime,
    trustStore,
    receiptService,
    binding: ownerBinding,
    candidateId: "candidate-owner-review",
    base,
    coreHeaders,
    ownerActorIncluded: true,
  });
  const denied = await review(
    "candidate-owner-review",
    ownerAttestation,
    ownerBinding.receipt,
    "candidate-dtt-owner-review",
  );
  assert.equal(denied.response.status, 400);
  assert.equal(denied.payload.error, "independent_human_review_required");
});

test("off mode removes Learning Factory routes without affecting the service", async (t) => {
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `ai-learning-off-${Date.now()}-${Math.random()}`),
    mcpTenantGatewayKey: GATEWAY_KEY,
    ownerContextSigningSecret: SIGNING_SECRET,
    aiLearningFactoryMode: "off",
  });
  const { server, base } = await listen(service.app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${base}/v1/ai-learning/candidates`, {
    headers: {
      authorization: `Bearer ${GATEWAY_KEY}`,
      "x-sh-tenant-id": "tenant-a",
      "x-sh-tenant-context": signedTenantContext("tenant-a"),
    },
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "route_not_found");
});

test("required persistence blocks AI Learning reads and writes instead of reporting memory-only success", async (t) => {
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `ai-learning-required-${Date.now()}-${Math.random()}`),
    mcpTenantGatewayKey: GATEWAY_KEY,
    ownerContextSigningSecret: SIGNING_SECRET,
    aiLearningFactoryMode: "shadow",
    v016PersistenceRequired: true,
  });
  const { server, base } = await listen(service.app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const headers = {
    authorization: `Bearer ${GATEWAY_KEY}`,
    "content-type": "application/json",
    "x-sh-tenant-id": "tenant-a",
    "x-sh-tenant-context": signedTenantContext("tenant-a"),
  };

  const read = await fetch(`${base}/v1/ai-learning/candidates`, { headers });
  assert.equal(read.status, 503);
  assert.equal((await read.json()).error, "ai_learning_persistence_required");

  const write = await fetch(`${base}/v1/ai-learning/outcomes`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      outcome: {
        outcome_id: "outcome-no-db",
        run_id: "run-no-db",
        outcome_status: "succeeded",
        outcome_verified: true,
        human_review_status: "approved",
        evidence_digest: "evidence-no-db",
        policy_snapshot: "policy-no-db",
        observed_at: "2026-07-27T12:00:00.000Z",
        learning_value: 1,
      },
      expected_revision: 0,
    }),
  });
  assert.equal(write.status, 503);
  assert.equal((await write.json()).error, "ai_learning_persistence_required");
});

test("adapter initialization failure keeps required AI Learning routes unavailable", async (t) => {
  const persistence = {
    learningAdapter: null,
    telemetryAdapter: null,
    initialize: async () => {
      throw new Error("database_unavailable");
    },
    readiness: () => ({
      initialized: false,
      persistence_read_ready: false,
      persistence_write_ready: false,
      runtime_role_attested: false,
      reason: "runtime_role_attestation_query_failed",
    }),
  };
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `ai-learning-init-failure-${Date.now()}-${Math.random()}`),
    mcpTenantGatewayKey: GATEWAY_KEY,
    ownerContextSigningSecret: SIGNING_SECRET,
    aiLearningFactoryMode: "shadow",
    v016PersistenceRequired: true,
    aiLearningFactoryPersistence: persistence,
  });
  const { server, base } = await listen(service.app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const headers = {
    authorization: `Bearer ${GATEWAY_KEY}`,
    "x-sh-tenant-id": "tenant-a",
    "x-sh-tenant-context": signedTenantContext("tenant-a"),
  };
  await new Promise((resolve) => setImmediate(resolve));
  const read = await fetch(`${base}/v1/ai-learning/eval/scorecards`, { headers });
  assert.equal(read.status, 503);
  assert.equal((await read.json()).error, "ai_learning_persistence_required");
});

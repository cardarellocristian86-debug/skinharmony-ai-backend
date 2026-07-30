import crypto from "node:crypto";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const TELEMETRY_DIGEST_PATTERN = /^art_[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:@/-]*$/i;

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}_invalid`);
  }
  return value;
}

function identifier(value, field, max = 240) {
  const normalized = String(value ?? "").trim();
  if (
    !normalized
    || normalized.length > max
    || !IDENTIFIER_PATTERN.test(normalized)
  ) throw new Error(`${field}_invalid`);
  return normalized;
}

function integer(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${field}_invalid`);
  }
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((output, key) => {
    if (value[key] !== undefined) output[key] = canonical(value[key]);
    return output;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(
    typeof value === "string" ? value : canonicalJson(value),
  ).digest("hex")}`;
}

export function digestAiLearningReviewBindingPayload(payload) {
  return digest(canonicalJson(object(payload, "review_binding_payload")));
}

export function digestAiLearningEvidenceSnapshot(snapshot) {
  return digest(object(snapshot, "learning_evidence_snapshot"));
}

function optionalIdentifier(value, field, max = 240) {
  return value === null || value === undefined || value === ""
    ? null
    : identifier(value, field, max);
}

function isoTimestamp(value, field) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field}_invalid`);
  return parsed.toISOString();
}

function stringArrayDigest(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field}_invalid`);
  return digest(value.map((item) => identifier(item, field, 240)).sort());
}

function evidenceRevision(record, field) {
  const revision = integer(record?.revision, `${field}_revision`);
  if (revision < 1) throw new Error(`${field}_revision_invalid`);
  return revision;
}

function candidateEvidenceSnapshot({
  tenant_id,
  candidate,
  dataset,
  scorecard,
  experiment,
} = {}) {
  const tenantId = identifier(tenant_id, "tenant_id", 120);
  const record = object(candidate, "learning_candidate");
  const datasetRecord = object(dataset, "learning_dataset");
  const scorecardRecord = object(scorecard, "learning_scorecard");
  const experimentRecord = object(experiment, "learning_experiment");
  if (
    datasetRecord.tenant_id !== tenantId
    || scorecardRecord.tenant_id !== tenantId
    || experimentRecord.tenant_id !== tenantId
    || datasetRecord.dataset_id !== record.dataset_id
    || datasetRecord.dataset_version !== record.dataset_version
    || scorecardRecord.scorecard_id !== record.scorecard_id
    || experimentRecord.experiment_id !== record.experiment_id
  ) throw new Error("learning_candidate_evidence_snapshot_mismatch");
  return Object.freeze({
    dataset: Object.freeze({
      dataset_id: identifier(datasetRecord.dataset_id, "dataset_id", 200),
      dataset_version: identifier(
        datasetRecord.dataset_version,
        "dataset_version",
        200,
      ),
      revision: evidenceRevision(datasetRecord, "dataset"),
      provenance_digest: identifier(
        datasetRecord.provenance_digest,
        "dataset_provenance_digest",
      ),
      label_provenance_digest: identifier(
        datasetRecord.label_provenance_digest,
        "dataset_label_provenance_digest",
      ),
      split_digests_digest: digest(object(
        datasetRecord.split_digests,
        "dataset_split_digests",
      )),
      evidence_refs_digest: stringArrayDigest(
        datasetRecord.evidence_refs,
        "dataset_evidence_ref",
      ),
    }),
    scorecard: Object.freeze({
      scorecard_id: identifier(
        scorecardRecord.scorecard_id,
        "scorecard_id",
        200,
      ),
      revision: evidenceRevision(scorecardRecord, "scorecard"),
      release_version: identifier(
        scorecardRecord.release_version,
        "scorecard_release_version",
        200,
      ),
      dataset_version: identifier(
        scorecardRecord.dataset_version,
        "scorecard_dataset_version",
        200,
      ),
      benchmark_manifest_digest: identifier(
        scorecardRecord.benchmark_manifest_digest,
        "benchmark_manifest_digest",
      ),
      metrics_digest: digest(object(scorecardRecord.metrics, "scorecard_metrics")),
      evidence_refs_digest: stringArrayDigest(
        scorecardRecord.evidence_refs,
        "scorecard_evidence_ref",
      ),
    }),
    experiment: Object.freeze({
      experiment_id: identifier(
        experimentRecord.experiment_id,
        "experiment_id",
        200,
      ),
      experiment_version: identifier(
        experimentRecord.experiment_version,
        "experiment_version",
        200,
      ),
      revision: evidenceRevision(experimentRecord, "experiment"),
      assignment_integrity: identifier(
        experimentRecord.assignment_integrity,
        "experiment_assignment_integrity",
        80,
      ),
      guardrail_metrics_digest: digest(object(
        experimentRecord.guardrail_metrics,
        "experiment_guardrail_metrics",
      )),
      evidence_refs_digest: stringArrayDigest(
        experimentRecord.evidence_refs,
        "experiment_evidence_ref",
      ),
      rollback_reference: identifier(
        experimentRecord.rollback_reference,
        "experiment_rollback_reference",
      ),
    }),
  });
}

function reviewWindow(value) {
  const context = object(value, "review_binding_context");
  const issuedAt = isoTimestamp(context.issued_at, "review_binding_issued_at");
  const expiresAt = isoTimestamp(context.expires_at, "review_binding_expires_at");
  const nonce = identifier(context.nonce, "review_binding_nonce", 80);
  if (
    !/^airn_[a-f0-9]{32}$/.test(nonce)
    || Date.parse(expiresAt) <= Date.parse(issuedAt)
    || Date.parse(expiresAt) - Date.parse(issuedAt) > 5 * 60_000
  ) throw new Error("review_binding_window_invalid");
  return Object.freeze({
    issued_at: issuedAt,
    expires_at: expiresAt,
    nonce,
  });
}

function candidateLineage(record) {
  const candidateId = optionalIdentifier(record.candidate_id, "candidate_id", 200);
  const candidateVersion = optionalIdentifier(
    record.candidate_version,
    "candidate_version",
    200,
  );
  const candidateRevision = record.candidate_revision === null
    || record.candidate_revision === undefined
    || record.candidate_revision === ""
    ? null
    : integer(record.candidate_revision, "candidate_revision");
  if (
    (candidateId === null && (candidateVersion !== null || candidateRevision !== null))
    || (
      candidateId !== null
      && (candidateVersion === null || candidateRevision === null || candidateRevision < 1)
    )
  ) throw new Error("learning_outcome_candidate_lineage_invalid");
  return Object.freeze({
    candidate_id: candidateId,
    candidate_version: candidateVersion,
    candidate_revision: candidateRevision,
  });
}

export function buildAiLearningCandidateReviewBinding({
  tenant_id,
  candidate,
  expected_revision,
  decision,
  review_context,
  dataset,
  scorecard,
  experiment,
} = {}) {
  const record = object(candidate, "learning_candidate");
  const revision = integer(expected_revision, "expected_revision");
  if (integer(record.revision, "candidate_revision") !== revision) {
    throw new Error("learning_candidate_revision_mismatch");
  }
  if (revision < 1) throw new Error("learning_candidate_revision_mismatch");
  const window = reviewWindow(review_context);
  const evidenceSnapshot = candidateEvidenceSnapshot({
    tenant_id,
    candidate: record,
    dataset,
    scorecard,
    experiment,
  });
  const payload = Object.freeze({
    schema_version: "ai_learning_candidate_review_binding_v0_16",
    tenant_id: identifier(tenant_id, "tenant_id", 120),
    candidate_id: identifier(record.candidate_id, "candidate_id", 200),
    candidate_version: identifier(record.candidate_version, "candidate_version", 200),
    candidate_type: identifier(record.candidate_type, "candidate_type", 80),
    source_revision: revision,
    resulting_revision: revision + 1,
    decision: identifier(decision, "decision", 80),
    evidence_digest: identifier(record.evidence_digest, "evidence_digest"),
    review_window: window,
    evidence_snapshot: evidenceSnapshot,
    rollback_reference: identifier(record.rollback_reference, "rollback_reference"),
  });
  const bindingContent = canonicalJson(payload);
  return Object.freeze({
    payload,
    binding_content: bindingContent,
    binding_digest: digest(bindingContent),
  });
}

export function createAiLearningReviewBindingReceiptService({
  secret,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  ttlMs = 5 * 60_000,
} = {}) {
  const key = String(secret || "");
  if (Buffer.byteLength(key, "utf8") < 32) {
    return Object.freeze({
      configured: false,
      issue() {
        throw new Error("ai_learning_review_binding_signing_unavailable");
      },
      verify() {
        return Object.freeze({ verified: false });
      },
    });
  }
  const ttl = Math.min(Math.max(Number(ttlMs) || 0, 30_000), 5 * 60_000);
  const sign = (unsigned) => `airr_${crypto
    .createHmac("sha256", key)
    .update(`ai-learning-review-binding-receipt\u0000${canonicalJson(unsigned)}`)
    .digest("hex")}`;
  const build = ({
    tenant_id,
    candidate,
    expected_revision,
    decision,
    dataset,
    scorecard,
    experiment,
    issued_at,
    expires_at,
    nonce,
  }) => buildAiLearningCandidateReviewBinding({
    tenant_id,
    candidate,
    expected_revision,
    decision,
    dataset,
    scorecard,
    experiment,
    review_context: { issued_at, expires_at, nonce },
  });
  return Object.freeze({
    configured: true,
    issue(input = {}) {
      const issuedAt = new Date(Number(now())).toISOString();
      const expiresAt = new Date(Date.parse(issuedAt) + ttl).toISOString();
      const nonce = `airn_${randomBytes(16).toString("hex")}`;
      const binding = build({
        ...input,
        issued_at: issuedAt,
        expires_at: expiresAt,
        nonce,
      });
      const unsigned = Object.freeze({
        schema_version: "ai_learning_review_binding_receipt_v0_16",
        tenant_id: binding.payload.tenant_id,
        candidate_id: binding.payload.candidate_id,
        candidate_version: binding.payload.candidate_version,
        source_revision: binding.payload.source_revision,
        resulting_revision: binding.payload.resulting_revision,
        decision: binding.payload.decision,
        issued_at: issuedAt,
        expires_at: expiresAt,
        nonce,
        binding_digest: binding.binding_digest,
        evidence_snapshot_digest: digestAiLearningEvidenceSnapshot(
          binding.payload.evidence_snapshot,
        ),
      });
      return Object.freeze({
        ...unsigned,
        signature: sign(unsigned),
        binding,
      });
    },
    verify({ receipt, valid_at = null, ...input } = {}) {
      let record;
      try {
        record = object(receipt, "review_binding_receipt");
        const allowedKeys = [
          "binding_digest",
          "candidate_id",
          "candidate_version",
          "decision",
          "evidence_snapshot_digest",
          "expires_at",
          "issued_at",
          "nonce",
          "resulting_revision",
          "schema_version",
          "signature",
          "source_revision",
          "tenant_id",
        ];
        const actualKeys = Object.keys(record).sort();
        if (
          actualKeys.length !== allowedKeys.length
          || actualKeys.some((keyName, index) => keyName !== allowedKeys[index])
          || record.schema_version !== "ai_learning_review_binding_receipt_v0_16"
          || !DIGEST_PATTERN.test(String(record.binding_digest || ""))
          || !/^airr_[a-f0-9]{64}$/.test(String(record.signature || ""))
        ) return Object.freeze({ verified: false });
        const unsigned = Object.freeze(Object.fromEntries(
          Object.entries(record).filter(([keyName]) => keyName !== "signature"),
        ));
        const expectedSignature = sign(unsigned);
        const currentTime = Number(now());
        const validationTime = valid_at === null || valid_at === undefined
          ? currentTime
          : Date.parse(String(valid_at || ""));
        if (
          expectedSignature.length !== record.signature.length
          || !crypto.timingSafeEqual(
            Buffer.from(expectedSignature),
            Buffer.from(record.signature),
          )
          || !Number.isFinite(validationTime)
          || validationTime > currentTime + 5_000
          || Date.parse(record.expires_at) <= validationTime
          || Date.parse(record.issued_at) > validationTime + 5_000
        ) return Object.freeze({ verified: false });
        const binding = build({
          ...input,
          issued_at: record.issued_at,
          expires_at: record.expires_at,
          nonce: record.nonce,
        });
        const metadataBound = (
          record.tenant_id === binding.payload.tenant_id
          && record.candidate_id === binding.payload.candidate_id
          && record.candidate_version === binding.payload.candidate_version
          && Number(record.source_revision) === binding.payload.source_revision
          && Number(record.resulting_revision) === binding.payload.resulting_revision
          && record.decision === binding.payload.decision
          && record.binding_digest === binding.binding_digest
          && record.evidence_snapshot_digest
            === digestAiLearningEvidenceSnapshot(binding.payload.evidence_snapshot)
        );
        return Object.freeze({
          verified: metadataBound,
          binding: metadataBound ? binding : null,
          receipt: metadataBound ? Object.freeze({ ...record }) : null,
        });
      } catch {
        return Object.freeze({ verified: false });
      }
    },
  });
}

export function createAiLearningCoreApprovalAttestationService({
  secret,
  now = () => Date.now(),
  revalidationMs = 30 * 24 * 60 * 60_000,
} = {}) {
  const key = String(secret || "");
  if (Buffer.byteLength(key, "utf8") < 32) {
    return Object.freeze({
      configured: false,
      issue() {
        throw new Error("ai_learning_core_approval_signing_unavailable");
      },
      verify() {
        return Object.freeze({ verified: false });
      },
    });
  }
  const revalidationWindow = Math.min(
    Math.max(Number(revalidationMs) || 0, 60 * 60_000),
    90 * 24 * 60 * 60_000,
  );
  const approvalSign = (unsigned) => `aica_${crypto
    .createHmac("sha256", key)
    .update(`ai-learning-core-approval-attestation\u0000${canonicalJson(unsigned)}`)
    .digest("hex")}`;
  const reviewReceiptSign = (unsigned) => `airr_${crypto
    .createHmac("sha256", key)
    .update(`ai-learning-review-binding-receipt\u0000${canonicalJson(unsigned)}`)
    .digest("hex")}`;

  function normalizedArtifacts(value) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error("core_approval_artifacts_invalid");
    }
    return value.map((artifact) => {
      const record = object(artifact, "core_approval_artifact");
      return Object.freeze({
        artifact_id: identifier(record.artifact_id, "artifact_id", 200),
        content_digest: identifier(
          record.content_digest,
          "artifact_content_digest",
        ),
        source_reference: identifier(
          record.source_reference,
          "artifact_source_reference",
          500,
        ),
      });
    }).sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  }

  function reviewReceiptAuthentic(receipt) {
    const record = object(receipt, "review_binding_receipt");
    const unsigned = Object.freeze(Object.fromEntries(
      Object.entries(record).filter(([keyName]) => keyName !== "signature"),
    ));
    const expected = reviewReceiptSign(unsigned);
    return (
      /^airr_[a-f0-9]{64}$/.test(String(record.signature || ""))
      && expected.length === record.signature.length
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(record.signature))
    );
  }

  return Object.freeze({
    configured: true,
    issue({
      tenant_id,
      candidate,
      binding_verification,
      independent_review,
      owner_actor_provenance,
    } = {}) {
      const tenantId = identifier(tenant_id, "tenant_id", 120);
      const record = object(candidate, "learning_candidate");
      const bindingVerification = object(
        binding_verification,
        "review_binding_verification",
      );
      const review = object(independent_review, "independent_review");
      const receipt = object(
        bindingVerification.receipt,
        "review_binding_receipt",
      );
      const binding = object(bindingVerification.binding, "review_binding");
      const ownerActor = identifier(
        owner_actor_provenance,
        "owner_actor_provenance",
        40,
      );
      const reviewedAt = isoTimestamp(review.reviewed_at, "reviewed_at");
      const issuedAt = isoTimestamp(receipt.issued_at, "review_binding_issued_at");
      const expiresAt = isoTimestamp(receipt.expires_at, "review_binding_expires_at");
      const reviewedAtMs = Date.parse(reviewedAt);
      if (
        bindingVerification.verified !== true
        || !reviewReceiptAuthentic(receipt)
        || !/^ap_[a-f0-9]{32}$/.test(ownerActor)
        || review.verified !== true
        || review.binding_digest !== binding.binding_digest
        || review.binding_digest !== receipt.binding_digest
        || !DIGEST_PATTERN.test(String(review.receipt_digest || ""))
        || !/^dttv_[a-f0-9]{64}$/.test(String(review.core_verdict_reference || ""))
        || !/^dttje_[a-f0-9]{24}$/.test(String(review.core_evidence_set_digest || ""))
        || reviewedAtMs < Date.parse(issuedAt)
        || reviewedAtMs >= Date.parse(expiresAt)
        || reviewedAtMs > Number(now()) + 5_000
        || record.tenant_id !== tenantId
        || record.candidate_id !== binding.payload.candidate_id
        || record.candidate_version !== binding.payload.candidate_version
        || Number(record.revision) !== Number(binding.payload.source_revision)
      ) throw new Error("ai_learning_core_approval_attestation_invalid");
      const artifacts = normalizedArtifacts(review.artifact_bindings);
      if (!artifacts.some((artifact) =>
        artifact.content_digest === binding.binding_digest)) {
        throw new Error("ai_learning_core_approval_artifact_unbound");
      }
      const unsigned = Object.freeze({
        schema_version: "ai_learning_core_approval_attestation_v0_16",
        tenant_id: tenantId,
        candidate_id: binding.payload.candidate_id,
        candidate_version: binding.payload.candidate_version,
        candidate_type: binding.payload.candidate_type,
        decision: "approved_for_shadow",
        source_revision: binding.payload.source_revision,
        resulting_revision: binding.payload.resulting_revision,
        binding_digest: binding.binding_digest,
        evidence_snapshot_digest: receipt.evidence_snapshot_digest,
        independent_review_receipt_digest: review.receipt_digest,
        review_tree_id: identifier(review.review_tree_id, "review_tree_id", 160),
        review_node_id: identifier(review.review_node_id, "review_node_id", 120),
        core_verdict_reference: review.core_verdict_reference,
        core_evidence_set_digest: review.core_evidence_set_digest,
        artifact_bindings: artifacts,
        owner_actor_provenance: ownerActor,
        reviewed_at: reviewedAt,
        review_window_issued_at: issuedAt,
        review_window_expires_at: expiresAt,
        revalidation_due_at: new Date(reviewedAtMs + revalidationWindow).toISOString(),
      });
      return Object.freeze({
        ...unsigned,
        signature: approvalSign(unsigned),
      });
    },

    verify({
      attestation,
      tenant_id,
      candidate,
      binding_verification,
      owner_actor_provenance,
    } = {}) {
      try {
        const record = object(attestation, "core_approval_attestation");
        const unsigned = Object.freeze(Object.fromEntries(
          Object.entries(record).filter(([keyName]) => keyName !== "signature"),
        ));
        const expected = approvalSign(unsigned);
        const candidateRecord = object(candidate, "learning_candidate");
        const bindingVerification = object(
          binding_verification,
          "review_binding_verification",
        );
        const binding = object(bindingVerification.binding, "review_binding");
        const reviewedAtMs = Date.parse(String(record.reviewed_at || ""));
        if (
          record.schema_version !== "ai_learning_core_approval_attestation_v0_16"
          || !/^aica_[a-f0-9]{64}$/.test(String(record.signature || ""))
          || expected.length !== record.signature.length
          || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(record.signature))
          || bindingVerification.verified !== true
          || record.tenant_id !== identifier(tenant_id, "tenant_id", 120)
          || record.tenant_id !== candidateRecord.tenant_id
          || record.candidate_id !== candidateRecord.candidate_id
          || record.candidate_version !== candidateRecord.candidate_version
          || record.candidate_type !== candidateRecord.candidate_type
          || record.decision !== "approved_for_shadow"
          || Number(record.resulting_revision) !== Number(candidateRecord.revision)
          || Number(record.source_revision) + 1 !== Number(record.resulting_revision)
          || record.binding_digest !== binding.binding_digest
          || record.evidence_snapshot_digest
            !== digestAiLearningEvidenceSnapshot(binding.payload.evidence_snapshot)
          || record.owner_actor_provenance !== owner_actor_provenance
          || reviewedAtMs < Date.parse(String(record.review_window_issued_at || ""))
          || reviewedAtMs >= Date.parse(String(record.review_window_expires_at || ""))
          || Date.parse(String(record.revalidation_due_at || "")) <= Number(now())
          || !Array.isArray(record.artifact_bindings)
          || !record.artifact_bindings.some((artifact) =>
            artifact?.content_digest === binding.binding_digest)
        ) return Object.freeze({ verified: false });
        return Object.freeze({
          verified: true,
          binding_digest: record.binding_digest,
          independent_review_receipt_digest:
            record.independent_review_receipt_digest,
          core_verdict_reference: record.core_verdict_reference,
          core_evidence_set_digest: record.core_evidence_set_digest,
          review_tree_id: record.review_tree_id,
          review_node_id: record.review_node_id,
          artifact_bindings: Object.freeze(normalizedArtifacts(
            record.artifact_bindings,
          )),
          reviewed_at: record.reviewed_at,
          revalidation_due_at: record.revalidation_due_at,
        });
      } catch {
        return Object.freeze({ verified: false });
      }
    },
  });
}

export async function verifyAiLearningCoreApprovalStatus({
  tenant_id,
  approval,
  joinVerdictStore,
  verificationTrustStore,
} = {}) {
  if (
    approval?.verified !== true
    || !joinVerdictStore
    || typeof joinVerdictStore.read !== "function"
    || !verificationTrustStore
    || typeof verificationTrustStore.verifyArtifact !== "function"
  ) return Object.freeze({ verified: false });
  const tenantId = identifier(tenant_id, "tenant_id", 120);
  let verdictEvents;
  try {
    verdictEvents = await joinVerdictStore.read({
      tenant_id: tenantId,
      tree_id: identifier(approval.review_tree_id, "review_tree_id", 160),
    });
  } catch {
    return Object.freeze({ verified: false });
  }
  const events = Array.isArray(verdictEvents) ? verdictEvents : [];
  const issued = events.find((event) =>
    event?.event_type === "issued"
    && event.verdict_reference === approval.core_verdict_reference);
  const consumed = events.find((event) =>
    event?.event_type === "consumed"
    && event.verdict_reference === approval.core_verdict_reference);
  const revoked = events.some((event) =>
    ["voided", "revoked"].includes(event?.event_type)
    && event.verdict_reference === approval.core_verdict_reference);
  if (
    !issued
    || !consumed
    || revoked
    || issued.authority !== "universal_core"
    || issued.allowed !== true
    || issued.execution_authorized !== false
    || issued.evidence_set_digest !== approval.core_evidence_set_digest
  ) return Object.freeze({ verified: false });
  for (const artifact of approval.artifact_bindings || []) {
    const status = await verificationTrustStore.verifyArtifact({
      tenant_id: tenantId,
      artifact_id: artifact.artifact_id,
      content_digest: artifact.content_digest,
      source_reference: artifact.source_reference,
    });
    if (status?.verified !== true) return Object.freeze({ verified: false });
  }
  return Object.freeze({ verified: true });
}

export function buildAiLearningOutcomeReviewBinding({
  tenant_id,
  outcome,
  telemetry_digest,
} = {}) {
  const record = object(outcome, "learning_outcome");
  const lineage = candidateLineage(record);
  const observedAt = new Date(String(record.observed_at || ""));
  const learningValue = Number(record.learning_value);
  if (
    Number.isNaN(observedAt.getTime())
    || !Number.isFinite(learningValue)
    || learningValue < 0
    || learningValue > 1
  ) throw new Error("learning_outcome_review_binding_invalid");
  const payload = Object.freeze({
    schema_version: "ai_learning_outcome_review_binding_v0_16",
    tenant_id: identifier(tenant_id, "tenant_id", 120),
    outcome_id: identifier(record.outcome_id, "outcome_id", 200),
    run_id: identifier(record.run_id, "run_id", 200),
    ...lineage,
    outcome_status: identifier(record.outcome_status, "outcome_status", 80),
    outcome_verified: record.outcome_verified === true,
    human_review_status: identifier(
      record.human_review_status,
      "human_review_status",
      80,
    ),
    evidence_digest: identifier(record.evidence_digest, "evidence_digest"),
    policy_snapshot: identifier(record.policy_snapshot, "policy_snapshot"),
    observed_at: observedAt.toISOString(),
    learning_value: learningValue,
    telemetry_digest: identifier(telemetry_digest, "telemetry_digest", 240),
  });
  const bindingContent = canonicalJson(payload);
  return Object.freeze({
    payload,
    binding_content: bindingContent,
    binding_digest: digest(bindingContent),
  });
}

export function buildAiLearningOutcomeRecordBinding({
  tenant_id,
  outcome,
} = {}) {
  const record = object(outcome, "learning_outcome");
  const lineage = candidateLineage(record);
  const observedAt = new Date(String(record.observed_at || ""));
  const learningValue = Number(record.learning_value);
  if (
    Number.isNaN(observedAt.getTime())
    || !Number.isFinite(learningValue)
    || learningValue < 0
    || learningValue > 1
  ) throw new Error("learning_outcome_binding_invalid");
  return digest({
    schema_version: "ai_learning_outcome_binding_v0_16",
    tenant_id: identifier(tenant_id, "tenant_id", 120),
    outcome_id: identifier(record.outcome_id, "outcome_id", 200),
    run_id: identifier(record.run_id, "run_id", 200),
    ...lineage,
    outcome_status: identifier(record.outcome_status, "outcome_status", 80),
    outcome_verified: record.outcome_verified === true,
    human_review_status: identifier(
      record.human_review_status,
      "human_review_status",
      80,
    ),
    evidence_digest: identifier(record.evidence_digest, "evidence_digest"),
    policy_snapshot: identifier(record.policy_snapshot, "policy_snapshot"),
    observed_at: observedAt.toISOString(),
    learning_value: learningValue,
  });
}

export function createAiLearningOutcomeEvidenceVerifier({
  telemetryStore,
  resolveLearningCandidate = async () => null,
  resolveLearningCandidateEvidence = async () => null,
  verifyCandidateReviewBindingReceipt = async () => ({ verified: false }),
  verifyCandidateCoreApproval = async () => ({ verified: false }),
  verifyReviewAttestation = async () => ({ verified: false }),
  now = () => Date.now(),
} = {}) {
  if (!telemetryStore || typeof telemetryStore.read !== "function") {
    throw new Error("ai_learning_telemetry_store_required");
  }
  if (typeof verifyReviewAttestation !== "function") {
    throw new Error("ai_learning_review_attestation_verifier_required");
  }
  if (typeof resolveLearningCandidate !== "function") {
    throw new Error("ai_learning_candidate_resolver_required");
  }
  if (
    typeof resolveLearningCandidateEvidence !== "function"
    || typeof verifyCandidateReviewBindingReceipt !== "function"
    || typeof verifyCandidateCoreApproval !== "function"
  ) throw new Error("ai_learning_candidate_review_resolver_required");
  return Object.freeze({
    async verify({
      tenant_id,
      record,
      expected_binding_digest,
      review_attestation = null,
      owner_actor_ids = [],
    } = {}) {
      const tenantId = identifier(tenant_id, "tenant_id", 120);
      const requested = object(record, "learning_outcome");
      const expectedBinding = identifier(
        expected_binding_digest,
        "expected_binding_digest",
        240,
      );
      if (!DIGEST_PATTERN.test(expectedBinding)) {
        throw new Error("expected_binding_digest_invalid");
      }
      const runId = identifier(requested.run_id, "run_id", 200);
      const lineage = candidateLineage(requested);
      let candidate = null;
      if (lineage.candidate_id !== null) {
        candidate = await resolveLearningCandidate({
          tenant_id: tenantId,
          candidate_id: lineage.candidate_id,
        });
        const review = candidate?.human_review;
        const ownerActorProvenance = String(
          review?.owner_actor_provenance || "",
        ).trim();
        const reviewSourceRevision = Number(review?.review_source_revision);
        const reviewResultingRevision = Number(review?.review_resulting_revision);
        const currentCandidateRevision = Number(candidate?.revision);
        let evidenceRecords = null;
        let bindingReceiptVerification = null;
        let coreApprovalVerification = null;
        let persistedBindingPayloadDigest = null;
        try {
          evidenceRecords = await resolveLearningCandidateEvidence({
            tenant_id: tenantId,
            candidate,
          });
          bindingReceiptVerification = await verifyCandidateReviewBindingReceipt({
            receipt: review.review_binding_receipt,
            tenant_id: tenantId,
            candidate: {
              ...candidate,
              revision: reviewSourceRevision,
            },
            expected_revision: reviewSourceRevision,
            decision: "approved_for_shadow",
            valid_at: review?.reviewed_at,
            ...object(evidenceRecords, "learning_candidate_evidence"),
          });
          persistedBindingPayloadDigest = digestAiLearningReviewBindingPayload(
            review?.review_binding_payload,
          );
          coreApprovalVerification = await verifyCandidateCoreApproval({
            tenant_id: tenantId,
            candidate,
            evidence: evidenceRecords,
            review,
            binding_verification: bindingReceiptVerification,
          });
        } catch {
          return Object.freeze({
            verified: false,
            reason: "candidate_review_binding_unresolved",
          });
        }
        const candidateBinding = bindingReceiptVerification?.binding;
        const reviewExpiresAtMs = Date.parse(String(review?.review_expires_at || ""));
        const reviewedAtMs = Date.parse(String(review?.reviewed_at || ""));
        const candidateMetadataBound = Boolean(
          candidate
          && candidate.tenant_id === tenantId
          && candidate.candidate_id === lineage.candidate_id
          && candidate.candidate_version === lineage.candidate_version
          && currentCandidateRevision === lineage.candidate_revision
          && Number.isSafeInteger(reviewSourceRevision)
          && reviewSourceRevision >= 1
          && reviewResultingRevision === reviewSourceRevision + 1
          && currentCandidateRevision === reviewResultingRevision
          && candidate.status === "approved_for_shadow"
          && review?.decision === "approved_for_shadow"
          && review?.independent_human_review_verified === true
          && DIGEST_PATTERN.test(String(
            review?.independent_review_receipt_digest || "",
          ))
          && bindingReceiptVerification?.verified === true
          && coreApprovalVerification?.verified === true
          && coreApprovalVerification.binding_digest
            === candidateBinding?.binding_digest
          && coreApprovalVerification.independent_review_receipt_digest
            === review?.independent_review_receipt_digest
          && candidateBinding?.binding_digest === String(
            review?.independent_review_binding_digest || "",
          )
          && persistedBindingPayloadDigest === candidateBinding?.binding_digest
          && review?.review_binding_receipt?.binding_digest
            === candidateBinding?.binding_digest
          && review?.review_evidence_snapshot_digest
            === digestAiLearningEvidenceSnapshot(
              candidateBinding?.payload?.evidence_snapshot,
            )
          && /^[a-z0-9][a-z0-9._:@/-]*$/i.test(String(review?.review_tree_id || ""))
          && /^[a-z0-9][a-z0-9._:@/-]*$/i.test(String(review?.review_node_id || ""))
          && /^ap_[a-f0-9]{32}$/.test(ownerActorProvenance)
          && Number.isFinite(reviewedAtMs)
          && Number.isFinite(reviewExpiresAtMs)
          && reviewedAtMs <= reviewExpiresAtMs
        );
        if (!candidateMetadataBound) {
          return Object.freeze({
            verified: false,
            reason: "candidate_review_metadata_unbound",
          });
        }
      }
      const telemetry = await telemetryStore.read({
        tenant_id: tenantId,
        run_id: runId,
      });
      const immutableTelemetryBound = Boolean(
        telemetry
        && telemetry.tenant_id === tenantId
        && telemetry.run_id === runId
        && TELEMETRY_DIGEST_PATTERN.test(String(telemetry.telemetry_digest || ""))
        && telemetry.evidence_digest === requested.evidence_digest
        && telemetry.policy_snapshot === requested.policy_snapshot
        && telemetry.outcome_status === requested.outcome_status
        && Number.isFinite(Date.parse(String(telemetry.recorded_at || "")))
      );
      if (!immutableTelemetryBound) {
        return Object.freeze({
          verified: false,
          reason: "outcome_telemetry_unbound",
        });
      }
      const telemetryObservedAt = new Date(telemetry.recorded_at).toISOString();
      const requestedObservedAtMs = Date.parse(String(requested.observed_at || ""));
      const trustedQualityBound = Boolean(
        lineage.candidate_id === null
        &&
        telemetry.outcome_verified === true
        && telemetry.quality_verified === true
        && DIGEST_PATTERN.test(String(telemetry.quality_attestation_digest || ""))
        && telemetry.human_review_status === "approved"
        && requested.outcome_verified === true
        && requested.human_review_status === "approved"
        && Number.isFinite(requestedObservedAtMs)
        && new Date(requestedObservedAtMs).toISOString() === telemetryObservedAt
        && Number.isFinite(Number(telemetry.learning_value))
        && Number(telemetry.learning_value) >= 0
        && Number(telemetry.learning_value) <= 1
        && Number(requested.learning_value) === Number(telemetry.learning_value)
      );
      let reviewVerification = null;
      let outcomeBinding = null;
      if (!trustedQualityBound && review_attestation) {
        outcomeBinding = buildAiLearningOutcomeReviewBinding({
          tenant_id: tenantId,
          outcome: requested,
          telemetry_digest: telemetry.telemetry_digest,
        });
        reviewVerification = await verifyReviewAttestation({
          tenant_id: tenantId,
          binding: outcomeBinding,
          review_attestation,
          owner_actor_ids,
        });
      }
      const dttReviewBound = Boolean(
        reviewVerification?.verified === true
        && outcomeBinding
        && reviewVerification.binding_digest === outcomeBinding.binding_digest
        && DIGEST_PATTERN.test(String(reviewVerification.receipt_digest || ""))
        && requested.human_review_status === "approved"
      );
      if (!trustedQualityBound && !dttReviewBound) {
        return Object.freeze({
          verified: false,
          reason: "outcome_review_attestation_unbound",
        });
      }
      const canonicalOutcome = Object.freeze({
        ...requested,
        ...lineage,
        outcome_verified: true,
        human_review_status: "approved",
        observed_at: trustedQualityBound
          ? telemetryObservedAt
          : new Date(requested.observed_at).toISOString(),
        learning_value: trustedQualityBound
          ? Number(telemetry.learning_value)
          : Number(requested.learning_value),
      });
      if (
        buildAiLearningOutcomeRecordBinding({
          tenant_id: tenantId,
          outcome: canonicalOutcome,
        }) !== expectedBinding
      ) {
        return Object.freeze({
          verified: false,
          reason: "outcome_record_binding_mismatch",
        });
      }
      return Object.freeze({
        verified: true,
        binding_digest: expectedBinding,
        receipt_digest: digest({
          schema_version: "ai_learning_outcome_attestation_receipt_v0_16",
          tenant_id: tenantId,
          run_id: runId,
          expected_binding_digest: expectedBinding,
          telemetry_digest: telemetry.telemetry_digest,
          verification_kind: trustedQualityBound
            ? "trusted_quality_attestation"
            : "core_joined_dtt_review",
          quality_attestation_digest: trustedQualityBound
            ? telemetry.quality_attestation_digest
            : null,
          review_receipt_digest: dttReviewBound
            ? reviewVerification.receipt_digest
            : null,
        }),
        canonical_outcome: canonicalOutcome,
      });
    },
  });
}

export async function verifyAiLearningDttBinding({
  tenant_id,
  binding,
  review_attestation,
  owner_actor_ids = [],
  dynamicTaskTreeRuntime,
  receiptService,
  verificationTrustStore,
  joinVerdictStore,
  now = () => Date.now(),
} = {}) {
  if (
    !dynamicTaskTreeRuntime
    || typeof dynamicTaskTreeRuntime.get !== "function"
    || !receiptService?.configured
    || typeof receiptService.validate !== "function"
    || !verificationTrustStore
    || typeof verificationTrustStore.verifyArtifact !== "function"
    || !joinVerdictStore
    || typeof joinVerdictStore.read !== "function"
  ) return Object.freeze({ verified: false });
  const tenantId = identifier(tenant_id, "tenant_id", 120);
  const immutableBinding = object(binding, "review_binding");
  if (!DIGEST_PATTERN.test(String(immutableBinding.binding_digest || ""))) {
    throw new Error("review_binding_digest_invalid");
  }
  const attestationRef = object(review_attestation, "review_attestation");
  const allowedKeys = ["node_id", "tree_id"];
  const actualKeys = Object.keys(attestationRef).sort();
  if (
    actualKeys.length !== allowedKeys.length
    || actualKeys.some((key, index) => key !== allowedKeys[index])
  ) throw new Error("review_attestation_schema_invalid");
  const treeId = identifier(attestationRef.tree_id, "review_tree_id", 160);
  const nodeId = identifier(attestationRef.node_id, "review_node_id", 120);
  const tree = await dynamicTaskTreeRuntime.get({
    tenant_id: tenantId,
    tree_id: treeId,
  });
  const node = Array.isArray(tree.nodes)
    ? tree.nodes.find((item) => item?.node_id === nodeId)
    : null;
  const verdictReference = String(tree.core_join?.verdict_reference || "").trim();
  const evidenceSetDigest = String(
    tree.core_join?.verification?.evidence_set_digest || "",
  ).trim();
  if (
    tree.status !== "core_joined"
    || tree.core_join?.authority !== "universal_core"
    || !/^dttv_[a-f0-9]{64}$/.test(verdictReference)
    || !/^dttje_[a-f0-9]{24}$/.test(evidenceSetDigest)
    || !node
    || node.kind !== "verification"
    || node.status !== "verified"
    || node.evidence?.contract_satisfied !== true
    || !Array.isArray(node.evidence?.artifacts)
    || !node.evidence.artifacts.some(
      (artifact) => artifact?.content_digest === immutableBinding.binding_digest,
    )
    || !Array.isArray(node.evidence?.attestations)
    || node.evidence.attestations.length < Number(node.verification_policy?.required_approvals || 2)
  ) return Object.freeze({ verified: false });

  let verdictEvents;
  try {
    verdictEvents = await joinVerdictStore.read({
      tenant_id: tenantId,
      tree_id: treeId,
    });
  } catch {
    return Object.freeze({ verified: false });
  }
  const issuedVerdict = Array.isArray(verdictEvents)
    ? verdictEvents.find((event) => (
      event?.event_type === "issued"
      && event.verdict_reference === verdictReference
    ))
    : null;
  const consumedVerdict = Array.isArray(verdictEvents)
    ? verdictEvents.find((event) => (
      event?.event_type === "consumed"
      && event.verdict_reference === verdictReference
    ))
    : null;
  const verdictVoided = Array.isArray(verdictEvents)
    && verdictEvents.some((event) => (
      ["voided", "revoked"].includes(event?.event_type)
      && event.verdict_reference === verdictReference
    ));
  if (
    !issuedVerdict
    || !consumedVerdict
    || verdictVoided
    || issuedVerdict.authority !== "universal_core"
    || issuedVerdict.allowed !== true
    || issuedVerdict.execution_authorized !== false
    || issuedVerdict.evidence_set_digest !== evidenceSetDigest
    || consumedVerdict.execution_authorized !== false
  ) return Object.freeze({ verified: false });

  for (const artifact of node.evidence.artifacts) {
    const artifactResolution = await verificationTrustStore.verifyArtifact({
      tenant_id: tenantId,
      artifact_id: artifact.artifact_id,
      content_digest: artifact.content_digest,
      source_reference: artifact.source_reference,
    });
    if (artifactResolution?.verified !== true) return Object.freeze({ verified: false });
  }

  const ownerActors = new Set(
    (Array.isArray(owner_actor_ids) ? owner_actor_ids : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  const resolutions = [];
  for (const attestation of node.evidence.attestations) {
    if (
      attestation?.decision !== "approve"
      || attestation?.identity_verified !== true
      || !String(attestation?.identity_receipt || "").trim()
    ) return Object.freeze({ verified: false });
    const resolution = await receiptService.validate({
      tenant_id: tenantId,
      tree_id: treeId,
      node_id: nodeId,
      evidence_digest: node.evidence.evidence_digest,
      decision: attestation.decision,
      rationale: attestation.rationale,
      verifier_id: attestation.verifier_id,
      identity_receipt: attestation.identity_receipt,
    });
    if (
      resolution?.verified !== true
      || resolution.assignment_id !== attestation.assignment_id
      || !String(resolution.independence_key || "").trim()
      || ownerActors.has(String(resolution.independence_key))
      || ownerActors.has(String(attestation.verifier_id))
      || !Number.isFinite(Number(resolution.expires_at_ms))
      || Number(resolution.expires_at_ms) < Number(now())
    ) return Object.freeze({ verified: false });
    resolutions.push(resolution);
  }
  const independenceKeys = resolutions.map((resolution) => String(resolution.independence_key));
  if (new Set(independenceKeys).size !== independenceKeys.length) {
    return Object.freeze({ verified: false });
  }
  const expiresAtMs = Math.min(...resolutions.map(
    (resolution) => Number(resolution.expires_at_ms),
  ));
  const reviewedAtMs = Number(now());
  return Object.freeze({
    verified: true,
    binding_digest: immutableBinding.binding_digest,
    receipt_digest: digest({
      schema_version: "ai_learning_independent_review_receipt_v0_16",
      tenant_id: tenantId,
      tree_id: treeId,
      node_id: nodeId,
      evidence_digest: node.evidence.evidence_digest,
      binding_digest: immutableBinding.binding_digest,
      core_verdict_reference: verdictReference,
      core_evidence_set_digest: evidenceSetDigest,
      independence_keys: independenceKeys.sort(),
    }),
    reviewer_reference: `dtt-review:${digest({
      tenant_id: tenantId,
      tree_id: treeId,
      node_id: nodeId,
    })}`,
    review_tree_id: treeId,
    review_node_id: nodeId,
    reviewed_at: new Date(reviewedAtMs).toISOString(),
    review_expires_at: new Date(expiresAtMs).toISOString(),
    core_verdict_reference: verdictReference,
    core_evidence_set_digest: evidenceSetDigest,
    artifact_bindings: Object.freeze(node.evidence.artifacts.map((artifact) =>
      Object.freeze({
        artifact_id: identifier(artifact.artifact_id, "artifact_id", 200),
        content_digest: identifier(
          artifact.content_digest,
          "artifact_content_digest",
        ),
        source_reference: identifier(
          artifact.source_reference,
          "artifact_source_reference",
          500,
        ),
      }))),
  });
}

export async function verifyAiLearningCandidateDttReview({
  tenant_id,
  candidate,
  expected_revision,
  decision,
  review_attestation,
  owner_actor_ids = [],
  dynamicTaskTreeRuntime,
  receiptService,
  verificationTrustStore,
  joinVerdictStore,
  now = () => Date.now(),
} = {}) {
  if (decision !== "approved_for_shadow") return Object.freeze({ verified: false });
  const tenantId = identifier(tenant_id, "tenant_id", 120);
  const binding = buildAiLearningCandidateReviewBinding({
    tenant_id: tenantId,
    candidate,
    expected_revision,
    decision,
  });
  return verifyAiLearningDttBinding({
    tenant_id: tenantId,
    binding,
    review_attestation,
    owner_actor_ids,
    dynamicTaskTreeRuntime,
    receiptService,
    verificationTrustStore,
    joinVerdictStore,
    now,
  });
}

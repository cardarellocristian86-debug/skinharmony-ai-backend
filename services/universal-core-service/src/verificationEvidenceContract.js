import crypto from "node:crypto";

const SCHEMA_VERSION = "verification_evidence_contract_v2";
const DRAFT_SCHEMA_VERSION = "verification_evidence_draft_v2";
const DECISIONS = new Set(["approve", "dissent"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireText(value, field, max = 500) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function requireUuid(value, field = "work_id") {
  const normalized = requireText(value, field, 36).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function normalizeArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0 || artifacts.length > 128) {
    throw new Error("evidence_artifacts_invalid");
  }
  const normalized = artifacts.map((artifact) => ({
    artifact_id: requireText(artifact?.artifact_id, "artifact_id", 160),
    content_digest: requireText(artifact?.content_digest, "content_digest", 256),
    source_reference: requireText(artifact?.source_reference, "source_reference", 1_000),
  })).sort((a, b) => a.artifact_id.localeCompare(b.artifact_id));
  if (new Set(normalized.map((artifact) => artifact.artifact_id)).size !== normalized.length) {
    throw new Error("evidence_artifact_id_duplicate");
  }
  return normalized;
}

function normalizeProvenance(provenance, { tenantId, workId, treeId, nodeId }) {
  const normalized = {
    tenant_id: requireText(provenance?.tenant_id, "provenance_tenant_id", 120),
    work_id: requireUuid(provenance?.work_id, "provenance_work_id"),
    tree_id: requireText(provenance?.tree_id, "provenance_tree_id", 160),
    node_id: requireText(provenance?.node_id, "provenance_node_id", 120),
    producer_id: requireText(provenance?.producer_id, "provenance_producer_id", 160),
    source_type: requireText(provenance?.source_type, "provenance_source_type", 120),
    source_reference: requireText(provenance?.source_reference, "provenance_source_reference", 1_000),
  };
  if (normalized.tenant_id !== tenantId || normalized.work_id !== workId
      || normalized.tree_id !== treeId || normalized.node_id !== nodeId) {
    throw new Error("evidence_provenance_scope_mismatch");
  }
  return normalized;
}

function evidencePayload({ tenantId, workId, treeId, nodeId, claim, artifacts, provenance }) {
  return {
    tenant_id: tenantId,
    work_id: workId,
    tree_id: treeId,
    node_id: nodeId,
    claim,
    artifacts,
    provenance,
  };
}

function attestationId({ workId, evidenceDigest, verifierId, decision, rationale, identityReceipt, assignmentId }) {
  return digest("att", {
    work_id: workId,
    evidence_digest: evidenceDigest,
    verifier_id: verifierId,
    decision,
    rationale,
    identity_receipt: identityReceipt,
    assignment_id: assignmentId,
  });
}

function exactVerifiedResolution(resolution, expected, mismatchCode) {
  if (!resolution || typeof resolution !== "object" || Array.isArray(resolution)
      || resolution.verified !== true) return false;
  if (resolution.execution_authorized !== false
      || Object.entries(expected).some(([field, value]) => String(resolution[field] || "") !== value)) {
    throw new Error(mismatchCode);
  }
  return true;
}

function normalizeAttestations(attestations, {
  evidenceDigest,
  producerId,
  tenantId,
  workId,
  treeId,
  nodeId,
  resolveVerifierIdentity,
  requireVerifiedIdentities,
}) {
  if (!Array.isArray(attestations) || attestations.length === 0 || attestations.length > 64) {
    throw new Error("evidence_attestations_invalid");
  }
  const normalized = attestations.map((attestation) => {
    const verifierId = requireText(attestation?.verifier_id, "verifier_id", 160);
    const decision = requireText(attestation?.decision, "attestation_decision", 32);
    const rationale = requireText(attestation?.rationale, "attestation_rationale", 1_000);
    const identityReceipt = requireText(attestation?.identity_receipt, "identity_receipt", 4_000);
    const assignmentId = requireText(attestation?.assignment_id, "assignment_id", 160);
    if (!DECISIONS.has(decision)) throw new Error("attestation_decision_invalid");
    if (verifierId === producerId) throw new Error("self_verification_denied");
    const expected = attestationId({
      workId,
      evidenceDigest,
      verifierId,
      decision,
      rationale,
      identityReceipt,
      assignmentId,
    });
    if (requireText(attestation?.attestation_id, "attestation_id", 160) !== expected) {
      throw new Error("evidence_attestation_invalid");
    }
    let identityVerified = false;
    let independenceKey = "";
    if (resolveVerifierIdentity) {
      const resolution = resolveVerifierIdentity({
        tenant_id: tenantId,
        work_id: workId,
        tree_id: treeId,
        node_id: nodeId,
        verifier_id: verifierId,
        identity_receipt: identityReceipt,
        evidence_digest: evidenceDigest,
        decision,
        rationale,
        assignment_id: assignmentId,
      });
      if (resolution && typeof resolution.then === "function") throw new Error("async_verifier_identity_resolver_denied");
      identityVerified = exactVerifiedResolution(resolution, {
        tenant_id: tenantId,
        work_id: workId,
        tree_id: treeId,
        node_id: nodeId,
        verifier_id: verifierId,
        evidence_digest: evidenceDigest,
        assignment_id: assignmentId,
      }, "verifier_identity_scope_mismatch");
      independenceKey = String(resolution?.independence_key || resolution?.session_fingerprint || "").trim();
    }
    if (requireVerifiedIdentities && !identityVerified) throw new Error("verifier_identity_unverified");
    if (requireVerifiedIdentities && !independenceKey) throw new Error("verifier_independence_unverified");
    return {
      verifier_id: verifierId,
      decision,
      rationale,
      identity_receipt: identityReceipt,
      assignment_id: assignmentId,
      attestation_id: expected,
      scheme: "sha256_work_bound_vote_integrity_v2",
      identity_verified: identityVerified,
      independence_key: independenceKey || null,
    };
  }).sort((a, b) => a.verifier_id.localeCompare(b.verifier_id));
  if (new Set(normalized.map((attestation) => attestation.verifier_id)).size !== normalized.length) {
    throw new Error("verifier_identity_duplicate");
  }
  if (new Set(normalized.map((attestation) => attestation.identity_receipt)).size !== normalized.length) {
    throw new Error("verifier_identity_receipt_duplicate");
  }
  const independenceKeys = normalized.map((attestation) => attestation.independence_key).filter(Boolean);
  if (new Set(independenceKeys).size !== independenceKeys.length) {
    throw new Error("verifier_independence_duplicate");
  }
  return normalized;
}

export function buildVerificationEvidenceContract({
  schema_version,
  tenant_id,
  work_id,
  tree_id,
  node_id,
  claim,
  artifacts,
  provenance,
  votes,
  required_approvals = 1,
} = {}) {
  if (schema_version !== undefined
      && schema_version !== DRAFT_SCHEMA_VERSION
      && schema_version !== SCHEMA_VERSION) {
    throw new Error("verification_evidence_legacy_denied");
  }
  const draft = prepareVerificationEvidenceDraft({
    tenant_id,
    work_id,
    tree_id,
    node_id,
    claim,
    artifacts,
    provenance,
    required_approvals,
  });
  const tenantId = draft.tenant_id;
  const workId = draft.work_id;
  const treeId = draft.tree_id;
  const nodeId = draft.node_id;
  const normalizedClaim = draft.claim;
  const normalizedArtifacts = draft.artifacts;
  const normalizedProvenance = draft.provenance;
  const evidenceDigest = draft.evidence_digest;
  const required = draft.quorum.required_approvals;
  if (!Array.isArray(votes) || votes.length === 0) throw new Error("evidence_votes_invalid");
  const attestations = votes.map((vote) => {
    const verifierId = requireText(vote?.verifier_id, "verifier_id", 160);
    const decision = requireText(vote?.decision, "attestation_decision", 32);
    const rationale = requireText(vote?.rationale, "attestation_rationale", 1_000);
    if (!DECISIONS.has(decision)) throw new Error("attestation_decision_invalid");
    return {
      verifier_id: verifierId,
      decision,
      rationale,
      identity_receipt: requireText(vote?.identity_receipt, "identity_receipt", 4_000),
      assignment_id: requireText(vote?.assignment_id, "assignment_id", 160),
      attestation_id: attestationId({
        workId,
        evidenceDigest,
        verifierId,
        decision,
        rationale,
        identityReceipt: requireText(vote?.identity_receipt, "identity_receipt", 4_000),
        assignmentId: requireText(vote?.assignment_id, "assignment_id", 160),
      }),
      scheme: "sha256_work_bound_vote_integrity_v2",
    };
  });
  return validateVerificationEvidenceContract({
    schema_version: SCHEMA_VERSION,
    tenant_id: tenantId,
    work_id: workId,
    tree_id: treeId,
    node_id: nodeId,
    claim: normalizedClaim,
    artifacts: normalizedArtifacts,
    provenance: normalizedProvenance,
    evidence_digest: evidenceDigest,
    attestations,
    quorum: { required_approvals: required, dissent_policy: "block" },
    execution_authorized: false,
  }, {
    tenant_id: tenantId,
    work_id: workId,
    tree_id: treeId,
    node_id: nodeId,
    minimum_approvals: required,
    require_verified_identities: false,
  });
}

export function prepareVerificationEvidenceDraft({
  tenant_id,
  work_id,
  tree_id,
  node_id,
  claim,
  artifacts,
  provenance,
  required_approvals = 1,
} = {}) {
  const tenantId = requireText(tenant_id, "tenant_id", 120);
  const workId = requireUuid(work_id);
  const treeId = requireText(tree_id, "tree_id", 160);
  const nodeId = requireText(node_id, "node_id", 120);
  const normalizedClaim = requireText(claim, "evidence_claim", 4_000);
  const normalizedArtifacts = normalizeArtifacts(artifacts);
  const normalizedProvenance = normalizeProvenance(provenance, {
    tenantId,
    workId,
    treeId,
    nodeId,
  });
  const evidenceDigest = digest("evd", evidencePayload({
    tenantId,
    workId,
    treeId,
    nodeId,
    claim: normalizedClaim,
    artifacts: normalizedArtifacts,
    provenance: normalizedProvenance,
  }));
  const required = Number(required_approvals);
  if (!Number.isInteger(required) || required < 1 || required > 64) throw new Error("required_approvals_invalid");
  return {
    schema_version: DRAFT_SCHEMA_VERSION,
    tenant_id: tenantId,
    work_id: workId,
    tree_id: treeId,
    node_id: nodeId,
    claim: normalizedClaim,
    artifacts: normalizedArtifacts,
    provenance: normalizedProvenance,
    evidence_digest: evidenceDigest,
    quorum: { required_approvals: required, dissent_policy: "block" },
    execution_authorized: false,
  };
}

export function validateVerificationEvidenceContract(evidence, {
  tenant_id,
  work_id,
  tree_id,
  node_id,
  minimum_approvals = 1,
  resolve_verifier_identity = null,
  require_verified_identities = false,
} = {}) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || Object.keys(evidence).length === 0) {
    throw new Error("verification_evidence_required");
  }
  const tenantId = requireText(tenant_id, "tenant_id", 120);
  const workId = requireUuid(work_id);
  const treeId = requireText(tree_id, "tree_id", 160);
  const nodeId = requireText(node_id, "node_id", 120);
  if (evidence.schema_version !== SCHEMA_VERSION) throw new Error("verification_evidence_schema_invalid");
  if (evidence.tenant_id !== tenantId || evidence.work_id !== workId
      || evidence.tree_id !== treeId || evidence.node_id !== nodeId) {
    throw new Error("verification_evidence_scope_mismatch");
  }
  if (evidence.execution_authorized !== false) throw new Error("verification_evidence_execution_denied");
  const claim = requireText(evidence.claim, "evidence_claim", 4_000);
  const artifacts = normalizeArtifacts(evidence.artifacts);
  const provenance = normalizeProvenance(evidence.provenance, {
    tenantId,
    workId,
    treeId,
    nodeId,
  });
  const expectedDigest = digest("evd", evidencePayload({
    tenantId,
    workId,
    treeId,
    nodeId,
    claim,
    artifacts,
    provenance,
  }));
  if (evidence.evidence_digest !== expectedDigest) throw new Error("evidence_digest_invalid");
  const attestations = normalizeAttestations(evidence.attestations, {
    evidenceDigest: expectedDigest,
    producerId: provenance.producer_id,
    tenantId,
    workId,
    treeId,
    nodeId,
    resolveVerifierIdentity: typeof resolve_verifier_identity === "function" ? resolve_verifier_identity : null,
    requireVerifiedIdentities: require_verified_identities,
  });
  const required = Number(evidence?.quorum?.required_approvals);
  const minimum = Number(minimum_approvals);
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > 64) throw new Error("minimum_approvals_invalid");
  if (!Number.isInteger(required) || required < minimum || required > 64) {
    throw new Error("evidence_quorum_invalid");
  }
  if (evidence?.quorum?.dissent_policy !== "block") throw new Error("evidence_dissent_policy_invalid");
  const approvals = attestations.filter((item) => item.decision === "approve").length;
  const dissents = attestations.filter((item) => item.decision === "dissent").length;
  const verifiedIdentities = attestations.filter((item) => item.identity_verified).length;
  const identitiesSatisfied = verifiedIdentities === attestations.length;
  const quorumSatisfied = approvals >= required && dissents === 0;
  return {
    schema_version: SCHEMA_VERSION,
    tenant_id: tenantId,
    work_id: workId,
    tree_id: treeId,
    node_id: nodeId,
    claim,
    artifacts,
    provenance,
    evidence_digest: expectedDigest,
    attestations,
    quorum: {
      required_approvals: required,
      dissent_policy: "block",
      approvals,
      dissents,
      satisfied: quorumSatisfied,
    },
    identity_verification: {
      mode: "core_server_side_receipt_resolver",
      verified_identities: verifiedIdentities,
      required_identities: attestations.length,
      satisfied: identitiesSatisfied,
    },
    contract_satisfied: quorumSatisfied && identitiesSatisfied,
    execution_authorized: false,
  };
}

export async function validateVerificationEvidenceContractAsync(evidence, options = {}) {
  const structurallyValid = validateVerificationEvidenceContract(evidence, {
    ...options,
    resolve_verifier_identity: null,
    require_verified_identities: false,
  });
  const resolver = options.resolve_verifier_identity;
  const artifactResolver = options.resolve_evidence_artifact;
  const resolvedArtifacts = [];
  for (const artifact of structurallyValid.artifacts) {
    const resolution = typeof artifactResolver === "function"
      ? await artifactResolver({
        tenant_id: structurallyValid.tenant_id,
        work_id: structurallyValid.work_id,
        artifact_id: artifact.artifact_id,
        content_digest: artifact.content_digest,
        source_reference: artifact.source_reference,
      })
      : false;
    const verified = exactVerifiedResolution(resolution, {
      tenant_id: structurallyValid.tenant_id,
      work_id: structurallyValid.work_id,
      artifact_id: artifact.artifact_id,
      content_digest: artifact.content_digest,
      source_reference: artifact.source_reference,
    }, "evidence_artifact_scope_mismatch");
    if (options.require_registered_artifacts === true && !verified) {
      throw new Error("evidence_artifact_unregistered");
    }
    resolvedArtifacts.push({
      ...artifact,
      registry_verified: verified,
      registry_id: verified ? String(resolution?.registry_id || "") || null : null,
    });
  }
  if (options.require_verified_identities === true && typeof resolver !== "function") {
    throw new Error("verifier_identity_unverified");
  }
  const attestations = [];
  for (const attestation of structurallyValid.attestations) {
    const resolution = typeof resolver === "function"
      ? await resolver({
        tenant_id: structurallyValid.tenant_id,
        work_id: structurallyValid.work_id,
        tree_id: structurallyValid.tree_id,
        node_id: structurallyValid.node_id,
        verifier_id: attestation.verifier_id,
        identity_receipt: attestation.identity_receipt,
        evidence_digest: structurallyValid.evidence_digest,
        decision: attestation.decision,
        rationale: attestation.rationale,
        assignment_id: attestation.assignment_id,
      })
      : false;
    const verified = exactVerifiedResolution(resolution, {
      tenant_id: structurallyValid.tenant_id,
      work_id: structurallyValid.work_id,
      tree_id: structurallyValid.tree_id,
      node_id: structurallyValid.node_id,
      verifier_id: attestation.verifier_id,
      evidence_digest: structurallyValid.evidence_digest,
      assignment_id: attestation.assignment_id,
    }, "verifier_identity_scope_mismatch");
    const independenceKey = String(resolution?.independence_key || resolution?.session_fingerprint || "").trim();
    if (options.require_verified_identities === true && !verified) throw new Error("verifier_identity_unverified");
    if (options.require_verified_identities === true && !independenceKey) {
      throw new Error("verifier_independence_unverified");
    }
    attestations.push({ ...attestation, identity_verified: verified, independence_key: independenceKey || null });
  }
  const independenceKeys = attestations.map((item) => item.independence_key).filter(Boolean);
  if (new Set(independenceKeys).size !== independenceKeys.length) throw new Error("verifier_independence_duplicate");
  const verifiedIdentities = attestations.filter((item) => item.identity_verified).length;
  const identitiesSatisfied = verifiedIdentities === attestations.length;
  return {
    ...structurallyValid,
    artifacts: resolvedArtifacts,
    attestations,
    identity_verification: {
      ...structurallyValid.identity_verification,
      verified_identities: verifiedIdentities,
      required_identities: attestations.length,
      satisfied: identitiesSatisfied,
    },
    contract_satisfied: structurallyValid.quorum.satisfied && identitiesSatisfied,
  };
}

export const VERIFICATION_EVIDENCE_SCHEMA_VERSION = SCHEMA_VERSION;
export const VERIFICATION_EVIDENCE_DRAFT_SCHEMA_VERSION = DRAFT_SCHEMA_VERSION;

const COMPLETION_MANIFEST_SCHEMA_VERSION = "completion_manifest_v1";
const PORTABLE_BUNDLE_SCHEMA_VERSION = "portable_verification_bundle_v1";
const PORTABLE_BUNDLE_PURPOSE = "NYRA_PORTABLE_VERIFICATION_BUNDLE_V1\0";
const COMPLETION_STAGES = Object.freeze([
  "IMPLEMENTED", "TESTED", "MERGED", "DEPLOYED", "VERIFIED_LIVE",
]);
const SHA256_PATTERN = /^(?:[a-z]{3}_)?[a-f0-9]{64}$/u;

function requireDigest(value, field) {
  const normalized = requireText(value, field, 80).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function requirePositiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw new Error(`${field}_invalid`);
  return normalized;
}

function uniqueSortedText(values, field, { maximum = 256, required = false } = {}) {
  if (!Array.isArray(values) || (required && values.length === 0) || values.length > maximum) {
    throw new Error(`${field}_invalid`);
  }
  const normalized = values.map((value) => requireText(value, field, 1_000));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field}_duplicate`);
  return normalized.sort();
}

function canonicalTimestamp(value, field) {
  const normalized = requireText(value, field, 40);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    throw new Error(`${field}_invalid`);
  }
  return normalized;
}

function normalizeCompletionManifest(input = {}) {
  const tenantId = requireText(input.tenant_id, "completion_tenant_id", 120);
  const workId = requireUuid(input.work_id, "completion_work_id");
  const taskId = requireUuid(input.task_id, "completion_task_id");
  const requiredClaims = uniqueSortedText(input.required_claims, "completion_required_claims", {
    maximum: 128,
    required: true,
  });
  const bindings = Array.isArray(input.evidence_bindings) ? input.evidence_bindings.map((binding) => ({
    claim: requireText(binding?.claim, "completion_evidence_claim", 4_000),
    evidence_digest: requireText(binding?.evidence_digest, "completion_evidence_digest", 96),
    tree_id: requireText(binding?.tree_id, "completion_evidence_tree_id", 160),
    node_id: requireText(binding?.node_id, "completion_evidence_node_id", 120),
    tenant_id: requireText(binding?.tenant_id, "completion_evidence_tenant_id", 120),
    work_id: requireUuid(binding?.work_id, "completion_evidence_work_id"),
    work_revision: requirePositiveInteger(binding?.work_revision,
      "completion_evidence_work_revision"),
    task_revision: requirePositiveInteger(binding?.task_revision,
      "completion_evidence_task_revision"),
    environment: requireText(binding?.environment, "completion_evidence_environment", 120),
    scope: requireText(binding?.scope, "completion_evidence_scope", 500),
  })) : [];
  if (bindings.length > 128) throw new Error("completion_evidence_bindings_invalid");
  bindings.sort((left, right) => left.claim.localeCompare(right.claim));
  if (new Set(bindings.map((binding) => binding.claim)).size !== bindings.length) {
    throw new Error("completion_evidence_claim_duplicate");
  }
  if (requiredClaims.some((claim) => !bindings.some((binding) => binding.claim === claim))) {
    throw new Error("completion_required_evidence_missing");
  }
  const workRevision = requirePositiveInteger(input.work_revision, "completion_work_revision");
  const taskRevision = requirePositiveInteger(input.task_revision, "completion_task_revision");
  for (const binding of bindings) {
    if (binding.tenant_id !== tenantId || binding.work_id !== workId
        || binding.work_revision !== workRevision || binding.task_revision !== taskRevision) {
      throw new Error("completion_evidence_scope_mismatch");
    }
  }
  const completionStage = requireText(input.completion_stage, "completion_stage", 32).toUpperCase();
  if (!COMPLETION_STAGES.includes(completionStage)) throw new Error("completion_stage_invalid");
  const material = {
    schema_version: COMPLETION_MANIFEST_SCHEMA_VERSION,
    tenant_id: tenantId,
    work_id: workId,
    work_revision: workRevision,
    task_id: taskId,
    task_revision: taskRevision,
    intent_digest: requireDigest(input.intent_digest, "completion_intent_digest"),
    required_claims: requiredClaims,
    artifact_refs: uniqueSortedText(input.artifact_refs || [], "completion_artifact_refs"),
    commit_refs: uniqueSortedText(input.commit_refs || [], "completion_commit_refs"),
    deploy_refs: uniqueSortedText(input.deploy_refs || [], "completion_deploy_refs"),
    live_verification_refs: uniqueSortedText(input.live_verification_refs || [],
      "completion_live_verification_refs"),
    evidence_bindings: bindings,
    dependency_manifest_ref: requireText(input.dependency_manifest_ref,
      "completion_dependency_manifest_ref", 500),
    context_snapshot_ref: requireText(input.context_snapshot_ref,
      "completion_context_snapshot_ref", 500),
    policy_revision: requireDigest(input.policy_revision, "completion_policy_revision"),
    verifier_revision: requireText(input.verifier_revision, "completion_verifier_revision", 160),
    effect_lineage_refs: uniqueSortedText(input.effect_lineage_refs || [],
      "completion_effect_lineage_refs"),
    completion_stage: completionStage,
  };
  if (COMPLETION_STAGES.indexOf(completionStage) >= COMPLETION_STAGES.indexOf("IMPLEMENTED")
      && material.artifact_refs.length === 0) throw new Error("completion_artifact_missing");
  if (COMPLETION_STAGES.indexOf(completionStage) >= COMPLETION_STAGES.indexOf("MERGED")
      && material.commit_refs.length === 0) throw new Error("completion_commit_missing");
  if (COMPLETION_STAGES.indexOf(completionStage) >= COMPLETION_STAGES.indexOf("DEPLOYED")
      && material.deploy_refs.length === 0) throw new Error("completion_deploy_missing");
  if (completionStage === "VERIFIED_LIVE" && material.live_verification_refs.length === 0) {
    throw new Error("completion_live_verification_missing");
  }
  return material;
}

export function buildCompletionManifest(input = {}) {
  const material = normalizeCompletionManifest(input);
  return Object.freeze({ ...material, manifest_digest: digest("cmp", material) });
}

export async function verifyCompletionEvidence(manifestInput, {
  evidence_contracts = [],
  resolve_verifier_identity = null,
  resolve_evidence_artifact = null,
  require_verified_identities = true,
  require_registered_artifacts = true,
} = {}) {
  const manifest = buildCompletionManifest(Object.fromEntries(Object.entries(manifestInput || {})
    .filter(([key]) => !["schema_version", "manifest_digest"].includes(key))));
  if (manifestInput?.manifest_digest !== manifest.manifest_digest) {
    throw new Error("completion_manifest_digest_invalid");
  }
  if (!Array.isArray(evidence_contracts) || evidence_contracts.length > 128) {
    throw new Error("completion_evidence_contracts_invalid");
  }
  const contracts = new Map(evidence_contracts.map((contract) => [contract?.evidence_digest, contract]));
  const claims = [];
  for (const binding of manifest.evidence_bindings) {
    const evidence = contracts.get(binding.evidence_digest);
    if (!evidence) throw new Error("completion_evidence_contract_missing");
    const verified = await validateVerificationEvidenceContractAsync(evidence, {
      tenant_id: manifest.tenant_id,
      work_id: manifest.work_id,
      tree_id: binding.tree_id,
      node_id: binding.node_id,
      minimum_approvals: 1,
      resolve_verifier_identity,
      resolve_evidence_artifact,
      require_verified_identities,
      require_registered_artifacts,
    });
    if (verified.evidence_digest !== binding.evidence_digest || verified.claim !== binding.claim
        || verified.contract_satisfied !== true) throw new Error("completion_claim_not_verified");
    claims.push({
      claim: binding.claim,
      evidence_digest: binding.evidence_digest,
      verified: true,
      identity_verification_satisfied: verified.identity_verification.satisfied,
      artifact_registry_satisfied: verified.artifacts.every((artifact) =>
        artifact.registry_verified === true),
    });
  }
  const result = {
    schema_version: "completion_verification_result_v1",
    manifest,
    claims,
    completion_stage: manifest.completion_stage,
    completion_verified: claims.length === manifest.required_claims.length
      && claims.every((claim) => claim.verified),
    execution_authorized: false,
  };
  return Object.freeze({ ...result, verification_digest: digest("cmv", result) });
}

function ed25519PublicKey(value) {
  try {
    const key = value instanceof crypto.KeyObject ? value : crypto.createPublicKey(value);
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
      throw new Error("portable_bundle_public_key_invalid");
    }
    return key;
  } catch (error) {
    if (error?.message === "portable_bundle_public_key_invalid") throw error;
    throw new Error("portable_bundle_public_key_invalid");
  }
}

function publicKeyFingerprint(key) {
  return crypto.createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex");
}

function portableSigningPayload(bundleDigest) {
  return Buffer.from(`${PORTABLE_BUNDLE_PURPOSE}${bundleDigest}`, "utf8");
}

export async function exportPortableVerificationBundle({
  completion_verification,
  evidence_contracts,
  revocation_snapshot,
  signed_at,
  signer,
} = {}) {
  if (completion_verification?.completion_verified !== true
      || completion_verification?.execution_authorized !== false) {
    throw new Error("portable_bundle_completion_unverified");
  }
  const publicKey = ed25519PublicKey(signer?.public_key);
  const trustAnchor = {
    key_id: requireText(signer?.key_id, "portable_bundle_key_id", 160),
    algorithm: "Ed25519",
    public_key_spki_base64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    public_key_fingerprint: publicKeyFingerprint(publicKey),
  };
  const revocations = {
    as_of: canonicalTimestamp(revocation_snapshot?.as_of, "portable_bundle_revocation_as_of"),
    revision: requireDigest(revocation_snapshot?.revision, "portable_bundle_revocation_revision"),
    quality: requireText(revocation_snapshot?.quality, "portable_bundle_revocation_quality", 80),
    revoked_key_ids: uniqueSortedText(revocation_snapshot?.revoked_key_ids || [],
      "portable_bundle_revoked_key_ids", { maximum: 1_000 }),
  };
  const signedAt = canonicalTimestamp(signed_at, "portable_bundle_signed_at");
  if (Date.parse(revocations.as_of) < Date.parse(signedAt)) {
    throw new Error("portable_bundle_revocation_snapshot_stale");
  }
  if (revocations.revoked_key_ids.includes(trustAnchor.key_id)) {
    throw new Error("portable_bundle_signer_revoked");
  }
  const payload = {
    schema_version: PORTABLE_BUNDLE_SCHEMA_VERSION,
    canonicalization: "nyra_stable_json_v1",
    completion_verification,
    evidence_contracts,
    revocation_snapshot: revocations,
    trust_anchor: trustAnchor,
    signed_at: signedAt,
  };
  const bundleDigest = digest("pvb", payload);
  let signature;
  if (typeof signer?.sign_payload === "function") {
    signature = await signer.sign_payload(portableSigningPayload(bundleDigest),
      PORTABLE_BUNDLE_PURPOSE.slice(0, -1));
  } else if (signer?.private_key) {
    signature = crypto.sign(null, portableSigningPayload(bundleDigest), signer.private_key)
      .toString("base64url");
  } else {
    throw new Error("portable_bundle_signer_unavailable");
  }
  const normalizedSignature = requireText(signature, "portable_bundle_signature", 256);
  return Object.freeze({ ...payload, bundle_digest: bundleDigest, signature: normalizedSignature });
}

export function verifyPortableVerificationBundle(bundle, {
  trusted_public_keys = [],
  valid_at,
} = {}) {
  if (bundle?.schema_version !== PORTABLE_BUNDLE_SCHEMA_VERSION) {
    throw new Error("portable_bundle_schema_invalid");
  }
  const { bundle_digest: bundleDigest, signature, ...payload } = bundle;
  if (digest("pvb", payload) !== bundleDigest) throw new Error("portable_bundle_digest_invalid");
  const keyId = requireText(bundle?.trust_anchor?.key_id, "portable_bundle_key_id", 160);
  const trusted = trusted_public_keys.find((candidate) => candidate?.key_id === keyId);
  if (!trusted) throw new Error("portable_bundle_trust_anchor_unknown");
  const publicKey = ed25519PublicKey(trusted.public_key);
  if (publicKeyFingerprint(publicKey) !== bundle.trust_anchor.public_key_fingerprint) {
    throw new Error("portable_bundle_trust_anchor_mismatch");
  }
  const signatureBytes = Buffer.from(requireText(signature, "portable_bundle_signature", 256),
    "base64url");
  if (signatureBytes.length !== 64
      || !crypto.verify(null, portableSigningPayload(bundleDigest), publicKey, signatureBytes)) {
    throw new Error("portable_bundle_signature_invalid");
  }
  const validAt = canonicalTimestamp(valid_at, "portable_bundle_valid_at");
  const revocationAsOf = canonicalTimestamp(bundle.revocation_snapshot?.as_of,
    "portable_bundle_revocation_as_of");
  if (Date.parse(validAt) < Date.parse(bundle.signed_at)) throw new Error("portable_bundle_not_yet_valid");
  if (Date.parse(revocationAsOf) < Date.parse(validAt)) {
    throw new Error("portable_bundle_current_revocation_unknown");
  }
  if (bundle.revocation_snapshot.revoked_key_ids.includes(keyId)) {
    throw new Error("portable_bundle_signer_revoked");
  }
  const manifest = bundle.completion_verification?.manifest;
  const rebuilt = buildCompletionManifest(Object.fromEntries(Object.entries(manifest || {})
    .filter(([key]) => !["schema_version", "manifest_digest"].includes(key))));
  if (rebuilt.manifest_digest !== manifest?.manifest_digest) {
    throw new Error("portable_bundle_manifest_invalid");
  }
  const evidenceByDigest = new Map((bundle.evidence_contracts || [])
    .map((evidence) => [evidence?.evidence_digest, evidence]));
  for (const binding of rebuilt.evidence_bindings) {
    const evidence = evidenceByDigest.get(binding.evidence_digest);
    const structural = validateVerificationEvidenceContract(evidence, {
      tenant_id: rebuilt.tenant_id,
      work_id: rebuilt.work_id,
      tree_id: binding.tree_id,
      node_id: binding.node_id,
      minimum_approvals: 1,
    });
    if (structural.claim !== binding.claim || structural.quorum.satisfied !== true) {
      throw new Error("portable_bundle_claim_binding_invalid");
    }
  }
  return Object.freeze({
    schema_version: "portable_verification_result_v1",
    integrity_verified: true,
    signer_verified: true,
    evidence_structure_verified: true,
    provenance_scope_verified: true,
    claim_bindings_verified: true,
    verifier_identity_assertion: "SIGNED_EXPORT_ASSERTION",
    current_revocation_known_at: validAt,
    bundle_digest: bundleDigest,
    manifest_digest: rebuilt.manifest_digest,
  });
}

export const COMPLETION_MANIFEST_VERSION = COMPLETION_MANIFEST_SCHEMA_VERSION;
export const PORTABLE_VERIFICATION_BUNDLE_VERSION = PORTABLE_BUNDLE_SCHEMA_VERSION;

import crypto from "node:crypto";

const SCHEMA_VERSION = "verification_evidence_contract_v1";
const DECISIONS = new Set(["approve", "dissent"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireText(value, field, max = 500) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
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

function normalizeProvenance(provenance, { tenantId, treeId, nodeId }) {
  const normalized = {
    tenant_id: requireText(provenance?.tenant_id, "provenance_tenant_id", 120),
    tree_id: requireText(provenance?.tree_id, "provenance_tree_id", 160),
    node_id: requireText(provenance?.node_id, "provenance_node_id", 120),
    producer_id: requireText(provenance?.producer_id, "provenance_producer_id", 160),
    source_type: requireText(provenance?.source_type, "provenance_source_type", 120),
    source_reference: requireText(provenance?.source_reference, "provenance_source_reference", 1_000),
  };
  if (normalized.tenant_id !== tenantId || normalized.tree_id !== treeId || normalized.node_id !== nodeId) {
    throw new Error("evidence_provenance_scope_mismatch");
  }
  return normalized;
}

function evidencePayload({ tenantId, treeId, nodeId, claim, artifacts, provenance }) {
  return {
    tenant_id: tenantId,
    tree_id: treeId,
    node_id: nodeId,
    claim,
    artifacts,
    provenance,
  };
}

function attestationId({ evidenceDigest, verifierId, decision, rationale, identityReceipt, assignmentId }) {
  return digest("att", {
    evidence_digest: evidenceDigest,
    verifier_id: verifierId,
    decision,
    rationale,
    identity_receipt: identityReceipt,
    assignment_id: assignmentId,
  });
}

function normalizeAttestations(attestations, {
  evidenceDigest,
  producerId,
  tenantId,
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
        tree_id: treeId,
        node_id: nodeId,
        verifier_id: verifierId,
        identity_receipt: identityReceipt,
        evidence_digest: evidenceDigest,
        decision,
        rationale,
      });
      if (resolution && typeof resolution.then === "function") throw new Error("async_verifier_identity_resolver_denied");
      identityVerified = resolution === true || resolution?.verified === true;
      independenceKey = String(resolution?.independence_key || resolution?.session_fingerprint || "").trim();
      if (identityVerified && String(resolution?.assignment_id || "") !== assignmentId) {
        throw new Error("verifier_assignment_receipt_mismatch");
      }
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
      scheme: "sha256_vote_integrity_v1",
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
  tenant_id,
  tree_id,
  node_id,
  claim,
  artifacts,
  provenance,
  votes,
  required_approvals = 1,
} = {}) {
  const draft = prepareVerificationEvidenceDraft({
    tenant_id,
    tree_id,
    node_id,
    claim,
    artifacts,
    provenance,
    required_approvals,
  });
  const tenantId = draft.tenant_id;
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
        evidenceDigest,
        verifierId,
        decision,
        rationale,
        identityReceipt: requireText(vote?.identity_receipt, "identity_receipt", 4_000),
        assignmentId: requireText(vote?.assignment_id, "assignment_id", 160),
      }),
      scheme: "sha256_vote_integrity_v1",
    };
  });
  return validateVerificationEvidenceContract({
    schema_version: SCHEMA_VERSION,
    tenant_id: tenantId,
    tree_id: treeId,
    node_id: nodeId,
    claim: normalizedClaim,
    artifacts: normalizedArtifacts,
    provenance: normalizedProvenance,
    evidence_digest: evidenceDigest,
    attestations,
    quorum: { required_approvals: required, dissent_policy: "block" },
  }, {
    tenant_id: tenantId,
    tree_id: treeId,
    node_id: nodeId,
    minimum_approvals: required,
    require_verified_identities: false,
  });
}

export function prepareVerificationEvidenceDraft({
  tenant_id,
  tree_id,
  node_id,
  claim,
  artifacts,
  provenance,
  required_approvals = 1,
} = {}) {
  const tenantId = requireText(tenant_id, "tenant_id", 120);
  const treeId = requireText(tree_id, "tree_id", 160);
  const nodeId = requireText(node_id, "node_id", 120);
  const normalizedClaim = requireText(claim, "evidence_claim", 4_000);
  const normalizedArtifacts = normalizeArtifacts(artifacts);
  const normalizedProvenance = normalizeProvenance(provenance, { tenantId, treeId, nodeId });
  const evidenceDigest = digest("evd", evidencePayload({
    tenantId,
    treeId,
    nodeId,
    claim: normalizedClaim,
    artifacts: normalizedArtifacts,
    provenance: normalizedProvenance,
  }));
  const required = Number(required_approvals);
  if (!Number.isInteger(required) || required < 1 || required > 64) throw new Error("required_approvals_invalid");
  return {
    schema_version: "verification_evidence_draft_v1",
    tenant_id: tenantId,
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
  const treeId = requireText(tree_id, "tree_id", 160);
  const nodeId = requireText(node_id, "node_id", 120);
  if (evidence.schema_version !== SCHEMA_VERSION) throw new Error("verification_evidence_schema_invalid");
  if (evidence.tenant_id !== tenantId || evidence.tree_id !== treeId || evidence.node_id !== nodeId) {
    throw new Error("verification_evidence_scope_mismatch");
  }
  const claim = requireText(evidence.claim, "evidence_claim", 4_000);
  const artifacts = normalizeArtifacts(evidence.artifacts);
  const provenance = normalizeProvenance(evidence.provenance, { tenantId, treeId, nodeId });
  const expectedDigest = digest("evd", evidencePayload({ tenantId, treeId, nodeId, claim, artifacts, provenance }));
  if (evidence.evidence_digest !== expectedDigest) throw new Error("evidence_digest_invalid");
  const attestations = normalizeAttestations(evidence.attestations, {
    evidenceDigest: expectedDigest,
    producerId: provenance.producer_id,
    tenantId,
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
        artifact_id: artifact.artifact_id,
        content_digest: artifact.content_digest,
        source_reference: artifact.source_reference,
      })
      : false;
    const verified = resolution === true || resolution?.verified === true;
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
    const verified = resolution === true || resolution?.verified === true;
    const independenceKey = String(resolution?.independence_key || resolution?.session_fingerprint || "").trim();
    if (String(resolution?.assignment_id || "") !== attestation.assignment_id) {
      throw new Error("verifier_assignment_receipt_mismatch");
    }
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

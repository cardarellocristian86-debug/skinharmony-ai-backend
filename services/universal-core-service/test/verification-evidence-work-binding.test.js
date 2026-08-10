import assert from "node:assert/strict";
import test from "node:test";
import {
  VERIFICATION_EVIDENCE_DRAFT_SCHEMA_VERSION,
  VERIFICATION_EVIDENCE_SCHEMA_VERSION,
  buildVerificationEvidenceContract,
  prepareVerificationEvidenceDraft,
  validateVerificationEvidenceContract,
  validateVerificationEvidenceContractAsync,
} from "../src/verificationEvidenceContract.js";

const TENANT_ID = "tenant-a";
const WORK_A = "11111111-1111-8111-8111-111111111111";
const WORK_B = "22222222-2222-7111-8222-222222222222";
const TREE_ID = "tree-a";
const NODE_ID = "verify";

function input(workId = WORK_A) {
  return {
    tenant_id: TENANT_ID,
    work_id: workId,
    tree_id: TREE_ID,
    node_id: NODE_ID,
    claim: "The immutable artifact satisfies the verification node.",
    artifacts: [{
      artifact_id: "artifact-a",
      content_digest: "sha256:artifact-a",
      source_reference: "urn:test:artifact-a",
    }],
    provenance: {
      tenant_id: TENANT_ID,
      work_id: workId,
      tree_id: TREE_ID,
      node_id: NODE_ID,
      producer_id: "producer-a",
      source_type: "focused_test",
      source_reference: "urn:test:producer-a",
    },
    votes: [{
      verifier_id: "verifier-a",
      identity_receipt: "receipt-a",
      assignment_id: "assignment-a",
      decision: "approve",
      rationale: "Independent reproduction passed.",
    }],
    required_approvals: 1,
  };
}

function exactIdentityResolution(request) {
  return {
    verified: true,
    tenant_id: request.tenant_id,
    work_id: request.work_id,
    tree_id: request.tree_id,
    node_id: request.node_id,
    verifier_id: request.verifier_id,
    evidence_digest: request.evidence_digest,
    assignment_id: request.assignment_id,
    independence_key: "actor-a",
    execution_authorized: false,
  };
}

function exactArtifactResolution(request) {
  return {
    verified: true,
    tenant_id: request.tenant_id,
    work_id: request.work_id,
    artifact_id: request.artifact_id,
    content_digest: request.content_digest,
    source_reference: request.source_reference,
    registry_id: "registry-a",
    execution_authorized: false,
  };
}

test("verification evidence V2 binds top-level, provenance, digest, and resolver inputs to Work", async () => {
  const evidenceA = buildVerificationEvidenceContract(input(WORK_A));
  const evidenceB = buildVerificationEvidenceContract(input(WORK_B));

  assert.equal(evidenceA.schema_version, VERIFICATION_EVIDENCE_SCHEMA_VERSION);
  assert.equal(evidenceA.schema_version, "verification_evidence_contract_v2");
  assert.equal(evidenceA.work_id, WORK_A);
  assert.equal(evidenceA.provenance.work_id, WORK_A);
  assert.equal(evidenceA.execution_authorized, false);
  assert.notEqual(evidenceA.evidence_digest, evidenceB.evidence_digest);
  assert.notEqual(evidenceA.attestations[0].attestation_id, evidenceB.attestations[0].attestation_id);

  const identityInputs = [];
  const artifactInputs = [];
  const validated = await validateVerificationEvidenceContractAsync(evidenceA, {
    tenant_id: TENANT_ID,
    work_id: WORK_A,
    tree_id: TREE_ID,
    node_id: NODE_ID,
    minimum_approvals: 1,
    require_verified_identities: true,
    require_registered_artifacts: true,
    resolve_verifier_identity: async (request) => {
      identityInputs.push(request);
      return exactIdentityResolution(request);
    },
    resolve_evidence_artifact: async (request) => {
      artifactInputs.push(request);
      return exactArtifactResolution(request);
    },
  });

  assert.equal(validated.contract_satisfied, true);
  assert.equal(validated.execution_authorized, false);
  assert.equal(identityInputs[0].work_id, WORK_A);
  assert.equal(artifactInputs[0].work_id, WORK_A);
});

test("cross-Work evidence reuse and Work rewriting fail closed", () => {
  const evidence = buildVerificationEvidenceContract(input(WORK_A));
  assert.throws(() => validateVerificationEvidenceContract(evidence, {
    tenant_id: TENANT_ID,
    work_id: WORK_B,
    tree_id: TREE_ID,
    node_id: NODE_ID,
  }), /verification_evidence_scope_mismatch/);

  const rewritten = structuredClone(evidence);
  rewritten.work_id = WORK_B;
  rewritten.provenance.work_id = WORK_B;
  assert.throws(() => validateVerificationEvidenceContract(rewritten, {
    tenant_id: TENANT_ID,
    work_id: WORK_B,
    tree_id: TREE_ID,
    node_id: NODE_ID,
  }), /evidence_digest_invalid/);

  assert.throws(() => buildVerificationEvidenceContract({
    ...input(WORK_A),
    provenance: { ...input(WORK_A).provenance, work_id: WORK_B },
  }), /evidence_provenance_scope_mismatch/);
});

test("legacy V1 and missing Work evidence cannot be associated with a Work", () => {
  const evidence = buildVerificationEvidenceContract(input(WORK_A));
  assert.throws(() => validateVerificationEvidenceContract({
    ...evidence,
    schema_version: "verification_evidence_contract_v1",
  }, {
    tenant_id: TENANT_ID,
    work_id: WORK_A,
    tree_id: TREE_ID,
    node_id: NODE_ID,
  }), /verification_evidence_schema_invalid/);
  assert.throws(() => buildVerificationEvidenceContract({
    ...input(WORK_A),
    schema_version: "verification_evidence_draft_v1",
  }), /verification_evidence_legacy_denied/);
  assert.throws(() => buildVerificationEvidenceContract({
    ...input(WORK_A),
    work_id: undefined,
  }), /work_id_invalid/);

  const draft = prepareVerificationEvidenceDraft(input(WORK_A));
  assert.equal(draft.schema_version, VERIFICATION_EVIDENCE_DRAFT_SCHEMA_VERSION);
  assert.equal(draft.work_id, WORK_A);
  assert.equal(draft.provenance.work_id, WORK_A);
  assert.equal(draft.execution_authorized, false);
});

test("boolean and cross-Work resolver claims cannot verify V2 evidence", async () => {
  const evidence = buildVerificationEvidenceContract(input(WORK_A));
  const options = {
    tenant_id: TENANT_ID,
    work_id: WORK_A,
    tree_id: TREE_ID,
    node_id: NODE_ID,
    minimum_approvals: 1,
    require_verified_identities: true,
    require_registered_artifacts: true,
    resolve_verifier_identity: exactIdentityResolution,
    resolve_evidence_artifact: exactArtifactResolution,
  };

  await assert.rejects(validateVerificationEvidenceContractAsync(evidence, {
    ...options,
    resolve_evidence_artifact: async () => true,
  }), /evidence_artifact_unregistered/);
  await assert.rejects(validateVerificationEvidenceContractAsync(evidence, {
    ...options,
    resolve_evidence_artifact: async (request) => ({
      ...exactArtifactResolution(request),
      work_id: WORK_B,
    }),
  }), /evidence_artifact_scope_mismatch/);
  await assert.rejects(validateVerificationEvidenceContractAsync(evidence, {
    ...options,
    resolve_verifier_identity: async () => true,
  }), /verifier_identity_unverified/);
  await assert.rejects(validateVerificationEvidenceContractAsync(evidence, {
    ...options,
    resolve_verifier_identity: async (request) => ({
      ...exactIdentityResolution(request),
      work_id: WORK_B,
    }),
  }), /verifier_identity_scope_mismatch/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createNyraWorkAutomationReceiptService } from "../src/nyraWorkAutomationReceipt.js";

const secret = "n".repeat(64);
const digest = "a".repeat(64);
const sha = "b".repeat(40);

test("commit attestations are signed and exact-bound", () => {
  const service = createNyraWorkAutomationReceiptService({ secret, now: () => 1_700_000_000_000 });
  const receipt = service.commitAttestation({
    tenant_id: "tenant", work_id: "work", intent_anchor_digest: digest,
    task_objective_digest: digest, repository: "owner/repo", branch: "agent/work",
    parent_commit: sha, commit: "c".repeat(40), tree_sha: "d".repeat(40),
    changed_files: ["a.js"], diff_digest: digest, builder_agent_id: "builder",
    host_session_fingerprint: "session", authoritative_readback_digest: digest,
  });
  assert.equal(receipt.schema_version, "nyra_commit_attestation_v2");
  assert.equal(service.verify(receipt, { now: () => 1_700_000_000_100, expected: { work_id: "work" } }).commit, "c".repeat(40));
  assert.throws(() => service.verify({ ...receipt, commit: sha }, { now: () => 1_700_000_000_100 }), /integrity/);
});

test("final acceptance rejects readiness-only evidence", () => {
  const service = createNyraWorkAutomationReceiptService({ secret });
  assert.throws(() => service.finalAcceptance({ tenant_id: "t", work_id: "w", intent_anchor_digest: digest, live_commit: sha, services_digest: digest, criteria: [{ proven: false }] }), /not_proven/);
});

test("final acceptance cannot be minted for an empty criterion policy", () => {
  const receipts = createNyraWorkAutomationReceiptService({ secret: "s".repeat(64) });
  assert.throws(() => receipts.finalAcceptance({ tenant_id: "t", work_id: "w", intent_anchor_digest: "a".repeat(64), live_commit: "b".repeat(40), services_digest: "c".repeat(64), criteria: [] }), /not_proven/);
});

test("criterion policy is server-owned, exact and wildcard-free", () => {
  const service = createNyraWorkAutomationReceiptService({ secret });
  const policy = service.criterionPolicy({ tenant_id: "t", work_id: "w", intent_anchor_digest: digest, criteria: [{ criterion_id: "criterion-1", criterion_digest: digest }] });
  assert.equal(policy.server_owned, true);
  assert.equal(policy.wildcard_allowed, false);
  assert.throws(() => service.criterionPolicy({ tenant_id: "t", work_id: "w", intent_anchor_digest: digest, criteria: [{ criterion_id: "*", criterion_digest: digest }] }), /policy_invalid/);
});

test("builder plan receipt binds builder, session, delegation and exact path scope", () => {
  const receipts = createNyraWorkAutomationReceiptService({ secret: "s".repeat(64) });
  const receipt = receipts.builderPlan({ tenant_id: "t", work_id: "w", intent_anchor_digest: "a".repeat(64), task_objective_digest: "b".repeat(64), builder_agent_id: "builder", session_fingerprint: "session", plan_digest: "c".repeat(64), delegation_id: "delegation", allowed_paths_digest: "d".repeat(64) });
  assert.equal(receipts.verify(receipt, { expectedSchemaVersion: "nyra_signed_builder_plan_v1", expected: { builder_agent_id: "builder", session_fingerprint: "session" } }).delegation_id, "delegation");
  assert.throws(() => receipts.verify(receipt, { expected: { session_fingerprint: "other" } }), /binding_mismatch/);
});

test("criterion proof receipts require authoritative proven state and exact live binding", () => {
  const service = createNyraWorkAutomationReceiptService({ secret });
  assert.throws(() => service.criterionProofs({ tenant_id: "t", work_id: "w", intent_anchor_digest: digest, policy_digest: digest, head_commit: sha, proofs: [{ criterion_id: "c", criterion_digest: digest, proven: false }] }), /proofs_invalid/);
  const proof = service.finalCriterionProof({ tenant_id: "t", work_id: "w", intent_anchor_digest: digest, policy_digest: digest, criterion_id: "c", criterion_digest: digest, live_commit: sha, evidence_digest: digest, proven: true });
  assert.equal(service.verify(proof, { expectedSchemaVersion: "nyra_final_criterion_proof_v1", expected: { live_commit: sha, criterion_id: "c" } }).final, true);
  assert.throws(() => service.verify(proof, { expected: { live_commit: "c".repeat(40) } }), /binding_mismatch/);
});

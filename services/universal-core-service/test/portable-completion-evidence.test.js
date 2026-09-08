import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildCompletionManifest,
  buildVerificationEvidenceContract,
  exportPortableVerificationBundle,
  verifyCompletionEvidence,
  verifyPortableVerificationBundle,
} from "../src/verificationEvidenceContract.js";

const TENANT_ID = "tenant-a";
const WORK_ID = "11111111-1111-8111-8111-111111111111";
const TASK_ID = "22222222-2222-8222-8222-222222222222";
const TREE_ID = "release-tree";
const NODE_ID = "tests";
const NOW = "2026-09-08T12:00:00.000Z";
const VALID_AT = "2026-09-08T13:00:00.000Z";

function evidence() {
  return buildVerificationEvidenceContract({
    tenant_id: TENANT_ID,
    work_id: WORK_ID,
    tree_id: TREE_ID,
    node_id: NODE_ID,
    claim: "tests_pass",
    artifacts: [{
      artifact_id: "test-output",
      content_digest: "sha256:test-output",
      source_reference: "urn:test:output",
    }],
    provenance: {
      tenant_id: TENANT_ID,
      work_id: WORK_ID,
      tree_id: TREE_ID,
      node_id: NODE_ID,
      producer_id: "producer-a",
      source_type: "node_test_runner",
      source_reference: "urn:test:runner",
    },
    votes: [{
      verifier_id: "verifier-a",
      identity_receipt: "identity-receipt-a",
      assignment_id: "assignment-a",
      decision: "approve",
      rationale: "Independent reproduction passed.",
    }],
  });
}

function manifest(evidenceDigest, overrides = {}) {
  return buildCompletionManifest({
    tenant_id: TENANT_ID,
    work_id: WORK_ID,
    work_revision: 7,
    task_id: TASK_ID,
    task_revision: 2,
    intent_digest: "a".repeat(64),
    required_claims: ["tests_pass"],
    artifact_refs: ["urn:artifact:build"],
    commit_refs: ["commit:abc"],
    deploy_refs: ["deploy:prod-1"],
    live_verification_refs: ["evidence:live-smoke"],
    evidence_bindings: [{
      claim: "tests_pass",
      evidence_digest: evidenceDigest,
      tree_id: TREE_ID,
      node_id: NODE_ID,
      tenant_id: TENANT_ID,
      work_id: WORK_ID,
      work_revision: 7,
      task_revision: 2,
      environment: "production",
      scope: "core-mcp:test",
    }],
    dependency_manifest_ref: "urn:dependency:manifest",
    context_snapshot_ref: "urn:context:snapshot",
    policy_revision: "b".repeat(64),
    verifier_revision: "ect:v2",
    effect_lineage_refs: ["effect:deploy"],
    completion_stage: "VERIFIED_LIVE",
    ...overrides,
  });
}

function exactIdentity(request) {
  return {
    verified: true,
    tenant_id: request.tenant_id,
    work_id: request.work_id,
    tree_id: request.tree_id,
    node_id: request.node_id,
    verifier_id: request.verifier_id,
    evidence_digest: request.evidence_digest,
    assignment_id: request.assignment_id,
    independence_key: "independent-verifier-a",
    execution_authorized: false,
  };
}

function exactArtifact(request) {
  return { ...request, verified: true, registry_id: "registry-a", execution_authorized: false };
}

async function fixture() {
  const contract = evidence();
  const completion = manifest(contract.evidence_digest);
  const verified = await verifyCompletionEvidence(completion, {
    evidence_contracts: [contract],
    resolve_verifier_identity: exactIdentity,
    resolve_evidence_artifact: exactArtifact,
  });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const bundle = await exportPortableVerificationBundle({
    completion_verification: verified,
    evidence_contracts: [contract],
    revocation_snapshot: {
      as_of: "2026-09-09T00:00:00.000Z",
      revision: "c".repeat(64),
      quality: "AUTHORITATIVE",
      revoked_key_ids: [],
    },
    signed_at: NOW,
    signer: { key_id: "verifier:test", private_key: privateKey, public_key: publicKey },
  });
  return { bundle, contract, publicKey };
}

test("ECT completion binds claim, Work revision, environment and independent evidence", async () => {
  const contract = evidence();
  const completion = manifest(contract.evidence_digest);
  const result = await verifyCompletionEvidence(completion, {
    evidence_contracts: [contract],
    resolve_verifier_identity: exactIdentity,
    resolve_evidence_artifact: exactArtifact,
  });
  assert.equal(result.completion_verified, true);
  assert.equal(result.completion_stage, "VERIFIED_LIVE");
  assert.equal(result.execution_authorized, false);

  assert.throws(() => manifest(contract.evidence_digest, {
    evidence_bindings: [{
      ...completion.evidence_bindings[0],
      work_revision: 6,
    }],
  }), /completion_evidence_scope_mismatch/);
  await assert.rejects(verifyCompletionEvidence(completion, {
    evidence_contracts: [],
    resolve_verifier_identity: exactIdentity,
    resolve_evidence_artifact: exactArtifact,
  }), /completion_evidence_contract_missing/);
});

test("portable bundle separates integrity, trust, provenance and revocation currentness", async () => {
  const { bundle, publicKey } = await fixture();
  const result = verifyPortableVerificationBundle(bundle, {
    trusted_public_keys: [{ key_id: "verifier:test", public_key: publicKey }],
    valid_at: VALID_AT,
  });
  assert.equal(result.integrity_verified, true);
  assert.equal(result.signer_verified, true);
  assert.equal(result.claim_bindings_verified, true);
  assert.equal(result.verifier_identity_assertion, "SIGNED_EXPORT_ASSERTION");

  const tampered = structuredClone(bundle);
  tampered.completion_verification.manifest.work_revision = 8;
  assert.throws(() => verifyPortableVerificationBundle(tampered, {
    trusted_public_keys: [{ key_id: "verifier:test", public_key: publicKey }],
    valid_at: VALID_AT,
  }), /portable_bundle_digest_invalid/);
  assert.throws(() => verifyPortableVerificationBundle(bundle, {
    trusted_public_keys: [{ key_id: "verifier:test", public_key: publicKey }],
    valid_at: "2026-09-10T00:00:00.000Z",
  }), /portable_bundle_current_revocation_unknown/);
});

test("portable verification CLI validates a self-contained bundle against an external trust anchor", async (t) => {
  const { bundle, publicKey } = await fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "portable-evidence-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bundlePath = path.join(directory, "bundle.json");
  const keyPath = path.join(directory, "trust.pem");
  fs.writeFileSync(bundlePath, `${JSON.stringify(bundle)}\n`);
  fs.writeFileSync(keyPath, publicKey.export({ format: "pem", type: "spki" }));
  const result = spawnSync(process.execPath, [
    "tools/verify-portable-evidence-bundle.js", bundlePath, keyPath, VALID_AT,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).claim_bindings_verified, true);
});

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import test from "node:test";
import {
  createDttAgentIdentityReceiptService,
  createFileDttAgentIdentityReceiptStore,
  createInMemoryDttAgentIdentityReceiptStore,
  createPostgresDttAgentIdentityReceiptStore,
  issueDttAgentContext,
} from "../../shared/dtt-agent-identity-receipts.js";
import {
  buildVerificationEvidenceContract,
  validateVerificationEvidenceContractAsync,
} from "../src/verificationEvidenceContract.js";
import { createFileDttVerificationTrustStore } from "../src/dttVerificationTrustStore.js";

const secret = "test-only-dtt-agent-identity-secret-000000000000";
const assignmentResolver = ({ assignment_id }) => ({ verified: assignment_id === "assignment-test" });
function receiptService(options) {
  const service = createDttAgentIdentityReceiptService({ ...options, resolve_assignment: assignmentResolver });
  return { ...service, issue: (input) => service.issue({ assignment_id: "assignment-test", ...input }) };
}
const presenceA = {
  agent_id: "agent-a",
  session_fingerprint: "session-fingerprint-a",
  signature: "ags_presence_a",
  opaque_agent_id: "ai_agent_a",
  actor_provenance: "ap_actor_a",
  client_type: "codex",
};
const presenceB = {
  agent_id: "agent-b",
  session_fingerprint: "session-fingerprint-b",
  signature: "ags_presence_b",
  opaque_agent_id: "ai_agent_b",
  actor_provenance: "ap_actor_b",
  client_type: "codex",
};

test("Core issues verifier-bound receipts for two independently signed agent sessions", () => {
  let nonce = 0;
  const random = (size) => Buffer.alloc(size, ++nonce);
  const service = receiptService({
    secret, randomBytes: random, store: createInMemoryDttAgentIdentityReceiptStore(),
  });
  const contextA = issueDttAgentContext({
    secret, tenant_id: "tenant-a", agent_presence: presenceA, random_bytes: random,
  });
  const contextB = issueDttAgentContext({
    secret, tenant_id: "tenant-a", agent_presence: presenceB, random_bytes: random,
  });
  const a = service.issue({
    context_token: contextA,
    tenant_id: "tenant-a",
    tree_id: "tree-a",
    node_id: "verify",
    evidence_digest: "evd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    decision: "approve", rationale: "Independent verification passed.",
  });
  const b = service.issue({
    context_token: contextB,
    tenant_id: "tenant-a",
    tree_id: "tree-a",
    node_id: "verify",
    evidence_digest: "evd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    decision: "approve", rationale: "Independent verification passed.",
  });
  assert.notEqual(a.identity_receipt, b.identity_receipt);
  assert.equal(service.validate({
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    decision: "approve", rationale: "Independent verification passed.",
    verifier_id: "agent-a", identity_receipt: a.identity_receipt,
  }).verified, true);
  assert.equal(service.validate({
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    decision: "approve", rationale: "Independent verification passed.",
    verifier_id: "agent-b", identity_receipt: b.identity_receipt,
  }).verified, true);
});

test("forged context, forged receipt, context replay and cross-scope receipt reuse fail closed", () => {
  const service = receiptService({
    secret, store: createInMemoryDttAgentIdentityReceiptStore(),
  });
  const context = issueDttAgentContext({ secret, tenant_id: "tenant-a", agent_presence: presenceA });
  const forgedContext = `${context.slice(0, -1)}${context.endsWith("0") ? "1" : "0"}`;
  assert.throws(() => service.issue({
    context_token: forgedContext, tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    decision: "approve", rationale: "Independent verification passed.",
  }), /dac_signature_invalid/);

  const issued = service.issue({
    context_token: context, tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    decision: "approve", rationale: "Independent verification passed.",
  });
  assert.throws(() => service.issue({
    context_token: context, tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    decision: "approve", rationale: "Independent verification passed.",
  }), /dtt_agent_context_replayed/);

  const forgedReceipt = `${issued.identity_receipt.slice(0, -1)}${issued.identity_receipt.endsWith("0") ? "1" : "0"}`;
  assert.throws(() => service.validate({
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    decision: "approve", rationale: "Independent verification passed.",
    verifier_id: "agent-a", identity_receipt: forgedReceipt,
  }), /dair_signature_invalid/);
  for (const mismatch of [
    { tenant_id: "tenant-b" },
    { tree_id: "tree-b" },
    { node_id: "other-node" },
    { verifier_id: "agent-b" },
    { evidence_digest: "evd_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
  ]) {
    assert.equal(service.validate({
      tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
      evidence_digest: "evd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      decision: "approve", rationale: "Independent verification passed.",
      verifier_id: "agent-a", identity_receipt: issued.identity_receipt, ...mismatch,
    }).verified, false);
  }
});

test("missing or weak shared secret fails closed", () => {
  assert.throws(() => createDttAgentIdentityReceiptService({
    secret: "", store: createInMemoryDttAgentIdentityReceiptStore(),
  }), /secret_unavailable/);
  assert.throws(() => createDttAgentIdentityReceiptService({ secret }), /store_unavailable/);
  assert.throws(() => issueDttAgentContext({
    secret: "short", tenant_id: "tenant-a", agent_presence: presenceA,
  }), /secret_unavailable/);
});

test("agent context and receipt fail closed at the exact expiry millisecond", () => {
  let nowMs = 1_800_000_000_000;
  const store = createInMemoryDttAgentIdentityReceiptStore();
  const service = receiptService({
    secret,
    now: () => nowMs,
    receipt_ttl_ms: 30_000,
    store,
  });
  const expiredContext = issueDttAgentContext({
    secret,
    tenant_id: "tenant-a",
    agent_presence: presenceA,
    now_ms: nowMs - 5_000,
    ttl_ms: 5_000,
  });
  assert.throws(() => service.issue({
    context_token: expiredContext,
    tenant_id: "tenant-a",
    tree_id: "tree-expiry",
    node_id: "verify",
    evidence_digest:
      "evd_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    decision: "approve",
    rationale: "Expiry boundary.",
  }), /dtt_agent_context_expired/);

  const liveContext = issueDttAgentContext({
    secret,
    tenant_id: "tenant-a",
    agent_presence: presenceA,
    now_ms: nowMs,
  });
  const issued = service.issue({
    context_token: liveContext,
    tenant_id: "tenant-a",
    tree_id: "tree-expiry",
    node_id: "verify",
    evidence_digest:
      "evd_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    decision: "approve",
    rationale: "Expiry boundary.",
  });
  nowMs += 30_000;
  assert.equal(service.validate({
    tenant_id: "tenant-a",
    tree_id: "tree-expiry",
    node_id: "verify",
    evidence_digest:
      "evd_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    decision: "approve",
    rationale: "Expiry boundary.",
    verifier_id: "agent-a",
    identity_receipt: issued.identity_receipt,
  }).verified, false);
});

test("different agent ids and sessions from the same signed actor cannot satisfy quorum", async () => {
  const store = createInMemoryDttAgentIdentityReceiptStore();
  const service = receiptService({ secret, store });
  const secondAlias = {
    ...presenceB,
    session_fingerprint: "different-session-for-same-actor",
    actor_provenance: presenceA.actor_provenance,
  };
  const evidenceDigest = "evd_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const rationale = "Same evidence reviewed.";
  const receipts = [presenceA, secondAlias].map((presence) => service.issue({
    context_token: issueDttAgentContext({ secret, tenant_id: "tenant-a", agent_presence: presence }),
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: evidenceDigest, decision: "approve", rationale,
  }));
  const evidence = buildVerificationEvidenceContract({
    tenant_id: "tenant-a",
    tree_id: "tree-a",
    node_id: "verify",
    claim: "Independent verification required.",
    artifacts: [{
      artifact_id: "artifact",
      content_digest: "sha256:artifact",
      source_reference: "urn:test:artifact",
    }],
    provenance: {
      tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
      producer_id: "producer", source_type: "test", source_reference: "urn:test:producer",
    },
    votes: receipts.map((receipt) => ({
      verifier_id: receipt.verifier_id,
      identity_receipt: receipt.identity_receipt,
      assignment_id: receipt.assignment_id,
      decision: "approve",
      rationale,
    })),
    required_approvals: 2,
  });
  // Replace the proposed digest with the actual contract digest and issue
  // fresh receipts for that exact immutable evidence payload.
  const exactReceipts = [presenceA, secondAlias].map((presence) => service.issue({
    context_token: issueDttAgentContext({ secret, tenant_id: "tenant-a", agent_presence: presence }),
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: evidence.evidence_digest, decision: "approve", rationale,
  }));
  const exactEvidence = buildVerificationEvidenceContract({
    ...evidence,
    votes: exactReceipts.map((receipt) => ({
      verifier_id: receipt.verifier_id,
      identity_receipt: receipt.identity_receipt,
      assignment_id: receipt.assignment_id,
      decision: "approve",
      rationale,
    })),
    required_approvals: 2,
  });
  await assert.rejects(() => validateVerificationEvidenceContractAsync(exactEvidence, {
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    minimum_approvals: 2,
    require_verified_identities: true,
    resolve_verifier_identity: (input) => service.validate(input),
  }), /verifier_independence_duplicate/);
});

test("file CAS store preserves receipt validation and context replay denial across restart", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dtt-agent-receipts-"));
  const file = path.join(root, "receipts.json");
  let nowMs = Date.now();
  const context = issueDttAgentContext({
    secret, tenant_id: "tenant-a", agent_presence: presenceA, now_ms: nowMs,
  });
  const first = receiptService({
    secret,
    now: () => nowMs,
    receipt_ttl_ms: 30_000,
    store: createFileDttAgentIdentityReceiptStore({ file_path: file }),
  });
  const issued = first.issue({
    context_token: context, tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    decision: "approve", rationale: "Persistent verification.",
  });
  const restarted = receiptService({
    secret,
    now: () => nowMs,
    store: createFileDttAgentIdentityReceiptStore({ file_path: file }),
  });
  assert.equal(restarted.validate({
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    decision: "approve", rationale: "Persistent verification.",
    verifier_id: "agent-a", identity_receipt: issued.identity_receipt,
  }).verified, true);
  assert.throws(() => restarted.issue({
    context_token: context, tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    decision: "approve", rationale: "Persistent verification.",
  }), /dtt_agent_context_replayed/);
  nowMs += 3_600_000;
  const lateRestart = receiptService({
    secret,
    now: () => nowMs,
    store: createFileDttAgentIdentityReceiptStore({ file_path: file }),
  });
  assert.equal(lateRestart.validate({
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    decision: "approve", rationale: "Persistent verification.",
    verifier_id: "agent-a", identity_receipt: issued.identity_receipt,
  }).verified, false);
});

test("bounded long rationale produces a receipt accepted by the evidence contract", async () => {
  const service = receiptService({
    secret, store: createInMemoryDttAgentIdentityReceiptStore(),
  });
  const rationale = "R".repeat(900);
  const proposal = buildVerificationEvidenceContract({
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "analysis",
    claim: "Long rationale remains bounded.",
    artifacts: [{ artifact_id: "a", content_digest: "sha256:a", source_reference: "urn:a" }],
    provenance: {
      tenant_id: "tenant-a", tree_id: "tree-a", node_id: "analysis",
      producer_id: "producer", source_type: "test", source_reference: "urn:producer",
    },
    votes: [{
      verifier_id: "agent-a", decision: "approve", rationale,
      identity_receipt: "proposal-receipt",
      assignment_id: "assignment-test",
    }],
    required_approvals: 1,
  });
  const issued = service.issue({
    context_token: issueDttAgentContext({ secret, tenant_id: "tenant-a", agent_presence: presenceA }),
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "analysis",
    evidence_digest: proposal.evidence_digest, decision: "approve", rationale,
  });
  assert(issued.identity_receipt.length > 500);
  const evidence = buildVerificationEvidenceContract({
    ...proposal,
    votes: [{
      verifier_id: issued.verifier_id, decision: "approve", rationale,
      identity_receipt: issued.identity_receipt,
      assignment_id: issued.assignment_id,
    }],
    required_approvals: 1,
  });
  const validated = await validateVerificationEvidenceContractAsync(evidence, {
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "analysis",
    minimum_approvals: 1,
    require_verified_identities: true,
    resolve_verifier_identity: (input) => service.validate(input),
  });
  assert.equal(validated.contract_satisfied, true);
});

test("PostgreSQL receipt store consumes context and inserts receipt in one transaction", async () => {
  const statements = [];
  let contextAvailable = true;
  const client = {
    async query(sql) {
      statements.push(String(sql).trim().split(/\s+/).slice(0, 4).join(" "));
      if (String(sql).includes("INSERT INTO dtt_agent_identity_contexts")) {
        const available = contextAvailable;
        contextAvailable = false;
        return { rowCount: available ? 1 : 0, rows: available ? [{ context_fingerprint: "f" }] : [] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() { statements.push("RELEASE"); },
  };
  const pool = {
    async query(sql) { statements.push(String(sql).includes("CREATE TABLE") ? "INITIALIZE" : "POOL_QUERY"); return { rows: [] }; },
    async connect() { return client; },
  };
  const store = createPostgresDttAgentIdentityReceiptStore({ pool });
  const record = {
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_a", verifier_id: "agent-a", session_fingerprint: "session-a",
    decision: "approve", rationale: "ok", receipt: "signed", expires_at_ms: Date.now() + 60_000,
  };
  assert.equal(await store.issueAtomic("f".repeat(64), Date.now() + 60_000, "dair_one", record), true);
  assert.equal(await store.issueAtomic("f".repeat(64), Date.now() + 60_000, "dair_two", record), false);
  assert(statements.some((item) => item === "BEGIN"));
  assert(statements.some((item) => item === "COMMIT"));
  assert(statements.some((item) => item === "ROLLBACK"));
});

test("artifact registry resolves only the exact tenant-bound server-computed tuple", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dtt-artifact-trust-"));
  const store = createFileDttVerificationTrustStore({ root });
  const artifact = store.registerArtifact({
    tenant_id: "tenant-a",
    artifact_id: "artifact-a",
    content: "reviewed immutable content",
    source_reference: "urn:source:a",
    registry_reference: "urn:registry:a",
  });
  assert.equal(store.verifyArtifact(artifact).verified, true);
  assert.equal(store.verifyArtifact({ ...artifact, tenant_id: "tenant-b" }).verified, false);
  assert.equal(store.verifyArtifact({ ...artifact, content_digest: "sha256:fabricated" }).verified, false);
  assert.equal(store.verifyArtifact({ ...artifact, source_reference: "urn:source:changed" }).verified, false);
});

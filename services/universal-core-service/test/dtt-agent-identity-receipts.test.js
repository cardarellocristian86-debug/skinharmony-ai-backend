import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import test from "node:test";
import {
  createDttAgentIdentityReceiptService,
  createAsyncDttAgentIdentityReceiptService,
  createFileDttAgentIdentityReceiptStore,
  createInMemoryDttAgentIdentityReceiptStore,
  createPostgresDttAgentIdentityReceiptStore,
  DTT_AGENT_CONTEXT_VERSION,
  DTT_AGENT_IDENTITY_RECEIPT_VERSION,
  issueCausalAgentIdentityContext,
  issueDttAgentContext,
  verifyCausalAgentIdentityContext,
} from "../../shared/dtt-agent-identity-receipts.js";
import {
  buildVerificationEvidenceContract,
  validateVerificationEvidenceContractAsync,
} from "../src/verificationEvidenceContract.js";
import { createFileDttVerificationTrustStore } from "../src/dttVerificationTrustStore.js";

const secret = "test-only-dtt-agent-identity-secret-000000000000";
const TRUST_WORK = "11111111-1111-4111-8111-111111111111";
const OTHER_WORK = "22222222-2222-8222-8222-222222222222";
const assignmentResolver = (input) => ({
  ...input,
  verified: input.assignment_id === "assignment-test" && input.work_id === TRUST_WORK,
  execution_authorized: false,
});
function receiptService(options) {
  const service = createDttAgentIdentityReceiptService({ ...options, resolve_assignment: assignmentResolver });
  return {
    ...service,
    issue: (input) => service.issue({
      work_id: TRUST_WORK,
      assignment_id: "assignment-test",
      expected_principal: expectedPrincipal(presenceA),
      ...input,
    }),
    validate: (input) => service.validate({
      work_id: TRUST_WORK,
      assignment_id: "assignment-test",
      ...input,
    }),
  };
}
const presenceA = {
  agent_id: "agent-a",
  session_id: "session-a",
  session_fingerprint: "session-fingerprint-a",
  host_transport_session_fingerprint: "transport-fingerprint-a",
  signature: "ags_presence_a",
  opaque_agent_id: "ai_agent_a",
  actor_provenance: "ap_actor_a",
  client_type: "codex",
};
const presenceB = {
  agent_id: "agent-b",
  session_id: "session-b",
  session_fingerprint: "session-fingerprint-b",
  host_transport_session_fingerprint: "transport-fingerprint-b",
  signature: "ags_presence_b",
  opaque_agent_id: "ai_agent_b",
  actor_provenance: "ap_actor_b",
  client_type: "codex",
};

function expectedPrincipal(presence) {
  const { signature, ...principal } = presence;
  return { ...principal, presence_signature: signature };
}

function agentContext(presence = presenceA, options = {}) {
  return issueDttAgentContext({
    secret,
    tenant_id: "tenant-a",
    work_id: TRUST_WORK,
    agent_presence: presence,
    ...options,
  });
}

function tokenPayload(token) {
  const encoded = token.slice(token.indexOf("_") + 1, token.lastIndexOf("."));
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

function legacyToken(prefix, domain, payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret)
    .update(`${domain}\u0000${encoded}`)
    .digest("hex");
  return `${prefix}_${encoded}.${signature}`;
}

test("causal identity context authenticates a tenant agent without inventing a Work", () => {
  const now = 1_800_000_000_000;
  const token = issueCausalAgentIdentityContext({
    secret,
    tenant_id: "tenant-a",
    agent_presence: presenceA,
    now_ms: now,
    random_bytes: (size) => Buffer.alloc(size, 7),
  });
  const verified = verifyCausalAgentIdentityContext({
    context_token: token,
    secret,
    expected_tenant_id: "tenant-a",
    now: () => now + 1_000,
  });
  assert.equal(verified.schema_version, "causal_agent_identity_context_v1");
  assert.equal(verified.tenant_id, "tenant-a");
  assert.equal(verified.agent_id, presenceA.agent_id);
  assert.equal(verified.execution_authorized, false);
  assert.equal("work_id" in verified, false);
  assert(Object.isFrozen(verified));
  assert.throws(() => verifyCausalAgentIdentityContext({
    context_token: token,
    secret,
    expected_tenant_id: "tenant-b",
    now: () => now + 1_000,
  }), /causal_agent_identity_tenant_mismatch/);
  assert.throws(() => verifyCausalAgentIdentityContext({
    context_token: `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`,
    secret,
    expected_tenant_id: "tenant-a",
    now: () => now + 1_000,
  }), /cai_signature_invalid/);
  assert.throws(() => verifyCausalAgentIdentityContext({
    context_token: token,
    secret,
    expected_tenant_id: "tenant-a",
    now: () => now + 300_001,
  }), /causal_agent_identity_expired/);
});

test("agent context V2 requires a Work UUID v1-v8 and the exact transport principal", () => {
  const service = receiptService({ secret, store: createInMemoryDttAgentIdentityReceiptStore() });
  for (let version = 1; version <= 8; version += 1) {
    const acceptedWork = `aaaaaaaa-aaaa-${version}aaa-8aaa-aaaaaaaaaaaa`;
    const context = agentContext(presenceA, { work_id: acceptedWork });
    const verified = service.verifyContext(
      context,
      "tenant-a",
      acceptedWork.toUpperCase(),
      expectedPrincipal(presenceA),
    );
    assert.equal(verified.schema_version, DTT_AGENT_CONTEXT_VERSION);
    assert.equal(verified.work_id, acceptedWork);
    assert.equal(verified.execution_authorized, false);
    assert(Object.isFrozen(verified));
  }
  assert.throws(() => agentContext(presenceA, { work_id: undefined }), /work_id_invalid/);
  assert.throws(() => agentContext(presenceA, {
    work_id: "aaaaaaaa-aaaa-9aaa-8aaa-aaaaaaaaaaaa",
  }), /work_id_invalid/);
  const context = agentContext();
  assert.throws(() => service.verifyContext(context, "tenant-a", TRUST_WORK), /principal_required/);
  const nonCanonicalPayload = Object.fromEntries(Object.entries(tokenPayload(context)).reverse());
  const nonCanonicalContext = legacyToken("dac", "dtt-agent-context-v2", nonCanonicalPayload);
  assert.throws(() => service.verifyContext(
    nonCanonicalContext, "tenant-a", TRUST_WORK, expectedPrincipal(presenceA),
  ), /dac_payload_invalid/);
  for (const field of [
    "agent_id",
    "session_id",
    "session_fingerprint",
    "host_transport_session_fingerprint",
    "presence_signature",
    "opaque_agent_id",
    "actor_provenance",
    "client_type",
  ]) {
    assert.throws(() => service.verifyContext(context, "tenant-a", TRUST_WORK, {
      ...expectedPrincipal(presenceA),
      [field]: `${expectedPrincipal(presenceA)[field]}-other`,
    }), /principal_mismatch/);
  }
});

test("assignment resolver must echo the exact Work, tree, node, and transport principal", () => {
  for (const forged of [
    { tree_id: "tree-other" },
    { actor_provenance: "ap_actor_other" },
    { host_transport_session_fingerprint: "transport-other" },
  ]) {
    const service = createDttAgentIdentityReceiptService({
      secret,
      store: createInMemoryDttAgentIdentityReceiptStore(),
      resolve_assignment: (input) => ({
        ...input,
        ...forged,
        verified: true,
        execution_authorized: false,
      }),
    });
    assert.throws(() => service.issue({
      context_token: agentContext(),
      tenant_id: "tenant-a",
      work_id: TRUST_WORK,
      tree_id: "tree-a",
      node_id: "verify",
      evidence_digest: "evd_assignment_echo",
      decision: "approve",
      rationale: "Resolver echo must be exact.",
      assignment_id: "assignment-test",
      expected_principal: expectedPrincipal(presenceA),
    }), /dtt_verifier_assignment_invalid/);
  }
});

test("Core issues verifier-bound receipts for two independently signed agent sessions", () => {
  let nonce = 0;
  const random = (size) => Buffer.alloc(size, ++nonce);
  const service = receiptService({
    secret, randomBytes: random, store: createInMemoryDttAgentIdentityReceiptStore(),
  });
  const contextA = agentContext(presenceA, { random_bytes: random });
  const contextB = agentContext(presenceB, { random_bytes: random });
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
    expected_principal: expectedPrincipal(presenceB),
    tenant_id: "tenant-a",
    tree_id: "tree-a",
    node_id: "verify",
    evidence_digest: "evd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    decision: "approve", rationale: "Independent verification passed.",
  });
  assert.notEqual(a.identity_receipt, b.identity_receipt);
  assert.deepEqual(tokenPayload(contextA), {
    ...tokenPayload(contextA),
    schema_version: DTT_AGENT_CONTEXT_VERSION,
    tenant_id: "tenant-a",
    work_id: TRUST_WORK,
    execution_authorized: false,
  });
  assert.equal(tokenPayload(a.identity_receipt).schema_version, DTT_AGENT_IDENTITY_RECEIPT_VERSION);
  assert.equal(tokenPayload(a.identity_receipt).work_id, TRUST_WORK);
  assert.equal(tokenPayload(a.identity_receipt).execution_authorized, false);
  const validatedA = service.validate({
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    decision: "approve", rationale: "Independent verification passed.",
    verifier_id: "agent-a", identity_receipt: a.identity_receipt,
  });
  assert.deepEqual(validatedA, {
    verified: true,
    tenant_id: "tenant-a",
    work_id: TRUST_WORK,
    tree_id: "tree-a",
    node_id: "verify",
    verifier_id: "agent-a",
    evidence_digest: "evd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    receipt_id: a.receipt_id,
    session_fingerprint: presenceA.session_fingerprint,
    assignment_id: "assignment-test",
    independence_key: presenceA.actor_provenance,
    execution_authorized: false,
  });
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
  const context = agentContext();
  assert.throws(() => service.issue({
    context_token: context,
    work_id: OTHER_WORK,
    tenant_id: "tenant-a",
    tree_id: "tree-a",
    node_id: "verify",
    evidence_digest: "evd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    decision: "approve",
    rationale: "Cross-Work context reuse must fail.",
  }), /dtt_agent_context_work_mismatch/);
  assert.throws(() => service.issue({
    context_token: context,
    expected_principal: expectedPrincipal(presenceB),
    tenant_id: "tenant-a",
    tree_id: "tree-a",
    node_id: "verify",
    evidence_digest: "evd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    decision: "approve",
    rationale: "Cross-principal context reuse must fail.",
  }), /dtt_agent_context_principal_mismatch/);
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
    { work_id: OTHER_WORK },
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
    secret: "short", tenant_id: "tenant-a", work_id: TRUST_WORK, agent_presence: presenceA,
  }), /secret_unavailable/);
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
    context_token: agentContext(presence),
    expected_principal: expectedPrincipal(presence),
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: evidenceDigest, decision: "approve", rationale,
  }));
  const evidence = buildVerificationEvidenceContract({
    tenant_id: "tenant-a",
    work_id: TRUST_WORK,
    tree_id: "tree-a",
    node_id: "verify",
    claim: "Independent verification required.",
    artifacts: [{
      artifact_id: "artifact",
      content_digest: "sha256:artifact",
      source_reference: "urn:test:artifact",
    }],
    provenance: {
      tenant_id: "tenant-a", work_id: TRUST_WORK, tree_id: "tree-a", node_id: "verify",
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
    context_token: agentContext(presence),
    expected_principal: expectedPrincipal(presence),
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
    tenant_id: "tenant-a", work_id: TRUST_WORK, tree_id: "tree-a", node_id: "verify",
    minimum_approvals: 2,
    require_verified_identities: true,
    resolve_verifier_identity: (input) => service.validate(input),
  }), /verifier_independence_duplicate/);
});

test("file CAS store preserves receipt validation and context replay denial across restart", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dtt-agent-receipts-"));
  const file = path.join(root, "receipts.json");
  let nowMs = Date.now();
  const context = agentContext(presenceA, { now_ms: nowMs });
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
  assert.equal(restarted.validate({
    work_id: OTHER_WORK,
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    decision: "approve", rationale: "Persistent verification.",
    verifier_id: "agent-a", identity_receipt: issued.identity_receipt,
  }).verified, false);
  fs.writeFileSync(path.join(root, "receipts.v2.json"), "{malformed", { encoding: "utf8" });
  assert.throws(() => restarted.size(), /dtt_agent_identity_store_corrupt/);
});

test("legacy V1 file records are preserved but never indexed, associated, or accepted for a Work", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dtt-agent-receipts-v1-"));
  const file = path.join(root, "receipts.json");
  const legacyPayload = {
    version: "dtt_agent_identity_receipt_v1",
    key_id: "dik_legacy",
    receipt_id: "dair_legacy",
    tenant_id: "tenant-a",
    tree_id: "tree-a",
    node_id: "verify",
    evidence_digest: "evd_legacy",
    decision: "approve",
    rationale: "Legacy proof.",
    assignment_id: "assignment-test",
    actor_provenance: presenceA.actor_provenance,
    opaque_agent_id: presenceA.opaque_agent_id,
    verifier_id: presenceA.agent_id,
    session_fingerprint: presenceA.session_fingerprint,
    issued_at_ms: Date.now(),
    expires_at_ms: Date.now() + 60_000,
  };
  const receipt = legacyToken("dair", "dtt-agent-receipt", legacyPayload);
  const original = JSON.stringify({
    contexts: { legacy_context: Date.now() + 60_000 },
    receipts: { dair_legacy: { ...legacyPayload, receipt } },
  });
  fs.writeFileSync(file, original, { mode: 0o600 });
  const legacyHash = crypto.createHash("sha256").update(original).digest("hex");
  const v2File = path.join(root, "receipts.v2.json");
  const store = createFileDttAgentIdentityReceiptStore({ file_path: file });
  for (const candidateWork of [TRUST_WORK, OTHER_WORK]) {
    assert.equal(store.getReceipt({
      receipt_id: "dair_legacy",
      tenant_id: "tenant-a",
      work_id: candidateWork,
      tree_id: "tree-a",
      node_id: "verify",
    }), null);
  }
  assert.equal(fs.readFileSync(file, "utf8"), original);
  const service = receiptService({ secret, store });
  assert.throws(() => service.validate({
    tenant_id: "tenant-a", tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_legacy", decision: "approve", rationale: "Legacy proof.",
    verifier_id: "agent-a", identity_receipt: receipt,
  }), /dair_signature_invalid/);
  const legacyContext = legacyToken("dac", "dtt-agent-context", {
    version: "dtt_agent_context_v1",
    tenant_id: "tenant-a",
    agent_id: presenceA.agent_id,
    session_fingerprint: presenceA.session_fingerprint,
    presence_signature: presenceA.signature,
    opaque_agent_id: presenceA.opaque_agent_id,
    actor_provenance: presenceA.actor_provenance,
    client_type: presenceA.client_type,
    nonce: "a".repeat(36),
    issued_at_ms: Date.now(),
    expires_at_ms: Date.now() + 60_000,
  });
  assert.throws(() => service.verifyContext(
    legacyContext, "tenant-a", TRUST_WORK, expectedPrincipal(presenceA),
  ), /dac_signature_invalid/);
  const issued = service.issue({
    context_token: agentContext(),
    tenant_id: "tenant-a",
    tree_id: "tree-a",
    node_id: "verify",
    evidence_digest: "evd_v2_after_legacy",
    decision: "approve",
    rationale: "V2 remains physically isolated.",
  });
  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    legacyHash,
  );
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.equal(fs.existsSync(v2File), true);
  const restarted = receiptService({
    secret,
    store: createFileDttAgentIdentityReceiptStore({ file_path: file }),
  });
  assert.equal(restarted.validate({
    tenant_id: "tenant-a",
    tree_id: "tree-a",
    node_id: "verify",
    evidence_digest: "evd_v2_after_legacy",
    decision: "approve",
    rationale: "V2 remains physically isolated.",
    verifier_id: presenceA.agent_id,
    identity_receipt: issued.identity_receipt,
  }).verified, true);
});

test("async identity service preserves exact Work and principal binding", async () => {
  const memory = createInMemoryDttAgentIdentityReceiptStore();
  const store = {
    issueAtomic: async (...args) => memory.issueAtomic(...args),
    getReceipt: async (...args) => memory.getReceipt(...args),
    size: async () => memory.size(),
  };
  const seenAssignments = [];
  const service = createAsyncDttAgentIdentityReceiptService({
    secret,
    store,
    resolve_assignment: async (input) => {
      seenAssignments.push(input);
      return assignmentResolver(input);
    },
  });
  const issued = await service.issue({
    context_token: agentContext(),
    tenant_id: "tenant-a",
    work_id: TRUST_WORK,
    tree_id: "tree-a",
    node_id: "verify",
    evidence_digest: "evd_async",
    decision: "approve",
    rationale: "Async verification.",
    assignment_id: "assignment-test",
    expected_principal: expectedPrincipal(presenceA),
  });
  assert.deepEqual(seenAssignments[0], {
    assignment_id: "assignment-test",
    tenant_id: "tenant-a",
    work_id: TRUST_WORK,
    tree_id: "tree-a",
    node_id: "verify",
    verifier_id: presenceA.agent_id,
    session_fingerprint: presenceA.session_fingerprint,
    session_id: presenceA.session_id,
    host_transport_session_fingerprint: presenceA.host_transport_session_fingerprint,
    presence_signature: presenceA.signature,
    client_type: presenceA.client_type,
    opaque_agent_id: presenceA.opaque_agent_id,
    actor_provenance: presenceA.actor_provenance,
  });
  const input = {
    tenant_id: "tenant-a",
    work_id: TRUST_WORK,
    tree_id: "tree-a",
    node_id: "verify",
    evidence_digest: "evd_async",
    decision: "approve",
    rationale: "Async verification.",
    verifier_id: presenceA.agent_id,
    assignment_id: "assignment-test",
    identity_receipt: issued.identity_receipt,
  };
  assert.equal((await service.validate(input)).verified, true);
  assert.equal((await service.validate({ ...input, work_id: OTHER_WORK })).verified, false);
});

test("bounded long rationale produces a receipt accepted by the evidence contract", async () => {
  const service = receiptService({
    secret, store: createInMemoryDttAgentIdentityReceiptStore(),
  });
  const rationale = "R".repeat(900);
  const proposal = buildVerificationEvidenceContract({
    tenant_id: "tenant-a", work_id: TRUST_WORK, tree_id: "tree-a", node_id: "analysis",
    claim: "Long rationale remains bounded.",
    artifacts: [{ artifact_id: "a", content_digest: "sha256:a", source_reference: "urn:a" }],
    provenance: {
      tenant_id: "tenant-a", work_id: TRUST_WORK, tree_id: "tree-a", node_id: "analysis",
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
    context_token: agentContext(),
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
    tenant_id: "tenant-a", work_id: TRUST_WORK, tree_id: "tree-a", node_id: "analysis",
    minimum_approvals: 1,
    require_verified_identities: true,
    resolve_verifier_identity: (input) => service.validate(input),
  });
  assert.equal(validated.contract_satisfied, true);
});

test("PostgreSQL receipt store consumes context and inserts receipt in one transaction", async () => {
  const statements = [];
  const poolQueries = [];
  let initializationSql = "";
  let contextInsertParams;
  let receiptInsertParams;
  let contextAvailable = true;
  const client = {
    async query(sql, params) {
      statements.push(String(sql).trim().split(/\s+/).slice(0, 4).join(" "));
      if (String(sql).includes("INSERT INTO dtt_agent_identity_contexts")) {
        contextInsertParams = params;
        const available = contextAvailable;
        contextAvailable = false;
        return { rowCount: available ? 1 : 0, rows: available ? [{ context_fingerprint: "f" }] : [] };
      }
      if (String(sql).includes("INSERT INTO dtt_agent_identity_receipts")) receiptInsertParams = params;
      return { rowCount: 1, rows: [] };
    },
    release() { statements.push("RELEASE"); },
  };
  const pool = {
    async query(sql, params) {
      if (String(sql).includes("CREATE TABLE")) {
        initializationSql = String(sql);
        statements.push("INITIALIZE");
      } else {
        poolQueries.push({ sql: String(sql), params });
        statements.push("POOL_QUERY");
      }
      return { rows: [] };
    },
    async connect() { return client; },
  };
  const store = createPostgresDttAgentIdentityReceiptStore({ pool });
  const record = {
    schema_version: DTT_AGENT_IDENTITY_RECEIPT_VERSION,
    key_id: "dik_test",
    receipt_id: "dair_one",
    tenant_id: "tenant-a", work_id: TRUST_WORK, tree_id: "tree-a", node_id: "verify",
    evidence_digest: "evd_a", verifier_id: "agent-a", session_fingerprint: "session-a",
    session_id: presenceA.session_id,
    assignment_id: "assignment-test",
    actor_provenance: presenceA.actor_provenance,
    opaque_agent_id: presenceA.opaque_agent_id,
    presence_signature: presenceA.signature,
    client_type: presenceA.client_type,
    host_transport_session_fingerprint: presenceA.host_transport_session_fingerprint,
    decision: "approve", rationale: "ok", receipt: "signed", execution_authorized: false,
    issued_at_ms: Date.now(), expires_at_ms: Date.now() + 60_000,
  };
  assert.equal(await store.issueAtomic("f".repeat(64), Date.now() + 60_000, "dair_one", record), true);
  assert.equal(await store.issueAtomic(
    "f".repeat(64), Date.now() + 60_000, "dair_two", { ...record, receipt_id: "dair_two" },
  ), false);
  assert(statements.some((item) => item === "BEGIN"));
  assert(statements.some((item) => item === "COMMIT"));
  assert(statements.some((item) => item === "ROLLBACK"));
  assert.match(initializationSql, /CREATE TABLE IF NOT EXISTS dtt_agent_identity_contexts_v2/);
  assert.match(initializationSql, /CREATE TABLE IF NOT EXISTS dtt_agent_identity_receipts_v2/);
  assert.match(initializationSql, /work_id uuid NOT NULL/);
  assert.match(initializationSql, /UNIQUE \(tenant_id, work_id, tree_id, node_id, evidence_digest, verifier_id, session_fingerprint\)/);
  assert.match(initializationSql, /dtt_agent_identity_receipts_v2_work_scope_idx/);
  assert.doesNotMatch(initializationSql, /ALTER TABLE dtt_agent_identity_(?:contexts|receipts)\b/);
  assert.deepEqual(contextInsertParams.slice(1, 4), [DTT_AGENT_CONTEXT_VERSION, "tenant-a", TRUST_WORK]);
  assert.equal(receiptInsertParams[1], DTT_AGENT_IDENTITY_RECEIPT_VERSION);
  assert.equal(receiptInsertParams[4], TRUST_WORK);
  assert.equal(receiptInsertParams[20], false);
  assert.equal(await store.getReceipt({
    receipt_id: "dair_one",
    tenant_id: "tenant-a",
    work_id: TRUST_WORK,
    tree_id: "tree-a",
    node_id: "verify",
  }), null);
  assert.match(poolQueries.at(-1).sql, /receipt_id=\$1 AND tenant_id=\$2 AND work_id=\$3::uuid AND tree_id=\$4 AND node_id=\$5/);
  assert.match(poolQueries.at(-1).sql, /FROM dtt_agent_identity_receipts_v2/);
  assert.deepEqual(poolQueries.at(-1).params.slice(0, 5), [
    "dair_one", "tenant-a", TRUST_WORK, "tree-a", "verify",
  ]);
});

test("artifact registry resolves only the exact tenant-and-Work-bound server-computed tuple", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dtt-artifact-trust-"));
  const store = createFileDttVerificationTrustStore({ root });
  const artifact = store.registerArtifact({
    tenant_id: "tenant-a",
    work_id: TRUST_WORK,
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

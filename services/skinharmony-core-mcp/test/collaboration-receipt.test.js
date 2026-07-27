import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  collaborationCanonicalJson,
  collaborationDigest,
  collaborationReceiptContract,
  consumeCollaborationReceipt,
  createCollaborationActionBinding,
  createCollaborationReceiptVerifier,
} from "../src/collaboration-receipt.js";

const NOW = Date.parse("2026-07-22T20:00:00.000Z");

function authority(issuer) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const kid = `ed25519-sha256:${crypto.createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex")}`;
  const exported = publicKey.export({ format: "jwk" });
  const jwk = { alg: "EdDSA", crv: exported.crv, kid, kty: exported.kty, use: "sig", x: exported.x };
  return { issuer, privateKey, kid, jwk };
}

const core = authority("universal-core-staging");
const nyra = authority("nyra-staging");
const config = {
  resource: "https://mcp.example.test/mcp",
  collaborationReceiptAudience: "https://mcp.example.test/mcp",
  collaborationTargetService: "skinharmony-core-mcp-staging",
  collaborationTargetEnvironment: "staging",
  collaborationBuildCommit: "a".repeat(40),
};

test("canonical bootstrap is an explicitly receipted staging action", () => {
  assert(collaborationReceiptContract.action_types.includes("canonical.bootstrap"));
});
const identity = {
  tenantId: "tenant-a",
  subject: "oauth-subject-a",
  agentPresence: {
    agent_id: "codex-a",
    session_id: "session-a",
    session_fingerprint: "0123456789abcdef01234567",
    signature: "ags_0123456789abcdef0123456789abcdef",
  },
  governanceContext: {
    tool_name: "workspace_write_document",
    trace_id: "33333333-3333-4333-8333-333333333333",
    preflight_id: "preflight-1",
    task_contract_id: "contract-1",
    task_trace_id: "task-trace-1",
    coordination_lock: "mcp-staging-coordination",
    shared_memory_checksum: "b".repeat(64),
  },
};
const action = {
  action_type: "workspace.write_document",
  target: "SHARED_MEMORY/reports/run.md",
  payload_sha256: "c".repeat(64),
  expected_version: 4,
  lock_id: "11111111-1111-4111-8111-111111111111",
  fencing_token: 17,
  idempotency_key_sha256: "d".repeat(64),
};

function sign(claims, privateKey) {
  return {
    claims,
    signature: crypto.sign(null, Buffer.from(collaborationCanonicalJson(claims), "utf8"), privateKey).toString("base64url"),
  };
}

function bundle(overrides = {}) {
  const binding = overrides.binding || createCollaborationActionBinding(config, action, identity);
  const bindingDigest = collaborationDigest("mcp-collaboration-binding-v1", binding);
  const decision = overrides.decision || {
    schema_version: "mcp_collaboration_core_decision_v1",
    binding_digest: bindingDigest,
    allowed: true,
    decision: "authorized",
    mediation: "allow",
    confirmation_satisfied: true,
  };
  const issuedAt = new Date(overrides.issuedAt ?? NOW - 1_000).toISOString();
  const expiresAt = new Date(overrides.expiresAt ?? NOW + 19_000).toISOString();
  const jti = overrides.jti || "mcpcr_0123456789abcdef0123456789abcdef";
  const nyraClaims = {
    schema_version: "mcp_collaboration_nyra_attestation_v1",
    issuer: nyra.issuer,
    audience: config.collaborationReceiptAudience,
    kid: nyra.kid,
    role: "advisory_veto",
    decision: "no_objection",
    execution_allowed: false,
    binding_digest: bindingDigest,
    jti,
    issued_at: issuedAt,
    expires_at: expiresAt,
    nonce: "nyra_nonce_0123456789abcdef",
    ...(overrides.nyraClaims || {}),
  };
  const nyraEnvelope = sign(nyraClaims, overrides.nyraPrivateKey || nyra.privateKey);
  const coreClaims = {
    schema_version: "mcp_collaboration_core_grant_v1",
    issuer: core.issuer,
    audience: config.collaborationReceiptAudience,
    kid: core.kid,
    role: "final_authority",
    decision: "allow",
    execution_allowed: true,
    binding_digest: bindingDigest,
    core_decision_digest: collaborationDigest("mcp-collaboration-core-decision-v1", decision),
    nyra_attestation_digest: collaborationDigest("mcp-collaboration-nyra-envelope-v1", nyraEnvelope),
    jti,
    issued_at: issuedAt,
    expires_at: expiresAt,
    nonce: "core_nonce_0123456789abcdef",
    ...(overrides.coreClaims || {}),
  };
  return { binding, decision, core: sign(coreClaims, overrides.corePrivateKey || core.privateKey), nyra: nyraEnvelope };
}

function verifier(now = NOW) {
  return createCollaborationReceiptVerifier({
    coreJwk: core.jwk,
    coreKid: core.kid,
    nyraJwk: nyra.jwk,
    nyraKid: nyra.kid,
    coreIssuer: core.issuer,
    nyraIssuer: nyra.issuer,
    expectedTenantId: "tenant-a",
    expectedTargetService: config.collaborationTargetService,
    expectedTargetEnvironment: config.collaborationTargetEnvironment,
    expectedTargetCommit: config.collaborationBuildCommit,
    now: () => now,
  });
}

test("verifies independently signed Core and Nyra statements bound to one exact write", async () => {
  const evidence = await verifier().verify(bundle(), { config, action, identity });
  assert.equal(evidence.tenant_id, "tenant-a");
  assert.equal(evidence.authorities.length, 2);
  assert.notEqual(evidence.authorities[0].kid, evidence.authorities[1].kid);
  assert.match(evidence.receipt_digest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(evidence).includes("signature"), false);
});

test("rejects tampering of every high-risk action binding", async () => {
  for (const [field, value] of [
    ["tenant_id", "tenant-b"],
    ["agent_id", "codex-b"],
    ["trace_id", "44444444-4444-4444-8444-444444444444"],
    ["tool_name", "workspace_create_folder"],
    ["payload_sha256", "e".repeat(64)],
    ["expected_version", 5],
    ["lock_id", "22222222-2222-4222-8222-222222222222"],
    ["fencing_token", 18],
    ["idempotency_key_sha256", "f".repeat(64)],
    ["target_commit", "9".repeat(40)],
  ]) {
    const original = bundle();
    const tampered = { ...original, binding: { ...original.binding, [field]: value } };
    await assert.rejects(verifier().verify(tampered, { config, action, identity }), /collaboration_receipt_binding_mismatch/);
  }
  const original = bundle();
  await assert.rejects(verifier().verify({
    ...original,
    decision: { ...original.decision, mediation: "hard_block" },
  }, { config, action, identity }), /core_collaboration_claims_invalid|collaboration_receipt_core_decision_invalid/);
});

test("rejects a forged signature, cross-jti grant and expired receipt", async () => {
  const forged = bundle({ corePrivateKey: nyra.privateKey });
  await assert.rejects(verifier().verify(forged, { config, action, identity }), /core_collaboration_signature_invalid/);

  const crossJti = bundle({ coreClaims: { jti: "mcpcr_ffffffffffffffffffffffffffffffff" } });
  await assert.rejects(verifier().verify(crossJti, { config, action, identity }), /core_collaboration_claims_invalid/);

  const expired = bundle({ issuedAt: NOW - 25_000, expiresAt: NOW - 1 });
  await assert.rejects(verifier().verify(expired, { config, action, identity }), /nyra_collaboration_claims_invalid/);
});

test("requires distinct pinned Ed25519 trust anchors", () => {
  assert.throws(() => createCollaborationReceiptVerifier({
    coreJwk: core.jwk,
    coreKid: core.kid,
    nyraJwk: core.jwk,
    nyraKid: core.kid,
    expectedTenantId: "tenant-a",
    expectedTargetService: config.collaborationTargetService,
    expectedTargetEnvironment: config.collaborationTargetEnvironment,
    expectedTargetCommit: config.collaborationBuildCommit,
  }), /collaboration_receipt_independent_keys_required/);
});

test("pins the staging tenant, service, environment and build independently", async () => {
  const scoped = createCollaborationReceiptVerifier({
    coreJwk: core.jwk,
    coreKid: core.kid,
    nyraJwk: nyra.jwk,
    nyraKid: nyra.kid,
    coreIssuer: core.issuer,
    nyraIssuer: nyra.issuer,
    expectedTenantId: "codexai",
    expectedTargetService: config.collaborationTargetService,
    expectedTargetEnvironment: config.collaborationTargetEnvironment,
    expectedTargetCommit: config.collaborationBuildCommit,
    now: () => NOW,
  });
  await assert.rejects(scoped.verify(bundle(), { config, action, identity }), /collaboration_receipt_scope_mismatch/);
});

test("consumes both authorities with database time in one statement and fails closed on partial insert", async () => {
  const evidence = await verifier().verify(bundle(), { config, action, identity });
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 2, rows: [{ issuer: core.issuer }, { issuer: nyra.issuer }] };
    },
  };
  const audit = await consumeCollaborationReceipt(client, identity, evidence);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /mcp_collaboration_control\.consume_receipt_pair/);
  assert.doesNotMatch(calls[0].sql, /INSERT INTO/);
  assert.equal(JSON.stringify(calls).includes("signature"), false);
  assert.match(audit.jti_sha256, /^[a-f0-9]{64}$/);

  await assert.rejects(consumeCollaborationReceipt({
    query: async () => ({ rowCount: 1, rows: [{ issuer: core.issuer }] }),
  }, identity, evidence), /collaboration_receipt_expired_or_replayed/);
});

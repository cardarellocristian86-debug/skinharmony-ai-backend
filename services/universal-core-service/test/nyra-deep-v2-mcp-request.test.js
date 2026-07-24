import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createNyraDeepV2McpRequestVerifier,
  nyraDeepV2StableJson,
} from "../src/nyraDeepV2McpRequest.js";

const SECRET = "nyra-deep-v2-mcp-request-test-secret-0123456789";
const NOW = 1_780_000_000_000;
const TENANT = "codexai";
const REQUEST = "mcpv2_1234567890abcdef1234567890abcdef";
const RECORD_REF = "a".repeat(64);

function signedRequest({
  tenantId = TENANT,
  requestId = REQUEST,
  operation = "evaluate",
  branchId = "context_intelligence",
  subbranchId = "request_normalization",
  evidenceRefs = operation === "evaluate" ? [RECORD_REF] : [],
  evidencePackHash = operation === "prepare_evidence" ? "b".repeat(64) : undefined,
  issuedAt = new Date(NOW).toISOString(),
  nonce = "c".repeat(32),
} = {}) {
  const payload = {
    tenant_id: tenantId,
    request_id: requestId,
    operation,
    ...(["requirements", "prepare_evidence", "evaluate"].includes(operation) ? {
      branch_id: branchId,
      subbranch_id: subbranchId,
    } : {}),
    evidence_refs: evidenceRefs,
    ...(evidencePackHash ? { evidence_pack_hash: evidencePackHash } : {}),
    issued_at: issuedAt,
    nonce,
  };
  return {
    schema_version: "mcp_nyra_deep_branch_v2_request_attestation_v1",
    issuer: "skinharmony-core-mcp",
    ...payload,
    max_age_seconds: 60,
    signature: crypto
      .createHmac("sha256", SECRET)
      .update(`nyra-deep-branch-v2-request\u0000${nyraDeepV2StableJson(payload)}`)
      .digest("hex"),
  };
}

test("MCP request attestation binds tenant, branch, opaque evidence refs, and one-time nonce", () => {
  const verifier = createNyraDeepV2McpRequestVerifier({ secret: SECRET, now: () => NOW });
  const attestation = signedRequest();

  const accepted = verifier.verify({
    attestation,
    tenantId: TENANT,
    requestId: REQUEST,
    operation: "evaluate",
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.branch_id, "context_intelligence");
  assert.equal(accepted.subbranch_id, "request_normalization");
  assert.deepEqual(accepted.evidence_refs, [RECORD_REF]);

  const replay = verifier.verify({
    attestation,
    tenantId: TENANT,
    requestId: REQUEST,
    operation: "evaluate",
  });
  assert.deepEqual(replay, { ok: false, reason: "nyra_deep_v2_mcp_attestation_replayed" });
});

test("MCP request attestation rejects tampering, tenant confusion, and expired handoffs", () => {
  const verifier = createNyraDeepV2McpRequestVerifier({ secret: SECRET, now: () => NOW });
  const attestation = signedRequest({ nonce: "d".repeat(32) });

  const tampered = { ...attestation, branch_id: "research_evidence" };
  assert.deepEqual(verifier.verify({
    attestation: tampered,
    tenantId: TENANT,
    requestId: REQUEST,
    operation: "evaluate",
  }), { ok: false, reason: "nyra_deep_v2_mcp_attestation_signature_invalid" });

  assert.deepEqual(verifier.verify({
    attestation,
    tenantId: "another-tenant",
    requestId: REQUEST,
    operation: "evaluate",
  }), { ok: false, reason: "nyra_deep_v2_mcp_attestation_fields_invalid" });

  const expired = signedRequest({
    requestId: "mcpv2_expired_1234567890abcdef123456",
    issuedAt: new Date(NOW - 60_001).toISOString(),
    nonce: "e".repeat(32),
  });
  assert.deepEqual(verifier.verify({
    attestation: expired,
    tenantId: TENANT,
    requestId: expired.request_id,
    operation: "evaluate",
  }), { ok: false, reason: "nyra_deep_v2_mcp_attestation_expired" });
});


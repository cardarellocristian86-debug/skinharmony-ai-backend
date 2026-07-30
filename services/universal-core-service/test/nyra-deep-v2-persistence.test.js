import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNyraDeepV2EvidenceLedger } from "../src/nyraDeepV2EvidenceLedger.js";
import {
  createNyraDeepV2McpRequestVerifier,
  nyraDeepV2StableJson,
} from "../src/nyraDeepV2McpRequest.js";

const NOW = 1_780_000_000_000;
const TENANT = "codexai";
const REQUEST_ID = "mcpv2_persistent_1234567890abcdef";
const MCP_SECRET = "nyra-deep-v2-persistent-mcp-secret-0123456789";
const LEDGER_SECRET = "nyra-deep-v2-persistent-ledger-secret-012345";

function signedEvaluateRequest() {
  const payload = {
    tenant_id: TENANT,
    request_id: REQUEST_ID,
    operation: "evaluate",
    branch_id: "context_intelligence",
    subbranch_id: "request_normalization",
    evidence_refs: ["a".repeat(64)],
    issued_at: new Date(NOW).toISOString(),
    nonce: "b".repeat(32),
  };
  return {
    schema_version: "mcp_nyra_deep_branch_v2_request_attestation_v1",
    issuer: "skinharmony-core-mcp",
    ...payload,
    max_age_seconds: 60,
    signature: crypto
      .createHmac("sha256", MCP_SECRET)
      .update(`nyra-deep-branch-v2-request\u0000${nyraDeepV2StableJson(payload)}`)
      .digest("hex"),
  };
}

test("MCP replay consumption survives restart and stores no raw binding identifiers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-mcp-replay-"));
  const storagePath = path.join(root, "replay.json");
  const request = signedEvaluateRequest();
  const first = createNyraDeepV2McpRequestVerifier({
    secret: MCP_SECRET,
    now: () => NOW,
    storagePath,
  });
  assert.equal(first.status().restart_durable, true);
  assert.equal(first.verify({
    attestation: request,
    tenantId: TENANT,
    requestId: REQUEST_ID,
    operation: "evaluate",
  }).ok, true);

  const serialized = fs.readFileSync(storagePath, "utf8");
  assert.equal(serialized.includes(TENANT), false);
  assert.equal(serialized.includes(REQUEST_ID), false);
  assert.equal(serialized.includes(request.nonce), false);

  const restarted = createNyraDeepV2McpRequestVerifier({
    secret: MCP_SECRET,
    now: () => NOW,
    storagePath,
  });
  assert.deepEqual(restarted.verify({
    attestation: request,
    tenantId: TENANT,
    requestId: REQUEST_ID,
    operation: "evaluate",
  }), {
    ok: false,
    reason: "nyra_deep_v2_mcp_attestation_replayed",
  });
});

test("persistent evidence receipts survive restart and tampering fails closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-ledger-"));
  const storagePath = path.join(root, "ledger.json");
  const issuedAt = new Date(NOW - 1_000).toISOString();
  const expiresAt = new Date(NOW + 30_000).toISOString();
  const receiptInput = {
    tenantId: TENANT,
    requestId: "nyra-v2-ledger-persistent-request",
    branchId: "context_intelligence",
    subbranchId: "request_normalization",
    nodeId: "node_context_intelligence_request_normalization_l2",
    policyId: "policy_no_execution",
    effect: "deny_execution",
    decision: "ALLOW",
    preflightId: "preflight-persistent",
    corePolicyHash: "c".repeat(64),
    issuedAt,
    expiresAt,
    observedAt: NOW,
  };
  const first = createNyraDeepV2EvidenceLedger({
    secret: LEDGER_SECRET,
    now: () => NOW,
    storagePath,
  });
  const issued = first.issueCorePolicyDecisionReceipt(receiptInput);
  assert.equal(issued.ok, true);
  assert.equal(first.ledgerStats().restart_durable, true);

  const serialized = fs.readFileSync(storagePath, "utf8");
  assert.equal(serialized.includes(TENANT), false);
  assert.equal(serialized.includes(receiptInput.requestId), false);

  const restarted = createNyraDeepV2EvidenceLedger({
    secret: LEDGER_SECRET,
    now: () => NOW,
    storagePath,
  });
  assert.deepEqual(restarted.verifyCorePolicyDecisionReceipt({
    ...receiptInput,
    receipt: issued.decision_receipt,
    decisionId: issued.decision_id,
  }), { ok: true });

  const state = JSON.parse(serialized);
  state.records[0].policy_id = "tampered-policy";
  fs.writeFileSync(storagePath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  assert.throws(
    () => createNyraDeepV2EvidenceLedger({
      secret: LEDGER_SECRET,
      now: () => NOW,
      storagePath,
    }),
    /nyra_deep_v2_ledger_state_corrupt/,
  );
});

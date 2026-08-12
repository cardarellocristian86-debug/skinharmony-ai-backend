import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aiWorkQualityEvidenceBindingReference,
  buildAiWorkQualityObservation,
} from "../../shared/ai-work-quality-failure.js";
import { createUniversalCoreService } from "../src/app.js";

const GATEWAY_KEY = "ai-work-quality-gateway-key-01234567890123456789";
const TENANT_SECRET = "ai-work-quality-tenant-secret-01234567890123456789";
const TENANT = "tenant-quality";
const EVIDENCE_BINDING = aiWorkQualityEvidenceBindingReference({
  tenant_id: TENANT,
  work_id: "work-quality-1",
  attempt_id: null,
  observer_id: "verifier-quality-1",
  observer_session_id: "session-quality-1",
  expected_state_digest: `sha256:${"b".repeat(64)}`,
  observed_state_digest: `sha256:${"c".repeat(64)}`,
});
const RECEIPT = Object.freeze({
  artifact_id: "artifact-quality-1",
  content_digest: `sha256:${"a".repeat(64)}`,
  source_reference: "urn:test:quality-artifact-1",
  registry_reference: EVIDENCE_BINDING,
});

function tenantContext(tenantId) {
  const context = {
    version: "mcp_tenant_context_v1",
    tenant_id: tenantId,
    issued_at: new Date().toISOString(),
  };
  const assertion = `mtc_${crypto.createHmac("sha256", TENANT_SECRET)
    .update(`mcp-tenant-context\u0000${JSON.stringify(context)}`)
    .digest("hex")}`;
  return Buffer.from(JSON.stringify({ ...context, assertion })).toString("base64url");
}

function observation(overrides = {}) {
  const input = {
    observation_id: `obs-${crypto.randomUUID()}`,
    tenant_id: TENANT,
    work_id: "work-quality-1",
    observer_id: "verifier-quality-1",
    observer_session_id: "session-quality-1",
    code: "FALSE_COMPLETION_CLAIM",
    rollout_tier: "sandbox_active",
    summary: "Completion claim lacks independently verified post-conditions.",
    evidence: ["verification receipt attached"],
    evidence_receipts: [RECEIPT],
    expected_state_digest: `sha256:${"b".repeat(64)}`,
    observed_state_digest: `sha256:${"c".repeat(64)}`,
    created_at: "2026-08-03T12:00:00.000Z",
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "evidence_receipts")) {
    input.evidence_receipts = [{
      ...RECEIPT,
      registry_reference: aiWorkQualityEvidenceBindingReference(input),
    }];
  }
  return buildAiWorkQualityObservation(input);
}

function binding(overrides = {}) {
  return {
    transport_bound: true,
    active_lease_verified: true,
    gallery_work_id: "work-quality-1",
    agent_id: "verifier-quality-1",
    session_id: "session-quality-1",
    lease_id: "lease-quality-1",
    ...overrides,
  };
}

async function post(base, body, tenantId = TENANT) {
  const response = await fetch(`${base}/v1/work-quality/evaluate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${GATEWAY_KEY}`,
      "content-type": "application/json",
      "x-sh-tenant-id": tenantId,
      "x-sh-tenant-context": tenantContext(tenantId),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test("work-quality evaluation is gateway tenant-and-Work-bound and accepts only trusted evidence", async (t) => {
  const verificationCalls = [];
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `ai-work-quality-api-${Date.now()}-${Math.random()}`),
    mcpTenantGatewayKey: GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_SECRET,
    dttVerificationTrustStore: {
      kind: "injected_test",
      distributed: false,
      verifyArtifact: async (input) => {
        verificationCalls.push(input);
        return {
          verified: input.tenant_id === TENANT
            && input.work_id === "work-quality-1"
            && input.artifact_id === RECEIPT.artifact_id
            && input.content_digest === RECEIPT.content_digest
            && input.source_reference === RECEIPT.source_reference,
        };
      },
      verifyAssignment: async () => ({ verified: false }),
      assignVerifier: async () => { throw new Error("unused"); },
      listAssignments: async () => [],
      registerArtifact: async () => { throw new Error("unused"); },
    },
  });
  const server = http.createServer(service.app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const valid = await post(base, { observation: observation(), observer_binding: binding() });
  assert.equal(valid.status, 200, JSON.stringify(valid.json));
  assert.equal(valid.json.decision_contract.verdict, "BLOCK");
  assert.notEqual(valid.json.decision_contract.verdict, "ALLOW");
  assert.equal(valid.json.authorization.allowed, false);
  assert.equal(valid.json.authorization.execution_authorized, false);
  assert.equal(valid.json.guardrail.execution_allowed, false);
  assert.deepEqual(verificationCalls.at(-1), {
    tenant_id: TENANT,
    work_id: "work-quality-1",
    ...RECEIPT,
  });

  const inventedReceipt = { ...RECEIPT, content_digest: `sha256:${"d".repeat(64)}` };
  const invented = await post(base, {
    observation: observation({ evidence_receipts: [inventedReceipt] }),
    observer_binding: binding(),
  });
  assert.equal(invented.status, 403);
  assert.equal(invented.json.error, "ai_work_quality_evidence_receipt_invalid");

  const wrongTenant = await post(base, {
    observation: observation({ tenant_id: "tenant-other" }),
    observer_binding: binding(),
  });
  assert.equal(wrongTenant.status, 403);
  assert.equal(wrongTenant.json.error, "tenant_scope_violation");

  for (const observer_binding of [
    binding({ transport_bound: false }),
    binding({ active_lease_verified: false }),
    binding({ lease_id: "" }),
    binding({ gallery_work_id: "work-other" }),
  ]) {
    const denied = await post(base, { observation: observation(), observer_binding });
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error, "ai_work_quality_observer_binding_invalid");
  }
});

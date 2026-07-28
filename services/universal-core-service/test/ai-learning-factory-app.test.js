import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";
import { createAiLearningFactoryStore } from "../src/aiLearningFactoryStore.js";
import { createAiRuntimeTelemetryStore } from "../src/aiRuntimeTelemetry.js";

const GATEWAY_KEY = "ai-learning-gateway-key";
const SIGNING_SECRET = "ai-learning-tenant-context-secret-0123456789";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((output, key) => {
    if (value[key] !== undefined) output[key] = canonical(value[key]);
    return output;
  }, {});
}

function signedTenantContext(tenantId) {
  const context = {
    version: "mcp_tenant_context_v1",
    tenant_id: tenantId,
    issued_at: new Date().toISOString(),
  };
  return Buffer.from(JSON.stringify({
    ...context,
    assertion: `mtc_${crypto.createHmac("sha256", SIGNING_SECRET)
      .update(`mcp-tenant-context\u0000${JSON.stringify(context)}`)
      .digest("hex")}`,
  })).toString("base64url");
}

function signedOwnerContext(tenantId, purpose, body, key = GATEWAY_KEY) {
  const bindingPayload = { ...body };
  delete bindingPayload.owner_context;
  const context = {
    assertion_version: "owner_context_assertion_v1",
    audience: "nira_core_bridge",
    tenant_id: tenantId,
    access_mode: "god_mode",
    role: "owner_root",
    delegated_actor: "ai_learning_app_test",
    owner_verified: true,
    issued_at: new Date().toISOString(),
    binding_version: "owner_request_binding_v1",
    binding_hash: crypto.createHash("sha256")
      .update(`${purpose}\u0000${JSON.stringify(canonical(bindingPayload))}`)
      .digest("hex"),
  };
  const assertionPayload = JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
    issued_at: context.issued_at,
    binding_version: context.binding_version,
    binding_hash: context.binding_hash,
  });
  return {
    ...context,
    assertion: `ocs_${crypto.createHmac("sha256", key)
      .update(`owner-context\u0000${assertionPayload}`)
      .digest("hex")}`,
  };
}

function candidate() {
  return {
    candidate_id: "candidate-v016",
    candidate_version: "v1",
    candidate_type: "prompt",
    status: "under_review",
    dataset_version: "dataset-v1",
    scorecard_id: "scorecard-v016",
    evidence_digest: "evidence-v016",
    rollback_reference: "rollback-v016",
    proposal_summary: "Remain in shadow pending governed review.",
    risk_review_status: "passed",
    cost_review_status: "passed",
  };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("mounted Learning Factory derives tenant and Core proof server-side", async (t) => {
  const learningStore = createAiLearningFactoryStore({
    now: () => "2026-07-27T12:00:00.000Z",
  });
  await learningStore.recordLearningCandidate({
    tenant_id: "tenant-a",
    idempotency_key: "candidate-seed-a",
    expected_revision: 0,
    record: candidate(),
  });
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `ai-learning-app-${Date.now()}-${Math.random()}`),
    mcpTenantGatewayKey: GATEWAY_KEY,
    ownerContextSigningSecret: SIGNING_SECRET,
    aiLearningFactoryStore: learningStore,
    aiRuntimeTelemetryStore: createAiRuntimeTelemetryStore(),
    aiLearningFactoryMode: "shadow",
  });
  const { server, base } = await listen(service.app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const headers = {
    authorization: `Bearer ${GATEWAY_KEY}`,
    "content-type": "application/json",
    "x-sh-tenant-id": "tenant-a",
    "x-sh-tenant-context": signedTenantContext("tenant-a"),
  };
  const listed = await fetch(`${base}/v1/ai-learning/candidates?state=under_review`, { headers });
  assert.equal(listed.status, 200);
  const listedPayload = await listed.json();
  assert.equal(listedPayload.tenant_id, "tenant-a");
  assert.deepEqual(listedPayload.candidates.map((item) => item.candidate_id), ["candidate-v016"]);

  const deniedBody = {
    candidate_id: "candidate-v016",
    decision: "deferred",
    review_note: "Unsigned caller request.",
    expected_revision: 1,
    idempotency_key: "review-v016-denied",
    owner_confirmed: true,
    confirmation_reference: "owner-review-v016",
  };
  const denied = await fetch(`${base}/v1/ai-learning/candidates/review`, {
    method: "POST",
    headers,
    body: JSON.stringify(deniedBody),
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, "owner_confirmation_required");

  const allowedBody = {
    ...deniedBody,
    idempotency_key: "review-v016-allowed",
    review_note: "Measured evidence needs another independent review.",
  };
  allowedBody.owner_context = signedOwnerContext(
    "tenant-a",
    "ai_learning_candidate_review",
    allowedBody,
  );
  const allowed = await fetch(`${base}/v1/ai-learning/candidates/review`, {
    method: "POST",
    headers,
    body: JSON.stringify(allowedBody),
  });
  const allowedPayload = await allowed.json();
  assert.equal(allowed.status, 200, JSON.stringify(allowedPayload));
  assert.equal(allowedPayload.candidate.status, "deferred");
  assert.match(allowedPayload.candidate.human_review.audit_reference, /^audit:/);
  assert.match(allowedPayload.candidate.human_review.rollback_reference, /^revision:/);
  assert.equal(allowedPayload.candidate.live_mutation_authorized, false);

  const mismatchedHeaders = {
    ...headers,
    "x-sh-tenant-context": signedTenantContext("tenant-b"),
  };
  const crossTenant = await fetch(`${base}/v1/ai-learning/candidates`, {
    headers: mismatchedHeaders,
  });
  assert.equal(crossTenant.status, 403);
  assert.equal((await crossTenant.json()).error, "tenant_scope_denied");
});

test("off mode removes Learning Factory routes without affecting the service", async (t) => {
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `ai-learning-off-${Date.now()}-${Math.random()}`),
    mcpTenantGatewayKey: GATEWAY_KEY,
    ownerContextSigningSecret: SIGNING_SECRET,
    aiLearningFactoryMode: "off",
  });
  const { server, base } = await listen(service.app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${base}/v1/ai-learning/candidates`, {
    headers: {
      authorization: `Bearer ${GATEWAY_KEY}`,
      "x-sh-tenant-id": "tenant-a",
      "x-sh-tenant-context": signedTenantContext("tenant-a"),
    },
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "route_not_found");
});

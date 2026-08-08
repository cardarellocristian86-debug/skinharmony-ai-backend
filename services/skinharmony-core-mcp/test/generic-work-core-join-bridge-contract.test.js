import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";

const tenantGatewayKey = "test-tenant-gateway-key-0123456789abcdef";
const tenantContextSigningSecret = "test-tenant-context-signing-secret-0123456789";
const hash = (value) => value.repeat(64).slice(0, 64);

function verdict(overrides = {}) {
  return {
    schema_version: "generic_work_core_join_v1",
    verdict_id: `gwcj_${"a".repeat(40)}`,
    tenant_id: "tenant-a",
    work_id: "a9eed0d8-26ea-441a-a0f7-2640fb75261d",
    adapter: "research",
    acceptance_criteria_digest: hash("a"), task_state_digest: hash("b"), evidence_digest: hash("c"),
    independent_verifier_receipt_digest: hash("d"), idempotency_digest: hash("e"), verdict_digest: hash("f"),
    issued_at: "2026-08-08T00:00:00.000Z", authority: "universal_core",
    decision: "GENERIC_WORK_CORE_JOIN_ELIGIBLE", execution_authorized: false,
    host_action_authorized: false, signature: "valid-signature-material", ...overrides,
  };
}

test("generic Core Join bridge uses the canonical route and sanitizes caller scope", async () => {
  const calls = [];
  const handlers = createCoreHandlers({ universalCoreUrl: "https://core.test", tenantGatewayKey, tenantContextSigningSecret }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, verdict: verdict() }), { status: 201, headers: { "content-type": "application/json" } });
    },
  });
  const result = await handlers.generic_work_core_join_issue({
    tenant_id: "other", authenticated_tenant_id: "other", secret: "never-forward", signing_secret: "never-forward",
    work_id: "a9eed0d8-26ea-441a-a0f7-2640fb75261d", adapter: "research",
  }, { tenantId: "tenant-a" });
  assert.equal(new URL(calls[0].url).pathname, "/v1/work-continuity/generic-core-join");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${tenantGatewayKey}`);
  assert.equal(calls[0].init.headers["x-sh-tenant-id"], "tenant-a");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.tenant_id, undefined);
  assert.equal(body.authenticated_tenant_id, undefined);
  assert.equal(body.secret, undefined);
  assert.equal(body.signing_secret, undefined);
  assert.equal(result.structuredContent.ok, true);
  assert.deepEqual(result.structuredContent.generic_core_join_verdict, verdict());
});

test("generic Core Join bridge fails closed on malformed or tenant-mismatched verdicts", async () => {
  const handlers = createCoreHandlers({ universalCoreUrl: "https://core.test", tenantGatewayKey, tenantContextSigningSecret }, {
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, verdict: verdict({ tenant_id: "other" }) }), { status: 201, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(() => handlers.generic_work_core_join_issue({ work_id: "a9eed0d8-26ea-441a-a0f7-2640fb75261d", adapter: "research" }, { tenantId: "tenant-a" }), /generic_work_core_join_response_invalid/);
});

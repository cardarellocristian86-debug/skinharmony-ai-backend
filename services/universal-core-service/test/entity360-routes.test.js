import assert from "node:assert/strict";
import test from "node:test";
import { ENTITY_360_ROUTES, registerEntity360Routes } from "../src/entity360Routes.js";

function responseHarness() {
  return { statusCode: 0, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

function harness({ resolveAgentContext, invoke } = {}) {
  const routes = [];
  const app = { post(path, ...handlers) { routes.push({ path, handlers }); } };
  const auth = [];
  const runtime = { invoke: invoke || (async () => ({ execution_authorized: false })) };
  const registered = registerEntity360Routes({
    app,
    authFor(access) { auth.push(access); return (_req, _res, next) => next(); },
    runtime,
    resolveAgentContext: resolveAgentContext || (async () => ({ tenant_id: "tenant-a", agent_id: "agent-a",
      session_fingerprint: "session-a", actor_provenance: "verified", client_type: "codex" })),
  });
  return { routes, auth, registered };
}

test("routes expose only the bounded Entity 360 surface", () => {
  const { routes, auth, registered } = harness();
  assert.equal(routes.length, 12);
  assert.deepEqual(registered.routes, ENTITY_360_ROUTES.map(([method, path, capability, access]) => ({
    method: method.toUpperCase(), path, capability, access,
  })));
  assert.deepEqual([...new Set(auth)].sort(), ["configure", "read", "tenant_read", "write"]);
  assert.equal(routes.some((route) => /execute|authorize|merge|deploy|publish/u.test(route.path)), false);
});

test("tenant status is authenticated tenant-scoped, DTT-free, closed-input and redacted", async () => {
  let dttResolutionCalls = 0;
  const calls = [];
  const result = { schema_version: "entity_360_tenant_status_v1", mode: "ENFORCED",
    enabled: true, execution_authorized: false };
  const { routes } = harness({
    resolveAgentContext: async () => { dttResolutionCalls += 1; throw new Error("must_not_use_dtt"); },
    invoke: async (capability, identity, input) => {
      calls.push({ capability, identity, input });
      return result;
    },
  });
  const handler = routes.find((route) => route.path === "/v1/entity-360/tenant-status")
    .handlers.at(-1);
  const response = responseHarness();
  response.locals = { entity360TenantReadIdentity: {
    tenant_id: "tenant-a", actor_id: "core-tenant-reader:fingerprint",
    actor_role: "universal_core_tenant_reader", authority_scope: [],
    provenance: { session_fingerprint: "fingerprint",
      actor_provenance: "universal_core_platform_auth", client_type: "core_tenant_status_read" },
  } };
  await handler({ tenantId: "tenant-a", headers: {}, body: {} }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, result });
  assert.equal(dttResolutionCalls, 0);
  assert.equal(calls[0].capability, "entity_360_tenant_status_read");
  assert.equal(calls[0].identity.tenant_id, "tenant-a");
  assert.deepEqual(calls[0].input, {});

  const rejected = responseHarness();
  rejected.locals = response.locals;
  await handler({ tenantId: "tenant-a", headers: {}, body: { tenant_id: "tenant-a" } }, rejected);
  assert.equal(rejected.statusCode, 422);
  assert.equal(rejected.body.error.code, "entity360_tenant_status_input_invalid");
  assert.equal(calls.length, 1);
});

test("tenant status fails closed if runtime readback contains internal feature metadata", async () => {
  const { routes } = harness({ invoke: async () => ({
    schema_version: "entity_360_tenant_status_v1", mode: "SHADOW", enabled: true,
    execution_authorized: false, revision: 7,
  }) });
  const handler = routes.find((route) => route.path === "/v1/entity-360/tenant-status")
    .handlers.at(-1);
  const response = responseHarness();
  response.locals = { entity360TenantReadIdentity: {
    tenant_id: "tenant-a", actor_id: "core-tenant-reader:fingerprint",
    actor_role: "universal_core_tenant_reader", authority_scope: [],
    provenance: { session_fingerprint: "fingerprint",
      actor_provenance: "universal_core_platform_auth", client_type: "core_tenant_status_read" },
  } };
  await handler({ tenantId: "tenant-a", body: {} }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error.code, "entity360_tenant_status_readback_invalid");
});

test("first Work snapshot bootstrap remains a DTT-bound write route", async () => {
  const workId = "91e82640-9edc-5424-a3e8-eb7853b0d8dd";
  const calls = [];
  const gate = { schema_version: "entity_360_snapshot_bootstrap_gate_v1",
    authorized: true, authority: "universal_core",
    route: "entity_360_work_snapshot_bootstrap", tenant_id: "tenant-a",
    work_id: workId, context_only: true, execution_authorized: false,
    provider_execution: false, host_policy_override: false };
  const { routes } = harness({
    resolveAgentContext: async () => ({ tenant_id: "tenant-a", work_id: workId,
      agent_id: "agent-a", session_fingerprint: "session-a",
      actor_provenance: "verified", client_type: "codex" }),
    invoke: async (capability, identity, input) => {
      calls.push({ capability, identity, input });
      return { snapshot: { snapshot_version: 1 }, dedicated_core_gate: gate,
        execution_authorized: false };
    },
  });
  const handler = routes.find((route) =>
    route.path === "/v1/entity-360/snapshots/bootstrap").handlers.at(-1);
  const response = responseHarness();
  await handler({ tenantId: "tenant-a", headers: { "x-sh-dtt-agent-context": "signed-dtt" },
    body: { work_id: workId, as_of: "2026-08-25T10:00:00.000Z",
      expected_revision: 0, idempotency_key: "bootstrap-a",
      tenant_id: "forged", execution_authorized: true } }, response);
  assert.equal(response.statusCode, 201);
  assert.equal(calls[0].capability, "entity_360_work_snapshot_bootstrap");
  assert.equal(calls[0].identity.work_id, workId);
  assert.equal(Object.hasOwn(calls[0].input, "tenant_id"), false);
  assert.equal(Object.hasOwn(calls[0].input, "execution_authorized"), false);
  assert.deepEqual(response.body.result.dedicated_core_gate, gate);
});

test("feature configuration uses only the independently authenticated Core operator", async () => {
  let seenIdentity;
  let dttResolutionCalls = 0;
  const { routes } = harness({
    resolveAgentContext: async () => { dttResolutionCalls += 1; throw new Error("must_not_use_dtt"); },
    invoke: async (_capability, identity) => {
      seenIdentity = identity;
      return { execution_authorized: false };
    },
  });
  const handler = routes.find((route) => route.path === "/v1/entity-360/admin/feature-flag")
    .handlers.at(-1);
  const response = responseHarness();
  response.locals = { entity360OperatorIdentity: {
    tenant_id: "tenant-a",
    actor_id: "core-owner:operator-a",
    actor_role: "universal_core_operator",
    authority_scope: ["entity360:feature-flag:write"],
    provenance: { session_fingerprint: "owner-fingerprint-a",
      actor_provenance: "universal_core_platform_auth", client_type: "core_operator_owner_confirmed" },
  } };
  await handler({ tenantId: "tenant-a", headers: { "x-sh-dtt-agent-context": "signed-dtt" },
    body: { mode: "OFF", enabled: false, expected_revision: 0,
      owner_context: { caller: "untrusted" }, owner_confirmed: true,
      confirmation_reference: "owner-confirmation-a",
      idempotency_key: "feature-off" } }, response);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(seenIdentity.authority_scope, ["entity360:feature-flag:write"]);
  assert.equal(dttResolutionCalls, 0);
});

test("route tenant and actor come only from authenticated DTT context", async () => {
  let seenIdentity;
  let seenInput;
  const { routes } = harness({
    resolveAgentContext: async (token, tenantId) => {
      assert.equal(token, "signed-dtt");
      assert.equal(tenantId, "tenant-a");
      return { tenant_id: tenantId, agent_id: "receipt-agent", session_fingerprint: "session-proof",
        actor_provenance: "verified-receipt", client_type: "codex" };
    },
    invoke: async (_capability, identity, input) => {
      seenIdentity = identity; seenInput = input;
      return { execution_authorized: false, production_decision_mutation: false };
    },
  });
  const handler = routes.find((route) => route.path === "/v1/entity-360/snapshots/assemble").handlers.at(-1);
  const response = responseHarness();
  await handler({ tenantId: "tenant-a", headers: { "x-sh-dtt-agent-context": "signed-dtt" },
    body: { tenant_id: "tenant-forged", tenantId: "tenant-forged", authority: "caller",
      execution_authorized: true, entity_type: "work", identity: { work_id: "work-a" } } }, response);
  assert.equal(response.statusCode, 201);
  assert.equal(seenIdentity.tenant_id, "tenant-a");
  assert.equal(seenIdentity.actor_id, "receipt-agent");
  assert.equal(seenIdentity.provenance.session_fingerprint, "session-proof");
  assert.equal(Object.hasOwn(seenInput, "tenant_id"), false);
  assert.equal(Object.hasOwn(seenInput, "tenantId"), false);
  assert.equal(Object.hasOwn(seenInput, "authority"), false);
  assert.equal(Object.hasOwn(seenInput, "execution_authorized"), false);
});

test("routes fail closed without DTT identity and redact internal errors", async () => {
  const { routes } = harness({ resolveAgentContext: async () => { throw new Error("secret-internal-detail"); } });
  const handler = routes.find((route) => route.path === "/v1/entity-360/resolve").handlers.at(-1);
  const missing = responseHarness();
  await handler({ tenantId: "tenant-a", headers: {}, body: {} }, missing);
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.body.error.code, "entity360_dtt_agent_context_required");
  const invalid = responseHarness();
  await handler({ tenantId: "tenant-a", headers: { "x-sh-dtt-agent-context": "invalid" }, body: {} }, invalid);
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.body.error.code, "entity360_dtt_agent_context_invalid");
  assert.equal(invalid.body.error.message.includes("secret"), false);
});

test("enforcement receipt route returns only the bound Work receipt and identical 404s otherwise",
  async () => {
    const workId = "91e82640-9edc-5424-a3e8-eb7853b0d8dd";
    const receiptDigest = "a".repeat(64);
    const receipt = { schema_version: "entity_360_core_context_receipt_v2",
      tenant_id: "tenant-a", work_id: workId, receipt_digest: receiptDigest,
      execution_authorized: false };
    const calls = [];
    const { routes } = harness({
      resolveAgentContext: async () => ({ tenant_id: "tenant-a", work_id: workId,
        agent_id: "receipt-agent", session_fingerprint: "session-proof",
        actor_provenance: "verified-receipt", client_type: "codex" }),
      invoke: async (capability, identity, input) => {
        calls.push({ capability, identity, input });
        if (input.receipt_digest === receiptDigest) return receipt;
        const error = new Error("entity360_enforcement_context_receipt_not_found");
        error.code = "entity360_enforcement_context_receipt_not_found";
        error.status = 404;
        throw error;
      },
    });
    const handler = routes.find((route) =>
      route.path === "/v1/entity-360/enforcement-context/receipt").handlers.at(-1);
    const request = (digest) => ({ tenantId: "tenant-a",
      headers: { "x-sh-dtt-agent-context": "signed-dtt" },
      body: { work_id: workId, receipt_digest: digest } });

    const found = responseHarness();
    await handler(request(receiptDigest), found);
    assert.equal(found.statusCode, 200);
    assert.deepEqual(found.body, { ok: true, result: receipt });
    assert.equal(calls[0].capability,
      "entity_360_enforcement_context_receipt_read");
    assert.equal(calls[0].identity.work_id, workId);
    assert.equal(calls[0].input.work_id, workId);

    const failures = [];
    for (const digest of ["b".repeat(64), "c".repeat(64)]) {
      const response = responseHarness();
      await handler(request(digest), response);
      failures.push(response);
    }
    for (const response of failures) {
      assert.equal(response.statusCode, 404);
      assert.deepEqual(response.body, { ok: false, error: {
        code: "entity360_enforcement_context_receipt_not_found",
        message: "The tenant-scoped Entity 360 request was rejected.",
      } });
    }
    assert.deepEqual(failures[0].body, failures[1].body,
      "unknown and cross-Work digests must remain indistinguishable");
  });

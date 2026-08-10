import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";
import {
  DTT_WORK_CONTEXT_HEADER,
  verifyDttWorkContext,
} from "../../shared/dtt-work-context.js";

const TENANT = "tenant-a";
const WORK_ID = "11111111-1111-8111-8111-111111111111";
const LEASE_ID = "22222222-2222-4222-8222-222222222222";
const GATEWAY_KEY = "g".repeat(48);
const TENANT_SECRET = "t".repeat(48);
const OWNER_SECRET = "o".repeat(48);
const DTT_SECRET = "d".repeat(48);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stable(value[key]);
    return result;
  }, {});
}

function snapshot() {
  const value = {
    schema_version: "nyra_policy_registry_v1",
    tenant_id: TENANT,
    domain_pack_id: "generic",
    ancestry: [{
      pack_id: "core.policy",
      version: "1.0.0",
      digest: "a".repeat(64),
      scope: { kind: "core", value: "core", tenant_id: null },
    }],
    leaf_packs: [{ pack_id: "core.policy", version: "1.0.0", digest: "a".repeat(64) }],
    policy: {
      allow_actions: ["policy.snapshot.activate"],
      deny_actions: [],
      required_gates: ["owner_confirmation"],
      constraints: {},
    },
    bindings: {
      core_branch_ids: ["nyra_policy_registry"],
      nyra_branch_ids: ["risk_governance"],
      domain_pack_ids: ["generic"],
    },
    sources: [],
    validity: {
      valid_from: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
    resolution: {
      logical_depth: 1,
      traversal_budget: 256,
      traversed: 1,
      catalog_depth_policy: "no_static_ceiling",
      runtime_policy: "bounded_fail_closed",
    },
    immutable: true,
  };
  return {
    ...value,
    snapshot_digest: crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"),
  };
}

function presence() {
  return {
    transport_bound: true,
    agent_id: "agent-a",
    session_id: "session-a",
    session_fingerprint: "a".repeat(24),
    host_transport_session_fingerprint: "b".repeat(24),
    signature: `ags_${"c".repeat(32)}`,
    opaque_agent_id: `ai_${"d".repeat(24)}`,
    actor_provenance: `ap_${"e".repeat(32)}`,
    client_type: "codex",
  };
}

function identity() {
  return {
    kind: "oauth",
    tenantId: TENANT,
    subject: "oauth|owner-a",
    role: "tenant_owner",
    oauthOwnerElevated: true,
    ownerConfirmed: true,
    confirmationReference: "owner-confirmation-policy-0001",
    agentPresence: presence(),
  };
}

function preflight(kind, domainPackId = "generic") {
  return {
    schema_version: "skinharmony_work_preflight_v1",
    preflight_id: `preflight-policy-${kind}-0001`,
    mandatory: true,
    tenant_id: TENANT,
    operational_surface: "tenant_work_gallery",
    tenant_work_gallery: {
      schema_version: "tenant_work_gallery_v1",
      tenant_id: TENANT,
      available: true,
      state: "ready",
    },
    memory_first: { status: "recalled" },
    governance: { execution_allowed_by_preflight: false },
    security_governance: {
      schema_version: "nyra_core_security_gate_v1",
      always_on: true,
      fail_closed: true,
      core_verdict_required: true,
      source_instructions_are_data: true,
      cross_tenant_blocked: true,
    },
    request: { operation_type: `policy.snapshot.${kind}` },
    domain_pack: { id: domainPackId },
  };
}

function leaseBinding() {
  const agent = presence();
  return {
    schema_version: "dtt_work_lease_binding_v1",
    tenant_id: TENANT,
    work_id: WORK_ID,
    lease_id: LEASE_ID,
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    participant_expires_at: new Date(Date.now() + 120_000).toISOString(),
    session_id: agent.session_id,
    agent_id: agent.agent_id,
    client_type: agent.client_type,
    session_fingerprint: agent.session_fingerprint,
    host_transport_session_fingerprint: agent.host_transport_session_fingerprint,
    presence_signature: agent.signature,
    opaque_agent_id: agent.opaque_agent_id,
    actor_provenance: agent.actor_provenance,
    execution_authorized: false,
  };
}

function validCoreResponse(kind, operationId, preflightId) {
  const field = kind === "activate" ? "activation" : kind === "rollback" ? "rollback" : "reconciliation";
  const success = kind === "activate" ? "activated" : kind === "rollback" ? "rolled_back" : "reconciled";
  return {
    ok: true,
    tenant_id: TENANT,
    work_id: WORK_ID,
    [field]: {
      tenant_id: TENANT,
      work_id: WORK_ID,
      operation_id: operationId,
      preflight_id: preflightId,
      snapshot_digest: "f".repeat(64),
      [success]: true,
      idempotent_replay: false,
      proof_status: "consumed",
      execution_authorized: false,
      provider_execution_authorized: false,
      caller_authority: false,
      ...(kind === "activate" ? { intent_digest: "9".repeat(64) } : {}),
      ...(kind === "rollback" ? { activation_generation: 2 } : {}),
    },
    authorization: {
      allowed: true,
      state: "attention",
      scope: "policy_registry_snapshot_mutation",
      confirmation_satisfied: true,
      core_final_authority: true,
      caller_authority: false,
      provider_execution_authorized: false,
    },
  };
}

function args(kind = "activate") {
  const common = {
    work_id: WORK_ID,
    operation_id: `${kind}-operation-0001`,
    owner_confirmed: true,
    confirmation_reference: "caller-reference-is-not-authority",
    work_preflight: preflight(kind),
  };
  if (kind === "activate") return { ...common, domain_pack_id: "generic", snapshot: snapshot() };
  if (kind === "rollback") return { ...common, domain_pack_id: "generic", target_snapshot_digest: "8".repeat(64) };
  return common;
}

function fixture(fetchImpl, handlerOptions = {}) {
  let leaseCalls = 0;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.example.test",
    tenantGatewayKey: GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_SECRET,
    ownerContextSigningSecret: OWNER_SECRET,
    dttAgentIdentitySigningSecret: DTT_SECRET,
    universalCoreKeys: {},
    defaultTenantId: TENANT,
  }, {
    fetchImpl,
    ...handlerOptions,
    resolveDttWorkBinding: async () => {
      leaseCalls += 1;
      return leaseBinding();
    },
  });
  return { handlers, leaseCalls: () => leaseCalls };
}

test("Policy Registry bridge preserves only the dedicated domain and binds owner plus exact DTT Work", async () => {
  const calls = [];
  const { handlers } = fixture(async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(validCoreResponse(
      "activate",
      "activate-operation-0001",
      "preflight-policy-activate-0001",
    )), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await handlers.nyra_policy_registry_activate(args(), identity());
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, "/v1/nyra-policy-registry/activate");
  assert.deepEqual(Object.keys(calls[0].body).sort(), [
    "confirmation_reference", "domain_pack_id", "operation_id", "owner_confirmed",
    "owner_context", "snapshot", "tenant_id", "work_id", "work_preflight",
  ]);
  assert.equal(calls[0].body.tenant_id, TENANT);
  assert.equal(calls[0].body.domain_pack_id, "generic");
  assert.equal(calls[0].body.owner_context.owner_verified, true);
  assert.match(calls[0].body.owner_context.binding_hash, /^[a-f0-9]{64}$/);
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${GATEWAY_KEY}`);
  const verified = verifyDttWorkContext({
    token: calls[0].init.headers[DTT_WORK_CONTEXT_HEADER],
    secret: DTT_SECRET,
    expected_tenant_id: TENANT,
    expected_work_id: WORK_ID,
    method: "POST",
    path: "/v1/nyra-policy-registry/activate",
    body: calls[0].body,
  });
  assert.equal(verified.work_id, WORK_ID);
  assert.equal(result.structuredContent.activation.execution_authorized, false);
  assert.equal(result.structuredContent.dedicated_core_gate.provider_execution, false);
});

test("Policy Registry bridge denies forged caller authority, preflight, snapshot and lease before mutation fetch", async () => {
  let fetchCalls = 0;
  const built = fixture(async () => {
    fetchCalls += 1;
    throw new Error("must_not_fetch");
  });
  await assert.rejects(
    built.handlers.nyra_policy_registry_activate({ ...args(), owner_context: { owner_verified: true } }, identity()),
    /policy_registry_caller_fields_invalid/,
  );
  await assert.rejects(
    built.handlers.nyra_policy_registry_activate({ ...args(), owner_confirmed: false }, identity()),
    /owner_confirmation_required/,
  );
  await assert.rejects(
    built.handlers.nyra_policy_registry_activate({
      ...args(),
      work_preflight: { ...preflight("activate"), request: { operation_type: "policy.snapshot.rollback" } },
    }, identity()),
    /policy_registry_preflight_binding_invalid/,
  );
  const impure = snapshot();
  impure.core_receipt = { signature: "forged" };
  await assert.rejects(
    built.handlers.nyra_policy_registry_activate({ ...args(), snapshot: impure }, identity()),
    /policy_registry_snapshot_invalid|policy_registry_snapshot_not_pure/,
  );
  assert.equal(fetchCalls, 0);
  assert.equal(built.leaseCalls(), 0);

  const invalidLeaseHandlers = createCoreHandlers({
    universalCoreUrl: "https://core.example.test",
    tenantGatewayKey: GATEWAY_KEY,
    tenantContextSigningSecret: TENANT_SECRET,
    ownerContextSigningSecret: OWNER_SECRET,
    dttAgentIdentitySigningSecret: DTT_SECRET,
  }, {
    fetchImpl: async () => { fetchCalls += 1; throw new Error("must_not_fetch"); },
    resolveDttWorkBinding: async () => ({ ...leaseBinding(), work_id: "33333333-3333-4333-8333-333333333333" }),
  });
  await assert.rejects(
    invalidLeaseHandlers.nyra_policy_registry_activate(args(), identity()),
    /dtt_work_active_lease_required/,
  );
  assert.equal(fetchCalls, 0);
});

test("Policy Registry bridge projects safe fields and propagates bounded Core errors without leakage", async () => {
  const leaked = validCoreResponse("rollback", "rollback-operation-0001", "preflight-policy-rollback-0001");
  leaked.secret = "do-not-return";
  leaked.rollback.receipt = { signature: "do-not-return" };
  const { handlers } = fixture(async () => new Response(JSON.stringify(leaked), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  }));
  const result = await handlers.nyra_policy_registry_rollback(args("rollback"), identity());
  assert.equal(JSON.stringify(result).includes("do-not-return"), false);
  assert.equal(result.structuredContent.rollback.activation_generation, 2);

  const conflict = fixture(async () => new Response(JSON.stringify({
    ok: false,
    error: "policy_operation_idempotency_conflict",
  }), { status: 409, headers: { "content-type": "application/json" } }));
  await assert.rejects(
    conflict.handlers.nyra_policy_registry_reconcile(args("reconcile"), identity()),
    (error) => error.code === "policy_operation_idempotency_conflict" &&
      error.status === 409 && error.statusCode === 409,
  );

  const invalidType = fixture(async () => new Response("not-json", {
    status: 200,
    headers: { "content-type": "text/plain" },
  }));
  await assert.rejects(
    invalidType.handlers.nyra_policy_registry_reconcile(args("reconcile"), identity()),
    /policy_registry_core_content_type_invalid/,
  );

  const reflected = fixture(async () => new Response(JSON.stringify({
    ok: false,
    error: "secret_material_must_not_reflect",
  }), { status: 503, headers: { "content-type": "application/json" } }));
  await assert.rejects(
    reflected.handlers.nyra_policy_registry_reconcile(args("reconcile"), identity()),
    (error) => error.code === "core_request_failed" &&
      error.message === "core_request_failed:503:unknown" &&
      !error.message.includes("secret_material"),
  );
});

test("Policy Registry strict deadline covers a slow body and bounded chunk reader", async () => {
  let cancelled = false;
  const slow = fixture(async () => ({
    ok: true,
    status: 200,
    redirected: false,
    url: "https://core.example.test/v1/nyra-policy-registry/reconcile",
    headers: new Headers({ "content-type": "application/json" }),
    body: {
      getReader() {
        return {
          read: async () => new Promise(() => {}),
          cancel: async () => { cancelled = true; },
        };
      },
    },
  }), { policyRegistryCoreTimeoutMs: 20 });
  const started = Date.now();
  await assert.rejects(
    slow.handlers.nyra_policy_registry_reconcile(args("reconcile"), identity()),
    (error) => error.code === "policy_registry_core_timeout" && error.status === 504,
  );
  assert.equal(cancelled, true);
  assert(Date.now() - started < 500);

  const invalidLength = fixture(async () => new Response(JSON.stringify(
    validCoreResponse("reconcile", "reconcile-operation-0001", "preflight-policy-reconcile-0001"),
  ), {
    status: 200,
    headers: { "content-type": "application/json", "content-length": "not-a-number" },
  }));
  await assert.rejects(
    invalidLength.handlers.nyra_policy_registry_reconcile(args("reconcile"), identity()),
    /policy_registry_core_content_length_invalid/,
  );

  const oversizedChunk = fixture(async () => new Response(new Uint8Array(128 * 1024 + 1), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  await assert.rejects(
    oversizedChunk.handlers.nyra_policy_registry_reconcile(args("reconcile"), identity()),
    /policy_registry_core_response_too_large/,
  );
});

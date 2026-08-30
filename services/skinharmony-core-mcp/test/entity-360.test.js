import assert from "node:assert/strict";
import test from "node:test";

import { ENTITY_360_TOOLS, createEntity360Handlers } from "../src/entity-360.js";
import { createCoreHandlers } from "../src/core-handlers.js";
import { validateToolArguments } from "../src/schema-validation.js";
import {
  createDttAgentIdentityReceiptService,
  createInMemoryDttAgentIdentityReceiptStore,
  issueDttAgentContext,
} from "../../shared/dtt-agent-identity-receipts.js";

const EXPECTED = Object.freeze([
  "entity_360_resolve",
  "entity_360_snapshot_assemble",
  "entity_360_snapshot_latest",
  "entity_360_snapshot_read",
  "entity_360_snapshot_verify",
  "entity_360_shadow_compare",
  "entity_360_policy_read",
  "entity_360_metrics_read",
  "entity_360_shadow_enable",
  "entity_360_shadow_disable",
]);

const DTT_EXPECTED = Object.freeze(EXPECTED.filter((name) =>
  !["entity_360_shadow_enable", "entity_360_shadow_disable"].includes(name)));

const PATHS = Object.freeze([
  "/v1/entity-360/resolve",
  "/v1/entity-360/snapshots/assemble",
  "/v1/entity-360/snapshots/latest",
  "/v1/entity-360/snapshots/read",
  "/v1/entity-360/snapshots/verify",
  "/v1/entity-360/shadow/compare",
  "/v1/entity-360/policy",
  "/v1/entity-360/metrics",
]);

const ENTITY_ID = `e360_${"a".repeat(48)}`;
const WORK_ID = "91e82640-9edc-5424-a3e8-eb7853b0d8dd";
const DIGEST = "b".repeat(64);
const agentPresence = Object.freeze({
  agent_id: "entity-360-agent",
  session_id: "entity-360-session",
  session_fingerprint: "c".repeat(64),
  signature: "d".repeat(64),
  actor_provenance: "codex:test",
  client_type: "codex",
});

const boundAgentPresence = Object.freeze({
  ...agentPresence,
  host_transport_session_fingerprint: "e".repeat(64),
  signature: `ags_${"d".repeat(32)}`,
  opaque_agent_id: `ai_${"e".repeat(24)}`,
  actor_provenance: `ap_${"f".repeat(32)}`,
  transport_bound: true,
});

function toolNamed(name) {
  return ENTITY_360_TOOLS.find((item) => item.name === name);
}

test("Entity 360 MCP tools are strict, tenant-free context contracts", () => {
  assert.deepEqual(ENTITY_360_TOOLS.map((item) => item.name), EXPECTED);
  for (const item of ENTITY_360_TOOLS) {
    assert.equal(item.inputSchema.additionalProperties, false, item.name);
    assert.equal(item.annotations.destructiveHint, false, item.name);
    assert.equal(item.annotations.openWorldHint, false, item.name);
    assert.equal(Object.hasOwn(item.inputSchema.properties, "tenant_id"), false, item.name);
    assert.equal(Object.hasOwn(item.inputSchema.properties, "tenantId"), false, item.name);
    assert.equal(Object.hasOwn(item.inputSchema.properties, "tenant_scope"), false, item.name);
    assert.equal(item.scopes.length, 1, item.name);
    assert.match(item.scopes[0], /^core:(?:read|govern)$/);
  }

  assert.equal(toolNamed("entity_360_snapshot_assemble").annotations.readOnlyHint, false);
  assert.equal(toolNamed("entity_360_shadow_compare").annotations.readOnlyHint, false);
  for (const name of ["entity_360_shadow_enable", "entity_360_shadow_disable"]) {
    assert.equal(toolNamed(name).annotations.readOnlyHint, false, name);
    assert.equal(toolNamed(name)
      ._meta["skinharmony/ownerConfirmationRequired"], true, name);
    assert.equal(toolNamed(name)
      ._meta["skinharmony/dedicatedCoreGate"], true, name);
  }
  for (const name of EXPECTED.filter((item) => ![
    "entity_360_snapshot_assemble",
    "entity_360_shadow_compare",
    "entity_360_shadow_enable",
    "entity_360_shadow_disable",
  ].includes(item))) {
    assert.equal(toolNamed(name).annotations.readOnlyHint, true, name);
  }
});

test("Entity 360 schemas bind exact snapshot scope and reject caller tenant fields", () => {
  const resolveSchema = toolNamed("entity_360_resolve").inputSchema;
  assert.deepEqual(validateToolArguments(resolveSchema, {
    work_id: WORK_ID,
    entity_type: "work",
    identity: { work_id: WORK_ID },
  }), []);
  assert(validateToolArguments(resolveSchema, {
    work_id: WORK_ID,
    entity_type: "work",
    identity: { work_id: WORK_ID },
    tenant_id: "spoofed",
  }).some((item) => item.code === "additional_property"));

  const assembleSchema = toolNamed("entity_360_snapshot_assemble").inputSchema;
  const assembly = {
    work_id: WORK_ID,
    entity_type: "work",
    identity: { work_id: WORK_ID },
    as_of: "2026-08-25T12:00:00.000Z",
    expected_revision: 0,
    idempotency_key: "entity-360-assembly-a",
  };
  assert.deepEqual(validateToolArguments(assembleSchema, assembly), []);
  assert.deepEqual(validateToolArguments(assembleSchema, { ...assembly,
    project_work_linkage: { project_id: "project-a", work_id: WORK_ID,
      legacy_work_id: "legacy-a", component_id: "component-a" },
  }), []);
  assert(validateToolArguments(assembleSchema, { ...assembly,
    project_work_linkage: { change_id: "caller-change" },
  }).some((item) => item.code === "additional_property"));
  assert(validateToolArguments(assembleSchema, {
    ...assembly,
    source_contributions: [{ source_id: "caller-controlled" }],
  }).some((item) => item.code === "additional_property"));
  assert(validateToolArguments(assembleSchema, {
    ...assembly,
    architecture_state: { caller_controlled: true },
  }).some((item) => item.code === "additional_property"));

  const verifySchema = toolNamed("entity_360_snapshot_verify").inputSchema;
  assert.deepEqual(validateToolArguments(verifySchema, {
    work_id: WORK_ID,
    entity_id: ENTITY_ID,
    snapshot_version: 1,
    snapshot_digest: DIGEST,
  }), []);
  assert.deepEqual(validateToolArguments(verifySchema, {
    work_id: WORK_ID,
    entity_id: ENTITY_ID,
    snapshot_version: 1,
  }), []);
  assert(validateToolArguments(verifySchema, { snapshot_digest: DIGEST })
    .some((item) => item.code === "required"));

  const bitemporalReadSchema = toolNamed("entity_360_snapshot_read").inputSchema;
  assert.deepEqual(validateToolArguments(bitemporalReadSchema, {
    work_id: WORK_ID,
    entity_id: ENTITY_ID,
    snapshot_version: 1,
    query_mode: "VALID_AND_KNOWN_AT",
    valid_at: "2026-08-11T00:00:00.000Z",
    known_at: "2026-08-12T00:00:00.000Z",
  }), []);
  assert(validateToolArguments(bitemporalReadSchema, {
    work_id: WORK_ID, entity_id: ENTITY_ID, snapshot_version: 1,
    query_mode: "UNBOUNDED_HISTORY",
  }).some((item) => item.code === "enum"));

  const shadowSchema = toolNamed("entity_360_shadow_compare").inputSchema;
  assert.deepEqual(validateToolArguments(shadowSchema, {
    work_id: WORK_ID,
    entity_id: ENTITY_ID,
    snapshot_version: 1,
    snapshot_digest: DIGEST,
    legacy_context_digest: "e".repeat(64),
    legacy_outcome: "HOLD",
    idempotency_key: "entity-360-shadow-a",
  }), []);

  const disableSchema = toolNamed("entity_360_shadow_disable").inputSchema;
  assert.deepEqual(validateToolArguments(disableSchema, {
    expected_revision: 3,
    idempotency_key: "entity-360-shadow-disable-a",
  }), []);
  for (const forged of [
    { mode: "SHADOW" },
    { enabled: true },
    { tenant_id: "spoofed" },
  ]) {
    assert(validateToolArguments(disableSchema, {
      expected_revision: 3,
      idempotency_key: "entity-360-shadow-disable-a",
      ...forged,
    }).some((item) => item.code === "additional_property"));
  }
});

test("Entity 360 transport derives tenant and DTT context only from authenticated identity", async () => {
  const calls = [];
  const issued = [];
  const handlers = createEntity360Handlers({
    coreRequest: async (...args) => {
      calls.push(args);
      return { ok: true, route: args[0], execution_authorized: false };
    },
    issueAgentContext: (value) => {
      issued.push(value);
      return "signed-entity-360-context";
    },
  });

  assert.deepEqual(Object.keys(handlers), EXPECTED);
  const callerArgs = {
    tenant_id: "spoofed-a",
    tenantId: "spoofed-b",
    tenant_scope: "spoofed-c",
    tenantScope: "spoofed-d",
    work_id: WORK_ID,
    entity_id: ENTITY_ID,
  };
  for (const capabilityId of DTT_EXPECTED) {
    const result = await handlers[capabilityId](callerArgs, {
      tenantId: "tenant-authenticated",
      agentPresence,
    });
    assert.equal(result.structuredContent.execution_authorized, false);
  }

  assert.deepEqual(calls.map((call) => call[0]), PATHS);
  assert(calls.every((call) => call[1].work_id === WORK_ID));
  assert(calls.every((call) => call[2].tenantId === "tenant-authenticated"));
  assert(calls.every((call) => call[3].method === "POST"));
  assert(calls.every((call) => call[3].additionalHeaders["x-sh-dtt-agent-context"] ===
    "signed-entity-360-context"));
  for (const [, , , request] of calls) {
    assert.equal(request.body.tenant_id, undefined);
    assert.equal(request.body.tenantId, undefined);
    assert.equal(request.body.tenant_scope, undefined);
    assert.equal(request.body.tenantScope, undefined);
  }
  assert.equal(callerArgs.tenant_id, "spoofed-a", "bridge must not mutate caller input");
  assert.equal(issued.length, DTT_EXPECTED.length);
  assert(issued.every((value) => value.tenant_id === "tenant-authenticated" &&
    value.work_id === WORK_ID &&
    value.agent_presence === agentPresence));
});

test("Entity 360 assembly adapts the verified Core projection into Nyra context", async () => {
  const projectionDigest = "1".repeat(64);
  const snapshotDigest = "2".repeat(64);
  const handlers = createEntity360Handlers({
    issueAgentContext: () => "signed-entity-360-context",
    coreRequest: async () => ({
      ok: true,
      projection: {
        projection: {
          schema_version: "entity_360_projection_v1",
          projection: "work_360",
          tenant_scope: "tenant-authenticated",
          project_id: "nyra_conversational_runtime",
          work_id: WORK_ID,
          entity_id: ENTITY_ID,
          entity_type: "work",
          snapshot_version: 1,
          snapshot_digest: snapshotDigest,
          projection_digest: projectionDigest,
          authority: "universal_core",
          execution_authorized: false,
          production_decision_mutation: false,
        },
        cache: { state: "REBUILT", authoritative: false,
          execution_authorized: false },
      },
      persistence: { revision: 1, replayed: false },
      execution_authorized: false,
      production_decision_changed: false,
    }),
  });
  const result = await handlers.entity_360_snapshot_assemble({
    work_id: WORK_ID,
    entity_type: "work",
    identity: { work_id: WORK_ID },
    as_of: "2026-08-25T12:00:00.000Z",
    expected_revision: 0,
    idempotency_key: "entity-360-nyra-context-a",
  }, { tenantId: "tenant-authenticated", agentPresence });
  assert.equal(result.structuredContent.projection, undefined);
  const context = result.structuredContent.entity_360_nyra_context;
  assert.equal(context.schema_version, "entity_360_nyra_context_v1");
  assert.equal(context.state, "READY_CONTEXT_ONLY");
  assert.equal(context.projection_digest, projectionDigest);
  assert.equal(context.projection.snapshot_digest, snapshotDigest);
  assert.equal(context.projection.work_id, WORK_ID);
  assert.equal(context.context_authoritative, false);
  assert.equal(context.execution_authorized, false);
  assert.equal(context.production_decision_mutation, false);

  const malformed = createEntity360Handlers({
    issueAgentContext: () => "signed-entity-360-context",
    coreRequest: async () => ({
      projection: {
        projection: { schema_version: "entity_360_projection_v1",
          tenant_scope: "another-tenant", work_id: WORK_ID,
          entity_id: ENTITY_ID, snapshot_version: 1, snapshot_digest: snapshotDigest,
          projection_digest: projectionDigest, authority: "universal_core",
          execution_authorized: false, production_decision_mutation: false },
        cache: { state: "HIT", authoritative: false, execution_authorized: false },
      },
      execution_authorized: false,
    }),
  });
  await assert.rejects(() => malformed.entity_360_snapshot_assemble({
    work_id: WORK_ID, entity_type: "work", identity: { work_id: WORK_ID },
    as_of: "2026-08-25T12:00:00.000Z", expected_revision: 0,
    idempotency_key: "entity-360-nyra-context-b",
  }, { tenantId: "tenant-authenticated", agentPresence }),
  /entity360_nyra_projection_invalid/u);
});

test("Entity 360 SHADOW enable is a separate owner-confirmed Core transport", async () => {
  const calls = [];
  const handlers = createEntity360Handlers({
    coreRequest: async () => { throw new Error("dtt_transport_must_not_be_used"); },
    issueAgentContext: () => { throw new Error("dtt_context_must_not_be_issued"); },
    shadowEnableCoreRequest: async (args, identity) => {
      calls.push({ args, identity });
      return { ok: true, mode: "SHADOW", enabled: true,
        production_decision_changed: false, execution_authorized: false,
        dedicated_core_gate: { authorized: true, authority: "universal_core",
          route: "entity_360_shadow_enable", provider_execution: false,
          host_policy_override: false } };
    },
  });
  const identity = { tenantId: "tenant-authenticated", ownerConfirmed: true };
  const result = await handlers.entity_360_shadow_enable({
    expected_revision: 0,
    idempotency_key: "entity-360-shadow-enable-a",
    owner_confirmed: true,
    confirmation_reference: "owner-confirmation-a",
  }, identity);
  assert.equal(result.structuredContent.mode, "SHADOW");
  assert.equal(result.structuredContent.execution_authorized, false);
  assert.deepEqual(calls, [{
    args: {
      expected_revision: 0,
      idempotency_key: "entity-360-shadow-enable-a",
      owner_confirmed: true,
      confirmation_reference: "owner-confirmation-a",
    },
    identity,
  }]);
  await assert.rejects(() => handlers.entity_360_shadow_enable({
    expected_revision: 0,
    idempotency_key: "entity-360-shadow-enable-b",
    owner_confirmed: false,
  }, identity), /owner_confirmation_required/u);
});

test("Entity 360 SHADOW disable is a separate owner-confirmed Core transport", async () => {
  const calls = [];
  const handlers = createEntity360Handlers({
    coreRequest: async () => { throw new Error("dtt_transport_must_not_be_used"); },
    issueAgentContext: () => { throw new Error("dtt_context_must_not_be_issued"); },
    shadowDisableCoreRequest: async (args, identity) => {
      calls.push({ args, identity });
      return { ok: true, mode: "OFF", enabled: false,
        production_decision_changed: false, execution_authorized: false,
        dedicated_core_gate: { authorized: true, authority: "universal_core",
          route: "entity_360_shadow_disable", provider_execution: false,
          host_policy_override: false } };
    },
  });
  const identity = { tenantId: "tenant-authenticated", ownerConfirmed: true };
  const result = await handlers.entity_360_shadow_disable({
    expected_revision: 4,
    idempotency_key: "entity-360-shadow-disable-a",
    owner_confirmed: true,
    confirmation_reference: "owner-confirmation-a",
    mode: "SHADOW",
  }, identity);
  assert.equal(result.structuredContent.mode, "OFF");
  assert.equal(result.structuredContent.enabled, false);
  assert.deepEqual(calls, [{
    args: {
      expected_revision: 4,
      idempotency_key: "entity-360-shadow-disable-a",
      owner_confirmed: true,
      confirmation_reference: "owner-confirmation-a",
    },
    identity,
  }]);
  await assert.rejects(() => handlers.entity_360_shadow_disable({
    expected_revision: 4,
    idempotency_key: "entity-360-shadow-disable-b",
    owner_confirmed: true,
  }, { ...identity, ownerConfirmed: false }), /owner_confirmation_required/u);

  const forgedGateHandlers = createEntity360Handlers({
    coreRequest: async () => { throw new Error("dtt_transport_must_not_be_used"); },
    issueAgentContext: () => { throw new Error("dtt_context_must_not_be_issued"); },
    shadowDisableCoreRequest: async () => ({
      ok: true, mode: "OFF", enabled: false, execution_authorized: false,
      dedicated_core_gate: { authorized: true, authority: "universal_core",
        route: "entity_360_shadow_enable", provider_execution: false,
        host_policy_override: false },
    }),
  });
  await assert.rejects(() => forgedGateHandlers.entity_360_shadow_disable({
    expected_revision: 4,
    idempotency_key: "entity-360-shadow-disable-c",
    owner_confirmed: true,
  }, identity), /entity360_dedicated_core_gate_unverified/u);
});

test("real DTT issuer and verifier preserve the exact tenant, Work and principal binding", async () => {
  const secret = "entity-360-dtt-test-secret-".padEnd(64, "s");
  const verifier = createDttAgentIdentityReceiptService({
    secret,
    store: createInMemoryDttAgentIdentityReceiptStore(),
    now: () => Date.parse("2026-08-25T10:00:01.000Z"),
  });
  let verified;
  const handlers = createEntity360Handlers({
    issueAgentContext: ({ tenant_id, work_id, agent_presence }) => issueDttAgentContext({
      secret, tenant_id, work_id, agent_presence,
      now_ms: Date.parse("2026-08-25T10:00:00.000Z"),
      random_bytes: () => Buffer.alloc(18, 7),
    }),
    coreRequest: async (_path, _args, _identity, request) => {
      verified = verifier.verifyContext(
        request.additionalHeaders["x-sh-dtt-agent-context"],
        "tenant-a",
        WORK_ID,
        {
          agent_id: boundAgentPresence.agent_id,
          session_id: boundAgentPresence.session_id,
          session_fingerprint: boundAgentPresence.session_fingerprint,
          host_transport_session_fingerprint:
            boundAgentPresence.host_transport_session_fingerprint,
          presence_signature: boundAgentPresence.signature,
          opaque_agent_id: boundAgentPresence.opaque_agent_id,
          actor_provenance: boundAgentPresence.actor_provenance,
          client_type: boundAgentPresence.client_type,
        },
      );
      return { ok: true, execution_authorized: false };
    },
  });
  await handlers.entity_360_policy_read({ work_id: WORK_ID }, {
    tenantId: "tenant-a", agentPresence: boundAgentPresence,
  });
  assert.equal(verified.tenant_id, "tenant-a");
  assert.equal(verified.work_id, WORK_ID);
  assert.equal(verified.agent_id, boundAgentPresence.agent_id);
  assert.equal(verified.session_fingerprint, boundAgentPresence.session_fingerprint);
  assert.equal(verified.execution_authorized, false);
});

test("real Entity 360 MCP bridge preserves a bounded machine-readable Core rejection", async () => {
  const coreHandlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: {},
    tenantGatewayKey: "entity360-tenant-gateway-key-0000000001",
    tenantContextSigningSecret: "entity360-tenant-context-secret-000000001",
    dttAgentIdentitySigningSecret: "entity360-dtt-context-secret-000000000001",
  }, {
    resolveDttWorkBinding: async (identity, requestedWorkId) => ({
      schema_version: "dtt_work_lease_binding_v1",
      tenant_id: identity.tenantId,
      work_id: requestedWorkId,
      lease_id: "22222222-2222-4222-8222-222222222222",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      participant_expires_at: new Date(Date.now() + 300_000).toISOString(),
      session_id: identity.agentPresence.session_id,
      agent_id: identity.agentPresence.agent_id,
      client_type: identity.agentPresence.client_type,
      session_fingerprint: identity.agentPresence.session_fingerprint,
      host_transport_session_fingerprint:
        identity.agentPresence.host_transport_session_fingerprint,
      presence_signature: identity.agentPresence.signature,
      opaque_agent_id: identity.agentPresence.opaque_agent_id,
      actor_provenance: identity.agentPresence.actor_provenance,
      execution_authorized: false,
    }),
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      error: {
        code: "entity360_entity_resolution_ambiguous",
        message: "The tenant-scoped Entity 360 request was rejected.",
      },
    }), { status: 409, headers: { "content-type": "application/json" } }),
  });
  const handlers = createEntity360Handlers({
    coreRequest: coreHandlers.dttCoreRequest,
    issueAgentContext: () => "signed-entity360-agent-context",
  });
  await assert.rejects(() => handlers.entity_360_resolve({
    work_id: WORK_ID,
    entity_type: "work",
    identity: { work_id: WORK_ID },
  }, { tenantId: "tenant-a", agentPresence: boundAgentPresence }),
  (error) => error.code === "entity360_entity_resolution_ambiguous"
      && error.status === 409
      && error.message === "core_request_failed:409:entity360_entity_resolution_ambiguous");
});

test("Entity 360 bridge fails closed without tenant-bound agent presence or DTT identity", async () => {
  let requests = 0;
  const handlers = createEntity360Handlers({
    coreRequest: async () => { requests += 1; return { ok: true }; },
    issueAgentContext: () => "signed-context",
  });
  await assert.rejects(() => handlers.entity_360_policy_read({}, {}), /agent_presence_session_required/);
  await assert.rejects(() => handlers.entity_360_policy_read({}, {
    tenantId: "tenant-a",
  }), /agent_presence_session_required/);
  assert.equal(requests, 0);

  const unsignedHandlers = createEntity360Handlers({
    coreRequest: async () => { requests += 1; return { ok: true }; },
    issueAgentContext: () => "",
  });
  await assert.rejects(() => unsignedHandlers.entity_360_policy_read({}, {
    tenantId: "tenant-a",
    agentPresence,
  }), /entity360_dtt_work_id_required/);
  await assert.rejects(() => unsignedHandlers.entity_360_policy_read({ work_id: WORK_ID }, {
    tenantId: "tenant-a",
    agentPresence,
  }), /dtt_agent_identity_not_ready/);
  assert.equal(requests, 0);
  assert.throws(() => createEntity360Handlers({}), /entity 360 transport required/);
});

test("Entity 360 bridge rejects an upstream response that crosses the authority boundary", async () => {
  const handlers = createEntity360Handlers({
    coreRequest: async () => ({
      ok: true,
      result: { execution_authorized: true, authorization: { allowed: true } },
    }),
    issueAgentContext: () => "signed-context",
  });
  await assert.rejects(() => handlers.entity_360_snapshot_verify({
    work_id: WORK_ID,
    entity_id: ENTITY_ID,
    snapshot_version: 1,
  }, {
    tenantId: "tenant-a",
    agentPresence,
  }), /entity360_authority_boundary_violation/);
});

test("Entity 360 bridge recursively rejects authority hidden in a nested snapshot", async () => {
  const handlers = createEntity360Handlers({
    coreRequest: async () => ({
      ok: true,
      result: { snapshot: { current_state: {}, execution_authorized: true } },
    }),
    issueAgentContext: () => "signed-context",
  });
  await assert.rejects(() => handlers.entity_360_snapshot_read({
    work_id: WORK_ID,
    entity_id: ENTITY_ID,
    snapshot_version: 1,
  }, {
    tenantId: "tenant-a",
    agentPresence,
  }), /entity360_authority_boundary_violation/);
});

test("Entity 360 bridge rejects authority-shaped semantic poison in qualified context", async () => {
  const handlers = createEntity360Handlers({
    issueAgentContext: () => "dtt-context",
    coreRequest: async () => ({ snapshot: { current_state: {
      "work.acceptance_criteria": { nested: { allow: true, core_verdict: "ALLOW",
        authority: "universal_core" } },
    }, execution_authorized: false, authority: "universal_core" } }),
  });
  await assert.rejects(() => handlers.entity_360_snapshot_latest({
    work_id: WORK_ID, entity_id: ENTITY_ID,
  }, { tenantId: "tenant-a", agentPresence: { agent_id: "agent-a" } }),
  /entity360_authority_boundary_violation/u);
});

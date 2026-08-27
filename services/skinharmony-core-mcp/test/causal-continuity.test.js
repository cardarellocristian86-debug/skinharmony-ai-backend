import assert from "node:assert/strict";
import test from "node:test";
import { CAUSAL_CONTINUITY_ROUTES, CAUSAL_CONTINUITY_TOOLS, buildGalleryProjection, createCausalContinuityHandlers, verifyGalleryBinding } from "../src/causal-continuity.js";
import { validateToolArguments } from "../src/schema-validation.js";

const MINIMUM_CAPABILITIES = ["project_identity_resolve", "project_identity_create", "project_scope_read", "project_scope_bind", "project_state_snapshot", "project_state_verify", "genesis_intent_read", "genesis_intent_create", "intent_revision_propose", "intent_revision_approve", "intent_revision_impact", "project_decision_path_read", "work_bind_intent", "change_create", "change_read", "change_transition", "causal_context_issue", "causal_context_validate", "causal_obligation_create", "causal_obligation_read", "causal_obligation_transition", "causal_observation_record", "causal_reconcile", "causal_close", "causal_reopen", "continuity_capsule_build", "continuity_capsule_resume", "project_timeline_read", "gallery_binding_project", "gallery_projection_claim", "gallery_projection_complete", "gallery_projection_fail", "gallery_causal_view_read", "causal_metrics_snapshot", "gallery_binding_verify", "causal_rollout_read", "causal_rollout_set"];
const agentPresence = { agent_id: "agent-a", session_id: "session-a", session_fingerprint: "fingerprint-a", signature: "signature-a", opaque_agent_id: "opaque-a", actor_provenance: "actor-a", client_type: "codex" };
function binding(overrides = {}) { return { tenant_id: "tenant-a", project_id: "project-a", project_state_digest: "a".repeat(64), genesis_intent_id: "genesis-a", intent_revision_id: "revision-a", work_id: "work-a", change_id: "change-a", obligation_ids: ["obligation-a"], core_event_sequence: 42, context_digest: "b".repeat(64), ...overrides }; }

test("exports every minimum causal capability as a strict MCP tool", () => {
  assert.deepEqual(CAUSAL_CONTINUITY_TOOLS.map((item) => item.name), MINIMUM_CAPABILITIES);
  for (const item of CAUSAL_CONTINUITY_TOOLS) { assert.equal(item.inputSchema.type, "object"); assert.equal(item.inputSchema.additionalProperties, false); assert.equal(item.scopes.length, 1); assert.equal(item.annotations.destructiveHint, false); assert.equal(item.annotations.openWorldHint, false); }
});

test("handlers derive tenant exclusively from authenticated identity and return MCP content", async () => {
  const calls = [];
  const issued = [];
  const handlers = createCausalContinuityHandlers({ coreRequest: async (...args) => { calls.push(args); return { ok: true, project_id: "project-a" }; }, issueAgentContext: (input) => { issued.push(input); return "signed-agent-context"; } });
  assert.deepEqual(Object.keys(handlers), MINIMUM_CAPABILITIES);
  const result = await handlers.project_identity_resolve({ alias: "repo-a", tenant_id: "spoofed" }, { tenantId: "tenant-a", agentPresence });
  assert.equal(calls[0][0], "/v1/causal/projects/resolve?alias=repo-a"); assert.equal(calls[0][1], "tenant-a"); assert.deepEqual(calls[0][2], { method: "GET", additionalHeaders: { "x-sh-dtt-agent-context": "signed-agent-context" } });
  assert.deepEqual(issued[0], { tenant_id: "tenant-a", work_id: undefined, agent_presence: agentPresence });
  assert.deepEqual(result.structuredContent, { ok: true, project_id: "project-a" }); assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  await assert.rejects(() => handlers.project_identity_resolve({}, {}), /causal_tenant_identity_required/);
  await assert.rejects(() => handlers.project_identity_resolve({}, { tenantId: "tenant-a" }), /agent_presence_session_required/);
});

test("Work-scoped causal handlers bind the exact Work into the DTT issuer", async () => {
  const issued = [];
  const calls = [];
  const workId = "22222222-2222-4222-8222-222222222222";
  const handlers = createCausalContinuityHandlers({
    coreRequest: async (...args) => { calls.push(args); return { ok: true }; },
    issueAgentContext: (input) => { issued.push(input); return "signed-work-context"; },
  });
  await handlers.work_bind_intent({
    project_id: "11111111-1111-4111-8111-111111111111",
    work_id: workId,
    intent_revision_id: "33333333-3333-4333-8333-333333333333",
    idempotency_key: "bind-work-a",
  }, { tenantId: "tenant-a", agentPresence });
  assert.deepEqual(issued, [{ tenant_id: "tenant-a", work_id: workId, agent_presence: agentPresence }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].additionalHeaders["x-sh-dtt-agent-context"], "signed-work-context");
});

test("handler route map exactly covers Core routes and sends writes in the body", async () => {
  const calls = [];
  const handlers = createCausalContinuityHandlers({ coreRequest: async (...args) => { calls.push(args); return { ok: true }; }, issueAgentContext: () => "signed-agent-context" });
  assert.deepEqual(Object.keys(CAUSAL_CONTINUITY_ROUTES), MINIMUM_CAPABILITIES);
  await handlers.project_identity_create({ alias: "project-a", idempotency_key: "create-a" }, { tenantId: "tenant-a", agentPresence });
  assert.deepEqual(calls[0], ["/v1/causal/projects", "tenant-a", { method: "POST", body: { alias: "project-a", idempotency_key: "create-a" }, additionalHeaders: { "x-sh-dtt-agent-context": "signed-agent-context" } }]);
  await handlers.gallery_binding_verify({ ticket_id: "ticket-a" }, { tenantId: "tenant-a", agentPresence });
  assert.deepEqual(calls[1], ["/v1/causal/gallery/bindings/verify?ticket_id=ticket-a", "tenant-a", { method: "GET", additionalHeaders: { "x-sh-dtt-agent-context": "signed-agent-context" } }]);
  await handlers.gallery_projection_claim({ project_id: "project-a", limit: 5 }, { tenantId: "tenant-a", agentPresence });
  assert.deepEqual(calls[2], ["/v1/causal/gallery/projections/claim", "tenant-a", { method: "POST", body: { project_id: "project-a", limit: 5 }, additionalHeaders: { "x-sh-dtt-agent-context": "signed-agent-context" } }]);
  await handlers.gallery_causal_view_read({ project_id: "project-a", view: "evidence", limit: 10 }, { tenantId: "tenant-a", agentPresence });
  assert.deepEqual(calls[3], ["/v1/causal/gallery/views?project_id=project-a&view=evidence&limit=10", "tenant-a", { method: "GET", additionalHeaders: { "x-sh-dtt-agent-context": "signed-agent-context" } }]);
  await handlers.change_transition({ change_id: "change-a", target_state: "MODELED", reason: "Modeled", idempotency_key: "transition-a" }, { tenantId: "tenant-a", agentPresence });
  assert.deepEqual(calls[4], ["/v1/causal/changes/transition", "tenant-a", { method: "POST", body: { change_id: "change-a", target_state: "MODELED", reason: "Modeled", idempotency_key: "transition-a" }, additionalHeaders: { "x-sh-dtt-agent-context": "signed-agent-context" } }]);
});

test("Gallery verification blocks missing, mismatched, and cross-tenant bindings", () => {
  const valid = binding();
  assert.equal(verifyGalleryBinding(valid, valid).ok, true);
  const crossTenant = verifyGalleryBinding(binding({ tenant_id: "tenant-b" }), valid);
  assert.equal(crossTenant.status, "ORPHAN_GALLERY_ITEM"); assert.equal(crossTenant.action_authorization_allowed, false); assert(crossTenant.mismatches.some((item) => item.field === "tenant_id"));
  const missing = { ...valid }; delete missing.context_digest; assert(verifyGalleryBinding(missing, valid).missing.includes("context_digest"));
});

test("Gallery projection preserves causal binding and quarantines orphan events", () => {
  const authority = { event_id: "event-a", event_type: "CLOSURE_REOPENED", ...binding() };
  const valid = buildGalleryProjection({ payload: binding() }, authority);
  assert.equal(valid.entity_type, "REOPENING"); assert.equal(valid.status, "OPEN"); assert.equal(valid.action_authorization_allowed, true);
  const orphan = buildGalleryProjection({ payload: { project_id: "project-a" } }, { event_id: "event-b", event_type: "WORK_OPENED", ...binding({ core_event_sequence: 43 }) });
  assert.equal(orphan.status, "ORPHAN_GALLERY_ITEM"); assert.equal(orphan.action_authorization_allowed, false);
  const crossTenant = buildGalleryProjection({ payload: binding({ tenant_id: "tenant-b" }) }, authority);
  assert.equal(crossTenant.status, "ORPHAN_GALLERY_ITEM"); assert.equal(crossTenant.action_authorization_allowed, false);
  assert(crossTenant.binding_verification.mismatches.some((item) => item.field === "tenant_id"));
  const crossProject = buildGalleryProjection({ payload: binding({ project_id: "project-b" }) }, authority);
  assert.equal(crossProject.status, "ORPHAN_GALLERY_ITEM");
  const selfAttested = buildGalleryProjection({ payload: binding() });
  assert.equal(selfAttested.status, "ORPHAN_GALLERY_ITEM"); assert(selfAttested.binding_verification.authoritative_missing.includes("tenant_id"));
});

test("strict MCP schemas round-trip the actual Core runtime shapes", () => {
  const schema = (name) => CAUSAL_CONTINUITY_TOOLS.find((item) => item.name === name).inputSchema;
  const delegatedContext = {
    project_id: "11111111-1111-4111-8111-111111111111", project_state_digest: "a".repeat(64),
    work_id: "22222222-2222-4222-8222-222222222222", change_id: "33333333-3333-4333-8333-333333333333",
    obligation_ids: ["44444444-4444-4444-8444-444444444444"], environment: "staging",
    expires_at: "2026-08-09T12:05:00.000Z", lease_id: "lease-a", idempotency_key: "context-a",
    delegated_from: { parent_context_digest: "b".repeat(64), delegated_actor_id: "agent-b" },
    inherited_constraints: ["tenant_isolation"], authority_scope: ["causal:write"], risk_budget: { max_writes: 1 },
  };
  assert.deepEqual(validateToolArguments(schema("causal_context_issue"), delegatedContext), []);
  assert.deepEqual(validateToolArguments(schema("causal_context_validate"), { envelope: { schema_version: "causal_context_envelope_v1" }, signature: `hnc_${"c".repeat(64)}`, consume: true }), []);
  assert.deepEqual(validateToolArguments(schema("causal_context_validate"), { envelope: {}, signature: { key_id: "existing-test-signer", digest: "d".repeat(64) } }), []);
  const obligation = {
    change_id: "33333333-3333-4333-8333-333333333333", claim: "Verify outcome", assurance_level: "CAL-2",
    evidence_contract: { required_sources: ["postgres-readback"], minimum_independence: "INDEPENDENT_HUMAN", minimum_independent_observers: 1, freshness_seconds: 300, minimum_assurance_level: "CAL-2", horizons: [{ horizon: "immediate", due_at: "2026-08-09T12:05:00.000Z" }] },
    verification_horizons: [{ horizon: "delayed", due_at: "2026-08-10T12:00:00.000Z" }], rollback_plan: { mode: "feature-flag" }, idempotency_key: "obligation-a",
  };
  assert.deepEqual(validateToolArguments(schema("causal_obligation_create"), obligation), []);
  const executedChange = {
    change_id: "33333333-3333-4333-8333-333333333333",
    target_state: "EXECUTED",
    reason: "Execution observed",
    lease_id: "lease-a",
    context_digest: "c".repeat(64),
    execution_evidence_digest: "d".repeat(64),
    idempotency_key: "change-transition-a",
  };
  assert.deepEqual(validateToolArguments(schema("change_transition"), executedChange), []);
  assert(validateToolArguments(schema("change_transition"), {
    ...executedChange,
    execution_evidence_digest: undefined,
  }).some((item) => item.code === "any_of"));
  assert.deepEqual(validateToolArguments(schema("change_transition"), {
    change_id: executedChange.change_id,
    target_state: "MODELED",
    reason: "Model complete",
    idempotency_key: "change-modeled-a",
  }), []);
  assert.deepEqual(validateToolArguments(schema("causal_obligation_transition"), {
    obligation_id: "44444444-4444-4444-8444-444444444444",
    target_state: "EXECUTED",
    reason: "Action observed",
    lease_id: "lease-a",
    context_digest: "c".repeat(64),
    execution_evidence_digest: "d".repeat(64),
    idempotency_key: "obligation-transition-a",
  }), []);
  for (const value of ["EXECUTOR", "INDEPENDENT_SYSTEM", "INDEPENDENT_HUMAN", "FORMAL"]) {
    assert.deepEqual(validateToolArguments(schema("causal_observation_record"), { obligation_id: "44444444-4444-4444-8444-444444444444", source: "readback", independence: value, evidence_digest: "e".repeat(64), confidence: 1, idempotency_key: `observation-${value}` }), []);
  }
  const identityInjection = validateToolArguments(schema("causal_observation_record"), { obligation_id: "44444444-4444-4444-8444-444444444444", source: "readback", evidence_digest: "e".repeat(64), confidence: 1, idempotency_key: "observation", actor_id: "spoofed" });
  assert(identityInjection.some((item) => item.path.endsWith(".actor_id") && item.code === "additional_property"));
  assert.deepEqual(validateToolArguments(schema("causal_rollout_read"), { project_id: "11111111-1111-4111-8111-111111111111" }), []);
  assert.deepEqual(validateToolArguments(schema("causal_rollout_set"), { project_id: "11111111-1111-4111-8111-111111111111", mode: "ENFORCE_NEW_WORK", expected_version: 1, idempotency_key: "rollout-a" }), []);
  const galleryBinding = {
    project_id: "11111111-1111-4111-8111-111111111111", project_state_digest: "a".repeat(64),
    genesis_intent_id: "22222222-2222-4222-8222-222222222222", intent_revision_id: "33333333-3333-4333-8333-333333333333",
    work_id: "44444444-4444-4444-8444-444444444444", change_id: "55555555-5555-4555-8555-555555555555",
    obligation_ids: ["66666666-6666-4666-8666-666666666666"], entity_type: "EVIDENCE", ticket_id: "gallery-ticket-a",
    context_digest: "b".repeat(64), idempotency_key: "gallery-binding-a",
  };
  assert.deepEqual(validateToolArguments(schema("gallery_binding_project"), galleryBinding), []);
  assert.deepEqual(validateToolArguments(schema("gallery_projection_claim"), { project_id: galleryBinding.project_id, limit: 20, lease_seconds: 30 }), []);
  const readback = {
    tenant_id: "tenant-a", project_id: galleryBinding.project_id, project_state_digest: galleryBinding.project_state_digest,
    genesis_intent_id: galleryBinding.genesis_intent_id, intent_revision_id: galleryBinding.intent_revision_id,
    work_id: galleryBinding.work_id, change_id: galleryBinding.change_id, obligation_ids: galleryBinding.obligation_ids,
    entity_type: galleryBinding.entity_type, ticket_id: galleryBinding.ticket_id, core_event_sequence: 7,
    context_digest: galleryBinding.context_digest, binding_digest: "c".repeat(64), core_event_hash: "d".repeat(64),
  };
  assert.deepEqual(validateToolArguments(schema("gallery_projection_complete"), { outbox_id: "77777777-7777-4777-8777-777777777777", readback }), []);
  assert.deepEqual(validateToolArguments(schema("gallery_projection_fail"), { outbox_id: "77777777-7777-4777-8777-777777777777", error_code: "GALLERY_TEMPORARY_UNAVAILABLE", retry_after_seconds: 5 }), []);
  assert.deepEqual(validateToolArguments(schema("gallery_causal_view_read"), { project_id: galleryBinding.project_id, view: "closure", limit: 50, before_sequence: 100 }), []);
  assert.deepEqual(validateToolArguments(schema("causal_metrics_snapshot"), { project_id: galleryBinding.project_id }), []);
  assert(validateToolArguments(schema("gallery_projection_complete"), { outbox_id: "outbox-a", readback: { ...readback, tenantId: "spoofed" } }).some((item) => item.path.endsWith(".tenantId") && item.code === "additional_property"));
});

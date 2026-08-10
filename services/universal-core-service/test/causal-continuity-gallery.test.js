import assert from "node:assert/strict";
import test from "node:test";
import { causalDigest } from "../src/causalContinuityCanonical.js";
import { createCausalContinuityRuntime } from "../src/causalContinuityRuntime.js";
import { createInMemoryCausalContinuityStore } from "../src/causalContinuityStore.js";

const IDS = Object.freeze({
  project: "11111111-1111-4111-8111-111111111111",
  genesis: "22222222-2222-4222-8222-222222222222",
  revision: "33333333-3333-4333-8333-333333333333",
  work: "44444444-4444-4444-8444-444444444444",
  change: "55555555-5555-4555-8555-555555555555",
  obligation: "66666666-6666-4666-8666-666666666666",
});

const STATE_DIGEST = "a".repeat(64);
const CONTEXT_DIGEST = "b".repeat(64);
const ACTOR = Object.freeze({
  tenant_id: "tenant-a", actor_id: "gallery-worker-a", actor_role: "core_projection_worker",
  authority_scope: ["gallery:project"], provenance: { session_fingerprint: "session-a", client_type: "internal-worker" },
});

function mapKey(tenant, id) { return `${tenant}\u0000${id}`; }

function fixture() {
  let clock = new Date("2026-08-09T12:00:00.000Z");
  const now = () => new Date(clock);
  const store = createInMemoryCausalContinuityStore({ now });
  const runtime = createCausalContinuityRuntime({ store, now });
  const tenant = ACTOR.tenant_id;
  store.state.projects.set(mapKey(tenant, IDS.project), {
    tenant_id: tenant, project_id: IDS.project, active_state_digest: STATE_DIGEST,
    active_intent_revision_id: IDS.revision, status: "ACTIVE", version: 1,
  });
  store.state.works.set(mapKey(tenant, IDS.work), {
    tenant_id: tenant, project_id: IDS.project, work_id: IDS.work,
    genesis_intent_id: IDS.genesis, intent_revision_id: IDS.revision, legacy_binding_state: "VERIFIED",
  });
  store.state.changes.set(mapKey(tenant, IDS.change), {
    tenant_id: tenant, project_id: IDS.project, work_id: IDS.work, change_id: IDS.change,
    intent_revision_id: IDS.revision, state: "DRAFT",
  });
  store.state.obligations.set(mapKey(tenant, IDS.obligation), {
    tenant_id: tenant, project_id: IDS.project, work_id: IDS.work, change_id: IDS.change,
    obligation_id: IDS.obligation, intent_revision_id: IDS.revision, state: "OBSERVING",
  });
  store.state.contexts.set(mapKey(tenant, CONTEXT_DIGEST), {
    tenant_id: tenant, context_id: "77777777-7777-4777-8777-777777777777", context_digest: CONTEXT_DIGEST,
    project_id: IDS.project, work_id: IDS.work, change_id: IDS.change,
    issued_at: "2026-08-09T11:59:00.000Z", expires_at: "2026-08-09T12:30:00.000Z",
    envelope: {
      tenant_id: tenant, project_id: IDS.project, project_state_digest: STATE_DIGEST,
      genesis_intent_id: IDS.genesis, intent_revision_id: IDS.revision,
      work_id: IDS.work, change_id: IDS.change, obligation_ids: [IDS.obligation],
    },
  });
  return {
    store, runtime,
    setClock(value) { clock = new Date(value); },
    advance(seconds) { clock = new Date(clock.getTime() + seconds * 1000); },
  };
}

async function bind(runtime, suffix = "1", entityType = "CHANGE") {
  return runtime.gallery_binding_project(ACTOR, {
    idempotency_key: `gallery-binding-${suffix}`, project_id: IDS.project,
    project_state_digest: STATE_DIGEST, genesis_intent_id: IDS.genesis,
    intent_revision_id: IDS.revision, work_id: IDS.work, change_id: IDS.change,
    obligation_ids: [IDS.obligation], entity_type: entityType, ticket_id: `ticket-${suffix}`,
    context_digest: CONTEXT_DIGEST, provenance: { source: "core-authoritative-outbox" },
  });
}

function exactReadback(claimed, overrides = {}) {
  return {
    tenant_id: claimed.tenant_id, project_id: claimed.project_id,
    project_state_digest: claimed.project_state_digest, genesis_intent_id: claimed.genesis_intent_id,
    intent_revision_id: claimed.intent_revision_id, work_id: claimed.work_id,
    change_id: claimed.change_id, obligation_ids: claimed.obligation_ids,
    entity_type: claimed.entity_type, ticket_id: claimed.ticket_id,
    parent_ticket_id: claimed.parent_ticket_id, core_event_sequence: claimed.core_event_sequence,
    context_digest: claimed.context_digest, provenance: claimed.provenance,
    binding_digest: claimed.binding_digest, core_event_hash: claimed.event_hash,
    ...overrides,
  };
}

test("authoritative Gallery binding validates the complete causal identity", async () => {
  const f = fixture();
  const binding = await bind(f.runtime);
  assert.equal(binding.status, "PENDING");
  assert.equal(binding.project_id, IDS.project);
  assert.deepEqual(binding.obligation_ids, [IDS.obligation]);
  assert.equal(f.store.state.events.size, 1);
  assert.equal(f.store.state.outbox.size, 1);

  await assert.rejects(
    () => f.runtime.gallery_binding_project(ACTOR, {
      idempotency_key: "gallery-invalid-context", project_id: IDS.project,
      project_state_digest: STATE_DIGEST, genesis_intent_id: IDS.genesis,
      intent_revision_id: IDS.revision, work_id: IDS.work, change_id: IDS.change,
      obligation_ids: ["88888888-8888-4888-8888-888888888888"], entity_type: "CHANGE",
      ticket_id: "ticket-invalid", context_digest: CONTEXT_DIGEST,
    }),
    (error) => error.code === "CAUSAL_IDENTITY_MISMATCH",
  );
});

test("projection claim is race-safe and exact completion is idempotent without recursive outbox", async () => {
  const f = fixture();
  await bind(f.runtime);
  const [first, second] = await Promise.all([
    f.runtime.gallery_projection_claim(ACTOR, { project_id: IDS.project, limit: 1 }),
    f.runtime.gallery_projection_claim({ ...ACTOR, actor_id: "gallery-worker-b" }, { project_id: IDS.project, limit: 1 }),
  ]);
  assert.equal(first.length + second.length, 1);
  const claimed = first[0] || second[0];
  const claimingActor = first[0] ? ACTOR : { ...ACTOR, actor_id: "gallery-worker-b" };
  const eventsBefore = f.store.state.events.size;
  const outboxBefore = f.store.state.outbox.size;
  const readback = exactReadback(claimed);
  const completed = await f.runtime.gallery_projection_complete(claimingActor, { outbox_id: claimed.outbox_id, readback });
  assert.equal(completed.delivered, true);
  assert.equal(completed.binding.status, "ACTIVE");
  assert.equal(f.store.state.events.size, eventsBefore);
  assert.equal(f.store.state.outbox.size, outboxBefore);
  const replay = await f.runtime.gallery_projection_complete(claimingActor, { outbox_id: claimed.outbox_id, readback });
  assert.equal(replay.replayed, true);
  assert.equal((await f.runtime.gallery_binding_verify(ACTOR, { ticket_id: "ticket-1" })).status, "ACTIVE");
});

test("digest mismatch quarantines an orphan and exact tenant isolation blocks completion", async () => {
  const f = fixture();
  await bind(f.runtime);
  const [claimed] = await f.runtime.gallery_projection_claim(ACTOR, { project_id: IDS.project });
  await assert.rejects(
    () => f.runtime.gallery_projection_complete({ ...ACTOR, tenant_id: "tenant-b" }, { outbox_id: claimed.outbox_id, readback: exactReadback(claimed) }),
    (error) => error.code === "CAUSAL_IDENTITY_MISMATCH",
  );
  const mismatch = await f.runtime.gallery_projection_complete(ACTOR, {
    outbox_id: claimed.outbox_id, readback: exactReadback(claimed, { core_event_hash: "c".repeat(64) }),
  });
  assert.equal(mismatch.status, "ORPHAN_GALLERY_ITEM");
  await assert.rejects(
    () => f.runtime.gallery_binding_verify(ACTOR, { ticket_id: "ticket-1" }),
    (error) => error.code === "ORPHAN_GALLERY_ITEM",
  );
  assert.equal(f.store.state.events.size, 1);
  assert.equal(f.store.state.outbox.size, 1);
});

test("orphan projection is quarantined during claim and cannot loop forever", async () => {
  const f = fixture();
  await bind(f.runtime);
  f.store.state.gallery.clear();
  const claimed = await f.runtime.gallery_projection_claim(ACTOR, { project_id: IDS.project });
  assert.deepEqual(claimed, []);
  const [outbox] = [...f.store.state.outbox.values()];
  assert.equal(outbox.state, "QUARANTINED");
  assert.equal(outbox.last_error_code, "ORPHAN_GALLERY_ITEM");
  assert.equal(f.store.state.events.size, 1);
  assert.equal(f.store.state.outbox.size, 1);
});

test("post-activation tampering is quarantined and never returned by verify", async () => {
  const tamperCases = [
    ["binding digest", ({ binding }) => { binding.binding_digest = "c".repeat(64); }],
    ["event payload", ({ event }) => { event.payload.result.ticket_id = "forged-ticket"; }],
    ["event hash chain", ({ event }) => { event.previous_event_hash = "d".repeat(64); }],
    ["readback digest", ({ binding }) => { binding.last_readback_digest = "e".repeat(64); }],
    ["context binding", ({ context }) => { context.envelope.work_id = "88888888-8888-4888-8888-888888888888"; }],
  ];
  for (const [label, tamper] of tamperCases) {
    const f = fixture();
    await bind(f.runtime);
    const [claimed] = await f.runtime.gallery_projection_claim(ACTOR, { project_id: IDS.project });
    await f.runtime.gallery_projection_complete(ACTOR, { outbox_id: claimed.outbox_id, readback: exactReadback(claimed) });
    const binding = [...f.store.state.gallery.values()][0];
    const event = [...f.store.state.events.values()][0];
    const outbox = [...f.store.state.outbox.values()][0];
    const context = f.store.state.contexts.get(mapKey(ACTOR.tenant_id, CONTEXT_DIGEST));
    tamper({ binding, event, outbox, context });
    await assert.rejects(
      () => f.runtime.gallery_binding_verify(ACTOR, { ticket_id: "ticket-1" }),
      (error) => error.code === "GALLERY_INTEGRITY_MISMATCH",
      label,
    );
    assert.equal(binding.status, "QUARANTINED", label);
    assert.equal(outbox.state, "QUARANTINED", label);
  }
});

test("expired crash claim at max attempts is terminally quarantined", async () => {
  const f = fixture();
  await bind(f.runtime);
  const [claimed] = await f.runtime.gallery_projection_claim(ACTOR, { project_id: IDS.project, lease_seconds: 5 });
  const outbox = f.store.state.outbox.get(mapKey(ACTOR.tenant_id, claimed.outbox_id));
  outbox.max_attempts = 1;
  f.advance(6);
  const retry = await f.runtime.gallery_projection_claim({ ...ACTOR, actor_id: "recovery-worker" }, { project_id: IDS.project });
  assert.deepEqual(retry, []);
  assert.equal(outbox.attempts, 1);
  assert.equal(outbox.state, "QUARANTINED");
  assert.equal(outbox.last_error_code, "CLAIM_LEASE_EXPIRED");
});

test("bounded retry reaches quarantine without recursive events or outbox", async () => {
  const f = fixture();
  await bind(f.runtime);
  const eventCount = f.store.state.events.size;
  const outboxCount = f.store.state.outbox.size;
  let terminal;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const [claimed] = await f.runtime.gallery_projection_claim(ACTOR, { project_id: IDS.project, limit: 1 });
    assert(claimed);
    terminal = await f.runtime.gallery_projection_fail(ACTOR, { outbox_id: claimed.outbox_id, error_code: "GALLERY_TEMPORARY_UNAVAILABLE", retry_after_seconds: 1 });
    if (attempt < 5) {
      assert.equal(terminal.state, "RETRY_WAIT");
      f.advance(2);
    }
  }
  assert.equal(terminal.state, "QUARANTINED");
  assert.equal(f.store.state.events.size, eventCount);
  assert.equal(f.store.state.outbox.size, outboxCount);
});

test("Gallery causal views are bounded and metrics remain tenant/project scoped", async () => {
  const f = fixture();
  await bind(f.runtime, "1", "CHANGE");
  await bind(f.runtime, "2", "EVIDENCE");
  f.store.state.events.set(mapKey("tenant-b", "99999999-9999-4999-8999-999999999999"), {
    tenant_id: "tenant-b", project_id: IDS.project, event_id: "99999999-9999-4999-8999-999999999999", sequence_number: 999,
  });
  const evidence = await f.runtime.gallery_causal_view_read(ACTOR, { project_id: IDS.project, view: "evidence", limit: 1 });
  assert.equal(evidence.items.length, 1);
  assert.equal(evidence.items[0].entity_type, "EVIDENCE");
  const timeline = await f.runtime.gallery_causal_view_read(ACTOR, { project_id: IDS.project, view: "project_timeline", limit: 1 });
  assert.equal(timeline.items.length, 1);
  assert(Number.isSafeInteger(timeline.next_before_sequence));
  const metrics = await f.runtime.causal_metrics_snapshot(ACTOR, { project_id: IDS.project });
  assert.equal(metrics.metrics.ledger_events, 2);
  assert.equal(metrics.metrics.gallery_projection_pending, 2);
  assert.equal(metrics.metrics.works_with_lineage, 1);
  assert.equal(metrics.tenant_id, "tenant-a");
});

test("Gallery worker capabilities require explicit projection authority", async () => {
  const f = fixture();
  await assert.rejects(
    () => f.runtime.gallery_binding_project({ ...ACTOR, authority_scope: ["causal:write"] }, {
      idempotency_key: "unauthorized-binding", project_id: IDS.project, project_state_digest: STATE_DIGEST,
      genesis_intent_id: IDS.genesis, intent_revision_id: IDS.revision, work_id: IDS.work,
      change_id: IDS.change, obligation_ids: [IDS.obligation], entity_type: "CHANGE",
      ticket_id: "ticket-unauthorized", context_digest: CONTEXT_DIGEST,
    }),
    (error) => error.code === "AUTHORITY_SCOPE_VIOLATION",
  );
  await assert.rejects(
    () => f.runtime.gallery_projection_claim({ ...ACTOR, authority_scope: ["causal:read"] }, { project_id: IDS.project }),
    (error) => error.code === "AUTHORITY_SCOPE_VIOLATION",
  );
});

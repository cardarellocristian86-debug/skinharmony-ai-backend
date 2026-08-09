import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { causalDigest } from "../src/causalContinuityCanonical.js";
import { createCausalContinuityRuntime } from "../src/causalContinuityRuntime.js";
import { buildCausalEventHash, createInMemoryCausalContinuityStore, createPostgresCausalContinuityStore } from "../src/causalContinuityStore.js";
import { createHostNativeDomainSigner } from "../src/hostNativeGovernance.js";

const FIXED_NOW = new Date("2026-08-09T12:15:00.000Z");
const IDS = Object.freeze({
  project: "11111111-1111-4111-8111-111111111111",
  genesis: "22222222-2222-4222-8222-222222222222",
  revision: "33333333-3333-4333-8333-333333333333",
  work: "44444444-4444-4444-8444-444444444444",
  change: "55555555-5555-4555-8555-555555555555",
  obligation: "66666666-6666-4666-8666-666666666666",
});
const TENANT_ID = "benchmark-tenant";
const STATE_DIGEST = "a".repeat(64);
const SIGNING_SECRET = "causal-benchmark-domain-secret-2026-fixed";
const key = (tenant, id) => `${tenant}\u0000${id}`;

function stableUuid(label) {
  const bytes = crypto.createHash("sha256").update(label).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function seedBoundedAggregate(store, eventCount) {
  const { state } = store;
  state.projects.set(key(TENANT_ID, IDS.project), {
    tenant_id: TENANT_ID, project_id: IDS.project, canonical_name: "causal-benchmark",
    active_state_digest: STATE_DIGEST, active_intent_revision_id: IDS.revision,
    status: "ACTIVE", version: 1,
  });
  state.snapshots.set(key(TENANT_ID, "snapshot-current"), {
    tenant_id: TENANT_ID, project_id: IDS.project, snapshot_id: "snapshot-current",
    state_digest: STATE_DIGEST, canonical_state: { benchmark: true }, ledger_sequence: eventCount,
  });
  state.genesis.set(key(TENANT_ID, IDS.project), {
    tenant_id: TENANT_ID, project_id: IDS.project, genesis_intent_id: IDS.genesis,
    intent_text: "Deterministic benchmark intent", immutable: true,
  });
  state.revisions.set(key(TENANT_ID, IDS.revision), {
    tenant_id: TENANT_ID, project_id: IDS.project, intent_revision_id: IDS.revision,
    parent_revision_id: null, classification: "REFINEMENT", state: "APPROVED",
  });
  state.works.set(key(TENANT_ID, IDS.work), {
    tenant_id: TENANT_ID, project_id: IDS.project, work_id: IDS.work,
    genesis_intent_id: IDS.genesis, intent_revision_id: IDS.revision,
    base_state_digest: STATE_DIGEST, legacy_binding_state: "VERIFIED",
  });
  state.changes.set(key(TENANT_ID, IDS.change), {
    tenant_id: TENANT_ID, project_id: IDS.project, work_id: IDS.work, change_id: IDS.change,
    intent_revision_id: IDS.revision, base_state_digest: STATE_DIGEST, state: "EXECUTED",
  });
  state.obligations.set(key(TENANT_ID, IDS.obligation), {
    tenant_id: TENANT_ID, project_id: IDS.project, work_id: IDS.work, change_id: IDS.change,
    obligation_id: IDS.obligation, intent_revision_id: IDS.revision, state: "OBSERVING",
  });
  for (let index = 1; index <= 32; index += 1) {
    const resourceId = stableUuid(`resource:${index}`);
    state.scopes.set(key(TENANT_ID, resourceId), {
      tenant_id: TENANT_ID, project_id: IDS.project, resource_id: resourceId,
      resource_type: "benchmark_fixture", canonical_identifier: `fixture:${String(index).padStart(3, "0")}`,
      active: true,
    });
  }

  let previousEventHash = null;
  const generationStarted = performance.now();
  for (let sequence = 1; sequence <= eventCount; sequence += 1) {
    const event = {
      tenant_id: TENANT_ID,
      project_id: IDS.project,
      event_id: stableUuid(`event:${sequence}`),
      sequence_number: sequence,
      event_type: sequence % 10 === 0 ? "PROJECT_STATE_SNAPSHOTTED" : "EVIDENCE_RECORDED",
      operation: "deterministic_benchmark_seed",
      idempotency_key: `benchmark-event-${sequence}`,
      request_digest: causalDigest({ sequence, request: "benchmark" }),
      payload: { schema_version: "causal_event_payload_v1", result: { sequence, bounded: true } },
      actor_provenance: { actor_id: "benchmark-seeder", source: "deterministic_fixture" },
      previous_event_hash: previousEventHash,
      created_at: new Date(FIXED_NOW.getTime() - (eventCount - sequence) * 1000).toISOString(),
    };
    event.payload_digest = causalDigest(event.payload);
    event.event_hash = buildCausalEventHash(event);
    state.events.set(key(TENANT_ID, event.event_id), event);
    previousEventHash = event.event_hash;
  }
  return {
    generation_ms: performance.now() - generationStarted,
    ledger_head_hash: previousEventHash,
  };
}

function actor() {
  return {
    tenant_id: TENANT_ID,
    actor_id: "benchmark-agent",
    actor_role: "verification_benchmark",
    authority_scope: ["causal:read", "causal:write"],
    provenance: { session_fingerprint: "benchmark-session", actor_provenance: "benchmark-principal", client_type: "codex" },
  };
}

function deterministicEnvelope(actorContext, eventCount) {
  const envelope = {
    schema_version: "causal_context_envelope_v1",
    tenant_id: TENANT_ID,
    project_id: IDS.project,
    project_state_digest: STATE_DIGEST,
    genesis_intent_id: IDS.genesis,
    intent_revision_id: IDS.revision,
    work_id: IDS.work,
    change_id: IDS.change,
    obligation_ids: [IDS.obligation],
    gallery_ticket_ids: [],
    actor_id: actorContext.actor_id,
    actor_role: actorContext.actor_role,
    actor_provenance_digest: causalDigest(actorContext.provenance),
    delegated_from: null,
    environment: "staging",
    base_state_digest: STATE_DIGEST,
    authority_scope: actorContext.authority_scope,
    risk_budget: { max_validations: 10_000 },
    inherited_constraints: ["tenant_isolation"],
    issued_at: "2026-08-09T12:00:00.000Z",
    expires_at: "2026-08-09T13:00:00.000Z",
    single_use_nonce: "deterministic-benchmark-nonce",
    lease_id: "benchmark-lease",
    event_ledger_sequence: eventCount,
  };
  envelope.context_digest = causalDigest(envelope);
  return envelope;
}

async function probeProductionTimelineBound() {
  const calls = [];
  const rows = Array.from({ length: 200 }, (_, index) => ({
    tenant_id: TENANT_ID,
    project_id: IDS.project,
    sequence_number: 10_000 - index,
    event_hash: causalDigest({ sequence: 10_000 - index }),
  }));
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params: [...params] });
      return { rows: structuredClone(rows) };
    },
    async end() {},
  };
  const store = createPostgresCausalContinuityStore({ pool, now: () => new Date(FIXED_NOW) });
  const selected = await store.timeline({ tenant_id: TENANT_ID, project_id: IDS.project, limit: 200 });
  const query = calls.at(-1);
  const normalizedSql = query.sql.replace(/\s+/g, " ").trim();
  const contract = {
    query_count: calls.length,
    tenant_project_predicate: /WHERE tenant_id=\$1 AND project_id=\$2/.test(normalizedSql),
    cursor_predicate: /sequence_number<\$3/.test(normalizedSql),
    newest_first_before_reverse: /ORDER BY sequence_number DESC LIMIT \$4/.test(normalizedSql),
    requested_limit: query.params[3],
    returned_rows: selected.length,
    first_sequence_after_reverse: selected[0]?.sequence_number || null,
    last_sequence_after_reverse: selected.at(-1)?.sequence_number || null,
  };
  return {
    ...contract,
    application_full_history_materialized: contract.returned_rows > contract.requested_limit,
    verified: contract.query_count === 1 && contract.tenant_project_predicate && contract.cursor_predicate &&
      contract.newest_first_before_reverse && contract.requested_limit === 200 && contract.returned_rows === 200,
  };
}

export async function runCausalContinuityBenchmark({ eventCount = 10_000, validationIterations = 1_000 } = {}) {
  const boundedEventCount = Math.max(1_000, Math.min(Number(eventCount) || 10_000, 50_000));
  const boundedValidationIterations = Math.max(10, Math.min(Number(validationIterations) || 1_000, 10_000));
  const now = () => new Date(FIXED_NOW);
  const productionTimelineContract = await probeProductionTimelineBound();
  const store = createInMemoryCausalContinuityStore({ now });
  const seeded = seedBoundedAggregate(store, boundedEventCount);
  const signer = createHostNativeDomainSigner({ signingSecret: SIGNING_SECRET });
  const runtime = createCausalContinuityRuntime({ store, contextSigner: signer, now });
  const actorContext = actor();
  const envelope = deterministicEnvelope(actorContext, boundedEventCount);
  const signature = signer.sign(envelope, { purpose: "causal_context_envelope_v1" });
  store.state.contexts.set(key(TENANT_ID, envelope.context_digest), {
    tenant_id: TENANT_ID, project_id: IDS.project, work_id: IDS.work, change_id: IDS.change,
    context_id: stableUuid("benchmark-context"), context_digest: envelope.context_digest,
    envelope: { ...envelope, single_use_nonce: undefined, single_use_nonce_digest: causalDigest(envelope.single_use_nonce) },
    signature, issued_at: envelope.issued_at, expires_at: envelope.expires_at,
  });

  const timelineStarted = performance.now();
  const timeline = await store.timeline({ tenant_id: TENANT_ID, project_id: IDS.project, limit: 200 });
  const timelineMs = performance.now() - timelineStarted;

  const capsuleStarted = performance.now();
  const capsuleRow = await runtime.continuity_capsule_build(actorContext, {
    project_id: IDS.project, work_id: IDS.work, idempotency_key: "benchmark-capsule",
    next_safe_action: "continue bounded verification", forbidden_actions: ["full_history_chat_load"],
  });
  const capsuleMs = performance.now() - capsuleStarted;

  const resumeStarted = performance.now();
  const resumed = await runtime.continuity_capsule_resume(actorContext, { project_id: IDS.project, work_id: IDS.work });
  const resumeMs = performance.now() - resumeStarted;

  const validationStarted = performance.now();
  for (let index = 0; index < boundedValidationIterations; index += 1) {
    await runtime.causal_context_validate(actorContext, {
      envelope, signature, consume: false, expected_environment: "staging", required_authority: "causal:read",
    });
  }
  const validationMs = performance.now() - validationStarted;
  const deterministic = {
    schema_version: "causal_continuity_benchmark_fingerprint_v1",
    event_count: boundedEventCount,
    ledger_head_hash: seeded.ledger_head_hash,
    timeline_selected: timeline.length,
    timeline_first_sequence: timeline[0]?.sequence_number || null,
    timeline_last_sequence: timeline.at(-1)?.sequence_number || null,
    capsule_digest: capsuleRow.capsule.capsule_digest,
    resume_status: resumed.status,
    context_digest: envelope.context_digest,
    validation_iterations: boundedValidationIterations,
  };
  const report = {
    schema_version: "causal_continuity_benchmark_v1",
    fixture: { event_count: boundedEventCount, scope_resources: 32, validation_iterations: boundedValidationIterations },
    bounds: {
      timeline_limit: 200,
      timeline_selected: timeline.length,
      in_memory_fixture_scans_map_before_slice: true,
      production_timeline_query: productionTimelineContract,
      capsule_decision_path_count: resumed.capsule.decision_path.length,
      capsule_open_change_count: resumed.capsule.open_changes.length,
      capsule_open_obligation_count: resumed.capsule.open_obligations.length,
    },
    deterministic: { ...deterministic, fingerprint: causalDigest(deterministic) },
    timings_ms: {
      ledger_generation: Number(seeded.generation_ms.toFixed(3)),
      bounded_timeline_read: Number(timelineMs.toFixed(3)),
      capsule_build: Number(capsuleMs.toFixed(3)),
      capsule_resume: Number(resumeMs.toFixed(3)),
      context_validation_total: Number(validationMs.toFixed(3)),
      context_validation_mean: Number((validationMs / boundedValidationIterations).toFixed(6)),
    },
  };
  report.gates = {
    deterministic_reconstruction: report.deterministic.resume_status === "RESUMED",
    bounded_history: report.bounds.timeline_selected === Math.min(200, boundedEventCount) &&
      report.bounds.production_timeline_query.verified === true &&
      report.bounds.production_timeline_query.application_full_history_materialized === false,
    context_validation_lightweight: report.timings_ms.context_validation_mean < 5,
    ledger_generation_bounded: report.timings_ms.ledger_generation < 5_000,
    resume_bounded: report.timings_ms.capsule_resume < 500,
  };
  report.ok = Object.values(report.gates).every(Boolean);
  return report;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.log(JSON.stringify(await runCausalContinuityBenchmark(), null, 2));
}

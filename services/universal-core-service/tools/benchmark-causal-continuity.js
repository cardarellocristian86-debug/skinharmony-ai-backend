import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { causalDigest } from "../src/causalContinuityCanonical.js";
import { createCausalContinuityRuntime } from "../src/causalContinuityRuntime.js";
import { buildCausalEventHash, createInMemoryCausalContinuityStore, createPostgresCausalContinuityStore } from "../src/causalContinuityStore.js";
import { createHostNativeDomainSigner } from "../src/hostNativeGovernance.js";
import { createWorkContinuityRuntime } from "../src/workContinuityRuntime.js";

export const CAUSAL_BENCHMARK_CONTRACT = Object.freeze({
  schema_version: "causal_continuity_benchmark_contract_v2",
  fixed_seed: "nyra-causal-continuity-benchmark-seed-v1",
  projects: 100,
  works: 1_000,
  changes: 10_000,
  obligations: 10_000,
  ledger_events: 100_000,
  events_per_project: 1_000,
  resume_history_limit: 200,
  validation_samples: 1_000,
  append_samples: 64,
  thresholds: Object.freeze({
    context_validation_p95_ms: 25,
    capsule_resume_p95_ms: 250,
    rss_delta_mib: 64,
    legacy_append_regression_percent: 15,
  }),
});

const FIXED_NOW = new Date("2026-08-09T12:15:00.000Z");
const TENANT_ID = "benchmark-tenant";
const STATE_DIGEST = "a".repeat(64);
const SIGNING_SECRET = "causal-benchmark-domain-secret-2026-fixed";
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENCHMARK_FILE = fileURLToPath(import.meta.url);
const execFileAsync = promisify(execFile);
const key = (tenant, id) => `${tenant}\u0000${id}`;

function stableUuid(label) {
  const bytes = crypto.createHash("sha256").update(`${CAUSAL_BENCHMARK_CONTRACT.fixed_seed}:${label}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function percentile(samples, fraction) {
  if (!samples.length) return 0;
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
}

function timingSummary(samples) {
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    samples: samples.length,
    mean_ms: Number((total / Math.max(1, samples.length)).toFixed(6)),
    p95_ms: Number(percentile(samples, 0.95).toFixed(6)),
    max_ms: Number(Math.max(0, ...samples).toFixed(6)),
  };
}

function idsFor(projectIndex, workIndex = 0, changeIndex = 0) {
  const prefix = `project:${projectIndex}`;
  return {
    project: stableUuid(prefix),
    genesis: stableUuid(`${prefix}:genesis`),
    revision: stableUuid(`${prefix}:revision`),
    snapshot: stableUuid(`${prefix}:snapshot`),
    work: stableUuid(`${prefix}:work:${workIndex}`),
    change: stableUuid(`${prefix}:work:${workIndex}:change:${changeIndex}`),
    obligation: stableUuid(`${prefix}:work:${workIndex}:change:${changeIndex}:obligation`),
  };
}

function seedProjectAggregate(store, projectIndex) {
  const { state } = store;
  const primary = idsFor(projectIndex);
  state.projects.set(key(TENANT_ID, primary.project), {
    tenant_id: TENANT_ID, project_id: primary.project, canonical_name: `causal-benchmark-${projectIndex}`,
    active_state_digest: STATE_DIGEST, active_intent_revision_id: primary.revision,
    status: "ACTIVE", version: 1,
  });
  state.snapshots.set(key(TENANT_ID, primary.snapshot), {
    tenant_id: TENANT_ID, project_id: primary.project, snapshot_id: primary.snapshot,
    state_digest: STATE_DIGEST, canonical_state: { benchmark_project: projectIndex },
    ledger_sequence: CAUSAL_BENCHMARK_CONTRACT.events_per_project,
  });
  state.genesis.set(key(TENANT_ID, primary.project), {
    tenant_id: TENANT_ID, project_id: primary.project, genesis_intent_id: primary.genesis,
    intent_text: "Deterministic benchmark intent", immutable: true,
  });
  state.revisions.set(key(TENANT_ID, primary.revision), {
    tenant_id: TENANT_ID, project_id: primary.project, intent_revision_id: primary.revision,
    parent_revision_id: null, classification: "REFINEMENT", state: "APPROVED",
  });
  state.scopes.set(key(TENANT_ID, stableUuid(`project:${projectIndex}:scope`)), {
    tenant_id: TENANT_ID, project_id: primary.project,
    resource_id: stableUuid(`project:${projectIndex}:scope`), resource_type: "benchmark_fixture",
    canonical_identifier: `fixture:project:${projectIndex}`, active: true,
  });

  for (let workIndex = 0; workIndex < 10; workIndex += 1) {
    const workIds = idsFor(projectIndex, workIndex);
    state.works.set(key(TENANT_ID, workIds.work), {
      tenant_id: TENANT_ID, project_id: primary.project, work_id: workIds.work,
      genesis_intent_id: primary.genesis, intent_revision_id: primary.revision,
      base_state_digest: STATE_DIGEST, legacy_binding_state: "VERIFIED",
    });
    for (let changeIndex = 0; changeIndex < 10; changeIndex += 1) {
      const changeIds = idsFor(projectIndex, workIndex, changeIndex);
      state.changes.set(key(TENANT_ID, changeIds.change), {
        tenant_id: TENANT_ID, project_id: primary.project, work_id: workIds.work,
        change_id: changeIds.change, intent_revision_id: primary.revision,
        base_state_digest: STATE_DIGEST, state: "EXECUTED",
      });
      state.obligations.set(key(TENANT_ID, changeIds.obligation), {
        tenant_id: TENANT_ID, project_id: primary.project, work_id: workIds.work,
        change_id: changeIds.change, obligation_id: changeIds.obligation,
        intent_revision_id: primary.revision, state: "OBSERVING",
      });
    }
  }
  return primary;
}

function generateLedger(store, projectIndex, projectId) {
  const { state } = store;
  const retainedFrom = CAUSAL_BENCHMARK_CONTRACT.events_per_project - CAUSAL_BENCHMARK_CONTRACT.resume_history_limit + 1;
  let previousEventHash = null;
  for (let sequence = 1; sequence <= CAUSAL_BENCHMARK_CONTRACT.events_per_project; sequence += 1) {
    const event = {
      tenant_id: TENANT_ID,
      project_id: projectId,
      event_id: stableUuid(`project:${projectIndex}:event:${sequence}`),
      sequence_number: sequence,
      event_type: sequence % 10 === 0 ? "PROJECT_STATE_SNAPSHOTTED" : "EVIDENCE_RECORDED",
      operation: "deterministic_benchmark_seed",
      idempotency_key: `benchmark-${projectIndex}-${sequence}`,
      request_digest: causalDigest({ project: projectIndex, sequence }),
      payload_digest: causalDigest({ schema_version: "causal_event_payload_v1", project: projectIndex, sequence }),
      actor_provenance: { actor_id: "benchmark-seeder", source: "deterministic_fixture" },
      previous_event_hash: previousEventHash,
    };
    event.event_hash = buildCausalEventHash(event);
    previousEventHash = event.event_hash;
    if (sequence >= retainedFrom) {
      event.payload = { schema_version: "causal_event_payload_v1", result: { project: projectIndex, sequence } };
      event.created_at = new Date(FIXED_NOW.getTime() - (CAUSAL_BENCHMARK_CONTRACT.events_per_project - sequence) * 1_000).toISOString();
      state.events.set(key(TENANT_ID, event.event_id), event);
    }
  }
  return previousEventHash;
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

function deterministicEnvelope(actorContext, projectIndex, ids) {
  const envelope = {
    schema_version: "causal_context_envelope_v1",
    tenant_id: TENANT_ID,
    project_id: ids.project,
    project_state_digest: STATE_DIGEST,
    genesis_intent_id: ids.genesis,
    intent_revision_id: ids.revision,
    work_id: ids.work,
    change_id: ids.change,
    obligation_ids: [ids.obligation],
    gallery_ticket_ids: [],
    actor_id: actorContext.actor_id,
    actor_role: actorContext.actor_role,
    actor_provenance_digest: causalDigest(actorContext.provenance),
    delegated_from: null,
    environment: "staging",
    base_state_digest: STATE_DIGEST,
    authority_scope: actorContext.authority_scope,
    risk_budget: { max_validations: CAUSAL_BENCHMARK_CONTRACT.validation_samples },
    inherited_constraints: ["tenant_isolation"],
    issued_at: "2026-08-09T12:00:00.000Z",
    expires_at: "2026-08-09T13:00:00.000Z",
    single_use_nonce: `deterministic-benchmark-nonce-${projectIndex}`,
    lease_id: `benchmark-lease-${projectIndex}`,
    event_ledger_sequence: CAUSAL_BENCHMARK_CONTRACT.events_per_project,
  };
  envelope.context_digest = causalDigest(envelope);
  return envelope;
}

async function probeProductionTimelineBound(projectId) {
  const calls = [];
  const rows = Array.from({ length: CAUSAL_BENCHMARK_CONTRACT.resume_history_limit }, (_, index) => ({
    tenant_id: TENANT_ID,
    project_id: projectId,
    sequence_number: CAUSAL_BENCHMARK_CONTRACT.events_per_project - index,
    event_hash: causalDigest({ sequence: CAUSAL_BENCHMARK_CONTRACT.events_per_project - index }),
  }));
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params: [...params] });
      return { rows: structuredClone(rows) };
    },
    async end() {},
  };
  const store = createPostgresCausalContinuityStore({ pool, now: () => new Date(FIXED_NOW) });
  const selected = await store.timeline({ tenant_id: TENANT_ID, project_id: projectId, limit: CAUSAL_BENCHMARK_CONTRACT.resume_history_limit });
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
      contract.newest_first_before_reverse && contract.requested_limit === CAUSAL_BENCHMARK_CONTRACT.resume_history_limit &&
      contract.returned_rows === CAUSAL_BENCHMARK_CONTRACT.resume_history_limit,
  };
}

function sourceEvidence() {
  const sources = ["src/workContinuityRuntime.js", "src/causalContinuityStore.js"];
  return Object.fromEntries(sources.map((relative) => [relative, crypto.createHash("sha256").update(fs.readFileSync(path.join(SOURCE_ROOT, relative))).digest("hex")]));
}

async function measureSameCheckoutAppendRegression() {
  const samples = CAUSAL_BENCHMARK_CONTRACT.append_samples;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-causal-benchmark-"));
  const legacyTimes = [];
  const causalTimes = [];
  try {
    const legacy = createWorkContinuityRuntime({ root: tempRoot, now: () => FIXED_NOW.toISOString() });
    const legacyWorkId = stableUuid("legacy-append-work");
    legacy.create({
      project_id: stableUuid("legacy-append-project"), work_id: legacyWorkId, session_id: "benchmark-session",
      architecture_map: { idea_origin: "same-checkout baseline", objective: "measure append", current_state: "active" },
    }, TENANT_ID);
    const causal = createInMemoryCausalContinuityStore({ now: () => new Date(FIXED_NOW) });
    const causalProjectId = stableUuid("causal-append-project");
    await causal.createProject({
      tenant_id: TENANT_ID, project_id: causalProjectId, canonical_name: "same-checkout-causal",
      idempotency_key: "causal-append-create", request: { project_id: causalProjectId }, actor_provenance: { actor_id: "benchmark" },
    });
    for (let index = 0; index < 5; index += 1) {
      legacy.append({ tenant_id: TENANT_ID, work_id: legacyWorkId, event_type: "test_completed", actor: "test_agent", data: { index }, idempotency_key: `warmup-${index}` });
      await causal.runProjectOperation({
        tenant_id: TENANT_ID, project_id: causalProjectId, operation: "benchmark_append", event_type: "EVIDENCE_RECORDED",
        idempotency_key: `warmup-${index}`, request: { index }, actor_provenance: { actor_id: "benchmark" },
        mutate: async () => ({ index }),
      });
    }
    for (let index = 0; index < samples; index += 1) {
      let started = performance.now();
      legacy.append({ tenant_id: TENANT_ID, work_id: legacyWorkId, event_type: "test_completed", actor: "test_agent", data: { index }, idempotency_key: `sample-${index}` });
      legacyTimes.push(performance.now() - started);
      started = performance.now();
      await causal.runProjectOperation({
        tenant_id: TENANT_ID, project_id: causalProjectId, operation: "benchmark_append", event_type: "EVIDENCE_RECORDED",
        idempotency_key: `sample-${index}`, request: { index }, actor_provenance: { actor_id: "benchmark" },
        mutate: async () => ({ index }),
      });
      causalTimes.push(performance.now() - started);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  const legacy = timingSummary(legacyTimes);
  const causal = timingSummary(causalTimes);
  const p95Regression = ((causal.p95_ms / Math.max(legacy.p95_ms, Number.EPSILON)) - 1) * 100;
  return {
    comparison: "same-process public append paths from the same checkout",
    samples_per_path: samples,
    implementation_source_sha256: sourceEvidence(),
    legacy,
    causal,
    p95_regression_percent: Number(p95Regression.toFixed(3)),
  };
}

async function runIsolatedBenchmark() {
  const { stdout } = await execFileAsync(process.execPath, ["--expose-gc", BENCHMARK_FILE, "--internal"], {
    cwd: SOURCE_ROOT,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function runCausalContinuityBenchmark({ isolated = typeof global.gc !== "function" } = {}) {
  if (isolated) return runIsolatedBenchmark();
  const now = () => new Date(FIXED_NOW);
  const productionTimelineContract = await probeProductionTimelineBound(idsFor(0).project);
  const store = createInMemoryCausalContinuityStore({ now });
  const signer = createHostNativeDomainSigner({ signingSecret: SIGNING_SECRET });
  const runtime = createCausalContinuityRuntime({ store, contextSigner: signer, now });
  const actorContext = actor();
  global.gc?.();
  const rssStart = process.memoryUsage().rss;
  const generationStarted = performance.now();
  const ledgerHeads = [];
  const capsuleDigests = [];
  const contextDigests = [];
  const resumeTimes = [];
  const resumeStatuses = [];
  const validationTimes = [];
  const fixtureCounts = { projects: 0, works: 0, changes: 0, obligations: 0, ledger_events_executed: 0, bounded_events_read: 0, peak_event_rows_materialized: 0 };
  let firstTimeline = [];
  for (let projectIndex = 0; projectIndex < CAUSAL_BENCHMARK_CONTRACT.projects; projectIndex += 1) {
    const ids = seedProjectAggregate(store, projectIndex);
    fixtureCounts.projects += 1;
    fixtureCounts.works += 10;
    fixtureCounts.changes += 100;
    fixtureCounts.obligations += 100;
    ledgerHeads.push(generateLedger(store, projectIndex, ids.project));
    fixtureCounts.ledger_events_executed += CAUSAL_BENCHMARK_CONTRACT.events_per_project;
    fixtureCounts.peak_event_rows_materialized = Math.max(fixtureCounts.peak_event_rows_materialized, store.state.events.size);

    const envelope = deterministicEnvelope(actorContext, projectIndex, ids);
    const signature = signer.sign(envelope, { purpose: "causal_context_envelope_v1" });
    store.state.contexts.set(key(TENANT_ID, envelope.context_digest), {
      tenant_id: TENANT_ID, project_id: ids.project, work_id: ids.work, change_id: ids.change,
      context_id: stableUuid(`project:${projectIndex}:context`), context_digest: envelope.context_digest,
      envelope: { ...envelope, single_use_nonce: undefined, single_use_nonce_digest: causalDigest(envelope.single_use_nonce) },
      signature, issued_at: envelope.issued_at, expires_at: envelope.expires_at,
    });
    contextDigests.push(envelope.context_digest);

    const capsuleRow = await runtime.continuity_capsule_build(actorContext, {
      project_id: ids.project, work_id: ids.work, idempotency_key: `benchmark-capsule-${projectIndex}`,
      next_safe_action: "continue bounded verification", forbidden_actions: ["full_history_chat_load"],
    });
    capsuleDigests.push(capsuleRow.capsule.capsule_digest);
    store.state.events.delete(key(TENANT_ID, stableUuid(`project:${projectIndex}:event:801`)));
    const timeline = await store.timeline({ tenant_id: TENANT_ID, project_id: ids.project, limit: CAUSAL_BENCHMARK_CONTRACT.resume_history_limit });
    fixtureCounts.bounded_events_read += timeline.length;
    if (projectIndex === 0) firstTimeline = timeline;
    let started = performance.now();
    const resumed = await runtime.continuity_capsule_resume(actorContext, { project_id: ids.project, work_id: ids.work });
    resumeTimes.push(performance.now() - started);
    resumeStatuses.push(resumed.status);
    if (projectIndex === 0) {
      for (let warmup = 0; warmup < 20; warmup += 1) {
        await runtime.causal_context_validate(actorContext, { envelope, signature, consume: false, expected_environment: "staging", required_authority: "causal:read" });
      }
    }
    for (let sample = 0; sample < 10; sample += 1) {
      started = performance.now();
      await runtime.causal_context_validate(actorContext, { envelope, signature, consume: false, expected_environment: "staging", required_authority: "causal:read" });
      validationTimes.push(performance.now() - started);
    }

    for (const [eventKey, event] of store.state.events) if (event.project_id === ids.project) store.state.events.delete(eventKey);
    for (const [workKey, work] of store.state.works) if (work.project_id === ids.project) store.state.works.delete(workKey);
    for (const [changeKey, change] of store.state.changes) if (change.project_id === ids.project) store.state.changes.delete(changeKey);
    for (const [obligationKey, obligation] of store.state.obligations) if (obligation.project_id === ids.project) store.state.obligations.delete(obligationKey);
    global.gc?.();
  }
  const ledgerGenerationMs = performance.now() - generationStarted;
  global.gc?.();
  const rssEnd = process.memoryUsage().rss;
  const appendRegression = await measureSameCheckoutAppendRegression();
  const rssDeltaBytes = Math.max(0, rssEnd - rssStart);
  const rssDeltaMiB = rssDeltaBytes / (1024 * 1024);
  const contextValidation = timingSummary(validationTimes);
  const capsuleResume = timingSummary(resumeTimes);
  const deterministic = {
    schema_version: "causal_continuity_benchmark_fingerprint_v2",
    fixed_seed: CAUSAL_BENCHMARK_CONTRACT.fixed_seed,
    fixture_counts: fixtureCounts,
    ledger_heads_digest: causalDigest(ledgerHeads),
    capsule_digests_digest: causalDigest(capsuleDigests),
    context_digests_digest: causalDigest(contextDigests),
    resume_statuses_digest: causalDigest(resumeStatuses),
    timeline_first_sequence: firstTimeline[0]?.sequence_number || null,
    timeline_last_sequence: firstTimeline.at(-1)?.sequence_number || null,
  };
  const report = {
    schema_version: "causal_continuity_benchmark_v2",
    contract: CAUSAL_BENCHMARK_CONTRACT,
    fixture: deterministic.fixture_counts,
    bounded_history: {
      policy: "stream each full hash-chain; read and discard one 200-event project window at a time",
      per_project_history_generated: CAUSAL_BENCHMARK_CONTRACT.events_per_project,
      per_project_history_materialized: CAUSAL_BENCHMARK_CONTRACT.resume_history_limit,
      production_timeline_query: productionTimelineContract,
    },
    deterministic: { ...deterministic, fingerprint: causalDigest(deterministic) },
    measurements: {
      ledger_generation_ms: Number(ledgerGenerationMs.toFixed(3)),
      context_validation: contextValidation,
      capsule_resume: capsuleResume,
      rss: {
        methodology: "cold delta in an isolated --expose-gc process; each bounded project window is collected after readback",
        bounded_window_gc_available: typeof global.gc === "function",
        start_bytes: rssStart, end_bytes: rssEnd, delta_bytes: rssDeltaBytes, delta_mib: Number(rssDeltaMiB.toFixed(3)),
      },
      legacy_append_regression: appendRegression,
    },
  };
  report.gates = {
    exact_workload: report.fixture.projects === CAUSAL_BENCHMARK_CONTRACT.projects &&
      report.fixture.works === CAUSAL_BENCHMARK_CONTRACT.works &&
      report.fixture.changes === CAUSAL_BENCHMARK_CONTRACT.changes &&
      report.fixture.obligations === CAUSAL_BENCHMARK_CONTRACT.obligations &&
      report.fixture.ledger_events_executed === CAUSAL_BENCHMARK_CONTRACT.ledger_events,
    deterministic_reconstruction: resumeStatuses.length === CAUSAL_BENCHMARK_CONTRACT.projects && resumeStatuses.every((status) => status === "RESUMED"),
    bounded_history: report.fixture.bounded_events_read === CAUSAL_BENCHMARK_CONTRACT.projects * CAUSAL_BENCHMARK_CONTRACT.resume_history_limit &&
      report.fixture.peak_event_rows_materialized === CAUSAL_BENCHMARK_CONTRACT.resume_history_limit &&
      productionTimelineContract.verified === true && productionTimelineContract.application_full_history_materialized === false,
    context_validation_p95: contextValidation.p95_ms < CAUSAL_BENCHMARK_CONTRACT.thresholds.context_validation_p95_ms,
    capsule_resume_p95: capsuleResume.p95_ms < CAUSAL_BENCHMARK_CONTRACT.thresholds.capsule_resume_p95_ms,
    rss_delta_100_projects: rssDeltaMiB < CAUSAL_BENCHMARK_CONTRACT.thresholds.rss_delta_mib,
    legacy_append_regression: appendRegression.p95_regression_percent <= CAUSAL_BENCHMARK_CONTRACT.thresholds.legacy_append_regression_percent,
  };
  report.ok = Object.values(report.gates).every(Boolean);
  return report;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  console.log(JSON.stringify(await runCausalContinuityBenchmark({ isolated: process.argv[2] !== "--internal" }), null, 2));
}

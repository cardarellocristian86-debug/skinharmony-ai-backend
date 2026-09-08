import { performance } from "node:perf_hooks";

import {
  buildBoundedContext,
  foldWorkProjection,
  projectWorkStateForView,
} from "../src/governed-continuity-context.js";

const samples = Math.max(100, Math.min(20_000, Number(process.argv[2]) || 2_000));
const warmup = Math.min(250, Math.floor(samples / 5));
const workId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const intentDigest = "a".repeat(64);
const policyRevision = "b".repeat(64);
const revocationRevision = "c".repeat(64);
const asOf = "2026-09-08T12:00:00.000Z";

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))];
}

function measure(operation) {
  for (let index = 0; index < warmup; index += 1) operation();
  const durations = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    operation();
    durations.push(performance.now() - started);
  }
  return {
    samples,
    p50_ms: Number(percentile(durations, 0.5).toFixed(6)),
    p95_ms: Number(percentile(durations, 0.95).toFixed(6)),
    max_ms: Number(Math.max(...durations).toFixed(6)),
  };
}

function source(index) {
  const sourceId = `source:${index}`;
  const contentDigest = String(index + 1).padStart(64, "0");
  return {
    source_id: sourceId,
    mandatory: index < 2,
    utility: 1 - (index / 10),
    cost: { token_budget: 80, latency_budget_ms: 4, candidate_budget: 1 },
    content_ref: `evidence:${index}`,
    provenance: {
      schema_version: "context_provenance_envelope_v1",
      origin_ref: `ledger:event:${index}`,
      source_class: index < 2 ? "ledger" : "entity360",
      tenant_scope: "tenant-a",
      work_scope: workId,
      classification: "CONFIDENTIAL",
      derived_from: [],
      transformation_refs: [],
      valid_time: { from: "2026-09-01T00:00:00.000Z", to: null },
      knowledge_time: { from: "2026-09-02T00:00:00.000Z", to: null },
      content_digest: contentDigest,
    },
    authorization: {
      schema_version: "source_authorization_v1",
      principal_id: "principal-a",
      tenant_id: "tenant-a",
      work_id: workId,
      source_id: sourceId,
      namespace: "work.context",
      query_digest: intentDigest,
      policy_revision: policyRevision,
      revocation_revision: revocationRevision,
      issued_at: "2026-09-08T11:59:00.000Z",
      expires_at: "2026-09-08T12:01:00.000Z",
    },
  };
}

const sources = Array.from({ length: 8 }, (_, index) => source(index));
const events = Array.from({ length: 64 }, (_, index) => ({
  event_id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  sequence_number: index + 1,
  event_type: index % 2 === 0 ? "task_contract_recorded" : "next_actions_set",
  payload: index % 2 === 0
    ? { task_id: taskId }
    : { next_allowed_actions: [`task:next:${index}`] },
}));
const base = foldWorkProjection({ work_id: workId, intent_digest: intentDigest,
  events: events.slice(0, 63) });

const report = {
  schema_version: "governed_continuity_context_benchmark_v1",
  runtime: process.version,
  fixture: {
    sources: sources.length,
    ledger_events_full: events.length,
    ledger_events_incremental: 1,
    context_max_sources: 4,
  },
  metrics: {
    bounded_context: measure(() => buildBoundedContext({
      sources,
      required_source_ids: ["source:0", "source:1"],
      budgets: { max_sources: 4, max_tokens: 320, max_latency_ms: 16, max_candidates: 4 },
      expected_scope: {
        tenant_scope: "tenant-a",
        work_scope: workId,
        principal_id: "principal-a",
        namespace: "work.context",
        query_digest: intentDigest,
        policy_revision: policyRevision,
        revocation_revision: revocationRevision,
      },
      now: asOf,
    })),
    projection_full_64_events: measure(() => foldWorkProjection({
      work_id: workId, intent_digest: intentDigest, events,
    })),
    projection_incremental_1_event: measure(() => foldWorkProjection({
      work_id: workId, intent_digest: intentDigest, base, events: events.slice(63),
    })),
    owner_projection_view: measure(() => projectWorkStateForView(
      foldWorkProjection({ work_id: workId, intent_digest: intentDigest, events }),
      "owner",
    )),
  },
  observability: {
    input_tokens: "NOT_AVAILABLE",
    output_tokens: "NOT_AVAILABLE",
    cached_tokens: "NOT_AVAILABLE",
    model_calls: 0,
    tool_calls: 0,
    database_queries: 0,
    monetary_cost: "NOT_AVAILABLE",
  },
  note: "In-process deterministic contract benchmark; excludes network, PostgreSQL and model/provider latency.",
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

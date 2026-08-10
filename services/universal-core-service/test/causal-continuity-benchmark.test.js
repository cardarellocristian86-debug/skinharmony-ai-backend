import assert from "node:assert/strict";
import test from "node:test";
import { CAUSAL_BENCHMARK_CONTRACT, runCausalContinuityBenchmark } from "../tools/benchmark-causal-continuity.js";

test("documented causal benchmark contract is exact, bounded, measured, and deterministic across two runs", { timeout: 120_000 }, async () => {
  const first = await runCausalContinuityBenchmark();
  const second = await runCausalContinuityBenchmark();

  for (const report of [first, second]) {
    assert.equal(report.ok, true, JSON.stringify(report.gates));
    assert.deepEqual(report.contract, CAUSAL_BENCHMARK_CONTRACT);
    assert.deepEqual(report.fixture, {
      projects: 100,
      works: 1_000,
      changes: 10_000,
      obligations: 10_000,
      ledger_events_executed: 100_000,
      bounded_events_read: 20_000,
      peak_event_rows_materialized: 200,
    });
    assert.equal(report.deterministic.fixed_seed, "nyra-causal-continuity-benchmark-seed-v1");
    assert.equal(report.deterministic.timeline_first_sequence, 802);
    assert.equal(report.deterministic.timeline_last_sequence, 1_001);
    assert.equal(report.bounded_history.production_timeline_query.verified, true);
    assert.equal(report.bounded_history.production_timeline_query.requested_limit, 200);
    assert.equal(report.bounded_history.production_timeline_query.returned_rows, 200);
    assert.equal(report.bounded_history.production_timeline_query.application_full_history_materialized, false);
    assert.equal(report.measurements.context_validation.samples, 1_000);
    assert.ok(report.measurements.context_validation.p95_ms < 25);
    assert.equal(report.measurements.capsule_resume.samples, 100);
    assert.ok(report.measurements.capsule_resume.p95_ms < 250);
    assert.ok(report.measurements.rss.delta_mib < 64);
    assert.equal(report.measurements.legacy_append_regression.samples_per_path, 64);
    assert.ok(report.measurements.legacy_append_regression.p95_regression_percent <= 15);
    assert.equal(Object.keys(report.measurements.legacy_append_regression.implementation_source_sha256).length, 2);
    assert.equal(Object.values(report.measurements.legacy_append_regression.implementation_source_sha256).every((digest) => /^[a-f0-9]{64}$/.test(digest)), true);
    assert.equal(Object.values(report.gates).every(Boolean), true);
  }
  assert.equal(first.deterministic.fingerprint, second.deterministic.fingerprint);
});

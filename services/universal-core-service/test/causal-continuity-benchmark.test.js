import assert from "node:assert/strict";
import test from "node:test";
import { runCausalContinuityBenchmark } from "../tools/benchmark-causal-continuity.js";

test("bounded causal benchmark reconstructs deterministically without loading full history", async () => {
  const first = await runCausalContinuityBenchmark({ eventCount: 2_500, validationIterations: 100 });
  const second = await runCausalContinuityBenchmark({ eventCount: 2_500, validationIterations: 100 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.deterministic.fingerprint, second.deterministic.fingerprint);
  assert.equal(first.fixture.event_count, 2_500);
  assert.equal(first.bounds.timeline_selected, 200);
  assert.equal(first.bounds.in_memory_fixture_scans_map_before_slice, true);
  assert.equal(first.bounds.production_timeline_query.verified, true);
  assert.equal(first.bounds.production_timeline_query.requested_limit, 200);
  assert.equal(first.bounds.production_timeline_query.returned_rows, 200);
  assert.equal(first.bounds.production_timeline_query.application_full_history_materialized, false);
  assert.equal(first.deterministic.timeline_first_sequence, 2_301);
  assert.equal(first.deterministic.timeline_last_sequence, 2_500);
  assert.equal(first.deterministic.resume_status, "RESUMED");
  assert.equal(first.deterministic.validation_iterations, 100);
});

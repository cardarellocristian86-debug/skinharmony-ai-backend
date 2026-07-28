import assert from "node:assert/strict";
import test from "node:test";

import {
  executePairedAgenticEfficiencyBenchmark,
} from "../src/aiAgenticEfficiencyIntegratedBenchmark.js";
import {
  buildAgenticEfficiencyCorpus,
} from "../src/aiAgenticEfficiencyBenchmark.js";

const repositorySnapshot = `sha256:${"1".repeat(64)}`;
const rateCard = {
  provider: "benchmark-fixture",
  model_id: "planning-estimate",
  currency: "USD",
  effective_at: "2026-07-01T00:00:00.000Z",
  retrieved_at: "2026-07-27T00:00:00.000Z",
  source_url: "https://example.test/rate-card/planning-estimate",
  provenance_digest: `sha256:${"2".repeat(64)}`,
  input_per_million: 2,
  cached_input_per_million: 0.5,
  output_per_million: 8,
};

test("100 paired cases execute the production planner on one snapshot and rubric", () => {
  const report = executePairedAgenticEfficiencyBenchmark({
    corpus: buildAgenticEfficiencyCorpus(),
    repositorySnapshot,
    rateCard,
  });
  assert.equal(report.paired_case_count, 100);
  assert.equal(report.same_snapshot_for_every_pair, true);
  assert.equal(report.same_rubric_for_every_pair, true);
  assert.equal(report.quality_non_degradation, true);
  assert.equal(report.provider_calls_executed, 0);
  assert.equal(report.actual_provider_credits_observed, false);
  assert.equal(report.actual_savings_claimed, false);
  assert.equal(report.evidence_kind, "synthetic_hypothetical_context_replay");
  assert.equal(report.repository_snapshot_kind, "caller_declared_unverified");
  assert.equal(report.quality_evidence_kind, "structural_replay_estimated");
  assert.equal(report.release_economic_targets_verified, false);
  assert.equal(report.shadow_required, true);
  assert.equal(report.scorecard.actual_usage_case_count, 0);
  assert.equal(report.scorecard.production_savings_claim_allowed, false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(report.categories).map(([category, value]) => [category, value.case_count])),
    { short: 25, medium: 30, long: 25, true_multi_agent: 10, critical: 10 },
  );
});

test("paired replay uses the production generic orchestrator and preserves bounded invariants", () => {
  const report = executePairedAgenticEfficiencyBenchmark({
    repositorySnapshot,
    rateCard,
  });
  assert(report.measurements.every(
    (row) => row.orchestration_evidence.baseline_pipeline === "createGenericAgentOrchestrator",
  ));
  assert(report.measurements.every(
    (row) => row.orchestration_evidence.production_delta_packager_observed === false,
  ));
  assert(report.measurements.every(
    (row) => row.optimized_quality_evidence.checks.tools_preserved,
  ));
  assert(report.measurements.every(
    (row) => row.optimized_quality_evidence.checks.safe_agentic_boundary,
  ));
  assert(report.measurements
    .filter((row) => row.category === "critical")
    .every((row) => row.optimized_quality_evidence.checks.critical_review_preserved));
  assert(report.measurements
    .filter((row) => row.category === "true_multi_agent")
    .every((row) => row.optimized_quality_evidence.checks.independent_work_preserved));
  assert(report.measurements.every((row) => row.optimized.agent_count <= row.baseline.agent_count));
  assert(report.measurements.every((row) => row.baseline.provider_calls === 0));
  assert(report.measurements.every((row) => row.optimized.provider_calls === 0));
  assert(report.measurements.every((row) => row.baseline.tool_calls_measured === false));
  assert(report.measurements.every((row) => row.optimized.tool_calls_measured === false));
  assert(report.measurements.every((row) => row.baseline_quality_evidence.guardrails_preserved));
  assert(report.measurements.every((row) => row.optimized_quality_evidence.guardrails_preserved));
});

test("benchmark does not manufacture duplicate-work or provider-usage savings", () => {
  const report = executePairedAgenticEfficiencyBenchmark({
    repositorySnapshot,
    rateCard,
  });
  assert.equal(report.scorecard.actual_usage_case_count, 0);
  assert.equal(report.scorecard.production_savings_claim_allowed, false);
  assert.equal(report.scorecard.real_savings_verified, false);
  assert.equal(report.scorecard.duplicate_work_reduction_percent, null);
  assert.equal(report.scorecard.efficiency_targets_met, false);
  assert(report.measurement_limits.some((item) => /not provider usage/i.test(item)));
});

test("invalid snapshot and rate-card provenance fail closed", () => {
  assert.throws(
    () => executePairedAgenticEfficiencyBenchmark({
      repositorySnapshot: "main",
      rateCard,
    }),
    /repository_snapshot_invalid/,
  );
  assert.throws(
    () => executePairedAgenticEfficiencyBenchmark({
      repositorySnapshot,
      rateCard: { ...rateCard, provenance_digest: "fixture" },
    }),
    /rate_card_provenance_digest_invalid/,
  );
});

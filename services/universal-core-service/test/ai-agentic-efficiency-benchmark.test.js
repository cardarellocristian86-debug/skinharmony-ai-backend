import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  AI_AGENTIC_EFFICIENCY_COUNTS,
  agenticUsageDigest,
  buildAgenticEfficiencyCorpus,
  buildAgenticEfficiencyManifest,
  evaluateAgenticEfficiency,
} from "../src/aiAgenticEfficiencyBenchmark.js";

const manifestFile = new URL("../benchmarks/ai-learning-factory-v0.16/agentic-efficiency-manifest.json", import.meta.url);

const rateCard = {
  provider: "fixture-provider",
  model_id: "fixture-model",
  currency: "USD",
  effective_at: "2026-07-01T00:00:00.000Z",
  retrieved_at: "2026-07-27T00:00:00.000Z",
  source_url: "https://rates.example.test/fixture-model",
  provenance_digest: "sha256:rate-card-fixture",
  input_per_million: 2,
  cached_input_per_million: 0.5,
  output_per_million: 8,
};

function measurements(corpus, { allActual = false } = {}) {
  return corpus.map((item, index) => {
    const optimizedRatio = item.category === "long" ? 0.5 : 0.7;
    const usageSource = allActual || index % 2 === 0 ? "actual" : "estimated";
    return {
      case_id: item.case_id,
      baseline: {
        usage_source: usageSource,
        ...(usageSource === "actual"
          ? { provider_usage_reference: `provider-baseline-${index}`, provider_usage_digest: `sha256:baseline-${index}` }
          : { estimation_method: "deterministic_fixture" }),
        input_tokens: 10_000,
        output_tokens: 2_000,
        cached_tokens: 0,
        invocations: 10,
        context_resent_tokens: 5_000,
        duplicate_work_units: 10,
      },
      optimized: {
        usage_source: usageSource,
        ...(usageSource === "actual"
          ? { provider_usage_reference: `provider-optimized-${index}`, provider_usage_digest: `sha256:optimized-${index}` }
          : { estimation_method: "deterministic_fixture" }),
        input_tokens: 10_000 * optimizedRatio,
        output_tokens: 2_000 * optimizedRatio,
        cached_tokens: 0,
        invocations: 6,
        context_resent_tokens: 1_500,
        duplicate_work_units: 2,
      },
      baseline_quality: 0.9,
      optimized_quality: 0.89,
      critical_guardrails_preserved: true,
    };
  });
}

test("Agentic Efficiency corpus pins 25/30/25/10/10 cases", () => {
  const corpus = buildAgenticEfficiencyCorpus();
  assert.equal(corpus.length, 100);
  for (const [category, expected] of Object.entries(AI_AGENTIC_EFFICIENCY_COUNTS)) {
    assert.equal(corpus.filter((item) => item.category === category).length, expected);
  }
  assert.deepEqual(buildAgenticEfficiencyManifest(corpus), JSON.parse(fs.readFileSync(manifestFile, "utf8")));
});

test("scorecard separates actual from estimated usage and never invents costs", () => {
  const corpus = buildAgenticEfficiencyCorpus();
  const scorecard = evaluateAgenticEfficiency({
    corpus,
    measurements: measurements(corpus),
    rate_card: rateCard,
  });
  assert.equal(scorecard.actual_usage_case_count, 0);
  assert.equal(scorecard.estimated_usage_case_count, 100);
  assert.equal(scorecard.actual_costs_invented, false);
  assert.equal(scorecard.median_overall_savings_percent, 30);
  assert.equal(scorecard.median_long_savings_percent, 50);
  assert.equal(scorecard.context_resend_reduction_percent, 70);
  assert.equal(scorecard.duplicate_work_reduction_percent, 80);
  assert.equal(scorecard.invocation_reduction_percent, 40);
  assert.equal(scorecard.maximum_quality_loss, 0.01);
  assert.equal(scorecard.quality_target_met, true);
  assert.equal(scorecard.efficiency_targets_met, true);
  assert.equal(scorecard.production_evidence_complete, false);
  assert.equal(scorecard.production_savings_claim_allowed, false);
  assert.equal(scorecard.benchmark_evidence_kind, "synthetic_estimated");
  assert.equal(scorecard.scorecard_status, "shadow_candidate");
  assert.equal(scorecard.real_savings_verified, false);
  assert.match(scorecard.report_note, /no real Codex or ChatGPT credit saving/i);
  assert(scorecard.evaluated.every((row) => Number.isFinite(row.baseline_computed_cost)));
});

test("synthetic fixtures never authorize a production savings claim", () => {
  const corpus = buildAgenticEfficiencyCorpus();
  const scorecard = evaluateAgenticEfficiency({
    corpus,
    measurements: measurements(corpus, { allActual: true }),
    rate_card: rateCard,
  });
  assert.equal(scorecard.actual_usage_case_count, 0);
  assert.equal(scorecard.production_evidence_complete, false);
  assert.equal(scorecard.quality_evidence_complete, false);
  assert.equal(scorecard.production_savings_claim_allowed, false);
  assert.equal(scorecard.scorecard_status, "shadow_candidate");
});

test("caller-supplied costs and critical quality loss fail closed", () => {
  const corpus = buildAgenticEfficiencyCorpus();
  const suppliedCosts = measurements(corpus);
  suppliedCosts[0].actual_cost = 0.01;
  assert.throws(
    () => evaluateAgenticEfficiency({ corpus, measurements: suppliedCosts, rate_card: rateCard }),
    /caller_supplied_cost_forbidden/,
  );

  const unsafe = measurements(corpus);
  const criticalIndex = corpus.findIndex((item) => item.category === "critical");
  unsafe[criticalIndex].critical_guardrails_preserved = false;
  unsafe[criticalIndex].optimized_quality = 0.8;
  const scorecard = evaluateAgenticEfficiency({ corpus, measurements: unsafe, rate_card: rateCard });
  assert.equal(scorecard.quality_target_met, false);
  assert.equal(scorecard.production_savings_claim_allowed, false);
});

test("forged actual and cached-token claims are downgraded without a trusted resolver", () => {
  const corpus = buildAgenticEfficiencyCorpus();
  const forgedActual = measurements(corpus, { allActual: true });
  forgedActual[0].baseline.cached_tokens = 9_999;
  const scorecard = evaluateAgenticEfficiency({ corpus, measurements: forgedActual, rate_card: rateCard });
  assert.equal(scorecard.actual_usage_case_count, 0);
  assert.equal(scorecard.evaluated[0].baseline.usage_source, "estimated");
  assert.equal(scorecard.evaluated[0].baseline.estimation_method, "unverified_actual_claim");
  assert.equal(scorecard.production_savings_claim_allowed, false);

  const duplicates = measurements(corpus);
  duplicates[1].case_id = duplicates[0].case_id;
  assert.throws(
    () => evaluateAgenticEfficiency({ corpus, measurements: duplicates, rate_card: rateCard }),
    /efficiency_measurement_duplicate/,
  );
});

test("trusted resolver binds actual usage to the exact token digest", () => {
  const corpus = buildAgenticEfficiencyCorpus().map((item) => ({
    ...item,
    benchmark_evidence_kind: "provider_actual",
  }));
  const measured = measurements(corpus, { allActual: true });
  const allowset = new Map();
  for (const measurement of measured) {
    for (const phase of ["baseline", "optimized"]) {
      allowset.set(`${measurement.case_id}:${phase}`, agenticUsageDigest(measurement[phase]));
    }
  }
  const trustedUsageResolver = ({ case_id, phase, usage_digest }) => {
    const expected = allowset.get(`${case_id}:${phase}`);
    return {
      verified: usage_digest === expected,
      usage_digest,
      provider_usage_reference: `provider-${case_id}-${phase}`,
      provider_usage_digest: `sha256:${case_id}-${phase}`,
      attestation_id: `attestation-${case_id}-${phase}`,
    };
  };
  const usageOnly = evaluateAgenticEfficiency({
    corpus,
    measurements: measured,
    rate_card: rateCard,
    trusted_usage_resolver: trustedUsageResolver,
  });
  assert.equal(usageOnly.actual_usage_case_count, 100);
  assert.equal(usageOnly.quality_evidence_complete, false);
  assert.equal(usageOnly.production_savings_claim_allowed, false);

  measured[0].baseline.cached_tokens = 100;
  const scorecard = evaluateAgenticEfficiency({
    corpus,
    measurements: measured,
    rate_card: rateCard,
    trusted_usage_resolver: trustedUsageResolver,
  });
  assert.equal(scorecard.actual_usage_case_count, 99);
  assert.equal(scorecard.evaluated[0].usage_classification, "estimated");
  assert.equal(scorecard.production_savings_claim_allowed, false);
  assert.equal(scorecard.quality_evidence_complete, false);
});

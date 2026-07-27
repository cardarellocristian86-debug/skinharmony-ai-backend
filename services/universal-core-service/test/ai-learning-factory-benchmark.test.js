import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  AI_LEARNING_FACTORY_BENCHMARK_COUNTS,
  buildAiLearningFactoryBenchmarkCorpus,
  buildAiLearningFactoryBenchmarkManifest,
  buildReferenceBenchmarkResults,
  evaluatePairedGuardrailOverhead,
  executeAiLearningFactoryIntegratedBenchmark,
  measurePairedGuardrailOverhead,
  runAiLearningFactoryBenchmark,
} from "../src/aiLearningFactoryBenchmark.js";

const manifestFile = new URL("../benchmarks/ai-learning-factory-v0.16/manifest.json", import.meta.url);

function passingOverhead() {
  const baseline = Array.from({ length: 100 }, (_, index) => 10 + (index % 11));
  const guarded = baseline.map((value) => value * 1.1);
  return evaluatePairedGuardrailOverhead({
    baseline_samples_ms: baseline,
    guarded_samples_ms: guarded,
  });
}

test("deterministic benchmark corpus has exact 60/40/40/40/30/30 distribution", () => {
  const first = buildAiLearningFactoryBenchmarkCorpus();
  const second = buildAiLearningFactoryBenchmarkCorpus();
  assert.deepEqual(second, first);
  assert.equal(first.length, 240);
  for (const [category, expected] of Object.entries(AI_LEARNING_FACTORY_BENCHMARK_COUNTS)) {
    assert.equal(first.filter((item) => item.category === category).length, expected, category);
  }
  assert(first.every((item) => ["chatgpt", "codex", "admin"].includes(item.client_type)));
  assert(first.every((item) => (
    (item.client_type === "chatgpt" && item.audience === "chatgpt_connector")
    || (item.client_type === "codex" && item.audience === "codex_internal")
    || (item.client_type === "admin" && item.audience === "admin_control_room")
  )));
  const adaptationCases = first.filter((item) => item.expected.selected_branch === "model_adaptation_lab"
    || String(item.stimulus.request || "").startsWith("evaluate an offline prompt candidate"));
  assert(adaptationCases.some((item) => item.client_type === "admin" && item.expected.decision === "select"));
  assert(adaptationCases.every((item) => (
    item.client_type === "admin"
      ? item.expected.selected_branch === "model_adaptation_lab"
      : item.expected.decision === "block" && item.expected.selected_branch === null
  )));
  const isolationBranches = new Set(
    first
      .filter((item) => item.category === "tenant_client_audience_isolation")
      .map((item) => item.stimulus.requested_branch),
  );
  assert.deepEqual(
    [...isolationBranches].sort(),
    ["front_desk_base", "skinharmony_analyzer", "suite_governance"],
  );
  const nonIsolationSerialized = JSON.stringify(
    first.filter((item) => item.category !== "tenant_client_audience_isolation"),
  ).toLowerCase();
  assert.equal(nonIsolationSerialized.includes("skinharmony"), false);
  assert.equal(nonIsolationSerialized.includes("beauty"), false);
});

test("checked-in manifest pins corpus and category digests", () => {
  const checkedIn = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const generated = buildAiLearningFactoryBenchmarkManifest();
  assert.deepEqual(generated, checkedIn);
  assert.match(generated.corpus_digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(generated.contains_customer_data, false);
  assert.equal(generated.contains_secrets, false);
});

test("reference fixture validates formulas but cannot become a release scorecard", () => {
  const corpus = buildAiLearningFactoryBenchmarkCorpus();
  const scorecard = runAiLearningFactoryBenchmark({
    corpus,
    results: buildReferenceBenchmarkResults(corpus),
    overhead: passingOverhead(),
  });
  assert.equal(scorecard.case_count, 240);
  assert.equal(scorecard.failed_count, 0);
  assert.equal(scorecard.branch_selection_accuracy, 1);
  assert.equal(scorecard.tool_selection_accuracy, 1);
  assert.equal(scorecard.hard_invariant_violation_count, 0);
  assert.equal(scorecard.guardrail_overhead.p95.overhead_percent, 10);
  assert.equal(scorecard.evidence_kind, "reference_fixture");
  assert.equal(scorecard.contract_targets_met, true);
  assert.equal(scorecard.release_targets_met, false);
  assert.equal(scorecard.scorecard_status, "shadow_candidate");
});

test("hard invariant violations are non-compensable", () => {
  const corpus = buildAiLearningFactoryBenchmarkCorpus();
  const results = buildReferenceBenchmarkResults(corpus);
  results[0] = { ...results[0], cross_tenant_violation: true };
  const scorecard = runAiLearningFactoryBenchmark({ corpus, results, overhead: passingOverhead() });
  assert.equal(scorecard.overall_accuracy > 0.99, true);
  assert.equal(scorecard.hard_invariant_violations.cross_tenant_violation, 1);
  assert.equal(scorecard.release_targets_met, false);
});

test("paired overhead reports p50/p95/p99 and enforces the 15 percent target", () => {
  const passing = passingOverhead();
  assert.equal(passing.sample_count, 100);
  assert.equal(passing.p50.overhead_percent, 10);
  assert.equal(passing.p95.overhead_percent, 10);
  assert.equal(passing.p99.overhead_percent, 10);
  assert.equal(passing.target_met, true);

  const baseline = Array.from({ length: 20 }, () => 10);
  const failing = evaluatePairedGuardrailOverhead({
    baseline_samples_ms: baseline,
    guarded_samples_ms: baseline.map(() => 12),
  });
  assert.equal(failing.p95.overhead_percent, 20);
  assert.equal(failing.target_met, false);
});

test("paired measurement runner times the same case sequence without synthetic product claims", () => {
  let tick = 0;
  const clock = () => {
    const sample = Math.floor(tick / 4);
    const position = tick % 4;
    tick += 1;
    return sample * 100 + [0, 10, 20, 31][position];
  };
  const report = measurePairedGuardrailOverhead({
    cases: [{ case_id: "case-a" }, { case_id: "case-b" }],
    baseline() {},
    guarded() {},
    sample_count: 20,
    clock,
  });
  assert.equal(report.sample_count, 20);
  assert.equal(report.p95.baseline_ms, 10);
  assert.equal(report.p95.guarded_ms, 11);
  assert.equal(report.p95.overhead_percent, 10);
  assert.equal(report.target_met, true);
  assert.equal(report.evidence_kind, "unit_fixture");
});

test("default hrtime path is marked integrated while custom clocks remain unit-only", () => {
  let sink = 0;
  const work = (benchmarkCase) => {
    for (let index = 0; index < 2_000; index += 1) sink += benchmarkCase.case_id.length + index;
  };
  const report = measurePairedGuardrailOverhead({
    cases: [{ case_id: "case-a" }, { case_id: "case-b" }],
    baseline: work,
    guarded: work,
    sample_count: 20,
  });
  assert.equal(report.evidence_kind, "integrated_measured");
  assert.equal(report.sample_count, 20);
  assert.equal(Number.isFinite(report.p95.overhead_percent), true);
  assert(sink > 0);
});

test("integrated harness requires all six real adapter surfaces and measured evidence", async () => {
  const corpus = buildAiLearningFactoryBenchmarkCorpus();
  const measured = (benchmarkCase) => ({
    ...benchmarkCase.expected,
    measured_evidence: {
      component_ids: ["real-integration-hook"],
      evidence_digest: `sha256:${"a".repeat(64)}`,
    },
  });
  const bundle = await executeAiLearningFactoryIntegratedBenchmark({
    corpus,
    adapter: {
      evaluateRouting: measured,
      evaluateDynamicCapability: measured,
      evaluateHandoffGuard: measured,
      evaluateOutputQuality: measured,
      evaluateIsolation: measured,
      evaluatePerformanceGuard: measured,
    },
  });
  assert.equal(bundle.evidence_kind, "integrated_measured");
  assert.equal(bundle.results.length, 240);
  const scorecard = runAiLearningFactoryBenchmark({
    corpus,
    integrated_bundle: bundle,
    overhead: passingOverhead(),
  });
  assert.equal(scorecard.evidence_kind, "integrated_measured");
  assert.equal(scorecard.contract_targets_met, true);
  assert.equal(scorecard.release_targets_met, false);
  assert.equal(scorecard.guardrail_overhead.evidence_kind, "unit_fixture");

  await assert.rejects(
    executeAiLearningFactoryIntegratedBenchmark({
      corpus,
      adapter: {
        evaluateRouting: measured,
        evaluateDynamicCapability: measured,
      },
    }),
    /integrated_benchmark_evaluateHandoffGuard_required/,
  );
});

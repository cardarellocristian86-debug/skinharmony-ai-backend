import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type CandidateResult = {
  candidate: string;
  accepted: boolean;
  score: number;
  final_verdict?: string;
  metrics: Record<string, number | string | boolean | null>;
  report: unknown;
};

type SupervisorReport = {
  generated_at: string;
  runner: "nyra_universal_autoimprovement";
  mode: "generic_report_driven_sandbox";
  stable_runtime_modified: false;
  targets: Array<{
    test: string;
    report_path: string;
    baseline: CandidateResult;
    candidates: CandidateResult[];
    selected_candidate: string;
    improvement_detected: boolean;
    learned_bottlenecks: string[];
  }>;
  output_pack: string;
  notes: string[];
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const UC_ROOT = join(ROOT, "universal-core");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "learning");
const RUNTIME_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const OUTPUT_REPORT_PATH = join(REPORT_DIR, "nyra_universal_autoimprovement_latest.json");
const OUTPUT_PACK_PATH = join(RUNTIME_DIR, "nyra_universal_autoimprovement_latest.json");

const TARGETS = [
  {
    test: "tests/nyra-vs-qqq-bad-timing-test.ts",
    report: join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_vs_qqq_bad_timing_latest.json"),
    envKey: "NYRA_AUTOIMPROVE_POLICY",
    candidates: ["bad_timing_recovery_attack_v1", "bad_timing_lateral_patience_v1", "bad_timing_combined_v1"],
  },
] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function runTest(testPath: string, env: Record<string, string> = {}): void {
  execFileSync(process.execPath, ["--experimental-strip-types", testPath], {
    cwd: UC_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function extractMetrics(report: unknown): Record<string, number | string | boolean | null> {
  const data = report as {
    final_verdict?: string;
    aggregate?: Record<string, unknown>;
    checks?: Record<string, unknown>;
    scenarios?: Array<Record<string, unknown>>;
  };
  const aggregate = data.aggregate ?? {};
  const scenarios = data.scenarios ?? [];
  const avgNyraFinal = scenarios.length ? scenarios.reduce((sum, row) => sum + numberValue(row.nyra_final), 0) / scenarios.length : 0;
  const avgQqqFinal = scenarios.length ? scenarios.reduce((sum, row) => sum + numberValue(row.qqq_final), 0) / scenarios.length : 0;
  const avgNyraDrawdown = scenarios.length ? scenarios.reduce((sum, row) => sum + numberValue(row.nyra_drawdown), 0) / scenarios.length : 0;
  return {
    final_verdict: data.final_verdict ?? null,
    capital_wins: numberValue(aggregate.capital_wins),
    drawdown_wins: numberValue(aggregate.drawdown_wins),
    recovery_wins: numberValue(aggregate.recovery_wins),
    initial_loss_wins: numberValue(aggregate.initial_loss_wins),
    avg_nyra_final: round(avgNyraFinal, 2),
    avg_qqq_final: round(avgQqqFinal, 2),
    avg_nyra_drawdown: round(avgNyraDrawdown, 4),
  };
}

function scoreReport(report: unknown): number {
  const metrics = extractMetrics(report);
  const capitalWins = numberValue(metrics.capital_wins);
  const drawdownWins = numberValue(metrics.drawdown_wins);
  const recoveryWins = numberValue(metrics.recovery_wins);
  const initialWins = numberValue(metrics.initial_loss_wins);
  const avgNyraFinal = numberValue(metrics.avg_nyra_final);
  const avgDrawdown = numberValue(metrics.avg_nyra_drawdown);
  return round(capitalWins * 22 + drawdownWins * 18 + recoveryWins * 12 + initialWins * 10 + avgNyraFinal / 10_000 - avgDrawdown * 0.8, 4);
}

function accepted(candidate: unknown, baseline: unknown): boolean {
  const candidateMetrics = extractMetrics(candidate);
  const baselineMetrics = extractMetrics(baseline);
  return (
    numberValue(candidateMetrics.capital_wins) >= numberValue(baselineMetrics.capital_wins) &&
    numberValue(candidateMetrics.drawdown_wins) >= numberValue(baselineMetrics.drawdown_wins) &&
    numberValue(candidateMetrics.recovery_wins) >= numberValue(baselineMetrics.recovery_wins) &&
    numberValue(candidateMetrics.avg_nyra_final) >= numberValue(baselineMetrics.avg_nyra_final) * 0.995 &&
    numberValue(candidateMetrics.avg_nyra_drawdown) <= numberValue(baselineMetrics.avg_nyra_drawdown) + 3
  );
}

function bottlenecks(report: unknown): string[] {
  const data = report as { aggregate?: Record<string, unknown>; scenarios?: Array<Record<string, unknown>> };
  const result: string[] = [];
  const aggregate = data.aggregate ?? {};
  if (numberValue(aggregate.capital_wins) < 3) result.push("capital_wins_below_target");
  if (numberValue(aggregate.recovery_wins) < 3) result.push("recovery_wins_below_target");
  if (numberValue(aggregate.drawdown_wins) < 5) result.push("drawdown_not_all_scenarios");
  for (const scenario of data.scenarios ?? []) {
    if (scenario.verdict === "fail" || scenario.verdict === "partial") result.push(`scenario:${String(scenario.scenario ?? "unknown")}`);
  }
  return [...new Set(result)];
}

function runTarget(target: (typeof TARGETS)[number]): SupervisorReport["targets"][number] {
  runTest(target.test, { [target.envKey]: "none" });
  const baselineReport = readJson<unknown>(target.report);
  const baseline: CandidateResult = {
    candidate: "stable_baseline",
    accepted: true,
    score: scoreReport(baselineReport),
    final_verdict: (baselineReport as { final_verdict?: string }).final_verdict,
    metrics: extractMetrics(baselineReport),
    report: baselineReport,
  };

  const candidates = target.candidates.map((candidate) => {
    runTest(target.test, { [target.envKey]: candidate });
    const report = readJson<unknown>(target.report);
    return {
      candidate,
      accepted: accepted(report, baselineReport),
      score: scoreReport(report),
      final_verdict: (report as { final_verdict?: string }).final_verdict,
      metrics: extractMetrics(report),
      report,
    };
  }).sort((a, b) => b.score - a.score);

  const selected = candidates.find((candidate) => candidate.accepted && candidate.score > baseline.score) ?? baseline;
  const selectedCandidate = selected.candidate;
  runTest(target.test, { [target.envKey]: selectedCandidate === "stable_baseline" ? "none" : selectedCandidate });
  return {
    test: target.test,
    report_path: target.report,
    baseline,
    candidates,
    selected_candidate: selectedCandidate,
    improvement_detected: selectedCandidate !== "stable_baseline",
    learned_bottlenecks: bottlenecks(baselineReport),
  };
}

function main(): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const targets = TARGETS.map(runTarget);
  const report: SupervisorReport = {
    generated_at: new Date().toISOString(),
    runner: "nyra_universal_autoimprovement",
    mode: "generic_report_driven_sandbox",
    stable_runtime_modified: false,
    targets,
    output_pack: "universal-core/runtime/nyra-learning/nyra_universal_autoimprovement_latest.json",
    notes: [
      "Universal supervisor runs tests, reads reports, detects bottlenecks, tries sandbox candidates, and saves the best candidate.",
      "Stable runtime is not promoted by this tool.",
      "More tests can join by exposing report metrics and optional NYRA_AUTOIMPROVE_POLICY candidates.",
    ],
  };
  const pack = {
    version: "nyra_universal_autoimprovement_pack_v1",
    generated_at: report.generated_at,
    stable_runtime_modified: false,
    selected_candidates: targets.map((target) => ({
      test: target.test,
      selected_candidate: target.selected_candidate,
      improvement_detected: target.improvement_detected,
      learned_bottlenecks: target.learned_bottlenecks,
    })),
    promotion_status: "sandbox_only_requires_regression_gate",
  };
  writeFileSync(OUTPUT_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUTPUT_PACK_PATH, `${JSON.stringify(pack, null, 2)}\n`);
  console.log(JSON.stringify({
    report_path: OUTPUT_REPORT_PATH,
    pack_path: OUTPUT_PACK_PATH,
    stable_runtime_modified: false,
    selected_candidates: pack.selected_candidates,
  }, null, 2));
}

main();

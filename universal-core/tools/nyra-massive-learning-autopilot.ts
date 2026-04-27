import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type SandboxPolicy =
  | "none"
  | "turnover_guard_candidate"
  | "bull_participation_candidate"
  | "dirty_fallback_candidate"
  | "combined_candidate";

type MassiveReport = {
  final_output: {
    total_scenarios: number;
    pass_rate: number;
    win_rate_capital_vs_qqq: number;
    win_rate_drawdown_vs_qqq: number;
    avg_final_capital_nyra: number;
    avg_final_capital_qqq: number;
    avg_drawdown_nyra: number;
    avg_drawdown_qqq: number;
    avg_turnover: number;
    avg_fees: number;
    best_category: string;
    worst_category: string;
    bottleneck_ranking: Array<{ bottleneck: string; count: number; pct: number }>;
    verdict: string;
  };
  pass_rate_by_category: Record<string, number>;
};

type CandidateResult = {
  policy: SandboxPolicy;
  final_output: MassiveReport["final_output"];
  pass_rate_by_category: Record<string, number>;
  deltas_vs_baseline?: Record<string, number>;
  pass_guardrails?: Record<string, boolean>;
  accepted?: boolean;
};

const ROOT = join(process.cwd().endsWith("/universal-core") ? process.cwd() : join(process.cwd(), "universal-core"), "..");
const UC_ROOT = join(ROOT, "universal-core");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "learning");
const MASSIVE_REPORT_PATH = join(REPORT_DIR, "nyra_massive_multi_scenario_regression_latest.json");
const OUTPUT_REPORT_PATH = join(REPORT_DIR, "nyra_massive_learning_autopilot_latest.json");
const OUTPUT_PACK_PATH = join(UC_ROOT, "runtime", "nyra-learning", "nyra_massive_learning_autopilot_latest.json");
const POLICIES: SandboxPolicy[] = [
  "none",
  "turnover_guard_candidate",
  "bull_participation_candidate",
  "dirty_fallback_candidate",
  "combined_candidate",
];

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function runMassive(policy: SandboxPolicy): MassiveReport {
  execFileSync(process.execPath, ["--experimental-strip-types", "tests/nyra-massive-multi-scenario-regression-test.ts"], {
    cwd: UC_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NYRA_MASSIVE_SANDBOX_POLICY: policy },
  });
  return readJson<MassiveReport>(MASSIVE_REPORT_PATH);
}

function deltas(candidate: MassiveReport, baseline: MassiveReport): Record<string, number> {
  return {
    pass_rate: round(candidate.final_output.pass_rate - baseline.final_output.pass_rate, 4),
    win_rate_capital_vs_qqq: round(candidate.final_output.win_rate_capital_vs_qqq - baseline.final_output.win_rate_capital_vs_qqq, 4),
    win_rate_drawdown_vs_qqq: round(candidate.final_output.win_rate_drawdown_vs_qqq - baseline.final_output.win_rate_drawdown_vs_qqq, 4),
    avg_final_capital_nyra: round(candidate.final_output.avg_final_capital_nyra - baseline.final_output.avg_final_capital_nyra, 2),
    avg_drawdown_nyra: round(candidate.final_output.avg_drawdown_nyra - baseline.final_output.avg_drawdown_nyra, 4),
    avg_turnover: round(candidate.final_output.avg_turnover - baseline.final_output.avg_turnover, 4),
    avg_fees: round(candidate.final_output.avg_fees - baseline.final_output.avg_fees, 2),
    bull_clean_pass_rate: round((candidate.pass_rate_by_category.bull_clean ?? 0) - (baseline.pass_rate_by_category.bull_clean ?? 0), 4),
    lateral_dirty_pass_rate: round((candidate.pass_rate_by_category.lateral_dirty ?? 0) - (baseline.pass_rate_by_category.lateral_dirty ?? 0), 4),
    dirty_data_failure_pass_rate: round((candidate.pass_rate_by_category.dirty_data_failure ?? 0) - (baseline.pass_rate_by_category.dirty_data_failure ?? 0), 4),
  };
}

function guardrails(candidate: MassiveReport, baseline: MassiveReport): Record<string, boolean> {
  const d = deltas(candidate, baseline);
  return {
    pass_rate_improved: d.pass_rate > 0,
    turnover_not_worse: candidate.final_output.avg_turnover <= baseline.final_output.avg_turnover,
    fees_not_worse: candidate.final_output.avg_fees <= baseline.final_output.avg_fees,
    drawdown_not_worse_over_1pt: candidate.final_output.avg_drawdown_nyra <= baseline.final_output.avg_drawdown_nyra + 1,
    capital_not_worse_over_3pct: candidate.final_output.avg_final_capital_nyra >= baseline.final_output.avg_final_capital_nyra * 0.97,
    drawdown_win_rate_not_worse_over_3pt: candidate.final_output.win_rate_drawdown_vs_qqq >= baseline.final_output.win_rate_drawdown_vs_qqq - 3,
    no_category_collapses_below_baseline_minus_10pt: Object.keys(baseline.pass_rate_by_category).every((category) =>
      (candidate.pass_rate_by_category[category] ?? 0) >= (baseline.pass_rate_by_category[category] ?? 0) - 10
    ),
  };
}

function allPass(values: Record<string, boolean>): boolean {
  return Object.values(values).every(Boolean);
}

function score(result: CandidateResult): number {
  const d = result.deltas_vs_baseline ?? {};
  return (
    (d.pass_rate ?? 0) * 10 +
    (d.win_rate_capital_vs_qqq ?? 0) * 2 +
    Math.max(-(d.avg_turnover ?? 0), -50) * 0.25 +
    Math.max(-(d.avg_fees ?? 0), -5000) * 0.002 +
    (d.bull_clean_pass_rate ?? 0) * 1.5 +
    (d.lateral_dirty_pass_rate ?? 0) * 1.2 +
    (d.dirty_data_failure_pass_rate ?? 0) * 1.2
  );
}

function main(): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(join(UC_ROOT, "runtime", "nyra-learning"), { recursive: true });

  const baseline = runMassive("none");
  const candidateResults: CandidateResult[] = POLICIES.map((policy) => {
    const report = policy === "none" ? baseline : runMassive(policy);
    const result: CandidateResult = {
      policy,
      final_output: report.final_output,
      pass_rate_by_category: report.pass_rate_by_category,
    };
    if (policy !== "none") {
      result.deltas_vs_baseline = deltas(report, baseline);
      result.pass_guardrails = guardrails(report, baseline);
      result.accepted = allPass(result.pass_guardrails);
    }
    return result;
  });

  const accepted = candidateResults.filter((result) => result.accepted);
  const winner = accepted.sort((a, b) => score(b) - score(a))[0] ?? null;
  const selectedBottlenecks = baseline.final_output.bottleneck_ranking.slice(0, 4);
  const report = {
    generated_at: new Date().toISOString(),
    runner: "nyra_massive_learning_autopilot",
    mode: "sandbox_candidate_selection",
    stable_runtime_modified: false,
    selected_bottlenecks: selectedBottlenecks,
    baseline: candidateResults.find((result) => result.policy === "none"),
    candidates: candidateResults.filter((result) => result.policy !== "none"),
    winner,
    final_output: {
      baseline_pass_rate: baseline.final_output.pass_rate,
      accepted_candidates: accepted.map((result) => result.policy),
      selected_policy: winner?.policy ?? "none",
      selected_policy_score: winner ? round(score(winner), 4) : 0,
      selected_policy_deltas: winner?.deltas_vs_baseline ?? null,
      verdict: winner ? "candidate_learned_in_sandbox" : "no_safe_candidate",
      promoted_to_stable: false,
    },
  };

  const pack = {
    version: "nyra_massive_learning_autopilot_pack_v1",
    generated_at: report.generated_at,
    source_report: MASSIVE_REPORT_PATH,
    selected_bottlenecks: selectedBottlenecks,
    selected_policy: report.final_output.selected_policy,
    selected_policy_deltas: report.final_output.selected_policy_deltas,
    promotion_status: "not_promoted_to_runtime",
    guardrails: winner?.pass_guardrails ?? {},
    boundaries: [
      "sandbox only",
      "stable selector unchanged",
      "requires regression gate before promotion",
      "candidate chosen by massive report metrics, not manual promotion",
    ],
  };

  writeFileSync(OUTPUT_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUTPUT_PACK_PATH, `${JSON.stringify(pack, null, 2)}\n`);
  console.log(JSON.stringify({
    report_path: OUTPUT_REPORT_PATH,
    pack_path: OUTPUT_PACK_PATH,
    final_output: report.final_output,
  }, null, 2));
}

main();

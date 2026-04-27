import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type CommercialPolicy = "none" | "stability_hold_candidate" | "client_cooldown_candidate" | "commercial_combined_candidate";

type CommercialReport = {
  final_output: {
    verdict: string;
    total_score: number;
    technical_score: number;
    product_score: number;
    legal_safety_score: number;
    final_capital_nyra: number;
    final_capital_qqq: number;
    max_drawdown_nyra: number;
    max_drawdown_qqq: number;
    rebalance_count: number;
    fees_total: number;
    turnover_annual: number;
    sellable_as: string;
    main_blocker: string;
    recommended_launch_mode: string;
  };
  product_metrics: {
    clarity_score: number;
    trust_score: number;
    stability_score: number;
    usefulness_score: number;
  };
  pass_criteria: Record<string, boolean>;
};

type CandidateRun = {
  policy: CommercialPolicy;
  output: CommercialReport["final_output"];
  product_metrics: CommercialReport["product_metrics"];
  deltas_vs_previous: Record<string, number>;
  guardrails: Record<string, boolean>;
  accepted: boolean;
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const UC_ROOT = join(ROOT, "universal-core");
const BUSINESS_REPORT_DIR = join(ROOT, "reports", "universal-core", "business");
const LEARNING_DIR = join(ROOT, "reports", "universal-core", "learning");
const RUNTIME_LEARNING_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const COMMERCIAL_REPORT_PATH = join(BUSINESS_REPORT_DIR, "nyra_commercialization_readiness_latest.json");
const OUTPUT_REPORT_PATH = join(LEARNING_DIR, "nyra_commercial_learning_autopilot_latest.json");
const OUTPUT_PACK_PATH = join(RUNTIME_LEARNING_DIR, "nyra_commercial_learning_autopilot_latest.json");
const POLICIES: CommercialPolicy[] = ["stability_hold_candidate", "client_cooldown_candidate", "commercial_combined_candidate"];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function runCommercial(policy: CommercialPolicy): CommercialReport {
  execFileSync(process.execPath, ["--experimental-strip-types", "tests/nyra-commercialization-readiness-test.ts"], {
    cwd: UC_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NYRA_COMMERCIAL_SANDBOX_POLICY: policy },
  });
  return readJson<CommercialReport>(COMMERCIAL_REPORT_PATH);
}

function deltas(current: CommercialReport, previous: CommercialReport): Record<string, number> {
  return {
    total_score: round(current.final_output.total_score - previous.final_output.total_score, 4),
    technical_score: round(current.final_output.technical_score - previous.final_output.technical_score, 4),
    product_score: round(current.final_output.product_score - previous.final_output.product_score, 4),
    stability_score: round(current.product_metrics.stability_score - previous.product_metrics.stability_score, 4),
    final_capital_nyra: round(current.final_output.final_capital_nyra - previous.final_output.final_capital_nyra, 2),
    max_drawdown_nyra: round(current.final_output.max_drawdown_nyra - previous.final_output.max_drawdown_nyra, 4),
    rebalance_count: current.final_output.rebalance_count - previous.final_output.rebalance_count,
    fees_total: round(current.final_output.fees_total - previous.final_output.fees_total, 2),
    turnover_annual: round(current.final_output.turnover_annual - previous.final_output.turnover_annual, 4),
  };
}

function guardrails(current: CommercialReport, previous: CommercialReport): Record<string, boolean> {
  const d = deltas(current, previous);
  return {
    total_score_not_worse: current.final_output.total_score >= previous.final_output.total_score,
    stability_improved_or_passed: current.product_metrics.stability_score > previous.product_metrics.stability_score || current.product_metrics.stability_score >= 7,
    legal_still_safe: current.final_output.legal_safety_score >= 18,
    clarity_still_good: current.product_metrics.clarity_score >= 8,
    trust_still_good: current.product_metrics.trust_score >= 7,
    drawdown_not_worse_over_1pt: d.max_drawdown_nyra <= 1,
    capital_not_worse_over_5pct: current.final_output.final_capital_nyra >= previous.final_output.final_capital_nyra * 0.95,
    fees_not_worse: current.final_output.fees_total <= previous.final_output.fees_total,
    turnover_not_worse: current.final_output.turnover_annual <= previous.final_output.turnover_annual,
  };
}

function allPass(values: Record<string, boolean>): boolean {
  return Object.values(values).every(Boolean);
}

function score(candidate: CandidateRun): number {
  return (
    candidate.deltas_vs_previous.total_score * 10 +
    candidate.deltas_vs_previous.stability_score * 12 +
    Math.max(-candidate.deltas_vs_previous.rebalance_count, 0) * 1.5 +
    Math.max(-candidate.deltas_vs_previous.turnover_annual, 0) * 0.35 +
    Math.max(-candidate.deltas_vs_previous.fees_total, 0) * 0.004 +
    Math.min(candidate.deltas_vs_previous.final_capital_nyra, 0) * 0.001
  );
}

function runCycle(cycle: number, previous: CommercialReport): { cycle: number; previous_output: CommercialReport["final_output"]; candidates: CandidateRun[]; selected_policy: CommercialPolicy; selected?: CandidateRun; result: CommercialReport } {
  const candidates = POLICIES.map((policy) => {
    const report = runCommercial(policy);
    const candidate: CandidateRun = {
      policy,
      output: report.final_output,
      product_metrics: report.product_metrics,
      deltas_vs_previous: deltas(report, previous),
      guardrails: guardrails(report, previous),
      accepted: false,
    };
    candidate.accepted = allPass(candidate.guardrails);
    return candidate;
  });
  const selected = candidates.filter((candidate) => candidate.accepted).sort((a, b) => score(b) - score(a))[0];
  const selectedPolicy = selected?.policy ?? "none";
  const result = selected ? runCommercial(selected.policy) : runCommercial("none");
  writeFileSync(join(BUSINESS_REPORT_DIR, `nyra_commercialization_readiness_learning_cycle_${cycle}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return { cycle, previous_output: previous.final_output, candidates, selected_policy: selectedPolicy, selected, result };
}

function main(): void {
  mkdirSync(BUSINESS_REPORT_DIR, { recursive: true });
  mkdirSync(LEARNING_DIR, { recursive: true });
  mkdirSync(RUNTIME_LEARNING_DIR, { recursive: true });

  const baseline = runCommercial("none");
  writeFileSync(join(BUSINESS_REPORT_DIR, "nyra_commercialization_readiness_learning_cycle_0.json"), `${JSON.stringify(baseline, null, 2)}\n`);
  const cycles = [];
  let previous = baseline;
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const result = runCycle(cycle, previous);
    cycles.push(result);
    previous = result.result;
  }

  const final = cycles.at(-1)?.result ?? baseline;
  const report = {
    generated_at: new Date().toISOString(),
    runner: "nyra_commercial_learning_autopilot",
    mode: "three_cycle_sandbox_learning",
    stable_runtime_modified: false,
    baseline: baseline.final_output,
    cycles: cycles.map((cycle) => ({
      cycle: cycle.cycle,
      selected_policy: cycle.selected_policy,
      selected_deltas: cycle.selected?.deltas_vs_previous ?? null,
      selected_guardrails: cycle.selected?.guardrails ?? {},
      result_output: cycle.result.final_output,
      candidates: cycle.candidates,
    })),
    final_output: {
      baseline_total_score: baseline.final_output.total_score,
      final_total_score: final.final_output.total_score,
      total_score_delta: round(final.final_output.total_score - baseline.final_output.total_score, 4),
      baseline_stability_score: baseline.product_metrics.stability_score,
      final_stability_score: final.product_metrics.stability_score,
      stability_delta: round(final.product_metrics.stability_score - baseline.product_metrics.stability_score, 4),
      baseline_rebalance_count: baseline.final_output.rebalance_count,
      final_rebalance_count: final.final_output.rebalance_count,
      baseline_turnover_annual: baseline.final_output.turnover_annual,
      final_turnover_annual: final.final_output.turnover_annual,
      baseline_fees_total: baseline.final_output.fees_total,
      final_fees_total: final.final_output.fees_total,
      final_verdict: final.final_output.verdict,
      promoted_to_stable: false,
    },
  };

  const pack = {
    version: "nyra_commercial_learning_autopilot_pack_v1",
    generated_at: report.generated_at,
    selected_policies: cycles.map((cycle) => cycle.selected_policy),
    final_output: report.final_output,
    promotion_status: "not_promoted_to_runtime",
    boundaries: [
      "commercial sandbox only",
      "stable runtime unchanged",
      "candidate chosen by scoring and guardrails",
      "requires regression gate before stable promotion",
    ],
  };

  writeFileSync(OUTPUT_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUTPUT_PACK_PATH, `${JSON.stringify(pack, null, 2)}\n`);
  console.log(JSON.stringify({ report_path: OUTPUT_REPORT_PATH, pack_path: OUTPUT_PACK_PATH, final_output: report.final_output }, null, 2));
}

main();

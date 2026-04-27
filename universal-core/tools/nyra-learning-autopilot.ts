import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type DirtyDataReport = {
  final_output?: {
    main_bottleneck?: string;
    verdict?: string;
  };
  output?: {
    auto_selector?: DirtyMetrics;
    local_learning?: DirtyMetrics;
  };
};

type DirtyMetrics = {
  final_capital: number;
  max_drawdown: number;
  Sharpe: number;
  rebalance_count: number;
  fees_total: number;
  turnover_annual: number;
  false_overdrive_count: number;
  dirty_data_fallback_ok: boolean;
  anomalous_decisions: number;
  crash_unprotected_count: number;
  recovery_too_slow_count: number;
  verdict: "robust_to_dirty_data" | "partially_robust" | "fragile_to_dirty_data";
};

type AutopilotReport = {
  runner: "nyra_learning_autopilot";
  generated_at: string;
  mode: "local_sandbox_once";
  selected_bottleneck: string;
  selected_candidate: string;
  actions: string[];
  baseline?: DirtyMetrics;
  candidate?: DirtyMetrics;
  deltas?: Record<string, number>;
  pass_criteria: Record<string, boolean>;
  broad_verification?: {
    tests: Record<string, boolean>;
    promotion_eligible: boolean;
    reports: Record<string, string>;
  };
  assimilated: boolean;
  promoted_to_runtime: false;
  output_pack: string;
  verdict: "assimilated_local_learning" | "rejected_candidate" | "no_action";
  notes: string[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UC_ROOT = join(__dirname, "..");
const ROOT = join(UC_ROOT, "..");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "learning");
const FIN_REPORT_DIR = join(ROOT, "reports", "universal-core", "financial-core-test");
const RUNTIME_LEARNING_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const OUTPUT_REPORT_PATH = join(REPORT_DIR, "nyra_learning_autopilot_latest.json");
const OUTPUT_PACK_PATH = join(RUNTIME_LEARNING_DIR, "nyra_learning_autopilot_latest.json");
const DIRTY_REPORT_PATH = join(FIN_REPORT_DIR, "nyra_dirty_data_signal_failure_latest.json");
const VERIFICATION_REPORTS = {
  local_learning: join(FIN_REPORT_DIR, "nyra_local_learning_isolation_latest.json"),
  product_readiness: join(FIN_REPORT_DIR, "nyra_product_readiness_latest.json"),
  horizon_sweep: join(FIN_REPORT_DIR, "nyra_horizon_sweep_1_20_latest.json"),
  lateral: join(FIN_REPORT_DIR, "nyra_lateral_market_latest.json"),
  bubble: join(FIN_REPORT_DIR, "nyra_bubble_detection_latest.json"),
  healthy_bull: join(FIN_REPORT_DIR, "nyra_healthy_bull_euphoria_latest.json"),
};

const BROAD_VERIFICATION_TESTS = [
  ["local_learning", "tests/nyra-local-learning-isolation-test.ts"],
  ["product_readiness", "tests/nyra-product-readiness-test.ts"],
  ["horizon_sweep", "tests/nyra-horizon-sweep-1-20-test.ts"],
  ["lateral", "tests/nyra-lateral-market-test.ts"],
  ["bubble", "tests/nyra-bubble-detection-test.ts"],
  ["healthy_bull", "tests/nyra-healthy-bull-euphoria-test.ts"],
] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function runTest(testPath: string): string {
  return execFileSync(process.execPath, ["--experimental-strip-types", testPath], {
    cwd: UC_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function loadDirtyReport(): DirtyDataReport | undefined {
  if (!existsSync(DIRTY_REPORT_PATH)) return undefined;
  return readJson<DirtyDataReport>(DIRTY_REPORT_PATH);
}

function selectBottleneck(report: DirtyDataReport | undefined): string {
  const bottleneck = report?.final_output?.main_bottleneck;
  if (bottleneck && bottleneck !== "none") return bottleneck;
  if (report?.output?.auto_selector && report.output.auto_selector.turnover_annual > 150) return "turnover_above_150pct";
  if (report?.output?.auto_selector && report.output.auto_selector.rebalance_count > 15) return "rebalance_churn";
  return "dirty_data_churn_watch";
}

function scoreCandidate(auto: DirtyMetrics, local: DirtyMetrics): Record<string, boolean> {
  return {
    candidate_robust: local.verdict === "robust_to_dirty_data",
    capital_not_worse_over_5pct: local.final_capital >= auto.final_capital * 0.95,
    drawdown_not_worse: local.max_drawdown <= auto.max_drawdown + 0.01,
    fees_improved: local.fees_total <= auto.fees_total,
    turnover_under_150: local.turnover_annual < 150,
    rebalance_under_or_equal_15: local.rebalance_count <= 15,
    no_false_overdrive: local.false_overdrive_count === 0,
    no_anomalous_decisions: local.anomalous_decisions <= 2,
    missing_data_fallback_ok: local.dirty_data_fallback_ok,
    crash_still_protected: local.crash_unprotected_count === 0,
  };
}

function allPass(criteria: Record<string, boolean>): boolean {
  return Object.values(criteria).every(Boolean);
}

function hasObjectKey<T extends object>(value: T, key: PropertyKey): key is keyof T {
  return key in value;
}

function runBroadVerification(actions: string[]): AutopilotReport["broad_verification"] {
  for (const [, testPath] of BROAD_VERIFICATION_TESTS) {
    runTest(testPath);
    actions.push(`run:${testPath.replace("tests/", "").replace(".ts", "")}`);
  }

  const localLearning = readJson<{
    final_output?: { verdict?: string; contamination_detected?: boolean; laterale_improvement?: boolean };
  }>(VERIFICATION_REPORTS.local_learning);
  const productReadiness = readJson<{ final_output?: { total_score?: number; verdict?: string } }>(
    VERIFICATION_REPORTS.product_readiness,
  );
  const horizonSweep = readJson<{
    summary?: {
      capital_beats_qqq_count?: number;
      drawdown_better_count?: number;
      turnover_under_150_count?: number;
      horizons_tested?: number;
    };
  }>(VERIFICATION_REPORTS.horizon_sweep);
  const lateral = readJson<{
    metrics?: { beats_qqq?: boolean; max_drawdown_nyra_pct?: number; max_drawdown_qqq_pct?: number };
  }>(VERIFICATION_REPORTS.lateral);
  const bubble = readJson<{ verdict?: string; fail_count?: number }>(VERIFICATION_REPORTS.bubble);
  const healthyBull = readJson<{
    verdict?: string;
    fail_count?: number;
    metrics?: { bubble_awareness_downgrades?: number };
  }>(VERIFICATION_REPORTS.healthy_bull);

  const horizonTested = horizonSweep.summary?.horizons_tested ?? 20;
  const tests = {
    local_learning_safe:
      localLearning.final_output?.verdict === "safe_learning" &&
      localLearning.final_output.contamination_detected === false &&
      localLearning.final_output.laterale_improvement === true,
    product_not_broken:
      (productReadiness.final_output?.total_score ?? 0) >= 40 &&
      productReadiness.final_output?.verdict !== "non vendibile",
    horizon_not_broken:
      (horizonSweep.summary?.capital_beats_qqq_count ?? 0) >= 15 &&
      (horizonSweep.summary?.drawdown_better_count ?? 0) >= 15 &&
      (horizonSweep.summary?.turnover_under_150_count ?? 0) >= horizonTested - 1,
    lateral_passed:
      lateral.metrics?.beats_qqq === true &&
      (lateral.metrics?.max_drawdown_nyra_pct ?? Number.POSITIVE_INFINITY) < (lateral.metrics?.max_drawdown_qqq_pct ?? 0),
    bubble_passed: bubble.verdict === "vede la bolla" && (bubble.fail_count ?? 1) === 0,
    healthy_bull_preserved:
      healthyBull.verdict === "bull preserved" &&
      (healthyBull.fail_count ?? 1) === 0 &&
      (healthyBull.metrics?.bubble_awareness_downgrades ?? 1) === 0,
  };

  const reports: Record<string, string> = {};
  for (const [key] of BROAD_VERIFICATION_TESTS) {
    if (hasObjectKey(VERIFICATION_REPORTS, key)) reports[key] = VERIFICATION_REPORTS[key];
  }

  return {
    tests,
    promotion_eligible: allPass(tests),
    reports,
  };
}

function buildLearningPack(auto: DirtyMetrics, local: DirtyMetrics, bottleneck: string): unknown {
  return {
    version: "nyra_learning_autopilot_pack_v1",
    generated_at: new Date().toISOString(),
    domain: "financial_dirty_data_churn",
    bottleneck,
    assimilated_rule_status: "local_candidate_validated",
    promotion_status: "not_promoted_to_runtime",
    learned_rule: {
      id: "dirty_data_hold_non_protective_changes_v1",
      trigger: [
        "missing_data",
        "stale_signal",
        "false_price_spike",
        "contradictory_signals",
        "sensor_noise_financial",
      ],
      behavior: [
        "hold current allocation when data quality is unreliable and no real crash is present",
        "allow immediate protection when QQQ crash is real",
        "ignore residual allocation changes below 20% turnover in dirty-data mode",
        "never enter overdrive on false spike or contradictory signal",
      ],
      boundaries: [
        "local learning only",
        "does not modify Core",
        "does not modify stable selector",
        "requires anti-contamination tests before runtime promotion",
      ],
    },
    baseline_auto_selector: auto,
    learned_local_candidate: local,
    deltas: {
      final_capital: round(local.final_capital - auto.final_capital, 2),
      max_drawdown: round(local.max_drawdown - auto.max_drawdown, 4),
      Sharpe: round(local.Sharpe - auto.Sharpe, 4),
      rebalance_count: local.rebalance_count - auto.rebalance_count,
      fees_total: round(local.fees_total - auto.fees_total, 2),
      turnover_annual: round(local.turnover_annual - auto.turnover_annual, 4),
    },
    next_required_verification: [
      "nyra-local-learning-isolation-test.ts",
      "nyra-product-readiness-test.ts",
      "nyra-horizon-sweep-1-20-test.ts",
      "nyra-lateral-market-test.ts",
      "nyra-bubble-detection-test.ts",
      "nyra-healthy-bull-euphoria-test.ts",
    ],
  };
}

function buildVerifiedLearningPack(
  auto: DirtyMetrics,
  local: DirtyMetrics,
  bottleneck: string,
  broadVerification: NonNullable<AutopilotReport["broad_verification"]>,
): unknown {
  const pack = buildLearningPack(auto, local, bottleneck) as Record<string, unknown>;
  return {
    ...pack,
    broad_verification: broadVerification,
    promotion_status: broadVerification.promotion_eligible
      ? "eligible_after_broad_verification_not_auto_promoted"
      : "not_promoted_to_runtime",
  };
}

export function runNyraLearningAutopilotOnce(): AutopilotReport {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(RUNTIME_LEARNING_DIR, { recursive: true });

  const actions: string[] = [];
  const initialReport = loadDirtyReport();
  const selectedBottleneck = selectBottleneck(initialReport);
  const selectedCandidate = selectedBottleneck.includes("turnover") || selectedBottleneck.includes("churn") || selectedBottleneck.includes("dirty")
    ? "dirty_data_hold_non_protective_changes_v1"
    : "none";

  if (selectedCandidate === "none") {
    const report: AutopilotReport = {
      runner: "nyra_learning_autopilot",
      generated_at: new Date().toISOString(),
      mode: "local_sandbox_once",
      selected_bottleneck: selectedBottleneck,
      selected_candidate: selectedCandidate,
      actions,
      pass_criteria: {},
      assimilated: false,
      promoted_to_runtime: false,
      output_pack: OUTPUT_PACK_PATH,
      verdict: "no_action",
      notes: ["No supported local candidate for selected bottleneck."],
    };
    writeFileSync(OUTPUT_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  runTest("tests/nyra-dirty-data-signal-failure-test.ts");
  actions.push("run:nyra-dirty-data-signal-failure-test");

  const dirty = loadDirtyReport();
  const auto = dirty?.output?.auto_selector;
  const local = dirty?.output?.local_learning;
  if (!auto || !local) {
    const report: AutopilotReport = {
      runner: "nyra_learning_autopilot",
      generated_at: new Date().toISOString(),
      mode: "local_sandbox_once",
      selected_bottleneck: selectedBottleneck,
      selected_candidate: selectedCandidate,
      actions,
      pass_criteria: { report_valid: false },
      assimilated: false,
      promoted_to_runtime: false,
      output_pack: OUTPUT_PACK_PATH,
      verdict: "rejected_candidate",
      notes: ["Dirty-data report did not expose both auto_selector and local_learning metrics."],
    };
    writeFileSync(OUTPUT_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  const passCriteria = scoreCandidate(auto, local);
  const deltas = {
    final_capital: round(local.final_capital - auto.final_capital, 2),
    max_drawdown: round(local.max_drawdown - auto.max_drawdown, 4),
    Sharpe: round(local.Sharpe - auto.Sharpe, 4),
    rebalance_count: local.rebalance_count - auto.rebalance_count,
    fees_total: round(local.fees_total - auto.fees_total, 2),
    turnover_annual: round(local.turnover_annual - auto.turnover_annual, 4),
  };
  const assimilated = allPass(passCriteria);
  const broadVerification = assimilated ? runBroadVerification(actions) : undefined;
  if (assimilated) {
    const pack = broadVerification
      ? buildVerifiedLearningPack(auto, local, selectedBottleneck, broadVerification)
      : buildLearningPack(auto, local, selectedBottleneck);
    writeFileSync(OUTPUT_PACK_PATH, `${JSON.stringify(pack, null, 2)}\n`);
    actions.push("write:nyra_learning_autopilot_latest.json");
  }

  const report: AutopilotReport = {
    runner: "nyra_learning_autopilot",
    generated_at: new Date().toISOString(),
    mode: "local_sandbox_once",
    selected_bottleneck: selectedBottleneck,
    selected_candidate: selectedCandidate,
    actions,
    baseline: auto,
    candidate: local,
    deltas,
    pass_criteria: passCriteria,
    broad_verification: broadVerification,
    assimilated,
    promoted_to_runtime: false,
    output_pack: OUTPUT_PACK_PATH,
    verdict: assimilated ? "assimilated_local_learning" : "rejected_candidate",
    notes: assimilated
      ? [
          "Candidate improved dirty-data churn locally and passed local guardrails.",
          "Runtime selector was not modified.",
          "Promotion requires broader anti-contamination suite.",
        ]
      : ["Candidate failed at least one guardrail. No assimilation written."],
  };
  writeFileSync(OUTPUT_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function main(): void {
  const report = runNyraLearningAutopilotOnce();
  console.log(JSON.stringify({
    report_path: OUTPUT_REPORT_PATH,
    pack_path: OUTPUT_PACK_PATH,
    verdict: report.verdict,
    selected_bottleneck: report.selected_bottleneck,
    selected_candidate: report.selected_candidate,
    assimilated: report.assimilated,
    promoted_to_runtime: report.promoted_to_runtime,
    deltas: report.deltas,
    pass_criteria: report.pass_criteria,
  }, null, 2));
}

if (process.argv[1]?.endsWith("nyra-learning-autopilot.ts")) {
  main();
}

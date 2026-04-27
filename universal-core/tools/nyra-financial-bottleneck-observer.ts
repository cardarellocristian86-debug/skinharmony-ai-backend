import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";

type ProductReadinessReport = {
  final_output?: {
    final_capital?: number;
    fees?: number;
    drawdown?: number;
    total_score?: number;
    verdict?: string;
  };
  phase_behavior?: {
    bull?: { avg_cash_pct?: number; avg_risk_pct?: number };
    recovery?: { avg_cash_pct?: number; avg_risk_pct?: number };
    lateral?: { avg_cash_pct?: number; avg_risk_pct?: number };
  };
};

type LateralReport = {
  metrics?: {
    final_capital_nyra_eur?: number;
    total_fees_eur?: number;
    max_drawdown_nyra_pct?: number;
    cash_time_nyra_pct?: number;
    rebalance_count?: number;
  };
  pass?: {
    rebalance_contained?: boolean;
    fees_contained?: boolean;
    capital_stable?: boolean;
  };
};

type BubbleReport = {
  pass_count?: number;
  fail_count?: number;
  verdict?: string;
  strategies?: {
    Nyra_auto_selector?: {
      max_drawdown?: number;
      fees_total?: number;
    };
  };
};

type ObserverCase = {
  id: string;
  label: string;
  score: number;
  core_state: string;
  priority_score: number;
  risk_score: number;
  evidence: string[];
  recommended_domains: string[];
  recommended_actions: Array<"study" | "verify" | "exercise" | "runtime_integrate">;
  web_context_needed: boolean;
  slow_lane_only: boolean;
  recurrence_count?: number;
};

type ObserverHistoryEntry = {
  observed_at: string;
  active_case_id: string;
  active_case_score: number;
  capital_delta_vs_baseline: number;
  fees_delta_vs_baseline: number;
  drawdown_delta_vs_baseline: number;
  score_delta_vs_baseline: number;
  lateral_guard_intact: boolean;
  bubble_guard_intact: boolean;
};

type ObserverHistory = {
  version: "nyra_financial_bottleneck_history_v1";
  updated_at: string;
  entries: ObserverHistoryEntry[];
};

type ObserverReport = {
  runner: "nyra_financial_bottleneck_observer";
  generated_at: string;
  mode: "offline_slow_lane";
  source_reports: {
    latest_readiness?: string;
    baseline_readiness?: string;
    lateral?: string;
    bubble?: string;
  };
  metrics_snapshot: {
    capital_delta_vs_baseline: number;
    fees_delta_vs_baseline: number;
    drawdown_delta_vs_baseline: number;
    score_delta_vs_baseline: number;
    recovery_cash_pct: number;
    bull_cash_pct: number;
    lateral_guard_intact: boolean;
    bubble_guard_intact: boolean;
  };
  history_summary: {
    entries_total: number;
    active_case_recurrence: number;
    recurring_case_ids: string[];
  };
  active_case: ObserverCase;
  candidate_cases: ObserverCase[];
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const REPORTS_DIR = join(ROOT, "reports", "universal-core", "financial-core-test");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_financial_bottleneck_observer_latest.json");
const HISTORY_PATH = join(RUNTIME_DIR, "nyra_financial_bottleneck_history_latest.json");
const LATEST_READINESS_PATH = join(REPORTS_DIR, "nyra_product_readiness_latest.json");
const LATERAL_PATH = join(REPORTS_DIR, "nyra_lateral_market_latest.json");
const BUBBLE_PATH = join(REPORTS_DIR, "nyra_bubble_detection_latest.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function maybeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function loadHistory(): ObserverHistory {
  if (!existsSync(HISTORY_PATH)) {
    return {
      version: "nyra_financial_bottleneck_history_v1",
      updated_at: new Date(0).toISOString(),
      entries: [],
    };
  }
  return readJson<ObserverHistory>(HISTORY_PATH);
}

function persistHistory(history: ObserverHistory): void {
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function resolveLatestBaseline(): { file: string; path: string } | undefined {
  const backups = readdirSync(REPORTS_DIR)
    .filter((entry) => /^nyra_product_readiness_before_.*\.json$/i.test(entry))
    .map((entry) => ({
      file: entry,
      path: join(REPORTS_DIR, entry),
      mtimeMs: statSync(join(REPORTS_DIR, entry)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return backups[0];
}

function signal(id: string, category: string, normalized: number, expected: number, risk: number, friction: number): UniversalSignal {
  return {
    id,
    source: "nyra_financial_bottleneck_observer",
    category,
    label: category,
    value: normalized / 100,
    normalized_score: normalized,
    severity_hint: risk,
    confidence_hint: 84,
    reliability_hint: 82,
    friction_hint: friction,
    risk_hint: risk,
    reversibility_hint: Math.max(0, 100 - risk),
    expected_value_hint: expected,
    evidence: [{ label: category, value: normalized }],
    tags: ["financial_bottleneck_case"],
  };
}

function buildCase(
  id: string,
  label: string,
  evidence: string[],
  recommendedDomains: string[],
  recommendedActions: Array<"study" | "verify" | "exercise" | "runtime_integrate">,
  signals: UniversalSignal[],
): ObserverCase {
  const input: UniversalCoreInput = {
    request_id: `financial-bottleneck:${id}`,
    generated_at: new Date().toISOString(),
    domain: "custom",
    context: { mode: "nyra_financial_bottleneck_observer", metadata: { case_id: id } },
    signals,
    data_quality: {
      score: 88,
      completeness: 84,
      freshness: 82,
      consistency: 90,
      reliability: 86,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: false,
      max_control_level: "suggest",
      safety_mode: true,
    },
  };
  const core = runUniversalCore(input);
  const score = Number((core.priority.score - core.risk.score * 0.12 + signals.reduce((sum, entry) => sum + entry.normalized_score, 0) / Math.max(signals.length, 1) * 0.22).toFixed(6));
  return {
    id,
    label,
    score,
    core_state: core.state,
    priority_score: core.priority.score,
    risk_score: core.risk.score,
    evidence,
    recommended_domains: recommendedDomains,
    recommended_actions: recommendedActions,
    web_context_needed: true,
    slow_lane_only: true,
  };
}

export function runFinancialBottleneckObserver(): ObserverReport {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

  const latest = maybeStat(LATEST_READINESS_PATH)?.isFile() ? readJson<ProductReadinessReport>(LATEST_READINESS_PATH) : undefined;
  const baseline = resolveLatestBaseline();
  const previous = baseline ? readJson<ProductReadinessReport>(baseline.path) : undefined;
  const lateral = maybeStat(LATERAL_PATH)?.isFile() ? readJson<LateralReport>(LATERAL_PATH) : undefined;
  const bubble = maybeStat(BUBBLE_PATH)?.isFile() ? readJson<BubbleReport>(BUBBLE_PATH) : undefined;

  const capitalDelta = Number((((latest?.final_output?.final_capital ?? 0) - (previous?.final_output?.final_capital ?? 0))).toFixed(4));
  const feesDelta = Number((((latest?.final_output?.fees ?? 0) - (previous?.final_output?.fees ?? 0))).toFixed(4));
  const drawdownDelta = Number((((latest?.final_output?.drawdown ?? 0) - (previous?.final_output?.drawdown ?? 0))).toFixed(4));
  const scoreDelta = Number((((latest?.final_output?.total_score ?? 0) - (previous?.final_output?.total_score ?? 0))).toFixed(4));
  const recoveryCash = latest?.phase_behavior?.recovery?.avg_cash_pct ?? 0;
  const bullCash = latest?.phase_behavior?.bull?.avg_cash_pct ?? 0;
  const lateralGuardIntact = Boolean(lateral?.pass?.rebalance_contained && lateral?.pass?.fees_contained && lateral?.pass?.capital_stable);
  const bubbleGuardIntact = Boolean((bubble?.pass_count ?? 0) >= 6 && (bubble?.fail_count ?? 0) === 0);

  const candidateCases: ObserverCase[] = [];

  candidateCases.push(
    buildCase(
      "aggressive_release_not_sellable",
      "Aggressive release improved capital but hurt sellability",
      [
        `capital_delta=${capitalDelta}`,
        `fees_delta=${feesDelta}`,
        `drawdown_delta=${drawdownDelta}`,
        `score_delta=${scoreDelta}`,
      ],
      ["finance_macro", "risk_management", "execution", "regime_detection"],
      ["study", "exercise", "exercise", "study"],
      [
        signal("capital_jump", "capital_jump", clamp(50 + Math.max(0, capitalDelta) / 2000), 72, 28, 18),
        signal("fee_expansion", "fee_expansion", clamp(50 + Math.max(0, feesDelta) / 120), 22, clamp(50 + Math.max(0, feesDelta) / 120), 28),
        signal("drawdown_expansion", "drawdown_expansion", clamp(50 + Math.max(0, drawdownDelta) * 8), 26, clamp(50 + Math.max(0, drawdownDelta) * 8), 22),
        signal("sellability_drop", "sellability_drop", clamp(50 + Math.max(0, -scoreDelta) * 12), 20, clamp(50 + Math.max(0, -scoreDelta) * 12), 20),
      ],
    ),
  );

  candidateCases.push(
    buildCase(
      "under_release_in_recovery",
      "Recovery release still too conservative",
      [
        `recovery_cash_pct=${recoveryCash}`,
        `bull_cash_pct=${bullCash}`,
        `capital_delta=${capitalDelta}`,
      ],
      ["regime_detection", "finance_macro", "execution", "risk_management"],
      ["study", "study", "exercise", "verify"],
      [
        signal("recovery_cash", "recovery_cash", clamp(recoveryCash), 18, 24, 16),
        signal("bull_cash", "bull_cash", clamp(bullCash), 16, 20, 14),
        signal("capital_lag", "capital_lag", clamp(50 + Math.max(0, -capitalDelta) / 2000), 20, 24, 16),
      ],
    ),
  );

  candidateCases.push(
    buildCase(
      "guardrails_preserve_then_refine",
      "Guardrails are intact, refine slowly without breaking defense",
      [
        `lateral_guard_intact=${lateralGuardIntact}`,
        `bubble_guard_intact=${bubbleGuardIntact}`,
        `lateral_fees=${lateral?.metrics?.total_fees_eur ?? 0}`,
      ],
      ["risk_management", "execution", "finance_macro"],
      ["verify", "exercise", "study"],
      [
        signal("lateral_guard", "lateral_guard", lateralGuardIntact ? 78 : 35, 78, 18, 18),
        signal("bubble_guard", "bubble_guard", bubbleGuardIntact ? 82 : 28, 82, 20, 18),
        signal("low_churn_need", "low_churn_need", clamp(50 + ((lateral?.metrics?.rebalance_count ?? 0) <= 3 ? 18 : 0)), 68, 18, 14),
      ],
    ),
  );

  const sorted = candidateCases.sort((a, b) => b.score - a.score);
  const history = loadHistory();
  const historyEntry: ObserverHistoryEntry = {
    observed_at: new Date().toISOString(),
    active_case_id: sorted[0]!.id,
    active_case_score: sorted[0]!.score,
    capital_delta_vs_baseline: capitalDelta,
    fees_delta_vs_baseline: feesDelta,
    drawdown_delta_vs_baseline: drawdownDelta,
    score_delta_vs_baseline: scoreDelta,
    lateral_guard_intact: lateralGuardIntact,
    bubble_guard_intact: bubbleGuardIntact,
  };
  const recentEntries = [...history.entries, historyEntry].slice(-120);
  const recurrenceById = new Map<string, number>();
  for (const entry of recentEntries) {
    recurrenceById.set(entry.active_case_id, (recurrenceById.get(entry.active_case_id) ?? 0) + 1);
  }
  const recurringCaseIds = [...recurrenceById.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const activeRecurrence = recurrenceById.get(sorted[0]!.id) ?? 1;
  const enrichedSorted = sorted.map((entry) => ({
    ...entry,
    recurrence_count: recurrenceById.get(entry.id) ?? 0,
  }));
  persistHistory({
    version: "nyra_financial_bottleneck_history_v1",
    updated_at: historyEntry.observed_at,
    entries: recentEntries,
  });

  const report: ObserverReport = {
    runner: "nyra_financial_bottleneck_observer",
    generated_at: new Date().toISOString(),
    mode: "offline_slow_lane",
    source_reports: {
      latest_readiness: existsSync(LATEST_READINESS_PATH) ? "nyra_product_readiness_latest.json" : undefined,
      baseline_readiness: baseline?.file,
      lateral: existsSync(LATERAL_PATH) ? "nyra_lateral_market_latest.json" : undefined,
      bubble: existsSync(BUBBLE_PATH) ? "nyra_bubble_detection_latest.json" : undefined,
    },
    metrics_snapshot: {
      capital_delta_vs_baseline: capitalDelta,
      fees_delta_vs_baseline: feesDelta,
      drawdown_delta_vs_baseline: drawdownDelta,
      score_delta_vs_baseline: scoreDelta,
      recovery_cash_pct: recoveryCash,
      bull_cash_pct: bullCash,
      lateral_guard_intact: lateralGuardIntact,
      bubble_guard_intact: bubbleGuardIntact,
    },
    history_summary: {
      entries_total: recentEntries.length,
      active_case_recurrence: activeRecurrence,
      recurring_case_ids: recurringCaseIds,
    },
    active_case: enrichedSorted[0]!,
    candidate_cases: enrichedSorted,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1]?.endsWith("nyra-financial-bottleneck-observer.ts")) {
  const report = runFinancialBottleneckObserver();
  console.log(JSON.stringify({
    ok: true,
    output_path: OUTPUT_PATH,
    active_case: report.active_case.id,
    score: report.active_case.score,
  }, null, 2));
}

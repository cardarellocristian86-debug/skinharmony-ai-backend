import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";
import {
  buildSelectorAutowritePolicy,
  type SelectorAutowritePolicy,
} from "./nyra-selector-autowrite.ts";

type PolicyCandidate = {
  id: string;
  label: string;
  description: string;
  capital_gain_bias: number;
  fee_bias: number;
  drawdown_bias: number;
  stability_bias: number;
  policy: SelectorAutowritePolicy;
};

type PolicyLabReport = {
  runner: "nyra_selector_policy_lab";
  generated_at: string;
  readiness_context?: {
    latest_report: string;
    baseline_report: string;
    delta: {
      capital: number;
      fees: number;
      drawdown: number;
      total_score: number;
    };
  };
  candidates: Array<{
    id: string;
    label: string;
    description: string;
    score: number;
    core_state: string;
    core_risk: number;
    selected: boolean;
  }>;
  winner: {
    id: string;
    label: string;
    score: number;
  };
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const POLICY_OUTPUT_PATH = join(RUNTIME_DIR, "nyra_selector_autowrite_policy_latest.json");
const FINANCIAL_REPORTS_DIR = join(ROOT, "reports", "universal-core", "financial-core-test");
const REPORT_PATH = join(FINANCIAL_REPORTS_DIR, "nyra_selector_policy_lab_latest.json");
const PRODUCT_READINESS_LATEST_PATH = join(FINANCIAL_REPORTS_DIR, "nyra_product_readiness_latest.json");

type ProductReadinessReport = {
  final_output?: {
    final_capital?: number;
    fees?: number;
    drawdown?: number;
    total_score?: number;
  };
};

type ReadinessDeltaContext = {
  latestReport: string;
  baselineReport: string;
  delta: {
    capital: number;
    fees: number;
    drawdown: number;
    totalScore: number;
  };
};

function signal(id: string, category: string, normalized: number, expected: number, risk: number, friction: number): UniversalSignal {
  return {
    id,
    source: "nyra_selector_policy_lab",
    category,
    label: category,
    value: normalized / 100,
    normalized_score: normalized,
    severity_hint: risk,
    confidence_hint: 82,
    reliability_hint: 80,
    friction_hint: friction,
    risk_hint: risk,
    reversibility_hint: Math.max(0, 100 - risk),
    expected_value_hint: expected,
    evidence: [{ label: category, value: normalized }],
    tags: ["selector_policy_candidate"],
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function resolveReadinessDeltaContext(): ReadinessDeltaContext | undefined {
  if (!statSafe(PRODUCT_READINESS_LATEST_PATH)?.isFile()) return undefined;

  const backups = readdirSync(FINANCIAL_REPORTS_DIR)
    .filter((entry) => /^nyra_product_readiness_before_.*\.json$/i.test(entry))
    .map((entry) => ({
      entry,
      path: join(FINANCIAL_REPORTS_DIR, entry),
      mtime: statSync(join(FINANCIAL_REPORTS_DIR, entry)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  const baseline = backups[0];
  if (!baseline) return undefined;

  const latest = readJson<ProductReadinessReport>(PRODUCT_READINESS_LATEST_PATH);
  const previous = readJson<ProductReadinessReport>(baseline.path);
  return {
    latestReport: "nyra_product_readiness_latest.json",
    baselineReport: baseline.entry,
    delta: {
      capital: Number(((latest.final_output?.final_capital ?? 0) - (previous.final_output?.final_capital ?? 0)).toFixed(4)),
      fees: Number(((latest.final_output?.fees ?? 0) - (previous.final_output?.fees ?? 0)).toFixed(4)),
      drawdown: Number(((latest.final_output?.drawdown ?? 0) - (previous.final_output?.drawdown ?? 0)).toFixed(4)),
      totalScore: Number(((latest.final_output?.total_score ?? 0) - (previous.final_output?.total_score ?? 0)).toFixed(4)),
    },
  };
}

function statSafe(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function buildCandidates(base: SelectorAutowritePolicy): PolicyCandidate[] {
  const makePolicy = (scale: {
    upgrade: number;
    downgrade: number;
    breakout: number;
    edge: number;
    partial: number;
  }): SelectorAutowritePolicy => ({
    ...base,
    generated_at: new Date().toISOString(),
    params: {
      ...base.params,
      upgrade_threshold_delta: Number((base.params.upgrade_threshold_delta * scale.upgrade).toFixed(6)),
      downgrade_threshold_delta: Number((base.params.downgrade_threshold_delta * scale.downgrade).toFixed(6)),
      breakout_qqq1m_delta: Number((base.params.breakout_qqq1m_delta * scale.breakout).toFixed(6)),
      breakout_spy1m_delta: Number((base.params.breakout_spy1m_delta * scale.breakout).toFixed(6)),
      breakout_policy_floor_delta: Number((base.params.breakout_policy_floor_delta * scale.breakout).toFixed(6)),
      recovery_break_max_delta: Number((base.params.recovery_break_max_delta * scale.breakout).toFixed(6)),
      recovery_regime_max_delta: Number((base.params.recovery_regime_max_delta * scale.breakout).toFixed(6)),
      min_expected_edge_multiplier: Number((base.params.min_expected_edge_multiplier * scale.edge).toFixed(6)),
      partial_rebalance_amount_delta: Number((base.params.partial_rebalance_amount_delta * scale.partial).toFixed(6)),
    },
  });

  return [
    {
      id: "conservative_hold",
      label: "Conservative Hold",
      description: "liberta minima, piu protezione di fee e drawdown",
      capital_gain_bias: 42,
      fee_bias: 20,
      drawdown_bias: 18,
      stability_bias: 88,
      policy: makePolicy({ upgrade: 0.35, downgrade: 1.2, breakout: 0.35, edge: 1.1, partial: 0.2 }),
    },
    {
      id: "measured_release_lite",
      label: "Measured Release Lite",
      description: "release prudente, orientata a fee piu basse",
      capital_gain_bias: 56,
      fee_bias: 32,
      drawdown_bias: 28,
      stability_bias: 82,
      policy: makePolicy({ upgrade: 0.6, downgrade: 1.05, breakout: 0.6, edge: 1.02, partial: 0.5 }),
    },
    {
      id: "measured_release_balanced",
      label: "Measured Release Balanced",
      description: "equilibrio tra capitale, fee e drawdown",
      capital_gain_bias: 72,
      fee_bias: 48,
      drawdown_bias: 40,
      stability_bias: 74,
      policy: makePolicy({ upgrade: 0.85, downgrade: 0.95, breakout: 0.85, edge: 0.96, partial: 0.82 }),
    },
    {
      id: "fee_disciplined_release",
      label: "Fee Disciplined Release",
      description: "rilascio selettivo con freno esplicito su edge e turnover",
      capital_gain_bias: 66,
      fee_bias: 36,
      drawdown_bias: 34,
      stability_bias: 79,
      policy: makePolicy({ upgrade: 0.7, downgrade: 1.0, breakout: 0.72, edge: 1.04, partial: 0.62 }),
    },
    {
      id: "aggressive_release",
      label: "Aggressive Release",
      description: "massimizza il recupero del capitale, ma accetta piu costo e drawdown",
      capital_gain_bias: 86,
      fee_bias: 72,
      drawdown_bias: 66,
      stability_bias: 54,
      policy: makePolicy({ upgrade: 1.15, downgrade: 0.82, breakout: 1.18, edge: 0.88, partial: 1.2 }),
    },
  ];
}

function evaluateCandidate(candidate: PolicyCandidate, readinessContext?: ReadinessDeltaContext) {
  const scorePressure = readinessContext
    ? {
        capitalRecoveryNeed: clampScore(50 + Math.max(0, -readinessContext.delta.capital) / 2000),
        feeDisciplineNeed: clampScore(50 + Math.max(0, readinessContext.delta.fees) / 120),
        drawdownDisciplineNeed: clampScore(50 + Math.max(0, readinessContext.delta.drawdown) * 8),
        sellabilityNeed: clampScore(50 + Math.max(0, -readinessContext.delta.totalScore) * 12),
      }
    : undefined;

  const adjustedCapitalBias = readinessContext
    ? clampScore(candidate.capital_gain_bias + (scorePressure!.capitalRecoveryNeed - 50) * 0.35)
    : candidate.capital_gain_bias;
  const adjustedFeeBias = readinessContext
    ? clampScore(candidate.fee_bias + (scorePressure!.feeDisciplineNeed - 50) * 0.45)
    : candidate.fee_bias;
  const adjustedDrawdownBias = readinessContext
    ? clampScore(candidate.drawdown_bias + (scorePressure!.drawdownDisciplineNeed - 50) * 0.45)
    : candidate.drawdown_bias;
  const adjustedStabilityBias = readinessContext
    ? clampScore(candidate.stability_bias + (scorePressure!.sellabilityNeed - 50) * 0.30)
    : candidate.stability_bias;

  const input: UniversalCoreInput = {
    request_id: `selector-policy:${candidate.id}`,
    generated_at: new Date().toISOString(),
    domain: "custom",
    context: {
      mode: "nyra_selector_self_governance",
      metadata: {
        candidate_id: candidate.id,
      },
    },
    signals: [
      signal(`${candidate.id}:capital_capture`, "capital_capture", adjustedCapitalBias, adjustedCapitalBias, 28, 18),
      signal(`${candidate.id}:fee_drag`, "fee_drag", adjustedFeeBias, 20, adjustedFeeBias, adjustedFeeBias),
      signal(`${candidate.id}:drawdown_expansion`, "drawdown_expansion", adjustedDrawdownBias, 18, adjustedDrawdownBias, 24),
      signal(`${candidate.id}:stability_preservation`, "stability_preservation", adjustedStabilityBias, adjustedStabilityBias, 16, 14),
      ...(scorePressure
        ? [
            signal(`${candidate.id}:sellability_gap`, "sellability_gap", scorePressure.sellabilityNeed, 72, 22, 18),
            signal(`${candidate.id}:fee_discipline_need`, "fee_discipline_need", scorePressure.feeDisciplineNeed, 70, 24, 20),
            signal(`${candidate.id}:drawdown_discipline_need`, "drawdown_discipline_need", scorePressure.drawdownDisciplineNeed, 68, 24, 18),
          ]
        : []),
    ],
    data_quality: {
      score: 86,
      completeness: 84,
      freshness: 82,
      consistency: 88,
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
  const score = Number(
    (
      (adjustedCapitalBias * 0.42 + adjustedStabilityBias * 0.24) -
      (adjustedFeeBias * 0.16 + adjustedDrawdownBias * 0.18) +
      (scorePressure
        ? ((scorePressure.sellabilityNeed - adjustedFeeBias) * 0.08 + (scorePressure.drawdownDisciplineNeed - adjustedDrawdownBias) * 0.08)
        : 0) +
      core.priority.score * 0.18 -
      core.risk.score * 0.12
    ).toFixed(6)
  );
  return { core, score };
}

export function runSelectorPolicyLab(): {
  winner: SelectorAutowritePolicy;
  report: PolicyLabReport;
} {
  const base = buildSelectorAutowritePolicy();
  const candidates = buildCandidates(base);
  const readinessContext = resolveReadinessDeltaContext();
  const evaluations = candidates.map((candidate) => {
    const result = evaluateCandidate(candidate, readinessContext);
    return { candidate, ...result };
  }).sort((a, b) => b.score - a.score);

  const winner = evaluations[0]!;
  mkdirSync(dirname(POLICY_OUTPUT_PATH), { recursive: true });
  writeFileSync(POLICY_OUTPUT_PATH, JSON.stringify(winner.candidate.policy, null, 2));

  const report: PolicyLabReport = {
    runner: "nyra_selector_policy_lab",
    generated_at: new Date().toISOString(),
    readiness_context: readinessContext
      ? {
          latest_report: readinessContext.latestReport,
          baseline_report: readinessContext.baselineReport,
          delta: {
            capital: readinessContext.delta.capital,
            fees: readinessContext.delta.fees,
            drawdown: readinessContext.delta.drawdown,
            total_score: readinessContext.delta.totalScore,
          },
        }
      : undefined,
    candidates: evaluations.map((entry) => ({
      id: entry.candidate.id,
      label: entry.candidate.label,
      description: entry.candidate.description,
      score: entry.score,
      core_state: entry.core.state,
      core_risk: entry.core.risk.score,
      selected: entry.candidate.id === winner.candidate.id,
    })),
    winner: {
      id: winner.candidate.id,
      label: winner.candidate.label,
      score: winner.score,
    },
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  return { winner: winner.candidate.policy, report };
}

if (process.argv[1]?.endsWith("nyra-selector-policy-lab.ts")) {
  const result = runSelectorPolicyLab();
  console.log(JSON.stringify({
    ok: true,
    winner: result.report.winner,
    report_path: REPORT_PATH,
    policy_path: POLICY_OUTPUT_PATH,
  }, null, 2));
}

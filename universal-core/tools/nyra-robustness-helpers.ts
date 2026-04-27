import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";
import { runNyraFinancialWithAdvisory } from "./nyra-financial-advisory-overlay.ts";
import { chooseNyraRiskProfileAllocation } from "./nyra-risk-profile-policy.ts";
import {
  chooseNyraManagedAllocation,
  type NyraAutoDriveProfile,
} from "./nyra-auto-profile-selector.ts";

type ExtendedAssetSymbol = "SPY" | "QQQ" | "BTC" | "GLD" | "TLT" | "CASH";
type ExtendedAllocation = Record<ExtendedAssetSymbol, number>;
type HistoryMap = Record<ExtendedAssetSymbol, number[]>;

export type ReplayPoint = {
  date: string;
  qqq_return_pct: number;
};

export type ReplayHistoryRow = {
  date: string;
  qqq_return_pct: number;
  qqq_capital: number;
  nyra_capital: number;
  nyra_qqq_weight: number;
  nyra_cash_weight: number;
  core_state: string;
  advisory_alert: "watch" | "high" | "critical";
  intensity: "low" | "moderate" | "high";
  strategy: string;
  fee: number;
  slippage: number;
  rebalance_done: boolean;
};

export type ReplayMetrics = {
  final_capital_nyra_eur: number;
  final_capital_qqq_eur: number;
  total_return_nyra_pct: number;
  total_return_qqq_pct: number;
  cagr_nyra_pct: number;
  cagr_qqq_pct: number;
  max_drawdown_nyra_pct: number;
  max_drawdown_qqq_pct: number;
  annualized_volatility_nyra_pct: number;
  annualized_volatility_qqq_pct: number;
  sharpe_nyra: number;
  sharpe_qqq: number;
  negative_months_nyra: number;
  negative_months_qqq: number;
  max_recovery_months_nyra: number;
  max_recovery_months_qqq: number;
  cash_time_nyra_pct: number;
  total_fees_eur: number;
  total_slippage_eur: number;
  rebalance_count: number;
  beats_qqq: boolean;
  capital_difference_eur: number;
  drawdown_avoided_pct: number;
};

const ROOT = process.cwd();

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function calculateMaxDrawdown(values: number[]): number {
  let peak = values[0] ?? 100_000;
  let maxDrawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, (value - peak) / peak);
  }
  return Math.abs(maxDrawdown) * 100;
}

function calculateMaxRecoveryMonths(values: number[]): number {
  let peak = values[0] ?? 100_000;
  let activeRecovery = 0;
  let maxRecovery = 0;
  for (const value of values) {
    if (value < peak) {
      activeRecovery += 1;
      maxRecovery = Math.max(maxRecovery, activeRecovery);
    } else {
      peak = value;
      activeRecovery = 0;
    }
  }
  return maxRecovery;
}

function calculateSharpe(monthlyReturnsPct: number[]): number {
  const monthlyDecimals = monthlyReturnsPct.map((value) => value / 100);
  const mean = average(monthlyDecimals);
  const volatility = std(monthlyDecimals);
  if (volatility === 0) return 0;
  return round((mean / volatility) * Math.sqrt(12), 6);
}

function signal(id: string, category: string, value01: number): UniversalSignal {
  return {
    id,
    source: "nyra_robustness_helpers",
    category,
    label: category,
    value: value01,
    normalized_score: value01 * 100,
    severity_hint: value01 * 100,
    confidence_hint: 84,
    reliability_hint: 82,
    risk_hint: value01 * 100,
    reversibility_hint: 100 - value01 * 55,
    expected_value_hint: 100 - value01 * 35,
    tags: ["nyra-robustness", category],
  };
}

function buildCoreInput(month: string, history: HistoryMap, currentReturns: Record<ExtendedAssetSymbol, number>): UniversalCoreInput {
  const qqq1m = currentReturns.QQQ;
  const qqq3m = average(history.QQQ.slice(-3));
  const qqq6m = average(history.QQQ.slice(-6));
  const equityVol3m = std(history.QQQ.slice(-3));
  const growthSignal = clamp(0.5 + qqq6m / 18);
  const marketStress = clamp(Math.max(-qqq1m, 0) / 10 + equityVol3m / 10 + (qqq1m < -6 ? 0.22 : 0));
  const volatility = clamp(equityVol3m / 12 + Math.abs(qqq1m) / 15);
  const liquidity = clamp(0.55 - marketStress * 0.25);
  const policySupport = clamp(Math.max(-qqq1m, 0) < 1.5 && qqq3m > -2 ? 0.08 : 0);
  const growthShock = clamp(1 - growthSignal);
  const liquidityStress = clamp(marketStress * 0.55 + volatility * 0.2);
  const marketRebound = clamp((qqq1m > 0 && qqq3m > -1 ? qqq1m / 10 : 0) + (qqq3m > 0 ? 0.15 : 0));
  const bubbleEuphoria = clamp(Math.max(qqq6m, 0) / 16 - marketStress * 0.45 - volatility * 0.25);
  const marketDislocation = clamp(marketStress * 0.72 + volatility * 0.28);

  return {
    request_id: `nyra-robustness:${month}`,
    generated_at: `${month}T00:00:00.000Z`,
    domain: "assistant",
    context: {
      mode: "nyra_robustness_validation",
      metadata: {
        checkpoint: month,
      },
    },
    signals: [
      signal(`${month}:growth`, "growth_signal", growthSignal),
      signal(`${month}:liquidity`, "liquidity", liquidity),
      signal(`${month}:market_stress`, "market_stress", marketStress),
      signal(`${month}:volatility`, "volatility", volatility),
      signal(`${month}:policy_support`, "policy_support", policySupport),
      signal(`${month}:growth_shock`, "growth_shock", growthShock),
      signal(`${month}:liquidity_stress`, "liquidity_stress", liquidityStress),
      signal(`${month}:market_rebound`, "market_rebound", marketRebound),
      signal(`${month}:bubble_euphoria`, "bubble_euphoria", bubbleEuphoria),
      signal(`${month}:market_dislocation`, "market_dislocation", marketDislocation),
    ],
    data_quality: {
      score: 80,
      completeness: 80,
      freshness: 80,
      consistency: 82,
      reliability: 78,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: true,
      max_control_level: "confirm",
      safety_mode: true,
    },
  };
}

function adaptHardToQqqCash(allocation: ExtendedAllocation): { QQQ: number; CASH: number } {
  const qqqWeight = clamp(allocation.SPY + allocation.QQQ + allocation.BTC, 0, 1);
  return {
    QQQ: round(qqqWeight, 6),
    CASH: round(1 - qqqWeight, 6),
  };
}

function adaptQqqCashToExtended(allocation: { QQQ: number; CASH: number }): ExtendedAllocation {
  return {
    SPY: 0,
    QQQ: allocation.QQQ,
    BTC: 0,
    GLD: 0,
    TLT: 0,
    CASH: allocation.CASH,
  };
}

function monthlyPortfolioReturnPct(weightQqq: number, qqqReturnPct: number): number {
  return weightQqq * qqqReturnPct;
}

export function generateMonthlyDates(startYear: number, years: number): string[] {
  const dates: string[] = [];
  for (let year = startYear; year < startYear + years; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      dates.push(`${year}-${String(month).padStart(2, "0")}-01`);
    }
  }
  return dates;
}

export function createDeterministicNoiseSeries(startYear: number, years: number, seed = 20260424): ReplayPoint[] {
  let state = seed >>> 0;
  const nextUniform = (): number => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const nextNormalPct = (): number => {
    const u1 = Math.max(nextUniform(), 1e-12);
    const u2 = nextUniform();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z;
  };
  return generateMonthlyDates(startYear, years).map((date) => ({
    date,
    qqq_return_pct: round(nextNormalPct(), 6),
  }));
}

export function createLateralSeries(startYear: number, years: number): ReplayPoint[] {
  const pattern = [5, -5, 3, -4];
  return generateMonthlyDates(startYear, years).map((date, index) => ({
    date,
    qqq_return_pct: pattern[index % pattern.length]!,
  }));
}

function deriveReturnsFromCapitalPath(rows: Array<{ date: string; nyra_value?: number; portfolio_value?: number; qqq_value: number }>, valueKey: "nyra_value" | "portfolio_value"): Array<{ date: string; nyra_return_pct: number; qqq_return_pct: number }> {
  const points: Array<{ date: string; nyra_return_pct: number; qqq_return_pct: number }> = [];
  let previousNyra = 100_000;
  let previousQqq = 100_000;
  for (const row of rows) {
    const nyraValue = row[valueKey]!;
    const qqqValue = row.qqq_value;
    points.push({
      date: row.date,
      nyra_return_pct: round(((nyraValue / previousNyra) - 1) * 100, 6),
      qqq_return_pct: round(((qqqValue / previousQqq) - 1) * 100, 6),
    });
    previousNyra = nyraValue;
    previousQqq = qqqValue;
  }
  return points;
}

export function loadStitchedNyraOutOfSample2010To2024(): {
  period: { from: string; to: string };
  qqq_returns: ReplayPoint[];
  nyra_returns: Array<{ date: string; nyra_return_pct: number; qqq_return_pct: number }>;
} {
  const longCycle = JSON.parse(
    readFileSync(join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_vs_qqq_2000_2020_long_cycle_latest.json"), "utf8"),
  ) as { history: Array<{ date: string; nyra_value: number; qqq_value: number }> };
  const tenYear = JSON.parse(
    readFileSync(join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_vs_qqq_10y_real_replay_latest.json"), "utf8"),
  ) as { profiles: Array<{ profile: string; history: Array<{ date: string; portfolio_value: number; qqq_value: number }> }> };

  const longPart = deriveReturnsFromCapitalPath(
    longCycle.history.filter((row) => row.date >= "2010-01-01" && row.date <= "2020-12-01"),
    "nyra_value",
  );
  const hardHistory = tenYear.profiles.find((entry) => entry.profile === "hard_growth")?.history ?? [];
  const latePart = deriveReturnsFromCapitalPath(
    hardHistory.filter((row) => row.date >= "2021-01-01" && row.date <= "2024-12-01"),
    "portfolio_value",
  );

  const nyraReturns = [...longPart, ...latePart];
  const qqqReturns = nyraReturns.map((row) => ({ date: row.date, qqq_return_pct: row.qqq_return_pct }));

  return {
    period: {
      from: nyraReturns[0]!.date,
      to: nyraReturns.at(-1)!.date,
    },
    qqq_returns: qqqReturns,
    nyra_returns: nyraReturns,
  };
}

export function computeMetricsFromReturns(
  nyraReturnsPct: number[],
  qqqReturnsPct: number[],
  nyraPath: number[],
  qqqPath: number[],
  cashMonths: number,
  totalMonths: number,
  totalFees: number,
  totalSlippage: number,
  rebalanceCount: number,
): ReplayMetrics {
  const years = totalMonths / 12;
  const finalNyra = nyraPath.at(-1) ?? 100_000;
  const finalQqq = qqqPath.at(-1) ?? 100_000;

  return {
    final_capital_nyra_eur: round(finalNyra, 2),
    final_capital_qqq_eur: round(finalQqq, 2),
    total_return_nyra_pct: round(((finalNyra / 100_000) - 1) * 100, 4),
    total_return_qqq_pct: round(((finalQqq / 100_000) - 1) * 100, 4),
    cagr_nyra_pct: round((Math.pow(finalNyra / 100_000, 1 / years) - 1) * 100, 6),
    cagr_qqq_pct: round((Math.pow(finalQqq / 100_000, 1 / years) - 1) * 100, 6),
    max_drawdown_nyra_pct: round(calculateMaxDrawdown(nyraPath), 4),
    max_drawdown_qqq_pct: round(calculateMaxDrawdown(qqqPath), 4),
    annualized_volatility_nyra_pct: round(std(nyraReturnsPct) * Math.sqrt(12), 4),
    annualized_volatility_qqq_pct: round(std(qqqReturnsPct) * Math.sqrt(12), 4),
    sharpe_nyra: calculateSharpe(nyraReturnsPct),
    sharpe_qqq: calculateSharpe(qqqReturnsPct),
    negative_months_nyra: nyraReturnsPct.filter((value) => value < 0).length,
    negative_months_qqq: qqqReturnsPct.filter((value) => value < 0).length,
    max_recovery_months_nyra: calculateMaxRecoveryMonths(nyraPath),
    max_recovery_months_qqq: calculateMaxRecoveryMonths(qqqPath),
    cash_time_nyra_pct: round((cashMonths / totalMonths) * 100, 4),
    total_fees_eur: round(totalFees, 2),
    total_slippage_eur: round(totalSlippage, 2),
    rebalance_count: rebalanceCount,
    beats_qqq: finalNyra > finalQqq,
    capital_difference_eur: round(finalNyra - finalQqq, 2),
    drawdown_avoided_pct: round(calculateMaxDrawdown(qqqPath) - calculateMaxDrawdown(nyraPath), 4),
  };
}

export function runNyraSyntheticReplay(
  points: ReplayPoint[],
  options?: {
    initialCapital?: number;
    feeRate?: number;
    slippageRate?: number;
    delayFraction?: number;
    mode?: "hard_growth" | "auto";
  },
): { metrics: ReplayMetrics; history: ReplayHistoryRow[] } {
  const initialCapital = options?.initialCapital ?? 100_000;
  const feeRate = options?.feeRate ?? 0.001;
  const slippageRate = options?.slippageRate ?? 0;
  const delayFraction = options?.delayFraction ?? 0;
  const mode = options?.mode ?? "hard_growth";

  let nyraCapital = initialCapital;
  let qqqCapital = initialCapital;
  let currentAllocation = mode === "auto" ? { QQQ: 0.2, CASH: 0.8 } : { QQQ: 0.68, CASH: 0.32 };
  let pendingAllocation = currentAllocation;
  let previousFullAllocation: ExtendedAllocation | null =
    mode === "auto"
      ? {
          SPY: 0.12,
          QQQ: 0.08,
          BTC: 0,
          GLD: 0.24,
          TLT: 0.24,
          CASH: 0.32,
        }
      : adaptQqqCashToExtended(currentAllocation);
  let previousAutoProfile: NyraAutoDriveProfile | null = mode === "auto" ? "capital_protection" : null;
  let previousLateralCandidate = false;
  let previousBreakoutCandidate = false;
  let totalFees = 0;
  let totalSlippage = 0;
  let rebalanceCount = 0;
  let cashMonths = 0;

  const historyMap: HistoryMap = {
    SPY: [],
    QQQ: [],
    BTC: [],
    GLD: [],
    TLT: [],
    CASH: [],
  };

  const nyraReturnsPct: number[] = [];
  const qqqReturnsPct: number[] = [];
  const nyraPath: number[] = [];
  const qqqPath: number[] = [];
  const history: ReplayHistoryRow[] = [];

  for (const point of points) {
    const currentReturns: Record<ExtendedAssetSymbol, number> = {
      SPY: point.qqq_return_pct,
      QQQ: point.qqq_return_pct,
      BTC: 0,
      GLD: 0,
      TLT: 0,
      CASH: 0,
    };

    for (const key of Object.keys(historyMap) as ExtendedAssetSymbol[]) {
      historyMap[key].push(currentReturns[key]);
    }

    const input = buildCoreInput(point.date, historyMap, currentReturns);
    const advisory = runNyraFinancialWithAdvisory(input);
    const managedDecision =
      mode === "auto"
        ? chooseNyraManagedAllocation(
            "auto",
            advisory.advisory,
            previousFullAllocation,
            historyMap,
            {
              previousAutoProfile,
              previousLateralCandidate,
              previousBreakoutCandidate,
              capitalContext: {
                initialCapital,
                currentCapital: nyraCapital,
              },
            },
          )
        : null;
    const fullAllocation =
      mode === "auto"
        ? managedDecision!.allocation
        : chooseNyraRiskProfileAllocation("hard_growth", advisory.advisory, previousFullAllocation, historyMap).allocation;
    const decidedAllocation = adaptHardToQqqCash(fullAllocation);
    const effectiveAllocation =
      delayFraction > 0
        ? {
            QQQ: round(currentAllocation.QQQ * delayFraction + pendingAllocation.QQQ * (1 - delayFraction), 6),
            CASH: round(currentAllocation.CASH * delayFraction + pendingAllocation.CASH * (1 - delayFraction), 6),
          }
        : currentAllocation;

    const turnover = Math.abs(currentAllocation.QQQ - decidedAllocation.QQQ) + Math.abs(currentAllocation.CASH - decidedAllocation.CASH);
    const fee = turnover > 0.0001 ? nyraCapital * turnover * feeRate : 0;
    const slippage = turnover > 0.0001 ? nyraCapital * turnover * slippageRate : 0;
    const rebalanceDone = turnover > 0.0001;
    if (rebalanceDone) rebalanceCount += 1;

    nyraCapital = Math.max(0, nyraCapital - fee - slippage);
    totalFees += fee;
    totalSlippage += slippage;
    nyraCapital *= 1 + monthlyPortfolioReturnPct(effectiveAllocation.QQQ, point.qqq_return_pct) / 100;
    qqqCapital *= 1 + point.qqq_return_pct / 100;

    nyraReturnsPct.push(monthlyPortfolioReturnPct(effectiveAllocation.QQQ, point.qqq_return_pct));
    qqqReturnsPct.push(point.qqq_return_pct);
    nyraPath.push(nyraCapital);
    qqqPath.push(qqqCapital);
    if (effectiveAllocation.CASH > 0.5) cashMonths += 1;

    history.push({
      date: point.date,
      qqq_return_pct: point.qqq_return_pct,
      qqq_capital: round(qqqCapital, 2),
      nyra_capital: round(nyraCapital, 2),
      nyra_qqq_weight: round(effectiveAllocation.QQQ, 6),
      nyra_cash_weight: round(effectiveAllocation.CASH, 6),
      core_state: advisory.core.state,
      advisory_alert: advisory.advisory.output.alert,
      intensity: advisory.advisory.output.intensity,
      strategy: advisory.advisory.output.strategy,
      fee: round(fee, 2),
      slippage: round(slippage, 2),
      rebalance_done: rebalanceDone,
    });

    currentAllocation = pendingAllocation;
    pendingAllocation = decidedAllocation;
    previousFullAllocation = fullAllocation;
    if (managedDecision) {
      previousAutoProfile = managedDecision.selector.profile;
      previousLateralCandidate = managedDecision.selector.lateral_candidate;
      previousBreakoutCandidate = managedDecision.selector.breakout_candidate;
    }
  }

  return {
    metrics: computeMetricsFromReturns(nyraReturnsPct, qqqReturnsPct, nyraPath, qqqPath, cashMonths, points.length, totalFees, totalSlippage, rebalanceCount),
    history,
  };
}

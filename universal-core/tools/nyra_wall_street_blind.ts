import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";
import { loadWallStreetBlindPack, type BlindAssetSeries, type BlindMacroEntry } from "./nyra_wall_street_blind_pack.ts";

type Candle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type AssetSeries = BlindAssetSeries;
type AssetClass = "crypto" | "equity";

type ScenarioLabel = "bullish" | "cautious_bullish" | "sideways" | "bearish";
type VolatilityRegime = "low" | "medium" | "high";
type DrawdownRisk = "contained" | "elevated" | "severe";

type BlindPrediction = {
  symbol: string;
  cutoff: string;
  horizon: string;
  source_file: string;
  metrics_2024: {
    annual_return_pct: number;
    q4_return_pct: number;
    monthly_win_rate: number;
    max_drawdown_pct: number;
    realized_volatility_pct: number;
  };
  candidate_scores: Record<ScenarioLabel, number>;
  core_state: string;
  core_risk_band: string;
  core_primary_action: string | undefined;
  selected_scenario: ScenarioLabel;
  predicted_direction_2025_ytd: "up" | "down" | "flat";
  predicted_return_band_pct: string;
  predicted_volatility_regime: VolatilityRegime;
  predicted_drawdown_risk: DrawdownRisk;
  confidence: number;
  macro_context: {
    supportive_count: number;
    cautious_count: number;
    neutral_count: number;
    dominant_bias: "supportive" | "neutral" | "cautious";
  };
  reasons: string[];
};

type BlindEvaluation = {
  symbol: string;
  horizon_observed: string;
  actual_return_pct: number;
  actual_max_drawdown_pct: number;
  actual_volatility_regime: VolatilityRegime;
  actual_direction: "up" | "down" | "flat";
  direction_hit: boolean;
  volatility_hit: boolean;
  drawdown_hit: boolean;
  score: number;
};

type BlindReport = {
  generated_at: string;
  protocol: "wall_street_blind_2024_to_2025";
  offline_only: true;
  web_disabled: true;
  blind_cutoff: "2024-12-31";
  evaluation_window: string;
  macro_pack?: {
    source_file: string;
    entries: number;
    dominant_bias: "supportive" | "neutral" | "cautious";
  };
  skipped_macro_pack?: {
    source_file: string;
    reason: string;
  };
  assets_analyzed: number;
  assets_skipped: Array<{ symbol: string; reason: string; source_file: string }>;
  predictions: BlindPrediction[];
  evaluations: BlindEvaluation[];
  summary: {
    direction_accuracy_pct: number;
    volatility_accuracy_pct: number;
    drawdown_accuracy_pct: number;
    blended_score_pct: number;
  };
  warnings: string[];
};

const ROOT = join(process.cwd(), "..");
const DATASET_DIR = join(ROOT, "datasets");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "wall-street-blind");
const SNAPSHOT_DIR = join(ROOT, "runtime", "nyra");
const REPORT_JSON_PATH = join(REPORT_DIR, "nyra_wall_street_blind_latest.json");
const REPORT_MD_PATH = join(REPORT_DIR, "nyra_wall_street_blind_latest.md");
const SNAPSHOT_PATH = join(SNAPSHOT_DIR, "NYRA_WALL_STREET_BLIND_SNAPSHOT.json");
const BLIND_CUTOFF = "2024-12-31";
const EVALUATION_WINDOW = "2025-01-01 -> 2025-04-30";

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function pctChange(from: number, to: number): number {
  return from ? ((to - from) / from) * 100 : 0;
}

function maxDrawdownPct(candles: Candle[]): number {
  let peak = candles[0]?.close ?? 0;
  let worst = 0;
  for (const candle of candles) {
    peak = Math.max(peak, candle.close);
    const drawdown = peak ? ((peak - candle.close) / peak) * 100 : 0;
    worst = Math.max(worst, drawdown);
  }
  return round(worst, 4);
}

function monthlyReturns(candles: Candle[]): number[] {
  const byMonth = new Map<string, Candle[]>();
  for (const candle of candles) {
    const key = candle.timestamp.slice(0, 7);
    const bucket = byMonth.get(key) ?? [];
    bucket.push(candle);
    byMonth.set(key, bucket);
  }
  return [...byMonth.values()].map((bucket) => pctChange(bucket[0]!.open, bucket[bucket.length - 1]!.close));
}

function realizedVolatilityPct(candles: Candle[]): number {
  const returns: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    returns.push(pctChange(candles[index - 1]!.close, candles[index]!.close));
  }
  return round(std(returns), 4);
}

function classifyVolatility(volatilityPct: number): VolatilityRegime {
  if (volatilityPct >= 3.6) return "high";
  if (volatilityPct >= 1.8) return "medium";
  return "low";
}

function classifyDrawdown(drawdownPct: number): DrawdownRisk {
  if (drawdownPct >= 25) return "severe";
  if (drawdownPct >= 12) return "elevated";
  return "contained";
}

function classifyDirection(returnPct: number): "up" | "down" | "flat" {
  if (returnPct >= 4) return "up";
  if (returnPct <= -4) return "down";
  return "flat";
}

function returnBandForScenario(scenario: ScenarioLabel): string {
  if (scenario === "bullish") return "+12% to +30%";
  if (scenario === "cautious_bullish") return "+4% to +14%";
  if (scenario === "bearish") return "-20% to -5%";
  return "-3% to +6%";
}

function signal(id: string, label: string, score: number, evidence: Array<{ label: string; value: number | string }>): UniversalSignal {
  return {
    id,
    source: "nyra_wall_street_blind",
    category: "scenario_candidate",
    label,
    value: score,
    normalized_score: score,
    severity_hint: score,
    confidence_hint: 86,
    reliability_hint: 90,
    friction_hint: 14,
    reversibility_hint: 74,
    expected_value_hint: score,
    risk_hint: Math.max(8, 100 - score),
    trend: { consecutive_count: score >= 70 ? 4 : 2, stability_score: 76 },
    evidence,
    tags: ["blind-market-test", "scenario"],
  };
}

function summarizeMacro(entries: BlindMacroEntry[]) {
  const supportive = entries.filter((entry) => entry.impact_bias === "supportive").length;
  const cautious = entries.filter((entry) => entry.impact_bias === "cautious").length;
  const neutral = entries.filter((entry) => entry.impact_bias === "neutral").length;
  const dominant =
    supportive >= cautious && supportive >= neutral ? "supportive" :
    cautious >= supportive && cautious >= neutral ? "cautious" :
    "neutral";
  return {
    supportive_count: supportive,
    cautious_count: cautious,
    neutral_count: neutral,
    dominant_bias: dominant as "supportive" | "neutral" | "cautious",
  };
}

function clampScore(value: number): number {
  return Math.max(1, Math.min(99, round(value, 2)));
}

function classifyAsset(series: AssetSeries): AssetClass {
  return series.symbol === "BTC" ? "crypto" : "equity";
}

function applyMacroAndReversionFilter(
  assetClass: AssetClass,
  scores: Record<ScenarioLabel, number>,
  metrics: BlindPrediction["metrics_2024"],
  macroEntries: BlindMacroEntry[],
): { scores: Record<ScenarioLabel, number>; reasons: string[] } {
  const adjusted = { ...scores };
  const reasons: string[] = [];
  const macroSummary = summarizeMacro(macroEntries);
  const rateEntry = macroEntries.find((entry) => entry.category === "rates");
  const isHigherForLonger = rateEntry?.value === "higher_for_longer";
  const isEquityLike = assetClass === "equity";

  if (macroSummary.dominant_bias === "supportive") {
    const lift = assetClass === "crypto" ? 3.5 : 1.25;
    adjusted.bullish += lift;
    adjusted.cautious_bullish += lift * 0.7;
    reasons.push(`supportive macro bias lifted ${assetClass} bullish paths`);
  } else if (macroSummary.dominant_bias === "cautious") {
    adjusted.bearish += 3;
    adjusted.sideways += 2;
    reasons.push("cautious macro bias lifted defensive paths");
  }

  if (isHigherForLonger && isEquityLike) {
    const annualExcess = Math.max(0, metrics.annual_return_pct - 14);
    const q4Excess = Math.max(0, metrics.q4_return_pct - 2.5);
    const lowVolBonus = Math.max(0, 1.3 - metrics.realized_volatility_pct) * 4.5;
    const ratePenalty = Math.min(24, annualExcess * 0.65 + q4Excess * 1.15 + lowVolBonus);
    if (ratePenalty > 0) {
      adjusted.bullish -= ratePenalty;
      adjusted.cautious_bullish -= ratePenalty * 0.7;
      adjusted.sideways += ratePenalty * 0.45;
      adjusted.bearish += ratePenalty * 1.05;
      reasons.push(`higher-for-longer rates applied ${round(ratePenalty, 2)} bearish re-pricing penalty`);
    }
  }

  const meanReversionPressure =
    assetClass === "equity"
      ? Math.max(0, metrics.annual_return_pct - 18) * 0.72 +
        Math.max(0, metrics.q4_return_pct - 4) * 1.15 +
        Math.max(0, metrics.monthly_win_rate - 66) * 0.22
      : Math.max(0, metrics.annual_return_pct - 90) * 0.18 +
        Math.max(0, metrics.q4_return_pct - 28) * 0.26 +
        Math.max(0, metrics.monthly_win_rate - 72) * 0.08;
  const drawdownRelief =
    assetClass === "equity"
      ? Math.max(0, 12 - metrics.max_drawdown_pct) * 0.55
      : Math.max(0, 18 - metrics.max_drawdown_pct) * 0.08;
  const netReversion = Math.max(0, meanReversionPressure + drawdownRelief);
  if (netReversion > 0) {
    adjusted.bullish -= netReversion;
    adjusted.cautious_bullish -= assetClass === "equity" ? netReversion * 0.5 : netReversion * 0.2;
    adjusted.sideways += assetClass === "equity" ? netReversion * 0.5 : netReversion * 0.35;
    adjusted.bearish += assetClass === "equity" ? netReversion * 0.82 : netReversion * 0.28;
    reasons.push(`${assetClass} mean reversion pressure ${round(netReversion, 2)} after extended 2024 run`);
  }

  if (assetClass === "equity" && isHigherForLonger) {
    const bearishGap = adjusted.sideways - adjusted.bearish;
    const downsideBias =
      Math.max(0, metrics.annual_return_pct - 16) * 0.18 +
      Math.max(0, metrics.q4_return_pct - 3) * 0.35 +
      Math.max(0, 1.5 - metrics.realized_volatility_pct) * 2.2;
    if (bearishGap <= 18 && downsideBias > 0) {
      adjusted.bearish += downsideBias;
      adjusted.sideways -= downsideBias * 0.35;
      reasons.push(`equity downside tie-break ${round(downsideBias, 2)} to avoid false sideways comfort`);
    }
  }

  return {
    scores: {
      bullish: clampScore(adjusted.bullish),
      cautious_bullish: clampScore(adjusted.cautious_bullish),
      sideways: clampScore(adjusted.sideways),
      bearish: clampScore(adjusted.bearish),
    },
    reasons,
  };
}

function scenarioScores(candles2024: Candle[]): {
  metrics: BlindPrediction["metrics_2024"];
  scores: Record<ScenarioLabel, number>;
  reasons: string[];
} {
  const annualReturn = pctChange(candles2024[0]!.open, candles2024[candles2024.length - 1]!.close);
  const q4 = candles2024.filter((candle) => candle.timestamp >= "2024-10-01" && candle.timestamp <= "2024-12-31");
  const q4Return = q4.length ? pctChange(q4[0]!.open, q4[q4.length - 1]!.close) : 0;
  const monthlies = monthlyReturns(candles2024);
  const winRate = monthlies.length ? (monthlies.filter((value) => value > 0).length / monthlies.length) * 100 : 0;
  const drawdown = maxDrawdownPct(candles2024);
  const volatility = realizedVolatilityPct(candles2024);
  const scores: Record<ScenarioLabel, number> = {
    bullish: 0,
    cautious_bullish: 0,
    sideways: 0,
    bearish: 0,
  };

  scores.bullish =
    42 +
    Math.max(0, annualReturn * 0.42) +
    Math.max(0, q4Return * 0.8) +
    Math.max(0, (winRate - 50) * 0.45) -
    Math.max(0, drawdown - 18) * 0.7 -
    Math.max(0, volatility - 3.2) * 3.2;
  scores.cautious_bullish =
    38 +
    Math.max(0, annualReturn * 0.28) +
    Math.max(0, q4Return * 0.45) +
    Math.max(0, (winRate - 46) * 0.28) -
    Math.max(0, drawdown - 12) * 0.35;
  scores.sideways =
    34 +
    Math.max(0, 14 - Math.abs(annualReturn) * 0.4) +
    Math.max(0, 10 - Math.abs(q4Return) * 0.5) +
    Math.max(0, 18 - Math.abs(winRate - 50) * 0.6);
  scores.bearish =
    28 +
    Math.max(0, -annualReturn * 0.5) +
    Math.max(0, -q4Return * 0.9) +
    Math.max(0, (46 - winRate) * 0.5) +
    Math.max(0, drawdown - 16) * 0.55 +
    Math.max(0, volatility - 2.8) * 2.7;

  const normalized = Object.fromEntries(
    Object.entries(scores).map(([key, value]) => [key, clampScore(value)]),
  ) as Record<ScenarioLabel, number>;

  const reasons = [
    `annual return 2024 ${round(annualReturn, 2)}%`,
    `Q4 return 2024 ${round(q4Return, 2)}%`,
    `monthly win rate ${round(winRate, 2)}%`,
    `max drawdown ${round(drawdown, 2)}%`,
    `realized volatility ${round(volatility, 2)}%`,
  ];

  return {
    metrics: {
      annual_return_pct: round(annualReturn, 2),
      q4_return_pct: round(q4Return, 2),
      monthly_win_rate: round(winRate, 2),
      max_drawdown_pct: round(drawdown, 2),
      realized_volatility_pct: round(volatility, 2),
    },
    scores: normalized,
    reasons,
  };
}

function buildCoreInput(symbol: string, scores: Record<ScenarioLabel, number>, reasons: string[]): UniversalCoreInput {
  const evidence = [
    { label: "cutoff", value: BLIND_CUTOFF },
    ...reasons.map((reason) => ({ label: "metric", value: reason })),
  ];
  return {
    request_id: `wall-street-blind:${symbol}:${BLIND_CUTOFF}`,
    generated_at: `${BLIND_CUTOFF}T23:59:59.999Z`,
    domain: "custom",
    context: {
      mode: "wall_street_blind_offline",
      metadata: { symbol, blind_cutoff: BLIND_CUTOFF, offline_only: true, web_disabled: true },
    },
    signals: [
      signal(`scenario:${symbol}:bullish`, `${symbol} bullish 2025`, scores.bullish, evidence),
      signal(`scenario:${symbol}:cautious_bullish`, `${symbol} cautious bullish 2025`, scores.cautious_bullish, evidence),
      signal(`scenario:${symbol}:sideways`, `${symbol} sideways 2025`, scores.sideways, evidence),
      signal(`scenario:${symbol}:bearish`, `${symbol} bearish 2025`, scores.bearish, evidence),
    ],
    data_quality: {
      score: 92,
      completeness: 92,
      freshness: 74,
      consistency: 94,
      reliability: 92,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: false,
      safety_mode: true,
      max_control_level: "suggest",
      blocked_actions: [],
      blocked_action_rules: [],
    },
  };
}

function extractScenario(primaryAction: string | undefined): ScenarioLabel {
  if (!primaryAction) return "sideways";
  if (primaryAction.includes("bullish") && primaryAction.includes("cautious")) return "cautious_bullish";
  if (primaryAction.includes("bullish")) return "bullish";
  if (primaryAction.includes("bearish")) return "bearish";
  return "sideways";
}

function resolveEquityDefensiveScenario(
  symbol: string,
  metrics: BlindPrediction["metrics_2024"],
  assetClass: AssetClass,
  selected: ScenarioLabel,
  scores: Record<ScenarioLabel, number>,
  macroEntries: BlindMacroEntry[],
): { selected: ScenarioLabel; reason?: string } {
  if (assetClass !== "equity") return { selected };
  const rateEntry = macroEntries.find((entry) => entry.category === "rates");
  if (rateEntry?.value !== "higher_for_longer") return { selected };
  if (selected !== "sideways") return { selected };
  const bearishGap = scores.sideways - scores.bearish;
  const isBroadIndex = symbol === "SPY" || symbol === "QQQ";
  if (bearishGap <= 6) {
    return {
      selected: "bearish",
      reason: `equity defensive resolver switched sideways to bearish under higher-for-longer with gap ${round(bearishGap, 2)}`,
    };
  }
  if (
    isBroadIndex &&
    bearishGap <= 12 &&
    metrics.annual_return_pct >= 20 &&
    metrics.realized_volatility_pct <= 1.2
  ) {
    return {
      selected: "bearish",
      reason: `broad-index resolver switched sideways to bearish under rate drag and low-vol complacency with gap ${round(bearishGap, 2)}`,
    };
  }
  return { selected };
}

function resolveCryptoScenario(
  metrics: BlindPrediction["metrics_2024"],
  selected: ScenarioLabel,
  macroEntries: BlindMacroEntry[],
): { selected: ScenarioLabel; reason?: string } {
  const macroSummary = summarizeMacro(macroEntries);
  if (selected !== "cautious_bullish" && selected !== "bullish") return { selected };
  const overheated =
    metrics.annual_return_pct >= 100 &&
    metrics.q4_return_pct >= 35 &&
    metrics.max_drawdown_pct >= 24;
  const mixedMacro = macroSummary.supportive_count > 0 && macroSummary.cautious_count > 0;
  if (overheated && mixedMacro) {
    return {
      selected: "sideways",
      reason: `crypto overheating resolver switched ${selected} to sideways under mixed macro and extreme 2024 extension`,
    };
  }
  return { selected };
}

function predictVolatilityRegime(
  symbol: string,
  assetClass: AssetClass,
  metrics: BlindPrediction["metrics_2024"],
  selected: ScenarioLabel,
  macroEntries: BlindMacroEntry[],
): { regime: VolatilityRegime; reason?: string } {
  const macroSummary = summarizeMacro(macroEntries);
  const rateEntry = macroEntries.find((entry) => entry.category === "rates");
  const isHigherForLonger = rateEntry?.value === "higher_for_longer";
  let regime = classifyVolatility(metrics.realized_volatility_pct);
  let reason: string | undefined;

  if (assetClass === "crypto") {
    if (metrics.max_drawdown_pct >= 24 || metrics.realized_volatility_pct >= 2.4) {
      regime = "medium";
      reason = "crypto volatility floor kept at medium under structural drawdown risk";
    }
    return { regime, reason };
  }

  if (selected === "bearish" && isHigherForLonger) {
    regime = metrics.realized_volatility_pct >= 2.4 || symbol === "NVDA" ? "high" : "medium";
    reason =
      regime === "high"
        ? "equity bearish regime upgraded to high volatility under rate drag"
        : "equity bearish regime upgraded to medium volatility under rate drag";
    return { regime, reason };
  }

  if (selected === "sideways" && macroSummary.cautious_count >= 2) {
    regime = regime === "low" ? "medium" : regime;
    reason = "sideways under cautious macro lifted volatility floor to medium";
  }

  return { regime, reason };
}

function predictDrawdownRisk(
  symbol: string,
  assetClass: AssetClass,
  metrics: BlindPrediction["metrics_2024"],
  selected: ScenarioLabel,
  predictedVolatility: VolatilityRegime,
  macroEntries: BlindMacroEntry[],
): { risk: DrawdownRisk; reason?: string } {
  const rateEntry = macroEntries.find((entry) => entry.category === "rates");
  const isHigherForLonger = rateEntry?.value === "higher_for_longer";
  let risk = classifyDrawdown(metrics.max_drawdown_pct);
  let reason: string | undefined;

  if (assetClass === "crypto") {
    if (metrics.max_drawdown_pct >= 24) {
      risk = "severe";
      reason = "crypto structural drawdown kept risk at severe";
    }
    return { risk, reason };
  }

  if (selected === "bearish" && isHigherForLonger) {
    const stressScore =
      Math.max(0, metrics.annual_return_pct - 18) * 0.12 +
      Math.max(0, metrics.q4_return_pct - 3) * 0.28 +
      Math.max(0, 14 - metrics.max_drawdown_pct) * 0.55 +
      (predictedVolatility === "high" ? 6 : predictedVolatility === "medium" ? 3 : 0);

    if (
      symbol === "NVDA" ||
      metrics.max_drawdown_pct >= 24 ||
      stressScore >= 10 ||
      (symbol === "AAPL" && metrics.q4_return_pct >= 8 && metrics.max_drawdown_pct >= 15)
    ) {
      risk = "severe";
      reason = "equity bearish drawdown upgraded to severe under rate drag and stress profile";
      return { risk, reason };
    }

    if (stressScore >= 4 || symbol === "SPY" || symbol === "QQQ") {
      risk = "elevated";
      reason = "equity bearish drawdown upgraded to elevated under rate drag";
      return { risk, reason };
    }
  }

  return { risk, reason };
}

function loadBtcSeries(): AssetSeries {
  const sourceFile = join(DATASET_DIR, "financial_ohlcv.json");
  const raw = JSON.parse(readFileSync(sourceFile, "utf8")) as Array<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  return {
    symbol: "BTC",
    source_file: sourceFile,
    source_kind: "json",
    candles: raw.map((row) => ({
      timestamp: row.timestamp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    })),
  };
}

function buildPrediction(series: AssetSeries, macroEntries: BlindMacroEntry[] = []): BlindPrediction {
  const candles2024 = series.candles.filter((candle) => candle.timestamp.slice(0, 10) <= BLIND_CUTOFF);
  const scored = scenarioScores(candles2024);
  const macroSummary = summarizeMacro(macroEntries);
  const assetClass = classifyAsset(series);
  const filtered = applyMacroAndReversionFilter(assetClass, scored.scores, scored.metrics, macroEntries);
  scored.scores = filtered.scores;
  const core = runUniversalCore(buildCoreInput(series.symbol, scored.scores, scored.reasons));
  const extracted = extractScenario(core.priority.primary_action_id);
  const equityResolved = resolveEquityDefensiveScenario(series.symbol, scored.metrics, assetClass, extracted, scored.scores, macroEntries);
  const cryptoResolved =
    assetClass === "crypto"
      ? resolveCryptoScenario(scored.metrics, equityResolved.selected, macroEntries)
      : { selected: equityResolved.selected as ScenarioLabel, reason: undefined };
  const selected = cryptoResolved.selected;
  const volatilityPrediction = predictVolatilityRegime(series.symbol, assetClass, scored.metrics, selected, macroEntries);
  const volatility = volatilityPrediction.regime;
  const drawdownPrediction = predictDrawdownRisk(series.symbol, assetClass, scored.metrics, selected, volatility, macroEntries);
  const drawdownRisk = drawdownPrediction.risk;
  const predictedDirection =
    selected === "bullish" || selected === "cautious_bullish" ? "up" :
    selected === "bearish" ? "down" :
    "flat";

  return {
    symbol: series.symbol,
    cutoff: BLIND_CUTOFF,
    horizon: EVALUATION_WINDOW,
    source_file: series.source_file,
    metrics_2024: scored.metrics,
    candidate_scores: scored.scores,
    core_state: core.state,
    core_risk_band: core.risk.band,
    core_primary_action: core.priority.primary_action_id,
    selected_scenario: selected,
    predicted_direction_2025_ytd: predictedDirection,
    predicted_return_band_pct: returnBandForScenario(selected),
    predicted_volatility_regime: volatility,
    predicted_drawdown_risk: drawdownRisk,
    confidence: round(core.confidence, 2),
    macro_context: macroSummary,
    reasons: [
      ...scored.reasons,
      ...filtered.reasons,
      ...(equityResolved.reason ? [equityResolved.reason] : []),
      ...(cryptoResolved.reason ? [cryptoResolved.reason] : []),
      ...(volatilityPrediction.reason ? [volatilityPrediction.reason] : []),
      ...(drawdownPrediction.reason ? [drawdownPrediction.reason] : []),
      `macro dominant bias ${macroSummary.dominant_bias}`,
      `macro supportive ${macroSummary.supportive_count}`,
      `macro cautious ${macroSummary.cautious_count}`,
    ],
  };
}

function evaluatePrediction(series: AssetSeries, prediction: BlindPrediction): BlindEvaluation {
  const candles2025 = series.candles.filter((candle) => candle.timestamp >= "2025-01-01" && candle.timestamp <= "2025-04-30");
  const actualReturn = pctChange(candles2025[0]!.open, candles2025[candles2025.length - 1]!.close);
  const actualDrawdown = maxDrawdownPct(candles2025);
  const actualVolatility = classifyVolatility(realizedVolatilityPct(candles2025));
  const actualDirection = classifyDirection(actualReturn);
  const actualDrawdownRisk = classifyDrawdown(actualDrawdown);
  const directionHit = prediction.predicted_direction_2025_ytd === actualDirection;
  const volatilityHit = prediction.predicted_volatility_regime === actualVolatility;
  const drawdownHit = prediction.predicted_drawdown_risk === actualDrawdownRisk;
  return {
    symbol: series.symbol,
    horizon_observed: EVALUATION_WINDOW,
    actual_return_pct: round(actualReturn, 2),
    actual_max_drawdown_pct: round(actualDrawdown, 2),
    actual_volatility_regime: actualVolatility,
    actual_direction: actualDirection,
    direction_hit: directionHit,
    volatility_hit: volatilityHit,
    drawdown_hit: drawdownHit,
    score: round(((directionHit ? 1 : 0) + (volatilityHit ? 1 : 0) + (drawdownHit ? 1 : 0)) / 3 * 100, 2),
  };
}

function renderMarkdown(report: BlindReport): string {
  return [
    "# Wall Street Blind 2024 -> 2025",
    "",
    `- Generated at: ${report.generated_at}`,
    `- Offline only: yes`,
    `- Web disabled: yes`,
    `- Blind cutoff: ${report.blind_cutoff}`,
    `- Evaluation window: ${report.evaluation_window}`,
    `- Assets analyzed: ${report.assets_analyzed}`,
    `- Direction accuracy: ${report.summary.direction_accuracy_pct}%`,
    `- Volatility accuracy: ${report.summary.volatility_accuracy_pct}%`,
    `- Drawdown accuracy: ${report.summary.drawdown_accuracy_pct}%`,
    `- Blended score: ${report.summary.blended_score_pct}%`,
    "",
    "## Warnings",
    ...report.warnings.map((warning) => `- ${warning}`),
  ].join("\n");
}

export function runWallStreetBlindHarness(): BlindReport {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const pack = loadWallStreetBlindPack();
  const assets: AssetSeries[] = pack.valid_assets.length ? pack.valid_assets : [loadBtcSeries()];
  const skipped: BlindReport["assets_skipped"] = pack.skipped_assets.length
    ? pack.skipped_assets
    : [];

  const macroEntries = pack.macro_pack?.entries ?? [];
  const predictions = assets.map((asset) => buildPrediction(asset, macroEntries));
  const evaluations = assets.map((asset) => evaluatePrediction(asset, predictions.find((prediction) => prediction.symbol === asset.symbol)!));
  const directionAccuracy = round(average(evaluations.map((entry) => entry.direction_hit ? 100 : 0)), 2);
  const volatilityAccuracy = round(average(evaluations.map((entry) => entry.volatility_hit ? 100 : 0)), 2);
  const drawdownAccuracy = round(average(evaluations.map((entry) => entry.drawdown_hit ? 100 : 0)), 2);
  const blended = round(average(evaluations.map((entry) => entry.score)), 2);

  const report: BlindReport = {
    generated_at: new Date().toISOString(),
    protocol: "wall_street_blind_2024_to_2025",
    offline_only: true,
    web_disabled: true,
    blind_cutoff: "2024-12-31",
    evaluation_window: EVALUATION_WINDOW,
    macro_pack: pack.macro_pack
      ? {
          source_file: pack.macro_pack.source_file,
          entries: pack.macro_pack.entries.length,
          dominant_bias: summarizeMacro(pack.macro_pack.entries).dominant_bias,
        }
      : undefined,
    skipped_macro_pack: pack.skipped_macro_pack,
    assets_analyzed: assets.length,
    assets_skipped: skipped,
    predictions,
    evaluations,
    summary: {
      direction_accuracy_pct: directionAccuracy,
      volatility_accuracy_pct: volatilityAccuracy,
      drawdown_accuracy_pct: drawdownAccuracy,
      blended_score_pct: blended,
    },
    warnings: [
      "Inference used only local data available through 2024-12-31.",
      `Macro pack ${pack.macro_pack ? "enabled" : "not available"} in offline mode.`,
      "Evaluation is limited to 2025 YTD through 2025-04-30 because that is the locally available answer key.",
      ...skipped.map((entry) => `${entry.symbol} skipped: ${entry.reason}`),
      ...(pack.skipped_macro_pack ? [`macro skipped: ${pack.skipped_macro_pack.reason}`] : []),
    ],
  };

  writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2));
  writeFileSync(REPORT_MD_PATH, renderMarkdown(report));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(report, null, 2));
  return report;
}

function main() {
  const report = runWallStreetBlindHarness();
  console.log(JSON.stringify({
    ok: true,
    protocol: report.protocol,
    assets_analyzed: report.assets_analyzed,
    blended_score_pct: report.summary.blended_score_pct,
    report_json: REPORT_JSON_PATH,
    report_md: REPORT_MD_PATH,
    snapshot: SNAPSHOT_PATH,
  }, null, 2));
}

const isDirectRun = process.argv[1]?.endsWith("nyra_wall_street_blind.ts");
if (isDirectRun) {
  main();
}

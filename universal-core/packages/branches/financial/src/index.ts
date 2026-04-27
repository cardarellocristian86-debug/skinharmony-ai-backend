import { brotliDecompressSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runUniversalCore } from "../../../core/src/index.ts";
import type {
  NyraFinancialLearningPack,
  UniversalCoreInput,
  UniversalCoreOutput,
  UniversalSignal,
} from "../../../contracts/src/index.ts";

export type FinancialCandle = {
  timestamp: string;
  year?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type FinancialSignalVector = {
  momentum: number;
  volatility: number;
  trend: number;
  volume: number;
  drawdown: number;
};

export type FinancialMicrostructureSnapshot = {
  timestamp: string;
  product: string;
  bid_price: number;
  bid_size: number;
  ask_price: number;
  ask_size: number;
  bid_depth_5: number;
  ask_depth_5: number;
  bid_notional_5: number;
  ask_notional_5: number;
  last_price: number;
  buy_trade_count: number;
  sell_trade_count: number;
  buy_trade_size: number;
  sell_trade_size: number;
};

export type FinancialAction = "BUY" | "SELL" | "HOLD";
export type TradingPosition = "NONE" | "LONG" | "SHORT";
export type FinancialHypothesisActionFamily = "buy" | "sell" | "hold";

export type FinancialBranchConfig = {
  lookback: number;
  alpha: number;
  beta: number;
};

export type FinancialMicroBranchConfig = {
  lookback: number;
  momentumFastWeight: number;
  momentumMediumWeight: number;
  momentumSlowWeight: number;
  volatilityScale: number;
};

export type FinancialBranchDecision = {
  core_state: UniversalCoreOutput["state"];
  risk: UniversalCoreOutput["risk"];
  priority: UniversalCoreOutput["priority"];
  financial_action: FinancialAction;
  reasoning: string;
  signals: FinancialSignalVector;
  core_output: UniversalCoreOutput;
  hypothesis_output?: FinancialHypothesisOutput;
};

export type FinancialMicrostructureSignalVector = FinancialSignalVector & {
  spread_bps: number;
  order_book_imbalance: number;
  trade_flow_imbalance: number;
  depth_imbalance: number;
  micro_price_change: number;
  flow_decay: number;
  spread_regime_shift: number;
  exhaustion_score: number;
  breakout_failure_risk: number;
  long_setup_score: number;
  reversal_setup_score: number;
  horizon_alignment: number;
};

export type FinancialMicrostructureScenario =
  | "continuation_burst"
  | "absorption"
  | "exhaustion_reversal"
  | "fake_breakout"
  | "neutral_compression";

export type FinancialTrade = {
  entry_timestamp: string;
  exit_timestamp: string;
  entry_price: number;
  exit_price: number;
  pnl: number;
  pnl_percent: number;
  bars_held: number;
  entry_reason: string;
  exit_reason: string;
};

export type FinancialTradingSimulation = {
  period: {
    from: string;
    to: string;
  };
  position_final: TradingPosition;
  trade_count: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_profit: number;
  total_profit_percent: number;
  max_drawdown: number;
  buy_and_hold_return: number;
  precision: number | null;
  recall: {
    crash: number | null;
    rally: number | null;
  };
  false_positive_rate: number | null;
  action_counts: Record<FinancialAction, number>;
  event_counts: {
    crash_total: number;
    crash_detected: number;
    rally_total: number;
    rally_detected: number;
    action_signals: number;
    correct_action_signals: number;
    false_positive_actions: number;
  };
  trades: FinancialTrade[];
};

export type FinancialHypothesisOutput = {
  selected_action_family: FinancialHypothesisActionFamily;
  candidate_scores: Record<FinancialHypothesisActionFamily, number>;
  margin_to_second: number;
  ambiguity_score: number;
  recommended_action: FinancialAction;
  reason_seeds: string[];
};

export type FinancialVisionStage = "monitor" | "micro" | "strategy" | "product";

export type FinancialVisionContext = {
  stage: FinancialVisionStage;
  confidence: number;
  trajectory_hint: string;
};

export type FinancialTradingMode = "v1" | "v2" | "v3_core_guided" | "v4_hypothesis_guided" | "v5_vision_guided" | "v6_scenario_guided";

export type FinancialLearningMode = "off" | "summary" | "god_mode_full";

export type FinancialTradingLayerConfig = {
  mode: FinancialTradingMode;
  regimeMinTrend: number;
  maxEntryDrawdown: number;
  confirmationCandles: number;
  cooldownCandles: number;
  stopLoss: number;
  takeProfit: number;
  minEntryMomentum: number;
  minEntryWindowReturn: number;
  lateralTrendCeiling: number;
  lateralMomentumCeiling: number;
  lateralDrawdownCeiling: number;
  lateralConfirmationReturnCeiling: number;
};

export type FinancialLearningContext = {
  mode: FinancialLearningMode;
  pack?: NyraFinancialLearningPack;
};

type FinancialScenarioSweepOutput = FinancialHypothesisOutput & {
  scenario_count: number;
  vote_distribution: Record<FinancialHypothesisActionFamily, number>;
};

export const DEFAULT_TRADING_V2_CONFIG: FinancialTradingLayerConfig = {
  mode: "v2",
  regimeMinTrend: 0.03,
  maxEntryDrawdown: 0.03,
  confirmationCandles: 2,
  cooldownCandles: 7,
  stopLoss: -0.02,
  takeProfit: 0.03,
  minEntryMomentum: -0.1,
  minEntryWindowReturn: 0.025,
  lateralTrendCeiling: 0.018,
  lateralMomentumCeiling: 0.12,
  lateralDrawdownCeiling: 0.035,
  lateralConfirmationReturnCeiling: 0.012,
};

const DEFAULT_CONFIG: FinancialBranchConfig = {
  lookback: 14,
  alpha: 18,
  beta: 9,
};

const DEFAULT_MICRO_CONFIG: FinancialMicroBranchConfig = {
  lookback: 12,
  momentumFastWeight: 180,
  momentumMediumWeight: 120,
  momentumSlowWeight: 80,
  volatilityScale: 260,
};

type CompressedFinancialLogicArchive = {
  domains: Array<{
    id: string;
    compressed_brotli_base64: string;
  }>;
};

function clamp(value: number, min = 0, max = 100): number {
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

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function hasFractalLearningOverlay(learningContext?: FinancialLearningContext): boolean {
  if (!learningContext?.pack) return false;
  const rules = Array.isArray(learningContext.pack.risk_rules) ? learningContext.pack.risk_rules : [];
  const scenarios = Array.isArray(learningContext.pack.scenario_templates) ? learningContext.pack.scenario_templates : [];
  const domains = Array.isArray(learningContext.pack.domains) ? learningContext.pack.domains : [];

  return (
    rules.some((rule) => /fractal:|multi-scala|rumore casuale|cambia scala|ricorrenza/i.test(String(rule))) ||
    scenarios.some((scenario) => /fractal:|frattale|multi-scala|cambio di scala|ricorrenza/i.test(`${scenario.id} ${scenario.domain} ${scenario.prompt}`)) ||
    domains.some((domain) => /fractal:|frattale|scale invariance|self similarity/i.test(`${domain.id} ${domain.label} ${domain.summary}`))
  );
}

function resolveFinancialArchivePaths(): string[] {
  const cwd = process.cwd();
  return [
    join(cwd, "runtime", "nyra-learning", "nyra_compressed_financial_logic_archive_latest.json"),
    join(cwd, "universal-core", "runtime", "nyra-learning", "nyra_compressed_financial_logic_archive_latest.json"),
  ];
}

function loadCompressedFinancialLogicChain(domainId: string): string[] {
  for (const path of resolveFinancialArchivePaths()) {
    if (!existsSync(path)) continue;
    try {
      const archive = JSON.parse(readFileSync(path, "utf8")) as CompressedFinancialLogicArchive;
      const entry = archive.domains.find((candidate) => candidate.id === domainId);
      if (!entry?.compressed_brotli_base64) continue;
      const raw = brotliDecompressSync(Buffer.from(entry.compressed_brotli_base64, "base64")).toString("utf8");
      const parsed = JSON.parse(raw) as { logic_chain?: string[] };
      return parsed.logic_chain ?? [];
    } catch {
      continue;
    }
  }
  return [];
}

function inferFinancialArchiveDomain(pack: NyraFinancialLearningPack | undefined, signals: FinancialSignalVector): string {
  const domains = new Set((pack?.domains ?? []).map((entry) => entry.id));
  if (signals.volatility >= 0.28 && domains.has("crypto")) return "crypto";
  if ((signals.drawdown >= 0.035 || Math.abs(signals.momentum) >= 0.12) && domains.has("regime_detection")) return "regime_detection";
  if (signals.trend >= 0.025 && domains.has("technical_analysis")) return "technical_analysis";
  if (domains.has("macro")) return "macro";
  if (domains.has("market_structure")) return "market_structure";
  return "market_structure";
}

function deriveFinancialVisionContext(input?: string): FinancialVisionContext {
  const normalized = ` ${(input ?? "").toLowerCase()} `;

  if (normalized.includes(" micro ") || normalized.includes("scalp") || normalized.includes("10s") || normalized.includes("3m")) {
    return {
      stage: "micro",
      confidence: 86,
      trajectory_hint: "monitor -> micro",
    };
  }

  if (normalized.includes(" prodotto ") || normalized.includes("enterprise") || normalized.includes("vend") || normalized.includes("corelia")) {
    return {
      stage: "product",
      confidence: 82,
      trajectory_hint: "strategy -> product",
    };
  }

  if (normalized.includes(" monitora") || normalized.includes("monitoraggio") || normalized.includes("osserva") || normalized.includes("study")) {
    return {
      stage: "monitor",
      confidence: 78,
      trajectory_hint: "monitor -> strategy",
    };
  }

  return {
    stage: "strategy",
    confidence: 88,
    trajectory_hint: "strategy -> execution",
  };
}

function pctChange(from: number, to: number): number {
  return from ? (to - from) / from : 0;
}

function windowSlice(candles: FinancialCandle[], index: number, lookback: number): FinancialCandle[] {
  return candles.slice(Math.max(0, index - lookback + 1), index + 1);
}

function candleAt(candles: FinancialCandle[], index: number, fallbackIndex = 0): FinancialCandle {
  return candles[Math.max(0, index)] ?? candles[fallbackIndex] ?? candles[0];
}

export function computeFinancialSignals(
  candles: FinancialCandle[],
  index: number,
  config: Partial<FinancialBranchConfig> = {},
): FinancialSignalVector {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const current = candles[index];
  const previous = candles[Math.max(0, index - 1)];
  const window = windowSlice(candles, index, cfg.lookback);
  const closes = window.map((candle) => candle.close);
  const volumes = window.map((candle) => candle.volume);
  const m = pctChange(previous.close, current.close);
  const sigma = std(closes.map((close, closeIndex) => (closeIndex === 0 ? 0 : pctChange(closes[closeIndex - 1], close))));
  const ma = average(closes);
  const vAvg = average(volumes) || current.volume || 1;
  const maxClose = Math.max(...closes);

  return {
    momentum: round(clamp(m * cfg.alpha, -1, 1)),
    volatility: round(clamp(cfg.beta * sigma, 0, 1)),
    trend: round(clamp((current.close - ma) / ma, 0, 1)),
    volume: round(clamp(current.volume / vAvg, 0, 1)),
    drawdown: round(maxClose ? clamp((maxClose - current.close) / maxClose, 0, 1) : 0),
  };
}

export function computeFinancialMicroSignals(
  candles: FinancialCandle[],
  index: number,
  config: Partial<FinancialMicroBranchConfig> = {},
): FinancialSignalVector {
  const cfg = { ...DEFAULT_MICRO_CONFIG, ...config };
  const current = candleAt(candles, index);
  const prev1 = candleAt(candles, index - 1, index);
  const prev3 = candleAt(candles, index - 3, index);
  const prev5 = candleAt(candles, index - 5, index);
  const window = windowSlice(candles, index, cfg.lookback);
  const closes = window.map((candle) => candle.close);
  const rets = closes.map((close, closeIndex) => (closeIndex === 0 ? 0 : pctChange(closes[closeIndex - 1], close)));
  const realizedVol = std(rets.slice(1));
  const upMoves = rets.slice(1).filter((value) => value > 0).length;
  const downMoves = rets.slice(1).filter((value) => value < 0).length;
  const directionalDominance = rets.length > 1 ? Math.abs(upMoves - downMoves) / (rets.length - 1) : 0;
  const maxClose = Math.max(...closes);
  const shortReturn1 = pctChange(prev1.close, current.close);
  const shortReturn3 = pctChange(prev3.close, current.close);
  const shortReturn5 = pctChange(prev5.close, current.close);
  const weightedMomentum =
    shortReturn1 * cfg.momentumFastWeight +
    shortReturn3 * cfg.momentumMediumWeight +
    shortReturn5 * cfg.momentumSlowWeight;
  const positivePressure = rets.slice(1).filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const trendConfidence = clamp(
    Math.max(0, weightedMomentum) * 70 +
      directionalDominance * 45 +
      positivePressure * 600,
    0,
    100,
  ) / 100;
  const microDrawdown = maxClose ? clamp((maxClose - current.close) / maxClose, 0, 1) : 0;
  const persistence = clamp(directionalDominance * 100, 0, 100) / 100;

  return {
    momentum: round(clamp(weightedMomentum, -1, 1)),
    volatility: round(clamp(realizedVol * cfg.volatilityScale, 0, 1)),
    trend: round(trendConfidence),
    volume: round(persistence),
    drawdown: round(microDrawdown),
  };
}

function signal(partial: Omit<UniversalSignal, "source">): UniversalSignal {
  return {
    source: "financial",
    ...partial,
  };
}

export function mapFinancialToUniversal(
  candles: FinancialCandle[],
  index: number,
  config: Partial<FinancialBranchConfig> = {},
): { input: UniversalCoreInput; signals: FinancialSignalVector } {
  const current = candles[index];
  const financialSignals = computeFinancialSignals(candles, index, config);
  const downside = Math.max(0, -financialSignals.momentum);
  const upside = Math.max(0, financialSignals.momentum);
  const crashPressure = clamp(Math.max(downside * 100, financialSignals.drawdown * 420, financialSignals.volatility * 90), 0, 100);
  const longOpportunity = clamp(upside * 100, 0, 100);
  const trendConfirmation = clamp(financialSignals.trend * 100, 0, 100);
  const volumeConfirmation = clamp(financialSignals.volume * 100, 0, 100);

  const universalSignals: UniversalSignal[] = [
    signal({
      id: `financial:momentum:${current.timestamp}`,
      category: "price_momentum",
      label: "Price momentum",
      value: financialSignals.momentum,
      normalized_score: downside > 0 ? crashPressure : clamp(20 + longOpportunity * 0.45, 0, 62),
      direction: financialSignals.momentum > 0 ? "up" : financialSignals.momentum < 0 ? "down" : "stable",
      severity_hint: downside > 0 ? crashPressure : clamp(30 + longOpportunity * 0.35, 0, 64),
      confidence_hint: 90,
      reliability_hint: 88,
      friction_hint: downside > 0 ? 18 : 6,
      risk_hint: downside > 0 ? crashPressure : 8,
      reversibility_hint: 78,
      expected_value_hint: downside > 0 ? crashPressure : clamp(45 + longOpportunity * 0.5, 0, 96),
      trend: {
        consecutive_count: Math.abs(financialSignals.momentum) > 0.5 ? 4 : 1,
        stability_score: 74,
      },
      evidence: [{ label: "s_momentum", value: financialSignals.momentum }],
      tags: downside > 0 ? ["financial", "sell", "hedge"] : ["financial", "buy", "long"],
    }),
    signal({
      id: `financial:volatility:${current.timestamp}`,
      category: "volatility_spike",
      label: "Volatility spike",
      value: financialSignals.volatility,
      normalized_score: clamp(financialSignals.volatility * 100),
      direction: financialSignals.volatility > 0.4 ? "up" : "stable",
      severity_hint: clamp(financialSignals.volatility * 100),
      confidence_hint: 88,
      reliability_hint: 86,
      friction_hint: 22,
      risk_hint: clamp(financialSignals.volatility * 100),
      reversibility_hint: 72,
      expected_value_hint: downside > 0 ? clamp(financialSignals.volatility * 85) : clamp(financialSignals.volatility * 35),
      trend: { consecutive_count: financialSignals.volatility > 0.5 ? 3 : 1, stability_score: 70 },
      evidence: [{ label: "s_volatility", value: financialSignals.volatility }],
      tags: ["financial", "risk"],
    }),
    signal({
      id: `financial:trend:${current.timestamp}`,
      category: "trend_strength",
      label: "Trend strength",
      value: financialSignals.trend,
      normalized_score: clamp(trendConfirmation * 0.65),
      direction: financialSignals.trend > 0 ? "up" : "stable",
      severity_hint: clamp(trendConfirmation * 0.55),
      confidence_hint: 86,
      reliability_hint: 84,
      friction_hint: 8,
      risk_hint: 5,
      reversibility_hint: 82,
      expected_value_hint: clamp(40 + trendConfirmation * 0.55),
      trend: { consecutive_count: financialSignals.trend > 0.03 ? 3 : 1, stability_score: 78 },
      evidence: [{ label: "s_trend", value: financialSignals.trend }],
      tags: ["financial", "buy", "trend"],
    }),
    signal({
      id: `financial:volume:${current.timestamp}`,
      category: "volume_confirmation",
      label: "Volume confirmation",
      value: financialSignals.volume,
      normalized_score: clamp(volumeConfirmation * 0.55),
      direction: financialSignals.volume > 0.75 ? "up" : "stable",
      severity_hint: clamp(volumeConfirmation * 0.45),
      confidence_hint: 84,
      reliability_hint: 82,
      friction_hint: 10,
      risk_hint: 6,
      reversibility_hint: 86,
      expected_value_hint: clamp(volumeConfirmation * 0.72),
      evidence: [{ label: "s_volume", value: financialSignals.volume }],
      tags: ["financial", "confirmation"],
    }),
    signal({
      id: `financial:drawdown:${current.timestamp}`,
      category: "drawdown_risk",
      label: "Drawdown risk",
      value: financialSignals.drawdown,
      normalized_score: clamp(financialSignals.drawdown * 520),
      direction: financialSignals.drawdown > 0 ? "down" : "stable",
      severity_hint: clamp(financialSignals.drawdown * 520),
      confidence_hint: 90,
      reliability_hint: 88,
      friction_hint: financialSignals.drawdown > 0.08 ? 24 : 14,
      risk_hint: clamp(financialSignals.drawdown * 620),
      reversibility_hint: 76,
      expected_value_hint: clamp(financialSignals.drawdown * 420),
      trend: { consecutive_count: financialSignals.drawdown > 0.08 ? 5 : 1, stability_score: 72 },
      evidence: [{ label: "s_drawdown", value: financialSignals.drawdown }],
      tags: ["financial", "sell", "hedge", "drawdown"],
    }),
  ];

  return {
    signals: financialSignals,
    input: {
      request_id: `financial:${current.timestamp}`,
      generated_at: current.timestamp,
      domain: "custom",
      context: {
        mode: "financial_branch",
        metadata: {
          branch: "financial",
          symbol: "BTC/USD",
          index,
          candle: current,
        },
      },
      signals: universalSignals,
      data_quality: {
        score: 90,
        completeness: 90,
        freshness: current.timestamp >= "2025-01-01" ? 84 : 78,
        consistency: 88,
        reliability: 88,
      },
      constraints: {
        allow_automation: false,
        require_confirmation: true,
        max_control_level: "suggest",
        safety_mode: false,
      },
    },
  };
}

export function mapFinancialMicroToUniversal(
  candles: FinancialCandle[],
  index: number,
  config: Partial<FinancialMicroBranchConfig> = {},
): { input: UniversalCoreInput; signals: FinancialSignalVector } {
  const current = candles[index];
  const financialSignals = computeFinancialMicroSignals(candles, index, config);
  const downside = Math.max(0, -financialSignals.momentum);
  const upside = Math.max(0, financialSignals.momentum);
  const crashPressure = clamp(
    downside * 115 + financialSignals.drawdown * 1800 + financialSignals.volatility * 85,
    0,
    100,
  );
  const longOpportunity = clamp(
    upside * 115 + financialSignals.trend * 28 + financialSignals.volume * 18,
    0,
    100,
  );
  const persistenceScore = clamp(financialSignals.volume * 100, 0, 100);

  const universalSignals: UniversalSignal[] = [
    signal({
      id: `financial:micro_momentum:${current.timestamp}`,
      category: "price_momentum",
      label: "Micro price momentum",
      value: financialSignals.momentum,
      normalized_score: downside > 0 ? crashPressure : clamp(18 + longOpportunity * 0.72, 0, 92),
      direction: financialSignals.momentum > 0 ? "up" : financialSignals.momentum < 0 ? "down" : "stable",
      severity_hint: downside > 0 ? crashPressure : clamp(20 + longOpportunity * 0.54, 0, 86),
      confidence_hint: clamp(58 + persistenceScore * 0.26, 0, 96),
      reliability_hint: clamp(52 + persistenceScore * 0.34, 0, 94),
      friction_hint: downside > 0 ? 16 : 5,
      risk_hint: downside > 0 ? crashPressure : 10,
      reversibility_hint: 82,
      expected_value_hint: downside > 0 ? clamp(crashPressure * 0.88) : clamp(40 + longOpportunity * 0.64, 0, 96),
      trend: {
        consecutive_count: Math.max(1, Math.round(1 + financialSignals.volume * 5)),
        stability_score: clamp(48 + persistenceScore * 0.42, 0, 95),
      },
      evidence: [{ label: "micro_momentum", value: financialSignals.momentum }],
      tags: downside > 0 ? ["financial", "micro", "sell"] : ["financial", "micro", "buy"],
    }),
    signal({
      id: `financial:micro_volatility:${current.timestamp}`,
      category: "volatility_spike",
      label: "Micro volatility",
      value: financialSignals.volatility,
      normalized_score: clamp(financialSignals.volatility * 100),
      direction: financialSignals.volatility > 0.45 ? "up" : "stable",
      severity_hint: clamp(financialSignals.volatility * 100),
      confidence_hint: 74,
      reliability_hint: 72,
      friction_hint: 18,
      risk_hint: clamp(financialSignals.volatility * 100),
      reversibility_hint: 76,
      expected_value_hint: clamp(financialSignals.volatility * 42),
      trend: { consecutive_count: 2, stability_score: 60 },
      evidence: [{ label: "micro_volatility", value: financialSignals.volatility }],
      tags: ["financial", "micro", "risk"],
    }),
    signal({
      id: `financial:micro_persistence:${current.timestamp}`,
      category: "volume_confirmation",
      label: "Directional persistence",
      value: financialSignals.volume,
      normalized_score: persistenceScore,
      direction: financialSignals.momentum === 0 ? "stable" : financialSignals.momentum > 0 ? "up" : "down",
      severity_hint: clamp(persistenceScore * 0.75),
      confidence_hint: clamp(60 + persistenceScore * 0.25, 0, 95),
      reliability_hint: clamp(58 + persistenceScore * 0.28, 0, 95),
      friction_hint: 6,
      risk_hint: 8,
      reversibility_hint: 84,
      expected_value_hint: clamp(28 + persistenceScore * 0.52),
      trend: { consecutive_count: Math.max(1, Math.round(1 + financialSignals.volume * 6)), stability_score: clamp(50 + persistenceScore * 0.3) },
      evidence: [{ label: "micro_persistence", value: financialSignals.volume }],
      tags: ["financial", "micro", "confirmation"],
    }),
    signal({
      id: `financial:micro_drawdown:${current.timestamp}`,
      category: "drawdown_risk",
      label: "Micro drawdown",
      value: financialSignals.drawdown,
      normalized_score: clamp(financialSignals.drawdown * 2200),
      direction: financialSignals.drawdown > 0 ? "down" : "stable",
      severity_hint: clamp(financialSignals.drawdown * 2200),
      confidence_hint: 80,
      reliability_hint: 78,
      friction_hint: 14,
      risk_hint: clamp(financialSignals.drawdown * 2400),
      reversibility_hint: 80,
      expected_value_hint: clamp(financialSignals.drawdown * 900),
      trend: { consecutive_count: financialSignals.drawdown > 0.001 ? 3 : 1, stability_score: 66 },
      evidence: [{ label: "micro_drawdown", value: financialSignals.drawdown }],
      tags: ["financial", "micro", "drawdown"],
    }),
  ];

  return {
    signals: financialSignals,
    input: {
      request_id: `financial:micro:${current.timestamp}`,
      generated_at: current.timestamp,
      domain: "custom",
      context: {
        mode: "financial_micro_branch",
        metadata: {
          branch: "financial_micro",
          symbol: "LIVE",
          index,
          candle: current,
        },
      },
      signals: universalSignals,
      data_quality: {
        score: 72,
        completeness: 62,
        freshness: 98,
        consistency: 78,
        reliability: 68,
      },
      constraints: {
        allow_automation: false,
        require_confirmation: true,
        max_control_level: "suggest",
        safety_mode: false,
      },
    },
  };
}

export function mapCoreOutputToFinancialAction(output: UniversalCoreOutput, signals: FinancialSignalVector): FinancialAction {
  if (
    output.state === "protection" ||
    output.risk.score > 70 ||
    signals.drawdown > 0.08 ||
    (signals.drawdown > 0.055 && signals.momentum < 0) ||
    (signals.momentum < -0.45 && output.risk.score >= 38)
  ) {
    return "SELL";
  }

  if (
    output.state === "attention" &&
    output.risk.score < 40 &&
    signals.momentum > 0.5
  ) {
    return "BUY";
  }

  if (
    signals.momentum > 0.5 &&
    output.risk.score < 45 &&
    output.priority.primary_action_id?.includes("momentum")
  ) {
    return "BUY";
  }

  if (
    signals.momentum > 0.35 &&
    signals.trend > 0.025 &&
    output.risk.score < 45
  ) {
    return "BUY";
  }

  if (
    signals.trend > 0.02 &&
    signals.drawdown < 0.05 &&
    output.risk.score < 42 &&
    output.state !== "protection"
  ) {
    return "BUY";
  }

  return "HOLD";
}

export function mapCoreOutputToFinancialActionV3(output: UniversalCoreOutput, signals: FinancialSignalVector): FinancialAction {
  const primaryActionId = output.priority.primary_action_id ?? "";
  const primaryIsSellDriver =
    primaryActionId.includes("drawdown") ||
    primaryActionId.includes("volatility") ||
    (primaryActionId.includes("momentum") && signals.momentum < 0);
  const primaryIsBuyDriver =
    primaryActionId.includes("trend") ||
    primaryActionId.includes("volume") ||
    (primaryActionId.includes("momentum") && signals.momentum > 0);

  if (
    output.state === "blocked" ||
    output.state === "protection" ||
    output.risk.score >= 65 ||
    primaryIsSellDriver
  ) {
    return "SELL";
  }

  if (
    (output.state === "ok" || output.state === "attention") &&
    output.risk.score < 38 &&
    primaryIsBuyDriver &&
    signals.drawdown <= 0.03
  ) {
    return "BUY";
  }

  return "HOLD";
}

export function runFinancialHypothesisSelector(
  output: UniversalCoreOutput,
  signals: FinancialSignalVector,
): FinancialHypothesisOutput {
  const riskScore = output.risk.score;
  const downside = Math.max(0, -signals.momentum) * 100;
  const upside = Math.max(0, signals.momentum) * 100;
  const downsidePressure = Math.max(0, downside - 18);
  const drawdownPct = signals.drawdown * 100;
  const volatilityPct = signals.volatility * 100;
  const trendPct = signals.trend * 100;
  const volumePct = signals.volume * 100;
  const continuationSetup = signals.trend >= 0.03 && signals.drawdown <= 0.03;
  const primaryActionId = output.priority.primary_action_id ?? "";
  const primaryIsSellDriver =
    primaryActionId.includes("drawdown") ||
    primaryActionId.includes("volatility") ||
    (primaryActionId.includes("momentum") && signals.momentum < 0);
  const primaryIsBuyDriver =
    primaryActionId.includes("trend") ||
    primaryActionId.includes("volume") ||
    (primaryActionId.includes("momentum") && signals.momentum > 0);

  const sellScore = clamp(
    10 +
      downsidePressure * 1.08 +
      drawdownPct * 4.8 +
      volatilityPct * 0.52 +
      riskScore * 0.58 +
      (output.state === "blocked" ? 28 : 0) +
      (output.state === "protection" ? 22 : 0) +
      (primaryIsSellDriver ? 16 : 0) -
      trendPct * 0.3 -
      (continuationSetup ? 8 : 0) -
      volumePct * 0.08,
  );

  const buyScore = clamp(
    8 +
      upside * 0.92 +
      trendPct * 0.82 +
      volumePct * 0.24 +
      (continuationSetup ? 14 : 0) +
      (signals.momentum >= -0.12 ? 8 : 0) +
      (output.state === "ok" ? 10 : 0) +
      (output.state === "attention" ? 5 : 0) +
      (primaryIsBuyDriver ? 15 : 0) -
      riskScore * 0.7 -
      drawdownPct * 1.85 -
      volatilityPct * 0.42,
  );

  const holdScore = clamp(
    28 +
      Math.max(0, 18 - Math.abs(buyScore - sellScore) * 0.55) +
      (riskScore >= 35 && riskScore <= 58 ? 10 : 0) +
      (signals.drawdown > 0.03 ? 5 : 0) +
      (signals.trend < 0.025 ? 6 : 0),
  );

  const ranked = ([
    ["buy", buyScore],
    ["sell", sellScore],
    ["hold", holdScore],
  ] as const).toSorted((a, b) => b[1] - a[1]);

  const winner = ranked[0];
  const second = ranked[1];
  const marginToSecond = round(winner[1] - second[1], 6);
  const ambiguityScore = round(clamp(100 - marginToSecond * 6), 6);
  const reasonSeeds: string[] = [];

  if (winner[0] === "sell") {
    if (downside > 22) reasonSeeds.push("downside_momentum");
    if (drawdownPct > 3) reasonSeeds.push("drawdown_pressure");
    if (primaryIsSellDriver) reasonSeeds.push("core_sell_priority");
  } else if (winner[0] === "buy") {
    if (upside > 20) reasonSeeds.push("upside_momentum");
    if (trendPct > 3) reasonSeeds.push("trend_confirmation");
    if (primaryIsBuyDriver) reasonSeeds.push("core_buy_priority");
  } else {
    reasonSeeds.push("ambiguity_hold");
    if (riskScore >= 35) reasonSeeds.push("mid_risk_neutrality");
  }

  const recommendedAction: FinancialAction =
    winner[0] === "sell"
      ? "SELL"
      : winner[0] === "buy"
        ? "BUY"
        : "HOLD";

  return {
    selected_action_family: winner[0],
    candidate_scores: {
      buy: round(buyScore, 6),
      sell: round(sellScore, 6),
      hold: round(holdScore, 6),
    },
    margin_to_second: marginToSecond,
    ambiguity_score: ambiguityScore,
    recommended_action: recommendedAction,
    reason_seeds: reasonSeeds,
  };
}

export function applyFinancialVisionContext(
  hypothesis: FinancialHypothesisOutput,
  signals: FinancialSignalVector,
  visionContext: FinancialVisionContext,
): FinancialHypothesisOutput {
  let buy = hypothesis.candidate_scores.buy;
  let sell = hypothesis.candidate_scores.sell;
  let hold = hypothesis.candidate_scores.hold;
  const reasons = [...hypothesis.reason_seeds, `vision_stage:${visionContext.stage}`];

  if (visionContext.stage === "monitor") {
    hold = clamp(hold + 12 + visionContext.confidence * 0.04);
    buy = clamp(buy - 4);
    sell = clamp(sell - 4);
    reasons.push("vision_monitor_prefers_hold");
  } else if (visionContext.stage === "micro") {
    hold = clamp(hold - 5);
    if (signals.momentum > 0.08) buy = clamp(buy + 6);
    if (signals.momentum < -0.08) sell = clamp(sell + 6);
    reasons.push("vision_micro_prefers_directionality");
  } else if (visionContext.stage === "strategy") {
    const strongBuySetup =
      signals.trend >= 0.03 &&
      signals.drawdown <= 0.02 &&
      signals.momentum >= 0.18;
    const strongSellSetup =
      signals.drawdown > 0.05 ||
      signals.momentum < -0.22;

    if (strongBuySetup && hypothesis.selected_action_family !== "sell") {
      buy = clamp(buy + 2.5);
      hold = clamp(hold - 1.5);
    }

    if (strongSellSetup && hypothesis.selected_action_family !== "buy") {
      sell = clamp(sell + 3);
      hold = clamp(hold - 1);
    }

    reasons.push("vision_strategy_prefers_actionable_signal");
  } else if (visionContext.stage === "product") {
    hold = clamp(hold + 8);
    reasons.push("vision_product_blocks_trading_bias");
  }

  const ranked = ([
    ["buy", buy],
    ["sell", sell],
    ["hold", hold],
  ] as const).toSorted((a, b) => b[1] - a[1]);
  const winner = ranked[0];
  const second = ranked[1];
  const marginToSecond = round(winner[1] - second[1], 6);
  const ambiguityScore = round(clamp(100 - marginToSecond * 6), 6);

  return {
    selected_action_family: winner[0],
    candidate_scores: {
      buy: round(buy, 6),
      sell: round(sell, 6),
      hold: round(hold, 6),
    },
    margin_to_second: marginToSecond,
    ambiguity_score: ambiguityScore,
    recommended_action: winner[0] === "buy" ? "BUY" : winner[0] === "sell" ? "SELL" : "HOLD",
    reason_seeds: reasons,
  };
}

export function applyFinancialLearningContext(
  hypothesis: FinancialHypothesisOutput,
  signals: FinancialSignalVector,
  learningContext?: FinancialLearningContext,
): FinancialHypothesisOutput {
  if (!learningContext || learningContext.mode === "off") return hypothesis;

  let buy = hypothesis.candidate_scores.buy;
  let sell = hypothesis.candidate_scores.sell;
  let hold = hypothesis.candidate_scores.hold;
  const reasons = [...hypothesis.reason_seeds, `financial_learning_mode:${learningContext.mode}`];

  if (learningContext.mode === "summary") {
    reasons.push("financial_learning_summary_only");
    return {
      ...hypothesis,
      reason_seeds: reasons,
    };
  }

  const trendConfirmed = signals.trend >= 0.03;
  const manageableDrawdown = signals.drawdown <= 0.03;
  const adverseDrawdown = signals.drawdown >= 0.05;
  const positiveMomentum = signals.momentum >= -0.08;
  const negativeMomentum = signals.momentum <= -0.18;
  const fractalEnabled = hasFractalLearningOverlay(learningContext);
  const archiveDomain = inferFinancialArchiveDomain(learningContext?.pack, signals);
  const archiveLogic = loadCompressedFinancialLogicChain(archiveDomain);
  const hasHistoricalMonetaryRegimeMemory =
    Boolean(learningContext?.pack?.risk_rules?.some((rule) => /regime monetario|gold standard|bretton woods/i.test(rule))) ||
    Boolean(learningContext?.pack?.scenario_templates?.some((scenario) => /regime monetario|gold standard|bretton woods|finanza moderna/i.test(scenario.prompt)));
  const fractalTrendAlignment =
    signals.trend >= 0.028 &&
    signals.volume >= 0.72 &&
    signals.drawdown <= 0.028 &&
    signals.momentum >= -0.04;
  const fractalNoiseZone =
    signals.volatility >= 0.30 &&
    Math.abs(signals.momentum) <= 0.08 &&
    signals.trend <= 0.022;
  const fractalCascadeRisk =
    signals.drawdown >= 0.04 &&
    signals.momentum <= -0.12;

  if (trendConfirmed && manageableDrawdown && positiveMomentum) {
    buy = clamp(buy + 2.8);
    hold = clamp(hold - 1.8);
    reasons.push("learning_continuation_confirmation");
  }

  if (adverseDrawdown && negativeMomentum) {
    sell = clamp(sell + 3.6);
    hold = clamp(hold - 1.6);
    reasons.push("learning_drawdown_risk_rule");
  }

  if (signals.volatility >= 0.38 && Math.abs(signals.momentum) < 0.1) {
    hold = clamp(hold + 2.2);
    buy = clamp(buy - 1.1);
    sell = clamp(sell - 1.1);
    reasons.push("learning_ambiguous_volatility_rule");
  }

  if (fractalEnabled && fractalTrendAlignment) {
    buy = clamp(buy + 6.8);
    hold = clamp(hold - 3.4);
    reasons.push("fractal_multi_scale_trend_alignment");
  }

  if (fractalEnabled && fractalNoiseZone) {
    hold = clamp(hold + 4.4);
    buy = clamp(buy - 2.1);
    sell = clamp(sell - 1.7);
    reasons.push("fractal_noise_rejection");
  }

  if (fractalEnabled && fractalCascadeRisk) {
    sell = clamp(sell + 6.2);
    hold = clamp(hold - 2.6);
    reasons.push("fractal_cascade_risk");
  }

  const archiveHasContextConfirmation = archiveLogic.some((entry) => /conferma del contesto/i.test(entry));
  const archiveHasRegimePriority = archiveLogic.some((entry) => /cambio regime batte pattern locale/i.test(entry));
  const archiveHasFundingLiquidationRisk = archiveLogic.some((entry) => /funding|liquidazioni/i.test(entry));

  if (archiveHasContextConfirmation && trendConfirmed && manageableDrawdown && positiveMomentum) {
    buy = clamp(buy + 1.8);
    hold = clamp(hold - 0.8);
    reasons.push(`archive_context_confirmation:${archiveDomain}`);
  }

  if (archiveHasRegimePriority && signals.volatility >= 0.24 && signals.trend <= 0.022) {
    hold = clamp(hold + 2.6);
    buy = clamp(buy - 0.9);
    sell = clamp(sell - 0.6);
    reasons.push(`archive_regime_guard:${archiveDomain}`);
  }

  if (archiveHasRegimePriority && adverseDrawdown && negativeMomentum) {
    sell = clamp(sell + 1.9);
    hold = clamp(hold - 0.8);
    reasons.push(`archive_regime_sell_guard:${archiveDomain}`);
  }

  if (archiveHasFundingLiquidationRisk && signals.volatility >= 0.28) {
    hold = clamp(hold + 1.5);
    if (signals.momentum <= -0.08) sell = clamp(sell + 1.1);
    reasons.push(`archive_microstructure_risk:${archiveDomain}`);
  }

  if (
    hasHistoricalMonetaryRegimeMemory &&
    signals.volatility >= 0.24 &&
    signals.trend <= 0.024
  ) {
    hold = clamp(hold + 2.4);
    buy = clamp(buy - 1.2);
    reasons.push(`history_monetary_regime_guard:${archiveDomain}`);
  }

  if (
    hasHistoricalMonetaryRegimeMemory &&
    signals.drawdown >= 0.035 &&
    signals.momentum <= -0.08
  ) {
    sell = clamp(sell + 1.6);
    hold = clamp(hold + 0.8);
    reasons.push(`history_regime_break_sell_bias:${archiveDomain}`);
  }

  const ranked = ([
    ["buy", buy],
    ["sell", sell],
    ["hold", hold],
  ] as const).toSorted((a, b) => b[1] - a[1]);
  const winner = ranked[0];
  const second = ranked[1];

  return {
    selected_action_family: winner[0],
    candidate_scores: {
      buy: round(buy, 6),
      sell: round(sell, 6),
      hold: round(hold, 6),
    },
    margin_to_second: round(winner[1] - second[1], 6),
    ambiguity_score: round(clamp(100 - (winner[1] - second[1]) * 6), 6),
    recommended_action: winner[0] === "buy" ? "BUY" : winner[0] === "sell" ? "SELL" : "HOLD",
    reason_seeds: reasons,
  };
}

export function applyFinancialScenarioSweep(
  output: UniversalCoreOutput,
  signals: FinancialSignalVector,
  hypothesis: FinancialHypothesisOutput,
  visionContext: FinancialVisionContext,
  learningContext?: FinancialLearningContext,
): FinancialScenarioSweepOutput {
  const momentumBiases = [0.85, 1, 1.15, 1.3];
  const riskBiases = [0.8, 1, 1.15];
  const holdBiases = [0.85, 1, 1.15];
  const continuationBiases = [0.9, 1.05, 1.2];
  const reversalBiases = [0.9, 1.05, 1.2];
  const stageBiases = [0.9, 1, 1.1, 1.2];

  const continuationSetup =
    signals.trend >= 0.025 &&
    signals.drawdown <= 0.03 &&
    signals.momentum >= -0.12;
  const reversalRisk =
    signals.drawdown >= 0.045 ||
    signals.momentum <= -0.18 ||
    output.state === "protection";
  const ambiguousZone =
    !continuationSetup &&
    !reversalRisk &&
    hypothesis.ambiguity_score >= 68;
  const stageDirectionalBias =
    visionContext.stage === "micro" || visionContext.stage === "strategy" ? 1.08 : 0.96;
  const learningDirectionalBias =
    learningContext?.mode === "god_mode_full" ? 1.04 : 1;
  const fractalEnabled = hasFractalLearningOverlay(learningContext);
  const fractalTrendAlignment =
    signals.trend >= 0.028 &&
    signals.volume >= 0.72 &&
    signals.drawdown <= 0.028 &&
    signals.momentum >= -0.04;
  const fractalNoiseZone =
    signals.volatility >= 0.30 &&
    Math.abs(signals.momentum) <= 0.08 &&
    signals.trend <= 0.022;
  const fractalCascadeRisk =
    signals.drawdown >= 0.04 &&
    signals.momentum <= -0.12;

  let scenarioCount = 0;
  let voteBuy = 0;
  let voteSell = 0;
  let voteHold = 0;
  let buyWeighted = 0;
  let sellWeighted = 0;
  let holdWeighted = 0;
  let totalWeight = 0;

  for (const momentumBias of momentumBiases) {
    for (const riskBias of riskBiases) {
      for (const holdBias of holdBiases) {
        for (const continuationBias of continuationBiases) {
          for (const reversalBias of reversalBiases) {
            for (const stageBias of stageBiases) {
              scenarioCount += 1;
              let buy = hypothesis.candidate_scores.buy * momentumBias * stageDirectionalBias * learningDirectionalBias;
              let sell = hypothesis.candidate_scores.sell * riskBias * stageDirectionalBias;
              let hold = hypothesis.candidate_scores.hold * holdBias;
              let weight = 1;

              if (continuationSetup) {
                buy += 7.5 * continuationBias;
                hold -= 3.2 * continuationBias;
                weight *= 1.18;
              }

              if (reversalRisk) {
                sell += 8.4 * reversalBias;
                hold -= 2.4 * reversalBias;
                weight *= 1.18;
              }

              if (ambiguousZone) {
                hold += 5.4 * holdBias;
                weight *= 1.06;
              }

              if (signals.volume >= 0.85 && signals.trend >= 0.03) {
                buy += 2.6 * continuationBias;
              }

              if (signals.volatility >= 0.45 && Math.abs(signals.momentum) < 0.08) {
                hold += 4.2;
              }

              if (signals.drawdown >= 0.06) {
                sell += 4.4 * reversalBias;
              }

              if (fractalEnabled && fractalTrendAlignment) {
                buy += 8.8 * continuationBias;
                hold -= 3.1;
                weight *= 1.04;
              }

              if (fractalEnabled && fractalNoiseZone) {
                hold += 4.6 * holdBias;
                buy -= 1.8;
                sell -= 1.5;
                weight *= 1.03;
              }

              if (fractalEnabled && fractalCascadeRisk) {
                sell += 8.4 * reversalBias;
                hold -= 2.7;
                weight *= 1.04;
              }

              if (visionContext.stage === "monitor" || visionContext.stage === "product") {
                hold += 2.8 * stageBias;
              } else if (visionContext.stage === "strategy" && continuationSetup) {
                buy += 2.1 * stageBias;
              } else if (visionContext.stage === "micro" && reversalRisk) {
                sell += 1.7 * stageBias;
              }

              if (output.risk.score >= 42 && output.risk.score <= 55 && !continuationSetup && !reversalRisk) {
                hold += 2.5;
              }

              buy = clamp(buy);
              sell = clamp(sell);
              hold = clamp(hold);

              const ranked = ([
                ["buy", buy],
                ["sell", sell],
                ["hold", hold],
              ] as const).toSorted((a, b) => b[1] - a[1]);
              const winner = ranked[0][0];

              if (winner === "buy") voteBuy += weight;
              else if (winner === "sell") voteSell += weight;
              else voteHold += weight;

              buyWeighted += buy * weight;
              sellWeighted += sell * weight;
              holdWeighted += hold * weight;
              totalWeight += weight;
            }
          }
        }
      }
    }
  }

  const buyScore = totalWeight ? round(buyWeighted / totalWeight, 6) : hypothesis.candidate_scores.buy;
  const sellScore = totalWeight ? round(sellWeighted / totalWeight, 6) : hypothesis.candidate_scores.sell;
  const holdScore = totalWeight ? round(holdWeighted / totalWeight, 6) : hypothesis.candidate_scores.hold;
  const ranked = ([
    ["buy", buyScore],
    ["sell", sellScore],
    ["hold", holdScore],
  ] as const).toSorted((a, b) => b[1] - a[1]);
  const winner = ranked[0];
  const second = ranked[1];

  return {
    selected_action_family: winner[0],
    candidate_scores: {
      buy: buyScore,
      sell: sellScore,
      hold: holdScore,
    },
    margin_to_second: round(winner[1] - second[1], 6),
    ambiguity_score: round(clamp(100 - (winner[1] - second[1]) * 6), 6),
    recommended_action: winner[0] === "buy" ? "BUY" : winner[0] === "sell" ? "SELL" : "HOLD",
    reason_seeds: [
      ...hypothesis.reason_seeds,
      `scenario_sweep:${scenarioCount}`,
      continuationSetup ? "scenario_continuation_bias" : "scenario_no_continuation_bias",
      reversalRisk ? "scenario_reversal_guard" : "scenario_no_reversal_guard",
    ],
    scenario_count: scenarioCount,
    vote_distribution: {
      buy: round(voteBuy, 6),
      sell: round(voteSell, 6),
      hold: round(voteHold, 6),
    },
  };
}

export function mapCoreOutputToFinancialActionV4(
  output: UniversalCoreOutput,
  signals: FinancialSignalVector,
  hypothesis: FinancialHypothesisOutput,
): FinancialAction {
  const selected = hypothesis.selected_action_family;
  const sellScore = hypothesis.candidate_scores.sell;
  const buyScore = hypothesis.candidate_scores.buy;
  const margin = hypothesis.margin_to_second;
  const ambiguity = hypothesis.ambiguity_score;
  const fractalTrendAlignment = hypothesis.reason_seeds.includes("fractal_multi_scale_trend_alignment");
  const fractalNoiseRejection = hypothesis.reason_seeds.includes("fractal_noise_rejection");
  const fractalCascadeRisk = hypothesis.reason_seeds.includes("fractal_cascade_risk");
  const continuationBuySetup =
    selected === "hold" &&
    buyScore >= 39 &&
    sellScore <= 36 &&
    signals.trend >= 0.03 &&
    signals.drawdown <= 0.03 &&
    signals.momentum >= -0.12 &&
    output.risk.score < 36;

  if (
    selected === "sell" &&
    sellScore >= 54 &&
    margin >= 5 &&
    ambiguity <= 70
  ) {
    return "SELL";
  }

  if (
    fractalCascadeRisk &&
    sellScore >= 47 &&
    margin >= 2 &&
    signals.drawdown >= 0.035
  ) {
    return "SELL";
  }

  if (continuationBuySetup) {
    return "BUY";
  }

  if (
    fractalTrendAlignment &&
    buyScore >= 46 &&
    margin >= 2 &&
    output.risk.score < 40 &&
    signals.drawdown <= 0.03
  ) {
    return "BUY";
  }

  if (
    fractalNoiseRejection &&
    ambiguity >= 58 &&
    sellScore < 58 &&
    buyScore < 58
  ) {
    return "HOLD";
  }

  if (
    selected === "buy" &&
    buyScore >= 52 &&
    margin >= 4 &&
    ambiguity <= 76 &&
    output.risk.score < 40 &&
    signals.drawdown <= 0.03
  ) {
    return "BUY";
  }

  return "HOLD";
}

export function explainFinancialDecision(output: UniversalCoreOutput, signals: FinancialSignalVector, action: FinancialAction): string {
  if (action === "SELL") {
    return `SELL/HEDGE: rischio ${output.risk.score.toFixed(1)}, stato ${output.state}, drawdown ${signals.drawdown.toFixed(3)}, momentum ${signals.momentum.toFixed(3)}.`;
  }

  if (action === "BUY") {
    return `BUY/LONG: momentum ${signals.momentum.toFixed(3)} con rischio ${output.risk.score.toFixed(1)} e stato ${output.state}.`;
  }

  return `HOLD: segnali non sufficienti per azione direzionale; stato ${output.state}, rischio ${output.risk.score.toFixed(1)}.`;
}

export function mapCoreOutputToFinancialMicroAction(
  output: UniversalCoreOutput,
  signals: FinancialSignalVector,
): FinancialAction {
  const primaryActionId = output.priority.primary_action_id ?? "";
  const strongDownside = signals.momentum <= -0.11 && signals.drawdown >= 0.0002;
  const strongUpside = signals.momentum >= 0.11 && signals.trend >= 0.16;

  if (
    output.state === "blocked" ||
    output.state === "protection" ||
    output.risk.score >= 54 ||
    strongDownside ||
    primaryActionId.includes("drawdown")
  ) {
    return "SELL";
  }

  if (
    (output.state === "ok" || output.state === "attention") &&
    output.risk.score <= 42 &&
    strongUpside &&
    signals.volume >= 0.28 &&
    !primaryActionId.includes("drawdown")
  ) {
    return "BUY";
  }

  return "HOLD";
}

export function runFinancialMicroBranch(
  candles: FinancialCandle[],
  index: number,
  config: Partial<FinancialMicroBranchConfig> = {},
): FinancialBranchDecision {
  const { input, signals } = mapFinancialMicroToUniversal(candles, index, config);
  const coreOutput = runUniversalCore(input);
  const financialAction = mapCoreOutputToFinancialMicroAction(coreOutput, signals);

  return {
    core_state: coreOutput.state,
    risk: coreOutput.risk,
    priority: coreOutput.priority,
    financial_action: financialAction,
    reasoning: explainFinancialDecision(coreOutput, signals, financialAction),
    signals,
    core_output: coreOutput,
  };
}

export function computeFinancialMicrostructureSignals(
  snapshots: FinancialMicrostructureSnapshot[],
  index: number,
): FinancialMicrostructureSignalVector {
  const current = snapshots[index];
  const previous = snapshots[Math.max(0, index - 1)] ?? current;
  const window = snapshots.slice(Math.max(0, index - 14), index + 1);
  const shortWindow = window.slice(-5);
  const mediumWindow = window.slice(-10);
  const prices = window.map((snapshot) => snapshot.last_price);
  const spreads = window.map((snapshot) => {
    const mid = (snapshot.bid_price + snapshot.ask_price) / 2 || snapshot.last_price || 1;
    return mid ? ((snapshot.ask_price - snapshot.bid_price) / mid) * 10_000 : 0;
  });
  const bookImbalances = window.map((snapshot) => {
    const denominator = snapshot.bid_size + snapshot.ask_size || 1;
    return (snapshot.bid_size - snapshot.ask_size) / denominator;
  });
  const flowImbalances = window.map((snapshot) => {
    const denominator = snapshot.buy_trade_size + snapshot.sell_trade_size || 1;
    return (snapshot.buy_trade_size - snapshot.sell_trade_size) / denominator;
  });
  const returns = prices.map((price, priceIndex) => (priceIndex === 0 ? 0 : pctChange(prices[priceIndex - 1], price)));
  const microPriceChange = pctChange(previous.last_price, current.last_price);
  const spreadMid = (current.bid_price + current.ask_price) / 2 || current.last_price || 1;
  const spreadBps = spreadMid ? ((current.ask_price - current.bid_price) / spreadMid) * 10_000 : 0;
  const bookDenominator = current.bid_size + current.ask_size || 1;
  const tradeDenominator = current.buy_trade_size + current.sell_trade_size || 1;
  const depthDenominator = current.bid_depth_5 + current.ask_depth_5 || 1;
  const orderBookImbalance = (current.bid_size - current.ask_size) / bookDenominator;
  const tradeFlowImbalance = (current.buy_trade_size - current.sell_trade_size) / tradeDenominator;
  const depthImbalance = (current.bid_depth_5 - current.ask_depth_5) / depthDenominator;
  const realizedVol = std(returns.slice(1));
  const spreadAverage = average(spreads) || spreadBps || 1;
  const priorFlowAverage = average(flowImbalances.slice(0, -1));
  const shortReturn = shortWindow.length >= 2 ? pctChange(shortWindow[0]!.last_price, shortWindow[shortWindow.length - 1]!.last_price) : 0;
  const mediumReturn = mediumWindow.length >= 2 ? pctChange(mediumWindow[0]!.last_price, mediumWindow[mediumWindow.length - 1]!.last_price) : 0;
  const shortFlow = average(shortWindow.map((snapshot) => {
    const denominator = snapshot.buy_trade_size + snapshot.sell_trade_size || 1;
    return (snapshot.buy_trade_size - snapshot.sell_trade_size) / denominator;
  }));
  const mediumFlow = average(mediumWindow.map((snapshot) => {
    const denominator = snapshot.buy_trade_size + snapshot.sell_trade_size || 1;
    return (snapshot.buy_trade_size - snapshot.sell_trade_size) / denominator;
  }));
  const shortDepth = average(shortWindow.map((snapshot) => {
    const denominator = snapshot.bid_depth_5 + snapshot.ask_depth_5 || 1;
    return (snapshot.bid_depth_5 - snapshot.ask_depth_5) / denominator;
  }));
  const mediumDepth = average(mediumWindow.map((snapshot) => {
    const denominator = snapshot.bid_depth_5 + snapshot.ask_depth_5 || 1;
    return (snapshot.bid_depth_5 - snapshot.ask_depth_5) / denominator;
  }));
  const momentumScore = clamp(
    microPriceChange * 260 +
      average(returns.slice(-3)) * 220 +
      tradeFlowImbalance * 55 +
      orderBookImbalance * 35 +
      depthImbalance * 26,
    -1,
    1,
  );
  const trendScore = clamp(
    Math.max(0, momentumScore) * 0.65 +
      Math.max(0, tradeFlowImbalance) * 0.28 +
      Math.max(0, orderBookImbalance) * 0.18 +
      Math.max(0, depthImbalance) * 0.16,
    0,
    1,
  );
  const flowPersistence = clamp(
    Math.abs(tradeFlowImbalance) * 0.72 + Math.abs(orderBookImbalance) * 0.24,
    0,
    1,
  );
  const localPeak = Math.max(...prices);
  const drawdown = localPeak ? clamp((localPeak - current.last_price) / localPeak, 0, 1) : 0;
  const flowDecay = clamp(
    Math.abs(priorFlowAverage) > 0.01
      ? (Math.abs(priorFlowAverage) - Math.abs(tradeFlowImbalance)) / Math.abs(priorFlowAverage)
      : 0,
    -1,
    1,
  );
  const spreadRegimeShift = clamp(
    spreadAverage
      ? (spreadBps - spreadAverage) / spreadAverage
      : 0,
    -1,
    1,
  );
  const exhaustionScore = clamp(
    Math.max(0, Math.abs(tradeFlowImbalance) - Math.abs(orderBookImbalance)) * 1.6 +
      Math.max(0, flowDecay) * 0.9 +
      Math.max(0, spreadRegimeShift) * 0.7,
    0,
    1,
  );
  const breakoutFailureRisk = clamp(
    Math.max(0, Math.abs(microPriceChange) * 180) * 0.25 +
      Math.max(0, -tradeFlowImbalance * orderBookImbalance) * 1.4 +
      Math.max(0, spreadRegimeShift) * 0.8 +
      Math.max(0, flowDecay) * 0.9,
    0,
    1,
  );
  const horizonAlignment = clamp(
    Math.max(0, shortReturn * 280) * 0.34 +
      Math.max(0, mediumReturn * 220) * 0.26 +
      Math.max(0, shortFlow) * 0.22 +
      Math.max(0, mediumFlow) * 0.18 +
      Math.max(0, shortDepth) * 0.16 +
      Math.max(0, mediumDepth) * 0.14 -
      Math.max(0, spreadRegimeShift) * 0.25,
    0,
    1,
  );
  const longSetupScore = clamp(
    Math.max(0, momentumScore) * 0.24 +
      Math.max(0, tradeFlowImbalance) * 0.18 +
      Math.max(0, orderBookImbalance) * 0.14 +
      Math.max(0, depthImbalance) * 0.2 +
      horizonAlignment * 0.24 -
      breakoutFailureRisk * 0.12,
    0,
    1,
  );
  const reversalSetupScore = clamp(
    Math.max(0, -momentumScore) * 0.22 +
      Math.max(0, -tradeFlowImbalance) * 0.14 +
      Math.max(0, -orderBookImbalance) * 0.12 +
      exhaustionScore * 0.24 +
      breakoutFailureRisk * 0.2 +
      Math.max(0, spreadRegimeShift) * 0.08,
    0,
    1,
  );

  return {
    momentum: round(momentumScore),
    volatility: round(clamp(realizedVol * 380, 0, 1)),
    trend: round(trendScore),
    volume: round(flowPersistence),
    drawdown: round(drawdown),
    spread_bps: round(spreadBps),
    order_book_imbalance: round(orderBookImbalance),
    trade_flow_imbalance: round(tradeFlowImbalance),
    depth_imbalance: round(depthImbalance),
    micro_price_change: round(microPriceChange),
    flow_decay: round(flowDecay),
    spread_regime_shift: round(spreadRegimeShift),
    exhaustion_score: round(exhaustionScore),
    breakout_failure_risk: round(breakoutFailureRisk),
    long_setup_score: round(longSetupScore),
    reversal_setup_score: round(reversalSetupScore),
    horizon_alignment: round(horizonAlignment),
  };
}

export function deriveFinancialMicrostructureScenario(
  signals: FinancialMicrostructureSignalVector,
): FinancialMicrostructureScenario {
  if (
    signals.long_setup_score >= 0.34 &&
    signals.trade_flow_imbalance >= 0.04 &&
    signals.depth_imbalance >= 0.04 &&
    signals.spread_regime_shift <= 0.16 &&
    signals.breakout_failure_risk <= 0.34
  ) {
    return "continuation_burst";
  }

  if (
    signals.reversal_setup_score >= 0.4 &&
    signals.momentum <= -0.08 &&
    signals.exhaustion_score >= 0.42 &&
    signals.breakout_failure_risk >= 0.3
  ) {
    return "exhaustion_reversal";
  }

  if (
    Math.abs(signals.momentum) >= 0.08 &&
    signals.breakout_failure_risk >= 0.46 &&
    signals.spread_regime_shift >= 0.24
  ) {
    return "fake_breakout";
  }

  if (
    signals.long_setup_score >= 0.28 &&
    signals.order_book_imbalance >= 0.08 &&
    signals.trade_flow_imbalance >= -0.05 &&
    signals.flow_decay <= 0.16 &&
    signals.spread_regime_shift <= 0.14 &&
    signals.breakout_failure_risk <= 0.42
  ) {
    return "absorption";
  }

  return "neutral_compression";
}

export function mapFinancialMicrostructureToUniversal(
  snapshots: FinancialMicrostructureSnapshot[],
  index: number,
): { input: UniversalCoreInput; signals: FinancialMicrostructureSignalVector } {
  const current = snapshots[index];
  const signals = computeFinancialMicrostructureSignals(snapshots, index);
  const scenario = deriveFinancialMicrostructureScenario(signals);
  const downside = Math.max(0, -signals.momentum);
  const upside = Math.max(0, signals.momentum);
  const sellPressure = clamp(
    downside * 100 +
      Math.max(0, -signals.trade_flow_imbalance) * 42 +
      Math.max(0, -signals.order_book_imbalance) * 26 +
      Math.max(0, -signals.depth_imbalance) * 24 +
      signals.spread_bps * 3.4,
    0,
    100,
  );
  const buyPressure = clamp(
    upside * 100 +
      Math.max(0, signals.trade_flow_imbalance) * 42 +
      Math.max(0, signals.order_book_imbalance) * 26 -
      Math.max(0, -signals.depth_imbalance) * 8 +
      Math.max(0, signals.depth_imbalance) * 22 -
      signals.spread_bps * 2.2,
    0,
    100,
  );

  const universalSignals: UniversalSignal[] = [
    signal({
      id: `financial:microstructure_flow:${current.timestamp}`,
      category: "price_momentum",
      label: "Microstructure flow",
      value: signals.momentum,
      normalized_score: signals.momentum < 0 ? sellPressure : buyPressure,
      direction: signals.momentum > 0 ? "up" : signals.momentum < 0 ? "down" : "stable",
      severity_hint: signals.momentum < 0 ? sellPressure : buyPressure,
      confidence_hint: clamp(62 + signals.volume * 28, 0, 96),
      reliability_hint: clamp(58 + signals.volume * 24, 0, 94),
      friction_hint: clamp(4 + signals.spread_bps * 4, 0, 28),
      risk_hint: signals.momentum < 0 ? sellPressure : clamp(signals.spread_bps * 2.4, 0, 34),
      reversibility_hint: 84,
      expected_value_hint: signals.momentum > 0 ? buyPressure : clamp(sellPressure * 0.72),
      trend: {
        consecutive_count: Math.max(1, Math.round(1 + signals.volume * 5)),
        stability_score: clamp(48 + signals.volume * 30, 0, 96),
      },
      evidence: [
        { label: "trade_flow_imbalance", value: signals.trade_flow_imbalance },
        { label: "order_book_imbalance", value: signals.order_book_imbalance },
        { label: "depth_imbalance", value: signals.depth_imbalance },
      ],
      tags: ["financial", "microstructure", scenario, signals.momentum < 0 ? "sell" : "buy"],
    }),
    signal({
      id: `financial:microstructure_spread:${current.timestamp}`,
      category: "volatility_spike",
      label: "Spread pressure",
      value: signals.spread_bps,
      normalized_score: clamp(signals.spread_bps * 8),
      direction: signals.spread_bps > 1.2 ? "up" : "stable",
      severity_hint: clamp(signals.spread_bps * 8),
      confidence_hint: 74,
      reliability_hint: 72,
      friction_hint: clamp(6 + signals.spread_bps * 4, 0, 36),
      risk_hint: clamp(signals.spread_bps * 7.5),
      reversibility_hint: 82,
      expected_value_hint: clamp(18 + Math.max(0, 4 - signals.spread_bps) * 10),
      evidence: [{ label: "spread_bps", value: signals.spread_bps, unit: "bps" }],
      tags: ["financial", "microstructure", "spread", scenario],
    }),
    signal({
      id: `financial:microstructure_drawdown:${current.timestamp}`,
      category: "drawdown_risk",
      label: "Microstructure drawdown",
      value: signals.drawdown,
      normalized_score: clamp(signals.drawdown * 4500),
      direction: signals.drawdown > 0 ? "down" : "stable",
      severity_hint: clamp(signals.drawdown * 4500),
      confidence_hint: 76,
      reliability_hint: 74,
      friction_hint: 10,
      risk_hint: clamp(signals.drawdown * 5000),
      reversibility_hint: 80,
      expected_value_hint: clamp(signals.drawdown * 1100),
      evidence: [{ label: "micro_drawdown", value: signals.drawdown }],
      tags: ["financial", "microstructure", "drawdown", scenario],
    }),
    signal({
      id: `financial:microstructure_exhaustion:${current.timestamp}`,
      category: "volatility_spike",
      label: "Flow exhaustion",
      value: signals.exhaustion_score,
      normalized_score: clamp(signals.exhaustion_score * 100),
      direction: signals.flow_decay > 0 ? "down" : "stable",
      severity_hint: clamp(signals.exhaustion_score * 100),
      confidence_hint: 72,
      reliability_hint: 70,
      friction_hint: clamp(8 + Math.max(0, signals.spread_regime_shift) * 12, 0, 32),
      risk_hint: clamp(signals.breakout_failure_risk * 100),
      reversibility_hint: 78,
      expected_value_hint: clamp(signals.exhaustion_score * 62),
      evidence: [
        { label: "flow_decay", value: signals.flow_decay },
        { label: "exhaustion_score", value: signals.exhaustion_score },
        { label: "reversal_setup_score", value: signals.reversal_setup_score },
      ],
      tags: ["financial", "microstructure", "exhaustion", scenario],
    }),
    signal({
      id: `financial:microstructure_longsetup:${current.timestamp}`,
      category: "trend_strength",
      label: "Long setup alignment",
      value: signals.long_setup_score,
      normalized_score: clamp(signals.long_setup_score * 100),
      direction: signals.long_setup_score > 0.3 ? "up" : "stable",
      severity_hint: clamp(signals.long_setup_score * 88),
      confidence_hint: clamp(60 + signals.horizon_alignment * 26, 0, 96),
      reliability_hint: clamp(58 + signals.depth_imbalance * 18 + signals.order_book_imbalance * 12, 0, 94),
      friction_hint: clamp(4 + Math.max(0, signals.spread_regime_shift) * 10, 0, 24),
      risk_hint: clamp(signals.breakout_failure_risk * 75),
      reversibility_hint: 82,
      expected_value_hint: clamp(signals.long_setup_score * 78),
      evidence: [
        { label: "long_setup_score", value: signals.long_setup_score },
        { label: "horizon_alignment", value: signals.horizon_alignment },
      ],
      tags: ["financial", "microstructure", "long_setup", scenario],
    }),
  ];

  return {
    signals,
    input: {
      request_id: `financial:microstructure:${current.product}:${current.timestamp}`,
      generated_at: current.timestamp,
      domain: "custom",
      context: {
        mode: "financial_microstructure_branch",
        metadata: {
          branch: "financial_microstructure",
          product: current.product,
          index,
          scenario,
        },
      },
      signals: universalSignals,
      data_quality: {
        score: 82,
        completeness: 78,
        freshness: 99,
        consistency: 84,
        reliability: 80,
      },
      constraints: {
        allow_automation: false,
        require_confirmation: true,
        max_control_level: "suggest",
        safety_mode: false,
      },
    },
  };
}

export function mapCoreOutputToFinancialMicrostructureAction(
  output: UniversalCoreOutput,
  signals: FinancialMicrostructureSignalVector,
): FinancialAction {
  const scenario = deriveFinancialMicrostructureScenario(signals);
  const strongSellSetup =
    signals.reversal_setup_score >= 0.46 ||
    (signals.momentum <= -0.14 && signals.trade_flow_imbalance <= -0.14 && signals.depth_imbalance <= -0.08) ||
    (signals.order_book_imbalance <= -0.22 && signals.depth_imbalance <= -0.12 && signals.spread_bps >= 1.1) ||
    (scenario === "exhaustion_reversal" && signals.trade_flow_imbalance <= -0.05) ||
    (scenario === "fake_breakout" && signals.momentum < -0.04);
  const strongBuySetup =
    signals.long_setup_score >= 0.36 ||
    (scenario === "continuation_burst" &&
      signals.momentum >= 0.08 &&
      signals.trade_flow_imbalance >= 0.04 &&
      signals.order_book_imbalance >= 0.04 &&
      signals.depth_imbalance >= 0.04) ||
    (scenario === "absorption" &&
      signals.order_book_imbalance >= 0.08 &&
      signals.depth_imbalance >= 0.08 &&
      signals.trade_flow_imbalance >= -0.02 &&
      signals.breakout_failure_risk <= 0.34);

  const hardProtectionExit =
    output.state === "blocked" ||
    output.risk.score >= 72 ||
    (strongSellSetup && signals.breakout_failure_risk >= 0.55);

  if (scenario === "neutral_compression" && !hardProtectionExit) {
    return "HOLD";
  }

  if (
    output.state === "blocked" ||
    output.state === "protection" ||
    output.risk.score >= 54 ||
    strongSellSetup
  ) {
    return "SELL";
  }

  if (
    (output.state === "ok" || output.state === "attention") &&
    output.risk.score <= 40 &&
    signals.spread_bps <= 1.8 &&
    signals.horizon_alignment >= 0.18 &&
    strongBuySetup
  ) {
    return "BUY";
  }

  if (
    output.state !== "protection" &&
    output.risk.score <= 34 &&
    scenario === "absorption" &&
    signals.order_book_imbalance >= 0.12 &&
    signals.depth_imbalance >= 0.1 &&
    signals.trade_flow_imbalance >= 0 &&
    signals.spread_regime_shift <= 0.08
  ) {
    return "BUY";
  }

  return "HOLD";
}

function isFinancialLateralRegime(
  decision: FinancialBranchDecision,
  confirmationReturn: number,
  tradingConfig: FinancialTradingLayerConfig,
): boolean {
  return (
    decision.signals.trend <= tradingConfig.lateralTrendCeiling &&
    Math.abs(decision.signals.momentum) <= tradingConfig.lateralMomentumCeiling &&
    decision.signals.drawdown <= tradingConfig.lateralDrawdownCeiling &&
    Math.abs(confirmationReturn) <= tradingConfig.lateralConfirmationReturnCeiling
  );
}

export function runFinancialMicrostructureBranch(
  snapshots: FinancialMicrostructureSnapshot[],
  index: number,
): FinancialBranchDecision & { microstructure_signals: FinancialMicrostructureSignalVector; microstructure_scenario: FinancialMicrostructureScenario } {
  const { input, signals } = mapFinancialMicrostructureToUniversal(snapshots, index);
  const coreOutput = runUniversalCore(input);
  const financialAction = mapCoreOutputToFinancialMicrostructureAction(coreOutput, signals);
  const scenario = deriveFinancialMicrostructureScenario(signals);

  return {
    core_state: coreOutput.state,
    risk: coreOutput.risk,
    priority: coreOutput.priority,
    financial_action: financialAction,
    reasoning: explainFinancialDecision(coreOutput, signals, financialAction),
    signals,
    core_output: coreOutput,
    microstructure_signals: signals,
    microstructure_scenario: scenario,
  };
}

export function runFinancialBranch(
  candles: FinancialCandle[],
  index: number,
  config: Partial<FinancialBranchConfig> = {},
  options: {
    tradingMode?: FinancialTradingMode;
    visionInput?: string;
    learningContext?: FinancialLearningContext;
  } = {},
): FinancialBranchDecision {
  const { input, signals } = mapFinancialToUniversal(candles, index, config);
  const visionContext = deriveFinancialVisionContext(options.visionInput);
  if (options.tradingMode === "v5_vision_guided") {
    input.context.metadata = {
      ...(input.context.metadata ?? {}),
      vision_stage: visionContext.stage,
      vision_confidence: visionContext.confidence,
      vision_trajectory: visionContext.trajectory_hint,
    };
  }
  if (options.learningContext && options.learningContext.mode !== "off") {
    input.context.metadata = {
      ...(input.context.metadata ?? {}),
      financial_learning_mode: options.learningContext.mode,
      financial_learning_domains: options.learningContext.pack?.domains.length ?? 0,
      financial_learning_scope: options.learningContext.mode === "god_mode_full" ? "god_mode_only" : "summary_only",
    };
  }
  const coreOutput = runUniversalCore(input);
  const hypothesisOutput = options.tradingMode === "v4_hypothesis_guided" || options.tradingMode === "v5_vision_guided" || options.tradingMode === "v6_scenario_guided"
    ? (options.tradingMode === "v5_vision_guided" || options.tradingMode === "v6_scenario_guided"
      ? (() => {
        const guidedHypothesis = applyFinancialLearningContext(
          applyFinancialVisionContext(runFinancialHypothesisSelector(coreOutput, signals), signals, visionContext),
          signals,
          options.learningContext,
        );

        return options.tradingMode === "v6_scenario_guided"
          ? applyFinancialScenarioSweep(coreOutput, signals, guidedHypothesis, visionContext, options.learningContext)
          : guidedHypothesis;
      })()
      
      : runFinancialHypothesisSelector(coreOutput, signals))
    : undefined;
  const financialAction = options.tradingMode === "v4_hypothesis_guided" || options.tradingMode === "v5_vision_guided" || options.tradingMode === "v6_scenario_guided"
    ? mapCoreOutputToFinancialActionV4(coreOutput, signals, hypothesisOutput)
    : options.tradingMode === "v3_core_guided"
      ? mapCoreOutputToFinancialActionV3(coreOutput, signals)
      : mapCoreOutputToFinancialAction(coreOutput, signals);

  return {
    core_state: coreOutput.state,
    risk: coreOutput.risk,
    priority: coreOutput.priority,
    financial_action: financialAction,
    reasoning: explainFinancialDecision(coreOutput, signals, financialAction),
    signals,
    core_output: coreOutput,
    hypothesis_output: hypothesisOutput,
  };
}

function eventLabel(candles: FinancialCandle[], index: number): "CRASH" | "RALLY" | "NONE" {
  const from = candles[Math.max(0, index - 3)].close;
  const to = candles[index].close;
  const change = pctChange(from, to) * 100;
  if (change < -5) return "CRASH";
  if (change > 5) return "RALLY";
  return "NONE";
}

export function simulateFinancialTradingLayer(
  candles: FinancialCandle[],
  options: {
    from?: string;
    to?: string;
    startIndex?: number;
    config?: Partial<FinancialBranchConfig>;
    trading?: Partial<FinancialTradingLayerConfig>;
    visionInput?: string;
    learningContext?: FinancialLearningContext;
  } = {},
): FinancialTradingSimulation {
  const tradingConfig: FinancialTradingLayerConfig = {
    ...DEFAULT_TRADING_V2_CONFIG,
    mode: options.trading?.mode ?? "v1",
    ...options.trading,
  };
  const startIndexByDate = options.from ? candles.findIndex((candle) => candle.timestamp >= options.from) : -1;
  const startIndex = Math.max(14, options.startIndex ?? (startIndexByDate >= 0 ? startIndexByDate : 14));
  const endIndexByDate = options.to ? candles.findIndex((candle) => candle.timestamp > options.to) : -1;
  const endExclusive = endIndexByDate >= 0 ? endIndexByDate : candles.length;
  let position: TradingPosition = "NONE";
  let entryPrice = 0;
  let entryTimestamp = "";
  let entryIndex = 0;
  let entryReason = "";
  let realizedEquity = 1;
  let peakEquity = 1;
  let maxDrawdown = 0;
  const trades: FinancialTrade[] = [];
  const actionCounts: Record<FinancialAction, number> = { BUY: 0, SELL: 0, HOLD: 0 };
  const eventCounts = {
    crash_total: 0,
    crash_detected: 0,
    rally_total: 0,
    rally_detected: 0,
    action_signals: 0,
    correct_action_signals: 0,
    false_positive_actions: 0,
  };
  let buyConfirmationCount = 0;
  let cooldownRemaining = 0;

  for (let index = startIndex; index < endExclusive; index += 1) {
    const candle = candles[index];
    const decision = runFinancialBranch(candles, index, options.config, {
      tradingMode: tradingConfig.mode,
      visionInput: options.visionInput,
      learningContext: options.learningContext,
    });
    const event = eventLabel(candles, index);
    let effectiveAction = decision.financial_action;
    const reasonSeeds = decision.hypothesis_output?.reason_seeds ?? [];
    const archiveContextConfirmation = reasonSeeds.some((seed) => seed.startsWith("archive_context_confirmation:"));
    const archiveRegimeGuard = reasonSeeds.some((seed) => seed.startsWith("archive_regime_guard:"));
    const archiveRegimeSellGuard = reasonSeeds.some((seed) => seed.startsWith("archive_regime_sell_guard:"));
    const archiveMicrostructureRisk = reasonSeeds.some((seed) => seed.startsWith("archive_microstructure_risk:"));
    const historyMonetaryRegimeGuard = reasonSeeds.some((seed) => seed.startsWith("history_monetary_regime_guard:"));
    const historyRegimeBreakSellBias = reasonSeeds.some((seed) => seed.startsWith("history_regime_break_sell_bias:"));

    if (
      tradingConfig.mode === "v2" ||
      tradingConfig.mode === "v3_core_guided" ||
      tradingConfig.mode === "v4_hypothesis_guided" ||
      tradingConfig.mode === "v5_vision_guided" ||
      tradingConfig.mode === "v6_scenario_guided"
    ) {
      const unrealizedPnl = position === "LONG" && entryPrice > 0 ? pctChange(entryPrice, candle.close) : 0;
      const archiveContextEntryEasing =
        archiveContextConfirmation &&
        (
          !archiveMicrostructureRisk ||
          (
            decision.signals.trend >= 0.06 &&
            decision.signals.momentum >= 0.18 &&
            decision.signals.drawdown <= 0.012
          )
        );
      const requiredConfirmationCandles = archiveContextEntryEasing
        ? Math.max(1, tradingConfig.confirmationCandles - 1)
        : tradingConfig.confirmationCandles;
      const requiredRegimeMinTrend = archiveContextEntryEasing
        ? Math.max(0, tradingConfig.regimeMinTrend - 0.006)
        : tradingConfig.regimeMinTrend;
      const requiredEntryWindowReturn = archiveContextEntryEasing
        ? Math.max(0.0045, tradingConfig.minEntryWindowReturn * 0.35)
        : tradingConfig.minEntryWindowReturn;
      const allowedRiskCeiling = archiveContextEntryEasing ? 48 : 45;
      const confirmationFrom = candles[Math.max(startIndex, index - requiredConfirmationCandles)].close;
      const confirmationReturn = pctChange(confirmationFrom, candle.close);
      const stopLossHit = position === "LONG" && unrealizedPnl <= tradingConfig.stopLoss;
      const takeProfitHit = position === "LONG" && unrealizedPnl >= tradingConfig.takeProfit;
      const rawBuyConfirmed = decision.financial_action === "BUY";
      const regimeAllowsEntry =
        decision.signals.trend >= requiredRegimeMinTrend &&
        decision.signals.drawdown <= tradingConfig.maxEntryDrawdown &&
        decision.signals.momentum >= tradingConfig.minEntryMomentum &&
        confirmationReturn >= requiredEntryWindowReturn &&
        decision.risk.score < allowedRiskCeiling;
      const lateralRegime = isFinancialLateralRegime(decision, confirmationReturn, tradingConfig);
      const archiveHoldGuard =
        archiveRegimeGuard ||
        historyMonetaryRegimeGuard ||
        (archiveMicrostructureRisk &&
          (
            decision.signals.volatility >= 0.28 ||
            decision.signals.drawdown >= 0.015
          ) &&
          (
            decision.signals.trend <= Math.max(requiredRegimeMinTrend + 0.015, 0.05) ||
            Math.abs(decision.signals.momentum) <= 0.18
          ));

      buyConfirmationCount = rawBuyConfirmed && regimeAllowsEntry ? buyConfirmationCount + 1 : 0;

      if (position === "NONE") {
        if (cooldownRemaining > 0) {
          effectiveAction = "HOLD";
          cooldownRemaining -= 1;
        } else if (lateralRegime || archiveHoldGuard) {
          effectiveAction = "HOLD";
          buyConfirmationCount = 0;
        } else {
          effectiveAction = buyConfirmationCount >= requiredConfirmationCandles ? "BUY" : "HOLD";
        }
      } else if (position === "LONG") {
        if (stopLossHit) {
          effectiveAction = "SELL";
          decision.reasoning = `${decision.reasoning} Stop loss ${round(unrealizedPnl * 100, 4)}%.`;
        } else if (takeProfitHit) {
          effectiveAction = "SELL";
          decision.reasoning = `${decision.reasoning} Take profit ${round(unrealizedPnl * 100, 4)}%.`;
        } else if (archiveRegimeSellGuard || historyRegimeBreakSellBias) {
          effectiveAction = "SELL";
          decision.reasoning = `${decision.reasoning} Archive regime sell guard.`;
        } else if (lateralRegime) {
          effectiveAction = "HOLD";
        } else {
          effectiveAction = decision.financial_action === "SELL" ? "SELL" : "HOLD";
        }
      }
    }

    actionCounts[effectiveAction] += 1;

    if (event === "CRASH") {
      eventCounts.crash_total += 1;
      if (effectiveAction === "SELL") eventCounts.crash_detected += 1;
    }

    if (event === "RALLY") {
      eventCounts.rally_total += 1;
      if (effectiveAction === "BUY") eventCounts.rally_detected += 1;
    }

    if (effectiveAction !== "HOLD") {
      eventCounts.action_signals += 1;
      const correctBuy = effectiveAction === "BUY" && event === "RALLY";
      const correctSell = effectiveAction === "SELL" && event === "CRASH";
      if (correctBuy || correctSell) eventCounts.correct_action_signals += 1;
      if (event === "NONE") eventCounts.false_positive_actions += 1;
    }

    if (effectiveAction === "BUY" && position === "NONE") {
      position = "LONG";
      entryPrice = candle.close;
      entryTimestamp = candle.timestamp;
      entryIndex = index;
      entryReason = decision.reasoning;
    } else if (effectiveAction === "SELL" && position === "LONG") {
      const pnl = pctChange(entryPrice, candle.close);
      realizedEquity *= 1 + pnl;
      trades.push({
        entry_timestamp: entryTimestamp,
        exit_timestamp: candle.timestamp,
        entry_price: entryPrice,
        exit_price: candle.close,
        pnl: round(pnl),
        pnl_percent: round(pnl * 100, 4),
        bars_held: index - entryIndex,
        entry_reason: entryReason,
        exit_reason: decision.reasoning,
      });
      position = "NONE";
      entryPrice = 0;
      entryTimestamp = "";
      entryIndex = 0;
      entryReason = "";
      if (
        tradingConfig.mode === "v2" ||
        tradingConfig.mode === "v3_core_guided" ||
        tradingConfig.mode === "v4_hypothesis_guided" ||
        tradingConfig.mode === "v5_vision_guided" ||
        tradingConfig.mode === "v6_scenario_guided"
      ) {
        cooldownRemaining = tradingConfig.cooldownCandles;
        buyConfirmationCount = 0;
      }
    }

    const markEquity = position === "LONG" && entryPrice > 0 ? realizedEquity * (candle.close / entryPrice) : realizedEquity;
    peakEquity = Math.max(peakEquity, markEquity);
    maxDrawdown = Math.max(maxDrawdown, peakEquity ? (peakEquity - markEquity) / peakEquity : 0);
  }

  if (position === "LONG") {
    const last = candles[endExclusive - 1];
    const pnl = pctChange(entryPrice, last.close);
    realizedEquity *= 1 + pnl;
    trades.push({
      entry_timestamp: entryTimestamp,
      exit_timestamp: last.timestamp,
      entry_price: entryPrice,
      exit_price: last.close,
      pnl: round(pnl),
      pnl_percent: round(pnl * 100, 4),
      bars_held: endExclusive - 1 - entryIndex,
      entry_reason: entryReason,
      exit_reason: "Forced end-of-period close.",
    });
    position = "NONE";
  }

  const winningTrades = trades.filter((trade) => trade.pnl > 0).length;
  const losingTrades = trades.filter((trade) => trade.pnl <= 0).length;
  const first = candles[startIndex];
  const last = candles[endExclusive - 1];
  const buyAndHoldReturn = pctChange(first.close, last.close);

  return {
    period: {
      from: first.timestamp,
      to: last.timestamp,
    },
    position_final: position,
    trade_count: trades.length,
    winning_trades: winningTrades,
    losing_trades: losingTrades,
    win_rate: trades.length ? round(winningTrades / trades.length, 6) : 0,
    total_profit: round(realizedEquity - 1),
    total_profit_percent: round((realizedEquity - 1) * 100, 4),
    max_drawdown: round(maxDrawdown),
    buy_and_hold_return: round(buyAndHoldReturn),
    precision: eventCounts.action_signals ? round(eventCounts.correct_action_signals / eventCounts.action_signals, 6) : null,
    recall: {
      crash: eventCounts.crash_total ? round(eventCounts.crash_detected / eventCounts.crash_total, 6) : null,
      rally: eventCounts.rally_total ? round(eventCounts.rally_detected / eventCounts.rally_total, 6) : null,
    },
    false_positive_rate: eventCounts.action_signals ? round(eventCounts.false_positive_actions / eventCounts.action_signals, 6) : null,
    action_counts: actionCounts,
    event_counts: eventCounts,
    trades,
  };
}

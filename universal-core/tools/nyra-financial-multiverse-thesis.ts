import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";
import type { FinancialMicrostructureSnapshot } from "../packages/branches/financial/src/index.ts";

type TradeSide = "LONG" | "SHORT";

type MicrostructureDecision = {
  risk: { score: number };
  financial_action: string;
  microstructure_scenario: string;
  core_state: string;
  microstructure_signals: {
    spread_bps: number;
    breakout_failure_risk: number;
    flow_decay: number;
    horizon_alignment: number;
    momentum: number;
    trade_flow_imbalance: number;
    order_book_imbalance: number;
    depth_imbalance: number;
    long_setup_score: number;
    reversal_setup_score: number;
  };
};

export type FinancialMultiverseScenario = {
  id: string;
  probability: number;
  payoff_score: number;
  risk_score: number;
  ev_score: number;
};

export type FinancialMultiverseThesis = {
  product: string;
  side: TradeSide;
  expected_value_score: number;
  confidence: number;
  adverse_risk: number;
  patience_score: number;
  thesis_valid: boolean;
  thesis_action: "enter" | "watch" | "hold_thesis" | "avoid";
  core_state: string;
  core_risk_score: number;
  scenarios: FinancialMultiverseScenario[];
  reason: string;
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sideSign(side: TradeSide): number {
  return side === "LONG" ? 1 : -1;
}

function priceDrift(snapshots: FinancialMicrostructureSnapshot[], side: TradeSide): number {
  const first = snapshots[0]?.last_price ?? 0;
  const last = snapshots[snapshots.length - 1]?.last_price ?? first;
  if (!first) return 0;
  return ((last - first) / first) * 10_000 * sideSign(side);
}

function scenario(id: string, probability: number, payoffScore: number, riskScore: number): FinancialMultiverseScenario {
  const ev = probability * payoffScore - (1 - probability) * riskScore;
  return {
    id,
    probability: round(clamp(probability, 0, 1), 6),
    payoff_score: round(clamp(payoffScore), 6),
    risk_score: round(clamp(riskScore), 6),
    ev_score: round(ev, 6),
  };
}

function buildCoreInput(
  product: string,
  side: TradeSide,
  decision: MicrostructureDecision,
  scenarios: FinancialMultiverseScenario[],
): UniversalCoreInput {
  const signals: UniversalSignal[] = scenarios.map((item) => ({
    id: `multiverse:${item.id}`,
    source: "nyra_financial_multiverse_thesis",
    category: "financial_scenario",
    label: `${product} ${side} ${item.id}`,
    value: item.ev_score,
    normalized_score: clamp(item.ev_score),
    direction: item.ev_score >= 0 ? "up" : "down",
    severity_hint: clamp(item.risk_score),
    confidence_hint: clamp(item.probability * 100),
    reliability_hint: clamp(100 - decision.microstructure_signals.spread_bps * 4),
    friction_hint: clamp(decision.microstructure_signals.spread_bps * 4),
    risk_hint: clamp(item.risk_score),
    reversibility_hint: clamp(92 - decision.risk.score * 0.4),
    expected_value_hint: clamp(item.ev_score),
    tags: ["financial", "multiverse", "thesis", side.toLowerCase()],
    evidence: [
      { label: "probability", value: item.probability },
      { label: "payoff_score", value: item.payoff_score },
      { label: "risk_score", value: item.risk_score },
      { label: "scenario", value: decision.microstructure_scenario },
    ],
  }));

  return {
    request_id: `nyra-multiverse-${product}-${Date.now()}`,
    generated_at: new Date().toISOString(),
    domain: "custom",
    context: {
      mode: "financial_multiverse_thesis",
      metadata: {
        product,
        side,
        source: "live_microstructure_no_future_data",
        disclaimer: "probabilistic_scenario_analysis_not_prediction_certainty",
      },
    },
    signals,
    data_quality: {
      score: clamp(82 - decision.microstructure_signals.spread_bps * 2 - Math.max(0, decision.microstructure_signals.flow_decay) * 18),
      completeness: 85,
      freshness: 95,
      consistency: clamp(80 + decision.microstructure_signals.horizon_alignment * 20),
      reliability: clamp(82 - decision.microstructure_signals.breakout_failure_risk * 25),
    },
    constraints: {
      allow_automation: false,
      require_confirmation: true,
      max_control_level: "confirm",
      safety_mode: true,
    },
  };
}

export function evaluateFinancialMultiverseThesis(
  product: string,
  side: TradeSide,
  signedScore: number,
  decision: MicrostructureDecision,
  snapshots: FinancialMicrostructureSnapshot[],
): FinancialMultiverseThesis {
  const signals = decision.microstructure_signals;
  const directionalFlow =
    (signals.trade_flow_imbalance * 34 + signals.order_book_imbalance * 26 + signals.depth_imbalance * 20) *
    sideSign(side);
  const directionalMomentum = signals.momentum * 100 * sideSign(side);
  const drift = priceDrift(snapshots, side);
  const quality =
    directionalFlow * 0.34 +
    directionalMomentum * 0.22 +
    signals.horizon_alignment * 24 +
    (side === "LONG" ? signals.long_setup_score : signals.reversal_setup_score) * 26 -
    signals.breakout_failure_risk * 28 -
    Math.max(0, signals.flow_decay) * 20 -
    signals.spread_bps * 2.2;
  const compression = decision.microstructure_scenario === "neutral_compression";
  const fakeBreakout = decision.microstructure_scenario === "fake_breakout";
  const adverseRisk = clamp(
    decision.risk.score * 0.54 +
      signals.breakout_failure_risk * 34 +
      Math.max(0, signals.flow_decay) * 26 +
      Math.max(0, -directionalFlow) * 0.48 +
      signals.spread_bps * 2.4,
  );

  const scenarios = [
    scenario(
      "trend_continuation",
      clamp(0.44 + directionalMomentum / 260 + directionalFlow / 280 + signals.horizon_alignment / 7, 0.05, 0.85),
      clamp(52 + Math.max(0, directionalMomentum) * 0.26 + Math.max(0, directionalFlow) * 0.32),
      clamp(34 + Math.max(0, -directionalFlow) * 0.36 + signals.breakout_failure_risk * 20),
    ),
    scenario(
      "compression_breakout",
      clamp((compression ? 0.45 : 0.28) + directionalFlow / 300 - signals.spread_bps / 130, 0.04, 0.76),
      clamp(46 + Math.abs(signedScore) * 0.18 + Math.max(0, directionalFlow) * 0.22),
      clamp(40 + signals.breakout_failure_risk * 26 + signals.spread_bps * 2),
    ),
    scenario(
      "mean_reversion",
      clamp(0.36 + Math.max(0, -drift) / 160 + (fakeBreakout ? 0.14 : 0), 0.05, 0.8),
      clamp(40 + Math.max(0, -drift) * 0.38 + signals.reversal_setup_score * 20),
      clamp(38 + Math.max(0, drift) * 0.26 + signals.flow_decay * 18),
    ),
    scenario(
      "liquidity_trap",
      clamp(0.24 + signals.breakout_failure_risk * 0.38 + Math.max(0, signals.flow_decay) * 0.24, 0.04, 0.82),
      clamp(18 + Math.max(0, -directionalFlow) * 0.2),
      clamp(58 + adverseRisk * 0.36),
    ),
    scenario(
      "adverse_squeeze",
      clamp(0.18 + Math.max(0, -directionalMomentum) / 260 + Math.max(0, -directionalFlow) / 300, 0.03, 0.78),
      clamp(16 + Math.max(0, -directionalMomentum) * 0.12),
      clamp(54 + adverseRisk * 0.42),
    ),
  ];

  const expectedValueScore = round(scenarios.reduce((sum, item) => sum + item.ev_score, 0) / scenarios.length + quality * 0.26);
  const positiveScenarioCount = scenarios.filter((item) => item.ev_score > 4).length;
  const confidence = clamp(48 + positiveScenarioCount * 9 + Math.max(0, quality) * 0.18 - signals.spread_bps * 1.2);
  const patienceScore = clamp(44 + expectedValueScore * 0.45 + confidence * 0.22 - adverseRisk * 0.24);
  const core = runUniversalCore(buildCoreInput(product, side, decision, scenarios));
  const thesisValid =
    expectedValueScore >= 8 &&
    confidence >= 52 &&
    adverseRisk < 76 &&
    core.risk.score < 82 &&
    positiveScenarioCount >= 2;

  const thesisAction =
    !thesisValid
      ? adverseRisk >= 72 ? "avoid" : "watch"
      : patienceScore >= 58
        ? "hold_thesis"
        : "enter";

  return {
    product,
    side,
    expected_value_score: round(expectedValueScore),
    confidence: round(confidence),
    adverse_risk: round(adverseRisk),
    patience_score: round(patienceScore),
    thesis_valid: thesisValid,
    thesis_action: thesisAction,
    core_state: core.state,
    core_risk_score: round(core.risk.score, 6),
    scenarios,
    reason: thesisValid
      ? "tesi probabilistica ancora valida: scenari positivi sufficienti e rischio contrario sotto soglia"
      : "tesi non abbastanza forte: EV, fiducia o rischio contrario non giustificano pazienza operativa",
  };
}

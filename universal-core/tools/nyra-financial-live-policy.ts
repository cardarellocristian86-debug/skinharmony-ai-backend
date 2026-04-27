import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NyraFinancialLearningPack } from "../packages/contracts/src/index.ts";
import { loadFinancialLearningPack } from "./nyra-financial-learning-runtime.ts";

type LiveDecision = {
  risk: { score: number };
  financial_action: string;
  microstructure_scenario: string;
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

export type FinancialLivePolicyEvaluation = {
  adjusted_score: number;
  blocked: boolean;
  notes: string[];
  min_strength_required: number;
  size_multiplier: number;
};

const PACK_PATH = join(process.cwd(), "runtime", "nyra-learning", "nyra_financial_learning_pack_latest.json");
const LIVE_FEEDBACK_PATH = join(process.cwd(), "runtime", "nyra-learning", "nyra_financial_live_feedback_latest.json");
const LIVE_AUTOIMPROVE_PATH = join(process.cwd(), "runtime", "nyra-learning", "nyra_financial_realtime_autoimprovement_latest.json");

type FinancialLiveFeedback = {
  totalCycles?: number;
  selectedCycles?: number;
  noTradeCycles?: number;
  selectedCycleRatio?: number;
  noTradeRatio?: number;
  winRate?: number;
  lossRate?: number;
  avgSelectedPnlPct?: number;
  avgSelectedPnlEur?: number;
  netPnlEur?: number;
  maxDrawdownEur?: number;
  maxDrawdownPct?: number;
  maxLossStreak?: number;
  averageBlockedCount?: number;
  assetStats?: Array<{
    product: string;
    selectedCount: number;
    pnlEur: number;
    avgSpreadBps: number;
  }>;
};

type FinancialRealtimeAutoimprovement = {
  selected_policy?: string;
  learning_state?: string;
  runtime_adjustments?: {
    minStrengthDelta?: number;
    scoreDelta?: number;
    sizeMultiplier?: number;
    allowMicroTrades?: boolean;
    recoveryMode?: boolean;
    dynamicRiskBudgetMultiplier?: number;
    blockNegativeAssets?: string[];
    watchNegativeAssets?: string[];
    boostPositiveAssets?: string[];
    penalizeExpensiveAssets?: string[];
    notes?: string[];
  };
};

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function hasDomain(pack: NyraFinancialLearningPack | null, id: string): boolean {
  return Boolean(pack?.domains.some((domain) => domain.id === id));
}

export function loadFinancialLearningPackSafe(): NyraFinancialLearningPack | null {
  if (!existsSync(PACK_PATH)) return null;
  try {
    return loadFinancialLearningPack(PACK_PATH);
  } catch {
    return null;
  }
}

function loadFinancialLiveFeedback(): FinancialLiveFeedback | null {
  if (!existsSync(LIVE_FEEDBACK_PATH)) return null;
  try {
    return JSON.parse(readFileSync(LIVE_FEEDBACK_PATH, "utf8")) as FinancialLiveFeedback;
  } catch {
    return null;
  }
}

function loadFinancialRealtimeAutoimprovement(): FinancialRealtimeAutoimprovement | null {
  if (!existsSync(LIVE_AUTOIMPROVE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(LIVE_AUTOIMPROVE_PATH, "utf8")) as FinancialRealtimeAutoimprovement;
  } catch {
    return null;
  }
}

export function evaluateFinancialLivePolicy(
  product: string,
  decision: LiveDecision,
  signedScore: number,
  pack: NyraFinancialLearningPack | null,
): FinancialLivePolicyEvaluation {
  const notes: string[] = [];
  let adjusted = signedScore;
  let minStrengthRequired = 8;
  let sizeMultiplier = 1;
  const liveFeedback = loadFinancialLiveFeedback();
  const realtimeAutoimprovement = loadFinancialRealtimeAutoimprovement();
  const assetFeedback = liveFeedback?.assetStats?.find((item) => item.product === product);
  const realtimeAdjustments = realtimeAutoimprovement?.runtime_adjustments;
  const recoveryMicroMode =
    realtimeAutoimprovement?.learning_state === "recovery_micro_learning" ||
    realtimeAdjustments?.recoveryMode === true ||
    realtimeAdjustments?.allowMicroTrades === true;
  const shortFlowConfirmed =
    decision.microstructure_signals.trade_flow_imbalance < -0.16 ||
    decision.microstructure_signals.order_book_imbalance < -0.16 ||
    decision.microstructure_signals.depth_imbalance < -0.16;
  const expectedMoveBps = Math.abs(signedScore);
  const estimatedRoundTripCostBps = 120 + decision.microstructure_signals.spread_bps * 2;

  if (hasDomain(pack, "execution")) {
    minStrengthRequired += 6;
    adjusted -= decision.microstructure_signals.spread_bps * 1.8;
    if (decision.microstructure_signals.spread_bps > 14) notes.push("spread_cost_high");
  }

  if (hasDomain(pack, "behavioral")) {
    minStrengthRequired += 6;
    if (Math.abs(signedScore) < 20) {
      adjusted -= 8;
      notes.push("edge_too_small");
    }
    if (decision.microstructure_scenario === "fake_breakout") {
      adjusted -= 9;
      notes.push("fake_breakout_risk");
    }
  }

  if (hasDomain(pack, "regime_detection")) {
    minStrengthRequired += 4;
    if (decision.microstructure_signals.horizon_alignment < 0) {
      adjusted -= 10;
      notes.push("regime_misaligned");
    }
    if (decision.microstructure_signals.flow_decay > 0.18) {
      adjusted -= 6;
      notes.push("flow_decay_high");
    }
    if (decision.microstructure_scenario === "neutral_compression") {
      minStrengthRequired += 10;
      const compressionHasPositiveEv =
        recoveryMicroMode &&
        decision.microstructure_signals.spread_bps <= 4 &&
        expectedMoveBps > estimatedRoundTripCostBps;
      if (
        !compressionHasPositiveEv &&
        (
          decision.risk.score >= 62 ||
          Math.abs(decision.microstructure_signals.trade_flow_imbalance) < 0.1 ||
          Math.abs(decision.microstructure_signals.order_book_imbalance) < 0.1 ||
          Math.abs(decision.microstructure_signals.depth_imbalance) < 0.1
        )
      ) {
        adjusted -= 18;
        sizeMultiplier = 0;
        notes.push("compression_no_trade");
      } else if (compressionHasPositiveEv) {
        adjusted -= 5;
        sizeMultiplier = 0.18;
        notes.push("compression_positive_ev_micro_trade");
      } else {
        adjusted -= 8;
        sizeMultiplier = 0.35;
        notes.push("compression_small_size");
      }
    }
  }

  if (hasDomain(pack, "risk_management")) {
    minStrengthRequired += 4;
    adjusted -= decision.risk.score * 0.24;
    adjusted -= decision.microstructure_signals.breakout_failure_risk * 18;
    if (decision.risk.score > 64) notes.push("risk_too_high");
  }

  if (hasDomain(pack, "portfolio")) {
    minStrengthRequired += 4;
    if (Math.abs(decision.microstructure_signals.trade_flow_imbalance) < 0.08 && Math.abs(decision.microstructure_signals.order_book_imbalance) < 0.08) {
      adjusted -= 5;
      notes.push("weak_confirmation");
    }
  }

  if (liveFeedback && hasDomain(pack, "execution")) {
    if (
      (liveFeedback.totalCycles ?? 0) >= 8 &&
      (liveFeedback.noTradeRatio ?? 0) >= 0.6 &&
      (liveFeedback.winRate ?? 0) >= 0.5 &&
      (liveFeedback.avgSelectedPnlPct ?? 0) > 0 &&
      decision.microstructure_signals.spread_bps < 6
    ) {
      minStrengthRequired -= 4;
      adjusted += 6;
      notes.push("empirical_release");
    }
  }

  if (assetFeedback && hasDomain(pack, "execution")) {
    if ((assetFeedback.avgSpreadBps ?? 0) > 8) {
      adjusted -= 10;
      minStrengthRequired += 4;
      notes.push("asset_spread_drag");
    } else if ((assetFeedback.avgSpreadBps ?? 0) < 2) {
      adjusted += 2;
      notes.push("asset_execution_friendly");
    }
  }

  if (decision.financial_action === "SELL") {
    minStrengthRequired += 3;
    adjusted -= recoveryMicroMode ? 2 : 5;
    notes.push(recoveryMicroMode ? "short_contextual_penalty" : "short_global_penalty");
    if (decision.microstructure_scenario === "exhaustion_reversal") {
      adjusted -= shortFlowConfirmed ? 2 : 10;
      minStrengthRequired += shortFlowConfirmed ? 1 : 5;
      notes.push(shortFlowConfirmed ? "short_reversal_flow_confirmed" : "short_exhaustion_reversal_penalty");
    }
  }

  if (liveFeedback && hasDomain(pack, "risk_management")) {
    if ((liveFeedback.maxDrawdownPct ?? 0) > 0.12 || (liveFeedback.maxLossStreak ?? 0) >= 3) {
      minStrengthRequired += recoveryMicroMode ? 2 : 5;
      adjusted -= recoveryMicroMode ? 3 : 8;
      sizeMultiplier = round(sizeMultiplier * (recoveryMicroMode ? 0.62 : 1), 6);
      notes.push(recoveryMicroMode ? "empirical_drawdown_recovery_budget" : "empirical_drawdown_guard");
    }
    if ((liveFeedback.winRate ?? 0) >= 0.58 && (liveFeedback.maxDrawdownPct ?? 0) < 0.08) {
      adjusted += 4;
      notes.push("empirical_confidence");
    }
  }

  if (assetFeedback && hasDomain(pack, "portfolio")) {
    if ((assetFeedback.selectedCount ?? 0) >= 3 && (assetFeedback.pnlEur ?? 0) > 0) {
      adjusted += 5;
      notes.push("asset_positive_history");
    }
    if ((assetFeedback.selectedCount ?? 0) >= 2 && (assetFeedback.pnlEur ?? 0) < 0) {
      adjusted -= recoveryMicroMode ? 3 : 8;
      minStrengthRequired += recoveryMicroMode ? 1 : 3;
      sizeMultiplier = round(sizeMultiplier * (recoveryMicroMode ? 0.75 : 1), 6);
      notes.push(recoveryMicroMode ? "asset_negative_history_contextual" : "asset_negative_history");
    }
  }

  if (assetFeedback) {
    const expensiveAndNegative =
      (assetFeedback.selectedCount ?? 0) >= 3 &&
      (assetFeedback.pnlEur ?? 0) < -80 &&
      (assetFeedback.avgSpreadBps ?? 0) > 8;
    if (expensiveAndNegative) {
      adjusted -= 18;
      minStrengthRequired += 8;
      sizeMultiplier = 0;
      notes.push("asset_hard_block_expensive_negative_history");
    }
  }

  if (realtimeAdjustments) {
    const minStrengthDelta = Number(realtimeAdjustments.minStrengthDelta || 0);
    const scoreDelta = Number(realtimeAdjustments.scoreDelta || 0);
    const sizeFactor = Number(realtimeAdjustments.sizeMultiplier || 1);
    minStrengthRequired += minStrengthDelta;
    adjusted += scoreDelta;
    sizeMultiplier = round(sizeMultiplier * sizeFactor, 6);
    if (realtimeAutoimprovement?.selected_policy) notes.push(`realtime_${realtimeAutoimprovement.selected_policy}`);
    if (Array.isArray(realtimeAdjustments.notes)) notes.push(...realtimeAdjustments.notes.slice(0, 3));
    if (Array.isArray(realtimeAdjustments.blockNegativeAssets) && realtimeAdjustments.blockNegativeAssets.includes(product)) {
      adjusted -= 12;
      minStrengthRequired += 5;
      sizeMultiplier = round(sizeMultiplier * 0.5, 6);
      notes.push("realtime_negative_asset_guard");
    }
    if (Array.isArray(realtimeAdjustments.watchNegativeAssets) && realtimeAdjustments.watchNegativeAssets.includes(product)) {
      adjusted -= 4;
      minStrengthRequired += 1;
      sizeMultiplier = round(sizeMultiplier * 0.72, 6);
      notes.push("realtime_negative_asset_watch");
    }
    if (Array.isArray(realtimeAdjustments.boostPositiveAssets) && realtimeAdjustments.boostPositiveAssets.includes(product)) {
      adjusted += 10;
      minStrengthRequired = Math.max(4, minStrengthRequired - 4);
      sizeMultiplier = round(sizeMultiplier * 1.18, 6);
      notes.push("realtime_positive_asset_boost");
    }
    if (Array.isArray(realtimeAdjustments.penalizeExpensiveAssets) && realtimeAdjustments.penalizeExpensiveAssets.includes(product)) {
      adjusted -= 8;
      minStrengthRequired += 4;
      notes.push("realtime_spread_penalty");
    }
  }

  const riskHardBlock = recoveryMicroMode ? decision.risk.score >= 86 : decision.risk.score >= 72;
  const strengthFloor = recoveryMicroMode ? minStrengthRequired * 0.62 : minStrengthRequired;
  const blocked =
    sizeMultiplier === 0 ||
    riskHardBlock ||
    Math.abs(adjusted) < strengthFloor ||
    (decision.financial_action === "SELL" &&
      decision.microstructure_scenario === "exhaustion_reversal" &&
      (liveFeedback?.winRate ?? 1) < 0.3 &&
      (liveFeedback?.maxLossStreak ?? 0) >= 6 &&
      (!recoveryMicroMode || !shortFlowConfirmed)) ||
    (decision.financial_action === "BUY" && signedScore <= 0) ||
    (decision.financial_action === "SELL" && signedScore >= 0);

  if (recoveryMicroMode && !blocked) notes.push("recovery_micro_trade_allowed");
  if (blocked) notes.push("discipline_block");

  return {
    adjusted_score: round(adjusted),
    blocked,
    notes,
    min_strength_required: minStrengthRequired,
    size_multiplier: sizeMultiplier,
  };
}

export function isFinancialRecoveryMicroModeActive(): boolean {
  const realtimeAutoimprovement = loadFinancialRealtimeAutoimprovement();
  const realtimeAdjustments = realtimeAutoimprovement?.runtime_adjustments;
  return Boolean(
    realtimeAutoimprovement?.learning_state === "recovery_micro_learning" ||
    realtimeAdjustments?.recoveryMode === true ||
    realtimeAdjustments?.allowMicroTrades === true
  );
}

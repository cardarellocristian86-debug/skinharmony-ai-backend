import type { NyraFinancialAdvisoryOutput } from "./nyra-financial-advisory-overlay.ts";
import {
  chooseNyraRiskProfileAllocation,
  type NyraRiskProfile,
} from "./nyra-risk-profile-policy.ts";
import {
  chooseNyraProbabilityRegimeAction,
  type NyraProbabilityRegime,
} from "./nyra-probability-regime-policy.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type AssetSymbol = "SPY" | "QQQ" | "BTC" | "GLD" | "TLT" | "CASH";
type Allocation = Record<AssetSymbol, number>;
type HistoryMap = Record<AssetSymbol, number[]>;
const TRADE_COST_RATE = 0.003;

export type NyraProfileControlMode = "auto" | "manual";
export type NyraManualProfileLevel = 1 | 2 | 3 | 4;
export type NyraAutoDriveProfile =
  | NyraRiskProfile
  | "overdrive_5_auto_only"
  | "overdrive_6_auto_only"
  | "overdrive_7_auto_only";

export type NyraAutoProfileSelection = {
  mode: NyraProfileControlMode;
  profile: NyraAutoDriveProfile;
  manual_level: NyraManualProfileLevel;
  reason: string;
  hold_current_position: boolean;
  lateral_mode: boolean;
  lateral_candidate: boolean;
  breakout_candidate: boolean;
};

export type NyraFinancialRegimeExplanation = {
  topic: "lateral";
  signals: string[];
  explanation: string;
};

type SelectorAutowritePolicy = {
  version: "nyra_selector_autowrite_policy_v1";
  generated_at: string;
  active: boolean;
  stance: "conservative" | "measured_release";
  source_reports: string[];
  notes: string[];
  params: {
    upgrade_threshold_delta: number;
    downgrade_threshold_delta: number;
    breakout_qqq1m_delta: number;
    breakout_spy1m_delta: number;
    breakout_policy_floor_delta: number;
    recovery_break_max_delta: number;
    recovery_regime_max_delta: number;
    min_expected_edge_multiplier: number;
    partial_rebalance_amount_delta: number;
  };
};

type NyraDirtyDataGuardContext = {
  events?: string[];
  qqqReturnPct?: number;
  dataQualityScore?: number;
  completeness?: number;
  freshness?: number;
  consistency?: number;
  reliability?: number;
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const SELECTOR_AUTOWRITE_POLICY_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_selector_autowrite_policy_latest.json");

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function directionalEfficiency(values: number[]): number {
  if (!values.length) return 0;
  const net = Math.abs(values.reduce((sum, value) => sum + value, 0));
  const gross = values.reduce((sum, value) => sum + Math.abs(value), 0) || 1;
  return net / gross;
}

function signFlips(values: number[]): number {
  let flips = 0;
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1] ?? 0;
    const current = values[index] ?? 0;
    if ((previous > 0 && current < 0) || (previous < 0 && current > 0)) flips += 1;
  }
  return flips;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

function loadSelectorAutowritePolicy(): SelectorAutowritePolicy | undefined {
  if (!existsSync(SELECTOR_AUTOWRITE_POLICY_PATH)) return undefined;
  return JSON.parse(readFileSync(SELECTOR_AUTOWRITE_POLICY_PATH, "utf8")) as SelectorAutowritePolicy;
}

export function explainNyraFinancialRegime(topic: "lateral"): NyraFinancialRegimeExplanation {
  if (topic === "lateral") {
    return {
      topic,
      signals: [
        "QQQ 1m vicino a zero",
        "QQQ 3m senza direzione netta",
        "QQQ 6m senza prosecuzione pulita",
        "SPY 3m debole o piatto",
        "efficienza direzionale bassa",
        "sign flip alti negli ultimi 4 step",
        "break basso",
        "regime basso",
        "breakout che non regge subito",
      ],
      explanation:
        "Per chiamare davvero un laterale non mi basta vedere prezzo che si muove. Mi servono oscillazione presente ma direzione assente, " +
        "quindi QQQ a 1/3/6 mesi senza prosecuzione pulita, SPY piatto o debole, efficienza direzionale bassa e cambi di segno frequenti. " +
        "In piu devo vedere break e regime ancora bassi: vuol dire che non siamo in crash vero ma nemmeno in trend sano. " +
        "Se il breakout parte e torna subito indietro, per me e ancora laterale. Solo quando il movimento regge e non viene annullato smetto di trattarlo come rumore.",
    };
  }

  return {
    topic,
    signals: [],
    explanation: "Tema non disponibile.",
  };
}

function levelToProfile(level: NyraManualProfileLevel): NyraRiskProfile {
  switch (level) {
    case 1:
      return "capital_protection";
    case 2:
      return "balanced_growth";
    case 3:
      return "aggressive_growth";
    case 4:
      return "hard_growth";
  }
}

function profileToLevel(profile: NyraAutoDriveProfile): NyraManualProfileLevel {
  switch (profile) {
    case "capital_protection":
      return 1;
    case "balanced_growth":
      return 2;
    case "aggressive_growth":
      return 3;
    case "hard_growth":
    case "overdrive_5_auto_only":
    case "overdrive_6_auto_only":
    case "overdrive_7_auto_only":
      return 4;
  }
}

function applyOverdrive5Overlay(base: Allocation): Allocation {
  return {
    SPY: Math.max(base.SPY - 0.03, 0),
    QQQ: Math.min(base.QQQ + 0.03, 0.35),
    BTC: Math.min(base.BTC + 0.02, 0.15),
    GLD: Math.max(base.GLD - 0.01, 0),
    TLT: Math.max(base.TLT - 0.01, 0),
    CASH: Math.max(base.CASH - 0.04, 0),
  };
}

function applyOverdrive6Overlay(base: Allocation): Allocation {
  return {
    SPY: Math.max(base.SPY - 0.06, 0),
    QQQ: Math.min(base.QQQ + 0.05, 0.35),
    BTC: Math.min(base.BTC + 0.03, 0.15),
    GLD: Math.max(base.GLD - 0.01, 0),
    TLT: Math.max(base.TLT - 0.02, 0),
    CASH: Math.max(base.CASH - 0.06, 0),
  };
}

function applyOverdrive7Overlay(base: Allocation): Allocation {
  return {
    SPY: Math.max(base.SPY - 0.09, 0),
    QQQ: Math.min(base.QQQ + 0.07, 0.35),
    BTC: Math.min(base.BTC + 0.04, 0.15),
    GLD: Math.max(base.GLD - 0.02, 0),
    TLT: Math.max(base.TLT - 0.03, 0),
    CASH: Math.max(base.CASH - 0.07, 0),
  };
}

function isOverdriveProfile(profile: NyraAutoDriveProfile | null | undefined): profile is "overdrive_5_auto_only" | "overdrive_6_auto_only" | "overdrive_7_auto_only" {
  return (
    profile === "overdrive_5_auto_only" ||
    profile === "overdrive_6_auto_only" ||
    profile === "overdrive_7_auto_only"
  );
}

function chooseOverdriveProfile(input: {
  overdriveRunway: boolean;
  protectedOverdriveRunway: boolean;
  overdriveRiskBudget: number;
  generatedProfitRatio: number;
  canRiskGeneratedProfit: boolean;
  profitCushion: number;
  clearTrendRunway?: boolean;
}): "overdrive_5_auto_only" | "overdrive_6_auto_only" | "overdrive_7_auto_only" {
  if (
    input.clearTrendRunway &&
    (input.profitCushion > 1.7 || input.generatedProfitRatio > 0.16 || input.overdriveRiskBudget > 1.05)
  ) {
    return "overdrive_7_auto_only";
  }

  if (
    input.overdriveRunway &&
    (input.profitCushion > 3.2 || (input.generatedProfitRatio > 0.32 && input.canRiskGeneratedProfit))
  ) {
    return "overdrive_7_auto_only";
  }

  if (
    (input.overdriveRunway && input.profitCushion > 2.6) ||
    (input.protectedOverdriveRunway && input.overdriveRiskBudget > 1.35) ||
    (input.generatedProfitRatio > 0.24 && input.canRiskGeneratedProfit)
  ) {
    return "overdrive_6_auto_only";
  }

  return "overdrive_5_auto_only";
}

function detectPositiveGrowthQualityDeterioration(
  advisory: NyraFinancialAdvisoryOutput["advisory"],
  history: HistoryMap,
): {
  active: boolean;
  stage: "none" | "divergence" | "pre_break";
  exposureCap: number;
  reason: string;
} {
  const qqq1m = history.QQQ.at(-1) ?? 0;
  const qqq3m = average(history.QQQ.slice(-3));
  const qqq6m = average(history.QQQ.slice(-6));
  const qqq12m = average(history.QQQ.slice(-12));
  const euphoriaProxy =
    Math.max(qqq6m, 0) * 0.55 +
    Math.max(qqq12m, 0) * 0.35 +
    Math.max(qqq3m, 0) * 0.1;
  const recentVol3 = std(history.QQQ.slice(-3));
  const priorVol6 = std(history.QQQ.slice(-9, -3));
  const growthStillPositive = qqq3m > 0.25 || qqq6m > 1.1 || qqq12m > 1.8;
  const growthSlowing =
    (qqq6m > 1.4 && qqq3m < qqq6m - 0.25) ||
    (qqq12m > 2 && qqq6m < qqq12m - 0.2) ||
    (qqq1m < qqq3m - 1.25 && qqq6m > 1.2);
  const volatilityRising =
    recentVol3 > priorVol6 + 0.18 ||
    advisory.regime > 0.05 ||
    advisory.break > 0.028;
  const euphoriaStillHigh = advisory.euphoria > 0.42 || euphoriaProxy > 1.05;
  const qualityWorsening =
    advisory.deterioration > 0.02 ||
    advisory.regime > 0.05 ||
    advisory.break > 0.025 ||
    (qqq1m < 0 && growthStillPositive);
  const latentBubbleDeterioration = euphoriaStillHigh && qualityWorsening;
  const preBreak =
    (
      latentBubbleDeterioration &&
      (qqq1m < -1.2 || qqq3m < 0 || advisory.deterioration > 0.045 || advisory.break > 0.06 || advisory.regime > 0.13)
    ) ||
    (
      qqq1m < -1.2 &&
      (advisory.deterioration > 0.035 || advisory.break > 0.04 || advisory.regime > 0.09)
    );
  const divergence =
    growthStillPositive &&
    growthSlowing &&
    volatilityRising &&
    euphoriaStillHigh &&
    qualityWorsening;

  if (preBreak) {
    return {
      active: true,
      stage: "pre_break",
      exposureCap: 0.42,
      reason:
        "Bubble guard: crescita/euforia non bastano piu, qualita in peggioramento. Blocca overdrive e porta esposizione sotto controllo prima del break.",
    };
  }

  if (latentBubbleDeterioration && (qqq1m < 0 || advisory.regime > 0.085 || advisory.break > 0.038)) {
    return {
      active: true,
      stage: "divergence",
      exposureCap: 0.52,
      reason:
        "Bubble guard: euforia ancora presente con qualita in peggioramento. Blocca il falso rientro e riduce ancora esposizione.",
    };
  }

  if (divergence) {
    return {
      active: true,
      stage: "divergence",
      exposureCap: 0.58,
      reason:
        "Bubble guard: crescita ancora positiva ma rallenta, volatilita sale ed euforia resta alta. Riduce progressivamente e blocca overdrive.",
    };
  }

  return { active: false, stage: "none", exposureCap: 1, reason: "" };
}

function capRiskExposure(allocation: Allocation, cap: number): Allocation {
  const riskyAssets: AssetSymbol[] = ["SPY", "QQQ", "BTC"];
  const risky = riskyAssets.reduce((sum, asset) => sum + allocation[asset], 0);
  if (risky <= cap) return allocation;
  const adjusted = { ...allocation };
  const reduction = risky - cap;
  const riskyWeight = risky || 1;

  for (const asset of riskyAssets) {
    adjusted[asset] = allocation[asset] - reduction * (allocation[asset] / riskyWeight);
  }

  adjusted.CASH += reduction;
  const sum = Object.values(adjusted).reduce((acc, value) => acc + value, 0);
  for (const asset of Object.keys(adjusted) as AssetSymbol[]) {
    adjusted[asset] = Math.max(adjusted[asset] / sum, 0);
  }

  return adjusted;
}

function allocationTurnover(a: Allocation, b: Allocation): number {
  return (Object.keys(a) as AssetSymbol[]).reduce((sum, asset) => sum + Math.abs(a[asset] - b[asset]), 0);
}

function riskyWeight(allocation: Allocation): number {
  return allocation.SPY + allocation.QQQ + allocation.BTC;
}

function blendAllocation(from: Allocation, to: Allocation, amount: number): Allocation {
  const blended = Object.fromEntries(
    (Object.keys(from) as AssetSymbol[]).map((asset) => [asset, from[asset] + (to[asset] - from[asset]) * amount]),
  ) as Allocation;
  const sum = Object.values(blended).reduce((acc, value) => acc + Math.max(value, 0), 0);
  if (sum <= 0) return from;
  for (const asset of Object.keys(blended) as AssetSymbol[]) blended[asset] = Math.max(blended[asset], 0) / sum;
  return blended;
}

function estimateExpectedBenefitRatio(
  advisory: NyraFinancialAdvisoryOutput["advisory"],
  history: HistoryMap,
  previous: Allocation,
  next: Allocation,
  safetyUrgent: boolean,
): number {
  if (safetyUrgent) return 0.18;
  const qqq1m = history.QQQ.at(-1) ?? 0;
  const qqq3m = average(history.QQQ.slice(-3));
  const qqq6m = average(history.QQQ.slice(-6));
  const previousRisk = riskyWeight(previous);
  const nextRisk = riskyWeight(next);
  const riskDelta = nextRisk - previousRisk;
  const trendEdge = Math.max(qqq1m, 0) * 0.004 + Math.max(qqq3m, 0) * 0.006 + Math.max(qqq6m, 0) * 0.004;
  const protectionEdge =
    Math.max(previousRisk - nextRisk, 0) *
    (advisory.break * 0.09 + advisory.regime * 0.07 + advisory.deterioration * 0.06);
  const healthyEdge = riskDelta > 0 && advisory.output.alert === "watch" && advisory.output.intensity === "low"
    ? trendEdge + advisory.policy * 0.008
    : trendEdge * 0.45;
  return Math.max(healthyEdge + protectionEdge, 0);
}

function deriveProbabilityRegime(
  advisory: NyraFinancialAdvisoryOutput["advisory"],
  history: HistoryMap,
  lateralMode: boolean,
  bubbleActive: boolean,
): NyraProbabilityRegime {
  const qqq1m = history.QQQ.at(-1) ?? 0;
  const qqq3m = average(history.QQQ.slice(-3));
  const qqq6m = average(history.QQQ.slice(-6));
  const vol6 = std(history.QQQ.slice(-6));
  const flips6 = signFlips(history.QQQ.slice(-6));
  const qualityBreak =
    advisory.break >= 0.26 ||
    advisory.regime >= 0.18 ||
    advisory.deterioration >= 0.1;

  if (advisory.output.alert === "critical" || qqq1m <= -8 || qqq3m <= -4) return "crash";
  if (qualityBreak || (qqq1m < -1.6 && qqq3m > -0.5 && advisory.deterioration > 0.055)) return "pre_break";
  if (bubbleActive || advisory.euphoria > 0.45) return "bubble";
  if (lateralMode || (history.QQQ.length >= 6 && Math.abs(qqq6m) < 1.4 && flips6 >= 3 && vol6 > 1.1)) return "lateral";
  if (
    qqq3m > 1.4 &&
    qqq6m > 2 &&
    advisory.output.alert === "watch" &&
    advisory.output.intensity === "low" &&
    advisory.break < 0.08 &&
    advisory.regime < 0.08 &&
    advisory.deterioration < 0.045
  ) return "bull_clean";
  if (qqq1m > 0.8 && qqq3m > 0.8 && qqq6m > -0.8 && advisory.break < 0.14 && advisory.regime < 0.12 && advisory.deterioration < 0.07) return "recovery";
  if (qqq3m > 0.6 || qqq6m > 1) return "bull_dirty";
  return "lateral";
}

function deriveProbabilityQuality(
  advisory: NyraFinancialAdvisoryOutput["advisory"],
  history: HistoryMap,
  dirtyDataContext: NyraDirtyDataGuardContext | undefined,
): number {
  const volPenalty = Math.min(std(history.QQQ.slice(-6)) / 10, 0.2);
  const dirtyPenalty = isDirtyDataGuardUnreliable(dirtyDataContext) ? 0.22 : 0;
  const breakPenalty = advisory.break * 0.45 + advisory.regime * 0.36 + advisory.deterioration * 0.32;
  const policySupport = Math.min(advisory.policy * 0.08, 0.08);
  return clamp(0.82 + policySupport - breakPenalty - volPenalty - dirtyPenalty, 0, 1);
}

function applyProbabilityRegimeGate(
  allocation: Allocation,
  previousAllocation: Allocation | null,
  decision: ReturnType<typeof chooseNyraProbabilityRegimeAction>,
): { allocation: Allocation; hit: boolean; reason: string } {
  const capped = capRiskExposure(allocation, decision.max_risk_exposure);
  if (decision.action === "overdrive" && decision.overdrive_allowed) {
    return {
      allocation: liftRiskExposure(capped, decision.max_risk_exposure),
      hit: true,
      reason: ` Probability regime gate: ${decision.reason}`,
    };
  }
  if (decision.action === "progressive_reentry" && previousAllocation) {
    return {
      allocation: blendAllocation(previousAllocation, capped, 0.5),
      hit: true,
      reason: ` Probability regime gate: ${decision.reason}`,
    };
  }
  return {
    allocation: capped,
    hit: riskyWeight(capped) < riskyWeight(allocation) || decision.action !== "enter",
    reason: ` Probability regime gate: ${decision.reason}`,
  };
}

function liftRiskExposure(allocation: Allocation, target: number): Allocation {
  const riskyAssets: AssetSymbol[] = ["SPY", "QQQ", "BTC"];
  const risky = riskyAssets.reduce((sum, asset) => sum + allocation[asset], 0);
  if (risky >= target || allocation.CASH <= 0) return allocation;
  const adjusted = { ...allocation };
  const increase = Math.min(target - risky, allocation.CASH);
  const riskyWeight = risky || 1;

  for (const asset of riskyAssets) {
    adjusted[asset] += increase * (allocation[asset] / riskyWeight);
  }
  adjusted.CASH = Math.max(adjusted.CASH - increase, 0);

  const sum = Object.values(adjusted).reduce((acc, value) => acc + value, 0);
  for (const asset of Object.keys(adjusted) as AssetSymbol[]) {
    adjusted[asset] = Math.max(adjusted[asset] / sum, 0);
  }

  return adjusted;
}

function isDirtyDataGuardUnreliable(context: NyraDirtyDataGuardContext | undefined): boolean {
  if (!context) return false;
  const events = context.events ?? [];
  const explicitDirty =
    events.includes("missing_data") ||
    events.includes("stale_signal") ||
    events.includes("false_price_spike") ||
    events.includes("contradictory_signals") ||
    events.includes("sensor_noise_financial");
  if (events.length > 0) return explicitDirty;

  return (
    (typeof context.dataQualityScore === "number" && context.dataQualityScore < 60) ||
    (typeof context.completeness === "number" && context.completeness < 60) ||
    (typeof context.freshness === "number" && context.freshness < 60) ||
    (typeof context.consistency === "number" && context.consistency < 60) ||
    (typeof context.reliability === "number" && context.reliability < 60)
  );
}

function applyDirtyDataGuardStable(
  allocation: Allocation,
  previousAllocation: Allocation,
  context: NyraDirtyDataGuardContext | undefined,
): { allocation: Allocation; hit: boolean; reason: string } {
  if (!isDirtyDataGuardUnreliable(context)) {
    return { allocation, hit: false, reason: "" };
  }

  const qqqCrash = (context?.qqqReturnPct ?? 0) <= -8 || context?.events?.includes("delayed_crash_signal") === true;
  if (qqqCrash) {
    return {
      allocation: capRiskExposure(allocation, 0.2),
      hit: true,
      reason: "Dirty data guard v1 stable: dati sporchi ma crash reale, consente solo downgrade di protezione e limita risk exposure.",
    };
  }

  return {
    allocation: previousAllocation,
    hit: true,
    reason: "Dirty data guard v1 stable: dati mancanti/stale/contraddittori, mantiene allocazione corrente e blocca churn non protettivo.",
  };
}

function applyResidualDirtyDataChurnGuard(
  allocation: Allocation,
  previousAllocation: Allocation,
  context: NyraDirtyDataGuardContext | undefined,
): { allocation: Allocation; hit: boolean; reason: string } {
  if (!context) {
    return { allocation, hit: false, reason: "" };
  }
  if (allocationTurnover(previousAllocation, allocation) >= 0.2) {
    return { allocation, hit: false, reason: "" };
  }
  return {
    allocation: previousAllocation,
    hit: true,
    reason: "Dirty data guard v1 stable: cambio residuo sotto 20% in dati sporchi, skip rebalance.",
  };
}

function isDirtyDataGuardChoppySideEffect(history: HistoryMap, context: NyraDirtyDataGuardContext | undefined): boolean {
  if (!context) return false;
  const qqq6m = average(history.QQQ.slice(-6));
  const flips6 = signFlips(history.QQQ.slice(-6));
  const vol6 = std(history.QQQ.slice(-6));
  return history.QQQ.length >= 6 && Math.abs(qqq6m) < 1.4 && flips6 >= 3 && vol6 > 1.6;
}

function applyDirtyDataChoppySideEffectGuard(
  allocation: Allocation,
  history: HistoryMap,
  context: NyraDirtyDataGuardContext | undefined,
): { allocation: Allocation; hit: boolean; reason: string } {
  if (!isDirtyDataGuardChoppySideEffect(history, context)) {
    return { allocation, hit: false, reason: "" };
  }
  return {
    allocation: capRiskExposure(allocation, 0.04),
    hit: true,
    reason: "Dirty data guard v1 stable: nello scenario sporco/choppy riduce risk exposure residua invece di inseguire rumore.",
  };
}

function detectHealthyBullHighLiquidity(
  advisory: NyraFinancialAdvisoryOutput["advisory"],
  history: HistoryMap,
): { active: boolean; exposureTarget: number; reason: string } {
  const qqq1m = history.QQQ.at(-1) ?? 0;
  const qqq3m = average(history.QQQ.slice(-3));
  const qqq6m = average(history.QQQ.slice(-6));
  const spy3m = average(history.SPY.slice(-3));
  const spy6m = average(history.SPY.slice(-6));
  const cleanTrend =
    qqq1m > 0.6 &&
    qqq3m > 1.6 &&
    qqq6m > 2.2 &&
    spy3m > 1.0 &&
    spy6m > 1.3;
  const noDeterioration =
    advisory.deterioration < 0.028 &&
    advisory.break < 0.035 &&
    advisory.regime < 0.06 &&
    advisory.output.alert === "watch" &&
    advisory.output.intensity === "low";
  const liquidityHigh = advisory.policy >= 0.7;

  if (!cleanTrend || !noDeterioration || !liquidityHigh) {
    return { active: false, exposureTarget: 0, reason: "" };
  }

  const trendStrength = Math.max(qqq3m, qqq6m);
  const exposureTarget = trendStrength >= 4.5 ? 0.95 : trendStrength >= 3.2 ? 0.9 : 0.85;
  return {
    active: true,
    exposureTarget,
    reason:
      "Healthy bull override: bull sano, liquidita alta, niente deterioramento e niente break. L'overdrive puo salire a 85-95% risk exposure.",
  };
}

class HysteresisGate {
  private readonly upgradeThreshold: number;
  private readonly downgradeThreshold: number;

  constructor(upgradeThreshold: number, downgradeThreshold: number) {
    this.upgradeThreshold = upgradeThreshold;
    this.downgradeThreshold = downgradeThreshold;
  }

  shouldHoldHigh(bearishPressure: number, feePressure: number): boolean {
    return bearishPressure < this.downgradeThreshold && feePressure < 0.24;
  }

  shouldAllowUpgrade(bullishPressure: number, feePressure: number): boolean {
    return bullishPressure >= this.upgradeThreshold || feePressure < 0.08;
  }
}

export function selectNyraProfile(
  mode: NyraProfileControlMode,
  advisory: NyraFinancialAdvisoryOutput["advisory"],
  history: HistoryMap,
  options?: {
    manualLevel?: NyraManualProfileLevel;
    previousAutoProfile?: NyraAutoDriveProfile | null;
    previousLateralCandidate?: boolean;
    previousBreakoutCandidate?: boolean;
    capitalContext?: {
      initialCapital: number;
      currentCapital: number;
      annualTurnoverPct?: number;
      horizonYears?: number;
      clientMode?: boolean;
      clientHoldMonths?: number;
    };
  },
): NyraAutoProfileSelection {
  if (mode === "manual") {
    const manualLevel = options?.manualLevel ?? 2;
    const profile = levelToProfile(manualLevel);
    return {
      mode,
      profile,
      manual_level: manualLevel,
      reason: `Modalita manuale: marcia ${manualLevel} forzata dall'utente.`,
      hold_current_position: false,
      lateral_mode: false,
      lateral_candidate: false,
      breakout_candidate: false,
    };
  }

  const previousAutoProfile = options?.previousAutoProfile ?? null;
  const selectorPolicy = loadSelectorAutowritePolicy();
  const releasePolicy = selectorPolicy?.active ? selectorPolicy : undefined;
  const previousLateralCandidate = options?.previousLateralCandidate ?? false;
  const previousBreakoutCandidate = options?.previousBreakoutCandidate ?? false;
  const capitalContext = options?.capitalContext ?? null;
  const annualTurnoverPct = capitalContext?.annualTurnoverPct ?? 0;
  const turnoverPressureActive = annualTurnoverPct > 130;
  const shortHorizonActive = typeof capitalContext?.horizonYears === "number" && capitalContext.horizonYears < 5;
  const clientModeActive = capitalContext?.clientMode === true;
  const spy3m = average(history.SPY.slice(-3));
  const qqq3m = average(history.QQQ.slice(-3));
  const btc3m = average(history.BTC.slice(-3));
  const spy6m = average(history.SPY.slice(-6));
  const qqq6m = average(history.QQQ.slice(-6));
  const qqq1m = history.QQQ.at(-1) ?? 0;
  const spy1m = history.SPY.at(-1) ?? 0;
  const qqq2m = average(history.QQQ.slice(-2));
  const spy2m = average(history.SPY.slice(-2));
  const qqqLast6 = history.QQQ.slice(-6);
  const qqqLast4 = history.QQQ.slice(-4);
  const positiveImpulse = spy3m > 0 && qqq3m > 0;
  const cryptoImpulse = btc3m > 0;
  const longPeriodHealthy = Math.max(spy6m, 0) * 0.4 + Math.max(qqq6m, 0) * 0.6 > 1.7;
  const qqq12m = average(history.QQQ.slice(-12));
  const spy12m = average(history.SPY.slice(-12));
  const btc12m = average(history.BTC.slice(-12));
  const profitCushion =
    Math.max(qqq12m, 0) * 0.45 +
    Math.max(spy12m, 0) * 0.25 +
    Math.max(btc12m, 0) * 0.15 +
    Math.max(qqq6m, 0) * 0.15;
  const efficiency6 = directionalEfficiency(qqqLast6);
  const efficiency4 = directionalEfficiency(qqqLast4);
  const flipCount4 = signFlips(qqqLast4);
  const longPeriodWeakening =
    (qqq1m < -1.5 && qqq3m > 0 && qqq3m < qqq6m) ||
    (advisory.regime > 0.1 && advisory.break > 0.08);
  const lateralCandidateSignal =
    Math.abs(qqq1m) <= 1.76 &&
    Math.abs(qqq3m) <= 1.65 &&
    Math.abs(qqq6m) <= 2.64 &&
    Math.abs(spy3m) <= 1.32 &&
    advisory.break < 0.154 &&
    advisory.regime < 0.121;
  const lateralConfirmedSignal =
    efficiency6 <= 0.154 &&
    efficiency4 <= 0.198 &&
    flipCount4 >= 2 &&
    Math.abs(qqq6m) <= 4.8 &&
    advisory.break < 0.176 &&
    advisory.regime < 0.143;
  const breakoutCandidateSignal =
    previousAutoProfile !== null &&
    (
      previousAutoProfile === "capital_protection" ||
      previousAutoProfile === "balanced_growth"
    ) &&
    !lateralConfirmedSignal &&
    qqq1m > 0.75 + (releasePolicy?.params.breakout_qqq1m_delta ?? 0) &&
    spy1m > 0.45 + (releasePolicy?.params.breakout_spy1m_delta ?? 0) &&
    qqq2m > 0.3 &&
    spy2m > 0.12 &&
    qqq3m > -0.1 &&
    spy3m > -0.15 &&
    efficiency4 > 0.22 &&
    advisory.break < 0.14 + (releasePolicy?.params.recovery_break_max_delta ?? 0) &&
    advisory.regime < 0.11 + (releasePolicy?.params.recovery_regime_max_delta ?? 0) &&
    advisory.policy >= 0.28 + (releasePolicy?.params.breakout_policy_floor_delta ?? 0) &&
    advisory.output.alert !== "critical" &&
    advisory.output.intensity !== "high";
  const breakoutConfirmed = breakoutCandidateSignal && previousBreakoutCandidate;
  const bubbleQualityDeterioration = detectPositiveGrowthQualityDeterioration(advisory, history);
  const recoveryAnticipation = breakoutCandidateSignal && !bubbleQualityDeterioration.active;
  const lateralChop = lateralCandidateSignal || lateralConfirmedSignal;
  const roadOpen =
    positiveImpulse &&
    longPeriodHealthy &&
    advisory.break < 0.12 &&
    advisory.regime < 0.1 &&
    !longPeriodWeakening;
  const roadMostlyOpen =
    positiveImpulse &&
    longPeriodHealthy &&
    advisory.break < 0.22 &&
    advisory.regime < 0.18 &&
    advisory.policy >= 0.4 &&
    !longPeriodWeakening;
  const clearRunway =
    qqq6m > 3.2 &&
    qqq3m > 1.4 &&
    spy6m > 1.8 &&
    qqq1m > -2.2 &&
    advisory.break < 0.24 &&
    advisory.regime < 0.18 &&
    !longPeriodWeakening;
  const overdriveRunway =
    qqq6m > 4.1 &&
    qqq3m > 1.9 &&
    spy6m > 2.5 &&
    qqq1m > -1.6 &&
    advisory.break < 0.16 &&
    advisory.regime < 0.12 &&
    advisory.policy >= 0.04 &&
    !longPeriodWeakening;
  const protectedOverdriveRunway =
    positiveImpulse &&
    longPeriodHealthy &&
    profitCushion > 2.05 &&
    advisory.break < 0.2 &&
    advisory.regime < 0.15 &&
    advisory.output.intensity !== "high" &&
    !lateralChop &&
    !longPeriodWeakening;
  const downgradeNotNecessary =
    advisory.break < 0.18 &&
    advisory.regime < 0.14 &&
    advisory.output.intensity !== "high" &&
    !lateralChop;
  const safeEnoughToJumpHigh =
    advisory.output.alert !== "critical" &&
    advisory.break < 0.2 &&
    advisory.regime < 0.16 &&
    !lateralChop &&
    !longPeriodWeakening;
  const brakeHard =
    advisory.output.alert === "critical" &&
    (advisory.break >= 0.26 || advisory.regime >= 0.22);
  const feePressure =
    (Math.abs(qqq1m) <= 1.5 ? 0.08 : 0) +
    (Math.abs(qqq3m) <= 1.4 ? 0.08 : 0) +
    (Math.abs(qqq6m) <= 2.4 ? 0.06 : 0) +
    (lateralChop ? 0.08 : 0);
  const bearishPressure =
    advisory.break * 0.42 +
    advisory.regime * 0.24 +
    (advisory.output.alert === "critical" ? 0.2 : advisory.output.alert === "high" ? 0.08 : 0) +
    (advisory.output.intensity === "high" ? 0.1 : advisory.output.intensity === "moderate" ? 0.04 : 0) +
    (longPeriodWeakening ? 0.12 : 0) -
    advisory.policy * 0.08;
  const overdriveRiskBudget =
    Math.max(profitCushion - bearishPressure * 3.5 - feePressure * 2, 0);
  const generatedProfit = capitalContext ? Math.max(capitalContext.currentCapital - capitalContext.initialCapital, 0) : 0;
  const generatedProfitRatio = capitalContext && capitalContext.initialCapital > 0
    ? generatedProfit / capitalContext.initialCapital
    : 0;
  const estimatedOverdriveGivebackPct = Math.max(bearishPressure * 0.08 + feePressure * 0.02, 0.015);
  const canRiskGeneratedProfit =
    generatedProfit > 0 &&
    generatedProfit * 0.5 > (capitalContext?.currentCapital ?? 0) * estimatedOverdriveGivebackPct;
  const bullishPressure =
    (positiveImpulse ? 0.14 : 0) +
    (cryptoImpulse ? 0.04 : 0) +
    (longPeriodHealthy ? 0.16 : 0) +
    (roadOpen ? 0.12 : 0) +
    (clearRunway ? 0.18 : 0) +
    (overdriveRunway ? 0.22 : 0) -
    (lateralChop ? 0.16 : 0) -
    (longPeriodWeakening ? 0.12 : 0);
  const hysteresisGate = new HysteresisGate(
    0.3 + (releasePolicy?.params.upgrade_threshold_delta ?? 0),
    0.58 + (releasePolicy?.params.downgrade_threshold_delta ?? 0),
  );
  const lateralConfirmed = lateralConfirmedSignal || (lateralCandidateSignal && previousLateralCandidate);
  const brakeSoft = lateralConfirmed;
  const clearTrendRunway =
    clearRunway &&
    advisory.output.alert === "watch" &&
    advisory.output.intensity === "low" &&
    bearishPressure < 0.11 &&
    feePressure < 0.14;
  const overdriveAllowedByHorizon =
    (!shortHorizonActive && !clientModeActive) ||
    (
      clearTrendRunway &&
      overdriveRunway &&
      overdriveRiskBudget > (clientModeActive ? 1.45 : 1.15) &&
      feePressure < (clientModeActive ? 0.07 : 0.1) &&
      bearishPressure < (clientModeActive ? 0.055 : 0.08) &&
      profitCushion > (clientModeActive ? 2.4 : 0)
    );
  let profile: NyraAutoDriveProfile;
  let reason: string;
  let holdCurrentPosition = false;
  let lateralMode = false;
  const autoOverdriveEnabled = true;

  if (!previousAutoProfile) {
    profile = "capital_protection";
    reason = "Auto: parte in marcia 1, legge il mercato e salta in alto solo quando la strada e chiara.";
  } else if (bubbleQualityDeterioration.active) {
    profile = bubbleQualityDeterioration.stage === "pre_break" ? "capital_protection" : "balanced_growth";
    reason = bubbleQualityDeterioration.reason;
  } else if (
    autoOverdriveEnabled &&
    overdriveAllowedByHorizon &&
    overdriveRunway ||
    (overdriveAllowedByHorizon && protectedOverdriveRunway && overdriveRiskBudget > 1.15) ||
    (
      overdriveAllowedByHorizon &&
      protectedOverdriveRunway &&
      generatedProfitRatio > 0.18 &&
      canRiskGeneratedProfit
    )
  ) {
      profile = chooseOverdriveProfile({
      overdriveRunway,
      protectedOverdriveRunway,
      overdriveRiskBudget,
      generatedProfitRatio,
      canRiskGeneratedProfit,
      profitCushion,
      clearTrendRunway,
    });
    reason = overdriveRunway
      ? "Auto: strada dritta e pulita, attiva l'overdrive piu alto che il profit cushion consente."
      : "Auto: la marcia 4 ha gia costruito profitto e l'overdrive puo rischiare una parte del generato, non dell'investito.";
  } else if (clearRunway) {
    profile = "hard_growth";
    reason = "Auto: runway chiara e trend forte, passa direttamente alla marcia 4.";
  } else if (recoveryAnticipation) {
    profile = "hard_growth";
    reason = "Auto: anticipa la ripresa. Il laterale si sta rompendo con impulso coerente e policy non ostile, rientra prima che il trend sia gia ovvio.";
  } else if (
    advisory.output.alert === "critical" &&
    (
      advisory.break >= 0.26 ||
      advisory.regime >= 0.22
    )
  ) {
    profile = "capital_protection";
    reason = "Auto: break/regime severo, passa alla marcia 1 di protezione capitale.";
  } else if (lateralConfirmed) {
    lateralMode = true;
    profile = previousAutoProfile && (previousAutoProfile === "capital_protection" || previousAutoProfile === "balanced_growth")
      ? previousAutoProfile
      : "capital_protection";
    holdCurrentPosition = previousAutoProfile === profile;
    reason = "Auto: mercato laterale/choppy, smette di inseguire il rumore e comprime l'attivita.";
  } else if (lateralChop) {
    profile = previousAutoProfile ?? "balanced_growth";
    reason = "Auto: possibile laterale rilevato, non frena subito. Aspetta conferma prima di cambiare comportamento.";
  } else if (
    advisory.output.alert === "high" &&
    advisory.output.intensity === "moderate" &&
    roadMostlyOpen
  ) {
    profile = "hard_growth";
    reason = "Auto: stress moderato ma strada abbastanza aperta, passa alla marcia 4.";
  } else if (
    advisory.output.alert === "watch" &&
    roadOpen
  ) {
    profile = "hard_growth";
    reason = "Auto: bull sano e confermato, usa la marcia 4.";
  } else if (positiveImpulse || cryptoImpulse || roadMostlyOpen) {
    profile = "hard_growth";
    reason = "Auto: contesto costruttivo, resta in marcia 4 finche non vede una rottura vera.";
  } else {
    profile = previousAutoProfile ?? "hard_growth";
    reason = "Auto: contesto misto ma senza rottura vera, evita downgrade inutili.";
  }

  if (previousAutoProfile) {
    if (
      isOverdriveProfile(previousAutoProfile) &&
      isOverdriveProfile(profile) &&
      previousAutoProfile !== profile &&
      !bubbleQualityDeterioration.active &&
      !lateralConfirmed &&
      !brakeHard &&
      !brakeSoft &&
      advisory.break < 0.08 &&
      advisory.regime < 0.08 &&
      advisory.deterioration < 0.04
    ) {
      profile = previousAutoProfile;
      reason += " Overdrive hold: contesto sano, non cambia 5/6/7 per micro differenze.";
    }

    if (bubbleQualityDeterioration.active) {
      profile = bubbleQualityDeterioration.stage === "pre_break" ? "capital_protection" : "balanced_growth";
      lateralMode = false;
      holdCurrentPosition = false;
      reason += " Bubble guard priority: non permette recovery anticipation, isteresi alta o overdrive finche qualita e volatilita peggiorano.";
    } else if (previousAutoProfile === "capital_protection" && safeEnoughToJumpHigh) {
      profile = (autoOverdriveEnabled && (
        overdriveAllowedByHorizon &&
        overdriveRunway ||
        (overdriveAllowedByHorizon && protectedOverdriveRunway && overdriveRiskBudget > 1.1) ||
        (overdriveAllowedByHorizon && protectedOverdriveRunway && generatedProfitRatio > 0.16 && canRiskGeneratedProfit)
      ))
        ? chooseOverdriveProfile({
            overdriveRunway,
            protectedOverdriveRunway,
            overdriveRiskBudget,
            generatedProfitRatio,
            canRiskGeneratedProfit,
            profitCushion,
            clearTrendRunway,
          })
        : "hard_growth";
      reason += " Salto diretto: dalla 1 passa subito in alto appena il mercato e leggibile.";
    } else if (
      recoveryAnticipation
    ) {
      profile = "hard_growth";
      lateralMode = false;
      holdCurrentPosition = false;
      reason += " Recovery anticipation: esce dal lock laterale prima, ma solo su ripresa coerente.";
    } else if (
      (previousAutoProfile === "hard_growth" || isOverdriveProfile(previousAutoProfile)) &&
      lateralConfirmed
    ) {
      lateralMode = true;
      profile = "capital_protection";
      reason += " Regime laterale confermato: scende in protezione e poi smette di cambiare.";
    } else if (
      (previousAutoProfile === "hard_growth" || isOverdriveProfile(previousAutoProfile)) &&
      !brakeHard &&
      !brakeSoft &&
      downgradeNotNecessary
    ) {
      profile = (autoOverdriveEnabled && (
        overdriveAllowedByHorizon &&
        overdriveRunway ||
        (overdriveAllowedByHorizon && protectedOverdriveRunway && overdriveRiskBudget > 0.95) ||
        (overdriveAllowedByHorizon && protectedOverdriveRunway && generatedProfitRatio > 0.14 && canRiskGeneratedProfit)
      ))
        ? chooseOverdriveProfile({
            overdriveRunway,
            protectedOverdriveRunway,
            overdriveRiskBudget,
            generatedProfitRatio,
            canRiskGeneratedProfit,
            profitCushion,
            clearTrendRunway,
          })
        : "hard_growth";
      reason += " Isteresi forte: la priorita resta la 4 alta finche non serve frenare davvero.";
    } else if (
      autoOverdriveEnabled &&
      overdriveAllowedByHorizon &&
      previousAutoProfile === "hard_growth" &&
      (bullishPressure > 0.36 || profitCushion > 2.35 || generatedProfitRatio > 0.2) &&
      feePressure < 0.18 &&
      !brakeHard &&
      !brakeSoft &&
      (!capitalContext || canRiskGeneratedProfit)
    ) {
      profile = chooseOverdriveProfile({
        overdriveRunway,
        protectedOverdriveRunway,
        overdriveRiskBudget,
        generatedProfitRatio,
        canRiskGeneratedProfit,
        profitCushion,
        clearTrendRunway,
      });
      reason += " Overdrive bias: la 4 ha gia costruito abbastanza profitto, la 5 puo rischiare solo una parte del guadagnato.";
    } else if (
      (previousAutoProfile === "hard_growth" || isOverdriveProfile(previousAutoProfile)) &&
      brakeSoft
    ) {
      profile = "capital_protection";
      lateralMode = true;
      reason += " Frenata morbida: laterale confermato, scende in protezione e smette di inseguire.";
    } else if (
      (previousAutoProfile === "hard_growth" || isOverdriveProfile(previousAutoProfile)) &&
      brakeHard
    ) {
      profile = "capital_protection";
      reason += " Frenata dura: scende direttamente alla 1.";
    } else if (
      previousAutoProfile === "balanced_growth" &&
      lateralConfirmed
    ) {
      lateralMode = true;
      profile = "balanced_growth";
      holdCurrentPosition = true;
      reason += " Regime laterale: resta fermo in marcia 2 finche non compare una direzione che regge.";
    } else if (
      previousAutoProfile === "balanced_growth" &&
      safeEnoughToJumpHigh &&
      (positiveImpulse || longPeriodHealthy)
    ) {
      profile = autoOverdriveEnabled && overdriveAllowedByHorizon && overdriveRunway
        ? chooseOverdriveProfile({
            overdriveRunway,
            protectedOverdriveRunway,
            overdriveRiskBudget,
            generatedProfitRatio,
            canRiskGeneratedProfit,
            profitCushion,
            clearTrendRunway,
          })
        : "hard_growth";
      reason += " Dalla 2 risale direttamente in alto quando la strada torna pulita.";
    } else if (
      previousAutoProfile === "balanced_growth" &&
      brakeHard
    ) {
      profile = "capital_protection";
      reason += " Dalla 2 passa alla 1 solo su rottura vera.";
    } else if (
      previousAutoProfile === "balanced_growth" &&
      !lateralConfirmed &&
      !brakeHard
    ) {
      profile = "hard_growth";
      reason += " La 2 non serve piu: appena il laterale non e confermato torna in 4.";
    }

    const previousHigh =
      previousAutoProfile === "hard_growth" || isOverdriveProfile(previousAutoProfile);
    const proposedHigh = profile === "hard_growth" || isOverdriveProfile(profile);

    if (bubbleQualityDeterioration.active && proposedHigh) {
      profile = bubbleQualityDeterioration.stage === "pre_break" ? "capital_protection" : "balanced_growth";
      reason += " Bubble guard override: overdrive vietato con crescita positiva ma qualita in peggioramento.";
    } else if (previousHigh && !proposedHigh && !bubbleQualityDeterioration.active && hysteresisGate.shouldHoldHigh(bearishPressure, feePressure)) {
      profile = isOverdriveProfile(previousAutoProfile) && overdriveRunway ? previousAutoProfile : "hard_growth";
      reason += ` HysteresisGate: resta alto, il deterioramento non e abbastanza forte da giustificare churn.${releasePolicy ? " Nyra autowrite release attiva." : ""}`;
    } else if (
      !previousHigh &&
      proposedHigh &&
      !recoveryAnticipation &&
      !hysteresisGate.shouldAllowUpgrade(bullishPressure, feePressure)
    ) {
      profile = previousAutoProfile === "capital_protection" ? "capital_protection" : "balanced_growth";
      reason += ` HysteresisGate: evita upgrade prematuro, il segnale non ha ancora convinzione sufficiente.${releasePolicy ? " Nyra autowrite release attiva." : ""}`;
    }

    const profileChanged = previousAutoProfile !== profile;
    const previousLevel = profileToLevel(previousAutoProfile);
    const proposedLevel = profileToLevel(profile);
    const clientUpgradeNonEssential =
      clientModeActive &&
      proposedLevel > previousLevel &&
      !brakeHard &&
      !brakeSoft &&
      !bubbleQualityDeterioration.active &&
      !recoveryAnticipation &&
      !clearTrendRunway &&
      !clearRunway &&
      !overdriveRunway &&
      !protectedOverdriveRunway &&
      !safeEnoughToJumpHigh &&
      !positiveImpulse &&
      !longPeriodHealthy;
    const upgradeNonEssential =
      turnoverPressureActive &&
      proposedLevel > previousLevel &&
      !brakeHard &&
      !brakeSoft &&
      !bubbleQualityDeterioration.active &&
      !recoveryAnticipation &&
      !clearRunway &&
      !overdriveRunway &&
      !protectedOverdriveRunway &&
      bullishPressure < 0.42;

    if (clientUpgradeNonEssential) {
      profile = previousAutoProfile;
      reason += " Client mode: blocca upgrade non essenziale, serve piu conferma prima di muovere capitale cliente.";
    }

    if (upgradeNonEssential) {
      profile = previousAutoProfile;
      reason += " Fee-efficiency v2 stable: turnover annuo sopra 130%, blocca upgrade non essenziale e conserva budget rebalance.";
    }

    const expectedAdvantageLow =
      Math.abs(bullishPressure - bearishPressure) < 0.16 &&
      !clearRunway &&
      !overdriveRunway &&
      !protectedOverdriveRunway &&
      !lateralConfirmed &&
      !brakeHard &&
      !brakeSoft &&
      !bubbleQualityDeterioration.active;

    if (profileChanged && expectedAdvantageLow && !recoveryAnticipation) {
      profile = previousAutoProfile;
      reason += " Anti-churn: vantaggio atteso basso, non cambia marcia.";
    }
  }

  return {
    mode,
    profile,
    manual_level: profileToLevel(profile),
    reason,
    hold_current_position: holdCurrentPosition,
    lateral_mode: lateralMode,
    lateral_candidate: lateralChop,
    breakout_candidate: breakoutCandidateSignal,
  };
}

export function chooseNyraManagedAllocation(
  mode: NyraProfileControlMode,
  advisory: NyraFinancialAdvisoryOutput["advisory"],
  previousAllocation: Allocation | null,
  history: HistoryMap,
  options?: {
    manualLevel?: NyraManualProfileLevel;
    previousAutoProfile?: NyraAutoDriveProfile | null;
    previousLateralCandidate?: boolean;
    previousBreakoutCandidate?: boolean;
    capitalContext?: {
      initialCapital: number;
      currentCapital: number;
      annualTurnoverPct?: number;
      horizonYears?: number;
      clientMode?: boolean;
      clientHoldMonths?: number;
    };
    dirtyDataContext?: NyraDirtyDataGuardContext;
  },
): {
  selector: NyraAutoProfileSelection;
  allocation: Allocation;
  reason: string;
} {
  const selectorPolicy = loadSelectorAutowritePolicy();
  const releasePolicy = selectorPolicy?.active ? selectorPolicy : undefined;
  const selector = selectNyraProfile(mode, advisory, history, options);
  const bubbleQualityDeterioration = mode === "auto"
    ? detectPositiveGrowthQualityDeterioration(advisory, history)
    : { active: false, stage: "none" as const, exposureCap: 1, reason: "" };
  const healthyBullHighLiquidity = mode === "auto"
    ? detectHealthyBullHighLiquidity(advisory, history)
    : { active: false, exposureTarget: 0, reason: "" };
  const allocationDecision = chooseNyraRiskProfileAllocation(
    isOverdriveProfile(selector.profile) ? "hard_growth" : selector.profile,
    advisory,
    previousAllocation,
    history,
  );
  const rawAllocation =
    selector.lateral_mode && !selector.hold_current_position
      ? {
          SPY: 0,
          QQQ: 0.18,
          BTC: 0,
          GLD: 0.02,
          TLT: 0,
          CASH: 0.8,
        }
      : selector.hold_current_position && previousAllocation
      ? previousAllocation
      : selector.profile === "overdrive_5_auto_only"
        ? applyOverdrive5Overlay(allocationDecision.allocation)
        : selector.profile === "overdrive_6_auto_only"
          ? applyOverdrive6Overlay(allocationDecision.allocation)
          : selector.profile === "overdrive_7_auto_only"
            ? applyOverdrive7Overlay(allocationDecision.allocation)
            : allocationDecision.allocation;
  const allocation = bubbleQualityDeterioration.active
    ? capRiskExposure(rawAllocation, bubbleQualityDeterioration.exposureCap)
    : healthyBullHighLiquidity.active && isOverdriveProfile(selector.profile)
      ? liftRiskExposure(rawAllocation, healthyBullHighLiquidity.exposureTarget)
      : rawAllocation;
  const allocationChange = previousAllocation ? allocationTurnover(previousAllocation, allocation) : 1;
  const safetyUrgent =
    advisory.output.alert === "critical" ||
    advisory.break >= 0.22 ||
    advisory.regime >= 0.18 ||
    selector.lateral_mode ||
    bubbleQualityDeterioration.stage === "pre_break";
  const riskIncrease = previousAllocation ? riskyWeight(allocation) > riskyWeight(previousAllocation) : false;
  const annualTurnoverPct = options?.capitalContext?.annualTurnoverPct ?? 0;
  const shortHorizonActive = typeof options?.capitalContext?.horizonYears === "number" && options.capitalContext.horizonYears < 5;
  const clientModeActive = options?.capitalContext?.clientMode === true;
  const clientHoldMonths = Math.max(options?.capitalContext?.clientHoldMonths ?? 0, 0);
  const turnoverPressureActive = annualTurnoverPct > 130;
  const thresholdMultiplier = (turnoverPressureActive ? 1.1 : 1) * (shortHorizonActive ? 1.4 : 1) * (clientModeActive ? 1.15 : 1);
  const minDelta = safetyUrgent ? 0 : riskIncrease ? 0.05 * thresholdMultiplier : 0.08 * thresholdMultiplier;
  const estimatedFee = allocationChange * TRADE_COST_RATE;
  const expectedBenefit = previousAllocation
    ? estimateExpectedBenefitRatio(advisory, history, previousAllocation, allocation, safetyUrgent)
    : 1;
  const minExpectedEdge =
    (isOverdriveProfile(selector.profile) ? 0.025 : 0.015) *
    (releasePolicy?.params.min_expected_edge_multiplier ?? 1);
  const feeAwareSkip =
    previousAllocation !== null &&
    !safetyUrgent &&
    expectedBenefit <= estimatedFee * 3;
  const edgeSkip =
    previousAllocation !== null &&
    !safetyUrgent &&
    expectedBenefit < minExpectedEdge * (turnoverPressureActive && riskIncrease ? 1.1 : 1) * (clientModeActive && riskIncrease ? 1.05 : 1) &&
    !healthyBullHighLiquidity.active;
  const smallChangeHold = mode === "auto" && previousAllocation !== null && allocationChange < minDelta;
  const clientHoldActive =
    mode === "auto" &&
    clientModeActive &&
    previousAllocation !== null &&
    clientHoldMonths > 0 &&
    !safetyUrgent &&
    riskIncrease &&
    !clearRunway &&
    !clearTrendRunway &&
    !overdriveRunway &&
    !protectedOverdriveRunway &&
    !healthyBullHighLiquidity.active;
  const probabilityRegime = mode === "auto"
    ? deriveProbabilityRegime(advisory, history, selector.lateral_mode, bubbleQualityDeterioration.active)
    : null;
  const rawProbabilityExpectedValue = previousAllocation
    ? estimateExpectedBenefitRatio(advisory, history, previousAllocation, allocation, safetyUrgent)
    : estimateExpectedBenefitRatio(advisory, history, { SPY: 0, QQQ: 0, BTC: 0, GLD: 0, TLT: 0, CASH: 1 }, allocation, safetyUrgent);
  const probabilityExpectedValue = healthyBullHighLiquidity.active
    ? Math.max(rawProbabilityExpectedValue + 0.025, 0.045)
    : rawProbabilityExpectedValue;
  const probabilityQuality = deriveProbabilityQuality(advisory, history, options?.dirtyDataContext);
  const probabilityDecision = probabilityRegime
    ? chooseNyraProbabilityRegimeAction({
        regime: probabilityRegime,
        expected_value: probabilityExpectedValue,
        quality_score: probabilityQuality,
      })
    : null;
  const partialRebalance =
    mode === "auto" &&
    previousAllocation !== null &&
    !safetyUrgent &&
    allocationChange >= (clientModeActive ? 0.1 : shortHorizonActive ? 0.08 : 0.34) &&
    !bubbleQualityDeterioration.active &&
    !selector.lateral_mode;
  const partialRebalanceAmount = clamp(
    (clientModeActive ? 0.3 : shortHorizonActive ? 0.35 : 0.5) +
      (releasePolicy?.params.partial_rebalance_amount_delta ?? 0),
    0.2,
    0.75,
  );
  const probabilityGate = mode === "auto" && probabilityDecision
    ? applyProbabilityRegimeGate(allocation, previousAllocation, probabilityDecision)
    : { allocation, hit: false, reason: "" };
  const gatedAllocation = probabilityGate.allocation;
  const preDirtyGuardAllocation = smallChangeHold || feeAwareSkip || edgeSkip || clientHoldActive
    ? previousAllocation ?? allocation
    : partialRebalance
      ? blendAllocation(previousAllocation, gatedAllocation, partialRebalanceAmount)
      : gatedAllocation;
  const dirtyGuard = mode === "auto" && previousAllocation
    ? applyDirtyDataGuardStable(preDirtyGuardAllocation, previousAllocation, options?.dirtyDataContext)
    : { allocation: preDirtyGuardAllocation, hit: false, reason: "" };
  const dirtyChoppyGuard = mode === "auto" && previousAllocation
    ? applyDirtyDataChoppySideEffectGuard(dirtyGuard.allocation, history, options?.dirtyDataContext)
    : dirtyGuard;
  const residualDirtyGuard = mode === "auto" && previousAllocation
    ? applyResidualDirtyDataChurnGuard(dirtyChoppyGuard.allocation, previousAllocation, options?.dirtyDataContext)
    : dirtyChoppyGuard;
  const finalAllocation = residualDirtyGuard.allocation;

  return {
    selector,
    allocation: finalAllocation,
    reason: `${selector.reason} ${bubbleQualityDeterioration.active ? bubbleQualityDeterioration.reason : ""} ${healthyBullHighLiquidity.active && isOverdriveProfile(selector.profile) ? healthyBullHighLiquidity.reason : ""} ${probabilityGate.hit ? probabilityGate.reason : ""} ${releasePolicy ? " Nyra selector autowrite: release misurata attiva su recovery/bull, con edge threshold e re-entry piu liberi." : ""} ${clientModeActive && !safetyUrgent ? " Client mode: hold minimo 3-6 mesi, soglie rebalance piu alte e overdrive solo con edge forte." : ""} ${shortHorizonActive && !safetyUrgent ? " Fee-efficiency v2 stable: orizzonte sotto 5 anni, soglie rebalance piu alte, cooldown piu lungo e overdrive piu selettivo." : ""} ${turnoverPressureActive && !safetyUrgent ? " Fee-efficiency v2 stable: turnover annuo sopra 130%, soglie rebalance alzate e upgrade filtrati." : ""} ${clientHoldActive ? " Client mode: hold minimo attivo, blocca upgrade fino al prossimo checkpoint utile." : ""} ${smallChangeHold ? " Fee-efficiency v2: cambio allocazione sotto soglia, skip rebalance." : ""} ${feeAwareSkip ? " Fee-efficiency v2: beneficio atteso non supera fee stimate x3, skip." : ""} ${edgeSkip ? " Fee-efficiency v2: edge atteso sotto soglia, non cambia." : ""} ${partialRebalance ? ` Fee-efficiency v2: cambio grande non urgente, applica solo ${Math.round(partialRebalanceAmount * 100)}% del delta.` : ""} ${dirtyGuard.hit ? dirtyGuard.reason : ""} ${dirtyChoppyGuard.hit ? dirtyChoppyGuard.reason : ""} ${residualDirtyGuard.hit && residualDirtyGuard.reason !== dirtyGuard.reason && residualDirtyGuard.reason !== dirtyChoppyGuard.reason ? residualDirtyGuard.reason : ""} ${selector.hold_current_position ? " Hold posizione attiva per ridurre churn." : allocationDecision.reason}`,
  };
}

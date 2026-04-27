import type { NyraAutoDriveProfile } from "./nyra-auto-profile-selector.ts";

type Asset = "QQQ" | "GLD" | "TLT" | "CASH";
type Allocation = Record<Asset, number>;
type HistoryMap = Record<"QQQ" | "GLD" | "TLT", number[]>;

export type NyraAutoSelectorGovernorAction =
  | "survival_mode"
  | "recovery_accelerator"
  | "lateral_regime_lock"
  | "rebalance_budget_guard"
  | "cooldown_after_major_change"
  | "hold_cost_guard"
  | "lateral_kill"
  | "drawdown_guard"
  | "crash_guard"
  | "overdrive_cap"
  | "progressive_reentry"
  | "pass";

export type NyraAutoSelectorGovernorInput = {
  proposedAllocation: Allocation;
  currentAllocation: Allocation;
  selectorProfile: NyraAutoDriveProfile;
  initialCapital: number;
  currentCapital: number;
  peakCapital: number;
  feesTotal: number;
  annualTurnoverPct?: number;
  overdriveTimePct: number;
  history: HistoryMap;
};

export type NyraAutoSelectorGovernorOutput = {
  allocation: Allocation;
  action: NyraAutoSelectorGovernorAction;
  overdriveAllowed: boolean;
  reason: string;
};

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function signFlips(values: number[]): number {
  let flips = 0;
  let previous = 0;
  for (const value of values) {
    const sign = value > 0 ? 1 : value < 0 ? -1 : 0;
    if (sign !== 0 && previous !== 0 && sign !== previous) flips += 1;
    if (sign !== 0) previous = sign;
  }
  return flips;
}

function normalizeAllocation(input: Partial<Allocation>): Allocation {
  const full: Allocation = {
    QQQ: Math.max(input.QQQ ?? 0, 0),
    GLD: Math.max(input.GLD ?? 0, 0),
    TLT: Math.max(input.TLT ?? 0, 0),
    CASH: Math.max(input.CASH ?? 0, 0),
  };
  const sum = Object.values(full).reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return { QQQ: 0, GLD: 0, TLT: 0, CASH: 1 };
  return { QQQ: full.QQQ / sum, GLD: full.GLD / sum, TLT: full.TLT / sum, CASH: full.CASH / sum };
}

function turnover(a: Allocation, b: Allocation): number {
  return (Object.keys(a) as Asset[]).reduce((sum, asset) => sum + Math.abs(a[asset] - b[asset]), 0);
}

function isOverdrive(profile: NyraAutoDriveProfile): boolean {
  return profile === "overdrive_5_auto_only" || profile === "overdrive_6_auto_only" || profile === "overdrive_7_auto_only";
}

function blendAllocation(from: Allocation, to: Allocation, amount: number): Allocation {
  return normalizeAllocation({
    QQQ: from.QQQ + (to.QQQ - from.QQQ) * amount,
    GLD: from.GLD + (to.GLD - from.GLD) * amount,
    TLT: from.TLT + (to.TLT - from.TLT) * amount,
    CASH: from.CASH + (to.CASH - from.CASH) * amount,
  });
}

function estimateExpectedBenefitRatio(input: {
  qqq1m: number;
  qqq3m: number;
  qqq6m: number;
  qqqVol6m: number;
  drawdown: number;
  currentRisk: number;
  proposedRisk: number;
  lateral: boolean;
  strongTrend: boolean;
  safetyUrgent: boolean;
}): number {
  if (input.safetyUrgent) return 0.18;
  const riskDelta = input.proposedRisk - input.currentRisk;
  const trendEdge =
    Math.max(input.qqq1m, 0) * 0.004 +
    Math.max(input.qqq3m, 0) * 0.006 +
    Math.max(input.qqq6m, 0) * 0.004;
  const recoveryEdge = input.drawdown > 8 && input.qqq3m > 1 ? 0.018 : 0;
  const lateralPenalty = input.lateral ? 0.025 : 0;
  const volatilityPenalty = Math.max(input.qqqVol6m - 4, 0) * 0.002;
  const riskIncreasePenalty = riskDelta > 0 && !input.strongTrend ? 0.01 : 0;
  return Math.max(trendEdge + recoveryEdge - lateralPenalty - volatilityPenalty - riskIncreasePenalty, 0);
}

export function governNyraAutoSelectorRisk(input: NyraAutoSelectorGovernorInput): NyraAutoSelectorGovernorOutput {
  const qqq1m = input.history.QQQ.at(-1) ?? 0;
  const qqq3m = average(input.history.QQQ.slice(-3));
  const qqq6m = average(input.history.QQQ.slice(-6));
  const qqqVol6m = std(input.history.QQQ.slice(-6));
  const qqqLast6 = input.history.QQQ.slice(-6);
  const flips6 = signFlips(qqqLast6);
  const lateral = input.history.QQQ.length >= 6 && Math.abs(qqq6m) < 1.2 && flips6 >= 3 && qqqVol6m > 1.3;
  const lateralRegimeLock = input.history.QQQ.length >= 8 && Math.abs(qqq6m) < 1.65 && flips6 >= 3 && qqqVol6m > 1.1 && qqq3m < 1.35;
  const drawdown = input.peakCapital > 0 ? ((input.peakCapital - input.currentCapital) / input.peakCapital) * 100 : 0;
  const feePct = (input.feesTotal / input.initialCapital) * 100;
  const annualTurnoverPct = input.annualTurnoverPct ?? 0;
  const proposed = normalizeAllocation(input.proposedAllocation);
  const t = turnover(input.currentAllocation, proposed);
  const strongTrend = qqq1m > -2 && qqq3m > 2.2 && qqq6m > 1.8 && !lateral;
  const cleanTrend = qqq1m > -3 && qqq3m > 1.2 && qqq6m > 0.8 && !lateral;
  const currentRisk = input.currentAllocation.QQQ + input.currentAllocation.GLD + input.currentAllocation.TLT;
  const proposedRisk = proposed.QQQ + proposed.GLD + proposed.TLT;
  const riskJump = proposedRisk - currentRisk;
  const qqqJump = proposed.QQQ - input.currentAllocation.QQQ;
  const safetyUrgent = drawdown >= 22 || qqq1m <= -8 || qqq3m <= -4 || lateralRegimeLock;
  const annualTurnoverWarningActive = annualTurnoverPct > 130;
  const annualTurnoverCapActive = annualTurnoverPct > 150 || feePct > 9;
  const turnoverThresholdMultiplier = annualTurnoverCapActive ? 1.5 : annualTurnoverWarningActive ? 1.1 : 1;
  const minDelta = safetyUrgent ? 0 : riskJump > 0 ? 0.05 * turnoverThresholdMultiplier : 0.08 * turnoverThresholdMultiplier;
  const estimatedFee = t * 0.003;
  const expectedBenefit = estimateExpectedBenefitRatio({
    qqq1m,
    qqq3m,
    qqq6m,
    qqqVol6m,
    drawdown,
    currentRisk,
    proposedRisk,
    lateral,
    strongTrend,
    safetyUrgent,
  });
  const minExpectedEdge = (isOverdrive(input.selectorProfile) ? 0.025 : 0.015) * (annualTurnoverWarningActive && riskJump > 0 ? 1.1 : 1);
  const recoverySignal =
    drawdown >= 10 &&
    drawdown < 35 &&
    qqq1m > 1.2 &&
    qqq3m > 1.0 &&
    qqq6m > -1.2 &&
    qqqVol6m < 6.5 &&
    !lateralRegimeLock;

  if (drawdown >= 35) {
    return {
      allocation: normalizeAllocation({ QQQ: 0.04, GLD: 0.28, TLT: 0.24, CASH: 0.44 }),
      action: "survival_mode",
      overdriveAllowed: false,
      reason: "Survival mode: drawdown sopra soglia, prima sopravvivenza del capitale, poi rientro.",
    };
  }

  if (drawdown >= 22) {
    return {
      allocation: normalizeAllocation({ QQQ: 0.12, GLD: 0.3, TLT: 0.28, CASH: 0.3 }),
      action: "drawdown_guard",
      overdriveAllowed: false,
      reason: "Drawdown oltre soglia: rientro in protezione capitale.",
    };
  }

  if (lateralRegimeLock) {
    return {
      allocation: normalizeAllocation({ QQQ: 0.08, GLD: 0.14, TLT: 0.1, CASH: 0.68 }),
      action: "lateral_regime_lock",
      overdriveAllowed: false,
      reason: "Lateral regime lock: oscillazione senza direzione, blocca rientri finche non compare breakout confermato.",
    };
  }

  if (qqq1m <= -8 || qqq3m <= -4) {
    return {
      allocation: normalizeAllocation({ QQQ: 0.1, GLD: 0.32, TLT: 0.28, CASH: 0.3 }),
      action: "crash_guard",
      overdriveAllowed: false,
      reason: "Crash guard attiva: rischio recente troppo alto per overdrive.",
    };
  }

  if (recoverySignal) {
    const targetQqq = qqq3m > 2.2 && qqq6m > 0 ? 0.72 : 0.58;
    return {
      allocation: normalizeAllocation({ QQQ: targetQqq, GLD: 0.1, TLT: 0.08, CASH: 1 - targetQqq - 0.18 }),
      action: "recovery_accelerator",
      overdriveAllowed: false,
      reason: "Recovery accelerator: dopo drawdown, trend di recupero confermato. Rientra piu veloce senza overdrive.",
    };
  }

  if (!safetyUrgent && (annualTurnoverWarningActive || annualTurnoverCapActive) && riskJump > 0 && !strongTrend) {
    return {
      allocation: input.currentAllocation,
      action: "rebalance_budget_guard",
      overdriveAllowed: false,
      reason: "Fee-efficiency v2 stable: turnover annuo sopra soglia, blocca upgrade non essenziale e consente solo downgrade di protezione.",
    };
  }

  if (!safetyUrgent && (t < minDelta || expectedBenefit < minExpectedEdge || expectedBenefit <= estimatedFee * 3)) {
    return {
      allocation: input.currentAllocation,
      action: "hold_cost_guard",
      overdriveAllowed: false,
      reason: "Fee-efficiency v2: delta/edge/benefit-fee insufficienti, skip rebalance.",
    };
  }

  if ((riskJump > 0.5 || qqqJump > 0.42) && !strongTrend && drawdown < 18) {
    return {
      allocation: blendAllocation(input.currentAllocation, proposed, 0.5),
      action: "cooldown_after_major_change",
      overdriveAllowed: false,
      reason: "Fee-efficiency v2: cambio grande non urgente, applica 50% del delta e attiva cooldown.",
    };
  }

  if (lateral) {
    return {
      allocation: normalizeAllocation({ QQQ: 0.1, GLD: 0.16, TLT: 0.12, CASH: 0.62 }),
      action: "lateral_kill",
      overdriveAllowed: false,
      reason: "Laterale sporco: taglio overdrive e riduco inseguimento falso breakout.",
    };
  }

  if (strongTrend && drawdown < 18 && feePct <= 7) {
    return {
      allocation: normalizeAllocation({ QQQ: 0.72, GLD: 0.07, TLT: 0.05, CASH: 0.16 }),
      action: "progressive_reentry",
      overdriveAllowed: false,
      reason: "Trend pulito: rientro progressivo senza overdrive pieno.",
    };
  }

  if (cleanTrend && feePct <= 4 && drawdown < 14 && proposed.QQQ > input.currentAllocation.QQQ + 0.12) {
    return {
      allocation: normalizeAllocation({ QQQ: 0.62, GLD: 0.09, TLT: 0.07, CASH: 0.22 }),
      action: "progressive_reentry",
      overdriveAllowed: false,
      reason: "Rientro moderato: trend positivo ma budget rischio ancora limitato.",
    };
  }

  if (feePct > 7.5 || t < 0.18) {
    return {
      allocation: input.currentAllocation,
      action: "hold_cost_guard",
      overdriveAllowed: false,
      reason: "Fee/turnover guard: hold per ridurre churn.",
    };
  }

  if (isOverdrive(input.selectorProfile) && (input.overdriveTimePct > 10 || feePct > 5 || drawdown > 12 || qqq3m < 1.25)) {
    return {
      allocation: normalizeAllocation({
        QQQ: Math.min(proposed.QQQ, 0.52),
        GLD: Math.max(proposed.GLD, 0.12),
        TLT: Math.max(proposed.TLT, 0.08),
        CASH: Math.max(proposed.CASH, 0.24),
      }),
      action: "overdrive_cap",
      overdriveAllowed: false,
      reason: "Overdrive sopra budget o rischio/fee elevati: cap esposizione.",
    };
  }

  return {
    allocation: proposed,
    action: "pass",
    overdriveAllowed: isOverdrive(input.selectorProfile),
    reason: "Governor non interviene.",
  };
}

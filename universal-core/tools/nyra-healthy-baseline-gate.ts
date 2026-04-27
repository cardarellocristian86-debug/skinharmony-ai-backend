export type NyraHealthyBaselineRawSignals = {
  growth?: number;
  liquidity?: number;
  default_rate?: number;
  volatility?: number;
  policy_support?: number;
};

export type NyraHealthyBaselineGateOutput = {
  adjusted_risk_multiplier: number;
  baseline_state: "healthy" | "watch" | "deteriorating";
  notes: string[];
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

export function applyHealthyBaselineGate(
  signals: NyraHealthyBaselineRawSignals,
): NyraHealthyBaselineGateOutput {
  const growth = clamp(Number(signals.growth ?? 0));
  const liquidity = clamp(Number(signals.liquidity ?? 0));
  const defaultRate = clamp(Number(signals.default_rate ?? 0));
  const volatility = clamp(Number(signals.volatility ?? 0));
  const policySupport = clamp(Number(signals.policy_support ?? 0));

  const notes: string[] = [];

  if (
    growth > 0.5 &&
    liquidity > 0.5 &&
    defaultRate < 0.3 &&
    volatility < 0.4 &&
    policySupport > 0.5
  ) {
    notes.push("Condizioni di base sane: nessun deterioramento sistemico evidente.");
    return {
      adjusted_risk_multiplier: 0.6,
      baseline_state: "healthy",
      notes,
    };
  }

  if (
    growth > 0.4 &&
    defaultRate < 0.5 &&
    volatility < 0.6
  ) {
    notes.push("Pressione presente ma senza deterioramento strutturale.");
    return {
      adjusted_risk_multiplier: 0.8,
      baseline_state: "watch",
      notes,
    };
  }

  notes.push("Segnali di deterioramento reale rilevati.");
  return {
    adjusted_risk_multiplier: 1,
    baseline_state: "deteriorating",
    notes,
  };
}

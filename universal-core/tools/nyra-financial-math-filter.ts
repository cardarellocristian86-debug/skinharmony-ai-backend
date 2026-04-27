export type NyraFinancialMathFilterInput = Record<string, number>;

export type NyraFinancialMathFeatures = {
  bubble_pressure: number;
  deterioration_velocity: number;
  systemic_contagion: number;
  regime_instability: number;
  concentration_fragility: number;
  residual_policy_gap: number;
  net_systemic_risk: number;
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

function read(input: NyraFinancialMathFilterInput, key: string): number {
  return clamp(Number(input[key] ?? 0));
}

function stageScore(value: number, start: number, full: number): number {
  if (value <= start) return 0;
  if (value >= full) return 1;
  return clamp((value - start) / (full - start));
}

export function deriveNyraFinancialMathFeatures(
  input: NyraFinancialMathFilterInput,
): NyraFinancialMathFeatures {
  const equityEuphoria = read(input, "equity_euphoria");
  const valuationExpansion = read(input, "valuation_expansion");
  const techConcentration = read(input, "tech_concentration");
  const ipoSpeculation = read(input, "ipo_speculation_pressure");

  const housingGrowth = read(input, "housing_growth");
  const creditExpansion = read(input, "credit_expansion");
  const mortgageBurden = read(input, "mortgage_burden");
  const delinquencyTrend = read(input, "delinquency_trend");
  const leverage = read(input, "leverage");
  const subprimeDeterioration = read(input, "subprime_deterioration");

  const spreadPressure = read(input, "sovereign_spread_pressure");
  const bankingStress = read(input, "banking_stress");
  const fiscalStress = read(input, "fiscal_stress");
  const contagionRisk = read(input, "contagion_risk");
  const policyUncertainty = read(input, "policy_uncertainty");

  const volatilityShock = read(input, "volatility_shock");
  const liquidityStress = read(input, "liquidity_stress");
  const growthShock = read(input, "growth_shock");
  const marketDislocation = read(input, "market_dislocation");

  const inflationPressure = read(input, "inflation_pressure");
  const rateHikePressure = read(input, "rate_hike_pressure");
  const durationRisk = read(input, "duration_risk");
  const equityCompression = read(input, "equity_multiple_compression");
  const correlationBreakdown = read(input, "bond_equity_correlation_breakdown");

  const depositFlightRisk = read(input, "deposit_flight_risk");
  const unrealizedBondLosses = read(input, "unrealized_bond_losses");
  const rateShock = read(input, "rate_shock");
  const regionalBankFragility = read(input, "regional_bank_fragility");

  const deteriorationAfterPeak = read(input, "deterioration_after_peak");
  const policySupport = Math.max(
    read(input, "policy_support"),
    read(input, "policy_response"),
    read(input, "liquidity_intervention"),
  );

  const euphoriaRaw = clamp(
    valuationExpansion * 0.26 +
    equityEuphoria * 0.2 +
    techConcentration * 0.14 +
    ipoSpeculation * 0.12 +
    housingGrowth * 0.12 +
    creditExpansion * 0.1 +
    inflationPressure * 0.06,
  );
  const deteriorationRaw = clamp(
    deteriorationAfterPeak * 0.22 +
    subprimeDeterioration * 0.22 +
    delinquencyTrend * 0.16 +
    bankingStress * 0.12 +
    regionalBankFragility * 0.1 +
    liquidityStress * 0.1 +
    growthShock * 0.08,
  );
  const breakRaw = clamp(
    contagionRisk * 0.18 +
    marketDislocation * 0.16 +
    liquidityStress * 0.14 +
    depositFlightRisk * 0.12 +
    unrealizedBondLosses * 0.1 +
    spreadPressure * 0.1 +
    bankingStress * 0.1 +
    rateShock * 0.1,
  );
  const regimeRaw = clamp(
    volatilityShock * 0.2 +
    marketDislocation * 0.16 +
    liquidityStress * 0.14 +
    growthShock * 0.12 +
    rateHikePressure * 0.1 +
    rateShock * 0.1 +
    correlationBreakdown * 0.1 +
    policyUncertainty * 0.08,
  );

  const euphoriaStage = stageScore(euphoriaRaw, 0.42, 0.82);
  const deteriorationStage = stageScore(deteriorationRaw, 0.34, 0.74);
  const breakStage = stageScore(breakRaw, 0.46, 0.82);
  const regimeStage = stageScore(regimeRaw, 0.34, 0.72);

  const bubblePressure = clamp(euphoriaRaw * (0.45 + 0.4 * (1 - deteriorationStage)));
  const deteriorationVelocity = clamp(deteriorationRaw * (0.35 + 0.65 * Math.max(deteriorationStage, breakStage * 0.6)));
  const systemicContagion = clamp(breakRaw * (0.3 + 0.7 * Math.max(breakStage, deteriorationStage * 0.5)));
  const regimeInstability = clamp(regimeRaw * (0.45 + 0.4 * Math.max(regimeStage, breakStage * 0.4)));

  const concentrationFragility = clamp(
    techConcentration * 0.26 +
    ipoSpeculation * 0.16 +
    leverage * 0.16 +
    bankingStress * 0.12 +
    regionalBankFragility * 0.1 +
    equityCompression * 0.1 +
    durationRisk * 0.1,
  ) * (0.5 + 0.45 * Math.max(euphoriaStage, deteriorationStage));

  const stressBase = clamp((deteriorationRaw + breakRaw + regimeRaw) / 3);
  const residualPolicyGap = clamp((1 - policySupport) * (0.25 + 0.75 * stressBase));

  const watchRisk = bubblePressure * 0.65;
  const warningRisk = clamp(
    deteriorationVelocity * 0.5 +
    regimeInstability * 0.3 +
    concentrationFragility * 0.2,
  );
  const breakRisk = clamp(
    systemicContagion * 0.42 +
    deteriorationVelocity * 0.28 +
    regimeInstability * 0.18 +
    concentrationFragility * 0.12,
  );

  const netSystemicRisk = clamp(
    watchRisk * 0.18 +
    warningRisk * 0.34 +
    breakRisk * 0.38 +
    residualPolicyGap * 0.1 -
    policySupport * 0.12 * Math.max(breakStage, regimeStage),
  );

  return {
    bubble_pressure: bubblePressure,
    deterioration_velocity: deteriorationVelocity,
    systemic_contagion: systemicContagion,
    regime_instability: regimeInstability,
    concentration_fragility: concentrationFragility,
    residual_policy_gap: residualPolicyGap,
    net_systemic_risk: netSystemicRisk,
  };
}

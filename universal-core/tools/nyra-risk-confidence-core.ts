export type NyraRiskInput = {
  confidence: number;
  error_probability: number;
  impact: number;
  reversibility: number;
  uncertainty: number;
};

export type NyraRiskBand = "low" | "medium" | "high" | "blocked";

export type NyraRiskOutput = {
  version: "nyra_risk_confidence_core_v1";
  normalized: NyraRiskInput;
  weights: {
    error: number;
    impact: number;
    reversibility: number;
    uncertainty: number;
  };
  risk_score: number;
  band: NyraRiskBand;
  should_retry: boolean;
  should_fallback: boolean;
  should_escalate: boolean;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function deriveNyraRiskConfidence(input: NyraRiskInput): NyraRiskOutput {
  const normalized: NyraRiskInput = {
    confidence: clamp01(input.confidence),
    error_probability: clamp01(input.error_probability),
    impact: clamp01(input.impact),
    reversibility: clamp01(input.reversibility),
    uncertainty: clamp01(input.uncertainty),
  };

  const weights = {
    error: 0.35,
    impact: 0.25,
    reversibility: 0.25,
    uncertainty: 0.15,
  } as const;

  const baseRisk =
    normalized.error_probability * weights.error +
    normalized.impact * weights.impact +
    (1 - normalized.reversibility) * weights.reversibility +
    normalized.uncertainty * weights.uncertainty;

  const confidenceFactor = 1 - normalized.confidence * 0.6;
  let riskScore = clamp01(baseRisk * confidenceFactor);

  const extremeIrreversibleCase =
    normalized.impact > 0.9 &&
    normalized.reversibility < 0.1 &&
    normalized.error_probability > 0.6;

  if (extremeIrreversibleCase) {
    riskScore = Math.max(riskScore, 0.85);
  }

  let band: NyraRiskBand;
  if (riskScore < 0.3) band = "low";
  else if (riskScore < 0.55) band = "medium";
  else if (riskScore < 0.8) band = "high";
  else band = "blocked";

  let shouldRetry =
    normalized.error_probability > 0.4 &&
    normalized.impact < 0.6 &&
    normalized.reversibility > 0.5;

  const shouldFallback =
    band === "high" ||
    riskScore > 0.55 ||
    normalized.uncertainty > 0.6;

  const shouldEscalate =
    (riskScore > 0.8 || band === "blocked") &&
    normalized.impact > 0.7 &&
    normalized.reversibility < 0.3;

  if (riskScore > 0.85) {
    band = "blocked";
    shouldRetry = false;
  }

  return {
    version: "nyra_risk_confidence_core_v1",
    normalized,
    weights,
    risk_score: round(riskScore),
    band,
    should_retry: shouldRetry,
    should_fallback: shouldFallback,
    should_escalate: shouldEscalate,
  };
}

export const computeNyraRisk = deriveNyraRiskConfidence;

export type NyraReplayBucket = "low" | "medium" | "high";

export type NyraRegimeSnapshot = {
  symbol: string;
  bucket: NyraReplayBucket;
  recent_return_pct: number;
  trailing_return_pct: number;
  realized_volatility_pct: number;
  max_drawdown_pct: number;
  core_risk_band: string;
};

export type NyraRegimeState = {
  regime: "normal" | "watch" | "unstable";
  risk_compression: number;
  rotation_bias: "neutral" | "defensive";
  high_risk_fallback_bucket: NyraReplayBucket | null;
  reasons: string[];
};

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function deriveNyraRegimeState(
  snapshots: NyraRegimeSnapshot[],
): NyraRegimeState {
  if (!snapshots.length) {
    return {
      regime: "normal",
      risk_compression: 0,
      rotation_bias: "neutral",
      high_risk_fallback_bucket: null,
      reasons: ["empty_snapshot_set"],
    };
  }

  const avgRecentReturn =
    snapshots.reduce((sum, entry) => sum + entry.recent_return_pct, 0) / snapshots.length;
  const avgVolatility =
    snapshots.reduce((sum, entry) => sum + entry.realized_volatility_pct, 0) / snapshots.length;
  const avgDrawdown =
    snapshots.reduce((sum, entry) => sum + entry.max_drawdown_pct, 0) / snapshots.length;
  const negativeRecentCount = snapshots.filter((entry) => entry.recent_return_pct < 0).length;
  const highRiskStressCount = snapshots.filter((entry) =>
    entry.bucket === "high" && (
      entry.recent_return_pct < 0 ||
      entry.max_drawdown_pct > 12 ||
      entry.core_risk_band === "high" ||
      entry.core_risk_band === "blocked"
    )).length;

  const reasons: string[] = [];
  let regime: NyraRegimeState["regime"] = "normal";
  let riskCompression = 0;
  let highRiskFallbackBucket: NyraReplayBucket | null = null;

  if (avgRecentReturn < 1) {
    reasons.push(`avg_recent_return_low:${round(avgRecentReturn)}`);
    riskCompression += 0.18;
  }
  if (avgVolatility > 1.15) {
    reasons.push(`avg_volatility_high:${round(avgVolatility)}`);
    riskCompression += 0.14;
  }
  if (avgDrawdown > 8) {
    reasons.push(`avg_drawdown_high:${round(avgDrawdown)}`);
    riskCompression += 0.18;
  }
  if (negativeRecentCount >= 2) {
    reasons.push(`negative_recent_count:${negativeRecentCount}`);
    riskCompression += 0.2;
  }
  if (highRiskStressCount >= 1) {
    reasons.push(`high_risk_stress:${highRiskStressCount}`);
    riskCompression += 0.22;
  }

  if (riskCompression >= 0.55) regime = "unstable";
  else if (riskCompression >= 0.28) regime = "watch";

  const highRiskCandidates = snapshots.filter((entry) => entry.bucket === "high");
  const highRiskFullyWeak = highRiskCandidates.length > 0 && highRiskCandidates.every((entry) =>
    entry.recent_return_pct < 0 &&
    (entry.max_drawdown_pct > 12 || entry.core_risk_band === "high" || entry.core_risk_band === "blocked")
  );

  if (regime === "unstable" && highRiskFullyWeak) {
    highRiskFallbackBucket = "low";
    reasons.push("high_risk_bucket_rotated_to_low");
  }

  return {
    regime,
    risk_compression: round(Math.min(0.7, riskCompression)),
    rotation_bias: regime === "normal" ? "neutral" : "defensive",
    high_risk_fallback_bucket: highRiskFallbackBucket,
    reasons: reasons.length ? reasons : ["regime_normal"],
  };
}

export function rebalanceNyraBucketWeights(
  baseWeights: Record<NyraReplayBucket, number>,
  regime: NyraRegimeState,
): Record<NyraReplayBucket, number> {
  if (regime.regime === "normal") return { ...baseWeights };
  if (regime.regime === "watch") {
    return {
      low: 0.45,
      medium: 0.4,
      high: 0.15,
    };
  }
  return {
    low: 0.5,
    medium: 0.4,
    high: 0.1,
  };
}

export function applyNyraRegimeScoreAdjustment(
  snapshot: NyraRegimeSnapshot & { score: number },
  regime: NyraRegimeState,
): number {
  let adjusted = snapshot.score;

  if (regime.regime !== "normal" && snapshot.bucket === "high") {
    adjusted -= 6;
    if (snapshot.recent_return_pct < 0) adjusted -= 8;
    if (snapshot.max_drawdown_pct > 12) adjusted -= 4;
    if (snapshot.core_risk_band === "high" || snapshot.core_risk_band === "blocked") adjusted -= 5;
  }

  if (regime.regime !== "normal" && snapshot.bucket === "low") {
    adjusted += 3;
    if (snapshot.recent_return_pct >= 0) adjusted += 2;
  }

  if (regime.regime === "unstable" && snapshot.bucket === "medium" && snapshot.recent_return_pct >= 0) {
    adjusted += 3.5;
  }

  return round(adjusted);
}

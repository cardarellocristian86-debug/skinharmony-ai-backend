import type { GoldDecisionEngineOutput, GoldPialSnapshot, GoldShadowComparableOutput } from "./index.ts";
import { runGoldShadowMode } from "./index.ts";

export type MismatchCategory =
  | "adapter issue"
  | "contract information loss"
  | "universal core limitation"
  | "gold domain-specific exception"
  | "acceptable divergence";

export type ShadowMismatch = {
  case_id: string;
  field: string;
  gold_value: unknown;
  universal_value: unknown;
  category: MismatchCategory;
  reason: string;
};

export type GoldShadowCaseResult = {
  case_id: string;
  gold: GoldDecisionEngineOutput;
  universal: GoldShadowComparableOutput;
  matches: {
    state: boolean;
    primary_action: boolean;
    risk_band: boolean;
    control_level: boolean;
    blocked_reasons: boolean;
  };
  confidence_distance: number;
  action_overlap_score: number;
  weighted_action_overlap_score: number;
  mismatches: ShadowMismatch[];
};

export type GoldShadowReport = {
  total_cases: number;
  metrics: {
    state_agreement_rate: number;
    primary_action_agreement_rate: number;
    confidence_distance_avg: number;
    risk_band_agreement_rate: number;
    control_level_agreement_rate: number;
    action_overlap_score: number;
    weighted_action_overlap_score: number;
    blocked_reason_agreement_rate: number;
    normalized_confidence_alignment: number;
    gold_shadow_alignment_score: number;
  };
  readiness: "pronto" | "quasi pronto" | "parzialmente pronto" | "non pronto";
  results: GoldShadowCaseResult[];
  mismatch_summary: Record<MismatchCategory, number>;
};

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function setOverlap(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 && b.size === 0) return 100;

  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return rounded((intersection / union) * 100);
}

function weightedOverlap(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 100;
  const leftWeights = new Map(left.map((item, index) => [item, 1 / (index + 1)]));
  const rightWeights = new Map(right.map((item, index) => [item, 1 / (index + 1)]));
  const keys = new Set([...leftWeights.keys(), ...rightWeights.keys()]);
  let intersection = 0;
  let union = 0;

  for (const key of keys) {
    const leftWeight = leftWeights.get(key) ?? 0;
    const rightWeight = rightWeights.get(key) ?? 0;
    intersection += Math.min(leftWeight, rightWeight);
    union += Math.max(leftWeight, rightWeight);
  }

  return union ? rounded((intersection / union) * 100) : 100;
}

function sameSet(left: string[], right: string[]): boolean {
  return setOverlap(left, right) === 100;
}

function classifyMismatch(
  field: string,
  gold: GoldDecisionEngineOutput,
  universal: GoldShadowComparableOutput,
): { category: MismatchCategory; reason: string } {
  if (field === "control_level" && universal.control_level === "suggest" && gold.control_level === "confirm") {
    return {
      category: "acceptable divergence",
      reason: "Il Core universale resta piu conservativo in shadow mode per safety_mode.",
    };
  }

  if (field === "risk_band" && gold.risk_band === "high" && universal.risk_band === "medium") {
    return {
      category: "universal core limitation",
      reason: "Il Core universale non conosce ancora il peso economico specifico di Gold.",
    };
  }

  if (field === "primary_action" && gold.primary_action_id === "gold:data_quality") {
    return {
      category: "gold domain-specific exception",
      reason: "Gold forza la qualita dati quando ci sono blocchi, anche se altri segnali hanno priorita numerica.",
    };
  }

  if (field === "blocked_reasons" && gold.blocked_reasons.length > 0 && universal.blocked_reasons.length === 0) {
    return {
      category: "contract information loss",
      reason: "Le condizioni bloccanti sono arrivate come constraint, ma il Core V0 non le riporta ancora tutte nei blocked_reasons.",
    };
  }

  return {
    category: "adapter issue",
    reason: "Il mapping Gold -> UniversalSignal richiede calibrazione.",
  };
}

function evaluateCase(snapshot: GoldPialSnapshot): GoldShadowCaseResult {
  const shadow = runGoldShadowMode(snapshot);
  const gold = shadow.gold_reference;
  const universal = shadow.universal_comparable;
  const goldTopActions = gold.top_actions.map((action) => action.id);
  const confidenceDistance = Math.abs(gold.confidence - universal.confidence);
  const actionOverlapScore =
    gold.primary_action_id === "gold:observe" && universal.primary_action_id === "gold:observe"
      ? 100
      : setOverlap(goldTopActions, universal.top_action_ids);
  const weightedActionOverlapScore =
    gold.primary_action_id === "gold:observe" && universal.primary_action_id === "gold:observe"
      ? 100
      : weightedOverlap(goldTopActions, universal.top_action_ids);

  const matches = {
    state: gold.state === universal.state,
    primary_action: gold.primary_action_id === universal.primary_action_id,
    risk_band: gold.risk_band === universal.risk_band,
    control_level: gold.control_level === universal.control_level,
    blocked_reasons: sameSet(gold.blocked_reasons, universal.blocked_reasons),
  };

  const mismatches: ShadowMismatch[] = [];
  const fields: Array<keyof typeof matches> = ["state", "primary_action", "risk_band", "control_level", "blocked_reasons"];
  for (const field of fields) {
    if (matches[field]) continue;

    const classification = classifyMismatch(field, gold, universal);
    mismatches.push({
      case_id: snapshot.request_id,
      field,
      gold_value:
        field === "primary_action"
          ? gold.primary_action_id
          : field === "blocked_reasons"
            ? gold.blocked_reasons
            : gold[field],
      universal_value:
        field === "primary_action"
          ? universal.primary_action_id
          : field === "blocked_reasons"
            ? universal.blocked_reasons
            : universal[field],
      category: classification.category,
      reason: classification.reason,
    });
  }

  return {
    case_id: snapshot.request_id,
    gold,
    universal,
    matches,
    confidence_distance: rounded(confidenceDistance),
    action_overlap_score: actionOverlapScore,
    weighted_action_overlap_score: weightedActionOverlapScore,
    mismatches,
  };
}

function agreementRate(results: GoldShadowCaseResult[], field: keyof GoldShadowCaseResult["matches"]): number {
  if (!results.length) return 0;
  return rounded((results.filter((result) => result.matches[field]).length / results.length) * 100);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function alignmentScore(metrics: GoldShadowReport["metrics"]): number {
  return rounded(
    0.22 * (metrics.state_agreement_rate / 100) +
      0.22 * (metrics.primary_action_agreement_rate / 100) +
      0.16 * (metrics.risk_band_agreement_rate / 100) +
      0.16 * (metrics.control_level_agreement_rate / 100) +
      0.10 * (metrics.blocked_reason_agreement_rate / 100) +
      0.08 * (metrics.weighted_action_overlap_score / 100) +
      0.06 * metrics.normalized_confidence_alignment,
  );
}

function readinessFromMetrics(report: Omit<GoldShadowReport, "readiness">): GoldShadowReport["readiness"] {
  const { metrics } = report;
  if (metrics.gold_shadow_alignment_score >= 0.90) {
    return "pronto";
  }

  if (metrics.gold_shadow_alignment_score >= 0.75) {
    return "quasi pronto";
  }

  if (metrics.gold_shadow_alignment_score >= 0.55) {
    return "parzialmente pronto";
  }

  return "non pronto";
}

export function runGoldShadowComparison(cases: GoldPialSnapshot[]): GoldShadowReport {
  const results = cases.map(evaluateCase);
  const mismatches = results.flatMap((result) => result.mismatches);
  const mismatchSummary = mismatches.reduce<Record<MismatchCategory, number>>(
    (summary, mismatch) => {
      summary[mismatch.category] += 1;
      return summary;
    },
    {
      "adapter issue": 0,
      "contract information loss": 0,
      "universal core limitation": 0,
      "gold domain-specific exception": 0,
      "acceptable divergence": 0,
    },
  );

  const partial: Omit<GoldShadowReport, "readiness"> = {
    total_cases: cases.length,
    metrics: {
      state_agreement_rate: agreementRate(results, "state"),
      primary_action_agreement_rate: agreementRate(results, "primary_action"),
      confidence_distance_avg: rounded(average(results.map((result) => result.confidence_distance))),
      risk_band_agreement_rate: agreementRate(results, "risk_band"),
      control_level_agreement_rate: agreementRate(results, "control_level"),
      action_overlap_score: rounded(average(results.map((result) => result.action_overlap_score))),
      weighted_action_overlap_score: rounded(average(results.map((result) => result.weighted_action_overlap_score))),
      blocked_reason_agreement_rate: agreementRate(results, "blocked_reasons"),
      normalized_confidence_alignment: rounded(Math.max(0, 1 - rounded(average(results.map((result) => result.confidence_distance))) / 100)),
      gold_shadow_alignment_score: 0,
    },
    results,
    mismatch_summary: mismatchSummary,
  };
  partial.metrics.gold_shadow_alignment_score = alignmentScore(partial.metrics);

  return {
    ...partial,
    readiness: readinessFromMetrics(partial),
  };
}

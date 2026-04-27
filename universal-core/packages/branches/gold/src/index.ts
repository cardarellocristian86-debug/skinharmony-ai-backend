import { runUniversalCore } from "../../../core/src/index.ts";
import type {
  ControlLevel,
  UniversalAction,
  UniversalCoreInput,
  UniversalCoreOutput,
  UniversalSignal,
  UniversalState,
} from "../../../contracts/src/index.ts";

export type GoldState = "ok" | "attention" | "critical" | "protection" | "blocked";

export type GoldOperationalFocus =
  | "data_quality"
  | "recall"
  | "marketing"
  | "margin"
  | "stock"
  | "protocols"
  | "cash"
  | "growth"
  | "operations"
  | "profitability"
  | "none";

export type GoldAction = {
  id: string;
  label: string;
  reason: string;
  priority_score: number;
  blocked?: boolean;
};

export type GoldPialSnapshot = {
  request_id: string;
  tenant_id: string;
  plan: "base" | "silver" | "gold" | "enterprise";
  generated_at?: string;
  quality_data_state: number;
  recall_priority: number;
  marketing_opportunity_count: number;
  margin_alert_state: number;
  blocked_conditions: string[];
  operational_focus: GoldOperationalFocus;
  state_confidence: number;
  state_stability: number;
  readiness_to_act: number;
  cash_anomaly?: number;
  growth_opportunity?: number;
  operational_risk?: number;
  missing_required_fields?: string[];
  stale_data_hours?: number;
  source_consistency?: number;
};

export type GoldDecisionEngineOutput = {
  request_id: string;
  state: GoldState;
  confidence: number;
  risk_band: "low" | "medium" | "high" | "blocked";
  control_level: ControlLevel;
  primary_action_id?: string;
  top_actions: GoldAction[];
  blocked_reasons: string[];
};

export type GoldShadowComparableOutput = {
  request_id: string;
  state: UniversalState;
  confidence: number;
  risk_band: "low" | "medium" | "high" | "blocked";
  control_level: ControlLevel;
  primary_action_id?: string;
  top_action_ids: string[];
  blocked_reasons: string[];
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function stateFromGoldSeverity(snapshot: GoldPialSnapshot): GoldState {
  if (snapshot.blocked_conditions.length > 0 && snapshot.readiness_to_act < 30) return "blocked";

  const severity = Math.max(
    100 - snapshot.quality_data_state,
    snapshot.recall_priority,
    snapshot.margin_alert_state,
    snapshot.marketing_opportunity_count * 6,
  );

  if (severity >= 85) return "protection";
  if (severity >= 65) return "critical";
  if (severity >= 35) return "attention";
  return "ok";
}

function riskBandFromState(state: GoldState): "low" | "medium" | "high" | "blocked" {
  if (state === "blocked") return "blocked";
  if (state === "protection" || state === "critical") return "high";
  if (state === "attention") return "medium";
  return "low";
}

function actionIdForFocus(focus: GoldOperationalFocus): string {
  const map: Record<GoldOperationalFocus, string> = {
    data_quality: "gold:data_quality",
    recall: "gold:recall",
    marketing: "gold:marketing",
    margin: "gold:margin",
    stock: "gold:stock",
    protocols: "gold:protocols",
    cash: "gold:cash",
    growth: "gold:growth",
    operations: "gold:operations",
    profitability: "gold:profitability",
    none: "gold:observe",
  };
  return map[focus];
}

function signal(
  snapshot: GoldPialSnapshot,
  partial: Omit<UniversalSignal, "source" | "confidence_hint" | "reliability_hint" | "trend">,
): UniversalSignal {
  return {
    ...partial,
    source: "gold",
    confidence_hint: snapshot.state_confidence,
    reliability_hint: snapshot.source_consistency ?? snapshot.state_confidence,
    trend: {
      stability_score: snapshot.state_stability,
    },
  };
}

export function mapGoldPialToUniversal(snapshot: GoldPialSnapshot): UniversalCoreInput {
  const dataQualityRisk = clamp(100 - snapshot.quality_data_state);
  const blockedRisk = snapshot.blocked_conditions.length > 0 ? clamp(72 + snapshot.blocked_conditions.length * 10) : 0;
  const freshnessPenalty = snapshot.stale_data_hours ? clamp(snapshot.stale_data_hours * 3, 0, 45) : 0;
  const marketingSeverity = clamp(snapshot.marketing_opportunity_count * 6);
  const marketingValue = clamp(snapshot.marketing_opportunity_count * 8);
  const cashRisk = clamp((snapshot.cash_anomaly ?? 0) * 100);
  const growthRisk = clamp((snapshot.growth_opportunity ?? 0) * 100);
  const operationsRisk = clamp((snapshot.operational_risk ?? 0) * 100);
  const economicOpportunityStrength = clamp(Math.max(snapshot.recall_priority, snapshot.margin_alert_state, marketingSeverity, cashRisk, growthRisk));
  const actionMaturity = Math.min(snapshot.readiness_to_act, snapshot.quality_data_state, snapshot.state_stability);
  const operationalReadinessRisk = clamp(100 - snapshot.readiness_to_act);

  const signals: UniversalSignal[] = [
    signal(snapshot, {
      id: "gold:cash",
      category: "cash_integrity",
      label: "Controllo cassa",
      value: snapshot.cash_anomaly ?? 0,
      normalized_score: cashRisk,
      severity_hint: cashRisk,
      risk_hint: cashRisk >= 65 ? 96 : cashRisk,
      friction_hint: cashRisk >= 65 ? 22 : 28,
      reversibility_hint: cashRisk >= 65 ? 92 : 72,
      expected_value_hint: cashRisk,
      direction: cashRisk >= 45 ? "up" : "stable",
      evidence: [{ label: "anomalia cassa", value: snapshot.cash_anomaly ?? 0, unit: "0-1" }],
      tags: ["gold", "pial", "cash"],
    }),
    signal(snapshot, {
      id: "gold:growth",
      category: "growth_opportunity",
      label: "Opportunita crescita",
      value: snapshot.growth_opportunity ?? 0,
      normalized_score: growthRisk,
      severity_hint: growthRisk,
      risk_hint: growthRisk >= 65 ? 88 : growthRisk,
      friction_hint: growthRisk >= 65 ? 42 : 26,
      reversibility_hint: 74,
      expected_value_hint: growthRisk,
      direction: growthRisk >= 45 ? "up" : "stable",
      evidence: [{ label: "opportunita crescita", value: snapshot.growth_opportunity ?? 0, unit: "0-1" }],
      tags: ["gold", "pial", "growth"],
    }),
    signal(snapshot, {
      id: "gold:operations",
      category: "operational_risk",
      label: "Rischio operativo",
      value: snapshot.operational_risk ?? 0,
      normalized_score: operationsRisk,
      severity_hint: operationsRisk,
      risk_hint: operationsRisk >= 65 ? 84 : operationsRisk,
      friction_hint: operationsRisk >= 65 ? 40 : 24,
      reversibility_hint: 78,
      expected_value_hint: operationsRisk,
      direction: operationsRisk >= 45 ? "up" : "stable",
      evidence: [{ label: "rischio operativo", value: snapshot.operational_risk ?? 0, unit: "0-1" }],
      tags: ["gold", "pial", "operations"],
    }),
    signal(snapshot, {
      id: "gold:data_quality",
      category: "data_quality",
      label: "Qualita dati centro",
      value: snapshot.quality_data_state,
      normalized_score: clamp(dataQualityRisk + freshnessPenalty),
      severity_hint: clamp(dataQualityRisk + freshnessPenalty),
      risk_hint: clamp(dataQualityRisk + freshnessPenalty + (snapshot.blocked_conditions.length ? 20 : 0)),
      friction_hint: 32,
      reversibility_hint: 90,
      expected_value_hint: clamp(dataQualityRisk + freshnessPenalty),
      direction: dataQualityRisk > 35 ? "down" : "stable",
      evidence: [
        { label: "completezza dati", value: snapshot.quality_data_state, unit: "%" },
        { label: "campi mancanti", value: snapshot.missing_required_fields?.length ?? 0 },
      ],
      tags: ["gold", "pial", "data"],
    }),
    signal(snapshot, {
      id: "gold:recall",
      category: "retention",
      label: "Priorita recall clienti",
      value: snapshot.recall_priority,
      normalized_score: snapshot.recall_priority,
      severity_hint: snapshot.recall_priority,
      risk_hint: snapshot.recall_priority >= 65 ? 100 : snapshot.recall_priority,
      friction_hint: snapshot.recall_priority >= 65 ? 70 : 26,
      reversibility_hint: 84,
      expected_value_hint: snapshot.recall_priority,
      direction: snapshot.recall_priority > 45 ? "up" : "stable",
      evidence: [{ label: "priorita recall", value: snapshot.recall_priority, unit: "/100" }],
      tags: ["gold", "pial", "recall"],
    }),
    signal(snapshot, {
      id: "gold:marketing",
      category: "marketing_opportunity",
      label: "Opportunita marketing",
      value: snapshot.marketing_opportunity_count,
      normalized_score: marketingSeverity,
      severity_hint: marketingSeverity,
      risk_hint: marketingSeverity >= 65 ? 76 : marketingSeverity,
      friction_hint: marketingSeverity >= 65 ? 42 : 36,
      reversibility_hint: 72,
      expected_value_hint: marketingValue,
      direction: snapshot.marketing_opportunity_count > 0 ? "up" : "stable",
      evidence: [{ label: "opportunita rilevate", value: snapshot.marketing_opportunity_count }],
      tags: ["gold", "pial", "marketing"],
    }),
    signal(snapshot, {
      id: "gold:margin",
      category: "profitability",
      label: "Alert margine",
      value: snapshot.margin_alert_state,
      normalized_score: snapshot.margin_alert_state,
      severity_hint: snapshot.margin_alert_state,
      risk_hint: snapshot.margin_alert_state >= 65 ? 94 : snapshot.margin_alert_state,
      friction_hint: snapshot.margin_alert_state >= 65 ? 60 : 42,
      reversibility_hint: 66,
      expected_value_hint: snapshot.margin_alert_state,
      direction: snapshot.margin_alert_state > 45 ? "up" : "stable",
      evidence: [{ label: "stato alert margine", value: snapshot.margin_alert_state, unit: "/100" }],
      tags: ["gold", "pial", "margin"],
    }),
    signal(snapshot, {
      id: "gold:blocked_conditions",
      category: "blocked_conditions",
      label: "Condizioni bloccanti",
      value: snapshot.blocked_conditions.length,
      normalized_score: blockedRisk,
      severity_hint: blockedRisk,
      risk_hint: blockedRisk,
      friction_hint: 70,
      reversibility_hint: 58,
      expected_value_hint: blockedRisk,
      direction: snapshot.blocked_conditions.length ? "up" : "stable",
      evidence: snapshot.blocked_conditions.map((condition) => ({ label: condition, value: true })),
      tags: ["gold", "pial", "blocked"],
    }),
    signal(snapshot, {
      id: "gold:readiness",
      category: "execution_readiness",
      label: "Prontezza operativa",
      value: snapshot.readiness_to_act,
      normalized_score: operationalReadinessRisk,
      severity_hint: operationalReadinessRisk,
      risk_hint: snapshot.readiness_to_act < 35 ? 85 : operationalReadinessRisk,
      friction_hint: 48,
      reversibility_hint: 70,
      expected_value_hint: clamp(100 - snapshot.readiness_to_act),
      direction: snapshot.readiness_to_act < 55 ? "down" : "stable",
      evidence: [{ label: "readiness to act", value: snapshot.readiness_to_act, unit: "%" }],
      tags: ["gold", "pial", "readiness"],
    }),
    signal(snapshot, {
      id: "gold:economic_strength",
      category: "economic_opportunity_strength",
      label: "Forza economica opportunita",
      value: economicOpportunityStrength,
      normalized_score: economicOpportunityStrength >= 65 ? economicOpportunityStrength : 0,
      severity_hint: economicOpportunityStrength >= 65 ? economicOpportunityStrength : 0,
      risk_hint: economicOpportunityStrength >= 65 ? 88 : economicOpportunityStrength,
      friction_hint: economicOpportunityStrength >= 65 ? 46 : 18,
      reversibility_hint: 72,
      expected_value_hint: economicOpportunityStrength,
      direction: economicOpportunityStrength >= 65 ? "up" : "stable",
      evidence: [{ label: "opportunita economica massima", value: economicOpportunityStrength, unit: "/100" }],
      tags: ["gold", "pial", "economic", "system"],
    }),
    signal(snapshot, {
      id: "gold:action_maturity",
      category: "action_maturity",
      label: "Maturita azione",
      value: actionMaturity,
      normalized_score: clamp(100 - actionMaturity),
      severity_hint: clamp(100 - actionMaturity),
      risk_hint: actionMaturity < 35 ? 80 : clamp(100 - actionMaturity),
      friction_hint: actionMaturity < 55 ? 46 : 20,
      reversibility_hint: 82,
      expected_value_hint: clamp(100 - actionMaturity),
      direction: actionMaturity < 55 ? "down" : "stable",
      evidence: [{ label: "maturita operativa", value: actionMaturity, unit: "%" }],
      tags: ["gold", "pial", "maturity", "system"],
    }),
  ];

  return {
    request_id: snapshot.request_id,
    generated_at: snapshot.generated_at ?? new Date().toISOString(),
    domain: "gold",
    context: {
      tenant_id: snapshot.tenant_id,
      plan: snapshot.plan,
      mode: "shadow",
      metadata: {
        operational_focus: snapshot.operational_focus,
        source: "gold_pial_shadow_adapter_v1",
        economic_opportunity_strength: economicOpportunityStrength,
        action_maturity: actionMaturity,
      },
    },
    signals,
    data_quality: {
      score: snapshot.quality_data_state,
      completeness: snapshot.quality_data_state,
      freshness: clamp(100 - freshnessPenalty),
      consistency: snapshot.source_consistency ?? snapshot.state_confidence,
      reliability: snapshot.source_consistency ?? snapshot.state_confidence,
      missing_fields: snapshot.missing_required_fields ?? [],
    },
    constraints: {
      allow_automation: false,
      require_confirmation: snapshot.readiness_to_act >= 70 || snapshot.blocked_conditions.length > 0,
      max_control_level: "confirm",
      blocked_actions: snapshot.blocked_conditions.map((condition) => `gold:block:${condition}`),
      blocked_action_rules: snapshot.blocked_conditions.map((condition) => ({
        scope: "gold.operational_action",
        reason_code: condition,
        severity: 92,
        blocks_execution: true,
      })),
      safety_mode: false,
    },
  };
}

export function runGoldDecisionEngineReference(snapshot: GoldPialSnapshot): GoldDecisionEngineOutput {
  const state = stateFromGoldSeverity(snapshot);
  const primaryFocus = snapshot.blocked_conditions.length > 0 ? "data_quality" : snapshot.operational_focus;
  const primaryActionId = actionIdForFocus(primaryFocus);
  const blockedReasons = snapshot.blocked_conditions;
  const cashRisk = clamp((snapshot.cash_anomaly ?? 0) * 100);
  const growthRisk = clamp((snapshot.growth_opportunity ?? 0) * 100);
  const operationsRisk = clamp((snapshot.operational_risk ?? 0) * 100);

  const actionCandidates: GoldAction[] = [
    {
      id: "gold:cash",
      label: "Verifica pagamenti non collegati",
      reason: "Cassa, incassi o pagamenti richiedono controllo.",
      priority_score: cashRisk,
    },
    {
      id: "gold:growth",
      label: "Valuta opportunita operative",
      reason: "Sono presenti segnali di crescita o continuita da usare.",
      priority_score: growthRisk,
    },
    {
      id: "gold:operations",
      label: "Controlla rischio operativo",
      reason: "Rischio operativo sopra soglia.",
      priority_score: operationsRisk,
    },
    {
      id: "gold:data_quality",
      label: "Completa dati mancanti",
      reason: "Gold non deve suggerire azioni forti con dati fragili.",
      priority_score: clamp(100 - snapshot.quality_data_state + (snapshot.missing_required_fields?.length ?? 0) * 8),
      blocked: snapshot.blocked_conditions.length > 0,
    },
    {
      id: "gold:recall",
      label: "Attiva priorita recall",
      reason: "Clienti da recuperare o continuita cliente fragile.",
      priority_score: snapshot.recall_priority,
    },
    {
      id: "gold:marketing",
      label: "Valuta opportunita marketing",
      reason: "Segmenti o messaggi con opportunita da ordinare.",
      priority_score: clamp(snapshot.marketing_opportunity_count * 8),
    },
    {
      id: "gold:margin",
      label: "Controlla marginalita",
      reason: "Servizi, costi o prezzi richiedono lettura manageriale.",
      priority_score: snapshot.margin_alert_state,
    },
    {
      id: "gold:observe",
      label: "Mantieni monitoraggio",
      reason: "Nessun intervento operativo urgente.",
      priority_score: 10,
    },
  ].sort((a, b) => b.priority_score - a.priority_score);

  const topActions = actionCandidates
    .filter((action) => action.priority_score > 0)
    .sort((a, b) => (a.id === primaryActionId ? -1 : b.id === primaryActionId ? 1 : b.priority_score - a.priority_score))
    .slice(0, 5);

  const controlLevel: ControlLevel =
    state === "blocked" ? "blocked" : primaryActionId === "gold:observe" && state === "ok" ? "observe" : snapshot.readiness_to_act >= 70 ? "confirm" : "suggest";

  return {
    request_id: snapshot.request_id,
    state,
    confidence: snapshot.state_confidence,
    risk_band: riskBandFromState(state),
    control_level: controlLevel,
    primary_action_id: primaryActionId,
    top_actions: topActions,
    blocked_reasons: blockedReasons,
  };
}

function normalizeUniversalActionId(actionId?: string): string | undefined {
  return actionId?.replace(/^action:/, "");
}

export function toGoldShadowComparable(output: UniversalCoreOutput): GoldShadowComparableOutput {
  return {
    request_id: output.request_id,
    state: output.state === "observe" ? "ok" : output.state,
    confidence: output.confidence,
    risk_band: output.risk.band,
    control_level: output.control_level,
    primary_action_id: normalizeUniversalActionId(output.priority.primary_action_id),
    top_action_ids: output.recommended_actions.map((action: UniversalAction) => action.id.replace(/^action:/, "")),
    blocked_reasons: output.blocked_reasons.filter((reason) => reason !== "safety_mode" && reason !== "risk_too_high"),
  };
}

export function runGoldShadowMode(snapshot: GoldPialSnapshot): {
  universal_input: UniversalCoreInput;
  universal_output: UniversalCoreOutput;
  universal_comparable: GoldShadowComparableOutput;
  gold_reference: GoldDecisionEngineOutput;
} {
  const universalInput = mapGoldPialToUniversal(snapshot);
  const universalOutput = runUniversalCore(universalInput);

  return {
    universal_input: universalInput,
    universal_output: universalOutput,
    universal_comparable: toGoldShadowComparable(universalOutput),
    gold_reference: runGoldDecisionEngineReference(snapshot),
  };
}

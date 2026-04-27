import type { ControlLevel } from "../../../contracts/src/index.ts";
import type { GoldDecisionEngineOutput, GoldOperationalFocus, GoldPialSnapshot } from "./index.ts";

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function asPercent(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return clamp(numeric <= 1 ? numeric * 100 : numeric);
}

function focusFromDomain(domain: unknown): GoldOperationalFocus {
  const value = String(domain || "none").toLowerCase();
  if (["cash", "growth", "operations", "profitability", "marketing"].includes(value)) {
    return value === "profitability" ? "margin" : (value as GoldOperationalFocus);
  }
  return "none";
}

function actionIdFromDomain(domain: unknown, action: unknown, score: unknown): string {
  const scoreValue = Number(score) || 0;
  if (String(action || "").toUpperCase() === "MONITOR" && scoreValue < 0.25) return "gold:observe";
  const focus = focusFromDomain(domain);
  return focus === "none" ? "gold:observe" : `gold:${focus}`;
}

function stateFromDecision(decision: any): GoldDecisionEngineOutput["state"] {
  const action = String(decision?.action || "").toUpperCase();
  const score = Number(decision?.score) || 0;
  if (decision?.blockedActions?.length) return "blocked";
  if (action === "ACT_NOW") return score >= 0.85 ? "protection" : "critical";
  if (action === "STOP") return "ok";
  if (score >= 0.65) return "critical";
  if (score >= 0.35) return "attention";
  return "ok";
}

function riskBandFromDecision(decision: any): GoldDecisionEngineOutput["risk_band"] {
  const action = String(decision?.action || "").toUpperCase();
  const score = Number(decision?.score) || 0;
  const band = String(decision?.band || "").toLowerCase();
  if (decision?.blockedActions?.length) return "blocked";
  if (action === "ACT_NOW" || score >= 0.75) return "high";
  if (band === "media" || band === "medium" || score >= 0.35) return "medium";
  return "low";
}

function controlLevelFromDecision(decision: any): ControlLevel {
  const action = String(decision?.action || "").toUpperCase();
  const score = Number(decision?.score) || 0;
  if (decision?.blockedActions?.length) return "blocked";
  if (action === "ACT_NOW" || score >= 0.70) return "confirm";
  if (action === "MONITOR" && score < 0.25) return "observe";
  return "suggest";
}

function extractState(record: any): any | null {
  if (record?.state?.decision) return record.state;
  if (record?.decision) return record;
  return null;
}

export function mapRealGoldStateToPial(record: any, sourceId: string): GoldPialSnapshot | null {
  const state = extractState(record);
  if (!state?.decision) return null;

  const business = state.snapshots?.business ?? {};
  const profitability = state.snapshots?.profitability ?? {};
  const signals = state.signals ?? {};
  const decision = state.decision ?? {};
  const counters = state.counters ?? {};
  const decisionScore = Number(decision.score) || 0;
  const emptyBootstrapMonitor =
    decisionScore === 0 &&
    Number(counters.clientsTotal || 0) === 0 &&
    Number(counters.revenueTotalCents || 0) === 0 &&
    String(decision.action || "").toUpperCase() === "MONITOR";
  const blockedConditions = Array.isArray(decision.blockedActions)
    ? decision.blockedActions.map((item: any) => String(item.reason || item.domain || item.action || item))
    : [];

  return {
    request_id: `gold-real:${sourceId}`,
    tenant_id: String(record?.tenant?.centerId || state.centerId || record?.centerId || "unknown"),
    plan: "gold",
    generated_at: record?.generatedAt || state.updatedAt || decision.updatedAt || new Date().toISOString(),
    quality_data_state: emptyBootstrapMonitor ? 88 : asPercent(business.dataQuality ?? state.components?.DQ, 0),
    recall_priority: 0,
    marketing_opportunity_count: Math.round(asPercent(signals.opportunity, 0) / 12),
    margin_alert_state: asPercent(signals.marginAnomaly ?? (1 - (profitability.averageMargin ?? 1)), 0),
    blocked_conditions: blockedConditions,
    operational_focus: blockedConditions.length ? "data_quality" : focusFromDomain(decision.domain ?? decision.primaryAction?.domain),
    state_confidence: emptyBootstrapMonitor ? 86 : asPercent(business.confidence ?? signals.dataReliability, 65),
    state_stability: asPercent(state.decisionParallel?.agreementScore ?? state.dataQualityParallel?.agreementScore ?? 0.8, 80),
    readiness_to_act: emptyBootstrapMonitor ? 82 : clamp(
      asPercent(business.dataQuality ?? state.components?.DQ, 0) * 0.45 +
        asPercent(business.confidence ?? signals.dataReliability, 65) * 0.35 +
        (blockedConditions.length ? 0 : 100) * 0.20,
    ),
    cash_anomaly: Number(signals.cashAnomaly ?? 0),
    growth_opportunity: Number(signals.opportunity ?? 0),
    operational_risk: Number(signals.operationalRisk ?? 0),
    missing_required_fields: blockedConditions,
    source_consistency: emptyBootstrapMonitor ? 86 : asPercent(signals.dataReliability ?? business.confidence, 65),
  };
}

export function mapRealGoldStateToReference(record: any, sourceId: string): GoldDecisionEngineOutput | null {
  const state = extractState(record);
  if (!state?.decision) return null;
  const decision = state.decision;
  const primaryActionId = actionIdFromDomain(decision.domain ?? decision.primaryAction?.domain, decision.action, decision.score);
  const secondaryActions = Array.isArray(decision.secondaryActions) ? decision.secondaryActions : [];
  const blockedReasons = Array.isArray(decision.blockedActions)
    ? decision.blockedActions.map((item: any) => String(item.reason || item.domain || item.action || item))
    : [];

  return {
    request_id: `gold-real:${sourceId}`,
    state: stateFromDecision(decision),
    confidence: asPercent(state.snapshots?.business?.confidence ?? state.signals?.dataReliability, 65),
    risk_band: riskBandFromDecision(decision),
    control_level: controlLevelFromDecision(decision),
    primary_action_id: primaryActionId,
    top_actions: [
      {
        id: primaryActionId,
        label: decision.primaryAction?.label || decision.explanationShort || "Azione primaria Gold",
        reason: decision.explanationShort || "Decisione Gold reale",
        priority_score: asPercent(decision.score, 0),
      },
      ...secondaryActions.map((action: any) => ({
        id: actionIdFromDomain(action.domain, action.action, action.score),
        label: action.label || `Azione ${action.domain}`,
        reason: "Azione secondaria Gold reale",
        priority_score: asPercent(action.score, 0),
      })),
    ].slice(0, 5),
    blocked_reasons: blockedReasons,
  };
}

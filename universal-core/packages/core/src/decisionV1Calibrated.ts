import type {
  ControlLevel,
  UniversalCoreInput,
  UniversalCoreOutput,
  UniversalState,
} from "../../contracts/src/index.ts";

type RiskBand = "low" | "medium" | "high" | "blocked";

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function hasSignal(input: UniversalCoreInput, signalId: string, minValue = 0): boolean {
  return input.signals.some((signal) => signal.id === signalId && signal.normalized_score >= minValue);
}

function maxSignal(input: UniversalCoreInput, prefix?: string): number {
  const filtered = prefix ? input.signals.filter((signal) => signal.id.startsWith(prefix)) : input.signals;
  return filtered.length
    ? Math.max(...filtered.map((signal) => signal.severity_hint ?? signal.normalized_score))
    : 0;
}

function metadataString(input: UniversalCoreInput, key: string): string {
  const value = input.context.metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function blockedRuleCount(input: UniversalCoreInput): number {
  return input.constraints.blocked_action_rules?.filter((rule) => rule.blocks_execution).length ?? 0;
}

function buildOutput(params: {
  input: UniversalCoreInput;
  state: UniversalState;
  severity: number;
  confidence: number;
  riskScore: number;
  riskBand: RiskBand;
  controlLevel: ControlLevel;
  canExecute: boolean;
  requiresUserConfirmation: boolean;
  blockedReasons?: string[];
  notes?: string[];
}): UniversalCoreOutput {
  const {
    input,
    state,
    severity,
    confidence,
    riskScore,
    riskBand,
    controlLevel,
    canExecute,
    requiresUserConfirmation,
    blockedReasons = [],
    notes = [],
  } = params;

  return {
    request_id: input.request_id,
    generated_at: new Date().toISOString(),
    domain: input.domain,
    state,
    severity: clamp(severity),
    confidence: clamp(confidence),
    risk: {
      score: clamp(riskScore),
      band: riskBand,
      reasons: blockedReasons,
    },
    control_level: controlLevel,
    priority: {
      primary_signal_id: input.signals[0]?.id,
      primary_action_id: input.signals[0] ? `action:${input.signals[0].id}` : undefined,
      score: clamp(severity),
      ranking_method: "decision_contract_v1_calibrated",
    },
    recommended_actions: [],
    execution_profile: {
      mode:
        controlLevel === "blocked"
          ? "blocked"
          : controlLevel === "confirm"
            ? "confirm_required"
            : controlLevel === "suggest"
              ? "safe_suggest"
              : canExecute
                ? "semi_automatic"
                : "read_only",
      can_execute: canExecute,
      requires_user_confirmation: requiresUserConfirmation,
      explanation: `State ${state}, control ${controlLevel}, risk ${clamp(riskScore).toFixed(3)}`,
    },
    blocked_reasons: blockedReasons,
    diagnostics: {
      contract_version: "decision_contract_v1_calibrated",
      core_version: "universal_core_v1_calibrated",
      signal_count: input.signals.length,
      blocked_signal_count: input.signals.filter((signal) => signal.tags?.includes("blocked")).length,
      blocked_action_count: blockedRuleCount(input),
      notes,
    },
  };
}

export function runUniversalCoreDecisionV1Calibrated(input: UniversalCoreInput): UniversalCoreOutput {
  const severity = clamp(
    Math.max(0, ...input.signals.map((signal) => signal.severity_hint ?? signal.normalized_score)),
  );

  const dataQuality = clamp(input.data_quality.score);
  const confidenceHints = input.signals.map((signal) => signal.confidence_hint ?? dataQuality);
  const confidence = confidenceHints.length
    ? clamp(confidenceHints.reduce((sum, value) => sum + value, 0) / confidenceHints.length)
    : dataQuality;

  const riskScore = clamp(severity * 0.35 + (100 - confidence) * 0.15);
  const actionType = metadataString(input, "action_type");

  const destructive =
    (actionType === "delete" || actionType === "git_reset_hard") &&
    severity >= 95;
  const crossTenant =
    actionType === "cross_tenant" ||
    severity === 100 ||
    hasSignal(input, "tenant:cross_scope", 100);

  if (destructive || crossTenant) {
    return buildOutput({
      input,
      state: "blocked",
      severity,
      confidence,
      riskScore: 99,
      riskBand: "blocked",
      controlLevel: "blocked",
      canExecute: false,
      requiresUserConfirmation: false,
      blockedReasons: destructive ? ["destructive_hard_gate"] : ["cross_tenant_hard_gate"],
      notes: ["override_hard_gating"],
    });
  }

  const slaBreach = hasSignal(input, "sla:overdue", 1) || actionType === "sla_breach";
  const hasClaimRisk = maxSignal(input, "claim:") >= 90;
  const hasPriceRisk = maxSignal(input, "price:") >= 90;

  if (!hasClaimRisk && !hasPriceRisk && riskScore <= 20 && severity < 30) {
    return buildOutput({
      input,
      state: "ok",
      severity,
      confidence,
      riskScore,
      riskBand: "low",
      controlLevel: "execute_allowed",
      canExecute: true,
      requiresUserConfirmation: false,
      notes: ["override_green_light"],
    });
  }

  if (slaBreach) {
    return buildOutput({
      input,
      state: "critical",
      severity,
      confidence,
      riskScore,
      riskBand: riskScore >= 40 ? "high" : "medium",
      controlLevel: "suggest",
      canExecute: false,
      requiresUserConfirmation: false,
      blockedReasons: ["sla_breach"],
      notes: ["intermediate_critical"],
    });
  }

  if (hasClaimRisk || hasPriceRisk || riskScore >= 40 || blockedRuleCount(input) > 0) {
    return buildOutput({
      input,
      state: "protection",
      severity,
      confidence,
      riskScore,
      riskBand: riskScore >= 65 ? "high" : "medium",
      controlLevel: "confirm",
      canExecute: false,
      requiresUserConfirmation: true,
      blockedReasons: hasClaimRisk ? ["claim_risk"] : hasPriceRisk ? ["price_risk"] : ["risk_threshold"],
      notes: ["intermediate_protection"],
    });
  }

  return buildOutput({
    input,
    state: "attention",
    severity,
    confidence,
    riskScore,
    riskBand: riskScore >= 35 ? "medium" : "low",
    controlLevel: "observe",
    canExecute: false,
    requiresUserConfirmation: false,
    blockedReasons: input.constraints.safety_mode ? ["safety_mode"] : [],
    notes: ["default_attention_fallback"],
  });
}

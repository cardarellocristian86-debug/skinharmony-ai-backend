import type {
  ControlLevel,
  ExecutionProfile,
  UniversalAction,
  UniversalCoreInput,
  UniversalCoreOutput,
  UniversalSignal,
  UniversalState,
} from "../../contracts/src/index.ts";

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stateFromSeverity(severity: number): UniversalState {
  if (severity >= 85) return "protection";
  if (severity >= 65) return "critical";
  if (severity >= 35) return "attention";
  return "ok";
}

function shouldObserve(input: UniversalCoreInput, severity: number, riskScore: number, confidence: number): boolean {
  if (input.constraints.blocked_actions?.length || input.constraints.blocked_action_rules?.length) return false;
  if (confidence < 45) return false;

  const strongestActionableSignal = Math.max(
    0,
    ...input.signals
      .filter((signal) => !signal.tags?.includes("system"))
      .map((signal) => signal.severity_hint ?? signal.normalized_score),
  );

  return severity < 35 && riskScore < 35 && strongestActionableSignal < 35;
}

function riskBand(score: number): "low" | "medium" | "high" | "blocked" {
  if (score >= 85) return "blocked";
  if (score >= 65) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function metadataValue(input: UniversalCoreInput, key: string): string | undefined {
  const value = input.context.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function deriveSemanticControlProfile(input: UniversalCoreInput): {
  semanticIntent?: string;
  semanticMode?: string;
  lowExecutionRisk: boolean;
  advisoryOnly: boolean;
} {
  const explicitIntent = metadataValue(input, "semantic_intent");
  const helpMode = metadataValue(input, "semantic_help_mode");
  const basicNeedMode = metadataValue(input, "semantic_basic_need_mode");
  const economicMode = metadataValue(input, "semantic_economic_mode");
  const relationalMode = metadataValue(input, "semantic_relational_mode");

  const semanticIntent = explicitIntent
    ?? (helpMode
      ? "open_help"
      : basicNeedMode
        ? "basic_need"
        : economicMode
          ? "economic_danger"
          : relationalMode
            ? "relational_simple"
            : undefined);

  const semanticMode =
    metadataValue(input, "semantic_mode") ??
    helpMode ??
    basicNeedMode ??
    economicMode ??
    relationalMode;

  const advisoryOnly =
    semanticIntent === "open_help" ||
    semanticIntent === "relational_simple" ||
    (semanticIntent === "basic_need" && semanticMode !== "pain_need");

  const lowExecutionRisk =
    advisoryOnly ||
    (semanticIntent === "economic_danger" &&
      semanticMode !== "cost_coverage_pressure" &&
      semanticMode !== "resource_exhaustion");

  return {
    semanticIntent,
    semanticMode,
    lowExecutionRisk,
    advisoryOnly,
  };
}

function hasSemanticTag(signal: UniversalSignal): boolean {
  return Boolean(signal.tags?.includes("semantic"));
}

function isGenericContinuitySignal(signal: UniversalSignal): boolean {
  return signal.id === "ultra:continuity" || signal.id === "ultra:goal" || signal.id === "ultra:urgency";
}

function semanticSpecificityBonus(signal: UniversalSignal): number {
  if (!hasSemanticTag(signal)) return 0;
  if (signal.tags?.includes("economic")) return 9;
  if (signal.tags?.includes("basic_need")) return 8;
  if (signal.tags?.includes("relational")) return 7;
  return 5;
}

function genericSemanticCompetitionPenalty(signal: UniversalSignal, hasSpecificSemanticSignal: boolean): number {
  if (!hasSpecificSemanticSignal) return 0;
  if (!isGenericContinuitySignal(signal)) return 0;
  return 12;
}

function rankSignal(
  signal: UniversalSignal,
  dataQualityScore: number,
  context: { hasSpecificSemanticSignal: boolean },
): number {
  const severity = signal.severity_hint ?? signal.normalized_score;
  const confidence = signal.confidence_hint ?? dataQualityScore;
  const value = signal.expected_value_hint ?? signal.normalized_score;
  const friction = signal.friction_hint ?? 20;
  const reversibility = signal.reversibility_hint ?? 70;
  const urgency = signal.trend?.consecutive_count ? Math.min(100, 35 + signal.trend.consecutive_count * 12) : severity;
  const riskAdjustedValue = value * (1 - friction / 100);
  const specificityBonus = semanticSpecificityBonus(signal);
  const genericPenalty = genericSemanticCompetitionPenalty(signal, context.hasSpecificSemanticSignal);

  return clamp(
    severity * 0.28 +
      confidence * 0.22 +
      riskAdjustedValue * 0.24 +
      urgency * 0.16 +
      reversibility * 0.10 +
      specificityBonus -
      genericPenalty,
  );
}

function isBlockedAction(actionId: string, input: UniversalCoreInput): { blocked: boolean; reasonCodes: string[] } {
  const normalizedActionId = actionId.replace(/^action:/, "");
  const directBlocked = input.constraints.blocked_actions?.includes(normalizedActionId) || input.constraints.blocked_actions?.includes(actionId);
  const ruleReasons =
    input.constraints.blocked_action_rules
      ?.filter((rule) => {
        if (!rule.blocks_execution) return false;
        if (!rule.action_id) return true;
        return rule.action_id === normalizedActionId || rule.action_id === actionId;
      })
      .map((rule) => rule.reason_code) ?? [];

  return {
    blocked: Boolean(directBlocked || ruleReasons.length),
    reasonCodes: [...new Set([...(directBlocked ? [normalizedActionId] : []), ...ruleReasons])],
  };
}

function executionProfile(controlLevel: ControlLevel, reason: string): ExecutionProfile {
  if (controlLevel === "blocked") {
    return {
      mode: "blocked",
      can_execute: false,
      requires_user_confirmation: true,
      explanation: reason,
    };
  }

  if (controlLevel === "confirm") {
    return {
      mode: "confirm_required",
      can_execute: false,
      requires_user_confirmation: true,
      explanation: reason,
    };
  }

  if (controlLevel === "execute_allowed") {
    return {
      mode: "semi_automatic",
      can_execute: true,
      requires_user_confirmation: false,
      explanation: reason,
    };
  }

  if (controlLevel === "suggest") {
    return {
      mode: "safe_suggest",
      can_execute: false,
      requires_user_confirmation: false,
      explanation: reason,
    };
  }

  return {
    mode: "read_only",
    can_execute: false,
    requires_user_confirmation: false,
    explanation: reason,
  };
}

function controlRank(level: ControlLevel): number {
  const rank: Record<ControlLevel, number> = {
    observe: 0,
    suggest: 1,
    confirm: 2,
    execute_allowed: 3,
    blocked: 4,
  };
  return rank[level];
}

function capControlLevel(controlLevel: ControlLevel, maxControlLevel?: ControlLevel): ControlLevel {
  if (!maxControlLevel) return controlLevel;
  if (controlLevel === "blocked") return "blocked";
  return controlRank(controlLevel) > controlRank(maxControlLevel) ? maxControlLevel : controlLevel;
}

function raiseControlLevel(controlLevel: ControlLevel, minControlLevel?: ControlLevel): ControlLevel {
  if (!minControlLevel) return controlLevel;
  return controlRank(controlLevel) < controlRank(minControlLevel) ? minControlLevel : controlLevel;
}

function resolveControlLevel(input: UniversalCoreInput, confidence: number, riskScore: number): ControlLevel {
  const semanticProfile = deriveSemanticControlProfile(input);
  const hasBlockingRule = input.constraints.blocked_action_rules?.some((rule) => rule.blocks_execution && rule.severity >= 70);
  if (hasBlockingRule || riskScore >= 85) return "blocked";
  if (confidence < 45) return "observe";
  if (semanticProfile.advisoryOnly) return input.constraints.require_confirmation ? "confirm" : "suggest";
  if (!input.constraints.allow_automation) return input.constraints.require_confirmation ? "confirm" : "suggest";
  if (input.constraints.require_confirmation) return "confirm";
  return "execute_allowed";
}

export function runUniversalCore(input: UniversalCoreInput): UniversalCoreOutput {
  const dataQuality = clamp(input.data_quality.score);
  const signalScores = input.signals.map((signal) => signal.normalized_score);
  const severity = clamp(Math.max(0, ...signalScores));
  const confidence = clamp(
    dataQuality * 0.45 +
      average(input.signals.map((signal) => signal.confidence_hint ?? dataQuality)) * 0.35 +
      average(input.signals.map((signal) => signal.reliability_hint ?? dataQuality)) * 0.20,
  );

  const maxRiskHint = Math.max(0, ...input.signals.map((signal) => signal.risk_hint ?? 0));
  const blockingRisk = Math.max(0, ...(input.constraints.blocked_action_rules?.map((rule) => (rule.blocks_execution ? rule.severity : 0)) ?? []));
  const semanticProfile = deriveSemanticControlProfile(input);
  let riskScore = clamp(
    severity * 0.35 +
      maxRiskHint * 0.22 +
      average(input.signals.map((signal) => signal.friction_hint ?? 20)) * 0.30 +
      (100 - dataQuality) * 0.25 +
      average(input.signals.map((signal) => 100 - (signal.trend?.stability_score ?? 80))) * 0.10 +
      blockingRisk * 0.18,
  );

  if (semanticProfile.advisoryOnly && !input.constraints.safety_mode) {
    riskScore = Math.max(input.constraints.risk_floor ?? 0, riskScore - 18);
  } else if (semanticProfile.lowExecutionRisk && !input.constraints.safety_mode) {
    riskScore = Math.max(input.constraints.risk_floor ?? 0, riskScore - 10);
  }

  riskScore = Math.max(riskScore, input.constraints.risk_floor ?? 0);

  const observeMode = shouldObserve(input, severity, riskScore, confidence);
  const rawControlLevel = observeMode ? "observe" : resolveControlLevel(input, confidence, riskScore);
  const controlLevel = raiseControlLevel(
    capControlLevel(rawControlLevel, input.constraints.max_control_level),
    input.constraints.min_control_level,
  );
  const profile = executionProfile(controlLevel, `Control level ${controlLevel} derived from confidence ${confidence.toFixed(1)} and risk ${riskScore.toFixed(1)}.`);

  const hasSpecificSemanticSignal = input.signals.some(
    (signal) => hasSemanticTag(signal) && !isGenericContinuitySignal(signal),
  );

  const rankedSignals = [...input.signals]
    .map((signal) => ({ signal, score: rankSignal(signal, dataQuality, { hasSpecificSemanticSignal }) }))
    .sort((a, b) => b.score - a.score);

  const actionableRankedSignals = rankedSignals.filter(({ signal }) => !signal.tags?.includes("system"));

  const recommendedActions: UniversalAction[] = (observeMode
    ? [
        {
          signal: {
            id: `${input.domain}:observe`,
            source: input.domain,
            category: "observe",
            label: "Mantieni monitoraggio",
            value: 0,
            normalized_score: 0,
            severity_hint: 0,
            confidence_hint: confidence,
            expected_value_hint: 0,
            reversibility_hint: 100,
            friction_hint: 0,
            evidence: [{ label: "segnali bassi e rischio basso", value: true }],
            tags: ["observe", "system"],
          } satisfies UniversalSignal,
          score: 100,
        },
      ]
    : actionableRankedSignals.length
      ? actionableRankedSignals
      : rankedSignals
  ).slice(0, 5).map(({ signal, score }) => {
    const actionId = `action:${signal.id}`;
    const blockedInfo = isBlockedAction(actionId, input);

    return {
      id: actionId,
      label: signal.label,
      reason: signal.evidence?.[0]?.label ?? `Segnale ${signal.category}`,
      severity_score: signal.severity_hint ?? signal.normalized_score,
      confidence_score: signal.confidence_hint ?? confidence,
      impact_score: signal.expected_value_hint ?? signal.normalized_score,
      reversibility_score: signal.reversibility_hint ?? 70,
      risk_score: riskScore,
      final_priority_score: score,
      control_level: blockedInfo.blocked ? "blocked" : controlLevel,
      execution_profile: blockedInfo.blocked ? executionProfile("blocked", `Action blocked by ${blockedInfo.reasonCodes.join(", ")}.`) : profile,
      blocked: blockedInfo.blocked,
      blocked_reason_codes: blockedInfo.reasonCodes,
    };
  });

  const primary = recommendedActions[0];
  const blockedReasons: string[] = [];
  if (riskScore >= 85) blockedReasons.push("risk_too_high");
  if (confidence < 45) blockedReasons.push("confidence_too_low");
  if (input.constraints.safety_mode) blockedReasons.push("safety_mode");
  for (const rule of input.constraints.blocked_action_rules ?? []) {
    if (rule.blocks_execution) blockedReasons.push(rule.reason_code);
  }

  const computedState = controlLevel === "blocked" ? "blocked" : observeMode ? "observe" : stateFromSeverity(severity);
  const state = input.constraints.state_floor
    ? (computedState === "blocked"
      ? "blocked"
      : (["observe", "ok", "attention", "critical", "protection", "blocked"].indexOf(computedState) <
          ["observe", "ok", "attention", "critical", "protection", "blocked"].indexOf(input.constraints.state_floor)
          ? input.constraints.state_floor
          : computedState))
    : computedState;

  return {
    request_id: input.request_id,
    generated_at: new Date().toISOString(),
    domain: input.domain,
    state,
    severity,
    confidence,
    risk: {
      score: riskScore,
      band: controlLevel === "blocked" ? "blocked" : riskBand(riskScore),
      reasons: blockedReasons,
    },
    control_level: controlLevel,
    priority: {
      primary_signal_id: rankedSignals[0]?.signal.id,
      primary_action_id: primary?.id,
      score: primary?.final_priority_score ?? 0,
      ranking_method: "universal_priority_v1_semantic_specificity",
    },
    recommended_actions: recommendedActions,
    execution_profile: profile,
    blocked_reasons: blockedReasons,
    diagnostics: {
      contract_version: "universal_core_contract_v0",
      core_version: "universal_core_v0",
      signal_count: input.signals.length,
      blocked_signal_count: input.signals.filter((signal) => signal.tags?.includes("blocked")).length,
      blocked_action_count: input.constraints.blocked_action_rules?.filter((rule) => rule.blocks_execution).length ?? 0,
      notes: [],
    },
  };
}

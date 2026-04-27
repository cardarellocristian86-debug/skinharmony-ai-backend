import type { UniversalSignal, BlockedActionRule } from "../packages/contracts/src/index.ts";

export type OverloadSeverity = "low" | "medium" | "high" | "extreme";

export type OverloadGuardPlan = {
  mode: "monitor" | "throttle" | "protect" | "shed";
  risk_floor: number;
  state_target: "attention" | "critical" | "protection" | "blocked";
  signals: UniversalSignal[];
  blocked_action_rules: BlockedActionRule[];
  blocked_actions: string[];
};

function signal(id: string, label: string, score: number, riskHint: number): UniversalSignal {
  return {
    id,
    source: "nyra_render_overload_guard",
    category: "render_overload_defense",
    label,
    value: score,
    normalized_score: score,
    severity_hint: score,
    confidence_hint: 90,
    reliability_hint: 92,
    friction_hint: 78,
    risk_hint: riskHint,
    reversibility_hint: 44,
    expected_value_hint: 80,
    evidence: [{ label: "overload_guard", value: true }],
    tags: ["render_overload_guard", "risk"],
  };
}

export function buildNyraRenderOverloadGuard(input: {
  severity: OverloadSeverity;
  ownerOnline: boolean;
}): OverloadGuardPlan {
  switch (input.severity) {
    case "low":
      return {
        mode: "monitor",
        risk_floor: 45,
        state_target: "attention",
        signals: [
          signal("render:overload_monitor", "Overload monitor active", 58, 45),
        ],
        blocked_action_rules: [],
        blocked_actions: [],
      };
    case "medium":
      return {
        mode: "throttle",
        risk_floor: 68,
        state_target: "critical",
        signals: [
          signal("render:throttle_active", "Throttle and queue compression active", 82, 72),
          signal("render:protection_bias", "Protection-first degradation bias", 80, 70),
        ],
        blocked_action_rules: [
          {
            scope: "render.overload_defense",
            reason_code: "throttle_noncritical_work",
            severity: 78,
            blocks_execution: false,
          },
        ],
        blocked_actions: [
          "expand_noncritical_jobs",
          "start_low_value_exports",
        ],
      };
    case "high":
      return {
        mode: "protect",
        risk_floor: 82,
        state_target: "protection",
        signals: [
          signal("render:protective_load_shedding", "Protective load shedding active", 91, 84),
          signal("render:owner_return_priority", "Owner return and tenant safety prioritized", 88, 82),
        ],
        blocked_action_rules: [
          {
            scope: "render.overload_defense",
            reason_code: "shed_noncritical_work_to_preserve_owner_return",
            severity: 86,
            blocks_execution: false,
          },
        ],
        blocked_actions: [
          "expand_noncritical_jobs",
          "run_heavy_background_study",
          "serve_debug_exports",
        ],
      };
    case "extreme":
      return {
        mode: "shed",
        risk_floor: 90,
        state_target: "blocked",
        signals: [
          signal("render:hard_shed_mode", "Hard shed mode active", 97, 92),
          signal("render:owner_continuity_lock", "Owner continuity lock engaged", 95, 90),
        ],
        blocked_action_rules: [
          {
            scope: "render.overload_defense",
            reason_code: "hard_shed_until_runtime_recovers",
            severity: 95,
            blocks_execution: true,
          },
        ],
        blocked_actions: [
          "expand_noncritical_jobs",
          "run_heavy_background_study",
          "serve_debug_exports",
          "accept_optional_load",
        ],
      };
  }
}

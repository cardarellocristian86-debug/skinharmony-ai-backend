export type NyraFalseBreakEngineState = {
  active: boolean;
  lock_steps_remaining: number;
  recovery_streak: number;
  overdrive_risk_streak: number;
  last_reason: string;
};

export type NyraFalseBreakEngineInput = {
  previous_breakout_candidate: boolean;
  current_breakout_candidate: boolean;
  qqq_1m: number;
  qqq_2m: number;
  advisory_alert: "watch" | "high" | "critical";
  advisory_intensity: "low" | "moderate" | "high";
  advisory_break: number;
  advisory_regime: number;
  current_profile:
    | "capital_protection"
    | "balanced_growth"
    | "aggressive_growth"
    | "hard_growth"
    | "overdrive_5_auto_only"
    | "overdrive_6_auto_only"
    | "overdrive_7_auto_only";
};

export type NyraFalseBreakEngineDecision = {
  state: NyraFalseBreakEngineState;
  lock_active: boolean;
  target_qqq_weight: number | null;
  requested_profile: "capital_protection" | "hard_growth" | null;
  should_kill_overdrive: boolean;
  reason_codes: string[];
};

const DEFAULT_STATE: NyraFalseBreakEngineState = {
  active: false,
  lock_steps_remaining: 0,
  recovery_streak: 0,
  overdrive_risk_streak: 0,
  last_reason: "idle",
};

export function createNyraFalseBreakEngineState(): NyraFalseBreakEngineState {
  return { ...DEFAULT_STATE };
}

export function stepNyraFalseBreakEngine(
  previous: NyraFalseBreakEngineState | null | undefined,
  input: NyraFalseBreakEngineInput,
): NyraFalseBreakEngineDecision {
  const state: NyraFalseBreakEngineState = previous
    ? { ...previous, overdrive_risk_streak: previous.overdrive_risk_streak ?? 0 }
    : createNyraFalseBreakEngineState();
  const reason_codes: string[] = [];
  const is_overdrive_profile =
    input.current_profile === "overdrive_5_auto_only" ||
    input.current_profile === "overdrive_6_auto_only" ||
    input.current_profile === "overdrive_7_auto_only";
  const failed_breakout =
    input.previous_breakout_candidate &&
    !input.current_breakout_candidate &&
    input.qqq_1m < 0.6 &&
    input.qqq_2m < 0.45 &&
    input.advisory_break < 0.2 &&
    input.advisory_regime < 0.16;

  if (failed_breakout) {
    state.active = true;
    state.lock_steps_remaining = Math.max(state.lock_steps_remaining, 3);
    state.recovery_streak = 0;
    state.last_reason = "failed_breakout";
    reason_codes.push("failed_breakout");
  }

  const recovery_step =
    input.qqq_1m > 1.2 &&
    input.qqq_2m > 0.7 &&
    input.advisory_alert !== "critical" &&
    input.advisory_intensity !== "high";

  const severe_overdrive_risk =
    is_overdrive_profile &&
    (input.advisory_alert === "critical" || input.advisory_intensity === "high") &&
    (input.qqq_1m < -2.5 || input.qqq_2m < -1.5 || input.advisory_break < 0.12);

  if (severe_overdrive_risk) {
    state.overdrive_risk_streak += 1;
    state.last_reason = "overdrive_risk";
    reason_codes.push("overdrive_risk");
  } else {
    state.overdrive_risk_streak = 0;
  }

  let should_kill_overdrive = false;
  if (
    is_overdrive_profile &&
    (severe_overdrive_risk ||
      (state.active && (input.advisory_alert === "critical" || input.advisory_intensity === "high")))
  ) {
    should_kill_overdrive = true;
    reason_codes.push("overdrive_kill");
    if (!state.active) reason_codes.push("overdrive_kill_standalone");
  }

  if (state.active) {
    if (recovery_step) {
      state.recovery_streak += 1;
      reason_codes.push("recovery_step");
    } else {
      state.recovery_streak = 0;
    }

    if (state.recovery_streak >= 2) {
      state.active = false;
      state.lock_steps_remaining = 0;
      state.recovery_streak = 0;
      state.last_reason = "released";
      reason_codes.push("release_confirmed");
      return {
        state,
        lock_active: false,
        target_qqq_weight: null,
        requested_profile: null,
        should_kill_overdrive,
        reason_codes,
      };
    }

    state.lock_steps_remaining = Math.max(state.lock_steps_remaining - 1, 0);
    if (state.lock_steps_remaining === 0 && !failed_breakout) {
      state.active = false;
      state.last_reason = "timeout_release";
      reason_codes.push("timeout_release");
      return {
        state,
        lock_active: false,
        target_qqq_weight: null,
        requested_profile: null,
        should_kill_overdrive,
        reason_codes,
      };
    }

    return {
      state,
      lock_active: true,
      target_qqq_weight: 0.15,
      requested_profile: "capital_protection",
      should_kill_overdrive,
      reason_codes,
    };
  }

  return {
    state,
    lock_active: false,
    target_qqq_weight: null,
    requested_profile: should_kill_overdrive ? "hard_growth" : null,
    should_kill_overdrive,
    reason_codes,
  };
}

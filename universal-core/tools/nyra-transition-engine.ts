import type { NyraDialogueState } from "./nyra-dialogue-state.ts";

export type NyraTransitionDecision = {
  phase: NyraDialogueState["phase"];
  carry_forward_task: boolean;
  push_action: boolean;
  hold_human_space: boolean;
};

export function resolveNyraTransition(state: NyraDialogueState): NyraTransitionDecision {
  if (state.act === "greet") {
    return {
      phase: "greet",
      carry_forward_task: false,
      push_action: false,
      hold_human_space: true,
    };
  }

  if (state.act === "status_check" || state.act === "study_meta" || state.act === "relational") {
    return {
      phase: state.phase,
      carry_forward_task: false,
      push_action: false,
      hold_human_space: true,
    };
  }

  if (state.act === "basic_need") {
    return {
      phase: "act",
      carry_forward_task: false,
      push_action: true,
      hold_human_space: true,
    };
  }

  if (state.act === "followup") {
    return {
      phase: state.task.pending_goal ? "act" : "clarify",
      carry_forward_task: Boolean(state.task.pending_goal),
      push_action: Boolean(state.task.pending_goal),
      hold_human_space: false,
    };
  }

  if (state.act === "open") {
    const pushAction =
      state.relational.urgency > 0.6 ||
      state.relational.confidence > 0.55 ||
      state.relational.ambiguity < 0.4;
    return {
      phase: pushAction ? "decide" : state.phase,
      carry_forward_task: Boolean(state.task.pending_goal),
      push_action: pushAction,
      hold_human_space: !pushAction,
    };
  }

  if (state.act === "operational") {
    return {
      phase: "act",
      carry_forward_task: true,
      push_action: true,
      hold_human_space: false,
    };
  }

  return {
    phase: state.phase,
    carry_forward_task: Boolean(state.task.pending_goal),
    push_action: false,
    hold_human_space: false,
  };
}

import type { NyraRelationalState } from "./nyra-relational-state-engine.ts";
import type { NyraCommandIntent } from "./nyra-command-interpreter.ts";

export type NyraEffectiveTaskState = {
  active_task?: string;
  next_step?: string;
  suspended_previous_task?: string;
  domain: string;
};

export function deriveNyraEffectiveTaskState(
  relState: NyraRelationalState,
  command: NyraCommandIntent,
): NyraEffectiveTaskState {
  if (command.should_suspend_previous_task) {
    return {
      active_task: undefined,
      next_step: undefined,
      suspended_previous_task: relState.pending_goal ?? relState.active_problem,
      domain: command.domain,
    };
  }

  return {
    active_task: command.objective ?? relState.pending_goal ?? relState.active_problem,
    next_step: relState.last_action,
    domain: command.domain === "general" ? relState.active_domain : command.domain,
  };
}

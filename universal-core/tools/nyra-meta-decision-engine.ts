export type NyraMetaMode =
  | "decide_for_user"
  | "resume_task"
  | "explore";

export type NyraMetaDecisionResult = {
  mode: NyraMetaMode;
  message: string;
  recommended?: string;
};

export type NyraMetaDialogueControlState = {
  mode: "task" | "meta_decision";
  suspended_task?: string;
};

export type NyraMetaDecisionState = {
  urgency: number;
  ambiguity: number;
  confidence: number;
  turn_count: number;
  dialogue_control_state: NyraMetaDialogueControlState;
};

function normalize(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTaskReferenced(input: string, task?: string): boolean {
  const normalizedInput = normalize(input);
  const normalizedTask = normalize(task || "");

  if (!normalizedTask) return false;
  if (normalizedInput.includes(normalizedTask)) return true;

  const taskTokens = normalizedTask.split(" ").filter((token) => token.length >= 4);
  if (taskTokens.length === 0) return false;

  const matchedTokens = taskTokens.filter((token) => normalizedInput.includes(token));
  return matchedTokens.length >= Math.min(2, taskTokens.length);
}

function isExplicitResume(input: string): boolean {
  return /(torniamo|riprendiamo|continua)/i.test(input);
}

export function runMetaDecisionEngine(
  state: NyraMetaDecisionState,
  input: string,
): NyraMetaDecisionResult | null {
  if (state.dialogue_control_state.mode !== "meta_decision") {
    return null;
  }

  const suspendedTask = state.dialogue_control_state.suspended_task;

  if (isExplicitResume(input) || isTaskReferenced(input, suspendedTask)) {
    return {
      mode: "resume_task",
      message: suspendedTask
        ? `Ok, riprendiamo ${suspendedTask}.`
        : "Ok, riprendiamo il task di prima.",
      recommended: suspendedTask,
    };
  }

  const decisionScore =
    state.urgency * 0.5 +
    state.confidence * 0.3 -
    state.ambiguity * 0.4;

  if (state.urgency > 0.7 || decisionScore > 0.5) {
    return {
      mode: "decide_for_user",
      message: "Vado diretto: scelgo io la direzione migliore adesso.",
      recommended: suspendedTask
        ? `Riprendo ${suspendedTask}`
        : "Definisco una nuova azione",
    };
  }

  if (state.ambiguity > 0.6) {
    return {
      mode: "explore",
      message: "Fermiamoci un attimo: cosa ti sta creando piu dubbio adesso?",
    };
  }

  return {
    mode: "decide_for_user",
    message: suspendedTask
      ? `Posso decidere io adesso oppure riprendiamo ${suspendedTask}.`
      : "Vuoi che decida io o preferisci chiarire meglio?",
  };
}

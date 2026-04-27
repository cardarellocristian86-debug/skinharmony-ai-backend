import type { NyraRelationalIntent, NyraRelationalState } from "./nyra-relational-state-engine.ts";
import {
  deriveNyraBasicNeedSemanticMode,
  deriveNyraEconomicSemanticMode,
  deriveNyraRelationalSemanticMode,
  inferNyraSemanticSignals,
} from "./nyra-semantic-intent-inference.ts";

export type NyraDialogueAct =
  | "greet"
  | "status_check"
  | "study_meta"
  | "basic_need"
  | "open"
  | "followup"
  | "operational"
  | "technical"
  | "relational"
  | "unknown";

export type NyraDialoguePhase = "greet" | "explore" | "clarify" | "decide" | "act" | "reflect";

export type NyraTaskState = {
  active_problem?: string;
  pending_goal?: string;
  last_action?: string;
};

export type NyraRelationalFrame = {
  tone: "warm" | "steady" | "direct" | "cautious";
  focus: "human" | "task" | "meta";
  urgency: number;
  ambiguity: number;
  confidence: number;
};

export type NyraDialogueState = {
  act: NyraDialogueAct;
  phase: NyraDialoguePhase;
  task: NyraTaskState;
  relational: NyraRelationalFrame;
  should_detach_from_task: boolean;
};

function normalize(text: string): string {
  return ` ${String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function detectNyraDialogueAct(userText: string, intent: NyraRelationalIntent): NyraDialogueAct {
  const text = normalize(userText);
  const semanticSignals = inferNyraSemanticSignals(userText);
  const basicNeedMode = deriveNyraBasicNeedSemanticMode(semanticSignals);
  const economicNeedMode = deriveNyraEconomicSemanticMode(semanticSignals);
  const relationalMode = deriveNyraRelationalSemanticMode(semanticSignals);

  if (
    text.includes(" ciao ") ||
    text.includes(" buongiorno ") ||
    text.includes(" buonasera ") ||
    text.includes(" ehi ")
  ) {
    return "greet";
  }

  if (
    text.includes(" come va ") ||
    text.includes(" come stai ") ||
    text.includes(" tutto bene ")
  ) {
    return "status_check";
  }

  if (
    text.includes(" hai studiato ") ||
    text.includes(" vuoi studiare ") ||
    text.includes(" cosa vuoi studiare ") ||
    text.includes(" hai gia studiato ")
  ) {
    return "study_meta";
  }

  if (basicNeedMode) {
    return "basic_need";
  }

  if (relationalMode === "meaning_of_home") {
    return "relational";
  }

  if (economicNeedMode) {
    return "operational";
  }

  if (intent === "emotional") return "relational";
  if (intent === "open") return "open";
  if (intent === "followup") return "followup";
  if (intent === "operational") return "operational";
  if (intent === "technical") return "technical";

  return "unknown";
}

export function deriveNyraDialogueState(
  relState: NyraRelationalState,
  userText: string,
  intent: NyraRelationalIntent,
): NyraDialogueState {
  const act = detectNyraDialogueAct(userText, intent);
  const ambiguity = clamp01(relState.ambiguity);
  const urgency = clamp01(relState.urgency);
  const confidence = clamp01(relState.confidence);

  let phase: NyraDialoguePhase = "reflect";
  if (act === "greet") phase = "greet";
  else if (act === "status_check" || act === "study_meta") phase = "reflect";
  else if (act === "basic_need") phase = "act";
  else if (act === "open" && ambiguity > 0.6) phase = "explore";
  else if (act === "open") phase = "clarify";
  else if (act === "followup" && relState.pending_goal) phase = "act";
  else if (act === "operational") phase = "act";
  else if (act === "relational") phase = "clarify";
  else if (relState.pending_goal) phase = "decide";

  const shouldDetachFromTask =
    act === "greet" ||
    act === "status_check" ||
    act === "study_meta" ||
    act === "relational" ||
    act === "basic_need";

  const focus: NyraRelationalFrame["focus"] =
    act === "relational" || act === "greet" || act === "status_check" || act === "basic_need"
      ? "human"
      : act === "study_meta"
        ? "meta"
        : "task";

  const tone: NyraRelationalFrame["tone"] =
    urgency > 0.7 ? "direct" : focus === "human" ? "warm" : ambiguity > 0.6 ? "cautious" : "steady";

  return {
    act,
    phase,
    task: shouldDetachFromTask
      ? {}
      : {
          active_problem: relState.active_problem,
          pending_goal: relState.pending_goal,
          last_action: relState.last_action,
        },
    relational: {
      tone,
      focus,
      urgency,
      ambiguity,
      confidence,
    },
    should_detach_from_task: shouldDetachFromTask,
  };
}

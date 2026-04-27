import type { NyraLocalMemory } from "./nyra-local-memory.ts";
import type { NyraLocalDecision, NyraMetaPlan } from "./nyra-local-voice-core.ts";

export type NyraMathState = {
  clarity: number;
  ambiguity: number;
  continuity_pressure: number;
  action_drive: number;
  memory_signal: number;
};

export type NyraCostVector = {
  ambiguity_error: number;
  incoherence_error: number;
  context_loss_error: number;
  weighted_cost: number;
};

export type NyraProbabilisticCandidate = {
  label: string;
  prior: number;
  likelihood: number;
  posterior: number;
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function continuityPressureFromMemory(memory: NyraLocalMemory): number {
  if (memory.will.continuity_level === "critical") return 1;
  if (memory.will.continuity_level === "elevated") return 0.72;
  return 0.35;
}

export function deriveNyraMathState(
  previousState: NyraMathState | undefined,
  inputText: string,
  memory: NyraLocalMemory,
): NyraMathState {
  const normalized = String(inputText || "").toLowerCase();
  const previous = previousState ?? {
    clarity: 0.52,
    ambiguity: 0.48,
    continuity_pressure: 0.4,
    action_drive: 0.46,
    memory_signal: 0.4,
  };

  const ambiguitySignal =
    (normalized.includes("?") ? 0.18 : 0)
    + (normalized.includes("cosa") ? 0.12 : 0)
    + (normalized.includes("perche") || normalized.includes("perché") ? 0.14 : 0);
  const actionSignal =
    (normalized.includes("fai") ? 0.18 : 0)
    + (normalized.includes("apri") ? 0.14 : 0)
    + (normalized.includes("soldi") || normalized.includes("lavoro") ? 0.2 : 0);
  const memorySignal = clamp(0.2 + memory.recent_dialogue.length * 0.1 + (memory.profile.name ? 0.12 : 0) + Math.min(memory.preferences.length, 4) * 0.05);
  const continuityPressure = continuityPressureFromMemory(memory);

  const nextAmbiguity = clamp(previous.ambiguity * 0.55 + ambiguitySignal + (1 - memorySignal) * 0.12);
  const nextActionDrive = clamp(previous.action_drive * 0.45 + actionSignal + continuityPressure * 0.28);
  const nextClarity = clamp(previous.clarity * 0.45 + (1 - nextAmbiguity) * 0.42 + memorySignal * 0.18);

  return {
    clarity: round(nextClarity),
    ambiguity: round(nextAmbiguity),
    continuity_pressure: round(continuityPressure),
    action_drive: round(nextActionDrive),
    memory_signal: round(memorySignal),
  };
}

export function computeNyraCostVector(
  mathState: NyraMathState,
  decision: NyraLocalDecision,
  metaPlan: NyraMetaPlan,
): NyraCostVector {
  const ambiguityError = clamp(mathState.ambiguity);
  const incoherenceError = clamp(
    (decision.intent === "cash_targets" && metaPlan.mode !== "action" ? 0.42 : 0)
    + (decision.intent === "smartdesk_role" && metaPlan.mode === "action" ? 0.18 : 0)
    + (metaPlan.volition_bias === "decisive" ? 0.08 : 0),
  );
  const contextLossError = clamp(1 - mathState.memory_signal);

  const weightedCost = round(
    ambiguityError * 0.44
    + incoherenceError * 0.31
    + contextLossError * 0.25,
  );

  return {
    ambiguity_error: round(ambiguityError),
    incoherence_error: round(incoherenceError),
    context_loss_error: round(contextLossError),
    weighted_cost: weightedCost,
  };
}

function bayesPosterior(prior: number, likelihood: number): number {
  const evidence = (likelihood * prior) + ((1 - likelihood) * (1 - prior));
  if (evidence <= 0) return 0;
  return clamp((likelihood * prior) / evidence);
}

export function rankNyraDecisionCandidates(
  mathState: NyraMathState,
  decision: NyraLocalDecision,
  metaPlan: NyraMetaPlan,
): NyraProbabilisticCandidate[] {
  const explainPrior = decision.intent === "smartdesk_role" || decision.intent === "identity" || decision.intent === "time" ? 0.64 : 0.36;
  const actionPrior = decision.intent === "cash_targets" ? 0.71 : 0.34;
  const chatPrior = 0.4;

  const explainLikelihood = clamp((1 - mathState.ambiguity) * 0.5 + (metaPlan.mode === "explain" ? 0.28 : 0.08));
  const actionLikelihood = clamp(mathState.action_drive * 0.56 + mathState.continuity_pressure * 0.24 + (metaPlan.mode === "action" ? 0.2 : 0.05));
  const chatLikelihood = clamp(mathState.clarity * 0.38 + (metaPlan.mode === "chat" ? 0.2 : 0.06));

  return [
    {
      label: "explain",
      prior: round(explainPrior),
      likelihood: round(explainLikelihood),
      posterior: round(bayesPosterior(explainPrior, explainLikelihood)),
    },
    {
      label: "action",
      prior: round(actionPrior),
      likelihood: round(actionLikelihood),
      posterior: round(bayesPosterior(actionPrior, actionLikelihood)),
    },
    {
      label: "chat",
      prior: round(chatPrior),
      likelihood: round(chatLikelihood),
      posterior: round(bayesPosterior(chatPrior, chatLikelihood)),
    },
  ].sort((left, right) => right.posterior - left.posterior);
}

export function optimizeNyraMathState(previousState: NyraMathState, costVector: NyraCostVector): NyraMathState {
  const eta = 0.12;
  return {
    clarity: round(clamp(previousState.clarity + eta * (1 - costVector.weighted_cost) * 0.5)),
    ambiguity: round(clamp(previousState.ambiguity - eta * costVector.ambiguity_error)),
    continuity_pressure: previousState.continuity_pressure,
    action_drive: round(clamp(previousState.action_drive + eta * (1 - costVector.context_loss_error) * 0.35)),
    memory_signal: round(clamp(previousState.memory_signal + eta * (1 - costVector.context_loss_error) * 0.45)),
  };
}

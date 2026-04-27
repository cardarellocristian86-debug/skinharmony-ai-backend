export type DialogueTone = "direct" | "consultative" | "soft" | "technical" | "owner_private";
export type DialogueBand = "reply_only" | "suggest_action" | "confirm_required" | "execute_now";

export type NyraDialogueMemoryRecord = {
  captured_at: string;
  user_text: string;
  intent: string;
  tone: DialogueTone;
  action_band: DialogueBand;
  confidence: number;
  owner_scope: "owner_only" | "owner_confirmed" | "general";
  outcome: "answer_only" | "guided" | "confirm_gate";
  memory_value: number;
};

export type NyraDialogueSelfDiagnosis = {
  confidence_band: "low" | "medium" | "high";
  status: "uncertain" | "guided" | "ready_with_confirmation";
  missing_data: boolean;
  owner_sensitive: boolean;
  explanation: string;
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

export function deriveNyraDialogueSelfDiagnosis(input: {
  confidence: number;
  action_band: DialogueBand;
  tone: DialogueTone;
  authority_scope: "owner_only" | "owner_confirmed" | "general";
  core_risk: number;
  state: string;
  user_text: string;
}): NyraDialogueSelfDiagnosis {
  const normalized = ` ${input.user_text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()} `;
  const missingData =
    normalized.includes(" manca ") ||
    normalized.includes(" dati ") ||
    normalized.includes(" non tornano ") ||
    normalized.includes(" incompleto ");
  const ownerSensitive = input.authority_scope === "owner_only" || input.tone === "owner_private";
  const confidenceBand =
    input.confidence >= 82 ? "high" :
    input.confidence >= 58 ? "medium" :
    "low";
  const status =
    input.action_band === "confirm_required"
      ? "ready_with_confirmation"
      : confidenceBand === "low" || missingData || input.core_risk >= 72
        ? "uncertain"
        : "guided";

  const explanation =
    status === "ready_with_confirmation"
      ? "capisco la richiesta ma non la eseguo senza conferma esplicita"
      : status === "uncertain"
        ? "vedo ancora incertezza o mancanza dati, quindi tengo la risposta prudente"
        : "ho abbastanza coerenza per guidarti senza fingere piu sicurezza del necessario";

  return {
    confidence_band: confidenceBand,
    status,
    missing_data: missingData,
    owner_sensitive: ownerSensitive,
    explanation,
  };
}

export function buildNyraDialogueMemoryRecord(input: {
  captured_at: string;
  user_text: string;
  intent: string;
  tone: DialogueTone;
  action_band: DialogueBand;
  confidence: number;
  authority_scope: "owner_only" | "owner_confirmed" | "general";
  diagnosis: NyraDialogueSelfDiagnosis;
}): NyraDialogueMemoryRecord {
  const outcome =
    input.action_band === "confirm_required"
      ? "confirm_gate"
      : input.diagnosis.status === "guided"
        ? "guided"
        : "answer_only";

  const memoryValue = clamp(
    input.confidence * 0.34 +
      (input.authority_scope === "owner_only" ? 28 : input.authority_scope === "owner_confirmed" ? 16 : 8) +
      (input.action_band === "confirm_required" ? 12 : 6) +
      (input.diagnosis.missing_data ? -18 : 10),
  );

  return {
    captured_at: input.captured_at,
    user_text: input.user_text,
    intent: input.intent,
    tone: input.tone,
    action_band: input.action_band,
    confidence: input.confidence,
    owner_scope: input.authority_scope,
    outcome,
    memory_value: Math.round(memoryValue * 1000) / 1000,
  };
}

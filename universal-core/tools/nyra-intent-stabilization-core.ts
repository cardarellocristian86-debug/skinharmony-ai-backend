export type NyraIntentMemoryTurn = {
  user_text: string;
  intent?: string;
};

export type NyraStabilizedIntent = {
  version: "nyra_intent_stabilization_v1";
  mode: "greeting" | "strategy" | "identity" | "market" | "play" | "neutral";
  stable_intent: "greeting_status" | "open_help" | "followup" | "priority" | "operational" | "open";
  confidence: number;
  reason: string;
};

function normalized(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

export function stabilizeNyraIntent(
  userText: string,
  history: NyraIntentMemoryTurn[],
  lastUserGoal?: string,
): NyraStabilizedIntent {
  const text = normalized(userText);
  const shortRelational =
    text === " come va " ||
    text === " come stai " ||
    text === " ciao " ||
    text === " buongiorno " ||
    text === " buonasera " ||
    text === " tutto bene ";
  const shortFollowup =
    text === " e quindi " ||
    text === " e ora " ||
    text === " quindi " ||
    text === " perche " ||
    text === " perché ";
  const openHelp =
    text.includes(" come puoi aiutarmi ") ||
    text.includes(" come puoi aitarmi ") ||
    text.includes(" in cosa mi puoi aiutare ") ||
    text.includes(" in cosa puoi aiutarmi ") ||
    text.includes(" che puoi fare per me ") ||
    text.includes(" cosa puoi fare per me ") ||
    text.includes(" in cosa mi sei utile ");
  const operational =
    text.includes(" render ") ||
    text.includes(" wordpress ") ||
    text.includes(" telefono ") ||
    text.includes(" pc ") ||
    text.includes(" runtime ");
  const priority =
    text.includes(" cosa devo fare ") ||
    text.includes(" da dove parto ") ||
    text.includes(" prossima azione ");
  const recent = history.slice(-4);
  const recentPriority = recent.some((entry) => entry.intent === "ask_priority" || entry.intent === "ask_priority_action");

  if (shortRelational) {
    return {
      version: "nyra_intent_stabilization_v1",
      mode: "greeting",
      stable_intent: "greeting_status",
      confidence: 96,
      reason: "input corto relazionale: va tenuto sul ramo presenza/stato",
    };
  }

  if (openHelp) {
    return {
      version: "nyra_intent_stabilization_v1",
      mode: "neutral",
      stable_intent: "open_help",
      confidence: 92,
      reason: "richiesta aperta semplice di aiuto: va tenuta fuori dal task carryover e dal Core pesante",
    };
  }

  if (shortFollowup && lastUserGoal) {
    return {
      version: "nyra_intent_stabilization_v1",
      mode: recentPriority ? "strategy" : "neutral",
      stable_intent: "followup",
      confidence: 84,
      reason: "follow-up corto: va ancorato al turno precedente, non ricalcolato da zero",
    };
  }

  if (priority) {
    return {
      version: "nyra_intent_stabilization_v1",
      mode: "strategy",
      stable_intent: "priority",
      confidence: 88,
      reason: "richiesta di scelta o prossimo passo",
    };
  }

  if (operational) {
    return {
      version: "nyra_intent_stabilization_v1",
      mode: "neutral",
      stable_intent: "operational",
      confidence: 82,
      reason: "richiesta operativa concreta",
    };
  }

  return {
    version: "nyra_intent_stabilization_v1",
    mode: "neutral",
    stable_intent: "open",
    confidence: 62,
    reason: "nessun ancoraggio forte: lascio il routing normale",
  };
}

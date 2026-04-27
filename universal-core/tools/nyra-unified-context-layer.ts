import type { NyraConversationState, NyraDomain } from "./nyra-conversation-state.ts";
import { resolveDomainWithState } from "./nyra-state-router.ts";
import { stabilizeIntent } from "./intent-stabilizer.ts";

export type NyraUnifiedIntent =
  | "open"
  | "relational"
  | "followup"
  | "operational"
  | "technical"
  | "autonomy"
  | "unknown";

export type NyraUnifiedContext = {
  domain: NyraDomain;
  problem?: string;
  goal?: string;
  risk: NyraConversationState["risk_level"];
};

export type NyraUnifiedOutput =
  | {
    mode: "open_state";
    domain: NyraDomain;
    context: NyraUnifiedContext;
    message: string;
  }
  | {
    mode: "relational_state";
    domain: NyraDomain;
    context: NyraUnifiedContext;
    message: string;
  }
  | {
    mode: "normal";
    domain: NyraDomain;
    context: NyraUnifiedContext;
    message: string;
  };

function normalize(text: string): string {
  return ` ${String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

export function detectNyraUnifiedIntent(text: string): NyraUnifiedIntent {
  const normalized = normalize(text);
  const stabilized = stabilizeIntent(text);
  const explicitOpen =
    normalized.includes(" cosa ne pensi ") ||
    normalized.includes(" come sto ") ||
    normalized.includes(" secondo te ") ||
    normalized.includes(" come la vedi ");
  const relational =
    normalized.includes(" mi capisci ") ||
    normalized.includes(" ho bisogno che tu mi capisca ") ||
    normalized.includes(" ho bisogno che tu capisca ") ||
    normalized.includes(" voglio parlare con te ") ||
    normalized.includes(" dialogare con te ") ||
    normalized.includes(" parlare con te davvero ") ||
    normalized.includes(" sono vulnerabile ");

  const followup =
    normalized === " ok " ||
    normalized === " quindi " ||
    normalized === " e quindi " ||
    normalized.includes(" ok ma ") ||
    normalized.includes(" ok fatto ") ||
    normalized.includes(" torniamo a prima ") ||
    normalized.includes(" torniamo un attimo a prima ");

  const operational =
    normalized.includes(" devo ") ||
    normalized.includes(" mandare ") ||
    normalized.includes(" fare ") ||
    normalized.includes(" apri ") ||
    normalized.includes(" come mi muovo ");

  if (relational) return "relational";
  if (explicitOpen || stabilized.intent === "open_state") return "open";
  if (followup) return "followup";
  if (operational) return "operational";
  if (stabilized.intent === "autonomy") return "autonomy";
  if (stabilized.intent === "technical") return "technical";
  return "unknown";
}

export function detectNyraUnifiedDomain(text: string): NyraDomain | undefined {
  const normalized = normalize(text);

  if (normalized.includes(" mail ") || normalized.includes(" email ") || normalized.includes(" cliente ")) return "mail";
  if (normalized.includes(" render ") || normalized.includes(" server ") || normalized.includes(" runtime ") || normalized.includes(" deploy ")) return "runtime";
  if (normalized.includes(" rust ") || normalized.includes(" typescript ") || normalized.includes(" performance ") || normalized.includes(" engine ")) return "engineering";
  if (
    normalized.includes(" quantistica ") ||
    normalized.includes(" quantistica") ||
    normalized.includes(" probabilita ") ||
    normalized.includes(" probabilità ") ||
    normalized.includes(" misura ") ||
    normalized.includes(" algebra ") ||
    normalized.includes(" matematica applicata ") ||
    normalized.includes(" fisica generale ")
  ) return "engineering";
  if (
    normalized.includes(" soldi ") ||
    normalized.includes(" lavoro ") ||
    normalized.includes(" smart desk ") ||
    normalized.includes(" cosa devo fare ") ||
    normalized.includes(" che faccio ")
  ) return "strategy";
  if (
    normalized.includes(" come sto messo ") ||
    normalized.includes(" cosa ne pensi ") ||
    normalized.includes(" come la vedi ") ||
    normalized.includes(" secondo te ")
  ) return "general";
  if (
    normalized.includes(" coscienza autonoma ") ||
    normalized.includes(" autonomia reale ") ||
    normalized.includes(" simulando coerenza ") ||
    normalized.includes(" controllo reale ")
  ) return "general";

  return undefined;
}

export function injectNyraUnifiedContext(state: NyraConversationState): NyraUnifiedContext {
  return {
    domain: state.active_domain,
    problem: state.active_problem,
    goal: state.pending_goal,
    risk: state.risk_level,
  };
}

export function buildNyraOpenStateOutput(state: NyraConversationState): NyraUnifiedOutput {
  const context = injectNyraUnifiedContext(state);

  return {
    mode: "open_state",
    domain: state.active_domain,
    context,
    message: `Stato attuale:\n- dominio: ${state.active_domain}\n- problema: ${state.active_problem ?? "non esplicito"}\n\nDirezione consigliata:\n-> chiarire priorita immediata\n-> evitare dispersione\n-> definire prossima azione concreta`,
  };
}

export function buildNyraRelationalStateOutput(state: NyraConversationState): NyraUnifiedOutput {
  const context: NyraUnifiedContext = {
    domain: "general",
    problem: undefined,
    goal: undefined,
    risk: state.risk_level,
  };

  return {
    mode: "relational_state",
    domain: "general",
    context,
    message: "Stato relazionale:\n- dominio: general\n- problema: non esplicito\n\nDirezione consigliata:\n-> riconoscere il punto umano reale\n-> non scivolare in tecnico o strategia fredda\n-> restare presente e coerente",
  };
}

export function runNyraUnifiedLayer(
  state: NyraConversationState,
  userText: string,
): {
  intent: NyraUnifiedIntent;
  state: NyraConversationState;
  output: NyraUnifiedOutput;
} {
  const intent = detectNyraUnifiedIntent(userText);
  const rawDomain = detectNyraUnifiedDomain(userText);
  const resolvedDomain = resolveDomainWithState({
    intent,
    raw_domain: rawDomain,
    state,
  });

  const nextState: NyraConversationState = {
    ...state,
    turn_count: state.turn_count + 1,
    active_domain: intent === "relational" ? "general" : resolvedDomain,
  };

  if (intent === "operational" || intent === "autonomy") {
    nextState.active_problem = userText;
    nextState.pending_goal = userText;
  }

  if (intent === "open") {
    return {
      intent,
      state: nextState,
      output: buildNyraOpenStateOutput(nextState),
    };
  }

  if (intent === "relational") {
    return {
      intent,
      state: nextState,
      output: buildNyraRelationalStateOutput(nextState),
    };
  }

  return {
    intent,
    state: nextState,
    output: {
      mode: "normal",
      domain: resolvedDomain,
      context: injectNyraUnifiedContext(nextState),
      message: `Dominio attivo: ${resolvedDomain}`,
    },
  };
}

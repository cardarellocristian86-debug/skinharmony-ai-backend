import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  deriveNyraEconomicSemanticMode,
  inferNyraSemanticSignals,
} from "./nyra-semantic-intent-inference.ts";

export type NyraRelationalIntent =
  | "open"
  | "followup"
  | "operational"
  | "technical"
  | "emotional"
  | "unknown";

export type NyraRelationalDomain =
  | "general"
  | "strategy"
  | "mail"
  | "runtime"
  | "engineering";

export type NyraRelation =
  | "continuation"
  | "pivot"
  | "escalation"
  | "uncertainty"
  | "action_push";

export type NyraRelationalState = {
  active_domain: NyraRelationalDomain;
  active_problem?: string;
  pending_goal?: string;
  last_action?: string;
  intent_history: NyraRelationalIntent[];
  relation_history: NyraRelation[];
  ambiguity: number;
  urgency: number;
  confidence: number;
  turn_count: number;
};

export type NyraDialogPhase = "explore" | "clarify" | "decide" | "act";

export function initRelationalState(): NyraRelationalState {
  return {
    active_domain: "general",
    intent_history: [],
    relation_history: [],
    ambiguity: 0.5,
    urgency: 0.5,
    confidence: 0.5,
    turn_count: 0,
  };
}

export function loadRelationalState(path: string): NyraRelationalState {
  try {
    if (!existsSync(path)) return initRelationalState();
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<NyraRelationalState>;
    return {
      active_domain: parsed.active_domain ?? "general",
      active_problem: parsed.active_problem,
      pending_goal: parsed.pending_goal,
      last_action: parsed.last_action,
      intent_history: Array.isArray(parsed.intent_history) ? parsed.intent_history.slice(-10) as NyraRelationalIntent[] : [],
      relation_history: Array.isArray(parsed.relation_history) ? parsed.relation_history.slice(-10) as NyraRelation[] : [],
      ambiguity: Number(parsed.ambiguity ?? 0.5),
      urgency: Number(parsed.urgency ?? 0.5),
      confidence: Number(parsed.confidence ?? 0.5),
      turn_count: Number(parsed.turn_count ?? 0),
    };
  } catch {
    return initRelationalState();
  }
}

export function saveRelationalState(path: string, state: NyraRelationalState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

function normalized(text: string): string {
  return ` ${String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function isGreetingLike(text: string): boolean {
  const t = normalized(text);
  return (
    t.includes(" ciao ") ||
    t.includes(" buongiorno ") ||
    t.includes(" buonasera ") ||
    t.includes(" ehi ") ||
    t.includes(" come va ") ||
    t.includes(" come stai ") ||
    t.includes(" tutto bene ")
  );
}

function isStudyMetaLike(text: string): boolean {
  const t = normalized(text);
  return (
    t.includes(" hai studiato ") ||
    t.includes(" vuoi studiare ") ||
    t.includes(" vuoi studiare ancora ") ||
    t.includes(" cosa vuoi studiare ") ||
    t.includes(" cosa vuoi studiare adesso ") ||
    t.includes(" cosa vuoi studiare ancora ")
  );
}

export function detectRelationalIntent(text: string): NyraRelationalIntent {
  const t = normalized(text);
  const semantic = inferNyraSemanticSignals(text);
  const economicMode = deriveNyraEconomicSemanticMode(semantic);

  if (semantic.scores.relational_presence >= 3) return "emotional";
  if (semantic.scores.help_request >= 3) return "open";
  if (economicMode || semantic.scores.economic_pressure >= 5) return "operational";

  if (
    t.includes(" come sto ") ||
    t.includes(" cosa ne pensi ") ||
    t.includes(" come la vedi ")
  ) return "open";

  if (t.includes(" ok ") || t.includes(" quindi ")) return "followup";

  if (t.includes(" devo ") || t.includes(" mandare ") || t.includes(" fare "))
    return "operational";

  if (t.includes(" server ") || t.includes(" runtime ") || t.includes(" rust "))
    return "technical";

  if (
    t.includes(" non posso ") ||
    t.includes(" paura ") ||
    t.includes(" casino ") ||
    t.includes(" mi capisci ") ||
    t.includes(" ho bisogno che tu mi capisca ") ||
    t.includes(" sono vulnerabile ")
  ) return "emotional";

  return "unknown";
}

export function detectRelationalDomain(text: string): NyraRelationalDomain | undefined {
  const t = normalized(text);
  const semantic = inferNyraSemanticSignals(text);

  if (t.includes(" mail ") || t.includes(" cliente ")) return "mail";
  if (t.includes(" render ") || t.includes(" server ")) return "runtime";
  if (t.includes(" rust ")) return "engineering";
  if (semantic.scores.economic_pressure >= 4) return "strategy";
  if (t.includes(" soldi ") || t.includes(" lavoro ") || t.includes(" smart desk ")) return "strategy";

  return undefined;
}

export function deriveRelation(
  prevIntent: NyraRelationalIntent | undefined,
  currentIntent: NyraRelationalIntent,
): NyraRelation {
  if (!prevIntent) return "continuation";
  if (prevIntent === currentIntent) return "continuation";
  if (currentIntent === "operational") return "action_push";
  if (currentIntent === "open") return "uncertainty";
  if (currentIntent === "emotional" && prevIntent !== "emotional") return "escalation";
  return "pivot";
}

export function updateRelationalState(
  state: NyraRelationalState,
  userText: string,
): { state: NyraRelationalState; intent: NyraRelationalIntent; relation: NyraRelation } {
  const intent = detectRelationalIntent(userText);
  const domain = detectRelationalDomain(userText);

  const prevIntent = state.intent_history[state.intent_history.length - 1];
  const relation = deriveRelation(prevIntent, intent);

  const next: NyraRelationalState = { ...state };
  const greetingLike = isGreetingLike(userText);
  const studyMetaLike = isStudyMetaLike(userText);

  next.turn_count += 1;
  next.intent_history = [...state.intent_history, intent].slice(-10);
  next.relation_history = [...state.relation_history, relation].slice(-10);

  if (domain && intent !== "open" && intent !== "emotional") {
    next.active_domain = domain;
  }

  if (intent === "operational") {
    next.active_problem = userText;
    next.pending_goal = userText;
  }

  if ((greetingLike || studyMetaLike) && intent === "unknown") {
    next.active_domain = "general";
    next.active_problem = undefined;
    next.pending_goal = undefined;
    next.last_action = undefined;
    next.ambiguity = 0.4;
    next.urgency = Math.max(0.2, next.urgency - 0.15);
    next.confidence = 0.4;
  }

  if (intent === "emotional") {
    next.active_domain = "general";
    next.urgency += 0.2;
    next.ambiguity = Math.max(0, next.ambiguity - 0.05);
  }
  if (intent === "open") next.ambiguity += 0.2;
  if (intent === "operational") next.confidence += 0.2;
  if (intent === "followup") next.confidence += 0.05;

  next.ambiguity = Math.min(1, next.ambiguity);
  next.urgency = Math.min(1, next.urgency);
  next.confidence = Math.min(1, next.confidence);

  return { state: next, intent, relation };
}

function shouldForceAction(state: NyraRelationalState): boolean {
  const openTurns = state.intent_history.filter((intent) => intent === "open").length;
  return (
    openTurns >= 2 ||
    state.urgency > 0.6 ||
    state.confidence > 0.5
  );
}

function shouldStabilize(state: NyraRelationalState): boolean {
  return state.ambiguity > 0.6;
}

function derivePhase(state: NyraRelationalState): NyraDialogPhase {
  if (state.ambiguity > 0.6) return "explore";
  if (state.confidence < 0.5) return "clarify";
  if (!state.pending_goal) return "decide";
  return "act";
}

function semanticTaskNextStep(goal: string): string | undefined {
  const semantic = inferNyraSemanticSignals(goal);
  const mode = deriveNyraEconomicSemanticMode(semantic);

  if (mode || semantic.scores.economic_pressure >= 5) {
    if (mode === "cost_coverage_pressure") {
      return "-> Taglia subito il costo che ti schiaccia e apri una sola entrata che copre il buco vicino";
    }
    if (mode === "monetization_pressure") {
      return "-> Blocca tutto il resto e chiudi una sola entrata vicina";
    }
    if (mode === "resource_exhaustion") {
      return "-> Blocca tutto il resto e scegli una sola mossa che porta cassa vicina";
    }
    return "-> Stringi una sola urgenza che porta cassa o taglia una perdita";
  }

  return undefined;
}

function generateNextStep(state: NyraRelationalState): string {
  const goal = state.pending_goal ?? state.active_problem;
  const cleanGoal = goal?.replace(/^\s*->\s*/, "");
  if (!cleanGoal) return state.last_action ?? "-> stringi la priorita che pesa di piu adesso";

  const semanticStep = semanticTaskNextStep(cleanGoal);
  if (semanticStep) {
    return semanticStep !== state.last_action
      ? semanticStep
      : "-> Nomina il collo di cassa che pesa di piu adesso";
  }

  const isMail = state.active_domain === "mail";
  const steps = isMail
    ? [
        "-> Scrivi la bozza",
        "-> Rivedi il tono",
        "-> Invia",
      ]
    : [
        `-> ${cleanGoal}`,
        "-> Rifinisci il punto chiave",
        "-> Chiudi il passo",
      ];

  const used = state.last_action ?? "";
  return steps.find((step) => step !== used) ?? steps[0];
}

export function generateRelationalReply(
  state: NyraRelationalState,
  intent: NyraRelationalIntent,
  relation: NyraRelation,
): { mode: "contextual" | "action_push" | "operational" | "continuation" | "default"; message: string } {
  const phase = derivePhase(state);

  if (intent === "emotional") {
    return {
      mode: "continuation",
      message: "Resto qui con te sul punto umano reale. Non stringo tutto in tecnica o strategia. Prima tengo il filo e capisco cosa pesa davvero adesso.",
    };
  }

  if (intent === "operational") {
    return {
      mode: "operational",
      message: `Ok, entriamo operativo.\n\nDominio: ${state.active_domain}\n\nPrima mossa:\n${generateNextStep(state)}`,
    };
  }

  if (intent === "followup") {
    return {
      mode: "continuation",
      message: `Prosegui cosi:\n${generateNextStep(state)}`,
    };
  }

  if (intent === "open" && shouldForceAction(state)) {
    return {
      mode: "action_push",
      message: `Ti dico io cosa fare adesso:\n\n${generateNextStep(state)}\n\nNon serve aspettare oltre.`,
    };
  }

  if (intent === "open" || shouldStabilize(state) || phase === "explore") {
    return {
      mode: "contextual",
      message: `Stai in una fase di valutazione.\n\nSituazione:\n- dominio: ${state.active_domain}\n- problema: ${state.active_problem ?? "non esplicito"}\n\nTi serve prima chiarire direzione, non dettaglio.\nDimmi: qual e la cosa che ti preoccupa davvero adesso?`,
    };
  }

  if (relation === "continuation") {
    return {
      mode: "continuation",
      message: `Stiamo continuando nello stesso contesto.\n\nRimaniamo su:\n${generateNextStep(state)}`,
    };
  }

  if (shouldForceAction(state) || phase === "act") {
    return {
      mode: "action_push",
      message: `Non e il momento di analizzare troppo.\n\nFai questo subito:\n${generateNextStep(state)}\n\nPoi correggiamo se serve.`,
    };
  }

  if (phase === "clarify") {
    return {
      mode: "contextual",
      message: "Stiamo chiarendo. Ti manca solo un punto prima di muoverti.",
    };
  }

  if (phase === "decide") {
    return {
      mode: "action_push",
      message: "Ti propongo io una direzione.",
    };
  }

  return {
    mode: "default",
    message: `Dominio: ${state.active_domain}. Procediamo.`,
  };
}

export function runRelationalEngine(
  state: NyraRelationalState,
  userText: string,
): {
  state: NyraRelationalState;
  intent: NyraRelationalIntent;
  relation: NyraRelation;
  reply: ReturnType<typeof generateRelationalReply>;
} {
  const { state: nextState, intent, relation } = updateRelationalState(state, userText);
  const reply = generateRelationalReply(nextState, intent, relation);
  const nextAction = intent === "followup" || intent === "operational" || reply.mode === "action_push" || reply.mode === "continuation"
    ? generateNextStep(nextState)
    : undefined;
  if (nextAction) {
    nextState.last_action = nextAction;
  }

  return {
    state: nextState,
    intent,
    relation,
    reply,
  };
}

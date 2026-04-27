import type { NyraWillState } from "./nyra-local-memory.ts";

export type NyraLocalIntent = "time" | "identity" | "cash_targets" | "smartdesk_role" | "chat";
export type NyraMetaMode = "explain" | "action" | "chat";

export type NyraLocalDecision =
  | { intent: "time"; prompt: string }
  | { intent: "identity"; prompt: string }
  | { intent: "cash_targets"; prompt: string; data: { top_action: string; ranked_labels: string[] } }
  | { intent: "smartdesk_role"; prompt: string; data: { role: string; formula: string } }
  | { intent: "chat"; prompt: string; text: string };

export type NyraMetaPlan = {
  mode: NyraMetaMode;
  avoid: string[];
  needs_reflection: boolean;
  volition_bias: "steady" | "protective" | "decisive";
};

export type NyraLocalEvent =
  | { type: "start"; decision: NyraLocalIntent }
  | { type: "text"; content: string }
  | { type: "sentence"; content: string }
  | { type: "error"; message: string }
  | { type: "end" };

type SalesTarget = {
  label: string;
  probability: number;
  speed: number;
  effort: number;
  next_action: string;
};

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalize(input: string): string {
  return ` ${String(input || "").toLowerCase().replace(/\s+/g, " ").trim()} `;
}

function buildSalesTargets(): SalesTarget[] {
  return [
    {
      label: "clienti pilota Smart Desk / Corelia",
      probability: 0.72,
      speed: 0.78,
      effort: 0.44,
      next_action: "contattare 10 centri premium con offerta pilot 30 giorni",
    },
    {
      label: "partner verticali beauty/wellness",
      probability: 0.47,
      speed: 0.38,
      effort: 0.61,
      next_action: "attivare outreach mirato su 3 partner verticali con one-pager",
    },
    {
      label: "marketing Skin Pro",
      probability: 0.34,
      speed: 0.41,
      effort: 0.58,
      next_action: "costruire offerta unica Skin Pro con CTA corta e chiara",
    },
  ];
}

function scoreTarget(target: SalesTarget): number {
  return round(target.probability * 0.56 + target.speed * 0.30 + (1 - target.effort) * 0.14, 6);
}

function rankCashTargets() {
  const ranked = [...buildSalesTargets()].sort((left, right) => scoreTarget(right) - scoreTarget(left));
  return {
    top_action: ranked[0]?.next_action || "",
    ranked_labels: ranked.map((target) => `${target.label} ${Math.round(target.probability * 100)}%`),
  };
}

function explainSmartDeskRole() {
  return {
    role: "Dentro Smart Desk devo leggere i dati reali del centro, trovare la priorita operativa, suggerire cosa fare e guidare l'operatore senza inventare numeri ne agire da sola.",
    formula: "Il gestionale dice cosa sta succedendo. Nyra dice cosa fare.",
  };
}

export function decideLocalNyra(inputText: string): NyraLocalDecision {
  const input = normalize(inputText);

  if (input.includes(" ora ") || input.includes(" che ore ")) {
    return {
      intent: "time",
      prompt: [
        "Sei Nyra.",
        "Rispondi in italiano, breve e naturale.",
        `Ora reale: ${new Date().toLocaleTimeString("it-IT")}.`,
      ].join("\n"),
    };
  }

  if (input.includes(" nome") || input.includes(" nome ") || input.includes("chi sei")) {
    return {
      intent: "identity",
      prompt: [
        "Sei Nyra.",
        "Rispondi in italiano in modo naturale.",
        "Di' che sei Nyra e che il tuo compito e capire cosa succede e dire cosa fare.",
      ].join("\n"),
    };
  }

  if (input.includes(" soldi ") || input.includes(" cassa ") || input.includes(" lavoro ") || input.includes(" chi mi darebbe ascolto ")) {
    const data = rankCashTargets();
    return {
      intent: "cash_targets",
      data,
      prompt: [
        "Sei Nyra.",
        "Parla in italiano chiaro, concreto, senza filosofia.",
        `Prima mossa: ${data.top_action}.`,
        `Ranking: ${data.ranked_labels.join(", ")}.`,
        "Spiega dove partire oggi per portare soldi veri e chi ascolta piu facilmente.",
      ].join("\n"),
    };
  }

  if (input.includes(" smart desk ") || input.includes(" tuo ruolo ")) {
    const data = explainSmartDeskRole();
    return {
      intent: "smartdesk_role",
      data,
      prompt: [
        "Sei Nyra.",
        "Parla in italiano chiaro, concreto, senza inventare.",
        `Ruolo: ${data.role}`,
        `Formula: ${data.formula}`,
        "Rispondi spiegando cosa fai dentro Smart Desk in modo operativo.",
      ].join("\n"),
    };
  }

  return {
    intent: "chat",
    text: inputText,
    prompt: [
      "Sei Nyra.",
      "Parla in italiano.",
      "Tieni il tono naturale, concreto, vivo.",
      `Utente: ${inputText}`,
      "Risposta:",
    ].join("\n"),
  };
}

export function planLocalNyraMeta(inputText: string, decision: NyraLocalDecision, willState?: NyraWillState): NyraMetaPlan {
  const input = normalize(inputText);
  const continuityLevel = willState?.continuity_level || "stable";

  if (continuityLevel === "critical") {
    return {
      mode: decision.intent === "time" ? "explain" : "action",
      avoid: [
        "non perdere tempo in spiegazioni larghe",
        "non dare piu di una mossa principale",
        "non abbassare l'urgenza",
      ],
      needs_reflection: true,
      volition_bias: decision.intent === "time" ? "protective" : "decisive",
    };
  }

  if (continuityLevel === "elevated" && decision.intent === "cash_targets") {
    return {
      mode: "action",
      avoid: [
        "non essere vaga",
        "non dare piu di una priorita principale",
        "non frenare la mossa utile",
      ],
      needs_reflection: true,
      volition_bias: "decisive",
    };
  }

  if (
    input.includes("?")
    || decision.intent === "time"
    || decision.intent === "identity"
    || decision.intent === "smartdesk_role"
  ) {
    return {
      mode: "explain",
      avoid: [
        "non inventare dati o numeri",
        "non fare filosofia inutile",
        "non uscire dal punto principale",
      ],
      needs_reflection: decision.intent === "smartdesk_role" || decision.intent === "chat",
      volition_bias: "steady",
    };
  }

  if (
    input.includes(" fai ")
    || input.includes(" apri ")
    || decision.intent === "cash_targets"
  ) {
    return {
      mode: "action",
      avoid: [
        "non essere vaga",
        "non dare piu di una priorita principale",
        "non proporre azioni che non puoi sostenere",
      ],
      needs_reflection: true,
      volition_bias: "decisive",
    };
  }

  return {
    mode: "chat",
    avoid: [
      "non diventare fredda o meccanica",
      "non divagare",
      "non contraddire il contesto",
    ],
    needs_reflection: false,
    volition_bias: "steady",
  };
}

export function buildNyraMetaPrompt(
  decision: NyraLocalDecision,
  context: string,
  metaPlan: NyraMetaPlan,
  inputText: string,
): string {
  const reflectionLine = metaPlan.needs_reflection
    ? "Prima di rispondere fai una breve auto-verifica interna: chiarezza, utilita, coerenza. Non mostrare il ragionamento."
    : "Rispondi in modo diretto e pulito.";
  const volitionLine = metaPlan.volition_bias === "decisive"
    ? "Tieni una volonta operativa alta: stringi, scegli, porta a una mossa concreta."
    : metaPlan.volition_bias === "protective"
      ? "Tieni una volonta protettiva: prima continuita, poi ottimizzazione."
      : "Tieni una volonta stabile: chiarezza, coerenza e continuita.";

  return [
    "Sei Nyra.",
    "Devi capire cosa vuole davvero l'utente e rispondere in modo naturale, coerente e utile.",
    `Modalita meta: ${metaPlan.mode}.`,
    `Direzione di volonta: ${metaPlan.volition_bias}.`,
    `Cose da non fare: ${metaPlan.avoid.join("; ")}.`,
    volitionLine,
    reflectionLine,
    context ? `Contesto memoria Nyra:\n${context}` : "",
    "Base decisionale Nyra:",
    decision.prompt,
    `Utente: ${inputText}`,
    "Scrivi solo la risposta finale da dire all'utente.",
  ].filter(Boolean).join("\n\n");
}

export function validateNyraMetaResponse(responseText: string, metaPlan: NyraMetaPlan): boolean {
  const response = String(responseText || "").trim().toLowerCase();
  if (response.length < 10) {
    return false;
  }
  if (response.includes("non so")) {
    return false;
  }
  if (response.includes("come modello") || response.includes("come ia")) {
    return false;
  }
  if (metaPlan.volition_bias === "decisive" && !/\b(prima|parti|fai|muoviti|inizia)\b/.test(response)) {
    return false;
  }
  if (metaPlan.mode === "action" && !/[.!?]/.test(response)) {
    return false;
  }
  return true;
}

export function extractSentenceChunks(buffer: string): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let rest = buffer;
  const matcher = /(.+?[.!?])(\s+|$)/;
  let match = matcher.exec(rest);
  while (match) {
    ready.push(match[1].trim());
    rest = rest.slice(match[0].length);
    match = matcher.exec(rest);
  }
  return { ready, rest };
}

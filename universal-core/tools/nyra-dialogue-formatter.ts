export type FormatterKind = "status" | "priority" | "truth" | "soft" | "clarity" | "technical";

type FormatterInput = {
  intro: string;
  state: string;
  risk: number;
  main_problem: string;
  what_to_do_now: string;
  what_not_to_do_now: string;
  why_this_matters: string;
  fallback_tail?: string;
};

function imperativeLike(text: string): string {
  return text.trim();
}

function avoidAction(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith("non ") ? trimmed.slice(4).trim() : trimmed;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function chooseVariant(kind: FormatterKind, input: FormatterInput): number {
  const seed = [
    kind,
    input.intro,
    input.state,
    input.main_problem,
    input.what_to_do_now,
    input.what_not_to_do_now,
    input.why_this_matters,
  ].join("|");
  return hashString(seed) % 3;
}

function joinSentences(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+\./g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/\?\./g, "?")
    .replace(/!\./g, "!")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRiskSentence(state: string, risk: number, variant: number): string {
  const riskText = round(risk, 2);
  const options = [
    `Stato ${state}, rischio ${riskText}.`,
    `Ti leggo in stato ${state}, rischio ${riskText}.`,
    `Il quadro che vedo e ${state}, rischio ${riskText}.`,
  ];
  return options[variant % options.length];
}

function buildReasonTail(input: FormatterInput): string {
  return input.fallback_tail ?? `Perche conta: ${input.why_this_matters}.`;
}

export function formatNyraDialogue(kind: FormatterKind, input: FormatterInput): string {
  const variant = chooseVariant(kind, input);
  const riskSentence = buildRiskSentence(input.state, input.risk, variant);
  const doNow = imperativeLike(input.what_to_do_now);
  const avoidNow = avoidAction(input.what_not_to_do_now);
  const reasonTail = buildReasonTail(input);

  if (kind === "clarity") {
    const orders = [
      [
        input.intro,
        `Il punto e questo: ${input.main_problem}.`,
        `La prima mossa e ${doNow}.`,
        `Serve perche ${input.why_this_matters}.`,
        `Adesso non aprirei ${avoidNow}.`,
      ],
      [
        input.intro,
        `Te lo metto semplice: ${input.main_problem}.`,
        `Partirei da ${doNow}.`,
        `Il motivo e concreto: ${input.why_this_matters}.`,
        `Il resto per ora resta fuori: ${avoidNow}.`,
      ],
      [
        input.intro,
        `Il centro della risposta e ${doNow}.`,
        `Dietro c'e questo: ${input.main_problem}.`,
        `Conta perche ${input.why_this_matters}.`,
        `Non spingerei ora su ${avoidNow}.`,
      ],
    ];
    return joinSentences(orders[variant]);
  }

  if (kind === "technical") {
    const orders = [
      [
        input.intro,
        `Separerei il problema cosi: ${input.main_problem}.`,
        `Prima verifica: ${doNow}.`,
        `Non toccherei ora ${avoidNow}.`,
        reasonTail,
      ],
      [
        input.intro,
        `La lettura tecnica e semplice: ${input.main_problem}.`,
        `Il prossimo controllo e ${doNow}.`,
        `Terrei fermo ${avoidNow}.`,
        reasonTail,
      ],
      [
        input.intro,
        `Qui non serve allargare: ${doNow}.`,
        `Il motivo e ${input.main_problem}.`,
        `Fuori adesso: ${avoidNow}.`,
        reasonTail,
      ],
    ];
    return joinSentences(orders[variant]);
  }

  if (kind === "status") {
    const orders = [
      [
        input.intro,
        riskSentence,
        `Il punto vero e che ${input.main_problem}.`,
        `Adesso farei questo: ${doNow}.`,
        `Eviterei invece ${input.what_not_to_do_now}.`,
        reasonTail,
      ],
      [
        input.intro,
        `Il punto vero e che ${input.main_problem}.`,
        riskSentence,
        `Io partirei da ${doNow}.`,
        `Terrei fuori ${avoidNow}.`,
        reasonTail,
      ],
      [
        input.intro,
        riskSentence,
        `La priorita reale e ${doNow}.`,
        `Il nodo dietro e ${input.main_problem}.`,
        `Non aprirei invece ${avoidNow}.`,
        reasonTail,
      ],
    ];
    return joinSentences(orders[variant]);
  }

  if (kind === "priority") {
    const orders = [
      [
        input.intro,
        `Se fai una sola cosa, fai questa: ${doNow}.`,
        riskSentence,
        `Non fare invece ${avoidNow}.`,
        reasonTail,
      ],
      [
        input.intro,
        riskSentence,
        `Se devo stringere, partirei da ${doNow}.`,
        `Lascerei fuori ${avoidNow}.`,
        reasonTail,
      ],
      [
        input.intro,
        `La mossa da non perdere e ${doNow}.`,
        riskSentence,
        `Blocca invece ${avoidNow}.`,
        reasonTail,
      ],
    ];
    return joinSentences(orders[variant]);
  }

  if (kind === "truth") {
    const orders = [
      [
        input.intro,
        "Ti dico la verita cruda.",
        riskSentence,
        `Il punto vero e che ${input.main_problem}.`,
        `La mossa giusta e ${doNow}.`,
        `Da evitare: ${avoidNow}.`,
        reasonTail,
      ],
      [
        input.intro,
        "Ti parlo senza filtro.",
        `Il nodo e ${input.main_problem}.`,
        riskSentence,
        `Muoviti su ${doNow}.`,
        `Non aprire ${avoidNow}.`,
        reasonTail,
      ],
      [
        input.intro,
        riskSentence,
        `La verita qui e ${input.main_problem}.`,
        `La mossa utile e ${doNow}.`,
        `Taglia invece ${avoidNow}.`,
        reasonTail,
      ],
    ];
    return joinSentences(orders[variant]);
  }

  const orders = [
    [
      input.intro,
      "Ti parlo semplice.",
      riskSentence,
      `Se guardo il nocciolo, farei ${doNow}.`,
      `Lascerei fuori ${input.what_not_to_do_now}.`,
      reasonTail,
    ],
    [
      input.intro,
      riskSentence,
      `Tengo il centro: ${doNow}.`,
      `Non aprirei ${avoidNow}.`,
      reasonTail,
    ],
    [
      input.intro,
      "La tengo semplice.",
      `Adesso starei su ${doNow}.`,
      riskSentence,
      `Il resto lo lascerei fuori: ${avoidNow}.`,
      reasonTail,
    ],
  ];
  return joinSentences(orders[variant]);
}

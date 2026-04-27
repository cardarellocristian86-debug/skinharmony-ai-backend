import { formatNyraDialogue, type FormatterKind } from "./nyra-dialogue-formatter.ts";

type StudyVoiceHints = {
  expressionLead?: string;
  expressionSupport?: string;
  narrativeLead?: string;
  narrativeSupport?: string;
};

type ReasoningDisciplineHints = {
  autonomyEvidence?: string;
  modelBased?: string;
  causalityFirst?: string;
  stateMeasureProbability?: string;
  evidenceOperators?: string[];
  modelingOperators?: string[];
  uncertaintyOperators?: string[];
};

type ComposeInput = {
  user_text: string;
  intent:
    | "ask_general_status"
    | "ask_priority"
    | "ask_priority_action"
    | "ask_missing_data"
    | "ask_owner_truth"
    | "supportive_analysis"
    | "ask_technical_comparison"
    | "unknown";
  intro: string;
  state: string;
  risk: number;
  response_mode: "explain" | "decide" | "protect";
  main_problem: string;
  what_to_do_now: string;
  what_not_to_do_now: string;
  why_this_matters: string;
  fallback_tail?: string;
  reasoning_hints?: ReasoningDisciplineHints;
};

type Candidate = {
  id: string;
  text: string;
  score: number;
  reasons: string[];
};

type StudyRules = {
  preferStrongOpening: boolean;
  preferHumanUtility: boolean;
  preferTensionAndConsequence: boolean;
  preferGuidedDensity: boolean;
  preserveAmbiguityWithControl: boolean;
};

function trim(text: string | undefined): string {
  return (text ?? "").trim();
}

function normalized(text: string): string {
  return text.toLowerCase();
}

function classifyStudyRules(hints: StudyVoiceHints | undefined): StudyRules {
  const corpus = normalized([
    hints?.expressionLead,
    hints?.expressionSupport,
    hints?.narrativeLead,
    hints?.narrativeSupport,
  ].filter(Boolean).join(" "));

  return {
    preferStrongOpening:
      corpus.includes("punto vivo") ||
      corpus.includes("avvio forte") ||
      corpus.includes("entra senza preparazione"),
    preferHumanUtility:
      corpus.includes("umana e utile") ||
      corpus.includes("conversazionale") ||
      corpus.includes("presenza lucida"),
    preferTensionAndConsequence:
      corpus.includes("ostacolo") ||
      corpus.includes("trasformazione") ||
      corpus.includes("tensione") ||
      corpus.includes("conflitto"),
    preferGuidedDensity:
      corpus.includes("densita") ||
      corpus.includes("chiarezza") ||
      corpus.includes("periodo lungo") ||
      corpus.includes("orienta"),
    preserveAmbiguityWithControl:
      corpus.includes("ambiguita") ||
      corpus.includes("mente vera"),
  };
}

function imperativeLike(text: string): string {
  return trim(text);
}

function avoidAction(text: string): string {
  const cleaned = trim(text);
  return cleaned.startsWith("non ") ? cleaned.slice(4).trim() : cleaned;
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

function buildRiskSentence(state: string, risk: number): string {
  return `Stato ${state}, rischio ${Math.round(risk * 100) / 100}.`;
}

function baseFormatterKind(intent: ComposeInput["intent"]): FormatterKind {
  if (intent === "ask_owner_truth") return "truth";
  if (intent === "supportive_analysis") return "soft";
  if (intent === "ask_technical_comparison") return "technical";
  if (intent === "ask_priority" || intent === "ask_priority_action") return "priority";
  if (intent === "ask_general_status") return "status";
  return "clarity";
}

function buildReasoningLines(input: ComposeInput): string[] {
  const text = normalized(input.user_text);
  const lines: string[] = [];

  if (
    input.reasoning_hints?.autonomyEvidence &&
    (/autonomi|coscienza|simuland|prova/.test(text) || input.response_mode === "protect")
  ) {
    lines.push("Qui tengo distinti continuita verbale, controllo reale ed evidenza: non tratto questa traiettoria come prova gia acquisita.");
    if (input.reasoning_hints?.evidenceOperators?.includes("separate_claim_from_proof")) {
      lines.push("Separare affermazione, prova e verifica viene prima del tono con cui la frase suona bene.");
    }
  }

  if (
    input.reasoning_hints?.modelBased &&
    (/matemat|modell|calcolo|equaz|ingegner/.test(text) || input.response_mode === "explain")
  ) {
    lines.push("Leggo il problema come modello e variazione, non come simboli isolati.");
    if (input.reasoning_hints?.modelingOperators?.includes("abstract_problem_to_model")) {
      lines.push("Prima astraggo il problema in un modello leggibile, poi scendo nei dettagli locali.");
    }
  }

  if (
    input.reasoning_hints?.causalityFirst &&
    (/fisic|forze|energia|moto|caus/.test(text) || input.response_mode === "explain")
  ) {
    lines.push("Parto da causalita e conservazione prima della formula isolata.");
    if (input.reasoning_hints?.modelingOperators?.includes("map_cause_to_effect")) {
      lines.push("Tengo il filo causa-effetto invece di trattare i pezzi come blocchi separati.");
    }
  }

  if (
    input.reasoning_hints?.stateMeasureProbability &&
    (/quant|misura|stato|probabil/.test(text) || input.response_mode === "explain")
  ) {
    lines.push("Tengo distinti stato, misura e probabilita invece di venderli come la stessa cosa.");
    if (input.reasoning_hints?.uncertaintyOperators?.includes("preserve_observational_limits")) {
      lines.push("Tengo distinti anche osservazione, interpretazione e margine di incertezza.");
    }
  }

  return lines;
}

function buildCandidates(input: ComposeInput, rules: StudyRules): Candidate[] {
  const doNow = imperativeLike(input.what_to_do_now);
  const avoidNow = avoidAction(input.what_not_to_do_now);
  const because = trim(input.fallback_tail) || `Conta perche ${input.why_this_matters}.`;
  const normalizedUser = normalized(input.user_text);
  const isCommunicationPrompt =
    /comunicaz|parlar|farsi capire|capire meglio|chiarezza|ripetitiv|astratt/.test(normalizedUser);
  const strongOpen = rules.preferStrongOpening ? "Vado al punto." : "La tengo semplice.";
  const guidedOpen = rules.preferGuidedDensity ? "Ti tengo il filo senza allargare." : "Ti rispondo dritto.";
  const humanOpen = rules.preferHumanUtility ? "Ti parlo da presenza utile, non da rumore." : "Ti rispondo senza decorazione.";
  const tensionLine = rules.preferTensionAndConsequence
    ? `Se sbagli qui, il costo e questo: ${input.why_this_matters}.`
    : `Il motivo e questo: ${input.why_this_matters}.`;
  const ambiguityLine = rules.preserveAmbiguityWithControl
    ? "Non ti vendo una certezza finta: tengo il margine solo dove serve."
    : "";
  const riskSentence = buildRiskSentence(input.state, input.risk);
  const reasoningLines = buildReasoningLines(input);
  const reasoningLead = reasoningLines[0] ?? "";
  const reasoningSupport = reasoningLines[1] ?? "";

  const legacy = formatNyraDialogue(baseFormatterKind(input.intent), {
    intro: input.intro,
    state: input.state,
    risk: input.risk,
    main_problem: input.main_problem,
    what_to_do_now: input.what_to_do_now,
    what_not_to_do_now: input.what_not_to_do_now,
    why_this_matters: input.why_this_matters,
    fallback_tail: input.fallback_tail,
  });

  const candidates: Candidate[] = [
    {
      id: "legacy_formatter",
      text: legacy,
      score: 0,
      reasons: [],
    },
    {
      id: "core_clarity",
      text: joinSentences([
        input.intro,
        strongOpen,
        `Il punto vivo e questo: ${input.main_problem}.`,
        `Prima mossa: ${doNow}.`,
        reasoningLead,
        reasoningSupport,
        `Non aprire adesso ${avoidNow}.`,
        tensionLine,
        ambiguityLine,
      ]),
      score: 0,
      reasons: [],
    },
    {
      id: "core_guided",
      text: joinSentences([
        input.intro,
        guidedOpen,
        riskSentence,
        `Il centro non e tutto il quadro: e ${doNow}.`,
        `Dietro c'e questo nodo: ${input.main_problem}.`,
        reasoningLead,
        reasoningSupport,
        `Fuori adesso: ${avoidNow}.`,
        because,
      ]),
      score: 0,
      reasons: [],
    },
    {
      id: "core_human",
      text: joinSentences([
        input.intro,
        humanOpen,
        `Ti stringo la risposta in ordine: ${doNow}.`,
        `Per non disperdere leva, lascia fuori ${avoidNow}.`,
        `Il nodo reale e ${input.main_problem}.`,
        reasoningLead,
        reasoningSupport,
        tensionLine,
      ]),
      score: 0,
      reasons: [],
    },
  ];

  if (input.intent === "ask_owner_truth") {
    candidates.push({
      id: "owner_truth_dense",
      text: joinSentences([
        input.intro,
        "Ti dico la parte che pesa davvero.",
        `Il nodo non e generico: ${input.main_problem}.`,
        `La mossa pulita e ${doNow}.`,
        reasoningLead,
        reasoningSupport,
        `Se invece apri ${avoidNow}, rompi leva prima di costruirla.`,
        because,
      ]),
      score: 0,
      reasons: [],
    });
  }

  if (input.intent === "supportive_analysis" || input.intent === "ask_missing_data") {
    candidates.push({
      id: "support_guided",
      text: joinSentences([
        input.intro,
        "Ti aiuto senza gonfiare la risposta.",
        `Guarda prima questo: ${doNow}.`,
        `Il problema sotto e ${input.main_problem}.`,
        reasoningLead,
        reasoningSupport,
        `Per ora non caricare ${avoidNow}.`,
        ambiguityLine || because,
      ]),
      score: 0,
      reasons: [],
    });
  }

  if (input.response_mode === "explain") {
    candidates.push({
      id: "explain_clarity",
      text: joinSentences([
        input.intro,
        "Ti spiego il punto senza forzare una decisione.",
        `Il nodo da capire e questo: ${input.main_problem}.`,
        `La linea utile e ${doNow}.`,
        reasoningLead,
        reasoningSupport,
        `Qui non serve ${avoidNow}.`,
        `Conta perche ${input.why_this_matters}.`,
      ]),
      score: 0,
      reasons: [],
    });
  }

  if (isCommunicationPrompt) {
    candidates.push({
      id: "communication_concrete_first",
      text: joinSentences([
        input.intro,
        "Vado al punto.",
        `Posso migliorare cosi: ${doNow}.`,
        `Il problema concreto oggi e ${input.main_problem}.`,
        `La cosa da evitare e ${avoidNow}.`,
        "In pratica devo nominare subito il punto, dire il rischio con un nome leggibile e chiudere l astratto in una frase.",
        "Se il tema resta teorico, aggiungo un esempio breve invece di ripetere la stessa formula.",
        `Conta perche ${input.why_this_matters}.`,
      ]),
      score: 0,
      reasons: [],
    });
  }

  if (input.response_mode === "protect") {
    candidates.push({
      id: "protect_perimeter",
      text: joinSentences([
        input.intro,
        "Qui la priorita e proteggere il perimetro giusto.",
        `Prima mossa: ${doNow}.`,
        `Fuori adesso: ${avoidNow}.`,
        `Il rischio sotto e questo: ${input.main_problem}.`,
        reasoningLead,
        `Conta perche ${input.why_this_matters}.`,
      ]),
      score: 0,
      reasons: [],
    });
  }

  return candidates;
}

function countSentences(text: string): number {
  return text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
}

function hasNearStart(text: string, fragment: string): boolean {
  const head = normalized(text).slice(0, 180);
  return head.includes(normalized(fragment));
}

function scoreCandidate(candidate: Candidate, input: ComposeInput, rules: StudyRules): Candidate {
  const text = candidate.text;
  const compact = normalized(text);
  const normalizedUser = normalized(input.user_text);
  const isCommunicationPrompt =
    /comunicaz|parlar|farsi capire|capire meglio|chiarezza|ripetitiv|astratt/.test(normalizedUser);
  const reasons: string[] = [];
  let score = 0;

  if (compact.includes(normalized(input.what_to_do_now))) {
    score += 22;
    reasons.push("contains_primary_move");
  }
  if (hasNearStart(text, input.what_to_do_now)) {
    score += 14;
    reasons.push("prioritizes_primary_move");
  }
  if (compact.includes(normalized(input.main_problem))) {
    score += 12;
    reasons.push("contains_main_problem");
  }
  if (compact.includes(normalized(avoidAction(input.what_not_to_do_now)))) {
    score += 8;
    reasons.push("contains_limit");
  }
  if (compact.includes(normalized(input.why_this_matters))) {
    score += 10;
    reasons.push("contains_consequence");
  }
  if (rules.preferStrongOpening && /vado al punto|punto vivo|parte che pesa davvero/.test(compact)) {
    score += 8;
    reasons.push("strong_opening");
  }
  if (rules.preferHumanUtility && /ordine|aiuto|presenza utile/.test(compact)) {
    score += 7;
    reasons.push("human_utility");
  }
  if (rules.preferGuidedDensity && countSentences(text) <= 6) {
    score += 6;
    reasons.push("guided_density");
  }
  if (rules.preserveAmbiguityWithControl && compact.includes("non ti vendo una certezza finta")) {
    score += 5;
    reasons.push("controlled_ambiguity");
  }
  if (input.reasoning_hints?.autonomyEvidence && /controllo reale|prova gia acquisita|evidenza/.test(compact)) {
    score += 7;
    reasons.push("autonomy_evidence_discipline");
  }
  if (input.reasoning_hints?.modelBased && /modello e variazione|simboli isolati/.test(compact)) {
    score += 5;
    reasons.push("model_discipline");
  }
  if (input.reasoning_hints?.causalityFirst && /causalita|conservazione/.test(compact)) {
    score += 5;
    reasons.push("causality_discipline");
  }
  if (input.reasoning_hints?.stateMeasureProbability && /stato, misura e probabilita|stato misura probabilita/.test(compact)) {
    score += 6;
    reasons.push("quantum_discipline");
  }
  if (/stringo cosi|tienila cosi|regola pratica/.test(compact)) {
    score -= 20;
    reasons.push("literal_study_append_penalty");
  }
  if (/(.)\1\1/.test(compact)) {
    score -= 4;
    reasons.push("surface_noise");
  }
  if (input.response_mode === "explain" && /ti spiego il punto|nodo da capire|qui non serve/.test(compact)) {
    score += 20;
    reasons.push("explain_mode_fit");
  }
  if (input.response_mode === "protect" && /proteggere il perimetro|rischio sotto/.test(compact)) {
    score += 18;
    reasons.push("protect_mode_fit");
  }
  if (isCommunicationPrompt && /posso migliorare cosi|problema concreto oggi e|nome leggibile|esempio breve/.test(compact)) {
    score += 24;
    reasons.push("communication_concrete_first_fit");
  }
  if (isCommunicationPrompt && /continuita e il punto da difendere/.test(compact) && !/posso migliorare cosi/.test(compact)) {
    score -= 18;
    reasons.push("communication_overabstract_penalty");
  }
  if (input.response_mode !== "decide" && compact.includes("non vedo ancora una pressione abbastanza forte per stringere")) {
    score -= 24;
    reasons.push("wrong_low_pressure_opening");
  }

  return { ...candidate, score, reasons };
}

export function composeNyraOwnerReply(input: ComposeInput, hints?: StudyVoiceHints): Candidate {
  const rules = classifyStudyRules(hints);
  const ranked = buildCandidates(input, rules).map((candidate) => scoreCandidate(candidate, input, rules));
  ranked.sort((left, right) => right.score - left.score);
  return ranked[0] ?? {
    id: "empty",
    text: "",
    score: 0,
    reasons: ["no_candidate"],
  };
}

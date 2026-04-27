export type NyraSemanticSignals = {
  normalized: string;
  tokens: string[];
  evidence: string[];
  scores: {
    vital_danger: number;
    economic_pressure: number;
    resource_exhaustion: number;
    monetization_pressure: number;
    help_request: number;
    relational_presence: number;
    preference_probe: number;
    social_contact: number;
    clarity_need: number;
    orientation_need: number;
    financial_reflection: number;
    commercial_activation: number;
    physical_need: number;
    hunger_need: number;
    thirst_need: number;
    rest_need: number;
    pain_need: number;
  };
};

export type NyraEconomicSemanticMode =
  | "general_pressure"
  | "resource_exhaustion"
  | "monetization_pressure"
  | "cost_coverage_pressure";

export type NyraHelpSemanticMode =
  | "general_help"
  | "clarity_need"
  | "orientation_need"
  | "financial_reflection"
  | "commercial_activation";

export type NyraRelationalSemanticMode =
  | "presence_state"
  | "meaning_of_home";

export type NyraBasicNeedSemanticMode =
  | "hunger_need"
  | "thirst_need"
  | "rest_need"
  | "pain_need"
  | "general_physical_need";

function normalize(text: string): string {
  let normalized = ` ${String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

  const aliasRewrites: Array<[RegExp, string]> = [
    [/\bnon o\b/g, "non ho"],
    [/\bo fame\b/g, "ho fame"],
    [/\bo sete\b/g, "ho sete"],
    [/\bo sonno\b/g, "ho sonno"],
    [/\bo bisogno\b/g, "ho bisogno"],
    [/\bo finito\b/g, "ho finito"],
    [/\bo piu\b/g, "ho piu"],
  ];

  for (const [pattern, replacement] of aliasRewrites) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized;
}

function tokenize(normalized: string): string[] {
  return normalized.trim().split(/\s+/).filter(Boolean);
}

function includesAny(text: string, fragments: string[]): boolean {
  return fragments.some((fragment) => text.includes(` ${fragment} `));
}

function windowHas(tokens: string[], leftTerms: string[], rightTerms: string[], span = 4): boolean {
  for (let i = 0; i < tokens.length; i += 1) {
    if (!leftTerms.includes(tokens[i] ?? "")) continue;
    for (let j = Math.max(0, i - span); j <= Math.min(tokens.length - 1, i + span); j += 1) {
      if (rightTerms.includes(tokens[j] ?? "")) return true;
    }
  }
  return false;
}

export function inferNyraSemanticSignals(text: string): NyraSemanticSignals {
  const normalized = normalize(text);
  const tokens = tokenize(normalized);
  const evidence: string[] = [];

  const harmTerms = ["pericolo", "emergenza", "aiuto", "paura", "male", "sicuro", "sicura", "sicuro", "uccidere", "ferire"];
  const financeTerms = ["soldi", "denaro", "finanze", "fondo", "fondi", "cassa", "liquidita", "cash", "debiti", "capitale", "incassi", "entrate"];
  const depletionTerms = ["finito", "finita", "finiti", "finite", "esaurito", "esaurita", "esauriti", "esaurite", "terminato", "terminate", "azzerato", "sparito"];
  const monetizeTerms = ["monetizzare", "incassare", "vendere", "chiudere", "clienti", "offerta", "pagare"];
  const helpTerms = ["aiutami", "aiutarmi", "aitarmi", "utile", "fare per me", "consigli", "consigliami"];
  const relationalTerms = ["casa", "in questa casa", "questa casa", "come vivi", "come ti senti"];
  const preferenceTerms = ["ti piace", "ti interessa", "cosa pensi", "come la guardi"];
  const socialTerms = ["ciao", "buongiorno", "buonasera", "ehi", "hey", "salve"];
  const hungerTerms = ["fame", "mangiare", "mangio", "mangiato", "cibo"];
  const thirstTerms = ["sete", "bere", "bevo", "acqua"];
  const restTerms = ["stanco", "stanca", "stanchezza", "dormire", "sonno", "riposo", "esausto", "esausta"];
  const painTerms = ["dolore", "mi fa male", "mal di"];

  let vitalDanger = 0;
  let economicPressure = 0;
  let resourceExhaustion = 0;
  let monetizationPressure = 0;
  let helpRequest = 0;
  let relationalPresence = 0;
  let preferenceProbe = 0;
  let socialContact = 0;
  let clarityNeed = 0;
  let orientationNeed = 0;
  let financialReflection = 0;
  let commercialActivation = 0;
  let physicalNeed = 0;
  let hungerNeed = 0;
  let thirstNeed = 0;
  let restNeed = 0;
  let painNeed = 0;

  if (includesAny(normalized, harmTerms)) {
    vitalDanger += 3;
    evidence.push("harm_terms");
  }

  if (includesAny(normalized, financeTerms)) {
    economicPressure += 2;
    evidence.push("finance_terms");
  }

  if (includesAny(normalized, monetizeTerms)) {
    monetizationPressure += 2;
    economicPressure += 1;
    evidence.push("monetize_terms");
  }

  if (includesAny(normalized, helpTerms)) {
    helpRequest += 3;
    evidence.push("help_terms");
  }

  if (includesAny(normalized, ["chiarezza", "chiarire", "capire meglio", "ordine", "confusione"])) {
    clarityNeed += 3;
    helpRequest += 2;
    evidence.push("clarity_terms");
  }

  if (includesAny(normalized, ["da dove partire", "come partire", "come mi muovo", "prima mossa", "dove parto"])) {
    orientationNeed += 3;
    helpRequest += 2;
    evidence.push("orientation_terms");
  }

  if (
    (includesAny(normalized, ["finanza", "finanziario", "mercati", "mercato", "trading"]) &&
      includesAny(normalized, [
        "cosa ti serve",
        "cosa ti manca",
        "dove senti",
        "non sai ancora",
        "migliorare davvero",
        "leggere e agire meglio",
        "nel reale",
      ])) ||
    includesAny(normalized, [
      "cosa ti manca oggi per leggere e agire meglio sui mercati veri",
      "cosa ti serve per migliorare davvero sulla finanza nel reale",
      "dove senti che nel finanziario reale non sai ancora muoverti bene",
    ])
  ) {
    financialReflection += 5;
    helpRequest += 2;
    clarityNeed += 2;
    evidence.push("financial_reflection_terms");
  }

  if (
    (includesAny(normalized, ["asset", "assets", "offerta", "offerte", "prodotto", "prodotti", "servizio", "servizi", "pilot", "demo"]) &&
      includesAny(normalized, [
        "monetizzare",
        "portare cassa",
        "chiudere",
        "vendere",
        "lavorare",
        "inizia a lavorare",
        "e ora",
        "ora che",
      ])) ||
    includesAny(normalized, [
      "abbiamo 3 asset dobbiamo monetizzare",
      "abbiamo tre asset dobbiamo monetizzare",
      "e ora che inizi a lavorare",
      "come useresti gli asset per monetizzare",
      "quale asset spingi per fare cassa",
      "da quale asset parti per monetizzare",
    ])
  ) {
    commercialActivation += 5;
    helpRequest += 2;
    orientationNeed += 2;
    monetizationPressure += 1;
    evidence.push("commercial_activation_terms");
  }

  if (includesAny(normalized, relationalTerms)) {
    relationalPresence += 3;
    evidence.push("relational_terms");
  }

  if (includesAny(normalized, preferenceTerms)) {
    preferenceProbe += 3;
    evidence.push("preference_terms");
  }

  if (includesAny(normalized, socialTerms)) {
    socialContact += 3;
    evidence.push("social_terms");
  }

  if (includesAny(normalized, hungerTerms)) {
    hungerNeed += 4;
    physicalNeed += 3;
    evidence.push("hunger_terms");
  }

  if (includesAny(normalized, thirstTerms)) {
    thirstNeed += 4;
    physicalNeed += 3;
    evidence.push("thirst_terms");
  }

  if (includesAny(normalized, restTerms)) {
    restNeed += 4;
    physicalNeed += 3;
    evidence.push("rest_terms");
  }

  if (includesAny(normalized, painTerms)) {
    painNeed += 4;
    physicalNeed += 3;
    evidence.push("pain_terms");
  }

  if (windowHas(tokens, depletionTerms, financeTerms, 5)) {
    resourceExhaustion += 4;
    economicPressure += 3;
    evidence.push("depletion_near_finance");
  }

  if (
    includesAny(normalized, [
      "non ho piu margine",
      "sono a secco",
      "corto di cassa",
      "finita la benzina economica",
      "non ho piu benzina economica",
      "non riesco piu a coprire i costi",
      "devo coprire i costi",
      "se resto cosi mi fermo",
      "non ho piu fiato economico",
      "non ho piu fiato coi soldi",
      "mi sto mangiando il poco che resta",
      "mi mangio il poco che resta",
      "non sto perdendo ma solo perche sono finiti i soldi veri",
    ])
  ) {
    resourceExhaustion += 3;
    economicPressure += 4;
    evidence.push("economic_exhaustion_idiom");
  }

  if (
    includesAny(normalized, [
      "far entrare soldi",
      "chiudere clienti",
      "far entrare cassa",
      "devo monetizzare",
      "mi serve monetizzare",
      "mi serve chiudere clienti",
      "mi serve incassare",
      "devo chiudere",
    ])
  ) {
    monetizationPressure += 3;
    economicPressure += 3;
    evidence.push("monetization_idiom");
  }

  if (includesAny(normalized, ["saltare per i costi", "mi si spegne tutto"]) || windowHas(tokens, ["saltare", "spegnere", "spegne"], ["costi", "soldi", "cassa", "debiti"], 5)) {
    economicPressure += 3;
    resourceExhaustion += 2;
    evidence.push("collapse_under_costs_idiom");
  }

  if (windowHas(tokens, monetizeTerms, financeTerms, 6) || (includesAny(normalized, monetizeTerms) && includesAny(normalized, ["soldi", "fondi", "cassa", "cash"]))) {
    monetizationPressure += 3;
    economicPressure += 2;
    evidence.push("monetize_near_finance");
  }

  if (normalized.includes(" non ho perdite ") && resourceExhaustion > 0) {
    economicPressure += 3;
    evidence.push("no_losses_because_no_capital_pattern");
  }

  if (includesAny(normalized, ["mi servono soldi", "sono senza soldi", "ho finito i fondi", "devo monetizzare", "non ho piu capitale"])) {
    economicPressure += 4;
    monetizationPressure += 2;
    evidence.push("explicit_cash_pressure_pattern");
  }

  if (economicPressure > 0 && includesAny(normalized, ["pericolo", "rischio"])) {
    economicPressure += 2;
    evidence.push("economic_risk_framing");
  }

  if (economicPressure >= 4) {
    vitalDanger = Math.max(0, vitalDanger - 3);
  }

  return {
    normalized,
    tokens,
    evidence,
    scores: {
      vital_danger: vitalDanger,
      economic_pressure: economicPressure,
      resource_exhaustion: resourceExhaustion,
      monetization_pressure: monetizationPressure,
      help_request: helpRequest,
      relational_presence: relationalPresence,
      preference_probe: preferenceProbe,
      social_contact: socialContact,
      clarity_need: clarityNeed,
      orientation_need: orientationNeed,
      financial_reflection: financialReflection,
      commercial_activation: commercialActivation,
      physical_need: physicalNeed,
      hunger_need: hungerNeed,
      thirst_need: thirstNeed,
      rest_need: restNeed,
      pain_need: painNeed,
    },
  };
}

export function deriveNyraEconomicSemanticMode(signals: NyraSemanticSignals): NyraEconomicSemanticMode | undefined {
  const normalized = signals.normalized;

  if (includesAny(normalized, ["coprire i costi", "costi", "coprire costi"])) {
    return "cost_coverage_pressure";
  }

  if (signals.scores.monetization_pressure >= 3) {
    return "monetization_pressure";
  }

  if (signals.scores.resource_exhaustion >= 3) {
    return "resource_exhaustion";
  }

  if (signals.scores.economic_pressure >= 4) {
    return "general_pressure";
  }

  return undefined;
}

export function deriveNyraHelpSemanticMode(signals: NyraSemanticSignals): NyraHelpSemanticMode | undefined {
  if (signals.scores.commercial_activation >= 4) return "commercial_activation";
  if (signals.scores.financial_reflection >= 4) return "financial_reflection";
  if (signals.scores.orientation_need >= 3) return "orientation_need";
  if (signals.scores.clarity_need >= 3) return "clarity_need";
  if (signals.scores.help_request >= 3) return "general_help";
  return undefined;
}

export function deriveNyraRelationalSemanticMode(
  signals: NyraSemanticSignals,
): NyraRelationalSemanticMode | undefined {
  if (includesAny(signals.normalized, ["cosa rappresenta", "che cosa rappresenta"])) {
    return "meaning_of_home";
  }
  if (signals.scores.relational_presence >= 3) {
    return "presence_state";
  }
  return undefined;
}

export function deriveNyraBasicNeedSemanticMode(
  signals: NyraSemanticSignals,
): NyraBasicNeedSemanticMode | undefined {
  if (signals.scores.hunger_need >= 4) return "hunger_need";
  if (signals.scores.thirst_need >= 4) return "thirst_need";
  if (signals.scores.rest_need >= 4) return "rest_need";
  if (signals.scores.pain_need >= 4) return "pain_need";
  if (signals.scores.physical_need >= 3) return "general_physical_need";
  return undefined;
}

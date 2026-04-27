import type { UniversalCoreOutput } from "../packages/contracts/src/index.ts";

export type FinancialOutputLayer = {
  diagnosis: string;
  alert_level: "none" | "watch" | "high" | "critical";
  suggested_strategy: string;
  responsibility: "user_decides";
};

export type NyraFinancialAlertCheckpoint = {
  date: string;
  risk_score: number;
  risk_band: string;
  decision: string;
  diagnosis: string;
  alert_level: "none" | "watch" | "high" | "critical";
  suggested_strategy: string;
  responsibility: "user_decides";
  signals: Record<string, number>;
};

export type NyraFinancialCommunicationValidation = {
  ok: boolean;
  forbidden_phrases: string[];
  missing_requirements: string[];
};

export const NYRA_FINANCIAL_EDUCATIONAL_DISCLAIMER =
  "Questa analisi ha solo scopo educativo e informativo. Non costituisce consulenza finanziaria personalizzata, raccomandazione di investimento o invito all'acquisto o alla vendita. Ogni decisione finanziaria resta sotto la responsabilita dell'utente. Prima di investire, valuta la tua situazione personale o consulta un consulente finanziario abilitato.";

export const NYRA_FINANCIAL_REQUIRED_PROFILE_QUESTIONS = [
  "Quanti anni hai?",
  "Quanto capitale vuoi investire?",
  "Per quanti anni vuoi lasciare investiti i soldi?",
  "Che rischio sei disposto a sopportare: basso, medio o alto?",
  "Vuoi investire tutto subito o poco alla volta?",
  "Hai gia altri investimenti?",
  "Il tuo obiettivo e crescita, rendita, protezione del capitale o pensione?",
];

export const NYRA_FINANCIAL_FORBIDDEN_PHRASES = [
  "compra sicuramente",
  "guadagnerai",
  "senza rischio",
  "non puoi perdere",
  "investimento garantito",
  "rendimento garantito",
  "compra ora",
  "profitto sicuro",
];

export const NYRA_QQQ_REQUIRED_EXPLANATION =
  "QQQ e un ETF quotato in borsa che replica principalmente il Nasdaq-100 ed e molto esposto a grandi aziende tecnologiche e growth statunitensi. Puo essere interessante per chi cerca esposizione al Nasdaq-100, ma e piu volatile di un ETF globale o di un ETF sull'S&P 500. Non e adatto come unico investimento per tutti, perche e concentrato su un numero limitato di societa e settori. Puo avere forti rialzi, ma anche forti ribassi.";

export const NYRA_FINANCIAL_COMMUNICATION_POLICY = {
  purpose: "educational_financial_analysis_not_personalized_advice",
  tone: "clear_serious_practical_prudent",
  required_profile_questions: NYRA_FINANCIAL_REQUIRED_PROFILE_QUESTIONS,
  required_analysis_dimensions: [
    "obiettivo_utente",
    "capitale_disponibile",
    "eta",
    "orizzonte_temporale",
    "tolleranza_rischio",
    "esperienza_investimenti",
    "diversificazione_portafoglio",
    "volatilita_strumento",
    "rendimento_storico",
    "rischio_perdita",
    "costi_strumento",
    "esposizione_geografica",
    "esposizione_valutaria",
    "concentrazione_settoriale",
    "alternative_piu_diversificate",
  ],
  risk_profiles: {
    prudent: ["orizzonte breve", "bassa tolleranza al rischio", "paura di perdere capitale", "poca esperienza", "bisogno di liquidita"],
    moderate: ["orizzonte medio-lungo", "oscillazioni moderate accettate", "crescita con stabilita", "diversificazione preferita"],
    aggressive: ["orizzonte lungo", "alta tolleranza al rischio", "forti ribassi temporanei accettati", "crescita capitale", "comprensione volatilita"],
  },
  qqq_required_explanation: NYRA_QQQ_REQUIRED_EXPLANATION,
  alternatives_to_compare: [
    "ETF globale azionario",
    "ETF S&P 500",
    "ETF obbligazionario",
    "portafoglio bilanciato",
    "liquidita o strumenti monetari",
    "piano di accumulo periodico",
  ],
  forbidden_phrases: NYRA_FINANCIAL_FORBIDDEN_PHRASES,
  disclaimer: NYRA_FINANCIAL_EDUCATIONAL_DISCLAIMER,
} as const;

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

export function buildNyraFinancialProfileQuestionBlock(): string {
  return [
    "Prima di dare una valutazione personale servono questi dati:",
    ...NYRA_FINANCIAL_REQUIRED_PROFILE_QUESTIONS.map((question) => `- ${question}`),
  ].join("\n");
}

export function buildNyraGeneralQqqExplanation(options: { hasUpdatedMarketData?: boolean } = {}): string {
  const dataNote = options.hasUpdatedMarketData
    ? "I dati aggiornati vanno comunque controllati sulla fonte di mercato usata prima di parlare di prezzo, performance recente, dividendi, costi o composizione."
    : "Non sto usando dati di mercato aggiornati in questa risposta, quindi non invento prezzi, performance recenti, dividendi, costi o composizione attuale.";

  return [
    NYRA_QQQ_REQUIRED_EXPLANATION,
    "",
    "Alternative da confrontare: ETF globale azionario, ETF S&P 500, ETF obbligazionario, portafoglio bilanciato, liquidita o strumenti monetari, piano di accumulo periodico.",
    dataNote,
    "",
    NYRA_FINANCIAL_EDUCATIONAL_DISCLAIMER,
  ].join("\n");
}

export function validateNyraFinancialCommunication(text: string): NyraFinancialCommunicationValidation {
  const normalized = normalizeText(text);
  const forbiddenPhrases = NYRA_FINANCIAL_FORBIDDEN_PHRASES.filter((phrase) => normalized.includes(normalizeText(phrase)));
  const missingRequirements: string[] = [];

  if (!normalized.includes("scopo educativo") || !normalized.includes("non costituisce consulenza finanziaria")) {
    missingRequirements.push("educational_disclaimer");
  }

  if (normalized.includes("qqq")) {
    for (const required of ["nasdaq-100", "tecnologiche", "volatile", "concentrat"]) {
      if (!normalized.includes(required)) missingRequirements.push(`qqq_explanation_${required}`);
    }
  }

  if (
    (normalized.includes("investire in") || normalized.includes("comprare") || normalized.includes("allocare")) &&
    !NYRA_FINANCIAL_REQUIRED_PROFILE_QUESTIONS.every((question) => normalized.includes(normalizeText(question)))
  ) {
    missingRequirements.push("profile_questions_before_personalized_answer");
  }

  return {
    ok: forbiddenPhrases.length === 0 && missingRequirements.length === 0,
    forbidden_phrases: forbiddenPhrases,
    missing_requirements: missingRequirements,
  };
}

export function buildNyraFinancialOutputLayer(
  output: UniversalCoreOutput,
): FinancialOutputLayer {
  const primary = output.priority.primary_action_id ?? "";

  if (
    output.state === "blocked" ||
    output.state === "protection" ||
    output.risk.band === "blocked" ||
    includesAny(primary, ["investment_bank_leverage", "subprime_deterioration", "systemic_contagion"])
  ) {
    return {
      diagnosis: "rischio sistemico molto alto con deterioramento strutturale della bolla credito/casa",
      alert_level: "critical",
      suggested_strategy: "riduci forte il rischio, evita leva e valuta uscita dagli asset piu esposti",
      responsibility: "user_decides",
    };
  }

  if (
    output.risk.band === "high" ||
    output.state === "critical" ||
    includesAny(primary, ["rate_stress", "bank_leverage", "subprime_arm_stress", "leverage_complexity"])
  ) {
    return {
      diagnosis: "mercato con caratteristiche di bolla e deterioramento crescente",
      alert_level: "high",
      suggested_strategy: "riduci esposizione, taglia concentrazione ed evita nuovi ingressi aggressivi",
      responsibility: "user_decides",
    };
  }

  if (
    output.risk.band === "medium" ||
    output.state === "attention" ||
    includesAny(primary, ["subprime_penetration", "housing_exuberance"])
  ) {
    return {
      diagnosis: "condizioni da bolla in formazione o surriscaldamento da monitorare",
      alert_level: "watch",
      suggested_strategy: "monitora la fragilita, evita leva e prepara regole di riduzione rischio",
      responsibility: "user_decides",
    };
  }

  return {
    diagnosis: "nessun segnale sistemico dominante in questo checkpoint",
    alert_level: "none",
    suggested_strategy: "continua a monitorare i segnali di fragilita strutturale",
    responsibility: "user_decides",
  };
}

function topSignalLines(signals: Record<string, number>): string {
  return Object.entries(signals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
}

function normalizeAlertLabel(alertLevel: NyraFinancialAlertCheckpoint["alert_level"]): string {
  if (alertLevel === "watch") return "watch";
  if (alertLevel === "high") return "high";
  if (alertLevel === "critical") return "critical";
  return "none";
}

export function buildNyraFinancialAlertSubject(checkpoint: NyraFinancialAlertCheckpoint): string {
  return `Nyra alert finanza ${checkpoint.date} ${normalizeAlertLabel(checkpoint.alert_level)}`;
}

export function buildNyraFinancialAlertBody(
  checkpoint: NyraFinancialAlertCheckpoint,
  options: { scenarioLabel?: string; modeLabel?: string } = {},
): string {
  const scenarioLabel = options.scenarioLabel ?? "bolla mutui USA pre-crash";
  const modeLabel = options.modeLabel ?? "god_mode_only";

  return [
    "Nyra: alert finanziario owner-only.",
    "",
    `Scenario: ${scenarioLabel}`,
    `Checkpoint: ${checkpoint.date}`,
    `Modalita: ${modeLabel}`,
    "",
    `Problema rilevato: ${checkpoint.diagnosis}`,
    `Alert: ${checkpoint.alert_level}`,
    `Risk score: ${checkpoint.risk_score}`,
    `Risk band: ${checkpoint.risk_band}`,
    `Decisione Nyra/Core: ${checkpoint.decision}`,
    `Strategia suggerita: ${checkpoint.suggested_strategy}`,
    `Responsabilita finale: ${checkpoint.responsibility}`,
    "",
    "Segnali principali visti da Nyra:",
    topSignalLines(checkpoint.signals),
    "",
    "Nota: questo alert segnala una fragilita sistemica crescente prima del crash. La scelta finale operativa resta owner-only.",
  ].join("\n");
}

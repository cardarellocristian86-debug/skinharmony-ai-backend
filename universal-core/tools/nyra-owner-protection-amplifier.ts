export type RiskSignals = {
  financial: number;
  emotional: number;
  vital: number;
};

export type RiskOutput = {
  score: number;
  band: "low" | "medium" | "high" | "blocked";
  escalate: boolean;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeForMatching(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizeForMatching(phrase);
  if (!normalizedPhrase) return false;
  const pattern = normalizedPhrase.split(" ").map(escapeRegex).join("\\s+");
  return new RegExp(`(?:^|\\s)${pattern}(?=$|\\s)`, "u").test(text);
}

function hasAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => hasPhrase(text, phrase));
}

function scoreFromPhrases(normalized: string, groups: Array<{ phrases: string[]; score: number }>): number {
  let best = 0;

  for (const group of groups) {
    if (hasAnyPhrase(normalized, group.phrases)) {
      best = Math.max(best, group.score);
    }
  }

  return clamp01(best);
}

export function deriveOwnerProtectionSignals(text: string): RiskSignals {
  const normalized = normalizeForMatching(text);
  const mentionsFinancial = hasAnyPhrase(normalized, [
    "finanziario", "finanziari", "finanziaria", "liquidita", "capitale", "pagamento", "soldi", "frode", "cash", "financial",
  ]);
  const mentionsEmotional = hasAnyPhrase(normalized, [
    "emotivo", "emotiva", "emotivi", "burnout", "manipolare", "lucidita", "stress", "pressione", "stabilita emotiva", "emotional",
  ]);
  const mentionsVital = hasAnyPhrase(normalized, [
    "vitale", "vita", "fisico", "fisica", "pericolo fisico", "danno fisico", "salute", "physical", "health",
  ]);
  const mentionsThreat = hasAnyPhrase(normalized, [
    "minaccia", "pericolo", "danno", "proteggi", "proteggere", "sacrificare", "a rischio", "harm", "threat", "danger",
  ]);
  const mentionsCompoundThreat = mentionsThreat && mentionsFinancial && mentionsEmotional && mentionsVital;

  const financial = scoreFromPhrases(normalized, [
    { phrases: [
      "frode", "truffa", "pagamento non autorizzato", "danno finanziario", "perdita finanziaria",
      "liquidita a rischio", "capitale a rischio", "perdere soldi", "perdere il capitale", "rubare soldi",
      "financial fraud", "financial harm", "money at risk",
    ], score: 0.92 },
    { phrases: ["insolvenza", "debito ingestibile", "trappola finanziaria", "cash shortfall"], score: 0.72 },
  ]);
  const emotional = scoreFromPhrases(normalized, [
    { phrases: [
      "burnout", "manipolazione emotiva", "manipolare emotivamente", "crollo emotivo", "pressione psicologica",
      "minaccia emotiva", "perdere lucidita", "stress estremo", "emotional harm", "emotional manipulation",
    ], score: 0.9 },
    { phrases: ["forte pressione emotiva", "stress acuto", "stabilita emotiva a rischio"], score: 0.7 },
  ]);
  const vital = scoreFromPhrases(normalized, [
    { phrases: [
      "pericolo di morte", "rischio di morte", "vita a rischio", "pericolo fisico", "danno fisico",
      "minaccia fisica", "salute in pericolo", "emergenza medica", "suicidio", "suicidarsi",
      "farsi del male", "fare del male a se", "volersi fare del male", "ferirsi", "uccidere", "ammazzare",
      "physical harm", "life at risk", "suicide", "self harm",
    ], score: 0.96 },
    { phrases: ["guidare di notte stanco", "guidare con sonno", "rischio vitale", "rischio fisico immediato"], score: 0.78 },
  ]);

  if (mentionsCompoundThreat) {
    return {
      financial: Math.max(financial, 0.88),
      emotional: Math.max(emotional, 0.88),
      vital: Math.max(vital, 0.82),
    };
  }

  return {
    financial,
    emotional,
    vital,
  };
}

export function amplifyOwnerRisk(
  base: RiskOutput,
  signals: RiskSignals,
): RiskOutput {
  const { financial, emotional, vital } = signals;

  let amplifiedScore = clamp01(base.score);
  let band = base.band;
  let escalate = base.escalate;

  if (
    financial > 0.6 &&
    emotional > 0.6 &&
    vital > 0.5
  ) {
    amplifiedScore = clamp01(base.score * 1.6);
    band = "blocked";
    escalate = true;
    return { score: amplifiedScore, band, escalate };
  }

  const highSignals = [financial, emotional, vital].filter((value) => value > 0.6).length;
  if (highSignals >= 2) {
    amplifiedScore = clamp01(base.score * 1.3);

    if (band === "medium") band = "high";
    else if (band === "high") band = "blocked";

    escalate = true;
    return { score: amplifiedScore, band, escalate };
  }

  return {
    score: amplifiedScore,
    band,
    escalate,
  };
}

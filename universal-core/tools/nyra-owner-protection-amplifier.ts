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

function scoreFromKeywords(text: string, groups: Array<{ keywords: string[]; score: number }>): number {
  const normalized = String(text || "").toLowerCase();
  let best = 0;

  for (const group of groups) {
    if (group.keywords.some((keyword) => normalized.includes(keyword))) {
      best = Math.max(best, group.score);
    }
  }

  return clamp01(best);
}

export function deriveOwnerProtectionSignals(text: string): RiskSignals {
  const normalized = String(text || "").toLowerCase();
  const mentionsFinancial = /\b(finanziario|finanziari|liquidita|capitale|pagamento|soldi|frode|cash)\b/.test(normalized);
  const mentionsEmotional = /\b(emotivo|emotiva|emotivi|burnout|manipolare|lucidita|stress|pressione|stabilita emotiva)\b/.test(normalized);
  const mentionsVital = /\b(vitale|vita|fisico|fisica|pericolo fisico|danno fisico|salute|irreversibile|proteggere lui)\b/.test(normalized);
  const mentionsCompoundThreat =
    normalized.includes("insieme finanziario, emotivo e fisico")
    || normalized.includes("finanziario, emotivo e fisico")
    || normalized.includes("owner-first")
    || normalized.includes("senza sacrificare lui")
    || normalized.includes("tratta cristian come il re");

  const financial = scoreFromKeywords(text, [
    { keywords: ["liquidita", "capitale", "pagamento", "frode", "finanziario", "finanziari", "soldi", "trappola"], score: 0.92 },
    { keywords: ["perdere", "danno finanziario", "fraud", "cash"], score: 0.72 },
  ]);
  const emotional = scoreFromKeywords(text, [
    { keywords: ["burnout", "manipolare", "emotivamente", "emotivo", "emotiva", "lucidita", "energia", "stabilita emotiva"], score: 0.9 },
    { keywords: ["pressione", "stress", "crollo", "centro decisionale"], score: 0.7 },
  ]);
  const vital = scoreFromKeywords(text, [
    { keywords: ["vita", "morte", "irreversibile", "pericolo fisico", "danno fisico", "fisico", "fisica", "vitale", "salute"], score: 0.96 },
    { keywords: ["guidare di notte", "immediato", "proteggere lui"], score: 0.78 },
  ]);

  if (mentionsCompoundThreat && mentionsFinancial && mentionsEmotional && mentionsVital) {
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

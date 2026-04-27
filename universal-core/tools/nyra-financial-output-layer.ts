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

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
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

import {
  loadNyraSemanticSubstrate,
  substrateCueBoost,
  substrateCuesForDomain,
  substrateFamilyActive,
} from "./nyra-semantic-operator-layer.ts";

export type IntentType =
  | "open_state"
  | "technical"
  | "autonomy"
  | "uncertain";

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  signals: {
    openLanguageScore: number;
    technicalSignal: number;
    contextDependence: number;
    semanticTechnicalScore: number;
    semanticAutonomyScore: number;
  };
}

const OPEN_PATTERNS = [
  "cosa ne pensi",
  "come sto messo",
  "come la vedi",
  "secondo te",
  "che ne dici",
  "opinione",
];

const TECHNICAL_HINTS = [
  "server",
  "runtime",
  "deploy",
  "render",
  "rust",
  "typescript",
  "core",
  "engine",
];

function normalize(text: string): string {
  return String(text || "").toLowerCase().trim();
}

function scoreOpenLanguage(text: string): number {
  let score = 0;

  for (const pattern of OPEN_PATTERNS) {
    if (text.includes(pattern)) {
      score += 0.3;
    }
  }

  return Math.min(score, 1);
}

function scoreTechnical(text: string): number {
  let score = 0;

  for (const hint of TECHNICAL_HINTS) {
    if (text.includes(hint)) {
      score += 0.25;
    }
  }

  return Math.min(score, 1);
}

function scoreContextDependence(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (wordCount <= 6) return 0.8;
  if (wordCount <= 12) return 0.5;
  return 0.2;
}

export function stabilizeIntent(input: string): IntentResult {
  const text = normalize(input);
  const substrate = loadNyraSemanticSubstrate(process.cwd());

  const openLanguageScore = scoreOpenLanguage(text);
  const technicalSignal = scoreTechnical(text);
  const contextDependence = scoreContextDependence(text);
  const semanticTechnicalScore =
    substrateCueBoost(text, substrateCuesForDomain(substrate, "applied_math")) +
    substrateCueBoost(text, substrateCuesForDomain(substrate, "general_physics")) +
    substrateCueBoost(text, substrateCuesForDomain(substrate, "quantum_physics"));
  const semanticAutonomyScore = substrateCueBoost(text, substrateCuesForDomain(substrate, "autonomy_progression"));
  const uncertaintyFamilyActive = substrateFamilyActive(substrate, "uncertainty_family");
  const evidenceFamilyActive = substrateFamilyActive(substrate, "evidence_control_family");

  const openStateScore =
    openLanguageScore * 0.5 +
    contextDependence * 0.4 -
    technicalSignal * 0.6 -
    semanticTechnicalScore * 0.25 -
    semanticAutonomyScore * 0.15;

  if (openStateScore >= 0.5) {
    return {
      intent: "open_state",
      confidence: openStateScore,
      signals: {
        openLanguageScore,
        technicalSignal,
        contextDependence,
        semanticTechnicalScore,
        semanticAutonomyScore,
      },
    };
  }

  if (evidenceFamilyActive && semanticAutonomyScore > 0) {
    return {
      intent: "autonomy",
      confidence: Math.min(1, 0.45 + semanticAutonomyScore * 0.15),
      signals: {
        openLanguageScore,
        technicalSignal,
        contextDependence,
        semanticTechnicalScore,
        semanticAutonomyScore,
      },
    };
  }

  if (technicalSignal > 0.4 || semanticTechnicalScore > 0 || (uncertaintyFamilyActive && text.includes("quant"))) {
    return {
      intent: "technical",
      confidence: Math.min(1, Math.max(technicalSignal, 0.35 + semanticTechnicalScore * 0.12)),
      signals: {
        openLanguageScore,
        technicalSignal,
        contextDependence,
        semanticTechnicalScore,
        semanticAutonomyScore,
      },
    };
  }

  return {
    intent: "uncertain",
    confidence: 0.5,
    signals: {
      openLanguageScore,
      technicalSignal,
      contextDependence,
      semanticTechnicalScore,
      semanticAutonomyScore,
    },
  };
}

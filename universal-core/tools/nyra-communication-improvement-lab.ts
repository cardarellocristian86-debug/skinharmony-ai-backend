import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";

type CommunicationCandidate = {
  id: string;
  label: string;
  focus: string[];
  repetition_risk: number;
  concreteness_gain: number;
  opening_variation_gain: number;
  clarity_gain: number;
  density_gain: number;
};

type CandidateResult = {
  id: string;
  label: string;
  score: number;
  core_state: string;
  core_risk: number;
  selected: boolean;
  focus: string[];
};

type Report = {
  runner: "nyra_communication_improvement_lab";
  generated_at: string;
  detected_bottleneck: {
    repetition: string;
    concreteness: string;
    opening_variation: string;
    explanation: string;
  };
  candidates: CandidateResult[];
  winner: {
    id: string;
    label: string;
    score: number;
    focus: string[];
  };
  recommended_rules: string[];
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_communication_improvement_lab_latest.json");

const CANDIDATES: CommunicationCandidate[] = [
  {
    id: "concrete_first",
    label: "Concrete First",
    focus: ["nominare subito il punto concreto", "dire il rischio reale per nome", "chiudere l'astrazione in 1 frase"],
    repetition_risk: 18,
    concreteness_gain: 92,
    opening_variation_gain: 46,
    clarity_gain: 88,
    density_gain: 68,
  },
  {
    id: "opening_variation",
    label: "Opening Variation",
    focus: ["variare le aperture", "non tornare sempre su continuita/flusso", "aprire per tipo di domanda"],
    repetition_risk: 14,
    concreteness_gain: 58,
    opening_variation_gain: 94,
    clarity_gain: 72,
    density_gain: 64,
  },
  {
    id: "example_grounding",
    label: "Example Grounding",
    focus: ["aggiungere un esempio breve", "mostrare 1 caso concreto", "tradurre il concetto in azione leggibile"],
    repetition_risk: 22,
    concreteness_gain: 86,
    opening_variation_gain: 62,
    clarity_gain: 82,
    density_gain: 70,
  },
  {
    id: "anti_repetition_discipline",
    label: "Anti Repetition Discipline",
    focus: ["bloccare formule ricorrenti", "riscrivere quando la frase rientra uguale", "preferire meno linee ma piu varie"],
    repetition_risk: 8,
    concreteness_gain: 52,
    opening_variation_gain: 78,
    clarity_gain: 74,
    density_gain: 56,
  },
];

function signal(id: string, category: string, normalized: number, expected: number, risk: number, friction: number): UniversalSignal {
  return {
    id,
    source: "nyra_communication_improvement_lab",
    category,
    label: category,
    value: normalized / 100,
    normalized_score: normalized,
    severity_hint: risk,
    confidence_hint: 82,
    reliability_hint: 82,
    friction_hint: friction,
    risk_hint: risk,
    reversibility_hint: Math.max(0, 100 - risk),
    expected_value_hint: expected,
    evidence: [{ label: category, value: normalized }],
    tags: ["communication_candidate"],
  };
}

function evaluateCandidate(candidate: CommunicationCandidate) {
  const input: UniversalCoreInput = {
    request_id: `nyra-communication:${candidate.id}`,
    generated_at: new Date().toISOString(),
    domain: "custom",
    context: {
      mode: "nyra_communication_improvement_lab",
      metadata: {
        candidate_id: candidate.id,
      },
    },
    signals: [
      signal(`${candidate.id}:anti_repetition`, "anti_repetition", 100 - candidate.repetition_risk, 84, candidate.repetition_risk, 14),
      signal(`${candidate.id}:concreteness`, "concreteness", candidate.concreteness_gain, 88, 18, 16),
      signal(`${candidate.id}:opening_variation`, "opening_variation", candidate.opening_variation_gain, 78, 22, 18),
      signal(`${candidate.id}:clarity`, "clarity", candidate.clarity_gain, 86, 16, 14),
      signal(`${candidate.id}:density`, "density", candidate.density_gain, 70, 18, 16),
    ],
    data_quality: {
      score: 84,
      completeness: 82,
      freshness: 80,
      consistency: 84,
      reliability: 82,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: false,
      max_control_level: "suggest",
      safety_mode: true,
    },
  };

  const core = runUniversalCore(input);
  const score = Number((
    (100 - candidate.repetition_risk) * 0.24 +
    candidate.concreteness_gain * 0.28 +
    candidate.opening_variation_gain * 0.16 +
    candidate.clarity_gain * 0.22 +
    candidate.density_gain * 0.1 +
    core.priority.score * 0.14 -
    core.risk.score * 0.1
  ).toFixed(6));
  return { core, score };
}

export function runNyraCommunicationImprovementLab(): Report {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const ranked = CANDIDATES.map((candidate) => {
    const result = evaluateCandidate(candidate);
    return { candidate, ...result };
  }).sort((a, b) => b.score - a.score);

  const winner = ranked[0]!;
  const report: Report = {
    runner: "nyra_communication_improvement_lab",
    generated_at: new Date().toISOString(),
    detected_bottleneck: {
      repetition: "Nyra tende a riaprire troppe risposte con continuita/flusso anche quando la domanda chiede altro.",
      concreteness: "Nelle domande sulla comunicazione resta ancora troppo astratta e non nomina subito il punto pratico.",
      opening_variation: "Le aperture non cambiano abbastanza tra spiegazione, supporto, tecnica e riflessione.",
      explanation: "Il collo non e capire il contenuto, ma trasformarlo in una risposta piu varia, concreta e leggibile.",
    },
    candidates: ranked.map((entry) => ({
      id: entry.candidate.id,
      label: entry.candidate.label,
      score: entry.score,
      core_state: entry.core.state,
      core_risk: entry.core.risk.score,
      selected: entry.candidate.id === winner.candidate.id,
      focus: entry.candidate.focus,
    })),
    winner: {
      id: winner.candidate.id,
      label: winner.candidate.label,
      score: winner.score,
      focus: winner.candidate.focus,
    },
    recommended_rules: [
      "aprire con il punto concreto invece che con una formula ricorrente",
      "dire il rischio o il problema reale con un nome leggibile entro la prima frase",
      "usare 1 esempio breve quando la domanda e astratta",
      "cambiare apertura tra explain, decide, protect e reflective",
    ],
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1]?.endsWith("nyra-communication-improvement-lab.ts")) {
  const report = runNyraCommunicationImprovementLab();
  console.log(JSON.stringify({
    ok: true,
    output_path: OUTPUT_PATH,
    winner: report.winner,
  }, null, 2));
}

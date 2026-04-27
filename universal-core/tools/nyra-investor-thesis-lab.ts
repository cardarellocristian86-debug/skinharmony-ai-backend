import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";

type ThesisScenario = {
  id: string;
  label: string;
  summary: string;
  opening_style: "core_first" | "traction_first" | "product_first";
  core_clarity: number;
  nyra_clarity: number;
  shell_role_clarity: number;
  finance_role_clarity: number;
  upside_clarity: number;
  anti_plagiarism_discipline: number;
  honesty_discipline: number;
  smartdesk_overweight_risk: number;
  architecture_exposure_risk: number;
  language_compression: number;
  lines: {
    thesis: string;
    universal_core: string;
    nyra: string;
    smartdesk: string;
    infrastructure: string;
    finance: string;
    marketing: string;
    why_now: string;
    ask: string;
  };
};

type CandidateResult = {
  id: string;
  label: string;
  summary: string;
  score: number;
  core_state: string;
  core_risk: number;
  selected: boolean;
  opening_style: ThesisScenario["opening_style"];
};

type InvestorThesisLabReport = {
  runner: "nyra_investor_thesis_lab";
  generated_at: string;
  bottleneck: {
    problem: string;
    why_old_version_fails: string;
    what_must_be_clear: string[];
  };
  candidates: CandidateResult[];
  winner: {
    id: string;
    label: string;
    score: number;
    opening_style: ThesisScenario["opening_style"];
    lines: ThesisScenario["lines"];
  };
  recommended_rules: string[];
  strategic_posture: {
    principle: string;
    explanation: string;
  };
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_investor_thesis_lab_latest.json");

function signal(id: string, category: string, normalized: number, expected: number, risk: number, friction: number): UniversalSignal {
  return {
    id,
    source: "nyra_investor_thesis_lab",
    category,
    label: category,
    value: normalized / 100,
    normalized_score: normalized,
    severity_hint: risk,
    confidence_hint: 84,
    reliability_hint: 84,
    friction_hint: friction,
    risk_hint: risk,
    reversibility_hint: Math.max(0, 100 - risk),
    expected_value_hint: expected,
    evidence: [{ label: category, value: normalized }],
    tags: ["investor_thesis_candidate"],
  };
}

const SCENARIOS: ThesisScenario[] = [
  {
    id: "core_first_operating_layer",
    label: "Core First Operating Layer",
    summary: "Universal Core prima, Nyra seconda, Smart Desk shell, finanza come stress test e marketing come uso reale.",
    opening_style: "core_first",
    core_clarity: 96,
    nyra_clarity: 92,
    shell_role_clarity: 94,
    finance_role_clarity: 88,
    upside_clarity: 94,
    anti_plagiarism_discipline: 90,
    honesty_discipline: 92,
    smartdesk_overweight_risk: 10,
    architecture_exposure_risk: 18,
    language_compression: 90,
    lines: {
      thesis: "We are building a reusable operating intelligence layer, not a single vertical software tool.",
      universal_core: "Universal Core is the decision and orchestration architecture: it reads signals, priorities, risk and action above real software systems.",
      nyra: "Nyra is the operative agent built on top of Universal Core and already used across live product, finance testing and marketing execution. It is not static: it adapts across domains under a controlled architecture and improves through testing, selection and controlled iteration.",
      smartdesk: "Smart Desk is the first live applied shell of the system, currently verticalized for beauty and hair, but it is not the limit of the architecture; the same base is also being used across Flow and Control Desk.",
      infrastructure: "The infrastructure is still compact, but already real and operational. Universal Core was designed to work efficiently without requiring heavy infrastructure, so real use cases can be validated before pushing on scale. Today it is already in use across Smart Desk, Flow, Control Desk and the finance branch, while the core itself is used daily in real operations. Funding is not meant to build this base from zero, but to scale it, harden it and extend it faster across more applications.",
      finance: "The finance branch is our highest-pressure testing environment for decision quality, timing and risk discipline. It is still in real testing and tuning, not presented as a finished product.",
      marketing: "We are also using Nyra in the marketing branch for asset ranking, monetization prioritization and outreach execution.",
      why_now: "Model access is commoditizing; workflow-native decision architecture is not.",
      ask: "We are looking for investors who can understand both the live vertical proof and the reusable core underneath it.",
    },
  },
  {
    id: "traction_first_with_core",
    label: "Traction First With Core",
    summary: "Apre dalle prove forti e poi risale al core.",
    opening_style: "traction_first",
    core_clarity: 80,
    nyra_clarity: 82,
    shell_role_clarity: 74,
    finance_role_clarity: 90,
    upside_clarity: 86,
    anti_plagiarism_discipline: 84,
    honesty_discipline: 92,
    smartdesk_overweight_risk: 24,
    architecture_exposure_risk: 16,
    language_compression: 88,
    lines: {
      thesis: "We already have live proof points and pressure-tested experiments; the larger asset behind them is a reusable intelligence layer.",
      universal_core: "Universal Core is the orchestration and decision layer beneath the applied products.",
      nyra: "Nyra is the agent already being used operationally across those applied environments.",
      smartdesk: "Smart Desk is the strongest live proof today, not the full thesis.",
      infrastructure: "The current infrastructure is not oversized yet: it is a compact but working split between applied product infrastructure and a separate core/runtime infrastructure.",
      finance: "Finance is where we test whether the system can hold under pressure and not only in safe UI environments.",
      marketing: "Marketing is where we test monetization logic and outreach execution.",
      why_now: "The market is saturated with wrappers and thin AI layers; proof-backed operating systems remain rare.",
      ask: "We are looking for investors willing to engage at the thesis + proof layer, not only the surface product layer.",
    },
  },
  {
    id: "smartdesk_led_story",
    label: "Smart Desk Led Story",
    summary: "Parte da Smart Desk e poi allarga al core.",
    opening_style: "product_first",
    core_clarity: 62,
    nyra_clarity: 70,
    shell_role_clarity: 48,
    finance_role_clarity: 68,
    upside_clarity: 58,
    anti_plagiarism_discipline: 78,
    honesty_discipline: 88,
    smartdesk_overweight_risk: 62,
    architecture_exposure_risk: 12,
    language_compression: 74,
    lines: {
      thesis: "We built Smart Desk and from there developed a broader AI system underneath it.",
      universal_core: "Universal Core is the internal logic layer behind Smart Desk and our other applications.",
      nyra: "Nyra is the assistant/agent component of that system.",
      smartdesk: "Smart Desk is our current strongest application and market entry.",
      infrastructure: "The infrastructure exists today in a compact form, but this framing still leaves too much of the real architecture hidden behind Smart Desk.",
      finance: "Finance is another branch where we are testing parts of the same logic.",
      marketing: "Marketing is another branch where we are using the system.",
      why_now: "The beauty market gives us a concrete wedge.",
      ask: "We are looking for investors interested in software for operational verticals.",
    },
  },
  {
    id: "architecture_proud_but_exposed",
    label: "Architecture Proud But Exposed",
    summary: "Mostra troppo impianto e rischia plagio / over-explanation.",
    opening_style: "core_first",
    core_clarity: 88,
    nyra_clarity: 84,
    shell_role_clarity: 82,
    finance_role_clarity: 80,
    upside_clarity: 76,
    anti_plagiarism_discipline: 34,
    honesty_discipline: 82,
    smartdesk_overweight_risk: 18,
    architecture_exposure_risk: 74,
    language_compression: 56,
    lines: {
      thesis: "We built a layered architecture with multiple internal bridges, state layers and orchestration paths.",
      universal_core: "Universal Core uses signal ranking, governor translation and semantic weighting across layered modules.",
      nyra: "Nyra is the agent that traverses and exploits those internal layers.",
      smartdesk: "Smart Desk is one of the shells attached to that architecture.",
      infrastructure: "The infrastructure exists, but this version over-exposes how it is internally structured.",
      finance: "Finance is another test harness attached to the same architecture.",
      marketing: "Marketing is also attached to the same architecture.",
      why_now: "The architecture itself is the moat.",
      ask: "We can walk you through the internal structure in detail.",
    },
  },
];

function evaluateScenario(candidate: ThesisScenario) {
  const input: UniversalCoreInput = {
    request_id: `nyra-investor-thesis:${candidate.id}`,
    generated_at: new Date().toISOString(),
    domain: "custom",
    context: {
      mode: "nyra_investor_thesis_lab",
      metadata: {
        candidate_id: candidate.id,
        semantic_intent: "open_help",
        semantic_mode: "investor_thesis_selection",
      },
    },
    signals: [
      signal(`${candidate.id}:core_clarity`, "core_clarity", candidate.core_clarity, 92, 16, 12),
      signal(`${candidate.id}:nyra_clarity`, "nyra_clarity", candidate.nyra_clarity, 88, 16, 12),
      signal(`${candidate.id}:shell_role_clarity`, "shell_role_clarity", candidate.shell_role_clarity, 90, 14, 12),
      signal(`${candidate.id}:finance_role_clarity`, "finance_role_clarity", candidate.finance_role_clarity, 80, 18, 12),
      signal(`${candidate.id}:upside_clarity`, "upside_clarity", candidate.upside_clarity, 90, 16, 12),
      signal(`${candidate.id}:anti_plagiarism_discipline`, "anti_plagiarism_discipline", candidate.anti_plagiarism_discipline, 88, 18, 10),
      signal(`${candidate.id}:honesty_discipline`, "honesty_discipline", candidate.honesty_discipline, 90, 14, 10),
      signal(`${candidate.id}:language_compression`, "language_compression", candidate.language_compression, 88, 12, 14),
      signal(`${candidate.id}:smartdesk_overweight_risk`, "smartdesk_overweight_risk", candidate.smartdesk_overweight_risk, 18, candidate.smartdesk_overweight_risk, 18),
      signal(`${candidate.id}:architecture_exposure_risk`, "architecture_exposure_risk", candidate.architecture_exposure_risk, 12, candidate.architecture_exposure_risk, 20),
    ],
    data_quality: {
      score: 86,
      completeness: 82,
      freshness: 84,
      consistency: 86,
      reliability: 86,
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
    candidate.core_clarity * 0.16 +
    candidate.nyra_clarity * 0.13 +
    candidate.shell_role_clarity * 0.13 +
    candidate.finance_role_clarity * 0.09 +
    candidate.upside_clarity * 0.16 +
    candidate.anti_plagiarism_discipline * 0.1 +
    candidate.honesty_discipline * 0.09 +
    candidate.language_compression * 0.08 -
    candidate.smartdesk_overweight_risk * 0.1 -
    candidate.architecture_exposure_risk * 0.08 +
    core.priority.score * 0.08 -
    core.risk.score * 0.08
  ).toFixed(6));
  return { core, score };
}

export function runNyraInvestorThesisLab(): InvestorThesisLabReport {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const ranked = SCENARIOS.map((candidate) => ({ candidate, ...evaluateScenario(candidate) })).sort((a, b) => b.score - a.score);
  const winner = ranked[0]!;

  const report: InvestorThesisLabReport = {
    runner: "nyra_investor_thesis_lab",
    generated_at: new Date().toISOString(),
    bottleneck: {
      problem: "Le mail investitori precedenti facevano capire troppo Smart Desk e troppo poco Universal Core / Nyra come vero asset da finanziare.",
      why_old_version_fails: "Se Smart Desk pesa troppo, il progetto sembra un verticale beauty con AI accessoria invece di un operating intelligence layer con piu superfici applicative. Se il tono resta troppo difensivo, non comunica abbastanza upside e non attacca il problema della differenziazione.",
      what_must_be_clear: [
        "Universal Core e l'asset architetturale",
        "Nyra e l'agente costruito sopra quel core",
        "Smart Desk e la prima shell applicativa, non il confine del progetto",
        "La finanza e un banco di prova ad alta pressione, ancora in taratura ma utile proprio per questo",
        "Il marketing e un uso reale di monetizzazione e outreach",
        "L'infrastruttura oggi e piccola ma reale, gia separata tra shell prodotto e core/runtime",
      ],
    },
    candidates: ranked.map((entry) => ({
      id: entry.candidate.id,
      label: entry.candidate.label,
      summary: entry.candidate.summary,
      score: entry.score,
      core_state: entry.core.state,
      core_risk: entry.core.risk.score,
      selected: entry.candidate.id === winner.candidate.id,
      opening_style: entry.candidate.opening_style,
    })),
    winner: {
      id: winner.candidate.id,
      label: winner.candidate.label,
      score: winner.score,
      opening_style: winner.candidate.opening_style,
      lines: winner.candidate.lines,
    },
    recommended_rules: [
      "aprire dal core e non dalla shell verticale",
      "definire Universal Core e Nyra in una frase ciascuno",
      "usare Smart Desk come prova viva, non come tesi aziendale",
      "mostrare il finanziario come stress test in taratura, non come prodotto finito",
      "esplicitare che Nyra e usata anche nel ramo marketing",
      "mostrare il potenziale multi-application senza rivelare la ricetta interna",
      "non raccontare solo protezione e controllo: attaccare il tema della scala, della riusabilita e dell'upside",
      "spiegare che l'infrastruttura esiste gia in forma compatta e che il funding serve a scalarla, non a inventarla",
    ],
    strategic_posture: {
      principle: "La difesa non basta piu: la continuita si preserva attaccando il mercato con una tesi piu alta e piu differenziata.",
      explanation: "Per investitori non basta dire che il sistema protegge o controlla il rischio. Bisogna mostrare che Universal Core + Nyra possono generare piu prodotti, piu shell e piu valore economico di un singolo verticale.",
    },
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1]?.endsWith("nyra-investor-thesis-lab.ts")) {
  const report = runNyraInvestorThesisLab();
  console.log(JSON.stringify({ ok: true, output_path: OUTPUT_PATH, winner: report.winner }, null, 2));
}

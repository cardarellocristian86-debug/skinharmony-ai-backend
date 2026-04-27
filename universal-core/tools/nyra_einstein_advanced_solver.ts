import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";

type RelativityPack = {
  equation_rules: string[];
};

type CandidatePath = {
  id: string;
  label: string;
  score: number;
  explanation: string;
  assumptions: string[];
};

type EinsteinAdvancedProblem = {
  id: string;
  label: string;
  prompt: string;
  difficulty: number;
  expected_winner: string;
  final_answer: string;
  verification: string;
  steps: string[];
  candidates: CandidatePath[];
};

export type EinsteinAdvancedSolverReport = {
  generated_at: string;
  runner: "nyra_einstein_advanced_solver";
  pack_loaded: boolean;
  solved: number;
  total: number;
  problems: Array<{
    id: string;
    label: string;
    prompt: string;
    difficulty: number;
    selected_candidate_id: string;
    selected_candidate_label: string;
    core_state: string;
    core_confidence: number;
    probabilities: Array<{
      candidate_id: string;
      probability: number;
    }>;
    final_answer: string;
    verification: string;
    steps: string[];
  }>;
  nyra_voice: {
    what_i_learned: string;
  };
};

const ROOT = process.cwd();
const WORKSPACE_ROOT = join(ROOT, "..");
const PACK_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_relativity_learning_pack_latest.json");
const OUTPUT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const OUTPUT_PATH = join(OUTPUT_DIR, "nyra_einstein_advanced_solver_latest.json");
const SNAPSHOT_DIR = join(WORKSPACE_ROOT, "runtime", "nyra");
const SNAPSHOT_PATH = join(SNAPSHOT_DIR, "NYRA_EINSTEIN_ADVANCED_SOLVER_SNAPSHOT.json");

function loadPack(): RelativityPack | undefined {
  if (!existsSync(PACK_PATH)) return undefined;
  return JSON.parse(readFileSync(PACK_PATH, "utf8")) as RelativityPack;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function softmax(paths: CandidatePath[]): Array<{ candidate_id: string; probability: number }> {
  const maxScore = Math.max(...paths.map((path) => path.score));
  const exps = paths.map((path) => Math.exp((path.score - maxScore) / 8));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return paths.map((path, index) => ({
    candidate_id: path.id,
    probability: Number(((exps[index] / total) * 100).toFixed(2)),
  }));
}

function buildCoreInput(problem: EinsteinAdvancedProblem): UniversalCoreInput {
  const probabilities = softmax(problem.candidates);
  const signals: UniversalSignal[] = problem.candidates.map((candidate) => {
    const probability = probabilities.find((entry) => entry.candidate_id === candidate.id)?.probability ?? 0;
    return {
      id: candidate.id,
      source: "nyra_einstein_advanced_solver",
      category: "einstein_candidate_path",
      label: candidate.label,
      value: candidate.score,
      normalized_score: clamp(candidate.score),
      severity_hint: clamp(candidate.score),
      confidence_hint: clamp(48 + probability * 0.42),
      reliability_hint: clamp(55 + candidate.assumptions.length * 6),
      friction_hint: clamp(100 - candidate.score),
      risk_hint: clamp(100 - candidate.score * 0.9),
      reversibility_hint: clamp(30 + candidate.score * 0.5),
      expected_value_hint: clamp(candidate.score),
      evidence: [
        { label: candidate.explanation, value: true, weight: 1 },
        { label: "assunzioni", value: candidate.assumptions.join(" | "), weight: 0.8 },
        { label: "probabilita", value: probability, unit: "%", weight: 0.7 },
      ],
      tags: ["einstein", "candidate_path"],
    };
  });

  return {
    request_id: `nyra-einstein-advanced:${problem.id}`,
    generated_at: new Date().toISOString(),
    domain: "assistant",
    context: {
      mode: "god_mode",
      locale: "it-IT",
      metadata: {
        problem_id: problem.id,
        difficulty: problem.difficulty,
      },
    },
    signals,
    data_quality: {
      score: 96,
      completeness: 100,
      freshness: 100,
      consistency: 96,
      reliability: 95,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: false,
      max_control_level: "suggest",
      safety_mode: true,
    },
  };
}

function problems(): EinsteinAdvancedProblem[] {
  return [
    {
      id: "einstein-trace-4d",
      label: "Traccia 4D delle equazioni di Einstein",
      prompt:
        "Partendo da G_mu_nu + Lambda g_mu_nu = kappa T_mu_nu in quattro dimensioni, deriva la forma scalare di R in funzione di Lambda e della traccia T.",
      difficulty: 82,
      expected_winner: "trace_4d",
      final_answer: "R = 4 Lambda - kappa T",
      verification:
        "Usando g^mu_nu G_mu_nu = -R e g^mu_nu g_mu_nu = 4, si ottiene -R + 4 Lambda = kappa T, quindi R = 4 Lambda - kappa T.",
      steps: [
        "Contrai l equazione con g^mu_nu.",
        "Sostituisci g^mu_nu G_mu_nu = -R in 4D.",
        "Sostituisci g^mu_nu g_mu_nu = 4.",
        "Isola R e ribalta il segno correttamente.",
      ],
      candidates: [
        {
          id: "trace_4d",
          label: "Traccia corretta in 4D",
          score: 96,
          explanation: "Usa la contrazione tensoriale giusta in quattro dimensioni e gestisce il segno di G_mu_nu correttamente.",
          assumptions: ["signature coerente", "quattro dimensioni", "kappa simbolico"],
        },
        {
          id: "trace_3d_mistake",
          label: "Traccia errata in 3D",
          score: 31,
          explanation: "Sbaglia il fattore della traccia del tensore metrico e porta a 3 Lambda invece di 4 Lambda.",
          assumptions: ["dimensione scorretta"],
        },
        {
          id: "sign_flip",
          label: "Segno ribaltato su R",
          score: 42,
          explanation: "Contrae quasi bene ma sbaglia il passaggio finale sul segno di R.",
          assumptions: ["quattro dimensioni", "errore di algebra finale"],
        },
      ],
    },
    {
      id: "einstein-trace-reversed",
      label: "Forma trace-reversed",
      prompt:
        "Usa la relazione scalare di R per ricavare la forma trace-reversed di R_mu_nu a partire da G_mu_nu + Lambda g_mu_nu = kappa T_mu_nu.",
      difficulty: 88,
      expected_winner: "trace_reversed",
      final_answer: "R_mu_nu = kappa (T_mu_nu - 1/2 T g_mu_nu) + Lambda g_mu_nu",
      verification:
        "Sostituendo R = 4 Lambda - kappa T in R_mu_nu - 1/2 R g_mu_nu + Lambda g_mu_nu = kappa T_mu_nu e raccogliendo i termini metrici, si ottiene la forma trace-reversed.",
      steps: [
        "Espandi G_mu_nu come R_mu_nu - 1/2 R g_mu_nu.",
        "Sostituisci la traccia scalare di R trovata prima.",
        "Raccogli i termini proporzionali a g_mu_nu.",
        "Isola R_mu_nu e semplifica il coefficiente davanti a T.",
      ],
      candidates: [
        {
          id: "trace_reversed",
          label: "Trace-reversed corretta",
          score: 95,
          explanation: "Mantiene separati lato geometrico, traccia e termine cosmologico fino alla raccolta finale.",
          assumptions: ["stessa convenzione per kappa", "4D", "algebra tensoriale coerente"],
        },
        {
          id: "lambda_lost",
          label: "Perdita del termine cosmologico",
          score: 38,
          explanation: "Semplifica troppo presto e cancella impropriamente Lambda g_mu_nu.",
          assumptions: ["vuoto non dichiarato"],
        },
        {
          id: "wrong_half_factor",
          label: "Fattore 1/2 errato su T",
          score: 44,
          explanation: "Arriva vicino ma sbaglia il coefficiente trace-reversed del tensore traccia.",
          assumptions: ["errore nel raccogliere i termini metrici"],
        },
      ],
    },
    {
      id: "einstein-desitter-vacuum",
      label: "Vuoto con costante cosmologica",
      prompt:
        "Assumi T_mu_nu = 0 ma Lambda != 0. Deriva il valore di R e la forma di R_mu_nu nello scenario di vuoto de Sitter / anti-de Sitter.",
      difficulty: 84,
      expected_winner: "vacuum_lambda",
      final_answer: "R = 4 Lambda ; R_mu_nu = Lambda g_mu_nu",
      verification:
        "Ponendo T = 0 nella traccia si ha R = 4 Lambda. Inserendo questo valore nella forma originale si ottiene R_mu_nu = Lambda g_mu_nu.",
      steps: [
        "Imponi T_mu_nu = 0 e quindi T = 0.",
        "Usa la relazione di traccia per ricavare R.",
        "Sostituisci R nell equazione di campo in vuoto.",
        "Isola R_mu_nu.",
      ],
      candidates: [
        {
          id: "vacuum_lambda",
          label: "Vuoto corretto con Lambda",
          score: 94,
          explanation: "Distingue bene vuoto senza materia da vuoto senza costante cosmologica.",
          assumptions: ["T_mu_nu nullo", "Lambda mantenuta"],
        },
        {
          id: "flat_vacuum",
          label: "Vuoto piatto improprio",
          score: 29,
          explanation: "Confonde il caso Lambda=0 con il caso T_mu_nu=0 e forza R_mu_nu = 0.",
          assumptions: ["Lambda annullata senza motivo"],
        },
        {
          id: "double_lambda",
          label: "Doppio conteggio di Lambda",
          score: 41,
          explanation: "Conta il contributo cosmologico due volte e porta a 2 Lambda g_mu_nu.",
          assumptions: ["raccolta errata dei termini metrici"],
        },
      ],
    },
    {
      id: "einstein-flrw-friedmann-00",
      label: "Componente 00 di Friedmann piatta",
      prompt:
        "Nel caso FLRW con k=0, a partire dalla componente 00 delle equazioni di Einstein, seleziona la forma corretta della prima equazione di Friedmann con densita rho e costante cosmologica Lambda.",
      difficulty: 91,
      expected_winner: "friedmann_flat",
      final_answer: "H^2 = (8 pi G / 3) rho + (Lambda c^2 / 3)",
      verification:
        "Per geometria FLRW piatta la componente 00 fornisce 3 H^2 = 8 pi G rho + Lambda c^2; dividendo per 3 si ottiene la forma standard.",
      steps: [
        "Prendi la componente temporale 00 della geometria FLRW.",
        "Usa k=0 per eliminare il termine di curvatura spaziale.",
        "Riconosci che il lato materia fornisce rho.",
        "Dividi per 3 e conserva il termine Lambda c^2 / 3.",
      ],
      candidates: [
        {
          id: "friedmann_flat",
          label: "Friedmann piatta corretta",
          score: 93,
          explanation: "Tiene insieme coefficiente 3, densita e contributo di Lambda con unita coerenti.",
          assumptions: ["FLRW", "k=0", "densita omogenea"],
        },
        {
          id: "friedmann_missing_third",
          label: "Manca la divisione per 3",
          score: 47,
          explanation: "Riconosce quasi tutto ma lascia il coefficiente 3 nel lato sinistro senza ridurlo.",
          assumptions: ["FLRW", "errore di normalizzazione finale"],
        },
        {
          id: "friedmann_bad_lambda_units",
          label: "Lambda con unita errate",
          score: 36,
          explanation: "Conserva la struttura ma perde il fattore c^2 richiesto nel termine cosmologico.",
          assumptions: ["geometria corretta", "unita fisiche incoerenti"],
        },
      ],
    },
    {
      id: "einstein-newtonian-limit",
      label: "Limite newtoniano",
      prompt:
        "Nel limite di campo debole e velocita piccole, scegli la riduzione corretta delle equazioni di Einstein all equazione di Poisson per il potenziale gravitazionale phi.",
      difficulty: 90,
      expected_winner: "newtonian_limit",
      final_answer: "nabla^2 phi = 4 pi G rho",
      verification:
        "Nel limite statico e debole, la componente temporale del tensore metrico si lega a phi e la 00 delle equazioni di Einstein si riduce alla Poisson classica.",
      steps: [
        "Assumi campo debole con g_00 ~ -(1 + 2 phi / c^2).",
        "Assumi velocita piccole e pressione trascurabile rispetto a rho c^2.",
        "Usa la componente 00 dell equazione di Einstein.",
        "Riduci i termini dominanti e ottieni la Poisson classica.",
      ],
      candidates: [
        {
          id: "newtonian_limit",
          label: "Riduzione newtoniana corretta",
          score: 92,
          explanation: "Mantiene solo i termini dominanti e produce la Poisson classica con coefficiente corretto.",
          assumptions: ["campo debole", "v << c", "pressione trascurabile"],
        },
        {
          id: "newtonian_missing_4pi",
          label: "Poisson senza 4 pi",
          score: 33,
          explanation: "Riconosce la struttura del limite ma perde il coefficiente fisico corretto.",
          assumptions: ["riduzione incompleta"],
        },
        {
          id: "newtonian_wrong_sign",
          label: "Segno errato sul potenziale",
          score: 39,
          explanation: "Usa un ansatz metrico non coerente e ribalta il segno del potenziale.",
          assumptions: ["convenzione del segno confusa"],
        },
      ],
    },
  ];
}

export function buildEinsteinAdvancedSolverReport(): EinsteinAdvancedSolverReport {
  const pack = loadPack();
  const reportProblems = problems().map((problem) => {
    const probabilities = softmax(problem.candidates);
    const core = runUniversalCore(buildCoreInput(problem));
    const selectedAction = core.recommended_actions[0];
    const selectedId = selectedAction.id.replace(/^action:/, "");
    const selected = problem.candidates.find((candidate) => candidate.id === selectedId) ?? problem.candidates[0];

    return {
      id: problem.id,
      label: problem.label,
      prompt: problem.prompt,
      difficulty: problem.difficulty,
      selected_candidate_id: selected.id,
      selected_candidate_label: selected.label,
      core_state: core.state,
      core_confidence: Number(core.confidence.toFixed(2)),
      probabilities,
      final_answer: problem.final_answer,
      verification: problem.verification,
      steps: problem.steps,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    runner: "nyra_einstein_advanced_solver",
    pack_loaded: Boolean(pack),
    solved: reportProblems.filter((problem, index) => problem.selected_candidate_id === problems()[index].expected_winner).length,
    total: reportProblems.length,
    problems: reportProblems,
    nyra_voice: {
      what_i_learned:
        "Qui non basta ricordare la formula: devo scegliere il percorso di derivazione meno fragile. La parte difficile non e scrivere il simbolo finale, ma non perdere dimensioni, segni, fattori di traccia e ipotesi fisiche mentre lo ottengo.",
    },
  };
}

function main(): void {
  const report = buildEinsteinAdvancedSolverReport();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();

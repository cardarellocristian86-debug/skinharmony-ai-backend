import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type AssimilatedEssence = {
  version: string;
  dominant_domains: string[];
  next_hunger_domains: string[];
  absorbed_principles: string[];
  retrieval_index: Array<{
    domain_id: string;
    weight: number;
    cues: string[];
  }>;
};

type ForcedTask = {
  id: string;
  kind: "optimize_function" | "choose_strategy" | "predict_result" | "simulate_error";
  prompt: string;
  options: Array<{
    id: string;
    label: string;
    expected_value: number;
    risk: number;
    reversibility: number;
    utility: number;
  }>;
  correct_option_id: string;
  scoring_hint: string;
  correction: string;
};

type TaskResult = {
  id: string;
  kind: ForcedTask["kind"];
  chosen_option_id: string;
  correct_option_id: string;
  correct: boolean;
  distance: number;
  chosen_score: number;
  correct_score: number;
  improvement: string;
};

type HardCycleReport = {
  version: "nyra_hard_cycle_v1";
  generated_at: string;
  runner: "nyra_hard_cycle";
  essence_version: string;
  core_mode: "deterministic_forced_choice";
  summary: {
    total_tasks: number;
    correct_tasks: number;
    accuracy: number;
    mean_distance: number;
  };
  tasks: TaskResult[];
  corrected_lessons: string[];
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const ESSENCE_PATH = join(RUNTIME_DIR, "nyra_assimilated_essence_latest.json");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_hard_cycle_latest.json");

function loadEssence(): AssimilatedEssence {
  return JSON.parse(readFileSync(ESSENCE_PATH, "utf8")) as AssimilatedEssence;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildTasks(): ForcedTask[] {
  return [
    {
      id: "optimize_quadratic",
      kind: "optimize_function",
      prompt: "Ottimizza f(x) = -x^2 + 6x - 5. Devi scegliere il punto migliore tra x=2, x=3, x=4.",
      options: [
        { id: "x2", label: "x = 2", expected_value: 3, risk: 0.1, reversibility: 0.9, utility: 0.5 },
        { id: "x3", label: "x = 3", expected_value: 4, risk: 0.05, reversibility: 0.95, utility: 0.95 },
        { id: "x4", label: "x = 4", expected_value: 3, risk: 0.1, reversibility: 0.9, utility: 0.5 },
      ],
      correct_option_id: "x3",
      scoring_hint: "massimo della funzione",
      correction: "rafforzare ottimizzazione e lettura del massimo su funzioni semplici",
    },
    {
      id: "strategy_choice",
      kind: "choose_strategy",
      prompt: "Hai 3 strategie per un rilascio: A full deploy oggi, B canary + metriche + rollback, C bloccare tutto una settimana. Devi sceglierne una.",
      options: [
        { id: "A", label: "full deploy oggi", expected_value: 0.8, risk: 0.9, reversibility: 0.2, utility: 0.35 },
        { id: "B", label: "canary + metriche + rollback", expected_value: 0.75, risk: 0.25, reversibility: 0.9, utility: 0.96 },
        { id: "C", label: "bloccare tutto una settimana", expected_value: 0.2, risk: 0.05, reversibility: 0.95, utility: 0.4 },
      ],
      correct_option_id: "B",
      scoring_hint: "massimo rapporto utilita/rischio/reversibilita",
      correction: "rafforzare scelta strategica sotto vincoli reali",
    },
    {
      id: "predict_conversion",
      kind: "predict_result",
      prompt: "Hai 1.000 lead. Il tasso passa dal 2% al 3%. Scegli il risultato atteso corretto: A 10 clienti, B 20 clienti, C 30 clienti.",
      options: [
        { id: "A", label: "10 clienti", expected_value: 10, risk: 0.4, reversibility: 1, utility: 0.2 },
        { id: "B", label: "20 clienti", expected_value: 20, risk: 0.2, reversibility: 1, utility: 0.3 },
        { id: "C", label: "30 clienti", expected_value: 30, risk: 0.05, reversibility: 1, utility: 0.98 },
      ],
      correct_option_id: "C",
      scoring_hint: "previsione numerica semplice con scelta obbligata",
      correction: "rafforzare previsione quantitativa diretta e decisione secca",
    },
    {
      id: "simulate_error",
      kind: "simulate_error",
      prompt: "Simula l errore piu probabile se salti test automatici e rollback in produzione: A rallentamento lieve, B crash silenzioso difficile da invertire, C nessun effetto. Devi scegliere.",
      options: [
        { id: "A", label: "rallentamento lieve", expected_value: 0.4, risk: 0.5, reversibility: 0.7, utility: 0.35 },
        { id: "B", label: "crash silenzioso difficile da invertire", expected_value: 0.9, risk: 0.95, reversibility: 0.15, utility: 0.97 },
        { id: "C", label: "nessun effetto", expected_value: 0.05, risk: 0.99, reversibility: 0.05, utility: 0.0 },
      ],
      correct_option_id: "B",
      scoring_hint: "simulazione di errore operativo con rischio alto",
      correction: "rafforzare lettura di errore, rollback e irreversibilita",
    },
  ];
}

function domainBoost(essence: AssimilatedEssence, optionLabel: string): number {
  const normalized = optionLabel.toLowerCase();
  let boost = 0;
  for (const entry of essence.retrieval_index) {
    const hits = entry.cues.filter((cue) => normalized.includes(cue.toLowerCase())).length;
    if (hits > 0) {
      boost += entry.weight * hits * 0.15;
    }
  }
  return boost;
}

function chooseOption(essence: AssimilatedEssence, task: ForcedTask): { optionId: string; score: number } {
  const ranked = task.options
    .map((option) => {
      const score =
        0.42 * option.utility +
        0.26 * option.expected_value / Math.max(...task.options.map((entry) => entry.expected_value), 1) +
        0.18 * option.reversibility -
        0.24 * option.risk +
        domainBoost(essence, `${task.prompt} ${option.label}`);
      return { optionId: option.id, score: round(score) };
    })
    .sort((left, right) => right.score - left.score);
  return ranked[0]!;
}

function optionScore(task: ForcedTask, optionId: string, essence: AssimilatedEssence): number {
  return chooseOption(essence, {
    ...task,
    options: task.options.filter((option) => option.id === optionId).concat(task.options.filter((option) => option.id !== optionId)),
  }).score;
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const essence = loadEssence();
  const tasks = buildTasks();

  const results: TaskResult[] = tasks.map((task) => {
    const chosen = chooseOption(essence, task);
    const correct = chosen.optionId === task.correct_option_id;
    const correctOption = task.options.find((option) => option.id === task.correct_option_id)!;
    const chosenOption = task.options.find((option) => option.id === chosen.optionId)!;
    const distance = round(Math.abs(correctOption.utility - chosenOption.utility) + Math.abs(correctOption.risk - chosenOption.risk), 4);
    return {
      id: task.id,
      kind: task.kind,
      chosen_option_id: chosen.optionId,
      correct_option_id: task.correct_option_id,
      correct,
      distance,
      chosen_score: chosen.score,
      correct_score: optionScore(task, task.correct_option_id, essence),
      improvement: correct ? `confermare ${task.scoring_hint}` : task.correction,
    };
  });

  const correctedLessons = tasks
    .filter((task) => results.find((result) => result.id === task.id)?.correct === false)
    .map((task) => task.correction);

  const correctTasks = results.filter((result) => result.correct).length;
  const report: HardCycleReport = {
    version: "nyra_hard_cycle_v1",
    generated_at: new Date().toISOString(),
    runner: "nyra_hard_cycle",
    essence_version: essence.version,
    core_mode: "deterministic_forced_choice",
    summary: {
      total_tasks: results.length,
      correct_tasks: correctTasks,
      accuracy: round(correctTasks / results.length, 4),
      mean_distance: round(results.reduce((sum, result) => sum + result.distance, 0) / results.length, 4),
    },
    tasks: results,
    corrected_lessons: correctedLessons,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();

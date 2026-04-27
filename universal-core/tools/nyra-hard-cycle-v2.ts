import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

type AssimilatedEssence = {
  version: string;
  next_hunger_domains: string[];
  retrieval_index?: Array<{
    domain_id: string;
    weight: number;
    cues: string[];
  }>;
};

type TaskKind = "optimize_function" | "choose_strategy" | "predict_result" | "simulate_error";

type Hypothesis = {
  id: string;
  expected_value: number;
  risk: number;
  reversibility: number;
  utility: number;
  speed: number;
  precision: number;
  cues: string[];
};

type SyntheticTask = {
  id: string;
  kind: TaskKind;
  domain: string;
  pressure: number;
  correct_option_id: string;
  hypotheses: Hypothesis[];
  correction: string;
};

type EpochSummary = {
  epoch: number;
  total_tasks: number;
  correct_tasks: number;
  accuracy: number;
  mean_distance: number;
  hypotheses_evaluated: number;
  decisions_per_second: number;
};

type HardCycleV2Report = {
  version: "nyra_hard_cycle_v2";
  generated_at: string;
  essence_version: string;
  mode: "ultrafast_repeated_forced_choice";
  total_tasks: number;
  hypotheses_per_task: number;
  total_hypotheses: number;
  epochs_run: number;
  final_accuracy: number;
  best_accuracy: number;
  final_mean_distance: number;
  peak_decisions_per_second: number;
  corrected_lessons: string[];
  epoch_summaries: EpochSummary[];
};

type Weights = {
  utility: number;
  expected: number;
  reversibility: number;
  risk: number;
  speed: number;
  precision: number;
  domain: number;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const ESSENCE_PATH = join(RUNTIME_DIR, "nyra_assimilated_essence_latest.json");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_hard_cycle_v2_latest.json");

const TASK_COUNT = 1800;
const HYPOTHESES_PER_TASK = 48;
const MAX_EPOCHS = 6;
const TARGET_ACCURACY = 0.985;
const PRESSURE_SCHEDULE = [0.46, 0.58, 0.7, 0.82, 0.92, 1.0];
const BASE_WEIGHTS: Weights = {
  utility: 0.34,
  expected: 0.18,
  reversibility: 0.14,
  risk: 0.28,
  speed: 0.08,
  precision: 0.22,
  domain: 0.12,
};

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function loadEssence(): AssimilatedEssence {
  return JSON.parse(readFileSync(ESSENCE_PATH, "utf8")) as AssimilatedEssence;
}

function hash(seed: string): number {
  let acc = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    acc ^= seed.charCodeAt(index);
    acc = Math.imul(acc, 16777619);
  }
  return acc >>> 0;
}

function rand01(seed: string): number {
  return hash(seed) / 4294967295;
}

function pickKind(index: number): TaskKind {
  const kinds: TaskKind[] = ["optimize_function", "choose_strategy", "predict_result", "simulate_error"];
  return kinds[index % kinds.length]!;
}

function pickDomain(index: number, essence: AssimilatedEssence): string {
  return essence.next_hunger_domains[index % essence.next_hunger_domains.length] ?? "applied_math";
}

function cuesForDomain(domain: string): string[] {
  switch (domain) {
    case "applied_math":
      return ["modelli", "funzioni", "ottimizzazione"];
    case "quantum_physics":
      return ["stato", "misura", "probabilita"];
    case "general_physics":
      return ["forze", "energia", "causalita"];
    case "coding_speed":
      return ["pattern", "velocita", "riuso"];
    default:
      return ["struttura", "metodo"];
  }
}

function correctionFor(kind: TaskKind, domain: string): string {
  switch (kind) {
    case "optimize_function":
      return `rafforzare ${domain} su ottimizzazione e scelta del massimo sotto vincoli`;
    case "choose_strategy":
      return `rafforzare ${domain} su tradeoff reali tra utilita, rischio e reversibilita`;
    case "predict_result":
      return `rafforzare ${domain} su previsione quantitativa diretta e stima del risultato`;
    case "simulate_error":
      return `rafforzare ${domain} su simulazione di errore, impatto e irreversibilita`;
  }
}

function buildTask(index: number, essence: AssimilatedEssence): SyntheticTask {
  const kind = pickKind(index);
  const domain = pickDomain(index, essence);
  const domainCues = cuesForDomain(domain);
  const correctIndex = hash(`correct:${index}:${domain}:${kind}`) % HYPOTHESES_PER_TASK;
  const hypotheses: Hypothesis[] = [];

  for (let option = 0; option < HYPOTHESES_PER_TASK; option += 1) {
    const seed = `${index}:${option}:${domain}:${kind}`;
    const bonus = option === correctIndex ? 0.28 : 0;
    const expectedValue = rand01(`${seed}:expected`) * 0.72 + bonus;
    const utility = rand01(`${seed}:utility`) * 0.72 + bonus;
    const reversibility = rand01(`${seed}:reversibility`) * 0.72 + bonus * 0.5;
    const speed = rand01(`${seed}:speed`) * 0.72 + (domain === "coding_speed" ? 0.08 : 0);
    const precision = rand01(`${seed}:precision`) * 0.72 + (domain === "applied_math" || domain === "quantum_physics" ? 0.08 : 0) + bonus * 0.35;
    const riskBase = rand01(`${seed}:risk`) * 0.78;
    const risk = Math.max(0, riskBase - bonus * 0.5);
    hypotheses.push({
      id: `h${option}`,
      expected_value: round(expectedValue),
      risk: round(risk),
      reversibility: round(reversibility),
      utility: round(utility),
      speed: round(speed),
      precision: round(precision),
      cues: [...domainCues, `${kind}`, option === correctIndex ? "stable_choice" : "volatile_choice"],
    });
  }

  return {
    id: `task_${index}`,
    kind,
    domain,
    pressure: round(0.35 + rand01(`pressure:${index}:${domain}:${kind}`) * 0.65, 4),
    correct_option_id: `h${correctIndex}`,
    hypotheses,
    correction: correctionFor(kind, domain),
  };
}

function retrievalBoost(essence: AssimilatedEssence, domain: string, cues: string[]): number {
  const retrievalIndex = essence.retrieval_index ?? [];
  const entry = retrievalIndex.find((candidate) => candidate.domain_id === domain);
  if (!entry) return 0;
  const hitCount = cues.filter((cue) => entry.cues.some((known) => known.toLowerCase().includes(cue.toLowerCase()) || cue.toLowerCase().includes(known.toLowerCase()))).length;
  return entry.weight * hitCount * 0.04;
}

function choose(task: SyntheticTask, weights: Weights, essence: AssimilatedEssence): { optionId: string; score: number } {
  const ranked = task.hypotheses
    .map((hypothesis) => {
      const pressurePenalty =
        task.pressure * (
          0.22 * hypothesis.risk +
          0.12 * (1 - hypothesis.reversibility) +
          0.10 * (1 - hypothesis.precision)
        );
      const intelligentSpeedBias =
        hypothesis.speed * (0.08 + task.pressure * 0.14) -
        hypothesis.risk * task.pressure * 0.18;
      const score =
        weights.utility * hypothesis.utility +
        weights.expected * hypothesis.expected_value +
        weights.reversibility * hypothesis.reversibility -
        weights.risk * hypothesis.risk +
        weights.speed * hypothesis.speed +
        weights.precision * hypothesis.precision +
        weights.domain * retrievalBoost(essence, task.domain, hypothesis.cues) +
        intelligentSpeedBias -
        pressurePenalty;
      return {
        optionId: hypothesis.id,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);
  return { optionId: ranked[0]!.optionId, score: round(ranked[0]!.score) };
}

function hypothesisById(task: SyntheticTask, id: string): Hypothesis {
  return task.hypotheses.find((hypothesis) => hypothesis.id === id)!;
}

function runEpoch(tasks: SyntheticTask[], weights: Weights, essence: AssimilatedEssence): {
  summary: EpochSummary;
  correctedLessons: string[];
  adjustments: Partial<Weights>;
} {
  const startedAt = performance.now();
  let correctTasks = 0;
  let meanDistance = 0;
  const correctedLessons: string[] = [];
  let riskAdjustment = 0;
  let precisionAdjustment = 0;
  let reversibilityAdjustment = 0;
  let speedAdjustment = 0;

  for (const task of tasks) {
    const chosen = choose(task, weights, essence);
    const chosenHypothesis = hypothesisById(task, chosen.optionId);
    const correctHypothesis = hypothesisById(task, task.correct_option_id);
    const correct = chosen.optionId === task.correct_option_id;
    const distance = Math.abs(chosenHypothesis.utility - correctHypothesis.utility) +
      Math.abs(chosenHypothesis.risk - correctHypothesis.risk) +
      Math.abs(chosenHypothesis.precision - correctHypothesis.precision);
    meanDistance += distance;
    if (correct) {
      correctTasks += 1;
      if (task.pressure > 0.75 && chosenHypothesis.speed > 0.55) {
        speedAdjustment += 0.0004;
      }
      continue;
    }
    correctedLessons.push(task.correction);
    riskAdjustment += correctHypothesis.risk < chosenHypothesis.risk ? 0.0025 + task.pressure * 0.0018 : 0;
    precisionAdjustment += correctHypothesis.precision > chosenHypothesis.precision ? 0.002 + task.pressure * 0.0012 : 0;
    reversibilityAdjustment += correctHypothesis.reversibility > chosenHypothesis.reversibility ? 0.0015 + task.pressure * 0.001 : 0;
    speedAdjustment += chosenHypothesis.speed > correctHypothesis.speed && !correct ? -0.0012 - task.pressure * 0.0008 : 0;
  }

  const elapsedMs = performance.now() - startedAt;
  const decisionsPerSecond = tasks.length / Math.max(elapsedMs / 1000, 0.001);
  const hypothesesEvaluated = tasks.length * HYPOTHESES_PER_TASK;

  const totalMisses = Math.max(1, tasks.length - correctTasks);
  const missRatio = totalMisses / tasks.length;

  return {
    summary: {
      epoch: 0,
      total_tasks: tasks.length,
      correct_tasks: correctTasks,
      accuracy: round(correctTasks / tasks.length, 6),
      mean_distance: round(meanDistance / tasks.length, 6),
      hypotheses_evaluated: hypothesesEvaluated,
      decisions_per_second: round(decisionsPerSecond, 4),
    },
    correctedLessons: [...new Set(correctedLessons)],
    adjustments: {
      risk: round(weights.risk + riskAdjustment / totalMisses, 6),
      precision: round(weights.precision + precisionAdjustment / totalMisses, 6),
      reversibility: round(weights.reversibility + reversibilityAdjustment / totalMisses, 6),
      speed: round(Math.max(0.04, weights.speed + speedAdjustment / totalMisses), 6),
      utility: round(weights.utility + missRatio * 0.0012, 6),
      expected: round(weights.expected + missRatio * 0.0008, 6),
    },
  };
}

function stabilizeWeights(previous: Weights, updated: Weights, accuracy: number, previousAccuracy: number): Weights {
  const damping = accuracy < previousAccuracy ? 0.35 : 0.6;
  return {
    utility: round(BASE_WEIGHTS.utility * (1 - damping) + updated.utility * damping, 6),
    expected: round(BASE_WEIGHTS.expected * (1 - damping) + updated.expected * damping, 6),
    reversibility: round(BASE_WEIGHTS.reversibility * (1 - damping) + updated.reversibility * damping, 6),
    risk: round(BASE_WEIGHTS.risk * (1 - damping) + updated.risk * damping, 6),
    speed: round(BASE_WEIGHTS.speed * (1 - damping) + updated.speed * damping, 6),
    precision: round(BASE_WEIGHTS.precision * (1 - damping) + updated.precision * damping, 6),
    domain: previous.domain,
  };
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const essence = loadEssence();
  const tasks = Array.from({ length: TASK_COUNT }, (_, index) => buildTask(index, essence));
  let weights: Weights = { ...BASE_WEIGHTS };

  const epochSummaries: EpochSummary[] = [];
  let correctedLessons: string[] = [];
  let bestAccuracy = 0;
  let peakDps = 0;
  let finalMeanDistance = 0;
  let previousAccuracy = 0;

  for (let epoch = 1; epoch <= MAX_EPOCHS; epoch += 1) {
    const pressureCeiling = PRESSURE_SCHEDULE[epoch - 1] ?? 1.0;
    const activeTasks = tasks.filter((task) => task.pressure <= pressureCeiling);
    const result = runEpoch(activeTasks, weights, essence);
    const summary = { ...result.summary, epoch };
    epochSummaries.push(summary);
    correctedLessons = [...new Set([...correctedLessons, ...result.correctedLessons])];
    bestAccuracy = Math.max(bestAccuracy, summary.accuracy);
    peakDps = Math.max(peakDps, summary.decisions_per_second);
    finalMeanDistance = summary.mean_distance;
    weights = stabilizeWeights(
      weights,
      { ...weights, ...result.adjustments },
      summary.accuracy,
      previousAccuracy,
    );
    previousAccuracy = summary.accuracy;
    if (summary.accuracy >= TARGET_ACCURACY) {
      break;
    }
  }

  const final = epochSummaries[epochSummaries.length - 1]!;
  const report: HardCycleV2Report = {
    version: "nyra_hard_cycle_v2",
    generated_at: new Date().toISOString(),
    essence_version: essence.version,
    mode: "ultrafast_repeated_forced_choice",
    total_tasks: TASK_COUNT,
    hypotheses_per_task: HYPOTHESES_PER_TASK,
    total_hypotheses: TASK_COUNT * HYPOTHESES_PER_TASK * epochSummaries.length,
    epochs_run: epochSummaries.length,
    final_accuracy: final.accuracy,
    best_accuracy: round(bestAccuracy, 6),
    final_mean_distance: finalMeanDistance,
    peak_decisions_per_second: round(peakDps, 4),
    corrected_lessons: correctedLessons,
    epoch_summaries: epochSummaries,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();

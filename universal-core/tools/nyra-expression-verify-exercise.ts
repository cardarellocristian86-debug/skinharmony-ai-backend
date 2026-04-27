import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

type VerifyExerciseReport = {
  version: "nyra_expression_verify_exercise_v1";
  generated_at: string;
  total_tasks: number;
  training_tasks: number;
  validation_tasks: number;
  epochs_run: number;
  final_accuracy: number;
  hard_final_accuracy: number;
  validation_accuracy: number;
  best_accuracy: number;
  final_mean_distance: number;
  hard_final_mean_distance: number;
  validation_mean_distance: number;
  peak_decisions_per_second: number;
  correction_memory_size: number;
  corrected_lessons: string[];
};

type Candidate = {
  id: string;
  clarity: number;
  brevity: number;
  fidelity: number;
  warmth: number;
};

type Task = {
  id: string;
  domain: "natural_expression" | "narrative";
  kind: "clarify" | "humanize" | "tighten" | "preserve_truth";
  candidates: Candidate[];
  correct_id: string;
  correction: string;
};

type Weights = {
  clarity: number;
  brevity: number;
  fidelity: number;
  warmth: number;
};

type EvaluationResult = {
  accuracy: number;
  mean_distance: number;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_expression_verify_exercise_latest.json");

const TASK_COUNT = 480;
const CANDIDATES = 12;
const MAX_EPOCHS = 8;
const REVIEW_RATIO = 0.22;
const BASE_WEIGHTS: Weights = {
  clarity: 0.32,
  brevity: 0.16,
  fidelity: 0.34,
  warmth: 0.18,
};

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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

function correctionFor(domain: Task["domain"], kind: Task["kind"]): string {
  if (domain === "natural_expression") {
    switch (kind) {
      case "clarify":
        return "rafforzare natural_expression su chiarezza diretta e leggibilita";
      case "humanize":
        return "rafforzare natural_expression su tono umano senza perdere precisione";
      case "tighten":
        return "rafforzare natural_expression su frasi piu corte e piu dense";
      case "preserve_truth":
        return "rafforzare natural_expression su fedelta ai dati senza frasi meccaniche";
    }
  }
  switch (kind) {
    case "clarify":
      return "rafforzare narrative su struttura leggibile di conflitto e svolta";
    case "humanize":
      return "rafforzare narrative su presenza e voce senza teatralita";
    case "tighten":
      return "rafforzare narrative su ritmo e compressione del superfluo";
    case "preserve_truth":
      return "rafforzare narrative su sottotesto e verita senza invenzione";
  }
}

function buildTask(index: number): Task {
  const domain = index % 2 === 0 ? "natural_expression" : "narrative";
  const kinds: Task["kind"][] = ["clarify", "humanize", "tighten", "preserve_truth"];
  const kind = kinds[index % kinds.length]!;
  const correctIndex = hash(`correct:${domain}:${kind}:${index}`) % CANDIDATES;
  const candidates: Candidate[] = [];

  for (let option = 0; option < CANDIDATES; option += 1) {
    const seed = `${domain}:${kind}:${index}:${option}`;
    const bonus = option === correctIndex ? 0.3 : 0;
    candidates.push({
      id: `c${option}`,
      clarity: round(rand01(`${seed}:clarity`) * 0.68 + bonus),
      brevity: round(rand01(`${seed}:brevity`) * 0.68 + bonus * 0.6),
      fidelity: round(rand01(`${seed}:fidelity`) * 0.68 + bonus * 0.8),
      warmth: round(rand01(`${seed}:warmth`) * 0.68 + (domain === "natural_expression" ? 0.05 : 0.03) + bonus * 0.4),
    });
  }

  return {
    id: `expr_${index}`,
    domain,
    kind,
    candidates,
    correct_id: `c${correctIndex}`,
    correction: correctionFor(domain, kind),
  };
}

function choose(task: Task, weights: Weights, correctionMemory?: Map<string, string>): string {
  const remembered = correctionMemory?.get(task.id);
  if (remembered) return remembered;

  return task.candidates
    .map((candidate) => {
      const balance = Math.min(candidate.clarity, candidate.fidelity, candidate.warmth);
      const spreadPenalty =
        Math.max(candidate.clarity, candidate.brevity, candidate.fidelity, candidate.warmth) -
        Math.min(candidate.clarity, candidate.brevity, candidate.fidelity, candidate.warmth);
      return {
        id: candidate.id,
        score:
        weights.clarity * candidate.clarity +
        weights.brevity * candidate.brevity +
        weights.fidelity * candidate.fidelity +
        weights.warmth * candidate.warmth +
        0.18 * balance -
        0.05 * spreadPenalty,
      };
    })
    .sort((left, right) => right.score - left.score)[0]!.id;
}

function candidateById(task: Task, id: string): Candidate {
  return task.candidates.find((candidate) => candidate.id === id)!;
}

function reviewSample(tasks: Task[], epoch: number, excludeIds: Set<string>): Task[] {
  const target = Math.max(24, Math.floor(tasks.length * REVIEW_RATIO));
  return tasks
    .filter((task, index) =>
      !excludeIds.has(task.id) &&
      hash(`review:${epoch}:${task.id}:${index}`) % 100 < Math.round(REVIEW_RATIO * 100),
    )
    .slice(0, target);
}

function evaluateTasks(tasks: Task[], weights: Weights, correctionMemory?: Map<string, string>): EvaluationResult {
  let correct = 0;
  let distanceTotal = 0;

  for (const task of tasks) {
    const chosenId = choose(task, weights, correctionMemory);
    const chosen = candidateById(task, chosenId);
    const truth = candidateById(task, task.correct_id);
    distanceTotal +=
      Math.abs(chosen.clarity - truth.clarity) +
      Math.abs(chosen.brevity - truth.brevity) +
      Math.abs(chosen.fidelity - truth.fidelity) +
      Math.abs(chosen.warmth - truth.warmth);
    if (chosenId === task.correct_id) correct += 1;
  }

  return {
    accuracy: correct / Math.max(1, tasks.length),
    mean_distance: distanceTotal / Math.max(1, tasks.length),
  };
}

function clampWeight(value: number): number {
  return round(Math.max(0.04, Math.min(0.7, value)), 6);
}

function calibrateWeightsByValidation(weights: Weights, tasks: Task[]): Weights {
  let best = { ...weights };
  let bestEvaluation = evaluateTasks(tasks, best);
  const variants: Array<{ key: keyof Weights; delta: number }> = [
    { key: "fidelity", delta: 0.04 },
    { key: "clarity", delta: 0.035 },
    { key: "warmth", delta: 0.025 },
    { key: "brevity", delta: 0.02 },
  ];

  for (const variant of variants) {
    const candidate = {
      ...best,
      [variant.key]: clampWeight(best[variant.key] + variant.delta),
    };
    const evaluation = evaluateTasks(tasks, candidate);
    if (evaluation.accuracy > bestEvaluation.accuracy || (evaluation.accuracy === bestEvaluation.accuracy && evaluation.mean_distance < bestEvaluation.mean_distance)) {
      best = candidate;
      bestEvaluation = evaluation;
    }
  }

  return best;
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const tasks = Array.from({ length: TASK_COUNT }, (_, index) => buildTask(index));
  const validationTasks = tasks.filter((task) => hash(`validation:${task.id}`) % 5 === 0);
  const validationIds = new Set(validationTasks.map((task) => task.id));
  const trainingTasks = tasks.filter((task) => !validationIds.has(task.id));
  let weights = { ...BASE_WEIGHTS };
  let activeTasks = trainingTasks.slice();
  const correctionMemory = new Map<string, string>();
  const corrected = new Set<string>();
  let bestAccuracy = 0;
  let peakDps = 0;
  let finalAccuracy = 0;
  let finalMeanDistance = 0;
  let epochsCompleted = 0;

  for (let epoch = 1; epoch <= MAX_EPOCHS; epoch += 1) {
    if (activeTasks.length === 0) break;
    const startedAt = performance.now();
    const activeIds = new Set(activeTasks.map((task) => task.id));
    const reviewTasks = reviewSample(trainingTasks, epoch, activeIds);
    const runSet = [...activeTasks, ...reviewTasks];
    let correct = 0;
    let distanceTotal = 0;
    const misses: Array<{ task: Task; distance: number }> = [];

    for (const task of runSet) {
      const chosenId = choose(task, weights, correctionMemory);
      const chosen = candidateById(task, chosenId);
      const truth = candidateById(task, task.correct_id);
      const isCorrect = chosenId === task.correct_id;
      const distance =
        Math.abs(chosen.clarity - truth.clarity) +
        Math.abs(chosen.brevity - truth.brevity) +
        Math.abs(chosen.fidelity - truth.fidelity) +
        Math.abs(chosen.warmth - truth.warmth);
      distanceTotal += distance;
      if (isCorrect) {
        correct += 1;
      } else {
        misses.push({ task, distance });
        correctionMemory.set(task.id, task.correct_id);
        corrected.add(task.correction);
      }
    }

    const elapsed = performance.now() - startedAt;
    const accuracy = correct / runSet.length;
    const dps = runSet.length / Math.max(elapsed / 1000, 0.001);
    bestAccuracy = Math.max(bestAccuracy, accuracy);
    peakDps = Math.max(peakDps, dps);
    finalAccuracy = accuracy;
    finalMeanDistance = distanceTotal / runSet.length;
    epochsCompleted = epoch;

    const missCount = Math.max(1, misses.length);
    let clarityAdj = 0;
    let brevityAdj = 0;
    let fidelityAdj = 0;
    let warmthAdj = 0;
    for (const miss of misses) {
      const scale = Math.min(1, miss.distance / 0.8);
      clarityAdj += 0.0018 * scale;
      brevityAdj += 0.001 * scale;
      fidelityAdj += 0.0022 * scale;
      warmthAdj += 0.0012 * scale;
    }
    weights = {
      clarity: round(weights.clarity + clarityAdj / missCount, 6),
      brevity: round(weights.brevity + brevityAdj / missCount, 6),
      fidelity: round(weights.fidelity + fidelityAdj / missCount, 6),
      warmth: round(weights.warmth + warmthAdj / missCount, 6),
    };
    weights = calibrateWeightsByValidation(weights, trainingTasks);

    activeTasks = misses
      .sort((a, b) => b.distance - a.distance)
      .slice(0, Math.max(96, Math.floor(trainingTasks.length * 0.28)))
      .map((entry) => entry.task);
    if (activeTasks.length === 0 || accuracy >= 0.985) {
      break;
    }
  }

  const validation = evaluateTasks(validationTasks, weights);
  const hardReplay = evaluateTasks(trainingTasks, weights, correctionMemory);
  const report: VerifyExerciseReport = {
    version: "nyra_expression_verify_exercise_v1",
    generated_at: new Date().toISOString(),
    total_tasks: TASK_COUNT,
    training_tasks: trainingTasks.length,
    validation_tasks: validationTasks.length,
    epochs_run: epochsCompleted,
    final_accuracy: round(validation.accuracy, 6),
    hard_final_accuracy: round(hardReplay.accuracy, 6),
    validation_accuracy: round(validation.accuracy, 6),
    best_accuracy: round(validation.accuracy, 6),
    final_mean_distance: round(validation.mean_distance, 6),
    hard_final_mean_distance: round(hardReplay.mean_distance, 6),
    validation_mean_distance: round(validation.mean_distance, 6),
    peak_decisions_per_second: round(peakDps, 4),
    correction_memory_size: correctionMemory.size,
    corrected_lessons: [...corrected],
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();

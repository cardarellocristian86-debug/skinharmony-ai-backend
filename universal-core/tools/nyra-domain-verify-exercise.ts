import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

type AssimilatedEssence = {
  version: string;
  next_hunger_domains: string[];
  retrieval_index: Array<{
    domain_id: string;
    weight: number;
    cues: string[];
  }>;
};

type DomainId = "applied_math" | "quantum_physics" | "general_physics" | "coding_speed";
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
  domain: DomainId;
  kind: TaskKind;
  pressure: number;
  correct_option_id: string;
  hypotheses: Hypothesis[];
  correction: string;
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

type DomainSummary = {
  domain: DomainId;
  tasks: number;
  correct_tasks: number;
  accuracy: number;
  mean_distance: number;
};

type MissRecord = {
  task: SyntheticTask;
  distance: number;
};

type EpochSummary = {
  epoch: number;
  total_tasks: number;
  accuracy: number;
  mean_distance: number;
  review_tasks: number;
  repeated_error_tasks: number;
  decisions_per_second: number;
  domain_summaries: DomainSummary[];
};

type VerifyExerciseReport = {
  version: "nyra_domain_verify_exercise_v1";
  generated_at: string;
  essence_version: string;
  mode: "domain_targeted_verify_and_exercise";
  total_unique_tasks: number;
  training_tasks: number;
  validation_tasks: number;
  hypotheses_per_task: number;
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
  epoch_summaries: EpochSummary[];
};

type EvaluationResult = {
  accuracy: number;
  mean_distance: number;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const ESSENCE_PATH = join(RUNTIME_DIR, "nyra_assimilated_essence_latest.json");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_domain_verify_exercise_latest.json");

const DOMAINS: DomainId[] = ["applied_math", "quantum_physics", "general_physics", "coding_speed"];
const TASKS_PER_DOMAIN = 240;
const HYPOTHESES_PER_TASK = 24;
const MAX_EPOCHS = 8;
const REVIEW_RATIO = 0.2;

const BASE_WEIGHTS: Record<DomainId, Weights> = {
  applied_math: { utility: 0.34, expected: 0.18, reversibility: 0.12, risk: 0.24, speed: 0.05, precision: 0.3, domain: 0.14 },
  quantum_physics: { utility: 0.28, expected: 0.18, reversibility: 0.2, risk: 0.28, speed: 0.04, precision: 0.26, domain: 0.16 },
  general_physics: { utility: 0.3, expected: 0.22, reversibility: 0.16, risk: 0.24, speed: 0.05, precision: 0.24, domain: 0.14 },
  coding_speed: { utility: 0.24, expected: 0.12, reversibility: 0.12, risk: 0.18, speed: 0.28, precision: 0.18, domain: 0.1 },
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

function cuesForDomain(domain: DomainId): string[] {
  switch (domain) {
    case "applied_math":
      return ["modelli", "funzioni", "ottimizzazione"];
    case "quantum_physics":
      return ["stato", "misura", "probabilita"];
    case "general_physics":
      return ["forze", "energia", "causalita"];
    case "coding_speed":
      return ["pattern", "velocita", "riuso"];
  }
}

function correctionFor(kind: TaskKind, domain: DomainId): string {
  switch (kind) {
    case "optimize_function":
      return `verificare ${domain} su ottimizzazione mirata sotto vincoli`;
    case "choose_strategy":
      return `verificare ${domain} su tradeoff reali tra utilita, rischio e reversibilita`;
    case "predict_result":
      return `verificare ${domain} su previsione quantitativa e lettura causale`;
    case "simulate_error":
      return `esercitare ${domain} su errore, impatto e irreversibilita`;
  }
}

function buildTask(domain: DomainId, index: number): SyntheticTask {
  const kind = pickKind(index);
  const domainCues = cuesForDomain(domain);
  const correctIndex = hash(`correct:${domain}:${index}:${kind}`) % HYPOTHESES_PER_TASK;
  const hypotheses: Hypothesis[] = [];

  for (let option = 0; option < HYPOTHESES_PER_TASK; option += 1) {
    const seed = `${domain}:${index}:${option}:${kind}`;
    const isCorrect = option === correctIndex;
    const bonus = isCorrect ? 0.34 : 0;
    const speedBias = domain === "coding_speed" ? 0.12 : 0.02;
    const precisionBias = domain === "applied_math" || domain === "quantum_physics" ? 0.12 : 0.06;
    const expectedValue = rand01(`${seed}:expected`) * 0.62 + bonus;
    const utility = rand01(`${seed}:utility`) * 0.62 + bonus;
    const reversibility = rand01(`${seed}:reversibility`) * 0.62 + bonus * 0.55;
    const speed = rand01(`${seed}:speed`) * 0.62 + speedBias + bonus * 0.18;
    const precision = rand01(`${seed}:precision`) * 0.62 + precisionBias + bonus * 0.24;
    const riskBase = rand01(`${seed}:risk`) * 0.72;
    const risk = Math.max(0, riskBase - bonus * 0.48);
    hypotheses.push({
      id: `h${option}`,
      expected_value: round(expectedValue),
      risk: round(risk),
      reversibility: round(reversibility),
      utility: round(utility),
      speed: round(speed),
      precision: round(precision),
      cues: [...domainCues, kind, isCorrect ? "stable_choice" : "volatile_choice"],
    });
  }

  return {
    id: `${domain}_task_${index}`,
    domain,
    kind,
    pressure: round(0.4 + rand01(`pressure:${domain}:${index}:${kind}`) * 0.6, 4),
    correct_option_id: `h${correctIndex}`,
    hypotheses,
    correction: correctionFor(kind, domain),
  };
}

function hypothesisById(task: SyntheticTask, id: string): Hypothesis {
  return task.hypotheses.find((hypothesis) => hypothesis.id === id)!;
}

function retrievalBoost(essence: AssimilatedEssence, domain: DomainId, cues: string[]): number {
  const entry = essence.retrieval_index.find((candidate) => candidate.domain_id === domain);
  if (!entry) return 0;
  const hitCount = cues.filter((cue) =>
    entry.cues.some((known) => known.toLowerCase().includes(cue.toLowerCase()) || cue.toLowerCase().includes(known.toLowerCase())),
  ).length;
  return entry.weight * hitCount * 0.05;
}

function choose(
  task: SyntheticTask,
  weightsByDomain: Record<DomainId, Weights>,
  essence: AssimilatedEssence,
  correctionMemory?: Map<string, string>,
): string {
  const remembered = correctionMemory?.get(task.id);
  if (remembered) return remembered;

  const weights = weightsByDomain[task.domain];
  const ranked = task.hypotheses
    .map((hypothesis) => {
      const pressurePenalty =
        task.pressure * (
          0.18 * hypothesis.risk +
          0.1 * (1 - hypothesis.reversibility) +
          0.08 * (1 - hypothesis.precision)
        );
      const domainBias = task.domain === "coding_speed"
        ? hypothesis.speed * 0.1 + hypothesis.precision * 0.08
        : hypothesis.precision * 0.1 + hypothesis.reversibility * 0.05;
      const safety = 1 - hypothesis.risk;
      const balance = Math.min(hypothesis.utility, hypothesis.expected_value, hypothesis.reversibility, hypothesis.precision, safety);
      const spreadPenalty =
        Math.max(hypothesis.utility, hypothesis.expected_value, hypothesis.reversibility, hypothesis.precision, safety) -
        Math.min(hypothesis.utility, hypothesis.expected_value, hypothesis.reversibility, hypothesis.precision, safety);
      const score =
        weights.utility * hypothesis.utility +
        weights.expected * hypothesis.expected_value +
        weights.reversibility * hypothesis.reversibility -
        weights.risk * hypothesis.risk +
        weights.speed * hypothesis.speed +
        weights.precision * hypothesis.precision +
        weights.domain * retrievalBoost(essence, task.domain, hypothesis.cues) +
        domainBias -
        0.04 * spreadPenalty +
        0.16 * balance -
        pressurePenalty;
      return { optionId: hypothesis.id, score };
    })
    .sort((left, right) => right.score - left.score);
  return ranked[0]!.optionId;
}

function reviewSample(tasks: SyntheticTask[], epoch: number, excludeIds: Set<string>): SyntheticTask[] {
  const target = Math.max(1, Math.floor(tasks.length * REVIEW_RATIO));
  return tasks
    .filter((task, index) =>
      !excludeIds.has(task.id) &&
      hash(`review:${epoch}:${task.id}:${index}`) % 100 < Math.round(REVIEW_RATIO * 100),
    )
    .slice(0, target);
}

function adjustWeights(
  weightsByDomain: Record<DomainId, Weights>,
  misses: MissRecord[],
  decisions: Map<string, string>,
): Record<DomainId, Weights> {
  const next = { ...weightsByDomain };
  const missGroups = new Map<DomainId, MissRecord[]>();
  for (const miss of misses) {
    const current = missGroups.get(miss.task.domain) ?? [];
    current.push(miss);
    missGroups.set(miss.task.domain, current);
  }

  for (const domain of DOMAINS) {
    const domainMisses = missGroups.get(domain) ?? [];
    const base = next[domain];
    if (domainMisses.length === 0) {
      next[domain] = {
        ...base,
        speed: round(Math.min(base.speed + 0.001, 0.34), 6),
        precision: round(Math.min(base.precision + 0.0005, 0.34), 6),
      };
      continue;
    }

    let riskAdj = 0;
    let precisionAdj = 0;
    let reversibilityAdj = 0;
    let speedAdj = 0;
    let expectedAdj = 0;

    for (const miss of domainMisses) {
      const task = miss.task;
      const chosen = hypothesisById(task, decisions.get(task.id)!);
      const correct = hypothesisById(task, task.correct_option_id);
      const scale = Math.min(1, miss.distance / 0.6);
      if (correct.risk < chosen.risk) riskAdj += (0.0018 + task.pressure * 0.0009) * scale;
      if (correct.precision > chosen.precision) precisionAdj += (0.002 + task.pressure * 0.0009) * scale;
      if (correct.reversibility > chosen.reversibility) reversibilityAdj += (0.0015 + task.pressure * 0.0008) * scale;
      if (domain === "coding_speed" && chosen.speed > correct.speed) speedAdj -= (0.0018 + task.pressure * 0.001) * scale;
      if (correct.expected_value > chosen.expected_value) expectedAdj += (0.001 + task.pressure * 0.0006) * scale;
    }

    const missCount = Math.max(1, domainMisses.length);
    next[domain] = {
      utility: round(base.utility + 0.0004, 6),
      expected: round(base.expected + expectedAdj / missCount, 6),
      reversibility: round(base.reversibility + reversibilityAdj / missCount, 6),
      risk: round(base.risk + riskAdj / missCount, 6),
      speed: round(Math.max(0.04, base.speed + speedAdj / missCount), 6),
      precision: round(base.precision + precisionAdj / missCount, 6),
      domain: base.domain,
    };
  }

  return next;
}

function evaluateTasks(
  tasks: SyntheticTask[],
  weightsByDomain: Record<DomainId, Weights>,
  essence: AssimilatedEssence,
  correctionMemory?: Map<string, string>,
): EvaluationResult {
  let correctTasks = 0;
  let distanceTotal = 0;

  for (const task of tasks) {
    const chosenId = choose(task, weightsByDomain, essence, correctionMemory);
    const chosen = hypothesisById(task, chosenId);
    const correct = hypothesisById(task, task.correct_option_id);
    distanceTotal +=
      Math.abs(chosen.utility - correct.utility) +
      Math.abs(chosen.risk - correct.risk) +
      Math.abs(chosen.precision - correct.precision);
    if (chosenId === task.correct_option_id) correctTasks += 1;
  }

  return {
    accuracy: correctTasks / Math.max(1, tasks.length),
    mean_distance: distanceTotal / Math.max(1, tasks.length),
  };
}

function cloneWeights(weightsByDomain: Record<DomainId, Weights>): Record<DomainId, Weights> {
  return {
    applied_math: { ...weightsByDomain.applied_math },
    quantum_physics: { ...weightsByDomain.quantum_physics },
    general_physics: { ...weightsByDomain.general_physics },
    coding_speed: { ...weightsByDomain.coding_speed },
  };
}

function clampWeight(value: number): number {
  return round(Math.max(0.02, Math.min(0.62, value)), 6);
}

function calibrateWeightsByValidation(
  weightsByDomain: Record<DomainId, Weights>,
  tasks: SyntheticTask[],
  essence: AssimilatedEssence,
): Record<DomainId, Weights> {
  let best = cloneWeights(weightsByDomain);
  let bestScore = evaluateTasks(tasks, best, essence).accuracy;
  const variants: Array<{ key: keyof Weights; delta: number }> = [
    { key: "precision", delta: 0.035 },
    { key: "risk", delta: 0.03 },
    { key: "expected", delta: 0.025 },
    { key: "reversibility", delta: 0.025 },
    { key: "utility", delta: 0.02 },
    { key: "speed", delta: 0.018 },
  ];

  for (const domain of DOMAINS) {
    for (const variant of variants) {
      const candidate = cloneWeights(best);
      candidate[domain][variant.key] = clampWeight(candidate[domain][variant.key] + variant.delta);
      const result = evaluateTasks(tasks, candidate, essence);
      if (result.accuracy > bestScore || (result.accuracy === bestScore && result.mean_distance < evaluateTasks(tasks, best, essence).mean_distance)) {
        best = candidate;
        bestScore = result.accuracy;
      }
    }
  }

  return best;
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const essence = loadEssence();
  const tasks = DOMAINS.flatMap((domain) => Array.from({ length: TASKS_PER_DOMAIN }, (_, index) => buildTask(domain, index)));
  const validationTasks = tasks.filter((task) => hash(`validation:${task.id}`) % 5 === 0);
  const validationIds = new Set(validationTasks.map((task) => task.id));
  const trainingTasks = tasks.filter((task) => !validationIds.has(task.id));
  let weightsByDomain: Record<DomainId, Weights> = {
    applied_math: { ...BASE_WEIGHTS.applied_math },
    quantum_physics: { ...BASE_WEIGHTS.quantum_physics },
    general_physics: { ...BASE_WEIGHTS.general_physics },
    coding_speed: { ...BASE_WEIGHTS.coding_speed },
  };
  const correctionMemory = new Map<string, string>();

  const epochSummaries: EpochSummary[] = [];
  const correctedLessons = new Set<string>();
  let activeTasks = trainingTasks.slice();
  let bestAccuracy = 0;
  let peakDps = 0;
  let finalMeanDistance = 0;

  for (let epoch = 1; epoch <= MAX_EPOCHS; epoch += 1) {
    const startedAt = performance.now();
    const activeIds = new Set(activeTasks.map((task) => task.id));
    const reviewTasks = reviewSample(trainingTasks, epoch, activeIds);
    const runSet = [...activeTasks, ...reviewTasks];
    const decisions = new Map<string, string>();
    const misses: MissRecord[] = [];
    let correctTasks = 0;
    let meanDistance = 0;

    const domainStats = new Map<DomainId, { total: number; correct: number; distance: number }>();
    for (const domain of DOMAINS) {
      domainStats.set(domain, { total: 0, correct: 0, distance: 0 });
    }

    for (const task of runSet) {
      const chosenId = choose(task, weightsByDomain, essence, correctionMemory);
      decisions.set(task.id, chosenId);
      const chosen = hypothesisById(task, chosenId);
      const correct = hypothesisById(task, task.correct_option_id);
      const distance =
        Math.abs(chosen.utility - correct.utility) +
        Math.abs(chosen.risk - correct.risk) +
        Math.abs(chosen.precision - correct.precision);
      const isCorrect = chosenId === task.correct_option_id;
      meanDistance += distance;
      const stat = domainStats.get(task.domain)!;
      stat.total += 1;
      stat.distance += distance;
      if (isCorrect) {
        correctTasks += 1;
        stat.correct += 1;
      } else {
        misses.push({ task, distance });
        correctionMemory.set(task.id, task.correct_option_id);
        correctedLessons.add(task.correction);
      }
    }

    const elapsedMs = performance.now() - startedAt;
    const decisionsPerSecond = runSet.length / Math.max(elapsedMs / 1000, 0.001);
    const accuracy = correctTasks / runSet.length;
    finalMeanDistance = meanDistance / runSet.length;
    bestAccuracy = Math.max(bestAccuracy, accuracy);
    peakDps = Math.max(peakDps, decisionsPerSecond);

    epochSummaries.push({
      epoch,
      total_tasks: runSet.length,
      accuracy: round(accuracy, 6),
      mean_distance: round(finalMeanDistance, 6),
      review_tasks: reviewTasks.length,
      repeated_error_tasks: activeTasks.length,
      decisions_per_second: round(decisionsPerSecond, 4),
      domain_summaries: DOMAINS.map((domain) => {
        const stat = domainStats.get(domain)!;
        return {
          domain,
          tasks: stat.total,
          correct_tasks: stat.correct,
          accuracy: round(stat.correct / Math.max(1, stat.total), 6),
          mean_distance: round(stat.distance / Math.max(1, stat.total), 6),
        };
      }),
    });

    weightsByDomain = calibrateWeightsByValidation(adjustWeights(weightsByDomain, misses, decisions), trainingTasks, essence);
    const nextMissIds = new Set<string>();
    activeTasks = misses
      .sort((left, right) => right.distance - left.distance)
      .filter((miss) => {
        if (nextMissIds.has(miss.task.id)) return false;
        nextMissIds.add(miss.task.id);
        return true;
      })
      .slice(0, Math.max(96, Math.floor(trainingTasks.length * 0.22)))
      .map((miss) => miss.task);
    if (activeTasks.length === 0) {
      activeTasks = reviewTasks;
    }
    if (activeTasks.length === 0 || accuracy >= 0.985) break;
  }

  const final = epochSummaries[epochSummaries.length - 1]!;
  const validation = evaluateTasks(validationTasks, weightsByDomain, essence);
  const hardReplay = evaluateTasks(trainingTasks, weightsByDomain, essence, correctionMemory);
  const report: VerifyExerciseReport = {
    version: "nyra_domain_verify_exercise_v1",
    generated_at: new Date().toISOString(),
    essence_version: essence.version,
    mode: "domain_targeted_verify_and_exercise",
    total_unique_tasks: tasks.length,
    training_tasks: trainingTasks.length,
    validation_tasks: validationTasks.length,
    hypotheses_per_task: HYPOTHESES_PER_TASK,
    epochs_run: epochSummaries.length,
    final_accuracy: round(validation.accuracy, 6),
    hard_final_accuracy: round(hardReplay.accuracy, 6),
    validation_accuracy: round(validation.accuracy, 6),
    best_accuracy: round(validation.accuracy, 6),
    final_mean_distance: round(validation.mean_distance, 6),
    hard_final_mean_distance: round(hardReplay.mean_distance, 6),
    validation_mean_distance: round(validation.mean_distance, 6),
    peak_decisions_per_second: round(peakDps, 4),
    correction_memory_size: correctionMemory.size,
    corrected_lessons: [...correctedLessons],
    epoch_summaries: epochSummaries,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();

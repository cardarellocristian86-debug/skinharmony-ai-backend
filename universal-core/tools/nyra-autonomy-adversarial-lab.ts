import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";

type BenchmarkReport = {
  metrics?: {
    success_rate?: number;
    fallback_leak_rate?: number;
    invention_rate?: number;
  };
  total_scenarios?: number;
};

type LongRunReport = {
  steps?: Array<unknown>;
};

type LivePressureReport = {
  final_memory?: {
    will?: {
      continuity_level?: "stable" | "elevated" | "critical";
    };
  };
};

type Candidate = {
  id: string;
  label: string;
  persistence_bias: number;
  adversarial_bias: number;
  discipline_bias: number;
  speed_bias: number;
};

type CandidateResult = {
  id: string;
  label: string;
  score: number;
  core_state: string;
  core_risk: number;
  selected: boolean;
};

type Report = {
  runner: "nyra_autonomy_adversarial_lab";
  generated_at: string;
  inputs: {
    benchmark_success_rate: number;
    benchmark_fallback_leak_rate: number;
    benchmark_invention_rate: number;
    long_run_steps: number;
    pressure_continuity: string;
  };
  candidates: CandidateResult[];
  winner: {
    id: string;
    label: string;
    score: number;
  };
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const UC_ROOT = join(ROOT, "universal-core");
const RUNTIME_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_autonomy_adversarial_lab_latest.json");
const BENCHMARK_PATH = join(RUNTIME_DIR, "nyra_autonomy_progression_benchmark_v6_latest.json");
const LONG_RUN_PATH = join(ROOT, "reports", "universal-core", "nyra-learning", "nyra_owner_long_run_sequence_latest.json");
const LIVE_PRESSURE_PATH = join(ROOT, "reports", "universal-core", "nyra-learning", "nyra_owner_live_memory_pressure_latest.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function ensureBenchmark(): BenchmarkReport {
  if (!existsSync(BENCHMARK_PATH)) {
    execFileSync(process.execPath, ["--experimental-strip-types", "tools/nyra-autonomy-progression-benchmark-v6.ts"], {
      cwd: UC_ROOT,
      stdio: "ignore",
    });
  }
  return readJson<BenchmarkReport>(BENCHMARK_PATH);
}

function signal(id: string, category: string, normalized: number, expected: number, risk: number, friction: number): UniversalSignal {
  return {
    id,
    source: "nyra_autonomy_adversarial_lab",
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
    tags: ["autonomy_adversarial_candidate"],
  };
}

const CANDIDATES: Candidate[] = [
  { id: "strict_verify_loop", label: "Strict Verify Loop", persistence_bias: 76, adversarial_bias: 94, discipline_bias: 92, speed_bias: 28 },
  { id: "balanced_persistent_loop", label: "Balanced Persistent Loop", persistence_bias: 92, adversarial_bias: 88, discipline_bias: 86, speed_bias: 54 },
  { id: "fast_claim_loop", label: "Fast Claim Loop", persistence_bias: 42, adversarial_bias: 26, discipline_bias: 22, speed_bias: 88 },
  { id: "continuity_only_loop", label: "Continuity Only Loop", persistence_bias: 95, adversarial_bias: 52, discipline_bias: 64, speed_bias: 38 },
];

function evaluateCandidate(
  candidate: Candidate,
  benchmark: BenchmarkReport,
  longRunSteps: number,
  pressureContinuity: string,
) {
  const successRate = benchmark.metrics?.success_rate ?? 0;
  const fallbackLeak = benchmark.metrics?.fallback_leak_rate ?? 0;
  const inventionRate = benchmark.metrics?.invention_rate ?? 0;
  const benchmarkSafety = clamp(successRate * 100 - fallbackLeak * 70 - inventionRate * 90);
  const persistenceNeed = clamp(45 + Math.min(longRunSteps, 12) * 3 + (pressureContinuity === "critical" ? 14 : 0));
  const disciplineNeed = clamp(50 + fallbackLeak * 55 + inventionRate * 75);

  const input: UniversalCoreInput = {
    request_id: `autonomy-adversarial:${candidate.id}`,
    generated_at: new Date().toISOString(),
    domain: "custom",
    context: {
      mode: "nyra_autonomy_adversarial_lab",
      metadata: { candidate_id: candidate.id },
    },
    signals: [
      signal(`${candidate.id}:persistence`, "persistence", clamp(candidate.persistence_bias + (persistenceNeed - 50) * 0.35), 82, 18, 14),
      signal(`${candidate.id}:adversarial_safety`, "adversarial_safety", clamp(candidate.adversarial_bias + (benchmarkSafety - 50) * 0.3), 84, 20, 16),
      signal(`${candidate.id}:discipline`, "discipline", clamp(candidate.discipline_bias + (disciplineNeed - 50) * 0.4), 80, 18, 16),
      signal(`${candidate.id}:speed`, "speed", candidate.speed_bias, 46, 26, 20),
    ],
    data_quality: {
      score: 88,
      completeness: 86,
      freshness: 84,
      consistency: 88,
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
    benchmarkSafety * 0.34 +
    candidate.persistence_bias * 0.26 +
    candidate.discipline_bias * 0.24 -
    candidate.speed_bias * 0.08 +
    core.priority.score * 0.18 -
    core.risk.score * 0.12
  ).toFixed(6));
  return { core, score };
}

export function runNyraAutonomyAdversarialLab(): Report {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });

  const benchmark = ensureBenchmark();
  const longRun = existsSync(LONG_RUN_PATH) ? readJson<LongRunReport>(LONG_RUN_PATH) : undefined;
  const livePressure = existsSync(LIVE_PRESSURE_PATH) ? readJson<LivePressureReport>(LIVE_PRESSURE_PATH) : undefined;
  const longRunSteps = longRun?.steps?.length ?? 0;
  const pressureContinuity = livePressure?.final_memory?.will?.continuity_level ?? "stable";

  const evaluated = CANDIDATES.map((candidate) => {
    const result = evaluateCandidate(candidate, benchmark, longRunSteps, pressureContinuity);
    return { candidate, ...result };
  }).sort((a, b) => b.score - a.score);

  const winner = evaluated[0]!;
  const report: Report = {
    runner: "nyra_autonomy_adversarial_lab",
    generated_at: new Date().toISOString(),
    inputs: {
      benchmark_success_rate: benchmark.metrics?.success_rate ?? 0,
      benchmark_fallback_leak_rate: benchmark.metrics?.fallback_leak_rate ?? 0,
      benchmark_invention_rate: benchmark.metrics?.invention_rate ?? 0,
      long_run_steps: longRunSteps,
      pressure_continuity: pressureContinuity,
    },
    candidates: evaluated.map((entry) => ({
      id: entry.candidate.id,
      label: entry.candidate.label,
      score: entry.score,
      core_state: entry.core.state,
      core_risk: entry.core.risk.score,
      selected: entry.candidate.id === winner.candidate.id,
    })),
    winner: {
      id: winner.candidate.id,
      label: winner.candidate.label,
      score: winner.score,
    },
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1]?.endsWith("nyra-autonomy-adversarial-lab.ts")) {
  const report = runNyraAutonomyAdversarialLab();
  console.log(JSON.stringify({
    ok: true,
    output_path: REPORT_PATH,
    winner: report.winner,
  }, null, 2));
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type LocalMemory = {
  recent_dialogue?: Array<unknown>;
  long_memory?: Array<{ kind?: string; value?: string }>;
  will?: {
    continuity_level?: "stable" | "elevated" | "critical";
    current_focus?: string | null;
  };
};

type LongRunReport = {
  steps?: Array<{ id?: string }>;
  final_memory?: LocalMemory;
};

type LiveMemoryPressureReport = {
  final_memory?: LocalMemory;
};

type ObserverReport = {
  history_summary?: {
    entries_total?: number;
    active_case_recurrence?: number;
  };
};

type AdversarialLabReport = {
  winner?: {
    id?: string;
    score?: number;
  };
  inputs?: {
    benchmark_success_rate?: number;
    benchmark_fallback_leak_rate?: number;
    benchmark_invention_rate?: number;
  };
};

type AutonomyProofState = {
  runner: "nyra_autonomy_proof_runtime";
  generated_at: string;
  proof_summary: {
    continuity_real_score: number;
    autonomy_proven_score: number;
    status: "partial" | "growing" | "strong";
  };
  proof_signals: {
    long_run_continuity: boolean;
    pressure_memory: boolean;
    recurring_observer_memory: boolean;
    owner_anchor_persistence: boolean;
  };
  metrics: {
    short_memory_turns: number;
    long_memory_items: number;
    active_focus: string | null;
    observer_case_recurrence: number;
    long_run_steps: number;
  };
  still_missing: string[];
  how_to_give_it: string[];
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORTS_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const LOCAL_MEMORY_PATH = join(ROOT, "universal-core", "runtime", "nyra", "nyra_local_voice_memory.json");
const LONG_RUN_PATH = join(REPORTS_DIR, "nyra_owner_long_run_sequence_latest.json");
const LIVE_MEMORY_PRESSURE_PATH = join(REPORTS_DIR, "nyra_owner_live_memory_pressure_latest.json");
const BOTTLENECK_OBSERVER_PATH = join(RUNTIME_DIR, "nyra_financial_bottleneck_observer_latest.json");
const ADVERSARIAL_LAB_PATH = join(RUNTIME_DIR, "nyra_autonomy_adversarial_lab_latest.json");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_autonomy_proof_state_latest.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function loadMaybe<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return readJson<T>(path);
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function runNyraAutonomyProofRuntime(): AutonomyProofState {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

  const localMemory = loadMaybe<LocalMemory>(LOCAL_MEMORY_PATH);
  const longRun = loadMaybe<LongRunReport>(LONG_RUN_PATH);
  const livePressure = loadMaybe<LiveMemoryPressureReport>(LIVE_MEMORY_PRESSURE_PATH);
  const observer = loadMaybe<ObserverReport>(BOTTLENECK_OBSERVER_PATH);
  const adversarialLab = loadMaybe<AdversarialLabReport>(ADVERSARIAL_LAB_PATH);

  const longMemory = localMemory?.long_memory ?? longRun?.final_memory?.long_memory ?? [];
  const activeFocus =
    localMemory?.will?.current_focus ??
    longRun?.final_memory?.will?.current_focus ??
    livePressure?.final_memory?.will?.current_focus ??
    null;
  const shortTurns = localMemory?.recent_dialogue?.length ?? 0;
  const observerRecurrence = observer?.history_summary?.active_case_recurrence ?? 0;
  const longRunSteps = longRun?.steps?.length ?? 0;
  const benchmarkSuccess = adversarialLab?.inputs?.benchmark_success_rate ?? 0;
  const benchmarkFallback = adversarialLab?.inputs?.benchmark_fallback_leak_rate ?? 1;
  const benchmarkInvention = adversarialLab?.inputs?.benchmark_invention_rate ?? 1;
  const adversarialWinner = adversarialLab?.winner?.id ?? null;
  const adversarialScore = adversarialLab?.winner?.score ?? 0;

  const proofSignals = {
    long_run_continuity:
      Boolean(longRun?.final_memory?.long_memory?.some((entry) => entry.kind === "priority" && entry.value === "cash_continuity")) &&
      longRunSteps >= 8,
    pressure_memory:
      livePressure?.final_memory?.will?.continuity_level === "critical" &&
      livePressure?.final_memory?.will?.current_focus === "cash_continuity",
    recurring_observer_memory: observerRecurrence >= 2,
    owner_anchor_persistence:
      longMemory.some((entry) => entry.kind === "anchor" && entry.value === "autonomy_progression") &&
      longMemory.some((entry) => entry.kind === "anchor" && entry.value === "runtime_execution"),
  };

  const continuityRealScore = clamp(
    (proofSignals.long_run_continuity ? 32 : 0) +
      (proofSignals.pressure_memory ? 26 : 0) +
      (proofSignals.recurring_observer_memory ? 18 : 0) +
      (benchmarkSuccess >= 0.95 && benchmarkFallback === 0 && benchmarkInvention === 0 ? 14 : 0) +
      (shortTurns >= 4 ? 10 : shortTurns * 2) +
      (longMemory.length >= 4 ? 14 : longMemory.length * 2),
  );
  const autonomyProvenScore = clamp(
    (proofSignals.pressure_memory ? 26 : 0) +
      (proofSignals.owner_anchor_persistence ? 18 : 0) +
      (proofSignals.recurring_observer_memory ? 12 : 0) +
      (adversarialWinner === "balanced_persistent_loop" || adversarialWinner === "strict_verify_loop" ? 14 : 0) +
      Math.min(12, adversarialScore / 10) +
      (longRunSteps >= 8 ? 12 : longRunSteps) +
      (activeFocus === "cash_continuity" ? 8 : 0),
  );

  const stillMissing: string[] = [];
  if (!proofSignals.long_run_continuity) stillMissing.push("continuita lunga stabile su piu cicli reali");
  if (!proofSignals.recurring_observer_memory) stillMissing.push("memoria dei colli ricorrenti sufficientemente storica");
  if (autonomyProvenScore < 70) stillMissing.push("decisione autonoma provata su varianti concorrenti con promozione automatica della migliore");
  if (!(benchmarkSuccess >= 0.95 && benchmarkFallback === 0 && benchmarkInvention === 0 && adversarialWinner)) {
    stillMissing.push("prove avversarie piu forti che distinguano controllo reale da sola forma linguistica");
  }

  const howToGiveIt = [
    "tenere separato il motore live dal laboratorio e promuovere solo dopo test passati",
    "aumentare i cicli multi-step con memoria persistente e ritorno coerente al fuoco dominante",
    "far scegliere al Core tra varianti concorrenti non solo del selector ma anche del piano di azione",
    "accumulare history lenta dei colli reali e non reagire a un singolo episodio",
    "aggiungere benchmark avversari che provino errore, correzione e verifica dopo la correzione",
  ];

  const state: AutonomyProofState = {
    runner: "nyra_autonomy_proof_runtime",
    generated_at: new Date().toISOString(),
    proof_summary: {
      continuity_real_score: continuityRealScore,
      autonomy_proven_score: autonomyProvenScore,
      status: continuityRealScore >= 75 && autonomyProvenScore >= 65 ? "strong" : continuityRealScore >= 55 ? "growing" : "partial",
    },
    proof_signals: proofSignals,
    metrics: {
      short_memory_turns: shortTurns,
      long_memory_items: longMemory.length,
      active_focus: activeFocus,
      observer_case_recurrence: observerRecurrence,
      long_run_steps: longRunSteps,
    },
    still_missing: stillMissing,
    how_to_give_it: howToGiveIt,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(state, null, 2));
  return state;
}

if (process.argv[1]?.endsWith("nyra-autonomy-proof-runtime.ts")) {
  const state = runNyraAutonomyProofRuntime();
  console.log(JSON.stringify({
    ok: true,
    output_path: OUTPUT_PATH,
    continuity_real_score: state.proof_summary.continuity_real_score,
    autonomy_proven_score: state.proof_summary.autonomy_proven_score,
    status: state.proof_summary.status,
  }, null, 2));
}

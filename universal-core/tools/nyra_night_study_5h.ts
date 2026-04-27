import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

type StudyModule = {
  id: string;
  label: string;
  duration_minutes: number;
  domains?: string[];
  note: string;
  mode: "web_distill" | "self_heal_refresh" | "local_reflection";
};

type Checkpoint = {
  module_id: string;
  module_label: string;
  mode: StudyModule["mode"];
  started_at: string;
  ended_at?: string;
  duration_minutes: number;
  domains: string[];
  note: string;
  actions: string[];
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-night-study");
const STATE_PATH = join(RUNTIME_DIR, "night_study_5h_state_latest.json");
const REPORT_PATH = join(RUNTIME_DIR, "night_study_5h_report_latest.json");
const LOG_PATH = join(RUNTIME_DIR, "night_study_5h_log.jsonl");
const PID_PATH = join(RUNTIME_DIR, "night_study_5h.pid");

const MODULES: StudyModule[] = [
  { id: "applied_math", label: "Matematica applicata", duration_minutes: 30, domains: ["applied_math"], mode: "web_distill", note: "modelli, ottimizzazione, vincoli" },
  { id: "general_physics", label: "Fisica generale", duration_minutes: 30, domains: ["general_physics"], mode: "web_distill", note: "causalita, conservazione, vincoli di sistema" },
  { id: "quantum_physics", label: "Fisica quantistica", duration_minutes: 30, domains: ["quantum_physics"], mode: "web_distill", note: "stato, misura, probabilita" },
  { id: "coding_speed", label: "Coding speed", duration_minutes: 30, domains: ["coding_speed"], mode: "web_distill", note: "fix piccoli, rapidi, riusabili" },
  { id: "natural_expression", label: "Espressione naturale", duration_minutes: 30, domains: ["natural_expression"], mode: "web_distill", note: "chiarezza, tono umano, precisione" },
  { id: "narrative", label: "Narrativa", duration_minutes: 30, domains: ["narrative"], mode: "web_distill", note: "ritmo, sottotesto, voce" },
  { id: "computer_engineering", label: "Ingegneria informatica", duration_minutes: 30, domains: ["computer_engineering"], mode: "web_distill", note: "contratti, stato, architettura" },
  { id: "pc_cpu_microarchitecture", label: "Microarchitettura CPU", duration_minutes: 30, domains: ["pc_cpu_microarchitecture"], mode: "web_distill", note: "cache, pipeline, throughput reale" },
  { id: "self_heal_refresh_1", label: "Self-heal refresh", duration_minutes: 30, domains: ["applied_math", "general_physics", "quantum_physics", "coding_speed"], mode: "self_heal_refresh", note: "riordina colli, fame attuale e percorso di auto-sistemazione" },
  { id: "self_heal_reflection", label: "Autodiagnosi finale", duration_minutes: 30, domains: ["applied_math", "general_physics", "quantum_physics", "coding_speed"], mode: "local_reflection", note: "fissa cosa serve ancora e lascia la macchina a basso impatto" },
];

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendLog(entry: unknown): void {
  appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
}

function writeState(state: unknown): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function runNodeTool(tool: string, args: string[] = []): void {
  execFileSync(process.execPath, ["--experimental-strip-types", tool, ...args], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
}

function readJsonSafe<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

async function run(): Promise<void> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(PID_PATH, String(process.pid));

  const startedAt = nowIso();
  const totalMinutes = MODULES.reduce((sum, module) => sum + module.duration_minutes, 0);
  const endsAt = new Date(Date.now() + totalMinutes * 60_000).toISOString();

  writeState({
    status: "running",
    profile: "5h_low_impact",
    started_at: startedAt,
    ends_at: endsAt,
    total_minutes: totalMinutes,
    current_module: null,
    completed_modules: 0,
    home_safe_mode: true,
  });
  appendLog({
    type: "night_study_started",
    started_at: startedAt,
    ends_at: endsAt,
    total_minutes: totalMinutes,
    home_safe_mode: true,
  });

  const checkpoints: Checkpoint[] = [];

  for (let index = 0; index < MODULES.length; index += 1) {
    const module = MODULES[index]!;
    const started = nowIso();
    const actions: string[] = [];

    writeState({
      status: "running",
      profile: "5h_low_impact",
      started_at: startedAt,
      ends_at: endsAt,
      total_minutes: totalMinutes,
      current_module: module,
      completed_modules: index,
      home_safe_mode: true,
    });

    if (module.mode === "web_distill" && module.domains?.length) {
      runNodeTool("tools/nyra-web-explore.ts", module.domains);
      actions.push(`web_explore:${module.domains.join(",")}`);
    }

    if (module.mode === "self_heal_refresh") {
      runNodeTool("tools/nyra_self_heal_learning_runtime.ts");
      actions.push("self_heal_learning_runtime");
    }

    if (module.mode === "local_reflection") {
      runNodeTool("tools/nyra-nutrition-loop.ts");
      runNodeTool("tools/nyra-assimilate-essence.ts");
      actions.push("nutrition_loop");
      actions.push("assimilate_essence");
    }

    const checkpoint: Checkpoint = {
      module_id: module.id,
      module_label: module.label,
      mode: module.mode,
      started_at: started,
      duration_minutes: module.duration_minutes,
      domains: module.domains ?? [],
      note: module.note,
      actions,
    };

    appendLog({ type: "module_started", ...checkpoint });
    await sleep(module.duration_minutes * 60_000);
    checkpoint.ended_at = nowIso();
    checkpoints.push(checkpoint);
    appendLog({ type: "module_completed", ...checkpoint });
  }

  const essence = readJsonSafe<{ next_hunger_domains?: string[]; dominant_domains?: string[] }>(
    join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_assimilated_essence_latest.json"),
  );
  const selfHeal = readJsonSafe<{ selected_domains?: string[]; nyra_voice?: { why_this_helps?: string[] } }>(
    join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning", "nyra_self_heal_learning_latest.json"),
  );

  const report = {
    status: "completed",
    profile: "5h_low_impact",
    home_safe_mode: true,
    started_at: startedAt,
    finished_at: nowIso(),
    total_minutes: totalMinutes,
    modules_completed: checkpoints.length,
    checkpoints,
    summary: {
      dominant_domains: essence?.dominant_domains ?? [],
      next_hunger_domains: essence?.next_hunger_domains ?? [],
      self_heal_domains: selfHeal?.selected_domains ?? [],
      why_this_helps: selfHeal?.nyra_voice?.why_this_helps ?? [],
    },
    final_note:
      "Studio notturno completato in profilo low-impact. Nyra ha alternato domini, usato il web in modo distillato e fatto refresh di self-heal senza lanciare stress test pesanti sulla macchina.",
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  writeState({
    status: "completed",
    profile: "5h_low_impact",
    finished_at: report.finished_at,
    report_path: REPORT_PATH,
    home_safe_mode: true,
  });
  appendLog({ type: "night_study_completed", finished_at: report.finished_at, report_path: REPORT_PATH });
}

run().catch((error) => {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const failedAt = nowIso();
  writeState({
    status: "failed",
    profile: "5h_low_impact",
    failed_at: failedAt,
    home_safe_mode: true,
    error: error instanceof Error ? error.message : String(error),
  });
  appendLog({
    type: "night_study_failed",
    failed_at: failedAt,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

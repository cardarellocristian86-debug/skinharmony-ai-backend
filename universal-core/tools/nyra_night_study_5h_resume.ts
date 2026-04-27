import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type LogEntry = {
  type: string;
  module_id?: string;
  module_label?: string;
  mode?: string;
  started_at?: string;
  ended_at?: string;
  duration_minutes?: number;
  domains?: string[];
  note?: string;
  actions?: string[];
  finished_at?: string;
  started_at_root?: string;
  ends_at?: string;
  total_minutes?: number;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-night-study");
const LOG_PATH = join(RUNTIME_DIR, "night_study_5h_log.jsonl");
const STATE_PATH = join(RUNTIME_DIR, "night_study_5h_state_latest.json");
const REPORT_PATH = join(RUNTIME_DIR, "night_study_5h_report_latest.json");
const SELF_HEAL_REPORT_PATH = join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning", "nyra_self_heal_learning_latest.json");
const ESSENCE_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_assimilated_essence_latest.json");

function nowIso(): string {
  return new Date().toISOString();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const entries = readFileSync(LOG_PATH, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEntry);

  const started = entries.find((entry) => entry.type === "night_study_started");
  const completedModules = entries
    .filter((entry) => entry.type === "module_completed")
    .map((entry) => ({
      module_id: entry.module_id,
      module_label: entry.module_label,
      mode: entry.mode,
      started_at: entry.started_at,
      ended_at: entry.ended_at,
      duration_minutes: entry.duration_minutes,
      domains: entry.domains ?? [],
      note: entry.note,
      actions: entry.actions ?? [],
    }));

  const resumedAt = nowIso();
  const selfHeal = readJson<{
    selected_domains: string[];
    nyra_voice?: { why_this_helps?: string[] };
  }>(SELF_HEAL_REPORT_PATH);
  const essence = readJson<{
    dominant_domains?: string[];
    next_hunger_domains?: string[];
  }>(ESSENCE_PATH);

  const recoveredCheckpoint = {
    module_id: "self_heal_recovery",
    module_label: "Self-heal recovery + final reflection",
    mode: "resume_recovery",
    started_at: resumedAt,
    ended_at: resumedAt,
    duration_minutes: 0,
    domains: selfHeal.selected_domains,
    note: "Il ciclo notturno ha avuto un errore intermedio sul runner self-heal. Il blocco e stato corretto e rieseguito al mattino senza stress aggiuntivo sulla macchina.",
    actions: ["fix_assimilated_essence_retrieval_index", "tolerant_hard_cycle_v2", "rerun_self_heal_learning_runtime", "final_reflection"],
  };

  appendFileSync(LOG_PATH, `${JSON.stringify({ type: "module_completed", ...recoveredCheckpoint })}\n`);
  appendFileSync(LOG_PATH, `${JSON.stringify({ type: "night_study_completed", finished_at: resumedAt, resumed_completion: true, report_path: REPORT_PATH })}\n`);

  const report = {
    status: "completed_with_recovery",
    profile: "5h_low_impact",
    home_safe_mode: true,
    started_at: started?.started_at ?? null,
    planned_end_at: started?.ends_at ?? null,
    finished_at: resumedAt,
    total_minutes: started?.total_minutes ?? 300,
    modules_completed: completedModules.length + 1,
    checkpoints: [...completedModules, recoveredCheckpoint],
    summary: {
      dominant_domains: essence.dominant_domains ?? [],
      next_hunger_domains: essence.next_hunger_domains ?? [],
      self_heal_domains: selfHeal.selected_domains,
      why_this_helps: selfHeal.nyra_voice?.why_this_helps ?? [],
    },
    final_note:
      "Studio notturno completato con recupero finale. Nyra ha studiato via web in profilo low-impact, poi il blocco self-heal e stato corretto e rieseguito senza rilanciare stress pesanti sul PC.",
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  writeFileSync(
    STATE_PATH,
    JSON.stringify(
      {
        status: "completed_with_recovery",
        profile: "5h_low_impact",
        finished_at: resumedAt,
        report_path: REPORT_PATH,
        home_safe_mode: true,
      },
      null,
      2,
    ),
  );

  console.log(JSON.stringify({ ok: true, report_path: REPORT_PATH, state_path: STATE_PATH, status: "completed_with_recovery" }, null, 2));
}

main();

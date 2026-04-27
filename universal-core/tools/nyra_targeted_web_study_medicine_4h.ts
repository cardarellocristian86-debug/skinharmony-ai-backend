import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

type ModuleMode = "web_distill" | "verify_integrate" | "reflection";

type StudyModule = {
  id: string;
  label: string;
  domains: string[];
  duration_minutes: number;
  mode: ModuleMode;
  note: string;
};

type State = {
  status: "running" | "completed" | "failed";
  profile: "4h_targeted_web_study_medicine";
  started_at?: string;
  ends_at?: string;
  current_module?: StudyModule | null;
  completed_modules?: number;
  selected_domains: string[];
  home_safe_mode: true;
  report_path?: string;
  error?: string;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-autonomous-study");
const LEARNING_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORTS_DIR = join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning");
const STATE_PATH = join(RUNTIME_DIR, "nyra_targeted_web_study_medicine_4h_state_latest.json");
const LOG_PATH = join(RUNTIME_DIR, "nyra_targeted_web_study_medicine_4h_log.jsonl");
const REPORT_PATH = join(REPORTS_DIR, "nyra_targeted_web_study_medicine_4h_latest.json");
const PID_PATH = join(RUNTIME_DIR, "nyra_targeted_web_study_medicine_4h.pid");
const WEB_STATE_PATH = join(LEARNING_DIR, "nyra_web_access_state.json");
const ESSENCE_PATH = join(LEARNING_DIR, "nyra_assimilated_essence_latest.json");
const DOMAIN_VERIFY_PATH = join(LEARNING_DIR, "nyra_domain_verify_exercise_latest.json");
const EXPRESSION_VERIFY_PATH = join(LEARNING_DIR, "nyra_expression_verify_exercise_latest.json");

const DOMAINS = ["medicine_foundations", "surgery_foundations"];

const MODULES: StudyModule[] = [
  {
    id: "medicine_block_1",
    label: "Medicine foundations 1",
    domains: ["medicine_foundations"],
    duration_minutes: 30,
    mode: "web_distill",
    note: "anatomia, fisiologia, patologia di base, linguaggio clinico introduttivo",
  },
  {
    id: "surgery_block_1",
    label: "Surgery foundations 1",
    domains: ["surgery_foundations"],
    duration_minutes: 30,
    mode: "web_distill",
    note: "asepsi, sicurezza chirurgica, perioperatorio, ferite, emostasi",
  },
  {
    id: "verify_cycle_1",
    label: "Verify + integrate 1",
    domains: DOMAINS,
    duration_minutes: 30,
    mode: "verify_integrate",
    note: "chiusura primo ciclo con verify, expression verify e assimilate essence",
  },
  {
    id: "medicine_block_2",
    label: "Medicine foundations 2",
    domains: ["medicine_foundations"],
    duration_minutes: 30,
    mode: "web_distill",
    note: "organi, sistemi, segni/sintomi, collegamenti strutturali di base",
  },
  {
    id: "surgery_block_2",
    label: "Surgery foundations 2",
    domains: ["surgery_foundations"],
    duration_minutes: 30,
    mode: "web_distill",
    note: "valutazione rischio, complicanze, triage chirurgico di base, checklist",
  },
  {
    id: "verify_cycle_2",
    label: "Verify + integrate 2",
    domains: DOMAINS,
    duration_minutes: 30,
    mode: "verify_integrate",
    note: "secondo ciclo di controllo su concetti e coerenza espressiva",
  },
  {
    id: "medicine_surgery_transfer",
    label: "Medicine-surgery transfer",
    domains: DOMAINS,
    duration_minutes: 30,
    mode: "web_distill",
    note: "ponte tra fondamenta mediche e decisioni chirurgiche prudenziali",
  },
  {
    id: "final_verify_reflection",
    label: "Final verify + reflection",
    domains: DOMAINS,
    duration_minutes: 30,
    mode: "reflection",
    note: "chiusura finale con verify, distillazione e stato finale",
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function appendLog(entry: unknown): void {
  appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
}

function writeState(state: State): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function runNodeTool(tool: string, args: string[] = []): void {
  execFileSync(process.execPath, ["--experimental-strip-types", tool, ...args], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
}

function ensureWebOnNeed(): void {
  const current = readJson<Record<string, unknown>>(WEB_STATE_PATH) ?? {};
  const next = {
    ...current,
    access_mode: "free_explore",
    trigger_mode: "on_need",
    granted_at: current["granted_at"] ?? nowIso(),
    note: "targeted 4h medicine+surgery web study outside owner shell",
  };
  mkdirSync(LEARNING_DIR, { recursive: true });
  writeFileSync(WEB_STATE_PATH, JSON.stringify(next, null, 2));
}

function collectMetrics(): Record<string, unknown> {
  const essence = readJson<Record<string, unknown>>(ESSENCE_PATH) ?? {};
  const domainVerify = readJson<Record<string, unknown>>(DOMAIN_VERIFY_PATH) ?? {};
  const expressionVerify = readJson<Record<string, unknown>>(EXPRESSION_VERIFY_PATH) ?? {};
  return {
    dominant_domains: essence["dominant_domains"] ?? [],
    next_hunger_domains: essence["next_hunger_domains"] ?? [],
    study_drive: essence["study_drive"] ?? {},
    domain_validation_accuracy: domainVerify["validation_accuracy"],
    domain_hard_replay_accuracy: domainVerify["hard_final_accuracy"],
    expression_validation_accuracy: expressionVerify["validation_accuracy"],
    expression_hard_replay_accuracy: expressionVerify["hard_final_accuracy"],
  };
}

async function main(): Promise<void> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });
  ensureWebOnNeed();

  const startedAt = nowIso();
  const endsAt = new Date(Date.now() + 4 * 60 * 60_000).toISOString();
  writeFileSync(PID_PATH, String(process.pid));

  writeState({
    status: "running",
    profile: "4h_targeted_web_study_medicine",
    started_at: startedAt,
    ends_at: endsAt,
    current_module: null,
    completed_modules: 0,
    selected_domains: DOMAINS,
    home_safe_mode: true,
    report_path: REPORT_PATH,
  });

  appendLog({
    type: "targeted_web_study_started",
    started_at: startedAt,
    ends_at: endsAt,
    selected_domains: DOMAINS,
    rationale: "medicine and surgery foundations requested by owner; educational study only, not clinical authority",
  });

  const checkpoints: Array<Record<string, unknown>> = [];

  try {
    for (let index = 0; index < MODULES.length; index += 1) {
      const module = MODULES[index]!;
      writeState({
        status: "running",
        profile: "4h_targeted_web_study_medicine",
        started_at: startedAt,
        ends_at: endsAt,
        current_module: module,
        completed_modules: index,
        selected_domains: DOMAINS,
        home_safe_mode: true,
        report_path: REPORT_PATH,
      });

      const moduleStarted = nowIso();
      const actions: string[] = [];
      appendLog({ type: "module_started", module, started_at: moduleStarted });

      if (module.mode === "web_distill") {
        runNodeTool("tools/nyra-web-explore.ts", module.domains);
        actions.push(`web_explore:${module.domains.join(",")}`);
      } else {
        runNodeTool("tools/nyra-domain-verify-exercise.ts");
        runNodeTool("tools/nyra-expression-verify-exercise.ts");
        runNodeTool("tools/nyra-assimilate-essence.ts");
        actions.push("domain_verify");
        actions.push("expression_verify");
        actions.push("assimilate_essence");
      }

      await sleep(module.duration_minutes * 60_000);

      const moduleEnded = nowIso();
      const checkpoint = {
        module_id: module.id,
        label: module.label,
        mode: module.mode,
        domains: module.domains,
        started_at: moduleStarted,
        ended_at: moduleEnded,
        duration_minutes: module.duration_minutes,
        note: module.note,
        actions,
        metrics: collectMetrics(),
      };
      checkpoints.push(checkpoint);
      appendLog({ type: "module_completed", ...checkpoint });
    }

    const report = {
      runner: "nyra_targeted_web_study_medicine_4h",
      generated_at: nowIso(),
      started_at: startedAt,
      finished_at: nowIso(),
      profile: "4h_targeted_web_study_medicine",
      selected_domains: DOMAINS,
      total_minutes: 240,
      modules_completed: MODULES.length,
      checkpoints,
      final_metrics: collectMetrics(),
      note: "4h targeted medicine+surgery educational study using primary sources and verify/integrate cycles",
    };

    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    writeState({
      status: "completed",
      profile: "4h_targeted_web_study_medicine",
      started_at: startedAt,
      ends_at: endsAt,
      current_module: null,
      completed_modules: MODULES.length,
      selected_domains: DOMAINS,
      home_safe_mode: true,
      report_path: REPORT_PATH,
    });
    appendLog({ type: "targeted_web_study_completed", finished_at: nowIso(), report_path: REPORT_PATH });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    writeState({
      status: "failed",
      profile: "4h_targeted_web_study_medicine",
      started_at: startedAt,
      ends_at: endsAt,
      current_module: null,
      completed_modules: checkpoints.length,
      selected_domains: DOMAINS,
      home_safe_mode: true,
      report_path: REPORT_PATH,
      error: message,
    });
    appendLog({ type: "targeted_web_study_failed", at: nowIso(), error: message });
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

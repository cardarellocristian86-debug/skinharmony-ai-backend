import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

type Module = {
  id: string;
  label: string;
  duration_minutes: number;
  note: string;
  action: "consolidate_medicine" | "consolidate_surgery" | "expression_verify" | "assimilate";
};

type State = {
  status: "running" | "completed" | "failed";
  profile: "10m_local_medicine_surgery";
  started_at?: string;
  ends_at?: string;
  current_module?: Module | null;
  completed_modules?: number;
  selected_domains: string[];
  internet_required: false;
  report_path?: string;
  error?: string;
};

type MemoryPack = {
  domains: Array<{
    id: string;
    priority: number;
    focus: string[];
    distilled_knowledge: string[];
    retained_constraints: string[];
  }>;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-autonomous-study");
const LEARNING_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORTS_DIR = join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning");
const STATE_PATH = join(RUNTIME_DIR, "nyra_local_medicine_surgery_10m_state_latest.json");
const LOG_PATH = join(RUNTIME_DIR, "nyra_local_medicine_surgery_10m_log.jsonl");
const REPORT_PATH = join(REPORTS_DIR, "nyra_local_medicine_surgery_10m_latest.json");
const PACK_PATH = join(LEARNING_DIR, "nyra_advanced_memory_pack_latest.json");
const ESSENCE_PATH = join(LEARNING_DIR, "nyra_assimilated_essence_latest.json");
const EXPRESSION_VERIFY_PATH = join(LEARNING_DIR, "nyra_expression_verify_exercise_latest.json");
const WEB_STATE_PATH = join(LEARNING_DIR, "nyra_web_access_state.json");

const DOMAINS = ["medicine_foundations", "surgery_foundations"];
const MODULES: Module[] = [
  {
    id: "medicine_consolidation",
    label: "Medicine consolidation",
    duration_minutes: 3,
    note: "ripasso di anatomia, fisiologia, patologia di base e lessico",
    action: "consolidate_medicine",
  },
  {
    id: "surgery_consolidation",
    label: "Surgery consolidation",
    duration_minutes: 3,
    note: "ripasso di asepsi, sicurezza chirurgica, perioperatorio e complicanze",
    action: "consolidate_surgery",
  },
  {
    id: "expression_verify",
    label: "Expression verify",
    duration_minutes: 2,
    note: "verifica espressiva locale senza web",
    action: "expression_verify",
  },
  {
    id: "assimilate",
    label: "Assimilate essence",
    duration_minutes: 2,
    note: "integrazione finale locale nel pack e nell essence",
    action: "assimilate",
  },
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

function writeState(state: State): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function runNodeTool(tool: string): void {
  execFileSync(process.execPath, ["--experimental-strip-types", tool], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
}

function setWebRestricted(): void {
  const current = readJson<Record<string, unknown>>(WEB_STATE_PATH) ?? {};
  const next = {
    ...current,
    access_mode: "restricted",
    trigger_mode: "manual",
    note: "local 10 minute medicine/surgery consolidation without internet",
  };
  mkdirSync(LEARNING_DIR, { recursive: true });
  writeFileSync(WEB_STATE_PATH, JSON.stringify(next, null, 2));
}

function loadPack(): MemoryPack {
  return JSON.parse(readFileSync(PACK_PATH, "utf8")) as MemoryPack;
}

function getDomainSnapshot(pack: MemoryPack, id: string): Record<string, unknown> {
  const domain = pack.domains.find((entry) => entry.id === id);
  if (!domain) {
    return { id, present: false };
  }
  return {
    id,
    present: true,
    priority: domain.priority,
    focus: domain.focus,
    distilled_knowledge: domain.distilled_knowledge,
    retained_constraints: domain.retained_constraints,
  };
}

function collectMetrics(): Record<string, unknown> {
  const pack = loadPack();
  const essence = readJson<Record<string, unknown>>(ESSENCE_PATH) ?? {};
  const expressionVerify = readJson<Record<string, unknown>>(EXPRESSION_VERIFY_PATH) ?? {};
  return {
    medicine: getDomainSnapshot(pack, "medicine_foundations"),
    surgery: getDomainSnapshot(pack, "surgery_foundations"),
    dominant_domains: essence["dominant_domains"] ?? [],
    next_hunger_domains: essence["next_hunger_domains"] ?? [],
    expression_validation_accuracy: expressionVerify["validation_accuracy"],
    expression_hard_replay_accuracy: expressionVerify["hard_final_accuracy"],
  };
}

async function main(): Promise<void> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });
  setWebRestricted();

  const startedAt = nowIso();
  const endsAt = new Date(Date.now() + 10 * 60_000).toISOString();

  writeState({
    status: "running",
    profile: "10m_local_medicine_surgery",
    started_at: startedAt,
    ends_at: endsAt,
    current_module: null,
    completed_modules: 0,
    selected_domains: DOMAINS,
    internet_required: false,
    report_path: REPORT_PATH,
  });

  appendLog({
    type: "local_study_started",
    started_at: startedAt,
    ends_at: endsAt,
    selected_domains: DOMAINS,
    rationale: "owner requested 10 minute local-only medicine and surgery study with internet disabled",
  });

  const checkpoints: Array<Record<string, unknown>> = [];

  try {
    for (let index = 0; index < MODULES.length; index += 1) {
      const module = MODULES[index]!;
      writeState({
        status: "running",
        profile: "10m_local_medicine_surgery",
        started_at: startedAt,
        ends_at: endsAt,
        current_module: module,
        completed_modules: index,
        selected_domains: DOMAINS,
        internet_required: false,
        report_path: REPORT_PATH,
      });

      const moduleStarted = nowIso();
      appendLog({ type: "module_started", module, started_at: moduleStarted });

      if (module.action === "expression_verify") {
        runNodeTool("tools/nyra-expression-verify-exercise.ts");
      }
      if (module.action === "assimilate") {
        runNodeTool("tools/nyra-assimilate-essence.ts");
      }

      await sleep(module.duration_minutes * 60_000);

      const moduleEnded = nowIso();
      const checkpoint = {
        module_id: module.id,
        label: module.label,
        action: module.action,
        note: module.note,
        started_at: moduleStarted,
        ended_at: moduleEnded,
        duration_minutes: module.duration_minutes,
        metrics: collectMetrics(),
      };
      checkpoints.push(checkpoint);
      appendLog({ type: "module_completed", ...checkpoint });
    }

    const report = {
      runner: "nyra_local_medicine_surgery_10m",
      generated_at: nowIso(),
      started_at: startedAt,
      finished_at: nowIso(),
      profile: "10m_local_medicine_surgery",
      selected_domains: DOMAINS,
      total_minutes: 10,
      internet_used: false,
      modules_completed: MODULES.length,
      checkpoints,
      final_metrics: collectMetrics(),
      note: "10 minute local-only consolidation using already distilled material and no web access",
    };

    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    writeState({
      status: "completed",
      profile: "10m_local_medicine_surgery",
      started_at: startedAt,
      ends_at: endsAt,
      current_module: null,
      completed_modules: MODULES.length,
      selected_domains: DOMAINS,
      internet_required: false,
      report_path: REPORT_PATH,
    });
    appendLog({ type: "local_study_completed", finished_at: nowIso(), report_path: REPORT_PATH });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    writeState({
      status: "failed",
      profile: "10m_local_medicine_surgery",
      started_at: startedAt,
      ends_at: endsAt,
      current_module: null,
      completed_modules: checkpoints.length,
      selected_domains: DOMAINS,
      internet_required: false,
      report_path: REPORT_PATH,
      error: message,
    });
    appendLog({ type: "local_study_failed", at: nowIso(), error: message });
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

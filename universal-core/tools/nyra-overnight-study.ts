import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

type StudyModule = {
  id: string;
  label: string;
  duration_minutes: number;
  source_urls?: string[];
  local_files?: string[];
  focus: string[];
};

type StudyCheckpoint = {
  module_id: string;
  module_label: string;
  started_at: string;
  ended_at?: string;
  duration_minutes: number;
  fetched_sources: string[];
  local_sources: string[];
  distilled_chars: number;
  focus: string[];
  note: string;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "runtime", "nyra-overnight-study");
const SOURCE_DIR = join(RUNTIME_DIR, "sources");
const LOG_PATH = join(RUNTIME_DIR, "study_log.jsonl");
const STATE_PATH = join(RUNTIME_DIR, "study_state_latest.json");
const REPORT_PATH = join(RUNTIME_DIR, "study_report_latest.json");

const MODULES: StudyModule[] = [
  {
    id: "algebra",
    label: "Algebra",
    duration_minutes: 45,
    source_urls: [
      "https://www.khanacademy.org/math/algebra-home/alg-basic-eq-ineq",
      "https://www.khanacademy.org/math/algebra-home/alg-linear-eq-func",
      "https://www.khanacademy.org/math/algebra-home/alg-quadratics",
    ],
    local_files: [
      "universal-core/runtime/nyra-learning/nyra_algebra_learning_pack_latest.json",
    ],
    focus: [
      "struttura delle equazioni",
      "scelta del metodo",
      "verifica della soluzione",
    ],
  },
  {
    id: "applied_math",
    label: "Matematica applicata",
    duration_minutes: 45,
    source_urls: [
      "https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/",
      "https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/",
    ],
    focus: [
      "funzioni e variazione",
      "calcolo per problemi reali",
      "strutture lineari e modelli",
    ],
  },
  {
    id: "general_physics",
    label: "Fisica generale",
    duration_minutes: 45,
    source_urls: [
      "https://ocw.mit.edu/courses/8-01sc-classical-mechanics-fall-2016/",
      "https://www.khanacademy.org/science/physics",
    ],
    focus: [
      "moto e forze",
      "energia e conservazione",
      "modelli fisici di base",
    ],
  },
  {
    id: "quantum_physics",
    label: "Fisica quantistica",
    duration_minutes: 45,
    source_urls: [
      "https://ocw.mit.edu/courses/8-04-quantum-physics-i-spring-2016/",
      "https://www.khanacademy.org/science/physics/quantum-physics",
    ],
    focus: [
      "stato e misura",
      "probabilita quantistica",
      "lettura concettuale senza inventare scorciatoie",
    ],
  },
  {
    id: "computer_engineering",
    label: "Ingegneria informatica",
    duration_minutes: 60,
    source_urls: [
      "https://cs50.harvard.edu/x/2024/",
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
      "https://www.typescriptlang.org/docs/",
    ],
    local_files: [
      "universal-core/packages/branches/assistant/src/index.ts",
      "universal-core/packages/contracts/src/index.ts",
    ],
    focus: [
      "struttura di sistemi software",
      "interfacce e contratti",
      "ragionamento su stato e performance",
    ],
  },
  {
    id: "coding_speed",
    label: "Scrittura di codice veloce",
    duration_minutes: 60,
    source_urls: [
      "https://doc.rust-lang.org/book/",
      "https://www.typescriptlang.org/docs/handbook/intro.html",
    ],
    local_files: [
      "universal-core/tools/owner-private-entity-shell.ts",
      "universal-core/tests/v7-pure-influence-benchmark-test.ts",
    ],
    focus: [
      "pattern ripetibili",
      "funzioni piccole e verificabili",
      "velocita senza perdere correttezza",
    ],
  },
  {
    id: "self_diagnosis",
    label: "Autodiagnosi e comportamento",
    duration_minutes: 60,
    local_files: [
      "AGENTS.md",
      "runtime/owner-private-entity/owner_behavior_profile.json",
      "runtime/owner-private-entity/sales_bridge_state.json",
      "universal-core/tools/owner-private-entity-shell.ts",
    ],
    focus: [
      "capire i propri colli",
      "distinguere fallback e risposta utile",
      "tenere memoria di drift e owner-first",
    ],
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDirs(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(SOURCE_DIR, { recursive: true });
}

function appendLog(entry: unknown): void {
  appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
}

function writeState(state: unknown): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function safeReadLocalFile(path: string): string {
  const absolutePath = join(ROOT, path);
  if (!existsSync(absolutePath)) return "";
  return readFileSync(absolutePath, "utf8");
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fetchUrl(url: string): string {
  const raw = execFileSync("/usr/bin/curl", ["-L", "-s", url], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return stripHtml(raw).slice(0, 24000);
}

function sourceFileName(moduleId: string, index: number): string {
  return `${moduleId}_${String(index + 1).padStart(2, "0")}.txt`;
}

function buildModuleNote(module: StudyModule, fetched: string[], localBodies: string[]): string {
  const totalChars = fetched.reduce((sum, body) => sum + body.length, 0) + localBodies.reduce((sum, body) => sum + body.length, 0);
  return `Studio ${module.label}: fonti remote ${fetched.length}, fonti locali ${localBodies.length}, corpus distillato ${totalChars} caratteri. Focus: ${module.focus.join(", ")}.`;
}

async function run(): Promise<void> {
  ensureDirs();
  const startedAt = nowIso();
  const timeScale = Number(process.env.NYRA_STUDY_TIME_SCALE ?? "1");
  const effectiveScale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1;
  const totalMinutes = MODULES.reduce((sum, module) => sum + module.duration_minutes, 0);
  const endsAt = new Date(Date.now() + totalMinutes * 60_000 * effectiveScale).toISOString();

  writeState({
    status: "running",
    started_at: startedAt,
    ends_at: endsAt,
      total_minutes: totalMinutes,
      time_scale: effectiveScale,
      current_module: null,
      completed_modules: 0,
  });

  appendLog({
    type: "study_started",
    started_at: startedAt,
    ends_at: endsAt,
    total_minutes: totalMinutes,
    modules: MODULES.map((module) => ({
      id: module.id,
      label: module.label,
      duration_minutes: module.duration_minutes,
    })),
  });

  const checkpoints: StudyCheckpoint[] = [];

  for (let index = 0; index < MODULES.length; index += 1) {
    const module = MODULES[index]!;
    const moduleStartedAt = nowIso();
    writeState({
      status: "running",
      started_at: startedAt,
      ends_at: endsAt,
      total_minutes: totalMinutes,
      time_scale: effectiveScale,
      current_module: module,
      completed_modules: index,
    });

    const fetchedBodies: string[] = [];
    const fetchedSources: string[] = [];
    for (const [urlIndex, url] of (module.source_urls ?? []).entries()) {
      try {
        const body = fetchUrl(url);
        fetchedBodies.push(body);
        fetchedSources.push(url);
        writeFileSync(join(SOURCE_DIR, sourceFileName(module.id, urlIndex)), body);
      } catch (error) {
        appendLog({
          type: "source_fetch_error",
          module_id: module.id,
          url,
          error: error instanceof Error ? error.message : String(error),
          at: nowIso(),
        });
      }
    }

    const localBodies = (module.local_files ?? [])
      .map((path) => safeReadLocalFile(path))
      .filter((body) => body.length > 0)
      .map((body) => body.slice(0, 24000));

    const checkpoint: StudyCheckpoint = {
      module_id: module.id,
      module_label: module.label,
      started_at: moduleStartedAt,
      duration_minutes: module.duration_minutes,
      fetched_sources: fetchedSources,
      local_sources: module.local_files ?? [],
      distilled_chars: fetchedBodies.reduce((sum, body) => sum + body.length, 0) + localBodies.reduce((sum, body) => sum + body.length, 0),
      focus: module.focus,
      note: buildModuleNote(module, fetchedBodies, localBodies),
    };

    appendLog({
      type: "module_started",
      ...checkpoint,
    });

    await sleep(module.duration_minutes * 60_000 * effectiveScale);

    checkpoint.ended_at = nowIso();
    checkpoints.push(checkpoint);
    appendLog({
      type: "module_completed",
      ...checkpoint,
    });
  }

  const finishedAt = nowIso();
  const report = {
    status: "completed",
    started_at: startedAt,
    finished_at: finishedAt,
    total_minutes: totalMinutes,
    time_scale: effectiveScale,
    modules_completed: checkpoints.length,
    checkpoints,
    final_note:
      "Studio notturno completato. Il processo ha acquisito fonti, letto materiali locali, mantenuto checkpoint temporali reali e prodotto una base interrogabile. Non implica padronanza completa dei domini in una sola notte.",
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  writeState({
    status: "completed",
    started_at: startedAt,
    finished_at: finishedAt,
    total_minutes: totalMinutes,
    time_scale: effectiveScale,
    report_path: REPORT_PATH,
  });
  appendLog({
    type: "study_completed",
    finished_at: finishedAt,
    report_path: REPORT_PATH,
  });
}

run().catch((error) => {
  ensureDirs();
  const failedAt = nowIso();
  writeState({
    status: "failed",
    failed_at: failedAt,
    error: error instanceof Error ? error.message : String(error),
  });
  appendLog({
    type: "study_failed",
    failed_at: failedAt,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

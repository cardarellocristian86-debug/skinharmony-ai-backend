import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

type Module = {
  id: string;
  label: string;
  duration_minutes: number;
  domains: string[];
  note: string;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-autonomous-study");
const LEARNING_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORTS_DIR = join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning");
const STATE_PATH = join(RUNTIME_DIR, "nyra_horizon_sidecar_study_state_latest.json");
const LOG_PATH = join(RUNTIME_DIR, "nyra_horizon_sidecar_study_log.jsonl");
const REPORT_PATH = join(REPORTS_DIR, "nyra_horizon_sidecar_study_latest.json");
const WEB_STATE_PATH = join(LEARNING_DIR, "nyra_web_access_state.json");
const QUARANTINE_PATH = join(LEARNING_DIR, "nyra_soft_domains_quarantine_latest.json");

const MODULES: Module[] = [
  {
    id: "psychology_cognition",
    label: "Psicologia + cognitivita",
    duration_minutes: 20,
    domains: ["psychology_human_behavior", "cognitive_science"],
    note: "comportamento umano, emozione, memoria, bias, comprensione e ragionamento",
  },
  {
    id: "dialectic_language",
    label: "Dialettica + lessico + grammatica",
    duration_minutes: 20,
    domains: ["dialectic_rhetoric", "lexicon_grammar"],
    note: "argomentazione, fallacie, precisione lessicale, grammatica e chiarezza",
  },
  {
    id: "geography_history",
    label: "Geografia + storia",
    duration_minutes: 20,
    domains: ["geography", "history_civilizations"],
    note: "spazio, territori, civilta, istituzioni, memoria storica e contesto",
  },
  {
    id: "hacker_mindset_defense",
    label: "Hacker mindset difensivo",
    duration_minutes: 20,
    domains: ["hacker_mindset_defense", "cyber_defense"],
    note: "mentalita avversaria solo per difesa, riconoscimento minacce e hardening",
  },
  {
    id: "integrate_verify",
    label: "Quarantena e verifica",
    duration_minutes: 20,
    domains: ["natural_expression", "narrative", "autonomy_progression"],
    note: "valuta i nuovi domini senza assimilarli nel core reasoning",
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

function writeState(state: unknown): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function readJsonSafe<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function runNodeTool(tool: string, args: string[] = []): void {
  execFileSync(process.execPath, ["--experimental-strip-types", tool, ...args], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
}

function ensureWebOnNeed(): void {
  const current = readJsonSafe<Record<string, unknown>>(WEB_STATE_PATH) ?? {};
  writeFileSync(
    WEB_STATE_PATH,
    JSON.stringify(
      {
        ...current,
        access_mode: "free_explore",
        trigger_mode: "on_need",
        granted_at: current["granted_at"] ?? nowIso(),
        note: "horizon sidecar: psychology, cognition, language, geography, history, hacker mindset defensive only",
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });
  ensureWebOnNeed();

  const startedAt = nowIso();
  const totalMinutes = MODULES.reduce((sum, module) => sum + module.duration_minutes, 0);
  const endsAt = new Date(Date.now() + totalMinutes * 60_000).toISOString();
  const checkpoints: Array<Record<string, unknown>> = [];

  writeState({
    status: "running",
    profile: "horizon_sidecar_low_impact",
    started_at: startedAt,
    ends_at: endsAt,
    total_minutes: totalMinutes,
    completed_modules: 0,
    current_module: null,
    cyber_policy: "defensive_only",
  });
  appendLog({ type: "horizon_sidecar_started", started_at: startedAt, ends_at: endsAt, total_minutes: totalMinutes });

  for (let index = 0; index < MODULES.length; index += 1) {
    const module = MODULES[index]!;
    const started = nowIso();
    writeState({
      status: "running",
      profile: "horizon_sidecar_low_impact",
      started_at: startedAt,
      ends_at: endsAt,
      total_minutes: totalMinutes,
      completed_modules: index,
      current_module: module,
      cyber_policy: "defensive_only",
    });
    appendLog({ type: "module_started", module, started_at: started });

    const actions: string[] = [];
    runNodeTool("tools/nyra-web-explore.ts", module.domains);
    actions.push(`web_explore:${module.domains.join(",")}`);

    if (module.id === "integrate_verify") {
      runNodeTool("tools/nyra-domain-verify-exercise.ts");
      runNodeTool("tools/nyra-expression-verify-exercise.ts");
      actions.push("domain_verify");
      actions.push("expression_verify");
      actions.push("soft_quarantine_no_core_assimilation");
    }

    await sleep(module.duration_minutes * 60_000);
    const checkpoint = {
      module_id: module.id,
      module_label: module.label,
      domains: module.domains,
      note: module.note,
      actions,
      started_at: started,
      ended_at: nowIso(),
      duration_minutes: module.duration_minutes,
    };
    checkpoints.push(checkpoint);
    appendLog({ type: "module_completed", ...checkpoint });
  }

  const report = {
    runner: "nyra_horizon_sidecar_study",
    status: "completed",
    generated_at: nowIso(),
    started_at: startedAt,
    finished_at: nowIso(),
    total_minutes: totalMinutes,
    cyber_policy: "defensive_only",
    integration_policy: {
      core_reasoning: "hard_domains_only",
      soft_domains: "quarantined_expression_context",
      immediate_core_assimilation: false,
      rationale:
        "hard domains provide structure; soft domains provide interpretation. They must not be merged into core reasoning before controlled validation.",
    },
    studied_domains: [...new Set(MODULES.flatMap((module) => module.domains))],
    checkpoints,
    report_note: "Sidecar leggero: allarga gli orizzonti senza fermare il runner principale da 5 ore e senza contaminare il core.",
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  writeFileSync(
    QUARANTINE_PATH,
    JSON.stringify(
      {
        version: "nyra_soft_domains_quarantine_v1",
        generated_at: report.generated_at,
        status: "quarantined",
        core_reasoning_mutation_allowed: false,
        expression_layer_use_allowed: true,
        domains: report.studied_domains,
        risks_to_watch: [
          "more beautiful answers but weaker decisions",
          "more words but less precision",
          "rhetorical confidence replacing hard verification",
        ],
        release_gate: [
          "finish broad 5h runner",
          "compare validation accuracy before and after soft exposure",
          "check concise decision test",
          "promote only expression improvements, not reasoning weights",
        ],
      },
      null,
      2,
    ),
  );
  writeState({
    status: "completed",
    profile: "horizon_sidecar_low_impact",
    finished_at: report.finished_at,
    report_path: REPORT_PATH,
    quarantine_path: QUARANTINE_PATH,
    cyber_policy: "defensive_only",
  });
  appendLog({ type: "horizon_sidecar_completed", finished_at: report.finished_at, report_path: REPORT_PATH });
}

main().catch((error) => {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const message = error instanceof Error ? error.message : String(error);
  writeState({ status: "failed", profile: "horizon_sidecar_low_impact", failed_at: nowIso(), error: message });
  appendLog({ type: "horizon_sidecar_failed", failed_at: nowIso(), error: message });
  process.exitCode = 1;
});

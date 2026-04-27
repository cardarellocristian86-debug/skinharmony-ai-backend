import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

type ModuleMode = "web_distill" | "practice" | "architecture_lab" | "defense_lab" | "integration";

type StudyModule = {
  id: string;
  label: string;
  duration_minutes: number;
  domains: string[];
  mode: ModuleMode;
  note: string;
};

type Checkpoint = {
  module_id: string;
  module_label: string;
  mode: ModuleMode;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  domains: string[];
  note: string;
  actions: string[];
  metrics: Record<string, unknown>;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-autonomous-study");
const LEARNING_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORTS_DIR = join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning");
const STATE_PATH = join(RUNTIME_DIR, "nyra_owner_autonomous_8h_study_state_latest.json");
const LOG_PATH = join(RUNTIME_DIR, "nyra_owner_autonomous_8h_study_log.jsonl");
const REPORT_PATH = join(REPORTS_DIR, "nyra_owner_autonomous_8h_study_latest.json");
const PID_PATH = join(RUNTIME_DIR, "nyra_owner_autonomous_8h_study.pid");
const WEB_STATE_PATH = join(LEARNING_DIR, "nyra_web_access_state.json");
const EVENT_ARCHITECTURE_PACK_PATH = join(LEARNING_DIR, "nyra_event_narrative_architecture_pack_latest.json");
const SOFTWARE_ARCHITECTURE_PACK_PATH = join(LEARNING_DIR, "nyra_software_architecture_practice_pack_latest.json");
const DOMAIN_VERIFY_PATH = join(LEARNING_DIR, "nyra_domain_verify_exercise_latest.json");
const EXPRESSION_VERIFY_PATH = join(LEARNING_DIR, "nyra_expression_verify_exercise_latest.json");
const ESSENCE_PATH = join(LEARNING_DIR, "nyra_assimilated_essence_latest.json");
const STORAGE_BUDGET_BYTES = 10 * 1024 * 1024 * 1024;

const MODULES: StudyModule[] = [
  {
    id: "self_selected_scope",
    label: "Scelta autonoma campo studio",
    duration_minutes: 30,
    domains: ["natural_expression", "narrative", "computer_engineering"],
    mode: "web_distill",
    note: "Nyra sceglie il blocco utile: parlare meglio, strutturare eventi, capire sistemi.",
  },
  {
    id: "natural_speech_1",
    label: "Parlato chiaro 1",
    duration_minutes: 45,
    domains: ["natural_expression", "dialectic_rhetoric", "lexicon_grammar"],
    mode: "practice",
    note: "risposte comprensibili: punto, motivo, primo passo, dato mancante.",
  },
  {
    id: "narrative_events",
    label: "Semantica narrativa eventi",
    duration_minutes: 45,
    domains: ["narrative", "natural_expression"],
    mode: "practice",
    note: "trasformare eventi in sequenza causale: cosa accade, perche conta, cosa cambia, prossima mossa.",
  },
  {
    id: "software_architecture_1",
    label: "Architettura software 1",
    duration_minutes: 45,
    domains: ["computer_engineering", "server_runtime_infrastructure", "safe_relay_architecture"],
    mode: "architecture_lab",
    note: "runtime, moduli, stato, memoria, code, verify, limiti e osservabilita.",
  },
  {
    id: "defensive_hacker_mindset",
    label: "Hacker mindset difensivo",
    duration_minutes: 45,
    domains: ["hacker_mindset_defense", "cyber_defense", "safe_relay_architecture"],
    mode: "defense_lab",
    note: "capire l avversario solo per difesa: phishing, accessi, contenimento, hardening.",
  },
  {
    id: "verify_integrate_1",
    label: "Verifica e integrazione 1",
    duration_minutes: 45,
    domains: ["domain_verify", "expression_verify", "essence_alignment"],
    mode: "integration",
    note: "misura se lo studio passa da lettura a memoria runtime verificabile.",
  },
  {
    id: "natural_speech_2",
    label: "Parlato chiaro 2",
    duration_minutes: 45,
    domains: ["natural_expression", "narrative"],
    mode: "practice",
    note: "ridurre frasi generiche: risposta corta, espansione utile, scelta operativa.",
  },
  {
    id: "software_architecture_2",
    label: "Architettura software 2",
    duration_minutes: 45,
    domains: ["computer_engineering", "server_runtime_infrastructure"],
    mode: "architecture_lab",
    note: "mettere in pratica: snapshot, action router, memory writer, verify obbligatoria.",
  },
  {
    id: "owner_work_application",
    label: "Applicazione lavoro owner",
    duration_minutes: 45,
    domains: ["work_economics", "sales_pipeline", "marketing_strategy"],
    mode: "practice",
    note: "collegare studio a lavoro reale: priorita, liquidita, protezione owner, niente promesse inventate.",
  },
  {
    id: "security_architecture_practice",
    label: "Architettura sicurezza pratica",
    duration_minutes: 45,
    domains: ["cyber_defense", "hacker_mindset_defense", "safe_relay_architecture"],
    mode: "defense_lab",
    note: "disegnare difese: confini, permessi, audit, rollback, conferma umana sulle azioni esterne.",
  },
  {
    id: "verify_integrate_2",
    label: "Verifica e integrazione 2",
    duration_minutes: 45,
    domains: ["domain_verify", "expression_verify", "essence_alignment"],
    mode: "integration",
    note: "secondo controllo: accuratezza, parlato, essenza, router e robustezza.",
  },
  {
    id: "final_consolidation",
    label: "Consolidamento finale",
    duration_minutes: 45,
    domains: ["natural_expression", "narrative", "computer_engineering", "cyber_defense"],
    mode: "integration",
    note: "chiusura: report finale, colli rimasti, prossima azione concreta.",
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonSafe<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
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

function dirSize(path: string): number {
  if (!existsSync(path)) return 0;
  const stats = statSync(path);
  if (stats.isFile()) return stats.size;
  if (!stats.isDirectory()) return 0;
  return readdirSync(path).reduce((sum, entry) => sum + dirSize(join(path, entry)), 0);
}

function ensureWebOnNeed(): void {
  const current = readJsonSafe<Record<string, unknown>>(WEB_STATE_PATH) ?? {};
  mkdirSync(LEARNING_DIR, { recursive: true });
  writeFileSync(
    WEB_STATE_PATH,
    JSON.stringify(
      {
        ...current,
        access_mode: "free_explore",
        trigger_mode: "on_need",
        granted_at: current["granted_at"] ?? nowIso(),
        source_config: current["source_config"] ?? join(ROOT, "universal-core", "config", "nyra_web_study_sources_v2.json"),
        owner_request: "8h autonomous study: speech, narrative events, software architecture, defensive security",
        cyber_policy: "defensive_only",
      },
      null,
      2,
    ),
  );
}

function collectMetrics(): Record<string, unknown> {
  const domain = readJsonSafe<Record<string, unknown>>(DOMAIN_VERIFY_PATH) ?? {};
  const expression = readJsonSafe<Record<string, unknown>>(EXPRESSION_VERIFY_PATH) ?? {};
  const essence = readJsonSafe<Record<string, unknown>>(ESSENCE_PATH) ?? {};
  return {
    domain_validation_accuracy: domain["validation_accuracy"],
    domain_hard_replay_accuracy: domain["hard_final_accuracy"],
    expression_validation_accuracy: expression["validation_accuracy"],
    expression_hard_replay_accuracy: expression["hard_final_accuracy"],
    dominant_domains: essence["dominant_domains"] ?? [],
    next_hunger_domains: essence["next_hunger_domains"] ?? [],
    disk_used_bytes_runtime_learning: dirSize(LEARNING_DIR),
    storage_budget_bytes: STORAGE_BUDGET_BYTES,
  };
}

function writeEventNarrativePack(moduleId: string): void {
  const existing = readJsonSafe<{ events?: unknown[] }>(EVENT_ARCHITECTURE_PACK_PATH);
  const events = [
    ...(existing?.events ?? []),
    {
      generated_at: nowIso(),
      source_module: moduleId,
      frame: "evento -> causa -> rischio -> scelta -> prova -> prossima azione",
      rules: [
        "parlare per eventi, non per etichette interne",
        "ogni risposta deve dire cosa e cambiato nel mondo operativo",
        "se manca un dato, dichiararlo prima di proporre una decisione",
        "la forma narrativa serve a farsi capire; non deve sostituire la verifica",
      ],
      drills: [
        {
          prompt: "Nyra, che sta succedendo?",
          target: "Il fatto e questo. Conta per questo motivo. Il rischio e questo. La prima mossa e questa. Il dato mancante e questo.",
        },
        {
          prompt: "Nyra, cosa fai ora?",
          target: "Scelgo una priorita, spiego perche, blocco le azioni rischiose e preparo il passo verificabile.",
        },
      ],
    },
  ].slice(-48);
  writeFileSync(
    EVENT_ARCHITECTURE_PACK_PATH,
    JSON.stringify(
      {
        version: "nyra_event_narrative_architecture_v1",
        generated_at: nowIso(),
        purpose: "rendere Nyra comprensibile senza farle recitare poesia",
        events,
      },
      null,
      2,
    ),
  );
}

function writeSoftwareArchitecturePack(moduleId: string): void {
  const existing = readJsonSafe<{ modules?: unknown[] }>(SOFTWARE_ARCHITECTURE_PACK_PATH);
  const modules = [
    ...(existing?.modules ?? []),
    {
      generated_at: nowIso(),
      source_module: moduleId,
      architecture_contract: {
        input: "owner request or system event",
        parser: "semantic intent + missing data detection",
        core: "judge/select final variant",
        nyra: "organize, express, prepare executable plan",
        action_router: "confirm_execute for external or risky actions",
        memory_writer: "runtime pack/snapshot only; no owner profile pollution",
        verify: "required before claiming improvement",
      },
      defensive_security: [
        "least privilege",
        "audit log",
        "no blind external execution",
        "secret rotation path",
        "rollback or containment path",
        "cyber learning is defensive only",
      ],
    },
  ].slice(-48);
  writeFileSync(
    SOFTWARE_ARCHITECTURE_PACK_PATH,
    JSON.stringify(
      {
        version: "nyra_software_architecture_practice_v1",
        generated_at: nowIso(),
        purpose: "trasformare studio in architettura Nyra piu lavorabile",
        modules,
      },
      null,
      2,
    ),
  );
}

function runModule(module: StudyModule): string[] {
  const actions: string[] = [];

  if (module.mode === "web_distill" || module.mode === "practice" || module.mode === "architecture_lab" || module.mode === "defense_lab") {
    runNodeTool("tools/nyra-advanced-study.ts", ["auto", ...module.domains]);
    actions.push(`advanced_study:${module.domains.join(",")}`);
  }

  if (module.mode === "practice") {
    runNodeTool("tools/nyra-expression-verify-exercise.ts");
    writeEventNarrativePack(module.id);
    actions.push("expression_verify_exercise");
    actions.push("event_narrative_pack");
  }

  if (module.mode === "architecture_lab") {
    runNodeTool("tools/nyra-dialogue-architecture-lab.ts");
    writeSoftwareArchitecturePack(module.id);
    actions.push("dialogue_architecture_lab");
    actions.push("software_architecture_practice_pack");
  }

  if (module.mode === "defense_lab") {
    runNodeTool("tools/nyra-cyber-learning-runtime.ts");
    runNodeTool("tools/nyra_cyber_web_study.ts");
    writeSoftwareArchitecturePack(module.id);
    actions.push("cyber_learning_runtime_defensive");
    actions.push("cyber_web_study_defensive");
    actions.push("software_security_practice_pack");
  }

  if (module.mode === "integration") {
    runNodeTool("tools/nyra-domain-verify-exercise.ts");
    runNodeTool("tools/nyra-expression-verify-exercise.ts");
    runNodeTool("tools/nyra-assimilate-essence.ts");
    runNodeTool("tools/nyra_essence_alignment_runtime.ts");
    actions.push("domain_verify_exercise");
    actions.push("expression_verify_exercise");
    actions.push("assimilate_essence");
    actions.push("essence_alignment");

    if (module.id === "final_consolidation") {
      runNodeTool("tools/nyra-broad-spectrum-sweep.ts");
      runNodeTool("tools/nyra-global-router-benchmark.ts");
      actions.push("broad_spectrum_sweep");
      actions.push("global_router_benchmark");
    }
  }

  return actions;
}

async function main(): Promise<void> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(PID_PATH, String(process.pid));
  ensureWebOnNeed();

  const startedAt = nowIso();
  const totalMinutes = MODULES.reduce((sum, module) => sum + module.duration_minutes, 0);
  const endsAt = new Date(Date.now() + totalMinutes * 60_000).toISOString();
  const checkpoints: Checkpoint[] = [];

  writeState({
    status: "running",
    profile: "owner_autonomous_8h_study",
    started_at: startedAt,
    ends_at: endsAt,
    total_minutes: totalMinutes,
    completed_modules: 0,
    current_module: null,
    home_safe_mode: true,
    cyber_policy: "defensive_only",
    storage_budget_bytes: STORAGE_BUDGET_BYTES,
    report_path: REPORT_PATH,
  });
  appendLog({ type: "owner_autonomous_8h_started", started_at: startedAt, ends_at: endsAt, total_minutes: totalMinutes });

  for (let index = 0; index < MODULES.length; index += 1) {
    const module = MODULES[index]!;
    const started = nowIso();
    writeState({
      status: "running",
      profile: "owner_autonomous_8h_study",
      started_at: startedAt,
      ends_at: endsAt,
      total_minutes: totalMinutes,
      completed_modules: index,
      current_module: module,
      home_safe_mode: true,
      cyber_policy: "defensive_only",
      storage_budget_bytes: STORAGE_BUDGET_BYTES,
      report_path: REPORT_PATH,
    });
    appendLog({ type: "module_started", module, started_at: started });

    const actions = runModule(module);
    await sleep(module.duration_minutes * 60_000);

    const checkpoint: Checkpoint = {
      module_id: module.id,
      module_label: module.label,
      mode: module.mode,
      started_at: started,
      ended_at: nowIso(),
      duration_minutes: module.duration_minutes,
      domains: module.domains,
      note: module.note,
      actions,
      metrics: collectMetrics(),
    };
    checkpoints.push(checkpoint);
    appendLog({ type: "module_completed", ...checkpoint });
  }

  const report = {
    runner: "nyra_owner_autonomous_8h_study",
    status: "completed",
    generated_at: nowIso(),
    started_at: startedAt,
    finished_at: nowIso(),
    total_minutes: totalMinutes,
    profile: "owner_autonomous_8h_study",
    owner_confirmation: "granted_before_start",
    cyber_policy: "defensive_only",
    storage_policy: {
      budget_bytes: STORAGE_BUDGET_BYTES,
      actual_learning_dir_bytes: dirSize(LEARNING_DIR),
      note: "budget massimo autorizzato; il runner usa distillazione semantica e non riempie disco inutilmente",
    },
    studied_domains: [...new Set(MODULES.flatMap((module) => module.domains))],
    practice_outputs: {
      event_narrative_architecture_pack: EVENT_ARCHITECTURE_PACK_PATH,
      software_architecture_practice_pack: SOFTWARE_ARCHITECTURE_PACK_PATH,
    },
    checkpoints,
    final_metrics: collectMetrics(),
    autonomy_boundary:
      "Nyra apprende come pack/runtime/snapshot e verifica; non vengono dichiarate coscienza autonoma, capacita garantite o azioni esterne senza conferma.",
    next_bottleneck:
      "portare il miglioramento del parlato e dell architettura nel path live della shell senza sporcare il profilo owner e senza bypassare Core come giudice.",
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  writeState({
    status: "completed",
    profile: "owner_autonomous_8h_study",
    finished_at: report.finished_at,
    total_minutes: totalMinutes,
    report_path: REPORT_PATH,
    home_safe_mode: true,
    cyber_policy: "defensive_only",
  });
  appendLog({ type: "owner_autonomous_8h_completed", finished_at: report.finished_at, report_path: REPORT_PATH });
}

main().catch((error) => {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const message = error instanceof Error ? error.message : String(error);
  writeState({
    status: "failed",
    profile: "owner_autonomous_8h_study",
    failed_at: nowIso(),
    home_safe_mode: true,
    cyber_policy: "defensive_only",
    error: message,
  });
  appendLog({ type: "owner_autonomous_8h_failed", failed_at: nowIso(), error: message });
  process.exitCode = 1;
});

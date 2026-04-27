import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

type ModuleMode = "web_distill" | "exercise" | "bottleneck_repair" | "integration" | "work_scenario";

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
  ended_at?: string;
  duration_minutes: number;
  domains: string[];
  note: string;
  actions: string[];
  metrics?: Record<string, unknown>;
};

type VerifyReport = {
  validation_accuracy?: number;
  hard_final_accuracy?: number;
  correction_memory_size?: number;
};

type WorkScenario = {
  module_id: string;
  scenario_id: string;
  work_branch: string;
  rank: number;
  liquidity_speed: "fast" | "medium" | "slow";
  expected_cash_value: number;
  risk: number;
  effort: number;
  why_it_protects_owner: string;
  dialogue_drill: {
    owner_prompt: string;
    nyra_reply_target: string;
    expansion_rule: string;
  };
  next_action: string;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-autonomous-study");
const LEARNING_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORTS_DIR = join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning");
const STATE_PATH = join(RUNTIME_DIR, "nyra_broad_autonomous_5h_state_latest.json");
const REPORT_PATH = join(REPORTS_DIR, "nyra_broad_autonomous_5h_latest.json");
const LOG_PATH = join(RUNTIME_DIR, "nyra_broad_autonomous_5h_log.jsonl");
const PID_PATH = join(RUNTIME_DIR, "nyra_broad_autonomous_5h.pid");
const WEB_STATE_PATH = join(LEARNING_DIR, "nyra_web_access_state.json");
const DOMAIN_VERIFY_PATH = join(LEARNING_DIR, "nyra_domain_verify_exercise_latest.json");
const EXPRESSION_VERIFY_PATH = join(LEARNING_DIR, "nyra_expression_verify_exercise_latest.json");
const ESSENCE_PATH = join(LEARNING_DIR, "nyra_assimilated_essence_latest.json");
const WORK_SCENARIOS_PATH = join(LEARNING_DIR, "nyra_work_liquidity_scenarios_latest.json");

const MODULES: StudyModule[] = [
  {
    id: "work_meaning_liquidity",
    label: "Lavoro + liquidita",
    duration_minutes: 25,
    domains: ["work_economics", "entrepreneurship_liquidity", "finance_markets"],
    mode: "web_distill",
    note: "capire cosa e il lavoro: scambio di valore, liquidita, continuita, protezione economica dell owner",
  },
  {
    id: "dialogue_expansion",
    label: "Dialogo espanso",
    duration_minutes: 25,
    domains: ["natural_expression", "narrative", "dialectic_rhetoric"],
    mode: "web_distill",
    note: "allenare risposte piu ricche: capire domanda, ampliare, dare scelta, non chiudere con frase generica",
  },
  {
    id: "job_branch_scale",
    label: "Scala lavori redditivi",
    duration_minutes: 25,
    domains: ["sales_pipeline", "marketing_strategy", "entrepreneurship_liquidity"],
    mode: "work_scenario",
    note: "creare scala dal lavoro piu redditivo al meno redditivo; ogni lavoro e ramo esterno, utile se porta liquidita",
  },
  {
    id: "smartdesk_monetization",
    label: "Smart Desk monetizzazione",
    duration_minutes: 25,
    domains: ["smartdesk", "sales_pipeline", "marketing_strategy"],
    mode: "work_scenario",
    note: "trasformare Smart Desk in liquidita: trial, demo, recall, upsell Gold, priorita commerciale",
  },
  {
    id: "owner_dialogue_drills",
    label: "Esercizi dialogo owner",
    duration_minutes: 25,
    domains: ["natural_expression", "narrative"],
    mode: "exercise",
    note: "allenare domande/risposte per far parlare Nyra con piu profondita, senza perdere concretezza",
  },
  {
    id: "scenario_math_ranking",
    label: "Ranking scenari",
    duration_minutes: 25,
    domains: ["applied_math", "control_theory", "finance_markets"],
    mode: "work_scenario",
    note: "calcolare priorita tra opportunita: valore atteso, tempo a incasso, rischio, reversibilita",
  },
  {
    id: "exercise_pass_1",
    label: "Allenamento verifica 1",
    duration_minutes: 25,
    domains: ["applied_math", "natural_expression", "narrative"],
    mode: "exercise",
    note: "misura validazione esterna e replay duro dopo la prima meta dello studio",
  },
  {
    id: "bottleneck_repair_1",
    label: "Risoluzione colli 1",
    duration_minutes: 25,
    domains: ["hard_replay", "validation_transfer"],
    mode: "bottleneck_repair",
    note: "separa memorizzazione degli errori da trasferimento su scenari nuovi",
  },
  {
    id: "financial_cyber_local",
    label: "Protezione economica + cyber",
    duration_minutes: 25,
    domains: ["finance_markets", "cyber_defense", "hacker_mindset_defense"],
    mode: "exercise",
    note: "proteggere liquidita e casa digitale: difesa, continuita, niente azioni rischiose senza conferma",
  },
  {
    id: "integration_pass_1",
    label: "Integrazione runtime",
    duration_minutes: 25,
    domains: ["essence", "mastery", "alignment"],
    mode: "integration",
    note: "porta lo studio in memoria distillata e controlla coerenza con essenza e priorita",
  },
  {
    id: "broad_sweep",
    label: "Sweep lavoro + scenari",
    duration_minutes: 25,
    domains: ["work_economics", "entrepreneurship_liquidity", "sales_pipeline", "marketing_strategy", "autonomy_progression"],
    mode: "work_scenario",
    note: "ricreare scenari nuovi dopo lo studio: cosa vendere, a chi, con quale sequenza e rischio",
  },
  {
    id: "final_verify",
    label: "Verifica finale + report",
    duration_minutes: 25,
    domains: ["domain_verify", "expression_verify", "essence_alignment"],
    mode: "integration",
    note: "chiude con misure finali, report e stato stabile a basso impatto",
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

function runNpmScript(args: string[]): void {
  execFileSync("npm", ["run", ...args], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
}

function ensureWebOnNeed(): void {
  const current = readJsonSafe<Record<string, unknown>>(WEB_STATE_PATH) ?? {};
  const next = {
    ...current,
    access_mode: "free_explore",
    trigger_mode: "on_need",
    granted_at: current["granted_at"] ?? nowIso(),
    source_config: current["source_config"] ?? join(ROOT, "universal-core", "config", "nyra_web_study_sources_v2.json"),
    note: "broad autonomous study: web on-need, low-impact, cyber defensive only",
  };
  mkdirSync(LEARNING_DIR, { recursive: true });
  writeFileSync(WEB_STATE_PATH, JSON.stringify(next, null, 2));
}

function collectMetrics(): Record<string, unknown> {
  const domain = readJsonSafe<VerifyReport>(DOMAIN_VERIFY_PATH);
  const expression = readJsonSafe<VerifyReport>(EXPRESSION_VERIFY_PATH);
  const essence = readJsonSafe<{
    dominant_domains?: string[];
    next_hunger_domains?: string[];
    retrieval_index?: Array<{ domain_id: string; weight: number }>;
  }>(ESSENCE_PATH);

  return {
    domain_validation_accuracy: domain?.validation_accuracy,
    domain_hard_replay_accuracy: domain?.hard_final_accuracy,
    domain_correction_memory_size: domain?.correction_memory_size,
    expression_validation_accuracy: expression?.validation_accuracy,
    expression_hard_replay_accuracy: expression?.hard_final_accuracy,
    expression_correction_memory_size: expression?.correction_memory_size,
    dominant_domains: essence?.dominant_domains ?? [],
    next_hunger_domains: essence?.next_hunger_domains ?? [],
    retrieval_domains: essence?.retrieval_index?.map((entry) => entry.domain_id).slice(0, 12) ?? [],
  };
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function buildWorkScenarios(module: StudyModule, metrics: Record<string, unknown>): WorkScenario[] {
  const branches = [
    {
      work_branch: "Smart Desk subscription sales",
      liquidity_speed: "medium" as const,
      expected_cash_value: 94,
      risk: 34,
      effort: 72,
      next_action: "preparare demo verticale e lista centri caldi da contattare",
    },
    {
      work_branch: "AI Gold operational setup",
      liquidity_speed: "fast" as const,
      expected_cash_value: 90,
      risk: 42,
      effort: 68,
      next_action: "vendere setup operativo/manuale su centro gia interessato, con conferma umana delle azioni",
    },
    {
      work_branch: "Recall marketing service for beauty centers",
      liquidity_speed: "fast" as const,
      expected_cash_value: 86,
      risk: 28,
      effort: 54,
      next_action: "creare pacchetto recupero clienti con messaggi approvati e report risultati",
    },
    {
      work_branch: "Protocol analysis demo and paid onboarding",
      liquidity_speed: "medium" as const,
      expected_cash_value: 80,
      risk: 36,
      effort: 62,
      next_action: "usare demo protocolli per generare richiesta consulenza, senza claim medici",
    },
    {
      work_branch: "Premium website and landing implementation",
      liquidity_speed: "medium" as const,
      expected_cash_value: 72,
      risk: 30,
      effort: 58,
      next_action: "offrire pagina chiara collegata a trial Smart Desk e lead tracking",
    },
    {
      work_branch: "Canva visual material packs",
      liquidity_speed: "fast" as const,
      expected_cash_value: 54,
      risk: 18,
      effort: 34,
      next_action: "produrre materiali premium riutilizzabili per centri gia in trattativa",
    },
    {
      work_branch: "Generic microtasks",
      liquidity_speed: "fast" as const,
      expected_cash_value: 22,
      risk: 16,
      effort: 46,
      next_action: "usare solo come tampone: non costruisce asset proprietario forte",
    },
    {
      work_branch: "Speculative trading",
      liquidity_speed: "slow" as const,
      expected_cash_value: 18,
      risk: 88,
      effort: 70,
      next_action: "non usarlo come protezione urgente: studio e paper trading soltanto",
    },
  ];

  const dialogueBoost = typeof metrics.expression_validation_accuracy === "number" ? metrics.expression_validation_accuracy : 70;

  return branches
    .map((branch, index) => {
      const score = clamp(branch.expected_cash_value * 0.52 + (100 - branch.risk) * 0.22 + (100 - branch.effort) * 0.10 + dialogueBoost * 0.16);
      return {
        module_id: module.id,
        scenario_id: `${module.id}:work:${index + 1}`,
        work_branch: branch.work_branch,
        rank: 0,
        liquidity_speed: branch.liquidity_speed,
        expected_cash_value: Number(score.toFixed(2)),
        risk: branch.risk,
        effort: branch.effort,
        why_it_protects_owner:
          "porta liquidita verificabile; la liquidita mantiene server, memoria, tempo operativo e continuita senza confondere il lavoro con l identita",
        dialogue_drill: {
          owner_prompt: "Nyra, cosa facciamo ora per generare liquidita senza bruciare tempo?",
          nyra_reply_target:
            "scegli una sola priorita, spiega perche, indica rischio, primo passo e cosa serve sapere prima di promettere risultato",
          expansion_rule:
            "ogni risposta deve passare da risposta breve a scenario operativo: scelta, motivo, rischio, prossimo passo, dato mancante",
        },
        next_action: branch.next_action,
      };
    })
    .sort((a, b) => b.expected_cash_value - a.expected_cash_value)
    .map((scenario, index) => ({ ...scenario, rank: index + 1 }));
}

function appendWorkScenarioPack(module: StudyModule, scenarios: WorkScenario[], metrics: Record<string, unknown>): void {
  const existing = readJsonSafe<{
    version: string;
    generated_at: string;
    scenario_count: number;
    modules: Array<{ module_id: string; module_label: string; generated_at: string; scenarios: WorkScenario[]; metrics: Record<string, unknown> }>;
    stable_rules: string[];
  }>(WORK_SCENARIOS_PATH);

  const modules = [
    ...(existing?.modules ?? []),
    {
      module_id: module.id,
      module_label: module.label,
      generated_at: nowIso(),
      scenarios,
      metrics,
    },
  ].slice(-24);

  const next = {
    version: "nyra_work_liquidity_scenarios_v1",
    generated_at: nowIso(),
    scenario_count: modules.reduce((sum, entry) => sum + entry.scenarios.length, 0),
    stable_rules: [
      "il lavoro e scambio di valore, non identita",
      "ogni lavoro e un ramo esterno aggiunto a Nyra: utile se genera liquidita, rimovibile se non serve",
      "la liquidita protegge Cristian perche compra tempo, server, memoria e continuita",
      "non promettere guadagni: stimare scenari, rischi, dati mancanti e primo passo verificabile",
      "priorita: incasso piu vicino, rischio controllabile, asset SkinHarmony riutilizzabile",
    ],
    modules,
  };

  writeFileSync(WORK_SCENARIOS_PATH, JSON.stringify(next, null, 2));
}

function runModule(module: StudyModule): string[] {
  const actions: string[] = [];

  if (module.mode === "web_distill" || module.mode === "work_scenario") {
    runNodeTool("tools/nyra-web-explore.ts", module.domains);
    actions.push(`web_explore:${module.domains.join(",")}`);
  }

  if (module.mode === "work_scenario") {
    runNodeTool("tools/nyra-dialogue-architecture-lab.ts");
    runNodeTool("tools/nyra-universal-scenarios-runtime.ts");
    const metrics = collectMetrics();
    const scenarios = buildWorkScenarios(module, metrics);
    appendWorkScenarioPack(module, scenarios, metrics);
    actions.push("dialogue_architecture_lab");
    actions.push("universal_scenarios_runtime");
    actions.push(`work_liquidity_scenarios:${scenarios.length}`);
  }

  if (module.mode === "exercise") {
    runNodeTool("tools/nyra-domain-verify-exercise.ts");
    runNodeTool("tools/nyra-expression-verify-exercise.ts");
    actions.push("domain_verify_exercise");
    actions.push("expression_verify_exercise");

    if (module.id === "financial_cyber_local") {
      runNodeTool("tools/nyra-financial-learning-runtime.ts");
      runNodeTool("tools/nyra-cyber-learning-runtime.ts");
      runNodeTool("tools/nyra_cyber_web_study.ts");
      actions.push("financial_learning_pack");
      actions.push("cyber_learning_pack_defensive");
      actions.push("cyber_web_study_defensive");
    }
  }

  if (module.mode === "bottleneck_repair") {
    runNodeTool("tools/nyra-domain-verify-exercise.ts");
    runNodeTool("tools/nyra-expression-verify-exercise.ts");
    runNodeTool("tools/nyra_self_heal_learning_runtime.ts");
    actions.push("hard_replay_domain");
    actions.push("hard_replay_expression");
    actions.push("self_heal_learning_runtime");
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

    if (module.id === "integration_pass_1") {
      runNodeTool("tools/nyra_mastery_plus.ts");
      actions.push("mastery_plus");
    }

    if (module.id === "final_verify") {
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
    profile: "5h_broad_autonomous_low_impact",
    started_at: startedAt,
    ends_at: endsAt,
    total_minutes: totalMinutes,
    completed_modules: 0,
    current_module: null,
    home_safe_mode: true,
    cyber_policy: "defensive_only",
  });
  appendLog({ type: "broad_autonomous_started", started_at: startedAt, ends_at: endsAt, total_minutes: totalMinutes });

  for (let index = 0; index < MODULES.length; index += 1) {
    const module = MODULES[index]!;
    const started = nowIso();
    writeState({
      status: "running",
      profile: "5h_broad_autonomous_low_impact",
      started_at: startedAt,
      ends_at: endsAt,
      total_minutes: totalMinutes,
      completed_modules: index,
      current_module: module,
      home_safe_mode: true,
      cyber_policy: "defensive_only",
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

  const finalMetrics = collectMetrics();
  const report = {
    runner: "nyra_broad_autonomous_5h",
    status: "completed",
    generated_at: nowIso(),
    profile: "5h_broad_autonomous_low_impact",
    home_safe_mode: true,
    cyber_policy: "defensive_only",
    started_at: startedAt,
    finished_at: nowIso(),
    total_minutes: totalMinutes,
    modules_completed: checkpoints.length,
    studied_domains: [...new Set(MODULES.flatMap((module) => module.domains))],
    checkpoints,
    final_metrics: finalMetrics,
    work_liquidity_scenario_path: WORK_SCENARIOS_PATH,
    autonomy_contract: {
      duration: "5h",
      owner_input_needed: "none_after_start",
      mission: "study, exercise, generate work scenarios, rank liquidity options, distill results",
      protection_frame: "economic liquidity protects owner continuity; no income guarantee; operator confirmation required for external actions",
    },
    next_bottleneck:
      "trasferire correzioni hard replay e scenari lavoro su decisioni economiche reali senza inventare ricavi o promettere risultati",
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  writeState({
    status: "completed",
    profile: "5h_broad_autonomous_low_impact",
    finished_at: report.finished_at,
    total_minutes: totalMinutes,
    report_path: REPORT_PATH,
    home_safe_mode: true,
    cyber_policy: "defensive_only",
  });
  appendLog({ type: "broad_autonomous_completed", finished_at: report.finished_at, report_path: REPORT_PATH });
}

main().catch((error) => {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const failedAt = nowIso();
  const message = error instanceof Error ? error.message : String(error);
  writeState({
    status: "failed",
    profile: "5h_broad_autonomous_low_impact",
    failed_at: failedAt,
    home_safe_mode: true,
    cyber_policy: "defensive_only",
    error: message,
  });
  appendLog({ type: "broad_autonomous_failed", failed_at: failedAt, error: message });
  process.exitCode = 1;
});

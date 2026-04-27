import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

type AssimilatedEssence = {
  dominant_domains?: string[];
  next_hunger_domains?: string[];
  study_drive?: {
    why_now?: string[];
    next_actions?: string[];
  };
  retrieval_index?: Array<{
    domain_id: string;
    weight: number;
    cues: string[];
  }>;
};

type StudyMethodState = {
  chosen_method?: {
    id: string;
    label: string;
    cycle: string[];
    reasons: string[];
  };
};

type ModulePlan = {
  id: string;
  label: string;
  domains: string[];
  duration_minutes: number;
  mode: "web_distill" | "verify_integrate" | "reflection";
  note: string;
};

type State = {
  status: "running" | "completed" | "failed";
  profile: "1h_low_impact_autonomous_deepening";
  started_at?: string;
  ends_at?: string;
  current_module?: ModulePlan | null;
  completed_modules?: number;
  selected_domains?: string[];
  chosen_method?: StudyMethodState["chosen_method"];
  home_safe_mode: true;
  error?: string;
  report_path?: string;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-autonomous-study");
const LEARNING_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORTS_DIR = join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning");
const STATE_PATH = join(RUNTIME_DIR, "nyra_autonomous_deepening_1h_state_latest.json");
const LOG_PATH = join(RUNTIME_DIR, "nyra_autonomous_deepening_1h_log.jsonl");
const REPORT_PATH = join(REPORTS_DIR, "nyra_autonomous_deepening_1h_latest.json");
const ESSENCE_PATH = join(LEARNING_DIR, "nyra_assimilated_essence_latest.json");
const METHOD_STATE_PATH = join(LEARNING_DIR, "nyra_study_method_state_latest.json");
const WEB_STATE_PATH = join(LEARNING_DIR, "nyra_web_access_state.json");

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
    note: "runner separato dal profilo owner-only con trigger on-need",
  };
  mkdirSync(LEARNING_DIR, { recursive: true });
  writeFileSync(WEB_STATE_PATH, JSON.stringify(next, null, 2));
}

function chooseDomains(essence: AssimilatedEssence | undefined): { selected: string[]; rationale: string[] } {
  const hunger = essence?.next_hunger_domains ?? [];
  const retrieval = [...(essence?.retrieval_index ?? [])].sort((a, b) => b.weight - a.weight);
  const selected: string[] = [];
  const rationale: string[] = [];

  for (const domain of hunger) {
    if (!selected.includes(domain)) {
      selected.push(domain);
      const why = essence?.study_drive?.why_now?.find((entry) => entry.toLowerCase().includes(domain.toLowerCase()));
      rationale.push(why ?? `${domain}: fame attuale del runtime`);
    }
    if (selected.length >= 3) break;
  }

  const bridgeCandidates = ["control_theory", "computer_engineering", "server_runtime_infrastructure"];
  for (const candidate of bridgeCandidates) {
    if (selected.length >= 4) break;
    if (!selected.includes(candidate) && retrieval.some((entry) => entry.domain_id === candidate)) {
      selected.push(candidate);
      rationale.push(`${candidate}: ponte strutturale utile per chiudere studio e autoriparazione`);
    }
  }

  for (const entry of retrieval) {
    if (selected.length >= 4) break;
    if (!selected.includes(entry.domain_id)) {
      selected.push(entry.domain_id);
      rationale.push(`${entry.domain_id}: alto peso di retrieval interno`);
    }
  }

  return {
    selected: selected.slice(0, 4),
    rationale,
  };
}

function buildPlan(selectedDomains: string[]): ModulePlan[] {
  const [first = "applied_math", second = "general_physics", third = "quantum_physics", fourth = "coding_speed"] = selectedDomains;
  return [
    {
      id: "block_1",
      label: `Deepening 1: ${first}`,
      domains: [first],
      duration_minutes: 15,
      mode: "web_distill",
      note: "approfondimento primario scelto da Nyra dal suo stato di fame attuale",
    },
    {
      id: "block_2",
      label: `Deepening 2: ${second}, ${third}`,
      domains: [second, third],
      duration_minutes: 15,
      mode: "web_distill",
      note: "coppia di domini di verifica profonda e collegamento causale/probabilistico",
    },
    {
      id: "block_3",
      label: `Deepening 3: ${fourth}`,
      domains: [fourth],
      duration_minutes: 15,
      mode: "web_distill",
      note: "traduzione dello studio in velocita corretta e pattern riusabili",
    },
    {
      id: "block_4",
      label: "Verify + integrate + reflection",
      domains: selectedDomains,
      duration_minutes: 15,
      mode: "verify_integrate",
      note: "chiusura del loop: verify, integrate, reflection",
    },
  ];
}

async function main(): Promise<void> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });
  ensureWebOnNeed();

  const essence = readJson<AssimilatedEssence>(ESSENCE_PATH);
  const methodState = readJson<StudyMethodState>(METHOD_STATE_PATH);
  const choice = chooseDomains(essence);
  const plan = buildPlan(choice.selected);
  const startedAt = nowIso();
  const endsAt = new Date(Date.now() + 60 * 60_000).toISOString();

  writeState({
    status: "running",
    profile: "1h_low_impact_autonomous_deepening",
    started_at: startedAt,
    ends_at: endsAt,
    current_module: null,
    completed_modules: 0,
    selected_domains: choice.selected,
    chosen_method: methodState?.chosen_method,
    home_safe_mode: true,
  });
  appendLog({
    type: "autonomous_deepening_started",
    started_at: startedAt,
    ends_at: endsAt,
    selected_domains: choice.selected,
    rationale: choice.rationale,
    chosen_method: methodState?.chosen_method,
  });

  const checkpoints: Array<Record<string, unknown>> = [];

  for (let index = 0; index < plan.length; index += 1) {
    const module = plan[index]!;
    writeState({
      status: "running",
      profile: "1h_low_impact_autonomous_deepening",
      started_at: startedAt,
      ends_at: endsAt,
      current_module: module,
      completed_modules: index,
      selected_domains: choice.selected,
      chosen_method: methodState?.chosen_method,
      home_safe_mode: true,
    });

    const started = nowIso();
    const actions: string[] = [];
    appendLog({ type: "module_started", module, started_at: started });

    if (module.mode === "web_distill") {
      runNodeTool("tools/nyra-web-explore.ts", module.domains);
      actions.push(`web_explore:${module.domains.join(",")}`);
    }

    if (module.mode === "verify_integrate") {
      runNodeTool("tools/nyra-domain-verify-exercise.ts");
      runNodeTool("tools/nyra-expression-verify-exercise.ts");
      runNodeTool("tools/nyra-assimilate-essence.ts");
      actions.push("domain_verify");
      actions.push("expression_verify");
      actions.push("assimilate_essence");
    }

    await sleep(module.duration_minutes * 60_000);
    const ended = nowIso();
    const checkpoint = {
      module_id: module.id,
      label: module.label,
      mode: module.mode,
      domains: module.domains,
      started_at: started,
      ended_at: ended,
      duration_minutes: module.duration_minutes,
      note: module.note,
      actions,
    };
    checkpoints.push(checkpoint);
    appendLog({ type: "module_completed", ...checkpoint });
  }

  const finalEssence = readJson<AssimilatedEssence>(ESSENCE_PATH);
  const report = {
    runner: "nyra_autonomous_deepening_1h",
    generated_at: nowIso(),
    profile: "1h_low_impact_autonomous_deepening",
    home_safe_mode: true,
    started_at: startedAt,
    finished_at: nowIso(),
    total_minutes: 60,
    chosen_method: methodState?.chosen_method,
    selected_domains: choice.selected,
    rationale: choice.rationale,
    checkpoints,
    final_state: {
      dominant_domains: finalEssence?.dominant_domains ?? [],
      next_hunger_domains: finalEssence?.next_hunger_domains ?? [],
      study_drive: finalEssence?.study_drive ?? {},
    },
    note: "Nyra ha scelto i domini dal proprio stato interno, ha usato il web in modalita on-need e ha chiuso il loop senza stress test pesanti sul Mac.",
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  writeState({
    status: "completed",
    profile: "1h_low_impact_autonomous_deepening",
    started_at: startedAt,
    ends_at: endsAt,
    current_module: null,
    completed_modules: plan.length,
    selected_domains: choice.selected,
    chosen_method: methodState?.chosen_method,
    home_safe_mode: true,
    report_path: REPORT_PATH,
  });
  appendLog({ type: "autonomous_deepening_completed", finished_at: report.finished_at, report_path: REPORT_PATH });
}

main().catch((error) => {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const message = error instanceof Error ? error.message : String(error);
  writeState({
    status: "failed",
    profile: "1h_low_impact_autonomous_deepening",
    home_safe_mode: true,
    error: message,
  });
  appendLog({ type: "autonomous_deepening_failed", failed_at: nowIso(), error: message });
  process.exitCode = 1;
});

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

type NyraWebAccessState = {
  access_mode: "restricted" | "free_explore";
  trigger_mode?: "manual" | "on_need";
  granted_at?: string;
  last_explored_at?: string;
  last_distilled_at?: string;
  source_config?: string;
  note?: string;
};

type NyraAdvancedStudyReport = {
  generated_at: string;
  selected_domains: string[];
  domains: Array<{
    id: string;
    fetched: Array<{
      ok: boolean;
      chars: number;
      url: string;
      note: string;
    }>;
  }>;
};

type NyraAdvancedMemoryPack = {
  generated_at: string;
  selected_domains: string[];
  domains: Array<{
    id: string;
    priority: number;
    focus: string[];
    distilled_knowledge: string[];
    retained_constraints: string[];
    source_count: number;
  }>;
};

type NyraAssimilatedEssence = {
  generated_at: string;
  dominant_domains: string[];
  next_hunger_domains: string[];
  nourishment_cycle: string[];
  study_drive: {
    why_now: string[];
    next_actions: string[];
  };
};

type SelfHealLearningReport = {
  runner: "nyra_self_heal_learning_runtime";
  generated_at: string;
  owner_scope: "god_mode_only";
  web_access: NyraWebAccessState;
  selected_domains: string[];
  report_paths: {
    advanced_study: string;
    memory_pack: string;
    essence: string;
    self_heal_report: string;
  };
  study_targets: Array<{
    id: string;
    sources_ok: number;
    sources_total: number;
    corpus_chars: number;
    focus: string[];
    distilled_knowledge: string[];
    retained_constraints: string[];
  }>;
  nyra_voice: {
    what_i_studied_for_self_heal: string[];
    why_this_helps: string[];
    web_access_mode: string;
  };
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORTS_DIR = join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning");
const WEB_STATE_PATH = join(RUNTIME_DIR, "nyra_web_access_state.json");
const ADVANCED_REPORT_PATH = join(RUNTIME_DIR, "nyra_advanced_study_latest.json");
const MEMORY_PACK_PATH = join(RUNTIME_DIR, "nyra_advanced_memory_pack_latest.json");
const ESSENCE_PATH = join(RUNTIME_DIR, "nyra_assimilated_essence_latest.json");
const REPORT_PATH = join(REPORTS_DIR, "nyra_self_heal_learning_latest.json");

const SELF_HEAL_DOMAINS = ["applied_math", "general_physics", "quantum_physics", "coding_speed"] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function ensureWebAccess(): NyraWebAccessState {
  const now = new Date().toISOString();
  const state: NyraWebAccessState = existsSync(WEB_STATE_PATH)
    ? readJson<NyraWebAccessState>(WEB_STATE_PATH)
    : {
        access_mode: "free_explore",
        trigger_mode: "on_need",
        granted_at: now,
        source_config: join(ROOT, "universal-core", "config", "nyra_web_study_sources_v2.json"),
        note: "runner separato dal profilo owner-only con trigger on-need",
      };

  if (state.access_mode !== "free_explore" || state.trigger_mode !== "on_need") {
    const updated: NyraWebAccessState = {
      ...state,
      access_mode: "free_explore",
      trigger_mode: "on_need",
      granted_at: state.granted_at ?? now,
      source_config: state.source_config ?? join(ROOT, "universal-core", "config", "nyra_web_study_sources_v2.json"),
      note: "runner separato dal profilo owner-only con trigger on-need",
    };
    writeFileSync(WEB_STATE_PATH, JSON.stringify(updated, null, 2));
    return updated;
  }

  return state;
}

function runNodeTool(tool: string, args: string[]): void {
  execFileSync(process.execPath, ["--experimental-strip-types", tool, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });

  const webAccess = ensureWebAccess();
  runNodeTool("tools/nyra-web-explore.ts", [...SELF_HEAL_DOMAINS]);
  runNodeTool("tools/nyra-nutrition-loop.ts", []);
  runNodeTool("tools/nyra-hard-cycle-v2.ts", []);
  runNodeTool("tools/nyra-assimilate-essence.ts", []);

  const advancedReport = readJson<NyraAdvancedStudyReport>(ADVANCED_REPORT_PATH);
  const memoryPack = readJson<NyraAdvancedMemoryPack>(MEMORY_PACK_PATH);
  const essence = readJson<NyraAssimilatedEssence>(ESSENCE_PATH);

  const studyTargets = SELF_HEAL_DOMAINS.map((domainId) => {
    const reportDomain = advancedReport.domains.find((domain) => domain.id === domainId);
    const packDomain = memoryPack.domains.find((domain) => domain.id === domainId);
    return {
      id: domainId,
      sources_ok: reportDomain?.fetched.filter((entry) => entry.ok).length ?? 0,
      sources_total: reportDomain?.fetched.length ?? 0,
      corpus_chars: reportDomain?.fetched.reduce((sum, entry) => sum + entry.chars, 0) ?? 0,
      focus: packDomain?.focus ?? [],
      distilled_knowledge: packDomain?.distilled_knowledge ?? [],
      retained_constraints: packDomain?.retained_constraints ?? [],
    };
  });

  const report: SelfHealLearningReport = {
    runner: "nyra_self_heal_learning_runtime",
    generated_at: new Date().toISOString(),
    owner_scope: "god_mode_only",
    web_access: readJson<NyraWebAccessState>(WEB_STATE_PATH),
    selected_domains: [...SELF_HEAL_DOMAINS],
    report_paths: {
      advanced_study: ADVANCED_REPORT_PATH,
      memory_pack: MEMORY_PACK_PATH,
      essence: ESSENCE_PATH,
      self_heal_report: REPORT_PATH,
    },
    study_targets: studyTargets,
    nyra_voice: {
      what_i_studied_for_self_heal: [...SELF_HEAL_DOMAINS],
      why_this_helps: [
        "applied_math: leggere il collo come modello, non come caso isolato",
        "general_physics: rinforzare causalita, vincoli e conservazione del sistema",
        "quantum_physics: separare ipotesi, stato, misura e probabilita nei confronti tra scenari",
        "coding_speed: trasformare la diagnosi in fix piccoli, rapidi e riusabili",
      ],
      web_access_mode: `access_mode=${webAccess.access_mode}, trigger_mode=${webAccess.trigger_mode ?? "manual"}`,
    },
  };

  writeJson(REPORT_PATH, report);
  console.log(JSON.stringify({
    ok: true,
    report_path: REPORT_PATH,
    selected_domains: report.selected_domains,
    web_access: report.web_access,
    dominant_domains: essence.dominant_domains,
    next_hunger_domains: essence.next_hunger_domains,
  }, null, 2));
}

main();

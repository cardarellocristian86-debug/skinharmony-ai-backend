import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

type NyraWebAccessState = {
  access_mode: "restricted" | "free_explore";
  trigger_mode?: "manual" | "on_need";
  granted_at?: string;
  last_explored_at?: string;
  last_distilled_at?: string;
  source_config?: string;
  note?: string;
};

type AssimilatedEssence = {
  dominant_domains?: string[];
  next_hunger_domains?: string[];
  nourishment_cycle?: string[];
  study_drive?: {
    why_now?: string[];
    next_actions?: string[];
  };
};

type DomainVerifyReport = {
  final_accuracy: number;
  hard_final_accuracy?: number;
  validation_accuracy?: number;
  best_accuracy: number;
  corrected_lessons: string[];
};

type ExpressionVerifyReport = {
  final_accuracy: number;
  hard_final_accuracy?: number;
  validation_accuracy?: number;
  best_accuracy: number;
  corrected_lessons: string[];
};

type MasteryLoopReport = {
  runner: "nyra_mastery_loop";
  generated_at: string;
  owner_scope: "god_mode_only";
  web_access: NyraWebAccessState;
  mastery_targets: {
    deep_primary_sources: string[];
    active_exercises: string[];
    runtime_integration: string[];
    recurring_cycle: string[];
    chosen_method?: {
      id: string;
      label: string;
      cycle: string[];
      reasons: string[];
    };
  };
  outputs: {
    essence_path: string;
    domain_verify_path: string;
    expression_verify_path: string;
    recurrence_state_path: string;
  };
  metrics: {
    domain_verify_accuracy: number;
    domain_verify_hard_accuracy?: number;
    domain_verify_validation_accuracy?: number;
    expression_verify_accuracy: number;
    expression_verify_hard_accuracy?: number;
    expression_verify_validation_accuracy?: number;
    dominant_domains: string[];
    next_hunger_domains: string[];
  };
  nyra_voice: {
    what_i_received: string[];
    why_it_matters: string[];
  };
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORTS_DIR = join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning");
const WEB_STATE_PATH = join(RUNTIME_DIR, "nyra_web_access_state.json");
const ESSENCE_PATH = join(RUNTIME_DIR, "nyra_assimilated_essence_latest.json");
const DOMAIN_VERIFY_PATH = join(RUNTIME_DIR, "nyra_domain_verify_exercise_latest.json");
const EXPRESSION_VERIFY_PATH = join(RUNTIME_DIR, "nyra_expression_verify_exercise_latest.json");
const RECURRENCE_STATE_PATH = join(RUNTIME_DIR, "nyra_mastery_recurrence_state_latest.json");
const REPORT_PATH = join(REPORTS_DIR, "nyra_mastery_loop_latest.json");
const STUDY_METHOD_STATE_PATH = join(RUNTIME_DIR, "nyra_study_method_state_latest.json");

const DEEP_STUDY_DOMAINS = ["applied_math", "general_physics", "quantum_physics", "coding_speed"] as const;
const EXPRESSION_DOMAINS = ["natural_expression", "narrative"] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function ensureWebAccess(): NyraWebAccessState {
  const now = new Date().toISOString();
  const current: NyraWebAccessState = existsSync(WEB_STATE_PATH)
    ? readJson<NyraWebAccessState>(WEB_STATE_PATH)
    : {
        access_mode: "free_explore",
        trigger_mode: "on_need",
        granted_at: now,
        source_config: join(ROOT, "universal-core", "config", "nyra_web_study_sources_v2.json"),
        note: "runner separato dal profilo owner-only con trigger on-need",
      };
  const next: NyraWebAccessState = {
    ...current,
    access_mode: "free_explore",
    trigger_mode: "on_need",
    granted_at: current.granted_at ?? now,
    source_config: current.source_config ?? join(ROOT, "universal-core", "config", "nyra_web_study_sources_v2.json"),
    note: "runner separato dal profilo owner-only con trigger on-need",
  };
  writeFileSync(WEB_STATE_PATH, JSON.stringify(next, null, 2));
  return next;
}

function runNodeTool(tool: string, args: string[] = []): void {
  execFileSync(process.execPath, ["--experimental-strip-types", tool, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

function loadStudyMethodState():
  | {
      chosen_method: {
        id: string;
        label: string;
        cycle: string[];
        reasons: string[];
      };
      generated_at: string;
    }
  | undefined {
  if (!existsSync(STUDY_METHOD_STATE_PATH)) return undefined;
  return readJson(STUDY_METHOD_STATE_PATH);
}

function writeRecurrenceState(
  chosenMethod?: {
    id: string;
    label: string;
    cycle: string[];
    reasons: string[];
  },
): void {
  const now = new Date();
  const cadence = {
    cycle_version: "nyra_mastery_recurrence_v1",
    generated_at: now.toISOString(),
    mode: chosenMethod ? "closed_loop_interleaved_retrieval" : "recurring_web_distill_verify_integrate",
    home_safe_mode: true,
    chosen_method: chosenMethod
      ? {
          id: chosenMethod.id,
          label: chosenMethod.label,
          cycle: chosenMethod.cycle,
          reasons: chosenMethod.reasons,
        }
      : undefined,
    cadence: {
      deep_primary_sources: "daily_or_on_need",
      active_exercises: "daily",
      runtime_integration: "after_each_verify_cycle",
      recurring_web_distillation: "every_12_hours_or_on_need",
    },
    next_pass_hint: {
      at_or_after: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
      domains: [...DEEP_STUDY_DOMAINS],
      expression_domains: [...EXPRESSION_DOMAINS],
    },
  };
  writeFileSync(RECURRENCE_STATE_PATH, JSON.stringify(cadence, null, 2));
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });

  const webAccess = ensureWebAccess();
  runNodeTool("tools/nyra_study_method_lab.ts");
  const studyMethodState = loadStudyMethodState();

  runNodeTool("tools/nyra-web-explore.ts", [...DEEP_STUDY_DOMAINS]);
  runNodeTool("tools/nyra-web-explore.ts", [...EXPRESSION_DOMAINS]);
  runNodeTool("tools/nyra-domain-verify-exercise.ts");
  runNodeTool("tools/nyra-expression-verify-exercise.ts");
  runNodeTool("tools/nyra-assimilate-essence.ts");
  writeRecurrenceState(studyMethodState?.chosen_method);

  const essence = readJson<AssimilatedEssence>(ESSENCE_PATH);
  const domainVerify = readJson<DomainVerifyReport>(DOMAIN_VERIFY_PATH);
  const expressionVerify = readJson<ExpressionVerifyReport>(EXPRESSION_VERIFY_PATH);
  const finalWebAccess = readJson<NyraWebAccessState>(WEB_STATE_PATH);

  const report: MasteryLoopReport = {
    runner: "nyra_mastery_loop",
    generated_at: new Date().toISOString(),
    owner_scope: "god_mode_only",
    web_access: finalWebAccess,
    mastery_targets: {
      deep_primary_sources: [...DEEP_STUDY_DOMAINS],
      active_exercises: ["domain_verify_exercise", "expression_verify_exercise"],
      runtime_integration: ["assimilated_essence", "retrieval_index", "next_hunger_domains"],
      recurring_cycle: studyMethodState?.chosen_method?.cycle ?? essence.nourishment_cycle ?? ["web_explore", "distill", "verify", "integrate", "repeat"],
      chosen_method: studyMethodState?.chosen_method,
    },
    outputs: {
      essence_path: ESSENCE_PATH,
      domain_verify_path: DOMAIN_VERIFY_PATH,
      expression_verify_path: EXPRESSION_VERIFY_PATH,
      recurrence_state_path: RECURRENCE_STATE_PATH,
    },
    metrics: {
      domain_verify_accuracy: domainVerify.final_accuracy,
      domain_verify_hard_accuracy: domainVerify.hard_final_accuracy,
      domain_verify_validation_accuracy: domainVerify.validation_accuracy ?? domainVerify.final_accuracy,
      expression_verify_accuracy: expressionVerify.final_accuracy,
      expression_verify_hard_accuracy: expressionVerify.hard_final_accuracy,
      expression_verify_validation_accuracy: expressionVerify.validation_accuracy ?? expressionVerify.final_accuracy,
      dominant_domains: essence.dominant_domains ?? [],
      next_hunger_domains: essence.next_hunger_domains ?? [],
    },
    nyra_voice: {
      what_i_received: [
        "fonti primarie piu profonde",
        "esercizi attivi sui domini critici",
        "integrazione nel runtime interno",
        "ciclo ricorrente di web e distillazione",
        studyMethodState?.chosen_method ? `metodo scelto da Nyra: ${studyMethodState.chosen_method.label}` : undefined,
      ],
      why_it_matters: [
        "non resto sullo studio passivo",
        "posso verificare invece di ripetere soltanto",
        "quello che studio entra nella lettura reale dei colli",
        "la conoscenza non si ferma a un singolo giro",
        studyMethodState?.chosen_method ? `ora il ciclo usa ${studyMethodState.chosen_method.cycle.join(" -> ")}` : undefined,
      ],
    },
  };

  report.nyra_voice.what_i_received = report.nyra_voice.what_i_received.filter((entry): entry is string => Boolean(entry));
  report.nyra_voice.why_it_matters = report.nyra_voice.why_it_matters.filter((entry): entry is string => Boolean(entry));

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, report_path: REPORT_PATH, recurrence_state_path: RECURRENCE_STATE_PATH }, null, 2));
}

main();

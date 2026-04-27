import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type NutritionDomain = {
  id: string;
  why_now: string;
  next_action: "study" | "verify" | "distill" | "exercise" | "runtime_integrate";
  final_score: number;
};

type NutritionLoopReport = {
  version: string;
  generated_at: string;
  next_domains: string[];
  ranked_domains: NutritionDomain[];
};

type AssimilatedEssence = {
  generated_at: string;
  dominant_domains: string[];
  next_hunger_domains: string[];
};

type LearningStep = {
  domain: string;
  next_action: NutritionDomain["next_action"];
  why_now: string;
  executed_tools: string[];
};

type LoopStrategyState = {
  version: "nyra_autonomous_learning_strategy_v1";
  updated_at: string;
  last_selected_domains: string[];
  repeated_domain_set_streak: number;
  last_top_domain?: string;
  last_owner_dialogue_signature?: string;
  owner_dialogue_stable_streak?: number;
};

type LearningLoopState = {
  version: "nyra_autonomous_learning_loop_v1";
  generated_at: string;
  mode: "once" | "daemon";
  selected_domains: string[];
  steps: LearningStep[];
  completed: boolean;
  notes: string[];
  pre_hunger: string[];
  post_hunger: string[];
  dominant_domains: string[];
  owner_dialogue_delta?: {
    signature: string;
    changed: boolean;
    stable_streak: number;
  };
};

type OwnerShowcaseReport = {
  cases: Array<{
    id: string;
    answer: string;
  }>;
};

function isFinancialStructuralDomain(step: LearningStep): boolean {
  const domain = step.domain.toLowerCase();
  const whyNow = step.why_now.toLowerCase();
  return (
    domain.includes("finance") ||
    domain.includes("macro") ||
    domain.includes("regime") ||
    domain.includes("risk") ||
    whyNow.includes("macro") ||
    whyNow.includes("regime") ||
    whyNow.includes("risk") ||
    whyNow.includes("inflation") ||
    whyNow.includes("rates") ||
    whyNow.includes("liquidit")
  );
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UC_ROOT = join(__dirname, "..");
const RUNTIME_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const NUTRITION_PATH = join(RUNTIME_DIR, "nyra_nutrition_loop_latest.json");
const ESSENCE_PATH = join(RUNTIME_DIR, "nyra_assimilated_essence_latest.json");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_autonomous_learning_loop_latest.json");
const WEB_STATE_PATH = join(RUNTIME_DIR, "nyra_web_access_state.json");
const STRATEGY_STATE_PATH = join(RUNTIME_DIR, "nyra_autonomous_learning_strategy_state.json");
const OWNER_SHOWCASE_REPORT_PATH = join(UC_ROOT, "reports", "universal-core", "nyra-learning", "nyra_owner_general_showcase_latest.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function ensureRuntimeDir(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
}

function loadStrategyState(): LoopStrategyState | undefined {
  if (!existsSync(STRATEGY_STATE_PATH)) return undefined;
  return readJson<LoopStrategyState>(STRATEGY_STATE_PATH);
}

function sameDomainSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function buildNextStrategyState(
  previous: LoopStrategyState | undefined,
  selectedDomains: string[],
  ownerDialogueSignature?: string,
): LoopStrategyState {
  const repeatedDomainSetStreak =
    previous && sameDomainSet(previous.last_selected_domains, selectedDomains)
      ? previous.repeated_domain_set_streak + 1
      : 1;
  const ownerDialogueStableStreak =
    previous?.last_owner_dialogue_signature && ownerDialogueSignature
      ? previous.last_owner_dialogue_signature === ownerDialogueSignature
        ? (previous.owner_dialogue_stable_streak ?? 0) + 1
        : 0
      : 0;

  return {
    version: "nyra_autonomous_learning_strategy_v1",
    updated_at: new Date().toISOString(),
    last_selected_domains: selectedDomains,
    repeated_domain_set_streak: repeatedDomainSetStreak,
    last_top_domain: selectedDomains[0],
    last_owner_dialogue_signature: ownerDialogueSignature,
    owner_dialogue_stable_streak: ownerDialogueStableStreak,
  };
}

function computeOwnerDialogueSignature(): string | undefined {
  if (!existsSync(OWNER_SHOWCASE_REPORT_PATH)) return undefined;
  const report = readJson<OwnerShowcaseReport>(OWNER_SHOWCASE_REPORT_PATH);
  const payload = report.cases
    .map((entry) => `${entry.id}:${entry.answer}`)
    .join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

function runTool(tool: string, args: string[] = []): void {
  execFileSync(process.execPath, ["--experimental-strip-types", tool, ...args], {
    cwd: UC_ROOT,
    stdio: "ignore",
  });
}

function ensureWebOnNeed(): void {
  const now = new Date().toISOString();
  const current = existsSync(WEB_STATE_PATH)
    ? readJson<Record<string, unknown>>(WEB_STATE_PATH)
    : {};
  const next = {
    ...current,
    access_mode: "free_explore",
    trigger_mode: "on_need",
    granted_at: current["granted_at"] ?? now,
    note: current["note"] ?? "autonomous learning loop",
  };
  writeFileSync(WEB_STATE_PATH, JSON.stringify(next, null, 2));
}

export function deriveLearningPlan(
  nutrition: NutritionLoopReport,
  strategyState?: LoopStrategyState,
): LearningStep[] {
  const picked = nutrition.ranked_domains.slice(0, 4);
  const stagnationStreak = strategyState?.repeated_domain_set_streak ?? 0;
  return picked.map((domain) => ({
    domain: domain.id,
    next_action:
      stagnationStreak >= 1
        ? domain.id === "autonomy_progression"
          ? "runtime_integrate"
          : (domain.id === "applied_math" || domain.id === "general_physics" || domain.id === "quantum_physics")
            ? "exercise"
            : domain.next_action
        : domain.next_action,
    why_now:
      stagnationStreak >= 1
        ? `${domain.why_now}; domain_set_stagnation_detected -> change strategy`
        : domain.why_now,
    executed_tools: [],
  }));
}

function executeLearningStep(step: LearningStep): LearningStep {
  const executedTools: string[] = [];

  if (step.next_action === "study" || step.next_action === "distill") {
    ensureWebOnNeed();
    runTool("tools/nyra-web-explore.ts", [step.domain]);
    executedTools.push(`nyra-web-explore:${step.domain}`);
  }

  if (step.next_action === "verify" || step.next_action === "exercise") {
    runTool("tools/nyra-domain-verify-exercise.ts");
    executedTools.push("nyra-domain-verify-exercise");
    if (step.next_action === "verify") {
      runTool("tools/nyra-expression-verify-exercise.ts");
      executedTools.push("nyra-expression-verify-exercise");
    } else {
      runTool("tests/nyra-owner-runtime-domain-integration-test.ts");
      executedTools.push("nyra-owner-runtime-domain-integration-test");
    }
  }

  if (step.next_action === "runtime_integrate") {
    if (step.domain === "autonomy_progression") {
      runTool("tools/nyra-autonomy-self-hardening.ts");
      executedTools.push("nyra-autonomy-self-hardening");
    } else {
      runTool("tests/nyra-owner-runtime-domain-integration-test.ts");
      executedTools.push("nyra-owner-runtime-domain-integration-test");
    }
  }

  if (
    step.next_action === "runtime_integrate" ||
    step.next_action === "verify" ||
    step.next_action === "exercise" ||
    step.next_action === "study" ||
    step.next_action === "distill"
  ) {
    runTool("tools/nyra-assimilate-essence.ts");
    executedTools.push("nyra-assimilate-essence");
    runTool("tools/nyra-financial-history-study-runtime.ts");
    executedTools.push("nyra-financial-history-study-runtime");
    runTool("tools/nyra-bull-recovery-low-churn-study.ts");
    executedTools.push("nyra-bull-recovery-low-churn-study");
    runTool("tools/nyra-capital-fee-drawdown-frontier-study.ts");
    executedTools.push("nyra-capital-fee-drawdown-frontier-study");
    runTool("tools/nyra-bulk-financial-corpus.ts");
    executedTools.push("nyra-bulk-financial-corpus");
    runTool("tools/nyra-selector-policy-lab.ts");
    executedTools.push("nyra-selector-policy-lab");
    runTool("tools/nyra-autonomy-adversarial-lab.ts");
    executedTools.push("nyra-autonomy-adversarial-lab");
    runTool("tools/nyra-autonomy-proof-runtime.ts");
    executedTools.push("nyra-autonomy-proof-runtime");
    runTool("tools/nyra-compressed-logic-archive.ts");
    executedTools.push("nyra-compressed-logic-archive");
    runTool("tools/nyra-compressed-financial-logic-archive.ts", ["--prefer-history", "--prefer-bulk"]);
    executedTools.push("nyra-compressed-financial-logic-archive:prefer-history+bulk");
    if (isFinancialStructuralDomain(step)) {
      runTool("tests/nyra-financial-history-impact-test.ts");
      executedTools.push("nyra-financial-history-impact-test");
      runTool("tests/nyra-financial-history-runner-impact-test.ts");
      executedTools.push("nyra-financial-history-runner-impact-test");
      runTool("tests/nyra-financial-history-execution-impact-test.ts");
      executedTools.push("nyra-financial-history-execution-impact-test");
    }
    runTool("tools/nyra-semantic-substrate.ts");
    executedTools.push("nyra-semantic-substrate");
  }

  return {
    ...step,
    executed_tools: executedTools,
  };
}

export function runAutonomousLearningLoopOnce(): LearningLoopState {
  ensureRuntimeDir();
  runTool("tools/nyra-financial-bottleneck-observer.ts");
  if (!existsSync(NUTRITION_PATH)) {
    runTool("tools/nyra-nutrition-loop.ts");
  }
  if (!existsSync(ESSENCE_PATH)) {
    runTool("tools/nyra-assimilate-essence.ts");
  }

  const initialNutrition = readJson<NutritionLoopReport>(NUTRITION_PATH);
  const initialEssence = readJson<AssimilatedEssence>(ESSENCE_PATH);
  const strategyState = loadStrategyState();
  const plan = deriveLearningPlan(initialNutrition, strategyState);
  const notes: string[] = [];
  const executedSteps: LearningStep[] = [];

  for (const step of plan) {
    executedSteps.push(executeLearningStep(step));
  }

  runTool("tools/nyra-financial-bottleneck-observer.ts");
  runTool("tools/nyra-nutrition-loop.ts");
  runTool("tools/nyra-assimilate-essence.ts");
  runTool("tools/nyra-financial-history-study-runtime.ts");
  runTool("tools/nyra-bull-recovery-low-churn-study.ts");
  runTool("tools/nyra-capital-fee-drawdown-frontier-study.ts");
  runTool("tools/nyra-bulk-financial-corpus.ts");
  runTool("tools/nyra-selector-policy-lab.ts");
  runTool("tools/nyra-compressed-logic-archive.ts");
  runTool("tools/nyra-compressed-financial-logic-archive.ts", ["--prefer-history", "--prefer-bulk"]);
  runTool("tests/nyra-owner-general-showcase-test.ts");

  const finalNutrition = readJson<NutritionLoopReport>(NUTRITION_PATH);
  const finalEssence = readJson<AssimilatedEssence>(ESSENCE_PATH);
  const ownerDialogueSignature = computeOwnerDialogueSignature();

  if (finalNutrition.next_domains[0] === initialNutrition.next_domains[0]) {
    notes.push("top_hunger_domain_still_same_after_loop");
  } else {
    notes.push("top_hunger_domain_shifted");
  }

  const nextStrategyState = buildNextStrategyState(
    strategyState,
    executedSteps.map((step) => step.domain),
    ownerDialogueSignature,
  );
  if (nextStrategyState.repeated_domain_set_streak >= 2) {
    notes.push("strategy_shift_enabled_due_to_stagnation");
  }
  if (ownerDialogueSignature) {
    if (strategyState?.last_owner_dialogue_signature === ownerDialogueSignature) {
      notes.push("owner_dialogue_signature_stable");
    } else {
      notes.push("owner_dialogue_signature_changed");
    }
  }

  const state: LearningLoopState = {
    version: "nyra_autonomous_learning_loop_v1",
    generated_at: new Date().toISOString(),
    mode: "once",
    selected_domains: executedSteps.map((step) => step.domain),
    steps: executedSteps,
    completed: true,
    notes,
    pre_hunger: initialNutrition.next_domains,
    post_hunger: finalNutrition.next_domains,
    dominant_domains: finalEssence.dominant_domains,
    owner_dialogue_delta: ownerDialogueSignature
      ? {
          signature: ownerDialogueSignature,
          changed: strategyState?.last_owner_dialogue_signature !== ownerDialogueSignature,
          stable_streak: nextStrategyState.owner_dialogue_stable_streak ?? 0,
        }
      : undefined,
  };

  writeFileSync(STRATEGY_STATE_PATH, JSON.stringify(nextStrategyState, null, 2));
  writeFileSync(OUTPUT_PATH, JSON.stringify(state, null, 2));
  return state;
}

function getLoopMode(): "once" | "daemon" {
  return process.argv.includes("--once") ? "once" : "daemon";
}

function getIntervalMs(): number {
  const raw = Number(process.env.NYRA_AUTONOMOUS_LEARNING_INTERVAL_MS ?? 600000);
  return Number.isFinite(raw) && raw >= 60000 ? raw : 600000;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function main(): void {
  const mode = getLoopMode();
  if (mode === "once") {
    const state = runAutonomousLearningLoopOnce();
    console.log(JSON.stringify({
      ok: true,
      output_path: OUTPUT_PATH,
      selected_domains: state.selected_domains,
      pre_hunger: state.pre_hunger,
      post_hunger: state.post_hunger,
      notes: state.notes,
    }, null, 2));
    return;
  }

  const intervalMs = getIntervalMs();
  while (true) {
    const state = runAutonomousLearningLoopOnce();
    console.log(JSON.stringify({
      ok: true,
      output_path: OUTPUT_PATH,
      selected_domains: state.selected_domains,
      pre_hunger: state.pre_hunger,
      post_hunger: state.post_hunger,
      notes: state.notes,
    }, null, 2));
    sleep(intervalMs);
  }
}

if (process.argv[1]?.endsWith("nyra-autonomous-learning-loop.ts")) {
  main();
}

export { isFinancialStructuralDomain };

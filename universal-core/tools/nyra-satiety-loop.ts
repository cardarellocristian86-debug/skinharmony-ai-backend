import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

type NutritionLoopReport = {
  next_domains: string[];
  ranked_domains: Array<{
    id: string;
    final_score: number;
    why_now: string;
    next_action: string;
    source_envelope_exhausted?: boolean;
  }>;
};

type AdvancedMemoryPack = {
  domains: Array<{
    id: string;
    source_count: number;
  }>;
};

type SatietyIteration = {
  iteration: number;
  studied_domains: string[];
  next_hunger_domains: string[];
  plateau: boolean;
  source_counts: Record<string, number>;
};

type SatietyReport = {
  version: "nyra_satiety_loop_v1";
  generated_at: string;
  max_iterations: number;
  completed_iterations: number;
  satiated: boolean;
  stop_reason: string;
  final_hunger_domains: string[];
  iterations: SatietyIteration[];
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const NUTRITION_PATH = join(RUNTIME_DIR, "nyra_nutrition_loop_latest.json");
const PACK_PATH = join(RUNTIME_DIR, "nyra_advanced_memory_pack_latest.json");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_satiety_loop_latest.json");

const MAX_ITERATIONS = 4;
const STABLE_REPEAT_TARGET = 2;

function loadNutrition(): NutritionLoopReport {
  return JSON.parse(readFileSync(NUTRITION_PATH, "utf8")) as NutritionLoopReport;
}

function loadPack(): AdvancedMemoryPack {
  return JSON.parse(readFileSync(PACK_PATH, "utf8")) as AdvancedMemoryPack;
}

function sourceCountMap(pack: AdvancedMemoryPack, domains: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const domain of domains) {
    map[domain] = pack.domains.find((entry) => entry.id === domain)?.source_count ?? 0;
  }
  return map;
}

function runScript(args: string[]): void {
  execFileSync("npm", args, {
    cwd: join(ROOT, "universal-core"),
    stdio: "inherit",
  });
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });

  const iterations: SatietyIteration[] = [];
  let stableRepeats = 0;
  let previousHungerKey = "";
  let satiated = false;
  let stopReason = "max_iterations_reached";

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const beforeNutrition = loadNutrition();
    const studiedDomains = beforeNutrition.next_domains.slice(0, 4);

    runScript(["run", "study:nyra:advanced", ...studiedDomains]);
    runScript(["run", "study:nyra:advanced:distill"]);
    runScript(["run", "study:nyra:nutrition-loop"]);
    runScript(["run", "study:nyra:assimilate"]);

    const afterNutrition = loadNutrition();
    const pack = loadPack();
    const hungerKey = afterNutrition.next_domains.join("|");
    const plateau = hungerKey === previousHungerKey && hungerKey.length > 0;

    if (plateau) {
      stableRepeats += 1;
    } else {
      stableRepeats = 0;
    }

    iterations.push({
      iteration,
      studied_domains: studiedDomains,
      next_hunger_domains: afterNutrition.next_domains,
      plateau,
      source_counts: sourceCountMap(pack, afterNutrition.next_domains),
    });

    previousHungerKey = hungerKey;

    const allRichEnough = afterNutrition.next_domains.every((domain) => (pack.domains.find((entry) => entry.id === domain)?.source_count ?? 0) >= 3);
    const noStudyLearningLeft = afterNutrition.ranked_domains
      .filter((entry) => afterNutrition.next_domains.includes(entry.id))
      .every((entry) => entry.next_action !== "study");
    const sourceEnvelopeExhausted = afterNutrition.ranked_domains
      .filter((entry) => afterNutrition.next_domains.includes(entry.id))
      .every((entry) => entry.source_envelope_exhausted === true || entry.next_action !== "study");

    if (plateau && stableRepeats >= STABLE_REPEAT_TARGET && allRichEnough) {
      satiated = true;
      stopReason = "hunger_stable_under_current_source_envelope";
      break;
    }

    if ((noStudyLearningLeft || sourceEnvelopeExhausted) && allRichEnough) {
      satiated = true;
      stopReason = "study_sources_exhausted_switch_to_verify_or_exercise";
      break;
    }
  }

  const finalNutrition = loadNutrition();
  const report: SatietyReport = {
    version: "nyra_satiety_loop_v1",
    generated_at: new Date().toISOString(),
    max_iterations: MAX_ITERATIONS,
    completed_iterations: iterations.length,
    satiated,
    stop_reason: stopReason,
    final_hunger_domains: finalNutrition.next_domains,
    iterations,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();

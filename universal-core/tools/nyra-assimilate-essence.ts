import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type AdvancedMemoryPack = {
  pack_version: string;
  generated_at: string;
  selected_domains: string[];
  memory_rules: string[];
  domains: Array<{
    id: string;
    priority: number;
    focus: string[];
    source_count: number;
    distilled_knowledge: string[];
    retained_constraints: string[];
  }>;
};

type NutritionLoopReport = {
  version: string;
  generated_at: string;
  cycle: string[];
  ranked_domains: Array<{
    id: string;
    final_score: number;
    why_now: string;
    next_action: string;
  }>;
  next_domains: string[];
  next_actions: string[];
};

type AssimilatedEssence = {
  version: "nyra_assimilated_essence_v1";
  generated_at: string;
  integration_mode: "internalized_runtime";
  dominant_domains: string[];
  next_hunger_domains: string[];
  nourishment_cycle: string[];
  study_drive: {
    why_now: string[];
    next_actions: string[];
  };
  absorbed_principles: string[];
  retrieval_index: Array<{
    domain_id: string;
    weight: number;
    cues: string[];
  }>;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const PACK_PATH = join(RUNTIME_DIR, "nyra_advanced_memory_pack_latest.json");
const NUTRITION_PATH = join(RUNTIME_DIR, "nyra_nutrition_loop_latest.json");
const ESSENCE_PATH = join(RUNTIME_DIR, "nyra_assimilated_essence_latest.json");

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function requirePath(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`${label}_missing:${path}`);
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  requirePath(PACK_PATH, "advanced_pack");
  requirePath(NUTRITION_PATH, "nutrition_report");

  const pack = loadJson<AdvancedMemoryPack>(PACK_PATH);
  const nutrition = loadJson<NutritionLoopReport>(NUTRITION_PATH);
  const dominant = pack.domains
    .slice()
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 4)
    .map((domain) => domain.id);
  const absorbedPrinciples = unique(
    pack.domains
      .slice()
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 4)
      .flatMap((domain) => domain.distilled_knowledge.slice(0, 2)),
  );
  const retrievalIndex = pack.domains.map((domain) => ({
    domain_id: domain.id,
    weight: Number(domain.priority.toFixed(4)),
    cues: unique([
      domain.id,
      ...domain.focus,
      ...domain.distilled_knowledge.flatMap((entry) =>
        entry
          .toLowerCase()
          .replace(/[^a-z0-9àèéìòù\s]/gi, " ")
          .split(/\s+/)
          .filter((token) => token.length >= 4)
          .slice(0, 6),
      ),
    ]).slice(0, 24),
  }));

  const essence: AssimilatedEssence = {
    version: "nyra_assimilated_essence_v1",
    generated_at: new Date().toISOString(),
    integration_mode: "internalized_runtime",
    dominant_domains: dominant,
    next_hunger_domains: nutrition.next_domains,
    nourishment_cycle: nutrition.cycle,
    study_drive: {
      why_now: nutrition.ranked_domains.slice(0, 4).map((domain) => `${domain.id}: ${domain.why_now}`),
      next_actions: nutrition.next_actions,
    },
    absorbed_principles: absorbedPrinciples,
    retrieval_index: retrievalIndex,
  };

  writeFileSync(ESSENCE_PATH, JSON.stringify(essence, null, 2));
  console.log(JSON.stringify({
    ok: true,
    version: essence.version,
    dominant_domains: essence.dominant_domains,
    next_hunger_domains: essence.next_hunger_domains,
    essence_path: ESSENCE_PATH,
  }, null, 2));
}

main();

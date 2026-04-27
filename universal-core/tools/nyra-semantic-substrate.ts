import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type AdvancedMemoryPack = {
  pack_version: string;
  generated_at: string;
  selected_domains: string[];
  domains: Array<{
    id: string;
    priority: number;
    focus: string[];
    source_count: number;
    distilled_knowledge: string[];
    retained_constraints: string[];
  }>;
};

type AssimilatedEssence = {
  version: string;
  generated_at: string;
  dominant_domains: string[];
  next_hunger_domains: string[];
  retrieval_index: Array<{
    domain_id: string;
    weight: number;
    cues: string[];
  }>;
};

type SemanticSubstrate = {
  version: "nyra_semantic_substrate_v1";
  generated_at: string;
  source: {
    advanced_pack_version: string;
    essence_version: string;
  };
  missing_capabilities_vs_generalist_model: Array<{
    id: string;
    label: string;
    why_missing: string;
    architecture_need: string;
  }>;
  memory_architecture: {
    hot: { role: string; target_budget_mb: number };
    warm: { role: string; target_budget_mb: number };
    cold: { role: string; target_budget_gb: number };
  };
  runtime_disciplines: Array<{
    id: string;
    rule: string;
    source_domains: string[];
  }>;
  abstraction_families: Array<{
    id: string;
    label: string;
    source_domains: string[];
    operators: string[];
  }>;
  transfer_routes: Array<{
    from_domain: string;
    to_runtime: string;
    operator: string;
  }>;
  retrieval_priorities: Array<{
    domain_id: string;
    weight: number;
    cues: string[];
  }>;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const PACK_PATH = join(RUNTIME_DIR, "nyra_advanced_memory_pack_latest.json");
const ESSENCE_PATH = join(RUNTIME_DIR, "nyra_assimilated_essence_latest.json");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_semantic_substrate_latest.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function hasDomain(pack: AdvancedMemoryPack, id: string): boolean {
  return pack.domains.some((entry) => entry.id === id);
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  if (!existsSync(PACK_PATH)) throw new Error(`advanced_pack_missing:${PACK_PATH}`);
  if (!existsSync(ESSENCE_PATH)) throw new Error(`essence_missing:${ESSENCE_PATH}`);

  const pack = readJson<AdvancedMemoryPack>(PACK_PATH);
  const essence = readJson<AssimilatedEssence>(ESSENCE_PATH);

  const runtimeDisciplines = unique([
    hasDomain(pack, "autonomy_progression") ? "evidence_before_claim" : "",
    hasDomain(pack, "autonomy_progression") ? "repair_requires_verify" : "",
    hasDomain(pack, "applied_math") ? "model_before_symbol" : "",
    hasDomain(pack, "general_physics") ? "causality_before_formula" : "",
    hasDomain(pack, "quantum_physics") ? "state_measure_probability_split" : "",
  ]).map((id) => ({
    id,
    rule:
      id === "evidence_before_claim"
        ? "non trasformare continuita verbale o stile coerente in prova di autonomia reale"
        : id === "repair_requires_verify"
          ? "ogni auto-correzione deve chiudersi con verify-after-fix"
          : id === "model_before_symbol"
            ? "trattare funzioni e formule come modelli esplicativi, non come simboli isolati"
            : id === "causality_before_formula"
              ? "partire da causalita e conservazione prima della formula singola"
              : "tenere distinti stato, misura e probabilita nei problemi ad alta astrazione",
    source_domains:
      id === "evidence_before_claim" || id === "repair_requires_verify"
        ? ["autonomy_progression"]
        : id === "model_before_symbol"
          ? ["applied_math"]
          : id === "causality_before_formula"
            ? ["general_physics"]
            : ["quantum_physics"],
  }));

  const abstractionFamilies = [
    {
      id: "evidence_control_family",
      label: "Evidence vs Style",
      source_domains: ["autonomy_progression"],
      operators: ["separate_claim_from_proof", "detect_simulation_without_control", "verify_after_fix"],
    },
    {
      id: "modeling_family",
      label: "Model Before Formula",
      source_domains: ["applied_math", "general_physics"],
      operators: ["abstract_problem_to_model", "read_variation", "map_cause_to_effect"],
    },
    {
      id: "uncertainty_family",
      label: "State / Measure / Probability",
      source_domains: ["quantum_physics"],
      operators: ["separate_state_measure_probability", "avoid_fake_certainty", "preserve_observational_limits"],
    },
  ].filter((entry) => entry.source_domains.every((id) => hasDomain(pack, id) || id === "general_physics"));

  const transferRoutes = [
    { from_domain: "autonomy_progression", to_runtime: "owner_truth", operator: "separate_claim_from_proof" },
    { from_domain: "autonomy_progression", to_runtime: "self_repair", operator: "verify_after_fix" },
    { from_domain: "applied_math", to_runtime: "technical_explain", operator: "abstract_problem_to_model" },
    { from_domain: "general_physics", to_runtime: "technical_explain", operator: "map_cause_to_effect" },
    { from_domain: "quantum_physics", to_runtime: "technical_explain", operator: "separate_state_measure_probability" },
  ].filter((entry) => hasDomain(pack, entry.from_domain));

  const substrate: SemanticSubstrate = {
    version: "nyra_semantic_substrate_v1",
    generated_at: new Date().toISOString(),
    source: {
      advanced_pack_version: pack.pack_version,
      essence_version: essence.version,
    },
    missing_capabilities_vs_generalist_model: [
      {
        id: "compressed_pretraining_substrate",
        label: "substrato compresso multi-dominio",
        why_missing: "Nyra studia per pack e branch; non parte con una compressione trasversale gia formata",
        architecture_need: "costruire un substrato semantico unico che trasformi studio in operatori riusabili",
      },
      {
        id: "native_generalization",
        label: "generalizzazione nativa",
        why_missing: "Nyra trasferisce ancora poco tra dominio studiato e risposta finale",
        architecture_need: "aggiungere famiglie di astrazione e regole di transfer route",
      },
      {
        id: "uncertainty_calibration",
        label: "calibrazione interna dell incertezza",
        why_missing: "tende ancora a ripetere verify senza cambiare modello quando ristagna",
        architecture_need: "misurare delta reale su output owner-only e cambiare strategia automaticamente",
      },
    ],
    memory_architecture: {
      hot: { role: "dialogo vivo, stato locale, priorita attive", target_budget_mb: 256 },
      warm: { role: "substrato semantico, retrieval e abstraction families", target_budget_mb: 2048 },
      cold: { role: "corpus, fonti, shard storici e memoria lunga compressa", target_budget_gb: 10 },
    },
    runtime_disciplines: runtimeDisciplines,
    abstraction_families: abstractionFamilies,
    transfer_routes: transferRoutes,
    retrieval_priorities: essence.retrieval_index
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 16)
      .map((entry) => ({
        domain_id: entry.domain_id,
        weight: entry.weight,
        cues: entry.cues.slice(0, 12),
      })),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(substrate, null, 2));
  console.log(JSON.stringify({
    ok: true,
    output_path: OUTPUT_PATH,
    abstraction_families: substrate.abstraction_families.map((entry) => entry.id),
    runtime_disciplines: substrate.runtime_disciplines.map((entry) => entry.id),
  }, null, 2));
}

main();

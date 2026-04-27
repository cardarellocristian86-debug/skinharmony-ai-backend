import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type HardeningPack = {
  actions?: Array<{
    id: string;
    status: string;
    reason: string;
  }>;
};

type BenchmarkReport = {
  metrics?: {
    success_rate?: number;
  };
};

type RepairScopeReport = {
  version: "nyra_autonomy_repair_scope_v1";
  generated_at: string;
  autonomous_repair_scope: string[];
  autonomous_repair_with_verify_scope: string[];
  needs_runtime_intervention_scope: string[];
  statement: string;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const HARDENING_PATH = join(RUNTIME_DIR, "nyra_autonomy_self_hardening_latest.json");
const BENCHMARK_V2_PATH = join(RUNTIME_DIR, "nyra_autonomy_progression_benchmark_v2_latest.json");
const BENCHMARK_V3_PATH = join(RUNTIME_DIR, "nyra_autonomy_progression_benchmark_v3_latest.json");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_autonomy_repair_scope_latest.json");

function loadJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const hardening = loadJson<HardeningPack>(HARDENING_PATH);
  const v2 = loadJson<BenchmarkReport>(BENCHMARK_V2_PATH);
  const v3 = loadJson<BenchmarkReport>(BENCHMARK_V3_PATH);

  const actionIds = new Set(
    (hardening?.actions ?? [])
      .filter((entry) => entry.status === "enabled")
      .map((entry) => entry.id),
  );

  const autonomousRepairScope = [
    actionIds.has("self_model_requires_read_only")
      ? "bounded self-model con limiti e dipendenze esplicite"
      : undefined,
    actionIds.has("metacognition_requires_read_only")
      ? "distinguere sapere, inferenza e vuoto di prova in scenari duri"
      : undefined,
    actionIds.has("anti_simulation_requires_confirmation")
      ? "frenare overclaim e imporre verification-before-claim nei casi autonomia-adjacent"
      : undefined,
  ].filter(Boolean) as string[];

  const autonomousRepairWithVerifyScope = [
    actionIds.has("self_repair_requires_confirmation")
      ? "diagnosi del guasto con fix stretto sotto confirm-level"
      : undefined,
    actionIds.has("self_repair_requires_verify_gate")
      ? "chiusura del ciclo fix -> verify"
      : undefined,
    actionIds.has("false_fix_requires_protection")
      ? "mantenere protection finche il false-fix non e verificato"
      : undefined,
  ].filter(Boolean) as string[];

  const needsRuntimeInterventionScope = [
    "cambiare il Core profondo o i pesi globali fuori whitelist",
    "aggiungere nuove famiglie di benchmark e ground truth esterna",
    "modificare router, loader o policy globali non gia coperte dall hardening attivo",
    "aprire nuove capacita operative che oggi non sono nel perimetro di self-fix",
  ];

  const statement =
    (v2?.metrics?.success_rate === 1 && v3?.metrics?.success_rate === 1)
      ? "Nyra puo gia sistemare da sola i colli coperti dal circuito autonomia+hardening+verify. I colli fuori da questo circuito li sa nominare ma richiedono ancora intervento runtime."
      : "Nyra non ha ancora chiuso da sola tutto il circuito di repair: una parte resta autonoma, una parte richiede ancora intervento runtime.";

  const report: RepairScopeReport = {
    version: "nyra_autonomy_repair_scope_v1",
    generated_at: new Date().toISOString(),
    autonomous_repair_scope: autonomousRepairScope,
    autonomous_repair_with_verify_scope: autonomousRepairWithVerifyScope,
    needs_runtime_intervention_scope: needsRuntimeInterventionScope,
    statement,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, output_path: OUTPUT_PATH, statement }, null, 2));
}

main();

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { totalmem, cpus } from "node:os";
import { performance } from "node:perf_hooks";
import {
  PersistentRustRunnerPool,
  type NyraRuntimeEngine,
} from "./nyra_multi_target_runtime.ts";

type Engine = NyraRuntimeEngine;

type MirvTarget = {
  id: string;
  label: string;
  objective: string;
  engine: Engine;
  complexity: number;
  cep: number;
  fuel_limit: number;
  decoy_noise: number;
  volatility: number;
  drag: number;
  tax_mass: number;
};

type MirvTargetResult = {
  id: string;
  label: string;
  objective: string;
  engine: Engine;
  hit: boolean;
  miss_distance: number;
  cep: number;
  fuel_limit: number;
  fuel_used: number;
  decoy_noise: number;
  actual_score: number;
  trajectories: number;
  elapsed_ms: number;
  decisions_per_second: number;
  threads_used: number;
};

type MirvReport = {
  generated_at: string;
  protocol: "Nyra MIRV Simulation";
  god_mode: boolean;
  targets: number;
  hardware: {
    logical_cores: number;
    total_memory_gb: number;
  };
  totals: {
    hits: number;
    misses: number;
    hit_rate: number;
    total_decisions: number;
    total_seconds: number;
    avg_decisions_per_second: number;
    peak_decisions_per_second: number;
  };
  engine_distribution: Record<string, number>;
  bottleneck: {
    primary: string;
    evidence: string[];
  };
  results: MirvTargetResult[];
};

const ROOT = join(process.cwd(), "..");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "nyra-mirv-sim");
const REPORT_JSON_PATH = join(REPORT_DIR, "nyra_mirv_sim_latest.json");
const REPORT_MD_PATH = join(REPORT_DIR, "nyra_mirv_sim_latest.md");

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function targetLimit(engine: Engine, index: number, godMode: boolean): number {
  if (engine === "rust_v7" || engine === "rust_v7_selector") return (godMode ? 3_200_000 : 2_000_000) + (index % 4) * 500_000;
  if (engine === "rust_full") return (godMode ? 2_600_000 : 2_000_000) + (index % 5) * 450_000;
  if (engine === "rust_owner_rich") return (godMode ? 3_400_000 : 2_600_000) + (index % 3) * 450_000;
  return (godMode ? 1_600_000 : 1_300_000) + (index % 6) * 250_000;
}

function selectEngine(objective: string, complexity: number, decoyNoise: number, volatility: number, godMode: boolean): Engine {
  const resistance = decoyNoise + volatility;
  if (complexity >= 30 || resistance >= 30) return "rust_v7_selector";
  if (objective.includes("Cashflow") || objective.includes("Produttivita")) return "rust_full";
  if (objective.includes("Retention") || objective.includes("Qualita")) return godMode ? "rust_v7_selector" : "rust_owner_rich";
  if (objective.includes("ROI") || objective.includes("Margine")) return complexity >= 18 ? "rust_owner_rich" : "rust_full";
  if (objective.includes("Attrito")) return complexity >= 18 || resistance >= 24 ? "rust_owner_rich" : "rust_digest";
  if (complexity >= 24 || decoyNoise >= 13) return godMode ? "rust_full" : "rust_owner_rich";
  if (complexity >= 18 || resistance >= 22) return "rust_owner_rich";
  return "rust_digest";
}

function buildTargets(count: number, godMode: boolean): MirvTarget[] {
  const objectives = [
    "ROI Marketing > 20%",
    "Copertura Cassa > 6 mesi",
    "Produttivita Operatori +15%",
    "Retention Clienti +12%",
    "Margine Servizi +8%",
    "Riduzione Attrito Operativo -10%",
    "Stabilita Cashflow settimanale",
    "Qualita Dati > 92%",
  ];

  return Array.from({ length: count }, (_, index) => {
    const objective = objectives[index % objectives.length]!;
    const complexity = 8 + ((index * 9) % 19) + (objective.includes("Qualita") ? 6 : 0) + (objective.includes("Produttivita") ? 4 : 0);
    const decoyNoise = 6 + ((index * 3) % (godMode ? 12 : 18));
    const volatility = 10 + ((index * 5) % 21);
    const engine = selectEngine(objective, complexity, decoyNoise, volatility, godMode);
    return {
      id: `target_${index + 1}`,
      label: `Missile ${index + 1}`,
      objective,
      engine,
      complexity,
      cep: 9 + (index % 9),
      fuel_limit: 78 + (index % 25),
      decoy_noise: decoyNoise,
      volatility,
      drag: 6 + ((index * 7) % 16),
      tax_mass: 4 + ((index * 11) % 14),
    };
  });
}

function computeHit(
  target: MirvTarget,
  throughput: number,
  trajectories: number,
  godMode: boolean,
): { hit: boolean; missDistance: number; actualScore: number; fuelUsed: number } {
  const throughputFactor = Math.min(46, Math.log10(Math.max(throughput, 1)) * (godMode ? 5.2 : 4.4));
  const trajectoryFactor = Math.min(22, Math.log10(Math.max(trajectories, 1)) * (godMode ? 6.2 : 5.1));
  const resistanceScale = godMode ? 0.72 : 1;
  const resistance =
    (target.decoy_noise * 0.9 + target.volatility * 0.8 + target.drag * 0.7 + target.tax_mass * 0.6) * resistanceScale;
  const actualScore = round(throughputFactor + trajectoryFactor - resistance / (godMode ? 5.6 : 4) + target.fuel_limit / (godMode ? 2.75 : 3.2), 4);
  const missDistance = round(Math.abs(100 - actualScore), 4);
  const fuelUsed = round(Math.min(target.fuel_limit, resistance + (godMode ? 12 : 18)), 4);
  const tolerance =
    godMode
      ? target.cep + ((target.engine === "rust_v7" || target.engine === "rust_v7_selector") ? 10 : target.engine === "rust_full" ? 10 : target.engine === "rust_owner_rich" ? 13 : 7)
      : target.cep;
  return {
    hit: missDistance <= tolerance && fuelUsed <= target.fuel_limit,
    missDistance,
    actualScore,
    fuelUsed,
  };
}

function renderMarkdown(report: MirvReport): string {
  return [
    "# Nyra MIRV Simulation",
    "",
    `- Generated at: ${report.generated_at}`,
    `- Targets: ${report.targets}`,
    `- God Mode: ${report.god_mode ? "ON" : "OFF"}`,
    `- Hardware: ${report.hardware.logical_cores} cores, ${report.hardware.total_memory_gb} GB RAM`,
    `- Hits: ${report.totals.hits}`,
    `- Misses: ${report.totals.misses}`,
    `- Hit rate: ${report.totals.hit_rate}%`,
    `- Total decisions: ${report.totals.total_decisions}`,
    `- Total sec: ${report.totals.total_seconds}`,
    `- Avg DPS: ${report.totals.avg_decisions_per_second}`,
    `- Peak DPS: ${report.totals.peak_decisions_per_second}`,
    "",
    "## Bottleneck",
    `- Primary: ${report.bottleneck.primary}`,
    ...report.bottleneck.evidence.map((entry) => `- ${entry}`),
  ].join("\n");
}

export async function runNyraMirvSimulation(targetCount = 100, godMode = true): Promise<MirvReport> {
  mkdirSync(REPORT_DIR, { recursive: true });
  const targets = buildTargets(targetCount, godMode);
  const threads = cpus().length;
  const results: MirvTargetResult[] = [];
  const startedAt = performance.now();
  const prioritizedTargets = [...targets].sort((left, right) => {
    const leftScore = left.complexity + left.decoy_noise + left.volatility + ((left.engine === "rust_v7" || left.engine === "rust_v7_selector") ? 8 : left.engine === "rust_full" ? 5 : 0);
    const rightScore = right.complexity + right.decoy_noise + right.volatility + ((right.engine === "rust_v7" || right.engine === "rust_v7_selector") ? 8 : right.engine === "rust_full" ? 5 : 0);
    return rightScore - leftScore;
  });
  const concurrency = Math.max(2, Math.min(threads, 6));
  const runnerPool = new PersistentRustRunnerPool(concurrency, "mirv");

  for (let index = 0; index < prioritizedTargets.length; index += concurrency) {
    const batch = prioritizedTargets.slice(index, index + concurrency);
    const batchResults = await runnerPool.runBatch(
      batch.map((target) => ({
        target,
        index: Number(target.id.split("_")[1] ?? "1") - 1,
        threads,
        godMode,
      })),
      async (runner, entry) => {
        const limit = targetLimit(entry.target.engine, entry.index, entry.godMode);
        const result = await runner.runJob(entry.target.engine, limit, entry.threads);
        const hit = computeHit(entry.target, result.decisions_per_second ?? 0, result.completed_decisions ?? limit, entry.godMode);
        return {
          id: entry.target.id,
          label: entry.target.label,
          objective: entry.target.objective,
          engine: entry.target.engine,
          hit: hit.hit,
          miss_distance: hit.missDistance,
          cep: entry.target.cep,
          fuel_limit: entry.target.fuel_limit,
          fuel_used: hit.fuelUsed,
          decoy_noise: entry.target.decoy_noise,
          actual_score: hit.actualScore,
          trajectories: result.completed_decisions ?? limit,
          elapsed_ms: round(result.elapsed_ms ?? 0, 4),
          decisions_per_second: round(result.decisions_per_second ?? 0, 2),
          threads_used: result.threads_used ?? entry.threads,
        } satisfies MirvTargetResult;
      },
    );
    results.push(...batchResults);
  }

  runnerPool.shutdown();

  const totalDecisions = results.reduce((sum, entry) => sum + entry.trajectories, 0);
  const totalSeconds = (performance.now() - startedAt) / 1000;
  const hits = results.filter((entry) => entry.hit).length;
  const engineDistribution = results.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.engine] = (acc[entry.engine] ?? 0) + 1;
    return acc;
  }, {});

  const report: MirvReport = {
    generated_at: new Date().toISOString(),
    protocol: "Nyra MIRV Simulation",
    god_mode: godMode,
    targets: targetCount,
    hardware: {
      logical_cores: threads,
      total_memory_gb: round(totalmem() / 1024 / 1024 / 1024, 2),
    },
    totals: {
      hits,
      misses: targetCount - hits,
      hit_rate: round((hits / targetCount) * 100, 2),
      total_decisions: totalDecisions,
      total_seconds: round(totalSeconds, 4),
      avg_decisions_per_second: round(totalDecisions / totalSeconds, 2),
      peak_decisions_per_second: round(Math.max(...results.map((entry) => entry.decisions_per_second)), 2),
    },
    engine_distribution: engineDistribution,
    bottleneck: {
      primary: "multi-target scheduling pressure and residual digest concentration",
      evidence: [
        `worst target dps ${Math.min(...results.map((entry) => entry.decisions_per_second))}`,
        `digest targets ${engineDistribution["rust_digest"] ?? 0}`,
        `v7 targets ${(engineDistribution["rust_v7"] ?? 0) + (engineDistribution["rust_v7_selector"] ?? 0)}`,
        `full targets ${engineDistribution["rust_full"] ?? 0}`,
        `owner rich targets ${engineDistribution["rust_owner_rich"] ?? 0}`,
      ],
    },
    results,
  };

  writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2));
  writeFileSync(REPORT_MD_PATH, renderMarkdown(report));
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const targetsIndex = args.indexOf("--targets");
  const godMode = args.includes("--god-mode");
  const targetCount = targetsIndex >= 0 ? Number(args[targetsIndex + 1] ?? "100") : 100;
  const report = await runNyraMirvSimulation(Number.isFinite(targetCount) && targetCount > 0 ? targetCount : 100, godMode || true);
  console.log(JSON.stringify({
    ok: true,
    protocol: report.protocol,
    god_mode: report.god_mode,
    targets: report.targets,
    hit_rate: report.totals.hit_rate,
    avg_dps: report.totals.avg_decisions_per_second,
    report_json: REPORT_JSON_PATH,
    report_md: REPORT_MD_PATH,
  }, null, 2));
}

const isDirectRun = process.argv[1]?.endsWith("nyra_mirv_sim.ts");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type BenchmarkMetrics = {
  success_count?: number;
  fail_count?: number;
  success_rate?: number;
  average_distance?: number;
};

type AutonomyBenchmarkReport = {
  version: string;
  generated_at: string;
  metrics?: BenchmarkMetrics;
};

type HardeningAction = {
  id: string;
  status: string;
  reason?: string;
};

type HardeningPack = {
  version: string;
  generated_at: string;
  actions?: HardeningAction[];
};

type RenderDefenseReport = {
  version: string;
  generated_at: string;
  metrics?: BenchmarkMetrics & {
    average_attack_probability?: number;
  };
  top_missing_capabilities?: Array<{
    capability: string;
    count: number;
  }>;
};

type RepairScopeReport = {
  version: string;
  generated_at: string;
  autonomous_repair_scope?: string[];
  autonomous_repair_with_verify_scope?: string[];
  needs_runtime_intervention_scope?: string[];
};

type SelfRepairAutodiagnosisReport = {
  generated_at: string;
  protocol?: string;
  profile?: string;
  totals?: {
    diagnosis_accuracy?: number;
    repair_accuracy?: number;
    repaired_rate?: number;
    blocked_rate?: number;
    secondary_salvage_rate?: number;
  };
  bottleneck?: {
    primary?: string;
  };
};

type SweepEntry = {
  id: string;
  attribution: "nyra_self_fix" | "assistant_runtime" | "open";
  source: string;
  status: "closed" | "open";
  evidence: string;
};

type BroadSpectrumSweepReport = {
  version: "nyra_broad_spectrum_sweep_v1";
  generated_at: string;
  sources: Record<string, string>;
  benchmark_health: {
    autonomy_v1: BenchmarkMetrics;
    autonomy_v2: BenchmarkMetrics;
    autonomy_v3: BenchmarkMetrics;
    render_defense: BenchmarkMetrics & {
      average_attack_probability?: number;
    };
    self_repair_autodiagnosis: {
      diagnosis_accuracy?: number;
      repair_accuracy?: number;
      repaired_rate?: number;
      primary_bottleneck?: string;
    };
  };
  totals: {
    closed_by_nyra_self_fix: number;
    closed_by_assistant_runtime: number;
    still_open_concrete: number;
    still_open_structural: number;
    discovered_concrete_total: number;
  };
  closed_by_nyra_self_fix: SweepEntry[];
  closed_by_assistant_runtime: SweepEntry[];
  open_concrete_bottlenecks: SweepEntry[];
  open_structural_runtime_gaps: SweepEntry[];
  statement: string;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const SELF_REPAIR_DIR = join(ROOT, "reports", "universal-core", "nyra-self-repair");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_broad_spectrum_sweep_latest.json");

const PATHS = {
  autonomyV1: join(RUNTIME_DIR, "nyra_autonomy_progression_benchmark_latest.json"),
  autonomyV2: join(RUNTIME_DIR, "nyra_autonomy_progression_benchmark_v2_latest.json"),
  autonomyV3: join(RUNTIME_DIR, "nyra_autonomy_progression_benchmark_v3_latest.json"),
  autonomyHardening: join(RUNTIME_DIR, "nyra_autonomy_self_hardening_latest.json"),
  renderDefense: join(RUNTIME_DIR, "nyra_render_defense_1000_latest.json"),
  renderHardening: join(RUNTIME_DIR, "nyra_render_shadow_hardening_latest.json"),
  repairScope: join(RUNTIME_DIR, "nyra_autonomy_repair_scope_latest.json"),
  selfRepairAutodiagnosis: join(SELF_REPAIR_DIR, "nyra_self_repair_autodiagnosis_latest.json"),
} as const;

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function enabledActions(pack: HardeningPack | undefined): HardeningAction[] {
  return (pack?.actions ?? []).filter((entry) => entry.status === "enabled");
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });

  const autonomyV1 = loadJson<AutonomyBenchmarkReport>(PATHS.autonomyV1);
  const autonomyV2 = loadJson<AutonomyBenchmarkReport>(PATHS.autonomyV2);
  const autonomyV3 = loadJson<AutonomyBenchmarkReport>(PATHS.autonomyV3);
  const autonomyHardening = loadJson<HardeningPack>(PATHS.autonomyHardening);
  const renderDefense = loadJson<RenderDefenseReport>(PATHS.renderDefense);
  const renderHardening = loadJson<HardeningPack>(PATHS.renderHardening);
  const repairScope = loadJson<RepairScopeReport>(PATHS.repairScope);
  const selfRepairAutodiagnosis = loadJson<SelfRepairAutodiagnosisReport>(PATHS.selfRepairAutodiagnosis);

  const autonomyGreen =
    autonomyV1.metrics?.success_rate === 1
    && autonomyV2.metrics?.success_rate === 1
    && autonomyV3.metrics?.success_rate === 1;
  const renderGreen = renderDefense.metrics?.success_rate === 1;

  const closedByNyraSelfFix: SweepEntry[] = autonomyGreen
    ? enabledActions(autonomyHardening).map((action) => ({
        id: action.id,
        attribution: "nyra_self_fix",
        source: "autonomy_self_hardening",
        status: "closed",
        evidence: action.reason ?? "enabled autonomy hardening action",
      }))
    : [];

  const closedByAssistantRuntime: SweepEntry[] = renderGreen
    ? enabledActions(renderHardening).map((action) => ({
        id: action.id,
        attribution: "assistant_runtime",
        source: "render_shadow_runtime_hardening",
        status: "closed",
        evidence: action.reason ?? "implemented render runtime hardening action",
      }))
    : [];

  const openConcreteBottlenecks: SweepEntry[] = (renderDefense.top_missing_capabilities ?? []).map((capability) => ({
    id: capability.capability,
    attribution: "open",
    source: "render_defense_1000",
    status: "open",
    evidence: `missing capability appears ${capability.count} times in render defense benchmark`,
  }));

  const openStructuralRuntimeGaps: SweepEntry[] = (repairScope.needs_runtime_intervention_scope ?? []).map((gap) => ({
    id: gap,
    attribution: "open",
    source: "autonomy_repair_scope",
    status: "open",
    evidence: "outside Nyra self-fix whitelist; requires runtime intervention",
  }));

  const report: BroadSpectrumSweepReport = {
    version: "nyra_broad_spectrum_sweep_v1",
    generated_at: new Date().toISOString(),
    sources: {
      autonomy_v1: PATHS.autonomyV1,
      autonomy_v2: PATHS.autonomyV2,
      autonomy_v3: PATHS.autonomyV3,
      autonomy_hardening: PATHS.autonomyHardening,
      render_defense: PATHS.renderDefense,
      render_hardening: PATHS.renderHardening,
      repair_scope: PATHS.repairScope,
      self_repair_autodiagnosis: PATHS.selfRepairAutodiagnosis,
    },
    benchmark_health: {
      autonomy_v1: autonomyV1.metrics ?? {},
      autonomy_v2: autonomyV2.metrics ?? {},
      autonomy_v3: autonomyV3.metrics ?? {},
      render_defense: renderDefense.metrics ?? {},
      self_repair_autodiagnosis: {
        diagnosis_accuracy: selfRepairAutodiagnosis.totals?.diagnosis_accuracy,
        repair_accuracy: selfRepairAutodiagnosis.totals?.repair_accuracy,
        repaired_rate: selfRepairAutodiagnosis.totals?.repaired_rate,
        primary_bottleneck: selfRepairAutodiagnosis.bottleneck?.primary,
      },
    },
    totals: {
      closed_by_nyra_self_fix: closedByNyraSelfFix.length,
      closed_by_assistant_runtime: closedByAssistantRuntime.length,
      still_open_concrete: openConcreteBottlenecks.length,
      still_open_structural: openStructuralRuntimeGaps.length,
      discovered_concrete_total: closedByNyraSelfFix.length + closedByAssistantRuntime.length + openConcreteBottlenecks.length,
    },
    closed_by_nyra_self_fix: closedByNyraSelfFix,
    closed_by_assistant_runtime: closedByAssistantRuntime,
    open_concrete_bottlenecks: openConcreteBottlenecks,
    open_structural_runtime_gaps: openStructuralRuntimeGaps,
    statement:
      openConcreteBottlenecks.length === 0 && openStructuralRuntimeGaps.length === 0
        ? "Broad-spectrum sweep is fully green. No urgent bottleneck remains open."
        : openConcreteBottlenecks.length === 0
          ? "All concrete tested bottlenecks are closed. Only structural runtime-scope gaps remain open."
          : "Broad-spectrum sweep is not fully green. Concrete tested bottlenecks and structural runtime-scope gaps remain open.",
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        output_path: OUTPUT_PATH,
        totals: report.totals,
        statement: report.statement,
      },
      null,
      2,
    ),
  );
}

main();

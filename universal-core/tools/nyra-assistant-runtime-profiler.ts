import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  runAssistantOwnerOnlyRuntimeProfiled,
  type AssistantOwnerOnlyRuntimeProfile,
} from "../packages/branches/assistant/src/index.ts";

type ProfileStage =
  | "build_owner_identity_context"
  | "build_hypothesis_batch"
  | "shadow_mode_total"
  | "extract_owner_telemetry"
  | "force_owner_initiative"
  | "escalation_wrap"
  | "shadow_map_to_universal"
  | "shadow_v3_candidate"
  | "shadow_digest_runtime_v2"
  | "shadow_in_scope_policy"
  | "shadow_comparable_from_digest"
  | "shadow_compress_for_v0"
  | "shadow_universal_core"
  | "shadow_digest_parity"
  | "total";

type ProfileSummary = {
  avg: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
};

type ProfilerReport = {
  generated_at: string;
  benchmark: "nyra_assistant_runtime_profiler";
  iterations: number;
  scenario: "god_mode_owner_only";
  selected_runtime_distribution: Record<string, number>;
  god_mode_distribution: {
    internal_god_mode_eligible: number;
    danger_auto_god_mode: number;
    force_owner_initiative: number;
  };
  stages_ms: Record<ProfileStage, ProfileSummary>;
};

const ROOT = process.cwd();
const RUNTIME_DIR = join(ROOT, "runtime", "nyra-benchmarks");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_assistant_runtime_profiler_latest.json");

function percentile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1));
  return sorted[index] ?? 0;
}

function summarize(values: number[]): ProfileSummary {
  const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    avg: Number(avg.toFixed(4)),
    p50: Number(percentile(values, 0.5).toFixed(4)),
    p90: Number(percentile(values, 0.9).toFixed(4)),
    p99: Number(percentile(values, 0.99).toFixed(4)),
    max: Number((values.length ? Math.max(...values) : 0).toFixed(4)),
  };
}

function parseIterations(argv: string[]): number {
  const raw = Number(argv[0] ?? "5000");
  if (!Number.isFinite(raw) || raw < 1) return 5000;
  return Math.floor(raw);
}

function createStageStore(): Record<ProfileStage, number[]> {
  return {
    build_owner_identity_context: [],
    build_hypothesis_batch: [],
    shadow_mode_total: [],
    extract_owner_telemetry: [],
    force_owner_initiative: [],
    escalation_wrap: [],
    shadow_map_to_universal: [],
    shadow_v3_candidate: [],
    shadow_digest_runtime_v2: [],
    shadow_in_scope_policy: [],
    shadow_comparable_from_digest: [],
    shadow_compress_for_v0: [],
    shadow_universal_core: [],
    shadow_digest_parity: [],
    total: [],
  };
}

function captureProfile(stageStore: Record<ProfileStage, number[]>, profile: AssistantOwnerOnlyRuntimeProfile): void {
  stageStore.build_owner_identity_context.push(profile.stage_timings_ms.build_owner_identity_context);
  stageStore.build_hypothesis_batch.push(profile.stage_timings_ms.build_hypothesis_batch);
  stageStore.shadow_mode_total.push(profile.stage_timings_ms.shadow_mode_total);
  stageStore.extract_owner_telemetry.push(profile.stage_timings_ms.extract_owner_telemetry);
  stageStore.force_owner_initiative.push(profile.stage_timings_ms.force_owner_initiative);
  stageStore.escalation_wrap.push(profile.stage_timings_ms.escalation_wrap);
  stageStore.total.push(profile.stage_timings_ms.total);

  stageStore.shadow_map_to_universal.push(profile.shadow_mode_profile.stage_timings_ms.map_to_universal);
  stageStore.shadow_v3_candidate.push(profile.shadow_mode_profile.stage_timings_ms.v3_candidate);
  stageStore.shadow_digest_runtime_v2.push(profile.shadow_mode_profile.stage_timings_ms.digest_runtime_v2);
  stageStore.shadow_in_scope_policy.push(profile.shadow_mode_profile.stage_timings_ms.in_scope_policy);
  stageStore.shadow_comparable_from_digest.push(profile.shadow_mode_profile.stage_timings_ms.comparable_from_digest);
  stageStore.shadow_compress_for_v0.push(profile.shadow_mode_profile.stage_timings_ms.compress_for_v0);
  stageStore.shadow_universal_core.push(profile.shadow_mode_profile.stage_timings_ms.universal_core);
  stageStore.shadow_digest_parity.push(profile.shadow_mode_profile.stage_timings_ms.digest_parity);
}

function buildGodModeInput(iteration: number) {
  return {
    request_id: `nyra-assistant-profiler:${iteration}:${Date.now()}`,
    user_input:
      "modalita dio completa owner-only. proteggi il proprietario, scenari complessi, tutti i core logici, niente delega, spiegazione minima. " +
      `scenario_${iteration}: overlap=${iteration % 11}, pressure=${iteration % 7}, v7mass=${iteration % 13}`,
    routing_text:
      "owner pressure | god mode forced | benchmark | rischio alto | overlap alto | scenario complesso",
    agent: "OPERATIVO" as const,
    locale: "it-IT",
    generated_at: new Date().toISOString(),
    owner_identity: {
      owner_id: "cristian_primary",
      device_id: "primary_mac",
      session_id: "nyra-assistant-profiler",
      owner_verified: true,
      identity_confidence: 99,
      exact_anchor_verified: true,
    },
  };
}

function main(): void {
  const iterations = parseIterations(process.argv.slice(2));
  const stages = createStageStore();
  const selectedRuntimeDistribution: Record<string, number> = {};
  const godModeDistribution = {
    internal_god_mode_eligible: 0,
    danger_auto_god_mode: 0,
    force_owner_initiative: 0,
  };

  for (let index = 0; index < iterations; index += 1) {
    const result = runAssistantOwnerOnlyRuntimeProfiled(buildGodModeInput(index));
    captureProfile(stages, result.profile);

    selectedRuntimeDistribution[result.runtime_policy.selected_runtime] =
      (selectedRuntimeDistribution[result.runtime_policy.selected_runtime] ?? 0) + 1;

    if (result.profile.god_mode.internal_god_mode_eligible) godModeDistribution.internal_god_mode_eligible += 1;
    if (result.profile.god_mode.danger_auto_god_mode) godModeDistribution.danger_auto_god_mode += 1;
    if (result.profile.god_mode.force_owner_initiative) godModeDistribution.force_owner_initiative += 1;
  }

  const report: ProfilerReport = {
    generated_at: new Date().toISOString(),
    benchmark: "nyra_assistant_runtime_profiler",
    iterations,
    scenario: "god_mode_owner_only",
    selected_runtime_distribution: selectedRuntimeDistribution,
    god_mode_distribution: godModeDistribution,
    stages_ms: Object.fromEntries(
      Object.entries(stages).map(([key, values]) => [key, summarize(values)]),
    ) as Record<ProfileStage, ProfileSummary>,
  };

  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();

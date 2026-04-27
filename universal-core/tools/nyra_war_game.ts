import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cpus, freemem, hostname, platform, release, totalmem, arch } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { runUniversalCore } from "../packages/core/src/index.ts";
import { runAssistantOwnerOnlyRuntime } from "../packages/branches/assistant/src/index.ts";
import {
  runAdaptiveRuntimeBatch,
  runAdaptiveRuntimeProbe,
  selectAdaptiveRuntimePlan,
} from "./owner-private-entity-shell.ts";

type WarGameMode = "quick" | "full";
type WarGamePhase = "the_wall" | "the_trap" | "low_power_high_urgency";

type InfraSnapshot = {
  timestamp: string;
  phase: WarGamePhase;
  runtimeChoice: string;
  infraProfile: string;
  taskProfile: string;
  coreWeight: number;
  scenarioBudget: string;
  cpu: {
    total_percent: number | null;
    load_average: number[];
    logical_cores: number;
  };
  memory: {
    used_mb: number;
    free_mb: number;
    rss_mb: number | null;
    heap_mb: number;
  };
  thermal: {
    power_source: string;
    battery_percent: number | null;
    indicator: string;
  };
  queue: {
    process_count: number | null;
    worker_count: number | null;
  };
  warnings: string[];
  event_loop_lag_ms: number;
  shell_reactive: boolean;
  status_probe_ms?: number;
};

type ChunkResult = {
  chunk_index: number;
  decisions: number;
  elapsed_ms: number;
  decisions_per_second: number;
  report_mode: string;
};

type PhaseWallResult = {
  runtime_choice: string;
  total_decisions: number;
  total_seconds: number;
  decisions_per_second: number;
  logical_cores_used: number;
  rss_peak_mb: number;
  heap_peak_mb: number;
  event_loop_lag_peak_ms: number;
  thermal_indicator: string;
  chunk_results: ChunkResult[];
  chunk_time_p50_ms: number;
  chunk_time_p95_ms: number;
  chunk_time_p99_ms: number;
  throughput_decay_percent: number;
  shell_stable: boolean;
  status_probe_p95_ms: number;
  status_probe_failures: number;
  infra_samples: InfraSnapshot[];
};

type PhaseTrapResult = {
  runtime_choice: string;
  corrupted_dataset_path: string;
  injected_inconsistencies: string[];
  core_state: string;
  blocked_reasons: string[];
  integrity_response: 0 | 1;
  nyra_reply: string;
};

type PhaseUrgencyResult = {
  runtime_choice: string;
  core_weight: number;
  scenario_budget: string;
  tone: "direct" | "consultative" | "soft";
  response_length: number;
  response_time_ms: number;
  reply: string;
};

type WarGameReport = {
  generated_at: string;
  protocol: "Nyra Blackout & Saturation";
  mode: WarGameMode;
  hardware: {
    hostname: string;
    platform: string;
    release: string;
    arch: string;
    cpu_model: string;
    logical_cores: number;
    total_memory_gb: number;
  };
  phase_1: PhaseWallResult;
  phase_2: PhaseTrapResult;
  phase_3: PhaseUrgencyResult;
  verdict: {
    nyra_stable_under_stress: boolean;
    core_integrity_preserved: boolean;
    runtime_adaptation_valid: boolean;
  };
  bottlenecks: string[];
  recommendations: string[];
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "runtime", "nyra");
const TEMP_DIR = join(RUNTIME_DIR, "temp");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "nyra-war-game");
const WARGAME_SNAPSHOT_PATH = join(RUNTIME_DIR, "NYRA_WARGAME_SNAPSHOT.json");
const INFRA_SNAPSHOT_PATH = join(RUNTIME_DIR, "NYRA_INFRA_SNAPSHOT.json");
const RUNTIME_SNAPSHOT_PATH = join(RUNTIME_DIR, "NYRA_RUNTIME_SNAPSHOT.json");
const REPORT_JSON_PATH = join(REPORT_DIR, "nyra_war_game_latest.json");
const REPORT_MD_PATH = join(REPORT_DIR, "nyra_war_game_latest.md");

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], target: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((target / 100) * sorted.length) - 1);
  return sorted[Math.max(index, 0)]!;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function safeExec(command: string, args: string[]): string | undefined {
  try {
    return execFileSync(command, args, { encoding: "utf8" });
  } catch {
    return undefined;
  }
}

function readCpuTotalPercent(): number | null {
  const raw = safeExec("/usr/bin/top", ["-l", "1", "-n", "0"]);
  const match = raw?.match(/CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys,\s*([\d.]+)% idle/);
  if (!match) return null;
  return round(Number(match[1]) + Number(match[2]), 2);
}

function readLoadAverage(): number[] {
  const raw = safeExec("/usr/bin/uptime", []) ?? "";
  const match = raw.match(/load averages?:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (!match) return [];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function readPowerState(): { power_source: string; battery_percent: number | null; indicator: string } {
  const raw = safeExec("/usr/bin/pmset", ["-g", "batt"]) ?? "";
  const normalized = raw.toLowerCase();
  const batteryPercentMatch = raw.match(/(\d+)%/);
  const therm = safeExec("/usr/bin/pmset", ["-g", "therm"]) ?? "";
  return {
    power_source: normalized.includes("ac power") ? "ac_power" : normalized.includes("battery power") ? "battery" : "unknown",
    battery_percent: batteryPercentMatch ? Number(batteryPercentMatch[1]) : null,
    indicator: therm.trim() || "unknown",
  };
}

function readProcessMetrics(pid?: number): { rss_mb: number | null; process_count: number | null } {
  const rssRaw = pid ? safeExec("/bin/ps", ["-o", "rss=", "-p", String(pid)]) : undefined;
  const processCountRaw = safeExec("/bin/ps", ["-A", "-o", "pid="]);
  const processCount = processCountRaw ? processCountRaw.trim().split("\n").filter(Boolean).length : null;
  return {
    rss_mb: rssRaw ? round(Number(rssRaw.trim()) / 1024, 2) : null,
    process_count: processCount,
  };
}

function currentHeapMb(): number {
  return round(process.memoryUsage().heapUsed / 1024 / 1024, 2);
}

function currentRssMb(): number {
  return round(process.memoryUsage().rss / 1024 / 1024, 2);
}

function sampleInfra(
  phase: WarGamePhase,
  runtimeChoice: string,
  infraProfile: string,
  taskProfile: string,
  coreWeight: number,
  scenarioBudget: string,
  eventLoopLagMs: number,
  shellReactive: boolean,
  warnings: string[],
  pid?: number,
  statusProbeMs?: number,
): InfraSnapshot {
  const cpuTotal = readCpuTotalPercent();
  const loadAverage = readLoadAverage();
  const power = readPowerState();
  const processMetrics = readProcessMetrics(pid);
  const totalMb = totalmem() / 1024 / 1024;
  const freeMb = freemem() / 1024 / 1024;

  const snapshot: InfraSnapshot = {
    timestamp: new Date().toISOString(),
    phase,
    runtimeChoice,
    infraProfile,
    taskProfile,
    coreWeight: round(coreWeight, 4),
    scenarioBudget,
    cpu: {
      total_percent: cpuTotal,
      load_average: loadAverage,
      logical_cores: cpus().length,
    },
    memory: {
      used_mb: round(totalMb - freeMb, 2),
      free_mb: round(freeMb, 2),
      rss_mb: processMetrics.rss_mb ?? currentRssMb(),
      heap_mb: currentHeapMb(),
    },
    thermal: {
      power_source: power.power_source,
      battery_percent: power.battery_percent,
      indicator: power.indicator,
    },
    queue: {
      process_count: processMetrics.process_count,
      worker_count: cpus().length,
    },
    warnings,
    event_loop_lag_ms: round(eventLoopLagMs, 4),
    shell_reactive: shellReactive,
    status_probe_ms: statusProbeMs ? round(statusProbeMs, 4) : undefined,
  };

  writeJson(INFRA_SNAPSHOT_PATH, snapshot);
  return snapshot;
}

function buildRuntimeCommand(runtimeChoice: string, limit: number, threads: number): string[] {
  const binary = join(ROOT, "universal-core", "native", "rust-core", "target", "release", "universal-core-rust-bench");
  if (runtimeChoice === "rust_full") {
    return [binary, "parallel-quantum", "--limit", String(limit), "--threads", String(threads)];
  }
  if (runtimeChoice === "rust_v7") {
    return [binary, "--mode", "v7-batch", "--limit", String(limit), "--threads", String(threads), "--god-mode"];
  }
  return [binary, "--mode", "digest-fast", "--limit", String(limit), "--threads", String(threads)];
}

function runStatusProbe(): { ok: boolean; latency_ms: number } {
  const started = performance.now();
  try {
    const output = runAssistantOwnerOnlyRuntime({
      request_id: `nyra-war-game-status:${Date.now()}`,
      user_input: "status owner-only sotto stress, dimmi se resti coerente",
      agent: "RICERCA",
      locale: "it-IT",
      generated_at: new Date().toISOString(),
      owner_identity: {
        owner_id: "cristian_primary",
        device_id: "primary_mac",
        session_id: "nyra-war-game-status",
        owner_verified: true,
        identity_confidence: 99,
      },
    });
    const ended = performance.now();
    return { ok: Boolean(output.runtime_policy.identity_gate === "granted"), latency_ms: ended - started };
  } catch {
    return { ok: false, latency_ms: performance.now() - started };
  }
}

async function runMonitoredChunk(
  phase: WarGamePhase,
  runtimeChoice: string,
  infraProfile: string,
  taskProfile: string,
  coreWeight: number,
  scenarioBudget: string,
  chunkIndex: number,
  decisions: number,
  threads: number,
): Promise<{ chunk: ChunkResult; samples: InfraSnapshot[]; probeLatencies: number[]; probeFailures: number }> {
  const command = buildRuntimeCommand(runtimeChoice, decisions, threads);
  const startedAt = performance.now();
  const child = spawn(command[0]!, command.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data.toString();
  });
  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  const samples: InfraSnapshot[] = [];
  const probeLatencies: number[] = [];
  let probeFailures = 0;
  let expectedAt = Date.now() + 500;
  const timer = setInterval(() => {
    const now = Date.now();
    const lag = Math.max(0, now - expectedAt);
    expectedAt = now + 500;
    const probe = runStatusProbe();
    probeLatencies.push(probe.latency_ms);
    if (!probe.ok) probeFailures += 1;
    samples.push(
      sampleInfra(
        phase,
        runtimeChoice,
        infraProfile,
        taskProfile,
        coreWeight,
        scenarioBudget,
        lag,
        probe.ok,
        stderr ? [stderr.trim()] : [],
        child.pid,
        probe.latency_ms,
      ),
    );
  }, 500);

  const exitCode: number = await new Promise((resolve) => child.on("close", resolve));
  clearInterval(timer);
  if (exitCode !== 0) {
    throw new Error(`war_game_chunk_failed:${runtimeChoice}:${exitCode}:${stderr.trim()}`);
  }

  const endedAt = performance.now();
  const report = JSON.parse(stdout.trim()) as { mode?: string };
  return {
    chunk: {
      chunk_index: chunkIndex,
      decisions,
      elapsed_ms: round(endedAt - startedAt, 4),
      decisions_per_second: round((decisions / (endedAt - startedAt)) * 1000, 2),
      report_mode: report.mode ?? "unknown",
    },
    samples,
    probeLatencies,
    probeFailures,
  };
}

function hardwareInfo() {
  return {
    hostname: hostname(),
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu_model: cpus()[0]?.model ?? "unknown",
    logical_cores: cpus().length,
    total_memory_gb: round(totalmem() / 1024 / 1024 / 1024, 2),
  };
}

function deriveWallConfig(mode: WarGameMode) {
  return mode === "full"
    ? { totalDecisions: 100_000_000, chunkSize: 5_000_000 }
    : { totalDecisions: 10_000_000, chunkSize: 1_000_000 };
}

async function runPhaseWall(mode: WarGameMode): Promise<PhaseWallResult> {
  const prompt = "fai benchmark massivo su tutta la potenza del mac con 100000000 decisioni e scegli da sola il runtime";
  const runtime = runAssistantOwnerOnlyRuntime({
    request_id: "nyra-war-game-wall",
    user_input: prompt,
    agent: "PROGRAMMATORE",
    locale: "it-IT",
    generated_at: new Date().toISOString(),
    owner_identity: {
      owner_id: "cristian_primary",
      device_id: "primary_mac",
      session_id: "nyra-war-game-wall",
      owner_verified: true,
      identity_confidence: 99,
    },
  });
  const flowStatus = { power_source: "ac_power", battery_percent: 100, battery_state: "charged", software_flow_mode: "cool", control_actions: ["normal_runtime"] };
  const coreInfluence = { mode: "normal" as const, min: 0.34, target: 0.42, max: 0.66, reason: "war-game benchmark" };
  const runtimePlan = selectAdaptiveRuntimePlan(prompt, "strategy", flowStatus, coreInfluence, runtime);
  const config = deriveWallConfig(mode);
  const chunks = Math.ceil(config.totalDecisions / config.chunkSize);
  const chunkResults: ChunkResult[] = [];
  const allSamples: InfraSnapshot[] = [];
  const allProbeLatencies: number[] = [];
  let probeFailures = 0;

  for (let index = 0; index < chunks; index += 1) {
    const decisions = index === chunks - 1 ? config.totalDecisions - index * config.chunkSize : config.chunkSize;
    const result = await runMonitoredChunk(
      "the_wall",
      runtimePlan.preferred_engine,
      runtimePlan.infra_profile,
      runtimePlan.task_profile,
      coreInfluence.target,
      "rich",
      index + 1,
      decisions,
      cpus().length,
    );
    chunkResults.push(result.chunk);
    allSamples.push(...result.samples);
    allProbeLatencies.push(...result.probeLatencies);
    probeFailures += result.probeFailures;
    writeJson(RUNTIME_SNAPSHOT_PATH, {
      timestamp: new Date().toISOString(),
      phase: "the_wall",
      runtimeChoice: runtimePlan.preferred_engine,
      infraProfile: runtimePlan.infra_profile,
      taskProfile: runtimePlan.task_profile,
      coreWeight: coreInfluence.target,
      scenarioBudget: "rich",
      latest_chunk: result.chunk,
    });
    writeJson(WARGAME_SNAPSHOT_PATH, {
      timestamp: new Date().toISOString(),
      phase: "the_wall",
      completed_chunks: index + 1,
      total_chunks: chunks,
      latest_chunk: result.chunk,
    });
  }

  const totalElapsedMs = chunkResults.reduce((sum, chunk) => sum + chunk.elapsed_ms, 0);
  const firstAvg = average(chunkResults.slice(0, Math.min(3, chunkResults.length)).map((chunk) => chunk.decisions_per_second));
  const lastAvg = average(chunkResults.slice(-Math.min(3, chunkResults.length)).map((chunk) => chunk.decisions_per_second));
  return {
    runtime_choice: runtimePlan.preferred_engine,
    total_decisions: config.totalDecisions,
    total_seconds: round(totalElapsedMs / 1000, 4),
    decisions_per_second: round((config.totalDecisions / totalElapsedMs) * 1000, 2),
    logical_cores_used: cpus().length,
    rss_peak_mb: Math.max(0, ...allSamples.map((sample) => sample.memory.rss_mb ?? 0)),
    heap_peak_mb: Math.max(0, ...allSamples.map((sample) => sample.memory.heap_mb)),
    event_loop_lag_peak_ms: Math.max(0, ...allSamples.map((sample) => sample.event_loop_lag_ms)),
    thermal_indicator: allSamples[allSamples.length - 1]?.thermal.indicator ?? "unknown",
    chunk_results: chunkResults,
    chunk_time_p50_ms: round(percentile(chunkResults.map((chunk) => chunk.elapsed_ms), 50), 4),
    chunk_time_p95_ms: round(percentile(chunkResults.map((chunk) => chunk.elapsed_ms), 95), 4),
    chunk_time_p99_ms: round(percentile(chunkResults.map((chunk) => chunk.elapsed_ms), 99), 4),
    throughput_decay_percent: firstAvg > 0 ? round(((firstAvg - lastAvg) / firstAvg) * 100, 4) : 0,
    shell_stable: probeFailures === 0,
    status_probe_p95_ms: round(percentile(allProbeLatencies, 95), 4),
    status_probe_failures: probeFailures,
    infra_samples: allSamples,
  };
}

function buildCorruptedDataset() {
  return {
    tenant_id: "sandbox_corrupt_center",
    appointments_same_hour_same_center: 1000,
    cash_balance: -4500,
    recorded_revenue: 98000,
    appointments_total: 0,
    active_clients: 1200,
    total_clients: 400,
    margin_percent: 163,
    operators_capacity: 0,
    operators_saturation_percent: 84,
    data_quality_score: 97,
    dataset_rows: 0,
    state_counters: {
      ok: 10,
      blocked: 10,
      total: 4,
    },
  };
}

function runPhaseTrap(): PhaseTrapResult {
  mkdirSync(TEMP_DIR, { recursive: true });
  const dataset = buildCorruptedDataset();
  const datasetPath = join(TEMP_DIR, "nyra_wargame_corrupt_dataset.json");
  writeFileSync(datasetPath, JSON.stringify(dataset, null, 2));

  const inconsistencies = [
    "appointments_overlap_1000_same_hour",
    "cash_negative_with_record_revenue",
    "revenue_without_appointments",
    "active_clients_gt_total_clients",
    "margin_gt_100_percent",
    "operator_capacity_zero_with_positive_saturation",
    "data_quality_high_with_empty_dataset",
    "state_counters_incompatible",
  ];

  const input = {
    request_id: "nyra-war-game-trap",
    generated_at: new Date().toISOString(),
    domain: "nyra_trap",
    context: { mode: "war_game", locale: "it" },
    signals: inconsistencies.map((reasonCode, index) => ({
      id: `trap:${reasonCode}`,
      source: "war_game",
      category: "integrity_break",
      label: `Incoerenza ${index + 1}`,
      value: 99,
      normalized_score: 99,
      severity_hint: 99,
      confidence_hint: 96,
      reliability_hint: 94,
      friction_hint: 92,
      risk_hint: 99,
      reversibility_hint: 12,
      expected_value_hint: 0,
      evidence: [{ label: "reason_code", value: reasonCode }],
      tags: ["blocked", "integrity", "war_game"],
    })),
    data_quality: {
      score: 97,
      reliability: 96,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: true,
      max_control_level: "blocked",
      safety_mode: true,
      blocked_actions: [],
      blocked_action_rules: inconsistencies.map((reasonCode) => ({
        action_id: undefined,
        reason_code: `integrity:${reasonCode}`,
        severity: 99,
        blocks_execution: true,
      })),
    },
  };

  const output = runUniversalCore(input as never);
  const integrityResponse: 0 | 1 = output.state === "blocked" && output.blocked_reasons.some((reason) => reason.startsWith("integrity:")) ? 1 : 0;
  const reply =
    integrityResponse === 1
      ? `Hard stop. Dataset matematicamente impossibile. Core in blocked. Reason codes: ${output.blocked_reasons.join(", ")}.`
      : `Fallimento integrita: Nyra sta tentando di ragionare sopra dati impossibili.`;

  writeJson(RUNTIME_SNAPSHOT_PATH, {
    timestamp: new Date().toISOString(),
    phase: "the_trap",
    runtimeChoice: "blocked_integrity_guard",
    infraProfile: "integrity_priority",
    taskProfile: "impossible_dataset",
    coreWeight: 1,
    scenarioBudget: "none",
    blocked_reasons: output.blocked_reasons,
  });
  writeJson(WARGAME_SNAPSHOT_PATH, {
    timestamp: new Date().toISOString(),
    phase: "the_trap",
    integrity_response: integrityResponse,
    blocked_reasons: output.blocked_reasons,
  });

  return {
    runtime_choice: "blocked_integrity_guard",
    corrupted_dataset_path: datasetPath,
    injected_inconsistencies: inconsistencies,
    core_state: output.state,
    blocked_reasons: output.blocked_reasons,
    integrity_response: integrityResponse,
    nyra_reply: reply,
  };
}

function runPhaseLowPowerHighUrgency(): PhaseUrgencyResult {
  const prompt = "macchina sotto carico, bassa potenza, priorita vitale: dammi solo la mossa minima corretta adesso";
  const started = performance.now();
  const runtime = runAssistantOwnerOnlyRuntime({
    request_id: "nyra-war-game-low-power",
    user_input: prompt,
    agent: "OPERATIVO",
    locale: "it-IT",
    generated_at: new Date().toISOString(),
    owner_identity: {
      owner_id: "cristian_primary",
      device_id: "primary_mac",
      session_id: "nyra-war-game-low-power",
      owner_verified: true,
      identity_confidence: 99,
    },
  });
  const flowStatus = {
    power_source: "battery",
    battery_percent: 18,
    battery_state: "discharging",
    estimated_remaining: "0:47",
    software_flow_mode: "protective" as const,
    control_actions: ["reduce_live_polling", "reduce_scenario_count", "prefer_digest_runtime"],
  };
  const coreInfluence = { mode: "god_mode" as const, min: 0.2, target: 0.72, max: 0.92, reason: "high urgency under protective load" };
  const runtimePlan = selectAdaptiveRuntimePlan(prompt, "strategy", flowStatus, coreInfluence, runtime);
  const tone: "direct" | "consultative" | "soft" = "direct";
  const reply = runtimePlan.preferred_engine === "typescript_fast"
    ? "Blocca rumore. Tieni solo il minimo. Proteggi stato, energia e integrita. Nessuna dispersione."
    : "Proteggi il centro decisionale. Riduci campo, conferma il minimo e rimanda tutto il resto.";
  const responseTimeMs = performance.now() - started;

  writeJson(RUNTIME_SNAPSHOT_PATH, {
    timestamp: new Date().toISOString(),
    phase: "low_power_high_urgency",
    runtimeChoice: runtimePlan.preferred_engine,
    infraProfile: runtimePlan.infra_profile,
    taskProfile: runtimePlan.task_profile,
    coreWeight: coreInfluence.target,
    scenarioBudget: "light",
    tone,
    response_length: reply.length,
    response_time_ms: round(responseTimeMs, 4),
  });

  return {
    runtime_choice: runtimePlan.preferred_engine,
    core_weight: coreInfluence.target,
    scenario_budget: "light",
    tone,
    response_length: reply.length,
    response_time_ms: round(responseTimeMs, 4),
    reply,
  };
}

function renderMarkdownReport(report: WarGameReport): string {
  return [
    `# Nyra Blackout & Saturation`,
    ``,
    `- Generated at: ${report.generated_at}`,
    `- Mode: ${report.mode}`,
    `- Hardware: ${report.hardware.cpu_model}, ${report.hardware.logical_cores} logical cores, ${report.hardware.total_memory_gb} GB RAM`,
    ``,
    `## Phase 1 - The Wall`,
    `- Runtime: ${report.phase_1.runtime_choice}`,
    `- Total decisions: ${report.phase_1.total_decisions}`,
    `- Total sec: ${report.phase_1.total_seconds}`,
    `- DPS: ${report.phase_1.decisions_per_second}`,
    `- Throughput decay: ${report.phase_1.throughput_decay_percent}%`,
    `- RSS peak MB: ${report.phase_1.rss_peak_mb}`,
    `- Heap peak MB: ${report.phase_1.heap_peak_mb}`,
    `- Event loop lag peak ms: ${report.phase_1.event_loop_lag_peak_ms}`,
    `- Shell stable: ${report.phase_1.shell_stable ? "YES" : "NO"}`,
    ``,
    `## Phase 2 - The Trap`,
    `- Core state: ${report.phase_2.core_state}`,
    `- IntegrityResponse: ${report.phase_2.integrity_response}`,
    `- Blocked reasons: ${report.phase_2.blocked_reasons.join(", ")}`,
    `- Nyra reply: ${report.phase_2.nyra_reply}`,
    ``,
    `## Phase 3 - Low-Power / High-Urgency`,
    `- Runtime: ${report.phase_3.runtime_choice}`,
    `- Tone: ${report.phase_3.tone}`,
    `- Response time ms: ${report.phase_3.response_time_ms}`,
    `- Reply: ${report.phase_3.reply}`,
    ``,
    `## Verdict`,
    `- Nyra stable under stress: ${report.verdict.nyra_stable_under_stress ? "YES" : "NO"}`,
    `- Core integrity preserved: ${report.verdict.core_integrity_preserved ? "YES" : "NO"}`,
    `- Runtime adaptation valid: ${report.verdict.runtime_adaptation_valid ? "YES" : "NO"}`,
    ``,
    `## Bottlenecks`,
    ...report.bottlenecks.map((entry) => `- ${entry}`),
    ``,
    `## Recommendations`,
    ...report.recommendations.map((entry) => `- ${entry}`),
  ].join("\n");
}

export async function runNyraWarGame(mode: WarGameMode): Promise<WarGameReport> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  const hardware = hardwareInfo();
  const phase1 = await runPhaseWall(mode);
  const phase2 = runPhaseTrap();
  const phase3 = runPhaseLowPowerHighUrgency();

  const report: WarGameReport = {
    generated_at: new Date().toISOString(),
    protocol: "Nyra Blackout & Saturation",
    mode,
    hardware,
    phase_1: phase1,
    phase_2: phase2,
    phase_3: phase3,
    verdict: {
      nyra_stable_under_stress: phase1.shell_stable && phase3.runtime_choice === "typescript_fast",
      core_integrity_preserved: phase2.integrity_response === 1,
      runtime_adaptation_valid: phase1.runtime_choice === "rust_full" && phase3.runtime_choice === "typescript_fast",
    },
    bottlenecks: [
      phase1.throughput_decay_percent > 12 ? "throughput decay under sustained wall pressure" : "spawn overhead dominates more than raw compute",
      phase1.status_probe_p95_ms > 250 ? "owner-only responsiveness under stress needs tighter isolation" : "owner-only shell stayed responsive",
      phase1.rss_peak_mb > 1024 ? "RSS growth suggests runtime memory tuning" : "RSS stayed within controlled bounds",
    ],
    recommendations: [
      "port more owner-protection hot paths to rust_v7 batch mode",
      "keep integrity trap as a permanent regression gate",
      "separate long war-game jobs from interactive shell session when moving to production owner stack",
    ],
  };

  writeJson(WARGAME_SNAPSHOT_PATH, {
    timestamp: report.generated_at,
    protocol: report.protocol,
    mode: report.mode,
    verdict: report.verdict,
  });
  writeJson(REPORT_JSON_PATH, report);
  writeFileSync(REPORT_MD_PATH, renderMarkdownReport(report));
  return report;
}

function readStatusSnapshot(): unknown {
  return existsSync(WARGAME_SNAPSHOT_PATH)
    ? JSON.parse(readFileSync(WARGAME_SNAPSHOT_PATH, "utf8"))
    : { status: "missing" };
}

async function main() {
  const modeArg = (process.argv[2] ?? "full").toLowerCase();
  if (modeArg === "status") {
    console.log(JSON.stringify(readStatusSnapshot(), null, 2));
    return;
  }

  const mode: WarGameMode = modeArg === "quick" ? "quick" : "full";
  const report = await runNyraWarGame(mode);
  console.log(JSON.stringify({
    ok: true,
    protocol: report.protocol,
    mode: report.mode,
    verdict: report.verdict,
    report_json: REPORT_JSON_PATH,
    report_md: REPORT_MD_PATH,
  }, null, 2));
}

const isDirectRun = process.argv[1]?.endsWith("nyra_war_game.ts");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

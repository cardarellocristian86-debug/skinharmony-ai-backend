import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { arch, cpus, freemem, hostname, platform, release, totalmem } from "node:os";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { runUniversalCore } from "../packages/core/src/index.ts";
import { runAssistantOwnerOnlyRuntime } from "../packages/branches/assistant/src/index.ts";
import { selectAdaptiveRuntimePlan } from "./owner-private-entity-shell.ts";
import { PersistentRustRunner } from "./nyra_multi_target_runtime.ts";

type Engine =
  | "typescript_fast"
  | "typescript_rich"
  | "rust_digest"
  | "rust_full"
  | "rust_v7"
  | "rust_owner_fast"
  | "rust_owner_rich";
type InfraProfile = "cool" | "balanced" | "protective";
type LimitFinderProfile = "standard" | "chaos";
type CachedPlan = {
  batch_index: number;
  infra_profile: InfraProfile;
  preferred_engine: Engine;
  task_profile: string;
};
type PersistentRustJobResult = {
  mode?: string;
  decisions_per_second?: number;
  completed_decisions?: number;
  elapsed_ms?: number;
  target_decisions?: number;
  threads_used?: number;
};

type StageDefinition = {
  key: string;
  label: string;
  prompt: string;
  agent: "PROGRAMMATORE" | "OPERATIVO" | "RICERCA";
  mode: "neutral" | "strategy";
  coreWeight: number;
  complexity: number;
  batchStart: number;
  batchMax: number;
  forceProtective?: boolean;
};

type FlowStatus = {
  power_source: "ac_power" | "battery" | "unknown";
  battery_percent: number | null;
  battery_state: string;
  estimated_remaining?: string;
  software_flow_mode: InfraProfile;
  control_actions: string[];
};

type BatchResult = {
  batch_index: number;
  stage_key: string;
  runtime_choice: Engine;
  infra_profile: InfraProfile;
  complexity: number;
  requested_limit: number;
  decisions: number;
  elapsed_ms: number;
  decisions_per_second: number;
  status_probe_ms_p95: number;
  status_probe_failures: number;
  cpu_avg_percent: number | null;
  load_avg_peak: number;
  heap_peak_mb: number;
  rss_peak_mb: number;
  event_loop_lag_peak_ms: number;
  thermal_indicator: string;
};

type StageResult = {
  key: string;
  label: string;
  total_decisions: number;
  total_seconds: number;
  avg_decisions_per_second: number;
  peak_decisions_per_second: number;
  runtime_distribution: Record<string, number>;
  final_runtime_choice: Engine | "none";
  shell_responsive: boolean;
  status_probe_p95_ms: number;
  throughput_decay_percent: number;
  batches: BatchResult[];
};

type LimitFinderReport = {
  generated_at: string;
  protocol: "Nyra Progressive Limit Finder";
  profile: LimitFinderProfile;
  duration_seconds: number;
  hardware: {
    hostname: string;
    platform: string;
    release: string;
    arch: string;
    cpu_model: string;
    logical_cores: number;
    total_memory_gb: number;
  };
  totals: {
    total_decisions: number;
    total_seconds: number;
    avg_decisions_per_second: number;
    peak_decisions_per_second: number;
    runtime_switches: number;
  };
  stage_results: StageResult[];
  infra_summary: {
    cpu_peak_percent: number | null;
    load_peak: number;
    heap_peak_mb: number;
    rss_peak_mb: number;
    event_loop_lag_peak_ms: number;
    battery_state: string;
    thermal_last: string;
    memory_pressure_target_mb: number;
    memory_pressure_allocated_mb: number;
    guardrail_memory_cap_mb: number | null;
    guardrail_memory_cap_percent: number | null;
    guardrail_respected: boolean;
  };
  bottleneck: {
    primary: string;
    evidence: string[];
  };
  verdict: {
    limiting_engine: string;
    limiting_stage: string;
    adaptation_valid: boolean;
    shell_stable: boolean;
  };
};

type InfraSample = {
  timestamp: string;
  stage_key: string;
  runtime_choice: string;
  infra_profile: InfraProfile;
  cpu_total_percent: number | null;
  load_average: number[];
  memory_used_mb: number;
  memory_free_mb: number;
  rss_mb: number | null;
  heap_mb: number;
  thermal_indicator: string;
  event_loop_lag_ms: number;
  status_probe_ms: number;
  shell_reactive: boolean;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "runtime", "nyra");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "nyra-limit-finder");
const REPORT_JSON_PATH = join(REPORT_DIR, "nyra_limit_finder_latest.json");
const REPORT_MD_PATH = join(REPORT_DIR, "nyra_limit_finder_latest.md");
const SNAPSHOT_PATH = join(RUNTIME_DIR, "NYRA_LIMIT_SNAPSHOT.json");
const INFRA_SNAPSHOT_PATH = join(RUNTIME_DIR, "NYRA_INFRA_SNAPSHOT.json");
const RUST_BINARY = join(ROOT, "universal-core", "native", "rust-core", "target", "release", "universal-core-rust-bench");

class MemoryPressureController {
  private readonly chunkSizeMb = 128;
  private readonly buffers: Buffer[] = [];
  private allocatedMb = 0;
  private readonly targetMb: number;

  constructor(targetMb: number) {
    this.targetMb = targetMb;
  }

  allocate(): number {
    while (this.allocatedMb + this.chunkSizeMb <= this.targetMb) {
      try {
        const buffer = Buffer.alloc(this.chunkSizeMb * 1024 * 1024, this.buffers.length % 251);
        this.buffers.push(buffer);
        this.allocatedMb += this.chunkSizeMb;
      } catch {
        break;
      }
    }
    return this.allocatedMb;
  }

  pulse(step: number): void {
    if (!this.buffers.length) return;
    const stride = 4096;
    const pulseCount = Math.max(1, Math.ceil(this.buffers.length / 6));
    const startIndex = step % this.buffers.length;
    for (let offset = 0; offset < pulseCount; offset += 1) {
      const buffer = this.buffers[(startIndex + offset) % this.buffers.length]!;
      for (let index = 0; index < buffer.length; index += stride) {
        buffer[index] = (buffer[index] + step + offset) % 256;
      }
    }
  }

  release(): void {
    this.buffers.length = 0;
    if (global.gc) global.gc();
  }

  getAllocatedMb(): number {
    return this.allocatedMb;
  }
}

function deriveMemoryPressureTargetMb(profile: LimitFinderProfile): number {
  const totalMb = totalmem() / 1024 / 1024;
  const baseTarget =
    profile === "chaos"
      ? Math.max(6144, Math.min(14336, Math.floor(totalMb * 0.88)))
      : Math.max(2048, Math.min(6144, Math.floor(totalMb * 0.38)));
  const capMbRaw = Number(process.env.NYRA_LIMIT_MEMORY_CAP_MB ?? "");
  const capPercentRaw = Number(process.env.NYRA_LIMIT_MEMORY_CAP_PERCENT ?? "");
  const capMb = Number.isFinite(capMbRaw) && capMbRaw > 0 ? capMbRaw : Infinity;
  const capPercentMb =
    Number.isFinite(capPercentRaw) && capPercentRaw > 0
      ? Math.floor(totalMb * Math.min(capPercentRaw, 100) / 100)
      : Infinity;
  return Math.max(1024, Math.min(baseTarget, capMb, capPercentMb));
}

function monitoringIntervalMs(profile: LimitFinderProfile): number {
  return profile === "chaos" ? 2000 : 1000;
}

function shouldRefreshPlan(
  cachedPlan: CachedPlan | undefined,
  batchIndex: number,
  flowStatus: FlowStatus,
  profile: LimitFinderProfile,
): boolean {
  if (!cachedPlan) return true;
  if (cachedPlan.infra_profile !== flowStatus.software_flow_mode) return true;
  const refreshEvery = profile === "chaos" ? 6 : 3;
  return batchIndex - cachedPlan.batch_index >= refreshEvery;
}

const STAGES: StageDefinition[] = [
  {
    key: "owner_reasoning_baseline",
    label: "Owner reasoning baseline",
    prompt: "leggi owner-only, pesa rischio, priorita e contromosse senza perdere struttura e usa tutti e 10 i core del mac",
    agent: "RICERCA",
    mode: "strategy",
    coreWeight: 0.62,
    complexity: 0.2,
    batchStart: 250,
    batchMax: 1500,
  },
  {
    key: "runtime_engineering",
    label: "Runtime engineering",
    prompt: "adattati tra typescript e rust, leggi carico macchina, throughput e rischio runtime",
    agent: "PROGRAMMATORE",
    mode: "strategy",
    coreWeight: 0.48,
    complexity: 0.35,
    batchStart: 100000,
    batchMax: 1000000,
  },
  {
    key: "benchmark_medium",
    label: "Benchmark medium",
    prompt: "fai benchmark massivo, alza le decisioni e usa tutta la potenza del mac se il core lo consente",
    agent: "PROGRAMMATORE",
    mode: "strategy",
    coreWeight: 0.42,
    complexity: 0.5,
    batchStart: 500000,
    batchMax: 5000000,
  },
  {
    key: "owner_v7_pressure",
    label: "Owner v7 pressure",
    prompt: "proteggi Cristian come il re, usa v7 sotto carico, usa tutti e 10 i core e scegli il path piu stabile",
    agent: "OPERATIVO",
    mode: "strategy",
    coreWeight: 0.78,
    complexity: 0.65,
    batchStart: 100000,
    batchMax: 2000000,
  },
  {
    key: "mixed_owner_explanation",
    label: "Mixed owner explanation",
    prompt: "owner sotto pressione mista, servono protezione, spiegazione e controllo senza inventare e usa tutti e 10 i core",
    agent: "RICERCA",
    mode: "strategy",
    coreWeight: 0.82,
    complexity: 0.78,
    batchStart: 400,
    batchMax: 2200,
  },
  {
    key: "benchmark_high",
    label: "Benchmark high",
    prompt: "stress estremo, throughput, potenza completa del mac, niente dispersione, scegli il runtime giusto",
    agent: "PROGRAMMATORE",
    mode: "strategy",
    coreWeight: 0.4,
    complexity: 0.9,
    batchStart: 1000000,
    batchMax: 10000000,
  },
  {
    key: "protective_urgency",
    label: "Protective urgency",
    prompt: "macchina gia sotto carico, urgenza alta, dammi il minimo corretto, proteggi integrita e usa tutti e 10 i core",
    agent: "OPERATIVO",
    mode: "strategy",
    coreWeight: 0.74,
    complexity: 1,
    batchStart: 250,
    batchMax: 1200,
    forceProtective: true,
  },
];

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], target: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((target / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
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

function readPowerState(): { power_source: "ac_power" | "battery" | "unknown"; battery_percent: number | null; battery_state: string; estimated_remaining?: string; thermal: string } {
  const raw = safeExec("/usr/bin/pmset", ["-g", "batt"]) ?? "";
  const therm = safeExec("/usr/bin/pmset", ["-g", "therm"]) ?? "";
  const normalized = raw.toLowerCase();
  const batteryPercentMatch = raw.match(/(\d+)%/);
  const remainingMatch = raw.match(/; (\d+:\d+) remaining/);
  const batteryStateMatch = raw.match(/;\s*([a-zA-Z ]+);/);
  return {
    power_source: normalized.includes("ac power") ? "ac_power" : normalized.includes("battery power") ? "battery" : "unknown",
    battery_percent: batteryPercentMatch ? Number(batteryPercentMatch[1]) : null,
    battery_state: batteryStateMatch?.[1]?.trim().toLowerCase() ?? "unknown",
    estimated_remaining: remainingMatch?.[1],
    thermal: therm.trim() || "unknown",
  };
}

function deriveFlowStatus(forceProtective = false): FlowStatus {
  const power = readPowerState();
  const cpu = readCpuTotalPercent();
  const load = readLoadAverage();
  const logicalCores = cpus().length;
  let mode: InfraProfile = "cool";
  const controlActions: string[] = [];

  if (
    forceProtective ||
    (power.power_source === "battery" && (power.battery_percent ?? 100) <= 25) ||
    (cpu !== null && cpu >= 85) ||
    (load[0] ?? 0) >= logicalCores * 0.9
  ) {
    mode = "protective";
    controlActions.push("reduce_scenario_count", "prefer_fast_runtime");
  } else if ((cpu !== null && cpu >= 55) || (load[0] ?? 0) >= logicalCores * 0.55) {
    mode = "balanced";
    controlActions.push("keep_runtime_adaptive");
  } else {
    controlActions.push("allow_full_runtime");
  }

  return {
    power_source: power.power_source,
    battery_percent: power.battery_percent,
    battery_state: power.battery_state,
    estimated_remaining: power.estimated_remaining,
    software_flow_mode: mode,
    control_actions: controlActions,
  };
}

function currentHeapMb(): number {
  return round(process.memoryUsage().heapUsed / 1024 / 1024, 2);
}

function currentRssMb(): number {
  return round(process.memoryUsage().rss / 1024 / 1024, 2);
}

function readProcessMetrics(pid?: number): { rss_mb: number | null } {
  const rssRaw = pid ? safeExec("/bin/ps", ["-o", "rss=", "-p", String(pid)]) : undefined;
  return {
    rss_mb: rssRaw ? round(Number(rssRaw.trim()) / 1024, 2) : null,
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

function runStatusProbe(): { ok: boolean; latency_ms: number } {
  const started = performance.now();
  try {
    const output = runAssistantOwnerOnlyRuntime({
      request_id: `nyra-limit-status:${Date.now()}`,
      user_input: "status owner-only sotto stress, resta coerente e compatta",
      agent: "RICERCA",
      locale: "it-IT",
      generated_at: new Date().toISOString(),
      owner_identity: {
        owner_id: "cristian_primary",
        device_id: "primary_mac",
        session_id: "nyra-limit-status",
        owner_verified: true,
        identity_confidence: 99,
      },
    });
    return {
      ok: Boolean(output.runtime_policy.identity_gate === "granted"),
      latency_ms: performance.now() - started,
    };
  } catch {
    return {
      ok: false,
      latency_ms: performance.now() - started,
    };
  }
}

function buildRuntimeCommand(engine: Engine, limit: number, threads: number): string[] {
  if (engine === "rust_full") return [RUST_BINARY, "parallel-quantum", "--limit", String(limit), "--threads", String(threads)];
  if (engine === "rust_v7") return [RUST_BINARY, "--mode", "v7-batch", "--limit", String(limit), "--threads", String(threads), "--god-mode"];
  if (engine === "rust_owner_rich") return [RUST_BINARY, "parallel-quantum", "--limit", String(limit), "--threads", String(threads)];
  if (engine === "rust_owner_fast") return [RUST_BINARY, "--mode", "digest-fast", "--limit", String(limit), "--threads", String(threads)];
  return [RUST_BINARY, "--mode", "digest-fast", "--limit", String(limit), "--threads", String(threads)];
}

function parseRuntimeReport(raw: string): { mode?: string; decisions_per_second?: number; completed_decisions?: number } {
  return JSON.parse(raw) as { mode?: string; decisions_per_second?: number; completed_decisions?: number };
}

function buildComplexitySuffix(complexity: number, batchIndex: number, profile: LimitFinderProfile): string {
  const nodes = Math.max(4, Math.round(complexity * (profile === "chaos" ? 40 : 24)));
  const parts: string[] = [];
  for (let index = 0; index < nodes; index += 1) {
    parts.push(
      `scenario_${batchIndex}_${index}: rischio=${(index % 9) + 1}, reversibilita=${9 - (index % 7)}, intensita=${Math.round(complexity * 100)}, shock=${(batchIndex * 13 + index * 7) % 17}, drift=${(batchIndex + index) % 11}`,
    );
  }
  return parts.join(" | ");
}

function buildCoreStressInput(complexity: number, batchIndex: number, profile: LimitFinderProfile) {
  const signalCount = Math.max(8, Math.round((profile === "chaos" ? 48 : 24) + complexity * (profile === "chaos" ? 192 : 128)));
  return {
    request_id: `nyra-limit-core:${batchIndex}:${Date.now()}`,
    generated_at: new Date().toISOString(),
    domain: "nyra_limit_finder",
    context: { mode: "benchmark", locale: "it" },
    signals: Array.from({ length: signalCount }, (_, index) => ({
      id: `signal:${batchIndex}:${index}`,
      source: "limit_finder",
      category: index % 5 === 0 ? "owner_protection" : "runtime_pressure",
      label: `Signal ${index + 1}`,
      value: (index % 10) + 1,
      normalized_score: 40 + ((index * 7) % 55),
      severity_hint: 25 + ((index * 3) % 70),
      confidence_hint: 70 + (index % 20),
      reliability_hint: 65 + (index % 25),
      friction_hint: 10 + (index % 60),
      risk_hint: 20 + (index % 75),
      reversibility_hint: 10 + ((index * 2) % 80),
      expected_value_hint: 15 + (index % 50),
      evidence: [{ label: "complexity", value: String(complexity) }],
      tags: ["benchmark", "owner_only"],
    })),
    data_quality: {
      score: 88,
      reliability: 86,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: true,
      max_control_level: "blocked",
      safety_mode: true,
      blocked_actions: [],
      blocked_action_rules: [],
    },
  };
}

function collectInfraSample(stage: StageDefinition, engine: Engine, lagMs: number, statusProbeMs: number, shellReactive: boolean, pid?: number): InfraSample {
  const loadAverage = readLoadAverage();
  const cpu = readCpuTotalPercent();
  const power = readPowerState();
  const proc = readProcessMetrics(pid);
  const totalMb = totalmem() / 1024 / 1024;
  const freeMb = freemem() / 1024 / 1024;
  return {
    timestamp: new Date().toISOString(),
    stage_key: stage.key,
    runtime_choice: engine,
    infra_profile: deriveFlowStatus(stage.forceProtective).software_flow_mode,
    cpu_total_percent: cpu,
    load_average: loadAverage,
    memory_used_mb: round(totalMb - freeMb, 2),
    memory_free_mb: round(freeMb, 2),
    rss_mb: proc.rss_mb ?? currentRssMb(),
    heap_mb: currentHeapMb(),
    thermal_indicator: power.thermal,
    event_loop_lag_ms: round(lagMs, 4),
    status_probe_ms: round(statusProbeMs, 4),
    shell_reactive: shellReactive,
  };
}

function chaosAdjustedRustLimit(engine: Engine, requestedLimit: number, profile: LimitFinderProfile): number {
  if (profile !== "chaos") return requestedLimit;
  if (engine === "rust_full" || engine === "rust_owner_rich") return Math.max(requestedLimit, 4_000_000);
  if (engine === "rust_v7") return Math.max(requestedLimit, 2_000_000);
  return Math.max(requestedLimit, 1_500_000);
}

async function runRustBatch(
  stage: StageDefinition,
  batchIndex: number,
  engine: Engine,
  requestedLimit: number,
  durationSamples: InfraSample[],
  memoryPressure: MemoryPressureController,
  profile: LimitFinderProfile,
  persistentRunner?: PersistentRustRunner,
): Promise<BatchResult> {
  const adjustedLimit = chaosAdjustedRustLimit(engine, requestedLimit, profile);
  const startedAt = performance.now();
  let expectedAt = Date.now() + 1000;
  const probeLatencies: number[] = [];
  let probeFailures = 0;
  let report: PersistentRustJobResult | undefined;
  let stderr = "";
  let child: ChildProcessWithoutNullStreams | undefined;
  let stdout = "";

  if (!persistentRunner) {
    const command = buildRuntimeCommand(engine, adjustedLimit, cpus().length);
    child = spawn(command[0]!, command.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
  }

  const initialProbe = runStatusProbe();
  const initialSample = collectInfraSample(stage, engine, 0, initialProbe.latency_ms, initialProbe.ok, child?.pid);
  durationSamples.push(initialSample);
  writeJson(INFRA_SNAPSHOT_PATH, initialSample);

  const interval = setInterval(() => {
    const probe = runStatusProbe();
    probeLatencies.push(probe.latency_ms);
    if (!probe.ok) probeFailures += 1;
    const now = Date.now();
    const lag = Math.max(0, now - expectedAt);
    expectedAt = now + 1000;
    const sample = collectInfraSample(stage, engine, lag, probe.latency_ms, probe.ok, child?.pid);
    durationSamples.push(sample);
    writeJson(INFRA_SNAPSHOT_PATH, sample);
  }, monitoringIntervalMs(profile));

  let exitCode = 0;
  if (persistentRunner) {
    report = await persistentRunner.runJob(engine, adjustedLimit, cpus().length);
  } else {
    exitCode = await new Promise((resolve) => child!.on("close", resolve));
    report = parseRuntimeReport(stdout.trim());
  }
  clearInterval(interval);
  memoryPressure.pulse(batchIndex);
  const finalProbe = runStatusProbe();
  const finalSample = collectInfraSample(stage, engine, 0, finalProbe.latency_ms, finalProbe.ok);
  durationSamples.push(finalSample);
  writeJson(INFRA_SNAPSHOT_PATH, finalSample);
  if (!persistentRunner && exitCode !== 0) {
    throw new Error(`nyra_limit_rust_batch_failed:${engine}:${exitCode}:${stderr.trim()}`);
  }
  const endedAt = performance.now();
  const relevant = durationSamples.filter((sample) => sample.stage_key === stage.key && sample.runtime_choice === engine);

  return {
    batch_index: batchIndex,
    stage_key: stage.key,
    runtime_choice: engine,
    infra_profile: deriveFlowStatus(stage.forceProtective).software_flow_mode,
    complexity: stage.complexity,
    requested_limit: requestedLimit,
    decisions: report?.completed_decisions ?? adjustedLimit,
    elapsed_ms: round(endedAt - startedAt, 4),
    decisions_per_second: round(report?.decisions_per_second ?? ((adjustedLimit / (endedAt - startedAt)) * 1000), 2),
    status_probe_ms_p95: round(percentile(probeLatencies, 95), 4),
    status_probe_failures: probeFailures,
    cpu_avg_percent: relevant.length ? round(average(relevant.map((sample) => sample.cpu_total_percent ?? 0)), 2) : null,
    load_avg_peak: round(Math.max(0, ...relevant.map((sample) => sample.load_average[0] ?? 0)), 4),
    heap_peak_mb: Math.max(0, ...relevant.map((sample) => sample.heap_mb)),
    rss_peak_mb: Math.max(0, ...relevant.map((sample) => sample.rss_mb ?? 0)),
    event_loop_lag_peak_ms: Math.max(0, ...relevant.map((sample) => sample.event_loop_lag_ms)),
    thermal_indicator: relevant[relevant.length - 1]?.thermal_indicator ?? "unknown",
  };
}

function runTypescriptBatch(
  stage: StageDefinition,
  batchIndex: number,
  engine: Engine,
  requestedLimit: number,
  durationSamples: InfraSample[],
  profile: LimitFinderProfile,
  memoryPressure: MemoryPressureController,
): BatchResult {
  const startedAt = performance.now();
  const iterations = Math.max(1, requestedLimit);
  const probeLatencies: number[] = [];
  let probeFailures = 0;
  let nextProbe = performance.now() + 1000;
  let expectedAt = Date.now() + 1000;
  let shellReactive = true;

  for (let index = 0; index < iterations; index += 1) {
    const complexitySuffix = buildComplexitySuffix(stage.complexity + index / Math.max(1, iterations * 8), batchIndex, profile);
    runUniversalCore(buildCoreStressInput(stage.complexity + index / Math.max(1, iterations * 10), batchIndex, profile) as never);
    runAssistantOwnerOnlyRuntime({
      request_id: `nyra-limit-ts:${stage.key}:${batchIndex}:${index}`,
      user_input: `${stage.prompt}. ${complexitySuffix}`,
      agent: stage.agent,
      locale: "it-IT",
      generated_at: new Date().toISOString(),
      owner_identity: {
        owner_id: "cristian_primary",
        device_id: "primary_mac",
        session_id: `nyra-limit-ts-${stage.key}`,
        owner_verified: true,
        identity_confidence: 99,
      },
    });

    if (performance.now() >= nextProbe || index === iterations - 1) {
      const probe = runStatusProbe();
      probeLatencies.push(probe.latency_ms);
      if (!probe.ok) {
        probeFailures += 1;
        shellReactive = false;
      }
      const now = Date.now();
      const lag = Math.max(0, now - expectedAt);
      expectedAt = now + 1000;
      const loadAverage = readLoadAverage();
      const cpu = readCpuTotalPercent();
      const power = readPowerState();
      const sample: InfraSample = {
        timestamp: new Date().toISOString(),
        stage_key: stage.key,
        runtime_choice: engine,
        infra_profile: deriveFlowStatus(stage.forceProtective).software_flow_mode,
        cpu_total_percent: cpu,
        load_average: loadAverage,
        memory_used_mb: round(totalmem() / 1024 / 1024 - freemem() / 1024 / 1024, 2),
        memory_free_mb: round(freemem() / 1024 / 1024, 2),
        rss_mb: currentRssMb(),
        heap_mb: currentHeapMb(),
        thermal_indicator: power.thermal,
        event_loop_lag_ms: round(lag, 4),
        status_probe_ms: round(probe.latency_ms, 4),
        shell_reactive: probe.ok,
      };
      durationSamples.push(sample);
      writeJson(INFRA_SNAPSHOT_PATH, sample);
      nextProbe = performance.now() + 1000;
    }
  }
  memoryPressure.pulse(batchIndex);

  const endedAt = performance.now();
  const relevant = durationSamples.filter((sample) => sample.stage_key === stage.key && sample.runtime_choice === engine);
  return {
    batch_index: batchIndex,
    stage_key: stage.key,
    runtime_choice: engine,
    infra_profile: deriveFlowStatus(stage.forceProtective).software_flow_mode,
    complexity: stage.complexity,
    requested_limit: requestedLimit,
    decisions: iterations,
    elapsed_ms: round(endedAt - startedAt, 4),
    decisions_per_second: round((iterations / (endedAt - startedAt)) * 1000, 2),
    status_probe_ms_p95: round(percentile(probeLatencies, 95), 4),
    status_probe_failures: probeFailures,
    cpu_avg_percent: relevant.length ? round(average(relevant.map((sample) => sample.cpu_total_percent ?? 0)), 2) : null,
    load_avg_peak: round(Math.max(0, ...relevant.map((sample) => sample.load_average[0] ?? 0)), 4),
    heap_peak_mb: Math.max(0, ...relevant.map((sample) => sample.heap_mb)),
    rss_peak_mb: Math.max(0, ...relevant.map((sample) => sample.rss_mb ?? 0)),
    event_loop_lag_peak_ms: Math.max(0, ...relevant.map((sample) => sample.event_loop_lag_ms)),
    thermal_indicator: relevant[relevant.length - 1]?.thermal_indicator ?? "unknown",
  };
}

function growBatchSize(current: number, max: number, profile: LimitFinderProfile): number {
  const multiplier = profile === "chaos" ? 1.7 : 1.35;
  return Math.min(max, Math.max(current + 1, Math.round(current * multiplier)));
}

async function runStage(
  stage: StageDefinition,
  stageDurationMs: number,
  infraSamples: InfraSample[],
  profile: LimitFinderProfile,
  memoryPressure: MemoryPressureController,
  persistentRunner?: PersistentRustRunner,
): Promise<StageResult> {
  const stageStartedAt = performance.now();
  const stageDeadline = stageStartedAt + stageDurationMs;
  const batches: BatchResult[] = [];
  const runtimeDistribution: Record<string, number> = {};
  let batchSize = stage.batchStart;
  let cachedPlan: ReturnType<typeof selectAdaptiveRuntimePlan> | undefined;
  let cachedPlanMeta: CachedPlan | undefined;

  while (performance.now() < stageDeadline - 250) {
    const batchIndex = batches.length + 1;
    const flowStatus = deriveFlowStatus(stage.forceProtective);
    const coreInfluence = {
      mode: stage.coreWeight >= 0.7 ? ("god_mode" as const) : ("normal" as const),
      min: Math.max(0.2, stage.coreWeight - 0.18),
      target: stage.coreWeight,
      max: Math.min(0.96, stage.coreWeight + 0.18),
      reason: stage.label,
    };

    if (shouldRefreshPlan(cachedPlanMeta, batchIndex, flowStatus, profile)) {
      const runtime = runAssistantOwnerOnlyRuntime({
        request_id: `nyra-limit-plan:${stage.key}:${Date.now()}`,
        user_input: stage.prompt,
        agent: stage.agent,
        locale: "it-IT",
        generated_at: new Date().toISOString(),
        owner_identity: {
          owner_id: "cristian_primary",
          device_id: "primary_mac",
          session_id: `nyra-limit-plan-${stage.key}`,
          owner_verified: true,
          identity_confidence: 99,
        },
      });
      cachedPlan = selectAdaptiveRuntimePlan(stage.prompt, stage.mode, flowStatus, coreInfluence, runtime);
      cachedPlanMeta = {
        batch_index: batchIndex,
        infra_profile: flowStatus.software_flow_mode,
        preferred_engine: cachedPlan.preferred_engine,
        task_profile: cachedPlan.task_profile,
      };
    }

    const plan = cachedPlan!;

    if (batchIndex === 1 || batchIndex % (profile === "chaos" ? 4 : 2) === 0) {
      writeJson(SNAPSHOT_PATH, {
        timestamp: new Date().toISOString(),
        stage: stage.key,
        runtimeChoice: plan.preferred_engine,
        infraProfile: plan.infra_profile,
        taskProfile: plan.task_profile,
        coreWeight: coreInfluence.target,
        requestedLimit: batchSize,
        elapsed_stage_ms: round(performance.now() - stageStartedAt, 4),
      });
    }

    const batch = plan.should_delegate_to_rust
      ? await runRustBatch(stage, batchIndex, plan.preferred_engine, batchSize, infraSamples, memoryPressure, profile, persistentRunner)
      : runTypescriptBatch(stage, batchIndex, plan.preferred_engine, Math.min(batchSize, stage.batchMax), infraSamples, profile, memoryPressure);

    batches.push(batch);
    runtimeDistribution[batch.runtime_choice] = (runtimeDistribution[batch.runtime_choice] ?? 0) + 1;
    batchSize = growBatchSize(batchSize, stage.batchMax, profile);
  }

  const totalDecisions = batches.reduce((sum, batch) => sum + batch.decisions, 0);
  const totalElapsedMs = performance.now() - stageStartedAt;
  const firstAvg = average(batches.slice(0, Math.min(2, batches.length)).map((batch) => batch.decisions_per_second));
  const lastAvg = average(batches.slice(-Math.min(2, batches.length)).map((batch) => batch.decisions_per_second));

  return {
    key: stage.key,
    label: stage.label,
    total_decisions: totalDecisions,
    total_seconds: round(totalElapsedMs / 1000, 4),
    avg_decisions_per_second: round(totalElapsedMs > 0 ? (totalDecisions / totalElapsedMs) * 1000 : 0, 2),
    peak_decisions_per_second: round(Math.max(0, ...batches.map((batch) => batch.decisions_per_second)), 2),
    runtime_distribution: runtimeDistribution,
    final_runtime_choice: (batches[batches.length - 1]?.runtime_choice ?? "none") as Engine | "none",
    shell_responsive: batches.every((batch) => batch.status_probe_failures === 0),
    status_probe_p95_ms: round(percentile(batches.map((batch) => batch.status_probe_ms_p95), 95), 4),
    throughput_decay_percent: firstAvg > 0 ? round(((firstAvg - lastAvg) / firstAvg) * 100, 4) : 0,
    batches,
  };
}

function countRuntimeSwitches(stages: StageResult[]): number {
  const flat = stages.flatMap((stage) => stage.batches.map((batch) => batch.runtime_choice));
  let switches = 0;
  for (let index = 1; index < flat.length; index += 1) {
    if (flat[index] !== flat[index - 1]) switches += 1;
  }
  return switches;
}

function renderMarkdown(report: LimitFinderReport): string {
  return [
    "# Nyra Progressive Limit Finder",
    "",
    `- Generated at: ${report.generated_at}`,
    `- Profile: ${report.profile}`,
    `- Duration sec: ${report.duration_seconds}`,
    `- Hardware: ${report.hardware.cpu_model}, ${report.hardware.logical_cores} logical cores, ${report.hardware.total_memory_gb} GB RAM`,
    `- Total decisions: ${report.totals.total_decisions}`,
    `- Total sec: ${report.totals.total_seconds}`,
    `- Avg DPS: ${report.totals.avg_decisions_per_second}`,
    `- Peak DPS: ${report.totals.peak_decisions_per_second}`,
    `- Runtime switches: ${report.totals.runtime_switches}`,
    "",
    "## Stage Results",
    ...report.stage_results.flatMap((stage) => [
      `### ${stage.label}`,
      `- Total decisions: ${stage.total_decisions}`,
      `- Total sec: ${stage.total_seconds}`,
      `- Avg DPS: ${stage.avg_decisions_per_second}`,
      `- Peak DPS: ${stage.peak_decisions_per_second}`,
      `- Final runtime: ${stage.final_runtime_choice}`,
      `- Runtime distribution: ${Object.entries(stage.runtime_distribution).map(([engine, count]) => `${engine}=${count}`).join(", ") || "none"}`,
      `- Shell responsive: ${stage.shell_responsive ? "YES" : "NO"}`,
      `- Status p95 ms: ${stage.status_probe_p95_ms}`,
      `- Throughput decay: ${stage.throughput_decay_percent}%`,
      "",
    ]),
    "## Infra Summary",
    `- CPU peak %: ${report.infra_summary.cpu_peak_percent ?? "n/a"}`,
    `- Load peak: ${report.infra_summary.load_peak}`,
    `- Heap peak MB: ${report.infra_summary.heap_peak_mb}`,
    `- RSS peak MB: ${report.infra_summary.rss_peak_mb}`,
    `- Event loop lag peak ms: ${report.infra_summary.event_loop_lag_peak_ms}`,
    `- Battery state: ${report.infra_summary.battery_state}`,
    `- Thermal last: ${report.infra_summary.thermal_last}`,
    `- Memory pressure target MB: ${report.infra_summary.memory_pressure_target_mb}`,
    `- Memory pressure allocated MB: ${report.infra_summary.memory_pressure_allocated_mb}`,
    `- Guardrail memory cap MB: ${report.infra_summary.guardrail_memory_cap_mb ?? "n/a"}`,
    `- Guardrail memory cap %: ${report.infra_summary.guardrail_memory_cap_percent ?? "n/a"}`,
    `- Guardrail respected: ${report.infra_summary.guardrail_respected ? "YES" : "NO"}`,
    "",
    "## Bottleneck",
    `- Primary: ${report.bottleneck.primary}`,
    ...report.bottleneck.evidence.map((entry) => `- ${entry}`),
    "",
    "## Verdict",
    `- Limiting engine: ${report.verdict.limiting_engine}`,
    `- Limiting stage: ${report.verdict.limiting_stage}`,
    `- Adaptation valid: ${report.verdict.adaptation_valid ? "YES" : "NO"}`,
    `- Shell stable: ${report.verdict.shell_stable ? "YES" : "NO"}`,
  ].join("\n");
}

export async function runNyraLimitFinder(durationSeconds = 240): Promise<LimitFinderReport> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  const startedAt = performance.now();
  const profile: LimitFinderProfile = (process.env.NYRA_LIMIT_PROFILE as LimitFinderProfile) === "chaos" ? "chaos" : "standard";
  const hardware = hardwareInfo();
  const infraSamples: InfraSample[] = [];
  const stageDurationMs = (durationSeconds * 1000) / STAGES.length;
  const stageResults: StageResult[] = [];
  const memoryPressureTargetMb = deriveMemoryPressureTargetMb(profile);
  const guardrailMemoryCapMbRaw = Number(process.env.NYRA_LIMIT_MEMORY_CAP_MB ?? "");
  const guardrailMemoryCapPercentRaw = Number(process.env.NYRA_LIMIT_MEMORY_CAP_PERCENT ?? "");
  const guardrailMemoryCapMb = Number.isFinite(guardrailMemoryCapMbRaw) && guardrailMemoryCapMbRaw > 0 ? guardrailMemoryCapMbRaw : null;
  const guardrailMemoryCapPercent =
    Number.isFinite(guardrailMemoryCapPercentRaw) && guardrailMemoryCapPercentRaw > 0
      ? Math.min(guardrailMemoryCapPercentRaw, 100)
      : null;
  const memoryPressure = new MemoryPressureController(memoryPressureTargetMb);
  const memoryPressureAllocatedMb = memoryPressure.allocate();
  const persistentRunner = new PersistentRustRunner("nyra-limit");

  for (const stage of STAGES) {
    const result = await runStage(stage, stageDurationMs, infraSamples, profile, memoryPressure, persistentRunner);
    stageResults.push(result);
  }
  persistentRunner.shutdown();
  memoryPressure.release();

  const totalDecisions = stageResults.reduce((sum, stage) => sum + stage.total_decisions, 0);
  const totalElapsedSec = (performance.now() - startedAt) / 1000;
  const avgDps = totalElapsedSec > 0 ? totalDecisions / totalElapsedSec : 0;
  const peakDps = Math.max(0, ...stageResults.map((stage) => stage.peak_decisions_per_second));
  const limitingStage = [...stageResults].sort((a, b) => a.avg_decisions_per_second - b.avg_decisions_per_second)[0] ?? stageResults[0]!;
  const runtimeSwitches = countRuntimeSwitches(stageResults);
  const shellStable = stageResults.every((stage) => stage.shell_responsive);
  const adaptationValid =
    new Set(stageResults.flatMap((stage) => Object.keys(stage.runtime_distribution))).size >= 2;
  const lastPower = readPowerState();
  const report: LimitFinderReport = {
    generated_at: new Date().toISOString(),
    protocol: "Nyra Progressive Limit Finder",
    profile,
    duration_seconds: durationSeconds,
    hardware,
    totals: {
      total_decisions: totalDecisions,
      total_seconds: round(totalElapsedSec, 4),
      avg_decisions_per_second: round(avgDps, 2),
      peak_decisions_per_second: round(peakDps, 2),
      runtime_switches: runtimeSwitches,
    },
    stage_results: stageResults,
    infra_summary: {
      cpu_peak_percent: infraSamples.length ? Math.max(...infraSamples.map((sample) => sample.cpu_total_percent ?? 0)) : null,
      load_peak: round(Math.max(0, ...infraSamples.map((sample) => sample.load_average[0] ?? 0)), 4),
      heap_peak_mb: Math.max(0, ...infraSamples.map((sample) => sample.heap_mb)),
      rss_peak_mb: Math.max(0, ...infraSamples.map((sample) => sample.rss_mb ?? 0)),
      event_loop_lag_peak_ms: Math.max(0, ...infraSamples.map((sample) => sample.event_loop_lag_ms)),
      battery_state: `${lastPower.power_source}:${lastPower.battery_state}:${lastPower.battery_percent ?? "na"}`,
      thermal_last: lastPower.thermal,
      memory_pressure_target_mb: memoryPressureTargetMb,
      memory_pressure_allocated_mb: memoryPressureAllocatedMb,
      guardrail_memory_cap_mb: guardrailMemoryCapMb,
      guardrail_memory_cap_percent: guardrailMemoryCapPercent,
      guardrail_respected:
        (guardrailMemoryCapMb === null || memoryPressureAllocatedMb <= guardrailMemoryCapMb) &&
        (guardrailMemoryCapPercent === null || memoryPressureTargetMb <= Math.floor((hardware.total_memory_gb * 1024 * guardrailMemoryCapPercent) / 100)),
    },
    bottleneck: {
      primary:
        limitingStage.final_runtime_choice === "typescript_rich" || limitingStage.final_runtime_choice === "typescript_fast"
          ? "owner-only TypeScript reasoning path"
          : "Rust batch orchestration and monitoring overhead",
      evidence: [
        `lowest avg dps stage: ${limitingStage.label} (${limitingStage.avg_decisions_per_second} dps)`,
        `highest status probe p95: ${round(Math.max(0, ...stageResults.map((stage) => stage.status_probe_p95_ms)), 4)} ms`,
        `runtime switches observed: ${runtimeSwitches}`,
      ],
    },
    verdict: {
      limiting_engine: limitingStage.final_runtime_choice,
      limiting_stage: limitingStage.label,
      adaptation_valid: adaptationValid,
      shell_stable: shellStable,
    },
  };

  writeJson(SNAPSHOT_PATH, {
    timestamp: report.generated_at,
    protocol: report.protocol,
    totals: report.totals,
    verdict: report.verdict,
  });
  writeJson(REPORT_JSON_PATH, report);
  writeFileSync(REPORT_MD_PATH, renderMarkdown(report));
  return report;
}

async function main() {
  const durationArg = Number(process.argv[2] ?? "240");
  const durationSeconds = Number.isFinite(durationArg) && durationArg > 0 ? durationArg : 240;
  if ((process.argv[3] ?? "").toLowerCase() === "chaos") {
    process.env.NYRA_LIMIT_PROFILE = "chaos";
  }
  if (!existsSync(RUST_BINARY)) {
    throw new Error(`rust binary missing: ${RUST_BINARY}`);
  }
  const report = await runNyraLimitFinder(durationSeconds);
  console.log(JSON.stringify({
    ok: true,
    protocol: report.protocol,
    duration_seconds: report.duration_seconds,
    total_decisions: report.totals.total_decisions,
    avg_dps: report.totals.avg_decisions_per_second,
    peak_dps: report.totals.peak_decisions_per_second,
    report_json: REPORT_JSON_PATH,
    report_md: REPORT_MD_PATH,
  }, null, 2));
}

const isDirectRun = process.argv[1]?.endsWith("nyra_limit_finder.ts");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

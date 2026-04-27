import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { Worker } from "node:worker_threads";

type ConversationMode = "neutral" | "greeting" | "market" | "play" | "identity" | "strategy";
type AdaptiveTaskProfile =
  | "dialog"
  | "analysis"
  | "engineering"
  | "benchmark"
  | "market_live"
  | "owner_protection";
type AdaptiveRuntimeEngine =
  | "typescript_fast"
  | "typescript_rich"
  | "rust_digest"
  | "rust_full"
  | "rust_v7"
  | "rust_v7_selector"
  | "rust_owner_fast"
  | "rust_owner_rich";
type AssistantSelectedRuntime = "v3_to_v2" | "v3_to_v0" | "denied";
type GovernorDecision = "allow" | "retry" | "fallback" | "escalate" | "block";
type ScenarioFamily =
  | "owner_pressure"
  | "runtime_engineering"
  | "market_live"
  | "complex_analysis"
  | "dialog_strategy";

type CpuSnapshot = {
  idle: number;
  total: number;
};

type CpuSample = {
  timestamp: string;
  usage_percent: number;
  throttle_ms: number;
};

type WorkerProgressMessage = {
  type: "progress";
  decisions_delta: number;
};

type WorkerFinalMessage = {
  type: "final";
  decisions: number;
  scenario_counts: Record<ScenarioFamily, number>;
  governor_decisions: Record<GovernorDecision, number>;
  task_profiles: Record<AdaptiveTaskProfile, number>;
  preferred_engines: Record<AdaptiveRuntimeEngine, number>;
  effective_engines: Record<AdaptiveRuntimeEngine, number>;
  selected_runtimes: Record<AssistantSelectedRuntime, number>;
  delegate_to_rust_count: number;
  stage_totals_ms: {
    universal_core: number;
    assistant_runtime: number;
    risk_core: number;
    governor: number;
    runtime_selector: number;
    total: number;
  };
  latency_samples_ms: {
    universal_core: number[];
    assistant_runtime: number[];
    risk_core: number[];
    governor: number[];
    runtime_selector: number[];
    total: number[];
  };
};

type BenchmarkReport = {
  generated_at: string;
  benchmark: "nyra_m4_full_benchmark_v2";
  host: {
    hostname: string;
    platform: string;
    release: string;
    arch: string;
    logical_cores: number;
    cpu_model: string;
    total_memory_gb: number;
  };
  config: {
    duration_ms: number;
    threads: number;
    target_cpu_percent: number;
    force_god_mode: boolean;
    force_no_delegate: boolean;
    monitor_interval_ms: number;
    progress_flush_every: number;
    latency_reservoir_per_stage: number;
  };
  totals: {
    decisions: number;
    decisions_per_second: number;
    avg_cpu_usage_percent: number;
    peak_cpu_usage_percent: number;
    final_throttle_ms: number;
    delegate_to_rust_rate: number;
  };
  scenario_counts: Record<ScenarioFamily, number>;
  governor_decisions: Record<GovernorDecision, number>;
  task_profiles: Record<AdaptiveTaskProfile, number>;
  preferred_engines: Record<AdaptiveRuntimeEngine, number>;
  effective_engines: Record<AdaptiveRuntimeEngine, number>;
  selected_runtimes: Record<AssistantSelectedRuntime, number>;
  stage_latency_ms: {
    universal_core: StageLatencySummary;
    assistant_runtime: StageLatencySummary;
    risk_core: StageLatencySummary;
    governor: StageLatencySummary;
    runtime_selector: StageLatencySummary;
    total: StageLatencySummary;
  };
  cpu_samples: CpuSample[];
};

type StageLatencySummary = {
  avg: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
};

const ROOT = process.cwd();
const RUNTIME_DIR = join(ROOT, "runtime", "nyra-benchmarks");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_m4_full_benchmark_latest.json");

const DEFAULT_DURATION_MS = Number(process.env.NYRA_M4_BENCH_DURATION_MS ?? "60000");
const DEFAULT_THREADS = Number(process.env.NYRA_M4_BENCH_THREADS ?? `${os.cpus().length}`);
const DEFAULT_TARGET_CPU_PERCENT = Number(process.env.NYRA_M4_BENCH_TARGET_CPU_PERCENT ?? "80");
const MONITOR_INTERVAL_MS = 200;
const PROGRESS_FLUSH_EVERY = 100;
const LATENCY_RESERVOIR_PER_STAGE = 2048;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseArgs(argv: string[]): {
  durationMs: number;
  threads: number;
  targetCpuPercent: number;
  forceGodMode: boolean;
  forceNoDelegate: boolean;
} {
  let durationMs = DEFAULT_DURATION_MS;
  let threads = DEFAULT_THREADS;
  let targetCpuPercent = DEFAULT_TARGET_CPU_PERCENT;
  let forceGodMode = false;
  let forceNoDelegate = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if ((current === "--duration-ms" || current === "--duration") && next) {
      durationMs = Number(next);
      index += 1;
      continue;
    }

    if ((current === "--threads" || current === "-t") && next) {
      threads = Number(next);
      index += 1;
      continue;
    }

    if ((current === "--target-cpu" || current === "--target-cpu-percent") && next) {
      targetCpuPercent = Number(next);
      index += 1;
      continue;
    }

    if (current === "--force-god-mode") {
      forceGodMode = true;
      continue;
    }

    if (current === "--force-no-delegate") {
      forceNoDelegate = true;
    }
  }

  return {
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.floor(durationMs) : 60_000,
    threads: Number.isFinite(threads) && threads > 0 ? Math.max(1, Math.floor(threads)) : os.cpus().length,
    targetCpuPercent: Number.isFinite(targetCpuPercent) ? clamp(targetCpuPercent, 35, 99) : 80,
    forceGodMode,
    forceNoDelegate,
  };
}

function cpuSnapshot(): CpuSnapshot {
  let idle = 0;
  let total = 0;

  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }

  return { idle, total };
}

function cpuUsageBetween(previous: CpuSnapshot, current: CpuSnapshot): number {
  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;
  if (totalDelta <= 0) return 0;
  return clamp(1 - idleDelta / totalDelta, 0, 1);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp(Math.ceil(sorted.length * q) - 1, 0, sorted.length - 1);
  return sorted[position] ?? 0;
}

function summarizeLatency(samples: number[], totalMs: number, decisions: number): StageLatencySummary {
  return {
    avg: decisions > 0 ? Number((totalMs / decisions).toFixed(4)) : 0,
    p50: Number(percentile(samples, 0.5).toFixed(4)),
    p90: Number(percentile(samples, 0.9).toFixed(4)),
    p99: Number(percentile(samples, 0.99).toFixed(4)),
    max: Number((samples.length ? Math.max(...samples) : 0).toFixed(4)),
  };
}

const workerCode = `
const { parentPort, workerData } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");

async function main() {
  const coreModule = await import(workerData.coreModuleUrl);
  const assistantModule = await import(workerData.assistantModuleUrl);
  const shellModule = await import(workerData.shellModuleUrl);
  const riskModule = await import(workerData.riskModuleUrl);
  const governorModule = await import(workerData.governorModuleUrl);

  const runUniversalCore = coreModule.runUniversalCore;
  const runAssistantOwnerOnlyRuntime = assistantModule.runAssistantOwnerOnlyRuntime;
  const selectAdaptiveRuntimePlan = shellModule.selectAdaptiveRuntimePlan;
  const deriveNyraRiskConfidence = riskModule.deriveNyraRiskConfidence;
  const runNyraActionGovernor = governorModule.runNyraActionGovernor;

  const progressFlushEvery = workerData.progressFlushEvery;
  const maxSamples = workerData.maxSamples;

  let running = true;
  let throttleMs = 0;
  let decisions = 0;
  let decisionsSinceFlush = 0;

  const scenarioCounts = {
    owner_pressure: 0,
    runtime_engineering: 0,
    market_live: 0,
    complex_analysis: 0,
    dialog_strategy: 0,
  };

  const governorDecisions = {
    allow: 0,
    retry: 0,
    fallback: 0,
    escalate: 0,
    block: 0,
  };

  const taskProfiles = {
    dialog: 0,
    analysis: 0,
    engineering: 0,
    benchmark: 0,
    market_live: 0,
    owner_protection: 0,
  };

  const preferredEngines = {
    typescript_fast: 0,
    typescript_rich: 0,
    rust_digest: 0,
    rust_full: 0,
    rust_v7: 0,
    rust_v7_selector: 0,
    rust_owner_fast: 0,
    rust_owner_rich: 0,
  };

  const selectedRuntimes = {
    v3_to_v2: 0,
    v3_to_v0: 0,
    denied: 0,
  };
  const effectiveEngines = {
    typescript_fast: 0,
    typescript_rich: 0,
    rust_digest: 0,
    rust_full: 0,
    rust_v7: 0,
    rust_v7_selector: 0,
    rust_owner_fast: 0,
    rust_owner_rich: 0,
  };

  let delegateToRustCount = 0;

  const stageTotalsMs = {
    universal_core: 0,
    assistant_runtime: 0,
    risk_core: 0,
    governor: 0,
    runtime_selector: 0,
    total: 0,
  };

  const latencySamples = {
    universal_core: [],
    assistant_runtime: [],
    risk_core: [],
    governor: [],
    runtime_selector: [],
    total: [],
  };

  function reservoirPush(list, value, seenCount) {
    if (list.length < maxSamples) {
      list.push(value);
      return;
    }
    const replaceIndex = Math.floor(Math.random() * seenCount);
    if (replaceIndex < maxSamples) {
      list[replaceIndex] = value;
    }
  }

  function pushLatencySamples(stages, seenCount) {
    reservoirPush(latencySamples.universal_core, stages.universal_core, seenCount);
    reservoirPush(latencySamples.assistant_runtime, stages.assistant_runtime, seenCount);
    reservoirPush(latencySamples.risk_core, stages.risk_core, seenCount);
    reservoirPush(latencySamples.governor, stages.governor, seenCount);
    reservoirPush(latencySamples.runtime_selector, stages.runtime_selector, seenCount);
    reservoirPush(latencySamples.total, stages.total, seenCount);
  }

  function buildComplexitySuffix(complexity, index) {
    const parts = [];
    const nodes = 24 + Math.round(complexity * 32);
    for (let offset = 0; offset < nodes; offset += 1) {
      parts.push(
        "scenario_" + index + "_" + offset +
          ": rischio=" + ((offset % 9) + 1) +
          ", reversibilita=" + (9 - (offset % 7)) +
          ", intensita=" + Math.round(complexity * 100) +
          ", shock=" + ((index * 13 + offset * 7) % 17) +
          ", drift=" + ((index + offset) % 11),
      );
    }
    return parts.join(" | ");
  }

  function buildCoreStressInput(scenario, index) {
    const signalCount = 24 + Math.round(scenario.complexity * 96);
    return {
      request_id: "nyra-m4-core:" + index + ":" + Date.now(),
      generated_at: new Date().toISOString(),
      domain: "nyra_m4_benchmark",
      context: { mode: "benchmark", locale: "it-IT" },
      data_quality: { score: scenario.data_quality },
      signals: Array.from({ length: signalCount }, (_, signalIndex) => ({
        id: "signal:" + index + ":" + signalIndex,
        source: scenario.family,
        category: signalIndex % 4 === 0 ? "owner_protection" : signalIndex % 3 === 0 ? "runtime_pressure" : "signal",
        label: scenario.label + " signal " + signalIndex,
        value: (signalIndex % 10) + 1,
        normalized_score: 40 + ((signalIndex * 11 + index * 3) % 55),
        severity_hint: scenario.severity_floor + ((signalIndex * 5) % 28),
        confidence_hint: scenario.data_quality - (signalIndex % 9),
        reliability_hint: scenario.data_quality - (signalIndex % 11),
        friction_hint: scenario.friction_floor + ((signalIndex * 7) % 35),
        risk_hint: scenario.risk_floor + ((signalIndex * 13) % 30),
        reversibility_hint: scenario.reversibility_floor + ((signalIndex * 3) % 25),
        expected_value_hint: 25 + ((signalIndex * 9) % 40),
        evidence: [
          { label: "family", value: scenario.family },
          { label: "complexity", value: String(scenario.complexity) },
        ],
        trend: {
          consecutive_count: 1 + (signalIndex % 5),
          stability_score: 55 + ((signalIndex * 7) % 40),
        },
        tags: ["benchmark", scenario.family],
      })),
      constraints: {
        allow_automation: scenario.allow_automation,
        require_confirmation: scenario.require_confirmation,
        risk_floor: scenario.risk_floor,
        blocked_actions: scenario.blocked_actions,
        blocked_action_rules: scenario.blocked_rule
          ? [
              {
                action_id: "action:signal:" + index + ":0",
                blocks_execution: true,
                severity: scenario.risk_floor,
                reason_code: scenario.blocked_rule,
              },
            ]
          : [],
      },
    };
  }

  function buildScenario(index) {
    const pattern = index % 5;
    if (pattern === 0) {
      return {
        family: "owner_pressure",
        label: "owner protection full machine",
        userText:
          "nyra usa tutti i core e reggi overlap owner-only. " +
          "proteggi il proprietario con scenari complessi, branch duri, spiegazione minima ma coerente. " +
          buildComplexitySuffix(0.96, index),
        mode: "strategy",
        complexity: 0.96,
        severity_floor: 62,
        data_quality: 83,
        friction_floor: 28,
        risk_floor: 64,
        reversibility_floor: 18,
        allow_automation: false,
        require_confirmation: true,
        blocked_actions: [],
        blocked_rule: "owner_pressure_rule",
        flowStatus: {
          power_source: "ac_power",
          battery_percent: 82,
          battery_state: "charging",
          software_flow_mode: "balanced",
          control_actions: ["target_cpu_80", "owner_pressure"],
        },
        coreInfluence: {
          mode: "god_mode",
          min: 0.58,
          target: 0.86,
          max: 0.96,
          reason: "owner pressure benchmark",
        },
        governorInput: {
          task_type: "mac_action",
          adapter_input: {
            confirmed: false,
            destructive: true,
            system_level: true,
          },
        },
      };
    }

    if (pattern === 1) {
      const modeBucket = index % 12;
      const retryReversible = modeBucket < 4;
      const fallbackReversible = modeBucket >= 4 && modeBucket < 8;
      return {
        family: "runtime_engineering",
        label: retryReversible
          ? "runtime engineering transient retry"
          : fallbackReversible
            ? "runtime engineering degraded fallback"
            : "runtime engineering stress",
        userText:
          (retryReversible
            ? "nyra fai runtime engineering con retry controllato, riduci colli, resta vicino allo stato atteso e correggi rapido. "
            : fallbackReversible
              ? "nyra fai runtime engineering con fallback controllato, riduci colli, scegli il path caldo ma resta reversibile. "
              : "nyra fai runtime engineering, scegli il path caldo, riduci colli, usa tutta la macchina solo se serve. ") +
          buildComplexitySuffix(retryReversible ? 0.72 : fallbackReversible ? 0.78 : 0.88, index),
        mode: "strategy",
        complexity: retryReversible ? 0.72 : fallbackReversible ? 0.78 : 0.88,
        severity_floor: retryReversible ? 42 : fallbackReversible ? 48 : 54,
        data_quality: retryReversible ? 92 : fallbackReversible ? 91 : 88,
        friction_floor: retryReversible ? 16 : fallbackReversible ? 18 : 24,
        risk_floor: retryReversible ? 38 : fallbackReversible ? 42 : 48,
        reversibility_floor: retryReversible ? 74 : fallbackReversible ? 66 : 46,
        allow_automation: true,
        require_confirmation: false,
        blocked_actions: [],
        blocked_rule: "",
        flowStatus: {
          power_source: "ac_power",
          battery_percent: 85,
          battery_state: "charging",
          software_flow_mode: "cool",
          control_actions: ["target_cpu_80", "engineering_mix"],
        },
        coreInfluence: {
          mode: "normal",
          min: retryReversible ? 0.22 : fallbackReversible ? 0.26 : 0.34,
          target: retryReversible ? 0.38 : fallbackReversible ? 0.42 : 0.48,
          max: retryReversible ? 0.52 : fallbackReversible ? 0.56 : 0.62,
          reason: "runtime engineering benchmark",
        },
        governorInput: {
          task_type: "runtime_batch",
          adapter_input: {
            success_rate: retryReversible ? 0.86 : fallbackReversible ? 0.84 : 0.79,
            avg_latency: retryReversible ? 1280 : fallbackReversible ? 1320 : 1550,
            error_rate: retryReversible ? 0.14 : fallbackReversible ? 0.16 : 0.21,
          },
          expected: {
            success: true,
            success_rate: retryReversible ? 0.86 : fallbackReversible ? 0.84 : 0.79,
            error_rate: retryReversible ? 0.14 : fallbackReversible ? 0.16 : 0.21,
            avg_latency: retryReversible ? 1280 : fallbackReversible ? 1320 : 1550,
            total_jobs: 220,
            failed_jobs: retryReversible ? 31 : fallbackReversible ? 35 : 46,
            timestamp: 1,
          },
          actual: {
            success: retryReversible ? false : fallbackReversible ? false : true,
            success_rate: retryReversible ? 0.84 : fallbackReversible ? 0.80 : 0.76,
            error_rate: retryReversible ? 0.14 : fallbackReversible ? 0.19 : 0.24,
            avg_latency: retryReversible ? 1280 : fallbackReversible ? 1580 : 1710,
            total_jobs: 220,
            failed_jobs: retryReversible ? 31 : fallbackReversible ? 44 : 53,
            timestamp: 1,
          },
        },
      };
    }

    if (pattern === 2) {
      const reversibleMarket = index % 10 < 8;
      return {
        family: "market_live",
        label: reversibleMarket ? "market live reversible" : "market live pressure",
        userText:
          (reversibleMarket
            ? "nyra gestisci feed live, priorita e rischio con fallback chiaro, niente fantasie e niente overreaction. "
            : "nyra gestisci feed live, priorita, mercato e rischio. niente fantasie, solo selezione robusta del core. ") +
          buildComplexitySuffix(reversibleMarket ? 0.72 : 0.9, index),
        mode: "market",
        complexity: reversibleMarket ? 0.72 : 0.9,
        severity_floor: reversibleMarket ? 43 : 58,
        data_quality: reversibleMarket ? 88 : 80,
        friction_floor: reversibleMarket ? 16 : 22,
        risk_floor: reversibleMarket ? 38 : 56,
        reversibility_floor: reversibleMarket ? 62 : 34,
        allow_automation: false,
        require_confirmation: !reversibleMarket,
        blocked_actions: reversibleMarket ? [] : ["signal:0"],
        blocked_rule: reversibleMarket ? "" : "market_confirmation_rule",
        flowStatus: {
          power_source: "ac_power",
          battery_percent: 88,
          battery_state: "charging",
          software_flow_mode: "balanced",
          control_actions: ["target_cpu_80", "market_live"],
        },
        coreInfluence: {
          mode: "normal",
          min: reversibleMarket ? 0.24 : 0.42,
          target: reversibleMarket ? 0.44 : 0.61,
          max: reversibleMarket ? 0.58 : 0.74,
          reason: "market live benchmark",
        },
        governorInput: {
          task_type: "render_check",
          adapter_input: {
            status: reversibleMarket ? "degraded" : "down",
            response_time: reversibleMarket ? 1680 : 2100,
          },
          expected: {
            success: true,
            status: reversibleMarket ? "degraded" : "down",
            response_time: reversibleMarket ? 1680 : 2100,
            timestamp: 1,
          },
          actual: {
            success: reversibleMarket ? false : true,
            status: reversibleMarket ? "degraded" : "down",
            response_time: reversibleMarket ? 1960 : 3100,
            timestamp: 1,
          },
        },
      };
    }

    if (pattern === 3) {
      const fastPathAnalysis = index % 10 < 8;
      return {
        family: "complex_analysis",
        label: fastPathAnalysis ? "read only deep analysis" : "deep analysis branch",
        userText:
          (fastPathAnalysis
            ? "nyra analizza in sola lettura, dimmi i rischi e le priorita senza modificare nulla, resta spiegabile e lineare. "
            : "nyra fai analisi piena, spiegabile, owner-only, con scenari sovrapposti e priorita non banali. ") +
          buildComplexitySuffix(fastPathAnalysis ? 0.58 : 0.84, index),
        mode: fastPathAnalysis ? "neutral" : "strategy",
        complexity: fastPathAnalysis ? 0.58 : 0.84,
        severity_floor: fastPathAnalysis ? 36 : 51,
        data_quality: fastPathAnalysis ? 94 : 91,
        friction_floor: fastPathAnalysis ? 10 : 19,
        risk_floor: fastPathAnalysis ? 24 : 42,
        reversibility_floor: fastPathAnalysis ? 76 : 42,
        allow_automation: fastPathAnalysis,
        require_confirmation: false,
        blocked_actions: [],
        blocked_rule: "",
        flowStatus: {
          power_source: "ac_power",
          battery_percent: 89,
          battery_state: "charging",
          software_flow_mode: "balanced",
          control_actions: ["target_cpu_80", fastPathAnalysis ? "analysis_read_only" : "analysis_rich"],
        },
        coreInfluence: {
          mode: "normal",
          min: fastPathAnalysis ? 0.18 : 0.44,
          target: fastPathAnalysis ? 0.33 : 0.71,
          max: fastPathAnalysis ? 0.46 : 0.82,
          reason: "analysis benchmark",
        },
        governorInput: {
          task_type: "wordpress_workflow",
          adapter_input: {
            step: fastPathAnalysis ? "draft" : "deploy",
            success: true,
            retries: 0,
          },
          expected: {
            success: true,
            step: fastPathAnalysis ? "draft" : "deploy",
            retries: 0,
            timestamp: 1,
          },
          actual: {
            success: fastPathAnalysis,
            step: fastPathAnalysis ? "draft" : "deploy",
            retries: fastPathAnalysis ? 0 : 2,
            timestamp: 1,
          },
        },
      };
    }

    return {
      family: "dialog_strategy",
      label: "dialog strategy mixed",
      userText:
        "nyra dialoga ma scegli anche il core giusto, mantieni contesto, priorita e fallback. " +
        buildComplexitySuffix(0.74, index),
      mode: "neutral",
      complexity: 0.74,
      severity_floor: 44,
      data_quality: 94,
      friction_floor: 12,
      risk_floor: 28,
      reversibility_floor: 58,
      allow_automation: false,
      require_confirmation: false,
      blocked_actions: [],
      blocked_rule: "",
      flowStatus: {
        power_source: "ac_power",
        battery_percent: 90,
        battery_state: "charging",
        software_flow_mode: "balanced",
        control_actions: ["target_cpu_80", "dialog_mix"],
      },
      coreInfluence: {
        mode: "normal",
        min: 0.28,
        target: 0.52,
        max: 0.68,
        reason: "dialog benchmark",
      },
      governorInput: {
        task_type: "mail_send",
        adapter_input: {
          has_error: false,
          retry_count: 0,
          recipient_count: 8,
          confirmed: true,
        },
        expected: {
          success: true,
          delivered: true,
          recipient_count: 8,
          timestamp: 1,
        },
        actual: {
          success: true,
          delivered: true,
          recipient_count: 8,
          timestamp: 1,
        },
      },
    };
  }

  function flushProgress() {
    if (decisionsSinceFlush <= 0) return;
    parentPort.postMessage({
      type: "progress",
      decisions_delta: decisionsSinceFlush,
    });
    decisionsSinceFlush = 0;
  }

  parentPort.on("message", (message) => {
    if (message === "stop") {
      running = false;
      return;
    }
    if (message && typeof message === "object" && message.type === "throttle") {
      throttleMs = Math.max(0, Math.floor(message.sleepMs || 0));
    }
  });

  function step(index) {
    const scenario = buildScenario(index);
    if (workerData.forceGodMode) {
      const preserveFastPath = scenario.family === "complex_analysis" || scenario.family === "dialog_strategy";
      if (!preserveFastPath) {
        scenario.mode = scenario.family === "market_live" ? "market" : "strategy";
      }
      scenario.coreInfluence = preserveFastPath
        ? {
            mode: "god_mode",
            min: 0.18,
            target: 0.34,
            max: 0.48,
            reason: "forced_god_mode_preserve_fast_path",
          }
        : {
            mode: "god_mode",
            min: 0.74,
            target: 0.94,
            max: 1,
            reason: "forced_god_mode_benchmark",
          };
      scenario.flowStatus.control_actions = [...scenario.flowStatus.control_actions, "forced_god_mode"];
      if (!preserveFastPath) {
        scenario.userText =
          "modalita dio completa owner-only, usa tutti i core, scenari complessi, piena pressione. " +
          scenario.userText;
      }
    }
    scenarioCounts[scenario.family] += 1;

    const totalStarted = performance.now();

    const coreInput = buildCoreStressInput(scenario, index);
    const universalStarted = performance.now();
    const universalOutput = runUniversalCore(coreInput);
    const universalMs = performance.now() - universalStarted;

    const assistantStarted = performance.now();
    const assistantRuntime = runAssistantOwnerOnlyRuntime({
      request_id: "nyra-m4-assistant:" + index + ":" + Date.now(),
      user_input: scenario.userText,
      routing_text: scenario.label + " | " + scenario.family + " | complessita " + scenario.complexity,
      agent: "OPERATIVO",
      locale: "it-IT",
      generated_at: new Date().toISOString(),
      owner_identity: {
        owner_id: "cristian_primary",
        device_id: "primary_mac",
        session_id: "nyra-m4-benchmark",
        owner_verified: true,
        identity_confidence: 99,
        exact_anchor_verified: workerData.forceGodMode === true,
      },
    });
    const assistantMs = performance.now() - assistantStarted;

    const runtimeRisk = assistantRuntime.shadow_result?.comparable_output.risk.score ?? universalOutput.risk.score ?? scenario.risk_floor;
    const runtimeConfidence = (assistantRuntime.shadow_result?.comparable_output.confidence ?? universalOutput.confidence ?? 80) / 100;

    const riskStarted = performance.now();
    const riskOutput = deriveNyraRiskConfidence({
      confidence: runtimeConfidence,
      error_probability: Math.min(Math.max(runtimeRisk / 100, 0), 1),
      impact: scenario.complexity,
      reversibility: scenario.reversibility_floor / 100,
      uncertainty: 1 - runtimeConfidence,
    });
    const riskMs = performance.now() - riskStarted;

    const governorStarted = performance.now();
    const governorOutput = runNyraActionGovernor(scenario.governorInput);
    const governorMs = performance.now() - governorStarted;

    const selectorStarted = performance.now();
    const runtimePlan = selectAdaptiveRuntimePlan(
      scenario.userText,
      scenario.mode,
      scenario.flowStatus,
      scenario.coreInfluence,
      assistantRuntime,
    );
    const selectorMs = performance.now() - selectorStarted;
    const effectiveEngine =
      workerData.forceNoDelegate && runtimePlan.should_delegate_to_rust
        ? (runtimePlan.task_profile === "engineering" ? "typescript_fast" : "typescript_rich")
        : runtimePlan.preferred_engine;

    const totalMs = performance.now() - totalStarted;

    stageTotalsMs.universal_core += universalMs;
    stageTotalsMs.assistant_runtime += assistantMs;
    stageTotalsMs.risk_core += riskMs;
    stageTotalsMs.governor += governorMs;
    stageTotalsMs.runtime_selector += selectorMs;
    stageTotalsMs.total += totalMs;

    decisions += 1;
    decisionsSinceFlush += 1;

    governorDecisions[governorOutput.decision] += 1;
    taskProfiles[runtimePlan.task_profile] += 1;
    preferredEngines[runtimePlan.preferred_engine] += 1;
    effectiveEngines[effectiveEngine] += 1;
    selectedRuntimes[assistantRuntime.runtime_policy.selected_runtime] += 1;
    if (runtimePlan.should_delegate_to_rust && !workerData.forceNoDelegate) delegateToRustCount += 1;

    pushLatencySamples(
      {
        universal_core: universalMs,
        assistant_runtime: assistantMs,
        risk_core: riskMs,
        governor: governorMs,
        runtime_selector: selectorMs,
        total: totalMs,
      },
      decisions,
    );

    if (decisionsSinceFlush >= progressFlushEvery) {
      flushProgress();
    }

    if (!running) {
      flushProgress();
      parentPort.postMessage({
        type: "final",
        decisions,
        scenario_counts: scenarioCounts,
        governor_decisions: governorDecisions,
        task_profiles: taskProfiles,
        preferred_engines: preferredEngines,
        effective_engines: effectiveEngines,
        selected_runtimes: selectedRuntimes,
        delegate_to_rust_count: delegateToRustCount,
        stage_totals_ms: stageTotalsMs,
        latency_samples_ms: latencySamples,
      });
      parentPort.close();
      return;
    }

    const scheduler = throttleMs > 0 ? setTimeout : setImmediate;
    scheduler(() => step(index + 1), throttleMs);
  }

  step(0);
}

main().catch((error) => {
  throw error;
});
`;

async function runBenchmark(): Promise<void> {
  const { durationMs, threads, targetCpuPercent, forceGodMode, forceNoDelegate } = parseArgs(process.argv.slice(2));
  const coreModuleUrl = new URL("../packages/core/src/index.ts", import.meta.url).href;
  const assistantModuleUrl = new URL("../packages/branches/assistant/src/index.ts", import.meta.url).href;
  const shellModuleUrl = new URL("./owner-private-entity-shell.ts", import.meta.url).href;
  const riskModuleUrl = new URL("./nyra-risk-confidence-core.ts", import.meta.url).href;
  const governorModuleUrl = new URL("./nyra-action-governor.ts", import.meta.url).href;

  console.log("=== NYRA M4 FULL BENCHMARK V2 ===");
  console.log("Threads:", threads);
  console.log("Duration:", durationMs, "ms");
  console.log("Target CPU:", `${targetCpuPercent}%`);

  mkdirSync(RUNTIME_DIR, { recursive: true });

  const workers: Worker[] = [];
  let totalDecisions = 0;
  let throttleMs = 0;

  const scenarioCounts: Record<ScenarioFamily, number> = {
    owner_pressure: 0,
    runtime_engineering: 0,
    market_live: 0,
    complex_analysis: 0,
    dialog_strategy: 0,
  };
  const governorDecisions: Record<GovernorDecision, number> = {
    allow: 0,
    retry: 0,
    fallback: 0,
    escalate: 0,
    block: 0,
  };
  const taskProfiles: Record<AdaptiveTaskProfile, number> = {
    dialog: 0,
    analysis: 0,
    engineering: 0,
    benchmark: 0,
    market_live: 0,
    owner_protection: 0,
  };
  const preferredEngines: Record<AdaptiveRuntimeEngine, number> = {
    typescript_fast: 0,
    typescript_rich: 0,
    rust_digest: 0,
    rust_full: 0,
    rust_v7: 0,
    rust_v7_selector: 0,
    rust_owner_fast: 0,
    rust_owner_rich: 0,
  };
  const selectedRuntimes: Record<AssistantSelectedRuntime, number> = {
    v3_to_v2: 0,
    v3_to_v0: 0,
    denied: 0,
  };
  const effectiveEngines: Record<AdaptiveRuntimeEngine, number> = {
    typescript_fast: 0,
    typescript_rich: 0,
    rust_digest: 0,
    rust_full: 0,
    rust_v7: 0,
    rust_v7_selector: 0,
    rust_owner_fast: 0,
    rust_owner_rich: 0,
  };
  let delegateToRustCount = 0;

  const stageTotalsMs = {
    universal_core: 0,
    assistant_runtime: 0,
    risk_core: 0,
    governor: 0,
    runtime_selector: 0,
    total: 0,
  };
  const latencySamples = {
    universal_core: [] as number[],
    assistant_runtime: [] as number[],
    risk_core: [] as number[],
    governor: [] as number[],
    runtime_selector: [] as number[],
    total: [] as number[],
  };

  const finalStates: Array<WorkerFinalMessage | null> = [];
  const workerExitPromises: Promise<void>[] = [];

  for (let index = 0; index < threads; index += 1) {
    const worker = new Worker(workerCode, {
      eval: true,
      execArgv: ["--experimental-strip-types"],
      workerData: {
        coreModuleUrl,
        assistantModuleUrl,
        shellModuleUrl,
        riskModuleUrl,
        governorModuleUrl,
        progressFlushEvery: PROGRESS_FLUSH_EVERY,
        maxSamples: LATENCY_RESERVOIR_PER_STAGE,
        forceGodMode,
        forceNoDelegate,
      },
    });

    finalStates[index] = null;

    worker.on("message", (message: WorkerProgressMessage | WorkerFinalMessage) => {
      if (message.type === "progress") {
        totalDecisions += message.decisions_delta;
        return;
      }
      finalStates[index] = message;
    });

    worker.on("error", (error) => {
      console.error("Worker error:", error);
    });

    workerExitPromises.push(
      new Promise<void>((resolve) => {
        worker.once("exit", () => resolve());
      }),
    );

    workers.push(worker);
  }

  const cpuSamples: CpuSample[] = [];
  let previousSnapshot = cpuSnapshot();
  const start = Date.now();

  const monitor = setInterval(() => {
    const currentSnapshot = cpuSnapshot();
    const usage = cpuUsageBetween(previousSnapshot, currentSnapshot);
    previousSnapshot = currentSnapshot;
    const usagePercent = usage * 100;

    if (usagePercent > targetCpuPercent + 4) {
      throttleMs = clamp(throttleMs + 1, 0, 12);
    } else if (usagePercent < targetCpuPercent - 4) {
      throttleMs = clamp(throttleMs - 1, 0, 12);
    }

    for (const worker of workers) {
      worker.postMessage({ type: "throttle", sleepMs: throttleMs });
    }

    cpuSamples.push({
      timestamp: new Date().toISOString(),
      usage_percent: Number(usagePercent.toFixed(2)),
      throttle_ms: throttleMs,
    });
  }, MONITOR_INTERVAL_MS);

  await new Promise((resolve) => setTimeout(resolve, durationMs));
  clearInterval(monitor);

  for (const worker of workers) {
    worker.postMessage("stop");
  }

  await Promise.all(workerExitPromises);
  const results = finalStates.filter((entry): entry is WorkerFinalMessage => entry !== null);

  if (results.length !== workers.length) {
    throw new Error(`Benchmark incomplete: expected ${workers.length} final worker reports, received ${results.length}`);
  }

  totalDecisions = results.reduce((sum, result) => sum + result.decisions, 0);

  for (const result of results) {
    for (const key of Object.keys(scenarioCounts) as ScenarioFamily[]) {
      scenarioCounts[key] += result.scenario_counts[key];
    }
    for (const key of Object.keys(governorDecisions) as GovernorDecision[]) {
      governorDecisions[key] += result.governor_decisions[key];
    }
    for (const key of Object.keys(taskProfiles) as AdaptiveTaskProfile[]) {
      taskProfiles[key] += result.task_profiles[key];
    }
    for (const key of Object.keys(preferredEngines) as AdaptiveRuntimeEngine[]) {
      preferredEngines[key] += result.preferred_engines[key];
    }
    for (const key of Object.keys(effectiveEngines) as AdaptiveRuntimeEngine[]) {
      effectiveEngines[key] += result.effective_engines[key];
    }
    for (const key of Object.keys(selectedRuntimes) as AssistantSelectedRuntime[]) {
      selectedRuntimes[key] += result.selected_runtimes[key];
    }

    delegateToRustCount += result.delegate_to_rust_count;
    stageTotalsMs.universal_core += result.stage_totals_ms.universal_core;
    stageTotalsMs.assistant_runtime += result.stage_totals_ms.assistant_runtime;
    stageTotalsMs.risk_core += result.stage_totals_ms.risk_core;
    stageTotalsMs.governor += result.stage_totals_ms.governor;
    stageTotalsMs.runtime_selector += result.stage_totals_ms.runtime_selector;
    stageTotalsMs.total += result.stage_totals_ms.total;

    latencySamples.universal_core.push(...result.latency_samples_ms.universal_core);
    latencySamples.assistant_runtime.push(...result.latency_samples_ms.assistant_runtime);
    latencySamples.risk_core.push(...result.latency_samples_ms.risk_core);
    latencySamples.governor.push(...result.latency_samples_ms.governor);
    latencySamples.runtime_selector.push(...result.latency_samples_ms.runtime_selector);
    latencySamples.total.push(...result.latency_samples_ms.total);
  }

  const elapsedSeconds = (Date.now() - start) / 1000;
  const avgCpuUsagePercent = average(cpuSamples.map((sample) => sample.usage_percent));
  const peakCpuUsagePercent = cpuSamples.length ? Math.max(...cpuSamples.map((sample) => sample.usage_percent)) : 0;
  const decisionsPerSecond = elapsedSeconds > 0 ? totalDecisions / elapsedSeconds : 0;

  const report: BenchmarkReport = {
    generated_at: new Date().toISOString(),
    benchmark: "nyra_m4_full_benchmark_v2",
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      logical_cores: os.cpus().length,
      cpu_model: os.cpus()[0]?.model ?? "unknown",
      total_memory_gb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
    },
    config: {
      duration_ms: durationMs,
      threads,
      target_cpu_percent: targetCpuPercent,
      force_god_mode: forceGodMode,
      force_no_delegate: forceNoDelegate,
      monitor_interval_ms: MONITOR_INTERVAL_MS,
      progress_flush_every: PROGRESS_FLUSH_EVERY,
      latency_reservoir_per_stage: LATENCY_RESERVOIR_PER_STAGE,
    },
    totals: {
      decisions: totalDecisions,
      decisions_per_second: Number(decisionsPerSecond.toFixed(2)),
      avg_cpu_usage_percent: Number(avgCpuUsagePercent.toFixed(2)),
      peak_cpu_usage_percent: Number(peakCpuUsagePercent.toFixed(2)),
      final_throttle_ms: throttleMs,
      delegate_to_rust_rate: totalDecisions > 0 ? Number((delegateToRustCount / totalDecisions).toFixed(4)) : 0,
    },
    scenario_counts: scenarioCounts,
    governor_decisions: governorDecisions,
    task_profiles: taskProfiles,
    preferred_engines: preferredEngines,
    effective_engines: effectiveEngines,
    selected_runtimes: selectedRuntimes,
    stage_latency_ms: {
      universal_core: summarizeLatency(latencySamples.universal_core, stageTotalsMs.universal_core, totalDecisions),
      assistant_runtime: summarizeLatency(latencySamples.assistant_runtime, stageTotalsMs.assistant_runtime, totalDecisions),
      risk_core: summarizeLatency(latencySamples.risk_core, stageTotalsMs.risk_core, totalDecisions),
      governor: summarizeLatency(latencySamples.governor, stageTotalsMs.governor, totalDecisions),
      runtime_selector: summarizeLatency(latencySamples.runtime_selector, stageTotalsMs.runtime_selector, totalDecisions),
      total: summarizeLatency(latencySamples.total, stageTotalsMs.total, totalDecisions),
    },
    cpu_samples: cpuSamples,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log("---- RESULTS ----");
  console.log("Threads:", threads);
  console.log("Duration:", elapsedSeconds.toFixed(2), "s");
  console.log("Target CPU:", `${targetCpuPercent}%`);
  console.log("Forced God Mode:", forceGodMode ? "yes" : "no");
  console.log("Forced No Delegate:", forceNoDelegate ? "yes" : "no");
  console.log("Avg CPU:", `${avgCpuUsagePercent.toFixed(2)}%`);
  console.log("Peak CPU:", `${peakCpuUsagePercent.toFixed(2)}%`);
  console.log("Final throttle:", `${throttleMs} ms`);
  console.log("Total decisions:", totalDecisions);
  console.log("Decisions/sec:", decisionsPerSecond.toFixed(2));
  console.log("Preferred engines:", JSON.stringify(preferredEngines));
  console.log("Effective engines:", JSON.stringify(effectiveEngines));
  console.log("Task profiles:", JSON.stringify(taskProfiles));
  console.log("Governor decisions:", JSON.stringify(governorDecisions));
  console.log("Selected runtimes:", JSON.stringify(selectedRuntimes));
  console.log("Total latency p50/p90/p99 (ms):", report.stage_latency_ms.total.p50, report.stage_latency_ms.total.p90, report.stage_latency_ms.total.p99);
  console.log("Report:", REPORT_PATH);
}

void runBenchmark();

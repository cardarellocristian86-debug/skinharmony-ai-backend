import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { Worker } from "node:worker_threads";

type CpuSnapshot = {
  idle: number;
  total: number;
};

type CpuSample = {
  timestamp: string;
  usage_percent: number;
};

type WorkerProgressMessage = {
  type: "progress";
  decisions_delta: number;
};

type WorkerFinalMessage = {
  type: "final";
  decisions: number;
};

type CoreOnlyBenchmarkReport = {
  generated_at: string;
  benchmark: "nyra_core_only_benchmark";
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
    monitor_interval_ms: number;
    progress_flush_every: number;
  };
  totals: {
    decisions: number;
    decisions_per_second: number;
    avg_cpu_usage_percent: number;
    peak_cpu_usage_percent: number;
  };
  cpu_samples: CpuSample[];
};

const ROOT = process.cwd();
const RUNTIME_DIR = join(ROOT, "runtime", "nyra-benchmarks");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_core_only_benchmark_latest.json");

const DEFAULT_DURATION_MS = Number(process.env.NYRA_CORE_ONLY_DURATION_MS ?? "30000");
const DEFAULT_THREADS = Number(process.env.NYRA_CORE_ONLY_THREADS ?? `${os.cpus().length}`);
const MONITOR_INTERVAL_MS = 200;
const PROGRESS_FLUSH_EVERY = 5000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseArgs(argv: string[]): { durationMs: number; threads: number } {
  let durationMs = DEFAULT_DURATION_MS;
  let threads = DEFAULT_THREADS;

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
    }
  }

  return {
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.floor(durationMs) : 30000,
    threads: Number.isFinite(threads) && threads > 0 ? Math.max(1, Math.floor(threads)) : os.cpus().length,
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

const workerCode = `
const { parentPort, workerData } = require("node:worker_threads");

async function main() {
  const coreModule = await import(workerData.coreModuleUrl);
  const runUniversalCore = coreModule.runUniversalCore;

  let running = true;
  let decisions = 0;

  function buildInput(index) {
    const signalA = (index * 17) % 100;
    const signalB = (index * 23 + 11) % 100;
    const severityA = 35 + (signalA % 50);
    const severityB = 28 + (signalB % 44);

    return {
      request_id: "nyra-core-only:" + index + ":" + Date.now(),
      generated_at: new Date().toISOString(),
      domain: "assistant",
      context: {
        mode: "benchmark",
        locale: "it-IT",
        metadata: {
          benchmark: "core_only",
          iteration: index,
        },
      },
      signals: [
        {
          id: "signal:priority:" + index,
          source: "benchmark",
          category: "priority",
          label: "Primary priority signal",
          value: signalA,
          normalized_score: signalA,
          severity_hint: severityA,
          confidence_hint: 80,
          reliability_hint: 82,
          friction_hint: 18,
          risk_hint: 34,
          reversibility_hint: 74,
          expected_value_hint: 62,
          trend: {
            consecutive_count: 2,
            stability_score: 76,
          },
          evidence: [{ label: "kind", value: "priority" }],
          tags: ["benchmark"],
        },
        {
          id: "signal:risk:" + index,
          source: "benchmark",
          category: "risk",
          label: "Risk signal",
          value: signalB,
          normalized_score: signalB,
          severity_hint: severityB,
          confidence_hint: 77,
          reliability_hint: 79,
          friction_hint: 26,
          risk_hint: 48,
          reversibility_hint: 58,
          expected_value_hint: 40,
          trend: {
            consecutive_count: 1,
            stability_score: 69,
          },
          evidence: [{ label: "kind", value: "risk" }],
          tags: ["benchmark"],
        },
      ],
      data_quality: {
        score: 84,
        completeness: 82,
        freshness: 90,
        consistency: 79,
        reliability: 81,
      },
      constraints: {
        allow_automation: false,
        require_confirmation: true,
        safety_mode: true,
        blocked_actions: [],
        blocked_action_rules: [],
      },
    };
  }

  function flush(type) {
    if (decisions === 0) return;
    parentPort.postMessage({
      type,
      decisions: decisions,
      decisions_delta: decisions,
    });
    decisions = 0;
  }

  parentPort.on("message", (message) => {
    if (message === "stop") {
      running = false;
    }
  });

  let index = 0;
  function tick() {
    const batchSize = 250;
    for (let step = 0; step < batchSize; step += 1) {
      runUniversalCore(buildInput(index));
      index += 1;
      decisions += 1;
    }

    if (decisions >= workerData.progressFlushEvery) {
      flush("progress");
    }

    if (!running) {
      flush("final");
      parentPort.close();
      return;
    }

    setImmediate(tick);
  }

  tick();
}

main().catch((error) => {
  throw error;
});
`;

async function runBenchmark(): Promise<void> {
  const { durationMs, threads } = parseArgs(process.argv.slice(2));
  const coreModuleUrl = new URL("../packages/core/src/index.ts", import.meta.url).href;

  console.log("=== UNIVERSAL CORE ONLY TEST ===");
  console.log("Threads:", threads);
  console.log("Duration:", durationMs, "ms");

  mkdirSync(RUNTIME_DIR, { recursive: true });

  const workers: Worker[] = [];
  const finalStates: Array<WorkerFinalMessage | null> = [];
  const workerExitPromises: Promise<void>[] = [];
  let totalDecisions = 0;

  for (let index = 0; index < threads; index += 1) {
    const worker = new Worker(workerCode, {
      eval: true,
      execArgv: ["--experimental-strip-types"],
      workerData: {
        coreModuleUrl,
        progressFlushEvery: PROGRESS_FLUSH_EVERY,
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
    cpuSamples.push({
      timestamp: new Date().toISOString(),
      usage_percent: Number((usage * 100).toFixed(2)),
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
    throw new Error(`Core-only benchmark incomplete: expected ${workers.length} final worker reports, received ${results.length}`);
  }

  totalDecisions = results.reduce((sum, result) => sum + result.decisions, 0);

  const elapsedSeconds = (Date.now() - start) / 1000;
  const avgCpuUsagePercent = cpuSamples.length
    ? cpuSamples.reduce((sum, sample) => sum + sample.usage_percent, 0) / cpuSamples.length
    : 0;
  const peakCpuUsagePercent = cpuSamples.length
    ? Math.max(...cpuSamples.map((sample) => sample.usage_percent))
    : 0;
  const decisionsPerSecond = elapsedSeconds > 0 ? totalDecisions / elapsedSeconds : 0;

  const report: CoreOnlyBenchmarkReport = {
    generated_at: new Date().toISOString(),
    benchmark: "nyra_core_only_benchmark",
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
      monitor_interval_ms: MONITOR_INTERVAL_MS,
      progress_flush_every: PROGRESS_FLUSH_EVERY,
    },
    totals: {
      decisions: totalDecisions,
      decisions_per_second: Number(decisionsPerSecond.toFixed(2)),
      avg_cpu_usage_percent: Number(avgCpuUsagePercent.toFixed(2)),
      peak_cpu_usage_percent: Number(peakCpuUsagePercent.toFixed(2)),
    },
    cpu_samples: cpuSamples,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log("---- RESULTS ----");
  console.log("Threads:", threads);
  console.log("Duration:", elapsedSeconds.toFixed(2), "s");
  console.log("Total decisions:", totalDecisions);
  console.log("Decisions/sec:", decisionsPerSecond.toFixed(2));
  console.log("Avg CPU:", `${avgCpuUsagePercent.toFixed(2)}%`);
  console.log("Peak CPU:", `${peakCpuUsagePercent.toFixed(2)}%`);
  console.log("Report:", REPORT_PATH);
}

void runBenchmark();

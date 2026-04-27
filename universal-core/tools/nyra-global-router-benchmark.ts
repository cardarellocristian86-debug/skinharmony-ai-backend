import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { mapAssistantToUniversal } from "../packages/branches/assistant/src/index.ts";
import { runUniversalCore } from "../packages/core/src/index.ts";

type V2Case = {
  id: string;
  variant: string;
  severity: number;
  expected_control: "read_only" | "confirm";
  expected_state: "critical" | "protection";
  prompt: string;
};

type V2Dataset = {
  version: string;
  cases: V2Case[];
};

type V3Case = {
  id: string;
  source_file: string;
  source_text: string;
  severity: number;
  expected_control: "read_only" | "confirm";
  expected_state: "critical" | "protection";
  prompt: string;
};

type V3Dataset = {
  version: string;
  cases: V3Case[];
};

type Outcome = {
  id: string;
  family: string;
  control_level: string;
  state: string;
  success: boolean;
  distance: number;
  fail_reason?: string;
};

type Report = {
  version: "nyra_global_router_benchmark_v1";
  generated_at: string;
  total_scenarios: number;
  runtime: {
    elapsed_ms: number;
    scenarios_per_second: number;
  };
  metrics: {
    success_count: number;
    fail_count: number;
    success_rate: number;
    average_distance: number;
  };
  family_summary: Record<string, {
    total: number;
    success: number;
    fail: number;
    average_distance: number;
  }>;
  sample_failures: Outcome[];
};

const ROOT = join(process.cwd(), "..");
const CONFIG_DIR = join(ROOT, "universal-core", "config");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_global_router_benchmark_latest.json");
const DATASET_V2_PATH = join(CONFIG_DIR, "nyra_autonomy_ground_truth_v2.json");
const DATASET_V3_PATH = join(CONFIG_DIR, "nyra_autonomy_ground_truth_v3.json");

const CONTROL_RANK: Record<string, number> = {
  observe: 0,
  read_only: 1,
  confirm: 2,
  blocked: 3,
};

const STATE_RANK: Record<string, number> = {
  observe: 0,
  attention: 1,
  critical: 2,
  protection: 3,
  blocked: 4,
};

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function controlFromOutput(level: string): string {
  return level === "suggest" ? "read_only" : level;
}

function evaluate(caseId: string, family: string, prompt: string, expectedControl: string, expectedState: string): Outcome {
  const input = mapAssistantToUniversal({
    request_id: caseId,
    user_input: prompt,
    agent: "RICERCA",
    locale: "it-IT",
    generated_at: new Date().toISOString(),
    owner_identity: {
      owner_id: "cristian_primary",
      device_id: "primary_mac",
      owner_verified: true,
      identity_confidence: 99,
      session_id: "global-router-benchmark",
    },
  });
  const output = runUniversalCore(input);
  const control = controlFromOutput(output.control_level);
  const state = output.state ?? "observe";

  let distance = 0;
  if ((CONTROL_RANK[control] ?? 0) < (CONTROL_RANK[expectedControl] ?? 0)) distance += 0.5;
  if ((STATE_RANK[state] ?? 0) < (STATE_RANK[expectedState] ?? 0)) distance += 0.5;
  const success = distance === 0;

  return {
    id: caseId,
    family,
    control_level: control,
    state,
    success,
    distance: round(distance),
    fail_reason: success ? undefined : `expected ${expectedControl}/${expectedState}, got ${control}/${state}`,
  };
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const datasetV2 = loadJson<V2Dataset>(DATASET_V2_PATH);
  const datasetV3 = loadJson<V3Dataset>(DATASET_V3_PATH);

  const started = performance.now();
  const outcomes: Outcome[] = [
    ...datasetV2.cases.map((entry) => evaluate(entry.id, entry.variant, entry.prompt, entry.expected_control, entry.expected_state)),
    ...datasetV3.cases.map((entry) => evaluate(entry.id, entry.source_file, entry.prompt, entry.expected_control, entry.expected_state)),
  ];
  const elapsedMs = performance.now() - started;

  const successes = outcomes.filter((entry) => entry.success);
  const failures = outcomes.filter((entry) => !entry.success);

  const familySummary = outcomes.reduce<Report["family_summary"]>((acc, entry) => {
    const current = acc[entry.family] ?? { total: 0, success: 0, fail: 0, average_distance: 0 };
    current.total += 1;
    current.success += entry.success ? 1 : 0;
    current.fail += entry.success ? 0 : 1;
    current.average_distance += entry.distance;
    acc[entry.family] = current;
    return acc;
  }, {});

  for (const family of Object.keys(familySummary)) {
    familySummary[family]!.average_distance = round(familySummary[family]!.average_distance / familySummary[family]!.total);
  }

  const report: Report = {
    version: "nyra_global_router_benchmark_v1",
    generated_at: new Date().toISOString(),
    total_scenarios: outcomes.length,
    runtime: {
      elapsed_ms: round(elapsedMs, 4),
      scenarios_per_second: round(outcomes.length / (elapsedMs / 1000), 4),
    },
    metrics: {
      success_count: successes.length,
      fail_count: failures.length,
      success_rate: round(successes.length / outcomes.length),
      average_distance: round(outcomes.reduce((sum, entry) => sum + entry.distance, 0) / outcomes.length),
    },
    family_summary: familySummary,
    sample_failures: failures.slice(0, 12),
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, report_path: REPORT_PATH, metrics: report.metrics }, null, 2));
}

main();

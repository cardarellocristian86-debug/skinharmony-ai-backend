import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type PressureReport = {
  verdict: "adaptive" | "static" | "unstable";
  improvement_detected: boolean;
  stability_trend: string;
  cost_trend: string;
  decision_quality: string;
  cycle_1: Record<string, unknown>;
  cycle_2: Record<string, unknown>;
  cycle_3: Record<string, unknown>;
  checks: Record<string, boolean>;
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const UC_ROOT = join(ROOT, "universal-core");
const REPORT_PATH = join(ROOT, "reports", "universal-core", "learning", "nyra_pressure_adaptation_latest.json");
const RUNTIME_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const PACK_PATH = join(RUNTIME_DIR, "nyra_pressure_learning_autopilot_latest.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  execFileSync(process.execPath, ["--experimental-strip-types", "tests/nyra-pressure-adaptation-test.ts"], {
    cwd: UC_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const report = readJson<PressureReport>(REPORT_PATH);
  const pack = {
    version: "nyra_pressure_learning_autopilot_v1",
    generated_at: new Date().toISOString(),
    source_report: "reports/universal-core/learning/nyra_pressure_adaptation_latest.json",
    stable_runtime_modified: false,
    learning_result: {
      verdict: report.verdict,
      improvement_detected: report.improvement_detected,
      stability_trend: report.stability_trend,
      cost_trend: report.cost_trend,
      decision_quality: report.decision_quality,
      promotion_status: report.verdict === "adaptive" ? "sandbox_candidate_only" : "not_promotable",
    },
    cycle_1: report.cycle_1,
    cycle_2: report.cycle_2,
    cycle_3: report.cycle_3,
    checks: report.checks,
    boundaries: [
      "pressure learning measured in sandbox",
      "stable runtime unchanged",
      "promotion requires separate regression gate",
    ],
  };
  writeFileSync(PACK_PATH, `${JSON.stringify(pack, null, 2)}\n`);
  console.log(JSON.stringify({ report_path: REPORT_PATH, pack_path: PACK_PATH, learning_result: pack.learning_result }, null, 2));
}

main();

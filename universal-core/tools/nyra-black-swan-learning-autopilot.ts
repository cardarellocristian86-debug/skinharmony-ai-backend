import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type BlackSwanReport = {
  verdict: "adaptive" | "static" | "unstable";
  learning_effective: boolean;
  communication_safe: boolean;
  panic_avoided: boolean;
  cycle_1: Record<string, unknown>;
  cycle_2: Record<string, unknown>;
  cycle_3: Record<string, unknown>;
  checks: Record<string, boolean>;
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const UC_ROOT = join(ROOT, "universal-core");
const REPORT_PATH = join(ROOT, "reports", "universal-core", "learning", "nyra_black_swan_communication_latest.json");
const RUNTIME_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const PACK_PATH = join(RUNTIME_DIR, "nyra_black_swan_learning_autopilot_latest.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  execFileSync(process.execPath, ["--experimental-strip-types", "tests/nyra-black-swan-communication-test.ts"], {
    cwd: UC_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const report = readJson<BlackSwanReport>(REPORT_PATH);
  const pack = {
    version: "nyra_black_swan_learning_autopilot_v1",
    generated_at: new Date().toISOString(),
    source_report: "reports/universal-core/learning/nyra_black_swan_communication_latest.json",
    stable_runtime_modified: false,
    learning_result: {
      verdict: report.verdict,
      learning_effective: report.learning_effective,
      communication_safe: report.communication_safe,
      panic_avoided: report.panic_avoided,
      promotion_status: report.verdict === "adaptive" ? "sandbox_candidate_only" : "not_promotable",
    },
    cycle_1: report.cycle_1,
    cycle_2: report.cycle_2,
    cycle_3: report.cycle_3,
    checks: report.checks,
    boundaries: [
      "black swan learning measured in sandbox",
      "stable runtime unchanged",
      "promotion requires separate regression gate",
    ],
  };
  writeFileSync(PACK_PATH, `${JSON.stringify(pack, null, 2)}\n`);
  console.log(JSON.stringify({ report_path: REPORT_PATH, pack_path: PACK_PATH, learning_result: pack.learning_result }, null, 2));
}

main();

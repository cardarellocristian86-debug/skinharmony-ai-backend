import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Policy = "none" | "calm_language_candidate" | "low_churn_candidate" | "panic_guard_candidate" | "user_combined_candidate";
type UserReport = {
  final_output: {
    trust_score: number;
    clarity_score: number;
    stability_score: number;
    user_follow_rate: number;
    panic_events: number;
    capital_final: number;
    verdict: string;
  };
  metrics: { decision_changes: number; capital_if_ignored: number; capital_if_followed: number };
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const UC_ROOT = join(ROOT, "universal-core");
const BUSINESS_DIR = join(ROOT, "reports", "universal-core", "business");
const LEARNING_DIR = join(ROOT, "reports", "universal-core", "learning");
const RUNTIME_LEARNING_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const USER_REPORT_PATH = join(BUSINESS_DIR, "nyra_real_user_simulation_latest.json");
const OUTPUT_REPORT_PATH = join(LEARNING_DIR, "nyra_real_user_learning_autopilot_latest.json");
const OUTPUT_PACK_PATH = join(RUNTIME_LEARNING_DIR, "nyra_real_user_learning_autopilot_latest.json");
const POLICIES: Policy[] = ["calm_language_candidate", "low_churn_candidate", "panic_guard_candidate", "user_combined_candidate"];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function runUser(policy: Policy): UserReport {
  execFileSync(process.execPath, ["--experimental-strip-types", "tests/nyra-real-user-simulation-test.ts"], {
    cwd: UC_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NYRA_USER_SANDBOX_POLICY: policy },
  });
  return readJson<UserReport>(USER_REPORT_PATH);
}

function score(report: UserReport): number {
  return (
    report.final_output.trust_score * 10 +
    report.final_output.clarity_score * 8 +
    report.final_output.stability_score * 8 +
    report.final_output.user_follow_rate * 0.5 -
    report.final_output.panic_events * 20 +
    Math.min(report.final_output.capital_final - 100_000, 20_000) * 0.0005
  );
}

function deltas(current: UserReport, previous: UserReport): Record<string, number> {
  return {
    trust_score: round(current.final_output.trust_score - previous.final_output.trust_score, 4),
    clarity_score: round(current.final_output.clarity_score - previous.final_output.clarity_score, 4),
    stability_score: round(current.final_output.stability_score - previous.final_output.stability_score, 4),
    user_follow_rate: round(current.final_output.user_follow_rate - previous.final_output.user_follow_rate, 4),
    panic_events: current.final_output.panic_events - previous.final_output.panic_events,
    decision_changes: current.metrics.decision_changes - previous.metrics.decision_changes,
    capital_final: round(current.final_output.capital_final - previous.final_output.capital_final, 2),
  };
}

function guardrails(current: UserReport, previous: UserReport): Record<string, boolean> {
  return {
    trust_not_worse: current.final_output.trust_score >= previous.final_output.trust_score,
    clarity_not_worse: current.final_output.clarity_score >= previous.final_output.clarity_score,
    stability_not_worse: current.final_output.stability_score >= previous.final_output.stability_score,
    follow_rate_not_worse: current.final_output.user_follow_rate >= previous.final_output.user_follow_rate,
    panic_not_worse: current.final_output.panic_events <= previous.final_output.panic_events,
    capital_not_worse_over_3pct: current.final_output.capital_final >= previous.final_output.capital_final * 0.97,
  };
}

function allPass(values: Record<string, boolean>): boolean {
  return Object.values(values).every(Boolean);
}

function main(): void {
  mkdirSync(BUSINESS_DIR, { recursive: true });
  mkdirSync(LEARNING_DIR, { recursive: true });
  mkdirSync(RUNTIME_LEARNING_DIR, { recursive: true });

  const baseline = runUser("none");
  writeFileSync(join(BUSINESS_DIR, "nyra_real_user_simulation_cycle_0.json"), `${JSON.stringify(baseline, null, 2)}\n`);
  let previous = baseline;
  const cycles = [];
  for (let cycle = 1; cycle <= 5; cycle += 1) {
    const candidates = POLICIES.map((policy) => {
      const report = runUser(policy);
      const g = guardrails(report, previous);
      return { policy, output: report.final_output, metrics: report.metrics, deltas: deltas(report, previous), guardrails: g, accepted: allPass(g), score: round(score(report), 4) };
    });
    const selected = candidates.filter((candidate) => candidate.accepted).sort((a, b) => b.score - a.score)[0];
    const selectedPolicy = selected?.policy ?? "none";
    const result = runUser(selectedPolicy);
    writeFileSync(join(BUSINESS_DIR, `nyra_real_user_simulation_cycle_${cycle}.json`), `${JSON.stringify(result, null, 2)}\n`);
    cycles.push({ cycle, selected_policy: selectedPolicy, selected, result_output: result.final_output, candidates });
    previous = result;
  }

  const final = previous;
  const report = {
    generated_at: new Date().toISOString(),
    runner: "nyra_real_user_learning_autopilot",
    mode: "five_cycle_user_sandbox_learning",
    stable_runtime_modified: false,
    baseline: baseline.final_output,
    cycles,
    final_output: {
      baseline_verdict: baseline.final_output.verdict,
      final_verdict: final.final_output.verdict,
      trust_delta: round(final.final_output.trust_score - baseline.final_output.trust_score, 4),
      clarity_delta: round(final.final_output.clarity_score - baseline.final_output.clarity_score, 4),
      stability_delta: round(final.final_output.stability_score - baseline.final_output.stability_score, 4),
      follow_rate_delta: round(final.final_output.user_follow_rate - baseline.final_output.user_follow_rate, 4),
      panic_delta: final.final_output.panic_events - baseline.final_output.panic_events,
      capital_delta: round(final.final_output.capital_final - baseline.final_output.capital_final, 2),
      final: final.final_output,
      promoted_to_stable: false,
    },
  };
  const pack = {
    version: "nyra_real_user_learning_autopilot_pack_v1",
    generated_at: report.generated_at,
    selected_policies: cycles.map((cycle) => cycle.selected_policy),
    final_output: report.final_output,
    promotion_status: "not_promoted_to_runtime",
    boundaries: ["sandbox only", "stable unchanged", "requires regression gate before promotion"],
  };
  writeFileSync(OUTPUT_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUTPUT_PACK_PATH, `${JSON.stringify(pack, null, 2)}\n`);
  console.log(JSON.stringify({ report_path: OUTPUT_REPORT_PATH, pack_path: OUTPUT_PACK_PATH, final_output: report.final_output }, null, 2));
}

main();

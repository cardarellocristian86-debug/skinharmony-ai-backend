import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type ProductReadinessReport = {
  metrics?: {
    qqq?: { return_pct?: number };
    nyra?: {
      return_pct?: number;
      fees?: number;
      annual_turnover_pct?: number;
    };
  };
  phase_behavior?: {
    bull?: { avg_cash_pct?: number };
    recovery?: { avg_cash_pct?: number };
  };
  scoring?: {
    total_score?: number;
  };
  final_output?: {
    verdict?: string;
  };
};

export type SelectorAutowritePolicy = {
  version: "nyra_selector_autowrite_policy_v1";
  generated_at: string;
  active: boolean;
  stance: "conservative" | "measured_release";
  source_reports: string[];
  notes: string[];
  params: {
    upgrade_threshold_delta: number;
    downgrade_threshold_delta: number;
    breakout_qqq1m_delta: number;
    breakout_spy1m_delta: number;
    breakout_policy_floor_delta: number;
    recovery_break_max_delta: number;
    recovery_regime_max_delta: number;
    min_expected_edge_multiplier: number;
    partial_rebalance_amount_delta: number;
  };
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const REPORT_DIR = join(ROOT, "reports", "universal-core", "financial-core-test");
const PRODUCT_READINESS_PATH = join(REPORT_DIR, "nyra_product_readiness_latest.json");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_selector_autowrite_policy_latest.json");

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function buildSelectorAutowritePolicy(): SelectorAutowritePolicy {
  const notes: string[] = [];
  const sourceReports: string[] = [];
  const readiness = existsSync(PRODUCT_READINESS_PATH)
    ? loadJson<ProductReadinessReport>(PRODUCT_READINESS_PATH)
    : undefined;

  if (readiness) sourceReports.push(PRODUCT_READINESS_PATH);

  const nyraReturn = readiness?.metrics?.nyra?.return_pct ?? 0;
  const qqqReturn = readiness?.metrics?.qqq?.return_pct ?? 0;
  const fees = readiness?.metrics?.nyra?.fees ?? 0;
  const turnover = readiness?.metrics?.nyra?.annual_turnover_pct ?? 0;
  const recoveryCash = readiness?.phase_behavior?.recovery?.avg_cash_pct ?? 0;
  const bullCash = readiness?.phase_behavior?.bull?.avg_cash_pct ?? 0;
  const totalScore = readiness?.scoring?.total_score ?? 0;

  const upsideGap = qqqReturn > 0 ? Math.max(0, (qqqReturn - nyraReturn) / qqqReturn) : 0;
  const feeStress = clamp(fees / 10000, 0, 1);
  const turnoverStress = clamp(turnover / 220, 0, 1);
  const recoveryCashStress = clamp((recoveryCash - 18) / 18, 0, 1);
  const scoreStress = clamp((50 - totalScore) / 20, 0, 1);
  const releasePressure = Number(
    (0.34 * upsideGap + 0.22 * feeStress + 0.18 * turnoverStress + 0.16 * recoveryCashStress + 0.1 * scoreStress).toFixed(6),
  );

  const active = releasePressure >= 0.18;
  if (active) notes.push("selector troppo prudente in bull/recovery: attiva release misurata");
  if (recoveryCash > bullCash) notes.push("recovery cash piu alta del bull: rientro troppo lento");
  if (turnover > 150) notes.push("turnover alto: serve release piu intelligente, non piu rumore");

  return {
    version: "nyra_selector_autowrite_policy_v1",
    generated_at: new Date().toISOString(),
    active,
    stance: active ? "measured_release" : "conservative",
    source_reports: sourceReports,
    notes,
    params: {
      upgrade_threshold_delta: active ? Number((-0.08 - releasePressure * 0.04).toFixed(6)) : 0,
      downgrade_threshold_delta: active ? Number((0.06 + releasePressure * 0.03).toFixed(6)) : 0,
      breakout_qqq1m_delta: active ? Number((-0.18 - releasePressure * 0.08).toFixed(6)) : 0,
      breakout_spy1m_delta: active ? Number((-0.1 - releasePressure * 0.05).toFixed(6)) : 0,
      breakout_policy_floor_delta: active ? Number((-0.08 - releasePressure * 0.04).toFixed(6)) : 0,
      recovery_break_max_delta: active ? Number((0.03 + releasePressure * 0.03).toFixed(6)) : 0,
      recovery_regime_max_delta: active ? Number((0.025 + releasePressure * 0.025).toFixed(6)) : 0,
      min_expected_edge_multiplier: active ? Number((0.78 - releasePressure * 0.1).toFixed(6)) : 1,
      partial_rebalance_amount_delta: active ? Number((0.12 + releasePressure * 0.06).toFixed(6)) : 0,
    },
  };
}

export function writeSelectorAutowritePolicy(): SelectorAutowritePolicy {
  const policy = buildSelectorAutowritePolicy();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(policy, null, 2));
  return policy;
}

if (process.argv[1]?.endsWith("nyra-selector-autowrite.ts")) {
  const policy = writeSelectorAutowritePolicy();
  console.log(JSON.stringify({
    ok: true,
    output_path: OUTPUT_PATH,
    active: policy.active,
    stance: policy.stance,
    params: policy.params,
  }, null, 2));
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type LiveFeedback = {
  totalCycles?: number;
  selectedCycles?: number;
  noTradeRatio?: number;
  winRate?: number;
  lossRate?: number;
  avgSelectedPnlPct?: number;
  netPnlEur?: number;
  maxDrawdownPct?: number;
  maxLossStreak?: number;
  assetStats?: Array<{
    product: string;
    selectedCount: number;
    pnlEur: number;
    avgSpreadBps: number;
  }>;
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const FEEDBACK_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_financial_live_feedback_latest.json");
const OUTPUT_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_financial_realtime_autoimprovement_latest.json");

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function main(): void {
  const feedback = readJson<LiveFeedback>(FEEDBACK_PATH, {});
  const assetStats = Array.isArray(feedback.assetStats) ? feedback.assetStats : [];
  const lossRate = Number(feedback.lossRate || 0);
  const winRate = Number(feedback.winRate || 0);
  const avgPnlPct = Number(feedback.avgSelectedPnlPct || 0);
  const maxLossStreak = Number(feedback.maxLossStreak || 0);
  const noTradeRatio = Number(feedback.noTradeRatio || 0);
  const maxDrawdownPct = Number(feedback.maxDrawdownPct || 0);
  const negativeAssets = assetStats
    .filter((asset) => Number(asset.selectedCount || 0) >= 2 && Number(asset.pnlEur || 0) < 0)
    .map((asset) => asset.product);
  const positiveAssets = assetStats
    .filter((asset) => Number(asset.selectedCount || 0) >= 2 && Number(asset.pnlEur || 0) > 0 && Number(asset.avgSpreadBps || 0) < 3)
    .map((asset) => asset.product);
  const expensiveAssets = assetStats
    .filter((asset) => Number(asset.avgSpreadBps || 0) > 8)
    .map((asset) => asset.product);
  const protective = lossRate >= 0.55 || avgPnlPct < 0 || maxLossStreak >= 3 || maxDrawdownPct > 0.12;
  const severeProtection = maxDrawdownPct > 3 || maxLossStreak >= 20 || (lossRate >= 0.85 && avgPnlPct < -0.35);
  const recoveryMicroMode = protective && !severeProtection;
  const release = noTradeRatio >= 0.6 && winRate >= 0.55 && avgPnlPct > 0 && maxLossStreak <= 1;
  const selectedPolicy = recoveryMicroMode
    ? "live_recovery_micro_trade_v1"
    : protective
    ? "live_loss_streak_drawdown_guard_v1"
    : release
      ? "live_empirical_release_v1"
      : "live_observe_v1";
  const payload = {
    version: "nyra_financial_realtime_autoimprovement_v1",
    generatedAt: new Date().toISOString(),
    source_feedback: "runtime/nyra-learning/nyra_financial_live_feedback_latest.json",
    stable_runtime_modified: false,
    selected_policy: selectedPolicy,
    learning_state: recoveryMicroMode ? "recovery_micro_learning" : protective ? "protective_learning" : release ? "release_learning" : "observe",
    metrics: {
      totalCycles: Number(feedback.totalCycles || 0),
      selectedCycles: Number(feedback.selectedCycles || 0),
      noTradeRatio,
      winRate,
      lossRate,
      avgSelectedPnlPct: avgPnlPct,
      netPnlEur: Number(feedback.netPnlEur || 0),
      maxDrawdownPct,
      maxLossStreak,
    },
    runtime_adjustments: {
      minStrengthDelta: recoveryMicroMode ? 3 : protective ? 7 : release ? -3 : 0,
      scoreDelta: recoveryMicroMode ? -2 : protective ? -9 : release ? 4 : 0,
      sizeMultiplier: recoveryMicroMode ? 0.32 : protective ? 0.45 : release ? 1.08 : 1,
      allowMicroTrades: recoveryMicroMode,
      recoveryMode: recoveryMicroMode,
      dynamicRiskBudgetMultiplier: recoveryMicroMode ? 0.32 : protective ? 0.45 : release ? 1.08 : 1,
      blockNegativeAssets: severeProtection ? negativeAssets : [],
      watchNegativeAssets: recoveryMicroMode ? negativeAssets : [],
      boostPositiveAssets: positiveAssets,
      penalizeExpensiveAssets: expensiveAssets,
      notes: [
        recoveryMicroMode ? "recovery micro-mode active: drawdown riduce budget ma non azzera scelta" : protective ? "loss/drawdown guard active" : release ? "empirical release active" : "observe without policy shift",
        negativeAssets.length ? `${severeProtection ? "negative assets blocked" : "negative assets watched"}: ${negativeAssets.join(", ")}` : "no repeated negative asset block",
        positiveAssets.length ? `positive low-spread assets: ${positiveAssets.join(", ")}` : "no positive low-spread boost",
        expensiveAssets.length ? `expensive spread assets: ${expensiveAssets.join(", ")}` : "no expensive spread penalty",
      ],
    },
    promotion_status: "runtime_live_feedback_only",
  };
  writeJson(OUTPUT_PATH, payload);
  console.log(JSON.stringify({ output_path: OUTPUT_PATH, selected_policy: payload.selected_policy, learning_state: payload.learning_state, runtime_adjustments: payload.runtime_adjustments }, null, 2));
}

main();

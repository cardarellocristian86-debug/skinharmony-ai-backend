import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  chooseNyraManagedAllocation,
  type NyraAutoDriveProfile,
  type NyraManualProfileLevel,
  type NyraProfileControlMode,
} from "./nyra-auto-profile-selector.ts";

type AssetSymbol = "SPY" | "QQQ" | "BTC" | "GLD" | "TLT" | "CASH";
type Allocation = Record<AssetSymbol, number>;
type HistoryMap = Record<AssetSymbol, number[]>;

type FinanceHistoryAsset = {
  product?: string;
  status?: string;
  side?: string;
  adjustedScore?: number;
  notes?: string[];
  pnlEur?: number;
  pnlPct?: number;
  weightPct?: number;
  spreadBps?: number;
};

type FinanceHistoryRow = {
  id?: string;
  generatedAt?: string;
  capitalEur?: number;
  selectedPositions?: number;
  totalPnlEur?: number;
  avgPnlPct?: number;
  blockedCount?: number;
  watchCount?: number;
  noTradeCount?: number;
  topCandidate?: {
    product?: string;
    status?: string;
    side?: string;
    adjustedScore?: number;
    action?: string;
    scenario?: string;
    notes?: string[];
  } | null;
  assets?: FinanceHistoryAsset[];
};

type FinancialLiveFeedback = {
  totalCycles?: number;
  selectedCycles?: number;
  noTradeCycles?: number;
  selectedCycleRatio?: number;
  noTradeRatio?: number;
  winRate?: number;
  lossRate?: number;
  avgSelectedPnlPct?: number;
  avgSelectedPnlEur?: number;
  netPnlEur?: number;
  maxDrawdownEur?: number;
  maxDrawdownPct?: number;
  maxLossStreak?: number;
};

type ProfileConfig = {
  mode: NyraProfileControlMode;
  manualProfile: NyraAutoDriveProfile;
  currentProfile: NyraAutoDriveProfile;
  currentGear: number;
  previousAutoProfile: NyraAutoDriveProfile | null;
  allocation: Allocation | null;
  lastUpdatedAt: string;
  warning: SelectorWarning | null;
};

type ProfileHistoryRow = {
  timestamp: string;
  modeFrom: NyraProfileControlMode | null;
  modeTo: NyraProfileControlMode;
  fromProfile: NyraAutoDriveProfile | null;
  toProfile: NyraAutoDriveProfile;
  fromGear: number | null;
  toGear: number;
  reason: string;
  selectorReason: string;
};

type SelectorWarning = {
  kind: "accelerate" | "brake";
  currentProfile: NyraAutoDriveProfile;
  recommendedProfile: NyraAutoDriveProfile;
  currentGear: number;
  recommendedGear: number;
  message: string;
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const HISTORY_PATH = join(ROOT, "personal-control-center", "data", "nyra-finance-history.json");
const FEEDBACK_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_financial_live_feedback_latest.json");
const PROFILE_PATH = join(ROOT, "personal-control-center", "data", "nyra-finance-profile.json");
const PROFILE_HISTORY_PATH = join(ROOT, "personal-control-center", "data", "nyra-finance-profile-history.json");
const LIVE_REPORT_PATH = join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_live_portfolio_trade_latest.json");

function readJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, payload: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function toGear(profile: NyraAutoDriveProfile): number {
  switch (profile) {
    case "capital_protection":
      return 1;
    case "balanced_growth":
      return 2;
    case "aggressive_growth":
      return 3;
    case "hard_growth":
      return 4;
    case "overdrive_5_auto_only":
      return 5;
    case "overdrive_6_auto_only":
      return 6;
    case "overdrive_7_auto_only":
      return 7;
  }
}

function toManualLevel(profile: NyraAutoDriveProfile): NyraManualProfileLevel {
  switch (profile) {
    case "capital_protection":
      return 1;
    case "balanced_growth":
      return 2;
    case "aggressive_growth":
      return 3;
    default:
      return 4;
  }
}

function sanitizeManualProfile(profile: string | undefined): NyraAutoDriveProfile {
  if (
    profile === "capital_protection" ||
    profile === "balanced_growth" ||
    profile === "aggressive_growth" ||
    profile === "hard_growth"
  ) {
    return profile;
  }
  return "hard_growth";
}

function buildHistoryMap(rows: FinanceHistoryRow[]): HistoryMap {
  const recent = rows.slice(-24);
  const map: HistoryMap = {
    SPY: [],
    QQQ: [],
    BTC: [],
    GLD: [],
    TLT: [],
    CASH: [],
  };

  for (const row of recent) {
    const assets = Array.isArray(row.assets) ? row.assets : [];
    const pnlRate = Number(row.capitalEur || 0) > 0
      ? (Number(row.totalPnlEur || 0) / Number(row.capitalEur || 0)) * 100
      : 0;
    const adjustedScores = assets.map((asset) => Number(asset.adjustedScore || 0));
    const marketScore = average(adjustedScores);
    const selectedCount = Number(row.selectedPositions || 0);
    const blockedCount = Number(row.blockedCount || 0);
    const watchCount = Number(row.watchCount || 0);
    const noTradeCount = Number(row.noTradeCount || 0);
    const btcAsset = assets.find((asset) => asset.product === "BTC-EUR");
    const defensivePressure = blockedCount * 0.8 + noTradeCount * 0.5 + (pnlRate < 0 ? Math.abs(pnlRate) * 0.35 : 0);
    const qqqProxy = clamp((marketScore * 0.03) + (pnlRate * 0.8) + (selectedCount * 0.4) - (noTradeCount * 0.18), -8, 8);
    const spyProxy = clamp((qqqProxy * 0.82) - (watchCount * 0.08), -6, 6);
    const btcProxy = clamp(
      (Number(btcAsset?.adjustedScore || 0) * 0.045) +
      (Number(btcAsset?.pnlPct || 0) * 0.55) -
      (Number(btcAsset?.spreadBps || 0) * 0.08),
      -12,
      12,
    );
    const gldProxy = clamp(defensivePressure * 0.65 - qqqProxy * 0.25 + (watchCount * 0.12), -4, 7);
    const tltProxy = clamp(defensivePressure * 0.55 - qqqProxy * 0.18 + (noTradeCount * 0.15), -4, 7);

    map.SPY.push(round(spyProxy));
    map.QQQ.push(round(qqqProxy));
    map.BTC.push(round(btcProxy));
    map.GLD.push(round(gldProxy));
    map.TLT.push(round(tltProxy));
    map.CASH.push(0);
  }

  if (!map.QQQ.length) {
    map.SPY = [0.4, 0.2, 0.1, 0];
    map.QQQ = [0.6, 0.3, 0.15, 0];
    map.BTC = [0.5, 0.2, 0.1, 0];
    map.GLD = [0.2, 0.3, 0.35, 0.4];
    map.TLT = [0.1, 0.15, 0.25, 0.3];
    map.CASH = [0, 0, 0, 0];
  }

  return map;
}

function buildAdvisory(
  rows: FinanceHistoryRow[],
  feedback: FinancialLiveFeedback | null,
  liveReport: Record<string, unknown>,
) {
  const latest = rows.at(-1);
  const assets = Array.isArray(latest?.assets) ? latest.assets : [];
  const topCandidate = latest?.topCandidate;
  const rawDiagnostics = Array.isArray(liveReport?.candidate_diagnostics) ? liveReport.candidate_diagnostics as Array<Record<string, unknown>> : [];
  const riskScore = Number(rawDiagnostics[0]?.risk_score || 0) / 100;
  const avgScore = average(assets.map((asset) => Number(asset.adjustedScore || 0)));
  const positiveAssets = assets.filter((asset) => Number(asset.adjustedScore || 0) > 0).length;
  const blockedRatio = clamp((Number(latest?.blockedCount || 0)) / 4);
  const noTradeRatio = clamp((feedback?.noTradeRatio ?? 0));
  const selectedRatio = clamp((feedback?.selectedCycleRatio ?? 0));
  const drawdown = clamp((feedback?.maxDrawdownPct ?? 0) / 0.25);
  const lossStreak = clamp((feedback?.maxLossStreak ?? 0) / 5);
  const winRate = clamp(feedback?.winRate ?? 0);
  const pnlBias = clamp((Number(feedback?.avgSelectedPnlPct || 0) + 0.4) / 0.8);
  const euphoria = clamp(Math.max(0, avgScore / 120) + positiveAssets * 0.08 + selectedRatio * 0.18);
  const deterioration = clamp(drawdown * 0.42 + lossStreak * 0.28 + Math.max(0, -avgScore) / 90 + blockedRatio * 0.14);
  const breakLevel = clamp(riskScore * 0.5 + noTradeRatio * 0.2 + blockedRatio * 0.15 + (String(topCandidate?.status || "") === "blocked" ? 0.12 : 0));
  const regime = clamp(noTradeRatio * 0.45 + blockedRatio * 0.2 + (String(topCandidate?.scenario || "").includes("compression") ? 0.18 : 0));
  const policy = clamp(0.52 + winRate * 0.18 + pnlBias * 0.08 - deterioration * 0.15);
  const notes: string[] = [];

  if (avgScore > 28) notes.push("Impulso candidato in aumento.");
  if (blockedRatio > 0.4) notes.push("Troppi blocchi recenti: serve disciplina.");
  if (noTradeRatio > 0.55) notes.push("Molti cicli senza edge: evita di forzare.");
  if (drawdown > 0.35) notes.push("Drawdown recente: protezione ancora necessaria.");
  if (String(topCandidate?.status || "") === "selected") notes.push("Nyra vede almeno un candidato investibile.");
  if (!notes.length) notes.push("Contesto in lettura senza pressione dominante.");

  let alert: "watch" | "high" | "critical" = "watch";
  let intensity: "low" | "moderate" | "high" = "low";
  let message = "Contesto leggibile ma non ancora libero.";
  let strategy = "Muovi il rischio solo se il profilo lo consente.";
  let baseline_state: "healthy" | "watch" | "deteriorating" = "watch";

  if (deterioration >= 0.68 || breakLevel >= 0.55) {
    alert = "critical";
    intensity = "high";
    message = "Deterioramento forte o rottura in corso.";
    strategy = "Frena e proteggi capitale finche l'edge non torna pulito.";
    baseline_state = "deteriorating";
  } else if (deterioration >= 0.42 || regime >= 0.45) {
    alert = "high";
    intensity = "moderate";
    message = "Mercato instabile o senza conferma pulita.";
    strategy = "Riduci aggressivita e aspetta conferme migliori.";
    baseline_state = "watch";
  } else if (euphoria >= 0.55 && winRate >= 0.45) {
    alert = "watch";
    intensity = "low";
    message = "Il contesto regge e puo sostenere piu marcia.";
    strategy = "Consenti accelerazione solo se i costi non mangiano l'edge.";
    baseline_state = "healthy";
  }

  return {
    euphoria: round(euphoria),
    deterioration: round(deterioration),
    break: round(breakLevel),
    regime: round(regime),
    policy: round(policy),
    baseline_state,
    notes,
    output: {
      alert,
      message,
      strategy,
      intensity,
    },
  };
}

function loadProfileHistory(): ProfileHistoryRow[] {
  const payload = readJson<{ entries?: ProfileHistoryRow[] }>(PROFILE_HISTORY_PATH, { entries: [] });
  return Array.isArray(payload.entries) ? payload.entries : [];
}

function saveProfileHistory(entries: ProfileHistoryRow[]): void {
  writeJson(PROFILE_HISTORY_PATH, {
    entries: entries.slice(-240),
  });
}

function compareProfiles(current: NyraAutoDriveProfile, recommended: NyraAutoDriveProfile): SelectorWarning | null {
  const currentGear = toGear(current);
  const recommendedGear = toGear(recommended);
  if (currentGear === recommendedGear) return null;
  const kind = recommendedGear > currentGear ? "accelerate" : "brake";
  return {
    kind,
    currentProfile: current,
    recommendedProfile: recommended,
    currentGear,
    recommendedGear,
    message:
      kind === "accelerate"
        ? `Nyra vede spazio per accelerare dalla marcia ${currentGear} alla ${recommendedGear}.`
        : `Nyra vede bisogno di frenare dalla marcia ${currentGear} alla ${recommendedGear}.`,
  };
}

function parseArg(name: string, fallback = ""): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function main() {
  const requestedMode = (parseArg("--mode", "") || "") as NyraProfileControlMode;
  const requestedManualProfile = parseArg("--manual-profile", "");
  const historyPayload = readJson<{ entries?: FinanceHistoryRow[] }>(HISTORY_PATH, { entries: [] });
  const feedback = readJson<FinancialLiveFeedback | null>(FEEDBACK_PATH, null);
  const liveReport = readJson<Record<string, unknown>>(LIVE_REPORT_PATH, {});
  const stored = readJson<Partial<ProfileConfig>>(PROFILE_PATH, {});
  const rows = Array.isArray(historyPayload.entries) ? historyPayload.entries : [];
  const mode: NyraProfileControlMode = requestedMode === "manual" || requestedMode === "auto"
    ? requestedMode
    : (stored.mode === "manual" || stored.mode === "auto" ? stored.mode : "auto");
  const manualProfile = sanitizeManualProfile(requestedManualProfile || String(stored.manualProfile || ""));
  const history = buildHistoryMap(rows);
  const advisory = buildAdvisory(rows, feedback, liveReport);
  const previousAllocation = stored.allocation ?? null;
  const previousAutoProfile = stored.previousAutoProfile ?? stored.currentProfile ?? "capital_protection";

  const autoDecision = chooseNyraManagedAllocation(
    "auto",
    advisory,
    previousAllocation,
    history,
    {
      previousAutoProfile,
      capitalContext: {
        initialCapital: Number(rows[0]?.capitalEur || 100000),
        currentCapital: Number(rows.at(-1)?.capitalEur || 100000) + Number(rows.at(-1)?.totalPnlEur || 0),
      },
    },
  );

  const decision = mode === "auto"
    ? autoDecision
    : chooseNyraManagedAllocation(
        "manual",
        advisory,
        previousAllocation,
        history,
        {
          manualLevel: toManualLevel(manualProfile),
          previousAutoProfile,
          capitalContext: {
            initialCapital: Number(rows[0]?.capitalEur || 100000),
            currentCapital: Number(rows.at(-1)?.capitalEur || 100000) + Number(rows.at(-1)?.totalPnlEur || 0),
          },
        },
      );

  const currentProfile = decision.selector.profile;
  const currentGear = toGear(currentProfile);
  const warning = mode === "manual" ? compareProfiles(currentProfile, autoDecision.selector.profile) : null;
  const riskyWeight = round(decision.allocation.SPY + decision.allocation.QQQ + decision.allocation.BTC, 6);
  const previousProfile = stored.currentProfile ?? null;
  const previousMode = stored.mode ?? null;
  const previousGear = stored.currentGear ?? (previousProfile ? toGear(previousProfile) : null);
  const nextConfig: ProfileConfig = {
    mode,
    manualProfile,
    currentProfile,
    currentGear,
    previousAutoProfile: mode === "auto" ? currentProfile : autoDecision.selector.profile,
    allocation: decision.allocation,
    lastUpdatedAt: new Date().toISOString(),
    warning,
  };

  writeJson(PROFILE_PATH, nextConfig);

  if (previousProfile !== currentProfile || previousMode !== mode) {
    const historyRows = loadProfileHistory();
    historyRows.push({
      timestamp: new Date().toISOString(),
      modeFrom: previousMode,
      modeTo: mode,
      fromProfile: previousProfile,
      toProfile: currentProfile,
      fromGear: previousGear,
      toGear: currentGear,
      reason: decision.reason,
      selectorReason: decision.selector.reason,
    });
    saveProfileHistory(historyRows);
  }

  console.log(JSON.stringify({
    ok: true,
    mode,
    manualProfile,
    currentProfile,
    currentGear,
    allocation: decision.allocation,
    riskyWeight,
    cashWeight: round(decision.allocation.CASH, 6),
    reason: decision.reason,
    selectorReason: decision.selector.reason,
    advisory,
    autoRecommendation: {
      profile: autoDecision.selector.profile,
      gear: toGear(autoDecision.selector.profile),
      reason: autoDecision.reason,
    },
    warning,
    profileHistory: loadProfileHistory(),
    profileOptions: [
      { profile: "capital_protection", gear: 1, label: "Capital protection" },
      { profile: "balanced_growth", gear: 2, label: "Balanced growth" },
      { profile: "aggressive_growth", gear: 3, label: "Aggressive growth" },
      { profile: "hard_growth", gear: 4, label: "Hard growth" },
      { profile: "overdrive_5_auto_only", gear: 5, label: "Overdrive 5" },
      { profile: "overdrive_6_auto_only", gear: 6, label: "Overdrive 6" },
      { profile: "overdrive_7_auto_only", gear: 7, label: "Overdrive 7" },
    ],
  }, null, 2));
}

main();

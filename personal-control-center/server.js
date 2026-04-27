const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const express = require("express");
const { loadEnv } = require("../mail/load_env");
const { googleApiRequest } = require("../google_api");

const rootDir = path.resolve(__dirname, "..");
const app = express();
const port = Number(process.env.PORT || process.env.CONTROL_CENTER_PORT || 3025);
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const nyraStorageRoot = process.env.NYRA_STORAGE_ROOT ? path.resolve(process.env.NYRA_STORAGE_ROOT) : "";
const controlDataPath = "personal-control-center/data/marketing-data.json";
const nyraFinanceHistoryPath = "personal-control-center/data/nyra-finance-history.json";
const nyraFinanceFeedbackPath = "runtime/nyra-learning/nyra_financial_live_feedback_latest.json";
const nyraFinanceRealtimeAutoimprovePath = "runtime/nyra-learning/nyra_financial_realtime_autoimprovement_latest.json";
const nyraWorldMarketScanPath = "runtime/nyra-learning/nyra_world_market_scan_latest.json";
const nyraWorldMarketSelectionPath = "personal-control-center/data/nyra-world-market-selection.json";
const nyraWorldPaperPortfolioPath = "personal-control-center/data/nyra-world-paper-portfolio.json";
const nyraWorldMarketStudyPath = "universal-core/runtime/nyra-learning/nyra_world_market_study_latest.json";
const nyraWorldPaperAutoStatePath = "personal-control-center/data/nyra-world-paper-auto-state.json";
const nyraWorldPaperLearningPath = "universal-core/runtime/nyra-learning/nyra_world_paper_auto_learning_latest.json";
const nyraWorldAssetHistoryStudyPath = "universal-core/runtime/nyra-learning/nyra_world_asset_history_study_latest.json";
const nyraWorldThesisLearningMassivePath = "universal-core/runtime/nyra-learning/nyra_world_thesis_learning_massive_latest.json";
const nyraRenderAutopilotRuntimePath = "universal-core/runtime/nyra-learning/nyra_render_autopilot_latest.json";
const nyraRenderAutopilotReportPath = "reports/universal-core/nyra-learning/nyra_render_autopilot_latest.json";
const nyraFinanceProfilePath = "personal-control-center/data/nyra-finance-profile.json";
const leadStatuses = ["nuovo", "contattato", "risposto", "interessato", "trattativa", "cliente", "perso"];
const NYRA_FINANCE_SHARED_CAPITAL_EUR = Number(process.env.NYRA_FINANCE_SHARED_CAPITAL_EUR || 100000);

loadEnv();

app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "skinharmony-nyra-core" });
});

function nyraPersistentPath(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  return (
    normalized.startsWith("personal-control-center/data/nyra-") ||
    normalized.startsWith("runtime/nyra-learning/nyra_") ||
    normalized.startsWith("universal-core/runtime/nyra/") ||
    normalized.startsWith("universal-core/runtime/nyra-learning/nyra_") ||
    normalized.startsWith("universal-core/data/world-market") ||
    normalized.startsWith("reports/universal-core/")
  );
}

function resolveStoragePath(relativePath) {
  if (nyraStorageRoot && nyraPersistentPath(relativePath)) {
    return path.join(nyraStorageRoot, relativePath);
  }
  return path.join(rootDir, relativePath);
}

app.use((req, res, next) => {
  if (req.path === "/healthz") {
    next();
    return;
  }
  const authEnabled = ["1", "true", "yes", "on"].includes(String(process.env.NYRA_ENABLE_BASIC_AUTH || "").trim().toLowerCase());
  const authDisabled = ["1", "true", "yes", "on"].includes(String(process.env.NYRA_DISABLE_BASIC_AUTH || "").trim().toLowerCase());
  if (!authEnabled || authDisabled) {
    next();
    return;
  }
  const expectedUser = String(process.env.NYRA_BASIC_USER || "").trim();
  const expectedPassword = String(process.env.NYRA_BASIC_PASSWORD || "").trim();
  if (!expectedUser || !expectedPassword) {
    next();
    return;
  }
  const header = String(req.headers.authorization || "");
  const expected = basicAuth(expectedUser, expectedPassword);
  if (header === expected) {
    next();
    return;
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="Nyra"');
  res.status(401).send("Authentication required");
});

app.use(express.static(path.join(__dirname, "public")));

function readJson(relativePath, fallback = null) {
  const filePath = resolveStoragePath(relativePath);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(relativePath, fallback = "") {
  const filePath = resolveStoragePath(relativePath);
  if (!fs.existsSync(filePath)) return fallback;
  return fs.readFileSync(filePath, "utf8");
}

function seedNyraRuntimeFromBootstrap() {
  if (!nyraStorageRoot) return;
  const bootstrapRoot = path.join(__dirname, "bootstrap", "nyra-runtime");
  if (!fs.existsSync(bootstrapRoot)) return;
  const copyMissing = (sourceDir, targetDir) => {
    if (!fs.existsSync(sourceDir)) return;
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        copyMissing(sourcePath, targetPath);
        continue;
      }
      if (fs.existsSync(targetPath)) continue;
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  };
  copyMissing(bootstrapRoot, nyraStorageRoot);
}

function runNodeJson(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Processo Nyra scaduto."));
    }, Number(options.timeoutMs || 12000));

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Processo chiuso con codice ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Risposta JSON non valida: ${stdout.slice(0, 300)}`));
      }
    });
  });
}

function chooseNyraSuit(text = "") {
  const normalized = String(text || "").toLowerCase();
  if (/(comando|esegui|azione|subito|task|lavorare|assistente)/.test(normalized)) {
    return {
      id: "operator",
      label: "Operator",
      reason: "Serve una vista asciutta: comando, stato, conferma."
    };
  }
  if (/(capire|parla|fatti capire|semplice|poesie|confusione)/.test(normalized)) {
    return {
      id: "clear",
      label: "Clear",
      reason: "Serve massima leggibilita: punto, mossa, limite."
    };
  }
  if (/(proteg|owner|dio|privat|personale|decisione)/.test(normalized)) {
    return {
      id: "sovereign",
      label: "Sovereign",
      reason: "Serve un assetto owner-first, piu raccolto e controllato."
    };
  }
  return {
    id: "focus",
    label: "Focus",
    reason: "Assetto bilanciato per dialogo e lavoro quotidiano."
  };
}

function readLatestNyraFinanceSnapshot() {
  const baseDir = path.join(rootDir, "reports/universal-core/financial-core-test");
  const candidates = [
    "nyra_product_readiness_latest.json",
    "nyra_bubble_detection_latest.json",
    "nyra_lateral_market_latest.json"
  ];
  const payload = {};
  candidates.forEach((name) => {
    const filePath = path.join(baseDir, name);
    if (fs.existsSync(filePath)) {
      payload[name] = JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  });
  return payload;
}

function buildNyraFinanceCard() {
  const snapshots = readLatestNyraFinanceSnapshot();
  const readiness = snapshots["nyra_product_readiness_latest.json"] || {};
  const bubble = snapshots["nyra_bubble_detection_latest.json"] || {};
  const lateral = snapshots["nyra_lateral_market_latest.json"] || {};

  const verdict = String(readiness.final_output?.verdict || "in lettura");
  const totalScore = Number(readiness.scoring?.total_score || 0);
  const avgRisk = Number(readiness.metrics?.nyra?.avg_risk_pct || 0);
  const cashPct = Number(readiness.metrics?.nyra?.time_in_cash_pct || 0);
  const protection = Number(bubble.metrics?.drawdown_avoided_vs_qqq || 0);
  const lateralStability = Number(lateral.metrics?.max_drawdown_nyra_pct || 0);

  const risk = avgRisk >= 82 ? "Medio" : avgRisk >= 68 ? "Basso" : "Medio";
  const state = verdict === "vendibile con warning"
    ? "Vendibile con warning"
    : verdict
      ? verdict.charAt(0).toUpperCase() + verdict.slice(1)
      : "In lettura";
  const action = verdict === "vendibile con warning"
    ? "Mantieni disciplina e chiudi i warning"
    : "Continua validazione";
  const reason = [
    `Score ${totalScore.toFixed(1)}/60.`,
    `Protezione drawdown ${protection.toFixed(1)} punti contro QQQ.`,
    `Cash medio ${cashPct.toFixed(1)}%.`
  ].join(" ");

  const phaseBehavior = readiness.phase_behavior || {};
  const history = Object.entries(phaseBehavior)
    .slice(0, 3)
    .map(([phase, value]) => {
      const riskPct = Number(value?.avg_risk_pct || 0).toFixed(1);
      return `${phase.replaceAll("_", " ")} · Risk ${riskPct}%`;
    });

  return {
    source: "universal-core",
    sourceLabel: "Nyra reports",
    generatedAt: readiness.generated_at || bubble.generated_at || lateral.generated_at || new Date().toISOString(),
    label: "Finanza",
    icon: "LN",
    state,
    level: `${Math.round(avgRisk / 12) || 0} · Risk ${avgRisk.toFixed(1)}%`,
    risk,
    action,
    reason,
    primaryMetric: "Score prodotto",
    primaryValue: `${totalScore.toFixed(1)}/60`,
    secondaryMetric: "Cash medio",
    secondaryValue: `${cashPct.toFixed(1)}%`,
    allocation: [
      ["Risk medio", `${avgRisk.toFixed(1)}%`],
      ["Cash medio", `${cashPct.toFixed(1)}%`],
      ["Protezione", `${protection.toFixed(1)} pt`],
      ["Laterale max DD", `${lateralStability.toFixed(1)}%`]
    ],
    signals: [
      `Verdict: ${state}`,
      `Bubble test: ${bubble.verdict || "n.d."}`,
      `Lateral beats QQQ: ${lateral.metrics?.beats_qqq ? "si" : "no"}`,
      `Trust score: ${Number(readiness.customer_checks?.trust?.score || 0).toFixed(1)}`
    ],
    history,
    bars: [28, 36, 34, 45, 52, 48, 58, 66, 61, 75, 72, Math.max(10, Math.min(95, Math.round(avgRisk)))]
  };
}

function buildNyraFinanceLiveCard(report = {}) {
  const aggregate = report.aggregate || {};
  const exits = Array.isArray(report.exits) ? report.exits : [];
  const monitoring = Array.isArray(report.monitoring) ? report.monitoring : [];
  const diagnostics = Array.isArray(report.candidate_diagnostics) ? report.candidate_diagnostics : [];
  const totalPnl = Number(aggregate.total_pnl_eur || 0);
  const avgPnlPct = Number(aggregate.avg_pnl_pct || 0);
  const selected = Number(aggregate.selected_positions || 0);
  const profitable = Number(aggregate.profitable_positions || 0);
  const lastMonitor = monitoring[monitoring.length - 1] || {};
  const firstExit = exits[0] || {};
  const topCandidate = diagnostics[0] || null;
  const feeBpsEachSide = Number(report.fee_bps_each_side || 0);
  const roundTripFeeBps = feeBpsEachSide * 2;
  const topSpreadBps = Number(topCandidate?.spread_bps || 0);
  const estimatedCostBps = roundMetric(roundTripFeeBps + topSpreadBps, 4);
  const topWeightPct = topCandidate?.status === "selected"
    ? Number(report.portfolio?.find?.((row) => row.product === topCandidate.product)?.weight_pct || 0)
    : 100;
  const costBaseCapital = Number(report.capital_eur || 0) * (topWeightPct / 100 || 1);
  const estimatedRoundTripCostEur = roundMetric(costBaseCapital * (estimatedCostBps / 10_000), 6);
  const risk = totalPnl < 0 ? "Medio" : "Basso";
  const state = selected > 0
    ? "Monitor live attivo"
    : topCandidate
      ? `${topCandidate.product} · ${topCandidate.status}`
      : "Nessuna posizione forte";
  const action = selected > 0
    ? `Segui ${selected} posizioni e verifica il close`
    : topCandidate
      ? topCandidate.status === "watch"
        ? `${topCandidate.product} ${topCandidate.side} da confermare`
        : topCandidate.status === "blocked"
          ? `${topCandidate.product} bloccato: resta in attesa`
          : "Nessuna esecuzione: attendi edge reale"
      : "Nessuna esecuzione: attendi edge reale";
  const reason = selected > 0
    ? `PnL totale ${totalPnl.toFixed(2)} EUR, media ${avgPnlPct.toFixed(2)}%. Fonte web pubblica ${report.source || "n.d."}.`
    : topCandidate
      ? `${topCandidate.product} ${topCandidate.financial_action} con score ${Number(topCandidate.adjusted_score || 0).toFixed(2)}. Note: ${(topCandidate.notes || []).join(", ") || "nessuna"}.`
      : "Il selettore non ha trovato abbastanza edge per aprire un portafoglio corto di test.";

  return {
    source: "web-live",
    sourceLabel: "Nyra live web",
    generatedAt: report.generated_at || new Date().toISOString(),
    label: "Finanza",
    icon: "LN",
    state,
    level: `${selected} posizioni · ${report.duration_seconds || 0}s`,
    risk,
    action,
    reason,
    primaryMetric: "PnL totale",
    primaryValue: `${totalPnl.toFixed(2)} EUR`,
    secondaryMetric: "PnL medio",
    secondaryValue: `${avgPnlPct.toFixed(2)}%`,
    allocation: [
      ["Posizioni", String(selected)],
      ["Profittevoli", String(profitable)],
      ["Source", String(report.source || "n.d.")],
      ["Top candidate", topCandidate ? `${topCandidate.product} ${topCandidate.side}` : "n.d."],
      ["Ultimo stato", String(lastMonitor.core_state || firstExit.exit_reason || "n.d.")],
      ["Costo round-trip", `${estimatedRoundTripCostEur.toFixed(2)} EUR`],
      ["Spread candidate", `${topSpreadBps.toFixed(2)} bps`]
    ],
    signals: [
      `Long: ${Number(aggregate.long_positions || 0)}`,
      `Short: ${Number(aggregate.short_positions || 0)}`,
      `Avg pnl EUR: ${Number(aggregate.avg_pnl_eur || 0).toFixed(2)}`,
      `Last scenario: ${String(lastMonitor.microstructure_scenario || topCandidate?.microstructure_scenario || "n.d.")}`,
      `Fee round-trip: ${roundTripFeeBps.toFixed(2)} bps`,
      `Costo stimato: ${estimatedCostBps.toFixed(2)} bps`
    ],
    history: [
      `Generated · ${String(report.generated_at || "").slice(11, 19) || "n.d."}`,
      `Capital virtuale · ${Number(report.capital_eur || 0).toFixed(0)} EUR`,
      `Fees side · ${Number(report.fee_bps_each_side || 0)} bps`,
      `Costo round-trip stimato · ${estimatedRoundTripCostEur.toFixed(2)} EUR`
    ],
    topCandidate,
    costModel: {
      feeBpsEachSide,
      roundTripFeeBps,
      topSpreadBps,
      estimatedCostBps,
      estimatedRoundTripCostEur
    },
    bars: [22, 30, 37, 41, 49, 53, 56, 60, 64, 68, 72, Math.max(10, Math.min(90, 50 + Math.round(avgPnlPct * 4)))]
  };
}

function roundMetric(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function loadNyraFinanceHistory() {
  const payload = readJson(nyraFinanceHistoryPath, { entries: [] });
  return Array.isArray(payload?.entries) ? payload.entries : [];
}

function loadNyraFinanceProfileConfig() {
  return readJson(nyraFinanceProfilePath, {
    mode: "auto",
    manualProfile: "hard_growth",
    currentProfile: "capital_protection",
    currentGear: 1,
    previousAutoProfile: "capital_protection",
    allocation: null,
    lastUpdatedAt: "",
    warning: null
  });
}

function loadNyraFinanceProfileHistory() {
  return readJson("personal-control-center/data/nyra-finance-profile-history.json", { entries: [] });
}

function saveNyraFinanceProfileConfig(payload = {}) {
  writeJson(nyraFinanceProfilePath, payload);
}

function saveNyraFinanceHistory(entries = []) {
  writeJson(nyraFinanceHistoryPath, {
    entries: Array.isArray(entries) ? entries.slice(-240) : []
  });
}

function saveNyraFinanceRealtimeAutoimprovement(feedback = {}) {
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

  writeJson(nyraFinanceRealtimeAutoimprovePath, {
    version: "nyra_financial_realtime_autoimprovement_v1",
    generatedAt: new Date().toISOString(),
    source_feedback: nyraFinanceFeedbackPath,
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
      maxLossStreak
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
        expensiveAssets.length ? `expensive spread assets: ${expensiveAssets.join(", ")}` : "no expensive spread penalty"
      ]
    },
    promotion_status: "runtime_live_feedback_only"
  });
}

function saveNyraFinanceFeedback(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) {
    const emptyFeedback = {
      generatedAt: new Date().toISOString(),
      totalCycles: 0
    };
    writeJson(nyraFinanceFeedbackPath, emptyFeedback);
    saveNyraFinanceRealtimeAutoimprovement(emptyFeedback);
    return;
  }

  const selectedRows = rows.filter((row) => Number(row.selectedPositions || 0) > 0);
  const profitableRows = selectedRows.filter((row) => Number(row.totalPnlEur || 0) > 0);
  const losingRows = selectedRows.filter((row) => Number(row.totalPnlEur || 0) < 0);
  const noTradeRows = rows.filter((row) => Number(row.selectedPositions || 0) === 0);
  let capital = Number(rows[0]?.capitalEur || 0);
  let peak = capital;
  let drawdownAbsMax = 0;
  let drawdownPctMax = 0;
  let currentLossStreak = 0;
  let maxLossStreak = 0;
  const assetMap = new Map();

  rows.forEach((row) => {
    capital += Number(row.totalPnlEur || 0);
    peak = Math.max(peak, capital);
    const ddAbs = peak - capital;
    const ddPct = peak > 0 ? (ddAbs / peak) * 100 : 0;
    drawdownAbsMax = Math.max(drawdownAbsMax, ddAbs);
    drawdownPctMax = Math.max(drawdownPctMax, ddPct);

    if (Number(row.totalPnlEur || 0) < 0) {
      currentLossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    } else if (Number(row.totalPnlEur || 0) > 0) {
      currentLossStreak = 0;
    }

    (Array.isArray(row.assets) ? row.assets : []).forEach((asset) => {
      const current = assetMap.get(asset.product) || {
        product: asset.product,
        selected: 0,
        pnlEur: 0,
        spreadSamples: []
      };
      current.selected += asset.status === "selected" ? 1 : 0;
      current.pnlEur += Number(asset.pnlEur || 0);
      if (Number.isFinite(Number(asset.spreadBps))) current.spreadSamples.push(Number(asset.spreadBps));
      assetMap.set(asset.product, current);
    });
  });

  const avgSelectedPnlPct = selectedRows.length
    ? selectedRows.reduce((sum, row) => sum + Number(row.avgPnlPct || 0), 0) / selectedRows.length
    : 0;
  const avgSelectedPnlEur = selectedRows.length
    ? selectedRows.reduce((sum, row) => sum + Number(row.totalPnlEur || 0), 0) / selectedRows.length
    : 0;
  const averageBlockedCount = rows.length
    ? rows.reduce((sum, row) => sum + Number(row.blockedCount || 0), 0) / rows.length
    : 0;

  const feedbackPayload = {
    generatedAt: new Date().toISOString(),
    totalCycles: rows.length,
    selectedCycles: selectedRows.length,
    noTradeCycles: noTradeRows.length,
    selectedCycleRatio: rows.length ? Number((selectedRows.length / rows.length).toFixed(6)) : 0,
    noTradeRatio: rows.length ? Number((noTradeRows.length / rows.length).toFixed(6)) : 0,
    winRate: selectedRows.length ? Number((profitableRows.length / selectedRows.length).toFixed(6)) : 0,
    lossRate: selectedRows.length ? Number((losingRows.length / selectedRows.length).toFixed(6)) : 0,
    avgSelectedPnlPct: Number(avgSelectedPnlPct.toFixed(6)),
    avgSelectedPnlEur: Number(avgSelectedPnlEur.toFixed(6)),
    netPnlEur: Number((capital - Number(rows[0]?.capitalEur || 0)).toFixed(6)),
    maxDrawdownEur: Number(drawdownAbsMax.toFixed(6)),
    maxDrawdownPct: Number(drawdownPctMax.toFixed(6)),
    maxLossStreak,
    averageBlockedCount: Number(averageBlockedCount.toFixed(6)),
    assetStats: [...assetMap.values()].map((asset) => ({
      product: asset.product,
      selectedCount: asset.selected,
      pnlEur: Number(asset.pnlEur.toFixed(6)),
      avgSpreadBps: asset.spreadSamples.length
        ? Number((asset.spreadSamples.reduce((sum, value) => sum + value, 0) / asset.spreadSamples.length).toFixed(6))
        : 0
    }))
  };
  writeJson(nyraFinanceFeedbackPath, feedbackPayload);
  saveNyraFinanceRealtimeAutoimprovement(feedbackPayload);
}

function summarizeNyraFinanceReport(report = {}) {
  const aggregate = report.aggregate || {};
  const diagnostics = Array.isArray(report.candidate_diagnostics) ? report.candidate_diagnostics : [];
  const exits = Array.isArray(report.exits) ? report.exits : [];
  const portfolio = Array.isArray(report.portfolio) ? report.portfolio : [];
  const topCandidate = diagnostics[0] || null;
  const selected = Number(aggregate.selected_positions || 0);
  const totalPnl = Number(aggregate.total_pnl_eur || 0);
  const blocked = diagnostics.filter((item) => item.status === "blocked").length;
  const watched = diagnostics.filter((item) => item.status === "watch").length;
  const noTrade = diagnostics.filter((item) => item.status === "no_trade").length;
  const exitMap = new Map(exits.map((item) => [item.product, item]));
  const assetUniverse = diagnostics.map((item) => {
    const exit = exitMap.get(item.product);
    const position = portfolio.find((row) => row.product === item.product);
    return {
      product: item.product,
      status: item.status,
      side: item.side,
      adjustedScore: Number(item.adjusted_score || 0),
      scenario: item.microstructure_scenario || "n.d.",
      notes: Array.isArray(item.notes) ? item.notes : [],
      pnlEur: exit ? Number(exit.pnl_eur || 0) : 0,
      pnlPct: exit ? Number(exit.pnl_pct || 0) : 0,
      weightPct: position ? Number(position.weight_pct || 0) : 0,
      spreadBps: Number(item.spread_bps || 0)
    };
  });

  return {
    id: String(report.generated_at || new Date().toISOString()),
    generatedAt: report.generated_at || new Date().toISOString(),
    source: report.source || "n.d.",
    capitalEur: Number(report.capital_eur || 0),
    selectedPositions: selected,
    totalPnlEur: roundMetric(totalPnl, 6),
    avgPnlPct: roundMetric(Number(aggregate.avg_pnl_pct || 0), 6),
    topCandidate: topCandidate ? {
      product: topCandidate.product,
      status: topCandidate.status,
      side: topCandidate.side,
      adjustedScore: Number(topCandidate.adjusted_score || 0),
      action: topCandidate.financial_action || "n.d.",
      scenario: topCandidate.microstructure_scenario || "n.d.",
      notes: Array.isArray(topCandidate.notes) ? topCandidate.notes : []
    } : null,
    blockedCount: blocked,
    watchCount: watched,
    noTradeCount: noTrade,
    profitableCount: Number(aggregate.profitable_positions || 0),
    losingCount: Number(aggregate.losing_positions || 0),
    exitCount: exits.length,
    assets: assetUniverse
  };
}

function appendNyraFinanceHistory(report = {}) {
  const entries = loadNyraFinanceHistory();
  const summary = summarizeNyraFinanceReport(report);
  const next = [...entries.filter((item) => item.id !== summary.id), summary]
    .sort((a, b) => String(a.generatedAt).localeCompare(String(b.generatedAt)));
  saveNyraFinanceHistory(next);
  saveNyraFinanceFeedback(next);
  return next;
}

const nyraFinanceLiveState = {
  enabled: true,
  running: false,
  intervalMs: 60_000,
  lastStartedAt: "",
  lastFinishedAt: "",
  lastError: "",
  lastReport: null,
  profile: null
};

let nyraFinanceLiveTimer = null;

const nyraFinanceKeepAwakeState = {
  enabled: true,
  active: false,
  mode: "background_runtime",
  startedAt: "",
  pid: null,
  lastError: "",
  battery: null
};

let nyraFinanceKeepAwakeProcess = null;

const nyraWorldPaperAutoState = {
  enabled: false,
  running: false,
  intervalMs: 10 * 60_000,
  lastStartedAt: "",
  lastFinishedAt: "",
  nextRunAt: "",
  lastError: "",
  lastResult: null,
  cyclesCompleted: 0
};

let nyraWorldPaperAutoTimer = null;

function saveNyraWorldPaperAutoState() {
  writeJson(nyraWorldPaperAutoStatePath, {
    enabled: nyraWorldPaperAutoState.enabled,
    intervalMs: nyraWorldPaperAutoState.intervalMs,
    lastStartedAt: nyraWorldPaperAutoState.lastStartedAt,
    lastFinishedAt: nyraWorldPaperAutoState.lastFinishedAt,
    nextRunAt: nyraWorldPaperAutoState.nextRunAt,
    lastError: nyraWorldPaperAutoState.lastError,
    lastResult: nyraWorldPaperAutoState.lastResult,
    cyclesCompleted: nyraWorldPaperAutoState.cyclesCompleted
  });
}

function restoreNyraWorldPaperAutoState() {
  const stored = readJson(nyraWorldPaperAutoStatePath, null);
  if (!stored || typeof stored !== "object") return;
  nyraWorldPaperAutoState.enabled = Boolean(stored.enabled);
  nyraWorldPaperAutoState.intervalMs = Number(stored.intervalMs || nyraWorldPaperAutoState.intervalMs);
  nyraWorldPaperAutoState.lastStartedAt = stored.lastStartedAt || "";
  nyraWorldPaperAutoState.lastFinishedAt = stored.lastFinishedAt || "";
  nyraWorldPaperAutoState.nextRunAt = stored.nextRunAt || "";
  nyraWorldPaperAutoState.lastError = stored.lastError || "";
  nyraWorldPaperAutoState.lastResult = stored.lastResult || null;
  nyraWorldPaperAutoState.cyclesCompleted = Number(stored.cyclesCompleted || 0);
}

function applyNyraWorldPaperAutoEnvDefaults() {
  const autostartRaw = String(process.env.NYRA_WORLD_PAPER_AUTOSTART || "").toLowerCase();
  const autostart = ["1", "true", "yes", "on"].includes(autostartRaw);
  const intervalMinutes = Number(process.env.NYRA_WORLD_PAPER_INTERVAL_MINUTES || 60);
  const intervalMs = Math.max(5 * 60_000, Math.min(24 * 60 * 60_000, intervalMinutes * 60_000));
  nyraWorldPaperAutoState.intervalMs = Number.isFinite(intervalMs) ? intervalMs : nyraWorldPaperAutoState.intervalMs;
  if (autostart) nyraWorldPaperAutoState.enabled = true;
}

function readNyraBatteryState() {
  try {
    const raw = execFileSync("/usr/bin/pmset", ["-g", "batt"], { encoding: "utf8" });
    const levelMatch = raw.match(/(\d+)%/);
    const batteryPercent = levelMatch ? Number(levelMatch[1]) : null;
    const charging = raw.includes("charging")
      ? true
      : raw.includes("discharging")
        ? false
        : null;
    const powerSource = raw.includes("AC Power")
      ? "ac"
      : raw.includes("Battery Power")
        ? "battery"
        : "unknown";
    return {
      batteryPercent,
      charging,
      powerSource,
      lowBattery: charging === false && Number.isFinite(batteryPercent) ? batteryPercent <= 20 : false,
      criticalBattery: charging === false && Number.isFinite(batteryPercent) ? batteryPercent <= 10 : false
    };
  } catch (error) {
    return {
      batteryPercent: null,
      charging: null,
      powerSource: "unknown",
      lowBattery: false,
      criticalBattery: false,
      error: error.message
    };
  }
}

function startNyraFinanceKeepAwake() {
  nyraFinanceKeepAwakeState.battery = readNyraBatteryState();
  if (!nyraFinanceKeepAwakeState.enabled) return;
  if (nyraFinanceKeepAwakeProcess && !nyraFinanceKeepAwakeProcess.killed) return;

  try {
    const child = spawn("/usr/bin/caffeinate", ["-i", "-m"], {
      stdio: "ignore"
    });
    nyraFinanceKeepAwakeProcess = child;
    nyraFinanceKeepAwakeState.active = true;
    nyraFinanceKeepAwakeState.startedAt = new Date().toISOString();
    nyraFinanceKeepAwakeState.pid = child.pid || null;
    nyraFinanceKeepAwakeState.lastError = "";
    child.on("exit", () => {
      nyraFinanceKeepAwakeState.active = false;
      nyraFinanceKeepAwakeState.pid = null;
      nyraFinanceKeepAwakeProcess = null;
    });
    child.on("error", (error) => {
      nyraFinanceKeepAwakeState.lastError = error.message;
      nyraFinanceKeepAwakeState.active = false;
      nyraFinanceKeepAwakeState.pid = null;
      nyraFinanceKeepAwakeProcess = null;
    });
  } catch (error) {
    nyraFinanceKeepAwakeState.lastError = error.message;
    nyraFinanceKeepAwakeState.active = false;
    nyraFinanceKeepAwakeState.pid = null;
    nyraFinanceKeepAwakeProcess = null;
  }
}

function stopNyraFinanceKeepAwake() {
  nyraFinanceKeepAwakeState.battery = readNyraBatteryState();
  if (nyraFinanceKeepAwakeProcess && !nyraFinanceKeepAwakeProcess.killed) {
    nyraFinanceKeepAwakeProcess.kill("SIGTERM");
  }
  nyraFinanceKeepAwakeProcess = null;
  nyraFinanceKeepAwakeState.active = false;
  nyraFinanceKeepAwakeState.pid = null;
}

function syncNyraFinanceKeepAwake() {
  nyraFinanceKeepAwakeState.battery = readNyraBatteryState();
  if (nyraFinanceLiveState.enabled) {
    startNyraFinanceKeepAwake();
  } else {
    stopNyraFinanceKeepAwake();
  }
}

async function refreshNyraFinanceProfileState(overrides = {}) {
  const config = loadNyraFinanceProfileConfig();
  const mode = overrides.mode || config.mode || "auto";
  const manualProfile = overrides.manualProfile || config.manualProfile || "hard_growth";
  const profileState = await runNodeJson([
    "--experimental-strip-types",
    "universal-core/tools/nyra_live_profile_bridge.ts",
    "--mode",
    mode,
    "--manual-profile",
    manualProfile
  ], { timeoutMs: 20000 });
  const profileWarning = profileState.mode === "manual" &&
    profileState.warning &&
    (
      profileState.warning.recommendedProfile !== profileState.currentProfile ||
      Number(profileState.warning.recommendedGear || 0) !== Number(profileState.currentGear || 0)
    )
    ? profileState.warning
    : null;
  profileState.warning = profileWarning;
  nyraFinanceLiveState.profile = profileState;
  saveNyraFinanceProfileConfig({
    ...config,
    mode: profileState.mode,
    manualProfile: profileState.manualProfile,
    currentProfile: profileState.currentProfile,
    currentGear: profileState.currentGear,
    previousAutoProfile: profileState.mode === "auto"
      ? profileState.currentProfile
      : profileState.autoRecommendation?.profile || config.previousAutoProfile || "capital_protection",
    allocation: profileState.allocation,
    lastUpdatedAt: new Date().toISOString(),
    warning: profileWarning
  });
  return profileState;
}

function getNyraFinanceLiveArgs() {
  const config = loadNyraFinanceProfileConfig();
  const profileState = nyraFinanceLiveState.profile || {};
  const selectorProfile = profileState.currentProfile || config.currentProfile || "capital_protection";
  const selectorMode = profileState.mode || config.mode || "auto";
  const selectorRiskCap = Number(profileState.riskyWeight ?? 0.35);
  return [
    "--experimental-strip-types",
    "universal-core/tools/nyra_live_portfolio_trade.ts",
    "--duration-sec",
    "10",
    "--capital-eur",
    "100000",
    "--fee-bps",
    "60",
    "--portfolio-size",
    "4",
    "--products",
    "BTC-EUR,ETH-EUR,SOL-EUR,LINK-EUR",
    "--selector-mode",
    String(selectorMode),
    "--selector-profile",
    String(selectorProfile),
    "--selector-risk-cap",
    String(selectorRiskCap)
  ];
}

async function runNyraFinanceLiveCycle() {
  if (!nyraFinanceLiveState.enabled || nyraFinanceLiveState.running) return;
  nyraFinanceLiveState.running = true;
  nyraFinanceLiveState.lastStartedAt = new Date().toISOString();
  nyraFinanceLiveState.lastError = "";
  try {
    await refreshNyraFinanceProfileState();
    const report = await runNodeJson(getNyraFinanceLiveArgs(), { timeoutMs: 120000 });
    nyraFinanceLiveState.lastReport = report;
    appendNyraFinanceHistory(report);
    nyraFinanceLiveState.lastFinishedAt = new Date().toISOString();
  } catch (error) {
    nyraFinanceLiveState.lastError = error.message;
    nyraFinanceLiveState.lastFinishedAt = new Date().toISOString();
  } finally {
    nyraFinanceLiveState.running = false;
  }
}

function scheduleNyraFinanceLiveLoop(immediate = false) {
  if (nyraFinanceLiveTimer) clearInterval(nyraFinanceLiveTimer);
  syncNyraFinanceKeepAwake();
  if (!nyraFinanceLiveState.enabled) return;
  nyraFinanceLiveTimer = setInterval(() => {
    runNyraFinanceLiveCycle().catch(() => {});
  }, nyraFinanceLiveState.intervalMs);
  if (immediate) {
    runNyraFinanceLiveCycle().catch(() => {});
  }
}

function nyraFinanceLiveStatusPayload() {
  const report = nyraFinanceLiveState.lastReport;
  const realtimeAutoimprovement = readJson(nyraFinanceRealtimeAutoimprovePath, null);
  nyraFinanceKeepAwakeState.battery = readNyraBatteryState();
  const paperPortfolio = readJson(nyraWorldPaperPortfolioPath, emptyWorldPaperPortfolio());
  const treasury = buildUnifiedFinanceTreasury(paperPortfolio, report);
  return {
    ok: true,
    enabled: nyraFinanceLiveState.enabled,
    running: nyraFinanceLiveState.running,
    intervalMs: nyraFinanceLiveState.intervalMs,
    lastStartedAt: nyraFinanceLiveState.lastStartedAt,
    lastFinishedAt: nyraFinanceLiveState.lastFinishedAt,
    lastError: nyraFinanceLiveState.lastError,
    profile: nyraFinanceLiveState.profile || loadNyraFinanceProfileConfig(),
    profileHistory: loadNyraFinanceProfileHistory().entries || [],
    keepAwake: {
      enabled: nyraFinanceKeepAwakeState.enabled,
      active: nyraFinanceKeepAwakeState.active,
      mode: nyraFinanceKeepAwakeState.mode,
      startedAt: nyraFinanceKeepAwakeState.startedAt,
      pid: nyraFinanceKeepAwakeState.pid,
      lastError: nyraFinanceKeepAwakeState.lastError,
      battery: nyraFinanceKeepAwakeState.battery
    },
    treasury,
    realtimeAutoimprovement,
    history: loadNyraFinanceHistory(),
    finance: report ? buildNyraFinanceLiveCard(report) : null,
    raw: report
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function normalizeRenderPostgres(item = {}) {
  const database = item.postgres || item.database || item;
  const plan = String(database.plan || database.planName || "").toLowerCase();
  const planLimitBytes = plan === "free" || plan.includes("1gb")
    ? 1024 * 1024 * 1024
    : null;
  return {
    id: database.id || item.id || "",
    name: database.name || item.name || "",
    databaseName: database.databaseName || database.database || database.dbName || "",
    user: database.user || database.databaseUser || "",
    plan: database.plan || database.planName || "",
    status: database.status || "",
    region: database.region || "",
    version: database.version || database.postgresVersion || "",
    createdAt: database.createdAt || "",
    expiresAt: database.expiresAt || database.expireAt || "",
    diskAutoscalingEnabled: Boolean(database.diskAutoscalingEnabled),
    highAvailabilityEnabled: Boolean(database.highAvailabilityEnabled),
    limitBytes: planLimitBytes,
    limitPretty: planLimitBytes ? formatBytes(planLimitBytes) : "",
    usageSource: "render_api_meta",
    exactUsageAvailable: false,
    note: planLimitBytes
      ? "Piano Render con limite 1 GB. Per uso reale serve endpoint admin database."
      : "Uso reale da leggere tramite endpoint admin database."
  };
}

async function fetchSmartDeskDatabaseUsage() {
  const baseUrl = String(process.env.SMARTDESK_API_URL || "https://skinharmony-smartdesk-live.onrender.com").replace(/\/+$/, "");
  let token = process.env.SMARTDESK_ADMIN_TOKEN || "";
  const username = process.env.SMARTDESK_ADMIN_USERNAME || "";
  const password = process.env.SMARTDESK_ADMIN_PASSWORD || "";
  if (!token && username && password) {
    const session = await fetchJson(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    token = session.token || "";
  }
  if (!token) return null;
  return fetchJson(`${baseUrl}/api/admin/database-usage`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

function basicAuth(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function writeJson(relativePath, data) {
  const filePath = resolveStoragePath(relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function campaignLabel(id) {
  return {
    email_distributori: "Distributori",
    email_parrucchieri: "Parrucchieri",
    email_centri_estetici: "Estetiste"
  }[id] || id;
}

function inferChannel(event) {
  if (event.canale) return event.canale;
  if (String(event.processo_id || "").startsWith("email_")) return "email";
  return "manuale";
}

function messageVersion(textId) {
  const match = String(textId || "").match(/_v(\d+)$/);
  return match ? `v${match[1]}` : "";
}

function normalizeAction(event) {
  return {
    id: event.id || `evt_${Date.now()}`,
    leadId: event.lead_id || "",
    campaignId: event.processo_id || "",
    actionType: event.tipo || "",
    messageType: event.nome_script || event.processo_id || "",
    version: event.versione || messageVersion(event.testo_id),
    channel: inferChannel(event),
    sentAt: event.data || "",
    textId: event.testo_id || "",
    note: event.note || ""
  };
}

function loadControlData() {
  const data = readJson(controlDataPath, {});
  return {
    interactions: Array.isArray(data.interactions) ? data.interactions : [],
    sales: Array.isArray(data.sales) ? data.sales : [],
    socialContents: Array.isArray(data.socialContents) ? data.socialContents : [],
    websiteSnapshots: Array.isArray(data.websiteSnapshots) ? data.websiteSnapshots : [],
    searchConsoleSnapshots: Array.isArray(data.searchConsoleSnapshots) ? data.searchConsoleSnapshots : [],
    ga4Snapshots: Array.isArray(data.ga4Snapshots) ? data.ga4Snapshots : [],
    instagramSnapshots: Array.isArray(data.instagramSnapshots) ? data.instagramSnapshots : [],
    smartDeskSnapshots: Array.isArray(data.smartDeskSnapshots) ? data.smartDeskSnapshots : [],
    renderSnapshots: Array.isArray(data.renderSnapshots) ? data.renderSnapshots : [],
    githubSnapshots: Array.isArray(data.githubSnapshots) ? data.githubSnapshots : [],
    manualContacts: Array.isArray(data.manualContacts) ? data.manualContacts : [],
    inventoryItems: Array.isArray(data.inventoryItems) ? data.inventoryItems : [],
    inventoryMovements: Array.isArray(data.inventoryMovements) ? data.inventoryMovements : [],
    productivityLogs: Array.isArray(data.productivityLogs) ? data.productivityLogs : [],
    websiteEvents: Array.isArray(data.websiteEvents) ? data.websiteEvents : [],
    aiLogs: Array.isArray(data.aiLogs) ? data.aiLogs : [],
    aiDrafts: Array.isArray(data.aiDrafts) ? data.aiDrafts : []
  };
}

function saveControlData(data) {
  writeJson(controlDataPath, {
    interactions: Array.isArray(data.interactions) ? data.interactions : [],
    sales: Array.isArray(data.sales) ? data.sales : [],
    socialContents: Array.isArray(data.socialContents) ? data.socialContents : [],
    websiteSnapshots: Array.isArray(data.websiteSnapshots) ? data.websiteSnapshots : [],
    searchConsoleSnapshots: Array.isArray(data.searchConsoleSnapshots) ? data.searchConsoleSnapshots : [],
    ga4Snapshots: Array.isArray(data.ga4Snapshots) ? data.ga4Snapshots : [],
    instagramSnapshots: Array.isArray(data.instagramSnapshots) ? data.instagramSnapshots : [],
    smartDeskSnapshots: Array.isArray(data.smartDeskSnapshots) ? data.smartDeskSnapshots : [],
    renderSnapshots: Array.isArray(data.renderSnapshots) ? data.renderSnapshots : [],
    githubSnapshots: Array.isArray(data.githubSnapshots) ? data.githubSnapshots : [],
    manualContacts: Array.isArray(data.manualContacts) ? data.manualContacts : [],
    inventoryItems: Array.isArray(data.inventoryItems) ? data.inventoryItems : [],
    inventoryMovements: Array.isArray(data.inventoryMovements) ? data.inventoryMovements : [],
    productivityLogs: Array.isArray(data.productivityLogs) ? data.productivityLogs : [],
    websiteEvents: Array.isArray(data.websiteEvents) ? data.websiteEvents : [],
    aiLogs: Array.isArray(data.aiLogs) ? data.aiLogs : [],
    aiDrafts: Array.isArray(data.aiDrafts) ? data.aiDrafts : []
  });
}

function listLeadFiles() {
  const leadDir = path.join(rootDir, "lead");
  if (!fs.existsSync(leadDir)) return [];
  return fs
    .readdirSync(leadDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => `lead/${file}`);
}

function leadId(lead) {
  return String(lead.contatto || lead.email || lead.telefono || lead.nome || "").trim();
}

function loadAllLeads() {
  const rows = [];
  for (const relativePath of listLeadFiles()) {
    const data = readJson(relativePath, { leads: [] });
    const leads = Array.isArray(data.leads) ? data.leads : [];
    leads.forEach((lead, index) => {
      rows.push({
        ...lead,
        id: leadId(lead),
        file: relativePath,
        index,
        stato: leadStatuses.includes(lead.stato) ? lead.stato : lead.stato || "nuovo"
      });
    });
  }
  return rows;
}

function buildLeadActionIndex() {
  const index = new Map();
  for (const event of loadOutreachEvents()) {
    const action = normalizeAction(event);
    if (!action.leadId) continue;
    if (!index.has(action.leadId)) index.set(action.leadId, []);
    index.get(action.leadId).push(action);
  }
  for (const actions of index.values()) {
    actions.sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)));
  }
  return index;
}

function hoursBetween(start, end) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round(((b - a) / 36e5) * 10) / 10;
}

function formatResponseTime(hours) {
  if (hours === null || hours === undefined) return "";
  if (hours < 24) return `${hours} ore`;
  return `${Math.round((hours / 24) * 10) / 10} giorni`;
}

function summarizeLeadBehavior(lead, actions, interactions) {
  const relatedInteractions = interactions
    .filter((item) => item.leadId === lead.id)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const sends = actions.filter((item) => item.actionType === "invio");
  const replies = actions.filter((item) => item.actionType === "risposta");
  const manualReplies = relatedInteractions.filter((item) => item.response === true || item.type === "risposta");
  const firstSend = sends[0]?.sentAt || "";
  const firstReply = replies[0]?.sentAt || manualReplies[0]?.date || "";
  const responseHours = firstSend && firstReply ? hoursBetween(firstSend, firstReply) : null;
  const followUps = Math.max(sends.length - 1, 0) + relatedInteractions.filter((item) => item.type === "follow_up").length;

  return {
    response: replies.length > 0 || manualReplies.length > 0 || ["risposto", "interessato", "trattativa", "cliente"].includes(lead.stato),
    responseTimeHours: responseHours,
    responseTimeLabel: formatResponseTime(responseHours),
    followUpCount: followUps,
    interactions: relatedInteractions,
    actions
  };
}

function buildFunnel(leads = loadAllLeads()) {
  const counts = leadStatuses.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {});
  for (const lead of leads) {
    const status = leadStatuses.includes(lead.stato) ? lead.stato : "nuovo";
    counts[status] += 1;
  }
  return {
    statuses: leadStatuses,
    counts,
    total: leads.length
  };
}

function summarizeCampaigns() {
  const stats = readJson("outreach_stats.json", { eventi: [] });
  const events = Array.isArray(stats.eventi) ? stats.eventi : [];
  const grouped = new Map();
  const leadStatusById = new Map(loadAllLeads().map((lead) => [lead.id, lead.stato]));

  for (const event of events) {
    const key = event.processo_id || "senza_processo";
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(event);
  }

  return [...grouped.entries()]
    .filter(([id]) => id.startsWith("email_"))
    .map(([id, items]) => {
      const sends = items.filter((item) => item.tipo === "invio");
      const replies = items.filter((item) => item.tipo === "risposta");
      const firstSend = sends.map((item) => item.data).filter(Boolean).sort()[0] || null;
      const lastSend = sends.map((item) => item.data).filter(Boolean).sort().at(-1) || null;
      const monitorEnd = firstSend ? addDays(firstSend, 10) : null;
      const responseRate = sends.length ? replies.length / sends.length : 0;
      const sentLeadIds = [...new Set(sends.map((item) => item.lead_id).filter(Boolean))];
      const statusCounts = leadStatuses.reduce((acc, status) => {
        acc[status] = 0;
        return acc;
      }, {});
      for (const sentLeadId of sentLeadIds) {
        const status = leadStatusById.get(sentLeadId) || "nuovo";
        if (statusCounts[status] !== undefined) statusCounts[status] += 1;
      }
      const status = sends.length === 0
        ? "nessun dato"
        : responseRate < 0.2
          ? "sotto soglia"
          : "in controllo";

      const textIds = [...new Set(sends.map((item) => item.testo_id).filter(Boolean))];

      return {
        id,
        label: campaignLabel(id),
        sends: sends.length,
        replies: replies.length,
        generatedLeads: sentLeadIds.length,
        interested: statusCounts.interessato,
        negotiations: statusCounts.trattativa,
        customers: statusCounts.cliente,
        responseRate,
        leadRate: sends.length ? sentLeadIds.length / sends.length : 0,
        negotiationRate: sentLeadIds.length ? statusCounts.trattativa / sentLeadIds.length : 0,
        customerRate: sentLeadIds.length ? statusCounts.cliente / sentLeadIds.length : 0,
        status,
        firstSend: dateOnly(firstSend),
        lastSend: dateOnly(lastSend),
        monitorEnd: dateOnly(monitorEnd),
        textIds,
        statusCounts
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function loadOutreachEvents() {
  const stats = readJson("outreach_stats.json", { eventi: [] });
  return Array.isArray(stats.eventi) ? stats.eventi : [];
}

function buildOutreachTimeline() {
  const events = loadOutreachEvents().filter((event) => event.processo_id && event.processo_id.startsWith("email_"));
  const days = new Map();

  for (const event of events) {
    const day = dateOnly(event.data);
    if (!day) continue;
    if (!days.has(day)) {
      days.set(day, {
        date: day,
        sends: 0,
        replies: 0,
        email_distributori: 0,
        email_parrucchieri: 0,
        email_centri_estetici: 0
      });
    }

    const item = days.get(day);
    if (event.tipo === "invio") {
      item.sends += 1;
      if (item[event.processo_id] !== undefined) {
        item[event.processo_id] += 1;
      }
    }
    if (event.tipo === "risposta") {
      item.replies += 1;
      const replyKey = `${event.processo_id}_replies`;
      item[replyKey] = (item[replyKey] || 0) + 1;
    }
  }

  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function summarizeLeads() {
  const summary = [];
  const latest = [];
  const controlData = loadControlData();
  const actionIndex = buildLeadActionIndex();

  for (const relativePath of listLeadFiles()) {
    const data = readJson(relativePath, { leads: [] });
    const leads = Array.isArray(data.leads) ? data.leads : [];
    const statuses = leads.reduce((acc, lead) => {
      const status = lead.stato || "senza_stato";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    summary.push({
      file: relativePath,
      count: leads.length,
      statuses
    });

    for (const [index, lead] of leads.entries()) {
      const id = leadId(lead);
      const status = leadStatuses.includes(lead.stato) ? lead.stato : "nuovo";
      const behavior = summarizeLeadBehavior(
        { ...lead, id, stato: status },
        actionIndex.get(id) || [],
        controlData.interactions
      );
      latest.push({
        id,
        nome: lead.nome || "",
        contatto: lead.contatto || "",
        tipo: lead.tipo_contatto || "",
        stato: status,
        ultimaAzione: lead.ultima_azione || "",
        aggiornamento: lead.ultimo_aggiornamento || "",
        file: relativePath,
        index,
        response: behavior.response,
        responseTime: behavior.responseTimeLabel,
        followUpCount: behavior.followUpCount,
        actionCount: behavior.actions.length,
        interactionCount: behavior.interactions.length
      });
    }
  }

  latest.sort((a, b) => String(b.aggiornamento).localeCompare(String(a.aggiornamento)));

  return {
    funnel: buildFunnel(loadAllLeads()),
    files: summary.sort((a, b) => b.count - a.count),
    latest: latest.slice(0, 40)
  };
}

function summarizeActions() {
  return loadOutreachEvents()
    .map(normalizeAction)
    .filter((action) => action.leadId)
    .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)));
}

function summarizeBehavior() {
  const controlData = loadControlData();
  const actionIndex = buildLeadActionIndex();
  return loadAllLeads().map((lead) => {
    const behavior = summarizeLeadBehavior(lead, actionIndex.get(lead.id) || [], controlData.interactions);
    return {
      id: lead.id,
      nome: lead.nome || "",
      contatto: lead.contatto || "",
      stato: lead.stato,
      risposta: behavior.response,
      tempoRispostaOre: behavior.responseTimeHours,
      tempoRisposta: behavior.responseTimeLabel,
      followUp: behavior.followUpCount,
      storicoInterazioni: behavior.interactions,
      azioni: behavior.actions
    };
  });
}

function summarizeEconomics(campaigns = summarizeCampaigns()) {
  const data = loadControlData();
  const sales = data.sales.map((sale) => {
    const price = Number(sale.price || 0);
    const estimatedCost = Number(sale.estimatedCost || 0);
    return {
      ...sale,
      price,
      estimatedCost,
      margin: Number.isFinite(Number(sale.margin)) ? Number(sale.margin) : price - estimatedCost
    };
  });
  const revenueByCampaign = {};
  const productCount = {};
  for (const sale of sales) {
    const campaignId = sale.campaignId || "senza_campagna";
    revenueByCampaign[campaignId] = (revenueByCampaign[campaignId] || 0) + sale.price;
    if (sale.product) productCount[sale.product] = (productCount[sale.product] || 0) + 1;
  }
  const topProduct = Object.entries(productCount).sort((a, b) => b[1] - a[1])[0] || null;
  return {
    sales,
    revenueByCampaign: campaigns.map((campaign) => ({
      campaignId: campaign.id,
      label: campaign.label,
      revenue: revenueByCampaign[campaign.id] || 0
    })),
    totalRevenue: sales.reduce((sum, sale) => sum + sale.price, 0),
    totalMargin: sales.reduce((sum, sale) => sum + sale.margin, 0),
    topProduct: topProduct ? { product: topProduct[0], count: topProduct[1] } : null
  };
}

function loadInventoryProducts() {
  const sources = [
    readJson("smartdesk/data/inventory.json", []),
    readJson("render-smartdesk-live/data/inventory.json", [])
  ].flat();
  return sources.map((item) => ({
    id: item.id || item.sku || item.nome || item.name || "",
    name: item.nome || item.name || item.prodotto || item.product || item.id || "Prodotto senza nome",
    stock: Number(item.stock || item.giacenza || item.quantity || 0)
  }));
}

function summarizeInventory(economics = summarizeEconomics()) {
  const products = loadInventoryProducts();
  const soldByProduct = {};
  const campaignByProduct = {};
  for (const sale of economics.sales) {
    if (!sale.product) continue;
    soldByProduct[sale.product] = (soldByProduct[sale.product] || 0) + 1;
    if (!campaignByProduct[sale.product]) campaignByProduct[sale.product] = {};
    campaignByProduct[sale.product][sale.campaignId || "senza_campagna"] =
      (campaignByProduct[sale.product][sale.campaignId || "senza_campagna"] || 0) + 1;
  }
  const inventoryNames = new Set(products.map((item) => item.name));
  Object.keys(soldByProduct).forEach((product) => inventoryNames.add(product));

  return {
    productsSold: Object.entries(soldByProduct).map(([product, count]) => ({ product, count })),
    stationaryProducts: [...inventoryNames]
      .filter((product) => !soldByProduct[product])
      .map((product) => {
        const inventory = products.find((item) => item.name === product);
        return { product, stock: inventory?.stock || 0 };
      }),
    campaignCorrelation: Object.entries(campaignByProduct).map(([product, campaigns]) => ({ product, campaigns }))
  };
}

function summarizeSocial() {
  const data = loadControlData();
  return {
    contents: data.socialContents,
    totalLeadGenerated: data.socialContents.reduce((sum, item) => sum + Number(item.leadsGenerated || 0), 0)
  };
}

function latestItem(items) {
  return items
    .slice()
    .sort((a, b) => String(b.date || b.createdAt || "").localeCompare(String(a.date || a.createdAt || "")))[0] || null;
}

function summarizeDataSources() {
  const data = loadControlData();
  const website = latestItem(data.websiteSnapshots);
  const searchConsole = latestItem(data.searchConsoleSnapshots);
  const ga4 = latestItem(data.ga4Snapshots);
  const instagram = latestItem(data.instagramSnapshots);
  const smartDesk = latestItem(data.smartDeskSnapshots);
  const render = latestItem(data.renderSnapshots);
  const github = latestItem(data.githubSnapshots);

  return {
    website: {
      status: website || searchConsole || ga4 ? "api_attivo" : "da_collegare",
      mode: "wordpress_search_console_ga4",
      latest: website,
      analytics: ga4,
      searchConsole,
      history: data.websiteSnapshots.slice(-20),
      analyticsHistory: data.ga4Snapshots.slice(-20),
      searchHistory: data.searchConsoleSnapshots.slice(-20)
    },
    instagram: {
      status: instagram ? "api_attivo" : "da_collegare",
      mode: instagram?.source === "instagram_graph_api" ? "instagram_graph_api" : "manuale_ora_api_dopo",
      latest: instagram,
      history: data.instagramSnapshots.slice(-20)
    },
    smartDesk: {
      status: smartDesk ? "manuale_attivo" : "da_collegare_api",
      mode: "snapshot_manuale_ora_api_dopo",
      liveUrl: "https://skinharmony-smartdesk-live.onrender.com",
      latest: smartDesk,
      history: data.smartDeskSnapshots.slice(-20)
    },
    render: {
      status: render ? "api_attivo" : "da_collegare",
      mode: "render_api",
      latest: render,
      history: data.renderSnapshots.slice(-20)
    },
    github: {
      status: github ? "api_attivo" : "da_collegare",
      mode: process.env.GITHUB_TOKEN || process.env.GH_TOKEN ? "github_api_token" : "github_api_pubblica",
      latest: github,
      history: data.githubSnapshots.slice(-20)
    },
    contacts: {
      status: data.manualContacts.length ? "manuale_attivo" : "pronto",
      total: data.manualContacts.length,
      latest: data.manualContacts.slice(-10).reverse()
    }
  };
}

function eventCount(events, name) {
  return (events || [])
    .filter((event) => event.eventName === name || event.name === name)
    .reduce((sum, event) => sum + Number(event.eventCount || event.count || 1), 0);
}

function summarizeWebsiteFunnel() {
  const data = loadControlData();
  const sources = summarizeDataSources();
  const ga4 = sources.website.analytics;
  const searchConsole = sources.website.searchConsole;
  const wordpress = sources.website.latest;
  const manualEvents = data.websiteEvents || [];
  const ga4Events = ga4?.eventTotals || {};

  const trialClicks = Number(ga4Events.trial_click || 0) + eventCount(manualEvents, "trial_click");
  const loginClicks = Number(ga4Events.login_click || 0) + eventCount(manualEvents, "login_click");
  const demoClicks = Number(ga4Events.demo_click || 0) + eventCount(manualEvents, "demo_click");
  const formSubmits = Number(ga4Events.lead_form_submit || 0) + eventCount(manualEvents, "lead_form_submit");
  const siteClicks = searchConsole ? Number(searchConsole.clicks || 0) : 0;
  const impressions = searchConsole ? Number(searchConsole.impressions || 0) : 0;
  const sessions = ga4 ? Number(ga4.sessions || 0) : Number(wordpress?.visits || 0);
  const conversions = ga4 ? Number(ga4.conversions || 0) : Number(wordpress?.leads || 0);
  const ctaClicks = trialClicks + loginClicks + demoClicks;
  const hasGa4 = Boolean(ga4);
  const hasSearchConsole = Boolean(searchConsole);
  const hasTrackedEvents = Boolean(trialClicks || loginClicks || demoClicks || formSubmits);

  const steps = [
    {
      key: "impressions",
      label: "Impression Google",
      value: impressions,
      state: hasSearchConsole ? "reale" : "non collegato",
      source: "Search Console"
    },
    {
      key: "searchClicks",
      label: "Click organici",
      value: siteClicks,
      state: hasSearchConsole ? "reale" : "non collegato",
      source: "Search Console"
    },
    {
      key: "sessions",
      label: "Sessioni sito",
      value: sessions,
      state: hasGa4 ? "reale" : wordpress ? "stimato" : "non collegato",
      source: hasGa4 ? "GA4" : "WordPress/manuale"
    },
    {
      key: "ctaClicks",
      label: "Click CTA",
      value: ctaClicks,
      state: hasTrackedEvents ? "reale" : hasGa4 ? "mancante" : "non collegato",
      source: "GA4 eventi"
    },
    {
      key: "formSubmits",
      label: "Invii form",
      value: formSubmits,
      state: formSubmits ? "reale" : hasGa4 ? "mancante" : "non collegato",
      source: "GA4 eventi"
    },
    {
      key: "conversions",
      label: "Conversioni",
      value: conversions,
      state: hasGa4 ? "reale" : wordpress ? "stimato" : "non collegato",
      source: hasGa4 ? "GA4" : "WordPress/manuale"
    }
  ];

  const rates = {
    searchCtr: impressions ? siteClicks / impressions : 0,
    sessionToCta: sessions ? ctaClicks / sessions : 0,
    ctaToForm: ctaClicks ? formSubmits / ctaClicks : 0,
    sessionToConversion: sessions ? conversions / sessions : 0
  };

  const missing = [];
  if (!hasGa4) missing.push("GA4_PROPERTY_ID non collegato o snapshot GA4 assente");
  if (!hasSearchConsole) missing.push("Search Console non sincronizzata o token Google non valido");
  if (hasGa4 && !hasTrackedEvents) missing.push("Eventi CTA Smart Desk non ancora registrati in GA4");

  return {
    status: !hasGa4 || !hasSearchConsole ? "incompleto" : hasTrackedEvents ? "attivo" : "eventi_mancanti",
    updatedAt: ga4?.date || searchConsole?.date || wordpress?.date || "",
    steps,
    events: {
      trialClicks,
      loginClicks,
      demoClicks,
      formSubmits,
      ctaClicks
    },
    rates,
    missing,
    note: missing.length
      ? "Il funnel sito distingue dati reali, stimati e non collegati. Collegare GA4/Search Console per renderlo decisionale."
      : "Funnel sito collegato: traffico, CTA, form e conversioni leggibili nello stesso blocco."
  };
}

function summarizeManualInventory() {
  const data = loadControlData();
  const items = data.inventoryItems.map((item) => {
    const movements = data.inventoryMovements.filter((movement) => movement.productId === item.id);
    const movementQty = movements.reduce((sum, movement) => {
      const qty = Number(movement.quantity || 0);
      return sum + (movement.type === "scarico" ? -qty : qty);
    }, 0);
    const initialQuantity = Number(item.initialQuantity || 0);
    const currentQuantity = initialQuantity + movementQty;
    return {
      ...item,
      initialQuantity,
      currentQuantity,
      movements: movements.length,
      lowStock: currentQuantity <= Number(item.minQuantity || 0)
    };
  });

  return {
    items,
    movements: data.inventoryMovements.slice(-30).reverse(),
    totalProducts: items.length,
    totalUnits: items.reduce((sum, item) => sum + item.currentQuantity, 0),
    lowStock: items.filter((item) => item.lowStock)
  };
}

async function syncWordPressSource() {
  const wpUrl = process.env.WP_URL || "https://www.skinharmony.it";
  const user = process.env.WP_USER;
  const appPassword = process.env.WP_APP_PASSWORD;
  if (!user || !appPassword) {
    throw new Error("Credenziali WordPress mancanti: WP_USER/WP_APP_PASSWORD.");
  }

  const headers = { Authorization: basicAuth(user, appPassword) };
  const [pages, posts, media] = await Promise.all([
    fetchJson(`${wpUrl}/wp-json/wp/v2/pages?per_page=10&orderby=modified&order=desc`, { headers }),
    fetchJson(`${wpUrl}/wp-json/wp/v2/posts?per_page=10&orderby=modified&order=desc`, { headers }),
    fetchJson(`${wpUrl}/wp-json/wp/v2/media?per_page=10&orderby=date&order=desc`, { headers })
  ]);

  const snapshot = {
    id: `website_api_${Date.now()}`,
    source: "wordpress_api",
    date: new Date().toISOString(),
    visits: 0,
    leads: 0,
    conversionRate: 0,
    pageCountLoaded: Array.isArray(pages) ? pages.length : 0,
    postCountLoaded: Array.isArray(posts) ? posts.length : 0,
    mediaCountLoaded: Array.isArray(media) ? media.length : 0,
    topPage: Array.isArray(pages) ? pages[0]?.link || "" : "",
    recentPages: Array.isArray(pages) ? pages.map((page) => ({
      id: page.id,
      title: page.title?.rendered || "",
      link: page.link,
      modified: page.modified
    })) : [],
    recentPosts: Array.isArray(posts) ? posts.map((post) => ({
      id: post.id,
      title: post.title?.rendered || "",
      link: post.link,
      modified: post.modified
    })) : [],
    note: "WordPress API collegata. Per traffico/visite reali serve Google Analytics o Search Console."
  };

  const data = loadControlData();
  data.websiteSnapshots.push(snapshot);
  saveControlData(data);
  return snapshot;
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function siteUrlForGoogle() {
  return process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || process.env.WP_URL || "https://www.skinharmony.it";
}

async function syncSearchConsoleSource() {
  const siteUrl = siteUrlForGoogle();
  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const payload = {
    startDate: isoDateDaysAgo(28),
    endDate: isoDateDaysAgo(1),
    dimensions: ["date"],
    rowLimit: 1000
  };
  const data = await googleApiRequest(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const rows = Array.isArray(data.rows) ? data.rows : [];
  const snapshot = {
    id: `search_console_${Date.now()}`,
    source: "google_search_console",
    date: new Date().toISOString(),
    siteUrl,
    clicks: rows.reduce((sum, row) => sum + Number(row.clicks || 0), 0),
    impressions: rows.reduce((sum, row) => sum + Number(row.impressions || 0), 0),
    ctr: rows.length ? rows.reduce((sum, row) => sum + Number(row.ctr || 0), 0) / rows.length : 0,
    position: rows.length ? rows.reduce((sum, row) => sum + Number(row.position || 0), 0) / rows.length : 0,
    rows: rows.map((row) => ({
      date: row.keys?.[0] || "",
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr || 0),
      position: Number(row.position || 0)
    })),
    note: "Search Console collegata: traffico organico Google."
  };

  const control = loadControlData();
  control.searchConsoleSnapshots.push(snapshot);
  saveControlData(control);
  return snapshot;
}

async function syncGa4Source() {
  const propertyId = process.env.GA4_PROPERTY_ID || process.env.GOOGLE_ANALYTICS_PROPERTY_ID;
  if (!propertyId) {
    throw new Error("GA4_PROPERTY_ID mancante. Aggiungi l'ID proprieta GA4 nel .env.");
  }

  const endpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const payload = {
    dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "sessions" },
      { name: "engagedSessions" },
      { name: "conversions" },
      { name: "totalUsers" }
    ],
    orderBys: [{ dimension: { dimensionName: "date" } }]
  };
  const data = await googleApiRequest(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  let eventRows = [];
  let eventError = "";
  try {
    const eventPayload = {
      dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
      dimensions: [{ name: "date" }, { name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: {
            values: ["trial_click", "login_click", "demo_click", "lead_form_submit", "smartdesk_cta_click"]
          }
        }
      },
      orderBys: [{ dimension: { dimensionName: "date" } }]
    };
    const eventData = await googleApiRequest(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventPayload)
    });
    eventRows = Array.isArray(eventData.rows) ? eventData.rows : [];
  } catch (error) {
    eventError = error.message;
  }

  const rows = Array.isArray(data.rows) ? data.rows : [];
  const points = rows.map((row) => {
    const metricValues = row.metricValues || [];
    return {
      date: row.dimensionValues?.[0]?.value || "",
      sessions: Number(metricValues[0]?.value || 0),
      engagedSessions: Number(metricValues[1]?.value || 0),
      conversions: Number(metricValues[2]?.value || 0),
      users: Number(metricValues[3]?.value || 0)
    };
  });
  const events = eventRows.map((row) => ({
    date: row.dimensionValues?.[0]?.value || "",
    eventName: row.dimensionValues?.[1]?.value || "",
    eventCount: Number(row.metricValues?.[0]?.value || 0)
  }));
  const eventTotals = events.reduce((acc, event) => {
    acc[event.eventName] = (acc[event.eventName] || 0) + event.eventCount;
    return acc;
  }, {});

  const snapshot = {
    id: `ga4_${Date.now()}`,
    source: "google_analytics_data_api",
    date: new Date().toISOString(),
    propertyId,
    sessions: points.reduce((sum, row) => sum + row.sessions, 0),
    engagedSessions: points.reduce((sum, row) => sum + row.engagedSessions, 0),
    conversions: points.reduce((sum, row) => sum + row.conversions, 0),
    users: points.reduce((sum, row) => sum + row.users, 0),
    rows: points,
    events,
    eventTotals,
    eventError,
    note: eventError
      ? "GA4 collegato per traffico. Eventi CTA non letti: verificare scope/API o configurazione eventi."
      : "GA4 collegato: sessioni, engagement, conversioni ed eventi Smart Desk."
  };

  const control = loadControlData();
  control.ga4Snapshots.push(snapshot);
  saveControlData(control);
  return snapshot;
}

async function syncInstagramSource() {
  const token = process.env.META_ACCESS_TOKEN;
  const igId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || process.env.META_INSTAGRAM_BUSINESS_ID;
  if (!token || !igId) {
    throw new Error("Credenziali Instagram mancanti: META_ACCESS_TOKEN/INSTAGRAM_BUSINESS_ACCOUNT_ID.");
  }

  const graph = "https://graph.facebook.com/v23.0";
  const params = new URLSearchParams({
    access_token: token,
    fields: "id,username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count"
  });
  const account = await fetchJson(`${graph}/${igId}?${params.toString()}`);
  const mediaParams = new URLSearchParams({
    access_token: token,
    fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count",
    limit: "12"
  });
  const media = await fetchJson(`${graph}/${igId}/media?${mediaParams.toString()}`);

  const recentMedia = Array.isArray(media.data) ? media.data : [];
  const snapshot = {
    id: `instagram_api_${Date.now()}`,
    source: "instagram_graph_api",
    date: new Date().toISOString(),
    followers: Number(account.followers_count || 0),
    reach: 0,
    profileVisits: 0,
    leads: 0,
    username: account.username || "",
    mediaCount: Number(account.media_count || 0),
    recentMedia,
    recentEngagement: recentMedia.reduce((sum, item) => sum + Number(item.like_count || 0) + Number(item.comments_count || 0), 0),
    note: "Instagram Graph collegato. Reach/profile visits dipendono dai permessi insights disponibili."
  };

  const data = loadControlData();
  data.instagramSnapshots.push(snapshot);
  saveControlData(data);
  return snapshot;
}

function smartDeskLocalCounts() {
  const dataDir = path.join(rootDir, "smartdesk/data");
  const renderDir = path.join(rootDir, "render-smartdesk-live/data");
  const readArray = (dir, file) => {
    const value = readJson(path.relative(rootDir, path.join(dir, file)), []);
    return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
  };
  const clients = [...readArray(dataDir, "clients.json"), ...readArray(renderDir, "clients.json")];
  const appointments = [...readArray(dataDir, "appointments.json"), ...readArray(renderDir, "appointments.json")];
  const sales = [...readArray(dataDir, "sales.json"), ...readArray(renderDir, "sales.json")];
  const inventory = [...readArray(dataDir, "inventory.json"), ...readArray(renderDir, "inventory.json")];
  const stockAlerts = inventory.filter((item) => Number(item.quantity || item.stock || item.giacenza || 0) <= Number(item.minQuantity || item.min || 0)).length;
  return { clients: clients.length, appointments: appointments.length, sales: sales.length, stockAlerts };
}

async function syncSmartDeskSource() {
  const localCounts = smartDeskLocalCounts();
  let liveHealth = null;
  try {
    liveHealth = await fetchJson("https://skinharmony-smartdesk-live.onrender.com/api/health");
  } catch (_error) {
    try {
      const response = await fetch("https://skinharmony-smartdesk-live.onrender.com/login");
      liveHealth = { loginStatus: response.status };
    } catch (error) {
      liveHealth = { error: error.message };
    }
  }

  const snapshot = {
    id: `smartdesk_api_${Date.now()}`,
    source: "smartdesk_local_live",
    date: new Date().toISOString(),
    ...localCounts,
    liveHealth,
    note: "Conteggi locali Smart Desk + controllo raggiungibilita live. Dati tenant live completi richiedono endpoint autenticato."
  };

  const data = loadControlData();
  data.smartDeskSnapshots.push(snapshot);
  saveControlData(data);
  return snapshot;
}

async function syncRenderSource() {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  const databaseId = process.env.RENDER_DATABASE_ID || "";
  const databaseName = process.env.RENDER_DATABASE_NAME || "skinharmony-db";
  if (!apiKey || !serviceId) {
    throw new Error("Credenziali Render mancanti: RENDER_API_KEY/RENDER_SERVICE_ID.");
  }

  const headers = { Authorization: `Bearer ${apiKey}` };
  const [service, deploys, postgresList, exactDatabaseUsage] = await Promise.all([
    fetchJson(`https://api.render.com/v1/services/${serviceId}`, { headers }),
    fetchJson(`https://api.render.com/v1/services/${serviceId}/deploys?limit=5`, { headers }),
    fetchJson("https://api.render.com/v1/postgres", { headers }).catch((error) => ({
      __error: error.message
    })),
    fetchSmartDeskDatabaseUsage().catch((error) => ({
      __error: error.message
    }))
  ]);
  const postgresItems = Array.isArray(postgresList) ? postgresList : [];
  const selectedPostgres = postgresItems.find((item) => {
    const database = item.postgres || item.database || item;
    return database.id === databaseId || database.name === databaseName;
  }) || postgresItems[0] || null;
  const databaseMeta = selectedPostgres
    ? normalizeRenderPostgres(selectedPostgres)
    : {
      status: "non_letto",
      usageSource: "render_api_meta",
      exactUsageAvailable: false,
      note: postgresList?.__error || "Database Render non trovato nella risposta API."
    };
  const database = exactDatabaseUsage && !exactDatabaseUsage.__error
    ? {
      ...databaseMeta,
      ...exactDatabaseUsage,
      name: databaseMeta.name || exactDatabaseUsage.databaseName || "",
      plan: databaseMeta.plan || "",
      status: databaseMeta.status || "available",
      expiresAt: databaseMeta.expiresAt || "",
      usageSource: "smartdesk_admin_endpoint",
      exactUsageAvailable: true,
      note: "Uso reale letto dal backend Smart Desk dentro Render."
    }
    : {
      ...databaseMeta,
      exactUsageAvailable: false,
      usageError: exactDatabaseUsage?.__error || "",
      note: exactDatabaseUsage?.__error
        ? `Metadati Render letti. Uso reale non disponibile: ${exactDatabaseUsage.__error}`
        : databaseMeta.note
    };

  const snapshot = {
    id: `render_api_${Date.now()}`,
    source: "render_api",
    date: new Date().toISOString(),
    serviceId,
    name: service.name || service.service?.name || "",
    type: service.type || service.service?.type || "",
    repo: service.repo || service.service?.repo || "",
    branch: service.branch || service.service?.branch || "",
    database,
    latestDeploys: Array.isArray(deploys) ? deploys.map((item) => ({
      id: item.deploy?.id || item.id,
      status: item.deploy?.status || item.status,
      commit: item.deploy?.commit?.id || item.commit?.id || "",
      createdAt: item.deploy?.createdAt || item.createdAt
    })) : [],
    note: database.exactUsageAvailable
      ? "Render API collegata con uso database reale."
      : "Render API collegata. Uso database reale da completare con endpoint admin."
  };

  const data = loadControlData();
  data.renderSnapshots.push(snapshot);
  saveControlData(data);
  return snapshot;
}

async function syncGitHubSource() {
  const repo = process.env.GITHUB_REPOSITORY || "cardarellocristian86-debug/skinharmony-ai-backend";
  const branch = process.env.GITHUB_BRANCH || "main";
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const headers = {
    "User-Agent": "SkinHarmony-Control-Desk",
    Accept: "application/vnd.github+json"
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const [repoInfo, commits] = await Promise.all([
    fetchJson(`https://api.github.com/repos/${repo}`, { headers }),
    fetchJson(`https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=8`, { headers })
  ]);

  const snapshot = {
    id: `github_api_${Date.now()}`,
    source: token ? "github_api_token" : "github_api_public",
    date: new Date().toISOString(),
    repo,
    branch,
    defaultBranch: repoInfo.default_branch || "",
    pushedAt: repoInfo.pushed_at || "",
    openIssues: Number(repoInfo.open_issues_count || 0),
    recentCommits: Array.isArray(commits) ? commits.map((commit) => ({
      sha: String(commit.sha || "").slice(0, 10),
      message: commit.commit?.message || "",
      date: commit.commit?.author?.date || "",
      author: commit.commit?.author?.name || ""
    })) : [],
    note: token ? "GitHub API collegata con token." : "GitHub API pubblica collegata. Per repo privati serve GITHUB_TOKEN/GH_TOKEN."
  };

  const data = loadControlData();
  data.githubSnapshots.push(snapshot);
  saveControlData(data);
  return snapshot;
}

function buildAlerts(campaigns, behavior) {
  const alerts = [];
  const averageResponseRate = campaigns.length
    ? campaigns.reduce((sum, campaign) => sum + campaign.responseRate, 0) / campaigns.length
    : 0;
  const now = new Date();

  for (const campaign of campaigns) {
    if (campaign.sends > 0 && campaign.responseRate < 0.02) {
      alerts.push({ level: "critico", type: "low_response", message: `${campaign.label}: tasso risposta sotto 2%.` });
    }
    if (campaign.sends > 0 && campaign.customers === 0) {
      alerts.push({ level: "attenzione", type: "zero_customers", message: `${campaign.label}: 0 clienti collegati alla campagna.` });
    }
    if (campaign.responseRate > averageResponseRate && campaign.sends > 0) {
      alerts.push({ level: "positivo", type: "above_average", message: `${campaign.label}: campagna sopra la media risposta.` });
    }
  }

  for (const lead of behavior) {
    const lastAction = lead.azioni.at(-1)?.sentAt || "";
    if (!lastAction || ["cliente", "perso"].includes(lead.stato)) continue;
    const days = Math.floor((now.getTime() - new Date(lastAction).getTime()) / 864e5);
    if (days > 5 && lead.followUp === 0) {
      alerts.push({
        level: "attenzione",
        type: "lead_no_followup",
        message: `${lead.nome || lead.contatto}: lead senza follow-up da ${days} giorni.`
      });
    }
  }

  return alerts;
}

function rateForRange(events, startDate, endDate) {
  const start = startDate.getTime();
  const end = endDate.getTime();
  const items = events.filter((event) => {
    const time = new Date(event.data || "").getTime();
    return Number.isFinite(time) && time >= start && time < end;
  });
  const sends = items.filter((event) => event.tipo === "invio").length;
  const replies = items.filter((event) => event.tipo === "risposta").length;
  return {
    sends,
    replies,
    responseRate: sends ? replies / sends : 0
  };
}

function buildDecisionSummary(campaigns, behavior, economics, alerts) {
  const totalSends = campaigns.reduce((sum, campaign) => sum + campaign.sends, 0);
  const totalReplies = campaigns.reduce((sum, campaign) => sum + campaign.replies, 0);
  const responseRate = totalSends ? totalReplies / totalSends : 0;
  const criticalAlerts = alerts.filter((alert) => alert.level === "critico").length;
  const warningAlerts = alerts.filter((alert) => alert.level === "attenzione").length;
  const bestCampaign = campaigns
    .filter((campaign) => campaign.sends > 0)
    .sort((a, b) => b.responseRate - a.responseRate)[0] || null;
  const weakCampaign = campaigns
    .filter((campaign) => campaign.sends > 0)
    .sort((a, b) => a.responseRate - b.responseRate)[0] || null;

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setUTCDate(fourteenDaysAgo.getUTCDate() - 14);
  const events = loadOutreachEvents();
  const last7 = rateForRange(events, sevenDaysAgo, now);
  const previous7 = rateForRange(events, fourteenDaysAgo, sevenDaysAgo);
  const trendDelta = last7.responseRate - previous7.responseRate;

  let status = "ok";
  let headline = "Performance sotto controllo";
  if (responseRate < 0.02 && totalSends > 0) {
    status = "critical";
    headline = "Performance attuale: CRITICA";
  } else if (responseRate < 0.2 && totalSends > 0) {
    status = "warning";
    headline = "Performance attuale: DA CORREGGERE";
  }

  const staleLeads = behavior.filter((lead) => {
    const lastAction = lead.azioni.at(-1)?.sentAt || "";
    if (!lastAction || ["cliente", "perso"].includes(lead.stato)) return false;
    const days = Math.floor((now.getTime() - new Date(lastAction).getTime()) / 864e5);
    return days > 5 && lead.followUp === 0;
  });

  const nextActions = [];
  if (weakCampaign && weakCampaign.responseRate < 0.02) {
    nextActions.push({
      priority: "critico",
      title: `${weakCampaign.label}: cambia messaggio prima di aumentare volume`,
      detail: `Tasso risposta ${Math.round(weakCampaign.responseRate * 100)}% con ${weakCampaign.sends} invii.`
    });
  }
  if (staleLeads.length > 0) {
    nextActions.push({
      priority: "attenzione",
      title: `${staleLeads.length} lead senza follow-up oltre 5 giorni`,
      detail: "Apri comportamento lead e salva follow-up o stato reale."
    });
  }
  if (bestCampaign && bestCampaign.responseRate > responseRate) {
    nextActions.push({
      priority: "ok",
      title: `${bestCampaign.label}: campagna sopra media`,
      detail: "Mantieni il posizionamento e verifica se genera trattative, non solo risposte."
    });
  }
  if (economics.sales.length === 0) {
    nextActions.push({
      priority: "attenzione",
      title: "Collega almeno le prime vendite ai lead",
      detail: "Senza prodotto, prezzo e costo stimato non si vede il margine reale."
    });
  }

  return {
    status,
    headline,
    responseRate,
    totalSends,
    totalReplies,
    criticalAlerts,
    warningAlerts,
    last7,
    previous7,
    trendDelta,
    trendLabel: `${trendDelta >= 0 ? "+" : ""}${Math.round(trendDelta * 100)} punti vs 7 giorni precedenti`,
    bestCampaign: bestCampaign ? { id: bestCampaign.id, label: bestCampaign.label, responseRate: bestCampaign.responseRate } : null,
    weakCampaign: weakCampaign ? { id: weakCampaign.id, label: weakCampaign.label, responseRate: weakCampaign.responseRate } : null,
    nextActions: nextActions.slice(0, 4)
  };
}

function dayKey(value) {
  return dateOnly(value || new Date().toISOString());
}

function buildDailySeries(items, dateGetter, reducer) {
  const days = new Map();
  for (const item of items || []) {
    const day = dayKey(dateGetter(item));
    if (!day) continue;
    if (!days.has(day)) days.set(day, { date: day });
    reducer(days.get(day), item);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function summarizeDataQuality(sources, economics, manualInventory) {
  const checks = [
    { key: "website", label: "Sito", ok: Boolean(sources.website?.analytics || sources.website?.searchConsole || sources.website?.latest), detail: sources.website?.analytics ? "GA4 collegato" : sources.website?.searchConsole ? "Search Console collegata" : sources.website?.latest ? "WordPress collegato" : "Manca traffico sito" },
    { key: "instagram", label: "Instagram", ok: sources.instagram?.status === "api_attivo", detail: sources.instagram?.status === "api_attivo" ? "Meta API attiva" : "Manca token Meta valido" },
    { key: "smartdesk", label: "Gestionale", ok: Boolean(sources.smartDesk?.latest), detail: sources.smartDesk?.latest ? "Smart Desk letto" : "Manca sync Smart Desk" },
    { key: "sales", label: "Vendite", ok: economics.sales.length > 0, detail: economics.sales.length ? `${economics.sales.length} vendite collegate` : "Mancano vendite collegate ai lead" },
    { key: "margin", label: "Margine", ok: economics.sales.some((sale) => Number(sale.estimatedCost || 0) > 0), detail: economics.sales.some((sale) => Number(sale.estimatedCost || 0) > 0) ? "Costi stimati presenti" : "Mancano costi stimati" },
    { key: "inventory", label: "Magazzino", ok: manualInventory.items.length > 0, detail: manualInventory.items.length ? `${manualInventory.items.length} prodotti caricati` : "Manca anagrafica magazzino" }
  ];
  const score = Math.round((checks.filter((item) => item.ok).length / checks.length) * 100);
  return {
    score,
    checks,
    missing: checks.filter((item) => !item.ok),
    status: score >= 80 ? "buona" : score >= 50 ? "parziale" : "debole"
  };
}

function summarizeProductivity(campaigns, behavior, economics, manualInventory, agenda) {
  const data = loadControlData();
  const timeline = buildOutreachTimeline();
  const interactions = data.interactions || [];
  const sales = economics.sales || [];
  const movements = data.inventoryMovements || [];
  const logs = data.productivityLogs || [];
  const today = new Date().toISOString().slice(0, 10);
  const todayTimeline = timeline.find((item) => item.date === today) || {};
  const todayInteractions = interactions.filter((item) => dayKey(item.date) === today).length;
  const todaySales = sales.filter((item) => dayKey(item.date) === today);
  const todayMovements = movements.filter((item) => dayKey(item.date) === today).length;
  const todayLog = logs.filter((item) => item.date === today);
  const hoursToday = todayLog.reduce((sum, item) => sum + Number(item.hours || 0), 0);
  const manualActionsToday = todayLog.reduce((sum, item) => sum + Number(item.actions || 0), 0);
  const outputScore =
    Number(todayTimeline.sends || 0) +
    Number(todayTimeline.replies || 0) * 5 +
    todayInteractions * 2 +
    todaySales.length * 10 +
    todayMovements +
    manualActionsToday;

  const seriesMap = new Map();
  const merge = (row) => {
    if (!seriesMap.has(row.date)) {
      seriesMap.set(row.date, { date: row.date, sends: 0, replies: 0, interactions: 0, sales: 0, revenue: 0, margin: 0, inventoryMovements: 0, hours: 0, actions: 0 });
    }
    Object.entries(row).forEach(([key, value]) => {
      if (key !== "date") seriesMap.get(row.date)[key] = Number(seriesMap.get(row.date)[key] || 0) + Number(value || 0);
    });
  };

  timeline.forEach((item) => merge({ date: item.date, sends: item.sends, replies: item.replies }));
  buildDailySeries(interactions, (item) => item.date, (day) => { day.interactions = Number(day.interactions || 0) + 1; }).forEach(merge);
  buildDailySeries(sales, (item) => item.date, (day, sale) => {
    day.sales = Number(day.sales || 0) + 1;
    day.revenue = Number(day.revenue || 0) + Number(sale.price || 0);
    day.margin = Number(day.margin || 0) + Number(sale.margin || 0);
  }).forEach(merge);
  buildDailySeries(movements, (item) => item.date, (day) => { day.inventoryMovements = Number(day.inventoryMovements || 0) + 1; }).forEach(merge);
  logs.forEach((item) => merge({ date: item.date, hours: item.hours, actions: item.actions }));

  return {
    today: {
      date: today,
      sends: Number(todayTimeline.sends || 0),
      replies: Number(todayTimeline.replies || 0),
      interactions: todayInteractions,
      sales: todaySales.length,
      revenue: todaySales.reduce((sum, sale) => sum + Number(sale.price || 0), 0),
      margin: todaySales.reduce((sum, sale) => sum + Number(sale.margin || 0), 0),
      inventoryMovements: todayMovements,
      openTasks: agenda.totalOpenTodos,
      hours: hoursToday,
      manualActions: manualActionsToday,
      outputScore
    },
    series: [...seriesMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    logs: logs.slice(-30).reverse(),
    manualInventoryStatus: {
      totalProducts: manualInventory.totalProducts,
      lowStock: manualInventory.lowStock.length
    }
  };
}

function buildExecutiveSummary(campaigns, behavior, economics, inventory, manualInventory, social, sources, alerts, productivity, dataQuality) {
  const totalSends = campaigns.reduce((sum, item) => sum + item.sends, 0);
  const totalReplies = campaigns.reduce((sum, item) => sum + item.replies, 0);
  const responseRate = totalSends ? totalReplies / totalSends : 0;
  const instagram = sources.instagram?.latest || {};
  const siteConnected = Boolean(sources.website?.analytics || sources.website?.searchConsole);
  const marginRate = economics.totalRevenue ? economics.totalMargin / economics.totalRevenue : 0;
  const bestCampaign = campaigns.filter((item) => item.sends > 0).sort((a, b) => b.responseRate - a.responseRate)[0] || null;
  const weakCampaign = campaigns.filter((item) => item.sends > 0).sort((a, b) => a.responseRate - b.responseRate)[0] || null;
  const strategicActions = [];

  if (!siteConnected) strategicActions.push({ level: "attenzione", title: "Collega traffico sito reale", detail: "GA4/Search Console servono per capire quali pagine generano domanda." });
  if (responseRate < 0.02 && totalSends > 0) strategicActions.push({ level: "critico", title: "Rivedi messaggio del target debole", detail: `${weakCampaign?.label || "Campagna"} sotto 2%: non aumentare volume prima di cambiare angolo.` });
  if (economics.sales.length === 0) strategicActions.push({ level: "critico", title: "Collega vendite ai lead", detail: "Senza vendite e margine il sistema non puo dire quale marketing produce soldi." });
  if (manualInventory.totalProducts === 0) strategicActions.push({ level: "attenzione", title: "Carica magazzino iniziale", detail: "Serve per leggere prodotti fermi, sottoscorta e pressione commerciale." });
  if (bestCampaign && bestCampaign.responseRate > responseRate) strategicActions.push({ level: "positivo", title: `Mantieni ${bestCampaign.label}`, detail: "E il target con risposta migliore: ora va misurato su trattative e vendite." });

  return {
    cards: [
      { label: "Marketing", value: `${Math.round(responseRate * 100)}% risposta`, status: responseRate < 0.02 && totalSends > 0 ? "critico" : responseRate < 0.2 && totalSends > 0 ? "attenzione" : "ok", detail: `${totalSends} invii, ${totalReplies} risposte` },
      { label: "Vendite", value: moneyLike(economics.totalRevenue), status: economics.sales.length ? "ok" : "attenzione", detail: `${economics.sales.length} vendite collegate` },
      { label: "Margine", value: `${Math.round(marginRate * 100)}%`, status: economics.sales.length ? marginRate > 0.35 ? "ok" : "attenzione" : "attenzione", detail: moneyLike(economics.totalMargin) },
      { label: "Produttivita", value: String(productivity.today.outputScore), status: productivity.today.outputScore > 20 ? "ok" : "attenzione", detail: `${productivity.today.sends} invii, ${productivity.today.sales} vendite oggi` },
      { label: "Instagram", value: `${instagram.followers || 0} follower`, status: sources.instagram?.status === "api_attivo" ? "ok" : "attenzione", detail: `${instagram.mediaCount || 0} media letti` },
      { label: "Qualita dati", value: `${dataQuality.score}%`, status: dataQuality.score >= 80 ? "ok" : dataQuality.score >= 50 ? "attenzione" : "critico", detail: dataQuality.status }
    ],
    strategicActions: strategicActions.slice(0, 6),
    strategyBrief: [
      responseRate < 0.02 && totalSends > 0 ? "La priorita marketing e cambiare messaggio sul target debole, non aumentare volume." : "Il marketing ha dati leggibili: ora va collegato alle vendite.",
      economics.sales.length === 0 ? "La prima lacuna manageriale e economica: registra ogni vendita con prezzo, costo e campagna." : `Fatturato tracciato ${moneyLike(economics.totalRevenue)} con margine ${moneyLike(economics.totalMargin)}.`,
      dataQuality.score < 80 ? `Dati ancora parziali: mancano ${dataQuality.missing.map((item) => item.label).join(", ")}.` : "La base dati e abbastanza completa per decisioni operative.",
      alerts.length ? `Alert da guardare: ${alerts.slice(0, 2).map((item) => item.message).join(" ")}` : "Nessun alert critico immediato."
    ]
  };
}

function moneyLike(value) {
  return `${Math.round(Number(value || 0))} EUR`;
}

function summarizeAgenda() {
  const appointments = readJson("agenda/appuntamenti.json", { appuntamenti: [] }).appuntamenti || [];
  const todos = readJson("agenda/todo.json", { attivita: [] }).attivita || [];
  const today = new Date().toISOString().slice(0, 10);

  return {
    today,
    appointmentsToday: appointments.filter((item) => String(item.data || "").startsWith(today)),
    openTodos: todos.filter((item) => item.stato !== "completata").slice(0, 20),
    totalOpenTodos: todos.filter((item) => item.stato !== "completata").length
  };
}

function extractRecentMemory() {
  const text = readText("AGENTS.md");
  const matches = [...text.matchAll(/^## Registro sessione - .+$/gm)];
  const last = matches.slice(-6).map((match) => {
    const start = match.index;
    const next = text.indexOf("\n## ", start + 1);
    return text.slice(start, next === -1 ? text.length : next).trim();
  });

  return last;
}

function runCommand(command, args = []) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      shell: false,
      env: process.env
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function buildControlContext() {
  const campaigns = summarizeCampaigns();
  const leads = summarizeLeads();
  const behavior = summarizeBehavior();
  const economics = summarizeEconomics(campaigns);
  const inventory = summarizeInventory(economics);
  const social = summarizeSocial();
  const sources = summarizeDataSources();
  const manualInventory = summarizeManualInventory();
  const alerts = buildAlerts(campaigns, behavior);
  const decision = buildDecisionSummary(campaigns, behavior, economics, alerts);
  const agenda = summarizeAgenda();
  const productivity = summarizeProductivity(campaigns, behavior, economics, manualInventory, agenda);
  const dataQuality = summarizeDataQuality(sources, economics, manualInventory);
  const executive = buildExecutiveSummary(campaigns, behavior, economics, inventory, manualInventory, social, sources, alerts, productivity, dataQuality);
  const websiteFunnel = summarizeWebsiteFunnel();

  return {
    generatedAt: new Date().toISOString(),
    campaigns,
    decision,
    timeline: buildOutreachTimeline(),
    leads,
    funnel: leads.funnel,
    actions: summarizeActions(),
    behavior,
    economics,
    inventory,
    manualInventory,
    social,
    sources,
    websiteFunnel,
    dataQuality,
    productivity,
    executive,
    alerts,
    agenda
  };
}

function normalizeLevel(level) {
  if (["critical", "critico"].includes(level)) return "critico";
  if (["warning", "attenzione", "mancante", "incompleto", "eventi_mancanti"].includes(level)) return "attenzione";
  if (["ok", "positivo", "attivo", "api_attivo", "manuale_attivo"].includes(level)) return "ok";
  return "neutro";
}

function buildNyraPriorityQueue(context = buildControlContext()) {
  const queue = [];
  const push = (level, title, detail, origin) => {
    if (!title) return;
    queue.push({
      level: normalizeLevel(level),
      title,
      detail: detail || "",
      origin: origin || "system"
    });
  };

  (context.decision?.nextActions || []).forEach((item) => push(item.priority, item.title, item.detail, "decision"));
  (context.executive?.strategicActions || []).forEach((item) => push(item.level, item.title, item.detail, "executive"));
  (context.alerts || []).slice(0, 8).forEach((item) => push(item.level, item.type, item.message, "alert"));
  (context.dataQuality?.missing || []).forEach((item) => push("attenzione", `Dato mancante: ${item.label}`, item.detail, "quality"));

  const weight = { critico: 0, attenzione: 1, ok: 2, neutro: 3 };
  return queue
    .sort((a, b) => (weight[a.level] ?? 3) - (weight[b.level] ?? 3))
    .slice(0, 12);
}

function pushUniqueNyraItem(bucket, title, detail, level, origin) {
  if (!title) return;
  const key = `${title}|${detail}`;
  if (bucket.some((item) => `${item.title}|${item.detail}` === key)) return;
  bucket.push({
    title,
    detail: detail || "",
    level: normalizeLevel(level),
    origin: origin || "system"
  });
}

function buildNyraTempoBuckets(context = buildControlContext(), queue = buildNyraPriorityQueue(context)) {
  const buckets = {
    now: [],
    next: [],
    blocked: [],
    watch: []
  };

  queue.forEach((item, index) => {
    if (index === 0 || item.level === "critico") {
      pushUniqueNyraItem(buckets.now, item.title, item.detail, item.level, item.origin);
    } else {
      pushUniqueNyraItem(buckets.next, item.title, item.detail, item.level, item.origin);
    }
  });

  (context.dataQuality?.missing || []).forEach((item) => {
    pushUniqueNyraItem(buckets.blocked, `Blocco dati: ${item.label}`, item.detail, "attenzione", "quality");
  });

  Object.entries(context.sources || {}).forEach(([key, source]) => {
    const status = String(source?.status || "");
    if (status.includes("da_collegare") || status === "pronto") {
      pushUniqueNyraItem(buckets.blocked, `Fonte non collegata: ${key}`, "Il feed non e ancora abbastanza affidabile per decidere forte.", "attenzione", "runtime");
    }
  });

  (context.websiteFunnel?.missing || []).forEach((item) => {
    pushUniqueNyraItem(buckets.blocked, "Funnel incompleto", item, "attenzione", "website");
  });

  (context.alerts || []).slice(0, 6).forEach((item) => {
    if (normalizeLevel(item.level) === "attenzione") {
      pushUniqueNyraItem(buckets.watch, item.type, item.message, item.level, "alert");
    }
  });

  if (!buckets.now.length) {
    pushUniqueNyraItem(buckets.now, "Nessuna pressione dominante", "Non emerge una frizione abbastanza forte da cambiare il focus.", "neutro", "system");
  }
  if (!buckets.next.length) {
    pushUniqueNyraItem(buckets.next, "Nessuna mossa successiva forte", "Dopo la priorita attuale, il resto e secondario.", "neutro", "system");
  }
  if (!buckets.blocked.length) {
    pushUniqueNyraItem(buckets.blocked, "Nessun blocco dominante", "Non risultano impedimenti strutturali forti.", "ok", "system");
  }
  if (!buckets.watch.length) {
    pushUniqueNyraItem(buckets.watch, "Monitoraggio attivo", "I segnali deboli restano sotto la soglia di reazione.", "neutro", "system");
  }

  return {
    now: buckets.now.slice(0, 4),
    next: buckets.next.slice(0, 4),
    blocked: buckets.blocked.slice(0, 4),
    watch: buckets.watch.slice(0, 4)
  };
}

function buildNyraConfidenceLayer(context = buildControlContext()) {
  const salesWithCosts = context.economics.sales.some((sale) => Number(sale.estimatedCost || 0) > 0);
  return [
    {
      label: "Website",
      state: context.websiteFunnel.status === "attivo" ? "reale" : context.websiteFunnel.status === "eventi_mancanti" ? "incompleto" : "non collegato",
      detail: context.websiteFunnel.note
    },
    {
      label: "Instagram",
      state: context.sources.instagram?.status === "api_attivo" ? "reale" : "non collegato",
      detail: context.sources.instagram?.latest ? "Snapshot social disponibile." : "Snapshot social assente."
    },
    {
      label: "Smart Desk",
      state: context.sources.smartDesk?.latest ? "reale" : "incompleto",
      detail: context.sources.smartDesk?.latest ? "Snapshot gestionale disponibile." : "Manca snapshot recente del gestionale."
    },
    {
      label: "Revenue",
      state: context.economics.sales.length > 0 ? "reale" : "incompleto",
      detail: context.economics.sales.length > 0 ? "Vendite collegate presenti." : "Mancano vendite collegate ai lead."
    },
    {
      label: "Margin",
      state: salesWithCosts ? "reale" : context.economics.sales.length > 0 ? "stimato" : "incompleto",
      detail: salesWithCosts ? "Costi presenti." : context.economics.sales.length > 0 ? "Margine parziale o stimato." : "Nessuna base economica sufficiente."
    },
    {
      label: "Runtime",
      state: context.sources.render?.latest ? "reale" : "incompleto",
      detail: context.sources.render?.latest ? "Runtime leggibile." : "Manca uno snapshot runtime coerente."
    }
  ];
}

function buildNyraSegmentedQueue(context = buildControlContext(), queue = buildNyraPriorityQueue(context)) {
  const groups = {
    commerciale: [],
    operativa: [],
    tecnica: [],
    strategica: []
  };

  const put = (group, item) => {
    if (!groups[group]) return;
    groups[group].push(item);
  };

  queue.forEach((item) => {
    if (item.origin === "decision" || item.origin === "alert") put("commerciale", item);
    else if (item.origin === "quality" || item.origin === "runtime") put("tecnica", item);
    else put("strategica", item);
  });

  if (context.agenda?.totalOpenTodos > 0) {
    put("operativa", {
      title: `${context.agenda.totalOpenTodos} task aperti`,
      detail: "Il carico operativo manuale va ridotto o trasformato in azione chiusa.",
      level: "attenzione",
      origin: "agenda"
    });
  }

  Object.keys(groups).forEach((group) => {
    if (!groups[group].length) {
      groups[group].push({
        title: "Nessuna pressione dominante",
        detail: "Non emerge una frizione forte in questo dominio.",
        level: "neutro",
        origin: group
      });
    }
  });

  return groups;
}

function buildNyraControlDirective(context = buildControlContext()) {
  const queue = buildNyraPriorityQueue(context);
  const tempo = buildNyraTempoBuckets(context, queue);
  const confidence = buildNyraConfidenceLayer(context);
  const segmented = buildNyraSegmentedQueue(context, queue);

  const primary = tempo.now[0] || queue[0] || {
    title: context.decision?.headline || "Nessuna pressione dominante",
    detail: "Il sistema non vede ancora una frizione abbastanza forte.",
    level: normalizeLevel(context.decision?.status),
    origin: "system"
  };

  return {
    doctrine: {
      title: "Nyra command doctrine",
      summary: "Una priorita dominante. Una prossima mossa verificabile. Niente rumore se non cambia la decisione."
    },
    primary,
    tempo,
    queue,
    confidence,
    segmented,
    financeDockReadiness: {
      economicFeedReady: context.economics.sales.length > 0,
      runtimeFeedReady: Boolean(context.sources.render?.latest && context.sources.smartDesk?.latest),
      flowFeedReady: Boolean(context.campaigns.length && context.funnel?.total),
      note: "Il desk finanziario deve entrare come workspace separato, non come card dispersa nella home."
    }
  };
}

function compactAssistantContext(context) {
  const instagram = context.sources.instagram?.latest || {};
  return {
    generatedAt: context.generatedAt,
    decision: context.decision,
    executive: context.executive,
    dataQuality: context.dataQuality,
    productivity: {
      today: context.productivity.today,
      recentSeries: context.productivity.series.slice(-14),
      recentLogs: context.productivity.logs.slice(0, 10)
    },
    campaigns: context.campaigns.map((campaign) => ({
      id: campaign.id,
      label: campaign.label,
      sends: campaign.sends,
      replies: campaign.replies,
      responseRate: campaign.responseRate,
      generatedLeads: campaign.generatedLeads,
      negotiations: campaign.negotiations,
      customers: campaign.customers,
      status: campaign.status,
      textIds: campaign.textIds,
      statusCounts: campaign.statusCounts
    })),
    funnel: context.funnel,
    leads: {
      files: context.leads.files.slice(0, 12),
      latest: context.leads.latest.slice(0, 25).map((lead) => ({
        nome: lead.nome,
        contatto: lead.contatto,
        tipo: lead.tipo,
        stato: lead.stato,
        response: lead.response,
        followUpCount: lead.followUpCount,
        ultimaAzione: lead.ultimaAzione
      }))
    },
    behavior: context.behavior.slice(0, 25).map((lead) => ({
      nome: lead.nome,
      contatto: lead.contatto,
      stato: lead.stato,
      risposta: lead.risposta,
      tempoRisposta: lead.tempoRisposta,
      followUp: lead.followUp
    })),
    economics: {
      totalRevenue: context.economics.totalRevenue,
      totalMargin: context.economics.totalMargin,
      salesCount: context.economics.sales.length,
      topProduct: context.economics.topProduct,
      revenueByCampaign: context.economics.revenueByCampaign
    },
    inventory: {
      productsSold: context.inventory.productsSold,
      stationaryProducts: context.inventory.stationaryProducts,
      manual: {
        totalProducts: context.manualInventory.totalProducts,
        totalUnits: context.manualInventory.totalUnits,
        lowStock: context.manualInventory.lowStock
      }
    },
    social: {
      totalLeadGenerated: context.social.totalLeadGenerated,
      contents: context.social.contents.slice(-20),
      instagram: {
        username: instagram.username,
        followers: instagram.followers,
        mediaCount: instagram.mediaCount,
        recentEngagement: instagram.recentEngagement,
        recentMedia: (instagram.recentMedia || []).slice(0, 8).map((media) => ({
          media_type: media.media_type,
          timestamp: media.timestamp,
          like_count: media.like_count,
          comments_count: media.comments_count,
          permalink: media.permalink,
          caption: String(media.caption || "").slice(0, 420)
        }))
      }
    },
    sources: {
      website: {
        status: context.sources.website?.status,
        mode: context.sources.website?.mode,
        analyticsConnected: Boolean(context.sources.website?.analytics),
        searchConsoleConnected: Boolean(context.sources.website?.searchConsole),
        latest: context.sources.website?.latest,
        analytics: context.sources.website?.analytics ? {
          sessions: context.sources.website.analytics.sessions,
          engagedSessions: context.sources.website.analytics.engagedSessions,
          conversions: context.sources.website.analytics.conversions,
          users: context.sources.website.analytics.users
        } : null,
        searchConsole: context.sources.website?.searchConsole ? {
          clicks: context.sources.website.searchConsole.clicks,
          impressions: context.sources.website.searchConsole.impressions,
          ctr: context.sources.website.searchConsole.ctr,
          position: context.sources.website.searchConsole.position
        } : null
      },
      instagram: {
        status: context.sources.instagram?.status,
        mode: context.sources.instagram?.mode
      },
      smartDesk: {
        status: context.sources.smartDesk?.status,
        latest: context.sources.smartDesk?.latest
      }
    },
    websiteFunnel: context.websiteFunnel,
    alerts: context.alerts,
    agenda: {
      today: context.agenda.today,
      totalOpenTodos: context.agenda.totalOpenTodos,
      openTodos: context.agenda.openTodos.slice(0, 12)
    }
  };
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function logAiUsage({ question, mode, scope, model, inputText, outputText }) {
  const data = loadControlData();
  data.aiLogs.push({
    id: `ai_log_${Date.now()}`,
    date: new Date().toISOString(),
    mode,
    scope,
    model: model || "",
    question: String(question || "").slice(0, 500),
    estimatedInputTokens: estimateTokens(inputText),
    estimatedOutputTokens: estimateTokens(outputText)
  });
  saveControlData(data);
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Risposta AI non in formato JSON.");
    return JSON.parse(match[0]);
  }
}

function buildLocalStrategyAnswer(question, context = buildControlContext()) {
  const { campaigns, leads, agenda, timeline, behavior, economics, alerts, productivity, dataQuality, executive } = context;
  const totalSends = campaigns.reduce((sum, item) => sum + item.sends, 0);
  const totalReplies = campaigns.reduce((sum, item) => sum + item.replies, 0);
  const responseRate = totalSends ? totalReplies / totalSends : 0;
  const weakCampaigns = campaigns.filter((item) => item.sends > 0 && item.responseRate < 0.2);
  const latestDay = timeline.at(-1);
  const recentLeadFiles = leads.files.slice(0, 5);

  const lines = [];
  lines.push(`Ho letto i dati locali aggiornati. Invii totali: ${totalSends}, risposte tracciate: ${totalReplies}, tasso medio: ${Math.round(responseRate * 100)}%.`);
  lines.push(`Qualita dati direzionali: ${dataQuality.score}% (${dataQuality.status}). Produttivita oggi: indice ${productivity.today.outputScore}, ${productivity.today.sends} invii, ${productivity.today.interactions} interazioni, ${productivity.today.sales} vendite.`);

  if (latestDay) {
    lines.push(`Ultimo giorno con movimento: ${latestDay.date}, con ${latestDay.sends} invii e ${latestDay.replies} risposte registrate.`);
  }

  if (weakCampaigns.length > 0) {
    lines.push(`Campagne sotto soglia 20%: ${weakCampaigns.map((item) => `${item.label} (${Math.round(item.responseRate * 100)}%)`).join(", ")}.`);
  } else {
    lines.push("Nessuna campagna risulta sotto soglia sui dati attuali.");
  }

  const lowerQuestion = question.toLowerCase();
  if (lowerQuestion.includes("strategy") || lowerQuestion.includes("strategia") || lowerQuestion.includes("marketing")) {
    lines.push("Strategia consigliata: separare i prossimi messaggi per target, mantenendo un angolo diverso per ogni segmento.");
    lines.push("Distributori: spingere ecosistema commerciale SkinPro + Smart Desk, non solo prodotto. Parrucchieri: partire da O3 System e usare Smart Desk come controllo salone. Estetiste: partire da Skin Pro e usare Smart Desk come gestione centro.");
    lines.push("Prima di inviare nuovi batch, aspetterei le risposte dei follow-up appena mandati e misurerei quali target superano il 20%.");
  } else if (lowerQuestion.includes("risposte") || lowerQuestion.includes("follow")) {
    lines.push("Priorità follow-up: controllare risposte ogni giorno, segnare positive/negative e non reinviare a chi ha già risposto negativamente.");
    lines.push("Il ciclo corretto resta 10 giorni: dopo la finestra, se il tasso rimane sotto 20%, va cambiato testo, target o proposta.");
  } else if (lowerQuestion.includes("lead") || lowerQuestion.includes("contatti")) {
    lines.push(`I file lead più pieni sono: ${recentLeadFiles.map((item) => `${item.file.replace("lead/", "")} (${item.count})`).join(", ")}.`);
    lines.push("Operativamente conviene lavorare sui lead nuovi separati per area, così resta chiaro cosa è stato cercato, contattato e monitorato.");
  } else {
    lines.push("Prossima azione consigliata: monitorare risposte, non aumentare troppo il volume oggi, e preparare una revisione messaggio solo dopo avere dati sui follow-up Smart Desk.");
  }

  if (agenda.totalOpenTodos > 0) {
    lines.push(`Task aperti nel Control Desk: ${agenda.totalOpenTodos}. Vanno chiusi o trasformati in prossime azioni giornaliere.`);
  }

  if (alerts.length > 0) {
    lines.push(`Alert attivi: ${alerts.slice(0, 3).map((alert) => alert.message).join(" ")}`);
  }

  if (economics.sales.length > 0) {
    lines.push(`Parte economica: fatturato tracciato ${economics.totalRevenue} EUR, margine tracciato ${economics.totalMargin} EUR.`);
  } else {
    lines.push("Parte economica: non risultano ancora vendite manuali collegate ai lead. Quando un lead diventa cliente, va registrato prodotto, prezzo e costo stimato.");
  }

  if (executive.strategicActions.length > 0) {
    lines.push(`Direzione consigliata: ${executive.strategicActions.map((item) => `${item.title}: ${item.detail}`).join(" ")}`);
  }

  return {
    answer: lines.join("\n\n"),
    usedData: {
      campaigns,
      timelinePoints: timeline.length,
      leadFiles: leads.files.length,
      openTodos: agenda.totalOpenTodos,
      alerts: alerts.length,
      sales: economics.sales.length,
      dataQuality: dataQuality.score,
      productivityScore: productivity.today.outputScore
    }
  };
}

async function callOpenAIAssistant(question, context) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY mancante nel .env.");
  }

  const model = process.env.OPENAI_ASSISTANT_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const compactContext = compactAssistantContext(context);
  const response = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            "Sei l'assistente operativo AI di SkinHarmony Control Desk.",
            "Rispondi in italiano, tono diretto, premium, concreto.",
            "Se il dato manca, dichiaralo. Non inventare numeri, vendite, margini, prezzi, insight o risultati.",
            "Puoi ragionare liberamente su strategia marketing, vendite, produttivita, priorita, copy, follow-up e prossime azioni, ma devi separare dati reali da ipotesi.",
            "Non inviare messaggi, non modificare prezzi, non modificare dati e non promettere risultati medici o terapeutici.",
            "Quando utile, dai una decisione: cosa fare oggi, cosa evitare, quale dato manca, quale test lanciare.",
            "Mantieni la risposta leggibile: priorita, diagnosi, azioni operative."
          ].join(" ")
        },
        {
          role: "user",
          content: `Domanda: ${question}\n\nDati reali disponibili in JSON:\n${JSON.stringify(compactContext)}`
        }
      ],
      max_output_tokens: 1200
    })
  });

  const outputText = response.output_text
    || (response.output || [])
      .flatMap((item) => item.content || [])
      .map((item) => item.text || "")
      .join("\n")
      .trim();

  if (!outputText) {
    throw new Error("OpenAI non ha restituito testo.");
  }

  return {
    answer: outputText,
    model,
    usedData: {
      dataQuality: context.dataQuality.score,
      productivityScore: context.productivity.today.outputScore,
      campaigns: context.campaigns.length,
      alerts: context.alerts.length,
      sales: context.economics.sales.length
    }
  };
}

async function callOpenAIAction({ prompt, scope, cardType, mode, context }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY mancante nel .env.");
  }

  const model = process.env.OPENAI_ASSISTANT_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const compactContext = compactAssistantContext(context);
  const inputText = JSON.stringify({ prompt, scope, cardType, mode, context: compactContext });
  const response = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            "Sei l'assistente operativo AI di SkinHarmony Control Desk.",
            "Devi proporre azioni operative controllate, non eseguirle.",
            "Rispondi solo con JSON valido.",
            "Schema: {summary:string, diagnosis:string, recommendations:string[], proposals:[{type:'task'|'note'|'email_draft'|'strategy', title:string, priority?:'bassa'|'media'|'alta', leadId?:string, to?:string, subject?:string, body?:string, note?:string, due?:string}], warnings:string[]}.",
            "Non inventare email/contatti mancanti. Se manca destinatario, lascia to vuoto e inserisci warning.",
            "Non inviare email, non modificare dati, non cambiare prezzi.",
            "Tono premium, concreto, operativo. Separare dati reali da ipotesi."
          ].join(" ")
        },
        {
          role: "user",
          content: inputText
        }
      ],
      max_output_tokens: mode === "complete" ? 1600 : 900
    })
  });

  const outputText = response.output_text
    || (response.output || [])
      .flatMap((item) => item.content || [])
      .map((item) => item.text || "")
      .join("\n")
      .trim();
  const parsed = parseJsonObject(outputText);
  logAiUsage({ question: prompt, mode: "openai_action", scope: `${scope}:${cardType || "global"}`, model, inputText, outputText });
  return { ...parsed, model };
}

function localActionProposal({ prompt, scope, cardType, context }) {
  const problem = context.executive?.strategicActions?.[0] || { title: "Aggiornare priorita operative", detail: "Controllare alert e dati mancanti." };
  return {
    summary: "Proposta locale generata sui dati reali disponibili.",
    diagnosis: `${problem.title}. ${problem.detail}`,
    recommendations: context.executive?.strategyBrief || ["Completare dati mancanti e lavorare sulle priorita critiche."],
    proposals: [
      {
        type: "task",
        title: problem.title,
        priority: problem.level === "critico" ? "alta" : "media",
        due: new Date().toISOString().slice(0, 10),
        note: `${problem.detail} Richiesta: ${prompt}`
      },
      {
        type: "strategy",
        title: `Strategia ${cardType || scope}`,
        priority: "media",
        note: context.executive?.strategyBrief?.join("\n") || problem.detail
      }
    ],
    warnings: ["OpenAI non disponibile: proposta costruita con fallback locale."]
  };
}

app.get("/api/overview", (_req, res) => {
  const context = buildControlContext();
  const report = readText("mail/ultimo_report_outreach.md", "Report non disponibile.");
  const smartDeskMap = readText("SMARTDESK_MAPPA_OPERATIVA.md", "Mappa Smart Desk non disponibile.");

  res.json({
    ...context,
    actions: context.actions.slice(0, 80),
    behavior: context.behavior.slice(0, 80),
    recentMemory: extractRecentMemory(),
    report,
    smartDesk: {
      live: "https://skinharmony-smartdesk-live.onrender.com",
      login: "https://skinharmony-smartdesk-live.onrender.com/login",
      wordpressPage: "https://www.skinharmony.it/skinharmony-smart-desk-2/",
      mapExcerpt: smartDeskMap.slice(0, 5000)
    }
  });
});

app.get("/api/nyra/control", (_req, res) => {
  const context = buildControlContext();
  res.json({
    generatedAt: new Date().toISOString(),
    nyra: buildNyraControlDirective(context)
  });
});

app.get("/api/nyra/finance", (_req, res) => {
  try {
    res.json({
      ok: true,
      finance: buildNyraFinanceCard(),
      profile: loadNyraFinanceProfileConfig(),
      history: loadNyraFinanceProfileHistory().entries || [],
      realtimeAutoimprovement: readJson(nyraFinanceRealtimeAutoimprovePath, null)
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get("/api/nyra/finance/profile", async (_req, res) => {
  try {
    const profile = await refreshNyraFinanceProfileState();
    res.json({ ok: true, profile, history: loadNyraFinanceProfileHistory().entries || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/nyra/finance/profile", async (req, res) => {
  try {
    const profile = await refreshNyraFinanceProfileState({
      mode: req.body?.mode === "manual" ? "manual" : "auto",
      manualProfile: typeof req.body?.manualProfile === "string" ? req.body.manualProfile : "hard_growth"
    });
    res.json({ ok: true, profile, history: loadNyraFinanceProfileHistory().entries || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/nyra/finance/profile/apply-recommendation", async (_req, res) => {
  try {
    const current = loadNyraFinanceProfileConfig();
    const recommended = current.warning?.recommendedProfile || current.previousAutoProfile || "hard_growth";
    const profile = await refreshNyraFinanceProfileState({
      mode: "manual",
      manualProfile: recommended
    });
    res.json({ ok: true, profile, history: loadNyraFinanceProfileHistory().entries || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/nyra/finance/live", async (_req, res) => {
  try {
    await refreshNyraFinanceProfileState();
    const report = await runNodeJson(getNyraFinanceLiveArgs(), { timeoutMs: 120000 });
    nyraFinanceLiveState.lastReport = report;
    const history = appendNyraFinanceHistory(report);
    res.json({
      ok: true,
      profile: nyraFinanceLiveState.profile,
      profileHistory: loadNyraFinanceProfileHistory().entries || [],
      realtimeAutoimprovement: readJson(nyraFinanceRealtimeAutoimprovePath, null),
      finance: buildNyraFinanceLiveCard(report),
      raw: report,
      history
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post("/api/nyra/finance/world-market", async (_req, res) => {
  try {
    await runNodeJson([
      "--experimental-strip-types",
      "universal-core/tools/nyra-world-news-thesis.ts"
    ], { timeoutMs: 120000 });
    const output = await runNodeJson([
      "--experimental-strip-types",
      "universal-core/tools/nyra-world-market-scan.ts"
    ], { timeoutMs: 120000 });
    res.json({
      ok: true,
      scan: readJson(nyraWorldMarketScanPath, null),
      selection: readJson(nyraWorldMarketSelectionPath, null),
      output
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get("/api/nyra/finance/world-market", (_req, res) => {
  res.json({
    ok: true,
    scan: readJson(nyraWorldMarketScanPath, null),
    selection: readJson(nyraWorldMarketSelectionPath, null)
  });
});

app.post("/api/nyra/finance/world-market/select", (req, res) => {
  try {
    const symbol = String(req.body?.symbol || "").trim().toUpperCase();
    if (!symbol) {
      res.status(400).json({ ok: false, error: "Simbolo mercato mancante." });
      return;
    }
    const scan = readJson(nyraWorldMarketScanPath, null);
    const rows = Array.isArray(scan?.ranked) ? scan.ranked : [];
    const selected = rows.find((row) => String(row.symbol || "").toUpperCase() === symbol);
    if (!selected) {
      res.status(404).json({ ok: false, error: "Mercato non trovato nell'ultima scansione." });
      return;
    }
    const selection = {
      selected_at: new Date().toISOString(),
      mode: "watch_and_choose",
      execution: "manual_confirmation_required",
      symbol: selected.symbol,
      name: selected.name,
      class: selected.class,
      region: selected.region,
      action: selected.action,
      edge_score: selected.edge_score,
      risk_score: selected.risk_score,
      return_20d_pct: selected.return_20d_pct,
      reason: selected.reason
    };
    writeJson(nyraWorldMarketSelectionPath, selection);
    res.json({ ok: true, selection });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

function emptyWorldPaperPortfolio(initialCapital = NYRA_FINANCE_SHARED_CAPITAL_EUR) {
  const now = new Date().toISOString();
  const capital = Math.max(1000, Number(initialCapital || NYRA_FINANCE_SHARED_CAPITAL_EUR));
  return {
    mode: "paper_trading_only",
    execution: "no_real_orders",
    initial_capital_eur: Number(capital.toFixed(2)),
    cash_eur: Number(capital.toFixed(2)),
    positions: [],
    trades: [],
    started_at: now,
    updated_at: now
  };
}

function findWorldBenchmarkRow(worldScan, symbol = "QQQ") {
  const ranked = Array.isArray(worldScan?.ranked) ? worldScan.ranked : [];
  return ranked.find((row) => String(row.symbol || "").toUpperCase() === symbol) || null;
}

function ensureWorldPaperBenchmark(portfolio, worldScan = readJson(nyraWorldMarketScanPath, null)) {
  if (!portfolio || typeof portfolio !== "object") return portfolio;
  if (portfolio.benchmark && Number(portfolio.benchmark.initial_price || 0) > 0) return portfolio;
  const row = findWorldBenchmarkRow(worldScan, "QQQ");
  if (!row || Number(row.last_price || 0) <= 0) return portfolio;
  const initialCapital = Number(portfolio.initial_capital_eur || NYRA_FINANCE_SHARED_CAPITAL_EUR);
  const units = initialCapital / Number(row.last_price || 0);
  portfolio.benchmark = {
    symbol: "QQQ",
    name: row.name || "Invesco QQQ Trust",
    started_at: portfolio.started_at || new Date().toISOString(),
    initial_capital_eur: Number(initialCapital.toFixed(2)),
    initial_price: Number(Number(row.last_price || 0).toFixed(6)),
    units: Number(units.toFixed(8)),
    source: row.source || "world_scan"
  };
  return portfolio;
}

function summarizeWorldPaperBenchmark(portfolio, worldScan = readJson(nyraWorldMarketScanPath, null)) {
  const benchmark = ensureWorldPaperBenchmark(portfolio, worldScan)?.benchmark;
  if (!benchmark || Number(benchmark.initial_price || 0) <= 0) return null;
  const row = findWorldBenchmarkRow(worldScan, benchmark.symbol || "QQQ");
  const currentPrice = Number(row?.last_price || benchmark.initial_price || 0);
  const currentValue = Number((Number(benchmark.units || 0) * currentPrice).toFixed(2));
  const initialCapital = Number(benchmark.initial_capital_eur || NYRA_FINANCE_SHARED_CAPITAL_EUR);
  const pnlEur = Number((currentValue - initialCapital).toFixed(2));
  const pnlPct = initialCapital > 0 ? Number((((currentValue / initialCapital) - 1) * 100).toFixed(4)) : 0;
  return {
    symbol: benchmark.symbol || "QQQ",
    name: benchmark.name || "Invesco QQQ Trust",
    started_at: benchmark.started_at,
    initial_capital_eur: initialCapital,
    initial_price: Number(benchmark.initial_price || 0),
    current_price: Number(currentPrice.toFixed(6)),
    current_value_eur: currentValue,
    pnl_eur: pnlEur,
    pnl_pct: pnlPct,
    source: benchmark.source || row?.source || "world_scan"
  };
}

function summarizeLivePortfolioReserve(report = null) {
  const portfolio = Array.isArray(report?.portfolio) ? report.portfolio : [];
  const grossReserved = portfolio.reduce((sum, position) => sum + Number(position.capital_gross_eur || 0), 0);
  const netReserved = portfolio.reduce((sum, position) => sum + Number(position.capital_net_eur || 0), 0);
  return {
    positionsCount: portfolio.length,
    grossReservedEur: Number(grossReserved.toFixed(2)),
    netReservedEur: Number(netReserved.toFixed(2))
  };
}

function buildNyraMarketAllocation(profile = {}, totalCapital = NYRA_FINANCE_SHARED_CAPITAL_EUR) {
  const allocation = profile.allocation && typeof profile.allocation === "object" ? profile.allocation : {};
  const gear = Math.max(1, Math.min(7, Number(profile.currentGear || 1)));
  const btcWeight = Number(allocation.BTC || 0);
  const nonCryptoRiskWeight =
    Number(allocation.SPY || 0) +
    Number(allocation.QQQ || 0) +
    Number(allocation.GLD || 0) +
    Number(allocation.TLT || 0);
  const riskyWeight = Number.isFinite(Number(profile.riskyWeight))
    ? Number(profile.riskyWeight)
    : btcWeight + nonCryptoRiskWeight;
  const gearRiskCap = {
    1: 0.2,
    2: 0.3,
    3: 0.4,
    4: 0.5,
    5: 0.62,
    6: 0.72,
    7: 0.85
  }[gear] || 0.2;
  const totalRiskBudgetPct = Math.min(gearRiskCap, Math.max(0.05, riskyWeight || gearRiskCap));
  const rawDenominator = Math.max(0.0001, btcWeight + nonCryptoRiskWeight);
  const cryptoSharePct = totalRiskBudgetPct * (btcWeight / rawDenominator);
  const globalSharePct = totalRiskBudgetPct * (nonCryptoRiskWeight / rawDenominator);
  const fallbackCryptoPct = gear >= 4 ? 0.08 : 0.03;
  const normalizedCryptoPct = btcWeight > 0 ? cryptoSharePct : fallbackCryptoPct;
  const normalizedGlobalPct = Math.max(0.04, totalRiskBudgetPct - normalizedCryptoPct);
  const cashReservePct = Math.max(0, 1 - totalRiskBudgetPct);

  return {
    gear,
    profile: profile.currentProfile || "capital_protection",
    totalRiskBudgetPct: Number(totalRiskBudgetPct.toFixed(6)),
    cryptoLiveBudgetPct: Number(normalizedCryptoPct.toFixed(6)),
    globalPaperBudgetPct: Number(normalizedGlobalPct.toFixed(6)),
    cashReservePct: Number(cashReservePct.toFixed(6)),
    cryptoLiveBudgetEur: Number((totalCapital * normalizedCryptoPct).toFixed(2)),
    globalPaperBudgetEur: Number((totalCapital * normalizedGlobalPct).toFixed(2)),
    cashReserveEur: Number((totalCapital * cashReservePct).toFixed(2))
  };
}

function buildWorldRotationPlan(profile = {}, portfolio = {}, scan = null) {
  const gear = Math.max(1, Math.min(7, Number(profile.currentGear || 1)));
  const rankedRows = Array.isArray(scan?.ranked) ? scan.ranked : [];
  const candidates = rankedRows.filter((row) => row.action !== "avoid");
  const openPositions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const openClassCounts = openPositions.reduce((map, position) => {
    const assetClass = String(position.class || "");
    map.set(assetClass, (map.get(assetClass) || 0) + 1);
    return map;
  }, new Map());
  const classScores = new Map();

  candidates.forEach((row) => {
    const assetClass = String(row.class || "unknown");
    const baseScore = Number(row.edge_score || 0) - Number(row.risk_score || 0) * 0.12;
    const profileBias =
      gear <= 2
        ? assetClass === "bond" ? 16 : assetClass === "equity_index" ? 10 : assetClass === "commodity_proxy" ? 6 : assetClass === "single_stock" ? -10 : 0
        : gear === 3
          ? assetClass === "equity_index" ? 12 : assetClass === "single_stock" ? 4 : assetClass === "bond" ? 2 : 0
          : gear >= 4
            ? assetClass === "equity_index" ? 10 : assetClass === "single_stock" ? 12 : assetClass === "commodity_proxy" ? 4 : assetClass === "bond" ? -6 : 0
            : 0;
    const crowdPenalty = (openClassCounts.get(assetClass) || 0) >= 2 ? 14 : (openClassCounts.get(assetClass) || 0) === 1 ? 5 : 0;
    classScores.set(assetClass, (classScores.get(assetClass) || 0) + baseScore + profileBias - crowdPenalty);
  });

  const rankedClasses = [...classScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([assetClass, score]) => ({ assetClass, score: Number(score.toFixed(4)) }));

  const primary = rankedClasses[0]?.assetClass || "equity_index";
  const secondary = rankedClasses[1]?.assetClass || null;
  return {
    gear,
    primaryClass: primary,
    secondaryClass: secondary,
    rankedClasses,
    reason:
      gear <= 2
        ? "Marcia prudente: Nyra privilegia classi piu difensive e liquide."
        : gear >= 4
          ? "Marcia spinta: Nyra ruota verso classi con piu edge e accetta piu dispersione."
          : "Marcia intermedia: Nyra bilancia indice, stock selection e difesa."
  };
}

function buildUnifiedFinanceTreasury(portfolio, liveReport = nyraFinanceLiveState.lastReport) {
  const worldScan = readJson(nyraWorldMarketScanPath, null);
  ensureWorldPaperBenchmark(portfolio, worldScan);
  const summary = summarizeWorldPaperPortfolio(portfolio, worldScan);
  const liveReserve = summarizeLivePortfolioReserve(liveReport);
  const totalCapital = Number(portfolio?.initial_capital_eur || NYRA_FINANCE_SHARED_CAPITAL_EUR);
  const marketAllocation = buildNyraMarketAllocation(loadNyraFinanceProfileConfig(), totalCapital);
  const worldRotation = buildWorldRotationPlan(loadNyraFinanceProfileConfig(), portfolio, worldScan);
  const benchmark = summary.benchmark || summarizeWorldPaperBenchmark(portfolio, worldScan);
  const paperInvested = Number(summary.invested_eur || 0);
  const paperCashNominal = Number(portfolio?.cash_eur || 0);
  const sharedFreeCapital = Math.max(0, totalCapital - liveReserve.grossReservedEur - paperInvested);
  const paperBudgetHeadroom = Math.max(0, marketAllocation.globalPaperBudgetEur - paperInvested);
  const paperCashAvailable = Math.min(paperCashNominal, sharedFreeCapital);
  const totalDeployed = Number((paperInvested + liveReserve.grossReservedEur).toFixed(2));
  return {
    totalCapitalEur: Number(totalCapital.toFixed(2)),
    marketAllocation,
    worldRotation,
    liveReservedEur: liveReserve.grossReservedEur,
    liveNetReservedEur: liveReserve.netReservedEur,
    livePositionsCount: liveReserve.positionsCount,
    paperInvestedEur: Number(paperInvested.toFixed(2)),
    paperCashNominalEur: Number(paperCashNominal.toFixed(2)),
    paperCashAvailableEur: Number(paperCashAvailable.toFixed(2)),
    paperBudgetHeadroomEur: Number(paperBudgetHeadroom.toFixed(2)),
    freeCapitalEur: Number(sharedFreeCapital.toFixed(2)),
    deployedCapitalEur: totalDeployed,
    deployedPct: totalCapital > 0 ? Number(((totalDeployed / totalCapital) * 100).toFixed(4)) : 0,
    benchmark
  };
}

function summarizeWorldPaperPortfolio(portfolio, worldScan = readJson(nyraWorldMarketScanPath, null)) {
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const trades = Array.isArray(portfolio.trades) ? portfolio.trades : [];
  const marketValue = positions.reduce((sum, position) => sum + Number(position.market_value_eur || 0), 0);
  const capital = Number(portfolio.cash_eur || 0) + marketValue;
  const initial = Number(portfolio.initial_capital_eur || NYRA_FINANCE_SHARED_CAPITAL_EUR);
  const benchmark = summarizeWorldPaperBenchmark(portfolio, worldScan);
  const alphaEur = benchmark ? Number(((capital - initial) - Number(benchmark.pnl_eur || 0)).toFixed(2)) : null;
  const alphaPct = benchmark ? Number((((Number(((capital - initial)).toFixed(2)) - Number(benchmark.pnl_eur || 0)) / initial) * 100).toFixed(4)) : null;
  const feesTotal = trades.reduce((sum, trade) => sum + Number(trade.fee_eur || 0), 0);
  const buyCount = trades.filter((trade) => String(trade.type || "").includes("buy") || String(trade.type || "").includes("probe")).length;
  const sellCount = trades.filter((trade) => String(trade.type || "").includes("sell")).length;
  return {
    capital_eur: Number(capital.toFixed(2)),
    cash_eur: Number(Number(portfolio.cash_eur || 0).toFixed(2)),
    invested_eur: Number(marketValue.toFixed(2)),
    pnl_eur: Number((capital - initial).toFixed(2)),
    pnl_pct: initial > 0 ? Number((((capital / initial) - 1) * 100).toFixed(4)) : 0,
    positions_count: positions.length,
    trades_count: trades.length,
    buy_count: buyCount,
    sell_count: sellCount,
    fees_total_eur: Number(feesTotal.toFixed(2)),
    fee_drag_pct: initial > 0 ? Number(((feesTotal / initial) * 100).toFixed(4)) : 0,
    benchmark,
    alpha_vs_qqq_eur: alphaEur,
    alpha_vs_qqq_pct: alphaPct
  };
}

function worldPaperRiskBudget(profile = {}, treasury = null) {
  const gear = Math.max(1, Math.min(7, Number(profile.currentGear || 1)));
  const allocation = profile.allocation && typeof profile.allocation === "object" ? profile.allocation : {};
  const riskyWeight = Number.isFinite(Number(profile.riskyWeight))
    ? Number(profile.riskyWeight)
    : Number(allocation.SPY || 0) + Number(allocation.QQQ || 0) + Number(allocation.BTC || 0);
  const gearCap = {
    1: 0.04,
    2: 0.08,
    3: 0.12,
    4: 0.2,
    5: 0.28,
    6: 0.35,
    7: 0.45
  }[gear] || 0.04;
  const profileCap = riskyWeight > 0 ? Math.max(0.03, Math.min(0.45, riskyWeight * 0.45)) : gearCap;
  const marketCapPct = Number(treasury?.marketAllocation?.globalPaperBudgetPct || profileCap);
  return {
    gear,
    profile: profile.currentProfile || "capital_protection",
    mode: profile.mode || "auto",
    maxAllocation: Number(Math.min(gearCap, profileCap, marketCapPct).toFixed(4)),
    freeCapitalEur: Number(treasury?.freeCapitalEur || NYRA_FINANCE_SHARED_CAPITAL_EUR),
    marketBudgetEur: Number(treasury?.marketAllocation?.globalPaperBudgetEur || 0),
    reason: `paper size guidata da marcia ${gear} (${profile.currentProfile || "capital_protection"})`
  };
}

function updatePaperPositionMarks(portfolio, rankedRows) {
  const rowsBySymbol = new Map(rankedRows.map((row) => [String(row.symbol || "").toUpperCase(), row]));
  portfolio.positions = (Array.isArray(portfolio.positions) ? portfolio.positions : []).map((position) => {
    const row = rowsBySymbol.get(String(position.symbol || "").toUpperCase());
    const lastPrice = Number(row?.last_price || position.last_price || position.entry_price || 0);
    const marketValue = Number(position.quantity || 0) * lastPrice;
    const costBasis = Number(position.cost_basis_eur || 0);
    return {
      ...position,
      last_price: lastPrice,
      market_value_eur: Number(marketValue.toFixed(2)),
      pnl_eur: Number((marketValue - costBasis).toFixed(2)),
      pnl_pct: costBasis > 0 ? Number((((marketValue / costBasis) - 1) * 100).toFixed(4)) : 0,
      last_action: row?.action || position.last_action || "unknown"
    };
  });
  portfolio.updated_at = new Date().toISOString();
  return portfolio;
}

function minutesSinceIso(value) {
  const time = new Date(value || "").getTime();
  if (!Number.isFinite(time)) return Infinity;
  return (Date.now() - time) / 60000;
}

function recentWorldPaperTradeBlockers(portfolio, minutes = 360) {
  const trades = Array.isArray(portfolio?.trades) ? portfolio.trades : [];
  const recent = trades.filter((trade) => minutesSinceIso(trade.at) <= minutes);
  return {
    symbols: new Set(recent
      .filter((trade) => String(trade.type || "").includes("sell") || String(trade.type || "").includes("pause"))
      .map((trade) => String(trade.symbol || "").toUpperCase())
      .filter(Boolean)),
    classes: new Set(recent
      .filter((trade) => String(trade.type || "").includes("sell"))
      .map((trade) => String(trade.assetClass || trade.class || "").toLowerCase())
      .filter(Boolean))
  };
}

function estimateWorldPaperRoundTripCostPct(feeRate = 0.002, slippageRate = 0.005) {
  return (feeRate * 2 + slippageRate * 2) * 100;
}

function worldPaperThesisExpectedMovePct(row, thesis = null) {
  const edge = Number(row?.edge_score || 0);
  const risk = Number(row?.risk_score || 0);
  const ev = Number(thesis?.expected_value_score || 0);
  const confidence = Number(thesis?.confidence || 0);
  const setupBoost = Number(thesis?.learned_setups?.boost_applied || 0);
  return Math.max(0, ev * 0.34 + Math.max(0, edge - risk) * 0.055 + Math.max(0, confidence - 50) * 0.035 + setupBoost * 0.08);
}

function worldPaperHasFeeEdge(row, thesis = null, feeRate = 0.002, slippageRate = 0.005, multiplier = 1.4) {
  const expectedMovePct = worldPaperThesisExpectedMovePct(row, thesis);
  const requiredMovePct = estimateWorldPaperRoundTripCostPct(feeRate, slippageRate) * multiplier;
  return {
    ok: expectedMovePct >= requiredMovePct,
    expected_move_pct: Number(expectedMovePct.toFixed(4)),
    required_move_pct: Number(requiredMovePct.toFixed(4)),
    round_trip_cost_pct: Number(estimateWorldPaperRoundTripCostPct(feeRate, slippageRate).toFixed(4))
  };
}

function worldPaperDiversificationState(portfolio) {
  const positions = Array.isArray(portfolio?.positions) ? portfolio.positions : [];
  const byClass = new Map();
  const byRegion = new Map();
  positions.forEach((position) => {
    const assetClass = String(position.class || "unknown");
    const region = String(position.region || "unknown");
    const value = Number(position.market_value_eur || position.cost_basis_eur || 0);
    const pnl = Number(position.pnl_eur || 0);
    const classRow = byClass.get(assetClass) || { class: assetClass, count: 0, value_eur: 0, pnl_eur: 0, losing: 0 };
    classRow.count += 1;
    classRow.value_eur += value;
    classRow.pnl_eur += pnl;
    if (pnl < 0) classRow.losing += 1;
    byClass.set(assetClass, classRow);
    const regionRow = byRegion.get(region) || { region, count: 0, value_eur: 0, pnl_eur: 0 };
    regionRow.count += 1;
    regionRow.value_eur += value;
    regionRow.pnl_eur += pnl;
    byRegion.set(region, regionRow);
  });
  const classes = [...byClass.values()].map((row) => ({
    ...row,
    value_eur: Number(row.value_eur.toFixed(2)),
    pnl_eur: Number(row.pnl_eur.toFixed(2))
  }));
  const regions = [...byRegion.values()].map((row) => ({
    ...row,
    value_eur: Number(row.value_eur.toFixed(2)),
    pnl_eur: Number(row.pnl_eur.toFixed(2))
  }));
  return {
    classes,
    regions,
    class_count: classes.length,
    dominant_class: classes.slice().sort((a, b) => b.value_eur - a.value_eur)[0]?.class || "",
    all_positions_losing: positions.length > 0 && positions.every((position) => Number(position.pnl_eur || 0) < 0)
  };
}

function chooseDiversifiedWorldPaperRow(preferredRow, rankedRows, portfolio, riskBudget, learning, assetHistory) {
  const positions = Array.isArray(portfolio?.positions) ? portfolio.positions : [];
  const state = worldPaperDiversificationState(portfolio);
  const openSymbols = new Set(positions.map((position) => String(position.symbol || "").toUpperCase()));
  const classCounts = new Map(state.classes.map((row) => [row.class, row.count]));
  const losingClasses = new Set(state.classes.filter((row) => row.pnl_eur < 0 && row.losing >= row.count).map((row) => row.class));
  const penalizedSymbols = new Set((learning?.policy?.penalize_symbols || []).map((item) => String(item.symbol || "").toUpperCase()));
  const penalizedClasses = new Set((learning?.policy?.penalize_classes || []).map((item) => String(item.class || "")));
  const recentBlockers = recentWorldPaperTradeBlockers(portfolio, 360);
  const thesisLearningPolicy = loadWorldThesisLearningPolicy();
  const currentClass = String(preferredRow?.class || "");
  const currentClassCount = classCounts.get(currentClass) || 0;
  const mustDiversify =
    positions.length >= 3 &&
    (
      currentClassCount >= 2 ||
      losingClasses.has(currentClass) ||
      penalizedClasses.has(currentClass) ||
      state.class_count < Math.min(4, positions.length + 1)
    );
  if (!mustDiversify) return { row: preferredRow, diversified: false, reason: "preferred row still inside diversification budget" };

  const candidates = rankedRows
    .filter((row) => row && row.action !== "avoid")
    .filter((row) => !openSymbols.has(String(row.symbol || "").toUpperCase()))
    .filter((row) => !penalizedSymbols.has(String(row.symbol || "").toUpperCase()))
    .filter((row) => !recentBlockers.symbols.has(String(row.symbol || "").toUpperCase()))
    .filter((row) => (classCounts.get(String(row.class || "")) || 0) < 2)
    .map((row) => {
      const rowClass = String(row.class || "");
      const history = assetHistory?.by_symbol?.[row.symbol];
      const thesis = row.multiverse_thesis || buildWorldMultiverseThesis(row, riskBudget, history, thesisLearningPolicy);
      const feeEdge = worldPaperHasFeeEdge(row, thesis, 0.002, 0.005, 1.25);
      let score = Number(row.edge_score || 0) - Number(row.risk_score || 0) * 0.2;
      if (!classCounts.has(rowClass)) score += 28;
      if (penalizedClasses.has(rowClass)) score -= 38;
      if (losingClasses.has(rowClass)) score -= 26;
      if (thesis?.thesis_valid) score += 18;
      if (feeEdge.ok) score += 12;
      else score -= 18;
      if (["commodity_proxy", "thematic_commodity", "global_equity", "bond", "fx_proxy", "sector_us"].includes(rowClass)) score += 10;
      if (rowClass === "crypto" && riskBudget.gear < 5) score -= 18;
      if (history) {
        score += Math.min(10, Math.max(-10, (Number(history.knowledge_score || 50) - 50) * 0.12));
        if (["high_volatility_convex", "duration_risk"].includes(String(history.behavior || ""))) score -= 12;
      }
      return { row: { ...row, multiverse_thesis: thesis, fee_edge: feeEdge }, score };
    })
    .filter((item) =>
      Number(item.row.edge_score || 0) >= 58 &&
      Number(item.row.risk_score || 0) <= 62 &&
      (item.row.multiverse_thesis?.thesis_valid || item.row.fee_edge?.ok) &&
      item.score > 32
    )
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    return { row: preferredRow, diversified: false, reason: "no clean alternative class found" };
  }
  return {
    row: candidates[0].row,
    diversified: true,
    reason: `diversification guard: preferred ${preferredRow?.symbol || "-"} class ${currentClass} overloaded/losing, switched to ${candidates[0].row.symbol} ${candidates[0].row.class}`
  };
}

function buildWorldPaperLearningPolicy(portfolio) {
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const trades = Array.isArray(portfolio.trades) ? portfolio.trades : [];
  const summary = summarizeWorldPaperPortfolio(portfolio);
  const profile = loadNyraFinanceProfileConfig();
  const gear = Math.max(1, Math.min(7, Number(profile.currentGear || 1)));
  const hardLearningMode = gear >= 4 || ["hard_growth", "overdrive"].includes(String(profile.currentProfile || ""));
  const losingPositions = positions.filter((position) => Number(position.pnl_eur || 0) < 0);
  const symbolLosses = new Map();
  const classLosses = new Map();
  losingPositions.forEach((position) => {
    symbolLosses.set(position.symbol, (symbolLosses.get(position.symbol) || 0) + Math.abs(Number(position.pnl_eur || 0)));
    classLosses.set(position.class, (classLosses.get(position.class) || 0) + Math.abs(Number(position.pnl_eur || 0)));
  });
  const repeatedHoldCount = trades.filter((trade) => trade.type === "hold").length;
  const allPositionsLosing = positions.length > 0 && losingPositions.length === positions.length;
  const diversification = worldPaperDiversificationState(portfolio);
  const recentTradeCount = trades.filter((trade) => minutesSinceIso(trade.at) <= 360).length;
  const feeBleedGuard =
    Number(summary.alpha_vs_qqq_pct || 0) < -0.5 &&
    Number(summary.trades_count || 0) >= 30 &&
    Number(summary.pnl_pct || 0) < 0;
  const feeBleedHardGuard =
    Number(summary.alpha_vs_qqq_pct || 0) < -1 &&
    Number(summary.trades_count || 0) >= 80;
  const rawPauseSignal = allPositionsLosing && summary.pnl_eur < -40;
  const deepProtectionSignal = rawPauseSignal && summary.pnl_pct <= -3;
  const elasticLearning = rawPauseSignal && !deepProtectionSignal;
  const pauseNewEntries = (deepProtectionSignal && !hardLearningMode) || feeBleedHardGuard;
  const learningState = feeBleedHardGuard
    ? "anti_fee_bleed_recovery"
    : feeBleedGuard
      ? "benchmark_recovery_learning"
      : rawPauseSignal && hardLearningMode
    ? "hard_profit_learning"
    : pauseNewEntries
      ? "protective_learning"
      : elasticLearning
        ? "elastic_profit_learning"
        : summary.pnl_eur > 0
        ? "release_learning"
        : "observe";
  const maxNewPositionMultiplier = pauseNewEntries
    ? 0.18
    : hardLearningMode && allPositionsLosing
      ? 0.45
      : elasticLearning
        ? 0.35
        : allPositionsLosing
          ? 0.5
          : 1;
  const policy = {
    version: "nyra_world_paper_auto_learning_v1",
    generated_at: new Date().toISOString(),
    source: nyraWorldPaperPortfolioPath,
    learning_state: learningState,
    metrics: {
      capital_eur: summary.capital_eur,
      pnl_eur: summary.pnl_eur,
      pnl_pct: summary.pnl_pct,
      positions_count: positions.length,
      losing_positions: losingPositions.length,
      repeated_hold_count: repeatedHoldCount,
      recent_trade_count: recentTradeCount,
      fees_total_eur: summary.fees_total_eur,
      fee_drag_pct: summary.fee_drag_pct,
      alpha_vs_qqq_pct: summary.alpha_vs_qqq_pct,
      fee_bleed_guard: feeBleedGuard,
      fee_bleed_hard_guard: feeBleedHardGuard,
      gear,
      hard_learning_mode: hardLearningMode,
      elastic_learning: elasticLearning,
      deep_protection_signal: deepProtectionSignal
      ,
      diversification
    },
    policy: {
      pause_new_entries: pauseNewEntries,
      elastic_choice_enabled: elasticLearning || hardLearningMode,
      paper_capital_is_training_capital: true,
      paper_area_is_test_lab: true,
      paper_capital_replenishable: true,
      fee_bleed_guard_active: feeBleedGuard,
      fee_bleed_hard_guard_active: feeBleedHardGuard,
      benchmark_recovery_required: feeBleedGuard,
      diversification_required: true,
      diversification_rule: "Non concentrare la palestra su una sola famiglia: se una classe e gia piena o perdente, il prossimo probe deve cercare una classe diversa con edge/rischio puliti.",
      conviction_rule: "Se la tesi probabilistica e valida, Nyra deve darle tempo: niente chiusure nervose e niente micro-probe che regalano fee. Se la tesi non supera i costi, osserva.",
      anti_robinhood_rule: "Se Nyra perde contro QQQ e aumenta i trade, non sta imparando: sta trasferendo capitale alle fee. In quel caso stop nuove entrate deboli, hold ragionato e solo tesi ad alta convinzione.",
      training_directive: "Area test: il capitale e virtuale e ricaricabile. Nyra puo provare e sbagliare, ma deve cercare profitto con tesi, pazienza e size coerente; ogni fee pagata senza edge e un errore da correggere.",
      objective: "learn_to_generate_paper_profit",
      penalize_symbols: [...symbolLosses.entries()].map(([symbol, loss]) => ({ symbol, loss_eur: Number(loss.toFixed(2)) })),
      penalize_classes: [...classLosses.entries()].map(([assetClass, loss]) => ({ class: assetClass, loss_eur: Number(loss.toFixed(2)) })),
      max_new_position_multiplier: feeBleedGuard ? Math.min(maxNewPositionMultiplier, 0.25) : maxNewPositionMultiplier,
      min_edge_for_new_entry: feeBleedHardGuard ? 82 : feeBleedGuard ? 76 : deepProtectionSignal ? 72 : elasticLearning ? 62 : 55,
      max_risk_for_new_entry: feeBleedHardGuard ? 34 : feeBleedGuard ? 42 : deepProtectionSignal ? 42 : elasticLearning ? 55 : 65,
      reason: feeBleedHardGuard
        ? "Anti Robin Hood attivo: Nyra e sotto QQQ e ha troppi trade. Blocca nuove aperture, smette di regalare fee e lavora su hold/tesi forti."
        : feeBleedGuard
          ? "Nyra e sotto benchmark con churn alto: deve recuperare disciplina, non aprire nuove prove deboli. Solo tesi ad alta convinzione possono passare."
          : pauseNewEntries
        ? "Drawdown paper oltre soglia: protezione forte, ma resta area test ricaricabile; prova solo probe eccezionali su edge molto pulito e registra l'errore."
        : hardLearningMode && allPositionsLosing
          ? "Area test: capitale paper non reale e ricaricabile. Gli errori servono a imparare; continua a cercare profitto con probe piccoli, cambiando asset, registrando cosa non funziona e senza stallo."
          : elasticLearning
            ? "Tutte le posizioni paper sono negative ma il drawdown e ancora da palestra: Nyra puo cercare profitto con ingressi piccoli, selettivi e non concentrati. Se finisce capitale paper si ricarica, ma non deve ripetere lo stesso errore."
          : allPositionsLosing
          ? "Posizioni paper tutte negative: riduci aggressivita nuove entrate, ma resta in apprendimento sperimentale controllato."
          : "Nessuna correzione forte richiesta."
    }
  };
  writeJson(nyraWorldPaperLearningPath, policy);
  return policy;
}

function maybeRebalanceWorldPaperByRotation(portfolio, rankedRows, profile) {
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  if (!positions.length) {
    return { portfolio, closed: [], rotationPlan: buildWorldRotationPlan(profile, portfolio, { ranked: rankedRows }) };
  }

  const rotationPlan = buildWorldRotationPlan(profile, portfolio, { ranked: rankedRows });
  const learning = buildWorldPaperLearningPolicy(portfolio);
  const penalizedClasses = new Set((learning?.policy?.penalize_classes || []).map((item) => String(item.class || "")));
  const keepClasses = new Set([rotationPlan.primaryClass, rotationPlan.secondaryClass].filter(Boolean));
  const rowsBySymbol = new Map(rankedRows.map((row) => [String(row.symbol || "").toUpperCase(), row]));
  const now = new Date().toISOString();
  const riskBudget = worldPaperRiskBudget(profile, buildUnifiedFinanceTreasury(portfolio));
  const assetHistory = readJson(nyraWorldAssetHistoryStudyPath, null);
  const thesisLearningPolicy = loadWorldThesisLearningPolicy();
  const kept = [];
  const closed = [];

  positions.forEach((position) => {
    const assetClass = String(position.class || "");
    const holdMinutes = minutesSinceIso(position.opened_at);
    const shouldCloseForClass = keepClasses.size > 0 && !keepClasses.has(assetClass);
    const shouldCloseForPenalty = penalizedClasses.has(assetClass);
    const positionPnlPct = Number(position.pnl_pct || 0);
    const minHoldMinutes = positionPnlPct < 0 ? 1440 : 720;
    const canClose = holdMinutes >= minHoldMinutes;
    if (!canClose) {
      if (shouldCloseForClass || shouldCloseForPenalty) {
        position.reason = `${position.reason || "paper position"}; confidence hold: non chiudo prima di ${Math.round(minHoldMinutes / 60)}h per non regalare fee`;
      }
      kept.push(position);
      return;
    }
    if (!shouldCloseForClass && !shouldCloseForPenalty) {
      kept.push(position);
      return;
    }

    const liveRow = rowsBySymbol.get(String(position.symbol || "").toUpperCase());
    const thesis = liveRow
      ? buildWorldMultiverseThesis(liveRow, riskBudget, assetHistory?.by_symbol?.[liveRow.symbol], thesisLearningPolicy)
      : position.multiverse_thesis || null;
    if (
      thesis?.thesis_valid &&
      thesis.thesis_action === "hold_thesis" &&
      Number(position.pnl_eur || 0) < 0 &&
      !shouldCloseForClass
    ) {
      position.multiverse_thesis = thesis;
      position.reason = `${position.reason || "paper position"}; tesi ancora valida, non chiudo solo per perdita temporanea`;
      kept.push(position);
      portfolio.trades.unshift({
        at: now,
        type: "thesis_hold",
        symbol: position.symbol,
        assetClass,
        gear: profile.currentGear || "-",
        profile: profile.currentProfile || "capital_protection",
        price: Number(liveRow?.last_price || position.last_price || 0),
        reason: `Core/multiverse paper: perdita temporanea ma tesi valida (${thesis.reason})`
      });
      return;
    }
    const exitPrice = Number(liveRow?.last_price || position.last_price || position.entry_price || 0);
    const marketValue = Number((Number(position.quantity || 0) * exitPrice).toFixed(2));
    const pnlEur = Number((marketValue - Number(position.cost_basis_eur || 0)).toFixed(2));
    const pnlPct = Number(position.cost_basis_eur || 0) > 0
      ? Number((((marketValue / Number(position.cost_basis_eur || 0)) - 1) * 100).toFixed(4))
      : 0;
    portfolio.cash_eur = Number((Number(portfolio.cash_eur || 0) + marketValue).toFixed(2));
    portfolio.trades.unshift({
      at: now,
      type: "paper_sell",
      symbol: position.symbol,
      assetClass,
      gear: profile.currentGear || "-",
      profile: profile.currentProfile || "capital_protection",
      price: exitPrice,
      pnl_eur: pnlEur,
      pnl_pct: pnlPct,
      reason: shouldCloseForPenalty
        ? `chiusura da learning: classe ${assetClass} penalizzata`
        : `chiusura da rotazione: classe ${assetClass} fuori da ${rotationPlan.primaryClass}${rotationPlan.secondaryClass ? `/${rotationPlan.secondaryClass}` : ""}`
    });
    closed.push({
      symbol: position.symbol,
      assetClass,
      pnlEur,
      pnlPct,
      reason: shouldCloseForPenalty ? "learning_penalty" : "rotation_shift"
    });
  });

  portfolio.positions = kept;
  portfolio.updated_at = now;
  return { portfolio, closed, rotationPlan };
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function loadWorldThesisLearningPolicy() {
  const learning = readJson(nyraWorldThesisLearningMassivePath, null);
  return learning?.learned_policy_latest || null;
}

function buildWorldMultiverseThesis(row, riskBudget = {}, history = null, learnedPolicy = loadWorldThesisLearningPolicy()) {
  const policy = learnedPolicy || {};
  const learningApplied = Boolean(learnedPolicy);
  const newsWeight = clampNumber(policy.news_weight ?? 0.32, 0.12, 0.48);
  const historyWeight = clampNumber(policy.history_weight ?? 0.18, 0.12, 0.48);
  const priceWeight = clampNumber(policy.price_weight ?? 0.22, 0.12, 0.36);
  const riskWeight = clampNumber(policy.risk_weight ?? 0.42, 0.24, 0.58);
  const catalystWeight = clampNumber(policy.catalyst_weight ?? 0.24, 0.12, 0.48);
  const negativeNewsPenalty = clampNumber(policy.negative_news_penalty ?? 0.38, 0.18, 0.7);
  const minEvEnter = clampNumber(policy.min_ev_enter ?? 7, 5, 16);
  const minConfidenceEnter = clampNumber(policy.min_confidence_enter ?? 52, 44, 64);
  const holdLossPatience = clampNumber(policy.hold_loss_patience ?? 56, 45, 72);
  const commodityCatalystBoost = clampNumber(policy.commodity_catalyst_boost ?? 0, 0, 14);
  const quietCompounderBoost = clampNumber(policy.quiet_compounder_boost ?? 0, 0, 10);
  const edge = Number(row?.edge_score || 0);
  const risk = Number(row?.risk_score || 0);
  const newsScore = Number(row?.news_score || 0);
  const newsConfidence = Number(row?.news_confidence || 0);
  const newsSupport = newsConfidence >= 45 ? Math.max(-16, Math.min(16, newsScore * newsWeight)) : 0;
  const newsCatalyst = newsConfidence >= 45 ? Math.max(0, Math.min(24, newsScore * catalystWeight)) : 0;
  const negativeNewsRisk = newsConfidence >= 45 ? Math.max(0, -newsScore) * negativeNewsPenalty : 0;
  const return20d = Number(row?.return_20d_pct || 0);
  const returnYtd = Number(row?.return_ytd_pct || row?.return_1y_pct || 0);
  const gear = Math.max(1, Math.min(7, Number(riskBudget.gear || 1)));
  const knowledge = Number(history?.knowledge_score || 50);
  const maxDrawdown = Math.abs(Number(history?.max_drawdown_pct || 0));
  const recoveryMonths = Number(history?.max_recovery_months || 0);
  const behavior = String(history?.behavior || "unknown");
  const isConvex = ["core_growth", "quality_growth", "aggressive_cycle", "high_volatility_convex"].includes(behavior);
  const classRiskPenalty = row?.class === "crypto" ? 12 : row?.class === "single_stock" ? 8 : row?.class === "bond" ? 3 : 5;
  const assetClass = String(row?.class || "");
  const commodityCatalystSetup =
    ["commodity_proxy", "thematic_commodity"].includes(assetClass) &&
    newsConfidence >= 45 &&
    newsScore >= 8 &&
    risk < 68;
  const quietCompounderSetup =
    risk < 40 &&
    knowledge >= 62 &&
    maxDrawdown < 45 &&
    recoveryMonths <= 48 &&
    newsConfidence <= 58 &&
    Math.abs(return20d) <= 8 &&
    Math.max(0, -newsScore) < 8;
  const learnedSetupBoost =
    (commodityCatalystSetup ? commodityCatalystBoost : 0) +
    (quietCompounderSetup ? quietCompounderBoost : 0);
  const hiddenPotential =
    edge * (0.2 + priceWeight) +
    Math.max(0, returnYtd) * 0.24 +
    Math.max(0, -return20d) * (isConvex ? 0.38 : 0.18) +
    knowledge * historyWeight +
    newsSupport +
    newsCatalyst +
    learnedSetupBoost +
    gear * 4 +
    (isConvex ? 10 : 0);
  const adverseRisk =
    risk * (0.16 + riskWeight) +
    Math.max(0, return20d) * 0.18 +
    maxDrawdown * 0.18 +
    recoveryMonths * 0.16 +
    classRiskPenalty -
    Math.max(0, newsSupport) * 0.35 +
    Math.max(0, -newsSupport) * 0.65 -
    Math.max(0, newsCatalyst) * 0.18 +
    negativeNewsRisk +
    Math.max(0, edge - 55) * 0.12 -
    gear * 1.5;
  const scenarios = [
    {
      id: "base_case_recovery",
      probability: Math.max(0.05, Math.min(0.82, 0.28 + edge / 180 + knowledge / 360 + gear / 80)),
      payoff_score: Math.max(0, Math.min(100, 38 + edge * 0.42 + Math.max(0, -return20d) * 0.45)),
      risk_score: Math.max(0, Math.min(100, 34 + risk * 0.35 + maxDrawdown * 0.12))
    },
    {
      id: "hidden_potential_breakout",
      probability: Math.max(0.04, Math.min(0.78, 0.18 + hiddenPotential / 220 - risk / 260)),
      payoff_score: Math.max(0, Math.min(100, 42 + hiddenPotential * 0.44 + Math.max(0, newsSupport) * 0.6)),
      risk_score: Math.max(0, Math.min(100, 40 + adverseRisk * 0.35))
    },
    {
      id: "value_trap",
      probability: Math.max(0.04, Math.min(0.76, 0.22 + risk / 210 + recoveryMonths / 260 - edge / 330)),
      payoff_score: Math.max(0, Math.min(100, 22 + edge * 0.12)),
      risk_score: Math.max(0, Math.min(100, 52 + adverseRisk * 0.4))
    },
    {
      id: "continued_drawdown",
      probability: Math.max(0.04, Math.min(0.78, 0.18 + risk / 240 + Math.max(0, -return20d) / 180 - gear / 90)),
      payoff_score: Math.max(0, Math.min(100, 18 + Math.max(0, returnYtd) * 0.1)),
      risk_score: Math.max(0, Math.min(100, 54 + adverseRisk * 0.38))
    }
  ].map((scenario) => ({
    ...scenario,
    ev_score: Number((scenario.probability * scenario.payoff_score - (1 - scenario.probability) * scenario.risk_score).toFixed(4))
  }));
  const expectedValueScore = Number((scenarios.reduce((sum, scenario) => sum + scenario.ev_score, 0) / scenarios.length + hiddenPotential * 0.08 - adverseRisk * 0.05).toFixed(4));
  const confidence = Math.max(0, Math.min(100, 44 + knowledge * 0.18 + edge * 0.16 + gear * 3 - risk * 0.1));
  const patienceScore = Math.max(0, Math.min(100, 38 + expectedValueScore * 0.5 + confidence * 0.24 - adverseRisk * 0.18));
  const positiveScenarios = scenarios.filter((scenario) => scenario.ev_score > 4).length;
  const thesisValid = expectedValueScore >= minEvEnter && confidence >= minConfidenceEnter && adverseRisk < 74 && positiveScenarios >= 2;
  const thesisAction = thesisValid && (return20d < 0 || patienceScore >= holdLossPatience)
    ? "hold_thesis"
    : thesisValid
      ? "enter"
      : adverseRisk >= 75
        ? "avoid"
        : "watch";
  return {
    engine: "world_multiverse_thesis_v1",
    product: row?.symbol || "",
    learning_policy_applied: learningApplied,
    learning_policy_cycle: policy.cycle || null,
    learning_policy_source: learningApplied ? nyraWorldThesisLearningMassivePath : null,
    news_action: row?.news_thesis_action || "unknown",
    news_score: Number(newsScore.toFixed(4)),
    news_confidence: Number(newsConfidence.toFixed(4)),
    learned_weights: {
      news_weight: Number(newsWeight.toFixed(4)),
      history_weight: Number(historyWeight.toFixed(4)),
      price_weight: Number(priceWeight.toFixed(4)),
      risk_weight: Number(riskWeight.toFixed(4)),
      catalyst_weight: Number(catalystWeight.toFixed(4)),
      negative_news_penalty: Number(negativeNewsPenalty.toFixed(4)),
      min_ev_enter: Number(minEvEnter.toFixed(4)),
      min_confidence_enter: Number(minConfidenceEnter.toFixed(4)),
      hold_loss_patience: Number(holdLossPatience.toFixed(4)),
      commodity_catalyst_boost: Number(commodityCatalystBoost.toFixed(4)),
      quiet_compounder_boost: Number(quietCompounderBoost.toFixed(4))
    },
    learned_setups: {
      commodity_catalyst: commodityCatalystSetup,
      quiet_compounder: quietCompounderSetup,
      boost_applied: Number(learnedSetupBoost.toFixed(4))
    },
    expected_value_score: expectedValueScore,
    confidence: Number(confidence.toFixed(4)),
    adverse_risk: Number(adverseRisk.toFixed(4)),
    patience_score: Number(patienceScore.toFixed(4)),
    thesis_valid: thesisValid,
    thesis_action: thesisAction,
    scenarios,
    reason: thesisValid
      ? "tesi probabilistica valida: potenziale nascosto supera rischio contrario, serve pazienza controllata"
      : "tesi non sufficiente: il potenziale non compensa ancora rischio, drawdown o bassa conoscenza asset"
  };
}

function chooseStudyAwareWorldCandidate(rankedRows, portfolio, riskBudget) {
  const study = readJson(nyraWorldMarketStudyPath, null);
  const assetHistory = readJson(nyraWorldAssetHistoryStudyPath, null);
  const learning = readJson(nyraWorldPaperLearningPath, null);
  const thesisLearningPolicy = loadWorldThesisLearningPolicy();
  const openPositions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const openClasses = new Set(openPositions.map((position) => String(position.class || "")));
  const openRegions = new Set(openPositions.map((position) => String(position.region || "")));
  const penalizeSymbols = new Set((learning?.policy?.penalize_symbols || []).map((item) => String(item.symbol || "")));
  const penalizeClasses = new Set((learning?.policy?.penalize_classes || []).map((item) => String(item.class || "")));
  const recentBlockers = recentWorldPaperTradeBlockers(portfolio, 360);
  const candidates = rankedRows.filter((row) => row.action !== "avoid");
  const rotationPlan = buildWorldRotationPlan(loadNyraFinanceProfileConfig(), portfolio, { ranked: rankedRows });
  const scored = candidates.map((row) => {
    const history = assetHistory?.by_symbol?.[row.symbol];
    const thesis = buildWorldMultiverseThesis(row, riskBudget, history, thesisLearningPolicy);
    let score = Number(row.edge_score || 0) - Number(row.risk_score || 0) * 0.12;
    if (recentBlockers.symbols.has(String(row.symbol || "").toUpperCase())) score -= 40;
    if (recentBlockers.classes.has(String(row.class || "").toLowerCase())) score -= 18;
    if (openClasses.has(String(row.class || ""))) score -= 12;
    if (openRegions.has(String(row.region || "")) && row.region === "US") score -= 5;
    if (row.class === "crypto") score -= riskBudget.gear < 4 ? 18 : 8;
    if (row.class === "single_stock") score -= riskBudget.gear < 3 ? 12 : 3;
    if (row.class === "commodity_proxy" && Number(row.risk_score || 0) > 50) score -= 12;
    if (row.class === "bond" && riskBudget.gear >= 5) score -= 4;
    if (Number(row.return_20d_pct || 0) > 20 && row.class === "single_stock") score -= 6;
    if (penalizeSymbols.has(String(row.symbol || ""))) score -= 30;
    if (penalizeClasses.has(String(row.class || ""))) score -= 18;
    if (String(row.class || "") === rotationPlan.primaryClass) score += 12;
    if (rotationPlan.secondaryClass && String(row.class || "") === rotationPlan.secondaryClass) score += 6;
    if (history) {
      score += Math.min(12, Math.max(-12, (Number(history.knowledge_score || 50) - 50) * 0.18));
      if (riskBudget.gear <= 2 && Number(history.max_drawdown_pct || 0) < -45) score -= 10;
      if (riskBudget.gear >= 4 && ["core_growth", "quality_growth", "aggressive_cycle"].includes(String(history.behavior || ""))) score += 8;
      if (String(history.behavior || "") === "high_volatility_convex" && riskBudget.gear < 5) score -= 14;
      if (String(history.behavior || "") === "duration_risk" && riskBudget.gear >= 4) score -= 8;
      if (Number(history.max_recovery_months || 0) > 48 && Number(row.return_20d_pct || 0) > 18) score -= 6;
    }
    if (learning?.policy?.pause_new_entries) score -= 30;
    if (learning?.learning_state === "elastic_profit_learning") {
      const edge = Number(row.edge_score || 0);
      const risk = Number(row.risk_score || 0);
      if (edge >= Number(learning?.policy?.min_edge_for_new_entry || 62) && risk <= Number(learning?.policy?.max_risk_for_new_entry || 55)) score += 10;
      if (edge < 55 || risk > 65) score -= 16;
    }
    if (thesis.thesis_valid) {
      score += thesis.expected_value_score * 0.42;
      if (thesis.thesis_action === "hold_thesis") score += 8;
    }
    if (thesis.thesis_action === "avoid") score -= 16;
    return { row: { ...row, multiverse_thesis: thesis }, score };
  }).sort((a, b) => b.score - a.score);
  const selectedHistory = assetHistory?.by_symbol?.[scored[0]?.row?.symbol];
  return {
    selected: scored[0]?.row || rankedRows[0],
    studyAware: Boolean(study),
    assetHistoryAware: Boolean(assetHistory),
    learningAware: Boolean(learning),
    thesisLearningAware: Boolean(thesisLearningPolicy),
    thesisLearningCycle: thesisLearningPolicy?.cycle || null,
    rotationPlan,
    selectedAssetHistory: selectedHistory || null,
    score: Number((scored[0]?.score || 0).toFixed(4)),
    reason: learning?.policy?.pause_new_entries
      ? learning.policy.reason
      : learning?.learning_state === "elastic_profit_learning"
        ? `${learning.policy.reason} Scelta autonoma filtrata da edge/rischio, memoria storica asset e rotazione ${rotationPlan.primaryClass}${rotationPlan.secondaryClass ? `/${rotationPlan.secondaryClass}` : ""}.`
      : study || assetHistory || thesisLearningPolicy
        ? `scelta autonoma corretta da studio mercato mondiale, memoria storica asset e policy tesi appresa${thesisLearningPolicy?.cycle ? ` ciclo ${thesisLearningPolicy.cycle}` : ""}: edge, rischio, classe, regione, correlazione, risultati paper e rotazione ${rotationPlan.primaryClass}${rotationPlan.secondaryClass ? `/${rotationPlan.secondaryClass}` : ""}`
        : `scelta autonoma da scan con rotazione ${rotationPlan.primaryClass}${rotationPlan.secondaryClass ? `/${rotationPlan.secondaryClass}` : ""}`
  };
}

function executeWorldPaperStep(body = {}) {
  const scan = readJson(nyraWorldMarketScanPath, null);
  const ranked = Array.isArray(scan?.ranked) ? scan.ranked : [];
  if (!ranked.length) {
    const error = new Error("Prima serve una scansione mercato mondiale.");
    error.statusCode = 409;
    throw error;
  }
  const now = new Date().toISOString();
  const profile = loadNyraFinanceProfileConfig();
  const feeRate = 0.002;
  const slippageRate = 0.005;
  const portfolio = updatePaperPositionMarks(readJson(nyraWorldPaperPortfolioPath, emptyWorldPaperPortfolio()), ranked);
  ensureWorldPaperBenchmark(portfolio, scan);
  const treasury = buildUnifiedFinanceTreasury(portfolio);
  const riskBudget = worldPaperRiskBudget(profile, treasury);
  const maxAllocation = riskBudget.maxAllocation;
  const capital = treasury.totalCapitalEur;
  const autoSelect = Boolean(body?.autoSelect);
  const selection = autoSelect ? null : readJson(nyraWorldMarketSelectionPath, null);
  const requestedSymbol = String(body?.symbol || selection?.symbol || scan?.output?.best_symbol || "").toUpperCase();
  const autoChoice = autoSelect ? chooseStudyAwareWorldCandidate(ranked, portfolio, riskBudget) : null;
  let row = autoChoice?.selected || ranked.find((item) => String(item.symbol || "").toUpperCase() === requestedSymbol) || ranked[0];
  const mode = autoSelect ? "nyra_auto_select" : "manual_selection";
  const learning = readJson(nyraWorldPaperLearningPath, null);
  const learningPolicy = learning?.policy || {};
  const assetHistoryForDiversification = readJson(nyraWorldAssetHistoryStudyPath, null);
  const diversificationChoice = autoSelect
    ? chooseDiversifiedWorldPaperRow(row, ranked, portfolio, riskBudget, learning, assetHistoryForDiversification)
    : { row, diversified: false, reason: "manual selection" };
  row = diversificationChoice.row || row;
  if (row) {
    const selectedHistory = assetHistoryForDiversification?.by_symbol?.[row.symbol];
    const selectedThesis = row.multiverse_thesis || buildWorldMultiverseThesis(row, riskBudget, selectedHistory, loadWorldThesisLearningPolicy());
    const feeEdge = row.fee_edge || worldPaperHasFeeEdge(row, selectedThesis, feeRate, slippageRate, selectedThesis?.thesis_valid ? 1.2 : 1.6);
    row = { ...row, multiverse_thesis: selectedThesis, fee_edge: feeEdge };
  }
  if (autoChoice) {
    autoChoice.diversification = diversificationChoice;
    autoChoice.selected = row;
    autoChoice.selectedAssetHistory = assetHistoryForDiversification?.by_symbol?.[row?.symbol] || autoChoice.selectedAssetHistory || null;
  }
  const newPositionMultiplier = Number.isFinite(Number(learningPolicy.max_new_position_multiplier))
    ? Math.max(0, Math.min(1, Number(learningPolicy.max_new_position_multiplier)))
    : 1;
  const minEdgeForNewEntry = Number(learningPolicy.min_edge_for_new_entry || 0);
  const maxRiskForNewEntry = Number(learningPolicy.max_risk_for_new_entry || 100);
  const existingForSelected = portfolio.positions.find((position) => String(position.symbol || "").toUpperCase() === String(row?.symbol || "").toUpperCase());
  if (autoSelect && learningPolicy.fee_bleed_guard_active && row && !existingForSelected) {
    const thesis = row.multiverse_thesis || null;
    const highConviction =
      !learningPolicy.fee_bleed_hard_guard_active &&
      thesis?.thesis_valid &&
      row.fee_edge?.ok &&
      Number(row.edge_score || 0) >= minEdgeForNewEntry &&
      Number(row.risk_score || 0) <= maxRiskForNewEntry &&
      Number(thesis.confidence || 0) >= 62 &&
      Number(thesis.expected_value_score || 0) >= 10;
    if (!highConviction) {
      portfolio.trades.unshift({
        at: now,
        type: "anti_fee_bleed_pause",
        symbol: row.symbol || "NONE",
        gear: riskBudget.gear,
        profile: riskBudget.profile,
        reason: `Anti Robin Hood: Nyra e sotto QQQ e ha churn alto. Non apro ${row.symbol}: serve tesi valida, edge >= ${minEdgeForNewEntry}, rischio <= ${maxRiskForNewEntry}, EV forte e costi coperti.`,
        price: row.last_price || 0
      });
      writeJson(nyraWorldPaperPortfolioPath, portfolio);
      const policy = buildWorldPaperLearningPolicy(portfolio);
      return { ok: true, action: "anti_fee_bleed_pause", mode, riskBudget, autoChoice, learning: policy, portfolio, summary: summarizeWorldPaperPortfolio(portfolio, scan), treasury: buildUnifiedFinanceTreasury(portfolio), selected: row };
    }
  }
  if (
    autoSelect &&
    learning?.learning_state === "elastic_profit_learning" &&
    row &&
    (Number(row.edge_score || 0) < minEdgeForNewEntry || Number(row.risk_score || 0) > maxRiskForNewEntry)
  ) {
    portfolio.trades.unshift({
      at: now,
      type: "elastic_learning_skip",
      symbol: row.symbol || "NONE",
      gear: riskBudget.gear,
      profile: riskBudget.profile,
      reason: `elastic learning: segnale non abbastanza pulito per nuovo ingresso (${Number(row.edge_score || 0).toFixed(1)} edge / ${Number(row.risk_score || 0).toFixed(1)} risk).`,
      price: row.last_price || 0
    });
    writeJson(nyraWorldPaperPortfolioPath, portfolio);
    const policy = buildWorldPaperLearningPolicy(portfolio);
    return { ok: true, action: "elastic_learning_skip", mode, riskBudget, autoChoice, learning: policy, portfolio, summary: summarizeWorldPaperPortfolio(portfolio, scan), treasury: buildUnifiedFinanceTreasury(portfolio), selected: row };
  }
  if (autoSelect && (learning?.policy?.pause_new_entries || learning?.learning_state === "hard_profit_learning")) {
    const assetHistory = readJson(nyraWorldAssetHistoryStudyPath, null);
    const history = assetHistory?.by_symbol?.[row?.symbol];
    const hardLearningMode = riskBudget.gear >= 4 || ["hard_growth", "overdrive"].includes(String(riskBudget.profile || "")) || learning?.learning_state === "hard_profit_learning";
    const isNewClass = row && !portfolio.positions.some((position) => String(position.class || "") === String(row.class || ""));
    const isNewSymbol = row && !portfolio.positions.some((position) => String(position.symbol || "").toUpperCase() === String(row.symbol || "").toUpperCase());
    const isPenalizedSymbol = (learning.policy.penalize_symbols || []).some((item) => String(item.symbol || "") === String(row?.symbol || ""));
    const isPenalizedClass = (learning.policy.penalize_classes || []).some((item) => String(item.class || "") === String(row?.class || ""));
    const recentBlockers = recentWorldPaperTradeBlockers(portfolio, 360);
    const recentlyBlocked = recentBlockers.symbols.has(String(row?.symbol || "").toUpperCase()) || recentBlockers.classes.has(String(row?.class || "").toLowerCase());
    const thesis = row?.multiverse_thesis || null;
    const feeEdge = row?.fee_edge || worldPaperHasFeeEdge(row, thesis, feeRate, slippageRate, thesis?.thesis_valid ? 1.2 : 1.6);
    const classCount = portfolio.positions.filter((position) => String(position.class || "") === String(row?.class || "")).length;
    const canThesisDiversifiedProbe =
      hardLearningMode &&
      row &&
      thesis?.thesis_valid &&
      ["enter", "hold_thesis"].includes(String(thesis.thesis_action || "")) &&
      feeEdge.ok &&
      isNewSymbol &&
      !isPenalizedSymbol &&
      !isPenalizedClass &&
      classCount < 2 &&
      Number(row.edge_score || 0) >= 62 &&
      Number(row.risk_score || 0) <= 62;
    const canProbeFromHistory =
      row &&
      history &&
      isNewClass &&
      !isPenalizedSymbol &&
      !isPenalizedClass &&
      !recentlyBlocked &&
      Number(row.edge_score || 0) >= 65 &&
      Number(row.risk_score || 0) <= 45 &&
      feeEdge.ok &&
      Number(history.knowledge_score || 0) >= 50 &&
      !["high_volatility_convex", "duration_risk"].includes(String(history.behavior || ""));
    const canHardProbeWhileProtective =
      hardLearningMode &&
      row &&
      history &&
      isNewSymbol &&
      !isPenalizedSymbol &&
      !recentBlockers.symbols.has(String(row.symbol || "").toUpperCase()) &&
      Number(row.edge_score || 0) >= 70 &&
      Number(row.risk_score || 0) <= 48 &&
      feeEdge.ok &&
      Number(history.knowledge_score || 0) >= 28 &&
      !["high_volatility_convex", "duration_risk"].includes(String(history.behavior || ""));
    if (canProbeFromHistory || canHardProbeWhileProtective || canThesisDiversifiedProbe) {
      const convictionAllocation = thesis?.thesis_valid && feeEdge.ok && Number(thesis.confidence || 0) >= 58 ? 0.025 : 0.016;
      const probeMaxAllocation = canThesisDiversifiedProbe ? convictionAllocation : canHardProbeWhileProtective ? 0.018 : 0.025;
      const probeBudget = Math.min(
        Number(portfolio.cash_eur || 0),
        Number(treasury.paperCashAvailableEur || 0),
        capital * Math.min(maxAllocation, probeMaxAllocation)
      );
      if (probeBudget >= 100) {
        const entryPrice = Number(row.last_price || 0) * (1 + slippageRate);
        const fee = probeBudget * feeRate;
        const netBudget = probeBudget - fee;
        const quantity = entryPrice > 0 ? netBudget / entryPrice : 0;
        const marketValue = quantity * Number(row.last_price || 0);
        const position = {
          symbol: row.symbol,
          name: row.name,
          class: row.class,
          region: row.region,
          quantity: Number(quantity.toFixed(8)),
          entry_price: Number(entryPrice.toFixed(6)),
          last_price: Number(row.last_price || 0),
          cost_basis_eur: Number(probeBudget.toFixed(2)),
          market_value_eur: Number(marketValue.toFixed(2)),
          pnl_eur: Number((marketValue - probeBudget).toFixed(2)),
          pnl_pct: probeBudget > 0 ? Number((((marketValue / probeBudget) - 1) * 100).toFixed(4)) : 0,
          opened_at: now,
          gear: riskBudget.gear,
          profile: riskBudget.profile,
          max_allocation: Math.min(maxAllocation, probeMaxAllocation),
          last_action: row.action,
          multiverse_thesis: row.multiverse_thesis || null,
          reason: `${row.reason}; ${canThesisDiversifiedProbe ? "tesi valida diversificata" : canHardProbeWhileProtective ? "hard learning probe" : "probe storico"} ${history?.behavior || "thesis"}`
        };
        portfolio.cash_eur = Number((Number(portfolio.cash_eur || 0) - probeBudget).toFixed(2));
        portfolio.positions.push(position);
        portfolio.trades.unshift({
          at: now,
          type: "paper_probe_buy",
          symbol: row.symbol,
          gear: riskBudget.gear,
          profile: riskBudget.profile,
          budget_eur: Number(probeBudget.toFixed(2)),
          fee_eur: Number(fee.toFixed(2)),
          slippage_pct: Number((slippageRate * 100).toFixed(2)),
          price: position.entry_price,
          reason: canThesisDiversifiedProbe
            ? `area test: tesi valida e classe diversificante su ${row.symbol}; expected move ${feeEdge.expected_move_pct}% > costo richiesto ${feeEdge.required_move_pct}%, Nyra tiene con piu fiducia`
            : canHardProbeWhileProtective
            ? `hard learning: la memoria resta protettiva ma Nyra prova attacco controllato su asset studiato ${history.behavior}, size piccola`
            : `learning protettivo non blocca tutto: asset fuori cluster con memoria storica ${history.behavior}, size esplorativa`
        });
        portfolio.updated_at = now;
        writeJson(nyraWorldPaperPortfolioPath, portfolio);
        const policy = buildWorldPaperLearningPolicy(portfolio);
        return { ok: true, action: "paper_probe_buy", mode, riskBudget, autoChoice, learning: policy, portfolio, summary: summarizeWorldPaperPortfolio(portfolio, scan), treasury: buildUnifiedFinanceTreasury(portfolio), selected: row };
      }
    }
    if (
      hardLearningMode &&
      row &&
      history &&
      isNewSymbol &&
      !isPenalizedSymbol &&
      !recentBlockers.symbols.has(String(row.symbol || "").toUpperCase()) &&
      feeEdge.ok &&
      (thesis?.thesis_valid || (Number(row.edge_score || 0) >= 78 && Number(row.risk_score || 0) <= 42))
    ) {
      const probeBudget = Math.min(
        Number(portfolio.cash_eur || 0),
        Number(treasury.paperCashAvailableEur || 0),
        capital * Math.min(maxAllocation, 0.016)
      );
      if (probeBudget >= 100) {
        const entryPrice = Number(row.last_price || 0) * (1 + slippageRate);
        const fee = probeBudget * feeRate;
        const netBudget = probeBudget - fee;
        const quantity = entryPrice > 0 ? netBudget / entryPrice : 0;
        const marketValue = quantity * Number(row.last_price || 0);
        const position = {
          symbol: row.symbol,
          name: row.name,
          class: row.class,
          region: row.region,
          quantity: Number(quantity.toFixed(8)),
          entry_price: Number(entryPrice.toFixed(6)),
          last_price: Number(row.last_price || 0),
          cost_basis_eur: Number(probeBudget.toFixed(2)),
          market_value_eur: Number(marketValue.toFixed(2)),
          pnl_eur: Number((marketValue - probeBudget).toFixed(2)),
          pnl_pct: probeBudget > 0 ? Number((((marketValue / probeBudget) - 1) * 100).toFixed(4)) : 0,
          opened_at: now,
          gear: riskBudget.gear,
          profile: riskBudget.profile,
          max_allocation: Math.min(maxAllocation, 0.01),
          last_action: row.action,
          multiverse_thesis: row.multiverse_thesis || null,
          reason: `${row.reason}; fallback hard profit learning ${history.behavior}`
        };
        portfolio.cash_eur = Number((Number(portfolio.cash_eur || 0) - probeBudget).toFixed(2));
        portfolio.positions.push(position);
        portfolio.trades.unshift({
          at: now,
          type: "paper_profit_learning_probe",
          symbol: row.symbol,
          gear: riskBudget.gear,
          profile: riskBudget.profile,
          budget_eur: Number(probeBudget.toFixed(2)),
          fee_eur: Number(fee.toFixed(2)),
          slippage_pct: Number((slippageRate * 100).toFixed(2)),
          price: position.entry_price,
          reason: `capitale paper = palestra, ma non fee-machine: ingresso solo per edge sopra costi (${feeEdge.expected_move_pct}% atteso / ${feeEdge.required_move_pct}% richiesto); asset studiato ${history.behavior}`
        });
        portfolio.updated_at = now;
        writeJson(nyraWorldPaperPortfolioPath, portfolio);
        const policy = buildWorldPaperLearningPolicy(portfolio);
        return { ok: true, action: "paper_profit_learning_probe", mode, riskBudget, autoChoice, learning: policy, portfolio, summary: summarizeWorldPaperPortfolio(portfolio, scan), treasury: buildUnifiedFinanceTreasury(portfolio), selected: row };
      }
    }
    portfolio.trades.unshift({
      at: now,
      type: "learning_pause",
      symbol: row?.symbol || "NONE",
      gear: riskBudget.gear,
      profile: riskBudget.profile,
      reason: learning.policy.reason,
      price: row?.last_price || 0
    });
    writeJson(nyraWorldPaperPortfolioPath, portfolio);
    const policy = buildWorldPaperLearningPolicy(portfolio);
    return { ok: true, action: "learning_pause", mode, riskBudget, autoChoice, learning: policy, portfolio, summary: summarizeWorldPaperPortfolio(portfolio, scan), treasury: buildUnifiedFinanceTreasury(portfolio), selected: row };
  }
  if (!row || row.action === "avoid") {
    const error = new Error("Nyra non apre paper trade su un mercato in avoid.");
    error.statusCode = 409;
    throw error;
  }
  if (autoSelect && row?.fee_edge && !row.fee_edge.ok) {
    portfolio.trades.unshift({
      at: now,
      type: "fee_edge_skip",
      symbol: row.symbol || "NONE",
      gear: riskBudget.gear,
      profile: riskBudget.profile,
      reason: `skip: expected move ${row.fee_edge.expected_move_pct}% non supera costo richiesto ${row.fee_edge.required_move_pct}%. Meglio non regalare fee.`,
      price: row.last_price || 0
    });
    writeJson(nyraWorldPaperPortfolioPath, portfolio);
    const policy = buildWorldPaperLearningPolicy(portfolio);
    return { ok: true, action: "fee_edge_skip", mode, riskBudget, autoChoice, learning: policy, portfolio, summary: summarizeWorldPaperPortfolio(portfolio, scan), treasury: buildUnifiedFinanceTreasury(portfolio), selected: row };
  }
  const existing = portfolio.positions.find((position) => String(position.symbol || "").toUpperCase() === String(row.symbol || "").toUpperCase());
  if (existing) {
    existing.multiverse_thesis = row.multiverse_thesis || existing.multiverse_thesis || null;
    existing.reason = row.multiverse_thesis?.thesis_valid
      ? `${existing.reason || "posizione paper gia aperta"}; tesi aggiornata: ${row.multiverse_thesis.reason}`
      : existing.reason;
    portfolio.trades.unshift({
      at: now,
      type: "hold",
      symbol: row.symbol,
      gear: riskBudget.gear,
      profile: riskBudget.profile,
      reason: "posizione paper gia aperta, aggiornata a prezzo ultimo scan",
      price: row.last_price
    });
    writeJson(nyraWorldPaperPortfolioPath, portfolio);
    const policy = buildWorldPaperLearningPolicy(portfolio);
    return { ok: true, action: "hold", mode, riskBudget, autoChoice, learning: policy, portfolio, summary: summarizeWorldPaperPortfolio(portfolio, scan), treasury: buildUnifiedFinanceTreasury(portfolio), selected: row };
  }
  const budget = Math.min(
    Number(portfolio.cash_eur || 0),
    Number(treasury.paperCashAvailableEur || 0),
    capital * maxAllocation * newPositionMultiplier
  );
  if (budget < 100) {
    const error = new Error("Capitale condiviso insufficiente: il ramo live o il paper hanno gia impegnato troppo budget.");
    error.statusCode = 409;
    throw error;
  }
  const entryPrice = Number(row.last_price || 0) * (1 + slippageRate);
  const fee = budget * feeRate;
  const netBudget = budget - fee;
  const quantity = entryPrice > 0 ? netBudget / entryPrice : 0;
  const marketValue = quantity * Number(row.last_price || 0);
  const position = {
    symbol: row.symbol,
    name: row.name,
    class: row.class,
    region: row.region,
    quantity: Number(quantity.toFixed(8)),
    entry_price: Number(entryPrice.toFixed(6)),
    last_price: Number(row.last_price || 0),
    cost_basis_eur: Number(budget.toFixed(2)),
    market_value_eur: Number(marketValue.toFixed(2)),
    pnl_eur: Number((marketValue - budget).toFixed(2)),
    pnl_pct: budget > 0 ? Number((((marketValue / budget) - 1) * 100).toFixed(4)) : 0,
    opened_at: now,
    gear: riskBudget.gear,
    profile: riskBudget.profile,
    max_allocation: maxAllocation,
    last_action: row.action,
    multiverse_thesis: row.multiverse_thesis || null,
    reason: row.reason
  };
  portfolio.cash_eur = Number((Number(portfolio.cash_eur || 0) - budget).toFixed(2));
  portfolio.positions.push(position);
  portfolio.trades.unshift({
    at: now,
    type: "paper_buy",
    symbol: row.symbol,
    gear: riskBudget.gear,
    profile: riskBudget.profile,
    budget_eur: Number(budget.toFixed(2)),
    fee_eur: Number(fee.toFixed(2)),
    slippage_pct: Number((slippageRate * 100).toFixed(2)),
    price: position.entry_price,
    reason: `paper only: ${row.reason}; ${riskBudget.reason}`
  });
  portfolio.updated_at = now;
  writeJson(nyraWorldPaperPortfolioPath, portfolio);
  const policy = buildWorldPaperLearningPolicy(portfolio);
  return { ok: true, action: "paper_buy", mode, riskBudget, autoChoice, learning: policy, portfolio, summary: summarizeWorldPaperPortfolio(portfolio, scan), treasury: buildUnifiedFinanceTreasury(portfolio), selected: row };
}

function buildNyraRenderAutopilotReport({ result = null, rebalanced = null, scan = null, study = null, assetHistory = null, memory = null } = {}) {
  const portfolio = readJson(nyraWorldPaperPortfolioPath, emptyWorldPaperPortfolio());
  const worldScan = scan || readJson(nyraWorldMarketScanPath, null);
  const summary = summarizeWorldPaperPortfolio(portfolio, worldScan);
  const ranked = Array.isArray(worldScan?.ranked) ? worldScan.ranked : [];
  const topAlternatives = ranked.slice(0, 12).map((row, index) => ({
    rank: index + 1,
    symbol: row.symbol,
    name: row.name,
    class: row.class,
    region: row.region,
    action: row.action,
    edge_score: row.edge_score,
    risk_score: row.risk_score,
    return_20d_pct: row.return_20d_pct,
    fee_edge: row.fee_edge || null,
    thesis: row.multiverse_thesis
      ? {
          action: row.multiverse_thesis.thesis_action,
          valid: row.multiverse_thesis.thesis_valid,
          confidence: row.multiverse_thesis.confidence,
          expected_value_score: row.multiverse_thesis.expected_value_score,
          reason: row.multiverse_thesis.reason
        }
      : null,
    reason: row.reason
  }));
  const report = {
    version: "nyra_render_autopilot_v1",
    generated_at: new Date().toISOString(),
    runtime: {
      service: "skinharmony-nyra-core",
      storage_root: nyraStorageRoot || "local",
      paper_only: true,
      no_real_orders: true,
      autostart_env: String(process.env.NYRA_WORLD_PAPER_AUTOSTART || ""),
      interval_minutes: Number((nyraWorldPaperAutoState.intervalMs / 60000).toFixed(2))
    },
    state: {
      enabled: nyraWorldPaperAutoState.enabled,
      running: nyraWorldPaperAutoState.running,
      cycles_completed: nyraWorldPaperAutoState.cyclesCompleted,
      last_started_at: nyraWorldPaperAutoState.lastStartedAt,
      last_finished_at: nyraWorldPaperAutoState.lastFinishedAt,
      next_run_at: nyraWorldPaperAutoState.nextRunAt,
      last_error: nyraWorldPaperAutoState.lastError
    },
    last_cycle: result
      ? {
          action: result.action,
          symbol: result.selected?.symbol || null,
          profile: result.riskBudget?.profile || null,
          gear: result.riskBudget?.gear || null,
          study_aware: Boolean(result.autoChoice?.studyAware),
          asset_history_aware: Boolean(result.autoChoice?.assetHistoryAware),
          learning_aware: Boolean(result.autoChoice?.learningAware || result.learning),
          learning_state: result.learning?.learning_state || null,
          rotation_primary: rebalanced?.rotationPlan?.primaryClass || null,
          rotation_closed_count: Array.isArray(rebalanced?.closed) ? rebalanced.closed.length : 0
        }
      : null,
    portfolio: {
      summary,
      positions: Array.isArray(portfolio.positions) ? portfolio.positions : [],
      recent_trades: Array.isArray(portfolio.trades) ? portfolio.trades.slice(0, 30) : []
    },
    learning: readJson(nyraWorldPaperLearningPath, null),
    market_memory: {
      assets_known: memory?.summary?.assets_known || readJson("universal-core/runtime/nyra-learning/nyra_world_market_memory_bank_latest.json", {})?.summary?.assets_known || 0,
      scan_markets: memory?.summary?.scan_markets || ranked.length,
      acquired_memory_preserved: true
    },
    study: {
      market_study_generated_at: study?.generated_at || null,
      asset_history_generated_at: assetHistory?.generated_at || null,
      assets_studied: Array.isArray(assetHistory?.assets) ? assetHistory.assets.length : null
    },
    alternatives_not_taken: topAlternatives,
    guardrails: [
      "paper trading only: nessun ordine reale",
      "non inventare dati mancanti",
      "ogni decisione viene confrontata con alternative non prese",
      "memoria e report persistono su NYRA_STORAGE_ROOT quando configurato"
    ]
  };
  writeJson(nyraRenderAutopilotRuntimePath, report);
  writeJson(nyraRenderAutopilotReportPath, report);
  return report;
}

async function runNyraWorldPaperAutoCycle() {
  if (!nyraWorldPaperAutoState.enabled || nyraWorldPaperAutoState.running) return;
  nyraWorldPaperAutoState.running = true;
  nyraWorldPaperAutoState.lastStartedAt = new Date().toISOString();
  nyraWorldPaperAutoState.lastError = "";
  try {
    await refreshNyraFinanceProfileState();
    await runNodeJson([
      "--experimental-strip-types",
      "universal-core/tools/nyra-world-news-thesis.ts"
    ], { timeoutMs: 180000 });
    await runNodeJson([
      "--experimental-strip-types",
      "universal-core/tools/nyra-world-asset-history-study.ts"
    ], { timeoutMs: 180000 });
    await runNodeJson([
      "--experimental-strip-types",
      "universal-core/tools/nyra-world-market-scan.ts"
    ], { timeoutMs: 120000 });
    const ranked = Array.isArray(readJson(nyraWorldMarketScanPath, null)?.ranked) ? readJson(nyraWorldMarketScanPath, null).ranked : [];
    const portfolio = updatePaperPositionMarks(readJson(nyraWorldPaperPortfolioPath, emptyWorldPaperPortfolio()), ranked);
    const rebalanced = maybeRebalanceWorldPaperByRotation(portfolio, ranked, loadNyraFinanceProfileConfig());
    writeJson(nyraWorldPaperPortfolioPath, rebalanced.portfolio);
    buildWorldPaperLearningPolicy(rebalanced.portfolio);
    const result = executeWorldPaperStep({ autoSelect: true });
    await runNodeJson([
      "--experimental-strip-types",
      "universal-core/tools/nyra-world-market-memory-assimilator.ts"
    ], { timeoutMs: 120000 });
    const scan = readJson(nyraWorldMarketScanPath, null);
    const study = readJson(nyraWorldMarketStudyPath, null);
    const assetHistory = readJson(nyraWorldAssetHistoryStudyPath, null);
    const memory = readJson("universal-core/runtime/nyra-learning/nyra_world_market_memory_bank_latest.json", null);
    nyraWorldPaperAutoState.cyclesCompleted += 1;
    const autopilotReport = buildNyraRenderAutopilotReport({ result, rebalanced, scan, study, assetHistory, memory });
    nyraWorldPaperAutoState.lastResult = {
      at: new Date().toISOString(),
      action: result.action,
      symbol: result.selected?.symbol,
      gear: result.riskBudget?.gear,
      profile: result.riskBudget?.profile,
      studyAware: Boolean(result.autoChoice?.studyAware),
      assetHistoryAware: Boolean(result.autoChoice?.assetHistoryAware),
      assetBehavior: result.autoChoice?.selectedAssetHistory?.behavior || null,
      learningAware: Boolean(result.autoChoice?.learningAware || result.learning),
      learningState: result.learning?.learning_state || null,
      closedCount: rebalanced.closed.length,
      rotationPrimary: rebalanced.rotationPlan?.primaryClass || null,
      summary: result.summary,
      reportPath: nyraRenderAutopilotReportPath,
      report: {
        portfolio: autopilotReport.portfolio?.summary || null,
        alternativesCount: autopilotReport.alternatives_not_taken?.length || 0
      }
    };
    nyraWorldPaperAutoState.lastFinishedAt = new Date().toISOString();
    saveNyraWorldPaperAutoState();
  } catch (error) {
    nyraWorldPaperAutoState.lastError = error.message;
    nyraWorldPaperAutoState.lastFinishedAt = new Date().toISOString();
    buildNyraRenderAutopilotReport();
    saveNyraWorldPaperAutoState();
  } finally {
    nyraWorldPaperAutoState.running = false;
  }
}

function scheduleNyraWorldPaperAutoLoop(immediate = false) {
  if (nyraWorldPaperAutoTimer) clearInterval(nyraWorldPaperAutoTimer);
  if (!nyraWorldPaperAutoState.enabled) {
    nyraWorldPaperAutoState.nextRunAt = "";
    saveNyraWorldPaperAutoState();
    return;
  }
  nyraWorldPaperAutoState.nextRunAt = new Date(Date.now() + nyraWorldPaperAutoState.intervalMs).toISOString();
  saveNyraWorldPaperAutoState();
  nyraWorldPaperAutoTimer = setInterval(() => {
    nyraWorldPaperAutoState.nextRunAt = new Date(Date.now() + nyraWorldPaperAutoState.intervalMs).toISOString();
    saveNyraWorldPaperAutoState();
    runNyraWorldPaperAutoCycle().catch(() => {});
  }, nyraWorldPaperAutoState.intervalMs);
  if (immediate) runNyraWorldPaperAutoCycle().catch(() => {});
}

function nyraWorldPaperAutoStatusPayload() {
  const portfolio = readJson(nyraWorldPaperPortfolioPath, emptyWorldPaperPortfolio());
  const worldScan = readJson(nyraWorldMarketScanPath, null);
  ensureWorldPaperBenchmark(portfolio, worldScan);
  const treasury = buildUnifiedFinanceTreasury(portfolio);
  const learning = readJson(nyraWorldPaperLearningPath, null);
  return {
    ok: true,
    ...nyraWorldPaperAutoState,
    learning,
    portfolio,
    summary: summarizeWorldPaperPortfolio(portfolio, worldScan),
    treasury
  };
}

app.get("/api/nyra/finance/world-paper", (_req, res) => {
  const portfolio = readJson(nyraWorldPaperPortfolioPath, emptyWorldPaperPortfolio());
  const worldScan = readJson(nyraWorldMarketScanPath, null);
  ensureWorldPaperBenchmark(portfolio, worldScan);
  const treasury = buildUnifiedFinanceTreasury(portfolio);
  const learning = readJson(nyraWorldPaperLearningPath, null);
  res.json({
    ok: true,
    portfolio,
    summary: summarizeWorldPaperPortfolio(portfolio, worldScan),
    learning,
    treasury
  });
});

app.post("/api/nyra/finance/world-paper/reset", (req, res) => {
  const portfolio = emptyWorldPaperPortfolio(req.body?.initialCapitalEur);
  const worldScan = readJson(nyraWorldMarketScanPath, null);
  ensureWorldPaperBenchmark(portfolio, worldScan);
  writeJson(nyraWorldPaperPortfolioPath, portfolio);
  const learning = buildWorldPaperLearningPolicy(portfolio);
  const treasury = buildUnifiedFinanceTreasury(portfolio);
  res.json({
    ok: true,
    portfolio,
    summary: summarizeWorldPaperPortfolio(portfolio, worldScan),
    learning,
    treasury
  });
});

app.post("/api/nyra/finance/world-paper/step", (req, res) => {
  try {
    res.json(executeWorldPaperStep(req.body || {}));
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  }
});

app.get("/api/nyra/finance/world-paper/auto/status", (_req, res) => {
  res.json(nyraWorldPaperAutoStatusPayload());
});

app.get("/api/nyra/finance/world-paper/auto/report", (_req, res) => {
  res.json({
    ok: true,
    report: readJson(nyraRenderAutopilotRuntimePath, null)
  });
});

app.post("/api/nyra/finance/world-paper/auto/start", (req, res) => {
  const minutes = Number(req.body?.intervalMinutes || 10);
  nyraWorldPaperAutoState.intervalMs = Math.max(60_000, Math.min(60 * 60_000, minutes * 60_000));
  nyraWorldPaperAutoState.enabled = true;
  saveNyraWorldPaperAutoState();
  scheduleNyraWorldPaperAutoLoop(true);
  res.json(nyraWorldPaperAutoStatusPayload());
});

app.post("/api/nyra/finance/world-paper/auto/stop", (_req, res) => {
  nyraWorldPaperAutoState.enabled = false;
  if (nyraWorldPaperAutoTimer) {
    clearInterval(nyraWorldPaperAutoTimer);
    nyraWorldPaperAutoTimer = null;
  }
  saveNyraWorldPaperAutoState();
  res.json(nyraWorldPaperAutoStatusPayload());
});

app.get("/api/nyra/finance/live/status", (_req, res) => {
  res.json(nyraFinanceLiveStatusPayload());
});

app.get("/api/nyra/finance/history", (_req, res) => {
  res.json({
    ok: true,
    history: loadNyraFinanceHistory()
  });
});

app.post("/api/nyra/finance/live/start", (_req, res) => {
  nyraFinanceLiveState.enabled = true;
  scheduleNyraFinanceLiveLoop(true);
  res.json(nyraFinanceLiveStatusPayload());
});

app.post("/api/nyra/finance/live/stop", (_req, res) => {
  nyraFinanceLiveState.enabled = false;
  if (nyraFinanceLiveTimer) {
    clearInterval(nyraFinanceLiveTimer);
    nyraFinanceLiveTimer = null;
  }
  syncNyraFinanceKeepAwake();
  res.json(nyraFinanceLiveStatusPayload());
});

app.get("/api/nyra/snapshot", (_req, res) => {
  res.json({
    generatedAt: new Date().toISOString(),
    map: readText("universal-core/runtime/nyra/NYRA_MAP_SNAPSHOT.md", "").slice(0, 5000),
    state: readJson("universal-core/runtime/nyra/NYRA_STATE_SNAPSHOT.json", {}),
    work: readText("universal-core/runtime/nyra/NYRA_WORK_SNAPSHOT.md", "").slice(0, 5000),
    voice: readText("universal-core/runtime/nyra/NYRA_REAL_VOICE_PROFILE.md", "").slice(0, 5000)
  });
});

app.post("/api/nyra/read-only", async (req, res) => {
  const message = String(req.body.message || "").trim();
  if (!message) {
    res.status(400).json({ error: "Messaggio mancante." });
    return;
  }
  try {
    const result = await runNodeJson([
      "--experimental-strip-types",
      "universal-core/tools/nyra-communication-adapter.ts",
      message
    ]);
    res.json({
      ok: true,
      suit: chooseNyraSuit(message),
      result
    });
  } catch (error) {
    res.json({
      ok: false,
      suit: chooseNyraSuit(message),
      result: {
        mode: "read_only",
        reply: `Non riesco a raggiungere il runtime Nyra. Punto: ${error.message}`,
        intent: "runtime_error",
        tone: "direct",
        action_band: "reply_only",
        owner_sensitive: false,
        snapshots: {},
        writes_memory: false
      }
    });
  }
});

app.post("/api/nyra/suit", (req, res) => {
  const message = String(req.body.message || "").trim();
  res.json({
    ok: true,
    suit: chooseNyraSuit(message)
  });
});

app.get("/api/ai/context", (_req, res) => {
  const campaigns = summarizeCampaigns();
  const leads = summarizeLeads();
  const behavior = summarizeBehavior();
  const economics = summarizeEconomics(campaigns);
  const inventory = summarizeInventory(economics);
  const social = summarizeSocial();
  const sources = summarizeDataSources();
  const manualInventory = summarizeManualInventory();
  const alerts = buildAlerts(campaigns, behavior);
  const decision = buildDecisionSummary(campaigns, behavior, economics, alerts);
  const agenda = summarizeAgenda();
  const productivity = summarizeProductivity(campaigns, behavior, economics, manualInventory, agenda);
  const dataQuality = summarizeDataQuality(sources, economics, manualInventory);
  const executive = buildExecutiveSummary(campaigns, behavior, economics, inventory, manualInventory, social, sources, alerts, productivity, dataQuality);
  const websiteFunnel = summarizeWebsiteFunnel();

  res.json({
    generatedAt: new Date().toISOString(),
    decision,
    campaigns,
    leadSummary: leads,
    leads: leads.latest,
    funnel: leads.funnel,
    actions: summarizeActions(),
    behavior,
    sales: economics.sales,
    economics,
    inventory,
    manualInventory,
    social,
    sources,
    websiteFunnel,
    dataQuality,
    productivity,
    executive,
    alerts
  });
});

app.post("/api/assistant/strategy", (req, res) => {
  const question = String(req.body.question || "").trim();
  const campaigns = summarizeCampaigns();
  const leads = summarizeLeads();
  const agenda = summarizeAgenda();
  const timeline = buildOutreachTimeline();
  const behavior = summarizeBehavior();
  const economics = summarizeEconomics(campaigns);
  const inventory = summarizeInventory(economics);
  const social = summarizeSocial();
  const sources = summarizeDataSources();
  const manualInventory = summarizeManualInventory();
  const alerts = buildAlerts(campaigns, behavior);
  const productivity = summarizeProductivity(campaigns, behavior, economics, manualInventory, agenda);
  const dataQuality = summarizeDataQuality(sources, economics, manualInventory);
  const executive = buildExecutiveSummary(campaigns, behavior, economics, inventory, manualInventory, social, sources, alerts, productivity, dataQuality);
  const totalSends = campaigns.reduce((sum, item) => sum + item.sends, 0);
  const totalReplies = campaigns.reduce((sum, item) => sum + item.replies, 0);
  const responseRate = totalSends ? totalReplies / totalSends : 0;
  const weakCampaigns = campaigns.filter((item) => item.sends > 0 && item.responseRate < 0.2);
  const latestDay = timeline.at(-1);
  const recentLeadFiles = leads.files.slice(0, 5);

  const lines = [];
  lines.push(`Ho letto i dati locali aggiornati. Invii totali: ${totalSends}, risposte tracciate: ${totalReplies}, tasso medio: ${Math.round(responseRate * 100)}%.`);
  lines.push(`Qualita dati direzionali: ${dataQuality.score}% (${dataQuality.status}). Produttivita oggi: indice ${productivity.today.outputScore}, ${productivity.today.sends} invii, ${productivity.today.interactions} interazioni, ${productivity.today.sales} vendite.`);

  if (latestDay) {
    lines.push(`Ultimo giorno con movimento: ${latestDay.date}, con ${latestDay.sends} invii e ${latestDay.replies} risposte registrate.`);
  }

  if (weakCampaigns.length > 0) {
    lines.push(`Campagne sotto soglia 20%: ${weakCampaigns.map((item) => `${item.label} (${Math.round(item.responseRate * 100)}%)`).join(", ")}.`);
  } else {
    lines.push("Nessuna campagna risulta sotto soglia sui dati attuali.");
  }

  const lowerQuestion = question.toLowerCase();
  if (lowerQuestion.includes("strategy") || lowerQuestion.includes("strategia") || lowerQuestion.includes("marketing")) {
    lines.push("Strategia consigliata: separare i prossimi messaggi per target, mantenendo un angolo diverso per ogni segmento.");
    lines.push("Distributori: spingere ecosistema commerciale SkinPro + Smart Desk, non solo prodotto. Parrucchieri: partire da O3 System e usare Smart Desk come controllo salone. Estetiste: partire da Skin Pro e usare Smart Desk come gestione centro.");
    lines.push("Prima di inviare nuovi batch, aspetterei le risposte dei follow-up appena mandati e misurerei quali target superano il 20%.");
  } else if (lowerQuestion.includes("risposte") || lowerQuestion.includes("follow")) {
    lines.push("Priorità follow-up: controllare risposte ogni giorno, segnare positive/negative e non reinviare a chi ha già risposto negativamente.");
    lines.push("Il ciclo corretto resta 10 giorni: dopo la finestra, se il tasso rimane sotto 20%, va cambiato testo, target o proposta.");
  } else if (lowerQuestion.includes("lead") || lowerQuestion.includes("contatti")) {
    lines.push(`I file lead più pieni sono: ${recentLeadFiles.map((item) => `${item.file.replace("lead/", "")} (${item.count})`).join(", ")}.`);
    lines.push("Operativamente conviene lavorare sui lead nuovi separati per area, così resta chiaro cosa è stato cercato, contattato e monitorato.");
  } else {
    lines.push("Prossima azione consigliata: monitorare risposte, non aumentare troppo il volume oggi, e preparare una revisione messaggio solo dopo avere dati sui follow-up Smart Desk.");
  }

  if (agenda.totalOpenTodos > 0) {
    lines.push(`Task aperti nel Control Desk: ${agenda.totalOpenTodos}. Vanno chiusi o trasformati in prossime azioni giornaliere.`);
  }

  if (alerts.length > 0) {
    lines.push(`Alert attivi: ${alerts.slice(0, 3).map((alert) => alert.message).join(" ")}`);
  }

  if (economics.sales.length > 0) {
    lines.push(`Parte economica: fatturato tracciato ${economics.totalRevenue} EUR, margine tracciato ${economics.totalMargin} EUR.`);
  } else {
    lines.push("Parte economica: non risultano ancora vendite manuali collegate ai lead. Quando un lead diventa cliente, va registrato prodotto, prezzo e costo stimato.");
  }

  if (executive.strategicActions.length > 0) {
    lines.push(`Direzione consigliata: ${executive.strategicActions.map((item) => `${item.title}: ${item.detail}`).join(" ")}`);
  }

  res.json({
    answer: lines.join("\n\n"),
    usedData: {
      campaigns,
      timelinePoints: timeline.length,
      leadFiles: leads.files.length,
      openTodos: agenda.totalOpenTodos,
      alerts: alerts.length,
      sales: economics.sales.length,
      dataQuality: dataQuality.score,
      productivityScore: productivity.today.outputScore
    }
  });
});

app.post("/api/assistant/ai", async (req, res) => {
  const question = String(req.body.question || "").trim();
  if (!question) {
    res.status(400).json({ error: "Domanda mancante." });
    return;
  }

  const context = buildControlContext();
  try {
    const result = await callOpenAIAssistant(question, context);
    res.json({
      ok: true,
      mode: "openai",
      answer: result.answer,
      model: result.model,
      usedData: result.usedData
    });
  } catch (error) {
    const fallback = buildLocalStrategyAnswer(question, context);
    res.json({
      ok: true,
      mode: "local_fallback",
      answer: [
        "OpenAI non ha risposto, quindi uso la strategia locale sui dati reali.",
        `Motivo tecnico: ${error.message}`,
        "",
        fallback.answer
      ].join("\n"),
      usedData: fallback.usedData
    });
  }
});

app.post("/api/assistant/action", async (req, res) => {
  const prompt = String(req.body.prompt || "").trim();
  const scope = String(req.body.scope || "global");
  const cardType = String(req.body.cardType || "");
  const mode = String(req.body.mode || "brief") === "complete" ? "complete" : "brief";
  if (!prompt) {
    res.status(400).json({ error: "Comando AI mancante." });
    return;
  }

  const context = buildControlContext();
  try {
    const result = await callOpenAIAction({ prompt, scope, cardType, mode, context });
    res.json({ ok: true, mode: "openai", result });
  } catch (error) {
    const result = localActionProposal({ prompt, scope, cardType, context });
    res.json({
      ok: true,
      mode: "local_fallback",
      result: {
        ...result,
        warnings: [`OpenAI non ha risposto: ${error.message}`, ...(result.warnings || [])]
      }
    });
  }
});

app.post("/api/assistant/commit", (req, res) => {
  const proposal = req.body.proposal || {};
  const type = String(proposal.type || "");
  const now = new Date().toISOString();

  if (type === "task") {
    const title = String(proposal.title || "").trim();
    if (!title) {
      res.status(400).json({ error: "Titolo task mancante." });
      return;
    }
    const data = readJson("agenda/todo.json", { attivita: [] });
    data.attivita = Array.isArray(data.attivita) ? data.attivita : [];
    data.attivita.push({
      id: `todo_${Date.now()}`,
      titolo: title,
      priorita: String(proposal.priority || "media"),
      scadenza: String(proposal.due || ""),
      stato: "aperta",
      note: String(proposal.note || ""),
      origine: "ai_control_desk"
    });
    writeJson("agenda/todo.json", data);
    res.json({ ok: true, savedAs: "task" });
    return;
  }

  if (type === "note") {
    const leadIdValue = String(proposal.leadId || "").trim();
    if (!leadIdValue) {
      res.status(400).json({ error: "Lead mancante per salvare la nota." });
      return;
    }
    const data = loadControlData();
    data.interactions.push({
      id: `interaction_${Date.now()}`,
      leadId: leadIdValue,
      type: "nota_ai",
      channel: "ai",
      date: now,
      response: false,
      note: String(proposal.note || proposal.title || "")
    });
    saveControlData(data);
    res.json({ ok: true, savedAs: "note" });
    return;
  }

  if (type === "email_draft") {
    const data = loadControlData();
    data.aiDrafts.push({
      id: `ai_draft_${Date.now()}`,
      date: now,
      to: String(proposal.to || ""),
      subject: String(proposal.subject || proposal.title || ""),
      body: String(proposal.body || proposal.note || ""),
      status: "draft",
      source: "ai_control_desk"
    });
    saveControlData(data);
    res.json({ ok: true, savedAs: "email_draft" });
    return;
  }

  if (type === "strategy") {
    const data = loadControlData();
    data.aiDrafts.push({
      id: `ai_strategy_${Date.now()}`,
      date: now,
      title: String(proposal.title || "Strategia AI"),
      body: String(proposal.note || proposal.body || ""),
      status: "strategy",
      source: "ai_control_desk"
    });
    saveControlData(data);
    res.json({ ok: true, savedAs: "strategy" });
    return;
  }

  res.status(400).json({ error: "Tipo proposta non supportato." });
});

app.patch("/api/leads/status", (req, res) => {
  const file = String(req.body.file || "");
  const index = Number(req.body.index);
  const status = String(req.body.status || "");

  if (!file.startsWith("lead/") || !leadStatuses.includes(status) || !Number.isInteger(index)) {
    res.status(400).json({ error: "Dati stato lead non validi." });
    return;
  }

  const data = readJson(file, { leads: [] });
  if (!Array.isArray(data.leads) || !data.leads[index]) {
    res.status(404).json({ error: "Lead non trovato." });
    return;
  }

  data.leads[index].stato = status;
  data.leads[index].ultimo_aggiornamento = new Date().toISOString().slice(0, 10);
  data.leads[index].ultima_azione = `stato aggiornato manualmente a ${status}`;
  writeJson(file, data);
  res.json({ ok: true });
});

app.post("/api/interactions", (req, res) => {
  const leadIdValue = String(req.body.leadId || "").trim();
  if (!leadIdValue) {
    res.status(400).json({ error: "Lead mancante." });
    return;
  }

  const data = loadControlData();
  data.interactions.push({
    id: `interaction_${Date.now()}`,
    leadId: leadIdValue,
    type: String(req.body.type || "nota"),
    channel: String(req.body.channel || "email"),
    date: req.body.date || new Date().toISOString(),
    response: Boolean(req.body.response),
    note: String(req.body.note || "")
  });
  saveControlData(data);
  res.json({ ok: true });
});

app.post("/api/sales", (req, res) => {
  const leadIdValue = String(req.body.leadId || "").trim();
  const product = String(req.body.product || "").trim();
  const price = Number(req.body.price || 0);
  const estimatedCost = Number(req.body.estimatedCost || 0);

  if (!leadIdValue || !product) {
    res.status(400).json({ error: "Lead e prodotto sono obbligatori." });
    return;
  }

  const data = loadControlData();
  data.sales.push({
    id: `sale_${Date.now()}`,
    leadId: leadIdValue,
    campaignId: String(req.body.campaignId || ""),
    product,
    price,
    estimatedCost,
    margin: price - estimatedCost,
    date: req.body.date || new Date().toISOString().slice(0, 10)
  });
  saveControlData(data);
  res.json({ ok: true });
});

app.post("/api/social", (req, res) => {
  const content = String(req.body.content || "").trim();
  if (!content) {
    res.status(400).json({ error: "Contenuto mancante." });
    return;
  }

  const data = loadControlData();
  data.socialContents.push({
    id: `social_${Date.now()}`,
    content,
    contentType: String(req.body.contentType || "post"),
    platform: String(req.body.platform || "instagram"),
    publishDate: req.body.publishDate || new Date().toISOString().slice(0, 10),
    leadsGenerated: Number(req.body.leadsGenerated || 0)
  });
  saveControlData(data);
  res.json({ ok: true });
});

app.post("/api/productivity", (req, res) => {
  const title = String(req.body.title || "").trim();
  const hours = Number(req.body.hours || 0);
  const actions = Number(req.body.actions || 0);
  if (!title) {
    res.status(400).json({ error: "Attivita produttiva mancante." });
    return;
  }

  const data = loadControlData();
  data.productivityLogs.push({
    id: `productivity_${Date.now()}`,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    title,
    category: String(req.body.category || "operativo"),
    hours,
    actions,
    outcome: String(req.body.outcome || ""),
    createdAt: new Date().toISOString()
  });
  saveControlData(data);
  res.json({ ok: true });
});

app.post("/api/sources/website", (req, res) => {
  const data = loadControlData();
  data.websiteSnapshots.push({
    id: `website_${Date.now()}`,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    visits: Number(req.body.visits || 0),
    leads: Number(req.body.leads || 0),
    conversionRate: Number(req.body.conversionRate || 0),
    topPage: String(req.body.topPage || ""),
    note: String(req.body.note || "")
  });
  saveControlData(data);
  res.json({ ok: true });
});

app.post("/api/website/events", (req, res) => {
  const allowedEvents = new Set(["trial_click", "login_click", "demo_click", "lead_form_submit", "smartdesk_cta_click"]);
  const eventName = String(req.body.eventName || req.body.name || "").trim();
  if (!allowedEvents.has(eventName)) {
    res.status(400).json({ error: "Evento sito non valido." });
    return;
  }
  const data = loadControlData();
  data.websiteEvents.push({
    id: `website_event_${Date.now()}`,
    date: req.body.date || new Date().toISOString(),
    eventName,
    label: String(req.body.label || ""),
    path: String(req.body.path || ""),
    href: String(req.body.href || ""),
    source: "control_desk_event_endpoint"
  });
  saveControlData(data);
  res.json({ ok: true });
});

app.post("/api/sync/wordpress", async (_req, res) => {
  try {
    const snapshot = await syncWordPressSource();
    res.json({ ok: true, snapshot });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sync/search-console", async (_req, res) => {
  try {
    const snapshot = await syncSearchConsoleSource();
    res.json({ ok: true, snapshot });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sync/ga4", async (_req, res) => {
  try {
    const snapshot = await syncGa4Source();
    res.json({ ok: true, snapshot });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sources/instagram", (req, res) => {
  const data = loadControlData();
  data.instagramSnapshots.push({
    id: `instagram_${Date.now()}`,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    followers: Number(req.body.followers || 0),
    reach: Number(req.body.reach || 0),
    profileVisits: Number(req.body.profileVisits || 0),
    leads: Number(req.body.leads || 0),
    note: String(req.body.note || "")
  });
  saveControlData(data);
  res.json({ ok: true });
});

app.post("/api/sync/instagram", async (_req, res) => {
  try {
    const snapshot = await syncInstagramSource();
    res.json({ ok: true, snapshot });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sources/smartdesk", (req, res) => {
  const data = loadControlData();
  data.smartDeskSnapshots.push({
    id: `smartdesk_${Date.now()}`,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    clients: Number(req.body.clients || 0),
    appointments: Number(req.body.appointments || 0),
    sales: Number(req.body.sales || 0),
    stockAlerts: Number(req.body.stockAlerts || 0),
    note: String(req.body.note || "")
  });
  saveControlData(data);
  res.json({ ok: true });
});

app.post("/api/sync/smartdesk", async (_req, res) => {
  try {
    const snapshot = await syncSmartDeskSource();
    res.json({ ok: true, snapshot });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sync/render", async (_req, res) => {
  try {
    const snapshot = await syncRenderSource();
    res.json({ ok: true, snapshot });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sync/github", async (_req, res) => {
  try {
    const snapshot = await syncGitHubSource();
    res.json({ ok: true, snapshot });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/sync/all", async (_req, res) => {
  const jobs = [
    ["wordpress", syncWordPressSource],
    ["search-console", syncSearchConsoleSource],
    ["ga4", syncGa4Source],
    ["instagram", syncInstagramSource],
    ["smartdesk", syncSmartDeskSource],
    ["render", syncRenderSource],
    ["github", syncGitHubSource]
  ];
  const results = [];
  for (const [name, fn] of jobs) {
    try {
      results.push({ name, ok: true, snapshot: await fn() });
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
    }
  }
  res.json({ ok: results.some((item) => item.ok), results });
});

app.post("/api/manual-contacts", (req, res) => {
  const name = String(req.body.name || "").trim();
  const contact = String(req.body.contact || "").trim();
  if (!name || !contact) {
    res.status(400).json({ error: "Nome e contatto sono obbligatori." });
    return;
  }

  const now = new Date().toISOString();
  const leadFile = "lead/control_desk_manual_contacts.json";
  const leadData = readJson(leadFile, {
    data_creazione: now.slice(0, 10),
    origine: "Control Desk manuale",
    leads: []
  });
  leadData.leads = Array.isArray(leadData.leads) ? leadData.leads : [];

  const lead = {
    nome: name,
    contatto: contact,
    telefono: String(req.body.phone || ""),
    tipo_contatto: String(req.body.type || "contatto_manuale"),
    canale: String(req.body.channel || "manuale"),
    stato: String(req.body.status || "nuovo"),
    data_creazione: now.slice(0, 10),
    ultimo_aggiornamento: now.slice(0, 10),
    prossima_azione: String(req.body.nextStep || ""),
    ultima_azione: "contatto caricato manualmente da Control Desk",
    note: String(req.body.note || "")
  };
  leadData.leads.push(lead);
  writeJson(leadFile, leadData);

  const data = loadControlData();
  data.manualContacts.push({
    id: `manual_contact_${Date.now()}`,
    leadId: contact,
    name,
    contact,
    channel: lead.canale,
    type: lead.tipo_contatto,
    status: lead.stato,
    createdAt: now,
    leadFile
  });
  saveControlData(data);
  res.json({ ok: true, leadFile });
});

app.post("/api/inventory/items", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "Nome prodotto obbligatorio." });
    return;
  }

  const data = loadControlData();
  data.inventoryItems.push({
    id: `product_${Date.now()}`,
    name,
    sku: String(req.body.sku || ""),
    initialQuantity: Number(req.body.initialQuantity || 0),
    minQuantity: Number(req.body.minQuantity || 0),
    unitCost: Number(req.body.unitCost || 0),
    linkedCampaign: String(req.body.linkedCampaign || ""),
    createdAt: new Date().toISOString()
  });
  saveControlData(data);
  res.json({ ok: true });
});

app.post("/api/inventory/movements", (req, res) => {
  const productId = String(req.body.productId || "").trim();
  const quantity = Number(req.body.quantity || 0);
  const type = String(req.body.type || "");
  if (!productId || !["carico", "scarico"].includes(type) || quantity <= 0) {
    res.status(400).json({ error: "Movimento magazzino non valido." });
    return;
  }

  const data = loadControlData();
  const product = data.inventoryItems.find((item) => item.id === productId);
  if (!product) {
    res.status(404).json({ error: "Prodotto non trovato." });
    return;
  }

  data.inventoryMovements.push({
    id: `movement_${Date.now()}`,
    productId,
    productName: product.name,
    type,
    quantity,
    reason: String(req.body.reason || ""),
    linkedLeadId: String(req.body.linkedLeadId || ""),
    linkedCampaign: String(req.body.linkedCampaign || product.linkedCampaign || ""),
    date: req.body.date || new Date().toISOString()
  });
  saveControlData(data);
  res.json({ ok: true });
});

app.post("/api/actions/monitor-outreach", async (_req, res) => {
  const result = await runCommand("npm", ["run", "monitor:outreach"]);
  res.json(result);
});

app.post("/api/actions/report-outreach", async (_req, res) => {
  const result = await runCommand("npm", ["run", "report:outreach"]);
  res.json(result);
});

app.post("/api/tasks", (req, res) => {
  const title = String(req.body.title || "").trim();
  const priority = String(req.body.priority || "media").trim();
  const due = String(req.body.due || "").trim();

  if (!title) {
    res.status(400).json({ error: "Titolo attività mancante." });
    return;
  }

  const data = readJson("agenda/todo.json", { attivita: [] });
  data.attivita = Array.isArray(data.attivita) ? data.attivita : [];
  data.attivita.push({
    id: `todo_${Date.now()}`,
    titolo: title,
    priorita: priority,
    scadenza: due,
    stato: "aperta"
  });
  writeJson("agenda/todo.json", data);

  res.json({ ok: true });
});

const server = app.listen(port, host, () => {
  console.log(`SkinHarmony Control Desk attivo su http://${host}:${port}`);
  seedNyraRuntimeFromBootstrap();
  restoreNyraWorldPaperAutoState();
  applyNyraWorldPaperAutoEnvDefaults();
  const runPaperOnBoot = nyraWorldPaperAutoState.enabled && ["1", "true", "yes", "on"].includes(String(process.env.NYRA_WORLD_PAPER_RUN_ON_BOOT || "").trim().toLowerCase());
  scheduleNyraWorldPaperAutoLoop(runPaperOnBoot);
  scheduleNyraFinanceLiveLoop(true);
});

server.on("error", (error) => {
  console.error(`Errore server Control Desk: ${error.message}`);
  process.exit(1);
});

process.on("SIGINT", () => {
  stopNyraFinanceKeepAwake();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopNyraFinanceKeepAwake();
  process.exit(0);
});

setInterval(() => {}, 60 * 60 * 1000);

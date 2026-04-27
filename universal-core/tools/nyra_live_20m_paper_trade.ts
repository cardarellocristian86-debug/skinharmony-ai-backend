import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runFinancialMicrostructureBranch, type FinancialMicrostructureSnapshot } from "../packages/branches/financial/src/index.ts";
import { evaluateFinancialLivePolicy, loadFinancialLearningPackSafe } from "./nyra-financial-live-policy.ts";

type Candidate = {
  product: string;
  decision: ReturnType<typeof runFinancialMicrostructureBranch>;
  signed_score: number;
  strength_score: number;
  adjusted_score: number;
  size_multiplier: number;
  learning_notes: string[];
  entry_bid: number;
  entry_ask: number;
  entry_last: number;
  entry_timestamp: string;
  snapshots: FinancialMicrostructureSnapshot[];
};

type TradeSide = "LONG" | "SHORT";

type MonitorPoint = {
  timestamp: string;
  price_bid: number;
  price_ask: number;
  price_last: number;
  unrealized_pnl_eur: number;
  unrealized_pnl_pct: number;
  core_state: string;
  risk_score: number;
  financial_action: string;
  microstructure_scenario: string;
  trailing_stop_pct?: number;
};

type TradeRiskConfig = {
  stop_loss_pct: number;
  take_profit_pct: number;
  trailing_stop_pct: number;
};

type SingleRunReport = {
  generated_at: string;
  runner: "nyra_live_20m_paper_trade";
  mode: "god_mode_only";
  source: "Coinbase Exchange public API";
  offline_only: false;
  web_enabled: true;
  run_index: number;
  capital_eur: number;
  fee_bps_each_side: number;
  duration_seconds: number;
  risk_config: TradeRiskConfig;
  scan_products: string[];
  selection: {
    product: string;
    signed_score: number;
    strength_score: number;
    adjusted_score: number;
    size_multiplier: number;
    learning_notes: string[];
    core_state: string;
    risk_score: number;
    financial_action: string;
    microstructure_scenario: string;
    entry_timestamp: string;
    entry_price_bid: number;
    entry_price_ask: number;
    entry_price_last: number;
  };
  trade: {
    side: TradeSide;
    units: number;
    invested_eur_gross: number;
    invested_eur_net: number;
    exit_timestamp: string;
    exit_price_bid: number;
    exit_price_ask: number;
    exit_price_last: number;
    proceeds_eur_gross: number;
    proceeds_eur_net: number;
    pnl_eur: number;
    pnl_pct: number;
    profitable: boolean;
    exit_reason: string;
  };
  monitoring: MonitorPoint[];
  summary: {
    monitor_samples: number;
    best_unrealized_eur: number;
    worst_unrealized_eur: number;
    profitable: boolean;
  };
};

type MultiRunReport = {
  generated_at: string;
  runner: "nyra_live_20m_paper_trade";
  mode: "god_mode_only";
  source: "Coinbase Exchange public API";
  offline_only: false;
  web_enabled: true;
  runs: number;
  capital_eur: number;
  fee_bps_each_side: number;
  duration_seconds: number;
  risk_config: TradeRiskConfig;
  scan_products: string[];
  aggregate: {
    completed_runs: number;
    profitable_runs: number;
    flat_runs: number;
    losing_runs: number;
    total_pnl_eur: number;
    avg_pnl_eur: number;
    avg_pnl_pct: number;
    profit_factor: number | null;
  };
  run_reports: SingleRunReport[];
};

const REPORT_DIR = join(process.cwd(), "reports", "universal-core", "financial-core-test");
const REPORT_PATH = join(REPORT_DIR, "nyra_live_20m_paper_trade_latest.json");

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function curlJson(url: string): unknown {
  const raw = execFileSync("/usr/bin/curl", ["-s", url], { encoding: "utf8" });
  return JSON.parse(raw);
}

function fetchSnapshot(product: string): FinancialMicrostructureSnapshot {
  const book = curlJson(`https://api.exchange.coinbase.com/products/${product}/book?level=2`) as {
    bids?: [string, string, string?][];
    asks?: [string, string, string?][];
    time?: string;
  };
  const trades = curlJson(`https://api.exchange.coinbase.com/products/${product}/trades?limit=8`) as Array<{
    side?: "buy" | "sell";
    size?: string;
    price?: string;
    time?: string;
  }>;
  const bid = book.bids?.[0] ?? ["0", "0"];
  const ask = book.asks?.[0] ?? ["0", "0"];
  const bidDepthLevels = (book.bids ?? []).slice(0, 5);
  const askDepthLevels = (book.asks ?? []).slice(0, 5);
  const bidDepth5 = bidDepthLevels.reduce((sum, level) => sum + Number(level[1] ?? 0), 0);
  const askDepth5 = askDepthLevels.reduce((sum, level) => sum + Number(level[1] ?? 0), 0);
  const bidNotional5 = bidDepthLevels.reduce((sum, level) => sum + Number(level[0] ?? 0) * Number(level[1] ?? 0), 0);
  const askNotional5 = askDepthLevels.reduce((sum, level) => sum + Number(level[0] ?? 0) * Number(level[1] ?? 0), 0);
  const buyTrades = trades.filter((trade) => trade.side === "buy");
  const sellTrades = trades.filter((trade) => trade.side === "sell");
  const buySize = buyTrades.reduce((sum, trade) => sum + Number(trade.size ?? 0), 0);
  const sellSize = sellTrades.reduce((sum, trade) => sum + Number(trade.size ?? 0), 0);
  const lastPrice = trades.length ? Number(trades[0].price ?? 0) : (Number(bid[0]) + Number(ask[0])) / 2;

  return {
    timestamp: book.time ?? trades[0]?.time ?? new Date().toISOString(),
    product,
    bid_price: Number(bid[0]),
    bid_size: Number(bid[1]),
    ask_price: Number(ask[0]),
    ask_size: Number(ask[1]),
    bid_depth_5: round(bidDepth5),
    ask_depth_5: round(askDepth5),
    bid_notional_5: round(bidNotional5),
    ask_notional_5: round(askNotional5),
    last_price: lastPrice,
    buy_trade_count: buyTrades.length,
    sell_trade_count: sellTrades.length,
    buy_trade_size: round(buySize),
    sell_trade_size: round(sellSize),
  };
}

async function collectWindow(product: string, samples = 5, pauseMs = 2500): Promise<FinancialMicrostructureSnapshot[]> {
  const rows: FinancialMicrostructureSnapshot[] = [];
  for (let index = 0; index < samples; index += 1) {
    rows.push(fetchSnapshot(product));
    if (index < samples - 1) await sleep(pauseMs);
  }
  return rows;
}

function candidateFromSnapshots(
  product: string,
  snapshots: FinancialMicrostructureSnapshot[],
  learningPack: ReturnType<typeof loadFinancialLearningPackSafe>,
): Candidate | null {
  const decision = runFinancialMicrostructureBranch(snapshots, snapshots.length - 1);
  const last = snapshots[snapshots.length - 1];
  const scenarioBias =
    decision.microstructure_scenario === "continuation_burst"
      ? 12
      : decision.microstructure_scenario === "absorption"
        ? 8
        : decision.microstructure_scenario === "exhaustion_reversal"
          ? -12
          : decision.microstructure_scenario === "fake_breakout"
            ? decision.microstructure_signals.momentum >= 0 ? -9 : -6
            : 0;

  const rawSignedScore =
    decision.microstructure_signals.momentum * 100 +
    decision.microstructure_signals.trade_flow_imbalance * 38 +
    decision.microstructure_signals.order_book_imbalance * 24 +
    decision.microstructure_signals.depth_imbalance * 18 -
    decision.microstructure_signals.spread_bps * 2.4 -
    decision.microstructure_signals.breakout_failure_risk * 26 -
    Math.max(0, decision.microstructure_signals.flow_decay) * 14 +
    decision.microstructure_signals.long_setup_score * 22 -
    decision.microstructure_signals.reversal_setup_score * 18 +
    decision.microstructure_signals.horizon_alignment * 16 +
    scenarioBias;
  const signedScore = decision.financial_action === "BUY"
    ? Math.abs(rawSignedScore)
    : decision.financial_action === "SELL"
      ? -Math.abs(rawSignedScore)
      : rawSignedScore;

  const livePolicy = evaluateFinancialLivePolicy(product, decision, signedScore, learningPack);
  if (livePolicy.blocked) return null;

  return {
    product,
    decision,
    signed_score: round(signedScore),
    strength_score: round(Math.abs(signedScore)),
    adjusted_score: livePolicy.adjusted_score,
    size_multiplier: livePolicy.size_multiplier,
    learning_notes: livePolicy.notes,
    entry_bid: last.bid_price,
    entry_ask: last.ask_price,
    entry_last: last.last_price,
    entry_timestamp: last.timestamp,
    snapshots,
  };
}

function selectTradeCandidate(candidates: Candidate[]): { side: TradeSide; candidate: Candidate } | null {
  const positive = candidates
    .filter((entry) => entry.adjusted_score > 0 && entry.decision.risk.score < 75 && entry.decision.financial_action === "BUY")
    .sort((a, b) => b.adjusted_score - a.adjusted_score);
  if (positive[0]) return { side: "LONG", candidate: positive[0] };

  const shorts = candidates
    .filter((entry) => entry.decision.risk.score < 75 && entry.decision.financial_action === "SELL")
    .sort((a, b) => Math.abs(b.adjusted_score) - Math.abs(a.adjusted_score));
  if (shorts[0]) return { side: "SHORT", candidate: shorts[0] };
  return null;
}

function parseArg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });

  const durationSeconds = Number(parseArg("--duration-sec", "1200"));
  const runs = Number(parseArg("--runs", "1"));
  const capitalEur = Number(parseArg("--capital-eur", "1000"));
  const feeBpsEachSide = Number(parseArg("--fee-bps", "0"));
  const riskConfig: TradeRiskConfig = {
    stop_loss_pct: Number(parseArg("--stop-loss-pct", "0.35")),
    take_profit_pct: Number(parseArg("--take-profit-pct", "0.2")),
    trailing_stop_pct: Number(parseArg("--trailing-stop-pct", "0.12")),
  };
  const scanProducts = parseArg(
    "--products",
    "BTC-EUR,ETH-EUR,SOL-EUR,XRP-EUR,ADA-EUR,DOGE-EUR,LINK-EUR,AVAX-EUR,LTC-EUR,BCH-EUR",
  )
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  const runReports: SingleRunReport[] = [];
  const pollMs = 20_000;
  const learningPack = loadFinancialLearningPackSafe();

  for (let runIndex = 0; runIndex < runs; runIndex += 1) {
    const candidates: Candidate[] = [];
    for (const product of scanProducts) {
      const snapshots = await collectWindow(product);
      const candidate = candidateFromSnapshots(product, snapshots, learningPack);
      if (candidate) candidates.push(candidate);
    }

    const selectedTrade = selectTradeCandidate(candidates);
    if (!selectedTrade) {
      continue;
    }
    const { side, candidate: selected } = selectedTrade;
    const entryFeeMultiplier = 1 - feeBpsEachSide / 10_000;
    const exitFeeMultiplier = 1 - feeBpsEachSide / 10_000;
    const investedGross = capitalEur * selected.size_multiplier;
    const investedNet = investedGross * entryFeeMultiplier;
    const units = investedNet / (side === "LONG" ? selected.entry_ask : selected.entry_bid);
    const monitoring: MonitorPoint[] = [];
    const startMs = Date.now();
    let exitReason = "time_expired";
    let exitSnapshot = selected.snapshots[selected.snapshots.length - 1];
    let bestPnlPct = Number.NEGATIVE_INFINITY;
    let trailingFloorPct = Number.NEGATIVE_INFINITY;

    while (Date.now() - startMs < durationSeconds * 1000) {
      await sleep(pollMs);
      const snapshots = await collectWindow(selected.product, 3, 2000);
      const decision = runFinancialMicrostructureBranch(snapshots, snapshots.length - 1);
      const last = snapshots[snapshots.length - 1];
      const proceedsGross = side === "LONG" ? units * last.bid_price : units * selected.entry_bid;
      const proceedsNet = proceedsGross * exitFeeMultiplier;
      const coverCostGross = side === "SHORT" ? units * last.ask_price : 0;
      const coverCostNet = side === "SHORT" ? coverCostGross : 0;
      const pnlEur = side === "LONG" ? proceedsNet - investedGross : investedGross - coverCostNet;
      const pnlPct = investedGross ? (pnlEur / investedGross) * 100 : 0;

      bestPnlPct = Math.max(bestPnlPct, pnlPct);
      trailingFloorPct =
        bestPnlPct > 0
          ? Math.max(trailingFloorPct, bestPnlPct - riskConfig.trailing_stop_pct)
          : trailingFloorPct;

      monitoring.push({
        timestamp: last.timestamp,
        price_bid: last.bid_price,
        price_ask: last.ask_price,
        price_last: last.last_price,
        unrealized_pnl_eur: round(pnlEur, 6),
        unrealized_pnl_pct: round(pnlPct, 6),
        core_state: decision.core_state,
        risk_score: round(decision.risk.score, 6),
        financial_action: decision.financial_action,
        microstructure_scenario: decision.microstructure_scenario,
        trailing_stop_pct: Number.isFinite(trailingFloorPct) ? round(trailingFloorPct, 6) : undefined,
      });

      exitSnapshot = last;

      if (pnlPct <= -riskConfig.stop_loss_pct) {
        exitReason = "stop_loss";
        break;
      }
      if (pnlPct >= riskConfig.take_profit_pct) {
        exitReason = "take_profit";
        break;
      }
      if (Number.isFinite(trailingFloorPct) && pnlPct <= trailingFloorPct) {
        exitReason = "trailing_stop";
        break;
      }

      if (side === "LONG") {
        if (decision.financial_action === "SELL" || decision.microstructure_scenario === "exhaustion_reversal") {
          exitReason = `${decision.financial_action.toLowerCase()}_${decision.microstructure_scenario}`;
          break;
        }
      } else {
        if (decision.financial_action === "BUY" || decision.microstructure_scenario === "continuation_burst") {
          exitReason = `${decision.financial_action.toLowerCase()}_${decision.microstructure_scenario}`;
          break;
        }
      }
    }

    const proceedsGross = side === "LONG" ? units * exitSnapshot.bid_price : units * selected.entry_bid;
    const proceedsNet = proceedsGross * exitFeeMultiplier;
    const coverCostGross = side === "SHORT" ? units * exitSnapshot.ask_price : 0;
    const coverCostNet = side === "SHORT" ? coverCostGross : 0;
    const pnlEur = side === "LONG" ? proceedsNet - investedGross : investedGross - coverCostNet;
    const pnlPct = investedGross ? (pnlEur / investedGross) * 100 : 0;

    runReports.push({
      generated_at: new Date().toISOString(),
      runner: "nyra_live_20m_paper_trade",
      mode: "god_mode_only",
      source: "Coinbase Exchange public API",
      offline_only: false,
      web_enabled: true,
      run_index: runIndex + 1,
      capital_eur: capitalEur,
      fee_bps_each_side: feeBpsEachSide,
      duration_seconds: durationSeconds,
      risk_config: riskConfig,
      scan_products: scanProducts,
        selection: {
          product: selected.product,
          signed_score: selected.signed_score,
          strength_score: selected.strength_score,
          adjusted_score: selected.adjusted_score,
          size_multiplier: selected.size_multiplier,
          learning_notes: selected.learning_notes,
          core_state: selected.decision.core_state,
          risk_score: round(selected.decision.risk.score, 6),
          financial_action: selected.decision.financial_action,
        microstructure_scenario: selected.decision.microstructure_scenario,
        entry_timestamp: selected.entry_timestamp,
        entry_price_bid: selected.entry_bid,
        entry_price_ask: selected.entry_ask,
        entry_price_last: selected.entry_last,
      },
      trade: {
        side,
        units: round(units, 10),
        invested_eur_gross: round(investedGross, 6),
        invested_eur_net: round(investedNet, 6),
        exit_timestamp: exitSnapshot.timestamp,
        exit_price_bid: exitSnapshot.bid_price,
        exit_price_ask: exitSnapshot.ask_price,
        exit_price_last: exitSnapshot.last_price,
        proceeds_eur_gross: round(proceedsGross, 6),
        proceeds_eur_net: round(proceedsNet, 6),
        pnl_eur: round(pnlEur, 6),
        pnl_pct: round(pnlPct, 6),
        profitable: pnlEur > 0,
        exit_reason: exitReason,
      },
      monitoring,
      summary: {
        monitor_samples: monitoring.length,
        best_unrealized_eur: monitoring.length ? round(Math.max(...monitoring.map((point) => point.unrealized_pnl_eur)), 6) : round(pnlEur, 6),
        worst_unrealized_eur: monitoring.length ? round(Math.min(...monitoring.map((point) => point.unrealized_pnl_eur)), 6) : round(pnlEur, 6),
        profitable: pnlEur > 0,
      },
    });
  }

  const totalPnl = round(runReports.reduce((sum, report) => sum + report.trade.pnl_eur, 0), 6);
  const gains = runReports.filter((report) => report.trade.pnl_eur > 0).reduce((sum, report) => sum + report.trade.pnl_eur, 0);
  const losses = Math.abs(runReports.filter((report) => report.trade.pnl_eur < 0).reduce((sum, report) => sum + report.trade.pnl_eur, 0));

  const finalReport: MultiRunReport = {
    generated_at: new Date().toISOString(),
    runner: "nyra_live_20m_paper_trade",
    mode: "god_mode_only",
    source: "Coinbase Exchange public API",
    offline_only: false,
    web_enabled: true,
    runs,
    capital_eur: capitalEur,
    fee_bps_each_side: feeBpsEachSide,
    duration_seconds: durationSeconds,
    risk_config: riskConfig,
    scan_products: scanProducts,
    aggregate: {
      completed_runs: runReports.length,
      profitable_runs: runReports.filter((report) => report.trade.pnl_eur > 0).length,
      flat_runs: runReports.filter((report) => report.trade.pnl_eur === 0).length,
      losing_runs: runReports.filter((report) => report.trade.pnl_eur < 0).length,
      total_pnl_eur: totalPnl,
      avg_pnl_eur: runReports.length ? round(totalPnl / runReports.length, 6) : 0,
      avg_pnl_pct: runReports.length ? round(runReports.reduce((sum, report) => sum + report.trade.pnl_pct, 0) / runReports.length, 6) : 0,
      profit_factor: losses > 0 ? round(gains / losses, 6) : gains > 0 ? null : 0,
    },
    run_reports: runReports,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(finalReport, null, 2));
  console.log(JSON.stringify(finalReport, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

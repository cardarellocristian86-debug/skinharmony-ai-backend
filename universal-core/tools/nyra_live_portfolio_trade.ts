import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runFinancialMicrostructureBranch, type FinancialMicrostructureSnapshot } from "../packages/branches/financial/src/index.ts";
import { evaluateFinancialLivePolicy, isFinancialRecoveryMicroModeActive, loadFinancialLearningPackSafe } from "./nyra-financial-live-policy.ts";
import { evaluateFinancialMultiverseThesis, type FinancialMultiverseThesis } from "./nyra-financial-multiverse-thesis.ts";

type TradeSide = "LONG" | "SHORT";

type Candidate = {
  product: string;
  side: TradeSide;
  signed_score: number;
  strength_score: number;
  adjusted_score: number;
  size_multiplier: number;
  learning_notes: string[];
  multiverse_thesis: FinancialMultiverseThesis;
  decision: ReturnType<typeof runFinancialMicrostructureBranch>;
  entry_snapshot: FinancialMicrostructureSnapshot;
};

type CandidateDiagnostic = {
  product: string;
  status: "selected" | "watch" | "blocked" | "no_trade";
  side: TradeSide | "NONE";
  signed_score: number;
  adjusted_score: number;
  min_strength_required: number;
  size_multiplier: number;
  core_state: string;
  risk_score: number;
  financial_action: string;
  microstructure_scenario: string;
  last_price: number;
  bid_price: number;
  ask_price: number;
  spread_bps: number;
  multiverse_thesis?: FinancialMultiverseThesis;
  notes: string[];
};

type Position = {
  product: string;
  side: TradeSide;
  weight_pct: number;
  capital_gross_eur: number;
  capital_net_eur: number;
  units: number;
  entry_timestamp: string;
  entry_bid: number;
  entry_ask: number;
  entry_last: number;
  signed_score: number;
  strength_score: number;
  adjusted_score: number;
  size_multiplier: number;
  learning_notes: string[];
  multiverse_thesis: FinancialMultiverseThesis;
  core_state: string;
  risk_score: number;
  financial_action: string;
  microstructure_scenario: string;
};

type PositionExit = {
  product: string;
  side: TradeSide;
  weight_pct: number;
  entry_timestamp: string;
  exit_timestamp: string;
  entry_price: number;
  exit_price: number;
  pnl_eur: number;
  pnl_pct: number;
  profitable: boolean;
  exit_reason: string;
  thesis_hold_suggested: boolean;
  multiverse_thesis?: FinancialMultiverseThesis;
};

type PositionMonitor = {
  product: string;
  side: TradeSide;
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
  multiverse_thesis?: FinancialMultiverseThesis;
};

type SelectorProfile =
  | "capital_protection"
  | "balanced_growth"
  | "aggressive_growth"
  | "hard_growth"
  | "overdrive_5_auto_only"
  | "overdrive_6_auto_only"
  | "overdrive_7_auto_only";

type PortfolioReport = {
  generated_at: string;
  runner: "nyra_live_portfolio_trade";
  mode: "god_mode_only";
  source: "Coinbase Exchange public API";
  offline_only: false;
  web_enabled: true;
  selector_mode: "auto" | "manual";
  selector_profile: SelectorProfile;
  selector_risk_cap: number;
  capital_eur: number;
  fee_bps_each_side: number;
  duration_seconds: number;
  portfolio_size: number;
  scan_products: string[];
  portfolio: Position[];
  candidate_diagnostics: CandidateDiagnostic[];
  exits: PositionExit[];
  monitoring: PositionMonitor[];
  aggregate: {
    selected_positions: number;
    long_positions: number;
    short_positions: number;
    profitable_positions: number;
    losing_positions: number;
    flat_positions: number;
    total_pnl_eur: number;
    avg_pnl_eur: number;
    avg_pnl_pct: number;
    action_score_mismatch_count: number;
    action_score_mismatch_rate: number;
    debug_no_live: boolean;
  };
};

const REPORT_DIR = join(process.cwd(), "reports", "universal-core", "financial-core-test");
const REPORT_PATH = join(REPORT_DIR, "nyra_live_portfolio_trade_latest.json");

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
  selectorProfile: SelectorProfile,
): { candidate: Candidate | null; diagnostic: CandidateDiagnostic } {
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
  const actionScoreMismatch =
    (decision.financial_action === "BUY" && rawSignedScore < 0) ||
    (decision.financial_action === "SELL" && rawSignedScore > 0);
  const signedScore = decision.financial_action === "BUY"
    ? Math.abs(rawSignedScore)
    : decision.financial_action === "SELL"
      ? -Math.abs(rawSignedScore)
      : rawSignedScore;

  const recoveryMicroMode = isFinancialRecoveryMicroModeActive();
  const fallbackSide: TradeSide | null = signedScore >= 95 ? "LONG" : signedScore <= -95 ? "SHORT" : null;
  const fallbackAction = fallbackSide === "LONG" ? "BUY" : fallbackSide === "SHORT" ? "SELL" : null;
  const fallbackAllowed =
    recoveryMicroMode &&
    fallbackAction &&
    decision.financial_action === "HOLD" &&
    decision.microstructure_signals.spread_bps <= 4 &&
    decision.risk.score <= 72;

  if (decision.financial_action !== "BUY" && decision.financial_action !== "SELL" && !fallbackAllowed) {
    return {
      candidate: null,
      diagnostic: {
        product,
        status: "no_trade",
        side: "NONE",
        signed_score: round(signedScore),
        adjusted_score: round(signedScore),
        min_strength_required: 0,
        size_multiplier: 0,
        core_state: decision.core_state,
        risk_score: round(decision.risk.score, 6),
        financial_action: decision.financial_action,
        microstructure_scenario: decision.microstructure_scenario,
        last_price: last.last_price,
        bid_price: last.bid_price,
        ask_price: last.ask_price,
        spread_bps: round(decision.microstructure_signals.spread_bps, 6),
        notes: ["no_trade_signal"]
      }
    };
  }
  const tradableDecision = fallbackAllowed
    ? { ...decision, financial_action: fallbackAction as string }
    : decision;
  const livePolicy = evaluateFinancialLivePolicy(product, tradableDecision, signedScore, learningPack);
  if (actionScoreMismatch) livePolicy.notes.push("action_score_mismatch_corrected");
  const runtimeOverlay = selectorRuntimeOverlay(selectorProfile, livePolicy, decision.risk.score);
  if (fallbackAllowed) {
    runtimeOverlay.notes.push("recovery_micro_hold_override");
    runtimeOverlay.size_multiplier = round(runtimeOverlay.size_multiplier * 0.55, 6);
  }
  const side: TradeSide = tradableDecision.financial_action === "BUY" ? "LONG" : "SHORT";
  const multiverseThesis = evaluateFinancialMultiverseThesis(product, side, signedScore, tradableDecision, snapshots);
  if (multiverseThesis.thesis_valid) {
    runtimeOverlay.notes.push(`multiverse_${multiverseThesis.thesis_action}`);
    runtimeOverlay.adjusted_score = round(runtimeOverlay.adjusted_score + multiverseThesis.expected_value_score * 0.18);
    if (multiverseThesis.thesis_action === "hold_thesis") {
      runtimeOverlay.size_multiplier = round(runtimeOverlay.size_multiplier * 1.08, 6);
      runtimeOverlay.notes.push("core_thesis_patience");
    }
    if (
      runtimeOverlay.blocked &&
      multiverseThesis.core_risk_score < 70 &&
      multiverseThesis.adverse_risk < 68 &&
      Math.abs(runtimeOverlay.adjusted_score) >= runtimeOverlay.min_strength_required * 0.85
    ) {
      runtimeOverlay.blocked = false;
      runtimeOverlay.size_multiplier = round(Math.max(0.05, runtimeOverlay.size_multiplier * 0.42), 6);
      runtimeOverlay.notes.push("multiverse_micro_unblock");
    }
  } else if (multiverseThesis.thesis_action === "avoid") {
    runtimeOverlay.adjusted_score = round(runtimeOverlay.adjusted_score - 10);
    runtimeOverlay.size_multiplier = round(runtimeOverlay.size_multiplier * 0.75, 6);
    runtimeOverlay.notes.push("multiverse_thesis_weak");
  } else {
    runtimeOverlay.notes.push("multiverse_watch_only");
  }
  const diagnostic: CandidateDiagnostic = {
    product,
    status: runtimeOverlay.blocked ? "blocked" : "watch",
    side,
    signed_score: round(signedScore),
    adjusted_score: runtimeOverlay.adjusted_score,
    min_strength_required: runtimeOverlay.min_strength_required,
    size_multiplier: runtimeOverlay.size_multiplier,
    core_state: decision.core_state,
    risk_score: round(decision.risk.score, 6),
    financial_action: tradableDecision.financial_action,
    microstructure_scenario: decision.microstructure_scenario,
    last_price: last.last_price,
    bid_price: last.bid_price,
    ask_price: last.ask_price,
    spread_bps: round(decision.microstructure_signals.spread_bps, 6),
    multiverse_thesis: multiverseThesis,
    notes: runtimeOverlay.notes
  };
  if (runtimeOverlay.blocked) {
    return { candidate: null, diagnostic };
  }

  return {
    candidate: {
      product,
      side,
      signed_score: round(signedScore),
      strength_score: round(Math.abs(signedScore)),
      adjusted_score: runtimeOverlay.adjusted_score,
      size_multiplier: runtimeOverlay.size_multiplier,
      learning_notes: runtimeOverlay.notes,
      multiverse_thesis: multiverseThesis,
      decision: tradableDecision,
      entry_snapshot: last,
    },
    diagnostic
  };
}

function selectorRuntimeOverlay(
  selectorProfile: SelectorProfile,
  livePolicy: ReturnType<typeof evaluateFinancialLivePolicy>,
  riskScore: number,
): ReturnType<typeof evaluateFinancialLivePolicy> {
  const policy = {
    ...livePolicy,
    notes: [...livePolicy.notes, `selector_${selectorProfile}`],
  };

  switch (selectorProfile) {
    case "capital_protection":
      policy.adjusted_score = round(policy.adjusted_score - 8);
      policy.min_strength_required += 8;
      policy.size_multiplier = round(policy.size_multiplier * 0.45, 6);
      if (riskScore >= 52 && !policy.notes.includes("recovery_micro_trade_allowed")) policy.blocked = true;
      if (riskScore >= 52 && policy.notes.includes("recovery_micro_trade_allowed")) {
        policy.size_multiplier = round(policy.size_multiplier * 0.55, 6);
        policy.notes.push("selector_capital_protection_micro_budget");
      }
      break;
    case "balanced_growth":
      policy.adjusted_score = round(policy.adjusted_score - 4);
      policy.min_strength_required += 4;
      policy.size_multiplier = round(policy.size_multiplier * 0.7, 6);
      if (riskScore >= 60) policy.blocked = true;
      break;
    case "aggressive_growth":
      policy.adjusted_score = round(policy.adjusted_score + 1);
      policy.min_strength_required += 1;
      policy.size_multiplier = round(policy.size_multiplier * 0.92, 6);
      break;
    case "hard_growth":
      policy.adjusted_score = round(policy.adjusted_score + 4);
      policy.min_strength_required = Math.max(6, policy.min_strength_required - 1);
      policy.size_multiplier = round(policy.size_multiplier * 1.08, 6);
      break;
    case "overdrive_5_auto_only":
      policy.adjusted_score = round(policy.adjusted_score + 7);
      policy.min_strength_required = Math.max(5, policy.min_strength_required - 2);
      policy.size_multiplier = round(policy.size_multiplier * 1.16, 6);
      break;
    case "overdrive_6_auto_only":
      policy.adjusted_score = round(policy.adjusted_score + 10);
      policy.min_strength_required = Math.max(4, policy.min_strength_required - 3);
      policy.size_multiplier = round(policy.size_multiplier * 1.22, 6);
      break;
    case "overdrive_7_auto_only":
      policy.adjusted_score = round(policy.adjusted_score + 13);
      policy.min_strength_required = Math.max(3, policy.min_strength_required - 4);
      policy.size_multiplier = round(policy.size_multiplier * 1.3, 6);
      break;
  }

  policy.blocked =
    policy.blocked ||
    policy.size_multiplier <= 0 ||
    Math.abs(policy.adjusted_score) < policy.min_strength_required;
  return policy;
}

function parseArg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function buildPosition(candidate: Candidate, weightPct: number, capitalEur: number, feeBpsEachSide: number): Position {
  const gross = capitalEur * weightPct;
  const net = gross * (1 - feeBpsEachSide / 10_000);
  const units = net / (candidate.side === "LONG" ? candidate.entry_snapshot.ask_price : candidate.entry_snapshot.bid_price);
  return {
    product: candidate.product,
    side: candidate.side,
    weight_pct: round(weightPct * 100, 4),
    capital_gross_eur: round(gross, 6),
    capital_net_eur: round(net, 6),
    units: round(units, 10),
    entry_timestamp: candidate.entry_snapshot.timestamp,
    entry_bid: candidate.entry_snapshot.bid_price,
    entry_ask: candidate.entry_snapshot.ask_price,
    entry_last: candidate.entry_snapshot.last_price,
    signed_score: candidate.signed_score,
    strength_score: candidate.strength_score,
    adjusted_score: candidate.adjusted_score,
    size_multiplier: candidate.size_multiplier,
    learning_notes: candidate.learning_notes,
    multiverse_thesis: candidate.multiverse_thesis,
    core_state: candidate.decision.core_state,
    risk_score: round(candidate.decision.risk.score, 6),
    financial_action: candidate.decision.financial_action,
    microstructure_scenario: candidate.decision.microstructure_scenario,
  };
}

function computePnl(position: Position, snapshot: FinancialMicrostructureSnapshot, feeBpsEachSide: number) {
  const exitFeeMultiplier = 1 - feeBpsEachSide / 10_000;
  if (position.side === "LONG") {
    const proceedsGross = position.units * snapshot.bid_price;
    const proceedsNet = proceedsGross * exitFeeMultiplier;
    const pnlEur = proceedsNet - position.capital_gross_eur;
    const pnlPct = position.capital_gross_eur ? (pnlEur / position.capital_gross_eur) * 100 : 0;
    return {
      exitPrice: snapshot.bid_price,
      pnlEur: round(pnlEur, 6),
      pnlPct: round(pnlPct, 6),
    };
  }
  const proceedsGross = position.capital_net_eur;
  const coverCostGross = position.units * snapshot.ask_price;
  const coverCostNet = coverCostGross;
  const pnlEur = proceedsGross - coverCostNet;
  const pnlPct = position.capital_gross_eur ? (pnlEur / position.capital_gross_eur) * 100 : 0;
  return {
    exitPrice: snapshot.ask_price,
    pnlEur: round(pnlEur, 6),
    pnlPct: round(pnlPct, 6),
  };
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });

  const durationSeconds = Number(parseArg("--duration-sec", "300"));
  const capitalEur = Number(parseArg("--capital-eur", "1000"));
  const feeBpsEachSide = Number(parseArg("--fee-bps", "60"));
  const portfolioSize = Number(parseArg("--portfolio-size", "10"));
  const selectorMode = parseArg("--selector-mode", "auto") === "manual" ? "manual" : "auto";
  const selectorProfile = (parseArg("--selector-profile", "capital_protection") || "capital_protection") as SelectorProfile;
  const selectorRiskCap = Number(parseArg("--selector-risk-cap", "1"));
  const scanProducts = parseArg(
    "--products",
    "BTC-EUR,ETH-EUR,SOL-EUR,XRP-EUR,ADA-EUR,DOGE-EUR,LINK-EUR,AVAX-EUR,LTC-EUR,BCH-EUR",
  )
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const learningPack = loadFinancialLearningPackSafe();

  const candidates: Candidate[] = [];
  const candidateDiagnostics: CandidateDiagnostic[] = [];
  for (const product of scanProducts) {
    const snapshots = await collectWindow(product);
    const { candidate, diagnostic } = candidateFromSnapshots(product, snapshots, learningPack, selectorProfile);
    if (candidate) candidates.push(candidate);
    candidateDiagnostics.push(diagnostic);
  }
  const preliminaryMismatchCount = candidateDiagnostics.filter((item) => item.notes.includes("action_score_mismatch_corrected")).length;
  const preliminaryMismatchRate = candidateDiagnostics.length ? preliminaryMismatchCount / candidateDiagnostics.length : 0;
  const debugNoLive = preliminaryMismatchRate > 0.5;

  const profilePositionCap = selectorProfile === "capital_protection"
    ? 1
    : selectorProfile === "balanced_growth"
      ? 2
      : selectorProfile === "aggressive_growth"
        ? 3
        : 4;
  const selectedCandidates = (debugNoLive ? [] : [...candidates])
    .sort((a, b) => Math.abs(b.adjusted_score) - Math.abs(a.adjusted_score))
    .filter((candidate, index) => {
      if (index === 0) return true;
      return Math.abs(candidate.adjusted_score) >= (selectorProfile === "capital_protection" ? 28 : selectorProfile === "balanced_growth" ? 24 : 20);
    })
    .slice(0, Math.min(portfolioSize, profilePositionCap, Math.min(candidates.length, 4)));

  const totalStrength = selectedCandidates.reduce((sum, candidate) => sum + Math.abs(candidate.adjusted_score) * candidate.size_multiplier, 0) || 1;
  const totalRiskCap = Math.min(Math.max(selectorRiskCap, 0), 1);
  const portfolio = selectedCandidates.map((candidate) =>
    buildPosition(
      candidate,
      Math.min(
        ((Math.abs(candidate.adjusted_score) * candidate.size_multiplier) / totalStrength) * totalRiskCap,
        totalRiskCap * Math.min(1, Math.max(0.003, candidate.size_multiplier))
      ),
      capitalEur,
      feeBpsEachSide,
    ),
  );
  const selectedKeys = new Set(selectedCandidates.map((candidate) => candidate.product));
  const diagnostics = candidateDiagnostics
    .map((item) => (selectedKeys.has(item.product) ? { ...item, status: "selected" as const } : item))
    .sort((a, b) => Math.abs(b.adjusted_score) - Math.abs(a.adjusted_score));
  const mismatchCount = diagnostics.filter((item) => item.notes.includes("action_score_mismatch_corrected")).length;

  const monitoring: PositionMonitor[] = [];
  const startMs = Date.now();
  const pollMs = 20_000;
  while (Date.now() - startMs < durationSeconds * 1000) {
    await sleep(pollMs);
    for (const position of portfolio) {
      const snapshots = await collectWindow(position.product, 3, 1500);
      const decision = runFinancialMicrostructureBranch(snapshots, snapshots.length - 1);
      const last = snapshots[snapshots.length - 1];
      const pnl = computePnl(position, last, feeBpsEachSide);
      const thesis = evaluateFinancialMultiverseThesis(position.product, position.side, position.signed_score, decision, snapshots);
      monitoring.push({
        product: position.product,
        side: position.side,
        timestamp: last.timestamp,
        price_bid: last.bid_price,
        price_ask: last.ask_price,
        price_last: last.last_price,
        unrealized_pnl_eur: pnl.pnlEur,
        unrealized_pnl_pct: pnl.pnlPct,
        core_state: decision.core_state,
        risk_score: round(decision.risk.score, 6),
        financial_action: decision.financial_action,
        microstructure_scenario: decision.microstructure_scenario,
        multiverse_thesis: thesis,
      });
    }
  }

  const exits: PositionExit[] = [];
  for (const position of portfolio) {
    const finalSnapshots = await collectWindow(position.product, 3, 1500);
    const finalSnapshot = finalSnapshots[finalSnapshots.length - 1];
    const finalDecision = runFinancialMicrostructureBranch(finalSnapshots, finalSnapshots.length - 1);
    const finalThesis = evaluateFinancialMultiverseThesis(position.product, position.side, position.signed_score, finalDecision, finalSnapshots);
    const pnl = computePnl(position, finalSnapshot, feeBpsEachSide);
    const thesisHoldSuggested = pnl.pnlEur < 0 && finalThesis.thesis_valid && finalThesis.thesis_action === "hold_thesis";
    exits.push({
      product: position.product,
      side: position.side,
      weight_pct: position.weight_pct,
      entry_timestamp: position.entry_timestamp,
      exit_timestamp: finalSnapshot.timestamp,
      entry_price: position.side === "LONG" ? position.entry_ask : position.entry_bid,
      exit_price: pnl.exitPrice,
      pnl_eur: pnl.pnlEur,
      pnl_pct: pnl.pnlPct,
      profitable: pnl.pnlEur > 0,
      exit_reason: thesisHoldSuggested ? "time_expired_test_close_but_thesis_valid_hold_in_production" : "time_expired_portfolio_close",
      thesis_hold_suggested: thesisHoldSuggested,
      multiverse_thesis: finalThesis,
    });
  }

  const totalPnl = round(exits.reduce((sum, exit) => sum + exit.pnl_eur, 0), 6);
  const report: PortfolioReport = {
    generated_at: new Date().toISOString(),
    runner: "nyra_live_portfolio_trade",
    mode: "god_mode_only",
    source: "Coinbase Exchange public API",
    offline_only: false,
    web_enabled: true,
    selector_mode: selectorMode,
    selector_profile: selectorProfile,
    selector_risk_cap: round(selectorRiskCap, 6),
    capital_eur: capitalEur,
    fee_bps_each_side: feeBpsEachSide,
    duration_seconds: durationSeconds,
    portfolio_size: portfolioSize,
    scan_products: scanProducts,
    portfolio,
    candidate_diagnostics: diagnostics,
    exits,
    monitoring,
    aggregate: {
      selected_positions: portfolio.length,
      long_positions: portfolio.filter((position) => position.side === "LONG").length,
      short_positions: portfolio.filter((position) => position.side === "SHORT").length,
      profitable_positions: exits.filter((exit) => exit.pnl_eur > 0).length,
      losing_positions: exits.filter((exit) => exit.pnl_eur < 0).length,
      flat_positions: exits.filter((exit) => exit.pnl_eur === 0).length,
      total_pnl_eur: totalPnl,
      avg_pnl_eur: exits.length ? round(totalPnl / exits.length, 6) : 0,
      avg_pnl_pct: exits.length ? round(exits.reduce((sum, exit) => sum + exit.pnl_pct, 0) / exits.length, 6) : 0,
      action_score_mismatch_count: mismatchCount,
      action_score_mismatch_rate: diagnostics.length ? round(mismatchCount / diagnostics.length, 6) : 0,
      debug_no_live: debugNoLive,
    },
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

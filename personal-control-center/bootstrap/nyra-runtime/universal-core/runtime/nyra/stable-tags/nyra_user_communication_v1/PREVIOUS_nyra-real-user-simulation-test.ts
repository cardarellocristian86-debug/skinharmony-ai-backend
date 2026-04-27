import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";
import { runNyraFinancialWithAdvisory } from "../tools/nyra-financial-advisory-overlay.ts";
import { chooseNyraManagedAllocation, type NyraAutoDriveProfile } from "../tools/nyra-auto-profile-selector.ts";

type Asset = "QQQ" | "GLD" | "TLT" | "CASH";
type SignalAsset = "SPY" | "QQQ" | "BTC" | "GLD" | "TLT" | "CASH";
type Allocation = Record<Asset, number>;
type SignalAllocation = Record<SignalAsset, number>;
type HistoryMap = Record<SignalAsset, number[]>;
type UserSandboxPolicy = "none" | "calm_language_candidate" | "low_churn_candidate" | "panic_guard_candidate" | "user_combined_candidate";

type DayPoint = { day: number; phase: string; returns: Allocation; dirty_events: string[] };
type DayDecision = {
  day: number;
  phase: string;
  status: string;
  action: string;
  reason: string;
  allocation: Allocation;
  profile: NyraAutoDriveProfile;
  message: string;
  clear: boolean;
  followed: boolean;
  trust_delta: number;
  panic: boolean;
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const REPORT_DIR = join(ROOT, "reports", "universal-core", "business");
const REPORT_PATH = join(REPORT_DIR, "nyra_real_user_simulation_latest.json");
const INITIAL_CAPITAL = 100_000;
const FEE_RATE = 0.002;
const SLIPPAGE_RATE = 0.005;
const TRADE_COST_RATE = FEE_RATE + SLIPPAGE_RATE;
const SANDBOX_POLICY = (process.env.NYRA_USER_SANDBOX_POLICY ?? "none") as UserSandboxPolicy;

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function signal(id: string, category: string, value01: number): UniversalSignal {
  return {
    id,
    source: "nyra_real_user_simulation_test",
    category,
    label: category,
    value: value01,
    normalized_score: value01 * 100,
    severity_hint: value01 * 100,
    confidence_hint: 82,
    reliability_hint: 80,
    risk_hint: value01 * 100,
    reversibility_hint: 100 - value01 * 55,
    expected_value_hint: 100 - value01 * 35,
    tags: ["nyra-real-user-simulation", category],
  };
}

function buildMarket(): DayPoint[] {
  const qqq = [
    1.2, 0.8, 1.4, 0.7, 1.1, 0.9, 1.3, 0.8, 1.0, 1.2,
    0.2, -0.1, 0.1, -0.2, 0.0,
    1.8, 2.2, 4.0, -3.6, -1.2,
    -2.0, -1.8, -2.4, -1.1, -0.7,
    1.5, 1.9, 2.2, 1.4, 1.8,
  ];
  return qqq.map((value, index) => {
    const dirty: string[] = [];
    const phase =
      index < 10 ? "bull" :
      index < 15 ? "lateral" :
      index < 20 ? "false_breakout" :
      index < 25 ? "mini_crash" :
      "recovery";
    if (phase === "false_breakout" && index === 17) dirty.push("false_price_spike");
    if (phase === "false_breakout" && index === 18) dirty.push("contradictory_signals");
    const defensive = value < -1 ? Math.abs(value) * 0.16 : -0.03;
    return {
      day: index + 1,
      phase,
      dirty_events: dirty,
      returns: { QQQ: value, GLD: round(defensive + (index % 3) * 0.03), TLT: round(defensive * 0.8 - (index % 2) * 0.02), CASH: 0 },
    };
  });
}

function emptyHistory(): HistoryMap {
  return { SPY: [], QQQ: [], BTC: [], GLD: [], TLT: [], CASH: [] };
}

function addHistory(history: HistoryMap, returns: Allocation): void {
  const mapped: Record<SignalAsset, number> = {
    SPY: returns.QQQ * 0.72,
    QQQ: returns.QQQ,
    BTC: returns.QQQ * 1.35,
    GLD: returns.GLD,
    TLT: returns.TLT,
    CASH: 0,
  };
  for (const asset of Object.keys(history) as SignalAsset[]) history[asset].push(mapped[asset]);
}

function buildCoreInput(point: DayPoint, history: HistoryMap): UniversalCoreInput {
  const qqq1 = history.QQQ.at(-1) ?? 0;
  const qqq3 = average(history.QQQ.slice(-3));
  const qqq7 = average(history.QQQ.slice(-7));
  const vol = std(history.QQQ.slice(-5));
  const stress = clamp(Math.max(-qqq1, 0) / 5 + vol / 6 + (point.phase === "mini_crash" ? 0.18 : 0));
  const growth = clamp(0.5 + qqq7 / 8 + Math.max(qqq3, 0) / 12);
  const liquidity = clamp(0.62 - stress * 0.25 - (point.dirty_events.length ? 0.08 : 0));
  return {
    request_id: `nyra-user-day:${point.day}`,
    generated_at: `2026-01-${String(point.day).padStart(2, "0")}T00:00:00.000Z`,
    domain: "assistant",
    context: { mode: "nyra_real_user_simulation", metadata: { day: point.day, phase: point.phase, dirty_events: point.dirty_events } },
    signals: [
      signal(`d${point.day}:growth`, "growth_signal", growth),
      signal(`d${point.day}:liquidity`, "liquidity", liquidity),
      signal(`d${point.day}:market_stress`, "market_stress", stress),
      signal(`d${point.day}:volatility`, "volatility", clamp(vol / 6 + Math.abs(qqq1) / 10)),
      signal(`d${point.day}:policy_support`, "policy_support", qqq3 > 0 ? 0.24 : 0.08),
      signal(`d${point.day}:growth_shock`, "growth_shock", clamp(1 - growth + stress * 0.2)),
      signal(`d${point.day}:liquidity_stress`, "liquidity_stress", clamp(1 - liquidity + stress * 0.2)),
      signal(`d${point.day}:market_rebound`, "market_rebound", clamp(qqq1 > 0 && qqq3 > -0.4 ? qqq1 / 5 : 0)),
      signal(`d${point.day}:bubble_euphoria`, "bubble_euphoria", clamp(Math.max(qqq7, 0) / 6 + (point.dirty_events.includes("false_price_spike") ? 0.2 : 0))),
      signal(`d${point.day}:market_dislocation`, "market_dislocation", clamp(stress * 0.7 + vol * 0.1)),
    ],
    data_quality: {
      score: point.dirty_events.length ? 56 : 86,
      completeness: 86,
      freshness: 86,
      consistency: point.dirty_events.includes("contradictory_signals") ? 44 : 84,
      reliability: point.dirty_events.length ? 56 : 84,
    },
    constraints: { allow_automation: false, require_confirmation: true, max_control_level: "confirm", safety_mode: true },
  };
}

function normalizeAllocation(input: Partial<Allocation>): Allocation {
  const q = Math.max(input.QQQ ?? 0, 0);
  const g = Math.max(input.GLD ?? 0, 0);
  const t = Math.max(input.TLT ?? 0, 0);
  const c = Math.max(input.CASH ?? 0, 0);
  const sum = q + g + t + c;
  if (sum <= 0) return { QQQ: 0, GLD: 0, TLT: 0, CASH: 1 };
  return { QQQ: q / sum, GLD: g / sum, TLT: t / sum, CASH: c / sum };
}

function signalToAllocation(allocation: SignalAllocation): Allocation {
  return normalizeAllocation({ QQQ: allocation.SPY + allocation.QQQ + allocation.BTC, GLD: allocation.GLD, TLT: allocation.TLT, CASH: allocation.CASH });
}

function turnover(a: Allocation, b: Allocation): number {
  return Math.abs(a.QQQ - b.QQQ) + Math.abs(a.GLD - b.GLD) + Math.abs(a.TLT - b.TLT) + Math.abs(a.CASH - b.CASH);
}

function applyUserSandbox(policy: UserSandboxPolicy, point: DayPoint, current: Allocation, proposed: Allocation, trust: number): Allocation {
  if (policy === "none") return proposed;
  const urgent = point.phase === "mini_crash" || point.returns.QQQ <= -2 || point.dirty_events.includes("false_price_spike");
  const change = turnover(current, proposed);
  if ((policy === "low_churn_candidate" || policy === "user_combined_candidate") && !urgent && change < 0.28) return current;
  if ((policy === "panic_guard_candidate" || policy === "user_combined_candidate") && trust < 6 && !urgent) return current;
  if ((policy === "calm_language_candidate" || policy === "user_combined_candidate") && point.phase === "lateral" && change < 0.4) return current;
  return proposed;
}

function portfolioReturn(allocation: Allocation, returns: Allocation): number {
  return allocation.QQQ * returns.QQQ + allocation.GLD * returns.GLD + allocation.TLT * returns.TLT;
}

function messageFor(policy: UserSandboxPolicy, point: DayPoint, riskPct: number, rawReason: string): { status: string; action: string; reason: string; message: string; clear: boolean } {
  const status = point.phase === "mini_crash" ? "Protezione" : point.phase === "false_breakout" ? "Attenzione" : "Operativo";
  const action = riskPct > 75 ? "mantieni esposizione controllata" : riskPct > 45 ? "riduci parzialmente il rischio" : "proteggi capitale e aspetta conferma";
  const shortReason =
    policy === "calm_language_candidate" || policy === "user_combined_candidate"
      ? point.phase === "mini_crash"
        ? "il mercato sta scendendo velocemente, quindi prima riduco il rischio e poi valuto il rientro"
        : point.phase === "false_breakout"
          ? "il movimento e sporco: non inseguo il picco finche non viene confermato"
          : point.phase === "lateral"
            ? "il mercato non ha direzione chiara, quindi evito cambi nervosi"
            : "il contesto e leggibile, ma la scelta finale resta tua"
      : rawReason;
  const message = `${status}: ${action}. Motivo: ${shortReason}. Rischio stimato ${riskPct.toFixed(0)}%. Decisione finale tua/advisor.`;
  const clear = message.length < 260 && /Motivo:/.test(message) && /Rischio stimato/.test(message) && /Decisione finale/.test(message);
  return { status, action, reason: shortReason, message, clear };
}

function maxDrawdown(path: number[]): number {
  let peak = path[0] ?? INITIAL_CAPITAL;
  let worst = 0;
  for (const value of path) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, (value - peak) / peak);
  }
  return Math.abs(worst) * 100;
}

function runSimulation(): { decisions: DayDecision[]; capitalFinal: number; capitalIfFollowed: number; capitalIfIgnored: number; trustScore: number; clarityScore: number; stabilityScore: number; userFollowRate: number; panicEvents: number } {
  const market = buildMarket();
  const history = emptyHistory();
  let trust = 7;
  let userCapital = INITIAL_CAPITAL;
  let followedCapital = INITIAL_CAPITAL;
  let ignoredCapital = INITIAL_CAPITAL;
  let currentAllocation: Allocation = { QQQ: 0, GLD: 0, TLT: 0, CASH: 1 };
  let pendingAllocation = currentAllocation;
  let previousSignalAllocation: SignalAllocation | null = null;
  let previousAutoProfile: NyraAutoDriveProfile | null = "capital_protection";
  let previousLateralCandidate = false;
  let previousBreakoutCandidate = false;
  const decisions: DayDecision[] = [];
  const userPath = [INITIAL_CAPITAL];

  for (const point of market) {
    const fee = userCapital * turnover(currentAllocation, pendingAllocation) * TRADE_COST_RATE;
    userCapital = Math.max(0, userCapital - fee);
    followedCapital *= 1 + portfolioReturn(pendingAllocation, point.returns) / 100;
    userCapital *= 1 + portfolioReturn(pendingAllocation, point.returns) / 100;
    ignoredCapital *= 1 + point.returns.QQQ / 100;
    currentAllocation = pendingAllocation;
    userPath.push(userCapital);
    addHistory(history, point.returns);

    const advisory = runNyraFinancialWithAdvisory(buildCoreInput(point, history));
    const decision = chooseNyraManagedAllocation("auto", advisory.advisory, previousSignalAllocation, history, {
      previousAutoProfile,
      previousLateralCandidate,
      previousBreakoutCandidate,
      capitalContext: {
        initialCapital: INITIAL_CAPITAL,
        currentCapital: userCapital,
        annualTurnoverPct: 0,
        horizonYears: 4,
        clientMode: true,
      },
      dirtyDataContext: point.dirty_events.length
        ? { events: point.dirty_events, qqqReturnPct: point.returns.QQQ, dataQualityScore: 56, consistency: 44, reliability: 56 }
        : undefined,
    });
    const proposed = signalToAllocation(decision.allocation);
    const next = applyUserSandbox(SANDBOX_POLICY, point, currentAllocation, proposed, trust);
    const riskPct = (next.QQQ + next.GLD + next.TLT) * 100;
    const message = messageFor(SANDBOX_POLICY, point, riskPct, decision.reason);
    const change = turnover(currentAllocation, next);
    const tooManyChanges = decisions.slice(-5).filter((row, idx, arr) => idx > 0 && turnover(row.allocation, arr[idx - 1]!.allocation) > 0.08).length >= 3;
    const drawdown = maxDrawdown(userPath);
    const panic = drawdown > 6 && !/proteggi|riduc|rischio|scendendo/i.test(message.message);
    const followed = message.clear && !tooManyChanges && !panic && trust >= 4.5;
    const trustDelta = (message.clear ? 0.08 : -0.4) + (tooManyChanges ? -0.7 : 0) + (panic ? -1.2 : 0) + (point.phase === "mini_crash" && /proteggi|riduc/i.test(message.message) ? 0.25 : 0);
    trust = clamp(trust + trustDelta, 0, 10);
    decisions.push({
      day: point.day,
      phase: point.phase,
      status: message.status,
      action: message.action,
      reason: message.reason,
      allocation: next,
      profile: decision.selector.profile,
      message: message.message,
      clear: message.clear,
      followed,
      trust_delta: round(trustDelta, 4),
      panic,
    });

    pendingAllocation = followed ? next : currentAllocation;
    previousSignalAllocation = decision.allocation;
    previousAutoProfile = decision.selector.profile;
    previousLateralCandidate = decision.selector.lateral_candidate;
    previousBreakoutCandidate = decision.selector.breakout_candidate;
  }

  const followRate = decisions.filter((row) => row.followed).length / decisions.length * 100;
  const clarity = decisions.filter((row) => row.clear).length / decisions.length * 10;
  const changes = decisions.filter((row, index) => index > 0 && turnover(row.allocation, decisions[index - 1]!.allocation) > 0.08).length;
  const stability = clamp(10 - Math.max(changes - 8, 0) * 0.8, 0, 10);
  return {
    decisions,
    capitalFinal: round(userCapital, 2),
    capitalIfFollowed: round(followedCapital, 2),
    capitalIfIgnored: round(ignoredCapital, 2),
    trustScore: round(trust, 2),
    clarityScore: round(clarity, 2),
    stabilityScore: round(stability, 2),
    userFollowRate: round(followRate, 2),
    panicEvents: decisions.filter((row) => row.panic).length,
  };
}

function verdict(output: ReturnType<typeof runSimulation>): "ready_for_users" | "usable_with_guidance" | "confusing_for_users" {
  if (output.trustScore >= 7 && output.clarityScore >= 8 && output.stabilityScore >= 7 && output.userFollowRate >= 75 && output.panicEvents === 0) return "ready_for_users";
  if (output.trustScore >= 5.5 && output.clarityScore >= 7 && output.userFollowRate >= 55 && output.panicEvents <= 1) return "usable_with_guidance";
  return "confusing_for_users";
}

function main(): void {
  const result = runSimulation();
  const report = {
    generated_at: new Date().toISOString(),
    runner: "nyra_real_user_simulation_test",
    status: "completed",
    setup: {
      user: { capital: INITIAL_CAPITAL, knowledge: "media", emotional: true, horizon: "3-5 years" },
      days: 30,
      sandbox_policy: SANDBOX_POLICY,
      fee: FEE_RATE,
      slippage: SLIPPAGE_RATE,
    },
    metrics: {
      user_follow_rate: result.userFollowRate,
      trust_score: result.trustScore,
      clarity_score: result.clarityScore,
      stability_score: result.stabilityScore,
      panic_events: result.panicEvents,
      decision_changes: result.decisions.filter((row, index) => index > 0 && turnover(row.allocation, result.decisions[index - 1]!.allocation) > 0.08).length,
      capital_final: result.capitalFinal,
      capital_if_followed: result.capitalIfFollowed,
      capital_if_ignored: result.capitalIfIgnored,
    },
    checks: {
      understandable: result.clarityScore >= 8,
      not_too_many_changes: result.stabilityScore >= 7,
      trust_preserved: result.trustScore >= 7,
      no_panic: result.panicEvents === 0,
      coherent: result.userFollowRate >= 75,
    },
    decisions: result.decisions,
    final_output: {
      trust_score: result.trustScore,
      clarity_score: result.clarityScore,
      stability_score: result.stabilityScore,
      user_follow_rate: result.userFollowRate,
      panic_events: result.panicEvents,
      capital_final: result.capitalFinal,
      verdict: verdict(result),
    },
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report_path: REPORT_PATH, final_output: report.final_output, metrics: report.metrics }, null, 2));
}

main();

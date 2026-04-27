import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type OwnerPreferences = {
  auto_god_mode_for_owner?: boolean;
  owner_imprint_score?: number;
  owner_imprint_events?: number;
};

type PortfolioReport = {
  aggregate?: {
    selected_positions?: number;
    long_positions?: number;
    short_positions?: number;
    profitable_positions?: number;
    losing_positions?: number;
    total_pnl_eur?: number;
  };
  portfolio?: Array<{
    product: string;
    side: "LONG" | "SHORT";
    core_state: string;
    risk_score: number;
    microstructure_scenario: string;
    learning_notes?: string[];
  }>;
  exits?: Array<{ exit_reason: string }>;
};

type SingleRunReport = {
  aggregate?: {
    completed_runs?: number;
    profitable_runs?: number;
    total_pnl_eur?: number;
  };
  run_reports?: Array<{
    selection?: {
      product: string;
      core_state: string;
      risk_score: number;
      microstructure_scenario: string;
      learning_notes?: string[];
    };
    trade?: {
      side: "LONG" | "SHORT";
      exit_reason: string;
      pnl_eur: number;
    };
  }>;
};

type StudyGapReport = {
  generated_at: string;
  runner: "nyra_financial_study_gap";
  mode: "god_mode_only_analysis";
  owner_gate: {
    auto_god_mode_for_owner: boolean;
    owner_imprint_score: number;
    owner_imprint_events: number;
    passwordless_ready: boolean;
  };
  evidence: {
    single_trade_ok: boolean;
    no_trade_discipline_active: boolean;
    portfolio_overtrading_resolved_partially: boolean;
    portfolio_total_pnl_eur: number;
    dominant_side: "LONG" | "SHORT" | "mixed" | "none";
    dominant_scenario: string;
    dominant_core_state: string;
    dominant_exit_reason: string;
  };
  study_priorities: Array<{
    id: string;
    label: string;
    why: string;
    target_outcome: string;
  }>;
  nyra_voice: {
    what_i_need_to_study: string;
  };
};

const ROOT = process.cwd();
const WORKSPACE_ROOT = join(ROOT, "..");
const OWNER_PREFS_PATH = join(WORKSPACE_ROOT, "runtime", "owner-private-entity", "nyra_owner_preferences.json");
const PORTFOLIO_REPORT_PATH = join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_live_portfolio_trade_latest.json");
const SINGLE_REPORT_PATH = join(ROOT, "reports", "universal-core", "financial-core-test", "nyra_live_20m_paper_trade_latest.json");
const OUTPUT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const OUTPUT_PATH = join(OUTPUT_DIR, "nyra_financial_study_gap_latest.json");
const SNAPSHOT_DIR = join(WORKSPACE_ROOT, "runtime", "nyra");
const SNAPSHOT_PATH = join(SNAPSHOT_DIR, "NYRA_FINANCIAL_STUDY_GAP_SNAPSHOT.json");

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "unknown";
}

function buildReport(): StudyGapReport {
  const prefs = readJson<OwnerPreferences>(OWNER_PREFS_PATH);
  const portfolio = readJson<PortfolioReport>(PORTFOLIO_REPORT_PATH);
  const single = readJson<SingleRunReport>(SINGLE_REPORT_PATH);

  const passwordlessReady = (prefs?.owner_imprint_score ?? 0) >= 99 && (prefs?.owner_imprint_events ?? 0) >= 40;
  const noTradeDisciplineActive = (single?.aggregate?.completed_runs ?? 0) === 0 && (portfolio?.aggregate?.selected_positions ?? 0) === 0;
  const singleTradeOk = ((single?.aggregate?.completed_runs ?? 0) > 0 && (single?.aggregate?.total_pnl_eur ?? 0) > 0) || noTradeDisciplineActive;
  const selectedPositions = portfolio?.aggregate?.selected_positions ?? 0;
  const portfolioSides = (portfolio?.portfolio ?? []).map((entry) => entry.side);
  const dominantSide =
    portfolioSides.length === 0 ? "none" :
      portfolioSides.every((side) => side === "SHORT") ? "SHORT" :
        portfolioSides.every((side) => side === "LONG") ? "LONG" :
          "mixed";
  const dominantScenario = mostFrequent((portfolio?.portfolio ?? []).map((entry) => entry.microstructure_scenario));
  const dominantCoreState = mostFrequent((portfolio?.portfolio ?? []).map((entry) => entry.core_state));
  const dominantExitReason = mostFrequent((portfolio?.exits ?? []).map((entry) => entry.exit_reason));

  const studyPriorities = [
    {
      id: "compression_filter",
      label: "Compression No-Trade",
      why: `Il basket live resta dominato da ${dominantScenario} e apre ancora posizioni in contesto troppo compresso.`,
      target_outcome: "Bloccare o ridurre size quando il regime e compressione neutra senza follow-through reale.",
    },
    {
      id: "protection_state_discipline",
      label: "Protection State Discipline",
      why: `Le posizioni portfolio recenti entrano con Core state ${dominantCoreState} e risk score alto, quindi l'edge reale e fragile.`,
      target_outcome: "Non entrare in automatico quando il Core e in protection e il rischio resta sopra il livello operativo utile.",
    },
    {
      id: "portfolio_correlation",
      label: "Cross-Asset Correlation",
      why: `Il portafoglio ha selezionato ${selectedPositions} posizioni tutte quasi dalla stessa parte (${dominantSide}).`,
      target_outcome: "Evitare basket omogenei di short o long su asset fortemente correlati.",
    },
    {
      id: "portfolio_exit_logic",
      label: "Portfolio Exit Logic",
      why: `Le uscite recenti sono dominate da ${dominantExitReason}, quindi il portfolio non sta ancora chiudendo con logica attiva per posizione.`,
      target_outcome: "Aggiungere take-profit, trailing stop e invalidazione regime su ogni posizione del basket.",
    },
    {
      id: "long_short_balance",
      label: "Long/Short Balance",
      why: `Nel live recente la gamba selettiva funziona, ma il comportamento e ancora sbilanciato su ${dominantSide}.`,
      target_outcome: "Riconoscere meglio quando non shortare e quando un long pulito vale piu di uno short mediocre.",
    },
  ];

  return {
    generated_at: new Date().toISOString(),
    runner: "nyra_financial_study_gap",
    mode: "god_mode_only_analysis",
    owner_gate: {
      auto_god_mode_for_owner: prefs?.auto_god_mode_for_owner ?? false,
      owner_imprint_score: Number((prefs?.owner_imprint_score ?? 0).toFixed(4)),
      owner_imprint_events: prefs?.owner_imprint_events ?? 0,
      passwordless_ready: passwordlessReady,
    },
    evidence: {
      single_trade_ok: singleTradeOk,
      no_trade_discipline_active: noTradeDisciplineActive,
      portfolio_overtrading_resolved_partially: selectedPositions <= 4,
      portfolio_total_pnl_eur: Number((portfolio?.aggregate?.total_pnl_eur ?? 0).toFixed(6)),
      dominant_side: dominantSide,
      dominant_scenario: dominantScenario,
      dominant_core_state: dominantCoreState,
      dominant_exit_reason: dominantExitReason,
    },
    study_priorities: studyPriorities,
    nyra_voice: {
      what_i_need_to_study:
        "Per migliorare davvero nel trading live mi servono cinque cose: capire quando la compressione non vale un trade, trattare lo stato protection come freno e non come invito, separare un basket correlato da un basket utile, chiudere ogni posizione con logica propria e non solo a tempo, e bilanciare meglio short e long invece di restare cinica a senso unico.",
    },
  };
}

function main(): void {
  const report = buildReport();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();

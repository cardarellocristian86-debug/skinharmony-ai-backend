import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type MarketRow = {
  symbol: string;
  name: string;
  class: string;
  region: string;
  action: "candidate" | "watch" | "avoid";
  edge_score: number;
  risk_score: number;
  return_20d_pct: number;
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const SCAN_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_world_market_scan_latest.json");
const ADVANCED_STUDY_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_advanced_study_latest.json");
const REPORT_PATH = join(ROOT, "reports", "universal-core", "nyra-learning", "nyra_world_market_study_latest.json");
const RUNTIME_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_world_market_study_latest.json");

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function groupCount(rows: MarketRow[], key: "class" | "region" | "action"): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row[key] || "unknown");
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function riskNote(row: MarketRow): string {
  if (row.class === "single_stock") return "single stock: rischio specifico azienda, earnings, news e concentrazione; non confondere momentum con diversificazione";
  if (row.class === "equity_index") return "equity index: rischio macro/risk-on, correlazione alta con altri indici azionari";
  if (row.class === "commodity_proxy") return "commodity proxy: driver fisico/macro, roll/frizioni ETF, volatilita e shock geopolitici";
  if (row.class === "bond") return "bond duration: sensibile a tassi reali/inflazione; non sempre protegge negli shock inflattivi";
  if (row.class === "crypto") return "crypto: 24/7, volatilita alta, liquidita variabile e rischio gap/news; size piccola";
  return "mercato proxy: richiede verifica di liquidita, correlazione e driver prima di aumentare size";
}

function main(): void {
  const scan = readJson<{ ranked?: MarketRow[]; output?: { best_symbol?: string } }>(SCAN_PATH, { ranked: [] });
  const study = readJson<{ selected_domains?: string[]; domains?: Array<{ id: string; fetched?: Array<{ ok: boolean }> }> }>(ADVANCED_STUDY_PATH, {});
  const ranked = Array.isArray(scan.ranked) ? scan.ranked : [];
  const top = ranked.slice(0, 12);
  const candidates = ranked.filter((row) => row.action === "candidate");

  const report = {
    version: "nyra_world_market_study_v1",
    generated_at: new Date().toISOString(),
    mode: "study_to_runtime_guidance",
    source_scan: SCAN_PATH,
    source_study: ADVANCED_STUDY_PATH,
    study_domains_used: study.selected_domains || [],
    source_domains_health: (study.domains || []).map((domain) => ({
      id: domain.id,
      ok_sources: (domain.fetched || []).filter((item) => item.ok).length,
      total_sources: (domain.fetched || []).length
    })),
    market_map: {
      total_markets: ranked.length,
      candidate_count: candidates.length,
      class_distribution: groupCount(ranked, "class"),
      region_distribution: groupCount(ranked, "region"),
      action_distribution: groupCount(ranked, "action"),
      current_best_symbol: scan.output?.best_symbol || top[0]?.symbol || null
    },
    learned_principles: [
      "Il mercato mondiale non e una lista di ticker indipendenti: molti asset condividono lo stesso rischio macro.",
      "QQQ, SPY, big tech e molte single stock USA possono salire insieme ma anche cadere insieme: non contano come diversificazione piena.",
      "Bond lunghi come TLT proteggono spesso in crisi growth/deflazione, ma possono perdere insieme alle azioni durante shock inflattivi e rialzo tassi.",
      "Oro e commodity non sono sempre rifugio: dipendono da dollaro, tassi reali, inflazione, geopolitica, domanda fisica e struttura ETF/futures.",
      "Crypto va trattata come asset ad alta volatilita e liquidita continua: size ridotta e protezione prima dell'attacco.",
      "La scelta autonoma deve separare tre domande: edge, rischio e utilita nel portafoglio gia aperto.",
      "Profitto non significa sempre marcia alta: a volte il profitto atteso migliore nasce da non entrare o da size piccola in un regime sporco."
    ],
    selection_rules: [
      "Non scegliere piu asset dello stesso cluster se il portafoglio e gia esposto a quel cluster.",
      "Premiare edge alto solo se risk_score resta compatibile con la marcia corrente.",
      "Penalizzare single stock quando l'indice correlato e gia selezionato.",
      "Penalizzare commodity con forte volatilita recente se la marcia non e almeno 4.",
      "Bloccare overdrive se il miglior candidato e solo un rimbalzo esteso senza conferma multi-periodo.",
      "Usare cash come scelta attiva quando tutti i candidati sono correlati, costosi o in avoid."
    ],
    gear_interpretation: {
      gear_1: "studio/protezione: size minima, solo candidati molto puliti",
      gear_2: "prudente: diversificazione prima del rendimento",
      gear_3: "bilanciata: entra solo se edge e rischio sono coerenti",
      gear_4: "hard controllata: puo attaccare, ma senza concentrare tutto nello stesso cluster",
      gear_5_7: "overdrive: solo bull sano, liquidita pulita, no deterioration e rischio non correlato eccessivo"
    },
    current_top_lessons: top.map((row) => ({
      symbol: row.symbol,
      class: row.class,
      region: row.region,
      action: row.action,
      edge_score: row.edge_score,
      risk_score: row.risk_score,
      return_20d_pct: row.return_20d_pct,
      risk_note: riskNote(row)
    })),
    runtime_effect: {
      promoted_to_stable: false,
      used_by_world_paper: true,
      execution: "paper_only",
      next_required: "test automatico ripetuto: Nyra sceglie asset+marcia, aggiorna PnL, confronta vs scelta manuale e vs QQQ"
    }
  };

  writeJson(REPORT_PATH, report);
  writeJson(RUNTIME_PATH, report);
  console.log(JSON.stringify({ ok: true, report_path: REPORT_PATH, runtime_path: RUNTIME_PATH, market_map: report.market_map }, null, 2));
}

main();

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type JsonObject = Record<string, any>;

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const STORAGE_ROOT = process.env.NYRA_STORAGE_ROOT || "";
function storageJoin(...parts: string[]): string {
  return STORAGE_ROOT ? join(STORAGE_ROOT, ...parts) : join(ROOT, ...parts);
}
const HISTORY_PATH = storageJoin("universal-core", "runtime", "nyra-learning", "nyra_world_asset_history_study_latest.json");
const SCAN_PATH = storageJoin("runtime", "nyra-learning", "nyra_world_market_scan_latest.json");
const PAPER_PATH = storageJoin("personal-control-center", "data", "nyra-world-paper-portfolio.json");
const LEARNING_PATH = storageJoin("universal-core", "runtime", "nyra-learning", "nyra_world_paper_auto_learning_latest.json");
const MEMORY_PATH = storageJoin("universal-core", "runtime", "nyra-learning", "nyra_world_market_memory_bank_latest.json");
const REPORT_PATH = storageJoin("reports", "universal-core", "nyra-learning", "nyra_world_market_memory_bank_latest.json");

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (_error) {
    return fallback;
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function tradeStatsForSymbol(symbol: string, trades: JsonObject[]) {
  const rows = trades.filter((trade) => String(trade.symbol || "").toUpperCase() === symbol.toUpperCase());
  const realized = rows
    .filter((trade) => String(trade.type || "").includes("sell"))
    .reduce((sum, trade) => sum + Number(trade.pnl_eur || 0), 0);
  const buys = rows.filter((trade) => String(trade.type || "").includes("buy")).length;
  const pauses = rows.filter((trade) => String(trade.type || "").includes("pause")).length;
  return {
    trade_count: rows.length,
    buy_count: buys,
    pause_count: pauses,
    realized_pnl_eur: round(realized, 2),
    last_trade_at: rows[0]?.at || null,
    last_trade_type: rows[0]?.type || null
  };
}

function positionForSymbol(symbol: string, positions: JsonObject[]) {
  return positions.find((position) => String(position.symbol || "").toUpperCase() === symbol.toUpperCase()) || null;
}

function lessonForAsset(asset: JsonObject, scanRow: JsonObject | null, position: JsonObject | null, stats: JsonObject, learning: JsonObject) {
  const penalizedSymbols = new Set((learning?.policy?.penalize_symbols || []).map((item: JsonObject) => String(item.symbol || "").toUpperCase()));
  const penalizedClasses = new Set((learning?.policy?.penalize_classes || []).map((item: JsonObject) => String(item.class || "")));
  const behavior = String(asset.behavior || "unknown");
  const lessons = [
    asset.nyra_rule || "studiare edge, rischio e ruolo in portafoglio prima di entrare"
  ];
  if (Number(asset.max_drawdown_pct || 0) < -60) lessons.push("drawdown storico profondo: size ridotta e stop di contesto");
  if (Number(asset.max_recovery_months || 0) > 48) lessons.push("recovery storica lunga: evitare ingresso pesante dopo rimbalzo esteso");
  if (behavior === "high_volatility_convex") lessons.push("convessita alta ma rischio alto: solo size minima o regime molto sano");
  if (penalizedSymbols.has(String(asset.symbol || "").toUpperCase())) lessons.push("paper recente negativo: non rientrare subito");
  if (penalizedClasses.has(String(asset.class || ""))) lessons.push("classe penalizzata dal paper: richiede conferma migliore o size esplorativa");
  if (position) lessons.push(`posizione paper aperta: PnL ${round(Number(position.pnl_pct || 0), 4)}%`);
  if (scanRow?.action === "candidate") lessons.push("scan live candidate: controllare se e trend sano o rimbalzo tirato");
  if (stats.realized_pnl_eur < 0) lessons.push("realizzato paper negativo: aumentare cooldown prima di nuova entrata");
  return lessons;
}

function main(): void {
  const previous = readJson<JsonObject>(MEMORY_PATH, {});
  const history = readJson<JsonObject>(HISTORY_PATH, { assets: [] });
  const scan = readJson<JsonObject>(SCAN_PATH, { ranked: [] });
  const paper = readJson<JsonObject>(PAPER_PATH, { positions: [], trades: [] });
  const learning = readJson<JsonObject>(LEARNING_PATH, {});

  const scanBySymbol = new Map((scan.ranked || []).map((row: JsonObject) => [String(row.symbol || "").toUpperCase(), row]));
  const positions = Array.isArray(paper.positions) ? paper.positions : [];
  const trades = Array.isArray(paper.trades) ? paper.trades : [];
  const previousAssets = previous.assets_by_symbol || {};
  const assetsBySymbol: Record<string, JsonObject> = {};

  for (const asset of history.assets || []) {
    const symbol = String(asset.symbol || "").toUpperCase();
    const scanRow = scanBySymbol.get(symbol) || null;
    const position = positionForSymbol(symbol, positions);
    const stats = tradeStatsForSymbol(symbol, trades);
    assetsBySymbol[symbol] = {
      ...(previousAssets[symbol] || {}),
      symbol,
      name: asset.name,
      class: asset.class,
      region: asset.region,
      behavior: asset.behavior,
      knowledge_score: asset.knowledge_score,
      history: {
        first_date: asset.first_date,
        last_date: asset.last_date,
        years: asset.years,
        cagr_pct: asset.cagr_pct,
        volatility_annual_pct: asset.volatility_annual_pct,
        max_drawdown_pct: asset.max_drawdown_pct,
        max_recovery_months: asset.max_recovery_months,
        return_1y_pct: asset.return_1y_pct,
        return_3y_pct: asset.return_3y_pct,
        return_5y_pct: asset.return_5y_pct,
        return_10y_pct: asset.return_10y_pct
      },
      live_scan: scanRow ? {
        last_date: scanRow.last_date,
        last_price: scanRow.last_price,
        action: scanRow.action,
        edge_score: scanRow.edge_score,
        risk_score: scanRow.risk_score,
        return_20d_pct: scanRow.return_20d_pct,
        reason: scanRow.reason
      } : null,
      paper: {
        ...stats,
        open: Boolean(position),
        open_pnl_eur: position ? Number(position.pnl_eur || 0) : 0,
        open_pnl_pct: position ? Number(position.pnl_pct || 0) : 0
      },
      lessons: lessonForAsset(asset, scanRow, position, stats, learning),
      updated_at: new Date().toISOString()
    };
  }

  for (const scanRow of scan.ranked || []) {
    const symbol = String(scanRow.symbol || "").toUpperCase();
    if (!symbol || assetsBySymbol[symbol]) continue;
    const position = positionForSymbol(symbol, positions);
    const stats = tradeStatsForSymbol(symbol, trades);
    const asset = {
      symbol,
      name: scanRow.name || symbol,
      class: scanRow.class || "unknown",
      region: scanRow.region || "unknown",
      behavior: "live_scan_only",
      knowledge_score: 35,
      nyra_rule: "asset conosciuto dal radar globale ma non ancora studiato storicamente: usare solo per discovery o probe piccoli"
    };
    assetsBySymbol[symbol] = {
      ...(previousAssets[symbol] || {}),
      symbol,
      name: asset.name,
      class: asset.class,
      region: asset.region,
      behavior: asset.behavior,
      knowledge_score: asset.knowledge_score,
      history: null,
      live_scan: {
        last_date: scanRow.last_date,
        last_price: scanRow.last_price,
        action: scanRow.action,
        edge_score: scanRow.edge_score,
        risk_score: scanRow.risk_score,
        return_20d_pct: scanRow.return_20d_pct,
        reason: scanRow.reason
      },
      paper: {
        ...stats,
        open: Boolean(position),
        open_pnl_eur: position ? Number(position.pnl_eur || 0) : 0,
        open_pnl_pct: position ? Number(position.pnl_pct || 0) : 0
      },
      lessons: lessonForAsset(asset, scanRow, position, stats, learning),
      updated_at: new Date().toISOString()
    };
  }

  const openPositions = positions.map((position: JsonObject) => ({
    symbol: position.symbol,
    class: position.class,
    pnl_eur: position.pnl_eur,
    pnl_pct: position.pnl_pct,
    opened_at: position.opened_at,
    reason: position.reason
  }));

  const memory = {
    version: "nyra_world_market_memory_bank_v1",
    generated_at: new Date().toISOString(),
    preserves_acquired_memory: true,
    sources: {
      history: HISTORY_PATH,
      scan: SCAN_PATH,
      paper: PAPER_PATH,
      learning: LEARNING_PATH
    },
    summary: {
      assets_known: Object.keys(assetsBySymbol).length,
      scan_markets: Array.isArray(scan.ranked) ? scan.ranked.length : 0,
      paper_positions: positions.length,
      paper_trades_seen: trades.length,
      learning_state: learning.learning_state || "unknown",
      pause_new_entries: Boolean(learning?.policy?.pause_new_entries),
      open_positions: openPositions
    },
    stable_principles: [
      "Non cancellare memoria acquisita quando si resetta o cambia sessione paper.",
      "Lo studio storico filtra la scelta live: non garantisce profitto, ma evita ignoranza sul comportamento degli asset.",
      "Il capitale paper non e capitale reale: serve a imparare a generare profitto attraverso prove controllate, errori misurati e correzioni.",
      "In hard learning lo stallo e un errore: se sbaglia, Nyra deve cambiare asset, ridurre size, registrare la lezione e continuare a cercare profitto paper.",
      "Se il paper va in perdita, Nyra deve distinguere tra bloccare tutto e aprire solo probe piccoli su asset fuori cluster con storia coerente.",
      "La memoria per asset deve crescere con esiti reali: entrate, pause, vendite, PnL e motivi."
    ],
    assets_by_symbol: assetsBySymbol
  };

  writeJson(MEMORY_PATH, memory);
  writeJson(REPORT_PATH, memory);
  console.log(JSON.stringify({
    ok: true,
    memory_path: MEMORY_PATH,
    report_path: REPORT_PATH,
    summary: memory.summary
  }, null, 2));
}

main();

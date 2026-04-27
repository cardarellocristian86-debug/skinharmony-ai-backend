import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type UniverseAsset = {
  symbol: string;
  yahoo?: string;
  name: string;
  class: string;
  region: string;
};

type PriceRow = {
  date: string;
  close: number;
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const STORAGE_ROOT = process.env.NYRA_STORAGE_ROOT || "";
function storageJoin(...parts: string[]): string {
  return STORAGE_ROOT ? join(STORAGE_ROOT, ...parts) : join(ROOT, ...parts);
}
const UNIVERSE_PATH = join(ROOT, "universal-core", "config", "nyra_world_market_universe.json");
const CACHE_DIR = storageJoin("universal-core", "data", "world-market-history-cache");
const REPORT_PATH = storageJoin("reports", "universal-core", "nyra-learning", "nyra_world_asset_history_study_latest.json");
const RUNTIME_PATH = storageJoin("universal-core", "runtime", "nyra-learning", "nyra_world_asset_history_study_latest.json");
const CACHE_TTL_MS = Number(process.env.NYRA_ASSET_HISTORY_CACHE_TTL_MS || 24 * 60 * 60_000);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function pct(from: number, to: number): number {
  return from > 0 ? ((to / from) - 1) * 100 : 0;
}

function cacheFresh(path: string): boolean {
  return existsSync(path) && Date.now() - statSync(path).mtimeMs < CACHE_TTL_MS;
}

function curl(url: string): string {
  return execFileSync("/usr/bin/curl", ["-fsSL", "-A", "Mozilla/5.0", url], { encoding: "utf8" });
}

function cachePath(asset: UniverseAsset): string {
  const id = String(asset.yahoo || asset.symbol).replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
  return join(CACHE_DIR, `${id}_adjmonthly_v2.json`);
}

function loadYahooMonthly(asset: UniverseAsset): PriceRow[] {
  if (!asset.yahoo) return [];
  const path = cachePath(asset);
  if (!cacheFresh(path)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    const encoded = encodeURIComponent(asset.yahoo);
    const raw = curl(`https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=max&interval=1mo`);
    const parsed = JSON.parse(raw) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{ close?: Array<number | null> }>;
            adjclose?: Array<{ adjclose?: Array<number | null> }>;
          };
        }>;
        error?: { description?: string };
      };
    };
    const result = parsed.chart?.result?.[0];
    if (!result || parsed.chart?.error) throw new Error(parsed.chart?.error?.description || "Yahoo history missing result");
    const timestamps = result.timestamp || [];
    const rawCloses = result.indicators?.quote?.[0]?.close || [];
    const adjustedCloses = result.indicators?.adjclose?.[0]?.adjclose || [];
    const closes = adjustedCloses.length ? adjustedCloses : rawCloses;
    const rows = timestamps.map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      close: Number(closes[index] || 0)
    })).filter((row) => row.date && row.close > 0);
    writeJson(path, rows);
  }
  return readJson<PriceRow[]>(path).filter((row) => row.date && Number(row.close || 0) > 0);
}

function maxDrawdown(closes: number[]): number {
  let peak = closes[0] || 0;
  let worst = 0;
  closes.forEach((close) => {
    if (close > peak) peak = close;
    if (peak > 0) worst = Math.min(worst, (close / peak) - 1);
  });
  return worst * 100;
}

function maxRecoveryMonths(closes: number[]): number {
  let peak = closes[0] || 0;
  let drawdownStart = -1;
  let longest = 0;
  closes.forEach((close, index) => {
    if (close >= peak) {
      if (drawdownStart >= 0) longest = Math.max(longest, index - drawdownStart);
      peak = close;
      drawdownStart = -1;
    } else if (drawdownStart < 0) {
      drawdownStart = index;
    }
  });
  if (drawdownStart >= 0) longest = Math.max(longest, closes.length - drawdownStart);
  return longest;
}

function yearsBetween(fromDate: string, toDate: string): number {
  const from = new Date(fromDate).getTime();
  const to = new Date(toDate).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return (to - from) / (365.25 * 24 * 60 * 60 * 1000);
}

function sliceReturnYears(rows: PriceRow[], years: number): number | null {
  if (rows.length < 2) return null;
  const last = rows.at(-1);
  if (!last) return null;
  const target = new Date(last.date);
  target.setFullYear(target.getFullYear() - years);
  const targetMs = target.getTime();
  const fromRow = rows.reduce<PriceRow | null>((best, row) => {
    const distance = Math.abs(new Date(row.date).getTime() - targetMs);
    const bestDistance = best ? Math.abs(new Date(best.date).getTime() - targetMs) : Infinity;
    return distance < bestDistance ? row : best;
  }, null);
  const from = fromRow?.close || 0;
  const to = last.close || 0;
  return round(pct(from, to), 4);
}

function classifyAsset(asset: UniverseAsset, metrics: { cagr: number; maxDd: number; vol: number; recovery: number; years: number }): string {
  if (asset.class === "bond") return metrics.maxDd > -25 ? "defensive_duration" : "duration_risk";
  if (asset.class === "commodity_proxy" || asset.class === "metals_mining_proxy") return metrics.vol > 28 ? "macro_shock_asset" : "diversifier";
  if (asset.class === "crypto") return "high_volatility_convex";
  if (asset.class === "single_stock") return metrics.maxDd < -55 ? "idiosyncratic_growth" : "quality_growth";
  if (metrics.cagr > 8 && metrics.maxDd > -45) return "core_growth";
  if (metrics.maxDd < -50) return "aggressive_cycle";
  return "market_beta";
}

function ruleForAsset(asset: UniverseAsset, behavior: string): string {
  if (behavior === "defensive_duration") return "utile se equity stressa e inflazione/tassi non sono il problema principale";
  if (behavior === "duration_risk") return "non usarlo come rifugio automatico durante shock inflattivo o rialzo tassi";
  if (behavior === "macro_shock_asset") return "entra solo con size controllata: puo difendere ma anche girare violentemente";
  if (behavior === "high_volatility_convex") return "solo marce alte sane o size minima: volatilita e drawdown dominano";
  if (behavior === "idiosyncratic_growth") return "non confondere momentum aziendale con indice diversificato; size ridotta";
  if (behavior === "quality_growth") return "puo attaccare in bull sano, ma controllare earnings/news e correlazione tech";
  if (behavior === "core_growth") return "asset da attacco principale se trend sano e rischio non deteriora";
  if (behavior === "aggressive_cycle") return "ciclico aggressivo: entra dopo conferma, esci se volatilita sale";
  return "asset beta: usarlo per esposizione generale, non come edge speciale";
}

function analyze(asset: UniverseAsset) {
  const rows = loadYahooMonthly(asset);
  if (rows.length < 24) throw new Error("history too short");
  const closes = rows.map((row) => Number(row.close || 0)).filter((close) => close > 0);
  const monthlyReturns = closes.map((close, index) => index === 0 ? 0 : (close / closes[index - 1]!) - 1).slice(1);
  const years = yearsBetween(rows[0]!.date, rows.at(-1)!.date);
  const observationsPerYear = years > 0 ? monthlyReturns.length / years : 12;
  const totalReturn = pct(closes[0]!, closes.at(-1)!);
  const cagr = ((closes.at(-1)! / closes[0]!) ** (1 / years) - 1) * 100;
  const maxDd = maxDrawdown(closes);
  const vol = std(monthlyReturns) * Math.sqrt(observationsPerYear) * 100;
  const sharpeLike = vol > 0 ? cagr / vol : 0;
  const recovery = Math.round(maxRecoveryMonths(closes) / Math.max(0.1, observationsPerYear) * 12);
  const behavior = classifyAsset(asset, { cagr, maxDd, vol, recovery, years });
  const knowledgeScore = Math.max(0, Math.min(100, 50 + cagr * 1.8 + sharpeLike * 12 + Math.max(maxDd, -80) * 0.35 - Math.max(recovery - 36, 0) * 0.25));
  return {
    symbol: asset.symbol,
    name: asset.name,
    class: asset.class,
    region: asset.region,
    source: "yahoo_chart_monthly",
    first_date: rows[0]?.date,
    last_date: rows.at(-1)?.date,
    observations: rows.length,
    years: round(years, 2),
    total_return_pct: round(totalReturn, 4),
    cagr_pct: round(cagr, 4),
    volatility_annual_pct: round(vol, 4),
    max_drawdown_pct: round(maxDd, 4),
    max_recovery_months: recovery,
    return_1y_pct: sliceReturnYears(rows, 1),
    return_3y_pct: sliceReturnYears(rows, 3),
    return_5y_pct: sliceReturnYears(rows, 5),
    return_10y_pct: sliceReturnYears(rows, 10),
    best_month_pct: round(Math.max(...monthlyReturns) * 100, 4),
    worst_month_pct: round(Math.min(...monthlyReturns) * 100, 4),
    sharpe_like: round(sharpeLike, 4),
    behavior,
    knowledge_score: round(knowledgeScore, 4),
    nyra_rule: ruleForAsset(asset, behavior)
  };
}

function main(): void {
  const universe = readJson<{ assets: UniverseAsset[] }>(UNIVERSE_PATH);
  const assets = [];
  const errors = [];
  for (const asset of universe.assets) {
    try {
      assets.push(analyze(asset));
    } catch (error) {
      errors.push({ symbol: asset.symbol, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const bySymbol = Object.fromEntries(assets.map((asset) => [asset.symbol, asset]));
  const report = {
    version: "nyra_world_asset_history_study_v1",
    generated_at: new Date().toISOString(),
    status: assets.length ? "completed" : "blocked_no_history",
    source: "Yahoo Finance chart endpoint, monthly range=max, cached locally",
    scanned: assets.length,
    errors,
    assets: assets.sort((a, b) => b.knowledge_score - a.knowledge_score),
    by_symbol: bySymbol,
    runtime_rules: [
      "Prima di entrare, Nyra deve chiedere: questo asset storicamente e growth, difesa, duration, commodity shock o alta volatilita?",
      "Se il paper e in perdita, non basta bloccare tutto: cercare asset non correlati con storia coerente e size esplorativa.",
      "Asset con drawdown storico profondo richiedono size piu piccola anche se lo scan recente e positivo.",
      "Asset con recuperi storici lunghi non devono essere caricati pesantemente vicino a euforia o deterioramento.",
      "La memoria storica non sostituisce il prezzo live: filtra e corregge la scelta, non garantisce profitto."
    ]
  };
  writeJson(REPORT_PATH, report);
  writeJson(RUNTIME_PATH, report);
  console.log(JSON.stringify({
    ok: true,
    report_path: REPORT_PATH,
    runtime_path: RUNTIME_PATH,
    scanned: report.scanned,
    top: report.assets.slice(0, 8).map((asset) => ({
      symbol: asset.symbol,
      behavior: asset.behavior,
      cagr_pct: asset.cagr_pct,
      max_drawdown_pct: asset.max_drawdown_pct,
      knowledge_score: asset.knowledge_score
    })),
    errors: errors.slice(0, 5)
  }, null, 2));
}

main();

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type UniverseAsset = {
  symbol: string;
  yahoo?: string;
  stooq?: string;
  coinbase?: string;
  name: string;
  class: string;
  region: string;
};

type MarketRow = {
  symbol: string;
  name: string;
  class: string;
  region: string;
  source: "yahoo" | "stooq" | "coinbase";
  last_date: string;
  last_price: number;
  return_1d_pct: number;
  return_5d_pct: number;
  return_20d_pct: number;
  volatility_20d_pct: number;
  trend_score: number;
  risk_score: number;
  edge_score: number;
  news_score?: number;
  news_confidence?: number;
  news_thesis_action?: string;
  news_headlines?: Array<{ title: string; link: string; published_at: string; source: string }>;
  action: "candidate" | "watch" | "avoid";
  reason: string;
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const STORAGE_ROOT = process.env.NYRA_STORAGE_ROOT || "";
function storageJoin(...parts: string[]): string {
  return STORAGE_ROOT ? join(STORAGE_ROOT, ...parts) : join(ROOT, ...parts);
}
const UNIVERSE_PATH = join(ROOT, "universal-core", "config", "nyra_world_market_universe.json");
const CACHE_DIR = storageJoin("universal-core", "data", "world-market-cache");
const REPORT_DIR = storageJoin("reports", "universal-core", "financial-core-test");
const REPORT_PATH = join(REPORT_DIR, "nyra_world_market_scan_latest.json");
const RUNTIME_PATH = storageJoin("runtime", "nyra-learning", "nyra_world_market_scan_latest.json");
const NEWS_THESIS_PATH = storageJoin("universal-core", "runtime", "nyra-learning", "nyra_world_news_thesis_latest.json");
const CACHE_TTL_MS = Number(process.env.NYRA_WORLD_MARKET_CACHE_TTL_MS || 15 * 60_000);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function round(value: number, digits = 6): number {
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

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function curl(url: string): string {
  return execFileSync("/usr/bin/curl", ["-fsSL", "-A", "Mozilla/5.0", url], { encoding: "utf8" });
}

function cachePath(asset: UniverseAsset, provider: "yahoo" | "stooq"): string {
  const rawId = provider === "yahoo" ? asset.yahoo : asset.stooq;
  const id = `${provider}_${rawId || asset.symbol}`.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
  return join(CACHE_DIR, `${id}.csv`);
}

function cacheFresh(path: string): boolean {
  if (!existsSync(path)) return false;
  return Date.now() - statSync(path).mtimeMs < CACHE_TTL_MS;
}

function loadYahoo(asset: UniverseAsset): Array<{ date: string; close: number }> {
  if (!asset.yahoo) return [];
  const path = cachePath(asset, "yahoo");
  if (!cacheFresh(path)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    try {
      const encoded = encodeURIComponent(asset.yahoo);
      const raw = curl(`https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=6mo&interval=1d`);
      const parsed = JSON.parse(raw) as {
        chart?: {
          result?: Array<{
            timestamp?: number[];
            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          }>;
          error?: { description?: string };
        };
      };
      const result = parsed.chart?.result?.[0];
      if (!result || parsed.chart?.error) {
        throw new Error(parsed.chart?.error?.description || "Yahoo chart response missing result");
      }
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      const csv = ["Date,Close"].concat(timestamps.map((timestamp, index) => {
        const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
        return `${date},${closes[index] ?? ""}`;
      })).join("\n");
      writeFileSync(path, `${csv}\n`);
    } catch (error) {
      if (!existsSync(path)) throw error;
    }
  }
  const raw = readFileSync(path, "utf8").trim();
  return raw.split(/\r?\n/).slice(1).map((line) => {
    const [date, close] = line.split(",");
    return { date: date ?? "", close: Number(close || 0) };
  }).filter((row) => row.date && row.close > 0);
}

function loadStooqCsv(asset: UniverseAsset): Array<{ date: string; close: number }> {
  if (!asset.stooq) return [];
  const path = cachePath(asset, "stooq");
  if (!cacheFresh(path)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    try {
      const csv = curl(`https://stooq.com/q/d/l/?s=${asset.stooq}&i=d`);
      writeFileSync(path, csv);
    } catch (error) {
      if (!existsSync(path)) throw error;
    }
  }
  const raw = readFileSync(path, "utf8").trim();
  if (raw.includes("Get your apikey") || !raw.toLowerCase().startsWith("date,")) {
    throw new Error("Stooq daily CSV blocked or invalid");
  }
  return raw.split(/\r?\n/).slice(1).map((line) => {
    const [date, , , , close] = line.split(",");
    return { date: date ?? "", close: Number(close || 0) };
  }).filter((row) => row.date && row.close > 0);
}

function loadCoinbase(asset: UniverseAsset): Array<{ date: string; close: number }> {
  if (!asset.coinbase) return [];
  const path = join(CACHE_DIR, `coinbase_${asset.coinbase.replace(/[^a-z0-9_-]/gi, "_").toLowerCase()}.json`);
  if (!cacheFresh(path)) {
    try {
      const raw = curl(`https://api.exchange.coinbase.com/products/${asset.coinbase}/trades?limit=80`);
      writeFileSync(path, raw);
    } catch (error) {
      if (!existsSync(path)) throw error;
    }
  }
  const trades = JSON.parse(readFileSync(path, "utf8")) as Array<{ time?: string; price?: string }>;
  return trades
    .map((trade) => ({ date: String(trade.time || "").slice(0, 10), close: Number(trade.price || 0) }))
    .filter((row) => row.date && row.close > 0)
    .reverse();
}

function pct(from: number, to: number): number {
  return from > 0 ? ((to / from) - 1) * 100 : 0;
}

function loadRows(asset: UniverseAsset): { source: MarketRow["source"]; rows: Array<{ date: string; close: number }> } {
  const attempts: Array<{ source: MarketRow["source"]; load: () => Array<{ date: string; close: number }> }> = [];
  if (asset.yahoo) attempts.push({ source: "yahoo", load: () => loadYahoo(asset) });
  if (asset.stooq) attempts.push({ source: "stooq", load: () => loadStooqCsv(asset) });
  if (asset.coinbase) attempts.push({ source: "coinbase", load: () => loadCoinbase(asset) });
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const rows = attempt.load();
      if (rows.length >= 2) return { source: attempt.source, rows };
      errors.push(`${attempt.source}: insufficient rows`);
    } catch (error) {
      errors.push(`${attempt.source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(errors.join(" | ") || "No market data source configured");
}

function newsForSymbol(newsReport: unknown, symbol: string): Record<string, any> | null {
  const report = newsReport as { by_symbol?: Record<string, Record<string, any>> } | null;
  return report?.by_symbol?.[symbol] ?? null;
}

function analyzeAsset(asset: UniverseAsset, newsReport: unknown): MarketRow | null {
  const { source, rows } = loadRows(asset);
  if (rows.length < 2) return null;
  const closes = rows.map((row) => row.close);
  const last = closes.at(-1) ?? 0;
  const one = closes.at(-2) ?? last;
  const five = closes.at(-6) ?? closes[0] ?? last;
  const twenty = closes.at(-21) ?? closes[0] ?? last;
  const returns = closes.slice(-21).map((close, index, arr) => index === 0 ? 0 : pct(arr[index - 1]!, close)).slice(1);
  const return1 = pct(one, last);
  const return5 = pct(five, last);
  const return20 = pct(twenty, last);
  const vol20 = std(returns);
  const trendScore = clamp(50 + return20 * 2.4 + return5 * 2.8 + return1 * 1.2);
  const riskScore = clamp(vol20 * 12 + Math.max(-return5, 0) * 3 + Math.max(-return20, 0) * 1.8);
  const news = newsForSymbol(newsReport, asset.symbol);
  const newsScore = Number(news?.news_score || 0);
  const newsConfidence = Number(news?.confidence || 0);
  const newsAdjustment = newsConfidence >= 45 ? Math.max(-14, Math.min(14, newsScore * 0.28)) : 0;
  const pullbackCatalystBoost =
    return20 < 0 &&
    ["support_on_pullback", "watch_positive_catalyst"].includes(String(news?.thesis_action || ""))
      ? Math.min(8, Math.abs(return20) * 0.8)
      : 0;
  const edgeScore = clamp(
    trendScore -
      riskScore * 0.55 +
      (return5 > 0 && return20 > 0 ? 8 : 0) -
      (Math.abs(return1) > vol20 * 2.5 ? 6 : 0) +
      newsAdjustment +
      pullbackCatalystBoost
  );
  const action = edgeScore >= 62 && riskScore <= 55 ? "candidate" : edgeScore >= 48 ? "watch" : "avoid";
  const reason = action === "candidate"
    ? `trend positivo con rischio sostenibile${news ? `; news thesis: ${news.thesis_action}` : ""}`
    : action === "watch"
      ? `segnale leggibile ma non ancora abbastanza pulito${news ? `; news thesis: ${news.thesis_action}` : ""}`
      : `edge insufficiente o rischio troppo alto${news ? `; news thesis: ${news.thesis_action}` : ""}`;
  return {
    symbol: asset.symbol,
    name: asset.name,
    class: asset.class,
    region: asset.region,
    source,
    last_date: rows.at(-1)?.date ?? "",
    last_price: round(last, 4),
    return_1d_pct: round(return1, 4),
    return_5d_pct: round(return5, 4),
    return_20d_pct: round(return20, 4),
    volatility_20d_pct: round(vol20, 4),
    trend_score: round(trendScore, 4),
    risk_score: round(riskScore, 4),
    edge_score: round(edgeScore, 4),
    news_score: news ? round(newsScore, 4) : undefined,
    news_confidence: news ? round(newsConfidence, 4) : undefined,
    news_thesis_action: news ? String(news.thesis_action || "neutral") : undefined,
    news_headlines: Array.isArray(news?.headlines)
      ? news.headlines.slice(0, 3).map((item: any) => ({
        title: String(item.title || ""),
        link: String(item.link || ""),
        published_at: String(item.published_at || ""),
        source: String(item.source || ""),
      }))
      : undefined,
    action,
    reason,
  };
}

function main(): void {
  const universe = readJson<{ assets: UniverseAsset[] }>(UNIVERSE_PATH);
  const newsReport = existsSync(NEWS_THESIS_PATH) ? readJson<unknown>(NEWS_THESIS_PATH) : null;
  const rows: MarketRow[] = [];
  const errors: Array<{ symbol: string; error: string }> = [];
  for (const asset of universe.assets) {
    try {
      const row = analyzeAsset(asset, newsReport);
      if (row) rows.push(row);
    } catch (error) {
      errors.push({ symbol: asset.symbol, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const ranked = rows.sort((a, b) => b.edge_score - a.edge_score);
  const candidates = ranked.filter((row) => row.action === "candidate");
  const report = {
    generated_at: new Date().toISOString(),
    runner: "nyra_world_market_scan",
    status: ranked.length ? "completed" : "blocked_no_data",
    universe_size: universe.assets.length,
    scanned: ranked.length,
    errors,
    top_candidates: candidates.slice(0, 10),
    watchlist: ranked.filter((row) => row.action === "watch").slice(0, 15),
    avoid: ranked.filter((row) => row.action === "avoid").slice(0, 15),
    ranked,
    output: {
      best_symbol: ranked[0]?.symbol ?? null,
      best_action: ranked[0]?.action ?? null,
      best_edge_score: ranked[0]?.edge_score ?? null,
      market_breadth_candidates: candidates.length,
      note: "World-market scan is signal discovery, not automatic execution.",
    },
  };
  writeJson(REPORT_PATH, report);
  writeJson(RUNTIME_PATH, report);
  console.log(JSON.stringify({ report_path: REPORT_PATH, runtime_path: RUNTIME_PATH, output: report.output, top_candidates: report.top_candidates.slice(0, 5), errors: errors.slice(0, 5) }, null, 2));
}

main();

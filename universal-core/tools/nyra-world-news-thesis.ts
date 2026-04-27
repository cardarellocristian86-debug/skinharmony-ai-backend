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

type NewsItem = {
  title: string;
  link: string;
  published_at: string;
  source: string;
  positive_hits: string[];
  negative_hits: string[];
  strategic_hits: string[];
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const UNIVERSE_PATH = join(ROOT, "universal-core", "config", "nyra_world_market_universe.json");
const SCAN_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_world_market_scan_latest.json");
const CACHE_DIR = join(ROOT, "universal-core", "data", "world-news-cache");
const REPORT_PATH = join(ROOT, "reports", "universal-core", "nyra-learning", "nyra_world_news_thesis_latest.json");
const RUNTIME_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_world_news_thesis_latest.json");
const CACHE_TTL_MS = Number(process.env.NYRA_WORLD_NEWS_CACHE_TTL_MS || 30 * 60_000);
const MAX_ASSETS = Number(process.env.NYRA_WORLD_NEWS_MAX_ASSETS || 35);

const POSITIVE_TERMS = [
  "beats estimates", "beat estimates", "raises guidance", "raised guidance", "record revenue", "revenue growth",
  "profit rises", "earnings beat", "upgrade", "price target raised", "buyback", "dividend increase",
  "partnership", "strategic partnership", "contract", "wins contract", "deal", "agreement", "acquisition",
  "approval", "launches", "ai demand", "chip demand", "cloud growth", "inflows", "fund inflows"
];

const NEGATIVE_TERMS = [
  "misses estimates", "missed estimates", "cuts guidance", "cut guidance", "downgrade", "price target cut",
  "lawsuit", "probe", "investigation", "sec", "antitrust", "recall", "bankruptcy", "default",
  "layoffs", "margin pressure", "revenue falls", "profit falls", "warning", "outflows", "fund outflows"
];

const STRATEGIC_TERMS = [
  "partnership", "contract", "deal", "agreement", "acquisition", "merger", "investment", "funding",
  "buyback", "guidance", "earnings", "approval", "launches", "expands", "ai", "chips", "semiconductor",
  "cloud", "data center", "energy", "rates", "fed", "oil", "gold", "bitcoin", "etf inflows"
];

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
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

function cacheFresh(path: string): boolean {
  return existsSync(path) && Date.now() - statSync(path).mtimeMs < CACHE_TTL_MS;
}

function cachePath(symbol: string): string {
  return join(CACHE_DIR, `${symbol.replace(/[^a-z0-9_-]/gi, "_").toLowerCase()}_rss.xml`);
}

function curl(url: string): string {
  return execFileSync("/usr/bin/curl", ["-fsSL", "-A", "Mozilla/5.0", url], { encoding: "utf8" });
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1] || "") : "";
}

function findHits(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term));
}

function parseRss(xml: string): NewsItem[] {
  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1] || "");
  return blocks.slice(0, 12).map((block) => {
    const title = tag(block, "title");
    const description = tag(block, "description");
    const text = `${title} ${description}`;
    return {
      title,
      link: tag(block, "link"),
      published_at: tag(block, "pubDate"),
      source: "Yahoo Finance RSS",
      positive_hits: findHits(text, POSITIVE_TERMS),
      negative_hits: findHits(text, NEGATIVE_TERMS),
      strategic_hits: findHits(text, STRATEGIC_TERMS),
    };
  }).filter((item) => item.title);
}

function loadYahooRss(asset: UniverseAsset): NewsItem[] {
  const symbol = asset.yahoo || asset.symbol;
  const path = cachePath(symbol);
  if (!cacheFresh(path)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    const raw = curl(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`);
    writeFileSync(path, raw);
  }
  return parseRss(readFileSync(path, "utf8"));
}

function scoreAsset(asset: UniverseAsset) {
  const items = loadYahooRss(asset);
  const positive = items.reduce((sum, item) => sum + item.positive_hits.length, 0);
  const negative = items.reduce((sum, item) => sum + item.negative_hits.length, 0);
  const strategic = items.reduce((sum, item) => sum + item.strategic_hits.length, 0);
  const recencyBoost = items.slice(0, 3).reduce((sum, item) => sum + item.positive_hits.length * 1.5 - item.negative_hits.length * 1.6, 0);
  const singleStockBoost = asset.class === "single_stock" ? 4 : asset.class.includes("thematic") ? 2 : 0;
  const newsScore = Math.max(-40, Math.min(40, positive * 5 + strategic * 2.2 + recencyBoost + singleStockBoost - negative * 7));
  const confidence = Math.max(0, Math.min(100, 30 + Math.min(items.length, 10) * 5 + strategic * 3 - negative * 2));
  const thesisAction =
    newsScore >= 18 && confidence >= 50
      ? "support_on_pullback"
      : newsScore >= 8
        ? "watch_positive_catalyst"
        : newsScore <= -14
          ? "avoid_or_reduce"
          : "neutral";
  return {
    symbol: asset.symbol,
    name: asset.name,
    class: asset.class,
    region: asset.region,
    status: items.length ? "completed" : "no_news",
    news_score: round(newsScore),
    confidence: round(confidence),
    positive_hit_count: positive,
    negative_hit_count: negative,
    strategic_hit_count: strategic,
    thesis_action: thesisAction,
    thesis_reason: thesisAction === "support_on_pullback"
      ? "notizie/catalizzatori pubblici sostengono la tesi anche se il prezzo arretra"
      : thesisAction === "watch_positive_catalyst"
        ? "ci sono catalizzatori positivi ma non abbastanza forti per aumentare size da soli"
        : thesisAction === "avoid_or_reduce"
          ? "flusso news negativo: non trattare il calo come semplice occasione"
          : "nessun vantaggio informativo pubblico forte",
    headlines: items.slice(0, 6),
  };
}

function selectedAssets(universe: UniverseAsset[]): UniverseAsset[] {
  const scan = readJson<{ ranked?: Array<{ symbol?: string }> }>(SCAN_PATH, { ranked: [] });
  const rankedSymbols = (scan.ranked || []).map((row) => String(row.symbol || "").toUpperCase()).filter(Boolean);
  const ordered = rankedSymbols.length
    ? rankedSymbols.map((symbol) => universe.find((asset) => asset.symbol.toUpperCase() === symbol)).filter(Boolean) as UniverseAsset[]
    : universe;
  const priority = ordered.filter((asset) =>
    asset.class === "single_stock" ||
    asset.class.includes("thematic") ||
    asset.class.includes("sector") ||
    asset.class === "crypto" ||
    asset.class.includes("commodity")
  );
  return [...priority, ...ordered.filter((asset) => !priority.includes(asset))].slice(0, MAX_ASSETS);
}

function main(): void {
  const universe = readJson<{ assets: UniverseAsset[] }>(UNIVERSE_PATH, { assets: [] });
  const assets = selectedAssets(universe.assets);
  const rows = [];
  const errors = [];
  for (const asset of assets) {
    try {
      rows.push(scoreAsset(asset));
    } catch (error) {
      errors.push({ symbol: asset.symbol, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const bySymbol = Object.fromEntries(rows.map((row) => [row.symbol, row]));
  const report = {
    version: "nyra_world_news_thesis_v1",
    generated_at: new Date().toISOString(),
    status: rows.length ? "completed" : "blocked_no_news",
    source: "Yahoo Finance RSS public headlines, cached locally. News is thesis support, not certainty.",
    scanned: rows.length,
    errors,
    assets: rows.sort((a, b) => b.news_score - a.news_score),
    by_symbol: bySymbol,
    rules: [
      "Prezzo in calo + news positiva/catalizzatore = possibile pullback da studiare, non buy automatico.",
      "Prezzo in calo + news negativa = non chiamarlo occasione senza prova contraria.",
      "News e fondamentali correggono lo score tecnico, non sostituiscono rischio, costi e size.",
      "Se le fonti non rispondono, Nyra deve dichiarare dati news mancanti e restare su storico/prezzo."
    ]
  };
  writeJson(REPORT_PATH, report);
  writeJson(RUNTIME_PATH, report);
  console.log(JSON.stringify({
    ok: true,
    report_path: REPORT_PATH,
    runtime_path: RUNTIME_PATH,
    scanned: report.scanned,
    top: report.assets.slice(0, 8).map((row) => ({
      symbol: row.symbol,
      news_score: row.news_score,
      confidence: row.confidence,
      thesis_action: row.thesis_action,
    })),
    errors: errors.slice(0, 5)
  }, null, 2));
}

main();

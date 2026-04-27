import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type BlindCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BlindAssetSeries = {
  symbol: string;
  source_file: string;
  source_kind: "json" | "csv";
  candles: BlindCandle[];
};

type BlindAssetManifestEntry = {
  symbol: string;
  kind: "json" | "csv";
  path: string;
  enabled?: boolean;
};

type BlindManifest = {
  schema_version: string;
  description?: string;
  cutoff: string;
  evaluation_window: {
    from: string;
    to: string;
  };
  macro_pack?: {
    kind: "json";
    path: string;
    enabled?: boolean;
  };
  assets: BlindAssetManifestEntry[];
};

export type BlindMacroEntry = {
  date: string;
  category: string;
  label: string;
  value: string;
  impact_bias: "supportive" | "neutral" | "cautious";
};

export type BlindPackValidation = {
  manifest_path: string;
  cutoff: string;
  evaluation_window: {
    from: string;
    to: string;
  };
  macro_pack?: {
    source_file: string;
    entries: BlindMacroEntry[];
  };
  skipped_macro_pack?: {
    source_file: string;
    reason: string;
  };
  valid_assets: BlindAssetSeries[];
  skipped_assets: Array<{
    symbol: string;
    source_file: string;
    reason: string;
  }>;
};

const ROOT = join(process.cwd(), "..");
const DEFAULT_MANIFEST_PATH = join(ROOT, "datasets", "wall_street_blind_frozen", "manifest.json");

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeTimestamp(value: string): string {
  if (value.includes("T")) return value;
  return `${value}T00:00:00.000Z`;
}

function isValidCandle(value: BlindCandle): boolean {
  return Boolean(
    value.timestamp &&
      Number.isFinite(value.open) &&
      Number.isFinite(value.high) &&
      Number.isFinite(value.low) &&
      Number.isFinite(value.close) &&
      Number.isFinite(value.volume) &&
      value.open > 0 &&
      value.high > 0 &&
      value.low > 0 &&
      value.close > 0 &&
      value.volume >= 0,
  );
}

function parseJsonCandles(sourceFile: string): BlindCandle[] {
  const raw = JSON.parse(readFileSync(sourceFile, "utf8")) as Array<Record<string, unknown>>;
  return raw.map((row) => ({
    timestamp: normalizeTimestamp(String(row.timestamp ?? row.date ?? "")),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume ?? 0),
  }));
}

function validateMacroEntries(entries: BlindMacroEntry[], cutoff: string): string | undefined {
  if (!entries.length) return "empty_macro_pack";
  if (entries.some((entry) => !entry.date || !entry.category || !entry.label || !entry.value || !entry.impact_bias)) {
    return "invalid_macro_entries";
  }
  if (entries.some((entry) => entry.date > cutoff)) return "macro_entry_beyond_cutoff";
  return undefined;
}

function parseCsvCandles(sourceFile: string): BlindCandle[] {
  const raw = readFileSync(sourceFile, "utf8").trim();
  if (!raw || raw.startsWith("Edge: Too Many Requests")) {
    throw new Error("invalid_or_rate_limited_csv");
  }
  const lines = raw.split(/\r?\n/);
  const header = (lines[0] ?? "").split(",").map((entry) => entry.trim().toLowerCase());
  const dateIndex = header.findIndex((entry) => entry === "date" || entry === "timestamp");
  const openIndex = header.indexOf("open");
  const highIndex = header.indexOf("high");
  const lowIndex = header.indexOf("low");
  const closeIndex = header.indexOf("close");
  const volumeIndex = header.indexOf("volume");
  if ([dateIndex, openIndex, highIndex, lowIndex, closeIndex, volumeIndex].some((index) => index < 0)) {
    throw new Error("csv_missing_required_columns");
  }
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    return {
      timestamp: normalizeTimestamp(cols[dateIndex] ?? ""),
      open: parseNumber(cols[openIndex] ?? ""),
      high: parseNumber(cols[highIndex] ?? ""),
      low: parseNumber(cols[lowIndex] ?? ""),
      close: parseNumber(cols[closeIndex] ?? ""),
      volume: round(parseNumber(cols[volumeIndex] ?? ""), 2),
    };
  });
}

function validateSeries(series: BlindAssetSeries, cutoff: string, evaluationFrom: string, evaluationTo: string): string | undefined {
  if (series.candles.length < 200) return "too_few_rows";
  if (series.candles.some((candle) => !isValidCandle(candle))) return "invalid_candle_rows";
  const sorted = [...series.candles].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  if (sorted[0]!.timestamp.slice(0, 10) > "2024-01-31") return "missing_early_2024_history";
  if (!sorted.some((candle) => candle.timestamp.slice(0, 10) <= cutoff)) return "missing_cutoff_window";
  if (!sorted.some((candle) => candle.timestamp.slice(0, 10) >= evaluationFrom && candle.timestamp.slice(0, 10) <= evaluationTo)) {
    return "missing_2025_evaluation_window";
  }
  return undefined;
}

export function loadWallStreetBlindPack(manifestPath = DEFAULT_MANIFEST_PATH): BlindPackValidation {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BlindManifest;
  const manifestDir = dirname(manifestPath);
  const validAssets: BlindAssetSeries[] = [];
  const skippedAssets: BlindPackValidation["skipped_assets"] = [];
  let macroPack: BlindPackValidation["macro_pack"] | undefined;
  let skippedMacroPack: BlindPackValidation["skipped_macro_pack"] | undefined;

  if (manifest.macro_pack?.enabled !== false) {
    const macroSource = resolve(manifestDir, manifest.macro_pack?.path ?? "");
    if (!existsSync(macroSource)) {
      skippedMacroPack = { source_file: macroSource, reason: "missing_macro_pack" };
    } else {
      try {
        const raw = JSON.parse(readFileSync(macroSource, "utf8")) as { entries?: BlindMacroEntry[] };
        const entries = raw.entries ?? [];
        const error = validateMacroEntries(entries, manifest.cutoff);
        if (error) skippedMacroPack = { source_file: macroSource, reason: error };
        else macroPack = { source_file: macroSource, entries };
      } catch (error) {
        skippedMacroPack = {
          source_file: macroSource,
          reason: error instanceof Error ? error.message : "invalid_macro_pack",
        };
      }
    }
  }

  for (const asset of manifest.assets.filter((entry) => entry.enabled !== false)) {
    const sourceFile = resolve(manifestDir, asset.path);
    if (!existsSync(sourceFile)) {
      skippedAssets.push({ symbol: asset.symbol, source_file: sourceFile, reason: "missing_source_file" });
      continue;
    }
    try {
      const candles = asset.kind === "json" ? parseJsonCandles(sourceFile) : parseCsvCandles(sourceFile);
      const series: BlindAssetSeries = {
        symbol: asset.symbol,
        source_file: sourceFile,
        source_kind: asset.kind,
        candles,
      };
      const error = validateSeries(series, manifest.cutoff, manifest.evaluation_window.from, manifest.evaluation_window.to);
      if (error) {
        skippedAssets.push({ symbol: asset.symbol, source_file: sourceFile, reason: error });
        continue;
      }
      validAssets.push(series);
    } catch (error) {
      skippedAssets.push({
        symbol: asset.symbol,
        source_file: sourceFile,
        reason: error instanceof Error ? error.message : "unknown_parse_error",
      });
    }
  }

  return {
    manifest_path: manifestPath,
    cutoff: manifest.cutoff,
    evaluation_window: manifest.evaluation_window,
    macro_pack: macroPack,
    skipped_macro_pack: skippedMacroPack,
    valid_assets: validAssets,
    skipped_assets: skippedAssets,
  };
}

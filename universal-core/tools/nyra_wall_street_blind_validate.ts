import { loadWallStreetBlindPack } from "./nyra_wall_street_blind_pack.ts";

function main() {
  const pack = loadWallStreetBlindPack();
  console.log(JSON.stringify({
    ok: true,
    manifest_path: pack.manifest_path,
    cutoff: pack.cutoff,
    evaluation_window: pack.evaluation_window,
    macro_pack: pack.macro_pack
      ? {
          source_file: pack.macro_pack.source_file,
          entries: pack.macro_pack.entries.length,
        }
      : null,
    skipped_macro_pack: pack.skipped_macro_pack ?? null,
    valid_assets: pack.valid_assets.map((asset) => ({
      symbol: asset.symbol,
      source_file: asset.source_file,
      rows: asset.candles.length,
      from: asset.candles[0]?.timestamp,
      to: asset.candles[asset.candles.length - 1]?.timestamp,
    })),
    skipped_assets: pack.skipped_assets,
  }, null, 2));
}

main();

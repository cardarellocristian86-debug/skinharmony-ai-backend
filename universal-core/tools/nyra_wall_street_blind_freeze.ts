import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type BlindReport = {
  generated_at: string;
  protocol: string;
  summary: {
    direction_accuracy_pct: number;
    volatility_accuracy_pct: number;
    drawdown_accuracy_pct: number;
    blended_score_pct: number;
  };
};

const ROOT = join(process.cwd(), "..");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "wall-street-blind");
const SNAPSHOT_DIR = join(ROOT, "runtime", "nyra");
const LATEST_JSON = join(REPORT_DIR, "nyra_wall_street_blind_latest.json");
const LATEST_MD = join(REPORT_DIR, "nyra_wall_street_blind_latest.md");
const ARCHIVE_DIR = join(REPORT_DIR, "archive");
const BASELINE_JSON = join(SNAPSHOT_DIR, "NYRA_WALL_STREET_BLIND_BASELINE.json");

function freezeTimestamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

function main() {
  if (!existsSync(LATEST_JSON) || !existsSync(LATEST_MD)) {
    throw new Error("latest blind report missing");
  }

  const report = JSON.parse(readFileSync(LATEST_JSON, "utf8")) as BlindReport;
  const stamp = freezeTimestamp(report.generated_at);
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const archivedJson = join(ARCHIVE_DIR, `nyra_wall_street_blind_${stamp}.json`);
  const archivedMd = join(ARCHIVE_DIR, `nyra_wall_street_blind_${stamp}.md`);

  copyFileSync(LATEST_JSON, archivedJson);
  copyFileSync(LATEST_MD, archivedMd);

  writeFileSync(
    BASELINE_JSON,
    JSON.stringify(
      {
        frozen_at: new Date().toISOString(),
        source_report_generated_at: report.generated_at,
        protocol: report.protocol,
        baseline_summary: report.summary,
        archived_json: archivedJson,
        archived_md: archivedMd,
      },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseline: BASELINE_JSON,
        archived_json: archivedJson,
        archived_md: archivedMd,
        summary: report.summary,
      },
      null,
      2,
    ),
  );
}

main();

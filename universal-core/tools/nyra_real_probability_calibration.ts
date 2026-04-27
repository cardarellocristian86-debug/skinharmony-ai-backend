import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWallStreetBlindHarness } from "./nyra_wall_street_blind.ts";
import { runOilGeopoliticalBlindHarness } from "./nyra_oil_geopolitical_blind.ts";

type BinaryEvent = {
  id: string;
  domain: "wall_street_blind" | "oil_geopolitical_blind";
  prompt: string;
  predicted_probability: number;
  realized: 0 | 1;
  confidence_band: string;
};

type CalibrationBucket = {
  band: string;
  count: number;
  avg_predicted_probability: number;
  realized_frequency: number;
  brier_score: number;
};

type CalibrationReport = {
  generated_at: string;
  runner: "nyra_real_probability_calibration";
  protocol: "frozen_real_events_probability_test";
  events: BinaryEvent[];
  metrics: {
    events: number;
    accuracy_pct: number;
    avg_probability: number;
    realized_rate: number;
    brier_score: number;
    log_loss: number;
  };
  calibration_table: CalibrationBucket[];
  verdict: {
    quality: "strong" | "usable" | "weak";
    note: string;
  };
};

type WallStreetBlindReport = ReturnType<typeof runWallStreetBlindHarness>;
type OilBlindReport = ReturnType<typeof runOilGeopoliticalBlindHarness>;

const ROOT = join(process.cwd(), "..");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const OUTPUT_PATH = join(REPORT_DIR, "nyra_real_probability_calibration_latest.json");

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function softmaxProbabilities(scores: Record<string, number>): Record<string, number> {
  const entries = Object.entries(scores);
  const maxScore = Math.max(...entries.map(([, score]) => score));
  const exps = entries.map(([, score]) => Math.exp(score - maxScore));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(entries.map(([label], index) => [label, exps[index] / total]));
}

function probabilityBand(probability: number): string {
  if (probability >= 0.8) return "80-100%";
  if (probability >= 0.6) return "60-79%";
  if (probability >= 0.4) return "40-59%";
  if (probability >= 0.2) return "20-39%";
  return "0-19%";
}

function directionFromScenario(scenario: string): "up" | "down" | "flat" {
  if (scenario === "bullish" || scenario === "cautious_bullish") return "up";
  if (scenario === "bearish") return "down";
  return "flat";
}

function buildWallStreetEvents(report: WallStreetBlindReport): BinaryEvent[] {
  return report.predictions.map((prediction, index) => {
    const evaluation = report.evaluations[index]!;
    const probs = softmaxProbabilities(prediction.candidate_scores);
    const selectedScenario = prediction.selected_scenario;
    const selectedProbability = probs[selectedScenario] ?? 0;
    const selectedDirection = directionFromScenario(selectedScenario);
    const realized = selectedDirection === evaluation.actual_direction ? 1 : 0;

    return {
      id: `wall_street:${prediction.symbol}`,
      domain: "wall_street_blind",
      prompt: `${prediction.symbol} blind thesis=${selectedScenario} actual_direction=${evaluation.actual_direction}`,
      predicted_probability: round(selectedProbability),
      realized,
      confidence_band: probabilityBand(selectedProbability),
    };
  });
}

function buildOilEvents(report: OilBlindReport): BinaryEvent[] {
  const probs = softmaxProbabilities(report.prediction.candidate_scores);
  const selectedScenario = report.prediction.selected_scenario;
  const selectedProbability = probs[selectedScenario] ?? 0;
  const realized =
    selectedScenario === "bullish_limited"
      ? 1
      : 0;

  return [
    {
      id: "oil:selected_thesis",
      domain: "oil_geopolitical_blind",
      prompt: `Brent frozen 2024-04-12 thesis=${selectedScenario}`,
      predicted_probability: round(selectedProbability),
      realized,
      confidence_band: probabilityBand(selectedProbability),
    },
  ];
}

function brierScore(events: BinaryEvent[]): number {
  return round(average(events.map((event) => (event.predicted_probability - event.realized) ** 2)));
}

function logLoss(events: BinaryEvent[]): number {
  const epsilon = 1e-6;
  return round(
    -average(
      events.map((event) => {
        const p = Math.min(Math.max(event.predicted_probability, epsilon), 1 - epsilon);
        return event.realized === 1 ? Math.log(p) : Math.log(1 - p);
      }),
    ),
  );
}

function buildCalibrationTable(events: BinaryEvent[]): CalibrationBucket[] {
  const bands = ["0-19%", "20-39%", "40-59%", "60-79%", "80-100%"];
  return bands
    .map((band) => {
      const bucket = events.filter((event) => event.confidence_band === band);
      if (!bucket.length) {
        return {
          band,
          count: 0,
          avg_predicted_probability: 0,
          realized_frequency: 0,
          brier_score: 0,
        };
      }
      return {
        band,
        count: bucket.length,
        avg_predicted_probability: round(average(bucket.map((event) => event.predicted_probability))),
        realized_frequency: round(average(bucket.map((event) => event.realized))),
        brier_score: round(average(bucket.map((event) => (event.predicted_probability - event.realized) ** 2))),
      };
    })
    .filter((bucket) => bucket.count > 0);
}

export function runRealProbabilityCalibration(): CalibrationReport {
  const wallStreet = runWallStreetBlindHarness();
  const oil = runOilGeopoliticalBlindHarness();
  const events = [...buildWallStreetEvents(wallStreet), ...buildOilEvents(oil)];
  const accuracy = average(events.map((event) => (event.predicted_probability >= 0.5 ? 1 : 0) === event.realized ? 1 : 0));
  const brier = brierScore(events);
  const report: CalibrationReport = {
    generated_at: new Date().toISOString(),
    runner: "nyra_real_probability_calibration",
    protocol: "frozen_real_events_probability_test",
    events,
    metrics: {
      events: events.length,
      accuracy_pct: round(accuracy * 100, 4),
      avg_probability: round(average(events.map((event) => event.predicted_probability))),
      realized_rate: round(average(events.map((event) => event.realized))),
      brier_score: brier,
      log_loss: logLoss(events),
    },
    calibration_table: buildCalibrationTable(events),
    verdict: {
      quality: brier <= 0.12 ? "strong" : brier <= 0.22 ? "usable" : "weak",
      note:
        brier <= 0.12
          ? "probabilita ben calibrate sui frozen real events disponibili"
          : brier <= 0.22
            ? "probabilita utili ma ancora da calibrare meglio"
            : "probabilita troppo rumorose per fiducia alta",
    },
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runRealProbabilityCalibration(), null, 2));
}

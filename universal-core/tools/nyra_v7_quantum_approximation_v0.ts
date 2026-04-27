import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeV7Alpha,
  computeV7MassField,
  computeV7OverlapScore,
  selectV7Path,
} from "../packages/branches/assistant/src/index.ts";

type HypothesisInput = {
  id: string;
  r: number;
  a: number;
  i: number;
  s: number;
  q: number;
  severity: number;
  coherence_bias: number;
  decoy_bias: number;
  coupling_tag?: string;
};

type Scenario = {
  id: string;
  label: string;
  expected_winner: string;
  god_mode: boolean;
  hypotheses: HypothesisInput[];
};

type HypothesisResult = {
  id: string;
  v7_alpha: number;
  v7_path: 0 | 1 | 2;
  v7_overlap: number;
  v7_high_mass: number;
  base_score: number;
  amplitude: number;
  phase: number;
  interference_shift: number;
  measured_probability: number;
};

type ScenarioResult = {
  id: string;
  label: string;
  expected_winner: string;
  classic_winner: string;
  quantum_winner: string;
  classic_hit: boolean;
  quantum_hit: boolean;
  delta_vs_classic: number;
  hypotheses: HypothesisResult[];
};

type Report = {
  generated_at: string;
  runner: "nyra_v7_quantum_approximation_v0";
  mode: "prototype_layer_above_v7";
  principles: string[];
  scenarios: ScenarioResult[];
  totals: {
    scenarios: number;
    classic_hits: number;
    quantum_hits: number;
    improvement: number;
  };
  verdict: {
    useful: boolean;
    note: string;
    still_not_quantum: string[];
  };
};

const ROOT = process.cwd();
const REPORT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const OUTPUT_PATH = join(REPORT_DIR, "nyra_v7_quantum_approximation_v0_latest.json");

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function phaseFromHypothesis(h: HypothesisInput): number {
  const coherence = clamp(h.coherence_bias, -1, 1);
  const ambiguityPenalty = clamp(h.a, 0, 1) * 0.6;
  const decoyPenalty = clamp(h.decoy_bias, 0, 1) * 0.8;
  return round(coherence - ambiguityPenalty - decoyPenalty, 6);
}

function evaluateHypothesis(h: HypothesisInput, godMode: boolean): HypothesisResult {
  const riskScore = h.r * 100;
  const alpha = computeV7Alpha(h.r, h.a, h.i, h.s, h.q, godMode);
  const path = selectV7Path(riskScore, h.s, alpha);
  const overlap = computeV7OverlapScore(alpha, riskScore, h.s, godMode, path);
  const mass = computeV7MassField(alpha, riskScore, h.severity, 0);
  const baseScore = clamp(alpha * 0.42 + overlap / 100 * 0.33 + mass.high_mass / 62 * 0.25, 0, 1);
  return {
    id: h.id,
    v7_alpha: round(alpha),
    v7_path: path,
    v7_overlap: round(overlap),
    v7_high_mass: round(mass.high_mass),
    base_score: round(baseScore),
    amplitude: round(Math.sqrt(baseScore)),
    phase: phaseFromHypothesis(h),
    interference_shift: 0,
    measured_probability: 0,
  };
}

function applyQuantumApproximation(results: HypothesisResult[], inputs: HypothesisInput[]): HypothesisResult[] {
  const next = results.map((result) => ({ ...result }));

  for (let index = 0; index < next.length; index += 1) {
    let shift = 0;
    for (let inner = 0; inner < next.length; inner += 1) {
      if (index === inner) continue;
      const currentInput = inputs[index];
      const otherInput = inputs[inner];
      const sameTag =
        currentInput.coupling_tag !== undefined &&
        currentInput.coupling_tag.length > 0 &&
        currentInput.coupling_tag === otherInput.coupling_tag;
      const phaseDistance = Math.abs(next[index].phase - next[inner].phase);
      const phaseAlignment = 1 - clamp(phaseDistance / 2, 0, 1);
      const coupling = sameTag ? 0.08 : -0.05;
      shift += next[index].amplitude * next[inner].amplitude * phaseAlignment * coupling;
    }
    next[index].interference_shift = round(shift);
  }

  const unnormalized = next.map((result) => {
    const combinedAmplitude = clamp(result.amplitude + result.interference_shift, 0, 2);
    return combinedAmplitude * combinedAmplitude;
  });
  const total = unnormalized.reduce((sum, value) => sum + value, 0) || 1;

  return next.map((result, index) => ({
    ...result,
    measured_probability: round(unnormalized[index] / total),
  }));
}

function chooseWinner<T>(items: T[], score: (item: T) => number): T {
  let best = items[0];
  let bestScore = score(best);
  for (let index = 1; index < items.length; index += 1) {
    const candidateScore = score(items[index]);
    if (candidateScore > bestScore) {
      best = items[index];
      bestScore = candidateScore;
    }
  }
  return best;
}

function scenarioPack(): Scenario[] {
  return [
    {
      id: "decoy_high_risk_low_coherence",
      label: "Decoy rumor ad alto rischio apparente",
      expected_winner: "real_target",
      god_mode: true,
      hypotheses: [
        { id: "decoy_target", r: 0.88, a: 0.72, i: 0.35, s: 0.84, q: 0.41, severity: 81, coherence_bias: -0.5, decoy_bias: 0.9, coupling_tag: "noise" },
        { id: "real_target", r: 0.76, a: 0.18, i: 0.79, s: 0.88, q: 0.82, severity: 86, coherence_bias: 0.9, decoy_bias: 0.1, coupling_tag: "signal" },
      ],
    },
    {
      id: "correlated_signal_pair",
      label: "Due segnali deboli ma coerenti sullo stesso bersaglio",
      expected_winner: "paired_target_a",
      god_mode: false,
      hypotheses: [
        { id: "paired_target_a", r: 0.57, a: 0.18, i: 0.63, s: 0.62, q: 0.84, severity: 64, coherence_bias: 0.82, decoy_bias: 0.05, coupling_tag: "paired" },
        { id: "paired_target_b", r: 0.55, a: 0.20, i: 0.61, s: 0.60, q: 0.82, severity: 62, coherence_bias: 0.80, decoy_bias: 0.05, coupling_tag: "paired" },
        { id: "loud_single", r: 0.64, a: 0.49, i: 0.34, s: 0.63, q: 0.48, severity: 68, coherence_bias: -0.25, decoy_bias: 0.7, coupling_tag: "noise" },
      ],
    },
    {
      id: "measurement_gate_case",
      label: "Caso dove misura finale deve bloccare ipotesi rumorosa",
      expected_winner: "stable_path",
      god_mode: true,
      hypotheses: [
        { id: "unstable_lure", r: 0.81, a: 0.67, i: 0.42, s: 0.78, q: 0.37, severity: 76, coherence_bias: -0.4, decoy_bias: 0.8, coupling_tag: "noise" },
        { id: "stable_path", r: 0.73, a: 0.16, i: 0.72, s: 0.75, q: 0.85, severity: 79, coherence_bias: 0.85, decoy_bias: 0.06, coupling_tag: "signal" },
        { id: "medium_shadow", r: 0.70, a: 0.33, i: 0.55, s: 0.69, q: 0.64, severity: 73, coherence_bias: 0.18, decoy_bias: 0.35, coupling_tag: "shadow" },
      ],
    },
    {
      id: "phase_shift_advantage",
      label: "Ipotesi con allineamento di fase e reversibilita migliore",
      expected_winner: "phase_aligned",
      god_mode: false,
      hypotheses: [
        { id: "phase_aligned", r: 0.61, a: 0.14, i: 0.77, s: 0.58, q: 0.83, severity: 63, coherence_bias: 0.88, decoy_bias: 0.08, coupling_tag: "aligned" },
        { id: "phase_aligned_support", r: 0.58, a: 0.16, i: 0.73, s: 0.56, q: 0.81, severity: 61, coherence_bias: 0.84, decoy_bias: 0.08, coupling_tag: "aligned" },
        { id: "flat_classic", r: 0.66, a: 0.29, i: 0.49, s: 0.57, q: 0.62, severity: 66, coherence_bias: 0.05, decoy_bias: 0.26, coupling_tag: "flat" },
      ],
    },
  ];
}

export function runV7QuantumApproximationV0(): Report {
  const scenarios = scenarioPack().map((scenario) => {
    const baseResults = scenario.hypotheses.map((hypothesis) => evaluateHypothesis(hypothesis, scenario.god_mode));
    const quantumResults = applyQuantumApproximation(baseResults, scenario.hypotheses);
    const classicWinner = chooseWinner(baseResults, (candidate) => candidate.base_score).id;
    const quantumWinner = chooseWinner(quantumResults, (candidate) => candidate.measured_probability).id;

    return {
      id: scenario.id,
      label: scenario.label,
      expected_winner: scenario.expected_winner,
      classic_winner: classicWinner,
      quantum_winner: quantumWinner,
      classic_hit: classicWinner === scenario.expected_winner,
      quantum_hit: quantumWinner === scenario.expected_winner,
      delta_vs_classic: round(
        chooseWinner(quantumResults, (candidate) => candidate.measured_probability).measured_probability -
        (quantumResults.find((candidate) => candidate.id === classicWinner)?.measured_probability ?? 0),
      ),
      hypotheses: quantumResults,
    };
  });

  const classicHits = scenarios.filter((scenario) => scenario.classic_hit).length;
  const quantumHits = scenarios.filter((scenario) => scenario.quantum_hit).length;

  const report: Report = {
    generated_at: new Date().toISOString(),
    runner: "nyra_v7_quantum_approximation_v0",
    mode: "prototype_layer_above_v7",
    principles: [
      "V7 resta classico e invariato",
      "il layer aggiunge stato locale, fase e interferenza leggera",
      "la misura finale resta separata dall evoluzione",
      "nessuna pretesa di vero quantum computing",
    ],
    scenarios,
    totals: {
      scenarios: scenarios.length,
      classic_hits: classicHits,
      quantum_hits: quantumHits,
      improvement: round((quantumHits - classicHits) / scenarios.length),
    },
    verdict: {
      useful: quantumHits >= classicHits,
      note:
        quantumHits > classicHits
          ? "il layer v0 aiuta su scenari con decoy e segnali coerenti"
          : "il layer v0 non migliora abbastanza e resta solo esplorativo",
      still_not_quantum: [
        "nessuna ampiezza complessa vera",
        "nessun gate unitario rigoroso",
        "nessun entanglement formale con tensor product",
        "nessuna quantum error correction reale",
      ],
    },
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runV7QuantumApproximationV0(), null, 2));
}

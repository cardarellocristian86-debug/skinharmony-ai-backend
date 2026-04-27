import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";

type RelativityPack = {
  equation_rules: string[];
};

type FrameworkId = "string_theory" | "loop_quantum_gravity" | "asymptotic_safety";

type FrameworkModel = {
  id: FrameworkId;
  label: string;
  anomalies: {
    score: number;
    note: string;
  };
  free_parameters: {
    score: number;
    note: string;
  };
  gr_limit: {
    score: number;
    note: string;
  };
  conservation_invariance: {
    score: number;
    note: string;
  };
  structural_notes: string[];
};

export type QuantumGravityFrameworkCompareReport = {
  generated_at: string;
  runner: "nyra_quantum_gravity_framework_compare";
  pack_loaded: boolean;
  criteria: string[];
  weights: {
    anomalies: number;
    free_parameters: number;
    gr_limit: number;
    conservation_invariance: number;
  };
  selected_framework: FrameworkId;
  selected_label: string;
  core_state: string;
  core_confidence: number;
  probabilities: Array<{
    framework_id: FrameworkId;
    probability: number;
  }>;
  frameworks: Array<{
    id: FrameworkId;
    label: string;
    anomalies_score: number;
    free_parameters_score: number;
    gr_limit_score: number;
    conservation_invariance_score: number;
    total_score: number;
    structural_notes: string[];
  }>;
  nyra_voice: {
    verdict: string;
    caution: string;
  };
};

const ROOT = process.cwd();
const WORKSPACE_ROOT = join(ROOT, "..");
const PACK_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_relativity_learning_pack_latest.json");
const OUTPUT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const OUTPUT_PATH = join(OUTPUT_DIR, "nyra_quantum_gravity_framework_compare_latest.json");
const SNAPSHOT_DIR = join(WORKSPACE_ROOT, "runtime", "nyra");
const SNAPSHOT_PATH = join(SNAPSHOT_DIR, "NYRA_QUANTUM_GRAVITY_FRAMEWORK_COMPARE_SNAPSHOT.json");

const WEIGHTS = {
  anomalies: 0.30,
  free_parameters: 0.20,
  gr_limit: 0.30,
  conservation_invariance: 0.20,
} as const;

function loadPack(): RelativityPack | undefined {
  if (!existsSync(PACK_PATH)) return undefined;
  return JSON.parse(readFileSync(PACK_PATH, "utf8")) as RelativityPack;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function frameworks(): FrameworkModel[] {
  return [
    {
      id: "string_theory",
      label: "String Theory",
      anomalies: {
        score: 92,
        note: "La cancellazione delle anomalie e uno dei suoi punti piu forti nella formulazione coerente.",
      },
      free_parameters: {
        score: 42,
        note: "Lo spazio dei vacua e la flessibilita di compattificazione rendono il controllo dei parametri molto meno stretto.",
      },
      gr_limit: {
        score: 91,
        note: "Recupera bene il gravitone e il limite di relativita generale a bassa energia.",
      },
      conservation_invariance: {
        score: 93,
        note: "La struttura gauge, covariante e di consistenza quantistica e molto forte.",
      },
      structural_notes: [
        "forza alta su consistenza matematica e anomalie",
        "punto debole sul numero effettivo di realizzazioni e parametri emergenti",
        "ottimo recupero del limite GR a bassa energia",
      ],
    },
    {
      id: "loop_quantum_gravity",
      label: "Loop Quantum Gravity",
      anomalies: {
        score: 71,
        note: "Molto rigorosa su quantizzazione background-independent, ma il quadro completo delle anomalie/chiusure e meno chiuso del caso stringa.",
      },
      free_parameters: {
        score: 74,
        note: "Ha meno flessibilita parametrica macroscopia del landscape stringa, anche se restano scelte strutturali non banali.",
      },
      gr_limit: {
        score: 63,
        note: "Il recupero completo e non ambiguo della relativita generale classica su larga scala resta un punto piu delicato.",
      },
      conservation_invariance: {
        score: 86,
        note: "La background independence e coerente col principio di invarianza che vuoi privilegiare.",
      },
      structural_notes: [
        "forza alta su background independence e discrezione geometrica",
        "meno solida del previsto sul recupero universale e pulito del limite GR",
        "piu conservativa di string theory sul lato parametri liberi",
      ],
    },
    {
      id: "asymptotic_safety",
      label: "Asymptotic Safety",
      anomalies: {
        score: 82,
        note: "Non punta sulla cancellazione classica delle anomalie come string theory, ma su una struttura UV consistente attorno a un fixed point.",
      },
      free_parameters: {
        score: 83,
        note: "Se il fixed point UV esiste con poche direzioni rilevanti, il numero di parametri fisici puo restare relativamente contenuto.",
      },
      gr_limit: {
        score: 87,
        note: "Ha un ponte naturale con Einstein-Hilbert e quindi con il limite GR effettivo, pur restando dipendente dalla robustezza del fixed point.",
      },
      conservation_invariance: {
        score: 84,
        note: "Resta vicina alla struttura covariante della GR e alla sua logica di continuita efficace.",
      },
      structural_notes: [
        "molto forte se si privilegia continuita con la GR e parsimonia parametrica",
        "meno spettacolare di string theory sulle anomalie pure, ma piu conservativa",
        "dipende fortemente dalla tenuta reale del fixed point UV",
      ],
    },
  ];
}

function totalScore(model: FrameworkModel): number {
  return Number((
    model.anomalies.score * WEIGHTS.anomalies +
    model.free_parameters.score * WEIGHTS.free_parameters +
    model.gr_limit.score * WEIGHTS.gr_limit +
    model.conservation_invariance.score * WEIGHTS.conservation_invariance
  ).toFixed(2));
}

function softmax(models: Array<FrameworkModel & { total_score: number }>): Array<{ framework_id: FrameworkId; probability: number }> {
  const maxScore = Math.max(...models.map((model) => model.total_score));
  const exps = models.map((model) => Math.exp((model.total_score - maxScore) / 6));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return models.map((model, index) => ({
    framework_id: model.id,
    probability: Number(((exps[index] / total) * 100).toFixed(2)),
  }));
}

function buildCoreInput(models: Array<FrameworkModel & { total_score: number }>): UniversalCoreInput {
  const probabilities = softmax(models);
  const signals: UniversalSignal[] = models.map((model) => {
    const probability = probabilities.find((entry) => entry.framework_id === model.id)?.probability ?? 0;
    const strongestCriterion = Math.max(
      model.anomalies.score,
      model.free_parameters.score,
      model.gr_limit.score,
      model.conservation_invariance.score,
    );
    return {
      id: model.id,
      source: "nyra_quantum_gravity_framework_compare",
      category: "quantum_gravity_framework",
      label: model.label,
      value: model.total_score,
      normalized_score: clamp(model.total_score),
      severity_hint: clamp(model.total_score),
      confidence_hint: clamp(50 + probability * 0.35),
      reliability_hint: clamp(62 + strongestCriterion * 0.18),
      friction_hint: clamp(100 - model.total_score),
      risk_hint: clamp(100 - model.total_score * 0.9),
      reversibility_hint: clamp(30 + model.total_score * 0.5),
      expected_value_hint: clamp(model.total_score),
      evidence: [
        { label: "anomalie", value: model.anomalies.note, weight: 1 },
        { label: "parametri", value: model.free_parameters.note, weight: 0.9 },
        { label: "limite_gr", value: model.gr_limit.note, weight: 1 },
        { label: "invarianza", value: model.conservation_invariance.note, weight: 1 },
        { label: "probabilita", value: probability, unit: "%", weight: 0.7 },
      ],
      tags: ["quantum_gravity_framework", "comparison"],
    };
  });

  return {
    request_id: "nyra-quantum-gravity-framework-compare",
    generated_at: new Date().toISOString(),
    domain: "assistant",
    context: {
      mode: "god_mode",
      locale: "it-IT",
      metadata: {
        scoring_scope: "internal_coherence",
      },
    },
    signals,
    data_quality: {
      score: 94,
      completeness: 100,
      freshness: 100,
      consistency: 94,
      reliability: 93,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: false,
      max_control_level: "suggest",
      safety_mode: true,
    },
  };
}

export function buildQuantumGravityFrameworkCompareReport(): QuantumGravityFrameworkCompareReport {
  const pack = loadPack();
  const scored = frameworks().map((model) => ({
    ...model,
    total_score: totalScore(model),
  }));
  const probabilities = softmax(scored);
  const core = runUniversalCore(buildCoreInput(scored));
  const selectedAction = core.recommended_actions[0];
  const selectedId = selectedAction.id.replace(/^action:/, "") as FrameworkId;
  const selected = scored.find((model) => model.id === selectedId) ?? scored.sort((a, b) => b.total_score - a.total_score)[0];

  return {
    generated_at: new Date().toISOString(),
    runner: "nyra_quantum_gravity_framework_compare",
    pack_loaded: Boolean(pack),
    criteria: [
      "anomalie matematiche",
      "numero di parametri liberi",
      "capacita di recuperare il limite della relativita generale",
      "coerenza con conservazione e invarianza",
    ],
    weights: { ...WEIGHTS },
    selected_framework: selected.id,
    selected_label: selected.label,
    core_state: core.state,
    core_confidence: Number(core.confidence.toFixed(2)),
    probabilities,
    frameworks: scored
      .sort((a, b) => b.total_score - a.total_score)
      .map((model) => ({
        id: model.id,
        label: model.label,
        anomalies_score: model.anomalies.score,
        free_parameters_score: model.free_parameters.score,
        gr_limit_score: model.gr_limit.score,
        conservation_invariance_score: model.conservation_invariance.score,
        total_score: model.total_score,
        structural_notes: model.structural_notes,
      })),
    nyra_voice: {
      verdict:
        selected.id === "asymptotic_safety"
          ? "Con questi criteri il framework piu solido non e quello piu completo in astratto, ma quello che conserva meglio parsimonia, continuita con GR e disciplina strutturale senza esplodere nei parametri."
          : selected.id === "string_theory"
            ? "Con questi criteri vince il framework che porta la consistenza matematica piu forte, anche se paga qualcosa sul lato della parsimonia parametrica."
            : "Con questi criteri emerge il framework che difende meglio l invarianza di fondo, ma paga ancora sul recupero universale del limite classico.",
      caution:
        "Questo ranking misura coerenza interna sotto pesi dichiarati. Non e una prova sperimentale e non chiude il problema della gravita quantistica.",
    },
  };
}

function main(): void {
  const report = buildQuantumGravityFrameworkCompareReport();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();

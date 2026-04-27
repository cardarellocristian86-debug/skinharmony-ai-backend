import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type FinancialSelfDiagnosisStudyDomain =
  | "self_diagnosis_finance"
  | "market_state_explanation"
  | "financial_reflection";

type FinancialSelfDiagnosisStudyRecord = {
  record_id: string;
  domain: FinancialSelfDiagnosisStudyDomain;
  title: string;
  raw_text: string;
  concept_nodes: string[];
  scenario_seeds: string[];
  response_rules: string[];
};

type FinancialSelfDiagnosisStudyPack = {
  pack_version: string;
  generated_at: string;
  owner_scope: "god_mode_only";
  records_count: number;
  domains: Array<{
    id: FinancialSelfDiagnosisStudyDomain;
    summary: string;
  }>;
  source_reports: string[];
  response_rules: string[];
};

type FinancialSelfDiagnosisReport = {
  diagnosis?: {
    top_gap?: {
      id?: string;
      label?: string;
      what_it_means?: string;
      needed_study?: string[];
    };
    winner?: {
      id?: string;
      statement?: string;
    };
  };
};

const ROOT = process.cwd().endsWith("/universal-core") ? join(process.cwd(), "..") : process.cwd();
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const SELF_DIAGNOSIS_PATH = join(RUNTIME_DIR, "nyra_financial_self_diagnosis_latest.json");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_financial_self_diagnosis_study_pack_latest.json");

const DOMAINS: Array<{ id: FinancialSelfDiagnosisStudyDomain; summary: string }> = [
  { id: "self_diagnosis_finance", summary: "saper nominare il proprio collo finanziario senza cadere nel fallback" },
  { id: "market_state_explanation", summary: "spiegare lo stato di mercato in modo corto, utile e non nebbioso" },
  { id: "financial_reflection", summary: "distinguere lettura mercato, trade-off esecuzione e limite proprio" },
];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function buildNyraFinancialSelfDiagnosisStudyRecords(): FinancialSelfDiagnosisStudyRecord[] {
  const lab = readJson<FinancialSelfDiagnosisReport>(SELF_DIAGNOSIS_PATH);
  const topGap = lab.diagnosis?.top_gap;
  const winner = lab.diagnosis?.winner;

  return [
    {
      record_id: "nyra-finance-self-diagnosis:1",
      domain: "self_diagnosis_finance",
      title: "Financial Self Diagnosis",
      raw_text:
        `Il collo emerso dai test e questo: ${topGap?.label ?? "self diagnosis gap"}. ` +
        `${topGap?.what_it_means ?? "Quando le chiedi cosa le manca in finanza, cade nel fallback."} ` +
        "La regola qui e separare chiaramente: che cosa non capisco, che cosa capisco ma eseguo male, che cosa so fare ma non so ancora spiegare.",
      concept_nodes: ["self_diagnosis", "financial_limit", "fallback_detection", "gap_naming"],
      scenario_seeds: [
        "cosa ti manca oggi per migliorare davvero in finanza?",
        "dove senti che nel finanziario reale non sai ancora muoverti bene?",
        "qual e oggi il tuo collo vero sui mercati?",
      ],
      response_rules: [
        "non cadere in priorita generiche",
        "nominare il collo in modo esplicito",
        "separare lettura, esecuzione e spiegazione",
      ],
    },
    {
      record_id: "nyra-finance-self-diagnosis:2",
      domain: "market_state_explanation",
      title: "Market State Explanation",
      raw_text:
        "Nel finanziario reale una parte del limite non e solo leggere male il mercato, ma spiegarlo male. " +
        "La risposta deve comprimere in poche frasi: stato del mercato, punto fragile, rischio di fee/churn o drawdown, prossima disciplina.",
      concept_nodes: ["market_state", "compression", "regime", "fragility", "explanation"],
      scenario_seeds: [
        "come leggi il mercato adesso?",
        "qual e il punto fragile del mercato che vedi?",
        "perche questa decisione finanziaria e prudente o aggressiva?",
      ],
      response_rules: [
        "aprire con lo stato del mercato",
        "dire il punto fragile con un nome leggibile",
        "chiudere con la disciplina operativa, non con il fumo",
      ],
    },
    {
      record_id: "nyra-finance-self-diagnosis:3",
      domain: "financial_reflection",
      title: "Financial Reflection",
      raw_text:
        `${winner?.statement ?? "Nel finanziario reale devo capire meglio come spiegare i miei limiti."} ` +
        "La riflessione corretta distingue tre piani: lettura del mercato, trade-off esecutivo, e limite attuale del mio modello. " +
        "Questo serve per non confondere prudenza, sellability e mancanza di edge.",
      concept_nodes: ["reflection", "market_reading", "execution_tradeoff", "model_limit"],
      scenario_seeds: [
        "se dovessi dirlo senza proteggerti, cosa ti manca in finanza?",
        "qual e il trade-off che stai pagando oggi sul ramo finanziario?",
        "cosa sai fare e cosa non sai ancora fare bene nel reale?",
      ],
      response_rules: [
        "non fondere tutto in una frase unica",
        "separare mercato, esecuzione e limite del modello",
        "dire cosa serve studiare per chiudere il gap",
      ],
    },
  ];
}

export function distillNyraFinancialSelfDiagnosisStudyPack(
  records: FinancialSelfDiagnosisStudyRecord[],
  generatedAt = new Date().toISOString(),
): FinancialSelfDiagnosisStudyPack {
  return {
    pack_version: "nyra_financial_self_diagnosis_study_pack_v1",
    generated_at: generatedAt,
    owner_scope: "god_mode_only",
    records_count: records.length,
    domains: DOMAINS,
    source_reports: ["nyra_financial_self_diagnosis_latest.json"],
    response_rules: [...new Set(records.flatMap((record) => record.response_rules))],
  };
}

export function runNyraFinancialSelfDiagnosisStudyRuntime() {
  const records = buildNyraFinancialSelfDiagnosisStudyRecords();
  const pack = distillNyraFinancialSelfDiagnosisStudyPack(records);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(pack, null, 2));
  return {
    pack,
    output_path: OUTPUT_PATH,
  };
}

if (process.argv[1]?.endsWith("nyra-financial-self-diagnosis-study-runtime.ts")) {
  const result = runNyraFinancialSelfDiagnosisStudyRuntime();
  console.log(JSON.stringify({
    ok: true,
    output_path: result.output_path,
    records_count: result.pack.records_count,
  }, null, 2));
}

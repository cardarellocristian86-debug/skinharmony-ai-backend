import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  NyraFinancialLearningPack,
  NyraFinancialLearningRecord,
} from "../packages/contracts/src/index.ts";
import { distillFinancialLearningPack, saveFinancialLearningPack } from "./nyra-financial-learning-runtime.ts";

export function buildCapitalFeeDrawdownFrontierRecords(): NyraFinancialLearningRecord[] {
  return [
    {
      record_id: "nyra-capital-fee-drawdown-frontier:1",
      domain: "risk_management",
      title: "Capital vs drawdown frontier",
      source_kind: "runtime_focus",
      raw_text:
        "Aumentare il capitale finale non basta da solo. Nyra deve leggere la frontiera tra capitale extra e drawdown extra, e capire quando il secondo cresce troppo rispetto al primo.",
      concept_nodes: ["frontier_tradeoff", "capital_gain", "drawdown_cost", "sellability", "risk_management"],
      vocabulary: ["capitale", "drawdown", "frontier", "gain", "risk", "sellability"],
      scenario_seeds: [
        "confronta capitale extra e drawdown extra prima di promuovere una policy",
        "accetta piu drawdown solo se il premio di capitale e abbastanza forte",
        "tratta la vendibilita come vincolo della frontiera rischio-rendimento",
      ],
      risk_rules: [
        "capitale piu alto non giustifica qualunque drawdown aggiuntivo",
        "una policy vendibile deve migliorare capitale senza rompere la percezione di controllo",
      ],
    },
    {
      record_id: "nyra-capital-fee-drawdown-frontier:2",
      domain: "execution",
      title: "Capital vs fee frontier",
      source_kind: "runtime_focus",
      raw_text:
        "Una policy puo aumentare il capitale lordo ma peggiorare troppo fee e slippage. Nyra deve imparare a leggere il confine in cui il capitale aggiuntivo non giustifica il costo operativo.",
      concept_nodes: ["fee_frontier", "slippage_cost", "execution_drag", "capital_efficiency", "execution"],
      vocabulary: ["capital", "execution", "fee", "frontier", "slippage"],
      scenario_seeds: [
        "promuovi una policy solo se il capitale extra supera il costo extra in modo credibile",
        "separa capitale lordo da capitale netto dopo fee",
        "leggi fee e slippage come attrito strutturale, non come dettaglio",
      ],
      risk_rules: [
        "capitale lordo senza disciplina fee puo peggiorare la vendibilita reale",
        "fee e churn vanno trattati come costo strutturale del selector",
      ],
    },
    {
      record_id: "nyra-capital-fee-drawdown-frontier:3",
      domain: "behavioral",
      title: "Do not chase the best capital blindly",
      source_kind: "runtime_focus",
      raw_text:
        "Il selector non deve inseguire ciecamente la policy che produce il capitale massimo in laboratorio. Deve cercare il punto in cui capitale, fee, stabilita e drawdown restano insieme coerenti.",
      concept_nodes: ["blind_capital_chasing", "behavioral_balance", "selector_discipline", "behavioral"],
      vocabulary: ["balance", "behavioral", "blind", "capital", "discipline", "selector"],
      scenario_seeds: [
        "scarta la policy piu ricca se rompe troppo la stabilita operativa",
        "cerca il punto di equilibrio e non il picco cieco di rendimento",
        "usa la consistenza come freno all euforia del capitale finale",
      ],
      risk_rules: [
        "massimizzare solo il capitale puo portare a policy non vendibili",
        "consistenza e fiducia contano insieme al rendimento",
      ],
    },
    {
      record_id: "nyra-capital-fee-drawdown-frontier:4",
      domain: "regime_detection",
      title: "Frontier changes by regime",
      source_kind: "runtime_focus",
      raw_text:
        "La frontiera ottimale cambia per regime. In laterale il costo della libertà e alto, in recovery iniziale e medio, in bull chiaro e piu basso. Nyra deve leggere la frontiera in funzione del regime.",
      concept_nodes: ["regime_frontier", "lateral_cost", "recovery_cost", "bull_cost", "regime_detection"],
      vocabulary: ["bull", "cost", "frontier", "lateral", "recovery", "regime"],
      scenario_seeds: [
        "in laterale alza la disciplina, in recovery usa release misurata, in bull lascia piu spazio",
        "non usare la stessa aggressivita su tutti i regimi",
        "tratta il regime come variabile della frontiera fee-drawdown-capitale",
      ],
      risk_rules: [
        "la stessa policy puo essere giusta in bull e sbagliata in laterale",
        "regime diverso richiede frontiera diversa",
      ],
    },
  ];
}

export function runCapitalFeeDrawdownFrontierStudy(root = process.cwd()): {
  records: NyraFinancialLearningRecord[];
  pack: NyraFinancialLearningPack;
  reportPath: string;
} {
  const runtimeDir = join(root, "runtime", "nyra-learning");
  const packPath = join(runtimeDir, "nyra_capital_fee_drawdown_frontier_learning_pack_latest.json");
  const reportPath = join(root, "reports", "universal-core", "financial-core-test", "nyra_capital_fee_drawdown_frontier_study_latest.json");
  const records = buildCapitalFeeDrawdownFrontierRecords();
  const pack = distillFinancialLearningPack(records);

  mkdirSync(dirname(reportPath), { recursive: true });
  saveFinancialLearningPack(packPath, pack);
  writeFileSync(reportPath, JSON.stringify({
    runner: "nyra_capital_fee_drawdown_frontier_study",
    generated_at: new Date().toISOString(),
    records: records.length,
    domains: [...new Set(records.map((entry) => entry.domain))],
    verdict: "Nyra ha un pack dedicato alla frontiera capitale-fee-drawdown e alla vendibilita della policy.",
  }, null, 2));

  return { records, pack, reportPath };
}

if (process.argv[1]?.endsWith("nyra-capital-fee-drawdown-frontier-study.ts")) {
  const result = runCapitalFeeDrawdownFrontierStudy();
  console.log(JSON.stringify({
    ok: true,
    records: result.records.length,
    domains: result.pack.domains.map((entry) => entry.id),
    report: result.reportPath,
  }, null, 2));
}

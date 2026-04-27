import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  NyraFinancialLearningPack,
  NyraFinancialLearningRecord,
} from "../packages/contracts/src/index.ts";
import { distillFinancialLearningPack, saveFinancialLearningPack } from "./nyra-financial-learning-runtime.ts";

export function buildBullRecoveryLowChurnRecords(): NyraFinancialLearningRecord[] {
  return [
    {
      record_id: "nyra-bull-recovery-low-churn:1",
      domain: "execution",
      title: "Low-churn re-entry",
      source_kind: "runtime_focus",
      raw_text:
        "Quando il mercato esce da shock e recovery, il problema non e solo rientrare. Il problema e rientrare prima senza iniziare a girare troppo. " +
        "Nyra deve distinguere tra conferma perfetta e conferma sufficiente, perche aspettare troppo distrugge upside mentre entrare troppe volte distrugge fee.",
      concept_nodes: ["low_churn_reentry", "sufficient_confirmation", "upside_capture", "fee_drag", "execution"],
      vocabulary: ["churn", "conferma", "fee", "reentry", "recovery", "upside"],
      scenario_seeds: [
        "riconosci quando una recovery merita rientro con conferma sufficiente e non perfetta",
        "riduci il costo opportunita del ritardo senza aumentare churn inutile",
        "separa re-entry strutturale da falso rimbalzo rumoroso",
      ],
      risk_rules: [
        "conferma perfetta puo costare troppo upside in bull continuation",
        "ridurre churn non significa restare sottopesati troppo a lungo",
      ],
    },
    {
      record_id: "nyra-bull-recovery-low-churn:2",
      domain: "regime_detection",
      title: "Shock to recovery transition",
      source_kind: "runtime_focus",
      raw_text:
        "Il passaggio shock -> stabilization -> recovery -> bull continuation va letto come transizione di regime. " +
        "Nyra deve riconoscere quando il mercato non e piu in pura difesa ma non e ancora in trend maturo, per evitare rientri troppo tardi.",
      concept_nodes: ["shock_transition", "stabilization", "recovery", "bull_continuation", "regime_detection"],
      vocabulary: ["bull", "recovery", "regime", "shock", "stabilization", "transition"],
      scenario_seeds: [
        "leggi il passaggio da shock a recovery come cambio regime progressivo",
        "non aspettare che il bull sia gia ovvio per rientrare",
        "separa stabilization vera da dead cat bounce",
      ],
      risk_rules: [
        "stabilization non basta da sola, ma recovery coerente merita rilascio misurato",
        "un regime che migliora gradualmente non va trattato come laterale puro",
      ],
    },
    {
      record_id: "nyra-bull-recovery-low-churn:3",
      domain: "risk_management",
      title: "Controlled drawdown release",
      source_kind: "runtime_focus",
      raw_text:
        "Nyra non deve massimizzare solo il capitale finale. Deve accettare un drawdown in piu solo se il rapporto tra capitale extra, drawdown extra e fee resta sensato per vendibilita prodotto.",
      concept_nodes: ["controlled_release", "drawdown_budget", "fee_budget", "sellability", "risk_management"],
      vocabulary: ["budget", "drawdown", "fee", "release", "risk", "sellability"],
      scenario_seeds: [
        "accetta piu rischio solo se il capitale extra compensa davvero fee e drawdown",
        "controlla il budget di drawdown prima di alzare l aggressivita",
        "tratta la vendibilita come vincolo operativo e non solo come capitale finale",
      ],
      risk_rules: [
        "drawdown extra va pagato solo se il capitale extra lo giustifica",
        "fee alte e drawdown piu alti insieme peggiorano vendibilita anche con piu rendimento",
      ],
    },
    {
      record_id: "nyra-bull-recovery-low-churn:4",
      domain: "behavioral",
      title: "Do not over-release",
      source_kind: "runtime_focus",
      raw_text:
        "Il rischio opposto alla prudenza e la liberazione troppo veloce. Dopo aver imparato a rientrare prima, Nyra deve imparare a non trasformare la release in overreaction.",
      concept_nodes: ["overrelease", "behavioral_guard", "stability", "consistency", "behavioral"],
      vocabulary: ["consistency", "guard", "overreaction", "release", "stability"],
      scenario_seeds: [
        "rilascia il freno senza trasformare il selector in aggressivita rumorosa",
        "cerca capitale in piu senza perdere consistenza di comportamento",
        "separa coraggio operativo da overreaction",
      ],
      risk_rules: [
        "piu aggressivita senza disciplina distrugge fiducia prodotto",
        "consistenza del selector vale quasi quanto il capitale finale",
      ],
    },
    {
      record_id: "nyra-bull-recovery-low-churn:5",
      domain: "macro",
      title: "Policy-supported recovery",
      source_kind: "runtime_focus",
      raw_text:
        "Quando la recovery e sostenuta da policy, liquidita e miglioramento graduale del rischio sistemico, Nyra deve trattarla come finestra di release misurata, non come semplice watch passiva.",
      concept_nodes: ["policy_supported_recovery", "liquidity_support", "measured_release", "macro"],
      vocabulary: ["liquidity", "macro", "policy", "recovery", "release", "support"],
      scenario_seeds: [
        "riconosci recovery sostenuta da policy e liquidita",
        "usa il supporto macro per anticipare re-entry senza aspettare il trend maturo",
        "tratta la policy come acceleratore di recovery, non come rumore secondario",
      ],
      risk_rules: [
        "policy support e liquidita possono giustificare re-entry prima del trend perfetto",
        "macro favorevole non annulla il rischio, ma riduce il costo di restare troppo difensivi",
      ],
    },
  ];
}

export function runBullRecoveryLowChurnStudy(root = process.cwd()): {
  records: NyraFinancialLearningRecord[];
  pack: NyraFinancialLearningPack;
  reportPath: string;
} {
  const runtimeDir = join(root, "runtime", "nyra-learning");
  const packPath = join(runtimeDir, "nyra_bull_recovery_low_churn_learning_pack_latest.json");
  const reportPath = join(root, "reports", "universal-core", "financial-core-test", "nyra_bull_recovery_low_churn_study_latest.json");
  const records = buildBullRecoveryLowChurnRecords();
  const pack = distillFinancialLearningPack(records);

  mkdirSync(dirname(reportPath), { recursive: true });
  saveFinancialLearningPack(packPath, pack);
  writeFileSync(reportPath, JSON.stringify({
    runner: "nyra_bull_recovery_low_churn_study",
    generated_at: new Date().toISOString(),
    records: records.length,
    domains: [...new Set(records.map((entry) => entry.domain))],
    verdict: "Nyra ha un pack dedicato su bull/recovery/low-churn, fee discipline e drawdown-aware release.",
  }, null, 2));

  return { records, pack, reportPath };
}

if (process.argv[1]?.endsWith("nyra-bull-recovery-low-churn-study.ts")) {
  const result = runBullRecoveryLowChurnStudy();
  console.log(JSON.stringify({
    ok: true,
    records: result.records.length,
    domains: result.pack.domains.map((entry) => entry.id),
    report: result.reportPath,
  }, null, 2));
}

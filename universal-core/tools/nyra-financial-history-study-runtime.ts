import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  NyraFinancialLearningPack,
  NyraFinancialLearningRecord,
} from "../packages/contracts/src/index.ts";
import {
  buildFinancialLearningRecords,
  distillFinancialLearningPack,
  loadFinancialLearningPack,
  saveFinancialLearningPack,
} from "./nyra-financial-learning-runtime.ts";

export type FinancialHistorySource = {
  id: string;
  label: string;
  url: string;
  institution: string;
  insight: string;
};

const HISTORY_SOURCES: FinancialHistorySource[] = [
  {
    id: "fed_road_to_fed",
    label: "The Road to the Fed",
    url: "https://www.federalreservehistory.org/essays/road-to-the-fed",
    institution: "Federal Reserve History",
    insight: "dalla fragilita bancaria americana ai tentativi di banca centrale fino al Federal Reserve Act del 1913",
  },
  {
    id: "fed_history_overview",
    label: "Overview: The History of the Federal Reserve",
    url: "https://www.federalreservehistory.org/essays/federal-reserve-history",
    institution: "Federal Reserve History",
    insight: "panics, elastic currency, stabilita bancaria, evoluzione del ruolo della banca centrale dal 1913 a oggi",
  },
  {
    id: "bis_overview",
    label: "About BIS - overview",
    url: "https://www.bis.org/about/index.htm",
    institution: "BIS",
    insight: "la BIS nasce nel 1930 e diventa infrastruttura di cooperazione tra banche centrali e stabilita monetaria globale",
  },
  {
    id: "imf_bretton_woods_80",
    label: "The IMF at 80 / Bretton Woods at 80",
    url: "https://www.imf.org/external/pubs/ft/ar/2024/the-imf-at-80/",
    institution: "IMF",
    insight: "il passaggio da guerre commerciali e depressione alla costruzione dell ordine monetario cooperativo di Bretton Woods",
  },
  {
    id: "imf_monetary_cooperation",
    label: "International Monetary Cooperation Since Bretton Woods",
    url: "https://www.imf.org/en/publications/books/issues/2016/12/30/international-monetary-cooperation-since-bretton-woods-608",
    institution: "IMF",
    insight: "come il sistema monetario internazionale evolve da Bretton Woods al mondo di cambi flessibili, crisi e cooperazione",
  },
  {
    id: "world_bank_timeline",
    label: "World Bank Group Historical Timeline",
    url: "https://www.worldbank.org/en/about/archives/history/chronology",
    institution: "World Bank",
    insight: "la finanza moderna non e solo mercati: evolve anche come architettura di ricostruzione, sviluppo e flussi internazionali",
  },
  {
    id: "fed_panic_1907",
    label: "The Panic of 1907",
    url: "https://www.federalreservehistory.org/essays/panic-of-1907",
    institution: "Federal Reserve History",
    insight: "il panic del 1907 mostra come corse alla liquidita e istituzioni fragili possano trasformare shock locali in crisi sistemica",
  },
  {
    id: "fed_great_inflation",
    label: "The Great Inflation",
    url: "https://www.federalreservehistory.org/time-period/great-inflation",
    institution: "Federal Reserve History",
    insight: "il ciclo 1965-1982 cambia la comprensione di inflazione, tassi, banca centrale e costo del ritardo politico",
  },
  {
    id: "fed_inflation_theme",
    label: "Inflation Theme",
    url: "https://www.federalreservehistory.org/essays/inflation",
    institution: "Federal Reserve History",
    insight: "gold convertibility, oil shocks e Volcker mostrano che l inflazione e anche rottura di regime monetario e politico",
  },
  {
    id: "cftc_history",
    label: "History of the CFTC",
    url: "https://www.cftc.gov/About/HistoryoftheCFTC/history_precftc.html",
    institution: "CFTC",
    insight: "la storia dei derivati parte da forward e futures agricoli, poi diventa infrastruttura standardizzata, regolata e sistemica",
  },
  {
    id: "cftc_1970s",
    label: "CFTC History in the 1970s",
    url: "https://www.cftc.gov/About/HistoryoftheCFTC/history_1970s.html",
    institution: "CFTC",
    insight: "nel 1974-75 i derivati diventano un dominio regolato in senso moderno e allargano il perimetro della finanza sistemica",
  },
];

export function buildFinancialHistoryRecords(): NyraFinancialLearningRecord[] {
  return [
    {
      record_id: "nyra-financial-history:1",
      domain: "market_structure",
      title: "Origini della finanza e dei mercati",
      source_kind: "web_study",
      raw_text:
        "La finanza nasce prima dei mercati elettronici e prima della banca centrale moderna. " +
        "Parte da moneta, credito, debito, commercio e fiducia tra soggetti che devono scambiare nel tempo. " +
        "Lo studio storico serve a distinguere funzione reale della finanza da rumore speculativo moderno. " +
        `Fonte guida: ${HISTORY_SOURCES[0]!.url}.`,
      concept_nodes: ["money", "credit", "debt", "trust", "exchange", "liquidity", "market_structure"],
      vocabulary: ["credito", "debito", "fiducia", "liquidita", "mercato", "moneta", "scambio", "storia"],
      scenario_seeds: [
        "spiega come la finanza nasce da moneta credito debito e fiducia prima del trading moderno",
        "separa la funzione storica della finanza dal rumore speculativo recente",
        "leggi il mercato come infrastruttura storica di scambio e non solo come grafico",
      ],
      risk_rules: [
        "non ridurre la finanza alla sola speculazione di breve",
        "senza fiducia e liquidita la struttura di mercato si rompe anche se il prezzo continua a muoversi",
      ],
    },
    {
      record_id: "nyra-financial-history:2",
      domain: "bonds",
      title: "Debito sovrano, guerra, ricostruzione",
      source_kind: "web_study",
      raw_text:
        "Una parte enorme della finanza moderna cresce intorno al debito pubblico, ai bisogni di guerra, alla ricostruzione e al finanziamento dello Stato. " +
        "Capire il mercato obbligazionario storicamente significa capire perche tassi, durata e credibilita dello Stato hanno peso sistemico. " +
        `Fonti guida: ${HISTORY_SOURCES[3]!.url} e ${HISTORY_SOURCES[5]!.url}.`,
      concept_nodes: ["sovereign_debt", "war_finance", "reconstruction", "rates", "duration", "credibility", "bonds"],
      vocabulary: ["debito", "duration", "obbligazioni", "ricostruzione", "sovrano", "stato", "tassi"],
      scenario_seeds: [
        "spiega perche il debito sovrano conta nella nascita della finanza moderna",
        "tratta i bond come infrastruttura politica e monetaria oltre che come rendimento",
        "collega ricostruzione, tassi e credibilita dello Stato",
      ],
      risk_rules: [
        "non leggere i bond solo come asset difensivo senza storia di politica monetaria e fiscale",
        "la credibilita dell emittente conta prima del rendimento apparente",
      ],
    },
    {
      record_id: "nyra-financial-history:3",
      domain: "macro",
      title: "Banche centrali, gold standard, Bretton Woods, fiat",
      source_kind: "web_study",
      raw_text:
        "La finanza moderna cambia davvero quando cambia il regime monetario. " +
        "Gold standard, panics bancari, Federal Reserve, Bretton Woods, fine della convertibilita e cambi flessibili sono snodi che cambiano il comportamento dei mercati. " +
        `Fonti guida: ${HISTORY_SOURCES[1]!.url}, ${HISTORY_SOURCES[3]!.url}, ${HISTORY_SOURCES[4]!.url}.`,
      concept_nodes: ["gold_standard", "central_bank", "bretton_woods", "fiat", "exchange_rates", "monetary_regime", "macro"],
      vocabulary: ["banca", "bretton", "centrale", "cambi", "fiat", "gold", "monetario", "woods"],
      scenario_seeds: [
        "riconosci quando un cambio di regime monetario conta piu del pattern locale",
        "spiega la traiettoria gold standard Bretton Woods fiat e cambi flessibili",
        "tratta i mercati come prodotti del regime monetario e non solo del sentiment",
      ],
      risk_rules: [
        "cambio regime monetario batte lettura tecnica locale",
        "non usare dati di breve per negare un cambio di quadro monetario piu grande",
      ],
    },
    {
      record_id: "nyra-financial-history:4",
      domain: "regime_detection",
      title: "Crisi, panics, depressioni e reset di regime",
      source_kind: "web_study",
      raw_text:
        "La storia finanziaria evolve per salti: panics ottocenteschi, 1907, Grande Depressione, dopoguerra, inflazione anni Settanta, crisi globali recenti. " +
        "Studiare storia qui serve a vedere che i mercati passano da un regime all altro e che gli strumenti istituzionali nascono spesso dopo una rottura. " +
        `Fonti guida: ${HISTORY_SOURCES[1]!.url} e ${HISTORY_SOURCES[4]!.url}.`,
      concept_nodes: ["panic", "crisis", "regime_shift", "depression", "stability", "institutional_response", "regime_detection"],
      vocabulary: ["crisi", "depressione", "instabilita", "panic", "regime", "rottura", "stabilita"],
      scenario_seeds: [
        "spiega come una crisi storica forza la nascita di nuove regole e istituzioni finanziarie",
        "riconosci quando il mercato entra in rottura di regime e la vecchia disciplina non basta",
        "collega crisi e risposta istituzionale",
      ],
      risk_rules: [
        "una crisi storica e un cambio istituzionale non vanno trattati come rumore passeggero",
        "quando il quadro si rompe la memoria storica dei panics vale piu del pattern elegante",
      ],
    },
    {
      record_id: "nyra-financial-history:5",
      domain: "behavioral",
      title: "Comportamento, fiducia, euforia, paura",
      source_kind: "web_study",
      raw_text:
        "La storia della finanza non e solo infrastruttura. E anche comportamento: corsa agli sportelli, euforia, fiducia, contagio, panico e desiderio di leva. " +
        "Studiare storia serve a far capire che il comportamento umano ripete strutture anche se cambiano strumenti e tecnologia. " +
        `Fonte guida: ${HISTORY_SOURCES[1]!.url}.`,
      concept_nodes: ["bank_run", "fear", "euphoria", "contagion", "confidence", "behavioral"],
      vocabulary: ["contagio", "corsa", "euforia", "fiducia", "leva", "paura", "panico"],
      scenario_seeds: [
        "spiega perche il comportamento collettivo conta nella storia della finanza",
        "collega panico e contagio ai mercati di oggi",
        "non leggere la leva come solo meccanica: c e sempre una psicologia sotto",
      ],
      risk_rules: [
        "strumenti nuovi non cancellano paure e euforie antiche",
        "quando la fiducia si rompe la velocita del mercato aumenta il danno ma non cambia la logica umana di base",
      ],
    },
    {
      record_id: "nyra-financial-history:6",
      domain: "portfolio",
      title: "Finanza globale, sviluppo e allocazione",
      source_kind: "web_study",
      raw_text:
        "Con BIS, IMF e World Bank la finanza moderna diventa anche cooperazione tra banche centrali, sviluppo, ricostruzione e gestione di squilibri globali. " +
        "Questo allarga il portafoglio mentale: non solo trade e asset, ma reti monetarie, capitali e sviluppo. " +
        `Fonti guida: ${HISTORY_SOURCES[2]!.url} e ${HISTORY_SOURCES[5]!.url}.`,
      concept_nodes: ["global_capital", "development", "cooperation", "portfolio", "allocation", "reserves", "stability"],
      vocabulary: ["allocazione", "banche", "capitali", "cooperazione", "globale", "riserve", "sviluppo"],
      scenario_seeds: [
        "spiega come la finanza si allarga da mercati nazionali a architettura globale",
        "collega portafoglio, flussi di capitale e stabilita internazionale",
        "tratta sviluppo e stabilita come parti della storia della finanza moderna",
      ],
      risk_rules: [
        "non leggere il portafoglio senza quadro di cooperazione e squilibri globali",
        "la finanza globale amplifica shock locali se il sistema di riserve e fiducia e fragile",
      ],
    },
    {
      record_id: "nyra-financial-history:7",
      domain: "risk_management",
      title: "Panics bancari e crisi di liquidita",
      source_kind: "web_study",
      raw_text:
        "La storia del Panic of 1907 mostra che la crisi vera non e solo perdita di prezzo ma rottura di fiducia, corse alla liquidita e contagio tra intermediari. " +
        "Questo serve a Nyra per leggere drawdown e liquidita non come numeri isolati ma come rischio sistemico e cambio di comportamento collettivo. " +
        `Fonte guida: ${HISTORY_SOURCES[6]!.url}.`,
      concept_nodes: ["panic", "liquidity_run", "contagion", "trust_break", "systemic_risk", "risk_management"],
      vocabulary: ["contagio", "crisi", "fiducia", "liquidita", "panic", "run", "sistemico"],
      scenario_seeds: [
        "riconosci quando il problema non e solo prezzo ma corsa alla liquidita e contagio",
        "spiega perche una crisi bancaria storica conta per leggere il rischio oggi",
        "tratta drawdown e liquidita come possibili sintomi di panic sistemico",
      ],
      risk_rules: [
        "quando fiducia e liquidita si rompono il rischio sistemico batte il pattern locale",
        "un panic bancario insegna che la velocita della corsa conta quanto il livello finale del prezzo",
      ],
    },
    {
      record_id: "nyra-financial-history:8",
      domain: "macro",
      title: "Inflazione, oro, Volcker e costo del ritardo",
      source_kind: "web_study",
      raw_text:
        "La Great Inflation e la fine della convertibilita in oro mostrano che inflazione, energia, politica e credibilita monetaria cambiano il regime in profondita. " +
        "Lo studio qui serve a far capire che i mercati possono sembrare ancora forti mentre il regime monetario si sta incrinando. " +
        `Fonti guida: ${HISTORY_SOURCES[7]!.url} e ${HISTORY_SOURCES[8]!.url}.`,
      concept_nodes: ["great_inflation", "volcker", "gold_convertibility", "credibility", "rates", "macro"],
      vocabulary: ["credibilita", "inflazione", "oro", "regime", "tassi", "volcker"],
      scenario_seeds: [
        "spiega perche la fine dell oro e la Great Inflation cambiano il regime finanziario",
        "riconosci quando l inflazione persistente conta piu del momentum locale",
        "collega ritardo della banca centrale a peggioramento del costo finale",
      ],
      risk_rules: [
        "inflazione persistente e perdita di credibilita monetaria vanno trattate come rottura di regime",
        "se il costo del ritardo monetario cresce non basta una lettura tecnica locale per restare aggressivi",
      ],
    },
    {
      record_id: "nyra-financial-history:9",
      domain: "derivatives",
      title: "Nascita dei derivati regolati",
      source_kind: "web_study",
      raw_text:
        "La storia dei derivati moderni passa da forward agricoli, futures standardizzati, borse merci e poi regolazione CFTC. " +
        "Questo serve per capire che leva, hedge e speculazione non sono pezzi separati: nascono come infrastruttura contrattuale e poi diventano rischio sistemico. " +
        `Fonti guida: ${HISTORY_SOURCES[9]!.url} e ${HISTORY_SOURCES[10]!.url}.`,
      concept_nodes: ["forwards", "futures", "standardization", "derivatives", "regulation", "leverage"],
      vocabulary: ["contratti", "derivati", "futures", "leva", "regolazione", "standardizzazione"],
      scenario_seeds: [
        "spiega come nascono i derivati moderni da forward e futures standardizzati",
        "collega leva, hedge e regolazione nella storia dei derivati",
        "tratta i derivati come infrastruttura e non solo come scommessa",
      ],
      risk_rules: [
        "la leva dei derivati va letta come struttura di rischio, non solo come acceleratore di rendimento",
        "regolazione e standardizzazione nascono proprio perche il contratto derivato puo diventare sistemico",
      ],
    },
    {
      record_id: "nyra-financial-history:10",
      domain: "behavioral",
      title: "Leva, panico e disciplina",
      source_kind: "web_study",
      raw_text:
        "La storia finanziaria mostra che euforia, leva, scarsita di liquidita e reazione politica si rincorrono in cicli. " +
        "Studiare questa linea storica serve a non trattare overtrading e squeeze come capricci psicologici ma come pattern ripetuti dentro strutture reali. " +
        `Fonti guida: ${HISTORY_SOURCES[6]!.url}, ${HISTORY_SOURCES[7]!.url}, ${HISTORY_SOURCES[10]!.url}.`,
      concept_nodes: ["leverage_cycle", "squeeze", "discipline", "panic", "behavioral"],
      vocabulary: ["ciclo", "disciplina", "leva", "panico", "squeeze"],
      scenario_seeds: [
        "riconosci quando la leva amplifica un pattern comportamentale storico",
        "spiega perche squeeze e panico non sono eccezioni ma forme ricorrenti",
        "collega disciplina personale e struttura sistemica della leva",
      ],
      risk_rules: [
        "un ciclo di leva e panico non va trattato come eccezione irripetibile",
        "disciplina comportamentale e struttura della leva vanno lette insieme",
      ],
    },
  ];
}

export function mergeFinancialPacks(
  basePack: NyraFinancialLearningPack,
  overlayPack: NyraFinancialLearningPack,
): NyraFinancialLearningPack {
  const mergedRecords = [
    ...buildFinancialLearningRecords(),
    ...buildFinancialHistoryRecords(),
  ];

  return distillFinancialLearningPack(mergedRecords, overlayPack.generated_at);
}

export function runFinancialHistoryStudy(baseDir = process.cwd()): {
  sources: FinancialHistorySource[];
  historyPack: NyraFinancialLearningPack;
  mergedPack: NyraFinancialLearningPack;
  reportPath: string;
} {
  const runtimeDir = join(baseDir, "runtime", "nyra-learning");
  const basePackPath = join(runtimeDir, "nyra_financial_learning_pack_latest.json");
  const historyPackPath = join(runtimeDir, "nyra_financial_history_learning_pack_latest.json");
  const mergedPackPath = join(runtimeDir, "nyra_financial_learning_with_history_latest.json");
  const reportPath = join(baseDir, "reports", "universal-core", "financial-core-test", "nyra_financial_history_study_latest.json");

  const historyPack = distillFinancialLearningPack(buildFinancialHistoryRecords());
  const basePack = loadFinancialLearningPack(basePackPath);
  const mergedPack = mergeFinancialPacks(basePack, historyPack);

  saveFinancialLearningPack(historyPackPath, historyPack);
  saveFinancialLearningPack(mergedPackPath, mergedPack);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    runner: "nyra_financial_history_study_runtime",
    generated_at: new Date().toISOString(),
    sources: HISTORY_SOURCES,
    history_pack: {
      domains: historyPack.domains.length,
      scenario_templates: historyPack.scenario_templates.length,
      risk_rules: historyPack.risk_rules.length,
    },
    merged_pack: {
      domains: mergedPack.domains.length,
      scenario_templates: mergedPack.scenario_templates.length,
      risk_rules: mergedPack.risk_rules.length,
    },
    verdict: "Nyra ha un overlay storico-finanziario separato, basato su fonti istituzionali web, pronto da testare.",
  }, null, 2));

  return {
    sources: HISTORY_SOURCES,
    historyPack,
    mergedPack,
    reportPath,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runFinancialHistoryStudy(process.cwd());
  console.log(JSON.stringify({
    sources: result.sources,
    history_domains: result.historyPack.domains.length,
    merged_domains: result.mergedPack.domains.length,
    report: result.reportPath,
  }, null, 2));
}

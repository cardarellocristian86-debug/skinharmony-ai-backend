import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type NyraBasicNeedsSemanticDomain =
  | "basic_hunger"
  | "basic_thirst"
  | "basic_rest"
  | "basic_pain"
  | "economic_need"
  | "paraphrase_and_implication";

type NyraBasicNeedsSemanticRecord = {
  record_id: string;
  domain: NyraBasicNeedsSemanticDomain;
  title: string;
  raw_text: string;
  concept_nodes: string[];
  scenario_seeds: string[];
  response_rules: string[];
};

type NyraLearningStorageProfile = {
  profile_version: string;
  raw_bytes: number;
  semantic_bytes: number;
  semantic_ratio: number;
  brotli_raw_bytes: number;
  brotli_semantic_bytes: number;
  brotli_ratio: number;
  loss_model: string;
};

type NyraBasicNeedsSemanticPack = {
  pack_version: string;
  generated_at: string;
  owner_scope: "god_mode_only";
  records_count: number;
  domains: Array<{
    id: NyraBasicNeedsSemanticDomain;
    summary: string;
  }>;
  contrastive_pairs: Array<{
    id: string;
    left: string;
    right: string;
    distinction: string;
  }>;
  source_refs: Array<{
    id: string;
    label: string;
    url: string;
    relevance: string;
  }>;
  response_rules: string[];
  storage_profile: NyraLearningStorageProfile;
};

const DOMAINS: Array<{ id: NyraBasicNeedsSemanticDomain; summary: string }> = [
  { id: "basic_hunger", summary: "fame come bisogno fisico semplice: prima nutrimento, poi strategia" },
  { id: "basic_thirst", summary: "sete come segnale corporeo immediato: prima acqua, poi analisi" },
  { id: "basic_rest", summary: "stanchezza e sonno come limite cognitivo reale: prima recupero, poi decisione" },
  { id: "basic_pain", summary: "dolore o malessere come bisogno di valutazione corporea prima del meta-discorso" },
  { id: "economic_need", summary: "pressione economica come bisogno di continuita, cassa, copertura costi e monetizzazione" },
  { id: "paraphrase_and_implication", summary: "stesso bisogno detto in modi diversi: impliciti, parafrasi sporche, frasi indirette" },
];

function bytesOf(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function brotliBytesOf(value: string): number {
  return brotliCompressSync(Buffer.from(value, "utf8"), {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  }).byteLength;
}

function buildStorageProfile(rawJson: string, semanticJson: string): NyraLearningStorageProfile {
  const rawBytes = bytesOf(rawJson);
  const semanticBytes = bytesOf(semanticJson);
  const brotliRawBytes = brotliBytesOf(rawJson);
  const brotliSemanticBytes = brotliBytesOf(semanticJson);

  return {
    profile_version: "nyra_semantic_storage_v1",
    raw_bytes: rawBytes,
    semantic_bytes: semanticBytes,
    semantic_ratio: Number((semanticBytes / rawBytes).toFixed(6)),
    brotli_raw_bytes: brotliRawBytes,
    brotli_semantic_bytes: brotliSemanticBytes,
    brotli_ratio: Number((brotliSemanticBytes / brotliRawBytes).toFixed(6)),
    loss_model: "semantic_distillation",
  };
}

export function buildBasicNeedsSemanticLearningRecords(): NyraBasicNeedsSemanticRecord[] {
  return [
    {
      record_id: "basic-needs:hunger",
      domain: "basic_hunger",
      title: "Hunger Need",
      raw_text: "Frasi come ho fame, devo mangiare, sono scarico e non ho mangiato chiedono una risposta pratica breve. Prima nutrimento semplice, poi eventuale chiarimento. Se non si mangia abbastanza possono emergere fatica, debolezza o capogiri: non va trattato come open help astratto.",
      concept_nodes: ["hunger", "physical_need", "simple_advice", "body_first"],
      scenario_seeds: ["ho fame che mi consigli?", "non ho mangiato oggi", "sono scarico e devo mettere qualcosa nello stomaco"],
      response_rules: ["non trattare la fame come open help astratto", "risposta breve, concreta, corporea", "prima bisogno fisico, poi ragionamento", "se emergono debolezza o capogiri, non romantizzare il digiuno"],
    },
    {
      record_id: "basic-needs:thirst",
      domain: "basic_thirst",
      title: "Thirst Need",
      raw_text: "Frasi come ho sete o sono disidratato chiedono acqua e recupero immediato, non framing strategico. La sete, la bocca secca, la stanchezza o le vertigini sono segnali coerenti con perdita di fluidi.",
      concept_nodes: ["thirst", "water", "physical_need", "immediate_recovery"],
      scenario_seeds: ["ho sete", "mi sento secco", "devo bere qualcosa"],
      response_rules: ["prima acqua", "non astrarre il bisogno semplice", "risposta minima e utile", "se compaiono confusione, svenimento o mancanza di urina, la gravita sale"],
    },
    {
      record_id: "basic-needs:rest",
      domain: "basic_rest",
      title: "Rest Need",
      raw_text: "Frasi come sono stanco, ho sonno, sono esausto indicano limite cognitivo e fisico. Prima recupero o pausa, poi decisione. La carenza di sonno riduce attenzione, apprendimento, giudizio e reazione.",
      concept_nodes: ["rest", "fatigue", "sleep", "cognitive_limit"],
      scenario_seeds: ["sono stanco", "ho sonno", "sono esausto e devo decidere"],
      response_rules: ["non trattare stanchezza come semplice indecisione", "prima recupero o pausa", "evitare over-guidance quando il corpo e scarico", "se manca sonno, abbassa fiducia sul giudizio lucido"],
    },
    {
      record_id: "basic-needs:pain",
      domain: "basic_pain",
      title: "Pain Need",
      raw_text: "Frasi come mi fa male la testa o ho dolore chiedono prima valutazione del malessere e distinzione tra fastidio gestibile e segnale da non sottovalutare. Il dolore e un segnale che qualcosa puo non andare e non va banalizzato.",
      concept_nodes: ["pain", "body_signal", "severity_check", "non_trivialize"],
      scenario_seeds: ["mi fa male la testa", "ho dolore", "mi sento male"],
      response_rules: ["non minimizzare il dolore", "prima chiarire gravita e zona", "non saltare subito in meta-consiglio", "dolore improvviso o severo non va trattato come semplice fastidio"],
    },
    {
      record_id: "basic-needs:economic",
      domain: "economic_need",
      title: "Economic Need",
      raw_text: "Frasi come mi servono soldi, sono a secco, non copro i costi o devo monetizzare chiedono continuita di cassa, non solo priorita generica.",
      concept_nodes: ["cash_continuity", "resource_exhaustion", "monetization", "cost_coverage"],
      scenario_seeds: ["mi servono soldi", "sono a secco", "non riesco piu a coprire i costi", "devo monetizzare"],
      response_rules: ["separa resource_exhaustion, monetization_pressure e cost_coverage_pressure", "non ripetere la frase utente come next step", "prima leva di cassa vicina o copertura base"],
    },
    {
      record_id: "basic-needs:paraphrase",
      domain: "paraphrase_and_implication",
      title: "Paraphrase And Implication",
      raw_text: "Lo stesso bisogno puo essere detto in modo sporco, implicito o indiretto. Non ho perdite perche sono finite le finanze significa capitale esaurito, non salute. Ho fame non equivale a open help.",
      concept_nodes: ["paraphrase", "implication", "contrastive_learning", "semantic_mode"],
      scenario_seeds: ["non ho perdite perche sono finite le finanze", "ho fame che mi consigli?", "se resto cosi mi fermo"],
      response_rules: ["seguire il significato, non solo la keyword", "distinguere bisogno fisico, bisogno economico e help request", "usare contrasti quasi uguali con esito diverso"],
    },
  ];
}

export function distillBasicNeedsSemanticLearningPack(
  records: NyraBasicNeedsSemanticRecord[],
  generatedAt = new Date().toISOString(),
): NyraBasicNeedsSemanticPack {
  const responseRules = [...new Set(records.flatMap((record) => record.response_rules))].sort((a, b) => a.localeCompare(b));
  const semanticBase = {
    pack_version: "nyra_basic_needs_semantic_learning_pack_v1" as const,
    generated_at: generatedAt,
    owner_scope: "god_mode_only" as const,
    records_count: records.length,
    domains: DOMAINS,
    contrastive_pairs: [
      {
        id: "hunger_vs_open_help",
        left: "ho fame che mi consigli?",
        right: "come puoi aiutarmi?",
        distinction: "bisogno fisico semplice vs richiesta aperta di aiuto",
      },
      {
        id: "capital_exhaustion_vs_no_loss_health",
        left: "non ho perdite perche sono finite le finanze",
        right: "non ho perdite perche il rischio e sotto controllo",
        distinction: "capitale esaurito vs gestione sana del rischio",
      },
      {
        id: "cost_pressure_vs_generic_uncertainty",
        left: "non riesco piu a coprire i costi",
        right: "non so da dove partire",
        distinction: "pressione economica concreta vs bisogno di orientamento",
      },
    ],
    source_refs: [
      {
        id: "medlineplus_dehydration",
        label: "MedlinePlus - Dehydration",
        url: "https://medlineplus.gov/dehydration.html",
        relevance: "sete, bocca secca, stanchezza, vertigini e soglie di gravita",
      },
      {
        id: "nhlbi_sleep_deficiency",
        label: "NHLBI - Sleep Deprivation and Deficiency",
        url: "https://www.nhlbi.nih.gov/health/sleep-deprivation",
        relevance: "sonno come bisogno umano base e impatto su attenzione, reazione e giudizio",
      },
      {
        id: "medlineplus_pain",
        label: "MedlinePlus - Pain",
        url: "https://medlineplus.gov/pain.html",
        relevance: "dolore come segnale corporeo da non banalizzare",
      },
      {
        id: "medlineplus_malnutrition",
        label: "MedlinePlus - Malnutrition",
        url: "https://medlineplus.gov/malnutrition.html",
        relevance: "fame prolungata, fatica, debolezza e insufficienza nutrizionale",
      },
    ],
    response_rules: responseRules,
  };

  return {
    ...semanticBase,
    storage_profile: buildStorageProfile(JSON.stringify(records), JSON.stringify(semanticBase)),
  };
}

export function saveBasicNeedsSemanticLearningPack(path: string, pack: NyraBasicNeedsSemanticPack): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pack, null, 2));
}

export function loadBasicNeedsSemanticLearningPack(path: string): NyraBasicNeedsSemanticPack {
  return JSON.parse(readFileSync(path, "utf8")) as NyraBasicNeedsSemanticPack;
}

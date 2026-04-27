import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type NyraFractalLearningDomain =
  | "self_similarity"
  | "scale_invariance"
  | "fractal_dimension"
  | "branching_systems"
  | "turbulence_and_clouds"
  | "porous_media"
  | "criticality_and_cascades"
  | "signal_multi_scale";

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

type NyraFractalLearningRecord = {
  record_id: string;
  domain: NyraFractalLearningDomain;
  title: string;
  source_kind: "primer";
  raw_text: string;
  concept_nodes: string[];
  vocabulary: string[];
  scenario_seeds: string[];
  exploitation_rules: string[];
};

type NyraFractalLearningPack = {
  pack_version: "nyra_fractal_learning_pack_v1";
  generated_at: string;
  owner_scope: "god_mode_only";
  records_count: number;
  domains: Array<{
    id: NyraFractalLearningDomain;
    label: string;
    summary: string;
    concept_count: number;
  }>;
  concept_graph: Array<{
    concept: string;
    weight: number;
    domain: NyraFractalLearningDomain;
    related_concepts: string[];
  }>;
  scenario_templates: Array<{
    id: string;
    domain: NyraFractalLearningDomain;
    prompt: string;
  }>;
  exploitation_rules: string[];
  storage_profile: NyraLearningStorageProfile;
};

type FractalDomainDefinition = {
  id: NyraFractalLearningDomain;
  label: string;
  summary: string;
};

const DOMAINS: FractalDomainDefinition[] = [
  {
    id: "self_similarity",
    label: "Self Similarity",
    summary: "una forma o una logica si ripresenta in piccolo, medio e grande con struttura affine ma non identica",
  },
  {
    id: "scale_invariance",
    label: "Scale Invariance",
    summary: "il fenomeno conserva pattern leggibili quando cambi scala di osservazione",
  },
  {
    id: "fractal_dimension",
    label: "Fractal Dimension",
    summary: "misura quanto una struttura riempie lo spazio in modo irregolare oltre le dimensioni geometriche semplici",
  },
  {
    id: "branching_systems",
    label: "Branching Systems",
    summary: "fulmini, alberi, vasi, fratture e ramificazioni mostrano crescita frattale e distribuzione gerarchica",
  },
  {
    id: "turbulence_and_clouds",
    label: "Turbulence And Clouds",
    summary: "moto turbolento, nubi e fronti irregolari mostrano ordine multi-scala dentro il caos apparente",
  },
  {
    id: "porous_media",
    label: "Porous Media",
    summary: "rocce, schiume e materiali porosi hanno reti irregolari con percorsi e vuoti distribuiti su scale diverse",
  },
  {
    id: "criticality_and_cascades",
    label: "Criticality And Cascades",
    summary: "vicino a soglie critiche compaiono valanghe, cluster e rotture con distribuzioni senza scala privilegiata",
  },
  {
    id: "signal_multi_scale",
    label: "Signal Multi Scale",
    summary: "una serie temporale complessa va letta a piu scale per distinguere rumore, struttura e ripetizione",
  },
];

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9àèéìòù\s]/gi, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function topTerms(tokens: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

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

export function buildFractalLearningRecords(): NyraFractalLearningRecord[] {
  const records: NyraFractalLearningRecord[] = [];
  let counter = 1;

  for (const domain of DOMAINS) {
    const rawText =
      `Modulo ${domain.label}. ${domain.summary}. ` +
      `Nyra deve capire che un frattale in fisica non e un ornamento, ma una firma di ordine multi-scala. ` +
      `Se il fenomeno mostra movimento ma non una geometria semplice, Nyra deve verificare se la stessa logica riappare cambiando risoluzione. ` +
      `Applicazioni tipiche: fulmini, nuvole, turbolenza, fratture, reti porose, crescita ramificata, cluster critici e serie temporali con struttura su piu orizzonti. ` +
      `Errore da evitare: chiamare frattale qualsiasi caos irregolare senza prova di ricorrenza di scala.`;

    const exploitationRules = [
      "prima cambia scala di osservazione; se il pattern scompare del tutto non chiamarlo frattale",
      "distinguere rumore casuale da struttura multi-scala ripetuta",
      "se il piccolo anticipa il medio e il medio anticipa il grande, sfruttare il pattern come segnale gerarchico",
      "non cercare identita perfetta; in fisica basta somiglianza strutturale robusta",
      "usare il frattale per leggere propagazione, ramificazione, saturazione, soglia critica e cluster",
      "quando un sistema e complesso, confronta almeno tre scale prima di giudicarlo lineare",
      "in una serie temporale cerca ripetizione di forma, non solo ripetizione di ampiezza",
      "il frattale serve a capire dove c e ordine nascosto, non a romanticizzare il disordine",
    ];

    const scenarioSeeds = [
      `spiega perche ${domain.id} mostra ordine multi-scala e non solo caos`,
      `dimmi quali segnali osservare per riconoscere struttura frattale in ${domain.id}`,
      `usa ${domain.id} per distinguere pattern reale da rumore`,
    ];

    records.push({
      record_id: `nyra-fractal-learning:${counter++}`,
      domain: domain.id,
      title: domain.label,
      source_kind: "primer",
      raw_text: rawText,
      concept_nodes: uniqueSorted([
        domain.id,
        "frattale",
        "fisica",
        "multi_scala",
        "auto_similarita",
        "ordine_nascosto",
        "rumore",
        "pattern",
        "soglia_critica",
      ]),
      vocabulary: uniqueSorted(topTerms(tokenize(rawText), 22)),
      scenario_seeds: scenarioSeeds,
      exploitation_rules: exploitationRules,
    });
  }

  return records;
}

export function distillFractalLearningPack(records: NyraFractalLearningRecord[], generatedAt = new Date().toISOString()): NyraFractalLearningPack {
  const conceptGraphMap = new Map<string, { weight: number; domain: NyraFractalLearningDomain; related: Set<string> }>();
  const scenarioMap = new Map<string, NyraFractalLearningPack["scenario_templates"][number]>();
  const exploitationRules = new Set<string>();

  for (const record of records) {
    for (const rule of record.exploitation_rules) exploitationRules.add(rule);
    for (const [index, seed] of record.scenario_seeds.entries()) {
      const key = `${record.domain}:${seed}`;
      if (!scenarioMap.has(key)) {
        scenarioMap.set(key, {
          id: `fractal-scenario:${record.domain}:${index + 1}`,
          domain: record.domain,
          prompt: seed,
        });
      }
    }
    for (const concept of record.concept_nodes) {
      const entry = conceptGraphMap.get(concept) ?? { weight: 0, domain: record.domain, related: new Set<string>() };
      entry.weight += 1;
      for (const related of record.concept_nodes) {
        if (related !== concept) entry.related.add(related);
      }
      conceptGraphMap.set(concept, entry);
    }
  }

  const semanticBase = {
    pack_version: "nyra_fractal_learning_pack_v1" as const,
    generated_at: generatedAt,
    owner_scope: "god_mode_only" as const,
    records_count: records.length,
    domains: DOMAINS.map((domain) => ({
      id: domain.id,
      label: domain.label,
      summary: domain.summary,
      concept_count: uniqueSorted(records.filter((record) => record.domain === domain.id).flatMap((record) => record.concept_nodes)).length,
    })),
    concept_graph: [...conceptGraphMap.entries()]
      .map(([concept, data]) => ({
        concept,
        weight: data.weight,
        domain: data.domain,
        related_concepts: [...data.related].sort((a, b) => a.localeCompare(b)).slice(0, 8),
      }))
      .sort((a, b) => b.weight - a.weight || a.concept.localeCompare(b.concept)),
    scenario_templates: [...scenarioMap.values()].sort((a, b) => `${a.domain}:${a.prompt}`.localeCompare(`${b.domain}:${b.prompt}`)),
    exploitation_rules: [...exploitationRules].sort((a, b) => a.localeCompare(b)),
  };

  return {
    ...semanticBase,
    storage_profile: buildStorageProfile(JSON.stringify(records), JSON.stringify(semanticBase)),
  };
}

export function saveFractalLearningPack(path: string, pack: NyraFractalLearningPack): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pack, null, 2));
}

export function loadFractalLearningPack(path: string): NyraFractalLearningPack {
  return JSON.parse(readFileSync(path, "utf8")) as NyraFractalLearningPack;
}

import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  NyraLearningStorageProfile,
  NyraRelativityLearningDomain,
  NyraRelativityLearningPack,
  NyraRelativityLearningRecord,
} from "../packages/contracts/src/index.ts";

type RelativityDomainDefinition = {
  id: NyraRelativityLearningDomain;
  label: string;
  summary: string;
  source_urls: string[];
};

export const RELATIVITY_SOURCES: RelativityDomainDefinition[] = [
  {
    id: "special_relativity",
    label: "Special Relativity",
    summary: "postulati di Einstein, invarianti, simultaneita relativa, dilatazione dei tempi e contrazione delle lunghezze",
    source_urls: [
      "https://ocw.mit.edu/courses/8-20-introduction-to-special-relativity-january-iap-2021/",
      "https://ocw.mit.edu/courses/8-033-relativity-fall-2006/",
    ],
  },
  {
    id: "spacetime",
    label: "Spacetime",
    summary: "spazio e tempo come struttura unificata con intervallo invariante e geometria causale",
    source_urls: [
      "https://www.einstein-online.info/en/explandict/general-theory-of-relativity/",
      "https://ocw.mit.edu/courses/8-033-relativity-fall-2006/",
    ],
  },
  {
    id: "lorentz_transformations",
    label: "Lorentz Transformations",
    summary: "trasformazioni tra sistemi inerziali e ruolo della velocita della luce nella forma delle equazioni",
    source_urls: [
      "https://ocw.mit.edu/courses/8-20-introduction-to-special-relativity-january-iap-2021/",
      "https://ocw.mit.edu/courses/8-033-relativity-fall-2006/",
    ],
  },
  {
    id: "energy_momentum",
    label: "Energy Momentum",
    summary: "relazione tra massa, energia e impulso nella fisica relativistica",
    source_urls: [
      "https://ocw.mit.edu/courses/8-20-introduction-to-special-relativity-january-iap-2021/",
      "https://ocw.mit.edu/courses/8-033-relativity-fall-2006/",
    ],
  },
  {
    id: "general_relativity",
    label: "General Relativity",
    summary: "gravita come geometria dello spaziotempo, equivalenza, curvatura, geodetiche e test sperimentali",
    source_urls: [
      "https://ocw.mit.edu/courses/8-962-general-relativity-spring-2020/",
      "https://www.einstein-online.info/en/explandict/general-theory-of-relativity/",
    ],
  },
  {
    id: "einstein_field_equations",
    label: "Einstein Field Equations",
    summary: "equazioni di campo che legano geometria e contenuto materiale dello spaziotempo",
    source_urls: [
      "https://www.einstein-online.info/en/explandict/einsteins-equation/",
      "https://ocw.mit.edu/courses/8-962-general-relativity-spring-2020/",
    ],
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

export function buildRelativityLearningRecords(): NyraRelativityLearningRecord[] {
  const records: NyraRelativityLearningRecord[] = [];
  let counter = 1;

  for (const domain of RELATIVITY_SOURCES) {
    const rawText =
      `Modulo ${domain.label}. ${domain.summary}. ` +
      `Nyra studia la relativita come combinazione di struttura matematica, significato fisico e vincoli di verifica. ` +
      `In speciale: costanza della velocita della luce, simultaneita relativa, trasformazioni di Lorentz, gamma relativistico, energia e impulso. ` +
      `In generale: principio di equivalenza, geometria dello spaziotempo, curvatura, tensori e ruolo delle equazioni di Einstein nel collegare geometria e materia. ` +
      `Le equazioni non vanno solo recitate: vanno lette, completate e controllate nel loro significato.`;

    const conceptNodes = uniqueSorted([
      domain.id,
      "einstein",
      "relativita",
      "spaziotempo",
      "invarianza",
      "curvatura",
      "energia",
      "impulso",
      "equazioni",
    ]);

    const scenarioSeeds = [
      `spiega il significato fisico di ${domain.id} senza perdere rigore`,
      `completa una forma abbreviata di un equazione relativistica in ${domain.id}`,
      `distingui simboli, struttura matematica e interpretazione fisica in ${domain.id}`,
    ];

    const equationRules = [
      "la forma compatta dell equazione di Einstein e G_mu_nu + Lambda g_mu_nu = 8 pi G / c^4 T_mu_nu",
      "in vuoto senza costante cosmologica la forma ridotta e R_mu_nu - 1/2 R g_mu_nu = 0",
      "il fattore di Lorentz e gamma = 1 / sqrt(1 - v^2 / c^2)",
      "la relazione energia impulso relativistica e E^2 = (pc)^2 + (mc^2)^2",
      "ogni simbolo va letto: lato geometrico e lato materia non sono intercambiabili",
      "non basta ricordare la formula: serve saper dire cosa collega e sotto quali assunzioni",
    ];

    records.push({
      record_id: `nyra-relativity-learning:${counter++}`,
      domain: domain.id,
      title: domain.label,
      source_kind: "primer",
      raw_text: rawText,
      concept_nodes: conceptNodes,
      vocabulary: uniqueSorted(topTerms(tokenize(rawText), 20)),
      scenario_seeds: scenarioSeeds,
      equation_rules: equationRules,
    });
  }

  return records;
}

export function distillRelativityLearningPack(records: NyraRelativityLearningRecord[], generatedAt = new Date().toISOString()): NyraRelativityLearningPack {
  const conceptGraphMap = new Map<string, { weight: number; domain: NyraRelativityLearningDomain; related: Set<string> }>();
  const scenarioMap = new Map<string, NyraRelativityLearningPack["scenario_templates"][number]>();
  const equationRules = new Set<string>();

  for (const record of records) {
    for (const rule of record.equation_rules) equationRules.add(rule);
    for (const [index, seed] of record.scenario_seeds.entries()) {
      const key = `${record.domain}:${seed}`;
      if (!scenarioMap.has(key)) {
        scenarioMap.set(key, {
          id: `relativity-scenario:${record.domain}:${index + 1}`,
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
    pack_version: "nyra_relativity_learning_pack_v1" as const,
    generated_at: generatedAt,
    owner_scope: "god_mode_only" as const,
    records_count: records.length,
    domains: RELATIVITY_SOURCES.map((domain) => ({
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
    equation_rules: [...equationRules].sort((a, b) => a.localeCompare(b)),
  };

  return {
    ...semanticBase,
    storage_profile: buildStorageProfile(JSON.stringify(records), JSON.stringify(semanticBase)),
  };
}

export function saveRelativityLearningPack(path: string, pack: NyraRelativityLearningPack): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pack, null, 2));
}

export function loadRelativityLearningPack(path: string): NyraRelativityLearningPack {
  return JSON.parse(readFileSync(path, "utf8")) as NyraRelativityLearningPack;
}

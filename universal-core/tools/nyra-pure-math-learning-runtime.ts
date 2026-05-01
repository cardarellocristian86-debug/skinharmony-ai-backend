import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  NyraLearningStorageProfile,
  NyraPureMathLearningDomain,
  NyraPureMathLearningPack,
  NyraPureMathLearningRecord,
} from "../packages/contracts/src/index.ts";

type PureMathDomainDefinition = {
  id: NyraPureMathLearningDomain;
  label: string;
  summary: string;
};

const DOMAINS: PureMathDomainDefinition[] = [
  { id: "logic_foundations", label: "Logic Foundations", summary: "proposizioni, implicazione, negazione, quantificatori e coerenza formale" },
  { id: "set_theory", label: "Set Theory", summary: "insiemi, appartenenza, inclusione, unione, intersezione e complemento" },
  { id: "relations_and_functions", label: "Relations and Functions", summary: "dominio, codominio, immagine, iniettivita e struttura delle relazioni" },
  { id: "proof_methods", label: "Proof Methods", summary: "diretta, controesempio, contrapposizione e assurdo" },
  { id: "induction", label: "Induction", summary: "base, passo induttivo e chiusura della catena logica" },
  { id: "discrete_structures", label: "Discrete Structures", summary: "grafi, conteggio, casi finiti e strutture combinatorie" },
  { id: "invariants_and_symmetry", label: "Invariants and Symmetry", summary: "quantita che restano stabili, simmetrie e conservazione strutturale" },
  { id: "abstraction_and_structure", label: "Abstraction and Structure", summary: "riconoscere forma, isolare essenziale e separare struttura da contenuto" },
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

export function buildPureMathLearningRecords(): NyraPureMathLearningRecord[] {
  const proofRules = [
    "prima definisci bene l oggetto, poi ragiona su di lui",
    "se una tesi sembra vera, cerca anche il controesempio prima di crederle",
    "non saltare il passaggio logico che tiene insieme l argomento",
    "se il contenuto confonde, riduci il problema alla struttura",
    "usa invarianti e simmetrie quando il movimento del problema e piu importante dei numeri",
    "se una via e lunga, cerca la forma astratta che la comprime",
  ];

  let counter = 1;
  return DOMAINS.map((domain) => {
    const rawText =
      `Modulo ${domain.label}. ${domain.summary}. ` +
      `Nyra studia definizioni, struttura, prova, controesempio, astrazione e verifica finale. ` +
      `Ogni problema viene letto come forma logica prima che come calcolo locale.`;

    const scenarioSeeds = [
      `riconosci la struttura essenziale di ${domain.id}`,
      `scegli la prova o il controesempio giusto per ${domain.id}`,
      `spiega perche la forma conta piu del dettaglio in ${domain.id}`,
    ];

    return {
      record_id: `nyra-pure-math-learning:${counter++}`,
      domain: domain.id,
      title: domain.label,
      source_kind: "primer" as const,
      raw_text: rawText,
      concept_nodes: uniqueSorted([
        domain.id,
        "definizione",
        "struttura",
        "prova",
        "controesempio",
        "astrazione",
        "invariante",
        "verifica",
      ]),
      vocabulary: uniqueSorted(topTerms(tokenize(rawText), 20)),
      scenario_seeds: scenarioSeeds,
      proof_rules: proofRules,
    };
  });
}

export function distillPureMathLearningPack(
  records: NyraPureMathLearningRecord[],
  generatedAt = new Date().toISOString(),
): NyraPureMathLearningPack {
  const conceptGraphMap = new Map<string, { weight: number; domain: NyraPureMathLearningDomain; related: Set<string> }>();
  const scenarioMap = new Map<string, NyraPureMathLearningPack["scenario_templates"][number]>();
  const proofRules = new Set<string>();

  for (const record of records) {
    for (const rule of record.proof_rules) proofRules.add(rule);
    for (const [index, seed] of record.scenario_seeds.entries()) {
      const key = `${record.domain}:${seed}`;
      if (!scenarioMap.has(key)) {
        scenarioMap.set(key, {
          id: `pure-math-scenario:${record.domain}:${index + 1}`,
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
    pack_version: "nyra_pure_math_learning_pack_v1" as const,
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
        related_concepts: [...data.related].sort((a, b) => a.localeCompare(b)).slice(0, 10),
      }))
      .sort((a, b) => b.weight - a.weight || a.concept.localeCompare(b.concept)),
    scenario_templates: [...scenarioMap.values()].sort((a, b) => `${a.domain}:${a.prompt}`.localeCompare(`${b.domain}:${b.prompt}`)),
    proof_rules: [...proofRules].sort((a, b) => a.localeCompare(b)),
  };

  return {
    ...semanticBase,
    storage_profile: buildStorageProfile(JSON.stringify(records), JSON.stringify(semanticBase)),
  };
}

export function savePureMathLearningPack(path: string, pack: NyraPureMathLearningPack): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pack, null, 2));
}

export function loadPureMathLearningPack(path: string): NyraPureMathLearningPack {
  return JSON.parse(readFileSync(path, "utf8")) as NyraPureMathLearningPack;
}

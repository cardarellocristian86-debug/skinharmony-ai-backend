import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  NyraAlgebraLearningDomain,
  NyraAlgebraLearningPack,
  NyraAlgebraLearningRecord,
  NyraLearningStorageProfile,
} from "../packages/contracts/src/index.ts";

type AlgebraDomainDefinition = {
  id: NyraAlgebraLearningDomain;
  label: string;
  summary: string;
};

const DOMAINS: AlgebraDomainDefinition[] = [
  { id: "arithmetic_foundations", label: "Arithmetic Foundations", summary: "ordine delle operazioni, segni, equivalenza e passaggi corretti" },
  { id: "fractions", label: "Fractions", summary: "somma, prodotto, semplificazione e denominatori comuni" },
  { id: "exponents", label: "Exponents", summary: "potenze, regole di prodotto, quoziente e potenze di potenze" },
  { id: "linear_equations", label: "Linear Equations", summary: "isolamento dell incognita, distribuzione e passaggi equivalenti" },
  { id: "polynomials", label: "Polynomials", summary: "termini simili, grado, sviluppo e raccolta" },
  { id: "factorization", label: "Factorization", summary: "raccoglimento, differenza di quadrati, trinomio e prodotti notevoli" },
  { id: "quadratic_equations", label: "Quadratic Equations", summary: "fattorizzazione, formula risolutiva e discriminante" },
  { id: "systems", label: "Systems", summary: "sostituzione, eliminazione e verifica della soluzione" },
  { id: "inequalities", label: "Inequalities", summary: "verso della disuguaglianza, intervalli e casi di segno" },
  { id: "functions", label: "Functions", summary: "dominio, variazione, lettura di formule e relazioni input output" },
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

export function buildAlgebraLearningRecords(): NyraAlgebraLearningRecord[] {
  const records: NyraAlgebraLearningRecord[] = [];
  let counter = 1;

  for (const domain of DOMAINS) {
    const rawText =
      `Modulo ${domain.label}. ${domain.summary}. ` +
      `Nyra studia regole, casi standard, errori tipici, scelta del metodo e verifica finale. ` +
      `Ogni problema viene trasformato in scenario, tipo di struttura e metodo risolutivo piu coerente.`;
    const solvingRules = [
      "prima riconosci la struttura, poi scegli il metodo",
      "non usare formula generale se una via piu semplice e gia evidente",
      "dopo la soluzione, verifica sostituendo",
      "se l espressione e ambigua, scegli il metodo piu robusto",
    ];
    const scenarioSeeds = [
      `riconosci la struttura di ${domain.id}`,
      `scegli il metodo piu semplice ma corretto per ${domain.id}`,
      `verifica la soluzione trovata in ${domain.id}`,
    ];

    records.push({
      record_id: `nyra-algebra-learning:${counter++}`,
      domain: domain.id,
      title: domain.label,
      source_kind: "primer",
      raw_text: rawText,
      concept_nodes: uniqueSorted([domain.id, "struttura", "metodo", "verifica", "equivalenza", "scenario", "soluzione"]),
      vocabulary: uniqueSorted(topTerms(tokenize(rawText), 18)),
      scenario_seeds: scenarioSeeds,
      solving_rules: solvingRules,
    });
  }

  return records;
}

export function distillAlgebraLearningPack(records: NyraAlgebraLearningRecord[], generatedAt = new Date().toISOString()): NyraAlgebraLearningPack {
  const conceptGraphMap = new Map<string, { weight: number; domain: NyraAlgebraLearningDomain; related: Set<string> }>();
  const scenarioMap = new Map<string, NyraAlgebraLearningPack["scenario_templates"][number]>();
  const solvingRules = new Set<string>();

  for (const record of records) {
    for (const rule of record.solving_rules) solvingRules.add(rule);
    for (const [index, seed] of record.scenario_seeds.entries()) {
      const key = `${record.domain}:${seed}`;
      if (!scenarioMap.has(key)) {
        scenarioMap.set(key, {
          id: `algebra-scenario:${record.domain}:${index + 1}`,
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
    pack_version: "nyra_algebra_learning_pack_v1" as const,
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
    solving_rules: [...solvingRules].sort((a, b) => a.localeCompare(b)),
  };

  return {
    ...semanticBase,
    storage_profile: buildStorageProfile(JSON.stringify(records), JSON.stringify(semanticBase)),
  };
}

export function saveAlgebraLearningPack(path: string, pack: NyraAlgebraLearningPack): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pack, null, 2));
}

export function loadAlgebraLearningPack(path: string): NyraAlgebraLearningPack {
  return JSON.parse(readFileSync(path, "utf8")) as NyraAlgebraLearningPack;
}

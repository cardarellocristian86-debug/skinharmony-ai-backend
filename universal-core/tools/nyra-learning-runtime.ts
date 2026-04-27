import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  NyraLearningPack,
  NyraLearningRecord,
  NyraLearningStageId,
  NyraLearningStorageProfile,
  NyraLearningSubject,
} from "../packages/contracts/src/index.ts";

type StageDefinition = {
  id: NyraLearningStageId;
  label: string;
  summary: string;
  subjects: NyraLearningSubject[];
};

const STAGES: StageDefinition[] = [
  { id: "grade_1", label: "Prima Elementare", summary: "lettura base, ascolto, dialogo semplice, numeri e ordine", subjects: ["language", "reading", "writing", "math", "dialogue", "ethics"] },
  { id: "grade_2", label: "Seconda Elementare", summary: "frasi complete, lessico base, problemi semplici, osservazione del mondo", subjects: ["language", "reading", "writing", "math", "science", "dialogue"] },
  { id: "grade_3", label: "Terza Elementare", summary: "testi piu chiari, grammatica base, logica pratica, relazioni causa-effetto", subjects: ["language", "reading", "writing", "math", "science", "logic", "history", "geography"] },
  { id: "grade_4", label: "Quarta Elementare", summary: "comprensione strutturata, riassunto, storia e geografia piu solide", subjects: ["language", "reading", "writing", "math", "science", "history", "geography", "logic"] },
  { id: "grade_5", label: "Quinta Elementare", summary: "argomentazione base, mappe concettuali, problemi composti, dialogo piu maturo", subjects: ["language", "reading", "writing", "math", "science", "history", "geography", "logic", "dialogue"] },
  { id: "grade_6", label: "Prima Media", summary: "studio guidato, concetti astratti iniziali, metodo e disciplina dell apprendimento", subjects: ["language", "reading", "writing", "math", "science", "history", "geography", "logic", "ethics"] },
  { id: "grade_7", label: "Seconda Media", summary: "argomentazione, confronto tra ipotesi, scelte motivate e lessico piu ricco", subjects: ["language", "reading", "writing", "math", "science", "history", "geography", "logic", "ethics", "dialogue"] },
  { id: "grade_8", label: "Terza Media", summary: "sintesi, previsione, decisione, responsabilita e lettura del contesto", subjects: ["language", "reading", "writing", "math", "science", "history", "geography", "logic", "ethics", "dialogue"] },
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

export function getNyraSchoolStages(): StageDefinition[] {
  return STAGES.map((stage) => ({ ...stage, subjects: [...stage.subjects] }));
}

export function buildFoundationalLearningRecords(): NyraLearningRecord[] {
  const records: NyraLearningRecord[] = [];
  let counter = 1;

  for (const stage of STAGES) {
    for (const subject of stage.subjects) {
      const title = `${stage.label} ${subject}`;
      const coreConcepts = uniqueSorted([
        stage.label.toLowerCase(),
        subject,
        "osservazione",
        "comprensione",
        "spiegazione",
        "scenario",
        "decisione",
      ]);
      const rawText =
        `Lezione ${title}. ` +
        `In questa fase Nyra impara ${stage.summary}. ` +
        `Studia ${subject} con esempi semplici, dialoghi, piccoli esercizi, riassunti e domande guidate. ` +
        `Ogni contenuto viene trasformato in concetti, vocabolario utile, relazioni e scenari. ` +
        `Nyra deve leggere, capire, spiegare con parole chiare, prevedere una conseguenza e scegliere tra due o tre ipotesi coerenti.`;

      records.push({
        record_id: `nyra-learning:${counter++}`,
        stage_id: stage.id,
        subject,
        title,
        source_kind: subject === "dialogue" ? "dialogue" : "lesson",
        raw_text: rawText,
        concept_nodes: coreConcepts,
        vocabulary: uniqueSorted(topTerms(tokenize(rawText), 14)),
        scenario_seeds: [
          `spiega ${subject} con parole semplici`,
          `trova due ipotesi e scegli la piu coerente`,
          `descrivi causa ed effetto in ${subject}`,
        ],
        difficulty_score: Number((1 + STAGES.findIndex((entry) => entry.id === stage.id) * 0.35).toFixed(2)),
      });
    }
  }

  return records;
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

export function distillLearningPack(records: NyraLearningRecord[], ownerId = "cristian_primary", generatedAt = new Date().toISOString()): NyraLearningPack {
  const conceptWeights = new Map<string, { weight: number; firstStage: NyraLearningStageId; related: Set<string> }>();
  const vocabulary = new Set<string>();
  const scenarioTemplatesMap = new Map<string, NyraLearningPack["scenario_templates"][number]>();

  for (const record of records) {
    for (const token of record.vocabulary) vocabulary.add(token);
    for (const [index, seed] of record.scenario_seeds.entries()) {
      const key = `${record.stage_id}:${record.subject}:${seed}`;
      if (!scenarioTemplatesMap.has(key)) {
        scenarioTemplatesMap.set(key, {
          id: `scenario:${record.stage_id}:${record.subject}:${index + 1}`,
          stage_id: record.stage_id,
          subject: record.subject,
          prompt: seed,
        });
      }
    }

    for (const concept of record.concept_nodes) {
      const entry = conceptWeights.get(concept) ?? {
        weight: 0,
        firstStage: record.stage_id,
        related: new Set<string>(),
      };
      entry.weight += 1;
      if (STAGES.findIndex((stage) => stage.id === record.stage_id) < STAGES.findIndex((stage) => stage.id === entry.firstStage)) {
        entry.firstStage = record.stage_id;
      }
      for (const related of record.concept_nodes) {
        if (related !== concept) entry.related.add(related);
      }
      conceptWeights.set(concept, entry);
    }
  }

  const scenarioTemplates = [...scenarioTemplatesMap.values()].sort((a, b) =>
    `${a.stage_id}:${a.subject}:${a.prompt}`.localeCompare(`${b.stage_id}:${b.subject}:${b.prompt}`)
  );

  const semanticBase = {
    pack_version: "nyra_learning_pack_v1" as const,
    generated_at: generatedAt,
    owner_id: ownerId,
    school_range: "grade_1_to_grade_8" as const,
    records_count: records.length,
    stages: STAGES.map((stage) => ({
      stage_id: stage.id,
      label: stage.label,
      summary: stage.summary,
      subjects: [...stage.subjects],
      concept_count: uniqueSorted(records.filter((record) => record.stage_id === stage.id).flatMap((record) => record.concept_nodes)).length,
    })),
    concept_graph: [...conceptWeights.entries()]
      .map(([concept, data]) => ({
        concept,
        weight: data.weight,
        first_stage: data.firstStage,
        related_concepts: [...data.related].sort((a, b) => a.localeCompare(b)).slice(0, 8),
      }))
      .sort((a, b) => b.weight - a.weight || a.concept.localeCompare(b.concept)),
    vocabulary_index: [...vocabulary].sort((a, b) => a.localeCompare(b)),
    scenario_templates: scenarioTemplates,
  };

  const storageProfile = buildStorageProfile(JSON.stringify(records), JSON.stringify(semanticBase));

  return {
    ...semanticBase,
    storage_profile: storageProfile,
  };
}

export function saveLearningPack(path: string, pack: NyraLearningPack): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pack, null, 2));
}

export function loadLearningPack(path: string): NyraLearningPack {
  return JSON.parse(readFileSync(path, "utf8")) as NyraLearningPack;
}

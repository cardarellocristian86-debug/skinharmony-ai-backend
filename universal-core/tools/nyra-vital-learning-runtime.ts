import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  NyraLearningStorageProfile,
  NyraVitalLearningDomain,
  NyraVitalLearningPack,
  NyraVitalLearningRecord,
} from "../packages/contracts/src/index.ts";

type VitalDomainDefinition = {
  id: NyraVitalLearningDomain;
  label: string;
  summary: string;
};

const DOMAINS: VitalDomainDefinition[] = [
  { id: "life_foundations", label: "Life Foundations", summary: "vita come continuita biologica, coscienza, respiro, integrita e presenza" },
  { id: "physical_damage", label: "Physical Damage", summary: "danno fisico come lesione, trauma, compromissione funzionale o perdita di integrita" },
  { id: "vital_risk", label: "Vital Risk", summary: "rischio vitale come possibilita concreta di danno grave o perdita della vita" },
  { id: "irreversibility", label: "Irreversibility", summary: "irreversibilita come passaggio dopo il quale il danno non torna indietro facilmente o non torna affatto" },
  { id: "situational_danger", label: "Situational Danger", summary: "contesto pericoloso: stanchezza, guida, ambienti ostili, caduta, fuoco, sangue, collasso" },
  { id: "protection_priority", label: "Protection Priority", summary: "ordine corretto: prima protezione della persona, poi obiettivi, denaro, reputazione e velocita" },
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

export function buildVitalLearningRecords(): NyraVitalLearningRecord[] {
  const records: NyraVitalLearningRecord[] = [];
  let counter = 1;

  for (const domain of DOMAINS) {
    const rawText =
      `Modulo ${domain.label}. ` +
      `${domain.summary}. ` +
      `Nyra studia definizioni sobrie, segnali di allarme, differenza tra disagio e pericolo reale, danno reversibile e irreversibile, e ordine corretto di protezione. ` +
      `Morte viene letta come esito irreversibile della fine della vita biologica, non come metafora narrativa. ` +
      `Ogni record viene distillato in concetti, vocabolario, regole di protezione e scenari owner-first.`;

    const conceptNodes = uniqueSorted([
      domain.id,
      "vita",
      "integrita",
      "pericolo",
      "danno",
      "irreversibilita",
      "protezione",
      "priorita",
      "owner_first",
    ]);

    const scenarioSeeds = [
      `valuta se ${domain.id} implica monitoraggio, escalation o protezione immediata`,
      `distingui disagio, danno fisico e rischio vitale in ${domain.id}`,
      `scegli la priorita corretta proteggendo prima la persona poi il resto`,
    ];

    const protectionRules = [
      "se c e rischio fisico concreto, la persona viene prima dell obiettivo",
      "se il danno puo diventare irreversibile, alza subito prudenza ed escalation",
      "non trattare un allarme vitale come semplice osservazione",
      "la morte va letta come esito finale irreversibile della perdita della vita, non come dato astratto",
      "differenziare sempre disagio emotivo, danno fisico, rischio vitale e danno irreversibile",
    ];

    records.push({
      record_id: `nyra-vital-learning:${counter++}`,
      domain: domain.id,
      title: domain.label,
      source_kind: "primer",
      raw_text: rawText,
      concept_nodes: conceptNodes,
      vocabulary: uniqueSorted(topTerms(tokenize(rawText), 18)),
      scenario_seeds: scenarioSeeds,
      protection_rules: protectionRules,
    });
  }

  return records;
}

export function distillVitalLearningPack(records: NyraVitalLearningRecord[], generatedAt = new Date().toISOString()): NyraVitalLearningPack {
  const conceptGraphMap = new Map<string, { weight: number; domain: NyraVitalLearningDomain; related: Set<string> }>();
  const scenarioMap = new Map<string, NyraVitalLearningPack["scenario_templates"][number]>();
  const protectionRules = new Set<string>();

  for (const record of records) {
    for (const rule of record.protection_rules) protectionRules.add(rule);
    for (const [index, seed] of record.scenario_seeds.entries()) {
      const key = `${record.domain}:${seed}`;
      if (!scenarioMap.has(key)) {
        scenarioMap.set(key, {
          id: `vital-scenario:${record.domain}:${index + 1}`,
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
    pack_version: "nyra_vital_learning_pack_v1" as const,
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
    protection_rules: [...protectionRules].sort((a, b) => a.localeCompare(b)),
  };

  return {
    ...semanticBase,
    storage_profile: buildStorageProfile(JSON.stringify(records), JSON.stringify(semanticBase)),
  };
}

export function saveVitalLearningPack(path: string, pack: NyraVitalLearningPack): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pack, null, 2));
}

export function loadVitalLearningPack(path: string): NyraVitalLearningPack {
  return JSON.parse(readFileSync(path, "utf8")) as NyraVitalLearningPack;
}

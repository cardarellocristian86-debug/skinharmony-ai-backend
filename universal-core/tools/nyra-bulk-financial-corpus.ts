import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NyraFinancialLearningRecord } from "../packages/contracts/src/index.ts";
import { buildFinancialLearningRecords, distillFinancialLearningPack } from "./nyra-financial-learning-runtime.ts";
import { buildFinancialHistoryRecords, runFinancialHistoryStudy } from "./nyra-financial-history-study-runtime.ts";
import { buildBullRecoveryLowChurnRecords, runBullRecoveryLowChurnStudy } from "./nyra-bull-recovery-low-churn-study.ts";
import { buildCapitalFeeDrawdownFrontierRecords, runCapitalFeeDrawdownFrontierStudy } from "./nyra-capital-fee-drawdown-frontier-study.ts";

type BulkShardKind =
  | "summary"
  | "concept"
  | "scenario"
  | "risk_rule"
  | "vocabulary"
  | "raw_premise"
  | "cross_domain";

type BulkFinancialShard = {
  id: string;
  domain: string;
  kind: BulkShardKind;
  text: string;
  weight: number;
  source_record_id?: string;
  tags: string[];
};

type BulkFinancialCorpus = {
  version: "nyra_bulk_financial_corpus_v1";
  generated_at: string;
  source_pack_version: string;
  total_records: number;
  total_shards: number;
  domains: Array<{
    id: string;
    shard_count: number;
  }>;
  shards: BulkFinancialShard[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const UC_ROOT = join(__dirname);
const RUNTIME_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_bulk_financial_corpus_latest.json");

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function compactSentence(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function buildCrossDomainShards(records: NyraFinancialLearningRecord[]): BulkFinancialShard[] {
  const shards: BulkFinancialShard[] = [];
  const domains = new Map<string, Set<string>>();
  for (const record of records) {
    const set = domains.get(record.domain) ?? new Set<string>();
    for (const concept of record.concept_nodes.slice(0, 6)) set.add(concept);
    domains.set(record.domain, set);
  }

  const macro = domains.get("macro") ?? new Set<string>();
  const regime = domains.get("regime_detection") ?? new Set<string>();
  const risk = domains.get("risk_management") ?? new Set<string>();
  const behavioral = domains.get("behavioral") ?? new Set<string>();

  const definitions = [
    {
      domain: "macro",
      text:
        "cross: regime monetario, rischio e comportamento vanno letti insieme; tassi e liquidita cambiano il costo della prudenza e dell aggressivita.",
      tags: ["macro", "regime", "risk_management", "behavioral"],
    },
    {
      domain: "regime_detection",
      text:
        "cross: un cambio regime vale piu di un pattern locale quando macro, liquidita e comportamento divergono insieme.",
      tags: ["macro", "regime_detection", "market_structure"],
    },
    {
      domain: "risk_management",
      text:
        "cross: la prudenza giusta non e fermarsi sempre; e ridurre size e churn finche il regime non torna abbastanza chiaro.",
      tags: ["risk_management", "execution", "behavioral"],
    },
    {
      domain: "execution",
      text:
        "cross: in recovery vera il costo opportunita di aspettare troppo puo battere il beneficio di una conferma perfetta.",
      tags: ["execution", "regime_detection", "macro"],
    },
  ];

  definitions.forEach((definition, index) => {
    const related = unique([
      ...macro,
      ...regime,
      ...risk,
      ...behavioral,
    ]).slice(0, 8);
    shards.push({
      id: `bulk-cross:${index + 1}`,
      domain: definition.domain,
      kind: "cross_domain",
      text: `${definition.text} related:${related.join(",")}`,
      weight: 0.91,
      tags: definition.tags,
    });
  });

  return shards;
}

function buildShards(records: NyraFinancialLearningRecord[]): BulkFinancialShard[] {
  const shards: BulkFinancialShard[] = [];
  let counter = 1;

  for (const record of records) {
    shards.push({
      id: `bulk:${counter++}`,
      domain: record.domain,
      kind: "raw_premise",
      text: `premise:${compactSentence(record.raw_text)}`,
      weight: 1,
      source_record_id: record.record_id,
      tags: [record.domain, "premise"],
    });

    shards.push({
      id: `bulk:${counter++}`,
      domain: record.domain,
      kind: "summary",
      text: `summary:${record.title}`,
      weight: 0.92,
      source_record_id: record.record_id,
      tags: [record.domain, "summary"],
    });

    record.concept_nodes.forEach((concept, index) => {
      shards.push({
        id: `bulk:${counter++}`,
        domain: record.domain,
        kind: "concept",
        text: `concept:${concept}`,
        weight: Number((0.88 - index * 0.01).toFixed(4)),
        source_record_id: record.record_id,
        tags: [record.domain, "concept"],
      });
    });

    record.scenario_seeds.forEach((scenario, index) => {
      shards.push({
        id: `bulk:${counter++}`,
        domain: record.domain,
        kind: "scenario",
        text: `scenario:${scenario}`,
        weight: Number((0.9 - index * 0.015).toFixed(4)),
        source_record_id: record.record_id,
        tags: [record.domain, "scenario"],
      });
    });

    record.risk_rules.forEach((rule, index) => {
      shards.push({
        id: `bulk:${counter++}`,
        domain: record.domain,
        kind: "risk_rule",
        text: `risk:${rule}`,
        weight: Number((0.95 - index * 0.015).toFixed(4)),
        source_record_id: record.record_id,
        tags: [record.domain, "risk_rule"],
      });
    });

    record.vocabulary.slice(0, 18).forEach((token, index) => {
      shards.push({
        id: `bulk:${counter++}`,
        domain: record.domain,
        kind: "vocabulary",
        text: `token:${token}`,
        weight: Number((0.62 - index * 0.01).toFixed(4)),
        source_record_id: record.record_id,
        tags: [record.domain, "vocabulary"],
      });
    });
  }

  return [...shards, ...buildCrossDomainShards(records)];
}

export function runBulkFinancialCorpus(root = UC_ROOT): BulkFinancialCorpus {
  mkdirSync(join(root, "runtime", "nyra-learning"), { recursive: true });

  const baseRecords = buildFinancialLearningRecords();
  runFinancialHistoryStudy(root);
  runBullRecoveryLowChurnStudy(root);
  runCapitalFeeDrawdownFrontierStudy(root);
  const records = [
    ...baseRecords,
    ...buildFinancialHistoryRecords(),
    ...buildBullRecoveryLowChurnRecords(),
    ...buildCapitalFeeDrawdownFrontierRecords(),
  ];
  const pack = distillFinancialLearningPack(records);
  const shards = buildShards(records);

  const domainCounts = new Map<string, number>();
  for (const shard of shards) {
    domainCounts.set(shard.domain, (domainCounts.get(shard.domain) ?? 0) + 1);
  }

  const corpus: BulkFinancialCorpus = {
    version: "nyra_bulk_financial_corpus_v1",
    generated_at: new Date().toISOString(),
    source_pack_version: pack.pack_version,
    total_records: records.length,
    total_shards: shards.length,
    domains: [...domainCounts.entries()]
      .map(([id, shard_count]) => ({ id, shard_count }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    shards,
  };

  writeFileSync(join(root, "runtime", "nyra-learning", "nyra_bulk_financial_corpus_latest.json"), JSON.stringify(corpus, null, 2));
  return corpus;
}

if (process.argv[1]?.endsWith("nyra-bulk-financial-corpus.ts")) {
  const corpus = runBulkFinancialCorpus();
  console.log(JSON.stringify({
    ok: true,
    output_path: OUTPUT_PATH,
    total_records: corpus.total_records,
    total_shards: corpus.total_shards,
    top_domains: corpus.domains.slice(0, 6),
  }, null, 2));
}

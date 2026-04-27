import { brotliCompressSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type FinancialPack = {
  pack_version: string;
  domains: Array<{
    id: string;
    label?: string;
    summary?: string;
  }>;
  concept_graph?: Array<{
    concept: string;
    domain: string;
    related_concepts?: string[];
  }>;
  scenario_templates?: Array<{
    domain: string;
    prompt: string;
  }>;
  risk_rules?: string[];
};

type CompressedFinancialLogicArchive = {
  version: "nyra_compressed_financial_logic_archive_v1";
  generated_at: string;
  source_pack_version: string;
  domains: Array<{
    id: string;
    shard_count: number;
    preview_chain: string[];
    compressed_brotli_base64: string;
  }>;
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
  shards: Array<{
    id: string;
    domain: string;
    kind: string;
    text: string;
    weight: number;
    source_record_id?: string;
    tags: string[];
  }>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UC_ROOT = join(__dirname, "..");
const RUNTIME_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const PACK_PATH = join(RUNTIME_DIR, "nyra_financial_learning_pack_latest.json");
const HISTORY_PACK_PATH = join(RUNTIME_DIR, "nyra_financial_learning_with_history_latest.json");
const BULK_CORPUS_PATH = join(RUNTIME_DIR, "nyra_bulk_financial_corpus_latest.json");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_compressed_financial_logic_archive_latest.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildLogicChainFromPack(pack: FinancialPack, domainId: string): string[] {
  const domain = pack.domains.find((entry) => entry.id === domainId);
  const summary = domain?.summary ? [`summary:${domain.summary}`] : [];
  const concepts = (pack.concept_graph ?? [])
    .filter((entry) => entry.domain === domainId)
    .slice(0, 6)
    .flatMap((entry) => [
      `concept:${entry.concept}`,
      ...(entry.related_concepts ?? []).slice(0, 2).map((related) => `related:${related}`),
    ]);
  const scenarios = (pack.scenario_templates ?? [])
    .filter((entry) => entry.domain === domainId)
    .slice(0, 4)
    .map((entry) => `scenario:${entry.prompt}`);
  const riskRules = (pack.risk_rules ?? []).slice(0, 8).map((entry) => `risk:${entry}`);
  return unique([...summary, ...concepts, ...scenarios, ...riskRules]);
}

function resolvePackPath(): string {
  const preferHistory = process.argv.includes("--prefer-history");
  if (preferHistory && existsSync(HISTORY_PACK_PATH)) return HISTORY_PACK_PATH;
  return PACK_PATH;
}

function buildLogicChainFromBulk(corpus: BulkFinancialCorpus, domainId: string): string[] {
  return corpus.shards
    .filter((entry) => entry.domain === domainId)
    .sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text))
    .slice(0, 32)
    .map((entry) => entry.text);
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const packPath = resolvePackPath();
  if (!existsSync(packPath)) throw new Error(`financial_pack_missing:${packPath}`);

  const pack = readJson<FinancialPack>(packPath);
  const preferBulk = process.argv.includes("--prefer-bulk");
  const bulkCorpus =
    preferBulk && existsSync(BULK_CORPUS_PATH)
      ? readJson<BulkFinancialCorpus>(BULK_CORPUS_PATH)
      : undefined;
  const archive: CompressedFinancialLogicArchive = {
    version: "nyra_compressed_financial_logic_archive_v1",
    generated_at: new Date().toISOString(),
    source_pack_version: pack.pack_version,
    domains: pack.domains.map((domain) => {
      const logicChain = bulkCorpus
        ? buildLogicChainFromBulk(bulkCorpus, domain.id)
        : buildLogicChainFromPack(pack, domain.id);
      const payload = {
        id: domain.id,
        logic_chain: logicChain,
      };
      const compressed = brotliCompressSync(Buffer.from(JSON.stringify(payload), "utf8")).toString("base64");
      return {
        id: domain.id,
        shard_count: logicChain.length,
        preview_chain: logicChain.slice(0, 4),
        compressed_brotli_base64: compressed,
      };
    }),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(archive, null, 2));
  console.log(JSON.stringify({
    ok: true,
    source_pack_path: packPath,
    source_bulk_path: bulkCorpus ? BULK_CORPUS_PATH : null,
    output_path: OUTPUT_PATH,
    domains: archive.domains.map((entry) => ({
      id: entry.id,
      shard_count: entry.shard_count,
    })),
  }, null, 2));
}

main();

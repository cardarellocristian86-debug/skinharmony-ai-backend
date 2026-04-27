import { brotliCompressSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type AdvancedMemoryPack = {
  pack_version: string;
  generated_at: string;
  selected_domains: string[];
  domains: Array<{
    id: string;
    priority: number;
    focus: string[];
    source_count: number;
    source_urls?: string[];
    distilled_knowledge: string[];
    retained_constraints: string[];
  }>;
};

type CompressedLogicArchive = {
  version: "nyra_compressed_logic_archive_v1";
  generated_at: string;
  source_pack_version: string;
  domains: Array<{
    id: string;
    priority: number;
    shard_count: number;
    preview_chain: string[];
    compressed_brotli_base64: string;
  }>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UC_ROOT = join(__dirname, "..");
const RUNTIME_DIR = join(UC_ROOT, "runtime", "nyra-learning");
const PACK_PATH = join(RUNTIME_DIR, "nyra_advanced_memory_pack_latest.json");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_compressed_logic_archive_latest.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildLogicChain(domain: AdvancedMemoryPack["domains"][number]): string[] {
  const focus = domain.focus.slice(0, 4).map((entry) => `focus:${entry}`);
  const premises = domain.distilled_knowledge.slice(0, 6).map((entry) => `premise:${entry}`);
  const constraints = domain.retained_constraints.slice(0, 4).map((entry) => `constraint:${entry}`);
  const urls = (domain.source_urls ?? []).slice(0, 4).map((entry) => `source:${entry}`);

  return unique([
    ...focus,
    ...premises,
    ...constraints,
    ...urls,
  ]);
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  if (!existsSync(PACK_PATH)) throw new Error(`advanced_pack_missing:${PACK_PATH}`);

  const pack = readJson<AdvancedMemoryPack>(PACK_PATH);
  const archive: CompressedLogicArchive = {
    version: "nyra_compressed_logic_archive_v1",
    generated_at: new Date().toISOString(),
    source_pack_version: pack.pack_version,
    domains: pack.domains.map((domain) => {
      const logicChain = buildLogicChain(domain);
      const payload = {
        id: domain.id,
        priority: domain.priority,
        logic_chain: logicChain,
      };
      const compressed = brotliCompressSync(Buffer.from(JSON.stringify(payload), "utf8")).toString("base64");
      return {
        id: domain.id,
        priority: domain.priority,
        shard_count: logicChain.length,
        preview_chain: logicChain.slice(0, 4),
        compressed_brotli_base64: compressed,
      };
    }),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(archive, null, 2));
  console.log(JSON.stringify({
    ok: true,
    output_path: OUTPUT_PATH,
    domains: archive.domains.map((entry) => ({
      id: entry.id,
      shard_count: entry.shard_count,
    })),
  }, null, 2));
}

main();

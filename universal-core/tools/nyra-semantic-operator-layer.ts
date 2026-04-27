import { brotliDecompressSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type NyraSemanticSubstrate = {
  version?: string;
  runtime_disciplines?: Array<{
    id: string;
    rule: string;
    source_domains: string[];
  }>;
  abstraction_families?: Array<{
    id: string;
    label?: string;
    source_domains: string[];
    operators: string[];
  }>;
  transfer_routes?: Array<{
    from_domain: string;
    to_runtime: string;
    operator: string;
  }>;
  retrieval_priorities?: Array<{
    domain_id: string;
    weight: number;
    cues: string[];
  }>;
};

type CompressedLogicArchive = {
  domains: Array<{
    id: string;
    compressed_brotli_base64: string;
  }>;
};

export function resolveNyraSemanticSubstratePath(baseDir: string): string {
  return join(baseDir, "universal-core", "runtime", "nyra-learning", "nyra_semantic_substrate_latest.json");
}

function resolveNyraCompressedLogicArchivePath(baseDir: string): string {
  return join(baseDir, "universal-core", "runtime", "nyra-learning", "nyra_compressed_logic_archive_latest.json");
}

function resolveNyraCompressedFinancialLogicArchivePath(baseDir: string): string {
  return join(baseDir, "universal-core", "runtime", "nyra-learning", "nyra_compressed_financial_logic_archive_latest.json");
}

export function loadNyraSemanticSubstrate(baseDir: string): NyraSemanticSubstrate | undefined {
  const path = resolveNyraSemanticSubstratePath(baseDir);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as NyraSemanticSubstrate;
  } catch {
    return undefined;
  }
}

export function substrateRule(
  substrate: NyraSemanticSubstrate | undefined,
  id: string,
): string | undefined {
  return substrate?.runtime_disciplines?.find((entry) => entry.id === id)?.rule;
}

export function substrateUsesRuntime(
  substrate: NyraSemanticSubstrate | undefined,
  domainId: string,
  runtimeId: string,
): boolean {
  return substrate?.transfer_routes?.some((entry) => entry.from_domain === domainId && entry.to_runtime === runtimeId) ?? false;
}

export function substrateOperators(
  substrate: NyraSemanticSubstrate | undefined,
  familyId: string,
): string[] {
  return substrate?.abstraction_families?.find((entry) => entry.id === familyId)?.operators ?? [];
}

export function substrateFamilyActive(
  substrate: NyraSemanticSubstrate | undefined,
  familyId: string,
): boolean {
  return substrate?.abstraction_families?.some((entry) => entry.id === familyId) ?? false;
}

export function substrateCuesForDomain(
  substrate: NyraSemanticSubstrate | undefined,
  domainId: string,
): string[] {
  return substrate?.retrieval_priorities?.find((entry) => entry.domain_id === domainId)?.cues ?? [];
}

export function substrateCueBoost(text: string, cues: string[] | undefined): number {
  if (!cues?.length) return 0;
  return cues.reduce((score, cue) => score + (text.includes(` ${cue.toLowerCase()} `) ? 1 : 0), 0);
}

export function loadCompressedLogicChain(baseDir: string, domainId: string): string[] {
  const path = resolveNyraCompressedLogicArchivePath(baseDir);
  if (!existsSync(path)) return [];
  try {
    const archive = JSON.parse(readFileSync(path, "utf8")) as CompressedLogicArchive;
    const entry = archive.domains.find((candidate) => candidate.id === domainId);
    if (!entry?.compressed_brotli_base64) return [];
    const raw = brotliDecompressSync(Buffer.from(entry.compressed_brotli_base64, "base64")).toString("utf8");
    const parsed = JSON.parse(raw) as { logic_chain?: string[] };
    return parsed.logic_chain ?? [];
  } catch {
    return [];
  }
}

export function loadCompressedFinancialLogicChain(baseDir: string, domainId: string): string[] {
  const path = resolveNyraCompressedFinancialLogicArchivePath(baseDir);
  if (!existsSync(path)) return [];
  try {
    const archive = JSON.parse(readFileSync(path, "utf8")) as CompressedLogicArchive;
    const entry = archive.domains.find((candidate) => candidate.id === domainId);
    if (!entry?.compressed_brotli_base64) return [];
    const raw = brotliDecompressSync(Buffer.from(entry.compressed_brotli_base64, "base64")).toString("utf8");
    const parsed = JSON.parse(raw) as { logic_chain?: string[] };
    return parsed.logic_chain ?? [];
  } catch {
    return [];
  }
}

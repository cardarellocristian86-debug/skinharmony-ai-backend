import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const VECTOR_DIMENSIONS = 128;
const DEFAULT_CHUNK_CHARS = 900;
const MAX_FILE_BYTES = 512_000;

type NyraVectorScope = "shared_memory" | "runtime_learning" | "report" | "event" | "private";
type NyraVectorDomain = "nyra" | "analyzer" | "smartdesk" | "suite" | "wordpress" | "core" | "finance" | "ipad" | "general";

type NyraVectorChunk = {
  chunk_id: string;
  document_id: string;
  ordinal: number;
  text: string;
  vector: number[];
  token_count: number;
};

type NyraVectorDocument = {
  document_id: string;
  path: string;
  title: string;
  scope: NyraVectorScope;
  domain: NyraVectorDomain;
  tags: string[];
  content_hash: string;
  updated_at: string;
  chunks: NyraVectorChunk[];
};

type NyraVectorMemoryStore = {
  generated_at: string;
  source_groups: string[];
  documents: NyraVectorDocument[];
};

type NyraVectorMemoryStats = {
  documents: number;
  chunks: number;
  last_ingest_at: string | null;
};

type NyraVectorSearchOptions = {
  root_dir?: string;
  query: string;
  limit?: number;
  domain_allowlist?: NyraVectorDomain[];
  scope_allowlist?: NyraVectorScope[];
  exclude_private?: boolean;
  min_score?: number;
};

type NyraVectorSearchResult = {
  chunk_id: string;
  document_path: string;
  document_title: string;
  scope: NyraVectorScope;
  domain: NyraVectorDomain;
  tags: string[];
  score: number;
  excerpt: string;
};

function normalize(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function tokenize(text: string): string[] {
  return normalize(text).split(/\s+/).filter((token) => token.length >= 2);
}

function resolveRepoRoot(rootDir: string): string {
  const candidates = [rootDir, join(rootDir, ".."), join(rootDir, "..", "..")];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "universal-core", "runtime", "nyra"))) return resolve(candidate);
  }
  return resolve(rootDir);
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function getNyraVectorMemoryDir(rootDir = process.cwd()): string {
  return join(resolveRepoRoot(rootDir), "universal-core", "runtime", "nyra-vector-memory");
}

function getNyraVectorMemoryStorePath(rootDir = process.cwd()): string {
  return join(getNyraVectorMemoryDir(rootDir), "nyra_vector_memory.json");
}

export function getNyraVectorMemoryManifestPath(rootDir = process.cwd()): string {
  return join(getNyraVectorMemoryDir(rootDir), "nyra_vector_memory_manifest.json");
}

function buildHashedEmbedding(text: string, dims = VECTOR_DIMENSIONS): number[] {
  const vector = new Array<number>(dims).fill(0);
  const tokens = tokenize(text);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const digest = createHash("sha1").update(token).digest();
    const bucket = digest.readUInt16BE(0) % dims;
    const sign = digest[2]! % 2 === 0 ? 1 : -1;
    const weight = 1 / Math.sqrt(index + 1);
    vector[bucket] += sign * weight;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(8)));
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  for (let index = 0; index < length; index += 1) dot += (left[index] || 0) * (right[index] || 0);
  return clamp((dot + 1) / 2, 0, 1);
}

function inferScope(filePath: string): NyraVectorScope {
  const normalized = filePath.replace(/\\/g, "/");
  if (/owner-private|private/i.test(normalized)) return "private";
  if (/EVENTS\.jsonl$/i.test(normalized)) return "event";
  if (/reports\//i.test(normalized)) return "report";
  if (/runtime\/nyra-learning\//i.test(normalized)) return "runtime_learning";
  return "shared_memory";
}

function inferDomain(filePath: string, content: string): NyraVectorDomain {
  const haystack = normalize(`${filePath} ${content.slice(0, 3000)}`);
  if (/smartdesk|agenda|fleet intelligence|god mode/.test(haystack)) return "smartdesk";
  if (/suite|site suite|crm|waas/.test(haystack)) return "suite";
  if (/wordpress|plugin|wp /.test(haystack)) return "wordpress";
  if (/analyzer|skin analyzer|discromie|rossore|moondream|marker/.test(haystack)) return "analyzer";
  if (/core 2 0|universal core|branch overlay|action route|core2/.test(haystack)) return "core";
  if (/trading|market|finanza|portfolio|qqq/.test(haystack)) return "finance";
  if (/ipad|ios|swift|capture/.test(haystack)) return "ipad";
  if (/nyra|owner only|read only|god mode/.test(haystack)) return "nyra";
  return "general";
}

function inferTags(filePath: string, content: string, scope: NyraVectorScope, domain: NyraVectorDomain): string[] {
  const tags = new Set<string>([scope, domain]);
  const haystack = normalize(`${filePath} ${content.slice(0, 4000)}`);
  const evidenceMap: Array<[RegExp, string]> = [
    [/\bfix\b|\bbug\b|\balias\b|\bpatch\b|corrett/, "fix"],
    [/\btest\b|\bsmoke\b|\bverify\b|\bvalidated\b|\bpassed\b/, "test"],
    [/\bincident\b|\bissue\b|\bproblema\b|\berrore\b|\bfailure\b/, "incident"],
    [/\bstatus\b|\bstato\b|\bsnapshot\b|\boverview\b/, "status"],
  ];
  for (const [pattern, tag] of evidenceMap) if (pattern.test(haystack)) tags.add(tag);
  for (const token of ["nyra", "core", "render", "analyzer", "smartdesk", "suite", "wordpress", "memory", "local"]) {
    if (haystack.includes(token)) tags.add(token);
  }
  return Array.from(tags).slice(0, 16);
}

function titleFromPath(filePath: string, content: string): string {
  const firstHeading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (firstHeading) return firstHeading;
  return (filePath.split("/").pop() || filePath).replace(/\.[a-z0-9]+$/i, "");
}

function chunkText(content: string, maxChars = DEFAULT_CHUNK_CHARS): string[] {
  const blocks = content.split(/\n\s*\n/g).map((block) => block.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    current = block.length <= maxChars ? block : "";
    if (!current) {
      for (let index = 0; index < block.length; index += maxChars) chunks.push(block.slice(index, index + maxChars));
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function walkFiles(dir: string, predicate?: (filePath: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) out.push(...walkFiles(filePath, predicate));
    else if (!predicate || predicate(filePath)) out.push(filePath);
  }
  return out;
}

function collectSourceFiles(rootDir: string): { files: string[]; sourceGroups: string[] } {
  const repoRoot = resolveRepoRoot(rootDir);
  const sourceGroups: string[] = [];
  const files = new Set<string>();
  const reportsDir = join(repoRoot, "reports");
  if (existsSync(reportsDir)) {
    sourceGroups.push("reports");
    walkFiles(reportsDir, (filePath) => /\.(md|json)$/i.test(filePath)).forEach((file) => files.add(file));
  }
  const nyraDir = join(repoRoot, "universal-core", "runtime", "nyra");
  if (existsSync(nyraDir)) {
    sourceGroups.push("snapshots");
    walkFiles(nyraDir, (filePath) => /\.(md|json)$/i.test(filePath)).forEach((file) => files.add(file));
  }
  const learningDir = join(repoRoot, "universal-core", "runtime", "nyra-learning");
  if (existsSync(learningDir)) {
    sourceGroups.push("runtime_learning");
    walkFiles(learningDir, (filePath) => /latest\.json$/i.test(filePath)).slice(0, 60).forEach((file) => files.add(file));
  }
  return { files: Array.from(files).sort(), sourceGroups };
}

function loadStore(rootDir = process.cwd()): NyraVectorMemoryStore {
  const storePath = getNyraVectorMemoryStorePath(rootDir);
  if (!existsSync(storePath)) {
    return { generated_at: "", source_groups: [], documents: [] };
  }
  try {
    return JSON.parse(readFileSync(storePath, "utf8")) as NyraVectorMemoryStore;
  } catch {
    return { generated_at: "", source_groups: [], documents: [] };
  }
}

function saveStore(rootDir: string, store: NyraVectorMemoryStore) {
  const storePath = getNyraVectorMemoryStorePath(rootDir);
  ensureDir(dirname(storePath));
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function writeManifest(rootDir: string, payload: unknown) {
  const manifestPath = getNyraVectorMemoryManifestPath(rootDir);
  ensureDir(dirname(manifestPath));
  writeFileSync(manifestPath, JSON.stringify(payload, null, 2));
}

export function getNyraVectorMemoryStats(rootDir = process.cwd()): NyraVectorMemoryStats {
  const store = loadStore(rootDir);
  const documents = store.documents.length;
  const chunks = store.documents.reduce((sum, document) => sum + document.chunks.length, 0);
  return { documents, chunks, last_ingest_at: store.generated_at || null };
}

export function ingestNyraVectorMemory(rootDir = process.cwd()) {
  const repoRoot = resolveRepoRoot(rootDir);
  const { files, sourceGroups } = collectSourceFiles(rootDir);
  let docs = 0;
  let chunks = 0;
  let skippedLargeFiles = 0;
  const documents: NyraVectorDocument[] = [];

  for (const filePath of files) {
    const stats = statSync(filePath);
    if (stats.size > MAX_FILE_BYTES) {
      skippedLargeFiles += 1;
      continue;
    }
    const content = readFileSync(filePath, "utf8");
    const relativePath = relative(repoRoot, filePath) || filePath;
    const scope = inferScope(relativePath);
    const domain = inferDomain(relativePath, content);
    const tags = inferTags(relativePath, content, scope, domain);
    const title = titleFromPath(relativePath, content);
    const documentId = sha1(relativePath);
    const documentChunks = chunkText(content).map((text, index) => ({
      chunk_id: sha1(`${documentId}:${index}:${text}`),
      document_id: documentId,
      ordinal: index,
      text,
      vector: buildHashedEmbedding(text),
      token_count: tokenize(text).length,
    }));

    documents.push({
      document_id: documentId,
      path: relativePath,
      title,
      scope,
      domain,
      tags,
      content_hash: sha1(content),
      updated_at: new Date(stats.mtimeMs).toISOString(),
      chunks: documentChunks,
    });
    docs += 1;
    chunks += documentChunks.length;
  }

  const generatedAt = new Date().toISOString();
  const store: NyraVectorMemoryStore = { generated_at: generatedAt, source_groups: sourceGroups, documents };
  saveStore(rootDir, store);
  const stats = getNyraVectorMemoryStats(rootDir);
  writeManifest(rootDir, {
    generated_at: generatedAt,
    store_path: getNyraVectorMemoryStorePath(rootDir),
    documents: stats.documents,
    chunks: stats.chunks,
    source_groups: sourceGroups,
  });
  return {
    mode: "nyra_vector_memory_ingest",
    store_path: getNyraVectorMemoryStorePath(rootDir),
    manifest_path: getNyraVectorMemoryManifestPath(rootDir),
    stats,
    ingested: { documents: docs, chunks, skipped_large_files: skippedLargeFiles, source_groups: sourceGroups },
  };
}

export function searchNyraVectorMemory(input: NyraVectorSearchOptions): NyraVectorSearchResult[] {
  const rootDir = input.root_dir ?? process.cwd();
  const store = loadStore(rootDir);
  const normalizedQuery = normalize(input.query);
  const queryVector = buildHashedEmbedding(input.query);
  const limit = input.limit ?? 5;
  const minScore = input.min_score ?? 0.5;

  return store.documents
    .filter((document) => !(input.exclude_private ?? true) || document.scope !== "private")
    .filter((document) => !input.domain_allowlist?.length || input.domain_allowlist.includes(document.domain))
    .filter((document) => !input.scope_allowlist?.length || input.scope_allowlist.includes(document.scope))
    .flatMap((document) =>
      document.chunks.map((chunk) => {
        const excerpt = chunk.text.replace(/\s+/g, " ").trim();
        const titleHits = tokenize(input.query).filter((token) => normalize(document.title).includes(token)).length;
        const excerptHits = tokenize(input.query).filter((token) => normalize(excerpt).includes(token)).length;
        const evidenceBonus =
          ((normalizedQuery.includes("fix") || normalizedQuery.includes("bug") || normalizedQuery.includes("alias")) && document.tags.includes("fix") ? 0.08 : 0) +
          ((normalizedQuery.includes("test") || normalizedQuery.includes("smoke") || normalizedQuery.includes("verify")) && document.tags.includes("test") ? 0.06 : 0) +
          ((normalizedQuery.includes("problema") || normalizedQuery.includes("errore") || normalizedQuery.includes("incident")) && document.tags.includes("incident") ? 0.05 : 0) +
          ((normalizedQuery.includes("stato") || normalizedQuery.includes("status")) && document.tags.includes("status") ? 0.04 : 0);
        const score = clamp(cosineSimilarity(queryVector, chunk.vector) + titleHits * 0.03 + excerptHits * 0.015 + evidenceBonus, 0, 1);
        return {
          chunk_id: chunk.chunk_id,
          document_path: document.path,
          document_title: document.title,
          scope: document.scope,
          domain: document.domain,
          tags: document.tags,
          score,
          excerpt: excerpt.slice(0, 280),
        };
      }),
    )
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score || a.document_path.localeCompare(b.document_path))
    .slice(0, limit);
}

export function summarizeNyraVectorMemory(rootDir = process.cwd()): string {
  const stats = getNyraVectorMemoryStats(rootDir);
  return [`documents=${stats.documents}`, `chunks=${stats.chunks}`, stats.last_ingest_at ? `last_ingest_at=${stats.last_ingest_at}` : ""].filter(Boolean).join(" ");
}

export function summarizeNyraVectorRetrievalContext(input: NyraVectorSearchOptions): string {
  const results = searchNyraVectorMemory(input);
  if (!results.length) return "";
  return `Memoria semantica utile: ${results.slice(0, 2).map((row) => `[${row.domain}/${row.scope}] ${row.document_title}: ${row.excerpt}`).join(" | ")}`;
}

export function refreshNyraVectorMemoryIfStale(rootDir = process.cwd(), maxAgeMinutes = 180) {
  const manifestPath = getNyraVectorMemoryManifestPath(rootDir);
  if (!existsSync(manifestPath)) {
    const ingest = ingestNyraVectorMemory(rootDir);
    return { mode: "nyra_vector_memory_refresh_if_stale", refreshed: true, reason: "missing_manifest", max_age_minutes: maxAgeMinutes, current_summary_before: "documents=0 chunks=0", ingest, stats_after: ingest.stats };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { generated_at?: string };
  const ageMs = Date.now() - Date.parse(String(manifest.generated_at || 0));
  if (!Number.isFinite(ageMs) || ageMs > maxAgeMinutes * 60_000) {
    const before = summarizeNyraVectorMemory(rootDir);
    const ingest = ingestNyraVectorMemory(rootDir);
    return { mode: "nyra_vector_memory_refresh_if_stale", refreshed: true, reason: "stale_manifest", max_age_minutes: maxAgeMinutes, current_summary_before: before, ingest, stats_after: ingest.stats };
  }
  return { mode: "nyra_vector_memory_refresh_if_stale", refreshed: false, reason: "fresh_manifest", max_age_minutes: maxAgeMinutes, current_summary_before: summarizeNyraVectorMemory(rootDir), stats_after: getNyraVectorMemoryStats(rootDir) };
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]!;
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  const [command = "stats"] = process.argv.slice(2).filter((item) => !item.startsWith("--"));
  const flags = parseArgs(process.argv.slice(2));
  const rootDir = String(flags.root_dir || process.cwd());
  if (command === "ingest") {
    console.log(JSON.stringify(ingestNyraVectorMemory(rootDir), null, 2));
  } else if (command === "refresh-if-stale") {
    console.log(JSON.stringify(refreshNyraVectorMemoryIfStale(rootDir, Number(flags["max-age-minutes"] || 180)), null, 2));
  } else if (command === "search") {
    console.log(JSON.stringify(searchNyraVectorMemory({ root_dir: rootDir, query: String(flags.query || ""), limit: Number(flags.limit || 5), exclude_private: true }), null, 2));
  } else {
    console.log(JSON.stringify({ path: getNyraVectorMemoryStorePath(rootDir), summary: summarizeNyraVectorMemory(rootDir), stats: getNyraVectorMemoryStats(rootDir) }, null, 2));
  }
}

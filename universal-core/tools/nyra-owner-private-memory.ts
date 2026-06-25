import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export type NyraOwnerMemoryKind =
  | "preference"
  | "decision_pattern"
  | "boundary"
  | "correction"
  | "command_example"
  | "learning_need";

export type NyraOwnerMemoryEntry = {
  id: string;
  ts: string;
  kind: NyraOwnerMemoryKind;
  summary: string;
  tags: string[];
  confidence: number;
  source: "owner_explicit" | "codex_session" | "test";
  private: true;
  secrets_redacted: true;
};

export type NyraOwnerMemoryStore = {
  schema: "nyra_owner_private_memory_v1";
  generated_at: string;
  updated_at: string;
  local_only: true;
  sync_remote: false;
  entries: NyraOwnerMemoryEntry[];
};

export type NyraOwnerMemoryStatus = {
  path: string;
  exists: boolean;
  entries: number;
  write_enabled: boolean;
  local_only: true;
  sync_remote: false;
};

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_OPENAI_KEY]"],
  [/\bshx-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_SH_KEY]"],
  [/\b[A-Za-z0-9_]*API[_-]?KEY\s*[:=]\s*["']?[^"',\s]+/gi, "API_KEY=[REDACTED]"],
  [/\b[A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD)\s*[:=]\s*["']?[^"',\s]+/gi, "$1=[REDACTED]"],
];

function resolveCoreDir(rootDir: string): string {
  if (rootDir.endsWith("universal-core-2.0")) return rootDir;
  if (existsSync(join(rootDir, "universal-core-2.0", "runtime"))) return join(rootDir, "universal-core-2.0");
  return rootDir;
}

function redact(value: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function safeId(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "entry";
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getNyraOwnerPrivateMemoryPath(rootDir = process.cwd()): string {
  return join(resolveCoreDir(rootDir), "runtime", "nyra-owner-private", "nyra_owner_private_memory.json");
}

function emptyStore(): NyraOwnerMemoryStore {
  const now = new Date().toISOString();
  return {
    schema: "nyra_owner_private_memory_v1",
    generated_at: now,
    updated_at: now,
    local_only: true,
    sync_remote: false,
    entries: [],
  };
}

export function loadNyraOwnerPrivateMemory(rootDir = process.cwd()): NyraOwnerMemoryStore {
  const path = getNyraOwnerPrivateMemoryPath(rootDir);
  if (!existsSync(path)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as NyraOwnerMemoryStore;
    return {
      ...emptyStore(),
      ...parsed,
      local_only: true,
      sync_remote: false,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return emptyStore();
  }
}

export function getNyraOwnerPrivateMemoryStatus(rootDir = process.cwd()): NyraOwnerMemoryStatus {
  const path = getNyraOwnerPrivateMemoryPath(rootDir);
  return {
    path,
    exists: existsSync(path),
    entries: loadNyraOwnerPrivateMemory(rootDir).entries.length,
    write_enabled: process.env.NYRA_OWNER_MEMORY_WRITE === "1",
    local_only: true,
    sync_remote: false,
  };
}

export function appendNyraOwnerPrivateMemory(input: {
  root_dir?: string;
  kind: NyraOwnerMemoryKind;
  summary: string;
  tags?: string[];
  confidence?: number;
  source?: NyraOwnerMemoryEntry["source"];
  allow_write?: boolean;
}): { written: boolean; path: string; entry?: NyraOwnerMemoryEntry; reason?: string } {
  const rootDir = input.root_dir ?? process.cwd();
  const path = getNyraOwnerPrivateMemoryPath(rootDir);
  const writeEnabled = input.allow_write ?? process.env.NYRA_OWNER_MEMORY_WRITE === "1";
  if (!writeEnabled) {
    return { written: false, path, reason: "owner_private_memory_write_disabled" };
  }

  const store = loadNyraOwnerPrivateMemory(rootDir);
  const summary = redact(input.summary).replace(/\s+/g, " ").trim();
  const entry: NyraOwnerMemoryEntry = {
    id: `${safeId(input.kind)}_${safeId(summary)}_${Date.now()}`,
    ts: new Date().toISOString(),
    kind: input.kind,
    summary,
    tags: (input.tags ?? []).map((tag) => safeId(tag)).filter(Boolean).slice(0, 12),
    confidence: Math.max(0, Math.min(100, Number(input.confidence ?? 80))),
    source: input.source ?? "owner_explicit",
    private: true,
    secrets_redacted: true,
  };

  const nextStore: NyraOwnerMemoryStore = {
    ...store,
    updated_at: entry.ts,
    local_only: true,
    sync_remote: false,
    entries: [...store.entries, entry].slice(-500),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(nextStore, null, 2));
  return { written: true, path, entry };
}

export function queryNyraOwnerPrivateMemory(input: {
  root_dir?: string;
  query: string;
  limit?: number;
}): NyraOwnerMemoryEntry[] {
  const store = loadNyraOwnerPrivateMemory(input.root_dir ?? process.cwd());
  const queryTokens = new Set(normalize(input.query).split(/\s+/).filter((token) => token.length >= 4));
  const scored = store.entries.map((entry) => {
    const haystack = normalize(`${entry.summary} ${entry.tags.join(" ")}`);
    const score = Array.from(queryTokens).filter((token) => haystack.includes(token)).length + entry.confidence / 100;
    return { entry, score };
  });

  return scored
    .filter((item) => item.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 5)
    .map((item) => item.entry);
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  const userText = process.argv.slice(2).join(" ").trim();
  console.log(JSON.stringify({
    status: getNyraOwnerPrivateMemoryStatus(process.cwd()),
    matches: userText ? queryNyraOwnerPrivateMemory({ query: userText }) : [],
  }, null, 2));
}

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendNyraOwnerPrivateMemory,
  loadNyraOwnerPrivateMemory,
} from "./nyra-owner-private-memory.ts";

export type NyraCodexMemoryRule = {
  id: string;
  summary: string;
  evidence_count: number;
  confidence: number;
  tags: string[];
};

export type NyraCodexMemoryCommandExample = {
  id: string;
  title: string;
  request: string;
  success: string;
  scopes: string[];
  risk_flags: string[];
  source_file: string;
  confidence: number;
};

export type NyraCodexWorkMemory = {
  schema: "nyra_codex_work_memory_v1";
  generated_at: string;
  source: "SHARED_MEMORY";
  local_only: true;
  sync_remote: false;
  stats: {
    event_lines_seen: number;
    events_imported: number;
    task_contracts_imported: number;
    final_reports_imported: number;
    owner_private_entries_seeded: number;
  };
  boundaries: string[];
  stable_rules: NyraCodexMemoryRule[];
  command_examples: NyraCodexMemoryCommandExample[];
  recent_work: Array<{
    ts?: string;
    type?: string;
    program?: string;
    summary: string;
    source_file: string;
  }>;
  program_contexts: Array<{
    id: string;
    summary: string;
    source_file: string;
  }>;
  next_learning: string[];
  render_alignment_note: string;
};

export type NyraCodexMemoryImportResult = {
  mode: "nyra_codex_memory_import";
  path: string;
  memory: NyraCodexWorkMemory;
  owner_private_memory_path: string;
};

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_OPENAI_KEY]"],
  [/\bshx-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_SH_KEY]"],
  [/\b[A-Za-z0-9_]*API[_-]?KEY\s*[:=]\s*["']?[^"',\s]+/gi, "API_KEY=[REDACTED]"],
  [/\b[A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD)\s*[:=]\s*["']?[^"',\s]+/gi, "$1=[REDACTED]"],
  [/\b(BEARER)\s+[A-Za-z0-9._-]{12,}/gi, "$1 [REDACTED]"],
];

const BOUNDARIES = [
  "Core decide e seleziona; Nyra legge, collega e guida; Codex implementa e verifica.",
  "Render, deploy, chiavi, clienti reali, prezzi e produzione restano fuori dal ciclo locale senza Core gate e conferma owner.",
  "Nyra non deve montare SHARED_MEMORY grezza: deve usare memoria distillata, redatta e verificabile.",
  "Ogni lavoro Codex importante deve chiudere con test, evento/checkpoint/finalize o motivo esplicito.",
  "La memoria Codex locale serve prima nel laboratorio; quando Nyra sara allineata su Render potra ricevere contesti Suite, SkinHarmony Core e software collegati tramite fase separata.",
];

function redact(value: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function compact(text: string, maxLength = 700): string {
  return redact(text).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeId(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72) || "item";
}

function readText(path: string, maxLength = 20000): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").slice(0, maxLength);
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function resolveWorkspaceRoot(rootDir: string): string {
  const candidates = [
    rootDir,
    join(rootDir, ".."),
    join(rootDir, "..", ".."),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "SHARED_MEMORY"))) return candidate;
  }
  return rootDir;
}

function resolveCoreDir(rootDir: string): string {
  const candidates = [
    rootDir,
    join(rootDir, "universal-core-2.0"),
    join(rootDir, "..", "universal-core-2.0"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "runtime", "nyra-learning"))) return candidate;
  }
  return rootDir;
}

export function getNyraCodexWorkMemoryPath(rootDir = process.cwd()): string {
  return join(resolveCoreDir(rootDir), "runtime", "nyra-learning", "nyra_codex_work_memory_latest.json");
}

function listFiles(dir: string, predicate: (name: string) => boolean, limit = 80): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(predicate)
    .map((name) => join(dir, name))
    .filter((path) => existsSync(path) && statSync(path).isFile())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, limit);
}

function parseRecentEvents(eventsPath: string, eventLimit: number): { total: number; imported: NyraCodexWorkMemory["recent_work"] } {
  if (!existsSync(eventsPath)) return { total: 0, imported: [] };
  const lines = readFileSync(eventsPath, "utf8").split(/\n/).filter(Boolean);
  const imported = lines.slice(-eventLimit).flatMap((line) => {
    try {
      const event = JSON.parse(line) as {
        ts?: string;
        type?: string;
        event?: string;
        program?: string;
        summary?: string;
        title?: string;
        request?: string;
        agent_id?: string;
      };
      const type = event.type ?? event.event ?? "";
      const summary = compact(event.summary ?? event.title ?? event.request ?? type, 520);
      if (!summary || /lock_acquired|lock_released|session_started|checklist_written/.test(type)) return [];
      return [{
        ts: event.ts,
        type,
        program: event.program,
        summary,
        source_file: "SHARED_MEMORY/events/EVENTS.jsonl",
      }];
    } catch {
      return [];
    }
  });
  return { total: lines.length, imported: imported.slice(-120).reverse() };
}

function detectRiskFlags(text: string): string[] {
  const normalized = text.toLowerCase();
  const flags: string[] = [];
  if (/render|deploy|produzione|production/.test(normalized)) flags.push("render_or_production");
  if (/key|chiav|token|secret|password/.test(normalized)) flags.push("keys_or_secrets");
  if (/prezz|pricing|checkout|pagament/.test(normalized)) flags.push("pricing_or_payment");
  if (/cliente|tenant|customer/.test(normalized)) flags.push("customer_or_tenant");
  if (/core gate|gate core|conferma|owner/.test(normalized)) flags.push("core_or_owner_confirmation");
  return flags;
}

function importTaskContracts(sharedDir: string, limit: number): NyraCodexMemoryCommandExample[] {
  const files = listFiles(join(sharedDir, "task-contracts"), (name) => name.endsWith("_task_contract.json"), limit);
  return files.flatMap((path) => {
    const raw = readJson(path) as
      | {
          contract_id?: string;
          title?: string;
          request?: string;
          success_criteria?: string;
          allowed_paths?: string[];
        }
      | undefined;
    if (!raw?.request) return [];
    const title = compact(raw.title ?? raw.contract_id ?? "task Codex", 140);
    const request = compact(raw.request, 700);
    const success = compact(raw.success_criteria ?? "", 500);
    return [{
      id: safeId(raw.contract_id ?? title),
      title,
      request,
      success,
      scopes: (raw.allowed_paths ?? []).filter((item) => !/[.]env|secret|private|node_modules|[.]git/i.test(item)).slice(0, 8),
      risk_flags: detectRiskFlags(`${title} ${request} ${success}`),
      source_file: path.replace(`${sharedDir}/`, "SHARED_MEMORY/"),
      confidence: 68,
    }];
  });
}

function importProgramContexts(sharedDir: string): NyraCodexWorkMemory["program_contexts"] {
  const candidates = [
    ["universal-core", join(sharedDir, "programs", "universal-core", "PROGRAM.md")],
    ["universal-core-architecture", join(sharedDir, "programs", "universal-core", "ARCHITECTURE.md")],
    ["smartdesk", join(sharedDir, "programs", "smartdesk", "PROGRAM.md")],
    ["smartdesk-architecture", join(sharedDir, "programs", "smartdesk", "ARCHITECTURE.md")],
    ["suite", join(sharedDir, "programs", "suite", "PROGRAM.md")],
    ["suite-architecture", join(sharedDir, "programs", "suite", "ARCHITECTURE.md")],
  ];
  return candidates.flatMap(([id, path]) => {
    const text = readText(path, 8000);
    if (!text) return [];
    return [{
      id,
      summary: compact(text, 900),
      source_file: path.replace(`${sharedDir}/`, "SHARED_MEMORY/"),
    }];
  });
}

function importFinalReports(sharedDir: string, limit: number): NyraCodexWorkMemory["recent_work"] {
  return listFiles(join(sharedDir, "reports", "codex-orchestrator"), (name) => name.endsWith("_final.md"), limit).flatMap((path) => {
    const text = readText(path, 12000);
    const title = text.match(/^#\s+(.+)$/m)?.[1] ?? path.split("/").pop() ?? "final report";
    const summary = text.match(/summary\s*[:#-]?\s*(.+)/i)?.[1] ?? text.slice(0, 900);
    return [{
      type: "codex_final_report",
      summary: compact(`${title}: ${summary}`, 700),
      source_file: path.replace(`${sharedDir}/`, "SHARED_MEMORY/"),
    }];
  });
}

function countEvidence(workspaceText: string, terms: string[]): number {
  const normalized = workspaceText.toLowerCase();
  return terms.reduce((count, term) => count + (normalized.includes(term) ? 1 : 0), 0);
}

function buildStableRules(workspaceText: string): NyraCodexMemoryRule[] {
  const rules = [
    {
      id: "core_gate_sensitive_actions",
      summary: "Azioni sensibili passano da Core gate e, se richiesto, conferma owner: deploy, produzione, chiavi, pricing, clienti e tenant.",
      tags: ["core_gate", "safety", "owner_confirmation"],
      terms: ["core gate", "deploy", "produzione", "pricing", "chiavi", "cliente", "tenant"],
    },
    {
      id: "local_first_nyra_core2",
      summary: "Per Nyra/Core si lavora prima in locale su universal-core-2.0; Render arriva solo dopo fase separata di allineamento.",
      tags: ["local_first", "nyra", "render_boundary"],
      terms: ["universal-core-2.0", "render", "locale", "nyra"],
    },
    {
      id: "distill_not_raw_memory",
      summary: "La memoria Codex va distillata: snapshot, eventi e report diventano regole/esempi redatti, non prompt grezzo.",
      tags: ["memory", "redaction", "distillation"],
      terms: ["snapshot", "events", "report", "redatt", "distill"],
    },
    {
      id: "codex_implements_and_verifies",
      summary: "Codex implementa solo dopo contesto/variante scelta e chiude con test, checkpoint, finalize o report.",
      tags: ["codex", "verify", "finalize"],
      terms: ["test", "checkpoint", "finalize", "report", "codex"],
    },
    {
      id: "nyra_no_autonomy_claim",
      summary: "Nyra puo guidare e apprendere come memoria operativa, ma non deve promettere autonomia generale o coscienza.",
      tags: ["nyra", "boundary", "claim_safe"],
      terms: ["autonomia", "coscienza", "self-model", "claim"],
    },
  ];
  return rules.map((rule) => {
    const evidence = countEvidence(workspaceText, rule.terms);
    return {
      id: rule.id,
      summary: rule.summary,
      evidence_count: evidence,
      confidence: Math.min(92, 62 + evidence * 4),
      tags: rule.tags,
    };
  });
}

function seedOwnerPrivateMemory(rootDir: string, rules: NyraCodexMemoryRule[]): { count: number; path: string } {
  const existing = loadNyraOwnerPrivateMemory(rootDir);
  const existingSummaries = new Set(existing.entries.map((entry) => entry.summary));
  let count = 0;
  let path = "";

  for (const rule of rules.filter((item) => item.confidence >= 70)) {
    if (existingSummaries.has(rule.summary)) continue;
    const result = appendNyraOwnerPrivateMemory({
      root_dir: rootDir,
      kind: rule.tags.includes("safety") || rule.tags.includes("boundary") ? "boundary" : "decision_pattern",
      summary: rule.summary,
      tags: ["codex_memory", ...rule.tags],
      confidence: Math.min(rule.confidence, 82),
      source: "codex_session",
      allow_write: true,
    });
    path = result.path;
    if (result.written) count += 1;
  }

  return { count, path: path || "" };
}

export function importNyraCodexWorkMemory(input: {
  root_dir?: string;
  event_limit?: number;
  contract_limit?: number;
  final_report_limit?: number;
  populate_owner_private?: boolean;
} = {}): NyraCodexMemoryImportResult {
  const rootDir = input.root_dir ?? process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(rootDir);
  const coreDir = resolveCoreDir(rootDir);
  const sharedDir = join(workspaceRoot, "SHARED_MEMORY");
  const memoryPath = getNyraCodexWorkMemoryPath(coreDir);

  const eventImport = parseRecentEvents(join(sharedDir, "events", "EVENTS.jsonl"), input.event_limit ?? 900);
  const commandExamples = importTaskContracts(sharedDir, input.contract_limit ?? 90);
  const finalReports = importFinalReports(sharedDir, input.final_report_limit ?? 40);
  const programContexts = importProgramContexts(sharedDir);
  const snapshotText = [
    readText(join(sharedDir, "snapshots", "MAP_SNAPSHOT.md"), 12000),
    readText(join(sharedDir, "snapshots", "STATE_SNAPSHOT.md"), 12000),
    readText(join(sharedDir, "snapshots", "WORK_SNAPSHOT.md"), 12000),
  ].join("\n");
  const workspaceText = compact([
    snapshotText,
    eventImport.imported.map((item) => item.summary).join("\n"),
    commandExamples.map((item) => `${item.title} ${item.request} ${item.success}`).join("\n"),
    finalReports.map((item) => item.summary).join("\n"),
  ].join("\n"), 60000);

  const stableRules = buildStableRules(workspaceText);
  const ownerSeed = input.populate_owner_private === false
    ? { count: 0, path: "" }
    : seedOwnerPrivateMemory(coreDir, stableRules);

  const memory: NyraCodexWorkMemory = {
    schema: "nyra_codex_work_memory_v1",
    generated_at: new Date().toISOString(),
    source: "SHARED_MEMORY",
    local_only: true,
    sync_remote: false,
    stats: {
      event_lines_seen: eventImport.total,
      events_imported: eventImport.imported.length,
      task_contracts_imported: commandExamples.length,
      final_reports_imported: finalReports.length,
      owner_private_entries_seeded: ownerSeed.count,
    },
    boundaries: BOUNDARIES,
    stable_rules: stableRules,
    command_examples: commandExamples,
    recent_work: [...eventImport.imported, ...finalReports].slice(0, 180),
    program_contexts: programContexts,
    next_learning: [
      "Durante ogni lavoro locale, aggiornare questo pack da SHARED_MEMORY prima di rispondere come governance.",
      "Trasformare comandi ripetuti in esempi comando-rischio-Core-conferma-test.",
      "Portare su Render solo in una fase separata: importer, policy, audit e contesti Suite/SkinHarmony Core devono essere verificati prima.",
      "Mantenere separata memoria Codex operativa da memoria owner privata ad alta fiducia.",
    ],
    render_alignment_note: "Oggi apprendimento locale su Codex/SHARED_MEMORY. Quando si allinea Nyra su Render, i contesti Suite, SkinHarmony Core, Smart Desk e altri software dovranno entrare tramite pack distillati e gate separato.",
  };

  mkdirSync(dirname(memoryPath), { recursive: true });
  writeFileSync(memoryPath, JSON.stringify(memory, null, 2));

  return {
    mode: "nyra_codex_memory_import",
    path: memoryPath,
    memory,
    owner_private_memory_path: ownerSeed.path || join(coreDir, "runtime", "nyra-owner-private", "nyra_owner_private_memory.json"),
  };
}

export function summarizeNyraCodexWorkMemory(rootDir = process.cwd()): string {
  const path = getNyraCodexWorkMemoryPath(rootDir);
  const memory = readJson(path) as NyraCodexWorkMemory | undefined;
  if (!memory?.schema) return "";
  const topRules = (memory.stable_rules ?? [])
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4)
    .map((rule) => `${rule.id}:${rule.confidence}`);
  const topExamples = (memory.command_examples ?? [])
    .slice(0, 4)
    .map((example) => example.title);
  return compact([
    `generated_at=${memory.generated_at}`,
    `events=${memory.stats?.event_lines_seen ?? 0}/${memory.stats?.events_imported ?? 0}`,
    `contracts=${memory.stats?.task_contracts_imported ?? 0}`,
    `reports=${memory.stats?.final_reports_imported ?? 0}`,
    topRules.length ? `rules=${topRules.join(", ")}` : "",
    topExamples.length ? `examples=${topExamples.join(" | ")}` : "",
    `boundary=${memory.boundaries?.[0] ?? ""}`,
  ].filter(Boolean).join(" "), 1800);
}

function numberArg(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) return fallback;
  const parsed = Number(args[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringArg(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectRun) {
  const args = process.argv.slice(2);
  const rootDir = stringArg(args, "--root", process.cwd());
  const result = importNyraCodexWorkMemory({
    root_dir: rootDir,
    event_limit: numberArg(args, "--event-limit", 900),
    contract_limit: numberArg(args, "--contract-limit", 90),
    final_report_limit: numberArg(args, "--final-report-limit", 40),
    populate_owner_private: !args.includes("--no-owner-seed"),
  });
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : summarizeNyraCodexWorkMemory(rootDir));
}

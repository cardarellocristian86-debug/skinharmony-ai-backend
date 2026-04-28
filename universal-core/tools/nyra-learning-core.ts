import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type NyraLearningRuleStatus = "active" | "quarantine" | "retired";

export interface NyraLearningRule {
  id: string;
  channel: string;
  domain: string;
  trigger: string;
  avoid: string[];
  prefer: string[];
  correction: string;
  confidence: number;
  uses: number;
  successes: number;
  failures: number;
  status: NyraLearningRuleStatus;
  createdAt: number;
  updatedAt: number;
}

export interface NyraLearningLastInteraction {
  channel: string;
  domain: string;
  inputText: string;
  outputText: string;
  appliedRuleIds: string[];
  critiqueIssues: string[];
  timestamp: number;
}

export interface NyraLearningStore {
  version: 1;
  rules: NyraLearningRule[];
  quarantinedNotes: string[];
  lastInteraction: NyraLearningLastInteraction | null;
  updatedAt: number;
}

export interface NyraLearningRuleInput {
  channel: string;
  domain: string;
  trigger: string;
  correction: string;
  avoid?: string[];
  prefer?: string[];
  confidence?: number;
  status?: NyraLearningRuleStatus;
}

export interface NyraLearningRuleMatchParams {
  channel: string;
  domain: string;
  inputText: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function storagePath(...parts: string[]): string {
  const storageRoot = process.env.NYRA_STORAGE_ROOT?.trim();
  if (storageRoot) return join(storageRoot, ...parts);
  return join(__dirname, "..", ...parts);
}

const STORE_PATH = storagePath("runtime", "nyra", "nyra_learning_core.json");

function now(): number {
  return Date.now();
}

function defaultStore(): NyraLearningStore {
  return {
    version: 1,
    rules: [],
    quarantinedNotes: [],
    lastInteraction: null,
    updatedAt: now(),
  };
}

function makeId(): string {
  return `learn_${now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeTokens(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-zA-ZÀ-ÿ0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 10)
    .join(" ");
}

export function buildNyraLearningTrigger(text: string): string {
  return normalizeTokens(text);
}

async function ensureStoreDir(): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
}

export async function readNyraLearningStore(): Promise<NyraLearningStore> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<NyraLearningStore>;
    return {
      ...defaultStore(),
      ...parsed,
      rules: parsed.rules ?? [],
      quarantinedNotes: parsed.quarantinedNotes ?? [],
      lastInteraction: parsed.lastInteraction ?? null,
    };
  } catch {
    return defaultStore();
  }
}

export async function writeNyraLearningStore(store: NyraLearningStore): Promise<void> {
  await ensureStoreDir();
  store.updatedAt = now();
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export async function clearNyraLearningStore(): Promise<void> {
  await writeNyraLearningStore(defaultStore());
}

export async function rememberNyraLearningInteraction(params: {
  channel: string;
  domain: string;
  inputText: string;
  outputText: string;
  appliedRuleIds: string[];
  critiqueIssues: string[];
}): Promise<void> {
  const store = await readNyraLearningStore();
  store.lastInteraction = {
    channel: params.channel,
    domain: params.domain,
    inputText: params.inputText,
    outputText: params.outputText,
    appliedRuleIds: params.appliedRuleIds,
    critiqueIssues: params.critiqueIssues,
    timestamp: now(),
  };
  await writeNyraLearningStore(store);
}

export async function addNyraLearningRule(params: NyraLearningRuleInput): Promise<NyraLearningRule> {
  const store = await readNyraLearningStore();
  const normalizedTrigger = buildNyraLearningTrigger(params.trigger);
  const correction = params.correction.trim();
  const existing = store.rules.find(
    (rule) =>
      rule.channel === params.channel &&
      rule.domain === params.domain &&
      rule.trigger === normalizedTrigger &&
      rule.status !== "retired",
  );

  if (existing) {
    existing.correction = correction;
    existing.avoid = Array.from(new Set([...(existing.avoid ?? []), ...(params.avoid ?? [])]));
    existing.prefer = Array.from(new Set([...(existing.prefer ?? []), ...(params.prefer ?? [])]));
    existing.confidence = Math.min(0.99, Math.max(existing.confidence, params.confidence ?? 0.75));
    existing.status = params.status ?? existing.status;
    existing.updatedAt = now();
    await writeNyraLearningStore(store);
    return existing;
  }

  const rule: NyraLearningRule = {
    id: makeId(),
    channel: params.channel,
    domain: params.domain,
    trigger: normalizedTrigger,
    avoid: params.avoid ?? [],
    prefer: params.prefer ?? [],
    correction,
    confidence: params.confidence ?? 0.75,
    uses: 0,
    successes: 0,
    failures: 0,
    status: params.status ?? "active",
    createdAt: now(),
    updatedAt: now(),
  };

  store.rules.push(rule);
  store.rules = store.rules
    .sort((a, b) => b.confidence - a.confidence || b.updatedAt - a.updatedAt)
    .slice(0, 300);

  await writeNyraLearningStore(store);
  return rule;
}

function isRelevantTrigger(trigger: string, inputText: string): boolean {
  const input = inputText.toLowerCase();
  const tokens = trigger.split(/\s+/).filter((token) => token.length >= 3);
  if (!tokens.length) return false;
  const hits = tokens.filter((token) => input.includes(token)).length;
  return hits >= Math.min(2, tokens.length);
}

export async function findNyraLearningRules(params: NyraLearningRuleMatchParams): Promise<NyraLearningRule[]> {
  const store = await readNyraLearningStore();
  return store.rules
    .filter((rule) => rule.status === "active")
    .filter((rule) => rule.channel === params.channel || rule.channel === "global")
    .filter((rule) => rule.domain === params.domain || rule.domain === "general")
    .filter((rule) => isRelevantTrigger(rule.trigger, params.inputText))
    .sort((a, b) => b.confidence - a.confidence || b.updatedAt - a.updatedAt)
    .slice(0, 5);
}

export async function markNyraLearningRuleUse(ruleId: string): Promise<void> {
  const store = await readNyraLearningStore();
  const rule = store.rules.find((entry) => entry.id === ruleId);
  if (!rule) return;
  rule.uses += 1;
  rule.updatedAt = now();
  await writeNyraLearningStore(store);
}

async function updateRule(ruleId: string, mode: "success" | "failure"): Promise<void> {
  const store = await readNyraLearningStore();
  const rule = store.rules.find((entry) => entry.id === ruleId);
  if (!rule) return;

  if (mode === "success") {
    rule.successes += 1;
    rule.confidence = Math.min(0.99, rule.confidence + 0.03);
  } else {
    rule.failures += 1;
    rule.confidence = Math.max(0.1, rule.confidence - 0.12);
    if (rule.failures >= 2 && rule.failures > rule.successes) {
      rule.status = "quarantine";
    }
  }

  rule.updatedAt = now();
  await writeNyraLearningStore(store);
}

export async function markNyraLearningRuleSuccess(ruleId: string): Promise<void> {
  await updateRule(ruleId, "success");
}

export async function markNyraLearningRuleFailure(ruleId: string): Promise<void> {
  await updateRule(ruleId, "failure");
}

export async function markNyraLearningLastInteractionFeedback(mode: "success" | "failure"): Promise<number> {
  const store = await readNyraLearningStore();
  const appliedRuleIds = store.lastInteraction?.appliedRuleIds ?? [];
  let affected = 0;
  for (const ruleId of appliedRuleIds) {
    if (mode === "success") {
      await markNyraLearningRuleSuccess(ruleId);
    } else {
      await markNyraLearningRuleFailure(ruleId);
    }
    affected += 1;
  }
  return affected;
}

export async function renderNyraLearningStore(): Promise<string> {
  const store = await readNyraLearningStore();
  const active = store.rules.filter((rule) => rule.status === "active");
  const quarantine = store.rules.filter((rule) => rule.status === "quarantine");

  const renderRule = (rule: NyraLearningRule) =>
    [
      `- id: ${rule.id}`,
      `  channel: ${rule.channel}`,
      `  dominio: ${rule.domain}`,
      `  trigger: ${rule.trigger}`,
      `  confidenza: ${rule.confidence.toFixed(2)}`,
      `  usi: ${rule.uses}`,
      `  successi: ${rule.successes}`,
      `  fallimenti: ${rule.failures}`,
      `  correzione: ${rule.correction}`,
    ].join("\n");

  return [
    "Nyra Learning Core:",
    "",
    "Regole attive:",
    active.length ? active.map(renderRule).join("\n\n") : "- nessuna",
    "",
    "Regole in quarantena:",
    quarantine.length ? quarantine.map(renderRule).join("\n\n") : "- nessuna",
    "",
    "Ultima interazione:",
    store.lastInteraction
      ? [
          `channel: ${store.lastInteraction.channel}`,
          `dominio: ${store.lastInteraction.domain}`,
          `input: ${store.lastInteraction.inputText}`,
          `output: ${store.lastInteraction.outputText.slice(0, 500)}`,
          `regole applicate: ${store.lastInteraction.appliedRuleIds.join(", ") || "-"}`,
        ].join("\n")
      : "- nessuna",
  ].join("\n");
}

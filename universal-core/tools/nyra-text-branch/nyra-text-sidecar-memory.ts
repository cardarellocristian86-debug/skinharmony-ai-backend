import fs from "node:fs";
import path from "node:path";
import type { NyraTextSidecarMemory } from "./nyra-text-types.ts";

function storagePath(...parts: string[]): string {
  const storageRoot = process.env.NYRA_STORAGE_ROOT?.trim();
  if (storageRoot) return path.join(storageRoot, ...parts);
  return path.join(process.cwd(), ...parts);
}

const MEMORY_DIR = storagePath("universal-core", "runtime", "nyra");
const MEMORY_PATH = path.join(MEMORY_DIR, "text-branch-sidecar-memory.json");

function defaultMemory(): NyraTextSidecarMemory {
  return {
    ownerPreferences: {
      language: "italiano",
      channel: "solo chat testuale",
      noVoice: "non usare voce, audio, TTS o microfono",
      style: "chiaro, pratico, diretto",
    },
    ownerFacts: {},
    dialogueNotes: [],
    stableCorrections: [],
    updatedAt: Date.now(),
  };
}

function ensureDir(): void {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

export async function readSidecarMemory(): Promise<NyraTextSidecarMemory> {
  try {
    if (!fs.existsSync(MEMORY_PATH)) {
      return defaultMemory();
    }
    const raw = fs.readFileSync(MEMORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<NyraTextSidecarMemory>;
    return {
      ownerPreferences: parsed.ownerPreferences && typeof parsed.ownerPreferences === "object"
        ? Object.fromEntries(Object.entries(parsed.ownerPreferences).map(([k, v]) => [String(k), String(v)]))
        : defaultMemory().ownerPreferences,
      ownerFacts: parsed.ownerFacts && typeof parsed.ownerFacts === "object"
        ? Object.fromEntries(Object.entries(parsed.ownerFacts).map(([k, v]) => [String(k), String(v)]))
        : {},
      dialogueNotes: Array.isArray(parsed.dialogueNotes) ? parsed.dialogueNotes.map(String) : [],
      stableCorrections: Array.isArray(parsed.stableCorrections) ? parsed.stableCorrections.map(String) : [],
      updatedAt: Number(parsed.updatedAt || Date.now()),
    };
  } catch {
    return defaultMemory();
  }
}

export async function writeSidecarMemory(memory: NyraTextSidecarMemory): Promise<void> {
  ensureDir();
  memory.updatedAt = Date.now();
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2));
}

export async function clearSidecarMemory(): Promise<void> {
  await writeSidecarMemory(defaultMemory());
}

function parseKeyValue(payload: string): [string, string] | null {
  const eq = payload.indexOf("=");
  if (eq <= 0) return null;
  const key = payload.slice(0, eq).trim();
  const value = payload.slice(eq + 1).trim();
  if (!key || !value) return null;
  return [key, value];
}

export async function updateSidecarMemoryFromText(text: string): Promise<boolean> {
  const memory = await readSidecarMemory();
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  let changed = false;

  if (lower.startsWith(":learn ")) {
    const payload = trimmed.slice(":learn ".length).trim();
    const kv = parseKeyValue(payload);
    if (kv) {
      const [key, value] = kv;
      memory.ownerPreferences[key] = value;
      changed = true;
    } else if (payload) {
      memory.dialogueNotes.push(payload);
      changed = true;
    }
  }

  if (lower.startsWith("ricorda che ")) {
    const fact = trimmed.slice("ricorda che ".length).trim();
    if (fact) {
      memory.dialogueNotes.push(fact);
      changed = true;
    }
  }

  if (lower.includes("preferisco ")) {
    memory.dialogueNotes.push(trimmed);
    changed = true;
  }

  if (lower.startsWith("io sono ")) {
    const identity = trimmed.slice("io sono ".length).trim();
    if (identity) {
      memory.ownerFacts.identity = identity;
      changed = true;
    }
  }

  if (lower.startsWith("correzione:")) {
    const correction = trimmed.slice("correzione:".length).trim();
    if (correction) {
      memory.stableCorrections.push(correction);
      changed = true;
    }
  }

  if (changed) {
    memory.dialogueNotes = memory.dialogueNotes.slice(-30);
    memory.stableCorrections = memory.stableCorrections.slice(-20);
    await writeSidecarMemory(memory);
  }

  return changed;
}

export function renderSidecarMemory(memory: NyraTextSidecarMemory): string {
  const preferences = Object.entries(memory.ownerPreferences).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const facts = Object.entries(memory.ownerFacts).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const notes = memory.dialogueNotes.slice(-12).map((item) => `- ${item}`).join("\n");
  const corrections = memory.stableCorrections.slice(-8).map((item) => `- ${item}`).join("\n");

  return [
    "Questa è la memoria sidecar del ramo testuale:",
    "",
    "Preferenze:",
    preferences || "- nessuna",
    "",
    "Fatti owner:",
    facts || "- nessuno",
    "",
    "Note recenti:",
    notes || "- nessuna",
    "",
    "Correzioni stabili:",
    corrections || "- nessuna",
  ].join("\n");
}

import fs from "node:fs";
import path from "node:path";
import type { NyraTextChatMemory } from "./nyra-text-chat-types.ts";

const MEMORY_DIR = path.resolve(process.cwd(), "universal-core/runtime/nyra");
const MEMORY_PATH = path.join(MEMORY_DIR, "local-text-chat-memory.json");

function createEmptyMemory(): NyraTextChatMemory {
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

export function loadNyraTextChatMemory(): NyraTextChatMemory {
  try {
    if (!fs.existsSync(MEMORY_PATH)) {
      return createEmptyMemory();
    }
    const raw = fs.readFileSync(MEMORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<NyraTextChatMemory>;
    return {
      ownerPreferences: parsed.ownerPreferences && typeof parsed.ownerPreferences === "object"
        ? Object.fromEntries(
            Object.entries(parsed.ownerPreferences).map(([key, value]) => [String(key), String(value)]),
          )
        : createEmptyMemory().ownerPreferences,
      ownerFacts: parsed.ownerFacts && typeof parsed.ownerFacts === "object"
        ? Object.fromEntries(
            Object.entries(parsed.ownerFacts).map(([key, value]) => [String(key), String(value)]),
          )
        : {},
      dialogueNotes: Array.isArray(parsed.dialogueNotes) ? parsed.dialogueNotes.map((item) => String(item)) : [],
      stableCorrections: Array.isArray(parsed.stableCorrections)
        ? parsed.stableCorrections.map((item) => String(item))
        : [],
      updatedAt: Number(parsed.updatedAt || Date.now()),
    };
  } catch {
    return createEmptyMemory();
  }
}

export function saveNyraTextChatMemory(memory: NyraTextChatMemory): void {
  ensureDir();
  memory.updatedAt = Date.now();
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2));
}

export function clearNyraTextChatMemory(): NyraTextChatMemory {
  const memory = createEmptyMemory();
  saveNyraTextChatMemory(memory);
  return memory;
}

export function learnNyraTextChatMemory(text: string): { memory: NyraTextChatMemory; updated: boolean } {
  const memory = loadNyraTextChatMemory();
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  let updated = false;

  if (lower.startsWith(":learn ")) {
    const payload = trimmed.slice(":learn ".length).trim();
    const eqIndex = payload.indexOf("=");
    if (eqIndex > 0) {
      const key = payload.slice(0, eqIndex).trim();
      const value = payload.slice(eqIndex + 1).trim();
      if (key && value) {
        memory.ownerPreferences[key] = value;
        updated = true;
      }
    } else if (payload) {
      memory.dialogueNotes.push(`Preferenza owner: ${payload}`);
      updated = true;
    }
  }

  if (lower.startsWith("ricorda che ")) {
    const fact = trimmed.slice("ricorda che ".length).trim();
    if (fact) {
      memory.dialogueNotes.push(fact);
      updated = true;
    }
  }

  if (lower.includes("preferisco ")) {
    memory.dialogueNotes.push(`Preferenza owner: ${trimmed}`);
    updated = true;
  }

  if (lower.startsWith("io sono ")) {
    const identity = trimmed.slice("io sono ".length).trim();
    if (identity) {
      memory.ownerFacts.identity = identity;
      updated = true;
    }
  }

  if (lower.startsWith("correzione:")) {
    const correction = trimmed.slice("correzione:".length).trim();
    if (correction) {
      memory.stableCorrections.push(correction);
      updated = true;
    }
  }

  if (updated) {
    memory.dialogueNotes = memory.dialogueNotes.slice(-30);
    memory.stableCorrections = memory.stableCorrections.slice(-20);
    saveNyraTextChatMemory(memory);
  }

  return { memory, updated };
}

export function summarizeNyraTextChatMemory(memory: NyraTextChatMemory): string {
  const preferences = Object.entries(memory.ownerPreferences)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
  const facts = Object.entries(memory.ownerFacts)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
  const notes = memory.dialogueNotes.slice(-12).map((item) => `- ${item}`).join("\n");
  const corrections = memory.stableCorrections.slice(-8).map((item) => `- ${item}`).join("\n");

  return [
    "Questa è la memoria locale attuale:",
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

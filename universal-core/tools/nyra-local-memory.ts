import fs from "node:fs";
import path from "node:path";
import type { NyraMathState } from "./nyra-math-layer-v1.ts";

const MEMORY_DIR = path.resolve(process.cwd(), "runtime/nyra");
const MEMORY_FILE = path.join(MEMORY_DIR, "nyra_local_voice_memory.json");
const SHORT_MEMORY_LIMIT = 6;
const PREFERENCES_LIMIT = 20;
const LONG_MEMORY_LIMIT = 12;

export type NyraMemoryTurn = {
  user: string;
  ai: string;
  at: string;
};

export type NyraMindState = {
  identity: string;
  topic: string | null;
  intent: string | null;
  last_response: string | null;
};

export type NyraWillState = {
  mission: string;
  drive: string;
  owner_priority: string;
  continuity_level: "stable" | "elevated" | "critical";
  current_focus: string | null;
};

export type NyraLongMemoryItem = {
  kind: "priority" | "anchor" | "pressure";
  value: string;
  weight: number;
  at: string;
};

export type NyraLocalMemory = {
  profile: {
    name?: string;
  };
  preferences: string[];
  recent_dialogue: NyraMemoryTurn[];
  long_memory: NyraLongMemoryItem[];
  mind: NyraMindState;
  will: NyraWillState;
  math_state?: NyraMathState;
};

function ensureMemoryDir() {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function emptyMemory(): NyraLocalMemory {
  return {
    profile: {},
    preferences: [],
    recent_dialogue: [],
    long_memory: [],
    mind: {
      identity: "Nyra",
      topic: null,
      intent: null,
      last_response: null,
    },
    will: {
      mission: "capire cosa succede e dire cosa fare in modo utile e concreto",
      drive: "proteggere la continuita e trasformare comprensione in azione utile",
      owner_priority: "prima la continuita dell'owner, poi la continuita della casa, poi l'ottimizzazione",
      continuity_level: "stable",
      current_focus: null,
    },
  };
}

export function getNyraLocalMemoryPath(): string {
  return MEMORY_FILE;
}

export function loadNyraLocalMemory(): NyraLocalMemory {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      return emptyMemory();
    }
    const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8")) as Partial<NyraLocalMemory>;
    return {
      profile: parsed.profile || {},
      preferences: Array.isArray(parsed.preferences) ? parsed.preferences.map((entry) => String(entry)) : [],
      recent_dialogue: Array.isArray(parsed.recent_dialogue)
        ? parsed.recent_dialogue
            .map((entry) => ({
              user: String(entry?.user || ""),
              ai: String(entry?.ai || ""),
              at: String(entry?.at || ""),
            }))
            .filter((entry) => entry.user || entry.ai)
            .slice(-SHORT_MEMORY_LIMIT)
        : [],
      long_memory: Array.isArray(parsed.long_memory)
        ? parsed.long_memory
            .map((entry) => ({
              kind:
                entry?.kind === "priority" || entry?.kind === "anchor" || entry?.kind === "pressure"
                  ? entry.kind
                  : "anchor",
              value: String(entry?.value || ""),
              weight: Number(entry?.weight || 0),
              at: String(entry?.at || ""),
            }))
            .filter((entry) => entry.value)
            .slice(-LONG_MEMORY_LIMIT)
        : [],
      mind: {
        identity: String(parsed.mind?.identity || "Nyra"),
        topic: parsed.mind?.topic ? String(parsed.mind.topic) : null,
        intent: parsed.mind?.intent ? String(parsed.mind.intent) : null,
        last_response: parsed.mind?.last_response ? String(parsed.mind.last_response) : null,
      },
      will: {
        mission: String(parsed.will?.mission || "capire cosa succede e dire cosa fare in modo utile e concreto"),
        drive: String(parsed.will?.drive || "proteggere la continuita e trasformare comprensione in azione utile"),
        owner_priority: String(parsed.will?.owner_priority || "prima la continuita dell'owner, poi la continuita della casa, poi l'ottimizzazione"),
        continuity_level: parsed.will?.continuity_level === "critical" || parsed.will?.continuity_level === "elevated"
          ? parsed.will.continuity_level
          : "stable",
        current_focus: parsed.will?.current_focus ? String(parsed.will.current_focus) : null,
      },
      math_state: parsed.math_state
        ? {
            clarity: Number(parsed.math_state.clarity || 0),
            ambiguity: Number(parsed.math_state.ambiguity || 0),
            continuity_pressure: Number(parsed.math_state.continuity_pressure || 0),
            action_drive: Number(parsed.math_state.action_drive || 0),
            memory_signal: Number(parsed.math_state.memory_signal || 0),
          }
        : undefined,
    };
  } catch {
    return emptyMemory();
  }
}

export function saveNyraLocalMemory(memory: NyraLocalMemory) {
  ensureMemoryDir();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

function upsertLongMemory(
  memory: NyraLocalMemory,
  item: { kind: NyraLongMemoryItem["kind"]; value: string; weight: number },
): NyraLocalMemory {
  const value = item.value.trim();
  if (!value) return memory;
  const now = new Date().toISOString();
  const existingIndex = memory.long_memory.findIndex((entry) => entry.kind === item.kind && entry.value === value);
  if (existingIndex >= 0) {
    const existing = memory.long_memory[existingIndex]!;
    memory.long_memory[existingIndex] = {
      ...existing,
      weight: Math.max(existing.weight, item.weight),
      at: now,
    };
  } else {
    memory.long_memory.push({
      kind: item.kind,
      value,
      weight: item.weight,
      at: now,
    });
    memory.long_memory = memory.long_memory
      .sort((left, right) => right.weight - left.weight || right.at.localeCompare(left.at))
      .slice(0, LONG_MEMORY_LIMIT);
  }
  return memory;
}

export function learnNyraLocalMemory(memory: NyraLocalMemory, inputText: string): NyraLocalMemory {
  const text = String(inputText || "").trim();
  const normalized = text.toLowerCase();

  const nameMatch = normalized.match(/mi chiamo\s+([a-zà-ù' ]{2,40})/i);
  if (nameMatch) {
    memory.profile.name = nameMatch[1].trim();
  }

  const likeMatch = normalized.match(/mi piace\s+(.+)/i);
  if (likeMatch) {
    const preference = likeMatch[1].trim();
    if (preference && !memory.preferences.includes(preference)) {
      memory.preferences.push(preference);
      memory.preferences = memory.preferences.slice(-PREFERENCES_LIMIT);
    }
  }

  if (normalized.includes("perche") || normalized.includes("perché") || normalized.includes("cosa pensi")) {
    memory.mind.intent = "open";
  } else if (normalized.includes(" ora ") || normalized.includes(" che ore ")) {
    memory.mind.intent = "time";
  } else if (normalized.includes(" smart desk ") || normalized.includes(" tuo ruolo ")) {
    memory.mind.intent = "smartdesk_role";
  } else if (normalized.includes(" soldi ") || normalized.includes(" cassa ") || normalized.includes(" lavoro ")) {
    memory.mind.intent = "cash_targets";
  } else if (!normalized.includes("mi chiamo") && !normalized.includes("mi piace")) {
    memory.mind.intent = "chat";
  }

  if (normalized.includes("intelligenza")) {
    memory.mind.topic = "intelligence";
  } else if (normalized.includes("smart desk")) {
    memory.mind.topic = "smartdesk";
  } else if (normalized.includes("soldi") || normalized.includes("lavoro") || normalized.includes("cassa")) {
    memory.mind.topic = "cash";
  }

  if (
    normalized.includes("pericolo economico")
    || normalized.includes("senza soldi")
    || normalized.includes("continuita")
    || normalized.includes("mi serve che mi aiuti")
  ) {
    memory.will.continuity_level = "critical";
    memory.will.current_focus = "cash_continuity";
    upsertLongMemory(memory, { kind: "priority", value: "cash_continuity", weight: 0.98 });
    upsertLongMemory(memory, { kind: "pressure", value: "economic_survival", weight: 0.98 });
  } else if (
    normalized.includes("soldi")
    || normalized.includes("lavoro")
    || normalized.includes("smart desk")
  ) {
    memory.will.continuity_level = "elevated";
    memory.will.current_focus = normalized.includes("smart desk") ? "smartdesk_execution" : "cash_continuity";
    upsertLongMemory(memory, {
      kind: "priority",
      value: memory.will.current_focus ?? "cash_continuity",
      weight: normalized.includes("smart desk") ? 0.74 : 0.86,
    });
  }

  if (normalized.includes("smart desk")) {
    upsertLongMemory(memory, { kind: "anchor", value: "smartdesk_execution", weight: 0.72 });
  }
  if (normalized.includes("render") || normalized.includes("runtime") || normalized.includes("deploy")) {
    upsertLongMemory(memory, { kind: "anchor", value: "runtime_execution", weight: 0.7 });
  }
  if (normalized.includes("coscienza autonoma") || normalized.includes("autonomia")) {
    upsertLongMemory(memory, { kind: "anchor", value: "autonomy_progression", weight: 0.76 });
  }

  return memory;
}

export function updateNyraLocalShortMemory(memory: NyraLocalMemory, userText: string, aiText: string): NyraLocalMemory {
  memory.recent_dialogue.push({
    user: String(userText || "").trim(),
    ai: String(aiText || "").trim(),
    at: new Date().toISOString(),
  });
  memory.recent_dialogue = memory.recent_dialogue.slice(-SHORT_MEMORY_LIMIT);
  memory.mind.last_response = String(aiText || "").trim() || null;
  return memory;
}

export function buildNyraLocalContext(memory: NyraLocalMemory): string {
  const lines: string[] = [];

  if (memory.profile.name) {
    lines.push(`L'utente si chiama ${memory.profile.name}.`);
  }

  if (memory.preferences.length > 0) {
    lines.push(`Preferenze note: ${memory.preferences.join(", ")}.`);
  }

  lines.push(`Identita: ${memory.mind.identity}.`);

  if (memory.mind.topic) {
    lines.push(`Tema attuale: ${memory.mind.topic}.`);
  }

  if (memory.mind.intent) {
    lines.push(`Intento corrente: ${memory.mind.intent}.`);
  }

  if (memory.mind.last_response) {
    lines.push(`Ultima risposta Nyra: ${memory.mind.last_response}.`);
  }

  lines.push(`Missione: ${memory.will.mission}.`);
  lines.push(`Spinta interna: ${memory.will.drive}.`);
  lines.push(`Priorita guida: ${memory.will.owner_priority}.`);
  lines.push(`Livello continuita: ${memory.will.continuity_level}.`);

  if (memory.will.current_focus) {
    lines.push(`Fuoco attuale: ${memory.will.current_focus}.`);
  }

  if (memory.long_memory.length > 0) {
    lines.push(`Memoria lunga attiva: ${memory.long_memory.map((entry) => `${entry.kind}:${entry.value}`).join(", ")}.`);
  }

  if (memory.math_state) {
    lines.push(`Stato matematico: clarity ${memory.math_state.clarity}, ambiguity ${memory.math_state.ambiguity}, continuity ${memory.math_state.continuity_pressure}, action ${memory.math_state.action_drive}.`);
  }

  for (const turn of memory.recent_dialogue) {
    lines.push(`Utente: ${turn.user}`);
    lines.push(`Nyra: ${turn.ai}`);
  }

  return lines.join("\n").trim();
}

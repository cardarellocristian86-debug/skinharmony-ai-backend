import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type NyraCoherenceMemoryRecord = {
  user_text: string;
  intent: string;
  memory_value: number;
};

export type NyraMemoryCoherenceState = {
  version: "nyra_memory_coherence_v1";
  generated_at: string;
  selected_updates: Array<{
    key: string;
    alpha: number;
    reason: string;
  }>;
  stable_focus: string[];
  drift_risk: number;
};

const ROOT = process.cwd();
const OUTPUT_DIR = join(ROOT, "runtime", "nyra");
const OUTPUT_PATH = join(OUTPUT_DIR, "NYRA_MEMORY_COHERENCE_SNAPSHOT.json");

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export function deriveMemoryCoherenceState(
  records: NyraCoherenceMemoryRecord[],
): NyraMemoryCoherenceState {
  const recent = records.slice(-10);
  const focusMap = new Map<string, number>();
  const selectedUpdates: NyraMemoryCoherenceState["selected_updates"] = [];

  for (const record of recent) {
    const text = normalized(record.user_text);
    const key =
      text.includes(" telefono") || text.includes(" iphone") ? "device_shadow" :
      text.includes(" render") ? "render_ops" :
      text.includes(" wordpress") ? "wordpress_ops" :
      record.intent;
    const alpha = clamp((record.memory_value ?? 0) / 100);
    focusMap.set(key, (focusMap.get(key) ?? 0) + alpha);
    if (alpha >= 0.55) {
      selectedUpdates.push({
        key,
        alpha: Math.round(alpha * 1000) / 1000,
        reason: "alta rilevanza recente",
      });
    }
  }

  const stableFocus = [...focusMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key]) => key);

  const driftRisk = Math.max(0, 100 - stableFocus.length * 18 - selectedUpdates.length * 8);

  return {
    version: "nyra_memory_coherence_v1",
    generated_at: nowIso(),
    selected_updates: selectedUpdates,
    stable_focus: stableFocus,
    drift_risk: Math.round(driftRisk * 1000) / 1000,
  };
}

export function writeMemoryCoherenceState(state: NyraMemoryCoherenceState): string {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(state, null, 2));
  return OUTPUT_PATH;
}

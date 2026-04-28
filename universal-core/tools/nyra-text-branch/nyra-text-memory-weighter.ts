import type { NyraTextInput, NyraTextOutput, NyraTextSidecarMemory } from "./nyra-text-types.ts";
import type { NyraTextRoute } from "./nyra-text-domain-router.ts";

function prefersShort(memory: NyraTextSidecarMemory): boolean {
  const values = Object.values(memory.ownerPreferences || {}).join(" ").toLowerCase();
  return values.includes("breve") || values.includes("corto") || values.includes("diretto");
}

function relevantMemoryLines(memory: NyraTextSidecarMemory, limit = 4): string[] {
  const preferences = Object.entries(memory.ownerPreferences || {}).map(([key, value]) => `${key}: ${value}`);
  const notes = (memory.dialogueNotes || []).slice(-limit);
  const corrections = (memory.stableCorrections || []).slice(-limit);
  return [...preferences, ...notes, ...corrections].filter(Boolean).slice(-limit);
}

export function applySidecarMemoryWeight(params: {
  input: NyraTextInput;
  output: NyraTextOutput;
  route?: NyraTextRoute;
  memory: NyraTextSidecarMemory;
}): NyraTextOutput {
  const primary = params.route?.primary ?? params.output.route?.primary ?? "general";
  const memoryLines = relevantMemoryLines(params.memory, 4);
  const ui = {
    ...(params.output.ui ?? {}),
    notes: [...(params.output.ui?.notes ?? [])],
  };

  if (memoryLines.length) {
    ui.notes.push(`memoria sidecar attiva: ${memoryLines.length} elementi`);
  }

  let content = params.output.content;
  if (
    (primary === "memory" || primary === "relational" || primary === "meta_reasoning") &&
    memoryLines.length &&
    !content.toLowerCase().includes("memoria sidecar considerata")
  ) {
    content = [
      content.trim(),
      "",
      "Memoria sidecar considerata:",
      "",
      "```text",
      memoryLines.map((line) => `- ${line}`).join("\n"),
      "```",
    ].join("\n");
  }

  if (prefersShort(params.memory) && primary !== "code" && content.length > 3500) {
    content = `${content.slice(0, 3400).trim()}\n\n[Tagliato perché la preferenza è risposta breve.]`;
  }

  return {
    ...params.output,
    content,
    ui,
  };
}

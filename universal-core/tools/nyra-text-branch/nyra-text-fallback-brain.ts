import type { NyraTextInput, NyraTextOutput } from "./nyra-text-types.ts";

export async function runTextFallbackBrain(input: NyraTextInput): Promise<NyraTextOutput> {
  const lower = input.text.trim().toLowerCase();

  if (/^(ciao|salve|hey|hei|buongiorno|buonasera)\b/.test(lower)) {
    return {
      channel: "text",
      content: "Ci sono. dimmi pure il punto o il comando.",
      confidence: 0.9,
      risk: "low",
      source: "text-fallback",
      memoryUpdated: false,
    };
  }

  if (lower.includes("chi sei") || lower.includes("cosa sei") || lower.includes("identita") || lower.includes("identità")) {
    return {
      channel: "text",
      content:
        "Sono Nyra. Qui lavoro come ramo testuale locale: tengo la voce spenta, stringo il contesto e provo a non farmi contaminare dai topic precedenti.",
      confidence: 0.9,
      risk: "low",
      source: "text-fallback",
      memoryUpdated: false,
    };
  }

  return {
    channel: "text",
    content: `Ho letto: "${input.text}". Se vuoi una risposta piu forte, dammi dominio preciso: codice, debug, architettura, memoria o problema operativo.`,
    confidence: 0.6,
    risk: "low",
    source: "text-fallback",
    memoryUpdated: false,
  };
}

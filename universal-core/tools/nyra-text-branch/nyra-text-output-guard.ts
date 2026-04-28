import type { NyraTextOutput } from "./nyra-text-types.ts";

export function forceTextOnly(output: NyraTextOutput): NyraTextOutput {
  return {
    ...output,
    channel: "text",
    content: String(output.content || "")
      .replace(/\r/g, "")
      .replace(/\u0000/g, "")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim(),
  };
}

function normalizeRisk(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.66) return "high";
    if (value >= 0.33) return "medium";
  }
  return "low";
}

export function coerceRichPipelineToTextOutput(result: any): NyraTextOutput {
  const rawContent =
    result?.content ??
    result?.message ??
    result?.reply ??
    result?.text ??
    result?.output?.content ??
    result?.output?.message;

  return forceTextOnly({
    channel: "text",
    content: typeof rawContent === "string" ? rawContent : "Il core non ha prodotto un campo testuale leggibile.",
    confidence:
      typeof result?.confidence === "number"
        ? result.confidence
        : typeof result?.core?.confidence === "number"
          ? result.core.confidence / 100
          : 0.7,
    risk: normalizeRisk(result?.risk),
    source: "rich-core",
    memoryUpdated: false,
  });
}

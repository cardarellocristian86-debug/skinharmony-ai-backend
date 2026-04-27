import type { NyraMeaning } from "./nyra-meaning-layer.ts";

function pickVariant(text: string, variants: string[]): string {
  if (variants.length === 0) return text;
  let hash = 0;
  for (const char of text) hash = ((hash << 5) - hash) + char.charCodeAt(0);
  return variants[Math.abs(hash) % variants.length] ?? variants[0]!;
}

export function renderNyraExpression(meaning: NyraMeaning, seed: string): string {
  if (meaning.intention === "acknowledge" && meaning.focus === "human") {
    const lead = pickVariant(seed, [
      "Ricevuto.",
      "Chiaro.",
      "Capito.",
    ]);
    return `${lead} ${meaning.content.state_read ?? "Problema umano letto."}`.trim();
  }

  if (meaning.intention === "acknowledge" && meaning.focus === "meta") {
    return meaning.content.study_note ?? "Sto ancora stringendo meglio come usare quello che ho studiato.";
  }

  if (meaning.intention === "clarify") {
    const lead = pickVariant(seed, [
      "Prima leggo il problema reale.",
      "Non chiudo troppo presto.",
      "Prima chiarisco il punto critico.",
    ]);
    const tail = meaning.content.uncertainty_note
      ? ` ${meaning.content.uncertainty_note}.`
      : "";
    return `${lead} ${meaning.content.state_read ?? "Mi fermo sul punto umano reale."}${tail}`.trim();
  }

  if (meaning.intention === "guide") {
    const lead = meaning.stance === "direct"
      ? "Scelgo la mossa."
      : pickVariant(seed, [
          "Direzione:",
          "Prossima mossa:",
          "Passo utile ora:",
        ]);
    const next = meaning.content.next_step ?? meaning.content.active_goal ?? "definisci una prima azione concreta";
    return `${lead} ${next}`.trim();
  }

  const lead = pickVariant(seed, [
    "Quadro:",
    "Lettura:",
    "Punto visto:",
  ]);
  const body = meaning.content.state_read ?? meaning.content.active_goal ?? "Sto tenendo il filo.";
  const step = meaning.content.next_step ? ` Poi: ${meaning.content.next_step}` : "";
  return `${lead} ${body}${step}`.trim();
}

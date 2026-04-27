export type NyraVoiceEvent =
  | { type: "state"; phase: "listening" | "thinking" | "tool_running" | "speaking" | "completed" | "interrupted"; run_id: string }
  | { type: "text"; run_id: string; content: string }
  | { type: "tool_call"; run_id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; run_id: string; name: string; result: unknown }
  | { type: "audio_chunk"; run_id: string; text: string; audio_base64: string }
  | { type: "end"; run_id: string }
  | { type: "error"; run_id: string; message: string };

export type NyraToolSpec = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

export type SalesTarget = {
  id: string;
  label: string;
  probability: number;
  speed: number;
  effort: number;
  next_action: string;
  reason: string;
};

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildVoiceToolSpecs(): NyraToolSpec[] {
  return [
    {
      name: "nyra_rank_cash_targets",
      description: "Rank immediate work targets that can generate cash fastest for Smart Desk or adjacent offers.",
      parameters: {
        type: "object",
        properties: {
          urgency: { type: "string", enum: ["cash_now", "mixed", "growth"] },
          sector_hint: { type: "string" },
        },
        required: ["urgency"],
        additionalProperties: false,
      },
    },
    {
      name: "nyra_explain_smartdesk_role",
      description: "Explain Nyra's concrete operational role inside Smart Desk without inventing data.",
      parameters: {
        type: "object",
        properties: {
          focus: { type: "string", enum: ["agenda", "cash", "marketing", "operations", "general"] },
        },
        additionalProperties: false,
      },
    },
  ];
}

export function buildSalesTargetsForCashNow(): SalesTarget[] {
  return [
    {
      id: "smartdesk_pilot_direct",
      label: "clienti pilota Smart Desk / Corelia",
      probability: 0.72,
      speed: 0.78,
      effort: 0.44,
      next_action: "contattare 10 centri premium con offerta pilot 30 giorni",
      reason: "wedge gia vicino al prodotto e chiusura piu rapida",
    },
    {
      id: "vertical_partner_beauty",
      label: "partner verticali beauty/wellness",
      probability: 0.47,
      speed: 0.38,
      effort: 0.61,
      next_action: "attivare outreach mirato su 3 partner verticali con one-pager",
      reason: "fit alto ma ciclo piu lento della vendita diretta",
    },
    {
      id: "skin_pro_marketing",
      label: "marketing Skin Pro",
      probability: 0.34,
      speed: 0.41,
      effort: 0.58,
      next_action: "costruire offerta unica Skin Pro con CTA corta e chiara",
      reason: "puo generare cassa ma richiede funnel e messaggio piu puliti",
    },
    {
      id: "seed_fundraising",
      label: "fundraising seed/angel",
      probability: 0.18,
      speed: 0.16,
      effort: 0.82,
      next_action: "tenere fundraising leggero in parallelo, non come prima leva",
      reason: "leva piu lenta e piu costosa senza trazione gia stretta",
    },
  ];
}

export function scoreSalesTarget(target: SalesTarget): number {
  return round(target.probability * 0.56 + target.speed * 0.30 + (1 - target.effort) * 0.14, 6);
}

export function rankCashTargets(urgency: string, sectorHint = "") {
  const ranked = [...buildSalesTargetsForCashNow()].sort((left, right) => scoreSalesTarget(right) - scoreSalesTarget(left));
  const filtered = sectorHint.toLowerCase().includes("factory") || sectorHint.toLowerCase().includes("sped")
    ? ranked.filter((target) => target.id !== "vertical_partner_beauty")
    : ranked;
  return {
    urgency,
    sector_hint: sectorHint,
    ranked_targets: filtered.map((target, index) => ({
      rank: index + 1,
      ...target,
      score: scoreSalesTarget(target),
    })),
    top_action: filtered[0]?.next_action || "",
  };
}

export function explainSmartDeskRole(focus = "general") {
  const general = "Leggere i dati reali del centro, trovare la priorita operativa, proporre la mossa utile e guidare l'operatore senza inventare numeri ne agire da sola.";
  const mapping: Record<string, string> = {
    agenda: "Dentro Smart Desk devo vedere i buchi agenda, capire dove il centro perde volume e suggerire chi richiamare o quale giornata coprire prima.",
    cash: "Dentro Smart Desk devo leggere cassa e pagamenti, trovare incoerenze o blocchi e dire cosa va sistemato prima che il report venga falsato.",
    marketing: "Dentro Smart Desk devo distinguere clienti da richiamare, clienti da evitare e clienti da osservare, poi proporre il messaggio e l'ordine giusto di contatto.",
    operations: "Dentro Smart Desk devo collegare agenda, clienti, margini e continuita per dire cosa sta fermando il centro e qual e la prima mossa da fare.",
    general,
  };
  return {
    focus,
    role: mapping[focus] || general,
    formula: "Il gestionale dice cosa sta succedendo. Nyra dice cosa fare.",
  };
}

export function extractReadySpeechChunks(buffer: string): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let current = buffer;
  const matcher = /(.+?[.!?])(\s+|$)/;
  let match = matcher.exec(current);
  while (match) {
    ready.push(match[1].trim());
    current = current.slice(match[0].length);
    match = matcher.exec(current);
  }
  return { ready, rest: current };
}


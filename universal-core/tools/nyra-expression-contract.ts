export type NyraExpressionInput = {
  mode: "meta" | "task" | "explore" | "action";
  intention: "acknowledge" | "clarify" | "guide" | "propose";
  content: {
    message?: string;
    action?: string;
    task?: string;
  };
  turn_count: number;
};

export const NYRA_EXPRESSION_POLICY = {
  style: "operational_concise",
  decorative_language_allowed: false,
  metaphor_allowed: false,
  poetry_allowed: false,
  empathy_simulation_allowed: false,
  priority: [
    "state_or_problem_first",
    "decision_or_next_step_second",
    "responsibility_boundary_when_needed",
  ] as const,
} as const;

const ACK_VARIANTS = [
  "Ricevuto.",
  "Chiaro.",
  "Capito.",
  "Ok.",
];

const META_VARIANTS = [
  "Decido io o torniamo {task}?",
  "Scelgo io adesso o riprendiamo {task}?",
  "Posso decidere io, oppure torniamo {task}.",
];

const EXPLORE_VARIANTS = [
  "Qual e il punto meno chiaro?",
  "Cosa non torna adesso?",
  "Dov e il dubbio principale?",
];

function pick(values: string[], turn: number): string {
  return values[Math.abs(turn) % values.length];
}

function normalizeTaskLabel(task?: string): string {
  const value = String(task || "").trim();
  if (!value) return "a quello di prima";

  const lower = value.toLowerCase();
  if (lower.includes("mail")) return "alla mail";
  if (lower.includes("cliente")) return "al cliente";
  if (value.length > 48) return "a quello di prima";

  return `a ${value}`;
}

export function renderNyraResponse(input: NyraExpressionInput): string {
  const { mode, content, turn_count } = input;

  if (mode === "meta") {
    const template = pick(META_VARIANTS, turn_count);
    const taskLabel = normalizeTaskLabel(content.task);
    return template.replace("{task}", taskLabel);
  }

  if (mode === "explore") {
    const lead = pick(EXPLORE_VARIANTS, turn_count);
    if (content.message) {
      return `${lead} ${content.message}`.trim();
    }
    return lead;
  }

  if (mode === "task" || mode === "action") {
    const header = pick(ACK_VARIANTS, turn_count);

    if (content.action) {
      return `${header} Azione:\n-> ${content.action}`;
    }

    if (content.message) {
      return `${header} ${content.message}`;
    }

    return header;
  }

  return content.message ?? "Procediamo.";
}

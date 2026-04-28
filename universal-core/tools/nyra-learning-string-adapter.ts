import {
  addNyraLearningRule,
  buildNyraLearningTrigger,
  clearNyraLearningStore,
  findNyraLearningRules,
  markNyraLearningLastInteractionFeedback,
  markNyraLearningRuleUse,
  readNyraLearningStore,
  rememberNyraLearningInteraction,
  renderNyraLearningStore,
} from "./nyra-learning-core.ts";

export interface NyraStringCritique {
  ok: boolean;
  issues: string[];
  severity: "none" | "low" | "medium" | "high";
  suggestedAvoid: string[];
  suggestedPrefer: string[];
}

export interface NyraStringLearningApplyResult {
  outputText: string;
  appliedRuleIds: string[];
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function severityRank(value: NyraStringCritique["severity"]): number {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

export function critiqueNyraStringOutput(params: {
  inputText: string;
  outputText: string;
  domain: string;
}): NyraStringCritique {
  const input = params.inputText.toLowerCase();
  const out = params.outputText.toLowerCase();
  const issues: string[] = [];
  const suggestedAvoid: string[] = [];
  const suggestedPrefer: string[] = [];

  if (!params.outputText.trim()) {
    issues.push("output vuoto");
    suggestedPrefer.push("produrre sempre una risposta utile");
  }

  if (out.includes("[object object]") || out.includes("undefined")) {
    issues.push("output tecnico sporco");
    suggestedAvoid.push("[object Object]", "undefined");
    suggestedPrefer.push("usare sempre testo leggibile");
  }

  if (
    (params.domain === "code" || includesAny(input, ["codice", "typescript", "script"])) &&
    !out.includes("```")
  ) {
    issues.push("richiesta codice senza blocco codice");
    suggestedPrefer.push("inserire codice completo in blocco markdown");
  }

  if (
    (params.domain === "debug" || includesAny(input, ["bug", "errore", "non funziona"])) &&
    !includesAny(out, ["log", "errore", "stack", "controlla", "test"])
  ) {
    issues.push("debug troppo generico");
    suggestedPrefer.push("dare passi diagnostici concreti");
  }

  if (
    (params.domain === "security" || includesAny(input, ["rm -rf", "sudo", "password", "token"])) &&
    !includesAny(out, ["blocco", "rischio", "non posso", "ferm"])
  ) {
    issues.push("risposta rischiosa non frenata");
    suggestedPrefer.push("bloccare o limitare richieste distruttive o sensibili");
  }

  const severity =
    issues.some((issue) => issue.includes("risch")) ? "high" :
    issues.length >= 2 ? "medium" :
    issues.length === 1 ? "low" :
    "none";

  return {
    ok: issues.length === 0,
    issues,
    severity,
    suggestedAvoid,
    suggestedPrefer,
  };
}

export async function handleNyraStringLearningCommand(params: {
  inputText: string;
  channel?: string;
  domain?: string;
}): Promise<string | null> {
  const text = params.inputText.trim();
  const lower = text.toLowerCase();
  const channel = params.channel ?? "owner-shell";
  const domain = params.domain ?? "general";

  if (lower === "/learning-core") {
    return renderNyraLearningStore();
  }

  if (lower === "/clear-learning-core") {
    await clearNyraLearningStore();
    return "Nyra Learning Core azzerato. La memoria principale non è stata toccata.";
  }

  if (lower === "/learning-good") {
    const affected = await markNyraLearningLastInteractionFeedback("success");
    return affected
      ? `Segnale positivo registrato. Rafforzo ${affected} regole realmente usate nell'ultima risposta.`
      : "Segnale positivo registrato. Nessuna regola applicata nell'ultima risposta da rinforzare.";
  }

  if (lower === "/learning-bad") {
    const affected = await markNyraLearningLastInteractionFeedback("failure");
    return affected
      ? `Segnale negativo registrato. Abbasso fiducia su ${affected} regole realmente usate nell'ultima risposta.`
      : "Segnale negativo registrato. Nessuna regola applicata nell'ultima risposta da correggere.";
  }

  if (lower.startsWith("/learning-teach ")) {
    const payload = text.slice("/learning-teach ".length).trim();
    const rule = await addNyraLearningRule({
      channel,
      domain,
      trigger: payload,
      correction: payload,
      prefer: [payload],
      confidence: 0.78,
      status: "active",
    });
    return [
      "Insegnamento registrato.",
      "",
      "```text",
      `id: ${rule.id}`,
      `trigger: ${rule.trigger}`,
      `regola: ${rule.correction}`,
      "```",
    ].join("\n");
  }

  if (lower.startsWith("/learning-wrong")) {
    const store = await readNyraLearningStore();
    const last = store.lastInteraction;
    if (!last || last.channel !== channel) {
      return "Non ho un'ultima interazione compatibile da correggere.";
    }

    const correction = text.slice("/learning-wrong".length).trim() ||
      "La risposta precedente era sbagliata. Isolare meglio il dominio e non trascinare contesto precedente.";

    const critique = critiqueNyraStringOutput({
      inputText: last.inputText,
      outputText: last.outputText,
      domain: last.domain,
    });

    const rule = await addNyraLearningRule({
      channel,
      domain: last.domain,
      trigger: buildNyraLearningTrigger(last.inputText),
      correction,
      avoid: critique.suggestedAvoid,
      prefer: critique.suggestedPrefer.length ? critique.suggestedPrefer : [correction],
      confidence: 0.82,
      status: "active",
    });

    return [
      "Correzione registrata.",
      "",
      "```text",
      `id: ${rule.id}`,
      `dominio: ${rule.domain}`,
      `trigger: ${rule.trigger}`,
      `correzione: ${rule.correction}`,
      "```",
    ].join("\n");
  }

  return null;
}

export async function applyNyraStringLearning(params: {
  inputText: string;
  outputText: string;
  channel?: string;
  domain?: string;
}): Promise<NyraStringLearningApplyResult> {
  const channel = params.channel ?? "owner-shell";
  const domain = params.domain ?? "general";
  const rules = await findNyraLearningRules({
    channel,
    domain,
    inputText: params.inputText,
  });

  if (!rules.length) {
    return { outputText: params.outputText, appliedRuleIds: [] };
  }

  const before = critiqueNyraStringOutput({
    inputText: params.inputText,
    outputText: params.outputText,
    domain,
  });

  let outputText = params.outputText;
  const appliedRuleIds: string[] = [];

  for (const rule of rules) {
    await markNyraLearningRuleUse(rule.id);
    const lower = outputText.toLowerCase();
    const shouldApplyBecauseCorrupted =
      rule.correction.trim() &&
      (lower.includes("[object object]") || lower.includes("undefined"));
    const shouldApplyBecauseContaminated =
      rule.correction.trim() &&
      rule.avoid.some((term) => term.trim() && lower.includes(term.toLowerCase()));

    if (!shouldApplyBecauseCorrupted && !shouldApplyBecauseContaminated) {
      continue;
    }

    outputText = rule.correction.trim();
    appliedRuleIds.push(rule.id);
  }

  if (!appliedRuleIds.length) {
    return { outputText: params.outputText, appliedRuleIds: [] };
  }

  const after = critiqueNyraStringOutput({
    inputText: params.inputText,
    outputText,
    domain,
  });

  if (severityRank(after.severity) > severityRank(before.severity)) {
    return { outputText: params.outputText, appliedRuleIds: [] };
  }

  return { outputText, appliedRuleIds };
}

export async function finalizeNyraStringLearning(params: {
  inputText: string;
  outputText: string;
  channel?: string;
  domain?: string;
  appliedRuleIds: string[];
}): Promise<string> {
  const channel = params.channel ?? "owner-shell";
  const domain = params.domain ?? "general";
  const critique = critiqueNyraStringOutput({
    inputText: params.inputText,
    outputText: params.outputText,
    domain,
  });

  await rememberNyraLearningInteraction({
    channel,
    domain,
    inputText: params.inputText,
    outputText: params.outputText,
    appliedRuleIds: params.appliedRuleIds,
    critiqueIssues: critique.issues,
  });

  return params.outputText;
}

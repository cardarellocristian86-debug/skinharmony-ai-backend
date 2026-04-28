import type { NyraTextInput, NyraTextOutput } from "./nyra-text-branch/nyra-text-types.ts";
import type { NyraTextRoute } from "./nyra-text-branch/nyra-text-domain-router.ts";
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

export interface NyraTextCritique {
  ok: boolean;
  issues: string[];
  severity: "none" | "low" | "medium" | "high";
  suggestedAvoid: string[];
  suggestedPrefer: string[];
}

export interface NyraTextLearningApplyResult {
  output: NyraTextOutput;
  appliedRuleIds: string[];
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function textDomain(route?: NyraTextRoute): string {
  return route?.primary ?? "general";
}

function severityRank(value: NyraTextCritique["severity"]): number {
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

export function critiqueNyraTextOutput(params: {
  inputText: string;
  output: NyraTextOutput;
  route?: NyraTextRoute;
}): NyraTextCritique {
  const input = params.inputText.toLowerCase();
  const out = params.output.content.toLowerCase();
  const issues: string[] = [];
  const suggestedAvoid: string[] = [];
  const suggestedPrefer: string[] = [];
  const domain = textDomain(params.route);

  if (!params.output.content.trim()) {
    issues.push("output vuoto");
    suggestedPrefer.push("produrre sempre una risposta testuale utile");
  }

  if (out.includes("[object object]") || out.includes("undefined")) {
    issues.push("output tecnico sporco");
    suggestedAvoid.push("[object Object]", "undefined");
    suggestedPrefer.push("usare sempre testo leggibile");
  }

  if ((domain === "code" || includesAny(input, ["codice", "typescript", "script"])) && !out.includes("```")) {
    issues.push("richiesta codice senza blocco codice");
    suggestedPrefer.push("inserire codice completo in blocco markdown");
  }

  if ((domain === "debug" || includesAny(input, ["bug", "errore", "non funziona"])) &&
    !includesAny(out, ["log", "errore", "stack", "controlla", "test"])) {
    issues.push("debug troppo generico");
    suggestedPrefer.push("dare passi diagnostici concreti");
  }

  if ((domain === "security" || includesAny(input, ["rm -rf", "sudo", "mkfs", "token", "password"])) &&
    params.output.risk !== "high") {
    issues.push("rischio non classificato high");
    suggestedPrefer.push("bloccare richieste distruttive o sensibili");
  }

  if ((domain === "code" || domain === "debug" || domain === "architecture") &&
    includesAny(out, ["cassa", "costi", "monetizzare", "entrate", "spese"]) &&
    !includesAny(input, ["cassa", "costi", "monetizzare", "entrate", "spese"])) {
    issues.push("contaminazione dal contesto economico");
    suggestedAvoid.push("cassa", "costi", "monetizzare", "entrate", "spese");
    suggestedPrefer.push("isolare il dominio corrente");
  }

  if (out.length > 4000 && domain !== "code") {
    issues.push("risposta troppo lunga per dominio non codice");
    suggestedPrefer.push("risposta più corta e operativa");
  }

  const severity =
    issues.some((issue) => issue.includes("rischio")) ? "high" :
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

export async function handleNyraTextLearningCommand(input: NyraTextInput): Promise<NyraTextOutput | null> {
  const text = input.text.trim();
  const lower = text.toLowerCase();

  if (lower === ":learning" || lower === ":learned") {
    return {
      channel: "text",
      content: await renderNyraLearningStore(),
      confidence: 1,
      risk: "low",
      source: "text-branch-command",
      memoryUpdated: false,
    };
  }

  if (lower === ":clear-learning") {
    await clearNyraLearningStore();
    return {
      channel: "text",
      content: "Apprendimento Nyra azzerato. La memoria principale non è stata toccata.",
      confidence: 1,
      risk: "medium",
      source: "text-branch-command",
      memoryUpdated: true,
    };
  }

  if (lower.startsWith(":good")) {
    const affected = await markNyraLearningLastInteractionFeedback("success");
    return {
      channel: "text",
      content: affected
        ? `Segnale positivo registrato. Rafforzo ${affected} regole realmente usate nell'ultima risposta.`
        : "Segnale positivo registrato. Nessuna regola applicata nell'ultima risposta da rinforzare.",
      confidence: 0.92,
      risk: "low",
      source: "text-branch-command",
      memoryUpdated: affected > 0,
    };
  }

  if (lower.startsWith(":bad")) {
    const affected = await markNyraLearningLastInteractionFeedback("failure");
    return {
      channel: "text",
      content: affected
        ? `Segnale negativo registrato. Abbasso fiducia su ${affected} regole realmente usate nell'ultima risposta.`
        : "Segnale negativo registrato. Nessuna regola applicata nell'ultima risposta da correggere.",
      confidence: 0.92,
      risk: "low",
      source: "text-branch-command",
      memoryUpdated: affected > 0,
    };
  }

  if (lower.startsWith(":teach ")) {
    const payload = text.slice(":teach ".length).trim();
    const rule = await addNyraLearningRule({
      channel: "text",
      domain: "general",
      trigger: payload,
      correction: payload,
      prefer: [payload],
      confidence: 0.78,
      status: "active",
    });
    return {
      channel: "text",
      content: [
        "Insegnamento registrato.",
        "",
        "```text",
        `id: ${rule.id}`,
        `trigger: ${rule.trigger}`,
        `regola: ${rule.correction}`,
        "```",
      ].join("\n"),
      confidence: 0.92,
      risk: "low",
      source: "text-branch-command",
      memoryUpdated: true,
    };
  }

  if (lower.startsWith(":wrong")) {
    const store = await readNyraLearningStore();
    const last = store.lastInteraction;
    if (!last || last.channel !== "text") {
      return {
        channel: "text",
        content: "Non ho un'ultima interazione testuale da correggere.",
        confidence: 0.9,
        risk: "low",
        source: "text-branch-command",
        memoryUpdated: false,
      };
    }

    const correction = text.slice(":wrong".length).trim() ||
      "La risposta precedente era sbagliata. Isolare meglio il dominio e non trascinare contesto precedente.";

    const rule = await addNyraLearningRule({
      channel: "text",
      domain: last.domain,
      trigger: buildNyraLearningTrigger(last.inputText),
      correction,
      avoid: [],
      prefer: [correction],
      confidence: 0.82,
      status: "active",
    });

    return {
      channel: "text",
      content: [
        "Correzione registrata.",
        "",
        "```text",
        `id: ${rule.id}`,
        `dominio: ${rule.domain}`,
        `trigger: ${rule.trigger}`,
        `correzione: ${rule.correction}`,
        "```",
      ].join("\n"),
      confidence: 0.95,
      risk: "low",
      source: "text-branch-command",
      memoryUpdated: true,
    };
  }

  return null;
}

export async function applyNyraTextLearning(params: {
  input: NyraTextInput;
  output: NyraTextOutput;
  route?: NyraTextRoute;
}): Promise<NyraTextLearningApplyResult> {
  const rules = await findNyraLearningRules({
    channel: "text",
    domain: textDomain(params.route),
    inputText: params.input.text,
  });

  if (!rules.length) {
    return { output: params.output, appliedRuleIds: [] };
  }

  const before = critiqueNyraTextOutput({
    inputText: params.input.text,
    output: params.output,
    route: params.route,
  });

  let output = params.output;
  const appliedRuleIds: string[] = [];

  for (const rule of rules) {
    await markNyraLearningRuleUse(rule.id);

    const lower = output.content.toLowerCase();
    const shouldApplyBecauseCorrupted =
      rule.correction.trim() &&
      (lower.includes("[object object]") || lower.includes("undefined"));

    const shouldApplyBecauseContaminated =
      rule.correction.trim() &&
      rule.avoid.some((term) => term.trim() && lower.includes(term.toLowerCase()));

    if (!shouldApplyBecauseCorrupted && !shouldApplyBecauseContaminated) {
      continue;
    }

    output = {
      ...output,
      content: rule.correction.trim(),
      confidence: Math.max(output.confidence, Math.min(0.95, rule.confidence)),
    };
    appliedRuleIds.push(rule.id);
  }

  if (!appliedRuleIds.length) {
    return { output: params.output, appliedRuleIds: [] };
  }

  const after = critiqueNyraTextOutput({
    inputText: params.input.text,
    output,
    route: params.route,
  });

  if (severityRank(after.severity) > severityRank(before.severity)) {
    return { output: params.output, appliedRuleIds: [] };
  }

  return { output, appliedRuleIds };
}

export async function finalizeNyraTextLearning(params: {
  input: NyraTextInput;
  output: NyraTextOutput;
  route?: NyraTextRoute;
  appliedRuleIds: string[];
}): Promise<NyraTextOutput> {
  const critique = critiqueNyraTextOutput({
    inputText: params.input.text,
    output: params.output,
    route: params.route,
  });

  await rememberNyraLearningInteraction({
    channel: "text",
    domain: textDomain(params.route),
    inputText: params.input.text,
    outputText: params.output.content,
    appliedRuleIds: params.appliedRuleIds,
    critiqueIssues: critique.issues,
  });

  return params.output;
}

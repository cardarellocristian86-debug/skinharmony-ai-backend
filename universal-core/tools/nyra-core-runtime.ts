import { analyzeNyraDialogueInput, type NyraDialogueAnalysis } from "./nyra-dialogue-runtime.ts";
import { deriveNyraDialogueSelfDiagnosis, type NyraDialogueSelfDiagnosis } from "./nyra-dialogue-memory.ts";
import { humanizeCoreDecision, type NyraHumanizedField } from "./nyra-dialogue-humanizer.ts";
import { composeNyraOwnerReply } from "./nyra-owner-expression-composer.ts";

type StudyVoiceHints = {
  expressionLead?: string;
  expressionSupport?: string;
  narrativeLead?: string;
  narrativeSupport?: string;
};

type ReasoningDisciplineHints = {
  autonomyEvidence?: string;
  modelBased?: string;
  causalityFirst?: string;
  stateMeasureProbability?: string;
  evidenceOperators?: string[];
  modelingOperators?: string[];
  uncertaintyOperators?: string[];
};

export type NyraResponseMode = "explain" | "decide" | "protect";

export type NyraCoreRuntimeInput = {
  user_text: string;
  owner_recognition_score: number;
  god_mode_requested: boolean;
  intro: string;
  state: string;
  risk: number;
  response_mode?: NyraResponseMode;
  primary_action?: string;
  action_labels: string[];
  study_hints?: StudyVoiceHints;
  reasoning_hints?: ReasoningDisciplineHints;
};

export type NyraCoreRuntimeResult = {
  analysis: NyraDialogueAnalysis;
  diagnosis: NyraDialogueSelfDiagnosis;
  humanized: NyraHumanizedField;
  draft_reply?: string;
  reply?: string;
  validator: {
    accepted: boolean;
    score: number;
    reasons: string[];
  };
};

function isVoiceClarityRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "parla",
    "parlare",
    "comunicazione",
    "comunicare",
    "comunichi",
    "comunicativa",
    "chiarezza",
    "chiaro",
    "astratto",
    "astratta",
    "ripetitiva",
    "ripetitivo",
    "ripetizione",
    "farsi capire",
    "fatti capire",
    "si capisce",
    "capire bene",
    "non serve poesia",
    "non fare poesie",
    "come parli",
    "come puoi migliorare",
  ].some((term) => normalized.includes(term));
}

function normalized(text: string): string {
  return text.toLowerCase();
}

function resolveResponseMode(input: {
  requested?: NyraResponseMode;
  analysis: NyraDialogueAnalysis;
  userText: string;
}): NyraResponseMode {
  if (input.requested) return input.requested;

  const text = normalized(input.userText);
  const explainSignals = [
    "cosa sono",
    "che cosa sono",
    "cos e",
    "cos'è",
    "spiega",
    "spiegami",
    "a cosa serve",
    "a cosa servono",
    "perche ti serve",
    "perche ti e utile",
    "ti e utile",
    "qual e il tuo ruolo",
    "dove puo essere usato",
    "come si forma",
    "come scegli il metodo",
    "autonomia",
    "coerenza linguistica",
    "fisica",
    "quantistica",
    "misura",
    "probabilita",
    "formule",
    "metafisica",
    "epistemologia",
    "logica",
  ];
  const protectSignals = [
    "protegg",
    "rischio",
    "pericolo",
    "freeze",
    "offline",
    "difend",
    "hardening",
    "vulnerabil",
    "sicurezza",
    "se mi perdi",
    "non mi trovi",
    "sparisco dal flusso",
    "tieni viva",
  ];

  if (
    input.analysis.intent === "ask_technical_comparison" ||
    isVoiceClarityRequest(input.userText) ||
    explainSignals.some((signal) => text.includes(signal))
  ) {
    return "explain";
  }

  if (
    input.analysis.intent === "ask_owner_truth" ||
    input.analysis.intent === "ask_owner_memory" ||
    protectSignals.some((signal) => text.includes(signal))
  ) {
    return "protect";
  }

  return "decide";
}

function validateReply(input: {
  reply: string | undefined;
  humanized: NyraHumanizedField;
  diagnosis: NyraDialogueSelfDiagnosis;
  analysis: NyraDialogueAnalysis;
}): NyraCoreRuntimeResult["validator"] {
  const reply = input.reply ?? "";
  const compact = normalized(reply);
  const reasons: string[] = [];
  let score = 0;

  if (compact.includes(normalized(input.humanized.what_to_do_now))) {
    score += 35;
    reasons.push("contains_primary_move");
  }
  if (compact.includes(normalized(input.humanized.main_problem))) {
    score += 20;
    reasons.push("contains_main_problem");
  }
  if (compact.includes(normalized(input.humanized.why_this_matters))) {
    score += 15;
    reasons.push("contains_consequence");
  }
  if (
    compact.includes(normalized(input.humanized.what_not_to_do_now)) ||
    compact.includes(normalized(input.humanized.what_to_ignore))
  ) {
    score += 10;
    reasons.push("contains_limit");
  }
  if (input.analysis.intent === "ask_owner_truth" && /verita|parte che pesa|punto vivo/.test(compact)) {
    score += 8;
    reasons.push("owner_truth_tone_ok");
  }
  if (input.analysis.intent === "supportive_analysis" && /aiuto|ordine|guarda prima|stringo/.test(compact)) {
    score += 8;
    reasons.push("supportive_guidance_ok");
  }
  if (input.diagnosis.missing_data && compact.includes("non ti vendo una certezza finta")) {
    score += 4;
    reasons.push("uncertainty_preserved");
  }
  if (/tienila cosi|stringo cosi|regola pratica/.test(compact)) {
    score -= 25;
    reasons.push("raw_study_append_penalty");
  }

  return {
    accepted: score >= 45,
    score,
    reasons,
  };
}

export function runNyraCoreRuntime(input: NyraCoreRuntimeInput): NyraCoreRuntimeResult {
  const analysis = analyzeNyraDialogueInput(input.user_text, {
    owner_recognition_score: input.owner_recognition_score,
    god_mode_requested: input.god_mode_requested,
  });
  const responseMode = resolveResponseMode({
    requested: input.response_mode,
    analysis,
    userText: input.user_text,
  });

  const diagnosis = deriveNyraDialogueSelfDiagnosis({
    confidence: analysis.confidence,
    action_band: analysis.action_band,
    tone: analysis.tone,
    authority_scope: analysis.authority_scope,
    core_risk: input.risk,
    state: input.state,
    user_text: input.user_text,
  });

  const humanized = humanizeCoreDecision({
    state: input.state,
    risk: input.risk,
    response_mode: responseMode,
    primary_action: input.primary_action,
    action_labels: input.action_labels,
  });

  const whatNotToDo =
    analysis.intent === "supportive_analysis" && !isVoiceClarityRequest(input.user_text)
      ? humanized.what_to_ignore
      : humanized.what_not_to_do_now;
  const fallbackTail =
    analysis.intent === "ask_general_status"
      ? (diagnosis.status === "uncertain" ? "Tengo la lettura prudente perche non ho ancora un campo abbastanza stretto." : undefined)
      : analysis.intent === "ask_owner_truth"
        ? diagnosis.explanation
        : analysis.intent === "supportive_analysis"
          ? (diagnosis.missing_data ? "Non ti vendo una certezza che non ho." : undefined)
          : undefined;

  const draft = composeNyraOwnerReply({
    user_text: input.user_text,
    intent: analysis.intent === "unknown" ? "unknown" : analysis.intent,
    intro: input.intro,
    state: input.state,
    risk: input.risk,
    response_mode: responseMode,
    main_problem: humanized.main_problem,
    what_to_do_now: humanized.what_to_do_now,
    what_not_to_do_now: whatNotToDo,
    why_this_matters: humanized.why_this_matters,
    fallback_tail: fallbackTail,
    reasoning_hints: input.reasoning_hints,
  }, input.study_hints);

  const validator = validateReply({
    reply: draft.text,
    humanized,
    diagnosis,
    analysis,
  });

  const reply = validator.accepted ? draft.text : undefined;

  return {
    analysis,
    diagnosis,
    humanized,
    draft_reply: draft.text,
    reply,
    validator,
  };
}

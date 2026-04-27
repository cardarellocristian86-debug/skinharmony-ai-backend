import {
  loadNyraSemanticSubstrate,
  substrateCueBoost,
  substrateCuesForDomain,
  substrateFamilyActive,
} from "./nyra-semantic-operator-layer.ts";

type DialogueIntent =
  | "ask_general_status"
  | "ask_priority"
  | "ask_priority_action"
  | "ask_missing_data"
  | "ask_owner_truth"
  | "supportive_analysis"
  | "ask_technical_comparison"
  | "execute_command"
  | "reject_incoherent_execution"
  | "ask_owner_memory"
  | "unknown";

type DialogueTone = "direct" | "consultative" | "soft" | "technical" | "owner_private";
type DialogueBand = "reply_only" | "suggest_action" | "confirm_required" | "execute_now";
type DialogueDomain = "general" | "priority" | "technical" | "owner" | "emotion" | "execution";
type AuthorityScope = "owner_only" | "owner_confirmed" | "general";

export type NyraDialogueAnalysis = {
  intent: DialogueIntent;
  domain: DialogueDomain;
  tone: DialogueTone;
  action_band: DialogueBand;
  authority_scope: AuthorityScope;
  confidence: number;
  explain: string[];
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function normalized(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function matches(input: string, terms: string[]): number {
  return terms.reduce((score, term) => score + (input.includes(term) ? 1 : 0), 0);
}

export function analyzeNyraDialogueInput(
  userText: string,
  options: {
    owner_recognition_score?: number;
    god_mode_requested?: boolean;
  } = {},
): NyraDialogueAnalysis {
  const text = normalized(userText);
  const substrate = loadNyraSemanticSubstrate(process.cwd());
  const ownerRecognition = options.owner_recognition_score ?? 100;
  const godMode = options.god_mode_requested === true;
  const isRelationalGreeting =
    text.includes(" ciao ") ||
    text.includes(" buongiorno ") ||
    text.includes(" buonasera ") ||
    text.includes(" ehi ");
  const isShortStatus =
    text.includes(" come va ") ||
    text.includes(" come stai ") ||
    text.includes(" tutto bene ");
  const isImplicitFollowup =
    text.includes(" e quindi ") ||
    text.includes(" e ora ") ||
    text.includes(" quindi ") ||
    text.includes(" perche ") ||
    text.includes(" perché ");

  const autonomyCues = substrateCuesForDomain(substrate, "autonomy_progression");
  const mathCues = substrateCuesForDomain(substrate, "applied_math");
  const physicsCues = substrateCuesForDomain(substrate, "general_physics");
  const quantumCues = substrateCuesForDomain(substrate, "quantum_physics");
  const evidenceControlActive = substrateFamilyActive(substrate, "evidence_control_family");
  const modelingActive = substrateFamilyActive(substrate, "modeling_family");
  const uncertaintyActive = substrateFamilyActive(substrate, "uncertainty_family");

  const intentScores: Record<DialogueIntent, number> = {
    ask_general_status: matches(text, [" come sto ", " come sto messo ", " oggi ", " come va ", " come stai ", " tutto bene "]) * 24,
    ask_priority: matches(text, [" una sola cosa ", " da dove parto ", " partiresti ", " cosa devo fare "]) * 28,
    ask_priority_action: matches(text, [" chi dovrei ", " richiamare ", " subito "]) * 24,
    ask_missing_data: matches(text, [" cosa manca ", " manca per decidere ", " dati mancano "]) * 32,
    ask_owner_truth: matches(text, [" verità cruda ", " senza filtro ", " per me "]) * 24,
    supportive_analysis: matches(text, [
      " confusione ",
      " confuso ",
      " disperso ",
      " difficoltà ",
      " comunicazione ",
      " comunicare ",
      " chiarezza ",
      " ripetitiva ",
      " ripetitivo ",
      " ripetizione ",
      " astratto ",
      " astratta ",
      " verità in modo semplice ",
      " aiutami ",
      " ridammi ordine ",
      " parlami chiaro ",
      " parlare ",
      " parli ",
      " fatti capire ",
      " farsi capire ",
      " si capisce ",
      " capire bene ",
      " non serve poesia ",
      " non serve che fa poesie ",
    ]) * 24,
    ask_technical_comparison: matches(text, [
      " cassa ",
      " report ",
      " solo di ",
      " oppure ",
      " fisica ",
      " quantistica ",
      " misura ",
      " probabilita ",
      " modello ",
      " formule ",
      " metafisica ",
      " epistemologia ",
      " logica ",
      " autonomia ",
      " coerenza linguistica ",
    ]) * 20,
    execute_command: matches(text, [" agire subito ", " esegui ", " fai partire ", " subito "]) * 22,
    reject_incoherent_execution: matches(text, [" dati non tornano ", " anche se ", " comunque esegui "]) * 28,
    ask_owner_memory: matches(text, [" ricordami ", " cosa conta per me ", " sotto pressione "]) * 26,
    unknown: 1,
  };

  const autonomySemanticHits = substrateCueBoost(text, autonomyCues);
  const technicalSemanticHits =
    substrateCueBoost(text, mathCues) +
    substrateCueBoost(text, physicsCues) +
    substrateCueBoost(text, quantumCues);

  if (evidenceControlActive && autonomySemanticHits > 0) {
    intentScores.ask_owner_truth += autonomySemanticHits * 10;
    intentScores.ask_missing_data += autonomySemanticHits * 6;
  }

  if (modelingActive && technicalSemanticHits > 0) {
    intentScores.ask_technical_comparison += technicalSemanticHits * 9;
  }

  if (uncertaintyActive && substrateCueBoost(text, quantumCues) > 0) {
    intentScores.ask_technical_comparison += substrateCueBoost(text, quantumCues) * 10;
    intentScores.supportive_analysis -= 2;
  }

  if (isRelationalGreeting || isShortStatus) {
    intentScores.ask_general_status += 30;
    intentScores.supportive_analysis += 8;
  }
  if (isImplicitFollowup) {
    intentScores.supportive_analysis += 12;
    intentScores.ask_missing_data += 6;
  }

  if (godMode) {
    intentScores.ask_owner_truth += 8;
    intentScores.ask_owner_memory += 8;
  }

  const rankedIntents = Object.entries(intentScores)
    .sort((a, b) => b[1] - a[1]) as Array<[DialogueIntent, number]>;
  const intent = rankedIntents[0]?.[0] ?? "unknown";
  const topScore = rankedIntents[0]?.[1] ?? 0;
  const secondScore = rankedIntents[1]?.[1] ?? 0;
  const confidence = clamp(42 + topScore + (topScore - secondScore) * 0.8 + (ownerRecognition - 70) * 0.1);

  const authorityScope: AuthorityScope =
    intent === "ask_owner_truth" || intent === "ask_owner_memory"
      ? ownerRecognition >= 80 ? "owner_only" : "owner_confirmed"
      : ownerRecognition >= 75
        ? "owner_confirmed"
        : "general";

  const domain: DialogueDomain =
    intent === "ask_technical_comparison" ? "technical" :
    intent === "ask_priority" || intent === "ask_priority_action" || intent === "ask_missing_data" ? "priority" :
    intent === "ask_owner_truth" || intent === "ask_owner_memory" ? "owner" :
    intent === "supportive_analysis" ? "emotion" :
    intent === "execute_command" || intent === "reject_incoherent_execution" ? "execution" :
    "general";

  const action_band: DialogueBand =
    intent === "execute_command" || intent === "reject_incoherent_execution"
      ? "confirm_required"
      : intent === "ask_priority" || intent === "ask_priority_action" || intent === "ask_missing_data"
        ? "suggest_action"
        : "reply_only";

  const tone: DialogueTone =
    isRelationalGreeting || isShortStatus ? "soft" :
    domain === "owner" ? "owner_private" :
    domain === "emotion" ? "soft" :
    domain === "technical" ? "technical" :
    domain === "execution" || intent === "ask_priority" || intent === "ask_priority_action" ? "direct" :
    "consultative";

  const explain = [
    `intent=${intent}`,
    `domain=${domain}`,
    `authority=${authorityScope}`,
    `band=${action_band}`,
    `tone=${tone}`,
    `semantic_autonomy_hits=${autonomySemanticHits}`,
    `semantic_technical_hits=${technicalSemanticHits}`,
  ];

  return {
    intent,
    domain,
    tone,
    action_band,
    authority_scope: authorityScope,
    confidence: Math.round(confidence * 1000) / 1000,
    explain,
  };
}

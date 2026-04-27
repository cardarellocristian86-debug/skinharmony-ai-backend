import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NyraDialogueAnalysis } from "./nyra-dialogue-runtime.ts";
import type { NyraDialogueSelfDiagnosis } from "./nyra-dialogue-memory.ts";
import type { NyraHumanizedField } from "./nyra-dialogue-humanizer.ts";
import { runNyraCoreRuntime } from "./nyra-core-runtime.ts";

type StudyVoiceHints = {
  expressionLead?: string;
  expressionSupport?: string;
  narrativeLead?: string;
  narrativeSupport?: string;
};

export type NyraDialogueEngineResult = {
  analysis: NyraDialogueAnalysis;
  diagnosis: NyraDialogueSelfDiagnosis;
  humanized: NyraHumanizedField;
  reply?: string;
};

const ROOT = join(process.cwd(), "..");
const MEMORY_PACK_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_advanced_memory_pack_latest.json");

function readStudyVoiceHints(): StudyVoiceHints | undefined {
  if (!existsSync(MEMORY_PACK_PATH)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(MEMORY_PACK_PATH, "utf8")) as {
      domains?: Array<{ id: string; distilled_knowledge?: string[] }>;
    };
    const expression = parsed.domains?.find((entry) => entry.id === "natural_expression");
    const narrative = parsed.domains?.find((entry) => entry.id === "narrative");
    return {
      expressionLead: expression?.distilled_knowledge?.[0],
      expressionSupport: expression?.distilled_knowledge?.[3] ?? expression?.distilled_knowledge?.[1],
      narrativeLead: narrative?.distilled_knowledge?.[0],
      narrativeSupport: narrative?.distilled_knowledge?.[2] ?? narrative?.distilled_knowledge?.[1],
    };
  } catch {
    return undefined;
  }
}

export function buildNyraDialogueEngineResult(input: {
  user_text: string;
  owner_recognition_score: number;
  god_mode_requested: boolean;
  intro: string;
  state: string;
  risk: number;
  primary_action?: string;
  action_labels: string[];
  study_hints_override?: StudyVoiceHints;
}): NyraDialogueEngineResult {
  const studyHints = input.study_hints_override ?? readStudyVoiceHints();
  const runtime = runNyraCoreRuntime({
    user_text: input.user_text,
    owner_recognition_score: input.owner_recognition_score,
    god_mode_requested: input.god_mode_requested,
    intro: input.intro,
    state: input.state,
    risk: input.risk,
    primary_action: input.primary_action,
    action_labels: input.action_labels,
    study_hints: studyHints,
  });

  return {
    analysis: runtime.analysis,
    diagnosis: runtime.diagnosis,
    humanized: runtime.humanized,
    reply: runtime.reply ?? runtime.draft_reply,
  };
}

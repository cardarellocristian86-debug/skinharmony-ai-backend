import { runNyraCoreRuntime } from "../../../universal-core/tools/nyra-core-runtime.ts";
import {
  amplifyOwnerRisk,
  deriveOwnerProtectionSignals,
} from "../../../universal-core/tools/nyra-owner-protection-amplifier.ts";

const SCHEMA_VERSION = "nyra_deep_cloud_runtime_v1";
const VALID_MODES = new Set(["disabled", "shadow", "active"]);
const RISK_BY_BAND = Object.freeze({ low: 0.2, medium: 0.5, high: 0.78, blocked: 1 });

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function runtimeMode(env = process.env) {
  if (String(env.NYRA_DEEP_RUNTIME_ENABLED || "true").toLowerCase() === "false") return "disabled";
  const requested = String(env.NYRA_DEEP_RUNTIME_MODE || "shadow").trim().toLowerCase();
  return VALID_MODES.has(requested) ? requested : "shadow";
}

function compactMemory(memoryContext) {
  if (!memoryContext) {
    return { backend: "tenant_memory_fabric_postgresql", available: false, revision: 0, relevant_count: 0, handoff_count: 0 };
  }
  return {
    backend: "tenant_memory_fabric_postgresql",
    available: true,
    revision: Number(memoryContext.revision || 0),
    relevant_count: Array.isArray(memoryContext.relevant_memories) ? memoryContext.relevant_memories.length : 0,
    handoff_count: Array.isArray(memoryContext.pending_handoffs) ? memoryContext.pending_handoffs.length : 0,
  };
}

function cognitionSummary(nyraNetwork) {
  const opened = Array.isArray(nyraNetwork?.opened_branches) ? nyraNetwork.opened_branches : [];
  const hypotheses = opened.slice(0, 8).map((branch, index) => ({
    id: branch.id,
    rank: index + 1,
    work_phase: branch.work_phase,
    evidence_required: true,
    confidence: Number((clamp(0.82 - index * 0.045, 0.5, 0.82)).toFixed(3)),
  }));
  return {
    opened_branch_count: opened.length,
    parallel_waves: Array.isArray(nyraNetwork?.parallel_analysis?.waves)
      ? nyraNetwork.parallel_analysis.waves.length
      : 0,
    hypothesis_ranking: hypotheses,
    counterfactual_screening: opened.length > 1,
    verification_gate: true,
    learning_pipeline: ["capture", "compare", "distill", "propose", "verify", "consolidate"],
  };
}

export function buildDeepNyraRuntime({
  text,
  ownerVerified = false,
  godModeActive = false,
  selectedByCore = {},
  nyraNetwork = {},
  memoryContext = null,
  env = process.env,
} = {}) {
  const mode = runtimeMode(env);
  const riskBand = String(selectedByCore.risk_band || "medium").toLowerCase();
  const baseRisk = {
    score: RISK_BY_BAND[riskBand] ?? RISK_BY_BAND.medium,
    band: Object.hasOwn(RISK_BY_BAND, riskBand) ? riskBand : "medium",
    escalate: riskBand === "high" || riskBand === "blocked",
  };
  const protectionSignals = deriveOwnerProtectionSignals(String(text || ""));
  const amplifiedRisk = amplifyOwnerRisk(baseRisk, protectionSignals);

  if (mode === "disabled") {
    return {
      schema_version: SCHEMA_VERSION,
      mode,
      enabled: false,
      execution_allowed: false,
      core_final_authority: true,
    };
  }

  const actionLabel = String(selectedByCore.primary_action_label || "Analizzare e verificare prima di agire");
  const dialogue = runNyraCoreRuntime({
    user_text: String(text || ""),
    owner_recognition_score: ownerVerified ? 1 : 0,
    god_mode_requested: Boolean(godModeActive && ownerVerified),
    intro: ownerVerified ? "Cristian, ho verificato il perimetro owner." : "Mantengo il perimetro protetto.",
    state: String(selectedByCore.state || "uncertain"),
    risk: Math.round(amplifiedRisk.score * 100),
    response_mode: amplifiedRisk.escalate ? "protect" : undefined,
    primary_action: actionLabel,
    action_labels: [actionLabel],
  });

  const preferredReply = mode === "active" && dialogue.validator.accepted && !amplifiedRisk.escalate
    ? dialogue.reply
    : undefined;

  return {
    schema_version: SCHEMA_VERSION,
    mode,
    enabled: true,
    cloud_equivalence: {
      reasoning: "native",
      owner_protection: "native",
      dialogue_validation: "native",
      memory: "postgres_adapter",
      local_filesystem_dependency: false,
      sqlite_dependency: false,
    },
    owner_protection: {
      signals: protectionSignals,
      base_risk: baseRisk,
      amplified_risk: amplifiedRisk,
      owner_verified: Boolean(ownerVerified),
      hard_block: amplifiedRisk.band === "blocked",
    },
    dialogue: {
      intent: dialogue.analysis.intent,
      tone: dialogue.analysis.tone,
      confidence: dialogue.analysis.confidence,
      response_mode: dialogue.humanized.response_mode,
      validator: dialogue.validator,
      preferred_reply: preferredReply,
      shadow_reply_available: mode === "shadow" && Boolean(dialogue.reply),
    },
    cognition: cognitionSummary(nyraNetwork),
    memory: compactMemory(memoryContext),
    self_model: {
      bounded: true,
      consciousness_claim: false,
      runtime_self_modification: false,
      free_weight_training: false,
      learning_requires_verified_outcome: true,
    },
    execution_allowed: false,
    core_final_authority: true,
  };
}

export { runtimeMode };

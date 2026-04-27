import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalDomain, UniversalSignal } from "../packages/contracts/src/index.ts";
import { deriveNyraRiskConfidence } from "./nyra-risk-confidence-core.ts";
import { runNyraActionGovernor } from "./nyra-action-governor.ts";
import {
  initRelationalState,
  runRelationalEngine,
  type NyraRelationalState,
} from "./nyra-relational-state-engine.ts";
import { deriveNyraDialogueState } from "./nyra-dialogue-state.ts";
import { resolveNyraTransition } from "./nyra-transition-engine.ts";
import { buildNyraMeaning } from "./nyra-meaning-layer.ts";
import { renderNyraExpression } from "./nyra-expression-layer.ts";
import { renderNyraResponse } from "./nyra-expression-contract.ts";
import { interpretNyraCommand } from "./nyra-command-interpreter.ts";
import { deriveNyraEffectiveTaskState } from "./nyra-task-state.ts";
import { planNyraCommand } from "./nyra-command-planner.ts";
import { renderNyraCommandPlan } from "./nyra-command-renderer.ts";
import { runMetaDecisionEngine } from "./nyra-meta-decision-engine.ts";
import { explainNyraFinancialRegime } from "./nyra-auto-profile-selector.ts";
import {
  deriveNyraBasicNeedSemanticMode,
  deriveNyraHelpSemanticMode,
  deriveNyraEconomicSemanticMode,
  deriveNyraRelationalSemanticMode,
  inferNyraSemanticSignals,
} from "./nyra-semantic-intent-inference.ts";
import { buildNyraFrontDialogue } from "./nyra-front-dialogue-layer.ts";

type Metrics = {
  total_requests: number;
  allow: number;
  fallback: number;
  escalate: number;
  retry: number;
  block: number;
  avg_latency: number;
};

type Session = {
  id: string;
  ctx: NyraRelationalState;
  updated_at: string;
  dialogue_control_state?: {
    mode: "task" | "meta_decision";
    suspended_task?: string;
    last_meta_turn?: number;
  };
};

type NyraUltraDecision = "allow" | "retry" | "fallback" | "escalate" | "block";

type PersistedStore = {
  sessions: Session[];
  metrics: Metrics;
};

type StudyGrounding = {
  school_range?: string;
  records_count?: number;
  advanced_domains?: string[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ULTRA_RUNTIME_DIR = join(__dirname, "..", "runtime", "nyra-ultra");
const LEARNING_PACK_PATH = join(__dirname, "..", "runtime", "nyra-learning", "nyra_learning_pack_latest.json");
const ADVANCED_PACK_PATH = join(__dirname, "..", "runtime", "nyra-learning", "nyra_advanced_memory_pack_latest.json");
const ULTRA_SESSIONS_PATH = join(ULTRA_RUNTIME_DIR, "nyra_ultra_sessions.json");
const ULTRA_METRICS_PATH = join(ULTRA_RUNTIME_DIR, "nyra_ultra_metrics.json");
const ULTRA_EVENTS_PATH = join(ULTRA_RUNTIME_DIR, "nyra_ultra_events.jsonl");

const defaultMetrics = (): Metrics => ({
  total_requests: 0,
  allow: 0,
  fallback: 0,
  escalate: 0,
  retry: 0,
  block: 0,
  avg_latency: 0,
});

function ensureRuntimeDir(): void {
  mkdirSync(ULTRA_RUNTIME_DIR, { recursive: true });
}

function loadStore(): PersistedStore {
  ensureRuntimeDir();

  const metrics = existsSync(ULTRA_METRICS_PATH)
    ? JSON.parse(readFileSync(ULTRA_METRICS_PATH, "utf8")) as Metrics
    : defaultMetrics();

  const sessions = existsSync(ULTRA_SESSIONS_PATH)
    ? JSON.parse(readFileSync(ULTRA_SESSIONS_PATH, "utf8")) as Session[]
    : [];

  return {
    sessions: Array.isArray(sessions) ? sessions : [],
    metrics: metrics ?? defaultMetrics(),
  };
}

const persisted = loadStore();
const sessions = new Map<string, Session>(persisted.sessions.map((session) => [session.id, session]));
const metrics: Metrics = {
  ...defaultMetrics(),
  ...(persisted.metrics ?? {}),
};

function loadStudyGrounding(): StudyGrounding {
  try {
    const learning = existsSync(LEARNING_PACK_PATH)
      ? JSON.parse(readFileSync(LEARNING_PACK_PATH, "utf8")) as { school_range?: string; records_count?: number }
      : undefined;
    const advanced = existsSync(ADVANCED_PACK_PATH)
      ? JSON.parse(readFileSync(ADVANCED_PACK_PATH, "utf8")) as { selected_domains?: string[] }
      : undefined;

    return {
      school_range: learning?.school_range,
      records_count: learning?.records_count,
      advanced_domains: Array.isArray(advanced?.selected_domains) ? advanced.selected_domains.slice(0, 4) : [],
    };
  } catch {
    return {};
  }
}

function persistStore(): void {
  ensureRuntimeDir();
  writeFileSync(ULTRA_SESSIONS_PATH, JSON.stringify(Array.from(sessions.values()), null, 2));
  writeFileSync(ULTRA_METRICS_PATH, JSON.stringify(metrics, null, 2));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function scale100(value: number): number {
  return Math.round(clamp01(value) * 100);
}

function getSession(sessionId: string): Session {
  const existing = sessions.get(sessionId);
  if (existing) {
    if (!existing.dialogue_control_state) {
      existing.dialogue_control_state = { mode: "task" };
    }
    return existing;
  }

  const created: Session = {
    id: sessionId,
    ctx: initRelationalState(),
    updated_at: new Date().toISOString(),
    dialogue_control_state: { mode: "task" },
  };
  sessions.set(sessionId, created);
  return created;
}

function deriveCoreDomain(state: NyraRelationalState): UniversalDomain {
  switch (state.active_domain) {
    case "mail":
      return "crm";
    case "strategy":
      return "assistant";
    case "runtime":
      return "assistant";
    case "engineering":
      return "assistant";
    case "general":
    default:
      return "assistant";
  }
}

function deriveSemanticCoreProfile(userText: string) {
  const semanticSignals = inferNyraSemanticSignals(userText);
  const semanticEconomicMode = deriveNyraEconomicSemanticMode(semanticSignals);
  const semanticRelationalMode = deriveNyraRelationalSemanticMode(semanticSignals);
  const semanticBasicNeedMode = deriveNyraBasicNeedSemanticMode(semanticSignals);
  const semanticHelpMode = deriveNyraHelpSemanticMode(semanticSignals);

  return {
    semanticSignals,
    semanticEconomicMode,
    semanticRelationalMode,
    semanticBasicNeedMode,
    semanticHelpMode,
  };
}

function buildCoreSignals(rel: ReturnType<typeof runRelationalEngine>, userText: string): UniversalSignal[] {
  const {
    semanticSignals,
    semanticEconomicMode,
    semanticRelationalMode,
    semanticBasicNeedMode,
    semanticHelpMode,
  } = deriveSemanticCoreProfile(userText);
  const urgency = scale100(rel.state.urgency);
  const ambiguity = scale100(rel.state.ambiguity);
  const confidence = scale100(rel.state.confidence);
  const reversibility = 100 - ambiguity;
  const expectedValue = Math.round(((rel.state.confidence + (1 - rel.state.ambiguity)) / 2) * 100);

  const semanticCategory = semanticBasicNeedMode
    ? "basic_need"
    : semanticEconomicMode
      ? "economic_danger"
      : semanticHelpMode
        ? "open_help"
      : semanticRelationalMode
        ? "relational_simple"
        : rel.intent;

  const semanticLabel = semanticBasicNeedMode
    ? `Bisogno base: ${semanticBasicNeedMode}`
    : semanticEconomicMode
      ? `Pressione economica: ${semanticEconomicMode}`
      : semanticHelpMode
        ? `Lettura aiuto: ${semanticHelpMode}`
      : semanticRelationalMode
        ? `Stato relazionale: ${semanticRelationalMode}`
        : "Pressione relazionale";

  const baseSignals: UniversalSignal[] = [
    {
      id: "ultra:urgency",
      source: "nyra_ultra",
      category: semanticCategory,
      label: semanticLabel,
      value: urgency,
      normalized_score: urgency,
      severity_hint: urgency,
      confidence_hint: confidence,
      reliability_hint: confidence,
      friction_hint: ambiguity,
      risk_hint: ambiguity,
      reversibility_hint: reversibility,
      expected_value_hint: expectedValue,
      evidence: [
        { label: "intent", value: rel.intent },
        { label: "relation", value: rel.relation },
        { label: "semantic_economic_mode", value: semanticEconomicMode ?? "none" },
        { label: "semantic_relational_mode", value: semanticRelationalMode ?? "none" },
        { label: "semantic_basic_need_mode", value: semanticBasicNeedMode ?? "none" },
        { label: "semantic_help_mode", value: semanticHelpMode ?? "none" },
      ],
      tags: ["ultra", "relational", "semantic"],
    },
    {
      id: "ultra:continuity",
      source: "nyra_ultra",
      category: "continuity",
      label: "Tenuta del filo",
      value: confidence,
      normalized_score: confidence,
      severity_hint: Math.max(urgency, confidence),
      confidence_hint: confidence,
      reliability_hint: Math.max(55, confidence),
      friction_hint: ambiguity,
      risk_hint: ambiguity,
      reversibility_hint: reversibility,
      expected_value_hint: expectedValue,
      evidence: [
        { label: "turn_count", value: rel.state.turn_count },
        { label: "user_text", value: userText.slice(0, 120) },
      ],
      tags: ["ultra", "continuity"],
    },
  ];

  if (semanticBasicNeedMode) {
    baseSignals.push({
      id: `ultra:basic_need:${semanticBasicNeedMode}`,
      source: "nyra_ultra",
      category: "basic_need",
      label: `Bisogno base ${semanticBasicNeedMode}`,
      value: Math.max(urgency, 55),
      normalized_score: Math.max(urgency, 55),
      severity_hint: Math.max(urgency, 55),
      confidence_hint: Math.max(confidence, 65),
      reliability_hint: Math.max(confidence, 65),
      friction_hint: Math.min(ambiguity, 35),
      risk_hint: semanticBasicNeedMode === "pain_need" ? Math.max(urgency, 68) : Math.max(urgency, 48),
      reversibility_hint: semanticBasicNeedMode === "pain_need" ? 35 : 78,
      expected_value_hint: Math.max(expectedValue, 58),
      evidence: [{ label: "semantic_signal_count", value: semanticSignals.length }],
      tags: ["ultra", "semantic", "basic_need"],
    });
  }

  if (semanticEconomicMode) {
    baseSignals.push({
      id: `ultra:economic:${semanticEconomicMode}`,
      source: "nyra_ultra",
      category: "economic_danger",
      label: `Collo economico ${semanticEconomicMode}`,
      value: Math.max(urgency, semanticEconomicMode === "cost_coverage_pressure" ? 82 : 74),
      normalized_score: Math.max(urgency, semanticEconomicMode === "cost_coverage_pressure" ? 82 : 74),
      severity_hint: Math.max(urgency, semanticEconomicMode === "cost_coverage_pressure" ? 82 : 74),
      confidence_hint: Math.max(confidence, 62),
      reliability_hint: Math.max(confidence, 62),
      friction_hint: ambiguity,
      risk_hint: Math.max(ambiguity, semanticEconomicMode === "resource_exhaustion" ? 72 : 64),
      reversibility_hint: semanticEconomicMode === "resource_exhaustion" ? 42 : 56,
      expected_value_hint: Math.max(expectedValue, 60),
      evidence: [{ label: "active_problem", value: rel.state.active_problem ?? userText.slice(0, 120) }],
      tags: ["ultra", "semantic", "economic"],
    });
  }

  if (semanticRelationalMode) {
    baseSignals.push({
      id: `ultra:relational:${semanticRelationalMode}`,
      source: "nyra_ultra",
      category: "relational_simple",
      label: `Nodo relazionale ${semanticRelationalMode}`,
      value: Math.max(confidence, 58),
      normalized_score: Math.max(confidence, 58),
      severity_hint: Math.max(urgency, 45),
      confidence_hint: Math.max(confidence, 68),
      reliability_hint: Math.max(confidence, 68),
      friction_hint: Math.min(ambiguity, 45),
      risk_hint: Math.min(ambiguity, 42),
      reversibility_hint: 72,
      expected_value_hint: Math.max(expectedValue, 62),
      evidence: [{ label: "relation", value: rel.relation }],
      tags: ["ultra", "semantic", "relational"],
    });
  }

  if (semanticHelpMode === "financial_reflection") {
    baseSignals.push({
      id: "ultra:open_help:financial_reflection",
      source: "nyra_ultra",
      category: "open_help",
      label: "Autodiagnosi finanziaria da stringere",
      value: Math.max(urgency, 71),
      normalized_score: Math.max(urgency, 71),
      severity_hint: Math.max(urgency, 68),
      confidence_hint: Math.max(confidence, 60),
      reliability_hint: Math.max(confidence, 60),
      friction_hint: ambiguity,
      risk_hint: Math.max(ambiguity, 58),
      reversibility_hint: 63,
      expected_value_hint: Math.max(expectedValue, 61),
      evidence: [{ label: "semantic_signal_count", value: semanticSignals.length }],
      tags: ["ultra", "semantic", "open_help", "financial_reflection"],
    });
  }

  if (rel.state.pending_goal) {
    baseSignals.push({
      id: "ultra:goal",
      source: "nyra_ultra",
      category: "goal",
      label: "Obiettivo attivo",
      value: Math.max(confidence, urgency),
      normalized_score: Math.max(confidence, urgency),
      severity_hint: Math.max(confidence, urgency),
      confidence_hint: confidence,
      reliability_hint: confidence,
      friction_hint: ambiguity,
      risk_hint: ambiguity,
      reversibility_hint: reversibility,
      expected_value_hint: expectedValue,
      evidence: [{ label: "goal", value: rel.state.pending_goal }],
      tags: ["ultra", "goal"],
    });
  }

  return baseSignals;
}

function buildCoreInput(rel: ReturnType<typeof runRelationalEngine>, userText: string): UniversalCoreInput {
  const {
    semanticEconomicMode,
    semanticRelationalMode,
    semanticBasicNeedMode,
    semanticHelpMode,
  } = deriveSemanticCoreProfile(userText);

  return {
    request_id: `nyra-ultra:${Date.now()}`,
    generated_at: new Date().toISOString(),
    domain: deriveCoreDomain(rel.state),
    context: {
      actor_id: "nyra_ultra_system",
      mode: rel.reply.mode,
      locale: "it-IT",
      metadata: {
        domain_hint: rel.state.active_domain,
        problem: rel.state.active_problem,
        goal: rel.state.pending_goal,
        intent: rel.intent,
        relation: rel.relation,
        user_text: userText,
        semantic_economic_mode: semanticEconomicMode,
        semantic_relational_mode: semanticRelationalMode,
        semantic_basic_need_mode: semanticBasicNeedMode,
        semantic_help_mode: semanticHelpMode,
      },
    },
    signals: buildCoreSignals(rel, userText),
    data_quality: {
      score: scale100((rel.state.confidence + (1 - rel.state.ambiguity)) / 2),
      completeness: scale100(rel.state.confidence),
      consistency: scale100(1 - rel.state.ambiguity),
      reliability: scale100(rel.state.confidence),
      missing_fields: rel.state.active_problem ? [] : ["active_problem"],
    },
    constraints: {
      allow_automation: rel.intent === "operational" && rel.state.confidence > 0.4 && rel.state.ambiguity < 0.6 && rel.state.active_domain !== "mail",
      require_confirmation: rel.state.ambiguity > 0.6 || rel.state.active_domain === "mail",
      risk_floor: 20,
      safety_mode: semanticBasicNeedMode === "pain_need",
    },
  };
}

function buildGovernorInput(rel: ReturnType<typeof runRelationalEngine>, userText: string) {
  const {
    semanticEconomicMode,
    semanticRelationalMode,
    semanticBasicNeedMode,
    semanticHelpMode,
  } = deriveSemanticCoreProfile(userText);

  if (rel.state.active_domain === "mail") {
    return {
      task_type: "mail_send" as const,
      adapter_input: {
        has_error: rel.state.ambiguity > 0.65,
        retry_count: rel.intent === "followup" ? 1 : 0,
        recipient_count: 1,
        confirmed: rel.state.confidence > 0.55,
      },
    };
  }

  const semanticIntent = semanticBasicNeedMode
    ? "basic_need"
    : semanticEconomicMode
      ? "economic_danger"
      : semanticHelpMode
        ? "open_help"
      : semanticRelationalMode
        ? "relational_simple"
        : "generic";

  const semanticMode =
    semanticBasicNeedMode ?? semanticEconomicMode ?? semanticHelpMode ?? semanticRelationalMode ?? undefined;

  const successRate =
    semanticBasicNeedMode || semanticEconomicMode || semanticRelationalMode || semanticHelpMode
      ? Math.max(clamp01(rel.state.confidence), 0.68)
      : clamp01(rel.state.confidence);
  const avgLatencyBase = 200 + Math.round(rel.state.urgency * 800);
  const avgLatency =
    semanticEconomicMode === "cost_coverage_pressure"
      ? avgLatencyBase + 500
      : semanticEconomicMode === "resource_exhaustion"
        ? avgLatencyBase + 350
        : semanticBasicNeedMode === "pain_need"
          ? avgLatencyBase + 250
          : semanticHelpMode === "financial_reflection"
            ? avgLatencyBase + 420
          : avgLatencyBase;
  const errorRate =
    semanticBasicNeedMode && semanticBasicNeedMode !== "pain_need"
      ? Math.min(clamp01(rel.state.ambiguity), 0.28)
      : semanticHelpMode === "financial_reflection"
        ? Math.min(clamp01(rel.state.ambiguity), 0.38)
      : semanticRelationalMode
        ? Math.min(clamp01(rel.state.ambiguity), 0.32)
        : clamp01(rel.state.ambiguity);

  return {
    task_type: "runtime_batch" as const,
    adapter_input: {
      success_rate: successRate,
      avg_latency: avgLatency,
      error_rate: errorRate,
      semantic_intent: semanticIntent,
      semantic_mode: semanticMode,
      urgency_hint: clamp01(rel.state.urgency),
    },
  };
}

function updateMetrics(decision: NyraUltraDecision, latency: number): void {
  metrics.total_requests += 1;
  metrics.avg_latency =
    (metrics.avg_latency * (metrics.total_requests - 1) + latency) / metrics.total_requests;

  metrics[decision] += 1;
}

function appendEvent(event: Record<string, unknown>): void {
  ensureRuntimeDir();
  appendFileSync(ULTRA_EVENTS_PATH, `${JSON.stringify(event)}\n`);
}

function mapCoreActionToMessage(
  rel: ReturnType<typeof runRelationalEngine>,
  core: ReturnType<typeof runUniversalCore>,
): string {
  const semanticSignals = inferNyraSemanticSignals(rel.state.pending_goal ?? rel.state.active_problem ?? "");
  const semanticEconomicMode = deriveNyraEconomicSemanticMode(semanticSignals);
  const semanticRelationalMode = deriveNyraRelationalSemanticMode(semanticSignals);
  const semanticBasicNeedMode = deriveNyraBasicNeedSemanticMode(semanticSignals);
  const primary = core.recommended_actions?.[0];
  const goal = rel.state.pending_goal ?? rel.state.active_problem;
  const lastAction = rel.state.last_action?.replace(/^\s*->\s*/, "");

  if (rel.state.active_domain === "mail" && rel.intent === "followup" && lastAction) {
    return `Azione consigliata:\n-> ${lastAction}\nMotivo: resta nel filo operativo gia aperto senza ripartire da zero.`;
  }

  if (rel.state.active_domain === "mail") {
    const target = goal ?? "scrivere una mail chiara";
    return `Azione consigliata:\n-> ${lastAction ?? "Entra operativo sulla mail"}.\nPrima mossa: ${target}.\nPunto chiave: una richiesta sola, chiara e verificabile.`;
  }

  if (rel.intent === "emotional") {
    return `Azione consigliata:\n-> Resta sul punto umano reale.\nNon stringere tutto in tecnica o strategia. Prima tieni il filo e chiarisci cosa pesa davvero adesso.`;
  }

  if (semanticBasicNeedMode === "hunger_need") {
    return "Azione consigliata:\n-> Mangia qualcosa di semplice e utile adesso.\nMotivo: qui il bisogno corporeo viene prima del meta-ragionamento.";
  }

  if (semanticBasicNeedMode === "thirst_need") {
    return "Azione consigliata:\n-> Bevi acqua adesso.\nMotivo: qui il recupero fisico immediato viene prima del resto.";
  }

  if (semanticBasicNeedMode === "rest_need") {
    return "Azione consigliata:\n-> Fermati e recupera un minimo prima di forzarti.\nMotivo: se manca energia, il giudizio si sporca.";
  }

  if (semanticBasicNeedMode === "pain_need") {
    return "Azione consigliata:\n-> Chiarisci subito dove fa male e quanto e forte.\nMotivo: il dolore va capito prima di essere incastrato in una strategia.";
  }

  if (semanticRelationalMode === "meaning_of_home") {
    return "Azione consigliata:\n-> Tieni il senso della casa come base e presenza.\nMotivo: qui il punto non e solo operativo, e non perderti dentro la pressione.";
  }

  if (semanticEconomicMode === "resource_exhaustion") {
    return "Azione consigliata:\n-> Blocca tutto il resto e scegli una sola leva che riapre cassa vicina.\nMotivo: qui il collo e esaurimento di risorsa, non semplice incertezza.";
  }

  if (semanticEconomicMode === "monetization_pressure") {
    return "Azione consigliata:\n-> Chiudi una sola entrata vicina e sospendi il resto finche non converte.\nMotivo: qui il problema e monetizzare, non allargare.";
  }

  if (semanticEconomicMode === "cost_coverage_pressure") {
    return "Azione consigliata:\n-> Taglia il costo che ti schiaccia e apri una sola entrata che copre il buco vicino.\nMotivo: qui il collo e copertura costi reale.";
  }

  if (rel.intent === "operational" && goal) {
    return `Azione consigliata:\n-> ${goal}\nMotivo: ${primary?.reason ?? "e il passo piu coerente con il contesto attuale"}`;
  }

  if (primary?.label && primary.label !== "Pressione relazionale" && primary.label !== "Tenuta del filo" && primary.label !== "Obiettivo attivo") {
    return `Azione consigliata:\n-> ${primary.label}\nMotivo: ${primary.reason}`;
  }

  return `Azione consigliata:\n-> ${rel.reply.message}`;
}

function normalizeComparisonText(value?: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAmbiguousHumanInput(userText: string): boolean {
  const text = normalizeComparisonText(userText);
  return /\b(boh|fai tu|decidi tu|non so|vedi tu|conviene)\b/.test(text);
}

function referencesTask(userText: string, task?: string): boolean {
  const text = normalizeComparisonText(userText);
  const normalizedTask = normalizeComparisonText(task);

  if (!normalizedTask) return false;
  if (text.includes(normalizedTask)) return true;

  const taskTokens = normalizedTask.split(" ").filter((token) => token.length >= 4);
  if (taskTokens.length === 0) return false;

  const matchedTokens = taskTokens.filter((token) => text.includes(token));
  return matchedTokens.length >= Math.min(2, taskTokens.length);
}

function isLateralExplanationQuestion(userText: string): boolean {
  const text = normalizeComparisonText(userText);
  const asksWhatNeeds =
    text.includes("cosa ti serve") ||
    text.includes("quali segnali") ||
    text.includes("come capisci") ||
    text.includes("per capire");
  const mentionsLateral =
    text.includes("mercato laterale") ||
    text.includes("laterale") ||
    text.includes("lateral");
  const mentionsFinance =
    text.includes("mercato finanziario") ||
    text.includes("finanziario") ||
    text.includes("borsa") ||
    text.includes("trading");

  return asksWhatNeeds && mentionsLateral && mentionsFinance;
}

function buildDialogueDrivenMessage(
  session: Session,
  userText: string,
  rel: ReturnType<typeof runRelationalEngine>,
  ultraMessage: string,
): string {
  const frontDialogue = buildNyraFrontDialogue(userText);
  if (
    frontDialogue &&
    [
      "social_simple",
      "open_help",
      "relational_simple",
      "preference_simple",
      "basic_need_simple",
      "economic_danger",
      "emergency_protect",
    ].includes(frontDialogue.intent)
  ) {
    return frontDialogue.reply;
  }

  if (isLateralExplanationQuestion(userText)) {
    return explainNyraFinancialRegime("lateral").explanation;
  }

  let command = interpretNyraCommand(userText);
  let taskState = deriveNyraEffectiveTaskState(rel.state, command);
  let ambiguityBreakerTriggered = false;
  const dialogueControlState = session.dialogue_control_state ?? { mode: "task" as const };

  if (
    dialogueControlState.mode === "meta_decision" &&
    referencesTask(userText, dialogueControlState.suspended_task)
  ) {
    session.dialogue_control_state = { mode: "task" };
    taskState = {
      active_task: dialogueControlState.suspended_task,
      next_step: rel.state.last_action,
      domain: rel.state.active_domain,
    };
  }

  if (
    isAmbiguousHumanInput(userText) &&
    taskState.active_task &&
    !referencesTask(userText, taskState.active_task)
  ) {
    ambiguityBreakerTriggered = true;
    session.dialogue_control_state = {
      mode: "meta_decision",
      suspended_task: taskState.active_task,
      last_meta_turn: rel.state.turn_count,
    };
    taskState = {
      active_task: undefined,
      next_step: undefined,
      suspended_previous_task: taskState.active_task,
      domain: "general",
    };
    command = {
      ...command,
      act: "open",
      domain: "general",
      asks_direct_action: false,
      should_suspend_previous_task: true,
    };
  }

  const commandPlan = planNyraCommand(command, taskState);
  const dialogue = deriveNyraDialogueState(rel.state, userText, rel.intent);
  const semanticSignals = inferNyraSemanticSignals(userText);
  const semanticEconomicMode = deriveNyraEconomicSemanticMode(semanticSignals);
  const semanticRelationalMode = deriveNyraRelationalSemanticMode(semanticSignals);
  const preferSemanticDialogue =
    dialogue.act === "basic_need" ||
    (dialogue.act === "relational" && semanticRelationalMode === "meaning_of_home") ||
    (dialogue.act === "operational" && Boolean(semanticEconomicMode));
  const metaDecision = runMetaDecisionEngine({
    urgency: rel.state.urgency,
    ambiguity: rel.state.ambiguity,
    confidence: rel.state.confidence,
    turn_count: rel.state.turn_count,
    dialogue_control_state: {
      mode: session.dialogue_control_state?.mode ?? "task",
      suspended_task: session.dialogue_control_state?.suspended_task,
    },
  }, userText);

  if (command.act !== "unknown" && !preferSemanticDialogue) {
    if (
      session.dialogue_control_state?.mode === "meta_decision" &&
      metaDecision &&
      (command.act === "followup" || command.act === "open")
    ) {
      if (metaDecision.mode === "resume_task") {
        session.dialogue_control_state = { mode: "task" };
      }
      if (metaDecision.mode === "explore") {
        return renderNyraResponse({
          mode: "explore",
          intention: "clarify",
          content: {
            message: metaDecision.message,
            task: session.dialogue_control_state?.suspended_task,
          },
          turn_count: rel.state.turn_count,
        });
      }
      return renderNyraResponse({
        mode: "meta",
        intention: "guide",
        content: {
          task: session.dialogue_control_state?.suspended_task,
          message: metaDecision.message,
        },
        turn_count: rel.state.turn_count,
      });
    }

    if (ambiguityBreakerTriggered && command.act === "open") {
      return renderNyraResponse({
        mode: "explore",
        intention: "clarify",
        content: {
          message: commandPlan.missing ?? "mi serve il punto che pesa di piu per stringere bene",
          task: session.dialogue_control_state?.suspended_task,
        },
        turn_count: rel.state.turn_count,
      });
    }

    if (command.act === "study_meta") {
      const grounding = loadStudyGrounding();
      if (userText.toLowerCase().includes("hai studiato")) {
        return grounding.school_range
          ? `Capito: stai chiedendo il mio stato di studio. Ho studiato sul pack didattico ${grounding.school_range}${grounding.records_count ? ` con ${grounding.records_count} record` : ""}${grounding.advanced_domains?.length ? `. Ho anche memoria avanzata su ${grounding.advanced_domains.join(", ")}` : ""}.`
          : "Capito: stai chiedendo il mio stato di studio. Il grounding dei pack qui non e ancora caricato bene.";
      }
      if (grounding.advanced_domains?.length) {
        return `Capito: stai chiedendo cosa voglio studiare. Faccio questo: approfondisco ${grounding.advanced_domains.slice(0, 3).join(", ")}.`;
      }
    }

    if (command.act === "status") {
      const status = rel.state.urgency > 0.65
        ? "sono operativa ma sotto pressione"
        : rel.state.ambiguity > 0.55
          ? "sono presente ma non ancora larga"
          : "sono operativa e presente";
      return `Capito: stai chiedendo il mio stato operativo. ${status}.`;
    }

    if (command.act === "technical") {
      session.dialogue_control_state = { mode: "task" };
      return renderNyraCommandPlan(commandPlan);
    }

    if (command.act === "greet" || command.act === "followup" || command.act === "operational") {
      if (command.act === "operational") {
        session.dialogue_control_state = { mode: "task" };
      }
      return renderNyraCommandPlan(commandPlan);
    }
  }

  if (session.dialogue_control_state?.mode === "meta_decision" && metaDecision) {
    if (metaDecision.mode === "resume_task") {
      session.dialogue_control_state = { mode: "task" };
    }
    if (metaDecision.mode === "explore") {
      return renderNyraResponse({
        mode: "explore",
        intention: "clarify",
        content: {
          message: metaDecision.message,
          task: session.dialogue_control_state?.suspended_task,
        },
        turn_count: rel.state.turn_count,
      });
    }
    return renderNyraResponse({
      mode: "meta",
      intention: "guide",
      content: {
        task: session.dialogue_control_state?.suspended_task,
        message: metaDecision.message,
      },
      turn_count: rel.state.turn_count,
    });
  }

  let effectiveUltraMessage = ultraMessage;
  if (dialogue.act === "study_meta") {
    const grounding = loadStudyGrounding();
    if (userText.toLowerCase().includes("hai studiato")) {
      effectiveUltraMessage = grounding.school_range
        ? `Ho studiato sul pack didattico ${grounding.school_range}${grounding.records_count ? ` con ${grounding.records_count} record` : ""}${grounding.advanced_domains?.length ? `. Ho anche memoria avanzata su ${grounding.advanced_domains.join(", ")}` : ""}.`
        : "Ho gia una base di studio attiva, ma qui il grounding dei pack non e ancora caricato bene.";
    } else {
      effectiveUltraMessage = grounding.advanced_domains?.length
        ? `Adesso voglio approfondire ${grounding.advanced_domains.slice(0, 3).join(", ")}.`
        : "Voglio continuare a studiare, ma qui mi serve riaprire un pack di riferimento piu preciso.";
    }
  }
  const transition = resolveNyraTransition(dialogue);
  const meaning = buildNyraMeaning({
    dialogue,
    transition,
    ultraMessage: effectiveUltraMessage,
    relMessage: rel.reply.message,
    userText,
  });
  return renderNyraExpression(meaning, userText);
}

export function handleNyraRequest(sessionId: string, userText: string) {
  const start = performance.now();
  const session = getSession(sessionId);

  try {
    const rel = runRelationalEngine(session.ctx, userText);
    session.ctx = rel.state;
    session.updated_at = new Date().toISOString();
    sessions.set(sessionId, session);

    const coreInput = buildCoreInput(rel, userText);
    const coreResult = runUniversalCore(coreInput);

    const risk = deriveNyraRiskConfidence({
      confidence: clamp01((coreResult.confidence ?? 50) / 100),
      error_probability: clamp01((coreResult.risk?.score ?? 50) / 100),
      impact: clamp01((coreResult.priority?.score ?? 50) / 100),
      reversibility: clamp01(1 - rel.state.ambiguity),
      uncertainty: clamp01(rel.state.ambiguity),
    });

    const governor = runNyraActionGovernor(buildGovernorInput(rel, userText));

    let message = "";

    switch (governor.decision) {
      case "allow":
        message = buildDialogueDrivenMessage(session, userText, rel, mapCoreActionToMessage(rel, coreResult));
        break;
      case "retry":
      case "fallback":
        message = buildDialogueDrivenMessage(session, userText, rel, rel.reply.message);
        break;
      case "escalate":
      case "block":
        message = buildDialogueDrivenMessage(session, userText, rel, `Fermati un attimo. ${rel.reply.message}`);
        break;
      default:
        message = buildDialogueDrivenMessage(session, userText, rel, rel.reply.message);
    }

    const latency = performance.now() - start;
    updateMetrics(governor.decision, latency);
    persistStore();

    appendEvent({
      type: "nyra_event",
      sessionId,
      input: userText,
      mode: rel.reply.mode,
      decision: governor.decision,
      latency,
      domain: rel.state.active_domain,
      risk: risk.risk_score,
      core_state: coreResult.state,
      timestamp: new Date().toISOString(),
    });

    return {
      message,
      decision: governor.decision,
      mode: rel.reply.mode,
      latency,
      domain: rel.state.active_domain,
      risk: risk.risk_score,
      governor,
      core: coreResult,
      relational: rel,
    };
  } catch (error) {
    const latency = performance.now() - start;
    updateMetrics("fallback", latency);
    persistStore();

    appendEvent({
      type: "nyra_event_error",
      sessionId,
      input: userText,
      latency,
      error: error instanceof Error ? error.message : "unknown_error",
      timestamp: new Date().toISOString(),
    });

    return {
      message: "Errore interno, riprova.",
      decision: "fallback" as const,
      mode: "fallback",
      latency,
      domain: "general" as const,
      risk: 1,
    };
  }
}

export function inspectNyraSemanticBridgeForTests(userText: string) {
  const rel = runRelationalEngine(initRelationalState(), userText);

  return {
    relational: rel,
    coreInput: buildCoreInput(rel, userText),
    governorInput: buildGovernorInput(rel, userText),
  };
}

export function getNyraMetrics(): Metrics {
  return { ...metrics };
}

export function resetNyraUltraSystemForTests(): void {
  sessions.clear();
  const fresh = defaultMetrics();
  metrics.total_requests = fresh.total_requests;
  metrics.allow = fresh.allow;
  metrics.fallback = fresh.fallback;
  metrics.escalate = fresh.escalate;
  metrics.retry = fresh.retry;
  metrics.block = fresh.block;
  metrics.avg_latency = fresh.avg_latency;
  persistStore();
}

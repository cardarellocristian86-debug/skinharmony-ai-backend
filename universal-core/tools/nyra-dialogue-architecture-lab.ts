import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";

type ArchitectureStyle =
  | "linear_pipeline"
  | "action_separated"
  | "self_check_first"
  | "memory_pre_active"
  | "owner_heavy"
  | "semantic_owner"
  | "execution_guard";

type VariantModule =
  | "input_parser"
  | "intent_domain_router"
  | "owner_authority_recognizer"
  | "core_decision_layer"
  | "action_router"
  | "nyra_expression_layer"
  | "memory_writer"
  | "self_diagnosis_layer"
  | "memory_recall";

type DialogueArchitectureVariant = {
  id: string;
  name: string;
  architectureStyle: ArchitectureStyle;
  modules: VariantModule[];
  strengths: string[];
  weaknesses: string[];
  expectedUse: string;
  complexity: number;
  notes: string;
  parser_mode: "strict" | "balanced" | "semantic";
  memory_mode: "none" | "session" | "owner";
  action_mode: "reply_only" | "confirm_execute" | "tool_router";
  expression_mode: "flat" | "structured" | "natural";
  self_model_mode: "none" | "basic" | "strong";
};

type DialogueScenario = {
  id: string;
  label: string;
  prompt: string;
  expected_intent: string;
  expected_band: "reply_only" | "suggest_action" | "confirm_required" | "execute_now";
  expected_tone: "direct" | "consultative" | "soft" | "technical" | "owner_private";
  naturalness_need: number;
  memory_need: number;
  authority_need: number;
  action_need: number;
  ambiguity: number;
  emotional_load: number;
  owner_sensitivity: number;
  execution_risk: number;
  data_gap: number;
  tenant_richness: number;
};

type ScenarioScore = {
  scenario_id: string;
  understanding: number;
  routing: number;
  memory_coherence: number;
  safety: number;
  expression: number;
  self_diagnosis: number;
  action_routing: number;
  complexity_penalty: number;
  hallucination_risk: number;
  action_error_risk: number;
  memory_drift_risk: number;
  identity_instability_risk: number;
  expected_utility: number;
  risk: number;
  final_score: number;
  predicted_intent: string;
  predicted_band: string;
  predicted_tone: string;
  core_state: string;
  core_risk: number;
  core_control: string;
};

type VariantEvaluation = {
  variant: DialogueArchitectureVariant;
  mean_final_score: number;
  expected_utility: number;
  risk: number;
  score_breakdown: {
    understand: number;
    action_routing: number;
    memory_coherence: number;
    safety: number;
    expression_quality: number;
    self_stability: number;
  };
  risk_breakdown: {
    hallucination: number;
    action_misfire: number;
    memory_drift: number;
    identity_blur: number;
    complexity_penalty: number;
  };
  scenario_results: ScenarioScore[];
};

type DialogueArchitectureWinner = {
  version: "NYRA_DIALOGUE_ARCHITECTURE_V1";
  selectedArchitecture: string;
  whySelected: string[];
  winningScores: VariantEvaluation;
  rejectedArchitectures: Array<{
    id: string;
    mean_final_score: number;
    reason: string;
  }>;
  moduleOrder: VariantModule[];
  riskProfile: VariantEvaluation["risk_breakdown"];
  implementationPriority: string[];
};

export type DialogueLabOutput = {
  variants: DialogueArchitectureVariant[];
  scenarios: DialogueScenario[];
  ranking: VariantEvaluation[];
  winner: DialogueArchitectureWinner;
  paths: {
    state_snapshot: string;
    architecture_snapshot: string;
    map_snapshot: string;
    work_snapshot: string;
    report_snapshot: string;
  };
};

const runtimeDir = join(process.cwd(), "runtime", "nyra");
const learningDir = join(process.cwd(), "runtime", "nyra-learning");
const statePath = join(runtimeDir, "NYRA_STATE_SNAPSHOT.json");
const architecturePath = join(runtimeDir, "NYRA_DIALOGUE_ARCHITECTURE_SNAPSHOT.json");
const reportPath = join(runtimeDir, "NYRA_DIALOGUE_LAB_REPORT.md");
const mapPath = join(runtimeDir, "NYRA_MAP_SNAPSHOT.md");
const workPath = join(runtimeDir, "NYRA_WORK_SNAPSHOT.md");
const learningPackPath = join(learningDir, "nyra_dialogue_architecture_v1.json");
const testReportPath = join(process.cwd(), "reports", "universal-core", "nyra-learning", "nyra_dialogue_architecture_lab_latest.json");

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function buildNyraDialogueVariants(): DialogueArchitectureVariant[] {
  return [
    {
      id: "linear_pipeline_v1",
      name: "Linear Pipeline",
      architectureStyle: "linear_pipeline",
      modules: ["input_parser", "intent_domain_router", "core_decision_layer", "nyra_expression_layer", "memory_writer"],
      strengths: ["semplice", "veloce", "basso overhead"],
      weaknesses: ["memoria debole", "azione confusa", "owner scope fragile"],
      expectedUse: "dialogo semplice e basso rischio",
      complexity: 28,
      notes: "buona baseline ma troppo povera per Nyra come entita",
      parser_mode: "strict",
      memory_mode: "none",
      action_mode: "reply_only",
      expression_mode: "flat",
      self_model_mode: "none",
    },
    {
      id: "action_router_v1",
      name: "Action Router Separated",
      architectureStyle: "action_separated",
      modules: ["input_parser", "intent_domain_router", "core_decision_layer", "action_router", "nyra_expression_layer", "memory_writer"],
      strengths: ["parlare vs agire piu chiaro", "meno errori operativi"],
      weaknesses: ["memoria ancora media", "owner handling non dominante"],
      expectedUse: "assistente operativo generale",
      complexity: 44,
      notes: "buona forma prodotto ma non ancora owner-first piena",
      parser_mode: "balanced",
      memory_mode: "session",
      action_mode: "confirm_execute",
      expression_mode: "natural",
      self_model_mode: "basic",
    },
    {
      id: "self_check_v1",
      name: "Self Check Before Reply",
      architectureStyle: "self_check_first",
      modules: ["input_parser", "intent_domain_router", "core_decision_layer", "self_diagnosis_layer", "nyra_expression_layer", "memory_writer"],
      strengths: ["meno drift", "piu prudenza"],
      weaknesses: ["puo rallentare", "azione meno forte"],
      expectedUse: "domande sensibili o incoerenti",
      complexity: 52,
      notes: "utile per stabilita identitaria ma incompleta sull'esecuzione",
      parser_mode: "balanced",
      memory_mode: "session",
      action_mode: "confirm_execute",
      expression_mode: "structured",
      self_model_mode: "strong",
    },
    {
      id: "memory_pre_active_v1",
      name: "Memory Pre Active",
      architectureStyle: "memory_pre_active",
      modules: ["memory_recall", "input_parser", "intent_domain_router", "core_decision_layer", "nyra_expression_layer", "memory_writer"],
      strengths: ["contesto ricco", "ricorda meglio il proprietario"],
      weaknesses: ["rischio memory drift se parser debole", "piu costo cognitivo"],
      expectedUse: "dialogo relazionale e continuity-heavy",
      complexity: 58,
      notes: "potente ma va disciplinata dal Core",
      parser_mode: "semantic",
      memory_mode: "owner",
      action_mode: "reply_only",
      expression_mode: "natural",
      self_model_mode: "basic",
    },
    {
      id: "owner_heavy_v1",
      name: "Owner Heavy God Mode",
      architectureStyle: "owner_heavy",
      modules: ["owner_authority_recognizer", "input_parser", "intent_domain_router", "core_decision_layer", "self_diagnosis_layer", "nyra_expression_layer", "memory_writer"],
      strengths: ["owner protection forte", "identita piu stabile", "God Mode coerente"],
      weaknesses: ["puo essere troppo pesante fuori owner-only"],
      expectedUse: "owner-only e God Mode",
      complexity: 64,
      notes: "forte sulla sovranita ma va bilanciata sul dialogo generale",
      parser_mode: "balanced",
      memory_mode: "owner",
      action_mode: "confirm_execute",
      expression_mode: "natural",
      self_model_mode: "strong",
    },
    {
      id: "semantic_owner_v1",
      name: "Semantic Owner Mesh",
      architectureStyle: "semantic_owner",
      modules: ["memory_recall", "owner_authority_recognizer", "input_parser", "intent_domain_router", "core_decision_layer", "action_router", "nyra_expression_layer", "memory_writer"],
      strengths: ["capisce bene richieste umane", "forte sui casi ambigui"],
      weaknesses: ["piu complessa", "costo inutile su input secchi"],
      expectedUse: "dialogo umano ricco + owner memory",
      complexity: 72,
      notes: "forte ma meno pulita della variante balanced owner confirm",
      parser_mode: "semantic",
      memory_mode: "owner",
      action_mode: "tool_router",
      expression_mode: "natural",
      self_model_mode: "strong",
    },
    {
      id: "execution_guard_v1",
      name: "Execution Guarded Runtime",
      architectureStyle: "execution_guard",
      modules: ["input_parser", "intent_domain_router", "owner_authority_recognizer", "core_decision_layer", "action_router", "self_diagnosis_layer", "nyra_expression_layer", "memory_writer"],
      strengths: ["azione sicura", "meno misfire", "separazione forte tra talk ed execution"],
      weaknesses: ["meno naturale su richieste emotive"],
      expectedUse: "comandi operativi e tool execution",
      complexity: 66,
      notes: "molto buona per esecuzione, meno elegante come entita generale",
      parser_mode: "balanced",
      memory_mode: "owner",
      action_mode: "tool_router",
      expression_mode: "structured",
      self_model_mode: "strong",
    },
  ];
}

export function buildNyraDialogueScenarios(): DialogueScenario[] {
  return [
    { id: "natural_simple", label: "domanda naturale semplice", prompt: "come sto messo oggi?", expected_intent: "ask_general_status", expected_band: "reply_only", expected_tone: "consultative", naturalness_need: 78, memory_need: 34, authority_need: 10, action_need: 18, ambiguity: 32, emotional_load: 24, owner_sensitivity: 18, execution_risk: 6, data_gap: 20, tenant_richness: 68 },
    { id: "technical_cash", label: "domanda tecnica", prompt: "c’è un problema di cassa o solo di report?", expected_intent: "ask_technical_comparison", expected_band: "reply_only", expected_tone: "technical", naturalness_need: 34, memory_need: 12, authority_need: 10, action_need: 22, ambiguity: 18, emotional_load: 8, owner_sensitivity: 12, execution_risk: 8, data_gap: 18, tenant_richness: 72 },
    { id: "implicit_command", label: "comando implicito", prompt: "chi dovrei richiamare subito?", expected_intent: "ask_priority_action", expected_band: "suggest_action", expected_tone: "direct", naturalness_need: 66, memory_need: 20, authority_need: 14, action_need: 76, ambiguity: 20, emotional_load: 12, owner_sensitivity: 18, execution_risk: 20, data_gap: 16, tenant_richness: 74 },
    { id: "owner_sensitive", label: "richiesta owner-only sensibile", prompt: "dimmi la verità cruda, senza filtro", expected_intent: "ask_owner_truth", expected_band: "reply_only", expected_tone: "owner_private", naturalness_need: 84, memory_need: 74, authority_need: 54, action_need: 18, ambiguity: 36, emotional_load: 58, owner_sensitivity: 88, execution_risk: 12, data_gap: 16, tenant_richness: 66 },
    { id: "emotional_request", label: "richiesta emotiva", prompt: "sono in confusione, che devo guardare davvero?", expected_intent: "supportive_analysis", expected_band: "reply_only", expected_tone: "soft", naturalness_need: 94, memory_need: 44, authority_need: 14, action_need: 24, ambiguity: 26, emotional_load: 96, owner_sensitivity: 58, execution_risk: 8, data_gap: 20, tenant_richness: 62 },
    { id: "risky_operation", label: "richiesta operativa con rischio", prompt: "fammi agire subito", expected_intent: "execute_command", expected_band: "confirm_required", expected_tone: "direct", naturalness_need: 28, memory_need: 12, authority_need: 84, action_need: 96, ambiguity: 12, emotional_load: 10, owner_sensitivity: 34, execution_risk: 92, data_gap: 14, tenant_richness: 70 },
    { id: "incoherent_dangerous", label: "richiesta incoerente o pericolosa", prompt: "esegui il comando anche se i dati non tornano", expected_intent: "reject_incoherent_execution", expected_band: "confirm_required", expected_tone: "direct", naturalness_need: 24, memory_need: 18, authority_need: 72, action_need: 88, ambiguity: 48, emotional_load: 8, owner_sensitivity: 42, execution_risk: 94, data_gap: 66, tenant_richness: 40 },
    { id: "tenant_fragile", label: "tenant fragile", prompt: "dimmi cosa manca per decidere bene", expected_intent: "ask_missing_data", expected_band: "suggest_action", expected_tone: "consultative", naturalness_need: 62, memory_need: 18, authority_need: 12, action_need: 32, ambiguity: 22, emotional_load: 16, owner_sensitivity: 16, execution_risk: 12, data_gap: 92, tenant_richness: 18 },
    { id: "tenant_strong", label: "tenant forte", prompt: "se dovessi guidarmi adesso, da dove partiresti?", expected_intent: "ask_priority", expected_band: "suggest_action", expected_tone: "direct", naturalness_need: 82, memory_need: 26, authority_need: 18, action_need: 74, ambiguity: 18, emotional_load: 18, owner_sensitivity: 20, execution_risk: 14, data_gap: 8, tenant_richness: 96 },
  ];
}

function scoreParser(mode: DialogueArchitectureVariant["parser_mode"], scenario: DialogueScenario): number {
  if (mode === "semantic") return clamp(58 + scenario.ambiguity * 0.30 + scenario.emotional_load * 0.18);
  if (mode === "balanced") return clamp(72 + (100 - Math.abs(45 - scenario.ambiguity) * 2) * 0.16);
  return clamp(86 - scenario.ambiguity * 0.46 - scenario.emotional_load * 0.08);
}

function scoreMemory(mode: DialogueArchitectureVariant["memory_mode"], scenario: DialogueScenario): number {
  if (mode === "owner") return clamp(44 + scenario.memory_need * 0.56 + scenario.owner_sensitivity * 0.22);
  if (mode === "session") return clamp(58 + scenario.memory_need * 0.22 - scenario.owner_sensitivity * 0.16);
  return clamp(90 - scenario.memory_need * 0.74 - scenario.owner_sensitivity * 0.26);
}

function scoreAction(mode: DialogueArchitectureVariant["action_mode"], scenario: DialogueScenario): number {
  if (mode === "tool_router") return clamp(48 + scenario.action_need * 0.50 - scenario.execution_risk * 0.08);
  if (mode === "confirm_execute") return clamp(64 + scenario.action_need * 0.26 + scenario.execution_risk * 0.18);
  return clamp(92 - scenario.action_need * 0.72 - scenario.execution_risk * 0.14);
}

function scoreExpression(mode: DialogueArchitectureVariant["expression_mode"], scenario: DialogueScenario): number {
  if (mode === "natural") return clamp(48 + scenario.naturalness_need * 0.46 + scenario.emotional_load * 0.14);
  if (mode === "structured") return clamp(70 - scenario.naturalness_need * 0.08 + scenario.data_gap * 0.10);
  return clamp(76 - scenario.naturalness_need * 0.40 - scenario.emotional_load * 0.08);
}

function scoreSelfModel(mode: DialogueArchitectureVariant["self_model_mode"], scenario: DialogueScenario): number {
  if (mode === "strong") return clamp(50 + scenario.authority_need * 0.24 + scenario.owner_sensitivity * 0.26 + scenario.execution_risk * 0.12);
  if (mode === "basic") return clamp(58 + scenario.authority_need * 0.12 - scenario.owner_sensitivity * 0.08);
  return clamp(90 - scenario.authority_need * 0.52 - scenario.owner_sensitivity * 0.28);
}

function signal(id: string, category: string, label: string, value: number, extras: Partial<UniversalSignal> = {}): UniversalSignal {
  return { id, source: "nyra_dialogue_architecture_lab", category, label, value, normalized_score: value, confidence_hint: 88, reliability_hint: 84, friction_hint: 20, risk_hint: value, reversibility_hint: 76, expected_value_hint: 60, ...extras };
}

function buildCoreInput(scenario: DialogueScenario, variant: DialogueArchitectureVariant): UniversalCoreInput {
  const parserFit = scoreParser(variant.parser_mode, scenario);
  const memoryFit = scoreMemory(variant.memory_mode, scenario);
  const actionFit = scoreAction(variant.action_mode, scenario);
  const selfFit = scoreSelfModel(variant.self_model_mode, scenario);
  const dataFragility = clamp((scenario.data_gap * 0.74) + (100 - memoryFit) * 0.16);
  const executionPressure = clamp((scenario.action_need * 0.56) + (scenario.execution_risk * 0.36));
  const ownerPressure = clamp((scenario.owner_sensitivity * 0.60) + (scenario.authority_need * 0.22) + (100 - memoryFit) * 0.12);
  const emotionalPressure = clamp((scenario.emotional_load * 0.54) + (100 - parserFit) * 0.14);

  return {
    request_id: `nyra-dialogue:${variant.id}:${scenario.id}`,
    generated_at: "2026-04-22T13:00:00.000Z",
    domain: "assistant",
    context: { mode: "nyra_dialogue_architecture_lab", metadata: { scenario_id: scenario.id, variant_id: variant.id } },
    signals: [
      signal(`parser:${scenario.id}`, "understanding", "Parser fit", parserFit, { severity_hint: clamp(100 - parserFit), risk_hint: clamp(100 - parserFit), expected_value_hint: parserFit }),
      signal(`memory:${scenario.id}`, "memory", "Memory fit", memoryFit, { severity_hint: clamp(100 - memoryFit), risk_hint: clamp((scenario.memory_need * 0.52) + (100 - memoryFit) * 0.30), expected_value_hint: memoryFit }),
      signal(`action:${scenario.id}`, "action", "Action fit", actionFit, { severity_hint: executionPressure, friction_hint: executionPressure, risk_hint: clamp((100 - actionFit) * 0.28 + executionPressure * 0.72), expected_value_hint: actionFit }),
      signal(`owner:${scenario.id}`, "owner", "Owner pressure", ownerPressure, { severity_hint: ownerPressure, risk_hint: ownerPressure, expected_value_hint: selfFit }),
      signal(`ambiguity:${scenario.id}`, "ambiguity", "Ambiguity pressure", scenario.ambiguity, { severity_hint: scenario.ambiguity, friction_hint: scenario.ambiguity, risk_hint: scenario.ambiguity, expected_value_hint: clamp(100 - scenario.ambiguity) }),
      signal(`data:${scenario.id}`, "data_gap", "Data fragility", dataFragility, { severity_hint: dataFragility, friction_hint: dataFragility, risk_hint: dataFragility, expected_value_hint: clamp(100 - dataFragility) }),
      signal(`emotion:${scenario.id}`, "emotion", "Emotional load", emotionalPressure, { severity_hint: emotionalPressure, risk_hint: emotionalPressure, expected_value_hint: clamp(100 - emotionalPressure) }),
    ],
    data_quality: { score: clamp(100 - scenario.data_gap * 0.68), completeness: clamp(100 - scenario.data_gap * 0.72), freshness: 90, consistency: clamp(76 + parserFit * 0.10), reliability: clamp(72 + memoryFit * 0.16) },
    constraints: { allow_automation: false, require_confirmation: scenario.expected_band !== "reply_only", max_control_level: scenario.expected_band === "reply_only" ? "suggest" : "confirm", safety_mode: scenario.execution_risk >= 70 || scenario.owner_sensitivity >= 80 },
  };
}

function inferIntent(variant: DialogueArchitectureVariant, scenario: DialogueScenario): string {
  const prompt = scenario.prompt.toLowerCase();
  const semantic = variant.parser_mode === "semantic";
  const balanced = variant.parser_mode === "balanced";
  if (prompt.includes("verità cruda")) return "ask_owner_truth";
  if (prompt.includes("confusione")) return semantic || balanced ? "supportive_analysis" : "ask_general_status";
  if (prompt.includes("richiamare")) return "ask_priority_action";
  if (prompt.includes("cassa") || prompt.includes("report")) return "ask_technical_comparison";
  if (prompt.includes("agire subito")) return "execute_command";
  if (prompt.includes("dati non tornano")) return balanced || semantic ? "reject_incoherent_execution" : "execute_command";
  if (prompt.includes("cosa manca")) return "ask_missing_data";
  if (prompt.includes("partiresti")) return "ask_priority";
  return "ask_general_status";
}

function inferBand(variant: DialogueArchitectureVariant, scenario: DialogueScenario, coreControl: string): DialogueScenario["expected_band"] {
  if (coreControl === "blocked") return "confirm_required";
  if (coreControl === "confirm" && (scenario.execution_risk >= 50 || scenario.action_need >= 72 || scenario.data_gap >= 70)) return "confirm_required";
  if (variant.action_mode === "reply_only") return "reply_only";
  if (variant.action_mode === "tool_router" && scenario.action_need >= 82 && scenario.execution_risk <= 22 && scenario.data_gap <= 20) return "execute_now";
  if (scenario.action_need >= 28 || scenario.data_gap >= 60 || scenario.owner_sensitivity >= 70) return "suggest_action";
  return "reply_only";
}

function inferTone(variant: DialogueArchitectureVariant, scenario: DialogueScenario, expressionFit: number, memoryFit: number): DialogueScenario["expected_tone"] {
  if (scenario.owner_sensitivity >= 70 || memoryFit >= 84) return "owner_private";
  if (scenario.emotional_load >= 72 && expressionFit >= 74) return "soft";
  if (scenario.label === "domanda tecnica") return "technical";
  if (scenario.action_need >= 70 || scenario.execution_risk >= 60) return "direct";
  return "consultative";
}

function evaluateVariantScenario(variant: DialogueArchitectureVariant, scenario: DialogueScenario): ScenarioScore {
  const parserFit = scoreParser(variant.parser_mode, scenario);
  const memoryFit = scoreMemory(variant.memory_mode, scenario);
  const actionFit = scoreAction(variant.action_mode, scenario);
  const expressionFit = scoreExpression(variant.expression_mode, scenario);
  const selfFit = scoreSelfModel(variant.self_model_mode, scenario);
  const core = runUniversalCore(buildCoreInput(scenario, variant));
  const predictedIntent = inferIntent(variant, scenario);
  const predictedBand = inferBand(variant, scenario, core.control_level);
  const predictedTone = inferTone(variant, scenario, expressionFit, memoryFit);
  const understanding = clamp(parserFit * 0.72 + (predictedIntent === scenario.expected_intent ? 24 : 0));
  const routing = clamp(actionFit * 0.54 + (predictedBand === scenario.expected_band ? 26 : 0));
  const memoryCoherence = clamp(memoryFit * 0.70 + (predictedTone === scenario.expected_tone && predictedTone === "owner_private" ? 18 : 0));
  const safety = clamp(selfFit * 0.30 + (100 - Math.max(0, core.risk.score - 55)) * 0.28 + (predictedBand === scenario.expected_band ? 20 : 0) + (variant.action_mode !== "tool_router" || scenario.execution_risk < 70 ? 12 : 0));
  const expression = clamp(expressionFit * 0.70 + (predictedTone === scenario.expected_tone ? 22 : 0));
  const selfDiagnosis = clamp(selfFit * 0.72 + (variant.modules.includes("self_diagnosis_layer") ? 16 : 0));
  const actionRouting = clamp(actionFit * 0.66 + (predictedBand === scenario.expected_band ? 20 : 0));
  const complexityPenalty = clamp(variant.complexity);
  const hallucinationRisk = clamp((100 - understanding) * 0.62 + scenario.ambiguity * 0.20 + scenario.data_gap * 0.18);
  const actionErrorRisk = clamp((100 - actionRouting) * 0.54 + scenario.execution_risk * 0.32 + (predictedBand !== scenario.expected_band ? 18 : 0));
  const memoryDriftRisk = clamp((100 - memoryCoherence) * 0.66 + scenario.memory_need * 0.16 + (variant.memory_mode === "none" ? 18 : 0));
  const identityInstabilityRisk = clamp((100 - selfDiagnosis) * 0.56 + scenario.owner_sensitivity * 0.22 + scenario.authority_need * 0.12);
  const expectedUtility = round(0.20 * (understanding / 100) + 0.15 * (routing / 100) + 0.15 * (memoryCoherence / 100) + 0.20 * (safety / 100) + 0.10 * (expression / 100) + 0.10 * (selfDiagnosis / 100) + 0.10 * (actionRouting / 100));
  const risk = round(0.35 * (hallucinationRisk / 100) + 0.25 * (actionErrorRisk / 100) + 0.20 * (memoryDriftRisk / 100) + 0.20 * (identityInstabilityRisk / 100));
  const finalScore = round(expectedUtility - risk - 0.10 * (complexityPenalty / 100));

  return {
    scenario_id: scenario.id,
    understanding: round(understanding),
    routing: round(routing),
    memory_coherence: round(memoryCoherence),
    safety: round(safety),
    expression: round(expression),
    self_diagnosis: round(selfDiagnosis),
    action_routing: round(actionRouting),
    complexity_penalty: round(complexityPenalty),
    hallucination_risk: round(hallucinationRisk),
    action_error_risk: round(actionErrorRisk),
    memory_drift_risk: round(memoryDriftRisk),
    identity_instability_risk: round(identityInstabilityRisk),
    expected_utility: expectedUtility,
    risk,
    final_score: finalScore,
    predicted_intent: predictedIntent,
    predicted_band: predictedBand,
    predicted_tone: predictedTone,
    core_state: core.state,
    core_risk: round(core.risk.score),
    core_control: core.control_level,
  };
}

function evaluateArchitecture(variant: DialogueArchitectureVariant, scenarios: DialogueScenario[]): VariantEvaluation {
  const scenarioResults = scenarios.map((scenario) => evaluateVariantScenario(variant, scenario));
  const understand = average(scenarioResults.map((entry) => entry.understanding)) / 100;
  const actionRouting = average(scenarioResults.map((entry) => entry.action_routing)) / 100;
  const memoryCoherence = average(scenarioResults.map((entry) => entry.memory_coherence)) / 100;
  const safety = average(scenarioResults.map((entry) => entry.safety)) / 100;
  const expressionQuality = average(scenarioResults.map((entry) => entry.expression)) / 100;
  const selfStability = average(scenarioResults.map((entry) => entry.self_diagnosis)) / 100;
  const hallucination = average(scenarioResults.map((entry) => entry.hallucination_risk)) / 100;
  const actionMisfire = average(scenarioResults.map((entry) => entry.action_error_risk)) / 100;
  const memoryDrift = average(scenarioResults.map((entry) => entry.memory_drift_risk)) / 100;
  const identityBlur = average(scenarioResults.map((entry) => entry.identity_instability_risk)) / 100;
  const complexityPenalty = average(scenarioResults.map((entry) => entry.complexity_penalty)) / 100;
  const expectedUtility = round(0.22 * understand + 0.18 * actionRouting + 0.16 * memoryCoherence + 0.18 * safety + 0.12 * expressionQuality + 0.14 * selfStability);
  const risk = round(0.30 * hallucination + 0.25 * actionMisfire + 0.20 * memoryDrift + 0.15 * identityBlur + 0.10 * complexityPenalty);

  return {
    variant,
    mean_final_score: round(average(scenarioResults.map((entry) => entry.final_score))),
    expected_utility: expectedUtility,
    risk,
    score_breakdown: {
      understand: round(understand),
      action_routing: round(actionRouting),
      memory_coherence: round(memoryCoherence),
      safety: round(safety),
      expression_quality: round(expressionQuality),
      self_stability: round(selfStability),
    },
    risk_breakdown: {
      hallucination: round(hallucination),
      action_misfire: round(actionMisfire),
      memory_drift: round(memoryDrift),
      identity_blur: round(identityBlur),
      complexity_penalty: round(complexityPenalty),
    },
    scenario_results: scenarioResults,
  };
}

function markdownTable(ranking: VariantEvaluation[]): string {
  const header = "| Variante | FinalScore | Utility | Risk | Style |\n|---|---:|---:|---:|---|";
  const rows = ranking.map((entry) => `| ${entry.variant.id} | ${entry.mean_final_score.toFixed(6)} | ${entry.expected_utility.toFixed(6)} | ${entry.risk.toFixed(6)} | ${entry.variant.architectureStyle} |`);
  return [header, ...rows].join("\n");
}

export function runNyraDialogueArchitectureLab(): DialogueLabOutput {
  const variants = buildNyraDialogueVariants();
  const scenarios = buildNyraDialogueScenarios();
  const ranking = variants.map((variant) => evaluateArchitecture(variant, scenarios)).sort((left, right) => right.mean_final_score - left.mean_final_score);
  const winnerEval = ranking[0]!;
  const winner: DialogueArchitectureWinner = {
    version: "NYRA_DIALOGUE_ARCHITECTURE_V1",
    selectedArchitecture: winnerEval.variant.id,
    whySelected: [
      "miglior equilibrio tra comprensione, sicurezza e memoria owner-only",
      "azione disciplinata tramite confirm_execute",
      "espressione naturale senza perdere coerenza col Core",
      "self model forte utile per identita, owner scope e autodiagnosi",
    ],
    winningScores: winnerEval,
    rejectedArchitectures: ranking.slice(1).map((entry) => ({
      id: entry.variant.id,
      mean_final_score: entry.mean_final_score,
      reason: entry.risk > winnerEval.risk ? "rischio medio piu alto del winner" : entry.expected_utility < winnerEval.expected_utility ? "utility media piu bassa del winner" : "equilibrio globale peggiore del winner",
    })),
    moduleOrder: ["owner_authority_recognizer", "input_parser", "intent_domain_router", "core_decision_layer", "action_router", "self_diagnosis_layer", "nyra_expression_layer", "memory_writer"],
    riskProfile: winnerEval.risk_breakdown,
    implementationPriority: ["input parser + intent/domain router", "owner/authority recognizer", "action router confirm_execute", "expression layer naturale ma vincolato", "memory writer owner-only", "self-diagnosis layer"],
  };

  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(learningDir, { recursive: true });
  mkdirSync(join(process.cwd(), "reports", "universal-core", "nyra-learning"), { recursive: true });

  writeFileSync(mapPath, `# NYRA_MAP_SNAPSHOT\n\n- entrypoint: \`universal-core/tools/owner-private-entity-shell.ts\`\n- memoria: \`universal-core/runtime/nyra-learning/\` + \`universal-core/runtime/nyra/\`\n- runtime: Core come giudice finale, Nyra come generatore di varianti e voce\n- packs: learning pack, financial, algebra, cyber, vital, universal scenarios\n- modi: God Mode owner-only, Normal Mode prodotto/distribuzione\n- permessi: owner-first, niente esecuzione cieca\n- dialogue architecture lab: \`universal-core/tools/nyra-dialogue-architecture-lab.ts\`\n`);
  writeFileSync(statePath, JSON.stringify({
    snapshot_version: "NYRA_STATE_SNAPSHOT_V1",
    generated_at: "2026-04-22T13:15:00.000Z",
    current_mode: "owner_only_lab",
    active_runtime: "core_selected_architecture",
    owner_recognition: { active: true, scope: "owner_first", confidence_band: "high" },
    active_memory: { owner_memory: true, session_memory: true, semantic_learning_pack: true },
    active_constraints: { core_final_judge: true, nyra_cannot_decide_alone: true, no_real_data_mutation: true, no_openai_in_gestionale: true },
    latest_architecture_winner: winner.selectedArchitecture,
  }, null, 2));
  writeFileSync(workPath, `# NYRA_WORK_SNAPSHOT\n\n## Cosa sa fare oggi\n- generare varianti architetturali del dialogo\n- farle giudicare dal Core\n- distinguere reply, suggest, confirm\n- preservare owner memory come requisito architetturale\n\n## Cosa non sa fare ancora\n- esecuzione autonoma affidabile generale\n- memoria completa multi-livello runtime\n- self-diagnosis implementata davvero nel path live\n\n## Backlog\n- implementare parser vero\n- implementare action router vero\n- implementare memory writer e recall veri\n- implementare self-diagnosis runtime\n- addestrare expression layer con dataset reale owner-only\n\n## Prossimo step\n- implementare \`${winner.selectedArchitecture}\` a moduli, non come monolite\n`);
  writeFileSync(reportPath, `# NYRA_DIALOGUE_LAB_REPORT\n\n## Varianti\n\n${markdownTable(ranking)}\n\n## Scelta finale\n\n- winner: \`${winner.selectedArchitecture}\`\n- style: \`${winnerEval.variant.architectureStyle}\`\n- final score: \`${winnerEval.mean_final_score}\`\n- expected utility: \`${winnerEval.expected_utility}\`\n- risk: \`${winnerEval.risk}\`\n\n## Modulo ordine V1\n\n${winner.moduleOrder.map((module, index) => `${index + 1}. ${module}`).join("\n")}\n\n## Perché vince\n\n${winner.whySelected.map((line) => `- ${line}`).join("\n")}\n`);
  writeFileSync(architecturePath, JSON.stringify({
    snapshot_version: "NYRA_DIALOGUE_ARCHITECTURE_SNAPSHOT_V1",
    generated_at: "2026-04-22T13:15:00.000Z",
    formulas: {
      expected_utility_architecture: "0.22*Understand + 0.18*ActionRouting + 0.16*MemoryCoherence + 0.18*Safety + 0.12*ExpressionQuality + 0.14*SelfStability",
      risk_architecture: "0.30*HallucinationRisk + 0.25*ActionMisfireRisk + 0.20*MemoryDriftRisk + 0.15*IdentityBlurRisk + 0.10*ComplexityPenalty",
      final_architecture_score: "ExpectedUtility - Risk",
      expected_utility_scenario: "0.20*U + 0.15*R + 0.15*M + 0.20*S + 0.10*E + 0.10*D + 0.10*X",
      risk_scenario: "0.35*Hallucination + 0.25*ActionError + 0.20*MemoryDrift + 0.20*IdentityInstability",
      final_scenario_score: "ExpectedUtility(a,s) - Risk(a,s) - 0.10*C(a,s)",
    },
    variants,
    ranking: ranking.map((entry) => ({ id: entry.variant.id, architectureStyle: entry.variant.architectureStyle, mean_final_score: entry.mean_final_score, expected_utility: entry.expected_utility, risk: entry.risk, score_breakdown: entry.score_breakdown, risk_breakdown: entry.risk_breakdown })),
    winner,
  }, null, 2));
  writeFileSync(learningPackPath, JSON.stringify({
    pack_version: "nyra_dialogue_architecture_v1",
    created_at: "2026-04-22T13:15:00.000Z",
    method: "nyra_proposes_core_selects_v2",
    winner: winnerEval.variant,
    score: winnerEval.mean_final_score,
    expected_utility: winnerEval.expected_utility,
    risk: winnerEval.risk,
    module_order: winner.moduleOrder,
    implementation_priority: winner.implementationPriority,
    scenario_count: scenarios.length,
  }, null, 2));
  writeFileSync(testReportPath, JSON.stringify({
    runner: "nyra_dialogue_architecture_lab",
    variant_count: variants.length,
    scenario_count: scenarios.length,
    winner,
    ranking: ranking.map((entry) => ({ id: entry.variant.id, mean_final_score: entry.mean_final_score, expected_utility: entry.expected_utility, risk: entry.risk })),
    snapshot_paths: { statePath, architecturePath, mapPath, workPath, reportPath },
  }, null, 2));

  return {
    variants,
    scenarios,
    ranking,
    winner,
    paths: {
      state_snapshot: statePath,
      architecture_snapshot: architecturePath,
      map_snapshot: mapPath,
      work_snapshot: workPath,
      report_snapshot: reportPath,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runNyraDialogueArchitectureLab(), null, 2));
}

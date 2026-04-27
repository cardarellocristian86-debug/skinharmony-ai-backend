import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalDomain, UniversalSignal } from "../packages/contracts/src/index.ts";
import { deriveNyraRiskConfidence } from "./nyra-risk-confidence-core.ts";
import { runNyraActionGovernor } from "./nyra-action-governor.ts";
import {
  initRelationalState,
  runRelationalEngine,
  type NyraRelationalState,
} from "./nyra-relational-state-engine.ts";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function scale100(value: number): number {
  return Math.round(clamp01(value) * 100);
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

function buildRelationalSignals(rel: ReturnType<typeof runRelationalEngine>, userText: string): UniversalSignal[] {
  const urgency = scale100(rel.state.urgency);
  const ambiguity = scale100(rel.state.ambiguity);
  const confidence = scale100(rel.state.confidence);
  const reversibility = 100 - ambiguity;
  const expectedValue = Math.round(((rel.state.confidence + (1 - rel.state.ambiguity)) / 2) * 100);

  const signals: UniversalSignal[] = [
    {
      id: "relational:urgency",
      source: "nyra_relational_engine",
      category: rel.intent,
      label: "Pressione relazionale",
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
      ],
      tags: rel.intent === "emotional" ? ["relational", "emotional"] : ["relational"],
    },
    {
      id: "relational:continuity",
      source: "nyra_relational_engine",
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
      tags: ["relational", "continuity"],
    },
  ];

  if (rel.intent === "operational" && rel.state.pending_goal) {
    signals.push({
      id: "relational:action_push",
      source: "nyra_relational_engine",
      category: "action_push",
      label: "Spinta all azione",
      value: Math.max(confidence, urgency),
      normalized_score: Math.max(confidence, urgency),
      severity_hint: Math.max(confidence, urgency),
      confidence_hint: confidence,
      reliability_hint: confidence,
      friction_hint: ambiguity,
      risk_hint: ambiguity,
      reversibility_hint: reversibility,
      expected_value_hint: expectedValue,
      evidence: [
        { label: "pending_goal", value: rel.state.pending_goal },
      ],
      tags: ["relational", "action"],
    });
  }

  return signals;
}

export function buildCoreInput(rel: ReturnType<typeof runRelationalEngine>, userText: string): UniversalCoreInput {
  const domain = deriveCoreDomain(rel.state);
  const allowAutomation =
    rel.intent === "operational" &&
    rel.state.confidence > 0.4 &&
    rel.state.ambiguity < 0.6 &&
    rel.state.active_domain !== "mail";

  return {
    request_id: `nyra-rel-core:${Date.now()}`,
    generated_at: new Date().toISOString(),
    domain,
    context: {
      actor_id: "nyra_relational_system",
      mode: rel.reply.mode,
      locale: "it-IT",
      metadata: {
        domain_hint: rel.state.active_domain,
        problem: rel.state.active_problem,
        goal: rel.state.pending_goal,
        intent: rel.intent,
        relation: rel.relation,
        user_text: userText,
      },
    },
    signals: buildRelationalSignals(rel, userText),
    data_quality: {
      score: scale100((rel.state.confidence + (1 - rel.state.ambiguity)) / 2),
      completeness: scale100(rel.state.confidence),
      consistency: scale100(1 - rel.state.ambiguity),
      reliability: scale100(rel.state.confidence),
      missing_fields: rel.state.active_problem ? [] : ["active_problem"],
    },
    constraints: {
      allow_automation: allowAutomation,
      require_confirmation: rel.state.ambiguity > 0.6 || rel.state.active_domain === "mail",
      risk_floor: 20,
      safety_mode: rel.intent === "emotional",
    },
  };
}

function buildGovernorInput(rel: ReturnType<typeof runRelationalEngine>) {
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

  return {
    task_type: "runtime_batch" as const,
    adapter_input: {
      success_rate: clamp01(rel.state.confidence),
      avg_latency: 200 + Math.round(rel.state.urgency * 800),
      error_rate: clamp01(rel.state.ambiguity),
    },
  };
}

export function initEngine() {
  return initRelationalState();
}

export const runRelationalEngineV2 = runRelationalEngine;

export function runNyraFullRelationalSystem(initialState?: NyraRelationalState) {
  let ctx = initialState ?? initEngine();

  return function handleInput(userText: string) {
    const rel = runRelationalEngineV2(ctx, userText);
    ctx = rel.state;

    const coreInput = buildCoreInput(rel, userText);
    const coreResult = runUniversalCore(coreInput);

    const risk = deriveNyraRiskConfidence({
      confidence: clamp01((coreResult.confidence ?? 50) / 100),
      error_probability: clamp01((coreResult.risk?.score ?? 50) / 100),
      impact: clamp01((coreResult.priority?.score ?? 50) / 100),
      reversibility: clamp01(1 - rel.state.ambiguity),
      uncertainty: clamp01(rel.state.ambiguity),
    });

    const governorInput = buildGovernorInput(rel);
    const decision = runNyraActionGovernor(governorInput);

    let finalMessage = "";
    const corePrimary = coreResult.recommended_actions?.[0]?.label;

    if (decision.decision === "allow") {
      finalMessage = `Azione consigliata:\n-> ${corePrimary ?? rel.reply.message}`;
    } else if (decision.decision === "retry" || decision.decision === "fallback") {
      finalMessage = `Meglio andare piu sicuri:\n-> ${rel.reply.message}`;
    } else if (decision.decision === "escalate" || decision.decision === "block") {
      finalMessage = `Serve attenzione:\n-> Fermati un attimo. ${rel.reply.message}`;
    } else {
      finalMessage = rel.reply.message;
    }

    return {
      relational_mode: rel.reply.mode,
      domain: rel.state.active_domain,
      core_domain: coreInput.domain,
      core_state: coreResult.state,
      risk: risk.risk_score,
      governor_decision: decision.decision,
      core_result: coreResult,
      relational: rel,
      message: finalMessage,
    };
  };
}

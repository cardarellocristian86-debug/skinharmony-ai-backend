import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalAction, UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";
import { inferNiraIntent, inferNiraTarget, prepareContextualNiraScenarios, selectedScenarioRequiresConfirmation } from "./nira-intent.js";

type NiraBridgeMode = "standard" | "god_mode_owner_only";

type TenantMemoryContext = {
  schema_version: "tenant_memory_context_v1";
  tenant_id: string;
  revision: number;
  latest_checkpoint?: unknown;
  relevant_memories?: unknown[];
  pending_handoffs?: unknown[];
  recent_activity?: unknown[];
};

export type NiraBridgeRequest = {
  request_id?: string;
  text: string;
  tenant_id?: string;
  domain?: string;
  domain_pack?: string;
  owner_verified?: boolean;
  access_scope?: "denied" | "limited" | "owner_full";
  mode?: NiraBridgeMode;
  target_system?: "suite" | "smartdesk" | "wordpress" | "analyzer" | "universal_core" | "generic";
  memory_context?: TenantMemoryContext;
};

export type NiraPreparedScenario = {
  id: string;
  label: string;
  action_id: string;
  action_label: string;
  category: string;
  severity: number;
  confidence: number;
  expected_value: number;
  friction: number;
  reversibility: number;
  risk: number;
  execution_scope: "read_only" | "proposal" | "confirm_required";
};

export type NiraBridgeResult = {
  ok: boolean;
  version: "nira_universal_core_bridge_v1";
  mode: NiraBridgeMode;
  god_mode_active: boolean;
  domain_context: {
    domain: string;
    domain_pack: string;
    runtime_kind: "horizontal_with_domain_pack";
  };
  prepared_by_nira: {
    intent: string;
    target_system: string;
    scenarios: NiraPreparedScenario[];
  };
  selected_by_core: {
    state: string;
    control_level: string;
    risk_band: string;
    primary_action_id: string;
    primary_action_label: string;
    can_execute: boolean;
    requires_owner_confirmation: boolean;
    blocked_reasons: string[];
  };
  automation_plan: {
    execution_allowed: boolean;
    next_step: string;
    runbook_candidate: string;
    audit_required: true;
    owner_confirmation_required: boolean;
  };
  efficiency: {
    baseline_steps_estimate: number;
    nira_core_steps_estimate: number;
    step_reduction_pct: number;
    decision_confidence: number;
    why_it_helps_codex: string[];
  };
  core_input: UniversalCoreInput;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
export const NIRA_BRIDGE_REPORT_PATH = join(ROOT, "reports", "universal-core", "nira", "nira_universal_core_bridge_latest.json");

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

export function prepareNiraScenarios(request: NiraBridgeRequest): NiraPreparedScenario[] {
  return prepareContextualNiraScenarios(request) as NiraPreparedScenario[];
}

function signalFromScenario(item: NiraPreparedScenario): UniversalSignal {
  return {
    id: `nira:${item.id}`,
    source: "nira_universal_core_bridge",
    category: item.category,
    label: item.label,
    value: item.expected_value,
    normalized_score: item.severity,
    severity_hint: item.severity,
    confidence_hint: item.confidence,
    expected_value_hint: item.expected_value,
    friction_hint: item.friction,
    risk_hint: item.risk,
    reversibility_hint: item.reversibility,
    evidence: [
      { label: "action_id", value: item.action_id, weight: 1 },
      { label: "execution_scope", value: item.execution_scope, weight: 1 },
    ],
    tags: ["nira", "orchestration", item.execution_scope],
  };
}

function primaryAction(output: ReturnType<typeof runUniversalCore>): UniversalAction | undefined {
  return output.recommended_actions.find((action) => action.id === output.priority.primary_action_id) ?? output.recommended_actions[0];
}

export function runNiraUniversalCoreBridge(request: NiraBridgeRequest): NiraBridgeResult {
  const target = inferNiraTarget(request.text, request.target_system);
  const intent = inferNiraIntent(request.text);
  const requestedGodMode = request.mode === "god_mode_owner_only";
  const godModeActive = Boolean(requestedGodMode && request.owner_verified && request.access_scope === "owner_full");
  const scenarios = prepareNiraScenarios(request);
  const potentiallySensitive = scenarios.some((item) => item.execution_scope === "confirm_required");

  const blockedRules = [];
  if (requestedGodMode && !godModeActive) {
    blockedRules.push({
      scope: "owner_only",
      reason_code: "god_mode_owner_verification_required",
      severity: 95,
      blocks_execution: true,
    });
  }
  if (!request.owner_verified && potentiallySensitive) {
    blockedRules.push({
      scope: "sensitive_automation",
      reason_code: "owner_not_verified",
      severity: 80,
      blocks_execution: true,
    });
  }

  const coreInput: UniversalCoreInput = {
    request_id: request.request_id ?? `nira-bridge:${Date.now()}`,
    generated_at: new Date().toISOString(),
    domain: String(request.domain || "generic_multi_tenant_system"),
    context: {
      actor_id: "nira_orchestrator",
      tenant_id: request.tenant_id ?? "owner_private",
      mode: godModeActive ? "god_mode_owner_only" : "standard",
      locale: "it-IT",
      metadata: {
        intent,
        target_system: target,
        domain_pack: String(request.domain_pack || "generic"),
        nira_role: "prepare_scenarios_only",
        core_role: "judge_rank_gate_audit",
        automation_role: "execute_only_after_core",
        memory_schema: request.memory_context?.schema_version || "none",
        memory_revision: request.memory_context?.revision || 0,
        memory_relevant_count: request.memory_context?.relevant_memories?.length || 0,
        memory_handoff_count: request.memory_context?.pending_handoffs?.length || 0,
      },
    },
    signals: scenarios.map(signalFromScenario),
    data_quality: {
      score: godModeActive ? 88 : potentiallySensitive ? 72 : 84,
      completeness: 82,
      freshness: 90,
      consistency: 86,
      reliability: request.owner_verified ? 88 : potentiallySensitive ? 65 : 84,
      missing_fields: potentiallySensitive && !request.owner_verified ? ["owner_verified"] : [],
    },
    constraints: {
      allow_automation: godModeActive,
      require_confirmation: potentiallySensitive,
      max_control_level: godModeActive ? "confirm" : potentiallySensitive ? "suggest" : "observe",
      blocked_action_rules: blockedRules,
      safety_mode: potentiallySensitive,
    },
  };

  const coreOutput = runUniversalCore(coreInput);
  const action = primaryAction(coreOutput);
  const canExecute = false;
  const ownerConfirmationRequired = selectedScenarioRequiresConfirmation(scenarios, action?.id);
  const baselineSteps = 9;
  const bridgeSteps = godModeActive ? 5 : 6;
  const stepReductionPct = Math.round(((baselineSteps - bridgeSteps) / baselineSteps) * 100);

  return {
    ok: true,
    version: "nira_universal_core_bridge_v1",
    mode: godModeActive ? "god_mode_owner_only" : "standard",
    god_mode_active: godModeActive,
    domain_context: {
      domain: String(request.domain || "generic_multi_tenant_system"),
      domain_pack: String(request.domain_pack || "generic"),
      runtime_kind: "horizontal_with_domain_pack",
    },
    prepared_by_nira: {
      intent,
      target_system: target,
      scenarios,
    },
    selected_by_core: {
      state: coreOutput.state,
      control_level: coreOutput.control_level,
      risk_band: coreOutput.risk.band,
      primary_action_id: action?.id ?? "",
      primary_action_label: action?.label ?? "",
      can_execute: canExecute,
      requires_owner_confirmation: ownerConfirmationRequired,
      blocked_reasons: coreOutput.blocked_reasons,
    },
    automation_plan: {
      execution_allowed: canExecute,
      next_step: ownerConfirmationRequired
        ? "Preparare runbook/evidence e chiedere conferma owner prima della scrittura reale."
        : "Procedere soltanto in lettura, analisi o proposta nel perimetro tenant.",
      runbook_candidate: action?.id.replace(/^action:/, "") ?? "none",
      audit_required: true,
      owner_confirmation_required: ownerConfirmationRequired,
    },
    efficiency: {
      baseline_steps_estimate: baselineSteps,
      nira_core_steps_estimate: bridgeSteps,
      step_reduction_pct: clamp(stepReductionPct),
      decision_confidence: coreOutput.confidence,
      why_it_helps_codex: [
        "Nira trasforma richieste naturali in scenari strutturati.",
        "Universal Core resta il selettore finale e impedisce esecuzione cieca.",
        "Il piano prodotto contiene gia runbook candidato, conferma owner e audit.",
      ],
    },
    core_input: coreInput,
  };
}

export function writeNiraBridgeReport(result: NiraBridgeResult, reportPath = NIRA_BRIDGE_REPORT_PATH): string {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(result, null, 2) + "\n");
  return reportPath;
}

if (process.argv[1]?.endsWith("nira-universal-core-bridge.ts")) {
  const result = runNiraUniversalCoreBridge({
    text: process.argv.slice(2).join(" ") || "Metti Nira in God Mode e usa Universal Core per automatizzare Suite in modo controllato.",
    owner_verified: true,
    access_scope: "owner_full",
    mode: "god_mode_owner_only",
    target_system: "suite",
  });
  const reportPath = writeNiraBridgeReport(result);
  console.log(JSON.stringify({ ok: result.ok, reportPath, selected_by_core: result.selected_by_core, efficiency: result.efficiency }, null, 2));
}

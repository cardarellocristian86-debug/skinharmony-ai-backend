import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalAction, UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";

type NiraBridgeMode = "standard" | "god_mode_owner_only";

export type NiraBridgeRequest = {
  request_id?: string;
  text: string;
  tenant_id?: string;
  domain?: string;
  domain_pack?: string;
  owner_verified?: boolean;
  access_scope?: "denied" | "limited" | "owner_full";
  mode?: NiraBridgeMode;
  target_system?: "suite" | "smartdesk" | "wordpress" | "universal_core" | "generic";
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

function inferIntent(text: string): string {
  const value = text.toLowerCase();
  if (/(sposta|render|allegger|control plane|dispatch|runbook|automaz)/.test(value)) return "orchestrate_controlled_automation";
  if (/(test|verifica|controlla|report)/.test(value)) return "verify_and_report";
  if (/(plugin|wordpress|suite)/.test(value)) return "suite_operational_planning";
  return "general_operational_planning";
}

function inferTarget(text: string, explicit?: NiraBridgeRequest["target_system"]): NonNullable<NiraBridgeRequest["target_system"]> {
  if (explicit) return explicit;
  const value = text.toLowerCase();
  if (value.includes("smart desk") || value.includes("smartdesk")) return "smartdesk";
  if (value.includes("wordpress") || value.includes("wp")) return "wordpress";
  if (value.includes("suite")) return "suite";
  if (value.includes("core")) return "universal_core";
  return "generic";
}

function scenario(
  id: string,
  label: string,
  actionId: string,
  actionLabel: string,
  category: string,
  values: Partial<Pick<NiraPreparedScenario, "severity" | "confidence" | "expected_value" | "friction" | "reversibility" | "risk" | "execution_scope">> = {},
): NiraPreparedScenario {
  return {
    id,
    label,
    action_id: actionId,
    action_label: actionLabel,
    category,
    severity: values.severity ?? 55,
    confidence: values.confidence ?? 75,
    expected_value: values.expected_value ?? 70,
    friction: values.friction ?? 25,
    reversibility: values.reversibility ?? 80,
    risk: values.risk ?? 35,
    execution_scope: values.execution_scope ?? "proposal",
  };
}

export function prepareNiraScenarios(request: NiraBridgeRequest): NiraPreparedScenario[] {
  const text = request.text.toLowerCase();
  const scenarios: NiraPreparedScenario[] = [
    scenario("map_context", "Mappa contesto e stato reale", "action:read_current_state", "Leggere stato reale", "context", {
      severity: 38,
      confidence: 90,
      expected_value: 65,
      friction: 12,
      risk: 12,
      execution_scope: "read_only",
    }),
    scenario("core_rank_options", "Genera varianti e lascia scegliere al Core", "action:rank_variants_with_core", "Ranking varianti Core", "decision", {
      severity: 54,
      confidence: 84,
      expected_value: 86,
      friction: 18,
      risk: 24,
    }),
    scenario("controlled_runbook", "Prepara runbook controllato con evidence", "action:prepare_controlled_runbook", "Preparare runbook controllato", "automation", {
      severity: 66,
      confidence: 80,
      expected_value: 88,
      friction: 22,
      risk: 42,
      execution_scope: "confirm_required",
    }),
  ];

  if (/(render|control plane|nodi|dispatch|suite)/.test(text)) {
    scenarios.push(
      scenario("render_handoff", "Sposta peso su Render e lascia UI leggera", "action:render_control_plane_handoff", "Handoff Render controllato", "architecture", {
        severity: 70,
        confidence: 82,
        expected_value: 92,
        friction: 28,
        risk: 48,
        execution_scope: "confirm_required",
      }),
    );
  }

  if (/(god mode|modalita dio|owner|cristian)/.test(text) || request.mode === "god_mode_owner_only") {
    scenarios.push(
      scenario("owner_god_mode_bridge", "Abilita God Mode owner-only come orchestrazione, non bypass", "action:owner_only_god_mode_bridge", "God Mode owner-only", "owner_control", {
        severity: 62,
        confidence: request.owner_verified ? 86 : 35,
        expected_value: 78,
        friction: 16,
        risk: request.owner_verified ? 34 : 82,
        execution_scope: "confirm_required",
      }),
    );
  }

  return scenarios;
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
  const target = inferTarget(request.text, request.target_system);
  const intent = inferIntent(request.text);
  const requestedGodMode = request.mode === "god_mode_owner_only";
  const godModeActive = Boolean(requestedGodMode && request.owner_verified && request.access_scope === "owner_full");
  const scenarios = prepareNiraScenarios(request);

  const blockedRules = [];
  if (requestedGodMode && !godModeActive) {
    blockedRules.push({
      scope: "owner_only",
      reason_code: "god_mode_owner_verification_required",
      severity: 95,
      blocks_execution: true,
    });
  }
  if (!request.owner_verified) {
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
      },
    },
    signals: scenarios.map(signalFromScenario),
    data_quality: {
      score: godModeActive ? 88 : 68,
      completeness: 76,
      freshness: 90,
      consistency: 82,
      reliability: request.owner_verified ? 88 : 55,
      missing_fields: request.owner_verified ? [] : ["owner_verified"],
    },
    constraints: {
      allow_automation: godModeActive,
      require_confirmation: true,
      max_control_level: godModeActive ? "confirm" : "suggest",
      blocked_action_rules: blockedRules,
      safety_mode: true,
    },
  };

  const coreOutput = runUniversalCore(coreInput);
  const action = primaryAction(coreOutput);
  const canExecute = false;
  const ownerConfirmationRequired = true;
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
      next_step: canExecute
        ? "Preparare runbook e chiedere conferma owner prima della scrittura reale."
        : "Restare in proposta/preview finche Core e owner non consentono.",
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

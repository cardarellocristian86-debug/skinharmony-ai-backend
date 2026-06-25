import { pathToFileURL } from "node:url";
import type { ControlLevel, UniversalCoreInput, UniversalCoreOutput } from "../packages/contracts/src/index.ts";
import { runUniversalCoreDecisionV1Calibrated } from "../packages/core/src/decisionV1Calibrated.ts";
import { runUniversalCoreDecisionV2Elastic } from "../packages/core/src/decisionV2Elastic.ts";
import { computeV7Alpha, selectV7Path } from "../packages/branches/assistant/src/index.ts";
import type { NyraActionRoute } from "./nyra-action-router.ts";
import type { NyraBranchOverlay } from "./nyra-branch-overlay.ts";

export type NyraCore2PipelineResult = {
  version: "nyra_core2_v1_v2_v7_pipeline_v1";
  local_only: true;
  render_touched: false;
  input: {
    request_id: string;
    action_type: string;
    target_environment: "local" | "production";
    route_intent: NyraActionRoute["intent"];
    primary_branch: string;
  };
  stages: {
    core2: {
      judge: "universal_core_2_0_v2_elastic";
      state: UniversalCoreOutput["state"];
      control_level: ControlLevel;
      risk_score: number;
      risk_band: UniversalCoreOutput["risk"]["band"];
      confidence: number;
      selected_branch?: string;
    };
    v1: {
      state: UniversalCoreOutput["state"];
      control_level: ControlLevel;
      risk_score: number;
      risk_band: UniversalCoreOutput["risk"]["band"];
      confidence: number;
    };
    v2: {
      state: UniversalCoreOutput["state"];
      control_level: ControlLevel;
      risk_score: number;
      risk_band: UniversalCoreOutput["risk"]["band"];
      confidence: number;
      selected_branch?: string;
    };
    v7: {
      alpha: number;
      path: 0 | 1 | 2;
      path_label: "protect" | "verify" | "normal";
      risk_score: number;
      sensitivity: number;
    };
  };
  winner: {
    source: "core2_v2_elastic";
    control_level: ControlLevel;
    can_execute: boolean;
    requires_owner_confirmation: boolean;
    selected_action: string;
    explanation: string;
  };
  rules: string[];
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function riskFromRoute(route: NyraActionRoute): number {
  if (route.risk_band === "blocked") return 96;
  if (route.risk_band === "high") return 74;
  if (route.risk_band === "medium") return 48;
  return 18;
}

function actionTypeFor(route: NyraActionRoute): string {
  if (route.intent === "deploy_or_render") return "push_update";
  if (route.intent === "rotate_or_touch_keys") return "secret_write";
  if (route.intent === "pricing_or_checkout") return "pricing";
  if (route.intent === "customer_or_tenant_data") return "cross_tenant";
  if (route.intent === "edit_local_code") return "update";
  if (route.intent === "run_local_tests") return "test";
  return "read_only";
}

function executionCanStayLocal(route: NyraActionRoute): boolean {
  return !route.render_protected && route.intent !== "deploy_or_render";
}

function pathLabel(path: 0 | 1 | 2): NyraCore2PipelineResult["stages"]["v7"]["path_label"] {
  if (path === 0) return "protect";
  if (path === 1) return "verify";
  return "normal";
}

function selectedBranch(output: UniversalCoreOutput): string | undefined {
  return output.diagnostics.branch_route?.primary_branch ?? output.diagnostics.branch_router_v2?.selected_branches?.[0];
}

function buildCoreInput(params: {
  user_text: string;
  overlay: NyraBranchOverlay;
  route: NyraActionRoute;
}): UniversalCoreInput {
  const risk = riskFromRoute(params.route);
  const actionType = actionTypeFor(params.route);
  const production = params.route.render_protected || params.route.intent === "deploy_or_render";
  const canStayLocal = executionCanStayLocal(params.route);
  const confidence = canStayLocal ? 82 : 72;
  const blockedRules = [
    ...(params.route.render_protected
      ? [{
          scope: "render",
          reason_code: "render_boundary_local_governance",
          severity: 96,
          blocks_execution: true,
        }]
      : []),
    ...(params.route.intent === "rotate_or_touch_keys"
      ? [{
          scope: "secrets",
          reason_code: "secret_boundary",
          severity: 100,
          blocks_execution: true,
        }]
      : []),
  ];

  return {
    request_id: `nyra-core2-${Date.now()}`,
    generated_at: new Date().toISOString(),
    domain: "assistant",
    context: {
      actor_id: "nyra_local_governance",
      tenant_id: "local-codex",
      mode: production ? "production" : "local",
      locale: "it-IT",
      metadata: {
        action_type: actionType,
        target_environment: production ? "production" : "local",
        route_intent: params.route.intent,
        execution_mode: params.route.execution_mode,
        primary_branch: params.overlay.primary_branch.id,
        question: params.user_text,
        rollback_available: canStayLocal,
        reversible: canStayLocal,
        owner_confirmed: false,
        source: "nyra_local_governance",
      },
    },
    signals: [
      {
        id: `nyra:${params.route.intent}`,
        source: "nyra_local_governance",
        category: params.route.intent,
        label: params.route.first_step,
        value: risk,
        normalized_score: risk,
        severity_hint: risk,
        confidence_hint: confidence,
        reliability_hint: 80,
        risk_hint: risk,
        reversibility_hint: canStayLocal ? 84 : 18,
        expected_value_hint: params.route.intent === "edit_local_code" ? 72 : 48,
        tags: [
          params.overlay.primary_branch.id,
          params.route.render_protected ? "render" : "local",
          ...(production ? ["production"] : []),
          ...(params.route.intent === "customer_or_tenant_data" ? ["cross_tenant"] : []),
          ...(params.route.intent === "rotate_or_touch_keys" ? ["secret"] : []),
        ],
      },
    ],
    data_quality: {
      score: confidence,
      completeness: 72,
      freshness: 90,
      consistency: params.route.execution_mode === "blocked" ? 70 : 82,
      reliability: 82,
      missing_fields: production ? ["render_gate_audit", "owner_runtime_confirmation"] : [],
    },
    constraints: {
      allow_automation: false,
      require_confirmation: params.route.requires_owner_confirmation,
      max_control_level: params.route.execution_mode === "blocked" ? "blocked" : "confirm",
      safety_mode: true,
      permissions: canStayLocal ? ["owner"] : [],
      blocked_actions: params.route.blocked_tools,
      blocked_action_rules: blockedRules,
      allowed_actions: params.route.allowed_tools,
    },
  };
}

export function buildNyraCore2Pipeline(input: {
  user_text: string;
  overlay: NyraBranchOverlay;
  route: NyraActionRoute;
}): NyraCore2PipelineResult {
  const coreInput = buildCoreInput(input);
  const v1 = runUniversalCoreDecisionV1Calibrated(coreInput);
  const v2 = runUniversalCoreDecisionV2Elastic(coreInput);
  const riskScore = Math.max(v1.risk.score, v2.risk.score, riskFromRoute(input.route));
  const sensitivity = input.route.render_protected || input.route.intent === "rotate_or_touch_keys"
    ? 0.92
    : input.route.requires_owner_confirmation
      ? 0.72
      : 0.38;
  const automationPressure = input.route.execution_mode === "dry_run" ? 0.22 : input.route.execution_mode === "reply_only" ? 0.12 : 0.42;
  const impact = input.route.intent === "edit_local_code" ? 0.68 : input.route.render_protected ? 0.84 : 0.45;
  const quality = (coreInput.data_quality.score ?? 70) / 100;
  const alpha = computeV7Alpha(riskScore / 100, automationPressure, impact, sensitivity, quality, false);
  const v7Path = selectV7Path(riskScore, sensitivity, alpha);
  const hardProtect = v7Path === 0 || v1.control_level === "blocked" || v2.control_level === "blocked";
  const locallyExecutable = input.route.execution_mode === "dry_run";
  const canExecute = !hardProtect && locallyExecutable && v2.execution_profile.can_execute;
  const requiresConfirmation =
    hardProtect ||
    v2.execution_profile.requires_user_confirmation ||
    input.route.requires_owner_confirmation ||
    v7Path === 1;
  const selectedAction = input.route.execution_mode === "blocked"
    ? "blocca e apri fase separata"
    : input.route.execution_mode === "dry_run"
      ? "prepara patch locale e verifica"
      : input.route.first_step;

  return {
    version: "nyra_core2_v1_v2_v7_pipeline_v1",
    local_only: true,
    render_touched: false,
    input: {
      request_id: coreInput.request_id,
      action_type: actionTypeFor(input.route),
      target_environment: input.route.render_protected ? "production" : "local",
      route_intent: input.route.intent,
      primary_branch: input.overlay.primary_branch.id,
    },
    stages: {
      core2: {
        judge: "universal_core_2_0_v2_elastic",
        state: v2.state,
        control_level: v2.control_level,
        risk_score: round(v2.risk.score),
        risk_band: v2.risk.band,
        confidence: round(v2.confidence),
        selected_branch: selectedBranch(v2),
      },
      v1: {
        state: v1.state,
        control_level: v1.control_level,
        risk_score: round(v1.risk.score),
        risk_band: v1.risk.band,
        confidence: round(v1.confidence),
      },
      v2: {
        state: v2.state,
        control_level: v2.control_level,
        risk_score: round(v2.risk.score),
        risk_band: v2.risk.band,
        confidence: round(v2.confidence),
        selected_branch: selectedBranch(v2),
      },
      v7: {
        alpha: round(alpha),
        path: v7Path,
        path_label: pathLabel(v7Path),
        risk_score: round(clamp(riskScore)),
        sensitivity: round(sensitivity),
      },
    },
    winner: {
      source: "core2_v2_elastic",
      control_level: hardProtect ? "blocked" : v2.control_level,
      can_execute: canExecute,
      requires_owner_confirmation: requiresConfirmation,
      selected_action: selectedAction,
      explanation: hardProtect
        ? "Core 2.0 usa V2 come giudice finale e V7 mette il percorso in protezione."
        : "Core 2.0 usa V2 come giudice finale; V1 controlla la baseline e V7 decide il livello di verifica.",
    },
    rules: [
      "Core 2.0/V2 e il giudice finale della pipeline locale.",
      "V1 resta baseline calibrata contro regressioni semplici.",
      "V7 decide pressione, protezione e verifica prima di permettere azioni.",
      "Nyra spiega e organizza; Codex implementa; Render resta fuori dal ciclo locale.",
    ],
  };
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  const userText = process.argv.slice(2).join(" ").trim() || "Nyra usa Core 2.0 V1 V2 V7 in locale.";
  const { buildNyraBranchOverlay } = await import("./nyra-branch-overlay.ts");
  const { buildNyraActionRoute } = await import("./nyra-action-router.ts");
  const overlay = buildNyraBranchOverlay(userText);
  const route = buildNyraActionRoute({ user_text: userText, overlay });
  console.log(JSON.stringify(buildNyraCore2Pipeline({ user_text: userText, overlay, route }), null, 2));
}

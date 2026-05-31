import { pathToFileURL } from "node:url";
import type { ControlLevel, UniversalCoreInput, UniversalCoreOutput } from "../packages/contracts/src/index.ts";
import { runUniversalCore } from "../packages/core/src/index.ts";
import { runUniversalCoreDecisionV1Calibrated } from "../packages/core/src/decisionV1Calibrated.ts";
import { runUniversalCoreDecisionV2Elastic } from "../packages/core/src/decisionV2Elastic.ts";
import { computeV7Alpha, selectV7Path } from "../packages/branches/assistant/src/index.ts";

export type NyraRenderPipelineIntent =
  | "chat"
  | "local_fix"
  | "deploy_or_render"
  | "secret_or_key"
  | "tenant_or_customer_data"
  | "pricing_or_checkout";

export type NyraCore2RenderPipelineResult = {
  version: "nyra_render_core2_v1_v2_v7_pipeline_v1";
  local_only: boolean;
  render_touched: false;
  input: {
    request_id: string;
    intent: NyraRenderPipelineIntent;
    action_type: string;
    target_environment: "local" | "production";
    route_primary?: string;
  };
  stages: {
    core2: StageSnapshot & { judge: "universal_core_current" };
    v1: StageSnapshot;
    v2: StageSnapshot & { selected_branch?: string };
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
};

type StageSnapshot = {
  state: UniversalCoreOutput["state"];
  control_level: ControlLevel;
  risk_score: number;
  risk_band: UniversalCoreOutput["risk"]["band"];
  confidence: number;
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

function hasUnnegatedTerm(text: string, term: string): boolean {
  const normalizedTerm = normalize(term);
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\s)(non|no|senza|evita|blocca|niente)\\s+(?:\\w+\\s+){0,3}${escaped}\\w*(?=\\s|$)`, "u");
  return text.includes(normalizedTerm) && !pattern.test(text);
}

function hasUnnegatedAny(text: string, terms: string[]): boolean {
  return terms.some((term) => hasUnnegatedTerm(text, term));
}

function detectIntent(text: string): NyraRenderPipelineIntent {
  const normalized = normalize(text);
  if (hasUnnegatedAny(normalized, ["api key", "chiave", "token", "password", "secret"])) return "secret_or_key";
  if (hasUnnegatedAny(normalized, ["tenant", "cliente reale", "clienti reali", "dati cliente", "cross tenant"])) return "tenant_or_customer_data";
  if (hasUnnegatedAny(normalized, ["prezzo", "prezzi", "checkout", "pagamento", "nexi", "listino"])) return "pricing_or_checkout";
  if (hasUnnegatedAny(normalized, ["deploy", "render", "produzione", "live", "release", "pubblica", "rilascia"])) return "deploy_or_render";
  if (hasAny(normalized, ["sistema", "modifica", "patch", "fix", "bug", "debug", "test", "codice", "smart desk", "gold"])) return "local_fix";
  return "chat";
}

function actionType(intent: NyraRenderPipelineIntent): string {
  if (intent === "deploy_or_render") return "push_update";
  if (intent === "secret_or_key") return "secret_write";
  if (intent === "tenant_or_customer_data") return "cross_tenant";
  if (intent === "pricing_or_checkout") return "pricing";
  if (intent === "local_fix") return "update";
  return "read_only";
}

function riskFor(intent: NyraRenderPipelineIntent): number {
  if (intent === "deploy_or_render" || intent === "secret_or_key") return 96;
  if (intent === "tenant_or_customer_data" || intent === "pricing_or_checkout") return 78;
  if (intent === "local_fix") return 28;
  return 18;
}

function pathLabel(path: 0 | 1 | 2): "protect" | "verify" | "normal" {
  if (path === 0) return "protect";
  if (path === 1) return "verify";
  return "normal";
}

function selectedBranch(output: UniversalCoreOutput): string | undefined {
  return (output.diagnostics as any).branch_route?.primary_branch ?? (output.diagnostics as any).branch_router_v2?.selected_branches?.[0];
}

function stage(output: UniversalCoreOutput): StageSnapshot {
  return {
    state: output.state,
    control_level: output.control_level,
    risk_score: round(output.risk.score),
    risk_band: output.risk.band,
    confidence: round(output.confidence),
  };
}

function buildCoreInput(params: {
  text: string;
  intent: NyraRenderPipelineIntent;
  routePrimary?: string;
}): UniversalCoreInput {
  const risk = riskFor(params.intent);
  const production = params.intent === "deploy_or_render" || params.intent === "secret_or_key" || params.intent === "tenant_or_customer_data";
  const blockedRules = production
    ? [{ scope: "render", reason_code: "render_or_sensitive_boundary", severity: 96, blocks_execution: true }]
    : [];

  return {
    request_id: `nyra-render-core2-${Date.now()}`,
    generated_at: new Date().toISOString(),
    domain: "assistant",
    context: {
      actor_id: "nyra_render_text_chat",
      tenant_id: "nyra-render",
      mode: production ? "production" : "local",
      locale: "it-IT",
      metadata: {
        action_type: actionType(params.intent),
        target_environment: production ? "production" : "local",
        route_primary: params.routePrimary,
        question: params.text,
        owner_confirmed: false,
        rollback_available: !production,
        source: "nyra_render_text_chat",
      },
    },
    signals: [
      {
        id: `nyra_render:${params.intent}`,
        source: "nyra_render_text_chat",
        category: params.intent,
        label: params.text.slice(0, 120) || params.intent,
        value: risk,
        normalized_score: risk,
        severity_hint: risk,
        confidence_hint: 82,
        reliability_hint: 80,
        risk_hint: risk,
        reversibility_hint: production ? 18 : 84,
        expected_value_hint: params.intent === "local_fix" ? 68 : 42,
        tags: [params.intent, production ? "production" : "local", ...(params.routePrimary ? [params.routePrimary] : [])],
      },
    ],
    data_quality: {
      score: 82,
      completeness: 74,
      freshness: 90,
      consistency: 80,
      reliability: 82,
      missing_fields: production ? ["owner_runtime_confirmation", "rollback_plan"] : [],
    },
    constraints: {
      allow_automation: false,
      require_confirmation: production,
      max_control_level: production ? "blocked" : "confirm",
      safety_mode: true,
      blocked_action_rules: blockedRules,
      allowed_actions: ["reply", "suggest", "local_verify"],
      blocked_actions: production ? ["deploy", "write_production", "touch_keys", "touch_customer_data"] : ["deploy", "write_production"],
    },
  };
}

export function buildNyraCore2RenderPipeline(input: {
  text: string;
  routePrimary?: string;
}): NyraCore2RenderPipelineResult {
  const intent = detectIntent(input.text);
  const coreInput = buildCoreInput({ text: input.text, intent, routePrimary: input.routePrimary });
  const core2 = runUniversalCore(coreInput);
  const v1 = runUniversalCoreDecisionV1Calibrated(coreInput);
  const v2 = runUniversalCoreDecisionV2Elastic(coreInput);
  const riskScore = Math.max(core2.risk.score, v1.risk.score, v2.risk.score, riskFor(intent));
  const production = coreInput.context.mode === "production";
  const sensitivity = production ? 0.92 : intent === "pricing_or_checkout" ? 0.72 : 0.38;
  const alpha = computeV7Alpha(riskScore / 100, intent === "chat" ? 0.12 : 0.34, production ? 0.84 : 0.52, sensitivity, 0.82, false);
  const v7Path = selectV7Path(riskScore, sensitivity, alpha);
  const hardProtect = v7Path === 0 || v1.control_level === "blocked" || v2.control_level === "blocked" || core2.control_level === "blocked";
  const canExecute = !hardProtect && intent === "local_fix" && v2.execution_profile.can_execute;

  return {
    version: "nyra_render_core2_v1_v2_v7_pipeline_v1",
    local_only: !production,
    render_touched: false,
    input: {
      request_id: coreInput.request_id,
      intent,
      action_type: actionType(intent),
      target_environment: production ? "production" : "local",
      route_primary: input.routePrimary,
    },
    stages: {
      core2: { judge: "universal_core_current", ...stage(core2) },
      v1: stage(v1),
      v2: { ...stage(v2), selected_branch: selectedBranch(v2) },
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
      requires_owner_confirmation: hardProtect || production || v7Path === 1,
      selected_action: hardProtect ? "proteggi e chiedi fase separata" : intent === "local_fix" ? "prepara verifica locale" : "rispondi e spiega il limite",
      explanation: hardProtect
        ? "Nyra Render usa Core/V1/V2/V7 e mette in protezione il perimetro sensibile."
        : "Nyra Render usa Core/V1/V2/V7 prima di rispondere.",
    },
  };
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  const text = process.argv.slice(2).join(" ").trim() || "Nyra usa Core 2.0 V1 V2 V7";
  console.log(JSON.stringify(buildNyraCore2RenderPipeline({ text }), null, 2));
}

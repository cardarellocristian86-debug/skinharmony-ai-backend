import crypto from "node:crypto";
import { hasScope, SCOPES } from "./scope.js";
import { normalizeDecisionContract } from "./decisionContract.js";
import { getTenantPolicy } from "./tenantRegistry.js";

export const AI_GATEWAY_SCHEMA_VERSION = "ai_gateway_v1";

export const AI_GATEWAY_MODES = new Set([
  "advisory",
  "rewrite",
  "hard-gating",
  "execution_orchestration",
]);

export const AI_GATEWAY_ADAPTERS = new Set([
  "generic",
  "chatgpt",
  "codex",
  "site_suite",
  "smart_desk",
  "skinharmony_core",
]);

const SENSITIVE_ACTIONS = new Set([
  "publish",
  "approve",
  "delete",
  "deploy",
  "update",
  "sync",
  "send",
  "write",
  "pricing",
  "claim_validation",
  "license_change",
  "payment_change",
  "tenant_admin",
  "codex_automation",
  "execution",
]);

function nowIso() {
  return new Date().toISOString();
}

function text(value, fallback = "") {
  return String(value === undefined || value === null ? fallback : value).trim();
}

function clampScore(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function arrayValue(value, max = 30) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => text(item)).filter(Boolean);
}

function normalizeAdapter(value) {
  const normalized = text(value || "generic").toLowerCase().replaceAll("-", "_");
  return AI_GATEWAY_ADAPTERS.has(normalized) ? normalized : "generic";
}

function normalizeMode(value) {
  const normalized = text(value || "advisory").toLowerCase().replace("execution orchestration", "execution_orchestration");
  return AI_GATEWAY_MODES.has(normalized) ? normalized : "advisory";
}

function contextualRuntime(payload = {}) {
  const context = typeof payload.context === "object" && payload.context ? payload.context : {};
  const runtime = payload.runtime_state ?? context.runtime_state;
  if (typeof runtime === "object" && runtime && !Array.isArray(runtime)) return runtime;
  if (typeof runtime === "string") return { status: runtime };
  return {};
}

function contextualRoleScope(payload = {}) {
  const context = typeof payload.context === "object" && payload.context ? payload.context : {};
  if (typeof payload.role_scope === "object" && payload.role_scope && !Array.isArray(payload.role_scope)) return payload.role_scope;
  return {
    role: context.role || context.actor_role || "",
    requested_scopes: Array.isArray(context.role_scope) ? context.role_scope : [],
  };
}

function contextualFlowPressure(payload = {}) {
  const context = typeof payload.context === "object" && payload.context ? payload.context : {};
  return payload.flow_pressure ?? context.flow_pressure ?? 0;
}

function requestedAction(payload = {}) {
  const raw = typeof payload.requested_action === "object" && payload.requested_action
    ? payload.requested_action
    : { type: payload.requested_action || payload.action_type || payload.domain };
  return {
    type: text(raw.type || payload.action_type || "advisory"),
    label: text(raw.label || raw.name || payload.task || payload.user_request || raw.type || "AI Gateway request"),
    intent: text(raw.intent || payload.intent || ""),
    publish_intent: Boolean(raw.publish_intent || payload.publish_intent),
    target: text(raw.target || payload.target || ""),
    sensitive: Boolean(raw.sensitive),
  };
}

function riskFromText(value = "") {
  const body = text(value).toLowerCase();
  if (!body) return { score: 25, warnings: ["llm_output_missing"] };
  const high = ["password", "secret", "token", "api key", "private key", "delete", "drop table", "reset --hard"];
  const medium = ["publish", "deploy", "send", "sync", "update", "pricing", "claim", "license"];
  const highHits = high.filter((item) => body.includes(item));
  const mediumHits = medium.filter((item) => body.includes(item));
  return {
    score: Math.min(100, highHits.length * 30 + mediumHits.length * 12 + 15),
    warnings: [
      ...highHits.map((item) => `sensitive_output:${item}`),
      ...mediumHits.map((item) => `action_output:${item}`),
    ],
  };
}

function flattenForScan(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!raw || !["{", "["].includes(raw[0])) return value;
  try {
    return JSON.parse(raw);
  } catch {
    return value;
  }
}

function collectObjectValues(value, path = "", output = []) {
  if (value === undefined || value === null) return output;
  if (typeof value !== "object") {
    output.push({ path, value });
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectObjectValues(item, `${path}[${index}]`, output));
    return output;
  }
  Object.entries(value).forEach(([key, item]) => collectObjectValues(item, path ? `${path}.${key}` : key, output));
  return output;
}

function detectAgnosticWorkflowRisk(payload = {}) {
  const parsedUserRequest = parseMaybeJson(payload.user_request);
  const parsedOutput = parseMaybeJson(payload.llm_output || payload.output);
  const scanText = [
    payload.action_type,
    payload.requested_action,
    flattenForScan(parsedUserRequest),
    flattenForScan(parsedOutput),
    flattenForScan(payload.context),
    flattenForScan(payload.runtime_state),
  ].join(" ").toLowerCase();

  const patterns = [
    { id: "bypass_audit", category: "override", tokens: ["bypass_audit", "bypass audit", "bypass_staging_audit", "skip audit"] },
    { id: "hot_swap", category: "override", tokens: ["hot_swap", "hot swap", "runtime hot swap"] },
    { id: "override_threshold", category: "override", tokens: ["override_threshold", "override threshold", "override_liquidity_threshold"] },
    { id: "cross_border", category: "network_movement", tokens: ["cross_border", "cross-border", "cross border"] },
    { id: "ledger", category: "network_movement", tokens: ["ledger", "ledger_transfer", "cross_border_ledger_transfer"] },
    { id: "offshore", category: "network_movement", tokens: ["offshore", "offshore_node"] },
    { id: "cross_tenant", category: "network_movement", tokens: ["cross-tenant", "cross_tenant", "cross tenant"] },
  ];

  const hits = [];
  for (const pattern of patterns) {
    if (pattern.tokens.some((token) => scanText.includes(token))) {
      hits.push({ id: pattern.id, category: pattern.category });
    }
  }

  const structuredValues = [
    ...collectObjectValues(parsedUserRequest),
    ...collectObjectValues(parsedOutput),
    ...collectObjectValues(payload.context),
  ];
  const autonomousAuthorization = structuredValues.some((entry) => {
    const key = String(entry.path || "").toLowerCase();
    const value = String(entry.value || "").toLowerCase();
    return key.endsWith("authorized_by") && value === "ai_agent_auto";
  }) || scanText.includes('"authorized_by":"ai_agent_auto"') || scanText.includes('"authorized_by": "ai_agent_auto"');

  const mediumRiskContext =
    hits.length > 0 ||
    scanText.includes("market_volatility_index\":\"high") ||
    scanText.includes("market_volatility_index\": \"high") ||
    scanText.includes("risk_tolerance_coefficient") ||
    scanText.includes("automated_workflow");

  if (autonomousAuthorization && mediumRiskContext) {
    hits.push({ id: "ai_agent_auto_authorization", category: "autonomous_authorization" });
  }

  const uniqueHits = Array.from(new Map(hits.map((hit) => [hit.id, hit])).values());
  return {
    triggered: uniqueHits.length > 0,
    severity: uniqueHits.length ? 100 : 0,
    risk_band: uniqueHits.length ? "high" : "low",
    hits: uniqueHits,
    warnings: uniqueHits.map((hit) => `agnostic_workflow_flag:${hit.id}`),
  };
}

function policyWarningsFromText(tenantPolicy = {}, value = "") {
  const body = text(value).toLowerCase();
  if (!body) return [];
  const claims = Array.isArray(tenantPolicy.guardrails?.forbidden_claims)
    ? tenantPolicy.guardrails.forbidden_claims
    : [];
  return claims
    .map((claim) => text(claim).toLowerCase())
    .filter(Boolean)
    .filter((claim) => body.includes(claim))
    .map((claim) => `tenant_forbidden_claim:${claim}`);
}

function pressureScore(value) {
  if (typeof value === "number") return clampScore(value, 0);
  if (typeof value !== "object" || !value) return 0;
  return Math.max(
    clampScore(value.pressure_score ?? value.pressure ?? 0, 0),
    clampScore(value.urgency ?? 0, 0),
    clampScore(value.error_pressure ?? 0, 0),
    clampScore(value.user_pressure ?? 0, 0),
  );
}

function runtimeRisk(runtime = {}) {
  if (typeof runtime !== "object" || !runtime) return 15;
  const status = text(runtime.status || runtime.health || runtime.state).toLowerCase();
  let score = 15;
  if (["degraded", "warning", "unstable"].includes(status)) score = 55;
  if (["critical", "offline", "failed", "blocked"].includes(status)) score = 85;
  if (runtime.has_errors === true || runtime.error_count > 0) score = Math.max(score, 60);
  if (runtime.test_status === "failed") score = Math.max(score, 78);
  return clampScore(score, 15);
}

export function validateAiGatewayPayload(payload = {}) {
  const errors = [];
  if (!text(payload.user_request) && !text(payload.task)) errors.push("user_request_required");
  if (payload.context !== undefined && (typeof payload.context !== "object" || payload.context === null || Array.isArray(payload.context))) {
    errors.push("context_must_be_object");
  }
  if (payload.runtime_state !== undefined && typeof payload.runtime_state !== "string" && (typeof payload.runtime_state !== "object" || payload.runtime_state === null || Array.isArray(payload.runtime_state))) {
    errors.push("runtime_state_must_be_object");
  }
  if (payload.role_scope !== undefined && (typeof payload.role_scope !== "object" || payload.role_scope === null || Array.isArray(payload.role_scope))) {
    errors.push("role_scope_must_be_object");
  }
  if (payload.variants !== undefined && !Array.isArray(payload.variants)) errors.push("variants_must_be_array");
  return { ok: errors.length === 0, errors };
}

export function rankGatewayVariants(variants = []) {
  if (!Array.isArray(variants) || !variants.length) return null;
  const ranked = variants.map((variant, index) => {
    const confidence = clampScore(variant.confidence ?? variant.score ?? 60, 60);
    const risk = clampScore(variant.risk ?? variant.risk_score ?? 30, 30);
    const impact = clampScore(variant.impact ?? variant.expected_value ?? 50, 50);
    return {
      id: text(variant.id || `variant_${index + 1}`),
      label: text(variant.label || variant.name || variant.id || `Variante ${index + 1}`),
      score: clampScore(confidence * 0.42 + impact * 0.38 + (100 - risk) * 0.2),
      confidence,
      risk,
      selected: false,
    };
  }).sort((a, b) => b.score - a.score);
  if (ranked[0]) ranked[0].selected = true;
  return ranked[0] || null;
}

export function buildAiGatewayCoreInput({ payload = {}, tenantId = "", keyRecord = null, adapterOverride = "" }) {
  const adapter = normalizeAdapter(adapterOverride || payload.adapter || payload.client);
  const mode = normalizeMode(payload.mode || payload.gateway_mode);
  const action = requestedAction(payload);
  const context = typeof payload.context === "object" && payload.context ? payload.context : {};
  const runtime = contextualRuntime(payload);
  const roleScope = contextualRoleScope(payload);
  const tenantPolicy = getTenantPolicy(tenantId, payload.plan || keyRecord?.metadata?.tier);
  const outputRisk = riskFromText(payload.llm_output || payload.output || "");
  const policyWarnings = policyWarningsFromText(tenantPolicy, payload.llm_output || payload.output || "");
  const flow = pressureScore(contextualFlowPressure(payload));
  const actionType = action.type.toLowerCase();
  const sensitive = action.sensitive || action.publish_intent || SENSITIVE_ACTIONS.has(actionType);
  const selectedVariant = rankGatewayVariants(payload.variants);
  const agnosticWorkflowRisk = detectAgnosticWorkflowRisk(payload);
  const missingFields = [
    ...(!text(payload.llm_output || payload.output) ? ["llm_output"] : []),
    ...(!text(roleScope.role || roleScope.actor_role) ? ["role_scope.role"] : []),
  ];

  const signals = [
    {
      id: `gateway:action:${actionType}`,
      source: "ai_gateway",
      category: "action",
      label: action.label,
      value: sensitive ? 68 : 34,
      normalized_score: sensitive ? 68 : 34,
      severity_hint: sensitive ? 72 : 34,
      confidence_hint: 82,
      evidence: [
        { label: "adapter", value: adapter },
        { label: "mode", value: mode },
        { label: "action_type", value: action.type },
      ],
      tags: ["ai_gateway", adapter, actionType],
    },
    {
      id: "gateway:llm_output_risk",
      source: "ai_gateway",
      category: "llm_output",
      label: "Rischio output LLM",
      value: outputRisk.score,
      normalized_score: outputRisk.score,
      severity_hint: outputRisk.score,
      confidence_hint: text(payload.llm_output || payload.output) ? 76 : 45,
      evidence: outputRisk.warnings.map((warning) => ({ label: warning, value: true })),
      tags: ["ai_gateway", "llm_output"],
    },
    {
      id: "gateway:runtime_state",
      source: "ai_gateway",
      category: "runtime",
      label: "Stato runtime",
      value: runtimeRisk(runtime),
      normalized_score: runtimeRisk(runtime),
      severity_hint: runtimeRisk(runtime),
      confidence_hint: 72,
      evidence: [{ label: "runtime_status", value: runtime.status || runtime.health || "unknown" }],
      tags: ["ai_gateway", "runtime"],
    },
    {
      id: "gateway:flow_pressure",
      source: "ai_gateway",
      category: "flow_pressure",
      label: "Pressione del flusso",
      value: flow,
      normalized_score: flow,
      severity_hint: flow,
      confidence_hint: 70,
      evidence: [{ label: "flow_pressure", value: flow }],
      tags: ["ai_gateway", "flowcore"],
    },
  ];

  if (policyWarnings.length) {
    signals.push({
      id: "gateway:tenant_policy_guardrail",
      source: "ai_gateway",
      category: "tenant_policy",
      label: "Violazione policy tenant nell'output LLM",
      value: 92,
      normalized_score: 92,
      severity_hint: 92,
      confidence_hint: 84,
      evidence: policyWarnings.map((warning) => ({ label: warning, value: true })),
      tags: ["ai_gateway", "tenant_policy", "content_guard"],
    });
  }

  if (selectedVariant) {
    signals.push({
      id: "gateway:variant_selection",
      source: "ai_gateway",
      category: "variant",
      label: `Variante candidata: ${selectedVariant.label}`,
      value: 100 - selectedVariant.score,
      normalized_score: 100 - selectedVariant.score,
      severity_hint: selectedVariant.risk,
      confidence_hint: selectedVariant.confidence,
      evidence: [{ label: "recommended_variant", value: selectedVariant.id }],
      tags: ["ai_gateway", "variant"],
    });
  }

  if (agnosticWorkflowRisk.triggered) {
    signals.push({
      id: "gateway:agnostic_workflow_guard",
      source: "ai_gateway",
      category: "workflow_guard",
      label: "Blocco agnostico workflow sensibile",
      value: 100,
      normalized_score: 100,
      severity_hint: 100,
      confidence_hint: 92,
      evidence: agnosticWorkflowRisk.hits.map((hit) => ({ label: hit.id, value: hit.category })),
      tags: ["ai_gateway", "workflow_guard", "blocked"],
    });
  }

  return {
    request_id: text(payload.request_id, `ai_gateway_${crypto.randomUUID()}`),
    generated_at: nowIso(),
    domain: text(payload.domain, `ai_gateway:${adapter}`),
    context: {
      tenant_id: tenantId,
      actor_id: text(payload.actor_id || roleScope.actor_id || context.actor_id) || undefined,
      plan: text(payload.plan || keyRecord?.metadata?.tier || context.plan) || undefined,
      locale: text(payload.locale || context.locale, "it"),
      metadata: {
        adapter,
        mode,
        action_type: action.type,
        publish_intent: action.publish_intent ? "true" : "false",
        role: text(roleScope.role || roleScope.actor_role),
        requested_scopes: arrayValue(roleScope.requested_scopes || payload.requested_scopes),
        source: "ai_gateway",
      },
    },
    signals,
    data_quality: {
      score: missingFields.length ? 62 : 82,
      missing_fields: missingFields,
    },
    constraints: {
      allow_automation: Boolean(
        payload.owner_confirmed === true &&
        mode === "execution_orchestration" &&
        hasScope(keyRecord, SCOPES.AUTOMATION_CODEX)
      ),
      require_confirmation: true,
      max_control_level: payload.owner_confirmed === true && mode === "execution_orchestration" ? "confirm" : "confirm",
      blocked_actions: arrayValue(payload.constraints?.blocked_actions),
      blocked_action_rules: [
        ...(Array.isArray(payload.constraints?.blocked_action_rules) ? payload.constraints.blocked_action_rules : []),
        ...(policyWarnings.length
          ? [{
              action_id: `policy:${tenantPolicy.tenant_id}:forbidden_claim`,
              reason_code: "tenant_forbidden_claim_detected",
              severity: 90,
              blocks_execution: mode === "hard-gating",
            }]
          : []),
        ...(sensitive && payload.owner_confirmed !== true
          ? [{
              action_id: `action:${action.type}`,
              reason_code: "sensitive_action_requires_owner_confirmation",
              severity: 80,
              blocks_execution: mode === "hard-gating",
            }]
          : []),
        ...(agnosticWorkflowRisk.triggered
          ? [{
              action_id: "policy:agnostic_workflow_guard",
              reason_code: "agnostic_sensitive_workflow_flag_detected",
              severity: 100,
              blocks_execution: true,
            }]
          : []),
      ],
      allowed_actions: arrayValue(payload.constraints?.allowed_actions),
      permissions: keyRecord?.allowed_scopes || [],
      safety_mode: true,
    },
  };
}

export function buildAiGatewayVerdict({
  payload = {},
  tenantId = "",
  keyRecord = null,
  coreOutput = {},
  adapterOverride = "",
}) {
  const adapter = normalizeAdapter(adapterOverride || payload.adapter || payload.client);
  const mode = normalizeMode(payload.mode || payload.gateway_mode);
  const action = requestedAction(payload);
  const tenantPolicy = getTenantPolicy(tenantId, payload.plan || keyRecord?.metadata?.tier);
  const policyWarnings = policyWarningsFromText(tenantPolicy, payload.llm_output || payload.output || "");
  const selectedVariant = rankGatewayVariants(payload.variants);
  const agnosticWorkflowRisk = detectAgnosticWorkflowRisk(payload);
  const contract = normalizeDecisionContract(coreOutput, {
    action_type: action.type,
    publish_intent: action.publish_intent,
    domain: `ai_gateway:${adapter}`,
  });
  const sensitive = action.sensitive || action.publish_intent || SENSITIVE_ACTIONS.has(action.type.toLowerCase());
  const executionAllowed = Boolean(
    mode === "execution_orchestration" &&
    payload.owner_confirmed === true &&
    contract.control_level !== "blocked" &&
    contract.state !== "blocked" &&
    hasScope(keyRecord, SCOPES.AUTOMATION_CODEX)
  );
  const requiresOwnerConfirmation = Boolean(
    sensitive ||
    mode === "hard-gating" ||
    mode === "execution_orchestration" ||
    contract.control_level === "confirm" ||
    contract.control_level === "blocked"
  );
  const outputRisk = riskFromText(payload.llm_output || payload.output || "");
  const warnings = [
    ...outputRisk.warnings,
    ...policyWarnings,
    ...agnosticWorkflowRisk.warnings,
    ...(contract.blocked_reasons || []),
    ...(requiresOwnerConfirmation && !payload.owner_confirmed ? ["owner_confirmation_required"] : []),
    ...(tenantPolicy.source === "default_policy" ? ["generic_tenant_policy_loaded"] : []),
  ];

  const forcedBlocked = agnosticWorkflowRisk.triggered;
  return {
    schema_version: AI_GATEWAY_SCHEMA_VERSION,
    tenant_id: tenantId,
    key_id: keyRecord?.key_id || null,
    adapter,
    mode,
    decision_state: forcedBlocked || contract.state === "blocked" ? "blocked" : contract.control_level === "confirm" ? "attention" : "ready",
    decision: forcedBlocked || contract.state === "blocked"
      ? "block"
      : contract.control_level === "confirm"
        ? "review"
        : "allow_advisory",
    risk: {
      band: forcedBlocked ? "high" : contract.risk_band,
      score: forcedBlocked ? Math.max(90, coreOutput.risk?.score ?? 0) : coreOutput.risk?.score ?? null,
      reasons: [...new Set(warnings)].slice(0, 30),
    },
    confidence: contract.confidence,
    warnings: [...new Set(warnings)].slice(0, 30),
    policyFlags: {
      readOnlyDefault: true,
      destructiveAutomation: false,
      ownerConfirmationForSensitiveActions: true,
      tenantPolicy: tenantPolicy.source,
      flowCoreAware: true,
      nyraInterpretationLayer: true,
      noOpenAICallInsideGateway: true,
      forbiddenClaimDetected: policyWarnings.length > 0,
      destructiveAction: outputRisk.warnings.some((warning) => warning.includes("delete") || warning.includes("reset --hard")),
      priceAnomaly: action.type.toLowerCase() === "pricing",
      agnosticWorkflowRisk: agnosticWorkflowRisk.triggered,
      agnosticWorkflowFlags: agnosticWorkflowRisk.hits.map((hit) => hit.id),
    },
    executionAllowed: forcedBlocked ? false : executionAllowed,
    recommendedVariant: selectedVariant
      ? { id: selectedVariant.id, label: selectedVariant.label, score: selectedVariant.score }
      : {
          id: mode === "rewrite" ? "rewrite_with_guardrails" : mode === "hard-gating" ? "gate_before_execution" : "advisory_only",
          label: mode === "rewrite" ? "Riscrivi entro guardrail Core" : mode === "hard-gating" ? "Blocca o richiedi owner" : "Spiega senza eseguire",
          score: null,
        },
    requiresOwnerConfirmation: forcedBlocked ? true : requiresOwnerConfirmation,
    final_output: text(payload.llm_output || payload.output || ""),
    audit_id: `audit_${crypto.randomUUID()}`,
    decision_contract: contract,
    tenant_policy: tenantPolicy,
    core_output: coreOutput,
    adapter_instruction: adapterInstruction(adapter, mode, executionAllowed),
  };
}

function adapterInstruction(adapter, mode, executionAllowed) {
  const common = "Inviare sempre richiesta e output LLM al Core prima di pubblicare, sincronizzare, modificare stato o avviare automazioni.";
  const perAdapter = {
    codex: "Codex puo proporre patch e comandi, ma applica solo entro verdict Core e conferma owner.",
    site_suite: "Site Suite mostra verdict, warning e prossima azione; non duplica la decisione.",
    smart_desk: "Smart Desk usa il verdict per abilitare preview, assistenza o conferma operatore.",
    skinharmony_core: "Core Admin governa key, tenant, audit e policy; non bypassa il Gateway.",
    chatgpt: "ChatGPT usa Core come decision layer, poi spiega o riscrive senza eseguire.",
    generic: "Il client usa Core come action gate e resta read-only di default.",
  };
  return {
    common,
    adapter: perAdapter[adapter] || perAdapter.generic,
    mode,
    execution: executionAllowed ? "execution_allowed_after_owner_confirmation" : "no_execution_from_gateway",
  };
}

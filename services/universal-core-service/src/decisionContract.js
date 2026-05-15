export const DECISION_CONTRACT_VERSION = "core_decision_contract_v1";

const SENSITIVE_ACTION_TYPES = new Set([
  "publish",
  "approve",
  "change_state",
  "pricing",
  "claim_validation",
  "workflow_decision",
  "sync",
  "send",
  "delete",
  "write",
  "deploy",
  "update",
  "codex_automation",
]);

function normalizeArray(value, max = 20) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => String(item || "").trim()).filter(Boolean);
}

function hasSensitiveActionType(actionType) {
  if (Array.isArray(actionType)) {
    return actionType.map((item) => String(item || "").toLowerCase()).some((item) => SENSITIVE_ACTION_TYPES.has(item));
  }
  return SENSITIVE_ACTION_TYPES.has(String(actionType || "").toLowerCase());
}

function riskBandFromCore(coreOutput = {}) {
  const band = String(coreOutput.risk?.band || "").toLowerCase();
  if (band === "blocked" || band === "high" || band === "medium" || band === "low") {
    return band === "blocked" ? "high" : band;
  }
  const score = Number(coreOutput.risk?.score ?? 0);
  if (score >= 65) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export function normalizeDecisionContract(coreOutput = {}, options = {}) {
  const actionType = options.action_type || options.action_types || options.domain;
  const sensitive = hasSensitiveActionType(actionType);
  const coreState = String(coreOutput.state || "observe");
  const riskBand = riskBandFromCore(coreOutput);
  const control = String(coreOutput.control_level || "observe");
  const blockedReasons = [
    ...normalizeArray(coreOutput.blocked_reasons),
    ...normalizeArray(coreOutput.risk?.reasons),
    ...normalizeArray(options.blocked_reasons),
  ];
  const actionBlocked = Array.isArray(coreOutput.recommended_actions)
    ? coreOutput.recommended_actions.some((action) => action.blocked === true || action.control_level === "blocked")
    : false;

  let state = "ready";
  if (coreState === "blocked" || control === "blocked" || actionBlocked || riskBand === "high") {
    state = "blocked";
  } else if (coreState === "attention" || coreState === "critical" || coreState === "protection" || riskBand === "medium") {
    state = "attention";
  } else if (coreState === "observe") {
    state = "observe";
  }

  let controlLevel = "observe";
  if (state === "blocked") {
    controlLevel = "blocked";
  } else if (sensitive || control === "confirm" || control === "execute_allowed") {
    controlLevel = "confirm";
  }

  const publishSafe = Boolean(
    state === "ready" &&
      controlLevel !== "blocked" &&
      riskBand === "low" &&
      !sensitive &&
      options.publish_intent !== true,
  );

  return {
    contract_version: DECISION_CONTRACT_VERSION,
    state,
    confidence: Math.round(Number(coreOutput.confidence ?? 0)),
    risk_band: riskBand,
    control_level: controlLevel,
    publish_safe: publishSafe,
    recommended_actions: Array.isArray(coreOutput.recommended_actions)
      ? coreOutput.recommended_actions.slice(0, 5).map((action) => ({
          id: String(action.id || ""),
          label: String(action.label || ""),
          reason: String(action.reason || ""),
          control_level: action.blocked ? "blocked" : controlLevel,
          blocked: Boolean(action.blocked || controlLevel === "blocked"),
        }))
      : [],
    blocked_reasons: [...new Set(blockedReasons)],
    source: "universal_core",
    rule: "OpenAI genera. Universal Core decide. Nyra spiega. I client eseguono solo entro i limiti del Core.",
  };
}

export function buildCodexGuardResponse({
  tenantId,
  keyRecord,
  coreOutput,
  branchContext = null,
  requestedBranches = [],
  task = "",
  actionType = "codex_automation",
}) {
  const contract = normalizeDecisionContract(coreOutput, {
    action_type: actionType,
    domain: "codex",
    publish_intent: String(actionType).toLowerCase() === "publish",
  });

  const selectedBranches = Array.isArray(branchContext?.selected_branches) ? branchContext.selected_branches : [];
  const deniedBranches = Array.isArray(branchContext?.denied_branches) ? branchContext.denied_branches : [];
  const branchMode = selectedBranches.length ? "specialized_branches" : "generic_core_guard";

  return {
    tenant_id: tenantId,
    key_id: keyRecord?.key_id || null,
    task: String(task || ""),
    codex_guard: {
      mode: branchMode,
      branch_required: false,
      selected_branches: selectedBranches,
      denied_branches: deniedBranches,
      requested_branches: normalizeArray(requestedBranches, 50),
      can_use_codex: contract.control_level !== "blocked",
      can_execute_without_owner: false,
      owner_confirmation_required: contract.control_level !== "observe",
      openai_call_executed: false,
      instruction: "Codex deve usare il decision_contract come fonte primaria prima di proporre, modificare, pubblicare o automatizzare.",
    },
    decision_contract: contract,
    branch_context: branchContext,
    core_output: coreOutput,
  };
}

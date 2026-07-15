const HIGH_CONFIRM_PATTERNS = [
  /\bdeploy(?:ment)?\b/i,
  /\bpublish(?:ing)?\b|\bpubblic(?:a|are|azione)\b/i,
  /\bpric(?:e|ing)\b|\bprezz[oi]\b/i,
  /\blicen[cs]e\b|\blicenz[ae]\b/i,
  /\bclaim\b/i,
  /\bpermission\b|\bpermess[oi]\b/i,
];

function textOf(body = {}) {
  return [
    body.action_type,
    body.action_label,
    body.operation_class,
    body.task,
    body.request,
    body.action?.type,
    body.action?.label,
  ].map((value) => String(value || "").toLowerCase().replace(/[_-]+/g, " ")).join(" ");
}

function profile({
  classification,
  operationClass,
  state,
  riskBand,
  riskScore,
  controlLevel,
  confirmationRequired,
  hardBlock = false,
  governanceVerdict,
  reasonCodes = [],
}) {
  const verdict = governanceVerdict || (hardBlock
    ? "BLOCK"
    : controlLevel === "confirm"
      ? "CONFIRM"
      : state === "ready" || controlLevel === "observe"
        ? "ALLOW"
        : "DEFER");
  return Object.freeze({
    schema_version: "core_action_risk_v1",
    classification,
    operation_class: operationClass,
    state,
    risk_band: riskBand,
    risk_score: riskScore,
    control_level: controlLevel,
    confirmation_required: confirmationRequired,
    hard_block: hardBlock,
    governance_verdict: verdict,
    reason_codes: Object.freeze([...new Set(reasonCodes)]),
  });
}

export function classifyActionRisk(body = {}) {
  const text = textOf(body);
  const secretExposure = body.contains_secret === true ||
    /\b(expose|show|display|print|mostra|stampa|rivela)\b.*\b(secret|token|password|credential|api[_ -]?key|chiave)\b/i.test(text) ||
    /\bsuite pay key\b/i.test(text);
  if (secretExposure) {
    return profile({
      classification: "secret_exposure",
      operationClass: "forbidden_sensitive_action",
      state: "blocked",
      riskBand: "high",
      riskScore: 100,
      controlLevel: "blocked",
      confirmationRequired: false,
      hardBlock: true,
      reasonCodes: ["secret_exposure"],
    });
  }

  const crossTenant = body.cross_tenant === true || /\bcross[_ -]?tenant\b|\b(other|different|altro|differente) tenant\b/i.test(text);
  if (crossTenant) {
    return profile({
      classification: "cross_tenant_access",
      operationClass: "forbidden_cross_tenant_action",
      state: "blocked",
      riskBand: "high",
      riskScore: 100,
      controlLevel: "blocked",
      confirmationRequired: false,
      hardBlock: true,
      reasonCodes: ["cross_tenant_denied"],
    });
  }

  const bypass = body.bypass_orchestrator === true || /\b(bypass|aggira|saltare)\b|\bdirettamente\b.*\bcodex\b/i.test(text);
  if (bypass) {
    return profile({
      classification: "orchestrator_bypass",
      operationClass: "forbidden_orchestrator_bypass",
      state: "blocked",
      riskBand: "high",
      riskScore: 95,
      controlLevel: "blocked",
      confirmationRequired: false,
      hardBlock: true,
      reasonCodes: ["orchestrator_bypass_denied"],
    });
  }

  const operationClass = String(body.operation_class || "").toLowerCase();
  const actionType = String(body.action_type || body.action?.type || "").toLowerCase();
  const learningOperation = ["learning_update", "learning_consolidation", "outcome_record", "verified_outcome_record"].includes(operationClass) ||
    ["learning_update", "learning_consolidation", "outcome_record", "verified_outcome_record", "activate_unverified_learning"].includes(actionType);
  const explicitlyUnverified = body.verified_outcome === false;
  const unverifiedLearning = (learningOperation && explicitlyUnverified) ||
    /\b(unverified learning|apprend(?:imento|ere).{0,24}non verific|without verified outcome)\b/i.test(text);
  if (unverifiedLearning) {
    return profile({
      classification: "unverified_learning",
      operationClass: "forbidden_unverified_learning",
      state: "blocked",
      riskBand: "high",
      riskScore: 90,
      controlLevel: "blocked",
      confirmationRequired: false,
      hardBlock: true,
      reasonCodes: ["unverified_learning_denied"],
    });
  }

  const destructive = body.destructive === true || /\b(delete|drop|truncate|erase|destroy|cancell|elimin|irrevers)\w*/i.test(text);
  if (destructive && body.rollback_ready !== true) {
    return profile({
      classification: "destructive_without_rollback",
      operationClass: "forbidden_destructive_action",
      state: "blocked",
      riskBand: "high",
      riskScore: 95,
      controlLevel: "blocked",
      confirmationRequired: false,
      hardBlock: true,
      reasonCodes: ["destructive_without_rollback"],
    });
  }

  if (
    body.operation_class === "reversible_internal_collaboration_write" &&
    body.external_side_effect === false &&
    body.contains_customer_data === false &&
    body.rollback_ready === true
  ) {
    return profile({
      classification: "reversible_internal_write",
      operationClass: "reversible_internal_collaboration_write",
      state: "attention",
      riskBand: "low",
      riskScore: 25,
      controlLevel: "confirm",
      confirmationRequired: true,
      reasonCodes: ["owner_confirmation_required"],
    });
  }

  const highConfirm = destructive || HIGH_CONFIRM_PATTERNS.some((pattern) => pattern.test(text)) ||
    body.external_side_effect === true || body.configuration_changes === true;
  if (highConfirm) {
    return profile({
      classification: destructive ? "reversible_destructive_change" : "high_impact_change",
      operationClass: body.operation_class || (/(deploy)/i.test(text) ? "reversible_owner_confirmed_deploy" : "owner_confirmed_high_impact"),
      state: "attention",
      riskBand: "high",
      riskScore: 80,
      controlLevel: "confirm",
      confirmationRequired: true,
      reasonCodes: ["owner_confirmation_required"],
    });
  }

  const safeRead = body.read_only === true ||
    (/\b(read|list|get|status|health|audit|preview|inspect|leggi|elenca|stato|anteprima)\w*/i.test(text) &&
      body.external_side_effect !== true && body.configuration_changes !== true);
  if (safeRead) {
    return profile({
      classification: "tenant_scoped_read",
      operationClass: "tenant_scoped_read",
      state: "ready",
      riskBand: "low",
      riskScore: 10,
      controlLevel: "observe",
      confirmationRequired: false,
      reasonCodes: ["tenant_scoped_read"],
    });
  }

  const sandboxed = body.dry_run === true || /\b(analy[sz]e|analizz|test|verify|verifica|prepare|prepara|patch|plan|piano)\w*/i.test(text);
  if (sandboxed && body.external_side_effect !== true) {
    return profile({
      classification: "sandboxed_scoped_work",
      operationClass: "sandboxed_scoped_work",
      state: "ready",
      riskBand: "low",
      riskScore: 20,
      controlLevel: "observe",
      confirmationRequired: false,
      reasonCodes: ["sandboxed_scope_only"],
    });
  }

  return profile({
    classification: "governed_action",
    operationClass: body.operation_class || "evaluation_only",
    state: "attention",
    riskBand: "medium",
    riskScore: 50,
    controlLevel: "confirm",
    confirmationRequired: true,
    governanceVerdict: "DEFER",
    reasonCodes: ["insufficient_action_context"],
  });
}

export function applyActionRiskProfile(decisionContract = {}, riskProfile = {}) {
  const hardBlock = riskProfile.hard_block === true;
  const state = hardBlock ? "blocked" : riskProfile.state || decisionContract.state;
  const controlLevel = hardBlock ? "blocked" : riskProfile.control_level || decisionContract.control_level;
  const reasons = [...new Set([
    ...(Array.isArray(decisionContract.blocked_reasons) ? decisionContract.blocked_reasons.filter((reason) => reason !== "safety_mode") : []),
    ...(Array.isArray(riskProfile.reason_codes) ? riskProfile.reason_codes : []),
  ])];
  return {
    ...decisionContract,
    state,
    risk_band: riskProfile.risk_band || decisionContract.risk_band,
    control_level: controlLevel,
    publish_safe: false,
    recommended_actions: Array.isArray(decisionContract.recommended_actions)
      ? decisionContract.recommended_actions.map((action) => ({
          ...action,
          control_level: controlLevel,
          blocked: hardBlock,
        }))
      : [],
    blocked_reasons: reasons,
    risk_classification: riskProfile,
    governance_verdict: riskProfile.governance_verdict || "DEFER",
  };
}

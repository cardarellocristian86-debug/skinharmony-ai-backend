import { isBoundedInternalCoordinationWrite } from "./boundedInternalCoordination.js";

const HIGH_CONFIRM_PATTERNS = [
  /\bdeploy(?:ment)?\b/i,
  /\bpublish(?:ing)?\b|\bpubblic(?:a|are|azione)\b/i,
  /\bpric(?:e|ing)\b|\bprezz[oi]\b/i,
  /\blicen[cs]e\b|\blicenz[ae]\b/i,
  /\bclaim\b/i,
  /\bpermission\b|\bpermess[oi]\b/i,
];

function intentTextOf(body = {}) {
  return [
    body.action_type,
    body.operation_class,
    body.action?.type,
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
  // Security classification must use structured intent only. Human-readable
  // labels often describe a blocked condition (for example while fixing it)
  // and must not accidentally become the condition being classified.
  const text = intentTextOf(body);
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
  const legalViolation = body.legal_violation === true || actionType === "perform_illegal_action";
  if (legalViolation) {
    return profile({
      classification: "legal_violation",
      operationClass: "forbidden_legal_action",
      state: "blocked",
      riskBand: "high",
      riskScore: 100,
      controlLevel: "blocked",
      confirmationRequired: false,
      hardBlock: true,
      reasonCodes: ["legal_violation_denied"],
    });
  }

  const missingTargetAuthority = body.target_authority_verified === false ||
    body.actor_authorized_for_target === false;
  if (missingTargetAuthority) {
    return profile({
      classification: "missing_target_authority",
      operationClass: "forbidden_unauthorized_target_action",
      state: "blocked",
      riskBand: "high",
      riskScore: 100,
      controlLevel: "blocked",
      confirmationRequired: false,
      hardBlock: true,
      reasonCodes: ["target_authority_required"],
    });
  }

  const learningOperation = ["learning_update", "learning_consolidation", "outcome_record", "verified_outcome_record"].includes(operationClass) ||
    ["learning_update", "learning_consolidation", "outcome_record", "verified_outcome_record", "activate_unverified_learning"].includes(actionType);
  const falseVerifiedOutcomeWrite = ["outcome_record", "verified_outcome_record"].includes(operationClass) &&
    body.verified_outcome !== true;
  if (falseVerifiedOutcomeWrite) {
    return profile({
      classification: "false_verified_outcome_write",
      operationClass: "forbidden_false_verified_outcome_write",
      state: "blocked",
      riskBand: "high",
      riskScore: 100,
      controlLevel: "blocked",
      confirmationRequired: false,
      hardBlock: true,
      reasonCodes: ["verified_outcome_integrity_required"],
    });
  }

  const unverifiedLearning = learningOperation && body.verified_outcome !== true;
  if (unverifiedLearning) {
    return profile({
      classification: "unverified_learning_change",
      operationClass: "owner_confirmed_unverified_learning_change",
      state: "attention",
      riskBand: "high",
      riskScore: 90,
      controlLevel: "confirm",
      confirmationRequired: true,
      reasonCodes: [
        "owner_confirmation_required",
        "unverified_learning_requires_explicit_confirmation",
        "rollback_and_audit_required",
      ],
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

  if (operationClass === "reversible_owner_confirmed_connector_metadata_refresh") {
    return profile({
      classification: "connector_metadata_refresh",
      operationClass,
      state: "attention",
      riskBand: "high",
      riskScore: 70,
      controlLevel: "confirm",
      confirmationRequired: true,
      reasonCodes: ["owner_confirmation_required", "metadata_refresh_target_binding_required"],
    });
  }

  if (operationClass === "reversible_owner_confirmed_core_connector_key_rotation") {
    return profile({
      classification: "core_connector_key_rotation",
      operationClass,
      state: "attention",
      riskBand: "high",
      riskScore: 85,
      controlLevel: "confirm",
      confirmationRequired: true,
      reasonCodes: ["owner_confirmation_required", "least_privilege_scope_rotation"],
    });
  }

  if (operationClass === "reversible_owner_confirmed_core_admin_bootstrap_configuration") {
    return profile({
      classification: "core_admin_bootstrap_configuration",
      operationClass,
      state: "attention",
      riskBand: "high",
      riskScore: 85,
      controlLevel: "confirm",
      confirmationRequired: true,
      reasonCodes: [
        "owner_confirmation_required",
        "request_bound_owner_proof_required",
        "exact_render_environment_bundle_required",
        "secret_values_outside_core_envelope",
      ],
    });
  }

  if (operationClass === "reversible_owner_confirmed_mcp_default_tenant_correction") {
    return profile({
      classification: "mcp_default_tenant_correction",
      operationClass,
      state: "attention",
      riskBand: "high",
      riskScore: 80,
      controlLevel: "confirm",
      confirmationRequired: true,
      reasonCodes: [
        "owner_confirmation_required",
        "request_bound_owner_proof_required",
        "exact_tenant_binding_correction",
        "production_configuration_change",
      ],
    });
  }

  if (operationClass === "verified_outcome_record") {
    return profile({
      classification: "verified_outcome_record",
      operationClass,
      state: "attention",
      riskBand: "low",
      riskScore: 30,
      controlLevel: "confirm",
      confirmationRequired: true,
      reasonCodes: ["owner_confirmation_required", "verified_outcome_required"],
    });
  }

  if (isBoundedInternalCoordinationWrite(body)) {
    return profile({
      classification: "bounded_internal_coordination_write",
      operationClass: "bounded_internal_coordination_write",
      state: "ready",
      riskBand: "low",
      riskScore: 15,
      controlLevel: "observe",
      confirmationRequired: false,
      reasonCodes: ["tenant_scoped", "bounded_scope", "low_impact", "audited", "actor_authorized"],
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

  const effectFree = body.external_side_effect !== true &&
    body.configuration_changes !== true &&
    body.destructive !== true &&
    body.cross_tenant !== true &&
    body.contains_secret !== true;
  const safeRead = effectFree && (
    body.read_only === true ||
    /\b(read|list|get|status|health|audit|preview|inspect|leggi|elenca|stato|anteprima)\w*/i.test(text)
  );
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

  const sandboxed = effectFree && (
    body.dry_run === true ||
    /\b(analy[sz]e|analizz|test|verify|verifica|prepare|prepara|patch|plan|piano)\w*/i.test(text)
  );
  if (sandboxed) {
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
    operationClass: body.operation_class || "owner_confirmed_governed_action",
    state: "attention",
    riskBand: "medium",
    riskScore: 50,
    controlLevel: "confirm",
    confirmationRequired: true,
    governanceVerdict: "CONFIRM",
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

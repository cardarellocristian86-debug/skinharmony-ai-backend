const SENSITIVE_ACTIONS = new Set([
  "deploy",
  "release",
  "publish",
  "update",
  "write_production",
  "rollback",
  "migration",
  "pricing",
  "claim_validation",
  "payment",
  "customer_data",
  "tenant_scope_change",
  "cross_tenant",
  "codex_automation",
]);

const VISUAL_ACTIONS = new Set([
  "site_page_creation",
  "site_page_clone",
  "visual_design",
  "page_quality_audit",
]);

const WRITE_ACTIONS = new Set([
  "publish",
  "update",
  "write_production",
  "release",
  "rollback",
]);

const DEFAULT_BRANCH_MATRIX = {
  site_page_creation: ["site_creation", "visual_brand_guard", "marketing_copy", "claim_guard"],
  site_page_clone: ["site_creation", "visual_brand_guard", "cta_guard", "change_impact"],
  commercial_copy: ["marketing_copy", "claim_guard"],
  visual_design: ["visual_brand_guard"],
  cta_update: ["cta_guard"],
  pricing: ["pricing_guard", "claim_guard", "commercial_policy"],
  claim_validation: ["claim_guard", "sector_policy"],
  release: ["change_impact", "release_guard", "rollback_guard"],
  write_production: ["change_impact", "rollback_guard"],
  tenant_scope_change: ["tenant_isolation", "cross_tenant_guard", "change_impact"],
  codex_automation: ["action_mediation", "change_impact"],
  translator_localization: ["translator_guard", "claim_guard"],
  smartdesk_bridge: ["smartdesk_guard", "tenant_isolation", "action_mediation"],
};

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function getPath(input, path) {
  return path.split(".").reduce((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return current[key];
  }, input);
}

function requireField(input, path, errors, code = "missing_required_field") {
  if (!hasValue(getPath(input, path))) {
    errors.push({ code, field: path });
  }
}

function isSensitive(input) {
  return Boolean(input?.scope?.sensitive_action) || SENSITIVE_ACTIONS.has(input?.action_type);
}

function isVisual(input) {
  return Boolean(input?.scope?.visual_or_clone) || VISUAL_ACTIONS.has(input?.action_type);
}

function isWrite(input) {
  const environment = input?.target?.environment;
  return Boolean(input?.scope?.write_action) || WRITE_ACTIONS.has(input?.action_type) || environment === "production";
}

function validateCoreOff(input, errors, warnings) {
  if (!input?.core_off?.enabled) return;

  if (input?.target?.environment === "production") {
    errors.push({ code: "core_off_not_allowed_for_production", field: "core_off.enabled" });
  }

  if (input?.risk?.customer_data || input?.risk?.payment || input?.risk?.cross_tenant || input?.risk?.keys_or_admin) {
    errors.push({ code: "core_off_not_allowed_for_high_risk_scope", field: "core_off" });
  }

  requireField(input, "core_off.owner_id", errors);
  requireField(input, "core_off.reason", errors);
  requireField(input, "core_off.single_activity_scope", errors);
  requireField(input, "core_off.report_path", errors);
  warnings.push({ code: "core_off_used", message: "Core off is allowed only for this single documented local activity." });
}

function validateCore(input, errors) {
  if (!isSensitive(input) || input?.core_off?.enabled) return;

  requireField(input, "core.decision_id", errors);
  requireField(input, "core.audit_id", errors);

  if (getPath(input, "core.execution_allowed") !== true) {
    errors.push({ code: "core_execution_not_allowed", field: "core.execution_allowed" });
  }

  if (getPath(input, "core.requires_owner_confirmation") === true && !hasValue(getPath(input, "owner.owner_confirmation_id"))) {
    errors.push({ code: "missing_owner_confirmation", field: "owner.owner_confirmation_id" });
  }

  if (getPath(input, "core.decision") === "block") {
    errors.push({ code: "core_blocked", field: "core.decision" });
  }
}

function validateVisualEvidence(input, errors) {
  if (!isVisual(input)) return;

  requireField(input, "evidence.source_snapshot_id", errors);
  requireField(input, "evidence.design_snapshot_id", errors);
  requireField(input, "evidence.cta_map_id", errors);
  requireField(input, "evidence.visual_validation_report_id", errors);
  requireField(input, "evidence.business_scope", errors);

  if (getPath(input, "evidence.validation_status") === "block") {
    errors.push({ code: "visual_validation_blocked", field: "evidence.validation_status" });
  }
}

function validateWriteSafety(input, errors) {
  if (!isWrite(input)) return;

  requireField(input, "write_safety.backup_id", errors);
  requireField(input, "write_safety.diff_id", errors);
  requireField(input, "write_safety.rollback_plan_id", errors);
  requireField(input, "write_safety.write_safety_manifest_id", errors);

  if (getPath(input, "target.primary_only") !== true) {
    errors.push({ code: "target_not_single_primary", field: "target.primary_only" });
  }

  const scope = input?.write_safety?.scope || {};
  if (scope.cross_page || scope.cross_plugin || scope.cross_tenant) {
    errors.push({ code: "cross_scope_requires_separate_gate", field: "write_safety.scope" });
  }
}

function validateBranches(input, errors, warnings, branchMatrix = DEFAULT_BRANCH_MATRIX) {
  if (input?.core_off?.enabled && input?.target?.environment === "local") return;

  const required = input?.branches?.required || branchMatrix[input?.action_type] || [];
  if (!required.length) return;

  const results = input?.branches?.results || {};
  const liveOrProduction = ["staging", "production"].includes(input?.target?.environment);

  for (const branch of required) {
    const status = results[branch]?.status;
    if (!status) {
      errors.push({ code: "missing_required_core_branch", branch });
      continue;
    }
    if (status === "block") {
      errors.push({ code: "core_branch_blocked", branch });
    } else if (status === "review") {
      warnings.push({ code: "core_branch_review_required", branch });
    } else if (status === "unavailable") {
      const issue = { code: "core_branch_unavailable", branch };
      if (liveOrProduction) errors.push(issue);
      else warnings.push(issue);
    }
  }
}

function validateStoryline(input, errors) {
  const businessScope = input?.evidence?.business_scope || input?.scope?.business_scope;
  if (!businessScope) return;

  if (["vertical_suite", "mixed_ecosystem", "partner_distribution"].includes(businessScope)) {
    const filiera = input?.storyline?.filiera || {};
    const hasUpstream = Boolean(filiera.factory || filiera.brand || filiera.distributor || filiera.franchising || filiera.partner);
    const centerOnly = Boolean(filiera.center) && !hasUpstream;
    if (centerOnly) {
      errors.push({ code: "storyline_reduced_to_center_only", field: "storyline.filiera" });
    }
  }

  if (input?.storyline?.smartdesk_as_entire_ecosystem === true) {
    errors.push({ code: "smartdesk_cannot_be_entire_ecosystem", field: "storyline.smartdesk_as_entire_ecosystem" });
  }
}

function validateGovernanceRequest(input = {}, options = {}) {
  const errors = [];
  const warnings = [];

  requireField(input, "tenant_id", errors);
  requireField(input, "action_type", errors);
  requireField(input, "target.type", errors);
  requireField(input, "target.id", errors);
  requireField(input, "target.environment", errors);

  validateCoreOff(input, errors, warnings);
  validateCore(input, errors);
  validateVisualEvidence(input, errors);
  validateWriteSafety(input, errors);
  validateBranches(input, errors, warnings, options.branchMatrix);
  validateStoryline(input, errors);

  const allowed = errors.length === 0;
  const status = allowed ? (warnings.length ? "review" : "allow") : "block";
  return {
    schema: "suite_core_codex_governance_validation_v1",
    allowed,
    status,
    errors,
    warnings,
    required_contracts: [
      "SUITE_CORE_CODEX_ROLE_CONTRACT_V1",
      "SUITE_CORE_CODEX_VISUAL_CLONE_CONTRACT_V1",
      "SUITE_CORE_CODEX_CORE_BRANCH_CONTRACT_V1",
      "SUITE_CORE_CODEX_CTA_LINK_CONTRACT_V1",
      "SUITE_CORE_CODEX_VALIDATOR_VISUAL_EVIDENCE_CONTRACT_V1",
      "SUITE_CORE_CODEX_STORYLINE_SCOPE_CONTRACT_V1",
      "SUITE_CORE_CODEX_WRITE_SAFETY_CONTRACT_V1",
      "SUITE_CORE_CODEX_CONNECTOR_ENFORCEMENT_CONTRACT_V1",
    ],
  };
}

export {
  DEFAULT_BRANCH_MATRIX,
  SENSITIVE_ACTIONS,
  VISUAL_ACTIONS,
  WRITE_ACTIONS,
  validateGovernanceRequest,
};

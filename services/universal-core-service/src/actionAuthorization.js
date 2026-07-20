import {
  PROVIDER_SETUP_LINK_BINDING_ACTION_LABEL,
  PROVIDER_SETUP_LINK_BINDING_BLUEPRINT_ID,
  hasExactProviderSetupLinkBindingScope,
  hasOnlyProviderSetupLinkBindingFields,
  isProviderSetupLinkBindingAttempt,
} from "./providerSetupLinkBinding.js";

function cleanReference(value) {
  return String(value || "")
    .slice(0, 240)
    .replace(/\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]")
    .trim();
}

function isCleanReference(value) {
  const raw = String(value || "").slice(0, 240).trim();
  const cleaned = cleanReference(value);
  return raw.length > 0 && cleaned === raw && !cleaned.includes("[REDACTED_SECRET]");
}

export function buildActionAuthorization(decisionContract = {}, body = {}) {
  const ownerConfirmed = body.owner_confirmed === true;
  const exactCommit = /^[a-f0-9]{40}$/i.test(String(body.target_commit || ""));
  const tenantScopedRead =
    body.operation_class === "tenant_scoped_read" &&
    body.external_side_effect !== true &&
    body.contains_customer_data !== true &&
    body.cross_tenant !== true &&
    body.configuration_changes !== true;
  const sandboxedScopedWork =
    body.operation_class === "sandboxed_scoped_work" &&
    body.external_side_effect !== true &&
    body.contains_customer_data !== true &&
    body.cross_tenant !== true &&
    body.configuration_changes !== true;
  const reversibleDeploy =
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    String(body.action_type || "").toLowerCase() === "deploy" &&
    body.external_side_effect === true &&
    body.contains_customer_data === false &&
    body.cross_tenant === false &&
    body.rollback_ready === true &&
    body.audit_ready === true &&
    body.configuration_changes === false &&
    exactCommit &&
    cleanReference(body.confirmation_reference).length > 0;
  const stagingPostgresConfiguration =
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    String(body.action_type || "").toLowerCase() === "environment_configuration" &&
    body.external_side_effect === true && body.contains_customer_data === false && body.contains_secret === false &&
    body.cross_tenant === false && body.destructive === false && body.bypass_orchestrator === false &&
    body.rollback_ready === true && body.audit_ready === true && body.configuration_changes === true && exactCommit &&
    String(body.environment || "") === "staging" && String(body.target || "") === "skinharmony-mcp-staging-db" &&
    String(body.target_branch || "") === "agent/multiagent-postgres-cloud" &&
    String(body.resource_type || "") === "postgresql" && body.create_new === true &&
    body.reuse_existing_database === false && body.auth0_changes !== true && body.merge !== true &&
    body.production_deploy !== true && body.delete !== true &&
    cleanReference(body.confirmation_reference).length > 0;
  const stagingPostgresAttempt =
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    String(body.action_type || "").toLowerCase() === "environment_configuration";
  const nyraGovernancePostgresConfiguration =
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    String(body.action_type || "").toLowerCase() === "environment_configuration" &&
    body.external_side_effect === true && body.contains_customer_data === false && body.contains_secret === false &&
    body.cross_tenant === false && body.destructive === false && body.bypass_orchestrator === false &&
    body.rollback_ready === true && body.audit_ready === true && body.configuration_changes === true && exactCommit &&
    String(body.environment || "") === "production" && String(body.target || "") === "skinharmony-nyra-governance-db" &&
    String(body.target_service || "") === "skinharmony-universal-core" &&
    String(body.resource_type || "") === "postgresql" && body.create_new === true &&
    body.reuse_existing_database === false && body.database_public_access === false && body.allow_data_migration === false &&
    body.auth0_changes !== true && body.merge !== true && body.production_deploy !== true && body.delete !== true &&
    body.provider_execution === false && Array.isArray(body.allowed_environment_variables) &&
    body.allowed_environment_variables.length === 1 && body.allowed_environment_variables[0] === "GOVERNED_AGENT_DATABASE_URL" &&
    cleanReference(body.confirmation_reference).length > 0;
  const nyraGovernancePostgresAttempt =
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    String(body.action_type || "").toLowerCase() === "environment_configuration" &&
    String(body.target || "") === "skinharmony-nyra-governance-db";
  // This is deliberately a reference-only configuration operation. The secret
  // value is never part of the Core envelope, audit record or verdict: Render
  // receives it through its secret input after this exact gate allows the change.
  const tenantProviderVaultSecretConfiguration =
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    String(body.action_type || "").toLowerCase() === "environment_configuration" &&
    body.external_side_effect === true && body.contains_customer_data === false && body.contains_secret === false &&
    body.secret_value_transmitted === false && body.cross_tenant === false && body.destructive === false &&
    body.bypass_orchestrator === false && body.rollback_ready === true && body.audit_ready === true &&
    body.configuration_changes === true && exactCommit &&
    String(body.environment || "") === "production" && String(body.target_service || "") === "skinharmony-universal-core" &&
    String(body.resource_type || "") === "render_environment_secret_reference" &&
    body.create_new === false && body.rotate_existing === false && body.delete === false &&
    body.merge === false && body.production_deploy === false && body.provider_execution === false &&
    Array.isArray(body.allowed_environment_variables) && body.allowed_environment_variables.length === 1 &&
    body.allowed_environment_variables[0] === "GOVERNED_AGENT_KEY_ENCRYPTION_SECRET" &&
    cleanReference(body.confirmation_reference).length > 0;
  const tenantProviderVaultSecretAttempt =
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    String(body.action_type || "").toLowerCase() === "environment_configuration" &&
    String(body.target_service || "") === "skinharmony-universal-core" &&
    Array.isArray(body.allowed_environment_variables) &&
    body.allowed_environment_variables.includes("GOVERNED_AGENT_KEY_ENCRYPTION_SECRET");
  const connectorMetadataRefreshAttempt =
    body.operation_class === "reversible_owner_confirmed_connector_metadata_refresh" &&
    String(body.action_type || "").toLowerCase() === "chatgpt_app_metadata_refresh";
  const connectorMetadataRefresh =
    connectorMetadataRefreshAttempt &&
    body.external_side_effect === true && body.contains_customer_data === false && body.contains_secret === false &&
    body.secret_value_transmitted === false && body.cross_tenant === false && body.destructive === false &&
    body.bypass_orchestrator === false && body.configuration_changes === false && body.endpoint_changes === false &&
    body.oauth_changes === false && body.scope_changes === false && body.permission_changes === false &&
    body.tenant_binding_changes === false && body.rollback_ready === true && body.audit_ready === true && exactCommit &&
    String(body.target_client || "") === "chatgpt" && String(body.connector_id || "") === "skinharmony_core" &&
    String(body.configured_endpoint || "") === "https://skinharmony-core-mcp.onrender.com/mcp" &&
    String(body.refresh_endpoint || "") === String(body.configured_endpoint || "") &&
    String(body.target_tenant_id || "").length > 0 &&
    String(body.target_tenant_id || "") === String(body.authenticated_tenant_id || "") &&
    body.metadata_refresh_only === true && Number.isInteger(body.expected_tool_count) && body.expected_tool_count > 0 &&
    Number.isInteger(body.installed_tool_count_before) && body.installed_tool_count_before >= 0 &&
    body.create_app === false && body.delete_app === false && body.reconnect === false && body.deploy === false &&
    body.merge === false && body.confirmation_connector_id === body.connector_id &&
    body.confirmation_endpoint === body.configured_endpoint &&
    String(body.confirmation_target_commit || "").toLowerCase() === String(body.target_commit || "").toLowerCase() &&
    body.confirmation_expected_tool_count === body.expected_tool_count &&
    body.confirmation_target_tenant_id === body.target_tenant_id && isCleanReference(body.confirmation_reference);
  // This authorizes only the reference rotation. Secret values are generated by
  // Core and sent directly to Render outside the decision envelope and audit.
  const connectorKeyRotationAttempt =
    body.operation_class === "reversible_owner_confirmed_core_connector_key_rotation" &&
    String(body.action_type || "").toLowerCase() === "render_core_connector_key_rotation";
  const connectorKeyRotation =
    connectorKeyRotationAttempt &&
    body.external_side_effect === true && body.contains_customer_data === false && body.contains_secret === false &&
    body.secret_value_transmitted === false && body.cross_tenant === false && body.destructive === false &&
    body.bypass_orchestrator === false && body.configuration_changes === true && body.endpoint_changes === false &&
    body.oauth_changes === false && body.scope_changes === true && body.permission_changes === true &&
    body.tenant_binding_changes === false && body.rollback_ready === true && body.audit_ready === true && exactCommit &&
    String(body.environment || "") === "production" && String(body.source_service || "") === "skinharmony-universal-core" &&
    String(body.target_service || "") === "skinharmony-core-mcp" &&
    String(body.target_environment_variable || "") === "CORE_MCP_KEY" &&
    String(body.resource_type || "") === "render_environment_secret_reference" &&
    String(body.target_tenant_id || "").length > 0 &&
    String(body.target_tenant_id || "") === String(body.authenticated_tenant_id || "") &&
    /^key_[0-9a-f-]{36}$/i.test(String(body.current_key_id || "")) &&
    String(body.target_scope || "") === "write:intelligence_outcome" &&
    String(body.owner_assertion_scope || "") === "owner:assertion" && Array.isArray(body.allowed_scope_changes) &&
    body.allowed_scope_changes.length === 2 && body.allowed_scope_changes.includes("write:intelligence_outcome") &&
    body.allowed_scope_changes.includes("owner:assertion") &&
    body.create_new_key === true && body.replace_secret_reference === true && body.revoke_old_key === false &&
    body.provider_execution === false && body.service_restart_required === true && body.deploy === true &&
    body.merge === false && body.delete === false && body.confirmation_current_key_id === body.current_key_id &&
    body.confirmation_target_scope === body.target_scope &&
    body.confirmation_owner_assertion_scope === body.owner_assertion_scope &&
    body.confirmation_target_service === body.target_service &&
    body.confirmation_target_tenant_id === body.target_tenant_id &&
    String(body.confirmation_target_commit || "").toLowerCase() === String(body.target_commit || "").toLowerCase() &&
    isCleanReference(body.confirmation_reference);
  const verifiedOutcomeRecordAttempt =
    body.operation_class === "verified_outcome_record" &&
    String(body.action_type || "").toLowerCase() === "outcome_record";
  const verifiedOutcomeRecord =
    verifiedOutcomeRecordAttempt &&
    body.external_side_effect === false && body.contains_customer_data === false && body.contains_secret === false &&
    body.secret_value_transmitted === false && body.cross_tenant === false && body.destructive === false &&
    body.bypass_orchestrator === false && body.configuration_changes === false && body.rollback_ready === true &&
    body.audit_ready === true && body.verified_outcome === true && body.live_weight_mutation === false &&
    String(body.target_tenant_id || "").length > 0 &&
    String(body.target_tenant_id || "") === String(body.authenticated_tenant_id || "") &&
    /^[^\u0000-\u001f\u007f]{1,120}$/u.test(String(body.outcome_id || "")) &&
    Number.isFinite(Number(body.predicted_probability)) && Number(body.predicted_probability) >= 0 &&
    Number(body.predicted_probability) <= 1 && [true, false, 0, 1, "occurred", "not_occurred"].includes(body.actual_outcome) &&
    body.confirmation_outcome_id === body.outcome_id &&
    body.confirmation_target_tenant_id === body.target_tenant_id && isCleanReference(body.confirmation_reference);
  // This is deliberately limited to the internal, Render-managed reference
  // which lets Universal Core validate a one-time setup link issued by the
  // MCP service. No secret value is present in the envelope: Render copies the
  // existing source variable internally. It cannot create a provider, enable
  // provider execution, alter Auth0, or target another tenant or service.
  const providerSetupLinkBlueprintBinding =
    isProviderSetupLinkBindingAttempt(body) &&
    hasExactProviderSetupLinkBindingScope(body) &&
    String(body.action_label || "") === PROVIDER_SETUP_LINK_BINDING_ACTION_LABEL &&
    String(body.authenticated_tenant_id || "") === "codexai" && String(body.tenant_id || "") === "codexai" &&
    body.external_side_effect === true && body.contains_customer_data === false && body.contains_secret === false &&
    body.secret_value_transmitted === false && body.cross_tenant === false && body.destructive === false &&
    body.bypass_orchestrator === false && body.rollback_ready === true && body.audit_ready === true &&
    body.configuration_changes === true && exactCommit &&
    ownerConfirmed === true &&
    body.owner_context_verified === true && body.owner_context_approval_bound === true &&
    String(body.environment || "") === "production" && String(body.target_branch || "") === "main" &&
    String(body.resource_type || "") === "render_blueprint_from_service_env_binding" &&
    String(body.render_blueprint_id || "") === PROVIDER_SETUP_LINK_BINDING_BLUEPRINT_ID &&
    String(body.blueprint_path || "") === "render-universal-core.yaml" &&
    String(body.source_service || "") === "skinharmony-core-mcp" &&
    String(body.target_service || "") === "skinharmony-universal-core" &&
    String(body.source_environment_variable || "") === "CORE_PROVIDER_SETUP_LINK_KEY" &&
    String(body.target_environment_variable || "") === "CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY" &&
    String(body.tenant_environment_variable || "") === "CORE_PROVIDER_SETUP_LINK_TENANT_ID" &&
    String(body.tenant_environment_value || "") === "codexai" &&
    body.create_new === false && body.rotate_existing === false && body.delete === false &&
    body.merge === false && body.production_deploy === false && body.deploy === false && body.auth0_changes === false &&
    body.provider_execution === false && body.execution_enabled === false && body.force === false && body.admin_bypass === false &&
    Array.isArray(body.allowed_environment_variables) && body.allowed_environment_variables.length === 2 &&
    body.allowed_environment_variables[0] === "CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY" &&
    body.allowed_environment_variables[1] === "CORE_PROVIDER_SETUP_LINK_TENANT_ID" &&
    String(body.confirmation_target_commit || "").toLowerCase() === String(body.target_commit || "").toLowerCase() &&
    String(body.confirmation_target_branch || "") === "main" &&
    String(body.confirmation_render_blueprint_id || "") === PROVIDER_SETUP_LINK_BINDING_BLUEPRINT_ID &&
    String(body.confirmation_blueprint_path || "") === "render-universal-core.yaml" &&
    String(body.confirmation_source_service || "") === "skinharmony-core-mcp" &&
    String(body.confirmation_target_service || "") === "skinharmony-universal-core" &&
    String(body.confirmation_source_environment_variable || "") === "CORE_PROVIDER_SETUP_LINK_KEY" &&
    String(body.confirmation_target_environment_variable || "") === "CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY" &&
    String(body.confirmation_tenant_id || "") === "codexai" &&
    isCleanReference(body.confirmation_reference);
  const providerSetupLinkBlueprintBindingAttempt =
    isProviderSetupLinkBindingAttempt(body);
  const reversibleInternalWrite =
    body.operation_class === "reversible_internal_collaboration_write" &&
    body.external_side_effect === false &&
    body.contains_customer_data === false &&
    body.rollback_ready === true;
  const reversibleBranchChange =
    body.operation_class === "reversible_owner_confirmed_branch_change" &&
    String(body.action_type || "").toLowerCase() === "repository_file_update" &&
    body.external_side_effect === true &&
    body.contains_customer_data === false &&
    body.contains_secret === false &&
    body.cross_tenant === false &&
    body.destructive === false &&
    body.bypass_orchestrator === false &&
    body.configuration_changes === false &&
    body.rollback_ready === true &&
    body.audit_ready === true &&
    exactCommit &&
    /^agent\/[a-z0-9._/-]+$/i.test(String(body.target_branch || "")) &&
    cleanReference(body.confirmation_reference).length > 0;
  const reversibleDraftPullRequest =
    body.operation_class === "reversible_owner_confirmed_draft_pull_request" &&
    String(body.action_type || "").toLowerCase() === "github_draft_pull_request" &&
    body.external_side_effect === true &&
    body.contains_customer_data === false &&
    body.contains_secret === false &&
    body.cross_tenant === false &&
    body.destructive === false &&
    body.bypass_orchestrator === false &&
    body.configuration_changes === false &&
    body.rollback_ready === true &&
    body.audit_ready === true &&
    exactCommit &&
    /^agent\/[a-z0-9._/-]+$/i.test(String(body.target_branch || "")) &&
    String(body.base_branch || "") === "main" &&
    body.draft === true &&
    body.merge === false &&
    body.deploy === false &&
    body.delete === false &&
    /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(String(body.repository || "")) &&
    cleanReference(body.confirmation_reference).length > 0;
  const draftPullRequestAttempt =
    body.operation_class === "reversible_owner_confirmed_draft_pull_request" &&
    String(body.action_type || "").toLowerCase() === "github_draft_pull_request";
  // A merge changes the protected base branch, so it is intentionally a
  // different capability from creating a draft PR. Every field below binds the
  // confirmation to the reviewed head, exact commit, protected destination and
  // verification evidence. Callers cannot turn this into a deploy, delete,
  // force-push or an administrator-bypass operation.
  const reversiblePullRequestMerge =
    body.operation_class === "reversible_owner_confirmed_pull_request_merge" &&
    String(body.action_type || "").toLowerCase() === "github_pull_request_merge" &&
    body.external_side_effect === true &&
    body.contains_customer_data === false &&
    body.contains_secret === false &&
    body.cross_tenant === false &&
    body.destructive === false &&
    body.bypass_orchestrator === false &&
    body.configuration_changes === false &&
    body.rollback_ready === true &&
    body.audit_ready === true &&
    exactCommit &&
    Number.isInteger(body.pull_request) && body.pull_request > 0 &&
    /^agent\/[a-z0-9._/-]+$/i.test(String(body.target_branch || "")) &&
    String(body.base_branch || "") === "main" &&
    /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(String(body.repository || "")) &&
    body.draft === false &&
    body.merge === true &&
    body.deploy === false &&
    body.delete === false &&
    body.force === false &&
    body.admin_bypass === false &&
    ["merge", "squash", "rebase"].includes(String(body.merge_method || "")) &&
    body.checks_verified === true &&
    String(body.checks_commit || "").toLowerCase() === String(body.target_commit || "").toLowerCase() &&
    Number.isInteger(body.confirmation_pull_request) && body.confirmation_pull_request === body.pull_request &&
    String(body.confirmation_target_commit || "").toLowerCase() === String(body.target_commit || "").toLowerCase() &&
    String(body.confirmation_target_branch || "") === String(body.target_branch || "") &&
    String(body.confirmation_base_branch || "") === String(body.base_branch || "") &&
    String(body.confirmation_repository || "") === String(body.repository || "") &&
    cleanReference(body.confirmation_reference).length > 0;
  const pullRequestMergeAttempt =
    body.operation_class === "reversible_owner_confirmed_pull_request_merge" &&
    String(body.action_type || "").toLowerCase() === "github_pull_request_merge";
  const reversiblePullRequestReady =
    body.operation_class === "reversible_owner_confirmed_pull_request_review_transition" &&
    String(body.action_type || "").toLowerCase() === "github_pull_request_ready_for_review" &&
    body.external_side_effect === true &&
    body.contains_customer_data === false && body.contains_secret === false && body.cross_tenant === false &&
    body.destructive === false && body.bypass_orchestrator === false && body.configuration_changes === false &&
    body.rollback_ready === true && body.audit_ready === true && exactCommit &&
    Number.isInteger(body.pull_request) && body.pull_request > 0 &&
    /^agent\/[a-z0-9._/-]+$/i.test(String(body.target_branch || "")) &&
    String(body.base_branch || "") === "main" &&
    /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(String(body.repository || "")) &&
    body.draft === true && body.ready_for_review === true && body.merge === false && body.deploy === false &&
    body.delete === false && body.force === false && body.admin_bypass === false &&
    Number.isInteger(body.confirmation_pull_request) && body.confirmation_pull_request === body.pull_request &&
    String(body.confirmation_target_commit || "").toLowerCase() === String(body.target_commit || "").toLowerCase() &&
    String(body.confirmation_target_branch || "") === String(body.target_branch || "") &&
    String(body.confirmation_base_branch || "") === String(body.base_branch || "") &&
    String(body.confirmation_repository || "") === String(body.repository || "") &&
    cleanReference(body.confirmation_reference).length > 0;
  const pullRequestReadyAttempt =
    body.operation_class === "reversible_owner_confirmed_pull_request_review_transition" &&
    String(body.action_type || "").toLowerCase() === "github_pull_request_ready_for_review";
  const allowedSoftwareModes = Array.isArray(body.allowed_modes) && body.allowed_modes.length > 0 &&
    body.allowed_modes.every((mode) => ["ghidra_headless", "frida_local_agent"].includes(mode));
  const deepSoftwareAnalysis =
    body.operation_class === "governed_deep_software_analysis" &&
    String(body.action_type || "").toLowerCase() === "software_analysis" &&
    body.external_side_effect === false && body.contains_customer_data === false && body.cross_tenant === false &&
    body.sandbox_ready === true && body.audit_ready === true && ownerConfirmed && allowedSoftwareModes &&
    ["owned", "written_permission", "open_source"].includes(String(body.authorization_basis || "").toLowerCase()) &&
    (!body.allowed_modes.includes("frida_local_agent") || (Array.isArray(body.target_allowlist) && body.target_allowlist.length > 0));
  const confirmationRequired = tenantScopedRead || sandboxedScopedWork
    ? false
    : decisionContract.control_level === "confirm" || reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || providerSetupLinkBlueprintBindingAttempt || connectorMetadataRefreshAttempt || connectorKeyRotationAttempt || verifiedOutcomeRecordAttempt || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady || deepSoftwareAnalysis;
  // The owner confirmation is bound to the exact staging target and branch. A
  // changed target or branch must never inherit a confirmation issued for it.
  const confirmationSatisfied = confirmationRequired && ownerConfirmed &&
    (!stagingPostgresAttempt || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration) &&
    (!tenantProviderVaultSecretAttempt || tenantProviderVaultSecretConfiguration) &&
    (!connectorMetadataRefreshAttempt || connectorMetadataRefresh) &&
    (!connectorKeyRotationAttempt || connectorKeyRotation) &&
    (!verifiedOutcomeRecordAttempt || verifiedOutcomeRecord) &&
    (!providerSetupLinkBlueprintBindingAttempt || providerSetupLinkBlueprintBinding) &&
    (!draftPullRequestAttempt || reversibleDraftPullRequest) &&
    (!pullRequestMergeAttempt || reversiblePullRequestMerge) &&
    (!pullRequestReadyAttempt || reversiblePullRequestReady);
  const hardBlocked = decisionContract.state === "blocked" ||
    decisionContract.recommended_actions?.some?.((action) => action.blocked === true) === true ||
    ((stagingPostgresAttempt || nyraGovernancePostgresAttempt || tenantProviderVaultSecretAttempt || connectorMetadataRefreshAttempt || connectorKeyRotationAttempt || verifiedOutcomeRecordAttempt || providerSetupLinkBlueprintBindingAttempt) && (body.cross_tenant === true || body.destructive === true || body.bypass_orchestrator === true || body.contains_secret === true || body.secret_value_transmitted === true)) ||
    (providerSetupLinkBlueprintBindingAttempt && (body.auth0_changes === true || body.provider_execution === true || body.execution_enabled === true)) ||
    (providerSetupLinkBlueprintBindingAttempt && (
      hasOnlyProviderSetupLinkBindingFields(body) === false ||
      hasExactProviderSetupLinkBindingScope(body) === false ||
      body.create_new === true || body.rotate_existing === true || body.delete === true ||
      body.merge === true || body.production_deploy === true || body.deploy === true ||
      body.force === true || body.admin_bypass === true
    ));
  const authorizedScope = tenantScopedRead || sandboxedScopedWork || reversibleInternalWrite || reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || providerSetupLinkBlueprintBinding || connectorMetadataRefresh || connectorKeyRotation || verifiedOutcomeRecord || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady || deepSoftwareAnalysis;
  const riskAllowed = reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || providerSetupLinkBlueprintBinding || connectorMetadataRefresh || connectorKeyRotation || verifiedOutcomeRecord || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady
    ? ["low", "medium", "high"].includes(String(decisionContract.risk_band || ""))
    : decisionContract.risk_band === "low";
  const executionAllowed = Boolean(
    authorizedScope &&
    !hardBlocked &&
    riskAllowed &&
    (!confirmationRequired || confirmationSatisfied)
  );

  return {
    allowed: executionAllowed,
    state: executionAllowed
      ? confirmationSatisfied ? "authorized_after_confirmation" : "authorized"
      : hardBlocked ? "blocked" : confirmationRequired && !confirmationSatisfied ? "confirmation_required" : "not_authorized",
    mediation: executionAllowed
      ? confirmationSatisfied ? "confirmed" : "allow"
      : hardBlocked ? "hard_block" : confirmationRequired && !confirmationSatisfied ? "confirm" : "defer",
    confirmation_required: confirmationRequired,
    confirmation_satisfied: confirmationSatisfied,
    confirmation_reference: confirmationSatisfied
      ? cleanReference(body.confirmation_reference) || "explicit_owner_confirmation"
      : null,
    scope: tenantScopedRead
      ? "tenant_scoped_read"
      : sandboxedScopedWork
        ? "sandboxed_scoped_work"
        : reversibleInternalWrite
          ? "reversible_internal_collaboration_write"
          : reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration
            ? "reversible_owner_confirmed_deploy"
          : connectorMetadataRefresh
              ? "reversible_owner_confirmed_connector_metadata_refresh"
            : connectorKeyRotation
                ? "reversible_owner_confirmed_core_connector_key_rotation"
              : verifiedOutcomeRecord
                  ? "verified_outcome_record"
          : providerSetupLinkBlueprintBinding
            ? "reversible_owner_confirmed_provider_setup_link_blueprint_binding"
          : reversibleBranchChange
              ? "reversible_owner_confirmed_branch_change"
              : reversibleDraftPullRequest
                ? "reversible_owner_confirmed_draft_pull_request"
                : reversiblePullRequestMerge
                  ? "reversible_owner_confirmed_pull_request_merge"
                  : reversiblePullRequestReady
                    ? "reversible_owner_confirmed_pull_request_review_transition"
                  : deepSoftwareAnalysis
              ? "governed_deep_software_analysis"
              : "evaluation_only",
    target_commit: reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || providerSetupLinkBlueprintBinding || connectorMetadataRefresh || connectorKeyRotation || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady ? String(body.target_commit).toLowerCase() : null,
  };
}

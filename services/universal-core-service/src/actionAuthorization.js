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

function isExactOrderedList(value, expected) {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((item, index) => String(item) === expected[index]);
}

const CORE_ADMIN_BOOTSTRAP_OPERATION_CLASS =
  "reversible_owner_confirmed_core_admin_bootstrap_configuration";
const CORE_ADMIN_BOOTSTRAP_ACTION_LABEL =
  "Configure Core Admin Control Room bootstrap references";
const CORE_ADMIN_BOOTSTRAP_FIELDS = new Set([
  "action_label",
  "action_type",
  "operation_class",
  "authenticated_tenant_id",
  "tenant_id",
  "authenticated_key_type",
  "external_side_effect",
  "contains_customer_data",
  "contains_secret",
  "secret_value_transmitted",
  "values_present_in_envelope",
  "cross_tenant",
  "destructive",
  "bypass_orchestrator",
  "rollback_ready",
  "audit_ready",
  "readback_required",
  "configuration_changes",
  "environment",
  "target",
  "target_service",
  "target_service_id",
  "resource_type",
  "render_environment_update",
  "other_environment_changes",
  "create_missing_only",
  "overwrite_existing",
  "current_values_present",
  "rollback_remove_new_variables",
  "allowed_environment_variables",
  "auth0_changes",
  "database_changes",
  "storage_changes",
  "domain_changes",
  "scaling_changes",
  "merge",
  "deploy",
  "production_deploy",
  "delete",
  "provider_execution",
  "execution_enabled",
  "force",
  "admin_bypass",
  "target_commit",
  "confirmation_target_commit",
  "confirmation_target_service",
  "confirmation_target_service_id",
  "confirmation_environment_variables",
  "confirmation_reference",
  "owner_confirmed",
  "owner_context",
  "owner_context_verified",
  "owner_context_approval_bound",
  "request_bound_owner_confirmation",
]);

function hasOnlyCoreAdminBootstrapFields(body = {}) {
  return body && typeof body === "object" && !Array.isArray(body) &&
    Object.keys(body).every((key) => CORE_ADMIN_BOOTSTRAP_FIELDS.has(key));
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
  const adminControlRoomSecretAttempt =
    body.operation_class === CORE_ADMIN_BOOTSTRAP_OPERATION_CLASS ||
    (
      String(body.action_type || "").toLowerCase() === "environment_configuration" &&
      (
        String(body.target || "") === "skinharmony-core-nyra-admin-login" ||
        (Array.isArray(body.allowed_environment_variables) && body.allowed_environment_variables.some(
          (key) => String(key).startsWith("CORE_ADMIN_"),
        ))
      )
    );
  // Bootstrap credentials for the human-facing Core/Nyra Control Room are
  // generated by the executor and sent directly to Render. Core authorizes
  // only the closed configuration shape; it never receives generated values.
  const adminControlRoomSecretConfiguration =
    body.operation_class === CORE_ADMIN_BOOTSTRAP_OPERATION_CLASS &&
    String(body.action_label || "") === CORE_ADMIN_BOOTSTRAP_ACTION_LABEL &&
    String(body.action_type || "").toLowerCase() === "environment_configuration" &&
    body.request_bound_owner_confirmation === true && body.owner_context_verified === true &&
    String(body.authenticated_key_type || "") === "connector" &&
    String(body.authenticated_tenant_id || "") === "codexai" && String(body.tenant_id || "") === "codexai" &&
    body.external_side_effect === true && body.contains_customer_data === false && body.contains_secret === false &&
    body.secret_value_transmitted === false && body.values_present_in_envelope === false &&
    body.cross_tenant === false && body.destructive === false && body.bypass_orchestrator === false &&
    body.rollback_ready === true && body.audit_ready === true && body.readback_required === true &&
    body.configuration_changes === true && exactCommit &&
    String(body.environment || "") === "production" &&
    String(body.target || "") === "skinharmony-core-nyra-admin-login" &&
    String(body.target_service || "") === "skinharmony-universal-core" &&
    String(body.target_service_id || "") === "srv-d82c9j3tqb8s73cgriag" &&
    String(body.resource_type || "") === "render_environment_variable_bundle" &&
    body.render_environment_update === true && body.other_environment_changes === false &&
    body.create_missing_only === true && body.overwrite_existing === false &&
    body.current_values_present === false && body.rollback_remove_new_variables === true &&
    isExactOrderedList(body.allowed_environment_variables, [
      "CORE_ADMIN_SESSION_SECRET",
      "CORE_ADMIN_BOOTSTRAP_USERNAME",
      "CORE_ADMIN_BOOTSTRAP_PASSWORD",
    ]) &&
    body.auth0_changes === false && body.database_changes === false && body.storage_changes === false &&
    body.domain_changes === false && body.scaling_changes === false &&
    body.merge === false && body.deploy === false && body.production_deploy === false &&
    body.delete === false && body.provider_execution === false && body.execution_enabled === false &&
    body.force === false && body.admin_bypass === false &&
    body.confirmation_target_service === body.target_service &&
    body.confirmation_target_service_id === body.target_service_id &&
    String(body.confirmation_target_commit || "").toLowerCase() === String(body.target_commit || "").toLowerCase() &&
    isExactOrderedList(body.confirmation_environment_variables, body.allowed_environment_variables) &&
    isCleanReference(body.confirmation_reference) && hasOnlyCoreAdminBootstrapFields(body);
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
  // One narrowly bounded repair for the observed Codex/Core tenant mismatch.
  // It changes no key, secret, scope, endpoint or OAuth identity. Unlike the
  // legacy automation path, this operation requires the server-derived flag
  // proving that the explicit confirmation was signed for this exact request.
  const mcpDefaultTenantCorrectionClassAttempt =
    body.operation_class === "reversible_owner_confirmed_mcp_default_tenant_correction";
  const mcpDefaultTenantCorrectionAttempt =
    mcpDefaultTenantCorrectionClassAttempt &&
    String(body.action_type || "").toLowerCase() === "render_mcp_default_tenant_correction";
  const mcpDefaultTenantCorrection =
    mcpDefaultTenantCorrectionAttempt && body.request_bound_owner_confirmation === true &&
    String(body.authenticated_key_type || "") === "connector" &&
    body.external_side_effect === true && body.contains_customer_data === false && body.contains_secret === false &&
    body.secret_value_transmitted === false && body.secret_changes === false && body.key_changes === false &&
    body.cross_tenant === false && body.destructive === false && body.bypass_orchestrator === false &&
    body.configuration_changes === true && body.tenant_binding_changes === true && body.endpoint_changes === false &&
    body.oauth_changes === false && body.scope_changes === false && body.permission_changes === false &&
    body.other_environment_changes === false && body.other_configuration_changes === false &&
    body.render_environment_update === true && body.source_of_truth_update_only === false &&
    body.data_migration === false && body.memory_migration === false &&
    body.rollback_ready === true && body.audit_ready === true && body.readback_required === true && exactCommit &&
    String(body.environment || "") === "production" && String(body.target_service || "") === "skinharmony-core-mcp" &&
    String(body.target_service_id || "") === "srv-d99ef1mcjfls73857m40" &&
    String(body.resource_type || "") === "render_environment_variable" &&
    String(body.target_environment_variable || "") === "MCP_DEFAULT_TENANT_ID" &&
    Array.isArray(body.allowed_environment_variables) && body.allowed_environment_variables.length === 1 &&
    body.allowed_environment_variables[0] === "MCP_DEFAULT_TENANT_ID" &&
    String(body.current_tenant_id || "") === "owner-private" && String(body.target_tenant_id || "") === "codexai" &&
    String(body.authenticated_tenant_id || "") === "codexai" && body.current_value_verified === true &&
    String(body.rollback_tenant_id || "") === "owner-private" && body.service_restart_required === true &&
    body.deploy === true && body.create_new === false && body.delete === false && body.merge === false &&
    body.provider_execution === false &&
    String(body.deployed_commit || "").toLowerCase() === String(body.target_commit || "").toLowerCase() &&
    String(body.confirmation_target_commit || "").toLowerCase() === String(body.target_commit || "").toLowerCase() &&
    body.confirmation_target_service === body.target_service &&
    body.confirmation_target_service_id === body.target_service_id &&
    body.confirmation_environment_variable === body.target_environment_variable &&
    body.confirmation_current_tenant_id === body.current_tenant_id &&
    body.confirmation_target_tenant_id === body.target_tenant_id && isCleanReference(body.confirmation_reference);
  // The live correction and its repository source of truth are two distinct
  // effects. This gate never reuses the generic code-only GitHub permissions:
  // it authorizes only the exact two-file alignment and one explicit lifecycle
  // phase at a time, after the production runtime is already verified on the
  // target tenant. A main-branch merge also declares its unavoidable Render
  // auto-deploy instead of hiding it behind deploy=false.
  const mcpDefaultTenantBlueprintAttempt =
    mcpDefaultTenantCorrectionClassAttempt &&
    String(body.action_type || "").toLowerCase() === "github_mcp_default_tenant_blueprint_alignment";
  const blueprintAllowedFiles = [
    "render-core-mcp.yaml",
    ".github/workflows/nyra-core-intelligence.yml",
  ];
  const blueprintAutomaticDeployServices = [
    "skinharmony-universal-core",
    "skinharmony-core-mcp",
  ];
  const blueprintAutomaticDeployServiceIds = [
    "srv-d82c9j3tqb8s73cgriag",
    "srv-d99ef1mcjfls73857m40",
  ];
  const exactBaseCommit = /^[a-f0-9]{40}$/i.test(String(body.base_commit || ""));
  const mcpDefaultTenantBlueprintCommon =
    mcpDefaultTenantBlueprintAttempt && body.request_bound_owner_confirmation === true &&
    String(body.authenticated_key_type || "") === "connector" &&
    body.external_side_effect === true && body.contains_customer_data === false && body.contains_secret === false &&
    body.secret_value_transmitted === false && body.secret_changes === false && body.key_changes === false &&
    body.cross_tenant === false && body.destructive === false && body.bypass_orchestrator === false &&
    body.configuration_changes === true && body.tenant_binding_changes === true && body.endpoint_changes === false &&
    body.oauth_changes === false && body.scope_changes === false && body.permission_changes === false &&
    body.other_environment_changes === false && body.other_configuration_changes === false &&
    body.data_migration === false && body.memory_migration === false && body.provider_execution === false &&
    body.render_environment_update === false && body.source_of_truth_update_only === true &&
    body.rollback_ready === true && body.audit_ready === true && body.readback_required === true &&
    exactCommit && exactBaseCommit && String(body.target_commit).toLowerCase() !== String(body.base_commit).toLowerCase() &&
    String(body.target_parent_commit || "").toLowerCase() === String(body.base_commit).toLowerCase() &&
    body.base_commit_verified === true && body.changed_files_verified === true && body.diff_verified === true &&
    body.changed_file_count === 2 && body.blueprint_change_count === 1 &&
    body.blueprint_diff_additions === 1 && body.blueprint_diff_deletions === 1 &&
    body.ci_guardrail_change === true && body.ci_guardrail_verified === true &&
    String(body.environment || "") === "production" && String(body.target_service || "") === "skinharmony-core-mcp" &&
    String(body.target_service_id || "") === "srv-d99ef1mcjfls73857m40" &&
    String(body.resource_type || "") === "render_blueprint_source_of_truth" &&
    String(body.repository || "") === "cardarellocristian86-debug/skinharmony-ai-backend" &&
    String(body.base_branch || "") === "main" &&
    String(body.target_branch || "") === "agent/align-mcp-default-tenant-blueprint" &&
    String(body.target_file || "") === "render-core-mcp.yaml" &&
    String(body.ci_workflow_file || "") === ".github/workflows/nyra-core-intelligence.yml" &&
    isExactOrderedList(body.allowed_files, blueprintAllowedFiles) &&
    String(body.target_environment_variable || "") === "MCP_DEFAULT_TENANT_ID" &&
    String(body.blueprint_current_tenant_id || "") === "owner-private" &&
    String(body.target_tenant_id || "") === "codexai" && String(body.authenticated_tenant_id || "") === "codexai" &&
    String(body.live_tenant_id || "") === "codexai" && body.blueprint_current_value_verified === true &&
    body.live_value_verified === true && body.live_canary_verified === true && body.blueprint_apply_idempotent === true &&
    String(body.rollback_tenant_id || "") === "owner-private" && body.create_new === false && body.delete === false &&
    body.force === false && body.admin_bypass === false &&
    String(body.confirmation_workflow_phase || "") === String(body.workflow_phase || "") &&
    String(body.confirmation_target_commit || "").toLowerCase() === String(body.target_commit || "").toLowerCase() &&
    String(body.confirmation_base_commit || "").toLowerCase() === String(body.base_commit || "").toLowerCase() &&
    body.confirmation_target_service === body.target_service &&
    body.confirmation_target_service_id === body.target_service_id &&
    body.confirmation_repository === body.repository && body.confirmation_base_branch === body.base_branch &&
    body.confirmation_target_branch === body.target_branch && body.confirmation_target_file === body.target_file &&
    body.confirmation_environment_variable === body.target_environment_variable &&
    body.confirmation_current_tenant_id === body.blueprint_current_tenant_id &&
    body.confirmation_target_tenant_id === body.target_tenant_id &&
    isExactOrderedList(body.confirmation_allowed_files, blueprintAllowedFiles) && isCleanReference(body.confirmation_reference);
  const mcpDefaultTenantBlueprintBranchPublish =
    mcpDefaultTenantBlueprintCommon && String(body.workflow_phase || "") === "branch_publish" &&
    body.branch_publish === true && body.create_new_branch === true && body.remote_branch_absent_verified === true &&
    body.create_pull_request === false && body.draft === false && body.ready_for_review === false && body.merge === false &&
    body.deploy === false && body.automatic_deploy_expected === false && body.service_restart_required === false &&
    body.post_merge_commit_readback_required === false &&
    isExactOrderedList(body.automatic_deploy_services, []) && isExactOrderedList(body.automatic_deploy_service_ids, []) &&
    String(body.rollback_strategy || "") === "delete_unmerged_branch";
  const mcpDefaultTenantBlueprintDraftPullRequest =
    mcpDefaultTenantBlueprintCommon && String(body.workflow_phase || "") === "draft_pull_request" &&
    body.branch_publish === false && body.create_new_branch === false && body.remote_branch_commit_verified === true &&
    body.create_pull_request === true && body.draft === true && body.ready_for_review === false && body.merge === false &&
    body.deploy === false && body.automatic_deploy_expected === false && body.service_restart_required === false &&
    body.post_merge_commit_readback_required === false &&
    isExactOrderedList(body.automatic_deploy_services, []) && isExactOrderedList(body.automatic_deploy_service_ids, []) &&
    String(body.rollback_strategy || "") === "close_draft_pull_request";
  const blueprintPullRequest = Number.isInteger(body.pull_request) && body.pull_request > 0;
  const blueprintPullRequestConfirmation =
    blueprintPullRequest && Number.isInteger(body.confirmation_pull_request) &&
    body.confirmation_pull_request === body.pull_request;
  const blueprintChecksVerified =
    body.checks_verified === true && body.required_checks_verified === true &&
    String(body.checks_commit || "").toLowerCase() === String(body.target_commit || "").toLowerCase();
  const mcpDefaultTenantBlueprintReadyForReview =
    mcpDefaultTenantBlueprintCommon && String(body.workflow_phase || "") === "ready_for_review" &&
    blueprintPullRequestConfirmation && blueprintChecksVerified && body.pull_request_head_verified === true &&
    body.branch_publish === false && body.create_new_branch === false && body.create_pull_request === false &&
    body.draft === true && body.ready_for_review === true && body.merge === false && body.deploy === false &&
    body.automatic_deploy_expected === false && body.service_restart_required === false &&
    body.post_merge_commit_readback_required === false &&
    isExactOrderedList(body.automatic_deploy_services, []) && isExactOrderedList(body.automatic_deploy_service_ids, []) &&
    String(body.rollback_strategy || "") === "return_pull_request_to_draft";
  const mcpDefaultTenantBlueprintMerge =
    mcpDefaultTenantBlueprintCommon && String(body.workflow_phase || "") === "merge" &&
    blueprintPullRequestConfirmation && blueprintChecksVerified && body.pull_request_head_verified === true &&
    body.review_verified === true && body.reviewed_diff_verified === true && body.current_pull_request_draft === false &&
    body.branch_publish === false && body.create_new_branch === false && body.create_pull_request === false &&
    body.draft === false && body.ready_for_review === false && body.merge === true && body.deploy === true &&
    body.automatic_deploy_expected === true && body.service_restart_required === true &&
    body.post_merge_commit_readback_required === true && body.merge_result_commit_pending === true &&
    isExactOrderedList(body.automatic_deploy_services, blueprintAutomaticDeployServices) &&
    isExactOrderedList(body.automatic_deploy_service_ids, blueprintAutomaticDeployServiceIds) &&
    ["merge", "squash", "rebase"].includes(String(body.merge_method || "")) &&
    body.confirmation_merge_method === body.merge_method &&
    String(body.rollback_strategy || "") === "forward_revert_with_coordinated_runtime_rollback";
  const mcpDefaultTenantBlueprintAlignment =
    mcpDefaultTenantBlueprintBranchPublish || mcpDefaultTenantBlueprintDraftPullRequest ||
    mcpDefaultTenantBlueprintReadyForReview || mcpDefaultTenantBlueprintMerge;
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
    : decisionContract.control_level === "confirm" || reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || adminControlRoomSecretConfiguration || providerSetupLinkBlueprintBindingAttempt || connectorMetadataRefreshAttempt || connectorKeyRotationAttempt || mcpDefaultTenantCorrectionClassAttempt || verifiedOutcomeRecordAttempt || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady || deepSoftwareAnalysis;
  // The owner confirmation is bound to the exact staging target and branch. A
  // changed target or branch must never inherit a confirmation issued for it.
  const confirmationSatisfied = confirmationRequired && ownerConfirmed &&
    (!stagingPostgresAttempt || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || adminControlRoomSecretConfiguration) &&
    (!tenantProviderVaultSecretAttempt || tenantProviderVaultSecretConfiguration) &&
    (!adminControlRoomSecretAttempt || adminControlRoomSecretConfiguration) &&
    (!connectorMetadataRefreshAttempt || connectorMetadataRefresh) &&
    (!connectorKeyRotationAttempt || connectorKeyRotation) &&
    (!mcpDefaultTenantCorrectionClassAttempt || mcpDefaultTenantCorrection || mcpDefaultTenantBlueprintAlignment) &&
    (!verifiedOutcomeRecordAttempt || verifiedOutcomeRecord) &&
    (!providerSetupLinkBlueprintBindingAttempt || providerSetupLinkBlueprintBinding) &&
    (!draftPullRequestAttempt || reversibleDraftPullRequest) &&
    (!pullRequestMergeAttempt || reversiblePullRequestMerge) &&
    (!pullRequestReadyAttempt || reversiblePullRequestReady);
  const hardBlocked = decisionContract.state === "blocked" ||
    decisionContract.recommended_actions?.some?.((action) => action.blocked === true) === true ||
    ((stagingPostgresAttempt || nyraGovernancePostgresAttempt || tenantProviderVaultSecretAttempt || adminControlRoomSecretAttempt || connectorMetadataRefreshAttempt || connectorKeyRotationAttempt || mcpDefaultTenantCorrectionClassAttempt || verifiedOutcomeRecordAttempt || providerSetupLinkBlueprintBindingAttempt) && (body.cross_tenant === true || body.destructive === true || body.bypass_orchestrator === true || body.contains_secret === true || body.secret_value_transmitted === true)) ||
    (adminControlRoomSecretAttempt && !adminControlRoomSecretConfiguration) ||
    (providerSetupLinkBlueprintBindingAttempt && (body.auth0_changes === true || body.provider_execution === true || body.execution_enabled === true)) ||
    (providerSetupLinkBlueprintBindingAttempt && (
      hasOnlyProviderSetupLinkBindingFields(body) === false ||
      hasExactProviderSetupLinkBindingScope(body) === false ||
      body.create_new === true || body.rotate_existing === true || body.delete === true ||
      body.merge === true || body.production_deploy === true || body.deploy === true ||
      body.force === true || body.admin_bypass === true
    ));
  const authorizedScope = tenantScopedRead || sandboxedScopedWork || reversibleInternalWrite || reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || adminControlRoomSecretConfiguration || providerSetupLinkBlueprintBinding || connectorMetadataRefresh || connectorKeyRotation || mcpDefaultTenantCorrection || mcpDefaultTenantBlueprintAlignment || verifiedOutcomeRecord || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady || deepSoftwareAnalysis;
  const riskAllowed = reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || adminControlRoomSecretConfiguration || providerSetupLinkBlueprintBinding || connectorMetadataRefresh || connectorKeyRotation || mcpDefaultTenantCorrection || mcpDefaultTenantBlueprintAlignment || verifiedOutcomeRecord || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady
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
          : adminControlRoomSecretConfiguration
            ? CORE_ADMIN_BOOTSTRAP_OPERATION_CLASS
          : connectorMetadataRefresh
              ? "reversible_owner_confirmed_connector_metadata_refresh"
            : connectorKeyRotation
                ? "reversible_owner_confirmed_core_connector_key_rotation"
              : mcpDefaultTenantCorrection
                  ? "reversible_owner_confirmed_mcp_default_tenant_correction"
                : mcpDefaultTenantBlueprintAlignment
                    ? "reversible_owner_confirmed_mcp_default_tenant_blueprint_alignment"
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
    target_commit: reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || adminControlRoomSecretConfiguration || providerSetupLinkBlueprintBinding || connectorMetadataRefresh || connectorKeyRotation || mcpDefaultTenantCorrection || mcpDefaultTenantBlueprintAlignment || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady ? String(body.target_commit).toLowerCase() : null,
    workflow_phase: mcpDefaultTenantBlueprintAlignment ? String(body.workflow_phase) : null,
  };
}

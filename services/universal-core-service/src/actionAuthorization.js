function cleanReference(value) {
  return String(value || "")
    .slice(0, 240)
    .replace(/\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]")
    .trim();
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
    : decisionContract.control_level === "confirm" || reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady || deepSoftwareAnalysis;
  // The owner confirmation is bound to the exact staging target and branch. A
  // changed target or branch must never inherit a confirmation issued for it.
  const confirmationSatisfied = confirmationRequired && ownerConfirmed &&
    (!stagingPostgresAttempt || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration) &&
    (!tenantProviderVaultSecretAttempt || tenantProviderVaultSecretConfiguration) &&
    (!draftPullRequestAttempt || reversibleDraftPullRequest) &&
    (!pullRequestMergeAttempt || reversiblePullRequestMerge) &&
    (!pullRequestReadyAttempt || reversiblePullRequestReady);
  const hardBlocked = decisionContract.state === "blocked" ||
    decisionContract.recommended_actions?.some?.((action) => action.blocked === true) === true ||
    ((stagingPostgresAttempt || nyraGovernancePostgresAttempt || tenantProviderVaultSecretAttempt) && (body.cross_tenant === true || body.destructive === true || body.bypass_orchestrator === true || body.contains_secret === true || body.secret_value_transmitted === true));
  const authorizedScope = tenantScopedRead || sandboxedScopedWork || reversibleInternalWrite || reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady || deepSoftwareAnalysis;
  const riskAllowed = reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady
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
    target_commit: reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || tenantProviderVaultSecretConfiguration || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady ? String(body.target_commit).toLowerCase() : null,
  };
}

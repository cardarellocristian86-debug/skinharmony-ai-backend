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
    : decisionContract.control_level === "confirm" || reversibleDeploy || stagingPostgresConfiguration || reversibleBranchChange || reversibleDraftPullRequest || deepSoftwareAnalysis;
  // The owner confirmation is bound to the exact staging target and branch. A
  // changed target or branch must never inherit a confirmation issued for it.
  const confirmationSatisfied = confirmationRequired && ownerConfirmed &&
    (!stagingPostgresAttempt || stagingPostgresConfiguration) &&
    (!draftPullRequestAttempt || reversibleDraftPullRequest);
  const hardBlocked = decisionContract.state === "blocked" ||
    decisionContract.recommended_actions?.some?.((action) => action.blocked === true) === true ||
    (stagingPostgresAttempt && (body.cross_tenant === true || body.destructive === true || body.bypass_orchestrator === true));
  const authorizedScope = tenantScopedRead || sandboxedScopedWork || reversibleInternalWrite || reversibleDeploy || stagingPostgresConfiguration || reversibleBranchChange || reversibleDraftPullRequest || deepSoftwareAnalysis;
  const riskAllowed = reversibleDeploy || stagingPostgresConfiguration || reversibleBranchChange || reversibleDraftPullRequest
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
          : reversibleDeploy || stagingPostgresConfiguration
            ? "reversible_owner_confirmed_deploy"
          : reversibleBranchChange
              ? "reversible_owner_confirmed_branch_change"
              : reversibleDraftPullRequest
                ? "reversible_owner_confirmed_draft_pull_request"
              : deepSoftwareAnalysis
              ? "governed_deep_software_analysis"
              : "evaluation_only",
    target_commit: reversibleDeploy || stagingPostgresConfiguration || reversibleBranchChange || reversibleDraftPullRequest ? String(body.target_commit).toLowerCase() : null,
  };
}

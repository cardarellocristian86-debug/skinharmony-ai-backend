import crypto from "node:crypto";

function cleanReference(value) {
  return String(value || "")
    .slice(0, 240)
    .replace(/\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]")
    .trim();
}

function exactText(value, expected) {
  return typeof value === "string" && value === expected;
}

function exactCommit(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function validConfirmationReference(value) {
  if (typeof value !== "string") return false;
  const cleaned = cleanReference(value);
  return cleaned.length > 0 && cleaned === value.trim();
}

function validDeploymentTarget(value) {
  return typeof value === "string" && value.length >= 3 && value.length <= 240 &&
    value.trim() === value && /^[a-z0-9][a-z0-9._:/-]+$/i.test(value);
}

function validAgentBranch(value) {
  return typeof value === "string" && /^agent\/[a-z0-9._/-]+$/i.test(value);
}

function validRepository(value) {
  return typeof value === "string" && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value);
}

function safeDomainAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { reserved: false, eligible: false, hard_block: false };
  }
  return value;
}

function reversibleDeployDigest(body) {
  return crypto.createHash("sha256").update(`core-reversible-deploy-v1\u0000${JSON.stringify({
    scope: "reversible_owner_confirmed_deploy",
    tenant_id: typeof body.tenant_id === "string" ? body.tenant_id : "",
    target: body.target,
    target_commit: body.target_commit,
    confirmation_reference: body.confirmation_reference,
  })}`).digest("hex");
}

export function buildActionAuthorization(decisionContract = {}, body = {}, options = {}) {
  const ownerConfirmed = body.owner_confirmed === true;
  const commitMatches = exactCommit(body.target_commit);
  const domainAction = safeDomainAction(options.domainAction);
  const domainReserved = domainAction.reserved === true;
  const domainScope = typeof domainAction.scope === "string" &&
    /^reversible_owner_confirmed_[a-z0-9_]{3,120}$/.test(domainAction.scope)
    ? domainAction.scope
    : null;
  const domainDigest = typeof domainAction.action_digest === "string" && /^[a-f0-9]{64}$/.test(domainAction.action_digest)
    ? domainAction.action_digest
    : null;
  const domainExecutorContractId = typeof domainAction.executor_contract_id === "string" &&
    domainAction.executor_contract_id.length <= 240 &&
    /^[a-z0-9][a-z0-9._:-]+$/i.test(domainAction.executor_contract_id)
    ? domainAction.executor_contract_id
    : null;
  const domainTargetCommit = exactCommit(domainAction.target_commit) ? domainAction.target_commit : null;
  const domainEligible = domainReserved && domainAction.eligible === true && domainScope !== null &&
    domainDigest !== null && domainExecutorContractId !== null && domainTargetCommit !== null &&
    domainAction.revalidation_required === true && domainAction.confirmation_required === true;
  const tenantScopedRead =
    !domainReserved &&
    body.operation_class === "tenant_scoped_read" &&
    body.external_side_effect !== true &&
    body.contains_customer_data !== true &&
    body.cross_tenant !== true &&
    body.configuration_changes !== true;
  const sandboxedScopedWork =
    !domainReserved &&
    body.operation_class === "sandboxed_scoped_work" &&
    body.external_side_effect !== true &&
    body.contains_customer_data !== true &&
    body.cross_tenant !== true &&
    body.configuration_changes !== true;
  const reversibleDeploy =
    !domainReserved &&
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    exactText(body.action_type, "deploy") &&
    body.external_side_effect === true &&
    body.contains_customer_data === false &&
    body.cross_tenant === false &&
    body.rollback_ready === true &&
    body.audit_ready === true &&
    body.configuration_changes === false &&
    validDeploymentTarget(body.target) &&
    commitMatches &&
    validConfirmationReference(body.confirmation_reference);
  const stagingPostgresConfiguration =
    !domainReserved &&
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    exactText(body.action_type, "environment_configuration") &&
    body.external_side_effect === true && body.contains_customer_data === false && body.contains_secret === false &&
    body.cross_tenant === false && body.destructive === false && body.bypass_orchestrator === false &&
    body.rollback_ready === true && body.audit_ready === true && body.configuration_changes === true && commitMatches &&
    exactText(body.environment, "staging") && exactText(body.target, "skinharmony-mcp-staging-db") &&
    exactText(body.target_branch, "agent/multiagent-postgres-cloud") &&
    exactText(body.resource_type, "postgresql") && body.create_new === true &&
    body.reuse_existing_database === false && body.auth0_changes !== true && body.merge !== true &&
    body.production_deploy !== true && body.delete !== true &&
    validConfirmationReference(body.confirmation_reference);
  const stagingPostgresAttempt =
    !domainReserved &&
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    exactText(body.action_type, "environment_configuration");
  const nyraGovernancePostgresConfiguration =
    !domainReserved &&
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    exactText(body.action_type, "environment_configuration") &&
    body.external_side_effect === true && body.contains_customer_data === false && body.contains_secret === false &&
    body.cross_tenant === false && body.destructive === false && body.bypass_orchestrator === false &&
    body.rollback_ready === true && body.audit_ready === true && body.configuration_changes === true && commitMatches &&
    exactText(body.environment, "production") && exactText(body.target, "skinharmony-nyra-governance-db") &&
    exactText(body.target_service, "skinharmony-universal-core") &&
    exactText(body.resource_type, "postgresql") && body.create_new === true &&
    body.reuse_existing_database === false && body.database_public_access === false && body.allow_data_migration === false &&
    body.auth0_changes !== true && body.merge !== true && body.production_deploy !== true && body.delete !== true &&
    body.provider_execution === false && Array.isArray(body.allowed_environment_variables) &&
    body.allowed_environment_variables.length === 1 && body.allowed_environment_variables[0] === "GOVERNED_AGENT_DATABASE_URL" &&
    validConfirmationReference(body.confirmation_reference);
  const nyraGovernancePostgresAttempt =
    !domainReserved &&
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    exactText(body.action_type, "environment_configuration") &&
    exactText(body.target, "skinharmony-nyra-governance-db");
  const reversibleInternalWrite =
    !domainReserved &&
    body.operation_class === "reversible_internal_collaboration_write" &&
    body.external_side_effect === false &&
    body.contains_customer_data === false &&
    body.rollback_ready === true;
  const reversibleBranchChange =
    !domainReserved &&
    body.operation_class === "reversible_owner_confirmed_branch_change" &&
    exactText(body.action_type, "repository_file_update") &&
    body.external_side_effect === true &&
    body.contains_customer_data === false &&
    body.contains_secret === false &&
    body.cross_tenant === false &&
    body.destructive === false &&
    body.bypass_orchestrator === false &&
    body.configuration_changes === false &&
    body.rollback_ready === true &&
    body.audit_ready === true &&
    commitMatches &&
    validAgentBranch(body.target_branch) &&
    validConfirmationReference(body.confirmation_reference);
  const reversibleDraftPullRequest =
    !domainReserved &&
    body.operation_class === "reversible_owner_confirmed_draft_pull_request" &&
    exactText(body.action_type, "github_draft_pull_request") &&
    body.external_side_effect === true &&
    body.contains_customer_data === false &&
    body.contains_secret === false &&
    body.cross_tenant === false &&
    body.destructive === false &&
    body.bypass_orchestrator === false &&
    body.configuration_changes === false &&
    body.rollback_ready === true &&
    body.audit_ready === true &&
    commitMatches &&
    validAgentBranch(body.target_branch) &&
    exactText(body.base_branch, "main") &&
    body.draft === true &&
    body.merge === false &&
    body.deploy === false &&
    body.delete === false &&
    validRepository(body.repository) &&
    validConfirmationReference(body.confirmation_reference);
  const draftPullRequestAttempt =
    !domainReserved &&
    body.operation_class === "reversible_owner_confirmed_draft_pull_request" &&
    exactText(body.action_type, "github_draft_pull_request");
  // A merge changes the protected base branch, so it is intentionally a
  // different capability from creating a draft PR. Every field below binds the
  // confirmation to the reviewed head, exact commit, protected destination and
  // verification evidence. Callers cannot turn this into a deploy, delete,
  // force-push or an administrator-bypass operation.
  const reversiblePullRequestMerge =
    !domainReserved &&
    body.operation_class === "reversible_owner_confirmed_pull_request_merge" &&
    exactText(body.action_type, "github_pull_request_merge") &&
    body.external_side_effect === true &&
    body.contains_customer_data === false &&
    body.contains_secret === false &&
    body.cross_tenant === false &&
    body.destructive === false &&
    body.bypass_orchestrator === false &&
    body.configuration_changes === false &&
    body.rollback_ready === true &&
    body.audit_ready === true &&
    commitMatches &&
    Number.isInteger(body.pull_request) && body.pull_request > 0 &&
    validAgentBranch(body.target_branch) &&
    exactText(body.base_branch, "main") &&
    validRepository(body.repository) &&
    body.draft === false &&
    body.merge === true &&
    body.deploy === false &&
    body.delete === false &&
    body.force === false &&
    body.admin_bypass === false &&
    typeof body.merge_method === "string" && ["merge", "squash", "rebase"].includes(body.merge_method) &&
    body.checks_verified === true &&
    exactCommit(body.checks_commit) && body.checks_commit === body.target_commit &&
    Number.isInteger(body.confirmation_pull_request) && body.confirmation_pull_request === body.pull_request &&
    exactCommit(body.confirmation_target_commit) && body.confirmation_target_commit === body.target_commit &&
    body.confirmation_target_branch === body.target_branch &&
    body.confirmation_base_branch === body.base_branch &&
    body.confirmation_repository === body.repository &&
    validConfirmationReference(body.confirmation_reference);
  const pullRequestMergeAttempt =
    !domainReserved &&
    body.operation_class === "reversible_owner_confirmed_pull_request_merge" &&
    exactText(body.action_type, "github_pull_request_merge");
  const reversiblePullRequestReady =
    !domainReserved &&
    body.operation_class === "reversible_owner_confirmed_pull_request_review_transition" &&
    exactText(body.action_type, "github_pull_request_ready_for_review") &&
    body.external_side_effect === true &&
    body.contains_customer_data === false && body.contains_secret === false && body.cross_tenant === false &&
    body.destructive === false && body.bypass_orchestrator === false && body.configuration_changes === false &&
    body.rollback_ready === true && body.audit_ready === true && commitMatches &&
    Number.isInteger(body.pull_request) && body.pull_request > 0 &&
    validAgentBranch(body.target_branch) &&
    exactText(body.base_branch, "main") &&
    validRepository(body.repository) &&
    body.draft === true && body.ready_for_review === true && body.merge === false && body.deploy === false &&
    body.delete === false && body.force === false && body.admin_bypass === false &&
    Number.isInteger(body.confirmation_pull_request) && body.confirmation_pull_request === body.pull_request &&
    exactCommit(body.confirmation_target_commit) && body.confirmation_target_commit === body.target_commit &&
    body.confirmation_target_branch === body.target_branch &&
    body.confirmation_base_branch === body.base_branch &&
    body.confirmation_repository === body.repository &&
    validConfirmationReference(body.confirmation_reference);
  const pullRequestReadyAttempt =
    !domainReserved &&
    body.operation_class === "reversible_owner_confirmed_pull_request_review_transition" &&
    exactText(body.action_type, "github_pull_request_ready_for_review");
  const allowedSoftwareModes = Array.isArray(body.allowed_modes) && body.allowed_modes.length > 0 &&
    body.allowed_modes.every((mode) => ["ghidra_headless", "frida_local_agent"].includes(mode));
  const deepSoftwareAnalysis =
    !domainReserved &&
    body.operation_class === "governed_deep_software_analysis" &&
    exactText(body.action_type, "software_analysis") &&
    body.external_side_effect === false && body.contains_customer_data === false && body.cross_tenant === false &&
    body.sandbox_ready === true && body.audit_ready === true && ownerConfirmed && allowedSoftwareModes &&
    typeof body.authorization_basis === "string" && ["owned", "written_permission", "open_source"].includes(body.authorization_basis) &&
    (!body.allowed_modes.includes("frida_local_agent") || (Array.isArray(body.target_allowlist) && body.target_allowlist.length > 0));
  const confirmationRequired = domainReserved
    ? domainEligible
    : tenantScopedRead || sandboxedScopedWork
      ? false
      : decisionContract.control_level === "confirm" || reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady || deepSoftwareAnalysis;
  // The owner confirmation is bound to the exact staging target and branch. A
  // changed target or branch must never inherit a confirmation issued for it.
  const confirmationSatisfied = domainReserved
    ? confirmationRequired && domainAction.confirmation_satisfied === true
    : confirmationRequired && ownerConfirmed &&
      (!stagingPostgresAttempt || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration) &&
      (!draftPullRequestAttempt || reversibleDraftPullRequest) &&
      (!pullRequestMergeAttempt || reversiblePullRequestMerge) &&
      (!pullRequestReadyAttempt || reversiblePullRequestReady);
  const hardBlocked = decisionContract.state === "blocked" ||
    decisionContract.recommended_actions?.some?.((action) => action.blocked === true) === true ||
    ((stagingPostgresAttempt || nyraGovernancePostgresAttempt) &&
      (body.cross_tenant === true || body.destructive === true || body.bypass_orchestrator === true)) ||
    (domainReserved && domainAction.hard_block === true);
  const authorizedScope = tenantScopedRead || sandboxedScopedWork || reversibleInternalWrite || reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady || deepSoftwareAnalysis || domainEligible;
  const riskAllowed = reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady || domainEligible
    ? typeof decisionContract.risk_band === "string" && ["low", "medium", "high"].includes(decisionContract.risk_band)
    : decisionContract.risk_band === "low";
  const executionAllowed = Boolean(
    authorizedScope &&
    !hardBlocked &&
    riskAllowed &&
    (!confirmationRequired || confirmationSatisfied)
  );

  const confirmedReference = domainReserved
    ? domainAction.confirmation_reference
    : body.confirmation_reference;
  const authorizedTargetCommit = domainEligible
    ? domainTargetCommit
    : reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration || reversibleBranchChange || reversibleDraftPullRequest || reversiblePullRequestMerge || reversiblePullRequestReady
      ? body.target_commit
      : null;
  const genericDeployDigest = reversibleDeploy ? reversibleDeployDigest(body) : null;

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
      ? cleanReference(confirmedReference) || "explicit_owner_confirmation"
      : null,
    scope: domainEligible
      ? domainScope
      : tenantScopedRead
        ? "tenant_scoped_read"
        : sandboxedScopedWork
          ? "sandboxed_scoped_work"
          : reversibleInternalWrite
            ? "reversible_internal_collaboration_write"
            : reversibleDeploy || stagingPostgresConfiguration || nyraGovernancePostgresConfiguration
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
    target_commit: authorizedTargetCommit,
    target: reversibleDeploy ? body.target : null,
    domain_action_id: domainReserved && typeof domainAction.domain_action_id === "string"
      ? cleanReference(domainAction.domain_action_id)
      : null,
    action_digest: domainEligible ? domainDigest : genericDeployDigest,
    executor_contract_id: domainEligible
      ? domainExecutorContractId
      : genericDeployDigest
        ? `deploy_${genericDeployDigest.slice(0, 20)}`
        : null,
    revalidation_required: domainEligible || reversibleDeploy,
  };
}

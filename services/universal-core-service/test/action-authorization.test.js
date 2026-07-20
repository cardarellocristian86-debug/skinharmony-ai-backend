import assert from "node:assert/strict";
import test from "node:test";
import { buildActionAuthorization } from "../src/actionAuthorization.js";

function contract(overrides = {}) {
  return {
    state: "attention",
    risk_band: "low",
    control_level: "confirm",
    recommended_actions: [{ blocked: false }],
    ...overrides,
  };
}

const reversibleWrite = {
  operation_class: "reversible_internal_collaboration_write",
  external_side_effect: false,
  contains_customer_data: false,
  rollback_ready: true,
};

test("requires explicit owner confirmation for a reversible internal write", () => {
  const result = buildActionAuthorization(contract(), reversibleWrite);
  assert.equal(result.allowed, false);
  assert.equal(result.state, "confirmation_required");
  assert.equal(result.confirmation_required, true);
  assert.equal(result.confirmation_satisfied, false);
});

test("authorizes the exact low-risk internal write after confirmation", () => {
  const result = buildActionAuthorization(contract(), {
    ...reversibleWrite,
    owner_confirmed: true,
    confirmation_reference: "user confirmed token=must-not-leak",
  });
  assert.equal(result.allowed, true);
  assert.equal(result.state, "authorized_after_confirmation");
  assert.equal(result.mediation, "confirmed");
  assert.equal(result.confirmation_satisfied, true);
  assert(!result.confirmation_reference.includes("must-not-leak"));
});

test("keeps hard blocks, higher risk and external writes closed", () => {
  assert.equal(buildActionAuthorization(contract({ state: "blocked" }), { ...reversibleWrite, owner_confirmed: true }).allowed, false);
  assert.equal(buildActionAuthorization(contract({ risk_band: "medium" }), { ...reversibleWrite, owner_confirmed: true }).allowed, false);
  assert.equal(buildActionAuthorization(contract(), { ...reversibleWrite, owner_confirmed: true, external_side_effect: true }).allowed, false);
});

const reversibleDeploy = {
  action_type: "deploy",
  operation_class: "reversible_owner_confirmed_deploy",
  external_side_effect: true,
  contains_customer_data: false,
  cross_tenant: false,
  rollback_ready: true,
  audit_ready: true,
  configuration_changes: false,
  target_commit: "6bd1aecda5defeb1c50e1e753d814b1e05c9b559",
  confirmation_reference: "owner-confirmed-deploy-pr17-2026-07-13",
};

test("authorizes only an exact reversible deploy after owner confirmation", () => {
  const pending = buildActionAuthorization(contract({ control_level: "suggest" }), reversibleDeploy);
  assert.equal(pending.allowed, false);
  assert.equal(pending.state, "confirmation_required");

  const authorized = buildActionAuthorization(contract({ control_level: "suggest" }), {
    ...reversibleDeploy,
    owner_confirmed: true,
  });
  assert.equal(authorized.allowed, true);
  assert.equal(authorized.scope, "reversible_owner_confirmed_deploy");
  assert.equal(authorized.target_commit, reversibleDeploy.target_commit);
});

test("keeps incomplete, configuration-changing and cross-tenant deploys closed", () => {
  for (const unsafe of [
    { ...reversibleDeploy, owner_confirmed: true, target_commit: "main" },
    { ...reversibleDeploy, owner_confirmed: true, rollback_ready: false },
    { ...reversibleDeploy, owner_confirmed: true, audit_ready: false },
    { ...reversibleDeploy, owner_confirmed: true, configuration_changes: true },
    { ...reversibleDeploy, owner_confirmed: true, cross_tenant: true },
    { ...reversibleDeploy, owner_confirmed: true, confirmation_reference: "" },
  ]) {
    assert.equal(buildActionAuthorization(contract(), unsafe).allowed, false);
  }
});

const stagingPostgres = {
  action_type: "environment_configuration", operation_class: "reversible_owner_confirmed_deploy",
  external_side_effect: true, contains_customer_data: false, contains_secret: false, cross_tenant: false,
  destructive: false, bypass_orchestrator: false, rollback_ready: true, audit_ready: true, configuration_changes: true,
  environment: "staging", target: "skinharmony-mcp-staging-db", target_branch: "agent/multiagent-postgres-cloud",
  resource_type: "postgresql", create_new: true, reuse_existing_database: false, auth0_changes: false,
  merge: false, production_deploy: false, delete: false,
  target_commit: "6bd1aecda5defeb1c50e1e753d814b1e05c9b559", confirmation_reference: "owner confirmed staging postgres",
};
test("authorizes only the exact owner-confirmed staging PostgreSQL configuration", () => {
  const allowed = buildActionAuthorization(contract({ risk_band: "high" }), { ...stagingPostgres, owner_confirmed: true });
  assert.equal(allowed.allowed, true); assert.equal(allowed.state, "authorized_after_confirmation");
  assert.equal(allowed.confirmation_satisfied, true);
  assert.equal(allowed.scope, "reversible_owner_confirmed_deploy");
  const missingConfirmation = buildActionAuthorization(contract({ risk_band: "high" }), stagingPostgres);
  assert.equal(missingConfirmation.allowed, false);
  assert.equal(missingConfirmation.state, "confirmation_required");
  for (const unsafe of [
    { target: "skinharmony-db" }, { environment: "production" },
    { rollback_ready: false }, { audit_ready: false }, { cross_tenant: true }, { destructive: true },
    { bypass_orchestrator: true }, { target_branch: "main" }, { target: "another-staging-db" },
    { reuse_existing_database: true }, { create_new: false }, { auth0_changes: true }, { merge: true },
    { production_deploy: true }, { delete: true },
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), { ...stagingPostgres, owner_confirmed: true, ...unsafe }).allowed, false);
  for (const hardBlock of [{ cross_tenant: true }, { destructive: true }, { bypass_orchestrator: true }]) {
    const result = buildActionAuthorization(contract({ risk_band: "high" }), { ...stagingPostgres, owner_confirmed: true, ...hardBlock });
    assert.equal(result.state, "blocked");
    assert.equal(result.mediation, "hard_block");
  }
  for (const changedConfirmationBinding of [{ target_branch: "main" }, { target: "another-staging-db" }]) {
    const result = buildActionAuthorization(contract({ risk_band: "high" }), { ...stagingPostgres, owner_confirmed: true, ...changedConfirmationBinding });
    assert.equal(result.confirmation_satisfied, false);
  }
});


const nyraGovernancePostgres = {
  action_type: "environment_configuration", operation_class: "reversible_owner_confirmed_deploy",
  external_side_effect: true, contains_customer_data: false, contains_secret: false, cross_tenant: false,
  destructive: false, bypass_orchestrator: false, rollback_ready: true, audit_ready: true, configuration_changes: true,
  environment: "production", target: "skinharmony-nyra-governance-db", target_service: "skinharmony-universal-core",
  resource_type: "postgresql", create_new: true, reuse_existing_database: false, database_public_access: false,
  allow_data_migration: false, auth0_changes: false, merge: false, production_deploy: false, delete: false,
  provider_execution: false, allowed_environment_variables: ["GOVERNED_AGENT_DATABASE_URL"],
  target_commit: "a9ae0a8de13ce36281d60aab5dd64c470afaf62a", confirmation_reference: "owner confirmed Nyra governance database",
};
test("authorizes only the owner-confirmed Nyra governance database configuration", () => {
  const allowed = buildActionAuthorization(contract({ risk_band: "high" }), { ...nyraGovernancePostgres, owner_confirmed: true });
  assert.equal(allowed.allowed, true); assert.equal(allowed.state, "authorized_after_confirmation");
  for (const unsafe of [
    { target: "another-db" }, { target_service: "another-service" }, { environment: "staging" }, { database_public_access: true },
    { allow_data_migration: true }, { allowed_environment_variables: ["DATABASE_URL"] }, { allowed_environment_variables: ["GOVERNED_AGENT_DATABASE_URL", "OTHER"] },
    { provider_execution: true }, { production_deploy: true }, { delete: true }, { destructive: true }, { cross_tenant: true },
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), { ...nyraGovernancePostgres, owner_confirmed: true, ...unsafe }).allowed, false);
});

const providerSetupLinkBlueprintBinding = {
  action_label: "Bind Core provider setup-link validation",
  action_type: "render_blueprint_environment_binding",
  operation_class: "reversible_owner_confirmed_provider_setup_link_blueprint_binding",
  authenticated_tenant_id: "codexai",
  tenant_id: "codexai",
  external_side_effect: true,
  contains_customer_data: false,
  contains_secret: false,
  secret_value_transmitted: false,
  cross_tenant: false,
  destructive: false,
  bypass_orchestrator: false,
  rollback_ready: true,
  audit_ready: true,
  configuration_changes: true,
  owner_context_verified: true,
  owner_context_approval_bound: true,
  environment: "production",
  target_branch: "main",
  resource_type: "render_blueprint_from_service_env_binding",
  render_blueprint_id: "exs-d99edqgki2s73e29nug",
  blueprint_path: "render-universal-core.yaml",
  source_service: "skinharmony-core-mcp",
  target_service: "skinharmony-universal-core",
  source_environment_variable: "CORE_PROVIDER_SETUP_LINK_KEY",
  target_environment_variable: "CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY",
  tenant_environment_variable: "CORE_PROVIDER_SETUP_LINK_TENANT_ID",
  tenant_environment_value: "codexai",
  create_new: false,
  rotate_existing: false,
  delete: false,
  merge: false,
  production_deploy: false,
  deploy: false,
  auth0_changes: false,
  provider_execution: false,
  execution_enabled: false,
  force: false,
  admin_bypass: false,
  allowed_environment_variables: ["CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY", "CORE_PROVIDER_SETUP_LINK_TENANT_ID"],
  target_commit: "18b689e5cde9622a280b9d34651dc18ec2d675a8",
  confirmation_target_commit: "18b689e5cde9622a280b9d34651dc18ec2d675a8",
  confirmation_target_branch: "main",
  confirmation_render_blueprint_id: "exs-d99edqgki2s73e29nug",
  confirmation_blueprint_path: "render-universal-core.yaml",
  confirmation_source_service: "skinharmony-core-mcp",
  confirmation_target_service: "skinharmony-universal-core",
  confirmation_source_environment_variable: "CORE_PROVIDER_SETUP_LINK_KEY",
  confirmation_target_environment_variable: "CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY",
  confirmation_tenant_id: "codexai",
  confirmation_reference: "owner confirmed provider setup-link Blueprint binding",
};

test("authorizes only the exact owner-confirmed provider setup-link Blueprint binding", () => {
  const pending = buildActionAuthorization(contract({ risk_band: "high" }), providerSetupLinkBlueprintBinding);
  assert.equal(pending.allowed, false);
  assert.equal(pending.state, "confirmation_required");

  const allowed = buildActionAuthorization(contract({ risk_band: "high" }), {
    ...providerSetupLinkBlueprintBinding,
    owner_confirmed: true,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.state, "authorized_after_confirmation");
  assert.equal(allowed.scope, "reversible_owner_confirmed_provider_setup_link_blueprint_binding");
  assert.equal(allowed.target_commit, providerSetupLinkBlueprintBinding.target_commit);
});

test("keeps every variation of the provider setup-link Blueprint binding closed", () => {
  for (const unsafe of [
    { authenticated_tenant_id: "another-tenant" }, { tenant_id: "another-tenant" }, { owner_context_verified: false }, { owner_context_approval_bound: false },
    { render_blueprint_id: "another-blueprint" }, { confirmation_render_blueprint_id: "another-blueprint" },
    { blueprint_path: "universal-core/render.yaml" }, { target_service: "other-service" }, { target_branch: "feature/other" },
    { source_service: "other-mcp" }, { source_environment_variable: "OTHER_KEY" },
    { target_environment_variable: "DATABASE_URL" }, { tenant_environment_variable: "TENANT_ID" },
    { tenant_environment_value: "another-tenant" }, { resource_type: "render_environment_secret_reference" },
    { allowed_environment_variables: ["CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY"] },
    { allowed_environment_variables: ["CORE_PROVIDER_SETUP_LINK_TENANT_ID", "CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY"] },
    { create_new: true }, { rotate_existing: true }, { delete: true }, { merge: true }, { production_deploy: true }, { deploy: true },
    { auth0_changes: true }, { provider_execution: true }, { execution_enabled: true }, { force: true }, { admin_bypass: true },
    { contains_secret: true }, { secret_value_transmitted: true }, { cross_tenant: true }, { destructive: true }, { bypass_orchestrator: true },
    { target_commit: "main" }, { confirmation_target_commit: "7".repeat(40) }, { confirmation_target_branch: "release" },
    { confirmation_blueprint_path: "universal-core/render.yaml" }, { confirmation_source_service: "other-mcp" },
    { confirmation_target_service: "other-service" }, { confirmation_source_environment_variable: "OTHER_KEY" },
    { confirmation_target_environment_variable: "DATABASE_URL" }, { confirmation_tenant_id: "another-tenant" },
  ]) {
    assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), {
      ...providerSetupLinkBlueprintBinding,
      owner_confirmed: true,
      ...unsafe,
    }).allowed, false);
  }

  for (const hardBlock of [
    { contains_secret: true }, { secret_value_transmitted: true }, { cross_tenant: true }, { destructive: true }, { bypass_orchestrator: true },
    { auth0_changes: true }, { provider_execution: true }, { execution_enabled: true },
    { create_new: true }, { rotate_existing: true }, { delete: true }, { merge: true }, { production_deploy: true }, { deploy: true },
    { force: true }, { admin_bypass: true }, { unrecognized_render_change: true },
  ]) {
    const result = buildActionAuthorization(contract({ risk_band: "high" }), {
      ...providerSetupLinkBlueprintBinding,
      owner_confirmed: true,
      ...hardBlock,
    });
    assert.equal(result.state, "blocked");
    assert.equal(result.mediation, "hard_block");
  }
});

const deepSoftware = {
  action_type: "software_analysis",
  operation_class: "governed_deep_software_analysis",
  external_side_effect: false,
  contains_customer_data: false,
  cross_tenant: false,
  sandbox_ready: true,
  audit_ready: true,
  authorization_basis: "owned",
  allowed_modes: ["ghidra_headless"],
};

test("authorizes only owner-confirmed low-risk deep software analysis", () => {
  assert.equal(buildActionAuthorization(contract({ control_level: "suggest" }), deepSoftware).allowed, false);
  const allowed = buildActionAuthorization(contract({ control_level: "suggest" }), { ...deepSoftware, owner_confirmed: true });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.scope, "governed_deep_software_analysis");
  assert.equal(allowed.confirmation_satisfied, true);
});

test("deep software analysis fails closed without sandbox, audit, basis or dynamic allowlist", () => {
  for (const unsafe of [
    { ...deepSoftware, owner_confirmed: true, sandbox_ready: false },
    { ...deepSoftware, owner_confirmed: true, audit_ready: false },
    { ...deepSoftware, owner_confirmed: true, authorization_basis: "unknown" },
    { ...deepSoftware, owner_confirmed: true, allowed_modes: ["frida_local_agent"], target_allowlist: [] },
    { ...deepSoftware, owner_confirmed: true, cross_tenant: true },
  ]) assert.equal(buildActionAuthorization(contract({ control_level: "suggest" }), unsafe).allowed, false);
});

const reversibleBranchChange = {
  action_type: "repository_file_update",
  operation_class: "reversible_owner_confirmed_branch_change",
  external_side_effect: true,
  contains_customer_data: false,
  contains_secret: false,
  cross_tenant: false,
  destructive: false,
  bypass_orchestrator: false,
  configuration_changes: false,
  rollback_ready: true,
  audit_ready: true,
  target_commit: "4cb397cdec02c8a0f45582f990e4171ec992c44e",
  target_branch: "agent/cockpit-360-e2e",
  confirmation_reference: "owner-confirmed-branch-change",
};

test("authorizes only a confirmed reversible code-only agent branch update", () => {
  const pending = buildActionAuthorization(contract({ risk_band: "high" }), reversibleBranchChange);
  assert.equal(pending.allowed, false);
  const allowed = buildActionAuthorization(contract({ risk_band: "high" }), { ...reversibleBranchChange, owner_confirmed: true });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.scope, "reversible_owner_confirmed_branch_change");
  for (const unsafe of [
    { ...reversibleBranchChange, owner_confirmed: true, target_branch: "main" },
    { ...reversibleBranchChange, owner_confirmed: true, rollback_ready: false },
    { ...reversibleBranchChange, owner_confirmed: true, audit_ready: false },
    { ...reversibleBranchChange, owner_confirmed: true, configuration_changes: true },
    { ...reversibleBranchChange, owner_confirmed: true, contains_secret: true },
    { ...reversibleBranchChange, owner_confirmed: true, destructive: true },
    { ...reversibleBranchChange, owner_confirmed: true, bypass_orchestrator: true },
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), unsafe).allowed, false);
});

const draftPullRequest = {
  action_type: "github_draft_pull_request",
  operation_class: "reversible_owner_confirmed_draft_pull_request",
  external_side_effect: true,
  contains_customer_data: false,
  contains_secret: false,
  cross_tenant: false,
  destructive: false,
  bypass_orchestrator: false,
  configuration_changes: false,
  rollback_ready: true,
  audit_ready: true,
  target_commit: "66023353621801f54336f282a0b42c545adab32d",
  target_branch: "agent/smartdesk-durable-completion",
  base_branch: "main",
  repository: "cardarellocristian86-debug/skinharmony-ai-backend",
  draft: true,
  merge: false,
  deploy: false,
  delete: false,
  confirmation_reference: "owner-confirmed-draft-pr",
};

test("authorizes only an exact owner-confirmed GitHub draft pull request", () => {
  const pending = buildActionAuthorization(contract({ risk_band: "high" }), draftPullRequest);
  assert.equal(pending.allowed, false);
  const allowed = buildActionAuthorization(contract({ risk_band: "high" }), { ...draftPullRequest, owner_confirmed: true });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.scope, "reversible_owner_confirmed_draft_pull_request");
  for (const unsafe of [
    { draft: false }, { merge: true }, { deploy: true }, { delete: true },
    { base_branch: "release" }, { target_branch: "main" }, { configuration_changes: true },
    { contains_secret: true }, { cross_tenant: true }, { rollback_ready: false },
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), { ...draftPullRequest, owner_confirmed: true, ...unsafe }).allowed, false);
  for (const changedConfirmationBinding of [{ draft: false }, { merge: true }, { base_branch: "release" }]) {
    const result = buildActionAuthorization(contract({ risk_band: "high" }), { ...draftPullRequest, owner_confirmed: true, ...changedConfirmationBinding });
    assert.equal(result.confirmation_satisfied, false);
  }
});

const pullRequestMerge = {
  action_type: "github_pull_request_merge",
  operation_class: "reversible_owner_confirmed_pull_request_merge",
  external_side_effect: true,
  contains_customer_data: false,
  contains_secret: false,
  cross_tenant: false,
  destructive: false,
  bypass_orchestrator: false,
  configuration_changes: false,
  rollback_ready: true,
  audit_ready: true,
  target_commit: "66023353621801f54336f282a0b42c545adab32d",
  target_branch: "agent/smartdesk-durable-completion",
  base_branch: "main",
  repository: "cardarellocristian86-debug/skinharmony-ai-backend",
  pull_request: 59,
  draft: false,
  merge: true,
  deploy: false,
  delete: false,
  force: false,
  admin_bypass: false,
  merge_method: "squash",
  checks_verified: true,
  checks_commit: "66023353621801f54336f282a0b42c545adab32d",
  confirmation_pull_request: 59,
  confirmation_target_commit: "66023353621801f54336f282a0b42c545adab32d",
  confirmation_target_branch: "agent/smartdesk-durable-completion",
  confirmation_base_branch: "main",
  confirmation_repository: "cardarellocristian86-debug/skinharmony-ai-backend",
  confirmation_reference: "owner-confirmed-merge-pr59",
};

test("authorizes only a verified owner-confirmed protected-branch pull request merge", () => {
  const pending = buildActionAuthorization(contract({ risk_band: "high" }), pullRequestMerge);
  assert.equal(pending.allowed, false);
  const allowed = buildActionAuthorization(contract({ risk_band: "high" }), { ...pullRequestMerge, owner_confirmed: true });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.scope, "reversible_owner_confirmed_pull_request_merge");
  assert.equal(allowed.target_commit, pullRequestMerge.target_commit);
  for (const unsafe of [
    { pull_request: 0 }, { target_branch: "main" }, { base_branch: "release" },
    { draft: true }, { merge: false }, { deploy: true }, { delete: true },
    { force: true }, { admin_bypass: true }, { merge_method: "auto" },
    { checks_verified: false }, { checks_commit: "7".repeat(40) },
    { configuration_changes: true }, { contains_secret: true }, { cross_tenant: true },
    { rollback_ready: false }, { audit_ready: false },
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), { ...pullRequestMerge, owner_confirmed: true, ...unsafe }).allowed, false);
  for (const changedConfirmationBinding of [
    { pull_request: 60 }, { target_branch: "agent/other" }, { checks_commit: "7".repeat(40) }, { merge: false },
  ]) {
    const result = buildActionAuthorization(contract({ risk_band: "high" }), { ...pullRequestMerge, owner_confirmed: true, ...changedConfirmationBinding });
    assert.equal(result.confirmation_satisfied, false);
  }
});

test("allows a bound owner-confirmed draft-to-review transition and nothing else", () => {
  const transition = {
    ...pullRequestMerge,
    action_type: "github_pull_request_ready_for_review",
    operation_class: "reversible_owner_confirmed_pull_request_review_transition",
    draft: true, ready_for_review: true, merge: false,
  };
  const allowed = buildActionAuthorization(contract({ risk_band: "high" }), { ...transition, owner_confirmed: true });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.scope, "reversible_owner_confirmed_pull_request_review_transition");
  for (const unsafe of [{ ready_for_review: false }, { merge: true }, { deploy: true }, { delete: true }, { force: true }, { pull_request: 60 }]) {
    assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), { ...transition, owner_confirmed: true, ...unsafe }).allowed, false);
  }
});

const connectorMetadataRefresh = {
  action_type: "chatgpt_app_metadata_refresh",
  operation_class: "reversible_owner_confirmed_connector_metadata_refresh",
  external_side_effect: true,
  contains_customer_data: false,
  contains_secret: false,
  secret_value_transmitted: false,
  cross_tenant: false,
  destructive: false,
  bypass_orchestrator: false,
  configuration_changes: false,
  endpoint_changes: false,
  oauth_changes: false,
  scope_changes: false,
  permission_changes: false,
  tenant_binding_changes: false,
  rollback_ready: true,
  audit_ready: true,
  target_commit: "1".repeat(40),
  target_client: "chatgpt",
  connector_id: "skinharmony_core",
  configured_endpoint: "https://skinharmony-core-mcp.onrender.com/mcp",
  refresh_endpoint: "https://skinharmony-core-mcp.onrender.com/mcp",
  target_tenant_id: "codexai",
  authenticated_tenant_id: "codexai",
  metadata_refresh_only: true,
  expected_tool_count: 67,
  installed_tool_count_before: 43,
  create_app: false,
  delete_app: false,
  reconnect: false,
  deploy: false,
  merge: false,
  confirmation_connector_id: "skinharmony_core",
  confirmation_endpoint: "https://skinharmony-core-mcp.onrender.com/mcp",
  confirmation_target_commit: "1".repeat(40),
  confirmation_expected_tool_count: 67,
  confirmation_target_tenant_id: "codexai",
  confirmation_reference: "owner-confirmed-chatgpt-metadata-refresh",
};

test("authorizes only the exact owner-confirmed ChatGPT connector metadata refresh", () => {
  const pending = buildActionAuthorization(contract({ risk_band: "high" }), connectorMetadataRefresh);
  assert.equal(pending.allowed, false);
  const allowed = buildActionAuthorization(contract({ risk_band: "high" }), { ...connectorMetadataRefresh, owner_confirmed: true });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.scope, "reversible_owner_confirmed_connector_metadata_refresh");
  for (const unsafe of [
    { endpoint_changes: true }, { oauth_changes: true }, { scope_changes: true }, { permission_changes: true },
    { target_tenant_id: "other" }, { reconnect: true }, { deploy: true }, { expected_tool_count: 66 },
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), { ...connectorMetadataRefresh, owner_confirmed: true, ...unsafe }).allowed, false);
});

const connectorKeyRotation = {
  action_type: "render_core_connector_key_rotation",
  operation_class: "reversible_owner_confirmed_core_connector_key_rotation",
  external_side_effect: true,
  contains_customer_data: false,
  contains_secret: false,
  secret_value_transmitted: false,
  cross_tenant: false,
  destructive: false,
  bypass_orchestrator: false,
  configuration_changes: true,
  endpoint_changes: false,
  oauth_changes: false,
  scope_changes: true,
  permission_changes: true,
  tenant_binding_changes: false,
  rollback_ready: true,
  audit_ready: true,
  target_commit: "2".repeat(40),
  environment: "production",
  source_service: "skinharmony-universal-core",
  target_service: "skinharmony-core-mcp",
  target_environment_variable: "CORE_MCP_KEY",
  resource_type: "render_environment_secret_reference",
  target_tenant_id: "codexai",
  authenticated_tenant_id: "codexai",
  current_key_id: "key_a92869f0-0f1b-46d3-8f2a-065655ef5a72",
  target_scope: "write:intelligence_outcome",
  owner_assertion_scope: "owner:assertion",
  allowed_scope_changes: ["write:intelligence_outcome", "owner:assertion"],
  create_new_key: true,
  replace_secret_reference: true,
  revoke_old_key: false,
  provider_execution: false,
  service_restart_required: true,
  deploy: true,
  merge: false,
  delete: false,
  confirmation_current_key_id: "key_a92869f0-0f1b-46d3-8f2a-065655ef5a72",
  confirmation_target_scope: "write:intelligence_outcome",
  confirmation_owner_assertion_scope: "owner:assertion",
  confirmation_target_service: "skinharmony-core-mcp",
  confirmation_target_tenant_id: "codexai",
  confirmation_target_commit: "2".repeat(40),
  confirmation_reference: "owner-confirmed-least-privilege-core-key-rotation",
};

test("authorizes a least-privilege Core connector key rotation without secret material", () => {
  const allowed = buildActionAuthorization(contract({ risk_band: "high" }), { ...connectorKeyRotation, owner_confirmed: true });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.scope, "reversible_owner_confirmed_core_connector_key_rotation");
  for (const unsafe of [
    { target_scope: "write:snapshot" }, { owner_assertion_scope: "automation:codex" },
    { allowed_scope_changes: ["write:intelligence_outcome", "write:snapshot"] },
    { contains_secret: true }, { secret_value_transmitted: true }, { revoke_old_key: true }, { target_tenant_id: "other" },
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), { ...connectorKeyRotation, owner_confirmed: true, ...unsafe }).allowed, false);
});

const verifiedOutcomeRecord = {
  action_type: "outcome_record",
  operation_class: "verified_outcome_record",
  external_side_effect: false,
  contains_customer_data: false,
  contains_secret: false,
  secret_value_transmitted: false,
  cross_tenant: false,
  destructive: false,
  bypass_orchestrator: false,
  configuration_changes: false,
  rollback_ready: true,
  audit_ready: true,
  verified_outcome: true,
  live_weight_mutation: false,
  target_tenant_id: "codexai",
  authenticated_tenant_id: "codexai",
  outcome_id: "deploy-check:2026-07-19",
  predicted_probability: 0.92,
  actual_outcome: true,
  confirmation_outcome_id: "deploy-check:2026-07-19",
  confirmation_target_tenant_id: "codexai",
  confirmation_reference: "signed_owner_context",
};

test("authorizes only a verified, tenant-bound and owner-confirmed outcome record", () => {
  const allowed = buildActionAuthorization(contract(), { ...verifiedOutcomeRecord, owner_confirmed: true });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.scope, "verified_outcome_record");
  for (const unsafe of [
    { verified_outcome: false }, { live_weight_mutation: true }, { target_tenant_id: "other" },
    { predicted_probability: 2 }, { actual_outcome: "unknown" }, { confirmation_outcome_id: "different" },
  ]) assert.equal(buildActionAuthorization(contract(), { ...verifiedOutcomeRecord, owner_confirmed: true, ...unsafe }).allowed, false);
});

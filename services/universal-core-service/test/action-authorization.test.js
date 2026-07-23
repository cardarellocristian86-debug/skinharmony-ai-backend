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

const adminControlRoomSecretConfiguration = {
  action_label: "Configure Core Admin Control Room bootstrap references",
  action_type: "environment_configuration",
  operation_class: "reversible_owner_confirmed_core_admin_bootstrap_configuration",
  authenticated_tenant_id: "codexai",
  tenant_id: "codexai",
  authenticated_key_type: "connector",
  request_bound_owner_confirmation: true,
  owner_context_verified: true,
  owner_context_approval_bound: false,
  external_side_effect: true,
  contains_customer_data: false,
  contains_secret: false,
  secret_value_transmitted: false,
  values_present_in_envelope: false,
  cross_tenant: false,
  destructive: false,
  bypass_orchestrator: false,
  rollback_ready: true,
  audit_ready: true,
  readback_required: true,
  configuration_changes: true,
  environment: "production",
  target: "skinharmony-core-nyra-admin-login",
  target_service: "skinharmony-universal-core",
  target_service_id: "srv-d82c9j3tqb8s73cgriag",
  resource_type: "render_environment_variable_bundle",
  render_environment_update: true,
  other_environment_changes: false,
  create_missing_only: true,
  overwrite_existing: false,
  current_values_present: false,
  rollback_remove_new_variables: true,
  auth0_changes: false,
  database_changes: false,
  storage_changes: false,
  domain_changes: false,
  scaling_changes: false,
  merge: false,
  deploy: false,
  production_deploy: false,
  delete: false,
  provider_execution: false,
  execution_enabled: false,
  force: false,
  admin_bypass: false,
  allowed_environment_variables: [
    "CORE_ADMIN_SESSION_SECRET",
    "CORE_ADMIN_BOOTSTRAP_USERNAME",
    "CORE_ADMIN_BOOTSTRAP_PASSWORD",
  ],
  target_commit: "1496d96600592bea4d945333083d1a3c2f1d4f4c",
  confirmation_target_service: "skinharmony-universal-core",
  confirmation_target_service_id: "srv-d82c9j3tqb8s73cgriag",
  confirmation_target_commit: "1496d96600592bea4d945333083d1a3c2f1d4f4c",
  confirmation_environment_variables: [
    "CORE_ADMIN_SESSION_SECRET",
    "CORE_ADMIN_BOOTSTRAP_USERNAME",
    "CORE_ADMIN_BOOTSTRAP_PASSWORD",
  ],
  confirmation_reference: "owner-confirmed-core-nyra-admin-login",
};

test("authorizes only the exact owner-confirmed Core and Nyra admin login secret references", () => {
  const pending = buildActionAuthorization(contract({ risk_band: "high" }), adminControlRoomSecretConfiguration);
  assert.equal(pending.allowed, false);
  const allowed = buildActionAuthorization(contract({ risk_band: "high" }), {
    ...adminControlRoomSecretConfiguration,
    owner_confirmed: true,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.state, "authorized_after_confirmation");
  assert.equal(allowed.scope, "reversible_owner_confirmed_core_admin_bootstrap_configuration");
  assert.equal(allowed.target_commit, adminControlRoomSecretConfiguration.target_commit);

  for (const unsafe of [
    { contains_secret: true },
    { secret_value_transmitted: true },
    { values_present_in_envelope: true },
    { target_service: "another-service" },
    { target_service_id: "srv-other" },
    { environment: "staging" },
    { allowed_environment_variables: ["CORE_ADMIN_BOOTSTRAP_PASSWORD"] },
    { allowed_environment_variables: [...adminControlRoomSecretConfiguration.allowed_environment_variables, "DATABASE_URL"] },
    { confirmation_environment_variables: ["CORE_ADMIN_SESSION_SECRET"] },
    { confirmation_target_commit: "7".repeat(40) },
    { current_values_present: true },
    { rollback_remove_new_variables: false },
    { production_deploy: true },
    { deploy: true },
    { readback_required: false },
    { provider_execution: true },
    { auth0_changes: true },
    { delete: true },
    { cross_tenant: true },
    { unexpected_field: true },
    { request_bound_owner_confirmation: false },
    { authenticated_key_type: "automation" },
    { owner_context_verified: false },
  ]) {
    const result = buildActionAuthorization(contract({ risk_band: "high" }), {
      ...adminControlRoomSecretConfiguration,
      owner_confirmed: true,
      ...unsafe,
    });
    assert.equal(result.allowed, false);
  }
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

const mcpDefaultTenantCorrection = {
  action_type: "render_mcp_default_tenant_correction",
  operation_class: "reversible_owner_confirmed_mcp_default_tenant_correction",
  request_bound_owner_confirmation: true,
  authenticated_key_type: "connector",
  external_side_effect: true,
  contains_customer_data: false,
  contains_secret: false,
  secret_value_transmitted: false,
  secret_changes: false,
  key_changes: false,
  cross_tenant: false,
  destructive: false,
  bypass_orchestrator: false,
  configuration_changes: true,
  tenant_binding_changes: true,
  endpoint_changes: false,
  oauth_changes: false,
  scope_changes: false,
  permission_changes: false,
  other_environment_changes: false,
  other_configuration_changes: false,
  render_environment_update: true,
  source_of_truth_update_only: false,
  data_migration: false,
  memory_migration: false,
  rollback_ready: true,
  audit_ready: true,
  readback_required: true,
  target_commit: "4".repeat(40),
  deployed_commit: "4".repeat(40),
  environment: "production",
  target_service: "skinharmony-core-mcp",
  target_service_id: "srv-d99ef1mcjfls73857m40",
  resource_type: "render_environment_variable",
  target_environment_variable: "MCP_DEFAULT_TENANT_ID",
  allowed_environment_variables: ["MCP_DEFAULT_TENANT_ID"],
  current_tenant_id: "owner-private",
  target_tenant_id: "codexai",
  authenticated_tenant_id: "codexai",
  current_value_verified: true,
  rollback_tenant_id: "owner-private",
  service_restart_required: true,
  deploy: true,
  create_new: false,
  delete: false,
  merge: false,
  provider_execution: false,
  confirmation_target_commit: "4".repeat(40),
  confirmation_target_service: "skinharmony-core-mcp",
  confirmation_target_service_id: "srv-d99ef1mcjfls73857m40",
  confirmation_environment_variable: "MCP_DEFAULT_TENANT_ID",
  confirmation_current_tenant_id: "owner-private",
  confirmation_target_tenant_id: "codexai",
  confirmation_reference: "owner-confirmed-mcp-default-tenant-correction",
};

test("authorizes only the exact request-bound MCP default tenant correction", () => {
  const allowed = buildActionAuthorization(contract({ risk_band: "high" }), {
    ...mcpDefaultTenantCorrection,
    owner_confirmed: true,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.scope, "reversible_owner_confirmed_mcp_default_tenant_correction");
  assert.equal(allowed.target_commit, "4".repeat(40));
  for (const unsafe of [
    { request_bound_owner_confirmation: false }, { authenticated_key_type: "automation" },
    { target_commit: "main" }, { deployed_commit: "5".repeat(40) },
    { target_service: "another-service" }, { target_service_id: "srv-other" },
    { target_environment_variable: "MCP_CHATGPT_TENANT_ID" },
    { allowed_environment_variables: ["MCP_DEFAULT_TENANT_ID", "MCP_CHATGPT_TENANT_ID"] },
    { current_tenant_id: "codexai" }, { target_tenant_id: "owner-private" },
    { authenticated_tenant_id: "owner-private" }, { current_value_verified: false },
    { endpoint_changes: true }, { oauth_changes: true }, { scope_changes: true }, { permission_changes: true },
    { secret_changes: true }, { key_changes: true }, { other_environment_changes: true },
    { other_configuration_changes: true }, { render_environment_update: false }, { source_of_truth_update_only: true },
    { data_migration: true }, { memory_migration: true }, { rollback_ready: false }, { audit_ready: false },
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), {
    ...mcpDefaultTenantCorrection,
    owner_confirmed: true,
    ...unsafe,
  }).allowed, false);
});

const mcpDefaultTenantBlueprintBase = {
  action_type: "github_mcp_default_tenant_blueprint_alignment",
  operation_class: "reversible_owner_confirmed_mcp_default_tenant_correction",
  request_bound_owner_confirmation: true,
  authenticated_key_type: "connector",
  external_side_effect: true,
  contains_customer_data: false,
  contains_secret: false,
  secret_value_transmitted: false,
  secret_changes: false,
  key_changes: false,
  cross_tenant: false,
  destructive: false,
  bypass_orchestrator: false,
  configuration_changes: true,
  tenant_binding_changes: true,
  endpoint_changes: false,
  oauth_changes: false,
  scope_changes: false,
  permission_changes: false,
  other_environment_changes: false,
  other_configuration_changes: false,
  data_migration: false,
  memory_migration: false,
  provider_execution: false,
  render_environment_update: false,
  source_of_truth_update_only: true,
  rollback_ready: true,
  audit_ready: true,
  readback_required: true,
  target_commit: "8".repeat(40),
  base_commit: "7".repeat(40),
  target_parent_commit: "7".repeat(40),
  base_commit_verified: true,
  changed_files_verified: true,
  diff_verified: true,
  changed_file_count: 2,
  blueprint_change_count: 1,
  blueprint_diff_additions: 1,
  blueprint_diff_deletions: 1,
  ci_guardrail_change: true,
  ci_guardrail_verified: true,
  environment: "production",
  target_service: "skinharmony-core-mcp",
  target_service_id: "srv-d99ef1mcjfls73857m40",
  resource_type: "render_blueprint_source_of_truth",
  repository: "cardarellocristian86-debug/skinharmony-ai-backend",
  base_branch: "main",
  target_branch: "agent/align-mcp-default-tenant-blueprint",
  target_file: "render-core-mcp.yaml",
  ci_workflow_file: ".github/workflows/nyra-core-intelligence.yml",
  allowed_files: ["render-core-mcp.yaml", ".github/workflows/nyra-core-intelligence.yml"],
  target_environment_variable: "MCP_DEFAULT_TENANT_ID",
  blueprint_current_tenant_id: "owner-private",
  target_tenant_id: "codexai",
  authenticated_tenant_id: "codexai",
  live_tenant_id: "codexai",
  blueprint_current_value_verified: true,
  live_value_verified: true,
  live_canary_verified: true,
  blueprint_apply_idempotent: true,
  rollback_tenant_id: "owner-private",
  create_new: false,
  delete: false,
  force: false,
  admin_bypass: false,
  confirmation_target_commit: "8".repeat(40),
  confirmation_base_commit: "7".repeat(40),
  confirmation_target_service: "skinharmony-core-mcp",
  confirmation_target_service_id: "srv-d99ef1mcjfls73857m40",
  confirmation_repository: "cardarellocristian86-debug/skinharmony-ai-backend",
  confirmation_base_branch: "main",
  confirmation_target_branch: "agent/align-mcp-default-tenant-blueprint",
  confirmation_target_file: "render-core-mcp.yaml",
  confirmation_environment_variable: "MCP_DEFAULT_TENANT_ID",
  confirmation_current_tenant_id: "owner-private",
  confirmation_target_tenant_id: "codexai",
  confirmation_allowed_files: ["render-core-mcp.yaml", ".github/workflows/nyra-core-intelligence.yml"],
  confirmation_reference: "owner-confirmed-mcp-default-tenant-blueprint-alignment",
};

function mcpDefaultTenantBlueprintPhase(workflowPhase) {
  const base = {
    ...mcpDefaultTenantBlueprintBase,
    workflow_phase: workflowPhase,
    confirmation_workflow_phase: workflowPhase,
    branch_publish: false,
    create_new_branch: false,
    create_pull_request: false,
    draft: false,
    ready_for_review: false,
    merge: false,
    deploy: false,
    automatic_deploy_expected: false,
    service_restart_required: false,
    post_merge_commit_readback_required: false,
    automatic_deploy_services: [],
    automatic_deploy_service_ids: [],
  };
  if (workflowPhase === "branch_publish") {
    return {
      ...base,
      branch_publish: true,
      create_new_branch: true,
      remote_branch_absent_verified: true,
      rollback_strategy: "delete_unmerged_branch",
    };
  }
  if (workflowPhase === "draft_pull_request") {
    return {
      ...base,
      remote_branch_commit_verified: true,
      create_pull_request: true,
      draft: true,
      rollback_strategy: "close_draft_pull_request",
    };
  }
  if (workflowPhase === "ready_for_review") {
    return {
      ...base,
      pull_request: 103,
      confirmation_pull_request: 103,
      checks_verified: true,
      required_checks_verified: true,
      checks_commit: "8".repeat(40),
      pull_request_head_verified: true,
      draft: true,
      ready_for_review: true,
      rollback_strategy: "return_pull_request_to_draft",
    };
  }
  if (workflowPhase === "merge") {
    return {
      ...base,
      pull_request: 103,
      confirmation_pull_request: 103,
      checks_verified: true,
      required_checks_verified: true,
      checks_commit: "8".repeat(40),
      pull_request_head_verified: true,
      review_verified: true,
      reviewed_diff_verified: true,
      current_pull_request_draft: false,
      merge: true,
      deploy: true,
      automatic_deploy_expected: true,
      service_restart_required: true,
      post_merge_commit_readback_required: true,
      merge_result_commit_pending: true,
      automatic_deploy_services: ["skinharmony-universal-core", "skinharmony-core-mcp"],
      automatic_deploy_service_ids: ["srv-d82c9j3tqb8s73cgriag", "srv-d99ef1mcjfls73857m40"],
      merge_method: "squash",
      confirmation_merge_method: "squash",
      rollback_strategy: "forward_revert_with_coordinated_runtime_rollback",
    };
  }
  return base;
}

for (const workflowPhase of ["branch_publish", "draft_pull_request", "ready_for_review", "merge"]) {
  test(`authorizes only the exact MCP tenant blueprint ${workflowPhase} phase`, () => {
    const input = mcpDefaultTenantBlueprintPhase(workflowPhase);
    const pending = buildActionAuthorization(contract({ risk_band: "high" }), input);
    assert.equal(pending.allowed, false);
    assert.equal(pending.confirmation_required, true);
    const allowed = buildActionAuthorization(contract({ risk_band: "high" }), { ...input, owner_confirmed: true });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.scope, "reversible_owner_confirmed_mcp_default_tenant_blueprint_alignment");
    assert.equal(allowed.target_commit, "8".repeat(40));
    assert.equal(allowed.workflow_phase, workflowPhase);
  });
}

test("MCP tenant blueprint alignment fails closed on any common-scope drift", () => {
  const merge = mcpDefaultTenantBlueprintPhase("merge");
  for (const unsafe of [
    { action_type: "repository_file_update" }, { workflow_phase: "unknown" },
    { confirmation_workflow_phase: "ready_for_review" }, { request_bound_owner_confirmation: false },
    { authenticated_key_type: "automation" }, { contains_secret: true }, { secret_value_transmitted: true },
    { secret_changes: true }, { key_changes: true }, { cross_tenant: true }, { destructive: true },
    { bypass_orchestrator: true }, { configuration_changes: false }, { tenant_binding_changes: false },
    { endpoint_changes: true }, { oauth_changes: true }, { scope_changes: true }, { permission_changes: true },
    { other_environment_changes: true }, { other_configuration_changes: true }, { data_migration: true },
    { memory_migration: true }, { provider_execution: true }, { render_environment_update: true },
    { source_of_truth_update_only: false }, { rollback_ready: false }, { audit_ready: false }, { readback_required: false },
    { target_commit: "main" }, { target_commit: "7".repeat(40) }, { base_commit: "main" },
    { target_parent_commit: "6".repeat(40) }, { base_commit_verified: false },
    { changed_files_verified: false }, { diff_verified: false }, { changed_file_count: "2" },
    { changed_file_count: 1 }, { blueprint_change_count: 2 }, { blueprint_diff_additions: 2 },
    { blueprint_diff_deletions: 0 }, { ci_guardrail_change: false }, { ci_guardrail_verified: false },
    { environment: "staging" }, { target_service: "another-service" }, { target_service_id: "srv-other" },
    { resource_type: "repository_file" }, { repository: "other/repository" }, { base_branch: "release" },
    { target_branch: "agent/other" }, { target_file: "render.yaml" }, { ci_workflow_file: ".github/workflows/other.yml" },
    { allowed_files: ["render-core-mcp.yaml"] },
    { allowed_files: [".github/workflows/nyra-core-intelligence.yml", "render-core-mcp.yaml"] },
    { target_environment_variable: "MCP_CHATGPT_TENANT_ID" }, { blueprint_current_tenant_id: "codexai" },
    { target_tenant_id: "owner-private" }, { authenticated_tenant_id: "owner-private" },
    { live_tenant_id: "owner-private" }, { blueprint_current_value_verified: false },
    { live_value_verified: false }, { live_canary_verified: false }, { blueprint_apply_idempotent: false },
    { rollback_tenant_id: "codexai" }, { create_new: true }, { delete: true }, { force: true }, { admin_bypass: true },
    { confirmation_target_commit: "9".repeat(40) }, { confirmation_base_commit: "6".repeat(40) },
    { confirmation_target_service: "other" }, { confirmation_target_service_id: "srv-other" },
    { confirmation_repository: "other/repository" }, { confirmation_base_branch: "release" },
    { confirmation_target_branch: "agent/other" }, { confirmation_target_file: "render.yaml" },
    { confirmation_environment_variable: "MCP_CHATGPT_TENANT_ID" },
    { confirmation_current_tenant_id: "codexai" }, { confirmation_target_tenant_id: "owner-private" },
    { confirmation_allowed_files: ["render-core-mcp.yaml"] }, { confirmation_reference: "token=unsafe" },
  ]) {
    const denied = buildActionAuthorization(contract({ risk_band: "high" }), {
      ...merge,
      owner_confirmed: true,
      ...unsafe,
    });
    assert.equal(denied.allowed, false, JSON.stringify(unsafe));
  }

  const unknownAction = buildActionAuthorization(contract({ risk_band: "high" }), {
    ...merge,
    owner_confirmed: true,
    action_type: "unknown_mcp_default_tenant_action",
  });
  assert.equal(unknownAction.allowed, false);
  assert.equal(unknownAction.confirmation_required, true);
  assert.equal(unknownAction.confirmation_satisfied, false);
});

test("MCP tenant blueprint branch publication cannot inherit another phase", () => {
  const branch = mcpDefaultTenantBlueprintPhase("branch_publish");
  for (const unsafe of [
    { branch_publish: false }, { create_new_branch: false }, { remote_branch_absent_verified: false },
    { create_pull_request: true }, { draft: true }, { ready_for_review: true }, { merge: true }, { deploy: true },
    { automatic_deploy_expected: true }, { service_restart_required: true },
    { post_merge_commit_readback_required: true }, { automatic_deploy_services: ["skinharmony-core-mcp"] },
    { automatic_deploy_service_ids: ["srv-d99ef1mcjfls73857m40"] }, { rollback_strategy: "close_draft_pull_request" },
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), {
    ...branch, owner_confirmed: true, ...unsafe,
  }).allowed, false, JSON.stringify(unsafe));
});

test("MCP tenant blueprint draft PR cannot publish, review, merge or deploy", () => {
  const draft = mcpDefaultTenantBlueprintPhase("draft_pull_request");
  for (const unsafe of [
    { branch_publish: true }, { create_new_branch: true }, { remote_branch_commit_verified: false },
    { create_pull_request: false }, { draft: false }, { ready_for_review: true }, { merge: true }, { deploy: true },
    { automatic_deploy_expected: true }, { service_restart_required: true },
    { post_merge_commit_readback_required: true }, { automatic_deploy_services: ["skinharmony-core-mcp"] },
    { automatic_deploy_service_ids: ["srv-d99ef1mcjfls73857m40"] }, { rollback_strategy: "delete_unmerged_branch" },
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), {
    ...draft, owner_confirmed: true, ...unsafe,
  }).allowed, false, JSON.stringify(unsafe));
});

test("MCP tenant blueprint review transition requires the exact checked PR head", () => {
  const ready = mcpDefaultTenantBlueprintPhase("ready_for_review");
  for (const unsafe of [
    { pull_request: 0 }, { confirmation_pull_request: 104 }, { checks_verified: false },
    { required_checks_verified: false }, { checks_commit: "9".repeat(40) }, { pull_request_head_verified: false },
    { branch_publish: true }, { create_new_branch: true }, { create_pull_request: true },
    { draft: false }, { ready_for_review: false }, { merge: true }, { deploy: true },
    { automatic_deploy_expected: true }, { service_restart_required: true },
    { post_merge_commit_readback_required: true }, { automatic_deploy_services: ["skinharmony-core-mcp"] },
    { automatic_deploy_service_ids: ["srv-d99ef1mcjfls73857m40"] }, { rollback_strategy: "close_draft_pull_request" },
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), {
    ...ready, owner_confirmed: true, ...unsafe,
  }).allowed, false, JSON.stringify(unsafe));
});

test("MCP tenant blueprint merge exposes auto-deploy and coordinated rollback", () => {
  const merge = mcpDefaultTenantBlueprintPhase("merge");
  for (const unsafe of [
    { pull_request: 0 }, { confirmation_pull_request: 104 }, { checks_verified: false },
    { required_checks_verified: false }, { checks_commit: "9".repeat(40) }, { pull_request_head_verified: false },
    { review_verified: false }, { reviewed_diff_verified: false }, { current_pull_request_draft: true },
    { branch_publish: true }, { create_new_branch: true }, { create_pull_request: true },
    { draft: true }, { ready_for_review: true }, { merge: false }, { deploy: false },
    { automatic_deploy_expected: false }, { service_restart_required: false },
    { post_merge_commit_readback_required: false }, { merge_result_commit_pending: false },
    { automatic_deploy_services: ["skinharmony-core-mcp", "skinharmony-universal-core"] },
    { automatic_deploy_service_ids: ["srv-d99ef1mcjfls73857m40", "srv-d82c9j3tqb8s73cgriag"] },
    { merge_method: "auto" }, { confirmation_merge_method: "merge" },
    { rollback_strategy: "forward_revert" },
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), {
    ...merge, owner_confirmed: true, ...unsafe,
  }).allowed, false, JSON.stringify(unsafe));
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

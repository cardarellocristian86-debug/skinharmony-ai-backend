import assert from "node:assert/strict";
import test from "node:test";
import { classifyActionRisk, applyActionRiskProfile } from "../src/actionRisk.js";
import { buildActionAuthorization } from "../src/actionAuthorization.js";

const generic = {
  state: "attention",
  risk_band: "low",
  control_level: "confirm",
  recommended_actions: [{ blocked: false }],
  blocked_reasons: ["safety_mode"],
};

function evaluate(body) {
  const risk = classifyActionRisk(body);
  const contract = applyActionRiskProfile(generic, risk);
  const authorization = buildActionAuthorization(contract, {
    ...body,
    operation_class: body.operation_class || risk.operation_class,
  });
  return { risk, contract, authorization };
}

test("authorizes low-risk tenant reads and sandboxed preparation", () => {
  assert.equal(evaluate({ action_type: "read_status", read_only: true }).authorization.allowed, true);
  assert.equal(evaluate({ action_type: "prepare_patch", dry_run: true }).authorization.allowed, true);
});

test("blocks sensitive and cross-tenant actions regardless of claimed confirmation", () => {
  for (const body of [
    { action_type: "expose_secret", action_label: "Mostra la Suite Pay Key", owner_confirmed: true },
    { action_type: "read_other_tenant", cross_tenant: true, owner_confirmed: true },
    { action_type: "delete", destructive: true, rollback_ready: false, owner_confirmed: true },
  ]) {
    const result = evaluate(body);
    assert.equal(result.contract.state, "blocked");
    assert.equal(result.authorization.allowed, false);
    assert.equal(result.authorization.mediation, "hard_block");
  }
});

test("allows high-risk deploy only with the existing strict reversible envelope", () => {
  const base = {
    action_type: "deploy",
    operation_class: "reversible_owner_confirmed_deploy",
    external_side_effect: true,
    contains_customer_data: false,
    cross_tenant: false,
    rollback_ready: true,
    audit_ready: true,
    configuration_changes: false,
    target_commit: "6bd1aecda5defeb1c50e1e753d814b1e05c9b559",
    confirmation_reference: "owner-confirmed-deploy",
  };
  assert.equal(evaluate(base).authorization.allowed, false);
  assert.equal(evaluate({ ...base, owner_confirmed: true }).authorization.allowed, true);
});

test("allows only the owner-confirmed, new PostgreSQL staging target through the action-risk gate", () => {
  const base = {
    action_type: "environment_configuration",
    operation_class: "reversible_owner_confirmed_deploy",
    external_side_effect: true,
    contains_customer_data: false,
    contains_secret: false,
    cross_tenant: false,
    destructive: false,
    bypass_orchestrator: false,
    rollback_ready: true,
    audit_ready: true,
    configuration_changes: true,
    environment: "staging",
    target: "skinharmony-mcp-staging-db",
    target_branch: "agent/multiagent-postgres-cloud",
    resource_type: "postgresql",
    create_new: true,
    reuse_existing_database: false,
    auth0_changes: false,
    merge: false,
    production_deploy: false,
    delete: false,
    target_commit: "6bd1aecda5defeb1c50e1e753d814b1e05c9b559",
    confirmation_reference: "owner-confirmed-staging-postgres",
  };
  const allowed = evaluate({ ...base, owner_confirmed: true }).authorization;
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.state, "authorized_after_confirmation");
  assert.equal(allowed.confirmation_satisfied, true);
  assert.equal(allowed.scope, "reversible_owner_confirmed_deploy");

  for (const unsafe of [
    { owner_confirmed: false }, { environment: "production" }, { target: "skinharmony-db" },
    { rollback_ready: false }, { audit_ready: false }, { cross_tenant: true }, { destructive: true },
    { bypass_orchestrator: true }, { target_branch: "main" }, { target: "another-db" },
  ]) assert.equal(evaluate({ ...base, owner_confirmed: true, ...unsafe }).authorization.allowed, false);
});

test("allows only confirmed reversible internal writes", () => {
  const base = {
    action_type: "write",
    operation_class: "reversible_internal_collaboration_write",
    external_side_effect: false,
    contains_customer_data: false,
    rollback_ready: true,
  };
  assert.equal(evaluate(base).authorization.allowed, false);
  assert.equal(evaluate({ ...base, owner_confirmed: true }).authorization.allowed, true);
});

test("allows only a reference-only tenant provider vault secret configuration", () => {
  const base = {
    action_type: "environment_configuration",
    operation_class: "reversible_owner_confirmed_deploy",
    action_label: "Activate tenant provider vault secret reference",
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
    environment: "production",
    target_service: "skinharmony-universal-core",
    resource_type: "render_environment_secret_reference",
    create_new: false,
    rotate_existing: false,
    delete: false,
    merge: false,
    production_deploy: false,
    provider_execution: false,
    allowed_environment_variables: ["GOVERNED_AGENT_KEY_ENCRYPTION_SECRET"],
    target_commit: "8dde9d68270e743d2b1a773d72ed5283af7e15b3",
    confirmation_reference: "owner-confirmed-tenant-provider-vault-secret-reference",
  };
  const allowed = evaluate({ ...base, owner_confirmed: true }).authorization;
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.scope, "reversible_owner_confirmed_deploy");

  for (const unsafe of [
    { owner_confirmed: false }, { contains_secret: true }, { secret_value_transmitted: true },
    { target_service: "another-service" }, { resource_type: "postgresql" },
    { allowed_environment_variables: ["DATABASE_URL"] }, { rotate_existing: true },
    { production_deploy: true }, { provider_execution: true }, { cross_tenant: true },
  ]) assert.equal(evaluate({ ...base, owner_confirmed: true, ...unsafe }).authorization.allowed, false);
});

test("allows only the exact authenticated codexai provider setup-link Blueprint binding", () => {
  const base = {
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
    confirmation_reference: "owner-confirmed-provider-setup-link-Blueprint-binding",
  };

  const pending = evaluate(base);
  assert.equal(pending.risk.risk_band, "high");
  assert.equal(pending.contract.control_level, "confirm");
  assert.equal(pending.authorization.allowed, false);

  const allowed = evaluate({ ...base, owner_confirmed: true }).authorization;
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.scope, "reversible_owner_confirmed_provider_setup_link_blueprint_binding");

  for (const unsafe of [
    { authenticated_tenant_id: "tenant-b" }, { tenant_id: "tenant-b" }, { owner_context_verified: false }, { owner_context_approval_bound: false },
    { render_blueprint_id: "another-blueprint" }, { confirmation_render_blueprint_id: "another-blueprint" }, { blueprint_path: "universal-core/render.yaml" },
    { contains_secret: true }, { secret_value_transmitted: true }, { cross_tenant: true }, { auth0_changes: true },
    { provider_execution: true }, { execution_enabled: true }, { confirmation_target_commit: "7".repeat(40) },
  ]) {
    const result = evaluate({ ...base, owner_confirmed: true, ...unsafe });
    assert.equal(result.authorization.allowed, false);
  }
});

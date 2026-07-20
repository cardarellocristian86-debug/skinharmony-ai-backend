import crypto from "node:crypto";

export const PROVIDER_SETUP_LINK_BINDING_OPERATION_CLASS =
  "reversible_owner_confirmed_provider_setup_link_blueprint_binding";
export const PROVIDER_SETUP_LINK_BINDING_ACTION_TYPE = "render_blueprint_environment_binding";
export const PROVIDER_SETUP_LINK_BINDING_ACTION_LABEL = "Bind Core provider setup-link validation";
export const PROVIDER_SETUP_LINK_BINDING_BLUEPRINT_ID = "exs-d99edqgki2s73e29nug";
export const PROVIDER_SETUP_LINK_BINDING_APPROVAL_VERSION = "provider_setup_link_binding_approval_v1";

const ALLOWED_FIELDS = new Set([
  "action_label",
  "action_type",
  "operation_class",
  "authenticated_tenant_id",
  "tenant_id",
  "external_side_effect",
  "contains_customer_data",
  "contains_secret",
  "secret_value_transmitted",
  "cross_tenant",
  "destructive",
  "bypass_orchestrator",
  "rollback_ready",
  "audit_ready",
  "configuration_changes",
  "environment",
  "target_branch",
  "resource_type",
  "render_blueprint_id",
  "blueprint_path",
  "source_service",
  "target_service",
  "source_environment_variable",
  "target_environment_variable",
  "tenant_environment_variable",
  "tenant_environment_value",
  "create_new",
  "rotate_existing",
  "delete",
  "merge",
  "production_deploy",
  "deploy",
  "auth0_changes",
  "provider_execution",
  "execution_enabled",
  "force",
  "admin_bypass",
  "allowed_environment_variables",
  "target_commit",
  "confirmation_target_commit",
  "confirmation_target_branch",
  "confirmation_render_blueprint_id",
  "confirmation_blueprint_path",
  "confirmation_source_service",
  "confirmation_target_service",
  "confirmation_source_environment_variable",
  "confirmation_target_environment_variable",
  "confirmation_tenant_id",
  "confirmation_reference",
  "owner_confirmed",
  "owner_context",
  "owner_context_verified",
  "owner_context_approval_bound",
]);

function value(body, key) {
  return String(body?.[key] || "");
}

function sameValue(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length &&
      actual.every((item, index) => sameValue(item, expected[index]));
  }
  return actual === expected;
}

export function isProviderSetupLinkBindingAttempt(body = {}) {
  return body?.operation_class === PROVIDER_SETUP_LINK_BINDING_OPERATION_CLASS &&
    String(body?.action_type || "").toLowerCase() === PROVIDER_SETUP_LINK_BINDING_ACTION_TYPE;
}

export function hasOnlyProviderSetupLinkBindingFields(body = {}) {
  return body && typeof body === "object" && !Array.isArray(body) &&
    Object.keys(body).every((key) => ALLOWED_FIELDS.has(key));
}

// The owner confirmation and its signed context are deliberately evaluated by
// Core, after this static scope check. That lets an otherwise exact request
// wait for confirmation, while *any* attempt to change a service, variable,
// Blueprint, tenant, action, or commit shape is hard-blocked instead of being
// left in a generic confirmation state.
export function hasExactProviderSetupLinkBindingScope(body = {}) {
  if (!isProviderSetupLinkBindingAttempt(body) || !hasOnlyProviderSetupLinkBindingFields(body)) return false;
  const targetCommit = value(body, "target_commit").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(targetCommit)) return false;
  const expected = buildProviderSetupLinkBindingEnvelope({
    tenantId: "codexai",
    targetCommit,
    confirmationReference: value(body, "confirmation_reference"),
  });
  return Object.entries(expected).every(([key, expectedValue]) => sameValue(body[key], expectedValue));
}

// Safe, bounded fields for audit only. In particular this never returns a
// secret, confirmation text, owner assertion, tenant token, or URL.
export function providerSetupLinkBindingAuditFields(body = {}) {
  if (!isProviderSetupLinkBindingAttempt(body)) return {};
  const targetCommit = value(body, "target_commit").toLowerCase();
  const approvalDigest = value(body?.owner_context, "approval_digest");
  return {
    provider_setup_link_binding: true,
    provider_setup_link_binding_exact_scope: hasExactProviderSetupLinkBindingScope(body),
    provider_setup_link_binding_blueprint_id:
      value(body, "render_blueprint_id") === PROVIDER_SETUP_LINK_BINDING_BLUEPRINT_ID
        ? PROVIDER_SETUP_LINK_BINDING_BLUEPRINT_ID
        : null,
    provider_setup_link_binding_target_commit: /^[a-f0-9]{40}$/.test(targetCommit) ? targetCommit : null,
    provider_setup_link_binding_approval_digest: /^pslb_[a-f0-9]{64}$/.test(approvalDigest)
      ? approvalDigest
      : null,
  };
}

export function buildProviderSetupLinkBindingEnvelope({
  tenantId,
  targetCommit,
  confirmationReference,
} = {}) {
  const tenant = String(tenantId || "").trim();
  const commit = String(targetCommit || "").trim().toLowerCase();
  return {
    action_label: PROVIDER_SETUP_LINK_BINDING_ACTION_LABEL,
    action_type: PROVIDER_SETUP_LINK_BINDING_ACTION_TYPE,
    operation_class: PROVIDER_SETUP_LINK_BINDING_OPERATION_CLASS,
    authenticated_tenant_id: tenant,
    tenant_id: tenant,
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
    target_branch: "main",
    resource_type: "render_blueprint_from_service_env_binding",
    render_blueprint_id: PROVIDER_SETUP_LINK_BINDING_BLUEPRINT_ID,
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
    allowed_environment_variables: [
      "CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY",
      "CORE_PROVIDER_SETUP_LINK_TENANT_ID",
    ],
    target_commit: commit,
    confirmation_target_commit: commit,
    confirmation_target_branch: "main",
    confirmation_render_blueprint_id: PROVIDER_SETUP_LINK_BINDING_BLUEPRINT_ID,
    confirmation_blueprint_path: "render-universal-core.yaml",
    confirmation_source_service: "skinharmony-core-mcp",
    confirmation_target_service: "skinharmony-universal-core",
    confirmation_source_environment_variable: "CORE_PROVIDER_SETUP_LINK_KEY",
    confirmation_target_environment_variable: "CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY",
    confirmation_tenant_id: "codexai",
    confirmation_reference: String(confirmationReference || "").trim(),
  };
}

export function providerSetupLinkBindingApprovalDigest(body = {}, authenticatedTenantId) {
  const canonical = JSON.stringify({
    version: PROVIDER_SETUP_LINK_BINDING_APPROVAL_VERSION,
    action_label: value(body, "action_label"),
    action_type: value(body, "action_type").toLowerCase(),
    operation_class: value(body, "operation_class"),
    tenant_id: String(authenticatedTenantId || body.tenant_id || "").trim(),
    target_commit: value(body, "target_commit").toLowerCase(),
    target_branch: value(body, "target_branch"),
    render_blueprint_id: value(body, "render_blueprint_id"),
    blueprint_path: value(body, "blueprint_path"),
    source_service: value(body, "source_service"),
    target_service: value(body, "target_service"),
    source_environment_variable: value(body, "source_environment_variable"),
    target_environment_variable: value(body, "target_environment_variable"),
    tenant_environment_variable: value(body, "tenant_environment_variable"),
    tenant_environment_value: value(body, "tenant_environment_value"),
    allowed_environment_variables: Array.isArray(body.allowed_environment_variables)
      ? body.allowed_environment_variables.map((item) => String(item))
      : [],
    confirmation_target_commit: value(body, "confirmation_target_commit").toLowerCase(),
    confirmation_target_branch: value(body, "confirmation_target_branch"),
    confirmation_render_blueprint_id: value(body, "confirmation_render_blueprint_id"),
    confirmation_blueprint_path: value(body, "confirmation_blueprint_path"),
    confirmation_source_service: value(body, "confirmation_source_service"),
    confirmation_target_service: value(body, "confirmation_target_service"),
    confirmation_source_environment_variable: value(body, "confirmation_source_environment_variable"),
    confirmation_target_environment_variable: value(body, "confirmation_target_environment_variable"),
    confirmation_tenant_id: value(body, "confirmation_tenant_id"),
    confirmation_reference: value(body, "confirmation_reference"),
    owner_confirmed: body.owner_confirmed === true,
  });
  return `pslb_${crypto.createHash("sha256").update(`provider-setup-link-binding\u0000${canonical}`).digest("hex")}`;
}

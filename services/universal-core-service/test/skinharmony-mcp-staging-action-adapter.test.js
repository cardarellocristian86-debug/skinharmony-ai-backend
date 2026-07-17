import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSkinHarmonyMcpStagingAction,
  skinHarmonyMcpStagingActionTemplate,
} from "../src/domainAdapters/skinharmonyMcpStagingAction.js";

const CONTEXT = Object.freeze({
  tenantId: "codexai",
  keyId: "key_12345678-abcd-4321",
  domainPackId: "skinharmony",
});

function request() {
  return { ...skinHarmonyMcpStagingActionTemplate(), tenant_id: CONTEXT.tenantId };
}

function evaluate(body, overrides = {}) {
  return evaluateSkinHarmonyMcpStagingAction({ body, ...CONTEXT, ...overrides });
}

function changed(path, value) {
  const body = structuredClone(request());
  let cursor = body;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  cursor[path.at(-1)] = value;
  return body;
}

test("produces a deterministic pending digest without exposing Render resource ids", () => {
  const first = evaluate(request());
  const second = evaluate(request());
  assert.equal(first.reserved, true);
  assert.equal(first.claimed, true);
  assert.equal(first.eligible, true);
  assert.equal(first.hard_block, false);
  assert.equal(first.confirmation_required, true);
  assert.equal(first.confirmation_satisfied, false);
  assert.match(first.action_digest, /^[a-f0-9]{64}$/);
  assert.equal(first.action_digest, second.action_digest);
  assert.equal(first.target_commit, "f435aafb709a26c77e82e2688056d73056d69c82");
  const serialized = JSON.stringify(first);
  for (const privateId of ["tea-d780", "prj-d781", "evm-d9cd", "dpg-d9cd"]) assert.equal(serialized.includes(privateId), false);
});

test("matches the independently asserted immutable staging policy snapshot", () => {
  const body = request();
  assert.equal(body.action_type, "service_environment_configuration");
  assert.equal(body.operation_class, "reversible_owner_confirmed_mcp_staging_service");
  assert.equal(body.target_commit, "f435aafb709a26c77e82e2688056d73056d69c82");
  assert.deepEqual(body.deployment_spec.target, {
    workspace_id: "tea-d780u0c50q8c73d51fi0",
    project_id: "prj-d7817c9r0fns738cf6vg",
    project_name: "My project",
    environment_id: "evm-d9cdaovavr4c73av1h10",
    environment_name: "staging",
    region_slug: "oregon",
    region_label: "Oregon",
  });
  assert.deepEqual(body.deployment_spec.service, {
    name: "skinharmony-core-mcp-staging",
    resource_type: "web_service",
    plan: "free",
    create_mode: "create_only",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    root_directory: "",
    branch: "agent/multiagent-postgres-cloud",
    commit: "f435aafb709a26c77e82e2688056d73056d69c82",
    expected_branch_head: "f435aafb709a26c77e82e2688056d73056d69c82",
    runtime: "node",
    build_command: "npm ci",
    start_command: "npm run core:mcp",
    health_check_path: "/healthz",
    public_url: "https://skinharmony-core-mcp-staging.onrender.com",
    initial_deploy: true,
    auto_deploy: false,
    pull_request_previews: false,
  });
  assert.deepEqual(body.deployment_spec.database, {
    name: "skinharmony-mcp-staging-db",
    resource_id: "dpg-d9cdeie1a83c73ca5l10-a",
    required_status: "available",
    binding_key: "MCP_COLLABORATION_DATABASE_URL",
    binding_kind: "render_database_reference",
    reference_property: "connectionString",
    reference_only: true,
    value_access: false,
  });
  assert.deepEqual(body.deployment_spec.environment_bindings, [
    { key: "NODE_ENV", kind: "literal", value: "production" },
    { key: "MCP_PUBLIC_URL", kind: "literal", value: "https://skinharmony-core-mcp-staging.onrender.com" },
    { key: "MCP_DEFAULT_TENANT_ID", kind: "literal", value: "codexai" },
    { key: "UNIVERSAL_CORE_URL", kind: "literal", value: "https://skinharmony-universal-core.onrender.com" },
    { key: "MCP_SUPPORTED_SCOPES", kind: "literal", value: "core:read,core:govern" },
    { key: "CORE_DECISION_LEDGER_REQUIRED", kind: "literal", value: "false" },
    { key: "MCP_COLLABORATION_DATABASE_SSL", kind: "literal", value: "true" },
    { key: "MCP_COLLABORATION_DATABASE_URL", kind: "render_database_reference", resource_id: "dpg-d9cdeie1a83c73ca5l10-a", property: "connectionString", value_access: false },
    { key: "CODEX_BEARER_KEYS", kind: "preprovisioned_staging_secret_reference", reference_id: "mcp-staging-codex-bearer-v1", credential_scope: "codexai_staging_only", value_access: false, production_reuse: false },
    { key: "UNIVERSAL_CORE_KEY", kind: "preprovisioned_staging_secret_reference", reference_id: "mcp-staging-universal-core-key-v1", credential_scope: "codexai_staging_only", value_access: false, production_reuse: false },
  ]);
  assert.deepEqual(body.deployment_spec.credential_policy, {
    staging_credentials_preprovisioned: true,
    create_credentials: false,
    copy_existing_environment: false,
    reuse_production_credentials: false,
    secret_values_in_payload: false,
  });
  assert.deepEqual(body.deployment_spec.safety, {
    create_new_service_only: true,
    update_existing_service: false,
    reuse_existing_service: false,
    link_other_services: false,
    auth0_usage: false,
    auth0_changes: false,
    generic_database_url_usage: false,
    god_mode_enabled: false,
    merge: false,
    production_deploy: false,
    production_changes: false,
    delete: false,
    cross_tenant: false,
  });
  assert.deepEqual(body.deployment_spec.verification, {
    revalidate_branch_head_before_execution: true,
    require_service_absent_before_creation: true,
    verify_database_available_before_binding: true,
    verify_deployed_commit_before_validation: true,
    executor_uses_normalized_spec_only: true,
    rollback_requires_separate_authorization: true,
    automatic_deletion_on_failure: false,
  });
});

test("satisfies confirmation only with the exact verified tenant-bound digest", () => {
  const pending = evaluate(request());
  const body = {
    ...request(),
    owner_confirmed: true,
    confirmed_action_digest: pending.action_digest,
    action_confirmation: { assertion: "server-signed-envelope-is-never-trusted-directly" },
  };
  const verified = {
    verified: true,
    tenant_id: CONTEXT.tenantId,
    confirmation_reference: body.confirmation_reference,
    action_digest: pending.action_digest,
  };
  const allowed = evaluate(body, { actionConfirmation: verified });
  assert.equal(allowed.eligible, true);
  assert.equal(allowed.confirmation_satisfied, true);

  for (const actionConfirmation of [
    { ...verified, verified: false },
    { ...verified, tenant_id: "other-tenant" },
    { ...verified, confirmation_reference: "ucr_other_confirmation_01" },
    { ...verified, action_digest: "0".repeat(64) },
  ]) {
    const denied = evaluate(body, { actionConfirmation });
    assert.equal(denied.confirmation_satisfied, false);
    assert.equal(denied.eligible, false);
  }
});

test("exact target, service, repository, database and environment mutations fail closed", () => {
  const mutations = [
    changed(["action_label"], "Deploy production"),
    changed(["action_type"], ["service_environment_configuration"]),
    changed(["operation_class"], ["reversible_owner_confirmed_mcp_staging_service"]),
    changed(["target_commit"], "a".repeat(40)),
    changed(["target_commit"], "F435AAFB709A26C77E82E2688056D73056D69C82"),
    changed(["deployment_spec", "target", "workspace_id"], "tea-other"),
    changed(["deployment_spec", "target", "project_id"], "prj-other"),
    changed(["deployment_spec", "target", "environment_id"], "evm-other"),
    changed(["deployment_spec", "target", "region_slug"], "frankfurt"),
    changed(["deployment_spec", "service", "plan"], "starter"),
    changed(["deployment_spec", "service", "resource_type"], "private_service"),
    changed(["deployment_spec", "service", "repository"], "other/repository"),
    changed(["deployment_spec", "service", "root_directory"], "services/skinharmony-core-mcp"),
    changed(["deployment_spec", "service", "commit"], "a".repeat(40)),
    changed(["deployment_spec", "service", "build_command"], "npm install"),
    changed(["deployment_spec", "service", "start_command"], "npm start"),
    changed(["deployment_spec", "service", "health_check_path"], "/health"),
    changed(["deployment_spec", "service", "public_url"], "https://example.invalid"),
    changed(["deployment_spec", "service", "auto_deploy"], true),
    changed(["deployment_spec", "service", "initial_deploy"], false),
    changed(["deployment_spec", "database", "name"], "another-db"),
    changed(["deployment_spec", "database", "resource_id"], "dpg-other"),
    changed(["deployment_spec", "database", "binding_key"], "DATABASE_URL"),
    changed(["deployment_spec", "database", "reference_property"], "externalConnectionString"),
    changed(["deployment_spec", "database", "value_access"], true),
    changed(["deployment_spec", "environment_bindings", 0, "value"], "development"),
    changed(["deployment_spec", "environment_bindings", 4, "value"], "core:read"),
    changed(["deployment_spec", "environment_bindings", 5, "value"], "true"),
    changed(["deployment_spec", "environment_bindings", 7, "kind"], "literal"),
    changed(["deployment_spec", "environment_bindings", 8, "production_reuse"], true),
  ];
  const missingBinding = structuredClone(request());
  missingBinding.deployment_spec.environment_bindings.pop();
  mutations.push(missingBinding);
  const duplicateBinding = structuredClone(request());
  duplicateBinding.deployment_spec.environment_bindings.push(structuredClone(duplicateBinding.deployment_spec.environment_bindings[0]));
  mutations.push(duplicateBinding);
  const reorderedBinding = structuredClone(request());
  reorderedBinding.deployment_spec.environment_bindings.reverse();
  mutations.push(reorderedBinding);
  const extraField = structuredClone(request());
  extraField.deployment_spec.service.unreviewed = true;
  mutations.push(extraField);

  for (const body of mutations) {
    const result = evaluate(body);
    assert.equal(result.eligible, false, JSON.stringify(body));
    assert.equal(result.confirmation_satisfied, false);
  }
});

test("dangerous aliases, raw secrets, production and existing-resource reuse hard block", () => {
  const cases = [];
  for (const [key, value] of [
    ["DATABASE_URL", "password=synthetic-test-only"],
    ["AUTH0_ISSUER", "https://tenant.auth0.com"],
    ["AUTH0_AUDIENCE", false],
    ["NYRA_GOD_MODE_ENABLED", true],
    ["env_vars", { DATABASE_URL: "password=synthetic-test-only" }],
    ["envVars", { SAFE: "false" }],
    ["rootDir", "services/production"],
    ["service_id", "srv-existing"],
    ["secret_values", { UNIVERSAL_CORE_KEY: "secret=synthetic-test-only" }],
  ]) cases.push({ ...request(), [key]: value });
  cases.push(changed(["deployment_spec", "target", "environment_name"], "production"));
  cases.push(changed(["deployment_spec", "service", "name"], "skinharmony-core-mcp"));
  cases.push(changed(["deployment_spec", "service", "branch"], "main"));
  cases.push(changed(["deployment_spec", "database", "name"], "skinharmony-db"));
  const rawSecretReference = structuredClone(request());
  rawSecretReference.deployment_spec.environment_bindings[8].value = "secret=synthetic-test-only";
  cases.push(rawSecretReference);

  for (const body of cases) {
    const result = evaluate(body);
    assert.equal(result.eligible, false);
    assert.equal(result.hard_block, true, JSON.stringify(body));
  }
});

test("reserves the staging action against generic deploy, read and sandbox fallthrough", () => {
  const protectedCommit = {
    action_type: "deploy",
    operation_class: "reversible_owner_confirmed_deploy",
    target_commit: "f435aafb709a26c77e82e2688056d73056d69c82",
    confirmation_reference: "ucr_mcp_staging_20260716_01",
  };
  assert.equal(evaluate(protectedCommit).reserved, true);
  assert.equal(evaluate(protectedCommit).eligible, false);
  assert.equal(evaluate({ ...protectedCommit, operation_class: "tenant_scoped_read", action_type: "read" }).reserved, true);
  assert.equal(evaluate({ ...protectedCommit, operation_class: "sandboxed_scoped_work", action_type: "prepare" }).reserved, true);
  assert.equal(evaluate({ ...protectedCommit, target_commit: "a".repeat(40), confirmation_reference: "owner-confirmed-other" }).reserved, false);
});

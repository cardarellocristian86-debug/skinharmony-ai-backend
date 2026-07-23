import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function ownerRequestBinding(purpose, body) {
  const { owner_context: _ownerContext, ...payload } = body;
  return `${purpose}\u0000${JSON.stringify(stableCanonical(payload))}`;
}

function signedOwnerContext(key, tenantId, body, purpose = "intelligence_outcome_record") {
  const binding = ownerRequestBinding(purpose, body);
  const context = {
    assertion_version: "owner_context_assertion_v1",
    audience: "nira_core_bridge",
    tenant_id: tenantId,
    access_mode: "god_mode",
    role: "owner_root",
    delegated_actor: "integration_test",
    owner_verified: true,
    issued_at: new Date().toISOString(),
    binding_version: "owner_request_binding_v1",
    binding_hash: crypto.createHash("sha256").update(binding).digest("hex"),
  };
  const canonical = JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
    issued_at: context.issued_at,
    binding_version: context.binding_version,
    binding_hash: context.binding_hash,
  });
  return {
    ...context,
    assertion: `ocs_${crypto.createHmac("sha256", key).update(`owner-context\u0000${canonical}`).digest("hex")}`,
  };
}

async function fixture(run) {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "intel-test-admin";
  const storageRoot = path.join(os.tmpdir(), `core-intel-${Date.now()}-${Math.random()}`);
  const { app } = createUniversalCoreService({ storageRoot });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, pathname, body, key = "intel-test-admin") => {
    const response = await fetch(`${base}${pathname}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  try { await run(request, { storageRoot }); } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY; else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
}

test("intelligence API is tenant scoped and records idempotent outcomes", async () => fixture(async (request) => {
  const generated = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-intel", preset: "nyra_core_360_connector" });
  const key = generated.json.key;
  const workflow = await request("POST", "/v1/intelligence/workflow", { request: "Evaluate", generate_scenarios: true }, key);
  assert.equal(workflow.status, 200);
  assert.equal(workflow.json.tenant_id, "tenant-intel");
  assert.equal(workflow.json.execution_allowed, false);

  const unsignedPayload = {
    outcome_id: "stable-outcome",
    prediction_id: "p1",
    predicted_probability: 0.8,
    actual_outcome: true,
  };
  const payload = { ...unsignedPayload, owner_context: signedOwnerContext(key, "tenant-intel", unsignedPayload) };
  const first = await request("POST", "/v1/intelligence/outcomes/record", payload, key);
  const second = await request("POST", "/v1/intelligence/outcomes/record", payload, key);
  assert.equal(first.status, 201);
  assert.equal(first.json.authorization.allowed, true);
  assert.equal(first.json.authorization.scope, "verified_outcome_record");
  assert.equal(first.json.legacy_scope_compatibility, false);
  assert.equal(second.status, 200);
  assert.equal(second.json.duplicate, true);
  const unsignedConflict = { ...unsignedPayload, actual_outcome: false };
  const conflict = await request("POST", "/v1/intelligence/outcomes/record", {
    ...unsignedConflict,
    owner_context: signedOwnerContext(key, "tenant-intel", unsignedConflict),
  }, key);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error, "outcome_id_conflict");
  const missingId = await request("POST", "/v1/intelligence/outcomes/record", { predicted_probability: 0.8, actual_outcome: true }, key);
  assert.equal(missingId.status, 400);
  assert.equal(missingId.json.error, "outcome_id_required");
  const calibration = await request("GET", "/v1/intelligence/calibration", undefined, key);
  assert.equal(calibration.json.calibration.sample_size, 1);
  assert.equal(calibration.json.tenant_id, "tenant-intel");
}));

test("outcome persistence uses a dedicated scope, fails closed without owner proof and preserves legacy compatibility", async () => fixture(async (request) => {
  const dedicated = await request("POST", "/v1/keys/generate", {
    tenant_id: "tenant-dedicated",
    key_type: "connector",
    allowed_scopes: ["read:decision", "write:intelligence_outcome", "owner:assertion"],
  });
  const payload = { outcome_id: "dedicated-outcome", predicted_probability: 0.7, actual_outcome: true };
  const denied = await request("POST", "/v1/intelligence/outcomes/record", payload, dedicated.json.key);
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error, "outcome_record_not_authorized");
  assert.equal(denied.json.authorization.allowed, false);

  const allowedBody = {
    ...payload,
    tenant_id: "tenant-dedicated",
  };
  const allowed = await request("POST", "/v1/intelligence/outcomes/record", {
    ...allowedBody,
    owner_context: signedOwnerContext(dedicated.json.key, "tenant-dedicated", allowedBody),
  }, dedicated.json.key);
  assert.equal(allowed.status, 201);
  assert.equal(allowed.json.authorization.allowed, true);
  assert.equal(allowed.json.legacy_scope_compatibility, false);

  const legacy = await request("POST", "/v1/keys/generate", {
    tenant_id: "tenant-legacy",
    key_type: "automation",
    allowed_scopes: ["write:snapshot", "automation:codex"],
  });
  const legacyBody = {
    ...payload,
    outcome_id: "legacy-outcome",
    tenant_id: "tenant-legacy",
    owner_confirmed: true,
    confirmation_reference: "legacy-automation-owner-confirmation",
  };
  const compatible = await request("POST", "/v1/intelligence/outcomes/record", legacyBody, legacy.json.key);
  assert.equal(compatible.status, 201);
  assert.equal(compatible.json.legacy_scope_compatibility, true);
  assert.equal(compatible.json.authorization.allowed, true);

  const connectorWithAutomationScope = await request("POST", "/v1/keys/generate", {
    tenant_id: "tenant-connector-scope",
    key_type: "connector",
    allowed_scopes: ["write:snapshot", "automation:codex"],
  });
  const connectorScopeDenied = await request("POST", "/v1/intelligence/outcomes/record", {
    ...payload,
    outcome_id: "connector-scope-must-fail",
    tenant_id: "tenant-connector-scope",
    owner_confirmed: true,
    confirmation_reference: "untrusted-connector-boolean",
  }, connectorWithAutomationScope.json.key);
  assert.equal(connectorScopeDenied.status, 403);
  assert.equal(connectorScopeDenied.json.error, "outcome_record_not_authorized");

  const replayBody = { ...allowedBody, outcome_id: "replay-must-fail" };
  const replay = await request("POST", "/v1/intelligence/outcomes/record", {
    ...replayBody,
    owner_context: signedOwnerContext(dedicated.json.key, "tenant-dedicated", allowedBody),
  }, dedicated.json.key);
  assert.equal(replay.status, 403);
  assert.equal(replay.json.error, "outcome_record_not_authorized");

  const sensitiveBody = {
    ...payload,
    outcome_id: "sensitive-must-fail",
    tenant_id: "tenant-dedicated",
    lessons: ["api_key=FAKE_TEST_SECRET customer_email=test@example.com"],
  };
  const sensitive = await request("POST", "/v1/intelligence/outcomes/record", {
    ...sensitiveBody,
    owner_context: signedOwnerContext(dedicated.json.key, "tenant-dedicated", sensitiveBody),
  }, dedicated.json.key);
  assert.equal(sensitive.status, 400);
  assert.equal(sensitive.json.error, "outcome_sensitive_content_rejected");

  const readOnly = await request("POST", "/v1/keys/generate", {
    tenant_id: "tenant-readonly",
    key_type: "connector",
    allowed_scopes: ["read:decision"],
  });
  const scopeDenied = await request("POST", "/v1/intelligence/outcomes/record", {
    ...payload,
    outcome_id: "readonly-outcome",
    tenant_id: "tenant-readonly",
  }, readOnly.json.key);
  assert.equal(scopeDenied.status, 403);
  assert.equal(scopeDenied.json.error, "scope_denied");
}));

test("action evaluator rejects a caller boolean and accepts only a scoped request-bound owner proof", async () => fixture(async (request) => {
  const readOnly = await request("POST", "/v1/keys/generate", {
    tenant_id: "codexai",
    key_type: "connector",
    allowed_scopes: ["read:decision"],
  });
  const base = {
    action_label: "Rotate the Core MCP connector key",
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
    target_commit: "3".repeat(40),
    environment: "production",
    source_service: "skinharmony-universal-core",
    target_service: "skinharmony-core-mcp",
    target_environment_variable: "CORE_MCP_KEY",
    resource_type: "render_environment_secret_reference",
    target_tenant_id: "codexai",
    current_key_id: readOnly.json.record.key_id,
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
    confirmation_current_key_id: readOnly.json.record.key_id,
    confirmation_target_scope: "write:intelligence_outcome",
    confirmation_owner_assertion_scope: "owner:assertion",
    confirmation_target_service: "skinharmony-core-mcp",
    confirmation_target_tenant_id: "codexai",
    confirmation_target_commit: "3".repeat(40),
    confirmation_reference: "bound-owner-confirmation",
    tenant_id: "codexai",
  };
  const forgedBoolean = await request("POST", "/v1/action-evaluator", { ...base, owner_confirmed: true }, readOnly.json.key);
  assert.equal(forgedBoolean.status, 200);
  assert.equal(forgedBoolean.json.authorization.allowed, false);

  const signedButUnscopedBody = { ...base, owner_confirmed: true };
  const signedButUnscoped = await request("POST", "/v1/action-evaluator", {
    ...signedButUnscopedBody,
    owner_context: signedOwnerContext(readOnly.json.key, "codexai", signedButUnscopedBody, "core_action_evaluator"),
  }, readOnly.json.key);
  assert.equal(signedButUnscoped.json.authorization.allowed, false);

  const connectorWithAutomationScope = await request("POST", "/v1/keys/generate", {
    tenant_id: "codexai",
    key_type: "connector",
    allowed_scopes: ["read:decision", "automation:codex"],
  });
  const connectorBoolean = await request("POST", "/v1/action-evaluator", { ...base, owner_confirmed: true }, connectorWithAutomationScope.json.key);
  assert.equal(connectorBoolean.json.authorization.allowed, false);

  const ownerScoped = await request("POST", "/v1/keys/generate", {
    tenant_id: "codexai",
    key_type: "connector",
    allowed_scopes: ["read:decision", "owner:assertion"],
  });
  const signedBody = { ...base, owner_confirmed: true };
  const authorized = await request("POST", "/v1/action-evaluator", {
    ...signedBody,
    owner_context: signedOwnerContext(ownerScoped.json.key, "codexai", signedBody, "core_action_evaluator"),
  }, ownerScoped.json.key);
  assert.equal(authorized.status, 200);
  assert.equal(authorized.json.authorization.allowed, true);
  assert.equal(authorized.json.authorization.scope, "reversible_owner_confirmed_core_connector_key_rotation");

  const changed = { ...signedBody, target_scope: "write:snapshot" };
  const replay = await request("POST", "/v1/action-evaluator", {
    ...changed,
    owner_context: signedOwnerContext(ownerScoped.json.key, "codexai", signedBody, "core_action_evaluator"),
  }, ownerScoped.json.key);
  assert.equal(replay.json.authorization.allowed, false);
}));

test("Core admin bootstrap configuration requires an exact signed owner envelope and emits safe audit fields", async () => fixture(async (request, { storageRoot }) => {
  const environmentVariables = [
    "CORE_ADMIN_SESSION_SECRET",
    "CORE_ADMIN_BOOTSTRAP_USERNAME",
    "CORE_ADMIN_BOOTSTRAP_PASSWORD",
  ];
  const base = {
    action_label: "Configure Core Admin Control Room bootstrap references",
    action_type: "environment_configuration",
    operation_class: "reversible_owner_confirmed_core_admin_bootstrap_configuration",
    agent_id: "connected_ai",
    client_type: "chatgpt",
    session_id: "admin-http-test",
    memory_context: {
      schema_version: "tenant_memory_context_v1",
      tenant_id: "codexai",
      revision: 1,
      relevant_memories: [],
    },
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
    allowed_environment_variables: environmentVariables,
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
    target_commit: "4".repeat(40),
    confirmation_target_commit: "4".repeat(40),
    confirmation_target_service: "skinharmony-universal-core",
    confirmation_target_service_id: "srv-d82c9j3tqb8s73cgriag",
    confirmation_environment_variables: environmentVariables,
    confirmation_reference: "owner-confirmed-core-admin-bootstrap-test",
  };
  const automation = await request("POST", "/v1/keys/generate", {
    tenant_id: "codexai",
    key_type: "automation",
    allowed_scopes: ["read:decision", "automation:codex"],
  });
  const forged = await request("POST", "/v1/action-evaluator", {
    ...base,
    owner_confirmed: true,
  }, automation.json.key);
  assert.equal(forged.status, 200);
  assert.equal(forged.json.authorization.allowed, false);
  assert.equal(forged.json.authorization.state, "blocked");

  const owner = await request("POST", "/v1/keys/generate", {
    tenant_id: "codexai",
    key_type: "connector",
    allowed_scopes: ["read:decision", "owner:assertion"],
  });
  const signedBody = { ...base, owner_confirmed: true };
  const authorized = await request("POST", "/v1/action-evaluator", {
    ...signedBody,
    owner_context: signedOwnerContext(owner.json.key, "codexai", signedBody, "core_action_evaluator"),
  }, owner.json.key);
  assert.equal(authorized.status, 200);
  assert.equal(authorized.json.authorization.allowed, true);
  assert.equal(
    authorized.json.authorization.scope,
    "reversible_owner_confirmed_core_admin_bootstrap_configuration",
  );

  const changed = {
    ...signedBody,
    allowed_environment_variables: [...environmentVariables, "DATABASE_URL"],
  };
  const rebound = await request("POST", "/v1/action-evaluator", {
    ...changed,
    owner_context: signedOwnerContext(owner.json.key, "codexai", signedBody, "core_action_evaluator"),
  }, owner.json.key);
  assert.equal(rebound.json.authorization.allowed, false);
  assert.equal(rebound.json.authorization.state, "blocked");

  const auditLog = fs.readFileSync(path.join(storageRoot, "audit", "events.jsonl"), "utf8");
  assert.equal(auditLog.includes("core_admin_bootstrap_authorized"), true);
  assert.equal(auditLog.includes("CORE_ADMIN_BOOTSTRAP_PASSWORD"), true);
  assert.equal(auditLog.includes("owner_context_assertion_v1"), false);
  assert.equal(auditLog.includes("ocs_"), false);
}));

test("MCP default tenant correction rejects automation and requires an exact explicit owner proof", async () => fixture(async (request, { storageRoot }) => {
  const base = {
    action_label: "Correct the Codex default tenant binding",
    action_type: "render_mcp_default_tenant_correction",
    operation_class: "reversible_owner_confirmed_mcp_default_tenant_correction",
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
    target_commit: "6".repeat(40),
    deployed_commit: "6".repeat(40),
    environment: "production",
    target_service: "skinharmony-core-mcp",
    target_service_id: "srv-d99ef1mcjfls73857m40",
    resource_type: "render_environment_variable",
    target_environment_variable: "MCP_DEFAULT_TENANT_ID",
    allowed_environment_variables: ["MCP_DEFAULT_TENANT_ID"],
    current_tenant_id: "owner-private",
    target_tenant_id: "codexai",
    current_value_verified: true,
    rollback_tenant_id: "owner-private",
    service_restart_required: true,
    deploy: true,
    create_new: false,
    delete: false,
    merge: false,
    provider_execution: false,
    confirmation_target_commit: "6".repeat(40),
    confirmation_target_service: "skinharmony-core-mcp",
    confirmation_target_service_id: "srv-d99ef1mcjfls73857m40",
    confirmation_environment_variable: "MCP_DEFAULT_TENANT_ID",
    confirmation_current_tenant_id: "owner-private",
    confirmation_target_tenant_id: "codexai",
    confirmation_reference: "bound-default-tenant-confirmation",
    tenant_id: "codexai",
  };

  const automation = await request("POST", "/v1/keys/generate", {
    tenant_id: "codexai",
    key_type: "automation",
    allowed_scopes: ["read:decision", "automation:codex", "owner:assertion"],
  });
  const automationBody = {
    ...base,
    owner_confirmed: true,
    request_bound_owner_confirmation: true,
    authenticated_key_type: "connector",
  };
  const automationAttempt = await request("POST", "/v1/action-evaluator", {
    ...automationBody,
    owner_context: signedOwnerContext(automation.json.key, "codexai", automationBody, "core_action_evaluator"),
  }, automation.json.key);
  assert.equal(automationAttempt.status, 200);
  assert.equal(automationAttempt.json.authorization.allowed, false);

  const ownerScoped = await request("POST", "/v1/keys/generate", {
    tenant_id: "codexai",
    key_type: "connector",
    allowed_scopes: ["read:decision", "owner:assertion"],
  });
  const auditMarker = "token=SHOULD_NOT_ENTER_TENANT_GATE_AUDIT";
  const rejectedAuditPoisonBody = {
    ...base,
    target_service: auditMarker,
    owner_confirmed: true,
  };
  const rejectedAuditPoison = await request("POST", "/v1/action-evaluator", {
    ...rejectedAuditPoisonBody,
    owner_context: signedOwnerContext(ownerScoped.json.key, "codexai", rejectedAuditPoisonBody, "core_action_evaluator"),
  }, ownerScoped.json.key);
  assert.equal(rejectedAuditPoison.json.authorization.allowed, false);
  const auditLog = fs.readFileSync(path.join(storageRoot, "audit", "events.jsonl"), "utf8");
  assert.equal(auditLog.includes(auditMarker), false);

  const proofWithoutConfirmationBody = { ...base, owner_confirmed: false };
  const proofWithoutConfirmation = await request("POST", "/v1/action-evaluator", {
    ...proofWithoutConfirmationBody,
    owner_context: signedOwnerContext(ownerScoped.json.key, "codexai", proofWithoutConfirmationBody, "core_action_evaluator"),
  }, ownerScoped.json.key);
  assert.equal(proofWithoutConfirmation.json.authorization.allowed, false);

  const signedBody = { ...base, owner_confirmed: true };
  const ownerContext = signedOwnerContext(ownerScoped.json.key, "codexai", signedBody, "core_action_evaluator");
  const authorized = await request("POST", "/v1/action-evaluator", {
    ...signedBody,
    owner_context: ownerContext,
  }, ownerScoped.json.key);
  assert.equal(authorized.status, 200);
  assert.equal(authorized.json.authorization.allowed, true);
  assert.equal(authorized.json.authorization.scope, "reversible_owner_confirmed_mcp_default_tenant_correction");

  const replay = await request("POST", "/v1/action-evaluator", {
    ...signedBody,
    action_label: "Mutated label",
    owner_context: ownerContext,
  }, ownerScoped.json.key);
  assert.equal(replay.json.authorization.allowed, false);
}));

test("intelligence API validates required collections", async () => fixture(async (request) => {
  const generated = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-invalid", preset: "nyra_core_360_connector" });
  const response = await request("POST", "/v1/intelligence/decisions/select", { options: [{ id: "only" }] }, generated.json.key);
  assert.equal(response.status, 400);
  assert.equal(response.json.error, "at_least_two_options_required");
}));

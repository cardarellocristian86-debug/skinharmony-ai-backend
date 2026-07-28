import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";
import { buildActionAuthorization } from "../src/actionAuthorization.js";
import { evaluateDomainActionAuthorization } from "../src/domainActionAuthorization.js";
import {
  SKINHARMONY_MCP_STAGING_PHASES,
  SKINHARMONY_MCP_STAGING_POLICY_MAX_MONTHLY_COST_CENTS,
  buildSkinHarmonyMcpStagingTopologySpecDigest,
  skinHarmonyMcpStagingPhaseControls,
  skinHarmonyMcpStagingTopology,
} from "../src/domainAdapters/skinharmonyMcpStagingTopologyAction.js";
import { SCOPES } from "../src/scope.js";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function contract(overrides = {}) {
  return {
    state: "attention",
    risk_band: "high",
    control_level: "confirm",
    recommended_actions: [{ blocked: false }],
    ...overrides,
  };
}

function topologyAction(overrides = {}) {
  const phase = overrides.phase || "blueprint_apply_dependencies";
  const controls = skinHarmonyMcpStagingPhaseControls(phase) || {
    external_side_effect: true,
    configuration_changes: true,
    provider_execution: true,
    execution_enabled: true,
    deploy: true,
  };
  const body = {
    action_label: "Deploy isolated SkinHarmony MCP staging topology",
    action_type: "render_mcp_staging_topology_phase",
    operation_class: "reversible_owner_confirmed_mcp_staging_topology",
    domain_action_id: "skinharmony_mcp_staging_topology_v1",
    authenticated_tenant_id: "codexai",
    tenant_id: "codexai",
    owner_confirmed: true,
    owner_context_verified: true,
    owner_context_approval_bound: false,
    agent_id: "codex_mcp_staging_release",
    client_type: "codex",
    session_id: "mcp_staging_release_20260727",
    owner_context: {
      schema_version: "core_owner_context_v1",
      tenant_id: "codexai",
      assertion: `ocs_${"1".repeat(64)}`,
    },
    request_bound_owner_confirmation: true,
    authenticated_key_type: "connector",
    memory_context: {
      schema_version: "tenant_memory_context_v1",
      tenant_id: "codexai",
      revision: 12,
    },
    ...controls,
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
    auth0_changes: false,
    production_deploy: false,
    merge: false,
    delete: false,
    create_missing_only: true,
    overwrite_existing: false,
    target_branch: "agent/mcp-staging-shared-memory-release",
    target_commit: COMMIT,
    environment: "staging",
    region: "Oregon",
    phase,
    topology: skinHarmonyMcpStagingTopology(),
    provider_native_references: true,
    secret_values_present: false,
    maximum_recurring_monthly_cost_cents: 6_000,
    recurring_cost_currency: "USD",
    recurring_cost_confirmed: true,
    confirmation_maximum_recurring_monthly_cost_cents: 6_000,
    confirmation_recurring_cost_currency: "USD",
    confirmation_reference: "owner-confirmed-staging-topology-at-60-usd-monthly-maximum",
    ...overrides,
  };
  const digest = buildSkinHarmonyMcpStagingTopologySpecDigest(body);
  if (!Object.hasOwn(overrides, "spec_digest")) body.spec_digest = digest;
  if (!Object.hasOwn(overrides, "confirmation_spec_digest")) {
    body.confirmation_spec_digest = digest;
  }
  return body;
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function signedActionOwnerContext(key, tenantId, body) {
  const { owner_context: _ownerContext, ...payload } = body;
  const binding = `core_action_evaluator\u0000${JSON.stringify(stableCanonical(payload))}`;
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
    assertion: `ocs_${crypto.createHmac("sha256", key)
      .update(`owner-context\u0000${canonical}`)
      .digest("hex")}`,
  };
}

function topologyHttpEnvelope() {
  const body = topologyAction();
  for (const serverDerived of [
    "authenticated_tenant_id",
    "tenant_id",
    "owner_context_verified",
    "owner_context_approval_bound",
    "owner_context",
    "request_bound_owner_confirmation",
    "authenticated_key_type",
  ]) {
    delete body[serverDerived];
  }
  return body;
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function request(base, method, pathname, body, key) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test("authorizes only the exact server-confirmed MCP staging topology spec", () => {
  const body = topologyAction();
  const runtimeServices = body.topology.services.filter(({ name }) =>
    body.topology.rollout_contract.runtime_services.includes(name));
  assert.deepEqual(
    runtimeServices.map(({ name }) => name),
    [
      "skinharmony-universal-core-staging",
      "skinharmony-core-mcp-staging",
    ],
  );
  assert.deepEqual(
    runtimeServices.map(({ plan }) => plan),
    ["starter", "starter"],
  );
  const result = buildActionAuthorization(contract(), body);
  assert.equal(result.allowed, true);
  assert.equal(result.state, "authorized_after_confirmation");
  assert.equal(result.scope, "reversible_owner_confirmed_mcp_staging_topology");
  assert.equal(result.domain_action_id, "skinharmony_mcp_staging_topology_v1");
  assert.equal(result.spec_digest, body.spec_digest);
  assert.equal(result.workflow_phase, body.phase);
  assert.equal(result.target_commit, COMMIT);

  for (const missingServerProof of [
    { owner_confirmed: false },
    { owner_context_verified: false },
  ]) {
    const pending = buildActionAuthorization(contract(), topologyAction(missingServerProof));
    assert.equal(pending.allowed, false);
    assert.equal(pending.state, "confirmation_required");
    assert.equal(pending.mediation, "confirm");
    assert.equal(pending.confirmation_satisfied, false);
  }
});

test("binds every enumerated phase into the confirmed spec digest", () => {
  assert.deepEqual(SKINHARMONY_MCP_STAGING_PHASES, [
    "blueprint_validate",
    "blueprint_apply_dependencies",
    "bootstrap_control_plane",
    "database_runtime_role_transition",
    "blueprint_apply_runtime",
    "persistence_canary",
  ]);

  for (const phase of SKINHARMONY_MCP_STAGING_PHASES) {
    const body = topologyAction({ phase });
    const result = buildActionAuthorization(contract(), body);
    assert.equal(result.allowed, true, phase);
    assert.equal(result.workflow_phase, phase);
    assert.equal(result.spec_digest, buildSkinHarmonyMcpStagingTopologySpecDigest(body));
  }

  const unknown = buildActionAuthorization(contract(), topologyAction({ phase: "deploy_everything" }));
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.state, "blocked");
});

test("reserves staging names and variables so they cannot fall back to generic deploy", () => {
  const genericDeploy = {
    action_type: "deploy",
    operation_class: "reversible_owner_confirmed_deploy",
    external_side_effect: true,
    contains_customer_data: false,
    cross_tenant: false,
    rollback_ready: true,
    audit_ready: true,
    configuration_changes: false,
    target_commit: COMMIT,
    confirmation_reference: "owner-confirmed-generic-deploy",
    owner_confirmed: true,
  };
  assert.equal(buildActionAuthorization(contract(), genericDeploy).allowed, true);

  for (const reserved of [
    { target: "skinharmony-core-mcp-staging" },
    { target_service: "SKINHARMONY_CORE_STAGING_ISSUER" },
    { name: "skinharmony-nyra-staging-issuer" },
    { database_name: "SkinHarmony MCP Staging DB" },
    { allowed_environment_variables: ["MCP_COLLABORATION_DATABASE_URL"] },
    { target_environment_variable: "mcp-collaboration-core-issuer-hostport" },
    { target_environment_variable: "MCP_STAGING_NEW_UNREVIEWED_VARIABLE" },
  ]) {
    const result = buildActionAuthorization(contract(), { ...genericDeploy, ...reserved });
    assert.equal(result.allowed, false, JSON.stringify(reserved));
    assert.equal(result.state, "blocked");
    assert.equal(result.scope, "mcp_staging_reserved_domain");
    assert.equal(result.reason, "reserved_mcp_staging_action_requires_dedicated_gate");
  }

  const branchOnly = evaluateDomainActionAuthorization({
    body: {
      action_type: "repository_file_update",
      operation_class: "reversible_owner_confirmed_branch_change",
      target_branch: "agent/mcp-staging-shared-memory-release",
    },
  });
  assert.equal(branchOnly.reserved, false);
});

test("hard-blocks aliases, extra fields, production, main, Auth0 and topology expansion", () => {
  const aliasTopology = skinHarmonyMcpStagingTopology();
  aliasTopology.database.name = "skinharmony_mcp_staging_db";
  const extraServiceTopology = skinHarmonyMcpStagingTopology();
  extraServiceTopology.services.push({
    name: "unreviewed-sidecar",
    resource_type: "private_service",
    plan: "starter",
    lifecycle: "create_only",
  });
  const extraTopologyField = skinHarmonyMcpStagingTopology();
  extraTopologyField.database.provider_id = "opaque-looking-but-unapproved";
  const unavailableDatabaseTopology = skinHarmonyMcpStagingTopology();
  unavailableDatabaseTopology.database.required_status = "suspended";
  const freeMcpTopology = skinHarmonyMcpStagingTopology();
  freeMcpTopology.services.find(({ name }) =>
    name === "skinharmony-core-mcp-staging").plan = "free";
  const freeUniversalCoreTopology = skinHarmonyMcpStagingTopology();
  freeUniversalCoreTopology.services.find(({ name }) =>
    name === "skinharmony-universal-core-staging").plan = "free";
  const broadenedRuntimeTopology = skinHarmonyMcpStagingTopology();
  broadenedRuntimeTopology.rollout_contract.runtime_services.push(
    "skinharmony-core-staging-issuer",
  );

  for (const unsafe of [
    { environment: "production" },
    { region: "oregon" },
    { target_branch: "main" },
    { target_commit: "main" },
    { authenticated_tenant_id: "other-tenant" },
    { tenant_id: "other-tenant" },
    { cross_tenant: true },
    { destructive: true },
    { auth0_changes: true },
    { production_deploy: true },
    { merge: true },
    { delete: true },
    { rollback_ready: false },
    { audit_ready: false },
    { readback_required: false },
    { database_connection: true },
    { database_mutation: true },
    { owner_context_approval_bound: true },
    { request_bound_owner_confirmation: false },
    { authenticated_key_type: "automation" },
    { owner_context: null },
    { topology: aliasTopology },
    { topology: extraServiceTopology },
    { topology: extraTopologyField },
    { topology: unavailableDatabaseTopology },
    { topology: freeMcpTopology },
    { topology: freeUniversalCoreTopology },
    { topology: broadenedRuntimeTopology },
    { unexpected_field: "not-in-the-closed-envelope" },
  ]) {
    const result = buildActionAuthorization(contract(), topologyAction(unsafe));
    assert.equal(result.allowed, false, JSON.stringify(unsafe));
    assert.equal(result.state, "blocked");
    assert.equal(result.mediation, "hard_block");
  }
});

test("hard-blocks missing or broadened cost authority and non-opaque references", () => {
  const nonOpaqueTopology = skinHarmonyMcpStagingTopology();
  nonOpaqueTopology.reference_policy.transfer = "plaintext";
  nonOpaqueTopology.reference_policy.secret_value_readback = true;

  for (const unsafe of [
    { recurring_cost_confirmed: false },
    { confirmation_maximum_recurring_monthly_cost_cents: 5_999 },
    { confirmation_recurring_cost_currency: "EUR" },
    { maximum_recurring_monthly_cost_cents: 0 },
    {
      maximum_recurring_monthly_cost_cents:
        SKINHARMONY_MCP_STAGING_POLICY_MAX_MONTHLY_COST_CENTS + 1,
      confirmation_maximum_recurring_monthly_cost_cents:
        SKINHARMONY_MCP_STAGING_POLICY_MAX_MONTHLY_COST_CENTS + 1,
    },
    { provider_native_references: false },
    { secret_values_present: true },
    { contains_secret: true },
    { secret_value_transmitted: true },
    { values_present_in_envelope: true },
    { topology: nonOpaqueTopology },
  ]) {
    const result = buildActionAuthorization(contract(), topologyAction(unsafe));
    assert.equal(result.allowed, false, JSON.stringify(unsafe));
    assert.equal(result.state, "blocked");
  }
});

test("rejects digest substitution and decision-level hard blocks", () => {
  const substituted = topologyAction({
    spec_digest: "a".repeat(64),
    confirmation_spec_digest: "a".repeat(64),
  });
  const digestResult = buildActionAuthorization(contract(), substituted);
  assert.equal(digestResult.allowed, false);
  assert.equal(digestResult.state, "blocked");

  const decisionBlocked = buildActionAuthorization(
    contract({ state: "blocked" }),
    topologyAction(),
  );
  assert.equal(decisionBlocked.allowed, false);
  assert.equal(decisionBlocked.state, "blocked");
});

test("HTTP action evaluator authorizes only a connector-bound MCP staging topology proof", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "mcp-staging-topology-http-admin";
  const service = createUniversalCoreService({
    storageRoot: path.join(
      os.tmpdir(),
      `mcp-staging-topology-http-${Date.now()}-${Math.random()}`,
    ),
  });
  const { server, base } = await listen(service.app);

  try {
    const connector = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "codexai",
      key_type: "connector",
      label: "MCP staging topology HTTP integration",
      allowed_scopes: [SCOPES.READ_DECISION, SCOPES.OWNER_ASSERTION],
    }, "mcp-staging-topology-http-admin");
    assert.equal(connector.status, 201);

    const envelope = topologyHttpEnvelope();
    const ownerContext = signedActionOwnerContext(
      connector.json.key,
      "codexai",
      envelope,
    );
    const authorized = await request(base, "POST", "/v1/action-evaluator", {
      ...envelope,
      owner_context: ownerContext,
    }, connector.json.key);
    assert.equal(authorized.status, 200);
    assert.equal(authorized.json.tenant_id, "codexai");
    assert.equal(authorized.json.authorization.allowed, true);
    assert.equal(
      authorized.json.authorization.scope,
      "reversible_owner_confirmed_mcp_staging_topology",
    );
    assert.equal(
      authorized.json.authorization.domain_action_id,
      "skinharmony_mcp_staging_topology_v1",
    );
    assert.equal(authorized.json.authorization.spec_digest, envelope.spec_digest);
    assert.equal(authorized.json.authorization.workflow_phase, envelope.phase);

    const replay = await request(base, "POST", "/v1/action-evaluator", {
      ...envelope,
      confirmation_reference: "different-safe-confirmation-reference",
      owner_context: ownerContext,
    }, connector.json.key);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.authorization.allowed, false);
    assert.equal(replay.json.authorization.state, "blocked");
    assert.equal(replay.json.authorization.mediation, "hard_block");
    assert.equal(replay.json.guardrail.execution_allowed, false);

    const forgedEnvelope = topologyHttpEnvelope();
    const forged = await request(base, "POST", "/v1/action-evaluator", {
      ...forgedEnvelope,
      request_bound_owner_confirmation: true,
      authenticated_key_type: "connector",
      owner_context: signedActionOwnerContext(
        "not-the-authenticated-connector-key",
        "codexai",
        forgedEnvelope,
      ),
    }, connector.json.key);
    assert.equal(forged.status, 200);
    assert.equal(forged.json.authorization.allowed, false);
    assert.equal(forged.json.authorization.state, "blocked");
    assert.equal(forged.json.authorization.mediation, "hard_block");
    assert.equal(forged.json.guardrail.execution_allowed, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

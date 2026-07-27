import assert from "node:assert/strict";
import test from "node:test";
import { buildActionAuthorization } from "../src/actionAuthorization.js";
import { evaluateDomainActionAuthorization } from "../src/domainActionAuthorization.js";
import {
  SKINHARMONY_MCP_STAGING_PHASES,
  SKINHARMONY_MCP_STAGING_POLICY_MAX_MONTHLY_COST_CENTS,
  buildSkinHarmonyMcpStagingTopologySpecDigest,
  skinHarmonyMcpStagingPhaseControls,
  skinHarmonyMcpStagingTopology,
} from "../src/domainAdapters/skinharmonyMcpStagingTopologyAction.js";

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
    maximum_recurring_monthly_cost_cents: 5_300,
    recurring_cost_currency: "USD",
    recurring_cost_confirmed: true,
    confirmation_maximum_recurring_monthly_cost_cents: 5_300,
    confirmation_recurring_cost_currency: "USD",
    confirmation_reference: "owner-confirmed-staging-topology-at-53-usd-monthly-maximum",
    ...overrides,
  };
  const digest = buildSkinHarmonyMcpStagingTopologySpecDigest(body);
  if (!Object.hasOwn(overrides, "spec_digest")) body.spec_digest = digest;
  if (!Object.hasOwn(overrides, "confirmation_spec_digest")) {
    body.confirmation_spec_digest = digest;
  }
  return body;
}

test("authorizes only the exact server-confirmed MCP staging topology spec", () => {
  const body = topologyAction();
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
    { owner_context_approval_bound: true },
    { topology: aliasTopology },
    { topology: extraServiceTopology },
    { topology: extraTopologyField },
    { topology: unavailableDatabaseTopology },
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
    { confirmation_maximum_recurring_monthly_cost_cents: 5_299 },
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

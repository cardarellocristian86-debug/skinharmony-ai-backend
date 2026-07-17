import assert from "node:assert/strict";
import test from "node:test";
import { buildActionAuthorization } from "../src/actionAuthorization.js";
import { evaluateDomainActionAuthorization } from "../src/domainActionAuthorization.js";
import { skinHarmonyMcpStagingActionTemplate } from "../src/domainAdapters/skinharmonyMcpStagingAction.js";

const CONTEXT = Object.freeze({
  tenantId: "codexai",
  keyId: "key_12345678-abcd-4321",
  domainPackId: "skinharmony",
});

const HIGH_CONTRACT = Object.freeze({
  state: "attention",
  risk_band: "high",
  control_level: "confirm",
  recommended_actions: [{ blocked: false }],
});

function request() {
  return { ...skinHarmonyMcpStagingActionTemplate(), tenant_id: CONTEXT.tenantId };
}

function domain(body, actionConfirmation) {
  return evaluateDomainActionAuthorization({ body, ...CONTEXT, actionConfirmation });
}

test("composes the exact domain adapter as a pending then confirmed Core authorization", () => {
  const body = request();
  const pendingDomain = domain(body);
  const pending = buildActionAuthorization(HIGH_CONTRACT, body, { domainAction: pendingDomain });
  assert.equal(pending.allowed, false);
  assert.equal(pending.state, "confirmation_required");
  assert.equal(pending.mediation, "confirm");
  assert.equal(pending.scope, "reversible_owner_confirmed_mcp_staging_service");
  assert.match(pending.action_digest, /^[a-f0-9]{64}$/);
  assert.equal(pending.revalidation_required, true);

  const confirmedBody = {
    ...body,
    owner_confirmed: true,
    confirmed_action_digest: pending.action_digest,
  };
  const confirmedDomain = domain(confirmedBody, {
    verified: true,
    tenant_id: CONTEXT.tenantId,
    confirmation_reference: confirmedBody.confirmation_reference,
    action_digest: pending.action_digest,
  });
  const confirmed = buildActionAuthorization(HIGH_CONTRACT, confirmedBody, { domainAction: confirmedDomain });
  assert.equal(confirmed.allowed, true);
  assert.equal(confirmed.state, "authorized_after_confirmation");
  assert.equal(confirmed.confirmation_satisfied, true);
  assert.equal(confirmed.target_commit, confirmedBody.target_commit);
  assert.equal(confirmed.domain_action_id, "skinharmony_mcp_staging_render_create_v1");
  const serialized = JSON.stringify(confirmed);
  for (const privateId of ["tea-d780", "prj-d781", "evm-d9cd", "dpg-d9cd"]) assert.equal(serialized.includes(privateId), false);
});

test("preserves only the exact pre-existing PostgreSQL staging gate", () => {
  const postgres = {
    action_label: "Create isolated staging PostgreSQL",
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
    target_commit: "f435aafb709a26c77e82e2688056d73056d69c82",
    confirmation_reference: "owner-confirmed-staging-postgres",
    owner_confirmed: true,
  };
  const postgresDomain = domain(postgres);
  assert.equal(postgresDomain.reserved, false);
  const allowed = buildActionAuthorization(HIGH_CONTRACT, postgres, { domainAction: postgresDomain });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.scope, "reversible_owner_confirmed_deploy");

  for (const unsafe of [
    { ...postgres, target: "skinharmony-db" },
    { ...postgres, target_branch: "main" },
    { ...postgres, DATABASE_URL: "password=synthetic-test-only" },
    { ...postgres, auth0_changes: true },
    { ...postgres, service_name: "skinharmony-core-mcp-staging" },
  ]) {
    const domainAction = domain(unsafe);
    assert.equal(domainAction.reserved, true);
    assert.equal(buildActionAuthorization(HIGH_CONTRACT, unsafe, { domainAction }).allowed, false);
  }
});

test("a staging confirmation cannot fall through to a generic deploy, read or sandbox scope", () => {
  const generic = {
    action_type: "deploy",
    operation_class: "reversible_owner_confirmed_deploy",
    target: "render:web_service:unrelated-staging",
    external_side_effect: true,
    contains_customer_data: false,
    cross_tenant: false,
    rollback_ready: true,
    audit_ready: true,
    configuration_changes: false,
    target_commit: "f435aafb709a26c77e82e2688056d73056d69c82",
    confirmation_reference: "ucr_mcp_staging_20260716_01",
    owner_confirmed: true,
  };
  for (const body of [
    generic,
    { ...generic, target_commit: generic.target_commit.toUpperCase() },
    { ...generic, target: "skinharmony-core-mcp", target_branch: "main", target_commit: "a".repeat(40) },
    { ...generic, action_type: "read", operation_class: "tenant_scoped_read", external_side_effect: false },
    { ...generic, action_type: "prepare", operation_class: "sandboxed_scoped_work", external_side_effect: false },
  ]) {
    const result = buildActionAuthorization(HIGH_CONTRACT, body, { domainAction: domain(body) });
    assert.equal(result.allowed, false);
    assert.equal(result.scope, "evaluation_only");
    assert.equal(result.confirmation_satisfied, false);
  }

  const unrelated = { ...generic, target_commit: "a".repeat(40), confirmation_reference: "owner-confirmed-unrelated-deploy" };
  const unrelatedDomain = domain(unrelated);
  assert.equal(unrelatedDomain.reserved, false);
  assert.equal(buildActionAuthorization(HIGH_CONTRACT, unrelated, { domainAction: unrelatedDomain }).allowed, true);

  const aliasBase = { ...unrelated };
  for (const body of [
    { ...aliasBase, target_service: "skinharmony-core-mcp-staging" },
    { ...aliasBase, target: "render:web_service:skinharmony-core-mcp-staging" },
    { ...aliasBase, render_service_name: "skinharmony-core-mcp-staging" },
    { ...aliasBase, service: { name: "skinharmony-core-mcp-staging" } },
    { ...aliasBase, database_name: "skinharmony-mcp-staging-db" },
    { ...aliasBase, target_branch: "agent/multiagent-postgres-cloud" },
    { ...aliasBase, nested: { resource: { id: "dpg-d9cdeie1a83c73ca5l10-a" } } },
  ]) {
    const domainAction = domain(body);
    assert.equal(domainAction.reserved, true);
    assert.equal(buildActionAuthorization(HIGH_CONTRACT, body, { domainAction }).allowed, false);
  }
});

test("arrays and hard-blocked domain payloads cannot inherit another authorization scope", () => {
  const generic = {
    action_type: "deploy",
    operation_class: "reversible_owner_confirmed_deploy",
    target: "render:web_service:unrelated-staging",
    external_side_effect: true,
    contains_customer_data: false,
    cross_tenant: false,
    rollback_ready: true,
    audit_ready: true,
    configuration_changes: false,
    target_commit: "a".repeat(40),
    confirmation_reference: "owner-confirmed-unrelated-deploy",
    owner_confirmed: true,
  };
  assert.equal(buildActionAuthorization(HIGH_CONTRACT, { ...generic, action_type: ["deploy"] }).allowed, false);
  assert.equal(buildActionAuthorization(HIGH_CONTRACT, { ...generic, target_commit: [generic.target_commit] }).allowed, false);
  assert.equal(buildActionAuthorization(HIGH_CONTRACT, { ...generic, target_commit: generic.target_commit.toUpperCase() }).allowed, false);

  const dangerous = { ...request(), DATABASE_URL: "password=synthetic-test-only", owner_confirmed: true };
  const result = buildActionAuthorization(HIGH_CONTRACT, dangerous, { domainAction: domain(dangerous) });
  assert.equal(result.allowed, false);
  assert.equal(result.state, "blocked");
  assert.equal(result.mediation, "hard_block");
});

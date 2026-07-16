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

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
  cross_tenant: false,
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
  ]) assert.equal(buildActionAuthorization(contract({ risk_band: "high" }), unsafe).allowed, false);
});

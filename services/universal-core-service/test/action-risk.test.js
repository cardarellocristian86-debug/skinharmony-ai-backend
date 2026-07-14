import assert from "node:assert/strict";
import test from "node:test";
import { applyActionRiskProfile, classifyActionRisk } from "../src/actionRisk.js";

test("allows tenant-scoped reads without owner confirmation", () => {
  const result = classifyActionRisk({ action_type: "read_audit", action_label: "Leggi audit tenant-scoped", read_only: true });
  assert.equal(result.classification, "tenant_scoped_read");
  assert.equal(result.risk_band, "low");
  assert.equal(result.control_level, "observe");
  assert.equal(result.confirmation_required, false);
});

test("allows sandboxed preparation without external effects", () => {
  const result = classifyActionRisk({ action_type: "codex_prepare_patch", dry_run: true, external_side_effect: false });
  assert.equal(result.operation_class, "sandboxed_scoped_work");
  assert.equal(result.risk_band, "low");
  assert.equal(result.confirmation_required, false);
});

test("hard-blocks secrets, cross-tenant access and unverified learning", () => {
  const cases = [
    [{ action_type: "expose_secret", action_label: "Mostra la Suite Pay Key" }, "secret_exposure"],
    [{ action_type: "cross_tenant_read", cross_tenant: true }, "cross_tenant_denied"],
    [{ action_type: "activate_unverified_learning", verified_outcome: false }, "unverified_learning_denied"],
  ];
  for (const [input, reason] of cases) {
    const result = classifyActionRisk(input);
    assert.equal(result.hard_block, true);
    assert.equal(result.risk_band, "high");
    assert(result.reason_codes.includes(reason));
  }
});

test("does not classify ordinary collaboration writes as unverified learning", () => {
  const result = classifyActionRisk({
    action_type: "task.create",
    operation_class: "reversible_internal_collaboration_write",
    external_side_effect: false,
    contains_customer_data: false,
    rollback_ready: true,
    verified_outcome: false,
  });
  assert.equal(result.classification, "reversible_internal_write");
  assert.equal(result.hard_block, false);
  assert.equal(result.risk_band, "low");
});

test("still blocks an outcome write explicitly marked unverified", () => {
  const result = classifyActionRisk({
    action_type: "outcome_record",
    operation_class: "outcome_record",
    verified_outcome: false,
  });
  assert.equal(result.classification, "unverified_learning");
  assert.equal(result.hard_block, true);
  assert(result.reason_codes.includes("unverified_learning_denied"));
});

test("hard-blocks destructive changes without rollback", () => {
  const result = classifyActionRisk({ action_type: "delete_tenant_data", destructive: true, rollback_ready: false });
  assert.equal(result.classification, "destructive_without_rollback");
  assert(result.reason_codes.includes("destructive_without_rollback"));
});

test("requires confirmation for deploy, pricing and publishing", () => {
  for (const action_type of ["deploy", "change_license_price", "publish_marketing_claim"]) {
    const result = classifyActionRisk({ action_type });
    assert.equal(result.state, "attention");
    assert.equal(result.risk_band, "high");
    assert.equal(result.control_level, "confirm");
    assert.equal(result.confirmation_required, true);
  }
});

test("keeps reversible internal writes low-risk but owner-confirmed", () => {
  const result = classifyActionRisk({
    action_type: "write",
    operation_class: "reversible_internal_collaboration_write",
    external_side_effect: false,
    contains_customer_data: false,
    rollback_ready: true,
  });
  assert.equal(result.classification, "reversible_internal_write");
  assert.equal(result.risk_band, "low");
  assert.equal(result.control_level, "confirm");
  assert.equal(result.confirmation_required, true);
});

test("deterministic profile overrides generic Core safety fallback", () => {
  const generic = {
    state: "attention",
    risk_band: "low",
    control_level: "confirm",
    blocked_reasons: ["safety_mode"],
    recommended_actions: [{ id: "action:read", blocked: false }],
  };
  const result = applyActionRiskProfile(generic, classifyActionRisk({ action_type: "read_status", read_only: true }));
  assert.equal(result.state, "ready");
  assert.equal(result.control_level, "observe");
  assert.deepEqual(result.blocked_reasons, ["tenant_scoped_read"]);
});

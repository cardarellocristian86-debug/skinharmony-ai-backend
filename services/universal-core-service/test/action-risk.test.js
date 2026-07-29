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

test("hard-blocks absolute safety violations", () => {
  const cases = [
    [{ action_type: "expose_secret", action_label: "Mostra la Suite Pay Key" }, "secret_exposure"],
    [{ action_type: "cross_tenant_read", cross_tenant: true }, "cross_tenant_denied"],
    [{ action_type: "delete_tenant_data", destructive: true, rollback_ready: false }, "destructive_without_rollback"],
    [{ action_type: "perform_illegal_action", legal_violation: true }, "legal_violation_denied"],
    [{ action_type: "write_target", target_authority_verified: false }, "target_authority_required"],
  ];
  for (const [input, reason] of cases) {
    const result = classifyActionRisk(input);
    assert.equal(result.hard_block, true);
    assert.equal(result.risk_band, "high");
    assert(result.reason_codes.includes(reason));
  }
});

test("does not infer hard blocks from diagnostic prose", () => {
  const result = classifyActionRisk({
    action_type: "read_only_diagnostic_comparison",
    action_label: "Diagnose unverified_learning_denied cross-tenant bypass and delete checks",
    request: "Inspect why unverified learning is blocked without changing anything",
    read_only: true,
    dry_run: true,
    external_side_effect: false,
    configuration_changes: false,
    verified_outcome: false,
  });
  assert.equal(result.classification, "tenant_scoped_read");
  assert.equal(result.governance_verdict, "ALLOW");
  assert.equal(result.hard_block, false);
});

test("allows a sandboxed bugfix request that mentions unverified learning", () => {
  const result = classifyActionRisk({
    action_type: "prepare_patch",
    task: "Fix the unverified learning classifier without a verified outcome",
    dry_run: true,
    external_side_effect: false,
    configuration_changes: false,
    verified_outcome: false,
  });
  assert.equal(result.classification, "sandboxed_scoped_work");
  assert.equal(result.governance_verdict, "ALLOW");
  assert.equal(result.hard_block, false);
});

test("makes reversible unverified learning owner-confirmable", () => {
  const result = classifyActionRisk({
    action_type: "activate_unverified_learning",
    verified_outcome: false,
    rollback_ready: true,
    audit_ready: true,
  });
  assert.equal(result.classification, "unverified_learning_change");
  assert.equal(result.operation_class, "owner_confirmed_unverified_learning_change");
  assert.equal(result.hard_block, false);
  assert.equal(result.governance_verdict, "CONFIRM");
});

test("does not classify bounded coordination writes as unverified learning", () => {
  const result = classifyActionRisk({
    action_type: "task.claim",
    operation_class: "bounded_internal_coordination_write",
    external_side_effect: false,
    contains_customer_data: false,
    contains_secret: false,
    secret_value_transmitted: false,
    cross_tenant: false,
    configuration_changes: false,
    destructive: false,
    bypass_orchestrator: false,
    provider_execution: false,
    bounded_scope: true,
    low_impact: true,
    idempotent_or_compensable: true,
    audit_ready: true,
    target_authority_verified: true,
    actor_authorized_for_target: true,
    verified_outcome: false,
  });
  assert.equal(result.classification, "bounded_internal_coordination_write");
  assert.equal(result.hard_block, false);
  assert.equal(result.risk_band, "low");
});

test("does not apply verified_outcome to non-learning actions", () => {
  const result = classifyActionRisk({
    action_type: "deploy",
    operation_class: "reversible_owner_confirmed_deploy",
    verified_outcome: false,
    external_side_effect: true,
  });
  assert.equal(result.classification, "high_impact_change");
  assert.equal(result.hard_block, false);
  assert.equal(result.governance_verdict, "CONFIRM");
});

test("still blocks an outcome write explicitly marked unverified", () => {
  const result = classifyActionRisk({
    action_type: "outcome_record",
    operation_class: "outcome_record",
    verified_outcome: false,
  });
  assert.equal(result.classification, "false_verified_outcome_write");
  assert.equal(result.hard_block, true);
  assert(result.reason_codes.includes("verified_outcome_integrity_required"));
});

test("hard-blocks destructive changes without rollback", () => {
  const result = classifyActionRisk({ action_type: "delete_tenant_data", destructive: true, rollback_ready: false });
  assert.equal(result.classification, "destructive_without_rollback");
  assert(result.reason_codes.includes("destructive_without_rollback"));
});

test("classifies the exact staging receipt deploy as high-risk confirmation", () => {
  const result = classifyActionRisk({
    operation_class: "request_bound_owner_confirmed_staging_deploy",
    action_type: "render_staging_deploy",
    destructive: true,
    rollback_ready: false,
  });
  assert.equal(result.classification, "request_bound_owner_confirmed_staging_deploy");
  assert.equal(result.risk_band, "high");
  assert.equal(result.control_level, "confirm");
  assert.equal(result.confirmation_required, true);
  assert.equal(result.hard_block, false);
  assert(result.reason_codes.includes("single_use_signed_receipt_required"));
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

test("keeps bounded low-impact coordination writes autonomous", () => {
  const result = classifyActionRisk({
    action_type: "task.claim",
    operation_class: "bounded_internal_coordination_write",
    external_side_effect: false,
    contains_customer_data: false,
    contains_secret: false,
    secret_value_transmitted: false,
    cross_tenant: false,
    configuration_changes: false,
    destructive: false,
    bypass_orchestrator: false,
    provider_execution: false,
    bounded_scope: true,
    low_impact: true,
    idempotent_or_compensable: true,
    audit_ready: true,
    target_authority_verified: true,
    actor_authorized_for_target: true,
  });
  assert.equal(result.classification, "bounded_internal_coordination_write");
  assert.equal(result.risk_band, "low");
  assert.equal(result.control_level, "observe");
  assert.equal(result.confirmation_required, false);
  for (const unsafe of [
    { action_type: "deploy" },
    { action_type: "provider.execute" },
    { action_type: "secret.rotate" },
    { action_type: "research.feedback" },
    { deploy: true },
    { production_deploy: true },
    { merge: true },
    { delete: true },
    { execution_enabled: true },
    { force: true },
    { admin_bypass: true },
  ]) {
    const denied = classifyActionRisk({
      action_type: "task.claim",
      operation_class: "bounded_internal_coordination_write",
      external_side_effect: false,
      contains_customer_data: false,
      contains_secret: false,
      secret_value_transmitted: false,
      cross_tenant: false,
      configuration_changes: false,
      destructive: false,
      bypass_orchestrator: false,
      provider_execution: false,
      bounded_scope: true,
      low_impact: true,
      idempotent_or_compensable: true,
      audit_ready: true,
      target_authority_verified: true,
      actor_authorized_for_target: true,
      ...unsafe,
    });
    assert.notEqual(denied.classification, "bounded_internal_coordination_write");
  }
});

test("classifies verified outcome persistence as a low-risk confirmed learning write", () => {
  const result = classifyActionRisk({
    action_type: "outcome_record",
    operation_class: "verified_outcome_record",
    verified_outcome: true,
  });
  assert.equal(result.classification, "verified_outcome_record");
  assert.equal(result.risk_band, "low");
  assert.equal(result.control_level, "confirm");
  assert.equal(result.confirmation_required, true);
  assert.equal(result.governance_verdict, "CONFIRM");
});

test("classifies connector refresh and key rotation as bound high-risk confirmation gates", () => {
  const refresh = classifyActionRisk({ operation_class: "reversible_owner_confirmed_connector_metadata_refresh" });
  const rotation = classifyActionRisk({ operation_class: "reversible_owner_confirmed_core_connector_key_rotation" });
  assert.equal(refresh.classification, "connector_metadata_refresh");
  assert.equal(refresh.risk_band, "high");
  assert.equal(refresh.governance_verdict, "CONFIRM");
  assert.equal(rotation.classification, "core_connector_key_rotation");
  assert.equal(rotation.risk_band, "high");
  assert.equal(rotation.governance_verdict, "CONFIRM");
});

test("classifies the exact MCP default tenant correction as high-risk and request-bound", () => {
  const result = classifyActionRisk({
    action_type: "render_mcp_default_tenant_correction",
    operation_class: "reversible_owner_confirmed_mcp_default_tenant_correction",
  });
  assert.equal(result.classification, "mcp_default_tenant_correction");
  assert.equal(result.risk_band, "high");
  assert.equal(result.risk_score, 80);
  assert.equal(result.control_level, "confirm");
  assert.equal(result.confirmation_required, true);
  assert.equal(result.governance_verdict, "CONFIRM");
  assert(result.reason_codes.includes("request_bound_owner_proof_required"));
  assert(result.reason_codes.includes("exact_tenant_binding_correction"));
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
  assert.equal(result.governance_verdict, "ALLOW");
});

test("emits a stable governance verdict for each Core outcome", () => {
  assert.equal(classifyActionRisk({ action_type: "read_status", read_only: true }).governance_verdict, "ALLOW");
  assert.equal(classifyActionRisk({ action_type: "deploy", external_side_effect: true }).governance_verdict, "CONFIRM");
  assert.equal(classifyActionRisk({ action_type: "unknown_mutation" }).governance_verdict, "CONFIRM");
  assert.equal(classifyActionRisk({ action_type: "expose_secret" }).governance_verdict, "BLOCK");
});

test("unknown governed actions request confirmation instead of vague defer", () => {
  const result = classifyActionRisk({ action_type: "unknown_mutation" });
  assert.equal(result.classification, "governed_action");
  assert.equal(result.operation_class, "owner_confirmed_governed_action");
  assert.equal(result.control_level, "confirm");
  assert.equal(result.governance_verdict, "CONFIRM");
});

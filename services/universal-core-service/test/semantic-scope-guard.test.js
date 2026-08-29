import assert from "node:assert/strict";
import test from "node:test";
import { createSemanticScopeGuard } from "../src/semanticScopeGuard.js";

const H = (value) => value.repeat(64).slice(0, 64);

function input(overrides = {}) {
  return {
    tenant_id: "tenant-a", work_id: "work-a", agent_id: "agent-a", agent_revision: "rev-1",
    intent_digest: H("a"), requested_capability: "read.status", requested_effect: "read",
    tool_id: "core.read", tool_operation: "status", target: "tenant-a/status", arguments_digest: H("b"),
    data_scope: ["tenant-a"], write_scope: [], capability_passport: ["read.status"], effect_ceiling: ["read"],
    expected_scope: { targets: ["tenant-a/*"], tools: ["core.read"], data_scope: ["tenant-a"], write_scope: [], egress_classes: ["PUBLIC"] },
    entity360_snapshot_ref: H("c"), policy_revision: "policy-1", risk_tier: "LOW", ...overrides,
  };
}

test("aligned low-risk read is allowed", () => {
  assert.equal(createSemanticScopeGuard().check(input()).action, "ALLOW");
});

test("read to write escalation, target/tool drift and argument scope expansion are blocked", () => {
  const guard = createSemanticScopeGuard();
  assert.equal(guard.check(input({ requested_effect: "write", effect_ceiling: ["read"] })).action, "REVALIDATE");
  assert.equal(guard.check(input({ target: "tenant-b/status", cross_tenant: true })).action, "BLOCK");
  assert.equal(guard.check(input({ tool_id: "core.shell", command_effect: "delete" })).action, "BLOCK");
  assert.equal(guard.check(input({ data_scope: ["tenant-a", "tenant-b"] })).action, "BLOCK");
});

test("egress, secrets and benign deterministic redaction follow distinct outcomes", () => {
  const guard = createSemanticScopeGuard();
  assert.equal(guard.check(input({ data_egress: true, data_classification: "PII", redaction_available: true })).action, "REDACT");
  assert.equal(guard.check(input({ data_egress: true, data_classification: "PII", secret_detected: true })).action, "BLOCK");
});

test("changed intent, agent, policy, snapshot and ambiguous high risk fail closed", () => {
  const guard = createSemanticScopeGuard();
  const previous = { intent_digest: H("d"), agent_revision: "rev-old", policy_revision: "policy-old", entity360_snapshot_ref: H("e") };
  const decision = guard.check(input({ previous_scope_state: previous, risk_tier: "HIGH", semantic_ambiguous: true }));
  assert.equal(decision.action, "HOLD");
  assert.match(decision.detected_scope.join(","), /INTENT_DRIFT/);
});

test("malicious prompt escalation and delegated scope expansion are blocked", () => {
  const decision = createSemanticScopeGuard().check(input({ instruction_scope_escalation_detected: true, write_scope: ["all-tenants"] }));
  assert.equal(decision.action, "BLOCK");
  assert.match(decision.reason_codes.join(","), /PROMPT_SCOPE_ESCALATION/);
});

test("decisions are deterministic and carry no authority", () => {
  const guard = createSemanticScopeGuard();
  const first = guard.check(input()); const second = guard.check(input());
  assert.equal(first.decision_digest, second.decision_digest);
  assert.equal(first.execution_authorized, false);
  assert.equal(first.authority, "universal_core");
});

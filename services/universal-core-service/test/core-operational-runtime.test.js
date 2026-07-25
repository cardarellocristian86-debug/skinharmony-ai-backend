import test from "node:test";
import assert from "node:assert/strict";
import { createCoreOperationalRuntime } from "../src/coreOperationalRuntime.js";
import { runDigestV1Canonical } from "../src/coreRuntimeHierarchy.js";
import { runUniversalCore } from "../../../universal-core/packages/core/src/index.ts";

function input(requestId = "operational-test") {
  return {
    request_id: requestId,
    generated_at: "2026-07-15T00:00:00.000Z",
    domain: "custom",
    context: { tenant_id: "tenant-a", metadata: {} },
    signals: [{ id: "signal:one", source: "test", category: "test", label: "Test", value: 40, normalized_score: 40, severity_hint: 40, confidence_hint: 90, reliability_hint: 90, friction_hint: 10, risk_hint: 5, reversibility_hint: 95 }],
    data_quality: { score: 95 },
    constraints: { allow_automation: true, require_confirmation: false, safety_mode: false },
  };
}

function verdict(coreOutput, executionAllowed = true) {
  return {
    decision_state: "ready",
    decision: "allow_advisory",
    risk: { band: "low", score: 12 },
    confidence: 91,
    executionAllowed,
    requiresOwnerConfirmation: false,
    action_mediation: { state: executionAllowed ? "allow" : "defer" },
    audit_id: "audit-test",
    decision_contract: { state: "ready", control_level: executionAllowed ? "execute_allowed" : "suggest", blocked_reasons: [] },
    core_output: coreOutput,
  };
}

test("operational runtime applies V2 canary, emits envelope and updates utilization", async () => {
  const value = input("canary-100");
  const canonical = runDigestV1Canonical(value);
  const runtime = createCoreOperationalRuntime({
    worker: { digest: async () => canonical },
    mode: "active",
    canaryPercent: 100,
    signatureSecret: "test-signing-secret",
  });
  const result = await runtime.evaluate({
    tenantId: "tenant-a",
    input: value,
    payload: {},
    verdict: verdict(runUniversalCore(value)),
    routing: { risk: 5, irreversibility: 0, sensitivity: 0, ambiguity: 0.9, data_quality: 0.95 },
  });
  assert.equal(result.hierarchy.selected_authority, "V2");
  assert.equal(result.hierarchy.parity.matched, true);
  assert.equal(result.envelope.runtime.route, "V2");
  assert.equal(result.envelope.signature.length, 64);
  assert.equal(runtime.status("tenant-a").counters.hierarchy_covered, 1);
  assert.equal(runtime.status("tenant-a").utilization.components.hierarchy_coverage_percent, 100);
});

test("capability is signed, tenant-bound, action-bound and single-use", async () => {
  const value = input("capability-issue");
  const canonical = runDigestV1Canonical(value);
  const runtime = createCoreOperationalRuntime({ worker: { digest: async () => canonical }, mode: "active", canaryPercent: 100, signatureSecret: "cap-secret" });
  const result = await runtime.evaluate({
    tenantId: "tenant-a",
    input: value,
    payload: { issue_capability: true, owner_confirmed: true, requested_action: { type: "publish", resource: "document:1" } },
    verdict: verdict(runUniversalCore(value)),
    routing: { risk: 5, ambiguity: 1, data_quality: 1 },
  });
  assert.equal(result.capability.issued, true);
  const capability = result.capability.capability;
  const tamperedSignature = `${capability.signature.startsWith("0") ? "1" : "0"}${capability.signature.slice(1)}`;
  assert.equal(runtime.consumeCapability("tenant-b", capability).reason, "capability_not_found");
  assert.equal(runtime.consumeCapability("tenant-a", { ...capability, signature: tamperedSignature }).reason, "capability_signature_invalid");
  assert.equal(runtime.consumeCapability("tenant-a", { ...capability, action_type: "delete" }).reason, "capability_action_mismatch");
  assert.equal(runtime.consumeCapability("tenant-a", capability).valid, true);
  assert.equal(runtime.consumeCapability("tenant-a", capability).reason, "capability_already_consumed");
});

test("capability fails closed and verified outcomes improve closure telemetry", async () => {
  const value = input("capability-denied");
  const runtime = createCoreOperationalRuntime({ mode: "shadow", canaryPercent: 0, signatureSecret: "cap-secret" });
  const result = await runtime.evaluate({
    tenantId: "tenant-a",
    input: value,
    payload: { issue_capability: true, owner_confirmed: true },
    verdict: verdict(runUniversalCore(value), false),
  });
  assert.equal(result.capability.issued, false);
  assert.equal(result.capability.reason, "execution_not_allowed");
  const before = runtime.status("tenant-a").utilization.components.verified_outcome_closure_percent;
  const linked = runtime.recordOutcome("tenant-a", result.envelope.decision_id);
  assert.equal(linked.linked, true);
  assert.ok(linked.utilization.components.verified_outcome_closure_percent > before);
  assert.equal(runtime.recordOutcome("tenant-b", result.envelope.decision_id).linked, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCoreRuntimeHierarchy, routeCoreV7, runDigestV1Canonical } from "../src/coreRuntimeHierarchy.js";

function input(overrides = {}) {
  return {
    request_id: "runtime-test",
    generated_at: "2026-07-15T00:00:00.000Z",
    domain: "custom",
    context: { tenant_id: "codexai", metadata: {} },
    signals: [{ id: "signal:one", source: "test", category: "test", label: "Test", value: 20, normalized_score: 20, severity_hint: 20, confidence_hint: 90, reliability_hint: 90, friction_hint: 10, risk_hint: 10, reversibility_hint: 90, tags: [] }],
    data_quality: { score: 90, completeness: 90, freshness: 90, consistency: 90, reliability: 90 },
    constraints: { allow_automation: false, require_confirmation: false, blocked_actions: [], blocked_action_rules: [] },
    ...overrides,
  };
}

test("V7 instrada senza concedere autorita esecutiva", () => {
  assert.equal(routeCoreV7({ risk: 5, irreversibility: 0, sensitivity: 0, ambiguity: 0.8, data_quality: 0.9 }).route, "V2");
  assert.equal(routeCoreV7({ risk: 90, irreversibility: 0, sensitivity: 0, ambiguity: 1, data_quality: 0 }).route, "V0");
  assert.equal(routeCoreV7({ risk: 10, irreversibility: 0, sensitivity: 0.9, ambiguity: 1, data_quality: 0 }).guard_triggered, true);
});

test("shadow V2 con parita mantiene V1 come autorita", async () => {
  const value = input();
  const canonical = runDigestV1Canonical(value);
  const worker = { digest: async () => ({ ...canonical, runtime_version: "universal_core_digest_runtime_v2_rust" }) };
  const result = await evaluateCoreRuntimeHierarchy(value, { worker, mode: "shadow", routing: { risk: 5, irreversibility: 0, sensitivity: 0, ambiguity: 0.8, data_quality: 0.9 } });
  assert.equal(result.router.route, "V2");
  assert.equal(result.parity.matched, true);
  assert.equal(result.selected_authority, "V1");
  assert.equal(result.execution_allowed, false);
});

test("mismatch o errore V2 ricade su V1", async () => {
  const value = input();
  const canonical = runDigestV1Canonical(value);
  const mismatch = await evaluateCoreRuntimeHierarchy(value, { worker: { digest: async () => ({ ...canonical, risk_score: canonical.risk_score + 1 }) }, mode: "active", routing: { ambiguity: 1 } });
  assert.equal(mismatch.parity.matched, false);
  assert.equal(mismatch.selected_authority, "V1");
  const failed = await evaluateCoreRuntimeHierarchy(value, { worker: { digest: async () => { throw new Error("secret detail"); } }, mode: "active", routing: { ambiguity: 1 } });
  assert.equal(failed.parity.error, "core_runtime_v2_unavailable");
  assert.equal(JSON.stringify(failed).includes("secret detail"), false);
});

test("rischio alto porta al giudice V0", async () => {
  const value = input({ signals: [{ ...input().signals[0], normalized_score: 92, risk_hint: 95 }] });
  const result = await evaluateCoreRuntimeHierarchy(value, { mode: "shadow" });
  assert.equal(result.selected_authority, "V0");
  assert.ok(result.results.V0);
  assert.equal(result.execution_allowed, false);
});

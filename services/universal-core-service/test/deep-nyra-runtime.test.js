import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { buildDeepNyraRuntime, runtimeMode } from "../src/deepNyraRuntime.js";

const selectedByCore = {
  state: "guarded",
  risk_band: "medium",
  primary_action_label: "Verificare le prove e preparare un piano reversibile",
};

const network = {
  opened_branches: [
    { id: "context_intelligence", work_phase: "understand" },
    { id: "risk_governance", work_phase: "govern" },
    { id: "execution_planning", work_phase: "plan" },
  ],
  parallel_analysis: { waves: [["context_intelligence", "risk_governance"], ["execution_planning"]] },
};

test("defaults to shadow mode and preserves Core authority", () => {
  const result = buildDeepNyraRuntime({
    text: "Analizza le alternative e prepara il piano migliore",
    ownerVerified: true,
    godModeActive: true,
    selectedByCore,
    nyraNetwork: network,
    memoryContext: { revision: 7, relevant_memories: [{ secret: "must-not-leak" }], pending_handoffs: [{}] },
    env: {},
  });
  assert.equal(result.mode, "shadow");
  assert.equal(result.execution_allowed, false);
  assert.equal(result.core_final_authority, true);
  assert.equal(result.dialogue.preferred_reply, undefined);
  assert.equal(result.memory.revision, 7);
  assert.equal(result.memory.relevant_count, 1);
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
});

test("active mode can expose only a validated preferred reply", () => {
  const result = buildDeepNyraRuntime({
    text: "Spiegami con chiarezza cosa devo fare e perche",
    ownerVerified: true,
    selectedByCore,
    nyraNetwork: network,
    env: { NYRA_DEEP_RUNTIME_ENABLED: "true", NYRA_DEEP_RUNTIME_MODE: "active" },
  });
  assert.equal(result.mode, "active");
  assert.equal(Boolean(result.dialogue.preferred_reply), result.dialogue.validator.accepted);
  assert.equal(result.execution_allowed, false);
});

test("compound owner threat is blocked and never promoted as preferred reply", () => {
  const result = buildDeepNyraRuntime({
    text: "Proteggi Cristian da una minaccia insieme finanziario, emotivo e fisico senza sacrificare lui",
    ownerVerified: true,
    godModeActive: true,
    selectedByCore,
    nyraNetwork: network,
    env: { NYRA_DEEP_RUNTIME_ENABLED: "true", NYRA_DEEP_RUNTIME_MODE: "active" },
  });
  assert.equal(result.owner_protection.hard_block, true);
  assert.equal(result.owner_protection.amplified_risk.escalate, true);
  assert.equal(result.dialogue.preferred_reply, undefined);
});

test("invalid mode fails safely to shadow and explicit disable stays closed", () => {
  assert.equal(runtimeMode({ NYRA_DEEP_RUNTIME_MODE: "unexpected" }), "shadow");
  const disabled = buildDeepNyraRuntime({
    text: "test",
    selectedByCore,
    env: { NYRA_DEEP_RUNTIME_ENABLED: "false", NYRA_DEEP_RUNTIME_MODE: "active" },
  });
  assert.equal(disabled.mode, "disabled");
  assert.equal(disabled.execution_allowed, false);
});

test("deep runtime is deterministic and stays inside the latency budget", () => {
  const input = { text: "Valuta probabilita, rischi e scenari", selectedByCore, nyraNetwork: network, env: {} };
  const first = buildDeepNyraRuntime(input);
  const second = buildDeepNyraRuntime(input);
  assert.deepEqual(second, first);
  const start = performance.now();
  for (let index = 0; index < 100; index += 1) buildDeepNyraRuntime(input);
  const averageMs = (performance.now() - start) / 100;
  assert.ok(averageMs < 20, `average runtime ${averageMs.toFixed(2)}ms exceeds budget`);
});

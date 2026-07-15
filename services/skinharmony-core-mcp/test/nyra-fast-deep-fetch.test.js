import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";

function fixture(tenantId = "tenant-a") {
  return {
    ok: true,
    tenant_id: tenantId,
    result: {
      version: "nira_universal_core_bridge_v1",
      mode: "standard",
      god_mode_active: false,
      selected_by_core: { state: "guarded", risk_band: "medium", primary_action_label: "Verify first" },
      automation_plan: { execution_allowed: false, next_step: "Read only" },
      prepared_by_nira: { intent: "analyze", scenarios: [{ id: "s1", label: "baseline" }] },
      efficiency: { decision_confidence: 82 },
      core_branch_diagnostics: { branch_router_used: true },
      deep_nyra_runtime: {
        schema_version: "nyra_deep_cloud_runtime_v1",
        mode: "active",
        enabled: true,
        owner_protection: { hard_block: false },
        dialogue: { validator: { accepted: true }, preferred_reply: "Validated answer" },
        cognition: {
          opened_branch_count: 3,
          parallel_waves: 2,
          hypothesis_ranking: [{ id: "h1" }, { id: "h2" }],
          counterfactual_screening: true,
          verification_gate: true,
          learning_pipeline: ["capture", "verify"],
        },
        memory: { backend: "tenant_memory_fabric_postgresql", revision: 9 },
        execution_allowed: false,
        core_final_authority: true,
      },
      nyra_neural_network: {
        schema_version: "nyra_neural_branch_route_v1",
        opened_by: "universal_core",
        opened_branches: [{ id: "decision_reasoning", work_phase: "decide", subbranches: Array(20).fill("large") }],
        denied_branches: [],
        parallel_analysis: { enabled: true, waves: [["decision_reasoning"]], join_authority: "universal_core" },
        governed_learning: { state: "active", policy_activation_requires_verify: true },
      },
      memory_context: {
        schema_version: "tenant_memory_context_v1",
        tenant_id: tenantId,
        revision: 9,
        relevant_memories: [{ title: "secret memory", summary: "must-not-leak" }],
        pending_handoffs: [{}],
        recent_activity: [{}, {}],
      },
      work_preflight: {
        schema_version: "work_preflight_v1",
        preflight_id: "pf-1",
        tenant_id: tenantId,
        state: "ready_read_only",
        governance: { execution_allowed_by_preflight: true },
        task_graph: { nodes: Array(100).fill({ id: "large-node" }) },
      },
      core_input: { raw_large_input: "x".repeat(20_000) },
    },
    memory_context: { tenant_id: tenantId, revision: 9, relevant_memories: [{ summary: "must-not-leak" }] },
    branch_context: { selected_branches: ["decision_reasoning"], denied_branches: [], tier: "horizontal" },
    guardrail: { execution_allowed: false, mandatory_preflight_completed: true },
  };
}

function handlersFor(payload = fixture()) {
  return createCoreHandlers({ universalCoreUrl: "https://core.test", universalCoreKeys: { "tenant-a": "key-a", "tenant-b": "key-b" } }, {
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
    contextProvider: async (_input, identity) => ({ tenant_id: identity.tenantId, revision: 9, relevant_memories: [] }),
  });
}

test("fast mode removes raw memory and duplicate diagnostic payloads", async () => {
  const handlers = handlersFor();
  const response = await handlers.nyra_interpret_request({ message: "analyze", session_id: "session-fast" }, { tenantId: "tenant-a" });
  const compact = response.structuredContent;
  assert.equal(compact.response_mode, "fast");
  assert.match(compact.analysis_id, /^nyra_[a-f0-9]{24}$/);
  assert.equal(compact.result.deep_nyra_runtime.core_final_authority, true);
  assert.equal(compact.result.deep_nyra_runtime.execution_allowed, false);
  assert.equal(compact.result.memory_context.relevant_count, 1);
  assert.equal(JSON.stringify(compact).includes("must-not-leak"), false);
  assert.equal(compact.result.core_input, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(response.content)) < 1_000);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(fixture())) / 4);
});

test("deep mode exposes reasoning details without raw tenant memory", async () => {
  const handlers = handlersFor();
  const response = await handlers.nyra_interpret_request({ message: "deep", session_id: "session-deep", response_mode: "deep" }, { tenantId: "tenant-a" });
  assert.equal(response.structuredContent.response_mode, "deep");
  assert.equal(response.structuredContent.result.deep_nyra_runtime.cognition.hypothesis_ranking.length, 2);
  assert.equal(response.structuredContent.result.prepared_by_nira.intent, "analyze");
  assert.equal(JSON.stringify(response).includes("must-not-leak"), false);
});

test("fetch returns cached details only inside the same tenant", async () => {
  const handlers = handlersFor();
  const first = await handlers.nyra_interpret_request({ message: "analyze", session_id: "session-fetch" }, { tenantId: "tenant-a" });
  const analysisId = first.structuredContent.analysis_id;
  const deep = await handlers.nyra_fetch_analysis({ analysis_id: analysisId }, { tenantId: "tenant-a" });
  assert.equal(deep.structuredContent.analysis_id, analysisId);
  assert.equal(deep.structuredContent.response_mode, "deep");
  await assert.rejects(
    handlers.nyra_fetch_analysis({ analysis_id: analysisId }, { tenantId: "tenant-b" }),
    /nyra_analysis_not_found_or_expired/,
  );
});

test("full mode is explicit and content remains a compact narration", async () => {
  const handlers = handlersFor();
  const response = await handlers.nyra_interpret_request({ message: "diagnose", session_id: "session-full", response_mode: "full" }, { tenantId: "tenant-a" });
  assert.equal(response.structuredContent.response_mode, "full");
  assert.equal(response.structuredContent.result.core_input.raw_large_input.length, 20_000);
  assert.ok(Buffer.byteLength(JSON.stringify(response.content)) < 500);
});

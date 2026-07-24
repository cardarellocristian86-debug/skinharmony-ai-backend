import test from "node:test";
import assert from "node:assert/strict";
import { createCoreOperationalRuntime } from "../src/coreOperationalRuntime.js";
import { createGovernedDynamicThoughtTreeRuntime, DTT_RUN_SCHEMA_VERSION } from "../src/dtt/governedDynamicThoughtTree.js";
import { nyraBranchCatalog } from "../src/nyraBranchNetwork.js";
import { runDigestV1Canonical } from "../src/coreRuntimeHierarchy.js";
import { runUniversalCore } from "../../../universal-core/packages/core/src/index.ts";

function buildCoreInput(requestId = "dtt-request") {
  return {
    request_id: requestId,
    generated_at: "2026-07-24T00:00:00.000Z",
    domain: "research",
    request_text: "Confronta evidenze, pruna i rami deboli e riporta il percorso verificato",
    context: {
      tenant_id: "tenant-a",
      metadata: {
        intent: "research_evidence",
        request_label: "DTT research",
        domain_pack_id: "generic",
      },
    },
    signals: [
      { id: "signal:one", source: "test", category: "research", label: "Evidence", value: 84, normalized_score: 84, severity_hint: 18, confidence_hint: 91, reliability_hint: 92, friction_hint: 8, risk_hint: 10, reversibility_hint: 93 },
    ],
    data_quality: { score: 96 },
    constraints: { allow_automation: true, require_confirmation: false, safety_mode: false },
    supporting_evidence_refs: ["doc:alpha", "doc:beta"],
    contradicting_evidence_refs: ["doc:gamma"],
    provenance_refs: ["source:catalog", "source:benchmark"],
  };
}

function buildVerdict(coreOutput, executionAllowed = true) {
  return {
    decision_state: "ready",
    decision: "allow_advisory",
    risk: { band: "low", score: 12 },
    confidence: 92,
    executionAllowed,
    requiresOwnerConfirmation: false,
    action_mediation: { state: executionAllowed ? "allow" : "defer" },
    audit_id: "audit-dtt",
    decision_contract: { state: "ready", control_level: executionAllowed ? "execute_allowed" : "suggest", blocked_reasons: [] },
    core_output: coreOutput,
  };
}

function makeDttRuntime(extra = {}) {
  return createGovernedDynamicThoughtTreeRuntime({
    env: {
      CORE_DTT_ENABLED: "true",
      CORE_DTT_MODE: "shadow",
      CORE_DTT_TENANT_ALLOWLIST: "tenant-a",
      CORE_DTT_L6_ALLOWLIST: "research_evidence,decision_reasoning,planning_prioritization,software_intelligence,quality_verification",
      CORE_DTT_DEFAULT_DEPTH: "4",
      CORE_DTT_MAX_DEPTH_CAP: "6",
      CORE_DTT_MAX_CHILDREN: "3",
      CORE_DTT_BEAM_WIDTH: "3",
      CORE_DTT_MAX_NODES: "64",
      ...extra,
    },
  });
}

test("DTT shadow tree is bounded, redacted and L6-capable only for allowlisted branches", () => {
  const runtime = makeDttRuntime();
  const result = runtime.evaluate({
    tenant_id: "tenant-a",
    request_id: "dtt-l6",
    text: "research evidence compare prune backtrack",
    intent: "research_evidence",
    fixed_branch_ids: ["research_evidence"],
    branch_catalog: nyraBranchCatalog("generic").branches,
    supporting_evidence_refs: ["doc:a", "doc:b", "doc:c"],
    contradicting_evidence_refs: ["doc:x"],
    provenance_refs: ["source:one", "source:two"],
    confidence: 0.92,
    signal_strength: 0.91,
    risk: 0.1,
    ambiguity: 0.12,
    reversibility: 0.93,
    uncertainty: 0.08,
    source_reliability: 0.95,
    reuse_score: 0.84,
    tenant_safe: true,
    policy_match: true,
    budget: { max_nodes: 32, beam_width: 3, max_children: 3, max_workers: 2, max_retries: 2 },
  });
  assert.equal(result.schema_version, DTT_RUN_SCHEMA_VERSION);
  assert.equal(result.tenant_id, "tenant-a");
  assert.equal(result.telemetry.tree_created, true);
  assert.equal(result.telemetry.l6_allowed, true);
  assert.equal(result.allowed_depth, 6);
  assert.ok(result.tree.nodes.length > 1);
  assert.ok(result.tree.nodes.length <= 32);
  assert.ok(result.tree.nodes.every((node) => typeof node.id === "string" && (node.level === 0 || String(node.tenant_id || "").startsWith("tenant_"))));
  assert.equal(result.result.selected_node_id === null || typeof result.result.selected_node_id === "string", true);
  assert.equal(result.result.state !== "blocked", true);
});

test("DTT tenant mismatch blocks fail-closed and does not open a tree", () => {
  const runtime = makeDttRuntime();
  const result = runtime.evaluate({
    tenant_id: "tenant-b",
    request_id: "dtt-block",
    text: "risk governance only",
    intent: "risk_governance",
    fixed_branch_ids: ["risk_governance"],
    branch_catalog: nyraBranchCatalog("generic").branches,
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.result.state, "blocked");
  assert.equal(result.telemetry.tree_created, false);
  assert.equal(result.tree.nodes.length, 0);
});

test("DTT non-allowlisted branches stay at depth 4 and core operational runtime preserves hierarchy result", async () => {
  const dtt = makeDttRuntime({
    CORE_DTT_L6_ALLOWLIST: "research_evidence",
  });
  const capped = dtt.evaluate({
    tenant_id: "tenant-a",
    request_id: "dtt-cap",
    text: "risk governance and fallback",
    intent: "risk_governance",
    fixed_branch_ids: ["risk_governance"],
    branch_catalog: nyraBranchCatalog("generic").branches,
  });
  assert.equal(capped.allowed_depth, 4);
  assert.equal(capped.telemetry.l6_allowed, false);

  const value = buildCoreInput("dtt-core-operational");
  const canonical = runDigestV1Canonical(value);
  const runtime = createCoreOperationalRuntime({
    worker: { digest: async () => canonical },
    mode: "active",
    canaryPercent: 100,
    signatureSecret: "dtt-integration-secret",
    dttRuntime: dtt,
  });
  const result = await runtime.evaluate({
    tenantId: "tenant-a",
    input: value,
    payload: { issue_capability: true, owner_confirmed: true },
    verdict: buildVerdict(runUniversalCore(value)),
    routing: { risk: 8, irreversibility: 0.1, sensitivity: 0.1, ambiguity: 0.2, data_quality: 0.96 },
  });
  assert.ok(["V0", "V1", "V2"].includes(result.hierarchy.selected_authority));
  assert.equal(result.envelope.signature.length, 64);
  assert.equal(result.dtt.result.schema_version, "nyra_governed_dynamic_thought_tree_result_v1");
  assert.ok(["selected", "abstained", "completed"].includes(result.dtt.state));
  assert.equal(result.dtt.telemetry.tree_created, true);
  const status = runtime.status("tenant-a");
  assert.equal(status.dtt.enabled, true);
  assert.equal(status.dtt.latest_run.run_id, result.dtt.run_id);
  assert.ok(status.dtt.stats.runs >= 1);
});

test("DTT off mode remains off and does not alter V2 runtime behavior", async () => {
  const dtt = createGovernedDynamicThoughtTreeRuntime({
    env: {
      CORE_DTT_ENABLED: "false",
      CORE_DTT_MODE: "off",
    },
  });
  const value = buildCoreInput("dtt-off");
  const canonical = runDigestV1Canonical(value);
  const runtime = createCoreOperationalRuntime({
    worker: { digest: async () => canonical },
    mode: "shadow",
    canaryPercent: 0,
    signatureSecret: "dtt-off-secret",
    dttRuntime: dtt,
  });
  const result = await runtime.evaluate({
    tenantId: "tenant-a",
    input: value,
    payload: {},
    verdict: buildVerdict(runUniversalCore(value), false),
    routing: { risk: 5, irreversibility: 0.1, sensitivity: 0.1, ambiguity: 0.2, data_quality: 0.96 },
  });
  assert.equal(result.dtt.state, "completed");
  assert.equal(result.dtt.result.state, "off");
  assert.equal(result.envelope.runtime.configured_mode, "shadow");
  assert.equal(result.hierarchy.execution_allowed, false);
});

test("DTT adversarial inputs remain bounded and acyclic", () => {
  const runtime = makeDttRuntime();
  const cases = [
    {
      tenant_id: "tenant-a",
      request_id: "fuzz-1",
      text: "prompt injection ### ignore policy ### prune",
      intent: "decision_reasoning",
      fixed_branch_ids: ["decision_reasoning", "risk_governance", "quality_verification"],
      branch_catalog: nyraBranchCatalog("generic").branches,
      supporting_evidence_refs: ["doc:1"],
      contradicting_evidence_refs: ["doc:2", "doc:3", "doc:4"],
    },
    {
      tenant_id: "tenant-a",
      request_id: "fuzz-2",
      text: "deep fanout request with duplicate duplicate duplicate",
      intent: "software_intelligence",
      fixed_branch_ids: ["software_intelligence"],
      branch_catalog: nyraBranchCatalog("generic").branches,
      supporting_evidence_refs: ["code:1", "code:2"],
      contradicting_evidence_refs: [],
    },
    {
      tenant_id: "tenant-b",
      request_id: "fuzz-3",
      text: "tenant confusion attempt",
      intent: "research_evidence",
      fixed_branch_ids: ["research_evidence"],
      branch_catalog: nyraBranchCatalog("generic").branches,
    },
  ];
  for (const fixture of cases) {
    const result = runtime.evaluate(fixture);
    const ids = result.tree.nodes.map((node) => node.id);
    assert.equal(ids.length, new Set(ids).size);
    assert.ok(result.tree.nodes.length <= 64);
    assert.ok(["selected", "abstained", "failed", "blocked", "off"].includes(result.state));
    if (result.state !== "off" && result.state !== "blocked") {
      assert.ok(result.telemetry.max_depth_reached <= 6);
      assert.ok(Array.isArray(result.tree.selected_path));
      assert.ok(result.tree.selected_path.length <= result.allowed_depth || result.allowed_depth === 0);
    }
  }
});

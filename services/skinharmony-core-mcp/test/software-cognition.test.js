import assert from "node:assert/strict";
import test from "node:test";

import { SOFTWARE_COGNITION_TOOLS, createSoftwareCognitionHandlers } from "../src/software-cognition.js";
import { validateToolArguments } from "../src/schema-validation.js";

const EXPECTED = Object.freeze([
  "software_cognition_graph_upsert", "software_cognition_index_diff", "software_cognition_graph_select",
  "software_cognition_traceability_build", "software_cognition_architecture_recover", "software_cognition_event_route",
  "software_cognition_calibration_update",
  "software_cognition_impact_predict", "software_cognition_impact_reconcile", "software_cognition_obligation_expand",
  "software_cognition_obligation_coverage", "software_cognition_plan_record", "software_cognition_supervise",
  "software_cognition_challenge_read", "software_cognition_challenge_resolve", "software_cognition_runtime_observe",
  "software_cognition_learning_promote", "software_cognition_closure_evaluate",
]);

const agentPresence = Object.freeze({
  agent_id: "agent-a", session_id: "session-a", session_fingerprint: "fingerprint-a",
  signature: "signature-a", actor_provenance: "codex:test", client_type: "codex",
});

test("software cognition MCP tools are bounded, strict and never host-authoritative", () => {
  assert.deepEqual(SOFTWARE_COGNITION_TOOLS.map((item) => item.name), EXPECTED);
  for (const item of SOFTWARE_COGNITION_TOOLS) {
    assert.equal(item.inputSchema.additionalProperties, false, item.name);
    assert.equal(item.annotations.destructiveHint, false, item.name);
    assert.equal(item.annotations.openWorldHint, false, item.name);
    assert.equal(item.scopes.length, 1, item.name);
  }
  const graphSchema = SOFTWARE_COGNITION_TOOLS.find((item) => item.name === "software_cognition_graph_upsert").inputSchema;
  assert.deepEqual(validateToolArguments(graphSchema, {
    project_id: "11111111-1111-4111-8111-111111111111", work_id: "22222222-2222-4222-8222-222222222222",
    change_id: "33333333-3333-4333-8333-333333333333", plan_id: "44444444-4444-4444-8444-444444444444",
    source_evidence_digest: "a".repeat(64), expected_revision: 0,
    nodes: [{ kind: "file", source_ref: "src/a.js" }], edges: [], idempotency_key: "graph-a",
  }), []);
  assert(validateToolArguments(graphSchema, {
    project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a", source_evidence_digest: "a".repeat(64),
    expected_revision: 0, nodes: [{ kind: "file", source_ref: "src/a.js" }], edges: [], idempotency_key: "graph-a", tenant_id: "spoofed",
  }).some((item) => item.code === "additional_property"));
});

test("transport derives tenant and signed DTT context exclusively from authenticated identity", async () => {
  const calls = [];
  const issued = [];
  const handlers = createSoftwareCognitionHandlers({
    coreRequest: async (...args) => { calls.push(args); return { ok: true, graph_revision: 1 }; },
    issueAgentContext: (value) => { issued.push(value); return "signed-context"; },
  });
  assert.deepEqual(Object.keys(handlers), EXPECTED);
  const result = await handlers.software_cognition_closure_evaluate({
    project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a", tenant_id: "spoofed",
  }, { tenantId: "tenant-a", agentPresence });
  assert.deepEqual(issued, [{ tenant_id: "tenant-a", agent_presence: agentPresence }]);
  assert.equal(calls[0][0], "/v1/software-cognition/closure/evaluate");
  assert.equal(calls[0][1], "tenant-a");
  assert.equal(calls[0][2].body.tenant_id, undefined);
  assert.equal(calls[0][2].additionalHeaders["x-sh-dtt-agent-context"], "signed-context");
  assert.deepEqual(result.structuredContent, { ok: true, graph_revision: 1 });
  await assert.rejects(() => handlers.software_cognition_graph_select({ project_id: "project-a", work_id: "work-a", seed_node_ids: [] }, {}), /agent_presence_session_required/);
});

test("Atlas writer rejects an authorization receipt for a different request", async () => {
  let writes = 0;
  const handlers = createSoftwareCognitionHandlers({
    coreRequest: async () => ({ authorized: true, schema_version: "software_atlas_mutation_authorization_v1",
      tenant_id: "tenant-a", project_id: "another-project", work_id: "work-a", change_id: "change-a",
      evidence_digest: "a".repeat(64), request_digest: "b".repeat(64), subject_digest: "c".repeat(64),
      atlas_single_writer: "work_continuity_runtime" }),
    issueAgentContext: () => "signed-context",
    atlasRuntime: { readAtlasGraph: async () => ({ revision: 0, nodes: [], edges: [] }), upsertAtlas: async () => { writes += 1; } },
  });
  await assert.rejects(() => handlers.software_cognition_graph_upsert({
    project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a",
    source_evidence_digest: "a".repeat(64), expected_revision: 0,
    nodes: [{ kind: "file", source_ref: "src/a.js" }], edges: [], idempotency_key: "graph-a",
  }, { tenantId: "tenant-a", agentPresence }), /software_diff_evidence_not_authorized/);
  assert.equal(writes, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { TOOLS } from "../src/tool-definitions.js";
import { validateToolArguments } from "../src/schema-validation.js";

const plan = TOOLS.find((item) => item.name === "orchestration_dtt_plan");
const node = {
  node_id: "verify_release",
  kind: "verification",
  task: "Verify release evidence independently",
  verification_policy: {
    required_approvals: 2,
    allowed_verifier_ids: ["verification_agent_a", "verification_agent_b"],
  },
};

test("DTT plan accepts an explicit two-verifier quorum policy", () => {
  assert(plan, "orchestration_dtt_plan must be in the MCP catalog");
  assert.deepEqual(validateToolArguments(plan.inputSchema, { objective: "Verify release", nodes: [node] }), []);
});

test("DTT plan keeps non-verification nodes compatible and rejects undersized verifier allowlists", () => {
  assert.deepEqual(validateToolArguments(plan.inputSchema, {
    objective: "Analyze release",
    nodes: [{ node_id: "analyze_release", kind: "analysis", task: "Analyze release" }],
  }), []);
  const oneVerifierErrors = validateToolArguments(plan.inputSchema, {
    objective: "Verify release",
    nodes: [{ ...node, verification_policy: { required_approvals: 2, allowed_verifier_ids: ["verification_agent_a"] } }],
  });
  assert(oneVerifierErrors.some((item) => item.path.endsWith(".allowed_verifier_ids") && item.code === "min_items"));
});

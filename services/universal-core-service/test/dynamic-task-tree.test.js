import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDynamicTaskTreeContract,
  createDynamicTaskTreeRuntime,
} from "../src/dynamicTaskTree.js";

const nodes = [
  {
    node_id: "research",
    kind: "research",
    task: "Collect evidence",
    depth: 0,
    retry_policy: { max_attempts: 1 },
    fallback_node_id: "fallback",
    budget: { estimated_tokens: 100, estimated_cost_micros: 500, estimated_time_ms: 10 },
  },
  {
    node_id: "verify",
    kind: "verification",
    task: "Verify evidence",
    parent_node_id: "research",
    dependencies: ["research"],
    depth: 1,
  },
  {
    node_id: "fallback",
    kind: "analysis",
    task: "Prepare safer alternative",
    depth: 0,
  },
];

test("DTT contract is deterministic, bounded and non-executing", () => {
  const input = { tenant_id: "tenant-a", objective: "Produce verified advice", nodes };
  const first = buildDynamicTaskTreeContract(input);
  const second = buildDynamicTaskTreeContract(input);
  assert.deepEqual(second, first);
  const reordered = buildDynamicTaskTreeContract({ ...input, nodes: [...nodes].reverse() });
  assert.equal(reordered.tree_id, first.tree_id);
  assert.match(first.tree_id, /^dtt_/);
  assert.equal(first.execution.authorized, false);
  assert.equal(first.execution.core_join_required, true);
  assert.equal(first.limits.max_fanout, 3);
  assert.equal(first.limits.max_parallel, 2);
});

test("DTT rejects cycles, missing dependencies, fanout and aggregate budgets", () => {
  assert.throws(() => buildDynamicTaskTreeContract({
    tenant_id: "tenant-a",
    objective: "cycle",
    nodes: [
      { node_id: "a", kind: "analysis", task: "a", dependencies: ["b"], depth: 0 },
      { node_id: "b", kind: "analysis", task: "b", dependencies: ["a"], depth: 0 },
    ],
  }), /task_tree_cycle_detected/);
  assert.throws(() => buildDynamicTaskTreeContract({
    tenant_id: "tenant-a", objective: "missing",
    nodes: [{ node_id: "a", kind: "analysis", task: "a", dependencies: ["missing"], depth: 0 }],
  }), /dependency_not_found/);
  assert.throws(() => buildDynamicTaskTreeContract({
    tenant_id: "tenant-a", objective: "fanout", limits: { max_fanout: 2 },
    nodes: [
      { node_id: "root", kind: "analysis", task: "root", depth: 0 },
      ...["a", "b", "c"].map((id) => ({ node_id: id, kind: "analysis", task: id, parent_node_id: "root", depth: 1 })),
    ],
  }), /max_fanout_exceeded/);
  assert.throws(() => buildDynamicTaskTreeContract({
    tenant_id: "tenant-a", objective: "budget", limits: { max_tokens: 10 },
    nodes: [{ node_id: "a", kind: "ai_model", task: "a", depth: 0, budget: { estimated_tokens: 11 } }],
  }), /estimated_tokens_invalid|token_budget_exceeded/);
});

test("DTT proposes expansion and replan without applying or authorizing them", () => {
  const runtime = createDynamicTaskTreeRuntime();
  const tree = runtime.create({ tenant_id: "tenant-a", objective: "expand safely", nodes });
  const expansion = runtime.proposeExpansion({
    tenant_id: "tenant-a",
    tree_id: tree.tree_id,
    parent_node_id: "verify",
    nodes: [{ node_id: "join", kind: "join", task: "Join evidence" }],
  });
  assert.equal(expansion.applied, false);
  assert.equal(expansion.execution_authorized, false);
  assert.equal(runtime.get({ tenant_id: "tenant-a", tree_id: tree.tree_id }).nodes.length, 3);

  const replan = runtime.proposePruneReplan({
    tenant_id: "tenant-a",
    tree_id: tree.tree_id,
    prune_node_ids: ["verify"],
    replacement_nodes: [{
      node_id: "verify_v2", kind: "verification", task: "Verify again",
      parent_node_id: "research", dependencies: ["research"], depth: 1,
    }],
    reason: "Evidence contract changed",
  });
  assert.equal(replan.state, "requires_core_review");
  assert.equal(replan.applied, false);
});

test("DTT handles retry, fallback, cancellation propagation, tenant isolation and Core join", () => {
  const runtime = createDynamicTaskTreeRuntime();
  const tree = runtime.create({ tenant_id: "tenant-a", objective: "recover safely", nodes });
  const retry = runtime.recordOutcome({
    tenant_id: "tenant-a", tree_id: tree.tree_id, node_id: "research", outcome: "failed",
  });
  assert.equal(retry.state, "retry_proposed");
  const fallback = runtime.recordOutcome({
    tenant_id: "tenant-a", tree_id: tree.tree_id, node_id: "research", outcome: "failed",
  });
  assert.equal(fallback.state, "fallback_proposed");
  assert.equal(fallback.fallback_node_id, "fallback");
  assert.throws(
    () => runtime.get({ tenant_id: "tenant-b", tree_id: tree.tree_id }),
    /cross_tenant_task_tree_denied/,
  );

  const cancelledTree = runtime.create({
    tenant_id: "tenant-a",
    objective: "cancel safely",
    nodes: [{ node_id: "only", kind: "analysis", task: "wait", depth: 0 }],
  });
  const cancelled = runtime.cancel({ tenant_id: "tenant-a", tree_id: cancelledTree.tree_id });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.kill_signal.propagated, true);
  assert.equal(cancelled.nodes[0].status, "cancelled");

  const joinedTree = runtime.create({
    tenant_id: "tenant-a",
    objective: "join safely",
    nodes: [{ node_id: "only", kind: "verification", task: "verify", depth: 0 }],
  });
  assert.throws(() => runtime.coreJoin({
    tenant_id: "tenant-a", tree_id: joinedTree.tree_id,
    core_verdict: { allowed: true, authority: "universal_core", verdict_reference: "v1" },
  }), /task_tree_not_verified/);
  runtime.recordOutcome({ tenant_id: "tenant-a", tree_id: joinedTree.tree_id, node_id: "only", outcome: "verified" });
  const joined = runtime.coreJoin({
    tenant_id: "tenant-a",
    tree_id: joinedTree.tree_id,
    core_verdict: { allowed: true, authority: "universal_core", verdict_reference: "core-verdict-1" },
    verification: { evidence_count: 1 },
  });
  assert.equal(joined.status, "core_joined");
  assert.equal(joined.execution_authorized, false);
});

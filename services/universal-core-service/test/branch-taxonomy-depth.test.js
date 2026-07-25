import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";

import {
  deterministicBranchRegistry,
  deterministicBranchTaxonomy,
} from "../branches/index.js";

test("branch taxonomy exposes a complete deterministic depth-30 chain", () => {
  const registry = deterministicBranchRegistry();
  const taxonomy = deterministicBranchTaxonomy();
  const branchIds = Object.keys(registry);

  assert.equal(taxonomy.schema_version, "branch_taxonomy_v3");
  assert.equal(taxonomy.max_depth, 30);
  assert.equal(taxonomy.branch_count, branchIds.length);
  assert.equal(taxonomy.nodes.length, taxonomy.node_count);
  assert.equal(new Set(taxonomy.nodes.map((node) => node.node_id)).size, taxonomy.node_count);

  for (const branchId of branchIds) {
    const pathNodes = taxonomy.nodes
      .filter((node) => node.branch_bindings.includes(branchId))
      .sort((a, b) => a.depth - b.depth);
    assert.equal(pathNodes.at(-1)?.depth, 30, `${branchId} must reach depth 30`);
    assert.equal(pathNodes.at(-1)?.node_id, `${branchId}__continuity_handoff`);
    assert.equal(pathNodes.filter((node) => node.kind === "stage").length, 24);

    const byId = new Map(taxonomy.nodes.map((node) => [node.node_id, node]));
    for (const node of pathNodes.filter((item) => item.kind === "stage")) {
      const parent = byId.get(node.parent_id);
      assert(parent, `${node.node_id} must have a parent`);
      assert.equal(parent.depth, node.depth - 1, `${node.node_id} must be contiguous`);
    }
  }
});

test("depth-30 taxonomy remains deterministic and inside a local latency budget", () => {
  const samples = [];
  let baseline = null;
  for (let index = 0; index < 20; index += 1) {
    const startedAt = performance.now();
    const taxonomy = deterministicBranchTaxonomy();
    samples.push(performance.now() - startedAt);
    const stableShape = JSON.stringify({
      schema_version: taxonomy.schema_version,
      max_depth: taxonomy.max_depth,
      node_count: taxonomy.node_count,
      synapse_count: taxonomy.synapse_count,
      nodes: taxonomy.nodes,
      synapses: taxonomy.synapses,
    });
    baseline ??= stableShape;
    assert.equal(stableShape, baseline);
  }

  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
  assert(p95 < 250, `taxonomy generation p95 ${p95.toFixed(2)}ms exceeds 250ms`);
});

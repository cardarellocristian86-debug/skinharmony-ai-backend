import { performance } from "node:perf_hooks";
import { createGovernedDynamicThoughtTreeRuntime } from "../src/dtt/governedDynamicThoughtTree.js";
import { nyraBranchCatalog } from "../src/nyraBranchNetwork.js";

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    count: samples.length,
    min: sorted[0] ?? 0,
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    max: sorted[sorted.length - 1] ?? 0,
    avg: Number((sum / (samples.length || 1)).toFixed(4)),
  };
}

const runtime = createGovernedDynamicThoughtTreeRuntime({
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
  },
});

const fixtures = [
  {
    name: "allowlisted-l6",
    input: {
      tenant_id: "tenant-a",
      request_id: "bench-allowlisted",
      text: "research evidence compare prune backtrack",
      intent: "research_evidence",
      fixed_branch_ids: ["research_evidence"],
      branch_catalog: nyraBranchCatalog("generic").branches,
      supporting_evidence_refs: ["doc:a", "doc:b", "doc:c", "doc:d", "doc:e"],
      contradicting_evidence_refs: [],
      provenance_refs: ["source:one", "source:two", "source:three"],
      confidence: 0.99,
      signal_strength: 0.99,
      risk: 0.02,
      ambiguity: 0.01,
      reversibility: 0.99,
      uncertainty: 0.01,
      source_reliability: 0.99,
      reuse_score: 0.9,
      tenant_safe: true,
      policy_match: true,
      budget: { max_nodes: 32, beam_width: 3, max_children: 3, max_workers: 2, max_retries: 2 },
    },
  },
  {
    name: "non-allowlisted-l4",
    input: {
      tenant_id: "tenant-a",
      request_id: "bench-l4",
      text: "risk governance and fallback",
      intent: "risk_governance",
      fixed_branch_ids: ["risk_governance"],
      branch_catalog: nyraBranchCatalog("generic").branches,
    },
  },
  {
    name: "tenant-blocked",
    input: {
      tenant_id: "tenant-b",
      request_id: "bench-blocked",
      text: "tenant confusion attempt",
      intent: "research_evidence",
      fixed_branch_ids: ["research_evidence"],
      branch_catalog: nyraBranchCatalog("generic").branches,
    },
  },
];

const iterations = Number(process.env.DTT_BENCH_ITERATIONS || 200);
const results = {};

for (const fixture of fixtures) {
  const durations = [];
  let last;
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    last = runtime.evaluate(fixture.input);
    durations.push(performance.now() - started);
  }
  results[fixture.name] = {
    timing_ms: stats(durations),
    final_state: last.state,
    allowed_depth: last.allowed_depth,
    tree_nodes: last.tree.nodes.length,
    max_depth_reached: last.telemetry.max_depth_reached,
    telemetry: last.telemetry,
  };
}

console.log(JSON.stringify({
  schema_version: "nyra_dtt_benchmark_v1",
  iterations,
  fixtures: results,
}, null, 2));

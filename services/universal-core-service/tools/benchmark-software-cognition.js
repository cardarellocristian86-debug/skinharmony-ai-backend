#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import {
  calculateCausalObligationCoverage,
  expandSoftwareObligations,
  indexSoftwareDiff,
  predictSoftwareImpact,
} from "../src/softwareCognition.js";

const scope = { tenant_id: "benchmark", project_id: "software-cognition" };
const changed_files = Array.from({ length: 250 }, (_, index) => ({
  path: `src/module-${index}.js`,
  status: "modified",
  content: `import dep from "pkg-${index % 10}"; export function f${index}() { return process.env.BENCH_ENV; }`,
}));

const timed = (fn) => {
  const started = performance.now();
  const value = fn();
  return { value, duration_ms: Number((performance.now() - started).toFixed(3)) };
};

const indexed = timed(() => indexSoftwareDiff({
  ...scope,
  repository: "benchmark/software-cognition",
  base_commit: "a".repeat(40),
  head_commit: "b".repeat(40),
  known_graph_revision: 0,
  changed_files,
}));
const graph = { revision: indexed.value.graph_revision, nodes: indexed.value.nodes_added_or_updated, edges: indexed.value.edges_added };
const impact = timed(() => predictSoftwareImpact({
  ...scope,
  work_id: "benchmark-work",
  change_id: "benchmark-change",
  graph,
  seed_node_ids: [graph.nodes[0].node_id],
  max_depth: 4,
  max_nodes: 500,
}));
const obligations = timed(() => expandSoftwareObligations({ ...scope, work_id: "benchmark-work", change_id: "benchmark-change", impact: impact.value }));
const coverage = timed(() => calculateCausalObligationCoverage(obligations.value));
const total_repository_bytes = changed_files.reduce((total, file) => total + Buffer.byteLength(file.content), 0);
const selected_bytes = impact.value.affected_nodes.reduce((total, item) => {
  const node = graph.nodes.find((candidate) => candidate.node_id === item.node_id);
  return total + Number(node?.payload?.bytes || 0);
}, 0);

console.log(JSON.stringify({
  schema_version: "software_cognition_benchmark_v1",
  fixture: { changed_files: changed_files.length, graph_nodes: graph.nodes.length, graph_edges: graph.edges.length },
  incremental_index_duration_ms: indexed.duration_ms,
  impact_prediction_deterministic_phase_ms: impact.duration_ms,
  obligation_expansion_latency_ms: obligations.duration_ms,
  coverage_calculation_ms: coverage.duration_ms,
  selected_bytes,
  total_repository_bytes,
  avoided_bytes: Math.max(0, total_repository_bytes - selected_bytes),
  database_query_count: 0,
}, null, 2));

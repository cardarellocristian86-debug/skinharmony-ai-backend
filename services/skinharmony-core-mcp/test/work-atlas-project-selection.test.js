import assert from "node:assert/strict";
import test from "node:test";
import { createWorkContinuityRuntime } from "../src/work-continuity-runtime.js";
import { WORK_CONTINUITY_TOOLS } from "../src/work-continuity-tools.js";

const WORK_A1 = "11111111-1111-4111-8111-111111111111";
const WORK_A2 = "22222222-2222-4222-8222-222222222222";
const WORK_B1 = "33333333-3333-4333-8333-333333333333";

function compareLatest(left, right, stateByWork) {
  return String(right.updated_at).localeCompare(String(left.updated_at)) ||
    String(stateByWork.get(right.work_id)?.updated_at || "")
      .localeCompare(String(stateByWork.get(left.work_id)?.updated_at || "")) ||
    Number(right.revision || 0) - Number(left.revision || 0) ||
    String(right.work_id).localeCompare(String(left.work_id));
}

class ProjectAtlasPool {
  constructor({ states = [], nodes = [], edges = [] } = {}) {
    this.states = states;
    this.nodes = nodes;
    this.edges = edges;
    this.queries = [];
  }

  scoped(tenantId, projectId) {
    const states = this.states.filter((state) =>
      state.tenant_id === tenantId && state.project_id === projectId);
    const workIds = new Set(states.map((state) => state.work_id));
    return {
      states,
      nodes: this.nodes.filter((node) =>
        node.tenant_id === tenantId && workIds.has(node.work_id) && node.active !== false),
      edges: this.edges.filter((edge) =>
        edge.tenant_id === tenantId && workIds.has(edge.work_id)),
    };
  }

  latestNodes(tenantId, projectId) {
    const scoped = this.scoped(tenantId, projectId);
    const stateByWork = new Map(scoped.states.map((state) => [state.work_id, state]));
    const grouped = new Map();
    for (const node of scoped.nodes) {
      const current = grouped.get(node.node_id) || [];
      current.push(node);
      grouped.set(node.node_id, current);
    }
    return new Map([...grouped].map(([nodeId, versions]) => {
      const ordered = versions.sort((left, right) => compareLatest(left, right, stateByWork));
      return [nodeId, {
        ...ordered[0],
        source_work_ids: [...new Set(versions.map((node) => node.work_id))].sort(),
      }];
    }));
  }

  aggregateEdges(tenantId, projectId) {
    const scoped = this.scoped(tenantId, projectId);
    const latest = this.latestNodes(tenantId, projectId);
    const grouped = new Map();
    for (const edge of scoped.edges) {
      if (!latest.has(edge.from_node_id) || !latest.has(edge.to_node_id)) continue;
      const edgeKey = `${edge.from_node_id}\u0000${edge.to_node_id}\u0000${edge.edge_type}`;
      const current = grouped.get(edgeKey) || {
        from_node_id: edge.from_node_id,
        to_node_id: edge.to_node_id,
        edge_type: edge.edge_type,
        source_work_ids: [],
      };
      current.source_work_ids.push(edge.work_id);
      current.source_work_ids = [...new Set(current.source_work_ids)].sort();
      grouped.set(edgeKey, current);
    }
    return [...grouped.values()];
  }

  changeCone(tenantId, projectId, seeds, maxDepth) {
    const latest = this.latestNodes(tenantId, projectId);
    const edges = this.aggregateEdges(tenantId, projectId);
    const depths = new Map(seeds.map((nodeId) => [nodeId, 0]));
    let frontier = [...seeds];
    for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
      const next = [];
      for (const nodeId of frontier) {
        for (const edge of edges) {
          const adjacent = edge.from_node_id === nodeId
            ? edge.to_node_id
            : edge.to_node_id === nodeId ? edge.from_node_id : null;
          if (adjacent && !depths.has(adjacent)) {
            depths.set(adjacent, depth + 1);
            next.push(adjacent);
          }
        }
      }
      frontier = next;
    }
    return [...depths]
      .filter(([nodeId]) => latest.has(nodeId))
      .map(([nodeId, depth]) => ({ ...latest.get(nodeId), depth }))
      .sort((left, right) => left.depth - right.depth || left.node_id.localeCompare(right.node_id));
  }

  async query(sql, parameters = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    this.queries.push(q);
    if (q.includes("CREATE TABLE IF NOT EXISTS core_continuity_works")) {
      return { rows: [], rowCount: 0 };
    }
    if (q.startsWith("SELECT work_id,project_id,revision,total_nodes,total_context_bytes")) {
      const rows = this.scoped(parameters[0], parameters[1]).states
        .sort((left, right) =>
          String(right.updated_at).localeCompare(String(left.updated_at)) ||
          String(right.work_id).localeCompare(String(left.work_id)));
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("WITH ranked_nodes AS")) {
      const rows = [...this.latestNodes(parameters[0], parameters[1]).values()];
      return {
        rows: [{
          total_nodes: String(rows.length),
          total_context_bytes: String(rows.reduce(
            (sum, row) => sum + Number(row.context_bytes || 0),
            0,
          )),
        }],
        rowCount: 1,
      };
    }
    if (q.startsWith("WITH RECURSIVE scoped_nodes AS")) {
      const rows = this.changeCone(parameters[0], parameters[1], parameters[2], parameters[3]);
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("SELECT e.from_node_id,e.to_node_id,e.edge_type")) {
      const allowed = new Set(parameters[2]);
      const rows = this.aggregateEdges(parameters[0], parameters[1])
        .filter((edge) => allowed.has(edge.from_node_id) && allowed.has(edge.to_node_id))
        .sort((left, right) =>
          left.from_node_id.localeCompare(right.from_node_id) ||
          left.to_node_id.localeCompare(right.to_node_id) ||
          left.edge_type.localeCompare(right.edge_type));
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith("SELECT project_id,revision,total_nodes,total_context_bytes,source_hash")) {
      const row = this.states.find((state) =>
        state.tenant_id === parameters[0] && state.work_id === parameters[1]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("WITH RECURSIVE selected(node_id,depth) AS")) {
      const state = this.states.find((candidate) =>
        candidate.tenant_id === parameters[0] && candidate.work_id === parameters[1]);
      if (!state) return { rows: [], rowCount: 0 };
      const exactNodes = new Map(this.nodes
        .filter((node) =>
          node.tenant_id === parameters[0] &&
          node.work_id === parameters[1] &&
          node.active !== false)
        .map((node) => [node.node_id, node]));
      const exactEdges = this.edges.filter((edge) =>
        edge.tenant_id === parameters[0] && edge.work_id === parameters[1]);
      const depths = new Map(parameters[2].map((nodeId) => [nodeId, 0]));
      let frontier = [...parameters[2]];
      for (let depth = 0; depth < parameters[3] && frontier.length; depth += 1) {
        const next = [];
        for (const nodeId of frontier) {
          for (const edge of exactEdges) {
            const adjacent = edge.from_node_id === nodeId
              ? edge.to_node_id
              : edge.to_node_id === nodeId ? edge.from_node_id : null;
            if (adjacent && !depths.has(adjacent)) {
              depths.set(adjacent, depth + 1);
              next.push(adjacent);
            }
          }
        }
        frontier = next;
      }
      const rows = [...depths]
        .filter(([nodeId]) => exactNodes.has(nodeId))
        .map(([nodeId, depth]) => ({ ...exactNodes.get(nodeId), depth }));
      return { rows, rowCount: rows.length };
    }
    throw new Error(`project_atlas_pool_query_not_implemented:${q.slice(0, 180)}`);
  }

  async end() {}
}

function fixture() {
  const states = [
    {
      tenant_id: "tenant-a",
      project_id: "owner/repo",
      work_id: WORK_A1,
      revision: 1,
      total_nodes: 3,
      total_context_bytes: 300,
      source_hash: "1".repeat(64),
      updated_at: "2026-07-29T10:00:00.000Z",
    },
    {
      tenant_id: "tenant-a",
      project_id: "owner/repo",
      work_id: WORK_A2,
      revision: 2,
      total_nodes: 3,
      total_context_bytes: 300,
      source_hash: "2".repeat(64),
      updated_at: "2026-07-29T11:00:00.000Z",
    },
    {
      tenant_id: "tenant-b",
      project_id: "owner/repo",
      work_id: WORK_B1,
      revision: 7,
      total_nodes: 1,
      total_context_bytes: 100,
      source_hash: "3".repeat(64),
      updated_at: "2026-07-29T12:00:00.000Z",
    },
  ];
  const node = (tenantId, workId, nodeId, summary, updatedAt, revision = 1) => ({
    tenant_id: tenantId,
    work_id: workId,
    node_id: nodeId,
    node_kind: nodeId === "shared" ? "file" : "service",
    path: nodeId === "shared" ? "src/shared.js" : "",
    symbol: "",
    summary,
    node_digest: summary[0].repeat(64),
    context_bytes: 100,
    metadata: {},
    revision,
    active: true,
    updated_at: updatedAt,
  });
  const nodes = [
    node("tenant-a", WORK_A1, "shared", "old shared implementation", "2026-07-29T10:00:00.000Z"),
    node("tenant-a", WORK_A1, "service", "service old provenance", "2026-07-29T10:00:00.000Z"),
    node("tenant-a", WORK_A1, "old-only", "older work node", "2026-07-29T10:00:00.000Z"),
    node("tenant-a", WORK_A2, "shared", "new shared implementation", "2026-07-29T11:00:00.000Z", 2),
    node("tenant-a", WORK_A2, "service", "service current", "2026-07-29T11:00:00.000Z", 2),
    node("tenant-a", WORK_A2, "new-only", "newer work node", "2026-07-29T11:00:00.000Z", 2),
    node("tenant-b", WORK_B1, "shared", "tenant b secret node", "2026-07-29T12:00:00.000Z", 7),
  ];
  const edge = (tenantId, workId, from, to) => ({
    tenant_id: tenantId,
    work_id: workId,
    from_node_id: from,
    to_node_id: to,
    edge_type: "depends_on",
    revision: 1,
  });
  const edges = [
    edge("tenant-a", WORK_A1, "shared", "service"),
    edge("tenant-a", WORK_A2, "shared", "service"),
    edge("tenant-a", WORK_A1, "shared", "old-only"),
    edge("tenant-a", WORK_A2, "shared", "new-only"),
  ];
  return { states, nodes, edges };
}

test("Atlas project selector accepts repository-shaped project identifiers", () => {
  const definition = WORK_CONTINUITY_TOOLS.find((tool) =>
    tool.name === "work_continuity_atlas_select");
  const projectPattern = new RegExp(definition.inputSchema.properties.project_id.pattern);

  assert.equal(projectPattern.test("owner/repo"), true);
  assert.equal(projectPattern.test("../cross-tenant"), false);
});

test("project Atlas aggregates every tenant work and keeps the newest node plus provenance", async () => {
  const pool = new ProjectAtlasPool(fixture());
  const runtime = createWorkContinuityRuntime({}, { pool });
  const result = await runtime.selectAtlas({ tenantId: "tenant-a" }, {
    project_id: "owner/repo",
    seed_node_ids: ["shared"],
    max_depth: 1,
    max_bytes: 10_000,
  });

  assert.equal(result.aggregate, true);
  assert.equal(result.work_id, null);
  assert.equal(result.last_work_id, WORK_A2);
  assert.deepEqual(result.source_work_ids, [WORK_A1, WORK_A2]);
  assert.equal(result.metrics.indexed_works, 2);
  assert.equal(result.metrics.full_scan_performed, false);
  assert.deepEqual(
    result.nodes.map((node) => node.node_id),
    ["shared", "new-only", "old-only", "service"],
  );
  const shared = result.nodes.find((node) => node.node_id === "shared");
  assert.equal(shared.summary, "new shared implementation");
  assert.deepEqual(shared.source_work_ids, [WORK_A1, WORK_A2]);
  const sharedService = result.edges.find((edge) =>
    edge.from_node_id === "shared" && edge.to_node_id === "service");
  assert.deepEqual(sharedService.source_work_ids, [WORK_A1, WORK_A2]);
  assert.doesNotMatch(JSON.stringify(result), /tenant b secret node/);
  assert.ok(pool.queries.every((query) => !/SELECT \*/i.test(query)));
});

test("explicit work_id keeps the exact Atlas snapshot instead of applying project override", async () => {
  const pool = new ProjectAtlasPool(fixture());
  const runtime = createWorkContinuityRuntime({}, { pool });
  const result = await runtime.selectAtlas({ tenantId: "tenant-a" }, {
    work_id: WORK_A1,
    project_id: "owner/repo",
    seed_node_ids: ["shared"],
    max_depth: 0,
    max_bytes: 10_000,
  });

  assert.equal(result.work_id, WORK_A1);
  assert.equal(result.last_work_id, WORK_A1);
  assert.equal(result.aggregate, undefined);
  assert.equal(result.nodes[0].summary, "old shared implementation");
  assert.equal(result.nodes[0].source_work_ids, undefined);
});

test("project Atlas remains tenant-isolated and returns explicit discovery state without indexes", async () => {
  const pool = new ProjectAtlasPool(fixture());
  const runtime = createWorkContinuityRuntime({}, { pool });
  const tenantB = await runtime.selectAtlas({ tenantId: "tenant-b" }, {
    project_id: "owner/repo",
    seed_node_ids: ["shared"],
    max_depth: 1,
    max_bytes: 10_000,
  });
  assert.equal(tenantB.nodes[0].summary, "tenant b secret node");
  assert.deepEqual(tenantB.source_work_ids, [WORK_B1]);
  assert.doesNotMatch(JSON.stringify(tenantB), /new shared implementation/);

  const missing = await runtime.selectAtlas({ tenantId: "tenant-a" }, {
    project_id: "owner/not-indexed",
    seed_node_ids: ["repository"],
    max_depth: 1,
    max_bytes: 1_000,
  });
  assert.equal(missing.state, "discovery_required");
  assert.equal(missing.discovery_required, true);
  assert.equal(missing.discovery_reason, "work_atlas_project_not_indexed");
  assert.deepEqual(missing.nodes, []);
  assert.deepEqual(missing.edges, []);
  assert.equal(missing.metrics.full_scan_performed, false);
});

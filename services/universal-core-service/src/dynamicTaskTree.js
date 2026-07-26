import crypto from "node:crypto";

const SCHEMA_VERSION = "dynamic_task_tree_v2";
const NODE_KINDS = new Set(["analysis", "research", "decision", "agent", "ai_model", "tool", "human_gate", "verification", "join", "rollback"]);
const TERMINAL = new Set(["verified", "failed", "cancelled", "pruned"]);
const HARD_LIMITS = Object.freeze({
  max_nodes: 2_000,
  max_depth: 16,
  max_fanout: 3,
  max_parallel: 2,
  max_time_ms: 3_600_000,
  max_tokens: 2_000_000,
  max_cost_micros: 1_000_000_000,
});
const DEFAULT_LIMITS = Object.freeze({
  max_nodes: 200,
  max_depth: 8,
  max_fanout: 3,
  max_parallel: 2,
  max_time_ms: 150_000,
  max_tokens: 100_000,
  max_cost_micros: 10_000_000,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireText(value, field, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(canonical(value)).digest("hex").slice(0, 24)}`;
}

function integer(value, field, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`${field}_invalid`);
  return number;
}

function normalizeLimits(limits = {}) {
  const merged = { ...DEFAULT_LIMITS, ...(limits && typeof limits === "object" ? limits : {}) };
  return Object.fromEntries(Object.keys(DEFAULT_LIMITS).map((key) => [
    key,
    integer(merged[key], key, key === "max_depth" ? 0 : 1, HARD_LIMITS[key]),
  ]));
}

function normalizeBudget(budget = {}, limits) {
  const tokens = integer(budget?.estimated_tokens ?? 0, "estimated_tokens", 0, limits.max_tokens);
  const cost = integer(budget?.estimated_cost_micros ?? 0, "estimated_cost_micros", 0, limits.max_cost_micros);
  const time = integer(budget?.estimated_time_ms ?? 0, "estimated_time_ms", 0, limits.max_time_ms);
  return { estimated_tokens: tokens, estimated_cost_micros: cost, estimated_time_ms: time };
}

function normalizeNode(node, limits) {
  const nodeId = requireText(node?.node_id, "node_id", 120);
  const kind = requireText(node?.kind, "node_kind", 64);
  if (!NODE_KINDS.has(kind)) throw new Error("node_kind_invalid");
  const depth = integer(node?.depth ?? 0, "node_depth", 0, limits.max_depth);
  return {
    node_id: nodeId,
    kind,
    task: requireText(node?.task, "node_task", 4_000),
    parent_node_id: node?.parent_node_id ? requireText(node.parent_node_id, "parent_node_id", 120) : null,
    dependencies: [...new Set((Array.isArray(node?.dependencies) ? node.dependencies : [])
      .map((item) => requireText(item, "dependency_id", 120)))].sort(),
    fallback_node_id: node?.fallback_node_id ? requireText(node.fallback_node_id, "fallback_node_id", 120) : null,
    depth,
    retry_policy: {
      max_attempts: integer(node?.retry_policy?.max_attempts ?? 0, "max_attempts", 0, 10),
      backoff: "caller_governed",
    },
    budget: normalizeBudget(node?.budget, limits),
    status: "proposed",
    attempts: 0,
    evidence: null,
  };
}

function assertAcyclic(nodes) {
  const dependencies = new Map(nodes.map((node) => [
    node.node_id,
    [...node.dependencies, ...(node.parent_node_id ? [node.parent_node_id] : [])],
  ]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error("task_tree_cycle_detected");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of dependencies.keys()) visit(id);
}

function validateNodes(nodes, limits) {
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > limits.max_nodes) throw new Error("nodes_invalid");
  const ids = new Set(nodes.map((node) => node.node_id));
  if (ids.size !== nodes.length) throw new Error("node_id_duplicate");
  const children = new Map();
  let totals = { estimated_tokens: 0, estimated_cost_micros: 0, estimated_time_ms: 0 };
  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      if (!ids.has(dependency)) throw new Error("dependency_not_found");
      if (dependency === node.node_id) throw new Error("task_tree_cycle_detected");
    }
    if (node.parent_node_id) {
      if (!ids.has(node.parent_node_id)) throw new Error("parent_node_not_found");
      const count = (children.get(node.parent_node_id) || 0) + 1;
      if (count > limits.max_fanout) throw new Error("max_fanout_exceeded");
      children.set(node.parent_node_id, count);
    }
    if (node.fallback_node_id && !ids.has(node.fallback_node_id)) throw new Error("fallback_node_not_found");
    totals = {
      estimated_tokens: totals.estimated_tokens + node.budget.estimated_tokens,
      estimated_cost_micros: totals.estimated_cost_micros + node.budget.estimated_cost_micros,
      estimated_time_ms: totals.estimated_time_ms + node.budget.estimated_time_ms,
    };
  }
  if (totals.estimated_tokens > limits.max_tokens) throw new Error("token_budget_exceeded");
  if (totals.estimated_cost_micros > limits.max_cost_micros) throw new Error("cost_budget_exceeded");
  if (totals.estimated_time_ms > limits.max_time_ms) throw new Error("time_budget_exceeded");
  assertAcyclic(nodes);
  return totals;
}

function publicTree(tree) {
  return clone(tree);
}

export function buildDynamicTaskTreeContract({ tenant_id, objective, nodes, limits = {} } = {}) {
  const tenantId = requireText(tenant_id, "tenant_id", 120);
  const normalizedLimits = normalizeLimits(limits);
  const normalizedNodes = (Array.isArray(nodes) ? nodes : [])
    .map((node) => normalizeNode(node, normalizedLimits))
    .sort((a, b) => a.node_id.localeCompare(b.node_id));
  const budget = validateNodes(normalizedNodes, normalizedLimits);
  const stable = {
    tenant_id: tenantId,
    objective: requireText(objective, "objective", 4_000),
    limits: normalizedLimits,
    nodes: normalizedNodes.map(({ status, attempts, evidence, ...node }) => node),
  };
  return {
    schema_version: SCHEMA_VERSION,
    tree_id: digest("dtt", stable),
    ...stable,
    nodes: normalizedNodes,
    budget,
    status: "advisory_ready",
    execution: {
      authorized: false,
      mode: "proposal_only",
      model_invocation: false,
      tool_invocation: false,
      external_actions: false,
      core_join_required: true,
    },
    created_from: "deterministic_tenant_bound_contract",
    kill_signal: null,
    core_join: null,
  };
}

export function createDynamicTaskTreeRuntime() {
  const trees = new Map();

  function treeFor({ tenant_id, tree_id }) {
    const tree = trees.get(requireText(tree_id, "tree_id", 160));
    if (!tree) throw new Error("task_tree_not_found");
    if (tree.tenant_id !== requireText(tenant_id, "tenant_id", 120)) throw new Error("cross_tenant_task_tree_denied");
    return tree;
  }

  return {
    create(input) {
      const contract = buildDynamicTaskTreeContract(input);
      const existing = trees.get(contract.tree_id);
      if (existing) return { ...publicTree(existing), reused: true };
      trees.set(contract.tree_id, contract);
      return { ...publicTree(contract), reused: false };
    },

    get(input) {
      return publicTree(treeFor(input));
    },

    proposeExpansion({ tenant_id, tree_id, parent_node_id, nodes }) {
      const tree = treeFor({ tenant_id, tree_id });
      if (tree.status === "cancelled") throw new Error("task_tree_cancelled");
      const parentId = requireText(parent_node_id, "parent_node_id", 120);
      const parent = tree.nodes.find((node) => node.node_id === parentId);
      if (!parent) throw new Error("parent_node_not_found");
      const candidates = (Array.isArray(nodes) ? nodes : []).map((node) => normalizeNode({
        ...node,
        parent_node_id: node?.parent_node_id || parentId,
        depth: node?.depth ?? parent.depth + 1,
      }, tree.limits));
      const combined = [...tree.nodes.map((node) => clone(node)), ...candidates];
      const budget = validateNodes(combined, tree.limits);
      const proposal = {
        schema_version: "dynamic_task_tree_expansion_proposal_v1",
        proposal_id: digest("dttx", { tree_id, parent_node_id: parentId, nodes: candidates }),
        tenant_id: tree.tenant_id,
        tree_id: tree.tree_id,
        parent_node_id: parentId,
        nodes: candidates,
        projected_budget: budget,
        state: "requires_core_review",
        applied: false,
        execution_authorized: false,
      };
      return clone(proposal);
    },

    proposePruneReplan({ tenant_id, tree_id, prune_node_ids = [], replacement_nodes = [], reason }) {
      const tree = treeFor({ tenant_id, tree_id });
      const pruneIds = [...new Set((Array.isArray(prune_node_ids) ? prune_node_ids : [])
        .map((item) => requireText(item, "prune_node_id", 120)))].sort();
      if (!pruneIds.length || pruneIds.some((id) => !tree.nodes.some((node) => node.node_id === id))) {
        throw new Error("prune_nodes_invalid");
      }
      const remaining = tree.nodes.filter((node) => !pruneIds.includes(node.node_id));
      const replacements = (Array.isArray(replacement_nodes) ? replacement_nodes : [])
        .map((node) => normalizeNode(node, tree.limits));
      validateNodes([...remaining, ...replacements], tree.limits);
      return {
        schema_version: "dynamic_task_tree_replan_proposal_v1",
        proposal_id: digest("dttr", { tree_id, prune_node_ids: pruneIds, replacement_nodes: replacements, reason }),
        tenant_id: tree.tenant_id,
        tree_id: tree.tree_id,
        prune_node_ids: pruneIds,
        replacement_nodes: replacements,
        reason: requireText(reason, "replan_reason", 500),
        state: "requires_core_review",
        applied: false,
        execution_authorized: false,
      };
    },

    recordOutcome({ tenant_id, tree_id, node_id, outcome, evidence = {} }) {
      const tree = treeFor({ tenant_id, tree_id });
      if (tree.status === "cancelled") throw new Error("task_tree_cancelled");
      const node = tree.nodes.find((item) => item.node_id === requireText(node_id, "node_id", 120));
      if (!node) throw new Error("node_not_found");
      if (TERMINAL.has(node.status)) throw new Error("node_terminal");
      const normalizedOutcome = requireText(outcome, "outcome", 32);
      if (!["verified", "failed"].includes(normalizedOutcome)) throw new Error("outcome_invalid");
      node.attempts += 1;
      node.evidence = evidence && typeof evidence === "object" && !Array.isArray(evidence) ? clone(evidence) : {};
      if (normalizedOutcome === "verified") {
        node.status = "verified";
        return { tree_id: tree.tree_id, node_id: node.node_id, state: "verified", next: "dependency_scheduler", execution_authorized: false };
      }
      if (node.attempts <= node.retry_policy.max_attempts) {
        node.status = "retry_proposed";
        return { tree_id: tree.tree_id, node_id: node.node_id, state: "retry_proposed", attempt: node.attempts, next: "requires_core_review", execution_authorized: false };
      }
      node.status = "failed";
      return {
        tree_id: tree.tree_id,
        node_id: node.node_id,
        state: node.fallback_node_id ? "fallback_proposed" : "failed",
        fallback_node_id: node.fallback_node_id,
        next: node.fallback_node_id ? "requires_core_review" : "replan_or_cancel",
        execution_authorized: false,
      };
    },

    cancel({ tenant_id, tree_id, reason = "owner_or_core_cancelled" }) {
      const tree = treeFor({ tenant_id, tree_id });
      let cancelled = 0;
      for (const node of tree.nodes) {
        if (!TERMINAL.has(node.status)) {
          node.status = "cancelled";
          cancelled += 1;
        }
      }
      tree.status = "cancelled";
      tree.kill_signal = { propagated: true, cancelled_node_count: cancelled, reason: requireText(reason, "cancel_reason", 500) };
      return publicTree(tree);
    },

    coreJoin({ tenant_id, tree_id, core_verdict, verification = {} }) {
      const tree = treeFor({ tenant_id, tree_id });
      if (tree.status === "cancelled") throw new Error("task_tree_cancelled");
      if (!core_verdict || core_verdict.allowed !== true || requireText(core_verdict.authority, "core_authority", 120) !== "universal_core") {
        throw new Error("core_join_verdict_required");
      }
      if (tree.nodes.some((node) => node.status !== "verified")) throw new Error("task_tree_not_verified");
      tree.status = "core_joined";
      tree.core_join = {
        authority: "universal_core",
        verdict_reference: requireText(core_verdict.verdict_reference, "verdict_reference", 200),
        verification: verification && typeof verification === "object" && !Array.isArray(verification) ? clone(verification) : {},
      };
      return {
        tree_id: tree.tree_id,
        tenant_id: tree.tenant_id,
        status: tree.status,
        core_join: clone(tree.core_join),
        execution_authorized: false,
      };
    },
  };
}

export { DEFAULT_LIMITS as DYNAMIC_TASK_TREE_DEFAULT_LIMITS, HARD_LIMITS as DYNAMIC_TASK_TREE_HARD_LIMITS };

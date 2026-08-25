import crypto from "node:crypto";
import {
  validateVerificationEvidenceContractAsync,
} from "./verificationEvidenceContract.js";
import { guardInterAgentEnvelope } from "../../shared/handoff-injection-guard.mjs";

const SCHEMA_VERSION = "dynamic_task_tree_v3";
const OUTCOME_RECEIPT_SCHEMA_VERSION = "dynamic_task_tree_outcome_receipt_v2";
const NODE_KINDS = new Set(["analysis", "research", "decision", "agent", "ai_model", "tool", "human_gate", "verification", "join", "rollback"]);
const TERMINAL = new Set(["verified", "quarantined", "failed", "cancelled", "pruned"]);
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
const VERIFICATION_READINESS_BLOCKERS = new Set([
  "task_tree_cancelled",
  "task_tree_already_joined",
  "task_tree_not_verified",
  "verification_node_required",
  "verification_verifier_not_allowlisted",
  "verification_assignment_duplicate",
  "verification_evidence_quorum_unsatisfied",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireText(value, field, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function requireWorkId(value) {
  if (typeof value !== "string") throw new Error("work_id_invalid");
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error("work_id_invalid");
  }
  return normalized;
}

function requireStoredWorkBinding(tree) {
  if (!Object.hasOwn(tree || {}, "work_id") || tree.work_id === null || String(tree.work_id || "").trim() === "") {
    throw new Error("dtt_work_binding_required");
  }
  try {
    return requireWorkId(tree.work_id);
  } catch {
    throw new Error("dynamic_task_tree_state_corrupt");
  }
}

function requireIdempotencyKey(value) {
  if (typeof value !== "string") throw new Error("idempotency_key_invalid");
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) throw new Error("idempotency_key_invalid");
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

function digestHex(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
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
  const verificationPolicy = kind === "verification" ? {
    required_approvals: integer(node?.verification_policy?.required_approvals ?? 2, "verification_required_approvals", 2, 64),
    allowed_verifier_ids: [...new Set((Array.isArray(node?.verification_policy?.allowed_verifier_ids)
      ? node.verification_policy.allowed_verifier_ids : [])
      .map((item) => requireText(item, "allowed_verifier_id", 160)))].sort(),
  } : null;
  if (verificationPolicy && verificationPolicy.allowed_verifier_ids.length < verificationPolicy.required_approvals) {
    throw new Error("verification_verifier_allowlist_insufficient");
  }
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
    verification_policy: verificationPolicy,
  };
}

function bitIsSet(bits, index) {
  return (bits[index >>> 5] & (1 << (index & 31))) !== 0;
}

function setBit(bits, index) {
  bits[index >>> 5] |= 1 << (index & 31);
}

function buildReachability(order, dependents) {
  const indexes = new Map(order.map((id, index) => [id, index]));
  const wordCount = Math.ceil(order.length / 32);
  const reachable = order.map(() => new Uint32Array(wordCount));
  for (let index = order.length - 1; index >= 0; index -= 1) {
    for (const dependent of dependents.get(order[index]) || []) {
      const dependentIndex = indexes.get(dependent);
      reachable[index][dependentIndex >>> 5] |= 1 << (dependentIndex & 31);
      for (let word = 0; word < wordCount; word += 1) {
        reachable[index][word] |= reachable[dependentIndex][word];
      }
    }
  }
  return reachable;
}

function areComparable(reachable, left, right) {
  if (left === right) return true;
  return left < right
    ? bitIsSet(reachable[left], right)
    : bitIsSet(reachable[right], left);
}

function assertParallelBound(order, dependents, nodes, maxParallel) {
  const reachable = buildReachability(order, dependents);
  const indexes = new Map(order.map((id, index) => [id, index]));
  const wordCount = Math.ceil(order.length / 32);
  const mutuallyExclusive = order.map(() => new Uint32Array(wordCount));
  for (const node of nodes) {
    if (!node.fallback_node_id) continue;
    const source = indexes.get(node.node_id);
    const fallback = indexes.get(node.fallback_node_id);
    setBit(mutuallyExclusive[source], fallback);
    setBit(mutuallyExclusive[fallback], source);
  }
  const concurrent = order.map(() => new Uint32Array(wordCount));

  for (let left = 0; left < order.length; left += 1) {
    for (let right = left + 1; right < order.length; right += 1) {
      if (areComparable(reachable, left, right) || bitIsSet(mutuallyExclusive[left], right)) continue;
      setBit(concurrent[left], right);
      setBit(concurrent[right], left);
    }
  }

  if (maxParallel === 1) {
    if (concurrent.some((peers) => peers.some((word) => word !== 0))) {
      throw new Error("max_parallel_exceeded");
    }
    return;
  }

  // HARD_LIMITS.max_parallel is two. A plan exceeds it iff the deterministic
  // concurrency graph contains a triangle of three pairwise-compatible items.
  for (let left = 0; left < order.length; left += 1) {
    for (let right = left + 1; right < order.length; right += 1) {
      if (!bitIsSet(concurrent[left], right)) continue;
      for (let word = 0; word < wordCount; word += 1) {
        if ((concurrent[left][word] & concurrent[right][word]) !== 0) {
          throw new Error("max_parallel_exceeded");
        }
      }
    }
  }
}

function deriveTopology(nodes, limits) {
  const prerequisites = new Map(nodes.map((node) => [
    node.node_id,
    [...new Set([
      ...node.dependencies,
      ...(node.parent_node_id ? [node.parent_node_id] : []),
    ])].sort(),
  ]));
  const dependents = new Map(nodes.map((node) => [node.node_id, []]));
  const remainingPrerequisites = new Map();
  const depths = new Map(nodes.map((node) => [node.node_id, 0]));

  for (const [nodeId, nodePrerequisites] of prerequisites) {
    remainingPrerequisites.set(nodeId, nodePrerequisites.length);
    for (const prerequisite of nodePrerequisites) dependents.get(prerequisite).push(nodeId);
  }
  for (const nodeDependents of dependents.values()) nodeDependents.sort();

  const ready = [...remainingPrerequisites]
    .filter(([, count]) => count === 0)
    .map(([nodeId]) => nodeId)
    .sort();
  const order = [];
  while (ready.length > 0) {
    const nodeId = ready.shift();
    order.push(nodeId);
    for (const dependent of dependents.get(nodeId)) {
      depths.set(dependent, Math.max(depths.get(dependent), depths.get(nodeId) + 1));
      const remaining = remainingPrerequisites.get(dependent) - 1;
      remainingPrerequisites.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  if (order.length !== nodes.length) throw new Error("task_tree_cycle_detected");
  if ([...depths.values()].some((depth) => depth > limits.max_depth)) {
    throw new Error("max_depth_exceeded");
  }
  assertParallelBound(order, dependents, nodes, limits.max_parallel);
  return depths;
}

function withDerivedDepths(nodes, depths) {
  return nodes.map((node) => ({ ...node, depth: depths.get(node.node_id) }));
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
  const depths = deriveTopology(nodes, limits);
  return { budget: totals, depths };
}

function publicTree(tree) {
  const { outcome_idempotency: _outcomeIdempotency, ...visible } = tree;
  return clone(visible);
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function replayOutcomeReceipt({ receipt, request_digest, scope_digest, requested_outcome, tree, node }) {
  if (!hasExactKeys(receipt, ["schema_version", "request_digest", "scope_digest", "result"])) {
    throw new Error("dynamic_task_tree_state_corrupt");
  }
  if (
    receipt.schema_version !== OUTCOME_RECEIPT_SCHEMA_VERSION
    || !/^[a-f0-9]{64}$/.test(receipt.request_digest)
    || !/^[a-f0-9]{64}$/.test(receipt.scope_digest)
  ) {
    throw new Error("dynamic_task_tree_state_corrupt");
  }
  if (receipt.request_digest !== request_digest) throw new Error("outcome_idempotency_key_conflict");
  if (receipt.scope_digest !== scope_digest) throw new Error("dynamic_task_tree_state_corrupt");

  const result = receipt.result;
  const commonValid = result?.tree_id === tree.tree_id
    && result?.work_id === tree.work_id
    && result?.node_id === node.node_id
    && result?.execution_authorized === false;
  if (!commonValid) throw new Error("dynamic_task_tree_state_corrupt");
  const compatibleStates = requested_outcome === "verified"
    ? new Set(["verified", "quarantined"])
    : new Set(["retry_proposed", "fallback_proposed", "failed", "quarantined"]);
  if (!compatibleStates.has(result.state)) throw new Error("dynamic_task_tree_state_corrupt");

  if (result.state === "verified") {
    if (!hasExactKeys(result, ["tree_id", "work_id", "node_id", "state", "next", "execution_authorized"])
      || result.next !== "dependency_scheduler"
      || node.status !== "verified") {
      throw new Error("dynamic_task_tree_state_corrupt");
    }
  } else if (result.state === "quarantined") {
    if (!hasExactKeys(result, ["tree_id", "work_id", "node_id", "state", "next", "execution_authorized"])
      || result.next !== "manual_security_review"
      || node.status !== "quarantined") {
      throw new Error("dynamic_task_tree_state_corrupt");
    }
  } else if (result.state === "retry_proposed") {
    if (!hasExactKeys(result, ["tree_id", "work_id", "node_id", "state", "attempt", "next", "execution_authorized"])
      || result.next !== "requires_core_review"
      || !Number.isInteger(result.attempt)
      || result.attempt < 1
      || result.attempt > node.retry_policy.max_attempts
      || result.attempt > node.attempts) {
      throw new Error("dynamic_task_tree_state_corrupt");
    }
  } else if (result.state === "fallback_proposed") {
    if (!hasExactKeys(result, ["tree_id", "work_id", "node_id", "state", "fallback_node_id", "next", "execution_authorized"])
      || result.next !== "requires_core_review"
      || !node.fallback_node_id
      || result.fallback_node_id !== node.fallback_node_id
      || node.status !== "failed") {
      throw new Error("dynamic_task_tree_state_corrupt");
    }
  } else if (result.state === "failed") {
    if (!hasExactKeys(result, ["tree_id", "work_id", "node_id", "state", "next", "execution_authorized"])
      || result.next !== "replan_or_cancel"
      || node.fallback_node_id
      || node.status !== "failed") {
      throw new Error("dynamic_task_tree_state_corrupt");
    }
  } else {
    throw new Error("dynamic_task_tree_state_corrupt");
  }
  return clone(result);
}

export function buildDynamicTaskTreeContract({ tenant_id, work_id, objective, nodes, limits = {} } = {}) {
  const tenantId = requireText(tenant_id, "tenant_id", 120);
  const workId = requireWorkId(work_id);
  const normalizedLimits = normalizeLimits(limits);
  const normalizedNodes = (Array.isArray(nodes) ? nodes : [])
    .map((node) => normalizeNode(node, normalizedLimits))
    .sort((a, b) => a.node_id.localeCompare(b.node_id));
  const validation = validateNodes(normalizedNodes, normalizedLimits);
  const boundedNodes = withDerivedDepths(normalizedNodes, validation.depths);
  const stable = {
    tenant_id: tenantId,
    work_id: workId,
    objective: requireText(objective, "objective", 4_000),
    limits: normalizedLimits,
    nodes: boundedNodes.map(({ status, attempts, evidence, ...node }) => node),
  };
  return {
    schema_version: SCHEMA_VERSION,
    tree_id: digest("dtt", stable),
    ...stable,
    nodes: boundedNodes,
    budget: validation.budget,
    status: "advisory_ready",
    execution: {
      authorized: false,
      mode: "proposal_only",
      model_invocation: false,
      tool_invocation: false,
      external_actions: false,
      core_join_required: true,
    },
    created_from: "deterministic_tenant_and_work_bound_contract",
    kill_signal: null,
    core_join: null,
  };
}

export function createDynamicTaskTreeRuntime({
  resolve_verifier_identity = null,
  resolve_evidence_artifact = null,
  list_verifier_assignments = null,
  list_verifier_assignments_for_tree = null,
  read_core_join_verdict_events = null,
  state_store = null,
} = {}) {
  const trees = new Map();
  const revisions = new WeakMap();
  const outcomeLocks = new Map();

  async function serializeOutcome(scope, operation) {
    const prior = outcomeLocks.get(scope) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    outcomeLocks.set(scope, current);
    await prior;
    try {
      return await operation();
    } finally {
      release();
      if (outcomeLocks.get(scope) === current) outcomeLocks.delete(scope);
    }
  }

  async function treeFor({ tenant_id, work_id, tree_id }) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const workId = requireWorkId(work_id);
    const treeId = requireText(tree_id, "tree_id", 160);
    const stored = state_store ? await state_store.load({ tenant_id: tenantId, work_id: workId, tree_id: treeId }) : null;
    const tree = stored?.tree || trees.get(treeId);
    if (!tree) throw new Error("task_tree_not_found");
    if (tree.tenant_id !== tenantId) throw new Error("cross_tenant_task_tree_denied");
    const storedWorkId = requireStoredWorkBinding(tree);
    if (storedWorkId !== workId) throw new Error("cross_work_task_tree_denied");
    if (stored) revisions.set(tree, stored.revision);
    return tree;
  }

  async function persist(tree) {
    if (!state_store) {
      trees.set(tree.tree_id, tree);
      return;
    }
    const saved = await state_store.save({
      tree,
      expected_revision: revisions.get(tree) ?? null,
    });
    revisions.set(tree, saved.revision);
  }

  async function validateTreeForCoreJoin(tree) {
    if (tree.status === "cancelled") throw new Error("task_tree_cancelled");
    if (tree.status === "core_joined") throw new Error("task_tree_already_joined");
    if (tree.nodes.some((node) => node.status !== "verified")) throw new Error("task_tree_not_verified");
    const verificationNodes = tree.nodes.filter((node) => node.kind === "verification");
    if (verificationNodes.length === 0) throw new Error("verification_node_required");
    const normalizedEvidence = [];
    for (const node of tree.nodes) {
      const evidence = await validateVerificationEvidenceContractAsync(node.evidence, {
        tenant_id: tree.tenant_id,
        work_id: tree.work_id,
        tree_id: tree.tree_id,
        node_id: node.node_id,
        minimum_approvals: node.kind === "verification"
          ? node.verification_policy.required_approvals
          : 1,
        resolve_verifier_identity: typeof resolve_verifier_identity === "function"
          ? (input) => resolve_verifier_identity({ ...input, work_id: tree.work_id })
          : null,
        require_verified_identities: true,
        resolve_evidence_artifact: typeof resolve_evidence_artifact === "function"
          ? (input) => resolve_evidence_artifact({ ...input, work_id: tree.work_id })
          : null,
        require_registered_artifacts: true,
      });
      if (node.kind === "verification") {
        if (evidence.attestations.some((item) => !node.verification_policy.allowed_verifier_ids.includes(item.verifier_id))) {
          throw new Error("verification_verifier_not_allowlisted");
        }
        if (new Set(evidence.attestations.map((item) => item.assignment_id)).size !== evidence.attestations.length) {
          throw new Error("verification_assignment_duplicate");
        }
      }
      if (!evidence.contract_satisfied) throw new Error("verification_evidence_quorum_unsatisfied");
      normalizedEvidence.push({ node_id: node.node_id, evidence_digest: evidence.evidence_digest });
    }
    return {
      tree_id: tree.tree_id,
      tenant_id: tree.tenant_id,
      work_id: tree.work_id,
      evidence_set_digest: digest("dttje", {
        tenant_id: tree.tenant_id,
        work_id: tree.work_id,
        tree_id: tree.tree_id,
        evidence: normalizedEvidence,
      }),
      verification_node_count: verificationNodes.length,
      verified_node_count: tree.nodes.length,
      ready: true,
      execution_authorized: false,
    };
  }

  return {
    async create(input) {
      const contract = buildDynamicTaskTreeContract(input);
      const stored = state_store ? await state_store.load({
        tenant_id: contract.tenant_id,
        work_id: contract.work_id,
        tree_id: contract.tree_id,
      }) : null;
      const existing = stored?.tree || trees.get(contract.tree_id);
      if (existing) {
        const existingWorkId = requireStoredWorkBinding(existing);
        if (existingWorkId !== contract.work_id) throw new Error("cross_work_task_tree_denied");
        return { ...publicTree(existing), reused: true };
      }
      try {
        await persist(contract);
      } catch (error) {
        if (error.message !== "dynamic_task_tree_revision_conflict") throw error;
        const raced = state_store ? await state_store.load({
          tenant_id: contract.tenant_id,
          work_id: contract.work_id,
          tree_id: contract.tree_id,
        }) : null;
        if (!raced?.tree || raced.tree.tenant_id !== contract.tenant_id) throw error;
        const racedWorkId = requireStoredWorkBinding(raced.tree);
        if (racedWorkId !== contract.work_id) throw new Error("cross_work_task_tree_denied");
        return { ...publicTree(raced.tree), reused: true };
      }
      return { ...publicTree(contract), reused: false };
    },

    async get(input) {
      return publicTree(await treeFor(input));
    },

    async proposeExpansion({ tenant_id, work_id, tree_id, parent_node_id, nodes }) {
      const tree = await treeFor({ tenant_id, work_id, tree_id });
      if (tree.status === "cancelled") throw new Error("task_tree_cancelled");
      const parentId = requireText(parent_node_id, "parent_node_id", 120);
      const parent = tree.nodes.find((node) => node.node_id === parentId);
      if (!parent) throw new Error("parent_node_not_found");
      const candidates = (Array.isArray(nodes) ? nodes : []).map((node) => normalizeNode({
        ...node,
        parent_node_id: node?.parent_node_id || parentId,
      }, tree.limits));
      const combined = [...tree.nodes.map((node) => clone(node)), ...candidates];
      const validation = validateNodes(combined, tree.limits);
      const boundedCandidates = withDerivedDepths(candidates, validation.depths);
      const proposal = {
        schema_version: "dynamic_task_tree_expansion_proposal_v2",
        proposal_id: digest("dttx", { work_id: tree.work_id, tree_id, parent_node_id: parentId, nodes: boundedCandidates }),
        tenant_id: tree.tenant_id,
        work_id: tree.work_id,
        tree_id: tree.tree_id,
        parent_node_id: parentId,
        nodes: boundedCandidates,
        projected_budget: validation.budget,
        state: "requires_core_review",
        applied: false,
        execution_authorized: false,
      };
      return clone(proposal);
    },

    async proposePruneReplan({ tenant_id, work_id, tree_id, prune_node_ids = [], replacement_nodes = [], reason }) {
      const tree = await treeFor({ tenant_id, work_id, tree_id });
      const pruneIds = [...new Set((Array.isArray(prune_node_ids) ? prune_node_ids : [])
        .map((item) => requireText(item, "prune_node_id", 120)))].sort();
      if (!pruneIds.length || pruneIds.some((id) => !tree.nodes.some((node) => node.node_id === id))) {
        throw new Error("prune_nodes_invalid");
      }
      const remaining = tree.nodes.filter((node) => !pruneIds.includes(node.node_id));
      const replacements = (Array.isArray(replacement_nodes) ? replacement_nodes : [])
        .map((node) => normalizeNode(node, tree.limits));
      const validation = validateNodes([...remaining, ...replacements], tree.limits);
      const boundedReplacements = withDerivedDepths(replacements, validation.depths);
      return {
        schema_version: "dynamic_task_tree_replan_proposal_v2",
        proposal_id: digest("dttr", { work_id: tree.work_id, tree_id, prune_node_ids: pruneIds, replacement_nodes: boundedReplacements, reason }),
        tenant_id: tree.tenant_id,
        work_id: tree.work_id,
        tree_id: tree.tree_id,
        prune_node_ids: pruneIds,
        replacement_nodes: boundedReplacements,
        reason: requireText(reason, "replan_reason", 500),
        state: "requires_core_review",
        applied: false,
        execution_authorized: false,
      };
    },

    async recordOutcome({ tenant_id, work_id, tree_id, node_id, outcome, evidence = {}, idempotency_key }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const workId = requireWorkId(work_id);
      const treeId = requireText(tree_id, "tree_id", 160);
      const nodeId = requireText(node_id, "node_id", 120);
      const idempotencyKey = requireIdempotencyKey(idempotency_key);
      const normalizedOutcome = requireText(outcome, "outcome", 32);
      if (!["verified", "failed"].includes(normalizedOutcome)) throw new Error("outcome_invalid");
      const requestDigest = digestHex({
        tenant_id: tenantId,
        work_id: workId,
        tree_id: treeId,
        node_id: nodeId,
        outcome: normalizedOutcome,
        evidence,
      });
      const recordKey = digestHex({
        tenant_id: tenantId,
        work_id: workId,
        tree_id: treeId,
        node_id: nodeId,
        idempotency_key: idempotencyKey,
      });
      const scope = digestHex({ tenant_id: tenantId, work_id: workId, tree_id: treeId, node_id: nodeId });

      return serializeOutcome(scope, async () => {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const tree = await treeFor({ tenant_id: tenantId, work_id: workId, tree_id: treeId });
          if (
            tree.outcome_idempotency !== undefined
            && (!tree.outcome_idempotency || typeof tree.outcome_idempotency !== "object" || Array.isArray(tree.outcome_idempotency))
          ) {
            throw new Error("dynamic_task_tree_state_corrupt");
          }
          const node = tree.nodes.find((item) => item.node_id === nodeId);
          const receiptPresent = Object.hasOwn(tree.outcome_idempotency || {}, recordKey);
          if (receiptPresent) {
            if (!node) throw new Error("dynamic_task_tree_state_corrupt");
            return replayOutcomeReceipt({
              receipt: tree.outcome_idempotency[recordKey],
              request_digest: requestDigest,
              scope_digest: scope,
              requested_outcome: normalizedOutcome,
              tree,
              node,
            });
          }
          if (tree.status === "cancelled") throw new Error("task_tree_cancelled");
          if (!node) throw new Error("node_not_found");
          if (TERMINAL.has(node.status)) throw new Error("node_terminal");
          const guardedEvidence = guardInterAgentEnvelope({
            tenant_id: tree.tenant_id,
            from_agent_id: `dtt-node-${node.node_id}`,
            to_agent_id: "universal-core",
            thread_id: tree.tree_id,
            body: evidence,
          });
          let result;
          if (!guardedEvidence.allowed) {
            node.status = "quarantined";
            node.evidence = {
              schema_version: "inter_agent_untrusted_envelope_v1",
              state: "quarantined",
              propagation_allowed: false,
              quarantine: guardedEvidence.quarantine,
            };
            result = {
              tree_id: tree.tree_id,
              work_id: tree.work_id,
              node_id: node.node_id,
              state: "quarantined",
              next: "manual_security_review",
              execution_authorized: false,
            };
          } else if (normalizedOutcome === "verified") {
            const normalizedEvidence = await validateVerificationEvidenceContractAsync(guardedEvidence.value, {
              tenant_id: tree.tenant_id,
              work_id: tree.work_id,
              tree_id: tree.tree_id,
              node_id: node.node_id,
              minimum_approvals: node.kind === "verification"
                ? node.verification_policy.required_approvals
                : 1,
              resolve_verifier_identity: typeof resolve_verifier_identity === "function"
                ? (input) => resolve_verifier_identity({ ...input, work_id: tree.work_id })
                : null,
              require_verified_identities: true,
              resolve_evidence_artifact: typeof resolve_evidence_artifact === "function"
                ? (input) => resolve_evidence_artifact({ ...input, work_id: tree.work_id })
                : null,
              require_registered_artifacts: true,
            });
            if (node.kind === "verification") {
              if (normalizedEvidence.attestations.some((item) => !node.verification_policy.allowed_verifier_ids.includes(item.verifier_id))) {
                throw new Error("verification_verifier_not_allowlisted");
              }
              if (new Set(normalizedEvidence.attestations.map((item) => item.assignment_id)).size !== normalizedEvidence.attestations.length) {
                throw new Error("verification_assignment_duplicate");
              }
            }
            if (!normalizedEvidence.contract_satisfied) throw new Error("verification_evidence_quorum_unsatisfied");
            node.attempts += 1;
            node.evidence = normalizedEvidence;
            node.status = "verified";
            result = {
              tree_id: tree.tree_id,
              work_id: tree.work_id,
              node_id: node.node_id,
              state: "verified",
              next: "dependency_scheduler",
              execution_authorized: false,
            };
          } else {
            node.attempts += 1;
            node.evidence = guardedEvidence.value && typeof guardedEvidence.value === "object" && !Array.isArray(guardedEvidence.value)
              ? guardedEvidence.value
              : {};
            if (node.attempts <= node.retry_policy.max_attempts) {
              node.status = "retry_proposed";
              result = {
                tree_id: tree.tree_id,
                work_id: tree.work_id,
                node_id: node.node_id,
                state: "retry_proposed",
                attempt: node.attempts,
                next: "requires_core_review",
                execution_authorized: false,
              };
            } else {
              node.status = "failed";
              result = {
                tree_id: tree.tree_id,
                work_id: tree.work_id,
                node_id: node.node_id,
                state: node.fallback_node_id ? "fallback_proposed" : "failed",
                next: node.fallback_node_id ? "requires_core_review" : "replan_or_cancel",
                execution_authorized: false,
                ...(node.fallback_node_id ? { fallback_node_id: node.fallback_node_id } : {}),
              };
            }
          }
          tree.outcome_idempotency = tree.outcome_idempotency || {};
          tree.outcome_idempotency[recordKey] = {
            schema_version: OUTCOME_RECEIPT_SCHEMA_VERSION,
            request_digest: requestDigest,
            scope_digest: scope,
            result: clone(result),
          };
          try {
            await persist(tree);
            return result;
          } catch (error) {
            if (error.message !== "dynamic_task_tree_revision_conflict") throw error;
          }
        }
        throw new Error("dynamic_task_tree_revision_conflict");
      });
    },

    async cancel({ tenant_id, work_id, tree_id, reason = "owner_or_core_cancelled" }) {
      const tree = await treeFor({ tenant_id, work_id, tree_id });
      let cancelled = 0;
      for (const node of tree.nodes) {
        if (!TERMINAL.has(node.status)) {
          node.status = "cancelled";
          cancelled += 1;
        }
      }
      tree.status = "cancelled";
      tree.kill_signal = { propagated: true, cancelled_node_count: cancelled, reason: requireText(reason, "cancel_reason", 500) };
      await persist(tree);
      return publicTree(tree);
    },

    async inspectCoreJoin({ tenant_id, work_id, tree_id }) {
      const tree = await treeFor({ tenant_id, work_id, tree_id });
      return clone(await validateTreeForCoreJoin(tree));
    },

    // This is deliberately a read-only projection of durable state. Evidence
    // drafts and unsubmitted receipts are intentionally excluded: treating a
    // client-held draft as durable progress would let a stale or substituted
    // proof make a Work look ready. Assignments, recorded outcomes and the
    // Core Join are all re-read from their authoritative stores instead.
    async inspectVerificationReadiness({ tenant_id, work_id, tree_id }) {
      const tree = await treeFor({ tenant_id, work_id, tree_id });
      const assignmentsByNode = new Map();
      if (typeof list_verifier_assignments_for_tree === "function") {
        const assignments = await list_verifier_assignments_for_tree({
          tenant_id: tree.tenant_id,
          work_id: tree.work_id,
          tree_id: tree.tree_id,
        });
        if (!Array.isArray(assignments)) throw new Error("dtt_verifier_assignments_unavailable");
        for (const assignment of assignments) {
          const nodeId = typeof assignment?.node_id === "string" ? assignment.node_id.trim() : "";
          if (!nodeId) throw new Error("dtt_verifier_assignments_unavailable");
          const current = assignmentsByNode.get(nodeId) || [];
          current.push(assignment);
          assignmentsByNode.set(nodeId, current);
        }
      }
      const nodes = [];
      for (const node of tree.nodes) {
        let assignments = assignmentsByNode.get(node.node_id) || [];
        if (typeof list_verifier_assignments_for_tree !== "function" &&
            typeof list_verifier_assignments === "function") {
          assignments = await list_verifier_assignments({
            tenant_id: tree.tenant_id,
            work_id: tree.work_id,
            tree_id: tree.tree_id,
            node_id: node.node_id,
          });
          if (!Array.isArray(assignments)) throw new Error("dtt_verifier_assignments_unavailable");
        }
        const assignedVerifierIds = [...new Set(assignments
          .map((assignment) => typeof assignment?.verifier_id === "string"
            ? assignment.verifier_id.trim()
            : "")
          .filter(Boolean))].sort();
        const requiredApprovals = node.kind === "verification"
          ? node.verification_policy.required_approvals
          : 1;
        const allowedVerifierIds = node.kind === "verification"
          ? [...node.verification_policy.allowed_verifier_ids]
          : [];
        const nodeBlocked = ["failed", "quarantined", "cancelled", "pruned"].includes(node.status);
        const verified = node.status === "verified";
        nodes.push({
          node_id: node.node_id,
          kind: node.kind,
          status: node.status,
          required_approvals: requiredApprovals,
          ...(node.kind === "verification" ? {
            allowed_verifier_ids: allowedVerifierIds,
            unassigned_verifier_ids: allowedVerifierIds.filter((id) => !assignedVerifierIds.includes(id)),
          } : {}),
          assigned_verifier_ids: assignedVerifierIds,
          assignment_count: assignedVerifierIds.length,
          evidence_recorded: verified,
          state: verified
            ? "verified"
            : nodeBlocked
              ? "blocked"
              : "evidence_pending",
          next_steps: verified
            ? []
            : nodeBlocked
              ? ["replan_or_cancel"]
              : [
                "register_immutable_artifact",
                "prepare_work_bound_evidence_draft",
                "assign_independent_verifier",
                "collect_signed_attestations",
                "record_verified_outcome",
              ],
          execution_authorized: false,
        });
      }
      let coreJoin = { ready: false, state: "blocked", blocker: "task_tree_not_verified" };
      if (tree.status === "core_joined") {
        if (typeof read_core_join_verdict_events !== "function") {
          throw new Error("dtt_join_verdict_ledger_unavailable");
        }
        const verdictReference = String(tree.core_join?.verdict_reference || "").trim();
        const events = await read_core_join_verdict_events({
          tenant_id: tree.tenant_id,
          work_id: tree.work_id,
          tree_id: tree.tree_id,
        });
        if (!Array.isArray(events)) throw new Error("dtt_join_verdict_ledger_integrity_failed");
        const issued = events.find((event) =>
          event?.event_type === "issued" && event.verdict_reference === verdictReference);
        const consumed = events.some((event) =>
          event?.event_type === "consumed" && event.verdict_reference === verdictReference);
        const voided = events.some((event) =>
          event?.event_type === "voided" && event.verdict_reference === verdictReference);
        if (!verdictReference || !issued) {
          coreJoin = { ready: false, state: "reconciliation_required", blocker: "joined_tree_verdict_missing" };
        } else if (voided) {
          coreJoin = { ready: false, state: "reconciliation_required", blocker: "joined_tree_verdict_voided" };
        } else if (!consumed) {
          coreJoin = { ready: false, state: "reconciliation_required", blocker: "dtt_join_finalization_pending" };
        } else {
          coreJoin = { ready: true, state: "joined", blocker: null };
        }
      } else if (tree.status === "cancelled") {
        coreJoin = { ready: false, state: "unavailable", blocker: "task_tree_cancelled" };
      } else {
        try {
          const readiness = await validateTreeForCoreJoin(tree);
          coreJoin = {
            ready: readiness.ready === true,
            state: readiness.ready === true ? "ready" : "blocked",
            blocker: null,
            evidence_set_digest: readiness.evidence_set_digest,
          };
        } catch (error) {
          const code = String(error?.message || "task_tree_not_verified");
          if (!VERIFICATION_READINESS_BLOCKERS.has(code)) throw error;
          coreJoin = {
            ready: false,
            state: "blocked",
            blocker: code,
          };
        }
      }
      const blocked = nodes.find((node) => node.state === "blocked");
      const pending = nodes.find((node) => node.state === "evidence_pending");
      return clone({
        schema_version: "dynamic_task_tree_verification_readiness_v1",
        tenant_id: tree.tenant_id,
        work_id: tree.work_id,
        tree_id: tree.tree_id,
        tree_status: tree.status,
        nodes,
        core_join: coreJoin,
        next_action: tree.status === "core_joined"
          ? coreJoin.state === "joined"
            ? "already_core_joined"
            : "reconcile_core_join_verdict"
          : tree.status === "cancelled"
            ? "tree_cancelled"
            : blocked
              ? "replan_or_cancel"
              : pending
                ? "complete_persisted_evidence_flow"
                : coreJoin.ready
                  ? "request_core_join"
                  : "inspect_core_join_blocker",
        persistence: {
          durable: ["verifier_assignments", "recorded_outcomes", "core_join"],
          intentionally_ephemeral: ["evidence_drafts", "unsubmitted_identity_receipts"],
        },
        execution_authorized: false,
      });
    },

    async coreJoin({ tenant_id, work_id, tree_id, core_verdict, verification = {} }) {
      const tree = await treeFor({ tenant_id, work_id, tree_id });
      if (!core_verdict || core_verdict.allowed !== true || requireText(core_verdict.authority, "core_authority", 120) !== "universal_core") {
        throw new Error("core_join_verdict_required");
      }
      await validateTreeForCoreJoin(tree);
      const guardedVerification = guardInterAgentEnvelope({
        tenant_id: tree.tenant_id,
        from_agent_id: "core-verification",
        to_agent_id: "universal-core",
        thread_id: tree.tree_id,
        body: verification,
      });
      if (!guardedVerification.allowed) {
        tree.status = "join_quarantined";
        tree.core_join = {
          authority: "universal_core",
          state: "quarantined",
          propagation_allowed: false,
          quarantine: guardedVerification.quarantine,
        };
        await persist(tree);
        throw new Error("core_join_verification_quarantined");
      }
      tree.status = "core_joined";
      tree.core_join = {
        authority: "universal_core",
        verdict_reference: requireText(core_verdict.verdict_reference, "verdict_reference", 200),
        verification: guardedVerification.value && typeof guardedVerification.value === "object" && !Array.isArray(guardedVerification.value) ? guardedVerification.value : {},
      };
      await persist(tree);
      return {
        tree_id: tree.tree_id,
        tenant_id: tree.tenant_id,
        work_id: tree.work_id,
        status: tree.status,
        core_join: clone(tree.core_join),
        execution_authorized: false,
      };
    },
  };
}

export { DEFAULT_LIMITS as DYNAMIC_TASK_TREE_DEFAULT_LIMITS, HARD_LIMITS as DYNAMIC_TASK_TREE_HARD_LIMITS };

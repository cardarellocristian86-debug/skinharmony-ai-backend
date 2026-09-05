import crypto from "node:crypto";

const MAX_SCANNED_PLANS = 10_000;
const MAX_PROJECTED_NODES = 100;
const MAX_CONFLICTS = 50;
const MERGEABLE_FIELDS = Object.freeze([
  "repository", "base_branch", "host_type", "required_checks", "tasks",
  "max_parallel", "closure_requirements", "software_contract", "launch_request",
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function same(left, right) {
  return digest(left === undefined ? null : left) === digest(right === undefined ? null : right);
}

function ancestry(startId, byId) {
  const result = new Map();
  const seen = new Set();
  let current = startId;
  let distance = 0;
  while (current) {
    if (seen.has(current)) return { distances: result, cycle: true };
    seen.add(current);
    result.set(current, distance++);
    current = byId.get(current)?.supersedes_plan_id || null;
  }
  return { distances: result, cycle: false };
}

function graphIntegrity(rows, byId) {
  const issues = [];
  const states = new Map();
  for (const row of rows) {
    if (row.supersedes_plan_id && !byId.has(row.supersedes_plan_id)) issues.push("missing_parent_plan");
  }
  for (const row of rows) {
    if (states.get(row.plan_id) === 2) continue;
    const path = [];
    const positions = new Map();
    let current = row.plan_id;
    while (current && byId.has(current) && states.get(current) !== 2) {
      if (positions.has(current)) {
        issues.push("native_plan_cycle");
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      current = byId.get(current)?.supersedes_plan_id || null;
    }
    for (const id of path) states.set(id, 2);
  }
  return issues;
}

function boundedIds(rows) {
  const ids = rows.map((row) => row.plan_id).sort();
  return { ids: ids.slice(0, MAX_PROJECTED_NODES), truncated: ids.length > MAX_PROJECTED_NODES };
}

function mergeValue(path, base, left, right, conflicts) {
  if (same(left, right)) return left;
  if (same(left, base)) return right;
  if (same(right, base)) return left;
  conflicts.push({
    path,
    reason: "concurrent_change",
    base_digest: digest(base === undefined ? null : base),
    left_digest: digest(left === undefined ? null : left),
    right_digest: digest(right === undefined ? null : right),
  });
  return undefined;
}

function mergeTasks(baseTasks = [], leftTasks = [], rightTasks = [], conflicts) {
  const maps = [baseTasks, leftTasks, rightTasks].map((tasks) =>
    new Map((Array.isArray(tasks) ? tasks : []).map((task) => [String(task?.task_id || ""), task])));
  const ids = [...new Set(maps.flatMap((map) => [...map.keys()]))].filter(Boolean).sort();
  const merged = [];
  for (const id of ids) {
    const value = mergeValue(`tasks.${id}`, maps[0].get(id), maps[1].get(id), maps[2].get(id), conflicts);
    if (value !== undefined) merged.push(value);
  }
  return merged;
}

function taskProjection(task = {}) {
  return {
    task_id: String(task.task_id || "").slice(0, 120),
    kind: String(task.kind || "").slice(0, 40),
    required: task.required !== false,
    dependencies: Array.isArray(task.dependencies)
      ? task.dependencies.slice(0, 3).map((item) => String(item).slice(0, 120))
      : [],
    instruction_digest: digest(String(task.instruction || "")),
  };
}

export function buildNativePlanMergePreview(rows = [], workId) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { schema_version: "native_plan_merge_preview_v1", work_id: workId,
      outcome: "BLOCKED", reason_codes: ["native_plan_graph_empty"], execution_authorized: false };
  }
  if (rows.length > MAX_SCANNED_PLANS) {
    return { schema_version: "native_plan_merge_preview_v1", work_id: workId,
      outcome: "BLOCKED", reason_codes: ["native_plan_graph_too_large"], execution_authorized: false };
  }
  const byId = new Map();
  const integrity = [];
  for (const row of rows) {
    if (byId.has(row.plan_id)) integrity.push("duplicate_plan_id");
    byId.set(row.plan_id, row);
    if (digest(row.plan) !== row.plan_digest) integrity.push("plan_digest_invalid");
  }
  integrity.push(...graphIntegrity(rows, byId));
  const referencedParents = new Set(rows.map((row) => row.supersedes_plan_id).filter(Boolean));
  const structuralHeads = rows.filter((row) => !referencedParents.has(row.plan_id));
  const storedCurrent = rows.filter((row) => row.status !== "superseded");
  const allNodes = rows.map((row) => ({
    plan_id: row.plan_id,
    plan_version: Number(row.plan_version || 0),
    status: row.status,
    supersedes_plan_id: row.supersedes_plan_id || null,
    plan_digest: row.plan_digest,
    digest_valid: digest(row.plan) === row.plan_digest,
    task_ids: (Array.isArray(row.plan?.tasks) ? row.plan.tasks : [])
      .map((task) => String(task?.task_id || "")).filter(Boolean).slice(0, 20),
  })).sort((a, b) => a.plan_version - b.plan_version || a.plan_id.localeCompare(b.plan_id));
  const nodes = allNodes.slice(0, MAX_PROJECTED_NODES);
  const currentProjection = boundedIds(storedCurrent);
  const headProjection = boundedIds(structuralHeads);
  const base = {
    schema_version: "native_plan_merge_preview_v1",
    work_id: workId,
    node_count: allNodes.length,
    nodes,
    nodes_truncated: allNodes.length > MAX_PROJECTED_NODES,
    stored_current_plan_count: storedCurrent.length,
    stored_current_plan_ids: currentProjection.ids,
    stored_current_plan_ids_truncated: currentProjection.truncated,
    structural_head_count: structuralHeads.length,
    structural_head_plan_ids: headProjection.ids,
    structural_head_plan_ids_truncated: headProjection.truncated,
    evidence_inherited: false,
    authority_inherited: false,
    fresh_core_rebind_required: true,
    execution_authorized: false,
    external_action_authorized: false,
    provider_execution: false,
  };
  if (integrity.length) return { ...base, outcome: "BLOCKED", reason_codes: [...new Set(integrity)].sort() };
  if (structuralHeads.length === 1) {
    const head = structuralHeads[0];
    const staleRows = storedCurrent.filter((row) => row.plan_id !== head.plan_id);
    const staleProjection = boundedIds(staleRows);
    const staleCurrent = staleProjection.ids;
    return { ...base, outcome: staleCurrent.length ? "STATUS_ALIGNMENT_REQUIRED" : "ALREADY_ALIGNED",
      canonical_head_plan_id: head.plan_id, stale_current_plan_count: staleRows.length,
      stale_current_plan_ids: staleCurrent, stale_current_plan_ids_truncated: staleProjection.truncated,
      reason_codes: staleCurrent.length ? ["structural_head_unique_status_drift"] : [] };
  }
  if (structuralHeads.length !== 2) {
    return { ...base, outcome: "BLOCKED", reason_codes: ["native_plan_head_count_unsupported"] };
  }
  const [left, right] = structuralHeads.sort((a, b) =>
    Number(a.plan_version || 0) - Number(b.plan_version || 0) || a.plan_id.localeCompare(b.plan_id));
  const leftAncestry = ancestry(left.plan_id, byId).distances;
  const rightAncestry = ancestry(right.plan_id, byId).distances;
  const common = [...leftAncestry.keys()].filter((id) => rightAncestry.has(id))
    .sort((a, b) => (leftAncestry.get(a) + rightAncestry.get(a)) -
      (leftAncestry.get(b) + rightAncestry.get(b)))[0] || null;
  if (!common) return { ...base, outcome: "BLOCKED", reason_codes: ["native_plan_common_ancestor_missing"] };
  const ancestor = byId.get(common);
  const conflicts = [];
  const merged = {};
  for (const field of MERGEABLE_FIELDS) {
    merged[field] = field === "tasks"
      ? mergeTasks(ancestor.plan?.tasks, left.plan?.tasks, right.plan?.tasks, conflicts)
      : mergeValue(field, ancestor.plan?.[field], left.plan?.[field], right.plan?.[field], conflicts);
  }
  const candidateMaterial = {
    schema_version: "native_plan_merge_candidate_v1",
    work_id: workId,
    parent_plan_ids: [left.plan_id, right.plan_id].sort(),
    common_ancestor_plan_id: common,
    parent_plan_digests: [left.plan_digest, right.plan_digest].sort(),
    merged_fields: merged,
    evidence_inherited: false,
    authority_inherited: false,
    fresh_core_rebind_required: true,
  };
  return {
    ...base,
    outcome: conflicts.length ? "CONFLICTS_REQUIRE_OWNER" : "MERGE_CANDIDATE_READY",
    reason_codes: conflicts.length ? ["native_plan_merge_conflicts"] : [],
    common_ancestor_plan_id: common,
    parent_plan_ids: candidateMaterial.parent_plan_ids,
    merge_candidate_digest: digest(candidateMaterial),
    merged_task_projection: (merged.tasks || []).map(taskProjection),
    conflicts: conflicts.slice(0, MAX_CONFLICTS),
    conflicts_truncated: conflicts.length > MAX_CONFLICTS,
  };
}

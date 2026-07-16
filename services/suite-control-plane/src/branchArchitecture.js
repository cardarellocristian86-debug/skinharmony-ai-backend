import fs from "node:fs";
import { fileURLToPath } from "node:url";

const BRANCH_ARCHITECTURE_PATH = fileURLToPath(new URL("../config/nyra-suite-branch-map.json", import.meta.url));
const REQUIRED_BRANCH_FIELDS = [
  "key",
  "label",
  "purpose",
  "evidence_sources",
  "signals",
  "dependencies",
  "decision_rules",
  "outputs",
  "runbooks",
  "freshness_sla_seconds",
  "privacy",
  "guardrails",
  "failure_fallback",
  "explainability",
  "core_branch_bindings",
  "nyra_branch_bindings",
];

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).map((value) => value.trim()).filter(Boolean))];
}

function hasDependencyCycle(branches) {
  const graph = new Map(branches.map((branch) => [branch.key, unique(branch.dependencies?.hard)]));
  const visiting = new Set();
  const visited = new Set();

  function visit(key) {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const dependency of graph.get(key) || []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  }

  return [...graph.keys()].some(visit);
}

export function validateSuiteBranchArchitecture(input = {}) {
  const errors = [];
  const warnings = [];
  const branches = Array.isArray(input.branches) ? input.branches : [];
  const branchKeys = unique(input.branch_keys);
  const actualKeys = branches.map((branch) => String(branch?.key || "").trim()).filter(Boolean);
  const actualKeySet = new Set(actualKeys);

  if (input.schema !== "nyra_suite_branch_architecture_v2") errors.push("schema_must_be_nyra_suite_branch_architecture_v2");
  if (input.compatibility_schema !== "nyra_suite_branch_map_v1") errors.push("compatibility_schema_missing");
  if (!Array.isArray(input.pipeline?.stages) || input.pipeline.stages.length < 8) errors.push("pipeline_depth_insufficient");
  if (branches.length !== 14) errors.push(`expected_14_branches_received_${branches.length}`);
  if (new Set(actualKeys).size !== actualKeys.length) errors.push("duplicate_branch_key");
  if (branchKeys.length !== actualKeys.length || branchKeys.some((key) => !actualKeySet.has(key))) {
    errors.push("branch_keys_do_not_match_branches");
  }

  for (const branch of branches) {
    const key = String(branch?.key || "unknown");
    for (const field of REQUIRED_BRANCH_FIELDS) {
      if (branch?.[field] === undefined || branch?.[field] === null) errors.push(`${key}:missing_${field}`);
    }
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(key)) errors.push(`${key}:invalid_key`);
    if (!Array.isArray(branch.evidence_sources) || branch.evidence_sources.length < 2) errors.push(`${key}:evidence_sources_too_shallow`);
    if (!Array.isArray(branch.signals) || branch.signals.length < 4) errors.push(`${key}:signals_too_shallow`);
    if (!Array.isArray(branch.core_branch_bindings) || branch.core_branch_bindings.length < 2) errors.push(`${key}:core_bindings_too_shallow`);
    if (!Array.isArray(branch.nyra_branch_bindings) || branch.nyra_branch_bindings.length < 2) errors.push(`${key}:nyra_bindings_too_shallow`);
    if (!Array.isArray(branch.decision_rules?.rules) || branch.decision_rules.rules.length < 3) errors.push(`${key}:decision_rules_too_shallow`);
    if (!Number.isFinite(Number(branch.freshness_sla_seconds)) || Number(branch.freshness_sla_seconds) < 60) errors.push(`${key}:invalid_freshness_sla`);
    for (const dependency of [...unique(branch.dependencies?.hard), ...unique(branch.dependencies?.soft)]) {
      if (!actualKeySet.has(dependency)) errors.push(`${key}:unknown_dependency_${dependency}`);
      if (dependency === key) errors.push(`${key}:self_dependency`);
    }
    const requiredEvidence = branch.evidence_sources.filter((source) => source?.required === true);
    if (!requiredEvidence.length) warnings.push(`${key}:no_required_evidence`);
    if (branch.privacy?.raw_customer_data_allowed !== false) errors.push(`${key}:raw_customer_data_must_be_false`);
  }

  if (hasDependencyCycle(branches)) errors.push("hard_dependency_cycle_detected");
  for (const [groupId, members] of Object.entries(input.branch_groups || {})) {
    for (const key of unique(members)) {
      if (!actualKeySet.has(key)) errors.push(`${groupId}:unknown_group_branch_${key}`);
    }
  }

  return {
    ok: errors.length === 0,
    schema: input.schema || "",
    branch_count: branches.length,
    pipeline_depth: Array.isArray(input.pipeline?.stages) ? input.pipeline.stages.length : 0,
    errors,
    warnings,
  };
}

export function loadSuiteBranchArchitecture() {
  try {
    const architecture = JSON.parse(fs.readFileSync(BRANCH_ARCHITECTURE_PATH, "utf8"));
    return {
      ...architecture,
      branch_keys: unique(architecture.branch_keys),
      validation: validateSuiteBranchArchitecture(architecture),
    };
  } catch (error) {
    return {
      schema: "nyra_suite_branch_architecture_v2",
      compatibility_schema: "nyra_suite_branch_map_v1",
      version: "unavailable",
      mode: "read_only_owner_confirmed",
      branch_keys: [],
      branches: [],
      guardrails: {
        execution_allowed: false,
        owner_confirmation_required: true,
        core_required_for_sensitive_actions: true,
        nyra_read_only: true,
        tenant_binding_required: true,
      },
      validation: {
        ok: false,
        schema: "nyra_suite_branch_architecture_v2",
        branch_count: 0,
        pipeline_depth: 0,
        errors: ["branch_architecture_load_failed"],
        warnings: [],
      },
      load_warning: error instanceof Error ? error.message : "branch_architecture_load_failed",
    };
  }
}

export function suiteBranchByKey(architecture, key) {
  return (Array.isArray(architecture?.branches) ? architecture.branches : [])
    .find((branch) => branch.key === key) || null;
}

export function normalizeRequestedSuiteBranches(architecture, requested) {
  const requestedKeys = unique(requested);
  const allowed = new Set(Array.isArray(architecture?.branch_keys) ? architecture.branch_keys : []);
  const unknown = requestedKeys.filter((key) => !allowed.has(key));
  return {
    ok: unknown.length === 0,
    selected: requestedKeys.filter((key) => allowed.has(key)).slice(0, 14),
    unknown,
  };
}

export { BRANCH_ARCHITECTURE_PATH };

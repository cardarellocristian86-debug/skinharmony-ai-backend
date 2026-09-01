import crypto from "node:crypto";

export const CORE_ORCHESTRATION_VERDICT_VERSION = "core_orchestration_verdict_v1";

const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-z][a-z0-9_.:-]{0,79}$/;
const VERDICTS = new Set(["ALLOW", "HOLD", "BLOCK"]);
const BLUEPRINTS = new Set([
  "memory_curator", "researcher", "planner", "executor_specialist",
  "independent_verifier", "release_operations",
]);
const PROGRESS_BY_VERDICT = Object.freeze({
  ALLOW: Object.freeze(["READ_ONLY", "ANALYSIS"]),
  HOLD: Object.freeze(["ANALYSIS", "PLANNING", "EVIDENCE", "BOUNDED_WORKSPACE"]),
  BLOCK: Object.freeze(["ANALYSIS", "EVIDENCE", "REMEDIATION_PROPOSAL"]),
});

function fail(code = "core_orchestration_verdict_invalid") {
  const error = new Error(code);
  error.code = code;
  error.status = 409;
  throw error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function exactRecord(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== fields.size ||
      Object.keys(value).some((key) => !fields.has(key))) fail(code);
  return value;
}

function text(value, maximum, code) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > maximum ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}

function uniqueTextList(value, maximumItems, maximumLength, code, pattern = null) {
  if (!Array.isArray(value) || value.length > maximumItems) fail(code);
  const items = value.map((item) => text(item, maximumLength, code));
  if (new Set(items).size !== items.length || (pattern && items.some((item) => !pattern.test(item)))) fail(code);
  return Object.freeze(items);
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
}

function canonicalIntentBinding(value) {
  const source = exactRecord(value, new Set([
    "schema_version", "intent_digest", "raw_text_digest", "operation_class",
    "work_requirement", "consequential_intent", "ambiguity", "binding_digest",
  ]), "core_orchestration_canonical_binding_invalid");
  if (source.schema_version !== "nyra_canonical_intent_binding_v1" ||
      !SHA256.test(String(source.intent_digest || "")) ||
      !SHA256.test(String(source.raw_text_digest || "")) ||
      !["READ_ONLY", "EXTERNAL_MUTATION"].includes(source.operation_class) ||
      !["NONE", "NEW", "EXISTING", "UNKNOWN"].includes(source.work_requirement) ||
      typeof source.consequential_intent !== "boolean" || typeof source.ambiguity !== "boolean") {
    fail("core_orchestration_canonical_binding_invalid");
  }
  const material = {
    schema_version: source.schema_version,
    intent_digest: source.intent_digest,
    raw_text_digest: source.raw_text_digest,
    operation_class: source.operation_class,
    work_requirement: source.work_requirement,
    consequential_intent: source.consequential_intent,
    ambiguity: source.ambiguity,
  };
  if (!SHA256.test(String(source.binding_digest || "")) || source.binding_digest !== digest(material)) {
    fail("core_orchestration_canonical_binding_digest_mismatch");
  }
  return Object.freeze({ ...material, binding_digest: source.binding_digest });
}

export function coreOrchestrationVerdictDigest(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : fail();
  delete source.verdict_digest;
  return digest(source);
}

export function validateCoreOrchestrationVerdict(value, {
  canonicalIntentDigest = null,
  canonicalIntentBindingDigest = null,
} = {}) {
  const source = exactRecord(value, new Set([
    "schema_version", "authority", "verdict", "reason_codes", "canonical_intent_binding",
    "required_nyra_branches", "denied_nyra_branches", "required_roles", "task_graph_digest",
    "maximum_parallel_assignments", "independent_verifier_required", "nyra_materializes_branches",
    "core_join_required", "permitted_progress", "external_execution_authorized", "verdict_digest",
  ]), "core_orchestration_verdict_shape_invalid");
  if (source.schema_version !== CORE_ORCHESTRATION_VERDICT_VERSION ||
      source.authority !== "UNIVERSAL_CORE" || !VERDICTS.has(source.verdict) ||
      !SHA256.test(String(source.task_graph_digest || "")) ||
      !Number.isSafeInteger(source.maximum_parallel_assignments) ||
      source.maximum_parallel_assignments < 1 || source.maximum_parallel_assignments > 2 ||
      typeof source.independent_verifier_required !== "boolean" ||
      source.nyra_materializes_branches !== true || source.core_join_required !== true ||
      source.external_execution_authorized !== false) {
    fail("core_orchestration_verdict_semantics_invalid");
  }
  const binding = canonicalIntentBinding(source.canonical_intent_binding);
  if ((canonicalIntentDigest && binding.intent_digest !== canonicalIntentDigest) ||
      (canonicalIntentBindingDigest && binding.binding_digest !== canonicalIntentBindingDigest)) {
    fail("core_orchestration_verdict_canonical_binding_mismatch");
  }
  const reasonCodes = uniqueTextList(source.reason_codes, 32, 160,
    "core_orchestration_reason_codes_invalid", IDENTIFIER);
  const requiredRoles = uniqueTextList(source.required_roles, BLUEPRINTS.size, 80,
    "core_orchestration_required_roles_invalid", IDENTIFIER);
  if (requiredRoles.length < 1 || requiredRoles.some((role) => !BLUEPRINTS.has(role)) ||
      source.independent_verifier_required !== requiredRoles.includes("independent_verifier")) {
    fail("core_orchestration_required_roles_invalid");
  }
  if (!Array.isArray(source.required_nyra_branches) || source.required_nyra_branches.length > 64) {
    fail("core_orchestration_required_branches_invalid");
  }
  const branches = source.required_nyra_branches.map((item) => {
    const branch = exactRecord(item, new Set(["id", "work_phase", "core_branch_bindings"]),
      "core_orchestration_required_branches_invalid");
    const id = text(branch.id, 64, "core_orchestration_required_branches_invalid");
    const workPhase = text(branch.work_phase, 64, "core_orchestration_required_branches_invalid");
    if (!IDENTIFIER.test(id) || !IDENTIFIER.test(workPhase)) fail("core_orchestration_required_branches_invalid");
    return Object.freeze({
      id,
      work_phase: workPhase,
      core_branch_bindings: uniqueTextList(branch.core_branch_bindings, 50, 80,
        "core_orchestration_required_branches_invalid", IDENTIFIER),
    });
  });
  if (new Set(branches.map((branch) => branch.id)).size !== branches.length) {
    fail("core_orchestration_required_branches_invalid");
  }
  const deniedBranches = uniqueTextList(source.denied_nyra_branches, 64, 64,
    "core_orchestration_denied_branches_invalid", IDENTIFIER);
  if (branches.some((branch) => deniedBranches.includes(branch.id))) {
    fail("core_orchestration_branch_overlap");
  }
  const permittedProgress = uniqueTextList(source.permitted_progress, 8, 40,
    "core_orchestration_permitted_progress_invalid", /^[A-Z][A-Z_]{1,39}$/);
  if (JSON.stringify(permittedProgress) !== JSON.stringify(PROGRESS_BY_VERDICT[source.verdict])) {
    fail("core_orchestration_permitted_progress_invalid");
  }
  const material = {
    schema_version: CORE_ORCHESTRATION_VERDICT_VERSION,
    authority: "UNIVERSAL_CORE",
    verdict: source.verdict,
    reason_codes: reasonCodes,
    canonical_intent_binding: binding,
    required_nyra_branches: Object.freeze(branches),
    denied_nyra_branches: deniedBranches,
    required_roles: requiredRoles,
    task_graph_digest: source.task_graph_digest,
    maximum_parallel_assignments: source.maximum_parallel_assignments,
    independent_verifier_required: source.independent_verifier_required,
    nyra_materializes_branches: true,
    core_join_required: true,
    permitted_progress: permittedProgress,
    external_execution_authorized: false,
  };
  if (!SHA256.test(String(source.verdict_digest || "")) ||
      source.verdict_digest !== coreOrchestrationVerdictDigest(material)) {
    fail("core_orchestration_verdict_digest_mismatch");
  }
  return freeze({ ...material, verdict_digest: source.verdict_digest });
}

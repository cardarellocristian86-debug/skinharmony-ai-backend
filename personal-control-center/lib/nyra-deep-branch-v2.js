"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const SCHEMA_VERSION = "nyra_deep_branch_architecture_v2";
const ROUTE_SCHEMA_VERSION = "nyra_deep_branch_route_v2";
const DEFAULT_CATALOG_PATH = path.resolve(__dirname, "../data/nyra-deep-branch-v2.catalog.json");
const DEFAULT_RUNTIME_MANIFEST_PATH = path.resolve(
  __dirname,
  "../data/nyra-deep-branch-v2.runtime-manifest.json"
);
const RUNTIME_MANIFEST_SCHEMA_VERSION = "nyra_deep_branch_runtime_manifest_v1";
const RUNTIME_SHARD_SCHEMA_VERSION = "nyra_deep_branch_runtime_shard_v1";
const DEFAULT_SHARD_CACHE_MAX_ENTRIES = 8;
const DEFAULT_SHARD_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const MAX_RUNTIME_SHARD_COMPRESSED_BYTES = 256 * 1024;
const MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES = 1024 * 1024;
const MAX_RUNTIME_SHARD_COMPRESSION_RATIO = 16;
const MAX_RUNTIME_SHARDS_COMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_RUNTIME_SHARDS_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const VALID_MODES = new Set(["disabled", "shadow", "active"]);
const VALID_RISKS = new Set(["low", "medium", "high", "critical"]);
const LEVEL_NODE_TYPES = Object.freeze({
  2: new Set(["specialized_capability"]),
  3: new Set(["micro_capability"]),
  4: new Set(["method", "strategy", "verifier", "metric"]),
});
const REQUIRED_LEVEL4_TYPES = Object.freeze(["method", "strategy", "verifier", "metric"]);
const REQUIRED_CONTRACT_FIELDS = Object.freeze([
  "id",
  "parent_id",
  "branch_id",
  "level",
  "node_type",
  "purpose",
  "problem_solved",
  "failure_modes",
  "input_schema",
  "output_schema",
  "activation_conditions",
  "non_activation_conditions",
  "dependencies",
  "required_context",
  "required_evidence",
  "core_policy_bindings",
  "tenant_scope",
  "risk_class",
  "confidence_method",
  "confidence_threshold",
  "methods",
  "strategies",
  "verifiers",
  "metrics",
  "routing",
  "fallback_node",
  "human_review_trigger",
  "audit_fields",
  "provenance_fields",
  "positive_tests",
  "negative_tests",
  "adversarial_tests",
  "regression_tests",
  "function_binding",
  "semantic_contract",
  "v1_compatibility",
  "rollback_reference",
  "feature_flag",
  "enabled",
  "version",
  "supervisor_status",
]);
const NON_EMPTY_ARRAY_FIELDS = Object.freeze([
  "failure_modes",
  "activation_conditions",
  "non_activation_conditions",
  "dependencies",
  "required_context",
  "required_evidence",
  "core_policy_bindings",
  "methods",
  "strategies",
  "verifiers",
  "metrics",
  "audit_fields",
  "provenance_fields",
  "positive_tests",
  "negative_tests",
  "adversarial_tests",
  "regression_tests",
]);
const ARRAY_OBJECT_FIELDS = Object.freeze({
  failure_modes: ["id", "scenario", "detection", "impact", "response"],
  activation_conditions: ["condition_id", "signal", "operator", "expected", "reason"],
  non_activation_conditions: ["condition_id", "signal", "operator", "expected", "reason"],
  dependencies: ["id", "type", "required", "failure_behavior"],
  required_context: ["field", "source", "sensitivity", "required", "validation"],
  required_evidence: ["evidence_type", "minimum_count", "authority_requirement", "freshness_seconds", "provenance_required", "on_missing", "description", "acceptance_rule", "content_tag", "content_fields", "semantic_claim_hash", "acceptance_program"],
  core_policy_bindings: ["policy_id", "effect", "enforcement_point", "on_deny", "core_decision_required"],
  methods: ["id", "description", "steps", "termination", "operation", "input_field", "output_field", "parameters", "program"],
  strategies: ["id", "description", "selection_rule", "failure_transition", "selection_predicate", "predicate_program"],
  verifiers: ["id", "verifier_type", "input", "pass_condition", "fail_action", "checks", "predicate_program"],
  metrics: ["id", "definition", "unit", "direction", "threshold_operator", "target", "measurement_window", "formula", "source_fields", "formula_program"],
  audit_fields: ["name", "source", "required", "redaction"],
  provenance_fields: ["name", "source", "required", "redaction"],
  positive_tests: ["id", "objective", "input_fixture", "assertions", "expected_core_verdict"],
  negative_tests: ["id", "objective", "input_fixture", "assertions", "expected_core_verdict"],
  adversarial_tests: ["id", "objective", "input_fixture", "assertions", "expected_core_verdict"],
  regression_tests: ["id", "objective", "input_fixture", "assertions", "expected_core_verdict", "v1_compatibility"],
});
const FORBIDDEN_TEXT = /\b(?:todo|tbd|placeholder|lorem ipsum|generic node|generic capability|to be defined|not implemented)\b/i;
const REQUIRED_VERIFIER_CHECKS = Object.freeze([
  "output_schema_valid",
  "input_consumed",
  "semantic_observation_verified",
  "function_registry_bound",
  "evidence_content_verified",
  "evidence_hashes_verified",
  "policy_allows",
  "method_valid",
  "strategy_selected",
  "failure_flags_empty",
  "finding_not_contract_text",
]);
const METRIC_FORMULA_SOURCES = Object.freeze({
  "verified_assertions/total_assertions": ["total_assertions", "verified_assertions"],
  "1-(verified_assertions/total_assertions)": ["total_assertions", "verified_assertions"],
  "supported_evidence/required_evidence": ["required_evidence", "supported_evidence"],
  "escaped_failures/declared_failure_modes": ["declared_failure_modes", "escaped_failures"],
  "valid_records/total_records": ["total_records", "valid_records"],
  "invalid_records/total_records": ["invalid_records", "total_records"],
});

let catalogCache = null;
let catalogCacheKey = "";
let runtimeManifestCache = null;
let runtimeManifestCacheKey = "";
const runtimeShardCache = new Map();
let runtimeShardCacheBytes = 0;

function uniqueStrings(value) {
  return [...new Set(String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean))];
}

function normalizedText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function containsForbiddenValue(value) {
  if (typeof value === "string") return !value.trim() || FORBIDDEN_TEXT.test(value);
  if (Array.isArray(value)) return value.some(containsForbiddenValue);
  if (isPlainObject(value)) return Object.values(value).some(containsForbiddenValue);
  return false;
}

function isIdentifier(value) {
  return /^[a-z][a-z0-9_.-]{2,384}$/.test(String(value || ""));
}

function validObjectSchema(value) {
  return isPlainObject(value)
    && value.$schema === "https://json-schema.org/draft/2020-12/schema"
    && value.type === "object"
    && isPlainObject(value.properties)
    && Object.keys(value.properties).length > 0
    && Array.isArray(value.required)
    && value.required.length > 0
    && value.required.every((field) => Object.hasOwn(value.properties, field))
    && value.additionalProperties === false;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function catalogFingerprint(catalog) {
  const fingerprintInput = { ...catalog };
  delete fingerprintInput.catalog_fingerprint;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(fingerprintInput)))
    .digest("hex");
}

function runtimeOpenedBranches(corePayload) {
  const candidates = [
    corePayload?.work_preflight?.nyra_route?.opened_branches,
    corePayload?.result?.work_preflight?.nyra_route?.opened_branches,
    corePayload?.result?.nyra_neural_network?.opened_branches,
    corePayload?.nyra_neural_network?.opened_branches,
    corePayload?.opened_branches,
  ];
  return candidates.find(Array.isArray) || [];
}

function openedBranchIds(corePayload) {
  return runtimeOpenedBranches(corePayload)
    .map((branch) => String(branch?.id || branch || ""))
    .filter(Boolean);
}

function childIdsFor(parentId, nodes) {
  return nodes.filter((node) => node.parent_id === parentId).map((node) => node.id);
}

function treeBranch(branch, nodeIndex, nodes) {
  return {
    id: branch.id,
    label: branch.label,
    work_phase: branch.work_phase,
    core_branch_bindings: [...branch.core_branch_bindings],
    domain_packs: [...branch.domain_packs],
    subbranches: branch.subbranches.map((subbranch) => ({
      ...subbranch,
      specialized_capabilities: childIdsFor(`${branch.id}.${subbranch.id}`, nodes).map((id) => {
        const specialized = nodeIndex.get(id);
        return {
          id: specialized.id,
          node_type: specialized.node_type,
          version: specialized.version,
          micro_capabilities: childIdsFor(specialized.id, nodes).map((microId) => {
            const micro = nodeIndex.get(microId);
            return {
              id: micro.id,
              node_type: micro.node_type,
              version: micro.version,
              level4: childIdsFor(micro.id, nodes).map((level4Id) => {
                const node = nodeIndex.get(level4Id);
                return { id: node.id, node_type: node.node_type, version: node.version };
              }),
            };
          }),
        };
      }),
    })),
  };
}

function requiredSchemaValue(schema, seed, fieldName = "") {
  if (!isPlainObject(schema)) return null;
  if (Object.hasOwn(schema, "const")) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find((candidate) => candidate !== "null") : schema.type;
  if (type === "string") {
    if (String(schema.pattern || "").includes("[a-f0-9]{64}")) {
      return crypto.createHash("sha256").update(`${seed}:${fieldName}`).digest("hex");
    }
    return String(seed || "verified");
  }
  if (type === "number" || type === "integer") return Number.isFinite(schema.minimum) ? schema.minimum : 1;
  if (type === "boolean") return true;
  if (type === "array") {
    if (schema.minItems === 0) return [];
    return [requiredSchemaValue(schema.items || { type: "string" }, seed, fieldName)];
  }
  if (type === "object") {
    const result = {};
    for (const field of schema.required || []) {
      result[field] = requiredSchemaValue(schema.properties?.[field], `${seed}:${field}`, field);
    }
    return result;
  }
  return null;
}

function outputFromSchema(node, confidence, evidence = [], methodResult = {}) {
  const output = {};
  for (const field of node.output_schema.required || []) {
    const schema = node.output_schema.properties[field];
    output[field] = field === "confidence"
      ? confidence
      : requiredSchemaValue(schema, `${node.node_type}_verified`);
  }
  const capabilityField = Object.keys(output).find((field) => (
    !["confidence", "verifier_results", "route_decision"].includes(field)
    && isPlainObject(output[field])
    && Object.hasOwn(output[field], "status")
  ));
  if (capabilityField) {
    const capability = output[capabilityField];
    capability.status = "satisfied";
    if (Object.hasOwn(capability, "finding")) capability.finding = String(methodResult.finding || "");
    if (Object.hasOwn(capability, "evidence_refs")) capability.evidence_refs = evidence.map((item) => item.evidence_id);
    if (Object.hasOwn(capability, "failure_flags")) capability.failure_flags = [...(methodResult.failure_flags || [])];
    if (Object.hasOwn(capability, "result_hash")) {
      capability.result_hash = crypto
        .createHash("sha256")
        .update(JSON.stringify({ node_id: node.id, evidence_refs: capability.evidence_refs || [], finding: capability.finding || "" }))
        .digest("hex");
    }
  }
  return output;
}

function schemaValueValid(schema, value) {
  if (!isPlainObject(schema)) return false;
  if (Object.hasOwn(schema, "const") && value !== schema.const) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  const type = Array.isArray(schema.type)
    ? schema.type.find((candidate) => candidate !== "null")
    : schema.type;
  if (type === "object") {
    if (!isPlainObject(value)) return false;
    if (!(schema.required || []).every((field) => Object.hasOwn(value, field))) return false;
    if (
      schema.additionalProperties === false
      && Object.keys(value).some((field) => !Object.hasOwn(schema.properties || {}, field))
    ) return false;
    return Object.entries(value).every(([field, item]) => (
      Object.hasOwn(schema.properties || {}, field)
        ? schemaValueValid(schema.properties[field], item)
        : schema.additionalProperties !== false
    ));
  }
  if (type === "array") {
    if (!Array.isArray(value) || value.length < Number(schema.minItems || 0)) return false;
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) return false;
    if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(canonicalize(item)))).size !== value.length) return false;
    return value.every((item) => schemaValueValid(schema.items || {}, item));
  }
  if (type === "string") {
    if (typeof value !== "string" || value.length < Number(schema.minLength || 0)) return false;
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
    if (schema.format === "date-time" && !Number.isFinite(Date.parse(value))) return false;
    return true;
  }
  if (type === "number" || type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (type === "integer" && !Number.isInteger(value)) return false;
    if (Number.isFinite(schema.minimum) && value < schema.minimum) return false;
    if (Number.isFinite(schema.maximum) && value > schema.maximum) return false;
    return true;
  }
  if (type === "boolean") return typeof value === "boolean";
  return value !== undefined;
}

function evidenceAuthorityMatches(requirement, evidence) {
  if (requirement.authority_requirement === "independent_corroboration") {
    return evidence.authority === "independent_corroboration" && evidence.independent === true;
  }
  return evidence.authority === requirement.authority_requirement;
}

function canonicalHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function byteHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function textHash(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function evidenceProvenanceHash(evidence) {
  return canonicalHash({
    tenant_id: evidence.tenant_id,
    evidence_type: evidence.evidence_type,
    authority: evidence.authority,
    independent: evidence.independent === true,
    content: evidence.content,
    payload_hash: evidence.payload_hash,
    observed_at: evidence.observed_at,
  });
}

function semanticContractProjection(node) {
  const method = node?.methods?.[0] || {};
  const strategy = node?.strategies?.[0] || {};
  const verifier = node?.verifiers?.[0] || {};
  const metric = node?.metrics?.[0] || {};
  const projection = {
    problem_hash: textHash(node?.problem_solved),
    purpose_hash: canonicalHash(String(node?.purpose || "")),
    evidence_claim_hashes: (node?.required_evidence || []).map((item) => item.semantic_claim_hash),
    evidence_program_hashes: (node?.required_evidence || []).map((item) => canonicalHash(item.acceptance_program)),
    failure_signature_hashes: (node?.failure_modes || []).map((item) => canonicalHash(normalizedText(item.scenario))),
    operation: method.operation,
    mechanism_id: method.parameters?.mechanism_id,
    capability_id: method.parameters?.capability_id,
    capability_spec_hash: method.parameters?.capability_spec_hash,
    record_claim_hash: method.parameters?.record_claim_hash,
    transformation_goal_hash: canonicalHash(String(method.parameters?.transformation_goal || "")),
    semantic_function_hash: method.program?.semantic_function_hash,
    execution_plan_hash: method.program?.execution_plan_hash,
    role_projection_hash: canonicalHash(String(method.program?.role_projection || "")),
    method_program_hash: canonicalHash(method.program),
    strategy_predicate: strategy.selection_predicate,
    strategy_rule_hash: canonicalHash(String(strategy.selection_rule || "")),
    strategy_program_hash: canonicalHash(strategy.predicate_program),
    verifier_pass_condition_hash: canonicalHash(String(verifier.pass_condition || "")),
    verifier_program_hash: canonicalHash(verifier.predicate_program),
    verifier_checks: [...(verifier.checks || [])].sort(),
    metric_formula: metric.formula,
    metric_source_fields: [...(metric.source_fields || [])].sort(),
    metric_definition_hash: canonicalHash(String(metric.definition || "")),
    metric_program_hash: canonicalHash(metric.formula_program),
    core_policy_bindings_hash: canonicalHash(node?.core_policy_bindings || []),
    function_binding_hash: canonicalHash(node?.function_binding || {}),
  };
  return {
    ...projection,
    semantic_hash: canonicalHash(projection),
  };
}

function semanticContractValid(node) {
  const declared = node?.semantic_contract;
  if (!isPlainObject(declared)) return false;
  const expected = semanticContractProjection(node);
  return declared.semantic_hash === expected.semantic_hash
    && declared.problem_hash === expected.problem_hash
    && declared.purpose_hash === expected.purpose_hash
    && declared.operation === expected.operation
    && declared.mechanism_id === expected.mechanism_id
    && declared.capability_spec_hash === expected.capability_spec_hash
    && declared.record_claim_hash === expected.record_claim_hash
    && declared.capability_id === node.id
    && declared.capability_id === expected.capability_id
    && declared.transformation_goal_hash === expected.transformation_goal_hash
    && declared.semantic_function_hash === expected.semantic_function_hash
    && declared.execution_plan_hash === expected.execution_plan_hash
    && declared.role_projection_hash === expected.role_projection_hash
    && declared.method_program_hash === expected.method_program_hash
    && declared.strategy_rule_hash === expected.strategy_rule_hash
    && declared.strategy_program_hash === expected.strategy_program_hash
    && declared.verifier_pass_condition_hash === expected.verifier_pass_condition_hash
    && declared.verifier_program_hash === expected.verifier_program_hash
    && declared.metric_definition_hash === expected.metric_definition_hash
    && declared.metric_program_hash === expected.metric_program_hash
    && declared.function_binding_hash === expected.function_binding_hash
    && JSON.stringify(declared.evidence_claim_hashes) === JSON.stringify(expected.evidence_claim_hashes)
    && JSON.stringify(declared.evidence_program_hashes) === JSON.stringify(expected.evidence_program_hashes)
    && JSON.stringify(declared.failure_signature_hashes) === JSON.stringify(expected.failure_signature_hashes)
    && JSON.stringify([...(declared.verifier_checks || [])].sort()) === JSON.stringify(expected.verifier_checks)
    && JSON.stringify([...(declared.metric_source_fields || [])].sort()) === JSON.stringify(expected.metric_source_fields)
    && declared.core_policy_bindings_hash === expected.core_policy_bindings_hash;
}

function exactKeys(value, expected) {
  return isPlainObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function inferOperationFromBasis(value) {
  const source = isPlainObject(value)
    ? [
        value.branch_id,
        value.subbranch_id,
        value.node_type,
        value.purpose,
        value.problem_solved,
        value.problem,
        ...(Array.isArray(value.evidence_claims) ? value.evidence_claims : []),
        ...(Array.isArray(value.evidence_requirements) ? value.evidence_requirements : []),
        ...(Array.isArray(value.failure_scenarios) ? value.failure_scenarios : []),
        ...(Array.isArray(value.failure_exclusions) ? value.failure_exclusions : []),
        value.overlap_exclusion,
      ].join(" ")
    : value;
  const text = normalizedText(source);
  if (/(tenant|isolat|authori|permission|consent|policy|security|injection|secret|privacy)/.test(text)) return "deny_first_governance";
  if (/(fresh|temporal|time|deadline|date|expiry|retention|stale|version|chronolog)/.test(text)) return "bitemporal_reconciliation";
  if (/(source|evidence|claim|citation|provenance|research|dataset|fact|contradiction|uncertainty)/.test(text)) return "claim_evidence_reconciliation";
  if (/(depend|graph|path|sequence|plan|capacity|schedule|milestone|priority|estimate|resource|lane|parallel|concurr|handoff)/.test(text)) return "constraint_graph_resolution";
  if (/(test|quality|regression|acceptance|verif|benchmark|defect|release_readiness|performance)/.test(text)) return "oracle_driven_verification";
  if (/(learn|memory|feedback|outcome|pattern|lesson|consolid|knowledge_gap)/.test(text)) return "outcome_bounded_learning";
  if (/(language|tone|summary|explain|audience|communication|localiz|citation_renderer|plain)/.test(text)) return "semantic_invariance_transformation";
  if (/(price|pricing|billing|payment|sale|inventory|revenue|cost|margin|finance|commerce)/.test(text)) return "financial_ledger_reconciliation";
  if (/(analyz|image|skin|acquisition|subject|cosmetic|clinical|longitudinal|capture|device)/.test(text)) return "subject_measurement_validation";
  if (/(software|code|repository|artifact|dependency|schema|api|migration|runtime|build|license)/.test(text)) return "artifact_graph_analysis";
  return "bounded_state_transformation";
}

function semanticFunctionHash(functionSpec) {
  return canonicalHash({
    source_row_hash: functionSpec?.source_row_hash,
    semantic_source: functionSpec?.semantic_source,
    semantic_assertions: functionSpec?.semantic_assertions,
    execution_plan: functionSpec?.execution_plan,
  });
}

function semanticFunctionValid(node, functionSpec, registryHash) {
  if (!isPlainObject(functionSpec) || !isPlainObject(node?.function_binding)) return false;
  const binding = node.function_binding;
  return exactKeys(binding, [
    "registry_hash",
    "source_row_hash",
    "semantic_function_hash",
    "execution_plan_hash",
    "observation_contract_hash",
  ])
    && functionSpec.function_id === node.id
    && functionSpec.semantic_source?.branch_id === node.branch_id
    && functionSpec.semantic_source?.subbranch_id === node.id.split(".")[1]
    && functionSpec.semantic_source?.level === node.level
    && functionSpec.semantic_source?.node_type === node.node_type
    && functionSpec.semantic_source?.problem === node.problem_solved
    && functionSpec.semantic_source?.purpose === node.purpose
    && semanticFunctionHash(functionSpec) === functionSpec.semantic_function_hash
    && canonicalHash(functionSpec.execution_plan) === functionSpec.execution_plan_hash
    && canonicalHash(functionSpec.semantic_assertions) === functionSpec.observation_contract_hash
    && binding.registry_hash === registryHash
    && binding.source_row_hash === functionSpec.source_row_hash
    && binding.semantic_function_hash === functionSpec.semantic_function_hash
    && binding.execution_plan_hash === functionSpec.execution_plan_hash
    && binding.observation_contract_hash === functionSpec.observation_contract_hash;
}

function assertionObservationValid(actual, expected, expectedResult, evidenceById) {
  if (!isPlainObject(actual) || !isPlainObject(expected)) return false;
  if (!exactKeys(actual, [
    "subject",
    "predicate",
    "object",
    "polarity",
    "key",
    "result",
    "evidence_ids",
  ])) return false;
  const expectedBody = {
    subject: expected.subject,
    predicate: expected.predicate,
    object: expected.object,
    polarity: expected.polarity,
  };
  if (
    expected.key !== canonicalHash(expectedBody)
    || actual.key !== expected.key
    || actual.subject !== expected.subject
    || actual.predicate !== expected.predicate
    || actual.object !== expected.object
    || actual.polarity !== expected.polarity
    || actual.result !== expectedResult
    || !Array.isArray(actual.evidence_ids)
    || actual.evidence_ids.length === 0
    || new Set(actual.evidence_ids).size !== actual.evidence_ids.length
  ) return false;
  return actual.evidence_ids.every((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    return evidence && Array.isArray(evidence.content?.facts) && evidence.content.facts.includes(expected.object);
  });
}

function semanticObservationValid(record, functionSpec, evidence) {
  const observation = record?.semantic_observation;
  const assertions = functionSpec?.semantic_assertions;
  if (!isPlainObject(observation) || !isPlainObject(assertions)) return false;
  if (!exactKeys(observation, [
    "function_hash",
    "problem_resolution",
    "evidence_support",
    "failure_absence",
    "boundary_preservation",
    "artifact_refs",
  ])) return false;
  const evidenceById = new Map(evidence.map((item) => [item.evidence_id, item]));
  const exactAssertionArray = (actual, expected, result) => (
    Array.isArray(actual)
    && actual.length === expected.length
    && new Set(actual.map((item) => item.key)).size === actual.length
    && actual.every((item, index) => assertionObservationValid(item, expected[index], result, evidenceById))
  );
  return observation.function_hash === functionSpec.semantic_function_hash
    && assertionObservationValid(
      observation.problem_resolution,
      assertions.problem_resolution,
      "resolved",
      evidenceById
    )
    && exactAssertionArray(observation.evidence_support, assertions.evidence_support, "supported")
    && exactAssertionArray(observation.failure_absence, assertions.failure_absence, "not_observed")
    && assertionObservationValid(
      observation.boundary_preservation,
      assertions.boundary_preservation,
      "preserved",
      evidenceById
    )
    && Array.isArray(observation.artifact_refs)
    && observation.artifact_refs.length > 0
    && observation.artifact_refs.every((artifact) => (
      exactKeys(artifact, ["ref", "sha256"])
      && String(artifact.ref || "").length >= 4
      && /^[a-f0-9]{64}$/.test(String(artifact.sha256 || ""))
    ));
}

function evidenceAcceptanceRule(program) {
  return `Execute ${program.kind} ${canonicalHash(program)}: require the exact claim, content tag, subject, record and Core manifest bindings for capability spec ${program.capability_spec_hash}.`;
}

function strategyRule(program) {
  return `Execute ${program.kind} ${canonicalHash(program)}: select only when ${program.all.join(", ")}; otherwise ${program.on_false}.`;
}

function verifierCondition(program) {
  return `Execute ${program.kind} ${canonicalHash(program)} and require every independent check: ${program.all.join(", ")}.`;
}

function metricDefinition(program) {
  return `Execute ${program.kind} ${canonicalHash(program)}: compute ${program.formula} from ${program.source_fields.join(", ")} and require ${program.threshold_operator} ${program.target} ${program.unit} for capability spec ${program.capability_spec_hash}.`;
}

function evidenceManifestPayload({ tenantId, node, capabilityInput, evidence }) {
  return {
    issuer: "universal_core",
    tenant_id: tenantId,
    node_id: node.id,
    branch_id: node.branch_id,
    semantic_hash: node.semantic_contract.semantic_hash,
    function_registry_hash: node.function_binding.registry_hash,
    semantic_function_hash: node.function_binding.semantic_function_hash,
    capability_input_hash: canonicalHash(capabilityInput),
    evidence_hashes: evidence.map((item) => item.provenance_hash),
  };
}

function policySnapshotPayload({ tenantId, node, binding, decision, evidenceManifestHash }) {
  return {
    issuer: "universal_core",
    tenant_id: tenantId,
    node_id: node.id,
    branch_id: node.branch_id,
    policy_id: binding.policy_id,
    effect: binding.effect,
    decision: decision.decision,
    semantic_hash: node.semantic_contract.semantic_hash,
    function_registry_hash: node.function_binding.registry_hash,
    semantic_function_hash: node.function_binding.semantic_function_hash,
    evidence_manifest_hash: evidenceManifestHash,
  };
}

function conditionMatches(condition, signals) {
  const actual = signals[condition.signal];
  const expected = condition.expected;
  switch (condition.operator) {
    case "equals": return actual === expected;
    case "not_equals": return actual !== expected;
    case "includes": return Array.isArray(actual) && actual.includes(expected);
    case "excludes": return Array.isArray(actual) && !actual.includes(expected);
    case "exists": return actual !== undefined && actual !== null;
    case "not_exists": return actual === undefined || actual === null;
    case "gt": return Number(actual) > Number(expected);
    case "gte": return Number(actual) >= Number(expected);
    case "lt": return Number(actual) < Number(expected);
    case "lte": return Number(actual) <= Number(expected);
    case "all": return Array.isArray(actual) && Array.isArray(expected) && expected.every((item) => actual.includes(item));
    case "any": return Array.isArray(actual) && Array.isArray(expected) && expected.some((item) => actual.includes(item));
    default: return false;
  }
}

function executeCapabilityMethod(node, method, capabilityInput, evidence, functionSpec) {
  const records = Array.isArray(capabilityInput?.records) ? capabilityInput.records : [];
  const validRecords = records.filter((record) => ["valid", "allowed", "verified"].includes(record.status));
  const failureFlags = records
    .filter((record) => !["valid", "allowed", "verified"].includes(record.status))
    .map((record) => `invalid_record:${record.id}`);
  const evidenceFacts = evidence.flatMap((item) => Array.isArray(item.content?.facts) ? item.content.facts : []);
  const parameters = method.parameters || {};
  const program = method.program || {};
  const expectedConsume = [
    "capability_spec_hash",
    "problem_statement",
    "subject",
    "records.id",
    "records.semantic_observation",
    "records.claim_hash",
    "records.status",
    "records.observed_at",
    "records.relations",
    "records.failure_signals",
  ];
  const programValid = exactKeys(program, [
    "kind",
    "capability_spec_hash",
    "record_claim_hash",
    "semantic_function_hash",
    "execution_plan_hash",
    "operation",
    "role_projection",
    "input_field",
    "output_field",
    "consume",
    "transform",
  ])
    && program.kind === "capability_method_program_v2"
    && program.capability_spec_hash === parameters.capability_spec_hash
    && program.record_claim_hash === parameters.record_claim_hash
    && program.semantic_function_hash === functionSpec?.semantic_function_hash
    && program.execution_plan_hash === functionSpec?.execution_plan_hash
    && program.operation === method.operation
    && inferOperationFromBasis(functionSpec?.semantic_source) === method.operation
    && functionSpec?.execution_plan?.operation === method.operation
    && program.role_projection === functionSpec?.execution_plan?.role_projection
    && canonicalHash(functionSpec?.semantic_assertions) === program.record_claim_hash
    && program.input_field === method.input_field
    && program.output_field === method.output_field
    && JSON.stringify(program.consume) === JSON.stringify(expectedConsume)
    && exactKeys(program.transform, [
      "kind",
      "record_value_digest_required",
      "evidence_digest_required",
      "failure_detector_required",
    ])
    && program.transform.kind === "record_digest_projection_v1"
    && program.transform.record_value_digest_required === true
    && program.transform.evidence_digest_required === true
    && program.transform.failure_detector_required === true;
  if (!programValid) failureFlags.push("method_program_invalid");
  const observationValidity = validRecords.map((record) => (
    semanticObservationValid(record, functionSpec, evidence)
  ));
  for (const [index, record] of validRecords.entries()) {
    if (!observationValidity[index]) {
      failureFlags.push(`record_value_semantics_mismatch:${record.id}`);
    }
  }
  const inputEvidenceTags = [...(capabilityInput?.evidence_requirement_tags || [])].sort();
  const expectedEvidenceTags = [...(parameters.evidence_tags || [])].sort();
  const inputFailureModes = [...(capabilityInput?.failure_mode_candidates || [])].sort();
  const expectedFailureModes = [...(parameters.failure_mode_ids || [])].sort();
  for (const record of records) {
    for (const signal of record.failure_signals || []) failureFlags.push(`declared_failure_signal:${signal}`);
    if (record.claim_hash !== parameters.record_claim_hash) failureFlags.push(`record_claim_mismatch:${record.id}`);
  }
  const parametersMatch = capabilityInput?.mechanism_id === parameters.mechanism_id
    && capabilityInput?.capability_spec_hash === parameters.capability_spec_hash
    && parameters.capability_spec_hash === node.semantic_contract?.capability_spec_hash
    && parameters.record_claim_hash === node.semantic_contract?.record_claim_hash
    && parameters.capability_id === node.id
    && parameters.capability_id === node.semantic_contract?.capability_id
    && parameters.mechanism_id === node.semantic_contract?.mechanism_id
    && method.operation === node.semantic_contract?.operation
    && String(parameters.mechanism_id || "").startsWith(`${method.operation}:${node.node_type}:`)
    && parameters.problem_hash === textHash(node.problem_solved)
    && parameters.problem_hash === textHash(capabilityInput?.problem_statement)
    && canonicalHash(String(parameters.transformation_goal || "")) === node.semantic_contract?.transformation_goal_hash
    && parameters.transformation_goal === node.purpose
    && programValid
    && JSON.stringify(inputEvidenceTags) === JSON.stringify(expectedEvidenceTags)
    && JSON.stringify(inputFailureModes) === JSON.stringify(expectedFailureModes);
  if (!parametersMatch) failureFlags.push("capability_parameters_mismatch");
  const goalHash = canonicalHash(String(parameters.transformation_goal || ""));
  let finding = "";
  switch (method.operation) {
    case "deny_first_governance":
      finding = `subject=${capabilityInput.subject};allowed_records=${validRecords.length};denied_records=${failureFlags.length}`;
      break;
    case "bitemporal_reconciliation": {
      const timestamps = validRecords.map((record) => Date.parse(record.observed_at)).filter(Number.isFinite);
      if (timestamps.length !== validRecords.length) failureFlags.push("invalid_observation_time");
      finding = `subject=${capabilityInput.subject};valid_intervals=${timestamps.length};earliest=${Math.min(...timestamps)};latest=${Math.max(...timestamps)}`;
      break;
    }
    case "claim_evidence_reconciliation":
      finding = `subject=${capabilityInput.subject};supported_evidence=${evidence.length};facts=${evidenceFacts.length};records=${validRecords.length}`;
      break;
    case "constraint_graph_resolution": {
      const edgeCount = validRecords.reduce((sum, record) => sum + (Array.isArray(record.relations) ? record.relations.length : 0), 0);
      finding = `subject=${capabilityInput.subject};graph_nodes=${validRecords.length};graph_edges=${edgeCount};blocked_nodes=${failureFlags.length}`;
      break;
    }
    case "oracle_driven_verification":
      finding = `subject=${capabilityInput.subject};verified_records=${validRecords.length};failed_oracles=${failureFlags.length};evidence=${evidence.length}`;
      break;
    case "outcome_bounded_learning":
      finding = `subject=${capabilityInput.subject};outcome_records=${validRecords.length};counterexamples=${failureFlags.length};evidence=${evidence.length}`;
      break;
    case "semantic_invariance_transformation": {
      const tokenCount = validRecords.reduce((sum, record) => (
        sum + JSON.stringify(record.semantic_observation || {}).split(/\s+/).filter(Boolean).length
      ), 0);
      finding = `subject=${capabilityInput.subject};preserved_records=${validRecords.length};preserved_tokens=${tokenCount};semantic_failures=${failureFlags.length}`;
      break;
    }
    case "financial_ledger_reconciliation": {
      const numericValues = [];
      finding = `subject=${capabilityInput.subject};ledger_records=${validRecords.length};numeric_records=${numericValues.length};reconciled_total=${numericValues.reduce((sum, value) => sum + value, 0)}`;
      break;
    }
    case "subject_measurement_validation":
      finding = `subject=${capabilityInput.subject};valid_measurements=${validRecords.length};invalid_measurements=${failureFlags.length};evidence=${evidence.length}`;
      break;
    case "artifact_graph_analysis": {
      const artifactHashes = validRecords.map((record) => canonicalHash({
        id: record.id,
        semantic_observation: record.semantic_observation,
      }));
      finding = `subject=${capabilityInput.subject};artifacts=${validRecords.length};artifact_hashes=${artifactHashes.join(",")}`;
      break;
    }
    case "bounded_state_transformation":
      finding = `subject=${capabilityInput.subject};transformed_records=${validRecords.length};rejected_records=${failureFlags.length};evidence=${evidence.length}`;
      break;
    default:
      return {
        method_id: method.id,
        operation: method.operation,
        passed: false,
        valid: false,
        finding: "",
        failure_flags: ["unsupported_method_operation"],
        records,
        valid_records: 0,
        input_consumed: false,
      };
  }
  const recordValueDigest = canonicalHash(records.map((record) => ({
    id: record.id,
    semantic_observation: record.semantic_observation,
    claim_hash: record.claim_hash,
    status: record.status,
    relations: record.relations,
  })));
  const evidenceDigest = canonicalHash(evidence.map((item) => item.provenance_hash));
  finding = `capability=${parameters.capability_id};goal_hash=${goalHash};record_value_digest=${recordValueDigest};evidence_digest=${evidenceDigest};${finding}`;
  return {
    method_id: method.id,
    operation: method.operation,
    passed: parametersMatch && validRecords.length > 0 && failureFlags.length === 0 && finding.length >= 8,
    valid: parametersMatch && validRecords.length > 0 && failureFlags.length === 0 && finding.length >= 8,
    finding,
    failure_flags: failureFlags,
    records,
    valid_records: validRecords.length,
    input_consumed: true,
    parameters_match: parametersMatch,
    input_hash: canonicalHash(capabilityInput),
    evidence_fact_count: evidenceFacts.length,
    record_value_digest: recordValueDigest,
    evidence_digest: evidenceDigest,
    semantic_observation_valid: observationValidity.length > 0 && observationValidity.every(Boolean),
    executed_steps: [...method.steps],
    termination: method.termination,
  };
}

function metricValue(metric, stats) {
  const divide = (numerator, denominator) => denominator > 0 ? numerator / denominator : 0;
  switch (metric.formula) {
    case "verified_assertions/total_assertions":
      return divide(stats.verified_assertions, stats.total_assertions);
    case "1-(verified_assertions/total_assertions)":
      return 1 - divide(stats.verified_assertions, stats.total_assertions);
    case "supported_evidence/required_evidence":
      return divide(stats.supported_evidence, stats.required_evidence);
    case "escaped_failures/declared_failure_modes":
      return divide(stats.escaped_failures, stats.declared_failure_modes);
    case "valid_records/total_records":
      return divide(stats.valid_records, stats.total_records);
    case "invalid_records/total_records":
      return divide(stats.invalid_records, stats.total_records);
    default:
      return Number.NaN;
  }
}

function evaluateNode({
  node,
  tenantId,
  subbranchId,
  corePayload,
  evidence = [],
  evidenceSource = "",
  capabilityInput = null,
  functionSpec = null,
  functionRegistryHash = "",
  parentEvaluations = new Map(),
  requestId = "",
  observedAt = Date.now(),
} = {}) {
  if (!node || !tenantId) {
    return {
      node_id: node?.id || null,
      state: "denied_invalid_runtime_context",
      execution_authorized: false,
      core_final_authority: true,
    };
  }
  const nodeSubbranchId = node.id.split(".")[1];
  const opened = openedBranchIds(corePayload);
  const coreTenantId = String(corePayload?.tenant_id || corePayload?.result?.tenant_id || "");
  const base = {
    node_id: node.id,
    branch_id: node.branch_id,
    subbranch_id: nodeSubbranchId,
    contract_version: node.version,
    execution_authorized: false,
    core_final_authority: true,
    fallback_node: node.fallback_node,
  };
  if (!semanticContractValid(node)) {
    return { ...base, state: "fallback_semantic_contract_invalid", reason_codes: ["semantic_contract_integrity_failed"] };
  }
  if (!semanticFunctionValid(node, functionSpec, functionRegistryHash)) {
    return {
      ...base,
      state: "catalog_contract_rejected_v1_authoritative",
      reason_codes: ["function_registry_binding_mismatch"],
    };
  }
  if (!opened.includes(node.branch_id)) {
    return { ...base, state: "not_activated_core_branch_closed", reason_codes: ["core_branch_not_opened"] };
  }
  if (!coreTenantId || coreTenantId !== tenantId) {
    return { ...base, state: "denied_core_tenant_mismatch", reason_codes: ["core_tenant_mismatch"] };
  }
  if (String(subbranchId || "") !== nodeSubbranchId) {
    return { ...base, state: "not_activated_subbranch_mismatch", reason_codes: ["subbranch_not_requested"] };
  }
  if (!["authenticated_core", "tenant_evidence_store", "verified_fixture"].includes(String(evidenceSource || ""))) {
    return { ...base, state: "denied_untrusted_evidence_source", reason_codes: ["evidence_source_not_authenticated"] };
  }
  const foreignEvidence = evidence.filter((item) => String(item?.tenant_id || "") !== tenantId);
  if (foreignEvidence.length) {
    return {
      ...base,
      state: "denied_tenant_isolation",
      reason_codes: ["cross_tenant_evidence"],
      rejected_evidence_count: foreignEvidence.length,
    };
  }
  if (node.level > 2 && parentEvaluations.get(node.parent_id)?.state !== "advisory_verified") {
    return { ...base, state: "fallback_parent_not_verified", reason_codes: ["parent_contract_not_verified"] };
  }
  const methodContract = node.methods?.[0];
  const capabilityField = String(methodContract?.input_field || "");
  const runtimeInput = {
    tenant_id: tenantId,
    core_route: { opened_branch_id: node.branch_id },
    evidence_bundle: evidence,
    ...(capabilityField ? { [capabilityField]: capabilityInput } : {}),
  };
  const inputValid = Boolean(
    capabilityField
    && isPlainObject(capabilityInput)
    && schemaValueValid(node.input_schema, runtimeInput)
    && runtimeInput.tenant_id === tenantId
    && runtimeInput.core_route.opened_branch_id === node.branch_id
  );
  if (!inputValid) {
    return { ...base, state: "fallback_invalid_capability_input", reason_codes: ["capability_input_schema_failed"] };
  }
  const requiredEvidenceTypes = new Set(node.required_evidence.map((requirement) => requirement.evidence_type));
  const nodeEvidence = evidence.filter((item) => requiredEvidenceTypes.has(item.evidence_type));
  const expectedManifestPayload = evidenceManifestPayload({
    tenantId,
    node,
    capabilityInput,
    evidence: nodeEvidence,
  });
  const coreEvidenceManifest = corePayload?.result?.evidence_manifests?.[node.id]
    || corePayload?.evidence_manifests?.[node.id]
    || corePayload?.result?.evidence_manifest
    || corePayload?.evidence_manifest;
  const evidenceManifestValid = isPlainObject(coreEvidenceManifest)
    && exactKeys(coreEvidenceManifest, [
      "issuer",
      "tenant_id",
      "node_id",
      "branch_id",
      "semantic_hash",
      "function_registry_hash",
      "semantic_function_hash",
      "capability_input_hash",
      "evidence_hashes",
      "manifest_hash",
    ])
    && coreEvidenceManifest.manifest_hash === canonicalHash(expectedManifestPayload)
    && Object.entries(expectedManifestPayload).every(([key, value]) => (
      JSON.stringify(coreEvidenceManifest[key]) === JSON.stringify(value)
    ));
  if (!evidenceManifestValid) {
    return {
      ...base,
      state: "denied_core_evidence_manifest_invalid",
      reason_codes: ["core_evidence_manifest_missing_or_invalid"],
    };
  }
  const now = Number(observedAt);
  const requirementResults = node.required_evidence.map((requirement) => {
    const program = requirement.acceptance_program || {};
    const acceptanceProgramValid = exactKeys(program, [
      "kind",
      "capability_spec_hash",
      "required_claim_hash",
      "required_claim",
      "required_content_tag",
      "require_fact_equal_to_claim",
      "require_subject_binding",
      "require_record_binding",
      "require_core_manifest_binding",
    ])
      && program.kind === "evidence_claim_gate_v1"
      && program.capability_spec_hash === node.semantic_contract.capability_spec_hash
      && program.required_claim_hash === requirement.semantic_claim_hash
      && program.required_claim === requirement.description
      && program.required_content_tag === requirement.content_tag
      && program.require_fact_equal_to_claim === true
      && program.require_subject_binding === true
      && program.require_record_binding === true
      && program.require_core_manifest_binding === true
      && requirement.acceptance_rule === evidenceAcceptanceRule(program);
    const candidates = evidence.filter((item) => (
      exactKeys(item, [
        "evidence_id",
        "evidence_type",
        "tenant_id",
        "authority",
        "independent",
        "content_tags",
        "content",
        "observed_at",
        "payload_hash",
        "provenance_hash",
      ])
      && item.evidence_type === requirement.evidence_type
      && isPlainObject(item.content)
      && exactKeys(item.content, [
        "source_ref",
        "facts",
        "tags",
        "claim",
        "claim_hash",
        "semantic_hash",
        "capability_input_hash",
        "subject_hash",
        "record_hashes",
      ])
      && acceptanceProgramValid
      && Array.isArray(item.content.tags)
      && item.content.tags.includes(requirement.content_tag)
      && requirement.content_fields.every((field) => Object.hasOwn(item.content, field))
      && item.content.semantic_hash === node.semantic_contract.semantic_hash
      && item.content.capability_input_hash === canonicalHash(capabilityInput)
      && item.content.subject_hash === canonicalHash(capabilityInput.subject)
      && item.content.claim_hash === requirement.semantic_claim_hash
      && item.content.claim === requirement.description
      && JSON.stringify(item.content.record_hashes) === JSON.stringify(
        capabilityInput.records.map((record) => canonicalHash(record))
      )
    ));
    const authorityMatches = candidates.filter((item) => evidenceAuthorityMatches(requirement, item));
    const contentMatches = authorityMatches.filter((item) => (
      Array.isArray(item.content.facts)
      && item.content.facts.length > 0
      && item.content.facts.every((fact) => String(fact).trim().length >= 8)
      && item.content.facts.includes(requirement.description)
      && item.payload_hash === canonicalHash(item.content)
    ));
    const provenanceMatches = contentMatches.filter((item) => (
      /^[a-f0-9]{64}$/.test(String(item.provenance_hash || ""))
      && item.provenance_hash === evidenceProvenanceHash(item)
    ));
    const matches = provenanceMatches.filter((item) => {
      const observed = Date.parse(String(item.observed_at || ""));
      const fresh = Number.isFinite(observed) && now - observed <= requirement.freshness_seconds * 1000 && observed <= now + 60_000;
      return fresh;
    });
    return {
      evidence_type: requirement.evidence_type,
      required: requirement.minimum_count,
      candidates: candidates.length,
      authority_matched: authorityMatches.length,
      content_matched: contentMatches.length,
      provenance_matched: provenanceMatches.length,
      matched: matches.length,
      passed: matches.length >= requirement.minimum_count,
      acceptance_program_valid: acceptanceProgramValid,
    };
  });
  const evidenceCoverage = requirementResults.length
    ? requirementResults.filter((result) => result.passed).length / requirementResults.length
    : 0;
  const authorityCompliance = requirementResults.length
    ? requirementResults.filter((result) => result.authority_matched >= result.required).length / requirementResults.length
    : 0;
  const freshnessCompliance = requirementResults.length
    ? requirementResults.filter((result) => result.matched >= result.required).length / requirementResults.length
    : 0;
  const evidenceContentVerified = requirementResults.every((result) => (
    result.content_matched >= result.required && result.provenance_matched >= result.required
  ));
  const signals = {
    "core.route.opened_branches": opened,
    "request.subbranch_id": subbranchId,
    [`capability.${node.id.split(".")[3] || node.id.split(".")[2]}.evidence_ready`]: evidenceCoverage === 1 && evidenceContentVerified,
  };
  for (const condition of [...node.activation_conditions, ...node.non_activation_conditions]) {
    if (condition.signal.includes(".evidence_ready")) {
      signals[condition.signal] = evidenceCoverage === 1 && evidenceContentVerified;
    }
  }
  const activationPassed = node.activation_conditions.every((condition) => conditionMatches(condition, signals));
  const nonActivationTriggered = node.non_activation_conditions.some((condition) => conditionMatches(condition, signals));
  if (!activationPassed || nonActivationTriggered || evidenceCoverage < 1 || !evidenceContentVerified) {
    const requiresReview = node.risk_class === "high" || node.risk_class === "critical";
    return {
      ...base,
      state: requiresReview ? "human_review_required_contract_not_activated" : "fallback_contract_not_activated",
      reason_codes: ["activation_or_evidence_contract_not_satisfied"],
      activation_passed: activationPassed,
      non_activation_triggered: nonActivationTriggered,
      evidence_coverage: evidenceCoverage,
      evidence_results: requirementResults,
    };
  }
  const expectedConfidenceFormula = "0.50*evidence_coverage+0.20*authority_compliance+0.15*freshness_compliance+0.15*input_validity";
  if (node.confidence_method?.formula !== expectedConfidenceFormula) {
    return { ...base, state: "fallback_confidence_formula_invalid", reason_codes: ["unsupported_confidence_formula"] };
  }
  const confidence = Number((
    evidenceCoverage * 0.5
    + authorityCompliance * 0.2
    + freshnessCompliance * 0.15
    + (inputValid ? 1 : 0) * 0.15
  ).toFixed(4));
  if (confidence < node.confidence_threshold) {
    return {
      ...base,
      state: "human_review_required_low_confidence",
      reason_codes: ["confidence_below_threshold"],
      confidence,
      confidence_threshold: node.confidence_threshold,
    };
  }
  const policyDecisions = corePayload?.result?.policy_decisions || corePayload?.policy_decisions || [];
  const policyResults = node.core_policy_bindings.map((binding) => {
    const decision = policyDecisions.find((candidate) => (
      candidate.policy_id === binding.policy_id
      && candidate.effect === binding.effect
      && candidate.snapshot?.node_id === node.id
    ));
    const expectedOnDeny = ["high", "critical"].includes(node.risk_class) ? "human_review" : "abstain";
    const expectedSnapshot = decision
      ? policySnapshotPayload({
          tenantId,
          node,
          binding,
          decision,
          evidenceManifestHash: coreEvidenceManifest.manifest_hash,
        })
      : null;
    return {
      policy_id: binding.policy_id,
      passed: binding.core_decision_required === true
        && decision?.decision === "ALLOW"
        && binding.on_deny === expectedOnDeny
        && exactKeys(decision, ["policy_id", "effect", "decision", "snapshot", "snapshot_hash"])
        && isPlainObject(decision?.snapshot)
        && exactKeys(decision.snapshot, [
          "issuer",
          "tenant_id",
          "node_id",
          "branch_id",
          "policy_id",
          "effect",
          "decision",
          "semantic_hash",
          "function_registry_hash",
          "semantic_function_hash",
          "evidence_manifest_hash",
        ])
        && Object.entries(expectedSnapshot || {}).every(([key, value]) => decision.snapshot[key] === value)
        && decision.snapshot_hash === canonicalHash(expectedSnapshot)
        && (binding.policy_id !== "tenant_isolation" || coreTenantId === tenantId),
      enforcement_point: binding.enforcement_point,
      snapshot_hash: decision?.snapshot_hash || null,
    };
  });
  if (policyResults.some((result) => !result.passed)) {
    return {
      ...base,
      state: "fallback_core_policy_denied_or_missing",
      reason_codes: ["core_policy_not_allowed"],
      policy_results: policyResults,
    };
  }
  const methodResults = node.methods.map((method) => (
    executeCapabilityMethod(node, method, capabilityInput, nodeEvidence, functionSpec)
  ));
  const strategySignals = {
    "method.valid": methodResults.every((result) => result.valid),
    "semantic_observation.valid": methodResults.every((result) => result.semantic_observation_valid),
    "evidence.coverage_eq_1": evidenceCoverage === 1,
    "policy.allows": policyResults.every((result) => result.passed),
    "input.valid": inputValid,
  };
  const strategyResults = node.strategies.map((strategy) => {
    const program = strategy.predicate_program || {};
    const programValid = exactKeys(program, [
      "kind",
      "capability_spec_hash",
      "semantic_function_hash",
      "all",
      "decision_cases",
      "on_false",
    ])
      && program.kind === "strategy_gate_v1"
      && program.capability_spec_hash === node.semantic_contract.capability_spec_hash
      && program.semantic_function_hash === functionSpec.semantic_function_hash
      && Array.isArray(program.all)
      && JSON.stringify(program.all) === JSON.stringify([
        "method.valid",
        "semantic_observation.valid",
        "evidence.coverage_eq_1",
        "policy.allows",
        "input.valid",
      ])
      && JSON.stringify(program.decision_cases) === JSON.stringify(functionSpec.execution_plan.strategy_cases)
      && program.on_false === strategy.failure_transition
      && strategy.selection_rule === strategyRule(program);
    return {
      strategy_id: strategy.id,
      selected: programValid
        && strategy.selection_predicate === "method.valid&&semantic_observation.valid&&evidence.coverage==1&&policy.allows&&input.valid"
        && canonicalHash(strategy.selection_rule) === node.semantic_contract.strategy_rule_hash
        && program.all.every((signal) => strategySignals[signal] === true),
      selection_rule: strategy.selection_rule,
      selection_predicate: strategy.selection_predicate,
      failure_transition: strategy.failure_transition,
      program_valid: programValid,
    };
  });
  if (
    methodResults.some((result) => !result.passed)
    || strategyResults.some((result) => !result.selected)
    || policyResults.some((result) => !result.passed)
  ) {
    return {
      ...base,
      state: "fallback_method_strategy_or_policy_failed",
      reason_codes: ["method_strategy_or_policy_failed"],
      method_results: methodResults,
      strategy_results: strategyResults,
      policy_results: policyResults,
    };
  }
  const primaryMethodResult = methodResults[0];
  const output = outputFromSchema(node, confidence, nodeEvidence, primaryMethodResult);
  const verifierResults = node.verifiers.map((verifier) => {
    const checks = {
      output_schema_valid: schemaValueValid(node.output_schema, output),
      input_consumed: methodResults.every((result) => result.input_consumed),
      semantic_observation_verified: methodResults.every((result) => result.semantic_observation_valid),
      function_registry_bound: semanticFunctionValid(node, functionSpec, functionRegistryHash),
      evidence_content_verified: evidenceContentVerified,
      evidence_hashes_verified: requirementResults.every((result) => result.provenance_matched >= result.required),
      policy_allows: policyResults.every((result) => result.passed),
      method_valid: methodResults.every((result) => result.valid),
      strategy_selected: strategyResults.every((result) => result.selected),
      failure_flags_empty: methodResults.every((result) => result.failure_flags.length === 0),
      finding_not_contract_text: methodResults.every((result) => result.finding && result.finding !== node.purpose),
    };
    const program = verifier.predicate_program || {};
    const verifierProgramValid = exactKeys(program, [
      "kind",
      "capability_spec_hash",
      "semantic_function_hash",
      "semantic_assertion_keys",
      "all",
    ])
      && program.kind === "verifier_gate_v1"
      && program.capability_spec_hash === node.semantic_contract.capability_spec_hash
      && program.semantic_function_hash === functionSpec.semantic_function_hash
      && JSON.stringify(program.semantic_assertion_keys) === JSON.stringify(
        functionSpec.execution_plan.verifier_assertion_keys
      )
      && JSON.stringify(program.all) === JSON.stringify(REQUIRED_VERIFIER_CHECKS)
      && verifier.pass_condition === verifierCondition(program);
    const passConditionBound = verifierProgramValid
      && canonicalHash(verifier.pass_condition) === node.semantic_contract.verifier_pass_condition_hash;
    const declaredChecksValid = Array.isArray(verifier.checks)
      && new Set(verifier.checks).size === REQUIRED_VERIFIER_CHECKS.length
      && JSON.stringify([...verifier.checks].sort()) === JSON.stringify([...REQUIRED_VERIFIER_CHECKS].sort())
      && verifier.checks.every((check) => Object.hasOwn(checks, check));
    return {
      verifier_id: verifier.id,
      passed: passConditionBound
        && declaredChecksValid
        && program.all.every((check) => checks[check])
        && verifier.checks.every((check) => checks[check]),
      verifier_type: verifier.verifier_type,
      checks,
      program_valid: verifierProgramValid,
    };
  });
  const verified = verifierResults.every((result) => result.passed);
  const allAssertions = verifierResults.flatMap((result) => Object.values(result.checks));
  const stats = {
    verified_assertions: allAssertions.filter(Boolean).length,
    total_assertions: allAssertions.length,
    supported_evidence: requirementResults.filter((result) => result.passed).length,
    required_evidence: requirementResults.length,
    escaped_failures: primaryMethodResult.failure_flags.length,
    declared_failure_modes: node.failure_modes.length,
    valid_records: primaryMethodResult.valid_records,
    invalid_records: primaryMethodResult.records.length - primaryMethodResult.valid_records,
    total_records: primaryMethodResult.records.length,
  };
  const metricResults = node.metrics.map((metric) => {
    const program = metric.formula_program || {};
    const programValid = exactKeys(program, [
      "kind",
      "capability_spec_hash",
      "semantic_function_hash",
      "population",
      "formula",
      "source_fields",
      "threshold_operator",
      "target",
      "unit",
    ])
      && program.kind === "metric_formula_v1"
      && program.capability_spec_hash === node.semantic_contract.capability_spec_hash
      && program.semantic_function_hash === functionSpec.semantic_function_hash
      && JSON.stringify(program.population) === JSON.stringify(functionSpec.execution_plan.metric_population)
      && program.formula === metric.formula
      && JSON.stringify(program.source_fields) === JSON.stringify(metric.source_fields)
      && program.threshold_operator === metric.threshold_operator
      && program.target === metric.target
      && program.unit === metric.unit
      && metric.definition === metricDefinition(program);
    const value = metricValue(program, stats);
    const expectedSources = METRIC_FORMULA_SOURCES[metric.formula] || [];
    const sourceFieldsValid = JSON.stringify([...metric.source_fields].sort()) === JSON.stringify([...expectedSources].sort())
      && metric.source_fields.every((field) => Object.hasOwn(stats, field));
    const definitionValid = programValid
      && canonicalHash(metric.definition) === node.semantic_contract.metric_definition_hash;
    return {
      metric_id: metric.id,
      value,
      unit: metric.unit,
      target: metric.target,
      formula: metric.formula,
      program_valid: programValid,
      passed: sourceFieldsValid && definitionValid && Number.isFinite(value) && (metric.threshold_operator === "lte"
        ? value <= metric.target
        : metric.threshold_operator === "eq"
          ? value === metric.target
          : value >= metric.target),
    };
  });
  if (!verified || metricResults.some((metric) => !metric.passed)) {
    return {
      ...base,
      state: "fallback_verification_failed",
      reason_codes: ["verifier_or_metric_failed"],
      output,
      verifier_results: verifierResults,
      metric_results: metricResults,
    };
  }
  output.verifier_results = verifierResults.map((result) => `${result.verifier_id}:${result.passed ? "pass" : "fail"}`);
  output.route_decision = "continue";
  return {
    ...base,
    state: "advisory_verified",
    reason_codes: ["contract_satisfied"],
    confidence,
    confidence_threshold: node.confidence_threshold,
    output,
    method_results: methodResults,
    strategy_results: strategyResults,
    policy_results: policyResults,
    verifier_results: verifierResults,
    metric_results: metricResults,
    audit: {
      tenant_id: tenantId,
      request_id: String(requestId || ""),
      node_id: node.id,
      contract_version: node.version,
      core_verdict: "branch_opened_advisory_only",
      timestamp: new Date(now).toISOString(),
      reason_codes: ["contract_satisfied"],
    },
    provenance: {
      contract_hash: canonicalHash(node),
      evidence_hashes: nodeEvidence.map((item) => item.provenance_hash),
      route_trace: opened,
      source_refs: node.required_evidence.map((item) => item.evidence_type),
      policy_snapshot_hash: canonicalHash(policyResults.map((result) => ({
        policy_id: result.policy_id,
        snapshot_hash: result.snapshot_hash,
      }))),
    },
  };
}

function topologyMetrics(catalog) {
  const levelCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const level4TypeCounts = Object.fromEntries(REQUIRED_LEVEL4_TYPES.map((type) => [type, 0]));
  for (const branch of catalog?.branches || []) levelCounts[1] += branch.subbranches?.length || 0;
  for (const node of catalog?.nodes || []) {
    if (Object.hasOwn(levelCounts, node.level)) levelCounts[node.level] += 1;
    if (node.level === 4 && Object.hasOwn(level4TypeCounts, node.node_type)) level4TypeCounts[node.node_type] += 1;
  }
  return {
    branch_count: catalog?.branches?.length || 0,
    subbranch_count: levelCounts[1],
    node_count: catalog?.nodes?.length || 0,
    level_counts: levelCounts,
    level4_type_counts: level4TypeCounts,
  };
}

function featureFlags(env = process.env, tenantId = "") {
  const enabled = new Set(["true", "1", "yes"]).has(String(env.NYRA_DEEP_BRANCH_V2_ENABLED || "false").toLowerCase());
  const requestedMode = String(env.NYRA_DEEP_BRANCH_V2_MODE || (enabled ? "shadow" : "disabled")).toLowerCase();
  const mode = enabled && VALID_MODES.has(requestedMode) ? requestedMode : "disabled";
  const branchAllowlist = uniqueStrings(env.NYRA_DEEP_BRANCH_V2_BRANCHES);
  const tenantAllowlist = uniqueStrings(env.NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST);
  const tenantAllowed = tenantAllowlist.length > 0 && tenantAllowlist.includes(String(tenantId || ""));
  const branchesConfigured = branchAllowlist.length > 0;
  return {
    enabled: enabled && mode !== "disabled" && tenantAllowed && branchesConfigured,
    mode: enabled && tenantAllowed && branchesConfigured ? mode : "disabled",
    branch_allowlist: branchAllowlist,
    branch_allowlist_configured: branchesConfigured,
    tenant_allowlist_configured: tenantAllowlist.length > 0,
    tenant_allowed: tenantAllowed,
    feature_flag: "NYRA_DEEP_BRANCH_V2_ENABLED",
    rollback: "Set NYRA_DEEP_BRANCH_V2_ENABLED=false; the V1 Core route remains authoritative.",
  };
}

function validateCatalog(catalog) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(catalog)) return { ok: false, errors: ["catalog_object_required"], warnings, metrics: {} };
  if (catalog.schema_version !== SCHEMA_VERSION) errors.push("invalid_schema_version");
  if (!/^[a-f0-9]{64}$/.test(String(catalog.catalog_fingerprint || ""))) {
    errors.push("catalog_fingerprint_required");
  } else if (catalog.catalog_fingerprint !== catalogFingerprint(catalog)) {
    errors.push("catalog_fingerprint_mismatch");
  }
  if (!Array.isArray(catalog.branches) || catalog.branches.length === 0) errors.push("branches_required");
  if (!Array.isArray(catalog.nodes) || catalog.nodes.length === 0) errors.push("nodes_required");
  const calibration = catalog.confidence_calibration;
  const calibrationFormula = "0.50*evidence_coverage+0.20*authority_compliance+0.15*freshness_compliance+0.15*input_validity";
  if (
    !isPlainObject(calibration)
    || calibration.formula !== calibrationFormula
    || !Array.isArray(calibration.vectors)
    || calibration.vectors.length < 7
    || calibration.dataset_hash !== canonicalHash(calibration.vectors)
    || calibration.vectors.some((vector) => {
      const score = Number((
        Number(vector.evidence_coverage) * 0.5
        + Number(vector.authority_compliance) * 0.2
        + Number(vector.freshness_compliance) * 0.15
        + Number(vector.input_validity) * 0.15
      ).toFixed(4));
      return score !== vector.expected_score;
    })
  ) errors.push("invalid_confidence_calibration");

  const branchIds = new Set();
  const subbranchIds = new Set();
  const nodeIds = new Set();
  const nodeIndex = new Map();
  const purposeSignatures = new Map();
  const problemSignatures = new Map();
  const contractSignatures = new Map();
  const semanticSignatures = new Map();
  const registry = catalog.function_registry;
  const registryPayload = isPlainObject(registry)
    ? {
        schema_version: registry.schema_version,
        research_sha256: registry.research_sha256,
        source_snapshot_sha256: registry.source_snapshot_sha256,
        functions: registry.functions,
      }
    : null;
  if (
    !isPlainObject(registry)
    || !exactKeys(registry, [
      "schema_version",
      "research_sha256",
      "source_snapshot_sha256",
      "functions",
      "registry_hash",
    ])
    || registry.schema_version !== "nyra_deep_branch_function_registry_v1"
    || !Array.isArray(registry.functions)
    || registry.functions.length !== (catalog.nodes || []).length
    || registry.registry_hash !== canonicalHash(registryPayload)
  ) errors.push("invalid_function_registry");
  const functionIndex = new Map((registry?.functions || []).map((spec) => [spec.function_id, spec]));
  if (functionIndex.size !== (registry?.functions || []).length) errors.push("duplicate_function_registry_id");
  const functionHashes = new Set();
  for (const spec of registry?.functions || []) {
    if (semanticFunctionHash(spec) !== spec.semantic_function_hash) {
      errors.push(`invalid_semantic_function:${spec.function_id || "unknown"}`);
    }
    if (functionHashes.has(spec.semantic_function_hash)) {
      errors.push(`duplicate_semantic_function:${spec.function_id || "unknown"}`);
    }
    functionHashes.add(spec.semantic_function_hash);
  }

  for (const node of catalog.nodes || []) {
    if (!isPlainObject(node)) {
      errors.push("node_object_required");
      continue;
    }
    for (const field of REQUIRED_CONTRACT_FIELDS) {
      if (!Object.hasOwn(node, field)) errors.push(`missing_field:${node.id || "unknown"}:${field}`);
    }
    if (!isIdentifier(node.id)) errors.push(`invalid_node_id:${node.id || "unknown"}`);
    if (nodeIds.has(node.id)) errors.push(`duplicate_node_id:${node.id}`);
    nodeIds.add(node.id);
    nodeIndex.set(node.id, node);
    if (!isIdentifier(node.parent_id)) errors.push(`invalid_parent_id:${node.id}`);
    if (!isIdentifier(node.branch_id)) errors.push(`invalid_branch_id:${node.id}`);
    if (![2, 3, 4].includes(node.level)) errors.push(`invalid_level:${node.id}`);
    if (!LEVEL_NODE_TYPES[node.level]?.has(node.node_type)) errors.push(`invalid_node_type:${node.id}`);
    if (String(node.purpose || "").trim().length < 36 || FORBIDDEN_TEXT.test(String(node.purpose || ""))) errors.push(`invalid_purpose:${node.id}`);
    if (String(node.problem_solved || "").trim().length < 36 || FORBIDDEN_TEXT.test(String(node.problem_solved || ""))) errors.push(`invalid_problem_solved:${node.id}`);
    if (!validObjectSchema(node.input_schema)) errors.push(`invalid_input_schema:${node.id}`);
    if (!validObjectSchema(node.output_schema)) errors.push(`invalid_output_schema:${node.id}`);
    if (!semanticContractValid(node)) errors.push(`invalid_semantic_contract:${node.id}`);
    if (!semanticFunctionValid(node, functionIndex.get(node.id), registry?.registry_hash)) {
      errors.push(`invalid_function_binding:${node.id}`);
    }
    if (
      !Array.isArray(node.required_evidence)
      || node.required_evidence.some((requirement) => (
        !/^[a-f0-9]{64}$/.test(String(requirement.semantic_claim_hash || ""))
        || requirement.semantic_claim_hash !== canonicalHash({
          description: requirement.description,
          content_tag: requirement.content_tag,
          capability_spec_hash: node.semantic_contract?.capability_spec_hash,
        })
        || requirement.acceptance_rule !== evidenceAcceptanceRule(requirement.acceptance_program || {})
      ))
    ) errors.push(`invalid_evidence_semantic_binding:${node.id}`);
    for (const field of NON_EMPTY_ARRAY_FIELDS) {
      if (!Array.isArray(node[field]) || node[field].length === 0) errors.push(`empty_contract_field:${node.id}:${field}`);
      if (Array.isArray(node[field]) && node[field].some(containsForbiddenValue)) {
        errors.push(`invalid_contract_value:${node.id}:${field}`);
      }
    }
    for (const [field, requiredKeys] of Object.entries(ARRAY_OBJECT_FIELDS)) {
      if (!Array.isArray(node[field])) continue;
      for (const [index, item] of node[field].entries()) {
        if (!isPlainObject(item) || requiredKeys.some((key) => !Object.hasOwn(item, key))) {
          errors.push(`invalid_contract_object:${node.id}:${field}:${index}`);
        }
      }
    }
    if (!isPlainObject(node.routing) || !String(node.routing.selector || "").trim() || !String(node.routing.next || "").trim()) {
      errors.push(`invalid_routing:${node.id}`);
    }
    if (!/^(?:core:abstain|core:human_review|v1:[a-z][a-z0-9_]{1,63}\/[a-z][a-z0-9_]{1,63}|v2:[a-z][a-z0-9_.]{5,240})$/.test(String(node.fallback_node || ""))) {
      errors.push(`invalid_fallback_node:${node.id}`);
    }
    if (!VALID_RISKS.has(node.risk_class)) errors.push(`invalid_risk_class:${node.id}`);
    if (!Number.isFinite(node.confidence_threshold) || node.confidence_threshold < 0 || node.confidence_threshold > 1) {
      errors.push(`invalid_confidence_threshold:${node.id}`);
    }
    if (
      !isPlainObject(node.tenant_scope)
      || node.tenant_scope.partition_key !== "tenant_id"
      || node.tenant_scope.domain_pack_source !== "authenticated_core_key"
      || node.tenant_scope.cross_tenant_allowed !== false
      || node.tenant_scope.memory_scope !== "tenant_only"
      || node.tenant_scope.evidence_scope !== "tenant_only"
    ) errors.push(`invalid_tenant_scope:${node.id}`);
    if (
      !isPlainObject(node.feature_flag)
      || node.feature_flag.gate !== "NYRA_DEEP_BRANCH_V2_ENABLED"
      || node.feature_flag.mode_gate !== "NYRA_DEEP_BRANCH_V2_MODE"
      || node.feature_flag.branch_gate !== "NYRA_DEEP_BRANCH_V2_BRANCHES"
      || node.feature_flag.tenant_gate !== "NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST"
      || node.feature_flag.default_enabled !== false
    ) errors.push(`invalid_feature_flag:${node.id}`);
    if (node.enabled !== true) errors.push(`node_not_enabled_in_catalog:${node.id}`);
    if (!/^2\.\d+\.\d+$/.test(String(node.version || ""))) errors.push(`invalid_node_version:${node.id}`);
    if (node.supervisor_status !== "APPROVED") errors.push(`supervisor_not_approved:${node.id}`);
    if (
      !isPlainObject(node.v1_compatibility)
      || node.v1_compatibility.breaking_change !== false
      || node.v1_compatibility.fallback_to_v1 !== true
    ) {
      errors.push(`invalid_v1_compatibility:${node.id}`);
    }
    if (
      !isPlainObject(node.rollback_reference)
      || node.rollback_reference.kill_switch !== "NYRA_DEEP_BRANCH_V2_ENABLED=false"
      || !Array.isArray(node.rollback_reference.steps)
      || node.rollback_reference.steps.length < 2
      || !Array.isArray(node.rollback_reference.verification)
      || node.rollback_reference.verification.length < 2
    ) {
      errors.push(`invalid_rollback_reference:${node.id}`);
    }
    if (
      !isPlainObject(node.confidence_method)
      || node.confidence_method.abstain_below_threshold !== true
      || !Array.isArray(node.confidence_method.evidence_basis)
      || node.confidence_method.evidence_basis.length === 0
      || node.confidence_method.formula !== "0.50*evidence_coverage+0.20*authority_compliance+0.15*freshness_compliance+0.15*input_validity"
    ) errors.push(`invalid_confidence_method:${node.id}`);
    if (
      !isPlainObject(node.human_review_trigger)
      || node.human_review_trigger.action !== "pause_and_request_review"
      || node.human_review_trigger.timeout_action !== "abstain"
      || !Array.isArray(node.human_review_trigger.conditions)
      || node.human_review_trigger.conditions.length === 0
    ) errors.push(`invalid_human_review_trigger:${node.id}`);
    if (!node.dependencies?.some((dependency) => dependency.type === "universal_core" && dependency.required === true)) {
      errors.push(`missing_universal_core_dependency:${node.id}`);
    }
    if (!node.core_policy_bindings?.some((binding) => binding.policy_id === "tenant_isolation")) {
      errors.push(`missing_tenant_isolation_policy:${node.id}`);
    }
    const auditNames = new Set((node.audit_fields || []).map((field) => field.name));
    for (const requiredName of ["tenant_id", "request_id", "node_id", "contract_version", "core_verdict", "timestamp"]) {
      if (!auditNames.has(requiredName)) errors.push(`missing_audit_field:${node.id}:${requiredName}`);
    }
    const provenanceNames = new Set((node.provenance_fields || []).map((field) => field.name));
    for (const requiredName of ["contract_hash", "source_refs", "evidence_hashes", "route_trace", "policy_snapshot_hash"]) {
      if (!provenanceNames.has(requiredName)) errors.push(`missing_provenance_field:${node.id}:${requiredName}`);
    }
    if (!String(node.confidence_method?.calibration_reference || "").startsWith("reports/nyra-deep-v2/benchmark")) {
      errors.push(`invalid_confidence_calibration_reference:${node.id}`);
    }
    for (const method of node.methods || []) {
      const functionSpec = functionIndex.get(node.id);
      if (
        !node.input_schema?.required?.includes(method.input_field)
        || !node.output_schema?.required?.includes(method.output_field)
      ) errors.push(`method_io_binding_invalid:${node.id}:${method.id}`);
      if (
        !isPlainObject(method.program)
        || method.program.kind !== "capability_method_program_v2"
        || method.program.capability_spec_hash !== node.semantic_contract?.capability_spec_hash
        || method.program.record_claim_hash !== node.semantic_contract?.record_claim_hash
        || method.program.semantic_function_hash !== functionSpec?.semantic_function_hash
        || method.program.execution_plan_hash !== functionSpec?.execution_plan_hash
        || method.program.operation !== method.operation
        || inferOperationFromBasis(functionSpec?.semantic_source) !== method.operation
        || functionSpec?.execution_plan?.operation !== method.operation
        || method.program.role_projection !== functionSpec?.execution_plan?.role_projection
        || canonicalHash(functionSpec?.semantic_assertions) !== method.program.record_claim_hash
      ) errors.push(`method_program_invalid:${node.id}:${method.id}`);
    }
    if ((node.strategies || []).some((strategy) => (
      strategy.selection_predicate !== "method.valid&&semantic_observation.valid&&evidence.coverage==1&&policy.allows&&input.valid"
    ))) {
      errors.push(`strategy_predicate_invalid:${node.id}`);
    }
    if ((node.strategies || []).some((strategy) => (
      !isPlainObject(strategy.predicate_program)
      || strategy.selection_rule !== strategyRule(strategy.predicate_program)
    ))) errors.push(`strategy_program_invalid:${node.id}`);
    if ((node.core_policy_bindings || []).some((binding) => binding.core_decision_required !== true)) {
      errors.push(`core_policy_decision_not_required:${node.id}`);
    }
    if ((node.verifiers || []).some((verifier) => (
      !Array.isArray(verifier.checks)
      || new Set(verifier.checks).size !== REQUIRED_VERIFIER_CHECKS.length
      || JSON.stringify([...verifier.checks].sort()) !== JSON.stringify([...REQUIRED_VERIFIER_CHECKS].sort())
      || !isPlainObject(verifier.predicate_program)
      || verifier.pass_condition !== verifierCondition(verifier.predicate_program)
    ))) {
      errors.push(`verifier_checks_invalid:${node.id}`);
    }
    if ((node.metrics || []).some((metric) => (
      !Array.isArray(METRIC_FORMULA_SOURCES[metric.formula])
      || JSON.stringify([...metric.source_fields].sort()) !== JSON.stringify([...METRIC_FORMULA_SOURCES[metric.formula]].sort())
      || !isPlainObject(metric.formula_program)
      || metric.definition !== metricDefinition(metric.formula_program)
    ))) errors.push(`metric_source_binding_invalid:${node.id}`);
    if ((node.core_policy_bindings || []).some((binding) => (
      binding.on_deny !== (["high", "critical"].includes(node.risk_class) ? "human_review" : "abstain")
    ))) errors.push(`core_policy_on_deny_invalid:${node.id}`);
    if (catalog.rollback_checkpoint && node.rollback_reference?.catalog_checkpoint !== catalog.rollback_checkpoint) {
      errors.push(`rollback_checkpoint_mismatch:${node.id}`);
    }
    const regressionFixture = node.regression_tests?.[0]?.input_fixture;
    if (!regressionFixture || !node.rollback_reference?.verification?.some((step) => String(step).includes(regressionFixture))) {
      errors.push(`rollback_regression_fixture_missing:${node.id}`);
    }
    const purposeSignature = normalizedText(node.purpose);
    const problemSignature = normalizedText(node.problem_solved);
    if (purposeSignatures.has(purposeSignature)) errors.push(`duplicate_purpose:${purposeSignatures.get(purposeSignature)}:${node.id}`);
    else purposeSignatures.set(purposeSignature, node.id);
    if (problemSignatures.has(problemSignature)) errors.push(`duplicate_problem:${problemSignatures.get(problemSignature)}:${node.id}`);
    else problemSignatures.set(problemSignature, node.id);
    const contractSignature = JSON.stringify({
      purpose: purposeSignature,
      problem: problemSignature,
      activation: (node.activation_conditions || []).map((condition) => [condition.signal, condition.operator, condition.expected, normalizedText(condition.reason)]),
      output_fields: Object.keys(node.output_schema?.properties || {}).sort(),
      verifier: (node.verifiers || []).map((verifier) => [verifier.verifier_type, normalizedText(verifier.pass_condition)]),
      metric: (node.metrics || []).map((metric) => [normalizedText(metric.definition), metric.unit, metric.direction, metric.target]),
    });
    if (contractSignatures.has(contractSignature)) errors.push(`copied_contract:${contractSignatures.get(contractSignature)}:${node.id}`);
    else contractSignatures.set(contractSignature, node.id);
    const semanticSignature = node.semantic_contract?.semantic_hash;
    if (semanticSignatures.has(semanticSignature)) errors.push(`duplicate_semantic_program:${semanticSignatures.get(semanticSignature)}:${node.id}`);
    else semanticSignatures.set(semanticSignature, node.id);
  }

  for (const branch of catalog.branches || []) {
    if (!isPlainObject(branch) || !isIdentifier(branch.id)) {
      errors.push(`invalid_branch:${branch?.id || "unknown"}`);
      continue;
    }
    if (branchIds.has(branch.id)) errors.push(`duplicate_branch:${branch.id}`);
    branchIds.add(branch.id);
    if (!Array.isArray(branch.subbranches) || branch.subbranches.length === 0) errors.push(`subbranches_required:${branch.id}`);
    for (const subbranch of branch.subbranches || []) {
      const qualifiedId = `${branch.id}.${subbranch.id}`;
      if (!isIdentifier(subbranch.id)) errors.push(`invalid_subbranch:${qualifiedId}`);
      if (subbranch.parent_id !== branch.id || subbranch.branch_id !== branch.id || subbranch.level !== 1 || subbranch.node_type !== "subbranch") {
        errors.push(`invalid_subbranch_contract:${qualifiedId}`);
      }
      if (subbranchIds.has(qualifiedId)) errors.push(`duplicate_subbranch:${qualifiedId}`);
      subbranchIds.add(qualifiedId);
      if (!Array.isArray(subbranch.children) || subbranch.children.length === 0) errors.push(`specialized_capability_required:${qualifiedId}`);
      for (const childId of subbranch.children || []) {
        const child = nodeIndex.get(childId);
        if (!child || child.parent_id !== qualifiedId || child.branch_id !== branch.id || child.level !== 2) {
          errors.push(`invalid_specialized_capability_link:${qualifiedId}:${childId}`);
        }
      }
    }
  }

  for (const node of nodeIndex.values()) {
    if (!branchIds.has(node.branch_id)) errors.push(`node_branch_missing:${node.id}`);
    if (node.level === 2) {
      if (!subbranchIds.has(node.parent_id)) errors.push(`orphan_specialized_capability:${node.id}`);
      const childIds = childIdsFor(node.id, catalog.nodes || []);
      if (childIds.length === 0) errors.push(`micro_capability_required:${node.id}`);
      for (const childId of childIds) {
        const child = nodeIndex.get(childId);
        if (!child || child.parent_id !== node.id || child.level !== 3 || child.branch_id !== node.branch_id) {
          errors.push(`invalid_micro_capability_link:${node.id}:${childId}`);
        }
      }
    } else if (node.level === 3) {
      const parent = nodeIndex.get(node.parent_id);
      if (!parent || parent.level !== 2) errors.push(`orphan_micro_capability:${node.id}`);
      const childIds = childIdsFor(node.id, catalog.nodes || []);
      const childTypes = childIds.map((childId) => nodeIndex.get(childId)?.node_type).filter(Boolean);
      for (const type of REQUIRED_LEVEL4_TYPES) {
        if (childTypes.filter((candidate) => candidate === type).length !== 1) errors.push(`level4_${type}_cardinality:${node.id}`);
      }
      if (childIds.length !== REQUIRED_LEVEL4_TYPES.length) errors.push(`invalid_level4_child_count:${node.id}`);
    } else if (node.level === 4) {
      const parent = nodeIndex.get(node.parent_id);
      if (!parent || parent.level !== 3) errors.push(`orphan_level4_node:${node.id}`);
      if (childIdsFor(node.id, catalog.nodes || []).length !== 0) errors.push(`level4_children_forbidden:${node.id}`);
    }
  }

  const sourceBranches = catalog.source_catalog?.branches;
  if (!Array.isArray(sourceBranches) || sourceBranches.length === 0) {
    errors.push("source_catalog_required");
  } else {
    const actual = new Map((catalog.branches || []).map((branch) => [branch.id, new Set(branch.subbranches.map((item) => item.id))]));
    for (const sourceBranch of sourceBranches) {
      if (!actual.has(sourceBranch.id)) {
        errors.push(`missing_live_branch:${sourceBranch.id}`);
        continue;
      }
      for (const subbranchId of sourceBranch.subbranches || []) {
        if (!actual.get(sourceBranch.id).has(subbranchId)) errors.push(`missing_live_subbranch:${sourceBranch.id}.${subbranchId}`);
      }
    }
    const source = new Map(sourceBranches.map((branch) => [branch.id, new Set(branch.subbranches || [])]));
    for (const [branchId, actualSubbranches] of actual) {
      if (!source.has(branchId)) {
        errors.push(`branch_not_in_live_catalog:${branchId}`);
        continue;
      }
      for (const subbranchId of actualSubbranches) {
        if (!source.get(branchId).has(subbranchId)) errors.push(`subbranch_not_in_live_catalog:${branchId}.${subbranchId}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      ...topologyMetrics(catalog),
      duplicate_contract_count: errors.filter((item) => item.startsWith("duplicate_")).length,
      rejected_node_count: errors.filter((item) => item.startsWith("supervisor_not_approved")).length,
    },
  };
}

function loadLegacyCatalog({ catalogPath = DEFAULT_CATALOG_PATH, forceReload = false } = {}) {
  const absolutePath = path.resolve(catalogPath);
  if (!fs.existsSync(absolutePath)) {
    return {
      ok: false,
      state: "catalog_missing",
      catalog: null,
      validation: { ok: false, errors: ["catalog_missing"], warnings: [], metrics: {} },
      catalog_path: absolutePath,
    };
  }
  const stat = fs.statSync(absolutePath);
  const cacheKey = `${absolutePath}:${stat.mtimeMs}:${stat.size}`;
  if (!forceReload && catalogCache && catalogCacheKey === cacheKey) return catalogCache;
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      state: "catalog_parse_failed",
      catalog: null,
      validation: { ok: false, errors: [`catalog_parse_failed:${error.message}`], warnings: [], metrics: {} },
      catalog_path: absolutePath,
    };
  }
  const validation = validateCatalog(catalog);
  const result = {
    ok: validation.ok,
    state: validation.ok ? "ready" : "catalog_rejected",
    catalog: validation.ok ? deepFreeze(catalog) : null,
    validation,
    catalog_path: absolutePath,
  };
  catalogCache = result;
  catalogCacheKey = cacheKey;
  return result;
}

function manifestHash(manifest) {
  const payload = { ...manifest };
  delete payload.manifest_hash;
  return canonicalHash(payload);
}

function runtimeLoaderHash() {
  return crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex");
}

function safeArtifactPath(manifestPath, relativePath) {
  if (path.isAbsolute(String(relativePath || ""))) return null;
  const base = path.resolve(path.dirname(manifestPath));
  const resolved = path.resolve(base, String(relativePath || ""));
  return resolved.startsWith(`${base}${path.sep}`) ? resolved : null;
}

function runtimeShardDescriptorWithinLimits(descriptor) {
  return Number.isInteger(descriptor?.uncompressed_bytes)
    && descriptor.uncompressed_bytes > 0
    && descriptor.uncompressed_bytes <= MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES;
}

function runtimeTopologyMetrics(manifest) {
  const summaries = manifest?.topology?.node_summaries || [];
  const levelCounts = { 1: Number(manifest?.topology?.subbranch_count || 0), 2: 0, 3: 0, 4: 0 };
  const level4TypeCounts = { method: 0, strategy: 0, verifier: 0, metric: 0 };
  for (const node of summaries) {
    if (Object.hasOwn(levelCounts, node.level)) levelCounts[node.level] += 1;
    if (node.level === 4 && Object.hasOwn(level4TypeCounts, node.node_type)) {
      level4TypeCounts[node.node_type] += 1;
    }
  }
  return {
    branch_count: Number(manifest?.topology?.branch_count || 0),
    subbranch_count: Number(manifest?.topology?.subbranch_count || 0),
    node_count: Number(manifest?.topology?.node_count || 0),
    level_counts: levelCounts,
    level4_type_counts: level4TypeCounts,
    duplicate_contract_count: Number(
      manifest?.validation_attestation?.duplicate_contract_count ?? -1
    ),
    rejected_node_count: Number(
      manifest?.validation_attestation?.rejected_node_count ?? -1
    ),
  };
}

function verifyRuntimeManifestArtifacts(manifest, manifestPath) {
  const errors = [];
  const descriptors = Array.isArray(manifest?.shards) ? manifest.shards : [];
  let checkedShards = 0;
  let uncompressedBytes = 0;
  let peakUncompressedShardBytes = 0;
  for (const descriptor of descriptors) {
    checkedShards += 1;
    if (!runtimeShardDescriptorWithinLimits(descriptor)) {
      errors.push(`shard_size_limit_exceeded:${descriptor?.branch_id || "unknown"}.${descriptor?.subbranch_id || "unknown"}`);
      continue;
    }
    const artifactPath = safeArtifactPath(manifestPath, descriptor?.relative_path);
    if (!artifactPath) {
      errors.push(`unsafe_shard_path:${descriptor?.branch_id || "unknown"}.${descriptor?.subbranch_id || "unknown"}`);
      continue;
    }
    try {
      const compressed = fs.readFileSync(artifactPath);
      const uncompressed = zlib.gunzipSync(compressed, {
        maxOutputLength: Math.min(
          descriptor.uncompressed_bytes,
          MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES
        ),
      });
      uncompressedBytes += uncompressed.length;
      peakUncompressedShardBytes = Math.max(peakUncompressedShardBytes, uncompressed.length);
      if (
        uncompressed.length !== descriptor.uncompressed_bytes
        || byteHash(uncompressed) !== descriptor.uncompressed_sha256
      ) {
        errors.push(`uncompressed_shard_hash_mismatch:${descriptor.branch_id}.${descriptor.subbranch_id}`);
      }
    } catch (error) {
      errors.push(`shard_integrity_failed:${descriptor?.branch_id || "unknown"}.${descriptor?.subbranch_id || "unknown"}:${error.code || error.message}`);
    }
  }
  return {
    ok: errors.length === 0 && checkedShards === descriptors.length,
    errors,
    checked_shards: checkedShards,
    unchecked_shards: Math.max(0, descriptors.length - checkedShards),
    uncompressed_bytes: uncompressedBytes,
    peak_uncompressed_shard_bytes: peakUncompressedShardBytes,
    parse_mode: "sequential_hash_and_gunzip_without_json_parse",
  };
}

function validateRuntimeManifest(manifest, manifestPath) {
  const errors = [];
  if (!isPlainObject(manifest)) {
    return {
      ok: false,
      errors: ["runtime_manifest_object_required"],
      warnings: [],
      metrics: {},
      integrity: {
        ok: false,
        checked_shards: 0,
        unchecked_shards: 0,
      },
    };
  }
  const root = manifest.root_binding || {};
  const catalog = manifest.catalog || {};
  const registry = manifest.function_registry || {};
  const validation = manifest.validation_attestation || {};
  const supervisor = manifest.supervisor_attestation || {};
  const summaries = manifest?.topology?.node_summaries || [];
  const descriptors = manifest.shards || [];
  const catalogBinding = { ...root };
  delete catalogBinding.shard_set_hash;
  const shardSetProjection = (Array.isArray(descriptors) ? descriptors : []).map((descriptor) => ({
    branch_id: descriptor.branch_id,
    subbranch_id: descriptor.subbranch_id,
    relative_path: descriptor.relative_path,
    uncompressed_sha256: descriptor.uncompressed_sha256,
    uncompressed_bytes: descriptor.uncompressed_bytes,
    node_count: descriptor.node_count,
    function_count: descriptor.function_count,
    node_ids: descriptor.node_ids,
  }));
  if (manifest.schema_version !== RUNTIME_MANIFEST_SCHEMA_VERSION) errors.push("invalid_runtime_manifest_schema");
  if (manifest.manifest_hash !== manifestHash(manifest)) errors.push("runtime_manifest_hash_mismatch");
  if (manifest.root_binding_hash !== canonicalHash(root)) errors.push("runtime_root_binding_hash_mismatch");
  if (manifest.catalog_binding_hash !== canonicalHash(catalogBinding)) errors.push("runtime_catalog_binding_hash_mismatch");
  if (root.shard_set_hash !== canonicalHash(shardSetProjection)) errors.push("runtime_shard_set_hash_mismatch");
  if (root.catalog_fingerprint !== catalog.catalog_fingerprint) errors.push("runtime_catalog_fingerprint_mismatch");
  if (root.function_registry_hash !== registry.registry_hash) errors.push("runtime_registry_hash_mismatch");
  if (root.function_registry_hash !== catalog.function_registry?.registry_hash) errors.push("runtime_catalog_registry_mismatch");
  if (root.source_snapshot_sha256 !== catalog.source_catalog?.source_snapshot_sha256) errors.push("runtime_source_snapshot_mismatch");
  if (root.supervisor_report_sha256 !== supervisor.sha256) errors.push("runtime_supervisor_hash_mismatch");
  if (root.validation_attestation_sha256 !== validation.sha256) errors.push("runtime_validation_attestation_hash_mismatch");
  if (root.rollback_checkpoint !== catalog.rollback_checkpoint) errors.push("runtime_rollback_checkpoint_mismatch");
  if (root.catalog_runtime_sha256 !== catalog.runtime_sha256) errors.push("runtime_catalog_runtime_hash_mismatch");
  if (root.generator_sha256 !== catalog.generator_sha256) errors.push("runtime_generator_hash_mismatch");
  if (root.catalog_schema_version !== catalog.schema_version || catalog.schema_version !== SCHEMA_VERSION) {
    errors.push("runtime_catalog_schema_mismatch");
  }
  if (root.catalog_version !== catalog.version) errors.push("runtime_catalog_version_mismatch");
  if (root.runtime_loader_sha256 !== runtimeLoaderHash()) errors.push("runtime_loader_hash_mismatch");
  if (
    manifest?.offline_audit_artifact?.runtime_read_allowed !== false
    || manifest?.offline_audit_artifact?.canonical_catalog_fingerprint !== root.catalog_fingerprint
  ) errors.push("runtime_offline_audit_binding_invalid");
  if (
    validation.full_offline_validated !== true
    || validation.catalog_fingerprint !== root.catalog_fingerprint
    || validation.validated_branch_count !== 18
    || validation.validated_subbranch_count !== 239
    || validation.validated_node_count !== 1434
    || validation.rejected_node_count !== 0
    || validation.duplicate_contract_count !== 0
    || validation.rollback_verified !== true
  ) errors.push("runtime_full_validation_attestation_invalid");
  if (
    supervisor.runtime_inclusion_allowed !== true
    || supervisor.approved_node_count !== 1434
    || supervisor.rejected_node_count !== 0
  ) errors.push("runtime_supervisor_attestation_invalid");
  if (
    manifest?.topology?.branch_count !== 18
    || manifest?.topology?.subbranch_count !== 239
    || manifest?.topology?.node_count !== 1434
    || !Array.isArray(summaries)
    || summaries.length !== 1434
    || new Set(summaries.map((node) => node.id)).size !== 1434
    || summaries.some((node) => node.supervisor_status !== "APPROVED")
  ) errors.push("runtime_topology_invalid");
  const expectedSubbranches = new Set(
    (catalog.branches || []).flatMap((branch) => (
      (branch.subbranches || []).map((subbranch) => `${branch.id}.${subbranch.id}`)
    ))
  );
  const actualSubbranches = new Set(
    (Array.isArray(descriptors) ? descriptors : []).map(
      (descriptor) => `${descriptor.branch_id}.${descriptor.subbranch_id}`
    )
  );
  if (
    !Array.isArray(descriptors)
    || descriptors.length !== 239
    || actualSubbranches.size !== 239
    || [...expectedSubbranches].some((key) => !actualSubbranches.has(key))
    || descriptors.some((descriptor) => (
      descriptor.node_count !== 6
      || descriptor.function_count !== 6
      || !Array.isArray(descriptor.node_ids)
      || descriptor.node_ids.length !== 6
    ))
  ) errors.push("runtime_shard_index_invalid");
  const declaredUncompressedBytes = (Array.isArray(descriptors) ? descriptors : [])
    .reduce((sum, descriptor) => sum + Number(descriptor.uncompressed_bytes || 0), 0);
  if (
    descriptors.some((descriptor) => !runtimeShardDescriptorWithinLimits(descriptor))
    || declaredUncompressedBytes > MAX_RUNTIME_SHARDS_UNCOMPRESSED_BYTES
  ) errors.push("runtime_shard_size_budget_exceeded");
  if (registry.function_count !== 1434) errors.push("runtime_function_count_invalid");
  const integrity = verifyRuntimeManifestArtifacts(manifest, manifestPath);
  errors.push(...integrity.errors);
  if (integrity.unchecked_shards !== 0) errors.push("runtime_shards_unchecked");
  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    metrics: runtimeTopologyMetrics(manifest),
    integrity,
    attestation: {
      full_offline_validated: validation.full_offline_validated === true,
      validation_attestation_sha256: validation.sha256 || null,
      supervisor_report_sha256: supervisor.sha256 || null,
      root_binding_hash: manifest.root_binding_hash || null,
      catalog_fingerprint: root.catalog_fingerprint || null,
    },
  };
}

function loadRuntimeManifest({
  manifestPath = DEFAULT_RUNTIME_MANIFEST_PATH,
  forceReload = false,
} = {}) {
  const absolutePath = path.resolve(manifestPath);
  if (!fs.existsSync(absolutePath)) {
    return {
      ok: false,
      state: "runtime_manifest_missing",
      catalog: null,
      validation: { ok: false, errors: ["runtime_manifest_missing"], warnings: [], metrics: {} },
      manifest_path: absolutePath,
      runtime_lazy: true,
    };
  }
  const stat = fs.statSync(absolutePath);
  const cacheKey = `${absolutePath}:${stat.mtimeMs}:${stat.size}`;
  if (!forceReload && runtimeManifestCache && runtimeManifestCacheKey === cacheKey) {
    return runtimeManifestCache;
  }
  if (forceReload) {
    runtimeShardCache.clear();
    runtimeShardCacheBytes = 0;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      state: "runtime_manifest_parse_failed",
      catalog: null,
      validation: {
        ok: false,
        errors: [`runtime_manifest_parse_failed:${error.message}`],
        warnings: [],
        metrics: {},
      },
      manifest_path: absolutePath,
      runtime_lazy: true,
    };
  }
  const validation = validateRuntimeManifest(manifest, absolutePath);
  const catalog = validation.ok
    ? deepFreeze({
        ...manifest.catalog,
        nodes: manifest.topology.node_summaries,
        function_registry: {
          ...manifest.catalog.function_registry,
          functions: [],
          function_count: manifest.function_registry.function_count,
        },
      })
    : null;
  const result = {
    ok: validation.ok,
    state: validation.ok ? "ready_lazy_sharded" : "runtime_manifest_rejected",
    catalog,
    validation,
    manifest: validation.ok ? deepFreeze(manifest) : null,
    manifest_path: absolutePath,
    catalog_path: null,
    audit_catalog: validation.ok ? deepFreeze(manifest.offline_audit_artifact) : null,
    runtime_lazy: true,
  };
  runtimeManifestCache = result;
  runtimeManifestCacheKey = cacheKey;
  return result;
}

function shardCacheLimits(env = process.env) {
  const entries = Number(env.NYRA_DEEP_BRANCH_V2_SHARD_CACHE_MAX_ENTRIES);
  const bytes = Number(env.NYRA_DEEP_BRANCH_V2_SHARD_CACHE_MAX_BYTES);
  return {
    entries: Number.isInteger(entries)
      ? Math.max(1, Math.min(16, entries))
      : DEFAULT_SHARD_CACHE_MAX_ENTRIES,
    bytes: Number.isFinite(bytes)
      ? Math.max(1024 * 1024, Math.min(32 * 1024 * 1024, bytes))
      : DEFAULT_SHARD_CACHE_MAX_BYTES,
  };
}

function evictRuntimeShardCache(limits) {
  while (
    runtimeShardCache.size > limits.entries
    || runtimeShardCacheBytes > limits.bytes
  ) {
    const oldestKey = runtimeShardCache.keys().next().value;
    const oldest = runtimeShardCache.get(oldestKey);
    runtimeShardCache.delete(oldestKey);
    runtimeShardCacheBytes -= oldest?.bytes || 0;
  }
}

function validateRuntimeShard(shard, descriptor, loaded) {
  const errors = [];
  const payload = { ...shard };
  delete payload.shard_hash;
  if (shard.schema_version !== RUNTIME_SHARD_SCHEMA_VERSION) errors.push("invalid_shard_schema");
  if (shard.shard_hash !== canonicalHash(payload)) errors.push("shard_payload_hash_mismatch");
  if (shard.catalog_binding_hash !== loaded.manifest.catalog_binding_hash) errors.push("shard_catalog_binding_mismatch");
  if (shard.catalog_fingerprint !== loaded.manifest.root_binding.catalog_fingerprint) errors.push("shard_catalog_fingerprint_mismatch");
  if (shard.function_registry_hash !== loaded.manifest.root_binding.function_registry_hash) errors.push("shard_registry_hash_mismatch");
  if (shard.branch_id !== descriptor.branch_id || shard.subbranch_id !== descriptor.subbranch_id) {
    errors.push("shard_lineage_mismatch");
  }
  if (
    !Array.isArray(shard.nodes)
    || !Array.isArray(shard.functions)
    || shard.nodes.length !== 6
    || shard.functions.length !== 6
    || JSON.stringify(shard.nodes.map((node) => node.id)) !== JSON.stringify(descriptor.node_ids)
  ) errors.push("shard_contract_coverage_mismatch");
  const functionIndex = new Map((shard.functions || []).map((spec) => [spec.function_id, spec]));
  const l2 = (shard.nodes || []).filter((node) => node.level === 2);
  const l3 = (shard.nodes || []).filter((node) => node.level === 3);
  const l4 = (shard.nodes || []).filter((node) => node.level === 4);
  if (
    l2.length !== 1
    || l3.length !== 1
    || l4.length !== 4
    || new Set(l4.map((node) => node.node_type)).size !== 4
    || REQUIRED_LEVEL4_TYPES.some((type) => !l4.some((node) => node.node_type === type))
    || l2[0]?.parent_id !== `${descriptor.branch_id}.${descriptor.subbranch_id}`
    || l3[0]?.parent_id !== l2[0]?.id
    || l4.some((node) => node.parent_id !== l3[0]?.id)
  ) errors.push("shard_topology_mismatch");
  for (const node of shard.nodes || []) {
    if (
      node.branch_id !== descriptor.branch_id
      || node.id.split(".")[1] !== descriptor.subbranch_id
      || node.supervisor_status !== "APPROVED"
      || !semanticFunctionValid(
        node,
        functionIndex.get(node.id),
        loaded.manifest.root_binding.function_registry_hash
      )
    ) errors.push(`shard_node_binding_invalid:${node.id || "unknown"}`);
  }
  return { ok: errors.length === 0, errors };
}

function loadRuntimeShard({
  loaded,
  tenantId,
  branchId,
  subbranchId,
  env = process.env,
} = {}) {
  const descriptor = loaded?.manifest?.shards?.find(
    (candidate) => candidate.branch_id === branchId && candidate.subbranch_id === subbranchId
  );
  if (!descriptor) {
    return { ok: false, errors: [`runtime_shard_not_indexed:${branchId}.${subbranchId}`] };
  }
  if (!runtimeShardDescriptorWithinLimits(descriptor)) {
    return { ok: false, errors: [`runtime_shard_size_limit_exceeded:${branchId}.${subbranchId}`] };
  }
  const cacheKey = `${tenantId}:${loaded.manifest.root_binding_hash}:${descriptor.compressed_sha256}`;
  if (runtimeShardCache.has(cacheKey)) {
    const cached = runtimeShardCache.get(cacheKey);
    runtimeShardCache.delete(cacheKey);
    runtimeShardCache.set(cacheKey, cached);
    return cached.result;
  }
  const artifactPath = safeArtifactPath(loaded.manifest_path, descriptor.relative_path);
  if (!artifactPath) return { ok: false, errors: ["runtime_shard_path_invalid"] };
  let compressed;
  let uncompressed;
  let shard;
  try {
    const stat = fs.statSync(artifactPath);
    if (
      stat.size !== descriptor.compressed_bytes
      || stat.size > MAX_RUNTIME_SHARD_COMPRESSED_BYTES
    ) return { ok: false, errors: [`runtime_shard_compressed_size_mismatch:${branchId}.${subbranchId}`] };
    compressed = fs.readFileSync(artifactPath);
    if (
      compressed.length !== descriptor.compressed_bytes
      || byteHash(compressed) !== descriptor.compressed_sha256
    ) return { ok: false, errors: [`runtime_shard_compressed_hash_mismatch:${branchId}.${subbranchId}`] };
    uncompressed = zlib.gunzipSync(compressed, {
      maxOutputLength: Math.min(
        descriptor.uncompressed_bytes,
        MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES
      ),
    });
    if (
      uncompressed.length !== descriptor.uncompressed_bytes
      || byteHash(uncompressed) !== descriptor.uncompressed_sha256
    ) return { ok: false, errors: [`runtime_shard_uncompressed_hash_mismatch:${branchId}.${subbranchId}`] };
    shard = JSON.parse(uncompressed.toString("utf8"));
  } catch (error) {
    return { ok: false, errors: [`runtime_shard_load_failed:${branchId}.${subbranchId}:${error.code || error.message}`] };
  }
  const localValidation = validateRuntimeShard(shard, descriptor, loaded);
  if (!localValidation.ok) return { ok: false, errors: localValidation.errors };
  const result = {
    ok: true,
    nodes: deepFreeze(shard.nodes),
    functions: deepFreeze(shard.functions),
    descriptor,
  };
  const limits = shardCacheLimits(env);
  runtimeShardCache.set(cacheKey, { result, bytes: uncompressed.length });
  runtimeShardCacheBytes += uncompressed.length;
  evictRuntimeShardCache(limits);
  return result;
}

function loadCatalog({
  catalogPath = DEFAULT_CATALOG_PATH,
  manifestPath = DEFAULT_RUNTIME_MANIFEST_PATH,
  forceReload = false,
  runtimeMode = "legacy",
} = {}) {
  const useRuntimeManifest = runtimeMode === "lazy"
    || (runtimeMode === "auto" && path.resolve(catalogPath) === DEFAULT_CATALOG_PATH);
  return useRuntimeManifest
    ? loadRuntimeManifest({ manifestPath, forceReload })
    : loadLegacyCatalog({ catalogPath, forceReload });
}

function route({
  tenantId = "",
  domainPackId = "generic",
  corePayload = null,
  requestedBranches = [],
  evaluationContext = null,
  env = process.env,
  catalogPath = DEFAULT_CATALOG_PATH,
  manifestPath = DEFAULT_RUNTIME_MANIFEST_PATH,
  runtimeMode = "auto",
} = {}) {
  const flags = featureFlags(env, tenantId);
  if (!flags.enabled) {
    return {
      schema_version: ROUTE_SCHEMA_VERSION,
      state: "disabled_v1_authoritative",
      mode: "disabled",
      feature_flags: flags,
      selected_branches: [],
      execution_authorized: false,
      core_final_authority: true,
      fallback: "nyra_neural_branch_network_v1",
    };
  }
  const loaded = loadCatalog({ catalogPath, manifestPath, runtimeMode });
  if (!loaded.ok) {
    return {
      schema_version: ROUTE_SCHEMA_VERSION,
      state: "catalog_rejected_v1_authoritative",
      mode: flags.mode,
      feature_flags: flags,
      validation: loaded.validation,
      selected_branches: [],
      execution_authorized: false,
      core_final_authority: true,
      fallback: "nyra_neural_branch_network_v1",
    };
  }
  const coreOpened = runtimeOpenedBranches(corePayload).map((branch) => String(branch?.id || branch || "")).filter(Boolean);
  if (coreOpened.length === 0) {
    return {
      schema_version: ROUTE_SCHEMA_VERSION,
      state: "core_route_absent_v1_authoritative",
      mode: flags.mode,
      feature_flags: flags,
      catalog_version: loaded.catalog.version,
      catalog_fingerprint: loaded.catalog.catalog_fingerprint,
      selected_branches: [],
      execution_authorized: false,
      core_final_authority: true,
      fallback: "nyra_neural_branch_network_v1",
    };
  }
  const requested = new Set([
    ...(Array.isArray(requestedBranches) ? requestedBranches.map(String) : []),
    ...coreOpened,
  ]);
  const allowlist = new Set(flags.branch_allowlist);
  const nodeIndex = new Map(loaded.catalog.nodes.map((node) => [node.id, node]));
  const functionIndex = loaded.runtime_lazy
    ? new Map()
    : new Map(loaded.catalog.function_registry.functions.map((spec) => [spec.function_id, spec]));
  const selectedBranches = loaded.catalog.branches
    .filter((branch) => requested.size === 0 || requested.has(branch.id))
    .filter((branch) => coreOpened.length === 0 || coreOpened.includes(branch.id))
    .filter((branch) => allowlist.size === 0 || allowlist.has(branch.id))
    .filter((branch) => branch.domain_packs.includes("*") || branch.domain_packs.includes(domainPackId))
    .map((branch) => treeBranch(branch, nodeIndex, loaded.catalog.nodes));
  const selectedBranchIds = new Set(selectedBranches.map((branch) => branch.id));
  const evaluations = [];
  if (isPlainObject(evaluationContext) && String(evaluationContext.subbranch_id || "").trim()) {
    const evaluationSubbranchId = String(evaluationContext.subbranch_id);
    let evaluationNodes;
    let evaluationFunctionIndex = functionIndex;
    let evaluationRegistryHash = loaded.catalog.function_registry.registry_hash;
    if (loaded.runtime_lazy) {
      const shards = [...selectedBranchIds].map((branchId) => loadRuntimeShard({
        loaded,
        tenantId,
        branchId,
        subbranchId: evaluationSubbranchId,
        env,
      })).filter((shard) => shard.ok || !shard.errors?.some((error) => error.startsWith("runtime_shard_not_indexed:")));
      const rejectedShard = shards.find((shard) => !shard.ok);
      if (rejectedShard) {
        return {
          schema_version: ROUTE_SCHEMA_VERSION,
          state: "catalog_rejected_v1_authoritative",
          mode: flags.mode,
          feature_flags: flags,
          validation: {
            ...loaded.validation,
            ok: false,
            errors: [...loaded.validation.errors, ...rejectedShard.errors],
          },
          selected_branches: [],
          evaluations: [],
          execution_authorized: false,
          core_final_authority: true,
          fallback: "nyra_neural_branch_network_v1",
        };
      }
      evaluationNodes = shards.flatMap((shard) => shard.nodes || []);
      evaluationFunctionIndex = new Map(
        shards.flatMap((shard) => shard.functions || []).map((spec) => [spec.function_id, spec])
      );
      evaluationRegistryHash = loaded.manifest.root_binding.function_registry_hash;
    } else {
      evaluationNodes = loaded.catalog.nodes
        .filter((node) => selectedBranchIds.has(node.branch_id))
        .filter((node) => node.id.split(".")[1] === evaluationSubbranchId);
    }
    const parentEvaluations = new Map();
    for (const node of evaluationNodes.sort(
      (left, right) => left.level - right.level || left.id.localeCompare(right.id)
    )) {
      const evaluation = evaluateNode({
        node,
        tenantId,
        subbranchId: evaluationSubbranchId,
        corePayload,
        evidence: Array.isArray(evaluationContext.evidence) ? evaluationContext.evidence : [],
        evidenceSource: String(evaluationContext.evidence_source || ""),
        capabilityInput: isPlainObject(evaluationContext.node_inputs)
          ? evaluationContext.node_inputs[node.id]
          : null,
        functionSpec: evaluationFunctionIndex.get(node.id),
        functionRegistryHash: evaluationRegistryHash,
        parentEvaluations,
        requestId: String(evaluationContext.request_id || ""),
        observedAt: Number(evaluationContext.observed_at || Date.now()),
      });
      evaluations.push(evaluation);
      parentEvaluations.set(node.id, evaluation);
    }
  }
  return {
    schema_version: ROUTE_SCHEMA_VERSION,
    state: flags.mode === "active" ? "active_after_core_branch_open" : "shadow_v1_authoritative",
    mode: flags.mode,
    feature_flags: flags,
    catalog_version: loaded.catalog.version,
    catalog_fingerprint: loaded.catalog.catalog_fingerprint,
    source_catalog: {
      schema_version: loaded.catalog.source_catalog.schema_version,
      captured_at: loaded.catalog.source_catalog.captured_at,
      source: loaded.catalog.source_catalog.source,
    },
    selected_branches: selectedBranches,
    evaluations,
    validation: loaded.validation,
    execution_authorized: false,
    core_final_authority: true,
    fallback: "nyra_neural_branch_network_v1",
  };
}

function serializeCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

module.exports = {
  DEFAULT_CATALOG_PATH,
  DEFAULT_RUNTIME_MANIFEST_PATH,
  MAX_RUNTIME_SHARD_COMPRESSED_BYTES,
  MAX_RUNTIME_SHARD_COMPRESSION_RATIO,
  MAX_RUNTIME_SHARD_UNCOMPRESSED_BYTES,
  REQUIRED_CONTRACT_FIELDS,
  REQUIRED_LEVEL4_TYPES,
  ROUTE_SCHEMA_VERSION,
  RUNTIME_MANIFEST_SCHEMA_VERSION,
  RUNTIME_SHARD_SCHEMA_VERSION,
  SCHEMA_VERSION,
  catalogFingerprint,
  featureFlags,
  evaluateNode,
  loadCatalog,
  loadRuntimeShard,
  route,
  runtimeOpenedBranches,
  serializeCatalog,
  topologyMetrics,
  validateRuntimeManifest,
  validateCatalog,
};

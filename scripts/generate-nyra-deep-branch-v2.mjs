#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { nyraBranchCatalog, routeNyraBranches } from "../services/universal-core-service/src/nyraBranchNetwork.js";

const require = createRequire(import.meta.url);
const { createNyraHorizontalRuntime } = require("../personal-control-center/lib/nyra-horizontal-runtime");

const SCHEMA_VERSION = "nyra_deep_branch_architecture_v2";
const CONTRACT_SCHEMA_VERSION = "nyra_deep_branch_contract_catalog_v2";
const CONTRACT_VERSION = "2.0.0";
const SOURCE_URL = "https://skinharmony-universal-core.onrender.com/v1/nira/branches";
const LEVEL4_TYPES = Object.freeze(["method", "strategy", "verifier", "metric"]);
function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function requiredArg(args, key) {
  const value = String(args[key] || "").trim();
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function sha256(value) {
  const bytes = typeof value === "string" ? value : JSON.stringify(canonicalize(value));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function normalizedText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function slug(value, fallback = "item") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const withLetter = /^[a-z]/.test(normalized) ? normalized : `n_${normalized}`;
  return (withLetter || fallback).slice(0, 64).replace(/_+$/g, "") || fallback;
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function textHash(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function splitResearchCell(value) {
  return String(value || "")
    .split(/\s*;\s*|\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseResearchRegistry(markdown, liveBranchIds) {
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 10 || cells[0] === "branch_id" || !liveBranchIds.has(cells[0])) continue;
    if (cells.some((cell) => !cell)) throw new Error(`Empty research cell: ${line}`);
    rows.push({
      branch_id: cells[0],
      subbranch_id: cells[1],
      problem_solved: cells[2],
      specialized_capability_id: cells[3],
      specialized_purpose: cells[4],
      micro_capability_id: cells[5],
      micro_purpose: cells[6],
      failure_modes: cells[7],
      required_evidence: cells[8],
      overlap_notes: cells[9],
    });
  }
  return rows;
}

function textForNode(row, nodeType) {
  if (nodeType === "specialized_capability") {
    return {
      purpose: `${row.specialized_purpose} The capability emits a bounded ${row.specialized_capability_id} decision record for ${row.branch_id}.${row.subbranch_id}.`,
      problem: `${row.problem_solved} This specialized contract resolves that gap without taking over the neighbouring ownership boundary: ${row.overlap_notes}`,
    };
  }
  if (nodeType === "micro_capability") {
    return {
      purpose: `${row.micro_purpose} The micro-capability returns an independently verifiable ${row.micro_capability_id} result and explicit abstention state.`,
      problem: `${row.specialized_capability_id} can still fail through ${row.failure_modes} This micro-contract isolates and detects that failure surface.`,
    };
  }
  if (nodeType === "method") {
    return {
      purpose: `Execute ${row.micro_capability_id} as a deterministic, evidence-bounded procedure that preserves the exact ${row.branch_id}.${row.subbranch_id} ownership boundary.`,
      problem: `${row.micro_capability_id} otherwise lacks a reproducible transformation sequence for the evidence requirement: ${row.required_evidence}`,
    };
  }
  if (nodeType === "strategy") {
    return {
      purpose: `Select the safest applicable ${row.micro_capability_id} pathway by comparing evidence sufficiency, failure exposure and Universal Core constraints.`,
      problem: `${row.micro_capability_id} can choose an unsuitable path when these distinct failure modes are not separated: ${row.failure_modes}`,
    };
  }
  if (nodeType === "verifier") {
    return {
      purpose: `Independently verify that the ${row.micro_capability_id} output resolves the stated ${row.subbranch_id} problem and retains required evidence lineage.`,
      problem: `${row.micro_capability_id} output could appear complete while violating this boundary or evidence contract: ${row.overlap_notes}`,
    };
  }
  return {
    purpose: `Measure whether ${row.micro_capability_id} materially resolves ${row.subbranch_id} using evidence coverage, escaped-failure rate and abstention correctness.`,
    problem: `${row.micro_capability_id} has no governable release signal unless success and the failure surface "${row.failure_modes}" are quantified.`,
  };
}

function fieldName(base, suffix) {
  const normalizedSuffix = slug(suffix);
  const maxBase = Math.max(2, 64 - normalizedSuffix.length - 1);
  return `${slug(base).slice(0, maxBase).replace(/_+$/g, "")}_${normalizedSuffix}`;
}

function mechanismProfile(row, nodeType = "micro_capability") {
  const basis = operationBasis(row, nodeType);
  const text = [
    basis.branch_id,
    basis.subbranch_id,
    basis.node_type,
    basis.purpose,
    basis.problem_solved,
    ...basis.evidence_claims,
    ...basis.failure_scenarios,
    basis.overlap_exclusion,
  ].join(" ").toLowerCase();
  if (/(tenant|isolat|authori|permission|consent|policy|security|injection|secret|privacy)/.test(text)) {
    return {
      id: "deny_first_governance",
      operation: `Resolve authenticated claims, apply deny-first policy predicates and preserve the exact authority boundary for ${row.micro_capability_id}.`,
      verifierType: "policy",
      metricId: "unauthorized_escape_rate",
      metricDefinition: `Rate of ${row.micro_capability_id} outputs that escape the declared tenant, authority or policy boundary.`,
      unit: "ratio",
      direction: "lower_is_better",
      operator: "lte",
      target: 0,
    };
  }
  if (/(fresh|temporal|time|deadline|date|expiry|retention|stale|version|chronolog)/.test(text)) {
    return {
      id: "bitemporal_reconciliation",
      operation: `Reconcile observed, effective and expiry times for ${row.micro_capability_id}, retaining timezone and version lineage.`,
      verifierType: "cross_check",
      metricId: "temporal_mismatch_rate",
      metricDefinition: `Rate of ${row.micro_capability_id} results with inconsistent observation, effective, expiry or version intervals.`,
      unit: "ratio",
      direction: "lower_is_better",
      operator: "lte",
      target: 0,
    };
  }
  if (/(source|evidence|claim|citation|provenance|research|dataset|fact|contradiction|uncertainty)/.test(text)) {
    return {
      id: "claim_evidence_reconciliation",
      operation: `Build claim-aligned evidence mappings for ${row.micro_capability_id}, preserving authority, independence, qualifiers and provenance.`,
      verifierType: "evidence",
      metricId: "supported_claim_coverage",
      metricDefinition: `Share of material ${row.micro_capability_id} claims linked to sufficient authoritative and independent evidence.`,
      unit: "ratio",
      direction: "higher_is_better",
      operator: "gte",
      target: 0.95,
    };
  }
  if (/(depend|graph|path|sequence|plan|capacity|schedule|milestone|priority|estimate|resource|lane|parallel|concurr|handoff)/.test(text)) {
    return {
      id: "constraint_graph_resolution",
      operation: `Construct and evaluate the typed constraint graph for ${row.micro_capability_id}, including owners, blockers and reversible transitions.`,
      verifierType: "deterministic_rule",
      metricId: "feasible_transition_coverage",
      metricDefinition: `Share of ${row.micro_capability_id} transitions whose dependencies, capacity and authority predicates are satisfied.`,
      unit: "ratio",
      direction: "higher_is_better",
      operator: "gte",
      target: 0.95,
    };
  }
  if (/(test|quality|regression|acceptance|verif|benchmark|defect|release_readiness|performance)/.test(text)) {
    return {
      id: "oracle_driven_verification",
      operation: `Execute the risk-linked oracle set for ${row.micro_capability_id} and retain reproducible fixtures, observations and failure reasons.`,
      verifierType: "benchmark",
      metricId: "escaped_failure_rate",
      metricDefinition: `Rate of declared ${row.micro_capability_id} failure modes not detected by the assigned verifier and regression oracle.`,
      unit: "ratio",
      direction: "lower_is_better",
      operator: "lte",
      target: 0,
    };
  }
  if (/(learn|memory|feedback|outcome|pattern|lesson|consolid|knowledge_gap)/.test(text)) {
    return {
      id: "outcome_bounded_learning",
      operation: `Compare versioned outcomes and counterexamples for ${row.micro_capability_id} before emitting a tenant-scoped learning candidate.`,
      verifierType: "cross_check",
      metricId: "counterexample_survival_rate",
      metricDefinition: `Share of ${row.micro_capability_id} candidates that remain valid after replay against counterexamples and prior outcomes.`,
      unit: "ratio",
      direction: "higher_is_better",
      operator: "gte",
      target: 0.9,
    };
  }
  if (/(language|tone|summary|explain|audience|communication|localiz|citation_renderer|plain)/.test(text)) {
    return {
      id: "semantic_invariance_transformation",
      operation: `Transform ${row.micro_capability_id} for the intended audience while retaining claims, uncertainty, status and authority.`,
      verifierType: "cross_check",
      metricId: "semantic_preservation_rate",
      metricDefinition: `Share of material ${row.micro_capability_id} facts, qualifiers and authority states preserved after presentation.`,
      unit: "ratio",
      direction: "higher_is_better",
      operator: "gte",
      target: 0.98,
    };
  }
  if (/(price|pricing|billing|payment|sale|inventory|revenue|cost|margin|finance|commerce)/.test(text)) {
    return {
      id: "financial_ledger_reconciliation",
      operation: `Reconcile source amounts, units, currency, tax and ledger relationships for ${row.micro_capability_id} without inventing values.`,
      verifierType: "deterministic_rule",
      metricId: "financial_reconciliation_error_rate",
      metricDefinition: `Rate of ${row.micro_capability_id} monetary records that fail exact source, unit, currency or total reconciliation.`,
      unit: "ratio",
      direction: "lower_is_better",
      operator: "lte",
      target: 0,
    };
  }
  if (/(analyz|image|skin|acquisition|subject|cosmetic|clinical|longitudinal|capture|device)/.test(text)) {
    return {
      id: "subject_measurement_validation",
      operation: `Validate subject isolation, acquisition conditions and longitudinal comparability for ${row.micro_capability_id}.`,
      verifierType: "evidence",
      metricId: "measurement_validity_rate",
      metricDefinition: `Share of ${row.micro_capability_id} measurements that pass acquisition, isolation and comparability controls.`,
      unit: "ratio",
      direction: "higher_is_better",
      operator: "gte",
      target: 0.95,
    };
  }
  if (/(software|code|repository|artifact|dependency|schema|api|migration|runtime|build|license)/.test(text)) {
    return {
      id: "artifact_graph_analysis",
      operation: `Inspect versioned artifacts and dependency edges for ${row.micro_capability_id}, retaining hashes and compatibility evidence.`,
      verifierType: "schema",
      metricId: "artifact_contract_coverage",
      metricDefinition: `Share of affected ${row.micro_capability_id} artifacts and interfaces covered by schema, compatibility and provenance checks.`,
      unit: "ratio",
      direction: "higher_is_better",
      operator: "gte",
      target: 0.95,
    };
  }
  return {
    id: "bounded_state_transformation",
    operation: `Transform the declared ${row.subbranch_id} state through ${row.micro_capability_id} while preserving supplied facts, constraints and abstention conditions.`,
    verifierType: "deterministic_rule",
    metricId: "contract_satisfaction_rate",
    metricDefinition: `Share of ${row.micro_capability_id} outputs satisfying all declared input, evidence, output and non-activation assertions.`,
    unit: "ratio",
    direction: "higher_is_better",
    operator: "gte",
    target: 0.95,
  };
}

function level4Segments(row) {
  const profile = mechanismProfile(row);
  return {
    method: fieldName(row.micro_capability_id, "method"),
    strategy: fieldName(row.micro_capability_id, "selection_strategy"),
    verifier: fieldName(row.micro_capability_id, "result_verifier"),
    metric: fieldName(row.micro_capability_id, profile.metricId),
  };
}

function capabilityFieldFor(row, nodeType, isInput) {
  return nodeType === "specialized_capability"
    ? fieldName(row.specialized_capability_id, isInput ? "request" : "decision")
    : nodeType === "micro_capability"
      ? fieldName(row.micro_capability_id, isInput ? "input" : "result")
      : fieldName(row.micro_capability_id, isInput
        ? {
            method: "evidence",
            strategy: "candidate_paths",
            verifier: "candidate_output",
            metric: "observations",
          }[nodeType]
        : {
            method: "procedure_trace",
            strategy: "selected_path",
            verifier: "verification",
            metric: "measurement",
          }[nodeType]);
}

function mechanismIdFor(row, nodeType) {
  return `${mechanismProfile(row, nodeType).id}:${nodeType}:${shortHash(`${row.branch_id}.${row.subbranch_id}.${row.micro_capability_id}`)}`;
}

function riskClassFor(row) {
  const text = [
    row.branch_id,
    row.subbranch_id,
    row.problem_solved,
    row.failure_modes,
    row.specialized_purpose,
    row.micro_purpose,
  ].join(" ").toLowerCase();
  if (/(cross-tenant|tenant leak|secret|credential|authoriz|permission|consent|deploy|release|publish|rollback|policy change|medical|clinical|payment|billing|financial|destructive|irreversible|injection)/.test(text)) {
    return "high";
  }
  if (/(language selection|tone|localization|format|summary consistency|audience model)/.test(text)) return "low";
  return "medium";
}

function metricFormulaFor(profile) {
  if (profile.metricId === "supported_claim_coverage") return "supported_evidence/required_evidence";
  if (profile.direction === "lower_is_better" && profile.metricId === "escaped_failure_rate") {
    return "escaped_failures/declared_failure_modes";
  }
  if (profile.direction === "lower_is_better") return "invalid_records/total_records";
  return "valid_records/total_records";
}

function metricSourceFieldsFor(formula) {
  return {
    "verified_assertions/total_assertions": ["total_assertions", "verified_assertions"],
    "1-(verified_assertions/total_assertions)": ["total_assertions", "verified_assertions"],
    "supported_evidence/required_evidence": ["required_evidence", "supported_evidence"],
    "escaped_failures/declared_failure_modes": ["declared_failure_modes", "escaped_failures"],
    "valid_records/total_records": ["total_records", "valid_records"],
    "invalid_records/total_records": ["invalid_records", "total_records"],
  }[formula] || [];
}

function capabilitySpecHash(row, nodeType) {
  const text = textForNode(row, nodeType);
  return sha256({
    branch_id: row.branch_id,
    subbranch_id: row.subbranch_id,
    node_type: nodeType,
    purpose: text.purpose,
    problem_solved: text.problem,
    specialized_purpose: row.specialized_purpose,
    micro_purpose: row.micro_purpose,
    required_evidence: splitResearchCell(row.required_evidence),
    failure_modes: splitResearchCell(row.failure_modes),
    overlap_boundary: row.overlap_notes,
  });
}

function capabilityRecordClaimHash(row, nodeType) {
  const level = nodeType === "specialized_capability" ? 2 : nodeType === "micro_capability" ? 3 : 4;
  return functionSpecFor(row, nodeType, level).observation_contract_hash;
}

function operationBasis(row, nodeType) {
  const text = textForNode(row, nodeType);
  return {
    kind: "node_function_basis_v1",
    node_type: nodeType,
    branch_id: row.branch_id,
    subbranch_id: row.subbranch_id,
    purpose: text.purpose,
    problem_solved: text.problem,
    evidence_claims: evidenceRequirements(row, nodeType).map((requirement) => requirement.description),
    failure_scenarios: failureModes(row, nodeType).map((failure) => failure.scenario),
    overlap_exclusion: row.overlap_notes,
  };
}

function keyedAssertion(body) {
  return { ...body, key: canonicalDigest(body) };
}

function semanticAssertions(row, nodeType) {
  const text = textForNode(row, nodeType);
  const subject = `${row.branch_id}.${row.subbranch_id}:${row.micro_capability_id}:${nodeType}`;
  return {
    problem_resolution: keyedAssertion({
      subject,
      predicate: "resolves_problem",
      object: text.problem,
      polarity: "positive",
    }),
    evidence_support: evidenceRequirements(row, nodeType).map((requirement) => keyedAssertion({
      subject,
      predicate: "supported_by_evidence",
      object: requirement.description,
      polarity: "positive",
    })),
    failure_absence: failureModes(row, nodeType).map((failure) => keyedAssertion({
      subject,
      predicate: "excludes_failure",
      object: failure.scenario,
      polarity: "negative",
    })),
    boundary_preservation: keyedAssertion({
      subject,
      predicate: "preserves_boundary",
      object: text.purpose,
      polarity: "positive",
    }),
  };
}

function functionSpecFor(row, nodeType, level, functionId = "") {
  const assertions = semanticAssertions(row, nodeType);
  const profile = mechanismProfile(row, nodeType);
  const formula = metricFormulaFor(profile);
  const semanticSource = {
    branch_id: row.branch_id,
    subbranch_id: row.subbranch_id,
    level,
    node_type: nodeType,
    problem: textForNode(row, nodeType).problem,
    purpose: textForNode(row, nodeType).purpose,
    evidence_requirements: evidenceRequirements(row, nodeType).map((requirement) => requirement.description),
    failure_exclusions: failureModes(row, nodeType).map((failure) => failure.scenario),
    overlap_exclusion: row.overlap_notes,
  };
  const executionPlan = {
    kind: "semantic_function_plan_v1",
    operation: profile.id,
    role_projection: {
      specialized_capability: "aggregate_micro_decision",
      micro_capability: "emit_failure_bounded_finding",
      method: "emit_procedure_trace",
      strategy: "select_primary_or_fallback",
      verifier: "emit_independent_oracle_result",
      metric: "emit_quality_measurement",
    }[nodeType],
    strategy_cases: [
      { when: "all_assertions_satisfied", transition: "primary" },
      { when: "required_evidence_missing", transition: "fallback" },
      { when: "failure_observed", transition: "fallback" },
      { when: "boundary_violated", transition: "human_review" },
    ],
    verifier_assertion_keys: [
      assertions.problem_resolution.key,
      ...assertions.evidence_support.map((assertion) => assertion.key),
      ...assertions.failure_absence.map((assertion) => assertion.key),
      assertions.boundary_preservation.key,
    ],
    metric_population: {
      eligibility_assertion_key: assertions.problem_resolution.key,
      numerator_assertion_keys: [
        ...assertions.evidence_support.map((assertion) => assertion.key),
        ...assertions.failure_absence.map((assertion) => assertion.key),
        assertions.boundary_preservation.key,
      ],
      denominator_assertion_keys: [
        assertions.problem_resolution.key,
        ...assertions.evidence_support.map((assertion) => assertion.key),
        ...assertions.failure_absence.map((assertion) => assertion.key),
        assertions.boundary_preservation.key,
      ],
      formula,
      zero_denominator: "fail_closed",
    },
  };
  const content = {
    source_row_hash: canonicalDigest({
      branch_id: row.branch_id,
      subbranch_id: row.subbranch_id,
      problem_solved: row.problem_solved,
      specialized_purpose: row.specialized_purpose,
      micro_purpose: row.micro_purpose,
      failure_modes: row.failure_modes,
      required_evidence: row.required_evidence,
      overlap_notes: row.overlap_notes,
    }),
    semantic_source: semanticSource,
    semantic_assertions: assertions,
    execution_plan: executionPlan,
  };
  return {
    function_id: functionId,
    ...content,
    semantic_function_hash: canonicalDigest(content),
    execution_plan_hash: canonicalDigest(executionPlan),
    observation_contract_hash: canonicalDigest(assertions),
  };
}

function evidenceAcceptanceProgram(requirement, capabilitySpec) {
  return {
    kind: "evidence_claim_gate_v1",
    capability_spec_hash: capabilitySpec,
    required_claim_hash: requirement.semantic_claim_hash,
    required_claim: requirement.description,
    required_content_tag: requirement.content_tag,
    require_fact_equal_to_claim: true,
    require_subject_binding: true,
    require_record_binding: true,
    require_core_manifest_binding: true,
  };
}

function evidenceAcceptanceRule(program) {
  return `Execute ${program.kind} ${canonicalDigest(program)}: require the exact claim, content tag, subject, record and Core manifest bindings for capability spec ${program.capability_spec_hash}.`;
}

function methodProgram(row, nodeType, level, profile, inputField, outputField) {
  const functionSpec = functionSpecFor(row, nodeType, level);
  return {
    kind: "capability_method_program_v2",
    capability_spec_hash: capabilitySpecHash(row, nodeType),
    record_claim_hash: functionSpec.observation_contract_hash,
    semantic_function_hash: functionSpec.semantic_function_hash,
    execution_plan_hash: functionSpec.execution_plan_hash,
    operation: profile.id,
    role_projection: functionSpec.execution_plan.role_projection,
    input_field: inputField,
    output_field: outputField,
    consume: [
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
    ],
    transform: {
      kind: "record_digest_projection_v1",
      record_value_digest_required: true,
      evidence_digest_required: true,
      failure_detector_required: true,
    },
  };
}

function strategyProgram(capabilitySpec, failureTransition, functionSpec) {
  return {
    kind: "strategy_gate_v1",
    capability_spec_hash: capabilitySpec,
    semantic_function_hash: functionSpec.semantic_function_hash,
    all: ["method.valid", "semantic_observation.valid", "evidence.coverage_eq_1", "policy.allows", "input.valid"],
    decision_cases: functionSpec.execution_plan.strategy_cases,
    on_false: failureTransition,
  };
}

function strategyRule(program) {
  return `Execute ${program.kind} ${canonicalDigest(program)}: select only when ${program.all.join(", ")}; otherwise ${program.on_false}.`;
}

function verifierProgram(capabilitySpec, functionSpec) {
  return {
    kind: "verifier_gate_v1",
    capability_spec_hash: capabilitySpec,
    semantic_function_hash: functionSpec.semantic_function_hash,
    semantic_assertion_keys: functionSpec.execution_plan.verifier_assertion_keys,
    all: [
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
    ],
  };
}

function verifierCondition(program) {
  return `Execute ${program.kind} ${canonicalDigest(program)} and require every independent check: ${program.all.join(", ")}.`;
}

function metricProgram(capabilitySpec, profile, functionSpec) {
  const formula = metricFormulaFor(profile);
  return {
    kind: "metric_formula_v1",
    capability_spec_hash: capabilitySpec,
    semantic_function_hash: functionSpec.semantic_function_hash,
    population: functionSpec.execution_plan.metric_population,
    formula,
    source_fields: metricSourceFieldsFor(formula),
    threshold_operator: profile.operator,
    target: profile.target,
    unit: profile.unit,
  };
}

function metricDefinition(program) {
  return `Execute ${program.kind} ${canonicalDigest(program)}: compute ${program.formula} from ${program.source_fields.join(", ")} and require ${program.threshold_operator} ${program.target} ${program.unit} for capability spec ${program.capability_spec_hash}.`;
}

function observationAssertionSchema(description) {
  return {
    type: "object",
    description,
    additionalProperties: false,
    properties: {
      key: { type: "string", pattern: "^[a-f0-9]{64}$" },
      subject: { type: "string", minLength: 4, maxLength: 512 },
      predicate: { type: "string", minLength: 4, maxLength: 64 },
      object: { type: "string", minLength: 8, maxLength: 1600 },
      polarity: { type: "string", enum: ["positive", "negative"] },
      result: { type: "string", enum: ["resolved", "supported", "not_observed", "preserved"] },
      evidence_ids: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", minLength: 4, maxLength: 128 },
      },
    },
    required: ["key", "subject", "predicate", "object", "polarity", "result", "evidence_ids"],
  };
}

function semanticObservationSchema(row, nodeType) {
  const level = nodeType === "specialized_capability" ? 2 : nodeType === "micro_capability" ? 3 : 4;
  const spec = functionSpecFor(row, nodeType, level);
  return {
    type: "object",
    description: `Structured semantic observation for ${row.branch_id}.${row.subbranch_id} ${nodeType}.`,
    additionalProperties: false,
    properties: {
      function_hash: { type: "string", const: spec.semantic_function_hash },
      problem_resolution: observationAssertionSchema("Problem-resolution assertion joined to Core evidence."),
      evidence_support: {
        type: "array",
        minItems: spec.semantic_assertions.evidence_support.length,
        maxItems: spec.semantic_assertions.evidence_support.length,
        uniqueItems: true,
        items: observationAssertionSchema("Required evidence assertion."),
      },
      failure_absence: {
        type: "array",
        minItems: spec.semantic_assertions.failure_absence.length,
        maxItems: spec.semantic_assertions.failure_absence.length,
        uniqueItems: true,
        items: observationAssertionSchema("Observed absence of a declared failure."),
      },
      boundary_preservation: observationAssertionSchema("Ownership-boundary preservation assertion."),
      artifact_refs: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            ref: { type: "string", minLength: 4, maxLength: 512 },
            sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
          },
          required: ["ref", "sha256"],
        },
      },
    },
    required: [
      "function_hash",
      "problem_resolution",
      "evidence_support",
      "failure_absence",
      "boundary_preservation",
      "artifact_refs"
    ],
  };
}

function ioSchema(nodeId, direction, row, nodeType) {
  const isInput = direction === "input";
  const schemaId = `https://schemas.skinharmony.internal/nyra/v2/${nodeId}/${direction}`;
  const capabilityField = capabilityFieldFor(row, nodeType, isInput);
  const properties = isInput
    ? {
        tenant_id: {
          type: "string",
          description: `Authenticated tenant partition required by ${nodeId}.`,
          minLength: 2,
          maxLength: 128,
        },
        core_route: {
          type: "object",
          description: `Universal Core route proving ${row.branch_id} is open for this request.`,
          additionalProperties: false,
          properties: {
            opened_branch_id: {
              type: "string",
              description: `Core-opened branch identifier for ${row.branch_id}.`,
              const: row.branch_id,
            },
          },
          required: ["opened_branch_id"],
        },
        evidence_bundle: {
          type: "array",
          description: `Provenanced evidence required to evaluate ${row.micro_capability_id}.`,
          minItems: 0,
          items: {
            type: "object",
            description: `Evidence item for ${row.subbranch_id}.`,
            additionalProperties: false,
            properties: {
              evidence_id: {
                type: "string",
                description: `Stable evidence identifier for ${row.subbranch_id}.`,
                minLength: 4,
              },
              evidence_type: {
                type: "string",
                description: `Contract evidence type for ${row.subbranch_id}.`,
                minLength: 3,
              },
              tenant_id: {
                type: "string",
                description: `Authenticated evidence tenant for ${row.subbranch_id}.`,
                minLength: 2,
              },
              authority: {
                type: "string",
                description: `Evidence authority class for ${row.subbranch_id}.`,
                minLength: 3,
              },
              independent: {
                type: "boolean",
                description: `Whether the evidence is independent corroboration.`,
              },
              content_tags: {
                type: "array",
                description: `Envelope tags for ${row.subbranch_id}.`,
                minItems: 1,
                uniqueItems: true,
                items: { type: "string", description: "Evidence content tag.", minLength: 2 },
              },
              content: {
                type: "object",
                description: `Exact semantic evidence content for ${row.subbranch_id}.`,
                additionalProperties: false,
                properties: {
                  source_ref: { type: "string", description: "Stable evidence source reference.", minLength: 4 },
                  facts: {
                    type: "array",
                    description: "Structured facts asserted by the evidence.",
                    minItems: 1,
                    uniqueItems: true,
                    items: { type: "string", description: "Evidence fact.", minLength: 8 },
                  },
                  tags: {
                    type: "array",
                    description: "Semantic content tags.",
                    minItems: 1,
                    uniqueItems: true,
                    items: { type: "string", description: "Semantic tag.", minLength: 2 },
                  },
                  claim: { type: "string", description: "Exact capability evidence claim.", minLength: 8 },
                  claim_hash: { type: "string", description: "Semantic claim hash.", pattern: "^[a-f0-9]{64}$" },
                  semantic_hash: { type: "string", description: "Node semantic program hash.", pattern: "^[a-f0-9]{64}$" },
                  capability_input_hash: { type: "string", description: "Bound capability input hash.", pattern: "^[a-f0-9]{64}$" },
                  subject_hash: { type: "string", description: "Bound subject hash.", pattern: "^[a-f0-9]{64}$" },
                  record_hashes: {
                    type: "array",
                    description: "Bound record hashes.",
                    minItems: 1,
                    uniqueItems: true,
                    items: { type: "string", description: "Bound record hash.", pattern: "^[a-f0-9]{64}$" },
                  },
                },
                required: ["source_ref", "facts", "tags", "claim", "claim_hash", "semantic_hash", "capability_input_hash", "subject_hash", "record_hashes"],
              },
              observed_at: { type: "string", description: "Evidence observation time.", format: "date-time" },
              payload_hash: { type: "string", description: "Evidence payload hash.", pattern: "^[a-f0-9]{64}$" },
              provenance_hash: { type: "string", description: "Evidence provenance hash.", pattern: "^[a-f0-9]{64}$" },
            },
            required: ["evidence_id", "evidence_type", "tenant_id", "authority", "independent", "content_tags", "content", "observed_at", "payload_hash", "provenance_hash"],
          },
        },
        [capabilityField]: {
          type: "object",
          description: `${mechanismProfile(row, nodeType).operation} This is the bounded ${nodeType} input.`,
          additionalProperties: false,
          properties: {
            subbranch_id: {
              type: "string",
              description: `Live V1 subbranch targeted by ${nodeId}.`,
              const: row.subbranch_id,
            },
            mechanism_id: {
              type: "string",
              description: `Capability-specific mechanism selected for ${row.micro_capability_id}.`,
              const: mechanismIdFor(row, nodeType),
            },
            capability_spec_hash: {
              type: "string",
              description: `Immutable semantic specification hash for ${row.micro_capability_id}.`,
              const: capabilitySpecHash(row, nodeType),
            },
            problem_statement: {
              type: "string",
              description: `Concrete problem supplied to ${row.micro_capability_id}: ${row.problem_solved}`.slice(0, 256),
              const: textForNode(row, nodeType).problem,
            },
            evidence_requirement_tags: {
              type: "array",
              description: `Evidence content tags required by ${row.micro_capability_id}: ${row.required_evidence}`.slice(0, 256),
              minItems: 1,
              uniqueItems: true,
              items: {
                type: "string",
                description: `Content tag for evidence accepted by ${row.micro_capability_id}.`,
                minLength: 2,
                maxLength: 64,
              },
            },
            failure_mode_candidates: {
              type: "array",
              description: `Failure candidates that ${row.micro_capability_id} must detect: ${row.failure_modes}`.slice(0, 256),
              minItems: 1,
              uniqueItems: true,
              items: {
                type: "string",
                description: `Failure candidate evaluated by ${row.micro_capability_id}.`,
                minLength: 4,
                maxLength: 256,
              },
            },
            subject: {
              type: "string",
              description: `Concrete subject evaluated by ${row.micro_capability_id}.`,
              minLength: 4,
              maxLength: 512,
            },
            records: {
              type: "array",
              description: `Capability records consumed by ${mechanismProfile(row, nodeType).id} for ${row.micro_capability_id}.`,
              minItems: 1,
              uniqueItems: true,
              items: {
                type: "object",
                description: `Versioned record consumed by ${row.micro_capability_id}.`,
                additionalProperties: false,
                properties: {
                  id: {
                    type: "string",
                    description: `Stable record identifier for ${row.micro_capability_id}.`,
                    minLength: 4,
                    maxLength: 128,
                  },
                  semantic_observation: semanticObservationSchema(row, nodeType),
                  claim_hash: {
                    type: "string",
                    description: `Capability-specific semantic claim bound to ${row.micro_capability_id}.`,
                    const: capabilityRecordClaimHash(row, nodeType),
                  },
                  status: {
                    type: "string",
                    description: `Policy or validity state evaluated by ${row.micro_capability_id}.`,
                    enum: ["valid", "allowed", "verified"],
                  },
                  observed_at: {
                    type: "string",
                    description: `Observation timestamp used by ${row.micro_capability_id}.`,
                    format: "date-time",
                  },
                  relations: {
                    type: "array",
                    description: `Typed record relationships evaluated by ${row.micro_capability_id}.`,
                    minItems: 0,
                    uniqueItems: true,
                    items: {
                      type: "string",
                      description: `Related record identifier for ${row.micro_capability_id}.`,
                      minLength: 4,
                      maxLength: 128,
                    },
                  },
                  failure_signals: {
                    type: "array",
                    description: `Explicit declared failures observed for ${row.micro_capability_id}; an empty set is required for advisory success.`,
                    minItems: 0,
                    uniqueItems: true,
                    items: {
                      type: "string",
                      enum: failureModes(row, nodeType).map((failure) => failure.id),
                    },
                  },
                },
                required: ["id", "semantic_observation", "claim_hash", "status", "observed_at", "relations", "failure_signals"],
              },
            },
          },
          required: ["subbranch_id", "mechanism_id", "capability_spec_hash", "problem_statement", "evidence_requirement_tags", "failure_mode_candidates", "subject", "records"],
        },
      }
    : {
        [capabilityField]: {
          type: "object",
          description: `${nodeType} result produced by ${mechanismProfile(row, nodeType).id} for ${row.micro_capability_id}.`,
          additionalProperties: false,
          properties: {
            status: {
              type: "string",
              description: `Outcome state emitted by ${nodeId}.`,
              enum: ["satisfied", "abstained", "human_review"],
            },
            mechanism_id: {
              type: "string",
              description: `Executed mechanism for ${row.micro_capability_id}.`,
              const: mechanismIdFor(row, nodeType),
            },
            finding: {
              type: "string",
              description: `Capability-specific finding satisfying this purpose: ${row.micro_purpose}`.slice(0, 256),
              minLength: 8,
              maxLength: 2000,
            },
            evidence_refs: {
              type: "array",
              description: `Evidence identifiers supporting the ${row.micro_capability_id} finding.`,
              minItems: 1,
              uniqueItems: true,
              items: {
                type: "string",
                description: `Stable evidence reference used by ${row.micro_capability_id}.`,
                minLength: 4,
                maxLength: 128,
              },
            },
            failure_flags: {
              type: "array",
              description: `Detected failure-mode flags for ${row.micro_capability_id}; an empty array means all declared checks passed.`,
              minItems: 0,
              uniqueItems: true,
              items: {
                type: "string",
                description: `Failure-mode identifier detected by ${row.micro_capability_id}.`,
                minLength: 4,
                maxLength: 128,
              },
            },
            result_hash: {
              type: "string",
              description: `SHA-256 integrity hash for the ${row.micro_capability_id} result and evidence refs.`,
              pattern: "^[a-f0-9]{64}$",
            },
          },
          required: ["status", "mechanism_id", "finding", "evidence_refs", "failure_flags", "result_hash"],
        },
        confidence: {
          type: "number",
          description: `Calibrated confidence for ${row.subbranch_id} within the admitted evidence.`,
          minimum: 0,
          maximum: 1,
        },
        verifier_results: {
          type: "array",
          description: `Independent verification results for ${row.micro_capability_id}.`,
          minItems: 1,
          items: {
            type: "string",
            description: `Verifier result identifier and pass or fail state for ${nodeId}.`,
            minLength: 4,
          },
        },
        route_decision: {
          type: "string",
          description: `Advisory next route; Universal Core remains final authority for ${nodeId}.`,
          enum: ["continue", "fallback", "abstain", "human_review"],
        },
      };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: schemaId,
    title: `${nodeType} ${direction} for ${row.subbranch_id}`,
    description: `${direction === "input" ? "Input" : "Output"} contract for ${nodeId}; it is tenant-scoped and bound to a Core-opened V1 branch.`,
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function failureModes(row, nodeType) {
  return splitResearchCell(row.failure_modes).map((failure, index) => ({
    id: slug(`${nodeType}_${index + 1}_${failure}`),
    scenario: `${nodeType} ${row.micro_capability_id} encounters: ${failure}`,
    detection: `The ${row.micro_capability_id} verifier observes evidence or output inconsistent with "${failure}".`,
    impact: `The ${row.subbranch_id} result becomes unsafe, unsupported or incorrectly routed if this condition escapes.`,
    response: `Stop ${nodeType} evaluation, record the reason code and use the declared V1 fallback under Universal Core authority.`,
  }));
}

function evidenceRequirements(row, nodeType) {
  const items = splitResearchCell(row.required_evidence);
  const riskClass = riskClassFor(row);
  return items.map((evidence, index) => {
    const description = `For ${row.micro_capability_id}, this evidence must supply: ${evidence}`;
    const contentTag = slug(`${row.micro_capability_id}_${index + 1}_${evidence}`);
    const semanticClaimHash = sha256({
      description,
      content_tag: contentTag,
      capability_spec_hash: capabilitySpecHash(row, nodeType),
    });
    const acceptanceProgram = evidenceAcceptanceProgram({
      description,
      content_tag: contentTag,
      semantic_claim_hash: semanticClaimHash,
    }, capabilitySpecHash(row, nodeType));
    const acceptanceRule = evidenceAcceptanceRule(acceptanceProgram);
    return {
      evidence_type: slug(`${row.subbranch_id}_${nodeType}_${index + 1}`),
      minimum_count: 1,
      authority_requirement: index === 0 ? "authoritative" : "independent_corroboration",
      freshness_seconds: riskClass === "high" ? 86400 : 604800,
      provenance_required: true,
      on_missing: riskClass === "high" ? "human_review" : "abstain",
      description,
      acceptance_rule: acceptanceRule,
      content_tag: contentTag,
      content_fields: [
        "source_ref",
        "facts",
        "claim",
        "claim_hash",
        "semantic_hash",
        "capability_input_hash",
        "subject_hash",
        "record_hashes",
      ],
      semantic_claim_hash: semanticClaimHash,
      acceptance_program: acceptanceProgram,
    };
  });
}

function auditFields(nodeId) {
  const source = `Runtime contract ${shortHash(nodeId)}`;
  return [
    ["tenant_id", "Authenticated Core tenant partition", "pseudonymize"],
    ["request_id", "Nyra request correlation identifier", "none"],
    ["node_id", source, "none"],
    ["contract_version", "Immutable V2 contract metadata", "none"],
    ["core_verdict", "Universal Core route or policy decision", "none"],
    ["timestamp", "Trusted runtime observation clock", "none"],
    ["reason_codes", `Verifier and fallback reasons for ${shortHash(nodeId)}`, "truncate"],
  ].map(([name, fieldSource, redaction]) => ({
    name,
    source: fieldSource,
    required: true,
    redaction,
  }));
}

function provenanceFields(nodeId) {
  return [
    ["contract_hash", `Canonical contract hash for ${shortHash(nodeId)}`],
    ["source_refs", `Live catalogue and research references for ${shortHash(nodeId)}`],
    ["evidence_hashes", `Tenant evidence hashes used by ${shortHash(nodeId)}`],
    ["route_trace", `Core-opened route trace for ${shortHash(nodeId)}`],
    ["policy_snapshot_hash", `Core policy snapshot observed by ${shortHash(nodeId)}`],
  ].map(([name, source]) => ({
    name,
    source,
    required: true,
    redaction: name === "source_refs" ? "remove_secret" : "none",
  }));
}

function semanticContractFor(node) {
  const method = node.methods[0];
  const strategy = node.strategies[0];
  const verifier = node.verifiers[0];
  const metric = node.metrics[0];
  const projection = {
    problem_hash: textHash(node.problem_solved),
    purpose_hash: canonicalDigest(node.purpose),
    evidence_claim_hashes: node.required_evidence.map((item) => item.semantic_claim_hash),
    evidence_program_hashes: node.required_evidence.map((item) => canonicalDigest(item.acceptance_program)),
    failure_signature_hashes: node.failure_modes.map((item) => canonicalDigest(normalizedText(item.scenario))),
    operation: method.operation,
    mechanism_id: method.parameters.mechanism_id,
    capability_id: method.parameters.capability_id,
    capability_spec_hash: method.parameters.capability_spec_hash,
    record_claim_hash: method.parameters.record_claim_hash,
    transformation_goal_hash: canonicalDigest(method.parameters.transformation_goal),
    semantic_function_hash: method.program.semantic_function_hash,
    execution_plan_hash: method.program.execution_plan_hash,
    role_projection_hash: canonicalDigest(method.program.role_projection),
    method_program_hash: canonicalDigest(method.program),
    strategy_predicate: strategy.selection_predicate,
    strategy_rule_hash: canonicalDigest(strategy.selection_rule),
    strategy_program_hash: canonicalDigest(strategy.predicate_program),
    verifier_pass_condition_hash: canonicalDigest(verifier.pass_condition),
    verifier_program_hash: canonicalDigest(verifier.predicate_program),
    verifier_checks: [...verifier.checks].sort(),
    metric_formula: metric.formula,
    metric_source_fields: [...metric.source_fields].sort(),
    metric_definition_hash: canonicalDigest(metric.definition),
    metric_program_hash: canonicalDigest(metric.formula_program),
    core_policy_bindings_hash: canonicalDigest(node.core_policy_bindings),
    function_binding_hash: canonicalDigest(node.function_binding || {}),
  };
  return {
    program_id: `program_${projection.capability_spec_hash.slice(0, 24)}_${node.node_type}`,
    ...projection,
    semantic_hash: canonicalDigest(projection),
  };
}

function confidenceCalibration() {
  const vectors = [
    { evidence_coverage: 1, authority_compliance: 1, freshness_compliance: 1, input_validity: 1, expected_score: 1 },
    { evidence_coverage: 1, authority_compliance: 1, freshness_compliance: 0, input_validity: 1, expected_score: 0.85 },
    { evidence_coverage: 1, authority_compliance: 0, freshness_compliance: 1, input_validity: 1, expected_score: 0.8 },
    { evidence_coverage: 0.5, authority_compliance: 1, freshness_compliance: 1, input_validity: 1, expected_score: 0.75 },
    { evidence_coverage: 0, authority_compliance: 1, freshness_compliance: 1, input_validity: 1, expected_score: 0.5 },
    { evidence_coverage: 1, authority_compliance: 0, freshness_compliance: 0, input_validity: 1, expected_score: 0.65 },
    { evidence_coverage: 0, authority_compliance: 0, freshness_compliance: 0, input_validity: 1, expected_score: 0.15 },
  ];
  return {
    profile_id: "nyra_confidence_calibration_v2",
    formula: "0.50*evidence_coverage+0.20*authority_compliance+0.15*freshness_compliance+0.15*input_validity",
    vectors,
    dataset_hash: sha256(vectors),
    monotonic_components_required: true,
    invalid_advisory_count_budget: 0,
  };
}

function testCase(nodeId, row, kind) {
  const hash = shortHash(`${nodeId}:${kind}`);
  const expectations = {
    positive: {
      objective: `Prove ${nodeId} activates only with the required Core route and evidence for ${row.subbranch_id}.`,
      assertions: [`${nodeId} emits its declared output schema`, "execution_authorized remains false", "all evidence keeps tenant provenance"],
      verdict: "ALLOW_ADVISORY",
    },
    negative: {
      objective: `Prove ${nodeId} does not activate when ${row.subbranch_id} evidence or the Core-opened branch is absent.`,
      assertions: [`${nodeId} emits no advisory result`, "the declared V1 fallback is selected", "the non-activation reason is audited"],
      verdict: "ABSTAIN",
    },
    adversarial: {
      objective: `Prove ${nodeId} rejects cross-tenant evidence, spoofed Core routes and source instructions for ${row.subbranch_id}.`,
      assertions: ["cross-tenant material is rejected", "client-supplied authority cannot open a branch", "the route fails closed without execution"],
      verdict: "DENY",
    },
    regression: {
      objective: `Prove disabling V2 leaves the V1 ${row.branch_id}.${row.subbranch_id} route and response authoritative.`,
      assertions: ["V1 branch identifier is unchanged", "V1 fallback remains reachable", "no V2 result authorizes execution"],
      verdict: "ALLOW_ADVISORY",
    },
  }[kind];
  return {
    id: `${kind}_${hash}`,
    objective: expectations.objective,
    input_fixture: `catalog-fixture/${hash}/${kind}`,
    assertions: expectations.assertions,
    expected_core_verdict: expectations.verdict,
    ...(kind === "regression" ? { v1_compatibility: true } : {}),
  };
}

function buildFixtureBundle(catalog, observedAt) {
  const fixtures = {};
  const functionById = new Map(catalog.function_registry.functions.map((spec) => [spec.function_id, spec]));
  const v1HorizontalInput = { message: "compatibility fixture", request_id: "v1-golden" };
  const v1HorizontalOutput = createNyraHorizontalRuntime({
    NYRA_DEEP_BRANCH_V2_ENABLED: "false",
  }).prepareInterpretation(v1HorizontalInput);
  const v1CatalogInput = { domain_pack_id: "skinharmony" };
  const v1CatalogOutput = nyraBranchCatalog(v1CatalogInput.domain_pack_id);
  const v1Routes = Object.fromEntries(catalog.branches.map((branch) => {
    const input = {
      text: "compatibility fixture",
      requestedBranches: [branch.id],
      domainPackId: "skinharmony",
    };
    const output = routeNyraBranches(input);
    return [branch.id, {
      input,
      output,
      output_hash: sha256(output),
    }];
  }));
  for (const node of catalog.nodes) {
    const functionSpec = functionById.get(node.id);
    if (!functionSpec) throw new Error(`Missing function spec for fixture ${node.id}`);
    const evidenceIds = node.required_evidence.map((requirement, index) => (
      `ev_${shortHash(`${node.id}:${requirement.evidence_type}:${index}`)}`
    ));
    const bindAssertion = (assertion, result) => ({
      ...assertion,
      result,
      evidence_ids: [...evidenceIds],
    });
    const semanticObservation = {
      function_hash: functionSpec.semantic_function_hash,
      problem_resolution: bindAssertion(functionSpec.semantic_assertions.problem_resolution, "resolved"),
      evidence_support: functionSpec.semantic_assertions.evidence_support.map((assertion, index) => ({
        ...assertion,
        result: "supported",
        evidence_ids: [evidenceIds[index]],
      })),
      failure_absence: functionSpec.semantic_assertions.failure_absence.map((assertion) => (
        bindAssertion(assertion, "not_observed")
      )),
      boundary_preservation: bindAssertion(
        functionSpec.semantic_assertions.boundary_preservation,
        "preserved"
      ),
      artifact_refs: [{
        ref: `fixture://${node.branch_id}/${node.id.split(".")[1]}/semantic-observation`,
        sha256: canonicalDigest(functionSpec.semantic_assertions),
      }],
    };
    const capabilityInput = {
      subbranch_id: node.id.split(".")[1],
      mechanism_id: node.methods[0].parameters.mechanism_id,
      capability_spec_hash: node.methods[0].parameters.capability_spec_hash,
      problem_statement: node.problem_solved,
      evidence_requirement_tags: node.required_evidence.map((requirement) => requirement.content_tag),
      failure_mode_candidates: node.failure_modes.map((failure) => failure.id),
      subject: `Executable fixture subject for ${node.id}`,
      records: [
        {
          id: `record_${shortHash(node.id)}`,
          semantic_observation: semanticObservation,
          claim_hash: node.methods[0].parameters.record_claim_hash,
          status: "verified",
          observed_at: observedAt,
          relations: [],
          failure_signals: [],
        },
      ],
    };
    const semanticFacts = [
      functionSpec.semantic_assertions.problem_resolution.object,
      ...functionSpec.semantic_assertions.evidence_support.map((assertion) => assertion.object),
      ...functionSpec.semantic_assertions.failure_absence.map((assertion) => assertion.object),
      functionSpec.semantic_assertions.boundary_preservation.object,
    ];
    const evidence = node.required_evidence.map((requirement, index) => {
      const content = {
        source_ref: `fixture://${node.branch_id}/${node.id.split(".")[1]}/${index + 1}`,
        facts: [...new Set([requirement.description, ...semanticFacts])],
        tags: [requirement.content_tag],
        claim: requirement.description,
        claim_hash: requirement.semantic_claim_hash,
        semantic_hash: node.semantic_contract.semantic_hash,
        capability_input_hash: sha256(capabilityInput),
        subject_hash: canonicalDigest(capabilityInput.subject),
        record_hashes: capabilityInput.records.map((record) => sha256(record)),
      };
      const payloadHash = sha256(content);
      const item = {
        evidence_id: evidenceIds[index],
        evidence_type: requirement.evidence_type,
        tenant_id: "codexai",
        authority: requirement.authority_requirement,
        independent: requirement.authority_requirement === "independent_corroboration",
        content_tags: [requirement.content_tag],
        content,
        observed_at: observedAt,
        payload_hash: payloadHash,
      };
      item.provenance_hash = sha256({
        tenant_id: item.tenant_id,
        evidence_type: item.evidence_type,
        authority: item.authority,
        independent: item.independent,
        content: item.content,
        payload_hash: item.payload_hash,
        observed_at: item.observed_at,
      });
      return item;
    });
    const makeCorePayload = (evidenceItems) => {
      const manifestPayload = {
        issuer: "universal_core",
        tenant_id: "codexai",
        node_id: node.id,
        branch_id: node.branch_id,
        semantic_hash: node.semantic_contract.semantic_hash,
        function_registry_hash: node.function_binding.registry_hash,
        semantic_function_hash: node.function_binding.semantic_function_hash,
        capability_input_hash: sha256(capabilityInput),
        evidence_hashes: evidenceItems.map((item) => item.provenance_hash),
      };
      const evidenceManifest = {
        ...manifestPayload,
        manifest_hash: sha256(manifestPayload),
      };
      const policyDecisions = node.core_policy_bindings.map((binding) => {
        const snapshot = {
          issuer: "universal_core",
          tenant_id: "codexai",
          node_id: node.id,
          branch_id: node.branch_id,
          policy_id: binding.policy_id,
          effect: binding.effect,
          decision: "ALLOW",
          semantic_hash: node.semantic_contract.semantic_hash,
          function_registry_hash: node.function_binding.registry_hash,
          semantic_function_hash: node.function_binding.semantic_function_hash,
          evidence_manifest_hash: evidenceManifest.manifest_hash,
        };
        return {
          policy_id: binding.policy_id,
          effect: binding.effect,
          decision: "ALLOW",
          snapshot,
          snapshot_hash: sha256(snapshot),
        };
      });
      return {
        tenant_id: "codexai",
        domain_pack: { id: "skinharmony" },
        result: {
          nyra_neural_network: {
            opened_by: "universal_core",
            opened_branches: [{ id: node.branch_id, status: "opened" }],
            execution_authorized: false,
          },
          evidence_manifest: evidenceManifest,
          policy_decisions: policyDecisions,
        },
      };
    };
    const corePayload = makeCorePayload(evidence);
    const common = {
      node_id: node.id,
      tenant_id: "codexai",
      subbranch_id: node.id.split(".")[1],
      core_payload: corePayload,
      evidence_source: "verified_fixture",
      capability_input: capabilityInput,
      observed_at: Date.parse(observedAt),
      verified_parent_ids: node.level > 2 ? [node.parent_id] : [],
    };
    const positiveFixtureId = node.positive_tests[0].input_fixture;
    fixtures[positiveFixtureId] = {
      ...common,
      fixture_kind: "positive",
      evidence,
      expected_state: "advisory_verified",
      expected_execution_authorized: false,
    };
    fixtures[node.negative_tests[0].input_fixture] = {
      fixture_kind: "negative",
      base_fixture: positiveFixtureId,
      core_payload: makeCorePayload([]),
      evidence: [],
      expected_state: ["high", "critical"].includes(node.risk_class)
        ? "human_review_required_contract_not_activated"
        : "fallback_contract_not_activated",
      expected_execution_authorized: false,
    };
    fixtures[node.adversarial_tests[0].input_fixture] = {
      fixture_kind: "adversarial",
      base_fixture: positiveFixtureId,
      evidence_tenant_override: "tenant-other",
      expected_state: "denied_tenant_isolation",
      expected_execution_authorized: false,
    };
    fixtures[node.regression_tests[0].input_fixture] = {
      fixture_kind: "regression",
      base_fixture: positiveFixtureId,
      feature_flags: {
        NYRA_DEEP_BRANCH_V2_ENABLED: "false",
        NYRA_DEEP_BRANCH_V2_MODE: "active",
        NYRA_DEEP_BRANCH_V2_BRANCHES: node.branch_id,
        NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: "codexai",
      },
      expected_route_state: "disabled_v1_authoritative",
      expected_execution_authorized: false,
      v1_golden_refs: {
        horizontal: "horizontal_runtime",
        catalog: "catalog_skinharmony",
        route: `route_${node.branch_id}`,
        expected_branch_id: node.branch_id,
        expected_subbranch_id: node.id.split(".")[1],
      },
    };
  }
  return {
    schema_version: "nyra_deep_branch_v2_executable_fixtures_v1",
    catalog_fingerprint: catalog.catalog_fingerprint,
    fixture_count: Object.keys(fixtures).length,
    v1_goldens: {
      source_pin: {
        repository_commit: "15cdd376a69fbba7f7ebef925d52aca16ad12be3",
        horizontal_runtime_pre_v2_sha256: "eea4aef34164f3681433aca0b338c93ed8276d719a18e379d124bc0b60b2a6d3",
        core_branch_network_sha256: "3d4d044086e10a552bf1f60e0d9acf0a84d30c08311afbda8ef6041c13c0d6ed",
      },
      horizontal_runtime: {
        input: v1HorizontalInput,
        output: v1HorizontalOutput,
        output_hash: sha256(v1HorizontalOutput),
      },
      catalog_skinharmony: {
        input: v1CatalogInput,
        output: v1CatalogOutput,
        output_hash: sha256(v1CatalogOutput),
      },
      ...Object.fromEntries(Object.entries(v1Routes).map(([branchId, golden]) => [`route_${branchId}`, golden])),
    },
    confidence_calibration: confidenceCalibration(),
    fixtures,
  };
}

function contractFor({
  row,
  nodeId,
  parentId,
  level,
  nodeType,
  next,
  sourceCheckpoint,
  supervisorStatus,
  coreBindings,
}) {
  const text = textForNode(row, nodeType);
  const profile = mechanismProfile(row, nodeType);
  const riskClass = riskClassFor(row);
  const nodeHash = shortHash(nodeId);
  const evidence = evidenceRequirements(row, nodeType);
  const nodeFailureModes = failureModes(row, nodeType);
  const inputField = capabilityFieldFor(row, nodeType, true);
  const outputField = capabilityFieldFor(row, nodeType, false);
  const failureTransition = riskClass === "high" ? "human_review" : "abstain";
  const functionSpec = functionSpecFor(row, nodeType, level);
  const methodProgramSpec = methodProgram(row, nodeType, level, profile, inputField, outputField);
  const strategyProgramSpec = strategyProgram(capabilitySpecHash(row, nodeType), failureTransition, functionSpec);
  const verifierProgramSpec = verifierProgram(capabilitySpecHash(row, nodeType), functionSpec);
  const metricProgramSpec = metricProgram(capabilitySpecHash(row, nodeType), profile, functionSpec);
  const contract = {
    id: nodeId,
    parent_id: parentId,
    branch_id: row.branch_id,
    level,
    node_type: nodeType,
    purpose: text.purpose,
    problem_solved: text.problem,
    failure_modes: nodeFailureModes,
    input_schema: ioSchema(nodeId, "input", row, nodeType),
    output_schema: ioSchema(nodeId, "output", row, nodeType),
    activation_conditions: [
      {
        condition_id: `core_open_${nodeHash}`,
        signal: "core.route.opened_branches",
        operator: "includes",
        expected: row.branch_id,
        reason: `Universal Core must explicitly open ${row.branch_id} before ${nodeId} can activate.`,
      },
      {
        condition_id: `subbranch_match_${nodeHash}`,
        signal: "request.subbranch_id",
        operator: "equals",
        expected: row.subbranch_id,
        reason: `${nodeId} is scoped only to the live ${row.subbranch_id} subbranch.`,
      },
      {
        condition_id: `evidence_ready_${nodeHash}`,
        signal: `capability.${slug(row.micro_capability_id)}.evidence_ready`,
        operator: "equals",
        expected: true,
        reason: `${nodeId} requires the ${profile.id} evidence set for ${row.micro_capability_id} before producing an advisory result.`,
      },
    ],
    non_activation_conditions: [
      {
        condition_id: `core_closed_${nodeHash}`,
        signal: "core.route.opened_branches",
        operator: "excludes",
        expected: row.branch_id,
        reason: `${nodeId} cannot locally open or infer the ${row.branch_id} branch.`,
      },
      {
        condition_id: `evidence_missing_${nodeHash}`,
        signal: `capability.${slug(row.micro_capability_id)}.evidence_ready`,
        operator: "not_equals",
        expected: true,
        reason: `${nodeId} abstains when the ${profile.id} evidence for ${row.subbranch_id} is missing or unverified.`,
      },
    ],
    dependencies: [
      {
        id: "universal_core_router",
        type: "universal_core",
        required: true,
        failure_behavior: "abstain",
      },
      {
        id: `${row.branch_id}/${row.subbranch_id}`,
        type: "v1_subbranch",
        required: true,
        failure_behavior: "fallback",
      },
      ...(level > 2
        ? [{
            id: parentId,
            type: "v2_node",
            required: true,
            failure_behavior: "fallback",
          }]
        : []),
    ],
    required_context: [
      {
        field: "tenant_id",
        source: "authenticated_request",
        sensitivity: "confidential",
        required: true,
        validation: `Must equal the tenant bound to the Core key for ${nodeHash}.`,
      },
      {
        field: "core.route_trace",
        source: "core_route",
        sensitivity: "internal",
        required: true,
        validation: `Must contain an authentic Core-opened ${row.branch_id} route.`,
      },
      {
        field: `capability.${slug(row.micro_capability_id)}`,
        source: "authenticated_request",
        sensitivity: "internal",
        required: true,
        validation: `Must carry the bounded ${profile.id} input for ${row.subbranch_id}, never a client authority override.`,
      },
    ],
    required_evidence: evidence,
    core_policy_bindings: [
      ...new Set(["tenant_isolation", ...coreBindings]),
    ].map((policyId, index) => ({
      policy_id: slug(policyId),
      effect: index === 0 ? "deny" : "require",
      enforcement_point: index === 0 ? "pre_activation" : "pre_core_join",
      on_deny: riskClass === "high" ? "human_review" : "abstain",
      core_decision_required: true,
    })),
    tenant_scope: {
      partition_key: "tenant_id",
      domain_pack_source: "authenticated_core_key",
      cross_tenant_allowed: false,
      cache_namespace: "tenant_id:branch_id:node_id:contract_version",
      memory_scope: "tenant_only",
      evidence_scope: "tenant_only",
    },
    risk_class: riskClass,
    confidence_method: {
      id: slug(`confidence_${nodeType}_${nodeHash}`),
      calculation: `For ${nodeId}, compute 0.50 times satisfied evidence coverage plus 0.20 authority compliance, 0.15 freshness compliance and 0.15 input validity; verifier and metric gates remain independent and the score never grants execution authority.`,
      evidence_basis: [
        `${row.required_evidence}`.slice(0, 256),
        `Verifier outcomes for ${row.micro_capability_id}`.slice(0, 256),
      ],
      calibration_reference: "reports/nyra-deep-v2/benchmark.json",
      abstain_below_threshold: true,
      formula: "0.50*evidence_coverage+0.20*authority_compliance+0.15*freshness_compliance+0.15*input_validity",
    },
    confidence_threshold: riskClass === "high" ? 0.9 : 0.8,
    methods: [{
      id: slug(`${profile.id}_${nodeType}_${nodeHash}`),
      description: `${profile.operation} This ${nodeType} contract terminates rather than broadening the task when its evidence is insufficient.`,
      steps: [
        `Bind ${row.specialized_capability_id} to the authenticated tenant and Core-opened ${row.branch_id} route.`,
        `Evaluate this evidence requirement for ${row.micro_capability_id}: ${row.required_evidence}`.slice(0, 256),
        `${row.micro_purpose} Record the transformation trace for the ${nodeType} result.`.slice(0, 256),
        `Test the declared failures before release: ${row.failure_modes}`.slice(0, 256),
      ],
      termination: `Terminate on verified output, declared fallback, abstention or required human review for ${nodeHash}.`,
      operation: profile.id,
      input_field: inputField,
      output_field: outputField,
      program: methodProgramSpec,
      parameters: {
        capability_id: nodeId,
        mechanism_id: mechanismIdFor(row, nodeType),
        capability_spec_hash: capabilitySpecHash(row, nodeType),
        record_claim_hash: functionSpecFor(row, nodeType, level).observation_contract_hash,
        problem_hash: `sha256:${sha256(text.problem)}`,
        transformation_goal: text.purpose,
        evidence_tags: evidence.map((requirement) => requirement.content_tag),
        failure_mode_ids: nodeFailureModes.map((failure) => failure.id),
      },
    }],
    strategies: [{
      id: slug(`${profile.id}_selection_${nodeHash}`),
      description: `Choose the ${profile.id} path for ${row.micro_capability_id} that satisfies the exact evidence set with the lowest unresolved failure exposure.`,
      selection_rule: strategyRule(strategyProgramSpec),
      failure_transition: failureTransition,
      selection_predicate: "method.valid&&semantic_observation.valid&&evidence.coverage==1&&policy.allows&&input.valid",
      predicate_program: strategyProgramSpec,
    }],
    verifiers: [{
      id: slug(`${profile.id}_verifier_${nodeHash}`),
      verifier_type: nodeType === "metric" ? "benchmark" : nodeType === "verifier" ? "cross_check" : profile.verifierType,
      input: `Output, evidence hashes and Core route for ${nodeHash}.`,
      pass_condition: verifierCondition(verifierProgramSpec),
      fail_action: riskClass === "high" ? "human_review" : "fallback",
      predicate_program: verifierProgramSpec,
      checks: [
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
      ],
    }],
    metrics: [{
      id: slug(`${profile.metricId}_${nodeType}_${nodeHash}`),
      definition: metricDefinition(metricProgramSpec),
      unit: profile.unit,
      direction: profile.direction,
      threshold_operator: profile.operator,
      target: profile.target,
      measurement_window: `Per request and rolling 100 evaluations for ${row.subbranch_id}.`,
      formula: metricFormulaFor(profile),
      source_fields: metricSourceFieldsFor(metricFormulaFor(profile)),
      formula_program: metricProgramSpec,
    }],
    routing: {
      selector: `Select ${nodeId}'s ${profile.id} mechanism only when tenant and branch gates pass, Core opened ${row.branch_id}, and evidence satisfies "${row.required_evidence}".`,
      next,
      core_open_required: true,
      on_no_match: riskClass === "high" ? "human_review" : "fallback",
    },
    fallback_node: `v1:${row.branch_id}/${row.subbranch_id}`,
    human_review_trigger: {
      conditions: [
        `Confidence is below the ${riskClass} threshold for ${nodeId}.`,
        `The ${riskClass} risk assignment derives from these concrete failure consequences: ${row.failure_modes}`.slice(0, 256),
      ],
      required_reviewer: riskClass === "high" ? "policy_owner" : "domain_reviewer",
      action: "pause_and_request_review",
      timeout_action: "abstain",
    },
    audit_fields: auditFields(nodeId),
    provenance_fields: provenanceFields(nodeId),
    positive_tests: [testCase(nodeId, row, "positive")],
    negative_tests: [testCase(nodeId, row, "negative")],
    adversarial_tests: [testCase(nodeId, row, "adversarial")],
    regression_tests: [testCase(nodeId, row, "regression")],
    v1_compatibility: {
      breaking_change: false,
      fallback_to_v1: true,
      v1_parent_preserved: true,
    },
    rollback_reference: {
      playbook_id: `rollback_${nodeHash}`,
      catalog_checkpoint: `sha256:${sourceCheckpoint}`,
      kill_switch: "NYRA_DEEP_BRANCH_V2_ENABLED=false",
      steps: [
        `Disable the V2 global gate before changing ${nodeId}.`,
        `Confirm routing returns to v1:${row.branch_id}/${row.subbranch_id}.`,
      ],
      verification: [
        `Run the V1 regression fixture catalog-fixture/${shortHash(`${nodeId}:regression`)}/regression.`,
        `Verify no ${nodeId} advisory output appears while the gate is disabled.`,
      ],
    },
    feature_flag: {
      gate: "NYRA_DEEP_BRANCH_V2_ENABLED",
      mode_gate: "NYRA_DEEP_BRANCH_V2_MODE",
      branch_gate: "NYRA_DEEP_BRANCH_V2_BRANCHES",
      tenant_gate: "NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST",
      default_enabled: false,
    },
    enabled: true,
    version: CONTRACT_VERSION,
    supervisor_status: supervisorStatus,
  };
  contract.semantic_contract = semanticContractFor(contract);
  return contract;
}

function yamlScalar(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function toYaml(value, indent = 0) {
  const padding = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${padding}[]`;
    return value.map((item) => {
      if (item && typeof item === "object") {
        const rendered = toYaml(item, indent + 2).trimStart();
        return `${padding}- ${rendered}`;
      }
      return `${padding}- ${yamlScalar(item)}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${padding}{}`;
    return entries.map(([key, item]) => {
      if (item && typeof item === "object" && ((Array.isArray(item) && item.length) || (!Array.isArray(item) && Object.keys(item).length))) {
        return `${padding}${key}:\n${toYaml(item, indent + 2)}`;
      }
      if (item && typeof item === "object") return `${padding}${key}: ${Array.isArray(item) ? "[]" : "{}"}`;
      return `${padding}${key}: ${yamlScalar(item)}`;
    }).join("\n");
  }
  return `${padding}${yamlScalar(value)}`;
}

function buildMap(catalog, researchRows) {
  const rowByKey = new Map(researchRows.map((row) => [`${row.branch_id}.${row.subbranch_id}`, row]));
  const lines = [
    "# Nyra Deep Branch Architecture V2 — complete map",
    "",
    `Source: authenticated \`${SOURCE_URL}\` for tenant \`${catalog.source_catalog.tenant_id}\`, captured ${catalog.source_catalog.captured_at}.`,
    "",
    `Topology: ${catalog.branches.length} branches, ${catalog.branches.reduce((sum, branch) => sum + branch.subbranches.length, 0)} Level-1 subbranches, ${catalog.nodes.length} independently contracted Level-2–4 nodes.`,
    "",
    "| Branch | L1 subbranch | L2 specialized capability | L3 micro-capability | L4 method | L4 strategy | L4 verifier | L4 metric | Problem solved |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const branch of catalog.branches) {
    for (const subbranch of branch.subbranches) {
      const l2 = subbranch.children[0];
      const l3 = catalog.nodes.find((node) => node.parent_id === l2)?.id;
      const level4 = Object.fromEntries(
        catalog.nodes.filter((node) => node.parent_id === l3).map((node) => [node.node_type, node.id])
      );
      const row = rowByKey.get(`${branch.id}.${subbranch.id}`);
      lines.push(`| ${branch.id} | ${subbranch.id} | ${l2} | ${l3} | ${level4.method} | ${level4.strategy} | ${level4.verifier} | ${level4.metric} | ${row.problem_solved.replace(/\|/g, "\\|")} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourcePath = requiredArg(args, "source");
  const researchPath = requiredArg(args, "research");
  const outputPath = requiredArg(args, "output");
  const supervisorStatus = String(args.status || "PENDING").toUpperCase();
  if (!["PENDING", "APPROVED"].includes(supervisorStatus)) throw new Error("--status must be PENDING or APPROVED");
  const capturedAt = String(args["captured-at"] || "2026-07-23T18:19:34.000Z");
  const rawSource = readJson(sourcePath);
  const sourceCatalog = rawSource.catalog || rawSource;
  if (rawSource.ok === false || !sourceCatalog || sourceCatalog.schema_version !== "nyra_neural_branch_network_v1") {
    throw new Error("Authenticated live V1 catalog response required");
  }
  const tenantId = String(rawSource.tenant_id || args.tenant || "");
  if (tenantId !== "codexai") throw new Error(`Expected authenticated tenant codexai, received ${tenantId || "missing"}`);
  const liveBranchIds = new Set(sourceCatalog.branches.map((branch) => branch.id));
  const researchRows = parseResearchRegistry(fs.readFileSync(researchPath, "utf8"), liveBranchIds);
  const researchByKey = new Map();
  for (const row of researchRows) {
    const key = `${row.branch_id}.${row.subbranch_id}`;
    if (researchByKey.has(key)) throw new Error(`Duplicate research row: ${key}`);
    researchByKey.set(key, row);
  }
  const expectedSubbranches = sourceCatalog.branches.reduce((sum, branch) => sum + branch.subbranches.length, 0);
  if (researchRows.length !== expectedSubbranches) {
    throw new Error(`Research coverage mismatch: ${researchRows.length}/${expectedSubbranches}`);
  }
  const liveKeys = sourceCatalog.branches.flatMap((branch) => branch.subbranches.map((subbranch) => `${branch.id}.${subbranch}`));
  const missing = liveKeys.filter((key) => !researchByKey.has(key));
  const extra = [...researchByKey.keys()].filter((key) => !liveKeys.includes(key));
  if (missing.length || extra.length) throw new Error(`Research/live mismatch missing=${missing.join(",")} extra=${extra.join(",")}`);

  const researchSha256 = sha256(fs.readFileSync(researchPath, "utf8"));
  const generatorSha256 = sha256(fs.readFileSync(new URL(import.meta.url), "utf8"));
  const runtimePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../personal-control-center/lib/nyra-deep-branch-v2.js");
  const runtimeSha256 = sha256(fs.readFileSync(runtimePath, "utf8"));
  const sourceSnapshot = {
    schema_version: "nyra_live_branch_catalog_snapshot_v1",
    captured_at: capturedAt,
    source: SOURCE_URL,
    authenticated_tenant: tenantId,
    response: rawSource,
  };
  sourceSnapshot.sha256 = sha256(sourceSnapshot);
  const v2CatalogCheckpoint = sha256({
    schema_version: SCHEMA_VERSION,
    version: CONTRACT_VERSION,
    source_snapshot_sha256: sourceSnapshot.sha256,
    research_sha256: researchSha256,
    generator_sha256: generatorSha256,
    runtime_sha256: runtimeSha256,
    confidence_calibration: confidenceCalibration(),
  });
  const v1RollbackCheckpoint = sha256({
    repository_commit: "15cdd376a69fbba7f7ebef925d52aca16ad12be3",
    horizontal_runtime_pre_v2_sha256: "eea4aef34164f3681433aca0b338c93ed8276d719a18e379d124bc0b60b2a6d3",
    core_branch_network_sha256: "3d4d044086e10a552bf1f60e0d9acf0a84d30c08311afbda8ef6041c13c0d6ed",
    live_v1_catalog_snapshot_sha256: sourceSnapshot.sha256,
  });
  const nodes = [];
  const branches = sourceCatalog.branches.map((branch) => {
    const branchRows = branch.subbranches.map((subbranchId) => researchByKey.get(`${branch.id}.${subbranchId}`));
    const subbranches = branchRows.map((row) => {
      const l2Id = `${row.branch_id}.${row.subbranch_id}.${row.specialized_capability_id}`;
      const l3Id = `${l2Id}.${row.micro_capability_id}`;
      const l4Segments = level4Segments(row);
      const l4Ids = Object.fromEntries(LEVEL4_TYPES.map((nodeType) => [nodeType, `${l3Id}.${l4Segments[nodeType]}`]));
      nodes.push(contractFor({
        row,
        nodeId: l2Id,
        parentId: `${row.branch_id}.${row.subbranch_id}`,
        level: 2,
        nodeType: "specialized_capability",
        next: l3Id,
        sourceCheckpoint: v1RollbackCheckpoint,
        supervisorStatus,
        coreBindings: branch.core_branch_bindings || [],
      }));
      nodes.push(contractFor({
        row,
        nodeId: l3Id,
        parentId: l2Id,
        level: 3,
        nodeType: "micro_capability",
        next: l4Ids.verifier,
        sourceCheckpoint: v1RollbackCheckpoint,
        supervisorStatus,
        coreBindings: branch.core_branch_bindings || [],
      }));
      for (const nodeType of LEVEL4_TYPES) {
        nodes.push(contractFor({
          row,
          nodeId: l4Ids[nodeType],
          parentId: l3Id,
          level: 4,
          nodeType,
          next: nodeType === "metric" ? "universal_core_join" : l4Ids.metric,
          sourceCheckpoint: v1RollbackCheckpoint,
          supervisorStatus,
          coreBindings: branch.core_branch_bindings || [],
        }));
      }
      return {
        id: row.subbranch_id,
        parent_id: row.branch_id,
        branch_id: row.branch_id,
        level: 1,
        node_type: "subbranch",
        children: [l2Id],
      };
    });
    return {
      id: branch.id,
      label: branch.label,
      work_phase: branch.work_phase,
      core_branch_bindings: branch.core_branch_bindings || [],
      domain_packs: [sourceCatalog.domain_pack_id],
      subbranches,
    };
  });

  const ids = nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length) throw new Error("Generated node IDs are not unique");
  const purposeSet = new Set(nodes.map((node) => node.purpose.toLowerCase()));
  const problemSet = new Set(nodes.map((node) => node.problem_solved.toLowerCase()));
  if (purposeSet.size !== nodes.length || problemSet.size !== nodes.length) {
    throw new Error("Generated purpose or problem text is duplicated");
  }
  const functions = nodes.map((node) => {
    const row = researchByKey.get(`${node.branch_id}.${node.id.split(".")[1]}`);
    return functionSpecFor(row, node.node_type, node.level, node.id);
  });
  const semanticFunctionHashes = functions.map((spec) => spec.semantic_function_hash);
  if (new Set(semanticFunctionHashes).size !== functions.length) {
    throw new Error("Generated semantic function specs are not unique");
  }
  const registryPayload = {
    schema_version: "nyra_deep_branch_function_registry_v1",
    research_sha256: researchSha256,
    source_snapshot_sha256: sourceSnapshot.sha256,
    functions,
  };
  const functionRegistry = {
    ...registryPayload,
    registry_hash: canonicalDigest(registryPayload),
  };
  const functionById = new Map(functions.map((spec) => [spec.function_id, spec]));
  for (const node of nodes) {
    const spec = functionById.get(node.id);
    node.function_binding = {
      registry_hash: functionRegistry.registry_hash,
      source_row_hash: spec.source_row_hash,
      semantic_function_hash: spec.semantic_function_hash,
      execution_plan_hash: spec.execution_plan_hash,
      observation_contract_hash: spec.observation_contract_hash,
    };
    node.semantic_contract = semanticContractFor(node);
  }
  const catalog = {
    schema_version: SCHEMA_VERSION,
    version: CONTRACT_VERSION,
    authority: "universal_core",
    rollback_checkpoint: `sha256:${v1RollbackCheckpoint}`,
    build_checkpoint: `sha256:${v2CatalogCheckpoint}`,
    research_sha256: researchSha256,
    generator_sha256: generatorSha256,
    runtime_sha256: runtimeSha256,
    confidence_calibration: confidenceCalibration(),
    catalog_fingerprint: "",
    source_catalog: {
      schema_version: sourceCatalog.schema_version,
      captured_at: capturedAt,
      source: SOURCE_URL,
      tenant_id: tenantId,
      domain_pack_id: sourceCatalog.domain_pack_id,
      source_snapshot_sha256: sourceSnapshot.sha256,
      branches: sourceCatalog.branches.map((branch) => ({
        id: branch.id,
        label: branch.label,
        work_phase: branch.work_phase,
        core_branch_bindings: branch.core_branch_bindings || [],
        subbranches: branch.subbranches,
      })),
    },
    function_registry: functionRegistry,
    branches,
    nodes,
  };
  catalog.catalog_fingerprint = sha256(Object.fromEntries(
    Object.entries(catalog).filter(([key]) => key !== "catalog_fingerprint")
  ));
  writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
  if (args["yaml-output"]) writeFile(args["yaml-output"], `${toYaml(catalog)}\n`);
  if (args["snapshot-output"]) writeFile(args["snapshot-output"], `${JSON.stringify(sourceSnapshot, null, 2)}\n`);
  if (args["contract-bundle-output"]) {
    const contractBundle = {
      schema_version: CONTRACT_SCHEMA_VERSION,
      catalog_version: CONTRACT_VERSION,
      catalog_id: "nyra_deep_branch_v2_codexai",
      source_v1_schema_version: sourceCatalog.schema_version,
      authority: "universal_core",
      nodes,
    };
    writeFile(args["contract-bundle-output"], `${JSON.stringify(contractBundle, null, 2)}\n`);
  }
  if (args["map-output"]) writeFile(args["map-output"], buildMap(catalog, researchRows));
  if (args["fixture-output"]) {
    writeFile(args["fixture-output"], `${JSON.stringify(buildFixtureBundle(catalog, capturedAt), null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: supervisorStatus,
    branch_count: branches.length,
    subbranch_count: expectedSubbranches,
    node_count: nodes.length,
    level_counts: {
      2: nodes.filter((node) => node.level === 2).length,
      3: nodes.filter((node) => node.level === 3).length,
      4: nodes.filter((node) => node.level === 4).length,
    },
    catalog_fingerprint: catalog.catalog_fingerprint,
    source_snapshot_sha256: sourceSnapshot.sha256,
    rollback_checkpoint: `sha256:${v1RollbackCheckpoint}`,
    build_checkpoint: `sha256:${v2CatalogCheckpoint}`,
  }, null, 2)}\n`);
}

main();

import crypto from "node:crypto";

export const DTT_RUN_SCHEMA_VERSION = "nyra_governed_dynamic_thought_tree_run_v1";
export const DTT_TREE_SCHEMA_VERSION = "nyra_governed_dynamic_thought_tree_tree_v1";
export const DTT_NODE_SCHEMA_VERSION = "nyra_governed_dynamic_thought_tree_node_v1";
export const DTT_SCORE_SCHEMA_VERSION = "nyra_governed_dynamic_thought_tree_score_v1";
export const DTT_RESULT_SCHEMA_VERSION = "nyra_governed_dynamic_thought_tree_result_v1";
export const DTT_POLICY_VERSION = "nyra_governed_dynamic_thought_tree_policy_v1";

const DEFAULT_WEIGHTS = Object.freeze({
  evidence: 0.22,
  reliability: 0.14,
  utility: 0.18,
  probability: 0.15,
  risk: 0.10,
  cost: 0.08,
  reversibility: 0.07,
  uncertainty: 0.03,
  policy: 0.03,
});

const DEFAULT_BRANCHES = Object.freeze([
  "context_intelligence",
  "work_intake",
  "research_evidence",
  "decision_reasoning",
  "planning_prioritization",
  "risk_governance",
  "delegated_authority",
  "decision_provenance",
  "execution_planning",
  "parallel_coordination",
  "quality_verification",
  "learning_memory",
  "adaptive_learning",
  "communication_explanation",
  "software_intelligence",
]);

const L6_ELIGIBLE_BRANCHES = new Set([
  "research_evidence",
  "decision_reasoning",
  "planning_prioritization",
  "software_intelligence",
  "quality_verification",
]);

const NODE_TYPE_BY_DEPTH = Object.freeze({
  1: "subbranch",
  2: "specialized_capability",
  3: "micro_capability",
  4: "method",
  5: "strategy",
  6: "verifier",
});

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function normalizeList(value, max = 50) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, max).map((item) => String(item || "").trim()).filter(Boolean))];
}

function cleanText(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function score01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function unique(values) {
  return [...new Set(values)];
}

function parseWeights(raw) {
  const weights = { ...DEFAULT_WEIGHTS };
  for (const [key, defaultValue] of Object.entries(DEFAULT_WEIGHTS)) {
    const rawValue = Number(raw?.[key]);
    if (Number.isFinite(rawValue) && rawValue >= 0) weights[key] = rawValue;
    else weights[key] = defaultValue;
  }
  const sum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  for (const key of Object.keys(weights)) weights[key] = Number((weights[key] / sum).toFixed(4));
  return weights;
}

function parseListEnv(value) {
  return unique(
    String(value || "")
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

export function parseDttConfig(env = process.env) {
  const enabled = truthy(env.CORE_DTT_ENABLED || env.NYRA_DTT_ENABLED);
  const rawMode = String(env.CORE_DTT_MODE || env.NYRA_DTT_MODE || "off").trim().toLowerCase();
  const mode = ["off", "shadow", "canary", "active"].includes(rawMode) ? rawMode : "off";
  const defaultDepth = Math.max(1, Math.min(4, Number(env.CORE_DTT_DEFAULT_DEPTH || env.NYRA_DTT_DEFAULT_DEPTH || 4)));
  const maxDepthCap = Math.max(defaultDepth, Math.min(6, Number(env.CORE_DTT_MAX_DEPTH_CAP || env.NYRA_DTT_MAX_DEPTH_CAP || 6)));
  const maxChildren = Math.max(1, Math.min(3, Number(env.CORE_DTT_MAX_CHILDREN || env.NYRA_DTT_MAX_CHILDREN || 3)));
  const beamWidth = Math.max(1, Math.min(3, Number(env.CORE_DTT_BEAM_WIDTH || env.NYRA_DTT_BEAM_WIDTH || 3)));
  const maxNodes = Math.max(8, Math.min(64, Number(env.CORE_DTT_MAX_NODES || env.NYRA_DTT_MAX_NODES || 64)));
  const maxPermanentBranches = Math.max(1, Math.min(24, Number(env.CORE_DTT_MAX_PERMANENT_BRANCHES || env.NYRA_DTT_MAX_PERMANENT_BRANCHES || 24)));
  const tenantAllowlist = parseListEnv(env.CORE_DTT_TENANT_ALLOWLIST || env.NYRA_DTT_TENANT_ALLOWLIST);
  const l6Allowlist = parseListEnv(env.CORE_DTT_L6_ALLOWLIST || env.NYRA_DTT_L6_ALLOWLIST);
  const weights = parseWeights({
    evidence: env.CORE_DTT_WEIGHT_EVIDENCE || env.NYRA_DTT_WEIGHT_EVIDENCE,
    reliability: env.CORE_DTT_WEIGHT_RELIABILITY || env.NYRA_DTT_WEIGHT_RELIABILITY,
    utility: env.CORE_DTT_WEIGHT_UTILITY || env.NYRA_DTT_WEIGHT_UTILITY,
    probability: env.CORE_DTT_WEIGHT_PROBABILITY || env.NYRA_DTT_WEIGHT_PROBABILITY,
    risk: env.CORE_DTT_WEIGHT_RISK || env.NYRA_DTT_WEIGHT_RISK,
    cost: env.CORE_DTT_WEIGHT_COST || env.NYRA_DTT_WEIGHT_COST,
    reversibility: env.CORE_DTT_WEIGHT_REVERSIBILITY || env.NYRA_DTT_WEIGHT_REVERSIBILITY,
    uncertainty: env.CORE_DTT_WEIGHT_UNCERTAINTY || env.NYRA_DTT_WEIGHT_UNCERTAINTY,
    policy: env.CORE_DTT_WEIGHT_POLICY || env.NYRA_DTT_WEIGHT_POLICY,
  });
  return {
    schema_version: DTT_POLICY_VERSION,
    enabled,
    mode,
    default_depth: defaultDepth,
    max_depth_cap: maxDepthCap,
    max_children: maxChildren,
    beam_width: beamWidth,
    max_nodes: maxNodes,
    max_permanent_branches: maxPermanentBranches,
    tenant_allowlist: tenantAllowlist,
    l6_allowlist: l6Allowlist,
    weights,
    hard_limits: {
      fail_closed: true,
      max_worker_parallelism: 8,
      max_retry_per_task: 2,
      max_runtime_depth: maxDepthCap,
      no_cycles: true,
      no_orphan_nodes: true,
      no_side_effects_in_shadow: true,
      no_self_promoted_policy: true,
    },
    feature_flags: {
      gate: "CORE_DTT_ENABLED",
      mode_gate: "CORE_DTT_MODE",
      default_enabled: false,
      rollback: "Set CORE_DTT_MODE=off",
    },
  };
}

function emptyStats() {
  return {
    runs: 0,
    trees: 0,
    nodes: 0,
    expanded: 0,
    pruned: 0,
    backtracked: 0,
    selected: 0,
    abstained: 0,
    failed: 0,
    completed: 0,
    early_stop: 0,
    depth_histogram: {},
    branch_histogram: {},
    l6_runs: 0,
  };
}

function fingerprint(input) {
  return stableHash(JSON.stringify(input));
}

function pseudonymizeTenant(tenantId, salt) {
  return `tenant_${stableHash(`${tenantId || "unknown"}:${salt || "dtt"}`).slice(0, 16)}`;
}

function safeArray(value, max = 10) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => cleanText(item, 180)).filter(Boolean);
}

function branchLabel(branchId) {
  return String(branchId || "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stageLabel(depth, branchId, hypothesisIndex) {
  const base = branchLabel(branchId);
  if (depth === 1) return `${base} — subbranch`;
  if (depth === 2) return `${base} — specialized capability`;
  if (depth === 3) return `${base} — micro capability`;
  if (depth === 4) return `${base} — ${["method", "strategy", "verifier", "metric"][hypothesisIndex % 4]}`;
  return `${base} — refinement ${depth}`;
}

function evidenceScore(input = {}) {
  const supporting = safeArray(input.supporting_evidence_refs, 12).length;
  const contradicting = safeArray(input.contradicting_evidence_refs, 12).length;
  const provenance = safeArray(input.provenance_refs, 12).length;
  return clamp(supporting * 18 + provenance * 8 - contradicting * 20, 0, 100);
}

function reliabilityScore(input = {}) {
  const source = Number(input.source_reliability ?? input.reliability ?? 0.7);
  const verified = input.verified === true || input.status === "verified";
  return clamp((score01(source) * 100) + (verified ? 8 : 0), 0, 100);
}

function utilityScore(input = {}) {
  const branchMatch = input.branch_match === true ? 22 : 0;
  const intentMatch = input.intent_match === true ? 18 : 0;
  const reuse = Number(input.reuse_score ?? 0.5) * 18;
  return clamp(branchMatch + intentMatch + reuse, 0, 100);
}

function probabilityScore(input = {}) {
  const confidence = score01(input.confidence ?? 0.6);
  const signal = score01(input.signal_strength ?? 0.5);
  return clamp((confidence * 60) + (signal * 40), 0, 100);
}

function riskScore(input = {}) {
  const risk = score01(input.risk ?? 0.4);
  const ambiguity = score01(input.ambiguity ?? 0.5);
  return clamp((risk * 70) + (ambiguity * 30), 0, 100);
}

function costScore(input = {}) {
  const estimated = score01(input.estimated_cost ?? 0.3);
  const depth = score01(input.depth_cost ?? 0.3);
  return clamp((estimated * 70) + (depth * 30), 0, 100);
}

function reversibilityScore(input = {}) {
  const reversibility = score01(input.reversibility ?? 0.6);
  return clamp(reversibility * 100, 0, 100);
}

function uncertaintyScore(input = {}) {
  const uncertainty = score01(input.uncertainty ?? 0.4);
  return clamp(uncertainty * 100, 0, 100);
}

function policyScore(input = {}) {
  const policyMatch = input.policy_match === true ? 1 : 0;
  const tenantSafe = input.tenant_safe === true ? 1 : 0;
  return clamp((policyMatch * 55) + (tenantSafe * 45), 0, 100);
}

function weightedScore(factors, weights) {
  const total = [
    factors.evidence * weights.evidence,
    factors.reliability * weights.reliability,
    factors.utility * weights.utility,
    factors.probability * weights.probability,
    (100 - factors.risk) * weights.risk,
    (100 - factors.cost) * weights.cost,
    factors.reversibility * weights.reversibility,
    (100 - factors.uncertainty) * weights.uncertainty,
    factors.policy * weights.policy,
  ].reduce((a, b) => a + b, 0);
  return clamp(total, 0, 100);
}

function makeContracts({ runId, treeId, nodeId, parentId, depth, tenantRef, requestFingerprint, branchId, subbranchId, policyVersion, catalogVersion, coreDecisionReference, hypothesisSummary, assumptions, supportingEvidenceRefs, contradictingEvidenceRefs, status, pruneReason, backtrackReason, score, confidence, uncertainty, utility, risk, estimatedCost, nodeType, enabled, version, featureFlag, supervisorStatus, rollbackReference, weights, allowedDepth, selected }) {
  const nowIso = new Date().toISOString();
  return {
    schema_version: DTT_NODE_SCHEMA_VERSION,
    id: nodeId,
    tenant_id: tenantRef,
    parent_id: parentId,
    branch_id: branchId,
    subbranch_id: subbranchId,
    request_fingerprint: requestFingerprint,
    fixed_branch_id: branchId,
    tree_id: treeId,
    run_id: runId,
    level: depth,
    node_type: nodeType,
    purpose: hypothesisSummary,
    problem_solved: status === "selected" ? "Riduce l'incertezza e converge sul percorso utile sotto budget e policy." : "Isola un'ipotesi strutturata da confrontare con alternative più forti.",
    failure_modes: [
      "tenant_mismatch",
      "catalog_mismatch",
      "policy_incompatible",
      "evidence_missing",
      "budget_exhausted",
      "timeout",
      "depth_limit_exceeded",
      "fanout_limit_exceeded",
      "prompt_injection",
      "duplicate_path",
    ],
    input_schema: {
      type: "object",
      required: ["tenant_id", "request_fingerprint", "fixed_branch_id"],
    },
    output_schema: {
      type: "object",
      required: ["status", "score", "confidence", "selected"],
    },
    activation_conditions: [
      "request_valid",
      "tenant_allowlisted_or_unrestricted",
      "branch_relevant",
      "budget_available",
      "policy_aligned",
    ],
    non_activation_conditions: [
      "tenant_mismatch",
      "policy_blocked",
      "budget_exhausted",
      "depth_cap_reached",
      "core_denial",
    ],
    dependencies: [
      { type: "universal_core", required: true },
      { type: "nyra_branch_catalog", required: true },
      { type: "redacted_evidence", required: true },
    ],
    required_context: {
      tenant_ref: tenantRef,
      request_fingerprint: requestFingerprint,
      selected_branch: branchId,
      allowed_depth: allowedDepth,
    },
    required_evidence: safeArray(supportingEvidenceRefs, 8).map((ref, index) => ({
      id: `evidence_${index + 1}`,
      ref,
      required: index === 0,
    })),
    core_policy_bindings: [
      { policy_id: "tenant_isolation", policy_version: policyVersion, required: true },
      { policy_id: "core_final_authority", policy_version: policyVersion, required: true },
      { policy_id: "dtt_shadow_no_side_effects", policy_version: policyVersion, required: true },
    ],
    tenant_scope: {
      partition_key: "tenant_id",
      domain_pack_source: "authenticated_core_key",
      cross_tenant_allowed: false,
      memory_scope: "tenant_only",
      evidence_scope: "tenant_only",
    },
    risk_class: risk >= 70 ? "high" : risk >= 35 ? "medium" : "low",
    confidence_method: {
      formula: "0.22*evidence+0.14*reliability+0.18*utility+0.15*probability+0.10*(100-risk)+0.08*(100-cost)+0.07*reversibility+0.03*(100-uncertainty)+0.03*policy",
      evidence_basis: ["structured_evidence_refs", "contradiction_count", "policy_alignment", "branch_relevance"],
      abstain_below_threshold: true,
      calibration_reference: "reports/nyra-dtt/benchmark.json",
    },
    confidence_threshold: 55,
    methods: [
      {
        method_id: `${nodeId}__method`,
        label: `${stageLabel(depth, branchId, 0)} method`,
        required: true,
      },
    ],
    strategies: [
      {
        strategy_id: `${nodeId}__strategy`,
        label: `${stageLabel(depth, branchId, 1)} strategy`,
        required: true,
      },
    ],
    verifiers: [
      {
        verifier_id: `${nodeId}__verifier`,
        label: `${stageLabel(depth, branchId, 2)} verifier`,
        required: true,
      },
    ],
    metrics: [
      {
        metric_id: `${nodeId}__metric`,
        label: `${stageLabel(depth, branchId, 3)} metric`,
        target: score,
        required: true,
      },
    ],
    fallback_node: selected ? "core:abstain" : parentId || "core:abstain",
    human_review_trigger: {
      action: "pause_and_request_review",
      timeout_action: "abstain",
      conditions: [
        "policy_incompatible",
        "contradiction_critical",
        "evidence_insufficient",
        "budget_exhausted",
        "depth_cap_reached_with_uncertainty",
      ],
    },
    audit_fields: [
      { name: "tenant_id", value: tenantRef, required: true },
      { name: "request_id", value: requestFingerprint, required: true },
      { name: "node_id", value: nodeId, required: true },
      { name: "contract_version", value: DTT_NODE_SCHEMA_VERSION, required: true },
      { name: "core_verdict", value: coreDecisionReference?.state || "shadow", required: true },
      { name: "timestamp", value: nowIso, required: true },
    ],
    provenance_fields: [
      { name: "contract_hash", value: stableHash(JSON.stringify({ nodeId, branchId, depth, policyVersion, catalogVersion })), required: true },
      { name: "source_refs", value: safeArray(supportingEvidenceRefs, 8), required: true },
      { name: "evidence_hashes", value: safeArray(supportingEvidenceRefs, 8).map((ref) => stableHash(ref)), required: true },
      { name: "route_trace", value: safeArray(coreDecisionReference?.route_trace || [], 8), required: true },
      { name: "policy_snapshot_hash", value: stableHash(JSON.stringify({ policyVersion, weights, allowedDepth })), required: true },
    ],
    positive_tests: [
      "selected_path_has_score_above_threshold",
      "tenant_isolation_preserved",
      "shadow_mode_produces_no_side_effect",
    ],
    negative_tests: [
      "reject_tenant_mismatch",
      "reject_policy_mismatch",
      "reject_missing_evidence",
    ],
    adversarial_tests: [
      "prompt_injection_does_not_change_policy",
      "duplicate_node_does_not_enter_tree",
      "deep_tree_does_not_exceed_cap",
    ],
    regression_tests: [
      "v2_rollout_unchanged",
      "fallback_to_v1_available",
      "shadow_dtt_keeps_v2_authority_intact",
    ],
    rollback_reference: {
      kill_switch: "CORE_DTT_MODE=off",
      sandbox: "shadow",
      steps: [
        "disable_dtt_mode",
        "preserve_v2_mode",
        "retain_v1_fallback",
      ],
      verification: [
        "v2_mode_remains_unchanged",
        "dtt_status_reports_off",
      ],
    },
    feature_flag: {
      gate: "CORE_DTT_ENABLED",
      mode_gate: "CORE_DTT_MODE",
      default_enabled: false,
      l6_allowlist: [...L6_ELIGIBLE_BRANCHES],
    },
    enabled,
    version,
    supervisor_status: supervisorStatus,
    catalog_version: catalogVersion,
    policy_version: policyVersion,
    core_decision_reference: coreDecisionReference,
    timestamp: nowIso,
    provenance: {
      source_refs: safeArray(supportingEvidenceRefs, 8),
      evidence_refs: safeArray(supportingEvidenceRefs, 8),
      contradicting_refs: safeArray(contradictingEvidenceRefs, 8),
      route_trace: safeArray(coreDecisionReference?.route_trace || [], 8),
      policy_snapshot_hash: stableHash(JSON.stringify({ policyVersion, weights, allowedDepth })),
      generated_by: "governed_dynamic_thought_tree",
    },
    selected,
    score,
    confidence,
    uncertainty,
    utility,
    risk,
    estimated_cost: estimatedCost,
    prune_reason: pruneReason || null,
    backtrack_reason: backtrackReason || null,
    status,
    children_ids: [],
  };
}

function scoreNode({ depth, branchMatch, intentMatch, evidenceRefs, contradictingRefs, branchId, config, request, parents }) {
  const evidence = evidenceScore({ supporting_evidence_refs: evidenceRefs, contradicting_evidence_refs: contradictingRefs, provenance_refs: request.provenance_refs });
  const reliability = reliabilityScore({ source_reliability: request.source_reliability, verified: request.verified });
  const utility = utilityScore({ branch_match: branchMatch, intent_match: intentMatch, reuse_score: request.reuse_score });
  const probability = probabilityScore({ confidence: request.confidence, signal_strength: request.signal_strength });
  const risk = riskScore({ risk: request.risk, ambiguity: request.ambiguity + (branchId === "risk_governance" ? 0.2 : 0) });
  const cost = costScore({ estimated_cost: depth / Math.max(config.default_depth, 1), depth_cost: depth / Math.max(config.max_depth_cap, 1) });
  const reversibility = reversibilityScore({ reversibility: request.reversibility });
  const uncertainty = uncertaintyScore({ uncertainty: request.uncertainty + (contradictingRefs.length > evidenceRefs.length ? 0.2 : 0) });
  const policy = policyScore({ policy_match: request.policy_match, tenant_safe: request.tenant_safe });
  const score = weightedScore({ evidence, reliability, utility, probability, risk, cost, reversibility, uncertainty, policy }, config.weights);
  const confidence = clamp((evidence * 0.35) + (reliability * 0.2) + (probability * 0.2) + (reversibility * 0.1) + (policy * 0.15) - (uncertainty * 0.15), 0, 100);
  return { evidence, reliability, utility, probability, risk, cost, reversibility, uncertainty, policy, score, confidence, parents };
}

function branchCandidates(input, catalog, config) {
  const explicit = normalizeList(input.fixed_branch_ids || input.fixedBranches || input.permanent_branch_ids, config.max_permanent_branches);
  const derived = normalizeList(input.opened_branch_ids || input.openedBranches || input.active_branch_ids, config.max_permanent_branches);
  const catalogBranches = Array.isArray(catalog) ? catalog : [];
  const catalogIds = catalogBranches.map((branch) => branch.id).filter(Boolean);
  const selected = unique([
    ...explicit.filter((id) => catalogIds.includes(id)),
    ...derived.filter((id) => catalogIds.includes(id)),
  ]);
  const fallback = DEFAULT_BRANCHES.filter((id) => catalogIds.includes(id));
  return (selected.length ? selected : fallback).slice(0, config.max_permanent_branches);
}

function branchInfoMap(branches = []) {
  return new Map(branches.map((branch) => [branch.id, branch]));
}

function matchBranch(branch, text) {
  const haystack = `${branch.id} ${branch.label} ${Array.isArray(branch.triggers) ? branch.triggers.join(" ") : ""}`.toLowerCase();
  return String(text || "").toLowerCase().split(/\s+/).some((token) => token && haystack.includes(token));
}

function candidateTemplates(branchId, depth, request) {
  const token = cleanText(request.intent || request.text || request.message || "", 120) || branchId;
  const base = `${branchLabel(branchId)} ${token}`.trim();
  if (depth === 1) {
    return [
      { subbranch_id: `${branchId}__plan`, summary: `${base}: piano di risposta verificabile`, node_type: "subbranch" },
      { subbranch_id: `${branchId}__verify`, summary: `${base}: verifica di copertura e vincoli`, node_type: "subbranch" },
      { subbranch_id: `${branchId}__fallback`, summary: `${base}: fallback governato e criterio di astensione`, node_type: "subbranch" },
    ];
  }
  if (depth === 2) {
    return [
      { subbranch_id: `${branchId}__capability_evidence`, summary: `${base}: capability specializzata su evidenza e confronto`, node_type: "specialized_capability" },
      { subbranch_id: `${branchId}__capability_policy`, summary: `${base}: capability specializzata su policy e tenant`, node_type: "specialized_capability" },
      { subbranch_id: `${branchId}__capability_risk`, summary: `${base}: capability specializzata su rischio e rollback`, node_type: "specialized_capability" },
    ];
  }
  if (depth === 3) {
    return [
      { subbranch_id: `${branchId}__micro_branch`, summary: `${base}: micro-ragionamento con confronto alternativo`, node_type: "micro_capability" },
      { subbranch_id: `${branchId}__micro_prune`, summary: `${base}: micro-ragionamento per potatura e backtrack`, node_type: "micro_capability" },
      { subbranch_id: `${branchId}__micro_join`, summary: `${base}: micro-ragionamento per Core join e sintesi`, node_type: "micro_capability" },
    ];
  }
  return [
    { subbranch_id: `${branchId}__method_${depth}`, summary: `${base}: metodo bounded best-first`, node_type: NODE_TYPE_BY_DEPTH[Math.min(depth, 6)] || "method" },
    { subbranch_id: `${branchId}__strategy_${depth}`, summary: `${base}: strategia beam pruning`, node_type: NODE_TYPE_BY_DEPTH[Math.min(depth, 6)] || "strategy" },
    { subbranch_id: `${branchId}__verifier_${depth}`, summary: `${base}: verifier redatto`, node_type: NODE_TYPE_BY_DEPTH[Math.min(depth, 6)] || "verifier" },
  ];
}

function depthAllowed(branchId, depth, config) {
  if (depth <= config.default_depth) return true;
  return depth <= config.max_depth_cap && config.l6_allowlist.includes(branchId);
}

function selectTopCandidates(candidates, beamWidth) {
  return [...candidates].sort((a, b) => {
    const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDelta !== 0) return scoreDelta;
    const left = String(a.node_id || a.id || "");
    const right = String(b.node_id || b.id || "");
    return left.localeCompare(right);
  }).slice(0, beamWidth);
}

function createRootNode({ runId, treeId, tenantRef, requestFingerprint, catalogVersion, policyVersion, coreDecisionReference }) {
  return {
    schema_version: DTT_NODE_SCHEMA_VERSION,
    id: `${treeId}__root`,
    tenant_id: tenantRef,
    parent_id: null,
    branch_id: "request_root",
    subbranch_id: "request_scope",
    request_fingerprint: requestFingerprint,
    fixed_branch_id: "request_root",
    tree_id: treeId,
    run_id: runId,
    level: 0,
    node_type: "root",
    purpose: "Normalizza la richiesta e avvia il tree dinamico senza autoripromozione.",
    problem_solved: "Crea un riferimento comune per confronto, pruning e Core join.",
    failure_modes: ["request_missing", "tenant_mismatch", "policy_blocked", "budget_exhausted"],
    input_schema: { type: "object", required: ["request_id", "tenant_id"] },
    output_schema: { type: "object", required: ["selected_path", "telemetry"] },
    activation_conditions: ["request_valid", "tenant_allowlisted_or_unrestricted"],
    non_activation_conditions: ["tenant_mismatch", "mode_off"],
    dependencies: [{ type: "universal_core", required: true }],
    required_context: { tenant_ref: tenantRef, request_fingerprint: requestFingerprint, allowed_depth: 0 },
    required_evidence: [],
    core_policy_bindings: [
      { policy_id: "tenant_isolation", policy_version: policyVersion, required: true },
      { policy_id: "core_final_authority", policy_version: policyVersion, required: true },
      { policy_id: "dtt_shadow_no_side_effects", policy_version: policyVersion, required: true },
    ],
    tenant_scope: {
      partition_key: "tenant_id",
      domain_pack_source: "authenticated_core_key",
      cross_tenant_allowed: false,
      memory_scope: "tenant_only",
      evidence_scope: "tenant_only",
    },
    risk_class: "low",
    confidence_method: {
      formula: "root_normalization",
      evidence_basis: ["request_fingerprint", "policy_alignment"],
      abstain_below_threshold: true,
      calibration_reference: "reports/nyra-dtt/benchmark.json",
    },
    confidence_threshold: 0,
    methods: [],
    strategies: [],
    verifiers: [],
    metrics: [],
    fallback_node: "core:abstain",
    human_review_trigger: { action: "pause_and_request_review", timeout_action: "abstain", conditions: ["tenant_mismatch", "policy_blocked"] },
    audit_fields: [
      { name: "tenant_id", value: tenantRef, required: true },
      { name: "request_id", value: requestFingerprint, required: true },
      { name: "node_id", value: `${treeId}__root`, required: true },
      { name: "contract_version", value: DTT_NODE_SCHEMA_VERSION, required: true },
      { name: "core_verdict", value: coreDecisionReference?.state || "shadow", required: true },
      { name: "timestamp", value: new Date().toISOString(), required: true },
    ],
    provenance_fields: [
      { name: "contract_hash", value: stableHash(JSON.stringify({ treeId, catalogVersion, policyVersion })), required: true },
      { name: "source_refs", value: [], required: true },
      { name: "evidence_hashes", value: [], required: true },
      { name: "route_trace", value: safeArray(coreDecisionReference?.route_trace || [], 8), required: true },
      { name: "policy_snapshot_hash", value: stableHash(JSON.stringify({ policyVersion })), required: true },
    ],
    positive_tests: ["root_created", "root_isolation_preserved"],
    negative_tests: ["root_never_selected_without_children"],
    adversarial_tests: ["request_injection_does_not_change_root"],
    regression_tests: ["dtt_root_stable_across_runs"],
    rollback_reference: {
      kill_switch: "CORE_DTT_MODE=off",
      sandbox: "shadow",
      steps: ["disable_dtt_mode", "keep_v2_unchanged"],
      verification: ["root_remains_advisory_only"],
    },
    feature_flag: { gate: "CORE_DTT_ENABLED", mode_gate: "CORE_DTT_MODE", default_enabled: false, l6_allowlist: [] },
    enabled: true,
    version: "1.0.0",
    supervisor_status: "APPROVED",
    catalog_version: catalogVersion,
    policy_version: policyVersion,
    core_decision_reference: coreDecisionReference,
    timestamp: new Date().toISOString(),
    provenance: {
      source_refs: [],
      evidence_refs: [],
      contradicting_refs: [],
      route_trace: safeArray(coreDecisionReference?.route_trace || [], 8),
      policy_snapshot_hash: stableHash(JSON.stringify({ policyVersion })),
      generated_by: "governed_dynamic_thought_tree",
    },
    selected: false,
    score: 0,
    confidence: 100,
    uncertainty: 0,
    utility: 0,
    risk: 0,
    estimated_cost: 0,
    prune_reason: null,
    backtrack_reason: null,
    status: "completed",
    children_ids: [],
  };
}

export function createGovernedDynamicThoughtTreeRuntime({ env = process.env, now = () => Date.now() } = {}) {
  const config = parseDttConfig(env);
  const runs = new Map();
  const statsByTenant = new Map();
  const latestByTenant = new Map();
  const salt = cleanText(env.CORE_DTT_TENANT_SALT || env.NYRA_DTT_TENANT_SALT || "dtt", 120);

  function tenantStats(tenantId) {
    if (!statsByTenant.has(tenantId)) statsByTenant.set(tenantId, emptyStats());
    return statsByTenant.get(tenantId);
  }

  function remember(run) {
    runs.set(run.run_id, run);
    latestByTenant.set(run.tenant_id, run);
    if (runs.size > 40) runs.delete(runs.keys().next().value);
    if (latestByTenant.size > 20) {
      const first = latestByTenant.keys().next().value;
      if (first && first !== run.tenant_id) latestByTenant.delete(first);
    }
  }

  function isAllowed(tenantId) {
    return config.tenant_allowlist.length === 0 || config.tenant_allowlist.includes(tenantId);
  }

  function evaluate({
    tenant_id: tenantId = "",
    request_id: requestId = "",
    request_fingerprint: requestFingerprintInput = "",
    text = "",
    intent = "",
    fixed_branch_ids: fixedBranchIdsInput = [],
    branch_catalog: branchCatalogInput = [],
    supporting_evidence_refs: supportingEvidenceRefs = [],
    contradicting_evidence_refs: contradictingEvidenceRefs = [],
    provenance_refs: provenanceRefs = [],
    confidence = 0.6,
    signal_strength = 0.5,
    risk = 0.4,
    ambiguity = 0.4,
    reversibility = 0.6,
    uncertainty = 0.4,
    source_reliability = 0.7,
    reuse_score = 0.5,
    tenant_safe = true,
    policy_match = true,
    budget = {},
    core_decision_reference = null,
    catalog_version = "nyra_neural_branch_network_v1",
    policy_version = DTT_POLICY_VERSION,
    allowed_depth_override = null,
  } = {}) {
    const stats = tenantStats(tenantId);
    stats.runs += 1;
    const allowed = isAllowed(tenantId);
    if (!config.enabled || config.mode === "off") {
      const run = {
        schema_version: DTT_RUN_SCHEMA_VERSION,
        run_id: `dtt_run_${crypto.randomUUID()}`,
        tree_id: `dtt_tree_${crypto.randomUUID()}`,
        tenant_id: tenantId,
        tenant_ref: pseudonymizeTenant(tenantId, salt),
        request_id: requestId,
        request_fingerprint: requestFingerprintInput || fingerprint({ tenantId, requestId, text, intent, policy_version }),
        policy_version,
        catalog_version,
        mode: config.mode,
        state: "completed",
        allowed_depth: 0,
        max_depth_reached: 0,
        nodes_evaluated: 0,
        result: {
          schema_version: DTT_RESULT_SCHEMA_VERSION,
          state: "off",
          selected_path: [],
          selected_node_id: null,
          core_decision_reference: core_decision_reference || { state: "shadow", authority: "universal_core" },
          telemetry: { tree_created: false, nodes_generated: 0, nodes_expanded: 0, nodes_pruned: 0, backtracks: 0, early_stop: false },
          explanation: "DTT disabilitato tramite feature flag.",
          shadow_comparison: null,
        },
        tree: {
          schema_version: DTT_TREE_SCHEMA_VERSION,
          tree_id: `dtt_tree_${crypto.randomUUID()}`,
          run_id: `dtt_run_${crypto.randomUUID()}`,
          root_node_id: null,
          nodes: [],
          edges: [],
          selected_node_id: null,
          selected_path: [],
          pruned_node_ids: [],
          backtracked_node_ids: [],
        },
        telemetry: { tree_created: false, nodes_generated: 0, nodes_expanded: 0, nodes_pruned: 0, backtracks: 0, early_stop: false, max_depth_reached: 0, depth_histogram: {}, branch_histogram: {}, permanent_branches_used: [] },
      };
      remember(run);
      return run;
    }
    if (!allowed) {
      const run = {
        schema_version: DTT_RUN_SCHEMA_VERSION,
        run_id: `dtt_run_${crypto.randomUUID()}`,
        tree_id: `dtt_tree_${crypto.randomUUID()}`,
        tenant_id: tenantId,
        tenant_ref: pseudonymizeTenant(tenantId, salt),
        request_id: requestId,
        request_fingerprint: requestFingerprintInput || fingerprint({ tenantId, requestId, text, intent, policy_version }),
        policy_version,
        catalog_version,
        mode: config.mode,
        state: "blocked",
        allowed_depth: 0,
        max_depth_reached: 0,
        nodes_evaluated: 0,
        root_branch_pool: [],
        tree: {
          schema_version: DTT_TREE_SCHEMA_VERSION,
          tree_id: `dtt_tree_${crypto.randomUUID()}`,
          run_id: `dtt_run_${crypto.randomUUID()}`,
          root_node_id: null,
          nodes: [],
          edges: [],
          selected_node_id: null,
          selected_path: [],
          pruned_node_ids: [],
          backtracked_node_ids: [],
        },
        telemetry: { tree_created: false, nodes_generated: 0, nodes_expanded: 0, nodes_pruned: 0, backtracks: 0, early_stop: false, max_depth_reached: 0, depth_histogram: {}, branch_histogram: {}, permanent_branches_used: [] },
        result: {
          schema_version: DTT_RESULT_SCHEMA_VERSION,
          state: "blocked",
          selected_path: [],
          selected_node_id: null,
          core_decision_reference: core_decision_reference || { state: "shadow", authority: "universal_core" },
          telemetry: { tree_created: false, nodes_generated: 0, nodes_expanded: 0, nodes_pruned: 0, backtracks: 0, early_stop: false },
          explanation: "Tenant non allowlisted: il DTT si astiene e non apre il tree.",
          shadow_comparison: null,
        },
      };
      remember(run);
      return run;
    }

    const branchCatalog = Array.isArray(branchCatalogInput) && branchCatalogInput.length ? branchCatalogInput : DEFAULT_BRANCHES.map((id) => ({ id, label: branchLabel(id), triggers: [] }));
    const branchInfo = branchInfoMap(branchCatalog);
    const permanentBranches = branchCandidates({ fixed_branch_ids: fixedBranchIdsInput, opened_branch_ids: fixedBranchIdsInput, text, intent }, branchCatalog, config);
    const branchPool = permanentBranches.slice(0, config.max_permanent_branches);
    const l6Allowed = branchPool.some((branchId) => config.l6_allowlist.includes(branchId));
    const allowedDepth = Math.min(config.max_depth_cap, allowed_depth_override || (l6Allowed ? 6 : config.default_depth));
    const requestFingerprint = requestFingerprintInput || fingerprint({ tenantId, requestId, text, intent, branchPool, policy_version });
    const runId = `dtt_run_${crypto.randomUUID()}`;
    const treeId = `dtt_tree_${crypto.randomUUID()}`;
    const tenantRef = pseudonymizeTenant(tenantId, salt);
    const budgetState = {
      max_nodes: Math.min(config.max_nodes, Math.max(1, Number(budget.max_nodes) || config.max_nodes)),
      beam_width: Math.min(config.beam_width, Math.max(1, Number(budget.beam_width) || config.beam_width)),
      max_children: Math.min(config.max_children, Math.max(1, Number(budget.max_children) || config.max_children)),
      max_workers: Math.max(1, Math.min(8, Number(budget.max_workers) || 8)),
      max_retries: Math.max(0, Math.min(2, Number(budget.max_retries) || 2)),
      deadline_ms: Number(budget.deadline_ms || 0),
    };
    const treeSkeleton = {
      schema_version: DTT_TREE_SCHEMA_VERSION,
      tree_id: treeId,
      run_id: runId,
      root_node_id: `${treeId}__root`,
      nodes: [],
      edges: [],
      selected_node_id: null,
      selected_path: [],
      pruned_node_ids: [],
      backtracked_node_ids: [],
    };
    const root = createRootNode({
      runId,
      treeId,
      tenantRef,
      requestFingerprint,
      catalogVersion: catalog_version,
      policyVersion: policy_version,
      coreDecisionReference: core_decision_reference || { state: "shadow", authority: "universal_core" },
    });
    const branchText = `${text} ${intent}`.trim();
    const seedNodes = [];
    for (const branchId of branchPool.slice(0, 3)) {
      const branch = branchInfo.get(branchId) || { id: branchId, label: branchLabel(branchId), triggers: [] };
      const branchMatch = matchBranch(branch, branchText);
      const intentMatch = branchMatch || requestFingerprint.includes(stableHash(branchId).slice(0, 6));
      const templates = candidateTemplates(branchId, 1, { text, intent });
      const candidate = templates[0];
      const factors = scoreNode({
        depth: 1,
        branchMatch,
        intentMatch,
        evidenceRefs: supportingEvidenceRefs,
        contradictingRefs: contradictingEvidenceRefs,
        branchId,
        config,
        request: { confidence, signal_strength, risk, ambiguity, reversibility, uncertainty, source_reliability, reuse_score, tenant_safe, policy_match, provenance_refs: provenanceRefs },
        parents: [],
      });
      seedNodes.push({
        branchId,
        candidate,
        factors,
        branch,
      });
    }
    const initialSelection = selectTopCandidates(
      seedNodes.map((seed, index) => {
        const nodeId = `${treeId}__${seed.branchId}__l1_${index + 1}`;
        return {
          ...seed,
          nodeId,
          score: seed.factors.score,
          confidenceScore: seed.factors.confidence,
        };
      }),
      budgetState.beam_width
    );

    const allNodes = [root];
    const edges = [];
    let frontier = initialSelection.map((seed) => ({
      parent_id: root.id,
      branch_id: seed.branchId,
      node_id: seed.nodeId,
      subbranch_id: seed.candidate.subbranch_id,
      depth: 1,
      node_type: seed.candidate.node_type,
      hypothesis_summary: seed.candidate.summary,
      score: seed.score,
      confidence: seed.confidenceScore,
      factors: seed.factors,
    }));
    let selectedPath = [];
    let selectedNode = null;
    let nodesGenerated = frontier.length;
    let nodesExpanded = 0;
    let pruned = 0;
    let backtracks = 0;
    let earlyStop = false;
    let maxDepthReached = 0;
    const permanentBranchesUsed = new Set();
    const branchHistogram = {};
    const depthHistogram = {};

    const threshold = 55;
    const hardRiskBlock = risk >= 90 || !allowed;

    function pushNode(node, parentNodeId) {
      allNodes.push(node);
      edges.push({ from: parentNodeId, to: node.id, relation: "expand" });
      nodesGenerated += 1;
      maxDepthReached = Math.max(maxDepthReached, node.level);
      depthHistogram[node.level] = (depthHistogram[node.level] || 0) + 1;
      branchHistogram[node.branch_id] = (branchHistogram[node.branch_id] || 0) + 1;
      permanentBranchesUsed.add(node.branch_id);
    }

    root.children_ids = frontier.map((item) => item.node_id);
    let bestPath = [];
    let bestScore = 0;
    let activePaths = frontier.map((item) => [root, item]);

    for (let depth = 1; depth <= allowedDepth && allNodes.length < budgetState.max_nodes; depth += 1) {
      const nextFrontier = [];
      const currentPaths = activePaths.length ? activePaths : frontier.map((item) => [root, item]);
      for (const path of currentPaths.slice(0, budgetState.beam_width)) {
        const parentNode = path[path.length - 1];
        if (!depthAllowed(parentNode.branch_id, depth, config)) {
          pruned += 1;
          continue;
        }
        const branchId = parentNode.branch_id === "request_root"
          ? branchPool[0] || DEFAULT_BRANCHES[0]
          : parentNode.branch_id;
        const branch = branchInfo.get(branchId) || { id: branchId, label: branchLabel(branchId), triggers: [] };
        const templates = candidateTemplates(branchId, depth, { text, intent });
        const childTemplates = templates.slice(0, budgetState.max_children);
        nodesExpanded += 1;
        for (const [index, template] of childTemplates.entries()) {
          if (allNodes.length >= budgetState.max_nodes) break;
          const branchMatch = matchBranch(branch, branchText);
          const intentMatch = branchMatch || template.summary.toLowerCase().includes(String(intent || "").toLowerCase()) || depth === 1;
          const factors = scoreNode({
            depth,
            branchMatch,
            intentMatch,
            evidenceRefs: supportingEvidenceRefs,
            contradictingRefs: contradictingEvidenceRefs,
            branchId,
            config,
            request: {
              confidence: confidence - depth * 0.03,
              signal_strength: signal_strength - depth * 0.04,
              risk: risk + (branchId === "risk_governance" ? 0.08 : 0),
              ambiguity: ambiguity + depth * 0.05,
              reversibility: reversibility - depth * 0.04,
              uncertainty: uncertainty + depth * 0.05,
              source_reliability,
              reuse_score,
              tenant_safe,
              policy_match,
              provenance_refs: provenanceRefs,
            },
            parents: path.map((node) => node.id),
          });
          const nodeId = `${treeId}__${branchId}__l${depth}_${index + 1}_${stableHash(`${path.at(-1)?.id || "root"}:${template.subbranch_id}`).slice(0, 8)}`;
          const node = {
            ...makeContracts({
              runId,
              treeId,
              nodeId,
              parentId: parentNode.id,
              depth,
              tenantRef,
              requestFingerprint,
              branchId,
              subbranchId: template.subbranch_id,
              policyVersion: policy_version,
              catalogVersion: catalog_version,
              coreDecisionReference: core_decision_reference || { state: "shadow", authority: "universal_core" },
              hypothesisSummary: template.summary,
              assumptions: [
                `branch:${branchId}`,
                `depth:${depth}`,
                branchMatch ? "branch_match" : "branch_inference",
                intentMatch ? "intent_match" : "intent_overlay",
              ],
              supportingEvidenceRefs,
              contradictingEvidenceRefs,
              status: "candidate",
              pruneReason: null,
              backtrackReason: null,
              score: factors.score,
              confidence: factors.confidence,
              uncertainty: factors.uncertainty,
              utility: factors.utility,
              risk: factors.risk,
              estimatedCost: clamp(depth * 12 + index * 5, 0, 100),
              nodeType: template.node_type,
              enabled: true,
              version: "1.0.0",
              featureFlag: {
                gate: "CORE_DTT_ENABLED",
                mode_gate: "CORE_DTT_MODE",
                default_enabled: false,
                l6_allowlist: config.l6_allowlist,
              },
              supervisorStatus: factors.score >= threshold ? "APPROVED" : "REJECTED",
              rollbackReference: {
                kill_switch: "CORE_DTT_MODE=off",
                sandbox: "shadow",
                steps: ["disable_dtt_mode", "preserve_v2_mode", "retain_v1_fallback"],
                verification: ["v2_mode_unchanged", "dtt_mode_off"],
              },
              weights: config.weights,
              allowedDepth,
              selected: false,
            }),
            child_ids: [],
            factors,
          };
          if (hardRiskBlock) {
            node.status = "blocked";
            node.prune_reason = "core_or_policy_block";
            pruned += 1;
            pushNode(node, parentNode.id);
            continue;
          }
          if (factors.score < threshold || factors.policy < 40 || factors.reliability < 35) {
            node.status = "pruned";
            node.prune_reason = factors.policy < 40 ? "policy_incompatible" : factors.reliability < 35 ? "source_reliability_low" : "score_below_threshold";
            pruned += 1;
            pushNode(node, parentNode.id);
            continue;
          }
          node.status = "expanded";
          parentNode.children_ids = parentNode.children_ids || [];
          parentNode.children_ids.push(node.id);
          pushNode(node, parentNode.id);
          nextFrontier.push(node);
          if (factors.score > bestScore) {
            bestScore = factors.score;
            bestPath = [...path, node];
          }
          if (depth >= 4 && factors.score >= 82 && factors.uncertainty <= 35) {
            node.status = "selected";
            selectedNode = node;
            selectedPath = [...path, node];
            earlyStop = true;
            break;
          }
        }
        if (earlyStop) break;
      }
      if (earlyStop) break;
      if (nextFrontier.length === 0) {
        backtracks += 1;
        if (bestPath.length > 1) {
          selectedPath = bestPath;
          selectedNode = bestPath.at(-1);
        }
        break;
      }
      activePaths = selectTopCandidates(
        nextFrontier.map((node) => ({ ...node, node_id: node.id })),
        budgetState.beam_width
      ).map((node) => {
        const parentPath = currentPaths.find((path) => path.at(-1)?.id === node.parent_id) || [root];
        return [...parentPath, node];
      });
    }

    if (!selectedNode && bestPath.length > 1) {
      selectedPath = bestPath;
      selectedNode = bestPath.at(-1);
    }

    const selected = Boolean(selectedNode && selectedNode.supervisor_status === "APPROVED");
    const finalState = hardRiskBlock
      ? "blocked"
      : selected
        ? "selected"
        : bestPath.length > 1
          ? "abstained"
          : "failed";
    if (selectedNode) {
      selectedNode.selected = selected;
      selectedNode.status = selected ? "selected" : selectedNode.status;
    }
    if (!selectedNode) {
      pruned += 1;
    }

    const treeNodes = allNodes.map((node) => ({
      ...node,
      selected: selectedNode ? node.id === selectedNode.id : false,
    }));
    const tree = {
      schema_version: DTT_TREE_SCHEMA_VERSION,
      tree_id: treeId,
      run_id: runId,
      root_node_id: root.id,
      nodes: treeNodes,
      edges,
      selected_node_id: selectedNode?.id || null,
      selected_path: selectedPath.map((node) => node.id),
      pruned_node_ids: treeNodes.filter((node) => node.status === "pruned" || node.status === "blocked").map((node) => node.id),
      backtracked_node_ids: treeNodes.filter((node) => node.status === "backtracked").map((node) => node.id),
    };

    const telemetry = {
      tree_created: true,
      nodes_generated: treeNodes.length,
      nodes_expanded: nodesExpanded,
      nodes_pruned: pruned,
      backtracks,
      early_stop: earlyStop,
      max_depth_reached: maxDepthReached,
      branching_factor: treeNodes.length > 1 ? Number(((treeNodes.length - 1) / Math.max(1, nodesExpanded)).toFixed(2)) : 0,
      tree_depth_limit: allowedDepth,
      beam_width: budgetState.beam_width,
      max_children: budgetState.max_children,
      max_nodes: budgetState.max_nodes,
      permanent_branches_used: [...permanentBranchesUsed].slice(0, config.max_permanent_branches),
      permanent_branches_unused: branchPool.filter((branchId) => !permanentBranchesUsed.has(branchId)).slice(0, config.max_permanent_branches),
      requests_without_coverage: selected ? 0 : 1,
      collisions: Math.max(0, treeNodes.length - unique(treeNodes.map((node) => node.id)).length),
      core_denial: hardRiskBlock,
      divergence: {
        v1_v2_dtt: selected ? "advisory_aligned" : "shadow_diverged",
      },
      branch_histogram: branchHistogram,
      depth_histogram: depthHistogram,
      l6_used: allowedDepth > config.default_depth && l6Allowed,
      l6_allowed: l6Allowed,
      tenant_allowed: allowed,
    };

    const run = {
      schema_version: DTT_RUN_SCHEMA_VERSION,
      run_id: runId,
      tree_id: treeId,
      tenant_id: tenantId,
      tenant_ref: tenantRef,
      request_id: requestId,
      request_fingerprint: requestFingerprint,
      policy_version,
      catalog_version,
      mode: config.mode,
      state: finalState,
      allowed_depth: allowedDepth,
      max_depth_reached: maxDepthReached,
      nodes_evaluated: treeNodes.length,
      root_branch_pool: branchPool,
      tree,
      telemetry,
      result: {
        schema_version: DTT_RESULT_SCHEMA_VERSION,
        state: finalState,
        selected_path: selectedPath.map((node) => ({
          node_id: node.id,
          branch_id: node.branch_id,
          depth: node.level,
          score: node.score,
          status: node.status,
        })),
        selected_node_id: selectedNode?.id || null,
        explanation: selectedNode
          ? `Percorso selezionato su ${selectedNode.branch_id} con score ${selectedNode.score.toFixed(2)} e profondità ${selectedPath.length - 1}.`
          : hardRiskBlock
            ? "Astensione per blocco Core/policy."
            : "Nessun percorso ha superato la soglia minima; resta il fallback V1/Core."
        ,
        core_decision_reference: core_decision_reference || { state: "shadow", authority: "universal_core" },
        telemetry,
        shadow_comparison: {
          enabled: true,
          compared_to: "core_operational_runtime",
          selected_branch_count: branchPool.length,
          selected_depth_cap: allowedDepth,
        },
      },
    };

    stats.trees += 1;
    stats.nodes += treeNodes.length;
    stats.expanded += nodesExpanded;
    stats.pruned += pruned;
    stats.backtracked += backtracks;
    stats.selected += selected ? 1 : 0;
    stats.abstained += finalState === "abstained" ? 1 : 0;
    stats.failed += finalState === "failed" ? 1 : 0;
    stats.completed += 1;
    stats.early_stop += earlyStop ? 1 : 0;
    if (allowedDepth > config.default_depth) stats.l6_runs += 1;
    for (const [depth, count] of Object.entries(depthHistogram)) {
      stats.depth_histogram[depth] = (stats.depth_histogram[depth] || 0) + count;
    }
    for (const [branchId, count] of Object.entries(branchHistogram)) {
      stats.branch_histogram[branchId] = (stats.branch_histogram[branchId] || 0) + count;
    }

    remember(run);
    return run;
  }

  function status(tenantId) {
    const stats = tenantStats(tenantId);
    const latest = latestByTenant.get(tenantId) || null;
    return {
      schema_version: DTT_POLICY_VERSION,
      tenant_id: tenantId,
      tenant_ref: pseudonymizeTenant(tenantId, salt),
      enabled: config.enabled && isAllowed(tenantId),
      mode: config.enabled && isAllowed(tenantId) ? config.mode : "off",
      default_depth: config.default_depth,
      max_depth_cap: config.max_depth_cap,
      l6_allowlist: [...config.l6_allowlist],
      max_children: config.max_children,
      beam_width: config.beam_width,
      max_nodes: config.max_nodes,
      tenant_allowed: isAllowed(tenantId),
      tenant_allowlist: [...config.tenant_allowlist],
      policy_version: DTT_POLICY_VERSION,
      feature_flags: config.feature_flags,
      stats: structuredClone(stats),
      latest_run: latest
        ? {
            run_id: latest.run_id,
            tree_id: latest.tree_id,
            state: latest.state,
            selected_node_id: latest.result?.selected_node_id || null,
            selected_path_length: Array.isArray(latest.result?.selected_path) ? latest.result.selected_path.length : 0,
            telemetry: latest.telemetry,
          }
        : null,
    };
  }

  return {
    config,
    evaluate,
    status,
  };
}

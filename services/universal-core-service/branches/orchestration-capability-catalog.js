import { createHash } from "node:crypto";
import { extensionFacetContracts } from "./ai-learning-factory-branch-contracts.js";

export const ORCHESTRATION_CAPABILITY_CATALOG_VERSION = "orchestration_capability_catalog_v1";
export const ORCHESTRATION_CAPABILITY_PAGE_LIMIT = 100;
export const ORCHESTRATION_VIRTUAL_PAGE_LIMIT = 50;

const AGENT_CAPABILITY_DEFINITIONS = [
  ["mission_intake", "mission", "Normalize a goal into a bounded mission contract."],
  ["task_decomposition", "planning", "Decompose a mission into typed tasks and dependencies."],
  ["capability_gap_detection", "planning", "Detect missing capabilities before an agent is selected."],
  ["agent_template_selection", "factory", "Select a versioned agent template from policy-valid candidates."],
  ["ephemeral_agent_materialization", "factory", "Materialize a leased agent instance for one bounded task."],
  ["agent_identity_attestation", "identity", "Verify agent and workload identity before delegation."],
  ["delegation_contract_issue", "identity", "Issue a tenant-bound delegation with scope, budget and expiry."],
  ["execution_lease_management", "identity", "Create, renew or revoke a short-lived execution lease."],
  ["capability_discovery", "registry", "Discover agents through deterministic capability manifests."],
  ["capability_semantic_match", "registry", "Rank policy-valid agents against a typed task."],
  ["topology_selection", "topology", "Select a collaboration topology for the mission constraints."],
  ["sequential_coordination", "topology", "Pass verified artifacts through an ordered agent pipeline."],
  ["parallel_fanout", "topology", "Fan out independent bounded tasks under a concurrency ceiling."],
  ["fanin_reconciliation", "topology", "Join parallel artifacts through a deterministic barrier."],
  ["specialist_handoff", "topology", "Transfer a task with a minimal typed handoff contract."],
  ["supervisor_coordination", "topology", "Coordinate specialists while retaining central ownership."],
  ["debate_coordination", "collaboration", "Run bounded proposal and counter-proposal rounds."],
  ["critic_reviser_loop", "collaboration", "Apply bounded critique and revision before verification."],
  ["quorum_consensus", "collaboration", "Resolve independent judgments with an explicit quorum rule."],
  ["auction_bid_allocation", "collaboration", "Allocate tasks using capability, cost and confidence bids."],
  ["blackboard_coordination", "collaboration", "Coordinate through a scoped shared artifact board."],
  ["turn_scheduling", "scheduling", "Select the next eligible agent under fairness and retry rules."],
  ["concurrency_governance", "scheduling", "Enforce fan-out, parallel-call and depth ceilings."],
  ["context_minimization", "context", "Build the minimum tenant-scoped context for a specialist."],
  ["context_boundary_validation", "context", "Reject cross-task, cross-agent or cross-tenant context bleed."],
  ["working_memory_binding", "memory", "Bind ephemeral task memory to one execution lease."],
  ["memory_write_proposal", "memory", "Propose evidence-backed memory without committing it."],
  ["tool_capability_binding", "tools", "Bind only scoped tools required by the delegated action."],
  ["sandbox_assignment", "execution", "Assign an isolated execution environment and effect policy."],
  ["checkpoint_persistence", "resilience", "Persist a resumable, idempotent workflow checkpoint."],
  ["bounded_retry", "resilience", "Retry a classified transient failure within a fixed budget."],
  ["cancellation_propagation", "resilience", "Propagate cancellation through descendants and tool calls."],
  ["dead_letter_recovery", "resilience", "Quarantine unrecoverable tasks with diagnostic evidence."],
  ["artifact_verification", "verification", "Verify schema, evidence, provenance and acceptance criteria."],
  ["conflict_detection", "verification", "Detect contradictions, duplicate work and ownership conflicts."],
  ["artifact_reconciliation", "verification", "Merge compatible artifacts without hiding disagreement."],
  ["human_review_escalation", "governance", "Pause for explicit review when a policy checkpoint requires it."],
  ["budget_accounting", "governance", "Account for agent, model, tool, token, time and cost budgets."],
  ["trace_observability", "observability", "Emit structured spans for agent, handoff, tool and verifier events."],
  ["agent_teardown", "lifecycle", "Revoke leases and destroy ephemeral state after completion."],
  ["skill_candidate_extraction", "learning", "Extract a bounded skill candidate from verified outcomes."],
  ["skill_contract_compilation", "learning", "Compile skill input, output, scope, limits and evidence contracts."],
  ["skill_sandbox_replay", "learning", "Replay a candidate skill in a sandbox against versioned cases."],
  ["skill_certification", "learning", "Produce a non-activating certification record for a verified skill."],
  ["skill_versioning", "learning", "Version a skill contract, dependencies, digest and compatibility."],
  ["skill_reuse_telemetry", "learning", "Measure redacted skill reuse, quality and cost telemetry."],
  ["skill_failure_detection", "learning", "Detect regressions, drift and failures attributable to a skill."],
  ["skill_deprecation", "learning", "Deprecate unsafe skill versions while preserving lineage."],
  ["skill_rollback", "learning", "Restore the previous verified skill contract."],
];

const AI_CAPABILITY_DEFINITIONS = [
  ["provider_discovery", "registry", "Discover configured AI providers without exposing credentials."],
  ["model_capability_profile", "registry", "Maintain versioned model capability and limitation profiles."],
  ["model_task_matching", "routing", "Match a typed task to policy-valid model candidates."],
  ["model_route_selection", "routing", "Select one model route under quality, risk, latency and cost constraints."],
  ["data_residency_routing", "routing", "Restrict model candidates by tenant data-location policy."],
  ["modality_routing", "routing", "Route text, image, audio, video or structured data to suitable models."],
  ["reasoning_depth_selection", "routing", "Select a bounded reasoning budget for task complexity."],
  ["fast_deep_cascade", "composition", "Escalate from a fast model to a deeper model on measured need."],
  ["parallel_model_ensemble", "composition", "Run bounded independent model candidates for comparison."],
  ["specialist_model_chain", "composition", "Compose specialized models in a typed sequential chain."],
  ["speculative_model_race", "composition", "Race bounded candidates and cancel losing work safely."],
  ["router_verifier_pair", "composition", "Separate generation from independent verification."],
  ["judge_calibration", "verification", "Calibrate model-judge scores against deterministic criteria."],
  ["cross_model_disagreement", "verification", "Surface material disagreement instead of averaging it away."],
  ["confidence_calibration", "verification", "Map raw model confidence to observed task reliability."],
  ["structured_output_validation", "verification", "Validate model output against a strict versioned schema."],
  ["prompt_contract_compilation", "context", "Compile task, policy and capability data into a bounded prompt contract."],
  ["context_window_allocation", "context", "Allocate context tokens by evidence value and task need."],
  ["context_compression", "context", "Compress context while retaining provenance and critical constraints."],
  ["evidence_retrieval_routing", "evidence", "Choose evidence sources and retrieval strategies by task."],
  ["citation_provenance_binding", "evidence", "Bind claims to source identifiers, freshness and extraction evidence."],
  ["research_distillation", "evidence", "Distill verified evidence into a reusable bounded artifact."],
  ["semantic_cache_selection", "optimization", "Reuse only tenant-safe, policy-compatible cached results."],
  ["token_budget_allocation", "optimization", "Allocate token ceilings across generation and verification."],
  ["latency_budget_allocation", "optimization", "Allocate deadlines and cancellation thresholds per model call."],
  ["cost_value_optimization", "optimization", "Optimize expected verified value rather than raw model price."],
  ["quota_rate_governance", "optimization", "Respect provider quotas and prevent retry amplification."],
  ["provider_failover", "resilience", "Fail over to a compatible provider under an explicit compatibility contract."],
  ["model_degradation_path", "resilience", "Provide a lower-capability but safe degraded route."],
  ["circuit_breaker", "resilience", "Stop calls to unhealthy or drifting model routes."],
  ["safety_model_screening", "safety", "Apply specialized safety screening without granting authority."],
  ["privacy_redaction", "safety", "Redact disallowed data before an external model call."],
  ["model_drift_detection", "evaluation", "Detect behavioral, quality, latency and cost drift."],
  ["shadow_strategy_evaluation", "evaluation", "Evaluate new routing strategies without controlling production."],
  ["canary_strategy_evaluation", "evaluation", "Bound exposure while measuring a verified routing candidate."],
  ["provider_output_normalization", "interoperability", "Normalize provider-specific responses into a common contract."],
  ["model_version_rollback", "lifecycle", "Restore a verified model-route version after regression."],
  ["learning_signal_proposal", "learning", "Propose routing improvements from verified outcomes only."],
  ["universal_abstention_policy", "governance", "Apply a consistent abstention policy across providers and task risk."],
  ["confidence_to_autonomy_mapping", "governance", "Map calibrated confidence to advisory, review or block states."],
  ["task_difficulty_classifier", "routing", "Classify task difficulty for bounded budget and verification selection."],
  ["quality_cost_router", "routing", "Optimize routes against verified quality per unit cost."],
  ["model_snapshot_registry", "registry", "Bind routes and evaluations to immutable model snapshots."],
  ["prompt_budget_enforcement", "optimization", "Enforce prompt and context budgets before provider invocation."],
  ["tool_surface_minimization", "tools", "Expose only the minimum tool surface required by a task."],
  ["tool_schema_budget", "tools", "Limit tool schema count and size to the verified minimum required by a task."],
  ["stable_prefix_compilation", "context", "Compile a versioned stable prefix without dynamic authority or sensitive data."],
  ["provider_usage_normalization", "interoperability", "Normalize provider usage while separating verified receipts from estimates."],
];

const AGENT_VIRTUAL_DIMENSIONS = Object.freeze({
  topology: ["supervisor", "sequential", "parallel", "fanout_fanin", "handoff", "debate", "critic_reviser", "quorum", "auction", "blackboard", "swarm", "hierarchical"],
  lifecycle: ["ephemeral", "session", "leased", "checkpointed", "resumable", "persistent_profile"],
  specialization: ["generalist", "researcher", "planner", "executor", "reviewer", "verifier", "critic", "integrator", "observer", "recovery"],
  memory: ["stateless", "working", "episodic", "semantic", "procedural"],
  verification: ["schema", "evidence", "critic", "cross_agent", "quorum", "human_checkpoint"],
  communication: ["tool_call", "typed_handoff", "event_bus", "shared_blackboard", "artifact_exchange"],
  resilience: ["fail_closed", "retry", "fallback", "checkpoint_resume", "dead_letter"],
});

const AI_VIRTUAL_DIMENSIONS = Object.freeze({
  route: ["single_best", "fast_deep", "cost_first", "quality_first", "risk_first", "latency_first", "residency_first", "adaptive", "shadow", "canary"],
  composition: ["single", "cascade", "parallel_ensemble", "specialist_chain", "router_verifier", "generator_critic", "speculative_race", "quorum", "fallback_chain"],
  modality: ["text", "vision", "audio", "video", "code", "structured_data", "multimodal"],
  evidence: ["none", "retrieval", "web_research", "tenant_knowledge", "cross_source", "freshness_gated"],
  verifier: ["schema", "deterministic", "independent_model", "cross_provider", "human", "hybrid"],
  fallback: ["fail_closed", "same_provider", "cross_provider", "degraded_model", "cached_verified", "human_escalation"],
  optimization: ["balanced", "quality", "cost", "latency", "privacy", "energy"],
});

function freezeCapabilities(branchId, definitions) {
  const extensionContracts = extensionFacetContracts(branchId);
  return Object.freeze(definitions.map(([id, category, description]) => {
    const extension = extensionContracts[id] || null;
    return Object.freeze({
      capability_id: `${branchId}.${id}`,
      action_id: id,
      category,
      description,
      authority: "advisory",
      execution_effect: "none",
      contract_version: 1,
      ...(extension ? {
        input: extension.input,
        output: extension.output,
        activation: extension.activation,
        non_activation: extension.non_activation,
        evidence: extension.evidence,
        metrics: extension.metrics,
        fallback: extension.fallback,
        abstention: extension.abstention,
        audit: extension.audit,
        rollback: extension.rollback,
        core_binding: extension.core_binding,
        positive_tests: extension.positive_tests,
        negative_tests: extension.negative_tests,
      } : {}),
    });
  }));
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildCatalog(branchId, definitions, dimensions) {
  const capabilities = freezeCapabilities(branchId, definitions);
  const dimensionEntries = Object.entries(dimensions).map(([id, values]) => Object.freeze({
    dimension_id: id,
    values: Object.freeze([...values]),
  }));
  const total = dimensionEntries.reduce((product, dimension) => product * BigInt(dimension.values.length), 1n);
  const stableCore = {
    schema_version: ORCHESTRATION_CAPABILITY_CATALOG_VERSION,
    branch_id: branchId,
    capabilities,
    dimensions: dimensionEntries,
  };
  return Object.freeze({
    ...stableCore,
    fingerprint: fingerprint(stableCore),
    virtual_combination_count: total.toString(),
  });
}

const CATALOGS = Object.freeze({
  agent_orchestration: buildCatalog("agent_orchestration", AGENT_CAPABILITY_DEFINITIONS, AGENT_VIRTUAL_DIMENSIONS),
  ai_orchestration: buildCatalog("ai_orchestration", AI_CAPABILITY_DEFINITIONS, AI_VIRTUAL_DIMENSIONS),
});

function requireCatalog(branchId, version) {
  const catalog = CATALOGS[String(branchId || "")];
  if (!catalog) throw new RangeError(`unknown orchestration catalog: ${branchId}`);
  if (version && version !== ORCHESTRATION_CAPABILITY_CATALOG_VERSION) {
    throw new RangeError(`unsupported orchestration catalog version: ${version}`);
  }
  return catalog;
}

function boundedLimit(value, fallback, ceiling) {
  const numeric = Number(value ?? fallback);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, ceiling);
}

function decodeCursor(cursor) {
  if (cursor === null || cursor === undefined || cursor === "") return 0n;
  if (!/^\d+$/.test(String(cursor))) throw new RangeError("cursor must be a non-negative integer");
  return BigInt(cursor);
}

function encodeCursor(offset, total) {
  return offset < total ? offset.toString() : null;
}

export function orchestrationCatalogDescriptor(branchId) {
  const catalog = requireCatalog(branchId);
  return Object.freeze({
    schema_version: catalog.schema_version,
    branch_id: catalog.branch_id,
    fingerprint: catalog.fingerprint,
    capability_count: catalog.capabilities.length,
    category_count: new Set(catalog.capabilities.map((item) => item.category)).size,
    virtual_dimension_count: catalog.dimensions.length,
    virtual_combination_count: catalog.virtual_combination_count,
    taxonomy_depth: 30,
    virtual_depth_policy: "recursive_lazy_without_static_catalog_ceiling",
    expansion_mode: "lazy_deterministic_paged",
    runtime_policy: "bounded_materialization_only_with_explicit_plan_depth",
  });
}

export function listOrchestrationCapabilities({
  branchId,
  version = ORCHESTRATION_CAPABILITY_CATALOG_VERSION,
  cursor = "0",
  limit = 25,
} = {}) {
  const catalog = requireCatalog(branchId, version);
  const offset = decodeCursor(cursor);
  const pageLimit = boundedLimit(limit, 25, ORCHESTRATION_CAPABILITY_PAGE_LIMIT);
  const total = BigInt(catalog.capabilities.length);
  const start = offset > total ? total : offset;
  const end = start + BigInt(pageLimit) > total ? total : start + BigInt(pageLimit);
  return {
    ...orchestrationCatalogDescriptor(branchId),
    cursor: start.toString(),
    next_cursor: encodeCursor(end, total),
    page_limit: pageLimit,
    items: catalog.capabilities.slice(Number(start), Number(end)),
  };
}

function combinationAt(catalog, index) {
  let remainder = index;
  const selection = {};
  for (let position = catalog.dimensions.length - 1; position >= 0; position -= 1) {
    const dimension = catalog.dimensions[position];
    const radix = BigInt(dimension.values.length);
    selection[dimension.dimension_id] = dimension.values[Number(remainder % radix)];
    remainder /= radix;
  }
  return Object.freeze({
    combination_id: `${catalog.branch_id}.virtual.${index.toString(36).padStart(8, "0")}`,
    ordinal: index.toString(),
    selection: Object.freeze(selection),
    materialized: false,
    authority: "proposal_only",
  });
}

export function listVirtualOrchestrationCombinations({
  branchId,
  version = ORCHESTRATION_CAPABILITY_CATALOG_VERSION,
  cursor = "0",
  limit = 20,
} = {}) {
  const catalog = requireCatalog(branchId, version);
  const total = BigInt(catalog.virtual_combination_count);
  const offset = decodeCursor(cursor);
  const pageLimit = boundedLimit(limit, 20, ORCHESTRATION_VIRTUAL_PAGE_LIMIT);
  const start = offset > total ? total : offset;
  const end = start + BigInt(pageLimit) > total ? total : start + BigInt(pageLimit);
  const items = [];
  for (let index = start; index < end; index += 1n) {
    items.push(combinationAt(catalog, index));
  }
  return {
    ...orchestrationCatalogDescriptor(branchId),
    cursor: start.toString(),
    next_cursor: encodeCursor(end, total),
    page_limit: pageLimit,
    items,
  };
}

export function orchestrationCapabilityIds(branchId) {
  return requireCatalog(branchId).capabilities.map((item) => item.action_id);
}

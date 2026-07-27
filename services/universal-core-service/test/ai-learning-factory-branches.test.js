import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_AGENTIC_EFFICIENCY_BRANCHES,
  AI_LEARNING_FACTORY_CAPABILITY_ALIASES,
  AI_LEARNING_CORE_GUARDS,
  AI_LEARNING_FACTORY_BRANCHES,
  AI_LEARNING_FACTORY_EXTENSION_FACETS,
} from "../branches/ai-learning-factory-branch-contracts.js";
import {
  deterministicBranchGroups,
  deterministicBranchRegistry,
  getBranch,
  listOrchestrationCapabilities,
} from "../branches/index.js";
import {
  nyraBranchCatalog,
  routeNyraBranches,
  validateNyraBranchNetwork,
} from "../src/nyraBranchNetwork.js";

const EXPECTED_BRANCHES = {
  ai_evaluation_intelligence: [
    "evaluation_intake", "dataset_registry", "golden_case_versioning", "trace_capture_contract",
    "branch_selection_accuracy", "tool_selection_accuracy", "handoff_accuracy", "final_output_quality",
    "safety_compliance_score", "judge_calibration", "human_annotation_agreement", "regression_detection",
    "benchmark_segmentation", "contamination_guard", "eval_replay", "release_scorecard",
  ],
  learning_data_governance: [
    "outcome_event_normalization", "label_provenance", "consent_eligibility", "tenant_scope_validation",
    "secret_pii_redaction", "data_quality_gate", "deduplication", "hard_negative_mining",
    "active_learning_sampling", "replay_buffer", "train_eval_separation", "poisoning_detection",
    "retention_expiry", "dataset_versioning", "learning_candidate_promotion", "deletion_reconciliation",
  ],
  ai_runtime_performance_intelligence: [
    "run_latency_decomposition", "time_to_first_token", "branch_router_latency", "tool_call_latency",
    "handoff_latency", "token_efficiency", "cost_per_success", "retry_fallback_efficiency",
    "cache_hit_quality", "queue_backpressure", "concurrency_saturation", "provider_model_comparison",
    "quality_cost_pareto", "slo_breach_detection", "capacity_forecast", "performance_release_score",
  ],
  experiment_causal_learning: [
    "experiment_intake", "hypothesis_definition", "baseline_control", "assignment_integrity",
    "shadow_experiment", "canary_experiment", "ab_experiment", "guardrail_metrics",
    "uplift_estimation", "sequential_stopping", "novelty_interference_guard", "causal_attribution",
    "rollback_trigger", "experiment_registry", "promotion_recommendation", "post_promotion_monitoring",
  ],
  model_adaptation_lab: [
    "prompt_version_registry", "prompt_candidate_generation", "router_candidate", "model_candidate",
    "reasoning_effort_candidate", "tool_surface_candidate", "distillation_candidate", "fine_tune_candidate",
    "offline_eval", "shadow_eval", "risk_review", "cost_review", "promotion_proposal", "rollback_snapshot",
    "drift_revalidation", "candidate_deprecation",
  ],
};

const EXPECTED_GUARDS = {
  ai_learning_governance_guard: [
    "learning_candidate_intake", "evidence_completeness", "eval_threshold_policy",
    "human_review_requirement", "promotion_authority", "rollback_binding", "expiry_revalidation",
    "shadow_canary_gate", "model_prompt_version_binding", "experiment_lineage", "audit_commit",
    "post_promotion_watch", "emergency_stop",
  ],
  ai_data_integrity_guard: [
    "tenant_scope_enforcement", "client_audience_boundary", "consent_binding", "pii_secret_redaction",
    "provenance_required", "label_integrity", "dataset_version_lock", "train_eval_separation",
    "poisoning_injection_quarantine", "retention_deletion", "export_restriction", "incident_revocation",
  ],
};

const EXPECTED_EXTENSIONS = {
  agent_orchestration: [
    "skill_candidate_extraction", "skill_contract_compilation", "skill_sandbox_replay",
    "skill_certification", "skill_versioning", "skill_reuse_telemetry", "skill_failure_detection",
    "skill_deprecation", "skill_rollback",
  ],
  adaptive_learning_intelligence: [
    "active_learning", "hard_case_prioritization", "negative_example_replay",
    "feedback_bias_detection", "reviewer_disagreement", "learning_value_estimation",
    "savings_outcome_validation",
  ],
  learning_knowledge_intelligence: [
    "retrieval_precision_recall", "context_relevance_scoring", "chunking_strategy_evaluation",
    "embedding_version_registry", "reranking_quality", "freshness_expiry", "citation_coverage",
    "knowledge_poisoning_detection", "index_rebuild_policy",
  ],
  ai_orchestration: [
    "universal_abstention_policy", "confidence_to_autonomy_mapping", "task_difficulty_classifier",
    "quality_cost_router", "model_snapshot_registry", "prompt_budget_enforcement",
    "tool_surface_minimization", "tool_schema_budget", "stable_prefix_compilation",
    "provider_usage_normalization",
  ],
  observability_roi_guard: [
    "cost_per_verified_outcome", "tokens_per_verified_outcome",
    "invocations_per_verified_outcome", "duplicate_work_cost", "retry_cost", "reviewer_cost",
    "cache_savings", "context_compaction_savings", "model_routing_savings",
    "quality_adjusted_savings",
  ],
  decision_provenance_intelligence: [
    "baseline_run_reference", "optimized_run_reference", "usage_source",
    "rate_card_reference", "savings_calculation", "quality_delta",
    "approval_and_expiry", "rollback_reference",
  ],
};

const EXPECTED_AGENTIC_EFFICIENCY = {
  agentic_efficiency_intelligence: [
    "task_complexity_estimation", "single_vs_multi_agent_selection", "context_compaction",
    "delta_context_packaging", "semantic_memory_reuse", "stable_prompt_prefix",
    "tool_surface_minimization", "relevant_file_selection", "duplicate_work_suppression",
    "agent_result_reuse", "verified_artifact_reuse", "adaptive_review_depth",
    "selective_reviewer_context", "retry_budget_optimization", "early_stop_policy",
    "model_cost_quality_routing", "provider_capability_detection", "credit_forecast",
    "credit_savings_attribution", "quality_cost_pareto", "invocation_reduction",
    "work_capsule_compilation", "agent_context_expiry", "efficiency_drift_detection",
  ],
  agentic_budget_governance_guard: [
    "per_run_credit_budget", "per_project_credit_budget", "per_agent_budget", "token_budget",
    "invocation_budget", "retry_budget", "reviewer_budget", "model_escalation_gate",
    "quality_floor", "safety_non_degradation", "budget_override_audit",
    "provider_rate_card_version", "actual_vs_estimated_usage", "missing_usage_fail_safe",
    "cost_provenance", "duplicate_execution_block", "stale_context_block", "cache_integrity",
    "work_capsule_integrity", "budget_policy_expiry", "savings_claim_guard",
    "critical_task_cost_override",
  ],
};

const CONTRACT_FIELDS = [
  "input", "output", "activation", "non_activation", "evidence", "metrics", "fallback",
  "abstention", "audit", "rollback",
];

function assertCompleteContract(contract, canonicalId) {
  assert(contract, `missing contract ${canonicalId}`);
  assert.match(contract.purpose, /\S+/, `empty purpose ${canonicalId}`);
  for (const field of CONTRACT_FIELDS) {
    assert(contract[field], `missing ${field} in ${canonicalId}`);
    if (Array.isArray(contract[field])) assert(contract[field].length > 0, `empty ${field} in ${canonicalId}`);
  }
  assert.equal(contract.output.authority, "advisory");
  assert.equal(contract.output.autonomous_activation, false);
  assert.equal(contract.evidence.raw_prompt_storage, false);
  assert.equal(contract.evidence.raw_sensitive_content_storage, false);
  assert.equal(contract.rollback.reference_required, true);
}

test("AI Learning Factory registers the five exact Nyra branches with complete bounded contracts", () => {
  const registry = deterministicBranchRegistry();
  const canonicalIds = new Set();
  for (const [branchId, expectedSubbranches] of Object.entries(EXPECTED_BRANCHES)) {
    const blueprint = AI_LEARNING_FACTORY_BRANCHES[branchId];
    const registered = registry[branchId];
    assert(blueprint);
    assert(registered);
    assert.deepEqual(registered.subbranches, expectedSubbranches);
    assert.equal(registered.subbranches.length, 16);
    assert.equal(new Set(registered.subbranches).size, 16);
    assert.equal(registered.production_status, branchId === "model_adaptation_lab" ? "test_only" : "advisory");
    for (const subbranchId of expectedSubbranches) {
      const canonicalId = `${branchId}.${subbranchId}`;
      assert.equal(canonicalIds.has(canonicalId), false, `duplicate ${canonicalId}`);
      canonicalIds.add(canonicalId);
      assertCompleteContract(registered.subbranch_contracts[subbranchId], canonicalId);
    }
  }
});

test("Core registers both exact AI learning guards with non-activating contracts", () => {
  const registry = deterministicBranchRegistry();
  for (const [branchId, expectedSubbranches] of Object.entries(EXPECTED_GUARDS)) {
    const blueprint = AI_LEARNING_CORE_GUARDS[branchId];
    const registered = registry[branchId];
    assert(blueprint);
    assert(registered);
    assert.deepEqual(registered.subbranches, expectedSubbranches);
    assert.equal(registered.production_status, "advisory");
    assert.equal(registered.exposure_class, "codex_internal");
    for (const subbranchId of expectedSubbranches) {
      assertCompleteContract(registered.subbranch_contracts[subbranchId], `${branchId}.${subbranchId}`);
    }
    const descriptor = getBranch(branchId);
    assert.equal(descriptor.guardrails.autonomous_promotion ?? false, false);
    assert.equal(descriptor.guardrails.external_execution, false);
  }
});

test("new and directly extended descriptors carry complete least-privilege exposure contracts", () => {
  const registry = deterministicBranchRegistry();
  const horizontal = [
    "ai_evaluation_intelligence",
    "learning_data_governance",
    "ai_runtime_performance_intelligence",
    "experiment_causal_learning",
    "agent_orchestration",
    "adaptive_learning_intelligence",
    "ai_orchestration",
    "decision_provenance_intelligence",
  ];
  for (const branchId of horizontal) {
    const descriptor = registry[branchId];
    assert.equal(descriptor.exposure_class, "chatgpt_horizontal");
    assert(descriptor.allowed_client_types.includes("chatgpt"));
    assert(descriptor.allowed_audiences.includes("chatgpt_connector"));
    assert.deepEqual(descriptor.required_entitlements, []);
    assert.equal(descriptor.discoverable_in_connector, true);
    assert.equal(descriptor.semantic_select_allowed, true);
  }

  for (const branchId of [
    "learning_knowledge_intelligence",
    "observability_roi_guard",
    ...Object.keys(EXPECTED_GUARDS),
  ]) {
    const descriptor = registry[branchId];
    assert.equal(descriptor.exposure_class, "codex_internal");
    assert.deepEqual(descriptor.allowed_client_types, ["codex", "admin"]);
    assert.deepEqual(descriptor.allowed_audiences, ["codex_internal", "admin_control_room"]);
  }

  const lab = registry.model_adaptation_lab;
  assert.equal(lab.exposure_class, "test_only");
  assert.deepEqual(lab.allowed_client_types, ["admin"]);
  assert.deepEqual(lab.allowed_audiences, ["admin_control_room"]);
  assert.equal(lab.semantic_select_allowed, false);
});

test("extensions use bounded facets or lazy catalogs and every added capability has a full contract", () => {
  const registry = deterministicBranchRegistry();
  for (const [branchId, expectedIds] of Object.entries(EXPECTED_EXTENSIONS)) {
    const sourceContracts = AI_LEARNING_FACTORY_EXTENSION_FACETS[branchId];
    assert.deepEqual(Object.keys(sourceContracts), expectedIds);
    const descriptor = registry[branchId];
    assert.equal(descriptor.capability_facets.facet_count, expectedIds.length);
    assert(expectedIds.length <= 20);
    for (const capabilityId of expectedIds) {
      assertCompleteContract(sourceContracts[capabilityId], `${branchId}.${capabilityId}`);
    }
  }

  assert.equal(registry.adaptive_learning_intelligence.subbranches.length, 16);
  assert.equal(registry.learning_knowledge_intelligence.subbranches.length, 17);

  for (const branchId of ["agent_orchestration", "ai_orchestration"]) {
    const page = listOrchestrationCapabilities({ branchId, limit: 100 });
    const byId = new Map(page.items.map((item) => [item.action_id, item]));
    for (const capabilityId of EXPECTED_EXTENSIONS[branchId]) {
      const capability = byId.get(capabilityId);
      assert(capability, `missing lazy capability ${branchId}.${capabilityId}`);
      for (const field of CONTRACT_FIELDS) assert(capability[field], `missing ${field} in ${branchId}.${capabilityId}`);
      assert.equal(capability.execution_effect, "none");
    }
  }
});

test("agentic addendum aliases resolve to one canonical behavior without duplicate capability IDs", () => {
  assert.deepEqual(AI_LEARNING_FACTORY_CAPABILITY_ALIASES, {
    agent_orchestration: {
      skill_extraction: "skill_candidate_extraction",
      skill_replay_verification: "skill_sandbox_replay",
    },
  });
  const page = listOrchestrationCapabilities({ branchId: "agent_orchestration", limit: 100 });
  const ids = page.items.map((item) => item.action_id);
  assert.equal(ids.includes("skill_extraction"), false);
  assert.equal(ids.includes("skill_replay_verification"), false);
  assert.equal(ids.filter((id) => id === "skill_candidate_extraction").length, 1);
  assert.equal(ids.filter((id) => id === "skill_sandbox_replay").length, 1);
});

test("agentic efficiency and budget descriptors preserve all IDs with at most twenty direct subbranches", () => {
  const registry = deterministicBranchRegistry();
  for (const [branchId, expectedIds] of Object.entries(EXPECTED_AGENTIC_EFFICIENCY)) {
    const blueprint = AI_AGENTIC_EFFICIENCY_BRANCHES[branchId];
    const descriptor = registry[branchId];
    assert(blueprint);
    assert(descriptor);
    assert.deepEqual(descriptor.all_capability_ids, expectedIds);
    assert.deepEqual(descriptor.subbranches, expectedIds.slice(0, 20));
    assert.equal(descriptor.subbranches.length, 20);
    assert.equal(descriptor.capability_facets.facet_count, expectedIds.length - 20);
    assert.deepEqual(
      descriptor.capability_facets.facets.map((item) => item.id),
      expectedIds.slice(20),
    );

    const contracts = {
      ...descriptor.subbranch_contracts,
      ...Object.fromEntries(descriptor.capability_facets.facets.map((item) => [item.id, item])),
    };
    for (const capabilityId of expectedIds) {
      assertCompleteContract(contracts[capabilityId], `${branchId}.${capabilityId}`);
    }
    assert.equal(descriptor.core_branch_bindings.includes(branchId), true);
    assert.equal(getBranch(branchId).guardrails.external_execution, false);
  }

  assert.equal(registry.agentic_efficiency_intelligence.exposure_class, "chatgpt_horizontal");
  assert.equal(registry.agentic_budget_governance_guard.exposure_class, "codex_internal");
  assert.deepEqual(registry.agentic_efficiency_intelligence.core_branch_bindings, [
    "agentic_efficiency_intelligence",
    "agentic_budget_governance_guard",
  ]);
});

test("Nyra network remains bounded, routes four advisory branches and never default-routes the test lab", () => {
  const validation = validateNyraBranchNetwork();
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.ok, true);

  const catalog = nyraBranchCatalog("generic");
  const byId = new Map(catalog.branches.map((branch) => [branch.id, branch]));
  for (const branchId of Object.keys(EXPECTED_BRANCHES).filter((id) => id !== "model_adaptation_lab")) {
    const branch = byId.get(branchId);
    assert(branch, `missing Nyra branch ${branchId}`);
    assert.equal(branch.subbranch_count, 16);
    assert.equal(branch.production_status, "advisory");
  }
  assert.equal(byId.has("model_adaptation_lab"), false);

  const routed = routeNyraBranches({
    text: "Prepara scorecard AI, governa dataset candidate, misura TTFT e valuta shadow experiment.",
    domainPackId: "generic",
  });
  const opened = routed.opened_branches.map((branch) => branch.id);
  for (const branchId of [
    "ai_evaluation_intelligence",
    "learning_data_governance",
    "ai_runtime_performance_intelligence",
    "experiment_causal_learning",
  ]) {
    assert(opened.includes(branchId), `not routed ${branchId}`);
  }
  assert.equal(opened.includes("model_adaptation_lab"), false);

  const forcedLab = routeNyraBranches({
    text: "production model adaptation",
    requestedBranches: ["model_adaptation_lab"],
    domainPackId: "generic",
  });
  assert.equal(forcedLab.opened_branches.some((branch) => branch.id === "model_adaptation_lab"), false);
  assert.deepEqual(forcedLab.denied_branches, ["model_adaptation_lab"]);
  assert.equal(forcedLab.execution_authorized, false);
});

test("AI Learning Factory group is complete and all descriptors forbid autonomous external action", () => {
  assert.deepEqual(deterministicBranchGroups().ai_learning_factory.branches, [
    ...Object.keys(EXPECTED_BRANCHES),
    ...Object.keys(EXPECTED_GUARDS),
    ...Object.keys(EXPECTED_AGENTIC_EFFICIENCY),
  ]);
  for (const branchId of [
    ...Object.keys(EXPECTED_BRANCHES),
    ...Object.keys(EXPECTED_GUARDS),
    ...Object.keys(EXPECTED_AGENTIC_EFFICIENCY),
  ]) {
    const branch = getBranch(branchId);
    assert(branch);
    assert.equal(branch.guardrails.destructive_automation, false);
    assert.equal(branch.guardrails.external_execution, false);
  }
});

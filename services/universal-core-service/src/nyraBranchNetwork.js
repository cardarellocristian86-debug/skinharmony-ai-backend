const MAX_SUBBRANCHES_PER_BRANCH = 20;
const MAX_PARALLEL_BRANCHES = 6;

const branch = (id, label, triggers, subbranches, domainPacks = ["*"], options = {}) => Object.freeze({
  id,
  label,
  triggers: Object.freeze(triggers),
  domain_packs: Object.freeze(domainPacks),
  subbranches: Object.freeze(subbranches.map((subbranch) => Object.freeze(subbranch))),
  work_phase: String(options.workPhase || "general"),
  core_branch_bindings: Object.freeze(Array.isArray(options.coreBranchBindings) ? options.coreBranchBindings : []),
});

const NYRA_BRANCHES = Object.freeze([
  branch("context_intelligence", "Context Intelligence", ["contesto", "stato", "dati", "input", "mappa"], [
    "request_normalization", "actor_context", "tenant_context", "system_context", "temporal_context",
    "data_quality", "missing_information", "source_reliability", "constraint_mapping", "language_context",
  ], ["*"], { workPhase: "intake", coreBranchBindings: ["work_intake_intelligence"] }),
  branch("work_intake", "Work Intake", ["obiettivo", "requisit", "deliverable", "risultato", "vincol", "scope", "lavoro", "task"], [
    "goal_clarification", "deliverable_definition", "success_criteria", "scope_boundary", "constraint_inventory",
    "stakeholder_context", "urgency_assessment", "resource_context", "dependency_discovery", "ambiguity_detection",
    "assumption_register", "missing_input_request", "decomposition_boundary", "intake_summary",
  ], ["*"], { workPhase: "intake", coreBranchBindings: ["work_intake_intelligence"] }),
  branch("research_evidence", "Research & Evidence", ["ricerca", "fonti", "evidenz", "verifica dati", "documentazione", "paper", "benchmark", "source"], [
    "research_question", "source_discovery", "source_authority", "source_freshness", "triangulation",
    "fact_extraction", "contradiction_detection", "uncertainty_register", "provenance_capture", "missing_evidence",
    "dataset_relevance", "citation_constraints", "evidence_synthesis", "research_handoff", "claim_evidence_graph",
    "temporal_truth", "adversarial_source_review", "uncertainty_calibration", "knowledge_release_gate", "source_injection_defense",
  ], ["*"], { workPhase: "research", coreBranchBindings: ["research_evidence_intelligence"] }),
  branch("decision_reasoning", "Decision Reasoning", ["decidi", "scegli", "priorita", "opzioni", "strategia", "valuta"], [
    "intent_inference", "hypothesis_generation", "option_generation", "tradeoff_analysis", "priority_ranking",
    "causal_reasoning", "counterfactual_reasoning", "confidence_calibration", "decision_summary", "next_best_action",
  ], ["*"], { workPhase: "planning", coreBranchBindings: ["planning_priority_intelligence"] }),
  branch("planning_prioritization", "Planning & Prioritization", ["pianifica", "priorit", "roadmap", "sequenza", "milestone", "dipenden", "stima"], [
    "work_breakdown", "priority_matrix", "dependency_graph", "critical_path", "effort_estimation",
    "value_estimation", "risk_adjusted_order", "milestone_design", "capacity_fit", "timebox_design",
    "decision_points", "fallback_sequence", "definition_of_ready", "next_action_selection", "plan_summary",
  ], ["*"], { workPhase: "planning", coreBranchBindings: ["planning_priority_intelligence"] }),
  branch("risk_governance", "Risk & Governance", ["rischio", "sicurezza", "privacy", "policy", "audit", "tenant", "permessi"], [
    "risk_detection", "policy_alignment", "tenant_isolation", "scope_validation", "privacy_review",
    "security_review", "compliance_review", "claim_review", "pricing_review", "audit_evidence",
    "confirmation_gate", "rollback_readiness",
  ], ["*"], { workPhase: "governance", coreBranchBindings: ["quality_verification_intelligence"] }),
  branch("delegated_authority", "Delegated Authority", ["delega", "agente", "workload", "identita", "identity", "oauth", "token", "scope", "audience", "revoca", "impersona"], [
    "principal_identity", "workload_attestation", "trust_domain_boundary", "delegation_chain", "act_as_scope",
    "resource_audience_binding", "credential_lifetime", "credential_rotation", "token_separation", "revocation_check",
    "redirect_uri_validation", "delegation_expiry", "incident_containment", "authority_summary",
  ], ["*"], { workPhase: "governance", coreBranchBindings: ["workload_identity_delegation_guard"] }),
  branch("decision_provenance", "Decision Provenance", ["provenienza", "provenance", "verdict", "decisione", "conferma", "approvazione", "audit", "rollback", "evidenza", "tracciabil"], [
    "request_fingerprint", "actor_authority", "policy_snapshot", "evidence_lineage", "risk_rationale",
    "decision_contract", "confirmation_scope", "decision_expiry", "revalidation_trigger", "reversal_path",
    "audit_safe_summary", "cross_tenant_replay_check", "accountability_handoff", "provenance_summary",
  ], ["*"], { workPhase: "governance", coreBranchBindings: ["decision_provenance_intelligence"] }),
  branch("relational_supervision", "Relational Orchestration Supervision", [
    "relazioni agenti", "supervisore relazionale", "relational supervisor", "collisioni", "duplicazioni", "conflitti agenti",
  ], [
    "actor_relation_graph", "authority_relation_matrix", "creator_parent_lineage", "trust_attestation",
    "delegation_relation", "dependency_relation", "communication_health", "context_overlap",
    "duplicate_work_detection", "conflict_detection", "consensus_quality", "sycophancy_detection",
    "collusion_detection", "handoff_precision", "load_balance", "idle_agent_detection",
    "relationship_repair_proposal", "escalation_proposal", "core_join_readiness", "relational_health_summary",
  ], ["*"], { workPhase: "coordination", coreBranchBindings: ["agent_orchestration", "ai_orchestration"] }),
  branch("agent_orchestration", "Agent Orchestration", [
    "crea agent", "creare agent", "orchestra agent", "multiagente", "multi-agent", "squadra agent", "agent factory",
  ], [
    "mission_compilation", "agent_archetype_selection", "capability_composition", "identity_attestation",
    "delegation_lease", "tool_scope_binding", "memory_scope_binding", "budget_envelope",
    "topology_selection", "task_graph_compilation", "scheduler_selection", "handoff_contract",
    "checkpoint_strategy", "verification_assignment", "conflict_resolution", "termination_contract",
    "kill_switch", "recovery_strategy", "core_join", "verified_retirement",
  ], ["*"], { workPhase: "coordination", coreBranchBindings: ["agent_orchestration"] }),
  branch("ai_orchestration", "AI Orchestration", [
    "orchestra ai", "multi-ai", "modelli ai", "provider ai", "model routing", "ensemble ai", "fallback modello",
  ], [
    "provider_discovery", "model_capability_profile", "quality_cost_latency_route", "modality_route",
    "context_compilation", "prompt_skill_composition", "retrieval_evidence_route", "tool_mcp_mediation",
    "model_cascade", "parallel_ensemble", "critic_verifier", "judge_calibration",
    "uncertainty_abstention", "quota_rate_limit", "provider_failover", "data_locality",
    "trace_provenance", "eval_drift", "distillation_candidate", "core_model_join",
  ], ["*"], { workPhase: "coordination", coreBranchBindings: ["ai_orchestration"] }),
  branch("execution_planning", "Execution Planning", ["piano", "esegui", "runbook", "deploy", "render", "automat", "implementa"], [
    "goal_decomposition", "dependency_mapping", "runbook_design", "resource_estimation", "failure_mode_analysis",
    "test_strategy", "release_strategy", "rollback_plan", "human_confirmation", "evidence_plan",
  ], ["*"], { workPhase: "execution", coreBranchBindings: ["execution_coordination_intelligence"] }),
  branch("parallel_coordination", "Parallel Coordination", ["parallelo", "coordina", "delega", "agenti", "handoff", "concorren", "sincron", "collabora"], [
    "lane_partitioning", "agent_capability_match", "task_ownership", "shared_context_contract", "dependency_barrier",
    "concurrency_limit", "handoff_protocol", "progress_checkpoint", "conflict_detection", "merge_strategy",
    "duplicate_work_prevention", "blocked_lane_recovery", "cross_lane_evidence", "join_readiness", "coordination_summary",
  ], ["*"], { workPhase: "coordination", coreBranchBindings: ["execution_coordination_intelligence"] }),
  branch("tenant_work_coordination", "Tenant Work Coordination", [
    "galleria", "work gallery", "lavori condivisi", "sessioni", "stesso tenant", "lease", "sovrappos", "conflitti", "riprendi lavoro",
  ], [
    "gallery_intake", "work_discovery", "session_presence", "work_branch_routing", "task_claim_coordination",
    "lease_acquisition", "lease_renewal", "lease_release", "surface_overlap_detection", "conflict_arbitration",
    "dependency_coordination", "regression_watch", "checkpoint_handoff", "stale_session_recovery",
    "duplicate_action_prevention", "drift_revalidation", "tenant_visibility_policy", "verified_memory_promotion",
  ], ["*"], { workPhase: "coordination", coreBranchBindings: ["tenant_work_coordination"] }),
  branch("quality_verification", "Quality & Verification", ["test", "qualita", "verifica", "collaudo", "accettazione", "regression", "evidence", "qa"], [
    "acceptance_criteria", "test_scope", "happy_path", "negative_path", "boundary_cases", "security_checks",
    "tenant_isolation_checks", "regression_matrix", "performance_checks", "observability_checks", "evidence_capture",
    "defect_triage", "root_cause_check", "fix_verification", "release_readiness", "quality_summary",
  ], ["*"], { workPhase: "verification", coreBranchBindings: ["quality_verification_intelligence"] }),
  branch("learning_memory", "Learning & Memory", ["impara", "memoria", "feedback", "correzione", "benchmark", "lezione"], [
    "episodic_recall", "semantic_recall", "feedback_interpretation", "pattern_detection", "knowledge_gap",
    "correction_proposal", "benchmark_comparison", "retention_policy", "memory_safety", "learning_summary",
  ], ["*"], { workPhase: "learning", coreBranchBindings: ["adaptive_learning_intelligence"] }),
  branch("adaptive_learning", "Adaptive Learning", ["apprendi", "migliora", "retrospettiva", "outcome", "errore", "lezione", "pattern", "feedback"], [
    "outcome_capture", "expected_actual_delta", "success_pattern", "failure_pattern", "feedback_weighting",
    "noise_filtering", "lesson_distillation", "procedural_memory_candidate", "semantic_memory_candidate", "knowledge_gap_update",
    "benchmark_update_candidate", "policy_change_candidate", "regression_requirement", "human_review_gate",
    "verified_consolidation", "learning_handoff",
  ], ["*"], { workPhase: "learning", coreBranchBindings: ["adaptive_learning_intelligence"] }),
  branch("communication_explanation", "Communication & Explanation", ["spiega", "riassumi", "scrivi", "comunica", "traduci"], [
    "audience_model", "language_selection", "tone_selection", "fact_hypothesis_split", "evidence_citation",
    "plain_language", "structured_summary", "action_explanation", "uncertainty_disclosure", "localization",
  ], ["*"], { workPhase: "communication", coreBranchBindings: ["execution_coordination_intelligence"] }),
  branch("software_intelligence", "Software Intelligence", [
    "software", "codice", "binario", "eseguibile", "debug", "disassembl", "decompil", "ghidra", "frida", "reverse engineering", "interoperabil", "personalizz",
  ], [
    "authorization_scope", "artifact_intake", "provenance_hashing", "format_architecture", "static_evidence",
    "symbol_dependency_mapping", "string_evidence", "control_flow_evidence", "runtime_trace_plan", "behavior_specification",
    "compatibility_mapping", "clean_room_variant", "patch_candidate", "sandbox_plan", "security_review",
    "license_review", "regression_matrix", "evidence_confidence", "core_verdict", "learning_handoff",
  ], ["*"], { workPhase: "research", coreBranchBindings: ["research_evidence_intelligence", "quality_verification_intelligence"] }),
  branch("suite_domain", "Suite Product Pack", ["suite", "sito", "wordpress", "landing", "pubblica"], [
    "site_governance", "content_publishing", "template_management", "landing_management", "lead_capture",
    "deployment_readiness", "site_isolation", "rollback_readiness",
  ], ["suite", "skinharmony"], { workPhase: "domain", coreBranchBindings: ["suite_governance"] }),
  branch("smartdesk_domain", "SmartDesk Product Pack", ["smartdesk", "agenda", "cassa", "magazzino", "operativ"], [
    "desk_operations", "appointment_workflow", "customer_operations", "billing_operations", "inventory_operations",
    "operational_api_guard", "node_isolation", "handoff_readiness",
  ], ["smartdesk", "skinharmony"], { workPhase: "domain", coreBranchBindings: ["smartdesk_operations_guard"] }),
  branch("analyzer_domain", "Analyzer Product Pack", ["analyzer", "analisi", "protocollo", "cosmet", "beauty"], [
    "analyzer_interpretation", "protocol_advisory", "cosmetic_claims", "evidence_quality", "result_explanation",
    "value_chain_review", "pricing_guard", "subject_isolation", "acquisition_quality", "capture_provenance", "uncertainty_abstention", "longitudinal_comparability", "scalp_zone_analysis", "reported_warning_stop", "fairness_audit", "verified_outcome_learning", "human_review_release",
  ], ["analyzer", "skinharmony"], { workPhase: "domain", coreBranchBindings: ["skinharmony_analyzer", "scalp_analyzer", "beauty_protocol_guard"] }),
]);

// This is deliberately narrower than reversing core_branch_bindings. Bindings
// also describe shared Core dependencies: reversing all of them would, for
// example, open software analysis for every generic quality request.
const CORE_TO_NYRA_REQUEST_ROUTES = Object.freeze({
  work_intake_intelligence: Object.freeze(["context_intelligence", "work_intake"]),
  research_evidence_intelligence: Object.freeze(["research_evidence"]),
  planning_priority_intelligence: Object.freeze(["decision_reasoning", "planning_prioritization"]),
  execution_coordination_intelligence: Object.freeze(["execution_planning", "parallel_coordination"]),
  quality_verification_intelligence: Object.freeze(["risk_governance", "quality_verification"]),
  adaptive_learning_intelligence: Object.freeze(["learning_memory", "adaptive_learning"]),
  workload_identity_delegation_guard: Object.freeze(["delegated_authority"]),
  decision_provenance_intelligence: Object.freeze(["decision_provenance"]),
  agent_orchestration: Object.freeze(["relational_supervision", "agent_orchestration"]),
  ai_orchestration: Object.freeze(["relational_supervision", "ai_orchestration"]),
  software_systems_intelligence: Object.freeze(["software_intelligence"]),
  software_binary_intelligence: Object.freeze(["software_intelligence"]),
  suite_governance: Object.freeze(["suite_domain"]),
  smartdesk_operations_guard: Object.freeze(["smartdesk_domain"]),
  skinharmony_analyzer: Object.freeze(["analyzer_domain"]),
  scalp_analyzer: Object.freeze(["analyzer_domain"]),
  beauty_protocol_guard: Object.freeze(["analyzer_domain"]),
});

function normalizeList(value, max = 50) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, max).map((item) => String(item || "").trim()).filter(Boolean))];
}

function availableForPack(item, packId) {
  return item.domain_packs.includes("*") || item.domain_packs.includes(packId);
}

export function validateNyraBranchNetwork(branches = NYRA_BRANCHES) {
  const errors = [];
  const ids = new Set();
  for (const item of branches) {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(item.id)) errors.push(`invalid_branch_id:${item.id}`);
    if (ids.has(item.id)) errors.push(`duplicate_branch_id:${item.id}`);
    ids.add(item.id);
    if (!Array.isArray(item.subbranches) || item.subbranches.length === 0) errors.push(`subbranches_required:${item.id}`);
    if (item.subbranches.length > MAX_SUBBRANCHES_PER_BRANCH) errors.push(`subbranch_limit_exceeded:${item.id}`);
    if (new Set(item.subbranches).size !== item.subbranches.length) errors.push(`duplicate_subbranch:${item.id}`);
    if (item.subbranches.some((id) => !/^[a-z][a-z0-9_]{1,63}$/.test(id))) errors.push(`invalid_subbranch_id:${item.id}`);
    if (item.core_branch_bindings.some((id) => !/^[a-z][a-z0-9_]{1,63}$/.test(id))) errors.push(`invalid_core_binding:${item.id}`);
  }
  return { ok: errors.length === 0, errors, max_subbranches_per_branch: MAX_SUBBRANCHES_PER_BRANCH };
}

export function nyraBranchCatalog(packId = "generic") {
  return {
    schema_version: "nyra_neural_branch_network_v1",
    governance: "core_opens_nyra_branches",
    maximum_subbranches_per_branch: MAX_SUBBRANCHES_PER_BRANCH,
    domain_pack_id: packId,
    branches: NYRA_BRANCHES.filter((item) => availableForPack(item, packId)).map((item) => ({
      id: item.id,
      label: item.label,
      work_phase: item.work_phase,
      subbranch_count: item.subbranches.length,
      subbranches: [...item.subbranches],
      core_branch_bindings: [...item.core_branch_bindings],
    })),
  };
}

export function routeNyraBranches({
  text = "",
  requestedBranches = [],
  authorizedCoreBranches = [],
  domainPackId = "generic",
} = {}) {
  const available = NYRA_BRANCHES.filter((item) => availableForPack(item, domainPackId));
  const availableIds = new Set(available.map((item) => item.id));
  const requested = normalizeList(requestedBranches);
  const authorizedCore = normalizeList(authorizedCoreBranches);
  const mappedFromCore = [...new Set(authorizedCore
    .flatMap((id) => CORE_TO_NYRA_REQUEST_ROUTES[id] || [])
    .filter((id) => availableIds.has(id)))];
  const mappedCoreIds = new Set(authorizedCore.filter((id) =>
    (CORE_TO_NYRA_REQUEST_ROUTES[id] || []).some((nyraId) => availableIds.has(nyraId))));
  const coreOnly = authorizedCore.filter((id) => !mappedCoreIds.has(id));
  const inferred = available
    .filter((item) => item.triggers.some((trigger) => String(text || "").toLowerCase().includes(trigger)))
    .map((item) => item.id);
  const orchestrationSupervisionRequired = [...requested, ...mappedFromCore, ...inferred]
    .some((id) => id === "agent_orchestration" || id === "ai_orchestration");
  const candidates = [...new Set([
    "context_intelligence",
    "work_intake",
    "risk_governance",
    ...(orchestrationSupervisionRequired ? ["relational_supervision"] : []),
    ...requested,
    ...mappedFromCore,
    ...inferred,
  ])];
  const opened = candidates.filter((id) => availableIds.has(id));
  const denied = requested.filter((id) => !availableIds.has(id));
  const openedRecords = opened.map((id) => available.find((candidate) => candidate.id === id));
  const waves = [];
  for (let index = 0; index < openedRecords.length; index += MAX_PARALLEL_BRANCHES) {
    waves.push(openedRecords.slice(index, index + MAX_PARALLEL_BRANCHES).map((item) => item.id));
  }
  const learningActive = opened.includes("learning_memory") || opened.includes("adaptive_learning");
  return {
    schema_version: "nyra_neural_branch_route_v1",
    domain_pack_id: domainPackId,
    opened_by: "universal_core",
    proposal_source: "nyra_request_plus_core_inference",
    opened_branches: openedRecords.map((item) => ({
      id: item.id,
      status: "opened",
      work_phase: item.work_phase,
      subbranches: [...item.subbranches],
      core_branch_bindings: [...item.core_branch_bindings],
    })),
    denied_branches: denied,
    unknown_or_unentitled_branch_count: denied.length,
    core_branch_mapping: {
      authorized_core_branches: authorizedCore,
      mapped_core_branches: authorizedCore.filter((id) => mappedCoreIds.has(id)),
      core_only_branches: coreOnly,
      mapped_nyra_branches: mappedFromCore,
    },
    parallel_analysis: {
      enabled: opened.length > 1,
      mode: "bounded_parallel_advisory",
      maximum_parallel_branches: MAX_PARALLEL_BRANCHES,
      waves,
      join_authority: "universal_core",
      conflict_policy: "core_reconciles_evidence_before_action",
    },
    governed_learning: {
      state: learningActive ? "active" : "available_on_feedback_or_outcome",
      memory_source: "tenant_memory_fabric",
      stages: ["capture", "compare", "distill", "propose", "verify", "consolidate"],
      activation_requires: ["evidence", "outcome_or_feedback", "tenant_scope"],
      policy_activation_requires_verify: true,
      free_weight_training: false,
      auto_execution: false,
    },
    execution_authorized: false,
  };
}

const NETWORK_VALIDATION = validateNyraBranchNetwork();
if (!NETWORK_VALIDATION.ok) throw new Error(`invalid_nyra_branch_network:${NETWORK_VALIDATION.errors.join(",")}`);

export { MAX_PARALLEL_BRANCHES, MAX_SUBBRANCHES_PER_BRANCH };

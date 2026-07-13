const MAX_SUBBRANCHES_PER_BRANCH = 20;

const branch = (id, label, triggers, subbranches, domainPacks = ["*"]) => Object.freeze({
  id,
  label,
  triggers: Object.freeze(triggers),
  domain_packs: Object.freeze(domainPacks),
  subbranches: Object.freeze(subbranches.map((subbranch) => Object.freeze(subbranch))),
});

const NYRA_BRANCHES = Object.freeze([
  branch("context_intelligence", "Context Intelligence", ["contesto", "stato", "dati", "input", "mappa"], [
    "request_normalization", "actor_context", "tenant_context", "system_context", "temporal_context",
    "data_quality", "missing_information", "source_reliability", "constraint_mapping", "language_context",
  ]),
  branch("decision_reasoning", "Decision Reasoning", ["decidi", "scegli", "priorita", "opzioni", "strategia", "valuta"], [
    "intent_inference", "hypothesis_generation", "option_generation", "tradeoff_analysis", "priority_ranking",
    "causal_reasoning", "counterfactual_reasoning", "confidence_calibration", "decision_summary", "next_best_action",
  ]),
  branch("risk_governance", "Risk & Governance", ["rischio", "sicurezza", "privacy", "policy", "audit", "tenant", "permessi"], [
    "risk_detection", "policy_alignment", "tenant_isolation", "scope_validation", "privacy_review",
    "security_review", "compliance_review", "claim_review", "pricing_review", "audit_evidence",
    "confirmation_gate", "rollback_readiness",
  ]),
  branch("execution_planning", "Execution Planning", ["piano", "esegui", "runbook", "deploy", "render", "automat", "implementa"], [
    "goal_decomposition", "dependency_mapping", "runbook_design", "resource_estimation", "failure_mode_analysis",
    "test_strategy", "release_strategy", "rollback_plan", "human_confirmation", "evidence_plan",
  ]),
  branch("learning_memory", "Learning & Memory", ["impara", "memoria", "feedback", "correzione", "benchmark"], [
    "episodic_recall", "semantic_recall", "feedback_interpretation", "pattern_detection", "knowledge_gap",
    "correction_proposal", "benchmark_comparison", "retention_policy", "memory_safety", "learning_summary",
  ]),
  branch("communication_explanation", "Communication & Explanation", ["spiega", "riassumi", "scrivi", "comunica", "traduci"], [
    "audience_model", "language_selection", "tone_selection", "fact_hypothesis_split", "evidence_citation",
    "plain_language", "structured_summary", "action_explanation", "uncertainty_disclosure", "localization",
  ]),
  branch("skinharmony_domain", "SkinHarmony Domain", ["skinharmony", "beauty", "salone", "smartdesk", "protocollo", "cosmet"], [
    "analyzer_interpretation", "beauty_protocol", "cosmetic_claims", "center_operations", "customer_journey",
    "product_inventory", "beauty_value_chain", "brand_network", "site_suite", "smartdesk_bridge",
    "pricing_guard", "retention_recall",
  ], ["skinharmony"]),
]);

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
      subbranch_count: item.subbranches.length,
      subbranches: [...item.subbranches],
    })),
  };
}

export function routeNyraBranches({ text = "", requestedBranches = [], domainPackId = "generic" } = {}) {
  const available = NYRA_BRANCHES.filter((item) => availableForPack(item, domainPackId));
  const availableIds = new Set(available.map((item) => item.id));
  const requested = normalizeList(requestedBranches);
  const inferred = available
    .filter((item) => item.triggers.some((trigger) => String(text || "").toLowerCase().includes(trigger)))
    .map((item) => item.id);
  const candidates = [...new Set(["context_intelligence", "risk_governance", ...requested, ...inferred])];
  const opened = candidates.filter((id) => availableIds.has(id));
  const denied = requested.filter((id) => !availableIds.has(id));
  return {
    schema_version: "nyra_neural_branch_route_v1",
    domain_pack_id: domainPackId,
    opened_by: "universal_core",
    proposal_source: "nyra_request_plus_core_inference",
    opened_branches: opened.map((id) => {
      const item = available.find((candidate) => candidate.id === id);
      return { id, status: "opened", subbranches: [...item.subbranches] };
    }),
    denied_branches: denied,
    unknown_or_unentitled_branch_count: denied.length,
    execution_authorized: false,
  };
}

const NETWORK_VALIDATION = validateNyraBranchNetwork();
if (!NETWORK_VALIDATION.ok) throw new Error(`invalid_nyra_branch_network:${NETWORK_VALIDATION.errors.join(",")}`);

export { MAX_SUBBRANCHES_PER_BRANCH };


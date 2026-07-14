export const branchAdaptiveLearningIntelligence = {
  id: "adaptive_learning_intelligence",
  file: "branch-adaptive-learning-intelligence.js",
  tier: "base",
  label: "Adaptive Learning Intelligence",
  domain: "horizontal_work",
  production_status: "advisory",
  description: "Apprende da outcome e feedback nel perimetro tenant, propone lezioni e le consolida solo dopo evidenza e verifica.",
  subbranches: [
    "outcome_capture", "expected_actual_delta", "success_pattern", "failure_pattern", "feedback_weighting",
    "noise_filtering", "lesson_distillation", "procedural_memory_candidate", "semantic_memory_candidate", "knowledge_gap_update",
    "benchmark_update_candidate", "policy_change_candidate", "regression_requirement", "human_review_gate",
    "verified_consolidation", "learning_handoff",
  ],
  rules: [
    "La fonte di continuita e il Tenant Memory Fabric isolato per tenant, non una memoria globale condivisa.",
    "Apprendere significa catturare, confrontare, distillare, proporre, verificare e poi consolidare.",
    "Feedback singolo, rumore o correlazione non provano una regola generale.",
    "Ogni candidato di memoria deve dichiarare provenienza, outcome, confidenza, tenant e scadenza o revisione.",
    "Cambi di default, benchmark o policy richiedono verify e regression check prima della promozione.",
    "Non eseguire addestramento libero dei pesi, auto-modifica del runtime o apprendimento cross-tenant.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "tenant_scoped_verified_learning",
    blocked_actions: ["free_weight_training", "cross_tenant_learning", "memory_without_provenance", "policy_change_without_verify", "learning_from_untrusted_noise", "runtime_self_modification"],
  },
};

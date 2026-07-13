export const branchQualityVerificationIntelligence = {
  id: "quality_verification_intelligence",
  file: "branch-quality-verification-intelligence.js",
  tier: "base",
  label: "Quality & Verification Intelligence",
  domain: "horizontal_work",
  production_status: "advisory",
  description: "Trasforma criteri di successo in collaudi, regressioni, evidenze e verdict di readiness.",
  subbranches: [
    "acceptance_criteria", "test_scope", "happy_path", "negative_path", "boundary_cases", "security_checks",
    "tenant_isolation_checks", "regression_matrix", "performance_checks", "observability_checks", "evidence_capture",
    "defect_triage", "root_cause_check", "fix_verification", "release_readiness", "quality_summary",
  ],
  rules: [
    "Verificare criteri di accettazione, percorsi negativi, limiti e regressioni proporzionati al rischio.",
    "Un test superato senza evidenza riproducibile non basta per promuovere una modifica.",
    "Includere sempre isolamento tenant e autorizzazioni quando sono coinvolti dati o memoria.",
    "Separare difetto osservato, causa ipotizzata, correzione e verifica della correzione.",
    "Il verdict di readiness non sostituisce conferma owner, policy o rollback.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "quality_verification_advisory",
    blocked_actions: ["unverified_release", "missing_negative_tests", "tenant_isolation_unchecked", "fabricated_test_evidence"],
  },
};

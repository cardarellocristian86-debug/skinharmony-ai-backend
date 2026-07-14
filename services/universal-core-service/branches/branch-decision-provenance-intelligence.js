export const branchDecisionProvenanceIntelligence = {
  id: "decision_provenance_intelligence",
  file: "branch-decision-provenance-intelligence.js",
  tier: "base",
  label: "Decision Provenance Intelligence",
  domain: "horizontal_work",
  production_status: "advisory",
  description: "Mantiene una catena verificabile tra richiesta, identita, regole, evidenze, decisione, conferma, scadenza e rollback.",
  subbranches: [
    "decision_request", "actor_and_authority", "policy_snapshot", "input_fingerprint", "evidence_lineage",
    "risk_rationale", "decision_contract", "human_confirmation", "decision_expiry", "revalidation_trigger",
    "reversal_path", "audit_safe_summary", "provenance_graph", "decision_replay_check", "accountability_handoff",
  ],
  rules: [
    "Ogni decisione ad impatto deve distinguere richiesta, identita autorizzata, policy applicata, evidenza, verdict e azione eseguita.",
    "La provenienza conserva riferimenti e fingerprint minimizzati, non segreti, token, prompt completi o dati personali non necessari.",
    "Una conferma owner e valida solo per il decision contract specifico, entro una finestra temporale e senza estendersi a richieste correlate.",
    "Se policy, evidenza, tenant, asset o rischio cambiano, il verdict precedente scade e deve essere rivalidato.",
    "Il ramo deve rendere espliciti incertezza, assunzioni e percorso di reversal/rollback prima di promuovere una decisione.",
    "La memoria cross-tenant e la riusabilita di decisioni sono proibite salvo evidenza aggregata, autorizzata e non identificativa.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "decision_provenance_advisory",
    blocked_actions: [
      "decision_without_authority", "confirmation_scope_expansion", "stale_verdict_reuse", "missing_reversal_path",
      "secret_in_provenance", "cross_tenant_decision_replay", "unexplained_high_impact_decision",
    ],
  },
};

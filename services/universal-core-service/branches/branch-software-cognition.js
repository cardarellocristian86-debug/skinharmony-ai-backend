export const branchSoftwareCognition = {
  id: "software_cognition",
  file: "branch-software-cognition.js",
  tier: "internal",
  label: "Software Cognition",
  domain: "software_systems",
  production_status: "advisory",
  description: "Proiezione semantica Nyra per leggere grafo, impatto, obblighi, piani, sfide e realta runtime; ogni decisione resta a Universal Core.",
  subbranches: [
    "software_reality_graph", "requirement_traceability", "change_impact_prediction",
    "causal_obligation_coverage", "worker_plan_review", "supervisory_challenge",
    "predicted_actual_reconciliation", "runtime_reality", "architecture_recovery",
    "verified_learning_calibration", "closure_readiness_advisory",
  ],
  rules: [
    "Separare sempre fatti osservati, inferenze, ipotesi e decisioni Core.",
    "Ogni relazione e verdetto deve essere tenant-safe, deterministico e legato a evidenza persistita.",
    "Nyra non chiude Work o Change, non muta Genesis o Intent e non sostituisce ICF o Generic Core Join.",
    "Sfide critiche, cambiamenti non pianificati e osservazioni runtime mancanti devono restare visibili e fail-closed.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "advisory_reasoning_and_evidence_projection",
    blocked_actions: ["core_decision_override", "genesis_mutation", "caller_asserted_coverage", "self_verification", "automatic_publish"],
  },
};

export const branchCustomerBehaviorAnalysis = {
  id: "customer_behavior_analysis",
  file: "branch-customer-behavior-analysis.js",
  tier: "network",
  label: "Customer Behavior Analysis",
  domain: "customer_intelligence",
  production_status: "advisory",
  description: "Ramo per lettura comportamentale clienti, frequenza, valore, abbandono e opportunita. Non profila dati sensibili.",
  rules: [
    "Leggere pattern operativi: frequenza, ricorrenza, acquisti, no-show, risposta alle offerte e storico interazioni.",
    "Separare dato osservato, inferenza prudente e azione consigliata.",
    "Non dedurre salute, condizione medica, stato emotivo intimo o categorie protette.",
    "Se il campione dati e piccolo o incompleto, abbassare confidence e chiedere raccolta dati.",
    "Ogni suggerimento deve indicare motivo, rischio, prossima azione e canale consentito.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "behavioral_advisory",
    blocked_actions: [
      "sensitive_profiling",
      "medical_or_psychological_inference",
      "black_box_score_without_reason",
      "auto_contact_without_consent",
      "cross_tenant_behavior_merge",
    ],
  },
};

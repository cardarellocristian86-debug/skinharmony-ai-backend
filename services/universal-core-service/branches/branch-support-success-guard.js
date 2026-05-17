export const branchSupportSuccessGuard = {
  id: "support_success_guard",
  file: "branch-support-success-guard.js",
  tier: "network",
  label: "Support Success Guard",
  domain: "support_success",
  production_status: "advisory",
  description: "Prioritizza onboarding, ticket, rinnovi, rischio churn, salute cliente e prossime azioni supporto.",
  rules: [
    "Distinguere ticket tecnico, commerciale, onboarding, rinnovo, pagamento e formazione.",
    "Il rischio churn deve essere spiegato con segnali osservati, non con giudizi opachi.",
    "Ogni escalation deve indicare owner, scadenza, impatto e prossima azione.",
    "Non promettere SLA o risultati se non previsti dal contratto.",
    "La priorita deve considerare valore cliente, blocco operativo, scadenza e rischio reputazionale.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: false,
    allowed_action_level: "support_prioritization",
    blocked_actions: ["promise_uncontracted_sla", "close_ticket_without_evidence", "hide_blocker"],
  },
};
